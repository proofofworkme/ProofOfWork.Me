"""Fixed passive Caddy continuity check for the approved UI release. No raw config export."""
import fcntl, hashlib, json, os, re, signal, stat, subprocess, sys, time
from pathlib import Path
import urllib.request

RELEASE = '38ac6e2bff2a-20261003T190512Z'
COMMIT = '38ac6e2bff2ac16890724e5213346ef8a3ebd186'
TREE = '8b9b5e3cd47aa8e4204da717350a629176e30da6'
PID = 3092586
INVOCATION = '201feac74de54f1da7b5e304adb1b621'
START_TICKS = 1100791133
START_MONOTONIC = '11007911342150'
CONFIG_BYTES = 42930
CONFIG_SHA = 'ddbc5fca433a01c09e479f420f4229a605c98656fda47d5d28018de402a5c7c2'
FILES = {
 '/etc/caddy/Caddyfile': (7469, '196817a4e50e3198d6c3e0e6c64a95721f637d9f1d0cff7d261bf1260553614f'),
 '/usr/lib/systemd/system/caddy.service': (1030, 'df2189b76e606ba16f620a348a4ecab446c6760234363566d473a2a51636ebe7'),
 '/etc/systemd/system/caddy.service.d/hardening.conf': (450, '63f9d063651509e14510e847b284d2065d164a182d9323c4bb87483cdcb3df43'),
}
UNIT_FIELDS = ('MainPID', 'InvocationID', 'NRestarts', 'LoadState', 'ActiveState', 'SubState',
 'Result', 'ExecMainStatus', 'ExecMainStartTimestampMonotonic', 'FragmentPath', 'DropInPaths')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}
MANIFEST = Path('/var/www/.proofofwork-ui-release')
LOCK = Path('/run/proofofwork-ui/deploy.lock')
DEADLINE = None

def need(value, code):
 if not value: raise ValueError(code)

def digest(data): return hashlib.sha256(data).hexdigest()

def stamp(s):
 return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
         s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def budget():
 need(DEADLINE is not None and time.monotonic() < DEADLINE, 'READ_BUDGET')
 return min(5, max(0.001, DEADLINE - time.monotonic()))

def read_public(path, maximum=65536):
 path = Path(path); before = path.lstat()
 need(path.resolve() == path and stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
      and before.st_nlink == 1 and not before.st_mode & 0o7022
      and 0 <= before.st_size <= maximum, 'PUBLIC_FILE_SHAPE')
 with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME), 'rb') as source:
  need(stamp(os.fstat(source.fileno())) == stamp(before), 'PUBLIC_FILE_DESCRIPTOR')
  raw = source.read(maximum + 1)
  need(stamp(os.fstat(source.fileno())) == stamp(before), 'PUBLIC_FILE_DESCRIPTOR_DRIFT')
 need(stamp(path.lstat()) == stamp(before) and len(raw) == before.st_size, 'PUBLIC_FILE_DRIFT')
 return raw, {'path': str(path), 'bytes': len(raw), 'sha256': digest(raw), 'identity': list(stamp(before))}

def unit_projection(raw):
 need(len(raw) <= 8192, 'UNIT_OUTPUT_BOUND')
 values = {}
 for line in raw.decode('utf-8').splitlines():
  need('=' in line, 'UNIT_OUTPUT_SHAPE')
  key, value = line.split('=', 1)
  need(key in UNIT_FIELDS and key not in values, 'UNIT_OUTPUT_FIELD')
  values[key] = value
 need(set(values) == set(UNIT_FIELDS), 'UNIT_OUTPUT_FIELD_SET')
 expected = {'MainPID': str(PID), 'InvocationID': INVOCATION, 'NRestarts': '0', 'LoadState': 'loaded',
  'ActiveState': 'active', 'SubState': 'running', 'Result': 'success', 'ExecMainStatus': '0',
  'ExecMainStartTimestampMonotonic': START_MONOTONIC, 'FragmentPath': '/usr/lib/systemd/system/caddy.service',
  'DropInPaths': '/etc/systemd/system/caddy.service.d/hardening.conf'}
 need(values == expected, 'CADDY_UNIT_BASELINE_DRIFT')
 return values

def unit():
 args = ['/usr/bin/systemctl', 'show', 'caddy.service']
 for name in UNIT_FIELDS: args += ['-p', name]
 result = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL, capture_output=True, timeout=budget())
 need(result.returncode == 0 and not result.stderr, 'CADDY_UNIT_READ')
 return unit_projection(result.stdout)

def proc_start(raw):
 need(len(raw) <= 8192, 'PROC_STAT_BOUND')
 text = raw.decode('ascii'); head, tail = text.rsplit(')', 1)
 need(head.startswith(str(PID) + ' (') and len(tail.split()) >= 20, 'PROC_STAT_SHAPE')
 ticks = int(tail.split()[19]); need(ticks == START_TICKS, 'CADDY_PROCESS_BASELINE_DRIFT')
 return ticks

def process():
 root = Path('/proc') / str(PID)
 with (root / 'stat').open('rb') as source: before = proc_start(source.read(8193))
 links = {name: os.readlink(root / name) for name in ('exe', 'cwd', 'root')}
 need(links == {'exe': '/usr/bin/caddy', 'cwd': '/', 'root': '/'}, 'CADDY_PROCESS_LINK_DRIFT')
 with (root / 'stat').open('rb') as source: after = proc_start(source.read(8193))
 need(before == after, 'CADDY_PROCESS_READ_DRIFT')
 return {'pid': PID, 'startTicks': after, **links}

