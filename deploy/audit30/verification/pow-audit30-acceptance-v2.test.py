import ast,datetime,hashlib,json,pathlib,re,time,unittest
LEASE=pathlib.Path('/tmp/pow-audit30-acceptance-shadow-lease-v3.py')
STRICT=pathlib.Path('/tmp/pow-audit30-acceptance-strict-v2.py')
def functions(p,names,values):
 tree=ast.parse(p.read_bytes()); out=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in names],type_ignores=[]);exec(compile(out,str(p),'exec'),values);return values
class Tests(unittest.TestCase):
 def strict(self):
  n=dict(json=json,re=re,datetime=datetime,time=time,pathlib=pathlib,UNIT='proofofwork-audit29-verify-38ac6e2bff2a-20261003T042000Z-shadow-strict-v2.service',SHADOW='proofofwork-audit29-shadow-38ac6e2bff2a-20261003T042000Z-lease-v3.service',RELEASE='38ac6e2bff2a-20261003T042000Z',TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools'),PINS={'private-env.py':'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515','attest-node.py':'4bec20fa1e5931636e3bfc84f617f005a7b1b71e752dc7f7c9b8bea23014be38','install-ops.py':'f8dcc8489537a3ddefa392cb586857fdab88874e6b3c7a2f61a69ec45b0b7c25'})
  return functions(STRICT,{'need','bind_shadow','shadow_fit','build_argv','owned','stop_owned'},n)
 def receipt(self,n):return {'schema':'pow-audit30-node-readonly-shadow-prepared-v1','ok':True,'unit':n['SHADOW'],'mainPID':123,'invocationID':'a'*32,'liveServicesUnchanged':True,'productionDataMutation':False,'productionStop':False,'timerChanges':False}
 def test_fresh_shadow_binding_and_changed_unit_rejection(self):
  n=self.strict();r=self.receipt(n);self.assertEqual(n['bind_shadow'](json.dumps(r)),('123','a'*32));r['unit']=r['unit'].replace('lease-v3','lease-v2');self.assertRaisesRegex(ValueError,'FRESH_SHADOW',n['bind_shadow'],json.dumps(r))
 def test_shadow_mutation_flag_rejected(self):
  n=self.strict();r=self.receipt(n);r['productionDataMutation']=True;self.assertRaisesRegex(ValueError,'FRESH_SHADOW',n['bind_shadow'],json.dumps(r))
 def test_shadow_lease_ownership_and_remaining_budget(self):
  n=self.strict();n.update(SHADOW_PID='123',SHADOW_INV='a'*32);s={'ActiveState':'active','MainPID':'123','InvocationID':'a'*32,'RuntimeMaxUSec':'45min','ExecMainStartTimestampMonotonic':str(int((time.monotonic()-1)*1000000))};n['state']=lambda u:s
  n['shadow_fit'](1350);s['InvocationID']='b'*32;self.assertRaisesRegex(ValueError,'SHADOW_CHANGED',n['shadow_fit'],1350);s['InvocationID']='a'*32;s['ExecMainStartTimestampMonotonic']=str(int((time.monotonic()-2690)*1000000));self.assertRaisesRegex(ValueError,'LEASE_TOO_SHORT',n['shadow_fit'],1350)
 def test_managed_strict_argv_preserves_installed_command(self):
  n=self.strict();a=n['build_argv']({'captureId':'38ac6e2bff2a-20261003T190000Z','apiEnvironSHA256':'327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c'})
  for value in ['--property=RuntimeMaxSec=20min','--property=KillMode=control-group','--property=MemoryMax=4G','--property=CPUQuota=100%','--mode','shadow','--candidate-commit','38ac6e2bff2ac16890724e5213346ef8a3ebd186','--attempt','strict-v2','http://127.0.0.1:18081']:self.assertIn(value,a)
  self.assertNotIn('strict-v1',a);self.assertIn('--unit='+n['UNIT'],a)
 def test_foreign_strict_invocation_not_stopped(self):
  n=self.strict();calls=[];n['state']=lambda u:{'LoadState':'loaded','InvocationID':'b'*32};n['subprocess']=type('P',(),{'run':lambda *a,**k:calls.append(a)})();self.assertRaisesRegex(ValueError,'OWNERSHIP_CHANGED',n['stop_owned'],'a'*32);self.assertEqual(calls,[])
 def test_fresh_evidence_and_no_direct_repair_or_cutover_commands(self):
  s=STRICT.read_text();l=LEASE.read_text()
  for prefix in ['strict-native-v2-','shadow-strict-v2','shadow-lease-v3-prepared.json']:self.assertIn(prefix,s)
  for prefix in ['shadow-lease-v3-preparation-intent.json','shadow-lease-v3-prepared.json','PREVIOUS_LEASE_NOT_STOPPED','readonly-shadow','REUSE_SOURCE_PIN']:self.assertIn(prefix,l)
  for text in ['systemctl restart','systemctl start proofofwork-api','repair-canonical','repair-atoms','unlink(','rmtree(']:self.assertNotIn(text,s+l)
 def test_original_strict_fences_and_restoration_unchanged(self):
  s=STRICT.read_text()
  for text in ["CAPTURE_PIN='62e8c972a492fd22ebfb90a64396bec1a38466279aadbeb9439dbbb879d1ef68'","PINS={'private-verify.py':'8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e'","for k in ['ids','events','parity']",'TIMER_NOT_RESTORED','TIMER_RESTORED_EVIDENCE','STRICT_FENCE','LAUNCHER_NOT_ACCEPTED','LIVE_OR_TIMER_CHANGED','signal.SIG_IGN']:self.assertIn(text,s)
 def test_shadow_stop_foreign_invocation_is_refused(self):
  n=dict(pathlib=pathlib,UNIT='fixture-lease-v3.service',TOOLS=pathlib.Path('/var/tmp/tools'));functions(LEASE,{'need','stop_owned'},n);calls=[];n['state']=lambda u:{'LoadState':'loaded','InvocationID':'b'*32,'ExecStart':'/var/tmp/tools/private-env.py'};n['call']=lambda a,t:calls.append((a,t));self.assertRaisesRegex(ValueError,'IDENTITY_DRIFT',n['stop_owned'],'a'*32);self.assertEqual(calls,[])
if __name__=='__main__':unittest.main()
