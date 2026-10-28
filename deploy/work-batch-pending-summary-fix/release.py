#!/usr/bin/env python3
"""Capture and rehearse the scoped WORK pending-summary API overlay over the accepted active runtime.

Run every command as root with python3 -I -B on the node VPS. Full captures,
plans and receipts remain in private /tmp paths there. Only compact summaries
may return to the operator. Overlay explicitly applies the reviewed plan.
"""
import argparse, base64, datetime, hashlib, importlib.util, json, os, re, signal, stat, subprocess, sys
from pathlib import Path

ROLLOUT_TIMEOUT_SECONDS = 9000
ROLLOUT_RECOVERY_GRACE_SECONDS = 900
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
    spec = importlib.util.spec_from_file_location('work-batch-pending-summary-fix_overlay_plan', ROOT/'scoped-node.py')
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


def verify_public_patch(ns,old,new):
    """The public patch commit must change exactly the two frozen functions."""
    candidate=old
    for name,row in ns.PATCHES.items():
        a,b,before=ns.function_slice(candidate,name);_,_,after=ns.function_slice(new,name)
        if sha(before)!=row['beforeSha256'] or sha(after)!=row['afterSha256']:
            raise ValueError('Public patch function differs: '+name)
        candidate=candidate[:a]+after+candidate[b:]
    if candidate!=new:raise ValueError('Public API patch includes unrelated changes')


