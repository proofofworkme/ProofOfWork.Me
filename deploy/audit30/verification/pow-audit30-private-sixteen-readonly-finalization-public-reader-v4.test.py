#!/usr/bin/python3 -I
import ast,copy,hashlib,json,pathlib,types,unittest
BASE=pathlib.Path('/tmp')
def module(name):
 p=BASE/name;m=types.ModuleType(name);m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
M=module('pow-audit30-private-sixteen-readonly-finalization-public-reader-v4.py')
OLD=module('pow-audit30-private-sixteen-readonly-finalization-public-reader-v3.py')
class Tests(unittest.TestCase):
 def setUp(self):
  raw=(BASE/'pow-audit30-cluster-inventory-native-v1.json').read_bytes()
  self.assertEqual(len(raw),440008);self.assertEqual(hashlib.sha256(raw).hexdigest(),'f30301ca4f4769cfbbd995dc7627580be543e6cddfc1f5b3ff4aba033a48f572')
  self.snapshot=json.loads(raw)['snapshot'];vals={}
  for n in ast.parse((BASE/'pow-audit30-private-sixteen-readonly-finalization-v1.py').read_bytes()).body:
   if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and n.targets[0].id in ('SAVED_RECEIPTS','SAVED_PRIOR','MATH_ACCOUNTING'):vals[n.targets[0].id]=ast.literal_eval(n.value)
  ack=json.loads((BASE/'pow-audit30-private-sixteen-reconcile-native-v1.stdout').read_bytes())['adapterProof']
  f={'count':0,'logical_bytes':'0','sha256':'0'*64};v=dict.fromkeys(M.COMPLETED_KEYS)
  v.update(schema='pow-audit30-private-sixteen-readonly-finalization-completed-v1',status='passed',planSha256='bc8803c60e4f1cb2615bf6e6258ec10b04ff7c40a9a2f951dc4bafb42056acdc',reconciliationReceiptSha256='79d4eb412b9c34825c3c88758088fdd5f5a29eeb9844d158036b0168990b4901',streamCompletedSha256='974e16cfb288e19e7320fa87687d32cff65b2a58296b4e94893ddbdfaea3c841',mathCompletedSha256='3d65f98e03aa341eed849d1506339ccd66af443d6fcf9cf33e794cd4073edcaf',adapterProof=ack,savedReceiptBindings=vals['SAVED_RECEIPTS'],originalFailureBindings=vals['SAVED_PRIOR'],rootPrivateMathAccounting=vals['MATH_ACCOUNTING'],currentReadOnlyState=dict(currentCompleteMailFingerprint={'count':619,'logical_bytes':'1798351','sha256':'2075b8261fdd5f09b2c04370dcd0014c0d25e240f249966baf66a9952696e181'},currentJournalFingerprint={'queue':copy.deepcopy(f),'shards':copy.deepcopy(f),'meta':copy.deepcopy(f)},samePrivateDatabaseIdentity=True,explicitReadOnlyTransaction=True,currentSavedFence=copy.deepcopy(self.snapshot)),wholeSeconds=88)
  for k in ('originalAttemptRemainsFailed','crossTransactionFullMailFingerprintRestored','sealedSourceFullHashVerifiedBeforeStart','sealedSourceFullHashVerifiedAtStop','privateClusterStopped','offlinePrivatePagesChecked','liveServicesUnchanged','backupWindowRecheckedAtStop','sourceAndAllEvidenceRetained','operationalReadinessTwoLegitimateInvalidations','rootPrivateMathFullAllocationCharged'):v[k]=True
  for k in ('writerInvoked','applyInvoked','inverseInvoked','productionMutation','sealedSourceStarted','automaticRetry','operationalEpochRewind'):v[k]=False
  self.value=v
 def test_actual_hash_bound_f303_snapshot_is_accepted(self):
  M.validate_completed(self.value)
 def test_preserved_v3_refuses_actual_rich_snapshot(self):
  with self.assertRaisesRegex(ValueError,'Exact immutable saved snapshot fence'):OLD.validate_completed(self.value)
 def test_all_actual_snapshot_components_remain_exact(self):
  for name in ('canonicalHeight','canonicalHash','confirmedTransactionMaxHeight','precisionActivationHeight','precisionMarkerStatus','transitionMaxHash','transitionMaxHeight'):
   with self.subTest(name=name):
    v=copy.deepcopy(self.value);s=v['currentReadOnlyState']['currentSavedFence']
    if name=='canonicalHeight':s['canonicalBlock']['height']+=1
    elif name=='canonicalHash':s['canonicalBlock']['hash']='1'*64
    elif name=='precisionActivationHeight':s[name]=960601
    elif name=='precisionMarkerStatus':s[name]='pending'
    elif name=='transitionMaxHash':s[name]='1'*64
    else:s[name]+=1
    with self.assertRaisesRegex(ValueError,'Exact immutable saved snapshot fence'):M.validate_completed(v)
 def test_snapshot_missing_extra_or_flat_projection_refuses(self):
  for change in ('missing','extra','flat'):
   with self.subTest(change=change):
    v=copy.deepcopy(self.value);s=v['currentReadOnlyState']['currentSavedFence']
    if change=='missing':s.pop('confirmedTransactionMaxHeight')
    elif change=='extra':s['body']='private'
    else:v['currentReadOnlyState']['currentSavedFence']={'height':969526,'hash':s['canonicalBlock']['hash'],'transitionHeight':969526,'transitionHash':s['transitionMaxHash']}
    with self.assertRaises(ValueError):M.validate_completed(v)
 def test_public_body_and_changed_prior_proof_are_refused(self):
  for change in ('body','targetCount','sourceAfter','mailHash','metadata'):
   with self.subTest(change=change):
    v=copy.deepcopy(self.value)
    if change=='body':v['rawBody']='private'
    elif change=='targetCount':v['adapterProof']['targetCount']=15
    elif change=='sourceAfter':v['sealedSourceFullHashVerifiedAtStop']=False
    elif change=='mailHash':v['currentReadOnlyState']['currentCompleteMailFingerprint']['sha256']='1'*64
    else:v['savedReceiptBindings']['apply-completed.json']['path']='/private'
    with self.assertRaises(ValueError):M.validate_completed(v)
 def test_exact_helper_and_main_scope_is_unchanged(self):
  names=lambda text:{n.name:ast.get_source_segment(text,n)for n in ast.parse(text).body if isinstance(n,ast.FunctionDef)}
  old=names((BASE/'pow-audit30-private-sixteen-readonly-finalization-public-reader-v3.py').read_text());new=names((BASE/'pow-audit30-private-sixteen-readonly-finalization-public-reader-v4.py').read_text())
  for name in ('fixed_file','unit','postgres_endpoints','pairs','meta'):self.assertEqual(old[name],new[name])
  self.assertEqual(old['main'].replace('public-endpoint-v3','public-endpoint-v4'),new['main'])
 def test_duplicate_json_keys_refuse(self):
  with self.assertRaises(ValueError):json.loads('{"schema":"a","schema":"b"}',object_pairs_hook=M.pairs)
if __name__=='__main__':unittest.main()
