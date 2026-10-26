#!/usr/bin/env python3
"""Offline safety tests; no service, database, or network calls."""
import importlib.util
from pathlib import Path
import subprocess
import os
import stat
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('rehearsal', HERE / 'rehearsal.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
ROOT = HERE.parent.parent


def javascript(source):
    result = subprocess.run(['node', '--input-type=module'], input=source, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(result.stderr)


class Rehearsal(unittest.TestCase):
    def test_candidate_readability_with_private_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            old = os.umask(0o077)
            try:
                r.save(Path(directory) / 'source.mjs', b'export {};', 0o644)
                r.save(Path(directory) / 'receipt.json', b'{}')
            finally:
                os.umask(old)
            self.assertEqual(stat.S_IMODE((Path(directory) / 'source.mjs').stat().st_mode), 0o644)
            self.assertEqual(stat.S_IMODE((Path(directory) / 'receipt.json').stat().st_mode), 0o600)

    def test_real_source_transforms_only_startup_and_readonly_connection(self):
        source = (ROOT / r.API).read_bytes()
        transformed = r.transform_api(source)
        self.assertEqual(transformed.decode().split('\n' + r.TAIL)[0], source.decode().split(r.FOOTER)[0])
        self.assertNotIn(b'server.listen(', transformed)
        self.assertIn(b'internalCanonicalSummaryPayload("livenet", {', transformed)
        self.assertNotIn(b'storeCanonicalSummary', r.TAIL.encode())
        database = (ROOT / r.POSTGRES).read_bytes()
        guarded = r.transform_postgres(database)
        self.assertIn(b'default_transaction_read_only=on', guarded)
        self.assertIn(b'SHOW transaction_read_only', guarded)
        for code in [transformed, guarded]:
            result = subprocess.run(['node', '--input-type=module', '--check'], input=code, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_ambiguous_or_changed_startup_and_database_refuse(self):
        source = (ROOT / r.API).read_bytes()
        for value in [source + r.FOOTER.encode(), source.replace(b'server.listen(PORT', b'server.listen(OTHER'),
                      b'server.listen(123);\n' + source]:
            with self.assertRaises(ValueError):
                r.transform_api(value)
        database = (ROOT / r.POSTGRES).read_bytes()
        for value in [database + b'const { Pool } = pg;', database.replace(b'pg_temp', b'public')]:
            with self.assertRaises(ValueError):
                r.transform_postgres(value)

    def test_sql_readonly_guard_and_connection_enforcement(self):
        javascript('''
import assert from "node:assert/strict";
let readOnly = "on";
const pg = { Client: class {
  query(query, callback) {
    if (query === "SHOW transaction_read_only") return callback(null, { rows: [{ transaction_read_only: readOnly }] });
    return Promise.resolve({ rows: [] });
  }
  connect(callback) { if (callback) return callback(null); return Promise.resolve(); }
}};
''' + r.QUERY_GUARD + '''
for (const sql of ["SELECT 1", "WITH a AS (SELECT 1) SELECT * FROM a", "BEGIN READ ONLY",
  "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "COMMIT", "ROLLBACK",
  "SET LOCAL search_path = pg_catalog, pg_temp", "SET LOCAL statement_timeout = '30s'",
  "SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '60000ms'",
  "SELECT payload->>'update' AS updated_at FROM events"]) {
  assert.doesNotThrow(() => rehearsalReadOnlySql(sql), sql);
}
for (const sql of ["UPDATE events SET x=1", "WITH changed AS (DELETE FROM events RETURNING *) SELECT * FROM changed",
  "SELECT 1; DROP TABLE events", "SET default_transaction_read_only=off", "BEGIN READ WRITE",
  "SELECT set_config('default_transaction_read_only','off',false)", "SELECT pg_advisory_lock(1)",
  "COPY events TO '/tmp/payload'", "SELECT 1 INTO tmp", "SET LOCAL statement_timeout=10; DELETE FROM events"]) {
  assert.throws(() => rehearsalReadOnlySql(sql), /Rehearsal/, sql);
}
await new pg.Client().connect();
await new Promise((resolve, reject) => new pg.Client().connect(error => error ? reject(error) : resolve()));
readOnly = "off";
await assert.rejects(new pg.Client().connect(), /not read-only/);
await assert.rejects(new Promise((resolve, reject) => new pg.Client().connect(error => error ? reject(error) : resolve())), /not read-only/);
''')

    def test_network_guard_refuses_signing_broadcast_and_non_rpc_posts(self):
        javascript('''
import assert from "node:assert/strict";
process.env.BITCOIN_RPC_URL = "http://127.0.0.1:8332/";
let calls = 0;
globalThis.fetch = async (url, init) => { calls++; assert.equal(init.redirect, "error"); return {}; };
''' + r.FETCH_GUARD + '''
await fetch("https://fixture.invalid/read");
await fetch(process.env.BITCOIN_RPC_URL, {method:"POST",body:JSON.stringify({method:"getblockchaininfo"})});
await fetch(process.env.BITCOIN_RPC_URL, {method:"POST",body:JSON.stringify([{method:"gettxout"},{method:"getblockhash"}])});
for (const method of ["sendrawtransaction", "submitpackage", "signrawtransactionwithwallet", "setnetworkactive", "invalidateblock"]) {
  await assert.rejects(fetch(process.env.BITCOIN_RPC_URL, {method:"POST",body:JSON.stringify({method})}), /Rehearsal/);
}
await assert.rejects(fetch("https://fixture.invalid/write", {method:"POST",body:"{}"}), /Rehearsal/);
await assert.rejects(fetch(process.env.BITCOIN_RPC_URL, {method:"DELETE"}), /Rehearsal/);
assert.equal(calls, 3);
''')

    def test_service_is_bounded_readonly_and_uses_only_existing_mount_targets(self):
        plan = {'runtimeManifestTemplate': {'releaseId': 'a' * 12 + '-20261026T220000Z'}, 'nodePath': '/usr/bin/node'}
        args = r.command(plan, Path('/tmp/proofofwork-rehearsal'), {}, ['/private/example.env'])
        for property in ['ProtectSystem=strict', 'NoNewPrivileges=true', 'CapabilityBoundingSet=',
                         'MemoryMax=2G', 'MemorySwapMax=0', 'RuntimeMaxSec=300',
                         'RemainAfterExit=yes', 'User=powadmin']:
            self.assertIn('--property=' + property, args)
        binds = next(arg for arg in args if arg.startswith('--property=BindReadOnlyPaths='))
        self.assertEqual(len(binds.split('=', 2)[2].split()), 3)
        for name in [r.API, r.READER, r.POSTGRES]:
            self.assertIn(':' + str(r.RUNTIME / name), binds)
        self.assertFalse(any('ReadWritePaths=' in arg for arg in args))
        self.assertEqual(args[-3], '--import')
        self.assertTrue(args[-2].startswith('data:text/javascript;base64,'))

    def test_inherited_environment_files_are_separate_and_ordered(self):
        paths = ['/etc/proofofwork-api/bitcoin-rpc.env',
                 '/etc/proofofwork-api/proof-indexer-db.env',
                 '/etc/proofofwork-api/internal-verifier.env']
        serialized = '\n'.join(path + ' (ignore_errors=no)' for path in paths)
        self.assertEqual(r.environment_files(serialized), paths)
        plan = {'runtimeManifestTemplate': {'releaseId': 'a' * 12 + '-20261026T220000Z'},
                'nodePath': '/usr/bin/node'}
        inherited = {'Environment': 'FIXTURE=inline', 'PassEnvironment': 'PASSED',
                     'UnsetEnvironment': 'REMOVED'}
        args = r.command(plan, Path('/tmp/proofofwork-rehearsal'), inherited,
                         r.environment_files(serialized))
        self.assertEqual([arg for arg in args if arg.startswith('--property=EnvironmentFile=')],
                         ['--property=EnvironmentFile=' + path for path in paths])
        for key, value in inherited.items():
            self.assertIn('--property=' + key + '=' + value, args)
        self.assertEqual(r.environment_files(serialized + '\n' + paths[0] + ' (ignore_errors=no)'),
                         paths + paths[:1])
        self.assertEqual(r.environment_files(''), [])
        self.assertFalse(any(arg.startswith('--property=EnvironmentFile=') for arg in
                             r.command(plan, Path('/tmp/proofofwork-rehearsal'), inherited)))

    def test_unsupported_environment_file_serialization_refuses(self):
        for value in ['/private/optional.env (ignore_errors=yes)',
                      '/private/first.env /private/second.env (ignore_errors=no)',
                      '/private/required.env (ignore_errors=no) trailing',
                      'relative.env (ignore_errors=no)']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                r.environment_files(value)

    def test_actual_environment_file_inheritance_requires_exact_order_and_paths(self):
        paths = ['/private/rpc.env', '/private/database.env', '/private/verifier.env']
        def serialized(items):
            return '\n'.join(path + ' (ignore_errors=no)' for path in items)
        expected = serialized(paths)
        r.require_environment_files(expected, expected)
        for actual in [serialized(paths[::-1]), serialized(paths[:-1]),
                       serialized(paths + paths[:1]), serialized(paths[:2] + ['/private/foreign.env']),
                       expected.replace('ignore_errors=no', 'ignore_errors=yes', 1),
                       ' '.join(paths) + ' (ignore_errors=no)']:
            with self.subTest(actual=actual), self.assertRaises(ValueError):
                r.require_environment_files(actual, expected)


if __name__ == '__main__':
    unittest.main()
