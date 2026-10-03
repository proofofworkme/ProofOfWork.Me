#!/usr/bin/python3 -I
import base64,copy,hashlib,importlib.util,json,os,signal,stat,tempfile,time,types,unittest,subprocess,sys
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('B','/tmp/pow-audit30-treasury-native-v8.py');B=importlib.util.module_from_spec(sp);sp.loader.exec_module(B)
PACKAGE=json.loads(Path('/tmp/pow-audit30-treasury-address-package-request-v2.json').read_bytes())
def request(mode='run'):
 return {'schema':'pow-audit30-treasury-address-native-request-v1','approvalSha256':B.APPROVAL,'mode':mode,'runId':PACKAGE['runId'],'packageRequest':copy.deepcopy(PACKAGE),'packageRequestSha256':hashlib.sha256((json.dumps(PACKAGE,sort_keys=True,indent=2)+'\n').encode()).hexdigest()}
def row(unit,e):
 d={k:''for k in B.FIELDS};d.update(LoadState='loaded',ActiveState='active',SubState='exited',MainPID='0',InvocationID='a'*32,Result='success',ExecMainCode='1',ExecMainStatus='0',User='bitcoin',Group='bitcoin',MemoryMax=str(1024**3),MemoryHigh=str(512*1024**2),MemorySwapMax='0',CPUQuotaPerSecUSec='250ms',CPUWeight='10',IOWeight='10',Nice='15',TasksMax='32',RuntimeMaxUSec='22min',TimeoutStopUSec='30s',KillMode='control-group',Restart='no',NoNewPrivileges='yes',ProtectSystem='strict',ProtectHome='yes',PrivateTmp='yes',PrivateDevices='yes',PrivateIPC='yes',PrivateNetwork='no',RestrictAddressFamilies='AF_UNIX AF_INET AF_INET6',ReadOnlyPaths='/etc/bitcoin /data/bitcoin',InaccessiblePaths='/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces /etc/proofofwork-api',StandardInput='null',StandardOutput='append',StandardError='append',UMask='0077',ControlGroup='/system.slice/'+unit,RemainAfterExit='yes',Type='exec',Transient='yes',FragmentPath='/run/systemd/transient/'+unit,DropInPaths='',SourcePath='');return d
