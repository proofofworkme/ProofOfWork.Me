#!/usr/bin/env python3
"""Local filesystem tests; never contact production or invoke services."""
import ast, base64, copy, types, importlib.util, json, os, pathlib, subprocess, tempfile, unittest
from unittest.mock import Mock, MagicMock, patch

spec = importlib.util.spec_from_file_location('work-batch-replay_scoped_node', pathlib.Path(__file__).with_name('scoped-node.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

FIXED_OVERLAY_BASES=dict(module.ACCEPTED_OVERLAY_BASES)

EXEC_START_ACTIVE = ('{ path=/opt/node/bin/node ; argv[]=/opt/node/bin/node server/proof-api.mjs'
    ' ; ignore_errors=no ; start_time=[Sat 2026-10-24 18:44:16 UTC] ; stop_time=[n/a]'
    ' ; pid=3713663 ; code=(null) ; status=0/0 }')

def bind_event_set_fixture(row,derived=0):
    count=row['protocolRecordCount'];events=count+derived
    old={'model':'canonical-work-amo-event-set-sha256-v1','payloadBytes':100,'sha256':'a'*64,'eventCount':events}
    new={**old,'sha256':'b'*64 if derived else old['sha256']}
    scalar={'event_set_sha256':old['sha256'],'event_count':events,
        'protocol_record_count':count,'raw_protocol_candidate_count':row['rawProtocolCandidateCount'],
        'created_at':'2026-10-26T00:00:00Z','credit_supply':'100'}
    row.update(derivedEventCount=derived,eventCount=events,eventSetProvenanceOnly=True,
        oldEventSetCommitment=old,newEventSetCommitment=new,oldScalarMetadata=scalar,
        newScalarMetadata={**scalar,'event_set_sha256':new['sha256']})
    row['oldScalarMetadataSha256']=module.stable_json_sha256(row['oldScalarMetadata'])
    row['newScalarMetadataSha256']=module.stable_json_sha256(row['newScalarMetadata'])
    row['relationalBindings'].update(eventCount=events,recordCount=count)
    row['replacementFields']['eventSetCommitment']=new
    row['allowedChangedFields']=sorted((set(row['allowedChangedFields'])-{'eventSetCommitment'})|
        ({'eventSetCommitment'} if derived else set()))
    return row

def qualification_fixture(m,mode='before-drain',count=1,records=0):
    rows=[]
    for i in range(count):
        n=records if i==0 else 0
        rows.append({'height':973104+i,'hash':f'{973104+i:064x}',
            'oldNativeSha256':'e'*64,'newNativeSha256':'f'*64,
            'oldScalarMetadataSha256':'d'*64,'newScalarMetadataSha256':'d'*64,'currentMainRowSha256':'8'*64,
            'nativePayloadBytes':1000,'oldNativeBytes':1000,'newNativeBytes':1100,'rawBlockBytes':2000,
            'rawProtocolCandidateCount':n,'protocolRecordCount':n,'batchLookingCount':0,
            **{key:True for key in ('baselineExactlyReproduced','compatibilityDeterministic',
                'economicStateEqual','workGenericIdStateEqual','projectionEqual','eventsAndFeesEqual',
                'ordinaryEventSetVerified','ordinaryRecordsVerified','ordinaryDerivedClosuresVerified')},
            'emptyEventSetVerified':n==0,
            'relationalBindings':{'eventCount':n,'recordCount':n,
                'eventRowsSha256':'a'*64,'recordRowsSha256':'b'*64},
            'replacementFields':{'workBatchV1':{'activationHeight':973104},
                'transitionChainCommitment':{'sha256':'c'*64},'replayRecords':[],
                'traces':[],'replayDescriptorCommitment':{'sha256':'d'*64}},
            'allowedChangedFields':['transitionChainCommitment','workBatchV1']})
    for row in rows:bind_event_set_fixture(row)
    through=973103+count;block_hash=rows[-1]['hash']
    value={'format':module.QUALIFICATION_FORMAT,'qualified':True,'readOnly':True,'liveModified':False,
        'mode':mode,'verifierSha256':'9'*64,'sourceState':'committed','sourceCommit':m['sourceCommit'],'sourceTree':m['sourceTree'],
        'runtimeSources':{r['path']:r['after'] for r in m['sources']},
        'sourceManifestSha256':m['replaySourceManifest']['sha256'],'firstPartySourceHashes':{'fixture':'a'*64},
        'nodeSha256':m['nodeSha256'],'declarationTxid':'b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28',
        'declaration':{'height':973103},'anchor':{'height':973103,'closingProjectionSha256':'b'*64},
        'proposedMarker':{'activationHeight':973104},'nativeCatalogSha256':'c'*64,
        'databaseName':'fixture','databaseEndpoint':{'port':55431,'unixSocketDirectories':'/tmp/fixture'},
        'fixedPrefixRemainsCanonical':True,'proposedMarkerPersisted':False,'maxSuffixBlocks':512,
        'resourceLimits':copy.deepcopy(module.REPLAY_RESOURCE_LIMITS),
        **{key:True for key in ('ordinaryRelationalSuffixVerified','fullRawSuffixVerified',
            'ordinaryDerivedClosuresVerified','noBatchLookingRecordsVerified')},
        'resourceUsage':{'nativePayloadBytes':count*1000,'newNativePayloadBytes':count*1100,
            'rawBlockBytes':count*2000,'ordinaryRecords':records},
        'fixedPrefix':{'from':973104,'through':through,'hash':block_hash,'rebuildSha256':'1'*64},
        'checkpoint':{'height':through,'hash':block_hash},
        'canonicalRebuild':{'indexedThroughBlock':through,'indexedThroughBlockHash':block_hash,
            'complete':True,'active':False},
        'blocks':rows}
    return value

def cached_extension(prior,current,prior_sha):
    current['priorManifestSha256']=prior_sha
    current['cacheRevalidation']={'model':'work-batch-qualified-prefix-cache-v1',
        'priorManifestSha256':prior_sha,'from':973104,'through':prior['fixedPrefix']['through'],
        'blocks':len(prior['blocks']),'priorBlocksSha256':module.stable_json_sha256(prior['blocks']),
        'canonicalPrefixVerified':True,'nativeAndScalarBindingsVerified':True,
        'relationalBindingsVerified':True,'closingStateAndProjectionVerified':True}
    return current

class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        private=pathlib.Path(self.temp.name)/'quarantine';private.mkdir(mode=0o700)
        mock=patch.object(module,'QUARANTINE_PARENT',private);mock.start();self.addCleanup(mock.stop)
        self.root = pathlib.Path(self.temp.name)/'runtime'; self.root.mkdir(mode=0o700)
        self.created = {}
        self.backup = pathlib.Path(self.temp.name)/'backup'; self.backup.mkdir(mode=0o700)
        overlay=patch.object(module,'ACCEPTED_OVERLAY_BASES',{
            'server/db/native-transition-storage.mjs':module.sha(b'// accepted runtime bytes\nexport {};\n')})
        overlay.start();self.addCleanup(overlay.stop)
        rows = []; self.metadata = {}
        for index, path in enumerate(sorted(module.ALLOWED)):
            before = None if path in module.NEW else b'// accepted runtime bytes\nexport {};\n'
            after = b'// accepted runtime bytes\n// additive WORK batch sends delta\nexport {};\n'
            file = self.root/path; file.parent.mkdir(parents=True, exist_ok=True)
            if before is not None: file.write_bytes(before); file.chmod(0o640)
            if before is not None: (self.backup/f'before-{index}.mjs').write_bytes(before)
            (self.backup/f'candidate-{index}.mjs').write_bytes(after)
            self.metadata[path] = (os.getuid(), os.getgid(), 0o640)
            rows.append({'path':path, 'before':module.sha(before) if before is not None else None,
                'after':module.sha(after), 'base64':base64.b64encode(after).decode()})
        for path in ('server/proof-api.mjs', 'scripts/backfill-proof-search.mjs', 'scripts/backfill-proof-indexer.mjs', 'scripts/run-proof-indexer-worker.mjs', 'package.json', 'package-lock.json', module.METADATA_TEMPLATE):
            if path in module.ALLOWED: continue
            (self.root/path).parent.mkdir(parents=True,exist_ok=True)
            (self.root/path).write_bytes(b'{}\n' if path.endswith('.json') else b'export {};\n')
            (self.root/path).chmod(0o640)
        deps = {str(path.relative_to(self.root)):module.sha(path.read_bytes())
            for path in self.root.rglob('*') if path.is_file()}
        self.manifest = {'format':'proof-of-work-work-batch-replay-scoped-runtime-v1',
            'baseSourceCommit':module.BASE_SOURCE_COMMIT,'sourceTree':'1'*40,'captureSha256':'3'*64,
            'acceptedOverlayBases':dict(module.ACCEPTED_OVERLAY_BASES),
            'replaySourceManifest':{'path':'/tmp/private/source.json','sha256':'2'*64},
            'releaseId':'abcdef123456-20261007T010000Z', 'services':list(module.UNITS),
            'sourceCommit':'abcdef123456'+'a'*28, 'baselineHead':'b'*40, 'sources':rows,
            'restartConfigurationSha256':'a'*64, 'dependencies':deps,
            'dependencyMetadata':{str(path.relative_to(self.root)):{'uid':path.stat().st_uid,
                'gid':path.stat().st_gid,'mode':path.stat().st_mode&0o777}
                for path in self.root.rglob('*') if path.is_file()}, 'nodeSha256':'c'*64,
            'sourceMetadata':{name:{'uid':row[0], 'gid':row[1], 'mode':row[2]}
                for name,row in self.metadata.items()},
            'gateway':{'files':{unit:'f'*64 for unit in module.GATEWAY},
                'active':{unit:'active' for unit in module.GATEWAY},
                'unitFileStates':{module.GATEWAY[0]:'enabled',module.GATEWAY[1]:'static'}},
            'protectedServices':{'files':{unit:'f'*64 for unit in module.PROTECTED},
                'states':{unit:{'ActiveState':'active','MainPID':'456','WorkingDirectory':str(module.ROOT)} for unit in module.PROTECTED}},
            'searchHold':{'markerSha256':'d'*64, 'bindings':{
                'releaseId':'abcdef123456-20261007T010000Z', 'attempt':'initial',
                'files':{name:'e'*64 for name in module.SEARCH}}}}
        composition={'format':'proof-of-work-work-batch-replay-composition-v1',
            **{key:self.manifest[key] for key in ('sourceCommit','sourceTree','baseSourceCommit','releaseId','captureSha256')},
            'sources':[{key:row[key] for key in ('path','before','after')} for row in rows],
            'reviews':[{**{key:row[key] for key in ('path','before','after')},
                'baseSha256':row['before'],'repositoryCandidateSha256':row['after'],
                'syntaxVerified':True,'creationOnly':False,'cleanThreeWayMerge':True,'explicitResolution':None}
                for row in rows]}
        composition_path=self.backup/'composition.json';composition_path.write_text(json.dumps(composition));composition_path.chmod(0o600)
        self.manifest['replayComposition']={'path':str(composition_path),'sha256':module.sha(composition_path.read_bytes())}
        self.manifest['sourceIdentities']={name:module.creation_identity((self.root/name).lstat()) for name in module.ALLOWED}
        self.manifest['sourceParents']={name:module.parent_identity((self.root/name).parent.lstat()) for name in module.ALLOWED}
        self.manifest['evidenceVerifier']={'root':'/tmp/reviewed-source',
            'commit':self.manifest['sourceCommit'],'tree':self.manifest['sourceTree'],
            'files':{name:'f'*64 for name in module.REPLAY_TOOL_PATHS}}


    def test_exact_manifest_and_complete_fence(self):
        candidates = module.validate_manifest(self.manifest)
        module.fence(self.root,self.manifest,candidates)
        module.metadata_fence(self.root,self.manifest['sourceMetadata'])

    def test_approved_base_and_source_metadata_are_required(self):
        changed=copy.deepcopy(self.manifest);changed['baseSourceCommit']='f'*40
        with self.assertRaisesRegex(ValueError,'approved base'):module.validate_manifest(changed)
        for field in ('uid','gid','mode'):
            changed=copy.deepcopy(self.manifest);del changed['sourceMetadata']['server/proof-api.mjs'][field]
            with self.assertRaisesRegex(ValueError,'source metadata'):module.validate_manifest(changed)
        changed=copy.deepcopy(self.manifest);changed['sourceMetadata']['server/proof-api.mjs']['mode']=0o666
        with self.assertRaisesRegex(ValueError,'source metadata'):module.validate_manifest(changed)
        (self.root/'server/proof-api.mjs').chmod(0o600)
        with self.assertRaisesRegex(ValueError,'metadata changed'):
            module.metadata_fence(self.root,self.manifest['sourceMetadata'])

    def test_all_preserved_overlays_are_pinned_even_outside_import_graph(self):
        path=self.root/'server/accepted-inactive-overlay.mjs';path.write_bytes(b'// historical accepted helper\nexport {};\n');path.chmod(0o640)
        self.manifest['dependencies'][str(path.relative_to(self.root))]=module.sha(path.read_bytes())
        self.manifest['dependencyMetadata'][str(path.relative_to(self.root))]={'uid':path.stat().st_uid,
            'gid':path.stat().st_gid,'mode':path.stat().st_mode&0o777}
        candidates=module.validate_manifest(self.manifest);module.fence(self.root,self.manifest,candidates)
        path.write_bytes(b'// drift\nexport {};\n')
        with self.assertRaisesRegex(ValueError,'Dependency changed'):module.fence(self.root,self.manifest,candidates)

    def test_protected_worker_state_and_unit_pins_are_required(self):
        pins=self.manifest['protectedServices']
        for key in ('files','states'):
            manifest=copy.deepcopy(self.manifest);del manifest['protectedServices'][key]
            with self.assertRaisesRegex(ValueError,'protected service pins'):module.validate_manifest(manifest)
        with patch.object(module,'states',return_value=pins['states']), \
                patch.object(module,'safe_read',return_value=b'unit'), \
                patch.object(module,'sha',return_value='f'*64):
            module.require_protected_services(pins)
        changed=copy.deepcopy(pins['states']);changed[module.PROTECTED[0]]['MainPID']='999'
        with patch.object(module,'states',return_value=changed):
            with self.assertRaisesRegex(ValueError,'Protected service changed'):module.require_protected_services(pins)
        with patch.object(module,'states',return_value=pins['states']), \
                patch.object(module,'safe_read',return_value=b'changed unit'):
            with self.assertRaisesRegex(ValueError,'Protected service unit changed'):module.require_protected_services(pins)

    def test_allowlist_duplication_or_extra_write_refuses(self):
        for change in ('duplicate','extra'):
            manifest = copy.deepcopy(self.manifest)
            if change == 'duplicate': manifest['sources'].append(copy.deepcopy(manifest['sources'][0]))
            else: manifest['sources'][0]['path'] = 'server/unrelated-audit.mjs'
            with self.assertRaisesRegex(ValueError,'allowlist'): module.validate_manifest(manifest)

    def test_candidate_corruption_and_missing_hold_refuse(self):
        manifest = copy.deepcopy(self.manifest); manifest['sources'][0]['base64']=base64.b64encode(b'changed').decode()
        with self.assertRaisesRegex(ValueError,'bytes'): module.validate_manifest(manifest)
        manifest = copy.deepcopy(self.manifest); del manifest['searchHold']
        with self.assertRaisesRegex(ValueError,'Search hold'): module.validate_manifest(manifest)

    def test_release_id_binds_exact_source_commit(self):
        manifest=copy.deepcopy(self.manifest); manifest['sourceCommit']='f'*40
        with self.assertRaisesRegex(ValueError,'bind source commit'): module.validate_manifest(manifest)

    def test_held_timer_has_no_main_pid_and_service_must_be_drained(self):
        held={module.SEARCH[0]:{'ActiveState':'inactive','MainPID':'0'},
            module.SEARCH[1]:{'ActiveState':'inactive'}}
        module.require_search_held(held)
        for service,timer in [({'ActiveState':'inactive','MainPID':'123'},held[module.SEARCH[1]]),
                (held[module.SEARCH[0]],{'ActiveState':'active'})]:
            with self.assertRaisesRegex(ValueError,'Search not held'):
                module.require_search_held({module.SEARCH[0]:service,module.SEARCH[1]:timer})

    def test_gateway_pins_and_baseline_must_be_exact(self):
        for key in ('files', 'active', 'unitFileStates'):
            manifest=copy.deepcopy(self.manifest); del manifest['gateway'][key]
            with self.assertRaisesRegex(ValueError,'gateway pins'): module.validate_manifest(manifest)
        pins=self.manifest['gateway']
        actual={unit:{'ActiveState':pins['active'][unit],
            'UnitFileState':pins['unitFileStates'][unit]} for unit in module.GATEWAY}
        module.require_gateway_baseline(actual,pins)
        actual[module.GATEWAY[0]]['UnitFileState']='disabled'
        with self.assertRaisesRegex(ValueError,'enablement'): module.require_gateway_baseline(actual,pins)

    def test_socket_activation_cannot_cancel_drain_and_failure_restores_gateway(self):
        live={unit:'active' for unit in (*module.GATEWAY,*module.UNITS,*module.PROTECTED)}; calls=[]
        pins=self.manifest['gateway']
        def run(argv,**kwargs):
            action,unit=argv[1:];calls.append((action,unit))
            # Production failure: requests on the listening socket activate a
            # proxy requiring API and cancel the API stop transaction.
            if action=='stop' and unit==module.UNITS[0] and live[module.GATEWAY[0]]=='active':
                raise subprocess.CalledProcessError(1,argv,'API stop job canceled')
            live[unit]='inactive' if action=='stop' else 'active'
            # The accepted worker unit is PartOf=API: stopping API also stops
            # the worker, while starting API does not start the worker again.
            if action=='stop' and unit==module.UNITS[0]: live[module.UNITS[1]]='inactive'
        def gateway():
            return {unit:{'ActiveState':live[unit],'UnitFileState':pins['unitFileStates'][unit],
                **({'MainPID':'321' if live[unit]=='active' else '0'} if unit.endswith('.service') else {})}
                for unit in module.GATEWAY}
        def states(units):
            return {unit:{'ActiveState':live[unit],'MainPID':'123' if live[unit]=='active' else '0',
                'WorkingDirectory':str(module.ROOT)} for unit in units}
        with patch.object(module.subprocess,'run',side_effect=run), patch.object(module,'states',side_effect=states), \
                patch.object(module,'gateway_states',side_effect=gateway):
            with self.assertRaises(subprocess.CalledProcessError): run(['/usr/bin/systemctl','stop',module.UNITS[0]])
            calls.clear(); module.drain_apps()
            self.assertEqual(calls,[('stop',u) for u in (*module.GATEWAY,module.UNITS[1],module.UNITS[0])])
            self.assertTrue(all(live[unit]=='inactive' for unit in (*module.GATEWAY,*module.UNITS)))
            # The same recovery path is used following partial install failure.
            module.restore_apps(pins)
            self.assertEqual(calls[4:],[('start',u) for u in (*module.UNITS,*module.GATEWAY)])
            self.assertTrue(all(state=='active' for state in live.values()))
            module.drain_apps(); live[module.GATEWAY[1]]='active'
            with self.assertRaisesRegex(ValueError,'not drained'): module.require_apps_drained()

    def test_six_existing_paths_no_helper_create_or_source_rollback(self):
        self.assertEqual(module.NEW,frozenset())
        self.assertEqual(module.ALLOWED,{'server/proof-api.mjs','server/work-amo-v5-raw.mjs',
            'server/work-batch-declaration.mjs','server/db/work-batch-reader.mjs',
            'scripts/backfill-proof-indexer.mjs','server/db/native-transition-storage.mjs'})
        changed=copy.deepcopy(self.manifest);changed['sources'][0]['before']=None
        with self.assertRaises(ValueError):module.validate_manifest(changed)
        with self.assertRaisesRegex(ValueError,'forward-only'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'fixture',{})

    def test_installs_exact_existing_six_and_retains_metadata(self):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'fixture',{},source_identities=self.manifest['sourceIdentities'],source_parents=self.manifest['sourceParents'])
        for row in self.manifest['sources']:
            self.assertEqual(module.sha((self.root/row['path']).read_bytes()),row['after'])
            self.assertEqual((self.root/row['path']).stat().st_mode&0o777,0o640)

    def test_external_source_drift_refuses_entire_install(self):
        first=self.manifest['sources'][0];(self.root/first['path']).write_bytes(b'foreign')
        with self.assertRaisesRegex(ValueError,'unexpected source'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'fixture',{},source_identities=self.manifest['sourceIdentities'],source_parents=self.manifest['sourceParents'])
        for row in self.manifest['sources'][1:]:
            self.assertEqual(module.sha((self.root/row['path']).read_bytes()),row['before'])

    def test_write_enable_refused_but_read_pins_preserved(self):
        module.reject_activation_environment({'WORK_BATCH_DECLARATION_TXID':'a'*64,'WORK_BATCH_WRITES_ENABLED':'0'})
        for value in ('1','true',' 0','00'):
            with self.assertRaises(ValueError):
                module.reject_activation_environment({'WORK_BATCH_WRITES_ENABLED':value})
        module.inspect_batch_environment_file(b"WORK_BATCH_DECLARATION_TXID='"+b'a'*64+b"'\nWORK_BATCH_WRITES_ENABLED=0\n")
        for raw in (b'WORK_BATCH_WRITES_ENABLED=1\n',b'WORK_BATCH_WRITES_ENABLED="0\n1"\n',
                    b'WORK_BATCH_DECLARATION_TXID=foo\\\n'):
            with self.assertRaises(ValueError):module.inspect_batch_environment_file(raw)

    def test_normalized_restart_pin_preserves_static_command(self):
        active=EXEC_START_ACTIVE
        stopped=active.replace('stop_time=[n/a]','stop_time=[Sun 2026-10-25 15:57:00 UTC]').replace('code=(null)','code=killed').replace('status=0/0','status=15/TERM')
        restarted=active.replace('pid=3713663','pid=4000000').replace('18:44:16','18:45:16')
        self.assertEqual(module.normalize_exec_start(active),module.normalize_exec_start(stopped))
        self.assertEqual(module.normalize_exec_start(active),module.normalize_exec_start(restarted))
        self.assertNotEqual(module.normalize_exec_start(active),module.normalize_exec_start(active.replace('server/proof-api.mjs','server/other.mjs')))
        with self.assertRaises(ValueError):module.normalize_exec_start(active.replace(' ; pid=',' ; unknown=1 ; pid='))

    def test_late_d_plus_one_refuses_before_write_intent(self):
        receipt={'boundaryBefore':{}};save=Mock()
        with patch.object(module,'require_apps_drained') as drained,patch.object(module,'require_restart_configuration'),\
             patch.object(module,'require_replay_boundary',side_effect=ValueError('replay required')):
            with self.assertRaisesRegex(ValueError,'replay required'):
                module.cross_replay_boundary(receipt,self.manifest,'node',{},save,self.backup)
        self.assertNotIn('sourceWritesStarted',receipt);save.assert_not_called();drained.assert_called_once()

    def test_gate_after_drain_precedes_first_write_intent(self):
        calls=[];receipt={'boundaryBefore':{}}
        with patch.object(module,'require_apps_drained',side_effect=lambda:calls.append('drained')),\
             patch.object(module,'require_restart_configuration',side_effect=lambda x:calls.append('config')),\
             patch.object(module,'require_replay_boundary',side_effect=lambda *a:(calls.append('proof') or {'admissible':True})):
            module.cross_replay_boundary(receipt,self.manifest,'node',{},lambda:calls.append(('save',receipt.get('sourceWritesStarted',False))),self.backup)
        self.assertEqual(calls,['drained','config','proof',('save',False),('save',True)])

    def test_after_first_write_failure_never_restores_sources_or_services(self):
        receipt={'sourceWritesStarted':True}
        with patch.object(module,'drain_apps') as drain,patch.object(module,'install') as install,\
             patch.object(module,'restore_verified_apps') as restore:
            with self.assertRaisesRegex(ValueError,'forward recovery'):
                module.recover_runtime(receipt,self.manifest,{}, {},{},b'hold')
        drain.assert_called_once();install.assert_not_called();restore.assert_not_called()
        self.assertTrue(receipt['sourceRollbackProhibited']);self.assertTrue(receipt['forwardRecoveryRequired'])
        self.assertNotIn('rolledBack',receipt)

    def test_before_write_failure_restores_only_verified_baseline(self):
        receipt={};calls=[]
        with patch.object(module,'ROOT',self.root),patch.object(module,'drain_apps',side_effect=lambda:calls.append('drain')),\
             patch.object(module,'fence',side_effect=lambda *a:calls.append('fence')),\
             patch.object(module,'require_restart_configuration',side_effect=lambda x:calls.append('config')),\
             patch.object(module,'restore_verified_apps',side_effect=lambda *a:(calls.append('restore') or {})):
            module.recover_runtime(receipt,self.manifest,{}, {},{},b'hold')
        self.assertEqual(calls,['drain','fence','config','restore']);self.assertTrue(receipt['rolledBack'])

    def test_forward_failure_keeps_search_hold_in_supervisor(self):
        spec=importlib.util.spec_from_file_location('compat_supervisor',pathlib.Path(__file__).with_name('rollout-node.py'))
        supervisor=importlib.util.module_from_spec(spec);spec.loader.exec_module(supervisor)
        child=Mock();child.returncode=1;child.communicate.return_value=(json.dumps({
            'installed':True,'recoveryIncomplete':True,'forwardRecoveryRequired':True,
            'rolledBack':False}).encode(),b'private failure')
        with patch.object(supervisor.subprocess,'Popen',return_value=child):
            with self.assertRaises(supervisor.ControllerStillRunning):
                supervisor.invoke(b'pass',require_recovery_receipt=True)


    def test_same_bytes_foreign_inode_refuses(self):
        row=self.manifest['sources'][0];path=self.root/row['path']
        path.unlink();path.write_bytes((self.backup/'before-0.mjs').read_bytes());path.chmod(0o640)
        with self.assertRaisesRegex(ValueError,'inode'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'fixture',{},
                source_identities=self.manifest['sourceIdentities'],source_parents=self.manifest['sourceParents'])

    def test_foreign_target_after_move_is_not_overwritten(self):
        original=module.rename_absent_at
        foreign=b'foreign appeared after source move'
        def raced(sfd,sname,tfd,tname):
            original(sfd,sname,tfd,tname)
            fd=os.open(sname,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o640,dir_fd=sfd)
            with os.fdopen(fd,'wb') as f:f.write(foreign)
        journal={}
        with patch.object(module,'rename_absent_at',side_effect=raced):
            with self.assertRaises(FileExistsError):
                module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'fixture',journal,
                    source_identities=self.manifest['sourceIdentities'],source_parents=self.manifest['sourceParents'])
        row=self.manifest['sources'][0]
        self.assertEqual((self.root/row['path']).read_bytes(),foreign)
        self.assertEqual(pathlib.Path(journal[row['path']]['beforePath']).read_bytes(),(self.backup/'before-0.mjs').read_bytes())

    def test_candidate_replaced_after_intent_is_retained_and_never_published(self):
        journal={};changed=[]
        def checkpoint():
            if not changed:
                path=pathlib.Path(next(iter(journal.values()))['candidatePath'])
                path.unlink();path.write_bytes(b'foreign candidate');path.chmod(0o640);changed.append(path)
        with self.assertRaisesRegex(ValueError,'Candidate inode or bytes changed'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'fixture',journal,checkpoint,
                self.manifest['sourceIdentities'],self.manifest['sourceParents'])
        self.assertEqual(changed[0].read_bytes(),b'foreign candidate')
        self.assertFalse((self.root/self.manifest['sources'][0]['path']).exists())


    def test_gateway_restart_configuration_is_fenced_after_restore(self):
        with patch.object(module,'require_restart_configuration',side_effect=[None,ValueError('gateway config changed')]) as config,\
             patch.object(module,'restore_apps') as restore,patch.object(module,'require_protected_services'):
            with self.assertRaisesRegex(ValueError,'gateway config changed'):
                module.restore_verified_apps(self.manifest,{}, {},b'hold')
        self.assertEqual(config.call_count,2);restore.assert_called_once()

    def test_gateway_effective_configuration_participates_in_restart_pin(self):
        changed={'value':False}
        def ctl(*args):
            if args==('show-environment',):return ''
            unit=args[1];key=args[-1]
            if key=='ExecStart':return '' if unit.endswith('.socket') else EXEC_START_ACTIVE
            if key=='FragmentPath':return '/etc/systemd/system/'+unit
            if key=='WorkingDirectory':return str(module.ROOT)
            if key=='Listen' and unit.endswith('.socket'):return '127.0.0.1:8082 (Stream)' if changed['value'] else '127.0.0.1:8081 (Stream)'
            return ''
        with patch.object(module,'ctl',side_effect=ctl),patch.object(module,'safe_read',return_value=b'pinned unit'):
            before=module.restart_configuration_pin();changed['value']=True
            self.assertNotEqual(before,module.restart_configuration_pin())


    def test_production_overlay_pin_is_exact_and_not_create(self):
        self.assertEqual(FIXED_OVERLAY_BASES,{'server/db/native-transition-storage.mjs':
            '7e3393953864a68cdd72f43b7f3ae8e7eb4a24502ff2b260320790ee9be7f584'})
        self.assertEqual(module.BASE_SOURCE_COMMIT,'eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee')
        changed=copy.deepcopy(self.manifest)
        changed['acceptedOverlayBases']['server/unrelated.mjs']='f'*64
        with self.assertRaisesRegex(ValueError,'fixed accepted'):module.validate_manifest(changed)
        changed=copy.deepcopy(self.manifest)
        next(row for row in changed['sources'] if row['path']==module.NATIVE_HELPER)['before']='f'*64
        with self.assertRaisesRegex(ValueError,'overlay baseline'):module.validate_manifest(changed)

    def test_planner_cannot_fall_back_to_arbitrary_active_base(self):
        spec=importlib.util.spec_from_file_location('late_release',pathlib.Path(__file__).with_name('release.py'))
        release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
        active=b'// accepted runtime bytes\nexport {};\n'
        with patch.object(release,'git',return_value=b'') as git:
            self.assertEqual(release.approved_base_bytes(self.root,module.BASE_SOURCE_COMMIT,module.NATIVE_HELPER,active,module),active)
            self.assertEqual(git.call_args.args[1:3],('ls-tree','--name-only'))
        with patch.object(release,'git',return_value=b''):
            with self.assertRaisesRegex(ValueError,'base bytes changed'):
                release.approved_base_bytes(self.root,module.BASE_SOURCE_COMMIT,module.NATIVE_HELPER,b'foreign',module)
        with patch.object(release,'git',return_value=b'helper-in-git'):
            with self.assertRaisesRegex(ValueError,'unexpectedly exists'):
                release.approved_base_bytes(self.root,module.BASE_SOURCE_COMMIT,module.NATIVE_HELPER,active,module)
        with patch.object(release,'git',side_effect=ValueError('missing Git base')):
            with self.assertRaisesRegex(ValueError,'missing Git base'):
                release.approved_base_bytes(self.root,module.BASE_SOURCE_COMMIT,'server/proof-api.mjs',active,module)

    def test_source_manifest_must_bind_final_commit_tree_and_composed_six(self):
        pin=self.manifest['replaySourceManifest'];file=self.backup/'source-manifest.json'
        pin['path']=str(file)
        value={'format':'work-batch-replay-source-manifest-v1','sourceState':'committed',
            'sourceCommit':self.manifest['sourceCommit'],'sourceTree':self.manifest['sourceTree'],
            'sourceRoot':self.manifest['evidenceVerifier']['root'],'maxSuffixBlocks':512,'resourceLimits':copy.deepcopy(module.REPLAY_RESOURCE_LIMITS),
            'compositionManifestSha256':self.manifest['replayComposition']['sha256'],
            'node':{'path':'/opt/node/node','sha256':self.manifest['nodeSha256']},
            'runtimeSources':{r['path']:r['after'] for r in self.manifest['sources']}}
        roles={'baselineRaw':('baseline','server/work-amo-v5-raw.mjs','before'),
            'compatibleRaw':('compatible','server/work-amo-v5-raw.mjs','after'),
            'declaration':('compatible','server/work-batch-declaration.mjs','after'),
            'reader':('compatible','server/db/work-batch-reader.mjs','after'),
            'nativeStorage':('accepted-overlay',module.NATIVE_HELPER,'before')}
        value['modules']={role:group+'/'+path for role,(group,path,which) in roles.items()}
        value['files']={group+'/'+path:{'sha256':next(row[which] for row in self.manifest['sources'] if row['path']==path)}
            for role,(group,path,which) in roles.items()}
        def write(v):
            file.write_text(json.dumps(v));file.chmod(0o600);pin['sha256']=module.sha(file.read_bytes())
        write(value);module.verify_replay_source_manifest(self.manifest)
        for key,bad in [('sourceState','exploratory'),('sourceTree','f'*40),('maxSuffixBlocks',33),
                        ('runtimeSources',{}),('sourceRoot','/tmp/another')]:
            changed=copy.deepcopy(value);changed[key]=bad;write(changed)
            with self.assertRaisesRegex(ValueError,'committed runtime'):
                module.verify_replay_source_manifest(self.manifest)
        write(value)
        changed=copy.deepcopy(value);changed['files'][changed['modules']['compatibleRaw']]['sha256']='f'*64;write(changed)
        with self.assertRaisesRegex(ValueError,'role bytes'):module.verify_replay_source_manifest(self.manifest)
        value['files']['compatible/server/fixture.json']={'sha256':'f'*64}
        self.manifest['dependencies']['server/fixture.json']='e'*64
        write(value)
        with self.assertRaisesRegex(ValueError,'Replay dependency differs'):
            module.verify_replay_source_manifest(self.manifest)
        value['files']['compatible/server/fixture.json']['sha256']='e'*64;write(value)
        module.verify_replay_source_manifest(self.manifest)
        write(value);pin['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'manifest changed'):
            module.verify_replay_source_manifest(self.manifest)

    def test_qualification_cli_receipt_and_prior_prefix_are_pinned(self):
        output=self.backup/'qualification.json';node=self.backup/'node';node.write_bytes(b'node');node.chmod(0o600)
        m=copy.deepcopy(self.manifest);m['nodeSha256']=module.sha(b'node')
        source={'node':{'path':str(node)},'runtimeSources':{r['path']:r['after'] for r in m['sources']}}
        value=qualification_fixture(m)
        def run(argv,**kwargs):
            self.assertEqual(kwargs['timeout'],21600)
            kwargs['stderr'].write(b'{"stage":"revalidate","height":973104}\n')
            kwargs['stderr'].flush()
            progress_path=self.backup/'qualification-before-drain.progress.jsonl'
            self.assertEqual(progress_path.read_bytes(),b'{"stage":"revalidate","height":973104}\n')
            self.assertEqual(kwargs['stdout'],subprocess.PIPE)
            self.assertIn('--source-manifest-sha256',argv);self.assertIn('--max-old-space-size=1536',argv)
            output.write_text(json.dumps(value));output.chmod(0o600)
            return subprocess.CompletedProcess(argv,0,json.dumps({'qualified':True,
                'receiptSha256':module.sha(output.read_bytes()),'output':str(output)}).encode(),b'')
        with patch.object(module,'verify_verifier_sources',return_value=self.root),\
             patch.object(module,'verify_replay_source_manifest',return_value=source),\
             patch.object(module.subprocess,'run',side_effect=run):
            ref=module.require_replay_boundary(m,node,{},'before-drain',output)
            self.assertEqual(ref['sha256'],module.sha(output.read_bytes()))
            progress=pathlib.Path(ref['progress']['path'])
            self.assertEqual(progress.stat().st_mode&0o777,0o600)
            self.assertEqual(ref['progress']['sha256'],module.sha(progress.read_bytes()))
            output.unlink();(self.backup/'qualification-before-drain.progress.jsonl').unlink();value['fixedPrefix']['through']=973105
            with self.assertRaisesRegex(ValueError,'suffix'):
                module.require_replay_boundary(m,node,{},'before-drain',output)
            output.unlink()
            with self.assertRaisesRegex(ValueError,'qualification phase'):
                module.require_replay_boundary(m,node,{},'after-drain',output)



    def make_publication(self):
        proof={'qualified':True,'mode':'after-drain','priorManifestSha256':'b'*64,
            'databaseName':'exact_fixture_database','proposedMarker':{'declared':'fixture'},
            'fixedPrefix':{'through':973104},'blocks':[{'height':973104,'hash':'d'*64,
                'oldNativeSha256':'e'*64,'newNativeSha256':'f'*64,
                 'oldScalarMetadataSha256':'a'*64,'newScalarMetadataSha256':'b'*64}]}
        path=self.backup/'qualification-after.json';path.write_text(json.dumps(proof));path.chmod(0o600)
        ref={'path':str(path),'sha256':module.sha(path.read_bytes())}
        prepared={'manifestSha256':'a'*64,'sqlSha256':'c'*64}
        final={'format':'work-batch-native-supersession-dispatch-v1','status':'committed',
            'committed':True,'postconditionsVerified':True,'commitSent':True,'returncode':0,
            'fenceError':None,'availabilityVerified':False,**prepared,
            'result':{'format':'work-batch-native-supersession-result-v1',
                'manifestSha256':prepared['manifestSha256'],'qualificationSha256':ref['sha256'],
                'originalArchivesRetained':True,'oldChunksRetained':True,
                'currentMetadataVerified':True,'markerVerified':True,'marker':proof['proposedMarker'],
                'blocks':[{**proof['blocks'][0],'originalArchiveRetained':True,
                    'currentMetadataVerified':True,'originalScalarsPreserved':True,'currentScalarsQualified':True,'hotSlotVerified':True,'historicalReadVerified':True,'relationalRowsVerified':True,'cacheMode':'hot'}]}}
        return proof,ref,prepared,final

    def test_commit_requires_exact_immutable_archive_current_hot_and_marker_proof(self):
        proof,ref,prepared,final=self.make_publication()
        module.publication_result(final,prepared,ref)
        for field in ('committed','postconditionsVerified','commitSent'):
            changed=copy.deepcopy(final);changed[field]=False
            with self.assertRaises(ValueError):module.publication_result(changed,prepared,ref)
        for field in ('oldChunksRetained','originalArchivesRetained','currentMetadataVerified','markerVerified'):
            changed=copy.deepcopy(final);changed['result'][field]=False
            with self.assertRaises(ValueError):module.publication_result(changed,prepared,ref)
        for field in ('originalArchiveRetained','currentMetadataVerified','originalScalarsPreserved','currentScalarsQualified','hotSlotVerified','historicalReadVerified','relationalRowsVerified'):
            changed=copy.deepcopy(final);changed['result']['blocks'][0][field]=False
            with self.assertRaises(ValueError):module.publication_result(changed,prepared,ref)
        for mutate in (lambda f:f['result'].update(marker={'wrong':True}),
                       lambda f:f['result']['blocks'][0].update(newNativeSha256='0'*64),
                       lambda f:f['result']['blocks'].append(f['result']['blocks'][0])):
            changed=copy.deepcopy(final);mutate(changed)
            with self.assertRaises(ValueError):module.publication_result(changed,prepared,ref)

    def test_native_receipt_proves_cold_history_and_exact_128_slot_policy(self):
        proof,ref,prepared,final=self.make_publication()
        original=proof['blocks'][0];published=final['result']['blocks'][0]
        proof['blocks']=[{**original,'height':973104+i,'hash':f'{i:064x}'} for i in range(129)]
        proof['fixedPrefix']['through']=973232
        final['result']['blocks']=[{**published,**row,'cacheMode':'cold' if i==0 else 'hot'}
            for i,row in enumerate(proof['blocks'])]
        path=pathlib.Path(ref['path']);path.write_text(json.dumps(proof))
        ref['sha256']=module.sha(path.read_bytes())
        final['result']['qualificationSha256']=ref['sha256']
        module.publication_result(final,prepared,ref)
        for i,wrong in ((0,'hot'),(1,'cold')):
            changed=copy.deepcopy(final);changed['result']['blocks'][i]['cacheMode']=wrong
            with self.assertRaises(ValueError):module.publication_result(changed,prepared,ref)

    def test_full_mocked_publish_preserves_intent_and_requires_verified_result(self):
        proof,ref,_,final=self.make_publication()
        journal={}
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'publication',journal,
            source_identities=self.manifest['sourceIdentities'],source_parents=self.manifest['sourceParents'])
        receipt={'sourceWritesStarted':True,'installed':True,'createdHelpers':journal,
            'boundaryAfterDrain':ref,'boundaryBefore':{'sha256':'b'*64}}
        calls=[];saved=[]
        def run(argv,**kwargs):
            mode='prepare' if '--prepare' in argv else 'execute';calls.append(mode)
            self.assertEqual(kwargs['env'],{'PRIVATE_RPC':'not-output'})
            def arg(key):return pathlib.Path(argv[argv.index(key)+1])
            if mode=='prepare':
                manifest={'sourceCommit':self.manifest['sourceCommit'],'sourceTree':self.manifest['sourceTree'],
                    'sourceManifestSha256':self.manifest['replaySourceManifest']['sha256'],
                    'runtimeFiles':{r['path']:r['after'] for r in self.manifest['sources']},
                    'qualificationSha256':ref['sha256'],'databaseName':proof['databaseName']}
                arg('--manifest').write_text(json.dumps(manifest));arg('--manifest').chmod(0o600)
                arg('--render').write_text('BEGIN; COMMIT;');arg('--render').chmod(0o600)
                value={'status':'rendered-only','committed':False,
                    'manifestPath':str(arg('--manifest')),'sqlPath':str(arg('--render')),
                    'manifestSha256':module.sha(arg('--manifest').read_bytes()),
                    'sqlSha256':module.sha(arg('--render').read_bytes())}
                final.update({k:value[k] for k in ('manifestSha256','sqlSha256')})
                final['result']['manifestSha256']=value['manifestSha256']
                arg('--receipt').write_text(json.dumps(value));arg('--receipt').chmod(0o600)
            else:
                self.assertTrue(receipt['publicationDispatchStarted'])
                self.assertEqual(argv[argv.index('--database')+1],proof['databaseName'])
                self.assertEqual(kwargs['timeout'],1800)
                value=final
                target=pathlib.Path(str(arg('--receipt'))+'.result.json');target.write_text(json.dumps(value));target.chmod(0o600)
            return subprocess.CompletedProcess(argv,0,json.dumps(value).encode(),b'')
        with patch.object(module,'ROOT',self.root),patch.object(module,'require_apps_drained'),\
             patch.object(module,'require_restart_configuration'),\
             patch.object(module,'verify_verifier_sources',return_value=self.root),\
             patch.object(module,'verify_replay_source_manifest'),\
             patch.object(module.subprocess,'run',side_effect=run):
            module.publish_qualified_replay(receipt,self.manifest,self.backup,
                lambda:saved.append(copy.deepcopy(receipt)),{'PRIVATE_RPC':'not-output'})
        self.assertEqual(calls,['prepare','execute'])
        self.assertTrue(saved[0]['publicationDispatchStarted']);self.assertNotIn('replayPublication',saved[0])
        self.assertTrue(saved[-1]['replayPublication']['postconditionsVerified'])

    def test_installed_fence_rejects_same_bytes_foreign_inode(self):
        journal={}
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'inode',journal,
            source_identities=self.manifest['sourceIdentities'],source_parents=self.manifest['sourceParents'])
        with patch.object(module,'ROOT',self.root):
            module.installed_source_fence(self.manifest,journal)
            path=self.root/self.manifest['sources'][0]['path']
            foreign=path.with_name('foreign');foreign.write_bytes(path.read_bytes());foreign.chmod(0o640)
            os.replace(foreign,path)
            with self.assertRaisesRegex(ValueError,'ownership'):
                module.installed_source_fence(self.manifest,journal)

    def test_success_supervisor_requires_native_commit_proof(self):
        spec=importlib.util.spec_from_file_location('late_supervisor',pathlib.Path(__file__).with_name('rollout-node.py'))
        supervisor=importlib.util.module_from_spec(spec);spec.loader.exec_module(supervisor)
        payload=json.dumps(self.manifest).encode()
        receipt={k:self.manifest[k] for k in ('format','releaseId','sourceCommit','sourceTree')}
        receipt.update(manifestSha256=module.sha(payload),installed=True,rolledBack=False,
            servicesAfter={},completedAt='2026-10-25T00:00:00Z')
        child=Mock();child.returncode=0
        with patch.object(supervisor.subprocess,'Popen',return_value=child):
            child.communicate.return_value=(json.dumps(receipt).encode(),b'')
            with self.assertRaises(supervisor.ControllerStillRunning):
                supervisor.invoke(b'pass',payload=payload,require_recovery_receipt=True)
            receipt['replayPublication']={'committed':True,'postconditionsVerified':True}
            child.communicate.return_value=(json.dumps(receipt).encode(),b'')
            self.assertTrue(supervisor.invoke(b'pass',payload=payload,require_recovery_receipt=True)['installed'])
            self.assertEqual(child.communicate.call_args.kwargs['timeout'],33600)



    def test_unverified_extension_refuses_before_source_write_intent(self):
        prior=self.backup/'before-qualified.json';node=self.backup/'node';node.write_bytes(b'node');node.chmod(0o600)
        m=copy.deepcopy(self.manifest);m['nodeSha256']=module.sha(b'node')
        source={'node':{'path':str(node)},'runtimeSources':{r['path']:r['after'] for r in m['sources']}}
        before=qualification_fixture(m);prior.write_text(json.dumps(before));prior.chmod(0o600)
        expected={'path':str(prior),'sha256':module.sha(prior.read_bytes()),'qualified':True,
            'mode':'before-drain','fixedPrefix':before['fixedPrefix']}
        value=qualification_fixture(m,'after-drain',2)
        value['priorManifestSha256']=expected['sha256']
        output=self.backup/'qualification-after.json'
        def run(argv,**kwargs):
            self.assertEqual(kwargs['timeout'],7200)
            output.write_text(json.dumps(value));output.chmod(0o600)
            return subprocess.CompletedProcess(argv,0,json.dumps({'qualified':True,
                'receiptSha256':module.sha(output.read_bytes()),'output':str(output)}).encode(),b'')
        receipt={'boundaryBefore':expected};save=Mock()
        with patch.object(module,'verify_verifier_sources',return_value=self.root),\
             patch.object(module,'verify_replay_source_manifest',return_value=source),\
             patch.object(module.subprocess,'run',side_effect=run),\
             patch.object(module,'require_apps_drained'),patch.object(module,'require_restart_configuration'):
            with self.assertRaisesRegex(ValueError,'exact fresh'):
                module.cross_replay_boundary(receipt,m,node,{},save,self.backup)
        self.assertNotIn('sourceWritesStarted',receipt);save.assert_not_called()

    def test_cached_prefix_allows_only_verified_extension_and_identical_semantics(self):
        before=qualification_fixture(self.manifest,records=5)
        after=cached_extension(before,qualification_fixture(self.manifest,'after-drain',3,records=5),'a'*64)
        self.assertTrue(module.validate_cached_prefix(before,after,'a'*64))
        mutations=[
            lambda q:q.pop('cacheRevalidation'),
            lambda q:q['cacheRevalidation'].update(nativeAndScalarBindingsVerified=False),
            lambda q:q['cacheRevalidation'].update(priorBlocksSha256='f'*64),
            lambda q:q['cacheRevalidation'].update(through=973105),
            lambda q:q.update(priorManifestSha256='f'*64),
            lambda q:q['blocks'][0].update(oldNativeSha256='0'*64),
            lambda q:q['blocks'][0].update(currentMainRowSha256='0'*64),
            lambda q:q['blocks'][0]['relationalBindings'].update(eventRowsSha256='0'*64),
            lambda q:q['blocks'][0].update(newScalarMetadataSha256='0'*64),
            lambda q:q.update(databaseEndpoint={'port':55432}),
            lambda q:q.update(anchor={'height':973103,'closingProjectionSha256':'0'*64}),
            lambda q:q['canonicalRebuild'].update(indexedThroughBlock=973106+1),
            lambda q:q.update(sourceManifestSha256='0'*64),
            lambda q:q.update(verifierSha256='0'*64),
        ]
        for mutate in mutations:
            changed=copy.deepcopy(after);mutate(changed)
            with self.assertRaises(ValueError):module.validate_cached_prefix(before,changed,'a'*64)

    def test_cache_checks_identical_prefix_even_without_extension(self):
        before=qualification_fixture(self.manifest)
        after=cached_extension(before,qualification_fixture(self.manifest,'after-drain'),'a'*64)
        self.assertTrue(module.validate_cached_prefix(before,after,'a'*64))
        after['cacheRevalidation']['canonicalPrefixVerified']=False
        with self.assertRaises(ValueError):module.validate_cached_prefix(before,after,'a'*64)

    def test_qualification_caps_and_semantic_refusals(self):
        good=qualification_fixture(self.manifest,count=512,records=1024)
        self.assertEqual(len(module.validate_qualification_bounds(good)),512)
        for value in (qualification_fixture(self.manifest,count=513),
                      qualification_fixture(self.manifest,records=1025)):
            with self.assertRaises(ValueError):module.validate_qualification_bounds(value)
        for mutate in [
            lambda q:q.update(format='work-batch-bounded-reseal-qualification-v2'),
            lambda q:q['resourceUsage'].update(rawBlockBytes=0),
            lambda q:q['resourceLimits'].update(maxRawBlockBytes=3*1024**3),
            lambda q:q['blocks'][0].update(batchLookingCount=1),
            lambda q:q['blocks'][0].update(ordinaryDerivedClosuresVerified=False),
            lambda q:q['blocks'][0].pop('currentMainRowSha256'),
            lambda q:q['blocks'][0].update(projectionEqual=False),
            lambda q:q['blocks'][0]['replacementFields'].update(closingTokenState={}),
            lambda q:q['blocks'][0]['relationalBindings'].update(recordCount=1),
        ]:
            value=qualification_fixture(self.manifest);mutate(value)
            with self.assertRaises(ValueError):module.validate_qualification_bounds(value)
        for row in good['blocks']:
            row.update(nativePayloadBytes=32*1024**2,oldNativeBytes=32*1024**2)
        good['resourceUsage']['nativePayloadBytes']=512*32*1024**2
        with self.assertRaisesRegex(ValueError,'cumulative'):module.validate_qualification_bounds(good)

    def test_derived_closure_requires_exact_counts_six_fields_and_scalar_exception(self):
        good=qualification_fixture(self.manifest,records=1)
        bind_event_set_fixture(good['blocks'][0],derived=1)
        self.assertEqual(module.validate_qualification_bounds(good)[0]['eventCount'],2)
        for mutate in (
            lambda q:q.update(format='work-batch-bounded-reseal-qualification-v3'),
            lambda q:q.update(ordinaryDerivedClosuresVerified=False),
            lambda q:q['blocks'][0].update(derivedEventCount=2),
            lambda q:q['blocks'][0].update(eventCount=1),
            lambda q:q['blocks'][0].update(rawProtocolCandidateCount=2),
            lambda q:q['blocks'][0]['relationalBindings'].update(eventCount=1),
            lambda q:q['blocks'][0]['relationalBindings'].update(recordCount=2),
            lambda q:q['blocks'][0].update(eventSetProvenanceOnly=False),
            lambda q:q['blocks'][0].update(ordinaryDerivedClosuresVerified=False),
            lambda q:q['blocks'][0]['replacementFields'].pop('eventSetCommitment'),
            lambda q:q['blocks'][0]['replacementFields'].update(eventSetCommitment=q['blocks'][0]['oldEventSetCommitment']),
            lambda q:q['blocks'][0]['newEventSetCommitment'].update(payloadBytes=101),
            lambda q:q['blocks'][0]['newScalarMetadata'].update(credit_supply='101'),
            lambda q:q['blocks'][0]['newScalarMetadata'].update(created_at='changed'),
            lambda q:q['blocks'][0]['newScalarMetadata'].update(event_count=1),
            lambda q:q['blocks'][0]['newScalarMetadata'].update(event_set_sha256='0'*64),
            lambda q:q['blocks'][0].update(newScalarMetadataSha256=q['blocks'][0]['oldScalarMetadataSha256']),
            lambda q:q['blocks'][0].update(unchangedScalarMetadata={}),
        ):
            changed=copy.deepcopy(good);mutate(changed)
            with self.assertRaises(ValueError):module.validate_qualification_bounds(changed)

    def test_ordinary_block_cannot_change_event_set_and_cache_cannot_hide_derived_drift(self):
        before=qualification_fixture(self.manifest,records=1)
        changed=copy.deepcopy(before);bind_event_set_fixture(changed['blocks'][0],derived=1)
        changed['blocks'][0].update(derivedEventCount=0,eventCount=1)
        changed['blocks'][0]['relationalBindings']['eventCount']=1
        for field in ('oldScalarMetadata','newScalarMetadata'):changed['blocks'][0][field]['event_count']=1
        with self.assertRaises(ValueError):module.validate_qualification_bounds(changed)
        bind_event_set_fixture(before['blocks'][0],derived=1)
        after=cached_extension(before,copy.deepcopy(before),'a'*64);after['mode']='after-drain'
        self.assertTrue(module.validate_cached_prefix(before,after,'a'*64))
        after['blocks'][0]['relationalBindings']['eventRowsSha256']='c'*64
        with self.assertRaises(ValueError):module.validate_cached_prefix(before,after,'a'*64)

    def test_publication_requires_qualified_current_and_preserved_original_scalar_hashes(self):
        proof,ref,prepared,final=self.make_publication()
        module.publication_result(final,prepared,ref)
        for field in ('oldScalarMetadataSha256','newScalarMetadataSha256'):
            changed=copy.deepcopy(final);changed['result']['blocks'][0][field]='0'*64
            with self.assertRaises(ValueError):module.publication_result(changed,prepared,ref)
        changed=copy.deepcopy(final);row=changed['result']['blocks'][0]
        row.pop('originalScalarsPreserved');row.pop('currentScalarsQualified');row['originalScalarsVerified']=True
        with self.assertRaises(ValueError):module.publication_result(changed,prepared,ref)

    def test_http_postflight_requires_active_exact_declaration_with_writes_off(self):
        good={'protocol':'work-batch-v1','network':'livenet','active':True,'writeEnabled':False,'ready':False,
            'declarationTxid':'b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28',
            'activationHeight':973104,'checkedTipHeight':973106,'checkedTipHash':'a'*64,
            'limits':{'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536},
            'registryFeeProofs':546,'reasonCode':'work-batch-writes-disabled'}
        self.assertTrue(module.repaired_status(good))
        self.assertTrue(module.repaired_status(good,{'through':973106,'hash':'a'*64}))
        self.assertFalse(module.repaired_status(good,{'through':973106,'hash':'b'*64}))
        self.assertFalse(module.repaired_status(good,{'through':973107,'hash':'b'*64}))
        for key,bad in [('active',False),('writeEnabled',True),('ready',True),
            ('declarationTxid','f'*64),('activationHeight',973105),('checkedTipHeight',0),
            ('checkedTipHash',''),('reasonCode','work-batch-evidence-unavailable')]:
            changed={**good,key:bad};self.assertFalse(module.repaired_status(changed),key)

    def test_composition_provenance_refuses_different_before_after_or_base(self):
        module.verify_replay_composition(self.manifest)
        path=pathlib.Path(self.manifest['replayComposition']['path']);original=json.loads(path.read_text())
        for mutate in (lambda x:x.update(sourceTree='f'*40),
                       lambda x:x['sources'][0].update(after='f'*64),
                       lambda x:x['reviews'][0].update(baseSha256=None),
                       lambda x:x['reviews'][0].update(cleanThreeWayMerge=False,explicitResolution=None)):
            changed=copy.deepcopy(original);mutate(changed)
            path.write_text(json.dumps(changed));self.manifest['replayComposition']['sha256']=module.sha(path.read_bytes())
            with self.assertRaises(ValueError):module.verify_replay_composition(self.manifest)



    def test_render_only_compose_then_final_plan_binds_exact_outputs(self):
        spec=importlib.util.spec_from_file_location('compose_release',pathlib.Path(__file__).with_name('release.py'))
        release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
        repo=pathlib.Path(self.temp.name)/'repository';toolroot=repo/'deploy/work-batch-replay'
        toolroot.mkdir(parents=True,mode=0o700)
        tools={}
        for name in ('release.py','capture-node.py','scoped-node.py','rollout-node.py','preflight.mjs',
                     'publish-replay.py','storage-extension.sql','catalog-baseline.json','catalog-after.json'):
            file=toolroot/name;file.write_bytes(('// pinned '+name).encode());file.chmod(0o600)
            tools[str(file.relative_to(repo))]=file.read_bytes()
        holder=repo/'deploy/search/hold-node-timer.py';holder.parent.mkdir(mode=0o700)
        holder.write_bytes(b'holder');tools[str(holder.relative_to(repo))]=b'holder'
        before={str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        after={row['path']:base64.b64decode(row['base64']) for row in self.manifest['sources']}
        snapshot={'format':'proof-of-work-work-batch-replay-runtime-capture-v1','root':str(module.ROOT),
            'controllerSha256':module.sha(tools['deploy/work-batch-replay/scoped-node.py']),
            'baselineHead':self.manifest['baselineHead'],'restartConfigurationSha256':'a'*64,
            'nodePath':'/opt/node-v24.18.0-linux-x64/bin/node','nodeSha256':'c'*64,
            'gateway':self.manifest['gateway'],'protectedServices':self.manifest['protectedServices'],
            'searchFiles':self.manifest['searchHold']['bindings']['files'],
            'sources':{name:{'base64':base64.b64encode(raw).decode(),'sha256':module.sha(raw),
                'uid':os.getuid(),'gid':os.getgid(),'mode':0o640,
                'identity':module.creation_identity((self.root/name).lstat()),
                'parentIdentity':module.parent_identity((self.root/name).parent.lstat())}
                for name,raw in before.items()}}
        capture=self.backup/'capture.json';capture.write_text(json.dumps(snapshot));capture.chmod(0o600)
        commit=self.manifest['sourceCommit']
        def git(repo,*argv):
            if argv==('rev-parse','HEAD'):return commit.encode()
            if argv==('rev-parse',commit+'^{tree}'):return self.manifest['sourceTree'].encode()
            if argv[0] in ('status','merge-base','ls-tree'):return b''
            if argv[0]=='show':
                revision,name=argv[1].split(':',1)
                if name in tools:return tools[name]
                return before[name] if revision==module.BASE_SOURCE_COMMIT else after[name]
            raise AssertionError(argv)
        args=types.SimpleNamespace(repository=repo,commit=commit,base_commit=module.BASE_SOURCE_COMMIT,
            capture=capture,output=self.backup/'composed',release_id=self.manifest['releaseId'],reviewed_merges=None)
        with patch.object(release,'ROOT',toolroot),patch.object(release,'controller',return_value=module),\
             patch.object(release,'node_context'),patch.object(release,'git',side_effect=git),\
             patch('builtins.print'):
            release.plan(args,compose_only=True)
            composition=args.output/'composition.json';value=json.loads(composition.read_bytes())
            self.assertEqual(value['sources'],[{key:row[key] for key in ('path','before','after')}
                for row in self.manifest['sources']])
            self.assertEqual(set(value['candidates']),module.ALLOWED)
            self.assertEqual((args.output/'captured-runtime'/module.NATIVE_HELPER).read_bytes(),before[module.NATIVE_HELPER])
            args.composition=composition;args.composition_sha256=module.sha(composition.read_bytes())
            args.replay_source_manifest=self.backup/'source-manifest.json';args.replay_source_manifest_sha256='2'*64
            args.output=self.backup/'plan'
            with patch.object(module,'verify_verifier_sources',return_value=repo),\
                 patch.object(module,'verify_replay_source_manifest'):
                release.plan(args)
            plan=json.loads((args.output/'plan.json').read_bytes())
            self.assertEqual(plan['runtimeManifestTemplate']['replayComposition']['sha256'],args.composition_sha256)
            # A changed reviewed candidate refuses even with the same recorded composition.
            path=pathlib.Path(next(iter(value['candidates'].values()))['path']);path.write_bytes(b'foreign')
            args.output=self.backup/'refused-plan'
            with self.assertRaisesRegex(ValueError,'Composed candidate bytes changed'):
                release.plan(args)

if __name__=='__main__':unittest.main()
