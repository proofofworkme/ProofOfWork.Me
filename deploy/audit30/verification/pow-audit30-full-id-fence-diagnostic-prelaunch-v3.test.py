import ast,contextlib,io,json,pathlib,subprocess,time,types,unittest,unittest.mock as M
p=pathlib.Path('/tmp/pow-audit30-full-id-fence-diagnostic-prelaunch-v3.py');t=ast.parse(p.read_text());CODE=next(ast.literal_eval(n.value)for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name)and x.id=='CODE'for x in n.targets))
UNITS=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service'];EXPECTED=[('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),('1324320','72418b1c7ab245e4a37685ed868a1084'),('1537429','e0bf545f0ad944e89fe1005577e61b9c'),('2103747','208f8bcbecc54afbb7166754f12065c2'),('2103760','33b3ee25490749db89e0d55fd29d0afb')]
class Tests(unittest.TestCase):
 def run_code(self,delta=None,now=1000):
  rows={u:dict(LoadState='loaded',ActiveState='active',MainPID=p,InvocationID=i)for u,(p,i)in zip(UNITS,EXPECTED)}
  rows['audit']=dict(LoadState='not-found',ActiveState='inactive',MainPID='0',InvocationID='')
  rows['shadow']=dict(LoadState='loaded',ActiveState='active',MainPID='2885445',InvocationID='8203629fb6ae40ed91dbc7de42c98df0',RuntimeMaxUSec='45min',ExecMainStartTimestampMonotonic='100000000')
  rows['proofofwork-postgres-logical-backup.service']=dict(LoadState='loaded',ActiveState='inactive',MainPID='0',InvocationID='9'*32,Result='success')
  if delta:
   key,field,value=delta;rows[key][field]=value
  calls=[]
  def run(a,**kw):
   calls.append(a);return types.SimpleNamespace(returncode=0,stderr=b'',stdout='\n'.join(k+'='+v for k,v in rows[a[2]].items()).encode())
  with M.patch.object(subprocess,'run',side_effect=run),M.patch.object(time,'monotonic',return_value=now),contextlib.redirect_stdout(io.StringIO())as output:
   exec(compile(CODE,'actual-native-prelaunch','exec'),dict(UNIT='audit',SHADOW_UNIT='shadow',SHADOW_INVOCATION='8203629fb6ae40ed91dbc7de42c98df0',SHADOW_PID='2885445'))
   return json.loads(output.getvalue()),calls
 def test_clear_metadata_and_lease_admitted(self):
  v,c=self.run_code();self.assertEqual(v['shadowLeaseRemainingSeconds'],1800);self.assertEqual(v['wholeOuterBudgetSeconds'],750);self.assertTrue(v['liveFiveUnchanged']);self.assertTrue(all(a[:2]==['/usr/bin/systemctl','show']for a in c));self.assertEqual(len(c),8)
 def test_changed_live_refused(self):self.assertRaises(AssertionError,self.run_code,(UNITS[3],'InvocationID','0'*32))
 def test_backup_active_refused(self):self.assertRaises(AssertionError,self.run_code,('proofofwork-postgres-logical-backup.service','ActiveState','active'))
 def test_shadow_invocation_replacement_refused(self):self.assertRaises(AssertionError,self.run_code,('shadow','InvocationID','0'*32))
 def test_existing_audit_unit_refused(self):self.assertRaises(AssertionError,self.run_code,('audit','LoadState','loaded'))
 def test_whole_outer_plus_margin_must_fit_lease(self):self.assertRaises(AssertionError,self.run_code,None,now=2021)
 def test_wrong_shadow_runtime_not_inferred(self):self.assertRaises(AssertionError,self.run_code,('shadow','RuntimeMaxUSec','1h'))
 def test_missing_future_or_zero_start_refused(self):
  for start in ['','0','1000000001']:
   self.assertRaises(AssertionError,self.run_code,('shadow','ExecMainStartTimestampMonotonic',start))
if __name__=='__main__':unittest.main()
