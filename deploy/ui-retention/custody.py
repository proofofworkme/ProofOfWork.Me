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
import select
import shlex
import stat
import struct
import subprocess
import sys
import threading
import time
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
BATCH_MAGIC=b'POW-UI-CUSTODY-BATCH-v1\n'
BATCH_CHUNK=1024**2
BATCH_JSON=64*1024
BATCH_OBJECTS=64
BATCH_BYTES=18*1024**3
BATCH_SECONDS=5400
RETIREMENT_RECEIPT_BYTES=32*1024**2
RETIREMENT_JOURNAL_BYTES=16*1024**2
RETIREMENT_AUXILIARY_BYTES=256*1024
RETIREMENT_FAILURE_BYTES=32*1024
RETIREMENT_STDOUT_BYTES=32*1024**2
RETIREMENT_STDERR_BYTES=256*1024


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


def bounded_error(error):
    message=str(error)
    return message if len(message)<=2048 else message[:2000]+' [truncated; inspect command diagnostics]'


def retirement_capacity(frame, source):
    """The writer enforces this inventory-derived bound before every action."""
    journal=W.journal_capacity_bound(source)
    require(type(journal)is int and 0<journal<=RETIREMENT_JOURNAL_BYTES,'receipt-capacity','Custody journal exceeds the unchanged 16 MiB journal reservation')
    total=len(encoded(frame))+len(encoded(frame['custody']))+journal+RETIREMENT_AUXILIARY_BYTES
    require(total<=RETIREMENT_RECEIPT_BYTES,'receipt-capacity','Custody evidence would exceed the unchanged 32 MiB retirement receipt reservation')
    return dict(journalBytes=journal,totalBytes=total,auxiliaryBytes=RETIREMENT_AUXILIARY_BYTES)


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


def batch_rows(plan):
    rows=[row for row in plan['candidates'] if row.get('eligible') is True]
    require(len(rows)<=BATCH_OBJECTS and len({row['path'] for row in rows})==len(rows),'batch-scope','Duplicate or oversized custody batch')
    require(sum(row['inventory']['fingerprint']['regularBytes'] for row in rows)<=BATCH_BYTES,'batch-scope','Custody batch exceeds unchanged retained-pool byte bound')
    return rows


def batch_guards(plan):
    """Only called after the full entry fence, inside its continuous lock."""
    snapshots={};visited=set();total=0
    def add(snapshot):
        path=snapshot['path']
        require(path not in snapshots or snapshots[path]==snapshot,'batch-guard','Conflicting verified dependency snapshots')
        snapshots[path]=snapshot
    def walk(value):
        if isinstance(value,dict):
            if value.get('model')=='audit30-whole-bytes-inode-xattrs-v1':add(value)
            else:
                for child in value.values():walk(child)
        elif isinstance(value,list):
            for child in value:walk(child)
    cache={}
    closure=plan.get('closure') or A.protected_pair(A.Layout(),cache)
    walk(closure)
    walk(cache)
    # The authenticated closure names protected archive triplets separately
    # from root/source snapshots. Capture their complete byte/metadata proofs
    # now under the same entry lock, then guard them between every object.
    for path in closure.get('protectedPaths',[]):
        if path not in snapshots:add(A.snapshot(Path(path),links=True))
    # Admission/approval receipts are immutable inputs to the full closure too.
    def evidence(binding):
        nonlocal total
        if not isinstance(binding,dict):return
        if 'intentPath' in binding and 'intentSha256' in binding:
            evidence(dict(path=binding['intentPath'],sha256=binding['intentSha256']))
        if set(binding)=={'path','sha256'} and isinstance(binding['path'],str) and binding['path'].startswith(str(BASE/'cleanup-evidence')+'/') and re.fullmatch(r'[a-f0-9]{64}',str(binding['sha256'])):
            path=binding['path']
            if path in visited:
                require(snapshots[path]['entries'][0]['sha256']==binding['sha256'],'batch-guard','Conflicting receipt binding');return
            require(len(visited)<128,'batch-guard','Receipt dependency graph exceeds bound');visited.add(path)
            raw,_=E.read_regular(path,128*1024**2);total+=len(raw)
            require(total<=256*1024**2 and E.digest(raw)==binding['sha256'],'batch-guard','Receipt bytes differ or dependency bound exceeded')
            snapshot=A.snapshot(Path(path));require(snapshot['entries'][0]['sha256']==binding['sha256'],'batch-guard','Receipt changed during entry verification');add(snapshot)
            evidence(json.loads(raw));return
        for child in binding.values():
            if isinstance(child,dict):evidence(child)
            elif isinstance(child,list):
                for item in child:
                    if isinstance(item,dict):evidence(item)
    if plan.get('lifecycle'):evidence(plan['lifecycle'])
    require(snapshots,'batch-guard','No fully verified protected dependency snapshots')
    return snapshots


