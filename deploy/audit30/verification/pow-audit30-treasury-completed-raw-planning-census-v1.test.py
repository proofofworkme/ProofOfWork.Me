import copy,hashlib,importlib.util,json,pathlib,struct,unittest
from unittest import mock
def module(path,name):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
M=module('/tmp/pow-audit30-treasury-completed-raw-planning-census-v1.py','complete_planning')
C=M.load_census()
F=module('/tmp/pow-audit30-treasury-continuation-planning-census-v1.test.py','real_raw_fixture')
L=F.L
def pair():
 seed,t=F.fixture();child,b=F.normalized(F.tx('2'*64,0,500));child.pop('coreInclusionProofHex');child.pop('coreVerifiedIncludedTxids')
 for d in seed['discovery'].values():d['history'].append(dict(tx_hash=child['txid'],height=100))
 rows={child['txid']:child};h=C.digest_set(rows)
 delta=dict(schema='pow-audit30-treasury-missing-raw-target-delta-v1',status='raw-target-delta-complete-with-closing-fences',seedCorpusSha256=C.CORPUS_SHA,closingFencesAccepted=True,captureFailures=[],may9OperatorSettlementPreserved=True,newTransactions=rows,requestedTargetCount=1,requestedTargetSetSha256=h)
 for k in('productionMutation','financialReconciliationComplete','obligationReconciliationComplete','parentCoverageAccepted','canonicalMembershipCoverageAccepted','outpointCoverageAccepted','balanceComparisonPerformed','automaticNextChunk','automaticRetry','may9TransactionIDsRequested'):delta[k]=False
 return seed,delta,h
def completion():
 live={u:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID='1',InvocationID='a'*32)for u in M.LIVE}
 before=dict(InvocationID='b'*32,MainPID='0',Result='success',ExecMainStatus='0',User='bitcoin',Group='bitcoin',Type='exec',Transient='yes',RemainAfterExit='yes')
 after=dict(LoadState='not-found',MainPID='0',InvocationID='')
 v=dict(schema='pow-audit30-treasury-native-outcome-v1',runId=M.RUN,transportAccepted=True,failure=None,seedCorpusOriginalUnchanged=True,seedCorpusSha256=C.CORPUS_SHA,liveBefore=live,liveAfter=copy.deepcopy(live),result=dict(status='raw-target-delta-complete-with-closing-fences',closingFencesAccepted=True,coverage=dict(requested=6650,acquired=6650,remaining=0,coreCalls=6654,coreBytes=1,electrsCalls=20,electrsBytes=1),stdout=dict(path=str(M.E/'corpus.json'),bytes=1,sha256='c'*64),stderr=dict(path=str(M.E/'stderr.log'),bytes=0,sha256=hashlib.sha256(b'').hexdigest())),cleanup=dict(attempted=True,typedExecStart=dict(argvSha256='d'*64),before=before,after=after),backupWindowBefore=dict(service='inactive',timer=dict(ActiveState='active',NextElapseUSecRealtime='known')),backupWindowAfter=dict(service='inactive',timer=dict(ActiveState='active',NextElapseUSecRealtime='known')))
 for k in('productionDataMutation','financialReconciliationComplete','may9TransactionIDsRequested','automaticNextChunk','autoRetry'):v[k]=False
 return v
