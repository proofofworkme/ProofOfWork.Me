#!/usr/bin/python3 -I
"""One approved five-root retirement after independent off-host restoration.

No age discovery, generic retention, hold override or automatic retry exists.
The local dispatcher rechecks custody before sending a source-bound request.
The remote writer has fixed production paths and preserves every other object.
"""
import argparse
import base64
from dataclasses import dataclass
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
import types
import uuid

def load_exporter():
    if '_BOUND_EXPORTER' in globals():return globals()['_BOUND_EXPORTER']
    path=Path(__file__).resolve().with_name('ui-storage-export.py')
    loader=importlib.machinery.SourceFileLoader('pages_storage_export',str(path));spec=importlib.util.spec_from_loader(loader.name,loader)
    module=importlib.util.module_from_spec(spec);loader.exec_module(module);return module

E=load_exporter()
MAX_REQUEST=12*1024**2
RECEIPT_BUDGET=32*1024**2
DEFAULT_CONFIG_ROOTS=('/etc/systemd/system','/etc/caddy','/etc/nginx','/etc/cron.d',
    '/etc/cron.daily','/etc/cron.hourly','/etc/cron.weekly','/etc/cron.monthly',
    '/usr/local/bin','/usr/local/sbin')

@dataclass
class Layout:
    live:Path=Path(E.LIVE)
    rollback_parent:Path=Path(E.BASE.rstrip('/'))
    evidence:Path=Path('/var/backups/proofofwork-ui/cleanup-evidence')
    lock:Path=Path('/run/proofofwork-ui/deploy.lock')
    retention_dir:Path=Path('/etc/proofofwork-retention')
    proc_root:Path=Path('/proc')
    config_roots:tuple=DEFAULT_CONFIG_ROOTS
    production:bool=True

def scope_fence(proposal,layout):
    selected=[r['root'] for r in proposal['selectedRoots']]
    E.require(len(selected)==5 and len(set(selected))==5,'Retirement requires exactly five roots')
    E.require(all(Path(p).parent==layout.rollback_parent for p in selected),'Root outside exact rollback parent')
    E.require(proposal['protected']['current']['root']==str(layout.live),'Live root binding differs')
    E.require(proposal['protected']['immediatePrior']['root'] not in selected,'Immediate prior cannot be retired')
    if layout.production:
        E.require(selected==E.ROOT_PATHS and layout==Layout(),'Production layout or five-path scope differs')
        E.require(os.geteuid()==os.getegid()==0,'Production retirement requires root')
    else:
        for p in (layout.live,layout.rollback_parent,layout.evidence,layout.lock,layout.retention_dir):
            E.require(str(p).startswith('/tmp/') and Path(p).resolve()==Path(p),'Fixture layout must stay in canonical /tmp')

def validate_custody(custody,proposal):
    E.require(custody.get('schema')=='proof-of-work-pages-ui-custody-v1'
        and custody.get('proposalSha256')==E.PROPOSAL_SHA and custody.get('approvalSha256')==E.APPROVAL_SHA,'Custody approval binding differs')
    exports=custody.get('exports',[]);restorations=custody.get('restorations',[])
    E.require(len(exports)==len(restorations)==5,'Incomplete off-host custody')
    durable=Path(custody['durableDirectory'])
    E.require(durable.is_absolute() and str(durable)==custody['durableDirectory'] and '..' not in durable.parts
        and not any(str(durable)==p or str(durable).startswith(p+'/') for p in ('/tmp','/var/tmp','/run','/dev/shm')),'Custody must be in canonical durable off-host storage')
    for expected,export,restored in zip(proposal['selectedRoots'],exports,restorations):
        fp={k:expected[k] for k in ('format','classification','root','manifestSha256','treeSha256','entries','regularBytes')}
        E.require(export.get('sourceRoot')==expected['root'] and export.get('fingerprint')==fp
            and export.get('proposalSha256')==E.PROPOSAL_SHA and export.get('approvalSha256')==E.APPROVAL_SHA
            and export.get('inventorySha256')==E.inventory_sha(expected['inventory']),'Export root or metadata binding differs')
        name=Path(expected['root']).name
        E.require(export['archivePath']==str(durable/(name+'.tgz')),'Export archive path differs')
        E.require(restored.get('schema')=='proof-of-work-pages-ui-offhost-restore-v1'
            and restored.get('sourceRoot')==expected['root']
            and restored.get('archivePath')==export['archivePath']
            and restored.get('archiveSha256')==export['archiveSha256']
            and restored.get('archiveBytes')==export['archiveBytes']
            and restored.get('restoredPath')==str(durable/'restored'/name)
            and restored.get('inventorySha256')==E.inventory_sha(expected['inventory'])
            and restored.get('fingerprint')=={k:v for k,v in fp.items() if k!='root'},'Independent restoration binding differs')
        E.require(all(restored.get(k) is True for k in ('ownerRestored','modeTimesXattrsRestored','internalHardlinksRestored')),'Incomplete independent metadata restoration')
        for key in ('archiveSha256',):E.require(re.fullmatch('[0-9a-f]{64}',export[key]) is not None,'Malformed custody SHA')
        E.require(type(export['archiveBytes']) is int and 0<export['archiveBytes']<=E.MAX_ROOT_BYTES,'Archive byte envelope differs')
        for key in ('uidMap','gidMap'):
            mappings=[tuple(map(int,line.split())) for line in restored[key].splitlines()]
            E.require(any(start==0 and count>=1 for start,host,count in mappings),'Restoration did not verify namespace owner0')
    for key in ('exporterSha256','exportIndexSha256','restorationRecipeSha256'):
        E.require(re.fullmatch('[0-9a-f]{64}',custody[key]) is not None,'Malformed custody source/recipe SHA')
    return custody

