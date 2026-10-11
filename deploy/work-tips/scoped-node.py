#!/usr/bin/python3 -I
"""Hash-fenced WORK tips overlay; Search must already be held by its pinned controller.

Changes only the fixed runtime allowlist and API/dependent-worker plus pinned gateway
activation. No database, config, timer, Git or authority-service mutation.
Every source already exists; rollback restores all five original modules.
"""
import base64, datetime, fcntl, hashlib, json, os, re, stat, subprocess, sys
from pathlib import Path, PurePosixPath

ROOT = Path('/opt/proofofwork-api')
BACKUPS = Path('/data/proofofwork-release-backups')
LOCK = Path('/run/proofofwork-audit29-ops.lock')
HOLD = Path('/run/proofofwork-search-release.hold')
UNITS = ('proofofwork-api.service', 'proofofwork-indexer-worker.service')
PROTECTED = ('proofofwork-indexer-worker.service',)
GATEWAY = ('proofofwork-api-wg.socket', 'proofofwork-api-wg.service')
AUTHORITY = ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service')
SEARCH = ('proofofwork-search-index.service', 'proofofwork-search-index.timer')
ALLOWED = frozenset({'server/proof-api.mjs', 'scripts/backfill-proof-indexer.mjs',
    'server/boost-projection.mjs', 'server/boost-growth.mjs',
    'src/shared/protocol/boostTip.mjs'})
NEW = frozenset()
WORKER_SOURCE = 'scripts/backfill-proof-indexer.mjs'
API_STATE_FIELDS = ('ActiveState', 'MainPID', 'WorkingDirectory', 'InvocationID',
    'ExecMainStartTimestampMonotonic')
ENTRYPOINTS = ('server/proof-api.mjs', 'scripts/backfill-proof-indexer.mjs',
    'scripts/backfill-proof-search.mjs')
IMPORT = re.compile(r'''(?:\b(?:import|export)\s+[^;]*?\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]''')
SHA = re.compile('[0-9a-f]{64}\\Z')
ROOT_JSON = frozenset({'package.json', 'package-lock.json',
    'WORK_MARKET_V1_REFUNDS_959061.json', 'WORK_MARKET_V2_STALE_REFUND_REVIEW_959301.json'})

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

def dependency_closure(root, candidates=None, entrypoints=ENTRYPOINTS):
    candidates = candidates or {}; seen = set(); pending = list(entrypoints)
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

def worker_only(m):
    # Derived only from validated candidate bytes and live-before hash fences;
    # callers cannot select a lighter activation policy in the manifest.
    return {row['path'] for row in m['sources'] if row['before'] != row['after']} == {WORKER_SOURCE}

def api_preservation():
    args = ['show', UNITS[0]]
    for field in API_STATE_FIELDS: args.extend(('-p', field))
    row = dict(line.split('=', 1) for line in ctl(*args).splitlines())
    require(set(row) == set(API_STATE_FIELDS) and row['ActiveState'] == 'active' and
        row['WorkingDirectory'] == str(ROOT) and
        all(row[key].isdigit() and int(row[key]) > 0
            for key in ('MainPID', 'ExecMainStartTimestampMonotonic')) and
        re.fullmatch('[0-9a-f]{32}', row['InvocationID']), 'Invalid preserved API process')
    return {'unitSha256': sha(safe_read(Path('/etc/systemd/system')/UNITS[0], 65536)),
        'state': row}

def require_preserved_runtime(m, preserved):
    require(isinstance(preserved, dict) and set(preserved) == {'api', 'gateway'} and
        api_preservation() == preserved['api'], 'Preserved API process or unit changed')
    actual = gateway_states()
    require(actual == preserved['gateway'], 'Preserved gateway process changed')
    require_gateway_baseline(actual, m['gateway'])
    for name, expected in m['gateway']['files'].items():
        require(sha(safe_read(Path('/etc/systemd/system')/name, 65536)) == expected,
            'Preserved gateway unit changed')

