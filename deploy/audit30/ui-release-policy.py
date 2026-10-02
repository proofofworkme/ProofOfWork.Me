#!/usr/bin/python3 -I
"""Opt-in approved current/one-verified-prior policy; ordinary prune masks stay.

Explicit immutable bootstrap/release admissions authorize only named ordinary
roots/archives/sidecars. Sources, inputs, transport evidence and historical
individually held objects never enter the lifecycle. No age-only discovery.
Run admission after verified publication, then review the exact plan before apply.
"""
import argparse
import datetime
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import sys

def load_storage():
    p=Path(__file__).resolve().with_name('ui-storage.py')
    s=p.lstat()
    if s.st_uid!=os.geteuid() or s.st_mode & 0o7022:raise ValueError('Unsafe companion controller')
    loader=importlib.machinery.SourceFileLoader('audit30_ui_storage',str(p));spec=importlib.util.spec_from_loader(loader.name,loader);module=importlib.util.module_from_spec(spec);loader.exec_module(module);return module
S=load_storage()
BOOTSTRAP_IDS={'26500e4d2ff7-20261002T054938Z','835e30258d23-20261002T052338Z'}
# Approved historical writer versions remain admitted after later reviewed
# upgrades; adding another version needs an explicit source review. No future
# retirement existed before this canonical plan-serialization contract.
KNOWN_RETIREMENT_CONTROLLERS={'f292da5dcda23393208d05e1cffaea0b50b9a9cc915b81a5b9d55fdd0aa81319'}

def print_plan(plan):
    """The exact approved stdout bytes must hash like the embedded plan object."""
    sys.stdout.buffer.write(S.encoded(plan));sys.stdout.buffer.flush()

def logical(fp):
    return S.digest([{k:r[k] for k in ('path','kind','mode','uid','gid','sha256','target','xattrs') if k in r} for r in fp['entries']])

def admission(layout,approval_sha,bootstrap=False,index=None):
    cache={};pair=S.protected_pair(layout,cache);guards,review=S.safeguards(layout)
    ids={pair[k]['fields']['release_id'] for k in ('current','previous')}
    if bootstrap:
        if ids!=BOOTSTRAP_IDS or pair['current']['fields']['release_id']!='26500e4d2ff7-20261002T054938Z':raise ValueError('Bootstrap pair changed; review required')
    else:
        if not index:raise ValueError('Prior admissions required for new release')
        previous=pair['previous']['fields']['release_id']
        covered=load_index(index['path'],index['sha256'],layout,approval_sha)['releaseIds']
        if previous not in covered:raise ValueError('Prior release lacks lifecycle admission')
        if pair['current']['fields']['release_id'] in covered:raise ValueError('Release already admitted')
    roots=[pair['previous']]
    archives=list(cache.values()) if bootstrap else [cache[str(layout.archives/pair['current']['fields']['archive_name'])]]
    paths=[r['path'] for r in roots]+[r['path'] for r in archives]+[x['path'] for r in archives for x in r['sidecars']]
    S.held_boundary(paths,review,layout)
    # Protected roots/sources are verified completely; only ordinary assets become eligible.
    return dict(schema='pow-audit30-ordinary-ui-release-admission-v1',host='77.42.91.106',atUtc=S.utc(),scopeApprovalSha256=approval_sha,bootstrap=bootstrap,releaseIds=sorted(ids if bootstrap else {pair['current']['fields']['release_id']}),roots=[dict(path=r['path'],fields=r['fields'],logicalSha256=logical(r['snapshot']),snapshot=r['snapshot']) for r in roots],archives=archives,retainedPair=dict(current=pair['current']['fields']['release_id'],previous=pair['previous']['fields']['release_id']),guards=guards,exclusions='Every source/input/transport/evidence object and individually held historical child; parents and generic hold/masks remain retained.',capacityHelperSha256=S.hash_read(layout.capacity,1024**2)[0])

