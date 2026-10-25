#!/usr/bin/python3 -I
"""Reconcile exact already-absent historical holds; preserve the original checker."""
import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path('/var/lib/proofofwork-monitoring-reconciliation/20261024')
HELD = Path('/etc/proofofwork-retention/audit28-held-review.json')
HELD_SHA = 'c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9'
EXPECTED_POLICY_SHA256 = None  # Scoped installer binds the exact policy bytes.
ISSUE = 'historical-held-path-missing-or-retirement-invalid'
TARGETS = {
    'ui': [
        '/var/tmp/proofofwork-deploy/' + name for name in (
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
            'profile-ui-publish-config.json')],
    'node': [
        '/var/tmp/proofofwork-deploy/' + name for name in (
            'incb-guarded-cutover-f4ca769.py',
            'proofofwork-audit5-source-5970b26e610b-20260926T224701Z.bundle',
            'proofofwork-audit5-source-9d04fd3cf1f6-20260927T094716Z.bundle',
            'proofofwork-audit5-source-b752518bf8b4-20260927T014810Z.bundle',
            'proofofwork-audit5-source-bf81f9cffcc7-20260927T093457Z.bundle',
            'proofofwork-audit5-source-f4ca769e9202-20260927T055111Z.bundle',
            'proofofwork-node-release-5970b26-20260926T224701Z.tgz',
            'proofofwork-node-release-9d04fd3-20260927T094716Z.tgz',
            'proofofwork-node-release-b752518-20260927T014810Z.tgz',
            'proofofwork-node-release-bf81f9c-20260927T093457Z.tgz',
            'proofofwork-node-release-bf81f9cffcc7-20260927T093457Z.tgz',
            'proofofwork-node-release-f4ca769-20260927T055111Z.tgz')
    ] + ['/data/proofofwork-release-backups/managed/' + name + suffix
         for name in ('proofofwork-node-release-3bc6c9d-20260929T200136Z.tgz',
                      'proofofwork-node-release-d2c0afa-20260929T160642Z.tgz')
         for suffix in ('', '.provenance', '.sha256')]
}
COUNTERS = {'node': (521, 4, 0), 'ui': (295, 2, 2)}
PREVIOUS_SHA = {
    'node': '0704fb072a96e9462b48c202e988372581301493f8266960b8a4fd32392a842f',
    'ui': 'da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a'}


def need(condition, message):
    if not condition:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def read_safe(path, expected=None, owner=0):
    path = Path(path)
    need(path.is_absolute() and path.resolve(strict=True) == path, 'Noncanonical metadata path')
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == owner and
         not before.st_mode & 0o7022 and before.st_nlink == 1 and
         before.st_size <= 32 * 1024**2, 'Unsafe metadata file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_NOATIME)
    with os.fdopen(fd, 'rb') as stream:
        need(os.fstat(stream.fileno()) == before, 'Metadata changed on open')
        raw = stream.read()
        need(os.fstat(stream.fileno()) == before, 'Metadata changed on read')
    need(path.lstat() == before, 'Metadata changed after read')
    need(expected is None or digest(raw) == expected, 'Metadata hash mismatch')
    return raw


def validate_policy(policy, role, review):
    need(set(policy) == {'schema', 'role', 'authorization', 'qualifiedAt',
                         'previousCheckerSha256', 'heldReviewSha256',
                         'retiredRequirements', 'deletionPerformed',
                         'originalDeletionTimeAndCauseKnown'}, 'Unexpected policy fields')
    need(policy['schema'] == 'pow-historical-requirement-retirement-v1' and
         policy['role'] == role and policy['previousCheckerSha256'] == PREVIOUS_SHA[role] and
         policy['heldReviewSha256'] == HELD_SHA and policy['deletionPerformed'] is False and
         policy['originalDeletionTimeAndCauseKnown'] is False and
         policy['authorization'] == '2026-10-24 user-approved outdated-monitoring reconciliation; keep current runtime, rollback and newest VPS backup',
         'Historical policy identity differs')
    rows = policy['retiredRequirements']
    need(isinstance(rows, list) and len(rows) == len(TARGETS[role]), 'Wrong retirement count')
    needed = {row['path']: row for row in review['retain'] if row['role'] == role}
    actual = {}
    for row in rows:
        need(set(row) == {'path', 'heldRowSha256', 'status'}, 'Unexpected requirement fields')
        path = row['path']
        need(path in TARGETS[role] and path not in actual and path in needed,
             'Expanded or duplicate retirement scope')
        need(row['heldRowSha256'] == digest(encode(needed[path])) and
             row['status'] == 'already-absent-historical-requirement-retired', 'Historical row differs')
        actual[path] = row
    need(set(actual) == set(TARGETS[role]), 'Incomplete retirement scope')


