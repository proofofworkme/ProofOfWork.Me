#!/usr/bin/python3 -I -B
"""Local Action74/MD preview. Root supplies actual verified handoff; no repository write/network."""
import argparse
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

REPO=Path('/home/sixer/ProofOfWork.Me')
JSON_PATH=REPO/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'
MD_PATH=REPO/'audits/2026-10-02-audit30-followup-tracker.md'
JSON_SHA='4dc1fd489c257094a234ae1c47138404d67ec0d86a0b2ef8a270bf9435409833'
MD_SHA='234811de86241cc7126eb2c570e77d020d1daa65a67d5f2401c33928ed2063a5'
CANDIDATE='38ac6e2bff2ac16890724e5213346ef8a3ebd186'
BRANCH='codex/audit30-remaining-phase'
OLD_PROGRESS="Current status below is reconciled through Action73 at 2026-10-03T21:04:38.270Z."
OLD_ROW='| 6 | API availability and complete acceptance checks | Production API/worker and frontend deployed; strict, positive WORK/scoped bonds, all 619 mail records and frontend HTTPS/browser acceptance passed; release handoff in progress | Item 2 scoped release approved here; exact 16 repair separately approved and completed | Actions 72–73 bind the guarded 19:54 API/worker cutover, production strict/positive/scoped and raw/derived HTML mail passes, and 20:58 frontend publication from the same 38ac source. Actual HTTPS verifies 810/810 public files, 15 roots and apex; guest browser scoped histories and unchanged Caddy verified. All 818 protected inputs, old rollback roots, original Core/electrs/PostgreSQL identities and backup windows preserved. Release-specific documentation/source custody/hygiene/commit/push/announcement handoff remains |'


def require(ok,reason):
 if not ok:raise ValueError(reason)


