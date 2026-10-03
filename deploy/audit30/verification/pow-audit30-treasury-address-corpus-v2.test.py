#!/usr/bin/python3 -I
import copy,decimal,hashlib,importlib.util,json,os,struct,tempfile,types,unittest,subprocess,signal
from pathlib import Path
from unittest.mock import patch

def mod(name,path):
 sp=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
S=mod('treasury','/tmp/pow-audit30-treasury-address-corpus-v2.py');L=mod('ledger','/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py');O=mod('fixture','/tmp/pow-audit30-item8-readonly-collector.test.py');S.L=L

def verbose(t):return dict(txid=t['txid'],hex=t['rawHex'],vin=[dict(coinbase='00')if i['txid']=='0'*64 else dict(txid=i['txid'],vout=i['vout'])for i in t['inputs']],vout=[dict(n=o['vout'],value=decimal.Decimal(o['proofs'])/100000000,scriptPubKey={'hex':o['scriptPubKey']})for o in t['outputs']],blockhash=t.get('blockHash'),confirmations=t.get('confirmationsAtCapture',0))
class RPC:
 def __init__(self,c,fault=None):self.c=c;self.calls=0;self.bytes=0;self.fault=fault;self.hashcalls=0
 def call(self,method,*args):
  self.calls+=1;self.bytes+=1;block,b=next(iter(self.c['blocks'].items()));txid=next(iter(self.c['transactions']));t=self.c['transactions'][txid]
  if method=='getblockchaininfo':return dict(chain='main',blocks=123,bestblockhash=block),'a'*64
  if method=='getblockhash':
   self.hashcalls+=1;return ('f'*64 if self.fault=='reorg'and self.hashcalls>2 else block),'a'*64
  if method=='getrawtransaction':
   if self.fault=='target-missing'and args[0]==txid:raise L.RPCFailure('core-refusal',method,args,'a'*64,'b'*64,1,-5)
   if self.fault=='parent-missing'and args[0]in self.c['parents']:raise L.RPCFailure('core-refusal',method,args,'a'*64,'b'*64,1,-5)
   v=verbose((self.c['parents']|self.c['transactions'])[args[0]])
   if self.fault=='raw'and args[0]==txid:v['hex']='00'
   return v,'a'*64
  if method=='getblockheader':return dict(height=123,confirmations=1)if args[-1]=='true'else b['headerHex'],'a'*64
  if method=='gettxoutproof':return t['coreInclusionProofHex'][:-2]+'00'if self.fault=='merkle'else t['coreInclusionProofHex'],'a'*64
  if method=='verifytxoutproof':return[txid],'a'*64
  if method=='gettxout':
   if self.fault=='spent':return None,'a'*64
   o=t['outputs'][args[1]];return dict(value=decimal.Decimal(o['proofs'])/100000000,confirmations=1,scriptPubKey={'hex':o['scriptPubKey']}),'a'*64
  raise AssertionError(method)
class Electrs:
 def __init__(self,c,fault=None):self.c=c;self.fault=fault;self.calls=0;self.bytes=0;self.histcalls=0
 def call(self,method,*args):
  self.calls+=1;self.bytes+=1;block,b=next(iter(self.c['blocks'].items()));txid=next(iter(self.c['transactions']));script=L.address_script(S.ADDRESSES[0]);sh=hashlib.sha256(bytes.fromhex(script)).digest()[::-1].hex();selected=bool(args and args[0]==sh)
  if method=='blockchain.headers.subscribe':return dict(height=123,hex=b['headerHex']),'a'*64
  if method.endswith('get_history'):
   self.histcalls+=1;rows=[dict(tx_hash=txid,height=123)]if selected else[]
   if self.fault=='moving'and self.histcalls>3 and selected:rows=[]
   if self.fault=='height'and selected:rows[0]['height']=122
   return rows,'a'*64
  if method.endswith('listunspent'):return[dict(tx_hash=txid,tx_pos=0,height=123,value=9000)]if selected else[],'a'*64
  if method.endswith('get_balance'):return dict(confirmed=9000 if selected else 0,unconfirmed=0),'a'*64
  raise AssertionError(method)
