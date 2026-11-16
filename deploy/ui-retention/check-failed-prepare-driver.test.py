#!/usr/bin/env python3
"""Boundary refusals for isolated one-time repair driver; no live operations."""
import importlib.util
from pathlib import Path
import tempfile
import base64
import copy
import fcntl
import os
import types
from unittest.mock import MagicMock
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('repair_driver_tests',Path(__file__).with_name('reconcile_failed_prepare.py'))
D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D)

class DriverTests(unittest.TestCase):
    def test_package_approval_remains_first(self):
        self.assertEqual(D.I.FILES[0],'audits/2026-10-16-ui-retention-repair-approval.json')
        self.assertEqual(D.I.FILES,D.R.PACKAGE_FILES)
        self.assertEqual(D.I.FILES.count('deploy/ui-retention/failed_prepare_repair.py'),1)
    def test_bad_source_refused_before_runtime(self):
        with patch.object(D.os,'geteuid',return_value=0), patch.object(D.I,'existing_runtime') as runtime:
            with self.assertRaises(ValueError):D.apply({'schema':'pow-ui-failed-prepare-repair-plan-v1','authority':D.PIN,'reconcilerSha256':'0'*64})
            runtime.assert_not_called()
    def test_reused_journal_refused_before_qualification(self):
        with tempfile.TemporaryDirectory() as td, patch.object(D,'JOURNAL',Path(td)),patch.object(D.Q,'qualify') as qualify:
            with self.assertRaisesRegex(ValueError,'journal'):D.qualified(None,None,None)
            qualify.assert_not_called()
    def test_missing_service_refused(self):
        raw='MainPID=0\nActiveState=failed\nSubState=failed\nResult=exit-code\nExecMainStatus=1\nLoadState=not-found\nControlGroup=\n'
        with patch.object(D.subprocess,'check_output',return_value=raw):
            with self.assertRaisesRegex(ValueError,'identity'):D.stopped_services()
    def test_foreign_cgroup_refused(self):
        raw='MainPID=0\nActiveState=failed\nSubState=failed\nResult=exit-code\nExecMainStatus=1\nLoadState=loaded\nControlGroup=/other\n'
        with patch.object(D.subprocess,'check_output',return_value=raw):
            with self.assertRaisesRegex(ValueError,'cgroup'):D.stopped_services()
    def test_live_descendant_refused(self):
        unit='pay-collect-verify-c22e585-v1.service'
        raw='MainPID=0\nActiveState=failed\nSubState=failed\nResult=exit-code\nExecMainStatus=1\nLoadState=loaded\nControlGroup=/system.slice/'+unit+'\n'
        with patch.object(D.subprocess,'check_output',return_value=raw),patch.object(Path,'exists',return_value=True),patch.object(Path,'resolve',lambda p:p),patch.object(Path,'rglob',lambda p,x:[p/'cgroup.procs']),patch.object(Path,'read_text',return_value='12345\n'):
            with self.assertRaisesRegex(ValueError,'descendants'):D.stopped_services()

