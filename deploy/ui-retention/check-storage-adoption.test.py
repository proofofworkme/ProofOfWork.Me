#!/usr/bin/env python3
"""Adoption evidence, exact intent sealing, and no-replay/crash fences."""
import ast
import copy
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
R=load('adoption_test_runtime',HERE/'lifecycle_remote.py')
A=load('adoption_test_controller',HERE/'reconcile_storage_completion.py')
I=A.I

class AdoptionTests(unittest.TestCase):
    def setUp(self):
        self.mask=os.umask(0o077);self.addCleanup(os.umask,self.mask)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.evidence=self.base/'evidence';self.evidence.mkdir()
        self.pin=copy.deepcopy(R.STORAGE_COMPLETION_ADOPTION)
        self.state_path=self.base/'state.json'
        self.journal=self.evidence/('ui-lifecycle-storage-adoption-'+self.pin['release']);self.journal.mkdir()
        for key in ('phaseIntent','ordinaryPlan','completion','storageIntent','index','publication'):
            path=self.evidence/('ui-lifecycle-original-intent.json' if key=='phaseIntent' else key+'.json');raw=R.encoded({'test':key});path.write_bytes(raw)
            self.pin[key]={'path':str(path),'sha256':R.sha(raw)}
        prior={'revision':220,'lastIntent':self.pin['phaseIntent'],'pending':{'stage':'applying'},
               'lastUpgrade':{'historical':'immutable'}}
        raw=R.encoded(prior);(self.journal/'prior-state.json').write_bytes(raw);self.pin['state']=R.sha(raw)
        raw=b'{"priorConfig":true}\n';(self.journal/'prior-config.json').write_bytes(raw);self.pin['config']=R.sha(raw)
        self.patcher=patch.object(R,'STORAGE_COMPLETION_ADOPTION',self.pin);self.patcher.start();self.addCleanup(self.patcher.stop)
        ad={'intentPath':str(self.journal/'intent.json'),'completionPath':str(self.journal/'adopted.json')}
        config_sha='a'*64
        self.template={'schema':'pow-ui-retention-lifecycle-state-v1','revision':222,
            'configSha256':config_sha,'status':'complete','pending':None,'activePhase':None,'lastUpgrade':{},
            'lastIntent':prior['lastIntent'],'lastStorageAdoption':ad,'index':self.pin['index'],
            'completedContext':{'guard':'verified'},'lastCompleted':{
                'cycleId':'release-'+self.pin['release'],'retentionPolicy':R.VPS_POLICY,
                'retainedPair':self.pin['pair'],'ordinaryPlan':self.pin['ordinaryPlan'],'ordinaryReceipt':self.pin['completion']}}
        intent={'schema':'pow-ui-storage-completion-adoption-intent-v1',
                'disposition':'completed-storage-adopted-without-replay','deletionAllowed':False,'publicationAllowed':False,
                'plan':{'schema':'pow-ui-storage-completion-adoption-plan-v1','authority':self.pin,
                        'payload':{'configSha256':config_sha}},
                'stateTemplate':self.template,'stateTemplateSha256':R.sha(R.encoded(self.template))}
        raw=R.encoded(intent);(self.journal/'intent.json').write_bytes(raw);intent_sha=R.sha(raw)
        self.state=dict(self.template,lastStorageAdoption=dict(ad,intentSha256=intent_sha))
        self.done={'schema':'pow-ui-storage-completion-adopted-v1','ok':True,'authority':self.pin,
            'deletionPerformed':False,'publicationPerformed':False,'originalPhaseEvidencePreserved':True,'retentionComplete':True,
            'intent':{'path':ad['intentPath'],'sha256':intent_sha},
            'state':{'path':str(self.state_path),'sha256':R.sha(R.encoded(self.state))},
            'config':{'path':str(R.CONFIG_PATH),'sha256':config_sha},'stateRevision':222}
        raw=R.encoded(self.done);(self.journal/'adopted.json').write_bytes(raw)
        self.verified={'schema':'pow-ui-storage-adoption-verified-v1',
            'adoptionReceipt':{'path':ad['completionPath'],'sha256':R.sha(raw)},
            'state':self.done['state'],'config':self.done['config'],
            'contextSha256':R.sha(R.encoded(self.template['completedContext']))}
        (self.journal/'verified.json').write_bytes(R.encoded(self.verified))
        self.state_path.write_bytes(R.encoded(self.state))
        self.runtime=R.Runtime({'statePath':str(self.state_path)},config_sha,None,None,layout=types.SimpleNamespace(evidence=self.evidence))

    def test_authenticates_new_terminal_without_original_completion(self):
        self.assertEqual(self.runtime.state()[0],self.state)
        self.assertEqual(self.runtime.storage_adoption(self.state)['sealedPhaseIntent'],self.pin['phaseIntent'])
        self.assertEqual(json.loads((self.journal/'prior-state.json').read_bytes())['lastUpgrade'],{'historical':'immutable'})

    def test_missing_or_forged_terminal_and_verified_refuse(self):
        for name in ('adopted.json','verified.json'):
            path=self.journal/name;raw=path.read_bytes()
            with self.subTest(name=name):
                path.rename(path.with_suffix('.saved'))
                with self.assertRaises(FileNotFoundError):self.runtime.state()
                path.with_suffix('.saved').rename(path)
                path.write_bytes(b'{}')
                with self.assertRaises((ValueError,KeyError)):self.runtime.state()
                path.write_bytes(raw)

    def test_changed_each_pinned_original_proof_refuses(self):
        for key in ('phaseIntent','ordinaryPlan','completion','storageIntent','index','publication'):
            path=Path(self.pin[key]['path']);raw=path.read_bytes();path.write_bytes(b'{}')
            with self.subTest(key=key),self.assertRaises(ValueError):self.runtime.state()
            path.write_bytes(raw)

    def test_namespace_changed_and_fabricated_original_completion_refuse(self):
        altered=copy.deepcopy(self.state);altered['lastStorageAdoption']['completionPath']='/tmp/forged'
        with self.assertRaisesRegex(ValueError,'namespace'):self.runtime.storage_adoption(altered)
        phase=Path(self.pin['phaseIntent']['path'])
        fake=phase.with_name(phase.name.removesuffix('-intent.json')+'-completed.json')
        fake.write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'fabricated'):self.runtime.state()

    def test_initial_state_drift_and_active_adoption_refuse(self):
        changed=dict(self.state,status='retention-incomplete')
        with self.assertRaisesRegex(ValueError,'Initial'):self.runtime.storage_adoption(changed)
        changed=dict(self.state,revision=221)
        with self.assertRaisesRegex(ValueError,'transition'):self.runtime.storage_adoption(changed)

    def test_later_state_keeps_authenticated_adoption(self):
        later=dict(self.state,revision=224,status='retention-incomplete',pending={'newCycle':'valid'})
        self.state_path.write_bytes(R.encoded(later))
        self.assertEqual(self.runtime.state()[0],later)

    def test_only_exact_old_intent_is_sealed(self):
        # Canonical lifecycle names are required for the real enumeration.
        original=Path(self.pin['phaseIntent']['path'])
        lifecycle=self.evidence/'ui-lifecycle-unrelated-intent.json';lifecycle.write_bytes(b'{}')
        self.assertEqual(self.runtime.unfinished_intents(),[str(lifecycle)])
        self.assertTrue(original.exists())

    def test_adoption_bypass_is_internal_and_normal_status_requires_seal(self):
        (self.journal/'verified.json').rename(self.journal/'verified.saved')
        self.runtime.verify_adoption=True
        self.runtime.state()
        self.runtime.verify_adoption=False
        with self.assertRaises(FileNotFoundError):self.runtime.state()
        self.assertNotIn('adopt',R.Runtime.dispatch.__code__.co_consts)

    def test_completed_upgrade_uses_real_adoption_terminal(self):
        request={'stateSha256':R.sha(R.encoded(self.state))}
        status={'stateSha256':request['stateSha256'],'context':self.state['completedContext']}
        with patch.object(self.runtime,'status',return_value=status):
            reviewed=I.completed_review(self.runtime,request)
        self.assertTrue(reviewed['storageCompletionAdopted'])
        self.assertEqual(reviewed['completionReceipt']['path'],str(self.journal/'adopted.json'))
        self.assertEqual(reviewed['state'],self.state)

    def test_published_provenance_never_rewritten_or_delete_dispatched(self):
        tree=ast.parse((HERE/'reconcile_storage_completion.py').read_text())
        calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call)]
        forbidden={'unlink','remove','rmdir','rmtree','execute','dispatch','publish'}
        self.assertFalse([n.func.attr for n in calls if isinstance(n.func,ast.Attribute) and n.func.attr in forbidden])
        text=(HERE/'reconcile_storage_completion.py').read_text()
        self.assertNotIn('retentionLocalSources',text)
        self.assertNotIn('retentionLifecycle',text)

    def test_unknown_writer_still_refused(self):
        p=load('adoption_test_policy',HERE.parent/'audit30/ui-release-policy.py')
        self.assertIn(self.pin['writer'],p.KNOWN_RETIREMENT_CONTROLLERS)
        self.assertNotIn('0'*64,p.KNOWN_RETIREMENT_CONTROLLERS)

    def test_no_runtime_recursion_when_no_adoption(self):
        value=dict(self.state,lastStorageAdoption=None,revision=10)
        self.state_path.write_bytes(R.encoded(value))
        self.assertEqual(self.runtime.unfinished_intents(),[self.pin['phaseIntent']['path']])

