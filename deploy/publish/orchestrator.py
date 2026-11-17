#!/usr/bin/env python3
"""Creation-only publication phase journal; not release or deletion authority."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

FORMAT = 'proof-ui-phase-journal-v1'
PHASES = ('prepare-closed-input', 'preflight', 'make-plan', 'upload-plan', 'publish')
LIMIT = 8 * 1024**2


def require(ok, message):
    if not ok:
        raise ValueError(message)


def file_identity(s):
    return tuple(getattr(s, k) for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid',
                                       'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def trusted_ancestors(path):
    """Do not freeze directory times; reject replaceable parent namespaces."""
    path = Path(path)
    require(path.is_absolute(), 'Path must be absolute')
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and parent.resolve(strict=True) == parent and
                info.st_uid in (0, os.geteuid()), 'Unsafe ancestor owner or symlink')
        shared_tmp = parent in (Path('/tmp'), Path('/var/tmp')) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o1777
        require(not info.st_mode & 0o022 or shared_tmp, 'Writable ancestor')


def journal_namespace(directory):
    directory = Path(directory)
    require(directory.is_absolute() and directory.is_relative_to('/tmp') and directory != Path('/tmp'),
            'Native outputs require a private journal under /tmp on the VPS')
    trusted_ancestors(directory)
    require(directory.parent.resolve(strict=True) == directory.parent, 'Noncanonical journal parent')


def read(path, limit=LIMIT):
    path = Path(path)
    trusted_ancestors(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Noncanonical input path')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
            before.st_uid == os.geteuid() and not before.st_mode & 0o022 and
            0 <= before.st_size <= limit, 'Unsafe or oversized input')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        require(file_identity(os.fstat(stream.fileno())) == file_identity(before), 'Input changed before read')
        raw = stream.read(limit + 1)
        require(file_identity(os.fstat(stream.fileno())) == file_identity(before), 'Input changed during read')
    require(file_identity(path.lstat()) == file_identity(before) and len(raw) == before.st_size, 'Input changed after read')
    return raw


def pin(path):
    raw = read(path)
    return {'path': str(path), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def verify_pin(record):
    require(set(record) == {'path', 'bytes', 'sha256'}, 'Invalid input pin')
    require(pin(record['path']) == record, 'Input pin changed')


def durable(path, value):
    raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def git_environment():
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null',
               GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1', GIT_NO_REPLACE_OBJECTS='1')
    return env


def source_mode_allowed(actual, git_mode):
    """Native private builds may remove permissions, never add authority."""
    expected = int(git_mode[-3:], 8)
    permissions = stat.S_IMODE(actual)
    return (git_mode in (b'100644', b'100755')
            and bool(permissions & stat.S_IRUSR)
            and bool(permissions & stat.S_IXUSR) == bool(expected & stat.S_IXUSR)
            and not permissions & ~expected)


def source(spec):
    repo = Path(spec['repository'])
    require(repo.is_absolute() and repo.resolve(strict=True) == repo, 'Noncanonical repository')
    def git(*args):
        return subprocess.check_output(['/usr/bin/git', '--no-replace-objects', '-C', str(repo), *args], timeout=30, env=git_environment())
    require(git('rev-parse', 'HEAD').decode().strip() == spec['commit'], 'Source commit changed')
    require(git('rev-parse', 'HEAD^{tree}').decode().strip() == spec['tree'], 'Source tree changed')
    require(not git('status', '--porcelain', '--untracked-files=all'), 'Source checkout is not clean')
    # HEAD alone is not source authority. Check tracked bytes and executable modes,
    # including sparse control checkouts whose excluded paths must fail closed.
    paths, expected, identities = [], [], []
    for row in git('ls-files', '-s', '-z').split(b'\0'):
        if not row:
            continue
        meta, name = row.split(b'\t', 1)
        mode, blob, stage = meta.split()
        require(stage == b'0' and mode in (b'100644', b'100755'), 'Unsupported source entry')
        path = repo / os.fsdecode(name)
        require(path.resolve(strict=True) == path and not any(c in str(path) for c in ('\n', '\r')), 'Unsafe source path')
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid() and
                source_mode_allowed(info.st_mode, mode), 'Source mode or ownership differs')
        paths.append(str(path)); expected.append(blob.decode()); identities.append(file_identity(info))
    actual = subprocess.check_output(['/usr/bin/git', '--no-replace-objects', '-C', str(repo), 'hash-object', '--no-filters', '--stdin-paths'],
                                    input=('\n'.join(paths) + '\n').encode(), timeout=120, env=git_environment()).decode().splitlines()
    require(actual == expected, 'Source bytes differ from Git')
    require([file_identity(Path(p).lstat()) for p in paths] == identities, 'Source changed during verification')
    return repo


INPUTS = {
    'prepare-closed-input': {'buildReceipt'},
    'preflight': {'closedRequest', 'closedInventory'},
    'make-plan': {'buildReceipt', 'preflight'},
    'upload-plan': {'plan'},
    'publish': {'plan'},
}
ROLES = {'node': {'prepare-closed-input', 'make-plan'},
         'ui': {'preflight', 'upload-plan', 'publish'}}


def validate_spec(spec):
    require(set(spec) == {'schema', 'repository', 'commit', 'tree', 'role', 'phase', 'inputs',
                          'attempt', 'privateStaging', 'existingInventory'}, 'Unknown or missing specification field')
    require(spec['schema'] == FORMAT and all(re.fullmatch('[0-9a-f]{40}', spec[k]) for k in ('commit', 'tree')), 'Bad source identity')
    require(spec['role'] in ROLES and spec['phase'] in ROLES[spec['role']], 'Phase is not permitted on this host role')
    require(re.fullmatch('[a-z0-9][a-z0-9-]{0,30}', spec['attempt']), 'Bad attempt')
    require(type(spec['privateStaging']) is bool and type(spec['existingInventory']) is bool, 'Bad option type')
    require(not spec['privateStaging'] or spec['phase'] == 'prepare-closed-input', 'Unexpected private staging option')
    require(not spec['existingInventory'] or spec['phase'] == 'preflight', 'Unexpected inventory option')
    require(set(spec['inputs']) == INPUTS[spec['phase']], 'Wrong predecessor inputs')
    for record in spec['inputs'].values():
        verify_pin(record)
    inputs = spec['inputs']
    for name in ('buildReceipt', 'closedRequest', 'plan'):
        if name in inputs:
            value = json.loads(read(inputs[name]['path']))
            require(value['commit'] == spec['commit'] and value['tree'] == spec['tree'], 'Input is not this source')
    if 'closedRequest' in inputs:
        require(inputs['closedInventory']['path'] == inputs['closedRequest']['path'] + '.zlib', 'Inventory path differs')
        request = json.loads(read(inputs['closedRequest']['path']))
        require(request['inventorySha256'] == inputs['closedInventory']['sha256'], 'Inventory digest differs')
    if 'plan' in inputs:
        plan = json.loads(read(inputs['plan']['path'], 65536))
        require(plan.get('retentionDeferred') is True and plan.get('frontendOnly') is True and
                plan.get('publicationAttempt') == spec['attempt'] and
                plan.get('inputStorage') == 'deploy-scratch-v1', 'Plan identity or deferred-retention boundary differs')


def command(spec, directory, phase):
    require(phase in PHASES and phase == spec['phase'], 'Phase not supported by this journal; retention and activation are separate')
    require(phase in ROLES.get(spec['role'], set()), 'Phase is not permitted on this host role')
    base = ['/usr/bin/python3', '-I', '-B', str(Path(spec['repository']) / 'deploy/publish/release.py')]
    if spec['role'] == 'ui':
        base.append('--ui-host')
    base += ['--repo', spec['repository']]
    inputs = {key: value['path'] for key, value in spec['inputs'].items()}
    output = directory / (phase + '.output.json')
    if phase == 'prepare-closed-input':
        args = [phase, inputs['buildReceipt'], str(output)]
        if spec['privateStaging']:
            args.append('--private-staging')
    elif phase == 'preflight':
        args = [phase, str(output), '--closed-request', inputs['closedRequest']]
        if spec['existingInventory']:
            args.append('--existing-inventory')
    elif phase == 'make-plan':
        args = [phase, inputs['buildReceipt'], inputs['preflight'], str(output),
                '--attempt', spec['attempt'], '--input-storage', 'deploy-scratch-v1']
    else:
        args = [phase, inputs['plan']]
        if phase == 'publish':
            args.append(str(output))  # Native dispatch log, not a receipt.
    return base + args


def successful_publication(path):
    rows = []
    for line in read(path).splitlines():
        try:
            rows.append(json.loads(line))
        except (ValueError, UnicodeError):
            pass
    require(rows and isinstance(rows[-1], dict) and rows[-1].get('ok') is True and
            rows[-1].get('allPriorRootsPreserved') is True and
            re.fullmatch('[0-9a-f]{64}', rows[-1].get('manifestSha256', '')) and
            re.fullmatch('[0-9a-f]{64}', rows[-1].get('archiveSha256', '')) and
            isinstance(rows[-1].get('newRollbackRoot'), dict), 'Missing final native publication verification')


def output_paths(directory, phase):
    paths = [directory / (phase + '.dispatch.log')]
    if phase != 'upload-plan':
        paths.append(directory / (phase + '.output.json'))
    if phase == 'prepare-closed-input':
        paths.append(directory / (phase + '.output.json.zlib'))
    return paths


def check_history(directory, spec, spec_sha):
    """Only this host's actual invocation is recorded; no imported completed phase."""
    phase = spec['phase']
    for other in set(PHASES) - {phase}:
        require(not (directory / (other + '.intent.json')).exists() and
                not (directory / (other + '.result.json')).exists(), 'Foreign phase in single-phase journal')
    intent = directory / (phase + '.intent.json')
    result = directory / (phase + '.result.json')
    if not intent.exists():
        require(not result.exists(), 'Result without intent')
        return phase
    wanted = {'schema': FORMAT, 'specSha256': spec_sha, 'phase': phase,
              'argv': command(spec, directory, phase)}
    require(json.loads(read(intent)) == wanted, 'Intent changed')
    require(result.exists(), 'Uncertain phase: preserve evidence and reconcile natively; never retry this journal')
    record = json.loads(read(result))
    require(record['exitCode'] == 0 and record['phase'] == phase and
            record['intentSha256'] == pin(intent)['sha256'], 'Failed or invalid phase: native reconciliation required')
    require(set(record) == {'phase', 'intentSha256', 'exitCode', 'outputs'}, 'Unknown result fields')
    expected_paths = output_paths(directory, phase)
    require([r['path'] for r in record['outputs']] == list(map(str, expected_paths)), 'Output list changed')
    for output in record['outputs']:
        verify_pin(output)
    if phase == 'publish':
        successful_publication(directory / (phase + '.output.json'))
    return None


