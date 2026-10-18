#!/usr/bin/env python3
"""Plan/install one exact committed private UI lifecycle package.

The install is creation-only. Existing helpers, packages, holds, monitor bytes
and timers are fenced and preserved. A partial installation is never retried.
"""
import argparse
import base64
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
       'root@77.42.91.106']
CONFIG = '/etc/proofofwork-retention/ui-lifecycle.json'
STATE = '/var/lib/proofofwork-ui-retention/state.json'
CUSTODY = '/home/sixer/ProofOfWork.Me.release-custody-ui-retention'
EVIDENCE = '/var/backups/proofofwork-ui/cleanup-evidence'
APPROVAL = 'df166edb2d9817dd4f8af24819880b6bf08b396b6aa483adaa141415fc709379'
FILES = (
    'audits/2026-10-16-ui-retention-repair-approval.json',
    'audits/2026-10-16-ui-retention-repair-proposal.json',
    'deploy/audit30/ui-storage.py', 'deploy/audit30/ui-release-policy.py',
    'deploy/proofofwork-ui-verified-retention.py',
    'deploy/ui-retention/custody.py', 'deploy/ui-retention/inventory.py',
    'deploy/ui-retention/removal.py', 'deploy/ui-retention/lifecycle_remote.py',
    'deploy/ui-retention/install_lifecycle.py', 'deploy/ui-retention/lifecycle.py',
)
SHA = re.compile(r'[0-9a-f]{64}\Z')
MAX_EVIDENCE = 64 * 1024**2
ROTATION_CONFIG_PINS = {
    '/etc/logrotate.d/rsyslog': 'b33b9a6126dfec23ec966cb43d18fbd90d053acc683f67d3c76aa49c0b1afc3b',
    '/etc/logrotate.d/ufw': '03dedaa1de48c9b708363ef4ac2ebeb35b20e47ce1f8a5d650f1335a5f37a5d1',
}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe(path, directory=False):
    path = Path(path)
    info = path.lstat()
    require(path.resolve() == path and info.st_uid == os.geteuid() and not info.st_mode & 0o7022
            and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)),
            'Unsafe installation path: ' + str(path))
    return info