class ApplyFenceTests(unittest.TestCase):
    def test_expanded_authority_and_changed_code_refused_before_any_mutation(self):
        with patch.object(A.os,'geteuid',return_value=0):
            for value in ({},{'schema':'pow-ui-storage-completion-adoption-plan-v1','authority':{}}):
                with self.assertRaises(ValueError):A.apply(value)

    def test_existing_journal_refuses_without_loading_runtime(self):
        with patch.object(A.os.path,'lexists',return_value=True),patch.object(A.I,'existing_runtime') as load:
            with self.assertRaisesRegex(ValueError,'Prior adoption'):A.qualify({})
            load.assert_not_called()

    def test_failed_phase_still_running_refuses(self):
        output='MainPID=42\nActiveState=active\nSubState=running\nResult=success\nExecMainStatus=0\n'
        with patch.object(A.subprocess,'check_output',return_value=output):
            with self.assertRaisesRegex(ValueError,'still active'):A.service_stopped()

    def test_source_must_be_committed_identical(self):
        with patch.object(A.subprocess,'check_output',return_value=b'wrong bytes'):
            with self.assertRaisesRegex(ValueError,'committed source'):A.source_payload()


class ApplyCrashTests(unittest.TestCase):
    def fixture(self, base):
        evidence=base/'evidence';evidence.mkdir()
        state_path=base/'state.json';config_path=base/'config.json'
        state={'revision':220,'lastIntent':{'path':'unchanged','sha256':'d'*64},'lastUpgrade':{'old':'preserved'}}
        config={'old':'config'}
        state_path.write_bytes(I.encoded(state));config_path.write_bytes(I.encoded(config))
        pin=copy.deepcopy(A.PIN);pin['state']=I.sha(state_path.read_bytes());pin['config']=I.sha(config_path.read_bytes())
        package=evidence/'ui-lifecycle-tools-new';journal=evidence/'adoption'
        payload={'config':{'package':{'path':str(package),'sha256':'b'*64}},'configSha256':'c'*64,
                 'manifest':{'fixture':True},'files':{'safe.py':{'base64':'cGFzcwo=','sha256':I.sha(b'pass\n'),'bytes':5}}}
        before={'state':state,'stateBase64':__import__('base64').b64encode(state_path.read_bytes()).decode(),
                'configBase64':__import__('base64').b64encode(config_path.read_bytes()).decode(),
                'context':{'guards':{'exact':'guards'}},'lastCompleted':{'existing':'receipt'},
                'guards':{'existingPackages':[]},'evidence':{},'pools':{}}
        def read(path, expected=None):
            raw=Path(path).read_bytes()
            if expected is not None:I.require(I.sha(raw)==expected,'Bound SHA changed')
            return raw
        def qualify(_):
            I.require(not journal.exists(),'Prior adoption requires explicit reconciliation')
            return before
        original=types.SimpleNamespace(capacity=lambda n=None:None)
        runtime=types.SimpleNamespace(layout=None,current=lambda:(None,before['context']),
            verify_vps_completion=lambda *a:None,S=types.SimpleNamespace(compare_guards=lambda *a:None))
        installed=types.SimpleNamespace(status=lambda f:{'stateSha256':I.sha(state_path.read_bytes()),
                                                       'retentionComplete':True,'context':before['context']})
        patches=[patch.object(I,'deploy_lock',side_effect=lambda p:contextlib.nullcontext()),patch.object(A,'PIN',pin),patch.object(A,'JOURNAL',journal),
                 patch.object(I,'STATE',str(state_path)),patch.object(I,'CONFIG',str(config_path)),
                 patch.object(I,'EVIDENCE',str(evidence)),patch.object(I,'safe',side_effect=lambda p,*a:Path(p).lstat()),
                 patch.object(I,'read_bound',side_effect=read),patch.object(I,'validate_payload'),
                 patch.object(I,'existing_runtime',side_effect=[original,installed]),
                 patch.object(I,'guard_inventory',side_effect=lambda:{'existingPackages':[package.name]}),
                 patch.object(I,'evidence_inventory',side_effect=lambda p:{package.name:{},journal.name:{}}),
                 patch.object(A,'qualify',side_effect=qualify),patch.object(A,'new_runtime',return_value=runtime),
                 patch.object(A,'exported_payload',return_value=payload),patch.object(A.os,'geteuid',return_value=0)]
        for p in patches:p.start();self.addCleanup(p.stop)
        plan={'schema':'pow-ui-storage-completion-adoption-plan-v1','authority':pin,
              'reconcilerSha256':I.sha(Path(A.__file__).read_bytes()),'payload':payload,
              'payloadBinding':{},'before':before}
        plan['allocationBytes']=A.allocation_bound(plan)
        return plan,state_path,config_path,journal,state,config

    def test_success_creates_new_adoption_not_old_completion(self):
        with tempfile.TemporaryDirectory() as d:
            plan,state,config,journal,old,_=self.fixture(Path(d))
            result=A.apply(plan)
            self.assertTrue(result['retentionComplete'])
            self.assertFalse(result['deletionPerformed']);self.assertFalse(result['publicationPerformed'])
            self.assertEqual(json.loads((journal/'prior-state.json').read_bytes()),old)
            self.assertTrue((journal/'adopted.json').exists());self.assertTrue((journal/'verified.json').exists())
            self.assertEqual(json.loads(state.read_bytes())['revision'],222)
            with self.assertRaisesRegex(ValueError,'Prior adoption'):A.apply(plan)

    def test_each_rename_interruption_preserves_evidence_and_refuses_replay(self):
        for position in (1,2,3):
            with self.subTest(position=position),tempfile.TemporaryDirectory() as d:
                plan,state,config,journal,old,oldconfig=self.fixture(Path(d))
                replace=os.replace;calls=[]
                def fail(source,dest):
                    calls.append(str(dest))
                    if len(calls)==position:raise OSError('injected crash')
                    return replace(source,dest)
                with patch.object(A.os,'replace',side_effect=fail),self.assertRaisesRegex(OSError,'crash'):A.apply(plan)
                self.assertEqual(json.loads((journal/'prior-state.json').read_bytes()),old)
                self.assertEqual(json.loads((journal/'prior-config.json').read_bytes()),oldconfig)
                self.assertFalse((journal/'adopted.json').exists())
                with self.assertRaisesRegex(ValueError,'Prior adoption'):A.apply(plan)
                patch.stopall()

    def test_failed_terminal_write_never_reports_success(self):
        with tempfile.TemporaryDirectory() as d:
            plan,state,config,journal,old,_=self.fixture(Path(d))
            save=I.save
            def fail(path,raw):
                if path.name=='adopted.json':raise OSError('terminal crash')
                return save(path,raw)
            with patch.object(I,'save',side_effect=fail),self.assertRaisesRegex(OSError,'terminal crash'):A.apply(plan)
            self.assertFalse((journal/'verified.json').exists())
            self.assertEqual(json.loads((journal/'prior-state.json').read_bytes()),old)
            with self.assertRaisesRegex(ValueError,'Prior adoption'):A.apply(plan)


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.mask=os.umask(0o077);self.addCleanup(os.umask,self.mask)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.pin=copy.deepcopy(A.PIN)
        self.context={'pair':self.pin['pair'],'guards':{'exact':'held'},'manifests':{'current':'a','previous':'b'}}
        def save(name,value):
            path=self.base/(name+'.json');raw=I.encoded(value);path.write_bytes(raw)
            return {'path':str(path),'sha256':I.sha(raw)}
        self.save=save
        self.pin['retiredPaths']=[str(self.base/('absent-'+str(i))) for i in range(4)]
        self.plan={'delete':[{'path':p} for p in self.pin['retiredPaths']],'moves':[],
                   'controllerSha256':self.pin['writer']}
        self.pin['ordinaryPlan']=save('ordinary',self.plan)
        si={'plan':self.plan,'planSha256':self.pin['ordinaryPlan']['sha256']}
        self.pin['storageIntent']=save('storage-intent',si)
        self.done={'intentPath':self.pin['storageIntent']['path'],'intentSha256':self.pin['storageIntent']['sha256'],
                   'planSha256':self.pin['ordinaryPlan']['sha256'],'guardBaselinePlanSha256':self.pin['ordinaryPlan']['sha256'],
                   'completed':[{'path':p} for p in self.pin['retiredPaths']]}
        self.pin['completion']=save('done',self.done)
        self.previous={'completedRetirements':[]}
        previous=save('previous',self.previous)
        self.index=dict(self.previous,completedRetirements=[self.pin['completion']])
        self.pin['index']=save('index',self.index)
        intent={'operation':'apply-vps-retention','operationId':'ordinary-'+self.pin['release'],
                'configSha256':'c'*64,'context':self.context,
                'request':{'cycleId':'release-'+self.pin['release'],'pendingToken':'test'}}
        config=self.base/'config.json';config.write_bytes(b'{}');self.pin['config']=I.sha(b'{}')
        intent['configSha256']=self.pin['config']
        self.pin['phaseIntent']=save('phase',intent);self.pin['publication']=save('publication',{'ok':True})
        https=save('https',{'ok':True})
        self.state={'revision':220,'status':'retention-incomplete','activePhase':None,'lastIntent':self.pin['phaseIntent'],
                    'index':previous,'pending':{'stage':'applying','cycleId':'release-'+self.pin['release'],
                    'ordinaryPlan':self.pin['ordinaryPlan'],'token':'test','context':self.context,
                    'publicationReceipt':self.pin['publication'],'httpsReceipt':https}}
        state=save('state',self.state);self.pin['state']=state['sha256']
        self.original=types.SimpleNamespace(state=lambda:(self.state,self.pin['state']),
            config={'retentionPolicy':I.VPS_POLICY,'offHostCustodyRoot':None},
            unfinished_intents=lambda:[self.pin['phaseIntent']['path']])
        self.runtime=types.SimpleNamespace(current=lambda:({},copy.deepcopy(self.context)),layout=None,
            verify_publication=lambda *a:None,verify_vps_completion=lambda *a:{'ok':True},
            P=types.SimpleNamespace(load_index=lambda *a:{'ok':True},
                policy_scope=lambda *a:{'eligible':[],'preservedFallback':{'exact':'c3969'}}),
            S=types.SimpleNamespace(compare_guards=lambda *a:None),capacity=lambda:{'unchanged':True})
        self.patches=[patch.object(A,'PIN',self.pin),patch.object(A,'JOURNAL',self.base/'not-created'),
            patch.object(I,'STATE',state['path']),patch.object(I,'CONFIG',str(config)),
            patch.object(I,'existing_runtime',return_value=self.original),
            patch.object(A,'new_runtime',return_value=self.runtime),patch.object(A,'service_stopped',return_value={'stopped':True}),
            patch.object(I,'guard_inventory',return_value={}),patch.object(I,'evidence_inventory',return_value={})]
        for p in self.patches:p.start();self.addCleanup(p.stop)

    def test_full_qualification_wires_all_native_verifiers(self):
        with patch.object(self.runtime,'verify_publication',wraps=self.runtime.verify_publication) as publication, \
             patch.object(self.runtime,'verify_vps_completion',wraps=self.runtime.verify_vps_completion) as complete, \
             patch.object(self.runtime.P,'load_index',wraps=self.runtime.P.load_index) as index, \
             patch.object(self.runtime.S,'compare_guards',wraps=self.runtime.S.compare_guards) as guards:
            result=A.qualify({})
            for fn in (publication,complete,index,guards):fn.assert_called_once()
            self.assertEqual(result['state'],self.state)

    def test_context_pair_or_guard_drift_refuses(self):
        for changed in ({'pair':{'wrong':'pair'}},{'guards':{'changed':'guard'}},{'manifests':{'changed':'root'}}):
            context=dict(self.context,**changed)
            with patch.object(self.runtime,'current',return_value=({},context)),self.assertRaisesRegex(ValueError,'pair or guards'):
                A.qualify({})

    def test_unrelated_unfinished_phase_refuses(self):
        with patch.object(self.original,'unfinished_intents',return_value=[self.pin['phaseIntent']['path'],'other']), \
             self.assertRaisesRegex(ValueError,'Unrelated'):
            A.qualify({})

    def test_non_single_index_extension_refuses(self):
        self.index['extra']='unapproved'
        self.pin['index'].update(self.save('index',self.index))
        with self.assertRaisesRegex(ValueError,'single exact'):A.qualify({})

    def test_reappeared_retired_file_refuses(self):
        Path(self.pin['retiredPaths'][0]).write_bytes(b'new identity')
        with self.assertRaisesRegex(ValueError,'Retirement outcome'):A.qualify({})

    def test_changed_retired_membership_refuses(self):
        self.done['completed']=self.done['completed'][:3]
        self.pin['completion'].update(self.save('done',self.done))
        with self.assertRaisesRegex(ValueError,'Retirement outcome'):A.qualify({})

    def test_publication_binding_refuses(self):
        self.state['pending']['publicationReceipt']={'path':'wrong','sha256':'a'*64}
        with self.assertRaisesRegex(ValueError,'Publication binding'):A.qualify({})

    def test_eligible_assets_or_missing_fallback_refuses(self):
        for scope in ({'eligible':[{'path':'unexpected'}],'preservedFallback':True},{'eligible':[]}):
            with patch.object(self.runtime.P,'policy_scope',return_value=scope),self.assertRaisesRegex(ValueError,'eligibility or fallback'):
                A.qualify({})

    def test_native_verifier_failure_propagates_without_writes(self):
        with patch.object(self.runtime,'verify_vps_completion',side_effect=ValueError('native refusal')), \
             self.assertRaisesRegex(ValueError,'native refusal'):
            A.qualify({})
        self.assertFalse((self.base/'not-created').exists())

if __name__=='__main__':unittest.main()
