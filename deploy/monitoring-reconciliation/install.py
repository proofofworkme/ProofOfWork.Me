#!/usr/bin/python3 -I
"""One-time exact monitor reconciliation; receives reviewed source on stdin."""
import argparse
import base64
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

ROOT = Path('/var/lib/proofofwork-monitoring-reconciliation/20261024')
CHECKER = Path('/usr/local/sbin/proofofwork-retention-protection')
MANIFEST = Path('/etc/proofofwork-retention/node-source-overlays.json')
RUNTIME = Path('/opt/proofofwork-api')
RELEASES = Path('/data/proofofwork-release-backups')
RECEIPTS = [
    ('work-tips-35a93f60e595-20261022T210123Z-20261022T210158Z',
     '53db7f3c9787627dbc675e749b14de6a99b3fdd57c7e4f05fea37c954a0f81fa',
     ['scripts/backfill-proof-indexer.mjs']),
    ('notifications-49ce8edc9747-20261023T173334Z-20261023T173510Z',
     'f908f6cc0ffd53233b4b2b93856aa002f9809c23de31cb417eebbf22d8f021cb',
     ['server/db/proof-index-reader.mjs', 'server/proof-api.mjs'] +
     ['server/' + name + '.mjs' for name in (
         'notification-address-history', 'notification-address-reader', 'notification-cache',
         'notification-dns-authority', 'notification-dns-history', 'notification-dns-relations',
         'notification-id-authority', 'notification-id-scope', 'notification-query', 'notifications')])]


