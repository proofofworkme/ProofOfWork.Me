#!/usr/bin/python3 -I
import copy, importlib.util, json, pathlib, sqlite3, struct, subprocess, tempfile, unittest
from unittest.mock import patch
P=pathlib.Path('/tmp/pow-audit30-transition-chunk-prototype.py');s=importlib.util.spec_from_file_location('chunk',P);C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
COLS=[dict(name='network',typeOid=25,typeName='text'),dict(name='optional',typeOid=25,typeName='text'),dict(name='payload',typeOid=3802,typeName='jsonb')]
PIN=dict(network='livenet',height=1200001,hash='a'*64,sourceFenceSha256='b'*64,sampleRowKeysSha256='c'*64)
def raw(rows):
    out=bytearray(C.MAGIC+struct.pack('!II',0,0))
    for row in rows:
        out+=struct.pack('!h',len(row))
        for value in row:out+=struct.pack('!i',-1 if value is None else len(value))+(b'' if value is None else value)
    return bytes(out+struct.pack('!h',-1))
def sample():return raw([[b'livenet',None,b'\x01{"q8":"9007199254740993","q16":"1000000000000000012345","memo":" tail\\r\\n","nested":{"unicode":"\xf0\x9f\x98\x80","a":[null,true,false]}}'],[b'livenet',b'',b'\x01 { "q8" : "9007199254740993", "memo" : "  \\t\\n" } ']])
class Tests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.tmp.name)/'chunks.sqlite'
    def tearDown(self):self.tmp.cleanup()
    def build(self,value=None,cols=COLS,pin=PIN,index=2):return C.build(sample() if value is None else value,json.dumps(cols).encode(),json.dumps(pin).encode(),index,self.path)
    def tamper(self,sql):
        db=sqlite3.connect(self.path)
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall():db.execute('DROP TRIGGER '+name)
        db.execute(sql);db.commit();db.close()
    def test_exact_binary_null_empty_unicode_q8_q16_roundtrip(self):
        before=sample();stats=self.build(before);self.assertEqual(C.reconstruct(self.path),before);self.assertEqual(stats['occurrenceBytes'],len(before));self.assertGreater(stats['sqliteAllocatedBytes'],0)
    def test_top_level_lexical_boundaries_preserve_raw_unicode_and_whitespace(self):
        value=b'\x01 {"a": [1, {"x":"\\u00e9"}], "z" : "\xc3\xa9\\n" } \n';self.assertEqual(b''.join(C.jsonb_segments(value)),value)
    def test_jsonb_unsupported_version_scalar_duplicate_nonfinite_utf8_refuse(self):
        for value in [b'\x02{}',b'\x01[]',b'\x01{"a":1,"a":2}',b'\x01{"a":NaN}',b'\x01{"a":"\xff"}',b'\x01{}x',b'\x01{"a":1e999}']:
            # Decimal preserves finite huge exponents losslessly; source canonical oracle separately rejects unsafe numeric payloads.
            if value.endswith(b'1e999}'):self.assertEqual(b''.join(C.jsonb_segments(value)),value)
            else:
                with self.assertRaises((ValueError,UnicodeError)):C.jsonb_segments(value)
    def test_header_flags_extension_and_empty_sample_refuse(self):
        variants=[b'bad',C.MAGIC+struct.pack('!II',1,0)+b'\xff\xff',C.MAGIC+struct.pack('!II',0,1025)+b'\xff\xff',raw([])]
        for value in variants:
            with self.assertRaises(ValueError):list(C.binary_parts(value,2))
    def test_truncation_trailing_wrong_count_bad_length_payload_null_refuse(self):
        good=sample();variants=[good[:-1],good+b'x',raw([[b'a',b'b']]),raw([[b'a',b'b',None]]),raw([[b'a',b'b',b'\x01{}'],[b'a']])]
        bad=bytearray(good);struct.pack_into('!i',bad,21,-2);variants.append(bytes(bad))
        for value in variants:
            with self.assertRaises(ValueError):list(C.binary_parts(value,2))
    def test_copy_columns_exact_even_when_payload_index_exists(self):
        with self.assertRaises(ValueError):self.build(cols=COLS+[dict(name='extra',typeOid=25,typeName='text')])
    def test_metadata_wrong_type_duplicate_name_index_network_and_hash_refuse(self):
        variants=[]
        for field,value in [('network','testnet'),('height',True),('hash','A'*64),('sourceFenceSha256','')]:p=copy.deepcopy(PIN);p[field]=value;variants.append((COLS,p,2))
        c=copy.deepcopy(COLS);c[2]['typeOid']=25;variants.append((c,PIN,2));c=copy.deepcopy(COLS);c[1]['name']='network';variants.append((c,PIN,2));variants.append((COLS,PIN,-1));variants.append((COLS,PIN,True))
        for c,p,i in variants:
            with self.assertRaises(ValueError):C.validate_metadata(json.dumps(c).encode(),json.dumps(p).encode(),i)
    def test_source_row_store_manifest_metadata_caps_refuse(self):
        with patch.object(C,'SOURCE_MAX',40):
            with self.assertRaises(ValueError):self.build()
        with patch.object(C,'ROW_MAX',40):
            with self.assertRaises(ValueError):list(C.binary_parts(sample(),2))
        with patch.object(C,'META_MAX',4):
            with self.assertRaises(ValueError):C.validate_metadata(b'[]',b'{}'*3,2)
    def test_manifest_part_ceiling_refuse(self):
        with patch.object(C,'PART_MAX',1):
            with self.assertRaisesRegex(ValueError,'Manifest'):self.build()
    def test_physical_store_ceiling_refuse(self):
        with patch.object(C,'STORE_MAX',100):
            with self.assertRaisesRegex(ValueError,'physical'):self.build()
    def test_hash_collision_bytes_comparison_refuse(self):
        with patch.object(C,'digest',lambda x:'a'*64):
            with self.assertRaisesRegex(ValueError,'collision'):self.build()
    def test_creation_only_existing_target_untouched(self):
        self.path.write_bytes(b'old')
        with self.assertRaises(FileExistsError):self.build()
        self.assertEqual(self.path.read_bytes(),b'old')
    def test_symlink_target_never_followed(self):
        victim=self.path.with_suffix('.victim');victim.write_bytes(b'old');self.path.symlink_to(victim)
        with self.assertRaises(FileExistsError):self.build()
        self.assertEqual(victim.read_bytes(),b'old')
    def test_sealed_tables_update_delete_and_late_insert_refuse(self):
        self.build();db=sqlite3.connect(self.path)
        for sql in ["UPDATE chunks SET body=x'00'",'DELETE FROM chunks','UPDATE parts SET ordinal=1000','DELETE FROM parts','UPDATE capture SET source_bytes=1','DELETE FROM capture',"INSERT INTO chunks VALUES('new',1,x'00')","INSERT INTO parts VALUES(1000,'new')",'INSERT INTO capture SELECT * FROM capture']:
            with self.assertRaises(sqlite3.IntegrityError):db.execute(sql)
        db.close();self.assertEqual(C.reconstruct(self.path),sample())
    def test_manifest_gap_missing_chunk_and_mutated_hash_refuse(self):
        for sql in ['DELETE FROM parts WHERE ordinal=2',"UPDATE parts SET sha256='missing' WHERE ordinal=2", "UPDATE chunks SET sha256='wrong' WHERE sha256=(SELECT sha256 FROM parts WHERE ordinal=2)"]:
            with self.subTest(sql=sql):
                self.path.unlink(missing_ok=True);self.build();self.tamper(sql)
                with self.assertRaises(ValueError):C.reconstruct(self.path)
    def test_body_tamper_length_and_whole_source_hash_refuse(self):
        for sql in ["UPDATE chunks SET body=zeroblob(bytes)","UPDATE capture SET source_sha256='wrong'",'UPDATE capture SET part_count=part_count+1',"UPDATE capture SET columns_sha256='wrong'","UPDATE capture SET checkpoint_sha256='wrong'"]:
            with self.subTest(sql=sql):
                self.path.unlink(missing_ok=True);self.build();self.tamper(sql)
                with self.assertRaises(ValueError):C.reconstruct(self.path)
    def test_manifest_reorder_preserving_dense_keys_refuse(self):
        self.build();self.tamper('UPDATE parts SET sha256=(SELECT sha256 FROM parts WHERE ordinal=3) WHERE ordinal=2')
        with self.assertRaises(ValueError):C.reconstruct(self.path)
    def test_reconstruction_checks_layout_not_only_raw_hash(self):
        self.build();c=COLS+[dict(name='extra',typeOid=25,typeName='text')];value=json.dumps(c).encode();self.tamper("UPDATE capture SET columns_raw=x'"+value.hex()+"',columns_sha256='"+C.digest(value)+"'")
        with self.assertRaisesRegex(ValueError,'columns'):C.reconstruct(self.path)
    def test_duplicate_capture_refuse_even_if_triggers_removed(self):
        self.build();self.tamper('INSERT INTO capture SELECT * FROM capture')
        with self.assertRaises(ValueError):C.reconstruct(self.path)
    def test_cdc_deterministic_bounded_and_lossless(self):
        value=bytes(range(256))*900;one=list(C.cdc(value));self.assertEqual(one,list(C.cdc(value)));self.assertEqual(b''.join(one),value);self.assertTrue(all(len(x)<=C.MAXIMUM for x in one));self.assertTrue(all(len(x)>=C.MINIMUM for x in one[:-1]))
    def test_actual_cli_reads_source_without_atime_identity_false_refusal(self):
        root=pathlib.Path(self.tmp.name);source=root/'source.copy';cols=root/'columns.json';pin=root/'checkpoint.json';reconstructed=root/'reconstructed.copy';source.write_bytes(sample());cols.write_text(json.dumps(COLS));pin.write_text(json.dumps(PIN));before=C.identity(source.stat())
        command=['python3','-I',str(P),'--source',str(source),'--source-sha256',C.digest(sample()),'--columns',str(cols),'--checkpoint',str(pin),'--payload-index','2','--target',str(self.path),'--reconstructed',str(reconstructed)]
        result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10);self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(source.read_bytes(),sample());self.assertEqual(C.identity(source.stat()),before);self.assertEqual(reconstructed.read_bytes(),sample());self.assertEqual(json.loads(result.stdout)['status'],'local-sample-verified')
    def test_timeout_refuses_and_preserves_creation_only_partial_store(self):
        with patch.object(C.time,'monotonic',side_effect=[0,31]):
            with self.assertRaises(TimeoutError):self.build()
        self.assertTrue(self.path.exists())
        with self.assertRaises(ValueError):C.reconstruct(self.path)
if __name__=='__main__':unittest.main(verbosity=2)
