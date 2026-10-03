import ast,copy,datetime,pathlib,types,unittest
SOURCE=pathlib.Path('/tmp/pow-audit30-postcutover-mail-html-assemble-v3.py');ROOT=pathlib.Path('/home/sixer/ProofOfWork.Me')
class Tests(unittest.TestCase):
 def setUp(self):
  self.n={'__name__':'_assemble_fixture','__file__':str(SOURCE)};exec(compile(SOURCE.read_bytes(),str(SOURCE),'exec'),self.n);self.now=datetime.datetime.now(datetime.timezone.utc);self.live={u:{'MainPID':pair[0],'InvocationID':pair[1]}for u,pair in self.n['AUTH'].items()};self.live.update({'proofofwork-api.service':{'MainPID':'5000001','InvocationID':'a'*32},'proofofwork-indexer-worker.service':{'MainPID':'5000002','InvocationID':'b'*32}});self.path='/data/proofofwork-audit29-cutover-'+self.n['RELEASE']+'-item2-v1/110-final.json';self.cutover={'ok':True,'phase':'complete','commit':self.n['COMMIT'],'authorityServicesModified':False,'recoveryRemoved':False,'at':self.now.isoformat()}
 def test_fresh_dynamic_apps_and_fixed_original_three(self):self.n['authority'](self.live,self.cutover,self.path,self.now)
 def test_old_application_pid_or_invocation_refused(self):
  for field,value in zip(['MainPID','InvocationID'],self.n['OLD']['proofofwork-api.service']):
   q=copy.deepcopy(self.live);q['proofofwork-api.service'][field]=value;self.assertRaisesRegex(ValueError,'FRESH_APPLICATION',self.n['authority'],q,self.cutover,self.path,self.now)
 def test_authority_change_refused(self):
  q=copy.deepcopy(self.live);q['bitcoind.service']['InvocationID']='c'*32;self.assertRaisesRegex(ValueError,'AUTHORITIES_CHANGED',self.n['authority'],q,self.cutover,self.path,self.now)
 def test_wrong_or_stale_cutover_refused(self):
  for key,value in [('phase','rolled-back'),('commit','c'*40),('authorityServicesModified',True),('recoveryRemoved',True)]:
   q=copy.deepcopy(self.cutover);q[key]=value;self.assertRaisesRegex(ValueError,'CUTOVER_NOT_COMPLETE',self.n['authority'],self.live,q,self.path,self.now)
  q=copy.deepcopy(self.cutover);q['at']=(self.now-datetime.timedelta(seconds=1801)).isoformat();self.assertRaisesRegex(ValueError,'CUTOVER_STALE',self.n['authority'],self.live,q,self.path,self.now)
 def test_exact_requests_bind_new_sources_and_only_after(self):
  child,values=self.n['assemble']('20261003T203000Z',self.live,self.cutover,self.path);self.assertEqual(child['stage'],'after');self.assertEqual(child['liveFive'],self.live);self.assertEqual(child['sourceSha256'],'8c95837d43e994d906cc4bbebb8a443bede34802d5eaf5d93cd2f61f60ef86db');self.assertEqual(set(values),{'prepare','run'});self.assertEqual(values['prepare']['collectorRequestSha256'],values['run']['collectorRequestSha256'])
 def test_transport_functions_identical_and_source_only_no_network(self):
  def fns(path):return {n.name:ast.dump(n,include_attributes=False)for n in ast.parse(path.read_bytes()).body if isinstance(n,ast.FunctionDef)}
  self.assertEqual(fns(ROOT/'deploy/audit30/verification/pow-audit30-readonly-owned-transport-v3.py'),fns(pathlib.Path('/tmp/pow-audit30-postcutover-mail-html-transport-v3.py')))
  s=SOURCE.read_text();self.assertNotIn('subprocess',s);self.assertNotIn('ssh',s.lower().replace('never ssh',''));self.assertIn('O_EXCL',s)
if __name__=='__main__':unittest.main()
