#!/usr/bin/python3 -I
"""Offline exact raw/Merkle/RPC coverage fixtures. No network/systemd/live SQL."""
import copy,decimal,hashlib,signal,importlib.util,json,os,struct,subprocess,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch

def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
L=module('ledger_v2','/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py');O=module('old_fixtures','/tmp/pow-audit30-item8-readonly-collector.test.py');E=O.E

def corpus():
 c,e=O.fake_corpus();c.update(schema='audit30-item8-ledger-corpus-v2',chainBefore={'height':123,'hash':'a'*64},chainAfter={'height':124,'hash':'b'*64},targetCapture=[dict(txid=e['stages']['test'][0]['txid'],kind='test',expectationStage='test',expectationIndex=0,status='canonical-captured',phase='captured')],captureFailures=[]);return c,e

def verbose(t):
 return dict(txid=t['txid'],hex=t['rawHex'],vin=[dict(coinbase='00') if i['txid']=='0'*64 else dict(txid=i['txid'],vout=i['vout']) for i in t['inputs']],vout=[dict(n=o['vout'],value=decimal.Decimal(o['proofs'])/100000000,scriptPubKey={'hex':o['scriptPubKey']}) for o in t['outputs']],blockhash=t.get('blockHash'),confirmations=t.get('confirmationsAtCapture',0))
class FakeRPC:
 def __init__(self,c,fault=None):self.c=c;self.fault=fault;self.calls=0;self.bytes=0;self.hashcalls=0
 def call(self,method,*args):
  self.calls+=1;self.bytes+=1;primary=self.c['transactions'];parents=self.c['parents'];block,b=next(iter(self.c['blocks'].items()));txid=next(iter(primary));t=primary[txid]
  if method=='getblockchaininfo':return dict(chain='main',blocks=124,bestblockhash='a'*64),'f'*64
  if method=='getrawtransaction':
   if self.fault=='missing-target' and args[0]==txid:raise L.RPCFailure('core-refusal',method,args,'a'*64,'b'*64,1,-5)
   if self.fault=='missing-parent' and args[0] in parents:raise L.RPCFailure('core-refusal',method,args,'a'*64,'b'*64,1,-5)
   if self.fault=='budget':raise L.RPCFailure('call-count',method,args)
   v=verbose((primary|parents)[args[0]])
   if self.fault=='bad-raw' and args[0]==txid:v['hex']='00'
   return v,'f'*64
  if method=='getblockheader':
   current=self.c['blocks'][args[0]];return (dict(height=current['height'],confirmations=2) if args[-1]=='true' else current['headerHex']),'f'*64
  if method=='getblockhash':
   self.hashcalls+=1
   if self.fault=='missing-fence' and self.hashcalls>1:raise L.RPCFailure('core-refusal',method,args,'a'*64,'b'*64,1,-5)
   if self.fault=='reorg' and self.hashcalls>1:return 'f'*64,'e'*64
   return next(hash_ for hash_,row in self.c['blocks'].items() if row['height']==args[0]),'f'*64
  if method=='gettxoutproof':
   chosen=primary[json.loads(args[0])[0]];return (chosen['coreInclusionProofHex'][:-2]+'00' if self.fault=='bad-merkle' else chosen['coreInclusionProofHex']),'f'*64
  if method=='verifytxoutproof':
   selected=next((key for key,tx in primary.items() if tx['coreInclusionProofHex']==args[0]),txid);return [selected],'f'*64
  raise AssertionError(method)
