#!/usr/bin/env python3
"""Offline exact-patch, dispatch, and uncertainty fixtures; no live operations."""
import base64, contextlib, copy, importlib.util, io, json, os, subprocess, tempfile, types, unittest
from pathlib import Path
from unittest.mock import Mock, patch
ROOT=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/(name+'.py'))
    ns=importlib.util.module_from_spec(spec);spec.loader.exec_module(ns);return ns
R,S=load('release'),load('rollout-node')
FAKE_CONTROLLER=b'''from pathlib import Path
import hashlib
ROOT=Path('/unused-offline-runtime');HOLD=Path('/unused-offline-hold');SEARCH=('search.service','search.timer')
def validate_manifest(m):return {}
def fence(*a):pass
def source_identity_fence(*a):pass
def metadata_fence(*a):pass
def batch_authority():return {}
def capture_api_environment():pass
def require_restart_configuration(*a):pass
def validate_rehearsal(*a):pass
def safe_read(path,limit):return b'{}' if str(path).endswith('qualification') else b'exact-held-marker'
def sha(raw):return hashlib.sha256(raw).hexdigest()
'''
def plan_fixture():
    return {'format':'proof-of-work-work-batch-pending-summary-fix-rollout-plan-v1',
        'releaseId':'a'*12+'-20261028T000000Z','sourceCommit':'a'*40,
        'controllerBase64':base64.b64encode(FAKE_CONTROLLER).decode(),'controllerSha256':R.sha(FAKE_CONTROLLER),
        'searchHoldControllerBase64':base64.b64encode(b'# fixed hold controller').decode(),'searchHoldControllerSha256':R.sha(b'# fixed hold controller'),
        'rehearsalHelperSha256':'c'*64,'runtimeManifestTemplate':{'batchAuthority':{},'sourceCommit':'a'*40,
            'releaseId':'a'*12+'-20261028T000000Z','sourceMetadata':{},'restartConfigurationSha256':'a'*64,
            'searchHold':{'markerSha256':'0'*64,'bindings':{'files':{'search.service':'1'*64,'search.timer':'2'*64}}}}}
def envelope(plan=None):
    raw=R.encoded(plan or plan_fixture())
    return {'format':'work-batch-pending-summary-dispatch-request-v1','planBase64':base64.b64encode(raw).decode(),
        'planSha256':R.sha(raw),'rehearsal':{'path':'/tmp/offline-qualification','sha256':R.sha(b'{}')}}
