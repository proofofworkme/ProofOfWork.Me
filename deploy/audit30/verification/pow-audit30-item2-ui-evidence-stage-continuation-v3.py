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


import base64
RELEASE = '38ac6e2bff2a-20261003T190512Z'
COMMIT = '38ac6e2bff2ac16890724e5213346ef8a3ebd186'
TREE = '8b9b5e3cd47aa8e4204da717350a629176e30da6'
PLAN_SHA = 'ebb2f481c499f5e25d0787fd59c537b4ebff30c2c6afc93959361370eda07104'
PLAN_PATH = BASE / ('recovery-plan-' + RELEASE + '-item2-v1.json')
PACKAGE_TOP = Path('/usr/local/lib/proofofwork-audit30-item2-ui-evidence-stage-v2')
PACKAGE = PACKAGE_TOP / RELEASE
EVIDENCE_ROOT = EVIDENCE / RELEASE
SOURCE_ROOT = EVIDENCE_ROOT / ('proofofwork-ui-source-' + RELEASE)
PAYLOAD = BASE / ('proofofwork-ui-surfaces-' + RELEASE)
PRESERVED = EVIDENCE_ROOT / PAYLOAD.name
EXPECTED_PAYLOAD = {'sha256': '701e484a90883cdd1a3d9c015f54ba25d6f804460e4943dcdd0c78f0bfa0b5e5',
                    'entries': 818, 'regularBytes': 219997417}
HELPER_PINS = {'proofofwork-ui-capacity.py': ('ea6745b2519d57fbd08deff723e81540d4dad2b4c649ff7e6c2b060a7e7edbb6', 13570), 'stager.py': ('4158d7898c4a90d3adfc9bb7e8160054f7c6b4e1f4b36cc42b2504faef0f6beb', 59017), 'receiver.py': ('7e40dc14691d3c239c242ee2f543093856cbf84450094deb1b0edb06669b0d7f', 8449), 'provenance.sh': ('ac22cacbfcb94311efc05e9e4e10edd18a54216b617f4b33f952a3c645b26af1', 66706), 'publisher.sh': ('e5a1f4782954ba83cd4c128c14541061dc1f74c5d8ec289c6154a44e086bb043', 39763)}
ORIGINAL_HELPER_PINS = {'proofofwork-ui-capacity.py': ('ea6745b2519d57fbd08deff723e81540d4dad2b4c649ff7e6c2b060a7e7edbb6', 13570), 'stager.py': ('ed73a1bd5cec051ed093c96fbf0fabc47042a7da4ad6c6e8cd8e1359c71d64e7', 58447), 'receiver.py': ('7e40dc14691d3c239c242ee2f543093856cbf84450094deb1b0edb06669b0d7f', 8449), 'provenance.sh': ('9435b88c43e1a16313c3a90ccb2e142b110bae8e1642ceb655caf73c2e4a0522', 66546), 'publisher.sh': ('f92db85d8d134959b95132494a3888bdb33f29251751a1b46b66a85ea1aee98a', 39438)}
ORIGINAL_PACKAGE = Path('/usr/local/lib/proofofwork-audit30-item2-ui-preserved-paths') / RELEASE
STAGE_ROOT = EVIDENCE_ROOT / ('proofofwork-www-stage-' + RELEASE)
FAILED_ROOT = BASE / ('recovery-transport-' + RELEASE + '-surfaces-stage')
FAILED_PINS = {
    'intent.json': '776b8fe83b2b0f6c198245c9ab80cd9bfcaa90c9d49190be535d2b31120149c3',
    'receive-admission.log': '651f59222a471759ecacf8e0a1d9035c179913e3a41e8df08bf391dce4b747ae',
    'receiver.log': 'e5d4860608f45275ff4661893e81d2d623ab953da37985aab865905e8f519e40',
    'stage-model.json': 'be542139575ae3c00c7d5445fcabe45c3968de3c9be04f1d656eba0572fe8679',
    'stage-check-scratch.json': '77e7c0f296b2dd65945b4b05c469f1ba0454f008849ddfe51f2265b75201d4ba'
}


