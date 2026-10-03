#!/usr/bin/python3 -I
"""One proposed remaining-parent + discovered-history proof/fee/spend closure.
No automatic next chunk, independent full-history/obligation or signing claim.
Original caches and02fc/b60/c37 remain immutable. Existing native runner owns GO.
"""
import datetime as dt,hashlib,json,os,pathlib,pwd,re,signal,stat,sys,time,types
P=pathlib.Path
OLD=P('/usr/local/lib/proofofwork-audit30-treasury-missing-parents/20261003T083000Z')
OLD_PINS={'collector.py':('19a1b97f2519926bb6c22b2e95b848accb0938a8c32df611facbfefc8c722a09',9004,435877,1791015340865986048),'completed-raw-target-delta.json':('e5e2b45bc4156bb1e018809ed047a336fb55183c6934c3836c345a5d1231caaf',17722465,435878,1791015340865986048)}
PARENT_SHA='9e4736cce51b351926754021f11b23a738a506440fccfe747bbd1dab71e01f89';PARENT_BYTES=14436219
PARENT_SELECTED_SHA='119db07675acae962b23c1991f17bf3d7aa9ad5c7c85a301e91bc634174efae2'
CACHE_SHA='3f8022b89cdde901f7c9cc208b7a66eaf469b3ddef4561614a07a33d7530fd27'
REMAINING_COUNT=2569;REMAINING_SHA='608eed04fff7e8e28c6396fc743dd15834219adebfc2c8fef7e03efe8251dbff'
TARGET_COUNT=10232;GROUP_COUNT=567;BATCH_COUNT=644;REQUIRED_COUNT=22264;PREVOUT_COUNT=32516
MAX_CALLS=10000;MAX_BYTES=256*1024**2;MAX_CHANNEL=8*1024**2;SECONDS=1200;CLOSING_SECONDS=180;SPOOL_RESERVE=1024**2
# Tighter individual reply bounds retain the original8MiB upper bound. The
# frozen selector can read another64KiB before refusing, charged on both pipes.
SMALL_REPLY=4096;MEDIUM_REPLY=16384;OVERSHOOT=65536
P0=R=T=L=None
class Reserve(RuntimeError):pass

def need(v,c):
 if not v:raise ValueError(c)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def set_sha(v):return sha(encoded(sorted(v)))
def ident(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'FINAL_DUPLICATE_JSON_KEY');d[k]=v
 return d

