#!/usr/bin/python3 -I
"""Exact second scratch edge. Read-only; historical journals are never rewritten.

The lifecycle caller must authenticate the historical scratch/floor chain using
predecessorDescriptor before trusting this edge. Pending access is exclusively
for the installer holding the native execution lock and never grants authority.
"""
import os
from pathlib import Path
import re
import stat
from types import SimpleNamespace

SCRATCH_APPROVAL = 'fc9c1970f3c7866f75851972cbfa51e7464303f9200ba54182b937e80c3a8a3f'
SCRATCH_GRANT = 'audits/2026-11-18-ui-scratch-capacity-approval.json'
SCRATCH_DIRECTORY = Path('/var/lib/proofofwork-ui-scratch-capacity') / SCRATCH_APPROVAL
SCRATCH_CAPACITY_PATH = Path('/usr/local/sbin/proofofwork-ui-capacity')
SCRATCH_PRIOR_SHA = 'd1325ffa9eb14900a9c344526f6f87967a9b42f339efaad0624a414b1cdde2a2'
SCRATCH_NEXT_SHA = 'dfcee2f385e84c42aa98529dd4926fc27c5c6fb4bd0c50b3905b3a3248141df3'
SCRATCH_PRIOR_BYTES = 11 * 1024**3 // 2
SCRATCH_NEXT_BYTES = 6 * 1024**3
PREDECESSOR_AUTHORITY = {
    'approvalSha256': '40a60816eb09d72733f6a00e7932e075d3911fef303de4813cdab6c97a629388',
    'installedSha256': '76bf81c856b5773974c79859fd3ab81eb7af574ee85f58a9e3e694d5281b463c',
}
PREDECESSOR_DIRECTORY = Path('/var/lib/proofofwork-ui-scratch-capacity') / PREDECESSOR_AUTHORITY['approvalSha256']
SCRATCH_NAMES = {'approval.json', 'capacity', 'intent.json', 'qualified.json',
                 'installed.json', 'verified.json', 'reversing.json', 'rolled-back.json',
                 'verification-failed.json', 'preverified-forward.json', 'preverified-rollback.json'}
# Short names used by the dedicated installer; historical constants stay separate.
APPROVAL, GRANT, DIRECTORY = SCRATCH_APPROVAL, SCRATCH_GRANT, SCRATCH_DIRECTORY
PRIOR_SHA, NEXT_SHA = SCRATCH_PRIOR_SHA, SCRATCH_NEXT_SHA
PRIOR_BYTES, NEXT_BYTES = SCRATCH_PRIOR_BYTES, SCRATCH_NEXT_BYTES
CAPACITY_PATH, NAMES = SCRATCH_CAPACITY_PATH, SCRATCH_NAMES
SUCCESSOR_PACKAGE_FILES = ('audits/2026-10-16-ui-retention-repair-approval.json', 'audits/2026-10-16-ui-retention-repair-proposal.json', 'deploy/audit30/ui-storage.py', 'deploy/audit30/ui-release-policy.py', 'deploy/proofofwork-ui-verified-retention.py', 'deploy/ui-retention/custody.py', 'deploy/ui-retention/inventory.py', 'deploy/ui-retention/removal.py', 'deploy/ui-retention/lifecycle_remote.py', 'deploy/ui-retention/install_lifecycle.py', 'deploy/ui-retention/lifecycle.py', 'deploy/ui-retention/retirement_receipt.py', 'deploy/ui-retention/retirement_transition.py', 'deploy/ui-retention/retirement_controller.py', 'deploy/ui-retention/failed_prepare_repair.py', 'deploy/ui-retention/failed_prepare_review.py', 'deploy/ui-retention/reconcile_failed_prepare.py', 'deploy/ui-retention/transport_retirement.py', 'deploy/ui-retention/scratch_successor.py', 'deploy/ui-scratch-capacity/successor_installer.py', 'deploy/ui-stream-tools/installer.py', 'audits/2026-11-18-ui-scratch-capacity-approval.json', 'deploy/proofofwork-ui-capacity.py')


# Both successor journals have the same immutable receipt format. Each caller
# selects one pinned edge. A later exchange can authenticate the historical
# live inode by its preserved descriptor while the backup inode remains in place.
BOOST_EDGE = SimpleNamespace(approval=APPROVAL, migration='ui-scratch-5-5-to-6-gib-20261118',
    prior_sha=PRIOR_SHA, next_sha=NEXT_SHA, prior_bytes=PRIOR_BYTES, next_bytes=NEXT_BYTES,
    predecessor=PREDECESSOR_AUTHORITY)


