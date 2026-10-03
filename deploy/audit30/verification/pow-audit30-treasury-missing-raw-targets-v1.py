#!/usr/bin/python3 -I
"""One proposed read-only acquisition delta for exactly6650 saved missing targets.
No automatic next chunk, parent/proof/outpoint/balance acceptance, or signing.
Root approval/staging/typed native lifecycle remains the existing runner's job.
"""
import datetime as dt,hashlib,json,os,pathlib,pwd,re,signal,stat,sys,time,types
P=pathlib.Path
SEED_SHA='8eeb467bf3468734beee934d884148b7045ed28803045a2b66ac51ca0f1e2596'
SEED_BYTES=17672203
SEED_COLLECTOR_SHA='b60a0c359104001422c086f8e2df8c4eb9852eca7876fe1f153ff34807eac197'
TARGET_SET_SHA='2d7c5334be64f01fdc95fae58a96f7ae993f32e38c8454f1fbfe61d53581eb0d'
MISSING_SET_SHA='07b99a22cca63037d4303d9cb7ec69f6b8ae5d9c005772a43be5b1fc304f8eba'
CACHE_SET_SHA='415b91d6e04e7faa5f43ed35a15a46d49f3d9b22e677d87efe9d6a72cf79c0ea'
CHECKPOINT=dict(height=969687,hash='00000000000000000000c7704c9be76e6725b983edc5a3d91e03681fe4b89999')
NATIVE_MISSING_COUNT=6650
MAX_CALLS=10000;MAX_BYTES=256*1024**2;MAX_CHANNEL=8*1024**2;WHOLE_SECONDS=1200
SPOOL_RESERVED_BYTES=1024**2
# The frozen selector reads64KiB before noticing a channel-bound refusal.
MAX_CORE_RECEIVED=2*(MAX_CHANNEL+65536)
CLOSING_CALLS=4;CLOSING_BYTES=CLOSING_CALLS*MAX_CORE_RECEIVED;CLOSING_SECONDS=180
CLOSING_ELECTRS_CALLS=10;CLOSING_ELECTRS_BYTES=10*(2*1024**2+65536)
T=L=None
def need(v,c):
 if not v:raise ValueError(c)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def set_sha(v):return sha(encoded(sorted(v)))
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DELTA_DUPLICATE_JSON_KEY');d[k]=v
 return d
def identity(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read_member(path,h,cap,size=None):
 s=path.lstat();need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,pwd.getpwnam('bitcoin').pw_gid,0o440,1)and s.st_size<=cap and(size is None or s.st_size==size)and not os.listxattr(path,follow_symlinks=False),'DELTA_IMMUTABLE_MEMBER')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(identity(os.fstat(f.fileno()))==identity(s),'DELTA_MEMBER_FD');raw=f.read(cap+1);need(identity(os.fstat(f.fileno()))==identity(s),'DELTA_MEMBER_READ')
 need(identity(path.lstat())==identity(s)and len(raw)<=cap and sha(raw)==h,'DELTA_MEMBER_HASH_OR_PATH');return raw,identity(s)
def load_seed(v):
 need(v.get('schema')=='pow-audit30-treasury-address-corpus-v1'and v.get('status')=='partial-integrity-refused'and v.get('productionMutation')is False and v.get('addresses')==list(T.ADDRESSES)and v.get('chainBefore')==v.get('electrsBefore')==CHECKPOINT,'DELTA_EXACT_FAILED_SEED')
 origins={};cache={}
 for address in T.ADDRESSES:
  d=v['discovery'][address];rows=T.validate_history(d['history'],CHECKPOINT['height']);need(rows==d['history']and all(r['height']>0 for r in rows),'DELTA_CONFIRMED_SEED_HISTORY')
  T.validate_unspent(d['unspent'],CHECKPOINT['height']);T.validate_balance(d['balance'])
  for r in rows:origins.setdefault(r['tx_hash'],[]).append(dict(address=address,height=r['height']))
 for key in('transactions','parents'):
  for txid,t in v[key].items():
   p=L.parse_raw(t['rawHex']);need(p['txid']==txid==t['txid']and p['inputs']==t['inputs']and p['outputs']==t['outputs']and p['rawBytesSha256']==t['rawBytesSha256'],'DELTA_SEED_RAW_PARSER')
   if txid in cache:need(cache[txid]['rawHex']==t['rawHex'],'DELTA_SEED_CACHE_COLLISION')
   else:cache[txid]=t
 missing=set(origins)-set(cache)
 need(len(origins)==10232 and set_sha(origins)==TARGET_SET_SHA and len(cache)==5054 and set_sha(cache)==CACHE_SET_SHA and len(missing)==6650 and set_sha(missing)==MISSING_SET_SHA,'DELTA_EXACT_TARGET_CACHE_SETS');return origins,sorted(missing)
