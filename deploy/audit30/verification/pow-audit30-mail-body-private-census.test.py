#!/usr/bin/python3 -I
import base64,contextlib,copy,hashlib,importlib.util,io,json,os,pathlib,subprocess,sys,tempfile,time,unittest
from unittest import mock
P=pathlib.Path('/tmp/pow-audit30-mail-body-private-census.py');sp=importlib.util.spec_from_file_location('private_capture',P);W=importlib.util.module_from_spec(sp);sp.loader.exec_module(W)
class PrivateCapture(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.base=pathlib.Path(self.t.name);self.base.chmod(0o700);self.path=self.base/'capture.jsonl';self.frozen_source=self.base/'frozen.py';self.frozen_source.write_bytes(pathlib.Path('/tmp/pow-audit30-mail-body-census.py').read_bytes());self.frozen_source.chmod(0o600)
        self.header=dict(frozenCensusSHA256=W.FROZEN_SHA,wrapperSHA256=hashlib.sha256(P.read_bytes()).hexdigest(),sqlSHA256='a'*64)
    def tearDown(self):self.t.cleanup()
    def capture(self):return W.Capture(str(self.path),self.header,enforce_owner=False)
    def records(self):return [json.loads(line) for line in self.path.read_bytes().splitlines()]
    def test_raw_sql_numeric_and_body_lexemes_preserved_privately(self):
        raw=b'{"phase":"row","txid":"a","body":"  secret fixture\\n","wide":9007199254740993.1234567890123456789}'
        c=self.capture();c.append_raw(raw);public={'ok':True,'coreVerified':True};receipt=c.finish(public,True)
        records=self.records();self.assertEqual(base64.b64decode(records[1]['recordBase64']),raw);self.assertEqual(records[1]['recordSHA256'],W.sha(raw));self.assertEqual(receipt['sha256'],W.sha(self.path.read_bytes()));self.assertEqual(receipt['bytes'],self.path.stat().st_size)
        self.assertEqual(json.loads(base64.b64decode(records[-1]['publicCensusBase64'])),public);self.assertNotIn('secret fixture',json.dumps(receipt));self.assertEqual(os.stat(self.path).st_mode&0o777,0o600)
    def test_exact_frozen_source_hash(self):
        module,source=W.load_frozen(str(self.frozen_source),False);self.assertEqual(W.sha(source.encode()),W.FROZEN_SHA);self.assertTrue(callable(module.census_record))
    def test_altered_source_refuses(self):
        p=self.base/'wrong.py';p.write_bytes(b'print("never execute")');p.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'FROZEN_SOURCE_HASH'):W.load_frozen(str(p),False)
    def test_symlink_source_refuses(self):
        p=self.base/'link.py';p.symlink_to('/tmp/pow-audit30-mail-body-census.py')
        with self.assertRaisesRegex(ValueError,'FROZEN_SOURCE_MODE'):W.load_frozen(str(p),False)
    def test_capture_collision_preserves_original(self):
        self.path.write_bytes(b'preserve')
        with self.assertRaises(FileExistsError):self.capture()
        self.assertEqual(self.path.read_bytes(),b'preserve')
    def test_capture_symlink_refuses(self):
        target=self.base/'original';target.write_bytes(b'preserve');self.path.symlink_to(target)
        with self.assertRaises(FileExistsError):self.capture()
        self.assertEqual(target.read_bytes(),b'preserve')
    def test_public_parent_mode_refuses(self):
        self.base.chmod(0o755)
        with self.assertRaisesRegex(ValueError,'PRIVATE_PARENT_MODE'):self.capture()
        self.assertFalse(self.path.exists())
    def test_bad_sql_phase_refuses(self):
        c=self.capture()
        with self.assertRaisesRegex(ValueError,'PRIVATE_SQL_PHASE'):c.append_raw(b'{"phase":"mutation"}')
        c.close()
    def test_private_byte_bound_preserves_partial_file(self):
        c=self.capture()
        with mock.patch.object(W,'MAX_PRIVATE',c.bytes+1):
            with self.assertRaisesRegex(ValueError,'PRIVATE_CAPTURE_BYTE_BOUND'):c.append_raw(b'{"phase":"row"}')
        c.close();self.assertTrue(self.path.exists());self.assertEqual(len(self.records()),1)
    def test_failed_footer_is_not_complete(self):
        c=self.capture();r=c.finish({'ok':False,'coreVerified':True},False);self.assertFalse(r['complete']);self.assertEqual(self.records()[-1]['status'],'failed')
    def test_header_parent_link_fsync_precedes_any_capture_content(self):
        order=[];real_sync=W.os.fsync;real_write=W.os.write
        def sync(fd):
            if os.readlink('/proc/self/fd/'+str(fd))==str(self.base):order.append('parent-sync')
            return real_sync(fd)
        def write(fd,b):order.append('file-write');return real_write(fd,b)
        with mock.patch.object(W.os,'fsync',side_effect=sync),mock.patch.object(W.os,'write',side_effect=write):c=self.capture();c.finish({'ok':True},True)
        self.assertEqual(order[:2],['parent-sync','file-write'])
    def test_actual_frozen_stream_instrumentation_captures_exact_export_lines(self):
        module,source=W.load_frozen(str(self.frozen_source),False);c=self.capture();W.instrument(module,source,c)
        raw=b'{"phase":"snapshot","wide":1.234567890123456789}\n{"phase":"row","txid":"a","body":"  exact\\n"}\n'
        original=subprocess.Popen;calls=[]
        def child(argv,**kwargs):
            calls.append(argv);self.assertEqual(argv[:4],['/usr/sbin/runuser','-u','postgres','--'])
            return original([sys.executable,'-I','-B','-c','import sys;sys.stdin.buffer.read();sys.stdout.buffer.write('+repr(raw)+')'],**kwargs)
        with mock.patch.object(module.subprocess,'Popen',side_effect=child):rows=list(module.sql_stream(time.monotonic()))
        c.finish({'ok':True,'coreVerified':True},True);records=self.records();self.assertEqual(len(calls),1);self.assertEqual([base64.b64decode(r['recordBase64']) for r in records[1:-1]],raw.splitlines());self.assertEqual(len(rows),2);self.assertIn("SET LOCAL timezone='UTC';",module.SQL)
    def test_failed_core_census_capture_cannot_be_complete(self):
        module,source=W.load_frozen(str(self.frozen_source),False);c=self.capture()
        def fail():raise ValueError('CORE_REORG_FENCE')
        module.main=fail;r,code=W.run(module,source,c,[]);self.assertEqual(code,1);self.assertFalse(r['ok']);self.assertFalse(r['privateCapture']['complete']);self.assertEqual(self.records()[-1]['status'],'failed')
    def test_main_without_core_proof_returns_incomplete_capture(self):
        module,source=W.load_frozen(str(self.frozen_source),False);c=self.capture();module.main=lambda:print(json.dumps({'ok':True,'coreVerified':False})) or 0
        r,code=W.run(module,source,c,[]);self.assertEqual(code,1);self.assertFalse(r['privateCapture']['complete'])
    def native_control(self):return W.SqlControl('/data/proofofwork-release-backups/audit30-mail-body-census-20261003T020000Z/preimages.jsonl')
    def test_native_sql_argv_exact_unit_hardening_pg16_env_and_deadline(self):
        c=self.native_control();a=c.argv();self.assertEqual(a[:4],['/usr/bin/systemd-run','--quiet','--wait','--pipe']);self.assertIn('--property=User=postgres',a);self.assertIn('--property=Group=postgres',a);self.assertIn('--property=CapabilityBoundingSet=',a);self.assertIn('--property=AmbientCapabilities=',a);self.assertIn('--property=RuntimeMaxSec=75s',a);self.assertIn('--property=BindsTo='+c.parent,a);self.assertIn('--property=Requisite='+c.parent,a);self.assertIn('--property=PrivateNetwork=yes',a);self.assertIn('--property=RestrictAddressFamilies=AF_UNIX',a);self.assertIn('--property=NoNewPrivileges=yes',a)
        at=a.index('/usr/bin/env');self.assertEqual(a[at+1],'-i');self.assertIn('PGHOST=/run/postgresql',a[at:]);self.assertIn('PGPORT=5432',a[at:]);self.assertIn('PGOPTIONS='+W.SQL_ENV['PGOPTIONS'],a[at:]);self.assertEqual(a[-9:],['/usr/lib/postgresql/16/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer'][-9:])
    def test_native_sql_private_path_cannot_name_production_unit(self):
        for p in ['/tmp/preimages.jsonl','/data/proofofwork-release-backups/audit30-mail-body-census-proofofwork-api/preimages.jsonl','/data/proofofwork-release-backups/audit30-mail-body-census-20261003T020000Z/other.jsonl']:
            with self.assertRaisesRegex(ValueError,'SQL_UNIT_PRIVATE_PATH'):W.SqlControl(p)
    def test_native_collision_refuses_before_intent_or_launch(self):
        c=self.native_control()
        with mock.patch.object(c,'parent_check',return_value={}),mock.patch.object(c,'props',return_value={'LoadState':'loaded','MainPID':'123'}),mock.patch.object(W.os,'open')as opened:
            with self.assertRaisesRegex(ValueError,'SQL_UNIT_ALREADY_EXISTS'):c.prepare()
        opened.assert_not_called()
    def test_native_stream_preserves_sql_bytes_and_private_line_custody(self):
        module,source=W.load_frozen(str(self.frozen_source),False);c=self.capture();control=self.native_control();W.instrument_native_sql(module,source,c,control);raw=b'{"phase":"snapshot","wide":1.234567890123456789}\n{"phase":"row","txid":"a","body":" exact\\n "}\n';original=subprocess.Popen;calls=[]
        def child(argv,**kwargs):
            calls.append(argv);self.assertEqual(argv,control.argv());return original([sys.executable,'-I','-B','-c','import sys;sys.stdin.buffer.read();sys.stdout.buffer.write('+repr(raw)+')'],**kwargs)
        with mock.patch.object(module.subprocess,'Popen',side_effect=child),mock.patch.object(control,'observe')as observed:rows=list(module.sql_stream(time.monotonic()))
        c.finish({'ok':True},True);self.assertEqual([base64.b64decode(r['recordBase64'])for r in self.records()[1:-1]],raw.splitlines());self.assertEqual(observed.call_count,2);self.assertEqual(len(rows),2);self.assertEqual(module.SQL,module.SQL);self.assertNotIn('runuser',calls[0])
    def test_native_transport_loss_stops_only_owned_child(self):
        c=self.native_control();c.parent_invocation='a'*32;states=[dict(LoadState='loaded',ActiveState='active',MainPID='123'),dict(LoadState='loaded',ActiveState='inactive',MainPID='0')]
        result=type('Result',(),{'returncode':0,'stdout':b'','stderr':b''})()
        with mock.patch.object(c,'parent_check'),mock.patch.object(c,'owned_state',side_effect=states),mock.patch.object(W.subprocess,'run',return_value=result)as command:proof=c.stop()
        self.assertTrue(proof['stopped']);self.assertEqual(command.call_args.args[0],['/usr/bin/systemctl','stop',c.unit])
    def test_native_changed_child_identity_refuses_stop(self):
        c=self.native_control();c.invocation='a'*32;v=dict(LoadState='loaded',ActiveState='active',MainPID='123',InvocationID='b'*32,User='postgres',Group='postgres',BindsTo=c.parent,Requisite=c.parent)
        with mock.patch.object(c,'parent_check'),mock.patch.object(c,'props',return_value=v),mock.patch.object(W.subprocess,'run')as command:
            with self.assertRaisesRegex(ValueError,'SQL_CHILD_CHANGED'):c.stop()
        command.assert_not_called()
    def test_native_failure_stop_cannot_make_capture_complete(self):
        module,source=W.load_frozen(str(self.frozen_source),False);c=self.capture();control=self.native_control();module.main=lambda:(_ for _ in ()).throw(ValueError('SQL_READ_FAILED'))
        with mock.patch.object(control,'stop',return_value={'stopped':True})as stopped:r,code=W.run(module,source,c,[],control)
        self.assertEqual(code,1);self.assertFalse(r['privateCapture']['complete']);self.assertEqual(self.records()[-1]['status'],'failed');stopped.assert_called_once()
    def fake_cli(self,response):
        p=self.base/'fake-core-cli';p.write_text('#!/usr/bin/python3\nimport sys,json\n'+response);p.chmod(0o700);return str(p)
    def test_actual_fake_cli_bare_core_hash_and_json_other_methods(self):
        module,source=W.load_frozen(str(self.frozen_source),False);W.instrument_core(module,source)
        cli=self.fake_cli("method=next(x for x in sys.argv[1:] if not x.startswith('-'))\nprint('b'*64 if method=='getblockhash' else json.dumps({'blocks':100,'bestblockhash':'b'*64}))\n")
        core=module.Core(cli,'unused',time.monotonic());self.assertEqual(core.rpc('getblockhash',100),'b'*64);self.assertEqual(core.rpc('getblockchaininfo')['blocks'],100);self.assertEqual(core.calls,2)
    def test_actual_fake_cli_quoted_hash_preserved_and_bad_frames_refuse(self):
        module,source=W.load_frozen(str(self.frozen_source),False);W.instrument_core(module,source)
        for frame,good in [(json.dumps('b'*64),True),('B'*64,False),('b'*63,False),('123',False),(json.dumps(123),False),('b'*64+' trailing',False)]:
            cli=self.fake_cli('sys.stdout.write('+repr(frame+'\n')+')\n');core=module.Core(cli,'unused',time.monotonic())
            if good:self.assertEqual(core.rpc('getblockhash',100),'b'*64)
            else:
                with self.assertRaises(ValueError):core.rpc('getblockhash',100)
    def test_actual_fake_cli_core_position_scripts_and_reorg_fences_unchanged(self):
        fixture_spec=importlib.util.spec_from_file_location('row_fixture','/tmp/pow-audit30-mail-body-census.test.py');fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)
        row=fixture.row();script=row['opReturns'][0]['scriptpubkey'];module,source=W.load_frozen(str(self.frozen_source),False);W.instrument_core(module,source)
        def cli_for(bad=''):
            body="method=next(x for x in sys.argv[1:] if not x.startswith('-'))\nif method=='getblockhash':print("+repr(('c' if bad=='hash' else 'b')*64)+")\nelif method=='getblock':print(json.dumps("+repr(dict(hash='b'*64,height=100,tx=['other',fixture.TX] if bad!='position' else [fixture.TX,'other']))+"))\nelse:print(json.dumps("+repr(dict(txid=fixture.TX,blockhash='b'*64,vout=[dict(scriptPubKey=dict(hex='51')),dict(scriptPubKey=dict(hex=script if bad!='script' else '6a00'))]))+"))\n"
            return self.fake_cli(body)
        core=module.Core(cli_for(),'unused',time.monotonic());self.assertTrue(core.verify(row,row['opReturns'])['coreScriptsBound']);core.fence();cli_for('hash')
        with self.assertRaisesRegex(ValueError,'CORE_REORG_FENCE'):core.fence()
        for bad in ('hash','position','script'):
            with self.assertRaises(ValueError):module.Core(cli_for(bad),'unused',time.monotonic()).verify(row,row['opReturns'])
    def test_core_patch_preserves_original_rpc_loops_and_call_accounting(self):
        import ast,textwrap
        module,source=W.load_frozen(str(self.frozen_source),False);before=module.Core.rpc;W.instrument_core(module,source)
        self.assertEqual(module.Core.ALLOWED,{'getblockchaininfo','getblockhash','getblock','getrawtransaction'});self.assertNotEqual(before,module.Core.rpc)
        with mock.patch.object(module.subprocess,'Popen') as popen:
            with self.assertRaisesRegex(ValueError,'RPC_NOT_READ_ONLY'):module.Core('unused','unused',time.monotonic()).rpc('sendrawtransaction','private')
            popen.assert_not_called()
if __name__=='__main__':unittest.main()
