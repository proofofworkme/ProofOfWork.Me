#!/usr/bin/env python3
"""One-time owner-approved transport retirement; never ordinary release pruning.

Prepare inventories all 18 roots. Each remove-next removes exactly one root with
stock descriptor-relative, hash and durable journal fences. An interrupted action
is not retried. Completed evidence is append-only; parents and receipts survive.
"""
import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

IDS = tuple('c6ede812dd35-20261023T141326Z 49ce8edc9747-20261023T173335Z 5bdc9e530fd5-20261024T160028Z fd7f97ad2f76-20261024T184200Z c43cd395cf24-20261024T185530Z 3a3d1416659d-20261028T122830Z ad3782737235-20261028T171835Z 5cbbef1d9ee5-20261029T001900Z 9a2c3aa944f0-20261101T024536Z'.split())
BASE = Path('/var/backups/proofofwork-ui')
EVIDENCE = BASE / 'cleanup-evidence/transport-retirement-20261118-v1'
PATHS = tuple(str(BASE/'transport-evidence'/rid/('proofofwork-ui-'+kind+'-'+rid)) for rid in IDS for kind in ('source','surfaces'))
KEEP = ('9f18a0ce7032-20261118T004519Z','a4d2d88cd0b0-20261117T045327Z','1996225ce530-20261116T190348Z')
CONFIG = Path('/etc/proofofwork-retention/ui-lifecycle.json')
STATE = Path('/var/lib/proofofwork-ui-retention/state.json')
LOCK = Path('/run/proofofwork-ui/deploy.lock')
SOURCE_SHA256 = 'fe9ff4f12d1ef8ad14a97b4b8e13d0e2e63fd72a549ada34d3084dbce1bea4f0'
# Same recorded approval, canonically rebound from verified call/handoff/words.
# Preserve the original pin; this adds no approval or scope.
RECOVERED_SOURCE_SHA256 = 'bfb582f96446343ba429261c13cc0242254aab39f02bea95f37a771e489eb63a'

def require(value, message):
    if not value: raise ValueError(message)

def encoded(value): return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def read(path, maximum=64*1024**2):
    p=Path(path); s=p.lstat()
    require(p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o7022 and s.st_size<=maximum,'Unsafe evidence file')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
    try:
        require(os.fstat(fd)==s,'Evidence changed before read'); raw=b''
        while block:=os.read(fd,1024**2):
            raw+=block;require(len(raw)<=maximum,'Evidence exceeded bound')
        require(os.fstat(fd)==s and p.lstat()==s,'Evidence changed during read');return raw
    finally:os.close(fd)

def value(path): return json.loads(read(path))
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def save(path,data):
    raw=encoded(data);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        view=memoryview(raw)
        while view:
            n=os.write(fd,view);require(n>0,'Evidence write stalled');view=view[n:]
        os.fsync(fd)
    finally:os.close(fd)
    sync(Path(path).parent)

def bind(path): return {'path':str(path),'sha256':sha(read(path))}
def bound(binding):
    require(set(binding)=={'path','sha256'},'Unexpected evidence binding');raw=read(binding['path']);require(sha(raw)==binding['sha256'],'Evidence hash changed');return json.loads(raw)

def scope(plan):
    require(plan.get('schema')=='pow-transport-permanent-retirement-v1' and plan.get('paths')==list(PATHS) and plan.get('preservedReleases')==list(KEEP),'Expanded retirement scope')
    approval=plan.get('ownerApproval',{})
    require(set(approval)=={'source','permanent','equivalentCopyClaimed','historicalBuildsAndDependenciesLost'} and sha(encoded(approval['source'])) in (SOURCE_SHA256, RECOVERED_SOURCE_SHA256) and approval['permanent'] is True and approval['equivalentCopyClaimed'] is False and approval['historicalBuildsAndDependenciesLost'] is True,'Owner approval scope differs')

