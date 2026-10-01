#!/usr/bin/python3 -I
"""Private, hash-bound Audit29 verifier launcher; no environment/log export.

Capture reuses the unchanged Audit5 process/environment functions. Verify runs
only the fixed candidate driver as powadmin in an exact 20-minute managed unit.
The real backup writer lock and original timer state cover the entire attempt.
Only the sanitized driver receipt, hashes/counts and error classes are retained.
"""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import datetime as dt
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import re
import resource
import selectors
import signal
import stat
import subprocess
import sys
import time
import urllib.parse

TOOLS = Path('/var/tmp/proofofwork-deploy/audit29-tools')
PRIVATE_PIN = '99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515'
NODE = '/opt/node-v24.18.0-linux-x64/bin/node'
NODE_PIN = '41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c'
SCRIPT = 'deploy/audit29/verify-candidate.mjs'
OPS_LOCK = Path('/run/proofofwork-audit29-ops.lock')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0',
       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
RELEASE = re.compile(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z\Z')


def require(value):
    if not value:
        raise RuntimeError('PRIVATE_VERIFICATION_REFUSED')


def remaining(deadline, ceiling, reserve=0):
    value = min(ceiling, deadline - time.monotonic() - reserve)
    require(value > 0)
    return value


def stamp(row):
    return (row.st_dev, row.st_ino, row.st_mode, row.st_uid, row.st_gid,
            row.st_nlink, row.st_size, row.st_mtime_ns, row.st_ctime_ns)


def read(path, owner=0, limit=4 * 1024**2, expected=None, mode=None, group=None):
    path = Path(path)
    before = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISREG(before.st_mode)
            and before.st_uid == owner and not before.st_mode & 0o7022 and before.st_nlink == 1
            and before.st_size <= limit and (mode is None or stat.S_IMODE(before.st_mode) == mode)
            and (group is None or before.st_gid == group))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        require(stamp(os.fstat(fd)) == stamp(before))
        raw = bytearray()
        while block := os.read(fd, 65536):
            raw.extend(block); require(len(raw) <= limit)
        require(stamp(os.fstat(fd)) == stamp(before) == stamp(path.lstat()) and len(raw) == before.st_size)
    finally:
        os.close(fd)
    if expected is not None:
        require(HEX64.fullmatch(expected) and hashlib.sha256(raw).hexdigest() == expected)
    return bytes(raw)


def directory(path, owner=0, mode=0o700, group=None):
    row = Path(path).lstat()
    require(Path(path).resolve(strict=True) == Path(path) and stat.S_ISDIR(row.st_mode)
            and row.st_uid == owner and stat.S_IMODE(row.st_mode) == mode
            and (group is None or row.st_gid == group))


def imported(path, expected):
    directory(path.parent, group=0)
    raw = read(path, expected=expected, mode=0o600, group=0)
    namespace = {'__file__': str(path), '__name__': '_reviewed_private_verification_helpers'}
    exec(compile(raw, str(path), 'exec'), namespace)
    return namespace


def runtime_binary():
    node = Path(NODE)
    before = node.lstat()
    read(node, group=0, expected=NODE_PIN, limit=256 * 1024**2)
    require(checked([NODE, '--version']) == 'v24.18.0' and stamp(node.lstat()) == stamp(before))
    return {'path': NODE, 'device': before.st_dev, 'inode': before.st_ino,
            'sha256': NODE_PIN, 'version': 'v24.18.0'}


