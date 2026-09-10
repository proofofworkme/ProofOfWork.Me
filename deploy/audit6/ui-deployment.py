#!/usr/bin/python3 -I
"""Durable UI publication/recovery transaction; never stops Caddy or deletes evidence.

Production entry points are prepare/run/recover. Run and recover belong to the
installed systemd units, not an SSH process. A prepared request is not permission
to bypass the candidate's separately reviewed behavioral/protocol release gates.
"""
import argparse
import concurrent.futures
import ctypes
import datetime
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import stat
import subprocess
import tempfile
import sys
import time
import urllib.parse

sys.dont_write_bytecode = True
SURFACES = {
    'activity': 'log.proofofwork.me', 'browser': 'browser.proofofwork.me',
    'boost': 'boost.proofofwork.me', 'computer': 'computer.proofofwork.me',
    'desktop': 'desktop.proofofwork.me', 'growth': 'growth.proofofwork.me',
    'id': 'id.proofofwork.me', 'inception': 'inception.proofofwork.me',
    'infinity': 'infinity.proofofwork.me', 'landing': 'www.proofofwork.me',
    'marketplace': 'amo.proofofwork.me', 'nft': 'nft.proofofwork.me',
    'token': 'credit.proofofwork.me', 'wallet': 'wallet.proofofwork.me',
    'work': 'work.proofofwork.me',
}
PRODUCTION = {
    'state': '/var/lib/proofofwork-ui-deployments', 'www': '/var/www',
    'stage': '/var/tmp/proofofwork-deploy',
    'archives': '/var/backups/proofofwork-ui/releases',
    'rollbacks': '/var/backups/proofofwork-ui/rollback-roots',
    'lock': '/run/proofofwork-ui/deploy.lock',
    'publisher': '/usr/local/sbin/proofofwork-ui-release-publish',
    'provenance': '/usr/local/sbin/proofofwork-ui-release-provenance',
    'fingerprint': '/usr/local/sbin/proofofwork-ui-retained-root',
    'continuity': '/usr/local/lib/proofofwork-deployment/ui-continuity.py',
    'smokePort': 443, 'smokeTls': True,
}
TERMINAL = {'committed', 'rolled-back', 'cancelled-before-publication'}
RELEASE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z')
RETAINED = re.compile(r'(proofofwork-www-pre-[A-Za-z0-9][A-Za-z0-9._-]{0,127}):([0-9a-f]{64}):([0-9a-f]{64})\Z')
PUBLICATION_MODEL = 'prepublished-resource-union-v1'


class DeploymentBusy(RuntimeError):
    pass


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe(path, directory=False):
    p = Path(path)
    require(p.is_absolute() and p.resolve(strict=True) == p, 'Noncanonical path: ' + str(p))
    d = p.lstat()
    require(not stat.S_ISLNK(d.st_mode) and
            (stat.S_ISDIR(d.st_mode) if directory else stat.S_ISREG(d.st_mode)),
            'Wrong file type: ' + str(p))
    require(d.st_uid == os.geteuid() and not d.st_mode & 0o7022,
            'Unsafe owner or mode: ' + str(p))
    return p


def identity(path):
    d = safe(path, True).stat()
    return [d.st_dev, d.st_ino, d.st_mode, d.st_uid, d.st_gid]


def read_json(path):
    p = safe(path)
    require(p.stat().st_size <= 16 * 1024 * 1024, 'State exceeds size bound')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        d = os.fstat(f.fileno())
        require(d.st_nlink == 1, 'State must not have external hardlinks')
        body = f.read(16 * 1024 * 1024 + 1)
        require(len(body) == d.st_size, 'State changed while reading')
    return json.loads(body)


def fsync_parents(*paths):
    for parent in {str(Path(p).parent) for p in paths}:
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def write_json(path, record):
    p = Path(path)
    safe(p.parent, True)
    fd, temporary_name = tempfile.mkstemp(prefix=p.name + '.next-', dir=p.parent)
    temporary = Path(temporary_name)
    with os.fdopen(fd, 'wb') as f:
        f.write((json.dumps(record, indent=2) + '\n').encode())
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, p)
    fsync_parents(p)