class LedgerV2(unittest.TestCase):
 def test_frozen_original_and_expectations_preserved(self):
  self.assertEqual(hashlib.sha256(Path('/tmp/pow-audit30-item8-ledger-corpus-collector.py').read_bytes()).hexdigest(),'edb7b780f987f9bbaf3432ba473e09e210ecd8ff406d3ce6066b1a511e38db25');self.assertEqual(hashlib.sha256(Path('/tmp/pow-audit30-item8-ledger-expectations-v1.json').read_bytes()).hexdigest(),L.EXPECTATIONS_SHA);self.assertEqual(len(L.target_rows(E,'all')),166)
 def test_exact_raw_merkle_parent_proofs(self):
  c,e=corpus();r=L.verify(c,e);self.assertEqual(r['status'],'complete');self.assertEqual(r['coverage']['canonicalVerified'],1);self.assertTrue(r['allNamedFeeAndInputValuesVerified']);self.assertFalse(r['financialReconciliationComplete'])
 def test_all_documentary_findings_preserved_without_corruption_claim(self):
  c,e=corpus();e['stages']['test'][0].update(height=999,feeProofs=777,inputProofs=500,inputCount=5,recipient=E['registryAddress'],paidProofs=2000,registryPaymentProofs=546,memo='missing',components=[1,2]);r=L.verify(c,e)
  self.assertEqual(r['status'],'complete-with-documentation-discrepancies');self.assertEqual({x['field'] for x in r['documentationFindings']},{'height','feeProofs','inputProofs','inputCount','paidProofs','registryPaymentProofs','memoPresent','componentsSum'});self.assertTrue(r['independentRawTxidAndMerkleInclusionPass']);self.assertFalse(r['hardIntegrityRefusal'])
 def test_raw_merkle_canonical_tamper_hard_refuse(self):
  for kind in ('raw','merkle','canonical'):
   c,e=corpus();t=next(iter(c['transactions'].values()))
   if kind=='raw':t['outputs'][0]['proofs']=1
   if kind=='merkle':t['coreInclusionProofHex']=t['coreInclusionProofHex'][:-2]+'00'
   if kind=='canonical':next(iter(c['blocks'].values()))['canonicalHashAfter']='f'*64
   with self.subTest(kind=kind):r=L.verify(c,e);self.assertTrue(r['hardIntegrityRefusal']);self.assertFalse(r['namedTransactionRawAndCoreCanonicalChecksPass']);self.assertEqual(r['status'],'partial-integrity-refused')
 def test_missing_parent_keeps_canonical_row_and_output(self):
  c,e=corpus();c['parents']={};r=L.verify(c,e);self.assertTrue(r['rows'][0]['canonicalVerified']);self.assertFalse(r['allNamedFeeAndInputValuesVerified']);self.assertEqual(r['status'],'partial-rpc-or-parent-coverage');self.assertIn('missingOrInvalidParentTxids',r['rows'][0]);self.assertEqual(r['rows'][0]['outputProofs'],9000)
 def test_complete_target_order_count_no_forged_coverage(self):
  c,e=corpus();c['targetCapture']=[]
  with self.assertRaises(ValueError):L.verify(c,e)
 def collect_case(self,fault=None):
  c,e=corpus();rpc=FakeRPC(c,fault)
  with patch.object(L,'RPC',return_value=rpc):return L.collect(e,'test')
 def test_collect_persists_height_finding_and_corpus(self):
  c,e=corpus();e['stages']['test'][0]['height']=321
  with patch.object(L,'RPC',return_value=FakeRPC(c)):out=L.collect(e,'test')
  self.assertEqual(out['oracle']['documentationFindings'][0]['field'],'height');self.assertEqual(out['status'],'complete-with-documentation-discrepancies');self.assertTrue(out['transactions']);self.assertTrue(out['parents']);self.assertTrue(out['blocks'])
 def test_missing_target_capture_typed_failure_does_not_abort(self):
  out=self.collect_case('missing-target');self.assertEqual(out['oracle']['coverage']['missingTargetRows'],1);self.assertEqual(out['captureFailures'][0]['coreErrorCode'],-5);self.assertEqual(out['status'],'partial-rpc-or-parent-coverage');self.assertNotIn('\"stderr\":',json.dumps(out));self.assertEqual(out['invalidRawCaptures'],{})
 def test_missing_parent_and_final_fence_explicit_partial(self):
  for fault in ('missing-parent','missing-fence'):
   with self.subTest(fault=fault):out=self.collect_case(fault);self.assertTrue(out['transactions']);self.assertFalse(out['oracle']['hardIntegrityRefusal']);self.assertEqual(out['status'],'partial-rpc-or-parent-coverage')
 def test_invalid_raw_merkle_reorg_and_budget_preserve_partial(self):
  for fault in ('bad-raw','bad-merkle','reorg','budget'):
   with self.subTest(fault=fault):out=self.collect_case(fault);self.assertTrue(out['oracle']['hardIntegrityRefusal']);self.assertEqual(out['status'],'partial-integrity-refused');self.assertEqual(len(out['targetCapture']),1)
 def test_rpc_native_user_has_no_sudo_and_error_stderr_never_emitted(self):
  original=subprocess.Popen;commands=[]
  def child(cmd,**kw):
   commands.append(cmd);return original(['/usr/bin/python3','-I','-B','-c','import sys;sys.stderr.write("error code: -5\\nprivate secret\\n");sys.exit(1)'],**kw)
  with patch.object(L.subprocess,'Popen',side_effect=child),patch.object(L.os,'geteuid',return_value=999),patch.object(L.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=999)):
   with self.assertRaises(L.RPCFailure) as ctx:L.RPC().call('getrawtransaction','a'*64,'true')
  row=ctx.exception.row;self.assertEqual(row['coreErrorCode'],-5);self.assertEqual(commands[0][0],'/usr/local/bin/bitcoin-cli');self.assertNotIn('secret',json.dumps(row));self.assertEqual(len(row['stderrSha256']),64)
 def projection(self,c):
  t=next(iter(c['transactions'].values()));i=t['inputs'][0];b=c['blocks'][t['blockHash']];row=dict(txid=t['txid'],status='confirmed',blockHeight=b['height'],blockHash=t['blockHash'],feeProofs='1000',inputs=[dict(vin=0,prevTxid=i['txid'],prevVout=0,valueProofs='10000')],outputs=[dict(vout=0,valueProofs='9000',scriptPubKey='51')]);objs=[dict(kind='fence',readOnly='on'),dict(kind='treasuryWorkProjection',confirmedUnit='WORK subatoms (10^16 per WORK)',rows=[dict(address=a,confirmedBalanceSubatoms='10000000000000000',pendingDeltaSubatoms='-1') for a in L.TREASURY_ADDRESSES]),dict(kind='namedTransactionProjection',targetCount=1,rows=[row])];return objs,row
 def test_projection_all_discrepancies_preserved_as_findings(self):
  c,e=corpus();c['oracle']=L.verify(c,e);objs,row=self.projection(c);good=L.verify_projection(c,b'\n'.join(json.dumps(o).encode() for o in objs));self.assertTrue(good['namedRawProjectionChecksPass']);row.update(status='pending',blockHeight=0,feeProofs='1');row['inputs'][0]['valueProofs']='2';bad=L.verify_projection(c,b'\n'.join(json.dumps(o).encode() for o in objs));self.assertFalse(bad['namedRawProjectionChecksPass']);self.assertEqual(len(bad['findings']),4);self.assertFalse(bad['financialReconciliationComplete'])
 def test_projection_invalid_unit_integer_or_dup_is_refusal(self):
  c,e=corpus();c['oracle']=L.verify(c,e)
  for kind in ('unit','integer','duplicate'):
   objs,row=self.projection(c)
   if kind=='unit':objs[1]['confirmedUnit']='sats'
   if kind=='integer':objs[1]['rows'][0]['confirmedBalanceSubatoms']='01'
   if kind=='duplicate':objs[2]['rows'].append(copy.deepcopy(row));objs[2]['targetCount']=2
   with self.subTest(kind=kind),self.assertRaises(ValueError):L.verify_projection(c,b'\n'.join(json.dumps(o).encode() for o in objs))
 def test_real_snapshot_math_remains_unmodified(self):
  r=L.snapshot_math(E);self.assertEqual(r['v1']['refundSats'],295660);self.assertEqual(r['v2ReviewOnlyProofs'],10066);self.assertFalse(r['v2PayoutClaim'])
 def test_individual_missing_target_continues_and_preserves_next_canonical_row(self):
  first,e=corpus();second,other=O.fake_corpus(amount=8000);second_txid=next(iter(second['transactions']));first['transactions'].update(second['transactions']);first['parents'].update(second['parents']);first['blocks'].update(second['blocks']);first['blocks'][next(iter(second['blocks']))]['height']=124;e['stages']['test'].append(other['stages']['test'][0]|{'height':124})
  with patch.object(L,'RPC',return_value=FakeRPC(first,'missing-target')):out=L.collect(e,'test')
  self.assertEqual(out['oracle']['coverage']['expectedTargets'],2);self.assertEqual(out['oracle']['coverage']['canonicalVerified'],1);self.assertEqual(out['oracle']['coverage']['completeParentValueRows'],1);self.assertEqual(out['oracle']['rows'][1]['feeProofs'],2000);self.assertEqual(out['targetCapture'][0]['status'],'rpc-unavailable');self.assertEqual(out['targetCapture'][1]['status'],'canonical-captured');self.assertEqual(out['invalidRawCaptures'],{})
 def test_budget_refusal_preserves_not_attempted_tail(self):
  c,e=corpus();e['stages']['test'].append(dict(txid='c'*64,kind='never-attempted'))
  with patch.object(L,'RPC',return_value=FakeRPC(c,'budget')):out=L.collect(e,'test')
  self.assertEqual(out['oracle']['coverage']['notAttemptedRows'],1);self.assertTrue(out['oracle']['hardIntegrityRefusal']);self.assertEqual(len(out['targetCapture']),2)
 def test_rpc_spawn_failure_is_typed_and_no_private_stderr(self):
  with patch.object(L.subprocess,'Popen',side_effect=PermissionError('secret missing permission')),patch.object(L.os,'geteuid',return_value=999),patch.object(L.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=999)):
   with self.assertRaises(L.RPCFailure) as ctx:L.RPC().call('getrawtransaction','a'*64,'true')
  self.assertEqual(ctx.exception.row['category'],'transport-os-error');self.assertNotIn('secret',json.dumps(ctx.exception.row))

 def test_actual_sigterm_preserves_partial_and_restores_handlers(self):
  child=r"""import importlib.util,json,time,sys,signal
p='/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py';sp=importlib.util.spec_from_file_location('L',p);L=importlib.util.module_from_spec(sp);sp.loader.exec_module(L)
e=json.loads(__import__('pathlib').Path('/tmp/pow-audit30-item8-ledger-expectations-v1.json').read_bytes());previous=signal.getsignal(signal.SIGTERM)
class RPC:
 calls=0;bytes=0
 def call(self,method,*args):
  self.calls+=1
  if method=='getblockchaininfo' and self.calls==1:return dict(chain='main',blocks=1,bestblockhash='a'*64),'f'*64
  if L._OPERATOR_INTERRUPTED is None:
   print('ready',flush=True)
   while L._OPERATOR_INTERRUPTED is None:time.sleep(.01)
  raise L.RPCFailure('operator-interrupted',method,args)
L.RPC=RPC;out=L.collect(e,'legacy');print(json.dumps(dict(status=out['status'],expected=out['oracle']['coverage']['expectedTargets'],targets=len(out['targetCapture']),restored=signal.getsignal(signal.SIGTERM)==previous,production=out['productionMutation'])),flush=True)
"""
  childproc=subprocess.Popen(['/usr/bin/python3','-I','-B','-Werror','-c',child],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
   self.assertEqual(childproc.stdout.readline().strip(),'ready');os.kill(childproc.pid,signal.SIGTERM);out,err=childproc.communicate(timeout=3);self.assertEqual(childproc.returncode,0);self.assertEqual(err,'');result=json.loads(out);self.assertEqual(result['status'],'partial-integrity-refused');self.assertEqual(result['expected'],10);self.assertEqual(result['targets'],10);self.assertTrue(result['restored']);self.assertFalse(result['production'])
  finally:
   if childproc.poll() is None:childproc.kill();childproc.wait()
   childproc.stdout.close();childproc.stderr.close()

if __name__=='__main__':unittest.main()
