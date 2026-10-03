#!/usr/bin/python3 -I
"""Pure local bootstrap interface/file/capture tests; no systemd/SSH/PG."""
import base64,hashlib,importlib.util,json,os,stat,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
PATH=Path('/tmp/pow-audit30-transition-stream-bootstrap-v2.py')
spec=importlib.util.spec_from_file_location('bootstrap',PATH);B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
class BootstrapTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def request(self,mode='inventory'):
  v=dict(schema='pow-audit30-private-stream-bootstrap-v2',approvalSha256=B.APPROVAL,mode=mode,runId='20261003T023000Z',host='node',sources={})
  if mode=='inventory':
   for n in B.UTILITY:
    src=Path('/tmp/pow-audit30-transition-stream-controller-v4.py')if n=='controller.py'else Path('/home/sixer/ProofOfWork.Me/deploy/audit30/restore-latest-logical.py')if n=='restore-latest-logical.py'else Path('/tmp')/n;raw=src.read_bytes();v['sources'][n]=dict(base64=base64.b64encode(raw).decode(),sha256=hashlib.sha256(raw).hexdigest())
   raw=Path('/tmp/pow-audit30-cluster-inventory-native-v1.json').read_bytes();review=B.encoded(dict(schema='explicit-reviewed-admission'));v.update(sealedInventoryBase64=base64.b64encode(raw).decode(),priorAdmissionBase64=base64.b64encode(review).decode(),priorAdmissionSha256=hashlib.sha256(review).hexdigest())
  if mode=='prepare':
   for n in set(B.PINS)-B.UTILITY:
    src=Path('/tmp/pow-audit30-mail-readiness-admission-v2-template.json')if n.endswith('.json')else Path('/tmp')/n;raw=src.read_bytes();v['sources'][n]=dict(base64=base64.b64encode(raw).decode(),sha256=hashlib.sha256(raw).hexdigest())
  return v
 def test_actual_frozen_sources_admit(self):
  self.assertEqual(set(B.validate_request(self.request())),B.UTILITY);self.assertEqual(set(B.validate_request(self.request('prepare'))),set(B.PINS)-B.UTILITY)
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
 def test_run_canonical_rawplan_and_hash_only_before_full_scope_gate(self):
  v=self.request('run');raw=B.encoded(dict(schema='typed-plan'));v.update(planBase64=base64.b64encode(raw).decode(),planSha256=hashlib.sha256(raw).hexdigest());self.assertEqual(B.validate_request(v),{})
  for raw in [raw+b'\n',b'{"duplicate":1,"duplicate":2}']:
   v.update(planBase64=base64.b64encode(raw).decode(),planSha256=hashlib.sha256(raw).hexdigest())
   with self.assertRaises(ValueError):B.validate_request(v)
 def test_original_inventory_and_admission_bytes_hard_bound(self):
  v=self.request();v['sealedInventoryBase64']=base64.b64encode(b'{}').decode()
  with self.assertRaisesRegex(ValueError,'inventory pin'):B.validate_request(v)
  v=self.request();v['priorAdmissionBase64']=base64.b64encode(b'{}').decode()
  with self.assertRaisesRegex(ValueError,'admission pin'):B.validate_request(v)
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
  p=B.properties('run',self.root);self.assertEqual(p['RuntimeMaxSec'],'15min');self.assertEqual(p['MemoryMax'],str(8*1024**3));self.assertEqual(p['LoadCredential'],'stream-plan:'+str(self.root/'reviewed-plan.json'))
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
  pg=types.SimpleNamespace(pw_gid=os.getgid());old=self.root/'old-package';old.mkdir(mode=0o750);package=self.root/'new-package';package.mkdir(mode=0o750);plan=old/'phase4-private-plan.json';plan.write_bytes(B.encoded(dict(schema='pow-audit30-mail-body-private-rehearsal-plan-v1')));plan.chmod(0o440);engine=old/'pow-audit30-mail-body-repair-rehearsal.mjs';engine.write_bytes(b'original fixed source');engine.chmod(0o440);deps=old/'pg-dependencies';deps.mkdir(mode=0o750)
  for rel in ['pg','pg/lib','pg/node_modules']:(deps/rel).mkdir(mode=0o750)
  entry=deps/'pg/lib/index.js';entry.write_bytes(b'module.exports={};');entry.chmod(0o440);node=self.root/'node';node.write_bytes(b'node-fixed');node.chmod(0o555)
  before=B.metadata
  def meta(p):return before(p)|{'uid':0,'gid':pg.pw_gid}
  def inventory(p):
   rows=[];total=0
   for f in sorted([p,*p.rglob('*')],key=lambda f:'.'if f==p else str(f.relative_to(p))):
    if f.is_symlink()or not(f.is_file()or f.is_dir()):raise ValueError('Dependency symlink')
    m=meta(f);kind='directory'if f.is_dir()else'file'
    if m['mode']!=(0o750 if kind=='directory'else 0o440)or(kind=='file'and m['nlink']!=1):raise ValueError('Dependency weak/hardlink')
    r=dict(path='.'if f==p else str(f.relative_to(p)),kind=kind,metadata=m)
    if kind=='file':r['sha256']=hashlib.sha256(f.read_bytes()).hexdigest();total+=m['bytes']
    rows.append(r)
   return dict(schema='pow-audit30-private-pg-dependency-inventory-v1',records=rows,regularBytes=total,entries=len(rows))
  def create(p,raw,mode,gid,uid=0):
   fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
   with os.fdopen(fd,'wb')as f:f.write(raw)
   Path(p).chmod(mode)
  def newdir(p,uid,gid,mode):Path(p).mkdir(mode=mode)
  if change=='hardlink':os.link(entry,self.root/'alias')
  if change=='symlink':entry.unlink();entry.symlink_to(plan)
  if change=='weak-mode':entry.chmod(0o644)
  if change=='existing-target':(package/'phase4-private-plan.json').write_bytes(b'retained')
  mod=types.SimpleNamespace(I=types.SimpleNamespace(collect_pg_dependencies=inventory,NODE=node),G=types.SimpleNamespace(metadata=meta,hash_file=lambda p,**kw:hashlib.sha256(Path(p).read_bytes()).hexdigest()))
  with patch.object(B,'OLDPACKAGE',old),patch.object(B,'metadata',meta),patch.object(B,'PRIVATE_PLAN_SHA',hashlib.sha256(plan.read_bytes()).hexdigest()),patch.object(B,'ORIGINAL_ENGINE_SHA',hashlib.sha256(engine.read_bytes()).hexdigest()),patch.object(B,'create',create),patch.object(B,'newdir',newdir):result=B.prepare(package,pg,mod,{})
  return result,package,old
 def test_fixed_old_complete_dependency_copy_and_new_metadata(self):
  result,package,old=self.prepare_case();self.assertEqual(result['dependencyEntries'],5);self.assertEqual((package/'phase4-private-plan.json').read_bytes(),(old/'phase4-private-plan.json').read_bytes());self.assertTrue(result['sourcePackageUnchanged']);self.assertEqual((package/'pg-dependencies/pg/lib/index.js').read_bytes(),b'module.exports={};');self.assertEqual(stat.S_IMODE((package/'original-transaction-engine.mjs').stat().st_mode),0o440)
 def test_fixed_old_dependency_links_modes_and_reused_destination_refuse(self):
  for change in ['hardlink','symlink','weak-mode','existing-target']:
   with self.subTest(change=change),self.assertRaises((ValueError,FileExistsError)):self.prepare_case(change)
   (self.root/'old-package').rename(self.root/('old-'+change));(self.root/'new-package').rename(self.root/('new-'+change));(self.root/'node').rename(self.root/('node-'+change))

if __name__=='__main__':unittest.main(verbosity=2)