class ClosingReserve(RuntimeError):pass
class BudgetRPC:
 def __init__(self,rpc,deadline,clock=time.monotonic):self.inner=rpc;self.deadline=deadline;self.clock=clock
 @property
 def calls(self):return self.inner.calls
 @property
 def bytes(self):return self.inner.bytes
 def call(self,method,*args,closing=False):
  need(method in('getblockchaininfo','getblockhash','getrawtransaction'),'DELTA_RPC_METHOD_SCOPE')
  if method=='getrawtransaction':need(len(args)==2 and isinstance(args[0],str)and L.TXID.fullmatch(args[0])and args[1]=='true'and not closing,'DELTA_RAW_ARGS')
  elif method=='getblockhash':need(len(args)==1 and type(args[0])is int and args[0]>=CHECKPOINT['height'],'DELTA_PREFIX_OR_CURRENT_HEIGHT_ONLY')
  else:need(not args,'DELTA_CHAININFO_ARGS')
  need(self.calls<MAX_CALLS and self.bytes<=MAX_BYTES and self.clock()<self.deadline,'DELTA_RPC_OVERALL_BOUNDS')
  if not closing and method=='getrawtransaction':
   if self.calls+1+CLOSING_CALLS>MAX_CALLS or self.bytes+MAX_CORE_RECEIVED+CLOSING_BYTES>MAX_BYTES or self.clock()+20+CLOSING_SECONDS>self.deadline:raise ClosingReserve('DELTA_CLOSING_RESERVE_REACHED')
  return self.inner.call(method,*args)
def chain(v):
 need(isinstance(v,dict)and v.get('chain')=='main'and type(v.get('blocks'))is int and v['blocks']>=CHECKPOINT['height']and L.TXID.fullmatch(v.get('bestblockhash','')),'DELTA_MAIN_CHAIN_SHAPE');return dict(height=v['blocks'],hash=v['bestblockhash'])
def discovery(electrs,rpc,seed,tip,closing=False):
 # Same bounded responses and canonical header checks as the frozen collector.
 h,_=electrs.call('blockchain.headers.subscribe');need(type(h.get('height'))is int and CHECKPOINT['height']<=h['height']<=tip,'DELTA_ELECTRS_HEADER_HEIGHT');hash_=L.header_proof(h['hex']);need(rpc.call('getblockhash',h['height'],closing=closing)[0]==hash_,'DELTA_ELECTRS_CANONICAL_HEADER');out={}
 for address in T.ADDRESSES:
  d=seed['discovery'][address];history,hh=electrs.call('blockchain.scripthash.get_history',d['scripthash']);unspent,uh=electrs.call('blockchain.scripthash.listunspent',d['scripthash']);balance,bh=electrs.call('blockchain.scripthash.get_balance',d['scripthash']);history=T.validate_history(history,tip);unspent=T.validate_unspent(unspent,tip);balance=T.validate_balance(balance)
  need(history==d['history']and unspent==d['unspent']and balance==d['balance'],'DELTA_SAVED_DISCOVERY_RESPONSE_CHANGED');out[address]=dict(historySha256=sha(encoded(history)),unspentSha256=sha(encoded(unspent)),balanceSha256=sha(encoded(balance)),responseSha256=dict(history=hh,unspent=uh,balance=bh))
 return dict(height=h['height'],hash=hash_,responses=out)
def failure(phase,ex,txid=None):
 row=dict(phase=phase,txid=txid,errorClass=type(ex).__name__,reasonSha256=sha(str(ex).encode()))
 if isinstance(ex,L.RPCFailure):row.update(ex.row)
 return row
