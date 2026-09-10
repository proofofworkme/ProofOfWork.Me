#!/usr/bin/python3 -I
"""Manager-owned, same-code worker budget recovery; HTTP units are never stopped.

This narrow adapter cannot deploy a source release. Production use remains
closed until actual systemd/cgroup/database fault certification is supplied.
Its frozen/retired checkpoints require a separately reviewed read-only verifier.
"""
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
import tempfile
import time

sys.dont_write_bytecode = True
UNIT = 'proofofwork-indexer-worker.service'
CGROUP_BASE = '/system.slice'
STATE = Path('/var/lib/proofofwork-worker-recovery')
OVERRIDE = Path('/etc/systemd/system/proofofwork-indexer-worker.service.d/zz-audit6-budget-recovery.conf')
HOLD = Path('/run/systemd/system/proofofwork-indexer-worker.service.d/zzzz-audit6-restart-hold.conf')
MODEL = 'proofofwork-worker-budget-recovery-v1'
TERMINAL = {'committed', 'restored'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def safe(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path and not path.is_symlink(), 'Noncanonical safeguard path')
    value = path.stat()
    require(value.st_uid == os.geteuid() and not value.st_mode & 0o7022 and
            (stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode)), 'Unsafe safeguard path')
    return path


def digest(path):
    return hashlib.sha256(safe(path).read_bytes()).hexdigest()


def source_digest(path, owner):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path and not path.is_symlink(), 'Noncanonical worker source/runtime')
    value = path.stat()
    require(stat.S_ISREG(value.st_mode) and value.st_uid == owner and not value.st_mode & 0o7022,
            'Worker source/runtime owner or mode changed')
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def fsync_parent(path):
    fd = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write(path, data, mode=0o600):
    path = Path(path)
    safe(path.parent, True)
    require(len(data) <= 1024 * 1024, 'Oversized durable worker record')
    fd, name = tempfile.mkstemp(prefix=path.name + '.next-', dir=path.parent)
    require(mode & 0o7022 == 0 and mode & 0o400 and mode & ~0o666 == 0, 'Unsafe recovered override mode')
    os.fchmod(fd, mode)
    with os.fdopen(fd, 'wb') as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    os.replace(name, path)
    fsync_parent(path)


def save(path, job):
    write(path, (json.dumps(job, indent=2) + '\n').encode())


def command(args, timeout=30):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
    require(result.returncode == 0, 'Safeguard command failed: ' + Path(args[0]).name)
    require(len(result.stdout) <= 1024 * 1024, 'Safeguard response exceeds bound')
    return result.stdout.strip()


def systemctl(*args):
    return command(['/usr/bin/systemctl', *args])


def properties(unit, names):
    output = systemctl('show', unit, '--property=' + ','.join(names))
    return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)


def wait_for(predicate, description, seconds=15):
    deadline = time.monotonic() + seconds
    while not predicate():
        require(time.monotonic() < deadline, 'Timed out: ' + description)
        time.sleep(.1)


def candidate_bytes(compact, sql):
    # Incident-only allowance. Retain the API's existing 18 MiB SQL-text limit;
    # a larger compact budget would silently raise the worker SQL minimum.
    require(compact == 17 * 1024 * 1024 and sql == 18 * 1024 * 1024,
            'Only the reviewed temporary 17 MiB compact / 18 MiB SQL budgets are allowed')
    return ('[Service]\nEnvironment=POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES=' + str(compact) +
            '\nEnvironment=POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES=' + str(sql) + '\n').encode()


