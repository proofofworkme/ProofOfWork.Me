"""Receive an exact UI release, retain its input, and stage without old-artifact deletion.

Runs only in its dedicated root systemd cgroup after the release operator dispatches.
No publication, service/config changes, pruning, or historical path changes occur.
"""
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import selectors
import signal
import stat
import subprocess
import sys
import time

BASE = Path('/var/tmp/proofofwork-deploy')
EVIDENCE = Path('/var/backups/proofofwork-ui/transport-evidence')
ARCHIVES = Path('/var/backups/proofofwork-ui/releases')
SURFACES = 'activity boost browser computer desktop dns growth id inception infinity landing marketplace nft publish token wallet work'.split()
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}
EVIDENCE_RESERVE = 32*1024**2
TOTAL_LOG_CEILING = 16*1024**2
captured_log_bytes = 0


def identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def bound(path, expected, maximum=2*1024**2):
    path = Path(path); before = path.lstat()
    assert path.resolve() == path and stat.S_ISREG(before.st_mode)
    assert before.st_uid == before.st_gid == 0 and before.st_nlink == 1
    assert not before.st_mode & 0o7022 and before.st_size <= maximum
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME), 'rb') as source:
        assert identity(os.fstat(source.fileno())) == identity(before)
        raw = source.read(maximum + 1)
        assert identity(os.fstat(source.fileno())) == identity(before)
    assert identity(path.lstat()) == identity(before) and len(raw) == before.st_size
    assert re.fullmatch('[0-9a-f]{64}', expected) and hashlib.sha256(raw).hexdigest() == expected
    return raw


def bounded_record(path, maximum=65536):
    """Read a newly generated record only after finite identity/type admission."""
    path = Path(path); before = path.lstat()
    assert path.resolve() == path and stat.S_ISREG(before.st_mode)
    assert before.st_uid == before.st_gid == 0 and before.st_nlink == 1
    assert not before.st_mode & 0o7022 and before.st_size <= maximum
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME), 'rb') as source:
        assert identity(os.fstat(source.fileno())) == identity(before)
        raw = source.read(maximum + 1)
        assert identity(os.fstat(source.fileno())) == identity(before)
    assert identity(path.lstat()) == identity(before) and len(raw) == before.st_size
    return raw, hashlib.sha256(raw).hexdigest()

def directory(path, create=False):
    path = Path(path)
    if create and not os.path.lexists(path):
        path.mkdir(mode=0o700)
    s = path.lstat()
    assert path.resolve() == path and stat.S_ISDIR(s.st_mode)
    assert s.st_uid == s.st_gid == 0 and not s.st_mode & 0o7022
    assert s.st_dev == BASE.stat().st_dev
    return path


def validate_evidence_ancestors(release, *, require_release=False, mountinfo=Path('/proc/self/mountinfo')):
    """Admit the exact evidence pool before mkdir, rename or extraction."""
    assert re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release)
    release_root = EVIDENCE / release
    ancestors = (EVIDENCE.parent.parent, EVIDENCE.parent, EVIDENCE, release_root)
    device = BASE.stat().st_dev
    for index, path in enumerate(ancestors):
        if not os.path.lexists(path):
            assert index >= 2 and not require_release, 'Required evidence ancestor missing'
            assert path.resolve() == path
            continue
        details = path.lstat()
        assert path.resolve() == path and stat.S_ISDIR(details.st_mode)
        assert details.st_uid == details.st_gid == 0 and not details.st_mode & 0o7022
        assert details.st_dev == device, 'Evidence ancestor crosses the UI filesystem'
    details = mountinfo.lstat()
    assert stat.S_ISREG(details.st_mode) and not stat.S_ISLNK(details.st_mode)
    with mountinfo.open(encoding='utf-8') as stream:
        for line in stream:
            fields = line.split(); assert len(fields) >= 5
            mounted = Path(fields[4].replace('\\040', ' ').replace('\\011', '\t')
                           .replace('\\012', '\n').replace('\\134', '\\')).resolve()
            assert mounted not in ancestors and mounted != release_root and release_root not in mounted.parents, 'Mounted evidence ancestor or nested release path'
    return release_root


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_json(path, data):
    with path.open('x') as output:
        json.dump(data, output, indent=2); output.write('\n')
        output.flush(); os.fsync(output.fileno())
    sync(path.parent)


