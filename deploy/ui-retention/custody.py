#!/usr/bin/env python3
"""Explicit custody-qualified UI retirement; no age-based deletion or hold removal.

qualify PLAN; preserve PLAN CUSTODY; retire PLAN CUSTODY RESULT.
Every operation rechecks the current and immediate-prior release and holds.
Archives and complete independently restored copies remain on the operator host.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import types
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', 'root@77.42.91.106']
BASE = Path('/var/backups/proofofwork-ui')
SOURCES = {'E': 'deploy/ui-retention/inventory.py', 'W': 'deploy/ui-retention/removal.py',
           'R': 'deploy/proofofwork-ui-verified-retention.py',
           'A': 'deploy/audit30/ui-storage.py', 'P': 'deploy/audit30/ui-release-policy.py'}
RELEASE = re.compile(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z\Z')
REPAIR_APPROVAL_SHA = 'df166edb2d9817dd4f8af24819880b6bf08b396b6aa483adaa141415fc709379'
REPAIR_PROPOSAL_SHA = '051e67cbf011b43f7521c978776eb8c3acf13cb3316c091776c0af381becdb4c'
SCRATCH = Path('/var/tmp/proofofwork-deploy')
OFFHOST_RESERVE_BYTES = 10*1024**3 + 64*1024**2
OFFHOST_RESERVE_INODES = 128


class QualificationError(ValueError):
    def __init__(self, category, message):
        super().__init__(message); self.category = category


def require(ok, category, message):
    if not ok: raise QualificationError(category, message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def save(path, value):
    with Path(path).open('xb') as f:
        f.write(encoded(value)); f.flush(); os.fsync(f.fileno())
    fd=os.open(Path(path).parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def load_helpers():
    for name, relative in SOURCES.items():
        spec = importlib.util.spec_from_file_location('retention_' + name, ROOT / relative)
        module = importlib.util.module_from_spec(spec)
        module._BOUND_EXPORTER = globals().get('E')
        module._BOUND_STORAGE = globals().get('A')
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        globals()[name] = module


def artifact(path):
    """Exact artifact grammars. No release evidence directory is selectable."""
    p=Path(path)
    if p.parent==BASE/'rollback-roots' and re.fullmatch(r'proofofwork-www-pre-[0-9a-f]+-\d{8}T\d{6}Z',p.name):return 'rollback-root',None
    if p.parent==SCRATCH and re.fullmatch(r'proofofwork-www-stage-[0-9a-f]+-\d{8}T\d{6}Z',p.name):return 'stage-root',None
    if p.parent==BASE/'transport-evidence' and p.name.startswith('historical-archives-'):return 'historical-archives',None
    if p.parent.parent==BASE/'transport-evidence' and RELEASE.fullmatch(p.parent.name):
        for kind in ('source','surfaces'):
            if p.name=='proofofwork-ui-'+kind+'-'+p.parent.name:return 'preserved-'+kind,p.parent.name
    prefix='proofofwork-ui-release-'
    if p.parent==BASE/'releases' and p.name.startswith(prefix) and p.name.endswith('.tgz'):
        rid=p.name[len(prefix):-4]
        if RELEASE.fullmatch(rid):return 'managed-archive-group',rid
    raise QualificationError('outside-scope','Outside custody retirement allowlist')


def lifecycle_context(binding):
    require(isinstance(binding,dict) and set(binding)=={'schema','approval','index'},'lifecycle-authority','Invalid custody lifecycle binding')
    require(binding['schema']=='pow-ui-custody-lifecycle-v1','lifecycle-authority','Unsupported custody lifecycle binding')
    approval=binding['approval'];require(set(approval)=={'path','sha256'} and approval['sha256']==REPAIR_APPROVAL_SHA,'lifecycle-authority','Unapproved custody repair authority')
    raw,_=E.read_regular(approval['path']);require(E.digest(raw)==REPAIR_APPROVAL_SHA,'lifecycle-authority','Repair approval bytes changed')
    value=json.loads(raw);require(value.get('schema')=='pow-ui-retention-repair-approval-v1' and value.get('host')=='77.42.91.106' and value.get('proposal',{}).get('sha256')==REPAIR_PROPOSAL_SHA,'lifecycle-authority','Repair approval schema/proposal differs')
    index=binding['index'];require(set(index)=={'path','sha256'},'lifecycle-authority','Invalid admission index binding')
    return P.custody_closure(index['path'],index['sha256'],A.Layout(),REPAIR_APPROVAL_SHA)


def scope(path, plan):
    p = Path(path)
    kind,rid=artifact(p)
    require(p.resolve(strict=True)==p,'unsafe-path','Artifact is not canonical')
    if p == Path(plan['priorRoot']):
        raise QualificationError('protected-dependency','Latest rollback is protected')
    if p.parent != BASE / 'rollback-roots' and any(plan[k]['release_id'] in p.name for k in ('current', 'prior')):
        raise QualificationError('protected-dependency','Current/prior release dependency is protected')
    closure=plan.get('closure',{})
    for protected in closure.get('protectedPaths',[]):
        q=Path(protected)
        require(not (p==q or p in q.parents or q in p.parents),'protected-dependency','Artifact intersects the verified recovery dependency graph')
    if kind in ('preserved-surfaces','managed-archive-group'):
        require(bool(plan.get('lifecycle')),'lifecycle-authority','New artifact class requires the approved lifecycle binding')
    ordinary_paths={r['path'] if isinstance(r,dict) else r for r in closure.get('ordinaryEligiblePaths',[])}
    ordinary=str(p) in ordinary_paths
    if ordinary and kind=='managed-archive-group':
        require(all(str(p)+suffix in ordinary_paths for suffix in ('','.sha256','.provenance')),'ordinary-policy-required','Ordinary archive group lacks all three admitted members')
    held = json.loads(E.read_regular('/etc/proofofwork-retention/audit28-held-review.json', 16*1024**2)[0])['retain']
    selected=[Path(str(p)+s) for s in ('','.sha256','.provenance')] if kind=='managed-archive-group' else [p]
    for member in selected:
        for row in held:
            h = Path(row['path'])
            if row['role'] == 'ui' and (member == h or member in h.parents or h in member.parents):
                exception=(ordinary and kind in ('rollback-root','managed-archive-group') and h in member.parents
                    and h in (BASE/'rollback-roots',BASE/'releases') and row.get('retentionClass')=='managed-ui-recovery-container' and row.get('decision')=='retain')
                require(exception,'held-boundary','Individually held path intersection; no source/transport ancestor exception')
    return kind,rid,ordinary


def fence(plan, full=False):
    if E.hold_snapshot() != plan['holds'] or E.timer_snapshot() != plan['timers']:
        raise ValueError('Retention holds/timers changed')
    for path, sha in plan['protectedManifests'].items():
        if E.digest(E.read_regular(Path(path) / '.proofofwork-ui-release')[0]) != sha:
            raise ValueError('Protected release changed; qualify again')
    if full:
        if R.verified_release(Path('/var/www'), BASE/'releases') != plan['current']:
            raise ValueError('Live release differs')
        if R.verified_release(Path(plan['priorRoot']), BASE/'releases') != plan['prior']:
            raise ValueError('Last verified rollback differs')
        if plan.get('lifecycle') and lifecycle_context(plan['lifecycle'])!=plan['closure']:
            raise ValueError('Authenticated admission/dependency closure changed; qualify again')


def expected(row):
    out=dict(row['inventory']['fingerprint'], inventory=row['inventory']['records'])
    if 'parent' in row['inventory']:out['parent']=row['inventory']['parent']
    if 'retainedParent' in row:out['retainedParent']=row['retainedParent']
    if 'externalLinkClosure' in row:out['externalLinkClosure']=row['externalLinkClosure']
    return out


def record(path, maximum=8*1024**2):
    raw,s=E.read_regular(path,maximum)
    require(Path(path).resolve(strict=True)==Path(path) and s.st_uid==s.st_gid==os.geteuid() and s.st_nlink==1 and not s.st_mode&0o7022,'unsafe-evidence','Unsafe immutable artifact evidence')
    return raw,dict(path=str(path),sha256=E.digest(raw),identity=E.identity(s))


def terminal_publication(release):
    """Positive completion evidence; an incomplete attempt never becomes old by age."""
    completed=[];bindings=[]
    for path in sorted(SCRATCH.glob('recovery-publish-'+release+'-*')):
        attempt=path.name.removeprefix('recovery-publish-'+release+'-')
        require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,30}',attempt) is not None,'publication-incomplete','Unexpected publication attempt')
        require((path/'intent.json').exists() and (path/'receipt.json').exists(),'publication-incomplete','Publication attempt lacks its terminal receipt')
        ir,ib=record(path/'intent.json');rr,rb=record(path/'receipt.json');intent=json.loads(ir);receipt=json.loads(rr)
        bindings.extend((ib,rb))
        require(all(intent.get(k)==receipt.get(k) for k in ('attempt','releaseId','commit','tree')) and intent.get('releaseId')==release and intent.get('attempt')==attempt,'publication-incomplete','Publication intent/receipt identity differs')
        require(re.fullmatch('[0-9a-f]{40}',intent.get('commit','')) and re.fullmatch('[0-9a-f]{40}',intent.get('tree','')) and intent['commit'].startswith(release.split('-')[0]),'publication-incomplete','Publication source identity differs')
        if receipt.get('exitCode')==0 and receipt.get('failure') is None:
            log,lb=record(path/'publisher.log',4*1024**2);bindings.append(lb)
            require(receipt.get('evidence')==str(path) and receipt.get('publisherLogSha256')==lb['sha256'] and receipt.get('capturedLogBytes')==len(log),'publication-incomplete','Publication completion log differs')
            marker=('ui_release_publish status=published release_id='+release+' commit='+intent['commit']+' ').encode()
            require(any(line.startswith(marker) for line in log.splitlines()),'publication-incomplete','Publication log lacks exact successful release marker')
            completed.append({k:intent[k] for k in ('releaseId','commit','tree')})
    require(bool(completed) and all(r==completed[0] for r in completed),'publication-incomplete','No consistent verified terminal publication')
    return dict(**completed[0],bindings=bindings)


def payload_fingerprint(inventory):
    rows=[]
    for r in sorted(inventory['records'],key=lambda r:r['path']):
        s=r['identity'];require(r['kind'] in ('directory','file') and (r['kind']!='file' or s['st_nlink']==1),'source-evidence','Surface input has links/special members')
        rows.append([r['path'],r['kind'],stat.S_IMODE(s['st_mode']),s['st_uid'],s['st_gid'],s['st_size'] if r['kind']=='file' else 0,r.get('sha256')])
    return dict(sha256=hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(),entries=len(rows),regularBytes=sum(r[5] for r in rows))


def artifact_proof(path, plan, inventory):
    kind,rid,ordinary=scope(path,plan);p=Path(path)
    if kind=='preserved-surfaces':
        ir,ib=record(p.parent/'incoming-intent.json');rr,rb=record(p.parent/'incoming-receipt.json')
        intent=json.loads(ir);incoming=json.loads(rr);receiver=incoming.get('receiverReceipt',{});fp=payload_fingerprint(inventory)
        require(incoming.get('format')=='proof-of-work-ui-incoming-evidence-v1' and incoming.get('releaseId')==rid and incoming.get('preservedPath')==str(p),'source-evidence','Incoming receipt differs from selected surface copy')
        require(incoming.get('movePreservedInodes') is True and incoming.get('historicalDeletion') is False and incoming.get('allPriorEvidencePreserved') is True,'source-evidence','Incoming preservation contract differs')
        require(all(intent.get(k)==incoming.get(k) for k in ('releaseId','planSha256','preservedPath','payloadFingerprint')) and intent.get('historicalDeletion') is False and intent.get('oldPath')==str(SCRATCH/p.name),'source-evidence','Incoming intent does not close the exact move')
        require(incoming.get('payloadFingerprint')==fp and receiver.get('status')=='verified' and receiver.get('kind')=='surfaces' and receiver.get('releaseId')==rid and receiver.get('extractedRoot')==str(SCRATCH/p.name),'source-evidence','Receiver/payload binding differs')
        require(receiver.get('entries')==fp['entries'] and receiver.get('logicalBytes')==fp['regularBytes'] and type(receiver.get('compressedBytes')) is int and receiver['compressedBytes']>0 and re.fullmatch('[0-9a-f]{64}',receiver.get('archiveSha256','')),'source-evidence','Receiver archive/hash/size binding differs')
        terminal=terminal_publication(rid)
        require(incoming.get('commit')==terminal['commit'] and incoming.get('tree')==terminal['tree'],'publication-incomplete','Published source differs from incoming copy')
        return dict(artifactClass=kind,releaseId=rid,receiverArchiveSha256=receiver['archiveSha256'],payloadFingerprint=fp,bindings=[ib,rb],terminalPublication=terminal)
    if kind=='managed-archive-group':
        raw,binding=record(Path(str(p)+'.provenance'),65536);fields={}
        for line in raw.decode().splitlines():
            key,sep,value=line.partition('=');require(sep and key not in fields,'archive-invalid','Malformed archive provenance');fields[key]=value
        require(fields.get('release_id')==rid and fields.get('archive_name')==p.name,'archive-invalid','Archive provenance identity differs')
        proof=A.archive_proof(p,fields,raw)
        terminal=None
        if not ordinary:
            require(rid not in plan['closure']['admittedReleaseIds'],'ordinary-policy-required','Admitted managed archives require ordinary policy retirement')
            terminal=terminal_publication(rid)
            require(fields.get('commit')==terminal['commit'] and fields.get('source_tree')==terminal['tree'],'publication-incomplete','Published source differs from managed archive')
            # Any retained root may still need this archive, even outside the pair.
            for root in [Path('/var/www'),*sorted((BASE/'rollback-roots').iterdir())]:
                require(R.manifest(root).get('archive_name')!=p.name,'protected-dependency','A retained root still depends on this archive')
        return dict(artifactClass=kind,releaseId=rid,archiveSha256=fields['archive_sha256'],payloadSha256=proof['payloadSha256'],payloadBytes=proof['payloadBytes'],provenance=binding,terminalPublication=terminal)
    if plan.get('lifecycle') and kind in ('preserved-source','stage-root'):
        rid=rid or p.name.removeprefix('proofofwork-www-stage-')
        require(RELEASE.fullmatch(rid) is not None,'publication-incomplete','Unrecognized release requires explicit recovery reconciliation')
        return dict(artifactClass=kind,releaseId=rid,terminalPublication=terminal_publication(rid))
    return dict(artifactClass=kind)


def row_inventory(path, kind):
    if kind=='managed-archive-group':return E.inventory_file_group(path,sorted(Path(str(path)+s).name for s in ('','.sha256','.provenance')))
    return E.inventory(path,require_manifest=False,allow_symlinks=True)


def check_references(paths):
    try:return W.check_references(paths,config_roots=(*W.DEFAULT_CONFIG_ROOTS,'/var/spool/cron'))
    except Exception as error:
        message=str(error)
        category='active-reference' if 'references selected root' in message or 'has a mount' in message else 'reference-scan-incomplete'
        raise QualificationError(category,message) from error


def closed_alias_proof(path, plan, inventory):
    closure=plan['closure'];snapshots={}
    for name in ('current','previous'):
        snapshot=closure['pair'][name]['snapshot'];snapshots[snapshot['path']]=snapshot
    for row in closure['ordinaryEligibleSnapshots']:
        if row['kind']=='rollback-root':snapshots[row['path']]=row['snapshot']
    require(str(path) in snapshots,'external-hardlink','Ordinary source root is absent from authenticated alias scope')
    aliases={}
    for root,snapshot in snapshots.items():
        for item in snapshot['entries']:
            if item['kind']=='file':aliases.setdefault((item['device'],item['inode']),[]).append((str(Path(root)/item['path']),item))
    groups={}
    for item in inventory['records']:
        if item['kind']=='file':
            s=item['identity'];groups.setdefault((s['st_dev'],s['st_ino']),[]).append(item)
    proof=[]
    for key,rows in sorted(groups.items()):
        sample=rows[0]
        if len(rows)==sample['identity']['st_nlink']:continue
        known=aliases.get(key,[])
        require(len(known)==sample['identity']['st_nlink'] and all(r['sha256']==sample['sha256'] for _,r in known),'external-hardlink','Unknown or changed alias outside the fully verified ordinary root closure')
        proof.append(dict(device=key[0],inode=key[1],identity=sample['identity'],xattrs=sample['xattrs'],sha256=sample['sha256'],aliases=sorted(p for p,_ in known)))
    out=dict(schema='pow-ui-ordinary-export-hardlink-closure-v1',sourceRoot=str(path),policyIndex=closure['index'],protectedReleaseIds=closure['protectedReleaseIds'],
        verifiedRoots=[dict(path=p,snapshotSha256=snapshots[p]['sha256']) for p in sorted(snapshots)],groups=proof)
    E.verify_closed_aliases(path,inventory['records'],out)
    return out


def qualify(output, lifecycle=None):
    # Discovery creates a read-only proposal, never deletion authority by age.
    script = launcher('qualify', {'lifecycle':lifecycle} if lifecycle else {})
    result = subprocess.run([*SSH, 'nice -n 15 ionice -c 3 python3 -I -B -'],
                            input=script, capture_output=True, check=True, timeout=1800)
    save(output, json.loads(result.stdout))


def discover(plan):
    roots=list(SCRATCH.glob('proofofwork-www-stage-*'))
    roots += [p for p in (BASE/'rollback-roots').iterdir() if str(p)!=plan['priorRoot']]
    roots += list((BASE/'transport-evidence').glob('historical-archives-*'))
    roots += list((BASE/'transport-evidence').glob('*/proofofwork-ui-source-*'))
    if plan.get('lifecycle'):
        roots += list((BASE/'transport-evidence').glob('*/proofofwork-ui-surfaces-*'))
        roots += list((BASE/'releases').glob('proofofwork-ui-release-*.tgz'))
    return sorted(set(roots))


def qualify_candidate(path, plan):
    row={'path':str(path),'eligible':False}
    try:
        kind,rid,ordinary=scope(path,plan);row.update(artifactClass=kind,releaseId=rid,retirementMethod='ordinary-policy' if ordinary else 'custody')
        paths=[Path(str(path)+s) for s in ('','.sha256','.provenance')] if kind=='managed-archive-group' else [path]
        for p in paths:
            if p!=path:require(p.resolve(strict=True)==p,'unsafe-path','Archive sidecar is not canonical')
        row['members']=[str(p) for p in paths]
        row['references']=check_references(paths)
        inventory=row_inventory(path,kind);row['inventory']=inventory;groups={}
        parent=Path(path).parent
        row['retainedParent']=dict(path=str(parent),identity=E.identity(parent.lstat()),xattrs=E.xattrs(parent))
        row['artifactProof']=artifact_proof(path,plan,inventory)
        for item in inventory['records']:
            if item['kind']=='file':
                info=item['identity'];groups.setdefault((info['st_dev'],info['st_ino']),[]).append(item)
        if not all(len(rows)==rows[0]['identity']['st_nlink'] for rows in groups.values()):
            require(ordinary and kind=='rollback-root','external-hardlink','External hardlinks prevent retirement')
            row['externalLinkClosure']=closed_alias_proof(path,plan,inventory)
        row['allocatedBytes']=sum(rows[0]['identity']['st_blocks']*512 for rows in groups.values());row['eligible']=True
    except Exception as error:row.update(reason=str(error),rejectionCategory=getattr(error,'category','verification-failed'))
    return row


def remote_qualify(frame=None):
    current=R.verified_release(Path('/var/www'),BASE/'releases')
    priorroot=BASE/'rollback-roots'/('proofofwork-www-pre-'+current['release_id'])
    prior=R.verified_release(priorroot,BASE/'releases')
    plan={'current':current,'prior':prior,'priorRoot':str(priorroot),'holds':E.hold_snapshot(),
          'timers':E.timer_snapshot(),'candidates':[],
          'protectedManifests':{str(p):E.digest(E.read_regular(p/'.proofofwork-ui-release')[0])
                                for p in [Path('/var/www'),priorroot]}}
    if frame and frame.get('lifecycle'):
        plan['lifecycle']=frame['lifecycle'];plan['closure']=lifecycle_context(plan['lifecycle'])
    plan['candidates']=[qualify_candidate(path,plan) for path in discover(plan)]
    fence(plan,full=True);print(json.dumps(plan))


def remote_operation(operation, frame):
    if os.geteuid() != 0:
        raise ValueError('Remote operation requires root')
    lock = E.lock_existing()
    try:
        if operation == 'qualify':
            remote_qualify(frame); return
        plan = frame['plan']; row = frame['row']; path = Path(row['path'])
        kind,rid,ordinary=scope(path, plan); fence(plan, full=True)
        require(row.get('eligible') is True,'plan-invalid','Candidate was not positively qualified')
        members=[Path(str(path)+s) for s in ('','.sha256','.provenance')] if kind=='managed-archive-group' else [path]
        check_references(members)
        actual=row_inventory(path,kind)
        (E.assert_file_group if kind=='managed-archive-group' else E.assert_inventory)(actual, expected(row))
        if 'artifactProof' in row and artifact_proof(path,plan,actual)!=row['artifactProof']:
            raise ValueError('Artifact receipt/source binding changed')
        if row.get('externalLinkClosure'):
            require(ordinary and kind=='rollback-root' and closed_alias_proof(path,plan,actual)==row['externalLinkClosure'],'external-hardlink','Ordinary export alias closure changed')
        if operation == 'export':
            result = E.archive_root(path, expected(row), sys.stdout.buffer, require_manifest=False, allow_symlinks=True,ordinary_closed_aliases=ordinary and kind=='rollback-root')
            fence(plan); print(json.dumps(result), file=sys.stderr)
            return
        if operation != 'retire':
            raise ValueError('Unknown operation')
        require(not ordinary and row.get('retirementMethod','custody')=='custody','ordinary-policy-required','Ordinary assets are preserved here and retired only by their authenticated policy')
        custody = frame['custody']
        if not custody.get('ok') or custody['sourcePath'] != str(path) or custody['inventorySha256'] != E.inventory_sha(row['inventory']['records']) or custody.get('sourceInventory')!=expected(row):
            raise ValueError('Custody does not bind exact root')
        if not all(custody['restoration'][k] for k in ('ownerRestored','modeTimesXattrsRestored','internalHardlinksRestored')):
            raise ValueError('Full independent restoration is required')
        receipt = BASE/'cleanup-evidence'/('bounded-retention-' + frame['operationId'])
        if receipt.exists():
            raise ValueError('Prior intent exists; reconcile manually, never retry blindly')
        require(len(encoded(frame))+len(encoded(custody))+16*1024**2+256*1024<=32*1024**2,'receipt-capacity','Custody evidence would exceed the unchanged 32 MiB retirement receipt reservation')
        # Small durable receipt/journal envelope; existing reserve is never lowered.
        subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity',
                        'check-retirement','--path',str(receipt.parent)], check=True, stdout=subprocess.DEVNULL)
        before = os.statvfs(BASE); receipt.mkdir(mode=0o700); W.sync_directory(receipt.parent)
        E.save_new(receipt/'intent.json', encoded(frame)); journal = W.Journal(receipt/'actions.jsonl')
        parent = os.open(path.parent, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
        try:
            fence(plan)
            count = W.delete_file_group(parent, expected(row), journal) if kind=='managed-archive-group' else W.delete_tree(parent, path.name, expected(row), journal)
            fence(plan, full=True)
            after = os.statvfs(BASE)
            result = {'ok':True,'path':str(path),'actions':count,'custody':custody,
                      'beforeAvailableBytes':before.f_bavail*before.f_frsize,
                      'afterAvailableBytes':after.f_bavail*after.f_frsize,
                      'receipt':str(receipt),'protectedPairVerified':True}
            E.save_new(receipt/'completed.json',encoded(result)); print(json.dumps(result))
        except BaseException as error:
            E.save_new(receipt/'failure.json',encoded({'error':str(error),'manualReconciliationRequired':True}))
            raise
        finally:
            os.close(parent); journal.close()
    finally:
        os.close(lock)


def launcher(operation, frame):
    code = 'import base64,zlib,types,sys,json\n'
    for name, relative in SOURCES.items():
        raw = (ROOT/relative).read_bytes()
        code += f"m=types.ModuleType('bound_{name}');sys.modules[m.__name__]=m;m._BOUND_EXPORTER=globals().get('E');m._BOUND_STORAGE=globals().get('A')\n"
        code += f"exec(compile(base64.b64decode({base64.b64encode(raw).decode()!r}),{relative!r},'exec'),m.__dict__);{name}=m\n"
    own = Path(__file__).read_bytes()
    code += f"ns={{'__name__':'bound_controller','__file__':'/bound/deploy/ui-retention/custody.py','E':E,'W':W,'R':R,'A':A,'P':P}}\nexec(compile(base64.b64decode({base64.b64encode(own).decode()!r}),'custody.py','exec'),ns)\n"
    packed = base64.b64encode(zlib.compress(encoded(frame))).decode()
    code += f"ns['remote_operation']({operation!r},json.loads(zlib.decompress(base64.b64decode({packed!r}))))\n"
    return code.encode()


def verify_custody(row, record, plan_path, custody):
    key=hashlib.sha256(row['path'].encode()).hexdigest()[:16];archive=Path(custody)/(key+'.tgz')
    require(record.get('ok') is True and record.get('sourcePath')==row['path'] and record.get('planSha256')==digest(plan_path),'custody-mismatch','Custody source/plan binding differs')
    require(record.get('archivePath')==str(archive) and archive.resolve(strict=True)==archive and digest(archive)==record.get('archiveSha256'),'custody-mismatch','Custody location or archive hash differs')
    wanted=expected(row);saved=json.loads((Path(custody)/(key+'.inventory.json')).read_bytes())
    require(saved==wanted and record.get('sourceInventory')==wanted and record.get('inventorySha256')==E.inventory_sha(wanted['inventory']),'custody-mismatch','Custody full inventory differs')
    restored=record.get('restoration',{})
    require(restored.get('sourceRoot')==row['path'] and restored.get('archiveSha256')==record['archiveSha256'] and restored.get('inventorySha256')==record['inventorySha256'] and all(restored.get(k) is True for k in ('ownerRestored','modeTimesXattrsRestored','internalHardlinksRestored')),'custody-mismatch','Independent restoration does not bind custody bytes/metadata')
    if wanted.get('externalLinkClosure'):
        require(restored.get('externalAliasesRetainedAsEvidence') is True and restored.get('externalLinkClosureSha256')==E.digest(E.encoded(wanted['externalLinkClosure'])),'custody-mismatch','Independent restoration lost complete ordinary alias evidence')
    return archive


def restored_check(archive, inventory_path, destination, *, fresh=False):
    args=[str(archive),str(inventory_path),str(destination)] if fresh else [str(destination),str(inventory_path)]
    call="m.extract_verify(Path(sys.argv[2]),json.loads(Path(sys.argv[3]).read_text()),Path(sys.argv[4]))" if fresh else "m.verify_restored(Path(sys.argv[2]),json.loads(Path(sys.argv[3]).read_text()))"
    script="import importlib.util,json,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('E',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps("+call+"))"
    return subprocess.run(['unshare','--user','--map-root-user','python3','-I','-B','-c',script,str(ROOT/SOURCES['E']),*args],capture_output=True,text=True,timeout=900)


def custody_allocation(rows, first_archive=True):
    """Conservative full-byte archive + independent restore; no compression credit."""
    archive_bytes=restore_bytes=archive_inodes=restore_inodes=0
    for index,row in enumerate(rows):
        source=expected(row);entries=len(source['inventory']);regular=source['regularBytes'];metadata=len(encoded(source))
        # PAX headers, gzip expansion, allocation rounding, sealed metadata and
        # logs are charged in addition to every logical source byte.
        tar_bound=regular+entries*8192+metadata*2+128*1024
        if index or first_archive:archive_bytes+=tar_bound+tar_bound//1000+64*1024
        archive_bytes+=metadata*3+2*1024**2;archive_inodes+=12
        restore_bytes+=regular+entries*8192+64*1024;restore_inodes+=entries+2
    return dict(archiveBytes=archive_bytes,archiveInodes=archive_inodes,restoreBytes=restore_bytes,restoreInodes=restore_inodes)


def check_custody_capacity(rows, custody_parent, restore_parent, *, first_archive=True, observe=None):
    if observe is None:
        def observe(path):
            path=Path(path);require(path.resolve(strict=True)==path and path.is_dir(),'custody-capacity','Offhost allocation parent is not canonical')
            fs=os.statvfs(path);return dict(device=path.stat().st_dev,availableBytes=fs.f_bavail*fs.f_frsize,availableInodes=fs.f_favail)
    model=custody_allocation(rows,first_archive);pools={}
    for path,b,i in ((custody_parent,model['archiveBytes'],model['archiveInodes']),(restore_parent,model['restoreBytes'],model['restoreInodes'])):
        state=observe(path);key=state['device']
        if key not in pools:pools[key]=dict(device=key,paths=[],additionalBytes=0,additionalInodes=0,availableBytes=state['availableBytes'],availableInodes=state['availableInodes'])
        pool=pools[key];pool['paths'].append(str(path));pool['additionalBytes']+=b;pool['additionalInodes']+=i
        pool['availableBytes']=min(pool['availableBytes'],state['availableBytes']);pool['availableInodes']=min(pool['availableInodes'],state['availableInodes'])
    for pool in pools.values():
        require(pool['availableBytes']>=pool['additionalBytes']+OFFHOST_RESERVE_BYTES and pool['availableInodes']>=pool['additionalInodes']+OFFHOST_RESERVE_INODES,'custody-capacity','Independent custody/restore capacity refused: '+json.dumps(pool,sort_keys=True))
    return dict(ok=True,model='uncompressed-full-custody-and-independent-restore-v1',allocation=model,filesystems=list(pools.values()),reserveBytes=OFFHOST_RESERVE_BYTES,reserveInodes=OFFHOST_RESERVE_INODES)


def preserve(plan_path, custody, resume=False):
    plan = json.loads(plan_path.read_bytes());rows=[r for r in plan['candidates'] if r['eligible']]
    restore = Path('/tmp')/('pow-ui-custody-restore-'+hashlib.sha256(str(custody).encode()).hexdigest()[:16])
    capacity=check_custody_capacity(rows,custody.parent,restore.parent)
    custody.mkdir(mode=0o700, exist_ok=resume)
    restore.mkdir(mode=0o700, exist_ok=resume)
    save(custody/('capacity-'+uuid.uuid4().hex+'.json'),capacity)
    for index, row in enumerate(rows):
        check_custody_capacity(rows[index:],custody,restore)
        key = hashlib.sha256(row['path'].encode()).hexdigest()[:16]
        archive = custody/(key+'.tgz'); errors = custody/(key+'.stderr')
        if resume and (custody/(key+'.json')).exists():
            record=json.loads((custody/(key+'.json')).read_bytes())
            verify_custody(row,record,plan_path,custody)
            # Reuse is exact-plan/exact-inventory only, with a fresh independent
            # extraction. Never replace a partial attempt or a sealed receipt.
            token=key+'-reverify-'+uuid.uuid4().hex
            result=restored_check(archive,custody/(key+'.inventory.json'),restore/token,fresh=True)
            save(custody/(token+'.json'),dict(exitCode=result.returncode,stdout=result.stdout,stderr=result.stderr))
            result.check_returncode();print(json.dumps({'alreadyPreserved':row['path'],'freshRestoration':str(restore/token)}),flush=True);continue
        if archive.exists() or errors.exists():
            raise ValueError('Partial custody requires manual reconciliation: '+str(archive))
        frame = {'plan':{k:v for k,v in plan.items() if k!='candidates'},'row':row}
        with archive.open('xb') as out, errors.open('xb') as err:
            subprocess.run([*SSH,'nice -n 15 ionice -c 3 python3 -I -B -'],input=launcher('export',frame),stdout=out,stderr=err,check=True,timeout=900)
            out.flush(); os.fsync(out.fileno())
        exported = json.loads(errors.read_text()); assert digest(archive)==exported['archiveSha256'] and exported['inventorySha256']==E.inventory_sha(row['inventory']['records'])
        inventory_path=custody/(key+'.inventory.json');save(inventory_path,expected(row))
        check_custody_capacity(rows[index:],custody,restore,first_archive=False)
        result=restored_check(archive,inventory_path,restore/key,fresh=True)
        save(custody/(key+'.restore-log.json'),{'exitCode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        result.check_returncode()
        restored=json.loads(result.stdout)
        record={'ok':True,'sourcePath':row['path'],'archivePath':str(archive),'archiveSha256':digest(archive),
                'inventorySha256':E.inventory_sha(row['inventory']['records']),'sourceInventory':expected(row),'restoration':restored,'planSha256':digest(plan_path)}
        save(custody/(key+'.json'),record);print(json.dumps({'preserved':row['path'],'bytes':archive.stat().st_size}),flush=True)


def retire(plan_path,custody,output):
    plan=json.loads(plan_path.read_bytes()); completed=[]
    if output.exists():raise ValueError('Result exists; inspect prior operation')
    for row in plan['candidates']:
        if not row['eligible']:continue
        if row.get('retirementMethod')=='ordinary-policy':continue
        key=hashlib.sha256(row['path'].encode()).hexdigest()[:16];record=json.loads((custody/(key+'.json')).read_bytes())
        archive=verify_custody(row,record,plan_path,custody)
        # Reverify every restored byte, mode, owner, time, attribute and link now.
        restored_check(archive,custody/(key+'.inventory.json'),Path(record['restoration']['restoredPath'])).check_returncode()
        frame={'plan':{k:v for k,v in plan.items() if k!='candidates'},'row':row,'custody':record,'operationId':digest(plan_path)[:12]+'-'+key,
               'authorization':('2026-10-16: approved retention repair '+REPAIR_APPROVAL_SHA if plan.get('lifecycle') else '2026-10-13: Go ahead with the safe UI VPS cleanup and implement bounded retention and disk reserve checks. Keep the last verified rollback and all unique audit evidence, and verify everything still works.')}
        result=subprocess.run([*SSH,'nice -n 15 ionice -c 3 python3 -I -B -'],input=launcher('retire',frame),capture_output=True,check=True,timeout=900)
        value=json.loads(result.stdout);completed.append(value);save(Path(str(output)+'.'+key+'.json'),value)
        print(json.dumps({'retired':row['path'],'availableBytes':value['afterAvailableBytes']}),flush=True)
    save(output,{'ok':True,'completed':completed,'planSha256':digest(plan_path)})


def verify_final_result(plan, plan_sha, result, result_sha):
    """Read-only terminal proof for the lifecycle coordinator; no inferred retries."""
    require(E.digest(encoded(plan))==plan_sha and E.digest(encoded(result))==result_sha,'completion-mismatch','Custody plan/result canonical bytes differ')
    require(result.get('ok') is True and result.get('planSha256')==plan_sha,'completion-mismatch','Custody result is not bound to the completed plan')
    fence(plan,full=True)
    wanted=[r for r in plan['candidates'] if r.get('eligible') is True and r.get('retirementMethod','custody')=='custody']
    completed=result.get('completed',[])
    require([r.get('path') for r in completed]==[r['path'] for r in wanted] and len({r['path'] for r in wanted})==len(wanted),'completion-mismatch','Custody completion omitted, duplicated, reordered or expanded scope')
    proofs=[]
    for row,value in zip(wanted,completed):
        path=Path(row['path']);kind,_=artifact(path);key=hashlib.sha256(row['path'].encode()).hexdigest()[:16]
        receipt=BASE/'cleanup-evidence'/('bounded-retention-'+plan_sha[:12]+'-'+key)
        require(value.get('ok') is True and value.get('protectedPairVerified') is True and value.get('receipt')==str(receipt),'completion-mismatch','Custody terminal receipt identity differs')
        require(not os.path.lexists(receipt/'failure.json'),'completion-mismatch','Custody operation has an unresolved failure journal')
        raw,binding=record(receipt/'completed.json',32*1024**2);require(json.loads(raw)==value,'completion-mismatch','Durable custody completion differs from caller result')
        ir,ib=record(receipt/'intent.json',64*1024**2);intent=json.loads(ir)
        require(intent.get('plan')=={k:v for k,v in plan.items() if k!='candidates'} and intent.get('row')==row and intent.get('custody')==value.get('custody'),'completion-mismatch','Custody intent differs from qualified plan/source')
        custody=value['custody'];source=expected(row);restored=custody.get('restoration',{})
        require(custody.get('planSha256')==plan_sha and custody.get('sourcePath')==str(path) and custody.get('sourceInventory')==source and custody.get('inventorySha256')==E.inventory_sha(source['inventory']),'completion-mismatch','Custody completion lost full source inventory')
        require(restored.get('sourceRoot')==str(path) and restored.get('archiveSha256')==custody.get('archiveSha256') and restored.get('inventorySha256')==custody['inventorySha256'] and all(restored.get(k) is True for k in ('ownerRestored','modeTimesXattrsRestored','internalHardlinksRestored')),'completion-mismatch','Custody completion lost independent restoration binding')
        journal,jb=record(receipt/'actions.jsonl',16*1024**2);actions=[json.loads(line) for line in journal.splitlines()]
        require(len(actions)==2*len(source['inventory']) and value.get('actions')==len(source['inventory']),'completion-mismatch','Custody action journal is partial or expanded')
        for number in range(len(source['inventory'])):
            before,after=actions[2*number:2*number+2]
            require(before.get('stage')=='intent' and after.get('stage')=='completed' and after.get('action')==dict(before.get('action',{}),ordinal=number+1),'completion-mismatch','Custody action journal did not complete every durable intent')
        originals={r['path']:r for r in source['inventory']};observed=[r['action'] for r in actions[::2]]
        require(len({r.get('path') for r in observed})==len(originals) and {r.get('path') for r in observed}==set(originals),'completion-mismatch','Custody journal member set differs')
        for action in observed:
            original=originals[action['path']]
            require(action.get('root')==source['root'] and action.get('kind')==original['kind'] and action.get('sha256')==original.get('sha256') and all(action.get('before',{}).get(k)==original['identity'][k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')),'completion-mismatch','Custody journal member identity differs')
        members=[Path(str(path)+s) for s in ('','.sha256','.provenance')] if kind=='managed-archive-group' else [path]
        require(all(not os.path.lexists(p) for p in members) and path.parent.is_dir(),'completion-mismatch','Retired member reappeared or containing evidence directory was lost')
        parent=source.get('retainedParent') or source.get('parent')
        if parent:
            actual=E.identity(path.parent.lstat())
            require(path.parent.resolve(strict=True)==path.parent and all(actual[k]==parent['identity'][k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')) and E.xattrs(path.parent)==parent['xattrs'],'completion-mismatch','Containing evidence directory was replaced or changed')
        artifact_evidence=row.get('artifactProof',{})
        for bound in [*artifact_evidence.get('bindings',[]),*(artifact_evidence.get('terminalPublication',{}).get('bindings',[]) if artifact_evidence.get('terminalPublication') else [])]:
            raw,actual=record(bound['path'])
            require(actual==bound,'completion-mismatch','Unique incoming/publication evidence changed after retirement')
        proofs.append(dict(path=str(path),receipt=binding,intent=ib,journal=jb))
    remaining=[qualify_candidate(p,plan) for p in discover(plan)]
    require(not [r for r in remaining if r.get('eligible')],'retention-incomplete','Qualified bulk artifacts remain after the custody cycle')
    fence(plan,full=True)
    return dict(ok=True,planSha256=plan_sha,resultSha256=result_sha,completedCount=len(completed),receipts=proofs,
        remaining=[{k:r[k] for k in ('path','eligible','artifactClass','retirementMethod','rejectionCategory','reason') if k in r} for r in remaining],protectedPairVerified=True,holdsAndTimersUnchanged=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['qualify','preserve','retire']);parser.add_argument('plan',type=Path);parser.add_argument('custody',nargs='?',type=Path);parser.add_argument('output',nargs='?',type=Path)
    parser.add_argument('--resume',action='store_true',help='Skip only complete, hash-verified preservation receipts; partial attempts refuse')
    parser.add_argument('--lifecycle',type=Path,help='Read-only qualification with exact approved custody lifecycle/index bindings')
    args=parser.parse_args();os.umask(0o077);load_helpers()
    if args.lifecycle is not None and args.operation!='qualify':parser.error('--lifecycle is only valid for qualification')
    if args.operation=='qualify':qualify(args.plan,json.loads(args.lifecycle.read_bytes()) if args.lifecycle else None)
    elif args.operation=='preserve':
        if args.custody is None:parser.error('preserve requires custody')
        preserve(args.plan,args.custody,args.resume)
    else:
        if args.output is None or args.custody is None:parser.error('retire requires custody and output')
        retire(args.plan,args.custody,args.output)

if __name__=='__main__':main()
