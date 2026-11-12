#!/usr/bin/python3 -I
"""Exact approved d4ee source/surfaces retirement, after durable recovery.
Only two roots may be removed. A prior intent requires explicit reconciliation.
"""
import argparse
import hashlib
import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SCRATCH = Path('/var/tmp/proofofwork-deploy')
TREES = {
 'source': SCRATCH/'proofofwork-ui-source-d4eeffaf28f1-20261109T160000Z',
 'surfaces': SCRATCH/'proofofwork-ui-surfaces-d4eeffaf28f1-20261109T160000Z',
}
COUNTS = {'source':9207,'surfaces':2334}
ALLOCATED = {'source':365985792,'surfaces':49483776}
ARCHIVES = {
 'source':'5fb30507942fd6b37b05b56a74cb4c4bc9fe3728e1ebeb3f8c241a85188cb1fe',
 'surfaces':'5faac782767698878bb1bc184c3f7bb541459c9e8ed2bec05b5175f0a3e5ecee',
}
EVIDENCE = Path('/var/backups/proofofwork-ui/cleanup-evidence/health-d4ee-trees-20261112')
CUSTODY_ROOT = '/data/proofofwork-health-fixes-20261111/d4ee-recovery-20261112'
MANIFEST_SHA = '9d3d763ec5682f43b0412e9825528f066be67aed64cb7adccb8791a3961908ce'
PROOF_SHA = 'a6d7f1c9d101721722971f350ceff16af972cea4b0956ee54c83e3ac7d5235a9'
CONFIG_SHA = '5ce7c5e1948215b506b8a76f16bda0f44a1206e0d6429bfe42af761b3dd929a1'
STATE_SHA = '655fe12ec901ec2fe8e9c62fc878c7c0e3b98ecc34227069d71ddc3f9aede713'
CONTROLLER_SHA = '32669d549adfbe3839bb1e71753d4865b92ca416ccca94a8f46f1854baa0ae60'
WRITER_SHA = '007f5f393f61199fdbd7cc12fb2648f8676c4fbbd1ba3d557ce308e8f7abaac1'
PAIR = {'current':'037f8db7edcc-20261111T182211Z','previous':'d9fa69d9e1e4-20261110T210615Z'}
PACKAGE = Path('/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-tools-f4329941385ec513f29a7fae25129a802247e6b1f07f9541a1f45d43e9af39f9')
CAPACITY = Path('/usr/local/sbin/proofofwork-ui-capacity')
PINS = {
 'ui-retention/inventory.py':'4fbc851959a6e8032f5cd592ee6bebf0fe7221fa1d66331b8849b795ccb35578',
 'ui-retention/removal.py':'00e058c347fd186524a4d01fa0949342149668dfd247025ba7bef85edb54e5fa',
 'proofofwork-ui-capacity.py':'3a7d54044cd07665cd37425ea910ad3bcc606450f5537a70d37adce11c6fb687',
}
FORMAT = 'proofofwork-exact-d4ee-tree-retirement-v1'
MAX_EVIDENCE = 32*1024**2
SHA = re.compile('[0-9a-f]{64}\\Z')

def require(ok, message):
    if not ok: raise ValueError(message)

def digest(raw): return hashlib.sha256(raw).hexdigest()

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path, loader=SourceFileLoader(name, str(path)))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

def helpers():
    for name, expected in PINS.items():
        path = CAPACITY if name == 'proofofwork-ui-capacity.py' else PACKAGE / 'deploy' / name
        require(digest(path.read_bytes()) == expected, 'Changed installed native helper: ' + name)
    removal = load_module('d4ee_native_removal', PACKAGE / 'deploy/ui-retention/removal.py')
    capacity = load_module('d4ee_native_capacity', CAPACITY)
    require(capacity.ROOT_RESERVE_BYTES == 8*1024**3 and capacity.MAX_DEPLOY_SCRATCH_BYTES == 5*1024**3,
            'Installed capacity limits changed')
    return removal.E, removal, capacity

