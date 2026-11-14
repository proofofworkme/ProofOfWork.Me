#!/usr/bin/env python3
"""Exact older-payload retirement journal. NOT a production deletion adapter.

Only four pinned payloads are representable. This module never unlinks payloads,
changes policy, executes commands, or treats absence as authorization. Deployment
must separately authenticate approval, lock/revalidate full census/link closure,
preserve sidecars and audit evidence, and install the successor policy verifier.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat

PROPOSAL_SHA = '6fd05dc1e04e6fbcab293683c5a0d10d184ff0bd83039a66d7f2c7ec53161004'
INVENTORY_SHA = 'dcf09bd3ec9453230ece39ce67ccf9f39716388ad26bc609ad09d1fe5c308107'
RESTORE_SHA = 'd83a52bef8bb3bca179e970a41d2300a9b7e1f688e53ac27342e2a8273766278'
PAIR = {'current': '064b6991ae2a-20261114T020148Z',
        'previous': 'e2669bc1fd32-20261112T163804Z'}
BASE = '/var/backups/proofofwork-ui'
PATHS = (
    BASE + '/releases/proofofwork-ui-release-1042efea2aa1-20261112T074918Z.tgz',
    BASE + '/rollback-roots/proofofwork-www-pre-e2669bc1fd32-20261112T163804Z',
    BASE + '/releases/proofofwork-ui-release-c3969c39c2b2-20261101T051206Z.tgz',
    BASE + '/rollback-roots/proofofwork-www-pre-54088ca155bc-20261103T032112Z',
)
SHA = re.compile(r'[0-9a-f]{64}\Z')
MAX_RECORD = 256 * 1024

def require(condition, message):
    if not condition:
        raise ValueError(message)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

def hash_value(value):
    require(isinstance(value, str) and SHA.fullmatch(value), 'Invalid evidence digest')
    return value

def authenticate_proposal(proposal, inventory, restore):
    """Bind exact reviewed bytes, including restore limitations, not loose fields."""
    require(digest(proposal) == PROPOSAL_SHA, 'Proposal bytes differ')
    require(digest(inventory) == INVENTORY_SHA, 'Inventory bytes differ')
    require(digest(restore) == RESTORE_SHA, 'Restore receipt bytes differ')
    p, i, r = (json.loads(raw) for raw in (proposal, inventory, restore))
    require(p['status'] == 'PROPOSAL_ONLY_NOT_AUTHORIZED_FOR_EXECUTION', 'Wrong proposal')
    require(tuple(x['path'] for x in p['selected']) == PATHS, 'Removal scope differs')
    require(p['pair'] == i['pair'] == PAIR, 'Retained pair differs')
    require(p['inventorySha256'] == INVENTORY_SHA, 'Inventory binding differs')
    require(p['rehearsalReceipt']['sha256'] == RESTORE_SHA, 'Restore binding differs')
    require(p['allHistoricalEntriesHaveRetainedEquivalent']
            and i['allHistoricalEntriesHaveRetainedEquivalent']
            and p['historicalUnequalCount'] == 0, 'Historical evidence is not preserved')
    require(r['uiInventoryBeforeAfterEqual'] and r['staticReferencePass']
            and r['restoredEntries'] == 2839
            and r['scope'].startswith('isolated static archive restoration; NOT production'),
            'Static recovery evidence differs')
    return p

def validate_chain(records):
    """Pure fail-closed state machine; an intent without a result is unresolved."""
    require(isinstance(records, list) and records, 'Missing journal')
    previous = None
    state = 'new'
    index = 0
    approval = None
    for sequence, record in enumerate(records):
        require(set(record) == {'sequence', 'previousSha256', 'event', 'data'},
                'Unexpected journal fields')
        require(type(record['sequence']) is int and record['sequence'] == sequence
                and record['previousSha256'] == previous, 'Journal chain differs')
        event, data = record['event'], record['data']
        if state == 'new':
            require(event == 'prepared' and set(data) == {
                'proposalSha256', 'inventorySha256', 'restoreSha256', 'approvalSha256',
                'preflightSha256', 'pair'}, 'Missing exact preparation')
            require(data['proposalSha256'] == PROPOSAL_SHA
                    and data['inventorySha256'] == INVENTORY_SHA
                    and data['restoreSha256'] == RESTORE_SHA
                    and data['pair'] == PAIR, 'Preparation authority differs')
            approval = hash_value(data['approvalSha256'])
            hash_value(data['preflightSha256'])
            state = 'ready'
        elif state == 'ready' and index < len(PATHS):
            require(event == 'action-started' and set(data) == {
                'path', 'index', 'freshFenceSha256', 'frozenInventorySha256'}, 'Missing action intent')
            require(type(data['index']) is int and data['index'] == index
                    and data['path'] == PATHS[index], 'Action scope/order differs')
            hash_value(data['freshFenceSha256'])
            hash_value(data['frozenInventorySha256'])
            state = 'uncertain'
        elif state == 'uncertain':
            require(event == 'action-reconciled' and set(data) == {
                'path', 'index', 'absenceProofSha256', 'preservationProofSha256'},
                'Uncertain action must reconcile; never retry automatically')
            require(type(data['index']) is int and data['index'] == index
                    and data['path'] == PATHS[index], 'Reconciliation scope differs')
            hash_value(data['absenceProofSha256'])
            hash_value(data['preservationProofSha256'])
            index += 1
            state = 'ready'
        elif state == 'ready' and index == len(PATHS):
            require(event == 'completed' and set(data) == {
                'finalFenceSha256', 'retainedPairProofSha256', 'sidecarsProofSha256',
                'historicalEvidenceProofSha256', 'successorPolicyCodeSha256'},
                'Missing final retained/evidence verification')
            for value in data.values():
                hash_value(value)
            state = 'complete'
        else:
            raise ValueError('Journal already completed')
        previous = digest(encoded(record))
    return {'status': state, 'nextIndex': index, 'lastSha256': previous,
            'approvalSha256': approval}

class Journal:
    """Append-only evidence store under a caller-created private directory.

    No production policy changes or deletion are exposed. Each action intent is
    durable before the external adapter may act. After uncertain outcome only
    independently authenticated reconciliation may append the result.
    """
    def __init__(self, directory):
        self.path = Path(directory)
        info = self.path.lstat()
        require(self.path.resolve(strict=True) == self.path
                and stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                and not info.st_mode & 0o077, 'Unsafe journal directory')
        self.fd = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.identity = (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode)
        try:
            self._fence()
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._fence()
        except BaseException:
            os.close(self.fd)
            raise

    def _fence(self):
        require(self.fd is not None and self.path.resolve(strict=True) == self.path,
                'Journal path no longer canonical')
        for info in (self.path.lstat(), os.fstat(self.fd)):
            require((info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode)
                    == self.identity, 'Journal directory identity changed')

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.close()

    def read(self):
        self._fence()
        names = sorted(os.listdir(self.fd))
        require(names == ['%04d.json' % i for i in range(len(names))],
                'Unknown/gapped journal entries')
        records = []
        for name in names:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME, dir_fd=self.fd)
            try:
                info = os.fstat(fd)
                require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                        and info.st_nlink == 1 and not info.st_mode & 0o077
                        and 0 < info.st_size <= MAX_RECORD, 'Unsafe journal record')
                with os.fdopen(os.dup(fd), 'rb') as stream:
                    raw = stream.read(MAX_RECORD + 1)
                require(len(raw) == info.st_size and os.fstat(fd) == info,
                        'Journal record changed')
            finally:
                os.close(fd)
            record = json.loads(raw)
            require(encoded(record) == raw, 'Noncanonical journal record')
            records.append(record)
        if records:
            validate_chain(records)
        self._fence()
        return records

    def append(self, event, data):
        prior = self.read()
        record = {'sequence': len(prior),
                  'previousSha256': digest(encoded(prior[-1])) if prior else None,
                  'event': event, 'data': data}
        validate_chain([*prior, record])
        raw = encoded(record)
        require(len(raw) <= MAX_RECORD, 'Oversized journal record')
        name = '%04d.json' % len(prior)
        self._fence()
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=self.fd)
        try:
            with os.fdopen(os.dup(fd), 'wb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            os.close(fd)
        os.fsync(self.fd)
        self._fence()
        require(self.read() == [*prior, record], 'Durable journal verification failed')
        return digest(raw)

def verify_retired_payload_receipt(records, expected_head, expected_approval,
                                   verify_evidence):
    """Future policy adapter must pin head/approval in trusted successor config.

    verify_evidence must independently authenticate EVERY evidence hash against
    retained artifacts and fresh filesystem state. No default accepts hashes or
    absence. This function does not infer authorization from a proposal.
    """
    hash_value(expected_head)
    hash_value(expected_approval)
    result = validate_chain(records)
    require(result['status'] == 'complete' and result['lastSha256'] == expected_head
            and result['approvalSha256'] == expected_approval,
            'Untrusted/incomplete retirement receipt')
    require(callable(verify_evidence), 'Independent evidence verifier required')
    require(verify_evidence(records) is True, 'Retirement evidence verification failed')
    return {'model': 'intentionally-retired-payloads-retained-evidence-v1',
            'proposalSha256': PROPOSAL_SHA, 'receiptSha256': expected_head,
            'retiredPayloadPaths': list(PATHS), 'verifiedRetainedPair': PAIR.copy(),
            'recoveryVerification': 'isolated-static-only'}

# Successor reader contract. The production installer owns the config trust root.
# Configuration references this exact fixed terminal location, never an arbitrary
# URL/path supplied by application clients.
EVIDENCE_DIR = BASE + '/cleanup-evidence/older-backup-retirement-6fd05dc1e04e'
TERMINAL_PATH = EVIDENCE_DIR + '/completed.json'
SOURCE_INDEX = {'path': BASE + '/cleanup-evidence/audit30-policy-admission-index-ordinary-064b6991ae2a-20261114T020148Z.json',
                'sha256': '5a7b025d95cd55a2b40f2a69b0189b74d75484ff237bac327f920a6b2a231c54'}
PRIOR_CONFIG_SHA = '58660f364d39f2cd0a5b94e2cb8e33b496e7686e2473c622dc9ec6e268f42798'
TOKEN = object()

def _json(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            require(key not in out, 'Duplicate JSON key')
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs)

def read_raw_bound(path, limit=16*1024**2):
    """Canonical, root-owned non-writable evidence; stable descriptor and path."""
    p = Path(path)
    require(p.is_absolute() and p.resolve(strict=True) == p, 'Unsafe evidence path')
    for parent in (p.parent, *p.parents):
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and s.st_uid == 0
                and not s.st_mode & 0o022, 'Unsafe evidence ancestor')
    before = p.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
            and before.st_nlink == 1 and not before.st_mode & 0o022
            and 0 < before.st_size <= limit, 'Unsafe evidence metadata')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    try:
        require(os.fstat(fd) == before, 'Evidence changed on open')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read(limit + 1)
        require(os.fstat(fd) == before and p.lstat() == before
                and len(raw) == before.st_size, 'Evidence changed during read')
    finally:
        os.close(fd)
    return raw

def read_bound(path, expected, limit=16*1024**2):
    raw = read_raw_bound(path, limit)
    require(digest(raw) == hash_value(expected), 'Evidence bytes differ')
    return raw

def require_verified_retirement(value):
    require(type(value) is VerifiedRetirement and value._token is TOKEN,
            'Authenticated retirement context required')
    return value

class VerifiedRetirement:
    """Authenticated terminal proof, not an optional-holds flag.

    Fresh protected pair verification is delegated to the already installed
    stock verifier. Historical admission parsing remains in the stock policy.
    """
    def __init__(self, token, binding, receipt, proposal, inventory, source,
                 layout, independent_snapshot_verifier):
        require(token is TOKEN, 'Retirement context cannot be constructed externally')
        self._token = token
        self._binding = _json(encoded(binding))
        self._receipt = _json(encoded(receipt))
        self._proposal = proposal
        self._inventory = inventory
        self._source = source
        self._layout = layout
        self._verify_pair = independent_snapshot_verifier
        self._authorized_pair = PAIR.copy()
        self._verified_pair = None

    @property
    def source_index(self):
        return SOURCE_INDEX.copy()

    @property
    def source_admissions(self):
        return _json(encoded(self._source['admissions']))

    @property
    def source_retirements(self):
        return _json(encoded(self._source.get('completedRetirements', [])))

    @property
    def source_pair(self):
        return PAIR.copy()

    def is_retired(self, path):
        return str(path) in PATHS

    def verify_lineage(self, index, admissions):
        require(index.get('admissions', [])[:len(self.source_admissions)]
                == self.source_admissions, 'Retirement source admission prefix changed')
        require(index.get('completedRetirements', [])[:len(self.source_retirements)]
                == self.source_retirements, 'Historical retirement prefix changed')
        require(len(admissions) == len(index['admissions'])
                and admissions[len(self.source_admissions)-1]['retainedPair'] == PAIR,
                'Retirement source pair changed')
        pair = PAIR.copy()
        for admission in admissions[len(self.source_admissions):]:
            next_pair = admission['retainedPair']
            require(next_pair['previous'] == pair['current']
                    and next_pair['current'] not in pair.values(),
                    'Retirement descendant lineage broken')
            pair = dict(next_pair)
        self._authorized_pair = pair
        self._verified_pair = None

    def _historical(self):
        verify_historical_equivalents(self._layout, self._inventory)

    def verify_payloads(self, layout):
        require(str(layout.live) == '/var/www'
                and str(layout.evidence) == BASE + '/cleanup-evidence',
                'Retirement layout differs')
        require(read_bound(TERMINAL_PATH, self._binding['receipt']['sha256'])
                == encoded(self._receipt), 'Terminal receipt representation changed')
        for path in PATHS:
            require(not os.path.lexists(path), 'Retired payload reappeared')
        for row in self._proposal['sidecarsKeep']:
            read_bound(row['path'], row['sha256'], 65536)
        self._historical()

    def verify_scope(self, layout, pair=None):
        self.verify_payloads(layout)
        require(callable(self._verify_pair), 'Stock pair verifier required')
        fresh = self._verify_pair(layout)
        if pair is not None:
            require(pair == fresh, 'Protected pair changed during verification')
        identities = {key: fresh[key]['fields']['release_id']
                      for key in ('current', 'previous')}
        require(identities == self._authorized_pair, 'Fresh pair lacks descendant admission')
        self._verified_pair = identities
        return self.proof

    @property
    def proof(self):
        return {'model': 'intentionally-retired-payloads-retained-evidence-v1',
                'proposalSha256': PROPOSAL_SHA,
                'receipt': dict(self._binding['receipt']),
                'receiptSha256': self._binding['receipt']['sha256'],
                'journalHeadSha256': self._receipt['journalHeadSha256'],
                'policyCodeSha256': self._binding['policyCodeSha256'],
                'retiredPayloadPaths': list(PATHS),
                'retirementRetainedPair': PAIR.copy(),
                'sourceIndex': SOURCE_INDEX.copy(),
                'recoveryVerification': 'isolated-static-only'}

    def verify_lifecycle_state(self, state, config_sha):
        """Authenticate the append-only transition; never rewrite old upgrade proof."""
        binding = state.get('lastPayloadRetirement')
        expected_path = EVIDENCE_DIR + '/transition-completed.json'
        require(isinstance(binding, dict) and set(binding) == {'path', 'sha256'}
                and binding['path'] == expected_path, 'Missing lifecycle retirement transition')
        transition = _json(read_bound(expected_path, binding['sha256']))
        require(set(transition) == {'schema', 'priorState', 'priorConfig',
            'successorConfigSha256', 'terminalReceipt', 'successorIndex',
            'statePatch', 'preservedLastUpgrade'},
            'Lifecycle retirement transition fields differ')
        require(transition['schema'] == 'pow-exact-payload-retirement-state-transition-v1'
                and transition['terminalReceipt'] == self._binding['receipt']
                and transition['successorConfigSha256'] == config_sha,
                'Lifecycle retirement transition authority differs')
        require(transition['priorState'] == {
            'path': EVIDENCE_DIR + '/prior-state.json',
            'sha256': self._proposal['stateSha256']}
            and transition['priorConfig'] == {
            'path': EVIDENCE_DIR + '/prior-config.json', 'sha256': PRIOR_CONFIG_SHA},
            'Prior lifecycle evidence differs')
        prior = _json(read_bound(transition['priorState']['path'],
                                 transition['priorState']['sha256']))
        read_bound(transition['priorConfig']['path'], PRIOR_CONFIG_SHA)
        patch = transition['statePatch']
        require(set(patch) == {'configSha256', 'index', 'revision',
            'lastUpgrade', 'completedContext'}, 'Expanded lifecycle state patch')
        require(patch['configSha256'] == config_sha and patch['lastUpgrade'] == {}
                and patch['index'] == transition['successorIndex']
                and type(patch['revision']) is int and patch['revision'] == prior['revision'] + 2
                and patch['completedContext'] == prior['completedContext']
                and transition['preservedLastUpgrade'] == prior.get('lastUpgrade', {}),
                'Lifecycle state patch changed historical authority')
        target = patch['index']
        require(set(target) == {'path', 'sha256'} and target['path'] ==
            BASE + '/cleanup-evidence/audit30-policy-admission-index-payload-retirement-6fd05dc1e04e.json',
            'Initial successor index path differs')
        initial_index = _json(read_bound(target['path'], target['sha256']))
        require(initial_index.get('payloadRetirement') == self.proof
                and initial_index['admissions'] == self.source_admissions
                and initial_index.get('completedRetirements', []) == self.source_retirements,
                'Initial successor index changed historical admissions')
        expected = dict(prior, **patch, lastPayloadRetirement=dict(binding))
        if state.get('revision') == patch['revision']:
            require(state == expected, 'Initial successor state differs from exact patch')
        else:
            require(type(state.get('revision')) is int and state['revision'] > patch['revision']
                    and state.get('lastPayloadRetirement') == binding,
                    'Lifecycle state regressed or lost transition')
            # Existing runtime validation authenticates later intents/upgrades and
            # state evolution; policy_scope authenticates every descendant index.
            current_index = state.get('index')
            require(isinstance(current_index, dict)
                    and Path(current_index.get('path', '')).parent == Path(BASE + '/cleanup-evidence'),
                    'Descendant lifecycle index outside authority')
            raw = _json(read_bound(current_index['path'], current_index['sha256']))
            require(raw.get('payloadRetirement') == self.proof
                    and raw.get('admissions', [])[:len(self.source_admissions)]
                    == self.source_admissions
                    and raw.get('completedRetirements', [])[:len(self.source_retirements)]
                    == self.source_retirements, 'Descendant lifecycle lineage lost')

    @property
    def verified_current_pair(self):
        require(self._verified_pair is not None, 'Fresh retirement scope not verified')
        return dict(self._verified_pair)

def load_verified_retirement(binding, layout, independent_snapshot_verifier):
    if binding is None:
        return None
    require(isinstance(binding, dict) and binding.get('mode') == 'complete',
            'Retirement pending/incomplete; publication blocked')
    require(set(binding) == {'mode', 'proposalSha256', 'receipt', 'priorConfigSha256',
                             'sourceIndex', 'policyCodeSha256'},
            'Retirement binding fields differ')
    require(binding['proposalSha256'] == PROPOSAL_SHA
            and binding['priorConfigSha256'] == PRIOR_CONFIG_SHA
            and binding['sourceIndex'] == SOURCE_INDEX
            and set(binding['receipt']) == {'path', 'sha256'}
            and binding['receipt']['path'] == TERMINAL_PATH,
            'Retirement authority differs')
    hash_value(binding['policyCodeSha256'])
    receipt_raw = read_bound(TERMINAL_PATH, binding['receipt']['sha256'])
    receipt = _json(receipt_raw)
    require(encoded(receipt) == receipt_raw, 'Noncanonical terminal receipt')
    require(set(receipt) == {'schema', 'proposalSha256', 'inventorySha256', 'restoreSha256',
        'approvalSha256', 'journal', 'journalHeadSha256', 'retiredPayloadPaths',
        'retirementRetainedPair', 'sourceIndex', 'preservedSidecars',
        'preservedHistoricalEvidenceSha256', 'priorConfigSha256', 'policyCodeSha256'},
        'Terminal receipt fields differ')
    require(receipt['schema'] == 'pow-exact-payload-retirement-completed-v1'
            and receipt['proposalSha256'] == PROPOSAL_SHA
            and receipt['inventorySha256'] == INVENTORY_SHA
            and receipt['restoreSha256'] == RESTORE_SHA
            and receipt['retiredPayloadPaths'] == list(PATHS)
            and receipt['retirementRetainedPair'] == PAIR
            and receipt['sourceIndex'] == SOURCE_INDEX
            and receipt['priorConfigSha256'] == PRIOR_CONFIG_SHA
            and receipt['policyCodeSha256'] == binding['policyCodeSha256'],
            'Terminal receipt scope differs')
    authenticate_owner_approval(read_bound(EVIDENCE_DIR + '/owner-approval.json',
                                          receipt['approvalSha256']), receipt['approvalSha256'])
    journal = receipt['journal']
    state = validate_chain(journal)
    require(state['status'] == 'complete'
            and state['lastSha256'] == receipt['journalHeadSha256']
            and state['approvalSha256'] == receipt['approvalSha256'],
            'Terminal journal incomplete/untrusted')
    final = journal[-1]['data']
    require(final['successorPolicyCodeSha256'] == binding['policyCodeSha256'],
            'Installed successor code binding differs')
    for key, name in (('finalFenceSha256', 'final-fence.json'),
                      ('retainedPairProofSha256', 'retained-pair-proof.json'),
                      ('sidecarsProofSha256', 'sidecars-proof.json'),
                      ('historicalEvidenceProofSha256', 'historical-evidence-proof.json')):
        read_bound(EVIDENCE_DIR + '/' + name, final[key])
    retained_proof = _json(read_bound(EVIDENCE_DIR + '/retained-pair-proof.json',
                                      final['retainedPairProofSha256']))
    for key, name, digest_key in (
            ('fullProtectedPairEvidence', 'initial-protected-pair.json', 'fullProtectedPairSha256'),
            ('fullArchiveProofsEvidence', 'initial-archive-proofs.json', 'fullArchiveProofsSha256')):
        witness = retained_proof[key]
        require(witness == {'path': EVIDENCE_DIR + '/' + name,
                            'sha256': retained_proof[digest_key]},
                'Protected metadata witness binding differs')
        read_bound(witness['path'], witness['sha256'])
    require(receipt['preservedHistoricalEvidenceSha256']
            == final['historicalEvidenceProofSha256'], 'Historical evidence binding differs')
    p = read_bound(EVIDENCE_DIR + '/proposal.json', PROPOSAL_SHA)
    i = read_bound(EVIDENCE_DIR + '/inventory.json', INVENTORY_SHA)
    r = read_bound(EVIDENCE_DIR + '/static-restore.json', RESTORE_SHA)
    proposal = authenticate_proposal(p, i, r)
    for record in journal:
        data = record['data']
        if record['event'] == 'prepared':
            read_bound(EVIDENCE_DIR + '/guard-initial-0.json', data['preflightSha256'])
        elif record['event'] == 'action-started':
            index = data['index']
            guard = _json(read_bound(EVIDENCE_DIR + '/guard-admit-%d.json' % index,
                                     data['freshFenceSha256']))
            require(guard['proposalSha256'] == PROPOSAL_SHA
                    and guard['approvalSha256'] == receipt['approvalSha256']
                    and guard['retainedPair'] == PAIR and guard['actionIndex'] == index
                    and guard['phase'] == 'admit', 'Action guard scope differs')
            read_bound(EVIDENCE_DIR + '/action-%d-inventory.json' % index,
                       data['frozenInventorySha256'])
        elif record['event'] == 'action-reconciled':
            index = data['index']
            candidates = [EVIDENCE_DIR + '/action-%d-%s.json' % (index, suffix)
                          for suffix in ('absence', 'reconciled-absence')]
            matches = []
            for candidate in candidates:
                try:
                    raw = read_raw_bound(candidate, 65536)
                except FileNotFoundError:
                    continue
                if digest(raw) == data['absenceProofSha256']:
                    matches.append(_json(raw))
            require(len(matches) == 1, 'Missing/ambiguous action reconciliation evidence')
            evidence = matches[0]
            require(evidence['path'] == PATHS[index] and evidence['index'] == index
                    and evidence['absent'] is True
                    and evidence['guardSha256'] == data['preservationProofSha256'],
                    'Action reconciliation scope differs')
            phase = 'reconcile' if 'reconciliation' in evidence else 'after'
            read_bound(EVIDENCE_DIR + '/guard-%s-%d.json' % (phase, index),
                       data['preservationProofSha256'])
            read_bound(EVIDENCE_DIR + '/action-%d-removal.jsonl' % index,
                       evidence['perEntryJournalSha256'])
    sidecars = [{'path': x['path'], 'sha256': x['sha256']}
                for x in proposal['sidecarsKeep']]
    require(receipt['preservedSidecars'] == sidecars, 'Sidecars scope differs')
    source = _json(read_bound(SOURCE_INDEX['path'], SOURCE_INDEX['sha256']))
    return VerifiedRetirement(TOKEN, binding, receipt, proposal, _json(i),
                              source, layout, independent_snapshot_verifier)

def verify_historical_equivalents(layout, inventory):
    by_source = {r['path']: r for tree in inventory['inventories']
                 for r in tree['records']}
    for proof in inventory['historicalEquivalentCopies']:
        require(proof['equal'] is True, 'Historical copy not qualified')
        source = proof['source']
        roots = [p for p in PATHS if '/rollback-roots/' in p
                 and source.startswith(p + '/')]
        require(len(roots) == 1, 'Historical source outside exact roots')
        relative = Path(source).relative_to(roots[0])
        target = Path(layout.live) / relative
        require(target.resolve(strict=True) == target, 'Historical alias changed')
        row = by_source[source]
        s = target.lstat()
        require(stat.S_IMODE(s.st_mode) == row['mode']
                and s.st_uid == row['uid'] and s.st_gid == row['gid'],
                'Historical equivalent metadata changed')
        if row['type'] == 'file':
            require(stat.S_ISREG(s.st_mode) and s.st_size == row['size'],
                    'Historical equivalent type/size changed')
            fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
            try:
                require(os.fstat(fd) == s, 'Historical equivalent replaced')
                h = hashlib.sha256()
                while True:
                    data = os.read(fd, 1024**2)
                    if not data:
                        break
                    h.update(data)
                require(h.hexdigest() == row['sha256']
                        and os.fstat(fd) == s and target.lstat() == s,
                        'Historical equivalent content changed')
            finally:
                os.close(fd)
        else:
            require(row['type'] == 'dir' and stat.S_ISDIR(s.st_mode),
                    'Unsupported historical equivalent object')


def authenticate_owner_approval(raw, expected_sha):
    require(digest(raw) == hash_value(expected_sha), 'Owner approval hash differs')
    approval = _json(raw)
    require(set(approval) == {'schema', 'proposalSha256', 'retiredPayloadPaths',
        'retainedPair', 'permanent', 'sourceMessageId', 'approvedAtUtc'},
        'Owner approval fields differ')
    require(approval['schema'] == 'pow-owner-exact-payload-retirement-approval-v1'
            and approval['proposalSha256'] == PROPOSAL_SHA
            and approval['retiredPayloadPaths'] == list(PATHS)
            and approval['retainedPair'] == PAIR and approval['permanent'] is True
            and isinstance(approval['sourceMessageId'], str) and approval['sourceMessageId']
            and isinstance(approval['approvedAtUtc'], str) and approval['approvedAtUtc'],
            'Owner approval scope differs')
    return approval
