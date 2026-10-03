#!/usr/bin/python3 -I
import io,importlib.util,json,hashlib,os,sqlite3,struct,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
P=Path('/tmp/pow-audit30-transition-stream-codec-v2.py');spec=importlib.util.spec_from_file_location('stream',P);C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
SAMPLES=[{'height':960600,'hash':'a'*64},{'height':960601,'hash':'b'*64},{'height':969526,'hash':'c'*64}]
COLS=C.encoded(C.COLUMNS);SAM=json.dumps(SAMPLES,separators=(',',':')).encode();CP=C.encoded({'network':'livenet','height':969526,'hash':'c'*64,'sourceFenceSha256':'d'*64,'sampleRowKeysSha256':C.sha(SAM)})
def fields(row,payload=b'\x01{ "utf8" : "\xc3\xa9\xf0\x9f\x98\x80", "q16":"900719925474099312345678", "raw":"\\u0061" } '):
 out=[]
 for name,typ in C.LAYOUT:
  if name=='payload':v=payload
  elif name=='network':v=b'livenet'
  elif name=='block_height':v=struct.pack('!i',row['height'])
  elif name=='block_hash':v=row['hash'].encode()
  elif name.endswith('sha256') or name=='previous_block_hash':v=b'f'*64
  elif name=='work_token_state_model':v=None
  elif typ=='integer':v=struct.pack('!i',12)
  elif typ=='boolean':v=b'\x01'
  elif typ=='numeric':v=struct.pack('!HhHHH',1,0,0,8,42)
  elif typ=='timestamp with time zone':v=struct.pack('!q',810000000000123)
  else:v=b'model'
  out.append(v)
 return out
def raw(rows=None):
 b=bytearray(C.MAGIC+struct.pack('!II',0,0))
 for row in rows or [fields(r) for r in SAMPLES]:
  b+=struct.pack('!h',len(row))
  for x in row:b+=struct.pack('!i',-1 if x is None else len(x))+(x or b'')
 return bytes(b+b'\xff\xff')
class Fragmented:
 def __init__(self,b,width):self.f=io.BytesIO(b);self.width=width
 def read(self,n):return self.f.read(min(n,self.width))
