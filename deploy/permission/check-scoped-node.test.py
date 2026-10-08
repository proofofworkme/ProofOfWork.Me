#!/usr/bin/env python3
"""Local filesystem tests; never contact production or invoke services."""
import base64, copy, importlib.util, json, os, pathlib, subprocess, tempfile, unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('permission_scoped_node', pathlib.Path(__file__).with_name('scoped-node.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)/'runtime'; self.root.mkdir(mode=0o700)
        self.backup = pathlib.Path(self.temp.name)/'backup'; self.backup.mkdir(mode=0o700)
        rows = []; self.metadata = {}
        for index, path in enumerate(sorted(module.ALLOWED)):
            before = None if path in module.NEW else b'// accepted Audit31 bytes\nexport {};\n'
            after = b'// accepted Audit31 bytes\n// additive Permission delta\nexport {};\n'
            file = self.root/path; file.parent.mkdir(parents=True, exist_ok=True)
            if before is not None: file.write_bytes(before); file.chmod(0o640)
            if before is not None: (self.backup/f'before-{index}.mjs').write_bytes(before)
            (self.backup/f'candidate-{index}.mjs').write_bytes(after)
            self.metadata[path] = (os.getuid(), os.getgid(), 0o640)
            rows.append({'path':path, 'before':module.sha(before) if before is not None else None,
                'after':module.sha(after), 'base64':base64.b64encode(after).decode()})
        for path in ('scripts/backfill-proof-search.mjs', 'scripts/backfill-proof-indexer.mjs', 'package.json', 'package-lock.json'):
            (self.root/path).parent.mkdir(parents=True,exist_ok=True)
            (self.root/path).write_bytes(b'{}\n' if path.endswith('.json') else b'export {};\n')
            (self.root/path).chmod(0o640)
        deps = {str(path.relative_to(self.root)):module.sha(path.read_bytes())
            for path in self.root.rglob('*') if path.is_file()}
        self.manifest = {'format':'proof-of-work-permission-scoped-runtime-v1',
            'releaseId':'abcdef123456-20261007T010000Z', 'services':list(module.UNITS),
            'sourceCommit':'abcdef123456'+'a'*28, 'baselineHead':'b'*40, 'sources':rows,
            'dependencies':deps, 'nodeSha256':'c'*64,
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

    def test_exact_six_writes_and_api_dependent_worker_restart(self):
        self.assertEqual(module.ALLOWED, {'server/proof-api.mjs', 'server/db/proof-index-reader.mjs',
            'server/permission-discovery.mjs', 'src/shared/protocol/permissions.mjs',
            'server/permissions.mjs', 'server/db/permission-reader.mjs'})
        self.assertEqual(module.NEW, {'server/permission-discovery.mjs',
            'src/shared/protocol/permissions.mjs', 'server/permissions.mjs',
            'server/db/permission-reader.mjs'})
        self.assertEqual(module.UNITS, ('proofofwork-api.service', 'proofofwork-indexer-worker.service'))
        self.assertEqual(module.PROTECTED, ('proofofwork-indexer-worker.service',))

    def test_all_four_new_helpers_refuse_existing_unreviewed_bytes(self):
        candidates = module.validate_manifest(self.manifest)
        for name in sorted(module.NEW):
            file = self.root/name
            file.write_bytes(b'// concurrent product or operator bytes\nexport {};\n')
            file.chmod(0o640)
            with self.assertRaisesRegex(ValueError, 'Source changed: '+name):
                module.fence(self.root,self.manifest,candidates)
            self.assertIn(b'concurrent product',file.read_bytes())
            file.unlink()

    def test_permission_module_graph_requires_every_existing_import_pin(self):
        # Exercise the shipped Permission helper imports, including the native-
        # capable reader and the exact shared wire schema. Existing runtime
        # modules stand in for captured custody, not repository replacements.
        repository = pathlib.Path(__file__).resolve().parents[2]
        candidates = module.validate_manifest(self.manifest)
        for name in module.NEW:
            candidates[name] = (repository/name).read_bytes()
        candidates['server/proof-api.mjs'] = b"import './permissions.mjs';\nimport './permission-discovery.mjs';\nimport './db/permission-reader.mjs';\n"
        imports = set()
        for name in module.NEW:
            for target in module.IMPORT.findall(candidates[name].decode('utf-8')):
                imports.add(module.relative_import(name,target))
        existing = imports - module.NEW
        for name in existing:
            file = self.root/name
            if file.exists(): continue
            file.parent.mkdir(parents=True,exist_ok=True)
            file.write_bytes(b'// captured accepted runtime dependency\nexport {};\n')
            file.chmod(0o640)
        manifest = copy.deepcopy(self.manifest)
        for name in existing:
            manifest['dependencies'][name] = module.sha((self.root/name).read_bytes())
        closure = module.dependency_closure(self.root,candidates)
        self.assertTrue(module.NEW <= closure)
        module.fence(self.root,manifest,candidates)
        for name in sorted(existing):
            missing = copy.deepcopy(manifest)
            del missing['dependencies'][name]
            with self.assertRaisesRegex(ValueError,'Unpinned runtime dependency'):
                module.fence(self.root,missing,candidates)

    def test_pages_scope_and_manifest_cannot_authorize_permission_release(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['format'] = 'proof-of-work-pages-scoped-runtime-v1'
        with self.assertRaisesRegex(ValueError,'Wrong manifest'):
            module.validate_manifest(manifest)
        for name in ('server/dns-page-link-discovery.mjs', 'src/shared/protocol/dnsPages.mjs'):
            manifest = copy.deepcopy(self.manifest)
            manifest['sources'][0]['path'] = name
            with self.assertRaisesRegex(ValueError,'Permission source allowlist'):
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
            if change == 'duplicate': manifest['sources'][0] = manifest['sources'][1]
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
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'test')
        self.assertFalse((self.root/'server/permission-discovery.mjs').exists())

    def test_new_relative_import_requires_dependency_pin(self):
        file=self.root/'server/unrelated-audit.mjs'; file.write_bytes(b'export {};\n'); file.chmod(0o640)
        candidates=module.validate_manifest(self.manifest)
        candidates['server/proof-api.mjs']=b"import './unrelated-audit.mjs';\n"
        with self.assertRaisesRegex(ValueError,'Unpinned runtime'): module.fence(self.root,self.manifest,candidates)

    def test_symlink_and_path_escape_refuse(self):
        for path in ('../outside.mjs','server/../../outside.mjs','/tmp/outside.mjs','server//x.mjs'):
            with self.assertRaises(ValueError): module.source_path(path)
        target=self.root/'server/proof-api.mjs'; target.unlink(); target.symlink_to(self.root/'server/db/proof-index-reader.mjs')
        with self.assertRaisesRegex(ValueError,'Unsafe source'): module.safe_read(target)

    def test_install_and_rollback_preserve_original_bytes_metadata_and_new_helpers(self):
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'test')
        for row in self.manifest['sources']:
            self.assertEqual(module.sha((self.root/row['path']).read_bytes()),row['after'])
            self.assertEqual((self.root/row['path']).stat().st_mode & 0o777,0o640)
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'test')
        for row in self.manifest['sources']:
            self.assertEqual(module.sha((self.root/row['path']).read_bytes()),row['before'] or row['after'])

    def test_partial_install_recovers_without_erasing_external_change(self):
        real_replace=os.replace; writes=0
        def interrupted(source,target):
            nonlocal writes
            writes+=1
            if writes==3: raise OSError('injected filesystem failure')
            return real_replace(source,target)
        with patch.object(module.os,'replace',side_effect=interrupted):
            with self.assertRaisesRegex(OSError,'injected'):
                module.install(self.root,self.backup,self.manifest['sources'],self.metadata,True,'partial')
        module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'partial')
        for row in self.manifest['sources']:
            file=self.root/row['path']
            self.assertEqual(module.sha(file.read_bytes()) if file.exists() else None,
                row['before'] if row['before'] is not None else row['after'] if file.exists() else None)
        file=self.root/'server/proof-api.mjs'; file.write_bytes(b'new audit authority')
        with self.assertRaisesRegex(ValueError,'unexpected source'):
            module.install(self.root,self.backup,self.manifest['sources'],self.metadata,False,'refuse')
        self.assertEqual(file.read_bytes(),b'new audit authority')

if __name__ == '__main__': unittest.main()
