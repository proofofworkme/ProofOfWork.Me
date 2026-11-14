#!/usr/bin/env python3
"""Capture and rehearse a Pay-only overlay over the accepted active runtime.

Capture stores source evidence on the node VPS and returns compact metadata.
Plan and dispatch receipts must remain on that VPS. Overlay
and bootstrap explicitly dispatch the reviewed, hash-bound plan to production.
"""
import argparse, base64, datetime, hashlib, importlib.util, json, os, re, shlex, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NODE_SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_node_ed25519',
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'powadmin@65.108.122.87']

def sha(value): return hashlib.sha256(value).hexdigest()
def save(path, raw):
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output: output.write(raw); output.flush(); os.fsync(output.fileno())
def encoded(value): return (json.dumps(value, indent=2)+'\n').encode()
def controller():
    spec = importlib.util.spec_from_file_location('pay_overlay_plan', ROOT/'scoped-node.py')
    ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns); return ns
def git(repo, *argv):
    # The reviewed candidate is owned by the build user; source capture/plans
    # remain root-owned on the VPS. Trust only this explicit path per command.
    return subprocess.check_output(['git', '-c', 'safe.directory='+str(repo), '-C', str(repo), *argv])
def private_output(path):
    if not path.is_absolute() or path.resolve() != path or not str(path).startswith('/tmp/') or path.exists():
        raise ValueError('Output must be a new canonical /tmp path')

