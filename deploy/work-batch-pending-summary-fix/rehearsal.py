#!/usr/bin/env python3
"""Qualify the exact API-only pending-summary repair in a read-only VPS service.

The existing reviewed recovery sandbox is pinned below. This helper changes only
its startup tail and adds a non-mutating observation of the confirmed-table
boundary. Both real summary calls and the installed worker's publication guard
must pass. No listener, indexer, publication, runtime write or readiness bypass
is performed; failures retain their original evidence and cannot qualify.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parent.parent
BASE_PATH = HERE.parent / 'work-batch-reader-recovery/rehearsal.py'
BASE_SHA256 = '5e018ea150ca59c8db40d466a42729d17ed44297663f157f56a777fe89c73f4f'
API = 'server/proof-api.mjs'
READER = 'server/db/proof-index-reader.mjs'
WORKER = 'scripts/backfill-proof-indexer.mjs'
POSTGRES = 'server/db/postgres.mjs'
RUNTIME = Path('/opt/proofofwork-api')
FORMAT = 'work-batch-pending-summary-readonly-rehearsal-v1'
QUALIFIED_FORMAT = 'work-batch-pending-summary-rehearsal-qualified-v1'
DISPATCH_FORMAT = 'work-batch-pending-summary-rehearsal-dispatch-v1'
SUMMARY_KEYS = sorted(['growthSummary', 'inceptionSummary', 'infinitySummary', 'logSummary',
                       'marketplaceSummary', 'tokenSummary', 'workFloor', 'workSummary'])
B25 = 'b25e6ae7f963af289ba8cb3edae76ef285d3d124204a0e4cd514df0933938322'
C69 = '69c1720dd6967e9ec035bbe56c5e0fe3b95a00ae721b8312d32f24a520b7b1d5'
PENDING = '8632e39f90e78df86c7bd998aa806b4cdeb9d4b179a0c41e253da0c3a3b84c43'
ADAPTER_NAMES = ('api.mjs', 'reader.mjs', 'worker.mjs', 'postgres.mjs', 'fetch-guard.mjs')
EVIDENCE_NAMES = ('intent.json', 'dispatch.json', 'stdout', 'stderr', *ADAPTER_NAMES)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


base_raw = BASE_PATH.read_bytes()
require(sha(base_raw) == BASE_SHA256, 'Reviewed sandbox source changed')
BASE = {'__name__': '_pinned_pending_summary_sandbox'}
exec(compile(base_raw, str(BASE_PATH), 'exec'), BASE)
save = BASE['save']
environment_files = BASE['environment_files']
require_environment_files = BASE['require_environment_files']
transform_postgres = BASE['transform_postgres']
transform_worker = BASE['transform_worker']
FETCH_GUARD = BASE['FETCH_GUARD']

# Exact committed production expression; no permissive parsing or changed
# filtering condition. The private adapter observes its inputs without mutation.
RETURN = '''  return {
    ...payload,
    ...(Array.isArray(payload.transfers) ? {
      transfers: payload.transfers.filter((item) => item?.confirmed !== false),
    } : {}),
    ...(Array.isArray(payload.transferBatches) ? {
      transferBatches: payload.transferBatches.filter((item) => item?.confirmed !== false),
    } : {}),
  };'''
OBSERVED_RETURN = RETURN.replace('  return {', '  const rehearsalConfirmedPayload = {', 1) + '''
  const rehearsalPendingRows = (payload.transfers ?? []).filter(item =>
    item?.txid === "''' + PENDING + '''" && item?.confirmed === false && isWorkBatchTransferChild(item));
  const rehearsalPendingKeys = rehearsalPendingRows.map(tokenTransferHistoryItemKey);
  globalThis.__pendingSummaryObservations.push({
    txid: "''' + PENDING + '''", inputCount: rehearsalPendingRows.length,
    uniqueKeys: new Set(rehearsalPendingKeys).size,
    preservedCount: (payload.transfers ?? []).filter(item =>
      item?.txid === "''' + PENDING + '''" && item?.confirmed === false && isWorkBatchTransferChild(item)).length,
    canonicalPendingTransfers: (rehearsalConfirmedPayload.transfers ?? []).filter(item => item?.confirmed === false).length,
    canonicalPendingParents: (rehearsalConfirmedPayload.transferBatches ?? []).filter(item => item?.confirmed === false).length,
    identityError: rehearsalPendingKeys.some(key => typeof key !== "string" || !key),
  });
  return rehearsalConfirmedPayload;'''

TAIL = r'''
const rehearsalWorker = await import("../scripts/backfill-proof-indexer.mjs");
const rehearsalStatus = await proofIndexOperationalStatusPayload("livenet");
const rehearsalHeight = Number(rehearsalStatus?.indexedThroughBlock);
const rehearsalHash = String(rehearsalStatus?.scan?.blockHash ?? "");
if (!Number.isSafeInteger(rehearsalHeight) || rehearsalHeight < 973575 ||
    !/^[0-9a-f]{64}$/u.test(rehearsalHash)) throw new Error("Missing rehearsal checkpoint");
function rehearsalFamily(projection, txid, height, count, expectedMiner = null) {
  const parents = (projection?.transferBatches ?? []).filter(row => row.txid === txid);
  const children = (projection?.items ?? []).filter(row => row.txid === txid && row.transferVersion === "batch1");
  const parent = parents[0];
  if (parents.length !== 1 || children.length !== count ||
      parent?.confirmed !== true || parent?.blockHeight !== height || height > rehearsalHeight ||
      parent?.kind !== "token-transfer-batch" || parent?.transferVersion !== "batch1" ||
      Number(parent?.paidSats) !== 546 || Number(parent?.registryMutationFeeSats) !== 546 ||
      Number(parent?.batchRegistryPaymentSats) !== 546 ||
      !Number.isSafeInteger(Number(parent?.minerFeeSats)) || Number(parent.minerFeeSats) < 0 ||
      (expectedMiner !== null && Number(parent.minerFeeSats) !== expectedMiner) ||
      children.some(child => child.confirmed !== true || child.blockHeight !== height ||
        child.rawCandidate !== false || child.economicDelta !== false ||
        child.chargesTransactionFee !== false || child.claimsEconomicOutputs !== false ||
        ["paidSats", "registryMutationFeeSats", "minerFeeSats", "canonicalMinerFeeSats", "attributedMinerFeeSats"]
          .some(key => Number(child[key]) !== 0))) {
    throw new Error("Confirmed family lost its single economic parent or zero-fee children");
  }
  return { txid, height, recipientCount:count, parentCount:1, childCount:count,
    registryPaymentSats:546, minerFeeSats:Number(parent.minerFeeSats), zeroFeeChildren:true };
}
function rehearsalPending(projection, observations) {
  if (!observations.length) throw new Error("Missing actual confirmed-table boundary observation");
  for (const observation of observations) {
    if (observation.identityError || observation.inputCount !== observation.uniqueKeys ||
        observation.inputCount !== observation.preservedCount ||
        ![0, 189].includes(observation.inputCount) || observation.canonicalPendingTransfers !== 0 ||
        observation.canonicalPendingParents !== 0) throw new Error("Pending history or canonical exclusion differs");
  }
  const proof = observations.at(-1);
  const parent = (projection?.transferBatches ?? []).find(row => row.txid === proof.txid);
  if (proof.inputCount === 189) {
    if (parent || (projection?.items ?? []).some(row => row.txid === proof.txid)) {
      throw new Error("Pending incident family entered the canonical projection");
    }
    return {...proof, state:"pending"};
  }
  if (parent) return {...proof, state:"confirmed",
    confirmedFamily:rehearsalFamily(projection, proof.txid, parent.blockHeight, 189)};
  if ((projection?.items ?? []).some(row => row.txid === proof.txid)) {
    throw new Error("Incident family has children without its parent");
  }
  return {...proof, state:"absent"};
}
try {
  const calls = [];
  for (let call = 0; call < 2; call++) {
    globalThis.__pendingSummaryObservations = [];
    const result = await internalCanonicalSummaryPayload("livenet", {
      checkpointHeight:rehearsalHeight, checkpointHash:rehearsalHash,
    });
    const keys = Object.keys(result.summaryPayloads ?? {}).sort();
    const aligned = rehearsalWorker.summaryPayloadsWithAlignedWorkFloor(result.summaryPayloads);
    const publicationAccountingCurrent = rehearsalWorker.canonicalSummaryAccountingModelsCurrent(aligned, {
      workAmountStorageModel:result.workAmountStorageModel,
    });
    if (JSON.stringify(keys) !== JSON.stringify(REHEARSAL_SUMMARY_KEYS) ||
        result.indexedThroughBlock !== rehearsalHeight || result.indexedThroughBlockHash !== rehearsalHash ||
        rehearsalWorker.canonicalSummaryCoverage(aligned) !== rehearsalHeight || !publicationAccountingCurrent ||
        keys.some(key => rehearsalWorker.summaryPayloadSnapshotId(aligned[key]) !== result.snapshotId ||
          aligned[key]?.indexedThroughBlockHash !== rehearsalHash) ||
        (calls.length && calls[0].snapshotId !== result.snapshotId)) {
      throw new Error("Actual worker accounting, checkpoint, snapshot or eight-summary coverage differs");
    }
    const projection = aligned.workSummary?.workTransferValueProjection;
    const knownConfirmedFamilies = [
      rehearsalFamily(projection, "B25_TXID", 973284, 12, 546),
      rehearsalFamily(projection, "C69_TXID", 973567, 7),
    ];
    const pendingHistoryProof = rehearsalPending(projection, globalThis.__pendingSummaryObservations);
    calls.push({ok:true, published:false, publicationAccountingCurrent:true,
      indexedThroughBlock:rehearsalHeight,indexedThroughBlockHash:rehearsalHash,
      snapshotId:result.snapshotId,summaryKeys:keys,knownConfirmedFamilies,pendingHistoryProof});
  }
  console.log(JSON.stringify({format:"work-batch-pending-summary-readonly-rehearsal-v1",
    ...calls[1],twoCalls:true,calls}));
  process.exit(0);
} catch (error) {
  console.error(JSON.stringify({format:"work-batch-pending-summary-readonly-rehearsal-v1",
    ok:false,published:false,indexedThroughBlock:rehearsalHeight,indexedThroughBlockHash:rehearsalHash,
    errorName:String(error?.name ?? "Error").slice(0, 80),
    error:"Read-only summary call or qualification evidence failed"}));
  process.exit(1);
}
'''.replace('B25_TXID', B25).replace('C69_TXID', C69)
TAIL = 'const REHEARSAL_SUMMARY_KEYS = ' + json.dumps(SUMMARY_KEYS) + ';\n' + TAIL


def transform_api(raw):
    transformed = BASE['transform_api'](raw).decode()
    require(transformed.endswith(BASE['TAIL']), 'Reviewed API startup transform differs')
    prefix = transformed[:-len(BASE['TAIL'])]
    start = prefix.find('async function currentProofIndexTokenTablePayloadForLedger(')
    end = prefix.find('\nfunction tokenTablePayloadHasConservedBalances(', start)
    require(start >= 0 and end > start, 'Confirmed-table function boundary differs')
    body = prefix[start:end]
    require(body.count(RETURN) == 1 and prefix.count(RETURN) == 1, 'Confirmed-table return differs')
    body = body.replace(RETURN, OBSERVED_RETURN)
    return (prefix[:start] + body + prefix[end:] + TAIL).encode()


def unit_name(manifest):
    return 'pow-pending-summary-rehearsal-' + manifest['releaseId'] + '.service'


def command(plan, output, properties, files=()):
    result = BASE['command'](plan, output, properties, files)
    result[1] = '--unit=' + unit_name(plan['runtimeManifestTemplate'])
    return result


def validate_family(row, txid, height, count, miner=None):
    require(type(row) is dict and row.get('txid') == txid and row.get('height') == height and
            row.get('recipientCount') == count and row.get('parentCount') == 1 and row.get('childCount') == count and
            row.get('registryPaymentSats') == 546 and row.get('zeroFeeChildren') is True and
            type(row.get('minerFeeSats')) is int and 0 <= row['minerFeeSats'] <= 9007199254740991 and
            (miner is None or row['minerFeeSats'] == miner), 'Confirmed family proof differs')


def validate_pending(proof, checkpoint):
    require(type(proof) is dict and proof.get('txid') == PENDING and proof.get('identityError') is False and
            proof.get('canonicalPendingTransfers') == 0 and proof.get('canonicalPendingParents') == 0,
            'Missing canonical pending exclusion proof')
    state = proof.get('state')
    require(state in ('pending', 'confirmed', 'absent'), 'Unknown incident family state')
    expected = 189 if state == 'pending' else 0
    require(all(type(proof.get(k)) is int and proof[k] == expected for k in
                ('inputCount', 'uniqueKeys', 'preservedCount')), 'Pending identity/count proof differs')
    if state == 'confirmed':
        family = proof.get('confirmedFamily', {})
        require(type(family.get('height')) is int and 973575 <= family['height'] <= checkpoint,
                'Incident confirmation height differs')
        validate_family(family, PENDING, family['height'], 189)
    else:
        require('confirmedFamily' not in proof, 'Unobserved confirmation proof')


def validate_result(result):
    require(type(result) is dict and result.get('format') == FORMAT and result.get('twoCalls') is True and
            type(result.get('calls')) is list and len(result['calls']) == 2,
            'Missing two actual rehearsal calls')
    for call in [result, *result['calls']]:
        require(type(call) is dict and call.get('ok') is True and call.get('published') is False and
                call.get('publicationAccountingCurrent') is True and
                type(call.get('indexedThroughBlock')) is int and call['indexedThroughBlock'] >= 973575 and
                re.fullmatch('[0-9a-f]{64}', call.get('indexedThroughBlockHash', '')) and
                re.fullmatch('[0-9a-f]{24}', call.get('snapshotId', '')) and call.get('summaryKeys') == SUMMARY_KEYS,
                'Canonical rehearsal failed actual worker/eight-summary validation')
        require(all(call[key] == result[key] for key in
                    ('indexedThroughBlock', 'indexedThroughBlockHash', 'snapshotId', 'summaryKeys')),
                'Rehearsal calls changed canonical checkpoint or snapshot')
        families = call.get('knownConfirmedFamilies')
        require(type(families) is list and len(families) == 2, 'Missing confirmed-family proof')
        validate_family(families[0], B25, 973284, 12, 546)
        validate_family(families[1], C69, 973567, 7)
        validate_pending(call.get('pendingHistoryProof'), call['indexedThroughBlock'])
    require(all(result[key] == result['calls'][1][key] for key in
                ('knownConfirmedFamilies', 'pendingHistoryProof')), 'Final call proof differs')
    return result


def read_json(path, limit, ns, expected=None):
    raw = ns['safe_read'](path, limit)
    require(expected is None or sha(raw) == expected, 'Evidence hash differs: ' + str(path))
    return json.loads(raw), raw


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(REPOSITORY), *args], timeout=30, text=True).strip()


def fence(plan, manifest, capture, candidates, ns):
    require(capture['root'] == str(RUNTIME) and capture['controllerSha256'] == plan['controllerSha256'] and
            capture['nodePath'] == plan['nodePath'] and capture['nodeSha256'] == manifest['nodeSha256'] and
            capture['sourceIdentities'] == manifest['sourceIdentities'] and
            capture['sourceParents'] == manifest['sourceParents'] and
            capture['protectedServices'] == manifest['protectedServices'] and
            capture['gateway'] == manifest['gateway'] and
            capture['batchAuthority'] == manifest['batchAuthority'] and
            capture['restartConfigurationSha256'] == manifest['restartConfigurationSha256'] and
            capture['acceptedInventorySha256'] == manifest['acceptedInventorySha256'] and
            {name: row['sha256'] for name, row in capture['sources'].items()} == manifest['dependencies'],
            'Capture and plan closure differ')
    require(git('rev-parse', 'HEAD') == manifest['sourceCommit'] and
            git('rev-parse', 'HEAD^{tree}') == manifest['sourceTree'] and
            git('status', '--porcelain', '--untracked-files=all') == '', 'Rehearsal source checkout changed')
    require(sha(HERE.joinpath('rehearsal.py').read_bytes()) == plan['rehearsalHelperSha256'] and
            sha(HERE.joinpath('release.py').read_bytes()) == plan['releaseToolSha256'] and
            sha(HERE.joinpath('scoped-node.py').read_bytes()) == plan['controllerSha256'] and
            sha(HERE.joinpath('rollout-node.py').read_bytes()) == plan['rolloutSupervisorSha256'],
            'Committed operation tools differ')
    ns['accepted_inventory_fence'](manifest['acceptedInventorySha256'])
    ns['require_restart_configuration'](manifest['restartConfigurationSha256'])
    ns['fence'](RUNTIME, manifest, candidates)
    ns['metadata_fence'](RUNTIME, manifest['sourceMetadata'])
    ns['source_identity_fence'](RUNTIME, manifest)
    ns['require_protected_services'](manifest['protectedServices'])
    ns['require_gateway_baseline'](ns['gateway_states'](), manifest['gateway'])
    for unit, expected in manifest['gateway']['files'].items():
        require(sha(ns['safe_read'](Path('/etc/systemd/system') / unit, 65536)) == expected, 'Gateway unit changed')
    live_head = subprocess.check_output(['/usr/bin/git', '-c', 'safe.directory=' + str(RUNTIME),
        '-C', str(RUNTIME), 'rev-parse', 'HEAD'], text=True, timeout=30).strip()
    require(live_head == manifest['baselineHead'] == capture['baselineHead'], 'Runtime Git identity changed')
    require(ns['states'](ns['AUTHORITY']) == capture['authority'], 'Core/Electrum/PostgreSQL authority changed')
    require(ns['states'](ns['SEARCH']) == capture['search'] and not os.path.lexists(ns['HOLD']),
            'Search state or hold changed')
    for unit, expected in capture['searchFiles'].items():
        require(sha(ns['safe_read'](Path('/etc/systemd/system') / unit, 65536)) == expected,
                'Search unit changed')
    require(ns['batch_authority']() == manifest['batchAuthority'], 'Original batch declaration changed')
    require(sha(ns['safe_read'](Path(plan['nodePath']), 200 * 1024**2)) == manifest['nodeSha256'],
            'Node executable changed')


def adapters(candidates, ns):
    require(set(candidates) == {API}, 'Rehearsal is API-only')
    return {'api.mjs': transform_api(candidates[API]),
            'reader.mjs': ns['safe_read'](RUNTIME / READER),
            'worker.mjs': transform_worker(ns['safe_read'](RUNTIME / WORKER)),
            'postgres.mjs': transform_postgres(ns['safe_read'](RUNTIME / POSTGRES)),
            'fetch-guard.mjs': FETCH_GUARD.encode()}


def native_state(unit, ns):
    keys = ('LoadState', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'MainPID', 'InvocationID',
            'ProtectSystem', 'NoNewPrivileges', 'ReadWritePaths', 'User', 'WorkingDirectory',
            'BindReadOnlyPaths', 'ExecStart', 'EnvironmentFiles', 'MemoryMax', 'MemorySwapMax',
            'CPUQuotaPerSecUSec', 'RuntimeMaxUSec', 'TimeoutStopUSec', 'KillMode', 'RemainAfterExit')
    return {key: ns['ctl']('show', unit, '--value', '-p', key) for key in keys}


def validate_native(state, plan, output, expected_files):
    require(state['LoadState'] == 'loaded' and state['ActiveState'] == 'active' and state['SubState'] == 'exited' and
            state['Result'] == 'success' and state['ExecMainStatus'] == '0' and state['MainPID'] == '0' and
            re.fullmatch('[0-9a-f]{32}', state['InvocationID']) and state['ProtectSystem'] == 'strict' and
            state['NoNewPrivileges'] == 'yes' and state['ReadWritePaths'] == '' and state['User'] == 'powadmin' and
            state['WorkingDirectory'] == str(RUNTIME) and state['MemoryMax'] == str(2 * 1024**3) and
            state['MemorySwapMax'] == '0' and state['CPUQuotaPerSecUSec'] == '1s' and
            state['RuntimeMaxUSec'] == '5min' and state['TimeoutStopUSec'] == '15s' and
            state['KillMode'] == 'control-group' and state['RemainAfterExit'] == 'yes',
            'Native rehearsal did not terminate successfully in the reviewed sandbox')
    require_environment_files(state['EnvironmentFiles'], expected_files)
    binds = state['BindReadOnlyPaths'].split()
    expected = {str(output / name) + ':' + str(RUNTIME / target) for name, target in
                [('api.mjs', API), ('reader.mjs', READER), ('worker.mjs', WORKER), ('postgres.mjs', POSTGRES)]}
    require(len(binds) == 4 and all(len(value.split(':')) in (2, 3) and
            (len(value.split(':')) == 2 or value.split(':')[2] == 'rbind') for value in binds) and
            {':'.join(value.split(':')[:2]) for value in binds} == expected, 'Private source binds differ')
    expected_argv = ' ; argv[]=' + ' '.join(command(plan, output, {})[-4:]) + ' ; ignore_errors=no'
    require(expected_argv in state['ExecStart'], 'Native rehearsal command differs')


def qualified_receipt(args, plan, manifest, capture, candidates, ns):
    output = args.output
    expected = adapters(candidates, ns)
    for name, raw in expected.items():
        require(ns['safe_read'](output / name) == raw and stat.S_IMODE((output / name).lstat().st_mode) == 0o644,
                'Rehearsal adapter bytes/readability changed: ' + name)
    dispatch, dispatch_raw = read_json(output / 'dispatch.json', 65536, ns)
    intent, _ = read_json(output / 'intent.json', 65536, ns)
    identity = {'format': DISPATCH_FORMAT, 'planSha256': args.plan_sha256,
                'sourceCommit': manifest['sourceCommit'], 'sourceTree': manifest['sourceTree'],
                'releaseId': manifest['releaseId'], 'rehearsalHelperSha256': plan['rehearsalHelperSha256'],
                'candidateHashes': {name: sha(raw) for name, raw in candidates.items()},
                'dependencyHashes': manifest['dependencies'],
                'adapterHashes': {name: sha(raw) for name, raw in expected.items()},
                'unit': unit_name(manifest), 'published': False, 'productionSourceMutation': False}
    require(all(intent.get(key) == value and dispatch.get(key) == value for key, value in identity.items()) and
            dispatch.get('dispatchExitCode') == 0 and
            re.fullmatch('[0-9a-f]{32}', dispatch.get('invocationId', '')),
            'Rehearsal intent or dispatch differs')
    state = native_state(identity['unit'], ns)
    validate_native(state, plan, output, ns['ctl']('show', 'proofofwork-api.service', '--value', '-p', 'EnvironmentFiles'))
    require(state['InvocationID'] == dispatch['invocationId'], 'Native invocation changed')
    stdout = ns['safe_read'](output / 'stdout', 8 * 1024**2)
    results = []
    for line in stdout.decode().splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get('format') == FORMAT:
            results.append(value)
    require(len(results) == 1, 'Missing or ambiguous rehearsal result')
    result = validate_result(results[0])
    fence(plan, manifest, capture, candidates, ns)
    refs = {}
    for name in EVIDENCE_NAMES:
        raw = ns['safe_read'](output / name, 8 * 1024**2)
        refs[name] = {'path': str(output / name), 'sha256': sha(raw), 'bytes': len(raw)}
    receipt = {**identity, 'format': QUALIFIED_FORMAT, 'qualified': True, 'invocationId': state['InvocationID'],
               'nativeProperties': state, 'result': result, 'dispatchSha256': sha(dispatch_raw),
               'stdoutSha256': sha(stdout), 'evidenceReferences': refs}
    ns['validate_rehearsal'](receipt, args.plan_sha256, manifest, plan['rehearsalHelperSha256'])
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan', type=Path)
    parser.add_argument('plan_sha256')
    parser.add_argument('output', type=Path)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    require(os.geteuid() == 0 and sys.flags.isolated and RUNTIME.is_dir(), 'Run root python3 -I -B on NODE')
    require(args.output.is_absolute() and args.output.resolve() == args.output and
            str(args.output).startswith('/tmp/proofofwork-') and
            (args.output.is_dir() if args.verify else not os.path.lexists(args.output)), 'Unsafe/fresh output required')
    parent = args.output if args.verify else args.output.parent
    while parent != Path('/tmp'):
        info = parent.lstat()
        require(parent.resolve() == parent and stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
                not info.st_mode & (0o077 if parent == args.output else 0o022), 'Unsafe rehearsal directory')
        parent = parent.parent
    plan_raw = args.plan.read_bytes()
    require(len(plan_raw) <= 20 * 1024**2 and sha(plan_raw) == args.plan_sha256, 'Plan differs')
    plan = json.loads(plan_raw)
    require(plan['format'] == 'proof-of-work-work-batch-pending-summary-fix-rollout-plan-v1', 'Wrong plan')
    code = base64.b64decode(plan['controllerBase64'], validate=True)
    require(sha(code) == plan['controllerSha256'] and code == (HERE / 'scoped-node.py').read_bytes(),
            'Committed controller differs')
    ns = {'__name__': '_pending_summary_rehearsal_controller'}
    exec(compile(code, 'scoped-node.py', 'exec'), ns)
    manifest = plan['runtimeManifestTemplate']
    require(all(plan[key] == manifest[key] for key in ('sourceCommit', 'sourceTree', 'releaseId')), 'Plan identity differs')
    capture, _ = read_json(args.capture, 100 * 1024**2, ns, plan['captureSha256'])
    require(capture['format'] == 'proof-of-work-work-batch-pending-summary-fix-runtime-capture-v1', 'Wrong capture')
    candidates = ns['validate_manifest'](manifest)
    fence(plan, manifest, capture, candidates, ns)
    if args.verify:
        receipt = qualified_receipt(args, plan, manifest, capture, candidates, ns)
        raw = (json.dumps(receipt, indent=2) + '\n').encode()
        save(args.output / 'qualification.json', raw)
        print(json.dumps({'qualification': str(args.output / 'qualification.json'), 'sha256': sha(raw),
                          'qualified': True, 'checkpoint': receipt['result']['indexedThroughBlock'], 'published': False}))
        return
    unit = unit_name(manifest)
    require(ns['ctl']('show', unit, '--value', '-p', 'LoadState') == 'not-found', 'Rehearsal unit already exists')
    expected = adapters(candidates, ns)
    os.umask(0o077)
    args.output.mkdir(mode=0o700)
    for name, raw in expected.items():
        save(args.output / name, raw, 0o644)
        subprocess.run([plan['nodePath'], '--check', str(args.output / name)], check=True,
                       capture_output=True, timeout=30)
    props = {key: ns['ctl']('show', 'proofofwork-api.service', '--value', '-p', key)
             for key in ('Environment', 'PassEnvironment', 'UnsetEnvironment')}
    files = environment_files(ns['ctl']('show', 'proofofwork-api.service', '--value', '-p', 'EnvironmentFiles'))
    fence(plan, manifest, capture, candidates, ns)
    intent = {'format': DISPATCH_FORMAT, 'planSha256': args.plan_sha256,
              'sourceCommit': manifest['sourceCommit'], 'sourceTree': manifest['sourceTree'],
              'releaseId': manifest['releaseId'], 'rehearsalHelperSha256': plan['rehearsalHelperSha256'],
              'candidateHashes': {name: sha(raw) for name, raw in candidates.items()},
              'dependencyHashes': manifest['dependencies'], 'adapterHashes': {name: sha(raw) for name, raw in expected.items()},
              'unit': unit, 'published': False, 'productionSourceMutation': False}
    save(args.output / 'intent.json', (json.dumps(intent, indent=2) + '\n').encode())
    # Inherited environment values stay in memory, never in argv evidence/receipts.
    result = subprocess.run(command(plan, args.output, props, files), capture_output=True, timeout=30)
    save(args.output / 'dispatch.stdout', result.stdout)
    save(args.output / 'dispatch.stderr', result.stderr)
    invocation = ns['ctl']('show', unit, '--value', '-p', 'InvocationID') if result.returncode == 0 else ''
    dispatch = {**intent, 'dispatchExitCode': result.returncode, 'invocationId': invocation}
    save(args.output / 'dispatch.json', (json.dumps(dispatch, indent=2) + '\n').encode())
    require(result.returncode == 0 and re.fullmatch('[0-9a-f]{32}', invocation),
            'Rehearsal dispatch failed; preserve evidence without retry')
    print(json.dumps({'unit': unit, 'invocationId': invocation, 'output': str(args.output),
                      'dispatched': True, 'published': False}))


if __name__ == '__main__':
    main()