class Tests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.source=self.base/'source.copy';self.store=self.base/'store.sqlite';self.source.write_bytes(raw());self.source.chmod(0o600)
 def tearDown(self):self.tmp.cleanup()
 def build(self,**kwargs):return C.build(self.source,C.sha(self.source.read_bytes()),COLS,CP,SAM,self.store,**kwargs)
 def tamper(self,sql):
  with sqlite3.connect(self.store) as db:
   for (name,)in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall():db.execute('DROP TRIGGER '+name)
   db.execute(sql)
 def test_full26_raw_null_json_utf8_numeric_timestamp_preserved(self):
  stats=self.build();out=self.base/'reconstructed.copy';r=C.reconstruct(self.store,out,self.source);self.assertEqual(out.read_bytes(),raw());self.assertTrue(r['byteForByteSourceCompared']);self.assertFalse(r['mathAccepted']);self.assertFalse(r['jsonSemanticValidation']);self.assertEqual(len(r['rows']),3);self.assertEqual(r['rows'][0]['fieldLengths'][6],-1);self.assertEqual(stats['sourceBytes'],len(raw()))
 def test_arbitrary1byte_and_utf8_boundary_streams(self):
  full=C.parse_copy(io.BytesIO(raw()),COLS,CP,SAM,C.DEFAULT)
  for width in [1,2,3,7,31,65536]:self.assertEqual(C.parse_copy(Fragmented(raw(),width),COLS,CP,SAM,C.DEFAULT),full)
 def test_cdc_feed_boundaries_identical_and_lossless(self):
  src=bytes(range(256))*900;first=[];one=C.CDC(first.append,C.Deadline(20));one.feed(src);one.flush()
  for width in [1,7,127,65536]:
   second=[];two=C.CDC(second.append,C.Deadline(20))
   for i in range(0,len(src),width):two.feed(src[i:i+width])
   two.flush();self.assertEqual(second,first)
  self.assertEqual(b''.join(first),src);self.assertTrue(all(len(x)<=65536 for x in first))
 def test_bad_header_flags_extension_truncation_trailing_refuse(self):
  data=raw();variants=[b'bad',data[:-1],data+b'x',data[:11]+struct.pack('!II',1,0)+data[19:],data[:11]+struct.pack('!II',0,1025)+data[19:]]
  for x in variants:
   with self.assertRaises(ValueError):C.parse_copy(io.BytesIO(x),COLS,CP,SAM,C.DEFAULT)
 def test_wrong_column_count_and_layout_refuse(self):
  rs=[fields(r) for r in SAMPLES];rs[0]=rs[0][:-1]
  with self.assertRaises(ValueError):C.parse_copy(io.BytesIO(raw(rs)),COLS,CP,SAM,C.DEFAULT)
  cols=json.loads(COLS);cols[7]['typeOid']=25
  with self.assertRaises(ValueError):C.metadata(C.encoded(cols),CP,SAM)
 def test_bad_negative_length_and_nullable_payload_refuse(self):
  x=bytearray(raw());struct.pack_into('!i',x,21,-2)
  with self.assertRaises(ValueError):C.parse_copy(io.BytesIO(x),COLS,CP,SAM,C.DEFAULT)
  for index in [0,24]:
   rs=[fields(r)for r in SAMPLES];rs[0][index]=None
   with self.assertRaises(ValueError):C.parse_copy(io.BytesIO(raw(rs)),COLS,CP,SAM,C.DEFAULT)
 def test_bad_jsonbversion_utf8_object_bounds_refuse(self):
  for payload in [b'\x02{}',b'\x01{"x":"\xff"}',b'\x01[]',b'\x01{}x',b'\x01']:
   rs=[fields(r)for r in SAMPLES];rs[0][24]=payload
   with self.assertRaises((ValueError,UnicodeError)):C.parse_copy(io.BytesIO(raw(rs)),COLS,CP,SAM,C.DEFAULT)
 def test_duplicate_missing_reordered_rows_refuse(self):
  for rs in [[fields(SAMPLES[0])]*3,[fields(x)for x in SAMPLES[:-1]],[fields(x)for x in reversed(SAMPLES)]]:
   with self.assertRaises(ValueError):C.parse_copy(io.BytesIO(raw(rs)),COLS,CP,SAM,C.DEFAULT)
 def test_exact_hash_network_scalar_width_numeric_bool_refuse(self):
  for index,value in [(0,b'testnet'),(1,b'bad'),(2,b'wrong'),(7,b'bad'),(20,b'\x00'),(25,b'short')]:
   rs=[fields(r)for r in SAMPLES];rs[0][index]=value
   with self.assertRaises(ValueError):C.parse_copy(io.BytesIO(raw(rs)),COLS,CP,SAM,C.DEFAULT)
 def test_small_caps_deadline_storepart_refuse(self):
  for k,v in [('rowBytes',50),('sourceBytes',50),('storeBytes',1),('partCount',1)]:
   envelope=C.DEFAULT|{k:v}
   self.store.unlink(missing_ok=True)
   if k=='partCount':self.source.write_bytes(raw([fields(r,b'\x01{"a":"'+b'x'*70000+b'"}')for r in SAMPLES]))
   with self.assertRaises(ValueError):self.build(envelope=envelope)
  with patch.object(C.time,'monotonic',side_effect=[0,121]):
   with self.assertRaises(TimeoutError):C.parse_copy(io.BytesIO(raw()),COLS,CP,SAM,C.DEFAULT)
 def test_above_defaults_without_exact_measured_admission_refuses(self):
  e=C.DEFAULT|{'rowBytes':C.DEFAULT['rowBytes']+1}
  with self.assertRaisesRegex(ValueError,'unadmitted'):C.limits(e,rows=SAMPLES)
  profile={'rows':[r|{'recordSendBytes':1000,'payloadStoredBytes':20}for r in SAMPLES],'resourceMeasurements':dict(memoryPeakBytes=1024,elapsedSeconds=1,memoryMaxBytes=8*1024**3,jobMaxBytes=80*1024**3,dataReserveBytes=100*1024**3,rootReserveBytes=10*1024**3)};h=C.sha(C.encoded(profile));a={'schema':'pow-audit30-stream-envelope-admission-v1','approvedEnvelope':e,'profileSha256':h,'rows':profile['rows'],'profileMemoryPeakBytes':1024,'profileElapsedSeconds':1,'approvalSha256':'6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'}
  self.assertEqual(C.limits(e,a,profile,h,SAMPLES),e)
  for changed in [a|{'profileSha256':'a'*64},a|{'approvedEnvelope':C.DEFAULT},a|{'approvalSha256':'a'*64}]:
   with self.assertRaises(ValueError):C.limits(e,changed,profile,h,SAMPLES)
 def test_creation_only_symlink_hardlink_and_bad_source_sha_refuse(self):
  self.store.write_bytes(b'keep')
  with self.assertRaises(FileExistsError):self.build()
  self.assertEqual(self.store.read_bytes(),b'keep');self.store.unlink();self.store.symlink_to(self.source)
  with self.assertRaises(FileExistsError):self.build()
  self.store.unlink();os.link(self.source,self.base/'hardlink')
  with self.assertRaises(ValueError):self.build()
  (self.base/'hardlink').unlink()
  with self.assertRaises(ValueError):C.build(self.source,'a'*64,COLS,CP,SAM,self.store)
 def test_input_metadata_and_content_drift_refuse(self):
  original=C.parse_copy
  def changed(*args,**kwargs):result=original(*args,**kwargs);self.source.write_bytes(raw()+b'changed');return result
  with patch.object(C,'parse_copy',side_effect=changed):
   with self.assertRaises(ValueError):self.build()
 def test_real_hash_collision_refuses_without_seal(self):
  self.source.write_bytes(raw([fields(r,b'\x01{"x":"'+bytes([97+i])*70000+b'"}')for i,r in enumerate(SAMPLES)]))
  with patch.object(C,'chunk_sha',return_value='a'*64):
   with self.assertRaisesRegex(ValueError,'collision'):self.build()
  with self.assertRaises(ValueError):C.reconstruct(self.store)
 def test_sealed_immutable_no_late_insert(self):
  self.build()
  with sqlite3.connect(self.store)as db:
   for sql in ['UPDATE chunks SET body=body','DELETE FROM chunks','UPDATE parts SET ordinal=ordinal','DELETE FROM parts','DELETE FROM capture','INSERT INTO capture SELECT * FROM capture',"INSERT INTO chunks VALUES('a',1,x'00')"]:
    with self.assertRaises(sqlite3.IntegrityError):db.execute(sql)
 def test_missing_part_dense_reorder_and_corrupt_body_refuse(self):
  self.source.write_bytes(raw([fields(r,b'\x01{"x":"'+bytes([97+i])*70000+b'"}')for i,r in enumerate(SAMPLES)]))
  for sql in ['DELETE FROM parts WHERE ordinal=1',"UPDATE parts SET sha256='missing' WHERE ordinal=1",'UPDATE chunks SET body=zeroblob(bytes)','UPDATE parts SET sha256=(SELECT sha256 FROM parts WHERE ordinal=0) WHERE ordinal=1']:
   self.store.unlink(missing_ok=True);self.build();self.tamper(sql)
   with self.assertRaises(ValueError):C.reconstruct(self.store)
 def test_metadata_and_extra_unused_chunks_and_foreign_envelope_refuse(self):
  for sql in ["UPDATE capture SET columns_raw=x'5b5d'",'UPDATE capture SET part_count=part_count+1',"UPDATE capture SET source_sha256='a'", "INSERT INTO chunks VALUES('"+'f'*64+"',1,x'00')"]:
   self.store.unlink(missing_ok=True);self.build();self.tamper(sql)
   with self.assertRaises(ValueError):C.reconstruct(self.store)
  self.store.unlink();self.build();e=C.DEFAULT|{'sourceBytes':C.CEILING['sourceBytes']};self.tamper("UPDATE capture SET envelope_raw=x'"+C.encoded(e).hex()+"'")
  with self.assertRaises(ValueError):C.reconstruct(self.store)
 def test_reconstruction_target_existing_and_source_difference_refuse(self):
  self.build();out=self.base/'out';out.write_bytes(b'preserve')
  with self.assertRaises(FileExistsError):C.reconstruct(self.store,out)
  self.assertEqual(out.read_bytes(),b'preserve');self.source.write_bytes(raw()[:-1]+b'x')
  with self.assertRaises(ValueError):C.reconstruct(self.store,source=self.source)
 def test_actual_profile_resource_telemetry_required_for_optional_envelope(self):
  e=C.DEFAULT|{'rowBytes':C.DEFAULT['rowBytes']+1};rows=[r|{'recordSendBytes':1000,'payloadStoredBytes':20}for r in SAMPLES];profile={'rows':rows};h=C.sha(C.encoded(profile));a=dict(schema='pow-audit30-stream-envelope-admission-v1',approvedEnvelope=e,profileSha256=h,rows=rows,profileMemoryPeakBytes=1024,profileElapsedSeconds=1,approvalSha256='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820')
  with self.assertRaisesRegex(ValueError,'telemetry'):C.limits(e,a,profile,h,SAMPLES)
 def test_parent_directory_is_fsynced_for_store_and_output(self):
  original=C.sync_parent;seen=[]
  def sync(p):seen.append(Path(p));return original(p)
  with patch.object(C,'sync_parent',side_effect=sync):
   self.build();out=self.base/'durable.copy';C.reconstruct(self.store,out,self.source)
  self.assertGreaterEqual(seen.count(self.store),2);self.assertIn(out,seen)
 def test_exact_historical_append_layout_full_byte_reconstruction(self):
  cols=C.encoded(C.HISTORICAL_COLUMNS);fresh=[fields(r) for r in SAMPLES];rs=[row[:6]+row[7:]+row[6:7]for row in fresh];self.source.write_bytes(raw(rs));C.build(self.source,C.sha(self.source.read_bytes()),cols,CP,SAM,self.store);out=self.base/'historical.copy';result=C.reconstruct(self.store,out,self.source);self.assertEqual(out.read_bytes(),raw(rs));self.assertEqual(result['layoutModel'],'pg16-migrated-append-layout-v1');self.assertEqual(result['rows'][0]['fieldLengths'][25],-1);self.assertEqual(result['rows'][0]['fieldLengths'][23],len(rs[0][23]));self.assertEqual(result['columnLayoutRawSha256'],C.sha(cols))
 def test_only_two_exact_layouts_and_named_nullable_field(self):
  cols=C.HISTORICAL_COLUMNS.copy();cols[0],cols[1]=cols[1],cols[0]
  with self.assertRaises(ValueError):C.metadata(C.encoded(cols),CP,SAM)
  rows=[fields(r)for r in SAMPLES];rows=[row[:6]+row[7:]+row[6:7]for row in rows];rows[0][6]=None
  with self.assertRaises(ValueError):C.parse_copy(io.BytesIO(raw(rows)),C.encoded(C.HISTORICAL_COLUMNS),CP,SAM,C.DEFAULT)

if __name__=='__main__':unittest.main(verbosity=2)
