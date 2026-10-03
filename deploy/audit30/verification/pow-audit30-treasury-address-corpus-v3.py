#!/usr/bin/python3 -I
"""Bounded read-only discovery/Core checks for three documented treasury scripts.
Electrs is a discovery index, not an independent full-chain address scan. Never
infer complete liabilities, payout history, signing eligibility or wallet custody.
"""
import argparse,datetime as dt,decimal,hashlib,json,os,pwd,re,selectors,signal,socket,stat,subprocess,sys,time,types
from pathlib import Path
LEDGER_SHA='c37fb22836172254baaa8d2da125ff97fa25d7c955a0afa4c6b72accbe29cef7'
ADDRESSES=('1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT','1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x','1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv')
SERVER=('172.27.0.1',50001);MAX_HISTORY=5000;MAX_TARGETS=12000;MAX_JSON=256*1024**2;MAX_ELECTRS_LINE=2*1024**2;MAX_ELECTRS_TOTAL=32*1024**2;MAX_CORE_CALLS=10000;SECONDS=1200
L=None;INTERRUPTED=None

def need(ok,msg):
 if not ok:raise ValueError(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def utc():return dt.datetime.now(dt.timezone.utc).isoformat()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'Duplicate JSON key');d[k]=v
 return d
def integer(v,minimum=0,maximum=2100000000000000):return type(v)is int and minimum<=v<=maximum
def load_ledger():
 global L
 p=Path(__file__).parent/'ledger-corpus-v2.py';s=p.lstat();identity=lambda v:(v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_gid,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
 need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=262144,'Unsafe immutable ledger utility')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:need(identity(os.fstat(f.fileno()))==identity(s),'Ledger open drift');raw=f.read(262145);need(identity(os.fstat(f.fileno()))==identity(s),'Ledger read drift')
 need(identity(p.lstat())==identity(s) and sha(raw)==LEDGER_SHA,'Frozen ledger source changed');L=types.ModuleType('audit30-ledger');L.__file__=str(p);exec(compile(raw,str(p),'exec'),L.__dict__)
 # This NEW collector has its own explicit bounded broader discovery budget;
 # the original 166-target collector/source and expectations remain unchanged.
 L.MAX_CALLS=MAX_CORE_CALLS
 return L

class MovingSnapshot(ValueError):pass

class CoreRPC:
 def __init__(self):self.inner=L.RPC()
 @property
 def calls(self):return self.inner.calls
 @property
 def bytes(self):return self.inner.bytes
 def call(self,method,*args):
  L._OPERATOR_INTERRUPTED=INTERRUPTED
  if method!='gettxout':return self.inner.call(method,*args)
  need(len(args)==3 and isinstance(args[0],str)and L.TXID.fullmatch(args[0])and integer(args[1],0,100000) and type(args[2])is bool,'Exact read-only gettxout arguments')
  r=self.inner
  if INTERRUPTED is not None:raise L.RPCFailure('operator-interrupted',method,args)
  if r.calls>=MAX_CORE_CALLS:raise L.RPCFailure('call-count',method,args)
  if time.monotonic()>=r.deadline:raise L.RPCFailure('overall-deadline',method,args)
  r.calls+=1;need(os.geteuid()==pwd.getpwnam('bitcoin').pw_uid,'Native bitcoin role required; no privilege switching')
  cmd=['/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf','gettxout',args[0],str(args[1]),'true'if args[2]else'false'];p=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},cwd='/');sel=selectors.DefaultSelector();out=bytearray();err=bytearray();deadline=min(r.deadline,time.monotonic()+20)
  try:
   for stream,b in ((p.stdout,out),(p.stderr,err)):os.set_blocking(stream.fileno(),False);sel.register(stream,selectors.EVENT_READ,b)
   while sel.get_map():
    if INTERRUPTED is not None:raise L.RPCFailure('operator-interrupted',method,args,sha(err),sha(out))
    if time.monotonic()>=deadline:raise L.RPCFailure('call-timeout',method,args,sha(err),sha(out))
    for k,_ in sel.select(.2):
     raw=os.read(k.fd,65536)
     if not raw:sel.unregister(k.fileobj)
     else:
      r.bytes+=len(raw);k.data.extend(raw)
      if r.bytes>L.MAX_TOTAL_BYTES or len(k.data)>L.MAX_RPC_BYTES:raise L.RPCFailure('cumulative-bound'if r.bytes>L.MAX_TOTAL_BYTES else'response-bound',method,args,sha(err),sha(out))
   code=p.wait(timeout=max(.01,deadline-time.monotonic()))
   if code:
    m=re.search(rb'error code:\s*(-?[0-9]+)',err);raise L.RPCFailure('core-refusal',method,args,sha(err),sha(out),code,int(m[1])if m else None)
   if not out.strip():
    if err.strip():raise L.RPCFailure('response-decoding',method,args,sha(err),sha(out))
    # bitcoin-cli emits no text for a successful null gettxout result.
    return None,sha(out)
   try:return json.loads(out,parse_float=decimal.Decimal,object_pairs_hook=pairs),sha(out)
   except (json.JSONDecodeError,UnicodeError)as ex:raise L.RPCFailure('response-decoding',method,args,sha(err),sha(out))from ex
  except subprocess.TimeoutExpired as ex:raise L.RPCFailure('call-timeout',method,args,sha(err),sha(out))from ex
  except OSError as ex:raise L.RPCFailure('transport-os-error',method,args,sha(err),sha(out))from ex
  finally:
   if p.poll()is None:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    p.wait(timeout=10)
   sel.close();p.stdout.close();p.stderr.close()

