#!/usr/bin/python3 -I
"""Read-only VPS runtime evidence; no files, services, Git or databases are changed."""
import base64, datetime, hashlib, json, os, stat, subprocess, sys
from pathlib import Path

def capture(controller):
    ns = {'__name__': '_work-batch-pending-summary-fix_read_only_capture'}
    exec(compile(controller, 'reviewed-work-batch-pending-summary-fix-scoped-node.py', 'exec'), ns)
    require, read, root = ns['require'], ns['safe_read'], ns['ROOT']
    require(os.geteuid() == 0 and sys.flags.isolated, 'Root and isolated Python required')
    require(all(not os.path.lexists(root/name) for name in ns['NEW']),
        'Creation-only helper already exists')
    ns['require_quarantine_parent'](root)
    ns['capture_api_environment']()
    configuration_pin = ns['restart_configuration_pin']()
    source_identities={name:ns['creation_identity']((root/name).lstat()) if name not in ns['NEW'] else None for name in ns['ALLOWED']}
    source_parents={name:ns['parent_identity']((root/name).parent.lstat()) for name in ns['ALLOWED']}
    authority_status=ns['batch_authority']()
    inventory_raw=read(ns['ACCEPTED_OVERLAYS'],4*1024**2)
    inventory_pin=ns['sha'](inventory_raw)
    require(inventory_pin==ns['ACCEPTED_INVENTORY_SHA256'],'Capture is not the accepted V6 inventory')
    require(ns['sha'](read(root/'server/proof-api.mjs'))==ns['ACCEPTED_API_SHA256'],
        'Capture is not the accepted V6 API')
    ns['accepted_inventory_fence'](inventory_pin)
    overlays=json.loads(inventory_raw)['overlays']
    require(isinstance(overlays,list) and len(overlays)<=2000 and
        len({row['path'] for row in overlays})==len(overlays),'Invalid accepted inventory')
    require(not any(row['path'] in ns['NEW'] for row in overlays),'New reader hotfix source already accepted')
    paths = {ns['source_path'](row['path']) for row in overlays} | set(ns['dependency_closure'](root)) | set(ns['ROOT_JSON']) | (ns['ALLOWED'] - ns['NEW'])
    paths.add(ns['METADATA_TEMPLATE'])
    # Protect the accepted worker overlay even though its child indexer is
    # already an entrypoint of the controller's import-closure guard.
    paths.add('scripts/run-proof-indexer-worker.mjs')
    pending = ['scripts/run-proof-indexer-worker.mjs']
    while pending:
        parent = pending.pop()
        for target in ns['IMPORT'].findall(read(root/parent).decode('utf-8')):
            dependency = ns['relative_import'](parent, target)
            if dependency.endswith(('.mjs', '.js', '.json')) and dependency not in paths:
                paths.add(dependency); pending.append(dependency)
    closure = sorted(paths)
    # Source custody also includes inactive tracked code and accepted untracked
    # helpers. No .env, runtime credentials, node_modules or wallet data is read.
    for directory in ('server', 'scripts', 'src/shared/protocol', 'src/features/identity'):
        for path in (root/directory).rglob('*'):
            if path.is_file() and path.suffix in ('.mjs', '.js', '.json', '.sql'):
                paths.add(ns['source_path'](str(path.relative_to(root))))
    require(len(paths) <= 2000, 'Oversized source inventory')
    sources, total = {}, 0
    for name in sorted(paths):
        raw = read(root/name); total += len(raw)
        require(total <= 64*1024**2, 'Source custody exceeds 64 MiB')
        info = (root/name).stat()
        sources[name] = {'sha256': ns['sha'](raw), 'base64': base64.b64encode(raw).decode(),
            'uid': info.st_uid, 'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode)}
    git = ['/usr/bin/git', '-c', f'safe.directory={root}', '-C', str(root)]
    head = subprocess.check_output([*git, 'rev-parse', 'HEAD'], text=True).strip()
    authority=ns['states'](ns['AUTHORITY'])
    require(all(row['ActiveState']=='active' and int(row['MainPID'])>0 for row in authority.values()),'Authority unavailable')
    services = ns['states'](ns['UNITS'])
    ns['validate_service_baseline'](services)
    node = Path(os.readlink('/proc/'+services[ns['UNITS'][0]]['MainPID']+'/exe'))
    require(str(node).startswith('/opt/node-'), 'Unexpected local Node executable')
    file_hash = lambda path: ns['sha'](read(path))
    units = Path('/etc/systemd/system')
    pins = {'files': {unit: file_hash(units/unit) for unit in ns['GATEWAY']},
        'active': {}, 'unitFileStates': {}}
    for unit, row in ns['gateway_states']().items():
        pins['active'][unit] = row['ActiveState']; pins['unitFileStates'][unit] = row['UnitFileState']
    search = {unit: file_hash(units/unit) for unit in ns['SEARCH']}
    require(not os.path.lexists(ns['HOLD']), 'Another Search hold is active')
    # Fence all source reads a second time before returning their byte custody.
    require(all(file_hash(root/name) == row['sha256'] for name, row in sources.items()), 'Runtime source changed')
    require(subprocess.check_output([*git, 'rev-parse', 'HEAD'], text=True).strip() == head, 'Runtime Git changed')
    require(all(not os.path.lexists(root/name) for name in ns['NEW']), 'Creation-only helper appeared')
    ns['require_restart_configuration'](configuration_pin)
    ns['accepted_inventory_fence'](inventory_pin)
    require(all(sources[row['path']]['sha256']==row['sha256'] for row in overlays),'Accepted overlay source differs')
    ns['source_identity_fence'](root,{'sourceIdentities':source_identities,'sourceParents':source_parents})
    ns['require_service_baseline'](ns['states'](ns['UNITS']),services)
    require(ns['states'](ns['AUTHORITY'])==authority,'Authority changed during capture')
    return {'acceptedInventorySha256':inventory_pin,'batchAuthority':authority_status,'restartConfigurationSha256':configuration_pin, 'format': 'proof-of-work-work-batch-pending-summary-fix-runtime-capture-v1',
        'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'root': str(root), 'baselineHead': head, 'controllerSha256': ns['sha'](controller),
        'sourceIdentities':source_identities,
        'sourceParents':source_parents,
        'status': subprocess.check_output([*git, 'status', '--short'], text=True),
        'sources': sources, 'dependencyPaths': closure,
        'nodePath': str(node), 'nodeSha256': ns['sha'](read(node, 200*1024**2)),
        'gateway': pins, 'searchFiles': search, 'services': services,
        'authority': authority, 'search': ns['states'](ns['SEARCH']),
        'protectedServices': {'files': {unit:file_hash(units/unit) for unit in ns['PROTECTED']},
            'states':services}}

def main():
    raw = sys.stdin.buffer.read(1024*1024+1)
    if len(raw) > 1024*1024: raise ValueError('Oversized capture request')
    request = json.loads(raw)
    controller = base64.b64decode(request['controllerBase64'], validate=True)
    if hashlib.sha256(controller).hexdigest() != request['controllerSha256']:
        raise ValueError('Controller bytes differ')
    print(json.dumps(capture(controller)), flush=True)

if __name__ == '__main__': main()
