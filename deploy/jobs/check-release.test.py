#!/usr/bin/env python3
"""Offline release refusal and cleanup tests; no SSH or production actions."""
import base64, contextlib, copy, hashlib, importlib.util, io, json, os, tempfile, types, unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-','_'),ROOT/(name+'.py'))
    ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns); return ns
R, S, B = module('release'), module('rollout-node'), module('bootstrap-node')

FAKE_CONTROLLER = b'''from pathlib import Path
import hashlib
ROOT=Path('/unused-offline-runtime')
HOLD=Path('/unused-offline-hold')
SEARCH=('search.service','search.timer')
def validate_manifest(m): return {}
def fence(root,m,c): pass
def safe_read(path,limit): return b'exact-held-marker'
def sha(raw): return hashlib.sha256(raw).hexdigest()
'''

class RolloutTests(unittest.TestCase):
    def plan(self):
        code, holder = FAKE_CONTROLLER, b'# reviewed hold controller'
        return {'format':'proof-of-work-jobs-rollout-plan-v1','releaseId':'a'*12+'-20261007T010000Z','sourceCommit':'a'*40,
            'controllerBase64':base64.b64encode(code).decode(),'controllerSha256':R.sha(code),
            'searchHoldControllerBase64':base64.b64encode(holder).decode(),'searchHoldControllerSha256':R.sha(holder),
            'runtimeManifestTemplate':{'sourceCommit':'a'*40,'releaseId':'a'*12+'-20261007T010000Z',
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
    def test_completed_interruption_still_requires_verified_recovery_before_search_restore(self):
        for evidence in (b'',b'{"rolledBack":false}',b'{"recoveryIncomplete":true}',b'[]'):
            child=Mock();child.poll.return_value=None;child.returncode=1
            child.communicate.side_effect=[InterruptedError('dispatch interrupted'),(evidence,b'failure')]
            with patch.object(S.subprocess,'Popen',return_value=child):
                with self.assertRaisesRegex(S.ControllerStillRunning,'recovery is unverified'):
                    S.invoke(b'# fixed controller',require_recovery_receipt=True)
        child=Mock();child.poll.return_value=None;child.returncode=1
        child.communicate.side_effect=[InterruptedError('dispatch interrupted'),(b'{"rolledBack":true}',b'')]
        with patch.object(S.subprocess,'Popen',return_value=child):
            with self.assertRaisesRegex(InterruptedError,'dispatch interrupted'):
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
    def test_bootstrap_wrong_controller_never_executes_node(self):
        value=self.plan();value['controllerSha256']='f'*64
        with patch.object(B.os,'geteuid',return_value=0),patch.object(B.subprocess,'run') as run:
            with self.assertRaisesRegex(ValueError,'Controller changed'):B.bootstrap(value)
            run.assert_not_called()

class LocalPlanTests(unittest.TestCase):
    def test_helper_preservation_is_explicit_and_requires_exact_committed_bytes(self):
        ns=R.controller(); candidate=b'// exact existing Jobs helper\nexport {};\n'
        current={'sha256':R.sha(candidate),'base64':base64.b64encode(candidate).decode()}
        for name in sorted(ns.NEW):
            with self.subTest(helper=name):
                self.assertIsNone(R.helper_baseline(name,None,candidate,False))
                with self.assertRaisesRegex(ValueError,'already exists'):
                    R.helper_baseline(name,current,candidate,False)
                self.assertEqual(R.helper_baseline(name,current,candidate,True),current['sha256'])
                with self.assertRaisesRegex(ValueError,'Missing existing'):
                    R.helper_baseline(name,None,candidate,True)
                with self.assertRaisesRegex(ValueError,'differs from committed candidate'):
                    R.helper_baseline(name,current,b'// upgraded helper\nexport {};\n',True)
                changed=copy.deepcopy(current); changed['sha256']='f'*64
                with self.assertRaisesRegex(ValueError,'Captured source hash differs'):
                    R.helper_baseline(name,changed,candidate,True)

    def test_only_reviewed_additive_activation_import_conflict_can_be_resolved(self):
        raw=(b'<<<<<<< /tmp/review/indexer.active\n'
            b"import { assertNativeTransitionStorageContract } from '../server/db/native-transition-storage.mjs';\n"
            b'import { measurePrivatePhase } from "../server/wallet-read-observation.mjs";\n'
            b'||||||| /tmp/review/indexer.base\n'
            b'=======\n'
            b'import { JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../src/shared/protocol/jobs.mjs";\n'
            b'>>>>>>> /tmp/review/indexer.jobs\n'
            b"const acceptedRuntimeBody = 'unchanged';\n")
        result=R.resolve_jobs_activation_import_conflict(raw)
        self.assertEqual(result.count(b'import '),3)
        self.assertTrue(result.endswith(b"const acceptedRuntimeBody = 'unchanged';\n"))
        self.assertNotIn(b'<<<<<<<',result)
        with self.assertRaisesRegex(ValueError,'Unreviewed'):R.resolve_jobs_activation_import_conflict(raw.replace(b'measurePrivatePhase',b'unknownRuntimePatch'))
        with self.assertRaisesRegex(ValueError,'Additional'):R.resolve_jobs_activation_import_conflict(raw+b'<<<<<<< unrelated\n')
    def test_native_overlay_changes_only_jobs_closure_and_reuses_accepted_contract(self):
        old=b'''const untouched = 'accepted audit bytes';
async function storedJobsCandidateEventClosure(client, tx, position) {
  const [events, transition] = await Promise.all([
    client.query("SELECT block_height,block_hash,payload FROM proof_indexer.work_amo_block_transitions WHERE network=$1 AND block_height=$2 AND block_hash=$3"),
  ]);
}
async function bootstrapJobsCandidates(client) { return 'untouched'; }
'''
        active=b"import { assertNativeTransitionStorageContract } from '../server/db/native-transition-storage.mjs';\n// read_work_transition_payload_v1"
        result,adapted=R.native_jobs_overlay(old,active)
        self.assertTrue(adapted);self.assertIn(b'await assertNativeTransitionStorageContract(client);',result)
        self.assertIn(b'read_work_transition_payload_v1(network,block_height,block_hash,payload) AS payload',result)
        self.assertTrue(result.startswith(b"const untouched = 'accepted audit bytes';"))
        self.assertTrue(result.endswith(b"async function bootstrapJobsCandidates(client) { return 'untouched'; }\n"))
        repeated,preserved=R.native_jobs_overlay(result,active)
        self.assertEqual(repeated,result); self.assertTrue(preserved)
        broken=result.replace(b' AS payload',b' AS unrelated')
        with self.assertRaisesRegex(ValueError,'native transition query differs'):R.native_jobs_overlay(broken,active)
        with self.assertRaisesRegex(ValueError,'Unknown native'):R.native_jobs_overlay(old,b'// read_work_transition_payload_v1')
    def test_new_jobs_helpers_cannot_receive_reviewed_merge_override(self):
        ns=R.controller()
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);source=root/'resolution.mjs';source.write_bytes(b'export {};\n');source.chmod(0o600)
            for helper in ns.NEW:
                row={'path':helper,'activeSha256':'a'*64,'baseSha256':'b'*64,
                    'repositoryCandidateSha256':'c'*64,'mergedPath':str(source),
                    'mergedSha256':R.sha(source.read_bytes()),'reason':'Must remain creation-only'}
                manifest=root/'review.json';manifest.write_text(json.dumps({
                    'format':'proof-of-work-jobs-reviewed-merges-v1','sources':[row]}));manifest.chmod(0o600)
                with self.assertRaisesRegex(ValueError,'allowlist'):R.reviewed_merges(manifest,ns)

    def test_conflicting_merge_refuses_without_explicit_review(self):
        with self.assertRaisesRegex(ValueError, 'explicit review'):
            R.selected_merge('server/proof-api.mjs', b'conflict', True, b'active', b'base', b'candidate', {})
        result, evidence = R.selected_merge('server/proof-api.mjs', b'clean additive merge', False,
            b'active', b'base', b'candidate', {})
        self.assertEqual(result, b'clean additive merge'); self.assertIsNone(evidence)
    def test_reviewed_merge_pins_active_base_and_repository_candidate(self):
        name='server/db/proof-index-reader.mjs'
        row={'activeSha256':R.sha(b'accepted Audit31 source'), 'baseSha256':R.sha(b'repository base'),
            'repositoryCandidateSha256':R.sha(b'Jobs candidate'), 'mergedBytes':b'accepted Audit31 source + Jobs',
            'reason':'Preserve reviewed native transition accessor'}
        result, evidence=R.selected_merge(name,b'conflict',True,b'accepted Audit31 source',b'repository base',b'Jobs candidate',{name:row})
        self.assertEqual(result,row['mergedBytes']);self.assertNotIn('mergedBytes',evidence)
        for active,base,candidate in [(b'drift',b'repository base',b'Jobs candidate'),
                (b'accepted Audit31 source',b'drift',b'Jobs candidate'),
                (b'accepted Audit31 source',b'repository base',b'drift')]:
            with self.assertRaisesRegex(ValueError,'identity differs'):
                R.selected_merge(name,b'conflict',True,active,base,candidate,{name:row})
    def test_reviewed_merge_manifest_refuses_wrong_paths_hashes_and_markers(self):
        ns=R.controller()
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);source=root/'reviewed.mjs';source.write_bytes(b'export {};\n');source.chmod(0o600)
            row={'path':'server/proof-api.mjs','activeSha256':'a'*64,'baseSha256':'b'*64,
                'repositoryCandidateSha256':'c'*64,'mergedPath':str(source),'mergedSha256':R.sha(source.read_bytes()),
                'reason':'Reviewed exact additive import conflict'}
            manifest=root/'review.json'
            def load(value):
                manifest.write_text(json.dumps({'format':'proof-of-work-jobs-reviewed-merges-v1','sources':[value]}));manifest.chmod(0o600)
                return R.reviewed_merges(manifest,ns)
            self.assertEqual(load(row)[row['path']]['mergedBytes'],source.read_bytes())
            for key,value,reason in [('path','scripts/unrelated-worker.mjs','allowlist'),
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
            root=Path(name);plan=root/'plan';plan.write_text(json.dumps({'format':'proof-of-work-jobs-rollout-plan-v1','bootstrapSupervisorSha256':'f'*64}))
            args=types.SimpleNamespace(plan=plan,receipt=root/'receipt',phase='bootstrap')
            with patch.object(R.subprocess,'run') as run:
                with self.assertRaisesRegex(ValueError,'supervisor differs'):R.overlay(args)
                run.assert_not_called()
            self.assertFalse(args.receipt.exists())
    def test_remote_bootstrap_refusal_preserves_receipt_and_never_reports_verified(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);plan=root/'plan';plan.write_text(json.dumps({'format':'proof-of-work-jobs-rollout-plan-v1','releaseId':'example',
                'bootstrapSupervisorSha256':R.sha((ROOT/'bootstrap-node.py').read_bytes())}))
            args=types.SimpleNamespace(plan=plan,receipt=root/'receipt',phase='bootstrap')
            result=types.SimpleNamespace(returncode=1,stdout=b'',stderr=b'bootstrap incomplete')
            with patch.object(R.subprocess,'run',return_value=result),contextlib.redirect_stdout(io.StringIO()) as printed:
                with self.assertRaisesRegex(ValueError,'rollout refused'):R.overlay(args)
            self.assertEqual(printed.getvalue(),'');self.assertEqual(json.loads(args.receipt.read_text())['exitCode'],1)
    def test_remote_timeout_preserves_uncertain_receipt_without_claiming_installed(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);plan=root/'plan';plan.write_text(json.dumps({'format':'proof-of-work-jobs-rollout-plan-v1','releaseId':'example',
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

class RepeatDeploymentTests(unittest.TestCase):
    def setUp(self):
        # Reuse the actual scoped-controller filesystem fixture. No production
        # services or SSH are involved; helper preservation uses its real fence.
        fixture_module=module('check-scoped-node.test')
        self.fixture=fixture_module.ControllerTests(); self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups); self.C=fixture_module.module
        self.root=self.fixture.root; self.backup=self.fixture.backup
        self.manifest=copy.deepcopy(self.fixture.manifest)
        for index,row in enumerate(self.manifest['sources']):
            if row['path'] not in self.C.NEW: continue
            raw=base64.b64decode(row['base64']); file=self.root/row['path']
            file.write_bytes(raw); file.chmod(0o640)
            row['before']=row['after']
            (self.backup/f'before-{index}.mjs').write_bytes(raw)
            self.manifest['dependencies'][row['path']]=row['before']

    def plan_fixture(self, preserve=True, missing=None, changed=None):
        repo=ROOT.parents[1]; commit='a'*40; base_commit='b'*40
        sources={name:{'sha256':R.sha(file.read_bytes()),'base64':base64.b64encode(file.read_bytes()).decode()}
            for file in self.root.rglob('*') if file.is_file() for name in [str(file.relative_to(self.root))]}
        candidates={row['path']:base64.b64decode(row['base64']) for row in self.manifest['sources']}
        # Existing reader/API still pass through git merge-file with the prior
        # source base, rather than treating a repair as a helper replacement.
        candidates['server/proof-api.mjs'] += b'// approved Jobs API repair\n'
        if missing is not None: del sources[missing]
        if changed is not None:
            raw=b'// changed live helper\nexport {};\n'
            sources[changed]={'sha256':R.sha(raw),'base64':base64.b64encode(raw).decode()}
        snapshot={'format':'proof-of-work-jobs-runtime-capture-v1','root':str(self.C.ROOT),
            'controllerSha256':R.sha((ROOT/'scoped-node.py').read_bytes()),'sources':sources,
            'baselineHead':self.manifest['baselineHead'],'nodeSha256':self.manifest['nodeSha256'],
            'nodePath':'/opt/node-fixture/bin/node','gateway':self.manifest['gateway'],
            'workerUnitSha256':'c'*64,
            'protectedServices':self.manifest['protectedServices'],
            'searchFiles':self.manifest['searchHold']['bindings']['files']}
        capture=self.root.parent/'capture.json'; capture.write_text(json.dumps(snapshot))
        output=self.root.parent/'plan'
        args=types.SimpleNamespace(repository=repo,commit=commit,base_commit=base_commit,
            output=output,capture=capture,release_id='a'*12+'-20261008T010000Z',
            preserve_existing_helpers=preserve)
        def git(repository,*argv):
            if argv==('rev-parse','HEAD'): return commit.encode()
            if argv[0] in ('status','merge-base'): return b''
            if argv[0]=='show':
                revision,name=argv[1].split(':',1)
                if name in self.C.ALLOWED:
                    return candidates[name] if revision==commit else base64.b64decode(sources[name]['base64'])
                return (repo/name).read_bytes()
            raise AssertionError('Unexpected Git operation: '+repr(argv))
        return args,git

    def test_repeat_plan_pins_all_three_helpers_before_equals_after_and_normal_merge(self):
        args,git=self.plan_fixture()
        with patch.object(R,'git',side_effect=git),contextlib.redirect_stdout(io.StringIO()): R.plan(args)
        plan=json.loads((args.output/'plan.json').read_bytes()); manifest=plan['runtimeManifestTemplate']
        for row in manifest['sources']:
            if row['path'] in self.C.NEW:
                self.assertEqual(row['before'],row['after'])
                self.assertEqual(manifest['dependencies'][row['path']],row['before'])
            else:
                self.assertTrue((args.output/'merge'/row['path']).is_file())
        self.C.fence(args.output/'captured-runtime',manifest,self.C.validate_manifest(manifest))

    def test_repeat_plan_refuses_missing_or_changed_helper_before_output(self):
        for name in sorted(self.C.NEW):
            for change,reason in [('missing','Missing existing'),('changed','differs from committed candidate')]:
                with self.subTest(helper=name,change=change):
                    args,git=self.plan_fixture(**{change:name})
                    with patch.object(R,'git',side_effect=git):
                        with self.assertRaisesRegex(ValueError,reason): R.plan(args)
                    self.assertFalse(args.output.exists())

    def test_default_first_install_refuses_present_helpers_before_output(self):
        args,git=self.plan_fixture(preserve=False)
        with patch.object(R,'git',side_effect=git):
            with self.assertRaisesRegex(ValueError,'already exists'): R.plan(args)
        self.assertFalse(args.output.exists())

    def test_repeat_install_and_rollback_keep_helpers_exact_and_restore_existing_sources(self):
        candidates=self.C.validate_manifest(self.manifest)
        self.C.fence(self.root,self.manifest,candidates)
        helpers={name:(self.root/name).read_bytes() for name in self.C.NEW}
        self.C.install(self.root,self.backup,self.manifest['sources'],self.fixture.metadata,True,'repeat')
        self.C.install(self.root,self.backup,self.manifest['sources'],self.fixture.metadata,False,'repeat')
        for row in self.manifest['sources']:
            self.assertEqual(self.C.sha((self.root/row['path']).read_bytes()),row['before'])
            self.assertEqual((self.root/row['path']).stat().st_mode & 0o777,0o640)
        self.assertEqual(helpers,{name:(self.root/name).read_bytes() for name in self.C.NEW})

class ReviewedHelperUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.repeat=RepeatDeploymentTests(); self.repeat.setUp()
        self.addCleanup(self.repeat.doCleanups)
        self.C=self.repeat.C; self.root=self.repeat.root

    def upgrade_fixture(self):
        args,original_git=self.repeat.plan_fixture(preserve=False)
        target='server/jobs.mjs'
        captured=json.loads(args.capture.read_bytes())
        base={name:base64.b64decode(captured['sources'][name]['base64']) for name in self.C.NEW}
        candidate=base[target]+b'// reviewed WORK reward verification\n'
        row={'path':target,'activeSha256':R.sha(base[target]),'baseSha256':R.sha(base[target]),
            'repositoryCandidateSha256':R.sha(candidate),'reason':'Approved exact WORK reward verification'}
        manifest={'format':'proof-of-work-jobs-reviewed-helper-upgrades-v1',
            'baseCommit':args.base_commit,'sourceCommit':args.commit,'sources':[row]}
        review=self.root.parent/'helper-review.json'; review.write_text(json.dumps(manifest)); review.chmod(0o600)
        args.reviewed_helper_upgrades=review
        def git(repo,*argv):
            if argv[0]=='show':
                revision,name=argv[1].split(':',1)
                if revision==args.base_commit and name in base: return base[name]
                if revision==args.commit and name==target: return candidate
            return original_git(repo,*argv)
        return args,git,manifest,captured

    def test_exact_reviewed_upgrade_plan_pins_before_after_and_retains_other_helpers(self):
        args,git,review,_=self.upgrade_fixture()
        with patch.object(R,'git',side_effect=git),contextlib.redirect_stdout(io.StringIO()):R.plan(args)
        plan=json.loads((args.output/'plan.json').read_bytes()); manifest=plan['runtimeManifestTemplate']
        rows={row['path']:row for row in manifest['sources']}
        changed=rows['server/jobs.mjs']; self.assertNotEqual(changed['before'],changed['after'])
        self.assertEqual(changed['before'],review['sources'][0]['activeSha256'])
        self.assertEqual(changed['after'],review['sources'][0]['repositoryCandidateSha256'])
        self.assertEqual(manifest['dependencies']['server/jobs.mjs'],changed['before'])
        for name in self.C.NEW-{'server/jobs.mjs'}:self.assertEqual(rows[name]['before'],rows[name]['after'])
        self.assertEqual(plan['reviewedHelperUpgrades'],review['sources'])
        self.C.fence(args.output/'captured-runtime',manifest,self.C.validate_manifest(manifest))

    def test_real_controller_upgrade_and_rollback_restore_exact_helper_bytes_and_metadata(self):
        args,git,_,_=self.upgrade_fixture()
        with patch.object(R,'git',side_effect=git),contextlib.redirect_stdout(io.StringIO()):R.plan(args)
        manifest=json.loads((args.output/'plan.json').read_bytes())['runtimeManifestTemplate']
        original={name:(self.root/name).read_bytes() for name in self.C.NEW}
        # The production controller stages the exact reviewed candidate bytes
        # before installation; exercise its real atomic install/rollback here.
        for index,row in enumerate(manifest['sources']):
            (self.repeat.backup/f'candidate-{index}.mjs').write_bytes(base64.b64decode(row['base64']))
        self.C.install(self.root,self.repeat.backup,manifest['sources'],self.repeat.fixture.metadata,True,'reviewed-upgrade')
        self.assertNotEqual((self.root/'server/jobs.mjs').read_bytes(),original['server/jobs.mjs'])
        self.C.install(self.root,self.repeat.backup,manifest['sources'],self.repeat.fixture.metadata,False,'reviewed-upgrade')
        for name,raw in original.items():
            self.assertEqual((self.root/name).read_bytes(),raw)
            self.assertEqual((self.root/name).stat().st_mode&0o777,0o640)

    def test_helper_upgrade_pin_drift_refuses_before_output(self):
        for key in ['activeSha256','baseSha256','repositoryCandidateSha256']:
            with self.subTest(pin=key):
                args,git,review,_=self.upgrade_fixture();review['sources'][0][key]='f'*64
                args.reviewed_helper_upgrades.write_text(json.dumps(review))
                with patch.object(R,'git',side_effect=git):
                    with self.assertRaisesRegex(ValueError,'source identity differs'):R.plan(args)
                self.assertFalse(args.output.exists())

    def test_live_helper_must_match_exact_base_commit_before_output(self):
        args,git,_,captured=self.upgrade_fixture();name='server/jobs.mjs'
        raw=b'// unreviewed live helper drift\nexport {};\n'
        captured['sources'][name]={'sha256':R.sha(raw),'base64':base64.b64encode(raw).decode()};args.capture.write_text(json.dumps(captured))
        with patch.object(R,'git',side_effect=git):
            with self.assertRaisesRegex(ValueError,'exact base commit'):R.plan(args)
        self.assertFalse(args.output.exists())

    def test_unreviewed_second_helper_change_refuses_before_output(self):
        args,git,_,_=self.upgrade_fixture();original_git=git;other='src/shared/protocol/jobs.mjs'
        def changed_git(repo,*argv):
            raw=original_git(repo,*argv)
            return raw+b'// unreviewed change\n' if argv==('show',args.commit+':'+other) else raw
        with patch.object(R,'git',side_effect=changed_git):
            with self.assertRaisesRegex(ValueError,'requires explicit review'):R.plan(args)
        self.assertFalse(args.output.exists())

    def test_upgrade_modes_and_commit_binding_refuse_before_output(self):
        args,git,review,_=self.upgrade_fixture();args.preserve_existing_helpers=True
        with patch.object(R,'git',side_effect=git):
            with self.assertRaisesRegex(ValueError,'Conflicting'):R.plan(args)
        self.assertFalse(args.output.exists())
        args.preserve_existing_helpers=False;review['sourceCommit']='c'*40;args.reviewed_helper_upgrades.write_text(json.dumps(review))
        with patch.object(R,'git',side_effect=git):
            with self.assertRaisesRegex(ValueError,'commit identity differs'):R.plan(args)
        self.assertFalse(args.output.exists())

    def test_review_manifest_is_closed_helper_only_and_never_overrides_bytes(self):
        args,_,review,_=self.upgrade_fixture()
        def load(value):
            args.reviewed_helper_upgrades.write_text(json.dumps(value))
            return R.reviewed_helper_upgrades(args.reviewed_helper_upgrades,self.C,args.base_commit,args.commit)
        self.assertEqual(len(load(review)),1)
        for mutate,reason in [
            (lambda v:v['sources'][0].update(path='server/proof-api.mjs'),'allowlist'),
            (lambda v:v['sources'][0].update(reason=''),'review reason'),
            (lambda v:v['sources'][0].update(mergedPath='/tmp/arbitrary'),'allowlist'),
            (lambda v:v['sources'].append(copy.deepcopy(v['sources'][0])),'allowlist'),
            (lambda v:v.update(sources=[]),'count'),
        ]:
            changed=copy.deepcopy(review);mutate(changed)
            with self.assertRaisesRegex(ValueError,reason):load(changed)

    def test_missing_existing_helper_and_unchanged_review_are_not_upgrades(self):
        name='server/jobs.mjs';raw=b'export {};\n';current={'sha256':R.sha(raw),'base64':base64.b64encode(raw).decode()}
        with self.assertRaisesRegex(ValueError,'Missing existing'):
            R.helper_baseline(name,None,raw,False,upgrade_mode=True,base=raw)
        with self.assertRaisesRegex(ValueError,'does not change helper'):
            R.helper_baseline(name,current,raw,False,upgrade_mode=True,base=raw,upgrade={})

if __name__ == '__main__':unittest.main()
