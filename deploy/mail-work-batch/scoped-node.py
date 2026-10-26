#!/usr/bin/python3 -I
"""Hash-fenced WORK batch sends overlay; Search must already be held by its pinned controller.

Changes only the fixed runtime allowlist and API/dependent-worker plus pinned gateway
activation. No database, config, timer, Git or authority-service mutation.
Original source inodes remain in private quarantine. After source-write intent, recovery is forward-only; no active read era is rolled back.
"""
import base64, ctypes, datetime, fcntl, hashlib, json, os, re, shlex, stat, subprocess, sys, time, urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path('/opt/proofofwork-api')
QUARANTINE_PARENT = Path('/opt')
BACKUPS = Path('/data/proofofwork-release-backups')
LOCK = Path('/run/proofofwork-audit29-ops.lock')
HOLD = Path('/run/proofofwork-search-release.hold')
UNITS = ('proofofwork-api.service', 'proofofwork-indexer-worker.service')
PROTECTED = UNITS
GATEWAY = ('proofofwork-api-wg.socket', 'proofofwork-api-wg.service')
AUTHORITY = ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service')
SEARCH = ('proofofwork-search-index.service', 'proofofwork-search-index.timer')
NEW = frozenset({
    'server/work-mail-batch-declaration.mjs', 'server/work-mail-batch-runtime.mjs',
    'server/db/work-mail-batch-discovery.mjs', 'server/work-mail-batch-selection.mjs', 'server/work-mail-batch-transaction.mjs',
    'server/db/work-mail-batch-reader.mjs', 'src/shared/protocol/workMailBatch.mjs'})
ALLOWED = NEW | frozenset({
    'server/proof-api.mjs', 'server/db/proof-index-reader.mjs',
    'server/work-amo-v5-raw.mjs', 'scripts/backfill-proof-indexer.mjs'})
METADATA_TEMPLATE = 'src/shared/protocol/publishArticle.mjs'
# Must match the final accepted pre-batch release before planning or deployment.
BASE_SOURCE_COMMIT = '6e45b83948ad69da14ae0fede2cfc049ff64a62d'
ENTRYPOINTS = ('server/proof-api.mjs', 'scripts/backfill-proof-indexer.mjs',
    'scripts/backfill-proof-search.mjs', 'scripts/run-proof-indexer-worker.mjs')
IMPORT = re.compile(r'''(?:\b(?:import|export)\s+[^;]*?\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]''')
SHA = re.compile('[0-9a-f]{64}\\Z')
ROOT_JSON = frozenset({'package.json', 'package-lock.json',
    'WORK_MARKET_V1_REFUNDS_959061.json', 'WORK_MARKET_V2_STALE_REFUND_REVIEW_959301.json'})

ACCEPTED_OVERLAYS = Path('/etc/proofofwork-retention/node-source-overlays.json')

def require(value, message):
    if not value: raise ValueError(message)

def sha(raw): return hashlib.sha256(raw).hexdigest()

def identity(info):
    return tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_mode',
        'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))

def source_path(value):
    require(isinstance(value, str), 'Non-text source path')
    p = PurePosixPath(value)
    require(str(p) == value and not p.is_absolute() and '\\' not in value and
        not any(part in ('', '.', '..') for part in value.split('/')) and
        not any(ord(c) < 32 or ord(c) == 127 for c in value), 'Unsafe source path')
    require(value in ROOT_JSON or
        value.startswith(('server/', 'scripts/', 'src/shared/protocol/', 'src/features/identity/'))
        and value.endswith(('.mjs', '.js', '.json', '.sql')), 'Unapproved dependency path')
    return value

def safe_read(path, limit=10*1024**2, absent=False):
    require(path.is_absolute() and path.parent.resolve(strict=True) == path.parent,
        'Noncanonical parent')
    if absent and not os.path.lexists(path): return None
    info = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(info.st_mode) and
        info.st_nlink == 1 and not info.st_mode & 0o7022 and info.st_size <= limit,
        'Unsafe source file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        require(identity(os.fstat(stream.fileno())) == identity(info), 'Source changed')
        raw = stream.read(limit+1)
        require(identity(os.fstat(stream.fileno())) == identity(info), 'Source changed')
    require(identity(path.lstat()) == identity(info) and len(raw) == info.st_size,
        'Source changed')
    return raw

def relative_import(parent, target):
    parts = list(PurePosixPath(parent).parent.parts)
    for part in target.split('/'):
        if part == '..':
            require(parts, 'Import escaped runtime'); parts.pop()
        elif part not in ('', '.'): parts.append(part)
    return source_path('/'.join(parts))

def dependency_closure(root, candidates=None):
    candidates = candidates or {}; seen = set(); pending = list(ENTRYPOINTS)
    while pending:
        path = pending.pop()
        if path in seen: continue
        require(len(seen) < 2000, 'Oversized dependency closure'); seen.add(source_path(path))
        raw = candidates.get(path)
        if raw is None: raw = safe_read(root/path)
        for target in IMPORT.findall(raw.decode('utf-8')):
            dependency = relative_import(path, target)
            if dependency.endswith(('.mjs', '.js', '.json')): pending.append(dependency)
    return seen

