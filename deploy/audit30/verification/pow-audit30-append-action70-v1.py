#!/usr/bin/python3 -I -B
"""Local-only exact-preimage Action 70 preview/apply. No production calls."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat

REPO=Path('/home/sixer/ProofOfWork.Me')
TRACKER=REPO/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'

def require(value,message):
 if not value:raise ValueError(message)

def stable_read(path,cap):
 p=Path(path);before=p.lstat()
 require(p.is_absolute()and p.resolve(strict=True)==p and stat.S_ISREG(before.st_mode)
         and before.st_nlink==1 and before.st_size<=cap,'Unsafe local source')
 def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 with p.open('rb')as f:
  require(stamp(os.fstat(f.fileno()))==stamp(before),'Source changed before read')
  raw=f.read(cap+1)
  require(len(raw)==before.st_size and stamp(os.fstat(f.fileno()))==stamp(before)==stamp(p.lstat()),'Source changed while read')
 return raw

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--draft',required=True)
 parser.add_argument('--draft-sha256',required=True)
 parser.add_argument('--output',help='Creation-only canonical /tmp preview path')
 parser.add_argument('--apply',action='store_true',help='Root-reviewed local tracker update; no remote action')
 parser.add_argument('--root-reviewed',action='store_true',help='Root completed review of this exact draft SHA')
 args=parser.parse_args()
 require(bool(args.output)!=args.apply,'Choose exactly one preview output or explicit apply')
 require(re.fullmatch('[0-9a-f]{64}',args.draft_sha256),'Exact reviewed draft SHA required')
 draft_raw=stable_read(args.draft,1024**2)
 require(hashlib.sha256(draft_raw).hexdigest()==args.draft_sha256,'Draft hash differs')
 q=json.loads(draft_raw)
 require(q['schema']=='pow-audit30-action70-proposed-update-v1'and q['status']=='draft-not-applied'
         and q['proposedActionOrdinal']==70 and q['trackerMutationPerformed']is False,'Draft schema differs')
 require(q['trackerPreimage']['path']==str(TRACKER.relative_to(REPO))and q['trackerPreimage']['actionCount']==69,'Tracker identity differs')
 old_raw=stable_read(TRACKER,64*1024**2)
 require(len(old_raw)==q['trackerPreimage']['bytes']and hashlib.sha256(old_raw).hexdigest()==q['trackerPreimage']['sha256'],'Tracker preimage changed; reconcile without overwriting')
 old=json.loads(old_raw)
 require(len(old['actions'])==69,'Action count differs')
 new=copy.deepcopy(old);new['actions'].append(copy.deepcopy(q['proposedAction']))
 new['currentContinuation']=copy.deepcopy(q['proposedCurrentContinuation'])
 new['updatedAtUtc']=new['currentContinuation']['atUtc']
 require(new['actions'][:69]==old['actions'],'Historical action object changed')
 require(new['currentContinuation']['userRemainingChecklist']['1']==old['currentContinuation']['userRemainingChecklist']['1']
         and new['currentContinuation']['userRemainingChecklist']['1']['status']=='complete','Completed item1 changed')
 for key in ('3','4','5','6'):
  require(new['currentContinuation']['userRemainingChecklist'][key]==old['currentContinuation']['userRemainingChecklist'][key],'Other remaining item changed')
 for key in old:
  if key not in ('actions','currentContinuation','updatedAtUtc'):require(new[key]==old[key],'Existing tracker field changed: '+key)
 action=new['actions'][-1]
 require(action['fullStrictAcceptance']is False and action['codeCutoverPerformed']is False
         and action['uiPublicationPerformed']is False and action['productionDataMutation']is False,'Failure/preparation qualification changed')
 require(action['laterNarrowWorkDiagnostic']['currentPredicatePassed']is True
         and action['laterNarrowWorkDiagnostic']['fullStrictAcceptance']is False,'Narrow diagnostic qualification changed')
 raw=(json.dumps(new,indent=2,sort_keys=True)+'\n').encode()
 if args.apply:
  require(q.get('rootReconciliationStatus')=='machine-reconciled-awaiting-root-review'and args.root_reviewed,'Exact public extraction and Root review must finish before apply')
  for binding in action.get('publicSourceCustodyAdded',[]):
   path=REPO/binding['repositoryPath']
   require(path.is_relative_to(REPO/'deploy/audit30/verification'),'Custody path outside reviewed verification directory')
   custody=stable_read(path,4*1024**2)
   require(len(custody)==binding['bytes']and hashlib.sha256(custody).hexdigest()==binding['sha256'],'Durable public custody binding differs: '+path.name)
  temporary=TRACKER.with_name(TRACKER.name+'.action70.tmp')
  with temporary.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
  require(stable_read(TRACKER,64*1024**2)==old_raw,'Tracker changed before replace')
  os.replace(temporary,TRACKER)
  directory=os.open(TRACKER.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(directory)
  finally:os.close(directory)
  target=TRACKER;operation='applied'
 else:
  target=Path(args.output)
  require(target.is_absolute()and target.resolve()==target and str(target).startswith('/tmp/'),'Preview must be canonical /tmp path')
  with target.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
  operation='previewed'
 print(json.dumps({'operation':operation,'path':str(target),'bytes':len(raw),
       'sha256':hashlib.sha256(raw).hexdigest(),'originalActionsPreserved':69,'item1StillComplete':True,
       'productionCalls':False},sort_keys=True))

if __name__=='__main__':main()
