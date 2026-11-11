#!/usr/bin/python3 -I
"""One exact, user-approved UI retirement. No broad hold or policy exceptions.

Plan is read-only except its new evidence file. Apply is one-shot and never
resumes an interrupted journal implicitly. Review/reconcile an incomplete intent.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = Path('/var/tmp/proofofwork-deploy/proofofwork-ui-source-69c31f4e1dcd-20261109T051556Z')
FAILED = Path('/var/tmp/proofofwork-deploy/.audit5-stream-surfaces-d9fa69d9e1e4-20261110T175832Z')
FAILED_PAYLOAD = FAILED / 'proofofwork-ui-surfaces-d9fa69d9e1e4-20261110T175832Z'
CURRENT = '/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-d9fa69d9e1e4-20261110T210615Z'
EVIDENCE = Path('/var/backups/proofofwork-ui/cleanup-evidence/health-approved-retirement-20261111')
MANIFESTS = {
 'source': ('/var/lib/proofofwork-health-fixes-20261111/source-69c31-recovery-manifest.json', '8da23357e94b46ca7e549ad55601929ed9caff6e12fab3faf3fb01da56e00cf6'),
 'duplicates': ('/var/lib/proofofwork-health-fixes-20261111/duplicate-transport-manifest.json', 'fc6be70b8b516fb273d808ca97062b19063ad35b37ecdf7b26e3270fa1a1cc57'),
}
SOURCE_ARCHIVE = '7908bb803cea739f159444842893dd5f743e3719507720f50c135cdefc40c5c8'
DUPLICATE_ARCHIVE = '613054d5a5421a69840eac9eb71fa0d4d5f03885c660823c797f38aa189cd274'
PINS = {
 'ui-retention/inventory.py': '4fbc851959a6e8032f5cd592ee6bebf0fe7221fa1d66331b8849b795ccb35578',
 'ui-retention/removal.py': '00e058c347fd186524a4d01fa0949342149668dfd247025ba7bef85edb54e5fa',
 'proofofwork-ui-capacity.py': '3a7d54044cd07665cd37425ea910ad3bcc606450f5537a70d37adce11c6fb687',
}
FORMAT = 'proof-of-work-exact-ui-health-retirement-v1'
MAX_EVIDENCE = 32 * 1024**2
RECOVERY_SHA = '7923649b85dbb7037a39c235bc572af32dbf8e0dde210fd61b8be86be8333de3'
RESTORE_ARCHIVE_SHA = '15d0d28a5b3912969aaaa6ea72bfca9b081ec8bf39c09a3e6061a359d2bfdc76'
CUSTODY_SHA = '2378223aa999fa8d94252bd7f10e80d0aa9ab48bb6f392b6bdef89a085c85c44'
CUSTODY_ROOT = '/data/proofofwork-health-fixes-20261111/recovery-proof-20261111T1514'
SHA = re.compile('[0-9a-f]{64}\\Z')

def require(ok, message):
    if not ok: raise ValueError(message)

def digest(raw): return hashlib.sha256(raw).hexdigest()

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def helpers():
    for name, expected in PINS.items():
        require(digest((ROOT / 'deploy' / name).read_bytes()) == expected, 'Changed native helper: ' + name)
    removal = load_module('health_retirement_removal', ROOT / 'deploy/ui-retention/removal.py')
    capacity = load_module('health_retirement_capacity', ROOT / 'deploy/proofofwork-ui-capacity.py')
    require(digest(Path('/usr/local/sbin/proofofwork-ui-capacity').read_bytes()) == PINS['proofofwork-ui-capacity.py'], 'Installed capacity authority changed')
    return removal.E, removal, capacity

def pinned_json(E, path, expected):
    require(SHA.fullmatch(expected), 'Invalid digest')
    raw, info = E.read_regular(path, MAX_EVIDENCE)
    require(info.st_uid == info.st_gid == 0 and not info.st_mode & 0o7022, 'Unsafe evidence authority')
    require(digest(raw) == expected, 'Evidence digest differs: ' + str(path))
    return json.loads(raw), raw

def authority(E):
    source, _ = pinned_json(E, *MANIFESTS['source'])
    duplicates, _ = pinned_json(E, *MANIFESTS['duplicates'])
    require(source['sourceRoot'] == str(SOURCE) and source['archiveSha256'] == SOURCE_ARCHIVE and
            source['archiveHost'] == '65.108.122.87' and not source['differences'] and not source['extraPaths'] and
            len(source['entries']) == 9204 and source['allocatedBytes'] == 367689728, 'Source approval scope differs')
    rows = duplicates['files']
    require(duplicates['archiveSha256'] == DUPLICATE_ARCHIVE and len(rows) == 672 and
            len({r['path'] for r in rows}) == 672 and sum(r['allocatedBytes'] for r in rows) == 106680320 and
            duplicates['excludedUniqueFiles'] == ['surfaces/dns/landing-banner.png'] and duplicates['preserveDirectories'] is True,
            'Duplicate approval scope differs')
    for row in rows:
        relative = Path(row['relative'])
        require(not relative.is_absolute() and '..' not in relative.parts and str(relative).startswith('surfaces/') and
                row['relative'] != 'surfaces/dns/landing-banner.png' and
                row['path'] == str(FAILED_PAYLOAD / relative) and row['equivalent'] == str(Path(CURRENT) / relative),
                'Duplicate path outside exact approved scope')
    return source, duplicates

def recovery(E, path, expected):
    require(expected == RECOVERY_SHA, 'Unreviewed independent restoration proof')
    proof, raw = pinned_json(E, path, expected)
    require(proof.get('format') == 'proofofwork-ui-health-cleanup-recovery-v1' and proof.get('ok') is True and proof.get('sourceManifestSha256') == MANIFESTS['source'][1] and
            proof.get('duplicateManifestSha256') == MANIFESTS['duplicates'][1] and
            proof.get('sourceArchiveSha256') == SOURCE_ARCHIVE and proof.get('duplicateArchiveSha256') == DUPLICATE_ARCHIVE and
            proof.get('sourceEntries') == 9204 and proof.get('duplicateFiles') == 672 and
            proof.get('originalInodesRestorable') is False and proof.get('duplicateRestoreArchiveSha256') == RESTORE_ARCHIVE_SHA, 'Independent restoration proof differs')
    required = {'content', 'type', 'mode', 'uid', 'gid', 'mtimeNs', 'atimeNs', 'xattrs', 'symlinkTarget', 'regularFileLinkCount'}
    require(required <= set(proof.get('restoredMetadata', [])), 'Incomplete restoration metadata proof')
    return {'path': str(path), 'sha256': digest(raw)}

def custody(E, path):
    proof, raw = pinned_json(E, path, CUSTODY_SHA)
    require(proof.get('format') == 'proofofwork-ui-health-cleanup-durable-custody-v1' and
            proof.get('ok') is True and proof.get('recoveryProofSha256') == RECOVERY_SHA and
            proof.get('sourceManifestSha256') == MANIFESTS['source'][1] and
            proof.get('duplicateManifestSha256') == MANIFESTS['duplicates'][1] and
            proof.get('custodyRoot') == CUSTODY_ROOT and
            proof.get('restoredSourceRoot') == CUSTODY_ROOT + '/restored-source69' and
            proof.get('restoredDuplicateRoot') == CUSTODY_ROOT + '/restored-duplicates' and
            proof.get('cleanupReview', {}).get('durableRootUnderTmpfilesRule') is False,
            'Durable recovery custody differs')
    expected = [('source69', CUSTODY_ROOT + '/retained-archives/source-69c31-retained.tgz', SOURCE_ARCHIVE),
                ('duplicate672', CUSTODY_ROOT + '/retained-archives/surfaces-d9fa-retained.tgz', RESTORE_ARCHIVE_SHA)]
    require([(r.get('role'), r.get('retainedArchive'), r.get('sha256')) for r in proof.get('archives', [])] == expected,
            'Durable archive authority differs')
    return {'path': str(path), 'sha256': digest(raw), 'custodyRoot': CUSTODY_ROOT}

def compare_research(row, old, source=False):
    ident = row['identity']
    require(row['kind'] == (old['type'] if source else 'file') and
            row['xattrs'] == [[name, value] for name, value in sorted(old['xattrs'].items())] and row.get('sha256') == old.get('sha256') and
            row.get('target') == old.get('link'), 'Qualified content or attributes changed')
    for native, prior in [('st_dev', 'device' if source else 'dev'), ('st_ino', 'inode'), ('st_uid', 'uid'),
                          ('st_gid', 'gid'), ('st_nlink', 'links'), ('st_mtime_ns', 'mtimeNs')]:
        require(ident[native] == old[prior], 'Qualified source identity changed: ' + native)
    require(stat.S_IMODE(ident['st_mode']) == old['mode'] and ident['st_blocks'] * 512 == old['allocatedBytes'],
            'Qualified allocation or mode changed')
    if row['kind'] == 'file': require(ident['st_size'] == old['size'], 'Qualified file size changed')
    # atime is observational; fresh native inventory pins it at plan time.

def root_record(value):
    return {**value['fingerprint'], 'inventory': value['records']}

def qualify(E, source, duplicates):
    tree = root_record(E.inventory(SOURCE, require_manifest=False, allow_symlinks=True))
    old = {row['relative']: row for row in source['entries']}
    require(set(old) == {row['path'] for row in tree['inventory']}, 'Source membership differs')
    for row in tree['inventory']: compare_research(row, old[row['path']], True)
    parent = SOURCE.parent
    tree['retainedParent'] = {'path': str(parent), 'identity': E.identity(parent.lstat()), 'xattrs': E.xattrs(parent)}
    selected = {row['path']: row for row in duplicates['files']}
    by_parent = {}
    for path in selected: by_parent.setdefault(str(Path(path).parent), []).append(Path(path).name)
    groups = []
    for parent, names in sorted(by_parent.items()):
        names.sort()
        for start in range(0, len(names), 16):
            subset = names[start:start + 16]
            value = E.inventory_file_group(Path(parent) / subset[0], subset)
            group = {**root_record(value), 'parent': value['parent']}
            for row in group['inventory']: compare_research(row, selected[str(Path(parent) / row['path'])])
            groups.append(group)
    failed = root_record(E.inventory(FAILED, require_manifest=False, allow_symlinks=False))
    full = {str(FAILED / row['path']): row for row in failed['inventory']}
    require(set(selected) <= set(full), 'Selected file missing from partial tree')
    for path, old in selected.items():
        equivalent, _ = E.read_regular(old['equivalent'], 64 * 1024**2)
        require(digest(equivalent) == old['sha256'], 'Retained equivalent file changed')
    archive, _ = E.read_regular(duplicates['archive'], 512 * 1024**2)
    require(digest(archive) == DUPLICATE_ARCHIVE, 'Retained release archive changed')
    return tree, groups, failed

def guards(E):
    return {'holds': E.hold_snapshot(), 'timers': E.timer_snapshot(),
            'release': file_guard(E, '/var/www/.proofofwork-ui-release'),
            'state': file_guard(E, '/var/lib/proofofwork-ui-retention/state.json')}

def file_guard(E, path):
    raw, info = E.read_regular(path, 16 * 1024**2)
    return {'path': path, 'sha256': digest(raw), 'identity': E.identity(info), 'xattrs': E.xattrs(path)}

def lifecycle(E, lock):
    config_path = '/etc/proofofwork-retention/ui-lifecycle.json'
    raw, _ = E.read_regular(config_path)
    config = json.loads(raw)
    path = Path(config['controller']['path'])
    code, _ = E.read_regular(path, 4 * 1024**2)
    require(digest(code) == config['controller']['sha256'], 'Lifecycle controller changed')
    module = load_module('health_current_lifecycle', path)
    runtime = module.installed_runtime(config_path, digest(raw))
    runtime.lock_fd = lock
    result = runtime.status({'requireComplete': True})
    require(result.get('retentionComplete') is True and result.get('publicationHealthy') is True,
            'Current/previous/fallback lifecycle is not healthy and complete')
    return {'binding': result['binding'], 'retentionComplete': True, 'publicationHealthy': True}

def exact_scope(plan, source, duplicates):
    require(plan['format'] == FORMAT and plan['controllerSha256'] == digest(Path(__file__).read_bytes()) and
            plan['helpers'] == PINS and plan['manifests'] == MANIFESTS_AS_JSON and plan['source']['root'] == str(SOURCE),
            'Unreviewed controller, dependencies or manifest authority')
    require({row['path'] for row in plan['source']['inventory']} == {row['relative'] for row in source['entries']},
            'Plan source membership differs')
    actual = [str(Path(group['parent']['path']) / row['path']) for group in plan['groups'] for row in group['inventory']]
    require(len(actual) == len(set(actual)) == 672 and set(actual) == {row['path'] for row in duplicates['files']},
            'Plan duplicate membership differs')
    require(plan['failed']['root'] == str(FAILED), 'Partial-tree preservation scope differs')

MANIFESTS_AS_JSON = {key: list(value) for key, value in MANIFESTS.items()}

def assert_preserved(E, expected, deleted):
    current = root_record(E.inventory(FAILED, require_manifest=False, allow_symlinks=False))
    before = {row['path']: row for row in expected['inventory'] if str(FAILED / row['path']) not in deleted}
    after = {row['path']: row for row in current['inventory']}
    require(set(before) == set(after), 'Retained partial-tree membership differs')
    for path, old in before.items():
        new = after[path]
        if old['kind'] == 'directory':
            require(new['kind'] == old['kind'] and new['xattrs'] == old['xattrs'] and
                    all(new['identity'][field] == old['identity'][field] for field in
                        ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink')), 'Retained directory changed')
        else: require(new == old, 'Retained unique file changed')


def plan_command(args, E, R, C, lock):
    require(args.output.parent == EVIDENCE and args.output.name == 'plan.json' and not os.path.lexists(args.output), 'Use exact new plan path')
    source, duplicates = authority(E)
    proof = recovery(E, args.recovery_proof, args.recovery_sha)
    retained = custody(E, args.custody_proof)
    # The plan binds durable UI copies of both independent evidence receipts.
    proof['path'] = str(EVIDENCE / 'recovery-proof.json')
    retained['path'] = str(EVIDENCE / 'durable-custody.json')
    before = guards(E)
    status = lifecycle(E, lock)
    tree, groups, failed = qualify(E, source, duplicates)
    references = R.check_references([str(SOURCE), *(row['path'] for row in duplicates['files'])])
    budgets = [R.journal_capacity_bound(record) for record in [tree, *groups]]
    plan = {'format': FORMAT, 'controllerSha256': digest(Path(__file__).read_bytes()), 'helpers': PINS,
            'manifests': MANIFESTS_AS_JSON, 'recovery': proof, 'custody': retained, 'createdAtUnix': int(time.time()),
            'source': tree, 'groups': groups, 'failed': failed, 'guards': before, 'lifecycle': status,
            'references': references, 'journalBounds': budgets,
            'approval': '2026-11-11 exact source69 and 672 duplicates; original inode preservation released only for these paths; holds and historical receipts unchanged'}
    raw = E.encoded(plan)
    total = len(raw) + sum(budgets) + 2 * 1024**2
    require(total <= MAX_EVIDENCE, 'Cleanup evidence envelope exceeds 32 MiB')
    C.check_capacity(EVIDENCE, total, len(groups) + 8, 'exact-health-retirement-plan')
    require(guards(E) == before, 'Protected guards changed while qualifying')
    # Keep original independent receipt bytes beside the immutable plan/journals.
    for original, copy, expected in [(args.recovery_proof, Path(proof['path']), RECOVERY_SHA),
                                     (args.custody_proof, Path(retained['path']), CUSTODY_SHA)]:
        _, evidence = pinned_json(E, original, expected)
        if not copy.exists(): E.save_new(copy, evidence)
        else: pinned_json(E, copy, expected)
    E.save_new(args.output, raw)
    print(json.dumps({'plan': str(args.output), 'sha256': digest(raw), 'journalBytes': sum(budgets), 'maximumEvidenceBytes': total,
                      'sourceEntries': tree['entries'], 'duplicateFiles': 672, 'allocatedBytes': 474370048}))

def apply_command(args, E, R, C, lock):
    require(args.plan == EVIDENCE / 'plan.json', 'Unexpected plan path')
    plan, raw = pinned_json(E, args.plan, args.sha256)
    source, duplicates = authority(E)
    exact_scope(plan, source, duplicates)
    require(plan['recovery']['path'] == str(EVIDENCE / 'recovery-proof.json') and
            plan['custody']['path'] == str(EVIDENCE / 'durable-custody.json'), 'Non-durable local evidence path')
    recovery(E, plan['recovery']['path'], plan['recovery']['sha256'])
    require(custody(E, plan['custody']['path']) == plan['custody'], 'Plan custody binding differs')
    require(0 <= time.time() - plan['createdAtUnix'] <= 3600, 'Plan expired; requalify without deleting existing evidence')
    intent, complete = EVIDENCE / 'intent.json', EVIDENCE / 'completed.json'
    require(not os.path.lexists(intent) and not os.path.lexists(complete) and
            not any(EVIDENCE.glob('actions-*.jsonl')), 'Prior attempt exists; reconcile, never blindly retry')
    require(guards(E) == plan['guards'], 'Protected guards changed')
    lifecycle(E, lock)
    current_tree, current_groups, current_failed = qualify(E, source, duplicates)
    E.assert_inventory({'fingerprint': {k: current_tree[k] for k in ('format','classification','root','manifestSha256','treeSha256','entries','regularBytes')},
                        'records': current_tree['inventory']}, plan['source'])
    require(current_groups == plan['groups'] and current_failed == plan['failed'], 'Selective scope or partial tree changed')
    R.check_references([str(SOURCE), *(row['path'] for row in duplicates['files'])])
    records = [plan['source'], *plan['groups']]
    require([R.journal_capacity_bound(record) for record in records] == plan['journalBounds'], 'Journal bounds changed')
    C.check_capacity(EVIDENCE, sum(plan['journalBounds']) + 2 * 1024**2, len(records) + 4, 'exact-health-retirement-apply')
    E.save_new(intent, E.encoded({'format': FORMAT, 'planSha256': args.sha256, 'startedAtUnix': int(time.time()),
                                'recovery': plan['recovery'], 'custody': plan['custody'], 'originalInodesRestorable': False}))
    counts = []
    for index, record in enumerate(records):
        journal = R.Journal(EVIDENCE / ('actions-%03d.jsonl' % index), expected_root=record)
        parent = Path(record['root']).parent if index == 0 else Path(record['parent']['path'])
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NOATIME)
        try:
            count = (R.delete_tree(fd, SOURCE.name, record, journal) if index == 0 else R.delete_file_group(fd, record, journal))
            require(count == record['entries'] and journal.pending is None, 'Incomplete retirement group')
            counts.append(count)
        finally:
            os.close(fd); journal.close()
    require(not os.path.lexists(SOURCE) and all(not os.path.lexists(row['path']) for row in duplicates['files']), 'Approved target remains')
    assert_preserved(E, plan['failed'], {row['path'] for row in duplicates['files']})
    require(guards(E) == plan['guards'], 'Protected guards changed after retirement')
    post = lifecycle(E, lock)
    result = {'format': FORMAT, 'ok': True, 'planSha256': args.sha256, 'counts': counts,
              'completedAtUnix': int(time.time()), 'recovery': plan['recovery'], 'custody': plan['custody'], 'lifecycle': post,
              'controllerRewroteHistoricalReceipts': False, 'originalInodesRestorable': False,
              'historicalPlanReplay': 'original retired identities unavailable; exact superseding retirement only',
              'publisherReserveBytes': C.ROOT_RESERVE_BYTES, 'scratchLimitBytes': C.MAX_DEPLOY_SCRATCH_BYTES}
    E.save_new(complete, E.encoded(result))
    print(json.dumps(result))

def main():
    require(os.geteuid() == 0 and sys.flags.isolated, 'Require isolated root invocation on UI VPS')
    os.umask(0o077)
    E, R, C = helpers()
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    p = sub.add_parser('plan'); p.add_argument('output', type=Path); p.add_argument('--recovery-proof', type=Path, required=True); p.add_argument('--recovery-sha', required=True); p.add_argument('--custody-proof', type=Path, required=True)
    p = sub.add_parser('apply'); p.add_argument('plan', type=Path); p.add_argument('sha256')
    args = parser.parse_args()
    parent = EVIDENCE.parent
    require(parent.resolve(strict=True) == parent and parent.is_dir(), 'Unsafe evidence parent')
    C.check_capacity(parent, MAX_EVIDENCE, 128, 'exact-health-retirement-evidence')
    if not EVIDENCE.exists():
        require(args.operation == 'plan', 'Missing planned evidence directory')
        EVIDENCE.mkdir(mode=0o700); R.sync_directory(parent)
    info = EVIDENCE.lstat()
    require(EVIDENCE.resolve(strict=True) == EVIDENCE and stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
            'Unsafe evidence directory')
    lock = E.lock_existing()
    try:
        (plan_command if args.operation == 'plan' else apply_command)(args, E, R, C, lock)
    finally: os.close(lock)

if __name__ == '__main__': main()