def validate_manifest(m):
    require(m.get('format') == 'proof-of-work-mail-work-batch-scoped-runtime-v1', 'Wrong manifest')
    require(m.get('baseSourceCommit') == BASE_SOURCE_COMMIT, 'Wrong approved base source commit')
    require(m.get('services') == list(UNITS) and re.fullmatch(
        '[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', m.get('releaseId', '')), 'Wrong release/services')
    require(all(re.fullmatch('[0-9a-f]{40}', m.get(key, '')) for key in
        ('sourceCommit', 'baselineHead')), 'Invalid Git pins')
    require(m['releaseId'].split('-',1)[0] == m['sourceCommit'][:12], 'Release does not bind source commit')
    probe=base64.b64decode(m.get('probeBase64',''),validate=True)
    require(0<len(probe)<=256*1024 and sha(probe)==m.get('probeSha256'),'Missing candidate probe pin')
    require(SHA.fullmatch(m.get('acceptedInventorySha256','')),'Missing accepted overlay inventory pin')
    rows = m.get('sources')
    require(isinstance(rows, list) and len(rows) == len(ALLOWED) and
        {row.get('path') for row in rows} == ALLOWED, 'Wrong WORK batch sends source allowlist')
    candidates = {}
    for row in rows:
        require(set(row) == {'path', 'before', 'after', 'base64'}, 'Unknown source fields')
        require((row['before'] is None) == (row['path'] in NEW) and
            (row['before'] is None or isinstance(row['before'], str) and SHA.fullmatch(row['before'])),
            'Invalid creation-only source baseline')
        require(isinstance(row['after'], str) and SHA.fullmatch(row['after']), 'Invalid candidate pin')
        raw = base64.b64decode(row['base64'], validate=True)
        require(len(raw) <= 10*1024**2 and sha(raw) == row['after'], 'Candidate bytes differ')
        raw.decode('utf-8'); candidates[row['path']] = raw
    metadata = m.get('sourceMetadata')
    require(isinstance(metadata, dict) and set(metadata) == ALLOWED, 'Missing exact source metadata')
    require(all(isinstance(row, dict) and set(row) == {'uid', 'gid', 'mode'}
        and all(type(row[key]) is int and row[key] >= 0 for key in row)
        and row['mode'] <= 0o777 and not row['mode'] & 0o022
        for row in metadata.values()), 'Unsafe source metadata')
    deps = m.get('dependencies')
    require(isinstance(deps, dict) and 1 <= len(deps) <= 2000 and
        {'package.json', 'package-lock.json'} <= deps.keys(), 'Missing dependencies')
    require(not NEW.intersection(deps) and METADATA_TEMPLATE in deps,
        'Creation-only helpers must be absent; metadata template must be pinned')
    for path, expected in deps.items():
        source_path(path); require(isinstance(expected, str) and SHA.fullmatch(expected), 'Invalid dependency pin')
    dependency_metadata = m.get('dependencyMetadata')
    require(isinstance(dependency_metadata, dict) and set(dependency_metadata) == set(deps),
        'Missing exact dependency metadata')
    require(all(isinstance(row, dict) and set(row) == {'uid', 'gid', 'mode'}
        and all(type(row[key]) is int and row[key] >= 0 for key in row)
        and row['mode'] <= 0o777 and not row['mode'] & 0o022
        for row in dependency_metadata.values()), 'Unsafe dependency metadata')
    require(all(metadata[name] == dependency_metadata[METADATA_TEMPLATE] for name in NEW),
        'New helper metadata differs from pinned template')
    require(isinstance(m.get('dormantConfigurationSha256'),str) and
        SHA.fullmatch(m['dormantConfigurationSha256']), 'Missing dormant configuration pin')
    require(isinstance(m.get('nodeSha256'), str) and SHA.fullmatch(m['nodeSha256']), 'Missing Node pin')
    protected = m.get('protectedServices')
    require(isinstance(protected, dict) and set(protected) == {'files', 'states'}
        and set(protected['files']) == set(PROTECTED)
        and set(protected['states']) == set(PROTECTED), 'Missing protected service pins')
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in protected['files'].values())
        and all(isinstance(row, dict) and set(row) == {'ActiveState', 'MainPID', 'WorkingDirectory'}
            and row['ActiveState'] == 'active' and isinstance(row['MainPID'], str)
            and row['MainPID'].isdigit() and int(row['MainPID']) > 0
            and row['WorkingDirectory'] == str(ROOT) for row in protected['states'].values()),
        'Invalid protected service pins')
    gateway = m.get('gateway')
    require(isinstance(gateway, dict) and set(gateway) == {'files', 'active', 'unitFileStates'}
        and all(isinstance(gateway[key], dict) and set(gateway[key]) == set(GATEWAY)
            for key in gateway), 'Missing gateway pins')
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in gateway['files'].values())
        and all(value in ('active', 'inactive') for value in gateway['active'].values())
        and all(isinstance(value, str) and value in ('enabled', 'disabled', 'static')
            for value in gateway['unitFileStates'].values()), 'Invalid gateway pins')
    hold = m.get('searchHold')
    require(isinstance(hold, dict) and set(hold) == {'markerSha256', 'bindings'} and
        SHA.fullmatch(hold['markerSha256']), 'Missing Search hold')
    bindings = hold['bindings']
    require(isinstance(bindings, dict) and bindings.get('releaseId') == m['releaseId'] and
        set(bindings.get('files', {})) == set(SEARCH) and
        all(SHA.fullmatch(value) for value in bindings['files'].values()), 'Wrong Search bindings')
    require(isinstance(m.get('sourceIdentities'),dict) and set(m['sourceIdentities'])==ALLOWED
        and isinstance(m.get('sourceParents'),dict) and set(m['sourceParents'])==ALLOWED,
        'Missing source inode/parent pins')
    require(all(m['sourceIdentities'][name] is None if name in NEW else
        isinstance(m['sourceIdentities'][name],list) and len(m['sourceIdentities'][name])==7
        and all(type(v) is int and v>=0 for v in m['sourceIdentities'][name]) for name in ALLOWED),
        'Invalid baseline source inode pins')
    require(all(isinstance(v,list) and len(v)==5 and all(type(x) is int and x>=0 for x in v)
        for v in m['sourceParents'].values()), 'Invalid source parent pins')
    legacy=m.get('legacyBatchStatus',{})
    require(legacy.get('protocol')=='work-batch-v1' and legacy.get('network')=='livenet'
        and all(legacy.get(k) is True for k in ('active','writeEnabled','ready')),
        'Missing preserved active v1 status')
    return candidates