def helpers(config_sha):
    raw=read(CONFIG);require(sha(raw)==config_sha,'Configuration changed');c=json.loads(raw);root=Path(c['package']['path'])
    require(root==Path(__file__).resolve().parents[2],'Use installed approved helper package')
    manifest=read(root/'package.json');require(sha(manifest)==c['package']['sha256'],'Package manifest changed')
    # Authenticate every installed module before importing executable helpers.
    m=json.loads(manifest)
    files=m.get('files');require(m.get('schema')=='pow-ui-retention-package-v1' and isinstance(files,dict) and all(n in files for n in ('deploy/ui-retention/removal.py','deploy/ui-retention/inventory.py','deploy/ui-retention/transport_retirement.py')),'Unknown package manifest')
    for name,record in files.items():
        require(not Path(name).is_absolute() and '..' not in Path(name).parts,'Unsafe package path')
        raw=read(root/name);require(sha(raw)==record['sha256'] and len(raw)==record['bytes'],'Package file changed')
    p=root/'deploy/ui-retention/removal.py';spec=importlib.util.spec_from_file_location('transport_removal',p);w=importlib.util.module_from_spec(spec);sys.modules[spec.name]=w;spec.loader.exec_module(w)
    return w

def protected():
    files=[CONFIG,STATE,Path('/etc/proofofwork-retention/audit28-held-review.json'),Path('/etc/proofofwork-retention/audit29-approved-cleanup.json'),Path('/etc/proofofwork-retention/audit29-completed-retirements.json')]
    roots=[Path('/var/www'),BASE/'rollback-roots'/('proofofwork-www-pre-'+KEEP[0]),BASE/'rollback-roots'/('proofofwork-www-pre-'+KEEP[1])]
    for root,rid in zip(roots,KEEP):
        p=root/'.proofofwork-ui-release';raw=read(p);require(('release_id='+rid+'\n').encode() in raw,'Protected release changed');files.append(p)
        for suffix in ('.sha256','.provenance'):files.append(BASE/'releases'/('proofofwork-ui-release-'+rid+'.tgz'+suffix))
    directories=[]
    for rid in IDS:
        parent=BASE/'transport-evidence'/rid
        for d in (parent,parent/'archive-base'):
            z=d.lstat();require(d.resolve()==d and stat.S_ISDIR(z.st_mode) and z.st_uid==z.st_gid==0 and not z.st_mode&0o7022,'Unsafe retained parent/base')
            directories.append({'path':str(d),'device':z.st_dev,'inode':z.st_ino,'mode':z.st_mode,'uid':z.st_uid,'gid':z.st_gid})
        for p in parent.iterdir():
            if p.name not in ('proofofwork-ui-source-'+rid,'proofofwork-ui-surfaces-'+rid):
                if p.is_file():files.append(p)
                elif p.name=='archive-base':
                    for q in p.rglob('*'):
                        if q.is_file():files.append(q)
    archives=[]
    for rid in KEEP:
        p=BASE/'releases'/('proofofwork-ui-release-'+rid+'.tgz');s=p.lstat();require(p.resolve()==p and stat.S_ISREG(s.st_mode),'Unsafe retained archive')
        archives.append({'path':str(p),'device':s.st_dev,'inode':s.st_ino,'size':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns})
    return {'files':[bind(p) for p in sorted(set(files))],'archives':archives,'directories':directories}

@contextlib.contextmanager
def locked():
    fd=os.open(LOCK,os.O_RDWR|os.O_NOFOLLOW);s=os.fstat(fd)
    require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and not s.st_mode&0o022,'Unsafe deploy lock')
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);require(LOCK.lstat()==os.fstat(fd),'Deploy lock replaced');yield
        require(LOCK.lstat()==os.fstat(fd),'Deploy lock changed')
    finally:os.close(fd)

