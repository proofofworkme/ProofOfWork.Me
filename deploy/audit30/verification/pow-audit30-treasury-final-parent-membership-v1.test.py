import copy,decimal,hashlib,importlib.util,json,os,pathlib,signal,struct,subprocess,sys,threading,time,types,unittest
from unittest import mock

def module(p,n):
 s=importlib.util.spec_from_file_location(n,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
M=module('/tmp/pow-audit30-treasury-final-parent-membership-v1.py','final_source')
P0=module('/tmp/pow-audit30-treasury-missing-parents-chunk1-v1.py','frozen19a')
R=module('/tmp/pow-audit30-treasury-missing-raw-targets-v1.py','frozen02fc')
T=module('/tmp/pow-audit30-treasury-address-corpus-v3.py','frozenb60')
L=module('/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py','frozenc37')
M.P0=P0;M.R=R;M.T=T;M.L=L;R.T=T;R.L=L;T.L=L

def tx(prev='0'*64,vout=4294967295,value=546,script=None):
 script=bytes.fromhex(script or L.address_script(T.ADDRESSES[2]));raw=bytes.fromhex('0100000001')+bytes.fromhex(prev)[::-1]+struct.pack('<I',vout)+b'\0'+b'\xff'*4+b'\x01'+struct.pack('<Q',value)+bytes([len(script)])+script+b'\0'*4
 return L.parse_raw(raw.hex())
def proof_for(ids):
 leaves=[bytes.fromhex(t)[::-1] for t in ids];bits=[];hashes=[]
 def width(h):return(len(leaves)+(1<<h)-1)>>h
 def node(h,p):
  bits.append(1)
  if h==0:hashes.append(leaves[p]);return leaves[p]
  left=node(h-1,p*2);right=node(h-1,p*2+1)if p*2+1<width(h-1)else left;return L.dsha(left+right)
 height=0
 while width(height)>1:height+=1
 root=node(height,0);header=bytes.fromhex('01000000')+b'\0'*32+root+b'\0'*12;flags=bytearray((len(bits)+7)//8)
 for i,b in enumerate(bits):flags[i//8]|=b<<(i%8)
 proof=(header+struct.pack('<I',len(ids))+bytes([len(hashes)])+b''.join(hashes)+bytes([len(flags)])+flags).hex();return header.hex(),proof

def fixture():
 p1=tx(value=1111,script='51');p2=tx(value=1112,script='51');coinbase=tx();children=[tx(p['txid'],0,500)for p in(p1,p2)];targets={t['txid']:t for t in[coinbase,*children]};ids=sorted(targets);header,proof=proof_for(ids);block=L.header_proof(header)
 for t in[coinbase,*children,p1,p2]:t.update(blockHash=block,confirmationsAtCapture=1)
 cache={**targets,p1['txid']:p1};origins={k:[dict(address=T.ADDRESSES[2],height=100)]for k in ids};hist=[dict(tx_hash=k,height=100)for k in ids];discovery={}
 for a in T.ADDRESSES:
  rows=[dict(tx_hash=k,tx_pos=0,height=100,value=t['outputs'][0]['proofs'])for k,t in targets.items()]if a==T.ADDRESSES[2]else[];rows=sorted(rows,key=lambda r:(r['tx_hash'],r['tx_pos']))
  discovery[a]=dict(scripthash=hashlib.sha256(bytes.fromhex(L.address_script(a))).digest()[::-1].hex(),history=hist if a==T.ADDRESSES[2]else[],unspent=rows,balance=dict(confirmed=sum(r['value']for r in rows),unconfirmed=0))
 seed=dict(discovery=discovery);missing=[p2['txid']];return seed,origins,cache,missing,p2,header,proof,block

def verbose(t):return dict(txid=t['txid'],hex=t['rawHex'],vin=[dict(coinbase='00')if i['txid']=='0'*64 else dict(txid=i['txid'],vout=i['vout'])for i in t['inputs']],vout=[dict(n=o['vout'],value=decimal.Decimal(o['proofs'])/100000000,scriptPubKey=dict(hex=o['scriptPubKey']))for o in t['outputs']],blockhash=t['blockHash'],confirmations=t['confirmationsAtCapture'])

class RPC:
 def __init__(self,f):self.f=f;self.calls=0;self.bytes=0;self.log=[];self.fail=None;self.verify_bad=False;self.reorg=False;self.null=False;self.bestblock_bad=False;self.fractional=False;self.heights=0
 def call(self,m,*args):
  self.calls+=1;self.bytes+=100;self.log.append((m,args))
  if self.fail==m:raise L.RPCFailure('core-refusal',m,args)
  seed,origins,cache,missing,p,header,proof,block=self.f
  if m=='getblockchaininfo':v=dict(chain='main',blocks=100,bestblockhash=block)
  elif m=='getblockhash':
   self.heights+=1;v='f'*64 if self.reorg and self.heights>3 else block
  elif m=='getrawtransaction':v=verbose(p)
  elif m=='getblockheader':v=dict(height=100,confirmations=1)if args[1]=='true'else header
  elif m=='gettxoutproof':v=proof
  elif m=='verifytxoutproof':v=[]if self.verify_bad else list(reversed(sorted(origins)))
  elif m=='gettxout':
   if self.null:v=None
   else:
    t=cache[args[0]];v=dict(bestblock='f'*64 if self.bestblock_bad else block,confirmations=1,value='0.000000001'if self.fractional else decimal.Decimal(t['outputs'][args[1]]['proofs'])/100000000,scriptPubKey=dict(hex=t['outputs'][args[1]]['scriptPubKey']))
  else:raise AssertionError(m)
  return v,hashlib.sha256(str(v).encode()).hexdigest()
class Electrs:
 def __init__(self,f):self.f=f;self.calls=0;self.bytes=0;self.deadline=1200;self.changed=False
 def call(self,m,*args):
  self.calls+=1;self.bytes+=100;seed,_,_,_,_,header,_,_=self.f
  if m=='blockchain.headers.subscribe':v=dict(height=100,hex=header)
  else:
   d=next(d for d in seed['discovery'].values()if d['scripthash']==args[0]);key={'blockchain.scripthash.get_history':'history','blockchain.scripthash.listunspent':'unspent','blockchain.scripthash.get_balance':'balance'}[m];v=copy.deepcopy(d[key])
   if self.changed and self.calls>10 and key=='balance':v['confirmed']+=1
  return v,hashlib.sha256(str(v).encode()).hexdigest()

class Tests(unittest.TestCase):
 def run_case(self,change=None):
  f=fixture();rpc=RPC(f);electrs=Electrs(f)
  if change:change(f,rpc,electrs)
  s,o,c,missing,p,h,proof,b=f
  # Fixture-only data-authority changes. Frozen production source file/loader
  # pins remain unchanged; this does not exercise native/actual corpus authority.
  with mock.patch.multiple(M,REMAINING_COUNT=1,REMAINING_SHA=M.set_sha(missing),TARGET_COUNT=3,GROUP_COUNT=1,BATCH_COUNT=1,REQUIRED_COUNT=2,PREVOUT_COUNT=2),mock.patch.object(R,'CHECKPOINT',dict(height=100,hash=b)):
   out=M.collect(s,o,dict(c),missing,rpc,electrs,clock=lambda:0)
  return out,rpc,electrs
 def test_complete_real_raw_batch_integer_fee_and_derived_remainder(self):
  out,r,e=self.run_case();self.assertEqual(out['status'],'discovered-history-closure-complete-with-closing-fences');self.assertEqual(out['feeSummary']['nonCoinbaseFeeProofs'],1223);self.assertEqual(out['coverage']['derivedUnspentCount'],3);self.assertEqual(out['coverage']['coreCalls'],20);self.assertEqual(out['coverage']['closingReservedCoreCalls'],5);self.assertEqual(e.calls,20);self.assertEqual(len([x for x in r.log if x[0]=='gettxout']),6)
  for k in('parentValuesComplete','targetCanonicalMembershipComplete','knownHistoryFeeAndDirectSpendCoverageAccepted','derivedUnspentCoreChecksComplete','knownHistoryBalanceComparisonAccepted'):self.assertTrue(out[k])
  for k in('financialReconciliationComplete','obligationReconciliationComplete','independentWholeChainAddressHistoryComplete','automaticNextChunk','nextChunkAuthorized','may9TransactionIDsRequested'):self.assertFalse(out[k])
 def test_missing_merkle_match_blocks_all_arithmetic_and_outpoints(self):
  out,r,e=self.run_case(lambda f,r,e:setattr(r,'verify_bad',True));self.assertEqual(out['status'],'partial-discovered-history-closure');self.assertTrue(out['closingFencesAccepted']);self.assertIsNone(out['feeSummary']);self.assertFalse(any(m=='gettxout'for m,_ in r.log));self.assertFalse(out['targetCanonicalMembershipComplete'])
 def test_raw_parent_rpc_failure_retains_closing_and_partial(self):
  out,r,e=self.run_case(lambda f,r,e:setattr(r,'fail','getrawtransaction'));self.assertEqual(out['coverage']['remainingParents'],1);self.assertTrue(out['closingFencesAccepted']);self.assertFalse(any(m=='gettxoutproof'for m,_ in r.log))
 def test_final_historical_reorg_refuses_every_acceptance(self):
  out,r,e=self.run_case(lambda f,r,e:setattr(r,'reorg',True));self.assertFalse(out['closingFencesAccepted']);self.assertFalse(out['knownHistoryBalanceComparisonAccepted'])
 def test_changed_closing_discovery_refuses_every_acceptance(self):
  out,r,e=self.run_case(lambda f,r,e:setattr(e,'changed',True));self.assertFalse(out['closingFencesAccepted']);self.assertFalse(out['knownHistoryFeeAndDirectSpendCoverageAccepted'])
 def test_fractional_outpoint_proof_or_null_or_other_bestblock_refuse(self):
  for field in('fractional','null','bestblock_bad'):
   out,r,e=self.run_case(lambda f,r,e:setattr(r,field,True));self.assertTrue(out['closingFencesAccepted']);self.assertFalse(out['knownHistoryBalanceComparisonAccepted'])
 def test_real_raw_negative_integer_fee_refuses(self):
  s,o,c,missing,p,h,proof,b=fixture();old_child=next(k for k,t in c.items()if t['inputs'][0]['txid']!='0'*64);prev=c[old_child]['inputs'][0]['txid'];bad=tx(prev,0,5000);bad.update(blockHash=b,confirmationsAtCapture=1);c.pop(old_child);o[bad['txid']]=o.pop(old_child);c[bad['txid']]=bad;c[p['txid']]=p
  with mock.patch.object(M,'TARGET_COUNT',3):
   with self.assertRaisesRegex(ValueError,'Negative transaction fee'):M.views_for(o,c)
 def test_duplicate_prevout_and_out_of_range_refuse(self):
  s,o,c,missing,p,h,proof,b=fixture()
  for change in('duplicate','range'):
   copy_cache=copy.deepcopy(c);child=next(t for t in copy_cache.values()if t['inputs'][0]['txid']!='0'*64)
   if change=='duplicate':child['inputs'].append(copy.deepcopy(child['inputs'][0]))
   else:child['inputs'][0]['vout']=99
   copy_cache[p['txid']]=p
   with mock.patch.object(M,'TARGET_COUNT',3):
    with self.assertRaises(ValueError):M.views_for(o,copy_cache)
 def test_entire_outpoint_stage_reserve_before_any_call(self):
  out,r,e=self.run_case(lambda f,r,e:setattr(r,'calls',9981));self.assertFalse(out['knownHistoryBalanceComparisonAccepted']);self.assertFalse(any(m=='gettxout'for m,_ in r.log))
 def test_567_closing_byte_and_opening7_arithmetic(self):
  rpc=types.SimpleNamespace(calls=0,bytes=0);groups={str(i):[] for i in range(567)};b=M.Budget(rpc,1200,groups,{},[],lambda:0)
  self.assertEqual(b.closing_calls,571);self.assertEqual(2569+3*567+2*644+3+b.closing_calls,6132);self.assertLess(b.closing_bytes,256*1024**2);self.assertEqual(b.closing_bytes,4*M.receive_bound(8*1024**2)+567*M.receive_bound(4096))
 def test_budget_call_byte_time_reserve_refuses_before_inner(self):
  for field,value in [('calls',9995),('bytes',M.MAX_BYTES),('clock',1020)]:
   f=fixture();r=RPC(f);groups={f[-1]:sorted(f[1])};b=M.Budget(r,1200,groups,{f[-1]:100},f[3],lambda:0)
   if field=='clock':b.clock=lambda:value
   else:setattr(r,field,value)
   with mock.patch.object(R,'CHECKPOINT',dict(height=100,hash=f[-1])):
    with self.assertRaises(M.Reserve):b.call('getrawtransaction',f[3][0],'true')
   self.assertEqual(r.log,[])
 def test_method_scope_rejects_unknown_and_unadmitted_outpoint(self):
  f=fixture();r=RPC(f);b=M.Budget(r,1200,{f[-1]:sorted(f[1])},{f[-1]:100},f[3],lambda:0)
  for args in [('sendrawtransaction','00'),('getrawtransaction','f'*64,'true'),('gettxout','f'*64,0,False),('gettxoutproof','["x","x"]',f[-1])]:
   with self.assertRaises(ValueError):b.call(*args)
  self.assertEqual(r.calls,0)
 def test_tighter_limits_restore_after_success_and_failure(self):
  f=fixture();r=RPC(f);b=M.Budget(r,1200,{f[-1]:sorted(f[1])},{f[-1]:100},f[3],lambda:0);old=L.MAX_RPC_BYTES
  with mock.patch.object(R,'CHECKPOINT',dict(height=100,hash=f[-1])):b.call('getblockhash',100)
  self.assertEqual(L.MAX_RPC_BYTES,old);r.fail='getblockhash'
  with self.assertRaises(L.RPCFailure):b.call('getblockhash',100)
  self.assertEqual(L.MAX_RPC_BYTES,old)
 def test_real_frozen_selector_charge_small_reply_refusal_and_reap(self):
  original=L.subprocess.Popen;children=[]
  def child(*a,**kw):
   p=original([sys.executable,'-c','import sys,time;sys.stdout.buffer.write(b"x"*5000);sys.stdout.flush();time.sleep(2)'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);children.append(p);return p
  r=T.CoreRPC();b=M.Budget(r,time.monotonic()+1200,{'a'*64:[]},{'a'*64:100},[],time.monotonic);old=L.MAX_RPC_BYTES
  with mock.patch.object(L.subprocess,'Popen',side_effect=child),mock.patch.object(L.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.geteuid())),mock.patch.object(R,'CHECKPOINT',dict(height=100,hash='a'*64)):
   with self.assertRaises(L.RPCFailure) as cm:b.call('getblockhash',100)
  self.assertEqual(cm.exception.row['category'],'response-bound');self.assertEqual(r.bytes,5000);self.assertTrue(all(p.poll()is not None for p in children));self.assertEqual(L.MAX_RPC_BYTES,old)
 def test_real_frozen_selector_signal_flags_refuse_and_reap(self):
  for sig in(signal.SIGINT,signal.SIGTERM):
   original=L.subprocess.Popen;children=[];ready=threading.Event()
   def child(*a,**kw):
    p=original([sys.executable,'-c','import sys,time;sys.stdout.write("ready");sys.stdout.flush();time.sleep(3)'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);children.append(p);ready.set();return p
   r=T.CoreRPC();b=M.Budget(r,time.monotonic()+1200,{'a'*64:[]},{'a'*64:100},[],time.monotonic);old=signal.signal(sig,R.operator_interrupted)
   def send():
    ready.wait(1);time.sleep(.03);os.kill(os.getpid(),sig)
   t=threading.Thread(target=send);t.start()
   try:
    with mock.patch.object(L.subprocess,'Popen',side_effect=child),mock.patch.object(L.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.geteuid())),mock.patch.object(R,'CHECKPOINT',dict(height=100,hash='a'*64)):
     with self.assertRaises(L.RPCFailure)as cm:b.call('getblockhash',100)
    self.assertEqual(cm.exception.row['category'],'operator-interrupted');self.assertTrue(all(p.poll()is not None for p in children))
   finally:t.join();signal.signal(sig,old);T.INTERRUPTED=None;L._OPERATOR_INTERRUPTED=None
 def test_real_batch_proof_extra_match_or_trailing_byte_refuses(self):
  s,o,c,missing,p,h,proof,b=fixture();valid=L.merkle_inclusion(proof);self.assertEqual(sorted(valid['matchedTxids']),sorted(o))
  with self.assertRaises(ValueError):L.merkle_inclusion(proof+'00')
 def test_fixed_sources_byte_pins_and_no_original_mutation(self):
  for path,want in[('/tmp/pow-audit30-treasury-missing-parents-chunk1-v1.py',M.OLD_PINS['collector.py'][0]),('/tmp/pow-audit30-treasury-missing-raw-targets-v1.py','02fc3a54c231c85bd1beab9307a9959bf2092bb169bdc603de64960830781130'),('/tmp/pow-audit30-treasury-address-corpus-v3.py','b60a0c359104001422c086f8e2df8c4eb9852eca7876fe1f153ff34807eac197'),('/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py','c37fb22836172254baaa8d2da125ff97fa25d7c955a0afa4c6b72accbe29cef7')]:self.assertEqual(hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest(),want)
  self.assertEqual(M.REMAINING_COUNT,2569);self.assertEqual(M.MAX_CALLS,10000);self.assertEqual(M.MAX_BYTES,256*1024**2);self.assertEqual(M.SECONDS,1200)
if __name__=='__main__':unittest.main()
