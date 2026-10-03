#!/usr/bin/python3 -I
import base64,datetime,hashlib,json,os,signal,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest import mock
P=Path('/tmp/pow-audit30-logical-backup-rotation-readonly-v2.py');M=types.ModuleType('census');M.__file__=str(P);exec(compile(P.read_bytes(),str(P),'exec'),M.__dict__)
CONTEXT=Path('/tmp/pow-audit30-oct2-full-read-current-context-native-v2.stdout');CONTEXT_SHA='b72fef3b0ca4ab6e01a224f9e7d3372fecf8f738ecd757b1b0c454f0341dcae0'
class Fixture(unittest.TestCase):
 def setUp(self):M.DEADLINE=time.monotonic()+90
 def line(self,msg,**kw):return json.dumps({'MESSAGE':msg,'__REALTIME_TIMESTAMP':'1790997600000000',**kw}).encode()+b'\n'
 def action(self,kind='deleted',name=M.OCT2):return f'backup_retention_{kind} candidate={M.ROOT}/{name} bytes=20525965077 verified_sha256=true restore_catalog=true'
 def make_tree(self,d):
  root=Path(d)/'logical';root.mkdir(mode=0o700)
  for name in (M.OLD,'proof_indexer-20261003T031852Z.dumpset'):
   p=root/name;p.mkdir(mode=0o700)
   for f in ('proof_indexer.dump','globals.sql'):(p/f).write_bytes(b'never-exported-body') ;(p/f).chmod(0o600)
   (p/'SHA256SUMS').write_bytes(b'a'*64+b'  proof_indexer.dump\n'+b'b'*64+b'  globals.sql\n');(p/'SHA256SUMS').chmod(0o600)
  return root
 def test_declared_manifest_exact(self):self.assertEqual(set(M.manifest_value(b'a'*64+b'  proof_indexer.dump\n'+b'b'*64+b'  globals.sql\n')),{'proof_indexer.dump','globals.sql'})
 def test_manifest_duplicate_refused(self):
  with self.assertRaisesRegex(ValueError,'Duplicate'):M.manifest_value((b'a'*64+b'  globals.sql\n')*2)
 def test_manifest_unknown_and_missing_newline_refused(self):
  for raw in (b'a'*64+b'  evil\n'+b'b'*64+b'  globals.sql\n',b'a'*64+b'  proof_indexer.dump\n'+b'b'*64+b'  globals.sql'):
   with self.assertRaises(ValueError):M.manifest_value(raw)
 def test_full_flat_census_and_absence_qualified(self):
  with tempfile.TemporaryDirectory()as d:
   root=self.make_tree(d)
   with mock.patch.object(M,'ROOT',root),mock.patch.object(M,'OWNER',(os.getuid(),os.getgid())):
    v=M.root_census();self.assertFalse(v['oct2SetPresent']);self.assertTrue(v['oldPinnedSetPresent']);self.assertEqual(len(v['completeSets']),2)
    s=json.dumps(v);self.assertNotIn('never-exported-body',s);self.assertFalse(v['completeSets'][M.OLD]['dumpAndGlobalsContentHashedNow'])
 def test_extra_complete_member_refused(self):
  with tempfile.TemporaryDirectory()as d:
   root=self.make_tree(d);(root/M.OLD/'extra').write_bytes(b'x')
   with mock.patch.object(M,'ROOT',root),mock.patch.object(M,'OWNER',(os.getuid(),os.getgid())),self.assertRaisesRegex(ValueError,'three members'):M.root_census()
 def test_symlink_hardlink_and_unsafe_mode_refused(self):
  for which in ('symlink','hardlink','mode'):
   with tempfile.TemporaryDirectory()as d:
    root=self.make_tree(d);p=root/M.OLD/'globals.sql'
    if which=='symlink':p.unlink();p.symlink_to(root/M.OLD/'proof_indexer.dump')
    elif which=='hardlink':os.link(p,Path(d)/'outside')
    else:p.chmod(0o644)
    with mock.patch.object(M,'ROOT',root),mock.patch.object(M,'OWNER',(os.getuid(),os.getgid())),self.assertRaisesRegex(ValueError,'authority'):M.root_census()
 def test_manifest_path_drift_refused(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'SHA256SUMS';p.write_bytes(b'a'*64+b'  proof_indexer.dump\n'+b'b'*64+b'  globals.sql\n');p.chmod(0o600);actual=M.info;n=[0]
   def drift(*a,**k):
    v=actual(*a,**k);n[0]+=1
    if n[0]>1:v['mtimeNs']+=1
    return v
   with mock.patch.object(M,'OWNER',(os.getuid(),os.getgid())),mock.patch.object(M,'info',drift),self.assertRaisesRegex(ValueError,'path drift'):M.manifest_read(p)
 def test_root_entry_bound_refused(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d)/'logical';root.mkdir(mode=0o700)
   for i in range(65):(root/str(i)).touch()
   with mock.patch.object(M,'ROOT',root),mock.patch.object(M,'OWNER',(os.getuid(),os.getgid())),self.assertRaisesRegex(ValueError,'entry cap'):M.root_census()
 def test_rotation_kept_deleted_preserved_no_raw(self):
  raw=self.line(self.action())+self.line(self.action('kept','proof_indexer-20261003T031852Z.dumpset'))+self.line(f'backup_retention_review candidate={M.ROOT}/{M.OLD} reason=operator-pin-or-unavailable-policy action=preserve')+self.line('PRIVATE MESSAGE NEVER EXPORT')
  v=M.journal_classification(raw);self.assertEqual([x['action']for x in v['publicRotationActions']],['deleted','kept','preserve']);self.assertTrue(v['recognizedRetentionMessageCoverageCompleteWithinCapturedSelection']);self.assertNotIn('PRIVATE MESSAGE',json.dumps(v))
 def test_unknown_retention_retained_as_hash_qualified(self):
  v=M.journal_classification(self.line('backup_retention_new arbitrary SECRET'));self.assertFalse(v['recognizedRetentionMessageCoverageCompleteWithinCapturedSelection']);self.assertEqual(len(v['unrecognizedRetentionMessages']),1);self.assertNotIn('SECRET',json.dumps(v))
 def test_journal_limit_sentinel_refused(self):
  with self.assertRaisesRegex(ValueError,'truncated'):M.journal_classification(self.line('x')*2049)
 def test_journal_duplicate_timestamp_range_invalid_refused(self):
  raws=[b'{"MESSAGE":"x","MESSAGE":"y","__REALTIME_TIMESTAMP":"1790997600000000"}\n',self.line('x',__REALTIME_TIMESTAMP='1791072000000000'),self.line('x',_SYSTEMD_INVOCATION_ID='bad'),json.dumps({'MESSAGE':[1,2],'__REALTIME_TIMESTAMP':'1790997600000000'}).encode()]
  for raw in raws:
   with self.assertRaises(ValueError):M.journal_classification(raw)
 def test_actual_context_inert_load_no_main(self):
  raw=CONTEXT.read_bytes();self.assertEqual(M.sha(raw),CONTEXT_SHA);v=json.loads(raw);managed=Path('/tmp/pow-audit30-oct2-full-read-native-v2.py').read_bytes();r=dict(schema='pow-audit30-logical-backup-rotation-readonly-request-v1',managedSourceSha256=M.M_SHA,managedSourceBase64=base64.b64encode(managed).decode(),expectedLive=v['expectedLive'],expectedProtection=v['expectedProtection']);m=M.load(r);self.assertEqual(m.PROTECTED_FIELDS_BY_UNIT[m.PRUNE],('LoadState','ActiveState','SubState','InvocationID','UnitFileState'));self.assertIsNone(m.ARGV)
 def test_inert_tamper_and_duplicate_refuse(self):
  with self.assertRaises(ValueError):M.load({'schema':'bad'})
  with self.assertRaises(ValueError):json.loads(b'{"x":1,"x":2}',object_pairs_hook=M.pairs)
 def test_actual_local_capture_success_and_stderr_private(self):
  code,out,err=M.captured([sys.executable,'-I','-B','-c','import sys;print("ok");print("err",file=sys.stderr)'],256,2);self.assertEqual((code,out,err),(0,b'ok\n',b'err\n'))
 def test_real_capture_oversize_reaps(self):
  with self.assertRaisesRegex(ValueError,'channel cap'):M.captured([sys.executable,'-I','-B','-c','import sys,time;sys.stdout.write("x"*8192);sys.stdout.flush();time.sleep(30)'],1024,2)
 def test_real_absolute_command_deadline(self):
  start=time.monotonic()
  with self.assertRaisesRegex(ValueError,'deadline'):M.captured([sys.executable,'-I','-B','-c','import time;time.sleep(30)'],1024,.08)
  self.assertLess(time.monotonic()-start,2)
 def test_real_signal_during_blocked_selector_reaps(self):
  with tempfile.TemporaryDirectory()as d:
   pid=Path(d)/'pid';ready=Path(d)/'ready';result=Path(d)/'result';child=f'import os,time;open({str(pid)!r},"w").write(str(os.getpid()));open({str(ready)!r},"w").write("ready");time.sleep(30)'
   script=f'import types,time,signal,sys\nfrom pathlib import Path\nm=types.ModuleType("c");m.__file__={str(P)!r};exec(compile(Path(m.__file__).read_bytes(),m.__file__,"exec"),m.__dict__);m.DEADLINE=time.monotonic()+5\ndef stop(n,f):raise m.CensusInterrupted("signal")\nsignal.signal(signal.SIGTERM,stop)\ntry:m.captured([sys.executable,"-I","-B","-c",{child!r}],1024,5)\nexcept m.CensusInterrupted:Path({str(result)!r}).write_text("interrupted")\n'
   p=subprocess.Popen([sys.executable,'-I','-B','-c',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   try:
    end=time.monotonic()+3
    while not ready.exists()and time.monotonic()<end:time.sleep(.01)
    self.assertTrue(ready.exists());p.send_signal(signal.SIGTERM);out,err=p.communicate(timeout=3);self.assertEqual(p.returncode,0,(out,err));self.assertEqual(result.read_text(),'interrupted')
    with self.assertRaises(ProcessLookupError):os.kill(int(pid.read_text()),0)
   finally:
    if p.poll()is None:p.kill();p.wait()
    p.stdout.close();p.stderr.close()
 def test_actual_missing_oct2_reason_and_present_endpoint(self):
  with tempfile.TemporaryDirectory()as d:
   root=self.make_tree(d)
   with mock.patch.object(M,'ROOT',root):
    v=M.missing_oct2();self.assertFalse(v['exists']);self.assertEqual(v['errno'],2);self.assertEqual(v['reasonSha256'],M.sha(str(FileNotFoundError(2,'No such file or directory',str(root/M.OCT2))).encode()));(root/M.OCT2).mkdir(mode=0o700);self.assertTrue(M.missing_oct2()['exists'])
 def test_all_five_evidence_paths_absence_and_appearance(self):
  with tempfile.TemporaryDirectory()as d:
   path=Path(d)/'not-created';m=types.SimpleNamespace(show=lambda *a:dict(LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',InvocationID=''))
   with mock.patch.object(M,'EVIDENCE',path):
    v=M.audit_endpoint(m);self.assertFalse(v['evidence']['exists']);self.assertEqual(set(v['evidence']['fixedPaths']),{'intent.json','full-read.json','stderr.log','completed.json','failed.json'});self.assertTrue(all(not x['exists']for x in v['evidence']['fixedPaths'].values()))
 def test_chosen_monitor_invocation_only_update(self):
  v=json.loads(CONTEXT.read_bytes());old=v['expectedProtection'];mon='proofofwork-retention-protection.service';current=dict(old['units'][mon]);current['InvocationID']='a'*32;current['ActiveState']='inactive';current['SubState']='dead';current['MainPID']='0';current['UnitFileState']='static';m=types.SimpleNamespace(PROTECTED_FIELDS_BY_UNIT={mon:tuple(current)},show=lambda *a:current,protection=lambda x:x)
  expected,protection=M.chosen_protection(m,{'expectedProtection':old});self.assertEqual(expected['units'][mon],current);self.assertEqual(protection,expected);self.assertEqual(old['units'][mon],v['expectedProtection']['units'][mon]);self.assertNotEqual(old['units'][mon]['InvocationID'],expected['units'][mon]['InvocationID'])
 def test_monitor_active_unknown_missing_wrong_role_refuse(self):
  old=json.loads(CONTEXT.read_bytes())['expectedProtection'];mon='proofofwork-retention-protection.service';current=dict(old['units'][mon]);current.update(LoadState='loaded',ActiveState='inactive',SubState='dead',MainPID='0',UnitFileState='static',InvocationID='a'*32)
  for bad in ({'MainPID':'7'},{'ActiveState':'active','SubState':'running'},{'LoadState':'not-found'},{'UnitFileState':'enabled'},{'InvocationID':'bad'},{'extra':'x'}):
   c=current|bad;m=types.SimpleNamespace(PROTECTED_FIELDS_BY_UNIT={mon:tuple(current)},show=lambda *a:c,protection=lambda x:x)
   with self.assertRaises(ValueError):M.chosen_protection(m,{'expectedProtection':old})
  c=dict(current);del c['MainPID'];m=types.SimpleNamespace(PROTECTED_FIELDS_BY_UNIT={mon:tuple(current)},show=lambda *a:c,protection=lambda x:x)
  with self.assertRaises(ValueError):M.chosen_protection(m,{'expectedProtection':old})
 def test_closed_profile_tampering_refused(self):
  v=json.loads(CONTEXT.read_bytes());r=dict(schema='pow-audit30-logical-backup-rotation-readonly-request-v1',managedSourceSha256=M.M_SHA,managedSourceBase64=base64.b64encode(Path('/tmp/pow-audit30-oct2-full-read-native-v2.py').read_bytes()).decode(),expectedLive=v['expectedLive'],expectedProtection=v['expectedProtection']);r['expectedProtection']['units']['proofofwork-node-release-prune.timer']['MainPID']='0'
  with self.assertRaisesRegex(ValueError,'profile'):M.load(r)
 def test_command_scope_no_control_no_dumpread(self):
  self.assertEqual(M.JOURNAL_ARGV[0],'/usr/bin/journalctl');self.assertEqual(M.JOURNAL_ARGV[1],'--unit=proofofwork-postgres-logical-backup.service');s=P.read_text();self.assertNotIn('systemd-run',s);self.assertNotIn("'/usr/bin/pg_restore'",s);self.assertNotIn("'/usr/bin/psql'",s)
if __name__=='__main__':unittest.main()