def configuration(args):
    c = dict(PRODUCTION)
    if args.test_config:
        require(args.test_only, 'Test configuration requires explicit --test-only')
        t = read_json(args.test_config)
        require(set(t) <= set(PRODUCTION) | {'pauseAt', 'pauseMarker'}, 'Unknown test setting')
        c.update(t)
        for name in ['state', 'www', 'stage', 'archives', 'rollbacks', 'lock']:
            require(str(c[name]).startswith('/tmp/'), 'Test mutable roots must be below /tmp')
        c['test'] = True
    else:
        require(not args.test_only and os.geteuid() == 0, 'Production requires root and fixed paths')
        c['test'] = False
    for name in ['state', 'www', 'stage', 'archives', 'rollbacks']:
        safe(c[name], True)
    safe(Path(c['lock']).parent, True)
    for name in ['publisher', 'provenance', 'fingerprint', 'continuity']:
        safe(c[name])
    require(1 <= int(c['smokePort']) <= 65535, 'Invalid smoke port')
    require(c['smokeTls'] or c['test'], 'Production smoke requires TLS')
    return c


def acquire(c):
    lock = Path(c['lock'])
    if lock.exists() or lock.is_symlink():
        safe(lock)
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    require(os.fstat(fd).st_nlink == 1, 'Deployment lock has multiple links')
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise DeploymentBusy('Another publication/recovery/cleanup owns the deployment lock')
    return fd


def helper_hashes(c):
    return {**{name: sha(safe(c[name]).read_bytes()) for name in ['publisher', 'provenance', 'fingerprint', 'continuity']},
            'controller': sha(safe(Path(__file__).resolve()).read_bytes())}


def continuity(c):
    spec = importlib.util.spec_from_file_location('ui_resource_continuity', c['continuity'])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fingerprint(c, root):
    # Reuse the exact tracked complete-root implementation, including its bounds,
    # metadata and no-follow checks. CLI restricts retained names; this adapter
    # also needs the current live root, which is a fixed production path.
    spec = importlib.util.spec_from_file_location('ui_root_fingerprint', c['fingerprint'])
    if spec is None:  # Installed helper has no .py suffix.
        from importlib.machinery import SourceFileLoader
        spec = importlib.util.spec_from_loader('ui_root_fingerprint', SourceFileLoader('ui_root_fingerprint', c['fingerprint']))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.fingerprint(root)
    return {k: result[k] for k in ['manifestSha256', 'treeSha256', 'entries', 'regularBytes']}


def environment(c, fd, root=None, retained=False):
    e = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'PYTHONDONTWRITEBYTECODE': '1',
         'TMPDIR': c['stage'], 'POW_UI_DEPLOY_LOCK': c['lock'], 'POW_UI_DEPLOY_LOCK_FD': str(fd)}
    if c['test']:
        e.update({'POW_UI_ALLOW_TEST_ROOTS': '1', 'POW_UI_PUBLISH_WWW_ROOT': c['www'],
                  'POW_UI_PUBLISH_STAGING_ROOT': c['stage'], 'POW_UI_RELEASE_ARCHIVE_ROOT': c['archives'],
                  'POW_UI_PUBLISH_ROLLBACK_ROOT': c['rollbacks'],
                  'POW_UI_PUBLISH_PROVENANCE_SCRIPT': c['provenance'],
                  'POW_UI_RETAINED_ROOT_SCRIPT': c['fingerprint']})
    if root is not None:
        e['POW_UI_WWW_ROOT'] = str(root)
        if Path(root).parent == Path(c['stage']):
            e['POW_UI_STAGED_ROOT'] = '1'
    if retained and Path(root).parent == Path(c['rollbacks']):
        e['POW_UI_RETAINED_ROOT'] = '1'
    return e


