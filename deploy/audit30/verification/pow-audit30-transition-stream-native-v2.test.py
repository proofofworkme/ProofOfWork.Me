#!/usr/bin/python3 -I
import copy,re,hashlib,importlib.util,io,json,os,signal,struct,subprocess,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-transition-stream-native-v2.py');s=importlib.util.spec_from_file_location('native',P);N=importlib.util.module_from_spec(s);s.loader.exec_module(N);C=N.load_codec()
s=importlib.util.spec_from_file_location('fixture','/tmp/pow-audit30-transition-stream-codec-v2.test.py');F=importlib.util.module_from_spec(s);s.loader.exec_module(F)
def plan():
 base=dict(schema='pow-audit30-private-transition-prototype-plan-v1',privateJob='/data/proofofwork-audit30-inspect-20261003T005512Z',privateSocket='/data/proofofwork-audit30-inspect-20261003T005512Z/socket',privatePort=55432,sourceDatabase='proof_indexer',network='livenet',checkpoint=dict(height=969526,hash='c'*64,transitionHeight=969526,transitionHash='c'*64),sourceFenceSha256='d'*64,sampleRows=copy.deepcopy(F.SAMPLES),columns=copy.deepcopy(C.COLUMNS),precisionMarkerJsonbSendSha256='e'*64)
 triggers=[dict(table=t,name=n,enabled='O',definition='CREATE TRIGGER '+n,functionDefinition='CREATE FUNCTION private_test()')for t,n in [('proof_indexer.meta','work_precision_v2_marker_immutable'),('proof_indexer.work_amo_block_transitions','work_amo_block_transitions_immutable')]]
 return dict(schema=N.PLAN_SCHEMA,base=base,originalTriggers=triggers,envelope=copy.deepcopy(C.DEFAULT),admission=None,profileBinding=None)
def binary_export(parts):
 b=io.BytesIO();N.copy_header(b)
 for i,body in parts:
  N.copy_row(b,[struct.pack('!i',i),struct.pack('!i',len(body)),body])
 b.write(b'\xff\xff');return b.getvalue()
