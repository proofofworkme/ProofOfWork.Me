"""Complete opt-in custody inventory and independent restoration. No production deletion."""
import argparse


import base64


from decimal import Decimal


import fcntl


import hashlib


import io


import json


import os


from pathlib import Path


import shlex


import stat


import struct


import subprocess


import sys


import tarfile


import time


MAX_JSON=8*1024**2
MAX_ROOT_BYTES=2*1024**3
MAX_ENTRIES=25000
STAT_FIELDS=('st_dev','st_ino','st_mode','st_nlink','st_uid','st_gid','st_size','st_blocks','st_blksize','st_atime_ns','st_mtime_ns','st_ctime_ns')

def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()


def digest(raw): return hashlib.sha256(raw).hexdigest()


def identity(s): return {k:getattr(s,k) for k in STAT_FIELDS}


def require(ok, message):
    if not ok: raise ValueError(message)


def read_regular(path, maximum=MAX_JSON):
    p=Path(path); before=p.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum and not p.is_symlink(), 'Unsafe or oversized regular file')
    fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
    try:
        require(identity(os.fstat(fd))==identity(before),'File changed before read')
        parts=[];count=0
        while True:
            b=os.read(fd,1024**2)
            if not b:break
            count+=len(b);require(count<=maximum,'File exceeded read bound');parts.append(b)
        require(identity(os.fstat(fd))==identity(before) and identity(p.lstat())==identity(before),'File changed during read')
        return b''.join(parts),before
    finally:os.close(fd)


def names(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOATIME)
    try:return sorted(e.name for e in os.scandir(fd))
    finally:os.close(fd)


def xattrs(path):
    return [[n,os.getxattr(path,n,follow_symlinks=False).hex()] for n in sorted(os.listxattr(path,follow_symlinks=False))]


def inventory(root, owner=0, *, require_manifest=True, allow_symlinks=False):
    root=Path(root); require(root.is_absolute() and root.resolve(strict=True)==root and root.is_dir(),'Root is not canonical')
    base=root.lstat();rows=[];children={};tree=hashlib.sha256();total=0;manifest=None;cache={};deadline=time.monotonic()+120
    def field(v):
        b=str(v).encode();tree.update(struct.pack('>Q',len(b)));tree.update(b)
    def walk(p,relative):
        nonlocal total,manifest
        require(time.monotonic()<deadline and len(rows)<MAX_ENTRIES,'Root inventory bound exceeded')
        if allow_symlinks and p.is_symlink():os.readlink(p)  # Record metadata after readlink's own atime update.
        s=p.lstat();require(s.st_dev==base.st_dev and s.st_uid==owner and s.st_gid==owner and (allow_symlinks and stat.S_ISLNK(s.st_mode) or not s.st_mode&0o7022),'Unsafe inventory owner, mode or filesystem')
        row=dict(path=relative,identity=identity(s),xattrs=xattrs(p))
        for v in (relative,stat.S_IMODE(s.st_mode),s.st_uid,s.st_gid):field(v)
        if stat.S_ISDIR(s.st_mode):
            row['kind']='directory';field('directory');ns=names(p);children[relative]=ns;rows.append(row)
            for n in ns:
                require('\\' not in n and not any(ord(c)<32 or ord(c)==127 for c in n),'Unsafe inventory name')
                walk(p/n,n if relative=='.' else relative+'/'+n)
            require(identity(p.lstat())==row['identity'] and names(p)==ns,'Directory changed during inventory')
        elif stat.S_ISREG(s.st_mode):
            row['kind']='file';field('file');total+=s.st_size;require(total<=MAX_ROOT_BYTES,'Root byte bound exceeded')
            key=(s.st_dev,s.st_ino)
            if key in cache:
                old=cache[key];require(old['identity']==row['identity'] and old['xattrs']==row['xattrs'],'Hardlink identity changed');sha=old['sha256']
            else:
                fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME);h=hashlib.sha256();count=0
                try:
                    require(identity(os.fstat(fd))==row['identity'],'File changed before inventory')
                    while b:=os.read(fd,1024**2):
                        count+=len(b);require(time.monotonic()<deadline and count<=s.st_size,'File changed or inventory timed out');h.update(b)
                    require(count==s.st_size and identity(os.fstat(fd))==row['identity'] and identity(p.lstat())==row['identity'],'File changed during inventory')
                finally:os.close(fd)
                sha=h.hexdigest();cache[key]=dict(**row,sha256=sha)
            row['sha256']=sha;field(sha);rows.append(row)
            if relative=='.proofofwork-ui-release':require(s.st_size<=65536,'Oversized release manifest');manifest=sha
        elif allow_symlinks and stat.S_ISLNK(s.st_mode):
            target=os.readlink(p)
            require(s.st_nlink==1 and not os.path.isabs(target) and p.resolve().is_relative_to(root), 'Custody link escapes source root or has external aliases')
            row.update(kind='symlink', target=target);field('symlink');field(target);rows.append(row)
            require(identity(p.lstat())==row['identity'], 'Symlink changed during inventory')
        else:raise ValueError('Inventory contains a symlink or special file')
    walk(root,'.');require(not require_manifest or manifest is not None,'Missing release manifest')
    fp=dict(format='proofofwork-ui-retained-root-v1',classification='retain',root=str(root),manifestSha256=manifest,treeSha256=tree.hexdigest(),entries=len(rows),regularBytes=total)
    return dict(fingerprint=fp,records=rows,directoryNames=children)