def verify_custody_directory(directory):
    directory=Path(directory);E.require(directory.resolve(strict=True)==directory and directory.is_dir(),'Durable custody directory is not canonical')
    pr,_=E.read_regular(directory/'proposal.json');ar,_=E.read_regular(directory/'human-approval.json',65536)
    proposal=E.validate_proposal(pr);approval=E.validate_approval(ar);raw,_=E.read_regular(directory/'custody.json')
    custody=validate_custody(json.loads(raw),proposal);E.require(custody['durableDirectory']==str(directory),'Custody directory changed')
    index_raw,_=E.read_regular(directory/'export-index.json');recipe_raw,_=E.read_regular(directory/'restoration-recipe.json');source,_=E.read_regular(directory/'exporter.py',1024**2)
    E.require(E.digest(index_raw)==custody['exportIndexSha256'] and E.digest(recipe_raw)==custody['restorationRecipeSha256'] and E.digest(source)==custody['exporterSha256'],'Custody index/recipe/exporter changed')
    index=json.loads(index_raw);E.require(index['exports']==custody['exports'] and index['proposalSha256']==E.PROPOSAL_SHA and index['approvalSha256']==E.APPROVAL_SHA and index['exporterSha256']==custody['exporterSha256'],'Custody export index differs')
    for expected,restored in zip(proposal['selectedRoots'],custody['restorations']):
        archive=Path(restored['archivePath']);b,_=E.read_regular(archive,E.MAX_ROOT_BYTES)
        E.require(E.digest(b)==restored['archiveSha256'] and len(b)==restored['archiveBytes'],'Off-host archive changed before retirement request')
        receipt,_=E.read_regular(directory/(Path(expected['root']).name+'.restoration.json'))
        E.require(json.loads(receipt)==restored,'Independent restoration receipt changed')
        actual=E.verify_restored(Path(restored['restoredPath']),expected)
        for key in ('inventorySha256','ownerRestored','modeTimesXattrsRestored','internalHardlinksRestored','fingerprint'):
            E.require(actual[key]==restored[key],'Fresh off-host restoration verification differs')
    return proposal,approval,custody,pr,ar,raw

def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
    try:os.fsync(fd)
    finally:os.close(fd)

def sync_custody(directory,proposal):
    """Flush archive/restoration metadata and their outer directory entry."""
    directory=Path(directory);seen=set()
    files=[directory/n for n in E.names(directory) if (directory/n).is_file()]
    directories=[directory/'restored',directory]
    for root in proposal['selectedRoots']:
        restored=directory/'restored'/Path(root['root']).name
        for row in root['inventory']:
            path=restored if row['path']=='.' else restored/row['path']
            if row['kind']=='directory':directories.append(path)
            else:files.append(path)
    for path in files:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
        try:
            s=os.fstat(fd);key=(s.st_dev,s.st_ino)
            E.require(stat.S_ISREG(s.st_mode),'Custody flush encountered a nonregular object')
            if key not in seen:os.fsync(fd);seen.add(key)
        finally:os.close(fd)
    for path in sorted(set(directories),key=lambda p:len(p.parts),reverse=True):sync_directory(path)
    sync_directory(directory.parent)