def rename_new(source, target):
    assert not os.path.lexists(target) and source.stat().st_dev == target.parent.stat().st_dev
    libc = ctypes.CDLL(None, use_errno=True)
    fn = libc.renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    before = (source.stat().st_dev, source.stat().st_ino)
    if fn(-100, os.fsencode(source), -100, os.fsencode(target), 1):
        raise OSError(ctypes.get_errno(), 'Non-replacing evidence rename failed')
    assert not os.path.lexists(source) and (target.stat().st_dev, target.stat().st_ino) == before
    sync(source.parent); sync(target.parent)


def payload_fingerprint(root):
    rows = []
    for path in [root, *sorted(root.rglob('*'))]:
        s = path.lstat()
        assert path.resolve() == path and s.st_dev == root.stat().st_dev
        assert s.st_uid == s.st_gid == 0 and not s.st_mode & 0o7022
        assert stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)
        kind = 'directory' if stat.S_ISDIR(s.st_mode) else 'file'
        sha = None
        if kind == 'file':
            assert s.st_nlink == 1
            with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME), 'rb') as source:
                assert identity(os.fstat(source.fileno())) == identity(s)
                sha = hashlib.file_digest(source, 'sha256').hexdigest()
                assert identity(os.fstat(source.fileno())) == identity(s)
            assert identity(path.lstat()) == identity(s)
        rows.append([path.relative_to(root).as_posix(), kind, stat.S_IMODE(s.st_mode),
                     s.st_uid, s.st_gid, s.st_size if kind == 'file' else 0, sha])
    return {'sha256': hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest(),
            'entries': len(rows), 'regularBytes': sum(row[5] for row in rows)}


def run(argv, name, *, source=None, length=0, extra=None, timeout=600, file_limit=2*1024**3):
    global captured_log_bytes
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
    with (out / name).open('xb') as log:
        child = subprocess.Popen(argv, env={**env, **(extra or {})}, cwd='/',
            stdin=subprocess.PIPE if source else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            pass_fds=(lock_fd,), start_new_session=True, preexec_fn=limits)
        selector = selectors.DefaultSelector(); selector.register(child.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout; count = 0
        try:
            if source:
                remaining = length
                while remaining:
                    data = source.read(min(65536, remaining)); assert data, 'Truncated input'
                    child.stdin.write(data); remaining -= len(data)
                child.stdin.close()
            while selector.get_map():
                assert time.monotonic() < deadline, 'Child deadline exceeded'
                for key, _ in selector.select(timeout=0.5):
                    data = os.read(key.fileobj.fileno(), 65536)
                    if not data:
                        selector.unregister(key.fileobj); continue
                    count += len(data); captured_log_bytes += len(data)
                    assert count <= 4*1024**2 and captured_log_bytes <= TOTAL_LOG_CEILING, 'Child log bound exceeded'
                    log.write(data)
            assert child.wait(timeout=max(0.001, deadline-time.monotonic())) == 0, name
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=15)
            if child.stdin and not child.stdin.closed: child.stdin.close()
            selector.close(); child.stdout.close()
            log.flush(); os.fsync(log.fileno())


def capacity(command, path, amount, phase, inodes=10000):
    name = phase + '-' + command + '.json'
    run(['/usr/bin/python3', '-I', '-B', helpers['capacity']['path'], command,
         '--path', str(path), '--additional-bytes', str(amount),
         '--additional-inodes', str(inodes), '--phase', 'recovery-' + phase], name, timeout=90)
    return json.loads((out / name).read_bytes())