class Tests(unittest.TestCase):
 def setUp(self):
  self.real_output_proof=B.Observer.output_proof;self.proof_patch=patch.object(B.Observer,'output_proof',return_value={'fixtureOnly':True});self.proof_patch.start();self.addCleanup(self.proof_patch.stop)

 def test_real_subprocess_selector_signal_reaped_then_repeat_signal_cleanup_receipt(self):
  with tempfile.TemporaryDirectory(dir='/tmp')as text:
   folder=Path(text);marker=folder/'blocking'
   code=r'''
import importlib.util,pathlib,time,types,sys,json
folder=pathlib.Path(sys.argv[1]);s=importlib.util.spec_from_file_location('T','/tmp/pow-audit30-treasury-native-v8.test.py');T=importlib.util.module_from_spec(s);s.loader.exec_module(T);B=T.B
B.BASE=folder/'tools';B.BASE.mkdir();B.EVIDENCE=folder
v=T.request();v['packageRequest']['packagePath']=str(B.BASE/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode())
B.pwd.getpwnam=lambda _:types.SimpleNamespace(pw_gid=1000)
B.canonical_dir=lambda *_args,**_kwargs:None
B.package_proof=lambda *_:{'fixture':'byte-pins-still-exact'}
B.require_absent=lambda *_:None
B.live_snapshot=lambda *_:{'fixture':'no-live-native-calls'}
Original=B.Observer
class LocalOwner(Original):
 def command(self,args,cleanup=False):
  if args[0]=='/usr/bin/systemd-run':
   return super().command([sys.executable,'-I','-B','-c','import pathlib,sys,time,os;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(10)',str(folder/'blocking')])
  raise AssertionError('no remote service invocation in fixture')
 def show(self,cleanup=False):return T.row(self.unit,self.evidence)
 def typed_start(self,cleanup=False):return {'fixture':'exact-local-owner'}
 def output_proof(self,value):return {'fixture':'no-native-fragment'}
 def stop_owned(self):
  (folder/'cleanup').write_text('masked-cleanup');time.sleep(.1)
  return {'attempted':True,'fixtureOnly':True}
B.Observer=LocalOwner
try:B.run(v)
except BaseException as error:print(json.dumps({'errorClass':type(error).__name__}),flush=True)
else:print(json.dumps({'errorClass':None}),flush=True)
'''
   p=subprocess.Popen([sys.executable,'-I','-B','-c',code,text],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
   try:
    start=time.monotonic()
    while not marker.exists()and time.monotonic()-start<2:time.sleep(.005)
    self.assertTrue(marker.exists());p.send_signal(signal.SIGTERM)
    while not(folder/'cleanup').exists()and p.poll()is None and time.monotonic()-start<2:time.sleep(.005)
    self.assertTrue((folder/'cleanup').exists());p.send_signal(signal.SIGINT)
    out,err=p.communicate(timeout=2);self.assertEqual(p.returncode,0);self.assertEqual(err,b'');self.assertEqual(json.loads(out)['errorClass'],'ValueError')
    done=json.loads(next(folder.glob('audit30-treasury-address-*/failed.json')).read_bytes())
    self.assertEqual(done['failure']['errorClass'],'NativeInterrupted');self.assertTrue(done['cleanup']['attempted']);self.assertFalse(done['transportAccepted']);self.assertFalse(list(folder.glob('audit30-treasury-address-*/completed.json')))
    with self.assertRaises(ProcessLookupError):os.kill(int(marker.read_text()),0)
    self.assertLess(time.monotonic()-start,2)
   finally:
    if p.poll()is None:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=2)
    p.stdout.close();p.stderr.close()

 def test_ordinary_signal_category_cannot_match_builtin_selector_retry(self):
  self.assertTrue(issubclass(B.NativeInterrupted,RuntimeError));self.assertFalse(issubclass(B.NativeInterrupted,InterruptedError))

 def test_fixed_typed_request_validates_pinned_raw_bytes_and_calendar(self):
  rid,files=B.validate_request(request());self.assertEqual(rid,PACKAGE['runId']);self.assertEqual({n:(B.sha(r),len(r))for n,r in files.items()},B.PINS)
  for change in('approval','field','mode','calendar','packagepath','hash','member','byte','duplicate','launch'):
   v=request()
   if change=='approval':v['approvalSha256']='e'*64
   elif change=='field':v['arbitraryCommand']='touch /tmp/no'
   elif change=='mode':v['mode']='delete'
   elif change=='calendar':v['runId']='20260230T031100Z'
   elif change=='packagepath':v['packageRequest']['packagePath']='/etc/bitcoin'
   elif change=='hash':v['packageRequestSha256']='e'*64
   elif change=='member':v['packageRequest']['members'][0]['name']='../else.py'
   elif change=='byte':v['packageRequest']['members'][0]['rawBase64']=base64.b64encode(b'bad').decode()
   elif change=='duplicate':v['packageRequest']['members'][1]=v['packageRequest']['members'][0]
   elif change=='launch':v['packageRequest']['launchRequested']=True
   with self.subTest(change=change),self.assertRaises(ValueError):B.validate_request(v)
 def test_creation_exclusive_durable_file_and_reuse_refuse(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'receipt';h=B.durable(p,{'scope':False});self.assertEqual(h['sha256'],B.sha(p.read_bytes()));self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
   with self.assertRaises(FileExistsError):B.durable(p,{})
 def test_read_fence_ignores_only_atime_and_rejects_symlink_or_hardlink(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'source';p.write_bytes(b'x');p.chmod(0o600);os.utime(p,ns=(1,p.stat().st_mtime_ns));self.assertEqual(B.read_file(p,1)[0],b'x');link=Path(t)/'alias';link.symlink_to(p)
   with self.assertRaises(ValueError):B.read_file(link,1)
   link.unlink();os.link(p,link)
   with self.assertRaises(ValueError):B.read_file(p,1)
 def test_prepare_only_new_scope_under_restrictive_umask_and_never_reuse(self):
  with tempfile.TemporaryDirectory()as t:
   base=Path(t)/'packages';v=request('prepare');v['packageRequest']['packagePath']=str(base/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode());saved=os.umask(0o077)
   try:
    with patch.object(B,'BASE',base),patch.object(B,'canonical_dir'),patch.object(B.os,'chown'),patch.object(B.os,'fchown'),patch.object(B.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_gid=os.getgid())),patch.object(B,'package_proof',return_value={'qualifiedFixture':True}):
     r=B.prepare(v);self.assertFalse(r['nativeUnitLaunched']);p=base/v['runId'];self.assertEqual(stat.S_IMODE(base.stat().st_mode),0o755);self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o750)
     for n,(h,size)in B.PINS.items():self.assertEqual(stat.S_IMODE((p/n).stat().st_mode),0o440);self.assertEqual(B.sha((p/n).read_bytes()),h)
     with self.assertRaises(ValueError):B.prepare(v)
   finally:os.umask(saved)
 def test_existing_parent_symlink_groupwrite_or_wrong_owner_refused(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t);self.assertEqual(B.canonical_dir(p,os.getuid()).st_uid,os.getuid());p.chmod(0o777)
   with self.assertRaises(ValueError):B.canonical_dir(p,os.getuid())
   p.chmod(0o700);alias=p/'alias';alias.symlink_to(p)
   with self.assertRaises(ValueError):B.canonical_dir(alias,os.getuid())
 def test_ownership_recorded_before_weakened_resource_refusal(self):
  with tempfile.TemporaryDirectory()as t:
   e=Path(t);o=B.Observer('fixture.service',e,time.monotonic()+10);d=row(o.unit,e);d['MemoryMax']='2048'
   with patch.object(o,'show',return_value=d),patch.object(o,'typed_start',return_value={'fixture':True}),self.assertRaises(ValueError):o.observe()
   self.assertEqual(o.owned,'a'*32);self.assertEqual(len(o.snapshots),1)
 def test_unknown_or_changed_invocation_never_cleanup_other_unit(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),0);o.owned='a'*32;d=row(o.unit,Path(t));d['InvocationID']='b'*32
   with patch.object(o,'show',return_value=d),patch.object(o,'command')as c,self.assertRaises(ValueError):o.stop_owned()
   c.assert_not_called()
 def test_expired_normal_deadline_owned_cleanup_uses_independent_budget_and_gc_qualification(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),0);o.owned='a'*32;d=row(o.unit,Path(t));end=copy.deepcopy(d);end.update(LoadState='not-found',InvocationID='',ActiveState='inactive',ControlGroup='',MainPID='0')
   with patch.object(o,'show',side_effect=[d,end])as show,patch.object(o,'command',return_value=b'')as command,patch.object(o,'typed_start',return_value={'fixed':True}):
    out=o.stop_owned();self.assertTrue(out['attempted']);self.assertEqual(show.call_args_list[0].args,(True,));self.assertTrue(command.call_args.args[-1]);self.assertEqual(command.call_args.args[0],['/usr/bin/systemctl','stop','fixture.service'])
 def test_all_security_resource_capture_paths_require_exact_fields(self):
  with tempfile.TemporaryDirectory()as t:
   e=Path(t);d=row('fixture.service',e);B.validate_properties(d,e)
   for key,value in [('User','root'),('NoNewPrivileges','no'),('MemorySwapMax','1'),('RuntimeMaxUSec','1h'),('ProtectSystem','full'),('InaccessiblePaths',''),('CapabilityBoundingSet','cap_setuid'),('StandardOutput','append:/etc/bitcoin/bitcoin.conf'),('RemainAfterExit','no'),('PrivateNetwork','yes')]:
    with self.subTest(key=key),self.assertRaises(ValueError):B.validate_properties(d|{key:value},e)
 def test_live_snapshot_never_defaults_missing_unit_to_success(self):
  o=types.SimpleNamespace(command=lambda _:b'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID=\n')
  with self.assertRaises(ValueError):B.live_snapshot(o)
 def exercise_run(self,fault=None):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);eparent=Path(t.name);base=eparent/'packages';base.mkdir();v=request();v['packageRequest']['packagePath']=str(base/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode());e=eparent/('audit30-treasury-address-'+v['runId']);state={'stops':0,'args':None};originalproof=B.capture_proof
  def fakeproof(p,bound):
   raw=p.read_bytes();B.need(len(raw)<=bound,'Fixture capture bound');return {'path':str(p),'bytes':len(raw),'sha256':B.sha(raw)},raw
  def command(o,args,cleanup=False):
   if args[0]=='/usr/bin/systemctl'and args[1]=='show':return b'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID=\n'
   if args[0]=='/usr/bin/systemd-run':
    state['args']=args;raw=json.dumps({'schema':'pow-audit30-treasury-address-corpus-v1','productionMutation':False,'financialReconciliationComplete':False,'obligationReconciliationComplete':False,'may9OperatorConfirmedPaid':True,'may9TransactionIDsRequested':False,'status':'partial-discovery-rpc-or-moving-snapshot','coverage':{},'oracle':{'completeFinancialOrObligationReconciliation':False}}).encode();(e/'corpus.json').write_bytes(raw)
    if fault=='launchsignal':raise InterruptedError('fixture signal before launch ack')
    return b''
   if args[1]=='stop':
    state['stops']+=1
    if fault=='cleanup':raise OSError('private cleanup sentinel')
    if fault=='signals':
     for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):os.kill(os.getpid(),s)
    return b''
   raise AssertionError(args)
  def show(o,cleanup=False):
   d=row(o.unit,e)
   if state['stops']:d.update(ActiveState='inactive',SubState='dead')
   if fault=='memory':d['MemoryMax']='10'
   return d
  before={'live':'same'}
  with patch.object(B,'BASE',base),patch.object(B,'EVIDENCE',eparent),patch.object(B,'canonical_dir'),patch.object(B,'package_proof',return_value={'proof':'same'}),patch.object(B,'live_snapshot',return_value=before),patch.object(B.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_gid=os.getgid())),patch.object(B.Observer,'command',command),patch.object(B.Observer,'show',show),patch.object(B.Observer,'typed_start',return_value={'fixture':True}),patch.object(B,'capture_proof',fakeproof):
   if fault in('cleanup','memory','launchsignal'):
    with self.assertRaises(ValueError):B.run(v)
   else:result=B.run(v);self.assertFalse(result['financialReconciliationComplete'])
  receipt=json.loads((e/('failed.json'if fault in('cleanup','memory','launchsignal')else'completed.json')).read_bytes());return receipt,state,e
 def test_success_retains_unit_snapshot_before_owned_stop_and_partial_status(self):
  r,s,e=self.exercise_run();self.assertTrue(r['transportAccepted']);self.assertEqual(s['stops'],1);self.assertEqual(r['result']['status'],'partial-discovery-rpc-or-moving-snapshot');self.assertFalse(r['financialReconciliationComplete']);self.assertEqual(r['unitSnapshots'][0]['properties']['InvocationID'],'a'*32);self.assertNotIn('--collect',s['args']);self.assertIn('RemainAfterExit=yes',s['args']);self.assertIn('resource.RLIMIT_FSIZE',s['args'][-1])
 def test_actual_constructed_launch_setters_are_paths_while_observer_reads_enums(self):
  r,state,e=self.exercise_run();args=state['args'];props={}
  for i,token in enumerate(args):
   if token=='--property':
    k,sep,v=args[i+1].partition('=');self.assertTrue(sep);self.assertNotIn(k,props);props[k]=v
  self.assertEqual(props['StandardOutput'],'append:'+str(e/'corpus.json'))
  self.assertEqual(props['StandardError'],'append:'+str(e/'stderr.log'))
  self.assertEqual(props['StandardInput'],'null')
  self.assertEqual(args[args.index('--')+1:],B.fixed_argv(e.parent/'packages'/PACKAGE['runId']))
  self.assertEqual(r['unitSnapshots'][0]['properties']['StandardOutput'],'append')
  self.assertEqual(r['unitSnapshots'][0]['properties']['StandardError'],'append')
 def test_weakened_resource_is_owned_stopped_and_failure_capture_preserved(self):
  r,s,e=self.exercise_run('memory');self.assertFalse(r['transportAccepted']);self.assertEqual(s['stops'],1);self.assertIn('corpus.json',r['captureFiles']);self.assertIsNotNone(r['failure']);self.assertFalse(r['autoRetry'])
 def test_cleanup_refusal_never_completed_false_green(self):
  r,s,e=self.exercise_run('cleanup');self.assertFalse(r['transportAccepted']);self.assertEqual(r['failure']['phase'],'owned-cleanup');self.assertFalse((e/'completed.json').exists());self.assertNotIn('sentinel',json.dumps(r))
 def test_repeated_signals_during_cleanup_do_not_skip_receipt_handlers_restored(self):
  old={s:signal.getsignal(s)for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)};r,s,e=self.exercise_run('signals');self.assertTrue(r['transportAccepted']);self.assertEqual({s:signal.getsignal(s)for s in old},old)
 def test_root_timeout_admission_installed_before_stdin_and_restored(self):
  called=[]
  class Input:
   def read(self,n):called.append(signal.getsignal(signal.SIGALRM));raise TimeoutError('fixture no stdin')
  old=signal.getsignal(signal.SIGALRM)
  with patch.object(B.os,'geteuid',return_value=0),patch.object(B.os,'uname',return_value=types.SimpleNamespace(nodename=B.HOST)),patch.object(B.sys,'argv',['bootstrap']),patch.object(B.sys,'stdin',types.SimpleNamespace(buffer=Input())):
   with self.assertRaises(TimeoutError):B.main()
  self.assertNotEqual(called[0],old);self.assertEqual(signal.getsignal(signal.SIGALRM),old)
 def test_prelaunch_collision_refuses_before_any_evidence_or_intent(self):
  with tempfile.TemporaryDirectory()as t:
   base=Path(t)/'packages';base.mkdir();v=request();v['packageRequest']['packagePath']=str(base/v['runId']);v['packageRequestSha256']=B.sha((json.dumps(v['packageRequest'],sort_keys=True,indent=2)+'\n').encode());data=Path(t)/'evidence';data.mkdir()
   with patch.object(B,'BASE',base),patch.object(B,'EVIDENCE',data),patch.object(B,'canonical_dir'),patch.object(B,'package_proof',return_value={}),patch.object(B.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_gid=1)),patch.object(B.Observer,'command',return_value=b'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=777\nInvocationID='+b'a'*32+b'\n')as c,patch.object(B.Observer,'stop_owned')as stop:
    with self.assertRaises(ValueError):B.run(v)
    self.assertEqual(list(data.iterdir()),[]);stop.assert_not_called();self.assertEqual(len(c.call_args_list),1)
 def test_exact_typed_execstart_before_owned_and_wrong_type_role_argv_refuse(self):
  with tempfile.TemporaryDirectory()as t:
   e=Path(t);args=B.fixed_argv(Path('/usr/local/lib/proofofwork-audit30-treasury-address/'+PACKAGE['runId']));o=B.Observer('fixture.service',e,time.monotonic()+10,args);d=row(o.unit,e);manager={'type':'o','data':['/org/freedesktop/systemd1/unit/fixture_2eservice']};entry=[args[0],args,False,0,0,0,0,0,0,0];start={'type':'a(sasbttttuii)','data':[entry]}
   with patch.object(o,'show',return_value=d),patch.object(o,'command',side_effect=[json.dumps(manager).encode(),json.dumps(start).encode()]):o.observe()
   self.assertEqual(o.owned,'a'*32);self.assertEqual(o.snapshots[0]['typedExecStart']['fixedCodeSha256'],B.sha(args[-1].encode()))
   for change in('type','role','group','transient','argv','program','multiple','ignore','signature'):
    n=B.Observer('fixture.service',e,time.monotonic()+10,args);bad=copy.deepcopy(start);fields=copy.deepcopy(d)
    if change=='type':fields['Type']='simple'
    elif change=='role':fields['User']='root'
    elif change=='group':fields['Group']='root'
    elif change=='transient':fields['Transient']='no'
    elif change=='argv':bad['data'][0][1]=args[:-1]+['import os;os.unlink("/no")']
    elif change=='program':bad['data'][0][0]='/bin/sh'
    elif change=='multiple':bad['data'].append(entry)
    elif change=='ignore':bad['data'][0][2]=True
    elif change=='signature':bad['type']='s'
    with self.subTest(change=change),patch.object(n,'show',return_value=fields),patch.object(n,'command',side_effect=[json.dumps(manager).encode(),json.dumps(bad).encode()]),self.assertRaises(ValueError):n.observe()
    self.assertIsNone(n.owned)
 def test_actual_successful_retained_empty_cgroup_owned_and_stopped(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),time.monotonic()+10);d=row(o.unit,Path(t));d['ControlGroup']=''
   with patch.object(o,'show',return_value=d),patch.object(o,'typed_start',return_value={'fixed':True}):o.observe()
   self.assertEqual(o.owned,'a'*32)
   end=d|{'LoadState':'not-found','InvocationID':'','ActiveState':'inactive','SubState':'dead'}
   with patch.object(o,'show',side_effect=[d,end]),patch.object(o,'typed_start',return_value={'fixed':True})as typed,patch.object(o,'command',return_value=b'')as cmd:out=o.stop_owned()
   self.assertTrue(out['attempted']);typed.assert_called_once_with(True);self.assertEqual(cmd.call_args.args[0],['/usr/bin/systemctl','stop','fixture.service'])
 def test_empty_cgroup_only_exact_successful_terminal_shape(self):
  with tempfile.TemporaryDirectory()as t:
   for k,v in [('MainPID','7'),('ActiveState','activating'),('SubState','running'),('Result','exit-code'),('ExecMainStatus','1'),('RemainAfterExit','no'),('Type','simple'),('Transient','no'),('User','root'),('Group','root'),('ControlGroup','/system.slice/other.service')]:
    o=B.Observer('fixture.service',Path(t),time.monotonic()+10);d=row(o.unit,Path(t))|{'ControlGroup':'',k:v}
    with self.subTest(k=k),patch.object(o,'show',return_value=d),patch.object(o,'typed_start')as typed,self.assertRaises(ValueError):o.observe()
    self.assertIsNone(o.owned);typed.assert_not_called()
 def test_empty_cgroup_wrong_typed_command_refuses_before_owned(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),time.monotonic()+10);d=row(o.unit,Path(t))|{'ControlGroup':''}
   with patch.object(o,'show',return_value=d),patch.object(o,'typed_start',side_effect=ValueError('wrong argv')),self.assertRaises(ValueError):o.observe()
   self.assertIsNone(o.owned)
 def test_interruption_after_launch_before_ack_recovers_owned_and_stops(self):
  r,s,e=self.exercise_run('launchsignal');self.assertFalse(r['transportAccepted']);self.assertEqual(s['stops'],1);self.assertIsNotNone(r['failure']);self.assertFalse((e/'completed.json').exists());self.assertEqual(r['retainedUnitProbeSha256'],B.RETAINED_PROBE_SHA)
 def test_expired_work_deadline_cleanup_observer_uses_cleanup_budget(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),0);d=row(o.unit,Path(t))|{'ControlGroup':''}
   with patch.object(o,'show',return_value=d)as show,patch.object(o,'typed_start',return_value={'fixed':True})as typed:o.observe(True)
   show.assert_called_once_with(True);typed.assert_called_once_with(True);self.assertEqual(o.owned,'a'*32)
 def fragment_case(self,raw=None,fields=None,filemeta=None):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);o=B.Observer('fixture.service',Path(temp.name),time.monotonic()+10);d=row(o.unit,Path(temp.name));d.update(fields or{});want={'StandardInput':'null','StandardOutput':'append:'+str(o.evidence/'corpus.json'),'StandardError':'append:'+str(o.evidence/'stderr.log')};r=('[Service]\n'+'\n'.join(k+'='+v for k,v in want.items())+'\n').encode()if raw is None else raw;s=types.SimpleNamespace(st_dev=1,st_ino=2,st_mode=stat.S_IFREG|0o644,st_uid=0,st_gid=0,st_nlink=1,st_size=len(r),st_mtime_ns=5,st_ctime_ns=6)
  if filemeta:
   for k,v in filemeta.items():setattr(s,k,v)
  return o,d,r,s,want
 def test_actual_append_enum_and_exact_fragment_targets_accepted(self):
  o,d,r,s,want=self.fragment_case()
  with patch.object(B,'canonical_dir'),patch.object(B,'read_file',return_value=(r,s)),patch.object(B.os,'listxattr',return_value=[]):p=self.real_output_proof(o,d)
  self.assertEqual(p['selectedOutputDirectives'],want);self.assertEqual(p['actualOutputPropertyProbeSha256'],B.OUTPUT_PROPERTY_PROBE_SHA);self.assertEqual(p['sha256'],B.sha(r));B.validate_properties(d,o.evidence)
 def test_fragment_wrong_path_dropin_sources_never_read(self):
  for k,v in [('FragmentPath','/etc/systemd/system/other.service'),('DropInPaths','/etc/systemd/system/extra.conf'),('SourcePath','/other')]:
   o,d,r,s,want=self.fragment_case(fields={k:v})
   with self.subTest(k=k),patch.object(B,'read_file')as read,self.assertRaises(ValueError):self.real_output_proof(o,d)
   read.assert_not_called()
 def test_fragment_duplicate_wrong_targets_sections_continuation_refuse(self):
  o,d,r,s,want=self.fragment_case()
  bads=[r+b'StandardOutput=append:/etc/bitcoin/bitcoin.conf\n',r.replace(want['StandardOutput'].encode(),b'append:/other'),r.replace(b'[Service]',b'[Unit]'),r.replace(b'StandardInput=null',b'StandardInput=null\\'),r.replace(b'StandardError=append:',b'WrongKey=append:')]
  for raw in bads:
   with self.subTest(raw=raw),patch.object(B,'canonical_dir'),patch.object(B,'read_file',return_value=(raw,s)),patch.object(B.os,'listxattr',return_value=[]),self.assertRaises(ValueError):self.real_output_proof(o,d)
 def test_fragment_root_owner_and_xattrs_refuse(self):
  for md,attrs in [({'st_uid':108},[]),({'st_gid':112},[]),({},['user.changed'])]:
   o,d,r,s,want=self.fragment_case(filemeta=md)
   with patch.object(B,'canonical_dir'),patch.object(B,'read_file',return_value=(r,s)),patch.object(B.os,'listxattr',return_value=attrs),self.assertRaises(ValueError):self.real_output_proof(o,d)
 def test_fragment_wrong_enum_is_not_accepted_even_valid_path(self):
  o,d,r,s,want=self.fragment_case();d['StandardOutput']='file'
  with self.assertRaises(ValueError):B.validate_properties(d,o.evidence)
 def test_fragment_refusal_records_owned_invocation_for_cleanup(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),time.monotonic()+10);d=row(o.unit,Path(t))|{'ControlGroup':''}
   with patch.object(o,'show',return_value=d),patch.object(o,'typed_start',return_value={'fixed':True}),patch.object(o,'output_proof',side_effect=ValueError('bad output target')),self.assertRaises(ValueError):o.observe()
   self.assertEqual(o.owned,'a'*32);self.assertEqual(len(o.snapshots),1)
 def test_failed_empty_cgroup_only_known_cleanup_never_observe_success(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),time.monotonic()+10);d=row(o.unit,Path(t))|{'MainPID':'0','ControlGroup':'','ActiveState':'failed','SubState':'failed','Result':'exit-code','ExecMainStatus':'1'}
   with self.assertRaises(ValueError):o.identity(d,True)
   o.owned='a'*32
   with self.assertRaises(ValueError):o.identity(d)
   self.assertEqual(o.identity(d,True),'a'*32)
 def test_known_failed_empty_cgroup_cleanup_exact_typed_invocation(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),0);o.owned='a'*32;d=row(o.unit,Path(t))|{'MainPID':'0','ControlGroup':'','ActiveState':'failed','SubState':'failed','Result':'exit-code','ExecMainStatus':'1'};end=d|{'LoadState':'not-found','InvocationID':'','ActiveState':'inactive','SubState':'dead'}
   with patch.object(o,'show',side_effect=[d,end]),patch.object(o,'typed_start',return_value={'fixed':True})as typed,patch.object(o,'command',return_value=b'')as command:r=o.stop_owned()
   self.assertTrue(r['attempted']);typed.assert_called_once_with(True);command.assert_called_once_with(['/usr/bin/systemctl','stop','fixture.service'],True)
 def test_failed_empty_cgroup_changed_live_identity_refuses_cleanup(self):
  with tempfile.TemporaryDirectory()as t:
   for k,v in [('InvocationID','b'*32),('MainPID','1'),('User','root'),('Group','root'),('Type','simple'),('Transient','no'),('RemainAfterExit','no')]:
    o=B.Observer('fixture.service',Path(t),0);o.owned='a'*32;d=row(o.unit,Path(t))|{'MainPID':'0','ControlGroup':'','ActiveState':'failed','SubState':'failed','Result':'exit-code','ExecMainStatus':'1',k:v}
    with self.subTest(k=k),patch.object(o,'show',return_value=d),patch.object(o,'command')as command,self.assertRaises(ValueError):o.stop_owned()
    command.assert_not_called()
 def test_failed_empty_cgroup_wrong_typed_argv_never_stop(self):
  with tempfile.TemporaryDirectory()as t:
   o=B.Observer('fixture.service',Path(t),0);o.owned='a'*32;d=row(o.unit,Path(t))|{'MainPID':'0','ControlGroup':'','ActiveState':'failed','SubState':'failed','Result':'exit-code','ExecMainStatus':'1'}
   with patch.object(o,'show',return_value=d),patch.object(o,'typed_start',side_effect=ValueError('wrong command')),patch.object(o,'command')as command,self.assertRaises(ValueError):o.stop_owned()
   command.assert_not_called()
if __name__=='__main__':unittest.main()
