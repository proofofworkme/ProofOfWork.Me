#!/usr/bin/python3 -I
"""One-file, source-pinned WORK batch write switch. Never changes read authority."""
import base64, datetime, fcntl, hashlib, json, os, re, shlex, signal, stat, subprocess, sys, time
from pathlib import Path

ROOT = Path('/opt/proofofwork-api')
HERE = Path(__file__).resolve().parent
DROPIN = Path('/etc/systemd/system/proofofwork-api.service.d/zzzzz-work-batch-writes.conf')
LOCK = Path('/run/proofofwork-audit29-ops.lock')
API = 'proofofwork-api.service'
WORKER = 'proofofwork-indexer-worker.service'
FIELDS = {'txid':'WORK_BATCH_DECLARATION_TXID', 'blockHeight':'WORK_BATCH_DECLARATION_HEIGHT',
    'blockHash':'WORK_BATCH_DECLARATION_BLOCK_HASH', 'blockTransactionIndex':'WORK_BATCH_DECLARATION_BLOCK_INDEX',
    'protocolVout':'WORK_BATCH_DECLARATION_PROTOCOL_VOUT', 'recordOrdinal':'WORK_BATCH_DECLARATION_RECORD_ORDINAL',
    'registryPaymentVout':'WORK_BATCH_DECLARATION_REGISTRY_PAYMENT_VOUT',
    'activationHeight':'WORK_BATCH_ACTIVATION_HEIGHT'}
SWITCH = 'WORK_BATCH_WRITES_ENABLED'
SHA = re.compile(r'[0-9a-f]{64}\Z')
COMMIT = re.compile(r'[0-9a-f]{40}\Z')
MIN_HEIGHT = 972965
MAX_INPUT = 2*1024*1024

def require(value, message):
    if not value: raise ValueError(message)

def sha(raw): return hashlib.sha256(raw).hexdigest()
def canonical(value): return json.dumps(value, sort_keys=True, separators=(',',':')).encode()
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

def public_pins(pins):
    require(isinstance(pins, dict), 'Missing declaration pins')
    result = {key:pins.get(key) for key in FIELDS}
    require(all(isinstance(result[k],str) and SHA.fullmatch(result[k]) for k in ('txid','blockHash')),
        'Invalid declaration hash')
    require(all(type(result[k]) is int and 0 <= result[k] <= 2147483647
        for k in FIELDS if k not in ('txid','blockHash')), 'Invalid declaration position')
    require(result['blockHeight'] >= MIN_HEIGHT and result['activationHeight'] == result['blockHeight']+1
        and result['recordOrdinal'] == 0 and result['registryPaymentVout'] < result['protocolVout'],
        'Invalid declaration boundary')
    return result

def values(pins, enabled):
    require(type(enabled) is bool, 'Non-boolean switch')
    return {**{name:str(public_pins(pins)[key]) for key,name in FIELDS.items()}, SWITCH:'1' if enabled else '0'}

def render(pins, enabled):
    return ('[Service]\n'+''.join('Environment='+key+'='+value+'\n'
        for key,value in values(pins,enabled).items())).encode()

def file_identity(path):
    info = path.lstat()
    return [info.st_dev,info.st_ino,info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode),info.st_size,info.st_mtime_ns]

def owned_at(h, path, owned, absent=False):
    raw = h['safe_read'](path,65536,absent=True)
    if raw is None:
        require(absent and owned is None, 'Owned drop-in disappeared')
        return None
    require(isinstance(owned,dict) and owned.get('identity') == file_identity(path)
        and owned.get('sha256') == sha(raw) and owned['identity'][2:5] == [0,0,0o644],
        'Refuse foreign or changed drop-in')
    require(raw == render(owned['pins'],owned['enabled']), 'Noncanonical owned drop-in')
    return owned

def owned_file(h, owned, absent=False):
    return owned_at(h,DROPIN,owned,absent)

def trusted_directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Noncanonical private directory')
    for parent in [path,*path.parents]:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and (not info.st_mode & 0o7022 or parent == Path('/tmp') and stat.S_IMODE(info.st_mode) == 0o1777),
            'Untrusted private directory ancestor')

