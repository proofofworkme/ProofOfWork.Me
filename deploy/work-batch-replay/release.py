#!/usr/bin/env python3
"""Capture and rehearse the scoped WORK batch bounded declaration replay overlay over the accepted active runtime.

Run every command as root with python3 -I -B on the node VPS. Full captures,
plans and receipts remain in private /tmp paths there. Only compact summaries
may return to the operator. Overlay explicitly applies the reviewed plan.
"""
import argparse, base64, datetime, hashlib, importlib.util, json, os, re, signal, stat, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
def node_context():
    """All full evidence and plan operations belong on the node, never the operator."""
    runtime = Path('/opt/proofofwork-api')
    if os.geteuid() != 0 or not sys.flags.isolated or not runtime.is_dir() or runtime.resolve() != runtime:
        raise ValueError('Run root python3 -I -B on the node VPS; local planning/storage is forbidden')


def sha(value): return hashlib.sha256(value).hexdigest()
def save(path, raw):
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output: output.write(raw); output.flush(); os.fsync(output.fileno())
def encoded(value): return (json.dumps(value, indent=2)+'\n').encode()
def controller():
    spec = importlib.util.spec_from_file_location('work-batch-replay_overlay_plan', ROOT/'scoped-node.py')
    ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns); return ns
def git(repo, *argv):
    return subprocess.check_output(['git', '-C', str(repo), *argv])
def private_output(path):
    if not path.is_absolute() or path.resolve() != path or not str(path).startswith('/tmp/') or os.path.lexists(path):
        raise ValueError('Output must be a new canonical /tmp path')
    parent = path.parent
    while parent != Path('/tmp'):
        info = parent.lstat()
        if parent.resolve(strict=True) != parent or not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Evidence parents must be root-owned and not group/world writable')
        parent = parent.parent

def capture(args):
    node_context(); private_output(args.output)
    code = (ROOT/'scoped-node.py').read_bytes()
    script = (ROOT/'capture-node.py').read_bytes()
    ns = {'__name__':'_work_batch_capture'}
    exec(compile(script, 'capture-node.py', 'exec'), ns)
    snapshot = ns['capture'](code); raw = encoded(snapshot)
    if len(raw) > 90*1024**2: raise ValueError('Oversized VPS capture')
    save(args.output, raw); controller().sync(args.output.parent)
    print(json.dumps({'capture':str(args.output),'location':'node-vps','sha256':sha(raw),
        'baselineHead':snapshot['baselineHead'],'sourceFiles':len(snapshot['sources']),
        'runtimeDependencies':len(snapshot['dependencyPaths'])}))


def reviewed_merges(path, ns):
    """Load explicit resolutions, bound to the exact captured/base/candidate bytes."""
    if path is None: return {}
    raw = ns.safe_read(path, 65536)
    value = json.loads(raw)
    if set(value) != {'format', 'sources'} or value['format'] != 'proof-of-work-work-batch-replay-reviewed-merges-v1':
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
        if conflict: raise ValueError('WORK batch bounded declaration replay merge requires explicit review: '+name)
        return merged, None
    if any(row[key] != sha(raw) for key, raw in
            [('activeSha256',active), ('baseSha256',base), ('repositoryCandidateSha256',candidate)]):
        raise ValueError('Reviewed merge source identity differs: '+name)
    return row['mergedBytes'], {key:value for key,value in row.items() if key != 'mergedBytes'}

def approved_base_bytes(repo, commit, name, active, ns):
    # The sole runtime-only helper has a reviewed immutable base. Never infer
    # a base from arbitrary live files or treat an existing helper as creation.
    overlay = ns.ACCEPTED_OVERLAY_BASES.get(name)
    if overlay is None:
        return git(repo, 'show', commit+':'+name)
    if git(repo, 'ls-tree', '--name-only', commit, '--', name):
        raise ValueError('Accepted overlay base unexpectedly exists in Git: '+name)
    if sha(active) != overlay:
        raise ValueError('Accepted overlay base bytes changed: '+name)
    return active

