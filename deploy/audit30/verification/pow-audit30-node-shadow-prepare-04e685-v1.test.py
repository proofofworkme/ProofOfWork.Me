import ast,hashlib,pathlib,json,unittest
P=pathlib.Path('/tmp/pow-audit30-node-shadow-prepare-04e685-v1.py');S=P.read_text();T=ast.parse(S);R=next(n.value.value for n in T.body if isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id=='REMOTE'for k in n.targets));tree=ast.parse(R);F=ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in {'need','stop_owned'}],type_ignores=[])
class Tests(unittest.TestCase):
 def fixture(self,inv='a'*32,command=True,missing=False,stopped=True):
  calls=[];unit='fixed-shadow.service';tools=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools');states=[{'LoadState':'not-found'}if missing else {'LoadState':'loaded','InvocationID':inv,'ExecStart':str(tools/'private-env.py')if command else'foreign-source'}, {'MainPID':'0'if stopped else'7'}];ns=dict(UNIT=unit,TOOLS=tools,state=lambda u:states.pop(0),call=lambda a,t:calls.append((a,t)));exec(compile(F,'actual-starter-owned-cleanup','exec'),ns);return ns,calls
 def test_reverse_binding_exact(self):
  old=pathlib.Path('/tmp/pow-audit30-node-shadow-prepare-3399-v1.py').read_text();self.assertEqual(S.replace('04e685a4c7ea-20261003T025240Z','3399d767103e-20261003T020420Z').replace('8a09791eb21507b79c20714e466bccd6d171de90423bf409495f6d9bbbee8859','0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6'),old)
 def test_matches_actual_stage_tsv(self):
  r=json.loads(pathlib.Path('/tmp/pow-audit30-node-candidate-stage-04e685-native-v1.json').read_bytes())['result'];self.assertIn(r['candidateAttestationSha256'],R);self.assertIn('04e685a4c7ea-20261003T025240Z',R);self.assertEqual(r['cutover'],False)
 def test_owned_stop_only_exact_unit(self):
  ns,c=self.fixture();ns['stop_owned']('a'*32);self.assertEqual(c,[(['/usr/bin/systemctl','stop','fixed-shadow.service'],40)])
 def test_changed_invocation_not_stopped(self):
  ns,c=self.fixture(inv='b'*32);self.assertRaisesRegex(ValueError,'IDENTITY_DRIFT',ns['stop_owned'],'a'*32);self.assertEqual(c,[])
 def test_changed_command_not_stopped(self):
  ns,c=self.fixture(command=False);self.assertRaisesRegex(ValueError,'IDENTITY_DRIFT',ns['stop_owned'],'a'*32);self.assertEqual(c,[])
 def test_missing_unit_no_stop(self):
  ns,c=self.fixture(missing=True);ns['stop_owned']('a'*32);self.assertEqual(c,[])
 def test_stop_failure_refuses(self):
  ns,c=self.fixture(stopped=False);self.assertRaisesRegex(ValueError,'STOP_REFUSED',ns['stop_owned'],'a'*32);self.assertEqual(len(c),1)
 def test_lifetime_resource_live_guards_unchanged(self):
  for key in ['RuntimeMaxSec=45min','MemoryMax=4G','CPUQuota=100%','TasksMax=128','readonly-shadow','OPS_LOCK_AFTER_ACQUISITION','LIVE_IDENTITY_CHANGED']:self.assertIn(key,R)
  self.assertNotIn('unlink(',R);self.assertNotIn('rmtree(',R)
if __name__=='__main__':unittest.main()
