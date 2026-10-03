import ast,base64,hashlib,importlib.util,json,os,stat,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
S=Path('/tmp/pow-audit30-body-human-authority-install-v1.py');spec=importlib.util.spec_from_file_location('inert_install',S);M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
REQUEST=Path('/tmp/pow-audit30-body-human-authority-install-request-v1.json').read_bytes()
class Cases(unittest.TestCase):
 def test_actual_payload_decode(self):
  helper,rows=M.decode(REQUEST);self.assertEqual(len(rows),3);self.assertEqual(rows['human-message.txt'],b'i approve');self.assertEqual(M.sha(helper),M.HELPER_SHA)
 def test_body_flags_and_exact_human_provenance(self):
  _,rows=M.decode(REQUEST);a=json.loads(rows['human-approval.json']);self.assertEqual(len(a),24);self.assertEqual(a['humanApprovalEvidenceSHA256'],M.FILES['direct-human-approval.json'][1]);self.assertEqual(a['authorizedOperations'],['apply','inverse']);self.assertFalse(a['automaticRetryAllowed']);self.assertTrue(a['canonicalReadinessInvalidationApproved'])
 def test_drift_each_rawmember_refuses(self):
  v=json.loads(REQUEST)
  for n in M.FILES:
   x=json.loads(REQUEST);b=base64.b64decode(x['files'][n]['base64']);x['files'][n]['base64']=base64.b64encode(b+b' ').decode()
   with self.assertRaisesRegex(ValueError,'EXACT_MEMBER_BYTES'):M.decode(M.enc(x))
 def test_scope_extra_and_duplicate_refuse(self):
  v=json.loads(REQUEST);v['files']['extra']={}
  with self.assertRaises(ValueError):M.decode(M.enc(v))
  with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'):M.decode(REQUEST[:-1]+b',"schema":"bad"}')
 def test_wrong_helper_pin_refuses(self):
  v=json.loads(REQUEST);v['captureHelperBase64']=base64.b64encode(b'not helper').decode()
  with self.assertRaisesRegex(ValueError,'EXACT_FS_HELPER_PIN'):M.decode(M.enc(v))
 def test_existing_authority_has_zero_helpersideeffects(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d);a=p/'authority';a.mkdir()
   with patch.object(M,'BASE',p),patch.object(M,'AUTH',a),patch.object(M,'directory',return_value=('synthetic-root',)):
    with self.assertRaisesRegex(ValueError,'AUTHORITY_ALREADY_EXISTS'):M.install(REQUEST)
   self.assertEqual(list(a.iterdir()),[])
 def test_immutable_symlink_and_hardlink_refuse(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'member';p.write_bytes(b'yes');s=Path(d)/'link';s.symlink_to(p)
   with self.assertRaises(ValueError):M.verify(s,b'yes')
   os.link(p,Path(d)/'hard')
   with self.assertRaises(ValueError):M.verify(p,b'yes')
 def test_source_no_native_calls_or_caller(self):
  s=S.read_text();self.assertNotIn('subprocess.',s);self.assertNotIn('systemd-run',s);self.assertNotIn('.execute(',s);self.assertNotIn('writeExactSixteen',s);self.assertNotIn('g.execute',s)
 def test_generator_envelopes_mode_only_and_actualpins(self):
  a=json.loads(Path('/tmp/pow-audit30-body-prepare-envelope-20261003T145500Z-v1.json').read_bytes());b=json.loads(Path('/tmp/pow-audit30-body-run-envelope-20261003T145500Z-v1.json').read_bytes());self.assertEqual({k:v for k,v in a['request'].items()if k!='mode'},{k:v for k,v in b['request'].items()if k!='mode'});self.assertEqual(a['rootControlBase64'],b['rootControlBase64']);self.assertIsNone(a['request']['priorApply']);self.assertEqual(a['request']['runId'],'20261003T145500Z');self.assertEqual(a['request']['approval']['sha256'],M.FILES['human-approval.json'][1])
 def test_staged_fs_helper_unchanged(self):
  helper,_=M.decode(REQUEST);self.assertEqual(helper,Path('/home/sixer/ProofOfWork.Me/deploy/audit30/verification/pow-audit30-private-sixteen-bootstrap-v2.py').read_bytes())
if __name__=='__main__':unittest.main()
