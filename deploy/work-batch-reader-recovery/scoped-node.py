#!/usr/bin/python3 -I
"""Hash-fenced WORK canonical reader overlay; Search must already be held by its pinned controller.

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
NEW = frozenset()
ALLOWED = frozenset({'server/db/proof-index-reader.mjs', 'server/proof-api.mjs'})
PREDECESSOR_CONTROLLER_SHA = 'f17799cea310a3d0a97c936a6608c7b4447e7d41da076bcdb0c950050c967dc1'
READER = 'server/db/proof-index-reader.mjs'
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

def evidence_reference(ref, limit=32*1024**2):
    require(type(ref)is dict and set(ref)=={'path','sha256'} and
        isinstance(ref['sha256'],str) and SHA.fullmatch(ref['sha256']), 'Invalid predecessor evidence reference')
    path=Path(ref['path']);info=path.lstat()
    require(info.st_uid==info.st_gid==0, 'Predecessor evidence owner differs')
    raw=safe_read(path,limit);require(sha(raw)==ref['sha256'] and identity(path.lstat())==identity(info),
        'Predecessor evidence changed')
    return raw

def validate_rehearsal(value, plan, plan_sha256):
    """Admit only the exact successful, unpublished eight-summary rehearsal."""
    m=plan['runtimeManifestTemplate']
    require(type(value)is dict and set(value)=={'format','qualified','planSha256','sourceCommit',
        'releaseId','candidateHashes','predecessor','unit','invocationId','result',
        'dispatchSha256','stdoutSha256','adapterHashes'},'Invalid rehearsal qualification')
    require(value['format']=='work-batch-summary-rehearsal-qualified-v1' and value['qualified']is True
        and value['planSha256']==plan_sha256 and SHA.fullmatch(plan_sha256)
        and value['sourceCommit']==m['sourceCommit']==plan['sourceCommit']
        and value['releaseId']==m['releaseId']==plan['releaseId']
        and value['candidateHashes']=={row['path']:row['after']for row in m['sources']}
        and set(value['candidateHashes'])==ALLOWED and value['predecessor']==m['predecessor']
        and value['unit']=='pow-batch-summary-rehearsal-'+m['releaseId']+'.service'
        and isinstance(value['invocationId'],str) and re.fullmatch('[0-9a-f]{32}',value['invocationId']),
        'Rehearsal source, predecessor or execution identity differs')
    require(all(isinstance(value[k],str) and SHA.fullmatch(value[k])for k in ('dispatchSha256','stdoutSha256'))
        and type(value['adapterHashes'])is dict and set(value['adapterHashes'])=={'api.mjs','postgres.mjs','fetch-guard.mjs'}
        and all(isinstance(v,str)and SHA.fullmatch(v)for v in value['adapterHashes'].values()),
        'Rehearsal evidence pins differ')
    result=value['result']
    require(type(result)is dict and result.get('format')=='work-batch-summary-readonly-rehearsal-v1'
        and result.get('ok')is True and result.get('published')is False
        and type(result.get('indexedThroughBlock'))is int and result['indexedThroughBlock']>=973284
        and isinstance(result.get('indexedThroughBlockHash'),str) and SHA.fullmatch(result['indexedThroughBlockHash'])
        and isinstance(result.get('snapshotId'),str) and re.fullmatch('[0-9a-f]{24}',result['snapshotId'])
        and result.get('summaryKeys')==sorted(['growthSummary','inceptionSummary','infinitySummary','logSummary',
            'marketplaceSummary','tokenSummary','workFloor','workSummary']),
        'Rehearsal did not verify all unpublished canonical summaries')
    return value

def load_predecessor(p):
    """Read immutable failed-attempt evidence; never relabel it successful/accepted."""
    require(type(p)is dict and set(p)=={'format','plan','manifest','receipt','dispatch','unit'}
        and p['format']=='work-batch-reader-recovery-predecessor-v1','Invalid predecessor contract')
    plan=json.loads(evidence_reference(p['plan']));m=json.loads(evidence_reference(p['manifest']))
    r=json.loads(evidence_reference(p['receipt']));dispatch=json.loads(evidence_reference(p['dispatch']))
    raw=base64.b64decode(plan['controllerBase64'],validate=True)
    require(sha(raw)==plan['controllerSha256']==PREDECESSOR_CONTROLLER_SHA,'Wrong predecessor controller')
    old={'__name__':'_frozen_reader_fix'};exec(compile(raw,'frozen-reader-fix-scoped-node.py','exec'),old)
    require(old['ALLOWED']==frozenset({READER}) and old['BASE_SOURCE_COMMIT']==BASE_SOURCE_COMMIT,
        'Wrong predecessor source scope')
    expected=json.loads(json.dumps(plan['runtimeManifestTemplate']))
    expected['searchHold']['markerSha256']=m.get('searchHold',{}).get('markerSha256')
    require(plan.get('format')=='proof-of-work-work-batch-reader-fix-rollout-plan-v1'
        and m==expected and plan['sourceCommit']==m['sourceCommit'] and plan['releaseId']==m['releaseId'],
        'Predecessor manifest differs from reviewed plan')
    old['validate_manifest'](m)
    directory=Path(r.get('rollbackRoot',''))
    require(directory.parent==BACKUPS and directory.resolve(strict=True)==directory
        and re.fullmatch('work-batch-reader-fix-'+re.escape(m['releaseId'])+r'-[0-9]{8}T[0-9]{6}Z',directory.name)
        and Path(p['manifest']['path'])==directory/'manifest.json'
        and Path(p['receipt']['path'])==directory/'receipt.json','Wrong predecessor custody')
    info=directory.lstat();require(stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0
        and stat.S_IMODE(info.st_mode)==0o700,'Unsafe predecessor custody')
    require(r.get('format')==m['format'] and r.get('manifestSha256')==p['manifest']['sha256']
        and all(r.get(k)==m[k] for k in ('sourceCommit','releaseId','baselineHead','baseSourceCommit',
            'restartConfigurationSha256','sourceMetadata','dependencyMetadata','gateway','protectedServices'))
        and all(r.get(k)is True for k in ('installed','sourceWritesStarted','stopRequested',
            'sourceRollbackProhibited','forwardRecoveryRequired','recoveryIncomplete'))
        and r.get('rolledBack')is False and r.get('errorClass')=='ValueError'
        and r.get('recoveryErrorClass')=='ValueError' and 'completedAt' not in r and 'postflight' not in r,
        'Predecessor is not the completed forward-only failure')
    require(r.get('sources')==[{k:v for k,v in row.items() if k!='base64'} for row in m['sources']]
        and r.get('dependencyCount')==len(m['dependencies']) and set(r.get('createdHelpers',{}))=={READER},
        'Predecessor source publication evidence differs')
    outcome=json.loads(dispatch.get('stdout','{}'))
    require(dispatch.get('format')=='proof-of-work-work-batch-reader-fix-node-dispatch-receipt-v1'
        and dispatch.get('planSha256')==p['plan']['sha256'] and dispatch.get('releaseId')==m['releaseId']
        and dispatch.get('dispatchStatus')=='refused' and type(dispatch.get('exitCode'))is int
        and dispatch['exitCode']!=0 and outcome.get('format')=='proof-of-work-work-batch-reader-fix-rollout-result-v1'
        and outcome.get('releaseId')==m['releaseId'] and 'searchRestoreDeferred' in outcome
        and 'searchRestore' not in outcome and 'overlay' not in outcome,'Predecessor dispatcher is not terminal held failure')
    require(p['unit']=='pow-work-batch-reader-fix-'+m['sourceCommit'][:12]+'.service',
        'Wrong predecessor unit identity')
    return {'plan':plan,'manifest':m,'receipt':r,'dispatch':dispatch,'outcome':outcome,'old':old}

def predecessor_fence(p, current=True):
    v=load_predecessor(p);m=v['manifest'];r=v['receipt'];old=v['old']
    unit=dict(line.split('=',1)for line in ctl('show',p['unit'],'-p','ActiveState','-p','MainPID','-p','ExecMainStatus').splitlines())
    require(unit.get('ActiveState')in ('inactive','failed') and unit.get('MainPID')=='0'
        and unit.get('ExecMainStatus')=='1','Predecessor is still running or has an unexpected terminal state')
    row=m['sources'][0];owned=r['createdHelpers'][READER]
    require(owned.get('published')is True and owned.get('candidateSha256')==row['after']
        and owned.get('baselineIdentity')==m['sourceIdentities'][READER],'Predecessor publication journal differs')
    quarantine=Path(owned['quarantine']);q=quarantine.lstat()
    require(quarantine.parent==QUARANTINE_PARENT and quarantine.resolve(strict=True)==quarantine
        and stat.S_ISDIR(q.st_mode) and q.st_uid==q.st_gid==0 and stat.S_IMODE(q.st_mode)==0o700
        and quarantine.name.startswith('.proofofwork-work-batch-reader-fix-')
        and Path(owned['beforePath'])==quarantine/'before-0.mjs','Wrong retained predecessor inode custody')
    before=Path(owned['beforePath'])
    require(creation_identity(before.lstat())==owned['baselineIdentity'] and sha(safe_read(before))==row['before']
        and sha(safe_read(Path(r['rollbackRoot'])/'before-0.mjs'))==row['before'],
        'Original accepted reader inode or byte evidence changed')
    accepted_inventory_fence(m['acceptedInventorySha256'])
    require_restart_configuration(m['restartConfigurationSha256'])
    if current:
        require_apps_drained();old['installed_source_fence'](ROOT,m,r['createdHelpers'])
        metadata_fence(ROOT,m['dependencyMetadata'],installed=True)
        require(all(sha(safe_read(ROOT/name))==(row['after'] if name==READER else expected)
            for name,expected in m['dependencies'].items()),'Preserved predecessor dependency changed')
        require(states(AUTHORITY)==r['authority'],'Authority process changed since predecessor')
        require_search_held(states(SEARCH))
        hold=safe_read(HOLD,65536)
        require(sha(hold)==m['searchHold']['markerSha256'] and all(json.loads(hold).get(k)==val
            for k,val in m['searchHold']['bindings'].items()),'Original Search hold changed')
    return v

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
    require(m.get('format') == 'proof-of-work-work-batch-reader-recovery-scoped-runtime-v1', 'Wrong manifest')
    require(m.get('baseSourceCommit') == BASE_SOURCE_COMMIT, 'Wrong approved base source commit')
    require(m.get('services') == list(UNITS) and re.fullmatch(
        '[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', m.get('releaseId', '')), 'Wrong release/services')
    require(all(re.fullmatch('[0-9a-f]{40}', m.get(key, '')) for key in
        ('sourceCommit', 'baselineHead')), 'Invalid Git pins')
    require(m['releaseId'].split('-',1)[0] == m['sourceCommit'][:12], 'Release does not bind source commit')
    require(SHA.fullmatch(m.get('acceptedInventorySha256','')),'Missing accepted overlay inventory pin')
    rows = m.get('sources')
    require(isinstance(rows, list) and len(rows) == len(ALLOWED) and
        {row.get('path') for row in rows} == ALLOWED, 'Wrong WORK canonical reader source allowlist')
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
    require(isinstance(m.get('restartConfigurationSha256'),str) and
        SHA.fullmatch(m['restartConfigurationSha256']), 'Missing restart configuration pin')
    require(isinstance(m.get('nodeSha256'), str) and SHA.fullmatch(m['nodeSha256']), 'Missing Node pin')
    protected = m.get('protectedServices')
    require(isinstance(protected, dict) and set(protected) == {'files', 'states'}
        and set(protected['files']) == set(PROTECTED)
        and set(protected['states']) == set(PROTECTED), 'Missing protected service pins')
    require(all(isinstance(value, str) and SHA.fullmatch(value) for value in protected['files'].values())
        and all(isinstance(row, dict) and set(row) == {'ActiveState', 'MainPID', 'WorkingDirectory'}
            and row['ActiveState'] in ('active','inactive','failed','activating') and isinstance(row['MainPID'], str)
            and row['MainPID'].isdigit() and int(row['MainPID']) >= 0
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
    require(isinstance(bindings, dict) and bindings.get('releaseId') == load_predecessor(m['predecessor'])['manifest']['releaseId'] and
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
    validate_service_baseline(protected['states'])
    validate_batch_authority(m.get('batchAuthority',{}))
    prior=load_predecessor(m['predecessor']);pm=prior['manifest'];pr=prior['receipt']
    for key in ('baselineHead','baseSourceCommit','acceptedInventorySha256','restartConfigurationSha256',
            'nodeSha256','gateway','protectedServices','batchAuthority','searchHold','dependencyMetadata'):
        require(m[key]==pm[key],'Recovery changes predecessor preservation contract: '+key)
    expected=dict(pm['dependencies']);expected[READER]=pm['sources'][0]['after']
    require(m['dependencies']==expected and m.get('nodePath')==prior['plan']['nodePath'],
        'Recovery dependency/Node closure differs from predecessor')
    require(m['sourceMetadata']=={name:pm['dependencyMetadata'][name]for name in ALLOWED},
        'Recovery changes source metadata')
    by_path={row['path']:row for row in rows}
    require(all(by_path[name]['before']==expected[name] for name in ALLOWED)
        and by_path[READER]['after']==expected[READER]
        and by_path['server/proof-api.mjs']['after']!=expected['server/proof-api.mjs']
        and m['sourceIdentities'][READER]==pr['createdHelpers'][READER]['candidateIdentity'],
        'Recovery does not preserve the exact installed reader lineage')
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

def process_environment(pid):
    require(isinstance(pid, str) and pid.isdigit() and int(pid) > 0, 'Invalid runtime PID')
    with open('/proc/'+pid+'/environ','rb') as stream: raw = stream.read(1024*1024+1)
    require(len(raw) <= 1024*1024, 'Oversized runtime environment')
    return dict(item.decode('utf-8').split('=',1) for item in raw.split(b'\0') if b'=' in item)

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
    pins = {'managerEnvironment':manager}
    for unit in (*UNITS,*GATEWAY):
        properties = {key:ctl('show',unit,'--value','-p',key) for key in
            ('Environment','EnvironmentFiles','PassEnvironment','UnsetEnvironment','ExecStart','WorkingDirectory','FragmentPath','DropInPaths','Listen','Service','Accept','Requires','PartOf')}
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
        for name in [properties['FragmentPath'], *shlex.split(properties['DropInPaths'])]:
            require(name.startswith('/'), 'Unsupported service configuration path')
            source_pins[name] = sha(safe_read(Path(name),1024*1024))
        pins[unit] = {'properties':properties,'files':source_pins}
    # Only this digest leaves the function. Environment values remain private.
    return sha(json.dumps(pins,sort_keys=True,separators=(',',':')).encode())

def require_restart_configuration(expected):
    require(restart_configuration_pin() == expected, 'Restart configuration changed')

def validate_service_baseline(value):
    require(type(value)is dict and set(value)==set(UNITS),'Missing runtime service baseline')
    for unit,row in value.items():
        require(row.get('WorkingDirectory')==str(ROOT) and str(row.get('MainPID','')).isdigit(),
            'Unsafe runtime service baseline')
        if unit==UNITS[0]:
            require(row.get('ActiveState')=='active' and int(row['MainPID'])>0,'API process unavailable')
        else:
            require((row.get('ActiveState')=='active' and int(row['MainPID'])>0) or
                (row.get('ActiveState')in ('inactive','failed','activating') and row['MainPID']=='0'),
                'Unsupported degraded worker state')

def require_service_baseline(actual,captured):
    validate_service_baseline(captured);validate_service_baseline(actual)
    require(actual[UNITS[0]]==captured[UNITS[0]],'Captured API process changed')
    # This incident's worker may cycle through its configured restart loop.
    # Its effective unit/Node/source configuration is fenced separately; drain
    # and a zero-PID check remain mandatory before any source publication.

def capture_api_environment():
    before=states((UNITS[0],));row=before[UNITS[0]]
    require(row['ActiveState']=='active' and row['MainPID'].isdigit() and int(row['MainPID'])>0
        and row['WorkingDirectory']==str(ROOT),'API process unavailable')
    environment=process_environment(row['MainPID'])
    require(states((UNITS[0],))==before,'API changed during environment capture')
    return environment

def local_json(path):
    environment=capture_api_environment();port=environment.get('PORT','8081')
    require(port.isdigit() and 1<=int(port)<=65535,'Invalid local API port')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    with opener.open('http://127.0.0.1:'+port+path,timeout=5)as response:
        raw=response.read(2*1024**2+1)
        require(response.status==200 and len(raw)<=2*1024**2,'Invalid local API response')
    value=json.loads(raw);require(type(value)is dict,'Invalid local API object');return value

def validate_batch_authority(value):
    require(type(value)is dict and set(value)=={'protocol','network','active','writeEnabled',
        'declarationTxid','activationHeight','limits','registryFeeProofs'} and
        value['protocol']=='work-batch-v1' and value['network']=='livenet' and
        value['active']is True and value['writeEnabled']is True and
        re.fullmatch('[0-9a-f]{64}',value['declarationTxid'] or '') and
        type(value['activationHeight'])is int and value['activationHeight']>0 and
        value['limits']=={'minRecipients':2,'maxRecipients':256,'maxPayloadBytes':65536} and
        value['registryFeeProofs']==546,'Existing batch authority unavailable or changed')
    return value

def batch_authority(value=None):
    value=local_json('/api/v1/work-batch-status')if value is None else value
    selected={key:value.get(key)for key in ('protocol','network','active','writeEnabled',
        'declarationTxid','activationHeight','limits','registryFeeProofs')}
    return validate_batch_authority(selected)

SUMMARY_KEYS=frozenset(('growthSummary','inceptionSummary','infinitySummary','logSummary',
    'marketplaceSummary','tokenSummary','workFloor','workSummary'))
def canonical_health(value):
    checks=value.get('checks',{});index=checks.get('index',{});node=checks.get('node',{});worker=checks.get('worker',{})
    summary=index.get('summarySnapshot',{});height=node.get('tipHeight');block_hash=node.get('bestBlockHash')
    require(value.get('ok')is True and value.get('ready')is True and node.get('ok')is True and
        node.get('initialBlockDownload')is False and node.get('txindexSynced')is True and
        type(height)is int and height>0 and type(block_hash)is str and SHA.fullmatch(block_hash),
        'Canonical node health unavailable')
    require(index.get('complete')is True and index.get('checkpointCanonical')is True and
        value.get('indexedThroughBlock')==value.get('tipHeight')==index.get('indexedThroughBlock')==
        index.get('scanTipHeight')==height and value.get('lagBlocks')==0 and
        index.get('checkpointHash')==index.get('canonicalCheckpointHash')==block_hash,
        'Canonical scan is not at the node tip')
    require(summary.get('ok')is True and summary.get('eligible')is True and
        summary.get('indexedThroughBlock')==height and summary.get('blockHash')==block_hash and
        type(summary.get('snapshotId'))is str and 0<len(summary['snapshotId'])<=128 and
        SUMMARY_KEYS<=summary.get('coverageByKey',{}).keys() and
        all(summary['coverageByKey'][key]==height for key in SUMMARY_KEYS),
        'Canonical summary has not caught up')
    require(worker.get('ok')is True and worker.get('proofReady')is True and
        worker.get('consecutiveFailures')==0,'Canonical worker is not healthy')
    return {'tipHeight':height,'tipHash':block_hash,'summarySnapshotId':summary['snapshotId'],
        'summaryCoverage':{key:summary['coverageByKey'][key]for key in sorted(SUMMARY_KEYS)}}

def validate_postflight(value,authority):
    require(type(value)is dict and value.get('format')=='work-batch-reader-recovery-postflight-v1' and
        all(value.get(key)is True for key in ('qualified','summaryCaughtUp','workBatchReady')) and
        value.get('batchAuthority')==authority and type(value.get('tipHeight'))is int and
        value['tipHeight']>0 and SHA.fullmatch(value.get('tipHash','')) and
        type(value.get('summarySnapshotId'))is str and 0<len(value['summarySnapshotId'])<=128 and
        type(value.get('summaryCoverage'))is dict and set(value['summaryCoverage'])==SUMMARY_KEYS and
        all(height==value['tipHeight']for height in value['summaryCoverage'].values()),
        'Incomplete canonical reader postflight')
    validate_batch_authority(authority)
    return value

def require_postflight(authority,timeout_seconds=600):
    deadline=time.monotonic()+timeout_seconds
    while True:
        try:
            first=canonical_health(local_json('/health'))
            batch=local_json('/api/v1/work-batch-status')
            require(batch_authority(batch)==authority and batch.get('ready')is True and
                batch.get('checkedTipHeight')==first['tipHeight'] and batch.get('checkedTipHash')==first['tipHash'],
                'Batch readiness does not match canonical tip')
            second=canonical_health(local_json('/health'))
            require(first==second,'Canonical tip or summary moved during postflight')
            return validate_postflight({'format':'work-batch-reader-recovery-postflight-v1','qualified':True,
                'summaryCaughtUp':True,'workBatchReady':True,'batchAuthority':authority,**second,
                'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()},authority)
        except (OSError,ValueError,KeyError,TypeError):
            if time.monotonic()>=deadline:raise ValueError('Canonical reader postflight unavailable')from None
            time.sleep(2)

def ctl(*args):
    return subprocess.check_output(['/usr/bin/systemctl', *args], text=True, timeout=30,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}).strip()

def states(units):
    return {unit: dict(line.split('=', 1) for line in ctl('show', unit, '-p', 'ActiveState',
        '-p', 'MainPID', '-p', 'WorkingDirectory').splitlines()) for unit in units}

def require_protected_services(pins, phase='baseline'):
    require(phase in ('baseline', 'drained', 'restored'), 'Unknown protected service phase')
    actual = states(PROTECTED)
    require(set(actual)==set(PROTECTED),'Incomplete protected service state')
    if phase == 'baseline':
        require_service_baseline(actual,pins['states'])
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

def restore_baseline_apps(m,authority,search,hold_raw):
    # A previously failed/restarting zero-PID worker is left quiescent on a
    # pre-write refusal; never claim that restarting the known-broken code healed it.
    baseline=m['protectedServices']['states'];validate_service_baseline(baseline)
    for unit in UNITS:
        if baseline[unit]['ActiveState']=='active':
            subprocess.run(['/usr/bin/systemctl','start',unit],check=True,timeout=60)
    for unit in GATEWAY:
        if m['gateway']['active'][unit]=='active':
            subprocess.run(['/usr/bin/systemctl','start',unit],check=True,timeout=60)
    actual=states(UNITS)
    for unit,row in actual.items():
        require(row['WorkingDirectory']==str(ROOT),'Baseline working directory changed')
        if baseline[unit]['ActiveState']=='active':
            require(row['ActiveState']=='active' and row['MainPID'].isdigit() and int(row['MainPID'])>0,
                'Baseline running service not restored')
        else:require(row['ActiveState']=='inactive' and row['MainPID']=='0','Degraded worker not quiescent')
    require_gateway_baseline(gateway_states(),m['gateway'])
    require(states(AUTHORITY)==authority and states(SEARCH)==search and safe_read(HOLD,65536)==hold_raw,
        'Unrelated baseline recovery state changed')
    require_restart_configuration(m['restartConfigurationSha256'])
    return actual

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
    for name in ALLOWED:
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
    require(candidate is True, 'reader hotfix installation is forward-only')
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
    quarantine=QUARANTINE_PARENT/('.proofofwork-work-batch-reader-recovery-'+stamp+'-'+os.urandom(8).hex())
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
    predecessor_fence(m['predecessor'])
    source_identity_fence(ROOT,m)
    require_restart_configuration(m['restartConfigurationSha256'])
    prior=load_predecessor(m['predecessor'])
    require(m['batchAuthority']==prior['manifest']['batchAuthority'],'Preserved batch authority differs')
    hold_raw = safe_read(HOLD,65536); require(sha(hold_raw) == m['searchHold']['markerSha256'], 'Search hold changed')
    hold_info = HOLD.stat()
    require((hold_info.st_uid,hold_info.st_gid,stat.S_IMODE(hold_info.st_mode),hold_info.st_nlink)
        == (0,0,0o600,1), 'Unsafe Search hold owner/mode')
    require(all(json.loads(hold_raw).get(k) == v for k,v in m['searchHold']['bindings'].items()), 'Wrong Search hold')
    for name, expected in m['searchHold']['bindings']['files'].items():
        require(sha(safe_read(Path('/etc/systemd/system')/name,65536)) == expected, 'Search unit changed')
    search, authority, services = states(SEARCH), states(AUTHORITY), states(UNITS)
    require_protected_services(m['protectedServices'],'drained')
    require_search_held(search)
    for name, expected in m['gateway']['files'].items():
        require(sha(safe_read(Path('/etc/systemd/system')/name,65536)) == expected, 'Gateway unit changed')
    require_apps_drained()
    require(m['gateway']==prior['manifest']['gateway'],'Original gateway restoration intent differs')
    require(all(row['ActiveState'] == 'active' and int(row['MainPID']) > 0
        for row in authority.values()), 'Authority unavailable')
    node = Path(m['nodePath'])
    require(str(node)==prior['plan']['nodePath'],'Predecessor Node path differs')
    require(str(node).startswith('/opt/node-') and sha(safe_read(node,200*1024**2)) == m['nodeSha256'], 'Node changed')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = BACKUPS/('work-batch-reader-recovery-'+m['releaseId']+'-'+stamp); backup.mkdir(mode=0o700)
    receipt = {'format':m['format'], 'releaseId':m['releaseId'], 'sourceCommit':m['sourceCommit'],
        'baselineHead':head, 'manifestSha256':sha(raw), 'rollbackRoot':str(backup),
        'restartConfigurationSha256':m['restartConfigurationSha256'],
        'dependencyCount':len(m['dependencies']), 'authority':authority, 'gateway':m['gateway'],
        'protectedServices':m['protectedServices'], 'servicesBefore':services, 'installed':False,
        'sourceMetadata':m['sourceMetadata'], 'dependencyMetadata':m['dependencyMetadata'],
        'baseSourceCommit':m['baseSourceCommit'],'predecessor':m['predecessor'],
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
        receipt['stopRequested']=True; save()
        drain_apps()
        require_protected_services(m['protectedServices'], 'drained')
        require(states(AUTHORITY)==authority
            and states(SEARCH)==search and safe_read(HOLD,65536)==hold_raw,
            'Unrelated state changed'); fence(ROOT,m,candidates)
        metadata_fence(ROOT, m['sourceMetadata'])
        source_identity_fence(ROOT,m)
        accepted_inventory_fence(m['acceptedInventorySha256'])
        require_restart_configuration(m['restartConfigurationSha256'])
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
        require_restart_configuration(m['restartConfigurationSha256'])
        receipt['servicesAfter']=restore_verified_apps(m, authority, search, hold_raw)
        receipt['postflight']=require_postflight(m['batchAuthority'])
        installed_source_fence(ROOT,m,receipt['createdHelpers'])
        metadata_fence(ROOT,m['dependencyMetadata'],installed=True)
        require(all(sha(safe_read(ROOT/name))==expected for name,expected in m['dependencies'].items() if name not in ALLOWED),'Preserved dependency changed after restart')
        accepted_inventory_fence(m['acceptedInventorySha256'])
        require_restart_configuration(m['restartConfigurationSha256'])
        receipt['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); save(); print(json.dumps(receipt),flush=True)
    except BaseException as error:
        receipt['errorClass']=type(error).__name__
        try:
            drain_apps()
            receipt['sourceRollbackProhibited']=True
            receipt['forwardRecoveryRequired']=True
            raise ValueError('Original incident is forward-only; retain corrected sources and Search hold')
        except BaseException as recovery_error:
            receipt['recoveryIncomplete']=True; receipt['recoveryErrorClass']=type(recovery_error).__name__
            save(); print(json.dumps(receipt),flush=True); raise
        save(); print(json.dumps(receipt),flush=True); raise

if __name__ == '__main__': main()
