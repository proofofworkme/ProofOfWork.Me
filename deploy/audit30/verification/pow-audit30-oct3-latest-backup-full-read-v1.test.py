import ast,contextlib,copy,fcntl,hashlib,io,json,os,stat,subprocess,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch

SOURCE=Path('/tmp/pow-audit30-oct3-latest-backup-full-read-v1.py')
DIAG=Path('/tmp/pow-audit30-logical-backup-journal-refusal-diagnostic-native-v1.stdout')
def meta(p):
 s=p.lstat();return dict(device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def sha(b):return hashlib.sha256(b).hexdigest()
class Fixture:
 def __init__(self,base):
  self.root=Path(base)/'proof_indexer-20261003T031852Z.dumpset';self.root.mkdir(mode=0o700)
  self.lock=Path(base)/'.proofofwork-postgres-logical-backup.lock';self.lock.write_bytes(b'');self.lock.chmod(0o600)
  self.dump=self.root/'proof_indexer.dump';self.dump.write_bytes(b'SYNTHETIC-ARCHIVE-BYTES\x00'*7000);self.dump.chmod(0o600)
  self.globals=self.root/'globals.sql';self.globals.write_bytes(b'-- SYNTHETIC TEST ONLY\nCREATE ROLE private_test;\nALTER ROLE private_test WITH PASSWORD PRIVATE_SECRET_NOT_EXPORTED;\n');self.globals.chmod(0o600)
  self.manifest=self.root/'SHA256SUMS';self.manifest.write_bytes((sha(self.dump.read_bytes())+'  proof_indexer.dump\n'+sha(self.globals.read_bytes())+'  globals.sql\n').encode());self.manifest.chmod(0o600)
  def row(p):return dict(meta(p),mode=oct(stat.S_IMODE(p.stat().st_mode)),path=str(p))
  self.expected=dict(row(self.root),declaredMemberSha256={'proof_indexer.dump':sha(self.dump.read_bytes()),'globals.sql':sha(self.globals.read_bytes())},manifestSha256=sha(self.manifest.read_bytes()),members=[row(p)for p in(self.dump,self.globals,self.manifest)])
  self.lockmeta=meta(self.lock);self.toc=b'; SYNTHETIC first bounded catalog fixture only\n1; 0 0 TABLE DATA public x postgres\n2; 0 0 SEQUENCE SET public x_id postgres\n'
 def code(self):
  t=ast.parse(SOURCE.read_bytes())
  for n in t.body:
   if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name):
    if n.targets[0].id in ('EXPECTED','LOCK_EXPECTED'):
     n.value=ast.parse(repr(self.expected if n.targets[0].id=='EXPECTED'else self.lockmeta),mode='eval').body
    elif n.targets[0].id=='lockpath':n.value=ast.Call(func=ast.Name(id='Path',ctx=ast.Load()),args=[ast.Constant(str(self.lock))],keywords=[])
  return compile(ast.fix_missing_locations(t),str(SOURCE),'exec')
 def run(self,restore=None):
  output=io.StringIO();calls=[]
  def pg_restore(argv,**kw):
   calls.append((argv,kw));return types.SimpleNamespace(stdout=self.toc,stderr=b'')if restore is None else restore(argv,**kw)
  with patch.object(os,'geteuid',return_value=108),patch.object(subprocess,'run',side_effect=pg_restore),contextlib.redirect_stdout(output):exec(self.code(),{'__name__':'synthetic_leaf_fixture'})
  return json.loads(output.getvalue()),calls