def command(c, fd, argv, root=None, retained=False, timeout=600):
    p = subprocess.Popen(argv, env=environment(c, fd, root, retained), pass_fds=(fd,),
                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        output, error = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate()
        raise RuntimeError('Checked helper process group timed out: ' + Path(argv[0]).name)
    require(p.returncode == 0, 'Checked helper failed: ' + Path(argv[0]).name + ': ' + error.decode(errors='replace')[-1800:])
    require(len(output) <= 4 * 1024 * 1024, 'Helper output exceeded bound')
    return output.decode()


def paths(c, release):
    require(RELEASE.fullmatch(release), 'Invalid release id')
    result = {name: str(Path(c[parent]) / (prefix + release + suffix)) for name, parent, prefix, suffix in [
        ('job', 'state', '', '.json'), ('candidate', 'stage', 'proofofwork-www-stage-', ''),
        ('source', 'stage', 'proofofwork-ui-source-', ''),
        ('archive', 'archives', 'proofofwork-ui-release-', '.tgz'),
        ('rollback', 'rollbacks', 'proofofwork-www-pre-', '')]}
    result['original'] = str(Path(c['rollbacks']) / ('proofofwork-www-pre-original-' + sha(release.encode())[:32]))
    return result


def verify_retained(c, fd, records):
    # The untouched original will consume one additional publisher retention
    # classification. Verify the complete existing set before any live exchange.
    require(isinstance(records, list) and len(records) <= 7, 'At most seven existing retained roots leave room for the original')
    expected = set()
    for record in records:
        match = RETAINED.fullmatch(record) if isinstance(record, str) else None
        require(match is not None and match[1] not in expected, 'Invalid or duplicate retained root classification')
        expected.add(match[1])
        root = safe(Path(c['rollbacks']) / match[1], True)
        no_nested_mounts(root)
        actual = fingerprint(c, root)
        require(actual['manifestSha256'] == match[2] and actual['treeSha256'] == match[3], 'Retained root fingerprint changed')
        command(c, fd, [c['provenance'], 'verify-rollback'], root=root, retained=True)
    require({p.name for p in Path(c['rollbacks']).glob('proofofwork-www-pre-*')} == expected,
            'Every existing rollback root must have an exact reviewed classification')


def smoke_inventory(root):
    result = []
    total = 0
    for surface, host in SURFACES.items():
        base = safe(Path(root) / ('proofofwork-' + surface), True)
        require((base / 'index.html').is_file(), 'Missing surface index')
        for p in sorted(base.rglob('*')):
            if p.is_dir():
                safe(p, True)
                continue
            safe(p)
            relative = p.relative_to(base).as_posix()
            require(not any(part.startswith('.') for part in p.relative_to(base).parts), 'Hidden surface file')
            body = p.read_bytes()
            total += len(body)
            require(len(body) <= 16 * 1024 * 1024 and total <= 2 * 1024 ** 3 and len(result) < 25000,
                    'Smoke inventory exceeds bounds')
            result.append({'host': host, 'path': '/' if relative == 'index.html' else '/' + relative,
                           'sha256': sha(body), 'bytes': len(body)})
    return result


class LoopbackTLS(http.client.HTTPSConnection):
    def connect(self):
        self.sock = ssl.create_default_context().wrap_socket(
            socket.create_connection(('127.0.0.1', self.port), self.timeout), server_hostname=self.host)


def smoke(c, inventory):
    # Actual HTTP bytes through Caddy; no caller-supplied host, shell or URL.
    # Loopback with certificate hostname verification covers virtual hosts and
    # complete retained/new static files. External DNS/client reachability and
    # application semantics remain separate required release gates.
    def check(item):
        cls = LoopbackTLS if c['smokeTls'] else http.client.HTTPConnection
        con = cls(item['host'] if c['smokeTls'] else '127.0.0.1', int(c['smokePort']), timeout=10)
        try:
            con.request('GET', urllib.parse.quote(item['path'], safe='/'), headers={'Host': item['host'], 'Accept-Encoding': 'identity'})
            r = con.getresponse()
            body = r.read(item['bytes'] + 1)
            require(r.status == 200 and len(body) == item['bytes'] and sha(body) == item['sha256'],
                    'HTTP smoke mismatch: ' + item['host'] + item['path'])
            return True
        finally:
            con.close()
    start = time.monotonic()
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
    futures = [pool.submit(check, item) for item in inventory]
    try:
        for future in concurrent.futures.as_completed(futures, timeout=180):
            require(future.result(), 'HTTP smoke failed')
    finally:
        # Cancel queued requests immediately on failure/deadline. At most four
        # active requests retain their bounded ten-second socket timeout.
        pool.shutdown(wait=True, cancel_futures=True)
    return {'checked': len(inventory), 'at': now(), 'elapsedMs': round((time.monotonic() - start) * 1000),
            'scope': 'Loopback Caddy virtual hosts and exact complete static file inventory; not external DNS or browser semantics'}


def pause(c, point):
    if c['test'] and c.get('pauseAt') == point:
        Path(c['pauseMarker']).write_text(point)
        while Path(c['pauseMarker']).exists():
            time.sleep(0.02)


def verify_prior(c, fd, root, expected):
    require(fingerprint(c, root) == expected, 'Prior root fingerprint changed; automatic restoration refused')
    command(c, fd, [c['provenance'], 'verify-rollback'], root=root, retained=str(root) != c['www'])


def no_nested_mounts(*roots):
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        mount = line.split()[4]
        for old, new in [('\\040', ' '), ('\\011', '\t'), ('\\134', '\\')]:
            mount = mount.replace(old, new)
        require(not any(mount == str(r) or mount.startswith(str(r) + '/') for r in roots), 'Nested mount prevents atomic recovery')


def exchange(left, right, expected_left, expected_right):
    require(identity(left) == expected_left and identity(right) == expected_right, 'Root identity changed before recovery')
    require(expected_left[0] == expected_right[0] and expected_left[2:] == expected_right[2:], 'Recovery root filesystem/metadata mismatch')
    no_nested_mounts(left, right)
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, 'renameat2', None)
    require(fn is not None, 'Atomic exchange syscall unavailable')
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    result = fn(-100, os.fsencode(left), -100, os.fsencode(right), 2)
    require(result == 0, 'Atomic recovery exchange failed errno=' + str(ctypes.get_errno()))
    fsync_parents(left, right)
    require(identity(left) == expected_right and identity(right) == expected_left, 'Post-exchange identity mismatch')


