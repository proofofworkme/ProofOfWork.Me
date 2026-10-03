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
PROTECTIONS={
 '/etc/proofofwork-postgres-logical-backup.pins':'22f66cac8419985c544d4b41c6ea9cd400fc99805c588694a9a619a3f120d09b',
 '/usr/local/sbin/proofofwork-retention-protection':'795f1308b74ddc69a022ce7e1413fb4698a82e6cfb14265931d1951ee603c908',
}
SOURCE_PINS={
 '/opt/proofofwork-api/server/proof-api.mjs':'9ab92c0fe3cb358fcaacccd62915eabc4c9ee75e42d29c6c989259b1305436f4',
 '/opt/proofofwork-api/server/db/proof-index-reader.mjs':'9278b81473c23a2c9d06c6b1306268c360539f833cdd7967b73fd99a35275b87',
 '/opt/proofofwork-api/scripts/run-proof-indexer-worker.mjs':'83175cbbb7bfff7062ffe2d8ba1cb8ee390968930234ff0c7bceca79595c5758',
 '/opt/proofofwork-api/scripts/backfill-proof-indexer.mjs':'fab9f9540d2e59cb76fba915ed7ac8ef962df6a38c3b2a5d24773cd4e4b08c15',
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
 before=identities();receipts={};values={};stamps={}
 paths={'final':NATIVE/'177-final.json','timersRestored':NATIVE/'176-timers-restored.json',
        'before':NATIVE/'046-before.json','rootCompleted':ADMISSION/'completed.json',
        'ready':NATIVE/'147-ready.json'}
 for key,path in paths.items():
  raw,s=stable_read(path);values[key]=json.loads(raw);stamps[path]=s
  receipts[key]={'path':str(path),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
                 'base64':base64.b64encode(raw).decode()}
 final=values['final'];completed=values['rootCompleted']
 need(final.get('ok')is True and final.get('phase')=='complete'and final.get('commit')==COMMIT
      and final.get('authorityServicesModified')is False and final.get('recoveryRemoved')is False,'NATIVE_FINAL_NOT_COMPLETE')
 need(completed.get('schema')=='pow-audit30-item2-node-cutover-completed-v1'and completed.get('ok')is True
      and completed.get('native',{}).get('ok')is True and completed.get('native',{}).get('phase')=='complete'
      and completed['native'].get('receipts')==str(NATIVE)
      and completed.get('candidate',{}).get('commit')==COMMIT and completed.get('protectionsUnchanged')is True,'ROOT_COMPLETION_PAIR')
 recorded_before=values['before']['timers'];recorded_after=values['timersRestored']['timers']
 need(set(recorded_before)==set(recorded_after),'TIMER_RESTORATION_SET')
 current_timers={}
 for unit,old in recorded_before.items():
  after=recorded_after[unit];current=state(unit,['LoadState','ActiveState','SubState','UnitFileState'])
  need(all(after.get(k)==old.get(k)==current.get(k)for k in ('ActiveState','UnitFileState')),'TIMER_RESTORATION_DRIFT')
  current_timers[unit]=current
 protections={}
 for path,pin in PROTECTIONS.items():
  raw,s=stable_read(path,65536);need(hashlib.sha256(raw).hexdigest()==pin,'BACKUP_PROTECTION_SHA')
  protections[path]={'bytes':len(raw),'sha256':pin,'stamp':s};stamps[Path(path)]=s
 sources={}
 for path,pin in SOURCE_PINS.items():
  raw,s=stable_read(path,4*1024**2,False);need(hashlib.sha256(raw).hexdigest()==pin,'POSTCUTOVER_SOURCE_SHA')
  sources[path]={'bytes':len(raw),'sha256':pin,'stamp':s};stamps[Path(path)]=s
 after=identities();need(before==after,'POSTCUTOVER_IDENTITY_CHANGED_DURING_READ')
 for path,s in stamps.items():need(stamp(path.lstat())==s,'PUBLIC_EVIDENCE_CHANGED_AFTER_READ')
 unit='proofofwork-audit29-release-'+RELEASE+'-node-item2-v3.service'
 controller=state(unit,['LoadState','ActiveState','SubState','MainPID','InvocationID','Result'])
 need(controller.get('ActiveState')=='inactive'and controller.get('MainPID')=='0'
      and controller.get('Result')=='success','COMPLETED_CONTROLLER_NOT_QUIET')
 print(json.dumps({'schema':'pow-audit30-item2-node-v3-exact-public-export-v1',
       'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':True,'receipts':receipts,
       'liveFive':after,'liveFiveUnchangedDuringRead':True,'authorityThreeOriginal':True,
       'apiWorkerNewAcknowledgedIdentities':True,'timersRestored':True,'currentTimers':current_timers,
       'protections':protections,'sourcePins':sources,'controller':controller,
       'privateContentsExported':False,'productionMutationsPerformedByReader':False},sort_keys=True))

if __name__=='__main__':main()
