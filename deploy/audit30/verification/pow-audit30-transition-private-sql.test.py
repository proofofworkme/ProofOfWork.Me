#!/usr/bin/python3 -I
import copy, hashlib, importlib.util, json, pathlib, struct, tempfile, unittest
P=pathlib.Path('/tmp/pow-audit30-transition-private-sql.py');s=importlib.util.spec_from_file_location('emit',P);E=importlib.util.module_from_spec(s);s.loader.exec_module(E)
COLS=[dict(name='network',typeOid=25,typeName='text'),dict(name='block_height',typeOid=23,typeName='integer'),dict(name='payload',typeOid=3802,typeName='jsonb')]
def plan():return dict(schema='pow-audit30-private-transition-prototype-plan-v1',privateJob='/data/proofofwork-audit30-transition-SYNTHETIC-NOT-ADMITTED',privateSocket='/data/proofofwork-audit30-transition-SYNTHETIC-NOT-ADMITTED/socket',privatePort=55433,sourceDatabase='proof_indexer',network='livenet',checkpoint=dict(height=969620,hash='d'*64,transitionHeight=969620,transitionHash='d'*64),sourceFenceSha256='e'*64,sampleRows=[dict(height=960600,hash='a'*64),dict(height=960601,hash='b'*64),dict(height=969620,hash='d'*64)],columns=COLS,precisionMarkerJsonbSendSha256='f'*64)
def binary(p):
    raw=bytearray(E.C.MAGIC+struct.pack('!II',0,0))
    for row in p['sampleRows']:
        fields=[b'livenet',struct.pack('!i',row['height']),b'\x01{"syntheticOnly":true}'];raw+=struct.pack('!h',len(fields))
        for f in fields:raw+=struct.pack('!i',len(f))+f
    return bytes(raw+struct.pack('!h',-1))
class Tests(unittest.TestCase):
    def test_capture_readonly_exact_checkpoint_marker_columns_caps_and_history(self):
        sql=E.capture(plan());self.assertIn('REPEATABLE READ READ ONLY',sql);self.assertIn('960600',sql);self.assertIn('960601',sql);self.assertIn('969620',sql);self.assertIn('jsonb_send(value)',sql);self.assertIn('pg_get_functiondef(tgfoid)',sql);self.assertIn('record_send(x)',sql);self.assertIn('67108864',sql);self.assertIn('FORMAT binary',sql);self.assertIn('ORDER BY t.network,t.block_height,t.block_hash',sql)
        for token in ['CREATE ','UPDATE ','DELETE ','TRUNCATE ','DROP ','ALTER ','INSERT ']:self.assertNotIn(token,sql)
    def test_injection_live_socket_tcp_wrong_pg_identity_unknown_keys_refuse(self):
        for k,v in [('privateJob',"/data/proofofwork-audit30-transition-a';SELECT 1;--"),('privateSocket','/var/run/postgresql'),('privatePort',5432),('sourceDatabase','postgres'),('network','testnet'),('schema','unknown')]:
            p=plan();p[k]=v
            with self.assertRaises(ValueError):E.capture(p)
        p=plan();p['extra']='x'
        with self.assertRaises(ValueError):E.capture(p)
    def test_sample_missing_declaration_activation_latest_duplicate_reorder_oversized_refuse(self):
        samples=[plan()['sampleRows'][1:],list(reversed(plan()['sampleRows'])),plan()['sampleRows']+[plan()['sampleRows'][-1]],plan()['sampleRows'][:-1]+[dict(height=969619,hash='d'*64)],plan()['sampleRows']*7]
        for rows in samples:
            p=plan();p['sampleRows']=rows
            with self.assertRaises(ValueError):E.capture(p)
    def test_saved_checkpoint_exact_hash_and_height_types_refuse(self):
        for k,v in [('height',True),('height',960600),('transitionHeight',970000),('hash','D'*64),('transitionHash','')]:
            p=plan();p['checkpoint'][k]=v
            with self.assertRaises(ValueError):E.capture(p)
    def test_marker_sourcefence_and_payload_type_binding_refuse(self):
        for k in ['sourceFenceSha256','precisionMarkerJsonbSendSha256']:
            p=plan();p[k]='bad'
            with self.assertRaises(ValueError):E.capture(p)
        p=plan();p['columns']=copy.deepcopy(COLS);p['columns'][2]['typeOid']=25
        with self.assertRaises(ValueError):E.capture(p)
    def test_side_sql_hash_order_full_reconstruction_seal_and_physical_relations(self):
        p=plan();cols,pin,i=E.validate(p)
        with tempfile.TemporaryDirectory() as td:
            path=pathlib.Path(td)/'store.sqlite';E.C.build(binary(p),cols,pin,i,path);sql=E.side(p,path)
            self.assertIn('CREATE SCHEMA audit30_transition_chunks_v1;',sql);self.assertNotIn('IF NOT EXISTS',sql);self.assertIn("ORDER BY p.ordinal",sql);self.assertIn('sha256(body)=sha',sql);self.assertIn('ORDERED_MANIFEST_REFUSAL',sql);self.assertIn('FULL_SOURCE_BYTES_REFUSAL',sql);self.assertIn('SEALED_SIDE_STORE',sql)
            self.assertIn('pg_relation_size',sql);self.assertIn('pg_indexes_size',sql);self.assertIn('pg_table_size',sql);self.assertIn('pg_total_relation_size',sql);self.assertIn('134217728',sql);self.assertIn('side-reconstructed.hex',sql)
            for token in ['UPDATE proof_indexer','DELETE FROM proof_indexer','ALTER TABLE proof_indexer','DROP ','TRUNCATE ']:self.assertNotIn(token,sql)
            self.assertEqual(E.C.reconstruct(path),binary(p))
    def test_side_metadata_or_saved_fence_drift_refuse(self):
        p=plan();cols,pin,i=E.validate(p)
        with tempfile.TemporaryDirectory() as td:
            path=pathlib.Path(td)/'store.sqlite';E.C.build(binary(p),cols,pin,i,path);p['sourceFenceSha256']='0'*64
            with self.assertRaises(ValueError):E.side(p,path)
if __name__=='__main__':unittest.main(verbosity=2)
