#!/usr/bin/python3 -I
"""Pure local bootstrap interface/file/capture tests; no systemd/SSH/PG."""
import base64,hashlib,importlib.util,json,os,stat,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
PATH=Path('/tmp/pow-audit30-snapshot-inspect-bootstrap.py')
spec=importlib.util.spec_from_file_location('bootstrap',PATH);B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
class BootstrapTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def request(self,mode='inventory'):
  v=dict(schema='pow-audit30-snapshot-inspect-bootstrap-v1',approvalSha256=B.APPROVAL,mode=mode,runId='20261003T020000Z',host='node',sources={})
  if mode=='inventory':
   for name,source in [('controller.py','/tmp/pow-audit30-saved-snapshot-inspect.py'),('restore-latest-logical.py','/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py')]:
    raw=Path(source).read_bytes();v['sources'][name]=dict(base64=base64.b64encode(raw).decode(),sha256=hashlib.sha256(raw).hexdigest())
  return v
 def test_actual_frozen_sources_admit(self):self.assertEqual(set(B.validate_request(self.request())),{'controller.py','restore-latest-logical.py'})
 def test_scope_mode_source_and_calendar_refuse(self):
  for key,value in [('approvalSha256','a'*64),('mode','shell'),('runId','20260230T020000Z'),('host','$(id)')]:
   v=self.request();v[key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):B.validate_request(v)
  v=self.request();v['sources']['arbitrary.sql']=v['sources']['controller.py']
  with self.assertRaises(ValueError):B.validate_request(v)
 def test_source_bytes_and_declared_sha_refuse(self):
  v=self.request();v['sources']['controller.py']['base64']=base64.b64encode(b'raise Exception()').decode()
  with self.assertRaises(ValueError):B.validate_request(v)
  v=self.request();v['sources']['controller.py']['sha256']='a'*64
  with self.assertRaises(ValueError):B.validate_request(v)
 def test_duplicate_json_refuses(self):
  with self.assertRaises(ValueError):json.loads('{"x":1,"x":2}',object_pairs_hook=B.pairs)
 def test_run_raw_plan_exact_sha_source_host_bind(self):
  v=self.request('run');plan=dict(approvalSha256=B.APPROVAL,runId=v['runId'],host=v['host'],source=str(B.SOURCE),controllerSha256=B.PINS['controller.py'],guardSha256=B.PINS['restore-latest-logical.py']);raw=B.encoded(plan);v.update(planBase64=base64.b64encode(raw).decode(),planSha256=hashlib.sha256(raw).hexdigest());self.assertEqual(B.validate_request(v),{})
  for key,value in [('source','/var/lib/postgresql/16/main'),('host','other'),('controllerSha256','a'*64)]:
   bad=plan|{key:value};raw=B.encoded(bad);v.update(planBase64=base64.b64encode(raw).decode(),planSha256=hashlib.sha256(raw).hexdigest())
   with self.subTest(key=key),self.assertRaises(ValueError):B.validate_request(v)
 def test_create_exclusive_bytes_and_privacy(self):
  p=self.root/'file';B.create(p,b'private',0o440,os.getgid(),os.getuid());self.assertEqual(p.read_bytes(),b'private');self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o440)
  with self.assertRaises(FileExistsError):B.create(p,b'replace',0o440,os.getgid(),os.getuid())
  self.assertEqual(p.read_bytes(),b'private');p.rename(self.root/'retained');p.symlink_to(self.root/'retained')
  with self.assertRaises(FileExistsError):B.create(p,b'replace',0o440,os.getgid(),os.getuid())
 def test_readbound_atime_excluded_content_mode_and_links_refuse(self):
  p=self.root/'input';p.write_bytes(b'data');p.chmod(0o600);os.utime(p,ns=(1,p.stat().st_mtime_ns));m=B.metadata(p);sha=hashlib.sha256(b'data').hexdigest();self.assertEqual(B.read_bound(p,m,sha,1024,os.getuid(),os.getgid()),b'data')
  p.write_bytes(b'changed')
  with self.assertRaises(ValueError):B.read_bound(p,m,sha,1024,os.getuid(),os.getgid())
  os.link(p,self.root/'hardlink')
  with self.assertRaises(ValueError):B.read_bound(p,B.metadata(p),hashlib.sha256(p.read_bytes()).hexdigest(),1024,os.getuid(),os.getgid())
 def test_exact_inventory_and_run_unit_authorities(self):
  p=B.properties('inventory');self.assertEqual(p['ReadWritePaths'],'');self.assertEqual(p['RuntimeMaxSec'],'15min');self.assertEqual(p['CPUQuota'],'25%');self.assertNotIn('LoadCredential',p)
  p=B.properties('run','/data/proofofwork-audit30-inspect-20261003T020000Z',self.root);self.assertEqual(p['RuntimeMaxSec'],'60min');self.assertEqual(p['MemoryMax'],str(8*1024**3));self.assertEqual(p['LoadCredential'],'inspect-plan:'+str(self.root/'reviewed-plan.json'))
  self.assertIn(str(B.SOURCE),p['ReadOnlyPaths']);self.assertIn(str(B.SOURCE/'socket'),p['InaccessiblePaths']);self.assertEqual(p['RestrictAddressFamilies'],'AF_UNIX');self.assertEqual(p['CapabilityBoundingSet'],'')
 def test_unit_presence_read_error_refuse(self):
  for values in [('loaded\n','',0),('not-found\n','err',0),('not-found\n','',1)]:
   with patch.object(B.subprocess,'run',return_value=types.SimpleNamespace(stdout=values[0],stderr=values[1],returncode=values[2])),self.assertRaises(ValueError):B.unit_new('proofofwork-audit30-snapshot-inventory-20261003T020000Z.service')
 def test_actual_stream_capture_exclusive_and_stderr_fail_closed(self):
  p=self.root/'capture';out=B.capture_unit(['/usr/bin/python3','-I','-B','-c','import sys;sys.stdout.write("proof")'],p,'private-unit',2,100);self.assertEqual(out,dict(out=5,err=0));self.assertEqual(p.read_bytes(),b'proof')
  with self.assertRaises(FileExistsError):B.capture_unit(['/bin/true'],p,'private-unit',2,100)
  with patch.object(B.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)),self.assertRaises(RuntimeError):B.capture_unit(['/usr/bin/python3','-I','-B','-c','import sys;sys.stderr.write("refused")'],self.root/'bad','private-unit',2,100)
  self.assertEqual((self.root/'bad.stderr').read_bytes(),b'refused')
 def test_stream_bound_and_deadline_preserve_partial_capture(self):
  for name,code,timeout,limit in [('bound','print("x"*1024)',2,10),('deadline','import time;time.sleep(3)',.1,1024)]:
   with patch.object(B.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)),self.assertRaises((ValueError,TimeoutError)):B.capture_unit(['/usr/bin/python3','-I','-B','-c',code],self.root/name,'private-unit',timeout,limit)
   self.assertTrue((self.root/name).exists());self.assertTrue((self.root/(name+'.stderr')).exists())
 def prepare_case(self,change=None):
  rid='20261003T020000Z';stage=self.root/('inputs-'+rid);stage.mkdir(mode=0o700);package=self.root/'package';package.mkdir(mode=0o750)
  plan=stage/'phase4-private-plan.json';raw=B.encoded(dict(schema='pow-audit30-mail-body-private-rehearsal-plan-v1'));plan.write_bytes(raw);plan.chmod(0o600)
  base=stage/'pg-dependencies';base.mkdir(mode=0o700)
  for rel in ('pg','pg/lib','pg/node_modules'):(base/rel).mkdir(mode=0o700)
  entry=base/'pg/lib/index.js';entry.write_bytes(b'module.exports = {};');entry.chmod(0o600)
  original=B.metadata
  def meta(path):return original(path)|{'uid':0,'gid':0}
  with patch.object(B,'metadata',meta),patch.object(B,'STAGEBASE',str(self.root/'inputs-')):
   records=[]
   for path in sorted([base,*base.rglob('*')],key=lambda p:'.' if p==base else str(p.relative_to(base))):
    row=dict(path='.' if path==base else str(path.relative_to(base)),kind='directory' if path.is_dir() else 'file',metadata=meta(path))
    if row['kind']=='file':row['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
    records.append(row)
   v=dict(runId=rid,privatePlan=dict(path=str(plan),metadata=meta(plan),sha256=hashlib.sha256(raw).hexdigest()),dependencySource=dict(path=str(base),records=records,recordsSha256=hashlib.sha256(B.encoded(records)).hexdigest()),sources={})
   if change=='unlisted':(base/'extra').write_bytes(b'unlisted')
   if change=='symlink':entry.unlink();entry.symlink_to(plan)
   if change=='private-tamper':plan.write_bytes(b'changed')
   if change=='hardlink':os.link(entry,self.root/'entry-alias')
   if change=='existing-target':(package/'phase4-private-plan.json').write_bytes(b'retained')
   def create(path,data,mode,gid,uid=0):
    if Path(path).exists():raise FileExistsError
    Path(path).write_bytes(data);Path(path).chmod(mode)
   def newdir(path,uid,gid,mode):Path(path).mkdir(mode=mode)
   mod=types.SimpleNamespace(safe_rel=lambda p:p,collect_pg_dependencies=lambda p:dict(entries=5,regularBytes=19,records=[]))
   with patch.object(B,'create',side_effect=create),patch.object(B,'newdir',side_effect=newdir):return B.prepare_inputs(v,package,types.SimpleNamespace(pw_gid=os.getgid()),mod)
 def test_prepare_exact_complete_dependency_and_private_plan_creation(self):
  result=self.prepare_case();self.assertEqual(result['dependencyEntries'],5);self.assertEqual(result['dependencyRegularBytes'],20)
  self.assertTrue((self.root/'package/phase4-pg-dependency-inventory.json').exists());self.assertEqual((self.root/'package/pg-dependencies/pg/lib/index.js').read_bytes(),b'module.exports = {};')
 def test_prepare_unlisted_symlink_hardlink_plan_drift_and_existing_target_refuse(self):
  for change in ('unlisted','symlink','hardlink','private-tamper','existing-target'):
   with self.subTest(change=change),self.assertRaises((ValueError,FileExistsError)):self.prepare_case(change)
   self.assertFalse((self.root/'package/pg-dependencies').exists());(self.root/'package').rename(self.root/('retained-'+change));(self.root/'inputs-20261003T020000Z').rename(self.root/('inputs-retained-'+change))

if __name__=='__main__':unittest.main()
