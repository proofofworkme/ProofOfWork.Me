import pathlib,unittest
SOURCE=pathlib.Path('/tmp/pow-audit30-strict-v3-progress-read.py')
class Tests(unittest.TestCase):
 def setUp(self):
  self.n={'__name__':'_passive_fixture','__file__':str(SOURCE)};exec(compile(SOURCE.read_bytes(),str(SOURCE),'exec'),self.n);t={'__name__':'_acceptance_fixture','__file__':'/tmp/pow-audit30-acceptance-v3.test.py'};exec(compile(pathlib.Path(t['__file__']).read_bytes(),t['__file__'],'exec'),t);n,v,r=t['PriorProjection']().fixture();self.p=n['prior_failed_evidence']();self.p['driverReceiptSHA256']='0f77ed860b40e4762f4ad0962dbc66faded888d6db865bd44e542842eff5689c'
 def test_counts_and_named_failures_only(self):
  r=self.n['prior_projection']({'priorFailedAttempt':self.p,'privateEnvironment':'unexported'});self.assertEqual(r['gateReceipts']['ids']['counts']['Confirmed winners'],508);self.assertEqual(len(r['gateReceipts']['parity']['failedChecks']),3);self.assertNotIn('privateEnvironment',r)
 def test_prior_hash_change_refused(self):
  self.p['driverReceiptSHA256']='f'*64;self.assertRaisesRegex(ValueError,'PRIOR_BINDING',self.n['prior_projection'],{'priorFailedAttempt':self.p})
 def test_failed_warning_change_refused(self):
  self.p['gateReceipts']['parity']['failedChecks'][1]['severity']='error';self.assertRaisesRegex(ValueError,'PRIOR_FAILED_CHECKS',self.n['prior_projection'],{'priorFailedAttempt':self.p})
 def test_swapped_counts_refused(self):
  self.p['gateReceipts']['ids']['counts']['Confirmed winners']=565;self.assertRaisesRegex(ValueError,'PRIOR_COUNTS',self.n['prior_projection'],{'priorFailedAttempt':self.p})
 def test_no_service_control_or_env_log_export(self):
  s=SOURCE.read_text()
  for x in ['systemctl stop','systemctl start','subprocess.Popen','/environ','journalctl']:self.assertNotIn(x,s)
if __name__=='__main__':unittest.main()