def load_helper(approval):
    require(approval.get('format') == 'work-batch-activation-approval-v1' and
        COMMIT.fullmatch(approval.get('sourceCommit','')) and COMMIT.fullmatch(approval.get('runtimeHead','')),
        'Missing approved release identity')
    for key in ('controllerSha256','probeSha256','dormantControllerSha256','deploymentManifestSha256','deploymentReceiptSha256','runtimeStatusSha256'):
        require(isinstance(approval.get(key),str) and SHA.fullmatch(approval[key]), 'Missing reviewed source pin')
    require(sha(Path(__file__).read_bytes()) == approval['controllerSha256'] and
        sha((HERE/'probe.mjs').read_bytes()) == approval['probeSha256'], 'Activation source changed')
    helper = HERE.parent/'work-batch-sends/scoped-node.py'
    raw = helper.read_bytes()
    require(sha(raw) == approval['dormantControllerSha256'], 'Reviewed dormant controller changed')
    namespace = {'__name__':'_activation_reviewed_helper'}
    exec(compile(raw,str(helper),'exec'),namespace)
    return namespace

def runtime_fence(h, approval):
    rows = approval.get('runtime')
    require(isinstance(rows,dict) and 10 <= len(rows) <= 2000, 'Missing reviewed runtime closure')
    required = h['dependency_closure'](ROOT) | h['ALLOWED'] | h['ROOT_JSON']
    require(required <= rows.keys(), 'Unpinned runtime dependency')
    identities = {}
    for name,row in rows.items():
        h['source_path'](name)
        raw = h['safe_read'](ROOT/name)
        info = (ROOT/name).lstat()
        require(isinstance(row,dict) and sha(raw) == row.get('sha256') and
            [info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode)] ==
            [row.get('uid'),row.get('gid'),row.get('mode')], 'Reviewed runtime differs')
        identities[name] = file_identity(ROOT/name)
    git = subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),
        'rev-parse','HEAD'],text=True,timeout=10).strip()
    require(git == approval['runtimeHead'], 'Runtime Git identity changed')
    status = subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),
        'status','--porcelain=v1','--untracked-files=all'],timeout=10)
    require(sha(status) == approval['runtimeStatusSha256'], 'Runtime Git status changed')
    node = approval.get('node',{})
    path = Path(node.get('path','/invalid'))
    require(str(path).startswith('/opt/node-') and path.name == 'node' and
        sha(h['safe_read'](path,200*1024**2)) == node.get('sha256'), 'Reviewed Node runtime changed')
    return sha(canonical(identities))

def batch_env(environment):
    return {key:value for key,value in environment.items() if key.startswith('WORK_BATCH_')}

def configuration(h, owned):
    expected = values(owned['pins'],owned['enabled']) if owned else {}
    pins = {}
    manager = h['ctl']('show-environment')
    require(not batch_env(dict(item.split('=',1) for item in shlex.split(manager) if '=' in item)),
        'Foreign manager WORK batch configuration')
    pins['manager'] = manager
    for unit in (API,WORKER,*h['GATEWAY'],*h['AUTHORITY'],*h['SEARCH']):
        properties = {key:h['ctl']('show',unit,'--value','-p',key) for key in (
            'Environment','EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStart',
            'WorkingDirectory','FragmentPath','DropInPaths','User','Group','UnitFileState')}
        if properties['ExecStart'] or not unit.endswith(('.socket','.timer')):
            properties['ExecStart'] = h['normalize_exec_start'](properties['ExecStart'])
        if unit in (API,WORKER):
            require(not any('WORK_BATCH_' in properties[key] for key in ('PassEnvironment','UnsetEnvironment')),
                'Foreign inherited WORK batch configuration')
            environment = dict(item.split('=',1) for item in shlex.split(properties['Environment']) if '=' in item)
            require(batch_env(environment) == (expected if unit == API else {}), 'Effective systemd pins differ')
            # Normalize only the controlled Environment delta, leaving all private
            # values in memory and binding their digest.
            properties['Environment'] = shlex.join(sorted(key+'='+value for key,value in environment.items()
                if not key.startswith('WORK_BATCH_')))
        sources = {}
        pattern = r'(/[^\s]+) \(ignore_errors=(?:yes|no)\)'
        require(not re.sub(pattern,'',properties['EnvironmentFiles']).strip(), 'Unsupported environment files')
        for name in re.findall(pattern,properties['EnvironmentFiles']):
            raw = h['safe_read'](Path(name),1024*1024,absent=True)
            require(raw is None or b'WORK_BATCH_' not in raw, 'Foreign WORK batch environment file')
            sources[name] = {'sha256':sha(raw),'identity':file_identity(Path(name))} if raw is not None else None
        drops = shlex.split(properties['DropInPaths'])
        if str(DROPIN) in drops:
            require(unit == API and owned is not None, 'Unexpected activation drop-in')
            drops.remove(str(DROPIN))
        properties['DropInPaths'] = shlex.join(drops)
        for name in [properties['FragmentPath'],*drops]:
            require(name.startswith('/'), 'Unsupported systemd source')
            raw = h['safe_read'](Path(name),1024*1024)
            require(b'WORK_BATCH_' not in raw, 'Foreign WORK batch unit directive')
            sources[name] = {'sha256':sha(raw),'identity':file_identity(Path(name))}
        pins[unit] = {'properties':properties,'files':sources}
    owned_file(h,owned,absent=owned is None)
    return sha(canonical(pins))

