#!/usr/bin/python3 -I
"""Offline predecessor, ownership and supervisor tests; no production calls."""
import base64,copy,contextlib,hashlib,importlib.util,io,json,os,stat,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).parent
def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module);return module
C=load(HERE/'scoped-node.py','recovery_scoped')
S=load(HERE/'rollout-node.py','recovery_supervisor')
OLD=load(HERE.parent/'work-batch-reader-fix/check-scoped-node.test.py','old_fixture')
def encoded(value):return (json.dumps(value,sort_keys=True)+'\n').encode()

class PredecessorTests(unittest.TestCase):
    def setUp(self):
        fixture=OLD.ControllerTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        self.fixture=fixture;self.tmp=Path(fixture.temp.name)
        self.base=self.tmp/'retained';self.base.mkdir()
        self.m=copy.deepcopy(fixture.manifest);fixture.install()
        self.inner=self.base/('work-batch-reader-fix-'+self.m['releaseId']+'-20261026T204828Z');self.inner.mkdir(mode=0o700)
        (self.inner/'before-0.mjs').write_bytes((fixture.backup/'before-0.mjs').read_bytes())
        code=(HERE.parent/'work-batch-reader-fix/scoped-node.py').read_bytes()
        self.assertEqual(C.sha(code),C.PREDECESSOR_CONTROLLER_SHA)
        self.plan={'format':'proof-of-work-work-batch-reader-fix-rollout-plan-v1',
            'sourceCommit':self.m['sourceCommit'],'releaseId':self.m['releaseId'],
            'controllerBase64':base64.b64encode(code).decode(),'controllerSha256':C.sha(code),
            'runtimeManifestTemplate':copy.deepcopy(self.m),'nodePath':'/opt/node-test/bin/node'}
        self.r={k:copy.deepcopy(self.m[k])for k in ('format','sourceCommit','releaseId','baselineHead',
            'baseSourceCommit','restartConfigurationSha256','sourceMetadata','dependencyMetadata','gateway','protectedServices')}
        self.r.update(rollbackRoot=str(self.inner),manifestSha256=C.sha(encoded(self.m)),
            installed=True,sourceWritesStarted=True,stopRequested=True,sourceRollbackProhibited=True,
            forwardRecoveryRequired=True,recoveryIncomplete=True,rolledBack=False,errorClass='ValueError',
            recoveryErrorClass='ValueError',createdHelpers=copy.deepcopy(fixture.created),
            dependencyCount=len(self.m['dependencies']),authority={'core':{'MainPID':'45'}},
            sources=[{k:v for k,v in row.items()if k!='base64'}for row in self.m['sources']])
        self.dispatch={'format':'proof-of-work-work-batch-reader-fix-node-dispatch-receipt-v1',
            'planSha256':C.sha(encoded(self.plan)),'releaseId':self.m['releaseId'],'dispatchStatus':'refused','exitCode':1,
            'stdout':json.dumps({'format':'proof-of-work-work-batch-reader-fix-rollout-result-v1',
                'releaseId':self.m['releaseId'],'hold':{'ok':True},'searchRestoreDeferred':'retain hold'})}
        self.p={'format':'work-batch-reader-recovery-predecessor-v1',
            'unit':'pow-work-batch-reader-fix-'+self.m['sourceCommit'][:12]+'.service'}
        self.values={'plan':self.plan,'manifest':self.m,'receipt':self.r,'dispatch':self.dispatch}
        self.refresh()
        original=Path.lstat
        def directories(path,*args,**kwargs):
            value=original(path,*args,**kwargs)
            if path==self.inner:
                fields={k:getattr(value,k)for k in dir(value)if k.startswith('st_')};fields.update(st_uid=0,st_gid=0)
                return types.SimpleNamespace(**fields)
            return value
        self.start(patch.object(Path,'lstat',directories))
        self.start(patch.object(C,'BACKUPS',self.base))
        self.start(patch.object(C,'evidence_reference',self.read_ref))
    def start(self,handle):
        value=handle.start();self.addCleanup(handle.stop);return value
    def refresh(self):
        self.r['manifestSha256']=C.sha(encoded(self.m));self.dispatch['planSha256']=C.sha(encoded(self.plan))
        for key,value in self.values.items():
            p=(self.inner if key in ('manifest','receipt')else self.tmp)/(key+'.json');raw=encoded(value)
            p.write_bytes(raw);self.p[key]={'path':str(p),'sha256':C.sha(raw)}
    def read_ref(self,ref,limit=32*1024**2):
        raw=Path(ref['path']).read_bytes();C.require(C.sha(raw)==ref['sha256'],'Predecessor evidence changed');return raw
    def test_exact_failed_attempt_loads_without_relabelling(self):
        v=C.load_predecessor(self.p);self.assertTrue(v['receipt']['recoveryIncomplete']);self.assertFalse(v['receipt']['rolledBack'])
    def test_success_or_partial_failure_is_not_admission(self):
        for key,value in [('installed',False),('sourceWritesStarted',False),('sourceRollbackProhibited',False),
            ('forwardRecoveryRequired',False),('recoveryIncomplete',False),('rolledBack',True),('completedAt','now'),('postflight',{})]:
            old=copy.deepcopy(self.r);self.r[key]=value;self.refresh()
            with self.subTest(key=key),self.assertRaises(ValueError):C.load_predecessor(self.p)
            self.r.clear();self.r.update(old);self.refresh()
    def test_changed_plan_or_controller_refuses(self):
        self.plan['controllerSha256']='0'*64;self.refresh()
        with self.assertRaisesRegex(ValueError,'controller'):C.load_predecessor(self.p)
    def test_changed_manifest_without_reviewed_plan_refuses(self):
        self.m['baselineHead']='f'*40;self.refresh()
        with self.assertRaisesRegex(ValueError,'manifest differs'):C.load_predecessor(self.p)
    def test_changed_terminal_dispatch_refuses(self):
        for key,value in [('exitCode',0),('dispatchStatus','completed'),('planSha256','0'*64)]:
            old=copy.deepcopy(self.dispatch);self.dispatch[key]=value
            path=Path(self.p['dispatch']['path']);path.write_bytes(encoded(self.dispatch));self.p['dispatch']['sha256']=C.sha(path.read_bytes())
            with self.subTest(key=key),self.assertRaises(ValueError):C.load_predecessor(self.p)
            self.dispatch.clear();self.dispatch.update(old);self.refresh()
    def test_restored_search_is_not_retained_hold(self):
        o=json.loads(self.dispatch['stdout']);o['searchRestore']={'ok':True};self.dispatch['stdout']=json.dumps(o);self.refresh()
        with self.assertRaises(ValueError):C.load_predecessor(self.p)
    def test_changed_evidence_refuses(self):
        Path(self.p['receipt']['path']).write_bytes(b'foreign')
        with self.assertRaisesRegex(ValueError,'evidence changed'):C.load_predecessor(self.p)
    def fence_patches(self):
        self.start(patch.object(C,'QUARANTINE_PARENT',self.tmp/'quarantine'))
        self.start(patch.object(C,'ctl',return_value='ActiveState=failed\nMainPID=0\nExecMainStatus=1'))
        self.start(patch.object(C,'accepted_inventory_fence'))
        self.start(patch.object(C,'require_restart_configuration'))
    def test_original_quarantined_inode_verified(self):
        self.fence_patches();C.predecessor_fence(self.p,current=False)
    def test_running_predecessor_refuses_even_with_complete_receipt(self):
        self.fence_patches();C.ctl.return_value='ActiveState=active\nMainPID=123\nExecMainStatus=0'
        with self.assertRaisesRegex(ValueError,'still running'):C.predecessor_fence(self.p,current=False)
    def test_same_bytes_foreign_quarantine_inode_refuses(self):
        self.fence_patches();path=Path(self.r['createdHelpers'][C.READER]['beforePath']);foreign=path.with_name('foreign')
        foreign.write_bytes(path.read_bytes());foreign.chmod(path.stat().st_mode&0o777);os.replace(foreign,path)
        with self.assertRaisesRegex(ValueError,'inode or byte evidence'):C.predecessor_fence(self.p,current=False)
    def recovery_manifest(self):
        m=copy.deepcopy(self.m);m.update(format='proof-of-work-work-batch-reader-recovery-scoped-runtime-v1',
            predecessor=self.p,nodePath=self.plan['nodePath'])
        m['dependencies'][C.READER]=self.m['sources'][0]['after']
        rows=[]
        for name in sorted(C.ALLOWED):
            raw=(self.fixture.root/name).read_bytes();after=raw if name==C.READER else raw+b'// API growth fix\n'
            rows.append({'path':name,'before':C.sha(raw),'after':C.sha(after),'base64':base64.b64encode(after).decode()})
        m['sources']=rows;m['sourceMetadata']={name:m['dependencyMetadata'][name]for name in C.ALLOWED}
        m['sourceIdentities']={name:C.creation_identity((self.fixture.root/name).lstat())for name in C.ALLOWED}
        m['sourceParents']={name:C.parent_identity((self.fixture.root/name).parent.lstat())for name in C.ALLOWED}
        return m
    def test_recovery_manifest_preserves_installed_reader_and_all_dependency_pins(self):
        self.assertEqual(set(C.validate_manifest(self.recovery_manifest())),C.ALLOWED)
    def test_reader_change_or_unrelated_dependency_change_refuses(self):
        m=self.recovery_manifest();m['dependencies']['package.json']='0'*64
        with self.assertRaisesRegex(ValueError,'closure'):C.validate_manifest(m)
        m=self.recovery_manifest();row=next(r for r in m['sources']if r['path']==C.READER)
        raw=b'changed reader';row.update(after=C.sha(raw),base64=base64.b64encode(raw).decode())
        with self.assertRaisesRegex(ValueError,'reader lineage'):C.validate_manifest(m)

