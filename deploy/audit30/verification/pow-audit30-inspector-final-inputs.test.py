#!/usr/bin/python3 -I
"""Local only. Assembly source inventory is actual; runtime fields synthetic."""
import copy,datetime as dt,hashlib,importlib.util,io,json,os,stat,tempfile,types,unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
A=load('/tmp/pow-audit30-inspector-plan-assemble.py','assemble');P=load('/tmp/pow-audit30-inspector-final-preflight.py','preflight')
class FinalInputsTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def inputs(self):
  inv=A.bound(A.INVENTORY,A.INVENTORY_SHA);now=dt.datetime.now(dt.timezone.utc);I=A.inspector();lock=self.base/'lock';lock.touch(mode=0o600);m=I.G.metadata(lock)
  pf=dict(schema='pow-audit30-inspector-final-preflight-v1',host='pow-bitcoin-01',atUtc=now.isoformat(),backupLock=m,backupWindow=dict(preflightAtUtc=now.isoformat(),nextScheduledAtUtc=(now+dt.timedelta(minutes=90)).isoformat()),liveServices={n:dict(MainPID='10',InvocationID='a'*32) for n in I.G.SERVICES},node=dict(metadata=m|{'uid':0,'mode':0o755},sha256='a'*64),capacity={'/':dict(availableBytes=20*1024**3,availableInodes=1000),'/data':dict(availableBytes=250*1024**3,availableInodes=1000)},productionMutation=False,seconds=1.0)
  prepared=dict(mode='prepare',package='/usr/local/lib/proofofwork-audit30-snapshot-inspect/'+A.RUN,productionMutation=False,privatePlanSha256='b'*64,dependencyInventorySha256='c'*64,pgEntrySha256='d'*64,dependencyEntries=172,dependencyRegularBytes=443205)
  return inv,pf,prepared
 def test_actual_source_inventory_shape_saved_tip_and_canonical_request(self):
  plan,request=A.assemble(*self.inputs());self.assertEqual(plan['idPage'],dict(afterHeight=969524,throughHeight=969526,limit=2,precisionActivationHeight=960601));self.assertEqual(plan['inventory']['sha256'],A.INVENTORY_SHA);self.assertEqual(request['planSha256'],hashlib.sha256(A.encoded(plan)).hexdigest());self.assertFalse(plan['source']==plan['job'])
 def test_stale_window_capacity_host_and_missing_private_authority_refuse(self):
  for change in ('stale','short','data','root','host','prepare','source','node'):
   inv,pf,prepared=self.inputs()
   if change=='stale':pf['atUtc']=pf['backupWindow']['preflightAtUtc']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=16)).isoformat()
   if change=='short':pf['backupWindow']['nextScheduledAtUtc']=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=60)).isoformat()
   if change=='data':pf['capacity']['/data']['availableBytes']=179*1024**3
   if change=='root':pf['capacity']['/']['availableBytes']=9*1024**3
   if change=='host':pf['host']='other'
   if change=='prepare':prepared['productionMutation']=True
   if change=='source':inv['sourceJob']='/data/proofofwork-audit30-restore-20261003T000000Z'
   if change=='node':pf['node']['metadata']['mode']=0o777
   with self.subTest(change=change),self.assertRaises(ValueError):A.assemble(inv,pf,prepared)
 def test_bound_proof_atime_allowed_byte_and_symlink_refuse(self):
  p=self.base/'proof';p.write_bytes(b'{"x":1}');sha=hashlib.sha256(p.read_bytes()).hexdigest();os.utime(p,ns=(1,p.stat().st_mtime_ns));self.assertEqual(A.bound(p,sha),{'x':1});p.write_bytes(b'{"x":2}')
  with self.assertRaises(ValueError):A.bound(p,sha)
  alias=self.base/'alias';alias.symlink_to(p)
  with self.assertRaises(ValueError):A.bound(alias,hashlib.sha256(p.read_bytes()).hexdigest())
 def native_fake(self,change=None):
  lock=self.base/'lock';lock.touch(mode=0o600);node=self.base/'node';node.write_bytes(b'executable');node.chmod(0o755);calls={};original=P.meta
  def meta(path):
   m=original(path)
   if Path(path)==node:m['uid']=0
   return m
  def properties(unit,names):
   calls[unit]=calls.get(unit,0)+1
   row=dict(LoadState='loaded',ActiveState='active',MainPID='10',InvocationID='a'*32)
   if unit.endswith('logical-backup.service'):row['ActiveState']='inactive'
   if unit.endswith('logical-backup.timer'):row['NextElapseUSecRealtime']=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=90)).strftime('%a %Y-%m-%d %H:%M:%S UTC')
   if change=='live' and unit==P.SERVICES[0] and calls[unit]>1:row['MainPID']='11'
   if change=='backup' and unit.endswith('logical-backup.service'):row['ActiveState']='active'
   return {k:row[k] for k in names}
  def fs(path):return types.SimpleNamespace(f_bavail=250*1024**3 if change!='capacity' else 5*1024**3,f_frsize=1,f_favail=1000)
  out=io.StringIO()
  with patch.object(P,'LOCK',lock),patch.object(P,'NODE',node),patch.object(P,'meta',side_effect=meta),patch.object(P,'properties',side_effect=properties),patch.object(P.os,'geteuid',return_value=0),patch.object(P.os,'statvfs',side_effect=fs),patch.object(P.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),redirect_stdout(out):P.main()
  return json.loads(out.getvalue())
 def test_readonly_collector_streamhash_actual_node_and_exact_live(self):
  result=self.native_fake();self.assertEqual(result['node']['sha256'],hashlib.sha256(b'executable').hexdigest());self.assertFalse(result['productionMutation']);self.assertEqual(set(result['liveServices']),set(P.SERVICES))
 def test_readonly_collector_changed_live_backup_or_capacity_refuse(self):
  for change in ('live','backup','capacity'):
   with self.subTest(change=change),self.assertRaises(ValueError):self.native_fake(change)
   (self.base/'lock').unlink();(self.base/'node').unlink()
if __name__=='__main__':unittest.main()