def plan(args):
    node_context(); private_output(args.output); repo = args.repository.resolve(strict=True); ns = controller()
    if not re.fullmatch('[0-9a-f]{40}', args.commit) or git(repo, 'rev-parse', 'HEAD').decode().strip() != args.commit:
        raise ValueError('Require exact committed candidate checkout')
    if git(repo, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Candidate checkout must be clean before release planning')
    if args.base_commit != ns.BASE_SOURCE_COMMIT: raise ValueError('Require exact approved base source commit')
    git(repo, 'merge-base', '--is-ancestor', args.base_commit, args.commit)
    git(repo,'merge-base','--is-ancestor',ns.PATCH_COMMIT,args.commit)
    if git(repo,'rev-parse',ns.PATCH_COMMIT+'^').decode().strip()!=ns.PATCH_BASE_COMMIT:
        raise ValueError('Public patch parent differs')
    release = args.release_id or args.commit[:12]+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) or release.split('-')[0] != args.commit[:12]:
        raise ValueError('Release must bind the exact source commit')
    captured = ns.safe_read(args.capture, 90*1024**2); snapshot = json.loads(captured)
    if snapshot.get('format') != 'proof-of-work-work-batch-pending-summary-fix-runtime-capture-v1' or snapshot['root'] != str(ns.ROOT):
        raise ValueError('Wrong runtime capture')
    controller_raw = (ROOT/'scoped-node.py').read_bytes(); holder = ROOT.parent/'search/hold-node-timer.py'
    if snapshot['controllerSha256'] != sha(controller_raw): raise ValueError('Capture uses another controller')
    for path in (ROOT/'release.py', ROOT/'capture-node.py', ROOT/'scoped-node.py', ROOT/'rollout-node.py', ROOT/'rehearsal.py', holder):
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
    name='server/proof-api.mjs'
    public_before=git(repo,'show',ns.PATCH_BASE_COMMIT+':'+name)
    public_after=git(repo,'show',ns.PATCH_COMMIT+':'+name)
    verify_public_patch(ns,public_before,public_after)
    repository_candidate=git(repo,'show',args.commit+':'+name)
    if repository_candidate!=public_after:
        raise ValueError('Released API differs from the frozen public patch source')
    current=snapshot['sources'].get(name)
    if current is None or current['sha256']!=ns.ACCEPTED_API_SHA256:
        raise ValueError('Capture does not contain the accepted V6 API')
    active=ns.safe_read(active_root/name);merged=ns.transform_patch(active,True)
    if ns.transform_patch(merged,False)!=active:raise ValueError('Whole accepted-source inverse differs')
    file=args.output/'candidate'/name;file.parent.mkdir(parents=True,mode=0o700);save(file,merged)
    subprocess.run([snapshot['nodePath'],'--check',str(file)],check=True,capture_output=True,timeout=30)
    candidates[name]=merged
    rows.append({'path':name,'before':sha(active),'after':sha(merged),'base64':base64.b64encode(merged).decode()})
    reviews.append({'path':name,'before':sha(active),'after':sha(merged),
        'repositoryCandidateSha256':sha(repository_candidate),'patchProvenance':ns.patch_provenance(sha(merged)),
        'wholeCandidateInverseVerified':True,'syntaxVerified':True,'creationOnly':False})
    deps = {name:row['sha256'] for name,row in snapshot['sources'].items()}
    for row in rows:
        if row['before'] is not None: deps[row['path']] = row['before']
    tree=git(repo,'rev-parse','HEAD^{tree}').decode().strip()
    if not re.fullmatch('[0-9a-f]{40}',tree):raise ValueError('Invalid source tree')
    template = {'sourceTree':tree,'patchProvenance':ns.patch_provenance(sha(merged)),'format':'proof-of-work-work-batch-pending-summary-fix-scoped-runtime-v1','sourceCommit':args.commit,
        'batchAuthority':snapshot['batchAuthority'],'acceptedInventorySha256':snapshot['acceptedInventorySha256'],
        'baseSourceCommit':args.base_commit,'restartConfigurationSha256':snapshot['restartConfigurationSha256'],
        'releaseId':release,'baselineHead':snapshot['baselineHead'],'services':list(ns.UNITS),
        'sourceIdentities':snapshot['sourceIdentities'],'sourceParents':snapshot['sourceParents'],
        'sources':rows,'dependencies':deps,'nodeSha256':snapshot['nodeSha256'],'gateway':snapshot['gateway'],
        'sourceMetadata':{name:{key:snapshot['sources'][ns.METADATA_TEMPLATE if name in ns.NEW else name][key]
            for key in ('uid','gid','mode')} for name in sorted(ns.ALLOWED)},
        'dependencyMetadata':{name:{key:row[key] for key in ('uid','gid','mode')}
            for name,row in snapshot['sources'].items()},
        'protectedServices':snapshot['protectedServices'],
        'searchHold':{'markerSha256':'0'*64,'bindings':{'releaseId':release,'attempt':'initial','files':snapshot['searchFiles']}}}
    ns.validate_manifest(template); ns.fence(active_root, template, candidates)
    preview = {'sourceTree':tree,'releaseToolSha256':sha(ns.safe_read(ROOT/'release.py')),
        'rehearsalHelperSha256':sha(ns.safe_read(ROOT/'rehearsal.py')),'format':'proof-of-work-work-batch-pending-summary-fix-rollout-plan-v1','releaseId':release,'sourceCommit':args.commit,
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
        'files':len(rows),'dependencies':len(deps),'bytes':len(raw),'rehearsal':'not-yet-run','exactPatchInverseVerified':True}))