class Tests(unittest.TestCase):
 def setUp(self):S.L=L;S.INTERRUPTED=None
 def capture(self,core_fault=None,electrs_fault=None):
  c,e=O.fake_corpus(bytes.fromhex(L.address_script(S.ADDRESSES[0])));return S.collect(RPC(c,core_fault),Electrs(c,electrs_fault))
 def test_all_three_complete_response_raw_merkle_integer_fee_outpoint_checks_qualified(self):
  r=self.capture();self.assertEqual(r['status'],'covered-discovery-corpus-complete');self.assertEqual(r['coverage']['discoveredAddressResponses'],3);self.assertEqual(r['oracle']['canonicalTargetTransactionsVerified'],1);a=r['addressComparisons'][0];self.assertEqual(a['confirmedBalanceFromDiscoveredCorpusProofs'],9000);self.assertEqual(a['feeChecks'][0]['feeProofs'],1000);self.assertTrue(a['coreOutpointChecks'][0]['verified']);self.assertFalse(r['financialReconciliationComplete']);self.assertFalse(r['oracle']['independentWholeChainAddressHistoryComplete']);self.assertTrue(r['may9OperatorConfirmedPaid']);self.assertFalse(r['may9TransactionIDsRequested'])
 def test_missing_target_parent_preserves_all_address_discovery_and_typed_coverage(self):
  for fault in ('target-missing','parent-missing'):
   with self.subTest(fault=fault):r=self.capture(fault);self.assertTrue(r['captureFailures']);self.assertEqual(r['coverage']['discoveredAddressResponses'],3);self.assertFalse(r['oracle']['allReturnedAddressResponsesAndCoveredOutpointsCompared']);self.assertEqual(r['status'],'partial-discovery-rpc-or-moving-snapshot')
 def test_raw_merkle_and_reorg_refuse_without_losing_discovery(self):
  for fault in ('raw','merkle','reorg'):
   with self.subTest(fault=fault):r=self.capture(fault);self.assertEqual(r['status'],'partial-integrity-refused');self.assertEqual(len(r['discovery']),3)
 def test_discovery_height_disagreement_is_explicit_finding_not_corruption(self):
  r=self.capture(electrs_fault='height');self.assertEqual(r['status'],'covered-discovery-corpus-complete-with-findings');self.assertTrue(any(f['field']=='ElectrsHistoryHeight'for f in r['oracle']['findings']));self.assertEqual(r['oracle']['canonicalTargetTransactionsVerified'],1)
 def test_core_spent_state_disagreement_exposes_missing_history_coverage(self):
  r=self.capture('spent');self.assertEqual(r['status'],'covered-discovery-corpus-complete-with-findings');self.assertTrue(any(f['field']=='CoreConfirmedOutpointSpentState'for f in r['oracle']['findings']));self.assertFalse(r['oracle']['completeFinancialOrObligationReconciliation'])
 def test_moving_history_remains_partial(self):r=self.capture(electrs_fault='moving');self.assertEqual(r['status'],'partial-discovery-rpc-or-moving-snapshot')
 def test_unknown_scope_duplicate_boolean_fractional_negative_and_bounds_refuse(self):
  h=[dict(tx_hash='a'*64,height=1)];self.assertEqual(S.validate_history(h,1),h)
  for rows in (h+h,[h[0]|{'height':True}],[h[0]|{'height':2}],[h[0]|{'tx_hash':'z'*64}],[h[0]|{'extra':1}],h*(S.MAX_HISTORY+1)):
   with self.subTest(rows=rows[:2]),self.assertRaises(ValueError):S.validate_history(rows,1)
  u=[dict(tx_hash='a'*64,tx_pos=0,height=1,value=1)]
  for rows in (u+u,[u[0]|{'value':1.1}],[u[0]|{'value':True}],[u[0]|{'value':-1}],[u[0]|{'height':-1}]):
   with self.assertRaises(ValueError):S.validate_unspent(rows,1)
  for v in ({'confirmed':True,'unconfirmed':0},{'confirmed':1.1,'unconfirmed':0},{'confirmed':1,'unconfirmed':0,'extra':1}):
   with self.assertRaises(ValueError):S.validate_balance(v)
 def test_unexpected_duplicate_json_keys_refuse(self):
  with self.assertRaises(ValueError):json.loads('{"x":1,"x":2}',object_pairs_hook=S.pairs)
 def test_frozen_parser_loader_no_optional_git_or_secret_access(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'ledger-corpus-v2.py';p.write_bytes(Path('/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py').read_bytes());p.chmod(0o600)
   with patch.object(S,'__file__',str(Path(t)/'collector.py')):self.assertEqual(S.load_ledger().MAX_CALLS,S.MAX_CORE_CALLS);p.write_bytes(p.read_bytes()+b'\n')
   with patch.object(S,'__file__',str(Path(t)/'collector.py')),self.assertRaises(ValueError):S.load_ledger()
  S.L=L
 def test_core_gettxout_is_native_only_strict_readonly_and_private_errors_are_hashes(self):
  original=subprocess.Popen;commands=[]
  def spawn(cmd,**kw):commands.append(cmd);return original(['/usr/bin/python3','-I','-B','-c','import sys;sys.stderr.write("error code: -5\\nprivate rpc sentinel\\n");sys.exit(1)'],**kw)
  with patch.object(S.subprocess,'Popen',side_effect=spawn),patch.object(S.os,'geteuid',return_value=999),patch.object(S.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=999)):
   with self.assertRaises(L.RPCFailure)as ctx:S.CoreRPC().call('gettxout','a'*64,0,False)
  self.assertNotIn('sudo',commands[0]);self.assertEqual(commands[0][-1],'false');self.assertEqual(ctx.exception.row['coreErrorCode'],-5);self.assertNotIn('sentinel',json.dumps(ctx.exception.row))
  for args in [('bad',0,False),('a'*64,True,False),('a'*64,0,'false')]:
   with self.assertRaises(ValueError):S.CoreRPC().call('gettxout',*args)
 def test_core_outpoint_exact_script_value_mismatch_is_hard_refusal(self):
  c,e=O.fake_corpus(bytes.fromhex(L.address_script(S.ADDRESSES[0])));r=RPC(c);original=r.call
  def call(method,*args):
   v,h=original(method,*args)
   if method=='gettxout':v['value']=decimal.Decimal('0.00000001')
   return v,h
  r.call=call;out=S.collect(r,Electrs(c));self.assertEqual(out['status'],'partial-integrity-refused')
 def test_pending_conflicts_are_best_effort_not_canonical_corruption(self):
  script=L.address_script(S.ADDRESSES[0]);p=dict(outputs=[dict(vout=0,proofs=10000,scriptPubKey=script)]);t=dict(blockHash=None,confirmationsAtCapture=0,inputs=[dict(txid='a'*64,vout=0)],outputs=[dict(vout=0,proofs=9000,scriptPubKey=script)]);r=dict(transactions={'b'*64:t,'c'*64:copy.deepcopy(t)},parents={'a'*64:p});v=S.outpoint_view(r,S.ADDRESSES[0]);self.assertEqual(len(v['pendingConflicts']),1);self.assertFalse(v['spent'])
 def test_electrs_fixed_endpoint_fragmented_response_duplicate_id_secret_and_byte_caps(self):
  import time
  class Sock:
   def __init__(self,raw):self.chunks=[raw[:10],raw[10:]];self.sent=None
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def sendall(self,b):self.sent=b
   def settimeout(self,x):pass
   def recv(self,n):return self.chunks.pop(0)if self.chunks else b''
  for raw,good in [(b'{"id":1,"result":[]}\n',True),(b'{"id":2,"result":[]}\n',False),(b'{"id":1,"error":{"message":"secret"},"result":[]}\n',False),(b'{"id":1,"result":[],"id":1}\n',False),(b'{"id":1,"result":[]}\ntrailing',False)]:
   sock=Sock(raw)
   with patch.object(S.socket,'create_connection',return_value=sock)as connection:
    if good:self.assertEqual(S.Electrs(time.monotonic()+10).call('blockchain.scripthash.get_history','a'*64)[0],[])
    else:
     with self.assertRaises(ValueError):S.Electrs(time.monotonic()+10).call('blockchain.scripthash.get_history','a'*64)
    self.assertEqual(connection.call_args.args[0],('172.27.0.1',50001))
  with patch.object(S.socket,'create_connection',return_value=Sock(b'{"id":1,"result":[]}\n')),patch.object(S,'MAX_ELECTRS_LINE',10),self.assertRaises(ValueError):S.Electrs(time.monotonic()+10).call('blockchain.headers.subscribe')
  with patch.object(S.socket,'create_connection')as c,self.assertRaises(ValueError):S.Electrs(time.monotonic()+10).call('blockchain.transaction.broadcast','secret')
  c.assert_not_called()
 def test_actual_sigterm_preserves_partial_and_never_requests_may9_ids(self):
  child=r"""import importlib.util,json,time,types,os,signal,sys
p='/tmp/pow-audit30-treasury-address-corpus-v2.py';sp=importlib.util.spec_from_file_location('S',p);S=importlib.util.module_from_spec(sp);sp.loader.exec_module(S)
l='/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py';sp=importlib.util.spec_from_file_location('L',l);L=importlib.util.module_from_spec(sp);sp.loader.exec_module(L);S.L=L;S.load_ledger=lambda:L;S.pwd=types.SimpleNamespace(getpwnam=lambda _:types.SimpleNamespace(pw_uid=os.getuid()));previous=signal.getsignal(signal.SIGTERM)
class Core:
 calls=0;bytes=0
 def call(self,method,*args):
  self.calls+=1
  if S.INTERRUPTED is None:
   print('ready',flush=True)
   while S.INTERRUPTED is None:time.sleep(.01)
  raise L.RPCFailure('operator-interrupted',method,args)
S.CoreRPC=Core;status=S.main();print(json.dumps({'exit':status,'handlersRestored':signal.getsignal(signal.SIGTERM)==previous}),flush=True)
"""
  p=subprocess.Popen(['/usr/bin/python3','-I','-B','-Werror','-c',child],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   self.assertEqual(p.stdout.readline().strip(),'ready');p.send_signal(signal.SIGTERM);out,err=p.communicate(timeout=5);rows=[json.loads(x)for x in out.splitlines()];self.assertEqual(p.returncode,0);self.assertEqual(err,'');self.assertEqual(rows[0]['status'],'partial-integrity-refused');self.assertFalse(rows[0]['may9TransactionIDsRequested']);self.assertFalse(rows[0]['financialReconciliationComplete']);self.assertTrue(rows[1]['handlersRestored']);self.assertEqual(rows[1]['exit'],2)
  finally:
   if p.poll()is None:p.kill();p.wait()
   p.stdout.close();p.stderr.close()
 def test_new_tip_history_or_unspent_is_typed_moving_snapshot_not_corruption(self):
  with self.assertRaises(S.MovingSnapshot)as ex:S.validate_history([dict(tx_hash='a'*64,height=2)],1)
  result={'captureFailures':[]};r=S.failure(result,'discovery',ex.exception,address=S.ADDRESSES[0]);self.assertEqual(r['kind'],'moving-snapshot');self.assertNotIn('reason',r)
  with self.assertRaises(S.MovingSnapshot):S.validate_unspent([dict(tx_hash='a'*64,tx_pos=0,height=2,value=1)],1)
  with self.assertRaises(ValueError):S.validate_history([dict(tx_hash='a'*64,height=2**31)],1)
 def test_core_gettxout_wait_timeout_is_typed_and_still_preserves_corpus(self):
  original=subprocess.Popen
  def spawn(cmd,**kw):
   p=original(['/usr/bin/python3','-I','-B','-c','print("null")'],**kw);wait=p.wait;count=[0]
   def timeout(*args,**kw):
    count[0]+=1
    if count[0]==1:raise subprocess.TimeoutExpired(cmd,.01)
    return wait(*args,**kw)
   p.wait=timeout;return p
  with patch.object(S.subprocess,'Popen',side_effect=spawn),patch.object(S.os,'geteuid',return_value=999),patch.object(S.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=999)):
   with self.assertRaises(L.RPCFailure)as ctx:S.CoreRPC().call('gettxout','a'*64,0,False)
  self.assertEqual(ctx.exception.row['category'],'call-timeout')
if __name__=='__main__':unittest.main(verbosity=2)
