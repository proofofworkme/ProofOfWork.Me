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
    return module.Runtime(config, digest, storage, policy)


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
    # One full old-controller verification authenticates all frozen candidates,
    # archives, retained sources, held ancestors and current/prior bytes. No old
    # plan is rebound or executed using the replacement controller.
    runtime.S.verify_plan(plan, runtime.layout)
    runtime.P.load_index(state['index']['path'], state['index']['sha256'], runtime.layout, APPROVAL)
    guards, _ = runtime.S.safeguards(runtime.layout)
    pair = plan['protected']
    context = {'pair': runtime.P.pair_ids(pair), 'guards': guards,
               'manifests': {k: runtime.S.hash_read(Path(pair[k]['path']) / '.proofofwork-ui-release')[0]
                             for k in ('current', 'previous')}}
    require(context == pending['context'] == intent['context'], 'Prepared protected pair/guards changed')
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
            'ordinarySnapshotsVerified': True, 'noRetirementStarted': True}


def upgrade_inventory(request, prefix=Path('/')):
    with deploy_lock(prefix):
        return upgrade_inventory_locked(request, prefix)


def upgrade_inventory_locked(request, prefix):
    for path in (prefix / EVIDENCE.lstrip('/')).glob('ui-lifecycle-upgrade-*'):
        require(path.is_dir() and not path.is_symlink() and (path / 'completed.json').is_file(),
                'Unsealed upgrade requires explicit reconciliation')
    runtime = existing_runtime(request['configSha256'], prefix)
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
        old_state = before['preparedReview']['state']
        old_config = json.loads(base64.b64decode(before['configBase64']))
        require(old_config['package'] != payload['config']['package'], 'Upgrade requires a new immutable package')
        package = at(payload['config']['package']['path'])
        journal = at(EVIDENCE) / ('ui-lifecycle-upgrade-' + payload['config']['package']['sha256'])
        require(not os.path.lexists(package) and not os.path.lexists(journal), 'Prior upgrade/package requires explicit reconciliation')
        planned = dict(old_state, configSha256=payload['configSha256'], revision=old_state['revision'] + 2,
                       status='retention-incomplete', pending=None, activePhase=None, completedContext=None,
                       lastUpgrade={'intentPath': str(journal / 'intent.json'),
                                    'completionPath': str(journal / 'completed.json'),
                                    'priorConfigSha256': plan['request']['configSha256'],
                                    'priorStateSha256': plan['request']['stateSha256'],
                                    'supersededCycleId': old_state['pending']['cycleId']})
        intent = {'schema': 'pow-ui-retention-upgrade-intent-v1', 'plan': plan,
                  'stateTemplate': planned, 'stateTemplateSha256': sha(encoded(planned)),
                  'disposition': 'prepared-before-custody-superseded', 'freshPreparationRequired': True}
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
        os.replace(state_next, at(STATE)); sync(at(STATE).parent)
        os.replace(config_next, at(CONFIG)); sync(at(CONFIG).parent)
        result = {'schema': 'pow-ui-retention-upgrade-completed-v1', 'ok': True,
                  'intent': {'path': str(journal / 'intent.json'), 'sha256': intent_sha},
                  'config': {'path': CONFIG, 'sha256': payload['configSha256']},
                  'state': {'path': STATE, 'sha256': sha(encoded(planned))}, 'stateRevision': planned['revision'],
                  'priorConfig': {'path': str(journal / 'prior-config.json'), 'sha256': plan['request']['configSha256']},
                  'priorState': {'path': str(journal / 'prior-state.json'), 'sha256': plan['request']['stateSha256']},
                  'supersededCycleId': old_state['pending']['cycleId'], 'index': planned['index'],
                  'freshPreparationRequired': True, 'retentionComplete': False, 'publicationHealthy': True,
                  'priorPackageAndPhaseEvidencePreserved': True, 'priorHelpersHoldsAndTimersPreserved': True}
        save(journal / 'completed.json', encoded(result))
        return dict(result, receipt={'path': str(journal / 'completed.json'), 'sha256': sha(encoded(result))})


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
    result = subprocess.run([*SSH, 'nice -n 15 ionice -c 3 python3 -I -B -'], input=code.encode(),
                            capture_output=True, timeout=1800 if operation.startswith('upgrade') else 180)
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
    upgrade = sub.add_parser('upgrade')
    upgrade.add_argument('--plan', type=Path, required=True)
    upgrade.add_argument('--plan-sha256', required=True)
    args = parser.parse_args()
    if args.operation == 'plan-upgrade':
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