def pinned_json(E, path, expected):
    require(SHA.fullmatch(expected), 'Invalid digest')
    raw, info = E.read_regular(path, MAX_EVIDENCE)
    require(info.st_uid == info.st_gid == 0 and not info.st_mode & 0o7022, 'Unsafe evidence authority')
    require(digest(raw) == expected, 'Evidence digest differs: ' + str(path))
    return json.loads(raw), raw

def root_record(value):
    return {**value['fingerprint'], 'inventory': value['records']}

def guards(E):
    return {'holds': E.hold_snapshot(), 'timers': E.timer_snapshot(),
            'release': file_guard(E, '/var/www/.proofofwork-ui-release'),
            'state': file_guard(E, '/var/lib/proofofwork-ui-retention/state.json')}

def file_guard(E, path):
    raw, info = E.read_regular(path, 16 * 1024**2)
    return {'path': path, 'sha256': digest(raw), 'identity': E.identity(info), 'xattrs': E.xattrs(path)}

def lifecycle(E, lock):
    config_path = '/etc/proofofwork-retention/ui-lifecycle.json'
    raw, _ = E.read_regular(config_path)
    require(digest(raw) == CONFIG_SHA, 'Lifecycle configuration changed')
    state, _ = E.read_regular('/var/lib/proofofwork-ui-retention/state.json')
    require(digest(state) == STATE_SHA, 'Lifecycle state changed')
    config = json.loads(raw)
    path = PACKAGE / 'deploy/ui-retention/lifecycle_remote.py'
    require(config['controller'] == {'path':str(path),'sha256':CONTROLLER_SHA},
            'Lifecycle controller authority differs')
    require(digest(path.read_bytes()) == CONTROLLER_SHA and
            digest((PACKAGE/'deploy/audit30/ui-storage.py').read_bytes()) == WRITER_SHA,
            'Installed lifecycle implementation changed')
    module = load_module('d4ee_current_lifecycle', path)
    runtime = module.installed_runtime(config_path, CONFIG_SHA)
    runtime.lock_fd = lock
    result = runtime.status({'requireComplete': True})
    require(result.get('retentionComplete') is True and result.get('publicationHealthy') is True
            and result.get('pair') == PAIR and result.get('unfinishedIntents') == []
            and bool(result.get('verifiedPreservedFallback')), 'Protected lifecycle is not healthy and complete')
    return {'binding':result['binding'],'retentionComplete':True,'publicationHealthy':True}

def closed_allocation(records):
    seen = {}; groups = {}
    for row in records:
        s=row['identity']; key=(s['st_dev'],s['st_ino'])
        if key in seen:
            require(row['kind']=='file' and seen[key]['kind']=='file'
                    and row['identity']==seen[key]['identity']
                    and row.get('sha256')==seen[key].get('sha256')
                    and row['xattrs']==seen[key]['xattrs'], 'Inconsistent internal hardlink')
        else: seen[key]=row
        if row['kind']=='file': groups.setdefault(key,[]).append(row['path'])
        elif row['kind']=='symlink': require(s['st_nlink']==1, 'Aliased symlink')
    require(all(len(v)==seen[k]['identity']['st_nlink'] for k,v in groups.items()),
            'Selected root has external hardlinks')
    return sum(row['identity']['st_blocks']*512 for row in seen.values())

