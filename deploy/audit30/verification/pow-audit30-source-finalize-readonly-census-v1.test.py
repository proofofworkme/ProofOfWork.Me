import base64,copy,hashlib,importlib.util,json,os,pathlib,stat,tempfile,types,unittest
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('C','/tmp/pow-audit30-source-finalize-readonly-census-v1.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
SUMMARY=json.loads(pathlib.Path('/tmp/pow-audit30-math-source-finalize-native-v3.stdout').read_bytes())
def vectors():
 v={k:x for k,x in SUMMARY.items()if k not in('nativeReadabilityPassed','InvocationID','unitStopVerified','entryCount','regularBytes')};v['nativeReadability']={'unit':'proofofwork-audit30-math-source-readability-v4.service','InvocationID':C.INV,'receipt':{'uid':108,'gid':112,'entries':6141,'allSourceAndDependenciesReadable':True},'ownedStop':{'unitStopVerified':True},'remainAfterExitStopped':True}
 m={'schema':'pow-audit30-onhost-math-source-copy-v1','candidateRoot':'/opt/proofofwork-api-stage-3399d767103e-20261003T020420Z','sourceRoot':str(C.PACKAGE/'source'),'candidateAttestationSHA256':C.ATTEST,'attestationBeforeSHA256':C.ATTEST,'attestationAfterSHA256':C.ATTEST,'sourceInventorySHA256':C.INVENTORY,'entryCount':6141,'regularBytes':164382510,'entries':[{}for _ in range(6141)],'sourceBytesExact':True,'candidateUnchanged':True,'nativeReadabilityPassed':True,'privateRawStateCopied':False};return v,m
class Tests(unittest.TestCase):
 def test_fixed_two_paths_no_subprocess_import(self):
  self.assertEqual(C.COMPLETION,C.PACKAGE/'source-copy-finalize-v3-completed.json');self.assertEqual(C.MANIFEST,C.PACKAGE/'source-copy-manifest.json');self.assertFalse(hasattr(C,'subprocess'))
 def test_exact_summary_request(self):
  b=pathlib.Path('/tmp/pow-audit30-math-source-finalize-native-v3.stdout').read_bytes();r={'schema':'pow-audit30-source-finalize-readonly-census-request-v1','summaryBase64':base64.b64encode(b).decode(),'summarySha256':C.SUMMARY_SHA,'manifestSha256':C.MANIFEST_SHA};self.assertEqual(C.request(C.encoded(r)),SUMMARY)
  for d in(r|{'extra':True},r|{'manifestSha256':'f'*64},r|{'summaryBase64':base64.b64encode(b+b'\n').decode()},r|{'summaryBase64':'!'}):self.assertRaises(C.Refused,C.request,C.encoded(d))
 def test_duplicate_json_refuses(self):self.assertRaises(C.Refused,C.parse,b'{"x":1,"x":2}')
 def test_actual_summary_and_valid_full_receipt(self):
  v,m=vectors();self.assertTrue(C.validate(v,m,SUMMARY))
 def test_no_failed_receipt_promoted(self):
  v,m=vectors();self.assertRaises(C.Refused,C.validate,v|{'status':'failed'},m,SUMMARY)
 def test_wrong_completed_request_or_manifest_hash_refuses(self):
  v,m=vectors()
  for k in('requestSHA256','sourceCopyManifestSHA256'):self.assertRaises(C.Refused,C.validate,v|{k:'f'*64},m,SUMMARY)
 def test_no_wrong_native_role_count_invocation_or_unstopped(self):
  for field,bad in [('unit','wrong.service'),('InvocationID','b'*32),('remainAfterExitStopped',False)]:
   v,m=vectors();v['nativeReadability'][field]=bad;self.assertRaises(C.Refused,C.validate,v,m,SUMMARY)
  for field,bad in [('uid',0),('gid',108),('entries',6140),('allSourceAndDependenciesReadable',False)]:
   v,m=vectors();v['nativeReadability']['receipt'][field]=bad;self.assertRaises(C.Refused,C.validate,v,m,SUMMARY)
  v,m=vectors();v['nativeReadability']['ownedStop']['unitStopVerified']=False;self.assertRaises(C.Refused,C.validate,v,m,SUMMARY)
 def test_each_sourcecopy_completeness_and_no_state_flag_refuses(self):
  for k in('priorAttemptRemainsFailed','sourceTreeNotModified','candidateUnchanged'):
   v,m=vectors();self.assertRaises(C.Refused,C.validate,v|{k:False},m,SUMMARY)
  for k in('productionMutation','privateRawStateCopied'):
   v,m=vectors();self.assertRaises(C.Refused,C.validate,v|{k:True},m,SUMMARY)
 def test_manifest_wrong_scope_or_partial_entries_refuses(self):
  v,m=vectors()
  for k,bad in [('candidateRoot','/opt/proofofwork-api'),('sourceRoot','/tmp/source'),('candidateAttestationSHA256','f'*64),('attestationBeforeSHA256','f'*64),('sourceInventorySHA256','f'*64),('entryCount',6140),('regularBytes',164382511),('entries',m['entries'][:-1]),('sourceBytesExact',False),('candidateUnchanged',False),('nativeReadabilityPassed',False),('privateRawStateCopied',True)]:
   with self.subTest(k=k):self.assertRaises(C.Refused,C.validate,v,m|{k:bad},SUMMARY)
 def test_summary_rebinding_or_added_receipt_data_refuses(self):
  v,m=vectors();self.assertRaises(C.Refused,C.validate,v,m,SUMMARY|{'sourceTreeNotModified':False});self.assertRaises(C.Refused,C.validate,v|{'extra':'unapproved'},m,SUMMARY)
 def file(self,d,data=b'abc',mode=0o600):
  p=pathlib.Path(d)/'f';p.write_bytes(data);p.chmod(mode);return p
 def test_actual_owned_private_read_noatime_and_full_metadata(self):
  with tempfile.TemporaryDirectory()as d:
   p=self.file(d);os.utime(p,ns=(1,p.stat().st_mtime_ns));old=p.stat();raw,m=C.read_verified(p,10,os.getuid(),os.getgid(),0o600,C.sha(b'abc'));self.assertEqual(raw,b'abc');self.assertEqual(m['metadata'],C.stamp(old));self.assertEqual(p.stat().st_atime_ns,1)
 def test_real_symlink_and_hardlink_refuse(self):
  with tempfile.TemporaryDirectory()as d:
   p=self.file(d);alias=pathlib.Path(d)/'alias';alias.symlink_to(p);self.assertRaises(C.Refused,C.read_verified,alias,10,os.getuid(),os.getgid(),0o600);hard=pathlib.Path(d)/'hard';hard.hardlink_to(p);self.assertRaises(C.Refused,C.read_verified,p,10,os.getuid(),os.getgid(),0o600)
 def test_wrong_mode_owner_size_hash_empty_refuse(self):
  with tempfile.TemporaryDirectory()as d:
   p=self.file(d)
   for cap,uid,gid,mode,h in[(2,os.getuid(),os.getgid(),0o600,None),(10,os.getuid()+1,os.getgid(),0o600,None),(10,os.getuid(),os.getgid()+1,0o600,None),(10,os.getuid(),os.getgid(),0o644,None),(10,os.getuid(),os.getgid(),0o600,'f'*64)]:self.assertRaises(C.Refused,C.read_verified,p,cap,uid,gid,mode,h)
   p.write_bytes(b'');self.assertRaises(C.Refused,C.read_verified,p,10,os.getuid(),os.getgid(),0o600)
 def test_real_replacement_during_read_refuses(self):
  with tempfile.TemporaryDirectory()as d:
   p=self.file(d);read=os.read;replaced=False
   def swap(fd,n):
    nonlocal replaced
    b=read(fd,n)
    if not replaced:
     q=pathlib.Path(d)/'new';q.write_bytes(b'abc');q.chmod(0o600);q.replace(p);replaced=True
    return b
   with patch.object(C.os,'read',side_effect=swap):self.assertRaises(C.Refused,C.read_verified,p,10,os.getuid(),os.getgid(),0o600)
 def test_xattr_refusal(self):
  with tempfile.TemporaryDirectory()as d:
   p=self.file(d);os.setxattr(p,'user.audit30',b'x');self.assertRaises(C.Refused,C.read_verified,p,10,os.getuid(),os.getgid(),0o600)
 def test_deadline_refusal_before_file_read(self):
  C.DEADLINE=0
  try:self.assertRaises(C.Refused,C.read_verified,pathlib.Path('/nonexistent'),10,0,0,0o600)
  finally:C.DEADLINE=None
 def test_collect_repeated_fullmetadata_drift_refuses(self):
  v,m=vectors();a=C.encoded(v);b=C.encoded(m);am={'sha256':C.sha(a),'metadata':{}};bm={'sha256':C.MANIFEST_SHA,'metadata':{}}
  with patch.object(C,'parent_shape',return_value={'fixed':True}),patch.object(C,'read_verified',side_effect=[(a,am),(b,bm),(a,am|{'metadata':{'ino':2}}),(b,bm)]):self.assertRaises(C.Refused,C.collect,SUMMARY)
 def test_collect_exports_only_safe_hash_count_metadata(self):
  v,m=vectors();a=C.encoded(v);b=C.encoded(m);am={'sha256':C.sha(a),'metadata':{}};bm={'sha256':C.MANIFEST_SHA,'metadata':{}}
  with patch.object(C,'parent_shape',return_value={'fixed':True}),patch.object(C,'read_verified',side_effect=[(a,am),(b,bm),(a,am),(b,bm)]):out=C.collect(SUMMARY)
  self.assertEqual(out['status'],'passed');self.assertNotIn('entries',out);self.assertNotIn('nativeReadability',out);self.assertFalse(out['payloadExported']);self.assertFalse(out['sqlCoreUnitActions'])
if __name__=='__main__':unittest.main()