class RolloutTests(unittest.TestCase):
    def run_it(self,value,outcomes):
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=outcomes) as calls,contextlib.redirect_stdout(io.StringIO()):
            result=S.rollout(value)
        return result,calls
    def test_success_restores_search_and_binds_rehearsal_to_inner(self):
        e=envelope();result,calls=self.run_it(e,[{'held':True},{'installed':True},{'restored':True}])
        self.assertEqual(calls.call_count,3);self.assertTrue(result['searchRestore']['restored'])
        m=json.loads(calls.call_args_list[1].kwargs['payload'])
        self.assertEqual(m['rehearsal'],{**e['rehearsal'],'planSha256':e['planSha256'],'helperSha256':'c'*64})
        self.assertEqual(m['searchHold']['markerSha256'],R.sha(b'exact-held-marker'))
    def test_bad_plan_or_qualification_refuses_before_hold(self):
        cases=[]
        e=envelope();e['planSha256']='f'*64;cases.append(e)
        e=envelope();e['rehearsal']['sha256']='f'*64;cases.append(e)
        p=plan_fixture();p['sourceCommit']='b'*40;cases.append(envelope(p))
        p=plan_fixture();p['controllerSha256']='f'*64;cases.append(envelope(p))
        for value in cases:
            with self.subTest(value=value),patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke') as call:
                with self.assertRaises(ValueError):S.rollout(value)
                call.assert_not_called()
    def test_rehearsal_predicate_refusal_precedes_hold(self):
        p=plan_fixture();code=FAKE_CONTROLLER.replace(b'def validate_rehearsal(*a):pass',b'def validate_rehearsal(*a):raise ValueError("no accounting qualification")')
        p.update(controllerBase64=base64.b64encode(code).decode(),controllerSha256=R.sha(code))
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke') as call:
            with self.assertRaisesRegex(ValueError,'accounting'):S.rollout(envelope(p))
            call.assert_not_called()
    def test_verified_prewrite_rollback_restores_search_without_success(self):
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=[{'held':True},ValueError('verified rollback refusal'),{'restored':True}]) as call,contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'verified rollback'):S.rollout(envelope())
        self.assertEqual(call.call_count,3)
    def test_uncertain_controller_keeps_search_held(self):
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=[{'held':True},S.ControllerStillRunning('uncertain')]) as call,contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(S.ControllerStillRunning):S.rollout(envelope())
        self.assertEqual(call.call_count,2);self.assertIn('searchRestoreDeferred',json.loads(output.getvalue()))
    def test_child_timeout_waits_grace_without_kill(self):
        child=Mock();child.poll.return_value=None
        child.communicate.side_effect=[subprocess.TimeoutExpired('child',4800),subprocess.TimeoutExpired('child',600)]
        with patch.object(S.subprocess,'Popen',return_value=child):
            with self.assertRaises(S.ControllerStillRunning):S.invoke(b'# controller',require_recovery_receipt=True)
        self.assertEqual(child.communicate.call_args_list[0].kwargs['timeout'],4800)
        child.send_signal.assert_called_once_with(S.signal.SIGINT);child.kill.assert_not_called()
    def test_malformed_or_incomplete_child_keeps_hold(self):
        for out,status in [(b'garbage',0),(b'{}',0),(b'[]',0),(b'{"installed":true}',1),(b'{"recoveryIncomplete":true}',1)]:
            child=Mock();child.communicate.return_value=(out,b'');child.returncode=status
            with patch.object(S.subprocess,'Popen',return_value=child):
                with self.assertRaises(S.ControllerStillRunning):S.invoke(b'# controller',require_recovery_receipt=True)
    def test_verified_timeout_rollback_still_restores_search(self):
        holder=Mock();holder.communicate.return_value=(b'{"held":true}',b'');holder.returncode=0
        child=Mock();child.poll.return_value=None;child.returncode=1
        child.communicate.side_effect=[subprocess.TimeoutExpired('child',4800),(b'{"rolledBack":true}',b'')]
        restore=Mock();restore.communicate.return_value=(b'{"restored":true}',b'');restore.returncode=0
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S.subprocess,'Popen',side_effect=[holder,child,restore]) as launch,contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(subprocess.TimeoutExpired):S.rollout(envelope())
        self.assertEqual(launch.call_count,3);self.assertTrue(json.loads(output.getvalue())['searchRestore']['restored'])
        self.assertEqual(child.communicate.call_args_list[1].kwargs['timeout'],600)

    def test_deadline_nesting_matches_recovery_policy(self):
        self.assertEqual(R.controller().POSTFLIGHT_TIMEOUT_SECONDS,3600)
        self.assertEqual((S.CONTROLLER_TIMEOUT_SECONDS,S.SEARCH_TIMEOUT_SECONDS,S.CONTROLLER_RECOVERY_GRACE_SECONDS),(4800,1200,600))
        self.assertEqual((R.ROLLOUT_TIMEOUT_SECONDS,R.ROLLOUT_RECOVERY_GRACE_SECONDS),(9000,900))
        hold=S.SEARCH_TIMEOUT_SECONDS;child=S.CONTROLLER_TIMEOUT_SECONDS;grace=S.CONTROLLER_RECOVERY_GRACE_SECONDS
        paths={'success':hold+child+S.SEARCH_TIMEOUT_SECONDS,
            'child_uncertain_keeps_hold':hold+child+grace,
            'restore_timeout':hold+child+S.SEARCH_TIMEOUT_SECONDS+grace,
            'verified_child_rollback_then_restore_timeout':hold+child+grace+S.SEARCH_TIMEOUT_SECONDS+grace}
        self.assertEqual(max(paths.values()),8400)
        self.assertGreaterEqual(R.ROLLOUT_TIMEOUT_SECONDS-max(paths.values()),600)
        self.assertLess(R.ROLLOUT_TIMEOUT_SECONDS+R.ROLLOUT_RECOVERY_GRACE_SECONDS,10800)

