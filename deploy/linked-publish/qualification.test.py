#!/usr/bin/env python3
import copy,hashlib,json,runpy,unittest
from datetime import datetime
from pathlib import Path
M=runpy.run_path(str(Path(__file__).resolve().parent/'qualification.py'))
NATIVE={'passed':True,'syntheticOnly':True,'cleanShutdown':True,'postmasterPidAbsent':True,'privateSocketAbsent':True,'shutdownReturnCode':0,'diskLimitExceeded':False,'diskMonitorErrors':[],'memoryEvents':'oom 0\noom_kill 0\n','test':{'passed':True,'bodyBytes':4_000_000,'checks':17,'sourceWitnessStubbed':False,'sharedConfirmedGenerationVerified':True,'productionMutation':False}}
BROWSER={'syntheticApi':True,'noWalletSigning':True,'complete':True,'results':[{'name':name,'status':'passed'} for name in sorted(M['EXPECTED_BROWSER_CASES'])]}
def evidence(path,*_):
 return json.dumps(NATIVE if path in ('native-4mb','nativeV2') else BROWSER if path in ('browser-ui','browserV2') else {}).encode()
class Qualification(unittest.TestCase):
 def fixture(self):
  plan={'sourceCommit':'a'*40,'planSha256':'b'*64,'runtimeManifestTemplate':{'sources':[{'path':'server/api.mjs','after':'c'*64}]}}
  report={'format':'linked-publish-release-qualification-v1','phase':'writer-off-preactivation','rootReconciled':True,'activationAllowed':False,'commit':'a'*40,'tree':'d'*40,'planSha256':'b'*64,
    'runtimeAfter':{'server/api.mjs':'c'*64},'gates':{name:{'passed':True,'exitCode':0,'commit':'a'*40,'path':name,'sha256':'e'*64} for name in M['REQUIRED_GATES']},
    'rollback':{'mode':'native-and-browser-fixtures','v2Rendering':True,'v2FullBodySearch':True,'writerDisabled':True,'sharedConfirmedAndReorg':True,'liveNewWriteVerified':False}}
  return report,plan
 def test_exact_frozen_writer_off_evidence(self):
  r,p=self.fixture();result=M['validate_release_qualification'](r,p,'d'*40,evidence);self.assertFalse(result['activationAllowed'])
 def test_missing_failed_stale_or_unreviewed_gate_rejected(self):
  for change in ('missing','failed','stale','root','plan','runtime','rollback','activation'):
   r,p=self.fixture()
   if change=='missing':r['gates'].pop('hygiene')
   elif change=='failed':r['gates']['native-4mb']['passed']=False
   elif change=='stale':r['gates']['browser-ui']['commit']='f'*40
   elif change=='root':r['rootReconciled']=False
   elif change=='plan':r['planSha256']='f'*64
   elif change=='runtime':r['runtimeAfter']['server/api.mjs']='f'*64
   elif change=='rollback':r['rollback']['v2FullBodySearch']=False
   elif change=='activation':r['activationAllowed']=True
   with self.subTest(change=change),self.assertRaises(ValueError):M['validate_release_qualification'](r,p,'d'*40,evidence)
 def test_evidence_failure_propagates(self):
  r,p=self.fixture()
  def bad(*_):raise ValueError('digest changed')
  with self.assertRaises(ValueError):M['validate_release_qualification'](r,p,'d'*40,bad)
 def test_retained_v2_disabled_live_receipt(self):
  _,p=self.fixture();required=['runtimeArchive','uiManifest','rendererManifest','releaseSync','preactivationLive','nativeV2','browserV2']
  r={'format':'linked-publish-retained-rollback-v1','commit':'a'*40,'writerEnabled':False,'readerVersion':2,'indexerVersion':2,'searchVersion':'proof-search-v6-linked-publish-content','runtimeAfter':{'server/api.mjs':'c'*64},'rootReconciled':True,
    'artifacts':{name:{'path':name,'sha256':'e'*64} for name in required}}
  live={'mode':'preactivation','newLinkedWriteVerified':False,'checks':[{'name':name,'pass':True} for name in ['disabled-writer reader/indexer/Search/capacity readiness','public writer remains disabled']]}
  read=lambda path,_:json.dumps(live).encode() if path=='preactivationLive' else evidence(path)
  self.assertTrue(M['validate_retained_rollback'](r,p,read)['ok'])
  for field,value in [('writerEnabled',True),('searchVersion','proof-search-v5-powcat-files'),('rootReconciled',False)]:
   bad=copy.deepcopy(r);bad[field]=value
   with self.assertRaises(ValueError):M['validate_retained_rollback'](bad,p,read)
  live['checks'][1]['pass']=False
  with self.assertRaises(ValueError):M['validate_retained_rollback'](r,p,read)
 def test_real_failed_browser_or_native_receipt_cannot_be_relabeled_passed(self):
  r,p=self.fixture()
  for kind in ['browser-ui','native-4mb']:
   def read(path,*_):
    if path==kind:
     value=copy.deepcopy(BROWSER if kind=='browser-ui' else NATIVE)
     if kind=='browser-ui':value['results'][0]['status']='failed'
     else:value['test']['sourceWitnessStubbed']=True
     return json.dumps(value).encode()
    return evidence(path)
   with self.subTest(kind=kind),self.assertRaises(ValueError):M['validate_release_qualification'](r,p,'d'*40,read)
 def test_partial_all_passed_and_substituted_browser_suites_rejected(self):
  for change in ['incomplete','missing-complete','partial','duplicate','foreign-case']:
   value=copy.deepcopy(BROWSER)
   if change=='incomplete':value['complete']=False
   elif change=='missing-complete':del value['complete']
   elif change=='partial':value['results']=value['results'][:18]
   elif change=='duplicate':value['results'][-1]=copy.deepcopy(value['results'][0])
   elif change=='foreign-case':value['results'][-1]['name']='other suite case'
   with self.subTest(change=change),self.assertRaises(ValueError):M['validate_browser_evidence'](json.dumps(value).encode())