def guard_batch(plan,snapshots):
    fence(plan)
    for path,previous in snapshots.items():
        current=A.guard_snapshot(Path(path),previous,links=True)
        A.match_snapshot(current,previous)
        snapshots[path]=current


def write_all(stream,data):
    view=memoryview(data)
    while view:
        count=stream.write(view);count=len(view) if count is None else count
        require(type(count)is int and 0<count<=len(view),'batch-stream','Custody stream made no progress');view=view[count:]


def batch_frame(stream,kind,payload):
    require(kind in (b'J',b'D') and 0<len(payload)<=(BATCH_JSON if kind==b'J' else BATCH_CHUNK),'batch-stream','Invalid custody frame')
    write_all(stream,kind+struct.pack('>I',len(payload)));write_all(stream,payload)


def batch_event(stream,value):batch_frame(stream,b'J',encoded(value))


class BatchSink:
    def __init__(self,stream,deadline):self.stream=stream;self.deadline=deadline
    def write(self,data):
        require(time.monotonic()<self.deadline,'batch-timeout','Custody export batch deadline exceeded')
        for start in range(0,len(data),BATCH_CHUNK):batch_frame(self.stream,b'D',data[start:start+BATCH_CHUNK])
        return len(data)
    def flush(self):self.stream.flush()


def batch_members(rows,plan):
    members=[]
    for row in rows:
        path=Path(row['path']);kind,_,_=scope(path,plan)
        members.extend(str(path)+suffix for suffix in (('','.sha256','.provenance') if kind=='managed-archive-group' else ('',)))
    return members


def remote_export_batch(frame,stream,lock_fd):
    plan=frame['plan'];rows=batch_rows(plan);plan_sha=E.digest(encoded(plan))
    require(set(frame)=={'plan','planSha256'} and frame['planSha256']==plan_sha,'batch-scope','Custody batch plan SHA differs')
    deadline=time.monotonic()+BATCH_SECONDS
    layout=A.Layout();lock_binding=A.require_execution_lock(lock_fd,layout)
    def locked_guard():
        A.require_execution_lock(lock_fd,layout,lock_binding)
        guard_batch(plan,guards)
        A.require_execution_lock(lock_fd,layout,lock_binding)
    fence(plan,full=True);guards=batch_guards(plan)
    A.require_execution_lock(lock_fd,layout,lock_binding)
    all_members=batch_members(rows,plan)
    if all_members:check_references(all_members)
    write_all(stream,BATCH_MAGIC);batch_event(stream,dict(type='batch-start',planSha256=plan_sha,count=len(rows)))
    results=[]
    for index,row in enumerate(rows):
        require(time.monotonic()<deadline,'batch-timeout','Custody export batch deadline exceeded')
        locked_guard()
        path=Path(row['path']);kind,rid,ordinary=scope(path,plan)
        require(row.get('retirementMethod','custody')==('ordinary-policy' if ordinary else 'custody'),'batch-scope','Custody retirement method changed')
        actual=row_inventory(path,kind)
        (E.assert_file_group if kind=='managed-archive-group' else E.assert_inventory)(actual,expected(row))
        if 'artifactProof' in row:
            require(artifact_proof(path,plan,actual)==row['artifactProof'],'batch-proof','Artifact proof changed during batch')
        if row.get('externalLinkClosure'):
            require(ordinary and kind=='rollback-root' and closed_alias_proof(path,plan,actual)==row['externalLinkClosure'],'external-hardlink','Ordinary alias closure changed')
        batch_event(stream,dict(type='object-start',index=index,path=row['path']))
        result=E.archive_root(path,expected(row),BatchSink(stream,deadline),require_manifest=False,allow_symlinks=True,ordinary_closed_aliases=ordinary and kind=='rollback-root')
        locked_guard()
        result=dict(index=index,path=row['path'],proof=result);results.append(result)
        batch_event(stream,dict(type='object-complete',**result))
    if all_members:check_references(all_members)
    fence(plan,full=True)
    A.require_execution_lock(lock_fd,layout,lock_binding)
    require(time.monotonic()<deadline,'batch-timeout','Custody export batch deadline exceeded')
    seal=dict(type='batch-complete',schema='pow-ui-custody-export-batch-v1',planSha256=plan_sha,count=len(rows),objects=results,
              objectManifestSha256=E.digest(encoded(results)),entryAndFinalProtectedVerification=True,continuousDeploymentLock=True)
    batch_event(stream,seal);stream.flush()


