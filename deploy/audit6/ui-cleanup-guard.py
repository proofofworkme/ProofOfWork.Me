#!/usr/bin/python3 -I
"""Read-only durable UI deployment reference guard. Never deletes anything.

Deletion callers must retain the same shared lock across this check and their
separately approved deletion. A standalone success is only a snapshot, not a
permission token for a later unlocked operation.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOTS = {'state': '/var/lib/proofofwork-ui-deployments', 'www': '/var/www',
         'stage': '/var/tmp/proofofwork-deploy', 'archives': '/var/backups/proofofwork-ui/releases',
         'rollbacks': '/var/backups/proofofwork-ui/rollback-roots', 'lock': '/run/proofofwork-ui/deploy.lock'}
TERMINAL = {'committed', 'rolled-back', 'cancelled-before-publication'}
PHASES = TERMINAL | {'prepared', 'armed', 'prepublishing-union', 'published-awaiting-smoke', 'preserving-original', 'restoring'}
RELEASE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z')
ARCHIVE = re.compile(r'proofofwork-ui-release-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.tgz\Z')
RETAINED = re.compile(r'(proofofwork-www-pre-[A-Za-z0-9][A-Za-z0-9._-]{0,127}):([0-9a-f]{64}):([0-9a-f]{64})\Z')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def safe(path, directory=False):
    p = Path(path)
    require(p.is_absolute() and p.resolve(strict=True) == p and not p.is_symlink(), 'Noncanonical reference path')
    value = p.stat()
    require((stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode)) and
            value.st_uid == os.geteuid() and not value.st_mode & 0o7022, 'Unsafe reference ownership/mode/type')
    return p


def read_json(path):
    p = safe(path)
    require(p.stat().st_size <= 16 * 1024 * 1024 and p.stat().st_nlink == 1, 'Unsafe deployment journal size/link count')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        data = source.read(16 * 1024 * 1024 + 1)
    require(len(data) <= 16 * 1024 * 1024, 'Deployment journal grew beyond its bound')
    return json.loads(data), hashlib.sha256(data).hexdigest()


def identity(path):
    value = safe(path, True).stat()
    return [value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid]


def lock(c):
    safe(Path(c['lock']).parent, True)
    inherited = os.environ.get('POW_UI_DEPLOY_LOCK_FD')
    if inherited is not None:
        require(inherited.isdigit() and int(inherited) >= 3, 'Invalid inherited deployment lock')
        fd = int(inherited)
        require(Path('/proc/self/fd/' + inherited).resolve() == Path(c['lock']), 'Wrong inherited deployment lock')
        require(os.fstat(fd).st_ino == safe(c['lock']).stat().st_ino, 'Deployment lock identity changed')
        owned = False
    else:
        if Path(c['lock']).exists():
            safe(c['lock'])
        fd = os.open(c['lock'], os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        owned = True
    require(os.fstat(fd).st_nlink == 1, 'Deployment lock has external hardlinks')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return fd, owned


def references(c, fd):
    require(Path('/proc/self/fd/' + str(fd)).resolve() == Path(c['lock']), 'Reference scan requires shared deployment lock')
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for key in ('state', 'www', 'stage', 'archives', 'rollbacks'):
        safe(c[key], True)
    protected = {}
    journals = []
    def protect(path, reason):
        protected.setdefault(str(path), []).append(reason)
    def archive_family(name, reason):
        require(ARCHIVE.fullmatch(name), 'Unrecognized archive reference; cleanup refused')
        path = Path(c['archives']) / name
        for suffix in ('', '.sha256', '.provenance'):
            protect(str(path) + suffix, reason)
    def manifest(root, reason, expected_sha=None):
        path = safe(Path(root) / '.proofofwork-ui-release')
        require(path.stat().st_size <= 65536, 'Oversized UI manifest; cleanup refused')
        data = path.read_bytes()
        if expected_sha is not None:
            require(hashlib.sha256(data).hexdigest() == expected_sha, 'Original prior manifest changed; cleanup refused')
        names = [line.split('=', 1)[1] for line in data.decode().splitlines() if line.startswith('archive_name=')]
        require(len(names) == 1, 'UI manifest has no unique archive reference; cleanup refused')
        archive_family(names[0], reason)
    protect(c['www'], 'current-serving-root')
    protect(c['state'], 'durable-deployment-journals')
    protect(c['lock'], 'shared-deployment-lock')
    manifest(c['www'], 'current-serving-archive')
    for path in sorted(Path(c['state']).glob('*.json')):
        job, digest = read_json(path)
        require(job.get('model') == 'proofofwork-ui-durable-publication-v1' and job.get('phase') in PHASES,
                'Unrecognized deployment journal; cleanup refused')
        release = job.get('release', '')
        require(RELEASE.fullmatch(release) and path.name == release + '.json', 'Invalid deployment journal identity')
        journals.append({'release': release, 'phase': job['phase'], 'sha256': digest})
        if job['phase'] in TERMINAL:
            continue
        reason = 'unfinished-deployment:' + release
        retained = job.get('retained', [])
        require(isinstance(retained, list) and len(retained) <= 8, 'Invalid retained-root reference list')
        seen_retained = set()
        for record in retained:
            match = RETAINED.fullmatch(record) if isinstance(record, str) else None
            require(match is not None and match[1] not in seen_retained, 'Invalid or duplicate retained-root reference')
            seen_retained.add(match[1])
            retained_root = safe(Path(c['rollbacks']) / match[1], True)
            protect(retained_root, reason + ':explicit-retained-root')
            manifest(retained_root, reason + ':explicit-retained-archive', match[2])
        stage = Path(c['stage'])
        candidate = stage / ('proofofwork-www-stage-' + release)
        source = stage / ('proofofwork-ui-source-' + release)
        rollback = Path(c['rollbacks']) / ('proofofwork-www-pre-' + release)
        original_root = Path(c['rollbacks']) / ('proofofwork-www-pre-original-' + hashlib.sha256(release.encode()).hexdigest()[:32])
        if 'originalRoot' in job:
            require(job['originalRoot'] == str(original_root), 'Unexpected original retention reference; cleanup refused')
        expected_recovery = 'recovery-' + hashlib.sha256(release.encode()).hexdigest()[:32]
        recovery_root = stage / ('proofofwork-www-stage-' + expected_recovery)
        for root in (candidate, source, rollback, recovery_root, original_root):
            protect(root, reason)
        archive_family('proofofwork-ui-release-' + release + '.tgz', reason)
        archive_family('proofofwork-ui-release-' + expected_recovery + '.tgz', reason)
        if 'recovery' in job:
            require(job['recovery']['root'] == str(recovery_root) and job['recovery']['archive'] ==
                    str(Path(c['archives']) / ('proofofwork-ui-release-' + expected_recovery + '.tgz')),
                    'Unexpected continuity reference; cleanup refused')
        originals = [root for root in (Path(c['www']), candidate, rollback, recovery_root, original_root)
                     if root.exists() and identity(root) == job['priorIdentity']]
        require(len(originals) == 1, 'Original prior root not uniquely available; all cleanup refused')
        manifest(originals[0], reason + ':original-prior', job['priorFingerprint']['manifestSha256'])
    return {'model': 'proofofwork-ui-protected-deployment-references-v1', 'journals': journals,
            'protected': [{'path': path, 'reasons': reasons} for path, reasons in sorted(protected.items())],
            'scope': 'Reference exclusion only; same lock must remain held through separately approved cleanup'}


def _assert_unreferenced(report, paths):
    for path in paths:
        candidate = Path(path)
        require(candidate.is_absolute() and candidate.resolve(strict=False) == candidate and not candidate.is_symlink(),
                'Noncanonical cleanup candidate')
        for entry in report['protected']:
            protected = Path(entry['path'])
            require(candidate != protected and candidate not in protected.parents and protected not in candidate.parents,
                    'Cleanup candidate intersects protected reference: ' + str(candidate))


def assert_removable(c, fd, paths):
    # Fresh scan under the caller's still-held lock; never accept a cached
    # report as a deletion authority.
    report = references(c, fd)
    _assert_unreferenced(report, paths)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--path', action='append', default=[])
    parser.add_argument('--test-only', action='store_true')
    parser.add_argument('--test-config')
    args = parser.parse_args()
    c = dict(ROOTS)
    if args.test_config:
        require(args.test_only, 'Test override requires --test-only')
        c, _ = read_json(args.test_config)
        require(set(c) == set(ROOTS) and all(str(value).startswith('/tmp/') for value in c.values()), 'Unsafe test root override')
    else:
        require(not args.test_only and os.geteuid() == 0, 'Production reference scan requires root and fixed paths')
    fd, owned = lock(c)
    try:
        report = assert_removable(c, fd, args.path)
        print(json.dumps(report, indent=2))
    finally:
        if owned:
            os.close(fd)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('ui_cleanup_guard status=refused ' + str(error), file=sys.stderr)
        sys.exit(1)
