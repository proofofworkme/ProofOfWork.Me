import base64,copy,hashlib,importlib.util,json,os,pathlib,stat,tempfile,time,types,unittest
from unittest.mock import patch
P=pathlib.Path
spec=importlib.util.spec_from_file_location('safe_census','/tmp/pow-audit30-onhost-math-safe-input-census-completion-v2.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
U=P('/tmp/pow-audit30-onhost-math-source-copy-v3.py').read_bytes();M=P('/tmp/pow-audit30-onhost-math-managed-completion-v2.py').read_bytes()
specu=importlib.util.spec_from_file_location('stamp_utility','/tmp/pow-audit30-onhost-math-source-copy-v3.py');C=importlib.util.module_from_spec(specu);specu.loader.exec_module(C)
def request():
 t=json.loads(P('/tmp/pow-audit30-onhost-math-source-finalize-request-v2.json').read_bytes())
 return dict(schema='pow-audit30-onhost-math-safe-input-request-completion-v2',utilityBase64=base64.b64encode(U).decode(),managedBase64=base64.b64encode(M).decode(),streamCompletedSha256='a'*64,streamIntentSha256='b'*64,**{k:t[k]for k in('nodeMetadata','attestorMetadata','publisherMetadata')},liveFive={k:dict(MainPID='10',InvocationID='c'*32)for k in S.LIVE})
def structures():
 inputs={s:dict(bytes=10,sha256=('a'if s in('.copy','.reconstructed.copy')else str(i))*64)for i,s in enumerate(S.SUFFIXES)}
 cp=dict(network='livenet',height=S.ROWS[-1]['height'],hash=S.ROWS[-1]['hash'],sourceFenceSha256=S.SOURCE_FENCE_SHA,sampleRowKeysSha256=S.sha(json.dumps(S.ROWS,separators=(',',':')).encode()))
 snap=dict(height=cp['height'],hash=cp['hash'],transitionHeight=cp['height'],transitionHash=cp['hash'])
 base=dict(schema='pow-audit30-private-transition-prototype-plan-v1',privateJob=str(S.JOB),privateSocket=str(S.JOB/'socket'),privatePort=55432,sourceDatabase='proof_indexer',network='livenet',checkpoint=snap,sourceFenceSha256=S.SOURCE_FENCE_SHA,sampleRows=S.ROWS,columns=S.COLUMNS,precisionMarkerJsonbSendSha256='f'*64)
 context=dict(schema='pow-audit30-stream-native-oracle-inputs-v1',privateJob=str(S.JOB),evidenceDirectory=str(S.STREAM),prefix='native',basePlan=base,envelope=S.ENVELOPE,sourceFenceSha256=S.SOURCE_FENCE_SHA,sourceSnapshot=snap,sampleRows=S.ROWS,fullColumns=S.COLUMNS,markerJsonbSendSha256='f'*64,sourceSha256='a'*64,reconstructedSha256='a'*64,fullByteEquality=True,bindings=[dict(fileName='native'+s,**inputs[s])for s in S.SUFFIXES if s!='.context.json'],precisionPins='Separate source-reviewed immutable-marker/arithmetic operator; not invented by codec',mathAccepted=False,allHistoricalReplay=False)
 return copy.deepcopy((context,S.COLUMNS,cp,inputs))
class Shape(unittest.TestCase):
 def setUp(self):self.ctx,self.cols,self.cp,self.inputs=structures()
 def ok(self):return S.structural(self.ctx,self.cols,self.cp,self.inputs)
 def refuse(self,code):
  with self.assertRaisesRegex(S.Refused,code):self.ok()
 def test_valid_closed_structural_metadata(self):self.assertTrue(self.ok())
 def test_full_context_private_payload_refused(self):self.ctx['closingTokenState']={'secret':'data'};self.refuse('CONTEXT_FIELDS')
 def test_nested_unknown_base_payload_refused(self):self.ctx['basePlan']['payload']={};self.refuse('BASE_PLAN_KEYS')
 def test_foreign_sample_height_hash_refused(self):self.ctx['sampleRows'][0]['hash']='b'*64;self.refuse('MEASURED_SCOPE')
 def test_sample_order_refused(self):self.ctx['sampleRows'].reverse();self.refuse('MEASURED_SCOPE')
 def test_fresh_or_arbitrary_column_order_refused(self):self.cols[23],self.cols[25]=self.cols[25],self.cols[23];self.refuse('HISTORICAL_COLUMNS')
 def test_oid_string_refused(self):self.cols[0]['typeOid']='25';self.refuse('HISTORICAL_COLUMNS')
 def test_column_extra_private_field_refused(self):self.cols[0]['value']='raw';self.refuse('HISTORICAL_COLUMNS')
 def test_checkpoint_extra_state_refused(self):self.cp['payload']='raw';self.refuse('EXACT_CHECKPOINT')
 def test_checkpoint_sample_encoding_mismatch(self):self.cp['sampleRowKeysSha256']=S.sha(S.encoded(S.ROWS));self.refuse('EXACT_CHECKPOINT')
 def test_changed_saved_transition_checkpoint(self):self.ctx['sourceSnapshot']['transitionHeight']-=1;self.refuse('SAVED_SNAPSHOT')
 def test_alternate_envelope_refused(self):self.ctx['envelope']['rowBytes']*=2;self.refuse('MEASURED_SCOPE')
 def test_mismatched_reconstruction_refused(self):self.inputs['.reconstructed.copy']['sha256']='b'*64;self.refuse('NATIVE_HASHES')
 def test_context_binding_byte_length_mismatch(self):self.ctx['bindings'][0]['bytes']+=1;self.refuse('SIX_BINDINGS')
 def test_duplicate_binding_refused(self):self.ctx['bindings'][-1]=self.ctx['bindings'][0];self.refuse('SIX_BINDINGS')
 def test_full_math_claim_refused(self):self.ctx['mathAccepted']=True;self.refuse('INVENTED_MATH')
 def test_marker_hash_injection_refused(self):self.ctx['markerJsonbSendSha256']='raw-private-text';self.refuse('NATIVE_HASHES')
 def test_private_socket_redirect_refused(self):self.ctx['basePlan']['privateSocket']='/run/postgresql';self.refuse('BASE_PLAN_SCOPE')
 def test_port_bool_refused(self):self.ctx['basePlan']['privatePort']=True;self.refuse('BASE_PLAN_SCOPE')
class Requests(unittest.TestCase):
 def test_exact_inert_sources(self):self.assertEqual(S.validate_request(request()),[U,M]);S.load([U,M]);self.assertEqual(S.C.PG_GID,112)
 def test_missing_actual_stream_pins_refuses_before_import(self):
  r=request();r['streamCompletedSha256']=None
  with patch.object(S,'load')as load:
   with self.assertRaisesRegex(S.Refused,'ACTUAL_STREAM_PINS'):S.validate_request(r)
   load.assert_not_called()
 def test_managed_byte_tamper(self):
  r=request();r['managedBase64']=base64.b64encode(M+b'\n').decode()
  with self.assertRaisesRegex(S.Refused,'INERT_SOURCE'):S.validate_request(r)
 def test_live_missing_identity_refused(self):
  r=request();r['liveFive'][S.LIVE[0]]['InvocationID']=''
  with self.assertRaisesRegex(S.Refused,'LIVE_SHAPE'):S.validate_request(r)
 def test_duplicate_json_refuses(self):
  with self.assertRaisesRegex(S.Refused,'DUPLICATE'):S.parse(b'{"a":1,"a":2}')
 def test_marker_and_copy_not_structurally_readable(self):
  for s in('.copy','.reconstructed.copy','.marker.copy','.marker-value.json'):
   with self.subTest(s=s),self.assertRaisesRegex(S.Refused,'ALLOWLIST'):S.structural_read(s,dict(bytes=1,sha256='a'*64))
class Files(unittest.TestCase):
 def setUp(self):S.C=C;C.DEADLINE=time.monotonic()+10;self.tmp=tempfile.TemporaryDirectory();self.p=P(self.tmp.name)/'raw';self.p.write_bytes(b'\x00full\xffstate'*10000);self.p.chmod(0o600)
 def tearDown(self):self.tmp.cleanup();C.DEADLINE=None
 def read(self,limit=2*1024**2):return S.file_hash(self.p,limit,os.getuid(),os.getgid(),0o600)
 def test_genuine_binary_hash_no_json_parse_and_no_atime(self):
  os.utime(self.p,ns=(1,self.p.stat().st_mtime_ns));before=self.p.stat().st_atime_ns
  with patch.object(S,'parse',side_effect=AssertionError('binary parsed')):r=self.read()
  self.assertEqual(r['sha256'],hashlib.sha256(self.p.read_bytes()).hexdigest());self.assertEqual(before,1)
  # The hash read used O_NOATIME; independent test read above may advance it.
 def test_genuine_no_atime_advance(self):
  os.utime(self.p,ns=(1,self.p.stat().st_mtime_ns));self.read();self.assertEqual(self.p.stat().st_atime_ns,1)
 def test_hardlink_refused(self):os.link(self.p,self.p.with_name('hard'));self.assertRaisesRegex(S.Refused,'AUTHORITY',self.read)
 def test_symlink_refused(self):old=self.p;self.p=self.p.with_name('alias');self.p.symlink_to(old);self.assertRaisesRegex(S.Refused,'AUTHORITY',self.read)
 def test_mode_or_size_refused(self):self.p.chmod(0o644);self.assertRaisesRegex(S.Refused,'AUTHORITY',self.read)
 def test_cap_refused(self):self.assertRaisesRegex(S.Refused,'AUTHORITY',self.read,10)
 def test_inode_replacement_during_hash_refused(self):
  real=os.read;changed=False
  def altered(fd,n):
   nonlocal changed
   b=real(fd,n)
   if b and not changed:
    replacement=self.p.with_name('replacement');replacement.write_bytes(b'x'*self.p.stat().st_size);replacement.chmod(0o600);os.replace(replacement,self.p);changed=True
   return b
  with patch.object(S.os,'read',altered),self.assertRaisesRegex(S.Refused,'CHANGED'):self.read()
 def test_deadline_interrupts_hash(self):C.DEADLINE=time.monotonic()-1;self.assertRaises(C.Refused,self.read)
class Collection(unittest.TestCase):
 def setUp(self):self.r=request();self.ctx,self.cols,self.cp,self.inputs=structures();S.C=types.SimpleNamespace(check_tools=lambda r:None);S.A=types.SimpleNamespace(live=lambda r:None,stopped=lambda:True)
 def records(self):return {s:{**self.inputs[s],'metadata':dict(ino='1')}for s in S.SUFFIXES}
 def test_closed_output_no_marker_value(self):
  rows=self.records();values={'.columns.json':self.cols,'.checkpoint.json':self.cp,'.context.json':self.ctx}
  with patch.object(S,'fence',return_value={'same':True}),patch.object(S,'file_hash',side_effect=lambda p,cap:rows[str(p).removeprefix(str(S.STREAM/'native'))]),patch.object(S,'structural_read',side_effect=lambda s,row:values[s]):
   v=S.collect(self.r);self.assertFalse(v['copyOrMarkerValueExported']);self.assertEqual(v['safeInputCensusSha256'],S.digest(v['safeInputCensus']));self.assertEqual(set(v['safeInputCensus']['inputs']),set(S.SUFFIXES))
 def test_authority_drift_refuses(self):
  rows=self.records();values={'.columns.json':self.cols,'.checkpoint.json':self.cp,'.context.json':self.ctx}
  with patch.object(S,'fence',side_effect=[{'same':True},{'same':False}]),patch.object(S,'file_hash',side_effect=lambda p,cap:rows[str(p).removeprefix(str(S.STREAM/'native'))]),patch.object(S,'structural_read',side_effect=lambda s,row:values[s]),self.assertRaisesRegex(S.Refused,'FINAL_AUTHORITY_CHANGED'):S.collect(self.r)
 def test_original_stream_gate_precedes_all_capture_reads(self):
  with patch.object(S,'fence',side_effect=S.Refused('incomplete stream')),patch.object(S,'file_hash')as capture,self.assertRaises(S.Refused):S.collect(self.r)
  capture.assert_not_called()
 def test_second_full_capture_pass_required(self):
  rows=self.records();values={'.columns.json':self.cols,'.checkpoint.json':self.cp,'.context.json':self.ctx};i=0
  def captured(p,cap):
   nonlocal i
   i+=1;r=copy.deepcopy(rows[str(p).removeprefix(str(S.STREAM/'native'))])
   if i>7:r['metadata']['ino']='2'
   return r
  with patch.object(S,'fence',return_value={'same':True}),patch.object(S,'file_hash',side_effect=captured),patch.object(S,'structural_read',side_effect=lambda s,row:values[s]),self.assertRaisesRegex(S.Refused,'FINAL_INPUT_CHANGED'):S.collect(self.r)
class NewNamespace(unittest.TestCase):
 def test_completion_scope_and_managed_provenance_hook(self):
  S.load([U,M]);self.assertEqual(S.STREAM,S.JOB/'stream-completion-v2');self.assertTrue(hasattr(S.A,'prior_fence'));self.assertTrue(hasattr(S.A,'previous_completion_fence'));self.assertEqual(S.A.STREAM,S.STREAM)
 def test_old_evidence_context_refuses(self):
  ctx,cols,cp,inputs=structures();ctx['evidenceDirectory']=str(S.JOB/'stream-followup-v1');self.assertRaisesRegex(S.Refused,'FIXED_SCOPE',S.structural,ctx,cols,cp,inputs)
 def test_original_sources_stay_unchanged(self):
  for p,h in [('pow-audit30-onhost-math-safe-input-census-v1.py','ab2e695d751f5126ae0a5767d8c705f372cf33e7018d5364ba1ceb60c7925af3'),('pow-audit30-onhost-math-managed-v3.py','9c948257ac64de16fb221ac4288fefe1a5d51dc9802bd626862be83bd17acfd9')]:self.assertEqual(hashlib.sha256((P('/tmp')/p).read_bytes()).hexdigest(),h)

class PreviousLineage(unittest.TestCase):
 def test_safe_fence_has_original_and_failed063000_hooks(self):
  source=P('/tmp/pow-audit30-onhost-math-safe-input-census-completion-v2.py').read_text();self.assertIn('previous_completion=A.previous_completion_fence()',source);self.assertIn('previousCompletionProofs=previous_completion',source)
  S.load([U,M]);self.assertEqual(S.A.PREVIOUS_COMPLETION,S.JOB/'stream-completion-v1');self.assertEqual(S.A.STREAM_CONTROLLER_SHA,'ecb2b237b93ebd0bde96e5d7d690abbda5b9fa92aaeb0fea47c23e169acf4e8e')
 def test_old_v1_context_refuses_even_when_bytes_and_rows_same(self):
  ctx,cols,cp,inputs=structures();ctx['evidenceDirectory']=str(S.JOB/'stream-completion-v1');self.assertRaisesRegex(S.Refused,'FIXED_SCOPE',S.structural,ctx,cols,cp,inputs)
if __name__=='__main__':unittest.main()