def operator_interrupted(signum,frame):T.INTERRUPTED=signum;L._OPERATOR_INTERRUPTED=signum
def collect(seed,origins,missing,rpc,electrs,clock=time.monotonic):
 need(isinstance(missing,list)and missing==sorted(set(missing))and len(missing)==NATIVE_MISSING_COUNT and set_sha(missing)==MISSING_SET_SHA and all(t in origins for t in missing),'DELTA_EXACT_ACQUISITION_SET')
 start=clock();deadline=start+WHOLE_SECONDS;b=BudgetRPC(rpc,deadline,clock);out=dict(schema='pow-audit30-treasury-missing-raw-target-delta-v1',seedCorpusSha256=SEED_SHA,seedCheckpoint=CHECKPOINT,atUtc=dt.datetime.now(dt.timezone.utc).isoformat(),requestedTargetSetSha256=MISSING_SET_SHA,requestedTargetCount=NATIVE_MISSING_COUNT,unionTargetSetSha256=TARGET_SET_SHA,newTransactions={},captureFailures=[],chainBefore=None,chainAfter=None,discoveryBefore=None,discoveryAfter=None,closingFencesAccepted=False,productionMutation=False,automaticNextChunk=False,automaticRetry=False,parentCoverageAccepted=False,canonicalMembershipCoverageAccepted=False,outpointCoverageAccepted=False,balanceComparisonPerformed=False,financialReconciliationComplete=False,obligationReconciliationComplete=False,independentWholeChainAddressHistoryComplete=False,signingEligibilityVerified=False,may9OperatorSettlementPreserved=True,may9TransactionIDsRequested=False)
 opened=False;stopped_reason=None;record_bytes=0
 try:
  out['chainBefore']=chain(b.call('getblockchaininfo')[0]);need(b.call('getblockhash',CHECKPOINT['height'])[0]==CHECKPOINT['hash'],'DELTA_ORIGINAL_PREFIX_CHANGED');out['discoveryBefore']=discovery(electrs,b,seed,out['chainBefore']['height']);opened=True
  need(electrs.calls+CLOSING_ELECTRS_CALLS<=24 and electrs.bytes+CLOSING_ELECTRS_BYTES<=32*1024**2,'DELTA_ELECTRS_CLOSING_RESERVE')
  for txid in missing:
   try:
    v,h=b.call('getrawtransaction',txid,'true');t=L.normalize_verbose(v);need(t['txid']==txid and isinstance(t['blockHash'],str)and L.TXID.fullmatch(t['blockHash'])and type(t['confirmationsAtCapture'])is int and t['confirmationsAtCapture']>0,'DELTA_REQUESTED_CONFIRMED_RAW_IDENTITY');t['coreResponseSha256']=h;t['discoveredOrigins']=origins[txid]
    contribution=len(encoded(txid))+1+len(encoded(t))+1
    if record_bytes+contribution+SPOOL_RESERVED_BYTES>MAX_BYTES:raise ClosingReserve('DELTA_OUTPUT_SPOOL_RESERVE_REACHED')
    out['newTransactions'][txid]=t;record_bytes+=contribution
   except ClosingReserve as ex:stopped_reason='closing-reserve';out['captureFailures'].append(failure('acquisition-reserve',ex,txid));break
   except Exception as ex:
    out['captureFailures'].append(failure('raw-target',ex,txid));stopped_reason='rpc-or-raw-refusal'
    # No further acquisition following a refusal. The current delta is retained.
    break
 except Exception as ex:out['captureFailures'].append(failure('opening-fence',ex));stopped_reason='opening-refused'
 if opened:
  try:
   closing_deadline=min(deadline,clock()+CLOSING_SECONDS)
   # Shorter existing transport deadlines preserve the original upper bounds.
   if hasattr(rpc,'inner')and hasattr(rpc.inner,'deadline'):rpc.inner.deadline=min(rpc.inner.deadline,closing_deadline)
   electrs.deadline=min(electrs.deadline,closing_deadline)
   out['chainAfter']=chain(b.call('getblockchaininfo',closing=True)[0]);need(out['chainAfter']['height']>=out['chainBefore']['height']and b.call('getblockhash',CHECKPOINT['height'],closing=True)[0]==CHECKPOINT['hash']and b.call('getblockhash',out['chainBefore']['height'],closing=True)[0]==out['chainBefore']['hash'],'DELTA_PREFIX_OR_CURRENT_OPENING_FORK_CHANGED');out['discoveryAfter']=discovery(electrs,b,seed,out['chainAfter']['height'],closing=True);out['closingFencesAccepted']=True
  except Exception as ex:out['captureFailures'].append(failure('closing-fence',ex));stopped_reason=stopped_reason or'closing-refused'
 acquired=set(out['newTransactions']);remaining=set(missing)-acquired;out['coverage']=dict(requested=NATIVE_MISSING_COUNT,acquired=len(acquired),remaining=len(remaining),acquiredTargetSetSha256=set_sha(acquired),remainingTargetSetSha256=set_sha(remaining),coreCalls=b.calls,coreBytes=b.bytes,electrsCalls=electrs.calls,electrsBytes=electrs.bytes,closingReservedCoreCalls=CLOSING_CALLS,closingReservedCoreBytes=CLOSING_BYTES,closingReservedElectrsCalls=CLOSING_ELECTRS_CALLS,closingReservedElectrsBytes=CLOSING_ELECTRS_BYTES,closingReservedSeconds=CLOSING_SECONDS,serializedRawRecordsBytes=record_bytes,spoolReservedBytes=SPOOL_RESERVED_BYTES,wholeSeconds=clock()-start)
 out['status']='raw-target-delta-complete-with-closing-fences'if not remaining and not out['captureFailures']and out['closingFencesAccepted']else'partial-raw-target-delta';out['stoppedReason']=stopped_reason;out['qualification']='Exactly the saved6650 missing target raws only; original failed corpus stays failed. Raw parser equality and stable saved/current opening prefixes do not substitute for new canonical membership, full prevouts, historical outpoints or any balance/obligation/signing reconciliation. Pending and discovery-index completeness remain qualified.';need(b.calls<=MAX_CALLS and b.bytes<=MAX_BYTES,'DELTA_FINAL_RPC_BOUNDS');return out
