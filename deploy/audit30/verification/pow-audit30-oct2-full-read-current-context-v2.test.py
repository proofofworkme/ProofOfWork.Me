import ast,base64,copy,hashlib,importlib.util,json,os,signal,stat,sys,tempfile,threading,time,types,unittest
from pathlib import Path
from unittest.mock import patch
sp=importlib.util.spec_from_file_location('C','/tmp/pow-audit30-oct2-full-read-current-context-v2.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
def request():return json.loads(Path('/tmp/pow-audit30-oct2-full-read-current-context-request-v2.json').read_bytes())
def live(m):return {u:dict(LoadState='loaded',ActiveState='active',SubState='running',MainPID='77',InvocationID='a'*32)for u in m.LIVE}
def window():return {'service':{'LoadState':'loaded','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':'b'*32},'timer':{'LoadState':'loaded','ActiveState':'active','SubState':'waiting','UnitFileState':'enabled','InvocationID':'c'*32,'NextElapseUSecRealtime':'Sun 2026-10-04 03:18:48 UTC'}}
class FakeContext:
 def __init__(self):
  self.m=C.load_native(request());self.calls=[];self.counts={};self.units={name:{k:''for k in self.m.PROTECTED_FIELDS_BY_UNIT[name]}for name in self.m.PROTECTED}
  self.units[self.m.PRUNE].update(json.loads(Path('/tmp/pow-audit30-oct2-prune-timer-actual-response-fixture-v1.json').read_bytes())['returnedProperties'])
  self.units['pg_receivewal@16-main.service'].update(LoadState='loaded',ActiveState='inactive',MainPID='0',UnitFileState='disabled')
  self.units['proofofwork-retention-protection.service'].update(LoadState='loaded',ActiveState='inactive',MainPID='0',UnitFileState='static')
  self.raw={p:b'proof_indexer-20260929T031853Z.dumpset\n'if p==self.m.PIN else b'known-public-code'for p in self.m.STATIC}
  self.m.FIXED_HASHES={str(p):C.sha(b)for p,b in self.raw.items()}
  self.mask=dict(dev=1,ino=9,uid=0,gid=0,mode=0o777,nlink=1,bytes=9,mtimeNs=1,ctimeNs=1)
 def read(self,p,cap):
  self.calls.append((p,cap));self.counts[p]=self.counts.get(p,0)+1
  mode=0o755 if p in(self.m.CHECKER,self.m.STATIC[4])else 0o600 if p==self.m.STATIC[2]else 0o644
  return self.raw[p],dict(self.mask,mode=mode,bytes=len(self.raw[p]))
 def patches(self,reads=None,lives=None,quiets=None,readlink=None):
  st=types.SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_uid=0,st_gid=0)
  return [patch.object(self.m,'live',side_effect=lives or [live(self.m),live(self.m)]),patch.object(self.m,'quiet',side_effect=quiets or [window(),window()]),patch.object(self.m,'read_file',side_effect=reads or self.read),patch.object(Path,'lstat',return_value=st),patch.object(Path,'resolve',return_value=self.m.MASK.parent),patch.object(self.m,'metadata',return_value=dict(self.mask)),patch.object(os,'readlink',side_effect=readlink or ['/dev/null']*3),patch.object(os,'listxattr',return_value=[]),patch.object(self.m,'show',side_effect=lambda name,fields:copy.deepcopy(self.units[name]))]
 def enter(self,**kwargs):
  from contextlib import ExitStack
  stack=ExitStack()
  for p in self.patches(**kwargs):stack.enter_context(p)
  return stack
