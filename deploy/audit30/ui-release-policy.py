#!/usr/bin/python3 -I
"""Opt-in approved current/one-verified-prior policy; ordinary prune masks stay.

Explicit immutable bootstrap/release admissions authorize only named ordinary
roots/archives/sidecars. Sources, inputs, transport evidence and historical
individually held objects never enter the lifecycle. No age-only discovery.
Run admission after verified publication, then review the exact plan before apply.
"""
import argparse
import base64
import datetime
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import stat
from pathlib import Path
import sys

def load_storage():
    if globals().get('_BOUND_STORAGE') is not None:return globals()['_BOUND_STORAGE']
    p=Path(__file__).resolve().with_name('ui-storage.py')
    s=p.lstat()
    if s.st_uid!=os.geteuid() or s.st_mode & 0o7022:raise ValueError('Unsafe companion controller')
    loader=importlib.machinery.SourceFileLoader('audit30_ui_storage',str(p));spec=importlib.util.spec_from_loader(loader.name,loader);module=importlib.util.module_from_spec(spec);loader.exec_module(module);return module
S=load_storage()
BOOTSTRAP_IDS={'26500e4d2ff7-20261002T054938Z','835e30258d23-20261002T052338Z'}
# Approved historical writer versions remain admitted after later reviewed
# upgrades; adding another version needs an explicit source review. No future
# retirement existed before this canonical plan-serialization contract.
KNOWN_RETIREMENT_CONTROLLERS={'f292da5dcda23393208d05e1cffaea0b50b9a9cc915b81a5b9d55fdd0aa81319',
                            '35ba28d173941aadaa29c6c43dc792822d5589a11370c5ff43cc7947ee0353f4',
                            'ef7fdf48ee628c8e4cf5e13cbb193cb40892d80424d2a286b9c6d1b37d04cf1e',
                            '095ec62c1bc8fc3756e203560fdc3482c94e4f96ba854d48524cb09687079011'}
INDEX_V1 = 'pow-audit30-ui-admission-index-v1'
INDEX_V2 = 'pow-ui-retention-admission-index-v2'
MIGRATION_SCHEMA = 'pow-ui-retention-lineage-migration-v1'
REVIEW_SCHEMA = 'pow-ui-retention-migration-review-v1'

def print_plan(plan):
    """The exact approved stdout bytes must hash like the embedded plan object."""
    sys.stdout.buffer.write(S.encoded(plan));sys.stdout.buffer.flush()

def logical(fp):
    return S.digest([{k:r[k] for k in ('path','kind','mode','uid','gid','sha256','target','xattrs') if k in r} for r in fp['entries']])

def root_record(proof):
    return dict(path=proof['path'],fields=proof['fields'],logicalSha256=logical(proof['snapshot']),snapshot=proof['snapshot'])

def pair_ids(pair):
    return {key:pair[key]['fields']['release_id'] for key in ('current','previous')}

def protected_paths(pair):
    return [pair[key]['path'] for key in ('current','previous')] + [r['path'] for r in pair['sources']]

def evidence_binding(binding, layout, prefix=None):
    if not isinstance(binding,dict) or set(binding)!= {'path','sha256'} or not S.SHA.fullmatch(binding.get('sha256','')):
        raise ValueError('Invalid immutable evidence binding')
    p=Path(binding['path'])
    if p.parent!=layout.evidence or prefix and not p.name.startswith(prefix):raise ValueError('Evidence outside immutable policy namespace')
    return S.read_json(p,binding['sha256'])[0]

def historical_census(data):
    rows=[]
    for path,record in sorted({**data['roots'],**data['assets']}.items()):
        fp=record['snapshot'] if path in data['roots'] else record
        exists=os.path.lexists(path)
        if path in data['retired']:
            if exists:raise ValueError('Retired historical object reappeared before migration')
            row=dict(path=path,status='completed-prior-retirement',admittedSnapshotSha256=fp['sha256'])
        elif exists:
            actual=S.snapshot(Path(path))
            row=dict(path=path,status='present-historical-object',admittedSnapshotSha256=fp['sha256'],observed=actual)
        else:
            row=dict(path=path,status='unresolved-missing-historical-object',admittedSnapshotSha256=fp['sha256'])
        rows.append(row)
    return rows

