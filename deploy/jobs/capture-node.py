#!/usr/bin/python3 -I
"""Read-only runtime custody; no files, services, Git or databases are changed."""
import base64, datetime, hashlib, json, os, stat, subprocess, sys
from pathlib import Path

def capture(controller):
    ns = {'__name__': '_jobs_read_only_capture'}
    exec(compile(controller, 'reviewed-jobs-scoped-node.py', 'exec'), ns)
    require, read, root = ns['require'], ns['safe_read'], ns['ROOT']
    require(os.geteuid() == 0 and sys.flags.isolated, 'Root and isolated Python required')
    paths = set(ns['dependency_closure'](root)) | set(ns['ROOT_JSON'])
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
    services = ns['states'](ns['UNITS'])
    require(all(row['ActiveState'] == 'active' and row['WorkingDirectory'] == str(root)
        and int(row['MainPID']) > 0 for row in services.values()), 'Runtime services unavailable')
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
    return {'format': 'proof-of-work-jobs-runtime-capture-v1',
        'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'root': str(root), 'baselineHead': head, 'controllerSha256': ns['sha'](controller),
        'status': subprocess.check_output([*git, 'status', '--short'], text=True),
        'sources': sources, 'dependencyPaths': closure,
        'nodePath': str(node), 'nodeSha256': ns['sha'](read(node, 200*1024**2)),
        'gateway': pins, 'searchFiles': search, 'services': services,
        'protectedServices':{'files':{unit:file_hash(units/unit) for unit in ns['PROTECTED']},
            'states':{unit:services[unit] for unit in ns['PROTECTED']}},
        'authority': ns['states'](ns['AUTHORITY']), 'search': ns['states'](ns['SEARCH']),
        'workerUnitSha256': file_hash(units/'proofofwork-indexer-worker.service')}

def main():
    raw = sys.stdin.buffer.read(1024*1024+1)
    if len(raw) > 1024*1024: raise ValueError('Oversized capture request')
    request = json.loads(raw)
    controller = base64.b64decode(request['controllerBase64'], validate=True)
    if hashlib.sha256(controller).hexdigest() != request['controllerSha256']:
        raise ValueError('Controller bytes differ')
    print(json.dumps(capture(controller)), flush=True)

if __name__ == '__main__': main()
