#!/usr/bin/python3 -I
import copy, importlib.util, json, os, stat, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('controller.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
helper_spec=importlib.util.spec_from_file_location('scoped_activation_helper',
    Path(__file__).parent.parent/'work-batch-sends/scoped-node.py')
helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
EXEC_START=('{ path=/opt/node/bin/node ; argv[]=/opt/node/bin/node app.mjs ; ignore_errors=no'
    ' ; start_time=[Sat 2026-10-24 18:44:16 UTC] ; stop_time=[n/a]'
    ' ; pid=3713663 ; code=(null) ; status=0/0 }')
PINS={'txid':'a'*64,'blockHash':'b'*64,'blockHeight':972965,'activationHeight':972966,
    'blockTransactionIndex':1,'protocolVout':1,'recordOrdinal':0,'registryPaymentVout':0}
def read(path,limit=10*1024**2,absent=False):
    if absent and not path.exists(): return None
    if path.is_symlink(): raise ValueError('symlink')
    return path.read_bytes()
def row(active='active'):
    return {'ActiveState':active,'MainPID':'11' if active=='active' else '0','WorkingDirectory':str(c.ROOT)}
class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='work-batch-activation-test-',dir='/tmp')
        self.root=Path(self.tmp.name);self.drop=self.root/'dropins'/'zzzzz-work-batch-writes.conf'
        self.drop.parent.mkdir(mode=0o755)
        self.pathpatch=patch.object(c,'DROPIN',self.drop);self.pathpatch.start()
        self.events=[];self.records=[]
        self.units=(c.API,c.WORKER)
        self.gate=('gateway.socket','gateway.service')
        self.auth=('core.service',);self.search=('search.service',)
        self.appstates={u:row() for u in self.units}
        self.other={u:row() for u in (*self.auth,*self.search)}
        self.gateway={u:{'ActiveState':'active','UnitFileState':'enabled','MainPID':'12'} for u in self.gate}
        def states(units):return {u:copy.deepcopy(self.appstates.get(u,self.other.get(u))) for u in units}
        def ctl(*args):
            self.events.append(args)
            if args[0]=='start':
                unit=args[1]
                if unit in self.appstates:self.appstates[unit]=row()
                else:self.gateway[unit]['ActiveState']='active';self.gateway[unit]['MainPID']='12'
            return ''
        def drain():
            self.events.append(('drain',))
            for u in self.appstates:self.appstates[u]=row('inactive')
            for u in self.gateway:self.gateway[u]['ActiveState']='inactive';self.gateway[u]['MainPID']='0'
        def gateway_check(actual,pins):
            c.require(all(actual[u]['ActiveState']==pins['active'][u] and
                actual[u]['UnitFileState']==pins['unitFileStates'][u] for u in self.gate),'gateway differs')
        self.h={'safe_read':read,'sync':lambda p:None,'rename_absent':lambda a,b:os.rename(a,b),'states':states,'gateway_states':lambda:copy.deepcopy(self.gateway),
            'GATEWAY':self.gate,'AUTHORITY':self.auth,'SEARCH':self.search,'ctl':ctl,'drain_apps':drain,
            'require_gateway_baseline':gateway_check,'normalize_exec_start':helper.normalize_exec_start}
        self.approval={'sourceCommit':'c'*40}
        self.evidence={'pins':PINS,'v8WriteAdmission':True}
    def tearDown(self):
        self.pathpatch.stop();self.tmp.cleanup()
    def owned(self,enabled=False):
        self.drop.write_bytes(c.render(PINS,enabled));self.drop.chmod(0o644)
        return {'identity':c.file_identity(self.drop),'sha256':c.sha(self.drop.read_bytes()),'pins':PINS,'enabled':enabled}
    def captured(self,operation,owned=None):
        return {'format':'work-batch-activation-capture-v1','operation':operation,
            'approvalSha256':c.sha(c.canonical(self.approval)),'configurationSha256':'config',
            'runtimeIdentitySha256':'runtime','states':c.states_snapshot(self.h),'owned':owned,'evidence':self.evidence}
    def run_apply(self,operation,owned=None,probe=None,config=None):
        capture=self.captured(operation,owned)
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'configuration',side_effect=config or (lambda *_:'config')),patch.object(c,'process_environment',return_value={}),patch.object(c,'probe',side_effect=probe or (lambda *a,**kw:self.evidence)):
            return c.apply(self.h,self.approval,capture,operation,lambda r:self.records.append(copy.deepcopy(r)))
    def test_render_exact_nine_public_environment_values(self):
        raw=c.render(PINS,False).decode()
        self.assertEqual(raw.count('Environment='),9);self.assertTrue(raw.endswith('WORK_BATCH_WRITES_ENABLED=0\n'))
        self.assertNotIn('PASSWORD',raw)
    def test_minimum_height_and_positions(self):
        for bad in [{'blockHeight':972964,'activationHeight':972965},{'recordOrdinal':1},
            {'registryPaymentVout':1},{'activationHeight':972967},{'txid':'A'*64},{'protocolVout':True}]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):c.public_pins({**PINS,**bad})
    def test_bootstrap_ordering_exception_is_exact_and_keeps_other_pin_gates(self):
        pins={**PINS,**c.DECLARATION_ORDER_COMPATIBILITY}
        self.assertEqual(c.public_pins(pins),pins)
        self.assertIn('WORK_BATCH_DECLARATION_REGISTRY_PAYMENT_VOUT=2',c.render(pins,False).decode())
        for bad in [{'txid':'d'*64},{'registryPaymentVout':3},{'protocolVout':0},
            {'recordOrdinal':1},{'blockHeight':972964,'activationHeight':972965},
            {'activationHeight':972967},{'registryPaymentVout':'2'}]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):c.public_pins({**pins,**bad})
    def test_stage_creation_and_exact_restore(self):
        result=self.run_apply('stage-disabled')
        self.assertTrue(result['complete']);self.assertFalse(result['owned']['enabled'])
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
        self.assertEqual(stat.S_IMODE(self.drop.stat().st_mode),0o644)
        self.assertEqual([e for e in self.events if e[0]=='start'],[('start',c.API),('start',c.WORKER),('start',self.gate[0]),('start',self.gate[1])])
    def test_enable_updates_only_switch(self):
        owned=self.owned();result=self.run_apply('enable',owned)
        self.assertTrue(result['owned']['enabled']);self.assertEqual(result['pins'],PINS)
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,True))
    def test_disable_needs_no_chain_probe(self):
        owned=self.owned(True)
        result=self.run_apply('disable',owned,probe=lambda *_:self.fail('disable queried chain'))
        self.assertTrue(result['complete']);self.assertFalse(result['owned']['enabled'])
    def test_disable_preserves_initial_inactive_gateway(self):
        owned=self.owned(True)
        for r in self.gateway.values():r['ActiveState']='inactive';r['MainPID']='0'
        self.run_apply('disable',owned)
        self.assertFalse(any(e==('start',u) for e in self.events for u in self.gate))
    def test_disable_preserves_stopped_worker(self):
        owned=self.owned(True);self.appstates[c.WORKER]=row('inactive')
        self.run_apply('disable',owned)
        self.assertNotIn(('start',c.WORKER),self.events)
    def test_enable_requires_owned_disabled_file(self):
        with self.assertRaises(ValueError):self.run_apply('enable',self.owned(True))
        self.assertEqual(self.events,[])
    def test_preflight_chain_failure_makes_no_mutations(self):
        def fail(*a,**kw):raise ValueError('Core unavailable')
        with self.assertRaises(ValueError):self.run_apply('enable',self.owned(),probe=fail)
        self.assertEqual(self.events,[])
    def test_postflight_failure_recovers_disabled(self):
        calls=0
        def check(*a,**kw):
            nonlocal calls;calls+=1
            if calls==2:raise TimeoutError('probe timeout')
            return self.evidence
        with self.assertRaises(TimeoutError):self.run_apply('enable',self.owned(),probe=check)
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
        self.assertTrue(self.records[-1]['recoveredDisabled'])
    def test_restart_failure_recovers_disabled(self):
        original=self.h['ctl'];failed=False
        def ctl(*args):
            nonlocal failed
            if args==('start',c.API) and not failed:failed=True;raise TimeoutError('restart')
            return original(*args)
        self.h['ctl']=ctl
        with self.assertRaises(TimeoutError):self.run_apply('enable',self.owned())
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
        self.assertTrue(self.records[-1]['recoveredDisabled'])
    def test_changed_owned_inode_is_never_overwritten(self):
        owned=self.owned();other=self.root/'foreign';other.write_bytes(self.drop.read_bytes());other.chmod(0o644)
        os.replace(other,self.drop)
        with self.assertRaises(ValueError):c.replace_owned(self.h,PINS,True,owned,lambda *_:None)
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
    def test_stage_cannot_replace_foreign_path(self):
        self.drop.write_text('foreign')
        with self.assertRaises(ValueError):c.replace_owned(self.h,PINS,False,None,lambda *_:None)
        self.assertEqual(self.drop.read_text(),'foreign')
    def test_publish_is_creation_only_if_path_races_in(self):
        def intent(*_):self.drop.write_text('foreign')
        with self.assertRaises(ValueError):c.replace_owned(self.h,PINS,False,None,intent)
        self.assertEqual(self.drop.read_text(),'foreign')
    def test_intent_is_durable_before_publication(self):
        seen=[]
        def save(candidate,phase):seen.append((phase,self.drop.exists(),candidate))
        result=c.replace_owned(self.h,PINS,False,None,save)
        self.assertEqual(seen[0][:2],('prepared',False));self.assertEqual(seen[1][:2],('published',True))
        self.assertEqual(result['identity'],c.file_identity(self.drop))
    def test_foreign_file_during_failed_enable_is_preserved_and_apps_stay_drained(self):
        calls=0
        def check(*a,**kw):
            nonlocal calls;calls+=1
            if calls==2:
                other=self.root/'foreign';other.write_text('foreign');other.chmod(0o644);os.replace(other,self.drop)
                raise ValueError('postflight')
            return self.evidence
        with self.assertRaises(ValueError):self.run_apply('enable',self.owned(),probe=check)
        self.assertEqual(self.drop.read_text(),'foreign')
        self.assertTrue(all(row['ActiveState']=='inactive' for row in self.appstates.values()))
    def test_configuration_drift_blocks_restart(self):
        def config(_h,owned):
            return 'changed' if owned and owned['enabled'] else 'config'
        with self.assertRaises(ValueError):self.run_apply('enable',self.owned(),config=config)
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
        self.assertTrue(self.records[-1]['recoveredDisabled'])
    def test_private_receipt_refuses_existing_or_public_parent(self):
        path=self.root/'receipt.json';write=c.private_journal(path);write({'public':'hash'})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
        with self.assertRaises(ValueError):c.private_journal(path)
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):c.private_journal(self.root/'other.json')
    def test_private_directory_rejects_writable_ancestor(self):
        parent=self.root/'untrusted';parent.mkdir();parent.chmod(0o777)
        with self.assertRaises(ValueError):c.trusted_directory(parent)
    def test_service_capture_drift_rejected_before_mutation(self):
        capture=self.captured('enable',self.owned());self.appstates[c.API]=row('inactive')
        with self.assertRaises(ValueError):c.apply(self.h,self.approval,capture,'enable',lambda _:None)
        self.assertEqual(self.events,[])
    def test_stage_failure_retains_disabled_pins(self):
        original=self.h['ctl'];failed=False
        def ctl(*args):
            nonlocal failed
            if args==('start',c.API) and not failed:failed=True;raise ValueError('start')
            return original(*args)
        self.h['ctl']=ctl
        with self.assertRaises(ValueError):self.run_apply('stage-disabled')
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
        self.assertTrue(self.records[-1]['recoveredDisabled'])
    def test_update_race_moves_foreign_inode_without_deleting_it(self):
        owned=self.owned()
        original=self.h['rename_absent']
        def rename(source,target):
            if source==self.drop:
                foreign=self.root/'foreign';foreign.write_text('foreign');foreign.chmod(0o644);os.replace(foreign,self.drop)
            return original(source,target)
        self.h['rename_absent']=rename
        with self.assertRaises(ValueError):c.replace_owned(self.h,PINS,True,owned,lambda *_:None)
        self.assertEqual(self.drop.read_text(),'foreign')
    def test_publication_race_preserves_foreign_target_and_owned_quarantine(self):
        owned=self.owned();original=os.link
        def link(source,target,**kw):
            if target==self.drop:self.drop.write_text('foreign')
            return original(source,target,**kw)
        with patch.object(os,'link',side_effect=link),self.assertRaises(FileExistsError):
            c.replace_owned(self.h,PINS,True,owned,lambda *_:None)
        self.assertEqual(self.drop.read_text(),'foreign')
        self.assertEqual(len(list(self.drop.parent.glob('.work-batch-activation-recovery-*/previous.conf'))),1)
    def configuration_fixture(self,owned=None):
        unit=self.root/'example.service';unit.write_text('[Service]\nExecStart=/opt/node/bin/node app.mjs\n');unit.chmod(0o644)
        env=self.root/'private.env';env.write_text('PRIVATE_TOKEN=private-test-value\n');env.chmod(0o640)
        props={key:'' for key in ('Environment','EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStart',
            'WorkingDirectory','FragmentPath','DropInPaths','User','Group','UnitFileState')}
        props.update(FragmentPath=str(unit),EnvironmentFiles=str(env)+' (ignore_errors=no)',WorkingDirectory=str(c.ROOT),ExecStart=EXEC_START)
        perunit={u:copy.deepcopy(props) for u in (c.API,c.WORKER,*self.gate,*self.auth,*self.search)}
        for name in perunit:
            if name.endswith(('.socket','.timer')):perunit[name]['ExecStart']=''
        if owned:
            perunit[c.API]['Environment']=' '.join(k+'='+v for k,v in c.values(owned['pins'],owned['enabled']).items())
            perunit[c.API]['DropInPaths']=str(self.drop)
        manager={'value':'PRIVATE_MANAGER=private-manager-value'}
        def ctl(*args):
            if args==('show-environment',):return manager['value']
            return perunit[args[1]][args[-1]]
        self.h['ctl']=ctl
        return perunit,manager,env
    def test_configuration_hash_omits_only_controlled_delta(self):
        props,manager,env=self.configuration_fixture()
        empty=c.configuration(self.h,None)
        owned=self.owned()
        props[c.API]['Environment']=' '.join(k+'='+v for k,v in c.values(PINS,False).items())
        props[c.API]['DropInPaths']=str(self.drop)
        self.assertEqual(c.configuration(self.h,owned),empty)
        env.write_text('PRIVATE_TOKEN=changed\n')
        self.assertNotEqual(c.configuration(self.h,owned),empty)
    def test_configuration_rejects_shadow_inheritance_and_multiline_file(self):
        owned=self.owned();props,manager,env=self.configuration_fixture(owned)
        c.configuration(self.h,owned)
        for field in ('PassEnvironment','UnsetEnvironment'):
            props[c.API][field]='WORK_BATCH_WRITES_ENABLED'
            with self.assertRaises(ValueError):c.configuration(self.h,owned)
            props[c.API][field]=''
        manager['value']='WORK_BATCH_WRITES_ENABLED=1'
        with self.assertRaises(ValueError):c.configuration(self.h,owned)
        manager['value']=''
        env.write_text('WORK_BATCH_WRITES_ENABLED="\n1"\n')
        with self.assertRaises(ValueError):c.configuration(self.h,owned)

    def lifecycle_configuration_fixture(self,owned=None,fail_restart=False):
        original_ctl=self.h['ctl'];original_drain=self.h['drain_apps']
        props,manager,env=self.configuration_fixture(owned)
        configuration_ctl=self.h['ctl'];counter=100;failed=False
        for index,unit in enumerate(self.units):self.appstates[unit]['MainPID']=str(20+index)
        def descriptor(unit,active):
            nonlocal counter
            if not props[unit]['ExecStart']:return
            prefix=props[unit]['ExecStart'].split(' ; start_time=')[0]
            if active:
                counter+=1
                props[unit]['ExecStart']=(prefix+' ; start_time=[Sun 2026-10-25 15:50:00 UTC]'
                    ' ; stop_time=[n/a] ; pid='+str(counter)+' ; code=(null) ; status=0/0 }')
                if unit in self.appstates:self.appstates[unit]['MainPID']=str(counter)
            else:
                props[unit]['ExecStart']=(prefix+' ; start_time=[Sat 2026-10-24 18:44:16 UTC]'
                    ' ; stop_time=[Sun 2026-10-25 15:42:38 UTC] ; pid=3713663 ; code=killed ; status=15/TERM }')
        def ctl(*args):
            nonlocal failed
            if args[0] in ('show','show-environment'):return configuration_ctl(*args)
            if args==('daemon-reload',):
                props[c.API]['Environment']=' '.join(line.removeprefix('Environment=')
                    for line in self.drop.read_text().splitlines() if line.startswith('Environment='))
                props[c.API]['DropInPaths']=str(self.drop)
            if args[0]=='start':
                if fail_restart and args[1]==c.API and not failed:
                    failed=True;raise TimeoutError('restart')
                original_ctl(*args);descriptor(args[1],True)
            else:original_ctl(*args)
            return ''
        def drain():
            original_drain()
            for unit in (*self.units,*self.gate):descriptor(unit,False)
        def environment(pid):
            unit=next(name for name,row in self.appstates.items() if row['MainPID']==pid)
            return dict(value.split('=',1) for value in props[unit]['Environment'].split())
        self.h.update(ctl=ctl,drain_apps=drain,process_environment=environment)
        return props

    def test_actual_configuration_stage_enable_disable_across_restart(self):
        props=self.lifecycle_configuration_fixture()
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'probe',return_value=self.evidence):
            owned=None
            for operation in ('stage-disabled','enable','disable'):
                captured=c.capture(self.h,self.approval,owned,operation)
                result=c.apply(self.h,self.approval,captured,operation,
                    lambda record:self.records.append(copy.deepcopy(record)))
                self.assertTrue(result['complete']);owned=result['owned']
                self.assertEqual(c.configuration(self.h,owned),captured['configurationSha256'])
                self.assertEqual(owned['enabled'],operation=='enable')
                self.assertEqual(self.drop.read_bytes(),c.render(PINS,operation=='enable'))
                self.assertTrue(all(row['ActiveState']=='active' for row in self.appstates.values()))
        self.assertTrue(any(event==('start',self.gate[1]) for event in self.events))

    def test_actual_configuration_postflight_failure_recovers_disabled(self):
        owned=self.owned();self.lifecycle_configuration_fixture(owned);calls=0
        def evidence(*args,**kwargs):
            nonlocal calls;calls+=1
            if calls==3:raise TimeoutError('postflight probe')
            return self.evidence
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'probe',side_effect=evidence):
            captured=c.capture(self.h,self.approval,owned,'enable')
            with self.assertRaisesRegex(TimeoutError,'postflight probe'):
                c.apply(self.h,self.approval,captured,'enable',lambda record:self.records.append(copy.deepcopy(record)))
        result=self.records[-1]
        self.assertTrue(result['recoveredDisabled']);self.assertFalse(result['owned']['enabled'])
        self.assertEqual(c.configuration(self.h,result['owned']),captured['configurationSha256'])
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
        self.assertTrue(all(row['ActiveState']=='active' for row in self.appstates.values()))

    def test_actual_configuration_restart_failure_recovers_disabled(self):
        owned=self.owned();self.lifecycle_configuration_fixture(owned,fail_restart=True)
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'probe',return_value=self.evidence):
            captured=c.capture(self.h,self.approval,owned,'enable')
            with self.assertRaisesRegex(TimeoutError,'restart'):
                c.apply(self.h,self.approval,captured,'enable',lambda record:self.records.append(copy.deepcopy(record)))
        result=self.records[-1]
        self.assertTrue(result['recoveredDisabled']);self.assertFalse(result['owned']['enabled'])
        self.assertEqual(c.configuration(self.h,result['owned']),captured['configurationSha256'])
        self.assertTrue(all(row['ActiveState']=='active' for row in self.appstates.values()))

    def test_configuration_exec_start_keeps_commands_and_rejects_ambiguous_fields(self):
        props,_,_=self.configuration_fixture()
        before=c.configuration(self.h,None)
        for unit in (c.API,c.WORKER,self.gate[1],*self.auth,*self.search):
            old=props[unit]['ExecStart']
            props[unit]['ExecStart']=old.replace('app.mjs','changed.mjs')
            self.assertNotEqual(c.configuration(self.h,None),before)
            props[unit]['ExecStart']=old
        for value in ('',EXEC_START.replace('app.mjs','app.mjs ; pid=999'),
                EXEC_START.replace('status=0/0','status=unknown'),EXEC_START+' '+EXEC_START):
            props[c.API]['ExecStart']=value
            with self.assertRaisesRegex(ValueError,'Unsupported ExecStart serialization'):
                c.configuration(self.h,None)
        props[c.API]['ExecStart']=EXEC_START
        self.assertEqual(c.configuration(self.h,None),before)

    def test_process_environment_shadow_is_rejected(self):
        owned=self.owned();self.h['process_environment']=lambda pid:{**c.values(PINS,False),'WORK_BATCH_UNKNOWN':'1'}
        with self.assertRaises(ValueError):c.process_environment(self.h,owned)
    def test_approval_derives_only_successful_exact_dormant_scope(self):
        spec=importlib.util.spec_from_file_location('planner',Path(__file__).with_name('prepare-approval.py'))
        p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
        m={'format':'proof-of-work-work-batch-sends-scoped-runtime-v1','sourceCommit':'c'*40,'baselineHead':'d'*40,
            'releaseId':'batch','nodeSha256':'e'*64,'dependencies':{},'dependencyMetadata':{},
            'sources':[{'path':name,'after':'a'*64} for name in p.FIXED],
            'sourceMetadata':{name:{'uid':1000,'gid':1000,'mode':0o644} for name in p.FIXED}}
        raw=json.dumps(m).encode()
        r={'format':m['format'],'sourceCommit':m['sourceCommit'],'baselineHead':m['baselineHead'],
            'releaseId':'batch','manifestSha256':p.sha(raw),'installed':True,'rolledBack':False,'completedAt':'now'}
        hashes={key:'f'*64 for key in ('controllerSha256','probeSha256','dormantControllerSha256')}
        args=(m['sourceCommit'],hashes,'1'*64,'/opt/node-v24.18.0-linux-x64/bin/node')
        result=p.derive(raw,json.dumps(r).encode(),*args)
        self.assertEqual(result['runtimeHead'],'d'*40);self.assertEqual(result['sourceCommit'],'c'*40)
        for bad in [{'rolledBack':True},{'installed':False},{'completedAt':None},{'manifestSha256':'0'*64},{'errorClass':'TimeoutError'}]:
            with self.assertRaises(ValueError):p.derive(raw,json.dumps({**r,**bad}).encode(),*args)
if __name__=='__main__':unittest.main()
