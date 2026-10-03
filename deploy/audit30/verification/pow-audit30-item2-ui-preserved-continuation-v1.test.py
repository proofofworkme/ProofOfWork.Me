#!/usr/bin/python3 -I -B
"""Local pure tests of admission, preservation/inverse and real filesystem accounting."""
import ast
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE=Path('/tmp/pow-audit30-item2-ui-preserved-continuation-v1.py')
OLD=Path('/home/sixer/ProofOfWork.Me/deploy/audit30/verification/item2-ui-release-38ac-v1/remote_transport.py')
FILES={'stager.py':'/tmp/pow-audit30-item2-ui-preserved-stager-v1.py','receiver.py':'/tmp/pow-audit30-item2-ui-preserved-source-receiver-v1.py','provenance.sh':'/tmp/pow-audit30-item2-ui-preserved-provenance-v1.sh','publisher.sh':'/tmp/pow-audit30-item2-ui-preserved-publisher-v1.sh'}

def load():
 spec=importlib.util.spec_from_file_location('_preserved_continuation_fixture',SOURCE)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def typed(m,phase='prepare'):
 return {'schema':'pow-audit30-item2-ui-preserved-continuation-request-v1','phase':phase,'planSha256':m.PLAN_SHA,'expectedPayloadFingerprint':m.EXPECTED_PAYLOAD,'helperSourcesBase64':{name:base64.b64encode(Path(path).read_bytes()).decode() for name,path in FILES.items()}}