def load(base):
 global P0,R,T,L
 s=OLD.lstat();need(OLD.resolve(strict=True)==OLD and stat.S_ISDIR(s.st_mode) and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,988,0o750) and set(x.name for x in OLD.iterdir())==set(OLD_PINS) and not os.listxattr(OLD,follow_symlinks=False),'FINAL_PRIOR_PACKAGE');oldstamp=ident(s)
 code=OLD/'collector.py';st=code.lstat();h,n,ino,ns=OLD_PINS['collector.py'];need(ident(st)==(64512,ino,stat.S_IFREG|0o440,0,988,1,n,ns,ns) and code.resolve(strict=True)==code and not os.listxattr(code,follow_symlinks=False),'FINAL_PRIOR_SOURCE_METADATA')
 fd=os.open(code,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:need(ident(os.fstat(f.fileno()))==ident(st),'FINAL_PRIOR_SOURCE_FD');raw=f.read(n+1);need(ident(os.fstat(f.fileno()))==ident(st),'FINAL_PRIOR_SOURCE_READ')
 need(ident(code.lstat())==ident(st) and len(raw)==n and sha(raw)==h,'FINAL_PRIOR_SOURCE_BYTES');P0=types.ModuleType('frozen19a1');P0.__file__=str(code);exec(compile(raw,str(code),'exec'),P0.__dict__);seed,priorstamp,priorproof=P0.load();R,T,L=P0.R,P0.T,P0.L
 h,n,ino,ns=OLD_PINS['completed-raw-target-delta.json'];raw,dm=P0.read(OLD/'completed-raw-target-delta.json',h,n,[64512,ino,stat.S_IFREG|0o440,0,988,1,n,ns,ns]);delta=json.loads(raw,object_pairs_hook=pairs);del raw
 raw,pm=P0.read(base/'parent-chunk1-corpus.json',PARENT_SHA,PARENT_BYTES);parent=json.loads(raw,object_pairs_hook=pairs);del raw
 origins,cache,missing=load_cache(seed,delta,parent)
 return seed,origins,cache,missing,dict(old=oldstamp,source=ident(st),targetDelta=dm,parentDelta=pm,originalPackage=priorstamp,originalFiles=priorproof)

def load_cache(seed,delta,parent):
 origins,_=R.load_seed(seed);_,chosen,h=P0.selection(seed,delta);need(h==PARENT_SELECTED_SHA,'FINAL_FIRST_PARENT_SELECTION')
 need(parent.get('schema')=='pow-audit30-treasury-missing-parent-raw-chunk-v1' and parent.get('status')=='parent-raw-chunk-complete-with-closing-fences' and parent.get('seedCorpusSha256')==R.SEED_SHA and parent.get('sourceRawTargetDeltaSha256')==P0.DELTA_SHA and parent.get('closingFencesAccepted')is True and parent.get('captureFailures')==[] and parent.get('requestedParentCount')==8000 and parent.get('requestedParentSetSha256')==PARENT_SELECTED_SHA and parent.get('sourceFullRawCacheSetSha256')==P0.CACHE_SHA and parent.get('allMissingParentCount')==10569 and parent.get('allMissingParentSetSha256')==P0.MISSING_PARENT_SHA and parent.get('expectedRemainingAfterComplete')==REMAINING_COUNT and parent.get('chunkIndex')==1 and parent.get('selectionRule')=='lexicographically-first-8000','FINAL_ACCEPTED_PARENT_DELTA')
 need(all(parent.get(k)is False for k in('productionMutation','financialReconciliationComplete','obligationReconciliationComplete','parentCoverageAccepted','canonicalMembershipCoverageAccepted','outpointCoverageAccepted','balanceComparisonPerformed','automaticNextChunk','automaticRetry','may9TransactionIDsRequested','futureChunksAuthorized')),'FINAL_PARENT_QUALIFICATIONS')
 rows=parent.get('newParents');need(isinstance(rows,dict) and sorted(rows)==chosen and set_sha(rows)==PARENT_SELECTED_SHA,'FINAL_PARENT_RAW_SET');cache={**seed['parents'],**seed['transactions'],**delta['newTransactions']};need(not set(cache).intersection(rows),'FINAL_PARENT_CACHE_COLLISION')
 for txid,t in rows.items():
  p=L.parse_raw(t['rawHex']);need(p['txid']==txid==t['txid'] and p['inputs']==t['inputs'] and p['outputs']==t['outputs'] and p['rawBytesSha256']==t['rawBytesSha256'],'FINAL_PARENT_RAW_PARSER');cache[txid]=t
 required=set();prevouts=set()
 for txid in origins:
  for i in cache[txid]['inputs']:
   if i['txid']=='0'*64:continue
   required.add(i['txid']);prevouts.add((i['txid'],i['vout']))
   if i['txid']in cache:need(type(i['vout'])is int and 0<=i['vout']<len(cache[i['txid']]['outputs']),'FINAL_CACHED_PREVOUT_RANGE')
 missing=sorted(required-set(cache));need(len(cache)==19704 and set_sha(cache)==CACHE_SHA and len(required)==REQUIRED_COUNT and len(prevouts)==PREVOUT_COUNT and len(missing)==REMAINING_COUNT and set_sha(missing)==REMAINING_SHA and len(origins)==TARGET_COUNT,'FINAL_COMPLETE_CACHE_DEMAND');return origins,cache,missing

def groups_for(origins,cache):
 groups={};heights={}
 for txid in sorted(origins):
  t=cache[txid];block=t.get('blockHash');need(isinstance(block,str) and L.TXID.fullmatch(block) and type(t.get('confirmationsAtCapture'))is int and t['confirmationsAtCapture']>0,'FINAL_CONFIRMED_CACHED_TARGET')
  hs={r['height'] for r in origins[txid]};need(len(hs)==1 and type(next(iter(hs)))is int and 0<next(iter(hs))<=R.CHECKPOINT['height'],'FINAL_TARGET_SOURCE_HEIGHT');height=next(iter(hs));need(block not in heights or heights[block]==height,'FINAL_BLOCK_HEIGHT_CONFLICT');heights[block]=height;groups.setdefault(block,[]).append(txid)
 need(len(groups)==GROUP_COUNT and sum((len(ids)+63)//64 for ids in groups.values())==BATCH_COUNT,'FINAL_EXACT_MEMBERSHIP_GROUPS');return groups,heights

def receive_bound(cap):return 2*(cap+OVERSHOOT)
class Budget:
 def __init__(self,rpc,deadline,groups,heights,missing,clock=time.monotonic):
  self.inner=rpc;self.deadline=deadline;self.clock=clock;self.groups=groups;self.heights=heights;self.missing=set(missing);self.outpoints=set();self.current_height=None;self.closing_calls=4+len(groups);self.closing_bytes=4*receive_bound(MAX_CHANNEL)+len(groups)*receive_bound(SMALL_REPLY)
 @property
 def calls(self):return self.inner.calls
 @property
 def bytes(self):return self.inner.bytes
 def cap(self,method):return SMALL_REPLY if method in('getblockhash','gettxout') else MEDIUM_REPLY if method in('getblockchaininfo','getblockheader') else MAX_CHANNEL
 def available(self,calls=1,bytes_=None):return self.calls+calls+self.closing_calls<=MAX_CALLS and self.bytes+(receive_bound(MAX_CHANNEL)if bytes_ is None else bytes_)+self.closing_bytes<=MAX_BYTES and self.clock()+20+CLOSING_SECONDS<self.deadline
 def call(self,method,*args,closing=False):
  need(method in('getblockchaininfo','getblockhash','getrawtransaction','getblockheader','gettxoutproof','verifytxoutproof','gettxout'),'FINAL_FIXED_RPC_METHODS')
  if method=='getblockchaininfo':need(not args,'FINAL_CHAININFO_ARGS')
  elif method=='getblockhash':need(len(args)==1 and type(args[0])is int and(args[0]in self.heights.values() or args[0]>=R.CHECKPOINT['height']),'FINAL_SOURCE_HEIGHT_SCOPE')
  elif method=='getrawtransaction':need(len(args)==2 and args[0]in self.missing and args[1]=='true' and not closing,'FINAL_PARENT_RAW_SCOPE')
  elif method=='getblockheader':need(len(args)==2 and args[0]in self.groups and args[1]in('true','false') and not closing,'FINAL_BLOCK_HEADER_SCOPE')
  elif method=='gettxoutproof':
   ids=json.loads(args[0],object_pairs_hook=pairs)if len(args)==2 else None;need(isinstance(ids,list) and 0<len(ids)<=64 and len(set(ids))==len(ids) and args[1]in self.groups and set(ids)<=set(self.groups[args[1]]) and not closing,'FINAL_BATCH_PROOF_SCOPE')
  elif method=='verifytxoutproof':need(len(args)==1 and isinstance(args[0],str) and len(args[0])<=2*MAX_CHANNEL and re.fullmatch('[0-9a-f]+',args[0]) and not closing,'FINAL_VERIFY_PROOF_SCOPE')
  else:need(len(args)==3 and(args[0],args[1])in self.outpoints and type(args[1])is int and type(args[2])is bool and not closing,'FINAL_DERIVED_OUTPOINT_SCOPE')
  need(self.calls<MAX_CALLS and self.bytes<=MAX_BYTES and self.clock()<self.deadline,'FINAL_RPC_OVERALL_BOUNDS')
  if not closing and not self.available(bytes_=receive_bound(self.cap(method))):raise Reserve('FINAL_ALL_CLOSING_RESERVE')
  # The exact frozen implementation is reused. Only stricter per-method channel
  # limits change temporarily; both pipes/64KiB overshoot stay cumulatively charged.
  old=L.MAX_RPC_BYTES
  try:L.MAX_RPC_BYTES=min(old,self.cap(method));return self.inner.call(method,*args)
  finally:L.MAX_RPC_BYTES=old

def record(out,field,key,value,spool):
 n=len(encoded(key))+len(encoded(value))+2
 if spool[0]+n+SPOOL_RESERVE>MAX_BYTES:raise Reserve('FINAL_OUTPUT_SPOOL_RESERVE')
 out[field][key]=value;spool[0]+=n

def membership(b,groups,heights,out,spool):
 verified=set()
 for block,ids in sorted(groups.items()):
  header,_=b.call('getblockheader',block,'true');raw,_=b.call('getblockheader',block,'false');canon,_=b.call('getblockhash',heights[block]);need(isinstance(header,dict) and type(header.get('height'))is int and header['height']==heights[block] and type(header.get('confirmations'))is int and header['confirmations']>0 and L.header_proof(raw)==canon==block,'FINAL_CANONICAL_HEADER')
  record(out,'blocks',block,dict(height=heights[block],headerHex=raw,canonicalHashAtCapture=canon),spool)
  for offset in range(0,len(ids),64):
   batch=ids[offset:offset+64];proof,proof_sha=b.call('gettxoutproof',json.dumps(batch,separators=(',',':')),block);core,_=b.call('verifytxoutproof',proof);ind=L.merkle_inclusion(proof);need(isinstance(core,list) and len(core)==len(set(core)) and sorted(core)==batch and len(ind['matchedTxids'])==len(set(ind['matchedTxids'])) and sorted(ind['matchedTxids'])==batch and ind['blockHash']==block and proof[:160]==raw,'FINAL_BATCH_CORE_OFFLINE_MERKLE')
   key=block+':'+str(offset//64);record(out,'membershipProofs',key,dict(blockHash=block,targetTxids=batch,proofHex=proof,proofResponseSha256=proof_sha,coreVerifiedTxids=core),spool);verified.update(batch)
 need(len(verified)==TARGET_COUNT and verified==set().union(*(set(v)for v in groups.values())),'FINAL_ALL_TARGET_MEMBERSHIP');return verified

def views_for(origins,cache):
 result=dict(transactions={k:cache[k] for k in origins},parents={k:t for k,t in cache.items()if k not in origins});views={};fee_count=None
 for address in T.ADDRESSES:
  v=T.outpoint_view(result,address);need(all(r['parentValuesComplete'] and(r['coinbase'] or type(r['feeProofs'])is int and r['feeProofs']>=0) for r in v['fees']),'FINAL_COMPLETE_INTEGER_PREVOUT_FEES');need(not v['pendingConflicts'] and v['pendingNetProofs']==0 and v['visibleUnspent']==v['confirmedUnspent'],'FINAL_CONFIRMED_HISTORY_VIEW');views[address]=v
  if fee_count is None:fee_count=len(v['fees'])
  need(len(v['fees'])==fee_count==TARGET_COUNT,'FINAL_FEE_TARGET_COVERAGE')
 return views

def outpoint_checks(b,seed,views,out,spool):
 candidates={k:value for v in views.values()for k,value in v['confirmedUnspent'].items()};b.outpoints=set(candidates)
 # Entire derived stage is admitted before its first request. No presumed546
 # outpoint, no unchecked scalar0 comparison, and no implicit next chunk.
 need(b.available(calls=2*len(candidates),bytes_=2*len(candidates)*receive_bound(SMALL_REPLY)),'FINAL_DERIVED_OUTPOINT_STAGE_BUDGET')
 for address in T.ADDRESSES:
  v=views[address];checks=[]
  for (txid,vout),value in sorted(v['confirmedUnspent'].items()):
   row=dict(txid=txid,vout=vout,valueProofs=value)
   for mempool in(False,True):
    core,h=b.call('gettxout',txid,vout,mempool)
    if core is None:raise T.MovingSnapshot('FINAL_DISCOVERY_OR_MEMPOOL_SPEND_STATE_CHANGED')
    if isinstance(core,dict) and core.get('bestblock')!=out['chainBefore']['hash']:raise T.MovingSnapshot('FINAL_OUTPOINT_SNAPSHOT_ADVANCED')
    need(isinstance(core,dict) and L.proofs(core.get('value'))==value and core.get('scriptPubKey',{}).get('hex')==L.address_script(address) and T.integer(core.get('confirmations'),1) and isinstance(core.get('bestblock'),str) and L.TXID.fullmatch(core['bestblock']) and core['bestblock']==out['chainBefore']['hash'],'FINAL_RECONSTRUCTED_UNSPENT_CORE_BINDING');row['mempoolAware'if mempool else'confirmed']=dict(bestBlock=core['bestblock'],responseSha256=h,confirmationsAtCapture=core['confirmations'])
   checks.append(row)
  expected={(r['tx_hash'],r['tx_pos']):r['value'] for r in seed['discovery'][address]['unspent']};need(expected==v['confirmedUnspent'] and seed['discovery'][address]['balance']['confirmed']==v['confirmedBalanceProofs'] and seed['discovery'][address]['balance']['unconfirmed']==v['pendingNetProofs'],'FINAL_COMPLETE_DISCOVERED_BALANCE_COMPARISON')
  record(out,'addressChecks',address,dict(createdCount=len(v['created']),directSpendCount=len(v['spent']),derivedConfirmedUnspent=T.serialize_outpoints(v['confirmedUnspent']),confirmedBalanceFromDiscoveredHistoryProofs=v['confirmedBalanceProofs'],pendingNetFromDiscoveredHistoryProofs=v['pendingNetProofs'],coreChecks=checks),spool)
 return len(candidates)

def collect(seed,origins,cache,missing,rpc,electrs,clock=time.monotonic):
 need(missing==sorted(set(missing)) and len(missing)==REMAINING_COUNT and set_sha(missing)==REMAINING_SHA,'FINAL_EXACT_REMAINING_PARENT_SET');groups,heights=groups_for(origins,cache);start=clock();deadline=start+SECONDS;b=Budget(rpc,deadline,groups,heights,missing,clock);spool=[0]
 out=dict(schema='pow-audit30-treasury-final-discovered-history-closure-v1',atUtc=dt.datetime.now(dt.timezone.utc).isoformat(),seedCorpusSha256=R.SEED_SHA,sourceTargetRawDeltaSha256=P0.DELTA_SHA,sourceParentChunk1Sha256=PARENT_SHA,sourceRawCacheSetSha256=CACHE_SHA,requestedParentCount=REMAINING_COUNT,requestedParentSetSha256=REMAINING_SHA,unionHistoryTargetCount=TARGET_COUNT,unionHistoryTargetSetSha256=R.TARGET_SET_SHA,newParents={},blocks={},membershipProofs={},addressChecks={},feeSummary=None,captureFailures=[],chainBefore=None,chainAfter=None,discoveryBefore=None,discoveryAfter=None,closingFencesAccepted=False,parentValuesComplete=False,targetCanonicalMembershipComplete=False,knownHistoryFeeAndDirectSpendCoverageAccepted=False,derivedUnspentCoreChecksComplete=False,knownHistoryBalanceComparisonAccepted=False,productionMutation=False,automaticRetry=False,automaticNextChunk=False,nextChunkAuthorized=False,financialReconciliationComplete=False,obligationReconciliationComplete=False,independentWholeChainAddressHistoryComplete=False,signingEligibilityVerified=False,may9OperatorSettlementPreserved=True,may9TransactionIDsRequested=False)
 opened=False;work_complete=False;verified=set();derived_count=None;views=None
 try:
  out['chainBefore']=R.chain(b.call('getblockchaininfo')[0]);need(b.call('getblockhash',R.CHECKPOINT['height'])[0]==R.CHECKPOINT['hash'],'FINAL_SAVED_PREFIX_CHANGED');out['discoveryBefore']=R.discovery(electrs,b,seed,out['chainBefore']['height']);opened=True;need(electrs.calls+R.CLOSING_ELECTRS_CALLS<=24 and electrs.bytes+R.CLOSING_ELECTRS_BYTES<=32*1024**2,'FINAL_ELECTRS_ALL_CLOSING_RESERVE')
  for txid in missing:
   verbose,h=b.call('getrawtransaction',txid,'true');t=L.normalize_verbose(verbose);need(t['txid']==txid and isinstance(t.get('blockHash'),str) and L.TXID.fullmatch(t['blockHash']) and type(t.get('confirmationsAtCapture'))is int and t['confirmationsAtCapture']>0,'FINAL_REMAINING_PARENT_RAW_IDENTITY');t['coreResponseSha256']=h;record(out,'newParents',txid,t,spool);cache[txid]=t
  verified=membership(b,groups,heights,out,spool);views=views_for(origins,cache);first=next(iter(views.values()));fees=first['fees'];out['feeSummary']=dict(targetCount=len(fees),coinbaseCount=sum(r['coinbase']for r in fees),nonCoinbaseFeeProofs=sum(r['feeProofs']for r in fees if not r['coinbase']),feeRowsSha256=sha(encoded(fees)),requiredParentCount=REQUIRED_COUNT,uniquePrevoutCount=PREVOUT_COUNT);derived_count=outpoint_checks(b,seed,views,out,spool);work_complete=True
 except Exception as ex:out['captureFailures'].append(R.failure('bounded-acquisition-membership-arithmetic',ex))
 if opened:
  try:
   closing_deadline=min(deadline,clock()+CLOSING_SECONDS)
   if hasattr(rpc,'inner')and hasattr(rpc.inner,'deadline'):rpc.inner.deadline=min(rpc.inner.deadline,closing_deadline)
   electrs.deadline=min(electrs.deadline,closing_deadline)
   out['chainAfter']=R.chain(b.call('getblockchaininfo',closing=True)[0]);need(out['chainAfter']['height']>=out['chainBefore']['height'] and b.call('getblockhash',R.CHECKPOINT['height'],closing=True)[0]==R.CHECKPOINT['hash'] and b.call('getblockhash',out['chainBefore']['height'],closing=True)[0]==out['chainBefore']['hash'],'FINAL_SAVED_OR_OPENING_FORK_CHANGED')
   for block in sorted(groups):
    canon,_=b.call('getblockhash',heights[block],closing=True);need(canon==block,'FINAL_HISTORICAL_CANONICAL_CLOSING_CHANGED')
    if block in out['blocks']:out['blocks'][block]['canonicalHashAfter']=canon
   out['discoveryAfter']=R.discovery(electrs,b,seed,out['chainAfter']['height'],closing=True);out['closingFencesAccepted']=True
  except Exception as ex:out['captureFailures'].append(R.failure('closing-fence',ex))
 complete=work_complete and out['closingFencesAccepted'] and not out['captureFailures']
 if complete:
  # Fulltarget/matchingparentspend proof establishes removal of knownspent
  # outputs. Core checks apply only to the independentlyderived remainder.
  out.update(parentValuesComplete=True,targetCanonicalMembershipComplete=True,knownHistoryFeeAndDirectSpendCoverageAccepted=True,derivedUnspentCoreChecksComplete=True,knownHistoryBalanceComparisonAccepted=True,balanceSnapshot=out['chainBefore'])
 remaining=set(missing)-set(out['newParents']);out['coverage']=dict(requestedParents=REMAINING_COUNT,acquiredParents=len(out['newParents']),remainingParents=len(remaining),acquiredParentSetSha256=set_sha(out['newParents']),remainingParentSetSha256=set_sha(remaining),targetCount=TARGET_COUNT,canonicalTargetProofs=len(verified),blockGroups=len(out['blocks']),batchProofs=len(out['membershipProofs']),derivedUnspentCount=derived_count,coreCalls=b.calls,coreBytes=b.bytes,electrsCalls=electrs.calls,electrsBytes=electrs.bytes,openingPrefixCoreCalls=3,closingReservedCoreCalls=b.closing_calls,closingReservedCoreBytes=b.closing_bytes,closingReservedElectrsCalls=R.CLOSING_ELECTRS_CALLS,closingReservedElectrsBytes=R.CLOSING_ELECTRS_BYTES,closingReservedSeconds=CLOSING_SECONDS,wholeSeconds=clock()-start,serializedRecordsBytes=spool[0],spoolReservedBytes=SPOOL_RESERVE)
 out['status']='discovered-history-closure-complete-with-closing-fences'if complete else'partial-discovered-history-closure';out['qualification']='Exactly the saved10232 confirmed discovery targets and their22264 unique immediate prevout parents. Fresh canonical headers, full batch Core/offlineMerkle target membership, integer prevouts/fees/directspends, derived remainder and unchanged discovery comparison only. Stable opening/saved prefixes and all567 historical closing hashes required. Parent output values are raw transaction commitments; individual parent canonical membership/fullgenesis, independent wholeaddress history, unknown obligations/May9 IDs and signing are not certified. Balance proof is scoped to the common gettxout opening-block snapshot retained by the closing prefix, not an unqualified latest-balance claim. Mempool visibility is best effort; 180s closing is a hard deadline, not a guarantee every call finishes.';need(b.calls<=MAX_CALLS and b.bytes<=MAX_BYTES,'FINAL_RPC_TOTALS');need(len(encoded(out))+1<=MAX_BYTES,'FINAL_SERIALIZED_RESULT_CAP');return out

def main():
 need(sys.flags.isolated and len(sys.argv)==1 and(os.geteuid(),os.getegid())==(pwd.getpwnam('bitcoin').pw_uid,988),'FINAL_NATIVE_BITCOIN_ROLE');base=P(__file__).parent;s=base.lstat();need(P(__file__).name=='collector.py' and base.resolve(strict=True)==base and re.fullmatch('/usr/local/lib/proofofwork-audit30-treasury-final-closure/[0-9]{8}T[0-9]{6}Z',str(base)) and stat.S_ISDIR(s.st_mode) and(s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))==(0,988,0o750) and set(x.name for x in base.iterdir())=={'collector.py','parent-chunk1-corpus.json'} and not os.listxattr(base,follow_symlinks=False),'FINAL_EXACT_NEW_PACKAGE');stamp=ident(s);seed,origins,cache,missing,proof=load(base);old={sig:signal.signal(sig,R.operator_interrupted)for sig in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 try:
  out=collect(seed,origins,cache,missing,T.CoreRPC(),T.Electrs(time.monotonic()+SECONDS));need(ident(base.lstat())==stamp and ident(OLD.lstat())==proof['old'] and ident((OLD/'collector.py').lstat())==proof['source'] and ident((OLD/'completed-raw-target-delta.json').lstat())==proof['targetDelta'] and ident((base/'parent-chunk1-corpus.json').lstat())==proof['parentDelta'] and ident(P0.OLD.lstat())==proof['originalPackage'] and all(ident((P0.OLD/k).lstat())==v for k,v in proof['originalFiles'].items()),'FINAL_ALL_SOURCE_CUSTODY');sys.stdout.buffer.write(encoded(out)+b'\n');return 0 if out['status']=='discovered-history-closure-complete-with-closing-fences'else 2
 finally:
  for sig,h in old.items():signal.signal(sig,h)
if __name__=='__main__':
 try:status=main()
 except BaseException as ex:print(json.dumps(dict(schema='pow-audit30-final-treasury-admission-refused-v1',errorClass=type(ex).__name__,reasonSha256=sha(str(ex).encode()),productionMutation=False,automaticRetry=False)),file=sys.stderr);status=1
 raise SystemExit(status)
