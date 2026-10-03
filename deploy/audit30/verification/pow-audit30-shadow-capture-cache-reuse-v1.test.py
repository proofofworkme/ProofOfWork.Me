import copy,hashlib,io,json,pathlib,stat,types,unittest
from unittest import mock
P=pathlib.Path('/tmp/pow-audit30-shadow-capture-cache-reuse-v1.py');N={'__name__':'test'};exec(compile(P.read_bytes(),str(P),'exec'),N)
ID=dict(pid=2103747,unit='api',startTicks=111)
HELPER=b"def runroot(r):return '/run/proofofwork-audit5-'+r\ndef check_root_dir(p):assert p.startswith('/run/')\ndef proc_identity(k,a):return {'pid':2103747,'unit':k,'startTicks':111}\n"
class Path:
 def __init__(self,s):self.s=str(s)
 def __truediv__(self,s):return Path(self.s+'/'+s)
 def __str__(self):return self.s
 def resolve(self):return self
 def __eq__(self,o):return str(o)==self.s
 def lstat(self):return types.SimpleNamespace(st_dev=1,st_ino=22,st_mode=stat.S_IFDIR|0o700,st_uid=4,st_gid=4,st_nlink=2,st_size=4096,st_mtime_ns=11,st_ctime_ns=12,st_atime_ns=13)
class Entries:
 def __init__(self,rows):self.rows=iter(rows)
 def __enter__(self):return self.rows
 def __exit__(self,*a):pass
class Tests(unittest.TestCase):
 def actual(self,kind=None):
  blob=b'private-env';sha=hashlib.sha256(blob).hexdigest();m=dict(format='private-audit5-environments-v1',releaseId=N['RELEASE'],processes={})
  for k in ['api','worker']:
   i=dict(pid=2103747,unit=k,startTicks=111);m['processes'][k]=dict(identityBefore=i,identityAfter=i,identityFinal=i,environmentBytes=len(blob),environmentSha256=sha)
  ident=dict(path='/data/proofofwork-api-cache-shadow-'+N['RELEASE'],dev=1,inode=22,uid=4,gid=4);rows=[];current=blob
  if kind=='manifest-id':m['processes']['api']['identityFinal']=dict(pid=99)
  if kind=='manifest-bytes':m['processes']['api']['environmentBytes']+=1
  if kind=='manifest-sha':m['processes']['api']['environmentSha256']='0'*64
  if kind=='current-env':current=b'changed'
  if kind=='cache-inode':ident['inode']=33
  if kind=='cache-entry':rows=['private-file']
  if kind=='extra-process':m['processes']['other']={}
  raw=json.dumps(m).encode();iraw=json.dumps(ident).encode()
  def read(p):
   if str(p).endswith('capture.json'):return raw
   if str(p).endswith('shadow-cache.json'):return iraw
   return blob
  ns=N;account=types.SimpleNamespace(pw_uid=4,pw_gid=4)
  with mock.patch.object(ns['pathlib'],'Path',Path),mock.patch.object(ns['pwd'],'getpwnam',return_value=account),mock.patch.object(ns['os'],'scandir',side_effect=lambda p:Entries(rows)),mock.patch('builtins.open',side_effect=lambda *a,**k:io.BytesIO(current)),mock.patch.dict(ns,{'API_SHA':sha}):
   return ns['admit_existing_capture_cache'](read,HELPER,'/tools/private-env.py')
 def test_valid_empty_reuse_only_hashes(self):r=self.actual();self.assertTrue(r['shadowCacheEmpty']);self.assertNotIn('private-env',json.dumps(r));self.assertFalse(r['privateContentsExported'])
 def test_changed_process_refuses(self):self.assertRaises(AssertionError,self.actual,'manifest-id')
 def test_changed_length_refuses(self):self.assertRaises(AssertionError,self.actual,'manifest-bytes')
 def test_changed_sha_refuses(self):self.assertRaises(AssertionError,self.actual,'manifest-sha')
 def test_current_env_changed_refuses(self):self.assertRaises(AssertionError,self.actual,'current-env')
 def test_replaced_cache_refuses(self):self.assertRaises(AssertionError,self.actual,'cache-inode')
 def test_nonempty_cache_refuses(self):self.assertRaises(AssertionError,self.actual,'cache-entry')
 def test_extra_process_refuses(self):self.assertRaises(AssertionError,self.actual,'extra-process')
 def test_atime_only_excluded(self):a=Path('a').lstat();b=copy.copy(a);b.st_atime_ns=999;self.assertEqual(N['dir_stamp'](a),N['dir_stamp'](b));b.st_ctime_ns+=1;self.assertNotEqual(N['dir_stamp'](a),N['dir_stamp'](b))
if __name__=='__main__':unittest.main()