@contextlib.contextmanager
def operations_lock():
    # Share the exact lock used by the installer and cutover controller. A
    # verification attempt never overlaps either root mutation workflow.
    descriptor = os.open(OPS_LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        read(OPS_LOCK, group=0, mode=0o600, limit=4096)
        require(stamp(os.fstat(descriptor)) == stamp(OPS_LOCK.lstat()))
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def role(mode, release, base):
    require(RELEASE.fullmatch(release))
    if mode == 'shadow':
        require(base == 'http://127.0.0.1:18081')
        return Path('/opt/proofofwork-api-stage-' + release), base
    require(mode == 'production')
    url = urllib.parse.urlsplit(base)
    require(not url.username and not url.password and not url.query and not url.fragment
            and url.path in ('', '/') and
            (base == 'http://127.0.0.1:8081' or url.scheme == 'https' and not url.port
             and url.hostname in ('api.proofofwork.me', 'computer.proofofwork.me', 'proofofwork.me', 'www.proofofwork.me')))
    return Path('/opt/proofofwork-api'), 'http://127.0.0.1:8081'


def verify_capture(manifest, capture_id, api_sha, current, at=None):
    require(manifest.get('format') == 'private-audit5-environments-v1'
            and manifest.get('releaseId') == capture_id and HEX64.fullmatch(api_sha))
    saved = manifest['processes']['api']
    require(saved['environmentSha256'] == api_sha and saved['identityBefore'] == saved['identityAfter']
            == saved['identityFinal'] == current)
    captured = dt.datetime.fromisoformat(manifest['capturedAt'])
    require(captured.tzinfo is not None)
    age = ((at or dt.datetime.now(dt.timezone.utc)) - captured).total_seconds()
    require(0 <= age <= 120)


def readonly_plan(helper, original, release, cwd, authority):
    env, _ = helper['launch_plan']('gate', original, release, 'indexer:parity',
                                  18081 if authority.endswith(':18081') else 8081)
    raw = next((env[k] for k in (b'POW_INDEX_DATABASE_URL', b'PROOF_INDEX_DATABASE_URL', b'DATABASE_URL')
                if env.get(k)), None)
    require(raw is not None)
    parsed = urllib.parse.urlsplit(os.fsdecode(raw))
    require(parsed.scheme in ('postgres', 'postgresql') and parsed.path == '/proof_indexer'
            and not parsed.fragment)
    params = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    options = params.get('options', '')
    params['options'] = options + (' -c default_transaction_read_only=on -c statement_timeout=30000'
                                 ' -c lock_timeout=5000 -c idle_in_transaction_session_timeout=30000')
    url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(params), parsed.fragment))
    env.update({b'POW_INDEX_DATABASE_URL': os.fsencode(url), b'PROOF_INDEX_DATABASE_URL': b'', b'DATABASE_URL': b'',
                b'PWD': os.fsencode(cwd), b'NETWORK': b'livenet', b'POW_API_BASE': authority.encode(),
                b'POW_INDEX_DB_POOL_MAX': b'1', b'POW_INDEX_DB_STATEMENT_TIMEOUT_MS': b'30000',
                b'POW_INDEX_DB_APP_NAME': b'audit29-private-verification-readonly',
                b'POW_ID_AUDIT_API_BASE': authority.encode(), b'POW_ID_AUDIT_ADDRESS_API_BASE': authority.encode(),
                b'POW_ID_AUDIT_PRODUCTION': b'1', b'POW_ID_AUDIT_WRITE_REPORTS': b'0',
                b'POW_ID_AUDIT_RETRIES': b'0', b'POW_ID_AUDIT_TIMEOUT_MS': b'60000',
                b'POW_ID_AUDIT_COVERAGE_TIMEOUT_MS': b'600000', b'POW_INDEX_PARITY_STRICT': b'1',
                b'POW_INDEX_FETCH_TIMEOUT_MS': b'120000', b'POW_INDEX_FETCH_RETRIES': b'0',
                b'COMPUTER_AUDIT_REQUEST_TIMEOUT_MS': b'120000', b'COMPUTER_AUDIT_FRESH_HISTORY': b'0',
                b'MAX_LEDGER_TIP_LAG_BLOCKS': b'0', b'NODE_DISABLE_COMPILE_CACHE': b'1'})
    env.pop(b'NODE_OPTIONS', None)  # The fixed argv owns the exact 1GiB heap bound.
    env.pop(b'NODE_COMPILE_CACHE', None)
    require(len(env.get(b'POW_INTERNAL_VERIFIER_TOKEN', b'')) >= 32)
    return env


