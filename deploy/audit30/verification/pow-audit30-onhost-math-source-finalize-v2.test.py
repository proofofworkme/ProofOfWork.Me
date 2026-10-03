import base64,copy,hashlib,importlib.util,json,os,pathlib,signal,stat,subprocess,sys,tempfile,time,unittest
from unittest import mock as M
P=pathlib.Path
spec=importlib.util.spec_from_file_location('F','/tmp/pow-audit30-onhost-math-source-finalize-v2.py');F=importlib.util.module_from_spec(spec);spec.loader.exec_module(F)
UTILITY=P('/tmp/pow-audit30-onhost-math-source-copy-v3.py').read_bytes()
def properties():
 return {'LoadState':'loaded','ActiveState':'active','SubState':'exited','Type':'oneshot','Transient':'yes','ControlGroup':'/system.slice/'+F.UNIT,'RemainAfterExit':'yes','User':'postgres','Group':'postgres','InvocationID':'a'*32,'MainPID':'0','ExecStart':str(F.C.NODE)+' '+str(F.PACKAGE/'read-copy.mjs'),'MemoryMax':'1073741824','MemorySwapMax':'0','CPUQuotaPerSecUSec':'500ms','TasksMax':'32','RuntimeMaxUSec':'2min','TimeoutStartUSec':'2min','TimeoutStopUSec':'10s','KillMode':'control-group','Restart':'no','NoNewPrivileges':'yes','PrivateTmp':'yes','PrivateDevices':'yes','PrivateNetwork':'yes','RestrictAddressFamilies':'AF_UNIX','ProtectSystem':'strict','ProtectHome':'yes','ProtectKernelTunables':'yes','ProtectKernelModules':'yes','ProtectControlGroups':'yes','RestrictSUIDSGID':'yes','CapabilityBoundingSet':'','UMask':'0077','LimitFSIZE':'65536','StandardOutput':'file:'+str(F.PACKAGE/F.STDOUT),'StandardError':'file:'+str(F.PACKAGE/F.STDERR),'Result':'success','ExecMainStatus':'0'}