class Electrs:
 def __init__(self,deadline):self.deadline=deadline;self.calls=0;self.bytes=0
 def call(self,method,*args):
  need(method in ('blockchain.headers.subscribe','blockchain.scripthash.get_history','blockchain.scripthash.listunspent','blockchain.scripthash.get_balance'),'Electrs method not read-only admitted')
  if INTERRUPTED is not None:raise TimeoutError('operator-interrupted')
  need(self.calls<24 and time.monotonic()<self.deadline,'Electrs call/deadline bound');self.calls+=1;request=json.dumps(dict(jsonrpc='2.0',id=self.calls,method=method,params=list(args)),separators=(',',':')).encode()+b'\n';out=bytearray()
  with socket.create_connection(SERVER,timeout=min(10,max(.01,self.deadline-time.monotonic())))as s:
   s.sendall(request)
   while b'\n'not in out:
    if INTERRUPTED is not None or time.monotonic()>=self.deadline:raise TimeoutError('Electrs deadline/operator interruption')
    s.settimeout(min(10,max(.01,self.deadline-time.monotonic())));raw=s.recv(65536);need(raw,'Electrs response EOF');out.extend(raw);self.bytes+=len(raw);need(len(out)<=MAX_ELECTRS_LINE and self.bytes<=MAX_ELECTRS_TOTAL,'Electrs response/cumulative byte bound')
  line,tail=bytes(out).split(b'\n',1);need(not tail.strip(),'Electrs trailing response');v=json.loads(line,object_pairs_hook=pairs);need(isinstance(v,dict)and v.get('id')==self.calls and not v.get('error')and 'result'in v,'Electrs typed response failure');return v['result'],sha(line)

def validate_history(rows,tip):
 need(isinstance(rows,list)and len(rows)<=MAX_HISTORY,'Complete history response bound');seen=set()
 for r in rows:
  need(isinstance(r,dict)and set(r)=={'tx_hash','height'}and isinstance(r['tx_hash'],str)and L.TXID.fullmatch(r['tx_hash'])and r['tx_hash']not in seen and integer(r['height'],-1,2147483647),'History identity/height/duplicates');seen.add(r['tx_hash'])
  if r['height']>tip:raise MovingSnapshot('Address history advanced beyond captured checkpoint')
 return sorted(rows,key=lambda x:(x['height'],x['tx_hash']))
def validate_unspent(rows,tip):
 need(isinstance(rows,list)and len(rows)<=MAX_HISTORY,'Unspent response bound');seen=set()
 for r in rows:
  need(isinstance(r,dict)and set(r)=={'tx_hash','tx_pos','height','value'}and isinstance(r['tx_hash'],str)and L.TXID.fullmatch(r['tx_hash'])and integer(r['tx_pos'],0,100000)and integer(r['height'],0,2147483647)and integer(r['value']),'Unspent identity/value/height')
  if r['height']>tip:raise MovingSnapshot('Address unspent set advanced beyond captured checkpoint')
  key=(r['tx_hash'],r['tx_pos']);need(key not in seen,'Duplicate unspent outpoint');seen.add(key)
 return sorted(rows,key=lambda r:(r['tx_hash'],r['tx_pos']))
