#!/usr/bin/python3 -I
"""Root-only audit-5 effective-environment capture and fixed-command launcher.

Install this file and shadow-entry.mjs as root:root0600 in a fresh root:root0700
directory. Invoke /usr/bin/python3 -I explicitly. Private environment captures
are created only in /run on the node; never source EnvFiles or print values.
This helper does not stop production, exchange releases, or initialize a DB.
"""
import argparse
import ctypes
import datetime
import hashlib
import json
import os
import pathlib
import pwd
import re
import socket
import stat
import subprocess
import sys

NODE = '/opt/node-v24.18.0-linux-x64/bin/node'
LIVE = '/opt/proofofwork-api'
RELEASE = re.compile(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z\Z')
ENV_KEY = re.compile(rb'[A-Za-z_][A-Za-z0-9_]*\Z')
MAX_ENV = 4 * 1024 * 1024
PROBE_RELEASE = '661e576453ca-20260922T025214Z'
PROBE_COMMIT = '661e576453caddbd622c5c6255d1de0001bf4804'
PROBE_TREE = 'ddb2f6892b448c85334d48a25271b6b4e93b0676'
PROBE_SCRIPT_SHA256 = '84c1d113f57dfc4f5631a11dfce62e5c9f4b0c381f42afa40912a4fe58e8fb4c'
PROBE_OUTPUT_ROOT = '/data/proofofwork-audit5-probe-' + PROBE_RELEASE + '-retry1'
PROBE_OUTPUT = PROBE_OUTPUT_ROOT + '/attempt'
PROBE_OUTPUT_METADATA = 'probe-output-retry1.json'
PROBE_MAX_OUTPUT_BYTES = 192 * 1024**2
PROBE_MIN_FREE_BYTES = 1024**3 + PROBE_MAX_OUTPUT_BYTES
AUX_TXID = '4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359'
EVENTS = {
    3607561: '6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c',
    3621078: '8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc',
    3747805: '9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0',
}
UNITS = {
    'api': ('proofofwork-api.service', 'server/proof-api.mjs', []),
    'worker': ('proofofwork-indexer-worker.service', 'scripts/run-proof-indexer-worker.mjs', ['--loop']),
}
GATES = {
    'check:node-ops': ['scripts/check-node-ops-contract.mjs'],
    'check:work-precision': ['scripts/check-work-precision-contract.mjs'],
    'check:work-precision-v2': ['scripts/check-work-precision-v2.mjs'],
    'check:bond-exact-arithmetic': ['scripts/check-bond-exact-arithmetic.mjs'],
    'check:work-amo-v8': ['scripts/check-work-amo-v8.mjs'],
    'check:work-amo-v8-gates': ['scripts/check-work-amo-v8-gates.mjs'],
    'check:boost-regressions': ['--test', 'scripts/check-boost-regressions.mjs'],
    'check:read-projections': ['--test', 'server/read-projections.test.mjs'],
    'check:api-truth': ['scripts/check-api-truth-contract.mjs'],
    'check:live-data': ['scripts/check-live-data-contract.mjs'],
    'check:server-globals': ['scripts/check-server-free-identifiers.mjs'],
    'check:audit5-data-repair': ['scripts/check-audit5-data-repair-fixtures.mjs'],
    'indexer:audit-work-atoms': ['scripts/backfill-proof-indexer.mjs', '--audit-work-atoms'],
    'indexer:verify-work-atoms-post-bootstrap': ['scripts/backfill-proof-indexer.mjs', '--verify-work-atoms-post-bootstrap'],
    'indexer:parity': ['scripts/check-proof-indexer-parity.mjs'],
    'audit:ledger': ['scripts/audit-ledger-consistency.mjs'],
    'audit:computer-events': ['scripts/audit-computer-events.mjs'],
    'audit:ids': ['scripts/audit-id-registry.mjs'],
    'check:send-prep-regressions': ['scripts/check-send-prep-regressions.mjs'],
    'check:marketplace-regressions:full': ['scripts/check-marketplace-regressions.mjs'],
    'check:mail-regressions': ['scripts/check-mail-regressions.mjs'],
    'check:work-participant-regression': ['scripts/check-work-participant-regression.mjs'],
}
# The package script deliberately runs both commands. Keep each argv fixed and
# execute them in order without a shell, stopping immediately on failure.
SEQUENCED_GATES = {
    'check:index-recovery-behavior': [
        ['--test', 'server/db/canonical-transfer-fee.test.mjs'],
        ['scripts/check-index-recovery-behavior.mjs'],
    ],
}
SHADOW_SWITCHES = (
    'ENABLE_STARTUP_EXPENSIVE_PREWARM', 'ENABLE_GLOBAL_ACTIVITY_CRAWL',
    'ENABLE_SUMMARY_TOKEN_REFRESH', 'ENABLE_API_LEDGER_BACKGROUND_REFRESH',
    'ENABLE_REQUEST_LEDGER_RECOVERY', 'INDEXED_FALLBACK_BACKGROUND_REFRESH',
)


class Refused(Exception):
    pass


def require(ok):
    if not ok:
        raise Refused()


def runroot(release):
    require(bool(RELEASE.fullmatch(release)))
    return '/run/proofofwork-audit5-' + release


def parse_env(blob):
    require(isinstance(blob, bytes) and 0 < len(blob) <= MAX_ENV and blob.endswith(b'\0'))
    result = {}
    for entry in blob[:-1].split(b'\0'):
        key, sep, value = entry.partition(b'=')
        require(sep == b'=' and bool(ENV_KEY.fullmatch(key)) and key not in result)
        result[key] = value
    return result


def scrub_lifecycle(env):
    return {key: value for key, value in env.items()
            if not key.startswith((b'LISTEN_', b'NOTIFY_', b'WATCHDOG_'))
            and key not in (b'INVOCATION_ID', b'JOURNAL_STREAM', b'SYSTEMD_EXEC_PID', b'MANAGERPID')}


def check_root_dir(path, mode=0o700):
    info = os.lstat(path)
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == mode and os.path.realpath(path) == path)
    return info


