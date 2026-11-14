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
        return {'format':'proof-of-work-pay-rollout-plan-v1','releaseId':'a'*12+'-20261007T010000Z','sourceCommit':'a'*40,
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

class DispatchTests(unittest.TestCase):
    def args(self):
        return types.SimpleNamespace(plan=Path('/tmp/pay-plan/plan.json'),
            receipt=Path('/tmp/pay-dispatch-test-receipt.json'), phase='overlay', plan_sha256='a'*64)

    def test_dispatch_requires_exact_hash_and_direct_vps_receipt_before_ssh(self):
        for key, value in [('plan_sha256', ''), ('receipt', Path('/tmp/subdirectory/receipt.json'))]:
            args=self.args(); setattr(args,key,value)
            with patch.object(R.subprocess,'run') as run:
                with self.assertRaises(ValueError): R.overlay(args)
                run.assert_not_called()

    def test_dispatch_reads_no_local_plan_and_writes_no_local_receipt(self):
        args=self.args()
        receipt={'receipt':str(args.receipt),'location':'node-vps','sha256':'b'*64,
            'releaseId':'a'*12+'-20261114T000000Z','phase':'overlay','status':'completed'}
        result=types.SimpleNamespace(returncode=0,stdout=json.dumps(receipt).encode(),stderr=b'')
        with patch.object(R.subprocess,'run',return_value=result) as run, \
                patch.object(R,'save',side_effect=AssertionError('local artifact write')), \
                contextlib.redirect_stdout(io.StringIO()) as printed:
            R.overlay(args)
        request=json.loads(run.call_args.kwargs['input'])
        self.assertEqual(request['plan'],str(args.plan))
        self.assertEqual(request['planSha256'],args.plan_sha256)
        self.assertEqual(json.loads(printed.getvalue()),receipt)
        self.assertNotIn('runtimeManifestTemplate',request)

    def test_remote_failure_or_transport_timeout_never_claims_installed(self):
        args=self.args()
        failures=[types.SimpleNamespace(returncode=1,stdout=b'',stderr=b'refused'),
                  R.subprocess.TimeoutExpired('ssh',1260)]
        for failure in failures:
            with patch.object(R.subprocess,'run',side_effect=failure if isinstance(failure,Exception) else None,
                    return_value=failure), patch.object(R,'save',side_effect=AssertionError('local write')), \
                    contextlib.redirect_stdout(io.StringIO()) as printed:
                with self.assertRaises(ValueError): R.overlay(args)
            self.assertEqual(printed.getvalue(),'')

    def test_success_without_bound_receipt_refuses(self):
        for raw in (b'',json.dumps({'location':'operator','receipt':'/tmp/wrong'}).encode()):
            result=types.SimpleNamespace(returncode=0,stdout=raw,stderr=b'')
            with patch.object(R.subprocess,'run',return_value=result):
                with self.assertRaisesRegex(ValueError,'receipt'): R.overlay(self.args())

class LocalPlanTests(unittest.TestCase):
    def test_new_pay_helpers_cannot_receive_reviewed_merge_override(self):
        ns=R.controller()
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            root=Path(name);source=root/'resolution.mjs';source.write_bytes(b'export {};\n');source.chmod(0o600)
            for helper in ns.NEW:
                row={'path':helper,'activeSha256':'a'*64,'baseSha256':'b'*64,
                    'repositoryCandidateSha256':'c'*64,'mergedPath':str(source),
                    'mergedSha256':R.sha(source.read_bytes()),'reason':'Must remain creation-only'}
                manifest=root/'review.json';manifest.write_text(json.dumps({
                    'format':'proof-of-work-pay-reviewed-merges-v1','sources':[row]}));manifest.chmod(0o600)
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
            'repositoryCandidateSha256':R.sha(b'Pay candidate'), 'mergedBytes':b'accepted Audit31 source + Pay',
            'reason':'Preserve reviewed native transition accessor'}
        result, evidence=R.selected_merge(name,b'conflict',True,b'accepted Audit31 source',b'repository base',b'Pay candidate',{name:row})
        self.assertEqual(result,row['mergedBytes']);self.assertNotIn('mergedBytes',evidence)
        for active,base,candidate in [(b'drift',b'repository base',b'Pay candidate'),
                (b'accepted Audit31 source',b'drift',b'Pay candidate'),
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
                manifest.write_text(json.dumps({'format':'proof-of-work-pay-reviewed-merges-v1','sources':[value]}));manifest.chmod(0o600)
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

    def test_creation_only_evidence_refuses_overwrite_and_symlink(self):
        with tempfile.TemporaryDirectory(dir='/tmp') as name:
            path=Path(name)/'receipt';R.save(path,b'original')
            with self.assertRaises(FileExistsError):R.save(path,b'changed')
            self.assertEqual(path.read_bytes(),b'original')
            alias=Path(name)/'alias';alias.symlink_to(path)
            with self.assertRaises(ValueError):R.private_output(alias)


if __name__ == '__main__': unittest.main()
