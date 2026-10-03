#!/usr/bin/python3 -I
"""Read-only check of the prepared persistent Audit 28 retention pause."""
import argparse,json,pathlib,stat,subprocess,datetime,hashlib,pwd,os,re

EXPECTED_LOGICAL_BACKUP_TOOL_SHA256 = "4e5252ed8fcc8ce4ec863d6e027d429f146348f30be23d4eb5fe77cfd013a754"
EXPECTED_LOGICAL_PIN = 'proof_indexer-20261003T031852Z.dumpset'

def file_facts(path):
    try:
        info=path.lstat()
        return dict(exists=True,regular=stat.S_ISREG(info.st_mode),symlink=stat.S_ISLNK(info.st_mode),canonical=path.resolve()==path,uid=info.st_uid,mode=stat.S_IMODE(info.st_mode),bytes=info.st_size)
    except OSError:
        return dict(exists=False)

def logical_pin_protection_is_valid(pin, names, tool, digest):
    safe=lambda row: row.get('exists') and row.get('regular') and not row.get('symlink') and row.get('canonical') and row.get('uid')==0
    return bool(safe(pin) and pin.get('mode')==0o644 and pin.get('bytes',4097)<=4096 and names==[EXPECTED_LOGICAL_PIN] and safe(tool) and tool.get('mode')==0o755 and digest==EXPECTED_LOGICAL_BACKUP_TOOL_SHA256)

def evaluate(role, marker, units, logical_pin_protected=False):
    problems=[]
    if not marker.get('exists') or marker.get('symlink') or not marker.get('regular') or not marker.get('canonical') or marker.get('uid')!=0 or marker.get('mode',0)&0o7022:
        problems.append('retention-hold-marker-missing-or-unsafe')
    for name,row in units.items():
        if row.get('LoadState')!='masked' or row.get('ActiveState')!='inactive' or not row.get('persistentMask'):
            problems.append('retention-timer-not-persistently-paused:'+name)
    if role=='node' and not logical_pin_protected:
        problems.append('pinned-logical-restore-backup-not-protected')
    return dict(role=role,ok=not problems,issues=problems,units=units)

EXPECTED_HELD_REVIEW_SHA256 = "c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9"
EXPECTED_AUDIT29_CLEANUP_MANIFEST_SHA256 = "9aa090024effa42b31be9d4b4a4d6e072c87b5b3c50919623a418f73d2a92211"
RETENTION_ROOT = pathlib.Path('/etc/proofofwork-retention')
UI_RELOCATION_ROOT = pathlib.Path('/var/backups/proofofwork-ui/transport-evidence/historical-archives-boost-20261002T013023Z')
EXPECTED_UI_RELOCATION_PLAN_SHA256 = 'eb9c2fbc74c954cd9b0566cdd1252f84c34c8134d276279b6350018b8a403b19'
EXPECTED_UI_RELOCATION_INTENT_SHA256 = '81eeda5bd8d23d8857aa006200eb9dc8a3433d38475ffb25579ba7c4d6250e0c'
EXPECTED_UI_RELOCATION_COMPLETION_SHA256 = '6d56172dbb8148f3f2df351689281bc3c65cb107b693360c3c5c3764eb62d8e5'
# These two historical held archives were preserved by one approved rename
# plan. Its other four files are not exceptions to the historical inventory.
UI_RELOCATIONS = (
    ('proofofwork-ui-source-3bc6c9d44e00-20260929T200127Z.tgz',
     'preserve-move-0.json', 'cc634a944276bad52431f165eab65446370c9a9e6ec2501ed4eb30fabc87ac65'),
    ('proofofwork-ui-surfaces-3bc6c9d44e00-20260929T200127Z.tgz',
     'preserve-move-1.json', '510e232faec7323fed50d6b58cc7f5c40544c85948ad6d31a5571d70d71593dc'),
)
SCRATCH_ROOT = pathlib.Path('/var/tmp/proofofwork-deploy')


