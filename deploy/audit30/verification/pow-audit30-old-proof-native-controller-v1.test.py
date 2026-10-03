import base64,copy,importlib.util,json,os,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('N','/tmp/pow-audit30-old-proof-native-controller-v1.py');N=importlib.util.module_from_spec(s);s.loader.exec_module(N)
def row():
 d={k:''for k in N.FIELDS};d.update(LoadState='loaded',ActiveState='active',SubState='running',MainPID='777',InvocationID='a'*32,Type='exec',Transient='yes',RemainAfterExit='yes',User='postgres',Group='postgres',ControlGroup='/system.slice/'+N.UNIT,Result='success',ExecMainStatus='0',CPUQuotaPerSecUSec='250ms',CPUWeight='10',IOWeight='10',Nice='15',MemoryHigh=str(96*1024**2),MemoryMax=str(128*1024**2),MemorySwapMax='0',TasksMax='16',RuntimeMaxUSec='6min',TimeoutStopUSec='30s',LimitFSIZE=str(32*1024**2))
 for k in('KillMode','Restart','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadOnlyPaths','ReadWritePaths','InaccessiblePaths','StandardInput','UMask'):d[k]=N.PROPS[k]
 d.update(StandardOutput='append',StandardError='append',FragmentPath='/run/systemd/transient/'+N.UNIT);return d
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
  return {'type':'o','data':['/org/freedesktop/systemd1/unit/fixed_2eservice']},{'type':'a(sasbttttuii)','data':[[N.ARGV[0],N.ARGV,False,0,0,0,0,0,0,0]]}
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
  service.update(ActiveState='inactive',MainPID='0');next_=(N.datetime.datetime.now(N.datetime.timezone.utc)+N.datetime.timedelta(seconds=60)).strftime('%a %Y-%m-%d %H:%M:%S UTC');timer={'LoadState':'loaded','ActiveState':'active','NextElapseUSecRealtime':next_}
  with patch.object(N,'show',side_effect=[service,timer]),self.assertRaises(ValueError):N.quiet()
 def request(self):
  src=Path('/tmp/pow-audit30-old-backup-cluster-readonly-proof-v2.py').read_bytes();return N.encoded(dict(schema='pow-audit30-old-retirement-readonly-native-request-v1',approvalSha256=N.APPROVAL,sourceSha256=N.SOURCE_SHA,sourceBase64=base64.b64encode(src).decode(),unit=N.UNIT,directory=str(N.DIRECTORY)))
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
if __name__=='__main__':unittest.main()
