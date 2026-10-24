#!/usr/bin/python3 -I
"""Publish one verified VPS runtime archive; retire exact receipt-bound prior sets."""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ROOT = Path('/opt/proofofwork-api')
BASE = Path('/data/proofofwork-release-backups')
MANAGED = BASE / 'managed'
ACCEPTED = Path('/etc/proofofwork-retention/node-source-overlays.json')
TEMPLATE = BASE / 'restart-readiness-archive-controller-20261022.py'
TEMPLATE_SHA = 'd4c1e87e47e369104603c457a1ab6ceb90443488ad6d2b92c7246b29e563d04e'
VERIFIER = Path('/usr/local/sbin/proofofwork-node-overlay-source-health')
VERIFIER_SHA = 'e93bdaebcdf8af0a13c04e00bc5ca5cefadf3662ae08ecf6e55888008ebba4ea'
TARGETS = ('server/proof-api.mjs', 'server/db/proof-index-reader.mjs')
OLD = tuple('proofofwork-node-release-' + name + '.tgz' for name in (
    '38ac6e2-20261003T042000Z', '527e4cb-20261001T062733Z',
    '53b5b42-20261001T201028Z', '92eb5fb-20261004T111041Z',
    '92eb5fbdaacf-accepted-overlays-20261022T175657Z', '993523c-20260930T045021Z',
    'd4d8887-20261002T013828Z', 'd5a8493-20261003T222517Z', 'eb5e8c7-20261004T005638Z'))
ALIAS_NAME = OLD[4]
ALIAS = BASE / 'restart-readiness-runtime-20261022T175657Z' / ALIAS_NAME


def need(ok, message):
    if not ok:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def metadata(path, links=1, owner=0):
    info = path.lstat()
    need(path.resolve(strict=True) == path and stat.S_ISREG(info.st_mode) and
         info.st_uid == owner and not info.st_mode & 0o7022 and info.st_nlink == links,
         'Unsafe file: ' + str(path))
    return identity(info)


def read(path, expected=None, owner=0, links=1):
    before = metadata(path, links, owner)
    need(before[6] <= 32 * 1024**2, 'Metadata read too large')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        need(identity(os.fstat(stream.fileno())) == before, 'Changed on open')
        raw = stream.read()
        need(identity(os.fstat(stream.fileno())) == before, 'Changed during read')
    need(metadata(path, links, owner) == before, 'Changed after read')
    need(expected is None or sha(raw) == expected, 'Metadata digest differs')
    return raw


def file_sha(path):
    digest = hashlib.sha256()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        while chunk := stream.read(1024**2):
            digest.update(chunk)
    return digest.hexdigest()


def save(path, raw):
    with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600), 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())


