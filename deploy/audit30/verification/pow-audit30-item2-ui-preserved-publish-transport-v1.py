#!/usr/bin/python3 -I -B
"""One explicit, byte-pinned frontend publication dispatch; operator owns acceptance prerequisite."""
import argparse,ast,base64,hashlib,json,os
from pathlib import Path
import shlex,subprocess,time
OWNER=Path('/tmp/pow-audit30-item2-ui-preserved-publish-owner-v1.py')
OWNER_SHA='8f6c92d5e7b207ed935a9be52b4ac6cb42de03a446badc073b3daa3a89a1fc21'
PLAN=Path('/tmp/pow-audit30-item2-ui-plan-current-v2.json')
PLAN_SHA='ebb2f481c499f5e25d0787fd59c537b4ebff30c2c6afc93959361370eda07104'
RELEASE='38ac6e2bff2a-20261003T190512Z'
COMMIT='38ac6e2bff2ac16890724e5213346ef8a3ebd186'
TREE='8b9b5e3cd47aa8e4204da717350a629176e30da6'
ATTEMPT='item2-v1'

def identity(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,sha,maximum):
 assert p.resolve()==p and p.is_file()and not p.is_symlink()
 with p.open('rb')as f:
  before=os.fstat(f.fileno());raw=f.read(maximum+1);assert identity(before)==identity(os.fstat(f.fileno()))==identity(p.stat())
 assert len(raw)<=maximum and hashlib.sha256(raw).hexdigest()==sha;return raw

def bootstrap(code):
 packed=base64.b64encode(code).decode();unit='proofofwork-recovery-release-'+RELEASE+'-ui-'+ATTEMPT+'.service'
 remote_plan='/var/tmp/proofofwork-deploy/recovery-plan-'+RELEASE+'-'+ATTEMPT+'.json'
 return """import base64,hashlib,os,subprocess,sys
assert os.geteuid()==os.getegid()==0
code=base64.b64decode(%r,validate=True)
assert hashlib.sha256(code).hexdigest()==%r
unit=%r
fields=dict(line.split('=',1)for line in subprocess.check_output(['/usr/bin/systemctl','show',unit,'-p','LoadState','-p','ActiveState','-p','MainPID'],text=True,timeout=10).splitlines())
assert fields=={'LoadState':'not-found','ActiveState':'inactive','MainPID':'0'},'Publication namespace occupied; reconcile without retry'
argv=['/usr/bin/systemd-run','--unit='+unit,'--service-type=exec','--wait','--pipe','--property=User=root','--property=Group=root','--property=KillMode=control-group','--property=RuntimeMaxSec=30min','--property=TimeoutStopSec=30s','--property=MemoryMax=4G','--property=MemorySwapMax=0','--property=TasksMax=128','--property=UMask=0077','/usr/bin/python3','-I','-B','-c',code.decode(),%r,%r,%r,%r,%r]
raise SystemExit(subprocess.run(argv,stdin=subprocess.DEVNULL,timeout=1830).returncode)
"""%(packed,OWNER_SHA,unit,remote_plan,PLAN_SHA,COMMIT,TREE,ATTEMPT)

def run(stem):
 code=read(OWNER,OWNER_SHA,65536);ast.parse(code);plan=json.loads(read(PLAN,PLAN_SHA,65536))
 assert(plan['releaseId'],plan['commit'],plan['tree'],plan['publicationAttempt'])==(RELEASE,COMMIT,TREE,ATTEMPT)
 assert stem.is_absolute()and str(stem).startswith('/tmp/')and stem.resolve()==stem and stem.parent.is_dir()
 paths={suffix:Path(str(stem)+'.'+suffix)for suffix in('stdout','stderr','json')}
 assert all(not os.path.lexists(p)for p in paths.values())
 native=bootstrap(code);ssh=['ssh','-i','/home/sixer/.ssh/proofofwork_me_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','root@77.42.91.106',shlex.join(['/usr/bin/python3','-I','-B','-c',native])]
 start=time.monotonic();unknown=False
 with paths['stdout'].open('xb')as stdout,paths['stderr'].open('xb')as stderr:
  process=subprocess.Popen(ssh,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr)
  try:exit_code=process.wait(timeout=1860)
  except subprocess.TimeoutExpired:
   unknown=True;process.kill();exit_code=process.wait(timeout=15)
  stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
 report={'schema':'pow-audit30-item2-ui-preserved-publication-transport-v1','releaseId':RELEASE,'commit':COMMIT,'tree':TREE,'attempt':ATTEMPT,'planSha256':PLAN_SHA,'ownerSha256':OWNER_SHA,'exitCode':exit_code,'elapsedSeconds':round(time.monotonic()-start,6),'unknownOutcome':unknown,'automaticRetry':False}
 for suffix in('stdout','stderr'):
  raw=paths[suffix].read_bytes();report[suffix]={'path':str(paths[suffix]),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
 with paths['json'].open('x')as f:json.dump(report,f,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
 assert not unknown and exit_code==0,'Publication attempt refused/unknown; preserve receipts and reconcile without retry'
 return report

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('stem',type=Path);args=p.parse_args();os.umask(0o077);print(json.dumps(run(args.stem),sort_keys=True))
if __name__=='__main__':main()
