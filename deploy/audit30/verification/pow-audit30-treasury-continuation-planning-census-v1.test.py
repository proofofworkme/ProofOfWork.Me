import copy,hashlib,importlib.util,json,pathlib,struct,unittest
def module(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
C=module('/tmp/pow-audit30-treasury-continuation-planning-census-v1.py','census')
L=module('/tmp/pow-audit30-item8-ledger-corpus-collector-v2.py','frozenledger')
assert hashlib.sha256(pathlib.Path(L.__file__).read_bytes()).hexdigest()==C.LEDGER_SHA
def tx(prev='0'*64,vout=4294967295,value=546):
 script=bytes.fromhex(L.address_script(C.ADDRESSES[2]));b=bytes.fromhex('0100000001')+bytes.fromhex(prev)[::-1]+struct.pack('<I',vout)+b'\x00'+b'\xff'*4+b'\x01'+struct.pack('<Q',value)+bytes([len(script)])+script+b'\x00'*4
 return L.parse_raw(b.hex())
def normalized(p):
 header=bytes.fromhex('01000000')+b'\x00'*32+bytes.fromhex(p['txid'])[::-1]+b'\x00'*12;block=L.header_proof(header.hex());proof=(header+struct.pack('<I',1)+b'\x01'+bytes.fromhex(p['txid'])[::-1]+b'\x01\x01').hex()
 return p|dict(blockHash=block,confirmationsAtCapture=1,coreInclusionProofHex=proof,coreVerifiedIncludedTxids=[p['txid']]),dict(height=100,headerHex=header.hex(),canonicalHashAtCapture=block)
def fixture():
 t,b=normalized(tx());v=dict(schema='pow-audit30-treasury-address-corpus-v1',addresses=list(C.ADDRESSES),productionMutation=False,status='partial-integrity-refused',chainBefore=dict(height=100,hash='1'*64),electrsBefore=dict(height=100,hash='1'*64),transactions={t['txid']:t},parents={},blocks={t['blockHash']:b},discovery={a:dict(history=[dict(tx_hash=t['txid'],height=100)],unspent=[],balance=dict(confirmed=0,unconfirmed=0))for a in C.ADDRESSES});return v,t
class Tests(unittest.TestCase):
 def test_real_raw_header_single_merkle_and_union(self):
  v,t=fixture();r=C.summarize(v,L);self.assertEqual((r['unionTargetCount'],r['allUniqueRawCacheRows'],r['cachedTargetOfflineSingleMerkleProofs'],r['originalBlocksWithoutClosingHash']),(1,1,1,1));self.assertEqual(r['rpcCalls'],0);self.assertFalse(r['currentBalanceClaim'])
 def test_parent_cache_membership_promotion_needs_new_proof(self):
  v,t=fixture();v['parents']=v.pop('transactions');v['transactions']={};del t['coreInclusionProofHex'];del t['coreVerifiedIncludedTxids'];r=C.summarize(v,L);self.assertEqual(r['targetIdsAlreadyInParentCache'],1);self.assertEqual(r['cachedTargetsRequiringMerkleProof'],1)
 def test_missing_target_counts_not_claimed_complete(self):
  v,t=fixture();v['transactions']={};r=C.summarize(v,L);self.assertEqual(r['missingTargetRawRows'],1);self.assertTrue(r['actualMissingParentsForUncapturedTargetsUnknown'])
 def test_unique_parent_and_prevout_and_reuse(self):
  v,t=fixture();child,b=normalized(tx(t['txid'],0,500));v['parents']={t['txid']:t};v['transactions']={child['txid']:child};v['blocks'][child['blockHash']]=b
  for d in v['discovery'].values():d['history']=[dict(tx_hash=child['txid'],height=100)]
  r=C.summarize(v,L);self.assertEqual((r['knownTargetRequiredUniqueParentTxids'],r['knownTargetRequiredUniquePrevouts'],r['knownTargetRequiredParentsCached'],r['knownTargetRequiredParentsMissing']),(1,1,1,0))
 def test_missing_referenced_parent(self):
  v,t=fixture();child,b=normalized(tx('2'*64,0,500));v['transactions']={child['txid']:child};v['blocks']={child['blockHash']:b}
  for d in v['discovery'].values():d['history']=[dict(tx_hash=child['txid'],height=100)]
  self.assertEqual(C.summarize(v,L)['knownTargetRequiredParentsMissing'],1)
 def test_cached_prevout_out_of_range_refuses(self):
  v,t=fixture();child,b=normalized(tx(t['txid'],5,500));v['parents']={t['txid']:t};v['transactions']={child['txid']:child};v['blocks'][child['blockHash']]=b
  for d in v['discovery'].values():d['history']=[dict(tx_hash=child['txid'],height=100)]
  with self.assertRaises(ValueError):C.summarize(v,L)
 def test_raw_output_drift_refuses(self):
  v,t=fixture();t['outputs']=copy.deepcopy(t['outputs']);t['outputs'][0]['proofs']+=1
  with self.assertRaises(ValueError):C.summarize(v,L)
 def test_duplicate_cache_drift_refuses(self):
  v,t=fixture();v['parents']={t['txid']:copy.deepcopy(t)};v['parents'][t['txid']]['inputs'][0]['vout']=0
  with self.assertRaises(ValueError):C.summarize(v,L)
 def test_valid_merkle_with_empty_matches_refuses(self):
  v,t=fixture();t['coreInclusionProofHex']=t['coreInclusionProofHex'][:-2]+'00'
  with self.assertRaises(ValueError):C.summarize(v,L)
 def test_future_and_boolean_history_height_refuse(self):
  for h in(101,True):
   v,t=fixture();v['discovery'][C.ADDRESSES[0]]['history'][0]['height']=h
   with self.assertRaises(ValueError):C.summarize(v,L)
 def test_completed_or_wrong_scope_refuses(self):
  for field,value in [('status','covered-discovery-corpus-complete'),('productionMutation',True),('addresses',list(reversed(C.ADDRESSES)))]:
   v,t=fixture();v[field]=value
   with self.assertRaises(ValueError):C.summarize(v,L)
if __name__=='__main__':unittest.main()
