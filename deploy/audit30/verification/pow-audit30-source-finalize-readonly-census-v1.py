#!/usr/bin/python3 -I
"""Read two fixed code-custody files. No SQL, RPC, unit operation or state export."""
import base64,hashlib,json,os,pathlib,re,signal,stat,sys,time
PACKAGE=pathlib.Path('/usr/local/lib/proofofwork-audit30-onhost-math/v2')
COMPLETION=PACKAGE/'source-copy-finalize-v3-completed.json'
MANIFEST=PACKAGE/'source-copy-manifest.json'
SUMMARY_SHA='ea004bdebead246f769ee741012bf280036d8f020b9b653345e5400cdd882918'
MANIFEST_SHA='e904b0379dd6c80f68eebbb556b5bd5caa8619aa79df89f03ed16ebbeb6db977'
REQUEST_SHA='ce8ea8d18e19361919360a433882f680fd9c6fa3e41aaa9e9f2636645d6f5fb9'
INV='fcea4496dea54ecb9b3f314b9746ce1e'
ATTEST='0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6'
INVENTORY='aae198d18b0f5b347f25022f4c141b546aebf5f62d32e21cd72443ede5edd642'
DEADLINE=None
class Refused(Exception):pass
def need(p,c):
 if not p:raise Refused(c)
def guard():need(DEADLINE is None or time.monotonic()<DEADLINE,'CODE_CENSUS_DEADLINE')
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'CODE_CENSUS_DUPLICATE_JSON');d[k]=v
 return d
