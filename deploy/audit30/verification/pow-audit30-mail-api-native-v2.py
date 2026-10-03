#!/usr/bin/python3 -I
"""Creation-only fixed code/request custody and owned loopback mailbox audit.

No live unit, PostgreSQL, Core, timer, configuration, data, or body repair.
Requires a separately reviewed raw request and fresh five-service identity.
"""
import base64, datetime as dt, hashlib, json, os, re, signal, stat, sys, time, types
from pathlib import Path

APPROVAL = '6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
COLLECTOR_SHA = 'f481dda3347f928f659b9c43f1c869014f4d0320cdae6cbcd5555b99c4959887'
UTILITY_SHA = '7d6b6fe8337db471b2de3147dcff528916b4d8c7629e4d344803913469084b55'
BASE = Path('/usr/local/lib/proofofwork-audit30-mail-api-population')
EVIDENCE = Path('/data/proofofwork-release-backups')
PRIVATE_PARENT = '/data/proofofwork-release-backups/audit30-mail-body-census-20261003T011506Z'
MAX_OUT = 2 * 1024**2
MAX_ERR = 65536
PROPS = {'Type': 'exec', 'RemainAfterExit': 'yes', 'User': 'root', 'Group': 'root',
         'CPUQuota': '25%', 'CPUWeight': '10', 'IOWeight': '10', 'Nice': '15',
         'MemoryMax': '512M', 'MemorySwapMax': '0', 'TasksMax': '16', 'RuntimeMaxSec': '11min',
         'TimeoutStopSec': '20s', 'Restart': 'no', 'KillMode': 'control-group', 'UMask': '0077',
         'NoNewPrivileges': 'yes', 'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
         'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes',
         'PrivateDevices': 'yes', 'PrivateIPC': 'yes', 'PrivateNetwork': 'no',
         'RestrictAddressFamilies': 'AF_UNIX AF_INET', 'ReadWritePaths': '',
         'InaccessiblePaths': '/run/postgresql /var/lib/postgresql /data/bitcoin /etc/bitcoin /etc/proofofwork-api',
         'LimitFSIZE': '2M'}
class NativeInterrupted(RuntimeError):
    pass


B = None
LAUNCHED = False
OBSERVER = None
WORK = None
REQUEST_SHA = None
CAPTURES = {}


def need(value, code):
    if not value:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def pairs(rows):
    value = {}
    for key, item in rows:
        need(key not in value, 'Duplicate request key')
        value[key] = item
    return value


def parse(raw):
    return json.loads(raw, object_pairs_hook=pairs)


def load_utility(raw):
    need(len(raw) <= 65536 and sha(raw) == UTILITY_SHA, 'Frozen owner utility bytes')
    module = types.ModuleType('reviewed_audit_owner')
    module.__file__ = '<reviewed-treasury-v7-7d6b>'
    exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    module.FIELDS = module.FIELDS + ('LimitFSIZE',)
    module.validate_properties = validate_properties
    return module


def request(value):
    keys = {'schema', 'approvalSha256', 'mode', 'collectorBase64', 'utilityBase64',
            'collectorRequestBase64', 'collectorRequestSha256'}
    need(isinstance(value, dict) and set(value) == keys
         and value['schema'] == 'pow-audit30-mail-api-native-request-v1'
         and value['approvalSha256'] == APPROVAL and value['mode'] in ('prepare', 'run'), 'Exact native request')
    files = {name: base64.b64decode(value[key], validate=True) for name, key in
             [('collector.py', 'collectorBase64'), ('owner-utility.py', 'utilityBase64'),
              ('request.json', 'collectorRequestBase64')]}
    need(sha(files['collector.py']) == COLLECTOR_SHA and len(files['collector.py']) <= 65536
         and sha(files['owner-utility.py']) == UTILITY_SHA and len(files['owner-utility.py']) <= 65536,
         'Fixed native source bytes')
    raw = files['request.json']
    need(len(raw) <= 65536 and sha(raw) == value['collectorRequestSha256'], 'Raw collector request hash')
    child = parse(raw)
    need(set(child) == {'schema', 'approvalSha256', 'stage', 'runId', 'sourceSha256', 'liveFive'}
         and child['schema'] == 'pow-audit30-mail-api-population-request-v1'
         and child['approvalSha256'] == APPROVAL and child['stage'] in ('baseline', 'after')
         and child['sourceSha256'] == COLLECTOR_SHA, 'Collector exact approved scope')
    rid = child['runId']
    need(isinstance(rid, str) and re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z', rid)
         and dt.datetime.strptime(rid, '%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ') == rid,
         'Collector calendar run ID')
    units = ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service',
             'proofofwork-api.service', 'proofofwork-indexer-worker.service')
    need(set(child['liveFive']) == set(units), 'Exact live-five scope')
    for item in child['liveFive'].values():
        need(set(item) == {'MainPID', 'InvocationID'} and isinstance(item['MainPID'], str)
             and re.fullmatch(r'[1-9][0-9]*', item['MainPID'])
             and isinstance(item['InvocationID'], str) and re.fullmatch(r'[0-9a-f]{32}', item['InvocationID']),
             'Exact fresh live-five tuple')
    need(encoded(child) == raw, 'Canonical child request no LF')
    return files, child