def read_safe_json(path, expected_sha256=None):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o7022 or path.resolve() != path or info.st_size > 2 * 1024**2:
        raise ValueError('Unsafe retention evidence file')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        raw = stream.read(2 * 1024**2 + 1)
        opened = os.fstat(stream.fileno())
    identity = lambda row: (row.st_dev,row.st_ino,row.st_mode,row.st_uid,row.st_gid,row.st_size,row.st_mtime_ns,row.st_ctime_ns)
    if len(raw) > 2 * 1024**2 or identity(opened) != identity(info) or identity(path.lstat()) != identity(info):
        raise ValueError('Retention evidence changed or exceeded size bound')
    if expected_sha256 and hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError('Retention evidence hash mismatch')
    def pairs(values):
        row = {}
        for key, value in values:
            if key in row:
                raise ValueError('Duplicate retention evidence key')
            row[key] = value
        return row
    return json.loads(raw, object_pairs_hook=pairs)


def preserved_file_state(path):
    """Hash bounded regular bytes without following links or changing atime."""
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or
        stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or
        path.resolve() != path or info.st_size > 256 * 1024**2):
        raise ValueError('Unsafe preserved relocation target')
    for parent in path.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise ValueError('Unsafe relocation parent directory')
    identity = lambda row: (row.st_dev, row.st_ino, row.st_mode, row.st_uid,
                           row.st_gid, row.st_size, row.st_nlink,
                           row.st_mtime_ns, row.st_ctime_ns, row.st_blocks)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    digest = hashlib.sha256()
    with os.fdopen(descriptor, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        if identity(opened) != identity(info):
            raise ValueError('Relocation target changed before hashing')
        # The approved targets have no xattrs. A new xattr changes the pinned
        # preservation state, even when content and pathname still match.
        xattrs = os.listxattr(stream.fileno())
        if xattrs:
            raise ValueError('Relocation target xattrs changed')
        for chunk in iter(lambda: stream.read(128 * 1024), b''):
            digest.update(chunk)
        if identity(os.fstat(stream.fileno())) != identity(info):
            raise ValueError('Relocation target changed while hashing')
    if identity(path.lstat()) != identity(info) or path.resolve() != path:
        raise ValueError('Relocation target changed after hashing')
    return {'allocatedBytes': info.st_blocks * 512, 'bytes': info.st_size,
            'dev': info.st_dev, 'gid': info.st_gid, 'inode': info.st_ino,
            'links': info.st_nlink, 'mode': stat.S_IMODE(info.st_mode),
            'mtimeNs': info.st_mtime_ns, 'uid': info.st_uid, 'xattrs': [],
            'sha256': digest.hexdigest(), 'ctimeNs': info.st_ctime_ns}


def validate_approved_relocations(intent, moves, completion, current, absent):
    """Only two exact, fully completed preservation records cover held paths."""
    plan = intent.get('plan', {})
    plan_digest = hashlib.sha256((json.dumps(plan, sort_keys=True, indent=2) + '\n').encode()).hexdigest()
    if (intent.get('format') != 'proofofwork-ui-historical-archive-preservation-v1' or
        intent.get('mode') != 'apply' or intent.get('historicalDeletion') is not False or
        intent.get('continuousDeployLock') is not True or
        intent.get('planSha256') != EXPECTED_UI_RELOCATION_PLAN_SHA256 or
        plan_digest != EXPECTED_UI_RELOCATION_PLAN_SHA256 or
        plan.get('sameDeviceRenameOnly') is not True or
        plan.get('historicalDeletion') is not False or
        plan.get('destination') != str(UI_RELOCATION_ROOT)):
        raise ValueError('Relocation plan is unapproved or changed')
    if (completion.get('mode') != 'apply' or completion.get('ok') is not True or
        completion.get('planSha256') != EXPECTED_UI_RELOCATION_PLAN_SHA256 or
        completion.get('destination') != str(UI_RELOCATION_ROOT) or
        completion.get('historicalDeletion') is not False or
        any(completion.get(field) is not True for field in
            ('continuousDeployLock', 'currentSourceAndInputUnchanged',
             'liveAndAllRollbackRootsUnchanged', 'permissionsOwnersXattrsContentInodesPreserved'))):
        raise ValueError('Relocation completion is incomplete or changed')
    sources = {str(SCRATCH_ROOT / name) for name, _, _ in UI_RELOCATIONS}
    if set(moves) != sources or set(current) != sources or set(absent) != sources:
        raise ValueError('Relocation scope expanded or partial')
    approved = {}
    for name, _, _ in UI_RELOCATIONS:
        source = str(SCRATCH_ROOT / name)
        target = str(UI_RELOCATION_ROOT / name)
        records = [row for row in plan.get('files', []) if row.get('source') == source]
        move = moves[source]
        if (len(records) != 1 or records[0].get('target') != target or
            move.get('source') != source or move.get('target') != target or
            move.get('planSha256') != EXPECTED_UI_RELOCATION_PLAN_SHA256 or
            move.get('historicalDeletion') is not False or
            move.get('sameInodeAndBytes') is not True or absent[source] is not True):
            raise ValueError('Relocation source, target or completion mismatch')
        expected = records[0].get('state', {})
        if move.get('verifiedState') != expected:
            raise ValueError('Move fingerprint differs from approved plan')
        observed = dict(current[source])
        ctime = observed.pop('ctimeNs', None)
        # atime is deliberately excluded: reads can advance it, and hashing
        # uses O_NOATIME. Every other approved identity field must survive.
        fingerprint = {key: value for key, value in expected.items() if key != 'atimeNs'}
        if observed != fingerprint or ctime != move.get('ctimeNsAfterRename'):
            raise ValueError('Preserved target bytes or metadata changed')
        approved[source] = target
    return approved


def approved_ui_relocations():
    for directory in (UI_RELOCATION_ROOT, *UI_RELOCATION_ROOT.parents):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Unsafe relocation evidence directory')
    intent = read_safe_json(UI_RELOCATION_ROOT / 'preserve-intent.json', EXPECTED_UI_RELOCATION_INTENT_SHA256)
    completion = read_safe_json(UI_RELOCATION_ROOT / 'preserve-receipt.json', EXPECTED_UI_RELOCATION_COMPLETION_SHA256)
    moves, current, absent = {}, {}, {}
    for name, receipt, digest in UI_RELOCATIONS:
        source = SCRATCH_ROOT / name
        moves[str(source)] = read_safe_json(UI_RELOCATION_ROOT / receipt, digest)
        current[str(source)] = preserved_file_state(UI_RELOCATION_ROOT / name)
        absent[str(source)] = not (source.exists() or source.is_symlink())
    return validate_approved_relocations(intent, moves, completion, current, absent)


def scratch_namespace_evidence(mountinfo=None):
    """Receipt from the checker process, including its effective bind mount."""
    error = None
    if mountinfo is None:
        try:
            mountinfo = pathlib.Path('/proc/self/mountinfo').read_text()
        except OSError as caught:
            mountinfo, error = '', type(caught).__name__
    mount = None
    for line in mountinfo.splitlines():
        fields = line.split()
        if len(fields) >= 6 and fields[4] == str(SCRATCH_ROOT):
            mount = {'mountpoint': fields[4], 'mountOptions': fields[5].split(',')}
    return {'path': str(SCRATCH_ROOT), 'exists': SCRATCH_ROOT.is_dir(),
            'canonical': SCRATCH_ROOT.resolve() == SCRATCH_ROOT,
            'exactMount': mount, 'readOnlyBind': bool(mount and 'ro' in mount['mountOptions']),
            'invocationId': os.environ.get('INVOCATION_ID', ''),
            **({'errorClass': error} if error else {})}


def validate_completed_retirements(manifest, receipt, manifest_sha256):
    """A reviewed exact path/fingerprint can be retired once; no broad skiplist."""
    candidates = manifest.get('delete', [])
    if manifest.get('schema') != 'proof-of-work-audit29-exact-cleanup-review-v1' or len(candidates) != 26:
        raise ValueError('Unexpected exact cleanup scope')
    if (receipt.get('schema') != 'proof-of-work-audit29-completed-retirements-v1' or
        receipt.get('host') != '77.42.91.106' or receipt.get('status') != 'completed' or
        receipt.get('approvedManifestSha256') != manifest_sha256 or
        receipt.get('historicalHeldReviewSha256') != EXPECTED_HELD_REVIEW_SHA256):
        raise ValueError('Retirement receipt is incomplete or not bound to approval')
    expected = {row['path']: row['fingerprint']['sha256'] for row in candidates}
    root_count = 0
    source_count = 0
    for row in candidates:
        path = pathlib.PurePosixPath(row['path'])
        if path.parent == pathlib.PurePosixPath('/var/tmp/proofofwork-deploy') and re.fullmatch(r'proofofwork-ui-source-[A-Za-z0-9][A-Za-z0-9._-]{0,127}', path.name):
            source_count += 1
        elif path.parent == pathlib.PurePosixPath('/var/backups/proofofwork-ui/rollback-roots') and re.fullmatch(r'proofofwork-www-pre-[A-Za-z0-9][A-Za-z0-9._-]{0,127}', path.name):
            root_count += 1
        else:
            raise ValueError('Unsafe retirement path')
        fingerprint = row['fingerprint']
        if fingerprint.get('path') != str(path) or not re.fullmatch(r'[0-9a-f]{64}', fingerprint.get('sha256', '')):
            raise ValueError('Invalid retirement fingerprint')
    if root_count != 15 or source_count != 11:
        raise ValueError('Expanded retirement category scope')
    if len(expected) != 26 or any(not (path.startswith('/var/tmp/proofofwork-deploy/proofofwork-ui-source-') or
        path.startswith('/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-')) for path in expected):
        raise ValueError('Expanded retirement scope')
    actual = {}
    for row in receipt.get('retired', []):
        path = row.get('path')
        if (path in actual or path not in expected or row.get('beforeFingerprintSha256') != expected[path] or
            row.get('outcome') != 'retired'):
            raise ValueError('Unexpected retired path or fingerprint')
        actual[path] = row
    if set(actual) != set(expected) or receipt.get('retiredPathCount') != 26:
        raise ValueError('Partial retirement cannot satisfy retention protection')
    return set(actual)


def held_path_protection(role, review, retired, exists, relocated=None):
    relocated = relocated or {}
    held = [row['path'] for row in review.get('retain', []) if row.get('role') == role]
    expected = 295 if role == 'ui' else 521
    if review.get('format') != 'proof-of-work-audit28-held-review-v1' or len(held) != expected or len(set(held)) != expected:
        raise ValueError('Historical held inventory is incomplete')
    missing = [path for path in held if not exists(path) and path not in retired and path not in relocated]
    resurrected = [path for path in retired if exists(path)]
    covered = [path for path in held if path in retired]
    # Historical review has only two exact source-root intersections; prefixes
    # never hide missing descendants or unrelated historical evidence.
    if retired and (role != 'ui' or len(covered) != 2):
        raise ValueError('Retirement coverage exceeds approved held scope')
    relocated_held = [path for path in held if path in relocated]
    exact_relocations = {str(SCRATCH_ROOT / name): str(UI_RELOCATION_ROOT / name)
                         for name, _, _ in UI_RELOCATIONS}
    if relocated and (role != 'ui' or relocated != exact_relocations or
                      len(relocated_held) != 2 or set(retired) & set(relocated)):
        raise ValueError('Relocation coverage exceeds approved held scope')
    reappeared = [path for path in relocated if exists(path)]
    return {'ok': not missing and not resurrected and not reappeared, 'heldPaths': len(held),
            'approvedRetiredHeldPaths': len(covered), 'mustRemainPresent': expected - len(covered),
            'approvedRelocatedHeldPaths': len(relocated_held),
            'mustRemainAtOriginalPath': expected - len(covered) - len(relocated_held),
            'approvedRelocations': relocated, 'unexpectedRelocatedOriginalPathsPresent': reappeared,
            'missingHeldPaths': missing, 'unexpectedRetiredPathsPresent': resurrected}


def check_held_paths(role):
    review = read_safe_json(RETENTION_ROOT / 'audit28-held-review.json', EXPECTED_HELD_REVIEW_SHA256)
    retired = set()
    receipt_path = RETENTION_ROOT / 'audit29-completed-retirements.json'
    if role == 'ui' and (receipt_path.exists() or receipt_path.is_symlink()):
        manifest = read_safe_json(RETENTION_ROOT / 'audit29-approved-cleanup.json', EXPECTED_AUDIT29_CLEANUP_MANIFEST_SHA256)
        receipt = read_safe_json(receipt_path)
        retired = validate_completed_retirements(manifest, receipt, EXPECTED_AUDIT29_CLEANUP_MANIFEST_SHA256)
    relocated, relocation_error = {}, None
    if role == 'ui':
        try:
            relocated = approved_ui_relocations()
        except (OSError, ValueError, TypeError, KeyError) as error:
            relocation_error = type(error).__name__
    result = held_path_protection(role, review, retired,
        lambda path: pathlib.Path(path).exists() or pathlib.Path(path).is_symlink(), relocated)
    if role == 'ui':
        result['approvedRelocationEvidence'] = {'ok': relocation_error is None,
            **({'errorClass': relocation_error} if relocation_error else {})}
        if relocation_error:
            result['ok'] = False
    return result


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--role',choices=['ui','node'],required=True);args=parser.parse_args()
    path=pathlib.Path('/etc/proofofwork-retention/audit28.hold')
    try:
        info=path.lstat();marker=dict(exists=True,symlink=stat.S_ISLNK(info.st_mode),regular=stat.S_ISREG(info.st_mode),canonical=path.resolve()==path,uid=info.st_uid,mode=stat.S_IMODE(info.st_mode))
    except FileNotFoundError:marker=dict(exists=False)
    names=['proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'] if args.role=='ui' else ['proofofwork-node-release-prune.timer']
    units={}
    for name in names:
        result=subprocess.run(['systemctl','show',name,'-p','LoadState','-p','ActiveState'],capture_output=True,text=True,timeout=5)
        units[name]=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        mask=pathlib.Path('/etc/systemd/system')/name
        try:
            info=mask.lstat()
            units[name]['persistentMask']=stat.S_ISLNK(info.st_mode) and info.st_uid==0 and mask.readlink()==pathlib.Path('/dev/null')
        except FileNotFoundError:
            units[name]['persistentMask']=False
    logical_protected=False
    if args.role=='node':
        pins=pathlib.Path('/etc/proofofwork-postgres-logical-backup.pins')
        tool=pathlib.Path('/usr/local/sbin/proofofwork-postgres-logical-backup')
        pin_info=file_facts(pins);tool_info=file_facts(tool);names=[];digest=''
        try:
            if pin_info.get('regular') and pin_info.get('bytes',4097)<=4096:names=pins.read_text().splitlines()
            if tool_info.get('regular') and tool_info.get('bytes',131073)<=131072:digest=hashlib.sha256(tool.read_bytes()).hexdigest()
        except OSError:pass
        logical_protected=logical_pin_protection_is_valid(pin_info,names,tool_info,digest)
        source=pathlib.Path('/data/proofofwork-postgres-backups/logical')/EXPECTED_LOGICAL_PIN
        directory=file_facts(source);dump=file_facts(source/'proof_indexer.dump')
        try: postgres_uid=pwd.getpwnam('postgres').pw_uid
        except KeyError: postgres_uid=-1
        logical_protected=bool(logical_protected and directory.get('exists') and not directory.get('symlink') and directory.get('canonical') and directory.get('uid')==postgres_uid and directory.get('mode')==0o700 and dump.get('regular') and not dump.get('symlink') and dump.get('canonical') and dump.get('uid')==postgres_uid and dump.get('bytes')==20878072656)
    result=evaluate(args.role,marker,units,logical_protected)
    try:
        result['historicalHeldInventory']=check_held_paths(args.role)
        if not result['historicalHeldInventory']['ok']:
            result['issues'].append('historical-held-path-missing-or-retirement-invalid')
    except (OSError, ValueError, TypeError, KeyError) as error:
        result['historicalHeldInventory']={'ok':False,'errorClass':type(error).__name__}
        result['issues'].append('historical-held-evidence-unavailable-or-invalid')
    result['scratchNamespace']=scratch_namespace_evidence()
    result['ok']=not result['issues'];result['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(json.dumps(result));return 0 if result['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
