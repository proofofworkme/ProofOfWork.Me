#!/usr/bin/env python3
"""Offline release refusal and cleanup tests; no SSH or production actions."""
import base64, contextlib, copy, hashlib, importlib.util, io, json, os, tempfile, types, unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/(name+'.py'))
    ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns); return ns
R, S = module('release'), module('rollout-node')

FAKE_CONTROLLER = b'''from pathlib import Path
import hashlib
ROOT=Path('/unused-offline-runtime')
HOLD=Path('/unused-offline-hold')
SEARCH=('search.service','search.timer')
def validate_manifest(m): return {}
def fence(root,m,c): pass
def metadata_fence(root,m): pass
def safe_read(path,limit): return b'exact-held-marker'
def sha(raw): return hashlib.sha256(raw).hexdigest()
'''

class RolloutTests(unittest.TestCase):
    def plan(self):
        code, holder = FAKE_CONTROLLER, b'# reviewed hold controller'
        return {'format':'proof-of-work-audit32-first-batch-rollout-plan-v1','releaseId':'a'*12+'-20261007T010000Z','sourceCommit':'a'*40,
            'controllerBase64':base64.b64encode(code).decode(),'controllerSha256':R.sha(code),
            'searchHoldControllerBase64':base64.b64encode(holder).decode(),'searchHoldControllerSha256':R.sha(holder),
            'runtimeManifestTemplate':{'sourceCommit':'a'*40,'releaseId':'a'*12+'-20261007T010000Z',
                'sourceMetadata':{},
                'searchHold':{'markerSha256':'0'*64,'bindings':{'files':{'search.service':'1'*64,'search.timer':'2'*64}}}}}
    def run_rollout(self, outcomes):
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=outcomes) as calls,contextlib.redirect_stdout(io.StringIO()):
            result=S.rollout(self.plan())
        return result,calls
    def test_success_restores_search_after_exact_overlay(self):
        result,calls=self.run_rollout([{'held':True},{'installed':True},{'restored':True}])
        self.assertEqual(calls.call_count,3)
        self.assertIn('hold',calls.call_args_list[0].args[1])
        self.assertIn('restore',calls.call_args_list[2].args[1])
        manifest=json.loads(calls.call_args_list[1].kwargs['payload'])
        self.assertEqual(manifest['searchHold']['markerSha256'],R.sha(b'exact-held-marker'))
        self.assertTrue(result['overlay']['installed'] and result['searchRestore']['restored'])
    def test_overlay_failure_still_restores_search_and_never_returns_success(self):
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=[{'held':True},ValueError('injected install refusal'),{'restored':True}]) as calls,contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError,'install refusal'):S.rollout(self.plan())
        self.assertEqual(calls.call_count,3);self.assertIn('restore',calls.call_args_list[2].args[1])
    def test_unfinished_controller_rollback_retains_search_hold(self):
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke',side_effect=[{'held':True},S.ControllerStillRunning('injected unfinished rollback')]) as calls,contextlib.redirect_stdout(io.StringIO()) as printed:
            with self.assertRaises(S.ControllerStillRunning):S.rollout(self.plan())
        self.assertEqual(calls.call_count,2)
        evidence=json.loads(printed.getvalue());self.assertIn('searchRestoreDeferred',evidence)
        self.assertNotIn('searchRestore',evidence)
    def test_interrupted_controller_is_signaled_and_waited_without_killing_rollback(self):
        child=Mock();child.poll.return_value=None
        child.communicate.side_effect=[S.subprocess.TimeoutExpired('controller',360),S.subprocess.TimeoutExpired('controller',600)]
        with patch.object(S.subprocess,'Popen',return_value=child):
            with self.assertRaises(S.ControllerStillRunning):S.invoke(b'# fixed controller')
        child.send_signal.assert_called_once_with(S.signal.SIGINT)
        child.kill.assert_not_called()
    def test_nonzero_controller_requires_verified_rollback_receipt(self):
        for evidence in (b'',b'{"recoveryIncomplete":true}',b'{"installed":true}'):
            child=Mock();child.communicate.return_value=(evidence,b'refused');child.returncode=1
            with patch.object(S.subprocess,'Popen',return_value=child):
                with self.assertRaisesRegex(S.ControllerStillRunning,'recovery is unverified'):
                    S.invoke(b'# fixed controller',require_recovery_receipt=True)
        child=Mock();child.communicate.return_value=(b'{"rolledBack":true}',b'install refused');child.returncode=1
        with patch.object(S.subprocess,'Popen',return_value=child):
            with self.assertRaisesRegex(ValueError,'Controller refused'):
                S.invoke(b'# fixed controller',require_recovery_receipt=True)
    def test_bad_controller_hash_refuses_before_hold(self):
        value=self.plan();value['controllerSha256']='f'*64
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke') as invoke:
            with self.assertRaisesRegex(ValueError,'Changed controller'):S.rollout(value)
            invoke.assert_not_called()
    def test_changed_commit_refuses_before_hold(self):
        value=self.plan();value['sourceCommit']='b'*40
        with patch.object(S.os,'geteuid',return_value=0),patch.object(S,'invoke') as invoke:
            with self.assertRaisesRegex(ValueError,'provenance'):S.rollout(value)
            invoke.assert_not_called()

