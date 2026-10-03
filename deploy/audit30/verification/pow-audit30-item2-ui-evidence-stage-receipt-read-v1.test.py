#!/usr/bin/python3 -I -B
"""Pure receipt/manifest/privacy/source-read and no-control fixtures."""
import ast,base64,hashlib,importlib.util,json,sys,types,unittest
from pathlib import Path
from unittest.mock import patch
SOURCE=Path('/tmp/pow-audit30-item2-ui-evidence-stage-receipt-read-v1.py')
s=importlib.util.spec_from_file_location('_evidence_receipt_reader_fixture',SOURCE);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def owner():
 o=types.ModuleType('_receipt_owner');sys.modules[o.__name__]=o;exec(compile(base64.b64decode(m.OWNER_BASE64),'_fixture_owner','exec'),o.__dict__);return o
class Read(unittest.TestCase):
 def test_frozen_owner_has_exact_prepared_authority_bytes(self):
  raw=base64.b64decode(m.OWNER_BASE64,validate=True);self.assertEqual(hashlib.sha256(raw).hexdigest(),m.OWNER_SHA);self.assertEqual(raw,Path('/tmp/pow-audit30-item2-ui-evidence-stage-continuation-v3.py').read_bytes())
 def manifest(self):
  o=owner();v={'format':'proofofwork-ui-release-v3','release_id':o.RELEASE,'commit':o.COMMIT,'source_tree':o.TREE,'archive_sha256':'a'*64,'archive_name':'proofofwork-ui-release-'+o.RELEASE+'.tgz','source_attestation':'detached-recursive-git-tree-v1','source_dependency_model':'node-modules-recursive-v1','archive_payload_model':'surfaces-v1','deployed_at':'2026-10-03T20:00:00Z','source_dependency_sha256':'b'*64,'source_dependency_entry_count':'123','source_dependency_bytes':'123456'}
  for name in o.SURFACES:v['surface.'+name+'.file_count']='1';v['surface.'+name+'.sha256']='c'*64
  return o,v
 def encode(self,v):return ''.join(k+'='+value+'\n'for k,value in v.items()).encode()
 def test_exact_manifest_and_all16_surface_typed_fields(self):
  o,v=self.manifest();got=m.manifest_projection(self.encode(v),o,'a'*64);self.assertEqual(got['releaseId'],o.RELEASE);self.assertEqual(len(got['surfaces']),16);self.assertEqual(got['surfaces']['computer'],got['surfaces']['nft'])
 def test_manifest_wrong_release_commit_tree_archive_and_dependency_refuse(self):
  for key in('release_id','commit','source_tree','archive_sha256','source_attestation','source_dependency_model','source_dependency_sha256','source_dependency_entry_count','deployed_at'):
   o,v=self.manifest();v[key]='invalid';
   with self.assertRaises(ValueError):m.manifest_projection(self.encode(v),o,'a'*64)
 def test_manifest_duplicates_and_nft_alias_refuse(self):
  o,v=self.manifest()
  with self.assertRaises(ValueError):m.manifest_projection(self.encode(v)+b'commit=private\n',o,'a'*64)
  v['surface.nft.sha256']='d'*64
  with self.assertRaises(ValueError):m.manifest_projection(self.encode(v),o,'a'*64)
 def test_unknown_manifest_material_never_exported(self):
  o,v=self.manifest();v['private_unrequested_field']='sentinel-unknown-secret';got=m.manifest_projection(self.encode(v),o,'a'*64);self.assertNotIn('sentinel',json.dumps(got));self.assertNotIn('private_unrequested_field',got)
 def receipts(self,phase):
  o=owner();root=o.BASE/('recovery-transport-'+o.RELEASE+'-evidence-stage-'+phase+'-v3');inv='f'*32
  intent={'schema':'pow-audit30-item2-ui-evidence-stage-continuation-intent-v3','releaseId':o.RELEASE,'phase':phase,'planSha256':o.PLAN_SHA,'requestSha256':m.REQUEST_PINS[phase],'recognizedPriorStageFailure':o.STAGE_FAILED_PINS,'recognizedRestageFailure':o.RESTAGE_FAILED_PINS,'incomingReceiptSha256':o.INCOMING_SHA,'exactStageRoot':str(o.STAGE_ROOT),'actualStageAllocationParent':str(o.EVIDENCE_ROOT),'globalScratchReceiptParent':str(o.BASE),'ownedUnit':{'InvocationID':inv}}
  v={'schema':'pow-audit30-item2-ui-evidence-stage-continuation-result-v3','releaseId':o.RELEASE,'phase':phase,'evidence':str(root),'planSha256':o.PLAN_SHA,'requestSha256':m.REQUEST_PINS[phase],'ownedUnitInvocationID':inv,'ok':True,'oldFailurePreserved':True,'oldLiveUnchanged':True,'allPriorRootsPreserved':True,'installedHelpersModified':False,'historicalDeletion':False,'productionPublished':False,'automaticRetry':False,'private_unrequested_field':'sentinel-secret'}
  if phase=='stage':v.update(managedArchive=str(o.ARCHIVES/('proofofwork-ui-release-'+o.RELEASE+'.tgz')),archiveSha256='a'*64,preservedInput=str(o.PRESERVED),inputFingerprint=o.EXPECTED_PAYLOAD,inputAlreadyPreserved=True,movePreservedInodes=True,recognizedPriorStageFailure=o.STAGE_FAILED_PINS,recognizedRestageFailure=o.RESTAGE_FAILED_PINS,stageRoot=str(o.STAGE_ROOT),actualStageAllocationParent=str(o.EVIDENCE_ROOT),globalScratchReceiptParent=str(o.BASE),conservativeStageCopyBytes=453701632,capacitySiblingSha256=o.HELPER_PINS[o.CAPACITY_NAME][0])
  else:v.update(sourceCheckout=str(o.SOURCE_ROOT),detachedSourceClean=True,candidateProvenanceVerified=True)
  def read(p,*args):return (json.dumps(intent if p.name=='intent.json'else v).encode(),{'path':str(p),'bytes':1,'sha256':'d'*64})
  return o,intent,v,read
 def test_both_phase_receipts_export_only_closed_projection(self):
  for phase in('stage','source'):
   o,intent,v,read=self.receipts(phase)
   with patch.object(m,'read',side_effect=read):raw,got=m.phase_receipt(o,phase)
   self.assertEqual(got['phase'],phase);self.assertNotIn('sentinel',json.dumps(got));self.assertNotIn('ownedUnit',got)
 def test_wrong_bound_intent_paths_invocation_and_actual_flags_refuse(self):
  for key,value in(('phase','wrong'),('ownedUnitInvocationID','a'*32),('requestSha256','a'*64),('productionPublished',True),('historicalDeletion',True),('ok',1),('sourceCheckout','/wrong'),('candidateProvenanceVerified',False)):
   o,intent,v,read=self.receipts('source');v[key]=value
   with patch.object(m,'read',side_effect=read):
    with self.assertRaises(ValueError):m.phase_receipt(o,'source')
 def test_typed_integer_and_quiet_predicate_reject_bool_or_active(self):
  self.assertFalse(m.uint(True));self.assertFalse(m.uint(-1));self.assertFalse(m.uint(4,3));self.assertTrue(m.uint(3,3));self.assertTrue(m.quiet({'MainPID':'0','ActiveState':'inactive','LoadState':'not-found'}));self.assertFalse(m.quiet({'MainPID':'1','ActiveState':'active','LoadState':'loaded'}))
 def test_source_projection_only_exact_readonly_git_commands(self):
  o=owner();responses=[types.SimpleNamespace(returncode=0,stdout=(o.COMMIT+'\n').encode(),stderr=b''),types.SimpleNamespace(returncode=0,stdout=(o.TREE+'\n').encode(),stderr=b''),types.SimpleNamespace(returncode=1,stdout=b'',stderr=b''),types.SimpleNamespace(returncode=0,stdout=b'',stderr=b'')]
  with patch.object(m.subprocess,'run',side_effect=responses)as run:got=m.source_projection(o,o.SOURCE_ROOT)
  self.assertTrue(got['clean']);self.assertTrue(got['detached']);self.assertEqual(run.call_count,4)
  self.assertTrue(all(call.args[0][0]=='/usr/bin/git'for call in run.call_args_list));self.assertNotIn('sentinel',json.dumps(got))
 def test_reader_no_control_write_inverse_or_native_launch(self):
  tree=ast.parse(SOURCE.read_bytes());calls=[ast.unparse(n.func)for n in ast.walk(tree)if isinstance(n,ast.Call)]
  for bad in('owner.main','owner.restage','owner.receive_source','owner.prepare_package','owner.durable_json','owner.rename_new','os.unlink','os.rename','subprocess.Popen'):self.assertNotIn(bad,calls)
  text=SOURCE.read_text();self.assertIn('fcntl.LOCK_SH|fcntl.LOCK_NB',text);self.assertIn('signal.alarm(360)',text);self.assertIn("'httpsVerifiedByReader':False",text);self.assertNotIn("'systemd-run'",text)
if __name__=='__main__':unittest.main()
