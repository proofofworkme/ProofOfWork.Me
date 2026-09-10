#!/usr/bin/python3 -I
"""Isolated host-systemd certification. Explicit --execute required; no live app paths.

Run this entire harness as a bounded detached systemd unit. Its HTTP fixture,
controller services and independent recovery timers survive the launching SSH
process. This exercises actual systemd supervision, not a mocked manager.
"""
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import threading
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deployment_fixture', ROOT / 'scripts/check-audit6-deployment.py')
fixture_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture_module)
Fixture = fixture_module.Fixture


def call(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=30)


def service_properties(filename, root):
    # Read the actual reviewed service file; only path/dependency/entrypoint
    # adaptation is permitted for isolated tests. Keep all sandbox/supervision
    # limits. No production service, route or directory is modified.
    section = ''
    properties = {}
    for line in (ROOT / 'deploy/audit6' / filename).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('['):
            section = line
        elif section == '[Service]':
            key, value = line.split('=', 1)
            if key in ('ExecStart', 'StateDirectory', 'StateDirectoryMode'):
                continue
            properties[key] = value
    properties['ReadWritePaths'] = str(root)
    return ['--property=' + key + '=' + value for key, value in properties.items()]


def await_condition(predicate, label, seconds=480):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.25)
    raise AssertionError('Timed out waiting for ' + label)


def sha_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def originating_device(path):
    # systemd maps a file's partition to its originating block device. Inspect
    # that same simple topology instead of incorrectly requiring io.max on a
    # partition number. Ambiguous multi-device layouts are refused.
    device = Path(path).stat().st_dev
    key = str(os.major(device)) + ':' + str(os.minor(device))
    seen = set()
    while key not in seen:
        seen.add(key)
        entry = (Path('/sys/dev/block') / key).resolve(strict=True)
        if (entry / 'partition').exists():
            key = (entry.parent / 'dev').read_text().strip()
            continue
        slaves = list((entry / 'slaves').iterdir()) if (entry / 'slaves').exists() else []
        if not slaves:
            return key
        if len(slaves) != 1:
            raise RuntimeError('Complex backing device requires separate resource-envelope review')
        key = (slaves[0] / 'dev').read_text().strip()
    raise RuntimeError('Cyclic block-device topology')