def validate_balance(v):need(isinstance(v,dict)and set(v)=={'confirmed','unconfirmed'}and integer(v['confirmed'])and integer(v['unconfirmed'],-2100000000000000),'Exact integer Electrs balance');return v

def failure(result,phase,ex,txid=None,address=None):
 row=dict(phase=phase,txid=txid,address=address,errorClass=type(ex).__name__,kind='moving-snapshot'if isinstance(ex,MovingSnapshot)else'rpc-unavailable'if isinstance(ex,L.RPCFailure)or isinstance(ex,(TimeoutError,OSError))else'integrity-refused')
 if isinstance(ex,L.RPCFailure):row.update(ex.row)
 else:row['reasonSha256']=sha(str(ex).encode())
 result['captureFailures'].append(row);return row

def capture_transaction(txid,rpc,result,parent=False):
 target=result['parents']if parent else result['transactions']
 if txid in target:return target[txid]
 v,h=rpc.call('getrawtransaction',txid,'true');t=L.normalize_verbose(v);need(t['txid']==txid,'Requested raw/Core transaction identity');t['coreResponseSha256']=h;target[txid]=t
 if t['blockHash']and t['confirmationsAtCapture']>0:
  block=t['blockHash']
  if block not in result['blocks']:
   header,_=rpc.call('getblockheader',block,'true');raw,_=rpc.call('getblockheader',block,'false');canon,_=rpc.call('getblockhash',header['height']);need(canon==block==L.header_proof(raw)and header['confirmations']>0,'Canonical historical header');result['blocks'][block]=dict(height=header['height'],headerHex=raw,canonicalHashAtCapture=canon)
  if not parent:
   proof,h=rpc.call('gettxoutproof',json.dumps([txid],separators=(',',':')),block);verified,_=rpc.call('verifytxoutproof',proof);ind=L.merkle_inclusion(proof);need(verified==[txid]and ind['matchedTxids']==[txid]and ind['blockHash']==block,'Core/independent Merkle inclusion');t.update(coreInclusionProofHex=proof,coreInclusionProofResponseSha256=h,coreVerifiedIncludedTxids=verified)
 return t

def outpoint_view(result,address):
 script=L.address_script(address);created={};spent={};pending_created={};pending_spent={};pending_conflicts=[];fees=[];alltx=result['parents']|result['transactions'];findings=[]
 for txid,t in result['transactions'].items():
  confirmed=bool(t.get('blockHash')and t.get('confirmationsAtCapture',0)>0);cm=created if confirmed else pending_created;sm=spent if confirmed else pending_spent
  for o in t['outputs']:
   if o['scriptPubKey']==script:cm[(txid,o['vout'])]=o['proofs']
  seen=set();ins=[];missing=[];coinbase=False
  for i in t['inputs']:
   key=(i['txid'],i['vout']);need(key not in seen,'Duplicate transaction input');seen.add(key)
   if i['txid']=='0'*64:coinbase=True;continue
   p=alltx.get(i['txid'])
   if p is None:missing.append(i['txid']);continue
   need(0<=i['vout']<len(p['outputs']),'Input prevout range');o=p['outputs'][i['vout']];ins.append(o['proofs'])
   if o['scriptPubKey']==script:
    if confirmed:need(key not in sm,'Discovered canonical duplicate spend')
    elif key in sm:pending_conflicts.append(dict(txid=txid,otherTxid=sm[key],prevTxid=key[0],prevVout=key[1]))
    sm[key]=txid
  fee=None if missing or coinbase else sum(ins)-sum(o['proofs']for o in t['outputs']);need(fee is None or fee>=0,'Negative transaction fee');fees.append(dict(txid=txid,canonical=confirmed,coinbase=coinbase,parentValuesComplete=not missing,feeProofs=fee,missingParentTxids=sorted(set(missing))))
 confirmed_unspent={k:v for k,v in created.items()if k not in spent};visible_unspent={k:v for k,v in (confirmed_unspent|pending_created).items()if k not in pending_spent}
 confirmed_balance=sum(created.values())-sum(alltx[k[0]]['outputs'][k[1]]['proofs']for k in spent)
 pending_net=sum(pending_created.values())-sum(alltx[k[0]]['outputs'][k[1]]['proofs']for k in pending_spent)
 return dict(created=created,allCreated=created|pending_created,pendingConflicts=pending_conflicts,spent=spent,confirmedUnspent=confirmed_unspent,visibleUnspent=visible_unspent,confirmedBalanceProofs=confirmed_balance,pendingNetProofs=pending_net,fees=fees)

