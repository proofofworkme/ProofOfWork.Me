#!/usr/bin/python3 -I
"""Private PostgreSQL16 base-backup/WAL/restore-point rehearsal.

This writes synthetic rows only into two NEW confined clusters. It tests the
proposed recovery mechanics, not continuity of production WAL or production
physical pages. Preserve both clusters, logs, slot and all receipts on exit.
The reviewed logical-restore guard alongside this file supplies continuously
supervised commands, resource checks, strict private-unit checks and PID stop.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import subprocess
import time

APPROVAL = '6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
SCHEMA = 'pow-audit30-pitr-mechanics-plan-v1'
LIMIT = 2 * 1024**3
BIN = Path('/usr/lib/postgresql/16/bin')
ENV = dict(PATH='/usr/bin:/bin', LC_ALL='C', LANG='C', TZ='UTC')
SERVICES = {'bitcoind.service', 'electrs.service', 'postgresql@16-main.service',
            'proofofwork-api.service', 'proofofwork-indexer-worker.service'}


def unique_pairs(rows):
    value = {}
    for k, v in rows:
        if k in value:
            raise ValueError('Duplicate plan key')
        value[k] = v
    return value


def raw_hash(path):
    p = Path(path)
    if p.resolve(strict=True) != p or not stat.S_ISREG(p.lstat().st_mode):
        raise ValueError('Noncanonical input')
    identity = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid,
                          s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    before = identity(p.stat())
    raw = p.read_bytes()
    if len(raw) > 1024**2 or identity(p.stat()) != before:
        raise ValueError('Input changed or oversized')
    return hashlib.sha256(raw).hexdigest(), raw


def validate_plan(p):
    keys = {'schema', 'approvalSha256', 'sourceSha256', 'guardSha256', 'runId',
            'host', 'job', 'unit', 'liveServices', 'backupWindow',
            'latestBackupReadReceiptSha256'}
    if set(p) != keys or p['schema'] != SCHEMA or p['approvalSha256'] != APPROVAL:
        raise ValueError('Wrong rehearsal authority')
    if not isinstance(p['runId'], str) or not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z', p['runId']):
        raise ValueError('Wrong run identity')
    dt.datetime.strptime(p['runId'], '%Y%m%dT%H%M%SZ')
    if p['job'] != '/data/proofofwork-audit30-pitr-mechanics-' + p['runId'] or p['unit'] != 'proofofwork-audit30-pitr-mechanics-' + p['runId'] + '.service':
        raise ValueError('Wrong private job/unit')
    for k in ('sourceSha256', 'guardSha256', 'latestBackupReadReceiptSha256'):
        if not isinstance(p[k], str) or not re.fullmatch(r'[0-9a-f]{64}', p[k]):
            raise ValueError('Wrong source/evidence hash')
    if not isinstance(p['host'], str) or not re.fullmatch(r'[A-Za-z0-9.-]+', p['host']):
        raise ValueError('Wrong host')
    if set(p['liveServices']) != SERVICES:
        raise ValueError('Wrong live authorities')
    for row in p['liveServices'].values():
        if set(row) != {'MainPID', 'InvocationID'} or not str(row['MainPID']).isdigit() or int(row['MainPID']) <= 0 or not re.fullmatch(r'[0-9a-f]{32}', row['InvocationID']):
            raise ValueError('Wrong live service identity')
    if set(p['backupWindow']) != {'preflightAtUtc', 'nextScheduledAtUtc'}:
        raise ValueError('Wrong backup window')
    for value in p['backupWindow'].values():
        if dt.datetime.fromisoformat(value).utcoffset() != dt.timedelta(0):
            raise ValueError('Backup window must be UTC')
    return p


def load(plan_path, expected_sha):
    sha, raw = raw_hash(plan_path)
    if sha != expected_sha:
        raise ValueError('Plan bytes changed')
    if len(raw) > 65536:
        raise ValueError('Oversized rehearsal plan')
    plan = validate_plan(json.loads(raw, object_pairs_hook=unique_pairs))
    path = Path(plan_path)
    if str(path) != '/run/credentials/' + plan['unit'] + '/rehearsal-plan':
        raise ValueError('Untrusted plan credential')
    if raw_hash(Path(__file__))[0] != plan['sourceSha256']:
        raise ValueError('Rehearsal source changed')
    guardpath = Path(__file__).parent / 'restore-latest-logical.py'
    if raw_hash(guardpath)[0] != plan['guardSha256']:
        raise ValueError('Guard source changed')
    module = importlib.util.spec_from_file_location('audit30_restore_guard', guardpath)
    guard = importlib.util.module_from_spec(module)
    module.loader.exec_module(guard)
    guard.validate_managed_credential(path, plan['unit'], 'rehearsal-plan',
                                      Path(__file__).parent / 'reviewed-plan.json')
    if raw_hash(path)[0] != expected_sha:
        raise ValueError('Credential bytes changed during managed attestation')
    return plan, guard


def config(cluster, socket, port, recovery=None):
    for p in (cluster, socket):
        if not re.fullmatch(r'/data/proofofwork-audit30-pitr-mechanics-[0-9]{8}T[0-9]{6}Z/(?:source|recovered|source-socket|recovered-socket)', str(p)):
            raise ValueError('Configuration path escapes private job')
    if port not in (55441, 55442):
        raise ValueError('Wrong private socket port')
    text = f"""data_directory = '{cluster}'