def write_receipt(path, value):
    temporary = path.with_suffix(path.suffix + '.next')
    with temporary.open('w') as out:
        out.write(json.dumps(value, indent=2) + '\n')
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def scenario(name, output, slice_name, harness_unit):
    pauses = {'kill-main-after-union-exchange': 'union-exchanged',
              'kill-main-after-original-preserved': 'prior-preserved'}
    f = Fixture(after_exchange=name == 'kill-main-after-exchange',
                trapped_failure=name == 'trapped-publisher-failure',
                pause=None if name in ('kill-main-after-exchange', 'trapped-publisher-failure') else pauses.get(name, 'published'))
    suffix = f.root.name.removeprefix('pow-audit6-deployment-').replace('_', '-')
    unit = 'pow-audit6-fixture-' + suffix
    watcher = unit + '-watch'
    units = [unit + '.service', watcher + '.timer', watcher + '.service']
    result = {'name': name, 'fixtureRoot': str(f.root), 'units': units,
              'startedAt': time.time(), 'passed': False}
    asset_stop = threading.Event()
    asset_thread = None
    asset_samples, asset_failures = [], []
    def get(path):
        connection = http.client.HTTPConnection('127.0.0.1', f.http.server_port, timeout=5)
        try:
            connection.request('GET', path, headers={'Host': 'computer.proofofwork.me'})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()
    try:
        f.prepare()
        result['priorIdentity'] = f.old_inode
        result['candidateIdentity'] = f.new_inode
        # A separate manager-owned timer is armed before the publishing unit.
        call('/usr/bin/systemd-run', '--quiet', '--unit=' + watcher,
             '--slice=' + slice_name,
             '--on-active=10s', '--on-unit-inactive=10s', '--timer-property=AccuracySec=1s',
             '--timer-property=BindsTo=' + harness_unit, '--timer-property=After=' + harness_unit,
             '--property=BindsTo=' + harness_unit, '--property=After=' + harness_unit,
             *service_properties('proofofwork-ui-deployment-recovery.service', f.root),
             *f.argv('recover-all'))
        assert call('/usr/bin/systemctl', 'is-active', watcher + '.timer').stdout.strip() == 'active'
        launcher = call('/usr/bin/systemd-run', '--quiet', '--unit=' + unit,
             '--slice=' + slice_name,
             '--property=StartLimitIntervalSec=0',
             '--property=BindsTo=' + harness_unit, '--property=After=' + harness_unit,
             *service_properties('proofofwork-ui-deployment@.service', f.root),
             *f.argv('run'), '--release', f.release)
        assert launcher.returncode == 0  # Detached launcher has already exited.
        for bounded in (unit + '.service', watcher + '.service'):
            assert call('/usr/bin/systemctl', 'show', bounded, '--property=Slice', '--value').stdout.strip() == slice_name
        marker = f.after_exchange if name in ('kill-main-after-exchange', 'trapped-publisher-failure') else f.marker
        await_condition(marker.exists, 'real publisher fault boundary')
        result['initialUnitProperties'] = call('/usr/bin/systemctl', 'show', unit + '.service',
            '--property=MainPID,ControlGroup,Slice,BindsTo,Restart,KillMode,PrivateTmp,RuntimeMaxUSec,InvocationID').stdout
        main_pid = int(call('/usr/bin/systemctl', 'show', unit + '.service', '--property=MainPID', '--value').stdout)
        assert main_pid > 1 and main_pid != os.getpid()
        assert f.www.stat().st_ino == (f.job()['recovery']['identity'][1] if name in pauses else f.new_inode)
        assert f.job()['phase'] in ('armed', 'published-awaiting-smoke', 'prepublishing-union', 'preserving-original')
        result['boundaryPhase'] = f.job()['phase']
        if name == 'trapped-publisher-failure':
            assert b'/assets/new.js' in get('/')[1]
            expected = get('/assets/new.js')
            assert expected[0] == 200
            def poll_asset():
                while not asset_stop.is_set():
                    try:
                        actual = get('/assets/new.js')
                        asset_samples.append(actual[0])
                        if actual != expected:
                            asset_failures.append(actual[0])
                    except Exception as error:
                        asset_failures.append(type(error).__name__)
                    asset_stop.wait(.05)
            asset_thread = threading.Thread(target=poll_asset, daemon=True)
            asset_thread.start()
            f.release_failure.write_text('trigger real publisher EXIT trap')
            await_condition(f.trap_restored.exists, 'publisher trap restored union before controller verification')
            assert f.www.stat().st_ino == f.job()['recovery']['identity'][1]
            assert get('/assets/new.js') == expected
            f.resume_recovery.write_text('continue verified recovery')
        elif name == 'failed-post-publication-http':
            f.fault = True
            f.marker.unlink()
        elif name == 'watchdog-after-unit-loss':
            call('/usr/bin/systemctl', 'kill', '--kill-whom=all', '--signal=SIGKILL', unit + '.service')
            # Cancel the deployment unit's own restart to require independent
            # timer recovery. All killed descendants are in its cgroup.
            call('/usr/bin/systemctl', 'stop', unit + '.service')
        else:
            # Kill only MainPID: actual KillMode=control-group must remove the
            # publisher/shell descendants before any fresh recovery may lock.
            call('/usr/bin/systemctl', 'kill', '--kill-whom=main', '--signal=SIGKILL', unit + '.service')
        await_condition(lambda: f.job()['phase'] == 'rolled-back', 'verified prior-root recovery')
        job = f.job()
        assert f.www.stat().st_ino == job['recovery']['identity'][1]
        retained_original = Path(job['originalRoot'])
        assert retained_original.stat().st_ino == f.old_inode
        assert (retained_original / '.proofofwork-ui-release').read_bytes() == f.old_manifest
        assert (f.www / 'proofofwork-computer/index.html').read_bytes() == (retained_original / 'proofofwork-computer/index.html').read_bytes()
        assert (f.www / 'proofofwork-computer/assets/new.js').read_bytes() == (f.candidate / 'proofofwork-computer/assets/new.js').read_bytes()
        assert f.candidate.exists()
        assert job['rollbackSmoke']['checked'] == 45
        assert job['recoveredBy']['invocationId']
        if name == 'failed-post-publication-http':
            assert 'HTTP smoke mismatch:' in job['failure']
        elif name != 'trapped-publisher-failure':
            assert job['recoveredBy']['pid'] != main_pid
        if name == 'trapped-publisher-failure':
            assert get('/assets/new.js') == expected
            asset_stop.set(); asset_thread.join(timeout=10)
            assert not asset_thread.is_alive() and asset_samples and not asset_failures
            result['continuousCandidateAssetChecks'] = len(asset_samples)
        if name == 'watchdog-after-unit-loss':
            assert call('/usr/bin/systemctl', 'show', unit + '.service', '--property=ActiveState', '--value').stdout.strip() == 'inactive'
            invocation = call('/usr/bin/systemctl', 'show', watcher + '.service', '--property=InvocationID', '--value').stdout.strip()
            assert job['recoveredBy']['invocationId'] == invocation
        result.update(passed=True, durableJob=job, httpRequests=len(f.requests),
                      httpStatuses=sorted({r[2] for r in f.requests}))
    except Exception as error:
        result['error'] = str(error)
        if f.jobpath.exists():
            result['durableJob'] = f.job()
    finally:
        asset_stop.set()
        if asset_thread is not None:
            asset_thread.join(timeout=10)
        result['journals'] = call('/usr/bin/journalctl', '--no-pager', '-o', 'short-iso',
            '-u', unit + '.service', '-u', watcher + '.service', '-n', '150', check=False).stdout
        # Only exact unique test units and generated fixture trees are removed.
        # Production services and release evidence are never touched.
        call('/usr/bin/systemctl', 'stop', *units, check=False)
        call('/usr/bin/systemctl', 'reset-failed', *units, check=False)
        result['finishedAt'] = time.time()
        write_receipt(output / (name + '.json'), result)
        f.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--slice', required=True)
    parser.add_argument('--harness-unit', required=True)
    args = parser.parse_args()
    if not args.execute or os.geteuid() != 0 or Path('/proc/1/comm').read_text().strip() != 'systemd':
        parser.error('Requires explicit --execute on a root-owned systemd host; do not run against application roots')
    if not os.environ.get('INVOCATION_ID'):
        parser.error('Launch the harness as a detached bounded systemd service, not an SSH child')
    if not re.fullmatch(r'powaudit6certify[a-z0-9]{8,32}\.slice', args.slice) or not re.fullmatch(
            r'pow-audit6-certify-[a-z0-9]{8,32}\.service', args.harness_unit):
        parser.error('Use exact unique certification slice/unit names')
    if call('/usr/bin/systemctl', 'show', args.harness_unit, '--property=MainPID', '--value').stdout.strip() != str(os.getpid()) or \
            call('/usr/bin/systemctl', 'show', args.harness_unit, '--property=Slice', '--value').stdout.strip() != args.slice:
        parser.error('Harness must run in the same reviewed aggregate slice as every fixture unit')
    control_group = call('/usr/bin/systemctl', 'show', args.slice, '--property=ControlGroup', '--value').stdout.strip()
    if control_group != '/' + args.slice:
        parser.error('Unexpected certification slice cgroup')
    group = Path('/sys/fs/cgroup') / args.slice
    caps = {name: (group / name).read_text().strip() for name in
            ('cpu.max', 'memory.max', 'memory.high', 'memory.swap.max', 'pids.max', 'io.max')}
    quota, period = caps['cpu.max'].split()
    if quota == 'max' or int(quota) / int(period) > 0.25 or caps['memory.max'] != '536870912' or \
            caps['memory.high'] != '402653184' or caps['memory.swap.max'] != '0' or caps['pids.max'] != '256':
        parser.error('Aggregate CPU/memory/process caps do not match the reviewed envelope')
    devices = {originating_device(p) for p in ('/tmp', str(ROOT))}
    io_caps = {}
    for line in caps['io.max'].splitlines():
        device, *limits = line.split()
        io_caps[device] = dict(field.split('=', 1) for field in limits)
    if not all(io_caps.get(device, {}).get('rbps') == '10485760' and
               io_caps.get(device, {}).get('wbps') == '5242880' for device in devices):
        parser.error('Missing aggregate read/write bandwidth caps for fixture and bundle backing devices')
    mem_available = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines()
                         if line.startswith('MemAvailable:'))
    if mem_available < 1024 ** 3:
        parser.error('Less than 1 GiB available RAM; postpone isolated host certification')
    output = args.output
    if not output.is_absolute() or output.resolve() != output or not str(output).startswith('/tmp/pow-audit6-systemd-results-') or output.exists():
        parser.error('Use a new canonical /tmp/pow-audit6-systemd-results-<id> output directory')
    output.mkdir(mode=0o700)
    sources = [ROOT / 'deploy/audit6/ui-deployment.py', ROOT / 'deploy/audit6/ui-continuity.py', Path(__file__),
               ROOT / 'scripts/check-audit6-deployment.py',
               *sorted((ROOT / 'deploy/audit6').glob('*.service')),
               *sorted((ROOT / 'deploy/audit6').glob('*.timer')),
               *sorted((ROOT / 'deploy/audit6').glob('*.slice')),
               *[ROOT / 'deploy' / n for n in ('proofofwork-ui-release-publish.sh',
                  'proofofwork-ui-release-provenance.sh', 'proofofwork-ui-retained-root.py')]]
    receipt = {'model': 'proofofwork-ui-systemd-fault-certification-v1',
        'passed': False, 'sourceHashes': {str(p.relative_to(ROOT)): sha_file(p) for p in sources},
        'scope': 'Isolated systemd, real publisher/provenance and local HTTP. No production Caddy/TLS, DNS, app semantics, host reboot or node cutover certification.',
        'harnessInvocationId': os.environ['INVOCATION_ID'], 'results': []}
    receipt['resourceEnvelope'] = {'slice': args.slice, 'harnessUnit': args.harness_unit,
                                   'actualCgroupLimits': caps, 'backingDevices': sorted(devices),
                                   'memAvailableBefore': mem_available}
    write_receipt(output / 'receipt.json', receipt)
    scenarios = ('kill-main-after-union-exchange', 'kill-main-after-original-preserved',
                 'kill-main-after-exchange', 'trapped-publisher-failure',
                 'failed-post-publication-http', 'watchdog-after-unit-loss')
    for name in scenarios:
        result = scenario(name, output, args.slice, args.harness_unit)
        receipt['results'].append({'name': name, 'passed': result['passed'],
            'evidenceSha256': sha_file(output / (name + '.json'))})
        write_receipt(output / 'receipt.json', receipt)
        print(json.dumps({'scenario': name, 'passed': result['passed']}), flush=True)
        if not result['passed']:
            break
    receipt['passed'] = len(receipt['results']) == len(scenarios) and all(r['passed'] for r in receipt['results'])
    write_receipt(output / 'receipt.json', receipt)
    return 0 if receipt['passed'] else 1

if __name__ == '__main__':
    sys.exit(main())
