#!/usr/bin/python3 -I
"""Proposed first8000 parent raws; no further chunk, proof or financial authority.
Reuses byte-pinned02fc collection/budget/discovery/signal functions unchanged.
"""
import hashlib,json,os,pathlib,pwd,re,signal,stat,sys,time,types
P=pathlib.Path
OLD=P('/usr/local/lib/proofofwork-audit30-treasury-raw-targets/20261003T080000Z')
DELTA_SHA='e5e2b45bc4156bb1e018809ed047a336fb55183c6934c3836c345a5d1231caaf'
DELTA_BYTES=17722465
CACHE_SHA='8450bb507998e6d5e4d6e11cb25788d92bf562ada69b7aa90e7907d81ef9c7c6'
MISSING_PARENT_SHA='dd402962c0c54b43d9a08dff0dbfefa9e8e22a667c10fdcb24fd809344583998'
PARENT_COUNT=10569;CHUNK_COUNT=8000;REQUIRED_COUNT=22264;PREVOUT_COUNT=32516
PINS={'collector.py':('02fc3a54c231c85bd1beab9307a9959bf2092bb169bdc603de64960830781130',13980,435746,1791013422949871647),'seed-collector.py':('b60a0c359104001422c086f8e2df8c4eb9852eca7876fe1f153ff34807eac197',23960,435747,1791013422949871647),'ledger-corpus-v2.py':('c37fb22836172254baaa8d2da125ff97fa25d7c955a0afa4c6b72accbe29cef7',34250,435748,1791013422949871647),'original-failed-corpus.json':('8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596',17672203,435749,1791013422950871647)}
R=T=L=None
def need(v,c):
 if not v:raise ValueError(c)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def ident(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(path,h,n,expected=None):
 s=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink,s.st_size)==(0,988,0o440,1,n)and not os.listxattr(path,follow_symlinks=False),'PARENT_IMMUTABLE_INPUT')
 if expected is not None:need(ident(s)==tuple(expected),'PARENT_PRIOR_NATIVE_INPUT_IDENTITY')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(ident(os.fstat(f.fileno()))==ident(s),'PARENT_INPUT_FD');raw=f.read(n+1);need(ident(os.fstat(f.fileno()))==ident(s),'PARENT_INPUT_READ')
 need(ident(path.lstat())==ident(s)and len(raw)==n and sha(raw)==h,'PARENT_INPUT_BYTES_OR_PATH');return raw,ident(s)
def load():
 global R,T,L
 s=OLD.lstat();need(OLD.resolve(strict=True)==OLD and stat.S_ISDIR(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,988,0o750)and set(x.name for x in OLD.iterdir())==set(PINS)and not os.listxattr(OLD,follow_symlinks=False),'PARENT_EXACT_OLD_PACKAGE');stamp=ident(s);raws={};proof={}
 for name,(h,n,ino,ns)in PINS.items():raws[name],proof[name]=read(OLD/name,h,n,[64512,ino,stat.S_IFREG|0o440,0,988,1,n,ns,ns])
 R=types.ModuleType('frozen02fc');R.__file__=str(OLD/'collector.py');exec(compile(raws['collector.py'],R.__file__,'exec'),R.__dict__)
 T=types.ModuleType('frozenb60');T.__file__=str(OLD/'seed-collector.py');exec(compile(raws['seed-collector.py'],T.__file__,'exec'),T.__dict__)
 L=T.load_ledger();R.T=T;R.L=L
 return json.loads(raws['original-failed-corpus.json'],object_pairs_hook=R.pairs),stamp,proof
def selection(seed,delta):
 origins,old_missing=R.load_seed(seed)
 need(delta.get('schema')=='pow-audit30-treasury-missing-raw-target-delta-v1'and delta.get('status')=='raw-target-delta-complete-with-closing-fences'and delta.get('seedCorpusSha256')==R.SEED_SHA and delta.get('closingFencesAccepted')is True and delta.get('captureFailures')==[],'PARENT_ACCEPTED_TARGET_RAW_DELTA')
 rows=delta.get('newTransactions');need(isinstance(rows,dict)and set(rows)==set(old_missing)and delta.get('requestedTargetCount')==6650 and delta.get('requestedTargetSetSha256')==R.MISSING_SET_SHA,'PARENT_EXACT_TARGET_RAW_SET')
 c=delta.get('coverage');need(isinstance(c,dict)and all(type(c.get(k))is int for k in('requested','acquired','remaining'))and(c['requested'],c['acquired'],c['remaining'])==(6650,6650,0),'PARENT_FULL_TARGET_RAW_COVERAGE')
 cache=dict(seed['parents']);cache.update(seed['transactions']);need(not set(cache).intersection(rows),'PARENT_RAW_CACHE_COLLISION')
 for txid,t in rows.items():
  p=L.parse_raw(t['rawHex']);need(p['txid']==txid==t['txid']and p['inputs']==t['inputs']and p['outputs']==t['outputs']and p['rawBytesSha256']==t['rawBytesSha256'],'PARENT_TARGET_RAW_PARSER');cache[txid]=t
 need(len(cache)==11704 and R.set_sha(cache)==CACHE_SHA and set(origins)<=set(cache),'PARENT_FULL_RAW_CACHE_AUTHORITY')
 required={};prevouts=set()
 for txid in origins:
  for i in cache[txid]['inputs']:
   if i['txid']=='0'*64:continue
   need(type(i['vout'])is int and i['vout']>=0 and L.TXID.fullmatch(i['txid']),'PARENT_EXACT_PREVOUT_SHAPE');required.setdefault(i['txid'],set()).add((txid,i['vout']));prevouts.add((i['txid'],i['vout']))
   if i['txid']in cache:need(i['vout']<len(cache[i['txid']]['outputs']),'PARENT_CACHED_PREVOUT_OUT_OF_RANGE')
 missing=sorted(set(required)-set(cache));need(len(required)==REQUIRED_COUNT and len(prevouts)==PREVOUT_COUNT and len(missing)==PARENT_COUNT and R.set_sha(missing)==MISSING_PARENT_SHA,'PARENT_FULL_MISSING_DEMAND_AUTHORITY')
 chosen=missing[:CHUNK_COUNT];need(len(chosen)==CHUNK_COUNT and len(set(chosen))==CHUNK_COUNT,'PARENT_EXACT_FIRST_CHUNK')
 summaries={p:[dict(requiredTargetCount=len({x[0]for x in required[p]}),requiredPrevoutCount=len({x[1]for x in required[p]}))]for p in chosen};return summaries,chosen,R.set_sha(chosen)