class SystemdWorker:
    def __init__(self, job):
        self.job = job

    def attest(self):
        identity = self.job['identity']
        require(source_digest(identity['runtime'], identity['runtimeOwner']) == identity['runtimeSha256'], 'Worker runtime changed')
        require(source_digest(identity['sourceFile'], identity['sourceOwner']) == identity['sourceSha256'], 'Worker source changed')
        git = ['/usr/bin/git', '-c', 'safe.directory=' + identity['sourceRoot'], '-C', identity['sourceRoot']]
        require(command([*git, 'rev-parse', 'HEAD']) == identity['sourceCommit'],
                'Worker source commit changed')
        command([*git, 'diff', '--quiet', 'HEAD', '--', 'server', 'scripts'])
        # Pin every prior unit fragment/drop-in, not an inferred tracked template.
        for path, expected in identity['unitFiles'].items():
            require(Path(path) not in {OVERRIDE, HOLD}, 'Adapter overrides must be attested separately')
            require(digest(path) == expected, 'Prior worker unit definition changed')
        actual = properties(UNIT, ['FragmentPath', 'DropInPaths', 'WorkingDirectory'])
        actual_paths = {actual['FragmentPath'], *actual['DropInPaths'].split()} - {str(OVERRIDE), str(HOLD)}
        require(actual_paths == set(identity['unitFiles']) and actual['WorkingDirectory'] == identity['sourceRoot'],
                'Complete active worker unit/source definition differs')
        require(self.job['verifier'] in self.job['helperHashes'], 'Worker verifier must be explicitly hash-pinned')
        require(self.job['verifierManifest'] in self.job['helperHashes'] and
                self.job['helperHashes'][self.job['verifierManifest']] == self.job['verifierManifestSha256'],
                'Worker verifier manifest must be explicitly hash-pinned')
        for path, expected in self.job['helperHashes'].items():
            require(digest(path) == expected, 'Recovery helper changed')

    def current(self):
        return properties(UNIT, ['MainPID', 'ControlGroup', 'KillMode', 'Restart', 'ActiveState', 'SubState'])

    def verify_process(self):
        value = self.current()
        require(value['KillMode'] == 'control-group', 'Worker lacks process-group containment')
        pid = int(value['MainPID'])
        require(pid > 1 and value['ControlGroup'] == CGROUP_BASE + '/' + UNIT, 'Wrong worker cgroup/PID')
        expected = self.job['identity']
        actual = Path('/proc/' + str(pid) + '/cmdline').read_bytes().split(b'\0')
        require(actual == [os.fsencode(expected['runtime']), os.fsencode(expected['sourceFile']), b'--loop', b''],
                'Running process is not the attested worker command')
        require(properties(UNIT, ['WorkingDirectory'])['WorkingDirectory'] == expected['sourceRoot'], 'Running worker source path differs')
        return pid, Path('/sys/fs/cgroup') / value['ControlGroup'].lstrip('/')

    def hold_restart(self):
        if HOLD.exists():
            require(safe(HOLD).read_bytes() == b'[Service]\nRestart=no\n', 'Unknown restart hold')
        else:
            write(HOLD, b'[Service]\nRestart=no\n')
        systemctl('daemon-reload')
        require(self.current()['Restart'] == 'no', 'Manager restart hold was not applied')

    def clear_hold(self):
        if HOLD.exists():
            require(safe(HOLD).read_bytes() == b'[Service]\nRestart=no\n', 'Restart hold changed')
            HOLD.unlink()  # Exact adapter-owned temporary override, never release evidence.
            fsync_parent(HOLD)
        systemctl('daemon-reload')

    def freeze(self):
        pid, group = self.verify_process()
        systemctl('freeze', UNIT)
        wait_for(lambda: 'frozen 1' in (group / 'cgroup.events').read_text().splitlines(), 'complete worker cgroup freeze')
        # cgroup.procs excludes threads and includes all direct worker processes;
        # any nested cgroup is refused, never silently omitted.
        require(not any(path.is_dir() for path in group.iterdir()), 'Unexpected nested worker cgroup')
        pids = [int(value) for value in (group / 'cgroup.procs').read_text().split()]
        require(pids == [pid], 'Active worker children: thaw and retry at a quiescent boundary')
        return pid, group

    def thaw(self):
        state = self.current()
        if state.get('ControlGroup'):
            systemctl('thaw', UNIT)

    def retire_frozen(self, pid, group):
        require(self.current()['Restart'] == 'no', 'Worker could restart during retirement')
        require(self.verify_process() == (pid, group), 'Worker identity changed after freeze')
        require('frozen 1' in (group / 'cgroup.events').read_text().splitlines(), 'Worker thawed before retirement')
        require((group / 'cgroup.procs').read_text().split() == [str(pid)], 'Worker process set changed')
        # Kernel cgroup.kill retires the frozen group without first running any
        # queued Node callback. systemctl stop alone may thaw a frozen service.
        (group / 'cgroup.kill').write_text('1\n')
        wait_for(lambda: not group.exists() or not (group / 'cgroup.procs').read_text().split(), 'old worker cgroup empty')
        systemctl('stop', UNIT)
        require(self.current()['MainPID'] == '0', 'Old worker did not retire')

    def verifier(self, phase, before=None):
        # The root-owned verifier must check real DB sessions/checkpoint, actual
        # Core/mempool fences and API listener continuity. It receives no shell.
        request = {'phase': phase, 'baselineMode': self.job['baselineMode'], 'before': before,
                   'preparedAt': self.job['preparedAt'], 'transitionPhase': self.job['phase'],
                   'retirementOccurredPossible': self.job['phase'] not in {'prepared', 'armed', 'frozen'},
                   'wasFrozenBaseline': 'before' in self.job}
        verifier = self.job['verifier']
        result = subprocess.run([verifier, '--manifest', self.job['verifierManifest'],
                                 '--manifest-sha256', self.job['verifierManifestSha256']],
                                input=json.dumps(request), capture_output=True, text=True,
                                timeout=600 if phase == 'first-complete-cycle' else 60)
        detail = (result.stdout or result.stderr).strip()
        if len(detail) > 700:
            detail = detail[:700]
        require(result.returncode == 0 and len(result.stdout) <= 1024 * 1024,
                'Worker retirement/readiness verifier failed: ' + detail)
        record = json.loads(result.stdout)
        require(record.get('passed') is True and record.get('phase') == phase,
                'Worker verification gate did not pass: ' + detail)
        return record

    def restore_override(self):
        expected = self.job['candidateOverride'].encode()
        prior = self.job['priorOverride']
        if OVERRIDE.exists():
            require(safe(OVERRIDE).read_bytes() in [expected, prior.encode() if prior is not None else b''],
                    'Worker recovery override changed outside this transaction')
        if prior is None:
            if OVERRIDE.exists():
                OVERRIDE.unlink()
                fsync_parent(OVERRIDE)
        else:
            write(OVERRIDE, prior.encode(), self.job['priorOverrideMode'])