def fence(root, m, candidates):
    for row in m['sources']:
        raw = safe_read(root/row['path'], absent=row['before'] is None)
        require((sha(raw) if raw is not None else None) == row['before'], 'Source changed: '+row['path'])
    for path, expected in m['dependencies'].items():
        require(sha(safe_read(root/path)) == expected, 'Dependency changed: '+path)
    metadata_fence(root, m['dependencyMetadata'])
    required = dependency_closure(root) | dependency_closure(root, candidates)
    require(required <= m['dependencies'].keys() | NEW, 'Unpinned runtime dependency')

def metadata_fence(root, metadata, installed=False):
    for name, expected in metadata.items():
        if name in NEW and not installed:
            require(not os.path.lexists(root/name), 'Creation-only helper already exists: '+name)
            info = (root/METADATA_TEMPLATE).lstat()
        else:
            info = (root/name).lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) ==
                (expected['uid'], expected['gid'], expected['mode']),
            'Source metadata changed: '+name)

def reject_activation_environment(environment):
    require(not any(value.strip() and
        (key.startswith('WORK_MAIL_BATCH_DECLARATION_') or key == 'WORK_MAIL_BATCH_ACTIVATION_HEIGHT')
        or key == 'WORK_MAIL_BATCH_WRITES_ENABLED' and value == '1'
        for key, value in environment.items()), 'Dormant deployment refuses WORK batch activation configuration')

def process_environment(pid):
    require(isinstance(pid, str) and pid.isdigit() and int(pid) > 0, 'Invalid runtime PID')
    with open('/proc/'+pid+'/environ','rb') as stream: raw = stream.read(1024*1024+1)
    require(len(raw) <= 1024*1024, 'Oversized runtime environment')
    return dict(item.decode('utf-8').split('=',1) for item in raw.split(b'\0') if b'=' in item)

def inspect_batch_environment_file(raw):
    # Empty/zero assignments are the only needed dormant forms. Do not attempt
    # to emulate systemd's multiline quoting or continuation grammar.
    for line in raw.decode('utf-8').splitlines():
        if not re.match(r'^\s*WORK_MAIL_BATCH_',line): continue
        matched = re.fullmatch(r'\s*(WORK_MAIL_BATCH_[A-Z0-9_]+)\s*=\s*(.*?)\s*',line)
        require(matched is not None, 'Ambiguous WORK batch environment configuration')
        key, value = matched.groups()
        empty = ('', '""', "''")
        allowed = empty + ('0', '"0"', "'0'") if key == 'WORK_MAIL_BATCH_WRITES_ENABLED' else empty
        require(value in allowed, 'Dormant deployment refuses WORK batch activation configuration')

def normalize_exec_start(value):
    # systemctl includes process state in ExecStart; retain the exact command.
    stamp = r'\[(?:n/a|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} UTC)\]'
    fields = ('argv[]', 'ignore_errors', 'start_time', 'stop_time', 'pid', 'code', 'status')
    require(all(value.count(' ; '+field+'=') == 1 for field in fields),
        'Unsupported ExecStart serialization')
    match = re.fullmatch(
        r'(\{ path=/[^\s;{}]+ ; argv\[\]=[^\r\n{}]+ ; ignore_errors=(?:yes|no))'
        r' ; start_time='+stamp+r' ; stop_time='+stamp+
        r' ; pid=(?:0|[1-9][0-9]*) ; code=(?:\(null\)|exited|killed)'
        r' ; status=(?:0|[1-9][0-9]*)(?:/(?:0|[A-Z][A-Z0-9]*))? \}', value)
    require(match is not None, 'Unsupported ExecStart serialization')
    return (match.group(1)+' ; start_time=[n/a] ; stop_time=[n/a]'
        ' ; pid=0 ; code=(null) ; status=0/0 }')


