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
SURFACES = 'activity boost browser computer desktop dns growth id inception infinity landing marketplace nft token wallet work'.split()
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
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        assert identity(os.fstat(source.fileno())) == identity(before)
        raw = source.read(maximum + 1)
        assert identity(os.fstat(source.fileno())) == identity(before)
    assert identity(path.lstat()) == identity(before) and len(raw) == before.st_size
    assert re.fullmatch('[0-9a-f]{64}', expected) and hashlib.sha256(raw).hexdigest() == expected
    return raw


def directory(path, create=False):
    path = Path(path)
    if create and not os.path.lexists(path):
        path.mkdir(mode=0o700)
    s = path.lstat()
    assert path.resolve() == path and stat.S_ISDIR(s.st_mode)
    assert s.st_uid == s.st_gid == 0 and not s.st_mode & 0o7022
    assert s.st_dev == BASE.stat().st_dev
    return path


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
            with path.open('rb') as source:
                sha = hashlib.file_digest(source, 'sha256').hexdigest()
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


assert sys.flags.isolated and os.geteuid() == os.getegid() == 0
os.umask(0o077); resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
plan_path, plan_sha, phase = sys.argv[1:]
assert phase in ('surfaces-stage', 'source')
p = json.loads(bound(plan_path, plan_sha, 65536)); release = p['releaseId']
assert re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release)
assert release.startswith(p['commit'][:12] + '-')
assert p['frontendOnly'] is True and p['retentionDeferred'] is True
assert plan_path == str(BASE / ('recovery-plan-' + release + '-' + p['publicationAttempt'] + '.json'))
unit = 'proofofwork-recovery-ui-transport-' + release + '-' + phase + '.service'
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
out = BASE / ('recovery-transport-' + release + '-' + phase)
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
kind = 'surfaces' if phase == 'surfaces-stage' else 'source'
allocation = p['admissions'][kind + '-receive']
run(['/usr/bin/python3', '-I', '-B', str(tools / 'release.py'), 'admit-ui',
    '--release-id', release, '--lock-fd', str(lock_fd), '--admission-id', 'recovery-' + kind + '-receive',
    '--additional-bytes', str(allocation['bytes']), '--additional-inodes', str(allocation['inodes']),
    '--helper-sha', 'capacity=' + helpers['capacity']['sha256']], 'receive-admission.log', timeout=120)
archive = ARCHIVES / ('proofofwork-ui-release-' + release + '.tgz')
if phase == 'source':
    checksum = Path(str(archive) + '.sha256').read_text().split()
    assert len(checksum) == 2 and checksum[1] == archive.name
    bound(archive, checksum[0], 2*1024**3)
part = p[kind]
run(['/usr/bin/python3', '-I', '-B', str(tools / 'stream-ui-bundle.py'), kind, release,
    str(part['compressedBytes']), part['sha256']], 'receiver.log',
    source=sys.stdin.buffer, length=part['compressedBytes'])
assert sys.stdin.buffer.read(1) == b'', 'Extra transport bytes'
stage = BASE / ('proofofwork-www-stage-' + release)
if phase == 'surfaces-stage':
    payload = BASE / ('proofofwork-ui-surfaces-' + release)
    receipt = json.loads((BASE / ('audit5-stream-surfaces-' + release + '.json')).read_bytes())
    assert receipt['status'] == 'verified' and receipt['archiveSha256'] == part['sha256']
    assert receipt['compressedBytes'] == part['compressedBytes'] and receipt['releaseId'] == release
    input_before = payload_fingerprint(payload)
    run(['/usr/bin/python3', '-I', '-B', str(tools / 'ui-capacity.py'), 'stage', str(payload / 'surfaces')], 'stage-model.json')
    model = json.loads((out / 'stage-model.json').read_bytes())
    assert model['inputStabilityVerified'] is True and model['installedStagerSha256'] == helpers['stager']['sha256']
    # The release archive lives outside scratch. Charge it only to actual disk.
    capacity('check-scratch', BASE, model['peakAdditionalBytes'] + EVIDENCE_RESERVE, 'stage')
    capacity('check', BASE, model['peakAdditionalBytes'] + p['stageArchiveUpperBoundBytes'] + EVIDENCE_RESERVE, 'stage')
    run([helpers['stager']['path'], '--release-id', release, '--surfaces-root', str(payload / 'surfaces'),
         '--stage-root', str(stage), '--deduplicate-managed-files'], 'stager.log', timeout=900)
    assert payload_fingerprint(payload) == input_before
    capacity('check', ARCHIVES, 65536, 'input-evidence', inodes=16)
    directory(EVIDENCE.parent)
    directory(EVIDENCE, create=True)
    evidence_root = EVIDENCE / release
    assert not os.path.lexists(evidence_root)
    evidence_root.mkdir(mode=0o700); sync(EVIDENCE)
    preserved = evidence_root / payload.name
    rename_new(payload, preserved)
    assert payload_fingerprint(preserved) == input_before
    durable_json(evidence_root / 'incoming-receipt.json', {'format': 'proof-of-work-ui-incoming-evidence-v1',
        'releaseId': release, 'commit': p['commit'], 'tree': p['tree'], 'planSha256': plan_sha,
        'receiverReceipt': receipt, 'preservedPath': str(preserved), 'payloadFingerprint': input_before,
        'movePreservedInodes': True, 'historicalDeletion': False, 'allPriorEvidencePreserved': True})
    run(['/usr/bin/python3', '-I', '-B', str(tools / 'ui-capacity.py'), 'managed', str(stage)], 'managed-model.json')
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
    capacity('check-scratch', BASE, p['admissions']['source-receive']['bytes'] + EVIDENCE_RESERVE, 'next-source')
    capacity('check', BASE, p['admissions']['source-receive']['bytes'] + EVIDENCE_RESERVE, 'next-source')
    durable_json(out / 'receipt.json', {'ok': True, 'releaseId': release, 'phase': phase,
        'managedArchive': str(archive), 'archiveSha256': archive_sha, 'preservedInput': str(preserved),
        'inputFingerprint': input_before, 'stageModel': model, 'productionPublished': False,
        'historicalDeletion': False})
else:
    source = BASE / ('proofofwork-ui-source-' + release)
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
        'candidateProvenanceVerified': True, 'productionPublished': False, 'historicalDeletion': False})
assert namespace['fingerprint'](Path('/var/www')) == live
print(json.dumps({'ok': True, 'releaseId': release, 'phase': phase, 'evidence': str(out),
                  'productionPublished': False, 'historicalDeletion': False}))
