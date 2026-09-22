#!/usr/bin/python3 -I
"""Synthetic tests: no real capture, privilege drop, systemctl or DB access."""
import hashlib
import importlib.util
import json
import pathlib
import shlex
import sys
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('audit5_private_env', ROOT / 'deploy/audit5/private-env.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
RELEASE = 'abcdef123456-20260905T160000Z'
BASE = {b'POW_INDEX_DATABASE_URL': b'postgresql://synthetic:dummy@127.0.0.1/proof_indexer',
        b'NETWORK': b'livenet', b'DECLARATION_PIN': b'preserve-exactly', b'NODE_OPTIONS': b'--max-old-space-size=6144'}


class PrivateLauncherTests(unittest.TestCase):
    def test_nul_environment_preserves_literal_bytes_and_rejects_ambiguity(self):
        blob = b'API_KEY=a=b\nquoted value\0PATH=/usr/bin\0'
        self.assertEqual(module.parse_env(blob)[b'API_KEY'], b'a=b\nquoted value')
        for bad in (b'', b'A=x', b'A=x\0A=y\0', b'A=x\0\0', b'BAD-KEY=x\0', b'A=x\0BROKEN\0'):
            with self.assertRaises(module.Refused):
                module.parse_env(bad)

    def test_release_identity_cannot_escape_private_paths(self):
        self.assertEqual(module.runroot(RELEASE), '/run/proofofwork-audit5-' + RELEASE)
        for bad in ('../escape', RELEASE + '/x', RELEASE + '\n', 'arbitrary'):
            with self.assertRaises(module.Refused):
                module.runroot(bad)
            with self.assertRaises(module.Refused):
                module.launch_plan('gate', BASE, bad, 'audit:ids')

    def test_pid_replacement_refuses_before_any_environment_file_is_written(self):
        account = types.SimpleNamespace(pw_name='powadmin', pw_uid=1000, pw_gid=1000)
        with patch.object(module, 'check_root_dir'), patch.object(module.os, 'mkdir'), \
             patch.object(module.os, 'chown'), patch.object(module.os, 'chmod'), \
             patch.object(module, 'exclusive_write') as write, \
             patch.object(module, 'proc_identity', side_effect=[{'pid': 123, 'startTicks': 1}, {'pid': 123, 'startTicks': 2}]), \
             patch.object(module.pathlib.Path, 'read_bytes', return_value=b'POW_INDEX_DATABASE_URL=dummy\0'):
            with self.assertRaises(module.Refused):
                module.capture(RELEASE, account)
            write.assert_not_called()

    def test_complete_capture_keeps_api_and_worker_separate_and_records_all_fences(self):
        account = types.SimpleNamespace(pw_name='powadmin', pw_uid=1000, pw_gid=1000)
        api = {'pid': 123, 'startTicks': 1}
        worker = {'pid': 456, 'startTicks': 2}
        blobs = [b'POW_INDEX_DATABASE_URL=api-dummy\0', b'POW_INDEX_DATABASE_URL=worker-dummy\0']
        with patch.object(module, 'check_root_dir'), patch.object(module.os, 'mkdir'), \
             patch.object(module.os, 'chown'), patch.object(module.os, 'chmod'), \
             patch.object(module, 'fsync_dir'), patch('builtins.print') as printed, \
             patch.object(module, 'exclusive_write') as write, \
             patch.object(module, 'proc_identity', side_effect=[api, api, worker, worker, api, worker]), \
             patch.object(module.pathlib.Path, 'read_bytes', side_effect=blobs):
            module.capture(RELEASE, account)
        writes = {call.args[0].split('/')[-1]: call.args[1] for call in write.call_args_list}
        self.assertEqual(writes['api.environ'], blobs[0])
        self.assertEqual(writes['worker.environ'], blobs[1])
        manifest = json.loads(writes['capture.json'])
        for kind, identity in [('api', api), ('worker', worker)]:
            row = manifest['processes'][kind]
            self.assertEqual(row['identityBefore'], identity)
            self.assertEqual(row['identityAfter'], identity)
            self.assertEqual(row['identityFinal'], identity)
        self.assertNotIn('dummy', str(printed.call_args_list))

    def test_shadow_overrides_preserve_original_credentials_and_declaration_pins(self):
        original = {**BASE, b'LISTEN_FDS': b'3', b'NOTIFY_SOCKET': b'/private', b'WATCHDOG_USEC': b'1000',
                    b'JOURNAL_STREAM': b'8:123', b'ENABLE_STARTUP_EXPENSIVE_PREWARM': b'1'}
        env, command = module.launch_plan('readonly-shadow', original, RELEASE)
        self.assertIsNone(command)
        for key in (b'DECLARATION_PIN', b'POW_INDEX_DATABASE_URL', b'NODE_OPTIONS'):
            self.assertEqual(env[key], original[key])
        self.assertEqual(env[b'HOST'], b'127.0.0.1')
        self.assertEqual(env[b'PORT'], b'18081')
        self.assertEqual(env[b'POW_INDEX_DB_POOL_MAX'], b'2')
        self.assertEqual(env[b'POW_API_CACHE_DIR'], ('/data/proofofwork-api-cache-shadow-' + RELEASE).encode())
        self.assertTrue(all(env[key.encode()] == b'0' for key in module.SHADOW_SWITCHES))
        self.assertFalse(any(key.startswith((b'LISTEN_', b'NOTIFY_', b'WATCHDOG_')) for key in env))
        self.assertNotIn(b'JOURNAL_STREAM', env)
        self.assertEqual(original[b'ENABLE_STARTUP_EXPENSIVE_PREWARM'], b'1')

    def test_candidate_probe_has_fixed_release_port_command_and_no_captured_secrets(self):
        release = module.PROBE_RELEASE
        original = {**BASE, b'API_KEY': b'synthetic-secret', b'POW_INDEX_DATABASE_URL': b'private-database-url'}
        env, command = module.launch_plan('candidate-probe', original, release)
        self.assertEqual(command, [module.PROBE_SCRIPT_COPY, '--run', '--output',
                                   module.PROBE_OUTPUT, '--api-port', '18081'])
        self.assertEqual(module.PROBE_OUTPUT, module.PROBE_OUTPUT_ROOT + '/attempt')
        self.assertTrue(module.PROBE_OUTPUT_ROOT.endswith('-retry2'))
        self.assertTrue(module.PROBE_SCRIPT_COPY.endswith('-retry2.mjs'))
        self.assertEqual(env[b'PWD'], b'/data')
        self.assertNotIn(b'API_KEY', env)
        self.assertNotIn(b'POW_INDEX_DATABASE_URL', env)
        self.assertEqual(env[b'HOST'] if b'HOST' in env else None, None)
        self.assertEqual(env[b'PORT'] if b'PORT' in env else None, None)
        for bad_release, bad_port in ((RELEASE, 18081), (release, 8081)):
            with self.assertRaises(module.Refused):
                module.launch_plan('candidate-probe', original, bad_release, api_port=bad_port)

    def test_candidate_runner_is_bound_to_the_reviewed_helpers_and_retry_path(self):
        runner = (ROOT / 'deploy/audit5/run-candidate-probe.sh').read_text()
        launcher_hash = hashlib.sha256((ROOT / 'deploy/audit5/private-env.py').read_bytes()).hexdigest()
        self.assertIn(f"release='{module.PROBE_RELEASE}'", runner)
        self.assertIn(f"commit='{module.PROBE_COMMIT}'", runner)
        self.assertIn(f"tree='{module.PROBE_TREE}'", runner)
        self.assertIn(f"probe_sha256='{module.PROBE_SCRIPT_SHA256}'", runner)
        self.assertIn(f"private_env_sha256='{launcher_hash}'", runner)
        self.assertIn('output="/data/proofofwork-audit5-probe-${release}-retry2/attempt"', runner)
        self.assertIn('bitcoin_uid="$(id -u bitcoin)"', runner)
        self.assertIn('PROBE_SCRIPT_COPY', (ROOT / 'deploy/audit5/private-env.py').read_text())
        self.assertIn('systemctl stop "$shadow_unit"', runner)
        self.assertNotIn('systemctl stop proofofwork-api.service', runner)
        self.assertNotIn('systemctl stop proofofwork-indexer-worker.service', runner)

    def test_inherited_runtime_code_loaders_are_refused(self):
        for overrides in ({b'NODE_OPTIONS': b'--import=/tmp/arbitrary.mjs'}, {b'LD_PRELOAD': b'/tmp/evil.so'}):
            with self.assertRaises(module.Refused):
                module.launch_plan('gate', {**BASE, **overrides}, RELEASE, 'audit:ids')

    def test_bootstrap_and_four_target_repairs_use_fixed_separate_commands(self):
        env, command = module.launch_plan('bootstrap-worker', {**BASE, b'POW_AUDIT5_SHADOW_EXEC': b'1'}, RELEASE)
        self.assertEqual(command, ['scripts/run-proof-indexer-worker.mjs', '--once'])
        self.assertEqual(env[b'POW_API_BASE'], b'http://127.0.0.1:18081')
        self.assertEqual(env[b'POW_INDEX_DATABASE_URL'], BASE[b'POW_INDEX_DATABASE_URL'])
        self.assertNotIn(b'POW_AUDIT5_SHADOW_EXEC', env)
        env, command = module.launch_plan('bootstrap-api', BASE, RELEASE)
        self.assertEqual(command, ['server/proof-api.mjs'])
        self.assertEqual(env[b'HOST'], b'127.0.0.1')
        env, command = module.launch_plan('repair-canonical', BASE, RELEASE)
        self.assertEqual(command, ['scripts/backfill-proof-indexer.mjs', '--repair-canonical-txids'])
        self.assertEqual(env[b'POW_INDEX_REPAIR_CANONICAL_TXIDS'].decode(), module.AUX_TXID)
        env, command = module.launch_plan('repair-atoms', {**BASE, b'POW_INDEX_REPAIR_CANONICAL_TXIDS': b'wrong'}, RELEASE)
        self.assertEqual(command, ['scripts/backfill-proof-indexer.mjs', '--repair-work-atomic-events'])
        self.assertEqual(env[b'POW_INDEX_WORK_ATOMIC_EVENT_REPAIR_APPLY'], b'1')
        self.assertNotIn(b'POW_INDEX_REPAIR_CANONICAL_TXIDS', env)

    def test_gates_preserve_original_url_and_require_private_base_and_strict_parity(self):
        env, command = module.launch_plan('gate', BASE, RELEASE, 'indexer:parity')
        self.assertEqual(env[b'POW_INDEX_DATABASE_URL'], BASE[b'POW_INDEX_DATABASE_URL'])
        self.assertEqual(env[b'POW_INDEX_PARITY_STRICT'], b'1')
        self.assertEqual(env[b'POW_API_BASE'], b'http://127.0.0.1:18081')
        self.assertEqual(command, ['scripts/check-proof-indexer-parity.mjs'])
        for gate in ('sh', 'migrate', 'indexer:audit-work-atoms:repairable'):
            with self.assertRaises(module.Refused):
                module.launch_plan('gate', BASE, RELEASE, gate)
        with self.assertRaises(module.Refused):
            module.launch_plan('gate', BASE, RELEASE, 'audit:ids', 443)

    def test_compound_gate_uses_only_fixed_argv_and_stops_on_first_failure(self):
        expected = [
            ['--test', 'server/db/canonical-transfer-fee.test.mjs'],
            ['scripts/check-index-recovery-behavior.mjs'],
        ]
        env, commands = module.launch_plan('gate', BASE, RELEASE, 'check:index-recovery-behavior')
        self.assertEqual(commands, expected)
        self.assertEqual(env[b'POW_API_BASE'], b'http://127.0.0.1:18081')
        with patch.object(module.subprocess, 'run', side_effect=[
                module.subprocess.CompletedProcess([], 0), module.subprocess.CompletedProcess([], 7)]) as run:
            self.assertEqual(module.run_fixed_sequence(commands, '/candidate', env), 7)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0], [module.NODE, *expected[0]])
        self.assertEqual(run.call_args_list[1].args[0], [module.NODE, *expected[1]])

    def test_all_gate_commands_match_current_package_scripts_and_existing_files(self):
        scripts = json.loads((ROOT / 'package.json').read_text())['scripts']
        for name, argv in module.GATES.items():
            if name in ('check:work-amo-v8', 'check:work-amo-v8-gates'):
                commands = [shlex.split(command.strip()) for command in scripts['check:work-amo-v8'].split('&&')]
                self.assertIn(['node', *argv], commands)
            elif name == 'check:marketplace-regressions:full':
                self.assertEqual(shlex.split(scripts[name]), ['MARKETPLACE_REGRESSION_MODE=full', 'node', *argv])
            else:
                self.assertEqual(shlex.split(scripts[name]), ['node', *argv], name)
            entry = next(argument for argument in argv if argument.endswith('.mjs'))
            self.assertTrue((ROOT / entry).is_file(), name)
        for name, sequence in module.SEQUENCED_GATES.items():
            commands = [shlex.split(command.strip()) for command in scripts[name].split('&&')]
            self.assertEqual(commands, [['node', *argv] for argv in sequence], name)
            entries = [argument for argv in sequence for argument in argv if argument.endswith('.mjs')]
            self.assertTrue(entries)
            self.assertTrue(all((ROOT / entry).is_file() for entry in entries), name)
        parity_source = (ROOT / 'scripts/check-proof-indexer-parity.mjs').read_text()
        self.assertIn('process.env.POW_INDEX_PARITY_STRICT', parity_source)

    def test_runtime_audits_cannot_fall_back_to_live_api_or_write_candidate_reports(self):
        for port in (18081, 8081):
            env, _ = module.launch_plan('gate', {**BASE, b'POW_ID_AUDIT_API_BASE': b'http://127.0.0.1:8081',
                                                 b'POW_ID_AUDIT_WRITE_REPORTS': b'1'}, RELEASE, 'audit:ids', port)
            expected = ('http://127.0.0.1:' + str(port)).encode()
            self.assertEqual(env[b'POW_ID_AUDIT_API_BASE'], expected)
            self.assertEqual(env[b'POW_ID_AUDIT_ADDRESS_API_BASE'], expected)
            self.assertEqual(env[b'POW_ID_AUDIT_PRODUCTION'], b'1')
            self.assertEqual(env[b'POW_ID_AUDIT_WRITE_REPORTS'], b'0')
        for gate in ('audit:ledger', 'audit:computer-events'):
            env, _ = module.launch_plan('gate', {**BASE, b'MAX_LEDGER_TIP_LAG_BLOCKS': b'6'}, RELEASE, gate)
            self.assertEqual(env[b'MAX_LEDGER_TIP_LAG_BLOCKS'], b'0')

    def test_readonly_live_gates_pin_positive_public_fixture_network_and_full_mode(self):
        for port in (18081, 8081):
            for gate in ('check:send-prep-regressions', 'check:marketplace-regressions:full',
                         'check:mail-regressions', 'check:work-participant-regression'):
                env, _ = module.launch_plan('gate', {**BASE, b'POW_NETWORK': b'testnet'}, RELEASE, gate, port)
                self.assertEqual(env[b'POW_API_BASE'], ('http://127.0.0.1:' + str(port)).encode())
                self.assertEqual(env[b'POW_NETWORK'], b'livenet')
                self.assertEqual(env[b'NETWORK'], b'livenet')
                if gate == 'check:send-prep-regressions':
                    self.assertEqual(env[b'POW_SEND_PREP_ADDRESS'], b'19JE7LS6TtQ4uSxu6ivJVZRiJyXXe8qEG3')
                    self.assertEqual(env[b'POW_SEND_PREP_MIN_UTXOS'], b'1')
                if gate == 'check:marketplace-regressions:full':
                    self.assertEqual(env[b'MARKETPLACE_REGRESSION_MODE'], b'full')

    def test_four_target_scope_evidence_and_exact_hash_reject_broader_deficits(self):
        rows = [{'event_id': event_id, 'txid': txid, 'valid': False, 'status': 'confirmed', 'protocol': 'pwt1',
                 'kind': 'token-listing-sealed-invalid', 'amount_sats': 0,
                 'payload': {'amount': '0', 'amountSats': 0, 'attemptedKind': 'seal',
                             'reason': 'work-amo-v6-listing-already-sealed',
                             'reasonCode': 'work-amo-v6-listing-already-sealed',
                             'saleAuthorization': {'version': 'pwt-sale-v8'}}} for event_id, txid in module.EVENTS.items()]
        data = {'format': 'proofofwork-audit5-repair-evidence-v1', 'database': 'proof_indexer', 'otherDatabaseSessions': 0,
                'aux': {'txid': module.AUX_TXID, 'status': 'confirmed', 'height': 962992, 'blockIndex': 1161,
                        'blockHash': '00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b',
                        'rawVin': 6, 'rawVout': 2, 'inputs': [None] * 5, 'outputs': [], 'anchorLinks': [None] * 5},
                'missingZeroMetadataTxids': sorted(module.EVENTS.values()), 'targetEvents': rows}
        blob = json.dumps(data).encode()
        module.validate_repair_evidence(blob, hashlib.sha256(blob).hexdigest())
        for value in ('0', False, None, 0.0):
            data['targetEvents'][0]['payload']['amountSats'] = value
            altered = json.dumps(data).encode()
            with self.assertRaises(module.Refused):
                module.validate_repair_evidence(altered, hashlib.sha256(altered).hexdigest())
        data['targetEvents'][0]['payload']['amountSats'] = 0
        with self.assertRaises(module.Refused):
            module.validate_repair_evidence(blob, '0' * 64)
        data['targetEvents'][0]['payload']['amountSubatoms'] = None
        altered = json.dumps(data).encode()
        with self.assertRaises(module.Refused):
            module.validate_repair_evidence(altered, hashlib.sha256(altered).hexdigest())
        data['targetEvents'][0]['payload'].pop('amountSubatoms')
        data['otherDatabaseSessions'] = 1
        altered = json.dumps(data).encode()
        with self.assertRaises(module.Refused):
            module.validate_repair_evidence(altered, hashlib.sha256(altered).hexdigest())


if __name__ == '__main__':
    unittest.main(verbosity=2)
