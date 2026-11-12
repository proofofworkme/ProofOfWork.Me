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
# The complete November 3 cycle predates the versioned boot-log model. Only
# this immutable state and its independently sealed terminal records qualify.
BOOT_ROTATION_COMPLETION = {
    'cycle': 'release-54088ca155bc-20261103T032112Z',
    'config': '71f99aa6f48ac6d0f14f4d1649b5985847fbe7255b3ae02845c6c6742e92d49c',
    'state': '7cf680f91d17a0a7bbcfabf2f8fa0aa3f67f78823d1c551afcc7606752234891',
    'context': '07d5220494dc3eda11870f021a1ac98d61d254a158f0662ab62eb64a16c908db',
    'intent': '8ef58f0331d2d8ec22ecda5fe65a1da0143ad46bbd7196debd69081f9e170cb2',
    'receipt': '1d03ef52fea3500a1a384ced66d65c3210e9987a74d127b25f5cd29d0ee2c905',
    'boot': '59af04dd-cdb3-47ed-9a82-988bd86ffc48',
    'rotations': {'dmesg.1.gz': [130487, 141743], 'dmesg.2.gz': [130158, 141740]},
}
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


def system_boot_id():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


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


# The 10 GiB October grant remains part of historical admission evidence. Only
# this subsequent operator grant and its independent physical receipt select 8 GiB.
FLOOR_APPROVAL = '006e5293a28f0f925d09b74abf01ad0d87cca77cfb9d7ed3c95581ac514cbfae'
FLOOR_DIRECTORY = Path('/var/lib/proofofwork-ui-capacity-floor') / FLOOR_APPROVAL
FLOOR_FILES = {
    'capacity': (Path('/usr/local/sbin/proofofwork-ui-capacity'),
                 '24fdd19ceb05f3c89ec45f871fe3daa93a061195132a15a3683ab3540fbe02d2',
                 '3a7d54044cd07665cd37425ea910ad3bcc606450f5537a70d37adce11c6fb687'),
    'receiver': (Path('/var/tmp/proofofwork-deploy/audit29-tools/stream-ui-bundle.py'),
                 '28c5dc45f75184a0cb3138df52b3558b0ebcb0c3d8c59233ae261fdbd812817b',
                 'cbb6231799d0395cd76fdda8545fd6440f09e76d879c80aa7bd4f3030fa4abea'),
}


def floor_descriptor(path):
    info = path.lstat()
    _, digest = read(path)
    attrs = {name: sha(os.getxattr(path, name, follow_symlinks=False)) for name in os.listxattr(path)}
    require(path.lstat() == info, 'Capacity helper changed during verification')
    return {'sha256': digest, 'identity': [info.st_dev, info.st_ino, info.st_uid, info.st_gid,
            info.st_mode, info.st_nlink, info.st_size, info.st_mtime_ns], 'xattrs': attrs}


