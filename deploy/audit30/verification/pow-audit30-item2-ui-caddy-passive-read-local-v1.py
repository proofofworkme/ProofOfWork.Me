"""Root-run, source-pinned SSH transport for the fixed passive Caddy reader; no retry."""
import hashlib, json, os, re, shlex, stat, subprocess, sys
from pathlib import Path

SOURCE = Path('/tmp/pow-audit30-item2-ui-caddy-passive-read-v1.py')
SOURCE_BYTES = 8875
SOURCE_SHA = 'f56e7050ba8f569ad7a00cd5698e3c8225e00a3f3fcecd1287d791dafe641729'
RELEASE = '38ac6e2bff2a-20261003T190512Z'
COMMIT = '38ac6e2bff2ac16890724e5213346ef8a3ebd186'
TREE = '8b9b5e3cd47aa8e4204da717350a629176e30da6'
STEM = '/tmp/pow-audit30-item2-ui-caddy-passive-native-v1'

def stamp(s):
 return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
         s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def read_stable(path, maximum):
 path = Path(path); before = path.lstat()
 assert path.is_absolute() and path.resolve() == path and stat.S_ISREG(before.st_mode)
 assert before.st_nlink == 1 and not before.st_mode & 0o7022 and before.st_size <= maximum
 with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
  assert stamp(os.fstat(source.fileno())) == stamp(before)
  raw = source.read(maximum + 1)
  assert stamp(os.fstat(source.fileno())) == stamp(before)
 assert stamp(path.lstat()) == stamp(before) and len(raw) == before.st_size
 return raw

def publication_binding(raw):
 rows = []
 for line in raw.decode('utf-8').splitlines():
  try: value = json.loads(line)
  except json.JSONDecodeError: continue
  if isinstance(value, dict): rows.append(value)
 receipts = [r for r in rows if r.get('releaseId') == RELEASE and 'exitCode' in r]
 proofs = [r for r in rows if r.get('ok') is True and r.get('allPriorRootsPreserved') is True]
 assert len(receipts) == len(proofs) == 1
 receipt, proof = receipts[0], proofs[0]
 assert receipt.get('commit') == COMMIT and receipt.get('tree') == TREE
 assert type(receipt.get('exitCode')) is int and receipt['exitCode'] == 0 and receipt.get('failure') is None
 assert re.fullmatch('[0-9a-f]{64}', proof.get('archiveSha256', ''))
 assert re.fullmatch('[0-9a-f]{64}', proof.get('manifestSha256', ''))
 return proof['manifestSha256']

def main():
 assert len(sys.argv) == 2
 os.umask(0o077)
 raw = read_stable(SOURCE, SOURCE_BYTES)
 assert len(raw) == SOURCE_BYTES and hashlib.sha256(raw).hexdigest() == SOURCE_SHA
 compile(raw, str(SOURCE), 'exec')
 publish_path = Path(sys.argv[1]); published = read_stable(publish_path, 8 * 1024**2)
 expected = publication_binding(published)
 paths = {n: Path(STEM + '.' + n) for n in ('stdout', 'stderr', 'json')}
 assert not any(os.path.lexists(p) for p in paths.values())
 args = ['/usr/bin/ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
         '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
         'root@77.42.91.106', shlex.join(['/usr/bin/python3', '-I', '-B', '-c', raw.decode(), expected])]
 with paths['stdout'].open('xb') as out, paths['stderr'].open('xb') as err:
  try:
   run = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=out, stderr=err, timeout=75)
   code, timeout = run.returncode, False
  except subprocess.TimeoutExpired: code, timeout = 124, True
  finally: out.flush(); err.flush(); os.fsync(out.fileno()); os.fsync(err.fileno())
 captures = {}
 for name in ('stdout', 'stderr'):
  content = paths[name].read_bytes()
  assert len(content) <= 65536
  captures[name] = {'path': str(paths[name]), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
 result = {'schema': 'pow-audit30-item2-ui-caddy-passive-transport-v1', 'exitCode': code,
           'sourceSha256': SOURCE_SHA, 'expectedManifestSha256': expected,
           'publicationOutput': {'path': str(publish_path), 'bytes': len(published),
                                 'sha256': hashlib.sha256(published).hexdigest()},
           'transportTimeout': timeout, 'completionUnknown': timeout, 'automaticRetry': False,
           'remoteWrites': False, 'serviceControl': False, 'captures': captures}
 with paths['json'].open('x') as output:
  json.dump(result, output, sort_keys=True); output.write('\n'); output.flush(); os.fsync(output.fileno())
 descriptor = os.open(paths['json'].parent, os.O_RDONLY | os.O_DIRECTORY)
 try: os.fsync(descriptor)
 finally: os.close(descriptor)
 print(json.dumps(result, sort_keys=True)); raise SystemExit(code)

if __name__ == '__main__': main()