STAGE_FAILED_ROOT = BASE / ('recovery-transport-' + RELEASE + '-preserved-preserve-stage-v1')
STAGE_FAILED_PINS = {
    'intent.json': '881ffef282e9d5ec3cec594d34b2759f82f2f1b2270d26772fb7ae3e10856a71',
    'failure.json': 'bb48fff7bdabae60146941ee24485011acf65fc7823a66e5731f7c1694570482',
    'stager.log': 'd636d08283bea58377f3d2af17a2c466770781e43546c8b48e46d684cf3374bb'
}
INCOMING_SHA = '746e2a564388bf1d01ced36a9cd983d50818164f2cabf421037e27f7c56f6f3c'
ORIGINAL_PACKAGE_MANIFEST_SHA = '74b96856854cd9c5ee9d38a20aa5c74922bda8bf8191a17fb12256ef92b97beb'
CAPACITY_NAME = 'proofofwork-ui-capacity.py'


def request(raw, phase):
    value = json.loads(raw)
    assert set(value) == {'schema', 'phase', 'planSha256', 'helperSourcesBase64', 'expectedPayloadFingerprint', 'recognizedPriorStageFailure', 'recognizedRestageFailure'}
    assert value['schema'] == 'pow-audit30-item2-ui-evidence-stage-continuation-request-v3'
    assert phase in ('stage', 'source') and value['phase'] == phase
    assert value['recognizedPriorStageFailure'] == STAGE_FAILED_PINS
    assert value['recognizedRestageFailure'] == RESTAGE_FAILED_PINS
    assert value['planSha256'] == PLAN_SHA and value['expectedPayloadFingerprint'] == EXPECTED_PAYLOAD
    assert set(value['helperSourcesBase64']) == set(HELPER_PINS)
    files = {}
    for name, (digest, size) in HELPER_PINS.items():
        data = base64.b64decode(value['helperSourcesBase64'][name], validate=True)
        assert len(data) == size and hashlib.sha256(data).hexdigest() == digest
        files[name] = data
    return value, files


def helper_manifest(files):
    return {'schema': 'pow-audit30-item2-ui-evidence-stage-helper-package-v3', 'releaseId': RELEASE,
            'exactStageRoot': str(STAGE_ROOT), 'exactStageAllocationParent': str(EVIDENCE_ROOT),
            'installedHelpersModified': False, 'capacityBodiesAndLimitsUnchanged': True,
            'files': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                      for name, data in files.items()}}


def check_package(files):
    directory(PACKAGE_TOP); directory(PACKAGE)
    assert sorted(p.name for p in PACKAGE.iterdir()) == sorted([*files, 'manifest.json'])
    for name, data in files.items():
        digest, size = HELPER_PINS[name]
        assert len(bound(PACKAGE / name, digest, 128*1024)) == size == len(data)
    manifest_raw = (json.dumps(helper_manifest(files), indent=2) + '\n').encode()
    digest = hashlib.sha256(manifest_raw).hexdigest()
    assert bound(PACKAGE / 'manifest.json', digest) == manifest_raw
    return digest


def check_original_package():
    directory(ORIGINAL_PACKAGE.parent); directory(ORIGINAL_PACKAGE)
    pins = {name: digest for name, (digest, size) in ORIGINAL_HELPER_PINS.items()}
    pins.update({'manifest.json': ORIGINAL_PACKAGE_MANIFEST_SHA,
        'capacity-admission-v2.json': 'c9ee34612a80317f55f1010b5da57b354cd1642b7fab6a9b5379fbd876b0aa30'})
    assert sorted(path.name for path in ORIGINAL_PACKAGE.iterdir()) == sorted(pins)
    return {name: bound(ORIGINAL_PACKAGE / name, digest, 128*1024) for name, digest in pins.items()}