def main():
 global T,L
 need(sys.flags.isolated and len(sys.argv)==1 and(os.geteuid(),os.getegid())==(pwd.getpwnam('bitcoin').pw_uid,pwd.getpwnam('bitcoin').pw_gid),'DELTA_NATIVE_BITCOIN_ROLE');base=P(__file__).parent;bs=base.lstat();need(P(__file__).name=='collector.py'and base.resolve(strict=True)==base and re.fullmatch('/usr/local/lib/proofofwork-audit30-treasury-raw-targets/[0-9]{8}T[0-9]{6}Z',str(base))and stat.S_ISDIR(bs.st_mode)and(bs.st_uid,bs.st_gid,stat.S_IMODE(bs.st_mode))==(0,pwd.getpwnam('bitcoin').pw_gid,0o750)and not os.listxattr(base,follow_symlinks=False)and set(x.name for x in base.iterdir())=={'collector.py','seed-collector.py','ledger-corpus-v2.py','original-failed-corpus.json'},'DELTA_FIXED_PACKAGE');base_identity=identity(bs)
 code,cm=read_member(base/'seed-collector.py',SEED_COLLECTOR_SHA,65536,23960);T=types.ModuleType('frozen-b60');T.__file__=str(base/'seed-collector.py');exec(compile(code,T.__file__,'exec'),T.__dict__);_,lm=read_member(base/'ledger-corpus-v2.py',T.LEDGER_SHA,262144,34250);L=T.load_ledger();raw,sm=read_member(base/'original-failed-corpus.json',SEED_SHA,SEED_BYTES,SEED_BYTES);seed=json.loads(raw,object_pairs_hook=pairs);origins,missing=load_seed(seed);old={}
 for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):old[s]=signal.signal(s,operator_interrupted)
 try:
  result=collect(seed,origins,missing,T.CoreRPC(),T.Electrs(time.monotonic()+WHOLE_SECONDS));need(identity(base.lstat())==base_identity and identity((base/'original-failed-corpus.json').lstat())==sm and identity((base/'seed-collector.py').lstat())==cm and identity((base/'ledger-corpus-v2.py').lstat())==lm,'DELTA_INPUT_METADATA_DRIFT');b=encoded(result)+b'\n';need(len(b)<=MAX_BYTES,'DELTA_OUTPUT_SPOOL_BOUND');sys.stdout.buffer.write(b);return 0 if result['status']=='raw-target-delta-complete-with-closing-fences'else 2
 finally:
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:status=main()
 except BaseException as ex:print(json.dumps(dict(schema='pow-audit30-treasury-raw-delta-admission-refused-v1',errorClass=type(ex).__name__,reasonSha256=sha(str(ex).encode()),productionMutation=False,automaticRetry=False)),file=sys.stderr);status=1
 raise SystemExit(status)