class Tests(unittest.TestCase):
 def test_source_bindings_exact_actual_metadata_and_declared_three_hashes(self):
  raw=DIAG.read_bytes();self.assertEqual(len(raw),12502);self.assertEqual(sha(raw),'07824e0892583ee7d0370f2f6f97e85e7376502d23e7895fbadd0b1b7ca320cc');v=json.loads(raw)
  literals={}
  for n in ast.parse(SOURCE.read_bytes()).body:
   if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and n.targets[0].id in ('EXPECTED','LOCK_EXPECTED'):literals[n.targets[0].id]=ast.literal_eval(n.value)
  e=literals['EXPECTED'];b=v['logicalRoot']['completeSets']['proof_indexer-20261003T031852Z.dumpset'];self.assertEqual(e['path'],b['path'])
  self.assertEqual(literals['LOCK_EXPECTED'],v['logicalRoot']['otherEntries'][0]['metadata'])
  for name,row in b['members'].items():
   m=next(x for x in e['members']if Path(x['path']).name==name)
   self.assertEqual({k:oct(n)if k=='mode'else n for k,n in row['metadata'].items()},{k:m[k]for k in row['metadata']})
   self.assertEqual(e['manifestSha256']if name=='SHA256SUMS'else e['declaredMemberSha256'][name],row.get('declaredSha256')or row['sha256'])
  self.assertEqual(sha(Path('/tmp/pow-audit30-latest-backup-full-read-v1.py').read_bytes()),'6bafcdb48b1fd0c8da0c23169906f7cd96fbeb374b0333b9c7ca349988abc869')
 def test_real_streamed_three_members_first_toc_and_private_globals_not_emitted(self):
  with tempfile.TemporaryDirectory()as t:
   f=Fixture(t);v,c=f.run();self.assertTrue(v['fullDumpHashReverified']);self.assertFalse(v['globalsContentsEmitted']);self.assertNotIn('PRIVATE_SECRET_NOT_EXPORTED',json.dumps(v));self.assertEqual(v['toc']['entries'],2);self.assertEqual(v['toc']['sha256'],sha(f.toc))
   self.assertEqual(c[0][0],['/usr/lib/postgresql/16/bin/pg_restore','--list',str(f.dump)]);self.assertEqual(c[0][1]['timeout'],180)
   self.assertEqual(v['globalsStatementCategoryCounts'],{'CREATE ROLE':1,'ALTER ROLE':1});self.assertEqual(v['checksumManifest'],f.manifest.read_text())
   self.assertEqual({k:r['sha256']for k,r in v['backup']['members'].items()},{p.name:sha(p.read_bytes())for p in(f.dump,f.globals,f.manifest)})
 def test_hash_mismatch_refuses_all_three_members(self):
  for name in ('proof_indexer.dump','globals.sql','SHA256SUMS'):
   with self.subTest(name=name),tempfile.TemporaryDirectory()as t:
    f=Fixture(t)
    if name=='SHA256SUMS':f.expected['manifestSha256']='0'*64
    else:f.expected['declaredMemberSha256'][name]='0'*64
    with self.assertRaises(AssertionError):f.run()
 def test_member_hardlink_symlink_and_xattr_refuse(self):
  for kind in ('hardlink','symlink','xattr'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory()as t:
    f=Fixture(t)
    if kind=='hardlink':os.link(f.globals,Path(t)/'alias')
    elif kind=='symlink':original=Path(t)/'outside';f.globals.rename(original);f.globals.symlink_to(original)
    else:os.setxattr(f.globals,b'user.audit30-fixture',b'not-admitted')
    with self.assertRaises(AssertionError):f.run()
 def test_actual_lock_replacement_after_flock_refuses_and_releases_fd(self):
  with tempfile.TemporaryDirectory()as t:
   f=Fixture(t);original=fcntl.flock;fd_seen=[]
   def replace(fd,how):
    original(fd,how);fd_seen.append(fd);new=Path(t)/'new-lock';new.write_bytes(b'');new.chmod(0o600);os.replace(new,f.lock)
   with patch.object(fcntl,'flock',side_effect=replace),self.assertRaises(AssertionError):f.run()
   with self.assertRaises(OSError):os.fstat(fd_seen[0])
 def test_real_lock_contention_refuses_without_pg_restore_or_fd_leak(self):
  with tempfile.TemporaryDirectory()as t:
   f=Fixture(t);fd=os.open(f.lock,os.O_RDONLY);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   try:
    with self.assertRaises(BlockingIOError):f.run()
   finally:os.close(fd)
   v,_=f.run();self.assertTrue(v['fullDumpHashReverified'])
 def test_real_fd_file_drift_during_read_refuses(self):
  with tempfile.TemporaryDirectory()as t:
   f=Fixture(t);original=os.read;changed=[]
   def drift(fd,n):
    b=original(fd,n)
    if b.startswith(b'SYNTHETIC-ARCHIVE')and not changed:
     with f.dump.open('r+b')as out:out.seek(1);out.write(b'Z');out.flush();os.fsync(out.fileno())
     changed.append(True)
    return b
   with patch.object(os,'read',side_effect=drift),self.assertRaises(AssertionError):f.run()
   self.assertTrue(changed)
 def test_post_catalog_member_identity_change_refuses(self):
  with tempfile.TemporaryDirectory()as t:
   f=Fixture(t)
   def restore(argv,**kw):f.globals.write_bytes(b'unknown');return types.SimpleNamespace(stdout=f.toc,stderr=b'')
   with self.assertRaises(AssertionError):f.run(restore)
 def test_catalog_warning_empty_oversized_and_overcount_refuse(self):
  for kind in ('stderr','empty','oversized','overcount'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory()as t:
    f=Fixture(t);out=f.toc;err=b''
    if kind=='stderr':err=b'warning'
    elif kind=='empty':out=b'; zero entries\n'
    elif kind=='oversized':out=b'x'*1024**2
    else:out=b'1; 0 0 TABLE x\n'*10001
    with self.assertRaises(AssertionError):f.run(lambda *a,**k:types.SimpleNamespace(stdout=out,stderr=err))
 def test_pg_restore_timeout_preserves_shared_lock_release(self):
  with tempfile.TemporaryDirectory()as t:
   f=Fixture(t)
   def timeout(*a,**k):raise subprocess.TimeoutExpired(a[0],180)
   with self.assertRaises(subprocess.TimeoutExpired):f.run(timeout)
   fd=os.open(f.lock,os.O_RDONLY)
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   finally:os.close(fd)
if __name__=='__main__':unittest.main()
