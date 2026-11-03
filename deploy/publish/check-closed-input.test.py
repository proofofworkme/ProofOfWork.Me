#!/usr/bin/env python3
"""Exercise binary input, exact live dependencies, stage parity and full/stream charges."""
import hashlib
import json
import subprocess
import os
from pathlib import Path
import runpy
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

    def test_candidate_and_actual_staging_agree_including_transitive_dependencies(self):
        evidence = self.assess()
        self.assertEqual(evidence['dependencyCounters']['dependencies'], 2*len(self.names))
        staged = self.phase.stage_budget(self.incoming/'surfaces', self.live, self.stager, owner=os.getuid())
        self.assertEqual(evidence['archive'], staged['modeledManagedArchive'])
        self.assertEqual(evidence['priorDependenciesSha256'], staged['priorDependenciesSha256'])
        old = self.live/'proofofwork-code/assets/chunk-BBCCDD00.js'
        old.write_bytes(b'same length edit')
        self.assertNotEqual(self.assess()['priorDependenciesSha256'], evidence['priorDependenciesSha256'])

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
