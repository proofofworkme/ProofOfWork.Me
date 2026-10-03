import copy,datetime,pathlib,re,unittest
SOURCE=pathlib.Path('/tmp/pow-audit30-postcutover-production-strict-v2.py')
def module():
 n={'__name__':'_production_strict_fixture','__file__':str(SOURCE)};exec(compile(SOURCE.read_bytes(),str(SOURCE),'exec'),n);return n
class Tests(unittest.TestCase):
 def setUp(self):self.n=module();self.now=datetime.datetime.now(datetime.timezone.utc)
 def cutover(self):return {'ok':True,'phase':'complete','commit':self.n['CANDIDATE']['commit'],'authorityServicesModified':False,'recoveryRemoved':False,'at':self.now.isoformat()}
 def binding(self):return {'path':'/data/proofofwork-audit29-cutover-'+self.n['RELEASE']+'-item2-v1/111-final.json','sha256':'a'*64}
 def capture(self):return {'captureId':'38ac6e2bff2a-20261003T203000Z','apiEnvironSHA256':'b'*64,'processes':{'api':{'pid':123}}}
 def accepted(self,c):return {'ok':True,'mode':'production','candidate':copy.deepcopy(self.n['CANDIDATE']),'base':self.n['BASE'],'authority':self.n['AUTHORITY'],'network':'livenet','gates':dict(ids=True,events=True,parity=True),'stableCheckpoint':{'height':969900,'hash':'c'*64},'privateLauncher':{'unit':self.n['UNIT'],'captureId':c['captureId'],'captureApiSha256':c['apiEnvironSHA256'],'scriptSha256':self.n['DRIVER_SHA'],'sourceIdentity':c['processes']['api']}}
 def test_cutover_final_fresh_success_only(self):
  n=self.n;r=self.cutover();n['validate_cutover'](self.binding(),r,self.now)
  for key,value in [('ok',False),('phase','rolled-back'),('commit','d'*40),('authorityServicesModified',True),('recoveryRemoved',True)]:
   q=copy.deepcopy(r);q[key]=value;self.assertRaisesRegex(ValueError,'CUTOVER_NOT_COMPLETE',n['validate_cutover'],self.binding(),q,self.now)
  for delta in (-1801,1):
   q=copy.deepcopy(r);q['at']=(self.now+datetime.timedelta(seconds=delta)).isoformat();self.assertRaisesRegex(ValueError,'CUTOVER_STALE',n['validate_cutover'],self.binding(),q,self.now)
 def test_cutover_path_and_sha_scope_refused(self):
  for path in ['/tmp/111-final.json',self.binding()['path'].replace('38ac6e2bff2a','d4d888757a1c'),self.binding()['path'].replace('111-final.json','completed.json')]:
   q=self.binding();q['path']=path;self.assertRaisesRegex(ValueError,'CUTOVER_BINDING',self.n['validate_cutover'],q,self.cutover(),self.now)
  q=self.binding();q['sha256']='not-a-sha';self.assertRaisesRegex(ValueError,'CUTOVER_BINDING',self.n['validate_cutover'],q,self.cutover(),self.now)
 def test_actual_dynamic_app_identities_fixed_three_authorities(self):
  n=self.n;rows={u:{'ActiveState':'active','SubState':'running','MainPID':pid,'InvocationID':inv}for u,(pid,inv)in n['AUTHORITIES'].items()}
  rows.update({u:{'ActiveState':'active','SubState':'running','MainPID':str(999000+i),'InvocationID':str(i+1)*32}for i,u in enumerate(n['APPS'].values())});n['state']=lambda u:rows[u]
  self.assertEqual(n['live'](),rows);rows['bitcoind.service']['InvocationID']='f'*32;self.assertRaisesRegex(ValueError,'ORIGINAL_AUTHORITIES_CHANGED',n['live'])
 def test_fresh_capture_both_processes_and_actual_environment(self):
  n=self.n;c=self.capture();ids={'api':{'pid':123},'worker':{'pid':124}}
  m={'format':'private-audit5-environments-v1','releaseId':c['captureId'],'capturedAt':self.now.isoformat(),'processes':{k:{'identityBefore':v,'identityAfter':v,'identityFinal':v,'environmentSha256':c['apiEnvironSHA256']}for k,v in ids.items()}}
  n['validate_capture'](m,c['captureId'],c['apiEnvironSHA256'],ids,self.now)
  q=copy.deepcopy(m);q['processes']['worker']['identityFinal']['pid']=125;self.assertRaisesRegex(ValueError,'CAPTURE_PROCESS_CHANGED',n['validate_capture'],q,c['captureId'],c['apiEnvironSHA256'],ids,self.now)
  q=copy.deepcopy(m);q['capturedAt']=(self.now-datetime.timedelta(seconds=121)).isoformat();self.assertRaisesRegex(ValueError,'CAPTURE_AGE',n['validate_capture'],q,c['captureId'],c['apiEnvironSHA256'],ids,self.now)
 def test_production_argv_source_candidate_and_installed_pins(self):
  n=self.n;c=self.capture();a=n['build_argv'](c)
  for flag,value in [('--mode','production'),('--source-commit',n['CANDIDATE']['commit']),('--source-api-sha256',n['API_SHA']),('--api-environ-sha256','b'*64),('--base-url','https://computer.proofofwork.me'),('--attempt','production-strict-v2')]:self.assertEqual(a[a.index(flag)+1],value)
  for value in ['--property=RuntimeMaxSec=20min','--property=KillMode=control-group','--property=MemoryMax=4G','--property=CPUQuota=100%',n['DRIVER_SHA'],n['PINS']['private-env.py']]:self.assertIn(value,a)
  self.assertNotIn('327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c',a);self.assertNotIn('http://127.0.0.1:18081',a)
 def test_accepted_three_gates_checkpoint_launcher_exact(self):
  n=self.n;c=self.capture();r=self.accepted(c);n['validate_acceptance'](r,c)
  for gate in ['ids','events','parity']:
   q=copy.deepcopy(r);q['gates'][gate]=False;self.assertRaisesRegex(ValueError,'STRICT_GATES',n['validate_acceptance'],q,c)
  q=copy.deepcopy(r);q['stableCheckpoint']['height']=True;self.assertRaisesRegex(ValueError,'STRICT_FENCE',n['validate_acceptance'],q,c)
  q=copy.deepcopy(r);q['privateLauncher']['sourceIdentity']={'pid':124};self.assertRaisesRegex(ValueError,'STRICT_LAUNCHER_BINDING',n['validate_acceptance'],q,c)
 def test_foreign_verifier_unit_not_stopped(self):
  n=self.n;calls=[];n['state']=lambda u:{'LoadState':'loaded','InvocationID':'b'*32};n['subprocess']=type('P',(),{'run':lambda *a,**k:calls.append(a)})();self.assertRaisesRegex(ValueError,'STRICT_OWNERSHIP_CHANGED',n['stop_owned'],'a'*32);self.assertEqual(calls,[])
 def test_v3_and_dynamic_cutover_lanes_must_be_quiet(self):
  n=self.n;self.assertIn('proofofwork-audit29-verify-'+n['RELEASE']+'-shadow-strict-v3.service',n['EXTRA_QUIET'])
  for row in [{'LoadState':'not-found','MainPID':'0'},{'LoadState':'loaded','ActiveState':'inactive','MainPID':'0'},{'LoadState':'loaded','ActiveState':'failed','MainPID':'0'}]:self.assertTrue(n['quiet'](row))
  for row in [{'LoadState':'not-found','MainPID':'1'},{'LoadState':'loaded','ActiveState':'active','MainPID':'0'},{'LoadState':'loaded','ActiveState':'failed','MainPID':'123'}]:self.assertFalse(n['quiet'](row))
  self.assertIn("'proofofwork-audit29-release-'+RELEASE+'-node-'+cutover_attempt+'.service'",SOURCE.read_text())
 def test_restoration_output_and_source_contracts_retained(self):
  s=SOURCE.read_text()
  for value in ['TIMER_RESTORED_EVIDENCE',"restored.get('restored')is True",'LIVE_OR_TIMER_CHANGED','POSTVERIFY_PROCESS_CHANGED','OUTPUT_CAP=65536',"PINS={'private-verify.py':'8a569828",'WHOLE=1320',"launcher.get('scriptSha256')==DRIVER_SHA",'automaticRetry=False']:self.assertIn(value,s)
  for value in ['rmtree(','unlink(','systemctl restart','repair-canonical','repair-atoms','CAPTURE_PIN=','SHADOW_PID=']:self.assertNotIn(value,s)
if __name__=='__main__':unittest.main()