def assert_inventory(current, expected_root, exact_identity=True):
    fields=('format','classification','root','manifestSha256','treeSha256','entries','regularBytes')
    require(current['fingerprint']=={k:expected_root[k] for k in fields},'Complete root fingerprint differs')
    if 'inventory' in expected_root:
        actual=current['records'];expected=expected_root['inventory']
        require(len(actual)==len(expected),'Inventory entry count differs')
        for a,b in zip(actual,expected):
            require(a['path']==b['path'] and a['kind']==b['kind'] and a['xattrs']==b['xattrs'] and a.get('sha256')==b.get('sha256') and a.get('target')==b.get('target'),'Inventory content or attributes differ')
            if exact_identity:require(a['identity']==b['identity'],'Inventory lstat identity differs')
    return current


def directory_children(records):
    children={}
    for row in records:
        if row['path']=='.':continue
        path=Path(row['path']);children.setdefault(str(path.parent),[]).append(path.name)
    return {key:sorted(value) for key,value in children.items()}


def assert_stable(root, records):
    root=Path(root);expected={r['path']:r for r in records};children=directory_children(records)
    for row in records:
        p=root if row['path']=='.' else root/row['path']
        require(identity(p.lstat())==row['identity'] and xattrs(p)==row['xattrs'],'Root identity changed')
        if row['kind']=='directory':
            wanted=children.get(row['path'],[])
            require(names(p)==wanted,'Root directory membership changed')


def inventory_sha(rows):return digest(encoded(rows))


