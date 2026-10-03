import ast,datetime,json,pathlib,types,unittest
p=pathlib.Path('/tmp/pow-audit30-followup-exact-shadow-metadata-v3.py');tree=ast.parse(p.read_bytes());code=next(n.value.value for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(k,ast.Name)and k.id=='CODE'for k in n.targets));t=ast.parse(code);t.body=[n for n in t.body if not isinstance(n,(ast.Import,ast.ImportFrom))]
U='audit.service';S='shadow.service';I='b'*32
known=[('bitcoind.service','1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),('electrs.service','1324320','72418b1c7ab245e4a37685ed868a1084'),('postgresql@16-main.service','1537429','e0bf545f0ad944e89fe1005577e61b9c'),('proofofwork-api.service','2103747','208f8bcbecc54afbb7166754f12065c2'),('proofofwork-indexer-worker.service','2103760','33b3ee25490749db89e0d55fd29d0afb')]
class Tests(unittest.TestCase):
 def actual(self,mutate=None,remaining=600,budget=450,elapsed=0):
  rows={u:dict(LoadState='loaded',ActiveState='active',MainPID=p,InvocationID=i)for u,p,i in known};rows[U]=dict(LoadState='not-found',ActiveState='inactive',MainPID='0',InvocationID='');rows[S]=dict(LoadState='loaded',ActiveState='active',MainPID='999',InvocationID=I,RuntimeMaxUSec='45min',ExecMainStartTimestampMonotonic=str(int((10000-2700+remaining)*1e6)));rows['proofofwork-postgres-logical-backup.service']=dict(LoadState='loaded',ActiveState='inactive',MainPID='0',Result='success')
  if mutate:mutate(rows)
  calls=[];output=[]
  def run(argv,**kw):
   self.assertEqual(argv[:2],['/usr/bin/systemctl','show']);self.assertIn(argv[2],rows);calls.append(argv);return types.SimpleNamespace(returncode=0,stderr=b'',stdout=('\n'.join(k+'='+v for k,v in rows[argv[2]].items())+'\n').encode())
  times=iter([10000,10000+elapsed])
  ns=dict(UNIT=U,SHADOW_UNIT=S,SHADOW_PID='999',SHADOW_INVOCATION=I,BUDGET=budget,MODE='positive'if budget==450 else'bond',datetime=datetime,json=json,subprocess=types.SimpleNamespace(run=run),time=types.SimpleNamespace(monotonic=lambda:next(times)),print=lambda x:output.append(json.loads(x)))
  exec(compile(t,'actual-followup-metadata','exec'),ns);self.assertEqual(len(calls),15);return output[0]
 def test_success_current_shadow_gc_audit(self):self.assertTrue(self.actual()['admitted'])
 def test_loaded_success_terminal(self):self.assertTrue(self.actual(lambda r:r[U].update(LoadState='loaded',InvocationID='a'*32))['admitted'])
 def test_live_invocation_changed(self):self.assertRaises(AssertionError,self.actual,lambda r:r[known[0][0]].update(InvocationID='a'*32))
 def test_shadow_reused_pid(self):self.assertRaises(AssertionError,self.actual,lambda r:r[S].update(InvocationID='c'*32))
 def test_audit_still_running(self):self.assertRaises(AssertionError,self.actual,lambda r:r[U].update(ActiveState='active',MainPID='123'))
 def test_backup_active_refuses(self):self.assertRaises(AssertionError,self.actual,lambda r:r['proofofwork-postgres-logical-backup.service'].update(ActiveState='active',MainPID='234'))
 def test_positive_insufficientcombinedlease_refuses(self):self.assertRaises(AssertionError,self.actual,remaining=479)
 def test_bond_insufficientlease_refuses(self):self.assertRaises(AssertionError,self.actual,remaining=359,budget=330)
 def test_elapsed_metadata_reads_refuse_expired_margin(self):self.assertRaises(AssertionError,self.actual,remaining=490,elapsed=11)
if __name__=='__main__':unittest.main()