def process_environment(h, owned, active_required=True):
    before = h['states']((API,WORKER))
    expected = values(owned['pins'],owned['enabled']) if owned else {}
    api = None
    for unit,row in before.items():
        if row['ActiveState'] != 'active':
            require(not active_required and row['ActiveState'] in ('inactive','failed') and row['MainPID'] == '0',
                'Unexpected application state')
            continue
        require(row['WorkingDirectory'] == str(ROOT), 'Unexpected application root')
        environment = h['process_environment'](row['MainPID'])
        require(batch_env(environment) == (expected if unit == API else {}), 'Process WORK batch pins differ')
        if unit == API: api = environment
    require(h['states']((API,WORKER)) == before, 'Application changed during environment read')
    return api

def probe(h, approval, owned=None, expected_pins=None):
    environment = process_environment(h,owned)
    node = approval['node']['path']
    pid = h['states']((API,))[API]['MainPID']
    require(os.readlink('/proc/'+pid+'/exe') == node, 'Running Node identity differs')
    # Process values are never written to a receipt, command line, log or file.
    completed = subprocess.run([node,str(HERE/'probe.mjs')],input=canonical({'expectedPins':expected_pins,'expectedWriteEnabled':bool(owned and owned['enabled'])}),
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,timeout=180,check=False)
    require(completed.returncode == 0 and len(completed.stdout) <= 65536, 'Independent activation evidence unavailable')
    result = json.loads(completed.stdout)
    require(result.get('format') == 'work-batch-activation-evidence-v1' and
        result.get('v8WriteAdmission') is True, 'Invalid activation evidence')
    public_pins(result.get('pins'))
    return result

def states_snapshot(h):
    return {'apps':h['states']((API,WORKER)), 'gateway':h['gateway_states'](),
        'authority':h['states'](h['AUTHORITY']), 'search':h['states'](h['SEARCH'])}

def gateway_pins(snapshot):
    return {'active':{unit:row['ActiveState'] for unit,row in snapshot['gateway'].items()},
        'unitFileStates':{unit:row['UnitFileState'] for unit,row in snapshot['gateway'].items()}}

def capture(h, approval, owned, operation):
    require(operation in ('stage-disabled','enable','disable'), 'Invalid capture operation')
    trusted_directory(DROPIN.parent)
    before = states_snapshot(h)
    config = configuration(h,owned)
    source = runtime_fence(h,approval)
    process_environment(h,owned,active_required=operation != 'disable')
    evidence = None if operation == 'disable' else probe(h,approval,owned)
    require(configuration(h,owned) == config and runtime_fence(h,approval) == source and
        states_snapshot(h) == before, 'Capture changed')
    return {'format':'work-batch-activation-capture-v1','capturedAt':stamp(),
        'operation':operation,'approvalSha256':sha(canonical(approval)),'configurationSha256':config,
        'runtimeIdentitySha256':source,'states':before,'owned':owned,'evidence':evidence}