def parse(raw):return json.loads(raw,object_pairs_hook=pairs)
def stamp(s):return {'dev':str(s.st_dev),'ino':str(s.st_ino),'bytes':str(s.st_size),'mtimeNs':str(s.st_mtime_ns),'ctimeNs':str(s.st_ctime_ns),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':str(s.st_nlink)}
def parent_shape(p):
 s=p.lstat();need(p.resolve()==p and stat.S_ISDIR(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,112,0o750)and not os.listxattr(p),'CODE_CENSUS_PACKAGE_AUTHORITY');return stamp(s)
def read_verified(p,cap,uid,gid,mode,expected=None):
 guard();s=p.lstat();m=stamp(s);need(p.resolve()==p and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(uid,gid,mode,1)and 0<s.st_size<=cap and not os.listxattr(p),'CODE_CENSUS_FILE_AUTHORITY')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  need(stamp(os.fstat(fd))==m and not os.listxattr(fd),'CODE_CENSUS_OPEN_IDENTITY');data=bytearray()
  while True:
   guard();b=os.read(fd,65536)
   if not b:break
   data.extend(b);need(len(data)<=cap,'CODE_CENSUS_FILE_CAP')
  need(stamp(os.fstat(fd))==m==stamp(p.lstat())and not os.listxattr(fd)and not os.listxattr(p),'CODE_CENSUS_FILE_DRIFT')
 finally:os.close(fd)
 raw=bytes(data);h=sha(raw);need(expected is None or h==expected,'CODE_CENSUS_RAW_HASH');return raw,{'path':str(p),'sha256':h,'metadata':m}
def request(raw):
 r=parse(raw);need(isinstance(r,dict)and set(r)=={'schema','summaryBase64','summarySha256','manifestSha256'}and r['schema']=='pow-audit30-source-finalize-readonly-census-request-v1'and r['summarySha256']==SUMMARY_SHA and r['manifestSha256']==MANIFEST_SHA,'CODE_CENSUS_REQUEST_SCOPE')
 try:b=base64.b64decode(r['summaryBase64'],validate=True)
 except (ValueError,TypeError):raise Refused('CODE_CENSUS_REQUEST_BASE64')
 need(0<len(b)<=65536 and sha(b)==SUMMARY_SHA,'CODE_CENSUS_SUMMARY_RAW_SHA');v=parse(b);need(isinstance(v,dict),'CODE_CENSUS_SUMMARY_SHAPE');return v
def validate(v,m,summary):
 need(v.get('schema')=='pow-audit30-source-copy-finalize-completed-v3'and v.get('status')=='completed'and v.get('requestSHA256')==REQUEST_SHA and v.get('sourceCopyManifestSHA256')==MANIFEST_SHA,'CODE_CENSUS_COMPLETION_SCOPE')
 n=v.get('nativeReadability',{});need(n.get('receipt')=={'uid':108,'gid':112,'entries':6141,'allSourceAndDependenciesReadable':True}and n.get('unit')=='proofofwork-audit30-math-source-readability-v4.service'and n.get('InvocationID')==INV and n.get('ownedStop',{}).get('unitStopVerified')is True and n.get('remainAfterExitStopped')is True,'CODE_CENSUS_READABILITY_STOP')
 need(m.get('schema')=='pow-audit30-onhost-math-source-copy-v1'and m.get('candidateRoot')=='/opt/proofofwork-api-stage-3399d767103e-20261003T020420Z'and m.get('sourceRoot')==str(PACKAGE/'source')and m.get('candidateAttestationSHA256')==m.get('attestationBeforeSHA256')==m.get('attestationAfterSHA256')==ATTEST and m.get('sourceInventorySHA256')==INVENTORY and m.get('entryCount')==6141 and m.get('regularBytes')==164382510 and isinstance(m.get('entries'),list)and len(m['entries'])==6141,'CODE_CENSUS_MANIFEST_SCOPE')
 need(all(v.get(k)is True for k in('priorAttemptRemainsFailed','sourceTreeNotModified','candidateUnchanged'))and v.get('productionMutation')is False and v.get('privateRawStateCopied')is False and all(m.get(k)is True for k in('sourceBytesExact','candidateUnchanged','nativeReadabilityPassed'))and m.get('privateRawStateCopied')is False,'CODE_CENSUS_COMPLETION_PREDICATES')
 derived={k:x for k,x in v.items()if k!='nativeReadability'}|{'nativeReadabilityPassed':True,'InvocationID':n['InvocationID'],'unitStopVerified':n['ownedStop']['unitStopVerified'],'entryCount':m['entryCount'],'regularBytes':m['regularBytes']}
 need(derived==summary,'CODE_CENSUS_COMPLETION_SUMMARY_MISMATCH');return True
def collect(summary):
 before=parent_shape(PACKAGE);a,am=read_verified(COMPLETION,65536,0,0,0o600);b,bm=read_verified(MANIFEST,32*1024**2,0,112,0o440,MANIFEST_SHA);v=parse(a);m=parse(b);validate(v,m,summary)
 need(encoded(v)==a and encoded(m)==b,'CODE_CENSUS_CANONICAL_COMPACT_BYTES');a2,am2=read_verified(COMPLETION,65536,0,0,0o600,am['sha256']);b2,bm2=read_verified(MANIFEST,32*1024**2,0,112,0o440,MANIFEST_SHA)
 need(a2==a and b2==b and am==am2 and bm==bm2 and parent_shape(PACKAGE)==before,'CODE_CENSUS_REPEATED_CUSTODY_DRIFT')
 return {'schema':'pow-audit30-source-finalize-readonly-census-v1','status':'passed','completion':am,'manifest':bm,'packageMetadata':before,'summarySha256':SUMMARY_SHA,'completionSummaryExact':True,'canonicalRawFiles':True,'nativeInvocation':INV,'nativeStopped':True,'entryCount':6141,'regularBytes':164382510,'payloadExported':False,'productionMutation':False,'sqlCoreUnitActions':False,'qualification':'Two fixed code-custody artifacts only. No source-copy repair, SQL/Core/application state access, arithmetic execution, or private payload export.'}
def main():
 global DEADLINE
 need(os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01'and sys.flags.isolated and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'CODE_CENSUS_ROOT_FIXED_ARGV');old={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM)}
 def interrupted(s,f):raise InterruptedError('CODE_CENSUS_INTERRUPTED')
 for s in old:signal.signal(s,interrupted)
 signal.setitimer(signal.ITIMER_REAL,60);DEADLINE=time.monotonic()+60
 try:
  raw=sys.stdin.buffer.read(65536+1);need(len(raw)<=65536 and sha(raw)==sys.argv[1],'CODE_CENSUS_REQUEST_RAW_SHA');return collect(request(raw))
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:r=main()
 except BaseException as e:print(json.dumps({'status':'refused','code':str(e)if isinstance(e,Refused)else type(e).__name__,'productionMutation':False}));sys.exit(1)
 print(json.dumps(r,sort_keys=True))