def serialize_outpoints(rows):return[dict(txid=k[0],vout=k[1],valueProofs=v)for k,v in sorted(rows.items())]
def compare_address(result,address,rpc):
 d=result['discovery'][address];view=outpoint_view(result,address);findings=[dict(field='ConflictingPendingAddressSpends',classification='best-effort-mempool-conflict',**r)for r in view['pendingConflicts']];checks=[]
 expected={(r['tx_hash'],r['tx_pos']):r['value']for r in d['unspent']};actual=view['visibleUnspent']
 if expected!=actual:findings.append(dict(field='ElectrsVisibleUnspentOutpoints',expected=serialize_outpoints(expected),actual=serialize_outpoints(actual),classification='address-history/mempool-capture-discrepancy'))
 if d['balance']['confirmed']!=view['confirmedBalanceProofs']:findings.append(dict(field='ElectrsConfirmedBalanceProofs',expected=d['balance']['confirmed'],actual=view['confirmedBalanceProofs'],classification='discovered-history/address-balance-discrepancy'))
 if d['balance']['unconfirmed']!=view['pendingNetProofs']:findings.append(dict(field='ElectrsPendingNetProofs',expected=d['balance']['unconfirmed'],actual=view['pendingNetProofs'],classification='best-effort-mempool-discrepancy'))
 for (txid,vout),value in sorted(view['allCreated'].items()):
  row=dict(txid=txid,vout=vout,valueProofs=value,canonicalUnspentExpected=(txid,vout)in view['confirmedUnspent'])
  try:
   core,_=rpc.call('gettxout',txid,vout,False);row['coreConfirmedUnspent']=core is not None
   if core is not None:need(L.proofs(core['value'])==value and core['scriptPubKey']['hex']==L.address_script(address)and integer(core['confirmations'],1),'Core outpoint exact script/value/confirmation');row['confirmationsAtCapture']=core['confirmations']
   if row['coreConfirmedUnspent']!=row['canonicalUnspentExpected']:findings.append(dict(field='CoreConfirmedOutpointSpentState',txid=txid,vout=vout,expected=row['canonicalUnspentExpected'],actual=row['coreConfirmedUnspent'],classification='discovery/history-spend-coverage-discrepancy'))
   visible,_=rpc.call('gettxout',txid,vout,True);row['coreMempoolVisibleUnspent']=visible is not None
   if visible is not None:need(L.proofs(visible['value'])==value and visible['scriptPubKey']['hex']==L.address_script(address),'Core mempool-aware script/value')
   if row['coreMempoolVisibleUnspent']!=((txid,vout)in actual):findings.append(dict(field='CoreMempoolVisibleOutpoint',txid=txid,vout=vout,expected=(txid,vout)in actual,actual=row['coreMempoolVisibleUnspent'],classification='best-effort-mempool-discrepancy'))
  except (L.RPCFailure,ValueError,KeyError,TypeError,OSError)as ex:failure(result,'outpoint',ex,txid,address);row['verified']=False
  else:row['verified']=True
  checks.append(row)
 return dict(address=address,confirmedBalanceFromDiscoveredCorpusProofs=view['confirmedBalanceProofs'],pendingNetFromDiscoveredCorpusProofs=view['pendingNetProofs'],confirmedUnspent=serialize_outpoints(view['confirmedUnspent']),visibleUnspent=serialize_outpoints(actual),coreOutpointChecks=checks,findings=findings,feeChecks=view['fees'])