def reconcile(result, role, exists):
    """Keep every other issue; unknown/malformed historical state fails closed."""
    need(result['role'] == role and isinstance(result['issues'], list) and
         result['ok'] == (not result['issues']), 'Invalid prior result')
    held = result['historicalHeldInventory']
    known = {'ok', 'heldPaths', 'approvedRetiredHeldPaths', 'mustRemainPresent',
             'approvedRelocatedHeldPaths', 'mustRemainAtOriginalPath', 'approvedRelocations',
             'unexpectedRelocatedOriginalPathsPresent', 'missingHeldPaths',
             'unexpectedRetiredPathsPresent'}
    known.add('approvedNodeDumpRetirement' if role == 'node' else 'approvedRelocationEvidence')
    need(set(held) == known, 'Prior historical checker schema differs')
    total, retired, relocated = COUNTERS[role]
    need((held['heldPaths'], held['approvedRetiredHeldPaths'], held['approvedRelocatedHeldPaths'],
          held['mustRemainPresent'], held['mustRemainAtOriginalPath']) ==
         (total, retired, relocated, total - retired, total - retired - relocated),
         'Prior retirement counts differ')
    missing = held['missingHeldPaths']
    need(isinstance(missing, list) and len(missing) == len(set(missing)) and
         all(isinstance(path, str) for path in missing), 'Invalid missing-path list')
    need(held['ok'] == (not missing and not held['unexpectedRetiredPathsPresent'] and
         not held['unexpectedRelocatedOriginalPathsPresent'] and
         (role == 'node' or held['approvedRelocationEvidence'].get('ok') is True)),
         'Unexplained prior historical failure')
    need(result['issues'].count(ISSUE) == (0 if held['ok'] else 1), 'Historical issue mismatch')
    appeared = [path for path in TARGETS[role] if exists(path)]
    need(set(TARGETS[role]) - set(missing) == set(appeared), 'Historical observation changed')
    held['missingHeldPaths'] = [path for path in missing if path not in TARGETS[role]]
    held['unexpectedRetiredPathsPresent'] += appeared
    held['approvedRetiredHeldPaths'] += len(TARGETS[role])
    held['mustRemainPresent'] -= len(TARGETS[role])
    held['mustRemainAtOriginalPath'] -= len(TARGETS[role])
    held['historicalRequirementRetirement'] = {
        'policy': str(ROOT / 'policy.json'), 'count': len(TARGETS[role]),
        'paths': TARGETS[role], 'originalDeletionTimeAndCauseKnown': False,
        'deletionPerformedByReconciliation': False}
    held['ok'] = not (held['missingHeldPaths'] or held['unexpectedRetiredPathsPresent'] or
                       held['unexpectedRelocatedOriginalPathsPresent']) and (
                           role == 'node' or held['approvedRelocationEvidence']['ok'])
    if held['ok']:
        result['issues'] = [issue for issue in result['issues'] if issue != ISSUE]
    elif ISSUE not in result['issues']:
        result['issues'].append(ISSUE)
    result['ok'] = not result['issues']
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--role', required=True, choices=['node', 'ui'])
    role = parser.parse_args().role
    try:
        need(os.geteuid() == 0 and sys.flags.isolated, 'Root isolated Python required')
        need(EXPECTED_POLICY_SHA256 is not None, 'Uninstalled policy binding')
        raw = read_safe(ROOT / 'policy.json', EXPECTED_POLICY_SHA256)
        policy = json.loads(raw, object_pairs_hook=unique)
        review = json.loads(read_safe(HELD, HELD_SHA), object_pairs_hook=unique)
        validate_policy(policy, role, review)
        previous = read_safe(ROOT / 'checker-before.py', PREVIOUS_SHA[role])
        namespace = {'__name__': 'preserved_retention_checker',
                     '__file__': str(ROOT / 'checker-before.py')}
        exec(compile(previous, namespace['__file__'], 'exec'), namespace)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = namespace['main']()
        result = json.loads(output.getvalue(), object_pairs_hook=unique)
        need(code == (0 if result['ok'] else 1), 'Prior checker exit mismatch')
        result = reconcile(result, role, os.path.lexists)
        read_safe(ROOT / 'policy.json', EXPECTED_POLICY_SHA256)
        read_safe(ROOT / 'checker-before.py', PREVIOUS_SHA[role])
        print(json.dumps(result))
        return 0 if result['ok'] else 1
    except Exception as error:
        print(json.dumps({'role': role, 'ok': False,
                          'issues': ['historical-reconciliation-policy-invalid'],
                          'error': str(error)}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
