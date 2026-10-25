#!/usr/bin/env python3
"""Local filesystem tests; never contact production or invoke services."""
import ast, base64, copy, importlib.util, json, os, pathlib, subprocess, tempfile, unittest
from unittest.mock import Mock, MagicMock, patch

spec = importlib.util.spec_from_file_location('work-batch-sends_scoped_node', pathlib.Path(__file__).with_name('scoped-node.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

EXEC_START_ACTIVE = ('{ path=/opt/node/bin/node ; argv[]=/opt/node/bin/node server/proof-api.mjs'
    ' ; ignore_errors=no ; start_time=[Sat 2026-10-24 18:44:16 UTC] ; stop_time=[n/a]'
    ' ; pid=3713663 ; code=(null) ; status=0/0 }')

class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        private=pathlib.Path(self.temp.name)/'quarantine';private.mkdir(mode=0o700)
        mock=patch.object(module,'QUARANTINE_PARENT',private);mock.start();self.addCleanup(mock.stop)
        self.root = pathlib.Path(self.temp.name)/'runtime'; self.root.mkdir(mode=0o700)
        self.created = {}
        self.backup = pathlib.Path(self.temp.name)/'backup'; self.backup.mkdir(mode=0o700)
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
        self.manifest = {'format':'proof-of-work-work-batch-sends-scoped-runtime-v1',
            'baseSourceCommit':module.BASE_SOURCE_COMMIT,
            'releaseId':'abcdef123456-20261007T010000Z', 'services':list(module.UNITS),
            'sourceCommit':'abcdef123456'+'a'*28, 'baselineHead':'b'*40, 'sources':rows,
            'dormantConfigurationSha256':'a'*64, 'dependencies':deps,
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

    def test_exact_api_and_reader_writes_and_dependent_worker_restart(self):
        self.assertEqual(module.ALLOWED, {
            'server/proof-api.mjs','server/db/proof-index-reader.mjs','server/work-amo-v5-raw.mjs',
            'scripts/backfill-proof-indexer.mjs','server/work-batch-declaration.mjs',
            'server/work-batch-runtime.mjs','server/work-batch-selection.mjs','server/work-batch-transaction.mjs',
            'server/db/work-batch-reader.mjs','src/shared/protocol/workBatch.mjs'})
        self.assertEqual(module.BASE_SOURCE_COMMIT,'c43cd395cf24701b080a2cf2a5c965d9c008a120')
        self.assertEqual(len(module.NEW),6)
        self.assertEqual(module.UNITS, ('proofofwork-api.service', 'proofofwork-indexer-worker.service'))
        self.assertEqual(module.PROTECTED, module.UNITS)

    def test_pages_scope_and_manifest_cannot_authorize_api_response_latency_release(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['format'] = 'proof-of-work-pages-scoped-runtime-v1'
        with self.assertRaisesRegex(ValueError,'Wrong manifest'):
            module.validate_manifest(manifest)
        for name in ('server/dns-page-link-discovery.mjs', 'src/shared/protocol/dnsPages.mjs'):
            manifest = copy.deepcopy(self.manifest)
            manifest['sources'][0]['path'] = name
            with self.assertRaisesRegex(ValueError,'WORK batch sends source allowlist'):
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

    def test_worker_phase_fence_accepts_new_pid_only_after_verified_restore(self):
        pins=self.manifest['protectedServices'];unit=module.PROTECTED[0]
        with patch.object(module,'safe_read',return_value=b'unit'),patch.object(module,'sha',return_value='f'*64):
            for phase,row in [('drained',{'ActiveState':'inactive','MainPID':'0','WorkingDirectory':str(module.ROOT)}),
                    ('restored',{'ActiveState':'active','MainPID':'789','WorkingDirectory':str(module.ROOT)})]:
                with patch.object(module,'states',return_value={unit:row}):module.require_protected_services(pins,phase)
            for row in [{'ActiveState':'inactive','MainPID':'0','WorkingDirectory':str(module.ROOT)},
                    {'ActiveState':'active','MainPID':'0','WorkingDirectory':str(module.ROOT)},
                    {'ActiveState':'active','MainPID':'789','WorkingDirectory':'/wrong-runtime'}]:
                with patch.object(module,'states',return_value={unit:row}):
                    with self.assertRaisesRegex(ValueError,'worker not restored'):module.require_protected_services(pins,'restored')
            with patch.object(module,'states',return_value=pins['states']):
                with self.assertRaisesRegex(ValueError,'worker not drained'):module.require_protected_services(pins,'drained')
            with patch.object(module,'states',return_value={unit:{'ActiveState':'active','MainPID':'789','WorkingDirectory':str(module.ROOT)}}):
                with self.assertRaisesRegex(ValueError,'Protected service changed'):module.require_protected_services(pins,'baseline')

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

    def test_drift_refuses_before_any_write(self):
        path=self.root/'server/proof-api.mjs'; path.write_bytes(b'unrelated concurrent audit change')
        with self.assertRaisesRegex(ValueError,'Source changed'): module.fence(self.root,self.manifest,module.validate_manifest(self.manifest))
        self.assertEqual(path.read_bytes(),b'unrelated concurrent audit change')
        with self.assertRaisesRegex(ValueError,'unexpected source'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'test',self.created)
        self.assertEqual(path.read_bytes(), b'unrelated concurrent audit change')

    def test_new_relative_import_requires_dependency_pin(self):
        file=self.root/'server/unrelated-audit.mjs'; file.write_bytes(b'export {};\n'); file.chmod(0o640)
        candidates=module.validate_manifest(self.manifest)
        candidates['server/db/proof-index-reader.mjs']=b"import '../unrelated-audit.mjs';\n"
        candidates['server/proof-api.mjs']=b"import './db/proof-index-reader.mjs';\n"
        with self.assertRaisesRegex(ValueError,'Unpinned runtime'): module.fence(self.root,self.manifest,candidates)

    def test_symlink_and_path_escape_refuse(self):
        for path in ('../outside.mjs','server/../../outside.mjs','/tmp/outside.mjs','server//x.mjs'):
            with self.assertRaises(ValueError): module.source_path(path)
        target=self.root/'server/proof-api.mjs'; target.unlink(); target.symlink_to(self.root/'scripts/backfill-proof-indexer.mjs')
        with self.assertRaisesRegex(ValueError,'Unsafe source'): module.safe_read(target)

    def test_install_and_rollback_preserve_original_bytes_metadata_and_new_helpers(self):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'test',self.created)
        for row in self.manifest['sources']:
            self.assertEqual(module.sha((self.root/row['path']).read_bytes()),row['after'])
            self.assertEqual((self.root/row['path']).stat().st_mode & 0o777,0o640)
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'test',self.created)
        for row in self.manifest['sources']:
            file=self.root/row['path']
            self.assertEqual(module.sha(file.read_bytes()) if file.exists() else None,row['before'])

    def test_partial_install_recovers_without_erasing_external_change(self):
        real_replace=os.replace; writes=0
        def interrupted(source,target):
            nonlocal writes
            writes+=1
            result = real_replace(source,target)
            if writes==1: raise OSError('injected filesystem failure after atomic replacement')
            return result
        with patch.object(module.os,'replace',side_effect=interrupted):
            with self.assertRaisesRegex(OSError,'injected'):
                module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'partial',self.created)
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'partial',self.created)
        for row in self.manifest['sources']:
            file=self.root/row['path']
            self.assertEqual(module.sha(file.read_bytes()) if file.exists() else None,
                row['before'])
        file=self.root/'server/proof-api.mjs'; file.write_bytes(b'new audit authority')
        with self.assertRaisesRegex(ValueError,'unexpected source'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'refuse',self.created)
        self.assertEqual(file.read_bytes(),b'new audit authority')

    def test_dependency_drift_blocks_actual_rollback_recovery_and_retains_search_hold(self):
        # Execute the real main recovery handler, replacing only host/service
        # boundaries. A concurrent preserved-overlay change must not authorize
        # restarting applications or restoring Search after source rollback.
        path=self.root/'server/accepted-inactive-overlay.mjs'
        path.write_bytes(b'// accepted overlay\nexport {};\n');path.chmod(0o640)
        self.manifest['dependencies'][str(path.relative_to(self.root))]=module.sha(path.read_bytes())
        self.manifest['dependencyMetadata'][str(path.relative_to(self.root))]={'uid':path.stat().st_uid,
            'gid':path.stat().st_gid,'mode':path.stat().st_mode&0o777}
        candidates=module.validate_manifest(self.manifest)
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'drift',self.created)
        path.write_bytes(b'// concurrent external change\nexport {};\n')
        tree=ast.parse(pathlib.Path(module.__file__).read_bytes())
        main=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='main')
        recovery=next(node for node in main.body if isinstance(node,ast.Try))
        refusal=ast.Raise(exc=ast.Call(func=ast.Name(id='ValueError',ctx=ast.Load()),
            args=[ast.Constant('injected post-drain dependency refusal')],keywords=[]),cause=None)
        program=ast.fix_missing_locations(ast.Module(body=[ast.Try(body=[refusal],
            handlers=recovery.handlers,orelse=[],finalbody=[])],type_ignores=[]))
        receipt={'sourceWritesStarted':True,'rolledBack':False,'createdHelpers':self.created}
        restore=Mock();drain=Mock();printed=[]
        env={**vars(module),'ROOT':self.root,'m':self.manifest,'candidates':candidates,
            'receipt':receipt,'backup':self.backup,'metadata':self.metadata,'stamp':'drift',
            'authority':{},'search':{},'hold_raw':b'exact held marker',
            'require_restart_configuration':lambda expected:None,'restore_verified_apps':restore,'drain_apps':drain,'save':lambda:None,
            'print':lambda value,**kwargs:printed.append(value)}
        with self.assertRaisesRegex(ValueError,'Dependency changed'):
            exec(compile(program,'actual-rollback-handler','exec'),env)
        self.assertTrue(receipt['recoveryIncomplete']);self.assertFalse(receipt['rolledBack'])
        self.assertEqual(receipt['recoveryErrorClass'],'ValueError')
        restore.assert_not_called();drain.assert_called_once_with()
        for row in self.manifest['sources']:
            self.assertEqual(module.sha((self.root/row['path']).read_bytes()) if (self.root/row['path']).exists() else None,row['before'])
        self.assertEqual(path.read_bytes(),b'// concurrent external change\nexport {};\n')
        supervisor_spec=importlib.util.spec_from_file_location('availability_drift_supervisor',
            pathlib.Path(__file__).with_name('rollout-node.py'))
        supervisor=importlib.util.module_from_spec(supervisor_spec);supervisor_spec.loader.exec_module(supervisor)
        child=Mock();child.returncode=1
        child.communicate.return_value=(printed[-1].encode(),b'dependency drift retained')
        with patch.object(supervisor.subprocess,'Popen',return_value=child):
            with self.assertRaisesRegex(supervisor.ControllerStillRunning,'recovery is unverified'):
                supervisor.invoke(b'# reviewed fixed controller',require_recovery_receipt=True)


    def test_new_baselines_are_strictly_creation_only(self):
        for name in module.ALLOWED:
            value=copy.deepcopy(self.manifest)
            row=next(row for row in value['sources'] if row['path']==name)
            row['before']='a'*64 if name in module.NEW else None
            with self.assertRaisesRegex(ValueError,'creation-only'):module.validate_manifest(value)

    def test_new_helper_already_present_even_same_bytes_refuses(self):
        row=next(row for row in self.manifest['sources'] if row['path'] in module.NEW)
        target=self.root/row['path'];target.write_bytes(base64.b64decode(row['base64']));target.chmod(0o640)
        with self.assertRaisesRegex(ValueError,'Source changed'):
            module.fence(self.root,self.manifest,module.validate_manifest(self.manifest))
        with self.assertRaisesRegex(ValueError,'unexpected source'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'existing',self.created)
        self.assertTrue(target.exists())

    def test_raced_create_is_never_replaced_or_removed(self):
        original=module.os.link; foreign=[]
        def race(source,target,**kwargs):
            target.write_bytes(b'foreign concurrent source');target.chmod(0o640);foreign.append(target)
            return original(source,target,**kwargs)
        with patch.object(module.os,'link',side_effect=race):
            with self.assertRaises(FileExistsError):
                module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'race',self.created)
        with self.assertRaisesRegex(ValueError,'unowned or changed'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'race',self.created)
        self.assertEqual(foreign[0].read_bytes(),b'foreign concurrent source')

    def test_every_partial_install_recovers_exact_baseline(self):
        rows=self.manifest['sources']
        for count in range(1,len(rows)+1):
            # Each iteration starts from the exact absent/new plus old baseline.
            original=module.os.link;replace=module.os.replace;writes=0
            def interrupted(operation,*args,**kwargs):
                nonlocal writes
                result=operation(*args,**kwargs);writes+=1
                if writes==count:raise OSError('injected after publication')
                return result
            self.created={}
            with patch.object(module.os,'link',side_effect=lambda *a,**k:interrupted(original,*a,**k)), \
                    patch.object(module.os,'replace',side_effect=lambda *a,**k:interrupted(replace,*a,**k)):
                with self.assertRaisesRegex(OSError,'publication'):
                    module.install(self.root,self.backup,rows,self.metadata,True,'partial'+str(count),self.created)
            module.install(self.root,self.backup,rows,self.metadata,False,'partial'+str(count),self.created)
            module.fence(self.root,self.manifest,module.validate_manifest(self.manifest))
            module.metadata_fence(self.root,self.manifest['sourceMetadata'])
            self.assertTrue(all(not (self.root/name).exists() for name in module.NEW))

    def test_same_byte_replacement_inode_and_unknown_ownership_survive(self):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'identity',self.created)
        name=sorted(module.NEW)[0];target=self.root/name
        alternate=target.with_suffix('.foreign');alternate.write_bytes(target.read_bytes());alternate.chmod(0o640)
        os.replace(alternate,target)
        with self.assertRaisesRegex(ValueError,'unowned or changed'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'identity',self.created)
        self.assertTrue(target.exists())
        with self.assertRaisesRegex(ValueError,'unowned or changed'):
            module.owned_creation(target,next(row for row in self.manifest['sources'] if row['path']==name),{})

    def test_changed_bytes_metadata_and_hardlink_are_preserved(self):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'changes',self.created)
        name=sorted(module.NEW)[0];target=self.root/name;row=next(row for row in self.manifest['sources'] if row['path']==name)
        original=target.read_bytes();target.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'unowned or changed'):module.owned_creation(target,row,self.created)
        target.write_bytes(original);target.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'unowned or changed'):module.owned_creation(target,row,self.created)
        target.chmod(0o640);os.link(target,target.with_suffix('.other'))
        with self.assertRaisesRegex(ValueError,'Unsafe source'):module.owned_creation(target,row,self.created)
        self.assertTrue(target.exists())

    def test_quarantine_catches_last_moment_foreign_replacement(self):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'quarantine',self.created)
        name=sorted(module.NEW)[0];target=self.root/name;row=next(row for row in self.manifest['sources'] if row['path']==name)
        original=module.rename_absent;first=True
        def race(source,destination):
            nonlocal first
            if first:
                first=False
                foreign=source.with_suffix('.foreign');foreign.write_bytes(b'concurrent');foreign.chmod(0o640);os.replace(foreign,source)
            original(source,destination)
        with patch.object(module,'rename_absent',side_effect=race):
            with self.assertRaisesRegex(ValueError,'unowned or changed'):
                module.remove_owned_creation(target,row,self.created,'quarantine',lambda:None)
        self.assertEqual(target.read_bytes(),b'concurrent')

    def test_dependency_metadata_drift_is_fenced(self):
        (self.root/module.METADATA_TEMPLATE).chmod(0o600)
        with self.assertRaisesRegex(ValueError,'metadata changed'):
            module.fence(self.root,self.manifest,module.validate_manifest(self.manifest))

    def test_activation_environment_refuses_without_leaking_values(self):
        module.reject_activation_environment({'WORK_BATCH_WRITES_ENABLED':'0','OTHER_SECRET':'hidden'})
        for key in ('WORK_BATCH_DECLARATION_TXID','WORK_BATCH_ACTIVATION_HEIGHT','WORK_BATCH_WRITES_ENABLED'):
            with self.assertRaisesRegex(ValueError,'Dormant deployment') as raised:
                module.reject_activation_environment({key:'1'})
            self.assertNotIn(key,str(raised.exception))

    def test_status_requires_exact_dormant_shape(self):
        value={'protocol':'work-batch-v1','network':'livenet','active':False,'writeEnabled':False,'ready':False,
            'limits':{'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536},'registryFeeProofs':546,
            'declarationTxid':None,'activationHeight':None,'reasonCode':'work-batch-declaration-unconfigured'}
        response=MagicMock();response.status=200;response.__enter__.return_value=response
        opener=Mock();opener.open.return_value=response
        with patch.object(module,'require_dormant_configuration',return_value={}),patch.object(module.urllib.request,'build_opener',return_value=opener):
            response.read.return_value=json.dumps(value).encode()
            self.assertFalse(module.require_dormant_status()['active'])
            for key,changed in [('active',True),('writeEnabled',True),('ready',True),('registryFeeProofs',5460),
                    ('declarationTxid','a'*64),('limits',{'minRecipients':2,'maxRecipients':78,'maxPayloadBytes':65536})]:
                response.read.return_value=json.dumps({**value,key:changed}).encode()
                with self.assertRaisesRegex(ValueError,'exactly dormant'):module.require_dormant_status()



    def test_environment_file_rejects_multiline_quotes_whitespace_keys_and_continuations(self):
        for value in (b'WORK_BATCH_DECLARATION_TXID="\nabc\n"\n',
                b'WORK_BATCH_DECLARATION_TXID = abc\n',b'WORK_BATCH_WRITES_ENABLED = "1"\n',
                b'WORK_BATCH_ACTIVATION_HEIGHT=\\\n123\n'):
            with self.assertRaisesRegex(ValueError,'Dormant deployment'):
                module.inspect_batch_environment_file(value)
        module.inspect_batch_environment_file(b'WORK_BATCH_DECLARATION_TXID = ""\nWORK_BATCH_WRITES_ENABLED = "0"\n')
        module.inspect_batch_environment_file(b'# WORK_BATCH_WRITES_ENABLED=1\nOTHER_SECRET=hidden\n')

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

    def test_rollback_removal_uses_root_private_directory(self):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'private',self.created)
        name=sorted(module.NEW)[0];target=self.root/name;row=next(row for row in self.manifest['sources'] if row['path']==name)
        original=pathlib.Path.unlink;removed=[]
        def checked(path,*args,**kwargs):
            if path.name=='owned.mjs':
                self.assertEqual(path.parent.stat().st_uid,0)
                self.assertEqual(path.parent.stat().st_mode&0o777,0o700)
                self.assertNotEqual(path.parent,target.parent);removed.append(path)
            return original(path,*args,**kwargs)
        with patch.object(pathlib.Path,'unlink',checked):
            module.remove_owned_creation(target,row,self.created,'private',lambda:None)
        self.assertEqual(len(removed),1);self.assertFalse(target.exists())



    def test_restart_pin_reads_mocked_environment_files_and_detects_staged_activation(self):
        env=self.root/'batch.env';env.write_bytes(b'WORK_BATCH_WRITES_ENABLED=0\n');env.chmod(0o600)
        unit=self.root/'api.service';unit.write_bytes(b'[Service]\n');unit.chmod(0o600)
        properties={'Environment':'OTHER_SECRET=never-printed','EnvironmentFiles':str(env)+' (ignore_errors=no)',
            'ExecStart':EXEC_START_ACTIVE,'WorkingDirectory':str(self.root),
            'FragmentPath':str(unit),'DropInPaths':'','PassEnvironment':'','UnsetEnvironment':''}
        with patch.object(module,'ctl',side_effect=lambda *args:'' if args==('show-environment',) else properties[args[-1]]):
            before=module.restart_configuration_pin();self.assertRegex(before,'^[0-9a-f]{64}$')
            env.write_bytes(b'WORK_BATCH_WRITES_ENABLED=""\n')
            self.assertNotEqual(module.restart_configuration_pin(),before)
            env.write_bytes(b'WORK_BATCH_DECLARATION_TXID="\nabc\n"\n')
            with self.assertRaisesRegex(ValueError,'Dormant deployment'):
                module.restart_configuration_pin()



    def test_inherited_manager_activation_refuses(self):
        with patch.object(module,'ctl',return_value='WORK_BATCH_DECLARATION_TXID=abc'):
            with self.assertRaisesRegex(ValueError,'Dormant deployment'):module.restart_configuration_pin()
        properties={'Environment':'','EnvironmentFiles':'','PassEnvironment':'WORK_BATCH_ACTIVATION_HEIGHT',
            'UnsetEnvironment':'','ExecStart':EXEC_START_ACTIVE,'WorkingDirectory':str(self.root),'FragmentPath':'/unused','DropInPaths':''}
        with patch.object(module,'ctl',side_effect=lambda *args:'' if args==('show-environment',) else properties[args[-1]]):
            with self.assertRaisesRegex(ValueError,'inherited WORK batch'):module.restart_configuration_pin()


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
        def ctl(*args):return '' if args==('show-environment',) else properties[args[-1]]
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
        def ctl(*args):return '' if args==('show-environment',) else properties[args[-1]]
        restores=[]
        def drain():
            properties['ExecStart']=EXEC_START_ACTIVE.replace('stop_time=[n/a]',
                'stop_time=[Sun 2026-10-25 15:42:38 UTC]').replace('code=(null)','code=killed').replace('status=0/0','status=15/TERM')
        def restore(*args):
            properties['ExecStart']=EXEC_START_ACTIVE.replace('pid=3713663','pid=4000001').replace(
                'Sat 2026-10-24 18:44:16 UTC','Sun 2026-10-25 15:50:00 UTC')
            restores.append(True);return {}
        def postflight():
            if fail_postflight:raise ValueError('injected dormant postflight refusal')
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
            'restore_verified_apps':restore,'drain_apps':drain,'require_dormant_status':postflight,
            'save':lambda:None,'print':lambda *args,**kwargs:None}
        with patch.object(module,'ctl',side_effect=ctl):
            self.manifest['dormantConfigurationSha256']=module.restart_configuration_pin()
            if fail_postflight:
                with self.assertRaisesRegex(ValueError,'injected dormant postflight refusal'):
                    exec(compile(program,'actual-main-lifecycle','exec'),env)
            else:
                exec(compile(program,'actual-main-lifecycle','exec'),env)
            module.require_restart_configuration(self.manifest['dormantConfigurationSha256'])
        self.assertNotIn('recoveryIncomplete',receipt)
        self.assertEqual(receipt['rolledBack'],fail_postflight)
        self.assertEqual(len(restores),2 if fail_postflight else 1)
        for row in self.manifest['sources']:
            file=self.root/row['path'];expected=row['before'] if fail_postflight else row['after']
            self.assertEqual(module.sha(file.read_bytes()) if file.exists() else None,expected)

    def test_actual_main_forward_keeps_configuration_pin_across_drain_and_restore(self):
        self.exercise_actual_main_restart_lifecycle(False)

    def test_actual_main_rollback_keeps_configuration_pin_across_recovery(self):
        self.exercise_actual_main_restart_lifecycle(True)

    def test_untrusted_quarantine_parent_refuses_before_source_writes(self):
        module.QUARANTINE_PARENT.chmod(0o777)
        with self.assertRaisesRegex(ValueError,'root-owned quarantine'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'unsafe',self.created)
        self.assertTrue(all(not (self.root/name).exists() for name in module.NEW))


if __name__ == '__main__': unittest.main()
