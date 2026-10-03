#!/usr/bin/python3 -I
"""LOCAL ONLY: assemble exact inspector plan/request from measured proof files."""
import argparse,base64,datetime as dt,hashlib,json,os,re,sys,types
from pathlib import Path
CONTROLLER=Path('/tmp/pow-audit30-saved-snapshot-inspect.py');GUARD=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py')
CONTROLLER_SHA='04a3fae258c177afed591a3d9b3deef3695c23bbcc61e65b5d3cd798831caf54'
INVENTORY=Path('/tmp/pow-audit30-cluster-inventory-native-v1.json');INVENTORY_SHA='f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572'
RUN='20261003T005512Z';SOURCE='/data/proofofwork-audit30-restore-20261002T234651Z'
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:
  if k in d:raise ValueError('Duplicate JSON field')
  d[k]=v
 return d
def bound(path,sha,maximum=1024**2):
 p=Path(path)
 if p.resolve(strict=True)!=p or p.is_symlink():raise ValueError('Noncanonical proof')
 identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
 before=identity(p.stat());raw=p.read_bytes()
 if len(raw)>maximum or hashlib.sha256(raw).hexdigest()!=sha or identity(p.stat())!=before:raise ValueError('Proof bytes/identity differ')
 return json.loads(raw,object_pairs_hook=pairs)
def inspector():
 raw=CONTROLLER.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=CONTROLLER_SHA:raise ValueError('Frozen controller changed')
 I=types.ModuleType('inspector');I.__file__=str(CONTROLLER);exec(compile(raw,str(CONTROLLER),'exec'),I.__dict__);I.load_guard(GUARD);return I
def assemble(inv,pf,prepared,now=None):
 I=inspector();now=now or dt.datetime.now(dt.timezone.utc);I.validate_inventory(inv)
 expected={'schema','host','atUtc','backupLock','backupWindow','liveServices','node','capacity','productionMutation','seconds'}
 if set(pf)!=expected or pf['schema']!='pow-audit30-inspector-final-preflight-v1' or pf['productionMutation'] is not False or pf['host']!='pow-bitcoin-01' or pf['atUtc']!=pf['backupWindow']['preflightAtUtc']:raise ValueError('Preflight schema/host/scope')
 captured=dt.datetime.fromisoformat(pf['atUtc']);deadline=dt.datetime.fromisoformat(pf['backupWindow']['nextScheduledAtUtc'])
 if any(x.utcoffset()!=dt.timedelta(0) for x in (captured,deadline)) or not 0<=(now-captured).total_seconds()<=900 or (deadline-now).total_seconds()<75*60:raise ValueError('Fresh preflight/clear window')
 if set(pf['capacity'])!={'/','/data'} or pf['capacity']['/']['availableBytes']<10*1024**3 or pf['capacity']['/data']['availableBytes']<180*1024**3:raise ValueError('Measured capacity reserve')
 if set(prepared)!={'mode','package','productionMutation','privatePlanSha256','dependencyInventorySha256','pgEntrySha256','dependencyEntries','dependencyRegularBytes'} or prepared['mode']!='prepare' or prepared['package']!='/usr/local/lib/proofofwork-audit30-snapshot-inspect/'+RUN or prepared['productionMutation'] is not False or not 1<=prepared['dependencyEntries']<=10000 or not 0<prepared['dependencyRegularBytes']<=64*1024**2:raise ValueError('Prepared destination identity/scope')
 if inv['sourceJob']!=SOURCE:raise ValueError('Actual source mismatch')
 tip=min(inv['snapshot']['canonicalBlock']['height'],inv['snapshot']['transitionMaxHeight'])
 plan=dict(schema=I.SCHEMA,approvalSha256=I.APPROVAL_SHA,controllerSha256=CONTROLLER_SHA,guardSha256=I.GUARD_SHA,host=pf['host'],runId=RUN,unit='proofofwork-audit30-snapshot-inspect-'+RUN+'.service',job='/data/proofofwork-audit30-inspect-'+RUN,source=SOURCE,inventory=dict(fileName='cluster-inventory.json',sha256=INVENTORY_SHA),backupLock=pf['backupLock'],backupWindow=pf['backupWindow'],liveServices=pf['liveServices'],idPage=dict(afterHeight=tip-2,throughHeight=tip,limit=2,precisionActivationHeight=960601),phase4={k:prepared[k] for k in ('privatePlanSha256','dependencyInventorySha256','pgEntrySha256')}|{'node':pf['node']})
 I.validate_plan(plan);raw=encoded(plan);sha=hashlib.sha256(raw).hexdigest()
 request=dict(schema='pow-audit30-snapshot-inspect-bootstrap-v1',approvalSha256=I.APPROVAL_SHA,mode='run',runId=RUN,host=pf['host'],sources={},planBase64=base64.b64encode(raw).decode(),planSha256=sha)
 return plan,request

def main():
 p=argparse.ArgumentParser();p.add_argument('--preflight',required=True);p.add_argument('--preflight-sha256',required=True);p.add_argument('--prepared',required=True);p.add_argument('--prepared-sha256',required=True);p.add_argument('--output-prefix',required=True);a=p.parse_args()
 inv=bound(INVENTORY,INVENTORY_SHA);pf=bound(a.preflight,a.preflight_sha256);prepared=bound(a.prepared,a.prepared_sha256)
 plan,request=assemble(inv,pf,prepared);prefix=Path(a.output_prefix)
 if prefix.parent.resolve(strict=True)!=prefix.parent or not str(prefix).startswith('/tmp/'):raise ValueError('Local /tmp output only')
 rows=[]
 for suffix,value in [('.plan.json',plan),('.request.json',request)]:
  path=Path(str(prefix)+suffix);raw=encoded(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  rows.append(dict(path=str(path),bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest()))
 print(json.dumps(dict(status='assembled-for-root-independent-review',files=rows,productionCalls=False,sourceInventorySha256=INVENTORY_SHA,preflightSha256=a.preflight_sha256,preparedSha256=a.prepared_sha256),sort_keys=True))
if __name__=='__main__':main()