def prepare(config_sha, approval):
    require(not os.path.lexists(EVIDENCE),'Existing operation requires reconciliation');w=helpers(config_sha)
    plan={'schema':'pow-transport-permanent-retirement-v1','paths':list(PATHS),'preservedReleases':list(KEEP),'ownerApproval':approval,'protected':protected(),'configSha256':config_sha,'beforeAvailableBytes':os.statvfs(BASE).f_bavail*os.statvfs(BASE).f_frsize}
    scope(plan)
    held=value('/etc/proofofwork-retention/audit28-held-review.json')['retain']
    for name in PATHS:
        target=Path(name)
        for row in held:
            if row.get('role')=='ui':
                h=Path(row['path']);require(not(target==h or target in h.parents or h in target.parents),'Exact target intersects a held path')
    plan['references']=w.check_references(PATHS,config_roots=(*w.DEFAULT_CONFIG_ROOTS,'/var/spool/cron'))
    inventories=[]
    for name in PATHS:
        p=Path(name);v=w.E.inventory(p,require_manifest=False,allow_symlinks=True);f=dict(v['fingerprint'],inventory=v['records'],retainedParent={'path':str(p.parent),'identity':w.E.identity(p.parent.lstat()),'xattrs':w.E.xattrs(p.parent)})
        groups={}
        for r in v['records']:
            if r['kind']=='file':
                s=r['identity'];key=(s['st_dev'],s['st_ino']);groups.setdefault(key,[]).append(r)
        require(all(len(rows)==rows[0]['identity']['st_nlink'] for rows in groups.values()),'External hardlink outside exact root')
        w.journal_capacity_bound(f);inventories.append(f)
    require(protected()==plan['protected'],'Protected evidence changed during preparation')
    needed=sum(len(encoded(v))+w.journal_capacity_bound(v) for v in inventories)+8*1024**2
    subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity','check','--path',str(EVIDENCE.parent),'--additional-bytes',str(needed),'--additional-inodes','128','--phase','exact-transport-retirement'],check=True,capture_output=True,timeout=60)
    EVIDENCE.mkdir(mode=0o700);sync(EVIDENCE.parent)
    for i,v in enumerate(inventories):save(EVIDENCE/('inventory-%02d.json'%i),v)
    plan['inventories']=[bind(EVIDENCE/('inventory-%02d.json'%i)) for i in range(len(PATHS))];save(EVIDENCE/'intent.json',plan)
    return {'prepared':True,'intent':bind(EVIDENCE/'intent.json'),'paths':len(PATHS),'reservedBytes':needed}

def remove_next(config_sha):
    w=helpers(config_sha);plan=value(EVIDENCE/'intent.json');scope(plan);require(plan['configSha256']==config_sha and protected()==plan['protected'],'Protected baseline changed')
    require(not os.path.lexists(EVIDENCE/'completed.json'),'Already completed')
    done=[]
    for i,p in enumerate(PATHS):
        receipt=EVIDENCE/('removed-%02d.json'%i)
        if receipt.exists():
            r=action_proof(plan,i);done.append(r)
        else:break
    i=len(done);require(i<len(PATHS),'All targets removed; seal terminal receipt')
    journal_path=EVIDENCE/('journal-%02d.jsonl'%i);require(not os.path.lexists(journal_path),'Interrupted action: do not retry')
    p=Path(PATHS[i]);f=bound(plan['inventories'][i]);require(f['root']==str(p),'Inventory root differs')
    w.check_references(PATHS,config_roots=(*w.DEFAULT_CONFIG_ROOTS,'/var/spool/cron'))
    fresh=w.E.inventory(p,require_manifest=False,allow_symlinks=True);w.E.assert_inventory(fresh,f)
    require(protected()==plan['protected'],'Protected state changed before removal')
    parent=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);journal=w.Journal(journal_path,f)
    try:
        count=w.delete_tree(parent,p.name,f,journal)
        require(count==f['entries'] and journal.count==count and journal.pending is None,'Incomplete descriptor-relative journal')
    finally:journal.close();os.close(parent)
    require(not os.path.lexists(p) and protected()==plan['protected'],'Post-removal protection check failed')
    result={'path':str(p),'outcome':'permanently-retired','entries':count,'inventory':plan['inventories'][i],'journal':bind(journal_path),'intent':bind(EVIDENCE/'intent.json')};save(EVIDENCE/('removed-%02d.json'%i),result)
    return {'removed':str(p),'completedRoots':i+1,'remainingRoots':len(PATHS)-i-1}

