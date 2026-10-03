#!/usr/bin/python3 -I -B
"""Pure exact-location, preserved-failure, package and real capacity fixtures."""
import ast,base64,hashlib,importlib.util,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-item2-ui-evidence-stage-continuation-v3.py')
OLD=Path('/tmp/pow-audit30-item2-ui-preserved-continuation-v2.py')
CAP=Path('/home/sixer/ProofOfWork.Me/deploy/proofofwork-ui-capacity.py')
FILES={'proofofwork-ui-capacity.py':CAP,'stager.py':Path('/tmp/pow-audit30-item2-ui-evidence-stage-stager-v2.py'),'receiver.py':Path('/tmp/pow-audit30-item2-ui-preserved-source-receiver-v1.py'),'provenance.sh':Path('/tmp/pow-audit30-item2-ui-evidence-stage-provenance-v2.sh'),'publisher.sh':Path('/tmp/pow-audit30-item2-ui-evidence-stage-publisher-v2.sh')}
def load(path=SOURCE,name='_ui_evidence_stage_fixture'):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def files():return {name:p.read_bytes()for name,p in FILES.items()}
def request(m,phase='stage'):
 return {'schema':'pow-audit30-item2-ui-evidence-stage-continuation-request-v3','phase':phase,'planSha256':m.PLAN_SHA,'expectedPayloadFingerprint':m.EXPECTED_PAYLOAD,'recognizedPriorStageFailure':m.STAGE_FAILED_PINS,'recognizedRestageFailure':m.RESTAGE_FAILED_PINS,'helperSourcesBase64':{name:base64.b64encode(raw).decode()for name,raw in files().items()}}
