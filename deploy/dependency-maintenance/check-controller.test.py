#!/usr/bin/env python3
import base64,contextlib,copy,datetime,hashlib,importlib.util,io,json,os,stat,tempfile,types,unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('controller',Path(__file__).with_name('controller.py'));C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
class PromotionTests(unittest.TestCase):
 def fixture(self):
  owner={'uid':os.getuid(),'gid':os.getgid()};td=tempfile.TemporaryDirectory();root=Path(td.name)/'runtime';root.mkdir(mode=0o750);mod=root/'node_modules';mod.mkdir(mode=0o750);backup=Path(td.name)/'backups';backup.mkdir(mode=0o750);holds=Path(td.name)/'holds';holds.mkdir();lock=Path(td.name)/'ops.lock';lock.write_bytes(b'');searchlock=Path(td.name)/'search.lock';searchlock.write_bytes(b'');hold=Path(td.name)/'search.hold'
  before={};candidate={}
  for n in C.NAMES:
   p=mod/n;p.mkdir(mode=0o750);(p/'package.json').write_text(json.dumps({'name':n,'version':'1.0.0'}));os.chmod(p/'package.json',0o640);before[n]=C.inventory(p,True)
   data=json.dumps({'name':n,'version':C.VERSIONS[n]}).encode();candidate[n]={'.':{'kind':'directory','mode':0o755,**owner,'mtimeNs':0,'nlink':2},'package.json':{'kind':'file','mode':0o644,**owner,'mtimeNs':0,'nlink':1,'bytes':len(data),'sha256':C.sha(data),'base64':base64.b64encode(data).decode()}}
  old={'lockfileVersion':3,'packages':{'':{'name':'preserved-runtime'},**{'node_modules/'+n:{'version':'1.0.0'} for n in C.NAMES},'node_modules/preserved-font':{'version':'5.3.0'}}};new=copy.deepcopy(old)
  for n in C.NAMES:new['packages']['node_modules/'+n]['version']=C.VERSIONS[n]
  locks={};nextlocks={}
  for rel in C.LOCKS:
   p=root/rel;p.write_bytes(C.encoded(old));os.chmod(p,0o640);b=p.read_bytes();locks[rel]={'base64':base64.b64encode(b).decode(),'sha256':C.sha(b),'metadata':C.inventory_file(p)};n=C.encoded(new);nextlocks[rel]={'base64':base64.b64encode(n).decode(),'sha256':C.sha(n)}
  state={'active':True,'held':False,'restores':0,'drains':0,'searchRestores':0,'events':[]};units=('api','worker');gateway={'socket':{'ActiveState':'active','UnitFileState':'enabled'}}
  def states(names):return {n:{'ActiveState':'active' if state['active'] else 'inactive','MainPID':'123' if state['active'] else '0','WorkingDirectory':str(root)} for n in names}
  snap={'format':'pow-cef-node-dependency-capture-v1','root':str(root),'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'packages':before,'locks':locks,'services':states(units),'gateway':gateway,'unitHashes':{'search.service':'a'*64,'search.timer':'b'*64},'nodePath':'/fixture/node'}
  m={'format':'pow-cef-node-dependency-plan-v1','executable':True,'sourceCommit':'f'*40,'releaseId':'f'*12+'-20261015T180000Z','capture':snap,'candidatePackages':candidate,'candidateLocks':nextlocks}
  def durable(p,b):
   with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
  def drain():state['events'].append('drain');state['drains']+=1;state['active']=False
  def restore(pins):state['events'].append('restore');state['restores']+=1;state['active']=True
  def quiet(actual):
   if not state['held']:raise ValueError('Search is active')
   state['events'].append('quiet')
  G={'BACKUPS':backup,'LOCK':lock,'UNITS':units,'SEARCH':('search.service','search.timer'),'states':states,'gateway_states':lambda:gateway,'durable':durable,'sync':lambda p:None,'drain_apps':drain,'restore_apps':restore,'require_search_held':quiet}
  def apply(phase,path,bindings):
   if phase=='hold':hold.write_bytes(b'owned-hold');state['held']=True
   else:
    if not state['active']:raise ValueError('Search resumed before apps restored')
    hold.unlink();state['held']=False;state['searchRestores']+=1
   state['events'].append('search-'+phase);return {'phase':phase}
  H={'HOLD':hold,'LOCK':searchlock,'BASE':holds,'apply':apply,'safe_directory':lambda p:None}
  return types.SimpleNamespace(td=td,root=root,mod=mod,backup=backup,state=state,G=G,H=H,m=m,lock=lock,searchlock=searchlock)
 @contextlib.contextmanager
 def setup(self):
  f=self.fixture()
  with contextlib.ExitStack() as stack:
   for name,value in [('ROOT',f.root),('MOD',f.mod),('fence',lambda *a,**k:None),('resolve_and_probe',lambda node:{'fixture':'passed'}),('health_probe',lambda route,required:{'httpStatus':200,'body':{'available':True,'ready':False}}),('acquire_locks',lambda G,H:(os.open(f.lock,os.O_RDONLY),os.open(f.searchlock,os.O_RDONLY)))]:stack.enter_context(mock.patch.object(C,name,value))
   stack.enter_context(mock.patch.object(C.os,'geteuid',lambda:0));stack.enter_context(mock.patch.object(C.sys,'flags',types.SimpleNamespace(isolated=1)));stack.enter_context(contextlib.redirect_stdout(io.StringIO()));stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
   try:yield f
   finally:f.td.cleanup()
 def baseline_restored(self,f):
  for n in C.NAMES:self.assertEqual(C.inventory(f.mod/n),{p:{k:v for k,v in r.items() if k!='base64'} for p,r in f.m['capture']['packages'][n].items()})
  for rel,row in f.m['capture']['locks'].items():self.assertEqual(C.sha(C.raw(f.root/rel)),row['sha256'])
  self.assertTrue(f.state['active']);self.assertFalse(f.state['held'])
 def test_success_retains_originals_and_waits_for_ordinary_readiness(self):
  with self.setup() as f:
   r=C.apply(f.m,f.G,f.H);self.assertEqual(r['status'],'installed-services-restored-awaiting-ordinary-readiness');self.assertTrue(r['installed']);self.assertFalse(f.state['held'])
   for n in C.NAMES:self.assertEqual(json.loads((f.mod/n/'package.json').read_text())['version'],C.VERSIONS[n]);self.assertTrue((Path(r['retainedBeforePackages'])/n).is_dir())
   self.assertEqual(f.state['searchRestores'],1)
 def test_partial_drain_failure_restores_apps_before_search(self):
  with self.setup() as f:
   original=f.G['drain_apps']
   def fail():
    original()
    if f.state['drains']==1:raise OSError('partial stop')
   f.G['drain_apps']=fail
   with self.assertRaisesRegex(OSError,'partial stop'):C.apply(f.m,f.G,f.H)
   self.baseline_restored(f);self.assertEqual(f.state['restores'],1)
 def test_persistent_journal_failure_after_first_rename_does_not_block_rollback(self):
  with self.setup() as f:
   original=f.G['durable'];failed=False
   def fail(p,b):
    nonlocal failed
    if p.name.startswith('receipt.next') and (failed or not (f.mod/'nanoid').exists()):
     failed=True;p.write_bytes(b[:10]);raise OSError('persistent journal fault')
    return original(p,b)
   f.G['durable']=fail
   with self.assertRaisesRegex(OSError,'persistent journal fault'):C.apply(f.m,f.G,f.H)
   self.assertTrue(failed);self.baseline_restored(f)
 def test_second_rename_failure_restores_first_package(self):
  with self.setup() as f:
   original=C.os.rename;failed=False
   def rename(a,b):
    nonlocal failed
    if not failed and str(a).endswith('/candidate/nanoid'):failed=True;raise OSError('candidate rename fault')
    return original(a,b)
   with mock.patch.object(C.os,'rename',rename):
    with self.assertRaisesRegex(OSError,'candidate rename fault'):C.apply(f.m,f.G,f.H)
   self.baseline_restored(f)
 def test_hidden_lock_replace_failure_restores_root_lock_and_all_packages(self):
  with self.setup() as f:
   original=C.os.replace;failed=False
   def replace(a,b):
    nonlocal failed
    if not failed and Path(b)==f.mod/'.package-lock.json':failed=True;raise OSError('hidden lock replace fault')
    return original(a,b)
   with mock.patch.object(C.os,'replace',replace):
    with self.assertRaisesRegex(OSError,'hidden lock replace fault'):C.apply(f.m,f.G,f.H)
   self.baseline_restored(f)
 def test_runtime_probe_failure_rolls_back_before_search_restore(self):
  with self.setup() as f:
   with mock.patch.object(C,'resolve_and_probe',side_effect=ValueError('import failure')):
    with self.assertRaisesRegex(ValueError,'import failure'):C.apply(f.m,f.G,f.H)
   self.baseline_restored(f)
 def test_hold_drift_refuses_swaps_and_keeps_hold_if_quiet_recovery_fails(self):
  with self.setup() as f:
   original=f.G['drain_apps']
   def drain():original();f.state['held']=False
   f.G['drain_apps']=drain
   with self.assertRaisesRegex(ValueError,'Search is active'):C.apply(f.m,f.G,f.H)
   for n in C.NAMES:self.assertEqual(json.loads((f.mod/n/'package.json').read_text())['version'],'1.0.0')
   self.assertEqual(f.state['searchRestores'],0)
 def test_manifest_scope_and_byte_refusals(self):
  with self.setup() as f:
   edits=[lambda m:m.update(executable=False),lambda m:m.update(sourceCommit='bad'),lambda m:m['candidatePackages'].pop('valibot'),lambda m:m['candidatePackages']['valibot'].__setitem__('../escape',{}),lambda m:m['candidateLocks'].__setitem__('/etc/escape',{}),lambda m:m['capture']['locks'].__setitem__('/etc/escape',{}),lambda m:m['candidatePackages']['valibot']['package.json'].__setitem__('sha256','0'*64),lambda m:m['candidatePackages']['valibot']['package.json'].__setitem__('mode',0o777)]
   for edit in edits:
    m=copy.deepcopy(f.m);edit(m)
    with self.subTest(edit=edit),self.assertRaises((ValueError,KeyError)):C.validate_payload(m)
 def test_unqualified_baseline_permissions_refused(self):
  with self.setup() as f:
   for key,value in [('mode',0o755),('uid',os.getuid()+1),('gid',os.getgid()+1),('kind','symlink')]:
    m=copy.deepcopy(f.m);m['capture']['packages']['valibot']['package.json'][key]=value
    with self.subTest(key=key),self.assertRaisesRegex(ValueError,'Unqualified baseline'):C.validate_payload(m)
 def test_old_and_future_captures_refused_before_mutation(self):
  with self.setup() as f:
   for seconds in (-181,30):
    m=copy.deepcopy(f.m);m['capture']['at']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=seconds)).isoformat()
    with self.subTest(seconds=seconds),self.assertRaisesRegex(ValueError,'fresh180second'):C.apply(m,f.G,f.H)
   self.assertEqual(list(f.backup.iterdir()),[]);self.assertEqual(f.state['events'],[])
 def test_verified_install_search_restore_failure_does_not_roll_back(self):
  with self.setup() as f:
   original=f.H['apply']
   def phase(action,path,bindings):
    if action=='restore':raise OSError('Search restore failure')
    return original(action,path,bindings)
   f.H['apply']=phase
   with self.assertRaisesRegex(OSError,'Search restore failure'):C.apply(f.m,f.G,f.H)
   self.assertTrue(f.state['active']);self.assertTrue(f.state['held'])
   for n in C.NAMES:self.assertEqual(json.loads((f.mod/n/'package.json').read_text())['version'],C.VERSIONS[n])
   receipt=json.loads(next(f.backup.glob('*/receipt.json')).read_text());self.assertTrue(receipt['installed']);self.assertFalse(receipt['rolledBack']);self.assertEqual(receipt['status'],'installed-verified-follow-up-required')
 def test_unsafe_runtime_backup_roots_refuse_before_locks_or_changes(self):
  with self.setup() as f:
   for path in (f.root,f.mod,f.backup):
    prior=stat.S_IMODE(path.stat().st_mode);os.chmod(path,0o777)
    with self.subTest(path=path),mock.patch.object(C,'acquire_locks',side_effect=AssertionError('No lock acquisition')),self.assertRaisesRegex(ValueError,'Unsafe runtime/backup root'):C.apply(f.m,f.G,f.H)
    os.chmod(path,prior)
   f.H['safe_directory']=mock.Mock(side_effect=ValueError('Unsafe Search hold directory'))
   with mock.patch.object(C,'acquire_locks',side_effect=AssertionError('No lock acquisition')),self.assertRaisesRegex(ValueError,'Unsafe Search hold directory'):C.apply(f.m,f.G,f.H)
   self.assertEqual(list(f.backup.iterdir()),[]);self.assertEqual(f.state['events'],[])
 def test_symlink_backup_root_refuses_before_locks(self):
  with self.setup() as f:
   link=Path(f.td.name)/'backup-link';link.symlink_to(f.backup,target_is_directory=True);f.G['BACKUPS']=link
   with mock.patch.object(C,'acquire_locks',side_effect=AssertionError('No lock acquisition')),self.assertRaisesRegex(ValueError,'Unsafe runtime/backup root'):C.apply(f.m,f.G,f.H)
   self.assertEqual(list(f.backup.iterdir()),[])
 def test_unrelated_lock_entry_refused(self):
  with self.setup() as f:
   m=copy.deepcopy(f.m);lock=json.loads(base64.b64decode(m['candidateLocks']['package-lock.json']['base64']));lock['packages']['node_modules/preserved-font']['version']='6.0.0';b=C.encoded(lock);m['candidateLocks']['package-lock.json']={'base64':base64.b64encode(b).decode(),'sha256':C.sha(b)}
   with self.assertRaisesRegex(ValueError,'Unrelated lock'):C.validate_payload(m)
if __name__=='__main__':unittest.main()
