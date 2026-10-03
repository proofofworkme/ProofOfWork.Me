import copy,importlib.util,pathlib,re,unittest
spec=importlib.util.spec_from_file_location('guard','/tmp/pow-audit30-worker-mail-exclusion-guard-v3.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):self.row={'transactionReadOnly':'on','checkpoint':{'indexed_through_block':969652,'checkpoint_hash':'a'*64},'worker':{'state':'idle','network':'livenet','backfillSources':'block-scan,mempool-scan','workPrecisionEra':'q16','activePwtRangeReplay':False,'backfillPhases':[{'kind':'confirmed','sources':['block-scan']},{'kind':'best-effort-pending','sources':['mempool-scan']}]},'rebuild':{'status':'complete','active':False,'complete':True,'recursiveActivePwtRangeReplay':False,'activePwtRangeReplay':False},'workDefinition':{'amountStorageModel':'work-subatoms-v2','precisionModel':'canonical-work-subatoms-v2'}};self.env={'NETWORK':'livenet','POW_INDEX_WORKER_BACKFILL_SOURCES':'block-scan,mempool-scan'}
 def check(self):return m.validate_observations(self.row,self.env,'a'*64)
 def test_exact_nonrepair_state_pass(self):self.assertTrue(self.check())
 def test_checkpoint_equal_or_below_targets_refuses(self):
  self.row['checkpoint']['indexed_through_block']=962933
  with self.assertRaisesRegex(ValueError,'CHECKPOINT_NOT_ABOVE'):self.check()
 def test_noncanonical_checkpoint_refuses(self):
  with self.assertRaisesRegex(ValueError,'CHECKPOINT_NOT_CANONICAL'):m.validate_observations(self.row,self.env,'b'*64)
 def test_repair_flags_presence_refuses_even_zero(self):
  for name in m.FORBIDDEN:
   with self.subTest(name=name):
    self.env[name]='0'
    with self.assertRaisesRegex(ValueError,'RUNTIME_REPAIR_OVERRIDE'):self.check()
    del self.env[name]
 def test_history_source_refuses(self):
  self.env['POW_INDEX_WORKER_BACKFILL_SOURCES']='block-scan,mempool-scan,address-mail'
  with self.assertRaisesRegex(ValueError,'RUNTIME_SOURCE_SET'):self.check()
 def test_active_rebuild_refuses(self):
  self.row['rebuild']['active']=True
  with self.assertRaisesRegex(ValueError,'REBUILD_ACTIVE'):self.check()
 def test_incomplete_rebuild_refuses(self):
  self.row['rebuild']['complete']=False
  with self.assertRaisesRegex(ValueError,'REBUILD_ACTIVE'):self.check()
 def test_q8_worker_refuses(self):
  self.row['worker']['workPrecisionEra']='q8'
  with self.assertRaisesRegex(ValueError,'WORKER_STATE'):self.check()
 def test_nonreadOnly_refuses(self):
  self.row['transactionReadOnly']='off'
  with self.assertRaisesRegex(ValueError,'SQL_NOT_READ_ONLY'):self.check()
 def test_checkpoint_sql_exact_production_predicates(self):
  source=pathlib.Path('/home/sixer/ProofOfWork.Me/scripts/run-proof-indexer-worker.mjs').read_text();sql=re.search(r'export const AUTHORITATIVE_WORKER_CHECKPOINT_SQL = `(.*?)`;',source,re.S)[1].replace('$1',"'livenet'");compact=lambda s:re.sub(r'\s+','',s)
  self.assertIn(compact(sql),compact(m.SQL))
 def test_worker_recursive_active_flag_refuses(self):
  self.row['worker']['activePwtRangeReplay']=True
  with self.assertRaisesRegex(ValueError,'WORKER_RANGE_REPLAY'):self.check()
 def test_worker_recursive_absent_flag_refuses(self):
  del self.row['worker']['activePwtRangeReplay']
  with self.assertRaisesRegex(ValueError,'WORKER_RANGE_REPLAY'):self.check()
 def test_absent_phase_plan_refuses(self):
  del self.row['worker']['backfillPhases']
  with self.assertRaisesRegex(ValueError,'WORKER_PHASE_PLAN'):self.check()
 def test_phase_plan_order_and_source_refuse(self):
  self.row['worker']['backfillPhases'].reverse()
  with self.assertRaisesRegex(ValueError,'WORKER_PHASE_PLAN'):self.check()
  self.setUp();self.row['worker']['backfillPhases'][0]['sources'].append('address-mail')
  with self.assertRaisesRegex(ValueError,'WORKER_PHASE_PLAN'):self.check()
 def test_rebuild_recursive_active_flag_refuses(self):
  self.row['rebuild']['recursiveActivePwtRangeReplay']=True
  with self.assertRaisesRegex(ValueError,'REBUILD_RANGE_REPLAY'):self.check()
 def test_rebuild_flag_unknown_refuses(self):
  del self.row['rebuild']['activePwtRangeReplay']
  with self.assertRaisesRegex(ValueError,'REBUILD_RANGE_REPLAY'):self.check()
 def pwt(self):
  self.row['rebuild'].update(mode='pwt-range-replay',network='livenet',rangeReplayFromHeight=958383,completedAt='2026-10-02T01:00:00Z',verificationObjectPresent=True)
 def test_pwt_completed_shallow_shape_pass(self):self.pwt();self.assertTrue(self.check())
 def test_pwt_completed_wrong_shape_refuses(self):
  for key,value in [('network','testnet'),('rangeReplayFromHeight',True),('rangeReplayFromHeight',0),('rangeReplayFromHeight',99999999),('verificationObjectPresent',False),('completedAt','')]:
   with self.subTest(key=key,value=value):
    self.setUp();self.pwt();self.row['rebuild'][key]=value
    with self.assertRaisesRegex(ValueError,'REBUILD_RANGE_REPLAY_COMPLETION_SHAPE'):self.check()
 def test_pwt_date_invalid_or_without_zone_refuses(self):
  for date in ['garbage','2026-10-02T01:00:00']:
   self.setUp();self.pwt();self.row['rebuild']['completedAt']=date
   with self.assertRaisesRegex(ValueError,'REBUILD_RANGE_REPLAY_COMPLETION_DATE'):self.check()
 def test_source_defined_active_predicate_sql_and_recursive_shape(self):
  self.assertIn("'$.**.activePwtRangeReplay ? (@ == true)'",m.SQL)
  self.assertIn("value->>'mode'='pwt-range-replay' AND value->>'status'='active'",m.SQL)
  self.assertIn("value->'active'='true'::jsonb AND value->'complete'='false'::jsonb",m.SQL)
  self.assertIn("jsonb_array_elements(value->'backfillPhases') WITH ORDINALITY",m.SQL)
 def test_maximum_source_lookback_cannot_reach_target(self):
  self.row['checkpoint']['indexed_through_block']=962933+144
  with self.assertRaisesRegex(ValueError,'CHECKPOINT_REORG_LOOKBACK'):self.check()
  self.row['checkpoint']['indexed_through_block']+=1;self.assertTrue(self.check())
 def test_canonical_fault_active_or_invalid_refuses(self):
  for fault in [{'active':True,'activeBoolean':True},{'active':False,'activeBoolean':False},{'active':False}]:
   with self.subTest(fault=fault):
    self.row['fault']=fault
    with self.assertRaisesRegex(ValueError,'CANONICAL_FAULT'):self.check()
 def test_canonical_fault_known_inactive_pass(self):self.row['fault']={'active':False,'activeBoolean':True};self.assertTrue(self.check())
 def test_exact_worker_source_and_reorg_default_pins(self):
  import hashlib
  for name,pin in m.SOURCE_PINS.items():self.assertEqual(hashlib.sha256(pathlib.Path('/home/sixer/ProofOfWork.Me',name).read_bytes()).hexdigest(),pin)
  source=pathlib.Path('/home/sixer/ProofOfWork.Me/scripts/backfill-proof-indexer.mjs').read_text()
  self.assertIn('const firstHeight = latestIndexedHeight + 1;',source)
  self.assertIn('const lowerHeight = Math.max(0, upperHeight - depth);',source)
  self.assertRegex(source,r'CANONICAL_SHALLOW_REORG_RECOVERY_MAX_DEPTH = Math.max\(\s*1,\s*Math.min\(\s*144,')
  self.assertEqual(m.SHALLOW_REORG_MAX_DEPTH,144)
if __name__=='__main__':unittest.main()