def validate_manifest(value):
    require(value.get('schema')=='pow-d4ee-ui-recovery-manifest-v1' and value.get('host')=='77.42.91.106'
            and value.get('stateSha256')==STATE_SHA and value.get('configSha256')==CONFIG_SHA
            and value.get('inventoryHelperSha256')==PINS['ui-retention/inventory.py']
            and set(value.get('trees',{}))==set(TREES), 'Independent manifest authority differs')
    for role,path in TREES.items():
        tree=value['trees'][role]; fp=tree['fingerprint']; records=tree['records']
        require(fp['root']==str(path) and fp['format']=='proofofwork-ui-retained-root-v1'
                and fp['entries']==len(records)==COUNTS[role]
                and len({r['path'] for r in records})==COUNTS[role],
                'Manifest root or membership count differs')
        by_path={row['path']:row for row in records}
        require(by_path.get('.',{}).get('kind')=='directory', 'Missing selected root')
        for row in records:
            name=row['path']; relative=Path(name)
            require(not relative.is_absolute() and str(relative)==name and
                    (name=='.' or all(part not in ('','..','.') for part in name.split('/')))
                    and row['kind'] in ('file','directory','symlink'), 'Unsafe selected membership')
            if name!='.':
                require(by_path.get(str(relative.parent),{}).get('kind')=='directory', 'Missing selected parent')
        require(closed_allocation(records)==ALLOCATED[role], 'Approved reclaimable allocation differs')
    return value['trees']

def validate_proof(proof):
    require(proof.get('schema')=='pow-d4ee-ui-recovery-proof-v1' and proof.get('ok') is True
            and proof.get('manifestSha256')==MANIFEST_SHA and proof.get('custodyRoot')==CUSTODY_ROOT
            and proof.get('inventoryHelperSha256') == PINS['ui-retention/inventory.py']
            and proof.get('archiveCustodySha256') == 'ccd4e1298fb4639f584ae2253f4aae258faa31aa27cabd6e35b5c703e3075a26'
            and proof.get('originalInodesRestorable') is False and proof.get('originalCtimeRestorable') is False,
            'Independent restoration authority differs')
    required={'content','type','mode','uid','gid','mtimeNs','atimeNs','xattrs','symlinkTarget','internalHardlinkTopology'}
    require(required <= set(proof.get('restoredMetadata',[])), 'Incomplete restored metadata')
    require(set(proof.get('archives',{}))==set(TREES) and set(proof.get('restored',{}))==set(TREES),
            'Recovery tree roles differ')
    for role in TREES:
        archive=proof['archives'][role]; restored=proof['restored'][role]
        require(archive.get('sha256')==ARCHIVES[role]
                and archive.get('path')==CUSTODY_ROOT+'/retained-d4ee-'+role+'.tgz'
                and restored.get('path')==CUSTODY_ROOT+'/restored-'+role
                and restored.get('entries')==COUNTS[role] and restored.get('ok') is True
                and restored.get('externalHardlinks') is False
                and restored.get('allocatedBytesOriginal') == ALLOCATED[role]
                and all(restored.get('verification',{}).get(k) is True for k in
                        ('internalHardlinksRestored','modeTimesXattrsRestored','ownerRestored')),
                'Durable archive or restoration binding differs')
    require(proof.get('cleanupReview',{}).get('durableRootUnderTmpfilesRule') is False,
            'Durable recovery root is not protected from temporary cleanup')

def authority(E, manifest_path, proof_path):
    manifest,_=pinned_json(E,manifest_path,MANIFEST_SHA)
    proof,_=pinned_json(E,proof_path,PROOF_SHA)
    trees=validate_manifest(manifest); validate_proof(proof)
    return trees

def match_record(actual, original):
    require({k:v for k,v in actual.items() if k!='identity'} ==
            {k:v for k,v in original.items() if k!='identity'}, 'Qualified content or attributes changed')
    # atime can advance during prior evidence research. The new plan and apply
    # inventories below still compare full identities, including atime.
    require({k:v for k,v in actual['identity'].items() if k!='st_atime_ns'} ==
            {k:v for k,v in original['identity'].items() if k!='st_atime_ns'}, 'Qualified identity changed')

