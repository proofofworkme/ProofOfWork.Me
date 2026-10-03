#!/usr/bin/python3 -I
import ast,base64,copy,hashlib,json,os,subprocess,sys,time,types,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-logical-backup-journal-bounded-v1.py')
def module(p):
 m=types.ModuleType('fixture');m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__);return m
N=module(P)
class JournalTests(unittest.TestCase):
 def setUp(self):N.C.DEADLINE=time.monotonic()+90
 def test_embedded_original_v3_exact_and_inert(self):
  self.assertEqual(base64.b64decode(N.ORIGINAL_BASE64,validate=True),Path('/tmp/pow-audit30-logical-backup-rotation-readonly-v3.py').read_bytes());self.assertEqual(N.C.__name__,'c4d99_fixed_definitions');self.assertEqual(N.C.ORIGINAL_SHA if hasattr(N.C,'ORIGINAL_SHA')else N.ORIGINAL_SHA,hashlib.sha256(Path('/tmp/pow-audit30-logical-backup-rotation-readonly-v3.py').read_bytes()).hexdigest())
 def test_original_request_load_without_execution(self):
  r=json.loads(Path('/tmp/pow-audit30-logical-backup-rotation-readonly-request-v3.json').read_bytes());m=N.C.load(r);self.assertEqual(m.PROTECTED_FIELDS_BY_UNIT[m.PRUNE],('LoadState','ActiveState','SubState','InvocationID','UnitFileState'));self.assertEqual(m.FIXED_HASHES[str(m.PIN)],'821b5bbfecee75ffb3c4565d3867eb62ac33e65eeb83c0e603c08aa478ff957b')
 def test_mapping_phrase_is_observational_only(self):
  v=N.classify_stderr(b'Failed to mmap file /private/unexported: Cannot allocate memory\n');self.assertEqual(v['categories'],['allocation-or-mapping-refusal']);self.assertFalse(v['resourceCauseProven']);self.assertNotIn('private',json.dumps(v))
 def test_warning_does_not_become_success(self):
  v=N.classify_stderr(b'Warning: private warning\n');self.assertEqual(v['categories'],['journal-warning-or-hint']);self.assertFalse(v['journalIntegrityProven'])
 def test_integrity_phrase_not_integrity_proof(self):
  v=N.classify_stderr(b'Journal file /private/file is truncated, ignoring file.\n');self.assertEqual(v['categories'],['journal-integrity-message']);self.assertFalse(v['journalIntegrityProven']);self.assertFalse(v['rawStderrExported'])
 def test_unknown_nonutf8_and_access_categories(self):
  for raw,want in((b'Permission denied\n',['permission-or-access-refusal']),(b'opaque secret',['unclassified-stderr']),(b'\xff',['unclassified-stderr']),(b'',[])):
   self.assertEqual(N.classify_stderr(raw)['categories'],want)
 def test_stderr_bound_refuses(self):
  with self.assertRaisesRegex(ValueError,'STDERR_BYTE_BOUND'):N.classify_stderr(b'x'*65537)
 def fake(self,code,out,err,monitor_changed=False):
  live={'original':'fixed'};window={'service':{'MainPID':'0'},'timer':{'public':'window'}};protected={'files':{'static':'hash'},'mask':{'target':'/dev/null'},'units':{'proofofwork-retention-protection.service':{'InvocationID':'1'*32},'pg_receivewal@16-main.service':{'MainPID':'0'},'proofofwork-node-release-prune.timer':{'LoadState':'masked'}}};current=copy.deepcopy(protected)
  if monitor_changed:current['units']['proofofwork-retention-protection.service']['InvocationID']='2'*32
  m=types.SimpleNamespace(live=lambda:live,quiet=lambda:window,read_file=lambda *_:(b'public script',{'fixed':'metadata'}));r={'expectedLive':live};tree={'oct2SetPresent':False,'metadata':'fixed'};ep={'evidence':{'exists':False}};scriptsha=N.sha(b'public script')
  patches=[patch.object(N.C,'SCRIPT_SHA',scriptsha),patch.object(N.C,'chosen_protection',side_effect=[({},protected),({},current)]),patch.object(N.C,'root_census',return_value=tree),patch.object(N.C,'missing_oct2',return_value={'exists':False}),patch.object(N.C,'audit_endpoint',return_value=ep),patch.object(N,'sizing_endpoint',return_value=ep),patch.object(N.C,'captured',return_value=(code,out,err))]
  for p in patches:p.start()
  try:return N.diagnostic(m,r)
  finally:
   for p in reversed(patches):p.stop()
 def test_actual_exit_bytes_hashes_preserved_on_refusal(self):
  v=self.fake(1,b'',b'Cannot allocate memory\n');c=v['journalCommand'];self.assertEqual(c['exitCode'],1);self.assertEqual(c['stderr'],{'bytes':23,'sha256':N.sha(b'Cannot allocate memory\n')});self.assertFalse(c['originalJournalReadAccepted']);self.assertFalse(v['rotationCollectorPassed']);self.assertFalse(v['dumpContentVerified']);self.assertNotIn('Cannot allocate',json.dumps(v))
 def test_exit_zero_warning_remains_original_refusal(self):
  v=self.fake(0,b'journal bytes',b'Hint: public warning\n');self.assertFalse(v['journalCommand']['originalJournalReadAccepted']);self.assertFalse(v['rotationCollectorPassed'])
 def test_clean_zero_still_diagnostic_not_rotation_pass(self):
  raw=json.dumps({'MESSAGE':'private unrecognized line','__REALTIME_TIMESTAMP':'1790997600000000'}).encode()+b'\n';v=self.fake(0,raw,b'');self.assertTrue(v['journalCommand']['originalJournalReadAccepted']);self.assertTrue(v['journalSelectionParsed']);self.assertEqual(v['journalSelection']['records'],1);self.assertFalse(v['rotationCollectorPassed']);self.assertFalse(v['journalHistoryCertified']);self.assertNotIn('private unrecognized line',json.dumps(v))
 def test_fresh_current_monitor_returned_not_static_waiver(self):
  v=self.fake(1,b'',b'other',True);self.assertFalse(v['monitorOperationalTupleUnchanged']);self.assertEqual(v['expectedProtection']['units']['proofofwork-retention-protection.service']['InvocationID'],'2'*32);self.assertTrue(v['staticProtectionBeforeAfterEqual'])
 def test_five_drift_refuses_before_journal(self):
  m=types.SimpleNamespace(live=lambda:{'changed':'five'})
  with patch.object(N.C,'captured',side_effect=AssertionError('journal called')):
   with self.assertRaisesRegex(ValueError,'ORIGINAL_FIVE'):N.diagnostic(m,{'expectedLive':{'original':'five'}})
 def test_fixed_extra_unit_evidence_names(self):
  m=types.SimpleNamespace(show=lambda unit,fields:{'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0','InvocationID':''})
  with patch.object(N.os.path,'lexists',return_value=False):v=N.sizing_endpoint(m)
  self.assertTrue(v['expectedPrelaunchAbsenceObserved']);self.assertEqual(set(v['evidence']['fixedPaths']),set(N.NAMES));self.assertEqual(v['unit'],'proofofwork-audit30-physical-sizing-20261003T095500Z.service')
 def test_no_collect_or_main_and_exact_parser_only(self):
  tree=ast.parse(P.read_bytes());f=next(x for x in tree.body if isinstance(x,ast.FunctionDef)and x.name=='diagnostic');calls={ast.unparse(n.func)for n in ast.walk(f)if isinstance(n,ast.Call)};self.assertNotIn('C.collect',calls);self.assertNotIn('C.main',calls);self.assertIn('C.journal_classification',calls);self.assertIn('C.captured',calls);self.assertIn('C.chosen_protection',calls)
 def test_alarm_before_stdin_and_inherited_as_unchanged(self):
  s=P.read_text();self.assertLess(s.index('signal.setitimer(signal.ITIMER_REAL,90)'),s.index('sys.stdin.buffer.read(65537)'));self.assertIn('1024*1024**2,1024*1024**2',s);self.assertNotIn('setrlimit(resource.RLIMIT_AS,(128',s)
 def test_original_capture_real_child_refusal_hash_input(self):
  N.C.DEADLINE=time.monotonic()+3;code,out,err=N.C.captured([sys.executable,'-I','-B','-c','import sys;sys.stderr.write("Cannot allocate memory\\n");raise SystemExit(1)'],64,2);self.assertEqual((code,out,err),(1,b'',b'Cannot allocate memory\n'));self.assertEqual(N.classify_stderr(err)['categories'],['allocation-or-mapping-refusal'])
 def test_native_bad_role_is_closed_and_no_stdout(self):
  r=subprocess.run([sys.executable,'-I','-B',str(P),'a'*64],input=b'{}',capture_output=True,timeout=3);self.assertEqual(r.returncode,1);self.assertEqual(r.stdout,b'');v=json.loads(r.stderr);self.assertEqual(v['errorClass'],'ValueError');self.assertFalse(v['productionMutation']);self.assertFalse(v['automaticRetry'])
 def test_parse_only_after_zero_and_empty_stderr(self):
  for code,err in ((1,b''),(0,b'Warning: refusal\n'),(1,b'Cannot allocate memory\n')):
   with patch.object(N.C,'journal_classification',side_effect=AssertionError('must not parse')):v=self.fake(code,b'invalid private JSON',err)
   self.assertFalse(v['journalSelectionParsed']);self.assertIsNone(v['journalSelection']);self.assertEqual(v['status'],'observed-command-refusal')
 def test_clean_malformed_duplicate_and_limit_framing_refuses(self):
  raws=[b'not JSON',b'{"MESSAGE":"x","MESSAGE":"y","__REALTIME_TIMESTAMP":"1790997600000000"}\n', (json.dumps({'MESSAGE':'x','__REALTIME_TIMESTAMP':'1790997600000000'}).encode()+b'\n')*2049]
  N.C.DEADLINE=time.monotonic()+90
  for raw in raws:
   with self.subTest(rawSha=N.sha(raw)),self.assertRaises((ValueError,json.JSONDecodeError)):self.fake(0,raw,b'')
 def test_exact_fixed_parser_retention_actions_hash_only(self):
  N.C.DEADLINE=time.monotonic()+90
  message=f'backup_retention_deleted candidate={N.C.ROOT}/{N.C.OCT2} bytes=20525965077 verified_sha256=true restore_catalog=true'
  raw=(json.dumps({'MESSAGE':message,'__REALTIME_TIMESTAMP':'1790997600000000'})+'\n'+json.dumps({'MESSAGE':'backup_retention_unknown PRIVATE','__REALTIME_TIMESTAMP':'1790997600000001'})+'\n').encode();v=self.fake(0,raw,b'');q=v['journalSelection'];self.assertEqual(q,N.C.journal_classification(raw));self.assertEqual(q['publicRotationActions'][0]['action'],'deleted');self.assertFalse(q['recognizedRetentionMessageCoverageCompleteWithinCapturedSelection']);self.assertFalse(q['fullBackupJournalHistoryCertified']);self.assertFalse(q['rawJournalMessagesExported']);self.assertNotIn('PRIVATE',json.dumps(v));self.assertFalse(v['allocationFailureCauseProven'])
 def test_preserved_actual_refusal_fixture_is_not_sole_cause_proof(self):
  p=Path('/tmp/pow-audit30-logical-backup-journal-refusal-diagnostic-native-v1.stdout');raw=p.read_bytes();self.assertEqual(len(raw),12502);self.assertEqual(N.sha(raw),'07824e0892583ee7d0370f2f6f97e85e7376502d23e7895fbadd0b1b7ca320cc');v=json.loads(raw);c=v['journalCommand'];self.assertEqual(c['inheritedAddressSpaceBytes'],128*1024**2);self.assertEqual(c['exitCode'],0);self.assertEqual(c['stdout'],{'bytes':7576,'sha256':'4e6a6d9bf243503c3a44493ab4f84260eb022a2057fb4c665be179719eee7765'});self.assertEqual(c['stderr'],{'bytes':236,'sha256':'c201ab4ef8291ae0c644b2ddbafe2ee7d47499e9a5d882c8519c9693dc064605'});self.assertFalse(c['originalJournalReadAccepted']);self.assertFalse(c['classification']['resourceCauseProven']);self.assertFalse(c['classification']['journalIntegrityProven']);self.assertFalse(v['rotationCollectorPassed'])
 def test_other_guard_definitions_ast_equivalent_and_old_sources_preserved(self):
  old=Path('/tmp/pow-audit30-logical-backup-journal-refusal-diagnostic-v1.py');b=old.read_bytes();self.assertEqual(N.sha(b),'f722e8280597c2754ad6b08f394a85771a3faa5f1852d064b0034c60bf56a737');a={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(b).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};c={n.name:ast.dump(n,include_attributes=False)for n in ast.parse(P.read_bytes()).body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};self.assertEqual(set(a),set(c))
  for k in a:
   if k not in ('main','diagnostic'):self.assertEqual(a[k],c[k],k)
  self.assertEqual(N.sha(Path('/tmp/pow-audit30-logical-backup-rotation-readonly-request-v3.json').read_bytes()),'a20fa1719319c9a5c0059471bcff75bbe101ee502727dd594ea1615125972c00')
 def test_real_inherited_as_readonly_sparse_mmap_reproduction(self):
  import tempfile
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'public-fixture-sparse';p.touch();os.truncate(p,256*1024**2);p.chmod(0o440)
   mapper='import json,mmap,os,resource,sys;fd=os.open(sys.argv[1],os.O_RDONLY);limit=resource.getrlimit(resource.RLIMIT_AS)[0]\ntry:\n m=mmap.mmap(fd,0,access=mmap.ACCESS_READ);print(json.dumps(dict(mapped=True,limit=limit,bytes=len(m),readOnly=True)));m.close()\nexcept OSError as e:print(json.dumps(dict(mapped=False,limit=limit,errno=e.errno,readOnly=True)))\nfinally:os.close(fd)'
   wrapper='import resource,subprocess,sys;limit=int(sys.argv[1]);resource.setrlimit(resource.RLIMIT_AS,(limit,limit));r=subprocess.run([sys.executable,"-I","-B","-c",'+repr(mapper)+',sys.argv[2]],capture_output=True,timeout=3);sys.stdout.buffer.write(r.stdout);sys.stderr.buffer.write(r.stderr);raise SystemExit(r.returncode)'
   rows=[]
   for limit in(128*1024**2,1024*1024**2):
    r=subprocess.run([sys.executable,'-I','-B','-c',wrapper,str(limit),str(p)],capture_output=True,timeout=5);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stderr,b'');v=json.loads(r.stdout);self.assertEqual(v['limit'],limit);self.assertTrue(v['readOnly']);rows.append(v)
   self.assertFalse(rows[0]['mapped']);self.assertEqual(rows[0]['errno'],12);self.assertTrue(rows[1]['mapped']);self.assertEqual(rows[1]['bytes'],256*1024**2)
if __name__=='__main__':unittest.main()