class EvidenceStage(unittest.TestCase):
 def test_all_original_core_guard_bodies_unchanged(self):
  a={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(OLD.read_bytes()).body if isinstance(n,ast.FunctionDef)};b={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(SOURCE.read_bytes()).body if isinstance(n,ast.FunctionDef)}
  for name in('identity','bound','directory','sync','durable_json','rename_new','payload_fingerprint','run','capacity','inode_witness','old_failure','check_retained'):self.assertEqual(a[name],b[name],name)
 def test_source_receiver_function_only_actual_stage_path_changes(self):
  a=OLD.read_text();b=SOURCE.read_text();a=a[a.index('def receive_source():'):a.index('def main():')];b=b[b.index('def receive_source():'):b.index('def main():')]
  self.assertEqual(a,b.replace('stage = STAGE_ROOT',"stage = BASE / ('proofofwork-www-stage-' + RELEASE)"))
 def test_original_prior_missing_capacity_failure_only_old_package_binding_changes(self):
  a=OLD.read_text();b=SOURCE.read_text();a=a[a.index('def recognized_prior_stage():'):a.index('def inode_witness(')];b=b[b.index('def recognized_prior_stage():'):b.index('def inode_witness(')]
  self.assertEqual(a,b.replace('str(ORIGINAL_PACKAGE / CAPACITY_NAME)','str(PACKAGE / CAPACITY_NAME)'))
 def test_exact_request_sources_and_both_prior_failures_required(self):
  m=load();v=request(m);_,got=m.request(json.dumps(v).encode(),'stage');self.assertEqual(got,files())
  for key,value in(('recognizedPriorStageFailure',{}),('recognizedRestageFailure',{}),('phase','restage')):
   bad={**v,key:value}
   with self.assertRaises(AssertionError):m.request(json.dumps(bad).encode(),'stage')
  v['helperSourcesBase64']['stager.py']=base64.b64encode(FILES['stager.py'].read_bytes()+b' ').decode()
  with self.assertRaises(AssertionError):m.request(json.dumps(v).encode(),'stage')
 def test_fresh_copy_bound_retains_real_capacity_helper_and_original_constants(self):
  m=load();m.helpers={'capacity':{'path':'_fixture_capacity','sha256':'a'*64}}
  m.bound=lambda *args:b"def tree_bound(a,b):return {'additionalBytes':453668864,'additionalInodes':1280}\ndef allocation_block(p):return 4096\ndef entry_bytes(s,b):return 4*b\n"
  self.assertEqual(m.conservative_stage_copy_bound(),(453701632,1282))
  cap=load(CAP,'_actual_capacity_fixture');self.assertEqual(cap.MAX_DEPLOY_SCRATCH_BYTES,5*1024**3);self.assertEqual(cap.ROOT_RESERVE_BYTES,10*1024**3);self.assertEqual(cap.GROWTH_RESERVE_BYTES,64*1024**2)
 def test_real_scratch_predicate_old_fullcopy_refuses_but_two_exact_charges_pass(self):
  cap=load(CAP,'_actual_scratch_fixture')
  with tempfile.TemporaryDirectory(prefix='pow-ui-real-scratch-predicate-')as d:
   root=Path(d);scratch=root/'scratch';scratch.mkdir();evidence=root/'evidence';evidence.mkdir()
   def du(argv,**kwargs):return types.SimpleNamespace(stdout=(str(4933709824 if argv[-1]==str(scratch) else 220000000)+'\t'+argv[-1]+'\n').encode())
   with patch.object(cap.subprocess,'run',side_effect=du):
    with self.assertRaises(cap.CapacityError):cap.check_deploy_scratch(scratch,453701632,'fixture-original-fullcopy')
    self.assertEqual(cap.check_deploy_scratch(scratch,32*1024**2,'fixture-global-receipts')['maximumBytes'],5368709120)
    self.assertEqual(cap.check_deploy_scratch(evidence,453701632+32*1024**2,'fixture-actual-stage')['maximumBytes'],5368709120)
 def test_new_package_creation_keeps_original_seven_member_package_untouched(self):
  m=load()
  with tempfile.TemporaryDirectory(prefix='pow-ui-evidence-package-')as d:
   root=Path(d);m.PACKAGE_TOP=root/'new';m.PACKAGE=m.PACKAGE_TOP/'exact';original=root/'original';original.mkdir();(original/'history').write_bytes(b'keep');inode=(original/'history').stat().st_ino;charges=[]
   m.directory=lambda p,create=False:(p.mkdir()if create and not p.exists()else None)or p
   m.bound=lambda p,digest,maximum=0:p.read_bytes()if hashlib.sha256(p.read_bytes()).hexdigest()==digest else self.fail('Pin drift')
   m.capacity=lambda *a,**k:charges.append((a,k));m.prepare_package(files())
   self.assertEqual(sorted(p.name for p in m.PACKAGE.iterdir()),sorted([*FILES,'manifest.json']));self.assertEqual((original/'history').read_bytes(),b'keep');self.assertEqual((original/'history').stat().st_ino,inode)
   self.assertTrue(all((m.PACKAGE/name).read_bytes()==p.read_bytes()for name,p in FILES.items()));self.assertEqual(charges[0][0][0:2],('check',root))
   with self.assertRaises(AssertionError):m.prepare_package(files())
 def stage(self,failing=False):
  m=load();temp=tempfile.TemporaryDirectory(prefix='pow-ui-evidence-stage-');root=Path(temp.name);m.BASE=root/'scratch';m.BASE.mkdir();m.ARCHIVES=root/'archives';m.ARCHIVES.mkdir();m.EVIDENCE_ROOT=root/'evidence';m.EVIDENCE_ROOT.mkdir();m.STAGE_ROOT=m.EVIDENCE_ROOT/('proofofwork-www-stage-'+m.RELEASE);m.SOURCE_ROOT=m.EVIDENCE_ROOT/'source-absent';m.PAYLOAD=m.BASE/'original-absent';m.PRESERVED=m.EVIDENCE_ROOT/'preserved';m.PRESERVED.mkdir();(m.PRESERVED/'public').write_bytes(b'keep');inode=m.PRESERVED.stat().st_ino;m.out=m.BASE/'receipts';m.out.mkdir();m.PACKAGE=root/'package';m.PACKAGE.mkdir();m.p={'stageArchiveUpperBoundBytes':493224843,'admissions':{'source-receive':{'bytes':315842560,'inodes':15000}}};model={'peakAdditionalBytes':264429568};calls=[]
  m.payload_fingerprint=lambda p:m.EXPECTED_PAYLOAD;m.inode_witness=lambda p:[['.',inode]];m.conservative_stage_copy_bound=lambda:(453701632,1282)
  m.capacity=lambda *a,**k:calls.append(('capacity',a,k))
  def run(argv,name,**kwargs):
   calls.append(('run',argv,name,kwargs))
   if name=='stage-model.json':(m.out/name).write_text(json.dumps(model))
   elif name=='stager.log':
    if failing:raise AssertionError('Fixture refused')
    self.assertEqual(argv[argv.index('--stage-root')+1],str(m.STAGE_ROOT));m.STAGE_ROOT.mkdir()
   elif name=='managed-model.json':(m.out/name).write_text(json.dumps({'archiveUpperBoundBytes':1000}))
   elif name=='archive.log':Path(argv[argv.index('--file')+1]).write_bytes(b'archive')
  m.run=run;return m,temp,model,calls,inode
 def test_stage_fullcopy_actual_parent_global_receipts_and_full_source_charge(self):
  m,t,model,calls,inode=self.stage()
  try:
   result=m.restage({},model);self.assertEqual(result['conservativeStageCopyBytes'],453701632);self.assertFalse(result['productionPublished']);self.assertEqual(m.PRESERVED.stat().st_ino,inode)
   charges=[x[1]for x in calls if x[0]=='capacity'];self.assertIn(('check-scratch',m.BASE,32*1024**2,'stage-receipts'),charges);self.assertIn(('check-scratch',m.EVIDENCE_ROOT,453701632+32*1024**2,'stage-actual-allocation'),charges)
   self.assertIn(('check',m.EVIDENCE_ROOT,453701632+493224843+32*1024**2,'stage-actual-allocation'),charges);self.assertIn(('check',m.EVIDENCE_ROOT,315842560+32*1024**2,'next-source-evidence'),charges)
  finally:t.cleanup()
 def test_stager_failure_keeps_input_and_never_inverts_or_retries(self):
  m,t,model,calls,inode=self.stage(True)
  try:
   with patch.object(m,'rename_new',wraps=m.rename_new)as rename:
    with self.assertRaises(AssertionError):m.restage({},model)
    rename.assert_not_called()
   self.assertEqual(m.PRESERVED.stat().st_ino,inode);self.assertEqual((m.PRESERVED/'public').read_bytes(),b'keep');v=json.loads((m.out/'failure.json').read_bytes());self.assertFalse(v['automaticRetry']);self.assertFalse(v['recognizedInputInversePerformed'])
  finally:t.cleanup()
 def test_main_admits_old_exact_failure_before_any_new_output(self):
  text=SOURCE.read_text();main=text[text.index('def main():'):];self.assertLess(main.index('recognized_restage_failure()'),main.index('out.mkdir'))
  self.assertIn("'e52fa32d30524c778a5f9f309538953e'",text);self.assertIn("'5f52fe3968b685b44a9e42f02e447145a49b416da12cf30558b926da56ca1a78'",text)
  body=ast.unparse(next(n for n in ast.parse(text).body if isinstance(n,ast.FunctionDef)and n.name=='restage'))
  self.assertNotIn('rename_new(PRESERVED',body);self.assertNotIn('unlink',body);self.assertNotIn('rmtree',body)
if __name__=='__main__':unittest.main()
