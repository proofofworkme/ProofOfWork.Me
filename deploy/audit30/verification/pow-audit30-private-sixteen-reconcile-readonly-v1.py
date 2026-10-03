#!/usr/bin/python3 -I
"""Fixed074500 saved-receipt reconciliation. No SQL, start, writer or receipt writes."""
import hashlib,json,os,re,signal,stat,sys,types
from pathlib import Path
PACKAGE=Path('/usr/local/lib/proofofwork-audit30-private-sixteen/20261003T074500Z')
SOURCE_SHA='b1f10c63ac7e0de179215993529708e082073b0fd25bd6d36a4a7200870d4544'
PLAN_SHA='8ef5137f6716e1e48288d220e0f6f9220c0265283033e8afdf1d3ce2944d2231'
FAILED_SHA='ceb1ba4a373c1b46f5bae86e773e0d9b49e96d334b07001ce5227ecfde643666'
INTENT_SHA='40a3ac3e885cd5092cc67f693baa60a2be3ffec01bc5a653d04d917882060151'
OLD="digest=G.hash_file(path,m,65536);r,_=I.read_json(path,digest,limit=65536)"
NEW="digest=G.hash_file(path,None,65536);need(G.metadata(path)==m,'Commit intent discovery metadata changed');G.hash_file(path,m|{'sha256':digest},65536);r,_=I.read_json(path,digest,limit=65536);need(G.metadata(path)==m,'Commit intent second read metadata changed')"
class ReconciliationInterrupted(RuntimeError):pass
def need(v,m):
 if not v:raise ValueError(m)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def load_original():
 path=PACKAGE/'controller.py';s=path.lstat()
 need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,112,0o440,1)and s.st_size<=65536,'Original immutable controller custody')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(stamp(os.fstat(f.fileno()))==stamp(s),'Controller FD identity');raw=f.read(65537);need(stamp(os.fstat(f.fileno()))==stamp(s),'Controller FD drift')
 need(stamp(path.lstat())==stamp(s)and sha(raw)==SOURCE_SHA and raw.count(OLD.encode())==1,'Original bytes and sole corrected call required')
 P=types.ModuleType('readonly_original_verifier');P.__file__=str(path)
 # Execute definitions from the exact original source with only its documented
 # unknown-digest call corrected. main/runtime/execute/adapter are never called.
 exec(compile(raw.replace(OLD.encode(),NEW.encode()),str(path),'exec'),P.__dict__)
 P.load();return P
def unknown_json(P,path):
 m=P.G.metadata(path);need(stat.S_ISREG(path.lstat().st_mode)and m['uid']==108 and m['gid']==112 and m['mode']==0o600 and m['nlink']==1 and m['bytes']<=65536,'Fixed public receipt custody')
 h=P.G.hash_file(path,None,65536);need(P.G.metadata(path)==m,'Discovery metadata drift');P.G.hash_file(path,m|{'sha256':h},65536)
 v,n=P.I.read_json(path,h,limit=65536);need(n==m and P.G.metadata(path)==m,'Pinned receipt reread drift');return v,dict(path=str(path),metadata=m,sha256=h)
def fingerprint(P,v,maximum):
 need(isinstance(v,dict)and set(v)=={'count','logical_bytes','sha256'}and type(v['count'])is int and 0<=v['count']<=maximum and isinstance(v['logical_bytes'],str)and re.fullmatch('0|[1-9][0-9]*',v['logical_bytes'])and int(v['logical_bytes'])<=256*1024**2 and isinstance(v['sha256'],str)and P.S.SHA.fullmatch(v['sha256']),'Exact journal fingerprint')
def journals(P,receipts):
 keys={'schema','environment','operation','manifestSHA256','transactionId','targetCount','beforeMail','afterMail','beforeJournal','afterJournal','operationalShard','operationalEpochBefore','operationalEpochAfter','automaticRetry'}
 for operation in ('apply','inverse'):
  r=receipts[operation+'-completed.json'];j=receipts[operation+'-commit-intent.json']
  need(set(j)==keys and all(j.get(k)==r.get(k)and type(j.get(k))is type(r.get(k))for k in('operation','environment','manifestSHA256','transactionId','targetCount','operationalShard','operationalEpochBefore','operationalEpochAfter','automaticRetry')),'Journal binds exact acknowledged transaction')
  need(type(r.get('wholeMilliseconds'))is int and 0<=r['wholeMilliseconds']<=45000,'Original45s transaction bound')
  for name in('beforeJournal','afterJournal'):
   v=j[name];need(isinstance(v,dict)and set(v)=={'meta','queue','shards'},'Exact journal tables')
   for table,maximum in [('meta',50000),('queue',1),('shards',256)]:fingerprint(P,v[table],maximum)
   need(v['queue']['count']==0 and 64<=v['shards']['count']<=256,'Acknowledged flush has empty queue and all shards')
  a,b=j['beforeJournal'],j['afterJournal']
  need(a['meta']==b['meta']and a['queue']==b['queue']and a['shards']['count']==b['shards']['count']and a['shards']['sha256']!=b['shards']['sha256'],'Only legitimate recorded journal invalidation')
 a,b=receipts['apply-commit-intent.json'],receipts['inverse-commit-intent.json']
 need(a['afterJournal']==b['beforeJournal'],'Separate commits journal continuity')
 need(a['beforeJournal']['meta']==b['afterJournal']['meta']and a['beforeJournal']['queue']==b['afterJournal']['queue'],'Global metadata and empty queue preserved')
 return dict(metaUnchanged=True,queueEmptyAndUnchanged=True,journalBetweenCommitsExact=True,twoRecordedAcknowledgedInvalidations=True,epochRewind=False)