listen_addresses = ''
port = {port}
unix_socket_directories = '{socket}'
unix_socket_permissions = 0700
hba_file = '{cluster}/pg_hba.conf'
ident_file = '{cluster}/pg_ident.conf'
ssl = off
shared_buffers = '32MB'
work_mem = '4MB'
max_connections = 16
max_parallel_workers = 0
wal_level = replica
max_wal_senders = 4
max_replication_slots = 2
max_slot_wal_keep_size = '16GB'
max_wal_size = '128MB'
min_wal_size = '32MB'
archive_mode = off
primary_conninfo = ''
primary_slot_name = ''
hot_standby = on
logging_collector = off
"""
    if recovery:
        wal, target = recovery
        if wal != cluster.parent / 'wal' or not re.fullmatch(r'audit30_[0-9]{8}T[0-9]{6}Z', target):
            raise ValueError('Recovery path/target escapes rehearsal')
        text += f"restore_command = 'cp {wal}/%f %p'\nrecovery_target_name = '{target}'\nrecovery_target_timeline = '1'\nrecovery_target_action = 'pause'\n"
    return text


def psql(socket, port):
    return [str(BIN / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
            '-h', str(socket), '-p', str(port), '-U', 'postgres', '-d', 'postgres']


def private_pid(cluster):
    path = cluster / 'postmaster.pid'
    lines = path.read_text().splitlines()
    pid = int(lines[0])
    if pid <= 1 or lines[1] != str(cluster):
        raise ValueError('Wrong private postmaster')
    proc = Path(f'/proc/{pid}')
    cmd = (proc / 'cmdline').read_bytes().split(b'\0')
    if os.readlink(proc / 'exe') != str(BIN / 'postgres') or not any(cmd[i:i+2] == [b'-D', str(cluster).encode()] for i in range(len(cmd)-1)):
        raise ValueError('Private PID does not name this cluster')
    ticks = int((proc / 'stat').read_bytes().split(b') ', 1)[1].split()[19])
    return dict(pid=pid, startTicks=ticks, dataDirectory=str(cluster))


def execute(plan, guard):
    job = Path(plan['job'])
    if job.resolve(strict=True) != job or not job.is_dir() or job.stat().st_uid != pwd.getpwnam('postgres').pw_uid or stat.S_IMODE(job.stat().st_mode) != 0o700 or list(job.iterdir()):
        raise ValueError('New private job must be empty postgres0700')
    guard.check_runtime(plan)
    guard.check_live(plan)
    guard.check_window(plan)
    guard.storage_sample(job, preflight=True)
    start = time.monotonic()
    def sample(p):
        value = guard.storage_sample(p)
        if value['jobAllocatedBytes'] > LIMIT or time.monotonic() - start > 1200:
            raise ValueError('Small PITR fixture exceeded storage/runtime bound')
        return value
    watch = guard.Watchdog(job, sample=sample)
    runner = guard.Runner(job, watch, started=start)
    source, recovered, wal = job / 'source', job / 'recovered', job / 'wal'
    socket, rsocket = job / 'source-socket', job / 'recovered-socket'
    started = {}
    receiver = None
    err = None
    result = dict(schema='pow-audit30-pitr-mechanics-execution-v1', atUtc=guard.utc(),
        sourceSha256=plan['sourceSha256'], guardSha256=plan['guardSha256'],
        approvalSha256=APPROVAL, productionMutation=False,
        qualification='Synthetic private PostgreSQL16 fixture only; not production physical pages, current production WAL continuity or a production restore.', passed=False)
    def q(sql, phase, sock=socket, port=55441):
        return runner.run([*psql(sock, port), '-c', sql], phase, timeout=60).decode().strip()
    def start_cluster(cluster, sock, port, recovery=None):
        (cluster / 'postgresql.conf').write_text(config(cluster, sock, port, recovery))
        (cluster / 'postgresql.auto.conf').write_text('')
        (cluster / 'pg_hba.conf').write_text('local all all trust\nlocal replication all trust\n')
        (cluster / 'pg_ident.conf').write_text('')
        runner.run([str(BIN / 'pg_ctl'), '-D', str(cluster), '-l', str(job / (cluster.name + '.log')), '-w', '-t', '60', 'start'], 'start-' + cluster.name, timeout=75)
        started[cluster] = private_pid(cluster)
    def stop(cluster):
        if cluster not in started:
            if not (cluster / 'postmaster.pid').exists():
                sock = rsocket if cluster == recovered else socket
                port = 55442 if cluster == recovered else 55441
                if (sock / ('.s.PGSQL.' + str(port))).exists():
                    raise ValueError('Private socket remains without PID file')
                return
            started[cluster] = private_pid(cluster)
        if private_pid(cluster) != started[cluster]:
            raise ValueError('Private postmaster changed; stop refused')
        guard.command([str(BIN / 'pg_ctl'), '-D', str(cluster), '-m', 'fast', '-w', '-t', '60', 'stop'], timeout=70)
        started.pop(cluster)
    def interrupted(*_):
        raise InterruptedError('Private rehearsal interrupted')
    prior = {s: signal.signal(s, interrupted) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    guard.durable(job / 'intent.json', dict(atUtc=guard.utc(), plan=plan, productionMutation=False))
    try:
        watch.start()
        for p in (source, recovered, wal, socket, rsocket):
            p.mkdir(mode=0o700)
        runner.run([str(BIN / 'initdb'), '-D', str(source), '--data-checksums', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C.UTF-8'], 'init-source', timeout=75)
        start_cluster(source, socket, 55441)
        q("CREATE TABLE audit30_pitr_fixture(id integer PRIMARY KEY, amount numeric(40,16) NOT NULL, body text NOT NULL); INSERT INTO audit30_pitr_fixture VALUES (1,546.0000000000000000,E'  before\\n'); SELECT pg_create_physical_replication_slot('audit30_rehearsal',true);", 'seed-and-slot')
        err = (job / 'receiver.stderr').open('xb')
        receiver = subprocess.Popen([str(BIN / 'pg_receivewal'), '-h', str(socket), '-p', '55441', '-U', 'postgres', '-D', str(wal), '--slot=audit30_rehearsal', '--synchronous', '--no-password'], env=ENV, stdout=subprocess.DEVNULL, stderr=err, start_new_session=True)
        deadline = time.monotonic() + 30
        while q("SELECT active::text FROM pg_replication_slots WHERE slot_name='audit30_rehearsal';", 'receiver-ready') != 'true':
            if receiver.poll() is not None or time.monotonic() > deadline:
                raise ValueError('Private slot-backed receiver did not start')
            time.sleep(.2)
        runner.run([str(BIN / 'pg_basebackup'), '-h', str(socket), '-p', '55441', '-U', 'postgres', '-D', str(recovered), '-Fp', '-Xs', '--checkpoint=fast', '--no-password', '--manifest-checksums=SHA256'], 'basebackup', timeout=180)
        runner.run([str(BIN / 'pg_verifybackup'), '--exit-on-error', str(recovered)], 'verify-basebackup', timeout=120)
        result['baseManifestSha256'] = hashlib.sha256((recovered / 'backup_manifest').read_bytes()).hexdigest()
        q("INSERT INTO audit30_pitr_fixture VALUES (2,1000.0000000000000000,E'\\t target  ');", 'before-target')
        target = 'audit30_' + plan['runId']
        result['targetLsn'] = q("SELECT pg_create_restore_point('" + target + "');", 'named-target')
        q("INSERT INTO audit30_pitr_fixture VALUES (3,999.0000000000000000,'after target');", 'after-target')
        wanted = q("SELECT json_build_object('ids',array_agg(id ORDER BY id),'sum',sum(amount)::text,'rows',json_agg(json_build_object('id',id,'amount',amount::text,'bodyUtf8Hex',encode(convert_to(body,'UTF8'),'hex')) ORDER BY id)) FROM audit30_pitr_fixture WHERE id<=2;", 'expected-state')
        q('SELECT pg_switch_wal();', 'close-target-wal')
        deadline = time.monotonic() + 30
        target_segment = q("SELECT pg_walfile_name('" + result['targetLsn'] + "');", 'target-segment')
        while not (wal / target_segment).is_file():
            watch.assert_alive()
            if receiver.poll() is not None or time.monotonic() > deadline:
                raise ValueError('Target WAL segment not durably closed')
            time.sleep(.2)
        os.killpg(receiver.pid, signal.SIGTERM)
        if receiver.wait(timeout=10) != 0:
            raise ValueError('Private receiver did not stop cleanly')
        receiver = None
        err.close()
        result['closedWal'] = []
        for p in sorted(wal.iterdir()):
            if re.fullmatch(r'[0-9A-F]{24}', p.name):
                if p.is_symlink() or p.stat().st_size != 16*1024**2:
                    raise ValueError('Invalid closed WAL member')
                result['closedWal'].append(dict(name=p.name, bytes=p.stat().st_size, sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
        if not result['closedWal']:
            raise ValueError('No closed WAL')
        stop(source)
        (recovered / 'recovery.signal').touch(exist_ok=False)
        start_cluster(recovered, rsocket, 55442, (wal, target))
        deadline = time.monotonic() + 90
        while q('SELECT (pg_is_in_recovery() AND pg_is_wal_replay_paused())::text;', 'pause-state', rsocket, 55442) != 'true':
            if time.monotonic() > deadline:
                raise ValueError('Recovery did not pause at named target')
            time.sleep(.2)
        actual = q("SELECT json_build_object('ids',array_agg(id ORDER BY id),'sum',sum(amount)::text,'rows',json_agg(json_build_object('id',id,'amount',amount::text,'bodyUtf8Hex',encode(convert_to(body,'UTF8'),'hex')) ORDER BY id)) FROM audit30_pitr_fixture;", 'recovered-state', rsocket, 55442)
        if json.loads(actual) != json.loads(wanted):
            raise ValueError('Target state differs; before/after separation failed')
        result['expectedState'] = json.loads(wanted)
        result['recoveredState'] = json.loads(actual)
        result['pausedAtNamedTarget'] = True
        result['noAfterTargetRows'] = True
        result['recoveryLsn'] = q('SELECT pg_last_wal_replay_lsn();', 'replay-lsn', rsocket, 55442)
        log = (job / 'recovered.log').read_text()
        if ('recovery stopping at restore point "' + target + '"') not in log:
            raise ValueError('Missing exact named-target log')
        stop(recovered)
        for c in (source, recovered):
            runner.run([str(BIN / 'pg_checksums'), '--check', '-D', str(c)], 'checksums-' + c.name, timeout=120)
        guard.check_live(plan)
        result['resources'] = sample(job)
        result['passed'] = True
        result['atUtc'] = guard.utc()
    except BaseException as e:
        result.update(errorClass=type(e).__name__, atUtc=guard.utc())
        guard.durable(job / 'failure.json', result)
        raise
    finally:
        # The first ordinary interruption enters this bounded cleanup. Repeated
        # ordinary signals must not bypass remaining private-stop attempts or
        # their receipts. The systemd cgroup deadline remains the SIGKILL backstop.
        for s in prior:signal.signal(s, signal.SIG_IGN)
        cleanup_errors = []
        if receiver and receiver.poll() is None:
            try:
                os.killpg(receiver.pid, signal.SIGTERM)
                try:receiver.wait(timeout=5)
                except subprocess.TimeoutExpired:os.killpg(receiver.pid, signal.SIGKILL);receiver.wait()
            except BaseException as e:cleanup_errors.append(dict(subject='receiver',errorClass=type(e).__name__))
        if err:
            err.close()
        for c in (recovered, source):
            try:stop(c)
            except BaseException as e:cleanup_errors.append(dict(subject=c.name,errorClass=type(e).__name__))
        try:
            if watch.pid:watch.stop()
        except BaseException as e:cleanup_errors.append(dict(subject='watchdog',errorClass=type(e).__name__))
        for s, handler in prior.items():signal.signal(s, handler)
        if cleanup_errors:
            guard.durable(job / 'cleanup-failure.json', dict(atUtc=guard.utc(), errors=cleanup_errors, unitCgroupStopRequired=True, productionMutation=False))
            raise RuntimeError('Private cleanup did not fully verify')
    guard.durable(job / 'completion.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', required=True)
    parser.add_argument('--plan-sha256', required=True)
    args = parser.parse_args()
    try:
        plan, guard = load(args.plan, args.plan_sha256)
        print(json.dumps(execute(plan, guard), sort_keys=True))
    except BaseException as e:
        print('PITR fixture refused: ' + type(e).__name__, flush=True)
        raise SystemExit(1)