def remote_operation(operation, frame):
    if os.geteuid() != 0:
        raise ValueError('Remote operation requires root')
    lock = E.lock_existing()
    try:
        if operation == 'qualify':
            remote_qualify(frame); return
        if operation == 'export-batch':
            remote_export_batch(frame,sys.stdout.buffer,lock);return
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
        retirement_capacity(frame,expected(row))
        # Small durable receipt/journal envelope; existing reserve is never lowered.
        subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity',
                        'check-retirement','--path',str(receipt.parent)], check=True, stdout=subprocess.DEVNULL)
        before = os.statvfs(BASE); receipt.mkdir(mode=0o700); W.sync_directory(receipt.parent)
        E.save_new(receipt/'intent.json', encoded(frame)); journal = W.Journal(receipt/'actions.jsonl',expected_root=expected(row))
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
            require(len(encoded(result))-len(encoded(custody))<=RETIREMENT_AUXILIARY_BYTES-RETIREMENT_FAILURE_BYTES,'receipt-capacity','Custody completion exceeds reserved auxiliary evidence')
            E.save_new(receipt/'completed.json',encoded(result)); print(json.dumps(result))
        except BaseException as error:
            failure=encoded({'error':bounded_error(error),'manualReconciliationRequired':True})
            require(len(failure)<=RETIREMENT_FAILURE_BYTES,'receipt-capacity','Custody failure exceeds reserved auxiliary evidence')
            E.save_new(receipt/'failure.json',failure)
            raise
        finally:
            os.close(parent); journal.close()
    finally:
        os.close(lock)


def launcher_source_pins():
    return [dict(path=relative,sha256=digest(ROOT/relative)) for relative in sorted([*SOURCES.values(),'deploy/ui-retention/custody.py'])]