class DualQualification(unittest.TestCase):
 def fixture(self):
  identity=copy.deepcopy(M['DUAL_IDENTITIES']);identity['operator']={'commit':'d'*40,'tree':'e'*40}
  when='2026-11-14T14:00:00Z';now=datetime.fromisoformat(when.replace('Z','+00:00')).timestamp()
  encode=lambda value:json.dumps(value,sort_keys=True).encode()
  digest=lambda value:hashlib.sha256(value).hexdigest()
  runtime={'server/api.mjs':'a'*64}
  files={'runtimeArchive':b'exact backend archive fixture'}
  plan={'sourceCommit':identity['backend']['commit'],'planSha256':'b'*64,
        'runtimeArchiveSha256':digest(files['runtimeArchive']),
        'runtimeManifestTemplate':{'sources':[{'path':key,'after':value} for key,value in runtime.items()]}}
  files['uiManifest']=('format=proofofwork-ui-release-v5\ncommit='+identity['artifact']['commit']+'\nsource_tree='+identity['artifact']['tree']+'\n').replace('\\n','\n').encode()
  files['rendererManifest']=encode({'format':'proof-of-work-publish-render-source-v1','ok':True,
       'ui':{**identity['artifact'],'trackedDirty':False}})
  native=copy.deepcopy(NATIVE);native.update(subjectIdentity=identity['backend'],executedAt=when)
  browser=copy.deepcopy(BROWSER);browser.update(subjectIdentity=identity['backend'],executedAt=when)
  files['nativeV2']=encode(native);files['browserV2']=encode(browser)
  live={'mode':'preactivation','newLinkedWriteVerified':False,'checks':[{'name':name,'pass':True} for name in (
    'disabled-writer reader/indexer/Search/capacity readiness','public writer remains disabled','complete article feed')]}
  raw=encode(live).decode()
  remote={'format':'publish-linked-remote-preactivation-v1','ok':True,**identity['artifact'],
          'exitCode':0,'cgroupAbsent':True,'noTokenTransferred':True,'productionMutation':False,
          'rawResult':raw,'rawResultSha256':digest(raw.encode())}
  files['preactivationLive']=encode({'format':'publish-linked-dual-preactivation-v1',
     **{key:identity[key] for key in ('baselineOperator','artifact','operator')},'remoteReceipt':remote})
  q={'format':'proof-of-work-dual-qualification-v1','mode':'verification-only','identities':identity,
     'liveCollectionVerified':True,'collectionMethod':'hardwired-live-read-v1','issuedAt':when,'exactHeadDeployment':False,'activationAllowed':False,'writerEnabled':False,'liveNewWriteVerified':False,'evidence':{}}
  proof_source=(Path(__file__).resolve().parents[2]/'scripts/release-identity-proof.mjs').read_text()
  delta=json.JSONDecoder().raw_decode(proof_source.split('const backendArtifactDelta = ',1)[1])[0]
  q['identityProof']={'format':'proof-of-work-explicit-release-identities-v1',**identity,'backendArtifactDelta':delta,'digests':{'backendArtifactDeltaSha256':M['DUAL_BACKEND_ARTIFACT_DELTA_SHA256']}}
  def observation(name,role,value):
   raw=value if isinstance(value,bytes) else encode(value)
   q['evidence'][name]={'subject':{'role':role,**identity[role]},'observedAt':when,'raw':raw.decode(),'sha256':digest(raw)}
  for name,key,role in [('uiManifest','uiManifest','artifact'),('renderer','rendererManifest','artifact'),
                       ('preactivation','preactivationLive','artifact'),('nativeV2','nativeV2','backend'),('browserV2','browserV2','backend')]:
   observation(name,role,files[key])
  observation('runtime','backend',{'sourceCommit':identity['backend']['commit'],'writerEnabled':False,
                  'runtimeAfter':runtime,'archiveSha256':plan['runtimeArchiveSha256']})
  observation('lifecycle','artifact',{'publicationHealthy':True,'retentionComplete':True,'unfinishedIntents':[],
      'pair':{'current':identity['artifact']['commit'][:12]+'-20261114T020148Z','previous':'older-real-release'},
      'verifiedPreservedRelease1042':{'releaseId':'1042efea2aa1-20261112T074918Z'},
      'verifiedPreservedFallback':{'releaseId':'c3969c39c2b2-20261101T051206Z'},
      'verifiedCapacityFloor':{'rootReserveBytes':8*1024**3,'growthReserveBytes':64*1024**2}})
  observation('activity','artifact',{'qualificationSubject':identity['artifact'],'ok':True,'retentionComplete':True,'pair':json.loads(q['evidence']['lifecycle']['raw'])['pair']})
  observation('growth','artifact',{'ok':True,'commit':identity['artifact']['commit'],'canonicalParity':True,'verified':['growth','computer']})
  for name,role in [('primary','operator'),('build','artifact'),('sourceProvenance','artifact')]:observation(name,role,{})
  files['dualQualification']=encode(q)
  report={'format':'linked-publish-dual-retained-rollback-v1','identities':identity,'activationAllowed':False,
     'writerEnabled':False,'liveNewWriteVerified':False,'rootReconciled':True,'readerVersion':2,'indexerVersion':2,
     'searchVersion':'proof-search-v6-linked-publish-content','planSha256':plan['planSha256'],'runtimeAfter':runtime,
     'artifacts':{name:{'path':name,'sha256':digest(raw)} for name,raw in files.items()}}
  return report,plan,identity,now,files,q
 def validate(self,fixture,pin=None):
  r,p,i,n,f,q=fixture
  return M['validate_dual_retained_rollback'](r,p,i,now=n,qualification_sha256=pin if pin is not None else r['artifacts']['dualQualification']['sha256'],read=lambda path,_:f[path])
 def reseal(self,fixture):
  r,p,i,n,f,q=fixture;f['dualQualification']=json.dumps(q,sort_keys=True).encode()
  r['artifacts']['dualQualification']['sha256']=hashlib.sha256(f['dualQualification']).hexdigest()
 def replace_evidence(self,fixture,name,artifact,value):
  r,p,i,n,f,q=fixture;raw=json.dumps(value,sort_keys=True).encode();f[artifact]=raw
  r['artifacts'][artifact]['sha256']=hashlib.sha256(raw).hexdigest()
  q['evidence'][name]['raw']=raw.decode();q['evidence'][name]['sha256']=hashlib.sha256(raw).hexdigest()
  self.reseal(fixture)
 def test_pinned_dual_receipt_preserves_actual_identities_and_never_activates(self):
  result=self.validate(self.fixture())
  self.assertTrue(result['ok']);self.assertFalse(result['activationAllowed']);self.assertFalse(result['liveNewWriteVerified'])
  self.assertEqual(result['testEvidenceMode'],'historical-original-subjects')
 def test_independent_receipt_pin_is_mandatory(self):
  fixture=self.fixture();r,p,i,n,f,q=fixture
  for pin in (None,'bad','f'*64):
   with self.subTest(pin=pin),self.assertRaises(ValueError):
    M['validate_dual_retained_rollback'](r,p,i,now=n,qualification_sha256=pin,read=lambda path,_:f[path])
 def test_modified_report_and_identity_are_rejected(self):
  changes=[
   lambda r,p,i:r.update(activationAllowed=True),lambda r,p,i:r.update(writerEnabled=True),
   lambda r,p,i:r.update(liveNewWriteVerified=True),lambda r,p,i:r.update(rootReconciled=False),
   lambda r,p,i:r.update(readerVersion=1),lambda r,p,i:r.update(indexerVersion=1),
   lambda r,p,i:r.update(searchVersion='old'),lambda r,p,i:r.update(runtimeAfter={}),
   lambda r,p,i:r.update(planSha256='f'*64),lambda r,p,i:p.update(sourceCommit='f'*40),
   lambda r,p,i:p.update(runtimeArchiveSha256='f'*64),
   lambda r,p,i:i['artifact'].update(commit='f'*40),
   lambda r,p,i:i['baselineOperator'].update(tree='f'*40),
   lambda r,p,i:i['operator'].update(commit=i['baselineOperator']['commit']),
   lambda r,p,i:r['artifacts'].pop('nativeV2'),
   lambda r,p,i:r['artifacts']['browserV2'].update(sha256='f'*64)]
  for change in changes:
   fixture=self.fixture();r,p,i,*_=fixture;change(r,p,i)
   with self.subTest(change=change),self.assertRaises(ValueError):self.validate(fixture)
 def test_semantically_invalid_receipt_refuses_even_with_new_external_pin(self):
  for field,value in [('format','other'),('mode','exact-head'),('exactHeadDeployment',True),('activationAllowed',True),
                      ('writerEnabled',True),('liveNewWriteVerified',True),('liveCollectionVerified',False),('collectionMethod','offline-pinned-evidence-only'),('issuedAt','2026-11-14T13:44:59Z'),('issuedAt','2026-11-14T14:00:01Z')]:
   fixture=self.fixture();fixture[-1][field]=value;self.reseal(fixture)
   with self.subTest(field=field,value=value),self.assertRaises(ValueError):self.validate(fixture)
 def test_backend_to_artifact_equivalence_cannot_be_missing_or_forged(self):
  for change in ('missing','delta','digest','identity'):
   fixture=self.fixture();q=fixture[-1]
   if change=='missing':del q['identityProof']
   elif change=='delta':q['identityProof']['backendArtifactDelta'][0]['after']['blob']='f'*40
   elif change=='digest':q['identityProof']['digests']['backendArtifactDeltaSha256']='f'*64
   else:q['identityProof']['backend']={'commit':'f'*40,'tree':'e'*40}
   self.reseal(fixture)
   with self.subTest(change=change),self.assertRaises(ValueError):self.validate(fixture)
 def test_offline_or_forged_collector_receipt_refuses(self):
  for change in ('missing','offline','forged-flag','wrong-independent-pin'):
   fixture=self.fixture();q=fixture[-1];original_pin=fixture[0]['artifacts']['dualQualification']['sha256']
   if change=='missing':del q['liveCollectionVerified']
   elif change=='offline':q.update(mode='offline-evidence-validation',liveCollectionVerified=False,collectionMethod='offline-pinned-evidence-only')
   elif change=='forged-flag':q.update(mode='offline-evidence-validation',liveCollectionVerified=True)
   else:q['issuedAt']='2026-11-14T13:59:59Z'
   self.reseal(fixture)
   with self.subTest(change=change),self.assertRaises(ValueError):self.validate(fixture,pin=original_pin if change=='wrong-independent-pin' else None)
 def test_missing_stale_future_wrong_subject_and_bad_digest_observations_refuse(self):
  for change in ('missing','stale','future','subject','digest','post-issued'):
   fixture=self.fixture();q=fixture[-1];row=q['evidence']['runtime']
   if change=='missing':del q['evidence']['runtime']
   elif change=='stale':row['observedAt']='2026-11-14T13:44:59Z'
   elif change=='future':row['observedAt']='2026-11-14T14:00:01Z'
   elif change=='subject':row['subject']['role']='artifact'
   elif change=='digest':row['sha256']='f'*64
   else:q['issuedAt']='2026-11-14T13:59:59Z'
   self.reseal(fixture)
   with self.subTest(change=change),self.assertRaises(ValueError):self.validate(fixture)
 def test_native_and_browser_original_subject_and_age_required(self):
  for name,artifact in [('nativeV2','nativeV2'),('browserV2','browserV2')]:
   for change in ('missing-subject','relabel','missing-time','stale','future','failed'):
    fixture=self.fixture();value=json.loads(fixture[4][artifact])
    if change=='missing-subject':del value['subjectIdentity']
    elif change=='relabel':value['subjectIdentity']=fixture[2]['operator']
    elif change=='missing-time':del value['executedAt']
    elif change=='stale':value['executedAt']='2026-11-07T13:59:59Z'
    elif change=='future':value['executedAt']='2026-11-14T14:00:01Z'
    elif name=='nativeV2':value['test']['sourceWitnessStubbed']=True
    else:value['results'][0]['status']='failed'
    self.replace_evidence(fixture,name,artifact,value)
    with self.subTest(name=name,change=change),self.assertRaises(ValueError):self.validate(fixture)
 def test_retained_observation_cannot_be_substituted(self):
  fixture=self.fixture();r,p,i,n,f,q=fixture
  value=json.loads(f['rendererManifest']);value['ui']['commit']='f'*40
  f['rendererManifest']=json.dumps(value).encode();r['artifacts']['rendererManifest']['sha256']=hashlib.sha256(f['rendererManifest']).hexdigest()
  with self.assertRaises(ValueError):self.validate(fixture)
 def test_runtime_and_lifecycle_guards_remain_mandatory(self):
  changes=[('runtime','sourceCommit','f'*40),('runtime','writerEnabled',True),('runtime','runtimeAfter',{}),
           ('runtime','archiveSha256','f'*64),('lifecycle','publicationHealthy',False),
           ('lifecycle','retentionComplete',False),('lifecycle','unfinishedIntents',['pending']),
           ('lifecycle','pair',{'current':'wrong'}),('lifecycle','verifiedPreservedRelease1042',{}),
           ('lifecycle','verifiedPreservedFallback',{}),('lifecycle','verifiedCapacityFloor',{}),
           ('activity','ok',False),('activity','retentionComplete',False),('activity','pair',{}),
           ('growth','ok',False),('growth','commit','f'*40),('growth','canonicalParity',False),('growth','verified',['growth'])]
  for name,key,value in changes:
   fixture=self.fixture();row=fixture[-1]['evidence'][name];body=json.loads(row['raw']);body[key]=value
   row['raw']=json.dumps(body);row['sha256']=hashlib.sha256(row['raw'].encode()).hexdigest();self.reseal(fixture)
   with self.subTest(name=name,key=key),self.assertRaises(ValueError):self.validate(fixture)
 def test_remote_probe_uncertain_or_wrong_artifact_refuses(self):
  for key,value in [('commit','f'*40),('exitCode',1),('exitCode',False),('cgroupAbsent',False),('noTokenTransferred',False),('productionMutation',True),('rawResultSha256','f'*64)]:
   fixture=self.fixture();body=json.loads(fixture[4]['preactivationLive']);body['remoteReceipt'][key]=value
   self.replace_evidence(fixture,'preactivation','preactivationLive',body)
   with self.subTest(key=key),self.assertRaises(ValueError):self.validate(fixture)
 def test_duplicate_or_missing_live_check_refuses(self):
  for duplicate in (True,False):
   fixture=self.fixture();body=json.loads(fixture[4]['preactivationLive']);remote=body['remoteReceipt'];raw=json.loads(remote['rawResult'])
   if duplicate:raw['checks'].append(copy.deepcopy(raw['checks'][0]))
   else:raw['checks'].pop()
   remote['rawResult']=json.dumps(raw);remote['rawResultSha256']=hashlib.sha256(remote['rawResult'].encode()).hexdigest()
   self.replace_evidence(fixture,'preactivation','preactivationLive',body)
   with self.assertRaises(ValueError):self.validate(fixture)
 def test_duplicate_json_and_malformed_evidence_refuse(self):
  for raw in (b'{"format":"a","format":"b"}',b'[]',b'not json'):
   with self.subTest(raw=raw),self.assertRaises(ValueError):M['dual_json'](raw)
 def archival_fixture(self):
  fixture=self.fixture();r,p,i,n,f,q=fixture
  pins={}
  for name in ('nativeV2','browserV2'):
   original=json.loads(f[name]);original.pop('subjectIdentity');original.pop('executedAt')
   f[name]=json.dumps(original,sort_keys=True).encode();digest=hashlib.sha256(f[name]).hexdigest()
   pins[name]=digest;r['artifacts'][name]['sha256']=digest
   wrapper={'format':'proof-of-work-archival-test-observation-v1','originalRaw':f[name].decode(),'originalSha256':digest,
     'subjectIdentity':i['backend'],'executionTimeUnknown':True,'executedAt':None,'freshnessClaim':False,
     'qualificationSha256':M['DUAL_ARCHIVAL_PINS']['qualification'],'planSha256':M['DUAL_ARCHIVAL_PINS']['plan'],
     'applicableArtifact':i['artifact'],'backendArtifactDeltaSha256':M['DUAL_BACKEND_ARTIFACT_DELTA_SHA256']}
   row=q['evidence'][name];row['raw']=json.dumps(wrapper);row['sha256']=hashlib.sha256(row['raw'].encode()).hexdigest()
  self.reseal(fixture);return fixture,pins
 def test_archival_unknown_time_requires_exact_original_pins_and_never_claims_freshness(self):
  from unittest.mock import patch
  fixture,pins=self.archival_fixture()
  # Synthetic bodies deliberately differ from production originals: real pins refuse.
  with self.assertRaises(ValueError):self.validate(fixture)
  # Unit-test branch with explicitly synthetic pins, never a production receipt.
  with patch.dict(M['DUAL_ARCHIVAL_PINS'],pins):
   result=self.validate(fixture)
  self.assertTrue(result['executionTimeUnknown']);self.assertFalse(result['historicalFreshnessClaim'])
  self.assertFalse(result['activationAllowed']);self.assertEqual(result['archivalTests'],['nativeV2','browserV2'])
 def test_archival_custody_subject_original_bytes_and_unknown_time_are_mandatory(self):
  from unittest.mock import patch
  for field,value in [('subjectIdentity',{}),('applicableArtifact',{}),('executionTimeUnknown',False),
      ('executedAt','2026-11-14T14:00:00Z'),('freshnessClaim',True),('qualificationSha256','f'*64),
      ('planSha256','f'*64),('backendArtifactDeltaSha256','f'*64),('originalRaw','{}'),('originalSha256','f'*64),('inventedFreshness',True)]:
   fixture,pins=self.archival_fixture();row=fixture[-1]['evidence']['browserV2']
   body=json.loads(row['raw']);body[field]=value;row['raw']=json.dumps(body);row['sha256']=hashlib.sha256(row['raw'].encode()).hexdigest();self.reseal(fixture)
   with patch.dict(M['DUAL_ARCHIVAL_PINS'],pins),self.subTest(field=field),self.assertRaises(ValueError):self.validate(fixture)
 def test_existing_schema_does_not_accept_dual_receipt(self):
  r,p,*_=self.fixture()
  with self.assertRaises(ValueError):M['validate_retained_rollback'](r,p,evidence)