def capacity_floor_authority(layout):
    if getattr(layout, 'capacity', None) != FLOOR_FILES['capacity'][0]:
        return None  # Isolated fixture layouts have no production authority.
    actual = {name: floor_descriptor(path) for name, (path, _, _) in FLOOR_FILES.items()}
    before = all(actual[name]['sha256'] == values[1] for name, values in FLOOR_FILES.items())
    journal = FLOOR_DIRECTORY
    if not os.path.lexists(journal):
        require(before, 'Capacity helper pair changed without a migration receipt')
        return None
    info = journal.lstat()
    require(journal.resolve() == journal and stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'Unsafe capacity floor journal')
    approval, _ = read_json(journal / 'approval.json', FLOOR_APPROVAL)
    intent, intent_sha = read_json(journal / 'intent.json')
    require(intent['schema'] == 'pow-ui-capacity-floor-intent-v1' and intent['approvalSha256'] == FLOOR_APPROVAL
            and set(intent['files']) == set(FLOOR_FILES), 'Capacity approval or target scope differs')
    rolled_back = os.path.lexists(journal / 'rolled-back.json')
    require(rolled_back or not os.path.lexists(journal / 'reversing.json'), 'Capacity rollback is incomplete')
    side = 'before' if rolled_back else 'after'
    for name, (path, old, new) in FLOOR_FILES.items():
        sealed = intent['files'][name]
        require(sealed['before']['sha256'] == old and sealed['after']['sha256'] == new
                and actual[name] == sealed[side] and floor_descriptor(journal / name) == sealed['after' if rolled_back else 'before']
                and approval['targets'][str(path)]['before'] == old and approval['targets'][str(path)]['after'] == new,
                'Unsealed or mixed capacity helper positions')
    qualified, qualified_sha = read_json(journal / 'qualified.json')
    require(qualified['schema'] == 'pow-ui-capacity-floor-qualified-v1' and qualified['protected'] == intent['protected']
            and qualified['intentSha256'] == intent_sha and qualified['authoritySha256'] == FLOOR_APPROVAL,
            'Capacity migration qualification differs')
    if rolled_back:
        reversal, _ = read_json(journal / 'rolled-back.json')
        planned_reversal, _ = read_json(journal / 'reversing.json')
        require(reversal == planned_reversal and reversal['intentSha256'] == intent_sha and reversal['qualificationSha256'] == qualified_sha,
                'Capacity rollback receipt differs')
        return None
    installed, installed_sha = read_json(journal / 'installed.json')
    require(installed['schema'] == 'pow-ui-capacity-floor-installed-v1' and installed['intentSha256'] == intent_sha
            and installed['qualificationSha256'] == qualified_sha
            and installed['protected'] == qualified['protected'], 'Capacity floor installation proof differs')
    return {'model': 'verified-ui-capacity-floor-v1', 'approvalSha256': FLOOR_APPROVAL,
            'installedSha256': installed_sha, 'rootReserveBytes': approval['rootReserveBytes'],
            'growthReserveBytes': approval['growthReserveBytes']}


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