def read(path,cap):
 p=Path(path);s=p.lstat()
 require(p.is_absolute()and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=cap,'Unsafe source')
 def stamp(v):return(v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_gid,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  require(stamp(os.fstat(f.fileno()))==stamp(s),'Source changed before read')
  b=f.read(cap+1)
  require(len(b)==s.st_size and stamp(os.fstat(f.fileno()))==stamp(s)==stamp(p.lstat()),'Source changed while read')
 return b


def git(*args):
 p=subprocess.run(['git','-C',str(REPO),*args],capture_output=True,text=True,timeout=10,check=True)
 return p.stdout.strip()


def build(receipt,receipt_binding,old_raw,md_raw):
 require(hashlib.sha256(old_raw).hexdigest()==JSON_SHA and hashlib.sha256(md_raw).hexdigest()==MD_SHA,'Actual73 preimage changed')
 old=json.loads(old_raw);require(len(old['actions'])==73 and old['actions'][-1]['runtimeAcceptanceComplete']is True,'Actual73 runtime differs')
 require(receipt['schema']=='pow-audit30-item2-release-handoff-observed-v1'and receipt['rootVerified']is True,'Root-verified actual receipt required')
 at=receipt['observedAtUtc'];dt=datetime.datetime.fromisoformat(at.replace('Z','+00:00'))
 require(dt.tzinfo is not None and dt.utcoffset()==datetime.timedelta(0)and dt>=datetime.datetime.fromisoformat('2026-10-03T21:04:38.270+00:00'),'Handoff timestamp precedes actual runtime')
 commit=receipt['primaryCommit'];require(re.fullmatch('[0-9a-f]{40}',commit),'Actual primary commit required')
 require(receipt['branch']==BRANCH and receipt['push']['remote']=='origin'and receipt['push']['branch']==BRANCH
         and receipt['push']['commit']==commit and receipt['push']['remoteRefVerified']is True,'Actual push readback required')
 announcement=receipt['announcement'];url=announcement['url']
 require(announcement['account']=='proofofworkme'and announcement['publishedAndVerified']is True
         and re.fullmatch(r'https://x\.com/proofofworkme/status/[0-9]{15,25}',url),'Actual verified release announcement required')
 require(all(receipt['hygiene'][k]is True for k in ('fixPassed','checkPassed','semanticReviewComplete'))
         and receipt['sourceCustodyComplete']is True and receipt['canonicalDocumentationReconciled']is True,'Actual release hygiene/custody/documentation required')
 require(git('rev-parse',commit+'^{commit}')==commit and git('rev-parse','HEAD')==commit,'Primary commit must be current actual HEAD')
 subprocess.run(['git','-C',str(REPO),'merge-base','--is-ancestor',CANDIDATE,commit],capture_output=True,timeout=10,check=True)
 message=git('show','-s','--format=%B',commit)
 require(re.search(r'^Documentation-Impact: (updated|reviewed-no-change)$',message,re.M)
         and re.search(r'^Repository-Hygiene: reviewed$',message,re.M),'Primary commit review trailers missing')
 for role in ('primaryCommit','push','announcement','hygiene','sourceCustody'):
  proof=receipt['evidence'][role];p=Path(proof['path'])
  require(p.parent==REPO/'deploy/audit30/verification'and p.name.startswith('pow-audit30-'),'Durable public proof required')
  b=read(p,4*1024**2);require(len(b)==proof['bytes']and hashlib.sha256(b).hexdigest()==proof['sha256'],'Actual proof binding differs: '+role)
 qualification='Scoped item2 API/mail/UI release, documentation, custody, primary commit/push and one verified announcement are complete. Human items3–5 and their later global item6 closure remain pending. This append records closure bookkeeping; its own commit hash is verified externally and is not embedded in itself. No second deployment or announcement is required.'
 action={'schema':'pow-audit30-action74-item2-release-handoff-v1','atUtc':at,'action':'Record actual scoped item2 release handoff after primary commit, push and announcement verification. Preserve all73 earlier action objects and the other remaining items.',
         'status':'scoped-item2-complete-global-gates-pending','historicalActionsPreserved':73,'runtimeAcceptanceActionOrdinal':73,
         'runtimeAcceptanceComplete':True,'overallApiAcceptance':True,'overallReleaseAcceptance':True,'globalAudit30ClosureComplete':False,
         'productionCallsPerformedByThisAppend':False,'productionDataMutation':False,'additionalDeletion':False,'newAnnouncementPerformedByThisAppend':False,
         'primaryCommit':commit,'branch':BRANCH,'announcementUrl':url,'handoffEvidence':copy.deepcopy(receipt),
         'actualHandoffReceipt':receipt_binding,'qualification':qualification,'nextRequired':'Human items3–5 and later global item6 closure remain pending.'}
 new=copy.deepcopy(old);new['actions'].append(action);c=new['currentContinuation'];c['atUtc']=at;c['observedThroughUtc']=at;c['statusQualification']=qualification
 for current in (c['currentApiEvidence'],c['userRemainingChecklist']['2']):
  current.update({'actionOrdinal':74,'status':'complete','acceptanceStatus':'scoped-item2-complete-global-gates-pending','overallApiAcceptance':True,
                  'overallReleaseAcceptance':True,'globalAudit30ClosureComplete':False,'currentAcceptanceQualification':qualification,
                  'overallApiAcceptanceQualification':qualification,'fullStrictStatus':'production-strict-v2-pass; node-cutover-complete; production-api-mail-ui-pass; scoped-release-handoff-complete',
                  'nextRequired':action['nextRequired'],'releaseHandoff':{'primaryCommit':commit,'announcementUrl':url,'observedAtUtc':at,'evidence':receipt_binding}})
  current['cutoverStatus']['qualification']=qualification
  current['cutoverStatus']['qualificationObservedThroughUtc']=at
 new['updatedAtUtc']=at
 require(new['actions'][:73]==old['actions'],'Historical action changed')
 for key in ('1','3','4','5','6'):require(c['userRemainingChecklist'][key]==old['currentContinuation']['userRemainingChecklist'][key],'Other item changed')
 for key in old:
  if key not in ('actions','currentContinuation','updatedAtUtc'):require(new[key]==old[key],'Original top-level field changed')
 text=md_raw.decode();require(text.count(OLD_PROGRESS)==1 and text.count(OLD_ROW)==1,'MD exact current row differs')
 text=text.replace(OLD_PROGRESS,'Current status below is reconciled through Action74 at '+at+'.',1)
 row='| 6 | API availability and complete acceptance checks | Complete within the approved item2 release scope; production API/mail/UI verified and primary release handoff complete | Item2 scoped release approved here; exact16 repair separately approved and completed | Actions72–74 retain the guarded38ac API/worker/frontend release, strict/positive/scoped checks, 619-mail and 810-file HTTPS acceptance and preserved authorities/recovery material. Actual primary commit '+commit+' was pushed and one release announcement verified. Migration, physical/PITR/capacity, custody/dependency and later global closure remain separate pending gates |'
 text=text.replace(OLD_ROW,row,1)
 text+='\n### Action74: scoped item2 release handoff complete ('+at+')\n\nThe approved API/mail/UI release and its documentation/source custody/hygiene handoff are complete. Actual primary commit `'+commit+'` on `'+BRANCH+'` was pushed and the remote ref verified. Required review trailers and successful hygiene checks are bound in the public handoff receipt. The single [verified release announcement]('+url+') was published by `@proofofworkme`. Actions72–73 retain the actual production acceptance; this bookkeeping performs no deployment, production-data change, deletion or second announcement.\n\nUser remaining-list item2/canonical item6 is complete within this scoped release. Item1 remains complete; user items3–5 and their later global item6 closure remain pending. All73 earlier action objects and historical paragraphs remain unchanged. The bookkeeping commit’s own hash and final push are verified externally by Root and need no self-referential follow-up action.\n'
 return (json.dumps(new,indent=2,sort_keys=True)+'\n').encode(),text.encode()


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--receipt',required=True);p.add_argument('--receipt-sha256',required=True);p.add_argument('--output-dir',required=True);a=p.parse_args()
 require(re.fullmatch('[0-9a-f]{64}',a.receipt_sha256),'Exact actual receipt hash required')
 raw=read(a.receipt,1024**2);require(hashlib.sha256(raw).hexdigest()==a.receipt_sha256,'Receipt hash differs')
 old=read(JSON_PATH,64*1024**2);md=read(MD_PATH,1024**2)
 outputs=build(json.loads(raw),{'path':a.receipt,'bytes':len(raw),'sha256':a.receipt_sha256},old,md)
 target=Path(a.output_dir);require(target.parent==Path('/tmp')and target.name.startswith('pow-audit30-action74-')and target.resolve()==target,'Creation-only /tmp preview directory required')
 require(read(JSON_PATH,64*1024**2)==old and read(MD_PATH,1024**2)==md,'Preimage changed before preview')
 target.mkdir(mode=0o700);result={}
 for name,b in zip(('remaining-phase-execution.evidence.json','followup-tracker.md'),outputs):
  path=target/name
  with path.open('xb')as f:f.write(b);f.flush();os.fsync(f.fileno())
  result[name]={'path':str(path),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
 print(json.dumps({'operation':'preview-only','repositoryMutationPerformed':False,'productionCalls':False,'historicalActionsPreserved':73,'item2Complete':True,'globalAudit30ClosureComplete':False,'outputs':result},sort_keys=True))

if __name__=='__main__':main()