def validate_resume(plan):
    """Recognize one exact failed admission; no broad retry or namespace reuse."""
    resume = plan['resumeSurfaces']; release = plan['releaseId']
    failed_root = BASE / ('recovery-transport-' + release + '-surfaces-stage')
    assert resume['failedEvidence'] == str(failed_root)
    directory(failed_root)
    original = json.loads(bound(resume['failedPlanPath'], resume['failedPlanSha256'], 65536))
    assert resume['failedPlanPath'] == str(BASE / ('recovery-plan-' + release + '-' + original['publicationAttempt'] + '.json'))
    assert original['publicationAttempt'] != plan['publicationAttempt']
    for key in ('releaseId', 'commit', 'tree', 'source', 'surfaces', 'oldLiveManifestSha256', 'oldFullRootTreeSha256', 'retainedRoots'):
        assert original[key] == plan[key]
    expected = {'intent.json', 'receive-admission.log', 'receiver.log', 'stage-model.json', 'stage-check-scratch.json'}
    assert set(resume['failedRecords']) == expected
    records = {}
    for name, pin in resume['failedRecords'].items():
        raw = bound(failed_root / name, pin['sha256'], 65536)
        assert len(raw) == pin['bytes']; records[name] = raw
    assert not os.path.lexists(failed_root / 'stager.log') and not os.path.lexists(failed_root / 'receipt.json')
    intent = json.loads(records['intent.json'])
    assert intent['planSha256'] == resume['failedPlanSha256'] and intent['phase'] == 'surfaces-stage'
    failure = records['stage-check-scratch.json'].decode()
    prefix = 'UI deployment scratch review required '
    assert failure.startswith(prefix)
    admission = json.loads(failure[len(prefix):])
    assert admission['maximumBytes'] == 5*1024**3 and admission['cleanupApproved'] is False
    assert admission['phase'] == 'recovery-stage' and admission['path'] == str(BASE)
    assert admission['allocatedBytes'] + admission['additionalBytes'] > admission['maximumBytes']
    receipt_path = BASE / ('audit5-stream-surfaces-' + release + '.json')
    assert resume['receiverReceiptPath'] == str(receipt_path)
    receipt = json.loads(bound(receipt_path, resume['receiverReceiptSha256'], 65536))
    assert json.loads(records['receiver.log']) == receipt
    return receipt


def validate_preserved_stage(plan):
    """Recognize only an already preserved input and exact full-copy refusal."""
    resume = plan['preservedStageResume']; release = plan['releaseId']
    original = json.loads(bound(resume['failedPlanPath'], resume['failedPlanSha256'], 65536))
    assert resume['failedPlanPath'] == str(BASE / ('recovery-plan-' + release + '-' + original['publicationAttempt'] + '.json'))
    assert original['publicationAttempt'] != plan['publicationAttempt']
    assert original['inputStorage'] == 'release-evidence-v1' and original['resumeSurfaces']
    assert 'preservedStageResume' not in original
    for key in ('releaseId', 'commit', 'tree', 'source', 'surfaces', 'surfacesPayloadFingerprint',
                'preservedSurfacesRoot', 'preservedSourceCheckout', 'oldLiveManifestSha256', 'oldFullRootTreeSha256', 'retainedRoots'):
        assert original[key] == plan[key]
    failed = BASE / ('recovery-transport-' + release + '-surfaces-stage-resume-' + original['publicationAttempt'])
    assert resume['failedEvidence'] == str(failed); directory(failed)
    names = {'intent.json', 'input-evidence-check.json', 'stage-model.json', 'stage-check-scratch.json', 'stage-check.json', 'stager.log'}
    assert set(resume['failedRecords']) == names
    records = {}
    for name, pin in resume['failedRecords'].items():
        raw = bound(failed / name, pin['sha256'], 65536)
        assert len(raw) == pin['bytes']; records[name] = raw
    assert {path.name for path in failed.iterdir()} == names
    intent = json.loads(records['intent.json'])
    assert intent['planSha256'] == resume['failedPlanSha256'] and intent['phase'] == 'surfaces-stage-resume'
    prefix = 'UI deployment scratch review required '
    refusal = records['stager.log'].decode(); assert refusal.startswith(prefix)
    refusal = json.loads(refusal[len(prefix):])
    assert refusal == resume['fullCopyRefusal']
    assert refusal['phase'] == 'stage-private-root' and refusal['path'] == str(BASE)
    assert refusal['maximumBytes'] == 5*1024**3 and refusal['cleanupApproved'] is False
    assert refusal['allocatedBytes'] + refusal['additionalBytes'] > refusal['maximumBytes']
    assert json.loads(records['stage-check-scratch.json'])['status'] == 'sufficient'
    assert json.loads(records['stage-check.json'])['status'] == 'sufficient'
    assert json.loads(records['stage-model.json'])['inputStabilityVerified'] is True
    assert resume['candidateStorage'] == 'release-evidence-v1'
    private = EVIDENCE / release / ('.proofofwork-ui-stage-' + release + '.' + plan['publicationAttempt'])
    assert resume['privateCandidateParent'] == str(private) and not os.path.lexists(private)
    validate_evidence_ancestors(release, require_release=True)
    incoming_path = EVIDENCE / release / 'incoming-receipt.json'
    assert resume['incomingReceiptPath'] == str(incoming_path)
    raw = bound(incoming_path, resume['incomingReceiptSha256'], 65536)
    assert len(raw) == resume['incomingReceiptBytes']
    incoming = json.loads(raw)
    assert incoming['format'] == 'proof-of-work-ui-incoming-evidence-v1'
    assert incoming['releaseId'] == release and incoming['commit'] == plan['commit'] and incoming['tree'] == plan['tree']
    assert incoming['planSha256'] == resume['failedPlanSha256']
    assert incoming['payloadFingerprint'] == plan['surfacesPayloadFingerprint']
    assert incoming['preservedPath'] == str(Path(plan['preservedSurfacesRoot']).parent)
    assert incoming['movePreservedInodes'] is True and incoming['historicalDeletion'] is False
    assert incoming['receiverReceipt'] == validate_resume(original)
    assert not os.path.lexists(BASE / ('proofofwork-ui-surfaces-' + release))
    assert not list((EVIDENCE / release).glob('.proofofwork-ui-stage-*'))
    return incoming