def ns_string(value):return str(value//10**9)+'.'+str(value%10**9).zfill(9)


class HashSink:
    def __init__(self,sink):self.sink=sink;self.hash=hashlib.sha256();self.count=0
    def write(self,b):
        self.hash.update(b);self.count+=len(b);require(self.count<=MAX_ROOT_BYTES,'Export archive exceeded byte bound')
        view=memoryview(b)
        while view:
            written=self.sink.write(view);written=len(view) if written is None else written
            require(type(written)is int and 0<written<=len(view),'Archive sink made no progress');view=view[written:]
        return len(b)
    def flush(self):self.sink.flush()


def archive_root(root, expected_root, sink, owner=0, *, require_manifest=True, allow_symlinks=False):
    actual=assert_inventory(inventory(root,owner,require_manifest=require_manifest,allow_symlinks=allow_symlinks),expected_root);records=actual['records'];wrapper=HashSink(sink);links={}
    groups={}
    for row in records:
        if row['kind']=='file':
            s=row['identity'];groups.setdefault((s['st_dev'],s['st_ino']),[]).append(row)
    require(all(len(rows)==rows[0]['identity']['st_nlink'] for rows in groups.values()),'Source has an external hardlink')
    with tarfile.open(fileobj=wrapper,mode='w|gz',format=tarfile.PAX_FORMAT) as archive:
        for row in records:
            p=Path(root) if row['path']=='.' else Path(root)/row['path'];s=row['identity']
            require(identity(p.lstat())==s and xattrs(p)==row['xattrs'],'Source changed before archive member')
            member=tarfile.TarInfo(row['path']);member.mode=stat.S_IMODE(s['st_mode']);member.uid=s['st_uid'];member.gid=s['st_gid'];member.uname=member.gname=''
            member.mtime=s['st_mtime_ns']//10**9
            member.pax_headers={'mtime':ns_string(s['st_mtime_ns']),'atime':ns_string(s['st_atime_ns']),
                'POW.original.stat':json.dumps(s,sort_keys=True,separators=(',',':')),
                'POW.xattrs':json.dumps(row['xattrs'],separators=(',',':'))}
            if row['kind']=='directory':member.type=tarfile.DIRTYPE;archive.addfile(member)
            elif row['kind']=='symlink':
                member.type=tarfile.SYMTYPE;member.linkname=row['target'];archive.addfile(member)
            else:
                key=(s['st_dev'],s['st_ino'])
                if key in links:
                    member.type=tarfile.LNKTYPE;member.linkname=links[key];archive.addfile(member)
                else:
                    links[key]=row['path'];member.size=s['st_size'];fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
                    with os.fdopen(fd,'rb') as source:
                        require(identity(os.fstat(source.fileno()))==s,'Archive source identity changed')
                        archive.addfile(member,source)
                        require(identity(os.fstat(source.fileno()))==s,'Archive source changed during export')
            require(identity(p.lstat())==s,'Source changed after archive member')
    assert_stable(root,records);wrapper.flush()
    return dict(fingerprint=actual['fingerprint'],inventorySha256=inventory_sha(records),archiveSha256=wrapper.hash.hexdigest(),archiveBytes=wrapper.count)


def apply_metadata(path,row,owner_required):
    s=row['identity'];uid,gid=s['st_uid'],s['st_gid'];actual=path.lstat()
    if (actual.st_uid,actual.st_gid)!=(uid,gid):
        require(owner_required and os.geteuid()==0,'Cannot restore numeric ownership')
        os.chown(path,uid,gid,follow_symlinks=False)
    if row['kind']=='symlink':
        require(os.readlink(path)==row['target'], 'Restored symlink differs')
        os.utime(path,ns=(s['st_atime_ns'],s['st_mtime_ns']),follow_symlinks=False)
        return
    # Another alias may already have restored a read-only mode on this inode.
    # Restore attributes while the owner can write, then restore the exact mode.
    os.chmod(path,stat.S_IMODE(s['st_mode'])|stat.S_IWUSR,follow_symlinks=False)
    existing=set(os.listxattr(path,follow_symlinks=False));wanted=dict(row['xattrs'])
    require(not existing-set(wanted),'Extraction introduced unexpected attributes')
    for n,v in wanted.items():os.setxattr(path,n,bytes.fromhex(v),follow_symlinks=False)
    os.chmod(path,stat.S_IMODE(s['st_mode']),follow_symlinks=False)
    os.utime(path,ns=(s['st_atime_ns'],s['st_mtime_ns']),follow_symlinks=False)


def verify_restored(root,expected_root,owner_required=True):
    root=Path(root);records=expected_root['inventory'];observed={};links={};expected_links={};child_names=directory_children(records)
    require(root.resolve(strict=True)==root and root.is_dir(),'Restoration root is not canonical')
    for row in records:
        path=root if row['path']=='.' else root/row['path'];s=path.lstat();wanted=row['identity']
        require(stat.S_IFMT(s.st_mode)==stat.S_IFMT(wanted['st_mode']) and stat.S_IMODE(s.st_mode)==stat.S_IMODE(wanted['st_mode']),'Restored type or mode differs')
        require((s.st_uid,s.st_gid)==(wanted['st_uid'],wanted['st_gid']),'Restored numeric ownership differs')
        require(s.st_mtime_ns==wanted['st_mtime_ns'] and (row['kind']=='symlink' or s.st_atime_ns==wanted['st_atime_ns']) and xattrs(path)==row['xattrs'],'Restored timestamps or attributes differ')
        observed[row['path']]=s
        if row['kind']=='file':
            require(s.st_size==wanted['st_size'],'Restored file size differs');b,_=read_regular(path,MAX_ROOT_BYTES)
            require(digest(b)==row['sha256'],'Restored file bytes differ')
            links.setdefault((s.st_dev,s.st_ino),[]).append(row['path']);expected_links.setdefault((wanted['st_dev'],wanted['st_ino']),[]).append(row['path'])
        elif row['kind']=='symlink':
            require(os.readlink(path)==row['target'], 'Restored symlink target differs')
        else:
            children=child_names.get(row['path'],[])
            require(names(path)==children,'Restored directory membership differs')
    require(sorted(sorted(v) for v in links.values())==sorted(sorted(v) for v in expected_links.values()),'Restored internal hardlink topology differs')
    require(all(observed[v[0]].st_nlink==len(v) for v in links.values()),'Restored inode has an external hardlink')
    return dict(inventorySha256=inventory_sha(records),ownerRestored=True,modeTimesXattrsRestored=True,internalHardlinksRestored=True,
        fingerprint={k:expected_root[k] for k in ('format','classification','manifestSha256','treeSha256','entries','regularBytes')},
        uidMap=Path('/proc/self/uid_map').read_text().strip(),gidMap=Path('/proc/self/gid_map').read_text().strip(),
        qualification='Numeric owners are verified in this execution namespace. Host1000 may map to namespace0. A production-root restoration preserves archive UID/GID0. New inode IDs and ctime are expected; original IDs/ctime remain in immutable evidence. Original symlink atimes remain archived; readlink may advance restored symlink atime.')


def extract_verify(archive,expected_root,output,owner_required=True):
    archive=Path(archive);output=Path(output);require(not os.path.lexists(output),'Restoration output already exists')
    require(output.parent.resolve(strict=True)==output.parent and output.parent.is_dir(),'Unsafe restoration parent')
    output.mkdir(mode=0o700);rows=expected_root['inventory'];wanted={r['path']:r for r in rows};seen=set();links={};total=0
    with tarfile.open(archive,mode='r:gz') as source:
        for member in source:
            require(len(seen)<MAX_ENTRIES and member.name in wanted and member.name not in seen,'Unexpected or duplicate archive member')
            row=wanted[member.name];s=row['identity'];path=output if member.name=='.' else output/member.name
            require(not Path(member.name).is_absolute() and '..' not in Path(member.name).parts,'Unsafe archive member path')
            require(member.uid==s['st_uid'] and member.gid==s['st_gid'] and member.mode==stat.S_IMODE(s['st_mode']),'Archive owner or mode differs')
            require(member.pax_headers.get('POW.original.stat')==json.dumps(s,sort_keys=True,separators=(',',':'))
                and json.loads(member.pax_headers.get('POW.xattrs','null'))==row['xattrs']
                and int(Decimal(member.pax_headers['mtime'])*10**9)==s['st_mtime_ns']
                and int(Decimal(member.pax_headers['atime'])*10**9)==s['st_atime_ns'],'Archive metadata differs')
            if row['kind']=='directory':
                require(member.isdir() and member.size==0,'Archive directory type differs')
                if member.name!='.':require(path.parent.is_dir() and not path.parent.is_symlink(),'Archive parent missing');path.mkdir(mode=0o700)
            elif row['kind']=='symlink':
                require(member.issym() and member.linkname==row['target'] and member.size==0, 'Archive symlink differs')
                require(path.parent.is_dir() and not path.parent.is_symlink(), 'Archive link parent missing')
                os.symlink(member.linkname,path)
            else:
                require(path.parent.is_dir() and not path.parent.is_symlink(),'Archive file parent missing');key=(s['st_dev'],s['st_ino'])
                if key in links:
                    require(member.islnk() and member.linkname==links[key] and member.size==0,'Archive internal hardlink differs')
                    os.link(output/member.linkname,path,follow_symlinks=False)
                else:
                    require(member.isfile() and not member.islnk() and member.size==s['st_size'],'Archive regular file differs')
                    total+=member.size;require(total<=MAX_ROOT_BYTES,'Archive expansion exceeded byte bound');links[key]=member.name
                    f=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);h=hashlib.sha256();count=0
                    try:
                        stream=source.extractfile(member)
                        while b:=stream.read(1024**2):
                            count+=len(b);require(count<=member.size,'Archive file expanded beyond bound');h.update(b);view=memoryview(b)
                            while view:view=view[os.write(f,view):]
                        require(count==member.size and h.hexdigest()==row['sha256'],'Archive file checksum differs');os.fsync(f)
                    finally:os.close(f)
            seen.add(member.name)
    require(seen==set(wanted),'Archive lacks complete root inventory')
    for row in reversed(rows):apply_metadata(output if row['path']=='.' else output/row['path'],row,owner_required)
    result=verify_restored(output,expected_root,owner_required);raw,_=read_regular(archive,MAX_ROOT_BYTES)
    result.update(schema='proof-of-work-pages-ui-offhost-restore-v1',sourceRoot=expected_root['root'],archivePath=str(archive),archiveSha256=digest(raw),archiveBytes=len(raw),restoredPath=str(output))
    return result