def launcher(operation, frame, *, expected_sources=None):
    pins={item['path']:item['sha256'] for item in expected_sources} if expected_sources is not None else None
    def source(relative):
        raw=(ROOT/relative).read_bytes()
        require(pins is None or pins.get(relative)==hashlib.sha256(raw).hexdigest(),'implementation-drift','Retirement launcher source changed')
        return raw
    code = 'import base64,zlib,types,sys,json\n'
    for name, relative in SOURCES.items():
        raw = source(relative)
        code += f"m=types.ModuleType('bound_{name}');sys.modules[m.__name__]=m;m._BOUND_EXPORTER=globals().get('E');m._BOUND_STORAGE=globals().get('A')\n"
        code += f"exec(compile(base64.b64decode({base64.b64encode(raw).decode()!r}),{relative!r},'exec'),m.__dict__);{name}=m\n"
    own = source('deploy/ui-retention/custody.py') if pins is not None else Path(__file__).read_bytes()
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
    if record.get('batchExport'):
        bound=record['batchExport'];batch_path=Path(custody)/'batch-exported.json'
        require(bound.get('path')==str(batch_path) and digest(batch_path)==bound.get('sha256'),'custody-mismatch','Custody batch seal changed')
        batch=json.loads(batch_path.read_bytes());index=bound.get('index')
        require(batch.get('schema')=='pow-ui-custody-export-batch-v1' and batch.get('planSha256')==record['planSha256'] and batch.get('entryAndFinalProtectedVerification') is True and batch.get('continuousDeploymentLock') is True,'custody-mismatch','Custody batch lacks continuous-lock final proof')
        require(type(index)is int and 0<=index<len(batch['objects']) and batch['count']==len(batch['objects']) and E.digest(encoded(batch['objects']))==batch['objectManifestSha256'],'custody-mismatch','Custody batch manifest differs')
        exported=batch['objects'][index]
        require(exported['index']==index and exported['path']==row['path'] and exported['proof']['archiveSha256']==record['archiveSha256'] and exported['proof']['inventorySha256']==record['inventorySha256'],'custody-mismatch','Custody record is not a sealed batch member')
    return archive


def restored_check(archive, inventory_path, destination, *, fresh=False):
    args=[str(archive),str(inventory_path),str(destination)] if fresh else [str(destination),str(inventory_path)]
    call="m.extract_verify(Path(sys.argv[2]),json.loads(Path(sys.argv[3]).read_text()),Path(sys.argv[4]))" if fresh else "m.verify_restored(Path(sys.argv[2]),json.loads(Path(sys.argv[3]).read_text()))"
    script="import importlib.util,json,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('E',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps("+call+"))"
    return subprocess.run(['unshare','--user','--map-root-user','python3','-I','-B','-c',script,str(ROOT/SOURCES['E']),*args],capture_output=True,text=True,timeout=900)


def custody_allocation(rows, first_archive=True, *, archives_existing=False):
    """Conservative full-byte archive + independent restore; no compression credit."""
    archive_bytes=restore_bytes=archive_inodes=restore_inodes=0
    for index,row in enumerate(rows):
        source=expected(row);entries=len(source['inventory']);regular=source['regularBytes'];metadata=len(encoded(source))
        # PAX headers, gzip expansion, allocation rounding, sealed metadata and
        # logs are charged in addition to every logical source byte.
        tar_bound=regular+entries*8192+metadata*2+128*1024
        if not archives_existing and (index or first_archive):archive_bytes+=tar_bound+tar_bound//1000+64*1024
        archive_bytes+=metadata*3+2*1024**2;archive_inodes+=12
        restore_bytes+=regular+entries*8192+64*1024;restore_inodes+=entries+2
    return dict(archiveBytes=archive_bytes,archiveInodes=archive_inodes,restoreBytes=restore_bytes,restoreInodes=restore_inodes)


def check_custody_capacity(rows, custody_parent, restore_parent, *, first_archive=True, archives_existing=False, observe=None):
    if observe is None:
        def observe(path):
            path=Path(path);require(path.resolve(strict=True)==path and path.is_dir(),'custody-capacity','Offhost allocation parent is not canonical')
            fs=os.statvfs(path);return dict(device=path.stat().st_dev,availableBytes=fs.f_bavail*fs.f_frsize,availableInodes=fs.f_favail)
    model=custody_allocation(rows,first_archive,archives_existing=archives_existing);pools={}
    for path,b,i in ((custody_parent,model['archiveBytes'],model['archiveInodes']),(restore_parent,model['restoreBytes'],model['restoreInodes'])):
        state=observe(path);key=state['device']
        if key not in pools:pools[key]=dict(device=key,paths=[],additionalBytes=0,additionalInodes=0,availableBytes=state['availableBytes'],availableInodes=state['availableInodes'])
        pool=pools[key];pool['paths'].append(str(path));pool['additionalBytes']+=b;pool['additionalInodes']+=i
        pool['availableBytes']=min(pool['availableBytes'],state['availableBytes']);pool['availableInodes']=min(pool['availableInodes'],state['availableInodes'])
    for pool in pools.values():
        require(pool['availableBytes']>=pool['additionalBytes']+OFFHOST_RESERVE_BYTES and pool['availableInodes']>=pool['additionalInodes']+OFFHOST_RESERVE_INODES,'custody-capacity','Independent custody/restore capacity refused: '+json.dumps(pool,sort_keys=True))
    return dict(ok=True,model='uncompressed-full-custody-and-independent-restore-v1',allocation=model,filesystems=list(pools.values()),reserveBytes=OFFHOST_RESERVE_BYTES,reserveInodes=OFFHOST_RESERVE_INODES)