class RetirementConsumer(unittest.TestCase):
 def fixture(self,sidecar_proof=None):
  import base64
  encode=lambda x:(json.dumps(x,sort_keys=True,separators=(',',':'))+'\n').encode()
  sha=lambda b:hashlib.sha256(b).hexdigest()
  pair=copy.deepcopy(M['RET_PAIR']);directory=M['RET_EVIDENCE_DIR'];paths=M['RET_PATHS']
  def row(path,raw):
   if not isinstance(raw,bytes):raw=encode(raw)
   return {'path':path,'base64':base64.b64encode(raw).decode(),'sha256':sha(raw)}
  side=row('/var/backups/proofofwork-ui/releases/kept.sha256',b'preserved\n')
  inventory={'pair':pair,'allHistoricalEntriesHaveRetainedEquivalent':True}
  restore={'uiInventoryBeforeAfterEqual':True,'staticReferencePass':True,'restoredEntries':2839,'scope':'isolated static archive restoration; NOT production synthetic'}
  i=row(directory+'/inventory.json',inventory);r=row(directory+'/static-restore.json',restore)
  proposal={'status':'PROPOSAL_ONLY_NOT_AUTHORIZED_FOR_EXECUTION','selected':[{'path':p} for p in paths],'pair':pair,'inventorySha256':i['sha256'],'rehearsalReceipt':{'sha256':r['sha256']},'allHistoricalEntriesHaveRetainedEquivalent':True,'historicalUnequalCount':0,'sidecarsKeep':[{'path':side['path'],'sha256':side['sha256']}]}
  p=row(directory+'/proposal.json',proposal)
  source={'schema':'pow-ui-retention-admission-index-v2','scopeApprovalSha256':'a'*64,'admissions':[{'path':'/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-source.json','sha256':'b'*64}],'completedRetirements':[]}
  src=row(M['RET_SOURCE_INDEX']['path'],source);source_binding={k:src[k] for k in ('path','sha256')}
  pins={'RET_PROPOSAL_SHA':p['sha256'],'RET_INVENTORY_SHA':i['sha256'],'RET_RESTORE_SHA':r['sha256'],'RET_SOURCE_INDEX':source_binding}
  approval=row(directory+'/owner-approval.json',{'schema':'pow-owner-exact-payload-retirement-approval-v1','proposalSha256':p['sha256'],'retiredPayloadPaths':list(paths),'retainedPair':pair,'permanent':True,'sourceMessageId':'SYNTHETIC-TEST-ONLY','approvedAtUtc':'2026-11-14T00:00:00Z'})
  journal=[]
  def add(event,data):
   journal.append({'sequence':len(journal),'previousSha256':sha(encode(journal[-1])) if journal else None,'event':event,'data':data})
  add('prepared',{'proposalSha256':p['sha256'],'inventorySha256':i['sha256'],'restoreSha256':r['sha256'],'approvalSha256':approval['sha256'],'preflightSha256':'d'*64,'pair':pair})
  for n,path in enumerate(paths):
   add('action-started',{'path':path,'index':n,'freshFenceSha256':'e'*64,'frozenInventorySha256':'3'*64})
   add('action-reconciled',{'path':path,'index':n,'absenceProofSha256':'f'*64,'preservationProofSha256':'1'*64})
  names={'finalFenceSha256':'final-fence.json','retainedPairProofSha256':'retained-pair-proof.json','sidecarsProofSha256':'sidecars-proof.json','historicalEvidenceProofSha256':'historical-evidence-proof.json'}
  sidecar_list=[{'path':side['path'],'sha256':side['sha256']}]
  final={k:row(directory+'/'+name,(sidecar_list if sidecar_proof is None else sidecar_proof) if k=='sidecarsProofSha256' else {'synthetic':name}) for k,name in names.items()}
  add('completed',{**{k:v['sha256'] for k,v in final.items()},'successorPolicyCodeSha256':'2'*64})
  terminal={'schema':'pow-exact-payload-retirement-completed-v1','proposalSha256':p['sha256'],'inventorySha256':i['sha256'],'restoreSha256':r['sha256'],'approvalSha256':approval['sha256'],'journal':journal,'journalHeadSha256':sha(encode(journal[-1])),'retiredPayloadPaths':list(paths),'retirementRetainedPair':pair,'sourceIndex':source_binding,'preservedSidecars':[{'path':side['path'],'sha256':side['sha256']}],'preservedHistoricalEvidenceSha256':final['historicalEvidenceProofSha256']['sha256'],'priorConfigSha256':M['RET_PRIOR_CONFIG_SHA'],'policyCodeSha256':'2'*64}
  t=row(M['RET_TERMINAL_PATH'],terminal)
  config={'package':{'sha256':'2'*64},'schema':'pow-ui-retention-lifecycle-config-v1','statePath':M['RET_STATE_PATH'],'scopeApprovalSha256':'a'*64,'payloadRetirement':{'mode':'complete','proposalSha256':p['sha256'],'receipt':{k:t[k] for k in ('path','sha256')},'priorConfigSha256':M['RET_PRIOR_CONFIG_SHA'],'sourceIndex':source_binding,'policyCodeSha256':'2'*64}}
  c=row(M['RET_CONFIG_PATH'],config)
  proof={'model':'intentionally-retired-payloads-retained-evidence-v1','proposalSha256':p['sha256'],'receipt':{k:t[k] for k in ('path','sha256')},'receiptSha256':t['sha256'],'journalHeadSha256':terminal['journalHeadSha256'],'policyCodeSha256':'2'*64,'retiredPayloadPaths':list(paths),'retirementRetainedPair':pair,'sourceIndex':source_binding,'recoveryVerification':'isolated-static-only'}
  idx=row('/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-index-current.json',{**source,'payloadRetirement':proof})
  state={'schema':'pow-ui-retention-lifecycle-state-v1','configSha256':c['sha256'],'pending':None,'index':{k:idx[k] for k in ('path','sha256')}}
  st=row(M['RET_STATE_PATH'],state)
  bundle={'terminal':t,'ownerApproval':approval,'config':c,'state':st,'sourceIndex':src,'currentIndex':idx,'appendedAdmissions':[],'sidecars':[side],'finalProofs':final,'proposal':p,'inventory':i,'staticRestore':r}
  trust={'configSha256':c['sha256'],'stateSha256':st['sha256'],'currentIndexSha256':idx['sha256'],'policyCodeSha256':'2'*64,'verifiedCurrentPair':pair}
  return bundle,trust,pins
 def test_final_sidecar_proof_rejects_wrong_type_scope_and_noncanonical_bytes(self):
  for wrong in ({},[],{'synthetic':'sidecars-proof.json'},[{'path':'/tmp/other','sha256':'f'*64}],b'[]\n'):
   with self.subTest(wrong=wrong):
    bundle,trust,pins=self.fixture(sidecar_proof=wrong)
    globals_=M['validate_dual_retirement_evidence'].__globals__
    old={k:globals_[k] for k in pins}
    try:
     globals_.update(pins)
     with self.assertRaisesRegex(ValueError,'Final sidecar proof differs'):
      M['validate_dual_retirement_evidence'](bundle,trust)
    finally:globals_.update(old)
 def test_fixed_real_pins_refuse_synthetic_terminal(self):
  bundle,trust,pins=self.fixture()
  with self.assertRaises(ValueError):M['validate_dual_retirement_evidence'](bundle,trust)
 def test_synthetic_authenticated_terminal_preserves_scope_and_no_filesystem_claim(self):
  from unittest.mock import patch
  bundle,trust,pins=self.fixture()
  with patch.dict(M['validate_dual_retirement_evidence'].__globals__,pins):result=M['validate_dual_retirement_evidence'](bundle,trust)
  self.assertTrue(result['ok']);self.assertFalse(result['filesystemVerified']);self.assertFalse(result['activationAllowed'])
  self.assertEqual(result['proof']['retiredPayloadPaths'],list(M['RET_PATHS']))
 def test_missing_wrong_trust_raw_sidecars_and_final_proofs_refuse(self):
  from unittest.mock import patch
  mutations=[lambda b,t:b.pop('ownerApproval'),lambda b,t:b['ownerApproval'].update(base64='e30='),lambda b,t:b.pop('state'),lambda b,t:t.update(configSha256='f'*64),
   lambda b,t:t.update(stateSha256='f'*64),lambda b,t:t.update(currentIndexSha256='f'*64),
   lambda b,t:t.update(policyCodeSha256='f'*64),lambda b,t:t.update(verifiedCurrentPair={}),
   lambda b,t:b['terminal'].update(base64='e30='),lambda b,t:b['terminal'].update(path='/tmp/fake'),
   lambda b,t:b.update(sidecars=[]),lambda b,t:b.update(finalProofs={}),
   lambda b,t:b.update(appendedAdmissions=[b['terminal']]),lambda b,t:b['sourceIndex'].update(sha256='f'*64)]
  for mutate in mutations:
   b,t,pins=self.fixture();mutate(b,t)
   with patch.dict(M['validate_dual_retirement_evidence'].__globals__,pins),self.subTest(mutate=mutate),self.assertRaises(ValueError):M['validate_dual_retirement_evidence'](b,t)


 def test_journal_requires_frozen_inventory_and_complete_chain(self):
  from unittest.mock import patch
  import base64
  for change in ('missing-frozen','bad-frozen','pending','wrong-head','wrong-approval','extra-action'):
   b,t,pins=self.fixture();v=json.loads(base64.b64decode(b['terminal']['base64']));records=v['journal']
   if change=='missing-frozen':del records[1]['data']['frozenInventorySha256']
   elif change=='bad-frozen':records[1]['data']['frozenInventorySha256']='bad'
   elif change=='pending':records=records[:2]
   elif change=='wrong-head':records[1]['previousSha256']='f'*64
   elif change=='wrong-approval':records[0]['data']['approvalSha256']='bad'
   else:records.append(copy.deepcopy(records[-1]))
   with patch.dict(M['RET_validate_chain'].__globals__,pins):
    if change=='pending':self.assertEqual(M['RET_validate_chain'](records)['status'],'uncertain')
    else:
     with self.assertRaises(ValueError):M['RET_validate_chain'](records)
 def test_integrated_retirement_needs_independent_trust_and_fresh_lifecycle_crossbinding(self):
  from unittest.mock import patch
  for mutate in ('none','missing-trust','wrong-live-pair','wrong-live-config'):
   b,t,pins=self.fixture();d=DualQualification();fixture=d.fixture();r,p,i,n,files,q=fixture
   with patch.dict(M['validate_dual_retirement_evidence'].__globals__,pins):
    result=M['validate_dual_retirement_evidence'](b,t)
    life=json.loads(q['evidence']['lifecycle']['raw'])
    life.update(verifiedRetirementPolicyCodeSha256=t['policyCodeSha256'],verifiedPreservedRelease1042=None,verifiedPreservedFallback=None,verifiedRetiredPayloads=result['proof'],verifiedRetirementCurrentPair=result['verifiedCurrentPair'],pair=result['verifiedCurrentPair'],configSha256=t['configSha256'],stateSha256=t['stateSha256'],index={'path':b['currentIndex']['path'],'sha256':t['currentIndexSha256']},binding={'config':{'path':M['RET_CONFIG_PATH'],'sha256':t['configSha256']},'state':{'path':M['RET_STATE_PATH'],'sha256':t['stateSha256']}})
    if mutate=='wrong-live-pair':life['verifiedRetirementCurrentPair']={}
    if mutate=='wrong-live-config':life['configSha256']='f'*64
    row=q['evidence']['lifecycle'];row['raw']=json.dumps(life);row['sha256']=hashlib.sha256(row['raw'].encode()).hexdigest()
    activity=json.loads(q['evidence']['activity']['raw']);activity['pair']=life['pair'];row=q['evidence']['activity'];row['raw']=json.dumps(activity);row['sha256']=hashlib.sha256(row['raw'].encode()).hexdigest();d.reseal(fixture)
    def run():return M['validate_dual_retained_rollback'](r,p,i,now=n,qualification_sha256=r['artifacts']['dualQualification']['sha256'],read=lambda path,_:files[path],retirement_evidence=b,retirement_trust=None if mutate=='missing-trust' else t)
    if mutate=='none':self.assertTrue(run()['ok'])
    else:
     with self.subTest(mutate=mutate),self.assertRaises(ValueError):run()


 def test_descendant_admissions_require_exact_hashes_and_contiguous_pair(self):
  import base64
  from unittest.mock import patch
  for variant in ('valid','broken','wrong-hash','missing','prefix'):
   b,t,pins=self.fixture()
   def decoded(row):return json.loads(base64.b64decode(row['base64']))
   def seal(row,value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
    row.update(base64=base64.b64encode(raw).decode(),sha256=hashlib.sha256(raw).hexdigest())
   next_pair={'current':'abcdef123456-20261115T010203Z','previous':M['RET_PAIR']['current']}
   if variant=='broken':next_pair['previous']=M['RET_PAIR']['previous']
   admission={'schema':'pow-audit30-ordinary-ui-release-admission-v1','host':'77.42.91.106','scopeApprovalSha256':'a'*64,'bootstrap':False,'releaseIds':[next_pair['current']],'retainedPair':next_pair}
   row={'path':'/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-next.json'};seal(row,admission)
   idx=decoded(b['currentIndex']);idx['admissions'].append({k:row[k] for k in ('path','sha256')})
   if variant=='prefix':idx['admissions'][0]['sha256']='f'*64
   seal(b['currentIndex'],idx)
   st=decoded(b['state']);st['index']={k:b['currentIndex'][k] for k in ('path','sha256')};seal(b['state'],st)
   t.update(stateSha256=b['state']['sha256'],currentIndexSha256=b['currentIndex']['sha256'],verifiedCurrentPair=next_pair)
   b['appendedAdmissions']=[] if variant=='missing' else [row]
   if variant=='wrong-hash':row['sha256']='f'*64
   with patch.dict(M['validate_dual_retirement_evidence'].__globals__,pins):
    if variant=='valid':self.assertEqual(M['validate_dual_retirement_evidence'](b,t)['verifiedCurrentPair'],next_pair)
    else:
     with self.subTest(variant=variant),self.assertRaises(ValueError):M['validate_dual_retirement_evidence'](b,t)

 def test_dual_in_place_holds_reject_retirement_conflicts(self):
  d=DualQualification()
  for kind in ('evidence','trust','proof','partial'):
   fixture=d.fixture();r,p,i,n,files,q=fixture;kwargs={}
   if kind=='evidence':kwargs['retirement_evidence']={}
   elif kind=='trust':kwargs['retirement_trust']={}
   else:
    life=json.loads(q['evidence']['lifecycle']['raw'])
    if kind=='proof':life['verifiedRetiredPayloads']={}
    else:life['verifiedPreservedFallback']=None
    row=q['evidence']['lifecycle'];row['raw']=json.dumps(life);row['sha256']=hashlib.sha256(row['raw'].encode()).hexdigest();d.reseal(fixture)
   with self.subTest(kind=kind),self.assertRaises(ValueError):
    M['validate_dual_retained_rollback'](r,p,i,now=n,qualification_sha256=r['artifacts']['dualQualification']['sha256'],read=lambda path,_:files[path],**kwargs)


 def test_owner_approval_semantics_reject_even_with_rebound_outer_hashes(self):
  import base64
  from unittest.mock import patch
  for key,value in [('schema','wrong'),('proposalSha256','f'*64),('retiredPayloadPaths',[]),('retainedPair',{}),('permanent',False),('sourceMessageId',''),('approvedAtUtc',''),('unexpected',True)]:
   b,t,pins=self.fixture()
   def decoded(row):return json.loads(base64.b64decode(row['base64']))
   def seal(row,value):
    raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
    row.update(base64=base64.b64encode(raw).decode(),sha256=hashlib.sha256(raw).hexdigest())
   approval=decoded(b['ownerApproval']);approval[key]=value;seal(b['ownerApproval'],approval)
   terminal=decoded(b['terminal']);terminal['approvalSha256']=b['ownerApproval']['sha256'];seal(b['terminal'],terminal)
   config=decoded(b['config']);config['payloadRetirement']['receipt']['sha256']=b['terminal']['sha256'];seal(b['config'],config)
   state=decoded(b['state']);state['configSha256']=b['config']['sha256'];seal(b['state'],state)
   t.update(configSha256=b['config']['sha256'],stateSha256=b['state']['sha256'])
   with patch.dict(M['validate_dual_retirement_evidence'].__globals__,pins),self.subTest(key=key),self.assertRaisesRegex(ValueError,'Exact owner approval evidence differs'):
    M['validate_dual_retirement_evidence'](b,t)

if __name__=='__main__':unittest.main()