def prepare_package(files):
    assert not os.path.lexists(PACKAGE)
    capacity('check', PACKAGE_TOP.parent, sum(len(raw) for raw in files.values()) + EVIDENCE_RESERVE,
             'evidence-stage-helper-package', inodes=32)
    directory(PACKAGE_TOP, create=True); PACKAGE.mkdir(mode=0o700)
    for name, raw in files.items():
        with (PACKAGE / name).open('xb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        (PACKAGE / name).chmod(0o755); sync(PACKAGE / name)
    durable_json(PACKAGE / 'manifest.json', helper_manifest(files)); sync(PACKAGE_TOP)
    check_package(files)


RESTAGE_FAILED_ROOT = BASE / ('recovery-transport-' + RELEASE + '-preserved-restage-v2')
RESTAGE_FAILED_PINS = {
    'intent.json': '5f52fe3968b685b44a9e42f02e447145a49b416da12cf30558b926da56ca1a78',
    'failure.json': 'aab79799531ef02f3612b1b535cb3f4a0c01be29d0b98a2633203df611f3775d',
    'stager.log': '63124452ecd7b7ade9c51dff4c2dba785d3a70817db633bab2b67c1f8b22c77c'
}


def recognized_restage_failure():
    values = {name: bound(RESTAGE_FAILED_ROOT / name, digest) for name, digest in RESTAGE_FAILED_PINS.items()}
    intent = json.loads(values['intent.json']); failed = json.loads(values['failure.json'])
    assert intent['schema'] == 'pow-audit30-item2-ui-preserved-continuation-intent-v2'
    assert intent['releaseId'] == RELEASE and intent['phase'] == 'restage' and intent['planSha256'] == PLAN_SHA
    assert intent['requestSha256'] == 'ae6f71bcd273cb7d48ebdc53aed6885240b241d6607aedbbbdc3ad8eb427218a'
    assert intent['ownedUnit']['InvocationID'] == 'e52fa32d30524c778a5f9f309538953e'
    assert intent['recognizedPriorStageFailure'] == STAGE_FAILED_PINS and intent['incomingReceiptSha256'] == INCOMING_SHA
    assert failed == {'errorClass': 'AssertionError', 'reasonSha256': '58583eb78b6d80ce4a7ac360cc32ec801a71a8621042b0d48a121a7ba691f52f',
        'inputAlreadyPreserved': True, 'stagerEntered': True, 'recognizedInputInversePerformed': False,
        'automaticRetry': False, 'productionPublished': False, 'historicalDeletion': False}
    assert values['stager.log'] == (b'UI deployment scratch review required {"additionalBytes": 453701632, "allocatedBytes": 4933701632, "cleanupApproved": false, "maximumBytes": 5368709120, "path": "/var/tmp/proofofwork-deploy", "phase": "stage-private-root"}\n')
    unit = 'proofofwork-audit30-item2-ui-preserved-' + RELEASE + '-restage-v2.service'
    fields = dict(line.split('=', 1) for line in subprocess.check_output([
        '/usr/bin/systemctl', 'show', unit, '-p', 'MainPID', '-p', 'Result', '-p', 'ActiveState', '-p', 'InvocationID'],
        env=ENV, text=True, timeout=10).splitlines())
    assert fields == {'MainPID': '0', 'Result': 'exit-code', 'ActiveState': 'failed', 'InvocationID': 'e52fa32d30524c778a5f9f309538953e'}
    assert not os.path.lexists(BASE / ('proofofwork-www-stage-' + RELEASE))
    assert not list(BASE.glob('.proofofwork-ui-stage-' + RELEASE + '.*'))
    original_package = check_original_package()
    return values, original_package


def conservative_stage_copy_bound():
    record = helpers['capacity']; capacity_namespace = {'__name__': '_evidence_stage_capacity_bound'}
    exec(compile(bound(record['path'], record['sha256']), record['path'], 'exec'), capacity_namespace)
    estimate = capacity_namespace['tree_bound'](Path('/var/www'), EVIDENCE_ROOT)
    block = capacity_namespace['allocation_block'](EVIDENCE_ROOT)
    extra = 2 * capacity_namespace['entry_bytes'](0, block)
    assert estimate['additionalBytes'] + extra == 453701632 and estimate['additionalInodes'] == 1280
    return estimate['additionalBytes'] + extra, estimate['additionalInodes'] + 2


def recognized_prior_stage():
    values = {name: bound(STAGE_FAILED_ROOT / name, digest) for name, digest in STAGE_FAILED_PINS.items()}
    intent = json.loads(values['intent.json']); failed = json.loads(values['failure.json'])
    assert intent['schema'] == 'pow-audit30-item2-ui-preserved-continuation-intent-v1'
    assert intent['releaseId'] == RELEASE and intent['phase'] == 'preserve-stage' and intent['planSha256'] == PLAN_SHA
    assert intent['ownedUnit']['InvocationID'] == 'bfbd64d0ba2c47fc8d4044a969a8dfd0'
    assert failed == {'errorClass': 'AssertionError', 'reasonSha256': '58583eb78b6d80ce4a7ac360cc32ec801a71a8621042b0d48a121a7ba691f52f',
        'inputMoved': True, 'stagerEntered': True, 'recognizedInputInversePerformed': False,
        'automaticRetry': False, 'productionPublished': False, 'historicalDeletion': False}
    assert values['stager.log'] == ('UI capacity helper is missing: ' + str(ORIGINAL_PACKAGE / CAPACITY_NAME) + '\n').encode()
    unit = 'proofofwork-audit30-item2-ui-preserved-' + RELEASE + '-preserve-stage-v1.service'
    fields = dict(line.split('=', 1) for line in subprocess.check_output([
        '/usr/bin/systemctl', 'show', unit, '-p', 'MainPID', '-p', 'Result', '-p', 'ActiveState', '-p', 'InvocationID'],
        env=ENV, text=True, timeout=10).splitlines())
    assert fields == {'MainPID': '0', 'Result': 'exit-code', 'ActiveState': 'failed', 'InvocationID': 'bfbd64d0ba2c47fc8d4044a969a8dfd0'}
    incoming = json.loads(bound(EVIDENCE_ROOT / 'incoming-receipt.json', INCOMING_SHA, 1024*1024))
    assert incoming['originalPath'] == str(PAYLOAD) and incoming['preservedPath'] == str(PRESERVED)
    assert incoming['payloadFingerprint'] == EXPECTED_PAYLOAD and incoming['planSha256'] == PLAN_SHA
    assert not os.path.lexists(PAYLOAD) and payload_fingerprint(PRESERVED) == EXPECTED_PAYLOAD
    assert inode_witness(PRESERVED) == incoming['inodeRows']
    return values, incoming


def inode_witness(root):
    rows = []
    for path in [root, *sorted(root.rglob('*'))]:
        details = path.lstat()
        assert path.resolve() == path and details.st_dev == root.stat().st_dev
        assert details.st_uid == details.st_gid == 0 and not details.st_mode & 0o7022
        assert stat.S_ISREG(details.st_mode) or stat.S_ISDIR(details.st_mode)
        if stat.S_ISREG(details.st_mode): assert details.st_nlink == 1
        attrs = [(name, os.getxattr(path, name, follow_symlinks=False).hex())
                 for name in sorted(os.listxattr(path, follow_symlinks=False))]
        assert identity(path.lstat()) == identity(details)
        rows.append([path.relative_to(root).as_posix(), details.st_dev, details.st_ino,
                     details.st_mode, details.st_uid, details.st_gid, details.st_nlink,
                     details.st_size, details.st_mtime_ns,
                     0 if path == root else details.st_ctime_ns, attrs])
    assert len(rows) == EXPECTED_PAYLOAD['entries']
    return rows


def old_failure():
    values = {name: bound(FAILED_ROOT / name, digest) for name, digest in FAILED_PINS.items()}
    unit = 'proofofwork-recovery-ui-transport-' + RELEASE + '-surfaces-stage.service'
    fields = dict(line.split('=', 1) for line in subprocess.check_output([
        '/usr/bin/systemctl', 'show', unit, '-p', 'MainPID', '-p', 'Result',
        '-p', 'ActiveState', '-p', 'InvocationID'], env=ENV, text=True, timeout=10).splitlines())
    assert fields == {'MainPID': '0', 'Result': 'exit-code', 'ActiveState': 'failed',
                      'InvocationID': 'fae6a6f75dbe40478391132a25a0ba1a'}
    receiver = json.loads(values['receiver.log']); model = json.loads(values['stage-model.json'])
    assert receiver['status'] == 'verified' and receiver['kind'] == 'surfaces'
    assert receiver['releaseId'] == RELEASE and receiver['archiveSha256'] == p['surfaces']['sha256']
    assert receiver['compressedBytes'] == p['surfaces']['compressedBytes']
    assert receiver['entries'] == 818 and receiver['logicalBytes'] == EXPECTED_PAYLOAD['regularBytes']
    receipt_raw = (json.dumps(receiver, indent=2) + '\n').encode()
    receipt_path = BASE / ('audit5-stream-surfaces-' + RELEASE + '.json')
    assert bound(receipt_path, hashlib.sha256(receipt_raw).hexdigest()) == receipt_raw
    assert model['inputStabilityVerified'] is True and model['installedStagerSha256'] == helpers['stager']['sha256']
    assert model['peakAdditionalBytes'] == 264429568 and model['finalCandidateUpperBytes'] == 258293760
    return receiver, model, values


def check_retained():
    roots = sorted(Path('/var/backups/proofofwork-ui/rollback-roots').glob('proofofwork-www-pre-*'))
    assert [str(root) for root in roots] == [row['root'] for row in p['retainedRoots']]
    for root, row in zip(roots, p['retainedRoots']):
        current = namespace['fingerprint'](root)
        assert current['manifestSha256'] == row['manifestSha256'] and current['treeSha256'] == row['treeSha256']


def restage(receiver, old_model):
    stage = STAGE_ROOT
    archive = ARCHIVES / ('proofofwork-ui-release-' + RELEASE + '.tgz')
    assert not os.path.lexists(stage) and not os.path.lexists(PAYLOAD)
    assert not list(EVIDENCE_ROOT.glob('.proofofwork-ui-stage-' + RELEASE + '.*'))
    assert not os.path.lexists(SOURCE_ROOT)
    assert all(not os.path.lexists(path) for path in (archive, Path(str(archive)+'.sha256'), Path(str(archive)+'.provenance')))
    assert payload_fingerprint(PRESERVED) == EXPECTED_PAYLOAD
    inode_before = inode_witness(PRESERVED)
    capacity('check', EVIDENCE_ROOT, EVIDENCE_RESERVE, 'input-preservation', inodes=32)
    stage_started = False
    try:
        run(['/usr/bin/python3', '-I', '-B', str(BASE / 'audit29-tools/ui-capacity.py'),
             'stage', str(PRESERVED / 'surfaces')], 'stage-model.json')
        model = json.loads((out / 'stage-model.json').read_bytes())
        assert model == old_model
        copy_bytes, copy_inodes = conservative_stage_copy_bound()
        capacity('check-scratch', BASE, EVIDENCE_RESERVE, 'stage-receipts', inodes=32)
        capacity('check-scratch', EVIDENCE_ROOT, max(copy_bytes, model['peakAdditionalBytes']) + EVIDENCE_RESERVE, 'stage-actual-allocation', inodes=copy_inodes+32)
        capacity('check', EVIDENCE_ROOT, max(copy_bytes, model['peakAdditionalBytes']) + p['stageArchiveUpperBoundBytes'] + EVIDENCE_RESERVE, 'stage-actual-allocation', inodes=copy_inodes+32)
        stage_started = True
        run(['/usr/bin/python3', '-I', '-B', str(PACKAGE / 'stager.py'), '--release-id', RELEASE,
             '--surfaces-root', str(PRESERVED / 'surfaces'), '--stage-root', str(stage),
             '--deduplicate-managed-files'], 'stager.log', timeout=900)
        assert payload_fingerprint(PRESERVED) == EXPECTED_PAYLOAD and inode_witness(PRESERVED) == inode_before
    except BaseException as error:
        durable_json(out / 'failure.json', {'errorClass': type(error).__name__,
            'reasonSha256': hashlib.sha256(str(error).encode()).hexdigest(), 'inputAlreadyPreserved': True,
            'stagerEntered': stage_started, 'recognizedInputInversePerformed': False,
            'automaticRetry': False, 'productionPublished': False, 'historicalDeletion': False})
        raise
    run(['/usr/bin/python3', '-I', '-B', str(BASE / 'audit29-tools/ui-capacity.py'), 'managed', str(stage)], 'managed-model.json')
    managed = json.loads((out / 'managed-model.json').read_bytes())
    upper = managed['archiveUpperBoundBytes']; assert upper <= p['stageArchiveUpperBoundBytes']
    capacity('check', ARCHIVES, upper + 65536, 'archive', inodes=16)
    archive_base = EVIDENCE_ROOT / 'archive-base'
    archive_base.mkdir(mode=0o700); (archive_base / 'surfaces').mkdir(mode=0o755)
    temporary = EVIDENCE_ROOT / ('proofofwork-ui-release-' + RELEASE + '.tgz.incoming')
    run(['/usr/bin/tar', '--sort=name', '--create', '--gzip', '--hard-dereference', '--file', str(temporary),
         '--transform=s|^proofofwork-|surfaces/|', '--directory', str(archive_base), 'surfaces',
         '--directory', str(stage), *['proofofwork-' + name for name in SURFACES]], 'archive.log', timeout=600)
    assert temporary.stat().st_size <= upper
    temporary.chmod(0o644)
    with temporary.open('rb') as source:
        archive_sha = hashlib.file_digest(source, 'sha256').hexdigest()
    checksum_temporary = EVIDENCE_ROOT / 'archive.sha256.incoming'
    with checksum_temporary.open('x') as stream:
        stream.write(archive_sha + '  ' + archive.name + '\n'); stream.flush(); os.fsync(stream.fileno())
    checksum_temporary.chmod(0o644); sync(temporary)
    rename_new(checksum_temporary, Path(str(archive)+'.sha256')); rename_new(temporary, archive)
    # Source extraction is outside scratch. Only the bounded receipt directory
    # remains charged here; full source bytes/inodes remain charged to real disk.
    capacity('check-scratch', BASE, EVIDENCE_RESERVE, 'next-source-receipts')
    allocation = p['admissions']['source-receive']
    capacity('check', EVIDENCE_ROOT, allocation['bytes'] + EVIDENCE_RESERVE, 'next-source-evidence',
             inodes=allocation['inodes'] + 32)
    return {'managedArchive': str(archive), 'archiveSha256': archive_sha,
            'preservedInput': str(PRESERVED), 'inputFingerprint': EXPECTED_PAYLOAD,
            'movePreservedInodes': True, 'inputAlreadyPreserved': True,
            'recognizedPriorStageFailure': STAGE_FAILED_PINS, 'recognizedRestageFailure': RESTAGE_FAILED_PINS,
            'stageRoot': str(stage), 'actualStageAllocationParent': str(EVIDENCE_ROOT), 'globalScratchReceiptParent': str(BASE),
            'conservativeStageCopyBytes': copy_bytes, 'capacitySiblingSha256': HELPER_PINS[CAPACITY_NAME][0],
            'stageModel': model, 'productionPublished': False}


def receive_source():
    assert not os.path.lexists(SOURCE_ROOT)
    stage = STAGE_ROOT
    archive = ARCHIVES / ('proofofwork-ui-release-' + RELEASE + '.tgz')
    checksum = Path(str(archive)+'.sha256').read_text().split()
    assert len(checksum) == 2 and checksum[1] == archive.name
    bound(archive, checksum[0], 2*1024**3)
    allocation = p['admissions']['source-receive']
    assert allocation == {'bytes': 315842560, 'inodes': 15000}
    capacity('check-scratch', BASE, EVIDENCE_RESERVE, 'source-receipts', inodes=32)
    capacity('check', EVIDENCE_ROOT, allocation['bytes'] + EVIDENCE_RESERVE, 'source-evidence', inodes=allocation['inodes']+32)
    part = p['source']
    run(['/usr/bin/python3', '-I', '-B', str(PACKAGE / 'receiver.py'), 'source', RELEASE,
         str(part['compressedBytes']), part['sha256']], 'receiver.log',
        source=sys.stdin.buffer, length=part['compressedBytes'])
    assert sys.stdin.buffer.read(1) == b'', 'Extra transport bytes'
    receipt = json.loads((out / 'receiver.log').read_bytes())
    assert receipt['status'] == 'verified' and receipt['kind'] == 'source' and receipt['releaseId'] == RELEASE
    assert receipt['archiveSha256'] == part['sha256'] and receipt['compressedBytes'] == part['compressedBytes']
    assert receipt['extractedRoot'] == str(SOURCE_ROOT)
    for ref, expected in [('HEAD', COMMIT), ('HEAD^{tree}', TREE)]:
        run(['/usr/bin/git', '-C', str(SOURCE_ROOT), 'rev-parse', ref], 'git-' + ('commit' if ref == 'HEAD' else 'tree') + '.txt', timeout=30)
        assert (out / ('git-' + ('commit' if ref == 'HEAD' else 'tree') + '.txt')).read_text().strip() == expected
    assert subprocess.run(['/usr/bin/git', '-C', str(SOURCE_ROOT), 'symbolic-ref', '-q', 'HEAD'], env=env,
                          stdout=subprocess.DEVNULL, timeout=30).returncode == 1
    run(['/usr/bin/git', '-C', str(SOURCE_ROOT), 'status', '--porcelain', '--untracked-files=all'], 'git-status.txt', timeout=60)
    assert not (out / 'git-status.txt').read_bytes()
    run([str(PACKAGE / 'provenance.sh'), 'verify-candidate', '--release-id', RELEASE, '--commit', COMMIT,
         '--source-checkout', str(SOURCE_ROOT), '--archive', str(archive)], 'candidate-provenance.log',
        extra={'POW_UI_WWW_ROOT': str(stage), 'POW_UI_STAGED_ROOT': '1'}, timeout=600)
    return {'sourceCheckout': str(SOURCE_ROOT), 'detachedSourceClean': True,
            'candidateProvenanceVerified': True, 'productionPublished': False}


def main():
    global p, helpers, env, lock_fd, out, namespace
    assert sys.flags.isolated and os.geteuid() == os.getegid() == 0
    os.umask(0o077); resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    phase, request_sha = sys.argv[1:]
    request_raw = sys.stdin.buffer.readline(768*1024 + 1)
    assert request_raw.endswith(b'\n') and len(request_raw) <= 768*1024
    request_raw = request_raw[:-1]
    assert re.fullmatch('[0-9a-f]{64}', request_sha) and hashlib.sha256(request_raw).hexdigest() == request_sha
    value, files = request(request_raw, phase)
    if phase != 'source': assert sys.stdin.buffer.read(1) == b'', 'Unexpected typed input suffix'
    p = json.loads(bound(PLAN_PATH, PLAN_SHA, 65536))
    assert p['releaseId'] == RELEASE and p['commit'] == COMMIT and p['tree'] == TREE
    assert p['frontendOnly'] is True and p['retentionDeferred'] is True and p['publicationAttempt'] == 'item2-v1'
    unit = 'proofofwork-audit30-item2-ui-evidence-stage-' + RELEASE + '-' + phase + '-v3.service'
    fields = dict(line.split('=', 1) for line in subprocess.check_output([
        '/usr/bin/systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'MainPID', '-p', 'InvocationID',
        '-p', 'KillMode', '-p', 'RuntimeMaxUSec', '-p', 'ControlGroup', '-p', 'MemoryMax',
        '-p', 'MemorySwapMax', '-p', 'TasksMax'], env=ENV, text=True, timeout=10).splitlines())
    assert fields['ActiveState'] == 'active' and fields['MainPID'] == str(os.getpid())
    assert re.fullmatch('[0-9a-f]{32}', fields['InvocationID'])
    assert fields['KillMode'] == 'control-group' and fields['RuntimeMaxUSec'] == '20min'
    assert fields['MemoryMax'] == str(4*1024**3) and fields['MemorySwapMax'] == '0' and fields['TasksMax'] == '128'
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
    for key, filename in [('controller', 'release.py'), ('receiver', 'stream-ui-bundle.py'), ('phase-capacity', 'ui-capacity.py')]:
        bound(BASE / 'audit29-tools' / filename, p['helperSha256'][key])
    namespace = {'__name__': '_preserved_item2_live_binding'}
    record = helpers['retained']
    exec(compile(bound(record['path'], record['sha256']), record['path'], 'exec'), namespace)
    live = namespace['fingerprint'](Path('/var/www'))
    assert live['manifestSha256'] == p['oldLiveManifestSha256'] and live['treeSha256'] == p['oldFullRootTreeSha256']
    check_retained(); receiver, model, failed_bytes = old_failure()
    recognized_restage_failure()
    if phase == 'stage':
        assert not os.path.lexists(STAGE_ROOT) and not os.path.lexists(SOURCE_ROOT) and not os.path.lexists(PACKAGE)
        assert not list(EVIDENCE_ROOT.glob('.proofofwork-ui-stage-' + RELEASE + '.*'))
        archive = ARCHIVES / ('proofofwork-ui-release-' + RELEASE + '.tgz')
        assert all(not os.path.lexists(path) for path in (archive, Path(str(archive)+'.sha256'), Path(str(archive)+'.provenance')))
    out = BASE / ('recovery-transport-' + RELEASE + '-evidence-stage-' + phase + '-v3')
    assert not os.path.lexists(out)
    for command in ('check-scratch', 'check'):
        subprocess.run(['/usr/bin/python3', '-I', '-B', helpers['capacity']['path'], command,
            '--path', str(BASE), '--additional-bytes', str(EVIDENCE_RESERVE), '--additional-inodes', '32',
            '--phase', 'recovery-preserved-continuation-evidence'], env=env, pass_fds=(lock_fd,),
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, timeout=90, check=True)
    out.mkdir(mode=0o700); sync(BASE)
    durable_json(out / 'intent.json', {'schema': 'pow-audit30-item2-ui-evidence-stage-continuation-intent-v3',
        'releaseId': RELEASE, 'phase': phase, 'requestSha256': request_sha, 'planSha256': PLAN_SHA,
        'ownedUnit': fields, 'oldRefusalReceipts': FAILED_PINS, 'oldLive': live,
        'retainedRoots': p['retainedRoots'], 'recognizedPriorStageFailure': STAGE_FAILED_PINS,
        'incomingReceiptSha256': INCOMING_SHA, 'recognizedRestageFailure': RESTAGE_FAILED_PINS,
        'exactStageRoot': str(STAGE_ROOT), 'actualStageAllocationParent': str(EVIDENCE_ROOT),
        'globalScratchReceiptParent': str(BASE), 'historicalDeletion': False, 'installedHelpersModified': False})
    directory(EVIDENCE_ROOT)
    prior_values, incoming = recognized_prior_stage()
    restage_values, original_package = recognized_restage_failure()
    if phase == 'stage': prepare_package(files)
    package_sha = check_package(files)
    result = restage(receiver, model) if phase == 'stage' else receive_source()
    assert check_package(files) == package_sha and recognized_prior_stage()[0] == prior_values
    assert recognized_restage_failure() == (restage_values, original_package)
    assert bound(PLAN_PATH, PLAN_SHA, 65536) == (json.dumps(p, indent=2)+'\n').encode()
    assert namespace['fingerprint'](Path('/var/www')) == live
    check_retained(); assert old_failure()[2] == failed_bytes
    for record in helpers.values(): bound(record['path'], record['sha256'])
    result.update(schema='pow-audit30-item2-ui-evidence-stage-continuation-result-v3', ok=True,
                  releaseId=RELEASE, phase=phase, ownedUnitInvocationID=fields['InvocationID'],
                  evidence=str(out), requestSha256=request_sha, planSha256=PLAN_SHA,
                  oldFailurePreserved=True, oldLiveUnchanged=True, allPriorRootsPreserved=True,
                  installedHelpersModified=False, historicalDeletion=False, productionPublished=False,
                  automaticRetry=False)
    durable_json(out / 'receipt.json', result)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
