import os,json,hashlib,stat,datetime,collections,resource
from pathlib import Path
resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(30,30))
p=Path('/data/proofofwork-release-backups/audit30-treasury-address-20261003T031100Z/corpus.json');s=p.lstat();assert p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size==17672203
f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
try:
 raw=b''
 while True:
  b=os.read(f,1048576)
  if not b:break
  raw+=b;assert len(raw)<=17672203
 assert os.fstat(f).st_mtime_ns==s.st_mtime_ns
finally:os.close(f)
assert hashlib.sha256(raw).hexdigest()=='8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596';v=json.loads(raw);assert v['schema']=='pow-audit30-treasury-address-corpus-v1' and v['productionMutation']==False
out={'schema':'pow-audit30-treasury-failed-corpus-public-summary-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rawCorpusBytes':len(raw),'rawCorpusSha256':hashlib.sha256(raw).hexdigest(),'status':v['status'],'coverage':v['coverage'],'oracle':{k:x for k,x in v['oracle'].items()if k not in ('findings','offlineIntegrityErrors')},'rawTransactionsExported':False,'productionMutation':False}
for name,rows in [('captureFailures',v['captureFailures']),('offlineIntegrityErrors',v['oracle']['offlineIntegrityErrors']),('findings',v['oracle']['findings'])]:
 def bounded_row(row):
  return {k:({'count':len(x),'sha256':hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'valueExported':False}if isinstance(x,(dict,list))else {'bytes':len(x.encode()),'sha256':hashlib.sha256(x.encode()).hexdigest(),'valueExported':False}if isinstance(x,str)and len(x)>256 else x)for k,x in row.items()}
 out[name]={'count':len(rows),'allRowsSha256':hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'first50':[],'fullRowsExported':False,'first50ScalarFieldsOnly':True}
out['captureFailureHistogram']=[{'phase':k[0],'kind':k[1],'category':k[2],'method':k[3],'count':n}for k,n in collections.Counter((r.get('phase'),r.get('kind'),r.get('category'),r.get('method'))for r in v['captureFailures']).items()];out['offlineErrorHistogram']=[{'errorClass':k[0],'reasonSha256':k[1],'count':n}for k,n in collections.Counter((r.get('errorClass'),r.get('reasonSha256'))for r in v['oracle']['offlineIntegrityErrors']).items()];out['knownMissingCanonicalHashAfterReasonSha256']=hashlib.sha256(str(KeyError('canonicalHashAfter')).encode()).hexdigest();out['chainBefore']=v.get('chainBefore');out['chainAfter']=v.get('chainAfter');out['electrsBefore']=v.get('electrsBefore');out['electrsAfter']=v.get('electrsAfter')
raw=json.dumps(out,sort_keys=True);assert len(raw.encode())<=65536;print(raw)
