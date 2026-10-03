#!/usr/bin/python3 -I
"""Audit30 isolated, plan-bound logical restore. No live database connection.

Run only as postgres in the reviewed transient unit, with a root-created empty
job and LoadCredential=restore-plan:<root-owned0600 reviewed plan>. Every new
job/evidence file remains preserved. The storage ceiling is monitored, not a
filesystem quota: poll/measurement/shutdown latency permits bounded overshoot.
"""
import argparse
import datetime as dt
import fcntl
from fractions import Fraction
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

APPROVAL_SHA = '6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
SCHEMA = 'pow-audit30-latest-logical-restore-plan-v1'
BACKUPS = Path('/data/proofofwork-postgres-backups/logical')
LOCK = BACKUPS / '.proofofwork-postgres-logical-backup.lock'
BIN = Path('/usr/lib/postgresql/16/bin')
MAXIMUM = 80 * 1024**3
DATA_FLOOR = 100 * 1024**3
ROOT_FLOOR = 10 * 1024**3
RUNTIME = 7200
WINDOW_MARGIN = 900
MEMBERS = ('proof_indexer.dump', 'globals.sql', 'SHA256SUMS')
WORK_TOKEN_ID = 'd4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8'
DYNAMIC_CREDIT_CAPS = {
    'a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562': 'POWB',
    '3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d': 'INCB',
}
SERVICES = ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service',
            'proofofwork-api.service', 'proofofwork-indexer-worker.service')
INACCESSIBLE = ('/var/lib/postgresql', '/run/postgresql',
                '/data/proofofwork-postgres-tablespaces',
                '/data/proofofwork-postgres-backups/physical', '/etc/proofofwork-api')
UNIT_INACCESSIBLE = tuple('-'+p if p.endswith('/physical') else p for p in INACCESSIBLE)
UNIT_PROPERTIES = dict(User='postgres', PrivateNetwork='yes', PrivateTmp='yes',
    PrivateIPC='yes', PrivateDevices='yes', ProtectSystem='strict', ProtectHome='yes',
    NoNewPrivileges='yes', ProtectKernelTunables='yes', ProtectKernelModules='yes',
    ProtectControlGroups='yes', RestrictAddressFamilies='AF_UNIX',
    CapabilityBoundingSet='', AmbientCapabilities='', MemoryHigh=str(6*1024**3),
    MemoryMax=str(8*1024**3), CPUQuotaPerSecUSec='1s', CPUWeight='10', IOWeight='10',
    Nice='15', TasksMax='64', RuntimeMaxUSec='2h', KillMode='control-group')
SHA = re.compile(r'[0-9a-f]{64}\Z')
RUN = re.compile(r'[0-9]{8}T[0-9]{6}Z\Z')
IDENT = r'(?:[A-Za-z_][A-Za-z_0-9$]*|"(?:[^"\r\n]|"")+")'
STRING = r"'(?:[^']|'')*'"
ENV = dict(PATH='/usr/bin:/bin', LC_ALL='C', LANG='C', TZ='UTC')


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def pairs(rows):
    value = {}
    for k, v in rows:
        if k in value:
            raise ValueError('Duplicate JSON key')
        value[k] = v
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def metadata(path):
    s = Path(path).lstat()
    return dict(device=s.st_dev, inode=s.st_ino, mode=stat.S_IMODE(s.st_mode),
        uid=s.st_uid, gid=s.st_gid, bytes=s.st_size, mtimeNs=s.st_mtime_ns,
        ctimeNs=s.st_ctime_ns, nlink=s.st_nlink)


def canonical_path(path):
    p = Path(path)
    if not p.is_absolute() or p.resolve(strict=True) != p:
        raise ValueError('Noncanonical path')
    return p


def hash_file(path, expected=None, limit=None, no_atime=True, heartbeat=None):
    p = canonical_path(path)
    before = metadata(p)
    if not stat.S_ISREG(p.lstat().st_mode) or before['nlink'] != 1 or before['mode'] & 0o7022:
        raise ValueError('Unsafe input file')
    if expected and before != {k: expected[k] for k in before}:
        raise ValueError('Input metadata changed')
    if limit is not None and before['bytes'] > limit:
        raise ValueError('Input byte bound')
    h = hashlib.sha256()
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | (os.O_NOATIME if no_atime else 0))
    with os.fdopen(fd, 'rb') as f:
        if metadata(p) != before:
            raise ValueError('Input open changed')
        while raw := f.read(1024**2):
            if heartbeat:heartbeat()
            h.update(raw)
    if metadata(p) != before or expected and h.hexdigest() != expected['sha256']:
        raise ValueError('Input hash/identity changed')
    return h.hexdigest()


def durable(path, value):
    raw = canonical(value) + b'\n'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    parent = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def command(argv, maximum=2*1024**2, timeout=30):
    r = subprocess.run(argv, env=ENV, capture_output=True, timeout=timeout)
    if r.returncode or len(r.stdout) > maximum or len(r.stderr) > 65536:
        raise RuntimeError('Bounded command refused')
    return r.stdout


def system_properties(unit, names):
    raw = command(['/usr/bin/systemctl', 'show', unit,
                   *sum([['-p', n] for n in names], [])], maximum=65536)
    return dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)


def validate_plan(value):
    keys = {'schema', 'approvalSha256', 'controllerSha256', 'runId', 'host', 'job',
            'unit', 'backup', 'backupLock', 'toc', 'backupWindow', 'liveServices'}
    if set(value) != keys or value['schema'] != SCHEMA or value['approvalSha256'] != APPROVAL_SHA:
        raise ValueError('Plan authority/scope mismatch')
    rid = value['runId']
    if not isinstance(rid, str) or not RUN.fullmatch(rid):
        raise ValueError('Invalid run identity')
    dt.datetime.strptime(rid, '%Y%m%dT%H%M%SZ')
    if value['job'] != '/data/proofofwork-audit30-restore-' + rid or value['unit'] != 'proofofwork-audit30-logical-restore-' + rid + '.service':
        raise ValueError('Wrong job/unit identity')
    if not isinstance(value['host'], str) or not re.fullmatch(r'[A-Za-z0-9.-]+', value['host']):
        raise ValueError('Invalid host')
    if not SHA.fullmatch(value['controllerSha256']):
        raise ValueError('Invalid controller hash')
    b = value['backup']
    if set(b) != {'path', 'directory', 'members'} or not re.fullmatch(str(BACKUPS) + r'/proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset', b['path']) or set(b['members']) != set(MEMBERS):
        raise ValueError('Wrong backup scope')
    identity_keys = {'device', 'inode', 'mode', 'uid', 'gid', 'bytes', 'mtimeNs', 'ctimeNs', 'nlink'}
    for row in [b['directory'], value['backupLock'], *b['members'].values()]:
        extra = {'sha256'} if row in b['members'].values() else set()
        if set(row) != identity_keys | extra or any(type(row[k]) is not int or row[k] < 0 for k in identity_keys):
            raise ValueError('Invalid identity tuple')
        if row['mode'] & 0o7022 or row['nlink'] < 1:
            raise ValueError('Unsafe identity tuple')
        if extra and (row['nlink'] != 1 or not SHA.fullmatch(row['sha256'])):
            raise ValueError('Invalid member hash/link')
    if set(value['toc']) != {'sha256', 'entries'} or not SHA.fullmatch(value['toc']['sha256']) or type(value['toc']['entries']) is not int or not 1 <= value['toc']['entries'] <= 100000:
        raise ValueError('Invalid TOC binding')
    if set(value['backupWindow']) != {'preflightAtUtc', 'nextScheduledAtUtc'}:
        raise ValueError('Invalid backup window')
    for text in value['backupWindow'].values():
        if dt.datetime.fromisoformat(text).utcoffset() != dt.timedelta(0):
            raise ValueError('Backup window must be UTC')
    if set(value['liveServices']) != set(SERVICES):
        raise ValueError('Wrong live authorities')
    for row in value['liveServices'].values():
        if set(row) != {'MainPID', 'InvocationID'} or not str(row['MainPID']).isdigit() or int(row['MainPID']) <= 0 or not re.fullmatch(r'[0-9a-f]{32}', row['InvocationID']):
            raise ValueError('Invalid live identity')
    return value