def sync_dir(path):
    fd = os.open(path, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def load_verifier():
    namespace = {'__name__': 'reviewed_source_verifier', '__file__': str(VERIFIER)}
    exec(compile(read(VERIFIER, VERIFIER_SHA), str(VERIFIER), 'exec'), namespace)
    return namespace['verify']


def receipt_sources(manifest, receipt, digest, source_commit, directory, baseline):
    need(manifest['sourceCommit'] == receipt['sourceCommit'] == source_commit and
         receipt['manifestSha256'] == digest and receipt['installed'] is True and
         receipt['rolledBack'] is False and receipt['completedAt'] and
         receipt['baselineHead'] == manifest['baselineHead'] == baseline and
         receipt['rollbackRoot'] == str(directory), 'Incomplete/mismatched source release')
    rows = {row['path']: row for row in manifest['sources']}
    completed = {row['path']: row for row in receipt['sources']}
    need(len(rows) == len(manifest['sources']) and len(completed) == len(receipt['sources']) and
         set(rows) == set(completed) == set(TARGETS), 'Expanded API acceptance scope')
    for name in TARGETS:
        need(rows[name]['after'] == completed[name]['after'], 'Source receipt hash differs')
    return rows


def accept_source(args, custody, verify):
    directory = Path(args.receipt_dir)
    need(directory.parent == BASE and directory.resolve(strict=True) == directory,
         'Receipt directory escapes retained release custody')
    manifest_raw = read(directory / 'manifest.json', args.manifest_sha256)
    receipt_raw = read(directory / 'receipt.json')
    previous = read(ACCEPTED)
    accepted = json.loads(previous)
    rows = receipt_sources(json.loads(manifest_raw), json.loads(receipt_raw),
                           args.manifest_sha256, args.source_commit, directory, accepted['baselineHead'])
    overlays = {row['path']: row for row in accepted['overlays']}
    evidence = [{'path': str(directory / 'manifest.json'), 'sha256': sha(manifest_raw)},
                {'path': str(directory / 'receipt.json'), 'sha256': sha(receipt_raw)}]
    for name in TARGETS:
        need(name in overlays, 'Expected prior accepted overlay missing')
        need(overlays[name]['sha256'] == rows[name]['before'], 'Receipt does not extend accepted source')
        read(ROOT / name, rows[name]['after'], owner=ROOT.stat().st_uid)
        overlays[name] = {'path': name, 'sha256': rows[name]['after'],
                          'gitMode': '100755' if (ROOT/name).stat().st_mode & 0o111 else '100644',
                          'evidence': evidence}
    accepted['overlays'] = [overlays[name] for name in sorted(overlays)]
    candidate = custody / 'source-overlays-candidate.json'
    save(candidate, encode(accepted)); verify(manifest=candidate)
    read(ACCEPTED, sha(previous)); save(custody / 'source-overlays-before.json', previous)
    temporary = ACCEPTED.with_name('.node-source-overlays-20261024.tmp')
    save(temporary, encode(accepted)); os.chmod(temporary, 0o644)
    os.replace(temporary, ACCEPTED); sync_dir(ACCEPTED.parent)
    try:
        result = verify()
    except BaseException:
        save(temporary, previous); os.chmod(temporary, 0o644)
        os.replace(temporary, ACCEPTED); sync_dir(ACCEPTED.parent)
        raise
    save(custody / 'source-acceptance.json', encode({'verified': result, 'sourceCommit': args.source_commit,
         'manifest': str(directory/'manifest.json'), 'beforeSha256': sha(previous), 'modifiedRuntimeSource': False}))
    return result


def previous_archive(binding, digest):
    """Subsequent releases may replace only the last verified completion's archive."""
    path = Path(binding)
    need(path.name == 'completion.json' and path.parent.parent == BASE and
         re.fullmatch(r'runtime-latest-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', path.parent.name) and
         re.fullmatch('[0-9a-f]{64}', digest or ''), 'Invalid prior completion binding')
    value = json.loads(read(path, digest))
    archive = Path(value['archive'])
    need(value['receipt'] == str(path) and value['completedAt'] and
         value['localBackupCreated'] is False and value['runtimeSourceModified'] is False and
         re.fullmatch('[0-9a-f]{40}', value['sourceCommit']) and
         path.parent.name.startswith('runtime-latest-' + value['sourceCommit'][:12] + '-') and
         archive.parent == MANAGED and
         re.fullmatch(r'proofofwork-node-release-[0-9a-f]{12}-accepted-overlays-[0-9]{8}T[0-9]{6}Z\.tgz', archive.name) and
         re.fullmatch('[0-9a-f]{64}', value['archiveSha256']) and
         type(value['archiveBytes']) is int and value['archiveBytes'] > 0,
         'Prior completion does not bind one verified managed archive')
    need(metadata(archive)[6] == value['archiveBytes'] and file_sha(archive) == value['archiveSha256'],
         'Prior completed archive differs')
    return value


def inventory(held, accepted, previous=None):
    names = (Path(previous['archive']).name,) if previous else OLD
    alias_name = None if previous else ALIAS_NAME
    need({p.name for p in MANAGED.glob('proofofwork-node-release-*.tgz')} == set(names),
         'Managed archive inventory differs; exact review required')
    protected = {row['path'] for row in held['retain'] if row['role'] == 'node'}
    evidence = {e['path'] for row in accepted['overlays'] for e in row['evidence']}
    result = []
    for name in names:
        path = MANAGED / name; links = 2 if name == alias_name else 1
        facts = metadata(path, links)
        need(facts[6] < 256 * 1024**2, 'Old archive unexpectedly large')
        members = [path, Path(str(path)+'.sha256'), Path(str(path)+'.provenance')]
        need(not any(str(p) in protected or str(p) in evidence for p in members), 'Held/current evidence cannot retire')
        checksum = read(members[1], links=links).decode()
        provenance_raw = read(members[2], links=links)
        pairs = [line.split('=', 1) for line in provenance_raw.decode().splitlines()]
        provenance = dict(pairs)
        need(len(pairs) == len(provenance) and provenance['format'] == 'proof-of-work-node-release-provenance-v2' and
             provenance['archive'] == name and int(provenance['archive_bytes']) == facts[6] and
             checksum == provenance['archive_sha256'] + '  ' + name + '\n' and
             file_sha(path) == provenance['archive_sha256'], 'Old archive identity/checksum differs')
        need(metadata(path, links) == facts, 'Old archive changed')
        if previous:
            need(provenance['archive_sha256'] == previous['archiveSha256'] and
                 facts[6] == previous['archiveBytes'], 'Prior provenance differs from completed archive')
        if name == alias_name:
            need(metadata(ALIAS, 2) == facts and str(ALIAS) not in protected and str(ALIAS) not in evidence,
                 'Unexpected old custody alias')
        result.append({'path': str(path), 'identity': facts, 'sha256': provenance['archive_sha256'],
                       'provenance': provenance, 'checksum': checksum,
                       'sidecarIdentities': [metadata(p, links) for p in members[1:]]})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipt-dir', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--previous-completion')
    parser.add_argument('--previous-completion-sha256')
    parser.add_argument('--create-and-retain-latest', action='store_true', required=True)
    args = parser.parse_args()
    need(os.geteuid() == 0 and sys.flags.isolated and re.fullmatch('[0-9a-f]{40}', args.source_commit) and
         re.fullmatch('[0-9a-f]{64}', args.manifest_sha256), 'Root isolated invocation and exact identities required')
    need(bool(args.previous_completion) == bool(args.previous_completion_sha256), 'Bind both prior completion fields')
    lock = Path('/run/proofofwork-audit29-ops.lock'); metadata(lock)
    with os.fdopen(os.open(lock, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as locked:
        fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(MANAGED.resolve(strict=True) == MANAGED and MANAGED.stat().st_uid == 0 and
             not MANAGED.stat().st_mode & 0o7022, 'Unsafe managed directory')
        need(os.statvfs(MANAGED).f_bavail * os.statvfs(MANAGED).f_frsize > 4 * 1024**3, 'Insufficient headroom')
        previous = previous_archive(args.previous_completion, args.previous_completion_sha256) if args.previous_completion else None
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        custody = BASE / ('runtime-latest-' + args.source_commit[:12] + '-' + stamp)
        custody.mkdir(mode=0o700)
        verify = load_verifier(); source = accept_source(args, custody, verify)
        dependency = subprocess.run(['/usr/bin/python3', '-I', '-B', '/usr/local/sbin/proofofwork-node-dependency-custody-health'],
                                    capture_output=True, text=True, check=True, timeout=30)
        need(json.loads(dependency.stdout)['ok'] is True, 'Dependency custody failed')
        old = inventory(json.loads(read(Path('/etc/proofofwork-retention/audit28-held-review.json'),
                                        'c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9')),
                        json.loads(read(ACCEPTED)), previous)
        template = {'__name__': 'reviewed_archive_controller', '__file__': str(TEMPLATE)}
        exec(compile(read(TEMPLATE, TEMPLATE_SHA), str(TEMPLATE), 'exec'), template)
        before = template['live_model']()
        count, total, runtime_sha = before.split('\t')
        need(int(total) < 8 * 1024**3 and int(count) > 0 and re.fullmatch('[0-9a-f]{64}', runtime_sha), 'Unbounded runtime')
        verify()
        name = 'proofofwork-node-release-' + source['baselineHead'][:12] + '-accepted-overlays-' + stamp + '.tgz'
        archive = custody / name
        with archive.open('xb') as stream:
            archive.chmod(0o600)
            subprocess.run(['tar', '--format=pax', '--acls', '--xattrs', '--numeric-owner', '--hard-dereference',
                            '-czf', '-', '-C', str(ROOT.parent), ROOT.name], stdout=stream, check=True, timeout=180)
            stream.flush(); os.fsync(stream.fileno())
        need(template['archive_model'](archive) == before and template['live_model']() == before,
             'Archive/runtime differs; retain candidate for inspection')
        verify()
        digest = file_sha(archive)
        fields = {'format': 'proof-of-work-node-release-provenance-v2', 'archive': name,
                  'archive_sha256': digest, 'archive_bytes': archive.stat().st_size,
                  'commit': source['baselineHead'], 'tree': source['baselineTree'],
                  'runtime_entry_count': count, 'runtime_bytes': total, 'runtime_sha256': runtime_sha,
                  'commit_time': subprocess.check_output(['git', '-c', f'safe.directory={ROOT}', '-C', str(ROOT),
                                                        'show', '-s', '--format=%cI', 'HEAD'], text=True).strip(),
                  'recorded_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        for suffix, raw in [('.sha256', (digest+'  '+name+'\n').encode()),
                            ('.provenance', ''.join(str(k)+'='+str(v)+'\n' for k,v in fields.items()).encode())]:
            save(MANAGED / (name+suffix), raw)
        need(not (MANAGED/name).exists(), 'Archive destination exists')
        os.rename(archive, MANAGED/name); sync_dir(MANAGED)
        subprocess.run(['/usr/local/sbin/proofofwork-node-release-health'], check=True, timeout=60)
        save(custody/'retirement-plan.json', encode({'policy': 'one-latest-verified-runtime-archive',
             'operatorApproval': '2026-10-24 latest VPS backups only', 'keep': fields, 'retire': old,
             'retireAdditionalHardlink': None if previous else str(ALIAS),
             'previousCompletion': {'path': args.previous_completion, 'sha256': args.previous_completion_sha256} if previous else None,
             'historicalSidecarsPreservedInThisPlan': True}))
        # Re-fence every identity before the first unlink; no broad prune controller.
        for row in old:
            path = Path(row['path']); links = 2 if not previous and path.name == ALIAS_NAME else 1
            need(metadata(path, links) == tuple(row['identity']), 'Old archive changed before retirement')
            for suffix, expected in zip(('.sha256', '.provenance'), row['sidecarIdentities']):
                need(metadata(Path(str(path)+suffix), links) == tuple(expected), 'Old sidecar changed')
        if not previous:
            need(metadata(ALIAS, 2) == metadata(MANAGED/ALIAS_NAME, 2), 'Custody alias changed')
        retired = []
        for row in old:
            path = Path(row['path'])
            for suffix in ('', '.sha256', '.provenance'):
                target = Path(str(path)+suffix); target.unlink(); retired.append(str(target))
        if not previous:
            ALIAS.unlink(); retired.append(str(ALIAS)); sync_dir(ALIAS.parent)
        sync_dir(MANAGED)
        need({p.name for p in MANAGED.glob('proofofwork-node-release-*.tgz')} == {name}, 'Latest-only inventory failed')
        subprocess.run(['/usr/local/sbin/proofofwork-node-release-health'], check=True, timeout=60)
        subprocess.run(['/usr/local/sbin/proofofwork-retention-protection', '--role', 'node'], check=True, timeout=30)
        result = {'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'archive': str(MANAGED/name), 'archiveBytes': fields['archive_bytes'], 'archiveSha256': digest,
                  'runtimeSha256': runtime_sha, 'retired': retired,
                  'retiredArchiveBytes': sum(row['identity'][6] for row in old),
                  'sourceCommit': args.source_commit, 'receipt': str(custody/'completion.json'),
                  'localBackupCreated': False, 'runtimeSourceModified': False}
        save(custody/'completion.json', encode(result)); sync_dir(custody)
        print(json.dumps(result))


if __name__ == '__main__': main()