def referenced(value,paths):
    if isinstance(value,bytes):return any(os.fsencode(p) in value for p in paths)
    value=value.removesuffix(' (deleted)')
    return any(value==p or value.startswith(p+'/') for p in paths)

def loaded_unit_paths():
    """Read every loaded unit's native/transient FragmentPath and DropInPaths."""
    env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
    r=subprocess.run(['/usr/bin/systemctl','list-units','--all','--plain','--no-legend','--no-pager'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,check=True)
    E.require(len(r.stdout)<=2*1024**2,'Loaded unit inventory exceeds bound')
    units=[line.split()[0] for line in r.stdout.decode().splitlines() if line.split()]
    E.require(len(units)<=8192 and all(not u.startswith('-') for u in units),'Loaded unit count/name bound exceeded')
    result=set()
    for start in range(0,len(units),128):
        r=subprocess.run(['/usr/bin/systemctl','show','--property=Id,FragmentPath,DropInPaths',*units[start:start+128]],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,check=True)
        E.require(len(r.stdout)<=2*1024**2,'Loaded unit path inventory exceeds bound')
        for line in r.stdout.decode().splitlines():
            if line.startswith('FragmentPath=') or line.startswith('DropInPaths='):
                for value in line.split('=',1)[1].split():
                    E.require(value.startswith('/') and '\\' not in value,'Unsupported loaded unit path encoding')
                    result.add(value)
    return sorted(result)

def check_references(paths,proc_root=Path('/proc'),config_roots=DEFAULT_CONFIG_ROOTS,ignore_pid=None,loaded_paths=None):
    paths=[str(p) for p in paths];proc_root=Path(proc_root);ignore_pid=os.getpid() if ignore_pid is None else ignore_pid
    report={'processes':0,'fdEntries':0,'configurationEntries':0,'configurationBytes':0,'mountNamespaceReads':0,'readBound':1024**2,'configRoots':[str(p) for p in config_roots],'loadedUnitFiles':[]}
    def proc_read(path,limit=2*1024**2):
        try:
            with open(path,'rb') as f:raw=f.read(limit+1)
            E.require(len(raw)<=limit,'Process reference read bound exceeded');return raw
        except FileNotFoundError:return None
    for process in sorted(proc_root.iterdir()):
        if not process.name.isdecimal():continue
        report['processes']+=1;E.require(report['processes']<=8192,'Process reference entry bound exceeded')
        mounts=proc_read(process/'mountinfo')
        if mounts is not None:
            report['mountNamespaceReads']+=1
            for line in mounts.decode().splitlines():
                parts=line.split();E.require(len(parts)>=6,'Malformed process mount record')
                root=re.sub(r'\\([0-7]{3})',lambda m:chr(int(m[1],8)),parts[3]);target=re.sub(r'\\([0-7]{3})',lambda m:chr(int(m[1],8)),parts[4])
                E.require(not referenced(root,paths) and not referenced(target,paths),'Selected root has a mount in a process namespace')
        if int(process.name)==ignore_pid:continue
        for name in ('cwd','root','exe'):
            try:value=os.readlink(process/name)
            except FileNotFoundError:continue
            E.require(not referenced(value,paths),'Live process directory or executable references selected root')
        try:descriptors=sorted((process/'fd').iterdir())
        except FileNotFoundError:descriptors=[]
        for descriptor in descriptors:
            report['fdEntries']+=1;E.require(report['fdEntries']<=100000,'Open descriptor reference bound exceeded')
            try:value=os.readlink(descriptor)
            except FileNotFoundError:continue
            E.require(not referenced(value,paths),'Open file descriptor references selected root')
        for name in ('cmdline','maps'):
            raw=proc_read(process/name,1024**2)
            E.require(raw is None or not referenced(raw,paths),'Live process text references selected root')
    for root in config_roots:
        root=Path(root)
        if not os.path.lexists(root):continue
        pending=[root]
        while pending:
            p=pending.pop();s=p.lstat();report['configurationEntries']+=1
            E.require(report['configurationEntries']<=100000,'Configuration reference entry bound exceeded')
            if stat.S_ISLNK(s.st_mode):
                target=p.resolve(strict=False);E.require(not referenced(str(target),paths),'Configuration symlink references selected root')
                # A loaded systemd unit may be a symlink into /usr/lib. Its
                # configured paths still matter even though its bytes are outside
                # the starting scan root. /dev/null mask targets are not read.
                if target.is_file():
                    E.require(target.suffix.lower() not in ('.key','.pem') and target.name!='.env','Secret symlink target requires separate review')
                    raw,_=E.read_regular(target,1024**2);report['configurationBytes']+=len(raw)
                    E.require(report['configurationBytes']<=128*1024**2 and not referenced(raw,paths),'Resolved configuration references selected root')
            elif stat.S_ISDIR(s.st_mode):pending.extend(p/n for n in E.names(p))
            elif stat.S_ISREG(s.st_mode):
                E.require(s.st_size<=1024**2,'Configuration file exceeds reference read bound')
                # Credentials are not an operator/configuration search target.
                E.require(p.suffix.lower() not in ('.key','.pem') and p.name!='.env','Secret file in configured reference roots requires separate review')
                raw,_=E.read_regular(p,1024**2);report['configurationBytes']+=len(raw)
                E.require(report['configurationBytes']<=128*1024**2,'Configuration reference byte bound exceeded')
                E.require(not referenced(raw,paths),'Production configuration or installed operator references selected root')
            else:raise ValueError('Unexpected configuration reference object')
    if loaded_paths is None:loaded_paths=loaded_unit_paths() if proc_root==Path('/proc') else []
    for value in loaded_paths:
        path=Path(value);before=path.lstat();resolved=path.resolve(strict=True);E.require(not referenced(str(resolved),paths),'Loaded unit file references selected root')
        if resolved==Path('/dev/null'):
            s=resolved.lstat();E.require(stat.S_ISCHR(s.st_mode) and os.major(s.st_rdev)==1 and os.minor(s.st_rdev)==3 and s.st_uid==s.st_gid==0,'Unsafe loaded mask target')
            report['loadedUnitFiles'].append(dict(path=str(path),kind='qualified-dev-null-mask-target',target='/dev/null',identity=E.identity(s)))
            E.require(path.lstat()==before and path.resolve(strict=True)==resolved,'Loaded mask path changed');continue
        raw,s=E.read_regular(resolved,1024**2)
        E.require(path.lstat()==before and path.resolve(strict=True)==resolved,'Loaded unit path changed during read')
        E.require(not referenced(raw,paths),'Loaded native/transient unit or drop-in references selected root')
        report['configurationBytes']+=len(raw);E.require(report['configurationBytes']<=128*1024**2,'Loaded configuration byte bound exceeded')
        report['loadedUnitFiles'].append(dict(path=str(path),sha256=E.digest(raw),identity=E.identity(s)))
    return report

def delete_tree(parent_fd,root_name,expected_root,journal,action_hook=None):
    """Descriptor-relative removal; only identities changed by our own actions advance."""
    rows=expected_root['inventory'];by_path={r['path']:r for r in rows};groups={};inode_state={};directory_state={};completed=0;ancestors=[]
    for row in rows:
        s=row['identity'];key=(s['st_dev'],s['st_ino'])
        if row['kind']=='file':groups.setdefault(key,[]).append(row['path']);inode_state[key]=dict(s)
        else:directory_state[row['path']]=dict(s)
    E.require(all(len(names)==inode_state[key]['st_nlink'] for key,names in groups.items()),'Deletion scope has external hardlinks')
    def root_entry_fence():
        actual=E.identity(os.stat(root_name,dir_fd=parent_fd,follow_symlinks=False));original=by_path['.']['identity']
        E.require(all(actual[k]==original[k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')),'Approved root parent entry was renamed or replaced')
        for parent,name,held,relative in ancestors:
            current=E.identity(os.stat(name,dir_fd=parent,follow_symlinks=False));opened=E.identity(os.fstat(held))
            E.require(current==opened==directory_state[relative],'Opened ancestor was renamed, replaced or changed')
    def hook(phase,action):
        if action_hook:action_hook(phase,action)
    def remove(parent,name,relative):
        nonlocal completed
        row=by_path[relative];s=row['identity'];current=os.stat(name,dir_fd=parent,follow_symlinks=False);key=(s['st_dev'],s['st_ino'])
        expected=inode_state[key] if row['kind']=='file' else directory_state[relative]
        root_entry_fence()
        E.require(E.identity(current)==expected,'Descriptor-relative entry identity changed')
        child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME|(os.O_DIRECTORY if row['kind']=='directory' else 0),dir_fd=parent)
        if row['kind']=='directory':ancestors.append((parent,name,child,relative))
        try:
            E.require(E.identity(os.fstat(child))==expected,'Opened retirement entry differs')
            E.require([[n,os.getxattr(child,n).hex()] for n in sorted(os.listxattr(child))]==row['xattrs'],'Retirement attributes changed')
            if row['kind']=='directory':
                children=sorted(Path(r['path']).name for r in rows if r['path']!='.' and str(Path(r['path']).parent)==('.' if relative=='.' else relative))
                E.require(sorted(os.listdir(child))==children,'Retirement directory membership changed')
                for n in children:
                    child_relative=n if relative=='.' else relative+'/'+n;remove(child,n,child_relative)
                    before=directory_state[relative];after=E.identity(os.fstat(child))
                    E.require(all(after[k]==before[k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_atime_ns')),'Parent directory identity changed unexpectedly')
                    expected_links=before['st_nlink']-(1 if by_path[child_relative]['kind']=='directory' else 0)
                    E.require(after['st_nlink']==expected_links,'Directory link topology changed unexpectedly');directory_state[relative]=after
                E.require(os.listdir(child)==[],'Retirement directory acquired an entry')
            else:
                h=hashlib.sha256();count=0
                while b:=os.read(child,1024**2):count+=len(b);h.update(b)
                E.require(count==s['st_size'] and h.hexdigest()==row['sha256'],'Retirement payload changed')
            expected=inode_state[key] if row['kind']=='file' else directory_state[relative]
            E.require(E.identity(os.fstat(child))==expected and E.identity(os.stat(name,dir_fd=parent,follow_symlinks=False))==expected,'Entry changed immediately before retirement')
            action=dict(root=expected_root['root'],path=relative,kind=row['kind'],before=expected,sha256=row.get('sha256'))
            journal('intent',action);hook('before-unlink',action)
            root_entry_fence()
            E.require(E.identity(os.stat(name,dir_fd=parent,follow_symlinks=False))==expected,'Entry replaced after retirement intent')
            if row['kind']=='directory':os.rmdir(name,dir_fd=parent)
            else:os.unlink(name,dir_fd=parent)
            os.fsync(parent);completed+=1
            if row['kind']=='file':
                after=E.identity(os.fstat(child))
                E.require(after['st_nlink']==expected['st_nlink']-1 and all(after[k]==expected[k] for k in E.STAT_FIELDS if k not in ('st_nlink','st_ctime_ns')),'Hardlink identity changed unexpectedly after unlink')
                inode_state[key]=after
            hook('after-unlink',action);journal('completed',dict(**action,ordinal=completed))
        finally:
            if row['kind']=='directory':ancestors.pop()
            os.close(child)
    root_before=os.stat(root_name,dir_fd=parent_fd,follow_symlinks=False)
    E.require(E.identity(root_before)==by_path['.']['identity'],'Final parent root entry differs from approved root')
    remove(parent_fd,root_name,'.');return completed

def production_capacity(layout):
    env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'}
    for argv in [
        ['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity','check','--path',str(layout.evidence),'--additional-bytes',str(RECEIPT_BUDGET),'--additional-inodes','128','--phase','approved-pages-five-roots'],
        ['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity','check-scratch','--path','/var/tmp/proofofwork-deploy','--additional-bytes','0','--additional-inodes','0','--phase','approved-pages-five-roots']]:
        p=subprocess.run(argv,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60,check=True)
        E.require(len(p.stdout)+len(p.stderr)<=1024**2,'Capacity output exceeds bound')

class Journal:
    def __init__(self,path):
        self.path=Path(path);self.fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_APPEND|os.O_NOFOLLOW,0o600);self.count=0;self.bytes=0
        sync_directory(self.path.parent)
    def __call__(self,stage,action):
        raw=E.encoded(dict(stage=stage,action=action,atUtc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())))
        self.bytes+=len(raw);E.require(self.bytes<=16*1024**2,'Retirement journal exceeds reserved envelope');view=memoryview(raw)
        while view:view=view[os.write(self.fd,view):]
        os.fsync(self.fd)
        if stage=='completed':self.count+=1
    def close(self):os.close(self.fd)

def retire_exact(proposal,approval,custody,layout,*,fence=None,reference_check=None,capacity_check=None,action_hook=None,execution_id=None,proposal_raw=None,approval_raw=None,custody_raw=None,source_pins=None):
    scope_fence(proposal,layout)
    if layout.production:
        E.require(not any(cb is not None for cb in (fence,reference_check,capacity_check,action_hook)),'Production cannot override guards')
        E.validate_proposal(proposal_raw);E.validate_approval(approval_raw);validate_custody(custody,proposal)
    execution_id=execution_id or time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+uuid.uuid4().hex[:12]
    E.require(re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,63}',execution_id) is not None,'Unsafe execution namespace')
    for p in (layout.live,layout.rollback_parent,layout.evidence,layout.retention_dir):
        s=p.lstat();E.require(p.resolve(strict=True)==p and stat.S_ISDIR(s.st_mode) and s.st_uid==os.geteuid() and not s.st_mode&0o7022,'Unsafe retirement ancestor')
    E.require(not any(n.startswith('pages-five-roots-b7ec8574-') for n in E.names(layout.evidence)),'Existing approved retirement intent requires explicit reconciliation; no automatic retry')
    descriptor=E.lock_existing(layout.lock) if layout.production else os.open(layout.lock,os.O_RDONLY|os.O_NOFOLLOW)
    if not layout.production:
        import fcntl
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
    held_lock_identity=E.identity(os.fstat(descriptor))
    remaining=[r['root'] for r in proposal['selectedRoots']];finished=[];receipt=None;journal=None;started=time.monotonic()
    def guard():
        E.require(time.monotonic()-started<1800,'Retirement deadline exceeded')
        E.require(E.identity(layout.lock.lstat())==held_lock_identity and E.identity(os.fstat(descriptor))==held_lock_identity,'Deploy lock pathname or descriptor changed')
        if 'deployLock' in proposal:E.require(held_lock_identity==proposal['deployLock']['identity'] and str(layout.lock)==proposal['deployLock']['path'],'Deploy lock differs from exact approved census')
        if fence:fence(remaining)
        elif layout.production:E.production_fence(proposal,remaining)
        else:
            for row in [proposal['protected']['current'],proposal['protected']['immediatePrior'],*[r for r in proposal['selectedRoots'] if r['root'] in remaining]]:
                E.assert_inventory(E.inventory(row['root'],os.geteuid()),row)
        return reference_check(remaining) if reference_check else check_references(remaining,layout.proc_root,layout.config_roots)
    old_handlers={}
    def interrupted(number,frame):raise InterruptedError('Retirement interrupted by signal '+str(number))
    try:
        E.require(not any(n.startswith('pages-five-roots-b7ec8574-') for n in E.names(layout.evidence)),'Existing approved retirement intent requires explicit reconciliation; no automatic retry')
        references=guard()
        if capacity_check:capacity_check()
        elif layout.production:production_capacity(layout)
        before_space=os.statvfs(layout.evidence)
        before_available=before_space.f_bavail*before_space.f_frsize;before_inodes=before_space.f_favail
        receipt=layout.evidence/('pages-five-roots-b7ec8574-'+execution_id);receipt.mkdir(mode=0o700)
        sync_directory(layout.evidence)
        if proposal_raw is not None:E.save_new(receipt/'proposal.json',proposal_raw)
        if approval_raw is not None:E.save_new(receipt/'human-approval.json',approval_raw)
        if custody_raw is not None:E.save_new(receipt/'custody.json',custody_raw)
        intent=dict(schema='proof-of-work-pages-ui-retirement-intent-v1',status='approved-intent',proposalSha256=E.PROPOSAL_SHA,approvalSha256=E.APPROVAL_SHA,custodySha256=E.digest(custody_raw or E.encoded(custody)),sourcePins=source_pins,selectedRoots=[{k:r[k] for k in ('root','manifestSha256','treeSha256','entries','regularBytes')} for r in proposal['selectedRoots']],protected=proposal['protected'],references=references)
        E.save_new(receipt/'intent.json',E.encoded(intent));journal=Journal(receipt/'actions.jsonl')
        for number in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):old_handlers[number]=signal.signal(number,interrupted)
        for row in proposal['selectedRoots']:
            references=guard();parent=os.open(layout.rollback_parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
            try:count=delete_tree(parent,Path(row['root']).name,row,journal,action_hook)
            finally:os.close(parent)
            remaining.remove(row['root']);finished.append(dict(root=row['root'],outcome='retired',actions=count,treeSha256=row['treeSha256']))
            E.save_new(receipt/('partial-'+str(len(finished))+'.json'),E.encoded(dict(status='partial',completed=finished,remaining=remaining,journalCompletedActions=journal.count)))
        guard();space=os.statvfs(layout.evidence)
        done=dict(schema='proof-of-work-pages-ui-retirement-result-v1',status='completed',proposalSha256=E.PROPOSAL_SHA,approvalSha256=E.APPROVAL_SHA,custodySha256=E.digest(custody_raw or E.encoded(custody)),completed=finished,remaining=[],protectedPairUnchanged=True,helpersHoldsTimersUnchanged=True,journalCompletedActions=journal.count,
            beforeAvailableBytes=before_available,beforeAvailableInodes=before_inodes,availableBytes=space.f_bavail*space.f_frsize,availableInodes=space.f_favail,
            measuredAvailableBytesDelta=space.f_bavail*space.f_frsize-before_available,measuredAvailableInodesDelta=space.f_favail-before_inodes,
            measurementQualification='Filesystem endpoints include new durable receipts and concurrent background writes; the observed delta is not the sum of logical or hardlinked sizes.',
            receipt=str(receipt),seconds=round(time.monotonic()-started,3),sourcePins=source_pins)
        E.save_new(receipt/'completed.json',E.encoded(done));return done
    except BaseException as error:
        if receipt is not None:
            failed=dict(schema='proof-of-work-pages-ui-retirement-result-v1',status='failed',errorClass=type(error).__name__,error=str(error),completed=finished,remaining=remaining,receipt=str(receipt),journalCompletedActions=journal.count if journal else 0,reconciliationRequired=True,automaticRetryAllowed=False)
            E.save_new(receipt/'failure.json',E.encoded(failed))
        raise
    finally:
        for number,handler in old_handlers.items():signal.signal(number,handler)
        if journal:journal.close()
        os.close(descriptor)

def prepare(directory,output):
    proposal,approval,custody,pr,ar,cr=verify_custody_directory(directory)
    sync_custody(directory,proposal)
    writer,_=E.read_regular(Path(__file__).resolve(),1024**2);exporter,_=E.read_regular(Path(__file__).resolve().with_name('ui-storage-export.py'),1024**2)
    E.require(E.digest(exporter)==custody['exporterSha256'],'Exporter source differs from verified custody')
    request=dict(schema='proof-of-work-pages-ui-retirement-request-v1',proposalRawBase64=base64.b64encode(pr).decode(),approvalRawBase64=base64.b64encode(ar).decode(),custodyRawBase64=base64.b64encode(cr).decode(),custodySha256=E.digest(cr),writerSha256=E.digest(writer),exporterSha256=E.digest(exporter),executionId=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+uuid.uuid4().hex[:12])
    raw=E.encoded(request);E.require(len(raw)<=MAX_REQUEST,'Request exceeds bound');E.save_new(output,raw)
    return dict(path=str(output),sha256=E.digest(raw),custodySha256=E.digest(cr),writerSha256=request['writerSha256'],exporterSha256=request['exporterSha256'])

def decode_request(raw,writer_sha,exporter_sha):
    E.require(len(raw)<=MAX_REQUEST,'Retirement request exceeds bound');r=json.loads(raw)
    E.require(r.get('schema')=='proof-of-work-pages-ui-retirement-request-v1' and r.get('writerSha256')==writer_sha and r.get('exporterSha256')==exporter_sha,'Writer/exporter source binding differs')
    pr=base64.b64decode(r['proposalRawBase64'],validate=True);ar=base64.b64decode(r['approvalRawBase64'],validate=True);cr=base64.b64decode(r['custodyRawBase64'],validate=True)
    proposal=E.validate_proposal(pr);approval=E.validate_approval(ar);E.require(E.digest(cr)==r['custodySha256'],'Custody raw SHA differs')
    custody=validate_custody(json.loads(cr),proposal);E.require(custody['exporterSha256']==exporter_sha,'Custody exporter source differs')
    return r,proposal,approval,custody,pr,ar,cr

def remote_apply(raw):
    writer_sha=globals()['_BOUND_WRITER_SHA'];exporter_sha=globals()['_BOUND_EXPORTER_SHA']
    r,p,a,c,pr,ar,cr=decode_request(raw,writer_sha,exporter_sha)
    return retire_exact(p,a,c,Layout(),execution_id=r['executionId'],proposal_raw=pr,approval_raw=ar,custody_raw=cr,source_pins=dict(writerSha256=writer_sha,exporterSha256=exporter_sha,requestSha256=E.digest(raw)))

def apply(request_path,log):
    raw,_=E.read_regular(request_path,MAX_REQUEST);writer,_=E.read_regular(Path(__file__).resolve(),1024**2);exporter,_=E.read_regular(Path(__file__).resolve().with_name('ui-storage-export.py'),1024**2)
    r,p,a,c,*_=decode_request(raw,E.digest(writer),E.digest(exporter));fresh=verify_custody_directory(c['durableDirectory'])
    E.require(E.digest(fresh[-1])==r['custodySha256'] and fresh[2]==c,'Fresh durable custody differs from prepared request')
    program='import base64,types,json\nns={"__name__":"_export"}\nexec(compile(base64.b64decode('+repr(base64.b64encode(exporter).decode())+'),"bound-exporter.py","exec"),ns)\nexporter=types.SimpleNamespace(**ns)\nwriter={"__name__":"_retire","_BOUND_EXPORTER":exporter,"_BOUND_WRITER_SHA":'+repr(E.digest(writer))+',"_BOUND_EXPORTER_SHA":'+repr(E.digest(exporter))+'}\nexec(compile(base64.b64decode('+repr(base64.b64encode(writer).decode())+'),"bound-writer.py","exec"),writer)\nprint(json.dumps(writer["remote_apply"](base64.b64decode('+repr(base64.b64encode(raw).decode())+')),sort_keys=True))\n'
    command=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--collect','--service-type=exec',
        '--unit=pages-storage-b7ec8574-'+r['executionId'],'--property=RuntimeMaxSec=1800','--property=CPUQuota=50%',
        '--property=MemoryMax=1G','--property=MemorySwapMax=0','--property=TasksMax=64','--property=UMask=0077',
        '--property=Nice=15','--property=IOSchedulingClass=idle','/usr/bin/python3','-I','-B','-']
    ssh=E.SSH[:-1]+['-o','UserKnownHostsFile=/home/sixer/.ssh/known_hosts',E.SSH[-1]]
    try:p=subprocess.run(ssh+[shlex_join(command)],input=program.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=1900)
    except subprocess.TimeoutExpired as error:
        E.save_new(log,E.encoded(dict(status='uncertain',errorClass='TimeoutExpired',stdout=(error.stdout or b'')[-1024**2:].decode(errors='replace'),stderr=(error.stderr or b'')[-1024**2:].decode(errors='replace'),requestSha256=E.digest(raw),managedUnit='pages-storage-b7ec8574-'+r['executionId'],automaticRetryAllowed=False)))
        raise ValueError('Retirement dispatcher timed out; inspect managed unit and durable remote receipt before recovery or further action') from error
    E.require(len(p.stdout)+len(p.stderr)<=2*1024**2,'Retirement dispatcher output exceeds bound');E.save_new(log,E.encoded(dict(returnCode=p.returncode,stdout=p.stdout.decode(),stderr=p.stderr.decode(),requestSha256=E.digest(raw))))
    E.require(p.returncode==0,'Retirement failed or uncertain; preserve log and reconcile remote receipt before any further action')
    return json.loads(p.stdout.decode().splitlines()[-1])

def shlex_join(argv):
    import shlex
    return shlex.join(argv)

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare');p.add_argument('--custody',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('apply');p.add_argument('--request',type=Path,required=True);p.add_argument('--log',type=Path,required=True)
    a=parser.parse_args();result=prepare(a.custody,a.output) if a.command=='prepare' else apply(a.request,a.log);print(json.dumps(result,sort_keys=True))

if __name__=='__main__':main()
