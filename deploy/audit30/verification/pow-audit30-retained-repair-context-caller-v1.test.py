#!/usr/bin/python3 -I
import ast,base64,contextlib,hashlib,io,json,os,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp');C=P/'pow-audit30-retained-repair-context-transport-preparation-v1.py'
B=P/'pow-audit30-retained-repair-dependency-bridge-transport-preparation-v2.py';T=P/'pow-audit30-retained-repair-dependency-bridge-request-template-v2.json'
def module():
 m=types.ModuleType('caller');m.__file__=str(C);exec(compile(C.read_bytes(),str(C),'exec'),m.__dict__);return m
class CallerTests(unittest.TestCase):
 def test_exact_fixed_sources_and_existing_custody(self):
  m=module();r=m.R.read_bytes();c=json.loads(Path('/home/sixer/ProofOfWork.Me/deploy/audit30/verification/source-custody.json').read_bytes())
  for p,h in((m.N,m.NP),(m.R,m.RP)):
   rows=[x for x in c['files'] if x['originalPath']==str(p)];self.assertEqual(len(rows),1);self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),h);self.assertEqual(rows[0]['sha256'],h);self.assertEqual((Path('/home/sixer/ProofOfWork.Me')/rows[0]['repositoryPath']).read_bytes(),p.read_bytes())
  v=json.loads(r);self.assertEqual(v['nativeSourceSha256'],'ad03e5d02e10018fb7c5dd3c118a7ac876331cad240832c52e4838a4bea0ff2a');self.assertEqual(hashlib.sha256(base64.b64decode(v['nativeSourceBase64'],validate=True)).hexdigest(),v['nativeSourceSha256'])
 def test_caller_fixed_argv_caps_and_no_native(self):
  m=module();calls=[];source=m.N.read_bytes();request=m.R.read_bytes()
  class Fake:
   def bound(self,p,h,cap):
    b=p.read_bytes();self_guard=len(b)<=cap and hashlib.sha256(b).hexdigest()==h
    if not self_guard:raise ValueError('bound')
    return b
   def remote_command(self,b,request_sha=None):
    self_guard=b==source and request_sha is None
    if not self_guard:raise ValueError('extra argv')
    return ['fixed-readonly-remote-no-sha-argv']
   def execute(self,argv,raw,prefix,seconds,**kw):calls.append((argv,raw,prefix,seconds,kw));return {'exitCode':0,'failure':None}
  with patch.object(m,'transport',return_value=Fake()),patch.object(m.sys,'argv',[str(C)]),contextlib.redirect_stdout(io.StringIO()):self.assertEqual(m.main(),0)
  self.assertEqual(len(calls),1);a,r,p,s,kw=calls[0];self.assertEqual(r,request);self.assertEqual(p,'/tmp/pow-audit30-retained-repair-context-native-v1');self.assertEqual(s,90);self.assertEqual((kw['stdout_cap'],kw['stderr_cap']),(65536,65536));self.assertEqual(kw['bindings']['contextAddressSpaceBytes'],128*1024**2);self.assertEqual(kw['bindings']['rootMaximumSeconds'],60);self.assertEqual(kw['bindings']['bridgeAddressSpaceBytesDistinct'],384*1024**2)
 def test_extra_cli_arg_refuses_before_transport(self):
  m=module()
  with patch.object(m,'transport',side_effect=AssertionError('must not reach')),patch.object(m.sys,'argv',[str(C),'extra']):
   with self.assertRaisesRegex(ValueError,'Fixed isolated'):m.main()
 def test_drift_source_refuses_no_transport(self):
  m=module();h=m.transport();self.assertRaises(ValueError,h.bound,m.N,'0'*64,8192)
 def test_native_defs_inert_and_per_unit_profile(self):
  m=module();c=types.ModuleType('context');exec(compile(m.N.read_bytes(),str(m.N),'exec'),c.__dict__);self.assertNotIn('main',c.load_native.__code__.co_names);n=c.load_native(json.loads(m.R.read_bytes(),object_pairs_hook=c.pairs));self.assertEqual(n.PROTECTED_FIELDS_BY_UNIT['proofofwork-node-release-prune.timer'],('LoadState','ActiveState','SubState','InvocationID','UnitFileState'))
  self.assertNotIn('MainPID',n.PROTECTED_FIELDS_BY_UNIT['proofofwork-node-release-prune.timer']);self.assertIn('MainPID',n.PROTECTED_FIELDS_BY_UNIT['pg_receivewal@16-main.service']);self.assertEqual(n.RID,'20261003T093000Z')
 def test_bridge_stays_null_exact_intrinsic_lock(self):
  b=types.ModuleType('bridge_caller');exec(compile(B.read_bytes(),str(B),'exec'),b.__dict__);self.assertIsNone(b.RP);v=json.loads(T.read_bytes());self.assertIsNone(v['expectedLive']);self.assertIsNone(v['expectedProtection']);self.assertEqual(v['backupLockObservationSha256'],'07824e0892583ee7d0370f2f6f97e85e7376502d23e7895fbadd0b1b7ca320cc');self.assertEqual(v['backupLock'],{'bytes':0,'ctimeNs':1790997532936269129,'dev':64514,'gid':112,'ino':7471419,'mode':384,'mtimeNs':1790997532936269129,'nlink':1,'uid':108})
if __name__=='__main__':unittest.main()
