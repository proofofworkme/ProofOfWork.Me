#!/usr/bin/env python3
"""VPS-only operator orchestration: compact receipts and no local backup exports."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import subprocess
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('L',ROOT/'deploy/ui-retention/lifecycle.py')
L=importlib.util.module_from_spec(spec);spec.loader.exec_module(L)


class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.calls=[]
        self.rid='a'*12+'-20261016T010000Z';self.previous='b'*12+'-20261015T010000Z'
        self.pair={'current':self.rid,'previous':self.previous}
        self.binding={'config':{'path':L.CONFIG,'sha256':'c'*64},'controller':{'path':'/trusted/controller','sha256':'d'*64}}
        self.lifecycle={'schema':'pow-ui-custody-lifecycle-v1','approval':{'path':'/trusted/approval','sha256':L.APPROVAL_SHA},'index':{'path':'/trusted/index-1','sha256':'e'*64}}
        self.plan=self.root/'plan.json';L.save(self.plan,{'releaseId':self.rid,'commit':'a'*40,'tree':'1'*40,'publicationAttempt':'initial','retentionLifecycle':self.binding})
        self.log=self.root/'publish.log';L.save(self.log,{'releaseId':self.rid,'commit':'a'*40,'tree':'1'*40,'exitCode':0,'failure':None})
        self.https=self.root/'https.json';L.save(self.https,{'ok':True})
        self.destination=self.root/'cycle'
        self.module=types.SimpleNamespace(qualify=self.qualify,preserve=self.preserve,retire=self.retire)

    def qualify(self,path,binding):
        self.calls.append(('qualify',binding['index']['path']))
        L.save(path,{'candidates':[],'lifecycle':binding})

    def preserve(self,path,custody):
        self.calls.append(('preserve',path.name));custody.mkdir(mode=0o700)

    def retire(self,path,custody,out):
        self.calls.append(('retire',path.name));L.save(out,{'ok':True,'completed':[],'planSha256':L.sha(path.read_bytes())})

    def call(self,binding,operation,frame):
        self.calls.append((operation,frame['expectedStateSha256']))
        self.assertEqual(frame['expectedPair'],self.pair)
        if operation=='prepare-cycle':
            self.assertEqual(frame['publicationReceipt']['path'],'/var/tmp/proofofwork-deploy/recovery-publish-'+self.rid+'-initial/receipt.json')
            return {'cycleId':'cycle','pendingToken':'token','stateSha256':'2'*64,'lifecycleBinding':self.lifecycle,
                    'ordinaryPlan':{'value':{'delete':[],'policyScope':{'admissionIndex':self.lifecycle['index']},
                    'protected':{k:{'fields':{'release_id':rid}} for k,rid in self.pair.items()}}}}
        if operation=='apply-vps-retention':
            self.assertEqual(frame['expectedStateSha256'],'2'*64)
            self.assertNotIn('custodyProof',frame)
            return {'stateSha256':'3'*64,'lifecycleBinding':dict(self.lifecycle,index={'path':'/trusted/index-2','sha256':'f'*64})}
        self.assertEqual(operation,'complete-vps-cycle');self.assertEqual(frame['expectedStateSha256'],'3'*64)
        self.assertNotIn('custodyPlan',frame)
        return {'retentionComplete':True}

    def run_cycle(self,call=None,attempt=None):
        with patch.object(L,'CUSTODY',self.root/'custody'),patch.object(L,'status',return_value={'binding':self.binding,'pair':self.pair,'stateSha256':'1'*64,'retentionPolicy':L.VPS_POLICY,'offHostCustodyRoot':None}),patch.object(L,'call',side_effect=call or self.call),patch.object(L,'custody_module',side_effect=AssertionError('Local custody must never load')),contextlib.redirect_stdout(io.StringIO()):
            return L.complete(self.plan,self.log,self.https,self.destination,attempt)

    def test_reconciled_attempt_uses_unique_phase_names_without_reusing_custody(self):
        names=[]
        def capture(binding,operation,frame):
            names.append(frame['operationId'])
            return self.call(binding,operation,frame)
        self.run_cycle(capture,'batch1')
        self.assertEqual(names,[prefix+self.rid+'-batch1' for prefix in ('release-','ordinary-','complete-')])
        before=list(self.calls)
        with self.assertRaises(FileExistsError):self.run_cycle(capture,'batch2')
        self.assertEqual(self.calls,before)

    def test_invalid_attempt_refuses_before_creating_directory_or_remote_call(self):
        for attempt in ('../retry','UPPER','a'*17,''):
            with self.assertRaisesRegex(AssertionError,'Invalid retention attempt'):self.run_cycle(attempt=attempt)
        self.assertFalse(self.destination.exists());self.assertEqual(self.calls,[])

    def test_ordinary_completion_keeps_only_compact_phase_receipts_without_local_custody(self):
        self.assertTrue(self.run_cycle()['retentionComplete'])
        self.assertEqual([v[0] for v in self.calls],['prepare-cycle','apply-vps-retention','complete-vps-cycle'])
        self.assertFalse((self.root/'custody').exists())
        self.assertEqual(sorted(p.name for p in self.destination.iterdir()),['completed.json','ordinary-applied.json','prepared.json'])
        self.assertTrue((self.destination/'completed.json').exists())

    def test_remote_cleanup_failure_never_reports_complete_or_retries(self):
        def failing(binding,operation,frame):
            if operation=='apply-vps-retention':raise RuntimeError('durable partial operation')
            return self.call(binding,operation,frame)
        with self.assertRaisesRegex(RuntimeError,'partial'):self.run_cycle(failing)
        self.assertFalse((self.destination/'completed.json').exists())
        self.assertFalse(any(c[0]=='retire' for c in self.calls))
        before=list(self.calls)
        with self.assertRaises(FileExistsError):self.run_cycle()
        self.assertEqual(self.calls,before)

    def test_legacy_configuration_refuses_before_creating_custody_or_phase_directory(self):
        with patch.object(L,'status',return_value={'binding':self.binding,'pair':self.pair,'stateSha256':'1'*64}),patch.object(L,'call') as remote:
            with self.assertRaisesRegex(AssertionError,'VPS-only lifecycle'):
                L.complete(self.plan,self.log,self.https,self.destination)
            remote.assert_not_called()
        self.assertFalse(self.destination.exists())

    def test_legacy_preserve_cli_refuses_before_any_plan_read_or_export(self):
        custody=self.root/'forbidden-local-backups'
        result=subprocess.run(['python3','-I','-B',str(ROOT/'deploy/ui-retention/custody.py'),
                               'preserve',str(self.root/'missing-plan'),str(custody)],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertIn('Local backup exports are disabled',result.stderr)
        self.assertFalse(custody.exists())

    def test_missing_exact_ordinary_custody_refuses(self):
        q=self.root/'qualified.json';L.save(q,{'candidates':[]})
        plan={'delete':[{'path':'/approved/archive','snapshot':{'sha256':'a'*64}}]}
        with self.assertRaisesRegex(AssertionError,'unique custody'):L.ordinary_proof(plan,q,self.root,self.module)

    def test_publication_log_must_have_one_exact_successful_terminal(self):
        self.log.write_bytes(self.log.read_bytes()*2)
        with self.assertRaises(AssertionError):L.publication_binding(json.loads(self.plan.read_bytes()),self.log)

    def test_modified_local_custody_code_refuses_before_remote_mutation(self):
        value=json.loads(self.plan.read_bytes());value['retentionLocalSources']={p:'0'*64 for p in L.LOCAL_SOURCES}
        self.plan.write_bytes(L.encoded(value))
        with self.assertRaisesRegex(AssertionError,'local source changed'):self.run_cycle()
        self.assertFalse(self.destination.exists());self.assertEqual(self.calls,[])

    def test_initial_cycle_also_requires_exact_installed_custody_code(self):
        discovery={'packageManifest':{'files':{p:{'sha256':'0'*64} for p in L.LOCAL_SOURCES}}}
        with patch.object(L,'discover',return_value=discovery),patch.object(L,'call') as remote:
            with self.assertRaisesRegex(AssertionError,'differs from installed'):L.status()
            remote.assert_not_called()

    def test_timestamped_operation_uses_bounded_managed_unit(self):
        binding={'config':{'path':L.CONFIG,'sha256':'a'*64},'controller':{
            'path':L.EVIDENCE+'/ui-lifecycle-tools-'+'b'*64+'/deploy/ui-retention/lifecycle_remote.py','sha256':'c'*64}}
        with patch.object(L,'remote',return_value={'ok':True}) as remote:
            L.call(binding,'prepare-cycle',{'operationId':'release-'+self.rid})
            command=remote.call_args.args[0]
            self.assertIn('/usr/bin/systemd-run',command)
            self.assertIn('--property=RuntimeMaxSec=90min',command)
            self.assertIn('--unit=proofofwork-ui-lifecycle-release-'+self.rid+'.service',command)


if __name__=='__main__':unittest.main()
