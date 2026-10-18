#!/usr/bin/env python3
"""Explicit reconciliation of an authenticated pre-intent custody refusal.

Planning is read-only. Applying retires only the unchanged qualified custody
scope and completes its existing ordinary-complete cycle. It never prepares,
exports, applies ordinary cleanup, or substitutes an installed controller.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'deploy/ui-retention'
APPROVAL = 'df166edb2d9817dd4f8af24819880b6bf08b396b6aa483adaa141415fc709379'


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module
    spec.loader.exec_module(module); return module


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def require(ok, message):
    if not ok: raise ValueError(message)


def helpers():
    installer = load('reconcile_installer', HERE / 'install_lifecycle.py')
    local = load('reconcile_local', HERE / 'lifecycle.py')
    custody = local.custody_module()
    return installer, local, custody


def local_read(path, installer, expected=None):
    """Repository group-write is normal; private custody retains stricter rules."""
    path = Path(path)
    if ROOT not in path.parents:
        return installer.read_bound(path, expected)
    before = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(before.st_mode)
            and before.st_uid == os.geteuid() and before.st_nlink == 1
            and not before.st_mode & 0o7002 and before.st_size <= installer.MAX_EVIDENCE,
            'Unsafe repository evidence/source path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    try:
        require(os.fstat(fd) == before, 'Repository source identity changed')
        with os.fdopen(fd, 'rb', closefd=False) as stream: raw = stream.read(installer.MAX_EVIDENCE + 1)
        require(len(raw) == before.st_size and os.fstat(fd) == before and path.lstat() == before,
                'Repository source changed during read')
    finally: os.close(fd)
    require(expected is None or re.fullmatch('[0-9a-f]{64}', expected) and sha(raw) == expected,
            'Repository evidence SHA differs')
    return raw


def binding(path, installer):
    raw = installer.read_bound(path)
    return {'path': str(Path(path).resolve()), 'sha256': sha(raw), 'bytes': len(raw)}


def committed_sources(installer, custody):
    paths = sorted(set([*custody.SOURCES.values(), 'deploy/ui-retention/custody.py',
                        'deploy/ui-retention/lifecycle.py', 'deploy/ui-retention/install_lifecycle.py',
                        'deploy/ui-retention/reconcile_custody.py']))
    git = lambda *args: subprocess.check_output(['git', '-C', str(ROOT), *args])
    require(not git('status', '--porcelain', '--untracked-files=no'), 'Commit reviewed source before reconciliation')
    commit = git('rev-parse', 'HEAD').decode().strip(); tree = git('rev-parse', 'HEAD^{tree}').decode().strip()
    pins = []
    for path in paths:
        raw = local_read(ROOT / path, installer)
        require(git('show', commit + ':' + path) == raw, 'Uncommitted reconciliation source: ' + path)
        pins.append({'path': path, 'sha256': sha(raw)})
    return {'commit': commit, 'tree': tree, 'files': pins}


def read_local(refusal_binding, installer, custody):
    refusal = json.loads(local_read(refusal_binding['path'], installer, refusal_binding['sha256']))
    require(refusal.get('schema') == 'pow-ui-custody-preintent-refusal-v1'
            and refusal.get('scopeApprovalSha256') == APPROVAL
            and refusal.get('disposition') == 'authenticated-pre-intent-refusal'
            and refusal.get('directStderrAvailable') is False, 'Unsupported refusal authority')
    require(refusal['state']['pendingStage'] == 'ordinary-complete'
            and refusal['state']['status'] == 'retention-incomplete'
            and refusal['process']['exitCode'] != 0, 'Refusal does not identify the completed ordinary phase')
    require(refusal['config']['path'] == installer.CONFIG and refusal['state']['path'] == installer.STATE
            and re.fullmatch('[0-9a-f]{64}', refusal['config']['sha256'])
            and re.fullmatch('[0-9a-f]{64}', refusal['state']['sha256'])
            and re.fullmatch('[0-9a-f]{64}', refusal['pendingToken']), 'Refusal config/state identity differs')
    for bound in [*refusal['evidence'], refusal['process']['log']]:
        installer.read_bound(bound['path'], bound['sha256'])
    qualified = refusal['qualifiedPlan']; plan_raw = installer.read_bound(qualified['path'], qualified['sha256'])
    plan = json.loads(plan_raw); require(encoded(plan) == plan_raw, 'Qualified plan is not canonical')
    prepared = json.loads(installer.read_bound(refusal['prepared']['path'], refusal['prepared']['sha256']))
    applied = json.loads(installer.read_bound(refusal['ordinaryApplied']['path'], refusal['ordinaryApplied']['sha256']))
    require(all(prepared[k] == applied[k] == refusal[k] for k in ('cycleId', 'pendingToken'))
            and applied['stateSha256'] == refusal['state']['sha256']
            and applied['index'] == refusal['index'] and applied['ordinaryReceipt'] == refusal['ordinaryReceipt']
            and plan['lifecycle'] == applied['lifecycleBinding'], 'Prior cycle/local phase bindings differ')
    rows = [r for r in plan['candidates'] if r.get('eligible')]
    require(rows and len(rows) <= 64 and all(r.get('retirementMethod') == 'custody'
            and custody.artifact(r['path'])[0] == 'preserved-source' for r in rows),
            'Reconciliation is limited to the qualified preserved-source scope')
    expected_checks = []
    for row in rows:
        key = sha(row['path'].encode())[:16]
        receipt = str(custody.BASE / 'cleanup-evidence' / ('bounded-retention-' + qualified['sha256'][:12] + '-' + key))
        expected_checks.append(dict(path=row['path'], receiptPath=receipt, sourcePresent=True, receiptAbsent=True))
    require(refusal['sourceChecks'] == expected_checks, 'Refusal source/receipt set differs')
    custody_root = Path(refusal['custodyRoot']); installer.safe(custody_root, True)
    require(custody_root == Path(installer.CUSTODY) / plan['current']['release_id'] / 'bulk', 'Unexpected custody location')
    seal_binding = binding(custody_root / 'batch-exported.json', installer)
    require(all(seal_binding[k] == refusal['sealedBatch'][k] for k in ('path', 'sha256')), 'Batch seal differs')
    seal = json.loads(installer.read_bound(seal_binding['path'], seal_binding['sha256']))
    require([v['path'] for v in seal['objects']] == [r['path'] for r in rows], 'Sealed batch scope differs')
    records = []; bindings = []
    for row in rows:
        key = sha(row['path'].encode())[:16]; record_path = custody_root / (key + '.json')
        record = json.loads(installer.read_bound(record_path))
        archive = custody.verify_custody(row, record, Path(qualified['path']), custody_root)
        restored = custody.restored_check(archive, custody_root / (key + '.inventory.json'),
                                          Path(record['restoration']['restoredPath']))
        restored.check_returncode()
        records.append(record)
        bindings.append({'record': binding(record_path, installer),
                         'inventory': binding(custody_root / (key + '.inventory.json'), installer),
                         'archive': {'path': str(archive), 'sha256': record['archiveSha256'], 'bytes': archive.stat().st_size},
                         'restoredVerificationSha256': sha(encoded(json.loads(restored.stdout)))})
    return {'refusal': refusal, 'plan': plan, 'prepared': prepared, 'applied': applied,
            'records': records, 'localProofs': {'batchSeal': seal_binding, 'objects': bindings}}


def remote_review(request):
    """Runs under the existing deployment lock; all operations are read-only."""
    installer = globals()['BOUND_INSTALLER']
    refusal = request['refusal']; plan = request['plan']
    with installer.deploy_lock(Path('/')):
        runtime = installer.existing_runtime(refusal['config']['sha256'])
        require(runtime.config['sourceCommit'] == refusal['installedSourceCommit'], 'Installed reviewed source changed')
        manifest = json.loads(installer.read_bound(Path(runtime.config['package']['path']) / 'package.json',
                                                   runtime.config['package']['sha256']))
        require(all(manifest['files'][path]['sha256'] == digest for path, digest in refusal['installedSourceHashes'].items()),
                'Installed refusal controller bytes differ')
        state, state_sha = runtime.state(); status = runtime.status({})
        require(state_sha == refusal['state']['sha256'] and state['revision'] == refusal['state']['revision']
                and not state.get('activePhase') and not runtime.unfinished_intents(), 'Cycle state changed')
        pending = state.get('pending', {})
        require(pending.get('stage') == 'ordinary-complete' and state['status'] == 'retention-incomplete'
                and pending['cycleId'] == refusal['cycleId'] and pending['token'] == refusal['pendingToken']
                and pending['context'] == status['context'] and state['index'] == pending['index'] == refusal['index']
                and pending['ordinaryReceipt'] == refusal['ordinaryReceipt'], 'Existing ordinary phase differs')
        require(plan['lifecycle'] == runtime.lifecycle(state['index'])
                and sha(encoded(plan)) == refusal['qualifiedPlan']['sha256'], 'Qualified custody authority differs')
        require(not runtime.P.policy_scope(state['index'], runtime.layout, APPROVAL)['eligible'],
                'Ordinary cleanup is incomplete')
        operation = 'complete-' + plan['current']['release_id'] + '-receipt1'
        require(re.fullmatch('[a-z0-9][A-Za-z0-9-]{0,63}', operation), 'Invalid completion operation')
        require(all(not os.path.lexists(runtime.layout.evidence / ('ui-lifecycle-' + operation + suffix))
                    for suffix in ('-intent.json', '-completed.json')), 'Completion phase already exists')
        unit = 'proofofwork-ui-lifecycle-' + operation + '.service'
        unit_value = dict(line.split('=', 1) for line in subprocess.check_output(
            ['/usr/bin/systemctl', 'show', unit, '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID'],
            text=True, timeout=30).splitlines())
        require(unit_value == {'LoadState': 'not-found', 'ActiveState': 'inactive', 'MainPID': '0'},
                'Completion service already exists; reconcile separately')
        applied = request['applied']; prepared = request['prepared']
        for value in (applied, prepared):
            durable = json.loads(installer.read_bound(value['receipt']['path'], value['receipt']['sha256']))
            require(durable == {k: v for k, v in value.items() if k != 'receipt'}, 'Local phase receipt differs from durable evidence')
        require(state['lastIntent'] == applied['intent'] and applied['stateSha256'] == state_sha
                and pending['ordinaryPlan'] == {k: prepared['ordinaryPlan'][k] for k in ('path', 'sha256')},
                'State does not bind exact prepared and applied phases')
        custody = runtime.C; custody.fence(plan, full=True)
        rows = [r for r in plan['candidates'] if r.get('eligible')]
        require(len(rows) == len(request['records']) == len(refusal['sourceChecks']), 'Reconciliation count differs')
        proofs = []
        for row, record, check in zip(rows, request['records'], refusal['sourceChecks']):
            path = Path(row['path']); kind, _, ordinary = custody.scope(path, plan)
            require(kind == 'preserved-source' and not ordinary and row['retirementMethod'] == 'custody'
                    and check['path'] == str(path) and not os.path.lexists(check['receiptPath']),
                    'Retirement intent exists or selected scope changed')
            expected_receipt = runtime.layout.evidence / ('bounded-retention-' + refusal['qualifiedPlan']['sha256'][:12] + '-' + sha(str(path).encode())[:16])
            require(str(expected_receipt) == check['receiptPath'], 'Retirement receipt namespace differs')
            custody.check_references([path])
            actual = custody.row_inventory(path, kind); custody.E.assert_inventory(actual, custody.expected(row))
            require(custody.artifact_proof(path, plan, actual) == row['artifactProof'], 'Source evidence changed')
            require(record['sourceInventory'] == custody.expected(row) and record['sourcePath'] == str(path)
                    and record['planSha256'] == refusal['qualifiedPlan']['sha256'], 'Custody source binding changed')
            proofs.append({'path': str(path), 'inventorySha256': custody.E.inventory_sha(actual['records']),
                           'artifactProofSha256': sha(encoded(row['artifactProof'])), 'receiptPath': str(expected_receipt),
                           'receiptAbsent': True})
        custody.fence(plan, full=True)
        require(runtime.state()[1] == state_sha, 'State changed during reconciliation review')
        return {'binding': status['binding'], 'config': runtime.config, 'stateSha256': state_sha,
                'revision': state['revision'], 'pending': pending, 'context': status['context'],
                'index': state['index'], 'sourceProofs': proofs, 'publicationHealthy': True}


def inspect_remote(local, installer):
    request = {k: local[k] for k in ('refusal', 'plan', 'prepared', 'applied', 'records')}
    request_raw = encoded(request)
    require(len(request_raw) <= 128 * 1024**2, 'Reconciliation request exceeds bound')
    code = "import base64,zlib,json,types,sys\n"
    source = local_read(HERE / 'install_lifecycle.py', installer)
    code += "m=types.ModuleType('bound_reconcile_installer');m.__file__='/bound/deploy/ui-retention/install_lifecycle.py';sys.modules[m.__name__]=m\n"
    code += "exec(compile(base64.b64decode(" + repr(base64.b64encode(source).decode()) + "),m.__file__,'exec'),m.__dict__)\n"
    own = local_read(Path(__file__), installer)
    code += "ns={'__name__':'bound_reconciliation','__file__':'/bound/deploy/ui-retention/reconcile_custody.py','BOUND_INSTALLER':m}\n"
    code += "exec(compile(base64.b64decode(" + repr(base64.b64encode(own).decode()) + "),ns['__file__'],'exec'),ns)\n"
    packed = base64.b64encode(zlib.compress(request_raw)).decode()
    code += "value=ns['remote_review'](json.loads(zlib.decompress(base64.b64decode(" + repr(packed) + "))));sys.stdout.buffer.write(ns['encoded'](value))\n"
    result = subprocess.run([*installer.SSH, 'nice -n 15 ionice -c 3 python3 -I -B -'], input=code.encode(),
                            capture_output=True, timeout=1800)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise ValueError('Read-only reconciliation refused; no retirement was dispatched')
    return json.loads(result.stdout)


def create_plan(refusal_binding, installer, local_module, custody):
    sources = committed_sources(installer, custody)
    local = read_local(refusal_binding, installer, custody)
    remote = inspect_remote(local, installer)
    require(committed_sources(installer, custody) == sources, 'Reviewed source changed during reconciliation')
    return {'schema': 'pow-ui-custody-reconciliation-plan-v1', 'scopeApprovalSha256': APPROVAL,
            'refusal': refusal_binding, 'sources': sources, 'localProofs': local['localProofs'],
            'remote': remote, 'qualifiedPlan': local['refusal']['qualifiedPlan'],
            'custodyRoot': local['refusal']['custodyRoot'],
            'operationId': 'complete-' + local['plan']['current']['release_id'] + '-receipt1'}


def apply(plan, destination, installer, local_module, custody):
    require(plan.get('schema') == 'pow-ui-custody-reconciliation-plan-v1'
            and plan.get('scopeApprovalSha256') == APPROVAL, 'Unsupported reconciliation plan')
    require(not os.path.lexists(destination), 'Reconciliation attempt exists; inspect it before further work')
    fresh = create_plan(plan['refusal'], installer, local_module, custody)
    require(fresh == plan, 'Reconciliation evidence/state/source changed after review')
    destination.mkdir(mode=0o700); installer.sync(destination.parent)
    installer.save(destination / 'intent.json', encoded({'schema': 'pow-ui-custody-reconciliation-intent-v1',
                   'plan': plan, 'planSha256': sha(encoded(plan)), 'ordinaryAndExportReplayAllowed': False}))
    result_path = destination / 'custody-completed.json'
    launcher_paths = {*custody.SOURCES.values(), 'deploy/ui-retention/custody.py'}
    launcher_pins = [p for p in plan['sources']['files'] if p['path'] in launcher_paths]
    custody.retire(Path(plan['qualifiedPlan']['path']), Path(plan['custodyRoot']), result_path,
                   expected_sources=launcher_pins)
    # This is an explicit exact-package binding, never a normal status fallback.
    remote = plan['remote']; pending = remote['pending']
    result = local_module.call(remote['binding'], 'complete-cycle',
        {'expectedStateSha256': remote['stateSha256'], 'expectedPair': remote['context']['pair'],
         'operationId': plan['operationId'], 'cycleId': pending['cycleId'], 'pendingToken': pending['token'],
         'custodyPlan': local_module.blob(Path(plan['qualifiedPlan']['path'])),
         'custodyResult': local_module.blob(result_path)})
    require(result.get('retentionComplete') is True, 'Existing cycle did not complete')
    installer.save(destination / 'completed.json', encoded(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__); commands = parser.add_subparsers(dest='operation', required=True)
    p = commands.add_parser('plan'); p.add_argument('--refusal', type=Path, required=True)
    p.add_argument('--refusal-sha256', required=True); p.add_argument('--output', type=Path, required=True)
    p = commands.add_parser('apply'); p.add_argument('--plan', type=Path, required=True)
    p.add_argument('--plan-sha256', required=True); p.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args(); os.umask(0o077); installer, local, custody = helpers()
    if args.operation == 'plan':
        plan = create_plan({'path': str(args.refusal.resolve()), 'sha256': args.refusal_sha256}, installer, local, custody)
        installer.save(args.output.absolute(), encoded(plan))
        print(json.dumps({'plan': str(args.output.absolute()), 'sha256': sha(encoded(plan))}))
    else:
        plan = json.loads(installer.read_bound(args.plan, args.plan_sha256))
        result = apply(plan, args.destination.absolute(), installer, local, custody)
        print(json.dumps(result))


if __name__ == '__main__': main()