def qualify(E, approved):
    records=[]
    for role,path in TREES.items():
        current=E.inventory(path,require_manifest=False,allow_symlinks=True)
        old=approved[role]
        require(current['fingerprint']==old['fingerprint'], 'Qualified root fingerprint changed')
        require(len(current['records'])==len(old['records']), 'Qualified tree membership differs')
        for actual,original in zip(current['records'],old['records']): match_record(actual,original)
        require(closed_allocation(current['records'])==ALLOCATED[role], 'Reclaimable bytes changed')
        record=root_record(current)
        record['retainedParent']={'path':str(path.parent),'identity':E.identity(path.parent.lstat()),'xattrs':E.xattrs(path.parent)}
        records.append(record)
    return records

def exact_scope(plan, approved):
    require(plan.get('format')==FORMAT and plan.get('controllerSha256')==digest(Path(__file__).read_bytes())
            and plan.get('helpers')==PINS and plan.get('manifestSha256')==MANIFEST_SHA
            and plan.get('proofSha256')==PROOF_SHA, 'Unreviewed controller or recovery authority')
    require(len(plan.get('trees',[]))==2 and [r['root'] for r in plan['trees']]==[str(p) for p in TREES.values()],
            'Expanded or reordered retirement roots')
    for (role,path),record in zip(TREES.items(),plan['trees']):
        require(record['entries']==COUNTS[role] and
                [r['path'] for r in record['inventory']]==[r['path'] for r in approved[role]['records']]
                and record['retainedParent']['path']==str(SCRATCH), 'Plan membership or retained parent differs')
        require(closed_allocation(record['inventory'])==ALLOCATED[role], 'Plan allocation or hardlinks differ')

def plan_command(args,E,R,C,lock):
    output=EVIDENCE/'plan.json'
    require(not os.path.lexists(output), 'Plan exists; reconcile instead of overwriting')
    approved=authority(E,args.manifest,args.proof)
    before=guards(E); status=lifecycle(E,lock); records=qualify(E,approved)
    refs=R.check_references([str(p) for p in TREES.values()])
    budgets=[R.journal_capacity_bound(record) for record in records]
    plan={'format':FORMAT,'controllerSha256':digest(Path(__file__).read_bytes()),'helpers':PINS,
          'manifestSha256':MANIFEST_SHA,'proofSha256':PROOF_SHA,'createdAtUnix':int(time.time()),
          'manifestPath':str(EVIDENCE/'manifest.json'),'proofPath':str(EVIDENCE/'recovery-proof.json'),
          'trees':records,'guards':before,'lifecycle':status,'references':refs,'journalBounds':budgets,
          'approval':'2026-11-12 exact two d4ee trees after durable recovery; original inode/ctime loss approved; all other evidence unchanged'}
    raw=E.encoded(plan)
    _,manifest_raw=pinned_json(E,args.manifest,MANIFEST_SHA); _,proof_raw=pinned_json(E,args.proof,PROOF_SHA)
    total=len(raw)+sum(budgets)+len(manifest_raw)+len(proof_raw)+2*1024**2
    require(total<=MAX_EVIDENCE,'Cleanup evidence exceeds bounded envelope')
    C.check_capacity(EVIDENCE,total,16,'d4ee-exact-trees-plan')
    require(guards(E)==before,'Protected guards changed while planning')
    for original,target,expected in [(args.manifest,Path(plan['manifestPath']),MANIFEST_SHA),
                                     (args.proof,Path(plan['proofPath']),PROOF_SHA)]:
        _,data=pinned_json(E,original,expected)
        if not os.path.lexists(target): E.save_new(target,data)
        else: pinned_json(E,target,expected)
    E.save_new(output,raw)
    print(json.dumps({'plan':str(output),'sha256':digest(raw),'entries':sum(COUNTS.values()),
                      'allocatedBytes':sum(ALLOCATED.values()),'journalBytes':sum(budgets),'maximumEvidenceBytes':total}))

