#!/usr/bin/python3 -I
"""LOCAL ONLY creation-only requests from exact reviewed sources and actual receipts."""
import argparse,base64,datetime as dt,hashlib,json,os,stat,sys,types
from pathlib import Path
CTRL=Path('/tmp/pow-audit30-transition-stream-controller-v7.py')
CTRL_SHA='e9801d372d05c94c40b609749e502ab1eb5e06f4f2561fa08d9c6a25c9313599'
GUARD=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py')
ADMISSION=Path('/tmp/pow-audit30-stream-prior-admission-v1.json')
ADMISSION_SHA='b8d2f8698133e4b8ab53dbf7271bcc7945387a56fbe2d0d8f0cdb9d607db1ed7'
INVENTORY=Path('/tmp/pow-audit30-cluster-inventory-native-v1.json')
INVENTORY_SHA='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'
BOOT_SCHEMA='pow-audit30-private-stream-bootstrap-v5'
JOB='/data/proofofwork-audit30-inspect-20261003T014100Z'
SOURCE='/data/proofofwork-audit30-restore-20261002T234651Z'
BASE='/usr/local/lib/proofofwork-audit30-transition-stream/'
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def pairs(rows):
 d={}
 for k,v in rows:
  if k in d:raise ValueError('Duplicate JSON field')
  d[k]=v
 return d
