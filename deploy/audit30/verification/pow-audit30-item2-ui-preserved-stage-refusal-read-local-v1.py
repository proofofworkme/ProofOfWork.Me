#!/usr/bin/python3 -I -B
"""One fixed read-only UI-host dispatch; no retry or remote mutation."""
import ast,hashlib,json,os,pathlib,shlex,subprocess,time
SOURCE=pathlib.Path('/tmp/pow-audit30-item2-ui-preserved-stage-refusal-read-v1.py')
PIN='ac4171e3b4e87cb60f6a2d985a8725616c9261c33a753b45d0aaea274b12f5c1'
def main():
 os.umask(0o077);raw=SOURCE.read_bytes();assert len(raw)==43913 and hashlib.sha256(raw).hexdigest()==PIN;ast.parse(raw)
 paths={n:pathlib.Path('/tmp/pow-audit30-item2-ui-preserved-stage-refusal-read-native-v1.'+n)for n in('stdout','stderr','json')};assert all(not os.path.lexists(p)for p in paths.values())
 ssh=['/usr/bin/ssh','-i','/home/sixer/.ssh/proofofwork_me_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','root@77.42.91.106',shlex.join(['/usr/bin/python3','-I','-B','-c',raw.decode()])]
 started=time.monotonic();unknown=False
 with paths['stdout'].open('xb')as out,paths['stderr'].open('xb')as err:
  try:result=subprocess.run(ssh,stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=420);exit_code=result.returncode
  except subprocess.TimeoutExpired:unknown=True;exit_code=124
  out.flush();os.fsync(out.fileno());err.flush();os.fsync(err.fileno())
 report={'schema':'pow-audit30-item2-ui-preserved-stage-refusal-read-transport-v1','exitCode':exit_code,'sourceSHA256':PIN,'elapsedSeconds':round(time.monotonic()-started,6),'automaticRetry':False,'unknownOutcome':unknown,'remoteMutations':False,'captures':{}}
 for name in('stdout','stderr'):
  data=paths[name].read_bytes();report['captures'][name]={'path':str(paths[name]),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'within524288ByteCap':len(data)<=524288}
 with paths['json'].open('x')as out:json.dump(report,out,sort_keys=True);out.write('\n');out.flush();os.fsync(out.fileno())
 print(json.dumps(report,sort_keys=True));return exit_code
if __name__=='__main__':raise SystemExit(main())