def action_proof(plan, i):
    p=PATHS[i]; r=value(EVIDENCE/('removed-%02d.json'%i))
    require(r['path']==p and r['outcome']=='permanently-retired' and not os.path.lexists(p),'Incomplete removal outcome')
    require(r['intent']==bind(EVIDENCE/'intent.json') and r['inventory']==plan['inventories'][i],'Action authority differs')
    require(r['inventory']['path']==str(EVIDENCE/('inventory-%02d.json'%i)) and r['journal']['path']==str(EVIDENCE/('journal-%02d.jsonl'%i)),'Wrong action evidence namespace')
    inv=bound(r['inventory']); require(inv['root']==p and inv['entries']==r['entries']==len(inv['inventory']),'Action inventory count differs')
    rows={v['path']:v for v in inv['inventory']};require(len(rows)==inv['entries'],'Duplicate inventory members')
    raw=read(r['journal']['path']);require(sha(raw)==r['journal']['sha256'],'Removal journal changed')
    lines=raw.splitlines();require(len(lines)==2*r['entries'],'Incomplete journal pairs');seen=set()
    for j in range(0,len(lines),2):
        a,b=json.loads(lines[j]),json.loads(lines[j+1]);x=a['action'];name=x['path']
        require(a['stage']=='intent' and b['stage']=='completed' and b['action']==dict(x,ordinal=j//2+1),'Unpaired removal journal')
        require(name in rows and name not in seen and x['root']==p and x['kind']==rows[name]['kind'],'Journal scope differs')
        row=rows[name];require(all(x['before'][k]==row['identity'][k] for k in (('st_dev','st_ino','st_mode','st_uid','st_gid') if row['kind']=='directory' else ('st_dev','st_ino','st_mode','st_uid','st_gid','st_size'))),'Journal inventory identity differs')
        require((x.get('target')==row['target']) if row['kind']=='symlink' else x.get('sha256')==row.get('sha256'),'Journal payload differs');seen.add(name)
    require(seen==set(rows),'Incomplete journal membership')
    return r

def seal():
    plan=value(EVIDENCE/'intent.json');scope(plan);require(protected()==plan['protected'],'Protected state changed');rows=[]
    for i,p in enumerate(PATHS):
        action_proof(plan,i);rows.append(bind(EVIDENCE/('removed-%02d.json'%i)))
    out={'schema':'pow-transport-permanent-retirement-completed-v1','intent':bind(EVIDENCE/'intent.json'),'removed':rows,'paths':list(PATHS),'allThreeReleasesPreserved':True,'parentEvidencePreserved':True,'equivalentCopyClaimed':False,'afterAvailableBytes':os.statvfs(BASE).f_bavail*os.statvfs(BASE).f_frsize};save(EVIDENCE/'completed.json',out);return out

def verify_terminal():
    if not os.path.lexists(EVIDENCE):return None
    require((EVIDENCE/'completed.json').is_file(),'Exact transport retirement is incomplete; reconcile before publication')
    out=value(EVIDENCE/'completed.json');plan=bound(out['intent']);scope(plan)
    require(out['intent']['path']==str(EVIDENCE/'intent.json'),'Wrong terminal intent namespace')
    require(out.get('schema')=='pow-transport-permanent-retirement-completed-v1' and out['paths']==list(PATHS) and out['allThreeReleasesPreserved'] is True and out['parentEvidencePreserved'] is True and out['equivalentCopyClaimed'] is False and len(out['removed'])==len(PATHS),'Invalid terminal transport retirement')
    for i,(p,b) in enumerate(zip(PATHS,out['removed'])):
        require(b['path']==str(EVIDENCE/('removed-%02d.json'%i)),'Wrong removal receipt namespace');r=bound(b);require(r==action_proof(plan,i),'Terminal action proof differs')
        require(r['inventory']['path']==str(EVIDENCE/('inventory-%02d.json'%i)) and r['journal']['path']==str(EVIDENCE/('journal-%02d.jsonl'%i)),'Wrong action evidence namespace')
        require(r['path']==p and r['outcome']=='permanently-retired' and r['intent']==out['intent'] and r['inventory']==plan['inventories'][i] and not os.path.lexists(p),'Missing or inconsistent permanent retirement')
    return {'receipt':bind(EVIDENCE/'completed.json'),'retiredPaths':list(PATHS),'equivalentCopyClaimed':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('operation',choices=('prepare','remove-next','seal','status'));p.add_argument('--config-sha',required=True);a=p.parse_args();os.umask(0o077)
    with locked():
        helpers(a.config_sha)
        approval_raw=sys.stdin.buffer.read(8193) if a.operation=='prepare' else b''
        require(len(approval_raw)<=8192,'Oversized approval record')
        result=prepare(a.config_sha,json.loads(approval_raw)) if a.operation=='prepare' else remove_next(a.config_sha) if a.operation=='remove-next' else seal() if a.operation=='seal' else verify_terminal()
    print(json.dumps(result,sort_keys=True))

if __name__=='__main__':main()
