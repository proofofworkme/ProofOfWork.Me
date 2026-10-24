#!/usr/bin/python3 -I
"""Hash-bound UI retention phases. No timers, broad pruning or implicit retries.

Production CLI: CONFIG CONFIG_SHA OP, followed by one bounded JSON stdin frame.
Every mutation is an independent deployment-lock phase. Immutable intents retain
the exact previous state; a failed phase requires explicit reconciliation.
"""
import base64
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

APPROVAL_SHA = 'df166edb2d9817dd4f8af24819880b6bf08b396b6aa483adaa141415fc709379'
CONFIG_PATH = Path('/etc/proofofwork-retention/ui-lifecycle.json')
STATE_PATH = Path('/var/lib/proofofwork-ui-retention/state.json')
CUSTODY_ROOT = '/home/sixer/ProofOfWork.Me.release-custody-ui-retention'
VPS_POLICY = {'model': 'vps-current-and-one-prior-v1', 'localBackups': False,
              'independentOffHostRecovery': False, 'authorizedAt': '2026-10-24'}
MAX_FRAME = 64 * 1024**2
SHA = re.compile(r'[0-9a-f]{64}\Z')
IDENTIFIER = re.compile(r'[a-z0-9][A-Za-z0-9-]{0,63}\Z')
PACKAGE_FILES = (
    'audits/2026-10-16-ui-retention-repair-approval.json',
    'audits/2026-10-16-ui-retention-repair-proposal.json',
    'deploy/audit30/ui-storage.py', 'deploy/audit30/ui-release-policy.py',
    'deploy/proofofwork-ui-verified-retention.py',
    'deploy/ui-retention/custody.py', 'deploy/ui-retention/inventory.py',
    'deploy/ui-retention/removal.py', 'deploy/ui-retention/lifecycle_remote.py',
    'deploy/ui-retention/install_lifecycle.py', 'deploy/ui-retention/lifecycle.py',
)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def unique(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError('Duplicate JSON key')
        out[key] = value
    return out


def require(ok, message):
    if not ok:
        raise ValueError(message)


def read(path, expected=None, maximum=MAX_FRAME):
    path = Path(path)
    before = path.lstat()
    require(path.is_absolute() and path.resolve() == path and stat.S_ISREG(before.st_mode)
            and before.st_uid == os.geteuid() and not before.st_mode & 0o7022
            and before.st_nlink == 1 and before.st_size <= maximum, 'Unsafe evidence file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    try:
        require(os.fstat(fd) == before, 'Evidence identity changed')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(maximum + 1)
        require(len(raw) <= maximum and os.fstat(fd) == before and path.lstat() == before,
                'Evidence changed during read')
    finally:
        os.close(fd)
    digest = sha(raw)
    require(expected is None or SHA.fullmatch(expected) and digest == expected, 'Evidence SHA differs')
    return raw, digest


def read_json(path, expected=None):
    raw, digest = read(path, expected)
    return json.loads(raw, object_pairs_hook=unique), digest


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, raw):
    path = Path(path)
    require(path.parent.resolve() == path.parent, 'Unsafe evidence parent')
    parent = path.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.geteuid()
            and not parent.st_mode & 0o7022, 'Unsafe evidence parent mode/owner')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)
    return {'path': str(path), 'sha256': sha(raw)}


def embedded(value):
    require(isinstance(value, dict) and set(value) in ({'base64', 'sha256'}, {'value', 'sha256'}),
            'Embedded evidence requires exact bytes and SHA')
    require(SHA.fullmatch(value.get('sha256', '')), 'Invalid embedded evidence SHA')
    if 'base64' in value:
        raw = base64.b64decode(value['base64'], validate=True)
    else:
        raw = encoded(value['value'])
        if sha(raw) != value['sha256']:
            raw = raw[:-1]
    require(len(raw) <= MAX_FRAME and sha(raw) == value['sha256'], 'Embedded evidence SHA differs')
    return json.loads(raw, object_pairs_hook=unique), raw


def load_module(name, path, **bindings):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    module.__dict__.update(bindings)
    spec.loader.exec_module(module)
    return module


