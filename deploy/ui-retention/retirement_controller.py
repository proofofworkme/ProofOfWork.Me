#!/usr/bin/env python3
"""Exact four-payload adapter and explicit one-step operator; no automatic retry or timer.

The reviewed installer must first bind an owner approval and pending policy
under the existing deployment lock. This module then reuses the established
descriptor-relative stock remover. An interrupted action is never reissued.

Bootstrap trust: before invoking this entrypoint, the external reviewed launcher
must authenticate the expected package-manifest digest, every listed file hash,
the exact file allowlist, and this controller digest in the protected root-owned
package. This module imports receipt/removal companions at module initialization;
its later self-validation cannot authenticate code that has already executed.
Neither a package directory name nor --package-sha alone supplies that bootstrap.
"""
import hashlib
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat

def _load(name):
    spec = importlib.util.spec_from_file_location('retirement_' + name,
        Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

R = _load('retirement_receipt')
W = _load('removal')
E = W.E
TOKEN = object()
LOCK = Path('/run/proofofwork-ui/deploy.lock')
CURRENT_MANIFEST_SHA = '8dfdd08748108ea23438644ed43707502c7e29ecf9d939c5f7a98114e7137bca'
PREVIOUS_MANIFEST_SHA = '407e51344a91043621ed8fa7de52155c8823c165f148454ae46ea30c4ab8dd2e'

def require(value, message):
    R.require(value, message)

def lock_fence(fd):
    named = LOCK.lstat()
    opened = os.fstat(fd)
    require(LOCK.resolve(strict=True) == LOCK and stat.S_ISREG(named.st_mode)
            and named.st_uid == named.st_gid == 0 and named.st_nlink == 1
            and not named.st_mode & 0o022
            and E.identity(named) == E.identity(opened), 'Deployment lock changed')
    raw = Path('/proc/self/fdinfo/' + str(fd)).read_text()
    lines = [line.split() for line in raw.splitlines() if line.startswith('lock:')]
    require(len(raw) <= 16384 and len(lines) == 1 and len(lines[0]) == 9
            and lines[0][2:6] == ['FLOCK', 'ADVISORY', 'WRITE', str(os.getpid())]
            and lines[0][7:] == ['0', 'EOF'], 'Deployment lock not continuously held')
    device = lines[0][6].split(':')
    require(len(device) == 3 and (int(device[0], 16), int(device[1], 16), int(device[2]))
            == (os.major(opened.st_dev), os.minor(opened.st_dev), opened.st_ino),
            'Deployment lock kernel identity differs')

def _save(path, value):
    E.save_new(path, R.encoded(value))
    return R.digest(R.encoded(value))

def approve(raw, expected_sha):
    return R.authenticate_owner_approval(raw, expected_sha)

def _match_proposal(fresh, saved):
    rows = fresh['records']
    root = fresh['fingerprint']['root']
    archived = fresh['fingerprint']['format'] == 'proofofwork-ui-retained-files-v1'
    actual = {}
    for row in rows:
        path = root if archived else str(Path(root) / row['path'])
        s = row['identity']
        actual[path] = {
            'type': 'file' if row['kind'] == 'file' else 'dir',
            'device': s['st_dev'], 'inode': s['st_ino'], 'nlink': s['st_nlink'],
            'mode': stat.S_IMODE(s['st_mode']), 'uid': s['st_uid'], 'gid': s['st_gid'],
            'size': s['st_size'], 'mtimeNs': s['st_mtime_ns'], 'ctimeNs': s['st_ctime_ns'],
            **({'sha256': row['sha256']} if row['kind'] == 'file' else {})}
    wanted = {row['path']: {k: row[k] for k in actual.get(row['path'], {})}
              for row in saved}
    require(set(actual) == {row['path'] for row in saved} and actual == wanted,
            'Fresh complete inventory differs from reviewed proposal')

def capture(index, inventory):
    require(type(index) is int and 0 <= index < len(R.PATHS), 'Unknown action')
    path = Path(R.PATHS[index])
    saved, = [tree['records'] for tree in inventory['inventories']
              if tree['root'] == str(path)]
    if path.suffix == '.tgz':
        fresh = E.inventory_file_group(path, [path.name])
    else:
        fresh = E.inventory(path)
    _match_proposal(fresh, saved)
    frozen = dict(fresh['fingerprint'], inventory=fresh['records'])
    if 'parent' in fresh:
        frozen['parent'] = fresh['parent']
    else:
        p = path.parent
        frozen['retainedParent'] = {'path': str(p), 'identity': E.identity(p.lstat()),
                                    'xattrs': E.xattrs(p)}
    # Root-local alias closure is also enforced by the established remover.
    groups = {}
    for row in fresh['records']:
        if row['kind'] == 'file':
            s = row['identity']
            groups.setdefault((s['st_dev'], s['st_ino']), []).append(row)
    require(all(len(rows) == rows[0]['identity']['st_nlink'] for rows in groups.values()),
            'Selected action has external hardlinks')
    return frozen

class Prepared:
    def __init__(self, token, index, frozen, guard, guard_sha, inventory_sha):
        require(token is TOKEN, 'Preparation token invalid')
        self.token, self.index, self.frozen = token, index, frozen
        self.guard, self.guard_sha = guard, guard_sha
        self.inventory_sha = inventory_sha

class Controller:
    """Requires a stock guard producer and already-held exclusive deployment lock.

    Guard callback performs full installed lifecycle/source/census/reference
    verification under the supplied lock and returns a durable evidence binding.
    It must be installed/source-pinned by the transition installer. No default
    callback can approve removal.
    """
    def __init__(self, deployment_fd, journal, approval_sha, guard_producer):
        lock_fence(deployment_fd)
        require(type(journal) is R.Journal and callable(guard_producer),
                'Journal/stock guard producer required')
        self.lock = deployment_fd
        self.journal = journal
        self.approval_sha = R.hash_value(approval_sha)
        self.guard_producer = guard_producer
        self.proposal = R.authenticate_proposal(
            R.read_bound(R.EVIDENCE_DIR + '/proposal.json', R.PROPOSAL_SHA),
            R.read_bound(R.EVIDENCE_DIR + '/inventory.json', R.INVENTORY_SHA),
            R.read_bound(R.EVIDENCE_DIR + '/static-restore.json', R.RESTORE_SHA))
        self.inventory = R._json(R.read_bound(R.EVIDENCE_DIR + '/inventory.json', R.INVENTORY_SHA))
        approve(R.read_bound(R.EVIDENCE_DIR + '/owner-approval.json', approval_sha), approval_sha)

    def guard(self, phase, index):
        lock_fence(self.lock)
        binding = self.guard_producer(phase, index)
        require(isinstance(binding, dict) and set(binding) == {'path', 'sha256'}
                and Path(binding['path']).parent == Path(R.EVIDENCE_DIR)
                and Path(binding['path']).name == 'guard-%s-%d.json' % (phase, index),
                'Guard binding outside exact evidence scope')
        raw = R.read_bound(binding['path'], binding['sha256'])
        guard = R._json(raw)
        require(set(guard) == {'schema', 'phase', 'actionIndex', 'retainedPair',
            'currentManifestSha256', 'previousManifestSha256',
            'protectedClosureSha256', 'sidecarsSha256', 'historicalEvidenceSha256',
            'referenceCheckSha256', 'pendingConfigSha256', 'capacityProofSha256',
            'proposalSha256', 'approvalSha256'},
            'Guard proof fields differ')
        require(guard['schema'] == 'pow-exact-retirement-stock-guard-v1'
                and guard['phase'] == phase and guard['actionIndex'] == index
                and guard['retainedPair'] == R.PAIR
                and guard['currentManifestSha256'] == CURRENT_MANIFEST_SHA
                and guard['previousManifestSha256'] == PREVIOUS_MANIFEST_SHA
                and guard['proposalSha256'] == R.PROPOSAL_SHA
                and guard['approvalSha256'] == self.approval_sha,
                'Guard proof authority differs')
        for key, value in guard.items():
            if key.endswith('Sha256'):
                R.hash_value(value)
        self.require_initial_preservation(guard)
        lock_fence(self.lock)
        return guard, binding['sha256']

    def require_initial_preservation(self, guard):
        records = self.journal.read()
        require(records and records[0]['event'] == 'prepared', 'Missing initial guard authority')
        initial = R._json(R.read_bound(R.EVIDENCE_DIR + '/guard-initial-0.json',
                                      records[0]['data']['preflightSha256']))
        fields = ('retainedPair', 'currentManifestSha256', 'previousManifestSha256',
                  'protectedClosureSha256', 'sidecarsSha256',
                  'historicalEvidenceSha256', 'pendingConfigSha256')
        require(all(initial[k] == guard[k] for k in fields),
                'Protected state differs from initial migration baseline')


    def prepare(self):
        records = self.journal.read()
        state = R.validate_chain(records)
        require(state['approvalSha256'] == self.approval_sha
                and state['status'] == 'ready' and state['nextIndex'] < len(R.PATHS),
                'Action not ready; reconcile uncertain outcome first')
        index = state['nextIndex']
        guard, sha = self.guard('before', index)
        frozen = capture(index, self.inventory)
        bound = W.journal_capacity_bound(frozen)
        require(bound <= 16*1024**2, 'Per-action journal exceeds bound')
        inventory_sha = _save(Path(R.EVIDENCE_DIR) / ('action-%d-inventory.json' % index), frozen)
        lock_fence(self.lock)
        return Prepared(TOKEN, index, frozen, guard, sha, inventory_sha)

    def perform(self, prepared, action_hook=None):
        require(type(prepared) is Prepared and prepared.token is TOKEN,
                'Exact prepared action required')
        lock_fence(self.lock)
        index, frozen = prepared.index, prepared.frozen
        state = R.validate_chain(self.journal.read())
        require(state['status'] == 'ready' and state['nextIndex'] == index,
                'Action cannot be retried')
        # Full proposal inventory recaptured before intent; exact stock identities
        # including xattrs/atime must still equal the prepared capture.
        current = capture(index, self.inventory)
        require(current == frozen, 'Prepared inventory changed')
        lock_fence(self.lock)
        admitted, admitted_sha = self.guard('admit', index)
        preserved = ('retainedPair', 'currentManifestSha256', 'previousManifestSha256',
                     'protectedClosureSha256', 'sidecarsSha256',
                     'historicalEvidenceSha256', 'pendingConfigSha256')
        require(all(admitted[k] == prepared.guard[k] for k in preserved),
                'Protected state changed before removal')
        self.journal.append('action-started', {
            'path': R.PATHS[index], 'index': index, 'freshFenceSha256': admitted_sha,
            'frozenInventorySha256': prepared.inventory_sha})
        path = Path(R.PATHS[index])
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NOATIME)
        output = Path(R.EVIDENCE_DIR) / ('action-%d-removal.jsonl' % index)
        operation = W.Journal(output, frozen)
        original = os.fstat(operation.fd)
        def per_entry(stage, value):
            lock_fence(self.lock)
            self.journal._fence()
            named, opened = output.lstat(), os.fstat(operation.fd)
            require(named.st_ino == opened.st_ino == original.st_ino
                    and named.st_dev == opened.st_dev == original.st_dev
                    and named.st_nlink == opened.st_nlink == 1
                    and named.st_uid == opened.st_uid == 0
                    and stat.S_IMODE(named.st_mode) == 0o600,
                    'Per-entry journal replaced')
            operation(stage, value)
            self.journal._fence()
        def hook(stage, value):
            lock_fence(self.lock)
            if action_hook:
                action_hook(stage, value)
            lock_fence(self.lock)
        try:
            if path.suffix == '.tgz':
                W.delete_file_group(parent, frozen, per_entry, hook)
            else:
                W.delete_tree(parent, path.name, frozen, per_entry, hook)
        finally:
            operation.close()
            os.close(parent)
        require(not os.path.lexists(path), 'Selected payload still present')
        guard, guard_sha = self.guard('after', index)
        unchanged = ('retainedPair', 'currentManifestSha256', 'previousManifestSha256',
                     'protectedClosureSha256', 'sidecarsSha256',
                     'historicalEvidenceSha256', 'pendingConfigSha256')
        require(all(guard[key] == prepared.guard[key] for key in unchanged),
                'Preserved state changed across removal')
        evidence = {'path': str(path), 'index': index, 'absent': True,
                    'perEntryJournalSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                    'guardSha256': guard_sha}
        absence_sha = _save(Path(R.EVIDENCE_DIR) / ('action-%d-absence.json' % index), evidence)
        self.journal.append('action-reconciled', {
            'path': str(path), 'index': index, 'absenceProofSha256': absence_sha,
            'preservationProofSha256': guard_sha})
        return evidence

    def reconcile_uncertain(self):
        """Only seal an already fully removed action; never continue a partial tree."""
        state = R.validate_chain(self.journal.read())
        require(state['status'] == 'uncertain', 'No uncertain action to reconcile')
        index = state['nextIndex']
        path = Path(R.PATHS[index])
        require(not os.path.lexists(path), 'Partial/intact payload requires manual review')
        records = self.journal.read()
        intent = records[-1]
        require(intent['event'] == 'action-started' and intent['data']['path'] == str(path),
                'Missing durable prior action intent')
        frozen_path = Path(R.EVIDENCE_DIR) / ('action-%d-inventory.json' % index)
        # The inventory was saved before durable high-level intent. Authenticate
        # its exact content against the pinned proposal before trusting journal.
        frozen = R._json(R.read_bound(str(frozen_path), intent['data']['frozenInventorySha256']))
        require(frozen['root'] == str(path), 'Wrong uncertain inventory')
        fresh_shape = {'fingerprint': {k: frozen[k] for k in (
            'format', 'classification', 'root', 'manifestSha256',
            'treeSha256', 'entries', 'regularBytes')}, 'records': frozen['inventory']}
        saved, = [tree['records'] for tree in self.inventory['inventories']
                  if tree['root'] == str(path)]
        _match_proposal(fresh_shape, saved)
        actions, maximum = W.journal_contract(frozen)
        output = Path(R.EVIDENCE_DIR) / ('action-%d-removal.jsonl' % index)
        info = output.lstat()
        require(output.resolve(strict=True) == output and stat.S_ISREG(info.st_mode)
                and info.st_uid == info.st_gid == 0 and info.st_nlink == 1
                and not info.st_mode & 0o077 and 0 < info.st_size <= maximum,
                'Unsafe uncertain action log')
        fd = os.open(output, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
        try:
            require(os.fstat(fd) == info, 'Action log replaced on open')
            with os.fdopen(os.dup(fd), 'rb') as stream:
                raw = stream.read(maximum + 1)
            require(os.fstat(fd) == info and output.lstat() == info
                    and len(raw) == info.st_size, 'Action log changed')
        finally:
            os.close(fd)
        rows = [R._json(line) for line in raw.splitlines()]
        seen = set()
        pending = None
        count = 0
        frozen_rows = {r['path']: r for r in frozen['inventory']}
        completed_paths = set()
        removed_links = {}
        for row in rows:
            require(set(row) == {'stage', 'action', 'atUtc'}, 'Unexpected action-log fields')
            action = row['action']
            if row['stage'] == 'intent':
                require(pending is None and action.get('path') in actions
                        and action['path'] not in seen, 'Duplicate/unpaired action intent')
                W.journal_identity(action.get('before'))
                require({k: v for k, v in action.items() if k != 'before'}
                        == actions[action['path']], 'Uncertain action scope differs')
                frozen_row = frozen_rows[action['path']]
                original = frozen_row['identity']
                observed = action['before']
                if frozen_row['kind'] == 'file':
                    key = (original['st_dev'], original['st_ino'])
                    changed = removed_links.get(key, 0)
                    require(all(observed[k] == original[k] for k in E.STAT_FIELDS
                                if k not in ('st_nlink', 'st_ctime_ns')),
                            'Uncertain file intent identity differs')
                    require(observed['st_nlink'] == original['st_nlink'] - changed
                            and (observed['st_ctime_ns'] == original['st_ctime_ns']
                                 if changed == 0 else observed['st_ctime_ns'] >= original['st_ctime_ns']),
                            'Uncertain hardlink topology differs')
                else:
                    descendants = {n for n in frozen_rows if n != action['path']
                        and (action['path'] == '.' or n.startswith(action['path'] + '/'))}
                    require(descendants <= completed_paths,
                            'Directory intent precedes child removal')
                    children = [n for n in descendants
                        if str(Path(n).parent) == action['path']]
                    direct_dirs = sum(frozen_rows[n]['kind'] == 'directory' for n in children)
                    require(all(observed[k] == original[k] for k in
                                ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_atime_ns'))
                            and observed['st_nlink'] == original['st_nlink'] - direct_dirs,
                            'Uncertain directory authority/link topology differs')
                    require(observed['st_size'] >= 0
                            and observed['st_mtime_ns'] >= original['st_mtime_ns']
                            and observed['st_ctime_ns'] >= original['st_ctime_ns'],
                            'Uncertain directory metadata regressed')
                    if not descendants:
                        require(observed == original, 'Empty directory identity differs')
                pending = action
                seen.add(action['path'])
            else:
                require(row['stage'] == 'completed' and pending is not None
                        and action == dict(pending, ordinal=count+1),
                        'Uncertain completion differs')
                completed_paths.add(pending['path'])
                original = frozen_rows[pending['path']]['identity']
                if frozen_rows[pending['path']]['kind'] == 'file':
                    key = (original['st_dev'], original['st_ino'])
                    removed_links[key] = removed_links.get(key, 0) + 1
                count += 1
                pending = None
        require(seen == set(actions) and count in (len(actions), len(actions)-1),
                'Action log does not cover every frozen entry')
        if pending is not None:
            last = '.' if frozen['format'] == 'proofofwork-ui-retained-root-v1' else path.name
            require(pending['path'] == last and count == len(actions)-1,
                    'Only final missing-root action can reconcile without completion')
        else:
            require(count == len(actions), 'Action completions incomplete')
        before = R._json(R.read_bound(
            R.EVIDENCE_DIR + '/guard-admit-%d.json' % index,
            intent['data']['freshFenceSha256']))
        guard, guard_sha = self.guard('reconcile', index)
        unchanged = ('retainedPair', 'currentManifestSha256', 'previousManifestSha256',
                     'protectedClosureSha256', 'sidecarsSha256',
                     'historicalEvidenceSha256', 'pendingConfigSha256')
        require(all(before[k] == guard[k] for k in unchanged),
                'Preserved state changed during uncertainty')
        require(not os.path.lexists(path), 'Retired payload reappeared')
        proof = {'path': str(path), 'index': index, 'absent': True,
                 'perEntryJournalSha256': R.digest(raw), 'guardSha256': guard_sha,
                 'reconciliation': 'fully-absent-with-complete-durable-action-coverage'}
        sha = _save(Path(R.EVIDENCE_DIR) / ('action-%d-reconciled-absence.json' % index), proof)
        self.journal.append('action-reconciled', {
            'path': str(path), 'index': index, 'absenceProofSha256': sha,
            'preservationProofSha256': guard_sha})
        return proof

class StockGuard:
    """Real guard producer built from the authenticated installed pending package.

    It never interprets pending state as operational health. It reuses stock
    current/prior verification, original guard census, reference checks and
    unchanged capacity admission for the narrowly authorized migration.
    """
    def __init__(self, lifecycle_module, pending_config_sha, approval_sha, deployment_fd):
        self.L = lifecycle_module
        self.pending_sha = R.hash_value(pending_config_sha)
        self.approval_sha = R.hash_value(approval_sha)
        self.fd = deployment_fd
        lock_fence(self.fd)
        config, observed_sha, package = self.L.validate_config(
            self.L.CONFIG_PATH, self.pending_sha)
        require(observed_sha == self.pending_sha, 'Pending configuration digest differs')
        binding = config.get('payloadRetirement', {})
        require(binding.get('mode') == 'pending'
                and binding.get('proposalSha256') == R.PROPOSAL_SHA
                and binding.get('policyCodeSha256') == config['package']['sha256'],
                'Reviewed pending policy is not installed')
        self.package_sha = config['package']['sha256']
        self.S = self.L.load_module('retirement_guard_storage',
            package / 'deploy/audit30/ui-storage.py')
        self.layout = self.S.Layout()
        self.S.require_execution_lock(self.fd, self.layout)
        self.proposal = R.authenticate_proposal(
            R.read_bound(R.EVIDENCE_DIR + '/proposal.json', R.PROPOSAL_SHA),
            R.read_bound(R.EVIDENCE_DIR + '/inventory.json', R.INVENTORY_SHA),
            R.read_bound(R.EVIDENCE_DIR + '/static-restore.json', R.RESTORE_SHA))
        self.inventory = R._json(R.read_bound(R.EVIDENCE_DIR + '/inventory.json', R.INVENTORY_SHA))
        self.prior_state = R._json(R.read_bound(
            R.EVIDENCE_DIR + '/prior-state.json', self.proposal['stateSha256']))
        require(self.prior_state['status'] == 'complete'
                and self.prior_state['pending'] is None and self.prior_state['activePhase'] is None
                and self.prior_state['lastCompleted']['retainedPair'] == R.PAIR,
                'Prior lifecycle was not complete')
        approve(R.read_bound(R.EVIDENCE_DIR + '/owner-approval.json', self.approval_sha),
                self.approval_sha)

    def inspect(self, phase, index):
        require(phase in ('initial', 'before', 'admit', 'after', 'reconcile', 'final', 'resume-final')
                and type(index) is int and 0 <= index <= len(R.PATHS),
                'Unknown stock guard phase')
        lock_fence(self.fd)
        self.S.require_execution_lock(self.fd, self.layout)
        R.read_bound(str(self.L.CONFIG_PATH), self.pending_sha)
        R.read_bound(str(self.L.STATE_PATH), self.proposal['stateSha256'])
        # No credit for prospective deletion; exact installed floors and pools.
        self.S.capacity(self.layout, 'audit30-retirement-evidence',
                        additional_bytes=64*1024**2, retirement=True)
        archive_cache = {}
        pair = self.S.protected_pair(self.layout, archive_cache)
        ids = {key: pair[key]['fields']['release_id'] for key in ('current', 'previous')}
        require(ids == R.PAIR, 'Current or immediate previous release changed')
        R.read_bound(str(self.layout.live / '.proofofwork-ui-release'), CURRENT_MANIFEST_SHA, 65536)
        previous_root = Path(pair['previous']['path'])
        R.read_bound(str(previous_root / '.proofofwork-ui-release'), PREVIOUS_MANIFEST_SHA, 65536)
        guards, unused = self.S.safeguards(self.layout, model=self.S.ROTATING_LOG_GUARD_MODEL)
        require(guards == self.prior_state['completedContext']['guards'],
                'Original protected guard census changed')
        protected = {'pair': R.PAIR.copy(),
                     'manifests': {'current': CURRENT_MANIFEST_SHA,
                                   'previous': PREVIOUS_MANIFEST_SHA}, 'guards': guards}
        require(protected == self.prior_state['completedContext'],
                'Original completed context changed')
        pair_raw, archive_raw = R.encoded(pair), R.encoded(archive_cache)
        require(len(pair_raw) <= 16*1024**2 and len(archive_raw) <= 16*1024**2,
                'Protected proof metadata exceeds bounded evidence size')
        protected = {'completedContext': protected,
                     'fullProtectedPairSha256': R.digest(pair_raw),
                     'fullArchiveProofsSha256': R.digest(archive_raw),
                     'fullProtectedPairEvidence': {
                         'path': R.EVIDENCE_DIR + '/initial-protected-pair.json',
                         'sha256': R.digest(pair_raw)},
                     'fullArchiveProofsEvidence': {
                         'path': R.EVIDENCE_DIR + '/initial-archive-proofs.json',
                         'sha256': R.digest(archive_raw)}}
        if phase != 'initial':
            R.read_bound(protected['fullProtectedPairEvidence']['path'], R.digest(pair_raw))
            R.read_bound(protected['fullArchiveProofsEvidence']['path'], R.digest(archive_raw))

        sides = []
        for row in self.proposal['sidecarsKeep']:
            R.read_bound(row['path'], row['sha256'], 65536)
            sides.append({'path': row['path'], 'sha256': row['sha256']})
        R.verify_historical_equivalents(self.layout, self.inventory)
        history = {'proposalSha256': R.PROPOSAL_SHA, 'inventorySha256': R.INVENTORY_SHA,
                   'verifiedLiveRoot': str(self.layout.live),
                   'historicalEquivalentEntries': len(self.inventory['historicalEquivalentCopies'])}
        references = W.check_references(R.PATHS)
        resources = self.S.resources(self.layout)
        require(resources['availableRootBytes'] >= 8*1024**3 + 64*1024**2,
                'Root free-space reserve is below unchanged floor')
        require(resources['scratchHeadroomBytes'] >= 0,
                'Scratch pool is over unchanged bound')
        documents = {'protected': protected, 'sidecars': sides, 'historical': history,
                     'references': references, 'capacity': resources}
        resources['retirementEvidenceReservationBytes'] = 64*1024**2
        if phase == 'initial':
            # Exact selected-tree journal envelopes plus preserved proof metadata,
            # with bounded margin for all guards/config/terminal receipts.
            projected = len(pair_raw) + len(archive_raw) + 8*1024**2
            for candidate in range(len(R.PATHS)):
                frozen = capture(candidate, self.inventory)
                projected += W.journal_capacity_bound(frozen) + len(R.encoded(frozen))
            require(projected <= 64*1024**2, 'Evidence plan exceeds stock-admitted reservation')
            documents['_initial-protected-pair'] = pair
            documents['_initial-archive-proofs'] = archive_cache
            documents['_initial-proof-budget'] = {
                'projectedUpperBytes': projected, 'stockAdmittedBytes': 64*1024**2}
        result = {
            'schema': 'pow-exact-retirement-stock-guard-v1', 'phase': phase,
            'actionIndex': index, 'retainedPair': R.PAIR.copy(),
            'currentManifestSha256': CURRENT_MANIFEST_SHA,
            'previousManifestSha256': PREVIOUS_MANIFEST_SHA,
            'protectedClosureSha256': R.digest(R.encoded(protected)),
            'sidecarsSha256': R.digest(R.encoded(sides)),
            'historicalEvidenceSha256': R.digest(R.encoded(history)),
            'referenceCheckSha256': R.digest(R.encoded(references)),
            'pendingConfigSha256': self.pending_sha,
            'capacityProofSha256': R.digest(R.encoded(resources)),
            'proposalSha256': R.PROPOSAL_SHA, 'approvalSha256': self.approval_sha}
        self.S.require_execution_lock(self.fd, self.layout)
        lock_fence(self.fd)
        return result, documents

    def __call__(self, phase, index):
        result, documents = self.inspect(phase, index)
        prefix = 'guard-%s-%d' % (phase, index)
        for suffix, value in documents.items():
            name = suffix[1:] if suffix.startswith('_initial-') else prefix + '-' + suffix
            _save(Path(R.EVIDENCE_DIR) / (name + '.json'), value)
        path = Path(R.EVIDENCE_DIR) / (prefix + '.json')
        return {'path': str(path), 'sha256': _save(path, result)}


def open_pending_controller(lifecycle_module, pending_config_sha, approval_sha, deployment_fd):
    """Create or reopen the exact journal; does not perform any removal."""
    lock_fence(deployment_fd)
    producer = StockGuard(lifecycle_module, pending_config_sha, approval_sha, deployment_fd)
    directory = Path(R.EVIDENCE_DIR) / 'journal'
    if not os.path.lexists(directory):
        os.mkdir(directory, 0o700)
        W.sync_directory(directory.parent)
    journal = R.Journal(directory)
    try:
        controller = Controller(deployment_fd, journal, approval_sha, producer)
        records = journal.read()
        if not records:
            binding = producer('initial', 0)
            journal.append('prepared', {
                'proposalSha256': R.PROPOSAL_SHA, 'inventorySha256': R.INVENTORY_SHA,
                'restoreSha256': R.RESTORE_SHA, 'approvalSha256': approval_sha,
                'preflightSha256': binding['sha256'], 'pair': R.PAIR.copy()})
        else:
            state = R.validate_chain(records)
            require(state['approvalSha256'] == approval_sha, 'Reopened approval differs')
        return controller
    except BaseException:
        journal.close()
        raise

def complete_terminal(controller):
    """Seal exact successful removal. Reopening a completed journal is read-only
    except creating a missing identical terminal record after a known crash.
    Partial final-evidence creation stops; no file is overwritten or inferred.
    """
    require(type(controller) is Controller, 'Exact controller required')
    lock_fence(controller.lock)
    state = R.validate_chain(controller.journal.read())
    require(state['approvalSha256'] == controller.approval_sha,
            'Final approval differs')
    if state['status'] == 'ready' and state['nextIndex'] == len(R.PATHS):
        require(not any(os.path.lexists(p) for p in R.PATHS), 'Retired payload reappeared')
        guard, guard_sha = controller.guard('final', len(R.PATHS))
        copies = {
            'final-fence.json': ('guard-final-4.json', guard_sha),
            'retained-pair-proof.json': ('guard-final-4-protected.json', guard['protectedClosureSha256']),
            'sidecars-proof.json': ('guard-final-4-sidecars.json', guard['sidecarsSha256']),
            'historical-evidence-proof.json': ('guard-final-4-historical.json', guard['historicalEvidenceSha256'])}
        hashes = {}
        for target, (source, sha) in copies.items():
            raw = R.read_bound(R.EVIDENCE_DIR + '/' + source, sha)
            E.save_new(Path(R.EVIDENCE_DIR) / target, raw)
            hashes[target] = sha
        controller.journal.append('completed', {
            'finalFenceSha256': hashes['final-fence.json'],
            'retainedPairProofSha256': hashes['retained-pair-proof.json'],
            'sidecarsProofSha256': hashes['sidecars-proof.json'],
            'historicalEvidenceProofSha256': hashes['historical-evidence-proof.json'],
            'successorPolicyCodeSha256': controller.guard_producer.package_sha})
    records = controller.journal.read()
    state = R.validate_chain(records)
    require(state['status'] == 'complete', 'Incomplete/uncertain retirement cannot be sealed')
    # These checks also apply when recovering a crash after journal completion.
    lock_fence(controller.lock)
    fresh_guard, unused = controller.guard_producer.inspect('resume-final', len(R.PATHS))
    controller.require_initial_preservation(fresh_guard)

    require(not any(os.path.lexists(p) for p in R.PATHS), 'Retired payload reappeared')
    final = records[-1]['data']
    for key, name in (('finalFenceSha256', 'final-fence.json'),
                      ('retainedPairProofSha256', 'retained-pair-proof.json'),
                      ('sidecarsProofSha256', 'sidecars-proof.json'),
                      ('historicalEvidenceProofSha256', 'historical-evidence-proof.json')):
        R.read_bound(R.EVIDENCE_DIR + '/' + name, final[key])
    for row in controller.proposal['sidecarsKeep']:
        R.read_bound(row['path'], row['sha256'], 65536)
    R.verify_historical_equivalents(controller.guard_producer.layout, controller.inventory)
    pair = controller.guard_producer.S.protected_pair(controller.guard_producer.layout, {})
    require({k: pair[k]['fields']['release_id'] for k in ('current', 'previous')} == R.PAIR,
            'Retained pair changed before terminal seal')
    require(final['successorPolicyCodeSha256'] == controller.guard_producer.package_sha,
            'Pending protected package changed')
    receipt = {
        'schema': 'pow-exact-payload-retirement-completed-v1',
        'proposalSha256': R.PROPOSAL_SHA, 'inventorySha256': R.INVENTORY_SHA,
        'restoreSha256': R.RESTORE_SHA, 'approvalSha256': controller.approval_sha,
        'journal': records, 'journalHeadSha256': state['lastSha256'],
        'retiredPayloadPaths': list(R.PATHS), 'retirementRetainedPair': R.PAIR.copy(),
        'sourceIndex': R.SOURCE_INDEX.copy(),
        'preservedSidecars': [{'path': x['path'], 'sha256': x['sha256']}
                             for x in controller.proposal['sidecarsKeep']],
        'preservedHistoricalEvidenceSha256': final['historicalEvidenceProofSha256'],
        'priorConfigSha256': R.PRIOR_CONFIG_SHA,
        'policyCodeSha256': controller.guard_producer.package_sha}
    raw = R.encoded(receipt)
    if os.path.lexists(R.TERMINAL_PATH):
        require(R.read_bound(R.TERMINAL_PATH, R.digest(raw)) == raw,
                'Existing terminal evidence differs')
    else:
        E.save_new(Path(R.TERMINAL_PATH), raw)
    return {'path': R.TERMINAL_PATH, 'sha256': R.digest(raw)}

def parse_operator_arguments(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description='Exact owner-approved four-payload retirement operator')
    parser.add_argument('step', choices=('prepare', 'activate-pending', 'remove-next',
        'reconcile-next', 'seal-terminal', 'install-terminal', 'status'))
    parser.add_argument('--package-sha', required=True)
    parser.add_argument('--config-sha', required=True)
    parser.add_argument('--approval-sha', required=True)
    parser.add_argument('--intent-sha')
    parser.add_argument('--terminal-sha')
    parser.add_argument('--resume', action='store_true')
    value = parser.parse_args(argv)
    for name in ('package_sha', 'config_sha', 'approval_sha'):
        R.hash_value(getattr(value, name))
    for name in ('intent_sha', 'terminal_sha'):
        if getattr(value, name) is not None:
            R.hash_value(getattr(value, name))
    require(not value.resume or value.step in ('activate-pending', 'install-terminal'),
            'Resume applies only to exact interrupted config/state installation')
    require(value.step not in ('activate-pending', 'install-terminal') or value.intent_sha,
            'Expected transition intent digest required')
    require(value.step != 'install-terminal' or value.terminal_sha,
            'Expected terminal receipt digest required')
    return value

def verified_operator_package(package_sha):
    """Validate all protected package bytes before loading any new entrypoint."""
    package = Path(__file__).resolve().parents[2]
    require(package.parent == Path(R.BASE + '/cleanup-evidence')
            and package.name == 'ui-lifecycle-tools-' + package_sha,
            'Operator must run from exact installed protected package')
    manifest = R._json(R.read_bound(str(package / 'package.json'), package_sha))
    require(manifest.get('schema') == 'pow-ui-retention-package-v1'
            and isinstance(manifest.get('files'), dict) and 0 < len(manifest['files']) <= 64,
            'Invalid operator package manifest')
    for name, pin in manifest['files'].items():
        relative = Path(name)
        require(not relative.is_absolute() and str(relative) == name
                and all(part not in ('', '.', '..') for part in relative.parts)
                and relative.parts[0] in ('deploy', 'audits')
                and set(pin) == {'bytes', 'sha256'} and type(pin['bytes']) is int,
                'Unsafe package member')
        raw = R.read_bound(str(package / relative), pin['sha256'])
        require(len(raw) == pin['bytes'], 'Package member length differs')
    own = 'deploy/ui-retention/retirement_controller.py'
    require(own in manifest['files']
            and R.digest(R.read_raw_bound(str(Path(__file__).resolve())))
                == manifest['files'][own]['sha256'], 'Operator code not package-bound')
    require('deploy/ui-retention/lifecycle_remote.py' in manifest['files'],
            'Lifecycle entrypoint absent from verified package')
    spec = importlib.util.spec_from_file_location('verified_retirement_lifecycle',
        package / 'deploy/ui-retention/lifecycle_remote.py')
    lifecycle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lifecycle)
    require(set(manifest['files']) == set(lifecycle.PACKAGE_FILES),
            'Protected package scope differs')
    return package, lifecycle

def operator_main(argv=None):
    """Explicit one-step entrypoint. Never loop/retry or weaken a failed guard."""
    import subprocess
    import sys
    require(os.getuid() == os.geteuid() == os.getgid() == os.getegid() == 0
            and sys.flags.isolated and not sys.flags.optimize,
            'Operator requires root python3 -I without optimization')
    args = parse_operator_arguments(argv)
    addresses = json.loads(subprocess.check_output(
        ['/usr/sbin/ip', '-j', '-4', 'address', 'show'], timeout=10,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}))
    require(any(a.get('local') == '77.42.91.106' for interface in addresses
                for a in interface.get('addr_info', [])), 'Wrong production host')
    package, lifecycle = verified_operator_package(args.package_sha)
    storage = lifecycle.load_module('retirement_operator_storage',
        package / 'deploy/audit30/ui-storage.py')
    transition_module = lifecycle.load_module('retirement_operator_transition',
        package / 'deploy/ui-retention/retirement_transition.py')
    layout = storage.Layout()
    lock = storage.lock(layout)
    controller = None
    try:
        storage.require_execution_lock(lock, layout)
        R.read_bound(str(lifecycle.CONFIG_PATH), args.config_sha)
        approve(R.read_bound(R.EVIDENCE_DIR + '/owner-approval.json', args.approval_sha),
                args.approval_sha)
        transition = transition_module.Transition(storage, lifecycle, lock,
                                                  intent_sha=args.intent_sha)
        if args.step == 'prepare':
            result = transition.prepare_pending({'path': str(package), 'sha256': args.package_sha})
        elif args.step == 'activate-pending':
            transition.install_pending(resume=args.resume)
            result = transition.positions()
        elif args.step in ('remove-next', 'reconcile-next', 'seal-terminal'):
            controller = open_pending_controller(lifecycle, args.config_sha,
                                                 args.approval_sha, lock)
            if args.step == 'remove-next':
                result = controller.perform(controller.prepare())
            elif args.step == 'reconcile-next':
                result = controller.reconcile_uncertain()
            else:
                result = complete_terminal(controller)
        elif args.step == 'install-terminal':
            config = R._json(R.read_bound(str(lifecycle.CONFIG_PATH), args.config_sha))
            binding = dict(config['payloadRetirement'], mode='complete',
                           receipt={'path': R.TERMINAL_PATH, 'sha256': args.terminal_sha})
            context = transition.R.load_verified_retirement(binding, layout,
                lambda checked: storage.protected_pair(checked, {}))
            if not args.resume:
                transition.prepare_terminal(context)
            result = transition.install_terminal(context, resume=args.resume)
            installed = lifecycle.installed_runtime(lifecycle.CONFIG_PATH, result['configSha256'])
            installed.lock_fd = lock
            try:
                status = installed.status({'requireComplete': True})
            finally:
                installed.lock_fd = None
            require(status['pair'] == R.PAIR
                    and status['verifiedRetiredPayloads']['retiredPayloadPaths'] == list(R.PATHS),
                    'Installed successor did not verify exact retirement')
            result = dict(result, verifiedStatus=status)
        else:
            installed = lifecycle.installed_runtime(lifecycle.CONFIG_PATH, args.config_sha)
            installed.lock_fd = lock
            try:
                result = installed.status({'requireComplete': True})
            finally:
                installed.lock_fd = None
        storage.require_execution_lock(lock, layout)
        print(json.dumps(result, sort_keys=True))
        return result
    finally:
        if controller is not None:
            controller.journal.close()
        os.close(lock)

if __name__ == '__main__':
    operator_main()
