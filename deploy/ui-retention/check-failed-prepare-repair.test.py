#!/usr/bin/env python3
"""Synthetic closed-evidence tests, not live recovery qualification."""
import base64
import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('repair_edge_tested',Path(__file__).with_name('failed_prepare_repair.py'))
R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)

class EdgeTests(unittest.TestCase):
    def setUp(self):
        self.original_pin=copy.deepcopy(R.PIN)
        self.files={}
        def record(path,value):
            self.files[path]=value
            return {'path':path,'sha256':R.sha(R.encoded(value))}
        self.record=record
        oldpkg={'path':R.BASE+'/ui-lifecycle-tools-'+'b'*64,'sha256':'b'*64}
        oldconfig={'schema':'pow-ui-retention-lifecycle-config-v1','sourceCommit':'c'*40,'sourceTree':'d'*40,
            'scopeApprovalSha256':'a'*64,'statePath':R.STATE_PATH,'offHostCustodyRoot':None,
            'retentionPolicy':{'model':'vps-current-and-one-prior-v1'},'payloadRetirement':{'mode':'complete'},
            'payloadRetirementSourceConfig':{'path':'original','sha256':'e'*64},
            'package':oldpkg,'controller':{'path':oldpkg['path']+'/deploy/ui-retention/lifecycle_remote.py','sha256':'f'*64},
            'approval':{'path':oldpkg['path']+'/audits/2026-10-16-ui-retention-repair-approval.json','sha256':'a'*64}}
        R.PIN['config']=record(R.JOURNAL+'/prior-config.json',oldconfig)['sha256']
        oldindex=record(R.BASE+'/old-index.json',{'schema':'index','admissions':[]})
        prior={'schema':'pow-ui-retention-lifecycle-state-v1','configSha256':R.PIN['config'],'revision':284,
            'status':'complete','pending':None,'activePhase':None,'index':oldindex,
            'lastCompleted':{'cycleId':'B-cycle'},'completedContext':{'pair':'B/a2'},
            'lastIntent':{'path':'old-untouched'},'lastUpgrade':{'old':'preserved-in-journal'},
            'lastPayloadRetirement':{'path':'historic','sha256':'9'*64}}
        R.PIN['priorState']=R.sha(R.encoded(prior))
        context={'pair':R.PIN['pair'],'manifests':{'current':R.PIN['manifest'],'previous':'8'*64},'guards':{'guard':'exact'}}
        forecast={'releaseId':R.RELEASE,'wouldRetire':R.PIN['outgoing'],'stateSha256':R.PIN['priorState'],
            'index':oldindex,'previousPair':{'current':R.PIN['pair']['previous'],'previous':'a2'}}
        native={'releaseId':R.RELEASE,'privateStageRetention':forecast,
            'retentionLifecycle':{'config':{'sha256':R.PIN['config']}}}
        nativebinding=record('/var/tmp/proofofwork-deploy/recovery-plan-'+R.RELEASE+'-pay-c1.json',native)
        terminal={'releaseId':R.RELEASE,'exitCode':0,'failure':None,'planSha256':nativebinding['sha256'],
            'privateStageRetention':forecast,'attempt':'pay-c1'}
        pub=record('/var/tmp/proofofwork-deploy/recovery-publish-'+R.RELEASE+'-pay-c1/receipt.json',terminal)
        https={'ok':True,'releaseId':R.RELEASE,'manifestSha256':R.PIN['manifest']}
        R.PIN['httpsReceipt']=record(R.PIN['httpsReceipt']['path'],https)
        req={'operationId':'release-'+R.RELEASE,'expectedStateSha256':R.PIN['priorState'],'expectedPair':R.PIN['pair'],
            'httpsReceipt':{'base64':base64.b64encode(R.encoded(https)).decode(),'sha256':R.PIN['httpsReceipt']['sha256']},
            'publicationReceipt':pub}
        phase={'schema':'pow-ui-retention-phase-intent-v1','operation':'prepare-cycle','operationId':'release-'+R.RELEASE,
            'configSha256':R.PIN['config'],'priorStateSha256':R.PIN['priorState'],
            'priorStateBase64':base64.b64encode(R.encoded(prior)).decode(),'context':context,'request':req}
        R.PIN['phaseIntent']=record(R.PIN['phaseIntent']['path'],phase)
        failed=dict(prior,revision=285,status='retention-incomplete',activePhase={
            'operation':'prepare-cycle','operationId':'release-'+R.RELEASE,'intent':R.PIN['phaseIntent']})
        R.PIN['state']=record(R.JOURNAL+'/prior-state.json',failed)['sha256']
        R.PIN['admission']=record(R.PIN['admission']['path'],{'retainedPair':R.PIN['pair']})
        R.PIN['index']=record(R.PIN['index']['path'],{'schema':'index','admissions':[R.PIN['admission']]})
        ordinary={'kind':'future-retention','moves':[],'delete':[{'path':p} for p in R.PIN['outgoing']],
            'policyScope':{'eligible':[{'path':p} for p in R.PIN['outgoing']],'admissionIndex':R.PIN['index']},
            'safeguards':context['guards'],'citationReview':{'path':'review','sha256':'7'*64},
            'privateStageRetention':{'forecast':forecast,'publicationReceiptSha256':pub['sha256'],
                'releasePlanSha256':nativebinding['sha256']}}
        ordinarybinding=record(R.JOURNAL+'/ordinary-plan.json',ordinary)
        config=copy.deepcopy(oldconfig);pkg={'path':R.BASE+'/ui-lifecycle-tools-'+'1'*64,'sha256':'1'*64}
        config.update(package=pkg,sourceCommit='2'*40,sourceTree='3'*40,
            controller={'path':pkg['path']+'/deploy/ui-retention/lifecycle_remote.py','sha256':'4'*64},
            approval={'path':pkg['path']+'/audits/2026-10-16-ui-retention-repair-approval.json','sha256':'a'*64})
        self.config=config;self.config_sha=R.sha(R.encoded(config))
        plan={'schema':'pow-ui-failed-prepare-repair-plan-v1','authority':copy.deepcopy(R.PIN),
            'before':{'stateSha256':R.PIN['state'],'state':failed,'context':context,'index':R.PIN['index'],
                'publication':pub,'httpsReceipt':R.PIN['httpsReceipt']},
            'ordinaryPlan':ordinarybinding,'ordinaryPlanValue':ordinary,
            'payload':{'config':config,'configSha256':self.config_sha}}
        marker={'intentPath':R.JOURNAL+'/intent.json','completionPath':R.JOURNAL+'/repaired.json'}
        pending={'cycleId':R.CYCLE,'token':R.pending_token(self.config_sha,ordinarybinding,context),'stage':'prepared',
            'context':context,'ordinaryPlan':ordinarybinding,'httpsReceipt':R.PIN['httpsReceipt'],
            'publicationReceipt':pub,'index':R.PIN['index']}
        template=dict(failed,configSha256=self.config_sha,revision=287,status='retention-incomplete',pending=pending,
            activePhase=None,index=R.PIN['index'],lastUpgrade={},lastFailedPreparationRepair=copy.deepcopy(marker))
        intent={'schema':'pow-ui-failed-prepare-repair-intent-v1','authority':copy.deepcopy(R.PIN),'plan':plan,
            'stateTemplate':template,'stateTemplateSha256':R.sha(R.encoded(template))}
        intentbinding=record(marker['intentPath'],intent)
        marker['intentSha256']=intentbinding['sha256']
        self.state=dict(template,lastFailedPreparationRepair=marker)
        done={'schema':'pow-ui-failed-prepare-repaired-v1','ok':True,'prepared':True,'retentionComplete':False,
            'deletionPerformed':False,'publicationPerformed':False,'originalPhaseEvidencePreserved':True,
            'intent':intentbinding,'config':{'path':R.CONFIG_PATH,'sha256':self.config_sha},
            'state':{'path':R.STATE_PATH,'sha256':R.sha(R.encoded(self.state))},'stateRevision':287}
        donebinding=record(marker['completionPath'],done)
        record(R.JOURNAL+'/verified.json',{'schema':'pow-ui-failed-prepare-repair-verified-v1','repairReceipt':donebinding,
            'config':done['config'],'state':done['state'],'contextSha256':R.sha(R.encoded(context)),
            'prepared':True,'retentionComplete':False})
        self.intent=intent;self.done=done;self.plan=plan
    def tearDown(self):
        R.PIN.clear();R.PIN.update(self.original_pin)
    def read(self,path,expected=None):
        if str(path) not in self.files:raise FileNotFoundError(str(path))
        value=copy.deepcopy(self.files[str(path)]);digest=R.sha(R.encoded(value))
        if expected is not None and digest!=expected:raise ValueError('test reader hash mismatch')
        return value,digest
    def verify(self,state=None,**kwargs):
        return R.verify_edge(state or self.state,self.config_sha,self.config,self.read,**kwargs)
    def reseal(self):
        self.config=self.plan['payload']['config']
        self.config_sha=R.sha(R.encoded(self.config))
        self.plan['payload']['configSha256']=self.config_sha
        template=self.intent['stateTemplate']
        self.intent['stateTemplateSha256']=R.sha(R.encoded(template))
        marker={'intentPath':R.JOURNAL+'/intent.json','completionPath':R.JOURNAL+'/repaired.json',
                'intentSha256':R.sha(R.encoded(self.intent))}
        self.state=dict(template,lastFailedPreparationRepair=marker)
        self.done.update(intent={'path':marker['intentPath'],'sha256':marker['intentSha256']},
            config={'path':R.CONFIG_PATH,'sha256':self.config_sha},
            state={'path':R.STATE_PATH,'sha256':R.sha(R.encoded(self.state))})
        seal=self.files[R.JOURNAL+'/verified.json']
        seal.update(repairReceipt={'path':marker['completionPath'],'sha256':R.sha(R.encoded(self.done))},
                    state=self.done['state'],config=self.done['config'])
    def runtime_consumer(self):
        spec=importlib.util.spec_from_file_location('repair_runtime_consumer',Path(__file__).with_name('lifecycle_remote.py'))
        runtime_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(runtime_module)
        runtime=object.__new__(runtime_module.Runtime)
        runtime.verify_prepare_repair=False
        return runtime_module,runtime
    def test_native_runtime_consumer_checks_real_marker(self):
        from unittest.mock import patch
        module,runtime=self.runtime_consumer()
        with patch.object(module,'load_module',return_value=R),patch.object(module,'read_json',side_effect=self.read):
            proof=runtime.failed_prepare_repair(self.state)
            self.assertEqual(proof['preparedState'],self.state)
            self.files.pop(R.JOURNAL+'/verified.json')
            with self.assertRaises(FileNotFoundError):runtime.failed_prepare_repair(self.state)
    def test_native_runtime_installer_window_is_not_descendant_bypass(self):
        from unittest.mock import patch
        module,runtime=self.runtime_consumer();runtime.verify_prepare_repair=True
        self.files.pop(R.JOURNAL+'/verified.json')
        with patch.object(module,'load_module',return_value=R),patch.object(module,'read_json',side_effect=self.read):
            self.assertTrue(runtime.failed_prepare_repair(self.state))
            state=copy.deepcopy(self.state);state['revision']=288
            with self.assertRaises(FileNotFoundError):runtime.failed_prepare_repair(state)
    def test_native_runtime_keeps_original_failure_uncompleted(self):
        from unittest.mock import patch
        module,runtime=self.runtime_consumer()
        with patch.object(module,'load_module',return_value=R),patch.object(module,'read_json',side_effect=self.read):
            proof=runtime.failed_prepare_repair(self.state)
            self.assertEqual(proof['sealedPhaseIntent'],R.PIN['phaseIntent'])
            self.assertEqual(proof['priorState']['activePhase']['operation'],'prepare-cycle')
            self.assertEqual(proof['preparedState']['lastCompleted'],proof['priorState']['lastCompleted'])
            self.assertFalse(self.done['retentionComplete'])
    def test_driver_prepared_state_matches_verifier_contract(self):
        spec=importlib.util.spec_from_file_location('repair_driver_integration',Path(__file__).with_name('reconcile_failed_prepare.py'))
        driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
        driver.PIN=R.PIN
        actual=driver.prepared_state(self.plan)
        self.assertEqual(actual,self.intent['stateTemplate'])
        self.assertEqual(actual['pending']['token'],R.pending_token(self.config_sha,self.plan['ordinaryPlan'],self.plan['before']['context']))
        self.assertTrue(self.verify())
    def test_rehashed_modified_template_refuses(self):
        self.intent['stateTemplate']['lastCompleted']={'cycleId':'forged-complete'};self.reseal()
        with self.assertRaisesRegex(ValueError,'template'):self.verify()
    def test_rehashed_config_expansion_refuses(self):
        self.config['retentionPolicy']={'unsafe':True};self.reseal()
        with self.assertRaisesRegex(ValueError,'config expands'):self.verify()
    def test_rehashed_token_change_refuses(self):
        self.intent['stateTemplate']['pending']['token']='0'*64;self.reseal()
        with self.assertRaisesRegex(ValueError,'template'):self.verify()
    def test_rehashed_expanded_retirement_refuses(self):
        ordinary=self.files[R.JOURNAL+'/ordinary-plan.json']
        ordinary['delete'].append({'path':'/must-not-delete'})
        self.plan['ordinaryPlan']['sha256']=R.sha(R.encoded(ordinary));self.reseal()
        with self.assertRaisesRegex(ValueError,'ordinary plan'):self.verify()
    def test_rehashed_forecast_override_refuses(self):
        ordinary=self.files[R.JOURNAL+'/ordinary-plan.json']
        ordinary['privateStageRetention']['forecast']=dict(ordinary['privateStageRetention']['forecast'],stateSha256='0'*64)
        self.plan['ordinaryPlan']['sha256']=R.sha(R.encoded(ordinary));self.reseal()
        with self.assertRaisesRegex(ValueError,'forecast'):self.verify()
    def test_ancestor_seal_cannot_be_skipped(self):
        self.files.pop(R.JOURNAL+'/verified.json')
        state=copy.deepcopy(self.state);state.update(revision=300,configSha256='8'*64)
        with self.assertRaises(FileNotFoundError):R.verify_marker(state,self.read,verify_seal=False)
    def test_postinitial_same_config_seal_cannot_be_skipped(self):
        self.files.pop(R.JOURNAL+'/verified.json')
        state=copy.deepcopy(self.state);state.update(revision=290)
        with self.assertRaises(FileNotFoundError):R.verify_marker(state,self.read,verify_seal=False)
    def test_valid_exact_edge_is_prepared_not_complete(self):
        proof=self.verify();self.assertEqual(proof['priorState']['revision'],285)
        self.assertEqual(proof['preparedState'],self.state)
        self.assertFalse(proof['preparedState']['status']=='complete')
        self.assertEqual(proof['sealedPhaseIntent'],R.PIN['phaseIntent'])
    def test_missing_any_required_evidence_refuses(self):
        for path in tuple(self.files):
            value=self.files.pop(path)
            with self.subTest(path=path),self.assertRaises((ValueError,FileNotFoundError)):self.verify()
            self.files[path]=value
    def test_marker_namespace_and_hash_refuse(self):
        for key,value in [('intentPath','/wrong'),('completionPath','/wrong'),('intentSha256','0'*64)]:
            state=copy.deepcopy(self.state);state['lastFailedPreparationRepair'][key]=value
            with self.subTest(key=key),self.assertRaises((ValueError,FileNotFoundError)):self.verify(state)
    def test_fake_original_completion_or_plan_refuses(self):
        for suffix in ('-completed.json','-ordinary-plan.json'):
            path=R.BASE+'/ui-lifecycle-release-'+R.RELEASE+suffix;self.files[path]={}
            with self.assertRaises(ValueError):self.verify()
            del self.files[path]
    def test_terminal_must_not_claim_deletion_publication_or_completion(self):
        for key in ('deletionPerformed','publicationPerformed','retentionComplete'):
            self.done[key]=True
            with self.subTest(key=key),self.assertRaises(ValueError):self.verify()
            self.done[key]=False
    def test_terminal_must_preserve_original_evidence(self):
        self.done['originalPhaseEvidencePreserved']=False
        with self.assertRaises(ValueError):self.verify()
    def test_prepared_state_any_tamper_refuses(self):
        for key,value in [('index',{}),('lastIntent',{}),('lastUpgrade',{'x':1}),('status','complete'),('revision',288)]:
            state=copy.deepcopy(self.state);state[key]=value
            if key=='revision':state['lastPayloadRetirement']={}
            with self.subTest(key=key),self.assertRaises(ValueError):self.verify(state)
    def test_token_change_refuses(self):
        state=copy.deepcopy(self.state);state['pending']['token']='0'*64
        with self.assertRaises(ValueError):self.verify(state)
    def test_config_mismatch_refuses(self):
        config=copy.deepcopy(self.config);config['retentionPolicy']={'unsafe':True}
        with self.assertRaises(ValueError):R.verify_edge(self.state,self.config_sha,config,self.read)
    def test_original_state_tamper_refuses(self):
        self.files[R.JOURNAL+'/prior-state.json']['revision']=286
        with self.assertRaises(ValueError):self.verify()
    def test_original_phase_tamper_refuses(self):
        self.files[R.PIN['phaseIntent']['path']]['operation']='apply-vps-retention'
        with self.assertRaises(ValueError):self.verify()
    def test_plan_tamper_refuses(self):
        self.plan['ordinaryPlan']['path']='/wrong'
        with self.assertRaises(ValueError):self.verify()
    def test_seal_is_required_except_internal_verification_window(self):
        self.files.pop(R.JOURNAL+'/verified.json')
        with self.assertRaises(FileNotFoundError):self.verify()
        self.assertTrue(self.verify(verify_seal=False))
    def test_later_descendant_marker_retains_historical_proof(self):
        state=copy.deepcopy(self.state);state.update(revision=300,status='complete',pending=None)
        self.assertTrue(R.verify_marker(state,self.read))
        self.assertTrue(self.verify(state))
    def test_later_config_not_authorized_by_marker_alone(self):
        state=copy.deepcopy(self.state);state.update(revision=300,configSha256='8'*64)
        self.assertIsNone(R.verify_edge(state,'8'*64,{},self.read))
        self.assertTrue(R.verify_marker(state,self.read))
    def test_absent_marker_does_not_create_authority(self):
        self.assertIsNone(R.verify_edge({},'8'*64,{},self.read))
    def test_missing_current_marker_cannot_match_repaired_revision(self):
        state=copy.deepcopy(self.state);del state['lastFailedPreparationRepair']
        self.assertIsNone(R.verify_edge(state,self.config_sha,self.config,self.read))
    def test_reader_must_return_requested_digest(self):
        def bad(path,expected=None):
            value,digest=self.read(path,expected)
            if expected:digest='0'*64
            return value,digest
        with self.assertRaises(ValueError):R.verify_marker(self.state,bad)
    def test_reader_preserves_noncanonical_original_bytes(self):
        import json
        original=self.plan['ordinaryPlan']['path']
        value=self.files[original]
        raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
        digest=R.sha(raw)
        self.plan['ordinaryPlan']['sha256']=digest
        self.intent['stateTemplate']['pending']['token']=R.pending_token(self.config_sha,self.plan['ordinaryPlan'],self.plan['before']['context'])
        self.reseal()
        def reader(path,expected=None):
            if path==original:
                if expected!=digest:raise ValueError('raw digest mismatch')
                return copy.deepcopy(value),digest
            return self.read(path,expected)
        self.assertTrue(R.verify_marker(self.state,reader))

if __name__=='__main__':unittest.main()
