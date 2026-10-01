#!/usr/bin/python3 -I
"""Bounded, review-bound Audit 29 cutovers of pre-staged node/UI candidates.

Run with isolated Python under the exact transient systemd unit described in
INVOCATION.md. This controller never stages code, prunes recovery, changes
authority services, or enables/unmasks timers. UI exchange/rollback is delegated
to the reviewed installed publisher; uncertain outcomes retain the timer hold.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import sys
import time
import urllib.request

ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
       'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0', 'GIT_CONFIG_NOSYSTEM': '1',
       'GIT_CONFIG_GLOBAL': '/dev/null'}
KEEP = ['bitcoind.service', 'electrs.service', 'postgresql@16-main.service', 'pg_receivewal@16-main.service']
APPS = ['proofofwork-api-wg.socket', 'proofofwork-api-wg.service',
        'proofofwork-api.service', 'proofofwork-indexer-worker.service']
NODE_TIMERS = ['pg_basebackup@16-main.timer', 'pg_compresswal@16-main.timer',
               'proofofwork-cache-prune.timer', 'proofofwork-node-release-health.timer',
               'proofofwork-node-release-prune.timer', 'proofofwork-postgres-logical-backup.timer',
               'proofofwork-postgres-query-health.timer', 'proofofwork-worker-recovery-watch.timer']
UI_TIMERS = ['proofofwork-ui-release-provenance.timer', 'proofofwork-ui-release-prune.timer',
             'proofofwork-ui-storage-prune.timer']
HELPERS = {
    'node': {'attestor': '/var/tmp/proofofwork-deploy/audit29-tools/attest-node.py',
             'exchange': '/usr/local/sbin/proofofwork-node-release-exchange',
             'publisher': '/usr/local/sbin/proofofwork-node-release-publish'},
    'ui': {'capacity': '/usr/local/sbin/proofofwork-ui-capacity',
           'stager': '/usr/local/sbin/proofofwork-ui-release-stage',
           'provenance': '/usr/local/sbin/proofofwork-ui-release-provenance',
           'retained': '/usr/local/sbin/proofofwork-ui-retained-root',
           'publisher': '/usr/local/sbin/proofofwork-ui-release-publish'}}
FIELDS = ['LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'MainPID',
          'NRestarts', 'ExecMainStartTimestamp', 'ControlGroup']
SCRATCH = Path('/var/tmp/proofofwork-deploy')
ROLLBACKS = Path('/var/backups/proofofwork-ui/rollback-roots')
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
RELEASE = re.compile(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z\Z')


class ControlledStop(RuntimeError):
    """A watchdog/user interruption must never be swallowed as a health retry."""


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def safe_path(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Path is not exact/canonical')
    value = path.lstat()
    require((stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode))
            and value.st_uid == 0 and not value.st_mode & 0o7022, 'Unsafe root-owned path')
    if not directory:
        require(value.st_nlink == 1, 'Evidence/helper must have one physical link')
    return value


def identity(path):
    value = Path(path).lstat()
    require(stat.S_ISDIR(value.st_mode) and Path(path).resolve(strict=True) == Path(path),
            'Exchange root is not a canonical directory')
    return [value.st_dev, value.st_ino]


def file_stamp(value):
    # Reads may update atime. Bind bytes, ownership, mode and mutation clocks.
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
            value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def bound_file(path, expected, *, text=False, limit=2 * 1024**3):
    require(HEX64.fullmatch(expected), 'Expected SHA256 must be exact lowercase hex')
    before = safe_path(path)
    require(before.st_size <= limit, 'File exceeds reviewed size bound')
    digest, chunks, read = hashlib.sha256(), [], 0
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        require(file_stamp(os.fstat(fd)) == file_stamp(before), 'File changed before open')
        while block := os.read(fd, 1024 * 1024):
            read += len(block)
            require(read <= limit, 'File grew beyond bound')
            digest.update(block)
            if text:
                chunks.append(block)
        require(file_stamp(os.fstat(fd)) == file_stamp(before)
                and file_stamp(Path(path).lstat()) == file_stamp(before)
                and read == before.st_size, 'File changed while hashing')
    finally:
        os.close(fd)
    require(digest.hexdigest() == expected, 'Reviewed file hash differs: ' + Path(path).name)
    return b''.join(chunks) if text else expected


def attestation(value):
    parts = value.split()
    require(len(parts) == 5 and HEX40.fullmatch(parts[0]) and HEX40.fullmatch(parts[1])
            and all(re.fullmatch(r'[1-9][0-9]*', x) for x in parts[2:4])
            and HEX64.fullmatch(parts[4]), 'Malformed five-field node attestation')
    return parts


def acceptance(value, commit, tree, runtime=None, current=None):
    candidate = value.get('candidate', {})
    require(value.get('mode') == 'shadow' and value.get('base') == 'http://127.0.0.1:18081'
            and value.get('authority') == 'http://127.0.0.1:18081', 'Cutover acceptance must test the shadow origin')
    require(value.get('ok') is True and value.get('network') == 'livenet'
            and candidate.get('commit') == commit and candidate.get('tree') == tree,
            'Shadow acceptance is not bound to candidate')
    require(runtime is None or candidate.get('runtimeSha256') == runtime, 'Shadow runtime binding differs')
    require(all(value.get('gates', {}).get(k) is True for k in ('ids', 'events', 'parity')),
            'All three strict shadow gates must pass')
    fence = value.get('stableCheckpoint', {})
    require(type(fence.get('height')) is int and 0 <= fence['height'] <= 9007199254740991
            and HEX64.fullmatch(str(fence.get('hash', ''))), 'Missing stable shadow checkpoint')
    completed = dt.datetime.fromisoformat(value['completedAt'].replace('Z', '+00:00'))
    require(completed.tzinfo is not None, 'Acceptance timestamp must include timezone')
    age = ((current or dt.datetime.now(dt.timezone.utc)) - completed).total_seconds()
    require(0 <= age <= 1800, 'Shadow acceptance is stale/future dated')


def classifications(records, existing):
    require(type(records) is list and len(records) <= 16, 'At most sixteen exact roots are supported')
    result = {}
    for record in records:
        root = record.get('root', '')
        require(re.fullmatch(re.escape(str(ROLLBACKS)) + r'/proofofwork-www-pre-[A-Za-z0-9][A-Za-z0-9._-]{0,127}', root),
                'Classification root is not exact/allowlisted')
        require(root not in result and HEX64.fullmatch(str(record.get('manifestSha256', '')))
                and HEX64.fullmatch(str(record.get('treeSha256', ''))), 'Duplicate/malformed root classification')
        require(record.get('classification') == 'retain', 'Classification must preserve recovery')
        result[root] = record
    require(set(result) == set(existing), 'Classification differs from exact existing rollback set')
    return result


def quiet(states):
    for name, value in states.items():
        require(value.get('ActiveState') in ('inactive', 'failed') and value.get('MainPID', '0') == '0',
                'Mutating/backup job is active: ' + name)


def exchange_position(live, stage, old_identity, new_identity):
    if live == old_identity and stage == new_identity:
        return 'unchanged'
    if live == new_identity and stage == old_identity:
        return 'exchanged'
    return 'uncertain'


def timer_restore(before, current):
    require(set(before) == set(current), 'Timer set changed')
    for unit, old in before.items():
        new = current[unit]
        require(new.get('UnitFileState') == old.get('UnitFileState')
                and new.get('ActiveState') == old.get('ActiveState'), 'Timer state/hold changed: ' + unit)


class Controller:
    def __init__(self, args):
        self.args, self.counter, self.phase = args, 0, 'preflight'
        self.mode = 'ui' if args.command in ('ui', 'admit-ui') else 'node'
        self.helpers = HELPERS[self.mode]
        self.before = None
        self.old_identity = self.new_identity = None
        self.old_att = self.new_att = None
        self.lock_fd = None
        self.backup_fd = None
        started = time.monotonic()
        self.deadline = started + 1200
        self.hard_deadline = started + 1740
        self.hashes = {}
        name = ('audit29-admit-' + args.release_id + '-' + args.admission_id
                if args.command == 'admit-ui' else 'audit29-publish-' + args.release_id)
        self.out = (Path('/data') / ('proofofwork-audit29-cutover-' + args.release_id)
                    if self.mode == 'node' else SCRATCH / name)

    def save(self, name, value):
        self.counter += 1
        file = self.out / f'{self.counter:03d}-{name}.json'
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as target:
            json.dump({'at': now(), **value}, target, indent=2)
            target.write('\n'); target.flush(); os.fsync(target.fileno())
        self.sync(self.out)

    @staticmethod
    def sync(path):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def run(self, argv, timeout=90, extra=None):
        self.counter += 1
        output = self.out / f'{self.counter:03d}-command.log'
        bound = min(timeout, self.deadline - time.monotonic())
        require(bound > 0, 'Controller time budget exhausted')
        def limits():
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024**2, 4 * 1024**2))
        with output.open('xb') as target:
            proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=target, stderr=subprocess.STDOUT,
                                    env={**ENV, **(extra or {})}, cwd='/', start_new_session=True,
                                    pass_fds=(() if self.lock_fd is None else (self.lock_fd,)), preexec_fn=limits)
            try:
                code = proc.wait(timeout=bound)
            except BaseException as error:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL); proc.wait(timeout=10)
                if isinstance(error, subprocess.TimeoutExpired):
                    raise RuntimeError('Bounded command timed out: ' + Path(argv[0]).name) from error
                raise
            finally:
                target.flush(); os.fsync(target.fileno())
        require(code == 0, 'Command refused: ' + Path(argv[0]).name + ' exit=' + str(code)
                + ' evidence=' + output.name)
        return output.read_text().strip()

    def state(self, unit, keys=FIELDS):
        return dict(line.split('=', 1) for line in self.run(
            ['/usr/bin/systemctl', 'show', unit, *['--property=' + k for k in keys]], 20).splitlines())

    def snapshot(self):
        timers = NODE_TIMERS if self.mode == 'node' else UI_TIMERS
        return {'timers': {u: self.state(u) for u in timers},
                'jobs': {u: self.state(u) for u in
                         sorted(set([x[:-6] + '.service' for x in timers] + self.args.quiet_unit
                                    + ['proofofwork-postgres-logical-backup.service']))},
                'authorities': {u: self.state(u) for u in KEEP} if self.mode == 'node' else {},
                'apps': {u: self.state(u) for u in APPS} if self.mode == 'node' else {},
                'holds': self.holds()}

    def holds(self):
        root = Path('/etc/proofofwork-retention')
        safe_path(root, True)
        result = {}
        for path in sorted(root.glob('*.hold')):
            value = safe_path(path)
            require(value.st_size <= 65536, 'Hold exceeds metadata bound')
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            bound_file(path, digest, limit=65536)
            result[str(path)] = {'sha256': digest, 'mode': stat.S_IMODE(value.st_mode)}
        return result

    def unchanged_authority_and_holds(self):
        require(self.holds() == self.before['holds'], 'Retention hold changed')
        for unit, old in self.before['authorities'].items():
            current = self.state(unit)
            require(all(current.get(k) == old.get(k) for k in
                        ('LoadState', 'ActiveState', 'MainPID', 'NRestarts', 'ExecMainStartTimestamp')),
                    'Authority service identity changed: ' + unit)

    def quiet_now(self):
        current = self.snapshot()
        quiet(current['jobs'])
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit():
                continue
            try:
                comm = (proc / 'comm').read_text().strip()
            except (FileNotFoundError, ProcessLookupError):
                continue
            require(comm not in ('pg_dump', 'pg_basebackup'), 'Database backup writer still exists')
        if self.mode == 'node':
            require(not list(Path('/data/proofofwork-postgres-backups/logical').glob('.*.dumpset.tmp')),
                    'Temporary logical backup set exists')
        return current

    def setup(self):
        args = self.args
        require(sys.flags.isolated and os.geteuid() == 0, 'Root and python3 -I required')
        require(RELEASE.fullmatch(args.release_id), 'Release ID must be commit12-UTC timestamp')
        if args.command != 'admit-ui':
            require(HEX40.fullmatch(args.commit) and HEX40.fullmatch(args.tree)
                    and args.release_id.startswith(args.commit[:12] + '-'), 'Exact candidate identity differs')
        os.umask(0o077)
        safe_path(self.out.parent, True)
        self.out.mkdir(mode=0o700)  # Refuse overwriting any prior failure/recovery evidence.
        self.sync(self.out.parent)
        hashes = {}
        for record in args.helper_sha:
            key, value = record.split('=', 1)
            require(key in self.helpers and key not in hashes and HEX64.fullmatch(value), 'Unexpected helper binding')
            hashes[key] = value
        required = {'capacity'} if args.command == 'admit-ui' else set(self.helpers)
        require(set(hashes) == required, 'Supply every exact reviewed installed helper hash')
        self.hashes = hashes
        for key, value in hashes.items():
            bound_file(self.helpers[key], value, limit=2 * 1024**2)
        if self.mode == 'ui':
            safe_path(Path('/run/proofofwork-ui'), True)
            lock = Path('/run/proofofwork-ui/deploy.lock')
            safe_path(lock)
            if args.command == 'admit-ui':
                require(args.lock_fd >= 3 and Path('/proc/self/fd/' + str(args.lock_fd)).resolve() == lock,
                        'Admission requires transport parent to retain exact shared deploy lock FD')
                self.lock_fd = args.lock_fd
                require(os.fstat(self.lock_fd) == lock.lstat(), 'Inherited lock identity differs')
            else:
                self.lock_fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
            fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            ENV['POW_UI_DEPLOY_LOCK_FD'] = str(self.lock_fd)
        else:
            # Serialize with the separately reviewed operational installer too.
            lock = Path('/run/proofofwork-audit29-ops.lock')
            self.lock_fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            safe_path(lock)
            fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command != 'admit-ui':
            unit = 'proofofwork-audit29-release-' + args.release_id + '-' + self.mode + '.service'
            managed = self.state(unit, FIELDS + ['KillMode', 'RuntimeMaxUSec'])
            require(managed.get('ActiveState') == 'active' and managed.get('MainPID') == str(os.getpid())
                    and managed.get('KillMode') == 'control-group' and managed.get('RuntimeMaxUSec') == '30min',
                    'Apply requires the exact bounded systemd unit/MainPID/control-group')
            require(any(line.endswith(':' + managed.get('ControlGroup', '\0'))
                        for line in Path('/proc/self/cgroup').read_text().splitlines()), 'Wrong controller cgroup')
        self.save('bindings', {'command': args.command, 'release': args.release_id, 'helpers': hashes,
                               'productionDataChanges': False, 'retentionDeferred': True})

    def rebind_helpers(self):
        for key, expected in self.hashes.items():
            bound_file(self.helpers[key], expected, limit=2 * 1024**2)

    def hold_timers(self):
        self.before = self.quiet_now()
        for unit, value in self.before['timers'].items():
            require(value.get('ActiveState') in ('active', 'inactive'), 'Unexpected timer state: ' + unit)
        if self.mode == 'node':
            require(all(self.before['authorities'][u].get('ActiveState') == 'active' for u in KEEP),
                    'Authority service is unavailable')
            require(all(self.before['apps'][u].get('ActiveState') == 'active' for u in APPS[2:]),
                    'Capture before API/worker stop')
        self.save('before', self.before)
        selected = [u for u, value in self.before['timers'].items() if value['ActiveState'] == 'active']
        self.phase = 'holding-timers'
        if selected:
            self.run(['/usr/bin/systemctl', 'stop', *selected], 60)
        if self.mode == 'node':
            lock = Path('/data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock')
            info = lock.lstat()
            require(stat.S_ISREG(info.st_mode) and lock.resolve(strict=True) == lock
                    and not info.st_mode & 0o7022 and info.st_nlink == 1, 'Unsafe actual backup writer lock')
            self.backup_fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
            require(file_stamp(os.fstat(self.backup_fd)) == file_stamp(info), 'Backup lock identity differs')
            fcntl.flock(self.backup_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        held = self.quiet_now()
        require(all(v['ActiveState'] == 'inactive' for v in held['timers'].values()), 'Timer remains active')
        self.unchanged_authority_and_holds()
        self.save('held', {'units': held, 'previouslyActive': selected})

    def restore_timers(self):
        self.unchanged_authority_and_holds()
        # Release the writer lock before restoring the original timer state.
        if self.backup_fd is not None:
            os.close(self.backup_fd); self.backup_fd = None
        selected = [u for u, value in self.before['timers'].items() if value['ActiveState'] == 'active']
        # Never start a previously inactive timer, even if its persistent unit is enabled.
        if selected:
            self.run(['/usr/bin/systemctl', 'start', *selected], 60)
        after = {u: self.state(u) for u in self.before['timers']}
        timer_restore(self.before['timers'], after)
        self.unchanged_authority_and_holds()
        self.save('timers-restored', {'timers': after})

    def bound_acceptance(self, runtime=None):
        args = self.args
        proof = json.loads(bound_file(args.shadow_receipt, args.shadow_sha256, text=True, limit=4 * 1024**2))
        acceptance(proof, args.commit, args.tree, runtime)
        self.save('shadow-accepted', {'sha256': args.shadow_sha256, 'candidate': proof['candidate'],
                                      'stableCheckpoint': proof['stableCheckpoint'], 'completedAt': proof['completedAt']})

    def attest(self, root):
        return attestation(self.run(['/usr/bin/python3', '-I', '-B', self.helpers['attestor'], str(root)], 180))

    def start_apps(self):
        selected = [u for u in reversed(APPS) if self.before['apps'][u]['ActiveState'] == 'active']
        self.run(['/usr/bin/systemctl', 'start', *selected], 90)
        deadline = min(self.deadline, time.monotonic() + 300)
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=5) as response:
                    require(int(response.headers.get('Content-Length', '0')) <= 65536, 'Health response too large')
                    data = json.loads(response.read(65537))
                if data.get('ready') is True and data.get('lagBlocks') == 0:
                    self.save('ready', {'health': data})
                    self.unchanged_authority_and_holds()
                    return
            except ControlledStop:
                raise
            except Exception:
                pass
            time.sleep(2)
        raise RuntimeError('Production readiness did not recover within 300 seconds')

    def drain(self, roots):
        require(not self.run(['/usr/bin/ss', '-ltnH', 'sport = :8081 or sport = :18081'], 20),
                'Application TCP listener remains')
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit():
                continue
            try:
                cwd = os.readlink(proc / 'cwd')
            except (FileNotFoundError, ProcessLookupError):
                continue
            require(not any(cwd == str(root) or cwd.startswith(str(root) + '/') for root in roots),
                    'Candidate/live checkout process remains')
        query = ("BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; "
                 "SELECT json_build_object('sessions',(SELECT count(*) FROM pg_stat_activity "
                 "WHERE datname=current_database() AND pid<>pg_backend_pid()),'rebuild',(SELECT value "
                 "FROM proof_indexer.meta WHERE key='canonical:rebuild')); ROLLBACK;")
        for attempt in range(6):
            result = self.run(['/usr/bin/runuser', '-u', 'postgres', '--', '/usr/bin/env',
                               'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000',
                               '/usr/bin/psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-d', 'proof_indexer', '-c', query], 35)
            value = json.loads(result)
            rebuild = value.get('rebuild') or {}
            require(rebuild.get('active') is not True and rebuild.get('complete') is True
                    and rebuild.get('status') == 'complete', 'Canonical rebuild is active/incomplete')
            if value['sessions'] == 0:
                self.save('drained', {'sessions': 0, 'attempt': attempt, 'rebuild': rebuild})
                return
            time.sleep(1)
        raise RuntimeError('Other database sessions remain; no session termination is permitted')

    def node(self):
        args = self.args
        live, stage = Path('/opt/proofofwork-api'), Path('/opt/proofofwork-api-stage-' + args.release_id)
        expected = attestation(bound_file(args.candidate_attestation, args.attestation_sha256,
                                         text=True, limit=65536).decode())
        old = attestation(bound_file(args.old_attestation, args.old_attestation_sha256,
                                    text=True, limit=65536).decode())
        require(expected[:2] == [args.commit, args.tree], 'Candidate attestation identity differs')
        bundle = SCRATCH / ('proofofwork-audit5-source-' + args.release_id + '.bundle')
        bound_file(bundle, args.archive_sha256)
        recovery = Path(args.recovery_archive)
        require(recovery.parent == Path('/data/proofofwork-release-backups/managed'), 'Recovery archive is unmanaged')
        bound_file(recovery, args.recovery_sha256)
        provenance = parse_lines(bound_file(str(recovery) + '.provenance', args.recovery_provenance_sha256,
                                           text=True, limit=65536).decode())
        require(provenance.get('format') == 'proof-of-work-node-release-provenance-v2'
                and provenance.get('archive_bytes') == str(recovery.stat().st_size)
                and [provenance.get(k) for k in ('commit', 'tree', 'runtime_entry_count', 'runtime_bytes', 'runtime_sha256')] == old
                and provenance.get('archive_sha256') == args.recovery_sha256
                and provenance.get('archive') == recovery.name, 'Old verified recovery binding differs')
        self.old_att, self.new_att = old, expected
        self.bound_acceptance(expected[4])
        require(self.attest(live) == old and self.attest(stage) == expected, 'Live/staged attestation differs')
        self.old_identity, self.new_identity = identity(live), identity(stage)
        self.save('roots', {'live': self.old_identity, 'stage': self.new_identity, 'old': old, 'candidate': expected,
                            'recoveryArchive': str(recovery), 'recoverySha256': args.recovery_sha256})
        self.hold_timers()
        shadow = self.state(args.shadow_unit)
        if shadow.get('LoadState') == 'loaded':
            self.run(['/usr/bin/systemctl', 'stop', args.shadow_unit], 60)
        require(self.state(args.shadow_unit).get('ActiveState') == 'inactive', 'Shadow unit still active')
        self.phase = 'stopping-apps'; self.save('phase', {'phase': self.phase})
        self.run(['/usr/bin/systemctl', 'stop', *APPS], 120)
        quiet({u: self.state(u) for u in APPS})
        self.drain((live, stage)); self.quiet_now(); self.unchanged_authority_and_holds()
        self.rebind_helpers()
        require(self.attest(live) == old and self.attest(stage) == expected, 'Tree drift immediately before exchange')
        self.sync(live); self.sync(stage)
        self.phase = 'exchange-uncertain'; self.save('phase', {'phase': self.phase})
        result = self.run([self.helpers['exchange'], '--release-id', args.release_id], 60)
        require('status=exchanged' in result and self.attest(live) == expected and self.attest(stage) == old,
                'Atomic exchange verification failed')
        self.phase = 'exchanged'; self.save('exchange', {'result': result, 'oldRecoveryRoot': str(stage)})
        # Restore service immediately after the bound pair is verified. Archive
        # reconstruction may be lengthy and does not need an API outage.
        self.start_apps()
        require(self.attest(live) == expected and self.attest(stage) == old, 'Post-start tree drift')
        # The installed node publisher reconstructs its archive from the attested
        # live tree. The request is a trigger, never a claimed candidate archive.
        request = SCRATCH / ('proofofwork-node-release-' + args.commit[:12] + '-' + args.release_id[13:] + '.tgz')
        with request.open('xb') as target:
            target.write(b'Audit 29 archive reconstruction request; source bundle hash retained in receipt.\n')
            target.flush(); os.fsync(target.fileno())
        archive = self.run([self.helpers['publisher'], str(request)], 600)
        published = [line for line in archive.splitlines() if line.startswith('published ')]
        require(len(published) == 1, 'Missing unique managed archive publication receipt')
        fields = dict(item.split('=', 1) for item in published[0][10:].split())
        require(fields.get('commit') == expected[0] and fields.get('tree') == expected[1]
                and fields.get('runtime_sha256') == expected[4], 'Published archive attestation differs')
        final = Path('/data/proofofwork-release-backups/managed') / request.name
        require(fields.get('archive') == request.name, 'Managed archive name differs')
        bound_file(final, fields.get('sha256', ''))
        self.save('archive-published', {'result': archive, 'candidateBundleSha256': args.archive_sha256,
                                       'oldRecoveryArchivePreserved': str(recovery)})
        require(self.attest(live) == expected and self.attest(stage) == old, 'Post-start tree drift')
        self.phase = 'complete'

    def fingerprint(self, root):
        # Reuse only the audited function of the exact hash-bound installed helper.
        # Its CLI permits retained roots; this additional fixed /var/www binding
        # never enables test roots or changes publisher provenance verification.
        namespace = {'__name__': '_reviewed_retained_fingerprint'}
        source = bound_file(self.helpers['retained'], self.hashes['retained'], text=True, limit=2 * 1024**2)
        exec(compile(source, self.helpers['retained'], 'exec'), namespace)
        return namespace['fingerprint'](root)

    def capacity(self, additional=0, inodes=0):
        # Charge conservative controller receipt/log and directory overhead too.
        additional += 8 * 1024**2
        inodes += 32
        result = self.run(['/usr/bin/python3', '-I', '-B', self.helpers['capacity'], 'check-scratch',
                           '--path', str(SCRATCH), '--additional-bytes', str(additional),
                           '--phase', 'audit29-' + self.args.command], 120)
        self.save('scratch-admitted', {'capacity': json.loads(result)})
        self.run(['/usr/bin/python3', '-I', '-B', self.helpers['capacity'], 'check', '--path', str(SCRATCH),
                  '--additional-bytes', str(additional), '--additional-inodes', str(inodes),
                  '--phase', 'audit29-' + self.args.command], 120)

    def ui(self):
        args = self.args
        self.capacity()
        live = Path('/var/www')
        archive = Path('/var/backups/proofofwork-ui/releases/proofofwork-ui-release-' + args.release_id + '.tgz')
        source = SCRATCH / ('proofofwork-ui-source-' + args.release_id)
        stage = SCRATCH / ('proofofwork-www-stage-' + args.release_id)
        bound_file(archive, args.archive_sha256)
        candidate = json.loads(bound_file(args.candidate_attestation, args.attestation_sha256, text=True, limit=65536))
        require(candidate.get('commit') == args.commit and candidate.get('tree') == args.tree
                and candidate.get('archiveSha256') == args.archive_sha256, 'UI build attestation differs')
        self.bound_acceptance()
        old = self.fingerprint(live)
        require(old['manifestSha256'] == args.old_manifest_sha256 and old['treeSha256'] == args.old_tree_sha256,
                'Live UI full-root fingerprint differs')
        records = json.loads(bound_file(args.classifications, args.classifications_sha256, text=True, limit=65536))
        retained = classifications(records, [str(p) for p in ROLLBACKS.glob('proofofwork-www-pre-*')])
        for root, record in retained.items():
            self.run([self.helpers['retained'], root, '--manifest-sha256', record['manifestSha256'],
                      '--tree-sha256', record['treeSha256']], 130)
        self.run([self.helpers['provenance'], 'verify-rollback'], 180)
        self.run([self.helpers['provenance'], 'verify-candidate', '--release-id', args.release_id,
                  '--commit', args.commit, '--source-checkout', str(source), '--archive', str(archive)], 300)
        self.old_identity, self.new_identity = identity(live), identity(stage)
        self.save('roots', {'old': old, 'live': self.old_identity, 'stage': self.new_identity, 'retained': retained,
                            'candidateArchiveSha256': args.archive_sha256})
        self.hold_timers()
        require(self.fingerprint(live) == old, 'Live UI drift immediately before exchange')
        self.rebind_helpers()
        self.phase = 'exchange-uncertain'; self.save('phase', {'phase': self.phase})
        argv = [self.helpers['publisher'], '--release-id', args.release_id, '--commit', args.commit,
                '--source-checkout', str(source), '--archive', str(archive), '--defer-verified-retention']
        for root, record in retained.items():
            argv.extend(['--retain-rollback-root', Path(root).name + ':' + record['manifestSha256'] + ':' + record['treeSha256']])
        result = self.run(argv, 600)
        self.phase = 'published'
        recovery = ROLLBACKS / ('proofofwork-www-pre-' + args.release_id)
        require('status=published' in result and identity(live) == self.new_identity
                and identity(recovery) == self.old_identity and self.fingerprint(recovery)['treeSha256'] == old['treeSha256'],
                'Published UI/recovery identity differs')
        bound_file(archive, args.archive_sha256)
        self.run([self.helpers['provenance'], 'verify'], 180)
        manifest = parse_lines(Path('/var/www/.proofofwork-ui-release').read_text())
        require(manifest.get('commit') == args.commit and manifest.get('source_tree') == args.tree
                and manifest.get('archive_sha256') == args.archive_sha256, 'Published UI manifest binding differs')
        require(Path('/var/www/.proofofwork-ui-release').read_bytes() == Path(str(archive) + '.provenance').read_bytes(),
                'Live UI and archive provenance differ')
        self.unchanged_authority_and_holds()
        self.save('published', {'result': result, 'recoveryRoot': str(recovery), 'retentionDeferred': True})
        self.phase = 'complete'

    def recover(self):
        # Grant one bounded recovery window independent of the failed cutover.
        self.deadline = min(self.hard_deadline, time.monotonic() + 480)
        require(self.deadline > time.monotonic(), 'Hard controller lifetime exhausted; inspect held state')
        signal.alarm(max(1, math.ceil(self.deadline - time.monotonic())))
        if self.mode == 'node' and self.old_identity is not None:
            live = Path('/opt/proofofwork-api')
            stage = Path('/opt/proofofwork-api-stage-' + self.args.release_id)
            position = exchange_position(identity(live), identity(stage), self.old_identity, self.new_identity)
            self.save('failure-root-position', {'position': position, 'phase': self.phase})
            if position == 'exchanged':
                require(self.attest(live) == self.new_att and self.attest(stage) == self.old_att,
                        'Rollback trees are no longer the bound pair')
                self.unchanged_authority_and_holds()
                self.rebind_helpers()
                self.run(['/usr/bin/systemctl', 'stop', *APPS], 120)
                quiet({u: self.state(u) for u in APPS})
                self.drain((live, stage))
                result = self.run([self.helpers['exchange'], '--release-id', self.args.release_id], 60)
                require(self.attest(live) == self.old_att and self.attest(stage) == self.new_att,
                        'Rollback exchange verification failed')
                self.save('rollback', {'result': result, 'oldLiveRestored': True, 'failedCandidatePreserved': str(stage)})
                position = 'unchanged'
            require(position == 'unchanged', 'Uncertain exchange; leave applications and timers held for inspection')
            if self.before is not None:
                self.start_apps()
            self.phase = 'rolled-back'
        elif self.mode == 'ui' and self.old_identity is not None:
            live = Path('/var/www')
            restored = identity(live) == self.old_identity
            if restored:
                fingerprint = self.fingerprint(live)
                require(fingerprint['manifestSha256'] == self.args.old_manifest_sha256
                        and fingerprint['treeSha256'] == self.args.old_tree_sha256, 'UI rollback fingerprint differs')
                self.run([self.helpers['provenance'], 'verify-rollback'], 180)
                self.phase = 'rolled-back'
            self.save('publisher-rollback-observed', {'oldLiveRestoredAndVerified': restored,
                                                     'phase': self.phase, 'automaticSecondExchange': False})
            require(restored, 'Publisher outcome needs inspection; recovery evidence and timer hold preserved')
        elif self.before is not None:
            self.phase = 'pre-exchange-refused'

    def execute(self):
        self.setup()
        if self.args.command == 'admit-ui':
            self.capacity(self.args.additional_bytes, self.args.additional_inodes)
            self.save('admission-complete', {'transportPerformed': False, 'lockMustBeHeldByTransport': True})
            return
        failure = None
        try:
            self.node() if self.mode == 'node' else self.ui()
        except Exception as error:
            failure = error
            self.save('failure', {'phase': self.phase, 'error': str(error)})
            try:
                self.recover()
            except Exception as recovery_error:
                self.phase = 'inspection-required'
                self.save('recovery-refused', {'error': str(recovery_error), 'timersRemainHeld': self.before is not None})
        if self.before is not None and self.phase in ('complete', 'rolled-back', 'pre-exchange-refused'):
            self.deadline = min(self.hard_deadline, time.monotonic() + 120)
            signal.alarm(max(1, math.ceil(self.deadline - time.monotonic())))
            self.save('timer-restoration-intent', {'phase': self.phase})
            try:
                self.restore_timers()
            except Exception as error:
                self.phase = 'timer-restoration-failed'
                self.save('timer-restoration-failed', {'error': str(error), 'requiresInspection': True})
                failure = failure or error
        self.save('final', {'ok': failure is None, 'phase': self.phase, 'commit': self.args.commit,
                            'authorityServicesModified': False, 'recoveryRemoved': False})
        if failure is not None:
            raise RuntimeError('Cutover failed; inspect durable receipts at ' + str(self.out)) from failure


def parse_lines(text):
    result = {}
    for line in text.splitlines():
        require('=' in line, 'Malformed provenance line')
        key, value = line.split('=', 1)
        require(key and key not in result, 'Duplicate provenance field')
        result[key] = value
    return result


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    sub = root.add_subparsers(dest='command', required=True)
    for command in ('node', 'ui', 'admit-ui'):
        p = sub.add_parser(command)
        p.add_argument('--release-id', required=True)
        p.add_argument('--helper-sha', action='append', default=[], metavar='NAME=SHA256')
        p.add_argument('--quiet-unit', action='append', default=[], help='Additional reviewed mutating service; must be quiet')
        if command == 'admit-ui':
            p.add_argument('--additional-bytes', type=int, required=True)
            p.add_argument('--additional-inodes', type=int, required=True)
            p.add_argument('--admission-id', required=True, help='Unique transport/extraction phase, never reused')
            p.add_argument('--lock-fd', type=int, required=True, help='Parent transport must retain inherited deploy lock FD')
            continue
        for name in ('commit', 'tree', 'candidate-attestation', 'attestation-sha256', 'archive-sha256',
                     'shadow-receipt', 'shadow-sha256'):
            p.add_argument('--' + name, required=True)
        if command == 'node':
            for name in ('old-attestation', 'old-attestation-sha256', 'recovery-archive', 'recovery-sha256',
                         'recovery-provenance-sha256', 'shadow-unit'):
                p.add_argument('--' + name, required=True)
        else:
            for name in ('old-manifest-sha256', 'old-tree-sha256', 'classifications', 'classifications-sha256'):
                p.add_argument('--' + name, required=True)
    return root


def main():
    args = parser().parse_args()
    for unit in args.quiet_unit + ([args.shadow_unit] if args.command == 'node' else []):
        require(re.fullmatch(r'[A-Za-z0-9@_.:-]+\.service', unit) and unit not in KEEP + APPS,
                'Unexpected additional/shadow unit')
    if args.command == 'node':
        require(args.shadow_unit == 'proofofwork-audit29-shadow-' + args.release_id + '.service',
                'Shadow unit must be release-bound')
    if args.command == 'admit-ui':
        require(0 < args.additional_bytes <= 5 * 1024**3 and 0 < args.additional_inodes <= 100000,
                'Conservative upcoming allocation is required')
        require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,40}', args.admission_id), 'Admission phase must be an exact unique name')
    def interrupted(signum, frame):
        raise ControlledStop('Controller interrupted by signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGALRM, interrupted)
    signal.alarm(1200)
    controller = Controller(args)
    try:
        controller.execute()
        print(json.dumps({'ok': True, 'phase': controller.phase, 'receipts': str(controller.out)}))
    finally:
        signal.alarm(0)
        if controller.backup_fd is not None:
            os.close(controller.backup_fd)
        if controller.lock_fd is not None:
            os.close(controller.lock_fd)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('audit29_release refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
