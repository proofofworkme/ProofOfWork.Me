#!/usr/bin/python3
"""Verify/retire only Audit29's exact reviewed 15 UI roots and 11 clean sources.

No age rules, broad retention, archive removal, hold changes or timer changes.
Default is verification. Only root's exact --apply approval enables retirement.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import stat
import subprocess
import sys

EXPECTED_MANIFEST_SHA256 = '9aa090024effa42b31be9d4b4a4d6e072c87b5b3c50919623a418f73d2a92211'
EXPECTED_HELD_REVIEW_SHA256 = 'c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9'
EXPECTED_HOLD_SHA256 = 'e9aca6e22b1dc36b714ed663051f8bc20d9479efa4173474e0b6b771958ca6a4'
EVIDENCE = Path('/var/backups/proofofwork-ui/cleanup-evidence')
ROLLBACKS = Path('/var/backups/proofofwork-ui/rollback-roots')
STAGING = Path('/var/tmp/proofofwork-deploy')
PREEXISTING_ABSENT_UI_PATHS = frozenset(str(STAGING / name) for name in (
    'audit5-stream-source-5970b26e610b-20260926T225712Z.json',
    'audit5-stream-source-b752518bf8b4-20260927T014804Z.json',
    'audit5-stream-source-c64963f4649f-20260927T001231Z.json',
    'audit5-stream-surfaces-5970b26e610b-20260926T225712Z.json',
    'audit5-stream-surfaces-b752518bf8b4-20260927T014804Z.json',
    'audit5-stream-surfaces-c64963f4649f-20260927T001231Z.json',
    'boost-ui-deploy-config.json',
    'boost-ui-publish-b111f5941375-20260927T125836Z.json',
    'deploy-boost-ui-remote.py',
    'profile-release-c964e304a8f9-20260927T181330Z.json',
    'profile-ui-publish-config.json',
))


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fingerprint(root):
    # Exact same model used by the reviewed manifest. No symlink dereferencing.
    entries = []
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = Path(base) / name
            info = path.lstat()
            row = {'path': path.relative_to(root).as_posix(), 'mode': stat.S_IMODE(info.st_mode),
                   'size': info.st_size, 'mtimeNs': info.st_mtime_ns, 'inode': info.st_ino, 'device': info.st_dev}
            if path.is_symlink():
                row['link'] = os.readlink(path)
            elif path.is_file():
                row['sha256'] = sha256(path)
            elif not path.is_dir():
                raise ValueError('Unsupported candidate entry')
            entries.append(row)
    entries.sort(key=lambda row: row['path'].encode())
    digest = hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    info = root.lstat()
    return {'path': str(root), 'fingerprintModel': 'lstat-and-content-json-v1', 'sha256': digest,
            'entryCount': len(entries), 'inode': info.st_ino, 'device': info.st_dev, 'mtimeNs': info.st_mtime_ns,
            'fileBytes': sum(row['size'] for row in entries if 'sha256' in row)}


def validate_manifest(raw, approved_sha256=None, apply=False):
    digest = hashlib.sha256(raw).hexdigest()
    if digest != EXPECTED_MANIFEST_SHA256 or (apply and approved_sha256 != digest):
        raise ValueError('Exact reviewed manifest approval is required')
    manifest = json.loads(raw)
    if manifest.get('schema') != 'proof-of-work-audit29-exact-cleanup-review-v1':
        raise ValueError('Unsupported cleanup manifest')
    rows = manifest.get('delete', [])
    if len(rows) != 26 or len({row['path'] for row in rows}) != 26:
        raise ValueError('Expanded or duplicate cleanup scope')
    counts = {'redundant-rollback-root': 0, 'rebuildable-clean-source': 0}
    for row in rows:
        path = Path(row['path'])
        kind = row.get('kind')
        if kind not in counts or row['fingerprint'].get('path') != str(path):
            raise ValueError('Unsupported cleanup candidate')
        expected_parent, prefix = ((ROLLBACKS, 'proofofwork-www-pre-') if kind == 'redundant-rollback-root'
                                   else (STAGING, 'proofofwork-ui-source-'))
        if path.parent != expected_parent or not re.fullmatch(re.escape(prefix) + r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', path.name):
            raise ValueError('Cleanup path escapes its exact managed root')
        counts[kind] += 1
    if counts != {'redundant-rollback-root': 15, 'rebuildable-clean-source': 11}:
        raise ValueError('Cleanup category scope changed')
    return manifest, digest


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def path_identity(path):
    info = path.lstat()
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def validate_preexisting_absence(receipt, review):
    """An immutable failure census permits no new retirement or monitor skip."""
    if (receipt.get('schema') != 'proof-of-work-audit29-preexisting-ui-absence-v1' or
            receipt.get('host') != '77.42.91.106' or
            receipt.get('status') != 'preexisting-unresolved-absence' or
            receipt.get('historicalHeldReviewSha256') != EXPECTED_HELD_REVIEW_SHA256 or
            receipt.get('historicalHeldPathCount') != 295 or
            receipt.get('currentlyPresentPathCount') != 284 or
            receipt.get('missingPathCount') != 11):
        raise ValueError('Unsupported preexisting UI absence census')
    observed = datetime.datetime.fromisoformat(receipt.get('observedUtc', '').replace('Z', '+00:00'))
    if observed.tzinfo is None:
        raise ValueError('Absence census timestamp must include timezone')
    historical = {row['path']: row['currentMetadata'] for row in review['retain'] if row.get('role') == 'ui'}
    if len(historical) != 295:
        raise ValueError('Absence census requires the complete historical UI inventory')
    missing = receipt.get('missing', [])
    if len(missing) != 11 or {row.get('path') for row in missing} != PREEXISTING_ABSENT_UI_PATHS:
        raise ValueError('Expanded, partial or duplicate preexisting absence census')
    for row in missing:
        if row.get('currentlyExists') is not False or row.get('historicalCurrentMetadata') != historical.get(row['path']):
            raise ValueError('Preexisting absence is not bound to original metadata')
    return set(PREEXISTING_ABSENT_UI_PATHS)


def read_absence_receipt(path, digest, review):
    if not re.fullmatch(r'[0-9a-f]{64}', digest or ''):
        raise ValueError('Exact preexisting absence receipt hash is required')
    before = path.lstat()
    if (path.resolve() != path or not stat.S_ISREG(before.st_mode) or
            before.st_uid != 0 or before.st_mode & 0o7022 or before.st_size > 65536):
        raise ValueError('Unsafe preexisting absence receipt')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as stream:
        raw = stream.read(65537)
        opened = os.fstat(stream.fileno())
    if (len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != digest or
            path_identity(path) != (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_uid,
                                    opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) or
            path_identity(path) != (before.st_dev, before.st_ino, before.st_mode, before.st_uid,
                                    before.st_size, before.st_mtime_ns, before.st_ctime_ns)):
        raise ValueError('Preexisting absence receipt changed or hash differs')
    def pairs(values):
        row = {}
        for key, value in values:
            if key in row:
                raise ValueError('Duplicate absence census key')
            row[key] = value
        return row
    receipt = json.loads(raw, object_pairs_hook=pairs)
    return validate_preexisting_absence(receipt, review)


def verify_held_census(held, preexisting_absent, retired, exists):
    if any(exists(path) for path in preexisting_absent):
        raise ValueError('A preexisting missing historical path reappeared; review required')
    if any(not exists(path) for path in held if path not in preexisting_absent and path not in retired):
        raise ValueError('A new unapproved historical hold is missing')


def require_exact_rollback_set(plan, rows):
    expected = {row['path'] for row in rows if row['kind'] == 'redundant-rollback-root'}
    actual = [row['path'] for row in plan]
    if len(actual) != 15 or len(set(actual)) != 15 or set(actual) != expected:
        raise ValueError('Live rollback plan differs from the exact approved roots')


def verify_rollback_provenance(row, helper, protected):
    path = Path(row['path'])
    archives = Path('/var/backups/proofofwork-ui/releases')
    # This rechecks every candidate surface and its retained archive checksum.
    fields = helper['verified_release'](path, archives)
    expected = row['rollbackProvenance']
    if (fields['release_id'] != expected['containedRelease'] or
            fields['commit'] != expected['commit'] or
            sha256(path / '.proofofwork-ui-release') != expected['manifestSha256']):
        raise ValueError('Candidate rollback provenance changed')
    passthrough = {helper['passthrough_fingerprint'](Path('/var/www')),
                   helper['passthrough_fingerprint'](Path(protected['latestRollbackPath']))}
    if helper['passthrough_fingerprint'](path) not in passthrough:
        raise ValueError('Candidate rollback contains unique non-release recovery content')


def durable_json(path, row):
    # Never overwrite existing historical intent/result evidence.
    with path.open('x') as output:
        os.chmod(path, 0o600)
        json.dump(row, output, indent=2)
        output.write('\n'); output.flush(); os.fsync(output.fileno())
    fsync_directory(path.parent)


def retire_exact_rows(rows, verify_row, remove, persist_progress):
    """Verify all first; every partial removal is durable and remains incomplete."""
    retired = []
    current_path = None
    action = 'preflight-verification'
    try:
        for row in rows:
            current_path = row['path']
            verify_row(row)
        persist_progress('verified', retired, None)
        for row in rows:
            current_path = row['path']; action = 'immediate-before-removal-verification'
            verify_row(row)
            action = 'removal-and-parent-fsync'
            remove(Path(row['path']))
            retired.append({'path': row['path'], 'beforeFingerprintSha256': row['fingerprint']['sha256'],
                            'outcome': 'retired', 'retiredAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()})
            persist_progress('partial', retired, None)
    except BaseException as error:
        persist_progress('failed', retired, {'errorClass':type(error).__name__,'candidatePath':current_path,
                                            'phase':action,'candidateStillPresent':os.path.lexists(current_path) if current_path else None})
        raise
    return retired


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--approved-manifest-sha256')
    parser.add_argument('--preexisting-ui-absence-receipt', type=Path, required=True)
    parser.add_argument('--preexisting-ui-absence-sha256', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Production verification requires root')
    manifest, digest = validate_manifest(args.manifest.read_bytes(), args.approved_manifest_sha256, args.apply)
    os.nice(15)
    helper_path = Path('/usr/local/sbin/proofofwork-ui-verified-retention')
    details = helper_path.lstat()
    if not stat.S_ISREG(details.st_mode) or details.st_uid != 0 or details.st_mode & 0o7022 or helper_path.resolve() != helper_path:
        raise ValueError('Unsafe installed retention helper')
    if sha256(helper_path) != manifest['helperSha256']:
        raise ValueError('Installed retention helper changed')
    helper = runpy.run_path(str(helper_path), run_name='helpers')
    review_path = Path('/etc/proofofwork-retention/audit28-held-review.json')
    helper['safe_path'](review_path, directory=False)
    if sha256(review_path) != EXPECTED_HELD_REVIEW_SHA256:
        raise ValueError('Historical held review changed')
    review = json.loads(review_path.read_bytes())
    held = [row['path'] for row in review['retain'] if row.get('role') == 'ui']
    if len(held) != 295 or len(set(held)) != 295:
        raise ValueError('Historical UI hold inventory is incomplete')
    preexisting_absent = read_absence_receipt(args.preexisting_ui_absence_receipt,
                                            args.preexisting_ui_absence_sha256, review)
    paths = [row['path'] for row in manifest['delete']]
    if preexisting_absent & set(paths):
        raise ValueError('Approved cleanup intersects unresolved preexisting absence')
    protected = manifest['preserve']
    if any(path == protected['latestRollbackPath'] or path == protected['incompleteSource'] or
           path in [str(STAGING / ('proofofwork-ui-source-' + protected[name]['release_id'])) for name in ('current','previous')] for path in paths):
        raise ValueError('Cleanup contains a protected recovery path')
    intersects = sorted(set(held) & set(paths))
    if intersects != sorted(row['heldPath'] for row in manifest['holdCoverage']['covered']):
        raise ValueError('Historical hold coverage changed')
    lock_path = Path('/run/proofofwork-ui/deploy.lock'); helper['safe_path'](lock_path, directory=False)
    with lock_path.open('rb') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for path in (ROLLBACKS, STAGING, EVIDENCE):
            helper['safe_path'](path)
        keep_identities = {}
        def verify_keep_and_holds(retired=(), full=True):
            verify = helper['verified_release'] if full else lambda path, archives: helper['manifest'](path)
            current = verify(Path('/var/www'), Path('/var/backups/proofofwork-ui/releases'))
            previous = verify(Path(protected['latestRollbackPath']), Path('/var/backups/proofofwork-ui/releases'))
            if current != protected['current'] or previous != protected['previous']:
                raise ValueError('Designated current/latest recovery pair changed')
            if any(path_identity(path) != identity for path, identity in keep_identities.items()):
                raise ValueError('Protected recovery path identity changed')
            hold = Path('/etc/proofofwork-retention/audit28.hold'); helper['safe_path'](hold, directory=False)
            if sha256(hold) != EXPECTED_HOLD_SHA256:
                raise ValueError('Historical retention hold changed')
            for timer in ('proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'):
                mask = Path('/etc/systemd/system') / timer
                if not mask.is_symlink() or mask.readlink() != Path('/dev/null') or mask.lstat().st_uid != 0:
                    raise ValueError('Persistent prune mask changed')
            verify_held_census(held, preexisting_absent, retired, os.path.lexists)
            for name in ('current','previous'):
                helper['safe_path'](STAGING / ('proofofwork-ui-source-' + protected[name]['release_id']))
            helper['safe_path'](Path(protected['incompleteSource']))
        verify_keep_and_holds()
        live_current, live_previous, live_plan = helper['rollback_plan'](
            Path('/var/www'), ROLLBACKS, Path('/var/backups/proofofwork-ui/releases'))
        if live_current != protected['current'] or live_previous != protected['previous']:
            raise ValueError('Reviewed rollback recovery pair changed')
        require_exact_rollback_set(live_plan, manifest['delete'])
        # Full trees/archive bytes are verified before and after the operation
        # and again before every removal once candidate preflight completes.
        # Identity, manifest, hold and mask fences also run on every check.
        for path in (Path('/var/www'), Path(protected['latestRollbackPath']),
                     review_path, args.preexisting_ui_absence_receipt,
                     Path(protected['incompleteSource']),
                     *[STAGING / ('proofofwork-ui-source-' + protected[name]['release_id']) for name in ('current','previous')],
                     *[Path('/var/backups/proofofwork-ui/releases') / protected[name]['archive_name'] for name in ('current','previous')]):
            keep_identities[path] = path_identity(path)
        # Keep the unique source work in durable cleanup evidence before any
        # source retirement, and prove its prerequisite from the kept checkout.
        archive = manifest['sourceGitObjectCoverage']['uniqueCommitArchive']
        source_bundle = EVIDENCE / 'audit29-ui-source-412903503279.bundle'
        helper['safe_path'](source_bundle,directory=False)
        if source_bundle.stat().st_size != archive['bundleBytes'] or sha256(source_bundle) != archive['bundleSha256']:
            raise ValueError('Durable source-work archive is missing or changed')
        kept_source = STAGING / ('proofofwork-ui-source-' + protected['current']['release_id'])
        subprocess.run(['/usr/bin/git','-c','safe.directory='+str(kept_source),'-C',str(kept_source),
                        'bundle','verify',str(source_bundle)],env={'PATH':'/usr/bin:/bin','GIT_OPTIONAL_LOCKS':'0'},
                       capture_output=True,check=True,timeout=30)
        helper['referenced_paths']([{'path': path} for path in paths])
        retired_paths = set()
        preflight_complete = False
        def verify_row(row):
            verify_keep_and_holds(retired_paths, full=preflight_complete)
            path = Path(row['path']); helper['safe_path'](path)
            helper['referenced_paths']([{'path': str(path)}])
            if row['kind'] == 'redundant-rollback-root':
                verify_rollback_provenance(row, helper, protected)
            if row['kind'] == 'rebuildable-clean-source':
                env = {'PATH':'/usr/bin:/bin','GIT_OPTIONAL_LOCKS':'0'}
                git = ['/usr/bin/git','-c','safe.directory='+str(path),'-C',str(path)]
                commands = [('head',['rev-parse','HEAD']),('tree',['rev-parse','HEAD^{tree}']),
                            ('statusSha256',['status','--porcelain','--untracked-files=all','--ignored']),
                            ('refInventorySha256',['for-each-ref','--format=%(refname) %(objectname)'])]
                for key, command in commands:
                    value = subprocess.check_output(git + command,env=env,text=True,timeout=30)
                    value = hashlib.sha256((value if key=='statusSha256' else value.strip()).encode()).hexdigest() if key.endswith('Sha256') else value.strip()
                    if value != row['sourceProvenance'][key]:
                        raise ValueError('Source Git provenance changed: ' + str(path))
            # The exact inode/content comparison follows the slower archive and
            # Git checks and is repeated immediately before each removal.
            if fingerprint(path) != row['fingerprint']:
                raise ValueError('Candidate identity/content changed: ' + str(path))
            verify_keep_and_holds(retired_paths, full=False)
            helper['referenced_paths']([{'path': str(path)}])
        if not args.apply:
            for index,row in enumerate(manifest['delete'],1):
                verify_row(row)
                print(json.dumps({'event':'candidate-verified','index':index,'path':row['path']}),flush=True)
            print(json.dumps({'status':'verified','manifestSha256':digest,'candidateCount':26,
                              'productionMutation':False,'preexistingUnresolvedHeldAbsences':11,
                              'retentionMonitorMustRemainFailing':True}))
            return 0
        if not shutil.rmtree.avoids_symlink_attacks:
            raise ValueError('Descriptor-based removal is unavailable')
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
        intent = EVIDENCE / ('audit29-intent-' + stamp + '.json')
        durable_json(intent, {'schema':'proof-of-work-audit29-cleanup-intent-v1','status':'approved-intent',
                             'approvedManifestSha256':digest,'historicalHeldReviewSha256':EXPECTED_HELD_REVIEW_SHA256,
                             'preexistingUiAbsenceReceiptPath':str(args.preexisting_ui_absence_receipt),
                             'preexistingUiAbsenceReceiptSha256':args.preexisting_ui_absence_sha256,
                             'preexistingUnresolvedHeldAbsences':sorted(preexisting_absent),
                             'delete':manifest['delete'],'preserve':protected})
        progress_count = 0
        def progress(status, retired, error):
            nonlocal progress_count, preflight_complete
            progress_count += 1
            durable_json(EVIDENCE / ('audit29-result-' + stamp + '-' + str(progress_count).zfill(3) + '.json'),
                         {'status':status,'approvedManifestSha256':digest,'intentPath':str(intent),
                          'preexistingUiAbsenceReceiptSha256':args.preexisting_ui_absence_sha256,
                          'preexistingUnresolvedHeldAbsenceCount':11,
                          'retired':retired,'remainingCount':26-len(retired),'errorClass':error})
            if status == 'verified':
                preflight_complete = True
            print(json.dumps({'event':'cleanup-progress','status':status,'retiredCount':len(retired),'remainingCount':26-len(retired)}),flush=True)
        def remove(path):
            shutil.rmtree(path); fsync_directory(path.parent)
            retired_paths.add(str(path))
        retired = retire_exact_rows(manifest['delete'],verify_row,remove,progress)
        try:
            if any(os.path.lexists(path) for path in paths):
                raise ValueError('A retired path is still present')
            verify_keep_and_holds(set(paths))
        except BaseException as error:
            progress('failed',retired,{'errorClass':type(error).__name__,'phase':'final-keep-and-hold-verification'})
            raise
        completed = {'schema':'proof-of-work-audit29-completed-retirements-v1','host':'77.42.91.106','status':'completed',
                     'approvedManifestSha256':digest,'historicalHeldReviewSha256':EXPECTED_HELD_REVIEW_SHA256,
                     'retiredPathCount':26,'retired':retired,'originalHistoricalUiHeldPaths':295,
                     'remainingPresentHistoricalUiHeldPaths':282,
                     'preexistingUnresolvedHeldAbsenceCount':11,
                     'preexistingUiAbsenceReceiptSha256':args.preexisting_ui_absence_sha256,
                     'preexistingUnresolvedHeldAbsences':sorted(preexisting_absent),
                     'retentionMonitorMustRemainFailing':True,
                     'holdMarkerPreserved':True,'pruneMasksPreserved':True,'intentPath':str(intent),
                     'intentSha256':sha256(intent),'completedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        completed_path = EVIDENCE / ('audit29-completed-' + stamp + '.json')
        durable_json(completed_path,completed)
        print(json.dumps({'status':'completed','completedReceiptPath':str(completed_path),'completedReceiptSha256':sha256(completed_path),
                          'manifestSha256':digest,'retiredCount':26,'completedExceptionInstalled':False}),flush=True)
        return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(type(error).__name__ + ': ' + str(error),file=sys.stderr)
        raise SystemExit(1)
