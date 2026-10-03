import ast,stat,base64,copy,importlib.util,json,os,signal,sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('N','/tmp/pow-audit30-oct2-full-read-native-v2.py');N=importlib.util.module_from_spec(s);s.loader.exec_module(N)
def row():
 d={k:''for k in N.FIELDS};d.update(LoadState='loaded',ActiveState='active',SubState='running',MainPID='777',InvocationID='a'*32,Type='exec',Transient='yes',RemainAfterExit='yes',User='postgres',Group='postgres',ControlGroup='/system.slice/'+N.UNIT,Result='success',ExecMainStatus='0',CPUQuotaPerSecUSec='250ms',CPUWeight='10',IOWeight='10',Nice='15',MemoryHigh=str(96*1024**2),MemoryMax=str(128*1024**2),MemorySwapMax='0',TasksMax='16',RuntimeMaxUSec='6min',TimeoutStopUSec='30s',LimitFSIZE=str(32*1024**2))
 for k in('KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','UMask'):d[k]=N.PROPS[k]
 d.update(StandardOutput='append',StandardError='append',FragmentPath='/run/systemd/transient/'+N.UNIT);return d
def live():return {name:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID='777',InvocationID='a'*32)for name in N.LIVE}
def protected():
 files={str(p):{'metadata':dict(N.LOCK_EXPECTED),'sha256':N.FIXED_HASHES.get(str(p),'b'*64)}for p in N.STATIC}
 mask={'metadata':dict(N.LOCK_EXPECTED),'target':'/dev/null'}
 units={name:{k:''for k in N.PROTECTED_FIELDS_BY_UNIT[name]}for name in N.PROTECTED}
 units[N.PRUNE].update(json.loads(Path('/tmp/pow-audit30-oct2-prune-timer-actual-response-fixture-v1.json').read_bytes())['returnedProperties'])
 units['pg_receivewal@16-main.service'].update(LoadState='loaded',ActiveState='inactive',MainPID='0')
 return {'files':files,'mask':mask,'units':units}
def historical_proof():
 v=json.loads(Path('/tmp/pow-audit30-latest-backup-full-read-v2.json').read_bytes());v['atUtc']=N.datetime.datetime.now(N.datetime.timezone.utc).isoformat()
 def m(row):return {('dev'if k=='device'else'ino'if k=='inode'else k):v for k,v in row.items()if k!='sha256'}
 before={'directory':m(v['backup']['directory']),'members':{k:m(row)for k,row in v['backup']['members'].items()},'backupLock':m(v['backupLock'])}
 return v,before