def load_index(path,expected,layout,approval_sha):
    index,h=S.read_json(Path(path),expected)
    if index.get('schema')!='pow-audit30-ui-admission-index-v1' or index.get('scopeApprovalSha256')!=approval_sha:raise ValueError('Wrong admission index')
    rows=index.get('admissions',[])
    if not rows or len(rows)>256 or len({r['path'] for r in rows})!=len(rows):raise ValueError('Empty, duplicate or oversized admission index')
    admissions=[];release_ids=set();bootstrap_count=0;roots={};assets={}
    approval_time=datetime.datetime.fromisoformat('2026-10-02T19:21:02.541787+00:00')
    for row in rows:
        p=Path(row['path'])
        if p.parent!=layout.evidence or not p.name.startswith('audit30-policy-admission-'):raise ValueError('Admission must be immutable policy evidence')
        a,_=S.read_json(p,row['sha256'])
        if a.get('schema')!='pow-audit30-ordinary-ui-release-admission-v1' or a.get('host')!='77.42.91.106' or a.get('scopeApprovalSha256')!=approval_sha:raise ValueError('Admission authority differs')
        if a.get('bootstrap') is True:
            bootstrap_count+=1
            if set(a['releaseIds'])!=BOOTSTRAP_IDS or a['retainedPair']!=dict(current='26500e4d2ff7-20261002T054938Z',previous='835e30258d23-20261002T052338Z'):raise ValueError('Expanded bootstrap assets')
        else:
            if len(a['releaseIds'])!=1:raise ValueError('Ordinary admission has wrong release count')
            if a['retainedPair']['current']!=a['releaseIds'][0] or a['retainedPair']['previous'] not in release_ids:raise ValueError('Broken admitted release chain')
            for rid in a['releaseIds']:
                if not S.RELEASE_ID.fullmatch(rid) or datetime.datetime.strptime(rid.split('-')[1],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)<approval_time:raise ValueError('Historical release cannot be dynamically admitted')
        release_ids.update(a['releaseIds'])
        if len(a['roots'])!=1 or len(a['archives'])!=(2 if a['bootstrap'] else 1):raise ValueError('Partial or expanded ordinary admission')
        for r in a['roots']:
            q=Path(r['path']); suffix=q.name.removeprefix('proofofwork-www-pre-')
            if q.parent!=layout.roots or not q.name.startswith('proofofwork-www-pre-') or not S.RELEASE_ID.fullmatch(suffix):raise ValueError('Nonordinary rollback path')
            if suffix!=a['retainedPair']['current']:raise ValueError('Rollback was not introduced by the admitted release')
            if r['fields']['release_id']!=a['retainedPair']['previous'] or r['snapshot']['path']!=str(q) or S.digest(r['snapshot']['entries'])!=r['snapshot']['sha256'] or logical(r['snapshot'])!=r['logicalSha256']:raise ValueError('Rollback admission binding differs')
            if str(q) in roots:raise ValueError('Duplicate rollback admission')
            roots[str(q)]=r
        allowed=set(a['releaseIds'])
        archive_ids=set()
        for r in a['archives']:
            q=Path(r['path']);rid=q.name.removeprefix('proofofwork-ui-release-').removesuffix('.tgz')
            if q.parent!=layout.archives or rid not in allowed or q.name!='proofofwork-ui-release-'+rid+'.tgz':raise ValueError('Nonordinary archive admission')
            archive_ids.add(rid)
            objects=[r['snapshot'],*r['sidecars']]
            if [x['path'] for x in objects]!=[str(q)+z for z in ('','.sha256','.provenance')]:raise ValueError('Partial archive admission')
            for fp in objects:
                if S.digest(fp['entries'])!=fp['sha256']:raise ValueError('Malformed asset fingerprint')
                if fp['path'] in assets:raise ValueError('Duplicate archive admission')
                assets[fp['path']]=fp
        if archive_ids!=allowed:raise ValueError('Incomplete archive release coverage')
        admissions.append(a)
    if bootstrap_count!=1:raise ValueError('Exactly one immutable bootstrap admission required')
    _,review=S.safeguards(layout);S.held_boundary(list(roots)+list(assets),review,layout)
    retired=set();retirements=index.get('completedRetirements',[])
    if not isinstance(retirements,list) or len(retirements)>256 or len({r['path'] for r in retirements})!=len(retirements):raise ValueError('Duplicate or oversized retirement history')
    for position,row in enumerate(retirements):
        p=Path(row['path'])
        if p.parent!=layout.evidence:raise ValueError('Retirement receipt outside durable evidence')
        done,_=S.read_json(p,row['sha256'])
        if done.get('schema')!='pow-audit30-ui-storage-progress-v1' or done.get('status')!='completed' or done.get('holdsAndMasksUnchanged') is not True or done.get('phase')!='final-verification' or done.get('guardBaseline')!='original-plan' or done.get('reconciliation') is not None or 'errorClass' not in done or done['errorClass'] is not None:raise ValueError('Unfenced or partial/failed future retirement needs manual reconciliation')
        intent_path=Path(done['intentPath'])
        if intent_path.parent!=layout.evidence:raise ValueError('Retirement intent outside durable evidence')
        intent,_=S.read_json(intent_path,done['intentSha256']);plan=intent.get('plan',{})
        if intent.get('schema')!='pow-audit30-ui-storage-intent-v1' or intent.get('status')!='approved-intent':raise ValueError('Wrong future retirement intent authority')
        S.validate_plan(plan,layout,'future-retention',approval_sha)
        canonical=S.digest(plan)
        if done.get('missingHeldPaths')!=plan['safeguards']['missingHeldPaths']:raise ValueError('Future retirement erased or changed held-path obligations')
        if 'reconciliation' in plan or plan.get('controllerSha256') not in KNOWN_RETIREMENT_CONTROLLERS or intent.get('planSha256')!=canonical or done.get('planSha256')!=canonical or done.get('guardBaselinePlanSha256')!=canonical:raise ValueError('Future retirement embedded plan digest/version/baseline differs')
        source=plan['policyScope'].get('admissionIndex',{});source_path=Path(source.get('path',''))
        if source_path.parent!=layout.evidence or not S.SHA.fullmatch(source.get('sha256','')):raise ValueError('Retirement source admission index outside durable authority')
        source_index,_=S.read_json(source_path,source['sha256']);source_rows=source_index.get('admissions',[])
        if source_index.get('schema')!='pow-audit30-ui-admission-index-v1' or source_index.get('scopeApprovalSha256')!=approval_sha or not source_rows or len(source_rows)>len(rows) or source_rows!=rows[:len(source_rows)] or source_index.get('completedRetirements',[])!=retirements[:position]:raise ValueError('Retirement admission-index lineage differs')
        source_admissions=admissions[:len(source_rows)];pair=dict(current=plan['protected']['current']['fields']['release_id'],previous=plan['protected']['previous']['fields']['release_id'])
        if source_admissions[-1]['retainedPair']!=pair:raise ValueError('Retirement plan uses a stale admitted current/prior pair')
        if any(plan['protected'][k]['fields']['archive_name']!='proofofwork-ui-release-'+pair[k]+'.tgz' for k in ('current','previous')):raise ValueError('Retained current/prior archive name differs from admitted release identity')
        source_roots={r['path']:r for a in source_admissions for r in a['roots']};source_assets={fp['path']:fp for a in source_admissions for r in a['archives'] for fp in [r['snapshot'],*r['sidecars']]}
        keep={plan['protected'][k]['path'] for k in ('current','previous')}|{str(layout.archives/('proofofwork-ui-release-'+pair[k]+'.tgz'))+suffix for k in ('current','previous') for suffix in ('','.sha256','.provenance')}
        eligible=[dict(path=path,kind='rollback-root') for path in source_roots if path not in keep and path not in retired]+[dict(path=path,kind='managed-release-archive' if path.endswith('.tgz') else 'archive-sidecar') for path in source_assets if path not in keep and path not in retired]
        eligible.sort(key=lambda r:(r['kind']!='rollback-root',r['path']))
        if plan['policyScope'].get('eligible')!=eligible:raise ValueError('Retirement plan scope does not derive from admitted ordinary assets')
        wanted={r['path'] for r in plan['delete']};removed=done.get('completed',[])
        if not isinstance(removed,list) or len(removed)!=len(plan['delete']) or any(r.get('path')!=frozen['path'] or r.get('outcome')!='retired' or r.get('snapshotSha256')!=frozen['snapshot']['sha256'] for r,frozen in zip(removed,plan['delete'])) or done.get('currentPath')!=(plan['delete'][-1]['path'] if plan['delete'] else None):raise ValueError('Incomplete, reordered or unbound retirement outcomes')
        for frozen in plan['delete']:
            if frozen['kind']=='rollback-root':
                admitted=source_roots[frozen['path']]
                if frozen.get('release',{}).get('fields')!=admitted['fields'] or logical(frozen['snapshot'])!=admitted['logicalSha256']:raise ValueError('Retired rollback differs from its admission')
            elif frozen['snapshot']!=source_assets[frozen['path']]:raise ValueError('Retired archive asset differs from its admitted snapshot')
        retired.update(wanted)
    return dict(indexPath=str(path),indexSha256=h,admissions=admissions,releaseIds=release_ids,roots=roots,assets=assets,retired=retired)