def overlay(args):
    node_context(); private_output(args.receipt)
    raw = controller().safe_read(args.plan,20*1024**2); preview = json.loads(raw)
    script = (ROOT/'rollout-node.py').read_bytes()
    key = 'rolloutSupervisorSha256'
    if preview.get('format') != 'proof-of-work-work-batch-pending-summary-fix-rollout-plan-v1' or sha(script) != preview[key]:
        raise ValueError('Rollout supervisor differs from the reviewed plan')
    ns=controller();ns.validate_manifest(preview['runtimeManifestTemplate'])
    if sha(ns.safe_read(ROOT/'release.py'))!=preview.get('releaseToolSha256') or sha(ns.safe_read(ROOT/'rehearsal.py'))!=preview.get('rehearsalHelperSha256'):
        raise ValueError('Committed release/rehearsal helper differs')
    qualification_raw=ns.safe_read(args.rehearsal,8*1024**2)
    if sha(qualification_raw)!=args.rehearsal_sha256:raise ValueError('Rehearsal qualification digest differs')
    ns.validate_rehearsal(json.loads(qualification_raw),sha(raw),preview['runtimeManifestTemplate'],preview['rehearsalHelperSha256'])
    reference={'path':str(args.rehearsal),'sha256':sha(qualification_raw)}
    envelope=encoded({'format':'work-batch-pending-summary-dispatch-request-v1',
        'planBase64':base64.b64encode(raw).decode(),'planSha256':sha(raw),'rehearsal':reference})
    child = subprocess.Popen(['/usr/bin/python3','-I','-B','-c',script.decode()],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        stdout, stderr = child.communicate(envelope,timeout=ROLLOUT_TIMEOUT_SECONDS)
        result = subprocess.CompletedProcess(child.args,child.returncode,stdout,stderr)
    except BaseException as error:
        if child.poll() is None: child.send_signal(signal.SIGINT)
        try:
            stdout, stderr = child.communicate(timeout=ROLLOUT_RECOVERY_GRACE_SECONDS)
        except subprocess.TimeoutExpired as waiting:
            stdout, stderr = waiting.stdout or b'', waiting.stderr or b''
        receipt = {'format':'proof-of-work-work-batch-pending-summary-fix-node-dispatch-receipt-v1','planSha256':sha(raw),
            'releaseId':preview['releaseId'],'rehearsal':reference,'phase':args.phase,'exitCode':None,
            'dispatchStatus':'uncertain-interruption','errorClass':type(error).__name__,
            'stdout':(stdout or b'').decode(errors='replace')[-1024*1024:],
            'stderr':(stderr or b'').decode(errors='replace')[-65536:]}
        save(args.receipt, encoded(receipt))
        raise ValueError('Node rollout was interrupted; state is uncertain. Inspect preserved receipt and remote controller/hold evidence before recovery: '+str(args.receipt)) from None
    receipt = {'format':'proof-of-work-work-batch-pending-summary-fix-node-dispatch-receipt-v1','planSha256':sha(raw),
        'releaseId':preview['releaseId'],'rehearsal':reference,'phase':args.phase,'exitCode':result.returncode,
        'dispatchStatus':'completed' if result.returncode == 0 else 'refused',
        'stdout':result.stdout.decode(errors='replace')[-1024*1024:],
        'stderr':result.stderr.decode(errors='replace')[-65536:]}
    save(args.receipt, encoded(receipt))
    if result.returncode: raise ValueError('Node rollout refused; inspect preserved receipt '+str(args.receipt))
    print(json.dumps({'receipt':str(args.receipt),'releaseId':preview['releaseId'],'rehearsal':reference,'phase':args.phase,'status':'verified'}))

def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(required=True)
    p = sub.add_parser('capture'); p.add_argument('output', type=Path); p.set_defaults(fn=capture)
    p = sub.add_parser('plan'); p.add_argument('repository', type=Path); p.add_argument('commit');
    p.add_argument('base_commit'); p.add_argument('capture', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--release-id')
    p.set_defaults(fn=plan)
    p = sub.add_parser('overlay'); p.add_argument('plan',type=Path); p.add_argument('receipt',type=Path); p.add_argument('--rehearsal',type=Path,required=True); p.add_argument('--rehearsal-sha256',required=True); p.set_defaults(fn=overlay,phase='overlay')
    args = parser.parse_args(); node_context(); os.umask(0o077)
    def interrupted(signum, frame): raise InterruptedError('WORK batch rollout interrupted')
    for kind in (signal.SIGTERM, signal.SIGHUP): signal.signal(kind, interrupted)
    args.fn(args)

if __name__ == '__main__': main()
