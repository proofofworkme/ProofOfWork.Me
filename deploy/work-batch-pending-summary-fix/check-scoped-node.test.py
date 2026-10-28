#!/usr/bin/env python3
"""Local filesystem tests; never contact production or invoke services."""
import ast, base64, copy, importlib.util, json, os, pathlib, subprocess, tempfile, types, unittest
from unittest.mock import Mock, MagicMock, patch

spec = importlib.util.spec_from_file_location('work-batch-pending-summary-fix_scoped_node', pathlib.Path(__file__).with_name('scoped-node.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

DUMMY_ROOT=pathlib.Path(__file__).resolve().parents[2]

EXEC_START_ACTIVE = ('{ path=/opt/node/bin/node ; argv[]=/opt/node/bin/node server/proof-api.mjs'
    ' ; ignore_errors=no ; start_time=[Sat 2026-10-24 18:44:16 UTC] ; stop_time=[n/a]'
    ' ; pid=3713663 ; code=(null) ; status=0/0 }')

class ControllerTests(unittest.TestCase):
    def setUp(self):
        previous_umask=os.umask(0o077);self.addCleanup(os.umask,previous_umask)
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        private=pathlib.Path(self.temp.name)/'quarantine';private.mkdir(mode=0o700)
        mock=patch.object(module,'QUARANTINE_PARENT',private);mock.start();self.addCleanup(mock.stop)
        self.root = pathlib.Path(self.temp.name)/'runtime'; self.root.mkdir(mode=0o700)
        # Simulate root-owned quarantine directories only; source files and inode
        # identity/race checks stay real under an unprivileged test runner.
        for method in ('stat','lstat'):
            original=getattr(pathlib.Path,method)
            def owned_directory(path,*args,_original=original,**kwargs):
                info=_original(path,*args,**kwargs)
                if (path==private or private in path.parents) and __import__('stat').S_ISDIR(info.st_mode):
                    fields={k:getattr(info,k) for k in dir(info) if k.startswith('st_')}
                    fields.update(st_uid=0,st_gid=0);return types.SimpleNamespace(**fields)
                return info
            handle=patch.object(pathlib.Path,method,owned_directory);handle.start();self.addCleanup(handle.stop)
        # Small public function fixture; production source hashes remain fixed.
        public=(DUMMY_ROOT/'server/proof-api.mjs').read_bytes()
        before_parts=[];after_parts=[]
        for name,row in module.PATCHES.items():
            _,_,body=module.function_slice(public,name)
            self.assertEqual(module.sha(body),row['afterSha256'])
            after_parts.append(body);before_parts.append(body.replace(row['after'],row['before'],1))
        self.before=b'// accepted runtime bytes\n'+b''.join(before_parts)+b'function fixtureSentinel() {}\n'
        self.after=b'// accepted runtime bytes\n'+b''.join(after_parts)+b'function fixtureSentinel() {}\n'
        for name,value in [('ACCEPTED_API_SHA256',module.sha(self.before)),('EXPECTED_CANDIDATE_SHA256',module.sha(self.after))]:
            handle=patch.object(module,name,value);handle.start();self.addCleanup(handle.stop)
        self.created = {}
        self.backup = pathlib.Path(self.temp.name)/'backup'; self.backup.mkdir(mode=0o700)
        rows = []; self.metadata = {}
        for index, path in enumerate(sorted(module.ALLOWED)):
            before = None if path in module.NEW else self.before
            after = self.after
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
        self.manifest = {'format':'proof-of-work-work-batch-pending-summary-fix-scoped-runtime-v1',
            'baseSourceCommit':module.BASE_SOURCE_COMMIT,'acceptedInventorySha256':module.ACCEPTED_INVENTORY_SHA256,
            'releaseId':'abcdef123456-20261007T010000Z', 'services':list(module.UNITS),
            'sourceTree':'c'*40,'patchProvenance':module.patch_provenance(module.sha(self.after)),
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

        self.manifest['sourceIdentities']={name:module.creation_identity((self.root/name).lstat()) if name not in module.NEW else None for name in module.ALLOWED}
        self.manifest['sourceParents']={name:module.parent_identity((self.root/name).parent.lstat()) for name in module.ALLOWED}
        self.manifest['rehearsal']={'path':'/tmp/offline-qualification','sha256':'a'*64,'planSha256':'b'*64,'helperSha256':'c'*64}
        self.manifest['batchAuthority']={'protocol':'work-batch-v1','network':'livenet','active':True,'writeEnabled':True,
            'declarationTxid':'d'*64,'activationHeight':973104,'limits':{'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536},'registryFeeProofs':546}

    def install(self, checkpoint=lambda:None):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'fixture',
            self.created,checkpoint,self.manifest['sourceIdentities'],self.manifest['sourceParents'])

    def test_forward_publication_preserves_before_inodes_and_single_link_candidates(self):
        self.install()
        module.installed_source_fence(self.root,self.manifest,self.created)
        for row in self.manifest['sources']:
            item=self.created[row['path']];target=self.root/row['path']
            self.assertEqual(target.stat().st_nlink,1)
            self.assertFalse(pathlib.Path(item['candidatePath']).exists())
            if row['path'] not in module.NEW:
                before=pathlib.Path(item['beforePath'])
                self.assertEqual(module.creation_identity(before.lstat()),item['baselineIdentity'])
                self.assertEqual(module.sha(before.read_bytes()),row['before'])

    def test_same_bytes_replacement_inode_refuses_before_publication(self):
        name=next(name for name in sorted(module.ALLOWED) if name not in module.NEW)
        target=self.root/name;temporary=target.with_name('replacement');temporary.write_bytes(target.read_bytes());temporary.chmod(0o640)
        os.replace(temporary,target)
        with self.assertRaisesRegex(ValueError,'changed source inode'):self.install()
        self.assertFalse(self.created)

    def test_raced_existing_source_is_retained_without_publication(self):
        original=module.rename_absent_at;replaced=[]
        def race(sfd,sname,tfd,tname):
            if tname.startswith('before-') and not replaced:
                target=self.root/next(row['path'] for row in self.manifest['sources'] if pathlib.Path(row['path']).name==sname)
                new=target.with_name('foreign');new.write_bytes(b'foreign');new.chmod(0o640);os.replace(new,target);replaced.append(True)
            return original(sfd,sname,tfd,tname)
        with patch.object(module,'rename_absent_at',side_effect=race):
            with self.assertRaisesRegex(ValueError,'Moved source ownership'):self.install()
        moved=[pathlib.Path(row['beforePath']) for row in self.created.values() if pathlib.Path(row['beforePath']).exists()]
        self.assertIn(b'foreign',[path.read_bytes() for path in moved])

    def test_raced_new_destination_is_never_overwritten(self):
        original=module.rename_absent_at;foreign=[]
        def race(sfd,sname,tfd,tname):
            if sname.startswith('candidate-') and not foreign:
                row=self.manifest['sources'][int(sname.split('-')[1].split('.')[0])]
                target=self.root/row['path'];target.write_bytes(b'foreign');target.chmod(0o640);foreign.append(target)
            return original(sfd,sname,tfd,tname)
        with patch.object(module,'rename_absent_at',side_effect=race):
            with self.assertRaises(FileExistsError):self.install()
        self.assertEqual(foreign[0].read_bytes(),b'foreign')

    def test_changed_candidate_inode_refuses_and_preserves_evidence(self):
        changed=[]
        def checkpoint():
            if self.created and not changed:
                item=next(iter(self.created.values()));target=pathlib.Path(item['candidatePath'])
                foreign=target.with_name('foreign');foreign.write_bytes(target.read_bytes());foreign.chmod(0o640);os.replace(foreign,target);changed.append(target)
        with self.assertRaisesRegex(ValueError,'Candidate inode or bytes'):self.install(checkpoint)
        self.assertTrue(changed[0].exists())


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

    def test_api_only_write_and_dependent_worker_restart(self):
        self.assertEqual(module.ALLOWED, {'server/proof-api.mjs'})
        self.assertEqual(module.BASE_SOURCE_COMMIT,'3a3d1416659d9332dc0ed71d7abe69543394182f')
        self.assertEqual(len(module.NEW),0)
        self.assertEqual(module.UNITS, ('proofofwork-api.service', 'proofofwork-indexer-worker.service'))
        self.assertEqual(module.PROTECTED, module.UNITS)

    def test_other_controller_or_new_helpers_cannot_authorize_this_release(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['format'] = 'proof-of-work-pages-scoped-runtime-v1'
        with self.assertRaisesRegex(ValueError,'Wrong manifest'):
            module.validate_manifest(manifest)
        for name in ('server/dns-page-link-discovery.mjs', 'src/shared/protocol/dnsPages.mjs'):
            manifest = copy.deepcopy(self.manifest)
            manifest['sources'][0]['path'] = name
            with self.assertRaisesRegex(ValueError,'WORK pending-summary API source allowlist'):
                module.validate_manifest(manifest)

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
            with self.assertRaisesRegex(ValueError,'Captured API process changed'):module.require_protected_services(pins)
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

    def test_worker_phase_fence_accepts_new_pid_only_after_verified_restore(self):
        pins=self.manifest['protectedServices'];unit=module.PROTECTED[0]
        with patch.object(module,'safe_read',return_value=b'unit'),patch.object(module,'sha',return_value='f'*64):
            for phase,row in [('drained',{'ActiveState':'inactive','MainPID':'0','WorkingDirectory':str(module.ROOT)}),
                    ('restored',{'ActiveState':'active','MainPID':'789','WorkingDirectory':str(module.ROOT)})]:
                with patch.object(module,'states',return_value={name:dict(row)for name in module.PROTECTED}):module.require_protected_services(pins,phase)
            for row in [{'ActiveState':'inactive','MainPID':'0','WorkingDirectory':str(module.ROOT)},
                    {'ActiveState':'active','MainPID':'0','WorkingDirectory':str(module.ROOT)},
                    {'ActiveState':'active','MainPID':'789','WorkingDirectory':'/wrong-runtime'}]:
                with patch.object(module,'states',return_value={name:dict(row)for name in module.PROTECTED}):
                    with self.assertRaisesRegex(ValueError,'worker not restored'):module.require_protected_services(pins,'restored')
            with patch.object(module,'states',return_value=pins['states']):
                with self.assertRaisesRegex(ValueError,'worker not drained'):module.require_protected_services(pins,'drained')
            with patch.object(module,'states',return_value={name:{'ActiveState':'active','MainPID':'789','WorkingDirectory':str(module.ROOT)}for name in module.PROTECTED}):
                with self.assertRaisesRegex(ValueError,'Captured API process changed'):module.require_protected_services(pins,'baseline')

    def test_partof_worker_normal_and_rollback_restore_require_active_worker(self):
        authority={unit:{'ActiveState':'active','MainPID':'321','WorkingDirectory':''} for unit in module.AUTHORITY}
        search={module.SEARCH[0]:{'ActiveState':'inactive','MainPID':'0','WorkingDirectory':''},
            module.SEARCH[1]:{'ActiveState':'inactive','MainPID':'0','WorkingDirectory':''}}
        for mode in ('normal','rollback','worker-start-failed'):
            live={unit:'active' for unit in (*module.GATEWAY,*module.UNITS)};calls=[]
            def run(argv,**kwargs):
                action,unit=argv[1:];calls.append((action,unit))
                if action=='stop':
                    live[unit]='inactive'
                    if unit==module.UNITS[0]:live[module.UNITS[1]]='inactive'
                elif not (mode=='worker-start-failed' and unit==module.UNITS[1]):live[unit]='active'
            def states(units):
                if units==module.AUTHORITY:return authority
                if units==module.SEARCH:return search
                return {unit:{'ActiveState':live[unit],'MainPID':'789' if live[unit]=='active' else '0',
                    'WorkingDirectory':str(module.ROOT)} for unit in units}
            def gateway():
                return {unit:{'ActiveState':live[unit],'MainPID':'789' if live[unit]=='active' else '0',
                    'UnitFileState':self.manifest['gateway']['unitFileStates'][unit]} for unit in module.GATEWAY}
            receipt={'installed':False,'rolledBack':False}
            with patch.object(module.subprocess,'run',side_effect=run),patch.object(module,'states',side_effect=states), \
                    patch.object(module,'gateway_states',side_effect=gateway),patch.object(module,'safe_read',return_value=b'held-marker'), \
                    patch.object(module,'sha',return_value='f'*64):
                module.drain_apps();self.assertEqual(live[module.UNITS[1]],'inactive')
                if mode=='worker-start-failed':
                    with self.assertRaisesRegex(ValueError,'Runtime services not restored'):
                        module.restore_verified_apps(self.manifest,authority,search,b'held-marker')
                    self.assertFalse(receipt['rolledBack']);self.assertFalse(receipt['installed'])
                else:
                    services=module.restore_verified_apps(self.manifest,authority,search,b'held-marker')
                    receipt['rolledBack' if mode=='rollback' else 'installed']=True
                    self.assertEqual(services[module.UNITS[1]]['ActiveState'],'active')
                    self.assertEqual(services[module.UNITS[1]]['MainPID'],'789')
                    self.assertTrue(receipt['rolledBack' if mode=='rollback' else 'installed'])
                starts=[unit for action,unit in calls if action=='start']
                self.assertEqual(starts[:2],list(module.UNITS))


    def test_new_relative_import_requires_dependency_pin(self):
        file=self.root/'server/unrelated-audit.mjs'; file.write_bytes(b'export {};\n'); file.chmod(0o640)
        candidates=module.validate_manifest(self.manifest)
        candidates['server/proof-api.mjs']=b"import './unrelated-audit.mjs';\n"
        with self.assertRaisesRegex(ValueError,'Unpinned runtime'): module.fence(self.root,self.manifest,candidates)

    def test_symlink_and_path_escape_refuse(self):
        for path in ('../outside.mjs','server/../../outside.mjs','/tmp/outside.mjs','server//x.mjs'):
            with self.assertRaises(ValueError): module.source_path(path)
        target=self.root/'server/proof-api.mjs'; target.unlink(); target.symlink_to(self.root/'scripts/backfill-proof-indexer.mjs')
        with self.assertRaisesRegex(ValueError,'Unsafe source'): module.safe_read(target)





    def test_new_baselines_are_strictly_creation_only(self):
        for name in module.ALLOWED:
            value=copy.deepcopy(self.manifest)
            row=next(row for row in value['sources'] if row['path']==name)
            row['before']='a'*64 if name in module.NEW else None
            with self.assertRaisesRegex(ValueError,'creation-only'):module.validate_manifest(value)







    def test_dependency_metadata_drift_is_fenced(self):
        (self.root/module.METADATA_TEMPLATE).chmod(0o600)
        with self.assertRaisesRegex(ValueError,'metadata changed'):
            module.fence(self.root,self.manifest,module.validate_manifest(self.manifest))






    def test_restart_configuration_changes_refuse_without_exposing_properties(self):
        with patch.object(module,'restart_configuration_pin',return_value='a'*64):
            module.require_restart_configuration('a'*64)
            with self.assertRaisesRegex(ValueError,'Restart configuration changed'):
                module.require_restart_configuration('b'*64)



    def test_worker_wrapper_cannot_be_omitted_from_dependency_boundary(self):
        value=copy.deepcopy(self.manifest);name='scripts/run-proof-indexer-worker.mjs'
        del value['dependencies'][name];del value['dependencyMetadata'][name]
        with self.assertRaisesRegex(ValueError,'Unpinned runtime'):
            module.fence(self.root,value,module.validate_manifest(value))









    def test_exec_start_normalization_preserves_static_command_and_all_observed_states(self):
        stopped_api=EXEC_START_ACTIVE.replace('stop_time=[n/a]','stop_time=[Sun 2026-10-25 15:42:38 UTC]').replace('code=(null)','code=killed').replace('status=0/0','status=15/TERM')
        stopped_worker=stopped_api.replace('code=killed','code=exited').replace('status=15/TERM','status=0')
        restarted=EXEC_START_ACTIVE.replace('Sat 2026-10-24 18:44:16 UTC','Sun 2026-10-25 15:50:00 UTC').replace('pid=3713663','pid=4000001')
        expected=EXEC_START_ACTIVE.split(' ; start_time=')[0]+' ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }'
        for value in (EXEC_START_ACTIVE,stopped_api,stopped_worker,restarted):
            with self.subTest(value=value):
                self.assertEqual(module.normalize_exec_start(value),expected)

    def test_restart_pin_survives_process_lifecycle_but_binds_static_configuration(self):
        env=self.root/'restart.env';env.write_bytes(b'OTHER_SECRET=private\n');env.chmod(0o600)
        unit=self.root/'restart.service';unit.write_bytes(b'[Service]\n');unit.chmod(0o600)
        properties={'Environment':'OTHER_SECRET=private','EnvironmentFiles':str(env)+' (ignore_errors=no)',
            'ExecStart':EXEC_START_ACTIVE,'WorkingDirectory':str(self.root),'FragmentPath':str(unit),
            'DropInPaths':'','PassEnvironment':'','UnsetEnvironment':''}
        def ctl(*args):return '' if args==('show-environment',) else ('' if args[-1]=='ExecStart' and args[1].endswith('.socket') else properties.get(args[-1],''))
        with patch.object(module,'ctl',side_effect=ctl):
            baseline=module.restart_configuration_pin()
            drained=EXEC_START_ACTIVE.replace('stop_time=[n/a]','stop_time=[Sun 2026-10-25 15:42:38 UTC]').replace('code=(null)','code=killed').replace('status=0/0','status=15/TERM')
            restarted=EXEC_START_ACTIVE.replace('Sat 2026-10-24 18:44:16 UTC','Sun 2026-10-25 15:50:00 UTC').replace('pid=3713663','pid=4000001')
            for value in (drained,restarted):
                properties['ExecStart']=value
                self.assertEqual(module.restart_configuration_pin(),baseline)
                module.require_restart_configuration(baseline)
            changes=[('ExecStart',EXEC_START_ACTIVE.replace('path=/opt/node/bin/node','path=/opt/other/bin/node')),
                ('ExecStart',EXEC_START_ACTIVE.replace('server/proof-api.mjs','server/other-api.mjs')),
                ('ExecStart',EXEC_START_ACTIVE.replace('ignore_errors=no','ignore_errors=yes')),
                ('Environment','OTHER_SECRET=changed'),('WorkingDirectory',str(self.root/'different')),
                ('PassEnvironment','OTHER_SETTING'),('UnsetEnvironment','OTHER_SETTING')]
            properties['ExecStart']=EXEC_START_ACTIVE
            for key,value in changes:
                with self.subTest(property=key):
                    original=properties[key];properties[key]=value
                    with self.assertRaisesRegex(ValueError,'Restart configuration changed'):
                        module.require_restart_configuration(baseline)
                    properties[key]=original
            for file in (env,unit):
                original=file.read_bytes();file.write_bytes(original+b'# changed\n')
                with self.assertRaisesRegex(ValueError,'Restart configuration changed'):
                    module.require_restart_configuration(baseline)
                file.write_bytes(original)

    def test_exec_start_unknown_or_malformed_serialization_refuses(self):
        malformed=[EXEC_START_ACTIVE+' '+EXEC_START_ACTIVE,
            EXEC_START_ACTIVE.replace(' ; pid=',' ; unknown=value ; pid='),
            EXEC_START_ACTIVE.replace('pid=3713663','pid=-1'),
            EXEC_START_ACTIVE.replace('code=(null)','code=unknown'),
            EXEC_START_ACTIVE.replace('status=0/0','status=unknown'),
            EXEC_START_ACTIVE.replace('status=0/0','status=0/unknown'),
            EXEC_START_ACTIVE.replace('stop_time=[n/a]','stop_time=n/a'),
            EXEC_START_ACTIVE.replace(' UTC]',' LOCAL]'),
            EXEC_START_ACTIVE.replace('ignore_errors=no','ignore_errors=maybe'),
            EXEC_START_ACTIVE.replace(' ; code=(null)',''),
            EXEC_START_ACTIVE.replace('server/proof-api.mjs','server/proof-api.mjs\n'),
            '/opt/node/bin/node server/proof-api.mjs']
        for value in malformed:
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError,'Unsupported ExecStart serialization'):
                    module.normalize_exec_start(value)


    def exercise_actual_main_restart_lifecycle(self,fail_postflight):
        unit=self.root/'lifecycle.service';unit.write_bytes(b'[Service]\n');unit.chmod(0o600)
        hold=self.root/'search-hold';hold.write_bytes(b'exact held marker');hold.chmod(0o600)
        properties={'Environment':'','EnvironmentFiles':'','PassEnvironment':'','UnsetEnvironment':'',
            'ExecStart':EXEC_START_ACTIVE,'WorkingDirectory':str(self.root),
            'FragmentPath':str(unit),'DropInPaths':''}
        def ctl(*args):return '' if args==('show-environment',) else ('' if args[-1]=='ExecStart' and args[1].endswith('.socket') else properties.get(args[-1],''))
        restores=[]
        def drain():
            properties['ExecStart']=EXEC_START_ACTIVE.replace('stop_time=[n/a]',
                'stop_time=[Sun 2026-10-25 15:42:38 UTC]').replace('code=(null)','code=killed').replace('status=0/0','status=15/TERM')
        def restore(*args):
            properties['ExecStart']=EXEC_START_ACTIVE.replace('pid=3713663','pid=4000001').replace(
                'Sat 2026-10-24 18:44:16 UTC','Sun 2026-10-25 15:50:00 UTC')
            restores.append(True);return {}
        def postflight(*args):
            if fail_postflight:raise ValueError('injected canonical postflight refusal')
            return {'ready':False}
        tree=ast.parse(pathlib.Path(module.__file__).read_bytes())
        main=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
        transaction=next(node for node in main.body if isinstance(node,ast.Try))
        program=ast.fix_missing_locations(ast.Module(body=[transaction],type_ignores=[]))
        candidates=module.validate_manifest(self.manifest)
        receipt={'sourceWritesStarted':False,'installed':False,'rolledBack':False,'createdHelpers':self.created}
        env={**vars(module),'ROOT':self.root,'HOLD':hold,'m':self.manifest,'candidates':candidates,
            'receipt':receipt,'backup':self.backup,'metadata':self.metadata,'stamp':'lifecycle',
            'authority':{},'search':{},'hold_raw':hold.read_bytes(),'states':lambda units:{},
            'require_protected_services':lambda *args:None,'require_apps_drained':lambda:None,
            'restore_verified_apps':restore,'drain_apps':drain,'require_postflight':postflight,
            'require_rehearsal_binding':lambda m:None,
            'accepted_inventory_fence':lambda *args:None,'predeployment_probe':lambda *args:{'qualified':True},'node':None,'probe':None,'probe_root':None,'environment':{},
            'save':lambda:None,'print':lambda *args,**kwargs:None}
        with patch.object(module,'ctl',side_effect=ctl):
            self.manifest['restartConfigurationSha256']=module.restart_configuration_pin()
            if fail_postflight:
                with self.assertRaisesRegex(ValueError,'Source writes started'):
                    exec(compile(program,'actual-main-lifecycle','exec'),env)
            else:
                exec(compile(program,'actual-main-lifecycle','exec'),env)
            module.require_restart_configuration(self.manifest['restartConfigurationSha256'])
        if fail_postflight:
            self.assertTrue(receipt['recoveryIncomplete']);self.assertTrue(receipt['forwardRecoveryRequired'])
            self.assertTrue(receipt['sourceRollbackProhibited'])
        else:self.assertNotIn('recoveryIncomplete',receipt)
        self.assertFalse(receipt['rolledBack'])
        self.assertEqual(len(restores),1)
        for row in self.manifest['sources']:
            file=self.root/row['path'];expected=row['after']
            self.assertEqual(module.sha(file.read_bytes()) if file.exists() else None,expected)

    def test_actual_postwrite_failure_preserves_read_code_and_requires_forward_recovery(self):
        self.exercise_actual_main_restart_lifecycle(True)

    def test_actual_main_forward_keeps_configuration_pin_across_drain_and_restore(self):
        self.exercise_actual_main_restart_lifecycle(False)




    def healthy(self,height=973285):
        h='a'*64
        return {'ok':True,'ready':True,'tipHeight':height,'indexedThroughBlock':height,'lagBlocks':0,
            'checks':{'node':{'ok':True,'tipHeight':height,'bestBlockHash':h,'initialBlockDownload':False,'txindexSynced':True},
                'index':{'complete':True,'checkpointCanonical':True,'checkpointHash':h,'canonicalCheckpointHash':h,
                    'indexedThroughBlock':height,'scanTipHeight':height,'summarySnapshot':{'ok':True,'eligible':True,
                        'indexedThroughBlock':height,'blockHash':h,'snapshotId':'fresh-summary',
                        'coverageByKey':{key:height for key in module.SUMMARY_KEYS}}},
                'worker':{'ok':True,'proofReady':True,'consecutiveFailures':0}}}

    def test_degraded_worker_restart_loop_is_allowed_but_api_and_working_directory_are_exact(self):
        baseline=copy.deepcopy(self.manifest['protectedServices']['states'])
        baseline[module.UNITS[1]].update(ActiveState='activating',MainPID='0')
        for phase,pid in [('failed','0'),('inactive','0'),('activating','0'),('active','987')]:
            actual=copy.deepcopy(baseline);actual[module.UNITS[1]].update(ActiveState=phase,MainPID=pid)
            module.require_service_baseline(actual,baseline)
        actual=copy.deepcopy(baseline);actual[module.UNITS[0]]['MainPID']='999'
        with self.assertRaisesRegex(ValueError,'API process changed'):module.require_service_baseline(actual,baseline)
        actual=copy.deepcopy(baseline);actual[module.UNITS[1]]['WorkingDirectory']='/foreign'
        with self.assertRaises(ValueError):module.require_service_baseline(actual,baseline)
        actual=copy.deepcopy(baseline);actual[module.UNITS[1]]['MainPID']='999'
        with self.assertRaises(ValueError):module.require_service_baseline(actual,baseline)

    def test_healthy_process_with_old_summary_or_partial_coverage_cannot_pass(self):
        for key,value in [('indexedThroughBlock',973283),('blockHash','b'*64),('eligible',False),('ok',False)]:
            h=self.healthy();h['checks']['index']['summarySnapshot'][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'summary'):module.canonical_health(h)
        for key in module.SUMMARY_KEYS:
            h=self.healthy();h['checks']['index']['summarySnapshot']['coverageByKey'][key]=973283
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'summary'):module.canonical_health(h)

    def test_index_or_worker_failure_cannot_be_hidden_by_top_level_ok(self):
        for key,value in [('checkpointCanonical',False),('checkpointHash','b'*64),('scanTipHeight',973283)]:
            h=self.healthy();h['checks']['index'][key]=value
            with self.assertRaises(ValueError):module.canonical_health(h)
        h=self.healthy();h['checks']['worker']['consecutiveFailures']=1
        with self.assertRaisesRegex(ValueError,'worker'):module.canonical_health(h)

    def test_postflight_requires_ready_same_tip_batch_and_two_equal_health_reads(self):
        h=self.healthy();authority=self.manifest['batchAuthority']
        batch={**authority,'ready':True,'checkedTipHeight':973285,'checkedTipHash':'a'*64}
        with patch.object(module,'local_json',side_effect=[h,batch,h]):
            proof=module.require_postflight(authority)
        self.assertTrue(proof['summaryCaughtUp']);self.assertEqual(proof['tipHeight'],973285)
        for changed in [{**batch,'ready':False},{**batch,'checkedTipHash':'b'*64},
                {**batch,'declarationTxid':'0'*64}]:
            with patch.object(module,'local_json',side_effect=[h,changed]),patch.object(module.time,'monotonic',side_effect=[0,3601]):
                with self.assertRaisesRegex(ValueError,'postflight unavailable'):module.require_postflight(authority)
        with patch.object(module,'local_json',side_effect=[h,batch,self.healthy(973286)]),patch.object(module.time,'monotonic',side_effect=[0,3601]):
            with self.assertRaisesRegex(ValueError,'postflight unavailable'):module.require_postflight(authority)

    def test_prewrite_configuration_refusal_preserves_old_source_and_records_baseline_recovery(self):
        hold=self.root/'hold';hold.write_bytes(b'held')
        tree=ast.parse(pathlib.Path(module.__file__).read_bytes())
        main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
        transaction=next(n for n in main.body if isinstance(n,ast.Try))
        code=compile(ast.fix_missing_locations(ast.Module(body=[transaction],type_ignores=[])),'actual-main-prewrite','exec')
        receipt={'sourceWritesStarted':False,'installed':False,'rolledBack':False,'createdHelpers':{}}
        restore=Mock(return_value={});config=Mock(side_effect=[ValueError('configuration changed'),None])
        env={**vars(module),'ROOT':self.root,'HOLD':hold,'m':self.manifest,'candidates':module.validate_manifest(self.manifest),
            'receipt':receipt,'backup':self.backup,'metadata':self.metadata,'stamp':'prewrite','authority':{},'search':{},
            'hold_raw':b'held','states':lambda units:{},'require_protected_services':lambda *a:None,'drain_apps':lambda:None,
            'require_restart_configuration':config,'accepted_inventory_fence':lambda *a:None,
            'restore_baseline_apps':restore,'save':lambda:None,'print':lambda *a,**kw:None}
        with self.assertRaisesRegex(ValueError,'configuration changed'):exec(code,env)
        self.assertFalse(receipt['sourceWritesStarted']);self.assertFalse(receipt['installed']);self.assertTrue(receipt['rolledBack'])
        restore.assert_called_once()
        for row in self.manifest['sources']:self.assertEqual(module.sha((self.root/row['path']).read_bytes()),row['before'])

    def test_prewrite_recovery_leaves_previously_failed_worker_quiescent(self):
        m=copy.deepcopy(self.manifest);m['protectedServices']['states'][module.UNITS[1]].update(ActiveState='failed',MainPID='0')
        actual=copy.deepcopy(m['protectedServices']['states']);actual[module.UNITS[1]]['ActiveState']='inactive'
        def states(units):return actual if units==module.UNITS else {}
        with patch.object(module,'states',side_effect=states),patch.object(module.subprocess,'run')as run,\
            patch.object(module,'gateway_states',return_value={}),patch.object(module,'require_gateway_baseline'),\
            patch.object(module,'safe_read',return_value=b'held'),patch.object(module,'require_restart_configuration'):
            self.assertEqual(module.restore_baseline_apps(m,{}, {},b'held'),actual)
        starts=[call.args[0][-1]for call in run.call_args_list]
        self.assertIn(module.UNITS[0],starts);self.assertNotIn(module.UNITS[1],starts)

    def qualification(self):
        families=[{'txid':tx,'height':h,'recipientCount':count,'parentCount':1,'childCount':count,
            'registryPaymentSats':546,'minerFeeSats':miner if miner is not None else 623,'zeroFeeChildren':True}
            for tx,(h,count,miner) in module.KNOWN_FAMILIES.items()]
        pending={'txid':module.PENDING_BATCH_TXID,'state':'pending','inputCount':189,'uniqueKeys':189,
            'preservedCount':189,'canonicalPendingTransfers':0,'canonicalPendingParents':0,'identityError':False}
        call={'ok':True,'published':False,'publicationAccountingCurrent':True,'indexedThroughBlock':973575,
            'indexedThroughBlockHash':'f'*64,'snapshotId':'a'*24,'summaryKeys':sorted(module.SUMMARY_KEYS),
            'knownConfirmedFamilies':families,'pendingHistoryProof':pending}
        result={**copy.deepcopy(call),'format':'work-batch-pending-summary-readonly-rehearsal-v1',
            'twoCalls':True,'calls':[copy.deepcopy(call),copy.deepcopy(call)]}
        adapters={name:'a'*64 for name in module.REHEARSAL_ADAPTERS}
        refs={name:{'path':'/tmp/offline-rehearsal/'+name,'sha256':'a'*64,'bytes':1} for name in module.REHEARSAL_EVIDENCE}
        return {'format':'work-batch-pending-summary-rehearsal-qualified-v1','qualified':True,'planSha256':'b'*64,
            'sourceCommit':self.manifest['sourceCommit'],'sourceTree':self.manifest['sourceTree'],'releaseId':self.manifest['releaseId'],
            'candidateHashes':{r['path']:r['after'] for r in self.manifest['sources']},'dependencyHashes':self.manifest['dependencies'],
            'rehearsalHelperSha256':'c'*64,'result':result,'adapterHashes':adapters,'evidenceReferences':refs,
            'dispatchSha256':'a'*64,'unit':'pow-pending-offline.service','invocationId':'1'*32,
            'nativeProperties':{'LoadState':'loaded','ActiveState':'active','SubState':'exited','MainPID':'0',
                'ExecMainStatus':'0','Result':'success','InvocationID':'1'*32,
                'ProtectSystem':'strict','NoNewPrivileges':'yes','ReadWritePaths':'','User':'powadmin',
                'WorkingDirectory':str(module.ROOT),'MemoryMax':str(2*1024**3),'MemorySwapMax':'0',
                'CPUQuotaPerSecUSec':'1s','RuntimeMaxUSec':'5min','TimeoutStopUSec':'15s',
                'KillMode':'control-group','RemainAfterExit':'yes'}}

    def test_rehearsal_actual_accounting_and_family_contract(self):
        q=self.qualification();module.validate_rehearsal(q,'b'*64,self.manifest,'c'*64)
        mutations=[lambda x:x.update(sourceTree='f'*40),lambda x:x.update(candidateHashes={}),
            lambda x:x.update(dependencyHashes={}),lambda x:x.update(rehearsalHelperSha256='f'*64),
            lambda x:x['result'].update(publicationAccountingCurrent=False),lambda x:x['result'].update(twoCalls=False),
            lambda x:x['result'].update(calls=x['result']['calls'][:1]),
            lambda x:x['result']['calls'][0].update(indexedThroughBlockHash='0'*64),
            lambda x:x['result']['calls'][0]['knownConfirmedFamilies'][0].update(childCount=11),
            lambda x:x['result']['calls'][0]['knownConfirmedFamilies'][0].update(registryPaymentSats=1092),
            lambda x:x['result']['calls'][0]['knownConfirmedFamilies'][0].update(minerFeeSats=0),
            lambda x:x['result']['calls'][0]['pendingHistoryProof'].update(uniqueKeys=1),
            lambda x:x['result']['calls'][0]['pendingHistoryProof'].update(canonicalPendingTransfers=189),
            lambda x:x['result']['calls'][0]['pendingHistoryProof'].update(identityError=True),
            lambda x:x['result']['calls'][0].update(published=True),
            lambda x:x['nativeProperties'].update(MainPID='123'),
            lambda x:x['nativeProperties'].update(ExecMainStatus='1'),
            lambda x:x['nativeProperties'].update(InvocationID='2'*32),
            lambda x:x['adapterHashes'].pop('worker.mjs'),lambda x:x['evidenceReferences'].pop('dispatch.json'),
            lambda x:x['evidenceReferences']['api.mjs'].update(sha256='b'*64)]
        for index,mutate in enumerate(mutations):
            changed=copy.deepcopy(q);mutate(changed)
            with self.subTest(index=index),self.assertRaises(ValueError):module.validate_rehearsal(changed,'b'*64,self.manifest,'c'*64)

    def test_rehearsal_allows_observed_confirmation_or_eviction_without_faking_pending(self):
        for state in ('absent','confirmed'):
            q=self.qualification();r=q['result']
            for target in [r,*r['calls']]:
                p=target['pendingHistoryProof'];p.update(state=state,inputCount=0,uniqueKeys=0,preservedCount=0)
                if state=='confirmed':p['confirmedFamily']={'txid':module.PENDING_BATCH_TXID,'height':973575,
                    'recipientCount':189,'parentCount':1,'childCount':189,'registryPaymentSats':546,
                    'minerFeeSats':3123,'zeroFeeChildren':True}
            module.validate_rehearsal(q,'b'*64,self.manifest,'c'*64)
            if state=='confirmed':
                q['result']['calls'][0]['pendingHistoryProof']['confirmedFamily']['childCount']=188
                with self.assertRaises(ValueError):module.validate_rehearsal(q,'b'*64,self.manifest,'c'*64)

    def test_rehearsal_file_changed_refuses_at_scoped_writer(self):
        q=self.qualification();file=self.root.parent/'qualification';raw=json.dumps(q).encode();file.write_bytes(raw);file.chmod(0o600)
        self.manifest['rehearsal']={'path':str(file),'sha256':module.sha(raw),'planSha256':'b'*64,'helperSha256':'c'*64}
        module.require_rehearsal_binding(self.manifest)
        file.write_bytes(raw+b' ')
        with self.assertRaisesRegex(ValueError,'qualification changed'):module.require_rehearsal_binding(self.manifest)

    def test_wrong_accepted_inventory_and_patch_provenance_refuse(self):
        changed=copy.deepcopy(self.manifest);changed['acceptedInventorySha256']='f'*64
        with self.assertRaisesRegex(ValueError,'V6 overlay inventory'):module.validate_manifest(changed)
        changed=copy.deepcopy(self.manifest);changed['patchProvenance']['patchCommit']='f'*40
        with self.assertRaisesRegex(ValueError,'patch provenance'):module.validate_manifest(changed)
        with self.assertRaisesRegex(ValueError,'approved V6'):module.accepted_inventory_fence('f'*64)

if __name__ == '__main__': unittest.main()
