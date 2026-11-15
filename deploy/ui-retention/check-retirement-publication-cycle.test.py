#!/usr/bin/env python3
"""Isolated genuine retirement successor → publication fence → ordinary cycle.

Run as root on the dedicated VPS workspace. The inherited fixture generates real
Git sources, installed packages, sealed history and removal evidence. Only fixed
test namespaces and exact generated authority pins replace production constants.
No acceptance validator, lifecycle result or installed authority is mocked.
The HTTP/publication artifact inputs are synthetic; this is not live qualification.
"""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


A = load('publication_authority_foundation', ROOT / 'deploy/ui-retention/check-retirement-authority-integration.test.py')


class PublicationCycle(A.AuthorityIntegration):
    # The parent test is independently covered; this class adds one composed run.
    test_real_stock_foundation_has_two_holds_and_completed_current_prior = None

    def fixture_authority_source(self, raw, receipt, *, storage=False):
        """Apply the same explicit authority fixture pins to current consumers."""
        pins = {}
        for node in ast.parse(receipt).body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                if node.targets[0].id in ('PROPOSAL_SHA', 'PAIR', 'PATHS', 'SOURCE_INDEX'):
                    pins[node.targets[0].id] = ast.literal_eval(node.value)
        pair, paths = pins['PAIR'], pins['PATHS']
        replacements = {
            '064b6991ae2a-20261114T020148Z': pair['current'],
            'e2669bc1fd32-20261112T163804Z': pair['previous'],
            '1042efea2aa1-20261112T074918Z': Path(paths[0]).name.removeprefix('proofofwork-ui-release-').removesuffix('.tgz'),
            'c3969c39c2b2-20261101T051206Z': Path(paths[2]).name.removeprefix('proofofwork-ui-release-').removesuffix('.tgz'),
            '54088ca155bc-20261103T032112Z': Path(paths[3]).name.removeprefix('proofofwork-www-pre-'),
            '6fd05dc1e04e6fbcab293683c5a0d10d184ff0bd83039a66d7f2c7ec53161004': pins['PROPOSAL_SHA'],
            '5a7b025d95cd55a2b40f2a69b0189b74d75484ff237bac327f920a6b2a231c54': pins['SOURCE_INDEX']['sha256'],
        }
        # Some helpers were already copied by the foundation's real-Git mapper.
        mapped = A.SOURCE_SUBSTITUTIONS['releaseIdToRealGitCommit']
        for old, new in replacements.items():
            raw = raw.replace(mapped.get(old, old), new).replace(old, new)
        raw = raw.replace('audit30-policy-admission-index-ordinary-' + pair['current'] + '.json',
                          Path(pins['SOURCE_INDEX']['path']).name)
        if storage:
            raw = raw.replace("RETIREMENT_BASE = '/var/backups/proofofwork-ui'",
                              'RETIREMENT_BASE = ' + repr(str(self.layout.base)))
        else:
            for prefix in ('/var/backups/proofofwork-ui', '/etc/proofofwork-retention', '/var/lib/proofofwork-ui-retention'):
                raw = raw.replace(prefix, str(self.fixture.base / prefix.lstrip('/')))
        self.publication_substitutions = {'namespace': str(self.fixture.base), **pins}
        return raw

    def bootstrap_installed_package(self, overrides=None, activate=True):
        if not overrides or 'deploy/ui-retention/retirement_receipt.py' not in overrides:
            return super().bootstrap_installed_package(overrides, activate)
        # Freeze the new fixed publication scope into the actual successor package
        # before its Git commit, manifest and retirement terminal are generated.
        path = A.SOURCE_ROOT / 'deploy/audit30/ui-storage.py'
        original = path.read_text()
        receipt = overrides['deploy/ui-retention/retirement_receipt.py'].decode()
        # Only storage's retirement contract uses absolute string constants. The
        # base installer independently applies its Layout namespace substitution.
        adapted = self.fixture_authority_source(original, receipt, storage=True)
        path.write_text(adapted)
        try:
            return super().bootstrap_installed_package(overrides, activate)
        finally:
            path.write_text(original)

    def candidate_source(self, terminal):
        source = self.fixture.base / 'publication-source'
        source.mkdir(mode=0o700)
        package = Path(terminal['package']['path'])
        manifest = json.loads((package / 'package.json').read_bytes())
        for name in manifest['files']:
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((package / name).read_bytes())
        receipt = (package / 'deploy/ui-retention/retirement_receipt.py').read_text()
        for name in ('deploy/proofofwork-ui-release-publish.sh', 'deploy/publish/publish.py',
                     'deploy/publish/native_exchange_fence.py', 'deploy/publish/publication_admission.py'):
            raw = (ROOT / name).read_text()
            if name.endswith('publication_admission.py'):
                raw = self.fixture_authority_source(raw, receipt)
            if name.endswith('native_exchange_fence.py'):
                # The dedicated VPS task directory is the test root. The exact
                # namespace boundary remains checked by the shipped validator.
                old = "(prefix.is_relative_to('/tmp') or prefix.is_relative_to('/var/tmp'))"
                self.assertEqual(raw.count(old), 1)
                raw = raw.replace(old, '(prefix == Path(' + repr(str(self.fixture.base)) + '))')
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(raw)
        publisher = source / 'deploy/proofofwork-ui-release-publish.sh'
        original_fence = sha((ROOT / 'deploy/publish/native_exchange_fence.py').read_bytes())
        adapted_fence = sha((source / 'deploy/publish/native_exchange_fence.py').read_bytes())
        publisher_raw = publisher.read_text()
        self.assertEqual(publisher_raw.count('pin="' + original_fence + '"'), 1)
        publisher.write_text(publisher_raw.replace('pin="' + original_fence + '"', 'pin="' + adapted_fence + '"'))
        (source / '.gitignore').write_text('node_modules/\n')
        git = ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-C', str(source)]
        env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
               'GIT_AUTHOR_NAME': 'Fixture', 'GIT_AUTHOR_EMAIL': 'fixture@example.invalid',
               'GIT_COMMITTER_NAME': 'Fixture', 'GIT_COMMITTER_EMAIL': 'fixture@example.invalid'}
        for args in (['init', '-q'], ['add', '.'], ['commit', '-qm', 'Exact synthetic publication authority']):
            subprocess.run(git + args, env=env, capture_output=True, check=True)
        commit = subprocess.check_output(git + ['rev-parse', 'HEAD'], env=env, text=True).strip()
        tree = subprocess.check_output(git + ['rev-parse', 'HEAD^{tree}'], env=env, text=True).strip()
        subprocess.run(git + ['checkout', '--detach', commit], env=env, capture_output=True, check=True)
        self.assertEqual(subprocess.check_output(git + ['status', '--porcelain'], env=env), b'')
        detached = subprocess.run(git + ['symbolic-ref', '-q', 'HEAD'], env=env, capture_output=True)
        self.assertEqual(detached.returncode, 1)
        release = commit[:12] + '-20261115T120000Z'
        (source / 'node_modules').mkdir()
        (source / 'node_modules/fixture.bin').write_bytes(b'synthetic dependency')
        A.F.GIT_FIXTURES[release] = {'head': commit, 'tree': tree, 'template': str(source)}
        return source, release, commit, tree

    def test_successor_publication_and_ordinary_cycle(self):
        baseline = self.authority_foundation()
        terminal = self.upgrade_retired_fixture(self.retire_fixture(baseline))
        package = Path(terminal['package']['path'])
        L = load('publication_actual_lifecycle', package / 'deploy/ui-retention/lifecycle_remote.py')
        runtime = L.installed_runtime(L.CONFIG_PATH, terminal['status']['configSha256'])
        self.runtime, self.layout = runtime, runtime.layout
        self.fixture.l = runtime.layout
        source, release, commit, tree = self.candidate_source(terminal)
        admission = load('publication_actual_admission', source / 'deploy/publish/publication_admission.py')
        fd = runtime.S.lock(runtime.layout)
        runtime.lock_fd = fd
        # Every existing admission, index, terminal and upgrade/package document
        # remains byte-identical; the new cycle may only append its own records.
        before = {str(p): sha(p.read_bytes()) for p in self.layout.evidence.rglob('*')
                  if p.is_file() and not p.is_symlink()}
        try:
            observed = runtime.status({'requireComplete': True, 'prospectiveRelease': release})
            forecast = observed['privateStageRetention']
            self.assertEqual(len(forecast['wouldRetire']), 4)
            self.assertTrue(runtime.S.reviewed_forecast(forecast))
            self.assertTrue(admission.reviewed_forecast(forecast))
            accepted = admission.installed_admission(observed['binding'], release, True, forecast, fd)
            for key in admission.RETIREMENT_FIELDS:
                self.assertEqual(accepted[key], observed[key])
            self.assertNotIn('verifiedPreFallbackIndex', accepted)
            self.assertNotEqual(accepted['verifiedCurrentPackageSha256'], accepted['verifiedRetirementPolicyCodeSha256'])
            # These must reject before any publication/lifecycle mutation.
            before_state = runtime.state_path.read_bytes()
            with self.assertRaises(ValueError):
                admission.installed_admission(observed['binding'], release, False, None, fd)
            bad = dict(forecast, verifiedRetiredPayloads=dict(forecast['verifiedRetiredPayloads'], receiptSha256='0' * 64))
            with self.assertRaises(ValueError):
                admission.installed_admission(observed['binding'], release, True, bad, fd)
            self.assertEqual(runtime.state_path.read_bytes(), before_state)

            # Materialize actual small release assets and clean source provenance.
            candidate = self.layout.scratch / ('candidate-' + release)
            candidate.mkdir(mode=0o700)
            self.fixture.release(candidate, release, runtime.S.V6_SURFACES, 'proofofwork-ui-release-v6')
            checkout = self.layout.scratch / ('proofofwork-ui-source-' + release)
            shutil.copytree(source, checkout)
            self.fixture.dependency_provenance(candidate, release)
            publisher = self.fixture.base / 'usr/local/sbin/proofofwork-ui-release-publish'
            publisher.parent.mkdir(parents=True, exist_ok=True)
            publisher.write_bytes((source / 'deploy/proofofwork-ui-release-publish.sh').read_bytes())
            publisher.chmod(0o700)
            attempt = 'composed-fixture'
            identity = {'releaseId': release, 'commit': commit, 'tree': tree}
            plan = {**identity, 'publicationAttempt': attempt, 'frontendOnly': True, 'retentionDeferred': True,
                    'publicationHelpers': {'publisher': {'path': str(publisher), 'sha256': sha(publisher.read_bytes())}},
                    'wrapperSourceSha256': {'publish.py': sha((source / 'deploy/publish/publish.py').read_bytes())},
                    'retentionLifecycle': observed['binding'], 'inputCompactor': {'sha256': '1' * 64},
                    'closedArchive': {'privateStaging': {'model': 'private-release-stage-v1'}},
                    'privateStageRetention': forecast, **{k: accepted[k] for k in admission.RETIREMENT_FIELDS}}
            plan_binding = L.write_new(self.layout.scratch / ('recovery-plan-' + release + '-' + attempt + '.json'), encoded(plan))
            archive = self.layout.archives / ('proofofwork-ui-release-' + release + '.tgz')
            stage = {**identity, 'ok': True, 'phase': 'surfaces-stage', 'planSha256': plan_binding['sha256'],
                     'managedArchive': str(archive), 'archiveSha256': sha(archive.read_bytes())}
            def record(folder, value):
                path = self.layout.scratch / folder / 'receipt.json'
                path.parent.mkdir(mode=0o700)
                return L.write_new(path, encoded(value))
            staged = record('recovery-transport-' + release + '-surfaces-stage-' + attempt, stage)
            transported = record('recovery-transport-' + release + '-source-' + attempt,
                {**identity, 'ok': True, 'phase': 'source', 'sourceCheckout': str(checkout),
                 'candidateProvenanceVerified': True, 'detachedSourceClean': True, 'planSha256': plan_binding['sha256'],
                 'verifiedStageReceiptSha256': staged['sha256']})
            publication_dir = self.layout.scratch / ('recovery-publish-' + release + '-' + attempt)
            publication_dir.mkdir(mode=0o700)
            intent = {**identity, 'attempt': attempt, 'planSha256': plan_binding['sha256'], 'retentionDeferred': True,
                      'lockHolderPid': os.getpid(), 'lockFd': fd,
                      'verifiedSourceReceiptSha256': transported['sha256'], 'verifiedStageReceiptSha256': staged['sha256']}
            L.write_new(publication_dir / 'intent.json', encoded(intent))
            fence = checkout / 'deploy/publish/native_exchange_fence.py'
            args = [sha(fence.read_bytes()), str(checkout), str(publisher), str(self.layout.live), str(self.layout.scratch),
                    str(self.layout.archives), str(self.layout.roots), str(self.layout.lock), fd, release, commit,
                    attempt, plan_binding['sha256'], True]
            program = ('import importlib.util,ctypes,os\n'
                's=importlib.util.spec_from_file_location("actual_native",' + repr(str(fence)) + ')\n'
                'm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n'
                'm.verify(*' + repr(args) + ')\n'
                'libc=ctypes.CDLL(None,use_errno=True)\n'
                'result=libc.renameat2(-100,os.fsencode(' + repr(str(candidate)) + '),-100,os.fsencode(' + repr(str(self.layout.live)) + '),2)\n'
                'assert result==0,ctypes.get_errno()\n'
                'os.rename(' + repr(str(candidate)) + ',' + repr(str(self.layout.roots / ('proofofwork-www-pre-' + release))) + ')\n'
                'print("ACTUAL_NATIVE_FENCE_AND_EXCHANGE_PASSED")\n')
            # Python owns flock; Bash is the real intermediate child; the helper
            # inherits the same open file description and verifies /proc evidence.
            native = subprocess.run(['/bin/bash', '-c', '/usr/bin/python3 -I -B -c "$1"; code=$?; exit "$code"',
                                     'fixture-native', program], pass_fds=(fd,), capture_output=True, text=True, timeout=180)
            self.assertEqual(native.returncode, 0, native.stdout + native.stderr)
            self.assertIn('ACTUAL_NATIVE_FENCE_AND_EXCHANGE_PASSED', native.stdout)
            pair, context = runtime.current()
            https, _, _ = self.https()
            receipt = L.write_new(publication_dir / 'receipt.json', encoded({**identity, 'attempt': attempt,
                'planSha256': plan_binding['sha256'], 'privateStageRetention': forecast, 'exitCode': 0,
                'failure': None, 'finishedAt': '2026-10-16T02:59:00Z'}))
            prep = runtime.prepare_cycle({'operationId': 'prepare-' + release, 'expectedStateSha256': observed['stateSha256'],
                'expectedPair': context['pair'], 'httpsReceipt': A.T.envelope(https), 'publicationReceipt': receipt})
            ordinary = json.loads(Path(prep['ordinaryPlan']['path']).read_bytes())
            self.assertEqual(sorted(r['path'] for r in ordinary['delete']), forecast['wouldRetire'])
            self.assertEqual(ordinary['policyScope']['verifiedRetiredPayloads'], observed['verifiedRetiredPayloads'])
            frame = {'cycleId': prep['cycleId'], 'pendingToken': prep['pendingToken'], 'expectedPair': context['pair'],
                     'expectedStateSha256': prep['stateSha256'], 'operationId': 'apply-' + release}
            applied = runtime.apply_vps_retention(frame)
            completed = runtime.complete_vps_cycle(dict(frame, expectedStateSha256=applied['stateSha256'], operationId='complete-' + release))
            fresh = L.installed_runtime(L.CONFIG_PATH, terminal['status']['configSha256'])
            fresh.lock_fd = fd
            status = fresh.status({'requireComplete': True})
            self.assertTrue(completed['retentionComplete'] and status['retentionComplete'])
            self.assertEqual(status['pair'], {'current': release, 'previous': observed['pair']['current']})
            self.assertEqual(status['verifiedRetiredPayloads'], observed['verifiedRetiredPayloads'])
            self.assertTrue(all(not os.path.lexists(p) for p in forecast['wouldRetire']))
            for path, digest in before.items():
                self.assertEqual(sha(Path(path).read_bytes()), digest, path)
            report = dict(terminal, status=status, baseline=baseline, productionActions=False,
                ordinaryPublicationCycle={'installedAdmission': True, 'actualNativeFence': True,
                    'inheritedLockVerified': True, 'actualAtomicExchange': True,
                    'prepareApplyComplete': True, 'forecast': forecast, 'newPair': status['pair'],
                    'ordinaryPlan': prep['ordinaryPlan'], 'ordinaryReceipt': applied['ordinaryReceipt'],
                    'historicalEvidenceFilesPreserved': len(before), 'sourceCommit': commit, 'sourceTree': tree,
                    'releaseFormat': 'proofofwork-ui-release-v6', 'managedRoots': len(runtime.S.V6_SURFACES),
                    'makePlanAndRemotePreflightExercised': False, 'publisherEntrypointExercised': False},
                publicationSubstitutions=self.publication_substitutions,
                boundaries=['generated real Git identities and explicit protected test namespaces',
                    'actual installed authority, sealed package successor and lifecycle state',
                    'synthetic asset/transport/HTTPS records; no public HTTP or production publication',
                    'actual shipped final fence with only exact temporary namespace adaptation'])
            result = self.fixture.base / 'authority-result.json'
            L.write_new(result, encoded(report))
        finally:
            runtime.lock_fd = None
            os.close(fd)
        consumer = subprocess.run(['/usr/bin/python3', '-I', '-B', str(ROOT / 'deploy/ui-retention/check-retirement-consumer-authority.test.py'),
                                   str(result), sha(result.read_bytes())], capture_output=True, text=True, timeout=240)
        self.assertEqual(consumer.returncode, 0, consumer.stdout + consumer.stderr)
        checked = json.loads(consumer.stdout)
        print('COMPOSED_RETIREMENT_PUBLICATION ' + json.dumps({'report': str(result), 'sha256': sha(result.read_bytes()),
            'consumer': {key: checked[key] for key in ('ok', 'realInstalledStatus', 'packageGitBlobAttestation',
                'rawReaderValidated', 'pureConsumerValidated', 'tamperCasesRejected', 'productionPinsRejectFixture')},
            'productionActions': False}, sort_keys=True), flush=True)


if __name__ == '__main__':
    unittest.main()