def replace_owned(h, pins, enabled, owned, save):
    owned_file(h,owned,absent=owned is None)
    trusted_directory(DROPIN.parent)
    raw = render(pins,enabled)
    temp = DROPIN.with_name('.work-batch-activation-'+os.urandom(12).hex())
    fd = os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
    with os.fdopen(fd,'wb') as stream:
        os.fchown(stream.fileno(),0,0); os.fchmod(stream.fileno(),0o644)
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    candidate = {'identity':file_identity(temp),'sha256':sha(raw),'pins':public_pins(pins),'enabled':enabled}
    # Persist exact inode ownership before either publication path.
    save(candidate,'prepared')
    try:
        owned_file(h,owned,absent=owned is None)
        if owned is None:
            os.link(temp,DROPIN,follow_symlinks=False)
        else:
            # Move the incumbent before deciding it may be removed. A foreign
            # inode raced into the pathname is retained, never overwritten.
            quarantine = DROPIN.parent/('.work-batch-activation-recovery-'+os.urandom(12).hex())
            quarantine.mkdir(mode=0o700); h['sync'](DROPIN.parent)
            previous = quarantine/'previous.conf'
            candidate['quarantine'] = str(previous)
            save(candidate,'quarantine-prepared')
            h['rename_absent'](DROPIN,previous); h['sync'](DROPIN.parent); h['sync'](quarantine)
            try:
                owned_at(h,previous,owned)
                os.link(temp,DROPIN,follow_symlinks=False)
                h['sync'](DROPIN.parent)
                owned_file(h,candidate)
                owned_at(h,previous,owned)
            except BaseException:
                if not os.path.lexists(DROPIN):
                    h['rename_absent'](previous,DROPIN); h['sync'](DROPIN.parent); h['sync'](quarantine)
                # Preserve any raced foreign inode and all ambiguous recovery evidence.
                raise
            previous.unlink(); h['sync'](quarantine)
            quarantine.rmdir(); h['sync'](DROPIN.parent)
            del candidate['quarantine']
        h['sync'](DROPIN.parent)
        save(candidate,'published')
    finally:
        if os.path.lexists(temp) and file_identity(temp) == candidate['identity']: temp.unlink()
        h['sync'](DROPIN.parent)
    owned_file(h,candidate)
    return candidate

def restore_exact_apps(h, baseline):
    for unit in (API,WORKER):
        if baseline['apps'][unit]['ActiveState'] == 'active':
            h['ctl']('start',unit)
    for unit in h['GATEWAY']:
        if baseline['gateway'][unit]['ActiveState'] == 'active':
            h['ctl']('start',unit)
    actual = h['states']((API,WORKER))
    for unit,row in actual.items():
        expected = baseline['apps'][unit]['ActiveState']
        require(row['ActiveState'] == ('inactive' if expected == 'failed' else expected) and
            row['WorkingDirectory'] == str(ROOT) and
            (int(row['MainPID']) > 0 if expected == 'active' else row['MainPID'] == '0'),
            'Application state not restored')
    h['require_gateway_baseline'](h['gateway_states'](),gateway_pins(baseline))

def effective_disabled(h, owned):
    require(owned['enabled'] is False, 'Recovery must disable writes')
    process_environment(h,owned,active_required=False)
    # Chain readiness is intentionally not consulted for disablement.
    return True