def recover_job(c, fd, job):
    p = paths(c, job['release'])
    if job['phase'] in TERMINAL:
        return job
    require(job.get('publicationModel') == PUBLICATION_MODEL, 'Unrecognized publication model; recovery requires review')
    require(helper_hashes(c) == job['helperHashes'], 'Deployment helper hashes changed; recovery requires review')
    require('recovery' in job, 'Missing pre-attested resource-continuity root; automatic publication is forbidden')
    recovery = job['recovery']
    expected_paths = continuity(c).locations(c, job['release'])
    require(recovery['root'] == expected_paths['root'] and recovery['archive'] == expected_paths['archive'] and
            job.get('originalRoot') == p['original'], 'Wrong continuity/original artifact paths')
    job['recoveredBy'] = {'pid': os.getpid(), 'invocationId': os.environ.get('INVOCATION_ID'), 'at': now()}
    known = [c['www'], p['candidate'], p['rollback'], recovery['root'], p['original']]

    def locate(expected, label):
        matches = [root for root in known if Path(root).exists() and identity(root) == expected]
        require(len(matches) == 1, label + ' root not uniquely available; preserve all roots for review')
        return matches[0]

    def preserve_original():
        original = locate(job['priorIdentity'], 'Untouched original')
        require(original in [c['www'], recovery['root'], p['original']], 'Original has an unexpected location')
        verify_prior(c, fd, original, job['priorFingerprint'])
        if original != c['www'] and original != p['original']:
            require(not Path(p['original']).exists(), 'Original retention path is occupied')
            job.update(phase='preserving-original', updatedAt=now())
            write_json(p['job'], job)
            os.rename(original, p['original'])
            fsync_parents(original, p['original'])
            pause(c, 'prior-preserved')

    preserve_original()
    current = identity(c['www'])
    require(current in [job['priorIdentity'], job['candidateIdentity'], recovery['identity']],
            'Unrecognized live root; do not guess rollback')
    restored = locate(recovery['identity'], 'Resource-continuity')
    verify_prior(c, fd, restored, recovery['fingerprint'])
    require(continuity(c).prove(job['priorSmoke'], job['candidateSmoke'], smoke_inventory(restored)) == recovery['proof'],
            'Resource-continuity proof failed before restoration')
    if current != recovery['identity']:
        require(restored in [recovery['root'], p['candidate'], p['rollback']], 'Continuity root has an unexpected location')
        job.update(phase='restoring', updatedAt=now(), restoreRoot=restored)
        write_json(p['job'], job)
        exchange(c['www'], restored, current, recovery['identity'])
        pause(c, 'rollback-exchanged')
    # Both exchanges and both preservation renames are resolved by exact inode
    # after a crash. The publisher's own trap can only restore the union root.
    preserve_original()
    rejected = locate(job['candidateIdentity'], 'Candidate')
    if rejected != p['candidate']:
        require(rejected in [p['rollback'], recovery['root']] and not Path(p['candidate']).exists(),
                'Rejected candidate destination/location is unsafe')
        os.rename(rejected, p['candidate'])
        fsync_parents(rejected, p['candidate'])
        pause(c, 'displaced-preserved')
    require(identity(p['original']) == job['priorIdentity'], 'Original prior retention identity changed')
    verify_prior(c, fd, p['original'], job['priorFingerprint'])
    verify_prior(c, fd, c['www'], recovery['fingerprint'])
    require(continuity(c).prove(job['priorSmoke'], job['candidateSmoke'], smoke_inventory(c['www'])) == recovery['proof'],
            'Restored resource-continuity proof failed')
    job['rollbackSmoke'] = smoke(c, recovery['smoke'])
    job.update(phase='rolled-back', completedAt=now(), updatedAt=now())
    write_json(p['job'], job)
    return job