def prior_failure(P,p):
 d,m=P.I.read_json(P.WORK/'supervisor-failed.json',FAILED_SHA,limit=65536)
 need(d.get('schema')=='pow-audit30-private-sixteen-supervision-failed-v1'and d.get('status')=='failed'and d.get('phase')=='acknowledged-apply-and-separate-inverse'and d.get('errorClass')=='KeyError'and d.get('privateStopVerified')is True and d.get('cleanupErrors')==[]and d.get('productionMutation')is False and d.get('automaticRetry')is False,'Original failed receipt required')
 i,n=P.I.read_json(P.WORK/'supervisor-intent.json',INTENT_SHA,limit=65536)
 need(i.get('plan')==p and i.get('planSha256')==PLAN_SHA and sha(encoded(p))==PLAN_SHA and i.get('sealedSourceFullHashVerifiedBeforeStart')is True and i.get('productionMutation')is False and i.get('sealedSourceStartAllowed')is False,'Exact original intent lineage')
 need(not os.path.lexists(P.WORK/'supervisor-completed.json'),'Original attempt must remain failed')
 return dict(failed=dict(path=str(P.WORK/'supervisor-failed.json'),metadata=m,sha256=FAILED_SHA),intent=dict(path=str(P.WORK/'supervisor-intent.json'),metadata=n,sha256=INTENT_SHA))
def reconcile(P):
 P.completed_lineage();p,m=P.I.read_json(PACKAGE/'reviewed-plan.json',PLAN_SHA,limit=65536)
 need(m['uid']==0 and m['gid']==0 and m['mode']==0o600 and p['controllerSha256']==SOURCE_SHA,'Fixed original plan authority');P.validate(p)
 original,_,_=P.C.package(P.COMPLETION_PLAN);P.package(p,original);P.math_proof(p);prior=prior_failure(P,p);P.G.check_live(p)
 names=['proof-completed.json','apply-completed.json','inverse-completed.json','apply-commit-intent.json','inverse-commit-intent.json']
 receipts={};bindings={}
 for name in names:receipts[name],bindings[name]=unknown_json(P,P.WORK/name)
 v=receipts['proof-completed.json'];P.proof_result(v,p,PACKAGE);j=journals(P,receipts)
 need(bindings['proof-completed.json']['sha256']==sha(encoded(v)),'Canonical adapter proof bytes')
 for name in names:
  r,b=unknown_json(P,P.WORK/name);need(b==bindings[name]and r==receipts[name],'Original proof set drift')
 need(prior_failure(P,p)==prior,'Original failed lineage drift');P.package(p,original);P.math_proof(p);P.G.check_live(p)
 return dict(schema='pow-audit30-private-sixteen-saved-receipts-reconciled-v1',status='passed',originalPlanSha256=PLAN_SHA,originalControllerSha256=SOURCE_SHA,originalAttemptRemainsFailed=True,prior=prior,receiptBindings=bindings,adapterProof=v,journalChecks=j,targetCount=16,orderedTargetTxids=receipts['apply-completed.json']['orderedTargetTxids'],nullAndExactBodyRestorationValidatedByPinnedWriterAcknowledgement=True,crossTransactionFullMailFingerprintRestored=True,fullMailBefore=receipts['apply-commit-intent.json']['beforeMail'],fullMailAfter=receipts['inverse-commit-intent.json']['afterMail'],readOnlyReceiptReconciliation=True,source7FullHashVerifiedHere=False,offlinePrivatePagesCheckedHere=False,currentDatabaseFenceVerifiedHere=False,continuousReaderExclusion=False,liveServicesUnchanged=True,productionMutation=False,writerInvoked=False,sqlInvoked=False,privateClusterStarted=False,automaticRetry=False)
def main():
 need(sys.flags.isolated and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01','Fixed isolated root node reconciliation')
 old={s:signal.signal(s,lambda *_:(_ for _ in()).throw(ReconciliationInterrupted('Read-only reconciliation interrupted')))for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM)};signal.alarm(90)
 try:result=reconcile(load_original());raw=encoded(result);need(len(raw)<=65536,'Public reconciliation output bound');sys.stdout.buffer.write(raw+b'\n')
 finally:
  signal.alarm(0)
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawDetailsSuppressed=True,writerInvoked=False,sqlInvoked=False,productionMutation=False,automaticRetry=False),sort_keys=True),file=sys.stderr);sys.exit(1)