def bound(path,h,maximum=1024**2):
 p=Path(path);s=p.lstat();ident=lambda x:(x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_nlink,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
 if p.resolve(strict=True)!=p or not stat.S_ISREG(s.st_mode)or s.st_nlink!=1 or s.st_size>maximum:raise ValueError('Unsafe bounded local proof')
 raw=p.read_bytes()
 if ident(p.lstat())!=ident(s)or sha(raw)!=h:raise ValueError('Local input bytes/identity changed')
 return raw
def controller():
 raw=bound(CTRL,CTRL_SHA);S=types.ModuleType('stream');S.__file__=str(CTRL);exec(compile(raw,str(CTRL),'exec'),S.__dict__)
 # Local preparation executes exactly byte/hash-fenced inputs without changing
 # their original temporary-file permissions. Production retains its separate
 # immutable root750/member440 module gates; those gates are never relaxed.
 def utility(name):
  p=Path('/tmp')/name;r=bound(p,S.PINS[name]);m=types.ModuleType(name);m.__file__=str(p);exec(compile(r,str(p),'exec'),m.__dict__);return m
 S.I=utility('pow-audit30-saved-snapshot-inspect-v2.py');S.I.load_guard(GUARD);S.G=S.I.G;S.N=utility('pow-audit30-transition-stream-native-v2.py');S.N.C=utility('pow-audit30-transition-stream-codec-v2.py');return S
def request(mode,rid,inventory_sha=None):
 S=controller();S.calendar(rid);v=dict(schema=BOOT_SCHEMA,approvalSha256=S.APPROVAL,mode=mode,runId=rid,host='pow-bitcoin-01',sources={})
 if mode=='inventory':
  files={'controller.py':(CTRL,CTRL_SHA)}|{n:(GUARD if n=='restore-latest-logical.py'else Path('/tmp')/n,h)for n,h in S.PINS.items()}
  for n,(p,h)in files.items():raw=bound(p,h);v['sources'][n]=dict(base64=base64.b64encode(raw).decode(),sha256=h)
  review=bound(ADMISSION,ADMISSION_SHA);S.admission(json.loads(review,object_pairs_hook=pairs));v.update(sealedInventoryBase64=base64.b64encode(bound(INVENTORY,INVENTORY_SHA)).decode(),priorAdmissionBase64=base64.b64encode(review).decode(),priorAdmissionSha256=ADMISSION_SHA)
 elif mode=='prepare':
  if not isinstance(inventory_sha,str)or not S.SHA.fullmatch(inventory_sha):raise ValueError('Exact accepted inventory SHA required before prepare')
  v['inventorySha256']=inventory_sha
  for n,p,h in [('controller-v7.py',CTRL,CTRL_SHA),(S.PHASE4_ENGINE,Path('/tmp')/S.PHASE4_ENGINE,S.PHASE4_ENGINE_SHA),('phase4-readiness-admission-v2.json',Path('/tmp/pow-audit30-mail-readiness-admission-v2-template.json'),'a27b614620d29f9142957be064361a0d3b489e87ce4d866c2f0a07c907a59839')]:raw=bound(p,h);v['sources'][n]=dict(base64=base64.b64encode(raw).decode(),sha256=h)
 return v
def plan(rid,inventory_raw,inventory_sha,preflight,prepared,now=None):
 S=controller();S.calendar(rid);now=now or dt.datetime.now(dt.timezone.utc);inv=json.loads(inventory_raw,object_pairs_hook=pairs)
 expected={'schema','host','atUtc','backupLock','backupWindow','liveServices','node','capacity','productionMutation','seconds'}
 if set(preflight)!=expected or preflight['schema']!='pow-audit30-stream-final-preflight-v1'or preflight['host']!='pow-bitcoin-01'or preflight['productionMutation']is not False or preflight['atUtc']!=preflight['backupWindow']['preflightAtUtc']:raise ValueError('Exact fresh preflight scope')
 captured=dt.datetime.fromisoformat(preflight['atUtc']);deadline=dt.datetime.fromisoformat(preflight['backupWindow']['nextScheduledAtUtc'])
 if any(v.utcoffset()!=dt.timedelta(0)for v in [captured,deadline])or not 0<=(now-captured).total_seconds()<=900 or(deadline-now).total_seconds()<1800:raise ValueError('Fresh30-minute clear backup window')
 if set(preflight['capacity'])!={'/','/data'}or preflight['capacity']['/']['availableBytes']<10*1024**3 or preflight['capacity']['/data']['availableBytes']<100*1024**3:raise ValueError('Measured capacity reserve')
 keys={'mode','package','productionMutation','privatePlanSha256','dependencyInventorySha256','pgEntrySha256','node','readinessAdmissionSha256','dependencyEntries','dependencyRegularBytes','sourcePackage','sourcePackageUnchanged','controllerFileName','controllerSha256','reviewedInventorySha256'}
 if sha(inventory_raw)!=inventory_sha or set(prepared)!=keys or prepared['controllerFileName']!='controller-v7.py'or prepared['controllerSha256']!=CTRL_SHA or prepared['reviewedInventorySha256']!=inventory_sha or prepared['mode']!='prepare'or prepared['package']!=BASE+rid or prepared['sourcePackage']!='/usr/local/lib/proofofwork-audit30-snapshot-inspect/20261003T014100Z'or prepared['sourcePackageUnchanged']is not True or prepared['productionMutation']is not False or not 1<=prepared['dependencyEntries']<=10000 or not 0<prepared['dependencyRegularBytes']<=64*1024**2 or prepared['node']!=preflight['node']:raise ValueError('Exact prepared closure/node source differs')
 p=dict(schema=S.SCHEMA,approvalSha256=S.APPROVAL,controllerSha256=CTRL_SHA,host=preflight['host'],runId=rid,unit='proofofwork-audit30-transition-stream-'+rid+'.service',job=JOB,sealedSource=SOURCE,inventory=dict(fileName='stopped-clone-inventory.json',sha256=inventory_sha),backupLock=preflight['backupLock'],backupWindow=preflight['backupWindow'],liveServices=preflight['liveServices'],envelope=S.N.C.DEFAULT,priorAdmission=dict(kind='exact-before-mail-write-trigger-refusal',fileName='prior-clone-admission.json',sha256=ADMISSION_SHA),phase4={k:prepared[k]for k in ['privatePlanSha256','dependencyInventorySha256','pgEntrySha256','node','readinessAdmissionSha256']})
 # The local workstation's postgres account is not the VPS authority. Bind the
 # exact source-verified native108:112 tuple, then use it for local validation.
 if (inv.get('postgresUid'),inv.get('postgresGid'))!=(108,112):raise ValueError('Actual native PG inventory owner differs')
 S.pwd=types.SimpleNamespace(getpwnam=lambda _:types.SimpleNamespace(pw_uid=108,pw_gid=112))
 S.validate_plan(p);S.validate_inventory(inv,p);raw=encoded(p);r=request('run',rid);r.update(planBase64=base64.b64encode(raw).decode(),planSha256=sha(raw));return p,r
def write(p,raw):
 p=Path(p)
 if p.parent!=Path('/tmp')or p.resolve(strict=False)!=p:raise ValueError('Exclusive local /tmp output only')
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 fd=os.open(p.parent,os.O_DIRECTORY|os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)
 return dict(path=str(p),bytes=len(raw),sha256=sha(raw))
def main():
 a=argparse.ArgumentParser();a.add_argument('mode',choices=['inventory','prepare','run']);a.add_argument('--run-id',required=True);a.add_argument('--output-prefix',required=True)
 for n in ['inventory','preflight','prepared']:a.add_argument('--'+n);a.add_argument('--'+n+'-sha256')
 p=a.parse_args();bindings={}
 if p.mode=='run':
  for n in ['inventory','preflight','prepared']:
   if not getattr(p,n)or not getattr(p,n+'_sha256'):raise ValueError('All actual native inputs required')
   bindings[n]=bound(getattr(p,n),getattr(p,n+'_sha256'),64*1024**2 if n=='inventory'else 1024**2)
  v,r=plan(p.run_id,bindings['inventory'],p.inventory_sha256,json.loads(bindings['preflight'],object_pairs_hook=pairs),json.loads(bindings['prepared'],object_pairs_hook=pairs));out=[('.plan.json',v),('.request.json',r)]
 else:out=[('.request.json',request(p.mode,p.run_id,p.inventory_sha256))]
 rows=[write(p.output_prefix+s,encoded(v))for s,v in out];print(json.dumps(dict(status='assembled-for-root-review',files=rows,productionCalls=False,actualInputSha256={n:getattr(p,n+'_sha256')for n in bindings}),sort_keys=True))
if __name__=='__main__':main()