def prepare(c, fd, args):
    p = paths(c, args.release)
    require(re.fullmatch(r'(?:[0-9a-f]{40}|[0-9a-f]{64})', args.commit or ''), 'Full exact candidate commit required')
    gate_path = safe(args.gates_receipt or '')
    gates = read_json(gate_path)
    require(gates.get('model') == 'proofofwork-reviewed-ui-candidate-v1' and
            gates.get('candidateCommit') == args.commit and gates.get('passed') is True and
            gates.get('rollbackCompatible') is True and gates.get('noPlannedOutage') is True,
            'Reviewed exact-commit candidate gate receipt required')
    require(isinstance(gates.get('checks'), list) and gates['checks'] and all(
        isinstance(x, dict) and x.get('passed') is True and isinstance(x.get('name'), str) and
        re.fullmatch(r'[0-9a-f]{64}', x.get('evidenceSha256', '')) for x in gates['checks']),
        'Every recorded candidate gate must pass with hashed evidence')
    require(not Path(p['job']).exists(), 'Release job already exists; inspect rather than overwrite')
    for record in Path(c['state']).glob('*.json'):
        require(read_json(record)['phase'] in TERMINAL, 'Prior unfinished deployment must recover first')
    for name in ['candidate', 'source']:
        safe(p[name], True)
    safe(p['archive'])
    require(not Path(p['rollback']).exists() and not Path(p['original']).exists(), 'Release rollback/original path already exists')
    retained = args.retain_rollback_root or []
    verify_retained(c, fd, retained)
    command(c, fd, [c['provenance'], 'verify-rollback'], root=c['www'])
    command(c, fd, [c['provenance'], 'verify-candidate', '--release-id', args.release,
                    '--commit', args.commit, '--source-checkout', p['source'], '--archive', p['archive']], root=p['candidate'])
    job = {'model': 'proofofwork-ui-durable-publication-v1', 'publicationModel': PUBLICATION_MODEL, 'release': args.release,
           'commit': args.commit, 'gatesSha256': sha(gate_path.read_bytes()), 'gates': gates, 'phase': 'prepared',
           'preparedAt': now(), 'updatedAt': now(), 'helperHashes': helper_hashes(c),
           'priorIdentity': identity(c['www']), 'candidateIdentity': identity(p['candidate']),
           'priorFingerprint': fingerprint(c, c['www']), 'priorSmoke': smoke_inventory(c['www']),
           'candidateSmoke': smoke_inventory(p['candidate']), 'retained': retained, 'originalRoot': p['original']}
    job['recovery'] = continuity(c).make(c, args.release, c['www'], p['candidate'], SURFACES,
        lambda root: fingerprint(c, root), smoke_inventory,
        lambda argv, root=None: command(c, fd, argv, root=root))
    job['recovery']['identity'] = identity(job['recovery']['root'])
    require(job['recovery']['proof'] == continuity(c).prove(job['priorSmoke'], job['candidateSmoke'], job['recovery']['smoke']),
            'A separately attested cross-boundary resource proof is required')
    job['priorSmokeResult'] = smoke(c, job['priorSmoke'])
    write_json(p['job'], job)
    return job