def legacy_assets(layout, pair, cache, paths):
    if (not isinstance(paths,list) or len(paths)>256 or any(set(row)!= {'path','kind'} for row in paths)
            or len({row['path'] for row in paths})!=len(paths)
            or paths!=sorted(paths,key=lambda r:(r['kind']!='rollback-root',r['path']))):
        raise ValueError('Legacy ordinary paths must be exact, unique and canonically ordered')
    keep=set(protected_paths(pair))|{str(layout.archives/pair[k]['fields']['archive_name'])+suffix for k in ('current','previous') for suffix in ('','.sha256','.provenance')}
    roots=[];archives=[];selected={r['path']:r['kind'] for r in paths}
    _,review=S.safeguards(layout);S.held_boundary(list(selected),review,layout)
    for row in paths:
        p=Path(row['path']);kind=row['kind']
        if str(p) in keep:raise ValueError('Migration selected a protected current/prior dependency')
        if kind=='rollback-root':
            if p.parent!=layout.roots or not p.name.startswith('proofofwork-www-pre-') or not S.RELEASE_ID.fullmatch(p.name.removeprefix('proofofwork-www-pre-')):
                raise ValueError('Nonordinary legacy rollback path')
            proof=S.release_proof(p,layout,cache)
            if proof['passthroughSha256'] not in {pair[k]['passthroughSha256'] for k in ('current','previous')}:
                raise ValueError('Legacy rollback contains unique non-release content')
            roots.append(root_record(proof))
        elif kind in ('managed-release-archive','archive-sidecar'):
            name=p.name
            if kind=='archive-sidecar':
                if name.endswith('.sha256'):name=name[:-7]
                elif name.endswith('.provenance'):name=name[:-11]
                else:raise ValueError('Nonordinary legacy archive sidecar')
            rid=name.removeprefix('proofofwork-ui-release-').removesuffix('.tgz')
            if p.parent!=layout.archives or not S.RELEASE_ID.fullmatch(rid) or name!='proofofwork-ui-release-'+rid+'.tgz':
                raise ValueError('Nonordinary legacy archive path')
            archive=layout.archives/name
            if any(selected.get(str(archive)+suffix)!=expected for suffix,expected in (('','managed-release-archive'),('.sha256','archive-sidecar'),('.provenance','archive-sidecar'))):
                raise ValueError('Legacy archive group is incomplete')
            if kind=='managed-release-archive':
                proof=cache.get(str(archive)) or S.standalone_archive_proof(archive)
                cache[str(archive)]=proof;archives.append(proof)
        else:raise ValueError('Legacy migration cannot admit nonordinary evidence')
    return dict(roots=roots,archives=archives)

def migration_review(layout,approval_sha,prior_index,legacy_paths):
    if approval_sha!=S.REPAIR_APPROVAL_SHA:raise ValueError('Migration requires exact repair authority')
    prior=evidence_binding(prior_index,layout)
    if prior.get('schema')!=INDEX_V1 or prior.get('scopeApprovalSha256')!=S.APPROVAL_SHA:
        raise ValueError('Migration requires the original immutable ordinary lineage')
    data=load_index(prior_index['path'],prior_index['sha256'],layout,S.APPROVAL_SHA)
    cache={};pair=S.protected_pair(layout,cache);guards,_=S.safeguards(layout)
    assets=legacy_assets(layout,pair,cache,legacy_paths)
    return dict(schema=REVIEW_SCHEMA,host='77.42.91.106',scopeApprovalSha256=approval_sha,
        priorIndex=prior_index,priorScopeApprovalSha256=S.APPROVAL_SHA,protected=pair,retainedPair=pair_ids(pair),
        protectedArchives=[cache[str(layout.archives/pair[k]['fields']['archive_name'])] for k in ('current','previous')],
        legacyOrdinaryPaths=legacy_paths,legacyOrdinaryAssets=assets,historicalAssetCensus=historical_census(data),
        guards=guards,controllerSha256=S.hash_read(Path(S.__file__).resolve(),1024**2)[0],
        policySha256=S.hash_read(Path(__file__).resolve(),1024**2)[0],capacityHelperSha256=S.hash_read(layout.capacity,1024**2)[0],
        noHistoricalAdmissionsFabricated=True,historicalObligationsRetained=True)

def migration_admission(layout,approval_sha,review_binding):
    review=evidence_binding(review_binding,layout,'audit30-policy-migration-review-')
    if review.get('schema')!=REVIEW_SCHEMA or review.get('scopeApprovalSha256')!=approval_sha:
        raise ValueError('Wrong exact migration review authority')
    actual=migration_review(layout,approval_sha,review['priorIndex'],review['legacyOrdinaryPaths'])
    if review!=actual:raise ValueError('Migration proof changed after exact review')
    pair=review['protected'];ids=pair_ids(pair)
    anchor=dict(schema='pow-audit30-ordinary-ui-release-admission-v1',host='77.42.91.106',atUtc=S.utc(),
        scopeApprovalSha256=approval_sha,bootstrap=False,migrationAnchor=True,releaseIds=sorted(ids.values()),
        roots=[root_record(pair['previous'])],archives=review['protectedArchives'],retainedPair=ids,
        guards=review['guards'],capacityHelperSha256=review['capacityHelperSha256'],
        exclusions='Historical gaps remain explicit; older assets are admitted only by the exact migration review, never by invented publication history.')
    return dict(schema=MIGRATION_SCHEMA,host='77.42.91.106',scopeApprovalSha256=approval_sha,
        review=review_binding,anchor=anchor,legacyOrdinaryAssets=review['legacyOrdinaryAssets'])