def source_receiver_code(receiver_path, receiver_sha, evidence_root):
    """Invoke the unmodified pinned receiver function in its exact release pool."""
    receiver = bound(receiver_path, receiver_sha)
    return "__name__ = '_pinned_preserved_source_receiver'\n" + receiver.decode() + "\n" + (
        "assert os.geteuid() == os.getegid() == 0\n"
        "mode, release, length, expected, parent = sys.argv[1:]\n"
        "assert mode == 'source' and RELEASE.fullmatch(release)\n"
        "assert parent == '/var/backups/proofofwork-ui/transport-evidence/' + release\n"
        "print(json.dumps(receive(mode, release, int(length), expected, sys.stdin.buffer, Path(parent), "
        "Path('/run/proofofwork-ui/deploy.lock'))))\n")


assert sys.flags.isolated and os.geteuid() == os.getegid() == 0
os.umask(0o077); resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
plan_path, plan_sha, phase = sys.argv[1:]
assert phase in ('surfaces-stage', 'surfaces-stage-resume', 'preserved-stage-resume', 'source')
p = json.loads(bound(plan_path, plan_sha, 65536)); release = p['releaseId']
assert re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release)
assert release.startswith(p['commit'][:12] + '-')
assert p['frontendOnly'] is True and p['retentionDeferred'] is True
assert p['inputStorage'] == 'release-evidence-v1'
evidence_root = EVIDENCE / release
assert p['preservedSourceCheckout'] == str(evidence_root / ('proofofwork-ui-source-' + release))
assert p['preservedSurfacesRoot'] == str(evidence_root / ('proofofwork-ui-surfaces-' + release) / 'surfaces')
assert re.fullmatch('[a-z0-9][a-z0-9-]{0,30}', p['publicationAttempt'])
assert plan_path == str(BASE / ('recovery-plan-' + release + '-' + p['publicationAttempt'] + '.json'))
unit = 'proofofwork-recovery-ui-transport-' + release + '-' + phase + '-' + p['publicationAttempt'] + '.service'
fields = dict(line.split('=', 1) for line in subprocess.check_output([
    '/usr/bin/systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'MainPID',
    '-p', 'KillMode', '-p', 'RuntimeMaxUSec', '-p', 'ControlGroup'], env=ENV, text=True, timeout=10).splitlines())
