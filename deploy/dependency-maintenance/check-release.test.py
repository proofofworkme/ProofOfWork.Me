#!/usr/bin/env python3
"""Independent safe local release-wrapper regression tests; no remote access."""
import base64,copy,datetime,hashlib,importlib.util,io,json,os,subprocess,sys,tarfile,tempfile,time,types,unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m
D=load('tested_dependency_release',HERE/'release.py')
C=load('tested_dependency_controller',HERE/'controller.py')
PINS={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ['release.py','controller.py']}

def archive_bytes(members):
 out=io.BytesIO()
 with tarfile.open(fileobj=out,mode='w:gz') as t:
  for name,data,kind,mode in members:
   info=tarfile.TarInfo(name);info.mode=mode;info.mtime=123;info.type=kind
   if kind in (tarfile.SYMTYPE,tarfile.LNKTYPE):info.linkname='../../outside'
   if kind==tarfile.REGTYPE:info.size=len(data);t.addfile(info,io.BytesIO(data))
   else:t.addfile(info)
 return out.getvalue()

def integrity(raw):return 'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='cef-release-test-',dir='/tmp');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.dispatch=patch.object(D,'dispatch',side_effect=AssertionError('Unexpected dispatch'));self.spy=self.dispatch.start();self.addCleanup(self.dispatch.stop)
 def tar(self,members):
  p=self.root/'package.tgz';raw=archive_bytes(members);p.write_bytes(raw);return p,{'integrity':integrity(raw)}
 def app(self,**changes):
  g,h=D.supports();p={'executable':True,'controllerSha256':D.sha((HERE/'controller.py').read_bytes()),'driverSha256':D.sha((HERE/'release.py').read_bytes()),'guardsSha256':D.sha(g.read_bytes()),'holderSha256':D.sha(h.read_bytes())};p.update(changes)
  path=self.root/'plan.json';wire=D.encode(p);path.write_bytes(wire)
  return types.SimpleNamespace(plan=path,plan_sha256=D.sha(wire),receipt=self.root/'receipt.json')
 def fixture(self,draft=False):
  repo=self.root/'repo';repo.mkdir();archives=self.root/'archives';archives.mkdir();pkgs={};trees={}
  old={'name':'synthetic-fixture','packages':{'':{'name':'synthetic-fixture'},'node_modules/unrelated':{'version':'9.9.9'}}}
  for n in D.NAMES:
   version=C.VERSIONS[n];raw=archive_bytes([('package/package.json',D.encode({'name':n,'version':version}),tarfile.REGTYPE,0o644),('package/index.js',b'fixture only\n',tarfile.REGTYPE,0o644)])
   (archives/(n+'-'+version+'.tgz')).write_bytes(raw);pkgs['node_modules/'+n]={'version':version,'integrity':integrity(raw)};old['packages']['node_modules/'+n]={'version':'0.0.1','integrity':'old'}
   trees[n],_=D.tree_from_tar(archives/(n+'-'+version+'.tgz'),pkgs['node_modules/'+n])
  lock={'packages':{'':{'name':'fixture'},**pkgs}};lockraw=D.encode(lock);(repo/'package-lock.json').write_bytes(lockraw)
  oldraw=D.encode(old);snapshot={'format':'pow-cef-node-dependency-capture-v1','root':str(C.ROOT),'locks':{'package-lock.json':{'base64':base64.b64encode(oldraw).decode(),'sha256':D.sha(oldraw)}},'packages':{n:{'.':{'kind':'directory','mode':0o750,'uid':1000,'gid':1000,'mtimeNs':0,'nlink':2}} for n in D.NAMES}}
  capture=self.root/'capture.json';capture.write_bytes(D.encode(snapshot));commit='1'*40
  args=types.SimpleNamespace(repository=repo,capture=capture,archives=archives,output=self.root/'built-plan.json',commit=commit,draft=draft)
  def git(argv,*a,**kw):
   tail=argv[3:]
   if tail==['rev-parse','HEAD']:return (commit+'\n').encode()
   if tail==['status','--porcelain','--untracked-files=all']:return b''
   if tail==['show',commit+':package-lock.json']:return lockraw
   for name in ['controller.py','release.py']:
    if tail==['show',commit+':deploy/dependency-maintenance/'+name]:return (HERE/name).read_bytes()
   raise AssertionError('Unexpected git command '+repr(argv))
  return args,git,trees,snapshot
 def test_tar_valid_normalizes_without_extraction(self):
  p,lock=self.tar([('package/lib',b'',tarfile.DIRTYPE,0o755),('package/lib/index.js',b'exact content',tarfile.REGTYPE,0o644)])
  rows,proof=D.tree_from_tar(p,lock);self.assertEqual(base64.b64decode(rows['lib/index.js']['base64']),b'exact content');self.assertEqual(proof['sha256'],D.sha(p.read_bytes()));self.assertFalse((self.root/'lib').exists())
 def test_tar_integrity_mismatch(self):
  p,lock=self.tar([('package/a',b'a',tarfile.REGTYPE,0o644)]);lock['integrity']='sha512-'+base64.b64encode(b'wrong').decode()
  with self.assertRaisesRegex(ValueError,'integrity differs'):D.tree_from_tar(p,lock)
 def test_tar_duplicate_member(self):
  p,lock=self.tar([('package/a',b'a',tarfile.REGTYPE,0o644),('package/a',b'b',tarfile.REGTYPE,0o644)])
  with self.assertRaisesRegex(ValueError,'Duplicate'):D.tree_from_tar(p,lock)
 def test_tar_oversized_member(self):
  p,lock=self.tar([('package/a',b'0'*(8*1024**2),tarfile.REGTYPE,0o644)])
  with self.assertRaisesRegex(ValueError,'Oversized'):D.tree_from_tar(p,lock)
 def test_tar_parse_uses_verified_bytes_despite_path_replacement(self):
  p,lock=self.tar([('package/a',b'verified',tarfile.REGTYPE,0o644)]);verified=p.read_bytes();replacement=archive_bytes([('package/a',b'unverified replacement',tarfile.REGTYPE,0o644)])
  class SwapPath:
   def read_bytes(_):p.write_bytes(replacement);return verified
   def __str__(_):return str(p)
   def __fspath__(_):return str(p)
  rows,proof=D.tree_from_tar(SwapPath(),lock)
  self.assertEqual(base64.b64decode(rows['a']['base64']),b'verified');self.assertEqual(proof['sha256'],D.sha(verified));self.assertNotEqual(proof['sha256'],D.sha(p.read_bytes()))
 def test_apply_wrong_plan_hash_before_dispatch(self):
  args=self.app();args.plan_sha256='0'*64
  with self.assertRaisesRegex(ValueError,'Reviewed plan hash differs'):D.apply(args)
  self.spy.assert_not_called();self.assertFalse(args.receipt.exists())
 def test_apply_invalid_plan_json_before_dispatch(self):
  args=self.app();args.plan.write_bytes(b'{');args.plan_sha256=D.sha(b'{')
  with self.assertRaises(json.JSONDecodeError):D.apply(args)
  self.spy.assert_not_called()
 def test_apply_draft_before_dispatch(self):
  args=self.app(executable=False)
  with self.assertRaisesRegex(ValueError,'Draft is not executable'):D.apply(args)
  self.spy.assert_not_called()
 def test_apply_numeric_executable_before_dispatch(self):
  args=self.app(executable=1)
  with self.assertRaisesRegex(ValueError,'Draft is not executable'):D.apply(args)
  self.spy.assert_not_called()
 def test_apply_success_receipt_exact_and_single_dispatch(self):
  args=self.app();self.spy.side_effect=None;self.spy.return_value=subprocess.CompletedProcess([],0,b'controller fixture response',b'')
  with redirect_stdout(io.StringIO()):D.apply(args)
  self.spy.assert_called_once();r=json.loads(args.receipt.read_bytes());self.assertEqual(r['planSha256'],args.plan_sha256);self.assertEqual(r['stdout'],'controller fixture response');self.assertFalse(r['uncertain'])
 def test_apply_remote_refusal_preserves_receipt(self):
  args=self.app();self.spy.side_effect=None;self.spy.return_value=subprocess.CompletedProcess([],2,b'before',b'refused')
  with self.assertRaisesRegex(ValueError,'Apply incomplete'):D.apply(args)
  self.spy.assert_called_once();r=json.loads(args.receipt.read_bytes());self.assertEqual(r['exitCode'],2);self.assertEqual(r['stderr'],'refused')
 def test_apply_timeout_preserves_uncertain_no_retry(self):
  args=self.app();self.spy.side_effect=subprocess.TimeoutExpired('synthetic fixture',1,output=b'partial',stderr=b'unknown')
  with self.assertRaisesRegex(ValueError,'Apply incomplete'):D.apply(args)
  self.spy.assert_called_once();r=json.loads(args.receipt.read_bytes());self.assertTrue(r['uncertain']);self.assertIn('Do not retry',r['instruction']);self.assertEqual(r['stdout'],'partial')
 def test_capture_existing_stderr_before_dispatch(self):
  output=self.root/'capture.json';output.with_suffix('.stderr').write_text('prior evidence')
  with self.assertRaisesRegex(ValueError,'new canonical path'):D.capture(types.SimpleNamespace(output=output))
  self.spy.assert_not_called();self.assertEqual(output.with_suffix('.stderr').read_text(),'prior evidence')
 def test_capture_remote_refusal_preserves_stderr(self):
  output=self.root/'capture.json';self.spy.side_effect=None;self.spy.return_value=subprocess.CompletedProcess([],1,b'',b'refused fixture')
  with self.assertRaisesRegex(ValueError,'Capture refused'):D.capture(types.SimpleNamespace(output=output))
  self.spy.assert_called_once();self.assertEqual(output.with_suffix('.stderr').read_bytes(),b'refused fixture');self.assertFalse(output.exists())
 def test_plan_draft_local_only_exact_lock_scope(self):
  args,git,trees,before=self.fixture(draft=True)
  with patch.object(D.subprocess,'check_output',side_effect=AssertionError('Draft must not invoke git')),redirect_stdout(io.StringIO()):D.plan(args)
  value=json.loads(args.output.read_bytes());self.assertFalse(value['executable']);self.assertEqual(value['candidatePackages'],trees)
  new=json.loads(base64.b64decode(value['candidateLocks']['package-lock.json']['base64']));old=json.loads(base64.b64decode(before['locks']['package-lock.json']['base64']))
  for n in D.NAMES:old['packages']['node_modules/'+n]=new['packages']['node_modules/'+n]
  self.assertEqual(new,old);self.spy.assert_not_called()
 def test_plan_committed_positive_pins_all_sources(self):
  args,git,_,_=self.fixture()
  with patch.object(D.subprocess,'check_output',side_effect=git),redirect_stdout(io.StringIO()):D.plan(args)
  value=json.loads(args.output.read_bytes());self.assertTrue(value['executable']);self.assertEqual(value['driverSha256'],PINS['release.py']);self.assertEqual(value['controllerSha256'],PINS['controller.py']);self.spy.assert_not_called()
 def test_plan_missing_exact_commit(self):
  args,git,_,_=self.fixture();args.commit=None
  with patch.object(D.subprocess,'check_output',side_effect=AssertionError('No git expected')),self.assertRaisesRegex(ValueError,'Exact commit required'):D.plan(args)
  self.assertFalse(args.output.exists());self.spy.assert_not_called()
 def test_dispatch_serialization_and_isolation_mocked(self):
  self.dispatch.stop();self.addCleanup(self.dispatch.start)
  payload={'action':'capture','fixture':True}
  with patch.object(D.subprocess,'run',return_value=subprocess.CompletedProcess([],0,b'',b'')) as run:D.dispatch(payload,37)
  argv=run.call_args.args[0];self.assertEqual(argv[:len(D.SSH)],D.SSH)
  self.assertIn('/usr/bin/python3 -I -B -c',argv[-1]);self.assertEqual(run.call_args.kwargs['input'],D.encode(payload));self.assertEqual(run.call_args.kwargs['timeout'],37)
 def test_controller_source_drift_refuses_before_other_reads(self):
  m={'capture':{'sources':{'x':'old'}}}
  with patch.object(C,'source_pins',return_value={'x':'changed'}),patch.object(C,'protected_modules',side_effect=AssertionError('Must refuse earlier')),self.assertRaisesRegex(ValueError,'Accepted source or metadata changed'):C.fence(m,{}, {})
 def test_cli_wrong_hash_draft_toolpin_never_invokes_ssh(self):
  binpath=self.root/'bin';binpath.mkdir();sentinel=self.root/'ssh-called';fake=binpath/'ssh';fake.write_text('#!/bin/sh\nprintf bad > '+str(sentinel)+'\nexit 97\n');fake.chmod(0o700)
  env=dict(os.environ,PATH=str(binpath)+os.pathsep+os.environ['PATH'])
  for variant in ['hash','draft','pin']:
   args=self.app(**({'executable':False} if variant=='draft' else {'controllerSha256':'0'*64} if variant=='pin' else {}))
   h='0'*64 if variant=='hash' else args.plan_sha256
   r=subprocess.run([sys.executable,'-I','-B',str(HERE/'release.py'),'apply',str(args.plan),h,str(args.receipt)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
   self.assertNotEqual(r.returncode,0);self.assertFalse(sentinel.exists());self.assertFalse(args.receipt.exists())

# Each parameter is a separately counted test.
for i,name in enumerate(['../outside','/package/outside','package/../outside','package//outside','package/./outside','other/outside','package']):
 def test(self,name=name):
  p,lock=self.tar([(name,b'x',tarfile.REGTYPE,0o644)])
  with self.assertRaisesRegex(ValueError,'Unsafe tar member'):D.tree_from_tar(p,lock)
 setattr(Tests,'test_tar_unsafe_path_'+str(i),test)
for kind,label in [(tarfile.SYMTYPE,'symlink'),(tarfile.LNKTYPE,'hardlink'),(tarfile.FIFOTYPE,'fifo'),(tarfile.CHRTYPE,'device')]:
 def test(self,kind=kind):
  p,lock=self.tar([('package/link',b'',kind,0o755)])
  with self.assertRaisesRegex(ValueError,'Unsupported archive member'):D.tree_from_tar(p,lock)
 setattr(Tests,'test_tar_rejects_'+label,test)
for mode in [0o600,0o777]:
 def test(self,mode=mode):
  p,lock=self.tar([('package/a',b'x',tarfile.REGTYPE,mode)])
  with self.assertRaisesRegex(ValueError,'Unsupported archive mode'):D.tree_from_tar(p,lock)
 setattr(Tests,'test_tar_mode_'+oct(mode),test)
for pinname in ['controllerSha256','driverSha256','guardsSha256','holderSha256']:
 def test(self,pinname=pinname):
  args=self.app(**{pinname:'0'*64})
  with self.assertRaisesRegex(ValueError,'Tool pin differs'):D.apply(args)
  self.spy.assert_not_called()
 setattr(Tests,'test_apply_wrong_'+pinname,test)
for kind in ['relative','missing_parent','symlink_parent','dangling_symlink','existing_file']:
 for operation in ['apply','capture']:
  def test(self,kind=kind,operation=operation):
   if kind=='relative':out=Path('relative-fixture-receipt.json')
   elif kind=='missing_parent':out=self.root/'missing'/'result.json'
   elif kind=='symlink_parent':real=self.root/'real';real.mkdir();alias=self.root/'alias';alias.symlink_to(real,target_is_directory=True);out=alias/'result.json'
   elif kind=='dangling_symlink':out=self.root/'result.json';out.symlink_to(self.root/'absent')
   else:out=self.root/'result.json';out.write_text('keep prior evidence')
   with self.assertRaisesRegex(ValueError,'new canonical path'):
    if operation=='apply':args=self.app();args.receipt=out;D.apply(args)
    else:D.capture(types.SimpleNamespace(output=out))
   self.spy.assert_not_called()
  setattr(Tests,'test_'+operation+'_invalid_output_'+kind,test)
for kind in ['head','dirty','lock','controller.py','release.py']:
 def test(self,kind=kind):
  args,git,_,_=self.fixture()
  def changed(argv,*a,**kw):
   tail=argv[3:]
   if kind=='head' and tail==['rev-parse','HEAD']:return b'2'*40+b'\n'
   if kind=='dirty' and tail[:1]==['status']:return b' M changed\n'
   if kind=='lock' and tail==['show',args.commit+':package-lock.json']:return b'{}\n'
   if kind in ['controller.py','release.py'] and tail==['show',args.commit+':deploy/dependency-maintenance/'+kind]:return b'changed source\n'
   return git(argv,*a,**kw)
  with patch.object(D.subprocess,'check_output',side_effect=changed),self.assertRaisesRegex(ValueError,'Clean committed candidate required|Committed lock differs|Controller not committed'):D.plan(args)
  self.assertFalse(args.output.exists());self.spy.assert_not_called()
 setattr(Tests,'test_plan_committed_guard_'+kind.replace('.','_'),test)
for delta,label in [(-181,'stale'),(60,'future')]:
 def test(self,delta=delta):
  args,git,trees,before=self.fixture(draft=True)
  with redirect_stdout(io.StringIO()):D.plan(args)
  m=json.loads(args.output.read_bytes());m['executable']=True;m['capture']['at']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=delta)).isoformat()
  runtime=self.root/'runtime';runtime.mkdir();mods=runtime/'node_modules';mods.mkdir();backups=self.root/'backups';backups.mkdir()
  with patch.object(C,'ROOT',runtime),patch.object(C,'MOD',mods),patch.object(C.os,'geteuid',return_value=0),patch.object(C.sys,'flags',types.SimpleNamespace(isolated=True)),patch.object(C,'acquire_locks',side_effect=AssertionError('Must refuse before locks')) as locks:
   m['capture']['root']=str(runtime)
   with self.assertRaisesRegex(ValueError,'fresh180second window'):C.apply(m,{'BACKUPS':backups},{})
   locks.assert_not_called()
  self.assertEqual(list(mods.iterdir()),[]);self.assertEqual(list(backups.iterdir()),[])
 setattr(Tests,'test_controller_'+label+'_capture_refusal',test)

