#!/usr/bin/python3 -I
"""Fixed bounded namespace diagnostic; no SQL, PG start, copies or writes."""
import argparse,hashlib,json,os,stat,sys,types
from pathlib import Path
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-transition-stream/20261003T023500Z')
CONTROLLER_SHA='a0af38ed8fabffdd4369524881adc808e6a94b7d203574118d770f42ed029b65'
SOURCE_SHA='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'
REVIEW_SHA='b8d2f8698133e4b8ab53dbf7271bcc7945387a56fbe2d0d8f0cdb9d607db1ed7'
JOB=Path('/data/proofofwork-audit30-inspect-20261003T014100Z')
SOURCE=Path('/data/proofofwork-audit30-restore-20261002T234651Z')
def identity(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def main():
 a=argparse.ArgumentParser();a.add_argument('--unit',required=True);p=a.parse_args();stage='load-frozen-controller';rows=[];live=None;S=None
 try:
  src=PACKAGE/'controller.py';s=src.lstat();assert src.resolve(strict=True)==src and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,112,0o440,1)and s.st_size<1024**2
  raw=src.read_bytes();assert identity(src.lstat())==identity(s)and hashlib.sha256(raw).hexdigest()==CONTROLLER_SHA;S=types.ModuleType('stream-diagnostic');S.__file__=str(src);exec(compile(raw,str(src),'exec'),S.__dict__);S.load();rows.append(dict(stage=stage,passed=True))
  stage='exact-readonly-namespace';S.inventory_runtime(JOB,SOURCE,p.unit,'pow-bitcoin-01');rows.append(dict(stage=stage,passed=True));live={n:S.G.system_properties(n,['ActiveState','MainPID','InvocationID'])for n in S.G.SERVICES}
  for path,label in [(JOB,'new-clone-capacity'),(SOURCE,'sealed-source-capacity')]:stage=label;S.I.inventory_capacity(path);rows.append(dict(stage=stage,passed=True))
  stage='sealed-inventory-authority';si,_=S.I.read_json(PACKAGE/'sealed-logical-inventory.json',SOURCE_SHA,root_authority=True);S.I.validate_inventory(si);rows.append(dict(stage=stage,passed=True))
  stage='explicit-prior-admission-authority';review,_=S.I.read_json(PACKAGE/'prior-clone-admission.json',REVIEW_SHA,root_authority=True);S.admission(review);rows.append(dict(stage=stage,passed=True))
  stage='exact-prior-proof-and-isolation-config';S.outcome_files(JOB,review,si);rows.append(dict(stage=stage,passed=True))
  stage='new-clone-stopped-control-and-process-census';S.I.source_stopped(JOB,'proofofwork-audit30-snapshot-inspect-20261003T014100Z.service');rows.append(dict(stage=stage,passed=True))
  stage='sealed-source-metadata-only-fence';S.I.verify_source(si,rehash=False);rows.append(dict(stage=stage,passed=True))
  result=dict(status='diagnostic-prehash-gates-passed',firstFailedStage=None,steps=rows,productionMutation=False,sqlExecuted=False,privateDataContentsExported=False,fullInventoryHashRerun=False)
 except BaseException as e:result=dict(status='diagnostic-refusal',firstFailedStage=stage,errorClass=type(e).__name__,errorMessageSha256=hashlib.sha256(str(e).encode()).hexdigest(),steps=rows,productionMutation=False,sqlExecuted=False,privateDataContentsExported=False,fullInventoryHashRerun=False)
 if live is not None:
  result['liveServicesUnchanged']=all(S.G.system_properties(n,['ActiveState','MainPID','InvocationID'])==v for n,v in live.items())
 print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