def validate_manifest(m):
    require(m.get('format') == 'proof-of-work-work-tips-scoped-runtime-v1', 'Wrong manifest')
    require(m.get('services') == list(UNITS) and re.fullmatch(
        '[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', m.get('releaseId', '')), 'Wrong release/services')
    require(all(re.fullmatch('[0-9a-f]{40}', m.get(key, '')) for key in
        ('sourceCommit', 'baselineHead')), 'Invalid Git pins')
    require(m['releaseId'].split('-',1)[0] == m['sourceCommit'][:12], 'Release does not bind source commit')
    rows = m.get('sources')
    require(isinstance(rows, list) and len(rows) == len(ALLOWED) and
        {row.get('path') for row in rows} == ALLOWED, 'Wrong WORK tips source allowlist')
    candidates = {}
    for row in rows:
        require(set(row) == {'path', 'before', 'after', 'base64'}, 'Unknown source fields')
        require(row['before'] is None and row['path'] in NEW or isinstance(row['before'], str)
            and SHA.fullmatch(row['before']), 'Invalid source baseline')
        require(isinstance(row['after'], str) and SHA.fullmatch(row['after']), 'Invalid candidate pin')
        raw = base64.b64decode(row['base64'], validate=True)
        require(len(raw) <= 10*1024**2 and sha(raw) == row['after'], 'Candidate bytes differ')
        raw.decode('utf-8'); candidates[row['path']] = raw
    deps = m.get('dependencies')
    require(isinstance(deps, dict) and 1 <= len(deps) <= 2000 and
        {'package.json', 'package-lock.json'} <= deps.keys(), 'Missing dependencies')
    for path, expected in deps.items():
        source_path(path); require(isinstance(expected, str) and SHA.fullmatch(expected), 'Invalid dependency pin')
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
    return candidates

def fence(root, m, candidates):
    for row in m['sources']:
        raw = safe_read(root/row['path'], absent=row['before'] is None)
        require((sha(raw) if raw is not None else None) == row['before'], 'Source changed: '+row['path'])
    for path, expected in m['dependencies'].items():
        require(sha(safe_read(root/path)) == expected, 'Dependency changed: '+path)
    required = dependency_closure(root) | dependency_closure(root, candidates)
    require(required <= m['dependencies'].keys() | NEW, 'Unpinned runtime dependency')
    if worker_only(m):
        api_paths = dependency_closure(root, entrypoints=(ENTRYPOINTS[0],)) | \
            dependency_closure(root, candidates, entrypoints=(ENTRYPOINTS[0],))
        require(WORKER_SOURCE not in api_paths, 'Changed indexer is loaded by API')
        require(all(row['before'] == row['after'] for row in m['sources'] if row['path'] in api_paths),
            'Worker-only activation changes API imports')

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

def require_runtime_drained(m, preserved=None):
    if worker_only(m):
        require_protected_services(m['protectedServices'], 'drained')
        require_preserved_runtime(m, preserved)
    else: require_apps_drained()

def drain_runtime(m, preserved=None):
    if worker_only(m):
        require_preserved_runtime(m, preserved)
        subprocess.run(['/usr/bin/systemctl', 'stop', UNITS[1]], check=True, timeout=120)
        require_runtime_drained(m, preserved)
    else: drain_apps()

def restore_verified_apps(m, authority, search, hold_raw, preserved=None):
    if worker_only(m):
        require_preserved_runtime(m, preserved)
        subprocess.run(['/usr/bin/systemctl', 'start', UNITS[1]], check=True, timeout=60)
        require_preserved_runtime(m, preserved)
    else: restore_apps(m['gateway'])
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

def install(root, backup, rows, metadata, candidate, stamp, changed_only=False):
    for row in rows:
        raw = safe_read(root/row['path'], absent=row['path'] in NEW)
        current = sha(raw) if raw is not None else None
        require(current == row['before'] if candidate else current in (row['before'], row['after']),
            'Refuse overwrite of unexpected source: '+row['path'])
    for index, row in enumerate(rows):
        if changed_only and row['before'] == row['after']: continue
        if not candidate and row['before'] is None: continue
        target = root/row['path']; temp = target.with_name(target.name+'.work-tips-'+('candidate-' if candidate else 'rollback-')+stamp)
        durable(temp, (backup/f'{"candidate" if candidate else "before"}-{index}.mjs').read_bytes())
        uid, gid, mode = metadata[row['path']]; os.chown(temp, uid, gid); os.chmod(temp, mode)
        os.replace(temp, target); sync(target.parent)