def collect(rpc=None,electrs=None):
 rpc=rpc or CoreRPC();electrs=electrs or Electrs(time.monotonic()+SECONDS);result=dict(schema='pow-audit30-treasury-address-corpus-v1',atUtc=utc(),addresses=list(ADDRESSES),productionMutation=False,discovery={},transactions={},parents={},blocks={},captureFailures=[],addressComparisons=[],historyAfter={},chainBefore=None,chainAfter=None,historyCompletenessIndependentOfElectrs=False,financialReconciliationComplete=False,obligationReconciliationComplete=False,may9OperatorConfirmedPaid=True,may9TransactionIDsRequested=False);stop=False
 try:
  c,_=rpc.call('getblockchaininfo');need(c['chain']=='main','Main chain required');result['chainBefore']=dict(height=c['blocks'],hash=c['bestblockhash']);header,_=electrs.call('blockchain.headers.subscribe');need(integer(header['height'])and L.header_proof(header['hex'])==rpc.call('getblockhash',header['height'])[0],'Electrs canonical checkpoint');result['electrsBefore']=dict(height=header['height'],hash=L.header_proof(header['hex']))
 except (L.RPCFailure,ValueError,KeyError,TypeError,OSError)as ex:failure(result,'initial-fence',ex);stop=True
 targets={}
 for address in ADDRESSES:
  if stop:break
  try:
   scripthash=hashlib.sha256(bytes.fromhex(L.address_script(address))).digest()[::-1].hex();history,hh=electrs.call('blockchain.scripthash.get_history',scripthash);unspent,uh=electrs.call('blockchain.scripthash.listunspent',scripthash);balance,bh=electrs.call('blockchain.scripthash.get_balance',scripthash);history=validate_history(history,result['chainBefore']['height']);result['discovery'][address]=dict(scripthash=scripthash,history=history,unspent=validate_unspent(unspent,result['chainBefore']['height']),balance=validate_balance(balance),responseSha256=dict(history=hh,unspent=uh,balance=bh))
   for r in history:targets.setdefault(r['tx_hash'],[]).append(dict(address=address,height=r['height']))
   need(len(targets)<=MAX_TARGETS,'Complete union target count bound')
  except (L.RPCFailure,ValueError,KeyError,TypeError,OSError)as ex:failure(result,'discovery',ex,address=address)
 for txid,origins in sorted(targets.items()):
  if stop:break
  try:
   t=capture_transaction(txid,rpc,result);t['discoveredOrigins']=origins
   for i in t['inputs']:
    if i['txid']=='0'*64:continue
    if i['txid']not in result['transactions']and i['txid']not in result['parents']:
     try:capture_transaction(i['txid'],rpc,result,True)
     except (L.RPCFailure,ValueError,KeyError,TypeError,OSError)as ex:failure(result,'parent',ex,i['txid']);stop=isinstance(ex,L.RPCFailure)and ex.resource
  except (L.RPCFailure,ValueError,KeyError,TypeError,OSError)as ex:failure(result,'transaction',ex,txid);stop=isinstance(ex,L.RPCFailure)and ex.resource
 for address in ADDRESSES:
  if address not in result['discovery']:continue
  try:result['addressComparisons'].append(compare_address(result,address,rpc))
  except (ValueError,KeyError,TypeError,L.RPCFailure,OSError)as ex:failure(result,'address-integer-oracle',ex,address=address)
  try:
   rows,_=electrs.call('blockchain.scripthash.get_history',result['discovery'][address]['scripthash']);result['historyAfter'][address]=validate_history(rows,max(result['chainBefore']['height'],result.get('electrsBefore',{}).get('height',0)))
  except (ValueError,KeyError,TypeError,L.RPCFailure,OSError)as ex:failure(result,'discovery-after',ex,address=address)
 for block,b in result['blocks'].items():
  try:after,_=rpc.call('getblockhash',b['height']);need(after==block,'Canonical historical block changed');b['canonicalHashAfter']=after
  except (L.RPCFailure,ValueError,KeyError,TypeError,OSError)as ex:failure(result,'historical-block-after',ex)
 try:
  c,_=rpc.call('getblockchaininfo');need(c['chain']=='main'and rpc.call('getblockhash',result['chainBefore']['height'])[0]==result['chainBefore']['hash'],'Initial canonical prefix changed');result['chainAfter']=dict(height=c['blocks'],hash=c['bestblockhash']);e,_=electrs.call('blockchain.headers.subscribe');need(L.header_proof(e['hex'])==rpc.call('getblockhash',e['height'])[0],'Final Electrs/Core checkpoint');result['electrsAfter']=dict(height=e['height'],hash=L.header_proof(e['hex']))
 except (L.RPCFailure,ValueError,KeyError,TypeError,OSError)as ex:failure(result,'final-fence',ex)
 result['coverage']=dict(addressesExpected=3,discoveredAddressResponses=len(result['discovery']),unionTargetTxids=len(targets),targetRawCaptured=len(result['transactions']),parentRawCaptured=len(result['parents']),historicalBlocks=len(result['blocks']),coreCalls=rpc.calls,coreBytes=rpc.bytes,electrsCalls=electrs.calls,electrsBytes=electrs.bytes)
 result['oracle']=verify(result);result['status']=result['oracle']['status'];return result