class Recorded(unittest.TextTestResult):
 def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.records=[]
 def addSuccess(self,test):super().addSuccess(test);self.records.append({'test':test.id(),'passed':True})
 def addFailure(self,test,err):super().addFailure(test,err);self.records.append({'test':test.id(),'passed':False,'failure':self._exc_info_to_string(err,test)})
 def addError(self,test,err):super().addError(test,err);self.records.append({'test':test.id(),'passed':False,'error':self._exc_info_to_string(err,test)})
if __name__=='__main__':
 started=time.monotonic();result=unittest.TextTestRunner(verbosity=2,resultclass=Recorded).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
 unchanged=all(hashlib.sha256((HERE/n).read_bytes()).hexdigest()==h for n,h in PINS.items())
 report={'format':'pow-cef-release-independent-local-tests-v1','atUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sourcePins':PINS,'sourceUnchangedDuringTests':unchanged,'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'productionContacted':False,'networkUsed':False,'remoteMutationExecuted':False,'seconds':round(time.monotonic()-started,3),'method':'Actual driver/archive/plan/apply/CLI functions using synthetic tarballs and temporary files. Dispatch and git commands mocked except no-network CLI refusal tests guarded by a fake SSH sentinel. Two controller stale-capture tests use temporary runtime directories and fail before locks or writes.','regressions':['Parse only the integrity-verified tarball bytes even if the archive path is replaced between reads.','Reject relative, missing-parent, symlink-parent, dangling-symlink and existing output paths before capture/apply dispatch.'],'results':result.records}
 report_path=os.environ.get('POW_DEPENDENCY_TEST_REPORT')
 if report_path:Path(report_path).write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k!='results'},indent=2))
 sys.exit(0 if result.wasSuccessful() and unchanged else 1)