def read_exact(stream,size,deadline,*,allow_eof=False):
    parts=[];count=0
    while count<size:
        require(time.monotonic()<deadline,'batch-timeout','Custody stream deadline exceeded')
        try:fd=stream.fileno()
        except (AttributeError,OSError):fd=None
        if fd is not None:
            ready,_,_=select.select([fd],[],[],max(0,deadline-time.monotonic()))
            require(ready,'batch-timeout','Custody stream deadline exceeded')
            part=os.read(fd,min(size-count,BATCH_CHUNK))
        else:part=stream.read(min(size-count,BATCH_CHUNK))
        if not part:
            require(allow_eof and not count,'batch-stream','Interrupted or truncated custody batch');return b''
        parts.append(part);count+=len(part)
    return b''.join(parts)


def read_batch_frame(stream,deadline):
    header=read_exact(stream,5,deadline);kind=header[:1];size=struct.unpack('>I',header[1:])[0]
    require(kind in (b'J',b'D') and 0<size<=(BATCH_JSON if kind==b'J' else BATCH_CHUNK),'batch-stream','Invalid or oversized custody frame')
    raw=read_exact(stream,size,deadline)
    if kind==b'J':
        value=json.loads(raw);require(isinstance(value,dict) and encoded(value)==raw,'batch-stream','Noncanonical custody event');return kind,value
    return kind,raw


def receive_batch(stream,plan,custody,deadline,capacity_check=None):
    """Stream directly to exclusive files; the caller seals only after exit zero."""
    rows=batch_rows(plan);plan_sha=E.digest(encoded(plan));results=[];total=0
    require(read_exact(stream,len(BATCH_MAGIC),deadline)==BATCH_MAGIC,'batch-stream','Wrong custody batch protocol')
    kind,start=read_batch_frame(stream,deadline)
    require(kind==b'J' and start==dict(type='batch-start',planSha256=plan_sha,count=len(rows)),'batch-stream','Wrong custody batch scope/order')
    for index,row in enumerate(rows):
        kind,event=read_batch_frame(stream,deadline)
        require(kind==b'J' and event==dict(type='object-start',index=index,path=row['path']),'batch-stream','Unexpected custody object or ordering')
        if capacity_check:capacity_check(index)
        key=hashlib.sha256(row['path'].encode()).hexdigest()[:16];archive=Path(custody)/(key+'.tgz');h=hashlib.sha256();count=0
        with archive.open('xb') as output:
            while True:
                kind,value=read_batch_frame(stream,deadline)
                if kind==b'J':break
                count+=len(value);total+=len(value)
                require(count<=E.MAX_ROOT_BYTES and total<=BATCH_BYTES,'batch-stream','Custody archive byte bound exceeded')
                h.update(value);write_all(output,value)
            output.flush();os.fsync(output.fileno())
        require(value.get('type')=='object-complete' and value.get('index')==index and value.get('path')==row['path'],'batch-stream','Custody object completion differs')
        proof=value.get('proof',{});wanted=row['inventory']['fingerprint']
        require(set(value)=={'type','index','path','proof'} and proof.get('fingerprint')==wanted and proof.get('inventorySha256')==E.inventory_sha(row['inventory']['records']) and proof.get('archiveBytes')==count and proof.get('archiveSha256')==h.hexdigest(),'batch-stream','Streamed custody proof differs')
        result=dict(index=index,path=row['path'],proof=proof);results.append(result)
        save(Path(custody)/(key+'.stderr'),proof)
    kind,seal=read_batch_frame(stream,deadline)
    expected_seal=dict(type='batch-complete',schema='pow-ui-custody-export-batch-v1',planSha256=plan_sha,count=len(rows),objects=results,
                       objectManifestSha256=E.digest(encoded(results)),entryAndFinalProtectedVerification=True,continuousDeploymentLock=True)
    require(kind==b'J' and seal==expected_seal,'batch-stream','Missing or mismatched final custody batch seal')
    require(read_exact(stream,1,deadline,allow_eof=True)==b'','batch-stream','Trailing bytes after custody batch seal')
    return seal