def load_migration(binding,layout,approval_sha):
    if approval_sha!=S.REPAIR_APPROVAL_SHA:raise ValueError('Wrong migration approval')
    migration=evidence_binding(binding,layout,'audit30-policy-migration-')
    if migration.get('schema')!=MIGRATION_SCHEMA or migration.get('host')!='77.42.91.106' or migration.get('scopeApprovalSha256')!=approval_sha:
        raise ValueError('Wrong immutable migration record')
    review=evidence_binding(migration['review'],layout,'audit30-policy-migration-review-')
    if (review.get('schema')!=REVIEW_SCHEMA or review.get('host')!='77.42.91.106' or review.get('scopeApprovalSha256')!=approval_sha
            or review.get('priorScopeApprovalSha256')!=S.APPROVAL_SHA or review.get('noHistoricalAdmissionsFabricated') is not True
            or review.get('historicalObligationsRetained') is not True or review.get('controllerSha256') not in KNOWN_RETIREMENT_CONTROLLERS):
        raise ValueError('Migration lost reviewed authority or historical obligations')
    prior=evidence_binding(review['priorIndex'],layout)
    if prior.get('schema')!=INDEX_V1:raise ValueError('Migration prior index cannot be replaced or recursive')
    data=load_index(review['priorIndex']['path'],review['priorIndex']['sha256'],layout,S.APPROVAL_SHA)
    expected={**data['roots'],**data['assets']};census=review['historicalAssetCensus']
    if [r['path'] for r in census]!=sorted(expected):raise ValueError('Migration omitted historical admitted objects')
    for row in census:
        fp=expected[row['path']]['snapshot'] if row['path'] in data['roots'] else expected[row['path']]
        if row['admittedSnapshotSha256']!=fp['sha256']:raise ValueError('Migration historical snapshot differs')
        if row['path'] in data['retired']:
            if row['status']!='completed-prior-retirement' or 'observed' in row:raise ValueError('Migration rewrote completed history')
        elif row['status']=='present-historical-object':
            observed=row.get('observed',{})
            if observed.get('path')!=row['path'] or S.digest(observed.get('entries'))!=observed.get('sha256'):raise ValueError('Invalid historical presence evidence')
        elif row['status']!='unresolved-missing-historical-object' or 'observed' in row:
            raise ValueError('Migration invented a historical retirement')
    pair=review['protected'];anchor=migration['anchor']
    if (anchor.get('migrationAnchor') is not True or anchor.get('bootstrap') is not False or anchor.get('retainedPair')!=pair_ids(pair)
            or review['retainedPair']!=pair_ids(pair) or anchor['roots']!=[root_record(pair['previous'])]
            or anchor['archives']!=review['protectedArchives'] or anchor['guards']!=review['guards']
            or anchor['capacityHelperSha256']!=review['capacityHelperSha256'] or migration['legacyOrdinaryAssets']!=review['legacyOrdinaryAssets']):
        raise ValueError('Migration anchor or legacy asset proof differs')
    assets=migration['legacyOrdinaryAssets'];actual=[dict(path=r['path'],kind='rollback-root') for r in assets['roots']]
    for archive in assets['archives']:
        actual.append(dict(path=archive['path'],kind='managed-release-archive'))
        actual.extend(dict(path=r['path'],kind='archive-sidecar') for r in archive['sidecars'])
    actual.sort(key=lambda r:(r['kind']!='rollback-root',r['path']))
    if actual!=review['legacyOrdinaryPaths']:raise ValueError('Migration expanded legacy ordinary scope')
    return migration,review

def admission(layout,approval_sha,bootstrap=False,index=None):
    cache={};pair=S.protected_pair(layout,cache);guards,review=S.safeguards(layout)
    ids={pair[k]['fields']['release_id'] for k in ('current','previous')}
    if bootstrap:
        if ids!=BOOTSTRAP_IDS or pair['current']['fields']['release_id']!='26500e4d2ff7-20261002T054938Z':raise ValueError('Bootstrap pair changed; review required')
    else:
        if not index:raise ValueError('Prior admissions required for new release')
        previous=pair['previous']['fields']['release_id']
        prior=load_index(index['path'],index['sha256'],layout,approval_sha);covered=prior['releaseIds']
        if previous not in covered:raise ValueError('Prior release lacks lifecycle admission')
        if prior['migration'] and previous!=prior['admissions'][-1]['retainedPair']['current']:
            raise ValueError('New release does not continue the latest admitted current release')
        if pair['current']['fields']['release_id'] in covered:raise ValueError('Release already admitted')
    roots=[pair['previous']]
    archives=list(cache.values()) if bootstrap else [cache[str(layout.archives/pair['current']['fields']['archive_name'])]]
    paths=[r['path'] for r in roots]+[r['path'] for r in archives]+[x['path'] for r in archives for x in r['sidecars']]
    S.held_boundary(paths,review,layout)
    # Protected roots/sources are verified completely; only ordinary assets become eligible.
    return dict(schema='pow-audit30-ordinary-ui-release-admission-v1',host='77.42.91.106',atUtc=S.utc(),scopeApprovalSha256=approval_sha,bootstrap=bootstrap,releaseIds=sorted(ids if bootstrap else {pair['current']['fields']['release_id']}),roots=[dict(path=r['path'],fields=r['fields'],logicalSha256=logical(r['snapshot']),snapshot=r['snapshot']) for r in roots],archives=archives,retainedPair=dict(current=pair['current']['fields']['release_id'],previous=pair['previous']['fields']['release_id']),guards=guards,exclusions='Every source/input/transport/evidence object and individually held historical child; parents and generic hold/masks remain retained.',capacityHelperSha256=S.hash_read(layout.capacity,1024**2)[0])

