#!/usr/bin/env python3
"""Capture and rehearse the three-file Audit32 overlay over the accepted active runtime.

Capture is read-only. Plan writes only a new private /tmp directory. Overlay
explicitly dispatches the reviewed, hash-bound plan to production.
"""
import argparse, base64, datetime, hashlib, importlib.util, json, os, re, shlex, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NODE_SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_node_ed25519',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'powadmin@65.108.122.87']

def sha(value): return hashlib.sha256(value).hexdigest()
def save(path, raw):
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output: output.write(raw); output.flush(); os.fsync(output.fileno())
def encoded(value): return (json.dumps(value, indent=2)+'\n').encode()
def controller():
    spec = importlib.util.spec_from_file_location('audit32-first-batch_overlay_plan', ROOT/'scoped-node.py')
    ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns); return ns
def git(repo, *argv):
    return subprocess.check_output(['git', '-C', str(repo), *argv])
def private_output(path):
    if not path.is_absolute() or path.resolve() != path or not str(path).startswith('/tmp/') or path.exists():
        raise ValueError('Output must be a new canonical /tmp path')

def capture(args):
    private_output(args.output)
    code = (ROOT/'scoped-node.py').read_bytes()
    request = encoded({'controllerBase64':base64.b64encode(code).decode(), 'controllerSha256':sha(code)})
    script = (ROOT/'capture-node.py').read_text()
    remote_command = shlex.join(['sudo', '-n', '/usr/bin/python3', '-I', '-B', '-c', script])
    result = subprocess.run([*NODE_SSH, remote_command], input=request,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if result.returncode:
        raise ValueError('Read-only capture refused: '+result.stderr[-4000:].decode('utf-8', errors='replace'))
    if len(result.stdout) > 90*1024**2: raise ValueError('Oversized capture result')
    snapshot = json.loads(result.stdout)
    if snapshot.get('format') != 'proof-of-work-audit32-first-batch-runtime-capture-v1' or snapshot['controllerSha256'] != sha(code):
        raise ValueError('Wrong capture identity')
    save(args.output, result.stdout)
    print(json.dumps({'capture':str(args.output), 'sha256':sha(result.stdout),
        'baselineHead':snapshot['baselineHead'], 'sourceFiles':len(snapshot['sources']),
        'runtimeDependencies':len(snapshot['dependencyPaths'])}))

def reviewed_merges(path, ns):
    """Load explicit resolutions, bound to the exact captured/base/candidate bytes."""
    if path is None: return {}
    raw = ns.safe_read(path, 65536)
    value = json.loads(raw)
    if set(value) != {'format', 'sources'} or value['format'] != 'proof-of-work-audit32-first-batch-reviewed-merges-v1':
        raise ValueError('Wrong reviewed merge manifest')
    rows = value['sources']
    if not isinstance(rows, list) or len(rows) > len(ns.ALLOWED - ns.NEW):
        raise ValueError('Wrong reviewed merge count')
    result = {}
    fields = {'path', 'activeSha256', 'baseSha256', 'repositoryCandidateSha256',
        'mergedPath', 'mergedSha256', 'reason'}
    for row in rows:
        if not isinstance(row, dict) or set(row) != fields or row['path'] not in ns.ALLOWED - ns.NEW or row['path'] in result:
            raise ValueError('Wrong reviewed merge allowlist')
        if not all(isinstance(row[key], str) and ns.SHA.fullmatch(row[key]) for key in
                ('activeSha256', 'baseSha256', 'repositoryCandidateSha256', 'mergedSha256')):
            raise ValueError('Invalid reviewed merge source pin')
        source = Path(row['mergedPath'])
        if not source.is_absolute() or source.resolve(strict=True) != source or not str(source).startswith('/tmp/'):
            raise ValueError('Reviewed merge must use a canonical /tmp source')
        if not isinstance(row['reason'], str) or not row['reason'].strip() or len(row['reason']) > 2000:
            raise ValueError('Reviewed merge requires an explicit review reason')
        merged = ns.safe_read(source)
        if sha(merged) != row['mergedSha256']:
            raise ValueError('Reviewed merge bytes differ')
        if re.search(br'(?m)^(<<<<<<< |\|\|\|\|\|\|\| |=======\s*$|>>>>>>> )', merged):
            raise ValueError('Reviewed merge still contains conflict markers')
        merged.decode('utf-8')
        result[row['path']] = {**row, 'mergedBytes':merged}
    return result

def selected_merge(name, merged, conflict, active, base, candidate, reviewed):
    row = reviewed.get(name)
    if row is None:
        if conflict: raise ValueError('Audit32 first batch merge requires explicit review: '+name)
        return merged, None
    if any(row[key] != sha(raw) for key, raw in
            [('activeSha256',active), ('baseSha256',base), ('repositoryCandidateSha256',candidate)]):
        raise ValueError('Reviewed merge source identity differs: '+name)
    return row['mergedBytes'], {key:value for key,value in row.items() if key != 'mergedBytes'}

def plan(args):
    private_output(args.output); repo = args.repository.resolve(strict=True); ns = controller()
    if not re.fullmatch('[0-9a-f]{40}', args.commit) or git(repo, 'rev-parse', 'HEAD').decode().strip() != args.commit:
        raise ValueError('Require exact committed candidate checkout')
    if git(repo, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Candidate checkout must be clean before release planning')
    if args.base_commit != ns.BASE_SOURCE_COMMIT: raise ValueError('Require exact approved base source commit')
    git(repo, 'merge-base', '--is-ancestor', args.base_commit, args.commit)
    reviewed = reviewed_merges(getattr(args, 'reviewed_merges', None), ns)
    release = args.release_id or args.commit[:12]+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) or release.split('-')[0] != args.commit[:12]:
        raise ValueError('Release must bind the exact source commit')
    captured = args.capture.read_bytes(); snapshot = json.loads(captured)
    if snapshot.get('format') != 'proof-of-work-audit32-first-batch-runtime-capture-v1' or snapshot['root'] != str(ns.ROOT):
        raise ValueError('Wrong runtime capture')
    controller_raw = (ROOT/'scoped-node.py').read_bytes(); holder = ROOT.parent/'search/hold-node-timer.py'
    if snapshot['controllerSha256'] != sha(controller_raw): raise ValueError('Capture uses another controller')
    for path in (ROOT/'release.py', ROOT/'capture-node.py', ROOT/'scoped-node.py', ROOT/'rollout-node.py', holder):
        if path.read_bytes() != git(repo, 'show', args.commit+':'+str(path.relative_to(repo))):
            raise ValueError('Tool differs from committed candidate: '+path.name)
    args.output.mkdir(mode=0o700)
    active_root = args.output/'captured-runtime'; active_root.mkdir(mode=0o700)
    for name, row in snapshot['sources'].items():
        ns.source_path(name); raw = base64.b64decode(row['base64'], validate=True)
        if sha(raw) != row['sha256']: raise ValueError('Captured source hash differs')
        target = active_root/name; target.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(target,raw)
    candidates, rows, reviews = {}, [], []
    for name in sorted(ns.ALLOWED):
        candidate = git(repo, 'show', args.commit+':'+name)
        current = snapshot['sources'].get(name)
        if current is None: raise ValueError('Missing active source: '+name)
        before = current['sha256']; base = git(repo, 'show', args.base_commit+':'+name)
        location = args.output/'merge'/name; location.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        for suffix, raw in [('active', (active_root/name).read_bytes()), ('base',base), ('audit32-first-batch',candidate)]:
            save(location.with_name(location.name+'.'+suffix), raw)
        result = subprocess.run(['git','merge-file','--stdout','--diff3',str(location)+'.active',str(location)+'.base',str(location)+'.audit32-first-batch'],capture_output=True)
        merged = result.stdout; conflict = result.returncode != 0
        if conflict:
            save(location.with_name(location.name+'.conflicted'), merged)
        merged, resolution = selected_merge(name, merged, conflict,
            (active_root/name).read_bytes(), base, candidate, reviewed)
        save(location, merged)
        file = args.output/'candidate'/name; file.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(file,merged)
        subprocess.run(['node','--check',str(file)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        candidates[name] = merged
        rows.append({'path':name,'before':before,'after':sha(merged),'base64':base64.b64encode(merged).decode()})
        reviews.append({'path':name,'before':before,'after':sha(merged),'repositoryCandidateSha256':sha(candidate),
            'cleanThreeWayMerge':not conflict, 'explicitResolution':resolution, 'syntaxVerified':True})
    deps = {name:row['sha256'] for name,row in snapshot['sources'].items()}
    if set(reviewed) - candidates.keys(): raise ValueError('Unused reviewed merge input')
    for row in rows:
        if row['before'] is not None: deps[row['path']] = row['before']
    template = {'format':'proof-of-work-audit32-first-batch-scoped-runtime-v1','sourceCommit':args.commit,
        'baseSourceCommit':args.base_commit,
        'releaseId':release,'baselineHead':snapshot['baselineHead'],'services':list(ns.UNITS),
        'sources':rows,'dependencies':deps,'nodeSha256':snapshot['nodeSha256'],'gateway':snapshot['gateway'],
        'sourceMetadata':{name:{key:snapshot['sources'][name][key] for key in ('uid','gid','mode')}
            for name in sorted(ns.ALLOWED)},
        'protectedServices':snapshot['protectedServices'],
        'searchHold':{'markerSha256':'0'*64,'bindings':{'releaseId':release,'attempt':'initial','files':snapshot['searchFiles']}}}
    ns.validate_manifest(template); ns.fence(active_root, template, candidates)
    preview = {'format':'proof-of-work-audit32-first-batch-rollout-plan-v1','releaseId':release,'sourceCommit':args.commit,
        'baseCommit':args.base_commit,'captureSha256':sha(captured),'baselineHead':snapshot['baselineHead'],
        'controllerSha256':sha(controller_raw),'controllerBase64':base64.b64encode(controller_raw).decode(),
        'searchHoldControllerSha256':sha(holder.read_bytes()),'searchHoldControllerBase64':base64.b64encode(holder.read_bytes()).decode(),
        'runtimeManifestTemplate':template,'nodePath':snapshot['nodePath'],
        'rolloutSupervisorSha256':sha((ROOT/'rollout-node.py').read_bytes()),
        'reviews':reviews,'productionMutation':False}
    raw = encoded(preview)
    if len(raw) > 20*1024**2: raise ValueError('Rollout manifest exceeds controller bound')
    save(args.output/'plan.json',raw); save(args.output/'review.json',encoded(reviews))
    print(json.dumps({'plan':str(args.output/'plan.json'),'sha256':sha(raw),'releaseId':release,
        'files':len(rows),'dependencies':len(deps),'bytes':len(raw),'rehearsal':'complete-source-fence-and-merged-syntax-passed'}))

def overlay(args):
    private_output(args.receipt)
    raw = args.plan.read_bytes(); preview = json.loads(raw)
    script = (ROOT/'rollout-node.py').read_bytes()
    key = 'rolloutSupervisorSha256'
    if preview.get('format') != 'proof-of-work-audit32-first-batch-rollout-plan-v1' or sha(script) != preview[key]:
        raise ValueError('Rollout supervisor differs from the reviewed plan')
    remote_command = shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-c',script.decode()])
    try:
        result = subprocess.run([*NODE_SSH,remote_command],input=raw,capture_output=True,timeout=1200)
    except subprocess.TimeoutExpired as error:
        receipt = {'format':'proof-of-work-audit32-first-batch-local-dispatch-receipt-v1','planSha256':sha(raw),
            'releaseId':preview['releaseId'],'phase':args.phase,'exitCode':None,
            'dispatchStatus':'uncertain-timeout','timeoutSeconds':1200,
            'stdout':(error.stdout or b'').decode(errors='replace')[-1024*1024:],
            'stderr':(error.stderr or b'').decode(errors='replace')[-65536:]}
        save(args.receipt, encoded(receipt))
        raise ValueError('Node rollout timed out; state is uncertain. Inspect preserved receipt and remote controller/hold evidence before recovery: '+str(args.receipt)) from None
    receipt = {'format':'proof-of-work-audit32-first-batch-local-dispatch-receipt-v1','planSha256':sha(raw),
        'releaseId':preview['releaseId'],'phase':args.phase,'exitCode':result.returncode,
        'dispatchStatus':'completed' if result.returncode == 0 else 'refused',
        'stdout':result.stdout.decode(errors='replace')[-1024*1024:],
        'stderr':result.stderr.decode(errors='replace')[-65536:]}
    save(args.receipt, encoded(receipt))
    if result.returncode: raise ValueError('Node rollout refused; inspect preserved receipt '+str(args.receipt))
    print(json.dumps({'receipt':str(args.receipt),'releaseId':preview['releaseId'],'phase':args.phase,'status':'verified'}))

def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(required=True)
    p = sub.add_parser('capture'); p.add_argument('output', type=Path); p.set_defaults(fn=capture)
    p = sub.add_parser('plan'); p.add_argument('repository', type=Path); p.add_argument('commit');
    p.add_argument('base_commit'); p.add_argument('capture', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--release-id'); p.add_argument('--reviewed-merges', type=Path)
    p.set_defaults(fn=plan)
    p = sub.add_parser('overlay'); p.add_argument('plan',type=Path); p.add_argument('receipt',type=Path); p.set_defaults(fn=overlay,phase='overlay')
    args = parser.parse_args(); os.umask(0o077); args.fn(args)

if __name__ == '__main__': main()