class Tests(unittest.TestCase):
 def merged(self,seed,delta,h):
  # Only these two data-authority constants are rebound for the small independent algorithm fixture.
  with mock.patch.object(M,'EXPECTED_COUNT',1),mock.patch.object(M,'EXPECTED_MISSING_SHA',h):return M.merge_summary(seed,delta,L,C)
 def test_exact_original_utility_and_native_count_frozen(self):
  raw=pathlib.Path('/tmp/pow-audit30-treasury-continuation-planning-census-v1.py').read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),M.CENSUS_SOURCE_SHA);self.assertEqual(M.EXPECTED_COUNT,6650);self.assertEqual(M.EXPECTED_MISSING_SHA,'07b99a22cca63037d4303d9cb7ec69f6b8ae5d9c005772a43be5b1fc304f8eba')
 def test_real_raw_full_targets_parent_demand_and_qualifications(self):
  s,d,h=pair();out=self.merged(s,d,h);self.assertEqual((out['unionTargetCount'],out['missingTargetRawRows'],out['knownTargetRequiredUniqueParentTxids'],out['knownTargetRequiredParentsMissing'],out['cachedTargetsRequiringMerkleProof']),(2,0,1,1,1));self.assertTrue(out['completeParentDemandNowKnown']);self.assertFalse(out['actualMissingParentsForUncapturedTargetsUnknown']);self.assertFalse(out['financialReconciliationComplete']);self.assertFalse(out['canonicalMembershipCoverageAccepted']);self.assertFalse(out['nextChunkAuthorized']);self.assertEqual(out['rpcCalls'],0)
 def test_new_missing_parent_cached_promotion_counts(self):
  s,d,h=pair();old=next(iter(s['transactions']));new=next(iter(d['newTransactions']));child,b=F.normalized(F.tx(old,0,500));child.pop('coreInclusionProofHex');child.pop('coreVerifiedIncludedTxids');d['newTransactions']={child['txid']:child};d['requestedTargetSetSha256']=h=C.digest_set(d['newTransactions'])
  for x in s['discovery'].values():x['history'][1]['tx_hash']=child['txid']
  out=self.merged(s,d,h);self.assertEqual((out['knownTargetRequiredParentsCached'],out['knownTargetRequiredParentsMissing']),(1,0))
 def test_new_raw_bytes_identity_or_outputs_drift_refuse(self):
  for field,value in [('rawHex','00'),('txid','f'*64),('outputs',[])]:
   s,d,h=pair();next(iter(d['newTransactions'].values()))[field]=value
   with self.assertRaises((ValueError,IndexError)):self.merged(s,d,h)
 def test_unknown_or_duplicate_target_refuse(self):
  s,d,h=pair();old=next(iter(s['transactions']));d['newTransactions']={old:s['transactions'][old]};d['requestedTargetSetSha256']=h=C.digest_set(d['newTransactions'])
  with self.assertRaises(ValueError):self.merged(s,d,h)
 def test_raw_target_missing_or_set_drift_refuse(self):
  s,d,h=pair();d['newTransactions']={}
  with self.assertRaises(ValueError):self.merged(s,d,h)
 def test_false_completeness_or_automatic_chunk_refuses(self):
  for k in('parentCoverageAccepted','canonicalMembershipCoverageAccepted','financialReconciliationComplete','automaticNextChunk'):
   s,d,h=pair();d[k]=True
   with self.assertRaises(ValueError):self.merged(s,d,h)
 def test_seed_attempt_remains_failed(self):
  s,d,h=pair();s['status']='covered-discovery-corpus-complete'
  with self.assertRaises(ValueError):self.merged(s,d,h)
 def test_source_guarded_completion_shape(self):self.assertEqual(M.validate_completion(completion(),C)['coverage']['acquired'],6650)
 def test_partial_or_boolean_counts_refuse(self):
  for k,n in [('acquired',6649),('coreCalls',10001),('coreBytes',256*1024**2+1),('electrsCalls',25),('requested',True)]:
   v=completion();v['result']['coverage'][k]=n
   with self.assertRaises(ValueError):M.validate_completion(v,C)
 def test_live_or_seed_drift_refuses(self):
  for mutate in(lambda v:v['liveAfter'][M.LIVE[0]].update(MainPID='2'),lambda v:v.update(seedCorpusOriginalUnchanged=False)):
   v=completion();mutate(v)
   with self.assertRaises(ValueError):M.validate_completion(v,C)
 def test_wrong_or_unstopped_owned_invocation_refuses(self):
  for mutate in(lambda v:v['cleanup']['after'].update(LoadState='loaded',MainPID='1'),lambda v:v['cleanup']['before'].update(User='root'),lambda v:v['cleanup'].update(attempted=False)):
   v=completion();mutate(v)
   with self.assertRaises(ValueError):M.validate_completion(v,C)
 def test_backup_or_capture_redirection_refuses(self):
  for mutate in(lambda v:v['backupWindowAfter']['timer'].update(NextElapseUSecRealtime='changed'),lambda v:v['result']['stdout'].update(path='/tmp/elsewhere'),lambda v:v['result']['stderr'].update(bytes=1)):
   v=completion();mutate(v)
   with self.assertRaises(ValueError):M.validate_completion(v,C)
 def test_fresh_endpoint_qualifies_gc_and_refuses_new_invocation(self):
  v=completion();responses={**v['liveBefore'],M.UNIT:dict(LoadState='not-found',MainPID='0',InvocationID='',ActiveState='inactive',SubState='dead')}
  with mock.patch.object(M,'state',side_effect=responses.__getitem__):self.assertTrue(M.current_context(v)['ownedStopped'])
  responses[M.UNIT]=dict(LoadState='loaded',MainPID='0',InvocationID='f'*32,ActiveState='failed',SubState='failed')
  with mock.patch.object(M,'state',side_effect=responses.__getitem__):
   with self.assertRaises(ValueError):M.current_context(v)
 def test_duplicate_json_and_full_stat_metadata_fence(self):
  with self.assertRaises(ValueError):C.pairs([('x',1),('x',2)])
  m=dict(device=1,inode=2,mode=384,uid=0,gid=0,nlink=1,bytes=4,mtimeNs=5,ctimeNs=6);self.assertEqual(M.captured_metadata(m),[1,2,33152,0,0,1,4,5,6])
if __name__=='__main__':unittest.main()
