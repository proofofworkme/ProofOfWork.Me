#!/usr/bin/python3 -I
import copy, importlib.util, json, os, stat, tempfile, types, unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('write-gate.py'))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
helper_spec=importlib.util.spec_from_file_location('scoped_activation_helper',
    Path(__file__).parent.parent/'mail-work-batch/scoped-node.py')
helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
EXEC_START=('{ path=/opt/node/bin/node ; argv[]=/opt/node/bin/node app.mjs ; ignore_errors=no'
    ' ; start_time=[Sat 2026-10-24 18:44:16 UTC] ; stop_time=[n/a]'
    ' ; pid=3713663 ; code=(null) ; status=0/0 }')
PINS={}
def row(active='active'):
    return {'ActiveState':active,'MainPID':'11' if active=='active' else '0','WorkingDirectory':str(c.ROOT)}
class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='pay-activation-test-',dir='/tmp')
        self.root=Path(self.tmp.name);self.drop=self.root/'dropins'/'zzzzz-pay-writes.conf'
        self.drop.parent.mkdir(mode=0o755)
        self.pathpatch=patch.object(c,'DROPIN',self.drop);self.pathpatch.start()
        if os.geteuid()!=0:
            # CI simulates only root ownership inside this private fixture.
            # Production safe_read, link counts and renameat2 remain real.
            real_identity=c.file_identity;real_trusted=c.trusted_directory
            def fixture(path):return path==self.root or self.root in path.parents
            def identity(path):
                result=real_identity(path)
                if fixture(path):
                    self.assertEqual(result[2:4],[os.geteuid(),os.getegid()]);result[2:4]=[0,0]
                return result
            def trusted(path):
                real_lstat=Path.lstat
                def lstat(path,*args,**kwargs):
                    info=real_lstat(path,*args,**kwargs)
                    if fixture(path) or path in self.root.parents:
                        if fixture(path):self.assertEqual((info.st_uid,info.st_gid),(os.geteuid(),os.getegid()))
                        fields={name:getattr(info,name) for name in dir(info) if name.startswith('st_')}
                        fields.update(st_uid=0,st_gid=0);return types.SimpleNamespace(**fields)
                    return info
                with patch.object(Path,'lstat',lstat):real_trusted(path)
            def fchown(fd,uid,gid):
                info=os.fstat(fd)
                self.assertEqual((uid,gid),(0,0))
                self.assertEqual((info.st_uid,info.st_gid),(os.geteuid(),os.getegid()))
            for target,name,value in ((c,'file_identity',identity),(c,'trusted_directory',trusted),(os,'fchown',fchown)):
                handle=patch.object(target,name,value);handle.start();self.addCleanup(handle.stop)
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
        self.h={'safe_read':helper.safe_read,'sync':lambda p:None,'rename_absent':helper.rename_absent,'states':states,'gateway_states':lambda:copy.deepcopy(self.gateway),
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
        return {'format':'pay-activation-capture-v1','operation':operation,
            'approvalSha256':c.sha(c.canonical(self.approval)),'configurationSha256':'config',
            'runtimeIdentitySha256':'runtime','states':c.states_snapshot(self.h),'owned':owned,'evidence':self.evidence}

    def run_apply(self,operation,owned=None,probe=None,config=None):
        capture=self.captured(operation,owned)
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'configuration',side_effect=config or (lambda *_:'config')),patch.object(c,'process_environment',return_value={}),patch.object(c,'probe',side_effect=probe or (lambda *a,**kw:self.evidence)):
            return c.apply(self.h,self.approval,capture,operation,lambda r:self.records.append(copy.deepcopy(r)))

    def test_render_exact_single_pay_switch(self):
        raw=c.render(PINS,False).decode()
        self.assertEqual(raw.count('Environment='),1);self.assertTrue(raw.endswith('POW_PAY_WRITES_ENABLED=0\n'))
        self.assertNotIn('PASSWORD',raw)

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
        owned=self.owned();original=self.h['rename_absent']
        def rename(source,target):
            if target==self.drop:self.drop.write_text('foreign')
            return original(source,target)
        self.h['rename_absent']=rename
        with self.assertRaises(FileExistsError):
            c.replace_owned(self.h,PINS,True,owned,lambda *_:None)
        self.assertEqual(self.drop.read_text(),'foreign')
        self.assertEqual(len(list(self.drop.parent.glob('.pay-activation-recovery-*/previous.conf'))),1)

    def test_existing_replacements_keep_single_link_and_prepared_inode(self):
        owned=self.owned()
        for enabled in (True,False):
            saved=[]
            def save(candidate,phase):
                saved.append((phase,copy.deepcopy(candidate)))
                if phase=='published':
                    self.assertEqual(self.drop.lstat().st_nlink,1)
                    self.assertEqual(list(self.drop.parent.glob('.pay-activation-*')),[])
            owned=c.replace_owned(self.h,PINS,enabled,owned,save)
            self.assertEqual(owned['identity'],saved[0][1]['identity'])
            self.assertEqual(owned['identity'],c.file_identity(self.drop))
            self.assertEqual(helper.safe_read(self.drop),c.render(PINS,enabled))
            self.assertEqual(self.drop.lstat().st_nlink,1)
            self.assertEqual([phase for phase,_ in saved],['prepared','quarantine-prepared','published'])

    def test_owned_dropin_with_extra_hard_link_is_refused(self):
        owned=self.owned();alias=self.root/'unexpected-alias'
        os.link(self.drop,alias)
        with self.assertRaisesRegex(ValueError,'Unsafe source file'):
            c.replace_owned(self.h,PINS,True,owned,lambda *_:self.fail('unsafe file journaled'))
        self.assertEqual(self.drop.read_bytes(),c.render(PINS,False))
        self.assertEqual(self.drop.lstat().st_ino,alias.lstat().st_ino)

    def test_changed_prepared_inode_is_retained_with_owned_quarantine(self):
        owned=self.owned()
        def save(candidate,phase):
            if phase=='prepared':
                temp,=self.drop.parent.glob('.pay-activation-*')
                foreign=self.root/'foreign-temp';foreign.write_text('foreign');foreign.chmod(0o644)
                os.replace(foreign,temp)
        with self.assertRaisesRegex(ValueError,'Refuse foreign or changed drop-in'):
            c.replace_owned(self.h,PINS,True,owned,save)
        self.assertEqual(self.drop.read_text(),'foreign')
        previous,=self.drop.parent.glob('.pay-activation-recovery-*/previous.conf')
        self.assertEqual(c.file_identity(previous),owned['identity'])
        self.assertEqual(helper.safe_read(previous),c.render(PINS,False))

    def configuration_fixture(self,owned=None):
        unit=self.root/'example.service';unit.write_text('[Service]\nExecStart=/opt/node/bin/node app.mjs\n');unit.chmod(0o644)
        env=self.root/'private.env';env.write_text('PRIVATE_TOKEN=private-test-value\n');env.chmod(0o640)
        props={key:'' for key in ('Environment','EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStart',
            'WorkingDirectory','FragmentPath','DropInPaths','User','Group','UnitFileState',
            'Listen','Service','Accept','Requires','PartOf')}
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
            props[c.API][field]='POW_PAY_WRITES_ENABLED'
            with self.assertRaises(ValueError):c.configuration(self.h,owned)
            props[c.API][field]=''
        manager['value']='POW_PAY_WRITES_ENABLED=1'
        with self.assertRaises(ValueError):c.configuration(self.h,owned)
        manager['value']=''
        env.write_text('POW_PAY_WRITES_ENABLED="\n1"\n')
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

    def test_gateway_effective_configuration_drift_is_bound(self):
        props,_,_=self.configuration_fixture();before=c.configuration(self.h,None)
        props[self.gate[0]]['Listen']='[::]:9090 (Stream)'
        self.assertNotEqual(c.configuration(self.h,None),before)

    def test_existing_batch_variables_remain_bound_by_configuration(self):
        props,_,_=self.configuration_fixture()
        props[c.API]['Environment']='WORK_BATCH_WRITES_ENABLED=1 WORK_BATCH_DECLARATION_TXID='+('a'*64)
        before=c.configuration(self.h,None)
        props[c.API]['Environment']='WORK_BATCH_WRITES_ENABLED=0 WORK_BATCH_DECLARATION_TXID='+('a'*64)
        self.assertNotEqual(c.configuration(self.h,None),before)
        self.assertNotIn('WORK_BATCH_WRITES_ENABLED',c.render(PINS,False).decode())

    def test_process_environment_shadow_is_rejected(self):
        owned=self.owned();self.h['process_environment']=lambda pid:{**c.values(PINS,False),'POW_PAY_UNKNOWN':'1'}
        with self.assertRaises(ValueError):c.process_environment(self.h,owned)


    def dependency_reload_fixture(self,owned=None,fail_restart=False):
        # Exact unit groups and observed dependency permutations from a real
        # systemd reload; the systemctl backend remains this private fixture.
        self.gate=('proofofwork-api-wg.socket','proofofwork-api-wg.service')
        self.auth=('bitcoind.service','electrs.service','postgresql@16-main.service')
        self.search=('proofofwork-search-index.service','proofofwork-search-index.timer')
        self.other={unit:row() for unit in (*self.auth,*self.search)}
        self.gateway={unit:{'ActiveState':'active','UnitFileState':'enabled','MainPID':'12'}
            for unit in self.gate}
        self.h.update(GATEWAY=self.gate,AUTHORITY=self.auth,SEARCH=self.search)
        props=self.lifecycle_configuration_fixture(owned,fail_restart)
        changes=(
            (c.API,'Requires','-.mount sysinit.target data.mount system.slice',
                'data.mount -.mount sysinit.target system.slice'),
            (c.WORKER,'Requires','postgresql@16-main.service system.slice -.mount sysinit.target',
                'system.slice postgresql@16-main.service -.mount sysinit.target'),
            (c.WORKER,'PartOf','postgresql@16-main.service proofofwork-api.service',
                'proofofwork-api.service postgresql@16-main.service'),
            (self.gate[1],'Requires','proofofwork-api.service sysinit.target -.mount system.slice',
                'proofofwork-api.service sysinit.target system.slice -.mount'),
            (self.auth[0],'Requires','sysinit.target -.mount system.slice',
                '-.mount sysinit.target system.slice'),
            (self.auth[1],'Requires','sysinit.target system.slice -.mount',
                '-.mount sysinit.target system.slice'),
            (self.auth[2],'Requires','system-postgresql.slice sysinit.target -.mount data.mount',
                'data.mount system-postgresql.slice sysinit.target -.mount'),
            (self.search[0],'Requires','system.slice sysinit.target -.mount',
                'sysinit.target system.slice -.mount'),
        )
        for unit,key,before,after in changes:
            self.assertNotEqual(before,after)
            self.assertEqual(set(before.split(' ')),set(after.split(' ')))
            props[unit][key]=before
        original_ctl=self.h['ctl'];reloads=[]
        def ctl(*args):
            value=original_ctl(*args)
            if args==('daemon-reload',):
                for unit,key,before,after in changes:
                    props[unit][key]=after if len(reloads)%2==0 else before
                reloads.append(len(changes))
            return value
        self.h['ctl']=ctl
        return props,changes,reloads

    def test_configuration_matches_all_observed_dependency_reorders(self):
        props,changes,_=self.dependency_reload_fixture()
        original_ctl=self.h['ctl'];before=c.configuration(self.h,None)
        for unit,key,old,new in changes:props[unit][key]=new
        self.assertEqual(c.configuration(self.h,None),before)
        self.assertIs(self.h['ctl'],original_ctl)
        self.assertEqual([props[unit][key] for unit,key,old,new in changes],
            [new for unit,key,old,new in changes])

    def test_configuration_dependency_membership_remains_bound(self):
        props,changes,_=self.dependency_reload_fixture();before=c.configuration(self.h,None)
        for unit,key,old,new in changes:
            members=old.split(' ')
            for changed in (old+' unexpected.service',' '.join(members[1:]),
                    ' '.join(['replacement.service',*members[1:]])):
                with self.subTest(unit=unit,property=key,changed=changed):
                    props[unit][key]=changed
                    self.assertNotEqual(c.configuration(self.h,None),before)
                    props[unit][key]=old

    def test_dependency_serialization_preserves_escapes_and_refuses_ambiguity(self):
        props,_,_=self.dependency_reload_fixture()
        props[c.API]['Requires']=r'data\x20files.mount -.mount'
        before=c.configuration(self.h,None)
        props[c.API]['Requires']=r'-.mount data\x20files.mount'
        self.assertEqual(c.configuration(self.h,None),before)
        props[c.API]['Requires']='-.mount datax20files.mount'
        self.assertNotEqual(c.configuration(self.h,None),before)
        for value in ('a.service a.service','a.service  b.service',' a.service',
                'a.service ','a.service\tb.service','a.service\nb.service',
                r'data\xGGfiles.mount','a'*256+'.service'):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,
                    'Unsupported systemd dependency serialization'):
                props[c.API]['Requires']=value;c.configuration(self.h,None)
        props[c.API]['Requires']=''
        self.assertIsInstance(c.configuration(self.h,None),str)

    def test_dependency_normalization_keeps_order_sensitive_configuration(self):
        props,_,env=self.configuration_fixture()
        extra=self.root/'second.env';extra.write_text('PRIVATE_TOKEN=second-test-value\n');extra.chmod(0o640)
        first=self.root/'first.conf';second=self.root/'second.conf'
        for path in (first,second):path.write_text('[Service]\n');path.chmod(0o644)
        for key,ordered,reversed_value in (
                ('EnvironmentFiles',f'{env} (ignore_errors=no) {extra} (ignore_errors=no)',
                    f'{extra} (ignore_errors=no) {env} (ignore_errors=no)'),
                ('DropInPaths',f'{first} {second}',f'{second} {first}'),
                ('ExecStart',EXEC_START.replace('app.mjs','app.mjs --first --second'),
                    EXEC_START.replace('app.mjs','app.mjs --second --first'))):
            with self.subTest(property=key):
                original=props[c.API][key];props[c.API][key]=ordered
                before=c.configuration(self.h,None);props[c.API][key]=reversed_value
                self.assertNotEqual(c.configuration(self.h,None),before)
                props[c.API][key]=original

    def test_actual_configuration_lifecycle_survives_dependency_reorders(self):
        props,changes,reloads=self.dependency_reload_fixture()
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
                self.assertTrue(all(value['ActiveState']=='active' for value in self.appstates.values()))
                self.h['require_gateway_baseline'](self.h['gateway_states'](),c.gateway_pins(captured['states']))
        self.assertEqual(reloads,[len(changes)]*3)

    def test_postflight_recovery_survives_dependency_reorders(self):
        owned=self.owned();_,changes,reloads=self.dependency_reload_fixture(owned);calls=0
        def evidence(*args,**kwargs):
            nonlocal calls;calls+=1
            if calls==3:raise TimeoutError('postflight probe')
            return self.evidence
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'probe',side_effect=evidence):
            captured=c.capture(self.h,self.approval,owned,'enable')
            with self.assertRaisesRegex(TimeoutError,'postflight probe'):
                c.apply(self.h,self.approval,captured,'enable',
                    lambda record:self.records.append(copy.deepcopy(record)))
        result=self.records[-1]
        self.assertTrue(result['failed']);self.assertFalse(result['complete'])
        self.assertTrue(result['recoveredDisabled']);self.assertFalse(result['owned']['enabled'])
        self.assertEqual(result['phase'],'failed-disabled')
        self.assertEqual(c.configuration(self.h,result['owned']),captured['configurationSha256'])
        self.assertTrue(all(value['ActiveState']=='active' for value in self.appstates.values()))
        self.assertEqual(reloads,[len(changes)]*2)

    def test_restart_recovery_survives_dependency_reorders(self):
        owned=self.owned();_,changes,reloads=self.dependency_reload_fixture(owned,fail_restart=True)
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'probe',return_value=self.evidence):
            captured=c.capture(self.h,self.approval,owned,'enable')
            with self.assertRaisesRegex(TimeoutError,'restart'):
                c.apply(self.h,self.approval,captured,'enable',
                    lambda record:self.records.append(copy.deepcopy(record)))
        result=self.records[-1]
        self.assertTrue(result['failed']);self.assertFalse(result['complete'])
        self.assertTrue(result['recoveredDisabled']);self.assertFalse(result['owned']['enabled'])
        self.assertEqual(c.configuration(self.h,result['owned']),captured['configurationSha256'])
        self.assertTrue(all(value['ActiveState']=='active' for value in self.appstates.values()))
        self.assertEqual(reloads,[len(changes)]*2)

    def test_reload_dependency_membership_tamper_prevents_restart(self):
        props,_,_=self.dependency_reload_fixture();original_ctl=self.h['ctl']
        def ctl(*args):
            value=original_ctl(*args)
            if args==('daemon-reload',):props[c.API]['Requires']+=' unexpected.service'
            return value
        self.h['ctl']=ctl
        with patch.object(c,'runtime_fence',return_value='runtime'),patch.object(c,'probe',return_value=self.evidence):
            captured=c.capture(self.h,self.approval,None,'stage-disabled')
            with self.assertRaisesRegex(ValueError,'Source/config changed during operation'):
                c.apply(self.h,self.approval,captured,'stage-disabled',
                    lambda record:self.records.append(copy.deepcopy(record)))
        result=self.records[-1]
        self.assertTrue(result['failed']);self.assertFalse(result['complete'])
        self.assertFalse(result['recoveredDisabled']);self.assertFalse(result['owned']['enabled'])
        self.assertTrue(all(value['ActiveState']=='inactive' for value in self.appstates.values()))
        self.assertFalse(any(event[0]=='start' for event in self.events))

