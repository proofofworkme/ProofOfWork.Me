"""Offline full original repair proof plus synthetic R3 package/transition."""
import base64,copy,hashlib,importlib.util,json,types,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
# Adapt only synthetic old fixture package to a real manifest hash.
source=(HERE/'check-failed-prepare-repair.test.py').read_text()
source=source.replace("config=copy.deepcopy(oldconfig);pkg={'path':R.BASE+'/ui-lifecycle-tools-'+'1'*64,'sha256':'1'*64}",
"""self.old_manifest={'sourceCommit':'2'*40,'sourceTree':'3'*40,'files':{'deploy/ui-retention/lifecycle_remote.py':{'bytes':3,'sha256':R.sha(b'old')},'deploy/ui-retention/failed_prepare_repair.py':{'bytes':3,'sha256':R.sha(b'old')},'deploy/ui-retention/retirement_receipt.py':{'bytes':3,'sha256':R.sha(b'old')},'deploy/ui-retention/reconcile_failed_prepare.py':{'bytes':3,'sha256':R.sha(b'old')}}}
        oldsha=R.sha(R.encoded(self.old_manifest))
        config=copy.deepcopy(oldconfig);pkg={'path':R.BASE+'/ui-lifecycle-tools-'+oldsha,'sha256':oldsha}
        record(pkg['path']+'/package.json',self.old_manifest)""")
