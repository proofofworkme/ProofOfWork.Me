#!/usr/bin/python3 -I
"""Pure receipt-chain fixtures; no service, Core, database or runtime access."""
import base64,copy,importlib.util,json,os,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('approval',Path(__file__).with_name('prepare-composed-approval.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
validator_path=Path(os.environ.get('POW_REPLAY_CONTROLLER_TEST_PATH',str(Path(__file__).parent.parent/'work-batch-replay/scoped-node.py')));validator_bytes=validator_path.read_bytes();v={'__name__':'_approval_fixture_replay_validator','__file__':str(validator_path)};exec(compile(validator_bytes,str(validator_path),'exec'),v)
C='f'*40;T='e'*40;H='d'*40;N='c'*64;META={'uid':1000,'gid':1000,'mode':0o640}
def raw(v):return m.canonical(v)
def digest(v):return m.sha(raw(v))
def commitment(label):return {'model':'fixture','payloadBytes':10,'sha256':m.sha(label.encode())}
def bind_event_set_fixture(row,derived=0):
    count=row['protocolRecordCount'];events=count+derived
    old={'model':'canonical-work-amo-event-set-sha256-v1','payloadBytes':100,'sha256':'a'*64,'eventCount':events}
    new={**old,'sha256':'b'*64 if derived else old['sha256']}
    scalar={'event_set_sha256':old['sha256'],'event_count':events,
        'protocol_record_count':count,'raw_protocol_candidate_count':row['rawProtocolCandidateCount'],
        'created_at':'2026-10-26T00:00:00Z','credit_supply':'100'}
    row.update(derivedEventCount=derived,eventCount=events,eventSetProvenanceOnly=True,
        oldEventSetCommitment=old,newEventSetCommitment=new,oldScalarMetadata=scalar,
        newScalarMetadata={**scalar,'event_set_sha256':new['sha256']})
    row['oldScalarMetadataSha256']=v['stable_json_sha256'](row['oldScalarMetadata'])
    row['newScalarMetadataSha256']=v['stable_json_sha256'](row['newScalarMetadata'])
    row['relationalBindings'].update(eventCount=events,recordCount=count)
    row['replacementFields']['eventSetCommitment']=new
    row['allowedChangedFields']=sorted((set(row['allowedChangedFields'])-{'eventSetCommitment'})|
        ({'eventSetCommitment'} if derived else set()))
    return row

class Fixture:
 def __init__(self):
  self.trees={m.B3:'1'*40,m.A3:'2'*40,C:T};self.hashes={k:m.sha(k.encode())for k in m.SOURCE_FILES};self.ancestor=lambda a,b:True
  initial=(m.SCOPES[0]-m.NEW[0])|{'server/db/native-transition-storage.mjs','package.json','package-lock.json','server/retained.mjs'}
  current={k:m.sha(('old '+k).encode())for k in initial};self.manifests=[];self.receipts=[]
  for i,scope in enumerate(m.SCOPES):
   dependencies=dict(current);rows=[]
   for name in sorted(scope):
    content=('layer'+str(i)+' '+name).encode();rows.append({'path':name,'before':current.get(name),'after':m.sha(content),'base64':base64.b64encode(content).decode()});current[name]=m.sha(content)
   manifest={'format':m.FORMATS[i],'sourceCommit':(m.B3,m.A3,C)[i],'baseSourceCommit':m.BASE if i<2 else m.A3,'baselineHead':H,'nodeSha256':N,'releaseId':'fixture-'+str(i),'sources':rows,'sourceMetadata':{k:dict(META)for k in scope},'dependencies':dependencies,'dependencyMetadata':{k:dict(META)for k in dependencies}}
   if i==2:manifest.update(sourceTree=T,replaySourceManifest={'sha256':'a'*64})
   receipt={'format':manifest['format'],'sourceCommit':manifest['sourceCommit'],'baseSourceCommit':manifest['baseSourceCommit'],'baselineHead':H,'releaseId':manifest['releaseId'],'sources':[{k:x[k]for k in ('path','before','after')}for x in rows],'sourceMetadata':copy.deepcopy(manifest['sourceMetadata']),'dependencyCount':len(dependencies),'installed':True,'rolledBack':False,'sourceWritesStarted':True,'completedAt':'2026-10-25T20:00:00Z','servicesAfter':{name:{'ActiveState':'active','WorkingDirectory':'/opt/proofofwork-api','MainPID':'123'}for name in ('proofofwork-api.service','proofofwork-indexer-worker.service')}}
   if i==2:receipt['sourceTree']=T
   self.manifests.append(manifest);self.receipts.append(receipt)
  self.final_runtime=current
  decl={'txid':m.TX,'blockHeight':973103,'blockHash':m.D_HASH,'blockTransactionIndex':1621,'protocolVout':1,'recordOrdinal':0,'registryPaymentVout':2,'activationHeight':973104,'authorityScriptPubKey':'76a91499b91dd27a616a71c0a1e9db6a86ceb8cff284c588ac','registryAddress':'1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV','minimumPaymentSats':546,'payloadBytes':5965,'payloadSha256':'f1527f240dcc7210ef7bb5ebd33417fbecb1c8ea8dcc1b2bf2917f42b7e20ae4'}
  evidence={'model':'canonical-work-batch-v1-authority-commitment-v1','payloadBytes':651,'sha256':'7304382c42414dfd4b37a289b19b7e23cf0c02d32fd681acaeeef7956f79c1bc'}
  block={'height':973104,'hash':'b'*64,'oldNativeSha256':'c'*64,'newNativeSha256':'d'*64,'replacementFields':{'workBatchV1':{'activationHeight':973104},'transitionChainCommitment':commitment('new')},'allowedChangedFields':['transitionChainCommitment','workBatchV1'],'rawProtocolCandidateCount':0,'protocolRecordCount':0,'batchLookingCount':0}
  for k in ('baselineExactlyReproduced','compatibilityDeterministic','economicStateEqual','workGenericIdStateEqual','projectionEqual','eventsAndFeesEqual','emptyEventSetVerified'):block[k]=True
  marker={'model':'canonical-work-batch-v1-activation-marker-v1','network':'livenet','activationHeight':973104,'declaration':decl,'evidenceCommitment':evidence,'activationBlock':{'height':973104,'hash':block['hash'],'previousBlockHash':m.D_HASH,'transitionChainCommitment':block['replacementFields']['transitionChainCommitment']}}
  self.q={'format':'work-batch-bounded-reseal-qualification-v4','mode':'after-drain','sourceState':'committed','qualified':True,'readOnly':True,'liveModified':False,'relationalEmptySuffixVerified':True,'earliestSelection':{'verified':True},'fixedPrefixRemainsCanonical':True,'sourceCommit':C,'sourceTree':T,'sourceManifestSha256':'a'*64,'runtimeSources':{x['path']:x['after']for x in self.manifests[-1]['sources']},'declaration':{**decl,'signatureVerified':True,'inputPrevoutsVerified':1,'evidenceCommitment':evidence},'anchor':{'height':973103,'hash':m.D_HASH},'proposedMarker':marker,'maxSuffixBlocks':512,'blocks':[block],'fixedPrefix':{'from':973104,'through':973104,'hash':block['hash'],'rebuildSha256':'1'*64},'checkpoint':{'snapshotId':'checkpoint','height':973104,'hash':block['hash']},'canonicalRebuild':{'complete':True},'databaseName':'fixture','databaseEndpoint':{'port':55431,'unixSocketDirectories':'/tmp/private-fixture'}}
  block.update(nativePayloadBytes=100,oldNativeBytes=100,newNativeBytes=120,rawBlockBytes=1000,oldScalarMetadataSha256='8'*64,newScalarMetadataSha256='8'*64,currentMainRowSha256='9'*64,relationalBindings={'eventCount':0,'recordCount':0,'eventRowsSha256':'a'*64,'recordRowsSha256':'b'*64},ordinaryEventSetVerified=True,ordinaryRecordsVerified=True,ordinaryDerivedClosuresVerified=True)
  block['replacementFields'].update(replayRecords=[],traces=[],replayDescriptorCommitment=commitment('empty'))
  self.q.update(verifierSha256='0'*64,firstPartySourceHashes={},nodeSha256=N,declarationTxid=m.TX,nativeCatalogSha256='a'*64,resourceLimits=copy.deepcopy(v['REPLAY_RESOURCE_LIMITS']),resourceUsage={'nativePayloadBytes':100,'newNativePayloadBytes':120,'rawBlockBytes':1000,'ordinaryRecords':0},ordinaryRelationalSuffixVerified=True,fullRawSuffixVerified=True,ordinaryDerivedClosuresVerified=True,noBatchLookingRecordsVerified=True)
  self.q['canonicalRebuild'].update(indexedThroughBlock=973104,indexedThroughBlockHash=block['hash'],active=False)
  bind_event_set_fixture(block)
  self.prior=copy.deepcopy(self.q);self.prior['mode']='before-drain'
  self.prepared={'format':'work-batch-native-supersession-dispatch-v1','status':'rendered-only','committed':False,'manifestSha256':'5'*64,'sqlSha256':'6'*64}
  self.native={'format':'work-batch-native-supersession-dispatch-v1','status':'committed','committed':True,'postconditionsVerified':True,'commitSent':True,'returncode':0,'fenceError':None,'manifestSha256':'5'*64,'sqlSha256':'6'*64,'result':{'format':'work-batch-native-supersession-result-v1','manifestSha256':'5'*64,'originalArchivesRetained':True,'oldChunksRetained':True,'currentMetadataVerified':True,'markerVerified':True,'marker':copy.deepcopy(marker),'blocks':[{**{k:block[k]for k in ('height','hash','oldNativeSha256','newNativeSha256','oldScalarMetadataSha256','newScalarMetadataSha256')},'originalArchiveRetained':True,'hotSlotVerified':True,'currentMetadataVerified':True,'originalScalarsPreserved':True,'currentScalarsQualified':True,'historicalReadVerified':True,'relationalRowsVerified':True,'cacheMode':'hot'}]}}
  self.receipts[-1]['writesDisabledStatus']={'protocol':'work-batch-v1','network':'livenet','active':True,'writeEnabled':False,'ready':False,'declarationTxid':m.TX,'activationHeight':973104,'limits':{'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536},'registryFeeProofs':546,'reasonCode':'work-batch-writes-disabled','checkedTipHeight':973104,'checkedTipHash':block['hash']}
 def args(self):
  prior=raw(self.prior);self.q['priorManifestSha256']=m.sha(prior);self.q['cacheRevalidation']={'model':'work-batch-qualified-prefix-cache-v1','priorManifestSha256':m.sha(prior),'from':973104,'through':self.prior['fixedPrefix']['through'],'blocks':len(self.prior['blocks']),'priorBlocksSha256':v['stable_json_sha256'](self.prior['blocks']),'canonicalPrefixVerified':True,'nativeAndScalarBindingsVerified':True,'relationalBindingsVerified':True,'closingStateAndProjectionVerified':True};qualification=raw(self.q);self.native['result']['qualificationSha256']=m.sha(qualification);native=raw(self.native);prepared=raw(self.prepared)
  r=self.receipts[-1];r['boundaryBefore']={'sha256':m.sha(prior)};r['boundaryAfterDrain']={'sha256':m.sha(qualification)};r['publicationPrepared']={'sha256':m.sha(prepared),'manifestSha256':self.prepared['manifestSha256'],'sqlSha256':self.prepared['sqlSha256']};r['replayPublication']={'sha256':m.sha(native),'committed':True,'postconditionsVerified':True,'manifestSha256':self.native['manifestSha256'],'qualificationSha256':m.sha(qualification),'through':self.q['fixedPrefix']['through'],'blocks':len(self.q['blocks'])}
  layers=[]
  for manifest,receipt in zip(self.manifests,self.receipts):
   content=raw(manifest);receipt['manifestSha256']=m.sha(content);layers.append((content,raw(receipt)))
  return [layers,C,T,self.hashes,'7'*64,'/opt/node-v24.18.0-linux-x64/bin/node',self.trees,self.ancestor,native,qualification,prior,prepared,v]
 def derive(self):return m.derive(*self.args())
class CompositionTests(unittest.TestCase):
 def test_exact_chain_preserves_prior_closure_and_applies_only_ordered_after_bytes(self):
  f=Fixture();result=f.derive();self.assertEqual(result['format'],'work-batch-activation-approval-v1');self.assertEqual({k:v['sha256']for k,v in result['runtime'].items()},f.final_runtime);self.assertEqual(result['runtime']['server/retained.mjs']['sha256'],m.sha(b'old server/retained.mjs'));self.assertEqual([x['sourceCommit']for x in result['composition']['layers']],[m.B3,m.A3,C]);self.assertEqual(result['runtimeStatusSha256'],'7'*64)
 def test_historical_tree_omission_is_allowed_but_wrong_claim_is_not(self):
  f=Fixture();self.assertNotIn('sourceTree',f.manifests[0]);f.derive();f.manifests[0]['sourceTree']='9'*40
  with self.assertRaisesRegex(ValueError,'tree'):f.derive()
 def test_layer_reordering_or_missing_layer_refused(self):
  args=Fixture().args();args[0][0],args[0][1]=args[0][1],args[0][0]
  with self.assertRaises(ValueError):m.derive(*args)
  args=Fixture().args();args[0].pop()
  with self.assertRaises(ValueError):m.derive(*args)
 def test_git_lineage_final_tree_and_controller_pin_must_match(self):
  for change in (lambda f:setattr(f,'ancestor',lambda a,b:False),lambda f:f.trees.__setitem__(C,'0'*40),lambda f:f.hashes.pop('probeSha256')):
   f=Fixture();change(f)
   with self.assertRaises(ValueError):f.derive()
 def test_runtime_node_and_head_change_refused(self):
  for key,value in (('nodeSha256','0'*64),('baselineHead','0'*40)):
   f=Fixture();f.manifests[1][key]=value
   with self.assertRaises(ValueError):f.derive()
 def test_failed_rolled_back_or_incomplete_receipts_refused(self):
  for index in range(3):
   for key,value in (('installed',False),('rolledBack',True),('completedAt',None),('sourceWritesStarted',False),('forwardRecoveryRequired',True),('errorClass','Failure')):
    f=Fixture();f.receipts[index][key]=value
    with self.assertRaises(ValueError,msg=(index,key)):f.derive()
 def test_scope_expansion_and_extra_creation_refused(self):
  f=Fixture();f.manifests[2]['sources'].append(dict(f.manifests[2]['sources'][0]))
  with self.assertRaises(ValueError):f.derive()
  f=Fixture();f.manifests[2]['sources'][0]['before']=None
  with self.assertRaises(ValueError):f.derive()
 def test_candidate_base64_bytes_and_before_hash_are_fenced(self):
  for key,value in (('base64',base64.b64encode(b'other').decode()),('before','0'*64)):
   f=Fixture();f.manifests[1]['sources'][1][key]=value
   with self.assertRaises(ValueError):f.derive()
 def test_dependency_overlap_drift_unknown_dependency_and_metadata_drift_refused(self):
  for change in (lambda x:x['dependencies'].__setitem__('server/retained.mjs','0'*64),lambda x:(x['dependencies'].__setitem__('server/unreviewed.mjs','0'*64),x['dependencyMetadata'].__setitem__('server/unreviewed.mjs',dict(META))),lambda x:x['dependencyMetadata']['package.json'].__setitem__('mode',0o600)):
   f=Fixture();change(f.manifests[1])
   with self.assertRaises(ValueError):f.derive()
 def test_source_metadata_and_missing_dependency_metadata_refused(self):
  for change in (lambda f:f.manifests[2]['sourceMetadata']['server/proof-api.mjs'].__setitem__('mode',0o600),lambda f:f.manifests[2]['dependencyMetadata'].pop('package.json')):
   f=Fixture();change(f)
   with self.assertRaises(ValueError):f.derive()
 def test_native_commit_and_evidence_retention_failures_refused(self):
  for change in (lambda f:f.native.__setitem__('committed',False),lambda f:f.native.__setitem__('returncode',1),lambda f:f.native.__setitem__('sqlSha256','0'*64),lambda f:f.native['result'].__setitem__('originalArchivesRetained',False),lambda f:f.native['result']['blocks'][0].__setitem__('newNativeSha256','0'*64),lambda f:f.native['result']['blocks'][0].__setitem__('hotSlotVerified',False)):
   f=Fixture();change(f)
   with self.assertRaises(ValueError):f.derive()
 def test_native_block_current_metadata_and_original_scalars_required(self):
  for key in ('currentMetadataVerified','originalScalarsPreserved','currentScalarsQualified','historicalReadVerified','relationalRowsVerified'):
   for missing in (False,True):
    f=Fixture();block=f.native['result']['blocks'][0]
    if missing:block.pop(key)
    else:block[key]=False
    with self.assertRaisesRegex(ValueError,'Published block differs'):f.derive()
 def test_exact_original_marker_authority_and_tuple_required(self):
  for key,value in (('txid','0'*64),('registryPaymentVout',0),('minimumPaymentSats',545),('authorityScriptPubKey','00'),('payloadSha256','0'*64)):
   f=Fixture();f.q['proposedMarker']['declaration'][key]=value;f.prior=copy.deepcopy(f.q);f.prior['mode']='before-drain';f.native['result']['marker']=copy.deepcopy(f.q['proposedMarker'])
   with self.assertRaises(ValueError,msg=key):f.derive()
 def test_canonical_prefix_earliest_signature_and_state_equality_required(self):
  for change in (lambda q:q['earliestSelection'].__setitem__('verified',False),lambda q:q.__setitem__('sourceState','reviewed-patch-proposal'),lambda q:q['declaration'].__setitem__('signatureVerified',False),lambda q:q['blocks'][0].__setitem__('economicStateEqual',False),lambda q:q['blocks'][0].__setitem__('rawProtocolCandidateCount',1)):
   f=Fixture();change(f.q);f.prior=copy.deepcopy(f.q);f.prior['mode']='before-drain'
   with self.assertRaises(ValueError):f.derive()
 def test_after_drain_extension_checkpoint_endpoint_or_payload_change_refused(self):
  for change in (lambda q:q['fixedPrefix'].__setitem__('through',973105),lambda q:q['checkpoint'].__setitem__('hash','0'*64),lambda q:q['databaseEndpoint'].__setitem__('port',5432),lambda q:q['blocks'][0].__setitem__('newNativeSha256','0'*64)):
   f=Fixture();change(f.q)
   with self.assertRaises(ValueError):f.derive()
 def test_exact_revalidated_prefix_can_extend_with_preserved_ordinary_evidence(self):
  f=Fixture();q=f.q;row=copy.deepcopy(q['blocks'][0]);row.update(height=973105,hash='e'*64,protocolRecordCount=1,rawProtocolCandidateCount=1,emptyEventSetVerified=False);row['relationalBindings'].update(eventCount=1,recordCount=1);row['replacementFields']['replayRecords']=[{'rawCandidate':True,'rawWitness':{'text':'é\u2028𐀀'},'derived':[]}];bind_event_set_fixture(row);q['blocks'].append(row);q['fixedPrefix'].update(through=973105,hash=row['hash']);q['checkpoint'].update(height=973105,hash=row['hash']);q['canonicalRebuild'].update(indexedThroughBlock=973105,indexedThroughBlockHash=row['hash']);q['resourceUsage']={'nativePayloadBytes':200,'newNativePayloadBytes':240,'rawBlockBytes':2000,'ordinaryRecords':1};published=copy.deepcopy(f.native['result']['blocks'][0]);published.update(**{k:row[k]for k in ('height','hash','oldScalarMetadataSha256','newScalarMetadataSha256')});f.native['result']['blocks'].append(published);f.receipts[-1]['writesDisabledStatus'].update(checkedTipHeight=973105,checkedTipHash=row['hash']);self.assertEqual(f.derive()['composition']['replay']['through'],973105)
 def test_derived_closure_requires_new_scalar_receipt_and_preserves_relational_proof(self):
  f=Fixture();row=f.q['blocks'][0];row.update(protocolRecordCount=1,rawProtocolCandidateCount=1,emptyEventSetVerified=False);bind_event_set_fixture(row,derived=1);f.q['resourceUsage']['ordinaryRecords']=1;f.prior=copy.deepcopy(f.q);f.prior['mode']='before-drain';actual=f.native['result']['blocks'][0]
  actual.update(**{k:row[k]for k in ('oldScalarMetadataSha256','newScalarMetadataSha256')})
  f.derive()
  for key in ('oldScalarMetadataSha256','newScalarMetadataSha256'):
   original=actual[key];actual[key]='0'*64
   with self.assertRaisesRegex(ValueError,'Published block differs'):f.derive()
   actual[key]=original
  f.q['blocks'][0]['newScalarMetadata']['credit_supply']='101'
  with self.assertRaises(ValueError):f.derive()
 def test_legacy_version_or_native_cache_mode_refused(self):
  f=Fixture();f.q['format']='work-batch-bounded-reseal-qualification-v2'
  with self.assertRaises(ValueError):f.derive()
  f=Fixture();f.native['result']['blocks'][0]['cacheMode']='cold'
  with self.assertRaises(ValueError):f.derive()
 def test_active_read_only_postflight_required(self):
  for key,value in (('active',False),('writeEnabled',True),('ready',True),('declarationTxid','0'*64),('checkedTipHeight',973103),('checkedTipHash','0'*64),('registryFeeProofs',547)):
   f=Fixture();f.receipts[-1]['writesDisabledStatus'][key]=value
   with self.assertRaises(ValueError,msg=key):f.derive()
 def test_unrestored_service_receipt_refused(self):
  f=Fixture();f.receipts[2]['servicesAfter']['proofofwork-api.service']['ActiveState']='failed'
  with self.assertRaisesRegex(ValueError,'Services'):f.derive()
 def test_historical_original_byte_pins_cannot_be_replaced(self):
  refs=[{'manifest':{'sha256':a},'receipt':{'sha256':b}}for a,b in m.HISTORICAL_PINS]+[{}];chain={'format':'work-batch-activation-composition-input-v1','layers':refs};self.assertEqual(m.validate_chain_references(chain),refs)
  for index in (0,1):
   for kind in ('manifest','receipt'):
    bad=copy.deepcopy(chain);bad['layers'][index][kind]['sha256']='0'*64
    with self.assertRaisesRegex(ValueError,'Historical release pins'):m.validate_chain_references(bad)
 def test_read_pin_is_content_bound_and_rejects_symlink(self):
  if os.getuid()!=0:self.skipTest('Immutable operational receipts require root ownership')
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'evidence';p.write_bytes(b'original');p.chmod(0o600);ref={'path':str(p),'sha256':m.sha(b'original')};self.assertEqual(m.read_pin(ref),b'original');p.write_bytes(b'changed')
   with self.assertRaises(ValueError):m.read_pin(ref)
   q=Path(d)/'link';q.symlink_to(p)
   with self.assertRaises(ValueError):m.read_pin({'path':str(q),'sha256':m.sha(b'changed')})
if __name__=='__main__':unittest.main()