assert fields['ActiveState'] == 'active' and fields['MainPID'] == str(os.getpid())
assert fields['KillMode'] == 'control-group' and fields['RuntimeMaxUSec'] == '20min'
assert fields['ControlGroup'].endswith('/' + unit)
assert any(line.endswith(':' + fields['ControlGroup']) for line in Path('/proc/self/cgroup').read_text().splitlines())
lock = Path('/run/proofofwork-ui/deploy.lock'); before = lock.lstat()
assert lock.resolve() == lock and stat.S_ISREG(before.st_mode)
assert before.st_uid == before.st_gid == 0 and before.st_nlink == 1 and not before.st_mode & 0o7022
lock_fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
assert identity(os.fstat(lock_fd)) == identity(before) and identity(lock.lstat()) == identity(before)
fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
env = {**ENV, 'POW_UI_DEPLOY_LOCK_FD': str(lock_fd)}
directory(BASE); directory(ARCHIVES)
helpers = p['publicationHelpers']
phase_capacity_source = p['phaseCapacity']['source']
assert isinstance(phase_capacity_source, str) and len(phase_capacity_source.encode()) <= 32768
assert hashlib.sha256(phase_capacity_source.encode()).hexdigest() == p['phaseCapacity']['sha256']
for record in helpers.values(): bound(record['path'], record['sha256'])
tools = BASE / 'audit29-tools'
for key, filename in [('controller', 'release.py'), ('receiver', 'stream-ui-bundle.py'),
                      ('phase-capacity', 'ui-capacity.py')]:
    bound(tools / filename, p['helperSha256'][key])
namespace = {'__name__': '_recovery_transport_live_binding'}
exec(compile(bound(helpers['retained']['path'], helpers['retained']['sha256']),
             helpers['retained']['path'], 'exec'), namespace)
live = namespace['fingerprint'](Path('/var/www'))
assert live['manifestSha256'] == p['oldLiveManifestSha256'] and live['treeSha256'] == p['oldFullRootTreeSha256']
retained = sorted(Path('/var/backups/proofofwork-ui/rollback-roots').glob('proofofwork-www-pre-*'))
assert [str(path) for path in retained] == [record['root'] for record in p['retainedRoots']]
for path, record in zip(retained, p['retainedRoots']):
    value = namespace['fingerprint'](path)
    assert value['manifestSha256'] == record['manifestSha256'] and value['treeSha256'] == record['treeSha256']
out = BASE / ('recovery-transport-' + release + '-' + phase + '-' + p['publicationAttempt'])
assert not os.path.lexists(out)
# Existing installed capacity checks run before this bounded receipt directory.
for command in ('check-scratch', 'check'):
    subprocess.run(['/usr/bin/python3', '-I', '-B', helpers['capacity']['path'], command,
        '--path', str(BASE), '--additional-bytes', str(EVIDENCE_RESERVE),
        '--additional-inodes', '32', '--phase', 'recovery-transport-evidence'],
        env=env, pass_fds=(lock_fd,), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=90, check=True)
out.mkdir(mode=0o700); sync(BASE)
durable_json(out / 'intent.json', {'releaseId': release, 'commit': p['commit'], 'tree': p['tree'],
    'phase': phase, 'planSha256': plan_sha, 'continuousParentLock': True,
    'historicalDeletion': False, 'retentionDeferred': True})
kind = 'source' if phase == 'source' else 'surfaces'
allocation = p['admissions'][kind + '-receive']
archive = ARCHIVES / ('proofofwork-ui-release-' + release + '.tgz')
part = p[kind]
if phase == 'source':
    checksum = Path(str(archive) + '.sha256').read_text().split()
    assert len(checksum) == 2 and checksum[1] == archive.name
    bound(archive, checksum[0], 2*1024**3)
    validate_evidence_ancestors(release, require_release=True)
    directory(EVIDENCE.parent); directory(EVIDENCE); directory(evidence_root)
    # Source extraction is durable evidence, charged to disk but never scratch.
    capacity('check-scratch', BASE, EVIDENCE_RESERVE, 'source-evidence', inodes=32)
    capacity('check', evidence_root, allocation['bytes'] + EVIDENCE_RESERVE, 'source-receive', inodes=allocation['inodes'])
    receiver_code = source_receiver_code(tools / 'stream-ui-bundle.py', p['helperSha256']['receiver'], evidence_root)
    run(['/usr/bin/python3', '-I', '-B', '-c', receiver_code, kind, release,
         str(part['compressedBytes']), part['sha256'], str(evidence_root)], 'receiver.log',
         source=sys.stdin.buffer, length=part['compressedBytes'])