def metadata():return {'dev':'1','ino':'2','uid':0,'gid':112,'mode':0o440,'nlink':'1','bytes':'10','mtimeNs':'1','ctimeNs':'1'}
def request():return {'schema':'pow-audit30-source-copy-finalize-request-v1','sourceInventorySHA256':F.INVENTORY_SHA,'utilityBase64':base64.b64encode(UTILITY).decode(),'inputs':{n:{'sha256':'b'*64,'metadata':metadata()} for n in F.INPUT_NAMES},'nodeMetadata':metadata(),'attestorMetadata':metadata(),'publisherMetadata':metadata()}
def prior_failure():return {'status':'failed','mode':'prepare','code':'COPY_READABILITY_STARTED_IDENTITY','requestSHA256':F.PRIOR_REQUEST_SHA,'automaticRetry':False,'productionMutation':False,'partialPrivateArtifactsPreserved':True,'nativeReadabilityCleanup':{'attempted':True,'ownedInvocation':'c'*32,'unitAlreadyAbsent':True,'unitStopVerified':True}}
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='pow-audit30-source-finalize-fixture-');self.root=P(self.tmp.name);self.package=self.root/'package';self.package.mkdir();self.old_package=F.PACKAGE;F.C=F.load_utility(UTILITY);F.PACKAGE=self.package;F.C.PACKAGE=self.package;F.C.DEST=self.package/'source';F.C.DEADLINE=None;F.OWNED=None;F.CLEANUP=None;F.REQUEST_SHA='d'*64;F.LAUNCH_ATTEMPTED=False
 def tearDown(self):F.PACKAGE=self.old_package;F.C=None;self.tmp.cleanup()
 def test_exact_reviewed_utility_loaded_without_main(self):
  self.assertEqual(hashlib.sha256(UTILITY).hexdigest(),F.UTILITY_SHA);self.assertEqual(F.C.UNIT,F.UNIT);self.assertEqual(F.C.PG_GID,112);self.assertFalse((self.package/F.INTENT).exists())
 def test_mutated_utility_refuses(self):
  with self.assertRaises(F.Refused):F.load_utility(UTILITY+b'\n')
 def test_exact_typed_request(self):self.assertEqual(F.validate_request(request()),UTILITY)
 def test_unknown_request_or_arbitrary_inventory_refuses(self):
  for key,value in [('sourceInventorySHA256','e'*64),('sourceInventorySHA256',True),('arbitraryPath','/tmp')]:
   r=request();r[key]=value
   with self.assertRaises(F.Refused):F.validate_request(r)
 def test_missing_unknown_input_refuses(self):
  for keys in ([F.INPUT_NAMES[0]],list(F.INPUT_NAMES)+['other.json']):
   r=request();r['inputs']={n:{'sha256':'b'*64,'metadata':metadata()}for n in keys}
   with self.assertRaises(F.Refused):F.validate_request(r)
 def test_duplicate_json_key_refuses(self):
  with self.assertRaises(F.Refused):F.parse(b'{"x":1,"x":1}')
 def test_metadata_boolean_float_sign_leading_zero_refuses(self):
  for name,v in [('uid',True),('mode',288.0),('ino','01'),('dev','-1'),('nlink','2')]:
   m=metadata();m[name]=v
   with self.assertRaises(F.Refused):F.validate_metadata(m)
 def test_prior_failure_exact_safe_stop(self):F.validate_prior_failure(prior_failure())
 def test_prior_different_failure_or_unsafe_cleanup_refuses(self):
  for key,value in [('status','completed'),('code','Other'),('requestSHA256','f'*64),('automaticRetry',True),('productionMutation',True)]:
   v=prior_failure();v[key]=value
   with self.assertRaises(F.Refused):F.validate_prior_failure(v)
  for key,value in [('unitAlreadyAbsent',False),('unitStopVerified',False),('ownedInvocation','not-an-invocation')]:
   v=prior_failure();v['nativeReadabilityCleanup'][key]=value
   with self.assertRaises(F.Refused):F.validate_prior_failure(v)
 def test_prior_must_remain_failed_not_completion_relabel(self):
  v=prior_failure();v['completed']=True
  with self.assertRaises(F.Refused):F.validate_prior_failure(v)
 def typed(self):
  argv=F.args();argv=argv[argv.index('/usr/bin/env'):];return {'type':'o','data':['/org/freedesktop/systemd1/unit/fixed']},{'type':'a(sasbttttuii)','data':[['/usr/bin/env',argv,False,0,0,0,0,0,0,0]]}
 def test_typed_exec_exact_not_substring(self):
  m,v=self.typed();self.assertEqual(F.typed_identity(m,v)['argvSHA256'],F.sha(F.encode(v['data'][0][1])))
 def test_typed_wrong_program_argv_or_extra_exec_refuses(self):
  for mutate in [lambda v:v['data'][0].__setitem__(0,'/bin/sh'),lambda v:v['data'][0][1].append('/tmp/evil'),lambda v:v['data'].append(v['data'][0]),lambda v:v.__setitem__('type','as'),lambda v:v['data'][0].__setitem__(2,True)]:
   m,v=self.typed();mutate(v)
   with self.assertRaises(F.Refused):F.typed_identity(m,v)
 def test_typed_object_redirection_refuses(self):
  m,v=self.typed();m['data']=['/org/evil']
  with self.assertRaises(F.Refused):F.typed_identity(m,v)
 def test_full_retained_resource_shape(self):self.assertEqual(F.shape(properties(),'a'*32,True)['SubState'],'exited')
 def test_measured_retained_success_only_empty_cgroup(self):
  p=properties();p['ControlGroup']='';self.assertEqual(F.shape(p,'a'*32,True)['InvocationID'],'a'*32)
 def test_empty_cgroup_live_or_activating_failed_wrong_inv_refuse(self):
  for changed in [{'MainPID':'123'},{'ActiveState':'activating','SubState':'start'},{'ActiveState':'failed','SubState':'failed'},{'Result':'exit-code'},{'ExecMainStatus':'1'},{'LoadState':'not-found'},{'InvocationID':''}]:
   p=properties();p['ControlGroup']='';p.update(changed)
   with self.assertRaises(Exception):F.identity(p,'a'*32)
 def test_actual_probe_source_pin_fixed_and_caller_override_refuses(self):
  self.assertEqual(F.RETAINED_PROBE_SHA,'247be39abf08e927c9e14e82c5fb8ac56b1ee91b1e156cd05b3405148147d052')
  r=request();r['retainedUnitProbeSHA256']='a'*64
  with self.assertRaises(F.Refused):F.validate_request(r)
 def test_every_resource_or_hardening_weakened_refuses(self):
  for key,value in [('MemoryMax','infinity'),('MemorySwapMax','1'),('CPUQuotaPerSecUSec','infinity'),('TasksMax','100'),('RuntimeMaxUSec','3min'),('TimeoutStartUSec','3min'),('PrivateNetwork','no'),('NoNewPrivileges','no'),('ProtectSystem','full'),('CapabilityBoundingSet','cap_setuid'),('RemainAfterExit','no'),('LimitFSIZE','infinity'),('StandardOutput','file:/tmp/evil')]:
   p=properties();p[key]=value
   with self.assertRaises(Exception):F.shape(p)
 def test_gc_defaults_not_mistaken_for_retained_success(self):
  p=properties();p.update(LoadState='not-found',User='',Group='',InvocationID='',MainPID='0',ExecStart='')
  with self.assertRaises(Exception):F.shape(p,complete=True)
 def test_wrong_unit_type_or_cgroup_never_owned(self):
  for key,value in [('Type','exec'),('ControlGroup','/system.slice/other.service'),('Transient','no'),('User','root'),('InvocationID','x'*32)]:
   p=properties();p[key]=value
   with self.assertRaises(Exception):F.identity(p)
 def test_changed_invocation_refuses(self):
  with self.assertRaises(Exception):F.shape(properties(),'b'*32)
 def test_retained_failure_running_or_nonzero_refuses(self):
  for key,value in [('Result','exit-code'),('ExecMainStatus','1'),('MainPID','42'),('ActiveState','inactive'),('SubState','running')]:
   p=properties();p[key]=value
   with self.assertRaises(F.Refused):F.shape(p,complete=True)
 def test_fixed_async_no_pipe_wait_or_collect(self):
  a=F.args();self.assertIn('--no-block',a);self.assertNotIn('--pipe',a);self.assertNotIn('--wait',a);self.assertNotIn('--collect',a);self.assertIn('--property=Type=oneshot',a);self.assertIn('--property=RemainAfterExit=yes',a);self.assertIn('--property=TimeoutStartSec=120s',a);self.assertIn('--property=LimitFSIZE=64K',a)
 def test_exact_copy_child_census_real_fs_and_no_extra(self):
  root=self.root/'copy';root.mkdir();(root/'dir').mkdir();(root/'dir/f').write_bytes(b'a');rows=[{'path':'.','kind':'directory'},{'path':'dir','kind':'directory'},{'path':'dir/f','kind':'file'}];F.exact_children(root,rows);(root/'unadmitted').touch()
  with self.assertRaises(F.Refused):F.exact_children(root,rows)
 def test_exact_copy_nested_extra_or_missing_refuses(self):
  root=self.root/'copy';root.mkdir();(root/'dir').mkdir();rows=[{'path':'.','kind':'directory'},{'path':'dir','kind':'directory'},{'path':'dir/f','kind':'file'}]
  with self.assertRaises(F.Refused):F.exact_children(root,rows)
  (root/'dir/f').touch();(root/'dir/extra').touch()
  with self.assertRaises(F.Refused):F.exact_children(root,rows)
 def copied(self):
  src={'path':'f','kind':'file','sha256':'a'*64,'metadata':metadata()};o={'entries':[src],'entryCount':1,'regularBytes':10};c=copy.deepcopy(o);return c,o
 def test_copy_values_and_order_preserved(self):
  c,o=self.copied();self.assertEqual(F.validate_copied(c,o),c)
 def test_copy_hash_mode_owner_counts_and_unknown_fields_refuse(self):
  for mutate in [lambda c:c.__setitem__('entryCount',2),lambda c:c.__setitem__('regularBytes',11),lambda c:c['entries'][0].__setitem__('sha256','b'*64),lambda c:c['entries'][0]['metadata'].__setitem__('uid',1000),lambda c:c['entries'][0]['metadata'].__setitem__('mode',0o644),lambda c:c['entries'][0].__setitem__('extra',True)]:
   c,o=self.copied();mutate(c)
   with self.assertRaises(F.Refused):F.validate_copied(c,o)
 def test_true_empty_source_byte_file_permitted(self):
  c,o=self.copied();c['regularBytes']=o['regularBytes']=0;c['entries'][0]['metadata']['bytes']=o['entries'][0]['metadata']['bytes']='0';self.assertEqual(F.validate_copied(c,o)['regularBytes'],0)
 def fake_newfile(self,p,raw,mode=0o440,uid=0,gid=112):return self.real_newfile(p,raw,mode,os.getuid(),os.getgid())
 def pipeline(self,props=None,wrong_typed=False,stop_refuse=False,stdout=None,stderr=b''):
  self.real_newfile=F.C.newfile;out=F.encode({'uid':108,'gid':112,'entries':1,'allSourceAndDependenciesReadable':True})if stdout is None else stdout
  responses=iter([{'LoadState':'not-found','MainPID':'0','InvocationID':'','ActiveState':'inactive','SubState':'dead'},props or properties()])
  def launch(argv,*a,**kw):
   (self.package/F.STDOUT).write_bytes(out);(self.package/F.STDERR).write_bytes(stderr);return b''
  stop=M.Mock(side_effect=F.Refused('STOP_REFUSED')if stop_refuse else None,return_value={'attempted':True,'ownedInvocation':'a'*32,'unitStopVerified':True})
  stack=[M.patch.object(F.C,'newfile',side_effect=self.fake_newfile),M.patch.object(F,'show',side_effect=lambda:next(responses)),M.patch.object(F.C,'run_checked',side_effect=launch),M.patch.object(F,'typed_start',side_effect=F.Refused('BAD_COMMAND')if wrong_typed else None,return_value={'argvSHA256':'e'*64}),M.patch.object(F,'capture_read',side_effect=lambda n,m:(self.package/n).read_bytes()),M.patch.object(F,'stop_owned',stop)]
  return stack,stop
 def apply(self,patches):
  for p in patches:p.start();self.addCleanup(p.stop)
 def test_async_success_retained_snapshot_and_owned_stop(self):
  patches,stop=self.pipeline();self.apply(patches);v=F.readability({'entryCount':1});self.assertTrue(v['remainAfterExitStopped']);self.assertEqual(v['actualRetainedUnitProperties']['ActiveState'],'active');stop.assert_called_once();self.assertEqual(F.OWNED,'a'*32)
 def test_weak_resources_records_ownership_before_refusal(self):
  p=properties();p['MemoryMax']='infinity';patches,stop=self.pipeline(p);self.apply(patches)
  with self.assertRaises(Exception):F.readability({'entryCount':1})
  self.assertEqual(F.OWNED,'a'*32);stop.assert_not_called()
 def test_wrong_command_never_records_ownership(self):
  patches,stop=self.pipeline(wrong_typed=True);self.apply(patches)
  with self.assertRaises(F.Refused):F.readability({'entryCount':1})
  self.assertIsNone(F.OWNED);stop.assert_not_called()
 def test_native_refusal_stdout_or_stderr_no_green(self):
  for name,value in [('stdout',b'{"uid":0}'),('stderr',b'private error')]:
   with self.subTest(name=name):
    for f in (F.STDOUT,F.STDERR):(self.package/f).unlink(missing_ok=True)
    patches,stop=self.pipeline(**{name:value})
    for p in patches:p.start()
    try:
     with self.assertRaises(F.Refused):F.readability({'entryCount':1})
     stop.assert_not_called()
    finally:
     for p in reversed(patches):p.stop()
 def test_stop_refusal_no_native_acceptance(self):
  patches,stop=self.pipeline(stop_refuse=True);self.apply(patches)
  with self.assertRaises(F.Refused):F.readability({'entryCount':1})
 def test_preexisting_unit_refuses_before_capture_creation(self):
  with M.patch.object(F,'show',return_value=properties()),self.assertRaises(F.Refused):F.readability({'entryCount':1})
  self.assertFalse((self.package/F.STDOUT).exists());self.assertIsNone(F.OWNED)
 def test_existing_manifest_or_evidence_never_overwritten(self):
  (self.package/'source-copy-manifest.json').write_bytes(b'keep');c,o=self.copied()
  with M.patch.object(F,'initial_fence',return_value=(o,c)),self.assertRaises(F.Refused):F.execute(request())
  self.assertEqual((self.package/'source-copy-manifest.json').read_bytes(),b'keep');self.assertFalse((self.package/F.INTENT).exists())
 def test_final_source_drift_no_manifest(self):
  c,o=self.copied();self.real_newfile=F.C.newfile
  with M.patch.object(F,'initial_fence',side_effect=[(o,c),F.Refused('SOURCE_DRIFT')]),M.patch.object(F,'show',return_value={'LoadState':'not-found','MainPID':'0','InvocationID':'','ActiveState':'inactive','SubState':'dead'}),M.patch.object(F.C,'newfile',side_effect=self.fake_newfile),M.patch.object(F,'readability',return_value={}):
   with self.assertRaises(F.Refused):F.execute(request())
  self.assertFalse((self.package/'source-copy-manifest.json').exists());self.assertTrue((self.package/F.INTENT).exists())
 def test_completion_only_after_stop_and_final_byte_fence(self):
  c,o=self.copied();self.real_newfile=F.C.newfile;native={'InvocationID':'a'*32,'ownedStop':{'unitStopVerified':True}};events=[]
  def fence(r):events.append('fence');return o,c
  def readonly(c):events.append('stopped');return native
  def write(p,*a,**kw):events.append(p.name);return self.fake_newfile(p,*a,**kw)
  with M.patch.object(F,'initial_fence',side_effect=fence),M.patch.object(F,'show',return_value={'LoadState':'not-found','MainPID':'0','InvocationID':'','ActiveState':'inactive','SubState':'dead'}),M.patch.object(F,'readability',side_effect=readonly),M.patch.object(F.C,'newfile',side_effect=write):v=F.execute(request())
  self.assertEqual(events,['fence',F.INTENT,'stopped','fence','source-copy-manifest.json',F.COMPLETED]);self.assertTrue(v['priorAttemptRemainsFailed']);self.assertFalse((self.package/'source-copy-completed.json').exists());self.assertEqual(json.loads((self.package/'source-copy-manifest.json').read_bytes())['schema'],'pow-audit30-onhost-math-source-copy-v1')
 def test_repeat_signal_cleanup_ignores_then_restores_in_fixture(self):
  old={s:signal.getsignal(s) for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP)};F.OWNED='a'*32
  def stop():
   os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGINT);return {'unitStopVerified':True}
  try:
   with M.patch.object(F,'stop_owned',side_effect=stop):F.failure_cleanup()
   self.assertTrue(all(signal.getsignal(s)==signal.SIG_IGN for s in old))
  finally:
   for s,h in old.items():signal.signal(s,h)
 def test_cleanup_after_expired_work_deadline_still_stops_exact_owned(self):
  F.OWNED='a'*32;F.C.DEADLINE=time.monotonic()-1
  with M.patch.object(F.C,'owned_stop',return_value={'ownedInvocation':'a'*32,'unitStopVerified':True})as stop:
   self.assertTrue(F.stop_owned()['unitStopVerified']);stop.assert_called_once_with('a'*32)
 def test_launch_interruption_before_first_observation_recovers_typed_owned(self):
  F.LAUNCH_ATTEMPTED=True;F.C.DEADLINE=time.monotonic()-1;p=properties();p['ControlGroup']='';p['MemoryMax']='infinity'
  with M.patch.object(F,'cleanup_show',return_value=p),M.patch.object(F,'typed_start',return_value={'argvSHA256':'e'*64})as typed:
   F.recover_owned_after_launch()
  self.assertEqual(F.OWNED,'a'*32);typed.assert_called_once_with(F.cleanup_typed_command)
 def test_cleanup_recovery_wrong_typed_command_never_owns_or_stops(self):
  F.LAUNCH_ATTEMPTED=True
  with M.patch.object(F,'cleanup_show',return_value=properties()),M.patch.object(F,'typed_start',side_effect=F.Refused('WRONG_CODE')):
   with self.assertRaises(F.Refused):F.recover_owned_after_launch()
  self.assertIsNone(F.OWNED)
 def test_cleanup_recovery_no_launch_never_queries_foreign_unit(self):
  with M.patch.object(F,'cleanup_show')as show:F.recover_owned_after_launch()
  show.assert_not_called()
 def test_actual_child_postlaunch_recovery_survives_repeated_ordinary_signals(self):
  code="""import importlib.util,json,os,pathlib,signal,time
sp=importlib.util.spec_from_file_location('F','/tmp/pow-audit30-onhost-math-source-finalize-v2.py');F=importlib.util.module_from_spec(sp);sp.loader.exec_module(F)
F.C=F.load_utility(pathlib.Path('/tmp/pow-audit30-onhost-math-source-copy-v3.py').read_bytes());F.C.DEADLINE=time.monotonic()-1;F.LAUNCH_ATTEMPTED=True
u={'LoadState':'loaded','Type':'oneshot','Transient':'yes','ControlGroup':'','MainPID':'0','ActiveState':'active','SubState':'exited','Result':'success','ExecMainStatus':'0','User':'postgres','Group':'postgres','InvocationID':'a'*32,'ExecStart':str(F.C.NODE)+' '+str(F.PACKAGE/'read-copy.mjs')}
F.cleanup_show=lambda:u;F.typed_start=lambda command=None:{'argvSHA256':'e'*64}
def stop(inv):
 os.kill(os.getpid(),signal.SIGTERM);os.kill(os.getpid(),signal.SIGINT);return {'ownedInvocation':inv,'unitStopVerified':True}
F.C.owned_stop=stop;F.failure_cleanup();print(json.dumps({'owned':F.OWNED,'cleanup':F.CLEANUP}))
"""
  proc=subprocess.run([sys.executable,'-I','-B','-c',code],capture_output=True,timeout=5)
  self.assertEqual(proc.returncode,0);self.assertEqual(proc.stderr,b'');out=json.loads(proc.stdout);self.assertEqual(out['owned'],'a'*32);self.assertTrue(out['cleanup']['unitStopVerified'])
 def test_cleanup_recovery_after_gc_records_absence_without_default_success(self):
  F.LAUNCH_ATTEMPTED=True
  with M.patch.object(F,'cleanup_show',return_value={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':''}):F.recover_owned_after_launch()
  self.assertIsNone(F.OWNED);self.assertTrue(F.CLEANUP['unitAlreadyAbsent']);self.assertFalse((self.package/'source-copy-manifest.json').exists())
 def test_cleanup_fixed_dbus_refuses_arbitrary_method_or_host(self):
  for a in [['/usr/bin/busctl','--system','call','other'],['/bin/sh','-c','anything']]:
   with M.patch.object(F.C.subprocess,'Popen')as popen,self.assertRaises(F.Refused):F.cleanup_typed_command(a)
   popen.assert_not_called()
 def test_no_owned_identity_does_not_stop_foreign_unit(self):
  with M.patch.object(F.C,'owned_stop')as stop,self.assertRaises(F.Refused):F.stop_owned()
  stop.assert_not_called()
 def test_originals_source_and_prior_failure_are_never_deleted(self):
  src=P('/tmp/pow-audit30-onhost-math-source-finalize-v2.py').read_text();self.assertNotIn('shutil',src);self.assertNotIn('.unlink(',src);self.assertNotIn('copy_tree(',src);self.assertNotIn('os.chmod(',src);self.assertNotIn('os.chown(',src);self.assertNotIn('--wait',src)
 def test_literal_copied_census_never_imports_application_modules(self):
  self.assertEqual(F.C.READABILITY.count('import '),2);self.assertNotIn('import(',F.C.READABILITY);self.assertNotIn('child_process',F.C.READABILITY);self.assertNotIn('psql',F.C.READABILITY)
if __name__=='__main__':unittest.main()