class Tests(unittest.TestCase):
 def setUp(self):N.DEADLINE=time.monotonic()+420;N.OWNED=None;N.LAUNCHED=False;N.ARGV=['/usr/bin/python3','-I','-B','-c','fixed source']
 def test_exact_resources_and_namespace_refuse_weakening(self):
  d=row();N.validate_resources(d)
  for k,v in [('MemoryMax','999999999'),('MemorySwapMax','1'),('CPUQuotaPerSecUSec','1s'),('RuntimeMaxUSec','1h'),('ReadWritePaths','/data'),('PrivateNetwork','no'),('InaccessiblePaths',''),('StandardOutput','append:/other'),('LimitFSIZE','infinity')]:
   with self.subTest(k=k),self.assertRaises(ValueError):N.validate_resources(d|{k:v})
 def test_retained_success_empty_cgroup_only_pid_zero(self):
  d=row()|{'MainPID':'0','ActiveState':'active','SubState':'exited','ControlGroup':''};N.identity(d)
  for k,v in [('MainPID','5'),('SubState','running'),('Result','signal'),('ExecMainStatus','15'),('Type','simple'),('User','root')]:
   with self.subTest(k=k),self.assertRaises(ValueError):N.identity(d|{k:v})
 def test_failed_empty_cgroup_only_previously_owned_cleanup_never_success(self):
  d=row()|{'MainPID':'0','ActiveState':'failed','SubState':'failed','ControlGroup':'','Result':'exit-code','ExecMainStatus':'1'}
  with self.assertRaises(ValueError):N.identity(d)
  with self.assertRaises(ValueError):N.identity(d,None,True)
  N.identity(d,'a'*32,True)
  with self.assertRaises(ValueError):N.identity(d,'b'*32,True)
 def test_notfound_defaults_never_resource_success(self):
  d={k:''for k in N.FIELDS};d.update(LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID='');N.absent(d)
  with self.assertRaises(ValueError):N.identity(d)
  with self.assertRaises(ValueError):N.validate_resources(d)
 def typed_rows(self):
  return {'type':'o','data':['/org/freedesktop/systemd1/unit/'+''.join(c if c.isascii()and c.isalnum()else'_'+format(ord(c),'02x')for c in N.UNIT)]},{'type':'a(sasbttttuii)','data':[[N.ARGV[0],N.ARGV,False,0,0,0,0,0,0,0]]}
 def test_typed_execstart_exact_rolesource_command(self):
  m,e=self.typed_rows()
  with patch.object(N,'command',side_effect=[N.encoded(m),N.encoded(e)]):self.assertIn('argvSha256',N.typed())
  for k in('program','argv','duplicate','ignore','signature'):
   bad=copy.deepcopy(e)
   if k=='program':bad['data'][0][0]='/bin/sh'
   elif k=='argv':bad['data'][0][1]=N.ARGV[:-1]+['different code']
   elif k=='duplicate':bad['data']*=2
   elif k=='ignore':bad['data'][0][2]=True
   else:bad['type']='s'
   with self.subTest(k=k),patch.object(N,'command',side_effect=[N.encoded(m),N.encoded(bad)]),self.assertRaises(ValueError):N.typed()
 def fragment_text(self):return ('[Unit]\nDescription=audit\n[Service]\n'+'\n'.join(k+'='+N.PROPS[k]for k in('StandardInput','StandardOutput','StandardError'))+'\n').encode()
 def test_fragment_exact_paths_and_no_duplicate_override(self):
  raw=self.fragment_text();d=row()
  with patch.object(N,'read_file',return_value=(raw,{})):self.assertEqual(N.fragment(d)['selectedDirectives']['StandardOutput'],N.PROPS['StandardOutput'])
  for b in (raw+b'StandardOutput=append:/other\n',raw.replace(b'[Service]',b'[Unit]'),raw.replace(N.PROPS['StandardOutput'].encode(),b'append:/other'),raw.replace(b'StandardInput=null',b'StandardInput=null\\')):
   with patch.object(N,'read_file',return_value=(b,{})),self.assertRaises(ValueError):N.fragment(d)
  with self.assertRaises(ValueError):N.fragment(d|{'DropInPaths':'/etc/extra.conf'})
 def test_wrong_invocation_cleanup_never_stops(self):
  N.OWNED='a'*32;d=row()|{'InvocationID':'b'*32}
  with patch.object(N,'show',return_value=d),patch.object(N,'command')as command,self.assertRaises(ValueError):N.owned_stop()
  command.assert_not_called()
 def test_cleanup_after_workdeadline_is_independent_and_own_only(self):
  N.DEADLINE=0;N.OWNED='a'*32;before=row()|{'MainPID':'0','SubState':'exited','ControlGroup':''};after=before|{'ActiveState':'inactive','SubState':'dead'}
  with patch.object(N,'show',side_effect=[before,after])as show,patch.object(N,'typed',return_value={'fixed':True})as typed,patch.object(N,'command',return_value=b'')as command:r=N.owned_stop()
  self.assertTrue(r['verified']);typed.assert_called_once_with(True);command.assert_called_once_with(['/usr/bin/systemctl','stop',N.UNIT],True);self.assertTrue(show.call_args_list[0].args[-1])
 def test_backup_active_or_short_window_refuses(self):
  service={'LoadState':'loaded','ActiveState':'active','SubState':'running','MainPID':'9','InvocationID':'a'*32}
  with patch.object(N,'show',return_value=service),self.assertRaises(ValueError):N.quiet()
  service.update(ActiveState='inactive',MainPID='0');next_=(N.datetime.datetime.now(N.datetime.timezone.utc)+N.datetime.timedelta(seconds=60)).strftime('%a %Y-%m-%d %H:%M:%S UTC');timer={'LoadState':'loaded','ActiveState':'active','SubState':'waiting','UnitFileState':'enabled','InvocationID':'b'*32,'NextElapseUSecRealtime':next_}
  with patch.object(N,'show',side_effect=[service,timer]),self.assertRaises(ValueError):N.quiet()
 def request(self):
  src=Path('/tmp/pow-audit30-latest-backup-full-read-v1.py').read_bytes();return N.encoded(dict(schema='pow-audit30-oct2-full-read-native-request-v1',approvalSha256=N.APPROVAL,sourceSha256=N.SOURCE_SHA,sourceBase64=base64.b64encode(src).decode(),unit=N.UNIT,directory=str(N.DIRECTORY),expectedLive=live(),expectedProtection=protected()))
 def test_preexisting_unit_refuses_before_evidence_or_service_launch(self):
  with tempfile.TemporaryDirectory()as t:
   directory=Path(t)/'new';raw=self.request();r=N.parse(raw);r['directory']=str(directory);raw=N.encoded(r)
   with patch.object(N,'DIRECTORY',directory),patch.object(N.os,'geteuid',return_value=0),patch.object(N.os,'getegid',return_value=0),patch.object(N.os,'uname',return_value=types.SimpleNamespace(nodename=N.HOST)),patch.object(N.sys,'argv',['tool',N.sha(raw)]),patch.object(N.sys,'stdin',types.SimpleNamespace(buffer=types.SimpleNamespace(read=lambda _:raw))),patch.object(N,'show',return_value=row()),patch.object(N,'command')as cmd,self.assertRaises(ValueError):N.main()
   self.assertFalse(directory.exists());cmd.assert_not_called()
 def test_source_and_authority_tampering_refused_before_unit_access(self):
  for field,value in [('approvalSha256','e'*64),('sourceSha256','e'*64),('sourceBase64',base64.b64encode(b'other code').decode()),('unit','other.service')]:
   r=N.parse(self.request());r[field]=value;raw=N.encoded(r)
   with self.subTest(field=field),patch.object(N.os,'geteuid',return_value=0),patch.object(N.os,'getegid',return_value=0),patch.object(N.os,'uname',return_value=types.SimpleNamespace(nodename=N.HOST)),patch.object(N.sys,'argv',['tool',N.sha(raw)]),patch.object(N.sys,'stdin',types.SimpleNamespace(buffer=types.SimpleNamespace(read=lambda _:raw))),patch.object(N,'show')as show,self.assertRaises(ValueError):N.main()
   show.assert_not_called()
 def test_scope_source_pins_old_only_and_no_live_actions(self):
  src=Path(N.__file__).read_text();self.assertIn(N.SOURCE_SHA,src);self.assertNotIn('pg_ctl',src);self.assertNotIn('psql',src);self.assertNotIn('getblock',src);self.assertNotIn('scantxoutset',src);self.assertNotIn('flock',src);self.assertEqual(N.PROPS['ReadWritePaths'],'');self.assertIn('/var/lib/postgresql',N.PROPS['InaccessiblePaths'])
 def test_null_fresh_placeholders_and_open_schema_refuse_before_unit_access(self):
  for field in('expectedLive','expectedProtection'):
   v=N.parse(self.request());v[field]=None
   with self.subTest(field=field),self.assertRaises(ValueError):N.decode_request(N.encoded(v))
  v=N.parse(self.request());v['extra']=True
  with self.assertRaises(ValueError):N.decode_request(N.encoded(v))
 def test_fixed_old_pin_checker_and_unknown_file_metadata_refuse(self):
  v=N.parse(self.request());N.decode_request(N.encoded(v))
  for field in('sha','meta','extra','mask'):
   bad=copy.deepcopy(v)
   if field=='sha':bad['expectedProtection']['files'][str(N.PIN)]['sha256']='0'*64
   elif field=='meta':bad['expectedProtection']['files'][str(N.PIN)]['metadata']['nlink']='1'
   elif field=='extra':bad['expectedProtection']['files']['/etc/arbitrary']={}
   else:bad['expectedProtection']['mask']['target']='/other'
   with self.subTest(field=field),self.assertRaises(ValueError):N.decode_request(N.encoded(bad))
 def test_typed_wrong_unit_object_refuses_before_property_lookup(self):
  m,e=self.typed_rows();m['data'][0]+='_wrong'
  with patch.object(N,'command',return_value=N.encoded(m))as c,self.assertRaises(ValueError):N.typed()
  self.assertEqual(c.call_count,1)
 def test_exact_historical_197_toc_all_members_result_and_nlink(self):
  v,b=historical_proof();self.assertTrue(N.proof_result(v,b)['exact197EntryTocVerified'])
  for kind in('tocbytes','toctext','entry','hash','link','member','manifest','lock','age','secretflag','mutation'):
   bad=copy.deepcopy(v)
   if kind=='tocbytes':bad['toc']['bytes']+=1
   elif kind=='toctext':bad['toc']['text']+='x'
   elif kind=='entry':bad['toc']['entries']=196
   elif kind=='hash':bad['backup']['members']['proof_indexer.dump']['sha256']='0'*64
   elif kind=='link':bad['backup']['members']['proof_indexer.dump']['nlink']=2
   elif kind=='member':bad['backup']['members']['unexpected']={}
   elif kind=='manifest':bad['checksumManifest']+='x'
   elif kind=='lock':bad['backupLock']['inode']+=1
   elif kind=='age':bad['atUtc']=(N.datetime.datetime.now(N.datetime.timezone.utc)-N.datetime.timedelta(seconds=901)).isoformat()
   elif kind=='secretflag':bad['globalsContentsEmitted']=True
   else:bad['productionDataMutation']=True
   with self.subTest(kind=kind),self.assertRaises(ValueError):N.proof_result(bad,b)
 def test_real_custom_sigint_sigterm_propagates_through_blocked_subprocess_and_reaps(self):
  for sig in(signal.SIGINT,signal.SIGTERM):
   old=signal.signal(sig,lambda n,f:(_ for _ in()).throw(N.Oct2ReadInterrupted('fixture-interrupted')))
   with tempfile.TemporaryDirectory()as t:
    ready=Path(t)/'ready';errors=[]
    def send():
     until=time.monotonic()+2
     while not ready.exists()and time.monotonic()<until:time.sleep(.005)
     if not ready.exists():errors.append('not-ready');return
     os.kill(os.getpid(),sig)
    th=threading.Thread(target=send);th.start()
    try:
     with self.assertRaises(N.Oct2ReadInterrupted):N.command([sys.executable,'-I','-B','-c','import os,pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(4)',str(ready)])
     th.join();self.assertEqual(errors,[])
     with self.assertRaises(ProcessLookupError):os.kill(int(ready.read_text()),0)
    finally:th.join();signal.signal(sig,old)
 def test_exact_setter_paths_retained_while_observer_enums_only(self):
  self.assertEqual(N.PROPS['StandardOutput'],'append:'+str(N.OUT));self.assertEqual(N.PROPS['StandardError'],'append:'+str(N.ERR));self.assertEqual(N.PROPS['ReadOnlyPaths'],' '.join(N.RO));self.assertIn(str(N.JOBS[0]),N.DENIED);N.validate_resources(row())
 def test_backup_15min_clear_window_and_enabled_waiting_required(self):
  service={'LoadState':'loaded','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':'a'*32}
  def timer(seconds):return dict(LoadState='loaded',ActiveState='active',SubState='waiting',UnitFileState='enabled',InvocationID='b'*32,NextElapseUSecRealtime=(N.datetime.datetime.now(N.datetime.timezone.utc)+N.datetime.timedelta(seconds=seconds)).strftime('%a %Y-%m-%d %H:%M:%S UTC'))
  with patch.object(N,'show',side_effect=[service,timer(901)]):N.quiet()
  for d in(timer(899),timer(2000)|{'UnitFileState':'disabled'},timer(2000)|{'SubState':'elapsed'}):
   with patch.object(N,'show',side_effect=[service,d]),self.assertRaises(ValueError):N.quiet()
 def test_protection_snapshot_preimage_drift_and_exact_mask_refuse(self):
  expected=protected()
  def file(p,cap):
   mode=0o755 if p in(N.CHECKER,N.STATIC[4])else 0o600 if p==N.STATIC[2]else 0o644
   b=b'proof_indexer-20260929T031853Z.dumpset\n'if p==N.PIN else b'fixed-public';m=dict(N.LOCK_EXPECTED,mode=mode);expected['files'][str(p)]={'metadata':m,'sha256':N.sha(b)};return b,m
  for p in N.STATIC:file(p,0)
  symlink=types.SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_uid=0,st_gid=0);expected['mask']={'metadata':dict(N.LOCK_EXPECTED),'target':'/dev/null'}
  with patch.object(N,'read_file',side_effect=file),patch.object(Path,'lstat',return_value=symlink),patch.object(Path,'resolve',side_effect=lambda *a,**k:N.MASK.parent),patch.object(N,'metadata',return_value=dict(N.LOCK_EXPECTED)),patch.object(N.os,'readlink',return_value='/dev/null'),patch.object(N.os,'listxattr',return_value=[]),patch.object(N,'show',side_effect=lambda name,fields:expected['units'][name]):self.assertEqual(N.protection(expected),expected)
  with patch.object(N,'read_file',return_value=(b'unknown',dict(N.LOCK_EXPECTED,mode=0o644))),self.assertRaises(ValueError):N.protection(expected)
 def test_leaf_bytes_original_wrapper_and_old_evidence_remain_unchanged(self):
  self.assertEqual(N.sha(Path('/tmp/pow-audit30-latest-backup-full-read-v1.py').read_bytes()),N.SOURCE_SHA)
  self.assertEqual(N.sha(Path('/tmp/pow-audit30-old-proof-native-controller-v1.py').read_bytes()),'b6cdf0f1fe78e4124a3afc1c8abd25247708e32d55cab7a454075bdd082b3837')
  self.assertEqual(N.sha(Path('/tmp/pow-audit30-latest-backup-full-read-v2.json').read_bytes()),'cd18bed6a2141f500dc446d1ab167acbd8043b28c482b5e3d364f93abc67f5a2')
 def test_real_backup_metadata_exact_children_no_alias_hardlink_or_xattr(self):
  with tempfile.TemporaryDirectory()as t:
   backup=Path(t)/'oct2';backup.mkdir(mode=0o700);lock=Path(t)/'lock';lock.write_bytes(b'');lock.chmod(0o600)
   for name in('proof_indexer.dump','globals.sql','SHA256SUMS'):(backup/name).write_bytes(b'fixed');(backup/name).chmod(0o600)
   def leafmeta(p):
    m=N.metadata(p.lstat());return {('device'if k=='dev'else'inode'if k=='ino'else k):(oct(v)if k=='mode'else v)for k,v in m.items()}
   expected=leafmeta(backup)|{'path':str(backup),'members':[leafmeta(p)|{'path':str(p)}for p in sorted(backup.iterdir())]};source=('EXPECTED='+repr(expected)).encode();lockmeta=N.metadata(lock.lstat())
   with patch.object(N,'BACKUP',backup),patch.object(N,'LOCK',lock),patch.object(N,'LOCK_EXPECTED',lockmeta):
    before=N.backup_metadata(source);self.assertEqual(set(before['members']),{'proof_indexer.dump','globals.sql','SHA256SUMS'})
    extra=backup/'extra';extra.write_bytes(b'x')
    with self.assertRaises(ValueError):N.backup_metadata(source)
    extra.unlink();os.link(backup/'globals.sql',Path(t)/'alias')
    with self.assertRaises(ValueError):N.backup_metadata(source)
 def test_real_capture_no_follow_no_xattr_and_inode_alias_refusal(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t)/'capture';p.write_bytes(b'public');p.chmod(0o600);original=Path.lstat
   def owned(path,*a,**kw):
    st=original(path,*a,**kw);d={k:getattr(st,k)for k in dir(st)if k.startswith('st_')};d['st_uid']=d['st_gid']=0;return types.SimpleNamespace(**d)
   original_meta=N.metadata
   def rooted(st):d=original_meta(st);d['uid']=d['gid']=0;return d
   with patch.object(Path,'lstat',owned),patch.object(N,'metadata',side_effect=rooted):
    raw,m=N.read_file(p,20);self.assertEqual(raw,b'public');self.assertEqual(N.read_file(p,20,m),(raw,m));os.link(p,Path(t)/'alias')
    with self.assertRaises(ValueError):N.read_file(p,20)
 def actual_timer(self):
  path=Path('/tmp/pow-audit30-node-release-read-only-preflight-v4.json.stdout');raw=path.read_bytes();self.assertEqual(len(raw),9220);self.assertEqual(N.sha(raw),'64a4c800c7a4cf8a1dfa3e697fd6c401e01169be0e23146879360402babbac41');row=json.loads(raw)['units'][N.PRUNE];return {k:row[k]for k in N.PROTECTED_FIELDS_BY_UNIT[N.PRUNE]}
 def test_sha_bound_actual_timer_response_succeeds_without_mainpid(self):
  d=self.actual_timer();self.assertNotIn('MainPID',d);wire=''.join(k+'='+v+'\n'for k,v in d.items()).encode()
  with patch.object(N,'command',return_value=wire):self.assertEqual(N.show(N.PRUNE,N.PROTECTED_FIELDS_BY_UNIT[N.PRUNE]),d)
 def test_original_772_missing_field_refusal_reproduced_by_actual5_response(self):
  spec=importlib.util.spec_from_file_location('preserved772','/tmp/pow-audit30-oct2-full-read-native-v1.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);d=self.actual_timer();wire=''.join(k+'='+v+'\n'for k,v in d.items()).encode()
  with patch.object(m,'command',return_value=wire),self.assertRaises(ValueError)as e:m.show(m.PRUNE,m.PROTECTED_FIELDS)
  self.assertEqual(m.sha(str(e.exception).encode()),'e5706bf8925b07c72e5d4e848169f3f8fcf05d37c105ef98ba12fa091006b17a')
 def test_each_exact_profile_missing_unknown_or_duplicate_refuses(self):
  for name in N.PROTECTED:
   d=self.actual_timer()if name==N.PRUNE else protected()['units'][name]
   # service fields remain exactsix and do not inherit timer omission
   self.assertEqual(len(d),5 if name==N.PRUNE else 6)
   text=''.join(k+'='+v+'\n'for k,v in d.items())
   with patch.object(N,'command',return_value=text.encode()):N.show(name,N.PROTECTED_FIELDS_BY_UNIT[name])
   for b in(text.split('\n',1)[1],text+'Unknown=0\n',text+next(iter(d))+'=duplicate\n'):
    with self.subTest(name=name),patch.object(N,'command',return_value=b.encode()),self.assertRaises(ValueError):N.show(name,N.PROTECTED_FIELDS_BY_UNIT[name])
 def test_decode_cannot_fake_mainpid_for_timer_or_drop_it_for_service(self):
  for name in N.PROTECTED:
   r=N.parse(self.request());row=r['expectedProtection']['units'][name]
   if name==N.PRUNE:row['MainPID']='0'
   else:del row['MainPID']
   with self.subTest(name=name),self.assertRaises(ValueError):N.decode_request(N.encoded(r))
 def test_other_native_functions_ast_unchanged_all_caps_and_private_namespace(self):
  def functions(path):return {x.name:ast.dump(x,include_attributes=False)for x in ast.parse(Path(path).read_bytes()).body if isinstance(x,ast.FunctionDef)}
  old=functions('/tmp/pow-audit30-oct2-full-read-native-v1.py');new=functions('/tmp/pow-audit30-oct2-full-read-native-v2.py');self.assertEqual(set(old),set(new))
  for name in old:
   if name not in('decode_request','protection'):self.assertEqual(old[name],new[name],name)
  self.assertEqual(N.PROPS['RuntimeMaxSec'],'6min');self.assertEqual(N.PROPS['MemoryMax'],'128M');self.assertEqual(N.SOURCE_SHA,'6bafcdb48b1fd0c8da0c23169906f7cd96fbeb374b0333b9c7ca349988abc869')
if __name__=='__main__':unittest.main()