class LocalPlanTests(unittest.TestCase):
    def test_pages_capture_is_not_reusable_for_audit32_first_batch_plan(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);capture=root/'capture.json'
            capture.write_text(json.dumps({'format':'proof-of-work-pages-runtime-capture-v1'}))
            args=types.SimpleNamespace(repository=root,commit='a'*40,base_commit=R.controller().BASE_SOURCE_COMMIT,
                output=root/'new',capture=capture,release_id='a'*12+'-20261008T010000Z')
            def git(repo,*argv):
                return b'a'*40 if argv==('rev-parse','HEAD') else b''
            with patch.object(R,'git',side_effect=git):
                with self.assertRaisesRegex(ValueError,'Wrong runtime capture'):R.plan(args)
            self.assertFalse(args.output.exists())

    def test_changed_controller_capture_refuses_before_plan_directory(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);capture=root/'capture.json'
            capture.write_text(json.dumps({'format':'proof-of-work-audit32-first-batch-runtime-capture-v1',
                'root':str(R.controller().ROOT),'controllerSha256':'f'*64}))
            args=types.SimpleNamespace(repository=root,commit='a'*40,base_commit=R.controller().BASE_SOURCE_COMMIT,
                output=root/'new',capture=capture,release_id='a'*12+'-20261008T010000Z')
            def git(repo,*argv):
                return b'a'*40 if argv==('rev-parse','HEAD') else b''
            with patch.object(R,'git',side_effect=git):
                with self.assertRaisesRegex(ValueError,'another controller'):R.plan(args)
            self.assertFalse(args.output.exists())

    def test_conflicting_merge_refuses_without_explicit_review(self):
        with self.assertRaisesRegex(ValueError, 'explicit review'):
            R.selected_merge('server/proof-api.mjs', b'conflict', True, b'active', b'base', b'candidate', {})
        result, evidence = R.selected_merge('server/proof-api.mjs', b'clean additive merge', False,
            b'active', b'base', b'candidate', {})
        self.assertEqual(result, b'clean additive merge'); self.assertIsNone(evidence)
    def test_reviewed_merge_pins_active_base_and_repository_candidate(self):
        name='server/db/proof-index-reader.mjs'
        row={'activeSha256':R.sha(b'accepted Audit31 source'), 'baseSha256':R.sha(b'repository base'),
            'repositoryCandidateSha256':R.sha(b'Audit32 first batch candidate'), 'mergedBytes':b'accepted Audit31 source + Audit32 first batch',
            'reason':'Preserve reviewed native transition accessor'}
        result, evidence=R.selected_merge(name,b'conflict',True,b'accepted Audit31 source',b'repository base',b'Audit32 first batch candidate',{name:row})
        self.assertEqual(result,row['mergedBytes']);self.assertNotIn('mergedBytes',evidence)
        for active,base,candidate in [(b'drift',b'repository base',b'Audit32 first batch candidate'),
                (b'accepted Audit31 source',b'drift',b'Audit32 first batch candidate'),
                (b'accepted Audit31 source',b'repository base',b'drift')]:
            with self.assertRaisesRegex(ValueError,'identity differs'):
                R.selected_merge(name,b'conflict',True,active,base,candidate,{name:row})
    def test_reviewed_merge_manifest_refuses_wrong_paths_hashes_and_markers(self):
        ns=R.controller()
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);source=root/'reviewed.mjs';source.write_bytes(b'export {};\n');source.chmod(0o600)
            row={'path':'server/db/proof-index-reader.mjs','activeSha256':'a'*64,'baseSha256':'b'*64,
                'repositoryCandidateSha256':'c'*64,'mergedPath':str(source),'mergedSha256':R.sha(source.read_bytes()),
                'reason':'Reviewed exact additive import conflict'}
            manifest=root/'review.json'
            def load(value):
                manifest.write_text(json.dumps({'format':'proof-of-work-audit32-first-batch-reviewed-merges-v1','sources':[value]}));manifest.chmod(0o600)
                return R.reviewed_merges(manifest,ns)
            self.assertEqual(load(row)[row['path']]['mergedBytes'],source.read_bytes())
            for key,value,reason in [('path','server/proof-api.mjs','allowlist'),
                    ('mergedSha256','f'*64,'bytes differ'),('reason','','review reason')]:
                changed=copy.deepcopy(row);changed[key]=value
                with self.assertRaisesRegex(ValueError,reason):load(changed)
            source.write_bytes(b'<<<<<<< unresolved\n');row['mergedSha256']=R.sha(source.read_bytes())
            with self.assertRaisesRegex(ValueError,'conflict markers'):load(row)
            alias=root/'alias.json';alias.symlink_to(manifest)
            with self.assertRaisesRegex(ValueError,'Unsafe source'):R.reviewed_merges(alias,ns)
    def test_candidate_commit_refuses_before_any_capture_or_output_write(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            args=types.SimpleNamespace(repository=Path(name),commit='a'*40,output=Path(name)/'new')
            with patch.object(R,'git',return_value=b'b'*40):
                with self.assertRaisesRegex(ValueError,'exact committed'):R.plan(args)
            self.assertFalse(args.output.exists())
    def test_dispatch_tool_hash_refusal_never_calls_ssh_or_claims_verified(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);plan=root/'plan';plan.write_text(json.dumps({'format':'proof-of-work-audit32-first-batch-rollout-plan-v1','rolloutSupervisorSha256':'f'*64}))
            args=types.SimpleNamespace(plan=plan,receipt=root/'receipt',phase='overlay')
            with patch.object(R.subprocess,'run') as run:
                with self.assertRaisesRegex(ValueError,'supervisor differs'):R.overlay(args)
                run.assert_not_called()
            self.assertFalse(args.receipt.exists())
    def test_remote_overlay_refusal_preserves_receipt_and_never_reports_verified(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);plan=root/'plan';plan.write_text(json.dumps({'format':'proof-of-work-audit32-first-batch-rollout-plan-v1','releaseId':'example',
                'rolloutSupervisorSha256':R.sha((ROOT/'rollout-node.py').read_bytes())}))
            args=types.SimpleNamespace(plan=plan,receipt=root/'receipt',phase='overlay')
            result=types.SimpleNamespace(returncode=1,stdout=b'',stderr=b'overlay incomplete')
            with patch.object(R.subprocess,'run',return_value=result),contextlib.redirect_stdout(io.StringIO()) as printed:
                with self.assertRaisesRegex(ValueError,'rollout refused'):R.overlay(args)
            self.assertEqual(printed.getvalue(),'');self.assertEqual(json.loads(args.receipt.read_text())['exitCode'],1)
    def test_remote_timeout_preserves_uncertain_receipt_without_claiming_installed(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);plan=root/'plan';plan.write_text(json.dumps({'format':'proof-of-work-audit32-first-batch-rollout-plan-v1','releaseId':'example',
                'rolloutSupervisorSha256':R.sha((ROOT/'rollout-node.py').read_bytes())}))
            args=types.SimpleNamespace(plan=plan,receipt=root/'receipt',phase='overlay')
            timeout=R.subprocess.TimeoutExpired('ssh',1200,output=b'{"hold":"retained"}',stderr=b'controller interrupted')
            with patch.object(R.subprocess,'run',side_effect=timeout),contextlib.redirect_stdout(io.StringIO()) as printed:
                with self.assertRaisesRegex(ValueError,'state is uncertain'):R.overlay(args)
            receipt=json.loads(args.receipt.read_text())
            self.assertEqual(printed.getvalue(),'');self.assertIsNone(receipt['exitCode'])
            self.assertEqual(receipt['dispatchStatus'],'uncertain-timeout');self.assertEqual(receipt['phase'],'overlay')
            self.assertEqual(receipt['stdout'],'{"hold":"retained"}');self.assertEqual(receipt['stderr'],'controller interrupted')
            self.assertNotIn('installed',receipt)
    def test_creation_only_evidence_refuses_overwrite_and_symlink(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            path=Path(name)/'receipt';R.save(path,b'original')
            with self.assertRaises(FileExistsError):R.save(path,b'changed')
            self.assertEqual(path.read_bytes(),b'original')
            alias=Path(name)/'alias';alias.symlink_to(path)
            with self.assertRaises(ValueError):R.private_output(alias)

class ComposedPlanTests(unittest.TestCase):
    def setUp(self):
        fixture_module=module('check-scoped-node.test')
        self.fixture=fixture_module.ControllerTests();self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups);self.C=fixture_module.module
        self.root=self.fixture.root

    def fixture_plan(self):
        repository=ROOT.parents[1];commit='a'*40;base=self.C.BASE_SOURCE_COMMIT
        sources={str(file.relative_to(self.root)):{'sha256':R.sha(file.read_bytes()),
            'base64':base64.b64encode(file.read_bytes()).decode(),'uid':file.stat().st_uid,
            'gid':file.stat().st_gid,'mode':file.stat().st_mode&0o777}
            for file in self.root.rglob('*') if file.is_file()}
        base_reader=b'// original source\nexport const visible = false;\n\n// untouched tail\n'
        active_reader=b'// accepted native storage overlay\n'+base_reader
        candidate_reader=base_reader.replace(b'visible = false',b'visible = true')
        name='server/db/proof-index-reader.mjs';sources[name].update(
            sha256=R.sha(active_reader),base64=base64.b64encode(active_reader).decode())
        candidates={name:candidate_reader,'server/db/postgres.mjs':b'// approved pool listener\nexport {};\n',
            'scripts/backfill-proof-indexer.mjs':b'// approved Log fingerprint membership\nexport {};\n'}
        snapshot={'format':'proof-of-work-audit32-first-batch-runtime-capture-v1',
            'root':str(self.C.ROOT),'controllerSha256':R.sha((ROOT/'scoped-node.py').read_bytes()),
            'sources':sources,'baselineHead':self.fixture.manifest['baselineHead'],
            'nodeSha256':self.fixture.manifest['nodeSha256'],'nodePath':'/opt/node-fixture/bin/node',
            'gateway':self.fixture.manifest['gateway'],'protectedServices':self.fixture.manifest['protectedServices'],
            'searchFiles':self.fixture.manifest['searchHold']['bindings']['files']}
        capture=self.root.parent/'capture.json';capture.write_text(json.dumps(snapshot))
        args=types.SimpleNamespace(repository=repository,commit=commit,base_commit=base,
            capture=capture,output=self.root.parent/'plan',release_id='a'*12+'-20261009T010000Z')
        def git(repo,*argv):
            if argv==('rev-parse','HEAD'):return commit.encode()
            if argv[0] in ('status','merge-base'):return b''
            if argv[0]=='show':
                revision,path=argv[1].split(':',1)
                if path==name:return candidate_reader if revision==commit else base_reader
                if path in candidates:return candidates[path] if revision==commit else base64.b64decode(sources[path]['base64'])
                return (repository/path).read_bytes()
            raise AssertionError(argv)
        return args,git,snapshot

    def test_planner_composes_delta_preserves_overlay_and_all_pins(self):
        args,git,captured=self.fixture_plan()
        with patch.object(R,'git',side_effect=git),contextlib.redirect_stdout(io.StringIO()):R.plan(args)
        plan=json.loads((args.output/'plan.json').read_bytes());manifest=plan['runtimeManifestTemplate']
        self.assertEqual({row['path'] for row in manifest['sources']},self.C.ALLOWED)
        self.assertEqual(manifest['baseSourceCommit'],self.C.BASE_SOURCE_COMMIT)
        self.assertEqual(manifest['dependencies'],{name:row['sha256'] for name,row in captured['sources'].items()})
        merged=(args.output/'candidate/server/db/proof-index-reader.mjs').read_bytes()
        self.assertIn(b'accepted native storage overlay',merged);self.assertIn(b'visible = true',merged)
        self.assertTrue(all(row['cleanThreeWayMerge'] for row in plan['reviews']))
        self.C.fence(args.output/'captured-runtime',manifest,self.C.validate_manifest(manifest))
        self.assertEqual(set(manifest['protectedServices']['files']),set(self.C.UNITS))
        self.assertFalse(plan['productionMutation'])

    def test_planner_rejects_another_base_before_allocating(self):
        args,git,_=self.fixture_plan();args.base_commit='b'*40
        with patch.object(R,'git',side_effect=git):
            with self.assertRaisesRegex(ValueError,'approved base'):R.plan(args)
        self.assertFalse(args.output.exists())

if __name__ == '__main__':unittest.main()