def capture(args):
    # The operator's 2026-10-24 storage instruction forbids local runtime copies.
    # Only the node writes the full capture; stdout is a small hash-bound receipt.
    if args.output.parent != Path('/tmp') or args.output.name in ('', '.', '..'):
        raise ValueError('VPS capture must use a new direct /tmp filename')
    code = (ROOT/'scoped-node.py').read_bytes()
    script = (ROOT/'capture-node.py').read_bytes()
    request = encoded({'controllerBase64':base64.b64encode(code).decode(), 'controllerSha256':sha(code),
                       'captureBase64':base64.b64encode(script).decode(), 'captureSha256':sha(script),
                       'output':str(args.output)})
    runner = r'''
import base64,hashlib,json,os,pathlib,sys
assert os.geteuid()==0 and sys.flags.isolated
raw=sys.stdin.buffer.read(2*1024**2+1);assert len(raw)<=2*1024**2
r=json.loads(raw)
p=pathlib.Path(r['output']);assert p.parent==pathlib.Path('/tmp') and p.resolve()==p and not os.path.lexists(p)
assert p.parent.resolve()==p.parent and p.parent.is_dir()
controller=base64.b64decode(r['controllerBase64'],validate=True)
source=base64.b64decode(r['captureBase64'],validate=True)
assert hashlib.sha256(controller).hexdigest()==r['controllerSha256']
assert hashlib.sha256(source).hexdigest()==r['captureSha256']
ns={'__name__':'_vps_runtime_capture'};exec(compile(source,'capture-node.py','exec'),ns)
v=ns['capture'](controller);data=(json.dumps(v)+'\n').encode()
assert len(data)<=90*1024**2
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
print(json.dumps({'capture':str(p),'location':'node-vps','sha256':hashlib.sha256(data).hexdigest(),
 'baselineHead':v['baselineHead'],'sourceFiles':len(v['sources']),'runtimeDependencies':len(v['dependencyPaths'])}))
'''
    remote_command = shlex.join(['sudo', '-n', '/usr/bin/python3', '-I', '-B', '-c', runner])
    result = subprocess.run([*NODE_SSH, remote_command], input=request,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
    if result.returncode:
        raise ValueError('VPS capture refused: '+result.stderr[-4000:].decode('utf-8', errors='replace'))
    if len(result.stdout)>65536: raise ValueError('Oversized VPS capture receipt')
    receipt=json.loads(result.stdout)
    if receipt.get('location')!='node-vps' or receipt.get('capture')!=str(args.output) or not re.fullmatch('[0-9a-f]{64}',receipt.get('sha256','')):
        raise ValueError('Wrong VPS capture receipt')
    print(json.dumps(receipt))

def reviewed_merges(path, ns):
    """Load explicit resolutions, bound to the exact captured/base/candidate bytes."""
    if path is None: return {}
    raw = ns.safe_read(path, 65536)
    value = json.loads(raw)
    if set(value) != {'format', 'sources'} or value['format'] != 'proof-of-work-pay-reviewed-merges-v1':
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
        if conflict: raise ValueError('Pay merge requires explicit review: '+name)
        return merged, None
    if any(row[key] != sha(raw) for key, raw in
            [('activeSha256',active), ('baseSha256',base), ('repositoryCandidateSha256',candidate)]):
        raise ValueError('Reviewed merge source identity differs: '+name)
    return row['mergedBytes'], {key:value for key,value in row.items() if key != 'mergedBytes'}

def reviewed_helper_upgrades(path, ns, base_commit, candidate_commit):
    """Authorize only committed helper replacements with exact reviewed pins."""
    if path is None: return {}
    value = json.loads(ns.safe_read(path, 65536))
    if not isinstance(value, dict) or set(value) != {'format', 'baseCommit', 'sourceCommit', 'sources'} or value['format'] != 'proof-of-work-pay-reviewed-helper-upgrades-v1':
        raise ValueError('Wrong reviewed helper upgrade manifest')
    if value['baseCommit'] != base_commit or value['sourceCommit'] != candidate_commit:
        raise ValueError('Reviewed helper upgrade commit identity differs')
    rows = value['sources']
    if not isinstance(rows, list) or not 1 <= len(rows) <= len(ns.NEW):
        raise ValueError('Wrong reviewed helper upgrade count')
    result = {}
    fields = {'path', 'activeSha256', 'baseSha256', 'repositoryCandidateSha256', 'reason'}
    for row in rows:
        if not isinstance(row, dict) or set(row) != fields or row['path'] not in ns.NEW or row['path'] in result:
            raise ValueError('Wrong reviewed helper upgrade allowlist')
        if not all(isinstance(row[key], str) and ns.SHA.fullmatch(row[key]) for key in ('activeSha256', 'baseSha256', 'repositoryCandidateSha256')):
            raise ValueError('Invalid reviewed helper upgrade source pin')
        if not isinstance(row['reason'], str) or not row['reason'].strip() or len(row['reason']) > 2000:
            raise ValueError('Reviewed helper upgrade requires an explicit review reason')
        result[row['path']] = row
    return result

def helper_baseline(name, current, candidate, preserve_existing, *, upgrade_mode=False, base=None, upgrade=None):
    """Keep first-install/preservation behavior; upgrades need distinct review."""
    if upgrade_mode:
        if preserve_existing: raise ValueError('Conflicting Pay helper modes')
        if current is None: raise ValueError('Missing existing Pay helper: '+name)
        raw = base64.b64decode(current['base64'], validate=True)
        if sha(raw) != current['sha256']: raise ValueError('Captured source hash differs: '+name)
        if raw != base: raise ValueError('Existing Pay helper differs from exact base commit: '+name)
        if candidate == base:
            if upgrade is not None: raise ValueError('Reviewed helper upgrade does not change helper: '+name)
        else:
            if upgrade is None: raise ValueError('Pay helper upgrade requires explicit review: '+name)
            if any(upgrade[key] != sha(value) for key, value in [('activeSha256',raw), ('baseSha256',base), ('repositoryCandidateSha256',candidate)]):
                raise ValueError('Reviewed helper upgrade source identity differs: '+name)
        return current['sha256']
    if upgrade is not None or base is not None: raise ValueError('Helper upgrade review requires explicit upgrade mode')
    if not preserve_existing:
        if current is not None: raise ValueError('New Pay helper already exists: '+name)
        return None
    if current is None: raise ValueError('Missing existing Pay helper: '+name)
    raw = base64.b64decode(current['base64'], validate=True)
    if sha(raw) != current['sha256']: raise ValueError('Captured source hash differs: '+name)
    if raw != candidate: raise ValueError('Existing Pay helper differs from committed candidate: '+name)
    return current['sha256']

def plan(args):
    if not Path('/opt/proofofwork-api/server/proof-api.mjs').is_file() or not Path('/data').is_dir():
        raise ValueError('Runtime plans must be prepared on the node VPS; local capture/plan artifacts are prohibited')
    private_output(args.output); repo = args.repository.resolve(strict=True); ns = controller()
    if not re.fullmatch('[0-9a-f]{40}', args.commit) or git(repo, 'rev-parse', 'HEAD').decode().strip() != args.commit:
        raise ValueError('Require exact committed candidate checkout')
    if git(repo, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Candidate checkout must be clean before release planning')
    if not re.fullmatch('[0-9a-f]{40}', args.base_commit): raise ValueError('Require full previous source commit')
    git(repo, 'merge-base', '--is-ancestor', args.base_commit, args.commit)
    reviewed = reviewed_merges(getattr(args, 'reviewed_merges', None), ns)
    release = args.release_id or args.commit[:12]+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) or release.split('-')[0] != args.commit[:12]:
        raise ValueError('Release must bind the exact source commit')
    captured = args.capture.read_bytes(); snapshot = json.loads(captured)
    if snapshot.get('format') != 'proof-of-work-pay-runtime-capture-v1' or snapshot['root'] != str(ns.ROOT):
        raise ValueError('Wrong runtime capture')
    controller_raw = (ROOT/'scoped-node.py').read_bytes(); holder = ROOT.parent/'search/hold-node-timer.py'
    if snapshot['controllerSha256'] != sha(controller_raw): raise ValueError('Capture uses another controller')
    for path in (ROOT/'release.py', ROOT/'capture-node.py', ROOT/'scoped-node.py', ROOT/'rollout-node.py', ROOT/'bootstrap-node.py', holder):
        if path.read_bytes() != git(repo, 'show', args.commit+':'+str(path.relative_to(repo))):
            raise ValueError('Tool differs from committed candidate: '+path.name)
    preserve_existing = getattr(args, 'preserve_existing_helpers', False)
    if type(preserve_existing) is not bool: raise ValueError('Invalid preserve-existing-helpers mode')
    upgrade_path = getattr(args, 'reviewed_helper_upgrades', None)
    upgrade_mode = upgrade_path is not None
    if preserve_existing and upgrade_mode: raise ValueError('Conflicting Pay helper modes')
    upgrades = reviewed_helper_upgrades(upgrade_path, ns, args.base_commit, args.commit)
    helper_candidates = {name:git(repo, 'show', args.commit+':'+name) for name in sorted(ns.NEW)}
    helper_bases = {name:git(repo, 'show', args.base_commit+':'+name) for name in sorted(ns.NEW)} if upgrade_mode else {}
    helper_before = {name:helper_baseline(name, snapshot['sources'].get(name), candidate, preserve_existing,
        upgrade_mode=upgrade_mode, base=helper_bases.get(name), upgrade=upgrades.get(name))
        for name, candidate in helper_candidates.items()}
    args.output.mkdir(mode=0o700)
    active_root = args.output/'captured-runtime'; active_root.mkdir(mode=0o700)
    for name, row in snapshot['sources'].items():
        ns.source_path(name); raw = base64.b64decode(row['base64'], validate=True)
        if sha(raw) != row['sha256']: raise ValueError('Captured source hash differs')
        target = active_root/name; target.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(target,raw)
    candidates, rows, reviews = {}, [], []
    for name in sorted(ns.ALLOWED):
        candidate = helper_candidates[name] if name in ns.NEW else git(repo, 'show', args.commit+':'+name)
        current = snapshot['sources'].get(name)
        if name in ns.NEW:
            merged = candidate; before = helper_before[name]; conflict = False; resolved = False; resolution = None
        else:
            if current is None: raise ValueError('Missing active source: '+name)
            before = current['sha256']; base = git(repo, 'show', args.base_commit+':'+name)
            location = args.output/'merge'/name; location.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            for suffix, raw in [('active', (active_root/name).read_bytes()), ('base',base), ('pay',candidate)]:
                save(location.with_name(location.name+'.'+suffix), raw)
            result = subprocess.run(['git','merge-file','--stdout','--diff3',str(location)+'.active',str(location)+'.base',str(location)+'.pay'],capture_output=True)
            merged = result.stdout; conflict = result.returncode != 0
            resolved = False
            if conflict:
                save(location.with_name(location.name+'.conflicted'), merged)
            merged, resolution = selected_merge(name, merged, conflict and not resolved,
                (active_root/name).read_bytes(), base, candidate, reviewed)
            save(location, merged)
        adapted = False
        file = args.output/'candidate'/name; file.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(file,merged)
        subprocess.run(['node','--check',str(file)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        candidates[name] = merged
        rows.append({'path':name,'before':before,'after':sha(merged),'base64':base64.b64encode(merged).decode()})
        reviews.append({'path':name,'before':before,'after':sha(merged),'repositoryCandidateSha256':sha(candidate),
            'preservedNativeOverlay':adapted,'cleanThreeWayMerge':not conflict,
            'reviewedAdditiveImportConflict':resolved,'explicitResolution':resolution,
            'explicitHelperUpgrade':upgrades.get(name),'syntaxVerified':True})
    if set(reviewed) - candidates.keys(): raise ValueError('Unused reviewed merge input')
    deps = {name:row['sha256'] for name,row in snapshot['sources'].items()}
    for row in rows:
        if row['before'] is not None: deps[row['path']] = row['before']
    template = {'format':'proof-of-work-pay-scoped-runtime-v1','sourceCommit':args.commit,
        'releaseId':release,'baselineHead':snapshot['baselineHead'],'services':list(ns.UNITS),
        'sources':rows,'dependencies':deps,'nodeSha256':snapshot['nodeSha256'],'gateway':snapshot['gateway'],
        'protectedServices':snapshot['protectedServices'],
        'helperReview':{'baseCommit':args.base_commit,'sourceCommit':args.commit,'upgrades':list(upgrades.values())},
        'searchHold':{'markerSha256':'0'*64,'bindings':{'releaseId':release,'attempt':'initial','files':snapshot['searchFiles']}}}
    ns.validate_manifest(template); ns.fence(active_root, template, candidates)
    preview = {'format':'proof-of-work-pay-rollout-plan-v1','releaseId':release,'sourceCommit':args.commit,
        'baseCommit':args.base_commit,'captureSha256':sha(captured),'baselineHead':snapshot['baselineHead'],
        'controllerSha256':sha(controller_raw),'controllerBase64':base64.b64encode(controller_raw).decode(),
        'searchHoldControllerSha256':sha(holder.read_bytes()),'searchHoldControllerBase64':base64.b64encode(holder.read_bytes()).decode(),
        'runtimeManifestTemplate':template,'nodePath':snapshot['nodePath'],'workerUnitSha256':snapshot['workerUnitSha256'],
        'rolloutSupervisorSha256':sha((ROOT/'rollout-node.py').read_bytes()),
        'bootstrapSupervisorSha256':sha((ROOT/'bootstrap-node.py').read_bytes()),
        'reviews':reviews,'reviewedHelperUpgrades':list(upgrades.values()),'productionMutation':False}
    raw = encoded(preview)
    if len(raw) > 20*1024**2: raise ValueError('Rollout manifest exceeds controller bound')
    save(args.output/'plan.json',raw); save(args.output/'review.json',encoded(reviews))
    print(json.dumps({'plan':str(args.output/'plan.json'),'sha256':sha(raw),'releaseId':release,
        'files':len(rows),'dependencies':len(deps),'bytes':len(raw),'rehearsal':'complete-source-fence-and-merged-syntax-passed'}))

def overlay(args):
    """Dispatch a VPS-resident plan and retain the full receipt on that VPS."""
    if args.receipt.parent != Path('/tmp') or args.receipt.name in ('', '.', '..'):
        raise ValueError('VPS dispatch receipt must use a new direct /tmp filename')
    if not re.fullmatch('[0-9a-f]{64}', args.plan_sha256):
        raise ValueError('Require the exact reviewed plan SHA-256')
    script = (ROOT/('bootstrap-node.py' if args.phase == 'bootstrap' else 'rollout-node.py')).read_bytes()
    request = encoded({'plan':str(args.plan), 'planSha256':args.plan_sha256,
        'receipt':str(args.receipt), 'phase':args.phase,
        'supervisorBase64':base64.b64encode(script).decode(), 'supervisorSha256':sha(script)})
    runner = r'''
import base64,hashlib,json,os,pathlib,stat,subprocess,sys
assert os.geteuid()==0 and sys.flags.isolated
r=json.loads(sys.stdin.buffer.read(2*1024**2+1));p=pathlib.Path(r['plan']);receipt=pathlib.Path(r['receipt'])
assert p.is_absolute() and p.resolve(strict=True)==p and str(p).startswith('/tmp/')
info=p.lstat();assert stat.S_ISREG(info.st_mode) and info.st_nlink==1 and not info.st_mode&0o7022 and info.st_size<=20*1024**2
def identity(v):
 return tuple(getattr(v,k) for k in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'))
with os.fdopen(os.open(p,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
 assert identity(os.fstat(f.fileno()))==identity(info)
 raw=f.read(20*1024**2+1)
 assert identity(os.fstat(f.fileno()))==identity(info) and identity(p.lstat())==identity(info)
assert hashlib.sha256(raw).hexdigest()==r['planSha256']
assert receipt.parent==pathlib.Path('/tmp') and receipt.resolve()==receipt and not os.path.lexists(receipt)
plan=json.loads(raw);assert plan.get('format')=='proof-of-work-pay-rollout-plan-v1'
assert r['phase'] in ('overlay','bootstrap')
code=base64.b64decode(r['supervisorBase64'],validate=True)
key='bootstrapSupervisorSha256' if r['phase']=='bootstrap' else 'rolloutSupervisorSha256'
assert hashlib.sha256(code).hexdigest()==r['supervisorSha256']==plan[key]
try:
 result=subprocess.run(['/usr/bin/python3','-I','-B','-c',code.decode()],input=raw,capture_output=True,timeout=1200)
 value={'format':'proof-of-work-pay-vps-dispatch-receipt-v1','planSha256':r['planSha256'],
  'releaseId':plan['releaseId'],'phase':r['phase'],'exitCode':result.returncode,
  'dispatchStatus':'completed' if result.returncode==0 else 'refused',
  'stdout':result.stdout.decode(errors='replace')[-1024*1024:],'stderr':result.stderr.decode(errors='replace')[-65536:]}
except subprocess.TimeoutExpired as e:
 value={'format':'proof-of-work-pay-vps-dispatch-receipt-v1','planSha256':r['planSha256'],
  'releaseId':plan['releaseId'],'phase':r['phase'],'exitCode':None,'dispatchStatus':'uncertain-timeout',
  'stdout':(e.stdout or b'').decode(errors='replace')[-1024*1024:],'stderr':(e.stderr or b'').decode(errors='replace')[-65536:]}
data=(json.dumps(value,indent=2)+'\n').encode()
fd=os.open(receipt,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
fd=os.open(receipt.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
print(json.dumps({'receipt':str(receipt),'location':'node-vps','sha256':hashlib.sha256(data).hexdigest(),
 'releaseId':plan['releaseId'],'phase':r['phase'],'status':value['dispatchStatus']}),flush=True)
raise SystemExit(0 if value['exitCode']==0 else 1)
'''
    command=shlex.join(['sudo','-n','/usr/bin/python3','-I','-B','-c',runner])
    try:
        result=subprocess.run([*NODE_SSH,command],input=request,capture_output=True,timeout=1260)
    except subprocess.TimeoutExpired:
        raise ValueError('Dispatch transport timed out; inspect VPS receipt '+str(args.receipt)+' and Search hold before recovery') from None
    if len(result.stdout)>65536: raise ValueError('Oversized VPS dispatch receipt')
    if result.stdout:
        receipt=json.loads(result.stdout)
        if (receipt.get('location')!='node-vps' or receipt.get('receipt')!=str(args.receipt) or
                receipt.get('phase')!=args.phase or not re.fullmatch('[0-9a-f]{64}',receipt.get('sha256','')) or
                receipt.get('status') not in ('completed','refused','uncertain-timeout') or
                (result.returncode==0 and receipt.get('status')!='completed')):
            raise ValueError('Wrong VPS dispatch receipt; inspect '+str(args.receipt))
        print(json.dumps(receipt))
    elif result.returncode==0:
        raise ValueError('Missing VPS dispatch receipt; inspect '+str(args.receipt))
    if result.returncode:
        raise ValueError('VPS dispatch refused or uncertain; inspect '+str(args.receipt)+': '+result.stderr[-2000:].decode(errors='replace'))

def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(required=True)
    p = sub.add_parser('capture'); p.add_argument('output', type=Path); p.set_defaults(fn=capture)
    p = sub.add_parser('plan'); p.add_argument('repository', type=Path); p.add_argument('commit');
    p.add_argument('base_commit'); p.add_argument('capture', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--release-id'); p.add_argument('--reviewed-merges', type=Path)
    helper_mode = p.add_mutually_exclusive_group()
    helper_mode.add_argument('--preserve-existing-helpers', action='store_true',
        help='Require all five Pay helpers to exist and match committed candidate bytes exactly; no helper upgrade')
    helper_mode.add_argument('--reviewed-helper-upgrades', type=Path,
        help='Review-bound committed helper upgrades; require every current helper to match the exact base commit')
    p.set_defaults(fn=plan)
    for phase in ('overlay','bootstrap'):
        p = sub.add_parser(phase); p.add_argument('plan',type=Path); p.add_argument('receipt',type=Path); p.add_argument('--plan-sha256',required=True); p.set_defaults(fn=overlay,phase=phase)
    args = parser.parse_args(); os.umask(0o077); args.fn(args)

if __name__ == '__main__': main()