def apply_command(args,E,R,C,lock):
    plan,_=pinned_json(E,EVIDENCE/'plan.json',args.sha256)
    require(plan['manifestPath']==str(EVIDENCE/'manifest.json') and plan['proofPath']==str(EVIDENCE/'recovery-proof.json'),
            'Evidence path differs')
    approved=authority(E,Path(plan['manifestPath']),Path(plan['proofPath'])); exact_scope(plan,approved)
    require(0<=time.time()-plan['createdAtUnix']<=3600,'Plan expired')
    intent,complete=EVIDENCE/'intent.json',EVIDENCE/'completed.json'
    require(not os.path.lexists(intent) and not os.path.lexists(complete) and not any(EVIDENCE.glob('actions-*.jsonl')),
            'Prior attempt exists; reconcile, never blindly retry')
    require(guards(E)==plan['guards'],'Protected guards changed')
    lifecycle(E,lock); records=qualify(E,approved)
    require(records==plan['trees'],'Fresh root identities changed')
    R.check_references([str(p) for p in TREES.values()])
    require([R.journal_capacity_bound(r) for r in records]==plan['journalBounds'],'Journal bounds changed')
    C.check_capacity(EVIDENCE,sum(plan['journalBounds'])+2*1024**2,8,'d4ee-exact-trees-apply')
    binding={'manifestPath':plan['manifestPath'],'manifestSha256':MANIFEST_SHA,
             'proofPath':plan['proofPath'],'proofSha256':PROOF_SHA,'archiveSha256':ARCHIVES}
    E.save_new(intent,E.encoded({'format':FORMAT,'planSha256':args.sha256,'startedAtUnix':int(time.time()),
                                'recovery':binding,'originalInodesRestorable':False,'originalCtimeRestorable':False}))
    counts=[]
    for index,record in enumerate(records):
        path=Path(record['root']);journal=R.Journal(EVIDENCE/('actions-%03d.jsonl'%index),expected_root=record)
        fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
        try:
            count=R.delete_tree(fd,path.name,record,journal)
            require(count==record['entries'] and journal.pending is None,'Incomplete retirement root')
            counts.append(count)
        finally:os.close(fd);journal.close()
    require(counts==list(COUNTS.values()) and all(not os.path.lexists(p) for p in TREES.values()),'Approved target remains')
    require(guards(E)==plan['guards'],'Protected guards changed after retirement')
    post=lifecycle(E,lock)
    result={'format':FORMAT,'ok':True,'planSha256':args.sha256,'counts':counts,'recovery':binding,
            'completedAtUnix':int(time.time()),'lifecycle':post,'controllerRewroteHistoricalReceipts':False,
            'originalInodesRestorable':False,'originalCtimeRestorable':False,
            'publisherReserveBytes':C.ROOT_RESERVE_BYTES,'scratchLimitBytes':C.MAX_DEPLOY_SCRATCH_BYTES}
    E.save_new(complete,E.encoded(result));print(json.dumps(result))

def main():
    require(os.geteuid()==0 and sys.flags.isolated,'Require isolated root invocation on UI VPS')
    os.umask(0o077);E,R,C=helpers()
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='operation',required=True)
    p=sub.add_parser('plan');p.add_argument('--manifest',type=Path,required=True);p.add_argument('--proof',type=Path,required=True)
    p=sub.add_parser('apply');p.add_argument('sha256')
    args=parser.parse_args();parent=EVIDENCE.parent
    require(parent.resolve(strict=True)==parent and parent.is_dir(),'Unsafe evidence parent')
    C.check_capacity(parent,MAX_EVIDENCE,256,'d4ee-exact-trees-evidence')
    if not EVIDENCE.exists():
        require(args.operation=='plan','Missing planned evidence directory')
        EVIDENCE.mkdir(mode=0o700);R.sync_directory(parent)
    info=EVIDENCE.lstat()
    require(EVIDENCE.resolve(strict=True)==EVIDENCE and stat.S_ISDIR(info.st_mode) and
            info.st_uid==info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o700,'Unsafe evidence directory')
    lock=E.lock_existing()
    try:(plan_command if args.operation=='plan' else apply_command)(args,E,R,C,lock)
    finally:os.close(lock)

if __name__=='__main__':main()