def manifest_projection(raw, expected):
 need(re.fullmatch('[0-9a-f]{64}', expected) and digest(raw) == expected, 'ACTIVE_MANIFEST_DIGEST')
 values = {}
 for line in raw.decode('utf-8').splitlines():
  need('=' in line, 'ACTIVE_MANIFEST_SHAPE')
  key, value = line.split('=', 1); need(key and key not in values, 'ACTIVE_MANIFEST_DUPLICATE')
  values[key] = value
 need(values.get('release_id') == RELEASE and values.get('commit') == COMMIT
      and values.get('source_tree') == TREE and re.fullmatch('[0-9a-f]{64}', values.get('archive_sha256', '')),
      'ACTIVE_MANIFEST_RELEASE_BINDING')
 return {'releaseId': RELEASE, 'commit': COMMIT, 'tree': TREE,
         'archiveSha256': values['archive_sha256'], 'manifestSha256': expected}

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self, req, fp, code, msg, headers, newurl): raise ValueError('CADDY_CONFIG_REDIRECT')

def runtime_config():
 opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
 request = urllib.request.Request('http://127.0.0.1:2019/config/', method='GET',
                                 headers={'Accept-Encoding': 'identity'})
 with opener.open(request, timeout=budget()) as response:
  need(response.status == 200 and response.geturl() == request.full_url, 'CADDY_CONFIG_HTTP')
  need(response.headers.get('Content-Encoding', 'identity') == 'identity', 'CADDY_CONFIG_ENCODING')
  length = response.headers.get('Content-Length')
  need(length is None or length == str(CONFIG_BYTES), 'CADDY_CONFIG_DECLARED_LENGTH')
  raw = response.read(1024**2 + 1)
 need(len(raw) == CONFIG_BYTES and digest(raw) == CONFIG_SHA, 'CADDY_RUNTIME_CONFIG_BASELINE_DRIFT')
 return {'bytes': len(raw), 'sha256': digest(raw), 'httpStatus': 200}

def observe(expected):
 budget(); state = unit(); proc = process(); files = {}
 for name, (size, sha) in FILES.items():
  raw, meta = read_public(name)
  need(len(raw) == size and meta['sha256'] == sha, 'CADDY_FILE_BASELINE_DRIFT')
  files[name] = meta
 raw, manifest = read_public(MANIFEST)
 binding = manifest_projection(raw, expected)
 config = runtime_config(); budget()
 return {'unit': state, 'process': proc, 'files': files, 'runtimeConfig': config,
         'activeManifest': {'file': manifest, 'binding': binding}}

def expired(_signum, _frame): raise ValueError('READ_BUDGET')

def main():
 global DEADLINE
 need(os.getuid() == os.geteuid() == os.getgid() == os.getegid() == 0 and sys.flags.isolated,
      'ROOT_PASSIVE')
 need(len(sys.argv) == 2 and re.fullmatch('[0-9a-f]{64}', sys.argv[1]), 'EXPECTED_MANIFEST_ARGUMENT')
 DEADLINE = time.monotonic() + 45; signal.signal(signal.SIGALRM, expired); signal.alarm(45)
 before = LOCK.lstat()
 need(LOCK.resolve() == LOCK and stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
      and before.st_nlink == 1 and not before.st_mode & 0o7022, 'DEPLOY_LOCK_SHAPE')
 descriptor = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
 try:
  need(stamp(os.fstat(descriptor)) == stamp(before) == stamp(LOCK.lstat()), 'DEPLOY_LOCK_DESCRIPTOR')
  fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
  first = observe(sys.argv[1]); second = observe(sys.argv[1])
  need(first == second, 'CADDY_OR_MANIFEST_READ_DRIFT'); budget()
  print(json.dumps({'schema': 'pow-audit30-item2-ui-caddy-passive-read-v1', 'ok': True,
   'atUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'releaseId': RELEASE,
   'baselineCensusSha256': 'acb6922cc88854dd68308b45b1bbd51a0b18f52c10a8eec6d324e054659af979',
   'baselineCensusAtUtc': '2026-10-02T22:34:04.013122+00:00',
   'caddyUnchangedFromBaseline': True, 'beforeAfterEqual': True, 'observation': first,
   'rawConfigurationExported': False, 'rawManifestExported': False, 'serviceControl': False,
   'remoteWrites': False, 'automaticRetry': False}, sort_keys=True))
 finally: os.close(descriptor); signal.alarm(0)

if __name__ == '__main__':
 try: main()
 except Exception as error:
  message = str(error); code = message if re.fullmatch('[A-Z][A-Z0-9_]{0,100}', message) else 'CADDY_PASSIVE_READ_REFUSED'
  print(json.dumps({'schema': 'pow-audit30-item2-ui-caddy-passive-read-refusal-v1', 'ok': False,
   'code': code, 'errorClass': type(error).__name__, 'rawConfigurationExported': False,
   'remoteWrites': False, 'serviceControl': False, 'automaticRetry': False}, sort_keys=True), file=sys.stderr)
  raise SystemExit(1)