def file_record(path):
    path = Path(path)
    before = safe(path)
    require(before.st_size <= 2 * 1024**2 and before.st_nlink == 1, 'Oversized or linked guard file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    try:
        require(os.fstat(fd) == before, 'Guard file identity changed: ' + str(path))
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(2 * 1024**2 + 1)
        require(len(raw) == before.st_size and os.fstat(fd) == before and path.lstat() == before,
                'Guard file changed: ' + str(path))
    finally:
        os.close(fd)
    return dict(sha256=sha(raw), bytes=len(raw), mode=stat.S_IMODE(before.st_mode),
                uid=before.st_uid, gid=before.st_gid, inode=before.st_ino,
                device=before.st_dev, mtimeNs=before.st_mtime_ns, ctimeNs=before.st_ctime_ns)


def guard_inventory(prefix=Path('/')):
    def at(path):
        return prefix / path.lstrip('/')
    names = set(at('/usr/local/sbin').glob('proofofwork-ui-*'))
    names.add(at('/usr/local/sbin/proofofwork-retention-protection'))
    names.update(at('/etc/proofofwork-retention').glob('*'))
    names.discard(at(CONFIG))
    files = {str(path): file_record(path) for path in sorted(names) if path.is_file() and not path.is_symlink()}
    require(str(at('/usr/local/sbin/proofofwork-ui-capacity')) in files, 'Installed capacity guard missing')
    units = {}
    for pattern in ('proofofwork-ui-*', 'proofofwork-retention-protection*'):
        for path in sorted(at('/etc/systemd/system').glob(pattern)):
            info = path.lstat()
            require(info.st_uid == os.geteuid(), 'Foreign systemd owner')
            if path.is_symlink():
                units[str(path)] = dict(target=os.readlink(path), inode=info.st_ino,
                                        device=info.st_dev, uid=info.st_uid, gid=info.st_gid,
                                        mtimeNs=info.st_mtime_ns, ctimeNs=info.st_ctime_ns)
            elif path.is_file():
                units[str(path)] = file_record(path)
            else:
                require(path.is_dir(), 'Unexpected systemd entry')
                for child in sorted(path.iterdir()):
                    units[str(child)] = file_record(child)
    for name in ('proofofwork-ui-release-prune.timer', 'proofofwork-ui-storage-prune.timer'):
        require(units.get(str(at('/etc/systemd/system') / name), {}).get('target') == '/dev/null',
                'Broad prune timer mask differs')
    manifest = at('/var/www/.proofofwork-ui-release')
    fields = dict(line.split('=', 1) for line in manifest.read_text().splitlines())
    require(re.fullmatch(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', fields.get('release_id', '')),
            'Malformed current release ID')
    prior = at('/var/backups/proofofwork-ui/rollback-roots') / ('proofofwork-www-pre-' + fields['release_id']) / '.proofofwork-ui-release'
    return {'files': files, 'units': units, 'currentManifest': file_record(manifest),
            'previousManifest': file_record(prior), 'releaseId': fields['release_id'],
            'existingPackages': sorted(p.name for p in at(EVIDENCE).glob('*tools-*') if p.is_dir()),
            'configAbsent': not os.path.lexists(at(CONFIG)), 'stateAbsent': not os.path.lexists(at(STATE))}


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save(path, raw):
    safe(path.parent, True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def committed_payload(root=ROOT):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args])
    require(not git('status', '--porcelain', '--untracked-files=no'), 'Commit reviewed tracked changes before packaging')
    commit = git('rev-parse', 'HEAD').decode().strip()
    tree = git('rev-parse', 'HEAD^{tree}').decode().strip()
    files = {}
    for path in FILES:
        raw = git('show', commit + ':' + path)
        require(raw == (root / path).read_bytes(), 'Package file differs from committed source: ' + path)
        files[path] = {'base64': base64.b64encode(raw).decode(), 'sha256': sha(raw), 'bytes': len(raw)}
    require(files[FILES[0]]['sha256'] == APPROVAL, 'Repair approval bytes differ')
    manifest = {'schema': 'pow-ui-retention-package-v1', 'sourceCommit': commit, 'sourceTree': tree,
                'files': {p: {'sha256': v['sha256'], 'bytes': v['bytes']} for p, v in files.items()}}
    package_sha = sha(encoded(manifest))
    package = EVIDENCE + '/ui-lifecycle-tools-' + package_sha
    config = {'schema': 'pow-ui-retention-lifecycle-config-v1', 'scopeApprovalSha256': APPROVAL,
              'sourceCommit': commit, 'sourceTree': tree, 'package': {'path': package, 'sha256': package_sha},
              'controller': {'path': package + '/deploy/ui-retention/lifecycle_remote.py',
                             'sha256': files['deploy/ui-retention/lifecycle_remote.py']['sha256']},
              'approval': {'path': package + '/' + FILES[0], 'sha256': APPROVAL},
              'statePath': STATE, 'offHostCustodyRoot': CUSTODY}
    return {'manifest': manifest, 'files': files, 'config': config, 'configSha256': sha(encoded(config))}


def validate_payload(payload):
    manifest = payload['manifest']
    require(set(payload['files']) == set(FILES) == set(manifest['files']), 'Expanded package file scope')
    require(manifest['schema'] == 'pow-ui-retention-package-v1'
            and re.fullmatch('[0-9a-f]{40}', manifest['sourceCommit'])
            and re.fullmatch('[0-9a-f]{40}', manifest['sourceTree']), 'Invalid package source identity')
    for relative, value in payload['files'].items():
        raw = base64.b64decode(value['base64'], validate=True)
        require(len(raw) <= 2 * 1024**2 and len(raw) == value['bytes']
                and sha(raw) == value['sha256'] and manifest['files'][relative] ==
                {'sha256': value['sha256'], 'bytes': value['bytes']}, 'Package file binding differs')
    config = payload['config']
    package_sha = sha(encoded(manifest))
    package = EVIDENCE + '/ui-lifecycle-tools-' + package_sha
    expected = {'schema': 'pow-ui-retention-lifecycle-config-v1', 'scopeApprovalSha256': APPROVAL,
                'sourceCommit': manifest['sourceCommit'], 'sourceTree': manifest['sourceTree'],
                'package': {'path': package, 'sha256': package_sha},
                'controller': {'path': package + '/deploy/ui-retention/lifecycle_remote.py',
                               'sha256': manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']},
                'approval': {'path': package + '/' + FILES[0], 'sha256': APPROVAL},
                'statePath': STATE, 'offHostCustodyRoot': CUSTODY}
    require(config == expected and sha(encoded(config)) == payload['configSha256']
            and payload['files'][FILES[0]]['sha256'] == APPROVAL, 'Expanded or unbound lifecycle configuration')


def read_bound(path, expected=None):
    path = Path(path)
    before = safe(path)
    require(before.st_nlink == 1 and before.st_size <= MAX_EVIDENCE, 'Unsafe bound evidence size/links')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    try:
        require(os.fstat(fd) == before, 'Bound evidence identity changed')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(MAX_EVIDENCE + 1)
        require(len(raw) <= MAX_EVIDENCE and os.fstat(fd) == before and path.lstat() == before,
                'Bound evidence changed')
    finally:
        os.close(fd)
    require(expected is None or SHA.fullmatch(expected) and sha(raw) == expected, 'Bound evidence SHA differs')
    return raw


def evidence_inventory(directory):
    safe(directory, True)
    paths = sorted(directory.iterdir())
    require(len(paths) <= 100000, 'Evidence enumeration exceeds bound')
    out = {}
    for path in paths:
        info = path.lstat()
        require(info.st_uid == os.geteuid() and not info.st_mode & 0o7022
                and (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)), 'Unsafe evidence entry')
        out[path.name] = {k: getattr(info, 'st_' + k) for k in
                         ('mode', 'uid', 'gid', 'ino', 'dev', 'nlink', 'size', 'mtime_ns', 'ctime_ns')}
    return out


@contextlib.contextmanager
def deploy_lock(prefix):
    path = prefix / 'run/proofofwork-ui/deploy.lock'
    before = safe(path)
    require(before.st_nlink == 1, 'Linked deployment lock')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(os.fstat(fd) == before, 'Deployment lock changed')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def existing_runtime(config_sha, prefix=Path('/')):
    # Authenticate every installed package byte before importing its verifier.
    raw = read_bound(prefix / CONFIG.lstrip('/'), config_sha)
    config = json.loads(raw)
    package = prefix / config['package']['path'].lstrip('/')
    manifest_raw = read_bound(package / 'package.json', config['package']['sha256'])
    manifest = json.loads(manifest_raw)
    require(set(manifest['files']) == set(FILES), 'Installed package scope differs')
    files = {}
    for relative, value in manifest['files'].items():
        data = read_bound(package / relative, value['sha256'])
        require(len(data) == value['bytes'], 'Installed file size differs')
        files[relative] = dict(value, base64=base64.b64encode(data).decode())
    validate_payload({'manifest': manifest, 'files': files, 'config': config, 'configSha256': config_sha})
    spec = importlib.util.spec_from_file_location('upgrade_old_lifecycle', package / 'deploy/ui-retention/lifecycle_remote.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config, digest, package = module.validate_config(CONFIG, config_sha)
    storage = module.load_module('upgrade_old_storage', package / 'deploy/audit30/ui-storage.py')
    policy = module.load_module('upgrade_old_policy', package / 'deploy/audit30/ui-release-policy.py', _BOUND_STORAGE=storage)
    custody = module.load_module('upgrade_old_custody', package / 'deploy/ui-retention/custody.py')
    custody.load_helpers()
    return module.Runtime(config, digest, storage, policy, custody)


def local_interruption(binding):
    raw = read_bound(binding['path'], binding['sha256'])
    proof = json.loads(raw)
    require(proof.get('schema') == 'pow-ui-retention-readonly-interruption-v1'
            and proof.get('offHostCustodyRootAbsent') is True
            and proof.get('ordinaryCustodyProofAbsent') is True
            and proof.get('ordinaryAppliedReceiptAbsent') is True
            and proof.get('localEvidenceDirectoryEntries') == ['prepared.json'], 'Interruption proof scope differs')
    stopped = proof['localOrchestrator']
    require(type(stopped['pid']) is int and stopped['pid'] > 1 and stopped['signal'] == 'SIGINT'
            and stopped['exitCode'] == 130 and not os.path.lexists('/proc/' + str(stopped['pid'])),
            'Interrupted orchestrator is not proven stopped')
    prepared_path = Path(proof['prepared']['path'])
    safe(prepared_path.parent, True)
    require(prepared_path.name == 'prepared.json'
            and sorted(p.name for p in prepared_path.parent.iterdir()) == ['prepared.json'],
            'Local custody or subsequent phase evidence exists')
    prepared_raw = read_bound(prepared_path, proof['prepared']['sha256'])
    prepared = json.loads(prepared_raw)
    require(all(prepared[k] == proof['prepared'][k] for k in ('receipt', 'stateSha256', 'cycleId')),
            'Interruption does not bind exact prepared cycle')
    require(not os.path.lexists(CUSTODY), 'Custody export root already exists; explicit reconciliation required')
    read_bound(proof['log']['path'], proof['log']['sha256'])
    return {'binding': binding, 'base64': base64.b64encode(raw).decode(),
            'prepared': {k: prepared[k] for k in ('receipt', 'intent', 'stateSha256', 'cycleId', 'pendingToken')}}


def prepared_guard_reconciliation(before, current, layout):
    """Classify only obsolete prepared evidence; never authorize execution."""
    require(set(before) == set(current)
            and all(encoded(before[key]) == encoded(current[key]) for key in before if key != 'heldCensus'),
            'Prepared upgrade changed hold/mask/missing/non-census guards')
    left = before['heldCensus']; right = current['heldCensus']
    require(len(left) == len(right) and [r['path'] for r in left] == [r['path'] for r in right]
            and len({r['path'] for r in left}) == len(left), 'Prepared upgrade changed held-path scope/order')
    permitted = {str(layout.prefix / ('var/log/' + family + suffix))
                 for family in ('auth.log', 'kern.log', 'syslog', 'ufw.log')
                 for suffix in ('', '.1', *('.' + str(n) + '.gz' for n in range(2, 49)))}
    changes = []
    for old, now in zip(left, right):
        if encoded(old) == encoded(now):
            continue
        require(old['path'] in permitted and old.get('exists') is True and now.get('exists') is True
                and set(old) == set(now) == {'path', 'exists', 'device', 'inode', 'mode', 'uid', 'gid'}
                and stat.S_ISREG(old['mode']) and stat.S_ISREG(now['mode'])
                and encoded({k: v for k, v in old.items() if k != 'inode'}) == encoded({k: v for k, v in now.items() if k != 'inode'})
                and type(old['inode']) is int and old['inode'] > 0
                and type(now['inode']) is int and now['inode'] > 0,
                'Prepared upgrade drift exceeds fixed regular-log inode rotation')
        changes.append({'path': old['path'], 'expected': old, 'actual': now})
    return {'schema': 'pow-ui-prepared-guard-supersession-v1',
            'oldGuardsSha256': sha(encoded(before)), 'currentGuardsSha256': sha(encoded(current)),
            'differences': changes, 'ordinaryExecutionAuthorized': False,
            'qualification': 'Only the abandoned prepared cycle is superseded; its original plan remains immutable.'}


def verify_prepared_bytes_for_supersession(storage, plan, layout, current_guards):
    """Full old-controller byte proofs without constructing an executable plan.

    The old plan's unrelated log census may be obsolete. All artifact, source,
    provenance, reference and capacity bindings remain exact. This verifier has
    no execution path and returns no modified plan or reusable execution guard.
    """
    storage.validate_plan(plan, layout, 'future-retention', APPROVAL)
    require(not plan['moves'] and 'reconciliation' not in plan, 'Expanded prepared supersession scope')
    storage.compare_guards(layout, current_guards, [])
    require(storage.hash_read(layout.capacity, 1024**2)[0] == plan['capacityHelperSha256'],
            'Prepared capacity helper changed')
    require(storage.hash_read(Path(storage.__file__).resolve(), 1024**2)[0] == plan['controllerSha256'],
            'Prepared controller binding changed')
    protected = plan['protected']; cache = {}
    paths = [row['path'] for row in plan['delete']]
    admitted = storage.load_citation_review(plan.get('citationReview'), layout, protected,
                                            plan['kind'], paths, APPROVAL)
    storage.references(paths, layout.refs + [Path(row['path']) for row in protected['sources']], reviewed_files=admitted)
    for key in ('current', 'previous'):
        expected = protected[key]
        actual = storage.release_proof(Path(expected['path']), layout, cache)
        require(actual['fields'] == expected['fields'], 'Prepared protected release provenance changed')
        storage.match_snapshot(actual['snapshot'], expected['snapshot'])
        retained = cache[str(layout.archives / expected['fields']['archive_name'])]
        archived = next((row for row in plan['archives'] if row['path'] == retained['path']), None)
        require(archived is not None, 'Prepared retained archive binding absent')
        storage.match_snapshot(retained['snapshot'], archived['snapshot'])
        require([row['path'] for row in retained['sidecars']] == [row['path'] for row in archived['sidecars']],
                'Prepared retained archive sidecar scope changed')
        for actual_sidecar, expected_sidecar in zip(retained['sidecars'], archived['sidecars']):
            storage.match_snapshot(actual_sidecar, expected_sidecar)
    for row in protected['sources']:
        storage.match_snapshot(storage.snapshot(Path(row['path']), links=True), row['snapshot'])
    for row in plan['delete']:
        storage.match_snapshot(storage.snapshot(Path(row['path'])), row['snapshot'])
        if row['kind'] == 'rollback-root':
            actual = storage.release_proof(Path(row['path']), layout, cache)
            require(actual['fields'] == row['release']['fields'], 'Prepared candidate provenance changed')
    for row in plan['archives']:
        storage.match_snapshot(storage.snapshot(Path(row['path'])), row['snapshot'])
        for sidecar in row['sidecars']:
            storage.match_snapshot(storage.snapshot(Path(sidecar['path'])), sidecar)
    storage.compare_guards(layout, current_guards, [])


def prepared_review(runtime, request):
    state, state_sha = runtime.state()
    require(state_sha == request['stateSha256'], 'Prepared state changed after interruption')
    require(state and state.get('status') == 'retention-incomplete' and not state.get('activePhase')
            and state.get('pending', {}).get('stage') == 'prepared'
            and not runtime.unfinished_intents(), 'Only a sealed prepared-before-custody cycle can be upgraded')
    pending = state['pending']
    expected = request['interruption']['prepared']
    require(pending['cycleId'] == expected['cycleId'] and pending['token'] == expected['pendingToken']
            and state['lastIntent'] == expected['intent'] and pending['index'] == state['index'],
            'Interrupted cycle identity changed')
    prefix = runtime.layout.evidence / ('ui-lifecycle-' + pending['cycleId'])
    require(expected['intent']['path'] == str(prefix) + '-intent.json'
            and expected['receipt']['path'] == str(prefix) + '-completed.json', 'Prepared receipt namespace differs')
    intent = json.loads(read_bound(expected['intent']['path'], expected['intent']['sha256']))
    receipt = json.loads(read_bound(expected['receipt']['path'], expected['receipt']['sha256']))
    require(intent['operation'] == 'prepare-cycle' and intent['operationId'] == pending['cycleId']
            and intent['configSha256'] == runtime.config_sha and receipt['intent'] == expected['intent']
            and receipt['ok'] is True and receipt['publicationHealthy'] is True
            and receipt['stateSha256'] == state_sha and receipt['stateRevision'] == state['revision']
            and receipt['cycleId'] == pending['cycleId'] and receipt['pendingToken'] == pending['token']
            and receipt['index'] == state['index'], 'Sealed preparation does not authenticate current state')
    plan = json.loads(read_bound(pending['ordinaryPlan']['path'], pending['ordinaryPlan']['sha256']))
    require(receipt['ordinaryPlan'] == dict(pending['ordinaryPlan'], value=plan)
            and runtime.S.digest(plan) == pending['ordinaryPlan']['sha256']
            and plan['policyScope']['admissionIndex'] == state['index'], 'Prepared ordinary plan differs')
    require(plan['safeguards'] == pending['context']['guards'] == intent['context']['guards'],
            'Sealed prepared guard bindings differ')
    if 'heldIdentityModel' in plan['safeguards']:
        require(hasattr(runtime.S, 'guard_model'), 'Prepared guard model is unsupported by its installed controller')
        guards, _ = runtime.S.safeguards(runtime.layout, model=runtime.S.guard_model(plan['safeguards']))
    else:
        guards, _ = runtime.S.safeguards(runtime.layout)
    guard_reconciliation = prepared_guard_reconciliation(plan['safeguards'], guards, runtime.layout)
    if guard_reconciliation['differences']:
        # Configured rotation is pinned independently of the permitted inode
        # drift. These files and all log data remain outside the upgrade scope.
        configs = [{'path': str(runtime.layout.prefix / path.lstrip('/')), 'sha256': digest}
                   for path, digest in ROTATION_CONFIG_PINS.items()]
        require(len(configs) == 2, 'Unexpected configured log rotation scope')
        for binding in configs:
            read_bound(binding['path'], binding['sha256'])
        guard_reconciliation['rotationConfigFiles'] = configs
        verify_prepared_bytes_for_supersession(runtime.S, plan, runtime.layout, guards)
    else:
        runtime.S.verify_plan(plan, runtime.layout)
    runtime.P.load_index(state['index']['path'], state['index']['sha256'], runtime.layout, APPROVAL)
    pair = plan['protected']
    context = {'pair': runtime.P.pair_ids(pair), 'guards': guards,
               'manifests': {k: runtime.S.hash_read(Path(pair[k]['path']) / '.proofofwork-ui-release')[0]
                             for k in ('current', 'previous')}}
    require(pending['context'] == intent['context']
            and {k: v for k, v in context.items() if k != 'guards'} ==
                {k: v for k, v in pending['context'].items() if k != 'guards'}, 'Prepared protected pair changed')
    runtime.S.compare_guards(runtime.layout, guards, [])
    https = json.loads(read_bound(pending['httpsReceipt']['path'], pending['httpsReceipt']['sha256']))
    runtime.verify_publication(https, pending['publicationReceipt'], pair, context)
    interrupted = json.loads(base64.b64decode(request['interruption']['base64'], validate=True))
    remote_pid = interrupted['remoteReadOnlyQualifier']['pid']
    require(type(remote_pid) is int and remote_pid > 1 and not os.path.lexists('/proc/' + str(remote_pid)),
            'Interrupted remote qualifier still exists')
    prepared_time = Path(expected['receipt']['path']).stat().st_mtime_ns
    for path in runtime.layout.evidence.iterdir():
        if path.name.startswith(('bounded-retention-', 'ui-retention-custody-', 'audit30-future-retention-')):
            require(path.lstat().st_mtime_ns < prepared_time, 'Post-preparation custody/retirement evidence exists')
    return {'state': state, 'stateSha256': state_sha, 'context': context,
            'phase': {k: pending[k] for k in ('cycleId', 'token', 'ordinaryPlan', 'httpsReceipt', 'publicationReceipt')},
            'prepareIntent': expected['intent'], 'prepareReceipt': expected['receipt'],
            'ordinarySnapshotsVerified': True, 'noRetirementStarted': True,
            'guardReconciliation': guard_reconciliation}


def upgrade_inventory(request, prefix=Path('/')):
    with deploy_lock(prefix):
        return upgrade_inventory_locked(request, prefix)


def completed_review(runtime, request):
    """Authenticate a completed cycle without replacing any of its proofs."""
    state, state_sha = runtime.state()
    require(state_sha == request['stateSha256'], 'Completed state changed after review')
    require(state and state.get('status') == 'complete' and not state.get('pending')
            and not state.get('activePhase') and not runtime.unfinished_intents(),
            'Only a sealed completed cycle can use a completion-preserving upgrade')
    status = runtime.status({'requireComplete': True})
    require(status['stateSha256'] == state_sha and status['context'] == state['completedContext'],
            'Completed context changed')
    checkpoint, checkpoint_sha = state, state_sha
    # Repeated compatible upgrades retain the original completed phase bytes.
    for _ in range(16):
        upgrade = checkpoint.get('lastUpgrade', {})
        if upgrade.get('preservedCompletedCycleId') != state['lastCompleted']['cycleId']:
            break
        prior_path = Path(upgrade['intentPath']).parent / 'prior-state.json'
        prior = json.loads(read_bound(prior_path, upgrade['priorStateSha256']))
        require(all(prior[k] == state[k] for k in ('index', 'completedContext', 'lastCompleted', 'lastIntent'))
                and prior['status'] == 'complete' and not prior.get('pending') and not prior.get('activePhase'),
                'Prior completed upgrade chain differs')
        checkpoint, checkpoint_sha = prior, upgrade['priorStateSha256']
    else:
        raise ValueError('Completed upgrade chain exceeds bound')
    intent_binding = checkpoint['lastIntent']
    intent = json.loads(read_bound(intent_binding['path'], intent_binding['sha256']))
    path = Path(intent_binding['path'])
    require(path.parent == runtime.layout.evidence and path.name.endswith('-intent.json')
            and intent['operation'] == 'complete-cycle' and intent['configSha256'] == checkpoint['configSha256'],
            'Completed phase intent differs')
    receipt_path = path.with_name(path.name.removesuffix('-intent.json') + '-completed.json')
    receipt_raw = read_bound(receipt_path); receipt = json.loads(receipt_raw)
    require(receipt.get('ok') is True and receipt.get('retentionComplete') is True
            and receipt['intent'] == intent_binding and receipt['stateSha256'] == checkpoint_sha
            and receipt['stateRevision'] == checkpoint['revision'] and receipt['index'] == state['index']
            and receipt['cycleId'] == state['lastCompleted']['cycleId'], 'Completed terminal receipt differs')
    return {'state': state, 'stateSha256': state_sha, 'context': status['context'],
            'completionIntent': intent_binding,
            'completionReceipt': {'path': str(receipt_path), 'sha256': sha(receipt_raw)},
            'lastCompleted': state['lastCompleted'], 'fullCompletionVerified': True}


def repair_verifier_runtime(payload, old_runtime):
    """Use only reviewed new verifier bytes; never patch the installed module."""
    validate_payload(payload)
    package = Path(old_runtime.config['package']['path'])
    manifest = json.loads(read_bound(package / 'package.json', old_runtime.config['package']['sha256']))
    for relative in old_runtime.C.SOURCES.values():
        require(payload['files'][relative]['sha256'] == manifest['files'][relative]['sha256'],
                'Config-transition repair cannot replace custody dependencies')
    def module(name, relative, bindings=None):
        value = types.ModuleType(name); value.__file__ = '/bound/' + relative
        if bindings: value.__dict__.update(bindings)
        sys.modules[name] = value
        exec(compile(base64.b64decode(payload['files'][relative]['base64'], validate=True), value.__file__, 'exec'), value.__dict__)
        return value
    custody = module('repair_new_custody', 'deploy/ui-retention/custody.py',
                     {name: getattr(old_runtime.C, name) for name in old_runtime.C.SOURCES})
    coordinator = module('repair_new_coordinator', 'deploy/ui-retention/lifecycle_remote.py')
    require(hasattr(coordinator.Runtime, 'completion_transitions'), 'Reviewed coordinator lacks explicit transition verification')
    return coordinator.Runtime(old_runtime.config, old_runtime.config_sha, old_runtime.S, old_runtime.P, custody,
                               layout=old_runtime.layout)


def local_guard_refusal(binding, payload):
    path = Path(binding['path']); raw = read_bound(path, binding['sha256'])
    require(ROOT in path.parents, 'Guard refusal must be committed repository evidence')
    relative = str(path.relative_to(ROOT))
    require(relative.startswith('audits/') and relative.endswith('.json'), 'Unexpected guard refusal path')
    committed = subprocess.check_output(['git', '-C', str(ROOT), 'show', payload['manifest']['sourceCommit'] + ':' + relative])
    require(committed == raw, 'Guard refusal differs from committed source')
    value = json.loads(raw)
    require(value.get('schema') == 'pow-ui-custody-completed-config-guard-refusal-v1'
            and value.get('scopeApprovalSha256') == APPROVAL and value.get('retirementReplayAllowed') is False
            and value['guardDifference']['onlyChangedPaths'] == [CONFIG]
            and value['guardDifference']['otherHoldRowsUnchanged'] is True
            and value['guardDifference']['timersUnchanged'] is True, 'Expanded config guard refusal')
    for bound in (value['completedCycle']['local'], value['completedUpgrade']['plan'], value['completedUpgrade']['result'],
                  value['failure']['log'], value['failure']['emptyOutput'], value['guardObservation'], value['stateObservation']):
        read_bound(bound['path'], bound['sha256'])
    return {'binding': binding, 'base64': base64.b64encode(raw).decode()}


def validate_guard_refusal(request, runtime):
    bound = request['guardRefusal']; raw = base64.b64decode(bound['base64'], validate=True)
    require(len(raw) <= 1024**2 and sha(raw) == bound['binding']['sha256'], 'Guard refusal SHA differs')
    value = json.loads(raw); state, state_sha = runtime.state()
    require(value['schema'] == 'pow-ui-custody-completed-config-guard-refusal-v1'
            and value['scopeApprovalSha256'] == APPROVAL and value['retirementReplayAllowed'] is False
            and value['config']['path'] == CONFIG and value['config']['sha256'] == runtime.config_sha == request['configSha256']
            and value['state']['path'] == STATE and value['state']['sha256'] == state_sha == request['stateSha256']
            and value['state']['revision'] == state['revision'] and value['state']['status'] == state['status'] == 'complete'
            and value['installedSourceCommit'] == runtime.config['sourceCommit']
            and value['qualifiedPlan']['sha256'] == state['lastCompleted']['custodyPlan']['sha256']
            and value['completedCycle']['cycleId'] == state['lastCompleted']['cycleId']
            and value['guardDifference']['onlyChangedPaths'] == [CONFIG]
            and value['guardDifference']['otherHoldRowsUnchanged'] is True
            and value['guardDifference']['timersUnchanged'] is True, 'Guard refusal does not bind existing completion')
    read_bound(value['completedCycle']['receipt']['path'], value['completedCycle']['receipt']['sha256'])
    require(value['completedUpgrade']['receipt']['path'] == state['lastUpgrade']['completionPath'],
            'Guard refusal upgrade receipt differs')
    read_bound(value['completedUpgrade']['receipt']['path'], value['completedUpgrade']['receipt']['sha256'])


def completed_package_review(payload, package, old_runtime, review):
    """New code must independently accept the preserved completion before CAS."""
    spec = importlib.util.spec_from_file_location('upgrade_new_lifecycle', package / 'deploy/ui-retention/lifecycle_remote.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    storage = module.load_module('upgrade_new_storage', package / 'deploy/audit30/ui-storage.py')
    policy = module.load_module('upgrade_new_policy', package / 'deploy/audit30/ui-release-policy.py', _BOUND_STORAGE=storage)
    custody = module.load_module('upgrade_new_custody', package / 'deploy/ui-retention/custody.py'); custody.load_helpers()
    runtime = module.Runtime(payload['config'], payload['configSha256'], storage, policy, custody,
                             layout=old_runtime.layout)
    _, context = runtime.current()
    require(context == review['context'], 'New package changes completed protected context')
    state = review['state']; index = state['index']
    require(not policy.policy_scope(index, runtime.layout, APPROVAL)['eligible'], 'New package finds eligible ordinary assets')
    plan_binding = state['lastCompleted']['custodyPlan']; result_binding = state['lastCompleted']['custodyResult']
    plan = json.loads(read_bound(plan_binding['path'], plan_binding['sha256']))
    result = json.loads(read_bound(result_binding['path'], result_binding['sha256']))
    expected_lifecycle = (old_runtime.completion_lifecycle(state, index)
                          if hasattr(old_runtime, 'completion_lifecycle') else old_runtime.lifecycle(index))
    require(plan['lifecycle'] == expected_lifecycle, 'Preserved custody authority differs')
    # Approval content is identical, but its immutable package path changes.
    # The preserved plan intentionally retains its original approval binding.
    transitions = runtime.completion_transitions(state)
    custody.verify_final_result(plan, plan_binding['sha256'], result, result_binding['sha256'],
                                **({'config_transitions': transitions} if transitions else {}))
    storage.compare_guards(runtime.layout, context['guards'], [])
    return {'context': context, 'index': index, 'lastCompleted': state['lastCompleted'],
            'custodyLifecycle': plan['lifecycle'],
            'verifiedConfigTransitions': transitions,
            'fullCompletionVerified': True}


def upgrade_inventory_locked(request, prefix):
    for path in (prefix / EVIDENCE.lstrip('/')).glob('ui-lifecycle-upgrade-*'):
        require(path.is_dir() and not path.is_symlink() and (path / 'completed.json').is_file(),
                'Unsealed upgrade requires explicit reconciliation')
    runtime = existing_runtime(request['configSha256'], prefix)
    if request.get('mode') in ('completed-cycle', 'completed-config-repair'):
        repair = request['mode'] == 'completed-config-repair'
        require(set(request) == {'mode', 'configSha256', 'stateSha256'} | ({'verificationPayload', 'guardRefusal'} if repair else set()),
                'Expanded completed upgrade request')
        if repair:
            require(runtime.state()[0].get('lastUpgrade', {}).get('preservedCompletedCycleId'),
                    'Config repair requires a sealed completion-preserving upgrade')
            validate_guard_refusal(request, runtime)
            runtime = repair_verifier_runtime(request['verificationPayload'], runtime)
        config_raw = read_bound(prefix / CONFIG.lstrip('/'), request['configSha256'])
        state_raw = read_bound(prefix / STATE.lstrip('/'), request['stateSha256'])
        return {'guards': guard_inventory(prefix), 'completedReview': completed_review(runtime, request),
                'configBase64': base64.b64encode(config_raw).decode(), 'stateBase64': base64.b64encode(state_raw).decode(),
                'evidence': evidence_inventory(prefix / EVIDENCE.lstrip('/'))}
    require('mode' not in request, 'Unknown upgrade mode')
    raw = base64.b64decode(request['interruption']['base64'], validate=True)
    require(sha(raw) == request['interruption']['binding']['sha256'], 'Interruption evidence SHA differs')
    interruption = json.loads(raw)
    require(interruption.get('schema') == 'pow-ui-retention-readonly-interruption-v1'
            and interruption.get('implementationCommit') == runtime.config['sourceCommit']
            and all(interruption['prepared'][key] == request['interruption']['prepared'][key]
                    for key in ('receipt', 'stateSha256', 'cycleId')),
            'Interrupted process/source/cycle binding differs')
    config_raw = read_bound(prefix / CONFIG.lstrip('/'), request['configSha256'])
    state_raw = read_bound(prefix / STATE.lstrip('/'), request['stateSha256'])
    return {'guards': guard_inventory(prefix), 'preparedReview': prepared_review(runtime, request),
            'configBase64': base64.b64encode(config_raw).decode(), 'stateBase64': base64.b64encode(state_raw).decode(),
            'evidence': evidence_inventory(prefix / EVIDENCE.lstrip('/'))}


def verify_activated_upgrade(result, prefix=Path('/')):
    """Seal actual post-switch verification before normal callers may proceed."""
    runtime = existing_runtime(result['config']['sha256'], prefix)
    runtime.verify_upgrade = True
    state, state_sha = runtime.state()
    require(state_sha == result['state']['sha256'] and state['revision'] == result['stateRevision'],
            'Activated upgrade state differs')
    path = Path(state['lastUpgrade']['statusVerificationPath'])
    require(path == Path(result['intent']['path']).parent / 'verified.json' and not os.path.lexists(path),
            'Upgrade verification evidence already exists')
    status = runtime.status({'requireComplete': True})
    require(status['retentionComplete'] is True and status['stateSha256'] == state_sha,
            'Activated package did not verify completed retention')
    receipt = {'path': str(Path(result['intent']['path']).parent / 'completed.json'),
               'sha256': sha(encoded(result))}
    read_bound(receipt['path'], receipt['sha256'])
    verified = {'schema': 'pow-ui-retention-upgrade-status-verified-v1', 'ok': True,
                'config': result['config'], 'state': result['state'], 'upgradeReceipt': receipt,
                'preservedCompletedCycleId': result['preservedCompletedCycleId'],
                'contextSha256': sha(encoded(status['context']))}
    save(path, encoded(verified))
    runtime.verify_upgrade = False
    normal = runtime.status({'requireComplete': True})
    require(normal['retentionComplete'] is True and normal['stateSha256'] == state_sha,
            'Normal post-switch status did not pass')
    return {'path': str(path), 'sha256': sha(encoded(verified))}


def upgrade_remote(plan, prefix=Path('/')):
    require(os.geteuid() == 0 or prefix != Path('/'), 'Production upgrade requires root')
    require(plan.get('schema') == 'pow-ui-retention-upgrade-plan-v1'
            and plan.get('scopeApprovalSha256') == APPROVAL, 'Upgrade plan authority differs')
    os.umask(0o077)
    payload = plan['payload']; validate_payload(payload)
    def at(path): return prefix / path.lstrip('/')
    with deploy_lock(prefix):
        before = upgrade_inventory_locked(plan['request'], prefix)
        require(before == plan['before'], 'Upgrade config/state/guards/evidence changed after review')
        completed_mode = plan['request'].get('mode') in ('completed-cycle', 'completed-config-repair')
        if plan['request'].get('mode') == 'completed-config-repair':
            require(plan['request']['verificationPayload'] == payload, 'Repair verifier differs from install payload')
        review = before['completedReview' if completed_mode else 'preparedReview']
        old_state = review['state']
        old_config = json.loads(base64.b64decode(before['configBase64']))
        require(old_config['package'] != payload['config']['package'], 'Upgrade requires a new immutable package')
        package = at(payload['config']['package']['path'])
        journal = at(EVIDENCE) / ('ui-lifecycle-upgrade-' + payload['config']['package']['sha256'])
        require(not os.path.lexists(package) and not os.path.lexists(journal), 'Prior upgrade/package requires explicit reconciliation')
        planned = dict(old_state, configSha256=payload['configSha256'], revision=old_state['revision'] + 2,
                       status='complete' if completed_mode else 'retention-incomplete', pending=None, activePhase=None,
                       completedContext=old_state['completedContext'] if completed_mode else None,
                       lastUpgrade={'intentPath': str(journal / 'intent.json'),
                                    'completionPath': str(journal / 'completed.json'),
                                    'priorConfigSha256': plan['request']['configSha256'],
                                    'priorStateSha256': plan['request']['stateSha256'],
                                    'supersededCycleId': None if completed_mode else old_state['pending']['cycleId']})
        if completed_mode:
            planned['lastUpgrade']['preservedCompletedCycleId'] = old_state['lastCompleted']['cycleId']
            planned['lastUpgrade']['statusVerificationPath'] = str(journal / 'verified.json')
        intent = {'schema': 'pow-ui-retention-upgrade-intent-v1', 'plan': plan,
                  'stateTemplate': planned, 'stateTemplateSha256': sha(encoded(planned)),
                  'disposition': 'completed-cycle-preserved' if completed_mode else 'prepared-before-custody-superseded',
                  'freshPreparationRequired': not completed_mode}
        intent_sha = sha(encoded(intent))
        planned = dict(planned, lastUpgrade=dict(planned['lastUpgrade'], intentSha256=intent_sha))
        allocation = max(8 * 1024**2, len(encoded(intent)) * 2 + sum(v['bytes'] for v in payload['files'].values()) * 4)
        subprocess.run(['/usr/bin/python3', '-I', '-B', str(at('/usr/local/sbin/proofofwork-ui-capacity')),
                        'check', '--path', str(at(EVIDENCE)), '--additional-bytes', str(allocation),
                        '--additional-inodes', '128', '--phase', 'ui-lifecycle-upgrade'],
                       check=True, capture_output=True, timeout=60)
        journal.mkdir(mode=0o700); sync(journal.parent)
        save(journal / 'intent.json', encoded(intent))
        save(journal / 'prior-config.json', base64.b64decode(before['configBase64']))
        save(journal / 'prior-state.json', base64.b64decode(before['stateBase64']))
        active = dict(old_state, revision=old_state['revision'] + 1, status='retention-incomplete',
                      activePhase={'operation': 'upgrade', 'intent': {'path': str(journal / 'intent.json'),
                                                                   'sha256': intent_sha}})
        active_next = at(STATE).with_name('state-upgrade-' + payload['config']['package']['sha256'] + '-intent.next.json')
        save(active_next, encoded(active))
        read_bound(at(CONFIG), plan['request']['configSha256']); read_bound(at(STATE), plan['request']['stateSha256'])
        os.replace(active_next, at(STATE)); sync(at(STATE).parent)
        package.mkdir(mode=0o700); sync(package.parent)
        for relative, value in payload['files'].items():
            path = package / relative; path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            save(path, base64.b64decode(value['base64'], validate=True))
        save(package / 'package.json', encoded(payload['manifest']))
        for relative, value in payload['files'].items():
            read_bound(package / relative, value['sha256'])
        completion_verification = None
        if completed_mode:
            old_runtime = existing_runtime(plan['request']['configSha256'], prefix)
            completion_verification = completed_package_review(payload, package, old_runtime, review)
        after = guard_inventory(prefix)
        after['existingPackages'] = [p for p in after['existingPackages'] if p != package.name]
        require(after == before['guards'], 'Existing helpers/holds/timers/pair changed during upgrade')
        remaining = evidence_inventory(at(EVIDENCE))
        for name in (package.name, journal.name): remaining.pop(name)
        require(remaining == before['evidence'], 'Prior evidence changed during upgrade')
        read_bound(at(CONFIG), plan['request']['configSha256'])
        read_bound(at(STATE), sha(encoded(active)))
        state_next = at(STATE).with_name('state-upgrade-' + payload['config']['package']['sha256'] + '.next.json')
        config_next = at(CONFIG).with_name('ui-lifecycle-upgrade-' + payload['config']['package']['sha256'] + '.next.json')
        save(state_next, encoded(planned)); save(config_next, encoded(payload['config']))
        # There is no two-file atomic rename. Each intermediate state refuses:
        # old config/new state fail authority, and new config/new state require
        # the immutable terminal upgrade receipt before any lifecycle operation.
        read_bound(at(CONFIG), plan['request']['configSha256']); read_bound(at(STATE), sha(encoded(active)))
        if completed_mode:
            old_runtime.S.compare_guards(old_runtime.layout, review['context']['guards'], [])
        os.replace(state_next, at(STATE)); sync(at(STATE).parent)
        os.replace(config_next, at(CONFIG)); sync(at(CONFIG).parent)
        result = {'schema': 'pow-ui-retention-upgrade-completed-v1', 'ok': True,
                  'intent': {'path': str(journal / 'intent.json'), 'sha256': intent_sha},
                  'config': {'path': CONFIG, 'sha256': payload['configSha256']},
                  'state': {'path': STATE, 'sha256': sha(encoded(planned))}, 'stateRevision': planned['revision'],
                  'priorConfig': {'path': str(journal / 'prior-config.json'), 'sha256': plan['request']['configSha256']},
                  'priorState': {'path': str(journal / 'prior-state.json'), 'sha256': plan['request']['stateSha256']},
                  'supersededCycleId': None if completed_mode else old_state['pending']['cycleId'], 'index': planned['index'],
                  'freshPreparationRequired': not completed_mode, 'retentionComplete': completed_mode, 'publicationHealthy': True,
                  'priorPackageAndPhaseEvidencePreserved': True, 'priorHelpersHoldsAndTimersPreserved': True}
        if completed_mode:
            result.update(preservedCompletedCycleId=old_state['lastCompleted']['cycleId'],
                          completionVerification=completion_verification)
        else:
            result['preparedGuardReconciliation'] = review['guardReconciliation']
        save(journal / 'completed.json', encoded(result))
        verified = None
        if completed_mode:
            try:
                verified = verify_activated_upgrade(result, prefix)
            except BaseException as error:
                save(journal / 'verification-failed.json', encoded({'error': str(error),
                     'manualReconciliationRequired': True, 'config': result['config'], 'state': result['state']}))
                raise
        out = dict(result, receipt={'path': str(journal / 'completed.json'), 'sha256': sha(encoded(result))})
        if verified: out['normalStatusVerification'] = verified
        return out


def install_remote(plan, prefix=Path('/')):
    require(os.geteuid() == 0 or prefix != Path('/'), 'Production installer requires root')
    require(plan.get('schema') == 'pow-ui-retention-install-plan-v1'
            and plan.get('scopeApprovalSha256') == APPROVAL, 'Install plan authority differs')
    os.umask(0o077)
    payload = plan['payload']
    validate_payload(payload)
    def at(path):
        return prefix / path.lstrip('/')
    lock = at('/run/proofofwork-ui/deploy.lock')
    before = safe(lock)
    require(before.st_nlink == 1, 'Linked deployment lock')
    fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(os.fstat(fd) == before, 'Deployment lock changed')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(guard_inventory(prefix) == plan['before'], 'Installation guard/pair changed after review')
        require(plan['before']['configAbsent'] and plan['before']['stateAbsent'],
                'Existing lifecycle requires explicit upgrade reconciliation')
        package = at(payload['config']['package']['path'])
        receipt = at(EVIDENCE) / ('ui-lifecycle-install-' + payload['config']['package']['sha256'])
        require(not os.path.lexists(package) and not os.path.lexists(receipt),
                'Prior package or install intent requires explicit reconciliation')
        allocation = max(8 * 1024**2, sum(v['bytes'] for v in payload['files'].values()) * 4)
        subprocess.run(['/usr/bin/python3', '-I', '-B', str(at('/usr/local/sbin/proofofwork-ui-capacity')),
                        'check', '--path', str(at(EVIDENCE)), '--additional-bytes', str(allocation),
                        '--additional-inodes', '128', '--phase', 'ui-lifecycle-install'],
                       check=True, capture_output=True, timeout=60)
        receipt.mkdir(mode=0o700)
        sync(receipt.parent)
        save(receipt / 'intent.json', encoded(plan))
        package.mkdir(mode=0o700)
        sync(package.parent)
        for relative, value in payload['files'].items():
            path = package / relative
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            save(path, base64.b64decode(value['base64'], validate=True))
        save(package / 'package.json', encoded(payload['manifest']))
        for relative, value in payload['files'].items():
            require(file_record(package / relative)['sha256'] == value['sha256'], 'Installed package differs')
        current = guard_inventory(prefix)
        current['existingPackages'] = [p for p in current['existingPackages'] if p != package.name]
        require(current == plan['before'], 'Existing helpers/holds/timers changed during installation')
        state_parent = at(STATE).parent
        if not state_parent.exists():
            state_parent.mkdir(mode=0o700)
            sync(state_parent.parent)
        safe(state_parent, True)
        save(at(CONFIG), encoded(payload['config']))
        result = {'ok': True, 'sourceCommit': payload['manifest']['sourceCommit'],
                  'sourceTree': payload['manifest']['sourceTree'], 'package': payload['config']['package'],
                  'config': {'path': CONFIG, 'sha256': payload['configSha256']},
                  'controller': payload['config']['controller'], 'priorHelpersHoldsAndTimersPreserved': True,
                  'bootstrapRequired': True, 'retentionComplete': False}
        save(receipt / 'completed.json', encoded(result))
        return dict(result, receipt={'path': str(receipt / 'completed.json'), 'sha256': sha(encoded(result))})
    finally:
        os.close(fd)


def remote(operation, value=None):
    source = Path(__file__).read_text()
    # Only this reviewed committed module is executed. The request is decoded as
    # data; it is never interpolated as shell text or executable Python.
    code = source.rsplit("if __name__ == '__main__':", 1)[0]
    code += '\nvalue=json.loads(base64.b64decode(' + repr(base64.b64encode(encoded(value)).decode()) + '))\n'
    operations = {'inventory': 'guard_inventory()', 'install': 'install_remote(value)',
                  'upgrade-inventory': 'upgrade_inventory(value)', 'upgrade': 'upgrade_remote(value)'}
    require(operation in operations, 'Unknown installer operation')
    code += 'result=' + operations[operation] + '\n'
    code += 'sys.stdout.buffer.write(encoded(result))\n'
    # __file__ is not meaningful in a streamed installer; ROOT is unused remotely.
    code = "__file__='/tmp/ui-lifecycle-installer/deploy/ui-retention/install_lifecycle.py'\n" + code
    timeout = 1800 if operation.startswith('upgrade') else 180
    if operation == 'upgrade' and value.get('request', {}).get('mode') in ('completed-cycle', 'completed-config-repair'):
        timeout = 3600
    result = subprocess.run([*SSH, 'nice -n 15 ionice -c 3 python3 -I -B -'], input=code.encode(),
                            capture_output=True, timeout=timeout)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise ValueError('Remote lifecycle ' + operation + ' refused')
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    prepare = sub.add_parser('plan')
    prepare.add_argument('--output', type=Path, required=True)
    install = sub.add_parser('install')
    install.add_argument('--plan', type=Path, required=True)
    install.add_argument('--plan-sha256', required=True)
    upgrade_plan = sub.add_parser('plan-upgrade')
    upgrade_plan.add_argument('--interruption', type=Path, required=True)
    upgrade_plan.add_argument('--interruption-sha256', required=True)
    upgrade_plan.add_argument('--config-sha256', required=True)
    upgrade_plan.add_argument('--state-sha256', required=True)
    upgrade_plan.add_argument('--output', type=Path, required=True)
    completed_plan = sub.add_parser('plan-upgrade-complete')
    completed_plan.add_argument('--config-sha256', required=True)
    completed_plan.add_argument('--state-sha256', required=True)
    completed_plan.add_argument('--output', type=Path, required=True)
    repair_plan = sub.add_parser('plan-upgrade-config-repair')
    repair_plan.add_argument('--guard-refusal', type=Path, required=True)
    repair_plan.add_argument('--guard-refusal-sha256', required=True)
    repair_plan.add_argument('--config-sha256', required=True)
    repair_plan.add_argument('--state-sha256', required=True)
    repair_plan.add_argument('--output', type=Path, required=True)
    upgrade = sub.add_parser('upgrade')
    upgrade.add_argument('--plan', type=Path, required=True)
    upgrade.add_argument('--plan-sha256', required=True)
    args = parser.parse_args()
    if args.operation in ('plan-upgrade-complete', 'plan-upgrade-config-repair'):
        payload = committed_payload()
        require(SHA.fullmatch(args.config_sha256) and SHA.fullmatch(args.state_sha256), 'Invalid upgrade binding')
        request = {'mode': 'completed-cycle', 'configSha256': args.config_sha256, 'stateSha256': args.state_sha256}
        if args.operation == 'plan-upgrade-config-repair':
            refusal = local_guard_refusal({'path': str(args.guard_refusal.resolve()), 'sha256': args.guard_refusal_sha256}, payload)
            request.update(mode='completed-config-repair', verificationPayload=payload, guardRefusal=refusal)
        plan = {'schema': 'pow-ui-retention-upgrade-plan-v1', 'scopeApprovalSha256': APPROVAL,
                'payload': payload, 'request': request, 'before': remote('upgrade-inventory', request)}
        output = args.output.absolute(); save(output, encoded(plan))
        print(json.dumps({'plan': str(output), 'sha256': sha(encoded(plan)),
                          'config': {'path': CONFIG, 'sha256': payload['configSha256']},
                          'preservedCompletedCycleId': plan['before']['completedReview']['lastCompleted']['cycleId'],
                          'freshPreparationRequired': False}))
    elif args.operation == 'plan-upgrade':
        payload = committed_payload()
        interruption = local_interruption({'path': str(args.interruption.resolve()), 'sha256': args.interruption_sha256})
        require(interruption['prepared']['stateSha256'] == args.state_sha256, 'Requested interrupted state differs')
        request = {'configSha256': args.config_sha256, 'stateSha256': args.state_sha256, 'interruption': interruption}
        plan = {'schema': 'pow-ui-retention-upgrade-plan-v1', 'scopeApprovalSha256': APPROVAL,
                'payload': payload, 'request': request, 'before': remote('upgrade-inventory', request)}
        local_interruption(interruption['binding'])
        output = args.output.absolute()
        require(output.parent.resolve() == output.parent, 'Unsafe local upgrade plan parent')
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded(plan)); stream.flush(); os.fsync(stream.fileno())
        sync(output.parent)
        print(json.dumps({'plan': str(args.output), 'sha256': sha(encoded(plan)),
                          'config': {'path': CONFIG, 'sha256': payload['configSha256']},
                          'supersededCycleId': interruption['prepared']['cycleId'], 'freshPreparationRequired': True}))
    elif args.operation == 'upgrade':
        raw = read_bound(args.plan, args.plan_sha256); plan = json.loads(raw)
        require(plan.get('schema') == 'pow-ui-retention-upgrade-plan-v1'
                and plan.get('scopeApprovalSha256') == APPROVAL, 'Upgrade plan authority differs')
        require(committed_payload() == plan['payload'], 'Committed package changed after review')
        if plan['request'].get('mode') == 'completed-config-repair':
            require(local_guard_refusal(plan['request']['guardRefusal']['binding'], plan['payload']) == plan['request']['guardRefusal'],
                    'Guard refusal evidence changed after review')
        elif plan['request'].get('mode') != 'completed-cycle':
            require(local_interruption(plan['request']['interruption']['binding']) == plan['request']['interruption'],
                    'Interrupted local custody context changed after review')
        print(json.dumps(remote('upgrade', plan)))
    elif args.operation == 'plan':
        payload = committed_payload()
        plan = {'schema': 'pow-ui-retention-install-plan-v1', 'scopeApprovalSha256': APPROVAL,
                'payload': payload, 'before': remote('inventory')}
        require(plan['before']['configAbsent'] and plan['before']['stateAbsent'], 'Existing lifecycle configuration')
        with args.output.open('xb') as stream:
            stream.write(encoded(plan))
        print(json.dumps({'plan': str(args.output), 'sha256': sha(encoded(plan)),
                          'config': {'path': CONFIG, 'sha256': payload['configSha256']}}))
    else:
        raw = args.plan.read_bytes()
        require(sha(raw) == args.plan_sha256, 'Reviewed install plan SHA differs')
        plan = json.loads(raw)
        require(plan.get('schema') == 'pow-ui-retention-install-plan-v1'
                and plan.get('scopeApprovalSha256') == APPROVAL, 'Install plan authority differs')
        require(committed_payload() == plan['payload'], 'Committed package changed after review')
        print(json.dumps(remote('install', plan)))


if __name__ == '__main__':
    main()