class TransactionTests(unittest.TestCase):
    """Real journal/package/config/state writes; qualification and host observations mocked.

    These tests exercise ordering, creation-only retry refusal, and interrupted
    switches, not the separate production evidence/retirement authority.
    """
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.evidence=self.root/'evidence';self.evidence.mkdir(mode=0o700)
        self.journal=self.evidence/'repair';self.config=self.root/'config.json';self.state=self.root/'state.json'
        self.old={'revision':285,'status':'retention-incomplete','activePhase':{'failed':True},'pending':None}
        self.oldconfig={'original':True}
        self.config.write_bytes(D.encoded(self.oldconfig));self.state.write_bytes(D.encoded(self.old))
        self.config.chmod(0o600);self.state.chmod(0o600)
        self.pin=dict(D.PIN,state=D.sha(self.state.read_bytes()),config=D.sha(self.config.read_bytes()))
        self.context={'pair':self.pin['pair'],'guards':{}}
        self.package=self.evidence/'ui-lifecycle-tools-test'
        newconfig={'package':{'path':str(self.package)}}
        self.payload={'config':newconfig,'configSha256':D.sha(D.encoded(newconfig)),
            'files':{'test.py':{'base64':base64.b64encode(b'# exact candidate\n').decode(),
                'sha256':D.sha(b'# exact candidate\n'),'bytes':18}},'manifest':{'files':'fixture'}}
        self.scope={'eligible':[]}
        self.ordinary={'policyScope':self.scope,'privateStageRetention':{'forecast':{}},
            'citationReview':{'fixture':'exact'}}
        self.before={'state':self.old,'context':self.context,'index':{'fixture':'index'},
            'httpsReceipt':{'fixture':'https'},'publication':{'fixture':'publication'},
            'publicationRule':self.ordinary['privateStageRetention'],
            'configBase64':base64.b64encode(self.config.read_bytes()).decode(),
            'stateBase64':base64.b64encode(self.state.read_bytes()).decode(),
            'guards':{'existingPackages':[]},'evidence':{}}
        self.plan={'schema':'pow-ui-failed-prepare-repair-plan-v1','authority':self.pin,
            'reconcilerSha256':D.sha(Path(D.__file__).read_bytes()),'payload':self.payload,
            'before':self.before,'citationReview':self.ordinary['citationReview'],
            'ordinaryPlanValue':self.ordinary,'ordinaryPlan':{'path':str(self.journal/'ordinary-plan.json'),
            'sha256':D.sha(D.encoded(self.ordinary))}}
        self.original=MagicMock();self.original.layout.evidence=self.evidence
        def lock(layout):
            fd=os.open(self.root/'lock',os.O_CREAT|os.O_RDWR,0o600);fcntl.flock(fd,fcntl.LOCK_EX);return fd
        self.original.S.lock.side_effect=lock
        self.candidate=MagicMock();self.candidate.current.return_value=(None,self.context)
        self.candidate.S.encoded.side_effect=D.encoded
        self.installed=MagicMock()
        self.installed.state.side_effect=lambda: (__import__('json').loads(self.state.read_bytes()),D.sha(self.state.read_bytes()))
        self.installed.status.return_value={'retentionComplete':False}
        def qualified(*args):
            if self.journal.exists():raise ValueError('Prior repair journal requires explicit reconciliation')
            return copy.deepcopy(self.before),self.candidate,copy.deepcopy(self.scope)
        patches=[
            patch.object(D,'PIN',self.pin),patch.object(D,'JOURNAL',self.journal),
            patch.object(D,'qualified',side_effect=qualified),
            patch.object(D,'stopped_services',return_value=[]),
            patch.object(D,'os',types.SimpleNamespace(geteuid=lambda:0,path=os.path,close=os.close,
                replace=os.replace)),
            patch.object(D.I,'CONFIG',str(self.config)),patch.object(D.I,'STATE',str(self.state)),
            patch.object(D.I,'EVIDENCE',str(self.evidence)),
            patch.object(D.I,'validate_payload'),
            patch.object(D.I,'existing_runtime',side_effect=lambda h:self.original if h==self.pin['config'] else self.installed),
            patch.object(D.I,'guard_inventory',side_effect=lambda:{'existingPackages':[self.package.name] if self.package.exists() else []}),
        ]
        for p in patches:p.start();self.addCleanup(p.stop)
    def test_real_switch_seals_prepared_without_retirement_or_publication(self):
        before=self.config.read_bytes(),self.state.read_bytes()
        result=D.apply(self.plan)
        self.assertTrue(result['prepared']);self.assertFalse(result['retentionComplete'])
        self.assertFalse(result['deletionPerformed']);self.assertFalse(result['publicationPerformed'])
        self.assertEqual((self.journal/'prior-config.json').read_bytes(),before[0])
        self.assertEqual((self.journal/'prior-state.json').read_bytes(),before[1])
        self.assertTrue((self.journal/'verified.json').is_file())
        self.assertEqual(__import__('json').loads(self.state.read_bytes())['revision'],287)
        self.assertEqual((self.package/'test.py').read_bytes(),b'# exact candidate\n')
        self.installed.S.verify_plan.assert_called_once()
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)
    def interrupted(self,number,after=False):
        calls=0;real=os.replace
        def replace(a,b):
            nonlocal calls
            calls+=1
            if calls==number:
                if after:real(a,b)
                raise OSError('injected uncertain switch')
            real(a,b)
        with patch.object(D.os,'replace',side_effect=replace):
            with self.assertRaisesRegex(OSError,'uncertain'):D.apply(self.plan)
        self.assertTrue((self.journal/'intent.json').exists())
        self.assertFalse((self.journal/'verified.json').exists())
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)
    def test_failure_before_first_cas_blocks_retry(self):self.interrupted(1)
    def test_failure_after_active_cas_blocks_retry(self):self.interrupted(1,True)
    def test_failure_before_final_state_switch_blocks_retry(self):self.interrupted(2)
    def test_failure_between_state_and_config_blocks_retry(self):self.interrupted(3)
    def test_uncertain_config_switch_blocks_retry(self):self.interrupted(3,True)
    def write_interrupted(self,name,after=False):
        real=D.I.save
        def save(path,raw):
            if Path(path).name==name:
                if after:real(path,raw)
                raise OSError('injected uncertain write')
            return real(path,raw)
        with patch.object(D.I,'save',side_effect=save):
            with self.assertRaisesRegex(OSError,'uncertain write'):D.apply(self.plan)
        self.assertTrue(self.journal.exists())
        self.assertEqual((self.journal/'verified.json').exists(),name=='verified.json' and after)
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)
    def test_intent_write_failure_blocks_retry(self):self.write_interrupted('intent.json')
    def test_uncertain_intent_write_blocks_retry(self):self.write_interrupted('intent.json',True)
    def test_prior_state_write_failure_blocks_retry(self):self.write_interrupted('prior-state.json')
    def test_ordinary_plan_write_failure_blocks_retry(self):self.write_interrupted('ordinary-plan.json')
    def test_package_write_failure_blocks_retry(self):self.write_interrupted('test.py')
    def test_config_next_write_failure_blocks_retry(self):self.write_interrupted('ui-lifecycle-failed-prepare.next.json')
    def test_repair_receipt_write_failure_blocks_retry(self):self.write_interrupted('repaired.json')
    def test_seal_write_failure_blocks_retry(self):self.write_interrupted('verified.json')
    def test_uncertain_seal_write_blocks_retry_even_with_seal(self):self.write_interrupted('verified.json',True)
    def test_failure_after_final_state_switch_blocks_retry(self):self.interrupted(2,True)
    def drift_before_first_cas(self,path):
        original=self.config.read_bytes(),self.state.read_bytes()
        self.original.capacity.side_effect=lambda *args:Path(path).write_bytes(b'{"unexpected":"drift"}\n')
        with self.assertRaisesRegex(ValueError,'(SHA|hash|digest)'):D.apply(self.plan)
        self.assertTrue(self.journal.exists());self.assertFalse(self.package.exists())
        self.assertFalse((self.journal/'verified.json').exists())
        untouched=self.state if path==self.config else self.config
        self.assertEqual(untouched.read_bytes(),original[1] if path==self.config else original[0])
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)
    def test_config_drift_before_cas_refuses(self):self.drift_before_first_cas(self.config)
    def test_state_drift_before_cas_refuses(self):self.drift_before_first_cas(self.state)
    def test_context_drift_after_package_refuses(self):
        self.candidate.current.return_value=(None,dict(self.context,pair={'changed':True}))
        with self.assertRaisesRegex(ValueError,'context changed'):D.apply(self.plan)
        self.assertTrue(self.package.exists());self.assertEqual(self.config.read_bytes(),D.encoded(self.oldconfig))
        self.assertEqual(__import__('json').loads(self.state.read_bytes())['revision'],286)
        self.assertFalse((self.journal/'repaired.json').exists())
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)
    def test_unexpected_evidence_after_package_refuses(self):
        def current():
            D.I.save(self.evidence/'unexpected.json',b'{}\n')
            return None,self.context
        self.candidate.current.side_effect=current
        with self.assertRaisesRegex(ValueError,'evidence changed'):D.apply(self.plan)
        self.assertEqual(self.config.read_bytes(),D.encoded(self.oldconfig))
        self.assertFalse((self.journal/'verified.json').exists())
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)
    def test_existing_package_refuses_before_journal(self):
        self.package.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError,'already exists'):D.apply(self.plan)
        self.assertFalse(self.journal.exists())
        self.assertEqual(self.state.read_bytes(),D.encoded(self.old))
    def test_false_complete_status_never_seals(self):
        self.installed.status.return_value={'retentionComplete':True}
        with self.assertRaisesRegex(ValueError,'prepared verification'):D.apply(self.plan)
        self.assertTrue((self.journal/'repaired.json').exists())
        self.assertFalse((self.journal/'verified.json').exists())
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)
    def test_postswitch_verification_failure_never_seals(self):
        self.installed.S.verify_plan.side_effect=ValueError('installed bytes drift')
        with self.assertRaisesRegex(ValueError,'bytes drift'):D.apply(self.plan)
        self.assertTrue((self.journal/'repaired.json').exists())
        self.assertFalse((self.journal/'verified.json').exists())
        with self.assertRaisesRegex(ValueError,'journal'):D.apply(self.plan)

if __name__=='__main__':unittest.main()