def hold_snapshot(parent='/etc/proofofwork-retention'):
    result=[]
    for name in names(parent):
        path=Path(parent)/name;s=path.lstat()
        require(stat.S_ISREG(s.st_mode),'Unexpected retention hold object')
        raw,s=read_regular(path,16*1024**2);result.append(dict(path=str(path),sha256=digest(raw),identity=identity(s),xattrs=xattrs(path)))
    return result


def timer_snapshot():
    argv=['/usr/bin/systemctl','list-unit-files','--type=timer','--no-legend','--no-pager']
    p=subprocess.run(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'},check=True,timeout=30)
    require(len(p.stdout)<=1024**2,'Timer inventory exceeds bound')
    return dict(command=argv,stdout=p.stdout.decode(),sha256=digest(p.stdout))


def no_mounts(paths,mountinfo='/proc/self/mountinfo'):
    raw=Path(mountinfo).read_bytes();require(len(raw)<=2*1024**2,'Mount inventory exceeds bound')
    for line in raw.decode().splitlines():
        mount=line.split()[4]
        require(not any(mount==p or mount.startswith(p+'/') for p in paths),'Protected root contains a mount')
    return digest(raw)


def lock_existing(path='/run/proofofwork-ui/deploy.lock'):
    path=Path(path);s=path.lstat()
    require(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o7022,'Unsafe existing deploy lock')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
    require(identity(os.fstat(fd))==identity(s),'Deploy lock changed');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);return fd


def save_new(path,raw):
    path=Path(path);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        view=memoryview(raw)
        while view:view=view[os.write(fd,view):]
        os.fsync(fd)
    finally:os.close(fd)
    parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(parent)
    finally:os.close(parent)
