#!/usr/bin/env python3
"""Install only the approved UI release publisher under the deployment lock.

Records old/new bytes and hashes in a creation-only recovery receipt. Does not
restart applications, change timers/holds, or touch release/protocol records.
"""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
SSH=['ssh','-i','/home/sixer/.ssh/proofofwork_me_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','root@77.42.91.106']
NAMES=('proofofwork-ui-release-publish',)

def main():
    commit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
    files={name:(ROOT/'deploy'/(name+'.sh')).read_bytes() for name in NAMES}
    for name,raw in files.items():
        path='deploy/'+name+'.sh'
        assert raw==subprocess.check_output(['git','-C',str(ROOT),'show',commit+':'+path])
    previous=subprocess.check_output(['git','-C',str(ROOT),'show','5905da2ac47814d2b7c47d004b3598c2f312e98e:deploy/proofofwork-ui-release-publish.sh'])
    frame={'expectedPreviousSha256':hashlib.sha256(previous).hexdigest(),'commit':commit,'files':{name:{'base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest()} for name,raw in files.items()}}
    code='import base64,json,os,stat,hashlib,fcntl,subprocess\nfrom pathlib import Path\nframe=json.loads('+repr(json.dumps(frame))+')\n'+r'''
assert os.geteuid()==0
os.umask(0o077)
lock=Path('/run/proofofwork-ui/deploy.lock');before=lock.lstat()
assert stat.S_ISREG(before.st_mode) and lock.resolve()==lock and before.st_uid==0 and before.st_nlink==1
fd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert os.fstat(fd)==lock.stat()
receipt=Path('/var/backups/proofofwork-ui/recovery-evidence')/('publisher-admission-'+frame['commit'][:12])
assert not receipt.exists(),'Prior installation requires reconciliation'
old={}
for name in frame['files']:
 p=Path('/usr/local/sbin')/name;s=p.lstat()
 assert p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o7022
 raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()==frame['expectedPreviousSha256'],'Installed publisher differs from reviewed predecessor';old[name]={'base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest(),'mode':stat.S_IMODE(s.st_mode)}
subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity','check','--path',str(receipt.parent),'--additional-bytes','1048576','--additional-inodes','16','--phase','publisher-admission-install'],check=True,stdout=subprocess.DEVNULL)
receipt.mkdir(mode=0o700)
def save(name,value):
 with (receipt/name).open('x') as out:json.dump(value,out);out.flush();os.fsync(out.fileno())
def sync(path):
 d=os.open(path,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d)
save('intent.json',{'sourceCommit':frame['commit'],'previous':old,'candidate':frame['files']});sync(receipt);sync(receipt.parent)
for name,value in frame['files'].items():
 p=Path('/usr/local/sbin')/name
 assert hashlib.sha256(p.read_bytes()).hexdigest()==old[name]['sha256']
 raw=base64.b64decode(value['base64']);assert hashlib.sha256(raw).hexdigest()==value['sha256']
 temporary=p.with_name('.'+name+'.'+frame['commit'][:12])
 with temporary.open('xb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
 temporary.chmod(0o755);os.replace(temporary,p);sync(p.parent)
 assert hashlib.sha256(p.read_bytes()).hexdigest()==value['sha256']
result={'ok':True,'sourceCommit':frame['commit'],'installed':{n:v['sha256'] for n,v in frame['files'].items()},'receipt':str(receipt)}
save('completed.json',result);print(json.dumps(result));os.close(fd)
'''
    result=subprocess.run([*SSH,'python3 -I -B -'],input=code.encode(),capture_output=True)
    sys.stdout.buffer.write(result.stdout);sys.stderr.buffer.write(result.stderr)
    raise SystemExit(result.returncode)

if __name__=='__main__':main()