def run_phase(directory, spec, spec_sha, phase):
    journal_namespace(directory)
    validate_spec(spec)
    source(spec)
    require(check_history(directory, spec, spec_sha) == phase, 'Only the next unattempted phase may run')
    argv = command(spec, directory, phase)
    intent = directory / (phase + '.intent.json')
    durable(intent, {'schema': FORMAT, 'specSha256': spec_sha, 'phase': phase, 'argv': argv})
    log_path = directory / (phase + '.dispatch.log')
    # No outer timeout, signals, shell, stream wrapper, or automatic retries.
    # Native dispatch owns its locks, timeout, recovery and resource policy.
    with log_path.open('xb') as log:
        code = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=git_environment()).returncode
        log.flush(); os.fsync(log.fileno())
    if code != 0:
        durable(directory / (phase + '.result.json'), {'phase': phase, 'intentSha256': pin(intent)['sha256'],
                'exitCode': code, 'outputs': []})
        raise ValueError('Native phase failed; preserve evidence and reconcile, no automatic retry')
    source(spec); validate_spec(spec)
    paths = output_paths(directory, phase)
    if phase == 'publish':
        successful_publication(paths[-1])
    outputs = [pin(path) for path in paths]
    durable(directory / (phase + '.result.json'), {'phase': phase, 'intentSha256': pin(intent)['sha256'],
            'exitCode': code, 'outputs': outputs})
    return {'phase': phase, 'nativeExitCode': code, 'nextPhase': check_history(directory, spec, spec_sha),
            'releaseQualified': False, 'retentionHandled': False, 'activationHandled': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('journal', type=Path)
    parser.add_argument('spec', type=Path)
    parser.add_argument('--spec-sha256', required=True)
    parser.add_argument('phase', choices=('status', 'preview', *PHASES))
    args = parser.parse_args()
    os.umask(0o077)
    raw = read(args.spec, 65536)
    sha = hashlib.sha256(raw).hexdigest()
    require(sha == args.spec_sha256, 'Specification hash mismatch')
    spec = json.loads(raw); validate_spec(spec)
    directory = args.journal
    journal_namespace(directory)
    if not directory.exists():
        require(args.phase in ('preview', spec['phase']), 'New journal must begin with its specified phase or preview')
        directory.mkdir(mode=0o700)
    info = directory.lstat()
    require(directory.resolve() == directory and stat.S_ISDIR(info.st_mode) and
            info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700, 'Unsafe journal directory')
    fd = os.open(directory / '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        lock = os.fstat(fd)
        require(stat.S_ISREG(lock.st_mode) and lock.st_nlink == 1 and lock.st_uid == os.geteuid() and
                stat.S_IMODE(lock.st_mode) == 0o600, 'Unsafe journal lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.phase in ('status', 'preview'):
            source(spec)
            result = {'nextPhase': check_history(directory, spec, sha), 'argv': command(spec, directory, spec['phase']), 'freshHostValidation': False,
                      'releaseQualified': False, 'retentionHandled': False, 'activationHandled': False}
        else:
            result = run_phase(directory, spec, sha, args.phase)
        print(json.dumps(result, sort_keys=True))
    finally:
        os.close(fd)


if __name__ == '__main__':
    main()
