import contextlib,copy,hashlib,importlib.util,json,os,pathlib,signal,struct,subprocess,sys,threading,time,types,unittest
from unittest import mock
def module(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
C=module('/tmp/pow-audit30-treasury-missing-raw-targets-v1.py','delta')
T=module('/tmp/pow-audit30-treasury-address-corpus-v3.py','seed')
L=module('/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py','ledger')
assert hashlib.sha256(pathlib.Path(T.__file__).read_bytes()).hexdigest()==C.SEED_COLLECTOR_SHA
assert hashlib.sha256(pathlib.Path(L.__file__).read_bytes()).hexdigest()==T.LEDGER_SHA
C.T=T;C.L=L;T.L=L;L.MAX_CALLS=10000
HEADER=(bytes.fromhex('01000000')+b'\x00'*32+b'\x01'*32+b'\x00'*12).hex()
BLOCK=L.header_proof(HEADER)
def tx(value=546):
 script=bytes.fromhex(L.address_script(T.ADDRESSES[2]));raw=bytes.fromhex('0100000001')+b'\x00'*32+b'\xff'*4+b'\x00'+b'\xff'*4+b'\x01'+struct.pack('<Q',value)+bytes([len(script)])+script+b'\x00'*4;p=L.parse_raw(raw.hex())
 return dict(hex=raw.hex(),txid=p['txid'],vin=[dict(coinbase='00')],vout=[dict(n=0,value=L.decimal.Decimal(value)/100000000,scriptPubKey=dict(hex=script.hex()))],blockhash=BLOCK,confirmations=1)
def fixture():
 raws={v['txid']:v for v in(tx(),tx(547))};missing=sorted(raws);origins={t:[dict(address=T.ADDRESSES[2],height=969687)]for t in missing}
 d={a:dict(scripthash=str(i)*64,history=[dict(tx_hash=t,height=969687)for t in missing],unspent=[],balance=dict(confirmed=0,unconfirmed=0))for i,a in enumerate(T.ADDRESSES)}
 return dict(discovery=d),origins,missing,raws
class Core:
 def __init__(self,raws):self.raws=raws;self.calls=0;self.bytes=0;self.seen=[];self.inner=types.SimpleNamespace(deadline=time.monotonic()+1200);self.fail=None;self.fork=False;self.extend=False;self.bump=None
 def call(self,method,*args):
  self.calls+=1;self.bytes+=100;self.seen.append((method,args))
  if self.fail and method=='getrawtransaction':raise L.RPCFailure(self.fail,method,args,stderr_sha='a'*64)
  if method=='getblockchaininfo':value=dict(chain='main',blocks=969689 if self.extend and sum(m=='getblockchaininfo'for m,a in self.seen)>1 else 969688,bestblockhash='3'*64 if self.extend and sum(m=='getblockchaininfo'for m,a in self.seen)>1 else'2'*64)
  elif method=='getblockhash':value='4'*64 if self.fork and args[0]==969688 else BLOCK if args[0]==969687 else'2'*64
  elif method=='getrawtransaction':value=copy.deepcopy(self.raws[args[0]])
  else:raise AssertionError('Unexpected call')
  if self.bump:self.bump(self,method,args)
  return value,'a'*64
class Electrs:
 def __init__(self,seed):self.seed=seed;self.calls=0;self.bytes=0;self.deadline=time.monotonic()+1200;self.changed=False;self.openbytes=None
 def call(self,method,*args):
  self.calls+=1;self.bytes+=100
  if self.openbytes and self.calls==10:self.bytes=self.openbytes
  if method=='blockchain.headers.subscribe':v=dict(height=969687,hex=HEADER)
  else:
   d=next(d for d in self.seed['discovery'].values()if d['scripthash']==args[0]);field={'blockchain.scripthash.get_history':'history','blockchain.scripthash.listunspent':'unspent','blockchain.scripthash.get_balance':'balance'}[method];v=copy.deepcopy(d[field])
   if self.changed and self.calls>10 and field=='balance':v['confirmed']+=1
  return v,'b'*64
@contextlib.contextmanager
def synthetic_scope(missing):
 # Only data-authority constants are rebound for small real-raw algorithm fixtures.
 # Native fixed6650/set authority is tested separately and never rewritten.
 with mock.patch.object(C,'NATIVE_MISSING_COUNT',len(missing)),mock.patch.object(C,'MISSING_SET_SHA',C.set_sha(missing)),mock.patch.object(C,'CHECKPOINT',dict(height=969687,hash=BLOCK)):
  yield
def run(**options):
 seed,origins,missing,raws=fixture();r=Core(raws);e=Electrs(seed)
 for k,v in options.items():setattr(r if hasattr(r,k)else e,k,v)
 with synthetic_scope(missing):out=C.collect(seed,origins,missing,r,e)
 return out,r,e
class Tests(unittest.TestCase):
 def test_real_raw_complete_only_acquisition_false_financial(self):
  out,r,e=run();self.assertEqual((out['coverage']['acquired'],out['coverage']['remaining'],r.calls,e.calls),(2,0,9,20));self.assertTrue(out['closingFencesAccepted']);self.assertEqual(out['status'],'raw-target-delta-complete-with-closing-fences');self.assertEqual({m for m,a in r.seen},{'getrawtransaction','getblockhash','getblockchaininfo'})
  for k in('parentCoverageAccepted','canonicalMembershipCoverageAccepted','outpointCoverageAccepted','balanceComparisonPerformed','financialReconciliationComplete','obligationReconciliationComplete','signingEligibilityVerified','automaticNextChunk','automaticRetry'):self.assertIs(out[k],False)
  for t in out['newTransactions'].values():self.assertEqual(L.parse_raw(t['rawHex'])['txid'],t['txid']);self.assertNotIn('coreInclusionProofHex',t)
 def test_native6650_authority_not_small_sample(self):
  s,o,m,v=fixture();r=Core(v);e=Electrs(s)
  with self.assertRaisesRegex(ValueError,'EXACT_ACQUISITION_SET'):C.collect(s,o,m,r,e)
  self.assertEqual(r.calls,0)
 def test_full6650_real_raw_acquisition_and_reserved_closing(self):
  # Real parser/normalizer and fixed native count; synthetic authority hash only.
  raws={v['txid']:v for v in(tx(546+i)for i in range(6650))};missing=sorted(raws);origins={t:[dict(address=T.ADDRESSES[i%3],height=969687)]for i,t in enumerate(missing)}
  seed=dict(discovery={a:dict(scripthash=str(i)*64,history=sorted([dict(tx_hash=t,height=969687)for t in missing if origins[t][0]['address']==a],key=lambda r:(r['height'],r['tx_hash'])),unspent=[],balance=dict(confirmed=0,unconfirmed=0))for i,a in enumerate(T.ADDRESSES)})
  with mock.patch.object(C,'MISSING_SET_SHA',C.set_sha(missing)),mock.patch.object(C,'CHECKPOINT',dict(height=969687,hash=BLOCK)):
   r=Core(raws);e=Electrs(seed);out=C.collect(seed,origins,missing,r,e)
  self.assertEqual((out['coverage']['requested'],out['coverage']['acquired'],out['coverage']['remaining'],r.calls,e.calls),(6650,6650,0,6657,20));self.assertEqual(out['status'],'raw-target-delta-complete-with-closing-fences');self.assertLess(len(C.encoded(out)),C.MAX_BYTES);self.assertFalse(out['financialReconciliationComplete'])
 def test_duplicate_or_unsorted_target_set_refuses_before_rpc(self):
  s,o,m,v=fixture()
  for wrong in(m+m,list(reversed(m))):
   with synthetic_scope(m),self.assertRaises(ValueError):C.collect(s,o,wrong,Core(v),Electrs(s))
 def test_method_and_bool_height_refuse_before_rpc(self):
  r=Core({});b=C.BudgetRPC(r,time.monotonic()+1200)
  for method,args in[('gettxout',('0'*64,0,False)),('getblockhash',(True,)),('getrawtransaction',('0'*64,'false')),('getblockchaininfo',(1,))]:
   with self.assertRaises(ValueError):b.call(method,*args)
  self.assertEqual(r.calls,0)
 def test_exact_call_reserve_boundary(self):
  r=Core({'0'*64:{}});r.calls=C.MAX_CALLS-5;b=C.BudgetRPC(r,1200,lambda:0);b.call('getrawtransaction','0'*64,'true');self.assertEqual(r.calls,C.MAX_CALLS-4)
  with self.assertRaises(C.ClosingReserve):b.call('getrawtransaction','0'*64,'true')
 def test_selector_overshoot_in_byte_reserve(self):
  self.assertEqual(C.MAX_CORE_RECEIVED,2*(8*1024**2+65536));r=Core({'0'*64:{}});r.bytes=C.MAX_BYTES-C.MAX_CORE_RECEIVED-C.CLOSING_BYTES;b=C.BudgetRPC(r,1200,lambda:0);b.call('getrawtransaction','0'*64,'true')
  r.bytes=C.MAX_BYTES-C.MAX_CORE_RECEIVED-C.CLOSING_BYTES+1
  with self.assertRaises(C.ClosingReserve):b.call('getrawtransaction','0'*64,'true')
 def test_time_reserve_boundary(self):
  r=Core({'0'*64:{}});b=C.BudgetRPC(r,1200,lambda:1000);b.call('getrawtransaction','0'*64,'true');b.clock=lambda:1000.001
  with self.assertRaises(C.ClosingReserve):b.call('getrawtransaction','0'*64,'true')
 def test_refusal_retains_prior_raw_and_still_closes(self):
  def bump(r,m,a):
   if m=='getrawtransaction'and sum(x=='getrawtransaction'for x,y in r.seen)==1:r.fail='core-refusal'
  out,r,e=run(bump=bump);self.assertEqual((out['coverage']['acquired'],out['coverage']['remaining']),(1,1));self.assertTrue(out['closingFencesAccepted']);self.assertEqual(out['captureFailures'][0]['category'],'core-refusal');self.assertEqual(out['status'],'partial-raw-target-delta')
 def test_call_reserve_closes_without_further_raw(self):
  def bump(r,m,a):
   if m=='getrawtransaction':r.calls=C.MAX_CALLS-4
  out,r,e=run(bump=bump);self.assertEqual((out['coverage']['acquired'],r.calls),(1,10000));self.assertTrue(out['closingFencesAccepted']);self.assertEqual(sum(m=='getrawtransaction'for m,a in r.seen),1)
 def test_electrs_closing_budget_refuses_raw_and_preserves_closing_attempt(self):
  out,r,e=run(openbytes=12*1024**2);self.assertEqual(out['coverage']['acquired'],0);self.assertEqual(sum(m=='getrawtransaction'for m,a in r.seen),0);self.assertTrue(out['closingFencesAccepted']);self.assertEqual(out['status'],'partial-raw-target-delta')
 def test_spool_reserve_stops_and_retains_partial(self):
  with mock.patch.object(C,'SPOOL_RESERVED_BYTES',C.MAX_BYTES):out,r,e=run()
  self.assertEqual(out['coverage']['acquired'],0);self.assertTrue(out['closingFencesAccepted']);self.assertEqual(sum(m=='getrawtransaction'for m,a in r.seen),1);self.assertIn('acquisition-reserve',[f['phase']for f in out['captureFailures']])
 def test_natural_extension_accepts_same_saved_and_opening_prefix(self):
  out,r,e=run(extend=True);self.assertTrue(out['closingFencesAccepted']);self.assertEqual(out['chainAfter']['height'],969689)
 def test_opening_prefix_fork_preserves_raw_and_refuses_closure(self):
  out,r,e=run(fork=True);self.assertFalse(out['closingFencesAccepted']);self.assertEqual(out['coverage']['acquired'],2);self.assertEqual(out['captureFailures'][-1]['phase'],'closing-fence')
 def test_changed_discovery_refuses_closing_not_body_or_balance_findings(self):
  out,r,e=run(changed=True);self.assertFalse(out['closingFencesAccepted']);self.assertNotIn('findings',out);self.assertFalse(out['balanceComparisonPerformed'])
 def test_raw_output_and_confirmation_type_drift_refuse(self):
  for field,value in [('confirmations',True),('confirmations',1.5),('blockhash','bogus')]:
   s,o,m,v=fixture();v[m[0]][field]=value;r=Core(v)
   with synthetic_scope(m):out=C.collect(s,o,m,r,Electrs(s))
   self.assertEqual(out['coverage']['acquired'],0);self.assertTrue(out['closingFencesAccepted'])
  s,o,m,v=fixture();v[m[0]]['vout'][0]['value']=L.decimal.Decimal('1');r=Core(v)
  with synthetic_scope(m):out=C.collect(s,o,m,r,Electrs(s))
  self.assertEqual(out['coverage']['acquired'],0)
 def test_exact_seed_incomplete_sets_refuse_with_real_parser(self):
  s,o,m,v=fixture();p=L.normalize_verbose(v[m[0]]);s.update(schema='pow-audit30-treasury-address-corpus-v1',status='partial-integrity-refused',productionMutation=False,addresses=list(T.ADDRESSES),chainBefore=C.CHECKPOINT,electrsBefore=C.CHECKPOINT,transactions={p['txid']:p},parents={})
  with self.assertRaisesRegex(ValueError,'EXACT_TARGET_CACHE_SETS'):C.load_seed(s)
  s['transactions'][p['txid']]['outputs'][0]['proofs']+=1
  with self.assertRaisesRegex(ValueError,'SEED_RAW_PARSER'):C.load_seed(s)
 def test_signal_uses_frozen_real_selector_reaps_child(self):
  real=subprocess.Popen;children=[];timer=None;prior={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM)}
  def local_child(*args,**kwargs):
   nonlocal timer
   p=real([sys.executable,'-I','-B','-c','import sys,time;sys.stdout.write("{");sys.stdout.flush();time.sleep(30)'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);children.append(p);timer=threading.Timer(.08,lambda:os.kill(os.getpid(),signal.SIGTERM));timer.start();return p
  T.INTERRUPTED=None;L._OPERATOR_INTERRUPTED=None
  for s in prior:signal.signal(s,C.operator_interrupted)
  try:
   with mock.patch.object(L.subprocess,'Popen',local_child),mock.patch.object(L.os,'geteuid',lambda:123),mock.patch.object(L.pwd,'getpwnam',lambda name:types.SimpleNamespace(pw_uid=123)):
    with self.assertRaises(L.RPCFailure)as cm:T.CoreRPC().call('getblockchaininfo')
   self.assertEqual(cm.exception.row['category'],'operator-interrupted');self.assertIsNotNone(children[0].poll());self.assertLess(cm.exception.row.get('exitCode')or 0,1)
   os.kill(os.getpid(),signal.SIGINT);self.assertEqual(T.INTERRUPTED,signal.SIGINT)
  finally:
   if timer:timer.cancel();timer.join()
   for p in children:
    if p.poll()is None:os.killpg(p.pid,signal.SIGKILL);p.wait()
   for s,h in prior.items():signal.signal(s,h)
   T.INTERRUPTED=None;L._OPERATOR_INTERRUPTED=None
 def test_duplicate_json_key_and_bool_tip_closed(self):
  with self.assertRaises(ValueError):json.loads('{"a":1,"a":2}',object_pairs_hook=C.pairs)
  with self.assertRaises(ValueError):C.chain(dict(chain='main',blocks=True,bestblockhash='1'*64))
if __name__=='__main__':unittest.main()