def restart_configuration_pin():
    manager = ctl('show-environment')
    reject_activation_environment(dict(item.split('=',1) for item in shlex.split(manager) if '=' in item))
    pins = {'managerEnvironment':manager}
    for unit in (*UNITS,*GATEWAY):
        properties = {key:ctl('show',unit,'--value','-p',key) for key in
            ('Environment','EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStart','WorkingDirectory','FragmentPath','DropInPaths','Listen','Service','Accept','Requires','PartOf')}
        require(not any(name.startswith('WORK_MAIL_BATCH_') for name in shlex.split(properties['PassEnvironment'])),
            'Dormant deployment refuses inherited WORK batch configuration')
        reject_activation_environment(dict(item.split('=',1) for item in
            shlex.split(properties['Environment']) if '=' in item))
        if unit.endswith('.socket'):
            require(properties['ExecStart']=='','Unexpected socket command')
        else:
            properties['ExecStart'] = normalize_exec_start(properties['ExecStart'])
        files = properties['EnvironmentFiles']
        pattern = r'(/[^\s]+) \(ignore_errors=(?:yes|no)\)'
        require(not re.sub(pattern,'',files).strip(), 'Unsupported environment-file configuration')
        source_pins = {}
        for name in re.findall(pattern,files):
            raw = safe_read(Path(name),1024*1024,absent=True)
            source_pins[name] = sha(raw) if raw is not None else None
            if raw is not None: inspect_batch_environment_file(raw)
        for name in [properties['FragmentPath'], *shlex.split(properties['DropInPaths'])]:
            require(name.startswith('/'), 'Unsupported service configuration path')
            source_pins[name] = sha(safe_read(Path(name),1024*1024))
        pins[unit] = {'properties':properties,'files':source_pins}
    # Only this digest leaves the function. Environment values remain private.
    return sha(json.dumps(pins,sort_keys=True,separators=(',',':')).encode())

def require_restart_configuration(expected):
    require(restart_configuration_pin() == expected, 'Restart configuration changed')

def require_dormant_configuration():
    before = states(UNITS); api_environment = None
    for unit, row in before.items():
        require(row['ActiveState'] == 'active', 'Dormant preflight requires active runtime')
        environment = process_environment(row['MainPID'])
        reject_activation_environment(environment)
        if unit == UNITS[0]: api_environment = environment
    restart_configuration_pin()
    require(states(UNITS) == before, 'Runtime changed during dormant preflight')
    return api_environment


def require_legacy_status():
    environment = require_dormant_configuration()
    port = environment.get('PORT','8081')
    require(port.isdigit() and 1 <= int(port) <= 65535, 'Invalid local API port')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for attempt in range(12):
        try:
            with opener.open('http://127.0.0.1:'+port+'/api/v1/work-batch-status',timeout=5) as response:
                raw=response.read(65537)
                require(response.status==200 and len(raw)<=65536,'Invalid existing batch response')
                value=json.loads(raw)
            require(value.get('protocol')=='work-batch-v1' and value.get('network')=='livenet'
                and all(value.get(k) is True for k in ('active','writeEnabled','ready')),
                'Existing batch v1 is not ready')
            return {key:value[key] for key in ('protocol','network','active','writeEnabled','ready',
                'declarationTxid','activationHeight','limits','registryFeeProofs')}
        except (OSError,ValueError):
            if attempt==11:raise ValueError('Existing batch v1 unavailable') from None
            time.sleep(1)

def require_dormant_status():
    environment = require_dormant_configuration()
    port = environment.get('PORT','8081')
    require(port.isdigit() and 1 <= int(port) <= 65535, 'Invalid local API port')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    value = None
    for attempt in range(12):
        try:
            with opener.open('http://127.0.0.1:'+port+'/api/v1/work-mail-batch-status',timeout=5) as response:
                raw = response.read(65537)
                require(response.status == 200 and len(raw) <= 65536, 'Invalid dormant API response')
                value = json.loads(raw)
            break
        except (OSError, ValueError):
            if attempt == 11: raise ValueError('Dormant API postflight unavailable') from None
            time.sleep(1)
    require(value.get('protocol') == 'work-mail-batch-v1' and value.get('network') == 'livenet'
        and all(value.get(key) is False for key in ('active','writeEnabled','ready'))
        and value.get('limits') == {'minRecipients':1,'maxRecipients':256,'maxPayloadBytes':65536}
        and value.get('registryFeeProofs') == 546
        and value.get('declarationTxid') is None and value.get('activationHeight') is None
        and value.get('reasonCode') == 'work-mail-batch-declaration-unconfigured',
        'WORK batch postflight is not exactly dormant')
    return {key:value[key] for key in ('protocol','network','active','writeEnabled','ready',
        'limits','registryFeeProofs','reasonCode')}

def ctl(*args):
    return subprocess.check_output(['/usr/bin/systemctl', *args], text=True, timeout=30,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}).strip()

def states(units):
    return {unit: dict(line.split('=', 1) for line in ctl('show', unit, '-p', 'ActiveState',
        '-p', 'MainPID', '-p', 'WorkingDirectory').splitlines()) for unit in units}