def atomic(path, raw, mode=0o600):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), mode)
        os.replace(name, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def checked_run(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=40)
    if result.returncode:
        raise ValueError('Verification failed: ' + ' '.join(command) + ': ' + result.stdout[-2000:] + result.stderr[-1000:])
    return json.loads(result.stdout)


def sources(helper, verifier_sha):
    read, need, digest, encode = (helper[key] for key in ('read_safe', 'need', 'digest', 'encode'))
    previous = read(MANIFEST)
    value = json.loads(previous)
    rows = {row['path']: row for row in value['overlays']}
    changes = []
    for dirname, expected, targets in RECEIPTS:
        base = RELEASES / dirname
        mraw, rraw = read(base / 'manifest.json', expected), read(base / 'receipt.json')
        manifest, receipt = json.loads(mraw), json.loads(rraw)
        need(receipt['manifestSha256'] == expected and receipt['installed'] is True and
             receipt['rolledBack'] is False and receipt['completedAt'] and
             receipt['sourceCommit'] == manifest['sourceCommit'] and
             receipt['baselineHead'] == manifest['baselineHead'] == value['baselineHead'] and
             receipt['rollbackRoot'] == str(base), 'Release not completely installed')
        source_rows = {row['path']: row for row in manifest['sources']}
        receipt_rows = {row['path']: row for row in receipt['sources']}
        evidence = [{'path': str(base / 'manifest.json'), 'sha256': digest(mraw)},
                    {'path': str(base / 'receipt.json'), 'sha256': digest(rraw)}]
        for name in targets:
            row = source_rows[name]
            need(receipt_rows[name]['after'] == row['after'], 'Source receipt mismatch')
            path = RUNTIME / name
            raw = read(path, row['after'], owner=RUNTIME.stat().st_uid)
            mode = '100755' if path.stat().st_mode & 0o111 else '100644'
            need(name not in rows or rows[name]['sha256'] != digest(raw), 'Expected reconciliation already applied')
            rows[name] = {'path': name, 'sha256': digest(raw), 'gitMode': mode, 'evidence': evidence}
            changes.append({'path': name, 'sha256': digest(raw), 'sourceCommit': manifest['sourceCommit']})
    need(len(changes) == 13, 'Wrong source acceptance scope')
    value['overlays'] = [rows[name] for name in sorted(rows)]
    candidate = ROOT / 'source-overlays-candidate.json'
    atomic(candidate, encode(value), 0o644)
    verifier_path = Path('/usr/local/sbin/proofofwork-node-overlay-source-health')
    namespace = {'__name__': 'reviewed_source_health', '__file__': str(verifier_path)}
    exec(compile(read(verifier_path, verifier_sha), str(verifier_path), 'exec'), namespace)
    tested = namespace['verify'](manifest=candidate)
    need(tested['ok'], 'Candidate source acceptance failed')
    read(MANIFEST, digest(previous))
    atomic(ROOT / 'source-overlays-before.json', previous)
    atomic(MANIFEST, encode(value), 0o644)
    try:
        verified = namespace['verify']()
        need(verified['ok'], 'Installed source acceptance failed')
    except BaseException:
        atomic(MANIFEST, previous, 0o644)
        raise
    completion = {'schema': 'pow-monitor-source-reconciliation-v1', 'completedAt': now(),
                  'sourceFilesModified': False, 'beforeSha256': digest(previous),
                  'afterSha256': digest(encode(value)), 'changes': changes, 'verification': verified}
    atomic(ROOT / 'source-completion.json', encode(completion))
    return completion


def install(role, helper_source, helper):
    read, need, digest, encode = (helper[key] for key in ('read_safe', 'need', 'digest', 'encode'))
    previous = read(CHECKER, helper['PREVIOUS_SHA'][role])
    review = json.loads(read(helper['HELD'], helper['HELD_SHA']))
    targets = set(helper['TARGETS'][role])
    need(not any(os.path.lexists(path) for path in targets), 'Historical target reappeared; review required')
    rows = [row for row in review['retain'] if row['role'] == role and row['path'] in targets]
    need(len(rows) == len(targets), 'Wrong historical inventory coverage')
    policy = {
        'schema': 'pow-historical-requirement-retirement-v1', 'role': role,
        'authorization': '2026-10-24 user-approved outdated-monitoring reconciliation; keep current runtime, rollback and newest VPS backup',
        'qualifiedAt': now(), 'previousCheckerSha256': digest(previous),
        'heldReviewSha256': helper['HELD_SHA'], 'deletionPerformed': False,
        'originalDeletionTimeAndCauseKnown': False,
        'retiredRequirements': [{'path': row['path'], 'heldRowSha256': digest(encode(row)),
                                'status': 'already-absent-historical-requirement-retired'}
                               for row in sorted(rows, key=lambda row: row['path'])]}
    helper['validate_policy'](policy, role, review)
    atomic(ROOT / 'checker-before.py', previous)
    atomic(ROOT / 'policy.json', encode(policy))
    policy_sha = digest(encode(policy))
    need(helper_source.count(b'EXPECTED_POLICY_SHA256 = None') == 1, 'Wrong checker template')
    installed = helper_source.replace(b'EXPECTED_POLICY_SHA256 = None',
                                      ('EXPECTED_POLICY_SHA256 = ' + repr(policy_sha)).encode())
    candidate = ROOT / 'checker-candidate.py'
    atomic(candidate, installed, 0o700)
    result = checked_run(['/usr/bin/python3', '-I', str(candidate), '--role', role])
    need(result['ok'], 'Candidate retention check failed')
    read(CHECKER, digest(previous))
    atomic(CHECKER, installed, 0o755)
    try:
        verified = checked_run([str(CHECKER), '--role', role])
        subprocess.run(['systemctl', 'start', 'proofofwork-retention-protection.service'],
                       check=True, timeout=40, stdout=subprocess.DEVNULL)
        state = subprocess.check_output(['systemctl', 'show', 'proofofwork-retention-protection.service',
                                         '-p', 'Result', '-p', 'ExecMainStatus'], text=True)
        need('Result=success' in state and 'ExecMainStatus=0' in state, 'Service-context verification failed')
    except BaseException:
        atomic(CHECKER, previous, 0o755)
        raise
    completion = {'schema': 'pow-monitor-retention-reconciliation-v1', 'role': role,
                  'completedAt': now(), 'policySha256': policy_sha,
                  'checkerSha256': digest(installed), 'checkerSourceSha256': digest(helper_source),
                  'retiredHistoricalRequirementCount': len(targets),
                  'deletedPaths': [], 'health': verified, 'serviceContext': state.strip().splitlines()}
    atomic(ROOT / 'retention-completion.json', encode(completion))
    return completion


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--role', required=True, choices=['ui', 'node'])
    parser.add_argument('--sources', action='store_true')
    args = parser.parse_args()
    assert os.geteuid() == 0 and sys.flags.isolated
    payload = json.load(sys.stdin)
    helper_source = base64.b64decode(payload['retentionSource'], validate=True)
    helper = {'__name__': 'reviewed_retention_module'}
    exec(compile(helper_source, 'retention.py', 'exec'), helper)
    need = helper['need']
    lock = Path('/run/proofofwork-audit29-ops.lock' if args.role == 'node' else '/run/proofofwork-ui/deploy.lock')
    info = lock.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and
         not info.st_mode & 0o7022 and lock.resolve(strict=True) == lock, 'Unsafe deployment lock')
    fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r+') as locked:
        need(os.fstat(locked.fileno()) == info, 'Lock changed')
        fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ROOT.parent.mkdir(mode=0o700, exist_ok=True)
        parent = ROOT.parent.lstat()
        need(ROOT.parent.resolve(strict=True) == ROOT.parent and stat.S_ISDIR(parent.st_mode) and
             parent.st_uid == 0 and not parent.st_mode & 0o7022, "Unsafe reconciliation parent")
        ROOT.mkdir(mode=0o700, exist_ok=False)
        if args.sources:
            need(args.role == 'node', 'Source reconciliation is node-only')
            source_result = sources(helper, payload['sourceVerifierSha256'])
            print(json.dumps({'source': source_result}), flush=True)
        print(json.dumps({'retention': install(args.role, helper_source, helper)}))


if __name__ == '__main__':
    main()