def validate_managed_credential(path, unit, name, source_root_plan):
    """Attest the native systemd root0440 credential without exposing bytes.

    The caller separately binds the credential's raw SHA before/after this
    check. The original root0600 plan stays unreadable to the postgres unit.
    Its exact LoadCredential source and immutable package are independently
    bound through typed D-Bus, not systemctl's unprintable rendering.
    """
    if not re.fullmatch(r'[A-Za-z0-9@_.:-]+\.service', unit) or not re.fullmatch(r'[a-z][a-z0-9-]*', name):
        raise ValueError('Invalid managed credential identity')
    p = canonical_path(path)
    directory = canonical_path('/run/credentials/' + unit)
    source = canonical_path(source_root_plan)
    package = canonical_path(Path(__file__).parent)
    if p != directory/name or source != package/'reviewed-plan.json' or os.environ.get('CREDENTIALS_DIRECTORY') != str(directory):
        raise ValueError('Managed credential location/source/environment differs')
    if os.geteuid() != pwd.getpwnam('postgres').pw_uid:
        raise ValueError('Managed credential requires postgres')
    cgroups = Path('/proc/self/cgroup').read_text().splitlines()
    if not any(len(row.split(':', 2)) == 3 and row.split(':', 2)[2] == '/system.slice/' + unit for row in cgroups):
        raise ValueError('Credential is not in its managed service')
    before = {label: metadata(q) for label, q in [('credential', p), ('directory', directory), ('source', source), ('package', package)]}
    c, d, s, root = (before[k] for k in ['credential', 'directory', 'source', 'package'])
    if not stat.S_ISREG(p.lstat().st_mode) or c['uid'] != 0 or c['gid'] != 0 or c['mode'] != 0o440 or c['nlink'] != 1 or c['bytes'] > 65536:
        raise ValueError('Unsafe native credential')
    if not directory.is_dir() or d['uid'] != 0 or d['gid'] != 0 or d['mode'] != 0o550 or d['device'] != c['device'] or set(os.listdir(directory)) != {name}:
        raise ValueError('Unsafe native credential directory')
    if not stat.S_ISREG(source.lstat().st_mode) or s['uid'] != 0 or s['gid'] != 0 or s['mode'] != 0o600 or s['nlink'] != 1 or s['bytes'] != c['bytes']:
        raise ValueError('Unsafe original root plan')
    if not package.is_dir() or root['uid'] != 0 or root['mode'] & 0o7022:
        raise ValueError('Unsafe original plan package')
    if not os.access(p, os.R_OK) or os.access(p, os.W_OK) or os.access(directory, os.W_OK) or os.access(source, os.R_OK) or os.access(source, os.W_OK):
        raise ValueError('Credential/source access differs')
    props = system_properties(unit, ['User', 'ProtectSystem', 'NoNewPrivileges', 'CapabilityBoundingSet', 'AmbientCapabilities'])
    if props != dict(User='postgres', ProtectSystem='strict', NoNewPrivileges='yes', CapabilityBoundingSet='', AmbientCapabilities=''):
        raise ValueError('Credential unit privilege/immutability differs')
    matches = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split()
        if len(fields) < 10 or fields[4] != str(directory):
            continue
        split = fields.index('-')
        if split < 6 or len(fields) != split + 4:
            raise ValueError('Malformed credential mount')
        matches.append(fields)
    if len(matches) != 1:
        raise ValueError('Credential readonly mount missing/ambiguous')
    mount = matches[0]; split = mount.index('-')
    if mount[2] != str(os.major(c['device'])) + ':' + str(os.minor(c['device'])) or mount[3] != '/' or mount[split+1:split+3] != ['tmpfs', 'tmpfs'] or 'rw' in mount[5].split(',') or not {'ro', 'nosuid', 'nodev', 'noexec', 'nosymfollow'} <= set(mount[5].split(',')):
        raise ValueError('Credential mount isolation differs')
    object_path = '/org/freedesktop/systemd1/unit/' + ''.join(ch if ch.isascii() and ch.isalnum() else '_' + format(ord(ch), '02x') for ch in unit)
    manager = json.loads(command(['/usr/bin/busctl', '--system', '--json=short', 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1', 'org.freedesktop.systemd1.Manager', 'GetUnit', 's', unit], maximum=65536), object_pairs_hook=pairs)
    if manager != dict(type='o', data=[object_path]):
        raise ValueError('Typed credential unit binding differs')
    loaded = json.loads(command(['/usr/bin/busctl', '--system', '--json=short', 'get-property', 'org.freedesktop.systemd1', object_path, 'org.freedesktop.systemd1.Service', 'LoadCredential'], maximum=65536), object_pairs_hook=pairs)
    if loaded != dict(type='a(ss)', data=[[name, str(source)]]):
        raise ValueError('Typed LoadCredential source differs')
    if before != {label: metadata(q) for label, q in [('credential', p), ('directory', directory), ('source', source), ('package', package)]}:
        raise ValueError('Managed credential authority changed')
    return dict(unit=unit, name=name, sourceRootPlan=str(source), readonlyCredential=True, typedLoadCredentialBound=True)


def read_plan(path, sha, credential=False):
    if not SHA.fullmatch(sha):
        raise ValueError('Plan raw SHA required')
    p = canonical_path(path)
    m = metadata(p)
    if m['uid'] != 0 or m['mode'] != (0o440 if credential else 0o600) or m['bytes'] > 65536:
        raise ValueError('Unsafe plan authority/credential')
    raw = p.read_bytes()
    if metadata(p) != m or hashlib.sha256(raw).hexdigest() != sha:
        raise ValueError('Plan identity/hash changed')
    value = validate_plan(json.loads(raw, object_pairs_hook=pairs))
    if credential:
        validate_managed_credential(p, value['unit'], 'restore-plan', Path(__file__).parent/'reviewed-plan.json')
        if hashlib.sha256(p.read_bytes()).hexdigest() != sha or metadata(p) != m:
            raise ValueError('Credential changed during managed attestation')
    return value


def check_runtime(plan):
    unit = plan['unit']
    if os.geteuid() != pwd.getpwnam('postgres').pw_uid or os.uname().nodename != plan['host']:
        raise ValueError('Wrong execution user/host')
    if '/system.slice/' + unit not in Path('/proc/self/cgroup').read_text().splitlines()[0]:
        raise ValueError('Unmanaged restore refused')
    wanted = {**UNIT_PROPERTIES, 'ReadWritePaths': plan['job'], 'ReadOnlyPaths': str(BACKUPS)}
    actual = system_properties(unit, [*wanted, 'InaccessiblePaths'])
    if any(actual.get(k) != v for k, v in wanted.items()) or set(actual.get('InaccessiblePaths', '').split()) != set(UNIT_INACCESSIBLE):
        raise ValueError('Weakened private unit')
    for p in INACCESSIBLE:
        try:
            os.listdir(p)
        except (PermissionError, FileNotFoundError):
            continue
        raise ValueError('Live PostgreSQL path is accessible')
    return actual


def check_live(plan):
    result = {}
    for name, expected in plan['liveServices'].items():
        p = system_properties(name, ['MainPID', 'InvocationID', 'ActiveState'])
        if p.get('ActiveState') != 'active' or any(str(p.get(k)) != str(v) for k, v in expected.items()):
            raise ValueError('Live service identity drift')
        result[name] = p
    return result


def check_window(plan, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    w = plan['backupWindow']
    captured = dt.datetime.fromisoformat(w['preflightAtUtc'])
    deadline = dt.datetime.fromisoformat(w['nextScheduledAtUtc'])
    if not 0 <= (now-captured).total_seconds() <= 900 or (deadline-now).total_seconds() < RUNTIME+WINDOW_MARGIN:
        raise ValueError('Insufficient/fresh backup window')
    s = system_properties('proofofwork-postgres-logical-backup.service', ['ActiveState'])
    t = system_properties('proofofwork-postgres-logical-backup.timer', ['ActiveState', 'NextElapseUSecRealtime'])
    actual = dt.datetime.strptime(t.get('NextElapseUSecRealtime', ''), '%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc)
    if s.get('ActiveState') != 'inactive' or t.get('ActiveState') != 'active' or actual != deadline:
        raise ValueError('Backup timer/service changed')


def allocation(job):
    for _ in range(3):
        try:
            raw = command(['/usr/bin/du', '-x', '-s', '-B1', '--', str(job)], maximum=65536, timeout=15)
            return int(raw.split()[0])
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            time.sleep(.2)
    raise ValueError('Allocation read repeatedly failed')


def storage_sample(job, preflight=False):
    # The sole optional namespace path was proved absent in the fresh root
    # census. If it later appears and is readable, supervision fails closed.
    for p in INACCESSIBLE:
        try:os.listdir(p)
        except (PermissionError, FileNotFoundError):continue
        raise ValueError('Live namespace path became accessible')
    used = allocation(job)
    data = os.statvfs('/data'); root = os.statvfs('/')
    available = data.f_bavail * data.f_frsize
    root_available = root.f_bavail * root.f_frsize
    sample = dict(atUtc=utc(),jobAllocatedBytes=used,dataAvailableBytes=available,rootAvailableBytes=root_available)
    if used > MAXIMUM or available < DATA_FLOOR + (MAXIMUM if preflight else 0) or root_available < ROOT_FLOOR:
        raise ValueError('Storage bound/reserve refused')
    return sample


class Watchdog:
    def __init__(self, job, sample=storage_sample, interval=5):
        self.job, self.sample, self.interval, self.pid = Path(job), sample, interval, None

    def start(self):
        pid = os.fork()
        if pid:
            self.pid = pid
            return
        def stop(*_):
            raise SystemExit(143)
        signal.signal(signal.SIGTERM, stop)
        try:
            with (self.job/'storage-samples.jsonl').open('x') as f:
                while True:
                    row = self.sample(self.job)
                    f.write(json.dumps(row, sort_keys=True)+'\n'); f.flush(); os.fsync(f.fileno())
                    if (self.job/'watchdog-stop-requested.json').exists():os._exit(0)
                    time.sleep(self.interval)
        except BaseException as e:
            try:durable(self.job/'resource-failure.json', dict(atUtc=utc(),errorClass=type(e).__name__,reason='watchdog-failed'))
            except BaseException:pass
            os._exit(1)

    def assert_alive(self):
        if not self.pid or os.waitpid(self.pid, os.WNOHANG) != (0, 0) or (self.job/'resource-failure.json').exists():
            self.pid = None
            raise ValueError('Storage watchdog lost during foreground work')

    def stop(self):
        self.assert_alive()
        durable(self.job/'watchdog-stop-requested.json', dict(atUtc=utc(),intentional=True))
        if self.pid:
            # Success uses cooperative shutdown after one final successful
            # measurement. A late failure, SIGKILL, or unintentional exit must
            # never be blessed merely because a stop marker now exists.
            deadline=time.monotonic()+55
            status=None
            while time.monotonic()<deadline:
                pid,status=os.waitpid(self.pid,os.WNOHANG)
                if pid:break
                time.sleep(.02)
            else:
                os.kill(self.pid,signal.SIGKILL);os.waitpid(self.pid,0);self.pid=None
                raise ValueError('Watchdog intentional shutdown timed out')
            self.pid = None
            if status!=0 or (self.job/'resource-failure.json').exists():raise ValueError('Watchdog failed during final fences/shutdown')


class Runner:
    def __init__(self, job, watcher, started=None):
        self.job, self.watcher = Path(job), watcher
        self.started = time.monotonic() if started is None else started
        self.number = 0

    def run(self, argv, phase, stdin=None, sink=None, timeout=3600, maximum=2*1024**2):
        self.number += 1
        out = bytearray(); pending = bytearray()
        with (self.job/f'{self.number:02d}-{phase}.stderr').open('xb') as err:
            child = subprocess.Popen(argv, env=ENV, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=err, start_new_session=True)
            deadline = min(time.monotonic()+timeout, self.started+RUNTIME)
            try:
                os.set_blocking(child.stdout.fileno(), False)
                with selectors.DefaultSelector() as select:
                    select.register(child.stdout, selectors.EVENT_READ)
                    sent=0
                    if stdin is not None:
                        os.set_blocking(child.stdin.fileno(),False)
                        if stdin:select.register(child.stdin,selectors.EVENT_WRITE)
                        else:child.stdin.close()
                    eof = False
                    while not eof or child.poll() is None:
                        self.watcher.assert_alive()
                        if time.monotonic() > deadline:raise TimeoutError('Managed phase deadline')
                        for key,_ in select.select(.2):
                            if key.fileobj is child.stdin:
                                sent+=os.write(child.stdin.fileno(),stdin[sent:sent+65536])
                                if sent==len(stdin):select.unregister(child.stdin);child.stdin.close()
                                continue
                            block = os.read(key.fileobj.fileno(), 1024**2)
                            if not block:
                                select.unregister(key.fileobj); eof = True; continue
                            if sink:
                                pending.extend(block)
                                if len(pending)>128*1024**2:raise ValueError('COPY row byte bound')
                                while (end:=pending.find(b'\n'))>=0:
                                    sink(bytes(pending[:end])); del pending[:end+1]
                            else:
                                out.extend(block)
                                if len(out)>maximum:raise ValueError('Phase output byte bound')
                        if err.tell()>8*1024**2:raise ValueError('Private stderr byte bound')
                    if pending:raise ValueError('Unterminated COPY stream')
                    if child.wait():raise RuntimeError('Isolated command failed: '+phase)
            except BaseException:
                # Preserve the first failure while reaping this owned process
                # group. A repeated ordinary signal must not abandon cleanup.
                cleanup_handlers={s:signal.signal(s,signal.SIG_IGN) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
                try:
                    if child.poll() is None:
                        try:os.killpg(child.pid, signal.SIGTERM)
                        except ProcessLookupError:pass
                        try:child.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            try:os.killpg(child.pid,signal.SIGKILL)
                            except ProcessLookupError:pass
                            child.wait()
                finally:
                    for s,handler in cleanup_handlers.items():signal.signal(s,handler)
                raise
            finally:
                for stream in (child.stdout,child.stdin):
                    if stream and not stream.closed:
                        try:stream.close()
                        except OSError:pass
        self.watcher.assert_alive()
        return bytes(out)


def sql_identifier(token):
    if not re.fullmatch(IDENT, token):raise ValueError('Invalid SQL identifier')
    return token[1:-1].replace('""','"') if token.startswith('"') else token.lower()


def sql_string(token):
    if not re.fullmatch(STRING,token,re.S):raise ValueError('Invalid SQL string')
    return token[1:-1].replace("''", "'")


def split_globals(raw):
    text = raw.decode('utf-8');rows=[];part=[];quoted=None;i=0;wrapper=None
    while i<len(text):
        c=text[i]
        if quoted:
            part.append(c)
            if c==quoted:
                if i+1<len(text) and text[i+1]==quoted:part.append(text[i+1]);i+=1
                else:quoted=None
        elif c=='\\' and (i==0 or text[i-1]=='\n'):
            end=text.find('\n',i);end=len(text) if end<0 else end;line=text[i:end]
            m=re.fullmatch(r'\\(restrict|unrestrict) ([A-Za-z0-9]+)',line)
            if not m or ''.join(part).strip():raise ValueError('Unknown/embedded globals meta command')
            if m[1]=='restrict':
                if wrapper is not None:raise ValueError('Nested globals wrapper')
                wrapper=m[2]
            else:
                if wrapper!=m[2]:raise ValueError('Mismatched globals wrapper')
                wrapper=None
            i=end
        elif text.startswith('--',i):
            end=text.find('\n',i);i=len(text) if end<0 else end;part.append(' ')
        elif c in "'\"":quoted=c;part.append(c)
        elif c==';':
            row=''.join(part).strip();part=[]
            if row:rows.append(row)
        else:part.append(c)
        i+=1
    if quoted or wrapper is not None or ''.join(part).strip():raise ValueError('Unterminated globals SQL/wrapper')
    return rows


def role_globals(raw):
    """Explicit pg_dumpall role grammar. Unknown SQL/meta commands refuse.

    No raw globals are executed: only accepted role/membership commands are
    emitted. Tablespaces are classified/omitted; passwords stay in private RAM.
    """
    statements=[]; roles={}; grants=[]; excluded=0
    defaults=dict(rolsuper=False,rolinherit=True,rolcreaterole=False,rolcreatedb=False,rolcanlogin=False,
        rolreplication=False,rolbypassrls=False,rolconnlimit=-1,rolpassword=None,rolconfig=None,rolvaliduntil=None)
    flags={'SUPERUSER':('rolsuper',True),'NOSUPERUSER':('rolsuper',False),'INHERIT':('rolinherit',True),
        'NOINHERIT':('rolinherit',False),'CREATEROLE':('rolcreaterole',True),'NOCREATEROLE':('rolcreaterole',False),
        'CREATEDB':('rolcreatedb',True),'NOCREATEDB':('rolcreatedb',False),'LOGIN':('rolcanlogin',True),
        'NOLOGIN':('rolcanlogin',False),'REPLICATION':('rolreplication',True),'NOREPLICATION':('rolreplication',False),
        'BYPASSRLS':('rolbypassrls',True),'NOBYPASSRLS':('rolbypassrls',False)}
    for row in split_globals(raw):
        if re.fullmatch(r"SET (?:default_transaction_read_only = off|client_encoding = 'UTF8'|standard_conforming_strings = on)",row):continue
        m=re.fullmatch('CREATE ROLE ('+IDENT+')',row)
        if m:
            name=sql_identifier(m[1])
            if name in roles:raise ValueError('Duplicate global role')
            roles[name]=defaults.copy()
            if name!='postgres':statements.append(row+';')
            continue
        m=re.fullmatch('ALTER ROLE ('+IDENT+') WITH (.+)',row,re.S)
        if m:
            name=sql_identifier(m[1]);tail=m[2]
            if name not in roles:raise ValueError('ALTER without explicit source role')
            seen=set()
            while tail:
                f=re.match(r'([A-Z]+)(?:\s+|$)',tail)
                if f and f[1] in flags:
                    field,v=flags[f[1]]
                    if field in seen:raise ValueError('Duplicate role attribute')
                    roles[name][field]=v;seen.add(field);tail=tail[f.end():];continue
                p=re.match('PASSWORD ('+STRING+r'|NULL)(?:\s+|$)',tail,re.S)
                if p:
                    if 'rolpassword' in seen:raise ValueError('Duplicate password')
                    roles[name]['rolpassword']=None if p[1]=='NULL' else sql_string(p[1]);seen.add('rolpassword');tail=tail[p.end():];continue
                p=re.match(r'CONNECTION LIMIT (-?[0-9]+)(?:\s+|$)',tail)
                if p:
                    if 'rolconnlimit' in seen:raise ValueError('Duplicate connection limit')
                    roles[name]['rolconnlimit']=int(p[1]);seen.add('rolconnlimit');tail=tail[p.end():];continue
                p=re.match('VALID UNTIL ('+STRING+r')(?:\s+|$)',tail)
                if p:
                    value=sql_string(p[1])
                    if 'rolvaliduntil' in seen or not re.fullmatch(r'(?:infinity|[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:.]+[+-][0-9:]+)',value):raise ValueError('Unsupported role expiry')
                    roles[name]['rolvaliduntil']=value;seen.add('rolvaliduntil');tail=tail[p.end():];continue
                raise ValueError('Unsupported role attributes')
            statements.append(row+';');continue
        m=re.fullmatch('GRANT ('+IDENT+') TO ('+IDENT+')(?: WITH (ADMIN OPTION|(?:ADMIN|INHERIT|SET) (?:TRUE|FALSE)(?:, (?:ADMIN|INHERIT|SET) (?:TRUE|FALSE))*))?(?: GRANTED BY ('+IDENT+'))?',row)
        if m:
            options=dict(admin_option=False,inherit_option=True,set_option=True)
            if m[3]=='ADMIN OPTION':options['admin_option']=True
            elif m[3]:
                seen=set()
                for option in m[3].split(', '):
                    k,v=option.split(' ');key=k.lower()+'_option'
                    if key in seen:raise ValueError('Duplicate grant option')
                    seen.add(key);options[key]=v=='TRUE'
            grants.append(dict(role=sql_identifier(m[1]),member=sql_identifier(m[2]),grantor=sql_identifier(m[4]) if m[4] else 'postgres',**options))
            statements.append(row+';');continue
        m=re.fullmatch('ALTER ROLE ('+IDENT+') SET (statement_timeout|lock_timeout|idle_in_transaction_session_timeout|temp_file_limit|work_mem) TO ('+STRING+'|[0-9]+)',row)
        if m:
            value=sql_string(m[3]) if m[3].startswith("'") else m[3]
            if not re.fullmatch(r'[0-9]+(?:ms|s|min|h|kB|MB|GB)?',value):raise ValueError('Unsafe role setting')
            name=sql_identifier(m[1])
            if name not in roles:raise ValueError('Unknown role setting owner')
            config=roles[name]['rolconfig'] or []
            if any(v.split('=',1)[0]==m[2] for v in config):raise ValueError('Duplicate role setting')
            roles[name]['rolconfig']=config+[m[2]+'='+value]
            statements.append(row+';');continue
        if re.fullmatch('COMMENT ON ROLE '+IDENT+' IS (?:'+STRING+'|NULL)',row,re.S):statements.append(row+';');continue
        if re.fullmatch('CREATE TABLESPACE '+IDENT+' OWNER '+IDENT+' LOCATION '+STRING,row,re.S) or re.fullmatch('ALTER TABLESPACE '+IDENT+' OWNER TO '+IDENT,row) or re.fullmatch('COMMENT ON TABLESPACE '+IDENT+' IS (?:'+STRING+'|NULL)',row,re.S):
            excluded+=1;continue
        raise ValueError('Unsupported globals statement')
    if 'postgres' not in roles or not roles['postgres']['rolsuper'] or not roles['postgres']['rolcanlogin']:
        raise ValueError('Isolated control role would be disabled')
    if len({(g['role'],g['member']) for g in grants})!=len(grants):raise ValueError('Duplicate global membership')
    return ('\n'.join(statements)+'\n').encode(),roles,grants,excluded


ROLE_CATALOG_SQL = """SELECT jsonb_build_object(
    'unsupportedSettings', (SELECT count(*) FROM pg_db_role_setting s
        WHERE s.setdatabase <> 0 OR s.setrole = 0
           OR NOT EXISTS (SELECT 1 FROM pg_authid a WHERE a.oid = s.setrole)),
    'roles', (SELECT jsonb_agg(to_jsonb(r)) FROM (
        SELECT a.rolname,a.rolsuper,a.rolinherit,a.rolcreaterole,a.rolcreatedb,
            a.rolcanlogin,a.rolreplication,a.rolbypassrls,a.rolconnlimit,
            a.rolpassword,s.setconfig AS rolconfig,a.rolvaliduntil::text
        FROM pg_authid a LEFT JOIN pg_db_role_setting s
            ON s.setrole = a.oid AND s.setdatabase = 0
        ORDER BY a.rolname) r));"""


def verify_role_catalog(actual, roles):
    """PG16 role attributes plus global settings; unsupported scopes refuse."""
    if not isinstance(actual,dict) or set(actual)!={'unsupportedSettings','roles'}:
        raise ValueError('Unexpected isolated role catalog shape')
    count=actual['unsupportedSettings']
    if type(count) is not int or count!=0:
        raise ValueError('Unsupported isolated database/role-independent settings')
    rows=actual['roles']
    if not isinstance(rows,list) or not all(isinstance(r,dict) and isinstance(r.get('rolname'),str) for r in rows):
        raise ValueError('Unexpected isolated role catalog rows')
    by_role={r['rolname']:{k:v for k,v in r.items() if k!='rolname'} for r in rows}
    if len(by_role)!=len(rows) or {n for n in by_role if not n.startswith('pg_')}!=set(roles) or any(by_role.get(n)!=v for n,v in roles.items()):
        raise ValueError('Exact isolated role/password attributes differ')
    if any(v.get('rolconfig') is not None for n,v in by_role.items() if n not in roles):
        raise ValueError('Unexpected settings on an unsourced predefined role')


def security_statements(raw):
    """Independent source/restored schema ownership/ACL/defaultACL parity.

    A bounded SQL lexer tracks quotes/dollar bodies/comments so GRANT-looking
    function text cannot masquerade as a top-level ACL. No schema SQL executes.
    """
    if len(raw)>8*1024**2:raise ValueError('Schema security byte bound')
    text=raw.decode();quote=None;part=[];commands=[];i=0;wrapper=None
    while i<len(text):
        c=text[i]
        if quote:
            if text.startswith(quote,i):
                part.append(quote);i+=len(quote)
                if quote in ("'",'"') and text.startswith(quote,i):part.append(quote);i+=1;continue
                quote=None;continue
            part.append(c);i+=1;continue
        if c=='\\' and (i==0 or text[i-1]=='\n'):
            end=text.find('\n',i);end=len(text) if end<0 else end;line=text[i:end]
            if ''.join(part).strip():raise ValueError('Embedded schema meta command')
            m=re.fullmatch(r'\\(restrict|unrestrict) ([A-Za-z0-9]+)',line)
            if m:
                if m[1]=='restrict':
                    if wrapper is not None:raise ValueError('Nested schema wrapper')
                    wrapper=m[2]
                else:
                    if wrapper!=m[2]:raise ValueError('Mismatched schema wrapper')
                    wrapper=None
            elif not re.fullmatch(r'\\connect proof_indexer|\\connect -reuse-previous=on "dbname=\x27proof_indexer\x27"',line):raise ValueError('Unknown schema meta command')
            i=end;continue
        if text.startswith('--',i):
            end=text.find('\n',i);i=len(text) if end<0 else end;part.append(' ');continue
        if text.startswith('/*',i):
            end=text.find('*/',i+2)
            if end<0:raise ValueError('Unterminated schema comment')
            i=end+2;part.append(' ');continue
        m=re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$',text[i:]) if c=='$' else None
        if c in "'\"" or m:
            quote=m[0] if m else c;part.append(quote);i+=len(quote);continue
        if c==';':commands.append(''.join(part).strip());part=[];i+=1;continue
        part.append(c);i+=1
    if quote or wrapper is not None or ''.join(part).strip():raise ValueError('Unterminated schema SQL/wrapper')
    selected=[]
    for row in commands:
        if not (re.match(r'^(?:GRANT |REVOKE |ALTER DEFAULT PRIVILEGES )',row) or re.match(r'^ALTER ',row) and re.search(r'\bOWNER TO '+IDENT+r'$',row)):continue
        normalized=[];quote=None;white=False;i=0
        while i<len(row):
            c=row[i]
            if quote:
                normalized.append(c)
                if c==quote:
                    if i+1<len(row) and row[i+1]==quote:normalized.append(row[i+1]);i+=1
                    else:quote=None
            elif c in "'\"":
                if white and normalized:normalized.append(' ')
                white=False;quote=c;normalized.append(c)
            elif c.isspace():white=True
            else:
                if white and normalized:normalized.append(' ')
                white=False;normalized.append(c)
            i+=1
        selected.append(''.join(normalized))
    if len(selected)!=len(set(selected)):raise ValueError('Duplicate schema security statement')
    return sorted(selected)


class RowHashes:
    def __init__(self):self.rows=[];self.bytes=0
    def add(self,row):
        if len(self.rows)>=2000000:raise ValueError('COPY row count bound')
        self.rows.append(hashlib.sha256(row).digest());self.bytes+=len(row)+1
    def receipt(self):
        h=hashlib.sha256(b'copy-row-sha256-multiset-v1\0'+len(self.rows).to_bytes(8,'big'))
        for row in sorted(self.rows):h.update(row)
        return dict(rows=len(self.rows),copyBytes=self.bytes,multisetSha256=h.hexdigest())


class BackupCopy:
    def __init__(self):self.tables={};self.current=None;self.sequences={}
    def line(self,row):
        if self.current:
            if row==b'\\.':self.current=None
            else:self.tables[self.active]['hashes'].add(row)
            return
        text=row.decode('utf-8')
        m=re.fullmatch(r'COPY ('+IDENT+r')\.('+IDENT+r') \(('+IDENT+r'(?:, '+IDENT+r')*)\) FROM stdin;',text)
        if m:
            schema=sql_identifier(m[1]);name=schema+'.'+sql_identifier(m[2]);columns=[sql_identifier(c) for c in m[3].split(', ')]
            if schema!='proof_indexer' or not re.fullmatch(r'proof_indexer\.[a-z_][a-z_0-9]*',name) or name in self.tables or len(set(columns))!=len(columns) or any(not re.fullmatch('[a-z_][a-z_0-9]*',c) for c in columns):raise ValueError('Invalid/duplicate COPY table')
            self.tables[name]=dict(columns=columns,hashes=RowHashes());self.current=True;self.active=name;return
        m=re.fullmatch(r"SELECT pg_catalog.setval\('(proof_indexer\.[a-z_][a-z_0-9]*)', ([0-9]+), (true|false)\);",text)
        if m:
            if m[1] in self.sequences:raise ValueError('Duplicate sequence')
            self.sequences[m[1]]=dict(last_value=int(m[2]),is_called=m[3]=='true');return
        if not text or text.startswith('--') or re.fullmatch(r'\\(?:un)?restrict [A-Za-z0-9]+',text) or re.fullmatch(r'SET [a-z_]+ = (?:[a-z_0-9]+|'+STRING+r');',text) or re.fullmatch(r"SELECT pg_catalog.set_config\('search_path', '', false\);",text):return
        raise ValueError('Unsupported backup COPY stream command')
    def complete(self):
        if self.current or not self.tables:raise ValueError('Incomplete/empty backup COPY inventory')


def psql(job, database='proof_indexer'):
    return [str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(job/'socket'),'-p','55432','-U','postgres','-d',database]


def query(runner,job,sql,phase,database='proof_indexer'):
    raw=runner.run([*psql(job,database),'-c',sql],phase,timeout=600,maximum=1024**2)
    return json.loads(raw,object_pairs_hook=pairs)


def credit_invariants(rows, source_integrity):
    """Exact saved-snapshot integer/rational oracle; no floating-point math."""
    required = {'malformedConfirmedMintAmounts', 'unjoinedConfirmedMintTokens', 'unjoinedNonzeroConfirmedBalances', 'nonintegerOrNonfiniteBalanceRows'}
    if not isinstance(source_integrity, dict) or set(source_integrity) != required or any(type(source_integrity[k]) is not int or source_integrity[k] != 0 for k in required):
        raise ValueError('Credit source population omitted/invalid accounting')
    if not isinstance(rows,list) or not rows or len(rows)>10000:raise ValueError('Credit oracle row bound')
    seen=set()
    for r in rows:
        token=r['tokenId']
        if token in seen:raise ValueError('Duplicate credit oracle token')
        seen.add(token)
        scale=10**16 if token==WORK_TOKEN_ID else 1
        if token==WORK_TOKEN_ID and r['ticker']!='WORK':raise ValueError('Canonical WORK ticker differs')
        balance=Fraction(r['balance']);minted=Fraction(r['mintedHuman']);maximum=Fraction(r['maxSupply'])
        if balance.denominator!=1 or balance<0 or Fraction(r['minimum'])<0 or r['noninteger']!=0 or balance!=minted*scale:
            raise ValueError('Exact credit conservation/integer/nonnegative invariant')
        if maximum>0:
            if balance>maximum*scale:raise ValueError('Credit supply cap invariant')
        elif maximum!=0 or DYNAMIC_CREDIT_CAPS.get(token)!=r['ticker']:
            raise ValueError('Unexpected zero/dynamic credit cap')
    if WORK_TOKEN_ID not in seen:raise ValueError('Q16-era canonical WORK accounting missing')
    return dict(definitions=len(rows),nonnegativeIntegerBalances=True,confirmedMintConservation=True,
        cappedCreditsRespectSupply=True,workScale='10000000000000000',math='exact-python-integer-fraction-v1',
        sourcePopulationChecks=source_integrity,
        oracleSourceSha256='635d81afcfdb31c9ad491e32bbaa32607d75f23707d7634ab4d4a7dde9971caa',
        qualification='Restored saved-snapshot confirmed balances versus confirmed valid token-mint events with explicit malformed/unjoined population checks. Canonical POWB/INCB zero caps are dynamic. Zero confirmed balances on pending-only definitions are excluded from confirmed conservation; pending projections and full bond/protocol/historical-transition replay remain separate.')


def private_postmaster(job):
    canonical_path(job);canonical_path(job/'cluster')
    file=canonical_path(job/'cluster'/'postmaster.pid');before=metadata(file)
    if not stat.S_ISREG(file.lstat().st_mode) or before['uid']!=os.geteuid() or before['mode']!=0o600 or before['nlink']!=1:raise ValueError('Unsafe private pidfile')
    values=file.read_text().splitlines()
    if metadata(file)!=before:raise ValueError('Private pidfile changed')
    pid=int(values[0])
    if pid<=0 or values[1]!=str(job/'cluster'):raise ValueError('Private pidfile identity differs')
    proc=Path('/proc')/str(pid)
    argv=(proc/'cmdline').read_bytes().split(b'\0')
    if os.readlink(proc/'exe')!=str(BIN/'postgres') or not any(argv[i:i+2]==[b'-D',str(job/'cluster').encode()] for i in range(len(argv)-1)):
        raise ValueError('PID is not this isolated postmaster')
    raw=(proc/'stat').read_bytes()
    return dict(pid=pid,startTicks=int(raw.split(b') ',1)[1].split()[19]),dataDirectory=str(job/'cluster'))


def stop_private(job,identity):
    """Only the newly captured private postmaster identity may be stopped."""
    if not (job/'cluster'/'postmaster.pid').exists():
        if (job/'socket'/'.s.PGSQL.55432').exists():raise ValueError('Socket remains without pidfile')
        return
    # Startup can fail after creating a postmaster but before main captured its
    # identity. Reconstruct only from a verified private argv/data-dir/exe.
    actual=private_postmaster(job)
    if identity is not None and actual!=identity:
        raise ValueError('Private postmaster identity changed; stop refused')
    command([str(BIN/'pg_ctl'),'-D',str(job/'cluster'),'-m','fast','-w','-t','60','stop'],timeout=70)


class RestoreInterrupted(RuntimeError):
    """Propagate audit-job termination through selector-backed child waits."""
    pass


def execute(plan,plan_sha):
    job=canonical_path(plan['job']);who=pwd.getpwnam('postgres')
    if not job.is_dir() or metadata(job)['uid']!=who.pw_uid or metadata(job)['mode']!=0o700 or list(job.iterdir()):raise ValueError('New job must be canonical postgres0700 and empty')
    check_runtime(plan);check_live(plan);check_window(plan)
    package=canonical_path(Path(__file__));package_meta=metadata(package);parent_meta=metadata(package.parent)
    if package_meta['uid']!=0 or parent_meta['uid']!=0 or parent_meta['mode']&0o7022:raise ValueError('Controller package authority changed')
    # ProtectSystem=strict keeps the root-owned package immutable; postgres has
    # no CAP_FOWNER to request O_NOATIME on this root-owned source.
    if hash_file(Path(__file__),no_atime=False)!=plan['controllerSha256']:raise ValueError('Controller source changed')
    b=plan['backup'];source=canonical_path(b['path'])
    if metadata(source)!=b['directory'] or not source.is_dir() or set(p.name for p in source.iterdir())!=set(MEMBERS):raise ValueError('Backup directory identity/inventory changed')
    complete=sorted(str(p) for p in BACKUPS.iterdir() if re.fullmatch(r'proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset',p.name) and p.is_dir() and not p.is_symlink())
    if not complete or complete[-1]!=str(source):raise ValueError('Frozen source is no longer latest complete set')
    if b['directory']['mode']!=0o700 or b['members']['globals.sql']['mode']!=0o600 or any(r['uid']!=who.pw_uid or r['gid']!=who.pw_gid for r in [b['directory'],*b['members'].values()]):raise ValueError('Backup owner/privacy changed')
    if metadata(LOCK)!=plan['backupLock'] or not stat.S_ISREG(LOCK.lstat().st_mode) or plan['backupLock']['uid']!=who.pw_uid:raise ValueError('Backup lock identity changed')
    lock=os.open(LOCK,os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(lock,fcntl.LOCK_SH|fcntl.LOCK_NB)
    watcher=None;pid=None;started=time.monotonic();phase='admission';passed=False
    durable(job/'intent.json',dict(schema='pow-audit30-isolated-restore-intent-v1',atUtc=utc(),planSha256=plan_sha,plan=plan,productionDatabaseMutation=False))
    def interrupted(*_):raise RestoreInterrupted('Managed restore interrupted')
    previous={s:signal.signal(s,interrupted) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
    try:
        storage_sample(job,preflight=True)
        watcher=Watchdog(job);watcher.start();runner=Runner(job,watcher,started)
        phase='backup-hashes'
        def heartbeat():
            watcher.assert_alive()
            if time.monotonic()>started+RUNTIME:raise TimeoutError('Whole-run hash deadline')
        for name in MEMBERS:hash_file(source/name,b['members'][name],2*1024**2 if name!='proof_indexer.dump' else None,heartbeat=heartbeat);watcher.assert_alive()
        raw=(source/'SHA256SUMS').read_text()
        expected=''.join(b['members'][n]['sha256']+'  '+n+'\n' for n in MEMBERS[:2])
        if raw!=expected:raise ValueError('Exact checksum manifest mismatch')
        phase='backup-catalog';toc=runner.run([str(BIN/'pg_restore'),'--list',str(source/'proof_indexer.dump')],phase,timeout=120)
        if hashlib.sha256(toc).hexdigest()!=plan['toc']['sha256'] or sum(bool(line) and not line.startswith(b';') for line in toc.splitlines())!=plan['toc']['entries']:raise ValueError('Backup catalog drift')
        phase='globals-grammar';roles_sql,roles,grants,excluded=role_globals((source/'globals.sql').read_bytes())
        durable(job/'source-verification.json',dict(atUtc=utc(),backupMemberHashes={n:b['members'][n]['sha256'] for n in MEMBERS},toc=plan['toc'],roles=len(roles),memberships=len(grants),excludedProductionTablespaces=excluded,passwordValuesPublished=False))
        (job/'socket').mkdir(mode=0o700)
        phase='initdb';runner.run([str(BIN/'initdb'),'-D',str(job/'cluster'),'--encoding=UTF8','--locale=en_US.UTF-8','--auth-local=trust','--auth-host=reject','--data-checksums'],phase,timeout=120)
        conf="listen_addresses = ''\nport = 55432\nunix_socket_directories = '"+str(job/ 'socket')+"'\nunix_socket_permissions = 0700\nshared_buffers = '128MB'\nwork_mem = '16MB'\nmaintenance_work_mem = '128MB'\nmax_connections = 10\nmax_worker_processes = 2\nmax_parallel_workers = 0\narchive_mode = off\nlogging_collector = off\ntimezone = 'UTC'\n"
        with (job/'cluster'/'postgresql.conf').open('a') as f:f.write(conf);f.flush();os.fsync(f.fileno())
        phase='private-start';runner.run([str(BIN/'pg_ctl'),'-D',str(job/'cluster'),'-l',str(job/'postgres.log'),'-w','-t','30','start'],phase,timeout=40)
        pid=private_postmaster(job)
        phase='private-identity';identity=query(runner,job,"SELECT jsonb_build_object('dataDirectory',current_setting('data_directory'),'socket',current_setting('unix_socket_directories'),'listenAddresses',current_setting('listen_addresses'),'port',current_setting('port'),'checksums',current_setting('data_checksums'));",phase,'postgres')
        if identity!=dict(dataDirectory=str(job/'cluster'),socket=str(job/'socket'),listenAddresses='',port='55432',checksums='on') or list((job/'cluster'/'pg_tblspc').iterdir()):raise ValueError('Private cluster isolation differs')
        durable(job/'private-start-identity.json',dict(atUtc=utc(),privatePostmasterIdentity=pid,settings=identity,actualUnit=check_runtime(plan)))
        phase='isolated-roles';runner.run([*psql(job,'postgres'),'-f','-'],phase,stdin=roles_sql,timeout=120)
        phase='roles-verification';actual=query(runner,job,ROLE_CATALOG_SQL,phase,'postgres')
        verify_role_catalog(actual,roles)
        membership=query(runner,job,"SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (SELECT role.rolname AS role,member.rolname AS member,grantor.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles role ON role.oid=m.roleid JOIN pg_roles member ON member.oid=m.member JOIN pg_roles grantor ON grantor.oid=m.grantor ORDER BY 1,2,3) r;",'membership-verification','postgres')
        selected=[r for r in membership if r['role'] in roles or r['member'] in roles]
        if sorted(selected,key=canonical)!=sorted(grants,key=canonical):raise ValueError('Isolated membership differs')
        durable(job/'role-verification.json',dict(atUtc=utc(),roleCount=len(roles),membershipCount=len(grants),roleAttributeAndPasswordEquality=True,rolesSha256=hashlib.sha256(canonical(roles)).hexdigest(),membershipsSha256=hashlib.sha256(canonical(grants)).hexdigest(),rawPasswordHashesPublished=False))
        phase='database-restore';runner.run([str(BIN/'pg_restore'),'-h',str(job/'socket'),'-p','55432','-U','postgres','--dbname=postgres','--create','--exit-on-error','--no-tablespaces',str(source/'proof_indexer.dump')],phase,timeout=3600)
        phase='source-owner-acl';source_security=security_statements(runner.run([str(BIN/'pg_restore'),'--schema-only','--create','--no-tablespaces','--file=-',str(source/'proof_indexer.dump')],phase,timeout=180,maximum=8*1024**2))
        phase='restored-owner-acl';restored_security=security_statements(runner.run([str(BIN/'pg_dump'),'-h',str(job/'socket'),'-p','55432','-U','postgres','--dbname=proof_indexer','--schema-only','--create','--no-tablespaces'],phase,timeout=180,maximum=8*1024**2))
        if source_security!=restored_security or not source_security:raise ValueError('Backup/restored owners ACL/defaultACL differ')
        durable(job/'owner-acl-parity.json',dict(atUtc=utc(),statements=len(source_security),sourceSha256=hashlib.sha256(canonical(source_security)).hexdigest(),restoredSha256=hashlib.sha256(canonical(restored_security)).hexdigest(),ownerAclDefaultAclEquality=True,qualification='Independent archive schema-only versus isolated pg_dump ownership/ACL/defaultACL statements; includes database ownership/ACL, excludes production tablespaces.'))
        phase='backup-row-stream';copy=BackupCopy();runner.run([str(BIN/'pg_restore'),'--data-only','--no-owner','--no-privileges','--no-tablespaces','--file=-',str(source/'proof_indexer.dump')],phase,sink=copy.line,timeout=1800);copy.complete()
        table_names=query(runner,job,"SELECT jsonb_agg(n.nspname||'.'||c.relname ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='proof_indexer' AND c.relkind='r';",'restored-table-inventory')
        if set(table_names)!=set(copy.tables):raise ValueError('Complete table-data inventory differs')
        parity={}
        for name,table in sorted(copy.tables.items()):
            phase='row-parity-'+name.split('.')[1];observed=RowHashes()
            quoted_name='.'.join('"'+p+'"' for p in name.split('.'))
            sql="SET datestyle='ISO, MDY'; SET timezone='UTC'; SET extra_float_digits=3; SET bytea_output='hex'; SET intervalstyle='postgres'; COPY "+quoted_name+' ('+', '.join('"'+c+'"' for c in table['columns'])+') TO STDOUT;'
            runner.run([*psql(job),'-c',sql],phase,sink=observed.add,timeout=900)
            expected=table['hashes'].receipt();got=observed.receipt()
            if got!=expected:raise ValueError('Backup/restored table row multiset differs')
            parity[name]=got
        for name,expected in copy.sequences.items():
            phase='sequence-parity';observed=query(runner,job,'SELECT row_to_json(r) FROM (SELECT last_value,is_called FROM '+name+') r;',phase)
            if observed!=expected:raise ValueError('Restored sequence differs')
        durable(job/'table-row-parity.json',dict(atUtc=utc(),model='copy-row-sha256-multiset-v1',tables=parity,sequences=copy.sequences,allMatched=True,qualification='Saved backup COPY bytes versus independently read restored COPY bytes; no current-chain or live-db tip comparison.'))
        phase='accounting-mail';summary=query(runner,job,"""SELECT jsonb_build_object(
          'database',current_database(),'databaseBytes',pg_database_size(current_database()),
          'invalidIndexes',(SELECT count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready),
          'unvalidatedConstraints',(SELECT count(*) FROM pg_constraint WHERE NOT convalidated),
          'productionTablespaces',(SELECT count(*) FROM pg_tablespace WHERE pg_tablespace_location(oid)<>''),
          'eventAccounting',(SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT protocol,kind,status,valid,count(*) AS rows,sum(amount_sats)::text AS amount_sats FROM proof_indexer.events GROUP BY 1,2,3,4 ORDER BY 1,2,3,4) r),
          'mailEvents',(SELECT count(*) FROM proof_indexer.events WHERE protocol='pwm1'),
          'mailRows',(SELECT count(*) FROM proof_indexer.mail_items),
          'orphanEventTransactions',(SELECT count(*) FROM proof_indexer.events e LEFT JOIN proof_indexer.transactions t USING(network,txid) WHERE t.txid IS NULL),
          'creditBalanceRows',(SELECT count(*) FROM proof_indexer.credit_balances),
          'creditAccounting',(SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT network,token_id,count(*) AS holders,sum(confirmed_balance)::text AS confirmed_balance,sum(pending_delta)::text AS pending_delta FROM proof_indexer.credit_balances GROUP BY 1,2 ORDER BY 1,2) r),
          'ledgerSnapshots',(SELECT count(*) FROM proof_indexer.ledger_snapshots),
          'transitions',(SELECT count(*) FROM proof_indexer.work_amo_block_transitions));""",phase)
        if summary['database']!='proof_indexer' or any(summary[n]!=0 for n in ['invalidIndexes','unvalidatedConstraints','productionTablespaces','orphanEventTransactions']):raise ValueError('Restored schema/relations fail')
        durable(job/'accounting-mail-observations.json',dict(atUtc=utc(),snapshotObservations=summary,qualification='Exact restored saved snapshot accounting/count observations and FK/index/constraint checks. Protocol replay and current mail-projection parity belong to separately approved items4/6.'))
        phase='snapshot-fence';fence=query(runner,job,"""SELECT jsonb_build_object(
          'canonicalBlock',(SELECT jsonb_build_object('height',height,'hash',block_hash) FROM proof_indexer.blocks WHERE network='livenet' AND canonical ORDER BY height DESC LIMIT 1),
          'confirmedTransactionMaxHeight',(SELECT max(block_height) FROM proof_indexer.transactions WHERE network='livenet' AND status='confirmed'),
          'transitionMaxHeight',(SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'),
          'transitionMaxHash',(SELECT block_hash FROM proof_indexer.work_amo_block_transitions WHERE network='livenet' ORDER BY block_height DESC LIMIT 1),
          'precisionMarkerStatus',(SELECT value->>'status' FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet'),
          'precisionActivationHeight',(SELECT value->>'activationHeight' FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet'));""",phase)
        if not fence['canonicalBlock'] or fence['canonicalBlock']['height']<960601 or fence['precisionMarkerStatus']!='complete' or fence['precisionActivationHeight']!='960601':raise ValueError('Saved snapshot is not the approved Q16 era')
        durable(job/'saved-snapshot-fence.json',dict(atUtc=utc(),snapshot=fence,currentLiveTipComparisonClaimed=False,qualification='Saved dump checkpoint only. Marker fields identify era; full marker-bound activation/historical transition verification is separate.'))
        phase='credit-invariants';credits=query(runner,job,"""WITH d AS (SELECT * FROM proof_indexer.credit_definitions WHERE network='livenet' AND confirmed),
          e AS (SELECT payload->>'tokenId' token_id,payload->>'amount' amount FROM proof_indexer.events WHERE network='livenet' AND status='confirmed' AND valid AND kind='token-mint'),
          b AS (SELECT token_id,sum(confirmed_balance)balance,min(confirmed_balance)minimum,count(*) FILTER(WHERE confirmed_balance<>trunc(confirmed_balance) OR pending_delta<>trunc(pending_delta))noninteger FROM proof_indexer.credit_balances WHERE network='livenet' GROUP BY token_id),
          m AS (SELECT token_id,sum(amount::numeric)minted FROM e WHERE amount~'^[0-9]+([.][0-9]+)?$' GROUP BY token_id)
          SELECT jsonb_build_object('rows',(SELECT jsonb_agg(jsonb_build_object('tokenId',d.token_id,'ticker',d.ticker,'balance',coalesce(b.balance,0)::text,'minimum',coalesce(b.minimum,0)::text,'noninteger',coalesce(b.noninteger,0),'mintedHuman',coalesce(m.minted,0)::text,'maxSupply',d.max_supply::text) ORDER BY d.token_id) FROM d LEFT JOIN b USING(token_id) LEFT JOIN m USING(token_id)),
          'sourceIntegrity',jsonb_build_object('malformedConfirmedMintAmounts',(SELECT count(*) FROM e WHERE amount IS NULL OR amount!~'^[0-9]+([.][0-9]+)?$'),
          'unjoinedConfirmedMintTokens',(SELECT count(*) FROM e LEFT JOIN d USING(token_id) WHERE d.token_id IS NULL),
          'unjoinedNonzeroConfirmedBalances',(SELECT count(*) FROM proof_indexer.credit_balances b LEFT JOIN d USING(token_id) WHERE b.network='livenet' AND b.confirmed_balance<>0 AND d.token_id IS NULL),
          'nonintegerOrNonfiniteBalanceRows',(SELECT count(*) FROM proof_indexer.credit_balances WHERE network='livenet' AND (confirmed_balance<>trunc(confirmed_balance) OR pending_delta<>trunc(pending_delta) OR confirmed_balance::text IN ('NaN','Infinity','-Infinity') OR pending_delta::text IN ('NaN','Infinity','-Infinity')))));""",phase)
        durable(job/'credit-source-integrity.json',dict(atUtc=utc(),sourceIntegrity=credits['sourceIntegrity'],qualification='All confirmed valid token-mint records and all nonzero confirmed balance rows must join confirmed definitions; malformed mint amounts cannot be silently filtered. Every livenet balance/pending-delta row is checked for integer/finite representation. Pending-only zero confirmed balances are outside confirmed supply conservation.'))
        durable(job/'exact-credit-invariants.json',dict(atUtc=utc(),checks=credit_invariants(credits['rows'],credits['sourceIntegrity']),savedSnapshotRows=credits['rows']))
        phase='amcheck';runner.run([str(BIN/'pg_amcheck'),'-h',str(job/'socket'),'-p','55432','-U','postgres','--database=proof_indexer','--install-missing','--heapallindexed','--parent-check','--jobs=1'],phase,timeout=1200)
        phase='private-stop';stop_private(job,pid);pid=None
        phase='offline-pages';pages=runner.run([str(BIN/'pg_checksums'),'--check','-D',str(job/'cluster')],phase,timeout=900)
        durable(job/'offline-page-check.json',dict(atUtc=utc(),returnCode=0,stdout=pages.decode(),qualification='New isolated checksummed restore pages only, not live production pages or WAL/PITR proof.'))
        phase='final-fences';watcher.assert_alive();final_storage=storage_sample(job);check_live(plan);check_runtime(plan)
        for n in MEMBERS:
            if metadata(source/n)!={k:b['members'][n][k] for k in metadata(source/n)}:raise ValueError('Backup final metadata drift')
        if (job/'cluster'/'postmaster.pid').exists() or (job/'socket'/'.s.PGSQL.55432').exists():raise ValueError('Private postmaster/socket remains')
        watcher.stop();watcher=None;passed=True
        durable(job/'completed.json',dict(schema='pow-audit30-isolated-logical-restore-completed-v1',atUtc=utc(),planSha256=plan_sha,status='passed',roleOwnerAclRestoration=True,allTableRowHashParity=True,amcheckPassed=True,offlinePrivatePageChecksPassed=True,privateClusterStopped=True,jobRetained=True,storage=final_storage,liveServicesUnchanged=True,productionDatabaseMutation=False,pitrCertified=False,livePhysicalPagesCertified=False))
    except BaseException as e:
        # Keep the first error and complete private-stop/watchdog/receipt work
        # even when ordinary termination signals are repeated during cleanup.
        for s in previous:signal.signal(s,signal.SIG_IGN)
        stopped=False
        try:stop_private(job,pid);stopped=True
        except BaseException:pass
        if watcher:
            try:watcher.stop()
            except BaseException:pass
        durable(job/'failed.json',dict(schema='pow-audit30-isolated-logical-restore-failed-v1',atUtc=utc(),planSha256=plan_sha,status='failed',phase=phase,errorClass=type(e).__name__,privateStopVerified=stopped,jobRetained=True,productionDatabaseMutation=False,automaticRetry=False))
        raise
    finally:
        for s,handler in previous.items():signal.signal(s,handler)
        os.close(lock)
    return passed


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['validate-plan','run']);p.add_argument('--plan',required=True);p.add_argument('--plan-sha256',required=True);a=p.parse_args()
    try:
        plan=read_plan(a.plan,a.plan_sha256,credential=a.mode=='run')
        if a.mode=='run':execute(plan,a.plan_sha256)
        print(json.dumps(dict(schema=SCHEMA,status='passed' if a.mode=='run' else 'valid-plan-structure-only',planSha256=a.plan_sha256,job=plan['job'],productionDatabaseMutation=False,pitrCertified=False),sort_keys=True))
    except BaseException as e:
        print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawErrorContentsSuppressed=True,productionDatabaseMutation=False),sort_keys=True),file=sys.stderr);return 1
    return 0


if __name__=='__main__':sys.exit(main())
