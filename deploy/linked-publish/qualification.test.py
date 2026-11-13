#!/usr/bin/env python3
import copy,json,runpy,unittest
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
if __name__=='__main__':unittest.main()
