#!/usr/bin/python3 -I
import copy, importlib.util, json, pathlib, unittest, hashlib
P=pathlib.Path('/tmp/pow-audit30-mail-body-census.py');s=importlib.util.spec_from_file_location('mail_census',P);C=importlib.util.module_from_spec(s);s.loader.exec_module(C)
TX='a'*64
class StubCore:
    def verify(self,row,ops):return dict(coreScriptsBound=True,fixtureOnly=True)
def op(vout,text):
    b=text.encode();n=len(b)
    push=bytes([n]) if n<76 else b'\x4c'+bytes([n]) if n<256 else b'\x4d'+n.to_bytes(2,'little')
    return dict(vout=vout,output_index=0,payload_hex=b.hex(),payload_text=text,data_bytes=n,scriptpubkey=(b'\x6a'+push+b).hex())
def row(raw=' x\n',stored='x',status='confirmed'):
    payload=dict(memo=raw,network='livenet',txid=TX,protocol='pwm1',kind='mail',status=status,confirmed=status=='confirmed',dropped=status=='dropped')
    return dict(network='livenet',txid=TX,mail=dict(network='livenet',txid=TX,status=status,body_text=stored,subject='unchanged',sender_address='address',message=payload),transaction=dict(status=status,blockHash='b'*64,blockHeight=100,blockIndex=1),canonicalBlock=True,events=[dict(event_id=9,event_key='fixture',op_return_vout=1,record_ordinal=0,kind='mail',status=status,block_height=100,block_index=1,payload=payload)],opReturns=[op(1,'pwm1:m:'+raw)])
