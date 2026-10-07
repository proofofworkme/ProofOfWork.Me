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
        with self.assertRaisesRegex(ValueError,'Unknown native'):R.native_jobs_overlay(old,b'// read_work_transition_payload_v1')
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
    def test_creation_only_evidence_refuses_overwrite_and_symlink(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            path=Path(name)/'receipt';R.save(path,b'original')
            with self.assertRaises(FileExistsError):R.save(path,b'changed')
            self.assertEqual(path.read_bytes(),b'original')
            alias=Path(name)/'alias';alias.symlink_to(path)
            with self.assertRaises(ValueError):R.private_output(alias)

if __name__ == '__main__':unittest.main()
