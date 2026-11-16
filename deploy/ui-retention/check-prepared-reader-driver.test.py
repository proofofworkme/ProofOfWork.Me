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

class TransactionTests(unittest.TestCase):
    """Real journal/package/config/state writes; qualification and host observations mocked.

    These tests exercise ordering, creation-only retry refusal, and interrupted
    switches, not the separate production evidence/retirement authority.
    """
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.evidence=self.root/'evidence';self.evidence.mkdir(mode=0o700)
        self.journal=self.evidence/'repair';self.config=self.root/'config.json';self.state=self.root/'state.json'
        self.old={'revision':287,'status':'retention-incomplete','activePhase':None,'pending':{'stage':'prepared','token':'same-token','cycleId':D.CYCLE,'ordinaryPlan':{'path':'prior-plan','sha256':'a'*64}},'lastPayloadRetirement':{'preserved':True},'lastFailedPreparationRepair':{'preserved':True}}
        self.oldconfig={'original':True}
        self.config.write_bytes(D.encoded(self.oldconfig));self.state.write_bytes(D.encoded(self.old))
        self.config.chmod(0o600);self.state.chmod(0o600)
        self.pin=dict(D.F.READER_PRIOR,state=D.sha(self.state.read_bytes()),config=D.sha(self.config.read_bytes()))
        self.context={'pair':D.PIN['pair'],'guards':{}}
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
        self.before['ordinaryPlan']=self.old['pending']['ordinaryPlan']
        self.plan={'schema':'pow-ui-prepared-reader-repair-plan-v1','authority':self.pin,
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
        self.installed.status.return_value={'retentionComplete':False,'pair':D.PIN['pair']}
        def qualified(*args):
            if self.journal.exists():raise ValueError('Prior repair journal requires explicit reconciliation')
            return copy.deepcopy(self.before),self.candidate,copy.deepcopy(self.ordinary)
        patches=[
            patch.object(D.F,'READER_PRIOR',self.pin),patch.object(D,'READER_JOURNAL',self.journal),patch.object(D,'JOURNAL',self.root/'original-repair'),
            patch.object(D,'reader_qualified',side_effect=qualified),
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

    def test_success_exact_pending_and_original_history(self):
        result=D.apply_reader_plan(self.plan)
        state=__import__('json').loads(self.state.read_bytes())
        self.assertEqual(state['revision'],288)
        self.assertEqual(state['pending'],self.old['pending'])
        self.assertEqual(state['lastFailedPreparationRepair'],self.old['lastFailedPreparationRepair'])
        self.assertEqual(state['lastPayloadRetirement'],self.old['lastPayloadRetirement'])
        self.assertFalse(result['retentionComplete']);self.assertFalse(result['deletionPerformed'])
        self.assertTrue((self.journal/'verified.json').exists())
        with self.assertRaisesRegex(ValueError,'journal'):D.apply_reader_plan(self.plan)
    def test_each_switch_before_and_uncertain_after_fails_closed(self):
        # Separate fixture per switch because no automatic cleanup/retry is permitted.
        for number in (1,2):
            for after in (False,True):
                with self.subTest(number=number,after=after):
                    child=TransactionTests();child.setUp()
                    try:
                        calls=[0];real=os.replace
                        def replace(a,b):
                            calls[0]+=1
                            if calls[0]==number:
                                if after:real(a,b)
                                raise OSError('uncertain switch')
                            real(a,b)
                        with patch.object(D.os,'replace',side_effect=replace):
                            with self.assertRaisesRegex(OSError,'uncertain'):D.apply_reader_plan(child.plan)
                        self.assertTrue((child.journal/'intent.json').exists())
                        self.assertFalse((child.journal/'verified.json').exists())
                        with self.assertRaisesRegex(ValueError,'journal'):D.apply_reader_plan(child.plan)
                    finally:child.doCleanups()
    def test_each_write_fault_preserves_partial_and_refuses_retry(self):
        for name in ('intent.json','prior-state.json','prior-config.json','test.py','package.json',
                     'state-prepared-reader.next.json','ui-lifecycle-prepared-reader.next.json','installed.json','verified.json'):
            for after in (False,True):
                with self.subTest(name=name,after=after):
                    child=TransactionTests();child.setUp()
                    try:
                        real=D.I.save
                        def save(path,raw):
                            if Path(path).name==name:
                                if after:real(path,raw)
                                raise OSError('uncertain write')
                            return real(path,raw)
                        with patch.object(D.I,'save',side_effect=save):
                            with self.assertRaisesRegex(OSError,'uncertain'):D.apply_reader_plan(child.plan)
                        self.assertTrue(child.journal.exists())
                        with self.assertRaisesRegex(ValueError,'journal'):D.apply_reader_plan(child.plan)
                    finally:child.doCleanups()
    def test_postswitch_state_failure_keeps_receipt_no_seal(self):
        self.installed.state.side_effect=ValueError('native post-switch failure')
        with self.assertRaisesRegex(ValueError,'native post-switch'):D.apply_reader_plan(self.plan)
        self.assertTrue((self.journal/'installed.json').exists())
        self.assertFalse((self.journal/'verified.json').exists())
        with self.assertRaisesRegex(ValueError,'journal'):D.apply_reader_plan(self.plan)
    def test_context_drift_prevents_switch(self):
        self.candidate.current.return_value=(None,{'changed':True})
        with self.assertRaisesRegex(ValueError,'context drift'):D.apply_reader_plan(self.plan)
        self.assertEqual(self.state.read_bytes(),D.encoded(self.old))
        self.assertEqual(self.config.read_bytes(),D.encoded(self.oldconfig))
        self.assertTrue(self.journal.exists())
    def test_claimed_complete_never_seals(self):
        self.installed.status.return_value={'retentionComplete':True,'pair':D.PIN['pair']}
        with self.assertRaisesRegex(ValueError,'failed verification'):D.apply_reader_plan(self.plan)
        self.assertFalse((self.journal/'verified.json').exists())
if __name__=='__main__':unittest.main(verbosity=2)