def private_read(path, limit=MAX_ENV):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_gid == 0
                and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
                and before.st_size <= limit)
        chunks = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
        blob = b''.join(chunks)
        require(len(blob) == before.st_size and len(blob) <= limit)
        return blob
    finally:
        os.close(fd)


def exclusive_write(path, blob):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, 0, 0)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(blob)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def unit_fields(unit):
    fields = ('MainPID', 'ActiveState', 'SubState', 'User', 'Group', 'WorkingDirectory')
    result = subprocess.run(['/usr/bin/systemctl', 'show', unit,
                             *['--property=' + key for key in fields]],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=15, check=False, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    require(result.returncode == 0 and len(result.stdout) < 16384)
    return dict(line.split('=', 1) for line in result.stdout.decode('ascii').splitlines() if '=' in line)


def proc_identity(kind, account):
    unit, script, tail = UNITS[kind]
    fields = unit_fields(unit)
    require(fields.get('ActiveState') == 'active' and fields.get('SubState') == 'running'
            and fields.get('User') == account.pw_name and fields.get('Group') in ('', account.pw_name)
            and fields.get('WorkingDirectory') == LIVE)
    pid = int(fields.get('MainPID', '0'))
    require(pid > 1)
    base = '/proc/' + str(pid)
    status = dict(line.split(':', 1) for line in pathlib.Path(base, 'status').read_text().splitlines() if ':' in line)
    require([int(value) for value in status['Uid'].split()] == [account.pw_uid] * 4
            and [int(value) for value in status['Gid'].split()] == [account.pw_gid] * 4)
    exe = os.readlink(base + '/exe')
    cwd = os.readlink(base + '/cwd')
    require(exe == NODE and cwd == LIVE)
    command = pathlib.Path(base, 'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
    require(command in [[NODE.encode(), (LIVE + '/' + script).encode(), *[arg.encode() for arg in tail]],
                        [NODE.encode(), script.encode(), *[arg.encode() for arg in tail]]])
    cgroups = pathlib.Path(base, 'cgroup').read_text().splitlines()
    require(any(line.split(':', 2)[-1].endswith('/' + unit) for line in cgroups))
    procstat = pathlib.Path(base, 'stat').read_text()
    start_ticks = int(procstat[procstat.rfind(')') + 2:].split()[19])
    require(start_ticks > 0)
    return {'unit': unit, 'pid': pid, 'exe': exe, 'cwd': cwd, 'uid': account.pw_uid,
            'gid': account.pw_gid, 'startTicks': start_ticks, 'cgroups': cgroups}


def capture(release, account):
    directory = runroot(release)
    check_root_dir('/run', 0o755)
    os.mkdir(directory, 0o700)  # Existing or partial captures are never reused.
    os.chown(directory, 0, 0)
    os.chmod(directory, 0o700)
    captured = {}
    for kind in UNITS:
        before = proc_identity(kind, account)
        blob = pathlib.Path('/proc', str(before['pid']), 'environ').read_bytes()
        env = parse_env(blob)
        after = proc_identity(kind, account)
        require(before == after and any(env.get(key) for key in (
            b'POW_INDEX_DATABASE_URL', b'PROOF_INDEX_DATABASE_URL', b'DATABASE_URL')))
        captured[kind] = {'blob': blob, 'identityBefore': before, 'identityAfter': after}
    for kind, saved in captured.items():
        saved['identityFinal'] = proc_identity(kind, account)
        require(saved['identityFinal'] == saved['identityBefore'])
    manifest = {'format': 'private-audit5-environments-v1', 'releaseId': release,
                'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'processes': {}}
    for kind, saved in captured.items():
        blob = saved['blob']
        exclusive_write(directory + '/' + kind + '.environ', blob)
        manifest['processes'][kind] = {key: value for key, value in saved.items() if key != 'blob'}
        manifest['processes'][kind].update(environmentBytes=len(blob), environmentSha256=hashlib.sha256(blob).hexdigest())
    exclusive_write(directory + '/capture.json', (json.dumps(manifest, indent=2) + '\n').encode())
    fsync_dir(directory)
    print(json.dumps({'ok': True, 'operation': 'capture', 'releaseId': release, 'directory': directory,
                      'identities': [captured[kind]['identityFinal'] for kind in UNITS]}))


def prepare_shadow_cache(release, account):
    directory = runroot(release)
    check_root_dir(directory)
    manifest = json.loads(private_read(directory + '/capture.json'))
    require(manifest['format'] == 'private-audit5-environments-v1' and manifest['releaseId'] == release)
    check_root_dir('/data', 0o755)
    cache = '/data/proofofwork-api-cache-shadow-' + release
    os.mkdir(cache, 0o700)
    os.chown(cache, account.pw_uid, account.pw_gid)
    info = os.lstat(cache)
    exclusive_write(directory + '/shadow-cache.json', json.dumps({
        'path': cache, 'dev': info.st_dev, 'inode': info.st_ino, 'uid': account.pw_uid, 'gid': account.pw_gid,
    }).encode())
    fsync_dir(cache)
    fsync_dir(directory)
    fsync_dir('/data')
    print(json.dumps({'ok': True, 'operation': 'prepare-shadow-cache', 'releaseId': release, 'cache': cache}))


def prepare_probe_output(release, account):
    require(release == PROBE_RELEASE)
    directory = runroot(release)
    check_root_dir(directory)
    manifest = json.loads(private_read(directory + '/capture.json'))
    require(manifest['format'] == 'private-audit5-environments-v1' and manifest['releaseId'] == release)
    check_root_dir('/data', 0o755)
    capacity = os.statvfs('/data')
    require(capacity.f_bavail * capacity.f_frsize >= PROBE_MIN_FREE_BYTES and capacity.f_favail >= 512)
    os.mkdir(PROBE_OUTPUT_ROOT, 0o700)
    os.chown(PROBE_OUTPUT_ROOT, account.pw_uid, account.pw_gid)
    info = os.lstat(PROBE_OUTPUT_ROOT)
    exclusive_write(directory + '/' + PROBE_OUTPUT_METADATA, json.dumps({
        'path': PROBE_OUTPUT_ROOT, 'dev': info.st_dev, 'inode': info.st_ino,
        'uid': account.pw_uid, 'gid': account.pw_gid,
    }).encode())
    fsync_dir(PROBE_OUTPUT_ROOT)
    fsync_dir(directory)
    fsync_dir('/data')
    print(json.dumps({'ok': True, 'operation': 'prepare-probe-output', 'releaseId': release,
                      'outputRoot': PROBE_OUTPUT_ROOT, 'output': PROBE_OUTPUT,
                      'maxBytes': PROBE_MAX_OUTPUT_BYTES}))


def launch_plan(mode, original, release, gate=None, api_port=18081):
    runroot(release)
    require(mode in ('readonly-shadow', 'bootstrap-api', 'bootstrap-worker', 'repair-canonical',
                     'repair-atoms', 'gate', 'candidate-probe'))
    require(api_port in (18081, 8081))
    require(mode != 'candidate-probe' or (release == PROBE_RELEASE and api_port == 18081))
    # The probe uses only loopback HTTP and a fixed sudo-allowlisted Core CLI.
    # Do not give it the captured API environment or any service credentials.
    env = {} if mode == 'candidate-probe' else scrub_lifecycle(original)
    # Retain ordinary memory bounds but reject inherited runtime code loaders.
    require(all(re.fullmatch(rb'--(?:max-old-space-size|max-semi-space-size|stack-size)=[1-9][0-9]*', option)
                for option in env.get(b'NODE_OPTIONS', b'').split())
            and not env.get(b'LD_PRELOAD') and not env.get(b'LD_LIBRARY_PATH'))
    env[b'PATH'] = b'/opt/node-v24.18.0-linux-x64/bin:/usr/bin:/bin'
    env[b'PWD'] = ('/opt/proofofwork-api-stage-' + release).encode()
    env[b'NETWORK'] = b'livenet'
    for key in (b'POW_INDEX_REPAIR_CANONICAL_TXIDS', b'POW_INDEX_WORK_ATOMIC_EVENT_REPAIR_APPLY', b'POW_AUDIT5_SHADOW_EXEC'):
        env.pop(key, None)
    if mode == 'readonly-shadow':
        env.update({b'HOST': b'127.0.0.1', b'PORT': b'18081', b'POW_INDEX_DB_POOL_MAX': b'2',
                    b'POW_INDEX_DB_APP_NAME': ('audit5-shadow-' + release).encode(),
                    b'POW_API_CACHE_DIR': ('/data/proofofwork-api-cache-shadow-' + release).encode(),
                    b'POW_AUDIT5_SHADOW_EXEC': b'1'})
        for key in SHADOW_SWITCHES:
            env[key.encode()] = b'0'
        command = None  # Root supplies the reviewed static entrypoint, without secrets.
    elif mode == 'bootstrap-api':
        env.update({b'HOST': b'127.0.0.1', b'PORT': b'18081'})
        command = ['server/proof-api.mjs']
    elif mode == 'bootstrap-worker':
        env[b'POW_API_BASE'] = b'http://127.0.0.1:18081'
        command = ['scripts/run-proof-indexer-worker.mjs', '--once']
    elif mode == 'repair-canonical':
        env[b'POW_INDEX_REPAIR_CANONICAL_TXIDS'] = AUX_TXID.encode()
        command = ['scripts/backfill-proof-indexer.mjs', '--repair-canonical-txids']
    elif mode == 'repair-atoms':
        env[b'POW_INDEX_WORK_ATOMIC_EVENT_REPAIR_APPLY'] = b'1'
        command = ['scripts/backfill-proof-indexer.mjs', '--repair-work-atomic-events']
    elif mode == 'candidate-probe':
        command = ['deploy/audit5/probe-candidate.mjs', '--run', '--output', PROBE_OUTPUT,
                   '--api-port', '18081']
    else:
        require(gate in GATES or gate in SEQUENCED_GATES)
        command = GATES[gate] if gate in GATES else SEQUENCED_GATES[gate]
        env[b'POW_API_BASE'] = ('http://127.0.0.1:' + str(api_port)).encode()
        env[b'POW_NETWORK'] = b'livenet'
        if gate == 'check:marketplace-regressions:full':
            env[b'MARKETPLACE_REGRESSION_MODE'] = b'full'
        if gate == 'check:send-prep-regressions':
            env[b'POW_SEND_PREP_ADDRESS'] = b'19JE7LS6TtQ4uSxu6ivJVZRiJyXXe8qEG3'
            env[b'POW_SEND_PREP_MIN_UTXOS'] = b'1'
        if gate == 'indexer:parity':
            env[b'POW_INDEX_PARITY_STRICT'] = b'1'
        if gate == 'audit:ids':
            env[b'POW_ID_AUDIT_API_BASE'] = env[b'POW_API_BASE']
            env[b'POW_ID_AUDIT_ADDRESS_API_BASE'] = env[b'POW_API_BASE']
            env[b'POW_ID_AUDIT_PRODUCTION'] = b'1'
            env[b'POW_ID_AUDIT_WRITE_REPORTS'] = b'0'
        if gate in ('audit:ledger', 'audit:computer-events'):
            env[b'MAX_LEDGER_TIP_LAG_BLOCKS'] = b'0'
    return env, command


def run_fixed_sequence(commands, cwd, env):
    require(isinstance(commands, list) and len(commands) > 0 and
            all(isinstance(argv, list) and len(argv) > 0 and
                all(isinstance(argument, str) for argument in argv) for argv in commands))
    for argv in commands:
        result = subprocess.run([NODE, *argv], cwd=cwd, env=env, stdin=subprocess.DEVNULL, check=False)
        if result.returncode != 0:
            return result.returncode if result.returncode > 0 else min(255, 128 - result.returncode)
    return 0


def validate_repair_evidence(blob, expected_sha):
    require(bool(re.fullmatch(r'[0-9a-f]{64}', expected_sha or '')) and hashlib.sha256(blob).hexdigest() == expected_sha)
    data = json.loads(blob)
    require(data.get('format') == 'proofofwork-audit5-repair-evidence-v1'
            and data.get('database') == 'proof_indexer' and data.get('otherDatabaseSessions') == 0)
    aux = data['aux']
    require(aux['txid'] == AUX_TXID and aux['status'] == 'confirmed' and aux['rawVin'] == 6 and aux['rawVout'] == 2
            and aux['height'] == 962992 and aux['blockIndex'] == 1161
            and aux['blockHash'] == '00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b'
            and len(aux['inputs']) == 5 and len(aux['outputs']) == 0 and len(aux['anchorLinks']) == 5)
    require(data['missingZeroMetadataTxids'] == sorted(EVENTS.values()) and len(data['targetEvents']) == 3
            and {row['event_id'] for row in data['targetEvents']} == set(EVENTS))
    for row in data['targetEvents']:
        payload = row['payload']
        require(EVENTS[row['event_id']] == row['txid'] and row['valid'] is False and row['status'] == 'confirmed'
                and row['kind'] == 'token-listing-sealed-invalid' and row['protocol'] == 'pwt1'
                and row['amount_sats'] == 0
                and all(key not in payload for key in ('amountSubatoms', 'decimals', 'unitScale', 'amountStorageModel', 'precisionModel'))
                and payload['amount'] == '0' and type(payload['amountSats']) is int
                and payload['amountSats'] == 0 and payload['attemptedKind'] == 'seal'
                and payload['reason'] == 'work-amo-v6-listing-already-sealed'
                and payload['reasonCode'] == 'work-amo-v6-listing-already-sealed'
                and payload['saleAuthorization']['version'] == 'pwt-sale-v8')
    # This scope lock supplements, never replaces, the full tracked before/after
    # validator and a fresh parent-owned check of every transient process/DB user.


def safe_candidate(release, account):
    runroot(release)
    candidate = '/opt/proofofwork-api-stage-' + release
    require(os.path.realpath('/opt') == '/opt')
    root = os.lstat(candidate)
    require(stat.S_ISDIR(root.st_mode) and root.st_uid == account.pw_uid and root.st_gid == account.pw_gid
            and not root.st_mode & 0o022 and os.path.realpath(candidate) == candidate)
    for relative in ('server', 'scripts', 'server/db'):
        path = candidate + '/' + relative
        info = os.lstat(path)
        require(stat.S_ISDIR(info.st_mode) and os.path.realpath(path) == path and not info.st_mode & 0o022)
    return candidate


def verify_probe_candidate(candidate, release, account):
    require(release == PROBE_RELEASE)
    environment = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0',
                   'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}

    def git(*arguments):
        result = subprocess.run(['/usr/bin/git', '-c', f'safe.directory={candidate}', '-C', candidate,
                                 *arguments], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, timeout=10, env=environment, check=False)
        return result

    head = git('rev-parse', '--verify', 'HEAD^{commit}')
    tree = git('rev-parse', '--verify', 'HEAD^{tree}')
    detached = git('symbolic-ref', '--quiet', 'HEAD')
    require(head.returncode == 0 and head.stdout.strip().decode('ascii') == PROBE_COMMIT and
            tree.returncode == 0 and tree.stdout.strip().decode('ascii') == PROBE_TREE and
            detached.returncode == 1)
    script = candidate + '/deploy/audit5/probe-candidate.mjs'
    details = os.lstat(script)
    require(stat.S_ISREG(details.st_mode) and details.st_uid == account.pw_uid and
            not details.st_mode & 0o022 and os.path.realpath(script) == script and details.st_nlink == 1)
    descriptor = os.open(script, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(descriptor)
        require((opened.st_dev, opened.st_ino, opened.st_size) ==
                (details.st_dev, details.st_ino, details.st_size))
        digest = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        require(digest.hexdigest() == PROBE_SCRIPT_SHA256 and
                (os.fstat(descriptor).st_dev, os.fstat(descriptor).st_ino,
                 os.fstat(descriptor).st_size) == (details.st_dev, details.st_ino, details.st_size))
    finally:
        os.close(descriptor)


def verify_probe_output(directory, account):
    identity = json.loads(private_read(directory + '/' + PROBE_OUTPUT_METADATA, 4096))
    info = os.lstat(PROBE_OUTPUT_ROOT)
    require(identity == {'path': PROBE_OUTPUT_ROOT, 'dev': info.st_dev, 'inode': info.st_ino,
                         'uid': account.pw_uid, 'gid': account.pw_gid}
            and stat.S_ISDIR(info.st_mode) and info.st_uid == account.pw_uid and
            info.st_gid == account.pw_gid and stat.S_IMODE(info.st_mode) == 0o700 and
            os.path.realpath(PROBE_OUTPUT_ROOT) == PROBE_OUTPUT_ROOT and not os.listdir(PROBE_OUTPUT_ROOT)
            and not os.path.lexists(PROBE_OUTPUT))


def launch(args, account):
    directory = runroot(args.release_id)
    check_root_dir(directory)
    manifest = json.loads(private_read(directory + '/capture.json'))
    require(manifest['format'] == 'private-audit5-environments-v1' and manifest['releaseId'] == args.release_id)
    source = args.source if args.mode == 'gate' else ('api' if args.mode in
                                                       ('readonly-shadow', 'bootstrap-api', 'candidate-probe')
                                                       else 'worker')
    require(source in UNITS)
    blob = private_read(directory + '/' + source + '.environ')
    require(hashlib.sha256(blob).hexdigest() == manifest['processes'][source]['environmentSha256'])
    candidate = safe_candidate(args.release_id, account)
    if args.mode == 'candidate-probe':
        verify_probe_candidate(candidate, args.release_id, account)
        verify_probe_output(directory, account)
    node_info = os.stat(NODE)
    require(stat.S_ISREG(node_info.st_mode) and node_info.st_uid == 0 and not node_info.st_mode & 0o022
            and os.path.realpath(NODE) == NODE)
    version = subprocess.run([NODE, '--version'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, timeout=10, env={'PATH': '/usr/bin:/bin'})
    require(version.returncode == 0 and version.stdout.strip() == b'v24.18.0')
    env, command = launch_plan(args.mode, parse_env(blob), args.release_id, args.gate, args.api_port)
    if args.mode.startswith('repair-'):
        validate_repair_evidence(private_read(directory + '/repair-before.json', 32 * 1024 * 1024), args.repair_before_sha256)
        for unit in ('proofofwork-api.service', 'proofofwork-indexer-worker.service',
                     'proofofwork-api-wg.socket', 'proofofwork-api-wg.service'):
            fields = unit_fields(unit)
            require(fields.get('ActiveState') == 'inactive' and int(fields.get('MainPID', '0')) == 0)
    if args.mode in ('readonly-shadow', 'bootstrap-api'):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 18081))  # The API must still fail if a later bind races.
    if args.mode == 'readonly-shadow':
        cache = os.fsdecode(env[b'POW_API_CACHE_DIR'])
        identity = json.loads(private_read(directory + '/shadow-cache.json'))
        info = os.lstat(cache)
        require(identity == {'path': cache, 'dev': info.st_dev, 'inode': info.st_ino,
                             'uid': account.pw_uid, 'gid': account.pw_gid}
                and stat.S_ISDIR(info.st_mode) and info.st_uid == account.pw_uid and info.st_gid == account.pw_gid
                and stat.S_IMODE(info.st_mode) == 0o700 and os.path.realpath(cache) == cache and not os.listdir(cache))
        entry = private_read(str(pathlib.Path(__file__).resolve().parent / 'shadow-entry.mjs'), 65536).decode('utf-8')
        command = ['--input-type=module', '--eval', entry]
    elif args.mode == 'bootstrap-api':
        require(env.get(b'POW_API_CACHE_DIR') == b'/data/proofofwork-api-cache')
        cache = os.lstat('/data/proofofwork-api-cache')
        require(stat.S_ISDIR(cache.st_mode) and cache.st_uid == account.pw_uid and cache.st_gid == account.pw_gid
                and not cache.st_mode & 0o022 and os.path.realpath('/data/proofofwork-api-cache') == '/data/proofofwork-api-cache')
    os.chdir(candidate)
    os.umask(0o027)
    require(ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) == 0)  # PR_SET_NO_NEW_PRIVS
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    require(os.getuid() == account.pw_uid and os.geteuid() == account.pw_uid
            and os.getgid() == account.pw_gid and os.getegid() == account.pw_gid and os.getgroups() == [])
    status = dict(line.split(':', 1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
    require(status['NoNewPrivs'].strip() == '1' and
            all(int(status[key].strip(), 16) == 0 for key in ('CapEff', 'CapPrm', 'CapInh', 'CapAmb')))
    print(json.dumps({'ok': True, 'operation': 'exec', 'mode': args.mode, 'source': source,
                      'releaseId': args.release_id, 'uid': os.getuid(), 'gid': os.getgid(), 'cwd': candidate, 'node': NODE}), flush=True)
    if args.mode == 'gate' and args.gate in SEQUENCED_GATES:
        return run_fixed_sequence(command, candidate, env)
    os.execve(NODE, [NODE, *command], env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='operation', required=True)
    for name in ('capture', 'prepare-shadow-cache'):
        command = commands.add_parser(name)
        command.add_argument('--release-id', required=True)
    command = commands.add_parser('prepare-probe-output')
    command.add_argument('--release-id', required=True)
    command = commands.add_parser('launch')
    command.add_argument('--release-id', required=True)
    command.add_argument('--mode', required=True, choices=('readonly-shadow', 'bootstrap-api', 'bootstrap-worker',
                                                            'repair-canonical', 'repair-atoms', 'gate', 'candidate-probe'))
    command.add_argument('--source', choices=('api', 'worker'), default='worker')
    command.add_argument('--gate', choices=tuple(GATES) + tuple(SEQUENCED_GATES))
    command.add_argument('--api-port', type=int, choices=(8081, 18081), default=18081)
    command.add_argument('--repair-before-sha256')
    args = parser.parse_args()
    try:
        require(sys.flags.isolated == 1 and os.getuid() == 0 and os.geteuid() == 0)
        os.umask(0o077)
        helper = os.path.abspath(__file__)
        check_root_dir(os.path.dirname(helper))
        private_read(helper, 1024 * 1024)
        account = pwd.getpwnam('powadmin')
        require(account.pw_uid > 0 and account.pw_gid > 0)
        if args.operation == 'capture':
            capture(args.release_id, account)
        elif args.operation == 'prepare-shadow-cache':
            prepare_shadow_cache(args.release_id, account)
        elif args.operation == 'prepare-probe-output':
            prepare_probe_output(args.release_id, account)
        else:
            return launch(args, account) or 0
    except Exception:
        # Exceptions can contain private connection/environment values.
        print('private_environment_helper status=refused (private details suppressed)', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