elif phase == 'surfaces-stage':
    assert 'resumeSurfaces' not in p and 'preservedStageResume' not in p
    run(['/usr/bin/python3', '-I', '-B', str(tools / 'release.py'), 'admit-ui',
        '--release-id', release, '--lock-fd', str(lock_fd), '--admission-id', 'recovery-' + kind + '-receive-' + p['publicationAttempt'],
        '--additional-bytes', str(allocation['bytes']), '--additional-inodes', str(allocation['inodes']),
        '--helper-sha', 'capacity=' + helpers['capacity']['sha256']], 'receive-admission.log', timeout=120)
    run(['/usr/bin/python3', '-I', '-B', str(tools / 'stream-ui-bundle.py'), kind, release,
         str(part['compressedBytes']), part['sha256']], 'receiver.log',
         source=sys.stdin.buffer, length=part['compressedBytes'])
assert sys.stdin.buffer.read(1) == b'', 'Extra transport bytes'
stage = BASE / ('proofofwork-www-stage-' + release)
if phase != 'source':
    if phase == 'preserved-stage-resume':
        assert 'resumeSurfaces' not in p
        incoming = validate_preserved_stage(p)
        preserved = Path(incoming['preservedPath']); directory(preserved)
        input_before = payload_fingerprint(preserved)
        assert input_before == p['surfacesPayloadFingerprint']
        receipt = incoming['receiverReceipt']
    else:
        payload = BASE / ('proofofwork-ui-surfaces-' + release)
        receipt = validate_resume(p) if phase == 'surfaces-stage-resume' else json.loads((BASE / ('audit5-stream-surfaces-' + release + '.json')).read_bytes())
        assert receipt['status'] == 'verified' and receipt['archiveSha256'] == part['sha256']
        assert receipt['compressedBytes'] == part['compressedBytes'] and receipt['releaseId'] == release
        assert receipt['kind'] == 'surfaces' and receipt['extractedRoot'] == str(payload)
        assert not os.path.lexists(stage)
        for target in (archive, Path(str(archive)+'.sha256'), Path(str(archive)+'.provenance')):
            assert not os.path.lexists(target)
        input_before = payload_fingerprint(payload)
        assert input_before == p['surfacesPayloadFingerprint'], 'Received surface bytes differ from pinned local archive'
        assert receipt['entries'] == input_before['entries'] and receipt['logicalBytes'] == input_before['regularBytes']
        validate_evidence_ancestors(release)
        capacity('check', ARCHIVES, 65536, 'input-evidence', inodes=16)
        directory(EVIDENCE.parent); directory(EVIDENCE, create=True)
        assert not os.path.lexists(evidence_root)
        evidence_root.mkdir(mode=0o700); sync(EVIDENCE)
        validate_evidence_ancestors(release, require_release=True)
        preserved = evidence_root / payload.name
        durable_json(evidence_root / 'incoming-intent.json', {'releaseId': release, 'planSha256': plan_sha,
            'oldPath': str(payload), 'preservedPath': str(preserved), 'payloadFingerprint': input_before,
            'historicalDeletion': False})
        rename_new(payload, preserved)
        assert payload_fingerprint(preserved) == input_before
        durable_json(evidence_root / 'incoming-receipt.json', {'format': 'proof-of-work-ui-incoming-evidence-v1',
            'releaseId': release, 'commit': p['commit'], 'tree': p['tree'], 'planSha256': plan_sha,
            'receiverReceipt': receipt, 'preservedPath': str(preserved), 'payloadFingerprint': input_before,
            'movePreservedInodes': True, 'historicalDeletion': False, 'allPriorEvidencePreserved': True})
    assert receipt['status'] == 'verified' and receipt['archiveSha256'] == part['sha256']
    assert receipt['compressedBytes'] == part['compressedBytes'] and receipt['releaseId'] == release
    assert receipt['entries'] == input_before['entries'] and receipt['logicalBytes'] == input_before['regularBytes']
    assert not os.path.lexists(stage)
    for target in (archive, Path(str(archive)+'.sha256'), Path(str(archive)+'.provenance')):
        assert not os.path.lexists(target)
    model_args = [str(evidence_root)] if phase == 'preserved-stage-resume' else []
    run(['/usr/bin/python3', '-I', '-B', '-c', phase_capacity_source, 'stage', str(preserved / 'surfaces'), helpers['stager']['sha256'], *model_args], 'stage-model.json')
    model = json.loads((out / 'stage-model.json').read_bytes())
    assert model['inputStabilityVerified'] is True and model['installedStagerSha256'] == helpers['stager']['sha256']
    # The release archive lives outside scratch. Charge it only to actual disk.
    if phase == 'preserved-stage-resume':
        # No private candidate enters scratch until the installed stager has
        # measured its actual completed inodes and admitted that exact amount.
        capacity('check-scratch', BASE, EVIDENCE_RESERVE, 'stage-evidence', inodes=32)
        full_copy = model['canonicalFullLogicalCopyBound']
        assert full_copy['allocationPath'] == str(evidence_root)
        capacity('check', evidence_root, max(full_copy['additionalBytes'], model['peakAdditionalBytes']) +
                 p['stageArchiveUpperBoundBytes'] + EVIDENCE_RESERVE, 'stage-evidence')
        stager_args = ['--preserved-build-attempt', p['publicationAttempt'],
                       '--preserved-input-receipt-sha256', p['preservedStageResume']['incomingReceiptSha256']]
    else:
        capacity('check-scratch', BASE, model['peakAdditionalBytes'] + EVIDENCE_RESERVE, 'stage')
        capacity('check', BASE, model['peakAdditionalBytes'] + p['stageArchiveUpperBoundBytes'] + EVIDENCE_RESERVE, 'stage')
        stager_args = []
    run([helpers['stager']['path'], '--release-id', release, '--surfaces-root', str(preserved / 'surfaces'),
         '--stage-root', str(stage), '--deduplicate-managed-files', *stager_args], 'stager.log', timeout=900)
    if phase == 'preserved-stage-resume':
        private = Path(p['preservedStageResume']['privateCandidateParent'])
        directory(private); assert not os.path.lexists(private / 'candidate')
        allocation_path = private / 'completed-candidate-allocation.json'
        allocation_raw, allocation_sha = bounded_record(allocation_path)
        measured = json.loads(allocation_raw)
        assert measured['model'] == 'completed-candidate-unique-inodes-v1'
        assert measured['releaseId'] == release and measured['attempt'] == p['publicationAttempt']
        assert measured['incomingReceiptSha256'] == p['preservedStageResume']['incomingReceiptSha256']
        assert measured['stageRoot'] == str(stage) and measured['candidate'] == str(private / 'candidate')
        assert measured['historicalDeletion'] is False
        durable_json(out / 'completed-candidate-allocation.json', {**measured, 'measurementSha256': allocation_sha})
    assert payload_fingerprint(preserved) == input_before
    run(['/usr/bin/python3', '-I', '-B', '-c', phase_capacity_source, 'managed', str(stage)], 'managed-model.json')
    managed = json.loads((out / 'managed-model.json').read_bytes())
    upper = managed['archiveUpperBoundBytes']; assert upper <= p['stageArchiveUpperBoundBytes']
    capacity('check', ARCHIVES, upper + 65536, 'archive', inodes=16)
    for target in (archive, Path(str(archive)+'.sha256'), Path(str(archive)+'.provenance')):
        assert not os.path.lexists(target)
    archive_base = evidence_root / 'archive-base'
    archive_base.mkdir(mode=0o700); (archive_base / 'surfaces').mkdir(mode=0o755)
    temporary = evidence_root / ('proofofwork-ui-release-' + release + '.tgz.incoming')
    run(['/usr/bin/tar', '--sort=name', '--create', '--gzip', '--hard-dereference',
        '--file', str(temporary), '--transform=s|^proofofwork-|surfaces/|',
        '--directory', str(archive_base), 'surfaces', '--directory', str(stage),
        *['proofofwork-' + name for name in SURFACES]], 'archive.log', timeout=600)
    assert temporary.stat().st_size <= upper
    temporary.chmod(0o644)
    with temporary.open('rb') as source:
        archive_sha = hashlib.file_digest(source, 'sha256').hexdigest()
    checksum_temporary = evidence_root / 'archive.sha256.incoming'
    with checksum_temporary.open('x') as output:
        output.write(archive_sha + '  ' + archive.name + '\n'); output.flush(); os.fsync(output.fileno())
    checksum_temporary.chmod(0o644); sync(temporary)
    rename_new(checksum_temporary, Path(str(archive)+'.sha256'))
    rename_new(temporary, archive)
    capacity('check-scratch', BASE, EVIDENCE_RESERVE, 'next-source', inodes=32)
    capacity('check', evidence_root, p['admissions']['source-receive']['bytes'] + EVIDENCE_RESERVE, 'next-source',
             inodes=p['admissions']['source-receive']['inodes'])
    durable_json(out / 'receipt.json', {'ok': True, 'releaseId': release, 'phase': phase,
        'managedArchive': str(archive), 'archiveSha256': archive_sha, 'preservedInput': str(preserved),
        'inputFingerprint': input_before, 'stageModel': model,
        'candidateStorage': 'release-evidence-v1' if phase == 'preserved-stage-resume' else 'deploy-scratch',
        'completedCandidateAllocation': measured if phase == 'preserved-stage-resume' else None, 'productionPublished': False,
        'historicalDeletion': False})