class Tests(unittest.TestCase):
 def test_exact_inert_frozen_module_no_native_entrypoint(self):
  with patch('subprocess.run',side_effect=AssertionError('no command during definitions')):m=C.load_native(request())
  self.assertEqual(m.RID,C.RUN);self.assertEqual(m.SOURCE_SHA,'6bafcdb48b1fd0c8da0c23169906f7cd96fbeb374b0333b9c7ca349988abc869');self.assertFalse(m.LAUNCHED);self.assertIsNone(m.OWNED)
 def test_closed_request_source_run_and_base64_refuse(self):
  for kind in('extra','run','hash','source','badbase64'):
   v=request()
   if kind=='extra':v['execute']=True
   elif kind=='run':v['run']='20261003T094000Z'
   elif kind=='hash':v['nativeSourceSha256']='0'*64
   elif kind=='source':v['nativeSourceBase64']=base64.b64encode(b'print("sentinel")').decode()
   else:v['nativeSourceBase64']='!'
   with self.subTest(kind=kind),self.assertRaises(ValueError):C.load_native(v)
 def test_duplicate_json_refuses(self):
  with self.assertRaises(ValueError):json.loads('{"run":1,"run":2}',object_pairs_hook=C.pairs)
 def test_actual_protection_definitions_recheck_all8_three_times_and_no_other_native_calls(self):
  f=FakeContext()
  with f.enter(),patch.object(f.m,'main',side_effect=AssertionError('main forbidden')),patch.object(f.m,'backup_metadata',side_effect=AssertionError('backup forbidden')),patch.object(f.m,'owned_stop',side_effect=AssertionError('control forbidden')):r=C.collect(f.m)
  self.assertEqual(set(r['expectedProtection']['files']),set(map(str,f.m.STATIC)));self.assertEqual(len(f.calls),24);self.assertEqual(set(f.counts.values()),{3});self.assertTrue(all(cap==2097152 for _,cap in f.calls));self.assertEqual(r['expectedLive'],live(f.m));self.assertTrue(r['protectedEndpointEquality']);self.assertFalse(r['sqlExecuted']);self.assertFalse(r['fullBackupReadPerformed']);self.assertFalse(r['unitCreationOrControlPerformed']);self.assertEqual(r['knownHeldAbsencesUnresolved'],18)
 def test_fixed_current_checker_hash_refuses_before_second_read(self):
  f=FakeContext();f.m.FIXED_HASHES[str(f.m.CHECKER)]='0'*64
  with f.enter(),self.assertRaisesRegex(ValueError,'Fixed protected old bytes'):C.collect(f.m)
  self.assertEqual(f.counts[f.m.CHECKER],1)
 def test_exact_protected_preimage_drift_refuses(self):
  f=FakeContext()
  def drift(p,cap):
   raw,m=f.read(p,cap)
   return (b'unknown',dict(m,bytes=7))if p==f.m.CHECKER and f.counts[p]==2 else(raw,m)
  with f.enter(reads=drift),self.assertRaisesRegex(ValueError,'Installed protection bytes or metadata drift'):C.collect(f.m)
 def test_known_mode_refuses_in_original_protection(self):
  f=FakeContext()
  def weak(p,cap):
   raw,m=f.read(p,cap);return raw,dict(m,mode=0o664)if p==f.m.PIN else m
  with f.enter(reads=weak),self.assertRaisesRegex(ValueError,'Fixed installed protection file mode'):C.collect(f.m)
 def test_noncanonical_mask_target_refuses(self):
  f=FakeContext()
  with f.enter(readlink=['/other']),self.assertRaisesRegex(ValueError,'Exact current root prune mask'):C.collect(f.m)
 def test_mask_drift_on_recalc_refuses(self):
  f=FakeContext()
  with f.enter(readlink=['/dev/null','/other']),self.assertRaisesRegex(ValueError,'Exact root prune mask'):C.collect(f.m)
 def test_live_or_timer_changed_between_endpoints_refuses(self):
  for kind in('live','timer'):
   f=FakeContext();l=[live(f.m),live(f.m)];w=[window(),window()]
   if kind=='live':next(iter(l[1].values()))['MainPID']='88'
   else:w[1]['timer']['InvocationID']='d'*32
   with self.subTest(kind=kind),f.enter(lives=l,quiets=w),self.assertRaisesRegex(ValueError,'Current five/window endpoint drift'):C.collect(f.m)
 def test_active_wal_or_unmasked_prune_refuses_original_protection(self):
  for kind in('wal','prune'):
   f=FakeContext();f.units['pg_receivewal@16-main.service'if kind=='wal'else f.m.PRUNE]['ActiveState']='active'
   with self.subTest(kind=kind),f.enter(),self.assertRaises(ValueError):C.collect(f.m)
 def test_actual_main_custom_signal_interrupts_blocking_stdin_and_restores_handlers(self):
  for sig in(signal.SIGINT,signal.SIGTERM):
   readfd,writefd=os.pipe();old=signal.getsignal(sig);started=threading.Event();errors=[]
   def send():
    if not started.wait(1):errors.append('not-started');return
    time.sleep(.02);os.kill(os.getpid(),sig)
   class Read:
    def read(self,n):started.set();return os.read(readfd,n)
   thread=threading.Thread(target=send);thread.start()
   try:
    with patch.object(C.os,'geteuid',return_value=0),patch.object(C.os,'getegid',return_value=0),patch.object(C.os,'uname',return_value=types.SimpleNamespace(nodename='pow-bitcoin-01')),patch.object(C.sys,'argv',['reader']),patch.object(C.sys,'stdin',types.SimpleNamespace(buffer=Read())),patch.object(C.resource,'setrlimit'),self.assertRaises(C.ContextInterrupted):C.main()
    thread.join();self.assertEqual(errors,[]);self.assertIs(signal.getsignal(sig),old)
   finally:thread.join();os.close(readfd);os.close(writefd)
 def test_real_custom_signal_through_frozen_selector_command_reaps_literal_child(self):
  for sig in(signal.SIGINT,signal.SIGTERM):
   m=C.load_native(request());m.DEADLINE=time.monotonic()+5;old=signal.signal(sig,lambda n,f:(_ for _ in()).throw(C.ContextInterrupted('real-selector')))
   with tempfile.TemporaryDirectory()as t:
    marker=Path(t)/'ready';errors=[]
    def send():
     until=time.monotonic()+2
     while not marker.exists()and time.monotonic()<until:time.sleep(.005)
     if not marker.exists():errors.append('not-ready');return
     os.kill(os.getpid(),sig)
    thread=threading.Thread(target=send);thread.start()
    try:
     with self.assertRaises(C.ContextInterrupted):m.command([sys.executable,'-I','-B','-c','import os,pathlib,sys,time;pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(4)',str(marker)])
     thread.join();self.assertEqual(errors,[])
     with self.assertRaises(ProcessLookupError):os.kill(int(marker.read_text()),0)
    finally:thread.join();signal.signal(sig,old)
 def test_all_inert_and_legacy_sources_remain_exact(self):
  self.assertEqual(C.sha(Path('/tmp/pow-audit30-oct2-full-read-native-v2.py').read_bytes()),C.NATIVE_SHA)
  self.assertEqual(C.sha(Path('/tmp/pow-audit30-latest-backup-full-read-v1.py').read_bytes()),'6bafcdb48b1fd0c8da0c23169906f7cd96fbeb374b0333b9c7ca349988abc869')
  self.assertEqual(C.sha(Path('/tmp/pow-audit30-old-proof-native-controller-v1.py').read_bytes()),'b6cdf0f1fe78e4124a3afc1c8abd25247708e32d55cab7a454075bdd082b3837')
 def test_actual_captured_timer_profile_is5_exact_no_mainpid_while_services_keep6(self):
  actual=Path('/tmp/pow-audit30-node-release-read-only-preflight-v4.json.stdout').read_bytes();self.assertEqual(C.sha(actual),'64a4c800c7a4cf8a1dfa3e697fd6c401e01169be0e23146879360402babbac41')
  f=FakeContext();captured=json.loads(actual)['units'][f.m.PRUNE];self.assertEqual(f.units[f.m.PRUNE],{k:captured[k]for k in f.m.PROTECTED_FIELDS_BY_UNIT[f.m.PRUNE]});self.assertNotIn('MainPID',f.units[f.m.PRUNE])
  for name in f.m.PROTECTED:
   if name!=f.m.PRUNE:self.assertIn('MainPID',f.units[name]);self.assertEqual(len(f.units[name]),6)
  with f.enter():r=C.collect(f.m)
  self.assertEqual(r['expectedProtection']['units'][f.m.PRUNE],f.units[f.m.PRUNE])
 def test_original_sources_and_actual_failed_capture_remain_unchanged(self):
  self.assertEqual(C.sha(Path('/tmp/pow-audit30-oct2-full-read-native-v1.py').read_bytes()),'77239102d9fd6a3d10b7dfa4ee0f26055ce0ccc40b15451e888f76e38f4a47f6')
  self.assertEqual(C.sha(Path('/tmp/pow-audit30-oct2-full-read-current-context-v1.py').read_bytes()),'0378a890811ee0e3ac23524a3bda6861e6766406b81952f96674d7108a0aeef4')
  raw=Path('/tmp/pow-audit30-oct2-full-read-current-context-native-v1.stderr').read_bytes();self.assertEqual(C.sha(raw),'cc4647d7865d32f798c7543b285db8000fbd36a87a8ef650cec077056dfb2c12');self.assertEqual(json.loads(raw)['reasonSha256'],'e5706bf8925b07c72e5d4e848169f3f8fcf05d37c105ef98ba12fa091006b17a')
if __name__=='__main__':unittest.main()
