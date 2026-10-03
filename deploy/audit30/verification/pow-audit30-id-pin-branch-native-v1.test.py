import base64,json,pathlib,subprocess,unittest
b=json.loads(pathlib.Path('/tmp/pow-audit30-id-pin-branch-source-binding-v1.json').read_bytes());snippet=base64.b64decode(b['snippetBase64']).decode();commit=b['expectedCommitment'];program='const workAmoV8DeclarationCommitment=()=>Object.freeze('+json.dumps(commit)+');\n'+snippet+'\nconsole.log(JSON.stringify({configured:WORK_AMO_V8_DECLARATION_PINS_CONFIGURED,pinState:WORK_AMO_V8_DECLARATION_PIN_STATE,activation:WORK_AMO_V8_ACTIVATION_HEIGHT,writes:WORK_AMO_V8_WRITES_CONFIGURED}));'
class Tests(unittest.TestCase):
 def setUp(self):self.env={'PATH':'/usr/bin:/bin','LC_ALL':'C','WORK_AMO_V8_WRITES_ENABLED':'1','WORK_AMO_V8_DECLARATION_TXID':'a'*64,'WORK_AMO_V8_DECLARATION_HEIGHT':'960600','WORK_AMO_V8_DECLARATION_BLOCK_HASH':'b'*64,'WORK_AMO_V8_DECLARATION_BLOCK_INDEX':'0','WORK_AMO_V8_DECLARATION_MEMO_SHA256':commit['protocolRecordSha256'],'WORK_AMO_V8_DECLARATION_MEMO_BYTES':str(commit['protocolRecordBytes']),'WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT':'0','WORK_AMO_V8_DECLARATION_RECORD_ORDINAL':'0','WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT':'1','WORK_AMO_V8_ACTIVATION_HEIGHT':'960601'}
 def evaluate(self):
  r=subprocess.run(['/home/sixer/.local/bin/node','--input-type=module','--eval',program],env=self.env,capture_output=True,timeout=3)if pathlib.Path('/home/sixer/.local/bin/node').exists()else subprocess.run(['/usr/bin/node','--input-type=module','--eval',program],env=self.env,capture_output=True,timeout=3)
  self.assertEqual(r.returncode,0,r.stderr.decode());return json.loads(r.stdout)
 def test_exact_config_selects_branch(self):self.assertEqual(self.evaluate(),{'configured':True,'pinState':'configured','activation':960601,'writes':True})
 def test_all_unset_proves_no_fast_branch(self):self.env={'PATH':'/usr/bin:/bin','LC_ALL':'C'};self.assertEqual(self.evaluate(),{'configured':False,'pinState':'unrequested','activation':None,'writes':False})
 def test_missing_each_required_pin_disables_branch(self):
  for key in [k for k in self.env if k.startswith('WORK_AMO_V8_')and k!='WORK_AMO_V8_WRITES_ENABLED']:
   self.setUp();del self.env[key]
   with self.subTest(key=key):self.assertFalse(self.evaluate()['configured'])
 def test_no_writes_still_configured_read_branch(self):self.env['WORK_AMO_V8_WRITES_ENABLED']='0';self.assertTrue(self.evaluate()['configured']);self.assertFalse(self.evaluate()['writes'])
 def test_incorrect_commitment_disables_branch(self):self.env['WORK_AMO_V8_DECLARATION_MEMO_SHA256']='c'*64;self.assertFalse(self.evaluate()['configured'])
 def test_wrong_commitment_length_disables_branch(self):self.env['WORK_AMO_V8_DECLARATION_MEMO_BYTES']='1';self.assertFalse(self.evaluate()['configured'])
 def test_noncanonical_number_disables_branch(self):self.env['WORK_AMO_V8_DECLARATION_HEIGHT']='0960600';self.assertFalse(self.evaluate()['configured'])
 def test_noncanonical_hash_disables_branch(self):self.env['WORK_AMO_V8_DECLARATION_TXID']='A'*64;self.assertFalse(self.evaluate()['configured'])
 def test_wrong_activation_disables_branch(self):self.env['WORK_AMO_V8_ACTIVATION_HEIGHT']='960602';self.assertFalse(self.evaluate()['configured'])
 def test_wrong_ordinal_disables_branch(self):self.env['WORK_AMO_V8_DECLARATION_RECORD_ORDINAL']='1';self.assertFalse(self.evaluate()['configured'])
if __name__=='__main__':unittest.main()
