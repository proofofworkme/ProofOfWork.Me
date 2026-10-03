#!/usr/bin/python3 -I
"""LOCAL transport only. Explicit root GO remains separate from this artifact.

Each invocation hash-pins the reviewed remote source and separately typed stdin,
preserves exclusive bounded captures, and never retries a native operation.
Transport failure does not prove that a remote owned unit stopped.
"""
import argparse, datetime as dt, hashlib, json, os, re, selectors, shlex, signal, stat, subprocess, sys, time
from pathlib import Path

TOOLS = {
 'treasury': {'source': '/tmp/pow-audit30-treasury-native-v8.py',
              'sha256': 'c95fbcbfcae2c1d66db620b531cedc46425d58968b81f20852a4143936307475',
              'request': '/tmp/pow-audit30-treasury-native-run-request-v2.json',
              'requestSha256': '53c04e48bb9d7c7aa3adc108ddc875ea724644ab94e33d9a6af7c73732b086d3',
              'deadline': 1650, 'sourceLimit': 65536, 'requestLimit': 262144},
 'mail-api': {'source': '/tmp/pow-audit30-postcutover-mail-html-native-v3.py',
              'sha256': 'b0c4ca5c0cb94bef317b13ea57857a5edbac2b08095969a56489ca2c0209a844',
              'deadline': 980, 'sourceLimit': 65536, 'requestLimit': 262144}}
SSH = ['/usr/bin/ssh', '-i', '/home/sixer/.ssh/proofofwork_node_ed25519',
       '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
       '-o', 'ConnectTimeout=15', 'powadmin@65.108.122.87']
STDOUT_MAX = 1024**2
STDERR_MAX = 1024**2
class TransportInterrupted(RuntimeError): pass

def need(value, code):
 if not value: raise ValueError(code)

def sha(raw): return hashlib.sha256(raw).hexdigest()

def ident(s):
 return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)

def bound(path, expected, maximum):
 path = Path(path); s = path.lstat()
 need(path.parent == Path('/tmp') and path.resolve(strict=True) == path and stat.S_ISREG(s.st_mode)
      and s.st_nlink == 1 and s.st_size <= maximum and re.fullmatch('[0-9a-f]{64}', expected), 'Bounded exact local input')
 fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
 with os.fdopen(fd, 'rb') as f:
  need(ident(os.fstat(f.fileno())) == ident(s), 'Local input FD drift')
  raw = f.read(maximum + 1)
  need(ident(os.fstat(f.fileno())) == ident(s), 'Local input read drift')
 need(ident(path.lstat()) == ident(s) and len(raw) <= maximum and sha(raw) == expected, 'Local input path/hash drift')
 return raw

def remote_command(source, request_sha=None):
 text = 'sudo -n /usr/bin/python3 -I -B -c ' + shlex.quote(source.decode())
 if request_sha is not None:
  need(re.fullmatch('[0-9a-f]{64}', request_sha), 'Safe request SHA argv')
  text += ' ' + request_sha
 return SSH + [text]

def fsync_parent(path):
 fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
 try: os.fsync(fd)
 finally: os.close(fd)

def output(path):
 fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
 os.fchmod(fd, 0o600)
 return os.fdopen(fd, 'wb')

