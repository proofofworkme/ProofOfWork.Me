#!/usr/bin/env python3
"""Run a reviewed recovery candidate's summary without changing live source or data.

VPS only. The production controller's exact predecessor, source, configuration,
dependency and inode fences still apply. Private bind mounts expose the two
candidate files only to this transient service. PostgreSQL starts read-only,
the query guard disallows writes/session escapes, RPC methods are read-only,
and the service filesystem is read-only. No API listener or startup jobs run.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

API = 'server/proof-api.mjs'
READER = 'server/db/proof-index-reader.mjs'
POSTGRES = 'server/db/postgres.mjs'
RUNTIME = Path('/opt/proofofwork-api')
FOOTER = '\nif (isMainThread) {\nserver.listen(PORT, HOST, () => {'
TAIL = '''
const rehearsalStatus = await proofIndexOperationalStatusPayload("livenet");
const rehearsalHeight = Number(rehearsalStatus?.indexedThroughBlock);
const rehearsalHash = String(rehearsalStatus?.scan?.blockHash ?? "");
if (!Number.isSafeInteger(rehearsalHeight) || rehearsalHeight < 973284 ||
    !/^[0-9a-f]{64}$/u.test(rehearsalHash)) throw new Error("Missing rehearsal checkpoint");
try {
  const result = await internalCanonicalSummaryPayload("livenet", {
    checkpointHeight: rehearsalHeight, checkpointHash: rehearsalHash,
  });
  const keys = Object.keys(result.summaryPayloads ?? {}).sort();
  if (keys.length !== 8 || result.indexedThroughBlock !== rehearsalHeight ||
      result.indexedThroughBlockHash !== rehearsalHash) {
    throw new Error("Rehearsal summary checkpoint or coverage differs");
  }
  console.log(JSON.stringify({ format: "work-batch-summary-readonly-rehearsal-v1",
    ok: true, published: false, indexedThroughBlock: rehearsalHeight,
    indexedThroughBlockHash: rehearsalHash, snapshotId: result.snapshotId,
    summaryKeys: keys }));
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({ format: "work-batch-summary-readonly-rehearsal-v1",
    ok: false, published: false, indexedThroughBlock: rehearsalHeight,
    indexedThroughBlockHash: rehearsalHash,
    error: String(error?.message ?? error).slice(0, 4000) }));
  process.exit(1);
}
'''
QUERY_GUARD = r'''
function rehearsalReadOnlySql(query) {
  const text = typeof query === "string" ? query : query?.text;
  if (typeof text !== "string") throw new Error("Rehearsal SQL has no text");
  const sql = text.replace(/'(?:''|[^'])*'/gu, "''")
    .replace(/"(?:""|[^"])*"/gu, '""')
    .replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//gu, " ").trim();
  if (/^(?:BEGIN(?: TRANSACTION)?(?: ISOLATION LEVEL REPEATABLE READ)?(?: READ ONLY)?|COMMIT|ROLLBACK);?$/iu.test(sql)) return;
  if (/^SET LOCAL (?:search_path\s*=\s*pg_catalog,\s*pg_temp|(?:statement_timeout|lock_timeout|idle_in_transaction_session_timeout)\s*=\s*(?:''|\d+));?$/iu.test(sql)) return;
  if (!/^(?:SELECT|WITH)\b/iu.test(sql) || /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|RESET|VACUUM|ANALYZE|LOCK|LISTEN|NOTIFY|UNLISTEN|INTO)\b/iu.test(sql) ||
      /\b(?:set_config|pg_advisory_lock|pg_advisory_xact_lock|lo_import|lo_export|dblink_exec)\s*\(/iu.test(sql)) {
    throw new Error("Rehearsal rejected a non-read-only SQL statement");
  }
}
const rehearsalOriginalQuery = pg.Client.prototype.query;
const rehearsalOriginalConnect = pg.Client.prototype.connect;
function rehearsalCheckConnection(client, callback) {
  rehearsalOriginalQuery.call(client, "SHOW transaction_read_only", (error, result) => {
    callback(error ?? (result?.rows?.[0]?.transaction_read_only === "on" ? null :
      new Error("Rehearsal database connection is not read-only")));
  });
}
pg.Client.prototype.connect = function(callback) {
  if (callback) return rehearsalOriginalConnect.call(this, error => {
    if (error) return callback(error);
    rehearsalCheckConnection(this, callback);
  });
  return rehearsalOriginalConnect.call(this).then(() => new Promise((resolve, reject) =>
    rehearsalCheckConnection(this, error => error ? reject(error) : resolve())));
};
pg.Client.prototype.query = function(query, ...args) {
  rehearsalReadOnlySql(query);
  return rehearsalOriginalQuery.call(this, query, ...args);
};
'''
FETCH_GUARD = r'''
const originalFetch = globalThis.fetch;
const rpcMethods = new Set(["getblockchaininfo", "getblockhash", "getblock", "getblockheader",
  "getrawtransaction", "gettxout", "gettxoutsetinfo", "getmempoolentry", "getrawmempool",
  "getmempoolinfo", "getnetworkinfo", "getindexinfo", "estimatesmartfee"]);
globalThis.fetch = async (input, init = {}) => {
  const method = String(init.method ?? input?.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const rpc = new URL(process.env.BITCOIN_RPC_URL);
    if (method !== "POST" || target.href !== rpc.href) throw new Error("Rehearsal rejected a network mutation");
    const payload = JSON.parse(init.body);
    const rows = Array.isArray(payload) ? payload : [payload];
    if (!rows.length || rows.some(row => !rpcMethods.has(row?.method))) {
      throw new Error("Rehearsal rejected a non-read-only RPC method");
    }
  }
  return originalFetch(input, { ...init, redirect: "error" });
};
'''


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


def transform_api(raw):
    source = raw.decode('utf-8')
    require(source.count(FOOTER) == 1, 'API startup footer is not unique')
    prefix, footer = source.split(FOOTER)
    require(footer.endswith('\n}\n') and
            'startPendingBaseValidationWorker(parentPort, pendingWorkVerifierStageConfirmedBase);' in footer and
            'throw new Error("Unsupported API worker entrypoint.");' in footer,
            'API startup footer changed')
    require('server.listen(' not in prefix, 'Another API listener exists')
    return (prefix + '\n' + TAIL).encode()


def transform_postgres(raw):
    source = raw.decode('utf-8')
    anchor = 'const { Pool } = pg;'
    option = 'options: "-c search_path=pg_catalog,\\\\ pg_temp",'
    require(source.count(anchor) == 1 and source.count(option) == 1,
            'PostgreSQL connection source changed')
    source = source.replace(anchor, anchor + '\n' + QUERY_GUARD)
    source = source.replace(option, 'options: "-c search_path=pg_catalog,\\\\ pg_temp -c default_transaction_read_only=on",')
    return source.encode()


def save(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def environment_files(value):
    pattern = r'(/[^\s]+) \(ignore_errors=no\)'
    require(not re.sub(pattern, '', value).strip(), 'Unsupported environment file configuration')
    return re.findall(pattern, value)


def require_environment_files(actual, expected):
    require(environment_files(actual) == environment_files(expected),
            'Rehearsal inherited environment file order or paths differ')


def command(plan, output, service_properties, inherited_files=()):
    manifest = plan['runtimeManifestTemplate']
    unit = 'pow-batch-summary-rehearsal-' + manifest['releaseId']
    args = ['systemd-run', '--unit=' + unit, '--service-type=exec']
    properties = {
        'User': 'powadmin', 'Group': 'powadmin', 'WorkingDirectory': str(RUNTIME),
        'CPUQuota': '100%', 'MemoryMax': '2G', 'MemorySwapMax': '0',
        'Nice': '15', 'IOSchedulingClass': 'idle', 'RuntimeMaxSec': '300',
        'TimeoutStopSec': '15', 'KillMode': 'control-group', 'RemainAfterExit': 'yes',
        'ProtectSystem': 'strict', 'ProtectHome': 'true', 'PrivateDevices': 'true',
        'NoNewPrivileges': 'true', 'CapabilityBoundingSet': '',
        'RestrictSUIDSGID': 'true', 'ProtectKernelTunables': 'true',
        'ProtectKernelModules': 'true', 'ProtectControlGroups': 'true',
        'RestrictNamespaces': 'true', 'RestrictAddressFamilies': 'AF_UNIX AF_INET AF_INET6',
        'StandardOutput': 'file:' + str(output / 'stdout'),
        'StandardError': 'file:' + str(output / 'stderr'),
        **service_properties,
        'BindReadOnlyPaths': ' '.join([
            str(output / 'api.mjs') + ':' + str(RUNTIME / API),
            str(output / 'postgres.mjs') + ':' + str(RUNTIME / POSTGRES),
            str(output / 'reader.mjs') + ':' + str(RUNTIME / READER),
        ]),
    }
    for key, value in properties.items():
        args.append('--property=' + key + '=' + value)
    # systemd-run treats each EnvironmentFile property as one filename.
    for path in inherited_files:
        args.append('--property=EnvironmentFile=' + path)
    for key in ['ENABLE_STARTUP_EXPENSIVE_PREWARM', 'ENABLE_API_LEDGER_BACKGROUND_REFRESH',
                'ENABLE_SUMMARY_TOKEN_REFRESH', 'ENABLE_REQUEST_LEDGER_RECOVERY']:
        args.append('--setenv=' + key + '=0')
    args += [plan['nodePath'], '--import',
             'data:text/javascript;base64,' + base64.b64encode(FETCH_GUARD.encode()).decode(), str(RUNTIME / API)]
    return args


def qualify(args, plan, manifest, candidates, ns):
    output = args.output
    require(output.is_dir() and output.stat().st_uid == 0 and not output.stat().st_mode & 0o077,
            'Unsafe rehearsal evidence directory')
    dispatch_raw = ns['safe_read'](output / 'dispatch.json', 65536)
    dispatch = json.loads(dispatch_raw)
    expected_hashes = {name: sha(value) for name, value in candidates.items()}
    require(dispatch['dispatchExitCode'] == 0 and dispatch['planSha256'] == args.plan_sha256 and
            dispatch['sourceCommit'] == manifest['sourceCommit'] and
            dispatch['releaseId'] == manifest['releaseId'] and dispatch['candidateHashes'] == expected_hashes and
            dispatch['published'] is False and dispatch['productionSourceMutation'] is False,
            'Rehearsal dispatch identity differs')
    expected_adapters = {'api.mjs': transform_api(candidates[API]),
                         'postgres.mjs': transform_postgres(ns['safe_read'](RUNTIME / POSTGRES)),
                         'fetch-guard.mjs': FETCH_GUARD.encode(), 'reader.mjs': candidates[READER]}
    for name, raw in expected_adapters.items():
        require(ns['safe_read'](output / name) == raw, 'Rehearsal source changed: ' + name)
    require(dispatch['adapterHashes'] == {name: sha(expected_adapters[name]) for name in
                                         ['api.mjs', 'postgres.mjs', 'fetch-guard.mjs']},
            'Rehearsal adapter hashes differ')
    unit = 'pow-batch-summary-rehearsal-' + manifest['releaseId'] + '.service'
    state = {key: ns['ctl']('show', unit, '--value', '-p', key) for key in
             ['ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'MainPID', 'InvocationID',
              'ProtectSystem', 'NoNewPrivileges', 'ReadWritePaths', 'User', 'WorkingDirectory',
              'BindReadOnlyPaths', 'ExecStart', 'EnvironmentFiles']}
    require(state['ActiveState'] == 'active' and state['SubState'] == 'exited' and
            state['Result'] == 'success' and state['ExecMainStatus'] == '0' and state['MainPID'] == '0' and
            re.fullmatch('[0-9a-f]{32}', state['InvocationID']) and state['ProtectSystem'] == 'strict' and
            state['NoNewPrivileges'] == 'yes' and state['ReadWritePaths'] == '' and
            state['User'] == 'powadmin' and state['WorkingDirectory'] == str(RUNTIME),
            'Rehearsal is not a successful terminal read-only execution')
    require_environment_files(state['EnvironmentFiles'],
        ns['ctl']('show', 'proofofwork-api.service', '--value', '-p', 'EnvironmentFiles'))
    expected_binds = {str(output / name) + ':' + str(RUNTIME / target) for name, target in
                      [('api.mjs', API), ('postgres.mjs', POSTGRES), ('reader.mjs', READER),
                       ]}
    actual_binds = state['BindReadOnlyPaths'].split()
    require(all(len(value.split(':')) in (2, 3) and
                (len(value.split(':')) == 2 or value.split(':')[2] == 'rbind') for value in actual_binds) and
            {':'.join(value.split(':')[:2]) for value in actual_binds} == expected_binds and
            len(actual_binds) == len(expected_binds),
            'Rehearsal private source mounts differ')
    expected_argv = ' ; argv[]=' + ' '.join(command(plan, output, {})[-4:]) + ' ; ignore_errors=no'
    require(expected_argv in state['ExecStart'], 'Rehearsal command differs')
    stdout = ns['safe_read'](output / 'stdout', 8 * 1024**2)
    results = []
    for line in stdout.decode().splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get('format') == 'work-batch-summary-readonly-rehearsal-v1':
            results.append(value)
    require(len(results) == 1, 'Missing or ambiguous rehearsal result')
    result = results[0]
    require(result.get('ok') is True and result.get('published') is False and
            type(result.get('indexedThroughBlock')) is int and result['indexedThroughBlock'] >= 973284 and
            re.fullmatch('[0-9a-f]{64}', result.get('indexedThroughBlockHash', '')) and
            re.fullmatch('[0-9a-f]{24}', result.get('snapshotId', '')) and
            result.get('summaryKeys') == sorted(['growthSummary', 'inceptionSummary', 'infinitySummary',
                'logSummary', 'marketplaceSummary', 'tokenSummary', 'workFloor', 'workSummary']),
            'Canonical rehearsal did not validate all eight summaries')
    receipt = {'format': 'work-batch-summary-rehearsal-qualified-v1', 'qualified': True,
               'planSha256': args.plan_sha256, 'sourceCommit': manifest['sourceCommit'],
               'releaseId': manifest['releaseId'], 'candidateHashes': expected_hashes,
               'predecessor': manifest['predecessor'], 'unit': unit,
               'invocationId': state['InvocationID'], 'result': result,
               'dispatchSha256': sha(dispatch_raw), 'stdoutSha256': sha(stdout),
               'adapterHashes': dispatch['adapterHashes']}
    raw = (json.dumps(receipt, indent=2) + '\n').encode()
    save(output / 'qualification.json', raw)
    print(json.dumps({'qualification': str(output / 'qualification.json'), 'sha256': sha(raw),
                      'qualified': True, 'checkpoint': result['indexedThroughBlock'], 'published': False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('plan_sha256')
    parser.add_argument('output', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0 and sys.flags.isolated and RUNTIME.is_dir(), 'Run root python3 -I -B on the node')
    require(args.output.is_absolute() and args.output.resolve() == args.output and
            str(args.output).startswith('/tmp/proofofwork-') and
            (args.output.is_dir() if args.verify else not os.path.lexists(args.output)),
            'Rehearsal requires a new private VPS output directory')
    parent = args.output.parent
    while parent != Path('/tmp'):
        info = parent.lstat()
        require(parent.resolve() == parent and info.st_uid == 0 and not info.st_mode & 0o022,
                'Unsafe rehearsal parent')
        parent = parent.parent
    raw = args.plan.read_bytes()
    require(len(raw) <= 20 * 1024**2 and sha(raw) == args.plan_sha256, 'Rehearsal plan differs')
    plan = json.loads(raw)
    require(plan['format'] == 'proof-of-work-work-batch-reader-recovery-rollout-plan-v1', 'Wrong recovery plan')
    code = base64.b64decode(plan['controllerBase64'], validate=True)
    require(sha(code) == plan['controllerSha256'], 'Recovery controller differs')
    ns = {'__name__': '_rehearsal_controller'}
    exec(compile(code, 'scoped-node.py', 'exec'), ns)
    manifest = plan['runtimeManifestTemplate']
    candidates = ns['validate_manifest'](manifest)
    ns['predecessor_fence'](manifest['predecessor'])
    ns['require_apps_drained']()
    ns['require_restart_configuration'](manifest['restartConfigurationSha256'])
    ns['fence'](RUNTIME, manifest, candidates)
    require(sha(Path(plan['nodePath']).read_bytes()) == manifest['nodeSha256'], 'Node binary changed')
    if args.verify:
        qualify(args, plan, manifest, candidates, ns)
        return
    api = transform_api(candidates[API])
    postgres = transform_postgres(ns['safe_read'](RUNTIME / POSTGRES))
    os.umask(0o077)
    args.output.mkdir(mode=0o700)
    for name, data in [('api.mjs', api), ('postgres.mjs', postgres),
                       ('reader.mjs', candidates[READER]), ('fetch-guard.mjs', FETCH_GUARD.encode())]:
        save(args.output / name, data, 0o644)
        subprocess.run([plan['nodePath'], '--check', str(args.output / name)], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    props = {key: ns['ctl']('show', 'proofofwork-api.service', '--value', '-p', key)
             for key in ['Environment', 'PassEnvironment', 'UnsetEnvironment']}
    files = ns['ctl']('show', 'proofofwork-api.service', '--value', '-p', 'EnvironmentFiles')
    inherited_files = environment_files(files)
    ns['require_restart_configuration'](manifest['restartConfigurationSha256'])
    invocation = command(plan, args.output, props, inherited_files)
    receipt = {'format': 'work-batch-summary-rehearsal-dispatch-v1', 'planSha256': sha(raw),
               'sourceCommit': manifest['sourceCommit'], 'releaseId': manifest['releaseId'],
               'candidateHashes': {name: sha(value) for name, value in candidates.items()},
               'adapterHashes': {name: sha((args.output / name).read_bytes()) for name in
                                ['api.mjs', 'postgres.mjs', 'fetch-guard.mjs']},
               'published': False, 'productionSourceMutation': False}
    save(args.output / 'intent.json', (json.dumps(receipt, indent=2) + '\n').encode())
    # The complete invocation contains inherited service environment values.
    # Keep it in memory; never print or persist it in a receipt.
    result = subprocess.run(invocation, capture_output=True, timeout=30)
    save(args.output / 'dispatch.stdout', result.stdout)
    save(args.output / 'dispatch.stderr', result.stderr)
    save(args.output / 'dispatch.json', (json.dumps({**receipt, 'dispatchExitCode': result.returncode}) + '\n').encode())
    require(result.returncode == 0, 'Rehearsal dispatch failed; inspect VPS evidence without retrying')
    print(json.dumps({'output': str(args.output), 'unit': 'pow-batch-summary-rehearsal-' + manifest['releaseId'],
                      'dispatched': True, 'published': False}))


if __name__ == '__main__':
    main()