class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.approval={'sourceCommit':'a'*40,'runtimeHead':'b'*40,'checkerSha256':'c'*64,
            'node':{'sha256':'d'*64},'runtime':{'server/pay.mjs':{'sha256':'e'*64}}}
        self.report={'format':'pay-write-gate-qualification-v1','sourceCommit':'a'*40,'rootReviewed':True,
            'checkerSha256':'c'*64,'runtimeAfter':{'server/pay.mjs':'e'*64},
            'result':{'ok':True,'mode':'preactivation','signingExercised':False,'height':975856,'hash':'f'*64}}
    def test_only_reviewed_current_preactivation_admits(self):
        self.assertEqual(c.validate_qualification(self.report,self.approval),{'height':975856,'blockHash':'f'*64})
        for key,value in [('sourceCommit','0'*40),('rootReviewed',False),('checkerSha256','0'*64),('runtimeAfter',{})]:
            changed=copy.deepcopy(self.report);changed[key]=value
            with self.assertRaises(ValueError):c.validate_qualification(changed,self.approval)
        for key,value in [('mode','released'),('ok',False),('signingExercised',True),('height',975855),('hash','bad')]:
            changed=copy.deepcopy(self.report);changed['result'][key]=value
            with self.assertRaises(ValueError):c.validate_qualification(changed,self.approval)
    def test_completed_exact_deployment_required(self):
        m={'format':'proof-of-work-pay-scoped-runtime-v1','sourceCommit':'a'*40,'baselineHead':'b'*40,
            'releaseId':'release','nodeSha256':'d'*64,'dependencies':{},
            'sources':[{'path':'server/pay.mjs','after':'e'*64,'before':None,'base64':'YQ=='}]}
        raw=c.canonical(m)
        r={'format':m['format'],'sourceCommit':'a'*40,'baselineHead':'b'*40,'releaseId':'release',
            'manifestSha256':c.sha(raw),'installed':True,'rolledBack':False,'completedAt':'now',
            'sources':[{k:v for k,v in m['sources'][0].items() if k!='base64'}]}
        h={'ALLOWED':{'server/pay.mjs'}}
        c.validate_deployment(m,raw,r,self.approval,h)
        for key,value in [('installed',False),('rolledBack',True),('completedAt',None),('recoveryIncomplete',True),
                ('manifestSha256','0'*64),('sourceCommit','0'*40),('sources',[])]:
            changed=copy.deepcopy(r);changed[key]=value
            with self.assertRaises(ValueError):c.validate_deployment(m,raw,changed,self.approval,h)
    def test_no_environment_protocol_authority_is_accepted(self):
        with self.assertRaises(ValueError):c.public_pins({'activationHeight':975856})
        self.assertEqual(c.render({},True),b'[Service]\nEnvironment=POW_PAY_WRITES_ENABLED=1\n')

class PreparationTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('pay_gate_prepare_fixture',Path(__file__).with_name('prepare-write-gate.py'))
        self.p=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.p)
        ns={'__name__':'_pay_prepare_scope'}
        exec(compile(Path(__file__).with_name('scoped-node.py').read_bytes(),'pay-scoped-node.py','exec'),ns)
        self.m={'format':'proof-of-work-pay-scoped-runtime-v1','sourceCommit':'a'*40,'baselineHead':'b'*40,
            'releaseId':'release','nodeSha256':'d'*64,'dependencies':{},
            'sources':[{'path':name,'after':'e'*64,'before':None,'base64':'YQ=='} for name in sorted(ns['ALLOWED'])]}
        raw=c.canonical(self.m)
        self.r={'format':self.m['format'],'sourceCommit':'a'*40,'baselineHead':'b'*40,'releaseId':'release',
            'manifestSha256':c.sha(raw),'installed':True,'rolledBack':False,'completedAt':'now',
            'sources':[{k:v for k,v in row.items() if k!='base64'} for row in self.m['sources']]}
        self.capture={'format':'proof-of-work-pay-runtime-capture-v1','root':'/opt/proofofwork-api','baselineHead':'b'*40,
            'controllerSha256':'f'*64,'nodeSha256':'d'*64,'nodePath':'/opt/node-fixture/bin/node',
            'sources':{row['path']:{'sha256':'e'*64,'uid':1000,'gid':1000,'mode':0o640} for row in self.m['sources']}}
        self.report={'format':'pay-write-gate-qualification-v1','sourceCommit':'a'*40,'rootReviewed':True,
            'checkerSha256':'c'*64,'runtimeAfter':{name:'e'*64 for name in self.capture['sources']},
            'result':{'ok':True,'mode':'preactivation','signingExercised':False,'height':975856,'hash':'f'*64}}
        self.options={'source_commit':'a'*40,'status_sha256':'f'*64,
            'hashes':{'dormantControllerSha256':'f'*64,'checkerSha256':'c'*64},
            'bindings':{**{k:{'path':'/tmp/fixture/'+k,'sha256':'a'*64} for k in
                ('deploymentManifest','deploymentReceipt','qualification')},'_manifestBytes':raw}}
    def test_preparation_binds_postdeployment_capture_without_mutation(self):
        value=self.p.derive(self.m,self.r,self.capture,self.report,**self.options)
        self.assertEqual(len(value['runtime']),13)
        self.assertNotIn('_manifestBytes',value)
        for key in ('baselineHead','nodeSha256','controllerSha256'):
            changed=copy.deepcopy(self.capture);changed[key]='0'*len(changed[key])
            with self.assertRaises(ValueError):self.p.derive(self.m,self.r,changed,self.report,**self.options)
    def test_preparation_rejects_runtime_digest_and_unsafe_metadata(self):
        name=next(iter(self.capture['sources']))
        for key,value in [('sha256','0'*64),('mode',0o666),('mode','640'),('uid',-1),('gid',-1)]:
            changed=copy.deepcopy(self.capture);changed['sources'][name][key]=value
            with self.assertRaises(ValueError):self.p.derive(self.m,self.r,changed,self.report,**self.options)

if __name__=='__main__':unittest.main()