def verify(result):
 need(result['schema']=='pow-audit30-treasury-address-corpus-v1'and result['addresses']==list(ADDRESSES),'Fixed treasury corpus scope');errors=[];canonical=0;pending=0;alltx=result['parents']|result['transactions'];findings=[dict(address=a['address'],**f)for a in result['addressComparisons']for f in a['findings']];fees=[]
 for txid,t in alltx.items():
  try:
   p=L.parse_raw(t['rawHex']);need(p['txid']==txid==t['txid']and p['inputs']==t['inputs']and p['outputs']==t['outputs']and p['rawBytesSha256']==t['rawBytesSha256'],'Full captured raw parser equality')
   if txid not in result['transactions']:continue
   if t['blockHash']and t['confirmationsAtCapture']>0:
    b=result['blocks'][t['blockHash']];proof=L.merkle_inclusion(t['coreInclusionProofHex']);need(L.header_proof(b['headerHex'])==t['blockHash']==b['canonicalHashAtCapture']==b['canonicalHashAfter']and proof['blockHash']==t['blockHash']and proof['matchedTxids']==t['coreVerifiedIncludedTxids']==[txid],'Full offline canonical/Merkle equality');canonical+=1
    for origin in t['discoveredOrigins']:
     if origin['height']!=b['height']:findings.append(dict(address=origin['address'],txid=txid,field='ElectrsHistoryHeight',expected=origin['height'],actual=b['height'],classification='discovery-index-status-discrepancy'))
   else:
    pending+=1
    for origin in t['discoveredOrigins']:
     if origin['height']>0:findings.append(dict(address=origin['address'],txid=txid,field='ElectrsConfirmedStatus',expected='confirmed',actual='Core-pending-or-noncanonical',classification='discovery-index-status-discrepancy'))
  except (ValueError,KeyError,TypeError)as ex:errors.append(dict(txid=txid,errorClass=type(ex).__name__,reasonSha256=sha(str(ex).encode())))
 histories_stable=len(result['historyAfter'])==3 and all(result['historyAfter'].get(a)==result['discovery'].get(a,{}).get('history')for a in ADDRESSES);hard=bool(errors)or any(f['kind']=='integrity-refused'or f.get('category')in('overall-deadline','call-count','response-bound','cumulative-bound','operator-interrupted')for f in result['captureFailures']);complete=(not hard and not result['captureFailures']and len(result['discovery'])==len(result['addressComparisons'])==3 and histories_stable and bool(result['chainBefore'])and bool(result['chainAfter']))
 return dict(status='covered-discovery-corpus-complete-with-findings'if complete and findings else'covered-discovery-corpus-complete'if complete else'partial-integrity-refused'if hard else'partial-discovery-rpc-or-moving-snapshot',canonicalTargetTransactionsVerified=canonical,pendingRawTargetsObserved=pending,offlineIntegrityErrors=errors,captureFailureCount=len(result['captureFailures']),historicalDiscoveryResponsesStable=histories_stable,findings=findings,allReturnedAddressResponsesAndCoveredOutpointsCompared=complete,independentWholeChainAddressHistoryComplete=False,completeFinancialOrObligationReconciliation=False,signingEligibilityVerified=False,may9OperatorSettlementPreserved=True,qualification='Only three documented treasury scripts and complete bounded Electrs responses are covered. Core verifies discovered raw transactions, Merkle inclusion, integer prevouts/fees and outpoint states; Electrs discovery completeness is not independently proven. Pending data can move. No full obligation/wallet ownership/private signing/recovery-page certificate or historical record change.')

def main():
 global INTERRUPTED
 need(len(sys.argv)==1 and sys.flags.isolated and os.geteuid()==pwd.getpwnam('bitcoin').pw_uid,'Isolated native bitcoin read-only unit required');load_ledger();old={}
 def interrupted(signum,frame):
  global INTERRUPTED
  INTERRUPTED=signum;L._OPERATOR_INTERRUPTED=signum
 for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):old[s]=signal.signal(s,interrupted)
 try:v=collect();raw=(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode();need(len(raw)<=MAX_JSON,'Final corpus serialization bound');sys.stdout.buffer.write(raw);return 2 if v['oracle']['status']=='partial-integrity-refused'else 0
 finally:
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:status=main()
 except BaseException as ex:print(json.dumps(dict(schema='pow-audit30-treasury-address-corpus-admission-refusal-v1',errorClass=type(ex).__name__,productionMutation=False,privateErrorSha256=sha(str(ex).encode()))),file=sys.stderr);status=1
 raise SystemExit(status)