def managed(fields, unit, pid, cgroup):
    require(fields.get('ActiveState') == 'active' and fields.get('MainPID') == str(pid)
            and fields.get('KillMode') == 'control-group' and fields.get('RuntimeMaxUSec') == '20min'
            and fields.get('ControlGroup', '').endswith('/' + unit)
            and any(line.endswith(':' + fields['ControlGroup']) for line in cgroup.splitlines()))


def checked(argv, timeout=20, account=None):
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            env=ENV, timeout=timeout, cwd='/', **({} if account is None else
                            {'user': account.pw_uid, 'group': account.pw_gid, 'extra_groups': []}))
    require(result.returncode == 0 and len(result.stdout) <= 65536)
    return result.stdout.decode('ascii').strip()


class ChildFailure(RuntimeError):
    def __init__(self, result):
        self.result = result
        super().__init__('PRIVATE_CHILD_REFUSED')


def stream_child(argv, cwd, env, account, timeout):
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024**2, 4 * 1024**2))
    child = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, user=account.pw_uid,
                             group=account.pw_gid, extra_groups=[], umask=0o077,
                             start_new_session=True, preexec_fn=limits)
    stats = {name: {'bytes': 0, 'hash': hashlib.sha256()} for name in ('stdout', 'stderr')}
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
    selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
    deadline = time.monotonic() + timeout
    def receipt(code, error=None):
        return {'exitCode': code, 'errorClass': error,
                **{name: {'bytes': row['bytes'], 'sha256': row['hash'].hexdigest()}
                   for name, row in stats.items()}}
    try:
        while selector.get_map():
            require(time.monotonic() < deadline)
            for key, _ in selector.select(timeout=min(1, max(0, deadline - time.monotonic()))):
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj); continue
                row = stats[key.data]; row['bytes'] += len(block); row['hash'].update(block)
                require(row['bytes'] <= 1024**2)
        code = child.wait(timeout=max(0.001, deadline - time.monotonic()))
        if code != 0:
            try: os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        return receipt(code)
    except BaseException as error:
        # Do not poll/reap the leader before killing its group: an exited leader
        # can still have a descendant holding these pipes or doing bounded reads.
        try: os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        code = child.wait(timeout=10)
        raise ChildFailure(receipt(code, type(error).__name__)) from None
    finally:
        selector.close(); child.stdout.close(); child.stderr.close()


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument('--private-env-sha256', required=True)
    sub = root.add_subparsers(dest='operation', required=True)
    capture = sub.add_parser('capture'); capture.add_argument('--capture-id', required=True)
    launch = sub.add_parser('verify')
    for key in ('release-id', 'capture-id', 'api-environ-sha256', 'candidate-commit', 'candidate-tree',
                'runtime-sha256', 'script-sha256', 'source-commit', 'source-api-sha256', 'attestor-sha256',
                'ops-installer-sha256', 'attempt', 'base-url', 'wallet-address'):
        launch.add_argument('--' + key, required=True)
    launch.add_argument('--mode', choices=('shadow', 'production'), required=True)
    return root


