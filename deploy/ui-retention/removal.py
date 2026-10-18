"""Descriptor-relative retirement of fully inventoried custody-qualified trees."""
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


def load_inventory():
    if '_BOUND_EXPORTER' in globals():return globals()['_BOUND_EXPORTER']
    spec=importlib.util.spec_from_file_location('retention_inventory',Path(__file__).with_name('inventory.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
E=load_inventory()
DEFAULT_CONFIG_ROOTS=('/etc/systemd/system','/etc/caddy','/etc/nginx','/etc/cron.d','/etc/cron.daily','/etc/cron.hourly','/etc/cron.weekly','/etc/cron.monthly','/usr/local/bin','/usr/local/sbin')

def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
    try:os.fsync(fd)
    finally:os.close(fd)


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
    E.require(len(units)<=8192,'Loaded unit count bound exceeded')
    result=set()
    for start in range(0,len(units),128):
        r=subprocess.run(['/usr/bin/systemctl','show','--property=Id,FragmentPath,DropInPaths','--',*units[start:start+128]],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,check=True)
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
    rows=expected_root['inventory'];child_names=E.directory_children(rows);by_path={r['path']:r for r in rows};groups={};inode_state={};directory_state={};completed=0;ancestors=[]
    for row in rows:
        s=row['identity'];key=(s['st_dev'],s['st_ino'])
        if row['kind']=='file':groups.setdefault(key,[]).append(row['path']);inode_state[key]=dict(s)
        else:directory_state[row['path']]=dict(s)
    E.require(all(len(names)==inode_state[key]['st_nlink'] for key,names in groups.items()),'Deletion scope has external hardlinks')
    def root_entry_fence():
        retained=expected_root.get('retainedParent')
        if retained:
            named=E.identity(Path(retained['path']).lstat());opened=E.identity(os.fstat(parent_fd));before=retained['identity']
            E.require(named==opened and Path(retained['path']).resolve(strict=True)==Path(retained['path']) and all(opened[k]==before[k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')),'Containing evidence directory was renamed or replaced')
            E.require([[n,os.getxattr(parent_fd,n).hex()] for n in sorted(os.listxattr(parent_fd))]==retained['xattrs'],'Containing evidence directory attributes changed')
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
        if row['kind']=='symlink':
            E.require(os.readlink(name,dir_fd=parent)==row['target'], 'Retirement link target changed')
            action=dict(root=expected_root['root'],path=relative,kind='symlink',before=expected,target=row['target'])
            journal('intent',action);hook('before-unlink',action);root_entry_fence()
            E.require(E.identity(os.stat(name,dir_fd=parent,follow_symlinks=False))==expected, 'Link replaced after intent')
            E.require(os.readlink(name,dir_fd=parent)==row['target'], 'Link target replaced after intent')
            os.unlink(name,dir_fd=parent);os.fsync(parent);completed+=1
            hook('after-unlink',action);journal('completed',dict(**action,ordinal=completed));return
        child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME|(os.O_DIRECTORY if row['kind']=='directory' else 0),dir_fd=parent)
        if row['kind']=='directory':ancestors.append((parent,name,child,relative))
        try:
            E.require(E.identity(os.fstat(child))==expected,'Opened retirement entry differs')
            E.require([[n,os.getxattr(child,n).hex()] for n in sorted(os.listxattr(child))]==row['xattrs'],'Retirement attributes changed')
            if row['kind']=='directory':
                children=child_names.get(relative,[])
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


def delete_file_group(parent_fd, expected_root, journal, action_hook=None):
    """Remove only a complete inventoried sibling group, retaining its parent."""
    E.require(expected_root['format']=='proofofwork-ui-retained-files-v1','Not a closed file group')
    parent=expected_root['parent'];rows=expected_root['inventory'];completed=0
    E.require(1<=len(rows)<=16 and all(r['kind']=='file' and Path(r['path']).name==r['path'] for r in rows),'Unsafe selective retirement membership')
    E.require(len({r['path'] for r in rows})==len(rows),'Duplicate selective retirement member')
    def parent_fence():
        opened=E.identity(os.fstat(parent_fd));named=E.identity(Path(parent['path']).lstat());before=parent['identity']
        E.require(opened==named and Path(parent['path']).resolve(strict=True)==Path(parent['path']),'Selected file parent was renamed or replaced')
        E.require(all(opened[k]==before[k] for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')),'Selected file parent authority changed')
        E.require([[n,os.getxattr(parent_fd,n).hex()] for n in sorted(os.listxattr(parent_fd))]==parent['xattrs'],'Selected file parent attributes changed')
    # A partial/missing group refuses before the first mutation.
    for row in rows:
        parent_fence();s=E.identity(os.stat(row['path'],dir_fd=parent_fd,follow_symlinks=False))
        E.require(s==row['identity'] and stat.S_ISREG(s['st_mode']) and s['st_nlink']==1,'Closed file group changed or has external aliases')
    for row in rows:
        name=row['path'];wanted=row['identity'];parent_fence()
        fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME,dir_fd=parent_fd)
        try:
            E.require(E.identity(os.fstat(fd))==wanted,'Selected file identity changed')
            E.require([[n,os.getxattr(fd,n).hex()] for n in sorted(os.listxattr(fd))]==row['xattrs'],'Selected file attributes changed')
            with os.fdopen(fd,'rb',closefd=False) as source:sha=hashlib.file_digest(source,'sha256').hexdigest()
            E.require(sha==row['sha256'] and E.identity(os.fstat(fd))==wanted,'Selected file bytes changed')
            action=dict(root=expected_root['root'],path=name,kind='file',before=wanted,sha256=sha)
            journal('intent',action)
            if action_hook:action_hook('before-unlink',action)
            parent_fence();E.require(E.identity(os.stat(name,dir_fd=parent_fd,follow_symlinks=False))==wanted,'Selected file replaced after intent')
            os.unlink(name,dir_fd=parent_fd);os.fsync(parent_fd);completed+=1
            after=E.identity(os.fstat(fd));E.require(after['st_nlink']==0 and all(after[k]==wanted[k] for k in E.STAT_FIELDS if k not in ('st_nlink','st_ctime_ns')),'Selected file unexpectedly changed after unlink')
            if action_hook:action_hook('after-unlink',action)
            journal('completed',dict(**action,ordinal=completed))
        finally:os.close(fd)
    parent_fence();return completed


MAX_JOURNAL_BYTES=16*1024**2
JOURNAL_INTEGER_CHARS=21
JOURNAL_TIME='9999-12-31T23:59:59Z'


def journal_identity(value):
    E.require(isinstance(value,dict) and set(value)==set(E.STAT_FIELDS), 'Retirement journal identity fields differ')
    E.require(all(type(v) is int and len(str(v))<=JOURNAL_INTEGER_CHARS for v in value.values()),
              'Retirement journal integer exceeds reserved width')


def journal_contract(expected_root):
    """Exact static action bytes plus a conservative bound on changing stat values."""
    E.require(isinstance(expected_root,dict) and expected_root.get('format') in
              ('proofofwork-ui-retained-root-v1','proofofwork-ui-retained-files-v1'), 'Invalid retirement journal inventory format')
    root=expected_root.get('root');rows=expected_root.get('inventory');count=expected_root.get('entries')
    E.require(isinstance(root,str) and root.startswith('/') and '\0' not in root and str(Path(root))==root,
              'Invalid retirement journal root')
    E.require(type(count) is int and isinstance(rows,list) and count==len(rows) and 0<count<=E.MAX_ENTRIES,
              'Invalid retirement journal member count')
    actions={};total=0;wide=-(10**(JOURNAL_INTEGER_CHARS-1)-1)
    for row in rows:
        name=row.get('path');kind=row.get('kind')
        E.require(isinstance(name,str) and name and not name.startswith('/') and '\0' not in name
                  and str(Path(name))==name and (name=='.' or all(part not in ('','..','.') for part in name.split('/')))
                  and name not in actions, 'Unknown or duplicate retirement journal member')
        E.require(kind in ('file','directory','symlink'), 'Invalid retirement journal member kind')
        journal_identity(row.get('identity'))
        action=dict(root=root,path=name,kind=kind)
        if kind=='symlink':
            E.require(isinstance(row.get('target'),str) and row['target'] and '\0' not in row['target'], 'Invalid retirement journal link target')
            action['target']=row['target']
        else:
            sha=row.get('sha256')
            E.require((kind=='file' and isinstance(sha,str) and re.fullmatch('[0-9a-f]{64}',sha))
                      or (kind=='directory' and sha is None), 'Invalid retirement journal payload hash')
            action['sha256']=sha
        actions[name]=dict(action)
        bounded=dict(action,before={field:wide for field in E.STAT_FIELDS})
        total+=len(E.encoded(dict(stage='intent',action=bounded,atUtc=JOURNAL_TIME)))
        total+=len(E.encoded(dict(stage='completed',action=dict(bounded,ordinal=count),atUtc=JOURNAL_TIME)))
    if expected_root['format']=='proofofwork-ui-retained-root-v1':
        E.require(actions.get('.',{}).get('kind')=='directory', 'Retirement journal root entry absent')
    else:
        E.require(count<=16 and all(r['kind']=='file' and Path(name).name==name and name!='.' for name,r in actions.items()),
                  'Invalid retirement journal file group')
    E.require(total<=MAX_JOURNAL_BYTES, 'Retirement journal exceeds reserved envelope')
    return actions,total


def journal_capacity_bound(expected_root):
    return journal_contract(expected_root)[1]


class Journal:
    def __init__(self,path,expected_root=None):
        self.actions,self.maximum=journal_contract(expected_root) if expected_root is not None else (None,MAX_JOURNAL_BYTES)
        self.pending=None;self.reserved=0;self.seen=set()
        self.path=Path(path);self.fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_APPEND|os.O_NOFOLLOW,0o600);self.count=0;self.bytes=0
        sync_directory(self.path.parent)
    def __call__(self,stage,action):
        now=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        if self.actions is not None:
            E.require(isinstance(now,str) and re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z',now),
                      'Retirement journal timestamp exceeds reserved width')
            E.require(stage in ('intent','completed') and isinstance(action,dict), 'Invalid retirement journal action stage')
            if stage=='intent':
                E.require(self.pending is None and action.get('path') in self.actions and action['path'] not in self.seen,
                          'Unknown, duplicate or unpaired retirement journal intent')
                journal_identity(action.get('before'))
                static={k:v for k,v in action.items() if k!='before'}
                E.require(E.encoded(static)==E.encoded(self.actions[action['path']]), 'Retirement journal action shape differs from inventory')
                # Snapshot the caller's mutable dictionaries. The exact paired
                # completion is reserved before an intent can precede an unlink.
                pending=json.loads(E.encoded(action));completion=dict(pending,ordinal=self.count+1)
                reserved=len(E.encoded(dict(stage='completed',action=completion,atUtc=JOURNAL_TIME)))
                intent_bytes=len(E.encoded(dict(stage=stage,action=pending,atUtc=now)))
                E.require(self.bytes+intent_bytes+reserved<=self.maximum, 'Retirement journal pair exceeds reserved envelope')
            else:
                E.require(self.pending is not None and type(action.get('ordinal')) is int
                          and E.encoded(action)==E.encoded(dict(self.pending,ordinal=self.count+1)),
                          'Retirement journal completion differs from reserved intent')
        raw=E.encoded(dict(stage=stage,action=action,atUtc=now))
        E.require(self.bytes+len(raw)<=self.maximum, 'Retirement journal exceeds reserved envelope')
        if self.actions is not None and stage=='completed':
            E.require(len(raw)<=self.reserved, 'Retirement journal completion exceeds paired reservation')
        view=memoryview(raw)
        while view:
            written=os.write(self.fd,view);E.require(written>0,'Retirement journal write made no progress');view=view[written:]
        os.fsync(self.fd);self.bytes+=len(raw)
        if self.actions is not None:
            if stage=='intent':self.pending=pending;self.reserved=reserved;self.seen.add(action['path'])
            else:self.pending=None;self.reserved=0
        if stage=='completed':self.count+=1
    def close(self):os.close(self.fd)