class PatchAndPlanTests(unittest.TestCase):
    def setUp(self):
        f=load('check-scoped-node.test');self.fixture=f.ControllerTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups);self.C=f.module
        self.root=self.fixture.root
        for name,value in [('node_context',Mock()),('controller',Mock(return_value=self.C)),('private_output',Mock())]:
            p=patch.object(R,name,value);p.start();self.addCleanup(p.stop)
    def inputs(self):
        repo=ROOT.parents[1];commit='a'*40;name='server/proof-api.mjs';public_before=self.fixture.before.replace(b'accepted runtime',b'public repository');public_after=self.fixture.after.replace(b'accepted runtime',b'public repository')
        sources={str(p.relative_to(self.root)):{'sha256':R.sha(p.read_bytes()),'base64':base64.b64encode(p.read_bytes()).decode(),'uid':p.stat().st_uid,'gid':p.stat().st_gid,'mode':p.stat().st_mode&0o777} for p in self.root.rglob('*') if p.is_file()}
        m=self.fixture.manifest
        snapshot={'format':'proof-of-work-work-batch-pending-summary-fix-runtime-capture-v1','root':str(self.C.ROOT),
            'controllerSha256':R.sha((ROOT/'scoped-node.py').read_bytes()),'sources':sources,'nodePath':__import__('shutil').which('node'),
            'searchFiles':m['searchHold']['bindings']['files'],**{k:m[k] for k in ('sourceIdentities','sourceParents','batchAuthority','acceptedInventorySha256','restartConfigurationSha256','baselineHead','nodeSha256','gateway','protectedServices')}}
        capture=self.root.parent/'capture.json';capture.write_bytes(R.encoded(snapshot));capture.chmod(0o600)
        args=types.SimpleNamespace(repository=repo,commit=commit,base_commit=self.C.BASE_SOURCE_COMMIT,capture=capture,output=self.root.parent/'plan',release_id='a'*12+'-20261028T010000Z')
        def git(repo,*argv):
            if argv==('rev-parse','HEAD'):return commit.encode()
            if argv==('rev-parse','HEAD^{tree}'):return b'c'*40
            if argv==('rev-parse',self.C.PATCH_COMMIT+'^'):return self.C.PATCH_BASE_COMMIT.encode()
            if argv[0] in ('status','merge-base','ls-tree'):return b''
            if argv[0]=='show':
                rev,path=argv[1].split(':',1)
                if path==name:return public_before if rev==self.C.PATCH_BASE_COMMIT else public_after
                return (repo/path).read_bytes()
            raise AssertionError(argv)
        return args,git,snapshot
    def test_exact_patch_forward_inverse_preserves_all_other_bytes(self):
        self.assertEqual(self.C.transform_patch(self.fixture.before,True),self.fixture.after)
        self.assertEqual(self.C.transform_patch(self.fixture.after,False),self.fixture.before)
        for raw in (self.fixture.after+b'// unrelated change',self.fixture.after.replace(b'confirmed === false',b'confirmed !== true',1)):
            with self.assertRaises(ValueError):self.C.validate_candidate_patch(raw,self.C.ACCEPTED_API_SHA256)
        with self.assertRaises(ValueError):self.C.validate_candidate_patch(self.fixture.after,'f'*64)
    def test_public_patch_refuses_any_unrelated_change(self):
        R.verify_public_patch(self.C,self.fixture.before,self.fixture.after)
        with self.assertRaisesRegex(ValueError,'unrelated'):R.verify_public_patch(self.C,self.fixture.before,self.fixture.after+b'// Mail import')
    def test_plan_preserves_complete_overlay_closure_and_one_api_candidate(self):
        args,git,snapshot=self.inputs()
        with patch.object(R,'git',side_effect=git),contextlib.redirect_stdout(io.StringIO()):R.plan(args)
        p=json.loads((args.output/'plan.json').read_bytes());m=p['runtimeManifestTemplate']
        self.assertEqual(m['dependencies'],{n:r['sha256'] for n,r in snapshot['sources'].items()})
        self.assertEqual([r['path'] for r in m['sources']],['server/proof-api.mjs'])
        self.assertEqual((args.output/'candidate/server/proof-api.mjs').read_bytes(),self.fixture.after)
        self.assertEqual(m['sourceTree'],'c'*40);self.assertEqual(m['patchProvenance'],self.C.patch_provenance(self.C.EXPECTED_CANDIDATE_SHA256))
        self.assertTrue(p['reviews'][0]['wholeCandidateInverseVerified']);self.assertFalse(p['productionMutation'])
        self.assertEqual(p['rehearsalHelperSha256'],R.sha((ROOT/'rehearsal.py').read_bytes()))
    def test_other_base_or_tool_refuses_before_planning(self):
        args,git,_=self.inputs();args.base_commit='f'*40
        with patch.object(R,'git',side_effect=git):
            with self.assertRaisesRegex(ValueError,'approved base'):R.plan(args)
        self.assertFalse(args.output.exists())
    def test_wrong_capture_controller_refuses(self):
        args,git,snapshot=self.inputs();snapshot['controllerSha256']='f'*64;args.capture.write_bytes(R.encoded(snapshot))
        with patch.object(R,'git',side_effect=git):
            with self.assertRaisesRegex(ValueError,'another controller'):R.plan(args)
        self.assertFalse(args.output.exists())