def main():
    require(os.geteuid() == 0 and sys.flags.isolated and len(sys.argv) == 1,
        'Root, python3 -I and manifest on stdin required')
    os.umask(0o077); raw = sys.stdin.buffer.read(20*1024**2+1)
    require(len(raw) <= 20*1024**2, 'Oversized manifest'); m = json.loads(raw); candidates = validate_manifest(m)
    for path in (ROOT, BACKUPS):
        info = path.lstat(); require(path.resolve(strict=True) == path and stat.S_ISDIR(info.st_mode)
            and not info.st_mode & 0o7022, 'Unsafe runtime/backup root')
    disk = os.statvfs(BACKUPS); require(disk.f_bavail*disk.f_frsize > 1024**3, 'Insufficient headroom')
    info = LOCK.lstat(); require(LOCK.resolve(strict=True) == LOCK and stat.S_ISREG(info.st_mode)
        and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), info.st_nlink) == (0,0,0o600,1), 'Unsafe ops lock')
    fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW); fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    require(identity(os.fstat(fd)) == identity(LOCK.stat()), 'Ops lock changed')
    head = subprocess.check_output(['/usr/bin/git','-c',f'safe.directory={ROOT}','-C',str(ROOT),
        'rev-parse','HEAD'],text=True).strip(); require(head == m['baselineHead'], 'Git identity changed')
    fence(ROOT, m, candidates)
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
    preserved = {'api':api_preservation(), 'gateway':gateway_states()} if worker_only(m) else None
    if preserved:
        require(all(preserved['api']['state'][key] == value
            for key, value in services[UNITS[0]].items()), 'API changed during baseline capture')
        require_preserved_runtime(m, preserved)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = BACKUPS/('work-tips-'+m['releaseId']+'-'+stamp); backup.mkdir(mode=0o700)
    receipt = {'format':m['format'], 'releaseId':m['releaseId'], 'sourceCommit':m['sourceCommit'],
        'baselineHead':head, 'manifestSha256':sha(raw), 'rollbackRoot':str(backup),
        'dependencyCount':len(m['dependencies']), 'authority':authority, 'gateway':m['gateway'],
        'protectedServices':m['protectedServices'], 'servicesBefore':services,
        'activationMode':'worker-only' if worker_only(m) else 'full-runtime',
        'preservedRuntime':preserved, 'installed':False,
        'rolledBack':False, 'sources':[{k:v for k,v in row.items() if k != 'base64'} for row in m['sources']]}
    def save():
        temp = backup/'receipt.tmp'; durable(temp,(json.dumps(receipt,indent=2)+'\n').encode())
        os.replace(temp,backup/'receipt.json'); sync(backup)
    metadata = {}
    for index, row in enumerate(m['sources']):
        path = ROOT/row['path']; before = safe_read(path,absent=row['before'] is None)
        info = path.stat() if before is not None else (ROOT/'src/shared/protocol/publishArticle.mjs').stat()
        metadata[row['path']] = (info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode))
        if before is not None: durable(backup/f'before-{index}.mjs',before)
        candidate = backup/f'candidate-{index}.mjs'; durable(candidate,candidates[row['path']])
        subprocess.run([str(node),'--check',str(candidate)],check=True,capture_output=True,timeout=30)
    durable(backup/'manifest.json',raw); save(); fence(ROOT,m,candidates)
    try:
        receipt['stopRequested']=True; save()
        drain_runtime(m, preserved)
        require_protected_services(m['protectedServices'], 'drained')
        require(states(AUTHORITY)==authority
            and states(SEARCH)==search and safe_read(HOLD,65536)==hold_raw,
            'Unrelated state changed'); fence(ROOT,m,candidates)
        receipt['sourceWritesStarted']=True; save()
        install(ROOT,backup,m['sources'],metadata,True,stamp,changed_only=worker_only(m)); receipt['installed']=True; save()
        require(all(sha(safe_read(ROOT/row['path']))==row['after'] for row in m['sources']), 'Installed bytes differ')
        require(all(sha(safe_read(ROOT/path))==expected for path,expected in m['dependencies'].items()
            if path not in ALLOWED), 'Unrelated source changed')
        require_runtime_drained(m, preserved)
        receipt['servicesAfter']=restore_verified_apps(m, authority, search, hold_raw, preserved)
        receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); save(); print(json.dumps(receipt),flush=True)
    except BaseException as error:
        receipt['errorClass']=type(error).__name__
        try:
            drain_runtime(m, preserved)
            if receipt.get('sourceWritesStarted'):
                install(ROOT,backup,m['sources'],metadata,False,stamp,changed_only=worker_only(m))
                if worker_only(m): fence(ROOT,m,candidates)
            receipt['servicesAfterRollback']=restore_verified_apps(m, authority, search, hold_raw, preserved)
            receipt['rolledBack']=True; receipt['newHelpersRetained']=bool(NEW)
        except BaseException as recovery_error:
            receipt['recoveryIncomplete']=True; receipt['recoveryErrorClass']=type(recovery_error).__name__
            save(); print(json.dumps(receipt),flush=True); raise
        save(); print(json.dumps(receipt),flush=True); raise

if __name__ == '__main__': main()