def require_protected_services(pins, phase='baseline'):
    require(phase in ('baseline', 'drained', 'restored'), 'Unknown protected service phase')
    actual = states(PROTECTED)
    if phase == 'baseline':
        require(actual == pins['states'], 'Protected service changed')
    elif phase == 'drained':
        require(all(row['ActiveState'] == 'inactive' and row['MainPID'] == '0'
            and row['WorkingDirectory'] == str(ROOT) for row in actual.values()),
            'Dependent worker not drained')
    else:
        require(all(row['ActiveState'] == 'active' and row['WorkingDirectory'] == str(ROOT)
            and row['MainPID'].isdigit() and int(row['MainPID']) > 0 for row in actual.values()),
            'Dependent worker not restored')
    for name, expected in pins['files'].items():
        require(sha(safe_read(Path('/etc/systemd/system')/name,65536)) == expected,
            'Protected service unit changed')

def require_search_held(search):
    service, timer = search[SEARCH[0]], search[SEARCH[1]]
    require(service['ActiveState'] in ('inactive','failed') and service['MainPID'] == '0'
        and timer['ActiveState'] == 'inactive', 'Search not held')

def gateway_states():
    return {unit: dict(line.split('=', 1) for line in ctl('show', unit,
        '-p', 'ActiveState', '-p', 'UnitFileState', '-p', 'MainPID').splitlines()) for unit in GATEWAY}

def require_gateway_baseline(actual, pins):
    require(all(actual[unit]['ActiveState'] == pins['active'][unit]
        and actual[unit]['UnitFileState'] == pins['unitFileStates'][unit]
        for unit in GATEWAY), 'Gateway activation or enablement changed')

def require_apps_drained():
    gateway = gateway_states()
    require(all(row['ActiveState'] == 'inactive' for row in gateway.values())
        and gateway[GATEWAY[1]]['MainPID'] == '0'
        and all(row['ActiveState'] == 'inactive' and row['MainPID'] == '0'
            for row in states(UNITS).values()), 'Apps or gateway not drained')

def drain_apps():
    # Disable socket activation before stopping its Requires=API proxy. This
    # matches the accepted Audit23 drain and prevents a request canceling stop.
    for unit in (*GATEWAY, UNITS[1], UNITS[0]):
        subprocess.run(['/usr/bin/systemctl', 'stop', unit], check=True, timeout=120)
    require_apps_drained()

def restore_apps(gateway_pins):
    for unit in UNITS:
        subprocess.run(['/usr/bin/systemctl', 'start', unit], check=True, timeout=60)
    for unit in GATEWAY:
        if gateway_pins['active'][unit] == 'active':
            subprocess.run(['/usr/bin/systemctl', 'start', unit], check=True, timeout=60)
    require(all(row['ActiveState'] == 'active' and row['WorkingDirectory'] == str(ROOT)
        and row['MainPID'].isdigit() and int(row['MainPID']) > 0
        for row in states(UNITS).values()), 'Runtime services not restored')
    require_gateway_baseline(gateway_states(), gateway_pins)

def restore_verified_apps(m, authority, search, hold_raw):
    restore_apps(m['gateway'])
    require_protected_services(m['protectedServices'], 'restored')
    require(states(AUTHORITY)==authority and states(SEARCH)==search
        and safe_read(HOLD,65536)==hold_raw, 'Unrelated recovery state changed')
    return states(UNITS)

def durable(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output: output.write(raw); output.flush(); os.fsync(output.fileno())

def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def parent_identity(info):
    return [info.st_dev,info.st_ino,info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode)]

def creation_identity(info):
    # Inode ownership survives removing the temporary link; link-count/ctime do not.
    return [info.st_dev, info.st_ino, info.st_uid, info.st_gid,
        stat.S_IMODE(info.st_mode), info.st_size, info.st_mtime_ns]

def rename_absent(source, target):
    # Linux no-replace rename keeps concurrent destination files intact.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number), str(target))

def require_quarantine_parent(root):
    info = QUARANTINE_PARENT.lstat()
    require(QUARANTINE_PARENT.resolve(strict=True) == QUARANTINE_PARENT
        and stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o7022,
        'Unsafe root-owned quarantine parent')
    for name in NEW:
        parent = (root/name).parent
        require(parent.resolve(strict=True) == parent and parent.stat().st_dev == info.st_dev,
            'Quarantine must share every helper filesystem')

def rename_absent_at(source_fd, source_name, target_fd, target_name):
    libc=ctypes.CDLL(None,use_errno=True)
    rename=libc.renameat2
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    rename.restype=ctypes.c_int
    if rename(source_fd,os.fsencode(source_name),target_fd,os.fsencode(target_name),1)!=0:
        number=ctypes.get_errno();raise OSError(number,os.strerror(number))