def load_index(path,expected,layout,approval_sha):
    index,h=S.read_json(Path(path),expected)
    schema=index.get('schema')
    if schema not in (INDEX_V1,INDEX_V2) or index.get('scopeApprovalSha256')!=approval_sha:raise ValueError('Wrong admission index')
    if schema==INDEX_V1 and approval_sha==S.REPAIR_APPROVAL_SHA:raise ValueError('Repair authority requires the explicit v2 migration lineage')
    migration,review=load_migration(index.get('migration'),layout,approval_sha) if schema==INDEX_V2 else (None,None)
    migration_review_value=review
    rows=index.get('admissions',[])
    if not rows or len(rows)>256 or len({r['path'] for r in rows})!=len(rows):raise ValueError('Empty, duplicate or oversized admission index')
    admissions=[];release_ids=set();bootstrap_count=0;roots={};assets={}
    if migration:
        pair=review['protected'];keep=set(protected_paths(pair))|{str(layout.archives/pair[k]['fields']['archive_name'])+suffix for k in ('current','previous') for suffix in ('','.sha256','.provenance')}
        for r in migration['legacyOrdinaryAssets']['roots']:
            p=Path(r['path']);fp=r['snapshot'];S.declared_surfaces(r['fields'])
            if (p.parent!=layout.roots or not p.name.startswith('proofofwork-www-pre-') or not S.RELEASE_ID.fullmatch(p.name.removeprefix('proofofwork-www-pre-'))
                    or r['path'] in keep or r['path'] in roots or fp['path']!=r['path'] or S.digest(fp['entries'])!=fp['sha256'] or logical(fp)!=r['logicalSha256']):
                raise ValueError('Invalid legacy ordinary root proof')
            roots[r['path']]=r
        for r in migration['legacyOrdinaryAssets']['archives']:
            p=Path(r['path']);rid=p.name.removeprefix('proofofwork-ui-release-').removesuffix('.tgz')
            if (p.parent!=layout.archives or not S.RELEASE_ID.fullmatch(rid) or p.name!='proofofwork-ui-release-'+rid+'.tgz'
                    or r['snapshot']['path']!=r['path'] or r['path'] in keep or S.digest(r['payloadRows'])!=r['payloadSha256']):
                raise ValueError('Invalid legacy archive proof')
            fps=[r['snapshot'],*r['sidecars']]
            if [fp['path'] for fp in fps]!=[str(p)+suffix for suffix in ('','.sha256','.provenance')]:raise ValueError('Partial legacy archive group')
            for fp in fps:
                if fp['path'] in keep or fp['path'] in assets or S.digest(fp['entries'])!=fp['sha256']:raise ValueError('Invalid legacy archive snapshot')
                assets[fp['path']]=fp
    legacy_roots=dict(roots);legacy_assets=dict(assets)
    approval_time=datetime.datetime.fromisoformat('2026-10-02T19:21:02.541787+00:00')
    for position,row in enumerate(rows):
        p=Path(row['path'])
        if p.parent!=layout.evidence or not p.name.startswith('audit30-policy-admission-'):raise ValueError('Admission must be immutable policy evidence')
        a,_=S.read_json(p,row['sha256'])
        if a.get('schema')!='pow-audit30-ordinary-ui-release-admission-v1' or a.get('host')!='77.42.91.106' or a.get('scopeApprovalSha256')!=approval_sha:raise ValueError('Admission authority differs')
        anchor=bool(migration and position==0)
        if anchor:
            if a!=migration['anchor'] or set(a['releaseIds'])!=set(a['retainedPair'].values()):raise ValueError('Migration anchor admission differs')
            bootstrap_count+=1
        elif a.get('migrationAnchor') is not None:raise ValueError('Unexpected migration anchor admission')
        elif a.get('bootstrap') is True:
            if migration:raise ValueError('Legacy bootstrap cannot replace migration anchor')
            bootstrap_count+=1
            if set(a['releaseIds'])!=BOOTSTRAP_IDS or a['retainedPair']!=dict(current='26500e4d2ff7-20261002T054938Z',previous='835e30258d23-20261002T052338Z'):raise ValueError('Expanded bootstrap assets')
        else:
            if len(a['releaseIds'])!=1:raise ValueError('Ordinary admission has wrong release count')
            if a['retainedPair']['current']!=a['releaseIds'][0] or a['retainedPair']['previous'] not in release_ids:raise ValueError('Broken admitted release chain')
            for rid in a['releaseIds']:
                if not S.RELEASE_ID.fullmatch(rid) or datetime.datetime.strptime(rid.split('-')[1],'%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc)<approval_time:raise ValueError('Historical release cannot be dynamically admitted')
        release_ids.update(a['releaseIds'])
        if len(a['roots'])!=1 or len(a['archives'])!=(2 if a['bootstrap'] or anchor else 1):raise ValueError('Partial or expanded ordinary admission')
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
        if (source_index.get('schema')!=schema or source_index.get('scopeApprovalSha256')!=approval_sha
                or source_index.get('migration')!=index.get('migration') or not source_rows or len(source_rows)>len(rows)
                or source_rows!=rows[:len(source_rows)] or source_index.get('completedRetirements',[])!=retirements[:position]):raise ValueError('Retirement admission-index lineage differs')
        source_admissions=admissions[:len(source_rows)];pair=dict(current=plan['protected']['current']['fields']['release_id'],previous=plan['protected']['previous']['fields']['release_id'])
        if source_admissions[-1]['retainedPair']!=pair:raise ValueError('Retirement plan uses a stale admitted current/prior pair')
        if any(plan['protected'][k]['fields']['archive_name']!='proofofwork-ui-release-'+pair[k]+'.tgz' for k in ('current','previous')):raise ValueError('Retained current/prior archive name differs from admitted release identity')
        source_roots={**legacy_roots,**{r['path']:r for a in source_admissions for r in a['roots']}};source_assets={**legacy_assets,**{fp['path']:fp for a in source_admissions for r in a['archives'] for fp in [r['snapshot'],*r['sidecars']]}}
        keep={plan['protected'][k]['path'] for k in ('current','previous')}|{str(layout.archives/('proofofwork-ui-release-'+pair[k]+'.tgz'))+suffix for k in ('current','previous') for suffix in ('','.sha256','.provenance')}
        eligible=[dict(path=path,kind='rollback-root') for path in source_roots if path not in keep and path not in retired]+[dict(path=path,kind='managed-release-archive' if path.endswith('.tgz') else 'archive-sidecar') for path in source_assets if path not in keep and path not in retired]
        eligible.sort(key=lambda r:(r['kind']!='rollback-root',r['path']))
        if plan['policyScope'].get('eligible')!=eligible:raise ValueError('Retirement plan scope does not derive from admitted ordinary assets')
        wanted={r['path'] for r in plan['delete']};removed=done.get('completed',[])
        if not isinstance(removed,list) or len(removed)!=len(plan['delete']) or any(r.get('path')!=frozen['path'] or r.get('outcome')!='retired' or r.get('snapshotSha256')!=frozen['snapshot']['sha256'] for r,frozen in zip(removed,plan['delete'])) or done.get('currentPath')!=(plan['delete'][-1]['path'] if plan['delete'] else None):raise ValueError('Incomplete, reordered or unbound retirement outcomes')
        if migration and any(not S.SHA.fullmatch(r.get('observedSnapshotSha256','')) for r in removed):raise ValueError('Repair retirement omitted observed inode evidence')
        for frozen in plan['delete']:
            if frozen['kind']=='rollback-root':
                admitted=source_roots[frozen['path']]
                if frozen.get('release',{}).get('fields')!=admitted['fields'] or logical(frozen['snapshot'])!=admitted['logicalSha256']:raise ValueError('Retired rollback differs from its admission')
            elif frozen['snapshot']!=source_assets[frozen['path']]:raise ValueError('Retired archive asset differs from its admitted snapshot')
        retired.update(wanted)
    return dict(indexPath=str(path),indexSha256=h,admissions=admissions,releaseIds=release_ids,roots=roots,assets=assets,retired=retired,
                migration=migration,migrationReview=migration_review_value,index=index)

def policy_scope(index,layout,approval_sha,details=False):
    data=load_index(index['path'],index['sha256'],layout,approval_sha);cache={};pair=S.protected_pair(layout,cache)
    if data['admissions'][-1]['retainedPair']!=dict(current=pair['current']['fields']['release_id'],previous=pair['previous']['fields']['release_id']):raise ValueError('Live current/prior pair requires its latest verified admission before retirement planning')
    keep={pair[k]['path'] for k in ('current','previous')}|{str(layout.archives/pair[k]['fields']['archive_name'])+s for k in ('current','previous') for s in ('','.sha256','.provenance')}
    eligible=[];qualified=[];observed={}
    for path,r in data['roots'].items():
        if not os.path.lexists(path):
            if path not in data['retired']:raise ValueError('Unreconciled missing admitted rollback')
            continue
        if path in data['retired']:raise ValueError('Retired rollback reappeared')
        if path in keep:continue
        actual=S.release_proof(Path(path),layout,cache)
        if actual['fields']!=r['fields'] or logical(actual['snapshot'])!=r['logicalSha256']:raise ValueError('Admitted rollback content changed')
        observed[path]=actual['snapshot']
        eligible.append(dict(path=path,kind='rollback-root'))
    for path,fp in data['assets'].items():
        if not os.path.lexists(path):
            if path not in data['retired']:raise ValueError('Unreconciled missing admitted archive asset')
            continue
        if path in data['retired']:raise ValueError('Retired archive asset reappeared')
        if path in keep:continue
        actual=S.snapshot(Path(path));S.match_snapshot(actual,fp);observed[path]=actual
        if data['migration'] and path.endswith('.tgz'):
            qualified.append(cache.get(path) or S.standalone_archive_proof(Path(path)))
        eligible.append(dict(path=path,kind='managed-release-archive' if path.endswith('.tgz') else 'archive-sidecar'))
    eligible.sort(key=lambda r:(r['kind']!='rollback-root',r['path']))
    scope=dict(eligible=eligible,admissionIndex=dict(path=data['indexPath'],sha256=data['indexSha256']),policy='current-and-one-fully-verified-prior; only explicit admitted ordinary assets; traditional prune timers remain masked',excludedHistoricalAssetsNotDiscovered=True)
    if data['migration']:scope['qualifiedArchiveProofs']=qualified
    return (scope,dict(data,eligibleSnapshots=observed),pair) if details else scope

def custody_closure(index_path,index_sha,layout,approval_sha):
    scope,data,pair=policy_scope(dict(path=index_path,sha256=index_sha),layout,approval_sha,details=True)
    snapshots=[]
    for row in scope['eligible']:
        record=data['eligibleSnapshots'][row['path']]
        snapshots.append(dict(row,snapshot=record))
    old=data['migrationReview']['historicalAssetCensus'] if data['migrationReview'] else []
    return dict(index=dict(path=data['indexPath'],sha256=data['indexSha256']),protectedReleaseIds=sorted(pair_ids(pair).values()),
        admittedReleaseIds=sorted(data['releaseIds']),retiredOrdinaryPaths=sorted(data['retired']),
        protectedPaths=sorted(set(protected_paths(pair))|{str(layout.archives/pair[k]['fields']['archive_name'])+suffix for k in ('current','previous') for suffix in ('','.sha256','.provenance')}),
        pair=pair,migrationExcludedPaths=sorted(r['path'] for r in old if r['path'] not in data['roots'] and r['path'] not in data['assets']),
        historicalObligations=[r for r in old if r['status']=='unresolved-missing-historical-object'],
        ordinaryEligiblePaths=scope['eligible'],ordinaryEligibleSnapshots=snapshots)

def custody_xattrs(values):
    converted=[]
    for name,value in values:
        if not isinstance(name,str) or not isinstance(value,str):raise ValueError('Invalid custody xattr evidence')
        raw=bytes.fromhex(value)
        if raw.hex()!=value:raise ValueError('Noncanonical custody xattr hex')
        converted.append([name,base64.b64encode(raw).decode()])
    if values!=sorted(values) or len({row[0] for row in values})!=len(values):raise ValueError('Unordered or duplicate custody xattrs')
    return converted

def verify_external_link_closure(source,restored,plan):
    """Ordinary exports may preserve a proved closed cross-root link graph."""
    files={}
    for row in source['inventory']:
        if row['kind']=='file':
            key=(row['identity']['st_dev'],row['identity']['st_ino'])
            files.setdefault(key,[]).append(row)
    external={key:rows for key,rows in files.items() if len(rows)!=rows[0]['identity']['st_nlink']}
    closure=source.get('externalLinkClosure')
    if closure is None:
        if external:raise ValueError('External hardlinks require a complete ordinary custody closure')
        return
    roots=[plan['protected'][key]['snapshot'] for key in ('current','previous')]
    roots.extend(row['snapshot'] for row in plan['delete'] if row['kind']=='rollback-root')
    expected_roots=sorted((dict(path=r['path'],snapshotSha256=r['sha256']) for r in roots),key=lambda r:r['path'])
    if (source.get('format')!='proofofwork-ui-retained-root-v1'
            or closure.get('schema')!='pow-ui-ordinary-export-hardlink-closure-v1'
            or closure.get('sourceRoot')!=source['root'] or closure.get('policyIndex')!=plan['policyScope']['admissionIndex']
            or closure.get('protectedReleaseIds')!=sorted(plan['protected'][key]['fields']['release_id'] for key in ('current','previous'))
            or closure.get('verifiedRoots')!=expected_roots
            or restored.get('externalLinkClosureSha256')!=hashlib.sha256(S.encoded(closure)+b'\n').hexdigest()
            or restored.get('externalAliasesRetainedAsEvidence') is not True):
        raise ValueError('Ordinary external hardlink closure authority or restoration differs')
    aliases={}
    for root in roots:
        for row in root['entries']:
            if row['kind']=='file':aliases.setdefault((row['device'],row['inode']),[]).append((str(Path(root['path'])/row['path']),row))
    groups=closure.get('groups',[])
    if len(groups)!=len(external) or len({(r['device'],r['inode']) for r in groups})!=len(groups):
        raise ValueError('External hardlink closure omits or duplicates a group')
    for group in groups:
        key=(group['device'],group['inode']);rows=external.get(key)
        if not rows:raise ValueError('Unexpected external hardlink group')
        entry=rows[0];identity=entry['identity'];known=aliases.get(key,[])
        if (group.get('identity')!=identity or group.get('xattrs')!=entry['xattrs'] or group.get('sha256')!=entry['sha256']
                or group.get('aliases')!=sorted(path for path,_ in known)
                or len(known)!=identity['st_nlink'] or len(rows)>=len(known)
                or len({path for path,_ in known})!=len(known)):
            raise ValueError('External hardlink closure is not the complete known alias set')
        for _,row in known:
            expected=dict(device=identity['st_dev'],inode=identity['st_ino'],mode=stat.S_IMODE(identity['st_mode']),
                uid=identity['st_uid'],gid=identity['st_gid'],size=identity['st_size'],mtimeNs=identity['st_mtime_ns'],
                ctimeNs=identity['st_ctime_ns'],links=identity['st_nlink'],sha256=entry['sha256'],xattrs=custody_xattrs(entry['xattrs']))
            if any(row[k]!=value for k,value in expected.items()):raise ValueError('External alias snapshot metadata differs')

def verify_custody_proof(binding,plan,layout,approval_sha):
    """Bind independently restored off-host custody to every ordinary deletion byte."""
    if approval_sha!=S.REPAIR_APPROVAL_SHA:raise ValueError('Ordinary custody gate requires repair approval')
    S.validate_plan(plan,layout,'future-retention',approval_sha)
    proof=evidence_binding(binding,layout,'ui-retention-custody-proof-')
    ids=sorted(plan['protected'][key]['fields']['release_id'] for key in ('current','previous'))
    if (proof.get('schema')!='pow-ui-retention-ordinary-custody-proof-v1' or proof.get('scopeApprovalSha256')!=approval_sha
            or proof.get('admissionIndex')!=plan['policyScope']['admissionIndex'] or proof.get('planSha256')!=S.digest(plan)
            or proof.get('protectedReleaseIds')!=ids):raise ValueError('Ordinary custody proof authority or plan differs')
    objects=proof.get('objects',[])
    if len(objects)!=len(plan['delete']):raise ValueError('Ordinary custody proof must cover every planned object')
    cache={}
    for row,frozen in zip(objects,plan['delete']):
        if row.get('path')!=frozen['path'] or row.get('snapshotSha256')!=frozen['snapshot']['sha256'] or row.get('independentRestorationVerified') is not True:
            raise ValueError('Ordinary custody object scope/order/snapshot differs')
        key=S.digest(row.get('custody'))
        if key not in cache:cache[key]=evidence_binding(row.get('custody'),layout)
        record=cache[key];source=record.get('sourceInventory',{});records=source.get('inventory',[]);restored=record.get('restoration',{})
        inventory_sha=hashlib.sha256(S.encoded(records)+b'\n').hexdigest()
        if (record.get('ok') is not True or not S.SHA.fullmatch(row.get('archiveSha256','')) or not S.SHA.fullmatch(row.get('custodyPlanSha256',''))
                or record.get('archiveSha256')!=row['archiveSha256'] or record.get('planSha256')!=row['custodyPlanSha256']
                or record.get('inventorySha256')!=row.get('inventorySha256') or inventory_sha!=row.get('inventorySha256')
                or source.get('root')!=record.get('sourcePath') or source.get('entries')!=len(records)
                or restored.get('archiveSha256')!=row['archiveSha256'] or restored.get('inventorySha256')!=inventory_sha
                or restored.get('sourceRoot')!=record.get('sourcePath')
                or not all(restored.get(k) is True for k in ('ownerRestored','modeTimesXattrsRestored','internalHardlinksRestored'))):
            raise ValueError('Ordinary custody record lacks exact restored inventory binding')
        source_path=Path(record['sourcePath']);member=row.get('sourceMember')
        if source.get('format')=='proofofwork-ui-retained-root-v1':
            if member!='.' or str(source_path)!=frozen['path']:raise ValueError('Custody root does not cover planned root')
            wanted=records
        elif source.get('format')=='proofofwork-ui-retained-files-v1':
            names=[source_path.name+suffix for suffix in ('','.sha256','.provenance')]
            if sorted(r['path'] for r in records)!=sorted(names) or member not in names or str(source_path.parent/member)!=frozen['path']:
                raise ValueError('Custody archive group does not cover exact planned member')
            wanted=[dict(r,path='.') for r in records if r['path']==member]
        else:raise ValueError('Unsupported ordinary custody inventory')
        verify_external_link_closure(source,restored,plan)
        converted=[]
        for r in wanted:
            identity=r['identity'];mode=identity['st_mode'];kind='directory' if stat.S_ISDIR(mode) else 'file' if stat.S_ISREG(mode) else None
            if kind!=r['kind']:raise ValueError('Custody entry kind differs from its inode evidence')
            item=dict(path=r['path'],kind=kind,mode=stat.S_IMODE(mode),uid=identity['st_uid'],gid=identity['st_gid'],
                device=identity['st_dev'],inode=identity['st_ino'],size=identity['st_size'],mtimeNs=identity['st_mtime_ns'],
                ctimeNs=identity['st_ctime_ns'],links=identity['st_nlink'],xattrs=custody_xattrs(r['xattrs']))
            if kind=='file':item['sha256']=r['sha256']
            converted.append(item)
        if converted!=frozen['snapshot']['entries']:raise ValueError('Restored custody bytes or metadata differ from planned ordinary snapshot')
    return proof

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['admit-bootstrap','admit-release','migration-review','admit-migration','closure','plan','verify','apply'])
    p.add_argument('--approval',type=Path,required=True);p.add_argument('--approval-sha256',required=True);p.add_argument('--index',type=Path);p.add_argument('--index-sha256');p.add_argument('--record',action='store_true');p.add_argument('--plan',type=Path);p.add_argument('--plan-sha256')
    p.add_argument('--citation-review',type=Path);p.add_argument('--citation-review-sha256')
    p.add_argument('--migration-review',type=Path);p.add_argument('--migration-review-sha256')
    p.add_argument('--legacy-paths',type=Path);p.add_argument('--legacy-paths-sha256')
    p.add_argument('--custody-proof',type=Path);p.add_argument('--custody-proof-sha256')
    a=p.parse_args()
    if os.geteuid()!=0:raise ValueError('Production policy requires root')
    layout=S.Layout();fd=S.lock(layout);os.nice(15)
    try:
        if bool(a.citation_review)!=bool(a.citation_review_sha256) or a.citation_review and a.command!='plan':raise ValueError('Citation path/SHA pair is admitted only by a policy plan')
        S.approval(a.approval,a.approval_sha256,a.command if a.command.startswith('admit-') or a.command=='migration-review' else 'future-retention')
        index=dict(path=str(a.index),sha256=a.index_sha256) if a.index and a.index_sha256 else None
        if a.command=='migration-review':
            if not index or not a.legacy_paths or not a.legacy_paths_sha256:raise ValueError('Migration review requires exact prior index and legacy path list')
            paths=evidence_binding(dict(path=str(a.legacy_paths),sha256=a.legacy_paths_sha256),layout)
            out=migration_review(layout,a.approval_sha256,index,paths)
            if not a.record:print_plan(out);return
            S.capacity(layout,'retention-migration-review',max(8*1024**2,len(S.encoded(out))*2))
            stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');target=layout.evidence/('audit30-policy-migration-review-'+stamp+'.json');S.durable(target,out)
            print(json.dumps(dict(path=str(target),sha256=S.hash_read(target,S.MAX_JSON)[0])));return
        if a.command=='admit-migration':
            if not a.migration_review or not a.migration_review_sha256:raise ValueError('Exact reviewed migration required')
            out=migration_admission(layout,a.approval_sha256,dict(path=str(a.migration_review),sha256=a.migration_review_sha256))
            if not a.record:print_plan(out);return
            S.capacity(layout,'retention-migration-admission',max(8*1024**2,len(S.encoded(out))*3))
            stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
            target=layout.evidence/('audit30-policy-migration-'+stamp+'.json');S.durable(target,out)
            anchor=layout.evidence/('audit30-policy-admission-migration-'+stamp+'.json');S.durable(anchor,out['anchor'])
            binding=dict(path=str(target),sha256=S.hash_read(target,S.MAX_JSON)[0]);anchor_binding=dict(path=str(anchor),sha256=S.hash_read(anchor,S.MAX_JSON)[0])
            value=dict(schema=INDEX_V2,scopeApprovalSha256=a.approval_sha256,migration=binding,admissions=[anchor_binding],completedRetirements=[])
            index_path=layout.evidence/('audit30-policy-admission-index-v2-'+stamp+'.json');S.durable(index_path,value)
            print(json.dumps(dict(status='migrated',migration=binding,index=dict(path=str(index_path),sha256=S.hash_read(index_path,S.MAX_JSON)[0]),ordinaryPruneMasksUnchanged=True)));return
        if a.command.startswith('admit-'):
            out=admission(layout,a.approval_sha256,a.command=='admit-bootstrap',index)
            if not a.record:print(json.dumps(out,sort_keys=True));return
            S.safe(layout.evidence,True);S.capacity(layout,'audit30-policy-admission',max(8*1024**2,len(S.encoded(out))*2))
            stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');target=layout.evidence/('audit30-policy-admission-'+stamp+'.json');S.durable(target,out)
            print(json.dumps(dict(status='admitted',path=str(target),sha256=S.hash_read(target,S.MAX_JSON)[0],ordinaryPruneMasksUnchanged=True)));return
        if not index:raise ValueError('Exact admission index SHA required')
        if a.command=='closure':print_plan(custody_closure(index['path'],index['sha256'],layout,a.approval_sha256));return
        scope=policy_scope(index,layout,a.approval_sha256)
        if a.command=='plan':
            citation=dict(path=str(a.citation_review),sha256=a.citation_review_sha256) if a.citation_review else None
            print_plan(S.create_plan(layout,'future-retention',a.approval_sha256,scope,citation_review=citation));return
        if not a.plan or not a.plan_sha256:raise ValueError('Exact future plan SHA required')
        plan,h=S.read_json(a.plan,a.plan_sha256);S.validate_plan(plan,layout,'future-retention',a.approval_sha256)
        if h!=S.digest(plan):raise ValueError('Future plan must use exact canonical policy stdout bytes')
        if plan['policyScope']!=scope:raise ValueError('Fresh eligible per-release scope changed')
        if a.command=='apply' and a.approval_sha256==S.REPAIR_APPROVAL_SHA:
            if not a.custody_proof or not a.custody_proof_sha256:raise ValueError('Repair apply requires complete independently restored ordinary custody')
            verify_custody_proof(dict(path=str(a.custody_proof),sha256=a.custody_proof_sha256),plan,layout,a.approval_sha256)
        print(json.dumps(S.execute(plan,h,layout,a.command=='apply',lock_fd=fd),sort_keys=True))
    finally:os.close(fd)

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,S.subprocess.SubprocessError,S.tarfile.TarError) as error:
        print(json.dumps(dict(status='refused',errorClass=type(error).__name__,error=str(error))),file=sys.stderr);raise SystemExit(1)
