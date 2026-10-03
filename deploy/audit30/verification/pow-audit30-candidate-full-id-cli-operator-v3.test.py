import ast,hashlib,json,os,pathlib,runpy,subprocess,tempfile,types,unittest,unittest.mock as M
P=pathlib.Path('/tmp/pow-audit30-candidate-full-id-cli-operator-v3.py');D=runpy.run_path(str(P));SHA='d7bbe914e3db45fcebac174dc182146f988547fb8d94ffa65f8286cebd50a825'
class Operator(unittest.TestCase):
 def bootstrap(self,root,status=0,load='not-found',raw=None,fault=None):
  code=D['BOOTSTRAP'].replace("pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+RELEASE)",repr(root));code=code.replace(repr(root),'pathlib.Path('+repr(str(root))+')',1);calls=[];original=pathlib.Path.lstat;oldmask=os.umask(0o077)
  def lst(p):
   s=original(p)
   if p==root:return types.SimpleNamespace(st_mode=s.st_mode,st_uid=0,st_gid=0)
   return s
  processes=[]
  class Proc:
   def __init__(self,a,**kw):self.returncode=None;self.polls=0;processes.append(self);calls.append((a,kw))
   def poll(self):
    self.polls+=1
    if self.polls>= (10 if fault else 2):self.returncode=status
    return self.returncode
   def terminate(self):calls.append(('transport-terminate',{}));self.returncode=1
   def wait(self,**kw):return self.returncode
   def kill(self):self.returncode=-9
  shape_calls=0
  def command(a,**kw):
   nonlocal shape_calls
   calls.append((a,kw))
   if a[1]=='stop':return types.SimpleNamespace(returncode=1,stderr=b'',stdout=b'')
   if '--value'in a:return types.SimpleNamespace(returncode=0,stderr=b'',stdout=(load+'\n').encode())
   shape_calls+=1
   if fault and shape_calls==2:raise RuntimeError('supervisor failure after captured invocation')
   invocation=('2' if fault=='changed-invocation' and shape_calls>=3 else '1')*32
   pid='42'if processes and processes[0].returncode is None else'0';body='LoadState=loaded\nActiveState=active\nMainPID='+pid+'\nInvocationID='+invocation+'\nExecStart='+str(root/'cli-operator-d7bbe914-v3'/'runner.py')+'\nKillMode=control-group\nRuntimeMaxUSec=12min\n'
   return types.SimpleNamespace(returncode=0,stderr='',stdout=body)
  try:
   with M.patch.object(pathlib.Path,'lstat',lst),M.patch.object(os,'geteuid',return_value=0),M.patch.object(os,'getegid',return_value=0),M.patch.object(subprocess,'run',side_effect=command),M.patch.object(subprocess,'Popen',side_effect=Proc):
    exec(compile(code,'actual-fixed-bootstrap','exec'),{'RELEASE':D['RELEASE'],'RAW_CLI':D['RAW_CLI']if raw is None else raw,'EVAL_CLI':D['EVAL_CLI'],'RUNNER':D['RUNNER']})
  except BaseException as e:return e,calls
  finally:os.umask(oldmask)
 def test_import_binding_reverse_exact(self):
  ev=D['EVAL_CLI'];suffix='\nif (process.argv[1] !== undefined) throw new Error("Unexpected CLI operator argv.");\nawait runAudit({ argv: [] });\n';self.assertTrue(ev.endswith(suffix));ev=ev[:-len(suffix)];base='/opt/proofofwork-api-stage-'+D['RELEASE'];pairs=[('bitcoinjs-lib',base+'/node_modules/bitcoinjs-lib/src/cjs/index.cjs'),('@bitcoinerlab/secp256k1',base+'/node_modules/@bitcoinerlab/secp256k1/dist/index.js'),('../server/id-registry-audit-contract.mjs',base+'/server/id-registry-audit-contract.mjs')]
  for old,new in pairs:self.assertEqual(ev.count('"file://'+new+'"'),1);ev=ev.replace('"file://'+new+'"','"'+old+'"')
  self.assertEqual(ev,D['RAW_CLI']);self.assertEqual(hashlib.sha256(ev.encode()).hexdigest(),SHA)
 def test_creation_exact_bytes_metadata_and_fsync(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o700);error,calls=self.bootstrap(root);self.assertIsInstance(error,SystemExit);self.assertEqual(error.code,0);p=root/'cli-operator-d7bbe914-v3';self.assertEqual(p.stat().st_mode&0o777,0o700);self.assertEqual({x.name for x in p.iterdir()},{'runner.py','bound-eval.mjs','reviewed-cli.mjs','manifest.json'})
   for name,key in [('runner.py','RUNNER'),('bound-eval.mjs','EVAL_CLI'),('reviewed-cli.mjs','RAW_CLI')]:self.assertEqual((p/name).read_text(),D[key]);self.assertEqual((p/name).stat().st_mode&0o777,0o600);self.assertEqual((p/name).stat().st_nlink,1)
   manifest=json.loads((p/'manifest.json').read_bytes());native=next(c for c in calls if c[0][0].endswith('systemd-run'));a=native[0];self.assertEqual(a[-1],hashlib.sha256((p/'manifest.json').read_bytes()).hexdigest());self.assertEqual(manifest['sourceSHA256'],SHA);self.assertEqual(manifest['existingMaximumCoverageMs'],600000);self.assertEqual(manifest['runnerSHA256'],hashlib.sha256(D['RUNNER'].encode()).hexdigest());self.assertIn('--property=RuntimeMaxSec=12min',a);self.assertIn('--property=MemoryMax=2G',a);self.assertIn('--property=CPUQuota=50%',a);self.assertEqual(native[1]['env'],{'PATH':'/usr/bin:/bin','LC_ALL':'C'});self.assertEqual(len(a[-2]),len(str(p/'runner.py')))
 def test_existing_package_never_overwritten(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o700);p=root/'cli-operator-d7bbe914-v3';p.mkdir();(p/'evidence').write_bytes(b'preserve');e,c=self.bootstrap(root);self.assertIsInstance(e,AssertionError);self.assertEqual((p/'evidence').read_bytes(),b'preserve');self.assertEqual(len(c),1)
 def test_existing_unit_refuses_before_files(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o700);e,c=self.bootstrap(root,load='loaded');self.assertIsInstance(e,AssertionError);self.assertEqual(list(root.iterdir()),[])
 def test_bad_source_hash_refuses_before_package(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o700);e,c=self.bootstrap(root,raw=D['RAW_CLI']+' ');self.assertIsInstance(e,AssertionError);self.assertEqual(list(root.iterdir()),[])
 def test_unsafe_root_mode_refuses(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o755);e,c=self.bootstrap(root);self.assertIsInstance(e,AssertionError);self.assertEqual(c,[])
 def test_symlink_root_refuses(self):
  with tempfile.TemporaryDirectory()as td:
   actual=pathlib.Path(td)/'actual';actual.mkdir(mode=0o700);link=pathlib.Path(td)/'link';link.symlink_to(actual,target_is_directory=True);e,c=self.bootstrap(link);self.assertIsInstance(e,AssertionError);self.assertEqual(c,[])
 def test_native_failure_retains_package_and_returns_failure(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o700);e,c=self.bootstrap(root,status=1);self.assertIsInstance(e,SystemExit);self.assertEqual(e.code,1);self.assertEqual(len(list((root/'cli-operator-d7bbe914-v3').iterdir())),4)
 def test_stop_failure_preserves_failed_receipt_and_reaps_transport(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o700);e,c=self.bootstrap(root,fault='stop-failure');self.assertIsInstance(e,RuntimeError)
   self.assertEqual(sum(isinstance(a,list)and a[:2]==['/usr/bin/systemctl','stop']for a,k in c),1)
   self.assertIn(('transport-terminate',{}),c);r=json.loads((root/'cli-operator-d7bbe914-v3-failed.json').read_bytes());self.assertEqual(r['invocationID'],'1'*32);self.assertEqual(r['cleanupErrors'],['AssertionError']);self.assertEqual(r['errorClass'],'RuntimeError');self.assertEqual(len(list((root/'cli-operator-d7bbe914-v3').iterdir())),4)
 def test_changed_invocation_never_stopped_but_transport_reaped(self):
  with tempfile.TemporaryDirectory()as td:
   root=pathlib.Path(td);root.chmod(0o700);e,c=self.bootstrap(root,fault='changed-invocation');self.assertIsInstance(e,RuntimeError)
   self.assertFalse(any(isinstance(a,list)and a[:2]==['/usr/bin/systemctl','stop']for a,k in c));self.assertIn(('transport-terminate',{}),c)
   r=json.loads((root/'cli-operator-d7bbe914-v3-failed.json').read_bytes());self.assertEqual(r['invocationID'],'1'*32);self.assertEqual(r['cleanupErrors'],['AssertionError']);self.assertEqual(r['productionMutation'],False)
 def test_stdout_complete_and_partial_count_refusal(self):
  for valid in [True,False]:
   with tempfile.TemporaryDirectory()as td:
    p=pathlib.Path(td)/'result.json';text='Canonical lifecycle parity: verified against exact Core-ordered chain replay\n'+''.join(x+': 1\n'for x in ['Fetched transactions','Covered confirmed registry transactions','Covered pending registry transactions','Confirmed winners','Pending candidates'][:5 if valid else 4]);calls=[]
    def fake(a,**kw):calls.append((a,kw));return types.SimpleNamespace(returncode=0,stdout=text.encode(),stderr=b'')
    with M.patch.object(subprocess,'run',side_effect=fake):self.assertEqual(D['main'](p),0)
    value=json.loads(p.read_bytes());self.assertEqual(value['complete'],valid);self.assertIn('input',calls[0][1]);self.assertEqual(calls[0][1]['timeout'],750);self.assertLess(len(calls[0][0][-1]),1024);self.assertGreater(len(calls[0][1]['input']),131072);self.assertLess(len(D['EVAL_CLI'].encode()),131072)
 def test_semantic_source_and_role_guards_present(self):
  r=D['RUNNER'];ast.parse(r);self.assertIn("manifest['processes']['api']['identityFinal']==original['proc_identity']",r);self.assertIn("V['readonly_plan']",r);self.assertIn("os.setgroups([]);os.setgid(account.pw_gid);os.setuid(account.pw_uid)",r);self.assertIn("POW_ID_AUDIT_RETRIES']==b'0'",r);self.assertIn('0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6',r);self.assertIn("V['read'](pathlib.Path(__file__),0",r);self.assertIn("V['read'](package/'manifest.json',0",r)
if __name__=='__main__':unittest.main()
