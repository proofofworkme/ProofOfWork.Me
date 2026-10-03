import importlib.util,pathlib,tempfile,unittest,os,sys,hashlib,unittest.mock as M,signal,subprocess,time
P=pathlib.Path;sp=importlib.util.spec_from_file_location('copyc','/tmp/pow-audit30-onhost-math-source-copy-v1.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
class Tests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(prefix='pow-audit30-code-copy-fixture-');self.base=P(self.t.name);self.source=self.base/'source';self.source.mkdir();(self.source/'server').mkdir();(self.source/'server/a.mjs').write_bytes(b'import x from "pg";');(self.source/'node_modules').mkdir();(self.source/'node_modules/pkg').mkdir();(self.source/'node_modules/pkg/index.js').write_bytes(b'module.exports=42;');(self.source/'node_modules/pkg/empty').touch();(self.source/'node_modules/.bin').mkdir();os.symlink('../pkg/index.js',self.source/'node_modules/.bin/tool');self.files=['server/a.mjs'];C.DEADLINE=None
 def tearDown(self):self.t.cleanup()
 def inv(self):return C.inventory_tree(self.source,self.files)
 def test_real_byte_copy_and_empty_vendor_file_and_confined_link(self):
  before=self.inv()
  with M.patch.object(C,'reserve'):after=C.copy_tree(self.source,self.base/'dest',before,os.getuid(),os.getgid())
  self.assertEqual(self.inv(),before);self.assertEqual((self.base/'dest/server/a.mjs').read_bytes(),b'import x from "pg";');self.assertEqual((self.base/'dest/node_modules/pkg/empty').read_bytes(),b'');self.assertEqual(os.readlink(self.base/'dest/node_modules/.bin/tool'),'../pkg/index.js');self.assertEqual(after['regularBytes'],before['regularBytes']);self.assertEqual((self.base/'dest/server/a.mjs').stat().st_mode&0o777,0o440);self.assertEqual((self.base/'dest').stat().st_mode&0o777,0o750)
 def test_old_is_preserved_and_retry_collision_refuses(self):
  before=self.inv();dest=self.base/'dest'
  with M.patch.object(C,'reserve'):C.copy_tree(self.source,dest,before,os.getuid(),os.getgid())
  with self.assertRaises(C.Refused):C.copy_tree(self.source,dest,before,os.getuid(),os.getgid())
  self.assertEqual(self.inv(),before)
 def test_same_length_source_content_drift_refuses(self):
  old=self.inv();(self.source/'server/a.mjs').write_bytes(b'import y from "pg";')
  with M.patch.object(C,'reserve'),self.assertRaises(C.Refused):C.copy_tree(self.source,self.base/'dest',old,os.getuid(),os.getgid())
 def test_source_replacement_same_bytes_refuses(self):
  old=self.inv();p=self.source/'server/a.mjs';raw=p.read_bytes();p.unlink();p.write_bytes(raw)
  with M.patch.object(C,'reserve'),self.assertRaises(C.Refused):C.copy_tree(self.source,self.base/'dest',old,os.getuid(),os.getgid())
 def test_hardlink_refused(self):
  os.link(self.source/'server/a.mjs',self.base/'hard')
  with self.assertRaises(C.Refused):self.inv()
 def test_world_writable_source_refused(self):
  (self.source/'server/a.mjs').chmod(0o666)
  with self.assertRaises(C.Refused):self.inv()
 def test_source_regular_alias_refused(self):
  p=self.source/'server/a.mjs';p.unlink();os.symlink('../node_modules/pkg/index.js',p)
  with self.assertRaises(C.Refused):self.inv()
 def test_external_vendor_symlink_refused(self):
  os.symlink(str(self.base),self.source/'node_modules/out')
  with self.assertRaises(C.Refused):self.inv()
 def test_relative_vendor_escape_refused(self):
  os.symlink('../../server/a.mjs',self.source/'node_modules/pkg/out')
  with self.assertRaises(C.Refused):self.inv()
 def test_dangling_vendor_link_refused(self):
  os.symlink('absent',self.source/'node_modules/pkg/out')
  with self.assertRaises(FileNotFoundError):self.inv()
 def test_fifo_refused(self):
  os.mkfifo(self.source/'node_modules/pipe')
  with self.assertRaises(C.Refused):self.inv()
 def test_xattr_refused(self):
  os.setxattr(self.source/'node_modules/pkg/index.js','user.audit30',b'flag')
  with self.assertRaises(C.Refused):self.inv()
 def test_exact_total_cap_not_extrapolated(self):
  with M.patch.object(C,'MAX_BYTES',1),self.assertRaises(C.Refused):self.inv()
 def test_exact_file_cap(self):
  with M.patch.object(C,'MAX_FILE',1),self.assertRaises(C.Refused):self.inv()
 def test_exact_entry_cap(self):
  with M.patch.object(C,'MAX_ENTRIES',3),self.assertRaises(C.Refused):self.inv()
 def test_unapproved_env_and_git_refused(self):
  for n in ('.env','.git'):
   p=self.source/'node_modules'/n;p.touch()
   with self.assertRaises(C.Refused):self.inv()
   p.unlink()
 def test_created_private_files_exclusive_and_fsynced(self):
  p=self.base/'evidence';C.newfile(p,b'abc',0o600,os.getuid(),os.getgid())
  with self.assertRaises(FileExistsError):C.newfile(p,b'bad',0o600,os.getuid(),os.getgid())
  self.assertEqual(p.read_bytes(),b'abc');self.assertEqual(p.stat().st_mode&0o777,0o600)
 def test_atime_is_not_source_drift(self):
  p=self.source/'server/a.mjs';os.utime(p,ns=(1,p.stat().st_mtime_ns));i=self.inv();os.utime(p,ns=(p.stat().st_atime_ns+100,p.stat().st_mtime_ns))
  # Explicit utime changes ctime, rightly refused. Ordinary read only advances atime.
  before=C.stamp(p.stat());p.read_bytes();self.assertEqual(before,C.stamp(p.stat()));self.assertEqual(C.read_file(p,100,hashlib.sha256(p.read_bytes()).hexdigest(),before),p.read_bytes())
 def test_snapshot_source_read_fd_race_refuses(self):
  p=self.source/'server/a.mjs';original=os.open
  def race(path,*a,**kw):
   if P(path)==p:
    raw=p.read_bytes();p.unlink();p.write_bytes(raw)
   return original(path,*a,**kw)
  with M.patch.object(C.os,'open',side_effect=race),self.assertRaises(C.Refused):C.read_file(p,100)
 def test_safe_process_framing_and_env(self):
  out=C.run_checked([sys.executable,'-c','print("ok")'],2,100);self.assertEqual(out,b'ok\n')
 def test_process_stdout_cap_kills_own_child(self):
  with self.assertRaises(C.Refused):C.run_checked([sys.executable,'-c','import sys,time;sys.stdout.write("X"*65537);sys.stdout.flush();time.sleep(20)'],2,10)
 def test_process_stderr_cap_not_exported(self):
  with self.assertRaises(C.Refused):C.run_checked([sys.executable,'-c','import sys;sys.stderr.write("secret"*20000)'],2,100)
 def test_process_deadline_kills_own_child(self):
  at=time.monotonic()
  with self.assertRaises(C.Refused):C.run_checked([sys.executable,'-c','import time;time.sleep(20)'],.1,100)
  self.assertLess(time.monotonic()-at,2)
 def test_readability_has_actual_gid_no_activation_sql_or_network(self):
  self.assertIn('getgid()!==112',C.READABILITY);self.assertNotIn('import(',C.READABILITY);self.assertNotIn('child_process',C.READABILITY);self.assertNotIn('psql',C.READABILITY)
 def test_native_request_root_destination_and_cap_bindings(self):
  self.assertEqual(C.ATTESTATION,'0ca029e59d44b6be5444d26d6d9af60d432f034f58c617647f2792f5d86c47a6');self.assertEqual(str(C.DEST),'/usr/local/lib/proofofwork-audit30-onhost-math/v2/source');self.assertEqual(C.MAX_BYTES,256*1024**2);self.assertEqual(C.PG_GID,112);self.assertEqual(C.PG_UID,108)
 def test_duplicate_json_request_key_refuses(self):
  with self.assertRaises(C.Refused):C.parse(b'{"mode":"inventory","mode":"prepare"}')
 def test_exact_existing_source_metadata_before_and_after_read(self):
  p=self.source/'server/a.mjs';m=C.stamp(p.stat());self.assertEqual(C.read_file(p,100,metadata=m),p.read_bytes());p.chmod(0o600)
  with self.assertRaises(C.Refused):C.read_file(p,100,metadata=m)
 def test_unknown_paths_refused(self):
  for name in ('../a','/tmp/a','a/../b','a//b','a\\b','a/./b','node_modules/.env'):
   with self.assertRaises(C.Refused):C.scoped_path(name)
 def test_durable_partial_copy_failure_retains_intact_source(self):
  i=self.inv();dest=self.base/'dest';real=C.newfile;count=[0]
  def fail(p,*a,**kw):
   count[0]+=1
   if count[0]==2:raise InterruptedError('fixture')
   return real(p,*a,**kw)
  with M.patch.object(C,'reserve'),M.patch.object(C,'newfile',side_effect=fail),self.assertRaises(InterruptedError):C.copy_tree(self.source,dest,i,os.getuid(),os.getgid())
  self.assertTrue(dest.exists());self.assertEqual(self.inv(),i)
 def test_request_unknown_extra_scope_refuses(self):
  r={'schema':'pow-audit30-math-source-copy-request-v1','mode':'prepare','candidateRoot':str(C.CANDIDATE),'candidateAttestationSHA256':C.ATTESTATION,'sourceInventorySHA256':'a'*64,**{k:C.stamp(os.stat('/')) for k in ('nodeMetadata','attestorMetadata','publisherMetadata')}}
  self.assertIs(C.validate_request(r),r)
  for key,value in [('mode','apply'),('candidateRoot','/opt/proofofwork-api'),('sourceInventorySHA256','x'),('candidateAttestationSHA256','b'*64)]:
   q=dict(r);q[key]=value
   with self.assertRaises(C.Refused):C.validate_request(q)
  q=dict(r);q['privateJob']='/data/private'
  with self.assertRaises(C.Refused):C.validate_request(q)
 def test_code_package_unknown_members_and_changed_bytes_refuse(self):
  import base64
  r={'schema':'pow-audit30-math-source-copy-request-v1','mode':'inventory','candidateRoot':str(C.CANDIDATE),'candidateAttestationSHA256':C.ATTESTATION,'members':{n:base64.b64encode(b'bad').decode() for n in C.MEMBER_PINS},**{k:C.stamp(os.stat('/')) for k in ('nodeMetadata','attestorMetadata','publisherMetadata')}}
  with self.assertRaises(C.Refused):C.validate_request(r)
  r['members']['.env']='dGVzdA=='
  with self.assertRaises(C.Refused):C.validate_request(r)
 def test_fixed_native_role_readability_hardening_and_complete_count(self):
  package=self.base/'package';package.mkdir();copied={'entries':[],'entryCount':0,'regularBytes':0};states=[{'LoadState':'not-found'},{'LoadState':'loaded','User':'postgres','Group':'postgres','InvocationID':'a'*32,'MainPID':'0','ExecStart':str(C.NODE)+' '+str(package/'read-copy.mjs')}];captured=[]
  def run(argv,timeout,cap,observer=None):
   captured.extend(argv)
   if observer:observer()
   return C.encode({'uid':108,'gid':112,'entries':0,'allSourceAndDependenciesReadable':True})
  def new(p,raw,*a):p.write_bytes(raw)
  with M.patch.object(C,'PACKAGE',package),M.patch.object(C,'unit_shape',side_effect=lambda:states.pop(0) if len(states)>1 else states[0]),M.patch.object(C,'newfile',side_effect=new),M.patch.object(C,'run_checked',side_effect=run):
   result=C.native_readability(copied)
  self.assertEqual(result['receipt']['gid'],112)
  for flag in ('--property=User=postgres','--property=Group=postgres','--property=CapabilityBoundingSet=','--property=NoNewPrivileges=yes','--property=ProtectSystem=strict','--property=PrivateNetwork=yes','--property=RestrictAddressFamilies=AF_UNIX'):self.assertIn(flag,captured)
  self.assertNotIn('runuser',str(captured));self.assertNotIn('psql',str(captured))
 def test_stop_refuses_changed_invocation_without_systemctl_stop(self):
  with M.patch.object(C,'unit_shape',return_value={'LoadState':'loaded','User':'postgres','Group':'postgres','InvocationID':'b'*32,'ExecStart':str(C.NODE)+' read-copy.mjs'}),M.patch.object(C,'run_checked') as run,self.assertRaises(C.Refused):C.owned_stop('a'*32)
  run.assert_not_called()
if __name__=='__main__':unittest.main()
