#!/usr/bin/python3 -I
"""Hash-fenced WORK batch bounded declaration replay overlay; Search must already be held by its pinned controller.

Changes only the fixed runtime allowlist and API/dependent-worker plus pinned gateway
activation. The reviewed publisher alone changes the bounded native replay rows in one transaction.
No config, timer, Git or authority-service mutation.
After the first source write, recovery is forward-only and keeps services drained.
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
NEW = frozenset()
ALLOWED = frozenset({
    'server/proof-api.mjs', 'server/work-amo-v5-raw.mjs',
    'server/work-batch-declaration.mjs', 'server/db/work-batch-reader.mjs',
    'scripts/backfill-proof-indexer.mjs', 'server/db/native-transition-storage.mjs'})
METADATA_TEMPLATE = 'src/shared/protocol/publishArticle.mjs'
# Must match the final accepted pre-batch release before planning or deployment.
BASE_SOURCE_COMMIT = 'eb0a2cf01b5173e14c710ed48c1a98b8d0a9ddee'
BASE_RELEASE_FINALIZED = True  # Frozen A3 release, supplied by the parent.
ACCEPTED_OVERLAY_BASES = {
    'server/db/native-transition-storage.mjs':
        '7e3393953864a68cdd72f43b7f3ae8e7eb4a24502ff2b260320790ee9be7f584',
}

ENTRYPOINTS = ('server/proof-api.mjs', 'scripts/backfill-proof-indexer.mjs',
    'scripts/backfill-proof-search.mjs', 'scripts/run-proof-indexer-worker.mjs')
IMPORT = re.compile(r'''(?:\b(?:import|export)\s+[^;]*?\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]''')
SHA = re.compile('[0-9a-f]{64}\\Z')
REPLAY_TOOL_PATHS = frozenset({'deploy/work-batch-replay/preflight.mjs',
    'deploy/work-batch-replay/publish-replay.py', 'deploy/work-batch-replay/storage-extension.sql',
    'deploy/work-batch-replay/catalog-baseline.json', 'deploy/work-batch-replay/catalog-after.json'})
REPLAY_TIMEOUT_SECONDS = {'before-drain': 21600, 'after-drain': 7200}
MAX_SUFFIX_BLOCKS = 512
QUALIFICATION_RECEIPT_BYTES = 32*1024**2
REPLAY_RESOURCE_LIMITS = {
    'maxNativePayloadBytes': 8*1024**3,
    'maxRawBlockBytes': 2*1024**3,
    'maxNativePayloadBytesPerBlock': 128*1024**2,
    'maxQualificationReceiptBytes': QUALIFICATION_RECEIPT_BYTES,
    'maxOrdinaryRecords': 1024,
}
QUALIFICATION_FORMAT = 'work-batch-bounded-reseal-qualification-v3'
NATIVE_HELPER = 'server/db/native-transition-storage.mjs'
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
    require(m.get('format') == 'proof-of-work-work-batch-replay-scoped-runtime-v1', 'Wrong manifest')
    require(m.get('baseSourceCommit') == BASE_SOURCE_COMMIT, 'Wrong approved base source commit')
    require(m.get('acceptedOverlayBases') == ACCEPTED_OVERLAY_BASES,
        'Wrong fixed accepted overlay base pins')
    require(isinstance(m.get('sourceTree'),str) and re.fullmatch('[0-9a-f]{40}',m['sourceTree']),
        'Missing exact source tree')

    require(m.get('services') == list(UNITS) and re.fullmatch(
        '[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', m.get('releaseId', '')), 'Wrong release/services')
    require(all(re.fullmatch('[0-9a-f]{40}', m.get(key, '')) for key in
        ('sourceCommit', 'baselineHead')), 'Invalid Git pins')
    require(m['releaseId'].split('-',1)[0] == m['sourceCommit'][:12], 'Release does not bind source commit')
    rows = m.get('sources')
    require(isinstance(rows, list) and len(rows) == len(ALLOWED) and
        {row.get('path') for row in rows} == ALLOWED, 'Wrong WORK batch bounded declaration replay source allowlist')
    candidates = {}
    for row in rows:
        require(set(row) == {'path', 'before', 'after', 'base64'}, 'Unknown source fields')
        require((row['before'] is None) == (row['path'] in NEW) and
            (row['before'] is None or isinstance(row['before'], str) and SHA.fullmatch(row['before'])),
            'Invalid creation-only source baseline')
        require(isinstance(row['after'], str) and SHA.fullmatch(row['after']), 'Invalid candidate pin')
        if row['path'] in ACCEPTED_OVERLAY_BASES:
            require(row['before'] == ACCEPTED_OVERLAY_BASES[row['path']],
                'Accepted overlay baseline changed')
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
    require(isinstance(m.get('restartConfigurationSha256'),str) and
        SHA.fullmatch(m['restartConfigurationSha256']), 'Missing dormant configuration pin')
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
    for field,width in (('sourceIdentities',7),('sourceParents',5)):
        values=m.get(field)
        require(isinstance(values,dict) and set(values)==ALLOWED and all(
            isinstance(row,list) and len(row)==width and all(type(v)is int and v>=0 for v in row)
            for row in values.values()), 'Missing exact source/parent inode identities')
    verifier = m.get('evidenceVerifier')
    require(isinstance(verifier, dict) and set(verifier) == {'root','commit','tree','files'}
        and verifier['commit'] == m['sourceCommit'] and verifier['tree'] == m['sourceTree']
        and isinstance(verifier['files'],dict) and REPLAY_TOOL_PATHS <= verifier['files'].keys()
        and all(isinstance(value,str) and SHA.fullmatch(value) for value in verifier['files'].values()),
        'Missing source-pinned replay-boundary verifier')
    require(isinstance(verifier['root'],str) and verifier['root'].startswith('/tmp/'),
        'Verifier must remain on the VPS')
    composition=m.get('replayComposition')
    require(isinstance(composition,dict) and set(composition)=={'path','sha256'}
        and isinstance(composition['path'],str) and composition['path'].startswith('/tmp/')
        and isinstance(composition['sha256'],str) and SHA.fullmatch(composition['sha256'])
        and isinstance(m.get('captureSha256'),str) and SHA.fullmatch(m['captureSha256']),
        'Missing exact replay composition')
    source_manifest=m.get('replaySourceManifest')
    require(isinstance(source_manifest,dict) and set(source_manifest)=={'path','sha256'}
        and isinstance(source_manifest['path'],str) and source_manifest['path'].startswith('/tmp/')
        and isinstance(source_manifest['sha256'],str) and SHA.fullmatch(source_manifest['sha256']),
        'Missing fixed replay source manifest')
    return candidates

def fence(root, m, candidates):
    for row in m['sources']:
        raw = safe_read(root/row['path'], absent=row['before'] is None)
        require((sha(raw) if raw is not None else None) == row['before'], 'Source changed: '+row['path'])
    for name,expected in m['sourceIdentities'].items():
        require(creation_identity((root/name).lstat())==expected, 'Source inode changed: '+name)
        require(parent_identity((root/name).parent.lstat())==m['sourceParents'][name],
            'Source parent changed: '+name)
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
    value = environment.get('WORK_BATCH_WRITES_ENABLED','')
    require(value in ('','0'), 'Replay deployment requires WORK batch writes disabled')

def process_environment(pid):
    require(isinstance(pid, str) and pid.isdigit() and int(pid) > 0, 'Invalid runtime PID')
    with open('/proc/'+pid+'/environ','rb') as stream: raw = stream.read(1024*1024+1)
    require(len(raw) <= 1024*1024, 'Oversized runtime environment')
    return dict(item.decode('utf-8').split('=',1) for item in raw.split(b'\0') if b'=' in item)

def inspect_batch_environment_file(raw):
    for line in raw.decode('utf-8').splitlines():
        if not re.match(r'^\s*WORK_BATCH_',line): continue
        matched = re.fullmatch(r'\s*(WORK_BATCH_[A-Z0-9_]+)\s*=\s*(.*?)\s*',line)
        require(matched is not None, 'Ambiguous WORK batch environment configuration')
        key, value = matched.groups()
        if len(value)>=2 and value[0] in ('"', "'") and value[-1]==value[0]:
            value=value[1:-1]
        require(re.fullmatch(r'[A-Za-z0-9_-]*',value) is not None,
            'Unsupported WORK batch environment value')
        reject_activation_environment({key:value})

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
        require(not any(name.startswith('WORK_BATCH_') for name in shlex.split(properties['PassEnvironment'])),
            'Replay deployment refuses inherited WORK batch configuration')
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

def require_writes_disabled_configuration():
    before = states(UNITS); api_environment = None
    for unit, row in before.items():
        require(row['ActiveState'] == 'active', 'Replay preflight requires active runtime')
        environment = process_environment(row['MainPID'])
        reject_activation_environment(environment)
        if unit == UNITS[0]: api_environment = environment
    restart_configuration_pin()
    require(states(UNITS) == before, 'Runtime changed during writes-disabled preflight')
    return api_environment


def repaired_status(value, prefix=None):
    if prefix is not None:
        if not isinstance(value,dict) or type(value.get('checkedTipHeight')) is not int:return False
        if value['checkedTipHeight']<prefix['through']:return False
        if value['checkedTipHeight']==prefix['through'] and value.get('checkedTipHash')!=prefix['hash']:return False
    return isinstance(value,dict) and value.get('protocol')=='work-batch-v1' and value.get('network')=='livenet' \
        and value.get('active') is True and value.get('writeEnabled') is False and value.get('ready') is False \
        and value.get('declarationTxid')=='b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28' \
        and value.get('activationHeight')==973104 and type(value.get('checkedTipHeight')) is int \
        and value['checkedTipHeight']>=973104 and isinstance(value.get('checkedTipHash'),str) \
        and SHA.fullmatch(value['checkedTipHash']) is not None \
        and value.get('limits')=={'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536} \
        and value.get('registryFeeProofs')==546 \
        and value.get('reasonCode') in ('work-batch-writes-disabled','work-batch-work-writes-paused')

def require_writes_disabled_status(prefix):
    environment = require_writes_disabled_configuration()
    port = environment.get('PORT','8081')
    require(port.isdigit() and 1 <= int(port) <= 65535, 'Invalid local API port')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    value = None
    for attempt in range(24):
        try:
            with opener.open('http://127.0.0.1:'+port+'/api/v1/work-batch-status',timeout=5) as response:
                raw = response.read(65537)
                require(response.status == 200 and len(raw) <= 65536, 'Invalid dormant API response')
                value = json.loads(raw)
            require(repaired_status(value,prefix),'Repaired canonical API status unavailable')
            break
        except (OSError, ValueError):
            if attempt == 23: raise ValueError('Dormant API postflight unavailable') from None
            time.sleep(2)
    require(repaired_status(value,prefix),'WORK batch repair API postflight failed')
    return {key:value.get(key) for key in ('protocol','network','active','writeEnabled','ready',
        'limits','registryFeeProofs','reasonCode','declarationTxid','activationHeight',
        'checkedTipHeight','checkedTipHash')}

def verifier_source_paths(root):
    pending=list(REPLAY_TOOL_PATHS); seen=set()
    while pending:
        name=pending.pop()
        require(len(seen)<128, 'Verifier dependency closure too large')
        if name in seen: continue
        require(name in REPLAY_TOOL_PATHS or name=='deploy/work-batch-activation/probe.mjs'
            or source_path(name)==name, 'Unexpected verifier dependency')
        seen.add(name)
        for target in IMPORT.findall(safe_read(root/name).decode()):
            # Resolve lexical relative imports, then apply the same path allowlist.
            parts=list(PurePosixPath(name).parent.parts)
            for part in target.split('/'):
                if part=='..':
                    require(parts,'Verifier import escaped root');parts.pop()
                elif part not in ('','.'):parts.append(part)
            pending.append('/'.join(parts))
    return seen

def verify_verifier_sources(verifier):
    root=Path(verifier['root'])
    require(root.resolve(strict=True)==root and root.is_dir(), 'Invalid verifier source root')
    git=['/usr/bin/git','-c',f'safe.directory={root}','-C',str(root)]
    require(subprocess.check_output([*git,'rev-parse','HEAD'],text=True).strip()==verifier['commit'],
        'Verifier source commit changed')
    require(subprocess.check_output([*git,'rev-parse','HEAD^{tree}'],text=True).strip()==verifier['tree'],
        'Verifier source tree changed')
    require(not subprocess.check_output([*git,'status','--porcelain=v1','--untracked-files=all']),
        'Verifier source is dirty')
    require(verifier_source_paths(root)==set(verifier['files']), 'Verifier closure changed')
    for name,expected in verifier['files'].items():
        raw=safe_read(root/name)
        require(sha(raw)==expected and raw==subprocess.check_output([*git,'show',verifier['commit']+':'+name]),
            'Verifier source bytes changed')
    return root

def private_evidence_path(path):
    require(path.is_absolute() and str(path).startswith('/tmp/') and
        path.parent.resolve(strict=True)==path.parent, 'Evidence path must be canonical VPS scratch')
    parent=path.parent
    while parent != Path('/tmp'):
        info=parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode & 0o7022,
            'Evidence parents must be root-private')
        parent=parent.parent

def verify_replay_composition(m):
    pin=m['replayComposition'];path=Path(pin['path']);private_evidence_path(path)
    raw=safe_read(path,2*1024**2)
    require(sha(raw)==pin['sha256'], 'Replay composition changed')
    value=json.loads(raw)
    require(value.get('format')=='proof-of-work-work-batch-replay-composition-v1'
        and all(value.get(key)==m[key] for key in
            ('sourceCommit','sourceTree','baseSourceCommit','releaseId','captureSha256'))
        and value.get('sources')==[{key:row[key] for key in ('path','before','after')} for row in m['sources']],
        'Replay composition source provenance differs')
    reviews=value.get('reviews')
    require(isinstance(reviews,list) and len(reviews)==len(ALLOWED)
        and {row.get('path') for row in reviews}==ALLOWED, 'Missing merge provenance')
    for review in reviews:
        row=next(row for row in m['sources'] if row['path']==review['path'])
        require(review.get('before')==row['before'] and review.get('after')==row['after']
            and all(isinstance(review.get(key),str) and SHA.fullmatch(review[key])
                for key in ('baseSha256','repositoryCandidateSha256'))
            and review.get('syntaxVerified') is True and review.get('creationOnly') is False
            and (review.get('cleanThreeWayMerge') is True or isinstance(review.get('explicitResolution'),dict)),
            'Incomplete reviewed source merge provenance')
    return value

def verify_replay_source_manifest(m):
    verify_replay_composition(m)
    pin=m['replaySourceManifest'];path=Path(pin['path']);private_evidence_path(path)
    raw=safe_read(path,2*1024**2)
    require(sha(raw)==pin['sha256'], 'Replay source manifest changed')
    value=json.loads(raw)
    require(value.get('format')=='work-batch-replay-source-manifest-v1'
        and value.get('sourceState')=='committed'
        and value.get('sourceCommit')==m['sourceCommit'] and value.get('sourceTree')==m['sourceTree']
        and value.get('sourceRoot')==m['evidenceVerifier']['root']
        and value.get('maxSuffixBlocks')==MAX_SUFFIX_BLOCKS
        and value.get('resourceLimits')==REPLAY_RESOURCE_LIMITS
        and value.get('compositionManifestSha256')==m['replayComposition']['sha256']
        and value.get('node',{}).get('sha256')==m['nodeSha256']
        and value.get('runtimeSources')=={row['path']:row['after'] for row in m['sources']},
        'Replay source manifest differs from reviewed committed runtime')
    roles=value.get('modules',{});files=value.get('files',{})
    rows={row['path']:row for row in m['sources']}
    expected={'baselineRaw':rows['server/work-amo-v5-raw.mjs']['before'],
        'compatibleRaw':rows['server/work-amo-v5-raw.mjs']['after'],
        'declaration':rows['server/work-batch-declaration.mjs']['after'],
        'reader':rows['server/db/work-batch-reader.mjs']['after'],
        'nativeStorage':ACCEPTED_OVERLAY_BASES[NATIVE_HELPER]}
    require(all(isinstance(roles.get(role),str) and files.get(roles[role],{}).get('sha256')==pin
        for role,pin in expected.items()), 'Replay role bytes differ from reviewed runtime')
    # Imported replay dependencies also use the captured/installed implementation.
    # API/backfill overlays are outside the replay module closure but remain in runtimeSources.
    for name,entry in files.items():
        group,separator,relative=name.partition('/')
        if not separator or group not in ('baseline','compatible'):continue
        relative=entry.get('origin',{}).get('path',relative)
        if not relative.endswith(('.mjs','.js','.json')) or not (
                relative.startswith(('server/','scripts/','src/shared/protocol/','src/features/identity/'))
                or relative in ROOT_JSON-{'package.json','package-lock.json'}):continue
        expected_pin=(rows[relative]['after' if group=='compatible' else 'before']
            if relative in rows else m['dependencies'].get(relative))
        require(expected_pin is not None and entry.get('sha256')==expected_pin,
            'Replay dependency differs from reviewed runtime: '+relative)
    return value

def stable_json_sha256(value):
    return sha(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode())

def validate_qualification_bounds(value):
    require(value.get('format')==QUALIFICATION_FORMAT and value.get('qualified') is True
        and value.get('readOnly') is True and value.get('liveModified') is False
        and value.get('maxSuffixBlocks')==MAX_SUFFIX_BLOCKS
        and value.get('resourceLimits')==REPLAY_RESOURCE_LIMITS,
        'Qualification version or resource limits differ')
    blocks=value.get('blocks');prefix=value.get('fixedPrefix',{})
    require(isinstance(blocks,list) and 1<=len(blocks)<=MAX_SUFFIX_BLOCKS
        and prefix.get('from')==973104 and type(prefix.get('through')) is int
        and prefix['through']==973103+len(blocks)
        and [row.get('height') for row in blocks]==list(range(973104,prefix['through']+1))
        and all(isinstance(row.get('hash'),str) and SHA.fullmatch(row['hash']) for row in blocks)
        and prefix.get('hash')==blocks[-1]['hash'], 'Qualification suffix is not exact and bounded')
    for key in ('ordinaryRelationalSuffixVerified','fullRawSuffixVerified',
                'noDerivedEventsVerified','noBatchLookingRecordsVerified'):
        require(value.get(key) is True,'Qualification ordinary semantic parity is unavailable: '+key)
    totals={'nativePayloadBytes':0,'newNativePayloadBytes':0,'rawBlockBytes':0,'ordinaryRecords':0}
    for row in blocks:
        for key in ('nativePayloadBytes','oldNativeBytes','newNativeBytes','rawBlockBytes',
                    'rawProtocolCandidateCount','protocolRecordCount','batchLookingCount'):
            require(type(row.get(key)) is int and row[key]>=0,'Qualification row counter invalid: '+key)
        require(row['batchLookingCount']==0 and row['oldNativeBytes']==row['nativePayloadBytes']
            and 0<row['nativePayloadBytes']<=REPLAY_RESOURCE_LIMITS['maxNativePayloadBytesPerBlock']
            and 0<row['newNativeBytes']<=REPLAY_RESOURCE_LIMITS['maxNativePayloadBytesPerBlock']
            and 0<row['rawBlockBytes']<=4_000_000,
            'Qualification contains a batch or oversized native/raw block')
        for key in ('baselineExactlyReproduced','compatibilityDeterministic','economicStateEqual',
                    'workGenericIdStateEqual','projectionEqual','eventsAndFeesEqual',
                    'ordinaryEventSetVerified','ordinaryRecordsVerified','noDerivedEventsVerified'):
            require(row.get(key) is True,'Qualification block semantic parity missing: '+key)
        relational=row.get('relationalBindings',{})
        require(type(relational.get('eventCount')) is int and relational['eventCount']>=0
            and type(relational.get('recordCount')) is int
            and relational['eventCount']==relational['recordCount']==row['rawProtocolCandidateCount']==row['protocolRecordCount']
            and all(isinstance(relational.get(key),str) and SHA.fullmatch(relational[key])
                    for key in ('eventRowsSha256','recordRowsSha256')),
            'Qualification ordinary relational evidence differs')
        replacements=row.get('replacementFields',{})
        require(isinstance(replacements,dict) and set(replacements)=={
            'workBatchV1','transitionChainCommitment','replayRecords','traces','replayDescriptorCommitment'}
            and isinstance(row.get('allowedChangedFields'),list)
            and row['allowedChangedFields']==sorted(set(row['allowedChangedFields']))
            and set(row['allowedChangedFields']).issubset(replacements)
            and {'workBatchV1','transitionChainCommitment'}.issubset(row['allowedChangedFields']),
            'Qualification replacement scope is not exact')
        require(all(isinstance(row.get(key),str) and SHA.fullmatch(row[key])
            for key in ('oldNativeSha256','newNativeSha256','oldScalarMetadataSha256','newScalarMetadataSha256','currentMainRowSha256'))
            and row['oldScalarMetadataSha256']==row['newScalarMetadataSha256'],
            'Qualification native/scalar binding differs')
        if row['protocolRecordCount']==0:
            require(row.get('emptyEventSetVerified') is True,'Empty suffix block lacks exact event proof')
        totals['nativePayloadBytes']+=row['nativePayloadBytes']
        totals['newNativePayloadBytes']+=row['newNativeBytes']
        totals['rawBlockBytes']+=row['rawBlockBytes']
        totals['ordinaryRecords']+=row['protocolRecordCount']
    require(value.get('resourceUsage')==totals
        and totals['nativePayloadBytes']<=REPLAY_RESOURCE_LIMITS['maxNativePayloadBytes']
        and totals['newNativePayloadBytes']<=REPLAY_RESOURCE_LIMITS['maxNativePayloadBytes']
        and totals['rawBlockBytes']<=REPLAY_RESOURCE_LIMITS['maxRawBlockBytes']
        and totals['ordinaryRecords']<=REPLAY_RESOURCE_LIMITS['maxOrdinaryRecords'],
        'Qualification cumulative resource budget differs or is exceeded')
    return blocks

def validate_cached_prefix(prior,current,prior_sha256):
    require(isinstance(prior_sha256,str) and SHA.fullmatch(prior_sha256),
        'Cached qualification digest is invalid')
    before=validate_qualification_bounds(prior);after=validate_qualification_bounds(current)
    require(prior.get('mode')=='before-drain' and current.get('mode')=='after-drain'
        and current.get('priorManifestSha256')==prior_sha256,
        'Cached qualification phase or immutable receipt differs')
    immutable=('format','verifierSha256','sourceState','sourceCommit','sourceTree','sourceManifestSha256',
        'runtimeSources','firstPartySourceHashes','nodeSha256','declarationTxid','declaration',
        'anchor','proposedMarker','nativeCatalogSha256','databaseName','databaseEndpoint',
        'maxSuffixBlocks','resourceLimits')
    require(all(key in prior and key in current and prior[key]==current[key] for key in immutable),
        'Cached qualification source, authority, anchor or database identity differs')
    require(len(after)>=len(before) and after[:len(before)]==before
        and prior['fixedPrefix']['from']==current['fixedPrefix']['from']
        and prior['fixedPrefix']['hash']==after[len(before)-1]['hash'],
        'Cached qualification prefix rows changed or were omitted')
    for value in (prior,current):
        height=value['fixedPrefix']['through'];block_hash=value['fixedPrefix']['hash']
        require(value.get('checkpoint',{}).get('height')==height
            and value['checkpoint'].get('hash')==block_hash
            and value.get('canonicalRebuild',{}).get('indexedThroughBlock')==height
            and value['canonicalRebuild'].get('indexedThroughBlockHash')==block_hash
            and value['canonicalRebuild'].get('complete') is True
            and value['canonicalRebuild'].get('active') is False,
            'Cached qualification checkpoint does not bind its exact prefix')
    expected={'model':'work-batch-qualified-prefix-cache-v1',
        'priorManifestSha256':prior_sha256,'from':973104,
        'through':prior['fixedPrefix']['through'],'blocks':len(before),
        'priorBlocksSha256':stable_json_sha256(before),'canonicalPrefixVerified':True,
        'nativeAndScalarBindingsVerified':True,'relationalBindingsVerified':True,
        'closingStateAndProjectionVerified':True}
    require(current.get('cacheRevalidation')==expected,
        'Cached prefix lacks exact fresh canonical/native/relational/state revalidation')
    return True

def qualification_reference(path, value, progress=None):
    return {'path':str(path),'sha256':sha(safe_read(path,QUALIFICATION_RECEIPT_BYTES)),
        'qualified':True,'mode':value['mode'],'fixedPrefix':value['fixedPrefix'],
        'sourceManifestSha256':value['sourceManifestSha256'],**({'progress':progress} if progress else {})}

def require_replay_boundary(m,node,environment,mode,output,expected=None):
    require(mode in ('before-drain','after-drain') and
        ((expected is None)==(mode=='before-drain')), 'Invalid replay qualification phase')
    root=verify_verifier_sources(m['evidenceVerifier'])
    source=verify_replay_source_manifest(m)
    require(str(node)==source['node']['path'] and
        sha(safe_read(Path(node),200*1024**2))==m['nodeSha256'], 'Verifier Node changed')
    reject_activation_environment(environment)
    require(output.is_absolute() and output.parent.resolve(strict=True)==output.parent
        and not os.path.lexists(output), 'Qualification receipt must be new')
    parent=output.parent.lstat()
    require(parent.st_uid==0 and stat.S_IMODE(parent.st_mode)==0o700,
        'Qualification receipt requires private controller evidence directory')
    argv=[str(node),'--max-old-space-size=1536',str(root/'deploy/work-batch-replay/preflight.mjs'),
        '--mode',mode,'--source-manifest',m['replaySourceManifest']['path'],
        '--source-manifest-sha256',m['replaySourceManifest']['sha256'],'--output',str(output)]
    if expected is not None:
        require(expected.get('qualified') is True and expected.get('mode')=='before-drain'
            and sha(safe_read(Path(expected['path']),QUALIFICATION_RECEIPT_BYTES))==expected['sha256'],
            'Before-drain qualification changed')
        argv+=['--expected-manifest',expected['path'],'--expected-manifest-sha256',expected['sha256']]
    progress_path=output.with_name('qualification-'+mode+'.progress.jsonl')
    descriptor=os.open(progress_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'wb') as progress_stream:
        try:
            result=subprocess.run(argv,stdout=subprocess.PIPE,stderr=progress_stream,
                env=environment,timeout=REPLAY_TIMEOUT_SECONDS[mode])
        finally:
            progress_stream.flush();os.fsync(progress_stream.fileno())
    progress_raw=safe_read(progress_path,65536)
    progress={'path':str(progress_path),'sha256':sha(progress_raw),'bytes':len(progress_raw)}
    require(result.returncode==0 and len(result.stdout)<=65536,
        'Bounded replay qualification unavailable')
    raw=safe_read(output,QUALIFICATION_RECEIPT_BYTES);value=json.loads(raw);report=json.loads(result.stdout)
    require(report.get('qualified') is True and report.get('receiptSha256')==sha(raw)
        and report.get('output')==str(output), 'Qualification child receipt differs')
    require(value.get('format')==QUALIFICATION_FORMAT
        and value.get('qualified') is True and value.get('readOnly') is True
        and value.get('liveModified') is False and value.get('mode')==mode
        and value.get('sourceState')=='committed'
        and value.get('sourceCommit')==m['sourceCommit'] and value.get('sourceTree')==m['sourceTree']
        and value.get('runtimeSources')==source['runtimeSources']
        and value.get('sourceManifestSha256')==m['replaySourceManifest']['sha256']
        and value.get('declarationTxid')=='b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28'
        and value.get('fixedPrefixRemainsCanonical') is True
        and value.get('proposedMarkerPersisted') is False and value.get('maxSuffixBlocks')==MAX_SUFFIX_BLOCKS
        and value.get('resourceLimits')==REPLAY_RESOURCE_LIMITS,
        'Replay qualification refuses installation')
    validate_qualification_bounds(value)
    if expected is not None:
        prior_raw=safe_read(Path(expected['path']),QUALIFICATION_RECEIPT_BYTES)
        require(sha(prior_raw)==expected['sha256'],'Before-drain qualification changed')
        prior=json.loads(prior_raw)
        require(prior.get('fixedPrefix')==expected.get('fixedPrefix'),
            'Before-drain compact prefix differs')
        validate_cached_prefix(prior,value,expected['sha256'])
    verify_verifier_sources(m['evidenceVerifier']);verify_replay_source_manifest(m)
    return qualification_reference(output,value,progress)


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
    require_restart_configuration(m['restartConfigurationSha256'])
    restore_apps(m['gateway'])
    require_protected_services(m['protectedServices'], 'restored')
    require_restart_configuration(m['restartConfigurationSha256'])
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

def owned_creation(path, row, created):
    raw = safe_read(path, absent=True)
    if raw is None: return
    owned = created.get(row['path'])
    require(owned is not None and owned['sha256'] == row['after'] and
        sha(raw) == row['after'] and creation_identity(path.lstat()) == owned['identity'],
        'Refuse removal of unowned or changed helper: '+row['path'])

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
    for name in ALLOWED:
        parent = (root/name).parent
        require(parent.resolve(strict=True) == parent and parent.stat().st_dev == info.st_dev,
            'Quarantine must share every helper filesystem')

def remove_owned_creation(target, row, created, stamp, checkpoint):
    owned_creation(target, row, created)
    if not os.path.lexists(target): return
    # Move first, then verify the moved inode. A concurrent pathname replacement
    # is preserved, never unlinked on the strength of a stale pre-move check.
    quarantine_root = QUARANTINE_PARENT/('.proofofwork-work-batch-recovery-'+stamp+'-'+os.urandom(8).hex())
    quarantine_root.mkdir(mode=0o700); sync(QUARANTINE_PARENT)
    info = quarantine_root.lstat()
    require(info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700 and
        quarantine_root.resolve(strict=True) == quarantine_root, 'Unsafe private recovery directory')
    quarantine = quarantine_root/'owned.mjs'
    created[row['path']]['quarantine'] = str(quarantine); checkpoint()
    rename_absent(target, quarantine); sync(target.parent); sync(quarantine_root)
    try:
        owned_creation(quarantine, row, created)
        require(os.path.lexists(quarantine), 'Quarantined helper disappeared')
    except BaseException:
        # Restore only into an absent path; otherwise retain both for recovery.
        if not os.path.lexists(target):
            rename_absent(quarantine, target); sync(target.parent); sync(quarantine_root)
        raise
    quarantine.unlink(); sync(quarantine_root)
    quarantine_root.rmdir(); sync(QUARANTINE_PARENT)
    created[row['path']]['removed'] = True; checkpoint()

def rename_absent_at(source_fd, source_name, target_fd, target_name):
    libc=ctypes.CDLL(None,use_errno=True)
    rename=libc.renameat2
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    rename.restype=ctypes.c_int
    if rename(source_fd,os.fsencode(source_name),target_fd,os.fsencode(target_name),1)!=0:
        number=ctypes.get_errno();raise OSError(number,os.strerror(number))

def install(root, backup, rows, metadata, candidate, stamp, created, checkpoint=lambda:None,
            source_identities=None,source_parents=None):
    require(candidate is True and not NEW, 'Replay installation is existing-only and forward-only')
    require(set(source_identities or {})==ALLOWED and set(source_parents or {})==ALLOWED,
        'Missing captured source identities')
    require_quarantine_parent(root)
    def check(row):
        target=root/row['path']
        require(sha(safe_read(target))==row['before'], 'Refuse overwrite of unexpected source: '+row['path'])
        require(creation_identity(target.lstat())==source_identities[row['path']],
            'Refuse changed source inode: '+row['path'])
        require(parent_identity(target.parent.lstat())==source_parents[row['path']],
            'Refuse changed source parent: '+row['path'])
    for row in rows:check(row)
    quarantine=QUARANTINE_PARENT/('.proofofwork-batch-replay-'+stamp+'-'+os.urandom(8).hex())
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
                rename_absent_at(pfd,target.name,qfd,old_name)
                os.fsync(pfd);os.fsync(qfd)
                # A changed incumbent is retained privately. Never overwrite or delete it.
                require(creation_identity((quarantine/old_name).lstat())==source_identities[row['path']]
                    and sha(safe_read(quarantine/old_name))==row['before'],'Moved source ownership changed')
                require(creation_identity(temp.lstat())==temp_identity and sha(safe_read(temp))==row['after'],
                    'Candidate inode or bytes changed before publication')
                require(parent_identity(target.parent.lstat())==source_parents[row['path']]
                    and parent_identity(os.fstat(pfd))==source_parents[row['path']],'Source parent changed')
                os.link(temp.name,target.name,src_dir_fd=qfd,dst_dir_fd=pfd,follow_symlinks=False)
                require(creation_identity(os.stat(target.name,dir_fd=pfd,follow_symlinks=False))==temp_identity,
                    'Published source inode changed')
                os.unlink(temp.name,dir_fd=qfd);os.fsync(qfd);os.fsync(pfd)
                require(sha(safe_read(target))==row['after'] and creation_identity(target.lstat())==temp_identity,
                    'Published source changed')
                created[row['path']]['published']=True;checkpoint()
            finally:os.close(pfd)
    finally:os.close(qfd)


def installed_source_fence(m, journal):
    require(set(journal)==ALLOWED, 'Incomplete source install journal')
    for row in m['sources']:
        owned=journal[row['path']]
        require(owned.get('published') is True and owned.get('candidateSha256')==row['after']
            and creation_identity((ROOT/row['path']).lstat())==owned.get('candidateIdentity')
            and parent_identity((ROOT/row['path']).parent.lstat())==m['sourceParents'][row['path']]
            and sha(safe_read(ROOT/row['path']))==row['after'], 'Installed source ownership changed')
    metadata_fence(ROOT,m['sourceMetadata'],installed=True)
    metadata_fence(ROOT,m['dependencyMetadata'],installed=True)
    require(all(sha(safe_read(ROOT/path))==expected for path,expected in m['dependencies'].items()
        if path not in ALLOWED), 'Unrelated source changed')
    require(dependency_closure(ROOT)<=m['dependencies'].keys(), 'Installed dependency not pinned')

def publication_result(final, prepared, qualification):
    native=final.get('result')
    require(final.get('format')=='work-batch-native-supersession-dispatch-v1'
        and final.get('status')=='committed' and final.get('committed') is True
        and final.get('postconditionsVerified') is True and final.get('commitSent') is True
        and final.get('returncode')==0 and final.get('fenceError') is None
        and final.get('manifestSha256')==prepared['manifestSha256']
        and final.get('sqlSha256')==prepared['sqlSha256']
        and final.get('availabilityVerified') is False and isinstance(native,dict),
        'Native publication has no verified commit receipt')
    require(native.get('format')=='work-batch-native-supersession-result-v1'
        and native.get('manifestSha256')==prepared['manifestSha256']
        and native.get('qualificationSha256')==qualification['sha256']
        and native.get('originalArchivesRetained') is True and native.get('oldChunksRetained') is True
        and native.get('currentMetadataVerified') is True and native.get('markerVerified') is True,
        'Native publication postconditions incomplete')
    proof=json.loads(safe_read(Path(qualification['path']),QUALIFICATION_RECEIPT_BYTES))
    require(sha(safe_read(Path(qualification['path']),QUALIFICATION_RECEIPT_BYTES))==qualification['sha256'],
        'Publication qualification changed')
    require(native.get('marker')==proof['proposedMarker'], 'Published marker differs from replay')
    blocks=native.get('blocks')
    require(isinstance(blocks,list) and len(blocks)==len(proof['blocks']),
        'Published suffix differs')
    for actual,expected in zip(blocks,proof['blocks']):
        require(all(actual.get(key)==expected[key] for key in
            ('height','hash','oldNativeSha256','newNativeSha256'))
            and all(actual.get(key) is True for key in
                ('originalArchiveRetained','currentMetadataVerified','originalScalarsVerified',
                 'hotSlotVerified','historicalReadVerified','relationalRowsVerified'))
            and actual.get('cacheMode')==('hot' if expected['height']>=proof['fixedPrefix']['through']-127 else 'cold'),
            'Native block publication postcondition differs')

def publish_qualified_replay(receipt,m,backup,save,environment):
    reject_activation_environment(environment)
    require(receipt.get('installed') is True and receipt.get('sourceWritesStarted') is True,
        'Source installation must precede publication')
    require_apps_drained();require_restart_configuration(m['restartConfigurationSha256'])
    installed_source_fence(m,receipt['createdHelpers'])
    root=verify_verifier_sources(m['evidenceVerifier']);verify_replay_source_manifest(m)
    qualification=receipt['boundaryAfterDrain']
    raw=safe_read(Path(qualification['path']),QUALIFICATION_RECEIPT_BYTES)
    require(sha(raw)==qualification['sha256'], 'After-drain qualification changed')
    proof=json.loads(raw)
    require(proof.get('qualified') is True and proof.get('mode')=='after-drain'
        and proof.get('priorManifestSha256')==receipt['boundaryBefore']['sha256'],
        'Publication needs exact after-drain qualification')
    helper_index=next(i for i,row in enumerate(m['sources']) if row['path']==NATIVE_HELPER)
    helper_row=m['sources'][helper_index];baseline=backup/f'before-{helper_index}.mjs'
    require(sha(safe_read(baseline))==ACCEPTED_OVERLAY_BASES[NATIVE_HELPER], 'Native baseline helper changed')
    files=m['evidenceVerifier']['files']
    def tool(name):return root/'deploy/work-batch-replay'/name
    def pin(name):return files['deploy/work-batch-replay/'+name]
    common=['--storage-sql',str(tool('storage-extension.sql')),'--storage-sql-sha256',pin('storage-extension.sql'),
        '--baseline-helper',str(baseline),'--baseline-helper-sha256',helper_row['before'],
        '--runtime-helper',str(ROOT/NATIVE_HELPER),'--runtime-helper-sha256',helper_row['after']]
    command=['/usr/bin/python3','-I','-B',str(tool('publish-replay.py'))]
    manifest=backup/'publication-manifest.json';rendered=backup/'publication.sql'
    prepared_path=backup/'publication-prepared.json'
    argv=[*command,'--prepare',*common,'--preflight',qualification['path'],
        '--preflight-sha256',qualification['sha256'],
        '--old-catalog',str(tool('catalog-baseline.json')),'--old-catalog-sha256',pin('catalog-baseline.json'),
        '--new-catalog',str(tool('catalog-after.json')),'--new-catalog-sha256',pin('catalog-after.json'),
        '--manifest',str(manifest),'--render',str(rendered),'--receipt',str(prepared_path)]
    result=subprocess.run(argv,capture_output=True,env=environment,timeout=300)
    require(result.returncode==0 and len(result.stdout)<=2*1024**2 and len(result.stderr)<=65536,
        'Native publication preparation failed')
    prepared_raw=safe_read(prepared_path,2*1024**2);prepared=json.loads(prepared_raw)
    require(json.loads(result.stdout)==prepared and prepared.get('status')=='rendered-only'
        and prepared.get('committed') is False and prepared.get('manifestPath')==str(manifest)
        and prepared.get('sqlPath')==str(rendered)
        and prepared.get('manifestSha256')==sha(safe_read(manifest,QUALIFICATION_RECEIPT_BYTES))
        and prepared.get('sqlSha256')==sha(safe_read(rendered,128*1024**2)),
        'Prepared publication evidence differs')
    publication=json.loads(safe_read(manifest,QUALIFICATION_RECEIPT_BYTES))
    require(publication.get('sourceCommit')==m['sourceCommit'] and publication.get('sourceTree')==m['sourceTree']
        and publication.get('sourceManifestSha256')==m['replaySourceManifest']['sha256']
        and publication.get('runtimeFiles')=={r['path']:r['after'] for r in m['sources']}
        and publication.get('qualificationSha256')==qualification['sha256']
        and publication.get('databaseName')==proof['databaseName'],
        'Prepared publication source/evidence differs')
    verify_verifier_sources(m['evidenceVerifier']);verify_replay_source_manifest(m)
    installed_source_fence(m,receipt['createdHelpers'])
    require_apps_drained();require_restart_configuration(m['restartConfigurationSha256'])
    receipt['publicationPrepared']={'path':str(prepared_path),'sha256':sha(prepared_raw),
        'manifestSha256':prepared['manifestSha256'],'sqlSha256':prepared['sqlSha256']}
    receipt['publicationDispatchStarted']=True;save()
    dispatch=backup/'publication-dispatch.json'
    result=subprocess.run([*command,'--execute',*common,'--manifest',str(manifest),
        '--manifest-sha256',prepared['manifestSha256'],'--database',proof['databaseName'],
        '--receipt',str(dispatch)],capture_output=True,env=environment,timeout=1800)
    require(result.returncode==0 and len(result.stdout)<=2*1024**2 and len(result.stderr)<=65536,
        'Native publication outcome is unverified')
    final_path=Path(str(dispatch)+'.result.json');final_raw=safe_read(final_path,2*1024**2)
    final=json.loads(final_raw)
    require(json.loads(result.stdout)==final,'Native final receipt differs')
    publication_result(final,prepared,qualification)
    verify_verifier_sources(m['evidenceVerifier']);verify_replay_source_manifest(m)
    installed_source_fence(m,receipt['createdHelpers'])
    require_apps_drained();require_restart_configuration(m['restartConfigurationSha256'])
    receipt['replayPublication']={'path':str(final_path),'sha256':sha(final_raw),
        'manifestSha256':prepared['manifestSha256'],'qualificationSha256':qualification['sha256'],
        'committed':True,'postconditionsVerified':True,'blocks':len(proof['blocks']),
        'through':proof['fixedPrefix']['through']}
    save()


def cross_replay_boundary(receipt, m, node, environment, save, backup):
    require_apps_drained()
    require_restart_configuration(m['restartConfigurationSha256'])
    receipt['boundaryAfterDrain']=require_replay_boundary(m,node,environment,'after-drain',
        backup/'qualification-after.json',receipt['boundaryBefore'])
    save()
    receipt['sourceWritesStarted']=True
    save()

def recover_runtime(receipt, m, candidates, authority, search, hold_raw):
    drain_apps()
    if receipt.get('sourceWritesStarted'):
        receipt['forwardRecoveryRequired']=True
        receipt['sourceRollbackProhibited']=True
        raise ValueError('Replay source writes began; retain source and drain for forward recovery')
    require(all(sha(safe_read(ROOT/row['path']))==row['before'] for row in m['sources']),
        'Baseline bytes differ')
    metadata_fence(ROOT,m['sourceMetadata'])
    fence(ROOT,m,candidates)
    require_restart_configuration(m['restartConfigurationSha256'])
    receipt['servicesAfterRollback']=restore_verified_apps(m,authority,search,hold_raw)
    receipt['rolledBack']=True

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
    metadata_fence(ROOT, m['sourceMetadata'])
    private_api_environment = require_writes_disabled_configuration()
    require_restart_configuration(m['restartConfigurationSha256'])
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
    backup = BACKUPS/('work-batch-replay-'+m['releaseId']+'-'+stamp); backup.mkdir(mode=0o700)
    receipt = {'format':m['format'], 'releaseId':m['releaseId'], 'sourceCommit':m['sourceCommit'],
        'sourceTree':m['sourceTree'],'baselineHead':head, 'manifestSha256':sha(raw), 'rollbackRoot':str(backup),
        'restartConfigurationSha256':m['restartConfigurationSha256'],
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
    try:
        receipt['boundaryBefore']=require_replay_boundary(m,node,private_api_environment,
            'before-drain',backup/'qualification-before.json')
        save()
        receipt['stopRequested']=True; save()
        drain_apps()
        require_protected_services(m['protectedServices'], 'drained')
        require(states(AUTHORITY)==authority
            and states(SEARCH)==search and safe_read(HOLD,65536)==hold_raw,
            'Unrelated state changed'); fence(ROOT,m,candidates)
        metadata_fence(ROOT, m['sourceMetadata'])
        cross_replay_boundary(receipt,m,node,private_api_environment,save,backup)
        install(ROOT,backup,m['sources'],metadata,True,stamp,receipt['createdHelpers'],save,m['sourceIdentities'],m['sourceParents']); receipt['installed']=True; save()
        publish_qualified_replay(receipt,m,backup,save,private_api_environment)
        receipt['servicesAfter']=restore_verified_apps(m, authority, search, hold_raw)
        receipt['writesDisabledStatus']=require_writes_disabled_status(receipt['boundaryAfterDrain']['fixedPrefix'])
        receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); save(); print(json.dumps(receipt),flush=True)
    except BaseException as error:
        receipt['errorClass']=type(error).__name__
        try:
            recover_runtime(receipt,m,candidates,authority,search,hold_raw)
        except BaseException as recovery_error:
            receipt['recoveryIncomplete']=True; receipt['recoveryErrorClass']=type(recovery_error).__name__
            save(); print(json.dumps(receipt),flush=True); raise
        save(); print(json.dumps(receipt),flush=True); raise

if __name__ == '__main__': main()