class PublicationTests(unittest.TestCase):
    def setUp(self):
        handle=patch.object(OLD,'module',C);handle.start();self.addCleanup(handle.stop)
        OLD.ControllerTests.setUp(self)
    install=OLD.ControllerTests.install
    test_two_file_publication=OLD.ControllerTests.test_forward_publication_preserves_before_inodes_and_single_link_candidates
    test_same_bytes_replacement=OLD.ControllerTests.test_same_bytes_replacement_inode_refuses_before_publication
    test_raced_incumbent=OLD.ControllerTests.test_raced_existing_source_is_retained_without_publication
    test_raced_destination=OLD.ControllerTests.test_raced_new_destination_is_never_overwritten
    test_replaced_candidate=OLD.ControllerTests.test_changed_candidate_inode_refuses_and_preserves_evidence

class SupervisorTests(unittest.TestCase):
    def plan(self):
        code=b'''from pathlib import Path
import hashlib
ROOT=Path('/unused');HOLD=Path('/unused/hold');SEARCH=('search.service','search.timer')
def validate_manifest(m):return {}
def fence(*args):pass
def metadata_fence(*args):pass
def source_identity_fence(*args):pass
def require_apps_drained():pass
def require_restart_configuration(*args):pass
def predecessor_fence(p):return {'manifest':{'releaseId':'old-release','batchAuthority':{}},'outcome':{'hold':{'ok':True}}}
def safe_read(*args):return b'exact-held-marker'
def sha(raw):return hashlib.sha256(raw).hexdigest()
'''
        return {'format':'proof-of-work-work-batch-reader-recovery-rollout-plan-v1','sourceCommit':'a'*40,'releaseId':'a'*12+'-20261026T220000Z',
            'controllerBase64':base64.b64encode(code).decode(),'controllerSha256':C.sha(code),
            'searchHoldControllerBase64':base64.b64encode(b'holder').decode(),'searchHoldControllerSha256':C.sha(b'holder'),
            'runtimeManifestTemplate':{'predecessor':{},'sourceCommit':'a'*40,'releaseId':'a'*12+'-20261026T220000Z',
                'batchAuthority':{},'sourceMetadata':{},'restartConfigurationSha256':'a'*64,
                'searchHold':{'bindings':{'files':{'search.service':'1'*64,'search.timer':'2'*64}}}}}
    def test_success_restores_original_hold_only_after_overlay(self):
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=[{'installed':True},{'ok':True}])as call,contextlib.redirect_stdout(io.StringIO()):
            S.rollout(self.plan())
        self.assertEqual(call.call_count,2);self.assertIn('restore',call.call_args_list[1].args[1]);self.assertIn('old-release',call.call_args_list[1].args[1])
    def test_any_overlay_failure_keeps_original_hold(self):
        for error in (ValueError('refusal'),S.ControllerStillRunning('unknown')):
            with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=error)as call,contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(type(error)):S.rollout(self.plan())
            self.assertEqual(call.call_count,1)

