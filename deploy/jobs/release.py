#!/usr/bin/env python3
"""Capture and rehearse a Jobs-only overlay over the accepted active runtime.

Capture is read-only. Plan writes only a new private /tmp directory. Overlay
and bootstrap explicitly dispatch the reviewed, hash-bound plan to production.
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
    spec = importlib.util.spec_from_file_location('jobs_overlay_plan', ROOT/'scoped-node.py')
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
    if snapshot.get('format') != 'proof-of-work-jobs-runtime-capture-v1' or snapshot['controllerSha256'] != sha(code):
        raise ValueError('Wrong capture identity')
    save(args.output, result.stdout)
    print(json.dumps({'capture':str(args.output), 'sha256':sha(result.stdout),
        'baselineHead':snapshot['baselineHead'], 'sourceFiles':len(snapshot['sources']),
        'runtimeDependencies':len(snapshot['dependencyPaths'])}))

def native_jobs_overlay(raw, active_indexer):
    """Mirror the already accepted Code native accessor for new Jobs closure."""
    source = raw.decode(); active = active_indexer.decode()
    if 'read_work_transition_payload_v1' not in active: return raw, False
    if "import { assertNativeTransitionStorageContract }" not in active:
        raise ValueError('Unknown native transition overlay')
    old = '''async function storedJobsCandidateEventClosure(client, tx, position) {
  const [events, transition] = await Promise.all(['''
    new = '''async function storedJobsCandidateEventClosure(client, tx, position) {
  await assertNativeTransitionStorageContract(client);
  const [events, transition] = await Promise.all(['''
    query = 'SELECT block_height,block_hash,payload FROM proof_indexer.work_amo_block_transitions WHERE network=$1 AND block_height=$2 AND block_hash=$3'
    replacement = 'SELECT block_height,block_hash,proof_indexer.read_work_transition_payload_v1(network,block_height,block_hash,payload) AS payload FROM proof_indexer.work_amo_block_transitions WHERE network=$1 AND block_height=$2 AND block_hash=$3'
    if source.count(old) != 1: raise ValueError('Jobs closure boundary differs')
    start = source.index(old); end = source.index('\nasync function bootstrapJobsCandidates', start)
    fragment = source[start:end]
    if fragment.count(query) != 1: raise ValueError('Jobs native transition query differs')
    fragment = fragment.replace(old, new).replace(query, replacement)
    return (source[:start]+fragment+source[end:]).encode(), True

def plan(args):
    private_output(args.output); repo = args.repository.resolve(strict=True); ns = controller()
    if not re.fullmatch('[0-9a-f]{40}', args.commit) or git(repo, 'rev-parse', 'HEAD').decode().strip() != args.commit:
        raise ValueError('Require exact committed candidate checkout')
    if git(repo, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Candidate checkout must be clean before release planning')
    if not re.fullmatch('[0-9a-f]{40}', args.base_commit): raise ValueError('Require full pre-Jobs source commit')
    release = args.release_id or args.commit[:12]+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) or release.split('-')[0] != args.commit[:12]:
        raise ValueError('Release must bind the exact source commit')
    captured = args.capture.read_bytes(); snapshot = json.loads(captured)
    if snapshot.get('format') != 'proof-of-work-jobs-runtime-capture-v1' or snapshot['root'] != str(ns.ROOT):
        raise ValueError('Wrong runtime capture')
    controller_raw = (ROOT/'scoped-node.py').read_bytes(); holder = ROOT.parent/'search/hold-node-timer.py'
    if snapshot['controllerSha256'] != sha(controller_raw): raise ValueError('Capture uses another controller')
    for path in (ROOT/'release.py', ROOT/'capture-node.py', ROOT/'scoped-node.py', ROOT/'rollout-node.py', ROOT/'bootstrap-node.py', holder):
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
        if name in ns.NEW:
            if current is not None: raise ValueError('New Jobs helper already exists: '+name)
            merged = candidate; before = None; conflict = False
        else:
            if current is None: raise ValueError('Missing active source: '+name)
            before = current['sha256']; base = git(repo, 'show', args.base_commit+':'+name)
            location = args.output/'merge'/name; location.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            for suffix, raw in [('active', (active_root/name).read_bytes()), ('base',base), ('jobs',candidate)]:
                save(location.with_name(location.name+'.'+suffix), raw)
            result = subprocess.run(['git','merge-file','--stdout','--diff3',str(location)+'.active',str(location)+'.base',str(location)+'.jobs'],capture_output=True)
            merged = result.stdout; conflict = result.returncode != 0
            save(location, merged)
            if conflict: raise ValueError('Jobs merge requires review: '+name)
        adapted = False
        if name == 'scripts/backfill-proof-indexer.mjs':
            merged, adapted = native_jobs_overlay(merged, (active_root/name).read_bytes())
        file = args.output/'candidate'/name; file.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(file,merged)
        subprocess.run(['node','--check',str(file)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        candidates[name] = merged
        rows.append({'path':name,'before':before,'after':sha(merged),'base64':base64.b64encode(merged).decode()})
        reviews.append({'path':name,'before':before,'after':sha(merged),'repositoryCandidateSha256':sha(candidate),
            'preservedNativeOverlay':adapted,'cleanThreeWayMerge':not conflict,'syntaxVerified':True})
    deps = {name:snapshot['sources'][name]['sha256'] for name in snapshot['dependencyPaths']}
    for row in rows:
        if row['before'] is not None: deps[row['path']] = row['before']
    template = {'format':'proof-of-work-jobs-scoped-runtime-v1','sourceCommit':args.commit,
        'releaseId':release,'baselineHead':snapshot['baselineHead'],'services':list(ns.UNITS),
        'sources':rows,'dependencies':deps,'nodeSha256':snapshot['nodeSha256'],'gateway':snapshot['gateway'],
        'searchHold':{'markerSha256':'0'*64,'bindings':{'releaseId':release,'attempt':'initial','files':snapshot['searchFiles']}}}
    ns.validate_manifest(template); ns.fence(active_root, template, candidates)
    preview = {'format':'proof-of-work-jobs-rollout-plan-v1','releaseId':release,'sourceCommit':args.commit,
        'baseCommit':args.base_commit,'captureSha256':sha(captured),'baselineHead':snapshot['baselineHead'],
        'controllerSha256':sha(controller_raw),'controllerBase64':base64.b64encode(controller_raw).decode(),
        'searchHoldControllerSha256':sha(holder.read_bytes()),'searchHoldControllerBase64':base64.b64encode(holder.read_bytes()).decode(),
        'runtimeManifestTemplate':template,'nodePath':snapshot['nodePath'],'workerUnitSha256':snapshot['workerUnitSha256'],
        'rolloutSupervisorSha256':sha((ROOT/'rollout-node.py').read_bytes()),
        'bootstrapSupervisorSha256':sha((ROOT/'bootstrap-node.py').read_bytes()),
        'reviews':reviews,'productionMutation':False}
    raw = encoded(preview)
    if len(raw) > 20*1024**2: raise ValueError('Rollout manifest exceeds controller bound')
    save(args.output/'plan.json',raw); save(args.output/'review.json',encoded(reviews))
    print(json.dumps({'plan':str(args.output/'plan.json'),'sha256':sha(raw),'releaseId':release,
        'files':len(rows),'dependencies':len(deps),'bytes':len(raw),'rehearsal':'complete-source-fence-and-merged-syntax-passed'}))

def overlay(args):
    private_output(args.receipt)
    raw = args.plan.read_bytes(); preview = json.loads(raw)
    script = (ROOT/('bootstrap-node.py' if args.phase == 'bootstrap' else 'rollout-node.py')).read_bytes()
    key = 'bootstrapSupervisorSha256' if args.phase == 'bootstrap' else 'rolloutSupervisorSha256'
    if preview.get('format') != 'proof-of-work-jobs-rollout-plan-v1' or sha(script) != preview[key]:
        raise ValueError('Rollout supervisor differs from the reviewed plan')
    remote_command = shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-c',script.decode()])
    try:
        result = subprocess.run([*NODE_SSH,remote_command],input=raw,capture_output=True,timeout=1200)
    except subprocess.TimeoutExpired as error:
        receipt = {'format':'proof-of-work-jobs-local-dispatch-receipt-v1','planSha256':sha(raw),
            'releaseId':preview['releaseId'],'phase':args.phase,'exitCode':None,
            'dispatchStatus':'uncertain-timeout','timeoutSeconds':1200,
            'stdout':(error.stdout or b'').decode(errors='replace')[-1024*1024:],
            'stderr':(error.stderr or b'').decode(errors='replace')[-65536:]}
        save(args.receipt, encoded(receipt))
        raise ValueError('Node rollout timed out; state is uncertain. Inspect preserved receipt and remote controller/hold evidence before recovery: '+str(args.receipt)) from None
    receipt = {'format':'proof-of-work-jobs-local-dispatch-receipt-v1','planSha256':sha(raw),
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
    p.add_argument('--release-id'); p.set_defaults(fn=plan)
    for phase in ('overlay','bootstrap'):
        p = sub.add_parser(phase); p.add_argument('plan',type=Path); p.add_argument('receipt',type=Path); p.set_defaults(fn=overlay,phase=phase)
    args = parser.parse_args(); os.umask(0o077); args.fn(args)

if __name__ == '__main__': main()
