#!/usr/bin/python3 -I -B
"""Recognized failure, real sibling loading, package preservation and existing-input fixtures."""
import ast,base64,hashlib,importlib.util,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-item2-ui-preserved-continuation-v2.py')
OLD=Path('/tmp/pow-audit30-item2-ui-preserved-continuation-v1.py')
CAP=Path('/home/sixer/ProofOfWork.Me/deploy/proofofwork-ui-capacity.py')
STAGER=Path('/tmp/pow-audit30-item2-ui-preserved-stager-v1.py')
FILES={'proofofwork-ui-capacity.py':CAP,'stager.py':STAGER,'receiver.py':Path('/tmp/pow-audit30-item2-ui-preserved-source-receiver-v1.py'),'provenance.sh':Path('/tmp/pow-audit30-item2-ui-preserved-provenance-v1.sh'),'publisher.sh':Path('/tmp/pow-audit30-item2-ui-preserved-publisher-v1.sh')}
def load(path=SOURCE,name='_continuation_v2_fixture'):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
def files():return {name:p.read_bytes()for name,p in FILES.items()}
def request(m,phase='restage'):
 return {'schema':'pow-audit30-item2-ui-preserved-continuation-request-v2','phase':phase,'planSha256':m.PLAN_SHA,'expectedPayloadFingerprint':m.EXPECTED_PAYLOAD,'recognizedPriorStageFailure':m.STAGE_FAILED_PINS,'helperSourcesBase64':{name:base64.b64encode(raw).decode()for name,raw in files().items()}}
