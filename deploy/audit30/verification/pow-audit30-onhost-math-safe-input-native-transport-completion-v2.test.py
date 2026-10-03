import ast,hashlib,importlib.util,json,pathlib,sys,tempfile,unittest
from unittest.mock import patch
P=pathlib.Path
SOURCE=P('/tmp/pow-audit30-onhost-math-safe-input-native-transport-completion-v2.py')
spec=importlib.util.spec_from_file_location('safe_completion_outer',SOURCE);S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
TEMPLATE=P('/tmp/pow-audit30-onhost-math-safe-input-request-template-completion-v2.json')
class Bindings(unittest.TestCase):
 def test_null_actual_template_refuses_before_execute(self):
  raw=TEMPLATE.read_bytes();m=S.library()
  with patch.object(S,'REQUEST',TEMPLATE),patch.object(m,'execute')as execute:
   with self.assertRaisesRegex(Exception,'ACTUAL_STREAM_PINS'):S.inputs(hashlib.sha256(raw).hexdigest(),m)
   execute.assert_not_called()
  v=json.loads(raw);self.assertIsNone(v['streamCompletedSha256']);self.assertIsNone(v['streamIntentSha256']);self.assertIsNone(v['liveFive'])
 def test_wrong_raw_request_pin_refuses(self):
  with patch.object(S,'REQUEST',TEMPLATE),self.assertRaisesRegex(ValueError,'path/hash drift'):S.inputs('f'*64,S.library())
 def test_exact_shared_runner_reused_without_local_process_logic(self):
  tree=ast.parse(SOURCE.read_bytes());imports=[n for n in tree.body if isinstance(n,ast.Import)]
  self.assertFalse(any(a.name in ('subprocess','selectors','signal')for n in imports for a in n.names))
  self.assertEqual(hashlib.sha256(S.H.read_bytes()).hexdigest(),S.HP)
  text=SOURCE.read_text();self.assertIn('PREFIX,240,stdout_cap=CAP,stderr_cap=CAP',text)
 def test_only_new_census_and_namespace(self):
  self.assertEqual(S.SOURCE.name,'pow-audit30-onhost-math-safe-input-census-completion-v2.py');self.assertEqual(hashlib.sha256(S.SOURCE.read_bytes()).hexdigest(),S.SOURCE_SHA)
  self.assertEqual(S.REQUEST.name,'pow-audit30-onhost-math-safe-input-request-completion-v2.json');self.assertTrue(S.PREFIX.endswith('native-completion-v2'))
  self.assertEqual(S.CAP,1024**2)
 def test_fixed_ssh_source_bytes_and_request_hash(self):
  a=S.library().remote_command(b'print("safe")','a'*64);self.assertIn('StrictHostKeyChecking=yes',a);self.assertEqual(a[-2],'powadmin@65.108.122.87');self.assertTrue(a[-1].startswith('sudo -n /usr/bin/python3 -I -B -c '));self.assertTrue(a[-1].endswith(' '+'a'*64))
 def test_template_embeds_exact_reviewed_managed_source(self):
  import base64
  v=json.loads(TEMPLATE.read_bytes());self.assertEqual(v['schema'],'pow-audit30-onhost-math-safe-input-request-completion-v2')
  self.assertEqual(base64.b64decode(v['managedBase64'],validate=True),P('/tmp/pow-audit30-onhost-math-managed-completion-v2.py').read_bytes())
  self.assertFalse(S.REQUEST.exists());self.assertFalse(P(S.PREFIX+'.stdout').exists())
if __name__=='__main__':unittest.main()