def plan(args, compose_only=False):
    node_context(); private_output(args.output); repo = args.repository.resolve(strict=True); ns = controller()
    if not re.fullmatch('[0-9a-f]{40}', args.commit) or git(repo, 'rev-parse', 'HEAD').decode().strip() != args.commit:
        raise ValueError('Require exact committed candidate checkout')
    if git(repo, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Candidate checkout must be clean before release planning')
    if not ns.BASE_RELEASE_FINALIZED: raise ValueError('Final A3 base pin is not installed')
    if args.base_commit != ns.BASE_SOURCE_COMMIT: raise ValueError('Require exact approved base source commit')
    git(repo, 'merge-base', '--is-ancestor', args.base_commit, args.commit)
    reviewed = reviewed_merges(getattr(args, 'reviewed_merges', None), ns)
    release = args.release_id or args.commit[:12]+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) or release.split('-')[0] != args.commit[:12]:
        raise ValueError('Release must bind the exact source commit')
    captured = ns.safe_read(args.capture, 90*1024**2); snapshot = json.loads(captured)
    if snapshot.get('format') != 'proof-of-work-work-batch-replay-runtime-capture-v1' or snapshot['root'] != str(ns.ROOT):
        raise ValueError('Wrong runtime capture')
    controller_raw = (ROOT/'scoped-node.py').read_bytes(); holder = ROOT.parent/'search/hold-node-timer.py'
    if snapshot['controllerSha256'] != sha(controller_raw): raise ValueError('Capture uses another controller')
    for path in (ROOT/'release.py', ROOT/'capture-node.py', ROOT/'scoped-node.py', ROOT/'rollout-node.py', ROOT/'preflight.mjs', ROOT/'publish-replay.py', ROOT/'storage-extension.sql', ROOT/'catalog-baseline.json', ROOT/'catalog-after.json', holder):
        if path.read_bytes() != git(repo, 'show', args.commit+':'+str(path.relative_to(repo))):
            raise ValueError('Tool differs from committed candidate: '+path.name)
    for name in ns.NEW:
        if name in snapshot['sources'] or git(repo, 'ls-tree', '--name-only', args.base_commit, '--', name):
            raise ValueError('Creation-only helper already exists in capture or base: '+name)
    args.output.mkdir(mode=0o700)
    active_root = args.output/'captured-runtime'; active_root.mkdir(mode=0o700)
    for name, row in snapshot['sources'].items():
        ns.source_path(name); raw = base64.b64decode(row['base64'], validate=True)
        if sha(raw) != row['sha256']: raise ValueError('Captured source hash differs')
        target = active_root/name; target.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(target,raw)
        os.chown(target,row['uid'],row['gid']); os.chmod(target,row['mode'])
    candidates, rows, reviews = {}, [], []
    for name in sorted(ns.ALLOWED):
        candidate = git(repo, 'show', args.commit+':'+name)
        current = snapshot['sources'].get(name)
        if name in ns.NEW:
            merged, before, conflict, resolution = candidate, None, False, None
        else:
            if current is None: raise ValueError('Missing active source: '+name)
            before = current['sha256']; base = approved_base_bytes(repo, args.base_commit, name, (active_root/name).read_bytes(), ns)
            location = args.output/'merge'/name; location.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            for suffix, raw in [('active', (active_root/name).read_bytes()), ('base',base), ('work-batch-replay',candidate)]:
                save(location.with_name(location.name+'.'+suffix), raw)
            result = subprocess.run(['git','merge-file','--stdout','--diff3',str(location)+'.active',str(location)+'.base',str(location)+'.work-batch-replay'],capture_output=True)
            merged = result.stdout; conflict = result.returncode != 0
            if conflict: save(location.with_name(location.name+'.conflicted'), merged)
            merged, resolution = selected_merge(name, merged, conflict,
                (active_root/name).read_bytes(), base, candidate, reviewed)
            save(location, merged)
        file = args.output/'candidate'/name; file.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(file,merged)
        subprocess.run([snapshot['nodePath'],'--check',str(file)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        candidates[name] = merged
        rows.append({'path':name,'before':before,'after':sha(merged),'base64':base64.b64encode(merged).decode()})
        reviews.append({'path':name,'before':before,'after':sha(merged),'repositoryCandidateSha256':sha(candidate),
            'baseSha256':sha(base),'creationOnly':name in ns.NEW, 'cleanThreeWayMerge':name not in ns.NEW and not conflict, 'explicitResolution':resolution, 'syntaxVerified':True})
    composition={'format':'proof-of-work-work-batch-replay-composition-v1',
        'sourceCommit':args.commit,'sourceTree':git(repo,'rev-parse',args.commit+'^{tree}').decode().strip(),
        'baseSourceCommit':args.base_commit,'releaseId':release,'captureSha256':sha(captured),
        'sources':[{key:row[key] for key in ('path','before','after')} for row in rows],
        'reviews':reviews}
    if compose_only:
        composition['candidates']={name:{'path':str(args.output/'candidate'/name),'sha256':sha(raw)}
            for name,raw in sorted(candidates.items())}
        data=encoded(composition);save(args.output/'composition.json',data)
        save(args.output/'review.json',encoded(reviews));ns.sync(args.output)
        print(json.dumps({'composition':str(args.output/'composition.json'),'sha256':sha(data),
            'sourceCommit':args.commit,'sourceTree':composition['sourceTree'],'files':len(rows),
            'productionMutation':False}))
        return
    composition_raw=ns.safe_read(args.composition,2*1024**2)
    if sha(composition_raw)!=args.composition_sha256:raise ValueError('Composition manifest changed')
    previous=json.loads(composition_raw)
    for key,value in composition.items():
        if previous.get(key)!=value:raise ValueError('Composed source provenance changed: '+key)
    if set(previous)!=set(composition)|{'candidates'} or set(previous['candidates'])!=ns.ALLOWED:
        raise ValueError('Composition has unexpected source fields')
    for name,row in previous['candidates'].items():
        path=Path(row['path']);ns.private_evidence_path(path)
        if row.get('sha256')!=sha(candidates[name]) or ns.safe_read(path)!=candidates[name]:
            raise ValueError('Composed candidate bytes changed: '+name)
    deps = {name:row['sha256'] for name,row in snapshot['sources'].items()}
    if set(reviewed) - candidates.keys(): raise ValueError('Unused reviewed merge input')
    for row in rows:
        if row['before'] is not None: deps[row['path']] = row['before']
    template = {'format':'proof-of-work-work-batch-replay-scoped-runtime-v1','sourceCommit':args.commit,
        'baseSourceCommit':args.base_commit,'sourceTree':git(repo,'rev-parse',args.commit+'^{tree}').decode().strip(),
        'acceptedOverlayBases':dict(ns.ACCEPTED_OVERLAY_BASES),'captureSha256':sha(captured),
        'replayComposition':{'path':str(args.composition),'sha256':args.composition_sha256},'restartConfigurationSha256':snapshot['restartConfigurationSha256'],
        'releaseId':release,'baselineHead':snapshot['baselineHead'],'services':list(ns.UNITS),
        'sources':rows,'dependencies':deps,'nodeSha256':snapshot['nodeSha256'],'gateway':snapshot['gateway'],
        'sourceMetadata':{name:{key:snapshot['sources'][ns.METADATA_TEMPLATE if name in ns.NEW else name][key]
            for key in ('uid','gid','mode')} for name in sorted(ns.ALLOWED)},
        'dependencyMetadata':{name:{key:row[key] for key in ('uid','gid','mode')}
            for name,row in snapshot['sources'].items()},
        'sourceIdentities':{name:snapshot['sources'][name]['identity'] for name in ns.ALLOWED},
        'sourceParents':{name:snapshot['sources'][name]['parentIdentity'] for name in ns.ALLOWED},
        'protectedServices':snapshot['protectedServices'],
        'searchHold':{'markerSha256':'0'*64,'bindings':{'releaseId':release,'attempt':'initial','files':snapshot['searchFiles']}}}
    verifier_paths=ns.verifier_source_paths(repo)
    template['evidenceVerifier']={'root':str(repo),'commit':args.commit,'tree':template['sourceTree'],
        'files':{name:sha(ns.safe_read(repo/name)) for name in sorted(verifier_paths)}}
    template['replaySourceManifest']={'path':str(args.replay_source_manifest),
        'sha256':args.replay_source_manifest_sha256}
    ns.verify_verifier_sources(template['evidenceVerifier'])
    ns.verify_replay_source_manifest(template)
    ns.validate_manifest(template)
    import copy
    rehearsal=copy.deepcopy(template)
    rehearsal['sourceIdentities']={name:ns.creation_identity((active_root/name).lstat()) for name in ns.ALLOWED}
    rehearsal['sourceParents']={name:ns.parent_identity((active_root/name).parent.lstat()) for name in ns.ALLOWED}
    ns.fence(active_root,rehearsal,candidates)
    preview = {'format':'proof-of-work-work-batch-replay-rollout-plan-v1','releaseId':release,'sourceCommit':args.commit,
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
    node_context(); private_output(args.receipt)
    raw = controller().safe_read(args.plan,20*1024**2); preview = json.loads(raw)
    script = (ROOT/'rollout-node.py').read_bytes()
    key = 'rolloutSupervisorSha256'
    if preview.get('format') != 'proof-of-work-work-batch-replay-rollout-plan-v1' or sha(script) != preview[key]:
        raise ValueError('Rollout supervisor differs from the reviewed plan')
    child = subprocess.Popen(['/usr/bin/python3','-I','-B','-c',script.decode()],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        stdout, stderr = child.communicate(raw,timeout=34800)
        result = subprocess.CompletedProcess(child.args,child.returncode,stdout,stderr)
    except BaseException as error:
        if child.poll() is None: child.send_signal(signal.SIGINT)
        try:
            stdout, stderr = child.communicate(timeout=900)
        except subprocess.TimeoutExpired as waiting:
            stdout, stderr = waiting.stdout or b'', waiting.stderr or b''
        receipt = {'format':'proof-of-work-work-batch-replay-node-dispatch-receipt-v1','planSha256':sha(raw),
            'releaseId':preview['releaseId'],'phase':args.phase,'exitCode':None,
            'dispatchStatus':'uncertain-interruption','errorClass':type(error).__name__,
            'stdout':(stdout or b'').decode(errors='replace')[-1024*1024:],
            'stderr':(stderr or b'').decode(errors='replace')[-65536:]}
        save(args.receipt, encoded(receipt))
        raise ValueError('Node rollout was interrupted; state is uncertain. Inspect preserved receipt and remote controller/hold evidence before recovery: '+str(args.receipt)) from None
    receipt = {'format':'proof-of-work-work-batch-replay-node-dispatch-receipt-v1','planSha256':sha(raw),
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
    def composition_arguments(p):
        p.add_argument('repository',type=Path);p.add_argument('commit');p.add_argument('base_commit')
        p.add_argument('capture',type=Path);p.add_argument('output',type=Path)
        p.add_argument('--release-id',required=True);p.add_argument('--reviewed-merges',type=Path)
    p=sub.add_parser('compose');composition_arguments(p)
    p.set_defaults(fn=lambda args:plan(args,compose_only=True))
    p=sub.add_parser('plan');composition_arguments(p)
    p.add_argument('--composition',type=Path,required=True);p.add_argument('--composition-sha256',required=True)
    p.add_argument('--replay-source-manifest',type=Path,required=True)
    p.add_argument('--replay-source-manifest-sha256',required=True)
    p.set_defaults(fn=plan)
    p = sub.add_parser('overlay'); p.add_argument('plan',type=Path); p.add_argument('receipt',type=Path); p.set_defaults(fn=overlay,phase='overlay')
    args = parser.parse_args(); node_context(); os.umask(0o077)
    def interrupted(signum, frame): raise InterruptedError('WORK batch rollout interrupted')
    for kind in (signal.SIGTERM, signal.SIGHUP): signal.signal(kind, interrupted)
    args.fn(args)

if __name__ == '__main__': main()