fixture=types.ModuleType('original_fixture');fixture.__file__=str(HERE/'check-failed-prepare-repair.test.py')
exec(compile(source,fixture.__file__,'exec'),fixture.__dict__)
F=fixture.R
class Tests(fixture.EdgeTests):
 def setUp(self):
  super().setUp()
  self.old_pin=copy.deepcopy(F.READER_PRIOR)
  self.r2=copy.deepcopy(self.state);self.r2config=copy.deepcopy(self.config)
  F.READER_PRIOR.update(state=F.sha(F.encoded(self.r2)),config=self.config_sha,
    intent=self.r2['lastFailedPreparationRepair']['intentSha256'],
    repaired=F.sha(F.encoded(self.files[F.JOURNAL+'/repaired.json'])),
    ordinaryPlan=self.r2['pending']['ordinaryPlan']['sha256'],package=self.config['package']['sha256'])
  self.files.pop(F.JOURNAL+'/verified.json')
  self.record(F.READER_JOURNAL+'/prior-state.json',self.r2)
  self.record(F.READER_JOURNAL+'/prior-config.json',self.r2config)
  files={}
  for name in self.old_manifest['files']:
   raw=b'new' if name in F.READER_CHANGED_FILES else b'old'
   files[name]={'bytes':len(raw),'sha256':F.sha(raw),'base64':base64.b64encode(raw).decode()}
  manifest={'sourceCommit':'5'*40,'sourceTree':'6'*40,'files':{k:{x:v[x] for x in ('bytes','sha256')} for k,v in files.items()}}
  pkgsha=F.sha(F.encoded(manifest));pkg=F.BASE+'/ui-lifecycle-tools-'+pkgsha
  config=copy.deepcopy(self.r2config)
  config.update(sourceCommit='5'*40,sourceTree='6'*40,package={'path':pkg,'sha256':pkgsha},
   controller=dict(config['controller'],path=pkg+'/deploy/ui-retention/lifecycle_remote.py'),
   approval=dict(config['approval'],path=pkg+'/audits/2026-10-16-ui-retention-repair-approval.json'))
  self.config=config;self.config_sha=F.sha(F.encoded(config));self.record(pkg+'/package.json',manifest)
  self.payload={'config':config,'configSha256':self.config_sha,'manifest':manifest,'files':files}
  self.reseal()
 def tearDown(self):
  F.READER_PRIOR.clear();F.READER_PRIOR.update(self.old_pin)
  super().tearDown()
 def reseal(self):
  marker={'intentPath':F.READER_JOURNAL+'/intent.json','completionPath':F.READER_JOURNAL+'/installed.json'}
  template=dict(self.r2,configSha256=self.config_sha,revision=288,lastPreparedReaderRepair=copy.deepcopy(marker))
  intent={'schema':'pow-ui-prepared-reader-repair-intent-v1','authority':copy.deepcopy(F.READER_PRIOR),
    'payload':self.payload,'reconcilerSha256':self.payload['files']['deploy/ui-retention/reconcile_failed_prepare.py']['sha256'],'reviewedPlanSha256':'a'*64,'context':self.r2['pending']['context'],'ordinaryPlan':self.r2['pending']['ordinaryPlan'],
    'stateTemplate':template,'stateTemplateSha256':F.sha(F.encoded(template))}
  marker['intentSha256']=self.record(marker['intentPath'],intent)['sha256']
  self.state=dict(template,lastPreparedReaderRepair=marker)
  done={'schema':'pow-ui-prepared-reader-repair-installed-v1','ok':True,
   'intent':{'path':marker['intentPath'],'sha256':marker['intentSha256']},
   'priorState':{'path':F.READER_JOURNAL+'/prior-state.json','sha256':F.READER_PRIOR['state']},
   'priorConfig':{'path':F.READER_JOURNAL+'/prior-config.json','sha256':F.READER_PRIOR['config']},
   'config':{'path':F.CONFIG_PATH,'sha256':self.config_sha},'state':{'path':F.STATE_PATH,'sha256':F.sha(F.encoded(self.state))},
   'stateRevision':288,'prepared':True,'retentionComplete':False,'deletionPerformed':False,'publicationPerformed':False,'originalRepairEvidencePreserved':True}
  done_binding=self.record(marker['completionPath'],done)
  self.record(F.READER_JOURNAL+'/verified.json',{'schema':'pow-ui-prepared-reader-repair-verified-v1','installedReceipt':done_binding,
   'config':done['config'],'state':done['state'],'contextSha256':F.sha(F.encoded(intent['context'])),'prepared':True,'retentionComplete':False})
 def test_combined_edge_preserves_exact_pending_and_original_anchor(self):
  value=F.verify_edge(self.state,self.config_sha,self.config,self.read)
  self.assertEqual(value['priorConfigSha256'],F.PIN['config']);self.assertEqual(value['priorState']['revision'],285)
  self.assertEqual(self.state['pending'],self.r2['pending']);self.assertNotIn(F.JOURNAL+'/verified.json',self.files)
 def test_missing_new_seal_only_initial_internal_window(self):
  del self.files[F.READER_JOURNAL+'/verified.json']
  with self.assertRaises(FileNotFoundError):F.verify_marker(self.state,self.read)
  self.assertIsNotNone(F.verify_marker(self.state,self.read,verify_seal=False))
  later=dict(self.state,revision=289)
  with self.assertRaises(FileNotFoundError):F.verify_marker(later,self.read,verify_seal=False)
 def test_later_config_edge_returns_none_but_requires_seal(self):
  later=dict(self.state,revision=290,configSha256='9'*64)
  self.assertIsNone(F.verify_edge(later,'9'*64,{},self.read))
  del self.files[F.READER_JOURNAL+'/verified.json']
  with self.assertRaises(FileNotFoundError):F.verify_edge(later,'9'*64,{},self.read,verify_seal=False)
 def test_each_new_evidence_tamper_refuses(self):
  for name in list(self.files):
   if name.startswith(F.READER_JOURNAL):
    prior=self.files[name];self.files[name]={'tampered':True}
    with self.subTest(name=name),self.assertRaises((ValueError,KeyError)):F.verify_marker(self.state,self.read)
    self.files[name]=prior
 def test_no_fabricated_old_seal(self):
  self.record(F.JOURNAL+'/verified.json',{'fake':True})
  with self.assertRaises(ValueError):F.verify_marker(self.state,self.read)
 def test_state_and_token_cannot_change(self):
  for field,value in (('revision',289),('token','bad'),('stage','applied')):
   state=copy.deepcopy(self.state)
   if field=='revision':state[field]=value;state['lastPayloadRetirement']={}
   else:state['pending'][field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):F.verify_marker(state,self.read)
# Inherited tests cover original R2, not successor fixtures; run only local tests.
for name in list(fixture.EdgeTests.__dict__):
 if name.startswith('test_') and name not in Tests.__dict__:setattr(Tests,name,None)
if __name__=='__main__':unittest.main(verbosity=2)