def recover(job, path, manager):
    if job['phase'] in TERMINAL or job['phase'] == 'prepared':
        return
    manager.attest()
    # Before old retirement, recovery is just restore-restart-policy + thaw.
    # Once candidate configuration may exist, systemd owns a bounded stop and
    # complete cgroup cleanup, then the exact prior override is restored.
    if job['phase'] in {'armed', 'frozen'}:
        manager.restore_override()
        manager.clear_hold()
        manager.thaw()
        systemctl('start', UNIT)
    else:
        manager.hold_restart()
        manager.thaw()
        systemctl('stop', UNIT)
        require(manager.current()['MainPID'] == '0', 'Candidate group did not stop for recovery')
        manager.restore_override()
        manager.clear_hold()
        systemctl('start', UNIT)
    # systemd can preserve a service cgroup's freezer state across a stop/start
    # at the retirement boundary. Make the post-recovery running state explicit
    # before asking the independent verifier to attest the worker.
    manager.thaw()
    job['restorationVerification'] = manager.verifier('rollback', job.get('before', job.get('preflight')))
    job.update(phase='restored', restoredAt=time.time())
    save(path, job)


def run(job, path, manager):
    manager.attest()
    if job['phase'] in TERMINAL:
        return
    if job['phase'] != 'prepared':
        recover(job, path, manager)
        return
    job['preflight'] = manager.verifier('before-freeze')
    job['phase'] = 'armed'
    save(path, job)  # Durable before changing any manager state.
    manager.hold_restart()
    try:
        pid, group = manager.freeze()
        before = manager.verifier('frozen')
        job.update(phase='frozen', before=before)
        save(path, job)
        # Record retirement intent before cgroup.kill: recovery must handle the
        # old process either present or gone without ever starting a second one.
        job['phase'] = 'retiring'
        save(path, job)
        manager.retire_frozen(pid, group)
        manager.verifier('retired', before)
        write(OVERRIDE, job['candidateOverride'].encode())
        systemctl('daemon-reload')
        job['phase'] = 'candidate-starting'
        save(path, job)
        systemctl('start', UNIT)
        manager.verify_process()  # This adapter deliberately runs identical code.
        job['candidateVerification'] = manager.verifier('first-complete-cycle', before)
        manager.clear_hold()
        job.update(phase='committed', completedAt=time.time())
        save(path, job)
    except BaseException:
        # A SIGKILL is handled by the independent manager recovery timer.
        recover(job, path, manager)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'recover', 'watch'])
    parser.add_argument('--job')
    args = parser.parse_args()
    require(os.geteuid() == 0 and Path('/proc/1/comm').read_text().strip() == 'systemd', 'Actual systemd root supervisor required')
    safe(STATE, True)
    if args.action == 'watch':
        for path in sorted(STATE.glob('*.json')):
            safe(path)
            require(path.stat().st_size <= 1024 * 1024, 'Oversized worker recovery job')
            job = json.loads(path.read_bytes())
            require(job.get('model') == MODEL, 'Unknown worker recovery job')
            if job.get('phase') in TERMINAL or job.get('phase') == 'prepared':
                continue
            require(re.fullmatch(r'[a-z0-9][a-z0-9-]{7,63}', path.stem), 'Unsafe worker recovery job name')
            systemctl('start', '--no-block', 'proofofwork-worker-recovery@' + path.stem + '.service')
        return
    require(isinstance(args.job, str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{7,63}', args.job), 'Unsafe worker job identity')
    path = safe(STATE / (args.job + '.json'))
    require(path.stat().st_size <= 1024 * 1024, 'Oversized worker recovery job')
    job = json.loads(path.read_bytes())
    require(job.get('model') == MODEL and job.get('productionCertified') is True,
            'Actual manager/database fault certification is required; production gate remains closed')
    require(job['phase'] in TERMINAL | {'prepared', 'armed', 'frozen', 'retiring', 'candidate-starting'}, 'Unknown worker recovery phase')
    require(job['candidateOverride'].encode() == candidate_bytes(job['compactMaxBytes'], job['sqlTextMaxBytes']),
            'Only the two existing bounded summary budgets may change')
    require(job['baselineMode'] in {'healthy', 'incident-existing-unhealthy'}, 'Baseline health must be explicit')
    unit = 'proofofwork-worker-recovery@' + args.job + '.service'
    own = properties(unit, ['MainPID', 'KillMode', 'Restart'])
    require(own == {'MainPID': str(os.getpid()), 'KillMode': 'control-group', 'Restart': 'on-failure'},
            'Worker recovery must be the manager-owned controller')
    require(systemctl('is-active', 'proofofwork-worker-recovery-watch.timer') == 'active' and
            systemctl('is-enabled', 'proofofwork-worker-recovery-watch.timer') == 'enabled', 'Independent recovery timer must be active and enabled')
    lock = os.open(STATE / 'transition.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manager = SystemdWorker(job)
        (run if args.action == 'run' else recover)(job, path, manager)
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('worker_recovery status=refused ' + str(error), file=sys.stderr)
        sys.exit(1)
