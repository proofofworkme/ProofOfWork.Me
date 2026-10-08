"""Read-only UI host census under its existing shared deployment lock."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time

assert os.geteuid() == os.getegid() == 0
paths = {
    'controller': '/var/tmp/proofofwork-deploy/audit29-tools/release.py',
    'receiver': '/var/tmp/proofofwork-deploy/audit29-tools/stream-ui-bundle.py',
    'stage-shell': '/var/tmp/proofofwork-deploy/audit29-tools/ui-stage-candidate.sh',
    'phase-capacity': '/var/tmp/proofofwork-deploy/audit29-tools/ui-capacity.py',
    'capacity': '/usr/local/sbin/proofofwork-ui-capacity',
    'retained': '/usr/local/sbin/proofofwork-ui-retained-root',
    'publisher': '/usr/local/sbin/proofofwork-ui-release-publish',
    'stager': '/usr/local/sbin/proofofwork-ui-release-stage',
    'provenance': '/usr/local/sbin/proofofwork-ui-release-provenance',
    'transport': '/var/tmp/proofofwork-deploy/audit29-tools/ui-transport.py',
}

helper_read_identities = []


def full_stat_identity(details):
    return {field: getattr(details, field) for field in (
        'st_dev', 'st_ino', 'st_mode', 'st_nlink', 'st_uid', 'st_gid',
        'st_rdev', 'st_size', 'st_blksize', 'st_blocks',
        'st_atime_ns', 'st_mtime_ns', 'st_ctime_ns')}


def helper_record(filename, phase='initial'):
    p = Path(filename); s = p.lstat(); before = full_stat_identity(s)
    assert p.resolve(strict=True) == p and stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0
    assert s.st_nlink == 1 and not s.st_mode & 0o7022 and s.st_size <= 2*1024**2
    descriptor = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    with os.fdopen(descriptor, 'rb') as helper:
        opened = os.fstat(helper.fileno())
        assert opened == s and full_stat_identity(opened) == before
        raw = helper.read(2*1024**2 + 1)
        finished = os.fstat(helper.fileno())
        assert finished == s and full_stat_identity(finished) == before
    after_stat = p.lstat(); after = full_stat_identity(after_stat)
    assert p.resolve(strict=True) == p and after_stat == s and after == before
    assert len(raw) == s.st_size
    record = {'path': filename, 'sha256': hashlib.sha256(raw).hexdigest(),
              'mode': oct(stat.S_IMODE(s.st_mode)), 'uid': s.st_uid, 'gid': s.st_gid}
    helper_read_identities.append({'phase': phase, 'path': filename,
        'before': before, 'after': after, 'sha256': record['sha256'],
        'fullBytesRead': len(raw), 'descriptorAndPathStable': True,
        'allMetadataIncludingAtimePreservedByRead': True})
    return record, raw

lock = Path('/run/proofofwork-ui/deploy.lock'); s = lock.lstat()
assert lock.resolve() == lock and stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0
assert s.st_nlink == 1 and not s.st_mode & 0o7022
fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
assert os.fstat(fd) == s and lock.lstat() == s
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
env = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL':'C',
       'GIT_OPTIONAL_LOCKS':'0', 'POW_UI_DEPLOY_LOCK_FD':str(fd)}
helpers = {}; retained_source = None
for key, filename in paths.items():
    helpers[key], raw = helper_record(filename)
    if key == 'retained': retained_source = raw
namespace = {'__name__':'_readonly_recovery_preflight'}
exec(compile(retained_source, paths['retained'], 'exec'), namespace)
fingerprint = namespace['fingerprint']
live = fingerprint(Path('/var/www'))
roots = sorted(Path('/var/backups/proofofwork-ui/rollback-roots').glob('proofofwork-www-pre-*'))
assert len(roots) <= 16
retained = [fingerprint(p) for p in roots]
manifest_path = Path('/var/www/.proofofwork-ui-release')
assert manifest_path.stat().st_size <= 65536
active_manifest = dict(line.split('=',1) for line in manifest_path.read_text().splitlines())
assert active_manifest['format'] in ('proofofwork-ui-release-v3', 'proofofwork-ui-release-v4', 'proofofwork-ui-release-v5')
hold = Path('/etc/proofofwork-retention/audit28.hold')
assert hold.is_file() and not hold.is_symlink() and hold.stat().st_uid == 0
old_managed = {'entries':0, 'logicalBytes':0, 'regularFiles':0}
managed_surfaces = 'activity boost browser code computer desktop dns growth id inception infinity jobs landing marketplace nft publish search token wallet work'.split()
if active_manifest['format'] in ('proofofwork-ui-release-v4', 'proofofwork-ui-release-v5'):
    managed_surfaces.append('pages')
else:
    assert not os.path.lexists(Path('/var/www/proofofwork-pages')) and 'surface.pages.sha256' not in active_manifest
if active_manifest['format'] == 'proofofwork-ui-release-v5':
    managed_surfaces.append('permission')
else:
    assert not os.path.lexists(Path('/var/www/proofofwork-permission')) and 'surface.permission.sha256' not in active_manifest
for name in managed_surfaces:
    root = Path('/var/www/proofofwork-'+name)
    if name in ('publish', 'search', 'code', 'jobs') and not os.path.lexists(root):
        assert 'surface.' + name + '.sha256' not in active_manifest
        continue
    for p in [root, *root.rglob('*')]:
        info = p.lstat(); assert not p.is_symlink() and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))
        old_managed['entries'] += 1
        if stat.S_ISREG(info.st_mode):
            old_managed['logicalBytes'] += info.st_size; old_managed['regularFiles'] += 1
storage = os.statvfs('/var/tmp/proofofwork-deploy')
result = {'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
          'helpers':helpers, 'live':live, 'retained':retained, 'oldManaged':old_managed,
          'activeManifest':active_manifest, 'retentionDeferred':True,
          'availableBytes':storage.f_bavail*storage.f_frsize, 'availableInodes':storage.f_favail,
          'checks':[]}
for argv in [
    ['/usr/local/sbin/proofofwork-ui-release-provenance','verify-rollback'],
    ['/usr/bin/python3','-I','-B',paths['capacity'],'check-scratch','--path','/var/tmp/proofofwork-deploy',
     '--additional-bytes','65536','--additional-inodes','4','--phase','recovery-plan-preflight'],
]:
    p = subprocess.run(argv, env=env, pass_fds=(fd,), stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    result['checks'].append({'command':argv,'exitCode':p.returncode,'output':p.stdout.decode()[:20000]})
    if p.returncode: raise SystemExit(json.dumps(result))
for key, filename in paths.items():
    current, _ = helper_record(filename, 'final'); assert current == helpers[key]
assert fingerprint(Path('/var/www')) == live
assert roots == sorted(Path('/var/backups/proofofwork-ui/rollback-roots').glob('proofofwork-www-pre-*'))
result['helperReadVerification'] = {
    'method': 'O_NOATIME|O_NOFOLLOW', 'fullBytesVerified': True,
    'allReadDescriptorsAndPathsStable': True, 'allReadMetadataPreserved': True,
    'crossPhaseHelperShaModeOwnerUnchanged': True,
    'identities': helper_read_identities}
print(json.dumps(result, indent=2))