class Tests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.plan=plan()
 def tearDown(self):self.tmp.cleanup()
 def setup_store(self):
  source=self.base/'stream-transitions-source.copy';source.write_bytes(F.raw());source.chmod(0o600);store=self.base/'stream-chunks.sqlite';C.build(source,C.sha(source.read_bytes()),F.COLS,F.CP,F.SAM,store)
  validated=N.validate(self.plan);patched=(validated[0]|{'privateJob':str(self.base)},*validated[1:]);self.ctx=patch.object(N,'validate',return_value=patched);self.ctx.start();self.addCleanup(self.ctx.stop)
  spools=N.prepare_spools(self.plan,store,C.sha(store.read_bytes()));return source,store,spools
 def export_fixture(self,store,modify=None):
  _,_,db=C.open_store(store)
  try:parts=[(i,body)for i,body in db.execute('SELECT ordinal,body FROM parts JOIN chunks USING(sha256)ORDER BY ordinal')]
  finally:db.close()
  if modify:parts=modify(parts)
  out=self.base/'stream-ordered-export.copy';out.write_bytes(binary_export(parts));out.chmod(0o600);return out,parts
 def test_exact_private_capture_and_integer_catalog_layout(self):
  sql=N.capture_sql(self.plan);self.assertIn('REPEATABLE READ READ ONLY',sql);self.assertIn("'typeOid',atttypid::integer,",sql);self.assertIn("current_setting('data_directory')<>'"+self.plan['base']['privateJob']+"/cluster'",sql);self.assertIn("current_setting('default_transaction_read_only')<>'on'",sql);self.assertIn('jsonb_send(value)',sql);self.assertIn('pg_get_triggerdef',sql);self.assertIn('record_send(x)',sql);self.assertIn('67108864',sql)
  self.assertIsNone(re.search(r'(?m)^(CREATE|INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE) ',sql));self.assertNotIn('string_agg',sql)
 def test_wrong_job_socket_port_database_types_and_triggers_refuse(self):
  for key,value in [('privateJob','/var/lib/postgresql/16/main'),('privateSocket','/run/postgresql'),('privatePort',5432),('network','testnet'),('sourceDatabase','postgres')]:
   p=copy.deepcopy(self.plan);p['base'][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):N.validate(p)
  p=copy.deepcopy(self.plan);p['base']['columns'][0]['typeOid']='25'
  with self.assertRaises(ValueError):N.validate(p)
  p=copy.deepcopy(self.plan);p['originalTriggers'].reverse()
  with self.assertRaises(ValueError):N.validate(p)
 def test_plan_default_caps_larger_unadmitted_refuses(self):
  self.assertEqual(N.validate(self.plan)[4],C.DEFAULT);p=copy.deepcopy(self.plan);p['envelope']['sourceBytes']+=1
  with self.assertRaisesRegex(ValueError,'unadmitted'):N.validate(p)
 def test_binary_spools_and_exact_streamed_native_reconstruction(self):
  source,store,spools=self.setup_store();export,parts=self.export_fixture(store);self.assertEqual(export.stat().st_size,spools['meta']['sourceBytes']+22*len(parts)+21)
  result=N.verify_export(self.plan,spools,export,self.base/'native-reconstructed.copy',source);self.assertTrue(result['fullByteEquality']);self.assertFalse(result['mathAccepted']);self.assertEqual((self.base/'native-reconstructed.copy').read_bytes(),source.read_bytes());self.assertEqual(result['framing']['rows'][0]['fieldLengths'][6],-1)
 def test_native_spool_sql_has_small_binary_files_immutable_newside_only(self):
  source,store,spools=self.setup_store();sql=N.side_sql(self.plan,spools);self.assertLess(len(sql),65536);self.assertIn('BEGIN READ WRITE',sql);self.assertIn('CREATE SCHEMA '+N.SCHEMA,sql);self.assertIn('sha256(body)=sha',sql);self.assertIn('STREAM_STORE_IMMUTABLE',sql);self.assertIn('STREAM_STORE_SEALED',sql);self.assertIn('STREAM_META_REFUSAL',sql);self.assertIn('STREAM_MANIFEST_REFUSAL',sql);self.assertIn('STREAM_NATIVE_RELATION_CAP',sql);self.assertEqual(sql.count('WITH (FORMAT binary)'),3)
  for word in ['UPDATE proof_indexer','ALTER TABLE proof_indexer','DELETE FROM proof_indexer','DROP ','TRUNCATE ','string_agg','CREATE SCHEMA IF NOT EXISTS']:self.assertNotIn(word,sql)
 def test_spool_hash_metadata_store_and_exact_filename_tamper_refuse(self):
  source,store,spools=self.setup_store()
  for change in ['sha','metadata','filename','store','capture']:
   p=copy.deepcopy(spools)
   if change=='sha':p['files']['chunks']['sha256']='0'*64
   if change=='metadata':p['files']['parts']['identity'][1]+=1
   if change=='filename':p['files']['parts']['path']=str(self.base/'different.copy')
   if change=='store':p['storeBinding']['sha256']='0'*64
   if change=='capture':p['meta']['checkpointSha256']='0'*64
   with self.subTest(change=change),self.assertRaises(ValueError):N.side_sql(self.plan,p)
 def test_capture_meta_is_bound_in_native_export_too(self):
  source,store,spools=self.setup_store();export,_=self.export_fixture(store);spools['meta']['columnsSha256']='0'*64
  with self.assertRaises(ValueError):N.verify_export(self.plan,spools,export,self.base/'out',source)
  self.assertFalse((self.base/'out').exists())
 def test_reordered_duplicate_missing_or_extra_native_rows_refuse(self):
  source,store,spools=self.setup_store();export,parts=self.export_fixture(store)
  for name,variant in [('gap',[(1,parts[0][1])]),('missing',[]),('extra',parts+parts),('body',[(0,b'wrong')])]:
   export.write_bytes(binary_export(variant))
   with self.subTest(name=name),self.assertRaises(ValueError):N.verify_export(self.plan,spools,export,self.base/name,source)
 def test_bad_native_header_width_null_oversized_truncated_trailing_refuse(self):
  source,store,spools=self.setup_store();export,parts=self.export_fixture(store);raw=export.read_bytes()
  for name,value in [('header',b'bad'),('trunc',raw[:-1]),('trailing',raw+b'x'),('width',raw[:21]+struct.pack('!i',3)+raw[25:]),('null',raw[:37]+struct.pack('!i',-1)+raw[41:])]:
   export.write_bytes(value)
   with self.subTest(name=name),self.assertRaises(ValueError):N.verify_export(self.plan,spools,export,self.base/name,source)
 def test_source_fullbyte_difference_refuses_and_preserves_partial(self):
  source,store,spools=self.setup_store();export,parts=self.export_fixture(store);source.write_bytes(b'x'*source.stat().st_size)
  with self.assertRaises(ValueError):N.verify_export(self.plan,spools,export,self.base/'partial',source)
  self.assertTrue((self.base/'partial').exists())
 def test_spool_and_reconstruction_outputs_never_overwrite(self):
  source,store,spools=self.setup_store()
  with self.assertRaises(FileExistsError):N.prepare_spools(self.plan,store,C.sha(store.read_bytes()))
  export,_=self.export_fixture(store);out=self.base/'keep';out.write_bytes(b'custody');out.chmod(0o600)
  with self.assertRaises(FileExistsError):N.verify_export(self.plan,spools,export,out,source)
  self.assertEqual(out.read_bytes(),b'custody')
 def test_export_and_measurements_no_giant_aggregate_or_hex(self):
  for sql in [N.export_sql(self.plan),N.measurements_sql(self.plan)]:
   self.assertIn('REPEATABLE READ READ ONLY',sql);self.assertNotIn('string_agg',sql);self.assertNotIn('side-reconstructed.hex',sql)
  self.assertIn('ORDER BY p.ordinal',N.export_sql(self.plan));self.assertIn('pg_total_relation_size',N.measurements_sql(self.plan));self.assertIn("'fullSourceHashVerifiedExternally',false",N.measurements_sql(self.plan))
 def child(self,code,maximum=1024,seconds=2,sql=b'SELECT 1;\n',name='child.copy'):
  return N.stream_child([sys.executable,'-I','-B','-c',code],sql,self.base/name,maximum,seconds)
 def test_child_success_complete_bytes_hash_and_custody(self):
  result=self.child("import sys;sys.stdin.buffer.read();sys.stdout.buffer.write(b'\\0\\xff\\n')");self.assertEqual(result['bytes'],3);self.assertEqual(result['sha256'],hashlib.sha256(b'\0\xff\n').hexdigest());self.assertEqual((self.base/'child.copy').read_bytes(),b'\0\xff\n')
 def test_child_stdout_bound_retains_partial_and_stderr_is_hashonly(self):
  with self.assertRaises(N.CaptureFailure)as ctx:self.child("import sys;sys.stdout.buffer.write(b'x'*4096)",maximum=100)
  self.assertTrue((self.base/'child.copy').exists());self.assertGreater(ctx.exception.partial['observedStdoutBytes'],100)
  with self.assertRaises(N.CaptureFailure)as ctx:self.child("import sys;sys.stderr.write('PRIVATE-SENTINEL');sys.exit(3)",name='stderr.copy')
  self.assertNotIn('PRIVATE-SENTINEL',json.dumps(ctx.exception.partial));self.assertEqual(ctx.exception.partial['stderrSha256'],hashlib.sha256(b'PRIVATE-SENTINEL').hexdigest())
 def test_child_unconsumed_stdin_and_unterminated_output_deadline(self):
  before=time.monotonic()
  with self.assertRaises(N.CaptureFailure):self.child('import time;time.sleep(30)',seconds=1,sql=b'x'*65536)
  self.assertLess(time.monotonic()-before,4);self.assertTrue((self.base/'child.copy').exists())
 def test_child_actual_sigterm_preserves_partial_and_restores_handlers(self):
  out=self.base/'signal.copy';code="import importlib.util,signal,threading,time\nfrom pathlib import Path\np=Path("+repr(str(P))+");s=importlib.util.spec_from_file_location('n',p);n=importlib.util.module_from_spec(s);s.loader.exec_module(n);n.load_codec();old=signal.getsignal(signal.SIGTERM);threading.Timer(.15,lambda:signal.raise_signal(signal.SIGTERM)).start()\ntry:n.stream_child(['/usr/bin/python3','-I','-B','-c','import sys,time;sys.stdout.write(\"ok\");sys.stdout.flush();time.sleep(30)'],b'x',"+repr(str(out))+",100,10)\nexcept n.CaptureFailure as e:assert 'SIGTERM' in str(e);assert signal.getsignal(signal.SIGTERM)==old;assert Path("+repr(str(out))+").exists();print('PASS')\nelse:raise RuntimeError('signal ignored')"
  p=subprocess.run([sys.executable,'-I','-B','-Werror','-c',code],capture_output=True,timeout=6);self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout,b'PASS\n');self.assertEqual(out.read_bytes(),b'ok')
 def test_input_bound_invaliddeadline_and_existing_child_output_refuses(self):
  with self.assertRaises(ValueError):self.child('pass',seconds=601)
  (self.base/'child.copy').write_bytes(b'keep')
  with self.assertRaises(FileExistsError):self.child('pass')
  self.assertEqual((self.base/'child.copy').read_bytes(),b'keep')
 def test_pinned_codec_tamper_refuses_before_untrusted_execution(self):
  fake=self.base/'pow-audit30-transition-stream-native-v2.py';fake.write_bytes(P.read_bytes());(self.base/N.CODEC_NAME).write_text('raise RuntimeError("SENTINEL")\n');(self.base/N.CODEC_NAME).chmod(0o600);p=subprocess.run([sys.executable,'-I','-B',str(fake),'--help'],capture_output=True,timeout=3);self.assertNotEqual(p.returncode,0);self.assertIn(b'Pinned codec bytes changed',p.stderr);self.assertNotIn(b'RuntimeError: SENTINEL',p.stderr)
 def test_exact_measured_append_layout_admitted_and_other_order_refuses(self):
  p=copy.deepcopy(self.plan);p['base']['columns']=copy.deepcopy(C.HISTORICAL_COLUMNS);self.assertEqual(N.validate(p)[1],C.encoded(C.HISTORICAL_COLUMNS));sql=N.capture_sql(p);self.assertIn('"name":"payload","typeName":"jsonb","typeOid":3802',sql);p['base']['columns'][0],p['base']['columns'][1]=p['base']['columns'][1],p['base']['columns'][0]
  with self.assertRaises(ValueError):N.validate(p)

if __name__=='__main__':unittest.main(verbosity=2)