class Tests(unittest.TestCase):
    def test_trim_loss_candidate_binds_raw_and_excludes_payload_leak(self):
        r=C.census_record(row(),StubCore());self.assertTrue(r['bodyOnlyRepairCandidate']);self.assertFalse(r['storedBytesEqualRaw']);self.assertTrue(r['preservingApiEqualsRaw']);self.assertNotIn(' x\\n',json.dumps(r));self.assertNotIn('address',json.dumps(r))
    def test_whitespace_only_newline_tab_crlf_nbsp_bom(self):
        for body in ['\n','\t','\r\n','\u00a0','\ufeff',' \t\n']:
            r=C.census_record(row(body,None),StubCore());self.assertTrue(r['bodyOnlyRepairCandidate']);self.assertTrue(r['whitespaceOnlyNonemptyRaw']);self.assertFalse(r['nullEmptyByteEquivalent'])
    def test_null_and_empty_remain_distinct_not_repairs(self):
        a=C.census_record(row('',None),StubCore());b=C.census_record(row('',''),StubCore());self.assertTrue(a['storedBody']['isNull']);self.assertFalse(b['storedBody']['isNull']);self.assertTrue(a['nullEmptyByteEquivalent']);self.assertFalse(a['bodyOnlyRepairCandidate']);self.assertFalse(b['bodyOnlyRepairCandidate'])
    def test_literal_subject_body_and_metadata_fallback_separate(self):
        a=row(' Subject: literal body\n','Subject: literal body');a['events'][0]['payload']['detail']='Subject: metadata'
        self.assertTrue(C.census_record(a,StubCore())['preservingApiEqualsRaw'])
        self.assertIsNone(C.projection_body(dict(detail=' \nSubject: metadata\n'),False));self.assertEqual(C.reader_body(dict(body_text=None),dict(detail='Subject: metadata'),False),'')
    def test_direct_legacy_fields_nullish_and_empty_priority(self):
        for k in ['body','message','memo']:
            self.assertEqual(C.projection_body({k:' tail\r\n'},False),' tail\r\n')
        self.assertEqual(C.selected_direct(dict(body=None,message='m',memo='other')),('message','m'))
        self.assertEqual(C.selected_direct(dict(body='',memo='other')),('body',''))
    def test_utf8_ordered_multiple_chunks(self):
        a=row(' 😀\r\n','😀');a['opReturns']=[op(2,'pwm1:m:😀\r\n'),op(1,'pwm1:m: ')];r=C.census_record(a,StubCore());self.assertTrue(r['bodyOnlyRepairCandidate']);self.assertEqual(r['rawBodyCarrierVouts'],[1,2]);self.assertEqual(r['rawBody']['bytes'],7)
    def test_other_fields_stable_hash_binds_body_only_scope(self):
        a=row();r=C.census_record(a,StubCore());a['mail']['body_text']=' x\n';b=C.census_record(a,StubCore());self.assertEqual(r['nonBodyMailRowSha256'],b['nonBodyMailRowSha256']);self.assertNotEqual(r['wholeMailRowSha256'],b['wholeMailRowSha256']);a['mail']['subject']='changed';self.assertNotEqual(b['nonBodyMailRowSha256'],C.census_record(a,StubCore())['nonBodyMailRowSha256'])
    def test_pending_dropped_orphaned_no_repair(self):
        for status in ['pending','dropped','orphaned']:
            r=C.census_record(row(status=status),StubCore());self.assertFalse(r['bodyOnlyRepairCandidate']);self.assertNotIn('canonicalCore',r)
    def test_no_core_or_nontrim_mismatch_no_repair(self):
        self.assertFalse(C.census_record(row())['bodyOnlyRepairCandidate']);self.assertFalse(C.census_record(row(stored='different'),StubCore())['bodyOnlyRepairCandidate'])
    def test_duplicate_missing_status_identity_and_positions_refuse(self):
        variants=[lambda a:a['events'].append(copy.deepcopy(a['events'][0])),lambda a:a.update(mail=None),lambda a:a['mail'].update(status='pending'),lambda a:a.update(canonicalBlock=False),lambda a:a['events'][0]['payload'].update(txid='c'*64),lambda a:a['events'][0]['payload'].update(confirmed=1),lambda a:a['events'][0].update(block_index=2),lambda a:a['events'][0].update(op_return_vout=2),lambda a:a['events'][0].update(record_ordinal=1)]
        for change in variants:
            a=row();change(a)
            with self.assertRaises(ValueError):C.census_record(a,StubCore())
    def test_raw_script_bytes_text_sizes_and_unsafe_encoding_refuse(self):
        variants=[lambda a:a['opReturns'][0].update(payload_hex=''),lambda a:a['opReturns'][0].update(data_bytes=1),lambda a:a['opReturns'][0].update(payload_text='other'),lambda a:a['opReturns'].append(copy.deepcopy(a['opReturns'][0])),lambda a:a['opReturns'][0].update(scriptpubkey='6a4c'),lambda a:a['opReturns'][0].update(scriptpubkey='6a51')]
        for change in variants:
            a=row();change(a)
            with self.assertRaises((ValueError,UnicodeError)):C.census_record(a,StubCore())
        with self.assertRaises(ValueError):C.census_record(row('\x00',None),StubCore())
    def test_subject_reply_attachment_browser_and_bond_kinds_do_not_change(self):
        for kind in C.KINDS:
            a=row(' PoWb\n','PoWb');a['events'][0]['kind']=kind;a['events'][0]['payload']['kind']=kind;r=C.census_record(a,StubCore());self.assertEqual(r['kind'],kind);self.assertTrue(r['preservingApiEqualsRaw'])
    def test_actual_core_binding_and_reorg_refusals_without_rpc_invocation(self):
        a=row();script=a['opReturns'][0]['scriptpubkey']
        class F(C.Core):
            def __init__(self):super().__init__('unused','unused',0);self.bad=''
            def rpc(self,m,*args):
                if m=='getblockhash':return 'c'*64 if self.bad=='hash' else 'b'*64
                if m=='getblock':return dict(hash='b'*64,height=100,tx=['other',TX] if self.bad!='position' else [TX,'other'])
                if m=='getrawtransaction':return dict(txid=TX,blockhash='b'*64,vout=[dict(scriptPubKey=dict(hex='51')),dict(scriptPubKey=dict(hex=script if self.bad!='script' else '6a00'))])
                raise AssertionError(m)
        f=F();self.assertTrue(f.verify(a,a['opReturns'])['coreScriptsBound']);f.fence();f.bad='hash'
        with self.assertRaises(ValueError):f.fence()
        for bad in ['hash','position','script']:
            f=F();f.bad=bad
            with self.assertRaises(ValueError):f.verify(a,a['opReturns'])
    def test_core_carrier_missing_from_index_refuses(self):
        a=row();script=a['opReturns'][0]['scriptpubkey']
        class F(C.Core):
            def __init__(self):super().__init__('unused','unused',0)
            def rpc(self,m,*args):
                if m=='getblockhash':return 'b'*64
                if m=='getblock':return dict(hash='b'*64,height=100,tx=['other',TX])
                if m=='getrawtransaction':return dict(txid=TX,blockhash='b'*64,vout=[dict(scriptPubKey=dict(hex=op(0,'pwm1:m:missing')['scriptpubkey'])),dict(scriptPubKey=dict(hex=script))])
                raise AssertionError(m)
        with self.assertRaisesRegex(ValueError,'CORE_PWM_CARRIER_COVERAGE'):F().verify(a,a['opReturns'])
    def test_noncontiguous_governed_pwm_envelope_refuses(self):
        a=row(' ab\n','ab');a['opReturns']=[op(1,'pwm1:m: '),op(2,'pwt1:other'),op(3,'pwm1:m:ab\n')]
        with self.assertRaisesRegex(ValueError,'PWM_ENVELOPE_NONCONTIGUOUS'):C.census_record(a,StubCore())
    def test_readonly_sql_and_limits(self):
        self.assertIn('REPEATABLE READ READ ONLY',C.SQL);self.assertIn("statement_timeout='60s'",C.SQL);self.assertIn('LIMIT 10001',C.SQL)
        for word in ['UPDATE ','INSERT ','DELETE ','TRUNCATE ','DROP ']:self.assertNotIn(word,C.SQL)
if __name__=='__main__':unittest.main(verbosity=2)