def collect(seed,delta,rpc,electrs,clock=time.monotonic):
 refs,chosen,chosen_sha=selection(seed,delta)
 # Only derived data authorities change in this private module instance. Frozen
 # code/caps/methods/deadlines/closing routines remain byte-exact02fc definitions.
 old_count,old_sha=R.NATIVE_MISSING_COUNT,R.MISSING_SET_SHA
 try:
  R.NATIVE_MISSING_COUNT=CHUNK_COUNT;R.MISSING_SET_SHA=chosen_sha;out=R.collect(seed,refs,chosen,rpc,electrs,clock)
 finally:R.NATIVE_MISSING_COUNT=old_count;R.MISSING_SET_SHA=old_sha
 out['newParents']=out.pop('newTransactions')
 for t in out['newParents'].values():t['requiredInputSummary']=t.pop('discoveredOrigins')
 out['requestedParentCount']=out.pop('requestedTargetCount');out['requestedParentSetSha256']=out.pop('requestedTargetSetSha256');out['unionHistoryTargetSetSha256']=out.pop('unionTargetSetSha256')
 out['schema']='pow-audit30-treasury-missing-parent-raw-chunk-v1';out['status']='parent-raw-chunk-complete-with-closing-fences'if out['status']=='raw-target-delta-complete-with-closing-fences'else'partial-parent-raw-chunk';out['allMissingParentCount']=PARENT_COUNT;out['allMissingParentSetSha256']=MISSING_PARENT_SHA;out['sourceRawTargetDeltaSha256']=DELTA_SHA;out['sourceFullRawCacheSetSha256']=CACHE_SHA;out['chunkIndex']=1;out['selectionRule']='lexicographically-first-8000';out['expectedRemainingAfterComplete']=PARENT_COUNT-CHUNK_COUNT;out['futureChunksAuthorized']=False
 out['coverage']['acquiredParentSetSha256']=out['coverage'].pop('acquiredTargetSetSha256');out['coverage']['remainingParentSetSha256']=out['coverage'].pop('remainingTargetSetSha256')
 out['qualification']='First8000 of the exact10569 missing prevout-parent transaction raws only. All previous failures and inputs remain immutable. No next chunk, target/parent canonical membership, complete prevouts, fees, outpoints, balances, obligations or signing claim; stable saved/current prefixes and raw parser identities are scoped acquisition evidence.';return out
def main():
 need(sys.flags.isolated and len(sys.argv)==1 and(os.geteuid(),os.getegid())==(pwd.getpwnam('bitcoin').pw_uid,988),'PARENT_NATIVE_ROLE');base=P(__file__).parent;s=base.lstat();need(P(__file__).name=='collector.py'and base.resolve(strict=True)==base and re.fullmatch('/usr/local/lib/proofofwork-audit30-treasury-missing-parents/[0-9]{8}T[0-9]{6}Z',str(base))and stat.S_ISDIR(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,988,0o750)and set(x.name for x in base.iterdir())=={'collector.py','completed-raw-target-delta.json'}and not os.listxattr(base,follow_symlinks=False),'PARENT_EXACT_NEW_PACKAGE');stamp=ident(s);seed,oldstamp,proof=load();raw,dm=read(base/'completed-raw-target-delta.json',DELTA_SHA,DELTA_BYTES);delta=json.loads(raw,object_pairs_hook=R.pairs);old={sig:signal.signal(sig,R.operator_interrupted)for sig in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 try:
  out=collect(seed,delta,T.CoreRPC(),T.Electrs(time.monotonic()+R.WHOLE_SECONDS));need(ident(base.lstat())==stamp and ident(OLD.lstat())==oldstamp and ident((base/'completed-raw-target-delta.json').lstat())==dm and all(ident((OLD/k).lstat())==v for k,v in proof.items()),'PARENT_ALL_INPUT_FINAL_FENCE');body=R.encoded(out)+b'\n';need(len(body)<=R.MAX_BYTES,'PARENT_OUTPUT_SPOOL_BOUND');sys.stdout.buffer.write(body);return 0 if out['status']=='parent-raw-chunk-complete-with-closing-fences'else 2
 finally:
  for sig,h in old.items():signal.signal(sig,h)
if __name__=='__main__':
 try:status=main()
 except BaseException as e:print(json.dumps(dict(schema='pow-audit30-parent-raw-chunk-admission-refused-v1',errorClass=type(e).__name__,reasonSha256=sha(str(e).encode()),productionMutation=False,automaticRetry=False)),file=sys.stderr);status=1
 raise SystemExit(status)
