#!/usr/bin/python3 -I
"""Read-only check of the prepared persistent Audit 28 retention pause."""
import argparse,json,pathlib,stat,subprocess,datetime,hashlib,pwd,os,re

EXPECTED_LOGICAL_BACKUP_TOOL_SHA256 = "4e5252ed8fcc8ce4ec863d6e027d429f146348f30be23d4eb5fe77cfd013a754"
EXPECTED_LOGICAL_PIN = 'proof_indexer-20260929T031853Z.dumpset'

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


def held_path_protection(role, review, retired, exists):
    held = [row['path'] for row in review.get('retain', []) if row.get('role') == role]
    expected = 295 if role == 'ui' else 521
    if review.get('format') != 'proof-of-work-audit28-held-review-v1' or len(held) != expected or len(set(held)) != expected:
        raise ValueError('Historical held inventory is incomplete')
    missing = [path for path in held if not exists(path) and path not in retired]
    resurrected = [path for path in retired if exists(path)]
    covered = [path for path in held if path in retired]
    # Historical review has only two exact source-root intersections; prefixes
    # never hide missing descendants or unrelated historical evidence.
    if retired and (role != 'ui' or len(covered) != 2):
        raise ValueError('Retirement coverage exceeds approved held scope')
    return {'ok': not missing and not resurrected, 'heldPaths': len(held),
            'approvedRetiredHeldPaths': len(covered), 'mustRemainPresent': expected - len(covered),
            'missingHeldPaths': missing, 'unexpectedRetiredPathsPresent': resurrected}


def check_held_paths(role):
    review = read_safe_json(RETENTION_ROOT / 'audit28-held-review.json', EXPECTED_HELD_REVIEW_SHA256)
    retired = set()
    receipt_path = RETENTION_ROOT / 'audit29-completed-retirements.json'
    if role == 'ui' and (receipt_path.exists() or receipt_path.is_symlink()):
        manifest = read_safe_json(RETENTION_ROOT / 'audit29-approved-cleanup.json', EXPECTED_AUDIT29_CLEANUP_MANIFEST_SHA256)
        receipt = read_safe_json(receipt_path)
        retired = validate_completed_retirements(manifest, receipt, EXPECTED_AUDIT29_CLEANUP_MANIFEST_SHA256)
    return held_path_protection(role, review, retired, lambda path: pathlib.Path(path).exists() or pathlib.Path(path).is_symlink())


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
        logical_protected=bool(logical_protected and directory.get('exists') and not directory.get('symlink') and directory.get('canonical') and directory.get('uid')==postgres_uid and directory.get('mode')==0o700 and dump.get('regular') and not dump.get('symlink') and dump.get('canonical') and dump.get('uid')==postgres_uid and dump.get('bytes')==19363782935)
    result=evaluate(args.role,marker,units,logical_protected)
    try:
        result['historicalHeldInventory']=check_held_paths(args.role)
        if not result['historicalHeldInventory']['ok']:
            result['issues'].append('historical-held-path-missing-or-retirement-invalid')
    except (OSError, ValueError, TypeError, KeyError) as error:
        result['historicalHeldInventory']={'ok':False,'errorClass':type(error).__name__}
        result['issues'].append('historical-held-evidence-unavailable-or-invalid')
    result['ok']=not result['issues'];result['checkedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(json.dumps(result));return 0 if result['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