def policy_scope(index,layout,approval_sha):
    data=load_index(index['path'],index['sha256'],layout,approval_sha);cache={};pair=S.protected_pair(layout,cache)
    if data['admissions'][-1]['retainedPair']!=dict(current=pair['current']['fields']['release_id'],previous=pair['previous']['fields']['release_id']):raise ValueError('Live current/prior pair requires its latest verified admission before retirement planning')
    keep={pair[k]['path'] for k in ('current','previous')}|{str(layout.archives/pair[k]['fields']['archive_name'])+s for k in ('current','previous') for s in ('','.sha256','.provenance')}
    eligible=[]
    for path,r in data['roots'].items():
        if not os.path.lexists(path):
            if path not in data['retired']:raise ValueError('Unreconciled missing admitted rollback')
            continue
        if path in data['retired']:raise ValueError('Retired rollback reappeared')
        if path in keep:continue
        actual=S.release_proof(Path(path),layout,cache)
        if actual['fields']!=r['fields'] or logical(actual['snapshot'])!=r['logicalSha256']:raise ValueError('Admitted rollback content changed')
        eligible.append(dict(path=path,kind='rollback-root'))
    for path,fp in data['assets'].items():
        if not os.path.lexists(path):
            if path not in data['retired']:raise ValueError('Unreconciled missing admitted archive asset')
            continue
        if path in data['retired']:raise ValueError('Retired archive asset reappeared')
        if path in keep:continue
        S.match_snapshot(S.snapshot(Path(path)),fp)
        eligible.append(dict(path=path,kind='managed-release-archive' if path.endswith('.tgz') else 'archive-sidecar'))
    eligible.sort(key=lambda r:(r['kind']!='rollback-root',r['path']))
    return dict(eligible=eligible,admissionIndex=dict(path=data['indexPath'],sha256=data['indexSha256']),policy='current-and-one-fully-verified-prior; only explicit admitted ordinary assets; traditional prune timers remain masked',excludedHistoricalAssetsNotDiscovered=True)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['admit-bootstrap','admit-release','plan','verify','apply'])
    p.add_argument('--approval',type=Path,required=True);p.add_argument('--approval-sha256',required=True);p.add_argument('--index',type=Path);p.add_argument('--index-sha256');p.add_argument('--record',action='store_true');p.add_argument('--plan',type=Path);p.add_argument('--plan-sha256')
    p.add_argument('--citation-review',type=Path);p.add_argument('--citation-review-sha256')
    a=p.parse_args()
    if os.geteuid()!=0:raise ValueError('Production policy requires root')
    layout=S.Layout();fd=S.lock(layout);os.nice(15)
    try:
        if bool(a.citation_review)!=bool(a.citation_review_sha256) or a.citation_review and a.command!='plan':raise ValueError('Citation path/SHA pair is admitted only by a policy plan')
        S.approval(a.approval,a.approval_sha256,a.command if a.command.startswith('admit-') else 'future-retention')
        index=dict(path=str(a.index),sha256=a.index_sha256) if a.index and a.index_sha256 else None
        if a.command.startswith('admit-'):
            out=admission(layout,a.approval_sha256,a.command=='admit-bootstrap',index)
            if not a.record:print(json.dumps(out,sort_keys=True));return
            S.safe(layout.evidence,True);S.capacity(layout,'audit30-policy-admission',max(8*1024**2,len(S.encoded(out))*2))
            stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');target=layout.evidence/('audit30-policy-admission-'+stamp+'.json');S.durable(target,out)
            print(json.dumps(dict(status='admitted',path=str(target),sha256=S.hash_read(target,S.MAX_JSON)[0],ordinaryPruneMasksUnchanged=True)));return
        if not index:raise ValueError('Exact admission index SHA required')
        scope=policy_scope(index,layout,a.approval_sha256)
        if a.command=='plan':
            citation=dict(path=str(a.citation_review),sha256=a.citation_review_sha256) if a.citation_review else None
            print_plan(S.create_plan(layout,'future-retention',a.approval_sha256,scope,citation_review=citation));return
        if not a.plan or not a.plan_sha256:raise ValueError('Exact future plan SHA required')
        plan,h=S.read_json(a.plan,a.plan_sha256);S.validate_plan(plan,layout,'future-retention',a.approval_sha256)
        if h!=S.digest(plan):raise ValueError('Future plan must use exact canonical policy stdout bytes')
        if plan['policyScope']!=scope:raise ValueError('Fresh eligible per-release scope changed')
        print(json.dumps(S.execute(plan,h,layout,a.command=='apply'),sort_keys=True))
    finally:os.close(fd)

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,S.subprocess.SubprocessError,S.tarfile.TarError) as error:
        print(json.dumps(dict(status='refused',errorClass=type(error).__name__,error=str(error))),file=sys.stderr);raise SystemExit(1)
