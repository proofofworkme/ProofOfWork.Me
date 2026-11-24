#!/usr/bin/env python3
"""Exercise binary input, exact live dependencies, stage parity and full/stream charges."""
import contextlib
import copy
import hashlib
import io
import json
import subprocess
import os
from pathlib import Path
import runpy
import shutil
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch
import zlib

ROOT = Path(__file__).resolve().parent
def module(name):
    return types.SimpleNamespace(**runpy.run_path(str(ROOT / name)))


class ClosedInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.phase = module('phase_capacity.py')
        cls.release = module('release.py')
        cls.sequence = module('sequence_capacity.py')
        cls.stager = module('../proofofwork-ui-release-stage.py')

    def test_bound_amo_successor_plan_and_replayed_approval_refusal(self):
        import shutil
        root = Path(self.tmp.name)
        repository, parent, tree = self.committed_planner_fixture()
        git = ['git', '-C', str(repository), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.example',
               '-c', 'commit.gpgsign=false']
        subprocess.run(git + ['commit', '--allow-empty', '-qm', 'disposable fixture successor'], check=True)
        commit = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
        rid = commit[:12] + '-20261124T010000Z'
        self.names = sorted(self.phase.PAY_SURFACES)
        shutil.copytree(self.incoming / 'surfaces/permission', self.incoming / 'surfaces/pay')
        shutil.copytree(self.live / 'proofofwork-permission', self.live / 'proofofwork-pay')
        (self.live / 'passthrough').write_bytes(b'fixture')
        source = root / 'source.tgz'
        with tarfile.open(source, 'w:gz') as archive:
            archive.add(repository / 'deploy/publish/release.py', 'source/deploy/publish/release.py')
        with tarfile.open(self.bundle, 'w:gz') as archive:
            archive.add(self.incoming, 'proofofwork-ui-surfaces-' + rid)
        bundles = {k: {'path': str(path), 'bytes': path.stat().st_size, 'sha256': self.release.digest(path)}
                   for k, path in [('source', source), ('surfaces', self.bundle)]}
        build = {'releaseId': rid, 'commit': commit, 'tree': tree, 'releaseFormat': 'proofofwork-ui-release-v6',
                 'sourceAllocatedBytes': 1048576, 'surfaces': self.names, 'bundles': bundles}
        args = types.SimpleNamespace(build_receipt=root/'build.json', preflight=root/'preflight.json',
                                     output=str(root/'plan.json'), attempt='initial', input_storage='deploy-scratch-v1')
        args.build_receipt.write_text(json.dumps(build))
        with patch.dict(self.release.make_plan.__globals__, REPO=repository, AMO_DIRECT_BASE_COMMIT=parent):
            request, packed = self.release.closed_input(build, private_staging=True)
            observed = runpy.run_path(str(ROOT/'check-preservation-admission.test.py'))['retired_observation']()
            pair = {'current': '2084747c3f8c-20261118T181547Z', 'previous': '9f18a0ce7032-20261118T004519Z'}
            observed['binding']['pair'] = pair
            observed['verifiedRetirementCurrentPair'] = pair
            backup = '/var/backups/proofofwork-ui'
            prefix = backup + '/releases/proofofwork-ui-release-' + pair['previous'] + '.tgz'
            observed['privateStageRetention'].update(releaseId=rid, previousPair=pair, wouldRetire=sorted([
                prefix, prefix+'.sha256', prefix+'.provenance', backup+'/rollback-roots/proofofwork-www-pre-'+pair['current']]))
            helpers = {key: {'sha256': 'a'*64} for key in
                       ('capacity', 'retained', 'controller', 'receiver', 'stage-shell', 'phase-capacity', 'transport')}
            helpers.update({key: {'sha256': digest} for key,digest in request['helperHashes'].items()})
            build_sha = self.release.digest(args.build_receipt)
            self.release.bind_direct_request(request, build, build_sha, '0'*64, args.attempt)
            preview = self.release.direct_request_plan(request, observed['binding'], helpers)
            grant = self.stager.direct_plan_fields(preview)
            approval_raw = (json.dumps(grant, sort_keys=True, separators=(',', ':')) + '\n').encode()
            pin = hashlib.sha256(approval_raw).hexdigest()
            self.release.bind_direct_request(request, build, build_sha, pin, args.attempt)
            census = {'limits': dict(self.sequence.LIMITS), 'usage': {'scratch': 0, 'backup': 0, 'transport': 0},
                      'availableBytes': 30*1024**3, 'availableInodes': 1000000,
                      'liveTree': {'additionalBytes': 1048576, 'additionalInodes': 4096}}
            preflight = {**observed, 'retentionLifecycle': observed['binding'], 'retentionIndex': observed['index'],
                         'amoDirectApproval': grant, 'helpers': helpers, 'wholeSequenceCensus': census,
                         'live': self.live_identity, 'oldManaged': {'logicalBytes':1048576,'entries':128},
                         'closedArchive': self.phase.assess_closed_input(request, helpers, self.live_identity,
                             self.stager, packed, self.live), 'checks': [{'exitCode':0}], 'retained': [],
                         'retentionDeferred': True}

            def make():
                args.preflight.write_text(json.dumps(preflight))
                with contextlib.redirect_stdout(io.StringIO()):
                    self.release.make_plan(args)

            make()
            raw = Path(args.output).read_bytes()
            plan = json.loads(raw)
            self.assertLessEqual(len(raw), 65536)
            self.assertEqual(self.stager.direct_plan_fields(plan), grant)
            self.assertEqual(plan['amoDirectStage'], {'model': 'amo-direct-stage-v1', 'approvalSha256': pin})
            self.assertIn('amoDirectCapacity', plan['closedArchive'])
            meta = self.release.direct_metadata_guard(plan)
            self.assertNotIn('sequenceCapacity', meta)
            exec(compile(meta, 'metadata-gate', 'exec'), ctx := {})
            self.assertEqual(self.stager.direct_plan_fields(ctx['DIRECT_METADATA_PLAN']), grant)
            print('AMO test-only sealed V6 plan bytes', len(raw))
            args.output = str(root/'refused.json')
            for obj,key,bad in [(grant, 'sourceSha256', 'b'*64), (grant, 'stateSha256','8'*64),
                                (grant, 'buildReceiptSha256', 'e'*64), (request['amoDirectScope'], 'attempt','retry')]:
                with self.subTest(key=key), patch.dict(obj, {key: bad}), self.assertRaises((ValueError, RuntimeError)):
                    make()
            with patch.object(args, 'attempt', 'different'), self.assertRaises(ValueError):
                make()
            with patch.dict(build, commit=parent), self.assertRaisesRegex(ValueError, 'successor'):
                self.release.bind_direct_request(request.copy(), build, build_sha, pin, args.attempt)
            self.assertFalse(Path(args.output).exists())

    def test_private_preflight_refuses_predicted_retirement_before_upload(self):
        with tempfile.TemporaryDirectory() as d:
            closed=Path(d)/'closed.json'
            closed.write_text(json.dumps({'releaseId':self.release_id,'inputCompactorSha256':'f'*64}))
            def status(**options):
                self.assertEqual(options,{'require_complete':True,'prospective_release':self.release_id})
                return {'privateStageRetention':{'wouldRetire':['existing admitted archive']}}
            with patch.dict(self.release.preflight.__globals__, {
                    'lifecycle_module':lambda:types.SimpleNamespace(status=status),
                    'remote':lambda *args,**kwargs:self.fail('upload attempted')}):
                with self.assertRaisesRegex(ValueError,'existing admitted archive'):
                    self.release.preflight(types.SimpleNamespace(closed_request=str(closed)))

    def setUp(self):
        self.addCleanup(os.umask, os.umask(0o022))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.live = root / 'live'
        self.release_id = 'a'*12 + '-20261103T014615Z'
        self.bundle = root / 'payload.tgz'
        self.incoming = root / ('proofofwork-ui-surfaces-' + self.release_id)
        self.names = sorted(self.phase.PERMISSION_SURFACES)
        for surface in self.names:
            incoming = self.incoming / 'surfaces' / surface
            incoming.mkdir(parents=True)
            (incoming / 'assets').mkdir()
            (incoming / 'assets/index-ABCDEF01.js').write_text('new')
            (incoming / 'index.html').write_text('<script type="module" src="/assets/index-ABCDEF01.js"></script>')
            previous = self.live / ('proofofwork-' + surface)
            assets = previous / 'assets'
            assets.mkdir(parents=True)
            (previous / 'index.html').write_text('<script type="module" src="/assets/index-AABBCCDD.js"></script>')
            (assets / 'index-AABBCCDD.js').write_text('import "./chunk-BBCCDD00.js"')
            (assets / 'chunk-BBCCDD00.js').write_bytes(b'prior dependency')
        self.helpers = {k: {'sha256': str(i)*64} for i,k in enumerate(('publisher','provenance','stager'), 1)}
        self.live_identity = {'manifestSha256': 'e'*64, 'treeSha256': 'f'*64}
        self.pack()

    def pack(self):
        with tarfile.open(self.bundle, 'w:gz') as tar:
            tar.add(self.incoming, self.incoming.name)
        self.packed = bytearray()
        self.fp = self.release.bundle_payload_fingerprint(self.bundle, self.release_id, self.names, self.packed)
        self.request = {'model':'proof-ui-closed-input-v1', 'releaseId':self.release_id, 'commit':'a'*40, 'tree':'b'*40,
                        'phaseSourceSha256':self.release.digest(ROOT/'phase_capacity.py'),
                        'surfacesSha256':self.release.digest(self.bundle), 'inventorySha256':hashlib.sha256(self.packed).hexdigest(),
                        'payloadFingerprint':self.fp, 'helperHashes':{k:r['sha256'] for k,r in self.helpers.items()}}

    def assess(self):
        return self.phase.assess_closed_input(self.request, self.helpers, self.live_identity,
                                              self.stager, self.packed, self.live)

    def test_prepare_command_binds_exact_committed_helpers_and_archive(self):
        root = Path(self.tmp.name)
        repo = root / 'candidate-repo'
        deploy = repo / 'deploy'; deploy.mkdir(parents=True)
        sources = ('proofofwork-ui-release-provenance.sh', 'proofofwork-ui-release-publish.sh',
                   'proofofwork-ui-release-stage.py')
        for name in sources:
            (deploy/name).write_bytes((ROOT.parent/name).read_bytes())
        (deploy/'publish').mkdir()
        (deploy/'publish/phase_capacity.py').write_bytes((ROOT/'phase_capacity.py').read_bytes())
        (deploy/'publish/input_compaction.py').write_bytes((ROOT/'input_compaction.py').read_bytes())
        def git(*args):
            return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
        git('init', '-q'); git('add', 'deploy')
        git('-c','user.name=Fixture','-c','user.email=fixture@invalid.example','-c','commit.gpgsign=false','commit','-qm','fixture')
        commit = git('rev-parse','HEAD'); rid = commit[:12] + '-20261103T014615Z'
        with tarfile.open(self.bundle,'w:gz') as tar:
            tar.add(self.incoming, 'proofofwork-ui-surfaces-' + rid)
        build = {'releaseId':rid, 'releaseFormat':'proofofwork-ui-release-v5', 'commit':commit,
                 'tree':git('rev-parse','HEAD^{tree}'), 'surfaces':self.names,
                 'bundles':{'surfaces':{'path':str(self.bundle),'bytes':self.bundle.stat().st_size,
                                        'sha256':self.release.digest(self.bundle)}}}
        bpath=root/'build-receipt.json'; bpath.write_text(json.dumps(build))
        args=types.SimpleNamespace(build_receipt=str(bpath),output=str(root/'closed.json'))
        with patch.dict(self.release.closed_input.__globals__, REPO=repo):
            self.release.prepare_closed_input(args)
            request=json.loads(Path(args.output).read_bytes())
            self.assertEqual(self.release.digest(args.output+'.zlib'),request['inventorySha256'])
            self.assertEqual(request['helperHashes']['publisher'],self.release.digest(deploy/sources[1]))
            with self.assertRaises(FileExistsError): self.release.prepare_closed_input(args)
            self.assertNotIn('inputCompactorSha256',request)
            args.private_staging=True
            args.output=str(root/'private.json')
            self.release.prepare_closed_input(args)
            private=json.loads(Path(args.output).read_bytes())
            self.assertEqual(private['inputCompactorSha256'],self.release.digest(deploy/'publish/input_compaction.py'))
            self.bundle.write_bytes(b'changed file')
            with self.assertRaisesRegex(ValueError,'surface archive differs'): self.release.closed_input(build)

    def committed_planner_fixture(self):
        root = Path(self.tmp.name)
        repository = root / 'plan-fixture'
        for path in [*(path for path in ROOT.glob('*.py') if not path.name.endswith('.test.py')),
                     *(ROOT.parents[1] / name for name in self.release.lifecycle_module().LOCAL_SOURCES),
                     *(ROOT.parent / name for name in ('proofofwork-ui-release-publish.sh',
                         'proofofwork-ui-release-provenance.sh', 'proofofwork-ui-release-stage.py'))]:
            target = repository / path.relative_to(ROOT.parents[1])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(path.read_bytes())

        def git(*args):
            return subprocess.check_output(['git', '-C', str(repository), *args], text=True).strip()

        git('init', '-q')
        git('add', 'deploy')
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.example',
            '-c', 'commit.gpgsign=false', 'commit', '-qm', 'capacity fixture')
        return repository, git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD^{tree}')

    def test_private_scratch_allowance_requires_closed_build_and_historical_forecast(self):
        # A real local Git commit and tiny archives exercise the planner's source
        # and receipt bindings. The lifecycle and space observations are fixtures.
        root = Path(self.tmp.name)
        repository, commit, tree = self.committed_planner_fixture()
        historical = commit[:12] + '-20261109T160000Z'
        previous = '54088ca155bc-20261103T032112Z'
        current = '69c31f4e1dcd-20261109T051556Z'
        state = 'e26d71523827e01a1c41696e690ef27ba691467e5c434922dcda235b8fd9afcc'
        pair = {'current': current, 'previous': previous}
        archive = '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-' + previous + '.tgz'
        paths = sorted([archive, archive + '.sha256', archive + '.provenance',
                        '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-' + current])
        hold = {'snapshotSha256': {'fixture-held-archive': 'c'*64}}
        forecast = {'model': 'private-stage-reviewed-retirement-v1', 'releaseId': historical,
                    'previousPair': pair, 'stateSha256': state, 'wouldRetire': paths, 'preservedFallback': hold}
        source = root / 'source.tgz'
        with tarfile.open(source, 'w:gz') as stream:
            stream.add(repository / 'deploy/publish/release.py', 'source/deploy/publish/release.py')
        with tarfile.open(self.bundle, 'w:gz') as stream:
            stream.add(self.incoming, 'proofofwork-ui-surfaces-' + historical)
        bundles = {kind: {'path': str(path), 'bytes': path.stat().st_size, 'sha256': self.release.digest(path)}
                   for kind, path in [('source', source), ('surfaces', self.bundle)]}
        build = {'releaseId': historical, 'commit': commit, 'tree': tree,
                 'sourceAllocatedBytes': 1048576, 'releaseFormat': 'proofofwork-ui-release-v5',
                 'surfaces': self.names, 'bundles': bundles}
        args = types.SimpleNamespace(build_receipt=root/'build.json', preflight=root/'preflight.json',
                                     output=str(root/'plan.json'), attempt='initial', input_storage='deploy-scratch-v1')
        args.build_receipt.write_text(json.dumps(build))
        with patch.dict(self.release.make_plan.__globals__, REPO=repository):
            request, packed = self.release.closed_input(build, private_staging=True)
            helpers = {name: {'sha256': 'd'*64} for name in
                       ('controller', 'receiver', 'stage-shell', 'phase-capacity', 'capacity', 'retained', 'transport')}
            helpers.update({name: {'sha256': digest} for name, digest in request['helperHashes'].items()})
            proof = self.phase.assess_closed_input(request, helpers, self.live_identity, self.stager, packed, self.live)
            census = {'limits': dict(self.sequence.LIMITS), 'usage': {'scratch': 0, 'backup': 0, 'transport': 0},
                      'availableBytes': 30*1024**3, 'availableInodes': 1000000,
                      'liveTree': {'additionalBytes': 1048576, 'additionalInodes': 100}}
            preflight = {'closedArchive': proof, 'helpers': helpers, 'wholeSequenceCensus': census,
                         'checks': [{'exitCode': 0}], 'retentionDeferred': True, 'retained': [],
                         'live': self.live_identity, 'oldManaged': {'logicalBytes': 1048576, 'entries': 100},
                         'retentionLifecycle': {'pair': pair, 'state': {'sha256': state}},
                         'verifiedPreservedFallback': hold, 'privateStageRetention': forecast}

            def make_plan():
                args.preflight.write_text(json.dumps(preflight))
                with contextlib.redirect_stdout(io.StringIO()):
                    self.release.make_plan(args)
                return json.loads(Path(args.output).read_bytes())

            plan = make_plan()
            required = plan['wholeSequenceAdmission']['requirements']
            allowance = 384 * 1024**2
            self.assertEqual((required['allowanceRelease'], required['scratchAllowanceBytes']), (historical, allowance))
            self.assertEqual(required['limits']['scratchBudgetBytes'], 15 * 1024**3 // 2)
            # One full historical allowance is consumed at this boundary.
            census['usage']['scratch'] = required['limits']['scratchBudgetBytes'] - required['additionalBytes']['scratch'] + allowance
            args.output = str(root/'at-limit.json')
            self.assertEqual(make_plan()['wholeSequenceAdmission']['headroom']['scratch'], 0)
            args.output = str(root/'must-not-exist.json')
            with patch.dict(census['usage'], scratch=census['usage']['scratch'] + 1):
                with self.assertRaisesRegex(ValueError, '"scratch": 1'):
                    make_plan()
            limits = self.sequence.LIMITS
            root_floor = required['additionalBytes']['root'] + limits['rootReserveBytes'] + limits['growthReserveBytes']
            inode_floor = required['additionalInodes'] + limits['inodeReserve']
            for metric, key, reserve in [('root', 'availableBytes', root_floor), ('inodes', 'availableInodes', inode_floor)]:
                with self.subTest(metric=metric), patch.dict(census, {key: reserve - 1}):
                    with self.assertRaisesRegex(ValueError, f'"{metric}": 1'):
                        make_plan()
            forged = {**required, 'allowanceRelease': 'foreign-20261109T160000Z'}
            with patch.dict(preflight, wholeSequenceAdmission={'requirements': forged}), patch.object(args, 'attempt', 'retry'):
                with self.assertRaisesRegex(ValueError, f'"scratch": {allowance}'):
                    make_plan()
            with patch.dict(forecast, stateSha256='f'*64):
                with self.assertRaisesRegex(ValueError, 'release-specific'):
                    make_plan()
                with patch.dict(preflight['retentionLifecycle']['state'], sha256='f'*64):
                    with self.assertRaisesRegex(ValueError, f'"scratch": {allowance}'):
                        make_plan()
            for changed_pair in ({**pair, 'previous': current}, {**pair, 'current': previous}):
                with self.subTest(pair=changed_pair), patch.dict(forecast, previousPair=changed_pair):
                    with self.assertRaisesRegex(ValueError, 'Private staging would retire'):
                        make_plan()
            with patch.dict(proof['request'], surfacesSha256='0'*64):
                with self.assertRaisesRegex(ValueError, 'Closed archive evidence differs'):
                    make_plan()
            self.assertFalse(Path(args.output).exists())

        # The receiver recomputes requirements from its bound plan and fresh census.
        # admit() only checks the precomputed allowance amount and date suffix.
        # Production reconstructs these fields rather than accepting that dict as an input.
        for other_commit, timestamp in [('ace27010a8e44886c0c22cf9fe5c98509d28f1bb', '20261123T181230Z'),
                                        (commit, '20261109T160001Z')]:
            other = copy.deepcopy(plan)
            release = other_commit[:12] + '-' + timestamp
            for record in (other, other['closedArchive']['request']):
                record.update(commit=other_commit, releaseId=release)
            other['privateStageRetention']['releaseId'] = release
            with self.subTest(release=release):
                normal = self.sequence.requirements(other, census)
                self.assertNotIn('scratchAllowanceBytes', normal)
                self.assertNotIn('allowanceRelease', normal)
                with self.assertRaisesRegex(ValueError, f'"scratch": {allowance}'):
                    self.sequence.admit(normal, census)
                with patch.dict(census['usage'], scratch=normal['limits']['scratchBudgetBytes'] - normal['additionalBytes']['scratch']):
                    self.assertEqual(self.sequence.admit(normal, census)['headroom']['scratch'], 0)

    def test_candidate_and_actual_staging_agree_including_transitive_dependencies(self):
        evidence = self.assess()
        self.assertEqual(evidence['dependencyCounters']['dependencies'], 2*len(self.names))
        staged = self.phase.stage_budget(self.incoming/'surfaces', self.live, self.stager, owner=os.getuid())
        self.assertEqual(evidence['archive'], staged['modeledManagedArchive'])
        self.assertEqual(evidence['priorDependenciesSha256'], staged['priorDependenciesSha256'])
        old = self.live/'proofofwork-code/assets/chunk-BBCCDD00.js'
        old.write_bytes(b'same length edit')
        self.assertNotEqual(self.assess()['priorDependenciesSha256'], evidence['priorDependenciesSha256'])

    def test_direct_pay_capacity_recomputes_identical_closed_inputs_on_received_tree(self):
        self.request.update(amoDirectStage=True, inputCompactorSha256='9'*64)
        with self.assertRaisesRegex(ValueError, 'complete Pay-family'):
            self.assess()
        shutil.copytree(self.live/'proofofwork-permission', self.live/'proofofwork-pay')
        incoming = self.incoming/'surfaces'
        shutil.copytree(incoming/'permission', incoming/'pay')
        self.names = sorted(self.phase.PAY_SURFACES)
        self.pack()
        self.request.update(amoDirectStage=True, inputCompactorSha256='9'*64)
        def stage():
            return self.phase.stage_budget(incoming, self.live, self.stager, owner=os.geteuid(), private_input=True, direct=True)
        evidence = self.assess()
        model = stage()
        for key in ('amoDirectCapacity', 'privateStaging', 'priorDependenciesSha256'):
            self.assertEqual(evidence[key], model[key], key)
        self.assertEqual(evidence['archive'], model['modeledManagedArchive'])
        self.assertEqual(model['peakAdditionalBytes'], model['finalCandidateUpperBytes'] +
                         evidence['amoDirectCapacity']['transientSurfaceUpperBytes'])
        with patch.dict(self.request, amoDirectStage=False):
            with self.assertRaisesRegex(ValueError, 'explicitly bound'):
                self.assess()
        asset = self.live/'proofofwork-pay/assets/chunk-BBCCDD00.js'
        asset.write_bytes(b'changed paid dependency')
        updated = stage()
        self.assertNotEqual(updated['amoDirectCapacity']['outgoingIdentitySha256'],
                            evidence['amoDirectCapacity']['outgoingIdentitySha256'])
        self.assertNotEqual(updated['priorDependenciesSha256'], evidence['priorDependenciesSha256'])

    def test_same_path_different_content_refused(self):
        assets = self.incoming/'surfaces/code/assets'
        (assets/'chunk-BBCCDD00.js').write_text('different')
        self.pack()
        with self.assertRaisesRegex(ValueError, 'collision'): self.assess()

    def test_tampering_incomplete_family_oversize_and_trailing_deflate_refused(self):
        for key in ('inventorySha256', 'payloadFingerprint', 'helperHashes'):
            with self.subTest(key=key), patch.dict(self.request, {key: None}):
                with self.assertRaises(ValueError): self.assess()
        for bad in (zlib.compress(b'x' * (4*1024**2+1)), bytes(self.packed)+b'unused'):
            with self.subTest(length=len(bad)), patch.object(self,'packed',bad), patch.dict(self.request,{'inventorySha256':hashlib.sha256(bad).hexdigest()}):
                with self.assertRaises(ValueError): self.assess()
        (self.live/'proofofwork-permission').rename(self.live/'unmanaged')
        with self.assertRaises(ValueError): self.assess()

    def test_private_whole_release_counts_each_coexisting_phase_and_refuses_any_short_phase(self):
        self.request['inputCompactorSha256']='9'*64
        old_file=self.live/'held-passthrough'
        old_file.write_bytes(b'held bytes')
        proof=self.assess()
        bounds=proof['privateStaging']
        block=os.statvfs(self.live).f_frsize
        self.assertGreaterEqual(bounds['passthroughUpperBytes'],5*block)
        census={'limits':dict(self.sequence.LIMITS),'liveTree':{'additionalBytes':646303744,'additionalInodes':3074}}
        plan={'inputStorage':'deploy-scratch-v1','sourceAllocatedBytes':400000000,'admissions':{
            'source-receive':{'bytes':414089216,'inodes':15000},'surfaces-receive':{'bytes':394182656,'inodes':4000}},
            'releaseFormat':'proofofwork-ui-release-v5','managedSurfaces':self.names,
            **{k:self.request[k] for k in ('releaseId','commit','tree')},'surfaces':{'sha256':self.request['surfacesSha256']},
            'surfacesPayloadFingerprint':self.fp,'publicationHelpers':self.helpers,'closedArchive':proof,
            'phaseCapacity':{'sha256':self.request['phaseSourceSha256']}, 'inputCompactor':{'sha256':'9'*64},
            'oldLiveManifestSha256':'e'*64,'oldFullRootTreeSha256':'f'*64,
            'stageArchiveUpperBoundBytes':proof['archive']['archiveUpperBoundBytes']}
        result=self.sequence.requirements(plan,census)
        phases=result['privatePhasePeaks']
        self.assertEqual(phases['surfaces-receive']['root'],394182656+4*1024**2)
        self.assertEqual(phases['stage']['root'],bounds['compactInputUpperBytes']+646303744+394182656)
        for name in ('root','scratch'):
            self.assertEqual(phases['source-and-publication'][name]-phases['archive'][name],414089216)
            self.assertEqual(result['additionalBytes'][name],max(row[name] for row in phases.values())+64*1024**2)
        # Planning must account for the stage copy even when generated inputs
        # are duplicates and the final stage is much smaller.
        self.assertLess(phases['archive']['scratch'],phases['stage']['scratch'])
        required=result['additionalBytes'];limits=self.sequence.LIMITS
        census.update({'availableBytes':limits['rootReserveBytes']+limits['growthReserveBytes']+required['root'],
                      'availableInodes':1000000,'usage':{k:0 for k in ('scratch','backup','transport')}})
        self.assertTrue(self.sequence.admit(result,census)['ok'])
        census['availableBytes']-=1
        with self.assertRaisesRegex(ValueError,'"root": 1'):self.sequence.admit(result,census)
        with patch.dict(plan['inputCompactor'],{'sha256':'8'*64}):
            with self.assertRaisesRegex(ValueError,'Unbound private'): self.sequence.requirements(plan,census)

    def test_native_scratch_ceiling_applies_without_a_release_context(self):
        native = module('../proofofwork-ui-capacity.py')
        root = Path(self.tmp.name)
        measured = native.check_deploy_scratch(root, 0, 'whole-release-measurement')
        self.assertEqual(measured['maximumBytes'], 15 * 1024**3 // 2)
        remaining = measured['maximumBytes'] - measured['allocatedBytes']
        self.assertEqual(native.check_deploy_scratch(root, remaining, 'recovery-stage')['status'], 'sufficient')
        with self.assertRaisesRegex(native.CapacityError, 'UI deployment scratch review required'):
            native.check_deploy_scratch(root, remaining + 1, 'recovery-stage')

    def test_only_bound_fresh_release_uses_bounded_work_and_full_candidate(self):
        proof=self.assess()
        census={'limits':dict(self.sequence.LIMITS),'liveTree':{'additionalBytes':646303744,'additionalInodes':3074}}
        plan={'inputStorage':'deploy-scratch-v1','sourceAllocatedBytes':360288256,'admissions':{
            'source-receive':{'bytes':414089216,'inodes':15000},'surfaces-receive':{'bytes':394182656,'inodes':4000}},
              'releaseFormat':'proofofwork-ui-release-v5','managedSurfaces':self.names,
              **{k:self.request[k] for k in ('releaseId','commit','tree')},'surfaces':{'sha256':self.request['surfacesSha256']},
              'surfacesPayloadFingerprint':self.fp,'publicationHelpers':self.helpers,
              'phaseCapacity':{'sha256':self.request['phaseSourceSha256']},
              'oldLiveManifestSha256':'e'*64, 'oldFullRootTreeSha256':'f'*64,
              'stageArchiveUpperBoundBytes':proof['archive']['archiveUpperBoundBytes']}
        baseline=self.sequence.requirements(plan,census)
        plan['closedArchive']=proof
        requirements=self.sequence.requirements(plan,census)
        self.assertEqual(requirements['charges']['provenanceStreamDisk'],8*1024**2)
        self.assertEqual(requirements['charges']['candidateCopy'],1040486400)
        self.assertEqual(baseline['charges']['provenanceExtraction'],1040486400)
        for k,v in [('commit', '2'*40),('oldFullRootTreeSha256','1'*64),('stageArchiveUpperBoundBytes',1),
                    ('inputStorage','release-evidence-v1'),('surfacesPayloadFingerprint',{}),('publicationHelpers',{**self.helpers,'publisher':{'sha256':'0'*64}})]:
            with self.subTest(key=k), patch.dict(plan,{k:v}):
                with self.assertRaises(ValueError): self.sequence.requirements(plan,census)


if __name__ == '__main__':
    unittest.main()