def canonical_dir(path, mode=None):
    s = path.lstat()
    need(path.resolve(strict=True) == path and stat.S_ISDIR(s.st_mode)
         and s.st_uid == s.st_gid == 0 and not stat.S_IMODE(s.st_mode) & 0o022
         and (mode is None or stat.S_IMODE(s.st_mode) == mode)
         and not os.listxattr(path, follow_symlinks=False), 'Root canonical directory')


def package_proof(path, files):
    canonical_dir(path, 0o750)
    need(sorted(p.name for p in path.iterdir()) == sorted(files), 'Exact package member set')
    proof = {}
    for name, expected in files.items():
        raw, s = B.read_file(path / name, 65536)
        mode = 0o600 if name == 'request.json' else 0o440
        need(raw == expected and s.st_uid == s.st_gid == 0 and stat.S_IMODE(s.st_mode) == mode
             and not os.listxattr(path / name, follow_symlinks=False), 'Exact immutable package member')
        proof[name] = {'sha256': sha(raw), 'bytes': len(raw), 'metadata': list(B.ident(s))}
    return proof


def prepare(files, child):
    canonical_dir(BASE.parent)
    if not BASE.exists():
        os.mkdir(BASE, 0o755)
        os.chmod(BASE, 0o755)
        B.dir_fsync(BASE.parent)
    canonical_dir(BASE)
    path = BASE / child['runId']
    need(not path.exists() and not path.is_symlink(), 'Creation-only package collision')
    os.mkdir(path, 0o750)
    os.chmod(path, 0o750)
    B.dir_fsync(BASE)
    for name, raw in files.items():
        mode = 0o600 if name == 'request.json' else 0o440
        fd = os.open(path / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as f:
            os.fchmod(f.fileno(), mode)
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
    B.dir_fsync(path)
    return {'schema': 'pow-audit30-mail-api-package-prepared-v1', 'packagePath': str(path),
            'package': package_proof(path, files), 'productionMutation': False, 'nativeUnitLaunched': False}


def actual_properties(path, evidence):
    return {'MemoryMax': str(512 * 1024**2), 'MemorySwapMax': '0', 'CPUQuotaPerSecUSec': '250ms',
            'CPUWeight': '10', 'IOWeight': '10', 'Nice': '15', 'TasksMax': '16',
            'RuntimeMaxUSec': '11min', 'TimeoutStopUSec': '20s', 'Restart': 'no', 'KillMode': 'control-group',
            'NoNewPrivileges': 'yes', 'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
            'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes', 'PrivateDevices': 'yes',
            'PrivateIPC': 'yes', 'PrivateNetwork': 'no', 'ReadWritePaths': '',
            'ReadOnlyPaths': str(path) + ' ' + PRIVATE_PARENT,
            'InaccessiblePaths': PROPS['InaccessiblePaths'], 'StandardInput': 'file',
            'StandardOutput': 'file', 'StandardError': 'file', 'UMask': '0077', 'RemainAfterExit': 'yes',
            'LimitFSIZE': str(MAX_OUT)}


def validate_properties(value, evidence):
    path = BASE / evidence.name.rsplit('-', 1)[1]
    expected = actual_properties(path, evidence)
    need(all(value[k] == v for k, v in expected.items())
         and set(value['RestrictAddressFamilies'].split()) == {'AF_UNIX', 'AF_INET'}, 'Actual native resource drift')


def owner_class():
    class Owner(B.Observer):
        def identity(self, value, cleanup=False):
            inv = value['InvocationID']
            fixed = value['ControlGroup'] == '/system.slice/' + self.unit
            successful = value['ControlGroup'] == '' and value['MainPID'] == '0' \
                and value['ActiveState'] == 'active' and value['SubState'] == 'exited' \
                and value['Result'] == 'success' and value['ExecMainStatus'] == '0'
            failed_owned = cleanup and self.owned is not None and inv == self.owned \
                and value['ControlGroup'] == '' and value['MainPID'] == '0' \
                and value['ActiveState'] == 'failed' and value['SubState'] == 'failed'
            need(value['LoadState'] == 'loaded' and re.fullmatch(r'[0-9a-f]{32}', inv)
                 and value['MainPID'].isdigit() and (fixed or successful or failed_owned)
                 and value['Type'] == 'exec' and value['Transient'] == 'yes'
                 and value['RemainAfterExit'] == 'yes' and value['User'] == value['Group'] == 'root'
                 and (self.owned is None or self.owned == inv), 'Typed fixed owned API collector identity')
            return inv

        def output_proof(self, value):
            fragment = Path('/run/systemd/transient') / self.unit
            need(value['FragmentPath'] == str(fragment) and value['DropInPaths'] == value['SourcePath'] == '',
                 'Fixed transient fragment')
            canonical_dir(fragment.parent)
            raw, s = B.read_file(fragment, 65536)
            need(s.st_uid == s.st_gid == 0 and not os.listxattr(fragment, follow_symlinks=False),
                 'Root output fragment')
            path = BASE / self.evidence.name.rsplit('-', 1)[1]
            desired = {'StandardInput': 'file:' + str(path / 'request.json'),
                       'StandardOutput': 'file:' + str(self.evidence / 'public-result.json'),
                       'StandardError': 'file:' + str(self.evidence / 'stderr.log')}
            section, found = '', {}
            for line in raw.decode().splitlines():
                line = line.strip()
                if not line or line.startswith(('#', ';')):
                    continue
                need(not line.endswith('\\'), 'Transient continuation')
                if line.startswith('['):
                    need(line.endswith(']'), 'Transient section')
                    section = line[1:-1]
                    continue
                key, sep, item = line.partition('=')
                if key in desired:
                    need(sep and section == 'Service' and key not in found and item == desired[key],
                         'Exact transient stdin/stdout/stderr')
                    found[key] = item
            need(found == desired, 'Transient output directive missing')
            return {'sha256': sha(raw), 'metadata': list(B.ident(s)), 'selectedOutputDirectives': found,
                    'actualOutputPropertyProbeSha256': B.OUTPUT_PROPERTY_PROBE_SHA}
    return Owner


def command(path, child_raw_sha):
    return ['/usr/bin/python3', '-I', '-B', str(path / 'collector.py'), child_raw_sha]


def launch_properties(path, evidence):
    return PROPS | {'ReadOnlyPaths': str(path) + ' ' + PRIVATE_PARENT,
                    'StandardInput': 'file:' + str(path / 'request.json'),
                    'StandardOutput': 'file:' + str(evidence / 'public-result.json'),
                    'StandardError': 'file:' + str(evidence / 'stderr.log')}


def state(value):
    if value['MainPID'] == '0' and value['ActiveState'] == 'active' and value['SubState'] == 'exited':
        need(value['Result'] == 'success' and value['ExecMainStatus'] == '0', 'Collector exit refusal')
        return 'finished'
    need(value['MainPID'].isdigit() and int(value['MainPID']) > 0
         and (value['ActiveState'], value['SubState']) in (('active', 'running'), ('activating', 'start')),
         'Collector non-success state')
    return 'waiting'


def capture_identity(path):
    s = path.lstat()
    need(path.resolve(strict=True) == path and stat.S_ISREG(s.st_mode)
         and s.st_uid == s.st_gid == 0 and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600
         and not os.listxattr(path, follow_symlinks=False), 'Fixed capture authority')
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink)


