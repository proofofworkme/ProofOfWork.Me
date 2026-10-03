#!/usr/bin/python3 -I -B
"""Read-only exact public cutover receipts, current identities and protections."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

RELEASE='38ac6e2bff2a-20261003T042000Z'
COMMIT='38ac6e2bff2ac16890724e5213346ef8a3ebd186'
ROOT=Path('/data/proofofwork-release-backups/audit30-node-release-'+RELEASE)
NATIVE=Path('/data/proofofwork-audit29-cutover-'+RELEASE+'-item2-v3')
ADMISSION=ROOT/'item2-cutover-admission-item2-v3'
FIVE={
 'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),
 'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),
 'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),
 'proofofwork-api.service':('3372731','546739c810df48d4956961b0931b6fc5'),
 'proofofwork-indexer-worker.service':('3372743','b2dc36ef816c4311b4c9aa0740d781a9'),
}

def need(value,code):
 if not value:raise ValueError(code)

def stamp(s):
 return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)

def stable_read(path,cap=4*1024**2,root_only=True):
 p=Path(path);s=p.lstat()
 need(p.is_absolute()and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)
      and s.st_nlink==1 and s.st_size<=cap and (not root_only or s.st_uid==s.st_gid==0),'PUBLIC_FILE_SHAPE')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  need(stamp(os.fstat(fd))==stamp(s),'PUBLIC_FILE_OPEN_DRIFT')
  blocks=[];size=0
  while block:=os.read(fd,65536):
   size+=len(block);need(size<=cap,'PUBLIC_FILE_GROWTH');blocks.append(block)
  raw=b''.join(blocks)
  need(len(raw)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'PUBLIC_FILE_READ_DRIFT')
 finally:os.close(fd)
 return raw,stamp(s)

def state(unit,keys):
 r=subprocess.run(['/usr/bin/systemctl','show',unit,*['--property='+key for key in keys]],
      env={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC'},capture_output=True,timeout=15)
 need(r.returncode==0 and not r.stderr and len(r.stdout)<=65536,'SYSTEMCTL_READ')
 return dict(line.split('=',1)for line in r.stdout.decode().splitlines()if '='in line)

def identities():
 keys=['LoadState','ActiveState','SubState','MainPID','InvocationID','Result']
 result={u:state(u,keys)for u in FIVE}
 for unit,(pid,inv)in FIVE.items():
  s=result[unit]
  need(s.get('LoadState')=='loaded'and s.get('ActiveState')=='active'and s.get('SubState')=='running'
       and s.get('MainPID')==pid and s.get('InvocationID')==inv,'POSTCUTOVER_FIVE_DRIFT')
 return result

def main():
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated,'ROOT_ISOLATED')
 before=identities();receipts={};stamps={}
 for key,path in {'final':NATIVE/'177-final.json','rootCompleted':ADMISSION/'completed.json'}.items():
  raw,old=stable_read(path);value=json.loads(raw);stamps[path]=old
  if key=='final':
   need(value.get('ok')is True and value.get('phase')=='complete'and value.get('commit')==COMMIT
        and value.get('authorityServicesModified')is False and value.get('recoveryRemoved')is False,'NATIVE_FINAL_NOT_COMPLETE')
  else:
   need(value.get('ok')is True and value.get('native',{}).get('receipts')==str(NATIVE)
        and value.get('native',{}).get('ok')is True and value.get('native',{}).get('phase')=='complete','ROOT_COMPLETION_PAIR')
  receipts[key]={'path':str(path),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode()}
 after=identities();need(before==after,'POSTCUTOVER_IDENTITY_CHANGED_DURING_READ')
 for path,old in stamps.items():need(stamp(path.lstat())==old,'PUBLIC_EVIDENCE_CHANGED_AFTER_READ')
 print(json.dumps({'schema':'pow-audit30-item2-node-v3-final-five-export-v1',
       'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':True,'receipts':receipts,
       'liveFive':after,'liveFiveUnchangedDuringRead':True,'authorityThreeOriginal':True,
       'apiWorkerNewAcknowledgedIdentities':True,'privateContentsExported':False,
       'productionMutationsPerformedByReader':False},sort_keys=True))

if __name__=='__main__':main()