else:
    source = Path(p['preservedSourceCheckout'])
    source_receipt_path = evidence_root / ('audit5-stream-source-' + release + '.json')
    source_receipt = json.loads(source_receipt_path.read_bytes())
    assert source_receipt['status'] == 'verified' and source_receipt['kind'] == 'source'
    assert source_receipt['releaseId'] == release and source_receipt['extractedRoot'] == str(source)
    assert source_receipt['compressedBytes'] == p['source']['compressedBytes']
    assert source_receipt['archiveSha256'] == p['source']['sha256']
    for ref, expected in [('HEAD', p['commit']), ('HEAD^{tree}', p['tree'])]:
        run(['/usr/bin/git', '-C', str(source), 'rev-parse', ref], 'git-' + ('commit' if ref == 'HEAD' else 'tree') + '.txt', timeout=30)
        assert (out / ('git-' + ('commit' if ref == 'HEAD' else 'tree') + '.txt')).read_text().strip() == expected
    assert subprocess.run(['/usr/bin/git', '-C', str(source), 'symbolic-ref', '-q', 'HEAD'], env=env,
                          stdout=subprocess.DEVNULL, timeout=30).returncode == 1
    run(['/usr/bin/git', '-C', str(source), 'status', '--porcelain', '--untracked-files=all'], 'git-status.txt', timeout=60)
    assert not (out / 'git-status.txt').read_bytes()
    run([helpers['provenance']['path'], 'verify-candidate', '--release-id', release,
         '--commit', p['commit'], '--source-checkout', str(source), '--archive', str(archive)],
        'candidate-provenance.log', extra={'POW_UI_WWW_ROOT': str(stage), 'POW_UI_STAGED_ROOT': '1'}, timeout=600)
    durable_json(out / 'receipt.json', {'ok': True, 'releaseId': release, 'phase': phase,
        'commit': p['commit'], 'tree': p['tree'], 'detachedSourceClean': True,
        'sourceCheckout': str(source), 'receiverReceipt': source_receipt,
        'receiverReceiptSha256': hashlib.sha256(source_receipt_path.read_bytes()).hexdigest(),
        'candidateProvenanceVerified': True, 'productionPublished': False, 'historicalDeletion': False})
assert namespace['fingerprint'](Path('/var/www')) == live
for path, record in zip(retained, p['retainedRoots']):
    value = namespace['fingerprint'](path)
    assert value['manifestSha256'] == record['manifestSha256'] and value['treeSha256'] == record['treeSha256']
print(json.dumps({'ok': True, 'releaseId': release, 'phase': phase, 'evidence': str(out),
                  'productionPublished': False, 'historicalDeletion': False}))
