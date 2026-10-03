#!/usr/bin/python3 -I -B
import ast,hashlib,json,os,pathlib,shlex,subprocess,time
def main():
 os.umask(0o077)
 p=pathlib.Path('/tmp/pow-audit30-mail-html-source-permission-probe-remote-v1.py');raw=p.read_bytes()
 pin='9accfe4166ef5adb215b7c8d9cf6e9d92231c46b6c68ec58ad6e55a132c0680e'
 assert len(raw)==3549 and hashlib.sha256(raw).hexdigest()==pin;ast.parse(raw)
 paths={k:pathlib.Path('/tmp/pow-audit30-mail-html-source-permission-probe-native-v1.'+k)for k in ('stdout','stderr','json')}
 assert all(not os.path.lexists(p)for p in paths.values())
 argv=['/usr/bin/ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87',shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-c',raw.decode()])]
 started=time.monotonic();unknown=False
 with paths['stdout'].open('xb')as out,paths['stderr'].open('xb')as err:
  try:r=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=75);code=r.returncode
  except subprocess.TimeoutExpired:code=124;unknown=True
  out.flush();os.fsync(out.fileno());err.flush();os.fsync(err.fileno())
 report={'schema':'pow-audit30-mail-html-source-permission-probe-transport-v1','exitCode':code,'sourceSHA256':pin,'elapsedSeconds':round(time.monotonic()-started,6),'unknownOutcome':unknown,'automaticRetry':False,'captures':{}}
 for k in ('stdout','stderr'):
  b=paths[k].read_bytes();report['captures'][k]={'path':str(paths[k]),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
 with paths['json'].open('x')as out:json.dump(report,out,sort_keys=True);out.write('\n');out.flush();os.fsync(out.fileno())
 print(json.dumps(report,sort_keys=True));return code
if __name__=='__main__':raise SystemExit(main())