def require_supervision(c, release):
    if c['test']:
        return
    unit = 'proofofwork-ui-deployment@' + release + '.service'
    timer = 'proofofwork-ui-deployment-recovery.timer'
    def systemctl(*args):
        p = subprocess.run(['/usr/bin/systemctl', *args], check=True,
                           capture_output=True, text=True, timeout=10)
        return p.stdout.strip()
    require(systemctl('show', unit, '--property=MainPID', '--value') == str(os.getpid()),
            'Publication must run as the installed systemd deployment service')
    require(systemctl('is-enabled', unit) == 'enabled', 'Deployment instance must survive session loss and boot')
    require(systemctl('is-active', timer) == 'active' and systemctl('is-enabled', timer) == 'enabled',
            'Independent recovery timer must be active and enabled before publication')
    properties = dict(line.split('=', 1) for line in systemctl('show', unit,
        '--property=KillMode,Restart,RuntimeMaxUSec,PrivateTmp').splitlines())
    require(properties.get('KillMode') == 'control-group' and properties.get('Restart') == 'on-failure' and
            properties.get('RuntimeMaxUSec') == '15min' and properties.get('PrivateTmp') == 'no',
            'Installed deployment supervision differs from the reviewed contract')


def run(c, fd, args):
    p = paths(c, args.release)
    job = read_json(p['job'])
    require(job['release'] == args.release and job['model'] == 'proofofwork-ui-durable-publication-v1', 'Wrong deployment job')
    if job['phase'] in TERMINAL:
        return job
    if args.action == 'recover' or job['phase'] != 'prepared':
        return recover_job(c, fd, job)
    require_supervision(c, args.release)
    require(job.get('publicationModel') == PUBLICATION_MODEL and job.get('originalRoot') == p['original'],
            'Prepublication resource-union model and exact original path required')
    require('recovery' in job, 'Missing pre-attested resource-continuity root; publication is forbidden')
    recovery = job['recovery']
    expected_recovery = continuity(c).locations(c, args.release)
    require(recovery['root'] == expected_recovery['root'] and recovery['archive'] == expected_recovery['archive'],
            'Wrong pre-attested continuity artifact paths')
    require(helper_hashes(c) == job['helperHashes'], 'Helper changed after preparation')
    require(identity(c['www']) == job['priorIdentity'] and identity(p['candidate']) == job['candidateIdentity'], 'Prepared root identity changed')
    verify_prior(c, fd, c['www'], job['priorFingerprint'])
    require(smoke_inventory(p['candidate']) == job['candidateSmoke'], 'Candidate static bytes changed')
    require(identity(recovery['root']) == recovery['identity'], 'Prepared continuity root identity changed')
    verify_prior(c, fd, recovery['root'], recovery['fingerprint'])
    require(continuity(c).prove(job['priorSmoke'], job['candidateSmoke'], smoke_inventory(recovery['root'])) == recovery['proof'],
            'A valid cross-boundary resource proof is required before arming')
    require(not Path(p['original']).exists() and not Path(p['rollback']).exists(), 'Prepared retention path became occupied')
    verify_retained(c, fd, job['retained'])
    job.update(phase='armed', updatedAt=now())
    write_json(p['job'], job)  # Durable before either live root exchange.
    pause(c, 'armed')
    argv = [c['publisher'], '--release-id', args.release, '--commit', job['commit'],
            '--source-checkout', p['source'], '--archive', p['archive']]
    for retained in job['retained']:
        argv += ['--retain-rollback-root', retained]
    argv += ['--retain-rollback-root', Path(p['original']).name + ':' +
             job['priorFingerprint']['manifestSha256'] + ':' + job['priorFingerprint']['treeSha256']]
    try:
        # First serve the exact old HTML with every old/candidate resource. The
        # unchanged publisher now treats this union as its prior root, so even
        # its synchronous EXIT trap preserves assets requested by a new client.
        job.update(phase='prepublishing-union', updatedAt=now())
        write_json(p['job'], job)
        exchange(c['www'], recovery['root'], job['priorIdentity'], recovery['identity'])
        pause(c, 'union-exchanged')
        job.update(phase='preserving-original', updatedAt=now())
        write_json(p['job'], job)
        require(identity(recovery['root']) == job['priorIdentity'] and not Path(p['original']).exists(),
                'Untouched original cannot be preserved safely')
        os.rename(recovery['root'], p['original'])
        fsync_parents(recovery['root'], p['original'])
        pause(c, 'prior-preserved')
        verify_prior(c, fd, p['original'], job['priorFingerprint'])
        verify_prior(c, fd, c['www'], recovery['fingerprint'])
        job['prepublicationSmoke'] = smoke(c, recovery['smoke'])
        job.update(phase='armed', updatedAt=now())
        write_json(p['job'], job)
        output = command(c, fd, argv, timeout=600)
        require('ui_release_publish status=published ' in output, 'Publisher lacks complete publication marker')
        job.update(phase='published-awaiting-smoke', updatedAt=now(), publisherOutputSha256=sha(output.encode()))
        write_json(p['job'], job)
        pause(c, 'published')
        require(identity(c['www']) == job['candidateIdentity'], 'Candidate live identity changed')
        command(c, fd, [c['provenance'], 'verify'], root=c['www'])
        job['candidateSmokeResult'] = smoke(c, job['candidateSmoke'])
        job.update(phase='committed', completedAt=now(), updatedAt=now())
        write_json(p['job'], job)  # Only commit point: provenance AND actual HTTP passed.
        pause(c, 'committed')
        return job
    except Exception as error:
        job.update(failure=str(error), updatedAt=now())
        write_json(p['job'], job)
        recovered = recover_job(c, fd, job)
        raise RuntimeError('Publication failed; prior UI restored: ' + str(error))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'run', 'recover', 'recover-all'])
    parser.add_argument('--release')
    parser.add_argument('--commit')
    parser.add_argument('--gates-receipt')
    parser.add_argument('--retain-rollback-root', action='append')
    parser.add_argument('--test-only', action='store_true')
    parser.add_argument('--test-config')
    args = parser.parse_args()
    c = configuration(args)
    try:
        fd = acquire(c)
    except DeploymentBusy:
        if args.action == 'recover-all':
            print(json.dumps({'skipped': 'active publication/recovery/cleanup owns lock'}))
            return
        raise
    try:
        if args.action == 'prepare':
            result = prepare(c, fd, args)
        elif args.action == 'recover-all':
            result = []
            for p in sorted(Path(c['state']).glob('*.json')):
                job = read_json(p)
                if job['phase'] not in TERMINAL and job['phase'] != 'prepared':
                    result.append(recover_job(c, fd, job))
        else:
            result = run(c, fd, args)
        if isinstance(result, list):
            print(json.dumps({'recovered': [{'release': x['release'], 'phase': x['phase']} for x in result]}))
        else:
            print(json.dumps({'release': result['release'], 'phase': result['phase']}))
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ui_deployment status=refused ' + str(error), file=sys.stderr)
        sys.exit(1)