class Owner(unittest.TestCase):
 def test_original_transport_guard_bodies_exact(self):
  old={n.name:ast.dump(n,include_attributes=False) for n in ast.parse(OLD.read_bytes()).body if isinstance(n,ast.FunctionDef)}
  new={n.name:ast.dump(n,include_attributes=False) for n in ast.parse(SOURCE.read_bytes()).body if isinstance(n,ast.FunctionDef)}
  for name in ('identity','bound','directory','sync','durable_json','rename_new','payload_fingerprint','run','capacity'):
   self.assertEqual(old[name],new[name],name)
 def test_exact_typed_sources_pass_and_hash_tamper_refuses(self):
  m=load();v=typed(m);_,files=m.request(json.dumps(v).encode(),'prepare')
  self.assertEqual(set(files),set(FILES))
  v['helperSourcesBase64']['stager.py']=base64.b64encode(files['stager.py']+b' ').decode()
  with self.assertRaises(AssertionError):m.request(json.dumps(v).encode(),'prepare')
 def test_other_phase_plan_schema_and_payload_refuse(self):
  m=load()
  for key,value in [('phase','source'),('planSha256','0'*64),('schema','other'),('expectedPayloadFingerprint',{'entries':0})]:
   v=typed(m);v[key]=value
   with self.assertRaises(AssertionError):m.request(json.dumps(v).encode(),'prepare')
 def test_package_collision_prevents_any_write(self):
  m=load()
  with patch.object(m.os.path,'lexists',return_value=True),patch.object(m,'capacity') as cap,patch.object(m,'directory') as directory:
   with self.assertRaises(AssertionError):m.prepare({})
   cap.assert_not_called();directory.assert_not_called()
 def stage_fixture(self,failure=None):
  m=load();temporary=tempfile.TemporaryDirectory(prefix='pow-audit30-ui-owner-test-');root=Path(temporary.name)
  m.BASE=root/'scratch';m.BASE.mkdir();m.ARCHIVES=root/'archives';m.ARCHIVES.mkdir();m.EVIDENCE_ROOT=root/'evidence';m.EVIDENCE_ROOT.mkdir()
  m.PAYLOAD=m.BASE/('proofofwork-ui-surfaces-'+m.RELEASE);m.PAYLOAD.mkdir();(m.PAYLOAD/'data').write_bytes(b'preserved')
  m.PRESERVED=m.EVIDENCE_ROOT/m.PAYLOAD.name;m.out=m.BASE/'receipt';m.out.mkdir();m.PACKAGE=root/'helpers';m.PACKAGE.mkdir()
  m.env=m.ENV
  m.p={'stageArchiveUpperBoundBytes':493224843,'admissions':{'source-receive':{'bytes':315842560,'inodes':15000}}}
  model={'peakAdditionalBytes':264429568,'finalCandidateUpperBytes':258293760};calls=[];original_inode=m.PAYLOAD.stat().st_ino
  def run(argv,name,**kwargs):
   calls.append(('run',argv,name,kwargs))
   if name=='stage-model.json':(m.out/name).write_text(json.dumps(model))
   elif name=='stager.log':
    stage=m.BASE/('proofofwork-www-stage-'+m.RELEASE);stage.mkdir();(stage/'partial').write_text('candidate')
    if failure=='stager':raise AssertionError('fixture stager refused')
   elif name=='managed-model.json':(m.out/name).write_text(json.dumps({'archiveUpperBoundBytes':1000}))
   elif name=='archive.log':Path(argv[argv.index('--file')+1]).write_bytes(b'archive')
  def cap(command,path,amount,phase,inodes=10000):
   calls.append(('capacity',command,path,amount,phase,inodes))
   if failure=='admission' and phase=='stage':raise AssertionError('fixture exact limit refused')
   return {'ok':True}
  m.run=run;m.capacity=cap;m.payload_fingerprint=lambda path:copy.deepcopy(m.EXPECTED_PAYLOAD);m.inode_witness=lambda path:[['.',original_inode]]
  return m,temporary,model,calls,original_inode
 def test_capacity_refusal_before_stager_recognized_inverse(self):
  m,tmp,model,calls,inode=self.stage_fixture('admission')
  try:
   with self.assertRaises(AssertionError):m.preserve_stage({'status':'fixture'},model)
   self.assertTrue(m.PAYLOAD.exists());self.assertFalse(m.PRESERVED.exists());self.assertEqual(m.PAYLOAD.stat().st_ino,inode)
   fail=json.loads((m.out/'failure.json').read_bytes());self.assertTrue(fail['recognizedInputInversePerformed']);self.assertFalse(fail['stagerEntered']);self.assertFalse(fail['automaticRetry'])
   self.assertFalse(any(x[0]=='run' and x[2]=='stager.log' for x in calls))
  finally:tmp.cleanup()
 def test_stager_failure_keeps_protected_input_and_partial_stage(self):
  m,tmp,model,calls,inode=self.stage_fixture('stager')
  try:
   with self.assertRaises(AssertionError):m.preserve_stage({'status':'fixture'},model)
   self.assertFalse(m.PAYLOAD.exists());self.assertEqual(m.PRESERVED.stat().st_ino,inode)
   self.assertTrue((m.BASE/('proofofwork-www-stage-'+m.RELEASE)/'partial').exists())
   fail=json.loads((m.out/'failure.json').read_bytes());self.assertFalse(fail['recognizedInputInversePerformed']);self.assertTrue(fail['stagerEntered'])
  finally:tmp.cleanup()
 def test_success_retains_inode_and_full_source_charges_actual_disk(self):
  m,tmp,model,calls,inode=self.stage_fixture()
  try:
   result=m.preserve_stage({'status':'fixture'},model)
   self.assertFalse(m.PAYLOAD.exists());self.assertEqual(m.PRESERVED.stat().st_ino,inode);self.assertFalse(result['productionPublished'])
   caps=[x for x in calls if x[0]=='capacity']
   scratch=next(x for x in caps if x[4]=='next-source-receipts');self.assertEqual(scratch[1:4],('check-scratch',m.BASE,32*1024**2))
   disk=next(x for x in caps if x[4]=='next-source-evidence');self.assertEqual(disk[1:4],('check',m.EVIDENCE_ROOT,315842560+32*1024**2));self.assertEqual(disk[5],15032)
   self.assertEqual(next(x for x in caps if x[4]=='stage' and x[1]=='check-scratch')[3],264429568+32*1024**2)
  finally:tmp.cleanup()
 def test_changed_stage_model_refuses_before_stager_and_inverts(self):
  m,tmp,model,calls,inode=self.stage_fixture()
  try:
   with self.assertRaises(AssertionError):m.preserve_stage({'status':'fixture'},{**model,'peakAdditionalBytes':1})
   self.assertTrue(m.PAYLOAD.exists());self.assertFalse(m.PRESERVED.exists())
   self.assertFalse(any(x[0]=='run' and x[2]=='stager.log' for x in calls))
  finally:tmp.cleanup()
 def test_source_requires_exact_full_charge_and_fixed_receiver_provenance(self):
  m,tmp,_,calls,_=self.stage_fixture()
  try:
   m.SOURCE_ROOT=m.EVIDENCE_ROOT/('proofofwork-ui-source-'+m.RELEASE)
   archive=m.ARCHIVES/('proofofwork-ui-release-'+m.RELEASE+'.tgz');archive.write_bytes(b'archive');Path(str(archive)+'.sha256').write_text(hashlib.sha256(b'archive').hexdigest()+'  '+archive.name+'\n')
   m.p['source']={'compressedBytes':12,'sha256':'b'*64};m.bound=lambda p,d,maximum=0:Path(p).read_bytes()
   def run(argv,name,**kwargs):
    calls.append(('run',argv,name,kwargs))
    if name=='receiver.log':
     m.SOURCE_ROOT.mkdir();(m.out/name).write_text(json.dumps({'status':'verified','kind':'source','releaseId':m.RELEASE,'archiveSha256':'b'*64,'compressedBytes':12,'extractedRoot':str(m.SOURCE_ROOT)}))
    elif name=='git-commit.txt':(m.out/name).write_text(m.COMMIT+'\n')
    elif name=='git-tree.txt':(m.out/name).write_text(m.TREE+'\n')
    elif name=='git-status.txt':(m.out/name).write_bytes(b'')
   m.run=run
   with patch.object(m.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(b''))),patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=1)):
    result=m.receive_source()
   self.assertTrue(result['candidateProvenanceVerified']);self.assertFalse(result['productionPublished'])
   caps=[x for x in calls if x[0]=='capacity'];self.assertEqual(caps[0][1:4],('check-scratch',m.BASE,32*1024**2));self.assertEqual(caps[1][1:4],('check',m.EVIDENCE_ROOT,315842560+32*1024**2));self.assertEqual(caps[1][5],15032)
   receiver=next(x for x in calls if x[0]=='run' and x[2]=='receiver.log');self.assertEqual(receiver[1][3],str(m.PACKAGE/'receiver.py'));self.assertEqual(receiver[1][4:6],['source',m.RELEASE])
   provenance=next(x for x in calls if x[0]=='run' and x[2]=='candidate-provenance.log');self.assertEqual(provenance[1][0],str(m.PACKAGE/'provenance.sh'));self.assertEqual(provenance[3]['extra']['POW_UI_STAGED_ROOT'],'1')
  finally:tmp.cleanup()
 def test_no_module_import_side_effects_and_namespace_guard(self):
  parsed=ast.parse(SOURCE.read_bytes());self.assertEqual(parsed.body[-1].test.left.id,'__name__')
  for phase in ('prepare','preserve-stage','source'):
   self.assertIn('proofofwork-audit30-item2-ui-preserved-',SOURCE.read_text())
  self.assertNotIn('reset-failed',SOURCE.read_text());self.assertNotIn('unlink(',SOURCE.read_text());self.assertNotIn('rmtree(',SOURCE.read_text())

if __name__=='__main__':unittest.main()