def verify_position(layout, runtime, *, allow_pending=False, capacity_descriptor=None):
    return verify_edge(layout, runtime, BOOST_EDGE, SUCCESSOR_PACKAGE_FILES,
                       allow_pending=allow_pending, capacity_descriptor=capacity_descriptor)


def verify_edge(layout, runtime, edge, package_files, *, allow_pending=False, capacity_descriptor=None):
    """Strict journal authentication; pending access is for the locked installer only."""
    if getattr(layout, 'capacity', None) != SCRATCH_CAPACITY_PATH:
        return None
    require, read_json = runtime.require, runtime.read_json
    floor_descriptor = runtime.floor_descriptor
    journal = SCRATCH_DIRECTORY.parent / edge.approval
    if not os.path.lexists(journal):
        return None
    info = journal.lstat()
    require(journal.resolve() == journal and stat.S_ISDIR(info.st_mode)
            and info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
            'Unsafe scratch migration journal')
    names = set(os.listdir(journal))
    require(names <= SCRATCH_NAMES, 'Unexpected scratch migration journal entry')
    grant, _ = read_json(journal / 'approval.json', edge.approval)
    require(grant['schema'] == 'pow-ui-scratch-successor-approval-v1'
            and grant['migrationId'] == edge.migration
            and grant['host'] == '77.42.91.106'
            and grant['target'] == {'path': str(SCRATCH_CAPACITY_PATH),
                'source': 'deploy/proofofwork-ui-capacity.py',
                'beforeSha256': edge.prior_sha, 'afterSha256': edge.next_sha}
            and grant['priorScratchBytes'] == edge.prior_bytes and grant['scratchBytes'] == edge.next_bytes,
            'Scratch grant scope differs')
    intent, intent_sha = read_json(journal / 'intent.json')
    require(set(intent) == {'schema', 'approvalSha256', 'commit', 'tree', 'files', 'protected', 'predecessorAuthority'}
            and intent['schema'] == 'pow-ui-scratch-successor-intent-v1'
            and intent['approvalSha256'] == edge.approval
            and re.fullmatch('[0-9a-f]{40}', intent['commit'])
            and re.fullmatch('[0-9a-f]{40}', intent['tree'])
            and set(intent['files']) == {'capacity'}, 'Scratch intent scope differs')
    require(grant['predecessorAuthority'] == edge.predecessor
            and intent['predecessorAuthority'] == edge.predecessor, 'Predecessor authority differs')
    read_json((SCRATCH_DIRECTORY.parent / edge.predecessor['approvalSha256']) / 'installed.json', edge.predecessor['installedSha256'])
    protected = runtime.scratch_bridge_baseline(intent, grant, package_files=package_files)
    pair = intent['files']['capacity']
    require(set(pair) == {'before', 'after'}, 'Scratch helper scope differs')
    for side, digest in [('before', edge.prior_sha), ('after', edge.next_sha)]:
        row = pair[side]; ident = row['identity']
        require(set(row) == {'sha256', 'identity', 'xattrs'} and row['sha256'] == digest
                and len(ident) == 8 and all(type(v) is int for v in ident)
                and ident[2:4] == [0, 0] and ident[4] == stat.S_IFREG | 0o755
                and ident[5] == 1 and 0 < ident[6] <= 1024**2 and row['xattrs'] == {},
                'Unsafe scratch helper descriptor')
    require(pair['before']['identity'][0] == pair['after']['identity'][0] == info.st_dev
            and pair['before']['identity'][1] != pair['after']['identity'][1], 'Scratch exchange is not distinct same-filesystem inodes')
    live = floor_descriptor(SCRATCH_CAPACITY_PATH) if capacity_descriptor is None else capacity_descriptor
    saved = floor_descriptor(journal / 'capacity')
    if live == pair['before'] and saved == pair['after']:
        position = 'before'
    elif live == pair['after'] and saved == pair['before']:
        position = 'after'
    else:
        raise ValueError('Unrecognized scratch helper positions')
    qualification = {'schema': 'pow-ui-scratch-successor-qualified-v1', 'intentSha256': intent_sha,
                     'authoritySha256': edge.approval, 'protected': protected}
    qualified, qualified_sha = read_json(journal / 'qualified.json')
    require(qualified == qualification, 'Scratch qualification differs')
    terminal = {'schema': 'pow-ui-scratch-successor-installed-v1', 'intentSha256': intent_sha,
                'qualificationSha256': qualified_sha, 'protected': protected}
    installed_sha = None
    if 'installed.json' in names:
        installed, installed_sha = read_json(journal / 'installed.json')
        require(installed == terminal, 'Scratch installation differs')
    preverified = {}
    for phase in ('forward', 'rollback'):
        name = 'preverified-' + phase + '.json'
        if name not in names:
            continue
        record, record_sha = read_json(journal / name)
        require(set(record) == {'schema', 'intentSha256', 'protected', 'status'}
                and record['schema'] == 'pow-ui-scratch-successor-preverified-v1'
                and record['intentSha256'] == intent_sha and record['protected'] == protected,
                'Scratch pending status record differs')
        status = record['status']
        require(status['ok'] is True and status['publicationHealthy'] is True
                and status['retentionComplete'] is True and not status['unfinishedIntents']
                and status['stateSha256'] == protected['stateSha256']
                and status['configSha256'] == protected['configSha256']
                and status['pair'] == protected['pair'] and status['context'] == protected['completedContext']
                and 'verifiedScratchCapacity' not in status and 'scratchCapacity' not in status['binding'],
                'Scratch pending status did not verify the exact protected completion')
        preverified[phase] = record_sha
    if 'verification-failed.json' in names:
        failure, _ = read_json(journal / 'verification-failed.json')
        require(set(failure) == {'schema', 'intentSha256', 'phase', 'errorType'}
                and failure['schema'] == 'pow-ui-scratch-successor-verification-failed-v1'
                and failure['intentSha256'] == intent_sha and failure['phase'] in ('forward', 'rollback')
                and re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,127}', failure['errorType']),
                'Scratch failure record differs')
    if 'verified.json' in names:
        verified, _ = read_json(journal / 'verified.json')
        require(installed_sha is not None and verified == {
            'schema': 'pow-ui-scratch-successor-verified-v1', 'intentSha256': intent_sha,
            'installedSha256': installed_sha, 'protected': protected,
            'pendingStatusSha256': preverified.get('forward')}, 'Scratch terminal verification differs')
        require('forward' in preverified, 'Missing forward pending status')
    reversal = {'schema': 'pow-ui-scratch-successor-reversal-v1', 'intentSha256': intent_sha,
                'qualificationSha256': qualified_sha, 'protected': protected}
    for name in ('reversing.json', 'rolled-back.json'):
        if name in names:
            value, _ = read_json(journal / name)
            expected = dict(reversal, pendingStatusSha256=preverified.get('rollback')) if name == 'rolled-back.json' else reversal
            require(value == expected, 'Scratch reversal differs')
            require(name != 'rolled-back.json' or 'rollback' in preverified, 'Missing rollback pending status')
    require('rolled-back.json' not in names or 'reversing.json' in names, 'Unplanned scratch reversal')
    if not allow_pending:
        require((position == 'after' and {'installed.json', 'verified.json'} <= names
                 and not {'reversing.json', 'rolled-back.json', 'verification-failed.json'} & names)
                or (position == 'before' and {'reversing.json', 'rolled-back.json'} <= names),
                'Scratch migration is unsealed; dedicated reconciliation required')
    authority = None
    if not allow_pending and position == 'after':
        authority = {'model': 'verified-ui-scratch-successor-v1',
                     'approvalSha256': edge.approval, 'intentSha256': intent_sha,
                     'installedSha256': installed_sha, 'scratchBudgetBytes': edge.next_bytes,
                     'predecessorAuthority': edge.predecessor}
    return {'authority': authority, 'predecessorDescriptor': pair['before'],
            'position': position, 'priorCapacity': pair['before'], 'journal': str(journal),
            'intentSha256': intent_sha, 'qualificationSha256': qualified_sha,
            'authoritySha256': edge.approval, 'installedSha256': installed_sha,
            'protected': protected, 'intent': intent}



def authority(layout, runtime):
    position = verify_position(layout, runtime)
    return position['authority'] if position is not None else None