# Exact approval applies only to adopting the already completed November 11 retirement.
STORAGE_COMPLETION_ADOPTION = {'completion': {'path': '/var/backups/proofofwork-ui/cleanup-evidence/audit30-future-retention-20261111T234622.322199Z-004-completed.json',
                'sha256': 'c2e5367a526c588f2dc7ffc8aacb0b58aba6d1a1d5cfff12d1634bb46a2b119c'},
 'config': 'bd41876cdd609f5c6a6e2b1a79d1628f2f22010c660c5a3d405929995b4c28c6',
 'index': {'path': '/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-index-ordinary-037f8db7edcc-20261111T182211Z.json',
           'sha256': '68f6ebd859ea4161b4605f9b7cb8d60ab8a2c041cb067138bff946101ddbcb8a'},
 'ordinaryPlan': {'path': '/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-release-037f8db7edcc-20261111T182211Z-ordinary-plan.json',
                  'sha256': 'e7adc6b907507cf80701f6ac8f3ff3601dbd0fcb39b64a295bf2261c44846590'},
 'pair': {'current': '037f8db7edcc-20261111T182211Z', 'previous': 'd9fa69d9e1e4-20261110T210615Z'},
 'phaseIntent': {'path': '/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-ordinary-037f8db7edcc-20261111T182211Z-intent.json',
                 'sha256': 'd766a75489438aa65310599d8cc8411a2239dadfef6105c55195576e18582c60'},
 'publication': {'path': '/var/tmp/proofofwork-deploy/recovery-publish-037f8db7edcc-20261111T182211Z-initial/receipt.json',
                 'sha256': '8d611ebac9e362fe5f8c2989c5c410e0a7b833da4c6f300039f5b147dda1c399'},
 'release': '037f8db7edcc-20261111T182211Z',
 'retiredPaths': ['/var/backups/proofofwork-ui/releases/proofofwork-ui-release-d4eeffaf28f1-20261109T160000Z.tgz',
                  '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-d4eeffaf28f1-20261109T160000Z.tgz.provenance',
                  '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-d4eeffaf28f1-20261109T160000Z.tgz.sha256',
                  '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-d9fa69d9e1e4-20261110T210615Z'],
 'state': '7074d22448a398bbd30eb1f5aab861542d5dd571bf25545465aa171ef8948e4c',
 'storageIntent': {'path': '/var/backups/proofofwork-ui/cleanup-evidence/audit30-future-retention-20261111T234622.322199Z-intent.json',
                   'sha256': '18669da63b2e61971457fff7de477124584c54e4e5184f65c3d007950543b29f'},
 'writer': '007f5f393f61199fdbd7cc12fb2648f8676c4fbbd1ba3d557ce308e8f7abaac1'}

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
        self.verify_adoption = False
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
        self.storage_adoption(value)
        return value, digest

    def storage_adoption(self, state, *, verify_seal=True):
        """Authenticate the one approved adoption independently of later upgrades."""
        adoption = state.get('lastStorageAdoption')
        if adoption is None:
            return None
        pin = STORAGE_COMPLETION_ADOPTION
        journal = self.layout.evidence / ('ui-lifecycle-storage-adoption-' + pin['release'])
        require(set(adoption) == {'intentPath', 'intentSha256', 'completionPath'}
                and adoption['intentPath'] == str(journal / 'intent.json')
                and adoption['completionPath'] == str(journal / 'adopted.json'), 'Adoption namespace differs')
        intent, intent_sha = read_json(adoption['intentPath'], adoption['intentSha256'])
        done, done_sha = read_json(adoption['completionPath'])
        require(intent.get('schema') == 'pow-ui-storage-completion-adoption-intent-v1'
                and intent.get('disposition') == 'completed-storage-adopted-without-replay'
                and intent.get('deletionAllowed') is False and intent.get('publicationAllowed') is False
                and intent['plan']['authority'] == pin
                and intent['plan']['schema'] == 'pow-ui-storage-completion-adoption-plan-v1'
                and done.get('schema') == 'pow-ui-storage-completion-adopted-v1'
                and done.get('ok') is True and done.get('authority') == pin
                and done.get('deletionPerformed') is False and done.get('publicationPerformed') is False
                and done.get('originalPhaseEvidencePreserved') is True and done.get('retentionComplete') is True
                and done['intent'] == {'path': adoption['intentPath'], 'sha256': intent_sha},
                'Adoption terminal authority differs')
        prior, _ = read_json(journal / 'prior-state.json', pin['state'])
        read(journal / 'prior-config.json', pin['config'])
        require(prior['revision'] == 220 and prior['lastIntent'] == pin['phaseIntent']
                and prior['pending']['stage'] == 'applying', 'Adoption prior state differs')
        template = intent['stateTemplate']
        reconstructed = dict(template, lastStorageAdoption=dict(template['lastStorageAdoption'], intentSha256=intent_sha))
        require(template['lastStorageAdoption'] == {k: adoption[k] for k in ('intentPath','completionPath')}
                and reconstructed['lastStorageAdoption'] == adoption
                and intent['stateTemplateSha256'] == sha(encoded(template))
                and done['state'] == {'path': str(self.state_path), 'sha256': sha(encoded(reconstructed))}
                and done['stateRevision'] == template['revision'] == 222
                and state['revision'] >= 222
                and done['config'] == {'path': str(CONFIG_PATH), 'sha256': template['configSha256']}
                and template['configSha256'] == intent['plan']['payload']['configSha256']
                and template['status'] == 'complete' and template['pending'] is None
                and template['activePhase'] is None and template['lastUpgrade'] == {}
                and template['index'] == pin['index']
                and template['lastIntent'] == prior['lastIntent']
                and template['lastCompleted'] == {
                    'cycleId':'release-' + pin['release'], 'retentionPolicy':VPS_POLICY,
                    'retainedPair':pin['pair'], 'ordinaryPlan':pin['ordinaryPlan'], 'ordinaryReceipt':pin['completion']},
                'Adoption state transition differs')
        for binding in (pin['phaseIntent'], pin['ordinaryPlan'], pin['completion'],
                        pin['storageIntent'], pin['index'], pin['publication']):
            read(binding['path'], binding['sha256'])
        require(not os.path.lexists(Path(pin['phaseIntent']['path']).with_name(
                    Path(pin['phaseIntent']['path']).name.removesuffix('-intent.json') + '-completed.json')),
                'Original failed phase was fabricated as completed')
        if state['revision'] == 222:
            require(state == reconstructed, 'Initial adopted state changed')
        if verify_seal and not self.verify_adoption:
            verified, _ = read_json(journal / 'verified.json')
            require(verified == {'schema':'pow-ui-storage-adoption-verified-v1',
                    'adoptionReceipt':{'path':adoption['completionPath'],'sha256':done_sha},
                    'state':done['state'],'config':done['config'],
                    'contextSha256':sha(encoded(template['completedContext']))},
                    'Adoption post-switch verification differs')
        return {'intent':done['intent'], 'receipt':{'path':adoption['completionPath'],'sha256':done_sha},
                'state':reconstructed, 'sealedPhaseIntent':pin['phaseIntent']}


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
        state, _ = self.state()
        adoption = self.storage_adoption(state) if state else None
        sealed = adoption['sealedPhaseIntent']['path'] if adoption else None
        return [str(path) for path in paths
                if str(path) != sealed and
                not os.path.lexists(path.with_name(path.name.removesuffix('-intent.json') + '-completed.json'))]

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
        authority = capacity_floor_authority(self.layout)
        result = subprocess.run(['/usr/bin/python3', '-I', '-B', str(self.layout.capacity), 'check',
                                 '--path', str(self.layout.evidence), '--additional-bytes', str(additional),
                                 '--additional-inodes', '128', '--phase', 'ui-retention-lifecycle'],
                                capture_output=True, check=True, timeout=60)
        pools = json.loads(result.stdout)
        if authority is not None:
            require(pools.get('rootReserveBytes') == authority['rootReserveBytes'] and
                    pools.get('growthReserveBytes') == authority['growthReserveBytes'], 'Unapproved lifecycle capacity floor')
            pools['capacityFloor'] = authority
        return pools

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

    def completed_boot_rotation(self, state, state_sha, current):
        """Read-only bridge from one authenticated v1 completion to v2."""
        pin = BOOT_ROTATION_COMPLETION
        recorded = state.get('completedContext')
        if (not recorded or sha(encoded(recorded)) != pin['context']
                or state.get('lastCompleted', {}).get('cycleId') != pin['cycle']
                or state['lastCompleted'].get('retentionPolicy') != VPS_POLICY
                or self.config.get('retentionPolicy') != VPS_POLICY
                or recorded['pair'] != current['pair'] or recorded['manifests'] != current['manifests']):
            return None
        prior = state_sha == pin['state'] and self.config_sha == pin['config']
        if not prior:
            history = self.completion_transitions(state)
            if not history:
                return None
            first = history[0]['completed']
            seal, _ = read_json(first['path'], first['sha256'])
            origin = seal['completionVerification'].get('bootLogRotation', {})
            require(seal['priorState']['sha256'] == pin['state'] and seal['priorConfig']['sha256'] == pin['config']
                    and origin.get('priorStateSha256') == pin['state'] and origin.get('priorContextSha256') == pin['context']
                    and origin.get('bootId') == pin['boot'] and origin.get('observedInodes') == pin['rotations'],
                    'Unrecognized initial boot-log migration in completed upgrade chain')
        # Use the verified original operation's actual namespace, including its
        # operator-chosen identifier, and authenticate both historical records.
        intent_path = Path(state['lastIntent']['path'])
        require(intent_path.parent == self.layout.evidence and intent_path.name.endswith('-intent.json')
                and state['lastIntent']['sha256'] == pin['intent'], 'Boot-log completion intent differs')
        intent, _ = read_json(intent_path, pin['intent'])
        receipt, _ = read_json(intent_path.with_name(intent_path.name.removesuffix('-intent.json')+'-completed.json'),
                               pin['receipt'])
        require(intent['operation'] == 'complete-vps-cycle' and intent['configSha256'] == pin['config']
                and intent['context'] == recorded and receipt['intent'] == state['lastIntent']
                and receipt['stateSha256'] == pin['state'] and receipt['cycleId'] == pin['cycle']
                and receipt['retentionComplete'] is True and receipt['index'] == state['index'],
                'Boot-log terminal proof differs')
        # Compare with the historical model before independently verifying v2.
        # No property besides the kernel-log inode is projected out.
        legacy, _ = self.S.safeguards(self.layout, model=self.S.LEGACY_ROTATING_LOG_GUARD_MODEL)
        old = recorded['guards']
        allowed = self.S.boot_log_paths(self.layout)
        replacements = {row['path']: row for row in legacy['heldCensus'] if row['path'] in allowed}
        changes = {}
        projected = []
        for row in old['heldCensus']:
            if row['path'] in replacements:
                observed = replacements[row['path']]['inode']
                if observed != row['inode']:
                    changes[Path(row['path']).name] = [row['inode'], observed]
                row = dict(row, inode=observed)
            projected.append(row)
        require(dict(old, heldCensus=projected) == legacy and set(replacements) == allowed
                and dict(recorded, guards=current['guards']) == current
                and self.S.guard_model(current['guards']) == self.S.ROTATING_LOG_GUARD_MODEL,
                'Boot-log reconciliation exceeds the verified rotation')
        self.S.compare_guards(self.layout, current['guards'], [])
        boot = system_boot_id()
        if prior:
            require(boot == pin['boot'] and changes == pin['rotations'], 'Unreviewed boot-log inode transition')
        return {'schema': 'pow-ui-completed-boot-log-rotation-v1', 'priorStateSha256': pin['state'],
                'priorContextSha256': pin['context'], 'currentContextSha256': sha(encoded(current)),
                'bootId': boot, 'observedInodes': changes, 'intentSha256': pin['intent'], 'receiptSha256': pin['receipt']}

    def status(self, frame):
        floor = capacity_floor_authority(self.layout)
        state, digest = self.state()
        _, context = self.current()
        unfinished = self.unfinished_intents()
        completion_verification = None
        verified_fallback = None
        no_fallback_index = None
        settled = bool(state and state.get('status') == 'complete' and not state.get('pending')
                       and not state.get('activePhase') and not unfinished)
        rotation = (self.completed_boot_rotation(state, digest, context) if settled
                    and state.get('completedContext') != context else None)
        complete = settled and (state.get('completedContext') == context or rotation is not None)
        if state and state.get('index'):
            index = state['index']
            admitted = self.P.load_index(index['path'], index['sha256'], self.layout, APPROVAL_SHA)
            if complete:
                scope = self.P.policy_scope(index, self.layout, APPROVAL_SHA)
                require(not scope['eligible'],
                        'Completed state has eligible ordinary assets')
                verified_fallback = scope.get('preservedFallback')
                if verified_fallback is None:
                    require(all(row['retainedPair']['current'] != self.S.PRESERVED_FALLBACK_INTRODUCER
                                for row in admitted['admissions']), 'Verified index contains the fallback introducer')
                    cutoff = self.S.PRESERVED_FALLBACK_INTRODUCER[13:]
                    if all(release[13:] < cutoff for row in admitted['admissions']
                           for release in row['retainedPair'].values()):
                        no_fallback_index = index
                if state['lastCompleted'].get('retentionPolicy') == VPS_POLICY:
                    completion_verification = self.verify_vps_completion(state, context)
                else:
                    completion_verification = self.verify_custody_completion(state, index, digest)
        projection = {}
        if 'prospectiveRelease' in frame:
            require(complete and self.config.get('retentionPolicy') == VPS_POLICY,
                    'Private staging requires a verified completed VPS cycle')
            release = frame['prospectiveRelease']
            require(isinstance(release,str) and self.S.RELEASE_ID.fullmatch(release)
                    and release not in context['pair'].values(), 'Invalid proposed release identity')
            admitted = self.P.load_index(state['index']['path'], state['index']['sha256'], self.layout, APPROVAL_SHA)
            current = context['pair']['current']
            archive = self.layout.archives / ('proofofwork-ui-release-'+current+'.tgz')
            # At exchange only the current root becomes the new rollback. No
            # previously admitted older object gains protection from a new upload.
            keep = {str(self.layout.live),str(self.layout.roots/('proofofwork-www-pre-'+release)),
                    *(str(archive)+suffix for suffix in ('','.sha256','.provenance'))}
            if verified_fallback:
                keep.update(verified_fallback['snapshotSha256'])
            leaving = sorted((set(admitted['roots']) | set(admitted['assets'])) - set(admitted['retired']) - keep)
            projection = {'privateStageRetention': {'model':'private-stage-zero-retirement-v1','releaseId':release,
                'previousPair':context['pair'],'stateSha256':digest,'index':state['index'],'wouldRetire':leaving}}
            if verified_fallback:
                projection['privateStageRetention']['preservedFallback'] = verified_fallback
            if leaving:
                forecast = projection['privateStageRetention']
                forecast['model'] = 'private-stage-reviewed-retirement-v1'
        if frame.get('requireComplete'):
            require(complete, 'Published UI is healthy; retention-incomplete blocks another upload')
        return {'ok': True, 'initialized': state is not None, 'retentionComplete': complete,
                **({'verifiedPreservedFallback': verified_fallback} if complete and state and state.get('index') else {}),
                **({'verifiedPreFallbackIndex': no_fallback_index} if no_fallback_index else {}),
                **({'verifiedAccessTimeReconciliation': completion_verification['verifiedAccessTimeReconciliation']}
                   if self.completion_access_time_reconciliation is not None and completion_verification else {}),
                **({'verifiedHistoricalBulkPreservation': completion_verification['verifiedHistoricalBulkPreservation']}
                   if completion_verification and completion_verification.get('verifiedHistoricalBulkPreservation') else {}),
                **({'verifiedCapacityFloor': floor} if floor else {}),
                'publicationHealthy': True, 'configSha256': self.config_sha, 'stateSha256': digest,
                'pair': context['pair'], 'context': state['completedContext'] if rotation else context,
                **({'verifiedBootLogRotation': rotation} if rotation else {}),
                **projection,
                'index': state.get('index') if state else None,
                'pending': state.get('pending') if state else None,
                'unfinishedIntents': unfinished,
                'retentionPolicy': self.config.get('retentionPolicy'),
                'historicalBulkPreserved': self.config.get('retentionPolicy') == VPS_POLICY,
                'offHostCustodyRoot': self.config['offHostCustodyRoot'],
                'binding': {**({'capacityFloor': floor} if floor else {}),
                            'config': {'path': str(CONFIG_PATH), 'sha256': self.config_sha},
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
        scope = self.P.policy_scope(state['index'], self.layout, APPROVAL_SHA)
        if scope.get('preservedFallback') and context['pair']['current'] != self.S.PRESERVED_FALLBACK_INTRODUCER:
            require(plan.get('privateStageRetention',{}).get('forecast',{}).get('preservedFallback') ==
                    plan.get('policyScope',{}).get('preservedFallback') == scope['preservedFallback'],
                    'Completed private publication lost its in-place fallback evidence')
        if 'privateStageRetention' in plan:
            self.verify_private_retirement(plan)
            require(sorted(row['path'] for row in receipt['completed']) == plan['privateStageRetention']['forecast']['wouldRetire'], 'Private staging receipt records retirement')
        require(not scope['eligible'], 'Completed VPS state has eligible ordinary assets')
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

    def private_stage_rule(self, publication):
        receipt_path=Path(publication['path'])
        terminal,_=read_json(receipt_path,publication['sha256'])
        # Historical receipt-only publications predate both attempts and private
        # staging. Modern receipts must resolve their archived native plan even
        # if an optional marker is absent from a caller's input.
        intent_path=receipt_path.with_name('intent.json')
        if 'attempt' not in terminal and 'privateStageRetention' not in terminal and not os.path.lexists(intent_path):
            return None
        intent,_=read_json(intent_path)
        release=terminal['releaseId']; attempt=intent['attempt']
        require(self.S.RELEASE_ID.fullmatch(release) and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,31}',attempt)
                and receipt_path==self.layout.scratch/('recovery-publish-'+release+'-'+attempt)/'receipt.json'
                and terminal.get('attempt',attempt)==attempt and all(intent[k]==terminal[k] for k in ('releaseId','commit','tree'))
                and SHA.fullmatch(intent.get('planSha256','')),
                'Private staging publication intent differs')
        native,_=read_json(self.layout.scratch/('recovery-plan-'+release+'-'+attempt+'.json'),intent['planSha256'])
        if 'privateStaging' not in native.get('closedArchive',{}):
            require('inputCompactor' not in native and 'privateStageRetention' not in native
                    and 'privateStageRetention' not in terminal, 'Private staging witness absent from native plan')
            return None
        rule=native.get('privateStageRetention')
        require(native.get('publicationAttempt')==attempt and terminal.get('planSha256')==intent['planSha256']
                and isinstance(rule,dict) and rule==terminal.get('privateStageRetention') and self.S.reviewed_forecast(rule) and rule.get('releaseId')==release
                and native.get('inputCompactor') and native.get('closedArchive',{}).get('privateStaging',{}).get('model')=='private-release-stage-v1'
                and all(native[k]==terminal[k] for k in ('releaseId','commit','tree')),
                'Private staging plan does not bind zero retirement')
        return {'releasePlanSha256':terminal['planSha256'],'publicationReceiptSha256':publication['sha256'],'forecast':rule}

    def verify_private_retirement(self, plan):
        forecast = plan['privateStageRetention']['forecast']
        require(self.S.reviewed_forecast(forecast) and not plan['moves']
                and sorted(r['path'] for r in plan['delete']) == forecast['wouldRetire']
                and sorted(r['path'] for r in plan['policyScope']['eligible']) == forecast['wouldRetire'],
                'Ordinary retirement differs from the reviewed publication')


    def prepare_cycle(self, frame):
        state, state_sha = self.state()
        require(state is not None and state.get('index') and state.get('pending') is None
                and not state.get('activePhase'), 'Initialize or reconcile the pending lifecycle first')
        pair, context = self.current()
        https, _ = embedded(frame['httpsReceipt'])
        publication = self.verify_publication(https, frame['publicationReceipt'], pair, context)
        rule = self.private_stage_rule(publication) if self.config.get('retentionPolicy') == VPS_POLICY else None
        if rule:
            require(state.get('index')==rule['forecast']['index'] and state_sha==rule['forecast']['stateSha256']
                    and context['pair']['previous']==rule['forecast']['previousPair']['current'],
                    'Private staging pre-exchange lifecycle state or next pair changed')
        index = state['index']
        data = self.P.load_index(index['path'], index['sha256'], self.layout, APPROVAL_SHA)
        existing_hold = self.P.fallback_hold(self.layout,data['index']['admissions'],data['admissions'])
        if existing_hold or (rule and rule['forecast'].get('preservedFallback')):
            require(rule and rule['forecast'].get('preservedFallback') == existing_hold,
                    'Published plan lacks the admitted in-place fallback hold')
            self.P.verify_fallback_hold(existing_hold,self.layout,pair,{})
        operation_id, intent, active_sha = self.begin('prepare-cycle', frame, state, state_sha, context)
        _, https_binding = self.store('ui-lifecycle-' + operation_id + '-https.json', frame['httpsReceipt'])
        if context['pair']['current'] not in data['releaseIds']:
            admission = self.P.admission(self.layout, APPROVAL_SHA, False, index)
            admission_binding = self.evidence('audit30-policy-admission-' + operation_id + '.json', admission)
            index_value = dict(data['index'], admissions=[*data['index']['admissions'], admission_binding])
            index = self.evidence('audit30-policy-admission-index-' + operation_id + '.json', index_value)
        else:
            require(data['admissions'][-1]['retainedPair'] == context['pair'], 'Latest admission does not bind live pair')
        scope = self.P.policy_scope(index, self.layout, APPROVAL_SHA)
        if scope.get('preservedFallback'):
            require(rule and rule['forecast'].get('preservedFallback') == scope['preservedFallback']
                    and sorted(r['path'] for r in scope['eligible']) == rule['forecast']['wouldRetire'], 'Publication requires the same fallback hold and reviewed retirement paths')
        plan = self.S.create_plan(self.layout, 'future-retention', APPROVAL_SHA, scope)
        if rule:
            plan['privateStageRetention'] = rule
            self.verify_private_retirement(plan)
            self.S.validate_plan(plan, self.layout, 'future-retention', APPROVAL_SHA)
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
                            **({('privateStageReviewedRetirement' if rule['forecast']['wouldRetire'] else 'privateStageZeroRetirement'): {'ordinaryPlanSha256':plan_binding['sha256'],
                                'releasePlanSha256':rule['releasePlanSha256'],'delete':len(plan['delete']),'moves':0,'eligible':len(scope['eligible'])}} if rule else {}),
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
        rule = self.private_stage_rule(pending['publicationReceipt']) if vps_only else None
        require(plan.get('privateStageRetention')==rule, 'Native retirement plan differs from published scope')
        if rule:
            scope = self.P.policy_scope(pending['index'],self.layout,APPROVAL_SHA)
            require(vps_only and sorted(r['path'] for r in scope['eligible']) == rule['forecast']['wouldRetire'] and
                    scope.get('preservedFallback') == rule['forecast'].get('preservedFallback') ==
                    plan['policyScope'].get('preservedFallback'),
                    'Private staging cannot retire newly eligible data or change an in-place hold')
            self.verify_private_retirement(plan)
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
            if operation != 'status':
                capacity_floor_authority(self.layout)
            return methods[operation](frame)
        finally:
            self.lock_fd = None
            os.close(lock)


def installed_runtime(config_path, config_sha):
    config, config_sha, package = validate_config(config_path, config_sha)
    storage = load_module('lifecycle_storage', package / 'deploy/audit30/ui-storage.py')
    policy = load_module('lifecycle_policy', package / 'deploy/audit30/ui-release-policy.py', _BOUND_STORAGE=storage)
    custody = load_module('lifecycle_custody', package / 'deploy/ui-retention/custody.py')
    custody.load_helpers()
    return Runtime(config, config_sha, storage, policy, custody)


def private_stage_pre_exchange(config_path, config_sha, release, lock_fd):
    """Recompute the projection directly from native evidence under the publisher's lock."""
    runtime=installed_runtime(config_path,config_sha)
    held=runtime.S.require_execution_lock(lock_fd,runtime.layout)
    observed=runtime.status({'requireComplete':True,'prospectiveRelease':release})
    runtime.S.require_execution_lock(lock_fd,runtime.layout,held)
    require(runtime.S.reviewed_forecast(observed['privateStageRetention']), 'Private staging would retire admitted data')
    return observed['binding'],observed['privateStageRetention']


def main():
    require(os.geteuid() == 0, 'Production lifecycle requires root')
    require(len(sys.argv) == 4, 'Expected CONFIG CONFIG_SHA OP')
    os.umask(0o077)
    runtime=installed_runtime(sys.argv[1],sys.argv[2])
    raw = sys.stdin.buffer.read(MAX_FRAME + 1)
    require(len(raw) <= MAX_FRAME, 'Request frame exceeds bound')
    frame = json.loads(raw, object_pairs_hook=unique)
    out = runtime.dispatch(sys.argv[3], frame)
    sys.stdout.buffer.write(encoded(out))


if __name__ == '__main__':
    main()