def apply(h, approval, captured, operation, journal):
    require(captured.get('format') == 'work-batch-activation-capture-v1' and
        captured.get('operation') == operation and captured.get('approvalSha256') == sha(canonical(approval)),
        'Wrong captured operation')
    owned = captured.get('owned')
    require(operation == 'stage-disabled' and owned is None or
        operation in ('enable','disable') and owned is not None, 'Wrong ownership state')
    if operation == 'enable': require(owned['enabled'] is False, 'Enable requires owned disabled stage')
    require(states_snapshot(h) == captured['states'], 'Service state changed since capture')
    require(runtime_fence(h,approval) == captured['runtimeIdentitySha256'] and
        configuration(h,owned) == captured['configurationSha256'], 'Captured source/config changed')
    process_environment(h,owned,active_required=operation != 'disable')
    evidence = None if operation == 'disable' else probe(h,approval,owned,
        captured['evidence']['pins'])
    pins = public_pins(owned['pins'] if owned else evidence['pins'])
    require(operation == 'disable' or pins == public_pins(evidence['pins']), 'Staged pins conflict')
    baseline = captured['states']; before = owned
    receipt = {'format':'work-batch-activation-receipt-v1','operation':operation,'startedAt':stamp(),
        'sourceCommit':approval['sourceCommit'],'approvalSha256':sha(canonical(approval)),
        'captureSha256':sha(canonical(captured)),'pins':pins,'owned':owned,
        'evidence':evidence,'statesBefore':baseline,'complete':False,'recoveredDisabled':False}
    def save(candidate=None, phase=None):
        if candidate: receipt['intent'] = candidate
        if phase: receipt['phase'] = phase
        journal(receipt)
    def unchanged(current):
        require(runtime_fence(h,approval) == captured['runtimeIdentitySha256'] and
            configuration(h,current) == captured['configurationSha256'], 'Source/config changed during operation')
        require(h['states'](h['AUTHORITY']) == baseline['authority'] and
            h['states'](h['SEARCH']) == baseline['search'], 'Unrelated service changed')
    save(phase='preflight')
    stopped = False
    try:
        unchanged(owned)
        stopped = True
        h['drain_apps']()
        unchanged(owned)
        owned = replace_owned(h,pins,operation == 'enable',owned,save)
        receipt['owned'] = owned; save(phase='reload')
        h['ctl']('daemon-reload')
        unchanged(owned)
        restore_exact_apps(h,baseline)
        process_environment(h,owned,active_required=operation != 'disable')
        unchanged(owned)
        if operation == 'enable':
            receipt['postflightEvidence'] = probe(h,approval,owned,pins)
        else:
            effective_disabled(h,owned)
        receipt['complete'] = True; save(phase='complete')
        return receipt
    except BaseException:
        # Any enable error/timeout returns to disabled pins. Never restore
        # pre-activation source or erase the canonical marker.
        receipt['failed'] = True; save(phase='recovering-disabled')
        if stopped:
            h['drain_apps']()
            actual = receipt.get('intent',owned)
            try: owned_file(h,actual)
            except (ValueError,FileNotFoundError):
                owned_file(h,before,absent=before is None); actual = before
            if actual is None or actual['enabled']:
                actual = replace_owned(h,pins,False,actual,save)
            receipt['owned'] = actual
            h['ctl']('daemon-reload')
            unchanged(actual)
            restore_exact_apps(h,baseline)
            effective_disabled(h,actual)
            unchanged(actual)
            receipt['recoveredDisabled'] = True; save(phase='failed-disabled')
        raise

def private_journal(path):
    trusted_directory(path.parent)
    require(path.parent != Path('/tmp') and stat.S_IMODE(path.parent.stat().st_mode) == 0o700 and
        not os.path.lexists(path), 'Private new receipt path required')
    def write(value):
        temp = path.parent/('.receipt-'+os.urandom(12).hex())
        fd = os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as stream:
            stream.write(canonical(value)+b'\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp,path)
        fd = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
    return write

def main():
    require(os.geteuid() == 0 and sys.flags.isolated and len(sys.argv) == 1,
        'Use root isolated Python with reviewed request on stdin')
    os.umask(0o077)
    raw = sys.stdin.buffer.read(MAX_INPUT+1)
    require(len(raw) <= MAX_INPUT, 'Oversized activation request')
    request = json.loads(raw)
    h = load_helper(request['approval'])
    info = LOCK.lstat()
    require(LOCK.resolve(strict=True) == LOCK and stat.S_ISREG(info.st_mode) and info.st_nlink == 1
        and [info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode)] == [0,0,0o600], 'Unsafe operations lock')
    fd = os.open(LOCK,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        require(h['identity'](os.fstat(fd)) == h['identity'](LOCK.lstat()), 'Operations lock changed')
        if request['mode'] == 'capture':
            result = capture(h,request['approval'],request.get('owned'),request['operation'])
        else:
            require(request['mode'] == 'apply' and sha(canonical(request['capture'])) ==
                request.get('captureSha256'), 'Captured approval differs')
            receipt = Path(request['receiptPath'])
            journal = private_journal(receipt)
            signal.signal(signal.SIGTERM,lambda *_: (_ for _ in ()).throw(TimeoutError('Activation interrupted')))
            result = apply(h,request['approval'],request['capture'],request['capture']['operation'],journal)
        print(json.dumps(result,sort_keys=True),flush=True)
    finally: os.close(fd)

if __name__ == '__main__':
    try: main()
    except BaseException:
        # No stderr from subprocesses, private environment or RPC details.
        print('WORK batch activation controller failed; inspect the private receipt.',file=sys.stderr)
        sys.exit(1)
