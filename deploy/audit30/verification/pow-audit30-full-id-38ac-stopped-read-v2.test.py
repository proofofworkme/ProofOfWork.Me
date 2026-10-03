import ast,datetime,json,pathlib,types,unittest
p=pathlib.Path('/tmp/pow-audit30-full-id-38ac-stopped-read-v2.py');tree=ast.parse(p.read_bytes());code=next(n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id=='CODE'for k in n.targets));t=ast.parse(code);t.body=[n for n in t.body if not isinstance(n,(ast.Import,ast.ImportFrom))]
UNIT='proofofwork-audit30-candidate-full-ids-38ac6e2bff2a-20261003T042000Z-v1.service'
known=[('bitcoind.service','1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),('electrs.service','1324320','72418b1c7ab245e4a37685ed868a1084'),('postgresql@16-main.service','1537429','e0bf545f0ad944e89fe1005577e61b9c'),('proofofwork-api.service','2103747','208f8bcbecc54afbb7166754f12065c2'),('proofofwork-indexer-worker.service','2103760','33b3ee25490749db89e0d55fd29d0afb')]
class Tests(unittest.TestCase):
 def run_actual(self,audit,changed=False):
  rows={u:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID=p,InvocationID=i,Result='success')for u,p,i in known};rows[UNIT]=audit
  if changed:rows[known[0][0]]['InvocationID']='f'*32
  calls=[];outputs=[]
  def run(argv,**kw):
   self.assertEqual(argv[:2],['/usr/bin/systemctl','show']);self.assertIn(argv[2],rows);calls.append(argv);return types.SimpleNamespace(returncode=0,stderr=b'',stdout=('\n'.join(k+'='+v for k,v in rows[argv[2]].items())+'\n').encode())
  ns=dict(UNIT=UNIT,datetime=datetime,json=json,subprocess=types.SimpleNamespace(run=run),print=lambda s:outputs.append(json.loads(s)));exec(compile(t,'actual-fixed-terminal-observation','exec'),ns);self.assertEqual(len(calls),6);return outputs[0]
 def test_collected_gc_terminal_is_stopped_not_semanticpass(self):
  r=self.run_actual(dict(LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID=''));self.assertTrue(r['actualAuditStopped']);self.assertNotIn('complete',r)
 def test_loaded_failed_stopped_keepsfailure(self):
  r=self.run_actual(dict(LoadState='loaded',ActiveState='failed',SubState='failed',MainPID='0',InvocationID='a'*32,Result='exit-code'));self.assertEqual(r['audit']['Result'],'exit-code');self.assertTrue(r['actualAuditStopped'])
 def test_stillrunning_refuses(self):self.assertRaises(AssertionError,self.run_actual,dict(LoadState='loaded',ActiveState='active',MainPID='123',InvocationID='a'*32))
 def test_malformed_retained_invocation_refuses(self):self.assertRaises(AssertionError,self.run_actual,dict(LoadState='loaded',ActiveState='failed',MainPID='0',InvocationID=''))
 def test_changed_live_invocation_refuses(self):self.assertRaises(AssertionError,self.run_actual,dict(LoadState='not-found',ActiveState='inactive',MainPID='0',InvocationID=''),True)
if __name__=='__main__':unittest.main()