class RehearsalGateTests(unittest.TestCase):
    def setUp(self):
        self.plan={'sourceCommit':'a'*40,'releaseId':'a'*12+'-20261026T220000Z',
            'runtimeManifestTemplate':{'sourceCommit':'a'*40,'releaseId':'a'*12+'-20261026T220000Z',
                'predecessor':{'exact':'failed-attempt'},'sources':[{'path':name,'after':'b'*64}for name in sorted(C.ALLOWED)]}}
        self.pin=C.sha(encoded(self.plan))
        self.value={'format':'work-batch-summary-rehearsal-qualified-v1','qualified':True,
            'planSha256':self.pin,'sourceCommit':self.plan['sourceCommit'],'releaseId':self.plan['releaseId'],
            'candidateHashes':{name:'b'*64 for name in C.ALLOWED},'predecessor':{'exact':'failed-attempt'},
            'unit':'pow-batch-summary-rehearsal-'+self.plan['releaseId']+'.service','invocationId':'c'*32,
            'dispatchSha256':'d'*64,'stdoutSha256':'e'*64,
            'adapterHashes':{name:'f'*64 for name in ('api.mjs','postgres.mjs','fetch-guard.mjs')},
            'result':{'format':'work-batch-summary-readonly-rehearsal-v1','ok':True,'published':False,
                'indexedThroughBlock':973288,'indexedThroughBlockHash':'1'*64,'snapshotId':'2'*24,
                'summaryKeys':sorted(['growthSummary','inceptionSummary','infinitySummary','logSummary',
                    'marketplaceSummary','tokenSummary','workFloor','workSummary'])}}
    def test_exact_success_is_admitted_without_changing_plan(self):
        before=encoded(self.plan);self.assertIs(C.validate_rehearsal(self.value,self.plan,self.pin),self.value)
        self.assertEqual(encoded(self.plan),before)
    def test_wrong_identity_or_missing_qualification_refuses(self):
        for key,value in [('qualified',False),('planSha256','0'*64),('sourceCommit','0'*40),
                ('releaseId','foreign'),('candidateHashes',{C.READER:'b'*64}),('predecessor',{}),
                ('unit','foreign.service'),('invocationId',''),('adapterHashes',{}),('dispatchSha256','')]:
            q=copy.deepcopy(self.value);q[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):C.validate_rehearsal(q,self.plan,self.pin)
        q=copy.deepcopy(self.value);q.pop('qualified')
        with self.assertRaises(ValueError):C.validate_rehearsal(q,self.plan,self.pin)
    def test_incomplete_or_published_summary_refuses(self):
        for key,value in [('ok',False),('published',True),('indexedThroughBlock',True),('indexedThroughBlock',973283),
                ('indexedThroughBlockHash',''),('snapshotId',''),('summaryKeys',['workSummary'])]:
            q=copy.deepcopy(self.value);q['result'][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):C.validate_rehearsal(q,self.plan,self.pin)
    def test_overlay_requires_bound_evidence_before_process_creation(self):
        release=load(HERE/'release.py','recovery_release_gate')
        with tempfile.TemporaryDirectory()as tmp:
            args=types.SimpleNamespace(plan=Path(tmp)/'plan',receipt=Path(tmp)/'receipt',
                rehearsal=Path(tmp)/'qualification',rehearsal_sha256='0'*64)
            p=copy.deepcopy(self.plan);p.update(format='proof-of-work-work-batch-reader-recovery-rollout-plan-v1',
                rolloutSupervisorSha256=C.sha((HERE/'rollout-node.py').read_bytes()),
                controllerSha256=C.sha((HERE/'scoped-node.py').read_bytes()))
            args.plan.write_bytes(encoded(p));args.plan.chmod(0o600)
            with patch.object(release,'node_context'),patch.object(release,'private_output'),\
                    patch.object(release,'controller',return_value=C),\
                    patch.object(C,'evidence_reference',side_effect=ValueError('evidence changed')),\
                    patch.object(release.subprocess,'Popen')as dispatch:
                with self.assertRaisesRegex(ValueError,'evidence changed'):release.overlay(args)
                dispatch.assert_not_called()

if __name__=='__main__':unittest.main()