def capture(path, limit):
    need(path.name in CAPTURES and capture_identity(path) == CAPTURES[path.name], 'Capture identity drift')
    proof, raw = B.capture_proof(path, limit)
    need(capture_identity(path) == CAPTURES[path.name], 'Capture identity changed while hashing')
    return proof, raw


def run(files, child):
    global LAUNCHED, OBSERVER, WORK, CAPTURES
    path = BASE / child['runId']
    proof = package_proof(path, files)
    canonical_dir(EVIDENCE)
    evidence = EVIDENCE / ('audit30-mail-api-' + child['stage'] + '-' + child['runId'])
    need(not evidence.exists() and not evidence.is_symlink(), 'Creation-only API evidence collision')
    unit = 'proofofwork-audit30-mail-api-' + child['stage'] + '-' + child['runId'] + '.service'
    observer = owner_class()(unit, evidence, time.monotonic() + 720, command(path, sha(files['request.json'])))
    B.require_absent(observer)
    before = B.live_snapshot(observer)
    need({u: {k: r[k] for k in ('MainPID', 'InvocationID')} for u, r in before.items()} == child['liveFive'],
         'Fresh approved live-five baseline changed')
    os.mkdir(evidence, 0o700)
    B.dir_fsync(EVIDENCE)
    WORK, OBSERVER = evidence, observer
    B.durable(evidence / 'intent.json', {'schema': 'pow-audit30-mail-api-native-intent-v1',
              'requestSha256': REQUEST_SHA, 'childRequestSha256': sha(files['request.json']), 'package': proof,
              'liveBefore': before, 'productionMutation': False})
    for name in ('public-result.json', 'stderr.log'):
        fd = os.open(evidence / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        os.fsync(fd)
        os.close(fd)
        CAPTURES[name] = capture_identity(evidence / name)
    B.dir_fsync(evidence)
    argv = ['/usr/bin/systemd-run', '--quiet', '--no-block', '--unit=' + unit]
    for key, value in launch_properties(path, evidence).items():
        argv.extend(['--property', key + '=' + value])
    argv += ['--', *observer.expected_argv]
    LAUNCHED = True
    observer.command(argv)
    while True:
        need(time.monotonic() < observer.deadline, 'Native API deadline')
        actual = observer.observe()
        need((evidence / 'public-result.json').stat().st_size <= MAX_OUT
             and (evidence / 'stderr.log').stat().st_size <= MAX_ERR, 'Native public output cap')
        if state(actual) == 'finished':
            break
        time.sleep(.5)
    out, raw = capture(evidence / 'public-result.json', MAX_OUT)
    err, _ = capture(evidence / 'stderr.log', MAX_ERR)
    need(err['bytes'] == 0, 'Native API stderr')
    result = parse(raw)
    need(result.get('schema') == 'pow-audit30-mail-api-population-result-v1'
         and result.get('stage') == child['stage'] and result.get('sourceSha256') == COLLECTOR_SHA
         and result.get('populationRows') == 619 and result.get('actorCount') == 33
         and all(result.get(k) is True for k in ('privateCaptureUnchanged', 'sourceUnchanged', 'liveFiveUnchanged'))
         and all(result.get(k) is False for k in ('productionMutation', 'privatePayloadExported', 'addressesExported',
                                                'financialCompleteness'))
         and result.get('newCoreCalls') == result.get('sqlCalls') == 0, 'Expected public result qualification')
    if child['stage'] == 'after':
        need(result.get('afterCutoverAccepted') is True and result.get('allExpectedRowsVerified') is True
             and result.get('rowsMatchingRawAndIdentity') == 619, 'After-cutover all619 acceptance')
    need(package_proof(path, files) == proof and B.live_snapshot(observer) == before, 'Final package/live custody')
    return {'result': result, 'captures': {'stdout': out, 'stderr': err}, 'package': proof,
            'liveBefore': before, 'lastRetainedProperties': actual, 'unitSnapshots': observer.snapshots}


def main():
    global B, REQUEST_SHA
    need(os.geteuid() == os.getegid() == 0 and sys.flags.isolated and os.uname().nodename == 'pow-bitcoin-01'
         and len(sys.argv) == 2 and re.fullmatch(r'[0-9a-f]{64}', sys.argv[1]), 'Fixed isolated root invocation')
    old = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGALRM)}
    def interrupted(*_):
        raise NativeInterrupted('native-fixed-signal-or-deadline')
    for s in old:
        signal.signal(s, interrupted)
    signal.setitimer(signal.ITIMER_REAL, 750)
    failure = None
    result = None
    cleanup = None
    try:
        raw = sys.stdin.buffer.read(256 * 1024 + 1)
        need(len(raw) <= 256 * 1024 and sha(raw) == sys.argv[1], 'Exact native raw request')
        REQUEST_SHA = sha(raw)
        value = parse(raw)
        files, child = request(value)
        B = load_utility(files['owner-utility.py'])
        if value['mode'] == 'prepare':
            return prepare(files, child)
        try:
            result = run(files, child)
        except BaseException as error:
            failure = {'errorClass': type(error).__name__, 'privateReasonSha256': sha(str(error).encode())}
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                signal.signal(s, signal.SIG_IGN)
            if OBSERVER is not None and LAUNCHED:
                if OBSERVER.owned is None:
                    try:
                        OBSERVER.observe(True)
                    except BaseException as error:
                        if OBSERVER.owned is None:
                            cleanup = {'verified': False, 'errorClass': type(error).__name__,
                                       'privateReasonSha256': sha(str(error).encode())}
                if OBSERVER.owned is not None:
                    try:
                        cleanup = OBSERVER.stop_owned()
                        cleanup['verified'] = cleanup.get('attempted') is True
                    except BaseException as error:
                        cleanup = {'verified': False, 'errorClass': type(error).__name__,
                                   'privateReasonSha256': sha(str(error).encode())}
            accepted = failure is None and cleanup is not None and cleanup.get('verified') is True
            if WORK is not None:
                captures = {}
                for name, cap in (('public-result.json', MAX_OUT), ('stderr.log', MAX_ERR)):
                    try:
                        captures[name] = capture(WORK / name, cap)[0]
                    except BaseException as error:
                        captures[name] = {'boundedHashAccepted': False, 'errorClass': type(error).__name__}
                final_live = None
                final_package = None
                try:
                    final_live = B.live_snapshot(OBSERVER)
                except BaseException as error:
                    final_live = {'metadataAvailable': False, 'errorClass': type(error).__name__}
                try:
                    final_package = package_proof(BASE / child['runId'], files)
                except BaseException as error:
                    final_package = {'metadataAvailable': False, 'errorClass': type(error).__name__}
                if accepted and (final_live != result['liveBefore'] or final_package != result['package']
                                 or any(p.get('boundedHashAccepted') is False for p in captures.values())):
                    accepted = False
                    failure = {'errorClass': 'ValueError', 'privateReasonSha256': sha(b'Post-cleanup custody drift')}
                receipt = {'schema': 'pow-audit30-mail-api-native-outcome-v1', 'requestSha256': REQUEST_SHA,
                           'status': 'passed' if accepted else 'failed', 'failure': failure, 'cleanup': cleanup,
                           'result': result, 'captures': captures, 'unitSnapshots': OBSERVER.snapshots,
                           'liveAfterCleanup': final_live, 'packageAfterCleanup': final_package,
                           'productionMutation': False, 'automaticRetry': False, 'backendResourceCapClaimed': False}
                binding = B.durable(WORK / ('completed.json' if accepted else 'failed.json'), receipt)
                need(accepted, 'Native API comparison retained failure evidence')
                return {'schema': receipt['schema'], 'status': 'passed', 'outcome': binding,
                        'stage': child['stage'], 'all619Accepted': result['result']['allExpectedRowsVerified'],
                        'captures': captures, 'unitStopVerified': True, 'productionMutation': False}
            need(accepted, 'Native API pre-intent refusal')
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        for s, handler in old.items():
            signal.signal(s, handler)


if __name__ == '__main__':
    try:
        result = main()
    except BaseException as error:
        print(json.dumps({'schema': 'pow-audit30-mail-api-native-refusal-v1', 'errorClass': type(error).__name__,
                          'privateReasonSha256': sha(str(error).encode()), 'productionMutation': False}))
        raise SystemExit(1)
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))