def execute(argv, request, prefix, seconds, popen=subprocess.Popen, stdout_cap=STDOUT_MAX, stderr_cap=STDERR_MAX, bindings=None):
 prefix = Path(prefix)
 need(prefix.parent == Path('/tmp') and prefix.resolve(strict=False) == prefix
      and re.fullmatch('pow-audit30-[a-z0-9-]+', prefix.name), 'Fixed exclusive local capture prefix')
 paths = {n: Path(str(prefix) + '.' + n) for n in ('stdout', 'stderr', 'json')}
 need(all(not os.path.lexists(p) for p in paths.values()), 'Local duplicate/capture collision before SSH')
 outs = {}; process = None; sel = selectors.DefaultSelector()
 counts = {'stdout': 0, 'stderr': 0}; delivered = 0; failure = None; code = None
 start = dt.datetime.now(dt.timezone.utc); deadline = time.monotonic() + seconds
 old = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
 def interrupted(*_): raise TransportInterrupted('Local transport signal; remote state requires reconciliation')
 for s in old: signal.signal(s, interrupted)
 try:
  try:
   for name in ('stdout', 'stderr'): outs[name] = output(paths[name])
   fsync_parent(prefix.parent)
   process = popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
   for stream, name in ((process.stdout, 'stdout'), (process.stderr, 'stderr')):
    os.set_blocking(stream.fileno(), False); sel.register(stream, selectors.EVENT_READ, name)
   os.set_blocking(process.stdin.fileno(), False); sel.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
   while sel.get_map():
    need(time.monotonic() < deadline, 'Outer transport deadline')
    for key, _ in sel.select(min(.2, max(.001, deadline-time.monotonic()))):
     if key.data == 'stdin':
      if delivered == len(request): sel.unregister(key.fileobj); key.fileobj.close(); continue
      delivered += os.write(key.fd, request[delivered:delivered+65536])
      continue
     raw = os.read(key.fd, 65536)
     if not raw: sel.unregister(key.fileobj); continue
     cap = stdout_cap if key.data == 'stdout' else stderr_cap
     # Preserve every byte up to the exact local cap; count overshoot separately.
     remaining = max(0, cap - counts[key.data])
     outs[key.data].write(raw[:remaining]); counts[key.data] += len(raw)
     need(counts[key.data] <= cap, 'Outer transport stream cap')
   code = process.wait(timeout=min(10, max(.001, deadline-time.monotonic())))
   need(delivered == len(request), 'Incomplete typed stdin delivery')
  except BaseException as error:
   for sig in old: signal.signal(sig, signal.SIG_IGN)
   failure = {'errorClass': type(error).__name__, 'reasonSha256': sha(str(error).encode())}
   if process is not None:
    if process.poll() is None:
     try: os.killpg(process.pid, signal.SIGKILL)
     except ProcessLookupError: pass
    code = process.wait(timeout=10)
  finally:
   for s in old: signal.signal(s, signal.SIG_IGN)
   sel.close()
   if process is not None:
    for stream in (process.stdin, process.stdout, process.stderr):
     if not stream.closed: stream.close()
   for f in outs.values(): f.flush(); os.fsync(f.fileno()); f.close()
   fsync_parent(prefix.parent)
  finish = dt.datetime.now(dt.timezone.utc)
  result = {'schema': 'pow-audit30-readonly-owned-transport-result-v1', 'startedAtUtc': start.isoformat(),
            'finishedAtUtc': finish.isoformat(), 'seconds': (finish-start).total_seconds(), 'outerDeadlineSeconds': seconds,
            'exitCode': code, 'failure': failure, 'typedStdinBytesDelivered': delivered, 'receivedBytes': counts,
            'automaticRetry': False, 'remoteUnitStoppedCertifiedByTransport': False,
            'productionDataMutationRequested': False, 'captures': {}}
  if bindings is not None: result['inputBindings'] = bindings
  for name in ('stdout', 'stderr'):
   if paths[name].exists():
    raw = paths[name].read_bytes()
    result['captures'][name] = {'path': str(paths[name]), 'bytes': len(raw), 'sha256': sha(raw)}
  with output(paths['json']) as f:
   raw = (json.dumps(result, sort_keys=True, indent=2)+'\n').encode(); f.write(raw); f.flush(); os.fsync(f.fileno())
  fsync_parent(prefix.parent)
  return result
 finally:
  for sig, handler in old.items(): signal.signal(sig, handler)

def main():
 need(sys.flags.isolated, 'Isolated local transport')
 p = argparse.ArgumentParser(); p.add_argument('tool', choices=TOOLS); p.add_argument('--request'); p.add_argument('--request-sha256'); p.add_argument('--output-prefix', required=True)
 args = p.parse_args(); tool = TOOLS[args.tool]
 source = bound(tool['source'], tool['sha256'], tool['sourceLimit'])
 path = tool.get('request', args.request); h = tool.get('requestSha256', args.request_sha256)
 need(path is not None and h is not None and (args.tool != 'treasury' or args.request is args.request_sha256 is None), 'Exact reviewed typed request')
 raw = bound(path, h, tool['requestLimit'])
 if args.tool == 'mail-api':
  import types
  m = types.ModuleType('reviewed_api_native'); m.__file__ = tool['source']; exec(compile(source, m.__file__, 'exec'), m.__dict__)
  m.request(m.parse(raw))
 result = execute(remote_command(source, h if args.tool == 'mail-api' else None), raw, args.output_prefix, tool['deadline'],
                  bindings={'sourceSha256': tool['sha256'], 'requestSha256': h, 'requestBytes': len(raw)})
 print(json.dumps(result, sort_keys=True)); return 0 if result['exitCode'] == 0 and result['failure'] is None else 1

if __name__ == '__main__': raise SystemExit(main())