class DispatchTests(unittest.TestCase):
    def setup_dispatch(self,root):
        p=plan_fixture();p.update(rolloutSupervisorSha256=R.sha((ROOT/'rollout-node.py').read_bytes()),releaseToolSha256=R.sha((ROOT/'release.py').read_bytes()),rehearsalHelperSha256=R.sha((ROOT/'rehearsal.py').read_bytes()))
        file=root/'plan';file.write_bytes(R.encoded(p));file.chmod(0o600);q=root/'qualification';q.write_bytes(b'{}');q.chmod(0o600)
        return types.SimpleNamespace(plan=file,receipt=root/'receipt',phase='overlay',rehearsal=q,rehearsal_sha256=R.sha(b'{}'))
    def test_parent_timeout_records_uncertainty_and_never_kills(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.setup_dispatch(Path(d));ns=R.controller();child=Mock();child.poll.return_value=None
            child.communicate.side_effect=[subprocess.TimeoutExpired('child',9000),(b'held',b'incomplete')]
            with patch.object(R,'node_context'),patch.object(R,'private_output'),patch.object(R,'controller',return_value=ns),patch.object(ns,'validate_manifest'),patch.object(ns,'validate_rehearsal'),patch.object(R.subprocess,'Popen',return_value=child):
                with self.assertRaisesRegex(ValueError,'uncertain'):R.overlay(args)
            receipt=json.loads(args.receipt.read_bytes());self.assertIsNone(receipt['exitCode']);self.assertEqual(receipt['rehearsal']['sha256'],R.sha(b'{}'));child.kill.assert_not_called()
    def test_bad_qualification_never_dispatches_or_writes_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            args=self.setup_dispatch(Path(d));ns=R.controller()
            with patch.object(R,'node_context'),patch.object(R,'private_output'),patch.object(R,'controller',return_value=ns),patch.object(ns,'validate_manifest'),patch.object(ns,'validate_rehearsal',side_effect=ValueError('accounting failed')),patch.object(R.subprocess,'Popen') as child:
                with self.assertRaisesRegex(ValueError,'accounting'):R.overlay(args)
                child.assert_not_called();self.assertFalse(args.receipt.exists())
    def test_exclusive_evidence_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'receipt';R.save(p,b'original')
            with self.assertRaises(FileExistsError):R.save(p,b'changed')
            self.assertEqual(p.read_bytes(),b'original')
    def test_local_capture_or_dispatch_is_rejected(self):
        with patch.object(R.os,'geteuid',return_value=1000):
            with self.assertRaisesRegex(ValueError,'node VPS'):R.node_context()
if __name__=='__main__':unittest.main()