class Continuation(unittest.TestCase):
 def test_original_guard_source_and_receiver_source_body_unchanged(self):
  a={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(OLD.read_bytes()).body if isinstance(n,ast.FunctionDef)};b={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(SOURCE.read_bytes()).body if isinstance(n,ast.FunctionDef)}
  for name in('identity','bound','directory','sync','durable_json','rename_new','payload_fingerprint','run','capacity','inode_witness','old_failure','check_retained','receive_source'):self.assertEqual(a[name],b[name],name)
 def test_actual_missing_sibling_reproduced_then_exact_helper_loads(self):
  with tempfile.TemporaryDirectory(prefix='pow-ui-cap-sibling-test-')as d:
   root=Path(d);script=root/'stager.py';script.write_bytes(STAGER.read_bytes());stager=load(script,'_stager_sibling_fixture')
   with self.assertRaisesRegex(stager.StageError,'UI capacity helper is missing'):stager.capacity_helper()
   sibling=root/'proofofwork-ui-capacity.py';sibling.write_bytes(CAP.read_bytes());sibling.chmod(0o755)
   helper=stager.capacity_helper();self.assertEqual(helper.MAX_DEPLOY_SCRATCH_BYTES,5*1024**3);self.assertEqual(helper.ROOT_RESERVE_BYTES,10*1024**3);self.assertEqual(helper.GROWTH_RESERVE_BYTES,64*1024**2)
   self.assertEqual(hashlib.sha256(sibling.read_bytes()).hexdigest(),'ea6745b2519d57fbd08deff723e81540d4dad2b4c649ff7e6c2b060a7e7edbb6')
 def test_exact_new_request_sources_and_recognized_failure_pins(self):
  m=load();v=request(m);_,received=m.request(json.dumps(v).encode(),'restage');self.assertEqual(received,files())
  for key,value in [('recognizedPriorStageFailure',{}),('phase','prepare')]:
   bad={**v,key:value}
   with self.assertRaises(AssertionError):m.request(json.dumps(bad).encode(),'restage')
  v['helperSourcesBase64']['proofofwork-ui-capacity.py']=base64.b64encode(CAP.read_bytes()+b' ').decode()
  with self.assertRaises(AssertionError):m.request(json.dumps(v).encode(),'restage')
 def package(self,m,root):
  m.PACKAGE=root/'package';m.PACKAGE.mkdir();m.PACKAGE_TOP=root
  data=files();old={name:raw for name,raw in data.items()if name!=m.CAPACITY_NAME}
  for name,raw in old.items():(m.PACKAGE/name).write_bytes(raw)
  manifest=(json.dumps(m.helper_manifest(old),indent=2)+'\n').encode();(m.PACKAGE/'manifest.json').write_bytes(manifest)
  m.directory=lambda path,create=False:path
  def bound(path,sha,maximum=0):
   raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==sha;return raw
  m.bound=bound;return data,manifest
 def test_capacity_install_preserves_original_manifest_and_four_helpers(self):
  m=load()
  with tempfile.TemporaryDirectory(prefix='pow-ui-cap-package-test-')as d:
   data,manifest=self.package(m,Path(d));before={name:(m.PACKAGE/name).read_bytes()for name in data if name!=m.CAPACITY_NAME};charges=[]
   m.capacity=lambda *args,**kwargs:charges.append((args,kwargs))
   m.install_capacity(data)
   self.assertEqual((m.PACKAGE/'manifest.json').read_bytes(),manifest);self.assertEqual(hashlib.sha256(manifest).hexdigest(),m.ORIGINAL_PACKAGE_MANIFEST_SHA)
   self.assertTrue(all((m.PACKAGE/name).read_bytes()==raw for name,raw in before.items()))
   self.assertEqual((m.PACKAGE/m.CAPACITY_NAME).read_bytes(),CAP.read_bytes());self.assertEqual((m.PACKAGE/m.CAPACITY_NAME).stat().st_mode&0o777,0o755)
   self.assertEqual(charges[0][0][0:3],('check',m.PACKAGE,13570+32*1024**2));self.assertEqual(sorted(p.name for p in m.PACKAGE.iterdir()),sorted([*data,'manifest.json','capacity-admission-v2.json']))
 def test_existing_capacity_or_extra_package_entry_refuses_no_overwrite(self):
  m=load()
  with tempfile.TemporaryDirectory(prefix='pow-ui-cap-package-test-')as d:
   data,_=self.package(m,Path(d));(m.PACKAGE/m.CAPACITY_NAME).write_bytes(b'preserved-existing');m.capacity=lambda *args,**kwargs:self.fail('No allocation or write on collision')
   with self.assertRaises(AssertionError):m.install_capacity(data)
   self.assertEqual((m.PACKAGE/m.CAPACITY_NAME).read_bytes(),b'preserved-existing')
 def stage(self,failing=None):
  m=load();temp=tempfile.TemporaryDirectory(prefix='pow-ui-restage-test-');root=Path(temp.name);m.BASE=root/'scratch';m.BASE.mkdir();m.ARCHIVES=root/'archives';m.ARCHIVES.mkdir();m.EVIDENCE_ROOT=root/'evidence';m.EVIDENCE_ROOT.mkdir();m.PAYLOAD=m.BASE/'original-absent';m.PRESERVED=m.EVIDENCE_ROOT/'already-preserved';m.PRESERVED.mkdir();(m.PRESERVED/'data').write_bytes(b'unchanged');inode=m.PRESERVED.stat().st_ino;m.out=m.BASE/'receipts';m.out.mkdir();m.PACKAGE=root/'package';m.PACKAGE.mkdir();m.p={'stageArchiveUpperBoundBytes':493224843,'admissions':{'source-receive':{'bytes':315842560,'inodes':15000}}};model={'peakAdditionalBytes':264429568};calls=[]
  m.payload_fingerprint=lambda root:m.EXPECTED_PAYLOAD;m.inode_witness=lambda root:[['.',inode]]
  def capacity(*args,**kwargs):
   calls.append(('capacity',args,kwargs))
   if failing=='admission'and args[3]=='stage':raise AssertionError('Fixture admission refused')
  def run(argv,name,**kwargs):
   calls.append(('run',argv,name,kwargs))
   if name=='stage-model.json':(m.out/name).write_text(json.dumps(model))
   elif name=='stager.log':
    if failing=='stager':raise AssertionError('Fixture stager refused')
    (m.BASE/('proofofwork-www-stage-'+m.RELEASE)).mkdir()
   elif name=='managed-model.json':(m.out/name).write_text(json.dumps({'archiveUpperBoundBytes':1000}))
   elif name=='archive.log':Path(argv[argv.index('--file')+1]).write_bytes(b'archive')
  m.run=run;m.capacity=capacity;return m,temp,model,calls,inode
 def test_admission_or_stager_refusal_never_moves_or_inverts_protected_input(self):
  for point in('admission','stager'):
   m,temp,model,calls,inode=self.stage(point)
   try:
    with patch.object(m,'rename_new',wraps=m.rename_new)as rename:
     with self.assertRaises(AssertionError):m.restage({},model)
     rename.assert_not_called()
    self.assertEqual(m.PRESERVED.stat().st_ino,inode);self.assertFalse(m.PAYLOAD.exists());self.assertEqual((m.PRESERVED/'data').read_bytes(),b'unchanged')
    failure=json.loads((m.out/'failure.json').read_bytes());self.assertTrue(failure['inputAlreadyPreserved']);self.assertFalse(failure['recognizedInputInversePerformed']);self.assertFalse(failure['automaticRetry'])
   finally:temp.cleanup()
 def test_success_reuses_input_and_retains_full_source_disk_charge(self):
  m,temp,model,calls,inode=self.stage()
  try:
   result=m.restage({},model);self.assertTrue(result['inputAlreadyPreserved']);self.assertFalse(result['productionPublished']);self.assertEqual(m.PRESERVED.stat().st_ino,inode);self.assertFalse(m.PAYLOAD.exists())
   cap=next(x for x in calls if x[0]=='capacity'and x[1][3]=='next-source-evidence');self.assertEqual(cap[1][:3],('check',m.EVIDENCE_ROOT,315842560+32*1024**2));self.assertEqual(cap[2]['inodes'],15032)
   scratch=next(x for x in calls if x[0]=='capacity'and x[1][3]=='next-source-receipts');self.assertEqual(scratch[1][:3],('check-scratch',m.BASE,32*1024**2))
  finally:temp.cleanup()
 def test_restage_has_no_input_move_inverse_or_new_input_receipt_write(self):
  node=next(n for n in ast.parse(SOURCE.read_bytes()).body if isinstance(n,ast.FunctionDef)and n.name=='restage');text=ast.unparse(node)
  self.assertNotIn('incoming-receipt.json',text);self.assertNotIn('rename_new(PRESERVED',text);self.assertNotIn('rename_new(PAYLOAD',text);self.assertNotIn('unlink(',text);self.assertNotIn('rmtree(',text)

if __name__=='__main__':unittest.main()