def export_batch(plan,custody,restore):
    rows=batch_rows(plan);plan_sha=E.digest(encoded(plan));deadline=time.monotonic()+BATCH_SECONDS
    save(custody/'batch-intent.json',dict(schema='pow-ui-custody-export-batch-intent-v1',planSha256=plan_sha,paths=[r['path'] for r in rows],
         interruptionRequiresExplicitReconciliation=True,maximumSeconds=BATCH_SECONDS))
    unit='proofofwork-ui-custody-export-'+plan_sha[:12]+'-'+uuid.uuid4().hex[:12]+'.service'
    command=['systemd-run','--unit='+unit,'--service-type=exec','--wait','--pipe','--collect',
             '--property=User=root','--property=Group=root','--property=KillMode=control-group',
             '--property=RuntimeMaxSec=90min','--property=TimeoutStopSec=30s','--property=CPUQuota=50%',
             '--property=MemoryMax=2G','--property=MemorySwapMax=0','--property=TasksMax=128','--property=UMask=0077',
             '--property=Nice=15','ionice','-c','3','python3','-I','-B','-']
    payload=launcher('export-batch',dict(plan=plan,planSha256=plan_sha));process=None;sender=None;errors=[]
    try:
        with (custody/'batch-stderr.log').open('xb') as stderr:
            process=subprocess.Popen([*SSH[:-1],'-o','ConnectTimeout=15',SSH[-1],shlex.join(command)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr)
            def send():
                try:write_all(process.stdin,payload);process.stdin.close()
                except BaseException as error:errors.append(error)
            sender=threading.Thread(target=send,daemon=True);sender.start()
            seal=receive_batch(process.stdout,plan,custody,deadline,
                lambda index:check_custody_capacity(rows[index:],custody,restore))
            require(process.wait(timeout=max(0.01,deadline-time.monotonic()))==0,'batch-process','Custody exporter did not exit successfully')
            sender.join(timeout=1);require(not sender.is_alive() and not errors,'batch-process','Custody batch request was interrupted')
            stderr.flush();os.fsync(stderr.fileno())
        save(custody/'batch-exported.json',seal)
        return seal
    except BaseException as error:
        if process is not None and process.poll() is None:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
        if sender is not None:sender.join(timeout=1)
        save(custody/'batch-failure.json',dict(error=str(error)[:2000],remoteUnit=unit,manualReconciliationRequired=True))
        raise
    finally:
        if process is not None:
            if process.stdin and not process.stdin.closed:process.stdin.close()
            if process.stdout:process.stdout.close()


def preserve(plan_path, custody, resume=False):
    plan = json.loads(plan_path.read_bytes());rows=batch_rows(plan)
    restore = Path('/tmp')/('pow-ui-custody-restore-'+hashlib.sha256(str(custody).encode()).hexdigest()[:16])
    require(not (custody/'batch-intent.json').exists(),'batch-partial','Existing custody batch requires explicit reconciliation; no automatic resume')
    capacity=check_custody_capacity(rows,custody.parent,restore.parent)
    custody.mkdir(mode=0o700, exist_ok=resume)
    restore.mkdir(mode=0o700, exist_ok=resume)
    save(custody/('capacity-'+uuid.uuid4().hex+'.json'),capacity)
    # Legacy explicit resume retains its prior per-object semantics only when
    # every selected object is already complete. It never reopens a new batch.
    if resume:
        require(all((custody/(hashlib.sha256(r['path'].encode()).hexdigest()[:16]+'.json')).is_file() for r in rows),'batch-partial','Partial preservation requires explicit reconciliation')
    else:
        export_batch(plan,custody,restore)
    batch_path=custody/'batch-exported.json'
    for index, row in enumerate(rows):
        check_custody_capacity(rows[index:],custody,restore,archives_existing=True)
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
        exported = json.loads(errors.read_text()); assert digest(archive)==exported['archiveSha256'] and exported['inventorySha256']==E.inventory_sha(row['inventory']['records'])
        inventory_path=custody/(key+'.inventory.json');save(inventory_path,expected(row))
        check_custody_capacity(rows[index:],custody,restore,archives_existing=True)
        result=restored_check(archive,inventory_path,restore/key,fresh=True)
        save(custody/(key+'.restore-log.json'),{'exitCode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        result.check_returncode()
        restored=json.loads(result.stdout)
        record={'ok':True,'sourcePath':row['path'],'archivePath':str(archive),'archiveSha256':digest(archive),
                'inventorySha256':E.inventory_sha(row['inventory']['records']),'sourceInventory':expected(row),'restoration':restored,'planSha256':digest(plan_path)}
        record['batchExport']=dict(path=str(batch_path),sha256=digest(batch_path),index=index)
        save(custody/(key+'.json'),record);print(json.dumps({'preserved':row['path'],'bytes':archive.stat().st_size}),flush=True)


def retirement_request(frame,attempt,*,timeout=900,expected_sources=None):
    """One invocation with durable bounded diagnostics; an existing attempt refuses."""
    attempt=Path(attempt)
    require(not os.path.lexists(attempt),'retirement-attempt','Prior retirement attempt exists; reconcile explicitly, never retry blindly')
    pins=launcher_source_pins()
    require(expected_sources is None or sorted(expected_sources,key=lambda item:item['path'])==pins,'implementation-drift','Retirement implementation differs from reviewed source pins')
    payload=launcher('retire',frame,expected_sources=pins)
    attempt.mkdir(mode=0o700);W.sync_directory(attempt.parent)
    remote_receipt=str(BASE/'cleanup-evidence'/('bounded-retention-'+frame['operationId']))
    request=dict(schema='pow-ui-custody-retirement-request-v1',operationId=frame['operationId'],sourcePath=frame['row']['path'],
        frameSha256=hashlib.sha256(encoded(frame)).hexdigest(),frameBytes=len(encoded(frame)),
        launcherSha256=hashlib.sha256(payload).hexdigest(),launcherBytes=len(payload),implementationSources=pins,
        planSha256=frame['custody']['planSha256'],custodySha256=hashlib.sha256(encoded(frame['custody'])).hexdigest(),
        expectedRemoteReceipt=remote_receipt,timeoutSeconds=timeout,stdoutLimitBytes=RETIREMENT_STDOUT_BYTES,stderrLimitBytes=RETIREMENT_STDERR_BYTES,
        startedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
    save(attempt/'request.json',request)
    logs={};process=None;failure=None;timed_out=False;sent=0;value=None;readers={};stream_names={};started=False
    deadline=time.monotonic()+timeout
    def capture(fd):
        data=os.read(fd,65536)
        if not data:
            readers.pop(fd).close();return
        name=stream_names[fd]
        info=logs[name];info['observedBytes']+=len(data)
        keep=data[:max(0,info['limit']-info['storedBytes'])]
        if keep:
            write_all(info['file'],keep);info['storedBytes']+=len(keep)
            info['file'].flush();os.fsync(info['file'].fileno())
        if len(keep)!=len(data):
            info['truncated']=True
            raise QualificationError('retirement-output','Retirement '+name+' exceeds its diagnostic limit')
    try:
        for name,limit in [('stdout',RETIREMENT_STDOUT_BYTES),('stderr',RETIREMENT_STDERR_BYTES)]:
            logs[name]=dict(file=(attempt/(name+'.log')).open('xb'),limit=limit,storedBytes=0,observedBytes=0,truncated=False)
        process=subprocess.Popen([*SSH,'nice -n 15 ionice -c 3 python3 -I -B -'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        started=True
        for stream in (process.stdin,process.stdout,process.stderr):os.set_blocking(stream.fileno(),False)
        readers={process.stdout.fileno():process.stdout,process.stderr.fileno():process.stderr}
        stream_names={process.stdout.fileno():'stdout',process.stderr.fileno():'stderr'}
        while readers or process.poll() is None:
            remaining=deadline-time.monotonic()
            if remaining<=0:
                timed_out=True;raise QualificationError('retirement-timeout','Retirement command timed out; remote outcome requires reconciliation')
            writers=[process.stdin.fileno()] if not process.stdin.closed else []
            ready,writable,_=select.select(list(readers),writers,[],min(0.25,remaining))
            if writable:
                try:sent+=os.write(process.stdin.fileno(),payload[sent:sent+65536])
                except BrokenPipeError:process.stdin.close()
                if sent==len(payload) and not process.stdin.closed:process.stdin.close()
            for fd in ready:capture(fd)
        code=process.wait(timeout=max(0.01,deadline-time.monotonic()))
        require(code==0,'retirement-process','Retirement command exited with code '+str(code))
        require(sent==len(payload),'retirement-process','Retirement request was not fully written')
        for info in logs.values():info['file'].flush()
        value=json.loads((attempt/'stdout.log').read_bytes())
        require(isinstance(value,dict) and value.get('ok') is True and value.get('path')==frame['row']['path'] and value.get('receipt')==remote_receipt,
                'retirement-response','Retirement response does not bind the requested source and receipt')
    except BaseException as error:
        failure=error
    finally:
        if process is not None and process.poll() is None:
            try:
                try:process.terminate()
                except ProcessLookupError:pass
                try:process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:process.kill()
                    except ProcessLookupError:pass
                    process.wait(timeout=2)
            except BaseException as error:
                failure=failure or error
        # Preserve buffered refusal/traceback bytes even when timeout or an
        # output limit caused termination. No remote outcome is inferred.
        drain_deadline=time.monotonic()+2
        while readers and time.monotonic()<drain_deadline:
            ready,_,_=select.select(list(readers),[],[],0.05)
            if not ready:continue
            for fd in ready:
                try:capture(fd)
                except QualificationError:pass
                except (OSError,ValueError) as error:
                    failure=failure or error
                    stream=readers.pop(fd,None)
                    if stream is not None:stream.close()
        if process is not None:
            for stream in (process.stdin,process.stdout,process.stderr):
                if not stream.closed:stream.close()
        for info in logs.values():
            info['file'].flush();os.fsync(info['file'].fileno());info['file'].close()
    streams={name:dict(path=str(attempt/(name+'.log')),sha256=digest(attempt/(name+'.log')),
        bytes=info['storedBytes'],observedBytes=info['observedBytes'],truncated=info['truncated']) for name,info in logs.items()}
    outcome=dict(schema='pow-ui-custody-retirement-outcome-v1',request=dict(path=str(attempt/'request.json'),sha256=digest(attempt/'request.json')),
        operationId=frame['operationId'],started=started,exitCode=process.returncode if process is not None else None,timedOut=timed_out,
        requestBytesWritten=sent,requestFullyWritten=sent==len(payload),commandSucceeded=failure is None,
        responseValidated=value is not None and failure is None,failure=bounded_error(failure) if failure is not None else None,
        manualReconciliationRequired=started and failure is not None,streams=streams,finishedAtUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))
    save(attempt/'outcome.json',outcome)
    if failure is not None:
        raise QualificationError('retirement-failed','Retirement stopped; inspect '+str(attempt/'outcome.json')) from failure
    return value


def retire(plan_path,custody,output,*,expected_sources=None):
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
        value=retirement_request(frame,Path(str(output)+'.'+key+'.attempt'),expected_sources=expected_sources)
        completed.append(value);save(Path(str(output)+'.'+key+'.json'),value)
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