def validate_config(path, expected):
    config, digest = read_json(path, expected)
    require(Path(path) == CONFIG_PATH, 'Unexpected lifecycle config path')
    require(config.get('schema') == 'pow-ui-retention-lifecycle-config-v1'
            and config.get('scopeApprovalSha256') == APPROVAL_SHA
            and config.get('statePath') == str(STATE_PATH)
            and ((config.get('retentionPolicy') is None and config.get('offHostCustodyRoot') == CUSTODY_ROOT)
                 or (config.get('retentionPolicy') == VPS_POLICY and config.get('offHostCustodyRoot') is None)),
            'Lifecycle configuration authority differs')
    binding = config['package']
    package = Path(binding['path'])
    require(package.parent == Path('/var/backups/proofofwork-ui/cleanup-evidence')
            and package.name == 'ui-lifecycle-tools-' + binding['sha256'], 'Unexpected lifecycle package')
    manifest, _ = read_json(package / 'package.json', binding['sha256'])
    require(manifest.get('schema') == 'pow-ui-retention-package-v1'
            and manifest.get('sourceCommit') == config['sourceCommit']
            and manifest.get('sourceTree') == config['sourceTree']
            and set(manifest['files']) == set(PACKAGE_FILES), 'Package source/file scope differs')
    for relative, pin in manifest['files'].items():
        raw, _ = read(package / relative, pin['sha256'], 2 * 1024**2)
        require(len(raw) == pin['bytes'], 'Package file size differs')
    require(Path(__file__).resolve() == package / 'deploy/ui-retention/lifecycle_remote.py',
            'Coordinator must run from the pinned package')
    require(config['controller'] == {'path': str(package / 'deploy/ui-retention/lifecycle_remote.py'),
                                    'sha256': manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']},
            'Controller binding differs')
    require(config['approval'] == {'path': str(package / PACKAGE_FILES[0]), 'sha256': APPROVAL_SHA},
            'Approval file binding differs')
    read(config['approval']['path'], APPROVAL_SHA)
    return config, digest, package


class Runtime:
    def __init__(self, config, config_sha, storage, policy, custody=None, layout=None, *, verify_upgrade=False,
                 completion_access_time_reconciliation=None, completion_historical_bulk_preservation=None):
        self.config = config
        self.config_sha = config_sha
        self.S = storage
        self.P = policy
        self.C = custody
        self.layout = layout or storage.Layout()
        self.state_path = Path(config['statePath'])
        self.lock_fd = None
        # Only the installer calls this constructor keyword, while holding the
        # deployment lock. The public dispatcher never accepts a bypass frame.
        self.verify_upgrade = verify_upgrade
        # Only an authenticated completed-config repair supplies this exact proof.
        # Normal status and every public mutation frame remain strict.
        self.completion_access_time_reconciliation = completion_access_time_reconciliation
        self.completion_historical_bulk_preservation = completion_historical_bulk_preservation

    def current(self):
        cache = {}
        pair = self.S.protected_pair(self.layout, cache)
        guards, _ = self.S.safeguards(self.layout, model=self.S.ROTATING_LOG_GUARD_MODEL)
        ids = self.P.pair_ids(pair)
        manifests = {key: self.S.hash_read(Path(pair[key]['path']) / '.proofofwork-ui-release')[0]
                     for key in ('current', 'previous')}
        return pair, {'pair': ids, 'manifests': manifests, 'guards': guards}

    def state(self):
        if not os.path.lexists(self.state_path):
            return None, None
        value, digest = read_json(self.state_path)
        require(value.get('schema') == 'pow-ui-retention-lifecycle-state-v1'
                and value.get('configSha256') == self.config_sha
                and type(value.get('revision')) is int, 'State authority differs')
        if value.get('lastUpgrade'):
            upgrade = value['lastUpgrade']
            journal = self.layout.evidence / ('ui-lifecycle-upgrade-' + self.config['package']['sha256'])
            require(upgrade['intentPath'] == str(journal / 'intent.json')
                    and upgrade['completionPath'] == str(journal / 'completed.json'), 'Upgrade proof namespace differs')
            completed, _ = read_json(upgrade['completionPath'])
            require(completed.get('schema') == 'pow-ui-retention-upgrade-completed-v1'
                    and completed.get('ok') is True
                    and completed['config'] == {'path': str(CONFIG_PATH), 'sha256': self.config_sha}
                    and completed['intent'] == {'path': upgrade['intentPath'], 'sha256': upgrade['intentSha256']}
                    and completed['stateRevision'] <= value['revision'], 'Upgrade terminal proof differs')
            intent, _ = read_json(upgrade['intentPath'], upgrade['intentSha256'])
            template = intent['stateTemplate']
            reconciled = dict(template, lastUpgrade=dict(template['lastUpgrade'], intentSha256=upgrade['intentSha256']))
            require(reconciled['lastUpgrade'] == upgrade
                    and template['configSha256'] == self.config_sha
                    and intent['stateTemplateSha256'] == sha(encoded(template))
                    and sha(encoded(reconciled)) == completed['state']['sha256']
                    and completed['stateRevision'] == template['revision']
                    and completed['priorConfig']['path'] == str(journal / 'prior-config.json')
                    and completed['priorState']['path'] == str(journal / 'prior-state.json')
                    and completed['priorConfig']['sha256'] == upgrade['priorConfigSha256']
                    and completed['priorState']['sha256'] == upgrade['priorStateSha256']
                    and completed['supersededCycleId'] == upgrade['supersededCycleId'], 'Upgrade reconciliation differs')
            read(completed['priorConfig']['path'], upgrade['priorConfigSha256'])
            read(completed['priorState']['path'], upgrade['priorStateSha256'])
            if 'preservedCompletedCycleId' in upgrade:
                proof = completed['completionVerification']
                require(intent['disposition'] == 'completed-cycle-preserved'
                        and intent['freshPreparationRequired'] is False
                        and completed['freshPreparationRequired'] is False
                        and completed['retentionComplete'] is True
                        and completed['preservedCompletedCycleId'] == upgrade['preservedCompletedCycleId']
                        and upgrade['supersededCycleId'] is None
                        and template['status'] == 'complete' and not template.get('pending')
                        and proof['fullCompletionVerified'] is True
                        and proof['context'] == template['completedContext']
                        and proof['index'] == template['index']
                        and proof['lastCompleted'] == template['lastCompleted'],
                        'Preserved completion upgrade proof differs')
            self.verify_status_seal(upgrade, completed, template,
                                    skip=self.verify_upgrade)
        return value, digest

    def verify_status_seal(self, upgrade, completed, template, *, skip=False):
        if not upgrade.get('statusVerificationPath'):
            return
        path = Path(upgrade['completionPath']).parent / 'verified.json'
        require(upgrade['statusVerificationPath'] == str(path), 'Upgrade status verification namespace differs')
        if skip:
            return
        verified, _ = read_json(path)
        _, receipt_sha = read_json(upgrade['completionPath'])
        require(verified.get('schema') == 'pow-ui-retention-upgrade-status-verified-v1'
                and verified.get('ok') is True
                and verified['config'] == completed['config']
                and verified['state'] == completed['state']
                and verified['upgradeReceipt'] == {'path': upgrade['completionPath'], 'sha256': receipt_sha}
                and verified['preservedCompletedCycleId'] == upgrade['preservedCompletedCycleId']
                and verified['contextSha256'] == sha(encoded(template['completedContext'])),
                'Post-switch normal status proof differs')

    def completion_lifecycle(self, state, index):
        upgrade = state.get('lastUpgrade', {})
        if upgrade.get('preservedCompletedCycleId') == state.get('lastCompleted', {}).get('cycleId'):
            completed, _ = read_json(upgrade['completionPath'])
            proof = completed['completionVerification']
            require(proof['lastCompleted'] == state['lastCompleted'] and proof['index'] == index,
                    'Preserved completion identity differs')
            return proof['custodyLifecycle']
        return self.lifecycle(index)

    def completion_transitions(self, state):
        """Only sealed upgrades preserving this exact completed cycle qualify."""
        chain = []; checkpoint = state
        completed_cycle = state.get('lastCompleted', {}).get('cycleId')
        for _ in range(16):
            upgrade = checkpoint.get('lastUpgrade', {})
            if not completed_cycle or upgrade.get('preservedCompletedCycleId') != completed_cycle:
                break
            intent, _ = read_json(upgrade['intentPath'], upgrade['intentSha256'])
            completed, completed_sha = read_json(upgrade['completionPath'])
            require(intent['disposition'] == 'completed-cycle-preserved'
                    and completed['intent'] == {'path': upgrade['intentPath'], 'sha256': upgrade['intentSha256']}
                    and completed['preservedCompletedCycleId'] == completed_cycle,
                    'Completed config transition differs')
            self.verify_status_seal(upgrade, completed, intent['stateTemplate'],
                                    skip=self.verify_upgrade and checkpoint is state)
            prior, _ = read_json(completed['priorState']['path'], upgrade['priorStateSha256'])
            require(all(prior[k] == state[k] for k in ('index', 'completedContext', 'lastCompleted', 'lastIntent'))
                    and prior['status'] == 'complete' and not prior.get('pending') and not prior.get('activePhase'),
                    'Config transition changed completed proof')
            chain.append({'intent': {'path': upgrade['intentPath'], 'sha256': upgrade['intentSha256']},
                          'completed': {'path': upgrade['completionPath'], 'sha256': completed_sha}})
            checkpoint = prior
        else:
            raise ValueError('Completed config transition chain exceeds bound')
        return list(reversed(chain))

    def evidence(self, name, value):
        raw = encoded(value)
        self.capacity(len(raw) + 65536)
        return write_new(self.layout.evidence / name, raw)

    def store(self, name, envelope):
        value, raw = embedded(envelope)
        self.capacity(len(raw) + 65536)
        return value, write_new(self.layout.evidence / name, raw)

    def lifecycle(self, index):
        return {'schema': 'pow-ui-custody-lifecycle-v1', 'approval': self.config['approval'], 'index': index}

    def unfinished_intents(self):
        paths = sorted(self.layout.evidence.glob('ui-lifecycle-*-intent.json'))
        require(len(paths) <= 100000, 'Lifecycle evidence enumeration exceeds bound')
        return [str(path) for path in paths
                if not os.path.lexists(path.with_name(path.name.removesuffix('-intent.json') + '-completed.json'))]

    def cas(self, before_sha, value, operation_id):
        _, actual = self.state()
        require(actual == before_sha, 'State changed; explicit reconciliation required')
        temporary = self.state_path.with_name('state-' + operation_id + '.next.json')
        write_new(temporary, encoded(value))
        _, actual = self.state()
        require(actual == before_sha, 'State changed before atomic advancement')
        os.replace(temporary, self.state_path)
        sync(self.state_path.parent)
        return sha(encoded(value))

    def begin(self, operation, frame, state, state_sha, context):
        operation_id = frame.get('operationId', '')
        require(isinstance(operation_id, str) and IDENTIFIER.fullmatch(operation_id), 'Invalid operation ID')
        require(frame.get('expectedStateSha256') == state_sha, 'Stale expected state SHA')
        require(frame.get('expectedPair') == context['pair'], 'Current/prior pair differs')
        require(not state or not state.get('activePhase'), 'Unfinished phase requires explicit reconciliation')
        require(not self.unfinished_intents(), 'Unsealed phase intent requires explicit reconciliation')
        # Admission charges durable metadata to its actual retained pool.
        reserve = max(8 * 1024**2, len(encoded(frame)) * 4)
        self.capacity(reserve)
        prior_raw = read(self.state_path, state_sha)[0] if state else None
        intent = {'schema': 'pow-ui-retention-phase-intent-v1', 'operation': operation,
                  'operationId': operation_id, 'configSha256': self.config_sha,
                  'priorStateSha256': state_sha,
                  'priorStateBase64': base64.b64encode(prior_raw).decode() if prior_raw else None,
                  'context': context, 'request': frame, 'atUtc': self.S.utc()}
        binding = self.evidence('ui-lifecycle-' + operation_id + '-intent.json', intent)
        active = dict(state or {'schema': 'pow-ui-retention-lifecycle-state-v1', 'configSha256': self.config_sha,
                                'revision': -1, 'index': None, 'pending': None, 'completedContext': None},
                      revision=(state['revision'] if state else -1) + 1, status='retention-incomplete',
                      activePhase={'operation': operation, 'operationId': operation_id, 'intent': binding})
        active_sha = self.cas(state_sha, active, operation_id + '-intent')
        return operation_id, binding, active_sha

    def capacity(self, additional=0):
        result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(self.layout.capacity), 'check',
                                 '--path', str(self.layout.evidence), '--additional-bytes', str(additional),
                                 '--additional-inodes', '128', '--phase', 'ui-retention-lifecycle'],
                                capture_output=True, check=True, timeout=60)
        return json.loads(result.stdout)

    def finish(self, operation_id, intent, before_sha, state, result):
        state = dict(state, activePhase=None)
        result = dict(result, ok=True, publicationHealthy=True, intent=intent,
                      stateSha256=sha(encoded(state)), stateRevision=state['revision'])
        receipt = self.evidence('ui-lifecycle-' + operation_id + '-completed.json', result)
        self.cas(before_sha, state, operation_id)
        return dict(result, receipt=receipt)

    def pending(self, state, frame, context, stage):
        require(state is not None and state.get('pending'), 'No pending cycle')
        require(not state.get('activePhase'), 'Partial phase requires explicit reconciliation')
        pending = state['pending']
        require(pending['stage'] == stage, 'Partial phase requires explicit reconciliation')
        require(frame.get('cycleId') == pending['cycleId'] and frame.get('pendingToken') == pending['token'],
                'Pending cycle token differs')
        require(pending['context'] == context, 'Protected pair or exact guards changed during cycle')
        return pending

    def status(self, frame):
        state, digest = self.state()
        _, context = self.current()
        unfinished = self.unfinished_intents()
        completion_verification = None
        complete = bool(state and state.get('status') == 'complete' and not state.get('pending')
                        and not state.get('activePhase') and not unfinished and state.get('completedContext') == context)
        if state and state.get('index'):
            index = state['index']
            self.P.load_index(index['path'], index['sha256'], self.layout, APPROVAL_SHA)
            if complete:
                require(not self.P.policy_scope(index, self.layout, APPROVAL_SHA)['eligible'],
                        'Completed state has eligible ordinary assets')
                if state['lastCompleted'].get('retentionPolicy') == VPS_POLICY:
                    completion_verification = self.verify_vps_completion(state, context)
                else:
                    completion_verification = self.verify_custody_completion(state, index, digest)
        if frame.get('requireComplete'):
            require(complete, 'Published UI is healthy; retention-incomplete blocks another upload')
        return {'ok': True, 'initialized': state is not None, 'retentionComplete': complete,
                **({'verifiedAccessTimeReconciliation': completion_verification['verifiedAccessTimeReconciliation']}
                   if self.completion_access_time_reconciliation is not None and completion_verification else {}),
                **({'verifiedHistoricalBulkPreservation': completion_verification['verifiedHistoricalBulkPreservation']}
                   if completion_verification and completion_verification.get('verifiedHistoricalBulkPreservation') else {}),
                'publicationHealthy': True, 'configSha256': self.config_sha, 'stateSha256': digest,
                'pair': context['pair'], 'context': context, 'index': state.get('index') if state else None,
                'pending': state.get('pending') if state else None,
                'unfinishedIntents': unfinished,
                'retentionPolicy': self.config.get('retentionPolicy'),
                'historicalBulkPreserved': self.config.get('retentionPolicy') == VPS_POLICY,
                'offHostCustodyRoot': self.config['offHostCustodyRoot'],
                'binding': {'config': {'path': str(CONFIG_PATH), 'sha256': self.config_sha},
                            'controller': self.config['controller'],
                            'state': {'path': str(self.state_path), 'sha256': digest}, 'pair': context['pair']}}

    def verify_custody_completion(self, state, index, digest):
        # Historical completions remain authenticated during migration.
        for key in ('custodyPlan', 'custodyResult', 'ordinaryReceipt'):
            binding = state['lastCompleted'][key]
            read(binding['path'], binding['sha256'])
        require(self.C is not None, 'Custody verifier unavailable')
        plan_binding = state['lastCompleted']['custodyPlan']
        result_binding = state['lastCompleted']['custodyResult']
        plan, _ = read_json(plan_binding['path'], plan_binding['sha256'])
        result, _ = read_json(result_binding['path'], result_binding['sha256'])
        require(plan.get('lifecycle') == self.completion_lifecycle(state, index), 'Completed custody index differs')
        transitions = self.completion_transitions(state)
        access_time = self.completion_access_time_reconciliation
        if access_time is not None:
            require(access_time['stateSha256'] == digest and access_time['configSha256'] == self.config_sha
                    and access_time['cycleId'] == state['lastCompleted']['cycleId'],
                    'Access-time repair no longer binds the completed state')
        preserved_bulk = self.completion_historical_bulk_preservation
        if preserved_bulk is not None:
            require(preserved_bulk['stateSha256'] == digest and preserved_bulk['configSha256'] == self.config_sha
                    and preserved_bulk['cycleId'] == state['lastCompleted']['cycleId'],
                    'Historical bulk preservation no longer binds the completed state')
        return self.C.verify_final_result(plan, plan_binding['sha256'], result, result_binding['sha256'],
                                   **({'config_transitions': transitions} if transitions else {}),
                                   **({'config_access_time_reconciliation': access_time} if access_time is not None else {}),
                                   **({'historical_bulk_preservation': preserved_bulk} if preserved_bulk is not None else {}))

    def verify_vps_completion(self, state, context):
        require(self.config.get('retentionPolicy') == VPS_POLICY
                and self.config.get('offHostCustodyRoot') is None, 'VPS retention policy not installed')
        completed = state['lastCompleted']
        require(completed.get('retentionPolicy') == VPS_POLICY
                and completed.get('retainedPair') == context['pair'], 'VPS retained pair authority differs')
        plan_binding = completed['ordinaryPlan']; receipt_binding = completed['ordinaryReceipt']
        plan, _ = read_json(plan_binding['path'], plan_binding['sha256'])
        receipt, _ = read_json(receipt_binding['path'], receipt_binding['sha256'])
        index = self.P.load_index(state['index']['path'], state['index']['sha256'], self.layout, APPROVAL_SHA)
        require(receipt_binding in index['index']['completedRetirements']
                and receipt.get('status') == 'completed'
                and receipt.get('planSha256') == self.S.digest(plan)
                and self.P.pair_ids(plan['protected']) == context['pair']
                and all(not os.path.lexists(row['path']) for row in plan['delete']),
                'VPS ordinary retirement proof differs')
        require(not self.P.policy_scope(state['index'], self.layout, APPROVAL_SHA)['eligible'],
                'Completed VPS state has eligible ordinary assets')
        return {'retainedVpsPairVerified': True, 'retainedPair': context['pair'],
                'retentionPolicy': VPS_POLICY, 'historicalBulkPreserved': True,
                'independentOffHostRecovery': False}

    def bootstrap(self, frame):
        state, state_sha = self.state()
        require(state is None, 'Existing lifecycle state requires explicit reconciliation')
        _, context = self.current()
        operation_id, intent, active_sha = self.begin('bootstrap', frame, state, state_sha, context)
        review = frame['migrationReview']
        if 'path' not in review:
            _, review = self.store('audit30-policy-migration-review-' + operation_id + '.json', review)
        migration = self.P.migration_admission(self.layout, APPROVAL_SHA, review)
        migration_binding = self.evidence('audit30-policy-migration-' + operation_id + '.json', migration)
        anchor = self.evidence('audit30-policy-admission-migration-' + operation_id + '.json', migration['anchor'])
        index = self.evidence('audit30-policy-admission-index-' + operation_id + '.json',
                              {'schema': self.P.INDEX_V2, 'scopeApprovalSha256': APPROVAL_SHA,
                               'migration': migration_binding, 'admissions': [anchor], 'completedRetirements': []})
        self.P.load_index(index['path'], index['sha256'], self.layout, APPROVAL_SHA)
        new = {'schema': 'pow-ui-retention-lifecycle-state-v1', 'configSha256': self.config_sha,
               'revision': 1, 'status': 'retention-incomplete', 'index': index, 'pending': None,
               'completedContext': None, 'lastIntent': intent}
        return self.finish(operation_id, intent, active_sha, new,
                           {'index': index, 'retentionComplete': False, 'lifecycleBinding': self.lifecycle(index)})

    def verify_publication(self, https, publication, pair, context):
        current = pair['current']['fields']
        require(https.get('format') == 'publish-ui-https-byte-smoke-v1' and https.get('ok') is True,
                'HTTPS verification did not complete')
        for key, expected in {'releaseId': current['release_id'], 'commit': current['commit'],
                              'tree': current['source_tree'], 'archiveSha256': current['archive_sha256'],
                              'manifestSha256': context['manifests']['current']}.items():
            require(https.get(key) == expected, 'HTTPS proof does not bind live ' + key)
        for key in ('sidecarAndProvenanceVerified', 'sourceProvenanceVerified', 'finalLocalEvidenceReverified',
                    'apexRedirectVerified'):
            require(https.get(key) is True, 'Incomplete HTTPS proof: ' + key)
        surfaces = self.S.declared_surfaces(current)
        count = sum(int(current['surface.' + name + '.file_count']) for name in surfaces if name != 'nft')
        require(https.get('expectedPublicFiles') == count == https.get('archivedFilesChecked')
                and https.get('hostnameRootsChecked') == len(surfaces) - 1
                and https.get('publicSurfaces') == len(surfaces) - 1
                and https.get('sourceProvenanceSurfaces') == len(surfaces) - 1,
                'HTTPS proof omits public assets or surfaces')
        path = Path(publication['path'])
        require(path.name == 'receipt.json' and path.parent.parent == self.layout.scratch
                and path.parent.name.startswith('recovery-publish-' + current['release_id'] + '-'),
                'Publication terminal receipt namespace differs')
        require(set(publication) in ({'path', 'sha256'}, {'path', 'value'}), 'Invalid publication binding')
        require('sha256' not in publication or isinstance(publication['sha256'], str)
                and SHA.fullmatch(publication['sha256']), 'Invalid publication receipt SHA')
        terminal, terminal_sha = read_json(path, publication.get('sha256'))
        require('value' not in publication or terminal == publication['value'], 'Publication terminal value differs')
        require(terminal.get('releaseId') == current['release_id'] and terminal.get('commit') == current['commit']
                and terminal.get('tree') == current['source_tree'] and terminal.get('exitCode') == 0
                and terminal.get('failure') is None, 'Publication terminal proof differs')
        require(datetime.datetime.fromisoformat(https['finishedAt'].replace('Z', '+00:00')) >=
                datetime.datetime.fromisoformat(terminal['finishedAt'].replace('Z', '+00:00')),
                'HTTPS proof predates publication completion')
        return {'path': str(path), 'sha256': terminal_sha}

    def prepare_cycle(self, frame):
        state, state_sha = self.state()
        require(state is not None and state.get('index') and state.get('pending') is None
                and not state.get('activePhase'), 'Initialize or reconcile the pending lifecycle first')
        pair, context = self.current()
        https, _ = embedded(frame['httpsReceipt'])
        publication = self.verify_publication(https, frame['publicationReceipt'], pair, context)
        operation_id, intent, active_sha = self.begin('prepare-cycle', frame, state, state_sha, context)
        _, https_binding = self.store('ui-lifecycle-' + operation_id + '-https.json', frame['httpsReceipt'])
        index = state['index']
        data = self.P.load_index(index['path'], index['sha256'], self.layout, APPROVAL_SHA)
        if context['pair']['current'] not in data['releaseIds']:
            admission = self.P.admission(self.layout, APPROVAL_SHA, False, index)
            admission_binding = self.evidence('audit30-policy-admission-' + operation_id + '.json', admission)
            index_value = dict(data['index'], admissions=[*data['index']['admissions'], admission_binding])
            index = self.evidence('audit30-policy-admission-index-' + operation_id + '.json', index_value)
        else:
            require(data['admissions'][-1]['retainedPair'] == context['pair'], 'Latest admission does not bind live pair')
        scope = self.P.policy_scope(index, self.layout, APPROVAL_SHA)
        plan = self.S.create_plan(self.layout, 'future-retention', APPROVAL_SHA, scope)
        plan_raw = self.S.encoded(plan)
        self.capacity(len(plan_raw) + 65536)
        plan_binding = write_new(self.layout.evidence / ('ui-lifecycle-' + operation_id + '-ordinary-plan.json'), plan_raw)
        token = sha(encoded({'intent': intent, 'plan': plan_binding, 'context': context}))
        pending = {'cycleId': operation_id, 'token': token, 'stage': 'prepared', 'context': context,
                   'ordinaryPlan': plan_binding, 'httpsReceipt': https_binding,
                   'publicationReceipt': publication, 'index': index}
        new = dict(state, revision=state['revision'] + 2, status='retention-incomplete', index=index,
                   pending=pending, lastIntent=intent)
        return self.finish(operation_id, intent, active_sha, new,
                           {'cycleId': operation_id, 'pendingToken': token, 'index': index,
                            'ordinaryPlan': plan_binding if self.config.get('retentionPolicy') == VPS_POLICY else dict(plan_binding, value=plan),
                            'lifecycleBinding': self.lifecycle(index), 'retentionComplete': False})

    def apply_ordinary(self, frame, *, vps_only=False):
        require((self.config.get('retentionPolicy') == VPS_POLICY and self.config.get('offHostCustodyRoot') is None) if vps_only
                else self.config.get('retentionPolicy') is None,
                'Operation does not match installed retention policy')
        if vps_only:
            require(set(frame) == {'expectedStateSha256', 'expectedPair', 'operationId', 'cycleId', 'pendingToken'},
                    'Expanded VPS retention request')
        state, state_sha = self.state()
        _, context = self.current()
        pending = self.pending(state, frame, context, 'prepared')
        plan, _ = read_json(pending['ordinaryPlan']['path'], pending['ordinaryPlan']['sha256'])
        operation_id, intent, active_sha = self.begin('apply-vps-retention' if vps_only else 'apply-ordinary', frame, state, state_sha, context)
        for row in ([] if vps_only else frame.get('custodyRecords', [])):
            _, raw = embedded(row)
            path = self.layout.evidence / ('ui-retention-custody-record-' + row['sha256'] + '.json')
            if os.path.lexists(path):
                read(path, row['sha256'])
            else:
                self.capacity(len(raw) + 65536)
                write_new(path, raw)
        proof = None
        if not vps_only:
            _, proof = self.store('ui-retention-custody-proof-' + operation_id + '.json', frame['custodyProof'])
            self.P.verify_custody_proof(proof, plan, self.layout, APPROVAL_SHA)
        applying = dict(state, revision=state['revision'] + 2,
                        pending=dict(pending, stage='applying', **({'retentionPolicy': VPS_POLICY} if vps_only else {'custodyProof': proof})),
                        lastIntent=intent)
        applying_sha = self.cas(active_sha, applying, operation_id + '-start')
        # No catch-and-retry: interruption leaves the applying state and immutable
        # policy progress records for explicit reconciliation.
        outcome = self.S.execute(plan, self.S.digest(plan), self.layout, True, lock_fd=self.lock_fd)
        require(outcome.get('status') == 'completed', 'Ordinary retirement did not complete')
        previous_index, _ = read_json(state['index']['path'], state['index']['sha256'])
        completed = {'path': outcome['receiptPath'], 'sha256': outcome['receiptSha256']}
        next_index = dict(previous_index, completedRetirements=[*previous_index['completedRetirements'], completed])
        index = self.evidence('audit30-policy-admission-index-' + operation_id + '.json', next_index)
        self.P.load_index(index['path'], index['sha256'], self.layout, APPROVAL_SHA)
        require(not self.P.policy_scope(index, self.layout, APPROVAL_SHA)['eligible'], 'Ordinary assets remain eligible')
        new = dict(applying, revision=applying['revision'] + 1, index=index,
                   pending=dict(applying['pending'], stage='ordinary-complete', index=index, ordinaryReceipt=completed))
        return self.finish(operation_id, intent, applying_sha, new,
                           {'cycleId': pending['cycleId'], 'pendingToken': pending['token'], 'index': index,
                            'ordinaryReceipt': completed, 'lifecycleBinding': self.lifecycle(index),
                            'freshCustodyQualificationRequired': not vps_only, 'retentionComplete': False})

    def apply_vps_retention(self, frame):
        return self.apply_ordinary(frame, vps_only=True)

    def complete_vps_cycle(self, frame):
        require(self.config.get('retentionPolicy') == VPS_POLICY and self.config.get('offHostCustodyRoot') is None,
                'VPS retention policy not installed')
        require(set(frame) == {'expectedStateSha256', 'expectedPair', 'operationId', 'cycleId', 'pendingToken'},
                'Expanded VPS completion request')
        state, state_sha = self.state()
        _, context = self.current()
        pending = self.pending(state, frame, context, 'ordinary-complete')
        require(pending.get('retentionPolicy') == VPS_POLICY, 'VPS apply authority differs')
        completed = {'cycleId': pending['cycleId'], 'retentionPolicy': VPS_POLICY,
                     'retainedPair': context['pair'], 'ordinaryPlan': pending['ordinaryPlan'],
                     'ordinaryReceipt': pending['ordinaryReceipt']}
        verification = self.verify_vps_completion(dict(state, lastCompleted=completed), context)
        operation_id, intent, active_sha = self.begin('complete-vps-cycle', frame, state, state_sha, context)
        _, after = self.current()
        require(after == context, 'Protected pair or guard fence changed at completion')
        pools = self.capacity()
        new = dict(state, revision=state['revision'] + 2, status='complete', pending=None,
                   completedContext=context, lastIntent=intent, lastCompleted=completed)
        return self.finish(operation_id, intent, active_sha, new,
                           {'cycleId': pending['cycleId'], 'index': state['index'], 'retentionComplete': True,
                            'pair': context['pair'], 'pools': pools, 'vpsVerification': verification,
                            'retentionPolicy': VPS_POLICY, 'historicalBulkPreserved': True,
                            'independentOffHostRecovery': False})

    def complete_cycle(self, frame):
        require(self.config.get('retentionPolicy') is None, 'Legacy custody completion disabled by VPS policy')
        state, state_sha = self.state()
        _, context = self.current()
        pending = self.pending(state, frame, context, 'ordinary-complete')
        require(self.C is not None, 'Custody verifier unavailable')
        plan, plan_raw = embedded(frame['custodyPlan'])
        result, result_raw = embedded(frame['custodyResult'])
        require(plan.get('lifecycle') == self.lifecycle(state['index']), 'Fresh custody qualification index differs')
        require(not self.P.policy_scope(state['index'], self.layout, APPROVAL_SHA)['eligible'],
                'Ordinary assets remain eligible')
        # The verifier authenticates remote terminal receipts and requalifies all
        # remaining discovered candidates; omitted eligible bulk cannot pass.
        verification = self.C.verify_final_result(plan, sha(plan_raw), result, sha(result_raw))
        operation_id, intent, active_sha = self.begin('complete-cycle', frame, state, state_sha, context)
        _, plan_binding = self.store('ui-lifecycle-' + operation_id + '-custody-plan.json', frame['custodyPlan'])
        _, result_binding = self.store('ui-lifecycle-' + operation_id + '-custody-result.json', frame['custodyResult'])
        _, after = self.current()
        require(after == context, 'Protected pair or guard fence changed at completion')
        pools = self.capacity()
        new = dict(state, revision=state['revision'] + 2, status='complete', pending=None,
                   completedContext=context, lastIntent=intent,
                   lastCompleted={'cycleId': pending['cycleId'], 'custodyPlan': plan_binding,
                                  'custodyResult': result_binding, 'ordinaryReceipt': pending['ordinaryReceipt']})
        return self.finish(operation_id, intent, active_sha, new,
                           {'cycleId': pending['cycleId'], 'index': state['index'], 'retentionComplete': True,
                            'pair': context['pair'], 'pools': pools, 'custodyVerification': verification})

    def dispatch(self, operation, frame):
        methods = {'status': self.status, 'bootstrap': self.bootstrap, 'prepare-cycle': self.prepare_cycle,
                   'apply-ordinary': self.apply_ordinary, 'complete-cycle': self.complete_cycle,
                   'apply-vps-retention': self.apply_vps_retention, 'complete-vps-cycle': self.complete_vps_cycle}
        require(operation in methods and isinstance(frame, dict), 'Unsupported lifecycle operation/frame')
        lock = self.S.lock(self.layout)
        try:
            self.lock_fd = lock
            return methods[operation](frame)
        finally:
            self.lock_fd = None
            os.close(lock)


def main():
    require(os.geteuid() == 0, 'Production lifecycle requires root')
    require(len(sys.argv) == 4, 'Expected CONFIG CONFIG_SHA OP')
    os.umask(0o077)
    config, config_sha, package = validate_config(sys.argv[1], sys.argv[2])
    storage = load_module('lifecycle_storage', package / 'deploy/audit30/ui-storage.py')
    policy = load_module('lifecycle_policy', package / 'deploy/audit30/ui-release-policy.py', _BOUND_STORAGE=storage)
    custody = load_module('lifecycle_custody', package / 'deploy/ui-retention/custody.py')
    custody.load_helpers()
    raw = sys.stdin.buffer.read(MAX_FRAME + 1)
    require(len(raw) <= MAX_FRAME, 'Request frame exceeds bound')
    frame = json.loads(raw, object_pairs_hook=unique)
    out = Runtime(config, config_sha, storage, policy, custody).dispatch(sys.argv[3], frame)
    sys.stdout.buffer.write(encoded(out))


if __name__ == '__main__':
    main()
