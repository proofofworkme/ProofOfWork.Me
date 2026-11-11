#!/usr/bin/python3 -I
"""One-shot retirement of exactly 2,048 approved ad330 transfer duplicates.

The unique truncated video, every directory and historical receipt remain.
Any prior intent requires explicit reconciliation; no automatic retry.
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
FAILED = Path('/var/tmp/proofofwork-deploy/.audit5-stream-surfaces-ad330f697f42-20261111T163612Z')
PAYLOAD = FAILED / 'proofofwork-ui-surfaces-ad330f697f42-20261111T163612Z'
UNIQUE = PAYLOAD / 'surfaces/wallet/proofofwork-general-deck.mp4'
EVIDENCE = Path('/var/backups/proofofwork-ui/cleanup-evidence/health-ad330-duplicates-20261111')
ARCHIVE_SHA = '630aae77421e2f7a19bee3329e6dd6505f81ed0ddd9726ffcacd3b09940635b6'
MANIFEST_SHA = 'ae449cc6315e92e3a43ec7a199ce765e6aaf2c91bb79a8391fa71399205da7c6'
PROOF_SHA = '9de47cbb4aab2db13abdf2923a85b21d6772e30ece174490ceb224a4ff4a1c25'
DURABLE_ARCHIVE = '/data/proofofwork-health-fixes-20261111/ad330-recovery-20261111/retained-ad330-surfaces.tgz'
RESTORE_ROOT = '/data/proofofwork-health-fixes-20261111/ad330-recovery-20261111/restored-duplicates'
FORMAT = 'proofofwork-exact-ad330-duplicate-retirement-v1'
MAX_EVIDENCE = 16 * 1024**2
SHA = re.compile('[0-9a-f]{64}\\Z')
PINS = {
 'ui-retention/inventory.py': '4fbc851959a6e8032f5cd592ee6bebf0fe7221fa1d66331b8849b795ccb35578',
 'ui-retention/removal.py': '00e058c347fd186524a4d01fa0949342149668dfd247025ba7bef85edb54e5fa',
 'proofofwork-ui-capacity.py': '3a7d54044cd07665cd37425ea910ad3bcc606450f5537a70d37adce11c6fb687',
}

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

def root_record(value):
    return {**value['fingerprint'], 'inventory': value['records']}

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

def validate_manifest(manifest):
    require(manifest.get('format') == 'proofofwork-ad330-duplicate-manifest-v1' and
            manifest.get('root') == str(FAILED) and manifest.get('archiveSha256') == ARCHIVE_SHA and
            manifest.get('inventoryHelperSha256') == PINS['ui-retention/inventory.py'] and
            manifest.get('allocatedBytes') == 342032384 and manifest.get('logicalBytes') == 337505835,
            'Independent manifest authority differs')
    files = manifest['files']; dirs = manifest['retainedDirectories']; partial = manifest['retainedPartial']
    require(len(files) == 2048 and len(dirs) == 170, 'Approved file or retained directory count differs')
    selected = []
    for row in files:
        native = row['native']; relative = Path(native['path'])
        require(not relative.is_absolute() and '..' not in relative.parts and str(relative) == native['path'] and
                str(relative).startswith(PAYLOAD.name + '/surfaces/') and
                row['path'] == str(FAILED / relative) and row['relative'] == str(relative) and
                row['path'] != str(UNIQUE) and native['kind'] == 'file' and native['identity']['st_nlink'] == 1,
                'Selected file outside exact approved scope or aliased')
        selected.append(row['path'])
    require(len(set(selected)) == 2048 and sum(r['native']['identity']['st_blocks']*512 for r in files) == 342032384 and
            sum(r['native']['identity']['st_size'] for r in files) == 337505835, 'Duplicate set or byte totals differ')
    retained_root = manifest['retainedRoot']
    require(retained_root['path'] == '.' and retained_root['kind'] == 'directory', 'Missing retained failed root')
    for row in dirs:
        relative = Path(row['path'])
        require(row['kind'] == 'directory' and not relative.is_absolute() and '..' not in relative.parts and
                (row['path'] == '.' or row['path'] == PAYLOAD.name or row['path'].startswith(PAYLOAD.name + '/')),
                'Retained directory outside exact partial tree')
    unique = partial['native']
    require(unique['path'] == str(UNIQUE.relative_to(FAILED)) and unique['kind'] == 'file' and
            unique['identity']['st_size'] == 7634944 and unique['identity']['st_nlink'] == 1 and
            partial['expectedCompleteSize'] == 7968826 and partial['prefixSha256'] == unique['sha256'],
            'Unique truncated file preservation differs')
    records = [r['native'] for r in files] + dirs + [retained_root, unique]
    require(len({r['path'] for r in records}) == 2220,
            'Retained membership collides or lacks root')
    return {'selected':sorted(selected),'records':records}

def validate_proof(proof):
    require(proof.get('format') == 'proofofwork-ad330-duplicate-recovery-v1' and proof.get('ok') is True and
            proof.get('manifestSha256') == MANIFEST_SHA and proof.get('durableArchiveSha256') == ARCHIVE_SHA and
            proof.get('duplicateFiles') == 2048 and proof.get('originalInodesRestorable') is False and
            proof.get('originalCtimeRestorable') is False, 'Independent restoration proof differs')
    required = {'content','type','mode','uid','gid','mtimeNs','atimeNs','xattrs','regularFileLinkCount'}
    require(required <= set(proof.get('restoredMetadata',[])), 'Incomplete restoration metadata proof')
    require(proof.get('durableArchivePath') == DURABLE_ARCHIVE and proof.get('restoreRoot') == RESTORE_ROOT,
            'Durable recovery custody differs')

def authority(E, manifest_path, proof_path):
    manifest,_ = pinned_json(E,manifest_path,MANIFEST_SHA)
    proof,_ = pinned_json(E,proof_path,PROOF_SHA)
    result = validate_manifest(manifest)
    validate_proof(proof)
    return result

def match_record(actual, original):
    # Reading historical evidence may advance atime; all fresh plan identities
    # include it, and apply compares the full new inventory without this exception.
    require(actual['path'] == original['path'] and actual['kind'] == original['kind'] and
            actual['xattrs'] == original['xattrs'] and actual.get('sha256') == original.get('sha256'),
            'Qualified path, content or attributes changed')
    require({k:v for k,v in actual['identity'].items() if k != 'st_atime_ns'} ==
            {k:v for k,v in original['identity'].items() if k != 'st_atime_ns'}, 'Qualified identity changed')

def qualify(E, authority):
    failed = root_record(E.inventory(FAILED, require_manifest=False, allow_symlinks=False))
    old = {row['path']:row for row in authority['records']}
    require(set(old) == {row['path'] for row in failed['inventory']}, 'Partial-tree membership changed')
    for row in failed['inventory']: match_record(row, old[row['path']])
    by_parent = {}
    for path in authority['selected']:
        by_parent.setdefault(str(Path(path).parent), []).append(Path(path).name)
    groups = []
    for parent, names in sorted(by_parent.items()):
        names.sort()
        for start in range(0, len(names), 16):
            subset = names[start:start+16]
            value = E.inventory_file_group(Path(parent) / subset[0], subset)
            group = {**root_record(value), 'parent':value['parent']}
            for row in group['inventory']:
                relative = str((Path(parent) / row['path']).relative_to(FAILED))
                match_record({**row,'path':relative}, old[relative])
                require(row['kind'] == 'file' and row['identity']['st_nlink'] == 1, 'Selected file has aliases')
            groups.append(group)
    return groups, failed

def exact_scope(plan, authority):
    require(plan['format'] == FORMAT and plan['controllerSha256'] == digest(Path(__file__).read_bytes()) and
            plan['helpers'] == PINS and plan['manifestSha256'] == MANIFEST_SHA and plan['proofSha256'] == PROOF_SHA and
            plan['failed']['root'] == str(FAILED), 'Unreviewed controller, scope or evidence')
    paths = [str(Path(g['parent']['path']) / r['path']) for g in plan['groups'] for r in g['inventory']]
    require(len(paths) == len(set(paths)) == 2048 and set(paths) == set(authority['selected']) and
            str(UNIQUE) not in paths, 'Plan selected membership differs')
    require({r['path'] for r in plan['failed']['inventory']} == {r['path'] for r in authority['records']},
            'Plan preservation membership differs')

def plan_command(args, E, R, C, lock):
    output = EVIDENCE / 'plan.json'
    require(not os.path.lexists(output), 'Plan already exists; reconcile instead of overwriting')
    approved = authority(E, args.manifest, args.proof)
    before = guards(E)
    status = lifecycle(E, lock)
    groups, failed = qualify(E, approved)
    refs = R.check_references(approved['selected'])
    budgets = [R.journal_capacity_bound(g) for g in groups]
    plan = {'format':FORMAT,'controllerSha256':digest(Path(__file__).read_bytes()),'helpers':PINS,
            'manifestSha256':MANIFEST_SHA,'proofSha256':PROOF_SHA,'createdAtUnix':int(time.time()),
            'manifestPath':str(EVIDENCE/'manifest.json'),'proofPath':str(EVIDENCE/'recovery-proof.json'),
            'groups':groups,'failed':failed,'guards':before,'lifecycle':status,'references':refs,'journalBounds':budgets,
            'approval':'Exactly 2048 complete ad330 duplicates; unique truncated video, all directories and receipts retained'}
    raw = E.encoded(plan)
    _, manifest_raw = pinned_json(E,args.manifest,MANIFEST_SHA)
    _, proof_raw = pinned_json(E,args.proof,PROOF_SHA)
    total = len(raw) + sum(budgets) + len(manifest_raw) + len(proof_raw) + 256*1024
    require(total <= MAX_EVIDENCE, 'Cleanup evidence exceeds bounded envelope')
    C.check_capacity(EVIDENCE,total,len(groups)+8,'ad330-exact-duplicates-plan')
    require(guards(E) == before, 'Protected guards changed while planning')
    for original, target, expected in [(args.manifest,Path(plan['manifestPath']),MANIFEST_SHA),
                                       (args.proof,Path(plan['proofPath']),PROOF_SHA)]:
        _, evidence = pinned_json(E, original, expected)
        if not os.path.lexists(target): E.save_new(target,evidence)
        else: pinned_json(E,target,expected)
    E.save_new(output,raw)
    print(json.dumps({'plan':str(output),'sha256':digest(raw),'duplicateFiles':2048,
                      'allocatedBytes':342032384,'journalBytes':sum(budgets),'maximumEvidenceBytes':total}))

def apply_command(args,E,R,C,lock):
    plan,_ = pinned_json(E,EVIDENCE/'plan.json',args.sha256)
    require(plan['manifestPath'] == str(EVIDENCE/'manifest.json') and
            plan['proofPath'] == str(EVIDENCE/'recovery-proof.json'), 'Evidence path differs')
    approved = authority(E,Path(plan['manifestPath']),Path(plan['proofPath']))
    exact_scope(plan,approved)
    require(0 <= time.time()-plan['createdAtUnix'] <= 3600,'Plan expired')
    intent,complete = EVIDENCE/'intent.json',EVIDENCE/'completed.json'
    require(not os.path.lexists(intent) and not os.path.lexists(complete) and
            not any(EVIDENCE.glob('actions-*.jsonl')),'Prior attempt exists; reconcile, never blindly retry')
    require(guards(E) == plan['guards'],'Protected guards changed')
    lifecycle(E,lock)
    groups,failed = qualify(E,approved)
    require(groups == plan['groups'] and failed == plan['failed'],'Fresh selected or retained identities changed')
    R.check_references(approved['selected'])
    require([R.journal_capacity_bound(g) for g in groups] == plan['journalBounds'],'Journal bounds changed')
    C.check_capacity(EVIDENCE,sum(plan['journalBounds'])+2*1024**2,len(groups)+4,'ad330-exact-duplicates-apply')
    binding = {'manifestPath':plan['manifestPath'],'manifestSha256':MANIFEST_SHA,
               'proofPath':plan['proofPath'],'proofSha256':PROOF_SHA,'archiveSha256':ARCHIVE_SHA}
    E.save_new(intent,E.encoded({'format':FORMAT,'planSha256':args.sha256,'startedAtUnix':int(time.time()),'recovery':binding}))
    counts=[]
    for index,group in enumerate(groups):
        journal=R.Journal(EVIDENCE/('actions-%03d.jsonl'%index),expected_root=group)
        fd=os.open(group['parent']['path'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
        try:
            count=R.delete_file_group(fd,group,journal)
            require(count == group['entries'] and journal.pending is None,'Incomplete selected group')
            counts.append(count)
        finally: os.close(fd);journal.close()
    require(sum(counts)==2048 and all(not os.path.lexists(p) for p in approved['selected']),'Approved target remains')
    assert_preserved(E,plan['failed'],set(approved['selected']))
    require(guards(E)==plan['guards'],'Protected guards changed after retirement')
    post=lifecycle(E,lock)
    result={'format':FORMAT,'ok':True,'planSha256':args.sha256,'counts':counts,'recovery':binding,
            'completedAtUnix':int(time.time()),'lifecycle':post,'controllerRewroteHistoricalReceipts':False,
            'originalInodesRestorable':False,'retainedUniqueFile':str(UNIQUE),'retainedDescendantDirectories':170,'retainedOuterRoot':True,
            'publisherReserveBytes':C.ROOT_RESERVE_BYTES,'scratchLimitBytes':C.MAX_DEPLOY_SCRATCH_BYTES}
    E.save_new(complete,E.encoded(result));print(json.dumps(result))

def main():
    require(os.geteuid()==0 and sys.flags.isolated,'Require isolated root invocation on UI VPS')
    os.umask(0o077)
    E,R,C=helpers()
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='operation',required=True)
    p=sub.add_parser('plan');p.add_argument('--manifest',type=Path,required=True);p.add_argument('--proof',type=Path,required=True)
    p=sub.add_parser('apply');p.add_argument('sha256')
    args=parser.parse_args();parent=EVIDENCE.parent
    require(parent.resolve(strict=True)==parent and parent.is_dir(),'Unsafe evidence parent')
    C.check_capacity(parent,MAX_EVIDENCE,256,'ad330-exact-duplicates-evidence')
    if not EVIDENCE.exists():
        require(args.operation=='plan','Missing planned evidence directory')
        EVIDENCE.mkdir(mode=0o700);R.sync_directory(parent)
    info=EVIDENCE.lstat()
    require(EVIDENCE.resolve(strict=True)==EVIDENCE and stat.S_ISDIR(info.st_mode) and
            info.st_uid==info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o700,'Unsafe evidence directory')
    lock=E.lock_existing()
    try:(plan_command if args.operation=='plan' else apply_command)(args,E,R,C,lock)
    finally:os.close(lock)

if __name__=='__main__':main()
