import copy,importlib.util,json,os,signal,stat,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
p=Path('/tmp/pow-audit30-production-physical-sizing-leaf-v3.py');sp=importlib.util.spec_from_file_location('L',p);L=importlib.util.module_from_spec(sp);sp.loader.exec_module(L)
def catalog():return {'readOnly':'on','dataDirectory':str(L.PGDATA),'serverVersionNum':'160015','systemIdentifier':'7652445986754609384','timeline':1,'databaseCount':2,'databases':[{'oid':1,'name':'template1','bytes':8192},{'oid':16385,'name':'proof_indexer','bytes':40000}],'tablespaceCount':3,'tablespaces':[{'oid':1663,'name':'pg_default','path':'','bytes':8192},{'oid':1664,'name':'pg_global','path':'','bytes':8192},{'oid':20000,'name':'proof_indexer','path':str(L.TABLESPACE_PARENT/'proof_indexer'),'bytes':40000}]}
class Tests(unittest.TestCase):
 def setUp(self):L.DEADLINE=time.monotonic()+150
 def test_actual_public_production_identity_authority(self):
  import hashlib
  p=Path('/tmp/pow-audit30-production-pg-identity-readonly-native-v1.stdout');raw=p.read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),L.IDENTITY_OBSERVATION_SHA);actual=json.loads(raw)['productionIdentity'];v=catalog()
  for key in('readOnly','dataDirectory','serverVersionNum','systemIdentifier','timeline'):v[key]=actual[key]
  L.validate_catalog(v)
 def test_prior_private_identifier_refused(self):
  v=catalog();v['systemIdentifier']='7692221671691040144'
  with self.assertRaisesRegex(ValueError,'FIXED_LIVE'):L.validate_catalog(v)
 def test_exact_observed_version_and_timeline_refuse_drift(self):
  for key,value in(('serverVersionNum','160016'),('timeline',2)):
   v=catalog();v[key]=value
   with self.subTest(key=key),self.assertRaisesRegex(ValueError,'FIXED_LIVE'):L.validate_catalog(v)
 def test_catalog_all_databases_tablespaces_and_fixed_identity(self):L.validate_catalog(catalog())
 def test_both_pg_oid_json_projections_use_lossless_numeric_cast(self):
  self.assertEqual(L.SQL.count("jsonb_build_object('oid',oid::bigint,"),2);self.assertNotIn("jsonb_build_object('oid',oid,",L.SQL)
  for population in('databases','tablespaces'):
   v=catalog();v[population][0]['oid']=str(v[population][0]['oid'])
   with self.subTest(population=population),self.assertRaises((ValueError,TypeError)):L.validate_catalog(v)
  v=catalog();v['databases'][-1]['oid']=4294967295;L.validate_catalog(v)
 def test_catalog_readwrite_version_identity_omission_and_duplicate_refuse(self):
  for key,value in [('readOnly','off'),('dataDirectory','/other'),('serverVersionNum','170000'),('systemIdentifier','1'),('databaseCount',129),('timeline',True)]:
   v=catalog();v[key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):L.validate_catalog(v)
  for k in ('databases','tablespaces'):
   v=catalog();v[k].append(copy.deepcopy(v[k][0]));v['databaseCount'if k=='databases'else'tablespaceCount']+=1
   with self.assertRaises(ValueError):L.validate_catalog(v)
 def test_external_path_cannot_escape_or_alias(self):
  for path in ('/data/bitcoin','/','/etc','/data/proofofwork-postgres-tablespaces/../bitcoin','/data/proofofwork-postgres-tablespaces/space/nested'):
   v=catalog();v['tablespaces'][-1]['path']=path
   with self.subTest(path=path),self.assertRaises(ValueError):L.validate_catalog(v)
 def test_missing_builtin_or_numeric_spoof_refuses(self):
  v=catalog();v['tablespaces'][0]['path']=str(L.TABLESPACE_PARENT/'bad')
  with self.assertRaises(ValueError):L.validate_catalog(v)
  v=catalog();v['databases'][0]['bytes']=True
  with self.assertRaises(ValueError):L.validate_catalog(v)
 def test_topology_ignores_only_measured_growth(self):
  a=catalog();b=copy.deepcopy(a);b['databases'][0]['bytes']+=100;b['tablespaces'][-1]['bytes']+=100;self.assertEqual(L.topology(a),L.topology(b));b['databases'][0]['name']='other';self.assertNotEqual(L.topology(a),L.topology(b))
 def test_du_null_output_exact_roots_and_sizes(self):self.assertEqual(L.parse_du(b'8192\t/a\x00123\t/b\x00',['/a','/b']),{'/a':8192,'/b':123})
 def test_du_missing_duplicate_newline_negative_extra_root_refuse(self):
  for raw in(b'1\t/a\n',b'1\t/a\x00',b'1\t/a\x001\t/a\x00',b'-1\t/a\x001\t/b\x00',b'1\t/a\x001\t/c\x00'):
   with self.subTest(raw=raw),self.assertRaises(ValueError):L.parse_du(raw,['/a','/b'])
 def test_fixed_sql_and_direct_pg16_clean_argv(self):
  with patch.object(L,'command',return_value=L.encoded(catalog()))as cmd:self.assertEqual(L.catalog()['databaseCount'],2)
  argv=cmd.call_args.args[0];self.assertEqual(argv[:4],['/usr/lib/postgresql/16/bin/psql','-X','-qAt','-v']);self.assertEqual(argv[-2:],['-c',L.SQL]);self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',L.SQL);self.assertIn("statement_timeout='15s'",L.SQL);self.assertIn("lock_timeout='2s'",L.SQL);self.assertIn('pg_database_size(oid)',L.SQL);self.assertIn('pg_tablespace_size(oid)',L.SQL);self.assertNotIn('PGPASSWORD',L.ENV)
 def test_du_measurements_fixed_no_dereference_no_shell(self):
  scope={'roots':['/a','/b'],'walPath':'/a/pg_wal'};answers=[b'100\t/a\x0020\t/b\x00',b'5\t/a/pg_wal\x00',b'200\t/a\x0040\t/b\x00',b'10\t/a/pg_wal\x00']
  with patch.object(L,'command',side_effect=answers)as cmd:v=L.measured(scope)
  self.assertEqual(v['allocatedBytes']['/a/pg_wal'],5);self.assertEqual(v['apparentBytes']['/b'],40)
  for c in cmd.call_args_list:self.assertEqual(c.args[0][:5],['/usr/bin/du','-x','-s','-B1','--null']);self.assertIn('--',c.args[0]);self.assertNotIn('-L',c.args[0])
 def fs(self):
  tmp=tempfile.TemporaryDirectory();base=Path(tmp.name).resolve();data=base/'main';data.mkdir(mode=0o700);(data/'pg_wal').mkdir(mode=0o700);(data/'pg_tblspc').mkdir(mode=0o700);ts=base/'spaces';ts.mkdir(mode=0o700);space=ts/'proof_indexer';space.mkdir(mode=0o700);(data/'pg_tblspc'/'20000').symlink_to(space);v=catalog();v['dataDirectory']=str(data);v['tablespaces'][-1]['path']=str(space)
  return tmp,data,ts,space,v
 def test_real_tblspc_matching_and_changed_link_extra_member_refuse(self):
  tmp,data,ts,space,v=self.fs();original=Path.lstat
  def pgstat(p,*a,**kw):
   s=original(p,*a,**kw);return types.SimpleNamespace(**{k:getattr(s,k)for k in dir(s)if k.startswith('st_')}|{'st_uid':108,'st_gid':112})
  try:
   with patch.object(L,'PGDATA',data),patch.object(L,'TABLESPACE_PARENT',ts),patch.object(Path,'lstat',pgstat),patch.object(L.os,'statvfs',return_value=types.SimpleNamespace(f_flag=os.ST_RDONLY)),patch.object(Path,'read_bytes',return_value=b'1 0 1:1 / / rw - ext4 /dev/a rw\n'):
    a=L.filesystem_scope(v);self.assertEqual(a['roots'],[str(data),str(space)]);(data/'pg_tblspc'/'bad').symlink_to(space)
    with self.assertRaisesRegex(ValueError,'MEMBERSHIP'):L.filesystem_scope(v)
    (data/'pg_tblspc'/'bad').unlink();(data/'pg_tblspc'/'20000').unlink();(data/'pg_tblspc'/'20000').symlink_to(data/'pg_wal')
    with self.assertRaisesRegex(ValueError,'SYMLINK'):L.filesystem_scope(v)
  finally:tmp.cleanup()
 def test_wal_alias_and_writable_mount_refuse(self):
  tmp,data,ts,space,v=self.fs();original=Path.lstat
  def pgstat(p,*a,**kw):
   s=original(p,*a,**kw);return types.SimpleNamespace(**{k:getattr(s,k)for k in dir(s)if k.startswith('st_')}|{'st_uid':108,'st_gid':112})
  try:
   with patch.object(L,'PGDATA',data),patch.object(Path,'lstat',pgstat),patch.object(L.os,'statvfs',return_value=types.SimpleNamespace(f_flag=0)),self.assertRaisesRegex(ValueError,'READONLY'):L.filesystem_scope(v)
   (data/'pg_wal').rmdir();(data/'pg_wal').symlink_to(space)
   with patch.object(L,'PGDATA',data),patch.object(Path,'lstat',pgstat),patch.object(L.os,'statvfs',return_value=types.SimpleNamespace(f_flag=os.ST_RDONLY)),self.assertRaisesRegex(ValueError,'CANONICAL'):L.filesystem_scope(v)
  finally:tmp.cleanup()
 def test_unknown_nested_mount_same_filesystem_wal_bind_and_inode_alias_refuse(self):
  tmp,data,ts,space,v=self.fs();original=Path.lstat
  def pgstat(p,*a,**kw):
   s=original(p,*a,**kw);return types.SimpleNamespace(**{k:getattr(s,k)for k in dir(s)if k.startswith('st_')}|{'st_uid':108,'st_gid':112})
  try:
   with patch.object(L,'PGDATA',data),patch.object(L,'TABLESPACE_PARENT',ts),patch.object(Path,'lstat',pgstat),patch.object(L.os,'statvfs',return_value=types.SimpleNamespace(f_flag=os.ST_RDONLY)):
    for mount,code in((data/'base'/'extra','NESTED_MOUNT'),(data/'pg_wal','WAL_SAME_FILESYSTEM_BIND_ALIAS')):
     raw=('1 0 1:1 / '+str(mount)+' ro - ext4 /dev/a ro\n').encode()
     with patch.object(Path,'read_bytes',return_value=raw),self.assertRaisesRegex(ValueError,code):L.filesystem_scope(v)
    real_metadata=L.metadata
    def alias(p):
     m=real_metadata(p)
     if p==space:m['device']=real_metadata(data)['device'];m['inode']=real_metadata(data)['inode']
     return m
    with patch.object(L,'metadata',side_effect=alias),self.assertRaisesRegex(ValueError,'ROOT_ALIAS'):L.filesystem_scope(v)
  finally:tmp.cleanup()
 def test_native_sql_or_du_error_no_silent_partial(self):
  for r in(types.SimpleNamespace(returncode=1,stdout=b'',stderr=b'private failure'),types.SimpleNamespace(returncode=0,stdout=b'x',stderr=b'warning')):
   with patch.object(L.subprocess,'run',return_value=r),self.assertRaisesRegex(ValueError,'COMMAND_REFUSED'):L.command(['/fixed'])
 def test_real_signal_during_selector_wait_is_not_swallowed(self):
  with tempfile.TemporaryDirectory()as t:
   marker=Path(t)/'ready'
   def send():
    deadline=time.monotonic()+2
    while not marker.exists()and time.monotonic()<deadline:time.sleep(.002)
    if marker.exists():os.kill(os.getpid(),signal.SIGTERM)
   old=signal.getsignal(signal.SIGTERM);signal.signal(signal.SIGTERM,lambda *_:(_ for _ in()).throw(L.SizingInterrupted('signal')));thread=threading.Thread(target=send);thread.start()
   try:
    with self.assertRaises(L.SizingInterrupted):L.command(['/usr/bin/python3','-I','-c',"from pathlib import Path;import time;Path("+repr(str(marker))+").write_text('ready');time.sleep(2)"])
   finally:signal.signal(signal.SIGTERM,old);thread.join(timeout=3)
   self.assertFalse(thread.is_alive());self.assertTrue(marker.exists())
if __name__=='__main__':unittest.main()
