#!/usr/bin/env python3
"""Real native failed-prepare -> repaired -> guarded apply -> complete fixture.
Synthetic namespaces/config pins, stock filesystem policy/storage transitions.
Historical bulk-retirement authority chain is NOT represented by this fixture.
"""
import base64, copy, importlib.util, os, types, contextlib
from pathlib import Path
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
N=load('repair_native_fixtures',HERE/'check-lifecycle-remote.test.py')
H=load('repair_native_helper',HERE/'failed_prepare_repair.py')
D=load('reader_native_driver',HERE/'reconcile_failed_prepare.py')
R=N.R;S=N.F.S
class PreparedReaderNativeTests(unittest.TestCase):
    def test_unsealed_r2_reader_successor_native_apply_complete(self):
        t=N.RemoteTests();t.setUp();self.addCleanup(t.doCleanups);self.addCleanup(t.tearDown)
        runtime=t.runtime;layout=t.layout
        config=t.config;pkg=str(layout.evidence/'ui-lifecycle-tools-')+'b'*64
        config.update(package={'path':pkg,'sha256':'b'*64},sourceCommit='c'*40,sourceTree='d'*40,
                      retentionPolicy=R.VPS_POLICY,offHostCustodyRoot=None)
        config['approval']={'path':pkg+'/audits/2026-10-16-ui-retention-repair-approval.json','sha256':R.APPROVAL_SHA}
        config['controller']={'path':pkg+'/deploy/ui-retention/lifecycle_remote.py','sha256':'e'*64}
        runtime.config_sha=R.sha(R.encoded(config))
        t.vps_complete()
        prior,_=runtime.state();prior['revision']=284
        runtime.state_path.write_bytes(R.encoded(prior))
        release='bbbbbb000004-20261017T040001Z'
        forecast=runtime.dispatch('status',{'requireComplete':True,'prospectiveRelease':release})['privateStageRetention']
        frozen_forecast=copy.deepcopy(forecast)
        approved_fixture_forecasts=[frozen_forecast]
        policy_pin=patch.object(S,'reviewed_forecast',side_effect=lambda value:value in approved_fixture_forecasts)
        policy_pin.start();self.addCleanup(policy_pin.stop)
        t.fixture.publish_policy_fixture(release,S.V5_SURFACES,'proofofwork-ui-release-v5')
        # Add an actual historical citation before recording live protected context.
        source=layout.scratch/('proofofwork-ui-source-'+release)
        doc=source/'audits'/'release.md';doc.parent.mkdir();doc.write_text('Historical archive: '+forecast['wouldRetire'][0]+'\n')
        https,original_pub,context=t.https()
        terminal,_=R.read_json(original_pub['path'],original_pub['sha256'])
        attempt='repaired-fixture';folder=layout.scratch/('recovery-publish-'+release+'-'+attempt);folder.mkdir()
        native=dict(releaseId=release,publicationAttempt=attempt,commit=terminal['commit'],tree=terminal['tree'],
                    inputCompactor={'sha256':'1'*64},closedArchive={'privateStaging':{'model':'private-release-stage-v1'}},
                    privateStageRetention=forecast,retentionLifecycle={'config':{'sha256':runtime.config_sha}})
        native_binding=R.write_new(layout.scratch/('recovery-plan-'+release+'-'+attempt+'.json'),R.encoded(native))
        identity=dict(terminal,attempt=attempt,planSha256=native_binding['sha256'])
        R.write_new(folder/'intent.json',R.encoded(identity))
        publication=R.write_new(folder/'receipt.json',R.encoded(dict(identity,privateStageRetention=forecast)))
        frame={'operationId':'release-'+release,'expectedStateSha256':R.sha(R.encoded(prior)),
               'expectedPair':context['pair'],'httpsReceipt':N.envelope(https),'publicationReceipt':publication}
        with patch.object(S,'create_plan',side_effect=ValueError('injected failed preparation')):
            with self.assertRaisesRegex(ValueError,'injected'):runtime.dispatch('prepare-cycle',frame)
        failed,failed_sha=runtime.state();self.assertEqual(failed['revision'],285);self.assertIsNone(failed['pending'])
        prefix=layout.evidence/('ui-lifecycle-release-'+release)
        def binding(path):return {'path':str(path),'sha256':R.sha(Path(path).read_bytes())}
        index=binding(layout.evidence/('audit30-policy-admission-index-release-'+release+'.json'))
        admission=binding(layout.evidence/('audit30-policy-admission-release-'+release+'.json'))
        scope=runtime.policy_scope(index)
        targets=[row['path'] for row in scope['eligible']]
        self.assertEqual(sorted(targets),forecast['wouldRetire']);self.assertEqual(len(targets),4)
        t.fixture.auth=R.APPROVAL_SHA
        review=t.fixture.citation_manifest('future-retention',targets,[(source,'audits/release.md')])
        with patch.object(S,'git_document_blob',side_effect=t.fixture.fake_blob):
            ordinary=S.create_plan(layout,'future-retention',R.APPROVAL_SHA,scope,citation_review=review)
            ordinary['privateStageRetention']=runtime.private_stage_rule(publication)
            S.validate_plan(ordinary,layout,'future-retention',R.APPROVAL_SHA);S.verify_plan(ordinary,layout)
            journal=layout.evidence/('ui-lifecycle-failed-prepare-'+release);journal.mkdir()
            original_globals={k:getattr(H,k) for k in ('BASE','RELEASE','JOURNAL','CYCLE','CONFIG_PATH','STATE_PATH','PIN','READER_JOURNAL','READER_PRIOR')}
            self.addCleanup(lambda:[setattr(H,k,v) for k,v in original_globals.items()])
            H.BASE=str(layout.evidence);H.RELEASE=release;H.JOURNAL=str(journal);H.CYCLE='repair-'+release
            H.STATE_PATH=str(runtime.state_path);H.CONFIG_PATH=str(t.state/'config.json')
            H.PIN={'release':release,'state':failed_sha,'config':runtime.config_sha,'priorState':R.sha(R.encoded(prior)),
                   'phaseIntent':failed['activePhase']['intent'],'httpsReceipt':binding(str(prefix)+'-https.json'),
                   'admission':admission,'index':index,'pair':context['pair'],'manifest':context['manifests']['current'],
                   'outgoing':sorted(targets)}
            R.write_new(journal/'prior-state.json',R.encoded(failed));R.write_new(journal/'prior-config.json',R.encoded(config))
            ordinary_binding=R.write_new(journal/'ordinary-plan.json',S.encoded(ordinary))
            newconfig=copy.deepcopy(config);newpkg=str(layout.evidence/'ui-lifecycle-tools-')+'f'*64
            newconfig.update(package={'path':newpkg,'sha256':'f'*64},sourceCommit='1'*40,sourceTree='2'*40,
                controller={'path':newpkg+'/deploy/ui-retention/lifecycle_remote.py','sha256':'3'*64},
                approval={'path':newpkg+'/audits/2026-10-16-ui-retention-repair-approval.json','sha256':R.APPROVAL_SHA})
            # Actual seventeen-source payload. Only the three authorized old
            # entries use synthetic R2 bytes; R3 imports remain real source.
            self.assertTrue(all((HERE.parent.parent/name).is_file() for name in D.I.FILES))
            source_bytes={name:(HERE.parent.parent/name).read_bytes() for name in D.I.FILES}
            package_files=dict(source_bytes)
            for name in H.READER_CHANGED_FILES:package_files[name]=b'# synthetic prior R2 source\n'
            manifest={'sourceCommit':newconfig['sourceCommit'],'sourceTree':newconfig['sourceTree'],
                'files':{name:{'bytes':len(raw),'sha256':R.sha(raw)} for name,raw in package_files.items()}}
            package_sha=R.sha(R.encoded(manifest));newpkg=str(layout.evidence/'ui-lifecycle-tools-')+package_sha
            newconfig.update(package={'path':newpkg,'sha256':package_sha},
                controller={'path':newpkg+'/deploy/ui-retention/lifecycle_remote.py','sha256':'3'*64},
                approval={'path':newpkg+'/audits/2026-10-16-ui-retention-repair-approval.json','sha256':R.APPROVAL_SHA})
            Path(newpkg).mkdir();R.write_new(Path(newpkg)/'package.json',R.encoded(manifest))
            newsha=R.sha(R.encoded(newconfig))
            before={'state':failed,'stateSha256':failed_sha,'context':context,'index':index,'httpsReceipt':H.PIN['httpsReceipt'],'publication':publication}
            plan={'schema':'pow-ui-failed-prepare-repair-plan-v1','authority':H.PIN,'before':before,
                  'ordinaryPlan':ordinary_binding,'ordinaryPlanValue':ordinary,'payload':{'config':newconfig,'configSha256':newsha}}
            marker={'intentPath':str(journal/'intent.json'),'completionPath':str(journal/'repaired.json')}
            pending={'cycleId':H.CYCLE,'token':H.pending_token(newsha,ordinary_binding,context),'stage':'prepared',
                'context':context,'ordinaryPlan':ordinary_binding,'httpsReceipt':H.PIN['httpsReceipt'],'publicationReceipt':publication,'index':index}
            template=dict(failed,configSha256=newsha,revision=287,pending=pending,activePhase=None,index=index,lastUpgrade={},lastFailedPreparationRepair=marker)
            intent={'schema':'pow-ui-failed-prepare-repair-intent-v1','authority':H.PIN,'plan':plan,'stateTemplate':template,'stateTemplateSha256':R.sha(R.encoded(template))}
            intent_binding=R.write_new(journal/'intent.json',R.encoded(intent))
            state=dict(template,lastFailedPreparationRepair=dict(marker,intentSha256=intent_binding['sha256']))
            done={'schema':'pow-ui-failed-prepare-repaired-v1','ok':True,'intent':intent_binding,
                'config':{'path':H.CONFIG_PATH,'sha256':newsha},'state':{'path':H.STATE_PATH,'sha256':R.sha(R.encoded(state))},
                'stateRevision':287,'prepared':True,'retentionComplete':False,'deletionPerformed':False,'publicationPerformed':False,'originalPhaseEvidencePreserved':True}
            done_binding=R.write_new(journal/'repaired.json',R.encoded(done))
            # Exactly the failed R2 post-switch point: installed prepared287,
            # genuine original proof, but NO old status seal.
            prior287=copy.deepcopy(state);oldconfig=copy.deepcopy(newconfig)
            oldsha=newsha;old_done=done;old_marker=copy.deepcopy(state['lastFailedPreparationRepair'])
            reader_journal=layout.evidence/('ui-lifecycle-prepared-reader-repair-'+release)
            H.READER_JOURNAL=str(reader_journal)
            H.READER_PRIOR={'state':R.sha(R.encoded(prior287)),'config':oldsha,'intent':intent_binding['sha256'],
                'repaired':done_binding['sha256'],'ordinaryPlan':ordinary_binding['sha256'],'package':package_sha}
            successor_files=dict(source_bytes)
            newmanifest={'sourceCommit':'4'*40,'sourceTree':'5'*40,
                'files':{name:{'bytes':len(raw),'sha256':R.sha(raw)} for name,raw in successor_files.items()}}
            newpackage_sha=R.sha(R.encoded(newmanifest));newpkg=str(layout.evidence/'ui-lifecycle-tools-')+newpackage_sha
            newconfig=copy.deepcopy(oldconfig);newconfig.update(package={'path':newpkg,'sha256':newpackage_sha},
                sourceCommit='4'*40,sourceTree='5'*40,
                controller={'path':newpkg+'/deploy/ui-retention/lifecycle_remote.py','sha256':'3'*64},
                approval={'path':newpkg+'/audits/2026-10-16-ui-retention-repair-approval.json','sha256':R.APPROVAL_SHA})
            newsha=R.sha(R.encoded(newconfig))
            reader_payload={'config':newconfig,'configSha256':newsha,'manifest':newmanifest,
                'files':{name:dict(newmanifest['files'][name],base64=base64.b64encode(raw).decode()) for name,raw in successor_files.items()}}
            runtime.state_path.write_bytes(R.encoded(prior287));runtime.config=oldconfig;runtime.config_sha=oldsha
            Path(H.CONFIG_PATH).write_bytes(R.encoded(oldconfig));Path(H.CONFIG_PATH).chmod(0o600)
            before_reader={'state':prior287,'context':context,'ordinaryPlan':ordinary_binding,
                'stateBase64':base64.b64encode(R.encoded(prior287)).decode(),
                'configBase64':base64.b64encode(R.encoded(oldconfig)).decode(),
                'guards':{'existingPackages':[]},'evidence':D.I.evidence_inventory(layout.evidence)}
            reader_plan={'schema':'pow-ui-prepared-reader-repair-plan-v1','authority':H.READER_PRIOR,
                'payload':reader_payload,'before':before_reader,'reconcilerSha256':R.sha(Path(D.__file__).read_bytes())}
            real_load=R.load_module
            def loader(name,path,*args,**kwargs):
                return H if Path(path).name=='failed_prepare_repair.py' else real_load(name,path,*args,**kwargs)
            with patch.object(R,'load_module',side_effect=loader):
                # Genuine driver writes/CAS and actual installed Runtime
                # consumer checks; host qualification/root identity are fixture
                # boundaries, never marker/state/status verification stubs.
                def existing(config_sha):
                    cfg,_=R.read_json(H.CONFIG_PATH,config_sha)
                    runtime.config=cfg;runtime.config_sha=config_sha
                    return runtime
                def qualify(*args):
                    if reader_journal.exists():raise ValueError('reader journal exists')
                    return copy.deepcopy(before_reader),runtime,ordinary
                with contextlib.ExitStack() as stack:
                    for obj,key,value in [
                        (D,'F',H),(D,'PIN',H.PIN),(D,'JOURNAL',journal),(D,'READER_JOURNAL',reader_journal),
                        (D,'os',types.SimpleNamespace(geteuid=lambda:0,path=os.path,close=os.close,replace=os.replace)),
                        (D.I,'CONFIG',H.CONFIG_PATH),(D.I,'STATE',H.STATE_PATH),(D.I,'EVIDENCE',str(layout.evidence)),
                        (D.I,'existing_runtime',existing),(D,'reader_qualified',qualify),
                        (D.I,'guard_inventory',lambda:{'existingPackages':[Path(newpkg).name] if Path(newpkg).exists() else []})]:
                        stack.enter_context(patch.object(obj,key,value))
                    done=D.apply_reader_plan(reader_plan)
                    state=runtime.state()[0]
                    self.assertEqual(state['revision'],288)
                    self.assertEqual(state['pending'],prior287['pending'])
                    self.assertEqual(state['lastFailedPreparationRepair'],old_marker)
                    with self.assertRaises(ValueError):D.apply_reader_plan(reader_plan)
                # Package bytes were actually written, and the real controller
                # is importable from that successor package (no live execution).
                self.assertEqual(len(reader_payload['files']),17)
                for name,record in reader_payload['files'].items():
                    self.assertEqual(R.sha((Path(newpkg)/name).read_bytes()),record['sha256'])
                imported=load('reader_installed_package_runtime',Path(newpkg)/'deploy/ui-retention/lifecycle_remote.py')
                self.assertTrue(callable(imported.Runtime.state))
                self.assertFalse((journal/'verified.json').exists())
                self.assertEqual(runtime.state()[0],state)
                self.assertFalse(runtime.dispatch('status',{})['retentionComplete'])
                self.assertEqual(runtime.unfinished_intents(),[])
                self.assertTrue(all(Path(p).exists() for p in targets))
                seal_path=reader_journal/'verified.json';seal_raw=seal_path.read_bytes();seal_path.unlink()
                with self.assertRaises(FileNotFoundError):runtime.dispatch('status',{})
                R.write_new(seal_path,seal_raw)
                forged=Path(str(prefix)+'-completed.json');R.write_new(forged,R.encoded({'ok':True}))
                with self.assertRaisesRegex(ValueError,'fabricated'):runtime.dispatch('status',{})
                forged.unlink()
                self.assertTrue(all(Path(p).exists() for p in targets))
                applied=runtime.dispatch('apply-vps-retention',{'operationId':'ordinary-'+H.CYCLE,'cycleId':H.CYCLE,
                    'pendingToken':pending['token'],'expectedStateSha256':done['state']['sha256'],'expectedPair':context['pair']})
                completed=runtime.dispatch('complete-vps-cycle',{'operationId':'complete-'+H.CYCLE,'cycleId':H.CYCLE,
                    'pendingToken':pending['token'],'expectedStateSha256':applied['stateSha256'],'expectedPair':context['pair']})
                self.assertTrue(completed['retentionComplete']);self.assertTrue(runtime.dispatch('status',{'requireComplete':True})['retentionComplete'])
                self.assertFalse((journal/'verified.json').exists())
                final,_=runtime.state();self.assertEqual(final.get('lastPayloadRetirement'),failed.get('lastPayloadRetirement'))
                self.assertTrue(all(not Path(p).exists() for p in targets))
                self.assertEqual(final['lastFailedPreparationRepair'],state['lastFailedPreparationRepair'])
                # A later normal cycle must treat the repaired C context as
                # immutable history, not require it to remain the live pair.
                successor='bbbbbb000005-20261018T040001Z'
                next_forecast=runtime.dispatch('status',{'requireComplete':True,'prospectiveRelease':successor})['privateStageRetention']
                next_targets=next_forecast['wouldRetire']
                self.assertEqual(len(next_targets),4)
                self.assertTrue(set(next_targets).isdisjoint(targets))
                self.assertTrue(all(Path(p).exists() for p in next_targets))
                next_before={p:S.snapshot(Path(p))['sha256'] for p in next_targets}
                prior_intent_raw=Path(H.PIN['phaseIntent']['path']).read_bytes()
                repair_journal_raw={p.name:p.read_bytes() for p in journal.iterdir()}
                approved_fixture_forecasts.append(copy.deepcopy(next_forecast))
                t.fixture.publish_policy_fixture(successor,S.V5_SURFACES,'proofofwork-ui-release-v5')
                self.assertEqual({p:S.snapshot(Path(p))['sha256'] for p in next_targets},next_before)
                next_https,next_original_pub,next_context=t.https()
                next_terminal,_=R.read_json(next_original_pub['path'],next_original_pub['sha256'])
                next_attempt='normal-after-repair';next_folder=layout.scratch/('recovery-publish-'+successor+'-'+next_attempt);next_folder.mkdir()
                next_native=dict(releaseId=successor,publicationAttempt=next_attempt,commit=next_terminal['commit'],tree=next_terminal['tree'],
                    inputCompactor={'sha256':'1'*64},closedArchive={'privateStaging':{'model':'private-release-stage-v1'}},
                    privateStageRetention=next_forecast,retentionLifecycle={'config':{'sha256':newsha}})
                next_plan_binding=R.write_new(layout.scratch/('recovery-plan-'+successor+'-'+next_attempt+'.json'),R.encoded(next_native))
                next_identity=dict(next_terminal,attempt=next_attempt,planSha256=next_plan_binding['sha256'])
                R.write_new(next_folder/'intent.json',R.encoded(next_identity))
                next_publication=R.write_new(next_folder/'receipt.json',R.encoded(dict(next_identity,privateStageRetention=next_forecast)))
                next_prepared=runtime.dispatch('prepare-cycle',{'operationId':'release-'+successor,
                    'expectedStateSha256':runtime.state()[1],'expectedPair':next_context['pair'],
                    'httpsReceipt':N.envelope(next_https),'publicationReceipt':next_publication})
                self.assertEqual(next_context['pair'],{'current':successor,'previous':release})
                self.assertFalse(runtime.dispatch('status',{})['retentionComplete'])
                self.assertTrue(all(Path(p).exists() for p in next_targets))
                next_frame={'operationId':'ordinary-'+successor,'cycleId':next_prepared['cycleId'],
                    'pendingToken':next_prepared['pendingToken'],'expectedStateSha256':next_prepared['stateSha256'],'expectedPair':next_context['pair']}
                next_applied=runtime.dispatch('apply-vps-retention',next_frame)
                next_completed=runtime.dispatch('complete-vps-cycle',dict(next_frame,operationId='complete-'+successor,
                    expectedStateSha256=next_applied['stateSha256']))
                self.assertTrue(next_completed['retentionComplete'])
                next_status=runtime.dispatch('status',{'requireComplete':True})
                self.assertEqual(next_status['pair'],next_context['pair']);self.assertTrue(next_status['retentionComplete'])
                next_state,_=runtime.state()
                self.assertEqual(next_state['lastPreparedReaderRepair'],state['lastPreparedReaderRepair'])
                self.assertFalse((journal/'verified.json').exists())
                self.assertEqual(next_state['lastFailedPreparationRepair'],state['lastFailedPreparationRepair'])
                self.assertEqual(next_state.get('lastPayloadRetirement'),failed.get('lastPayloadRetirement'))
                self.assertTrue(all(not Path(p).exists() for p in next_targets))
                self.assertEqual(Path(H.PIN['phaseIntent']['path']).read_bytes(),prior_intent_raw)
                self.assertEqual({p.name:p.read_bytes() for p in journal.iterdir()},repair_journal_raw)
                self.assertEqual(runtime.unfinished_intents(),[])
            for suffix in ('-ordinary-plan.json','-completed.json'):self.assertFalse(Path(str(prefix)+suffix).exists())
            self.assertEqual(R.read_json(H.PIN['phaseIntent']['path'],H.PIN['phaseIntent']['sha256'])[0]['operation'],'prepare-cycle')
if __name__=='__main__':unittest.main()