def main():
    args = parser().parse_args()
    require(sys.flags.isolated and os.getuid() == os.geteuid() == os.getgid() == os.getegid() == 0
            and args.private_env_sha256 == PRIVATE_PIN and RELEASE.fullmatch(args.capture_id))
    os.umask(0o077)
    original = imported(TOOLS / 'private-env.py', PRIVATE_PIN)
    account = pwd.getpwnam('powadmin'); require(account.pw_uid > 0 and account.pw_gid > 0)
    if args.operation == 'capture':
        with contextlib.redirect_stdout(io.StringIO()):
            original['capture'](args.capture_id, account)
        root = Path(original['runroot'](args.capture_id))
        manifest_bytes = original['private_read'](str(root / 'capture.json'))
        manifest = json.loads(manifest_bytes)
        print(json.dumps({'ok': True, 'operation': 'capture', 'directory': str(root),
                          'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
                          'apiEnvironSha256': manifest['processes']['api']['environmentSha256']}))
        return 0
    require(HEX40.fullmatch(args.candidate_commit) and HEX40.fullmatch(args.candidate_tree)
            and HEX40.fullmatch(args.source_commit) and HEX64.fullmatch(args.runtime_sha256)
            and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,24}', args.attempt)
            and args.release_id.startswith(args.candidate_commit[:12] + '-')
            and re.fullmatch(r'[a-zA-Z0-9]{26,100}', args.wallet_address))
    cwd, authority = role(args.mode, args.release_id, args.base_url)
    unit = 'proofofwork-audit29-verify-' + args.release_id + '-' + args.mode + '-' + args.attempt + '.service'
    fields = dict(line.split('=', 1) for line in checked(['/usr/bin/systemctl', 'show', unit,
        '--property=ActiveState', '--property=MainPID', '--property=ControlGroup',
        '--property=KillMode', '--property=RuntimeMaxUSec']).splitlines())
    managed(fields, unit, os.getpid(), Path('/proc/self/cgroup').read_text())
    started = time.monotonic(); normal_deadline = started + 1050; hard_deadline = started + 1140
    def interrupted(signum, frame):
        raise RuntimeError('PRIVATE_VERIFICATION_INTERRUPTED')
    signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted)
    ops = imported(TOOLS / 'install-ops.py', args.ops_installer_sha256)
    attestor = TOOLS / 'attest-node.py'; read(attestor, expected=args.attestor_sha256, mode=0o600)
    capture_root = Path(original['runroot'](args.capture_id)); original['check_root_dir'](str(capture_root))
    manifest = json.loads(original['private_read'](str(capture_root / 'capture.json')))
    current = original['proc_identity']('api', account)
    verify_capture(manifest, args.capture_id, args.api_environ_sha256, current)
    blob = original['private_read'](str(capture_root / 'api.environ'))
    require(hashlib.sha256(blob).hexdigest() == args.api_environ_sha256)
    original_env = original['parse_env'](blob)
    env = readonly_plan(original, original_env, args.release_id, cwd, authority)
    directory(Path('/data'), mode=0o755)
    token = args.release_id + '-' + args.mode + '-' + args.attempt
    evidence = Path('/data/proofofwork-audit29-verify-launch-' + token)
    output = Path('/data/proofofwork-audit29-verify-output-' + token)
    require(not os.path.lexists(evidence) and not os.path.lexists(output))
    capacity = os.statvfs('/data')
    require(capacity.f_bavail * capacity.f_frsize >= 1024**3 + 16 * 1024**2 and capacity.f_favail >= 128)
    evidence.mkdir(mode=0o700); output.mkdir(mode=0o700); os.chown(output, account.pw_uid, account.pw_gid)
    directory(output, account.pw_uid, group=account.pw_gid); original['fsync_dir']('/data')
    def save(name, value):
        original['exclusive_write'](str(evidence / name), (json.dumps(value, indent=2) + '\n').encode())
        original['fsync_dir'](str(evidence))
    result, report, failure = None, None, None
    try:
        with operations_lock(), ops['backup_install_window'](evidence):
            for path in (cwd, cwd / 'deploy', cwd / 'deploy/audit29'):
                details = path.lstat()
                require(path.resolve(strict=True) == path and stat.S_ISDIR(details.st_mode)
                        and details.st_uid == account.pw_uid and not details.st_mode & 0o7022)
            source_hash = read(Path('/opt/proofofwork-api/server/proof-api.mjs'), account.pw_uid,
                               limit=8 * 1024**2, expected=args.source_api_sha256)
            source_att = checked(['/usr/bin/python3', '-I', '-B', str(attestor), '/opt/proofofwork-api'], 180).split()
            candidate_att = checked(['/usr/bin/python3', '-I', '-B', str(attestor), str(cwd)], 180).split()
            require(len(source_att) == len(candidate_att) == 5 and source_att[0] == args.source_commit
                    and candidate_att[:2] == [args.candidate_commit, args.candidate_tree]
                    and candidate_att[4] == args.runtime_sha256)
            require(args.mode != 'production' or source_att == candidate_att)
            read(cwd / SCRIPT, account.pw_uid, expected=args.script_sha256)
            runtime = runtime_binary()
            require(original['proc_identity']('api', account) == current)
            save('intent.json', {'mode': args.mode, 'unit': unit, 'captureId': args.capture_id,
                'captureApiSha256': args.api_environ_sha256, 'sourceIdentity': current,
                'sourceAttestation': source_att, 'candidateAttestation': candidate_att,
                'scriptSha256': args.script_sha256, 'privateEnvironmentHelperSha256': PRIVATE_PIN,
                'opsInstallerSha256': args.ops_installer_sha256, 'rawLogsPersisted': False,
                'runtimeBinary': runtime, 'driverOutput': str(output / 'attempt'), 'directDatabaseWrites': False})
            argv = ['/usr/bin/nice', '-n', '10', NODE, '--max-old-space-size=1024', str(cwd / SCRIPT),
                    '--mode', args.mode, '--base-url', args.base_url, '--authority-base-url', authority,
                    '--output', str(output / 'attempt'), '--wallet-address', args.wallet_address,
                    '--candidate-commit', args.candidate_commit, '--candidate-tree', args.candidate_tree,
                    '--runtime-sha256', args.runtime_sha256]
            require(ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) == 0)
            child_budget = remaining(normal_deadline, 900)
            result = stream_child(argv, cwd, env, account, child_budget)
            save('child-result.json', result)
            require(result['exitCode'] == 0)
            directory(output / 'attempt', account.pw_uid, group=account.pw_gid)
            raw = read(output / 'attempt/receipt.json', account.pw_uid, mode=0o600, group=account.pw_gid)
            report = json.loads(raw)
            require(report.get('ok') is True and report.get('mode') == args.mode
                    and report.get('candidate') == {'commit': args.candidate_commit, 'tree': args.candidate_tree,
                                                   'runtimeSha256': args.runtime_sha256}
                    and report.get('base') == args.base_url.rstrip('/') and report.get('authority') == authority)
            require(original['proc_identity']('api', account) == current and time.monotonic() < hard_deadline)
            # Installer restore uses at most two 15s commands; reserve45s for
            # that finally block and durable receipts inside the hard19m budget.
            final_budget = remaining(hard_deadline, 180, reserve=45)
            require(checked(['/usr/bin/python3', '-I', '-B', str(attestor), str(cwd)],
                            final_budget).split() == candidate_att)
            read(cwd / SCRIPT, account.pw_uid, expected=args.script_sha256)
            require(hashlib.sha256(read(Path('/opt/proofofwork-api/server/proof-api.mjs'), account.pw_uid,
                                       limit=8 * 1024**2)).hexdigest() == hashlib.sha256(source_hash).hexdigest())
            report['privateLauncher'] = {'unit': unit, 'captureId': args.capture_id,
                'captureApiSha256': args.api_environ_sha256, 'sourceIdentity': current,
                'driverReceiptSha256': hashlib.sha256(raw).hexdigest(), 'scriptSha256': args.script_sha256}
        # Acceptance is emitted only after the original backup timer is restored.
        save('accepted-receipt.json', report)
    except BaseException as error:
        failure = type(error).__name__
        if isinstance(error, ChildFailure):
            result = error.result
            save('child-result.json', result)
    finally:
        save('launcher-final.json', {'ok': failure is None, 'errorClass': failure,
             'childResult': result, 'durationSeconds': round(time.monotonic() - started, 3),
             'rawEnvironmentOrErrorsExported': False, 'outputRoot': str(output)})
    print(json.dumps({'ok': failure is None, 'operation': 'verify', 'errorClass': failure,
                      'evidence': str(evidence), 'acceptedReceipt': str(evidence / 'accepted-receipt.json') if failure is None else None}))
    return 0 if failure is None else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        print(json.dumps({'ok': False, 'errorClass': type(error).__name__, 'privateDetailsSuppressed': True}), file=sys.stderr)
        sys.exit(1)