def install(root, backup, rows, metadata, candidate, stamp, created, checkpoint=lambda:None,
            source_identities=None,source_parents=None):
    require(candidate is True, 'Mail installation is forward-only')
    require(set(source_identities or {})==ALLOWED and set(source_parents or {})==ALLOWED,
        'Missing captured source identities')
    require_quarantine_parent(root)
    def check(row):
        target=root/row['path']
        if row['path'] in NEW:
            require(not os.path.lexists(target) and source_identities[row['path']] is None,
                'Creation-only source already exists: '+row['path'])
        else:
            require(sha(safe_read(target))==row['before'], 'Refuse overwrite of unexpected source: '+row['path'])
            require(creation_identity(target.lstat())==source_identities[row['path']],
                'Refuse changed source inode: '+row['path'])
        require(parent_identity(target.parent.lstat())==source_parents[row['path']],
            'Refuse changed source parent: '+row['path'])
    for row in rows:check(row)
    quarantine=QUARANTINE_PARENT/('.proofofwork-mail-work-batch-'+stamp+'-'+os.urandom(8).hex())
    quarantine.mkdir(mode=0o700);sync(QUARANTINE_PARENT)
    require(quarantine.resolve(strict=True)==quarantine and quarantine.stat().st_uid==0
        and stat.S_IMODE(quarantine.stat().st_mode)==0o700,'Unsafe source quarantine')
    qfd=os.open(quarantine,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for index,row in enumerate(rows):
            check(row);target=root/row['path']
            pfd=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:
                require(parent_identity(os.fstat(pfd))==source_parents[row['path']],'Source parent changed')
                temp=quarantine/('candidate-'+str(index)+'.mjs')
                raw=safe_read(backup/f'candidate-{index}.mjs')
                require(sha(raw)==row['after'],'Candidate evidence changed')
                durable(temp,raw)
                uid,gid,mode=metadata[row['path']];os.chown(temp,uid,gid);os.chmod(temp,mode)
                fd=os.open(temp,os.O_RDONLY|os.O_NOFOLLOW)
                try:os.fsync(fd)
                finally:os.close(fd)
                temp_identity=creation_identity(temp.lstat())
                old_name='before-'+str(index)+'.mjs'
                created[row['path']]={'quarantine':str(quarantine),'beforePath':str(quarantine/old_name),
                    'candidatePath':str(temp),'baselineIdentity':source_identities[row['path']],
                    'candidateIdentity':temp_identity,'candidateSha256':row['after'],'published':False}
                checkpoint()
                check(row)
                if row['path'] not in NEW:
                    rename_absent_at(pfd,target.name,qfd,old_name)
                    os.fsync(pfd);os.fsync(qfd)
                    # Preserve raced-in foreign incumbents in private quarantine.
                    require(creation_identity((quarantine/old_name).lstat())==source_identities[row['path']]
                        and sha(safe_read(quarantine/old_name))==row['before'],'Moved source ownership changed')
                require(creation_identity(temp.lstat())==temp_identity and sha(safe_read(temp))==row['after'],
                    'Candidate inode or bytes changed before publication')
                require(parent_identity(target.parent.lstat())==source_parents[row['path']]
                    and parent_identity(os.fstat(pfd))==source_parents[row['path']],'Source parent changed')
                rename_absent_at(qfd,temp.name,pfd,target.name)
                require(creation_identity(os.stat(target.name,dir_fd=pfd,follow_symlinks=False))==temp_identity,
                    'Published source inode changed')
                os.fsync(qfd);os.fsync(pfd)
                require(sha(safe_read(target))==row['after'] and creation_identity(target.lstat())==temp_identity,
                    'Published source changed')
                created[row['path']]['published']=True;checkpoint()
            finally:os.close(pfd)
    finally:os.close(qfd)


def accepted_inventory_fence(expected):
    info=ACCEPTED_OVERLAYS.lstat()
    require(info.st_uid==0 and info.st_gid==0 and not info.st_mode & 0o022,
        'Unsafe accepted inventory')
    require(sha(safe_read(ACCEPTED_OVERLAYS,4*1024**2))==expected,'Accepted overlay inventory changed')

def source_identity_fence(root,m):
    for name in ALLOWED:
        target=root/name
        require(parent_identity(target.parent.lstat())==m['sourceParents'][name],'Source parent changed')
        require((not os.path.lexists(target) and m['sourceIdentities'][name] is None) if name in NEW else
            creation_identity(target.lstat())==m['sourceIdentities'][name],'Source identity changed')

def installed_source_fence(root,m,created):
    require(set(created)==ALLOWED,'Missing source publication journal')
    for row in m['sources']:
        target=root/row['path'];owned=created[row['path']]
        require(owned.get('published') is True and
            parent_identity(target.parent.lstat())==m['sourceParents'][row['path']] and
            creation_identity(target.lstat())==owned['candidateIdentity'] and
            sha(safe_read(target))==row['after'],'Installed source ownership changed')

def prepare_probe(backup,m,candidates):
    raw=base64.b64decode(m['probeBase64'],validate=True)
    require(sha(raw)==m['probeSha256'],'Candidate probe changed')
    probe=backup/'activation-probe.mjs';durable(probe,raw)
    root=backup/'probe-runtime';root.mkdir(mode=0o700)
    for name in sorted(set(m['dependencies'])|ALLOWED):
        value=candidates[name] if name in candidates else safe_read(ROOT/name)
        expected=next(row['after'] for row in m['sources'] if row['path']==name) if name in candidates else m['dependencies'][name]
        require(sha(value)==expected,'Probe source changed')
        target=root/name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700);durable(target,value)
    (root/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
    return probe,root

def predeployment_probe(node,probe,root,environment,m):
    require(sha(safe_read(probe))==m['probeSha256'],'Candidate probe changed')
    for name in set(m['dependencies'])|ALLOWED:
        expected=next(row['after'] for row in m['sources'] if row['path']==name) if name in ALLOWED else m['dependencies'][name]
        require(sha(safe_read(root/name))==expected,'Probe source changed')
    result=subprocess.run([str(node),str(probe)],input=json.dumps({'mode':'predeployment',
        'candidateRoot':str(root)}).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,
        env=environment,timeout=180,check=False)
    require(result.returncode==0 and len(result.stdout)<=65536,'Pre-declaration evidence unavailable')
    value=json.loads(result.stdout)
    require(value.get('format')=='work-mail-batch-predeployment-evidence-v1' and
        all(value.get(k) is True for k in ('qualified','declarationAbsent','markerAbsent','completeCanonicalPrefix')),
        'Pre-declaration proof refused')
    return value

def main():
    require(os.geteuid() == 0 and sys.flags.isolated and len(sys.argv) == 1,
        'Root, python3 -I and manifest on stdin required')
    os.umask(0o077); raw = sys.stdin.buffer.read(20*1024**2+1)
    require(len(raw) <= 20*1024**2, 'Oversized manifest'); m = json.loads(raw); candidates = validate_manifest(m)
    for path in (ROOT, BACKUPS):
        info = path.lstat(); require(path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
            and not info.st_mode & 0o7022, 'Unsafe runtime/backup root')
    require_quarantine_parent(ROOT)
    disk = os.statvfs(BACKUPS); require(disk.f_bavail*disk.f_frsize > 1024**3, 'Insufficient headroom')
    info = LOCK.lstat(); require(LOCK.resolve(strict=True) == LOCK and stat.S_ISREG(info.st_mode)
        and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), info.st_nlink) == (0,0,0o600,1), 'Unsafe ops lock')
    fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW); fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    require(identity(os.fstat(fd)) == identity(LOCK.stat()), 'Ops lock changed')
    head = subprocess.check_output(['/usr/bin/git','-c',f'safe.directory={ROOT}','-C',str(ROOT),
        'rev-parse','HEAD'],text=True).strip(); require(head == m['baselineHead'], 'Git identity changed')
    fence(ROOT, m, candidates)
    accepted_inventory_fence(m['acceptedInventorySha256'])
    metadata_fence(ROOT, m['sourceMetadata'])
    environment=require_dormant_configuration()
    source_identity_fence(ROOT,m)
    require_restart_configuration(m['dormantConfigurationSha256'])
    require(require_legacy_status()==m['legacyBatchStatus'],'Existing batch v1 changed')
    hold_raw = safe_read(HOLD,65536); require(sha(hold_raw) == m['searchHold']['markerSha256'], 'Search hold changed')
    hold_info = HOLD.stat()
    require((hold_info.st_uid,hold_info.st_gid,stat.S_IMODE(hold_info.st_mode),hold_info.st_nlink)
        == (0,0,0o600,1), 'Unsafe Search hold owner/mode')
    require(all(json.loads(hold_raw).get(k) == v for k,v in m['searchHold']['bindings'].items()), 'Wrong Search hold')
    for name, expected in m['searchHold']['bindings']['files'].items():
        require(sha(safe_read(Path('/etc/systemd/system')/name,65536)) == expected, 'Search unit changed')
    search, authority, services = states(SEARCH), states(AUTHORITY), states(UNITS)
    require_protected_services(m['protectedServices'])
    require_search_held(search)
    for name, expected in m['gateway']['files'].items():
        require(sha(safe_read(Path('/etc/systemd/system')/name,65536)) == expected, 'Gateway unit changed')
    require_gateway_baseline(gateway_states(), m['gateway'])
    require(all(row['ActiveState'] == 'active' and row['WorkingDirectory'] == str(ROOT) and
        int(row['MainPID']) > 0 for row in services.values()), 'Service baseline changed')
    require(all(row['ActiveState'] == 'active' and int(row['MainPID']) > 0
        for row in authority.values()), 'Authority unavailable')
    node = Path(os.readlink('/proc/'+services[UNITS[0]]['MainPID']+'/exe'))
    require(str(node).startswith('/opt/node-') and sha(safe_read(node,200*1024**2)) == m['nodeSha256'], 'Node changed')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = BACKUPS/('mail-work-batch-'+m['releaseId']+'-'+stamp); backup.mkdir(mode=0o700)
    receipt = {'format':m['format'], 'releaseId':m['releaseId'], 'sourceCommit':m['sourceCommit'],
        'baselineHead':head, 'manifestSha256':sha(raw), 'rollbackRoot':str(backup),
        'dormantConfigurationSha256':m['dormantConfigurationSha256'],
        'dependencyCount':len(m['dependencies']), 'authority':authority, 'gateway':m['gateway'],
        'protectedServices':m['protectedServices'], 'servicesBefore':services, 'installed':False,
        'sourceMetadata':m['sourceMetadata'], 'dependencyMetadata':m['dependencyMetadata'],
        'baseSourceCommit':m['baseSourceCommit'],
        'createdHelpers':{},
        'rolledBack':False, 'sources':[{k:v for k,v in row.items() if k != 'base64'} for row in m['sources']]}
    def save():
        temp = backup/'receipt.tmp'; durable(temp,(json.dumps(receipt,indent=2)+'\n').encode())
        os.replace(temp,backup/'receipt.json'); sync(backup)
    metadata = {}
    for index, row in enumerate(m['sources']):
        path = ROOT/row['path']; before = safe_read(path,absent=row['before'] is None)
        expected = m['sourceMetadata'][row['path']]
        metadata[row['path']] = tuple(expected[key] for key in ('uid','gid','mode'))
        if before is not None: durable(backup/f'before-{index}.mjs',before)
        candidate = backup/f'candidate-{index}.mjs'; durable(candidate,candidates[row['path']])
        subprocess.run([str(node),'--check',str(candidate)],check=True,capture_output=True,timeout=30)
    durable(backup/'manifest.json',raw); save(); fence(ROOT,m,candidates)
    probe,probe_root=prepare_probe(backup,m,candidates)
    try:
        receipt['beforeDrain']=predeployment_probe(node,probe,probe_root,environment,m);save()
        receipt['stopRequested']=True; save()
        drain_apps()
        require_protected_services(m['protectedServices'], 'drained')
        require(states(AUTHORITY)==authority
            and states(SEARCH)==search and safe_read(HOLD,65536)==hold_raw,
            'Unrelated state changed'); fence(ROOT,m,candidates)
        metadata_fence(ROOT, m['sourceMetadata'])
        source_identity_fence(ROOT,m)
        accepted_inventory_fence(m['acceptedInventorySha256'])
        require_restart_configuration(m['dormantConfigurationSha256'])
        receipt['afterDrain']=predeployment_probe(node,probe,probe_root,environment,m);save()
        fence(ROOT,m,candidates);source_identity_fence(ROOT,m)
        receipt['sourceWritesStarted']=True; save()
        install(ROOT,backup,m['sources'],metadata,True,stamp,receipt['createdHelpers'],save,
            m['sourceIdentities'],m['sourceParents']); receipt['installed']=True; save()
        require(all(sha(safe_read(ROOT/row['path']))==row['after'] for row in m['sources']), 'Installed bytes differ')
        metadata_fence(ROOT, m['sourceMetadata'], installed=True)
        metadata_fence(ROOT, m['dependencyMetadata'], installed=True)
        require(all(sha(safe_read(ROOT/path))==expected for path,expected in m['dependencies'].items()
            if path not in ALLOWED), 'Unrelated source changed')
        accepted_inventory_fence(m['acceptedInventorySha256'])
        installed_source_fence(ROOT,m,receipt['createdHelpers'])
        require_apps_drained()
        require_restart_configuration(m['dormantConfigurationSha256'])
        receipt['servicesAfter']=restore_verified_apps(m, authority, search, hold_raw)
        receipt['dormantStatus']=require_dormant_status()
        receipt['legacyBatchStatus']=require_legacy_status()
        require(receipt['legacyBatchStatus']==m['legacyBatchStatus'],'Existing batch v1 changed')
        installed_source_fence(ROOT,m,receipt['createdHelpers'])
        metadata_fence(ROOT,m['dependencyMetadata'],installed=True)
        require(all(sha(safe_read(ROOT/name))==expected for name,expected in m['dependencies'].items() if name not in ALLOWED),'Preserved dependency changed after restart')
        accepted_inventory_fence(m['acceptedInventorySha256'])
        require_restart_configuration(m['dormantConfigurationSha256'])
        receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); save(); print(json.dumps(receipt),flush=True)
    except BaseException as error:
        receipt['errorClass']=type(error).__name__
        try:
            drain_apps()
            if receipt.get('sourceWritesStarted'):
                receipt['sourceRollbackProhibited']=True
                receipt['forwardRecoveryRequired']=True
                raise ValueError('Source writes started; preserve new read code and recover forward')
            require(all((not os.path.lexists(ROOT/row['path'])) if row['before'] is None
                else sha(safe_read(ROOT/row['path'])) == row['before']
                for row in m['sources']), 'Rollback bytes differ')
            metadata_fence(ROOT, m['sourceMetadata'])
            # A source-drift refusal is not a verified rollback until every
            # preserved dependency also matches its captured baseline. Keep
            # applications drained and Search held if that fence cannot pass.
            fence(ROOT, m, candidates)
            require_restart_configuration(m['dormantConfigurationSha256'])
            receipt['servicesAfterRollback']=restore_verified_apps(m, authority, search, hold_raw)
            receipt['rolledBack']=True
        except BaseException as recovery_error:
            receipt['recoveryIncomplete']=True; receipt['recoveryErrorClass']=type(recovery_error).__name__
            save(); print(json.dumps(receipt),flush=True); raise
        save(); print(json.dumps(receipt),flush=True); raise

if __name__ == '__main__': main()
