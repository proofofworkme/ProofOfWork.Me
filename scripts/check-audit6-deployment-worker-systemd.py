#!/usr/bin/python3 -I
"""Isolated actual-systemd worker adapter faults. No production service or DB.

Run as a detached bounded manager unit in a dedicated aggregate-capped slice.
The worker payload and verifier are synthetic; this certifies manager/cgroup,
override and session-independent recovery mechanics, not canonical replay.
"""
import argparse
import hashlib
import http.server
import importlib.util
import json
import os
import pwd
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / 'deploy/audit6/node-worker-restart.py'


def call(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=45)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, data):
    temporary = path.with_suffix('.next')
    with temporary.open('w') as out:
        json.dump(data, out, indent=2)
        out.write('\n'); out.flush(); os.fsync(out.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def wait(predicate, label, seconds=60):
    deadline = time.monotonic() + seconds
    while not predicate():
        if time.monotonic() >= deadline:
            raise RuntimeError('Timed out: ' + label)
        time.sleep(.1)


def unit_properties(filename, root, override_parent):
    section = ''
    values = {}
    for line in (ROOT / 'deploy/audit6' / filename).read_text().splitlines():
        if not line or line.startswith('#'): continue
        if line.startswith('['): section = line
        elif section == '[Service]':
            key, value = line.split('=', 1)
            if key not in {'ExecStart', 'StateDirectory', 'StateDirectoryMode'}:
                values[key] = value
    values['PrivateTmp'] = 'false'  # All synthetic state is under this exact /tmp root.
    values['ReadWritePaths'] = str(root) + ' ' + str(override_parent)
    return ['--property=' + key + '=' + value for key, value in values.items()]


def device(path):
    value = Path(path).stat().st_dev
    key = str(os.major(value)) + ':' + str(os.minor(value))
    seen = set()
    while key not in seen:
        seen.add(key)
        entry = (Path('/sys/dev/block') / key).resolve(strict=True)
        if (entry/'partition').exists():
            key = (entry.parent/'dev').read_text().strip(); continue
        slaves = list((entry/'slaves').iterdir()) if (entry/'slaves').exists() else []
        # cgroup v2 reports the bandwidth rule at a software RAID aggregate
        # (the device receiving the filesystem I/O), not at each member. This
        # is an explicit, inspectable boundary; retain refusal for every other
        # multi-slave topology whose throttling point is ambiguous.
        if len(slaves) > 1 and (entry/'md').is_dir():
            return key
        if not slaves: return key
        assert len(slaves) == 1, 'Complex backing device requires separate resource review'
        key = (slaves[0]/'dev').read_text().strip()
    raise RuntimeError('Cyclic block-device topology')


def scenario(name, output, slice_name, harness):
    root = Path(tempfile.mkdtemp(prefix='pow-audit6-worker-systemd-', dir='/tmp'))
    root.chmod(0o755)
    suffix = root.name.removeprefix('pow-audit6-worker-systemd-').replace('_', '-')
    worker = 'pow-audit6-worker-' + suffix + '.service'
    api = 'pow-audit6-api-' + suffix + '.service'
    controller = 'pow-audit6-recovery-' + suffix + '.service'
    watch = 'pow-audit6-recovery-watch-' + suffix
    unit_file = Path('/run/systemd/system') / worker
    controller_file = Path('/run/systemd/system') / controller
    override_parent = Path('/run/systemd/system') / (worker + '.d')
    if unit_file.exists() or controller_file.exists() or override_parent.exists():
        raise RuntimeError('Unique fixture unit path already exists')
    override_parent.mkdir(mode=0o755)
    override = override_parent / 'zz-audit6-budget-recovery.conf'
    hold = override_parent / 'zzzz-audit6-restart-hold.conf'
    original_override = '[Service]\nEnvironment=POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES=16777216\nEnvironment=POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES=18874368\n'
    override.write_text(original_override); override.chmod(0o644)
    data = root / 'data'; data.mkdir(mode=0o700); os.chown(data, 1000, 1000)
    heartbeat = data / 'heartbeat.json'
    runtime = str(Path('/usr/bin/python3').resolve())
    source = root / 'worker.py'
    source.write_text('import json,os,pathlib,subprocess,time\n'
      + f'p=pathlib.Path({str(heartbeat)!r})\n'
      + ('child=subprocess.Popen(["/bin/sleep","120"])\n' if name == 'freeze-child-refusal' else '')
      + 'while True:\n'
      + " d={'pid':os.getpid(),'compact':int(os.environ['POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES'])}\n"
      + " p.with_suffix('.next').write_text(json.dumps(d));p.with_suffix('.next').replace(p);time.sleep(.05)\n")
    source.chmod(0o750); os.chown(source, 1000, 1000)
    call('git', '-C', str(root), 'init', '-q')
    call('git', '-C', str(root), 'add', 'worker.py')
    call('git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.example', 'commit', '-qm', 'frozen fixture')
    unit_file.write_text('[Unit]\nBindsTo=' + harness + '\nAfter=' + harness + '\nPartOf=' + api + '\n[Service]\nType=simple\nUser=1000\n'
      + 'Slice=' + slice_name + '\nWorkingDirectory=' + str(root) + '\nExecStart=' + runtime + ' ' + str(source) + ' --loop\n'
      + 'Restart=always\nRestartSec=1s\nKillMode=control-group\nTimeoutStopSec=5s\n')
    unit_file.chmod(0o644)
    marker = root / 'phase-marker'
    pause_phase = {'kill-armed': 'armed', 'kill-frozen': 'frozen', 'kill-retired': 'retired',
                   'kill-candidate': 'first-complete-cycle'}.get(name)
    verifier = root / 'verifier.py'
    verifier.write_text('#!/usr/bin/python3 -I\nimport json,os,pathlib,subprocess,sys,time\n'
      + f'p=pathlib.Path({str(marker)!r});h=pathlib.Path({str(heartbeat)!r})\n'
      + "r=json.load(sys.stdin);phase=r['phase']\n"
      + f'pid=int(subprocess.check_output(["systemctl","show",{worker!r},"--property=MainPID","--value"],text=True).strip())\n'
      + 'cross_uid=False\nif pid>1:\n'
      + ' proc=pathlib.Path("/proc")/str(pid);environment=(proc/"environ").read_bytes()\n'
      + f' assert (proc/"cwd").resolve()==pathlib.Path({str(root)!r})\n'
      + ' assert b"POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES=" in environment\n'
      + ' assert (proc/"stat").read_text()\n'
      + ' assert os.readlink(proc/"fd"/"0")\n cross_uid=True\n'
      + f"if phase=={pause_phase!r}:\n p.write_text(phase)\n while True:time.sleep(.1)\n"
      + f"if phase=='first-complete-cycle' and {name!r}=='failed-candidate':\n"
      + " end=time.monotonic()+10\n while time.monotonic()<end and json.loads(h.read_text())['compact']!=17825792:time.sleep(.05)\n"
      + " assert json.loads(h.read_text())['compact']==17825792\n sys.exit(1)\n"
      + "print(json.dumps({'passed':True,'phase':phase,'syntheticVerifier':True,'crossUidProcReads':cross_uid}))\n")
    verifier.chmod(0o755)
    manifest = root / 'verifier-manifest.json'; manifest.write_text('{"synthetic":true}\n'); manifest.chmod(0o600)
    jobpath = root / 'job.json'
    config = root / 'config.json'
    save(config, {'worker': worker, 'override': str(override), 'hold': str(hold), 'groupBase': '/' + slice_name})
    entry = root / 'entry.py'
    entry.write_text('import importlib.util,json,pathlib,sys,time\nsys.dont_write_bytecode=True\n'
      + f's=importlib.util.spec_from_file_location("adapter",{str(ADAPTER)!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n'
      + f'c=json.loads(pathlib.Path({str(config)!r}).read_text());m.UNIT=c["worker"];m.OVERRIDE=pathlib.Path(c["override"]);m.HOLD=pathlib.Path(c["hold"])\n'
      + 'm.CGROUP_BASE=c["groupBase"]\n'
      + f'p=pathlib.Path({str(jobpath)!r});j=json.loads(p.read_text())\n'
      + 'class Manager(m.SystemdWorker):\n'
      + ' def hold_restart(self):\n'
      + f'  if {name!r}=="kill-armed" and self.job["phase"]=="armed":\n'
      + f'   pathlib.Path({str(marker)!r}).write_text("armed")\n'
      + '   while True:time.sleep(.1)\n'
      + '  return super().hold_restart()\n'
      + 'm.run(j,p,Manager(j))\n')
    entry.chmod(0o755)
    controller_file.write_text('[Unit]\nBindsTo=' + harness + '\nAfter=' + harness + '\n[Service]\n'
      + 'ExecStart=' + runtime + ' -I ' + str(entry) + '\n'
      + '\n'.join(value.removeprefix('--property=') for value in
                  unit_properties('proofofwork-worker-recovery@.service', root, override_parent)) + '\n')
    controller_file.chmod(0o644)
    watcher = root / 'watch.py'
    watcher.write_text('import json,pathlib,subprocess\n'
      + f'j=json.loads(pathlib.Path({str(jobpath)!r}).read_text())\n'
      + f'if j["phase"] not in ["prepared","restored","committed"]:subprocess.run(["systemctl","start","--no-block",{controller!r}],check=True)\n')
    watcher.chmod(0o755)
    receipts = {'name': name, 'passed': False, 'root': str(root), 'workerUnit': worker,
                'controllerUnit': controller, 'actualSystemd': True, 'syntheticVerifier': True}
    units = [worker, controller, watch + '.timer', watch + '.service', api]
    probe_stop = threading.Event()
    probe_results = []
    probe_thread = None
    try:
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
        api_source = root / 'api.py'
        api_source.write_text('from http.server import HTTPServer,BaseHTTPRequestHandler\n'
          + 'class H(BaseHTTPRequestHandler):\n'
          + ' def do_GET(self):\n  self.send_response(200);self.end_headers();self.wfile.write(b"prior API stays available")\n'
          + ' def log_message(self,*args):pass\n'
          + f'HTTPServer(("127.0.0.1",{port}),H).serve_forever()\n')
        call('systemd-run', '--quiet', '--unit=' + api.removesuffix('.service'), '--slice=' + slice_name,
             '--property=BindsTo=' + harness, '--property=After=' + harness,
             '--property=RuntimeMaxSec=10min', '--property=KillMode=control-group', runtime, '-I', str(api_source))
        def probe():
            with urllib.request.urlopen('http://127.0.0.1:' + str(port), timeout=2) as response:
                return response.status == 200 and response.read() == b'prior API stays available'
        def available():
            try: return probe()
            except OSError: return False
        wait(available, 'separate unchanged API fixture listener')
        api_pid = call('systemctl', 'show', api, '--property=MainPID', '--value').stdout.strip()
        def observe():
            while not probe_stop.is_set():
                probe_results.append(available()); probe_stop.wait(.05)
        probe_thread = threading.Thread(target=observe, daemon=True); probe_thread.start()
        call('systemctl', 'daemon-reload'); call('systemctl', 'start', worker)
        wait(lambda: heartbeat.exists(), 'initial fixture worker')
        initial_pid = json.loads(heartbeat.read_text())['pid']
        job = {'model': 'proofofwork-worker-budget-recovery-v1', 'phase': 'prepared', 'preparedAt': time.time(),
          'baselineMode': 'incident-existing-unhealthy', 'candidateOverride': '[Service]\nEnvironment=POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES=17825792\nEnvironment=POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES=18874368\n',
          'priorOverride': original_override, 'priorOverrideMode': 0o644, 'verifier': str(verifier), 'verifierManifest': str(manifest),
          'verifierManifestSha256': sha(manifest), 'helperHashes': {str(ADAPTER): sha(ADAPTER), str(verifier): sha(verifier), str(manifest): sha(manifest)},
          'identity': {'runtime': runtime, 'runtimeOwner': 0, 'runtimeSha256': sha(runtime), 'sourceFile': str(source),
             'sourceOwner': 1000, 'sourceSha256': sha(source), 'sourceRoot': str(root),
             'sourceCommit': call('git', '-C', str(root), 'rev-parse', 'HEAD').stdout.strip(), 'unitFiles': {str(unit_file): sha(unit_file)}}}
        save(jobpath, job)
        call('systemd-run', '--quiet', '--unit=' + watch, '--slice=' + slice_name,
             '--on-active=2s', '--on-unit-inactive=2s', '--timer-property=AccuracySec=1s',
             '--timer-property=BindsTo=' + harness, '--timer-property=After=' + harness,
             '--property=BindsTo=' + harness, '--property=After=' + harness,
             *unit_properties('proofofwork-worker-recovery-watch.service', root, override_parent), runtime, '-I', str(watcher))
        call('systemctl', 'daemon-reload')
        call('systemctl', 'start', controller)
        if pause_phase:
            wait(lambda: marker.exists(), 'actual manager fault boundary', 60)
            receipts['phaseAtFault'] = json.loads(jobpath.read_text())['phase']
            receipts['frozenEventsAtFault'] = call('systemctl', 'show', worker, '--property=FreezerState,MainPID,Restart').stdout
            call('systemctl', 'kill', '--kill-whom=all', '--signal=SIGKILL', controller)
            call('systemctl', 'stop', controller)  # Cancel its own restart; require the independent timer.
        wait(lambda: json.loads(jobpath.read_text())['phase'] == 'restored', 'independent prior override restoration', 90)
        wait(lambda: json.loads(heartbeat.read_text())['compact'] == 16777216 and
             str(json.loads(heartbeat.read_text())['pid']) == call('systemctl', 'show', worker, '--property=MainPID', '--value').stdout.strip(),
             'prior worker configuration running')
        assert override.read_text() == original_override and override.stat().st_mode & 0o777 == 0o644 and not hold.exists()
        current = call('systemctl', 'show', worker, '--property=MainPID,FreezerState,Restart,ActiveState').stdout
        assert 'FreezerState=running' in current and 'Restart=always' in current and 'ActiveState=active' in current
        if name in {'kill-armed', 'kill-frozen', 'freeze-child-refusal'}: assert json.loads(heartbeat.read_text())['pid'] == initial_pid
        else: assert json.loads(heartbeat.read_text())['pid'] != initial_pid
        assert probe_results and all(probe_results)
        assert call('systemctl', 'show', api, '--property=MainPID', '--value').stdout.strip() == api_pid
        receipts.update(passed=True, job=json.loads(jobpath.read_text()), workerFinalProperties=current,
          priorApiPid=api_pid, successfulHttpProbes=len(probe_results), allHttpProbesPassed=all(probe_results),
          controllerJournal=call('journalctl', '-u', controller, '-n', '80', '--no-pager', '-o', 'short-iso').stdout,
          watcherProperties=call('systemctl', 'show', watch + '.service', '--property=InvocationID,Slice,BindsTo,ControlGroup').stdout,
          controllerProperties=call('systemctl', 'show', controller, '--property=InvocationID,Slice,BindsTo,CapabilityBoundingSet,ProtectControlGroups').stdout)
    finally:
        probe_stop.set()
        if probe_thread: probe_thread.join(timeout=3)
        for unit in units: call('systemctl', 'stop', unit, check=False)
        for unit in units: call('systemctl', 'reset-failed', unit, check=False)
        save(output / (name + '.json'), receipts)
        unit_file.unlink(missing_ok=True)
        controller_file.unlink(missing_ok=True)
        for path in (hold, override): path.unlink(missing_ok=True)
        override_parent.rmdir(); call('systemctl', 'daemon-reload')
        shutil.rmtree(root)  # Only this invocation's isolated synthetic fixture.
    return receipts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true'); parser.add_argument('--output', required=True)
    parser.add_argument('--slice', required=True); parser.add_argument('--harness-unit', required=True)
    args = parser.parse_args()
    assert args.execute and os.geteuid() == 0 and Path('/proc/1/comm').read_text().strip() == 'systemd'
    pwd.getpwuid(1000)  # Exercise the existing nonroot identity; never create accounts.
    assert re.fullmatch(r'powaudit6certify[a-z0-9]{8,32}\.slice', args.slice)
    assert re.fullmatch(r'pow-audit6-certify-[a-z0-9]{8,32}\.service', args.harness_unit)
    actual = call('systemctl', 'show', args.harness_unit, '--property=MainPID,Slice').stdout
    assert 'MainPID=' + str(os.getpid()) + '\n' in actual and 'Slice=' + args.slice + '\n' in actual
    group = Path('/sys/fs/cgroup') / args.slice
    quota, period = (group / 'cpu.max').read_text().split()
    assert quota != 'max' and int(quota) / int(period) <= .25
    assert int((group/'memory.max').read_text()) <= 536870912
    assert int((group/'memory.high').read_text()) <= 402653184
    assert int((group/'memory.swap.max').read_text()) == 0 and int((group/'pids.max').read_text()) <= 256
    # IO bandwidth caps must be present, not only a relative IOWeight setting.
    limits = (group/'io.max').read_text()
    io = {line.split()[0]: dict(value.split('=',1) for value in line.split()[1:]) for line in limits.splitlines()}
    for key in {device('/tmp'), device(ROOT)}:
        assert key in io and io[key]['rbps'] != 'max' and io[key]['wbps'] != 'max'
        assert int(io[key]['rbps']) <= 10485760 and int(io[key]['wbps']) <= 5242880
    available = next(int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    assert available >= 1024*1024*1024, 'Less than 1 GiB memory available before fixture'
    output = Path(args.output)
    assert str(output).startswith('/tmp/pow-audit6-worker-systemd-results-') and output.resolve() == output and not output.exists()
    output.mkdir(mode=0o700)
    result = {'model': 'proofofwork-audit6-worker-manager-fixture-v1', 'passed': False, 'startedAt': time.time(),
      'controllerSha256': sha(ADAPTER), 'harnessSha256': sha(__file__), 'resourceEnvelope': {
        name: (group/name).read_text().strip() for name in ['cpu.max','memory.max','memory.high','memory.swap.max','pids.max','io.max']},
      'limit': 'Actual manager/cgroup, nonroot source access, unit override and separate timer recovery with a synthetic worker/verifier. Does not certify production canonical replay, database role visibility, Core/API readiness or a production transition.'}
    try:
        result['cases'] = [scenario(name, output, args.slice, args.harness_unit)
          for name in ['kill-armed', 'freeze-child-refusal', 'kill-frozen', 'kill-retired', 'kill-candidate', 'failed-candidate']]
        result['passed'] = all(case['passed'] for case in result['cases'])
    finally:
        result['finishedAt'] = time.time(); save(output/'receipt.json', result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
