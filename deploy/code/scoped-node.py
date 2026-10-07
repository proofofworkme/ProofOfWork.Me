#!/usr/bin/python3 -I
"""Hash-fenced Code overlay; Search must already be held by its pinned controller.

Changes only the fixed runtime allowlist and API/worker activation. No database,
config, timer, Git or authority-service mutation. New helpers survive rollback.
"""
import base64, datetime, fcntl, hashlib, json, os, re, stat, subprocess, sys
from pathlib import Path, PurePosixPath

ROOT = Path('/opt/proofofwork-api')
BACKUPS = Path('/data/proofofwork-release-backups')
LOCK = Path('/run/proofofwork-audit29-ops.lock')
HOLD = Path('/run/proofofwork-search-release.hold')
UNITS = ('proofofwork-api.service', 'proofofwork-indexer-worker.service')
AUTHORITY = ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service')
SEARCH = ('proofofwork-search-index.service', 'proofofwork-search-index.timer')
ALLOWED = frozenset({'server/canonical-op-return.mjs', 'server/code-repositories.mjs',
    'server/db/code-reader.mjs', 'server/db/proof-index-reader.mjs', 'server/proof-api.mjs',
    'server/proof-index-event-relations.mjs', 'server/search-projection.mjs',
    'server/work-amo-v5-raw.mjs', 'server/work-amo-v5.mjs', 'scripts/backfill-proof-indexer.mjs',
    'src/shared/protocol/codeRepository.mjs'})
NEW = frozenset({'server/code-repositories.mjs', 'server/db/code-reader.mjs',
    'src/shared/protocol/codeRepository.mjs'})
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
    require(m.get('format') == 'proof-of-work-code-scoped-runtime-v1', 'Wrong manifest')
    require(m.get('services') == list(UNITS) and re.fullmatch(
        '[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', m.get('releaseId', '')), 'Wrong release/services')
    require(all(re.fullmatch('[0-9a-f]{40}', m.get(key, '')) for key in
        ('sourceCommit', 'baselineHead')), 'Invalid Git pins')
    require(m['releaseId'].split('-',1)[0] == m['sourceCommit'][:12], 'Release does not bind source commit')
    rows = m.get('sources')
    require(isinstance(rows, list) and len(rows) == len(ALLOWED) and
        {row.get('path') for row in rows} == ALLOWED, 'Wrong Code source allowlist')
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

def ctl(*args):
    return subprocess.check_output(['/usr/bin/systemctl', *args], text=True, timeout=30,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}).strip()

def states(units):
    return {unit: dict(line.split('=', 1) for line in ctl('show', unit, '-p', 'ActiveState',
        '-p', 'MainPID', '-p', 'WorkingDirectory').splitlines()) for unit in units}

def require_search_held(search):
    service, timer = search[SEARCH[0]], search[SEARCH[1]]
    require(service['ActiveState'] in ('inactive','failed') and service['MainPID'] == '0'
        and timer['ActiveState'] == 'inactive', 'Search not held')

def durable(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output: output.write(raw); output.flush(); os.fsync(output.fileno())

def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def install(root, backup, rows, metadata, candidate, stamp):
    for row in rows:
        raw = safe_read(root/row['path'], absent=row['path'] in NEW)
        current = sha(raw) if raw is not None else None
        require(current == row['before'] if candidate else current in (row['before'], row['after']),
            'Refuse overwrite of unexpected source: '+row['path'])
    for index, row in enumerate(rows):
        if not candidate and row['before'] is None: continue
        target = root/row['path']; temp = target.with_name(target.name+'.code-'+('candidate-' if candidate else 'rollback-')+stamp)
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
    require_search_held(search)
    require(all(row['ActiveState'] == 'active' and row['WorkingDirectory'] == str(ROOT) and
        int(row['MainPID']) > 0 for row in services.values()), 'Service baseline changed')
    require(all(row['ActiveState'] == 'active' and int(row['MainPID']) > 0
        for row in authority.values()), 'Authority unavailable')
    node = Path(os.readlink('/proc/'+services[UNITS[0]]['MainPID']+'/exe'))
    require(str(node).startswith('/opt/node-') and sha(safe_read(node,200*1024**2)) == m['nodeSha256'], 'Node changed')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = BACKUPS/('code-'+m['releaseId']+'-'+stamp); backup.mkdir(mode=0o700)
    receipt = {'format':m['format'], 'releaseId':m['releaseId'], 'sourceCommit':m['sourceCommit'],
        'baselineHead':head, 'manifestSha256':sha(raw), 'rollbackRoot':str(backup),
        'dependencyCount':len(m['dependencies']), 'authority':authority, 'installed':False,
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
        subprocess.run(['/usr/bin/systemctl','stop',*UNITS],check=True,timeout=120)
        require(all(row['MainPID']=='0' for row in states(UNITS).values()), 'Services not drained')
        require(states(AUTHORITY)==authority and states(SEARCH)==search and safe_read(HOLD,65536)==hold_raw,
            'Unrelated state changed'); fence(ROOT,m,candidates)
        receipt['sourceWritesStarted']=True; save()
        install(ROOT,backup,m['sources'],metadata,True,stamp); receipt['installed']=True; save()
        require(all(sha(safe_read(ROOT/row['path']))==row['after'] for row in m['sources']), 'Installed bytes differ')
        require(all(sha(safe_read(ROOT/path))==expected for path,expected in m['dependencies'].items()
            if path not in ALLOWED), 'Unrelated source changed')
        subprocess.run(['/usr/bin/systemctl','start',*UNITS],check=True,timeout=60)
        require(all(row['ActiveState']=='active' and row['WorkingDirectory']==str(ROOT)
            for row in states(UNITS).values()), 'Services not restarted')
        require(states(AUTHORITY)==authority and states(SEARCH)==search and safe_read(HOLD,65536)==hold_raw,
            'Unrelated state changed')
        receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); save(); print(json.dumps(receipt),flush=True)
    except BaseException as error:
        receipt['errorClass']=type(error).__name__
        subprocess.run(['/usr/bin/systemctl','stop',*UNITS],check=True,timeout=120)
        if receipt.get('sourceWritesStarted'):
            install(ROOT,backup,m['sources'],metadata,False,stamp)
        subprocess.run(['/usr/bin/systemctl','start',*UNITS],check=True,timeout=60)
        receipt['rolledBack']=True; receipt['newHelpersRetained']=True; save(); print(json.dumps(receipt),flush=True); raise

if __name__ == '__main__': main()
