#!/usr/bin/python3 -I
"""Exact approved Pages rollback export and independent off-host restoration.

The remote operation only reads, under the existing deploy lock. No production
archive, source, directory, receipt, hold or timer is created or removed.
"""
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

PROPOSAL_SHA = 'b7ec857468f3c425fa9bed1f366bf2313536913e3d62b18a8246ccd29f68f591'
APPROVAL_SHA = '4971f117af5947b69014583a1c3194b25d27147dfaa5f1b3defd40c64ba11385'
BASE = '/var/backups/proofofwork-ui/rollback-roots/'
ROOT_NAMES = ('proofofwork-www-pre-01ec4968caa9-20261007T150110Z',
              'proofofwork-www-pre-13ddf6d7f401-20261007T030045Z',
              'proofofwork-www-pre-19cc93a7c97f-20261007T161406Z',
              'proofofwork-www-pre-471a30c41991-20261004T122500Z',
              'proofofwork-www-pre-7bad9495d118-20261006T180919Z')
ROOT_PATHS = [BASE+n for n in ROOT_NAMES]
PRIOR = BASE+'proofofwork-www-pre-fc396c9a9abd-20261007T233244Z'
LIVE = '/var/www'
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
       'root@77.42.91.106']
MAX_JSON = 8*1024**2
MAX_ROOT_BYTES = 2*1024**3
MAX_ENTRIES = 25000
STAT_FIELDS = ('st_dev','st_ino','st_mode','st_nlink','st_uid','st_gid','st_size',
               'st_blocks','st_blksize','st_atime_ns','st_mtime_ns','st_ctime_ns')

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

def validate_proposal(raw):
    require(len(raw)<=MAX_JSON and digest(raw)==PROPOSAL_SHA,'Exact approved proposal SHA differs')
    p=json.loads(raw)
    require(p.get('schema')=='proof-of-work-pages-ui-storage-proposal-v1' and p.get('status')=='proposal-only-unapproved','Wrong proposal schema')
    require([r.get('root') for r in p.get('selectedRoots',[])]==ROOT_PATHS,'Expanded or reordered root scope')
    require(p['protected']['current']['root']==LIVE and p['protected']['immediatePrior']['root']==PRIOR,'Protected recovery pair differs')
    return p

def validate_approval(raw):
    require(len(raw)<=65536 and digest(raw)==APPROVAL_SHA,'Exact direct human approval SHA differs')
    a=json.loads(raw)
    require(a.get('schema')=='proof-of-work-pages-ui-storage-human-approval-v1'
            and a.get('authority')=='direct-human-user-reply-in-current-Codex-conversation'
            and a.get('answer')=='Approve this exact plan'
            and a.get('proposalSha256')==PROPOSAL_SHA
            and a.get('selectedRootPaths')==ROOT_PATHS,'Human approval scope differs')
    return a

def inventory(root, owner=0):
    root=Path(root); require(root.is_absolute() and root.resolve(strict=True)==root and root.is_dir(),'Root is not canonical')
    base=root.lstat();rows=[];children={};tree=hashlib.sha256();total=0;manifest=None;cache={};deadline=time.monotonic()+120
    def field(v):
        b=str(v).encode();tree.update(struct.pack('>Q',len(b)));tree.update(b)
    def walk(p,relative):
        nonlocal total,manifest
        require(time.monotonic()<deadline and len(rows)<MAX_ENTRIES,'Root inventory bound exceeded')
        s=p.lstat();require(s.st_dev==base.st_dev and s.st_uid==owner and s.st_gid==owner and not s.st_mode&0o7022,'Unsafe inventory owner, mode or filesystem')
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
        else:raise ValueError('Inventory contains a symlink or special file')
    walk(root,'.');require(manifest is not None,'Missing release manifest')
    fp=dict(format='proofofwork-ui-retained-root-v1',classification='retain',root=str(root),manifestSha256=manifest,treeSha256=tree.hexdigest(),entries=len(rows),regularBytes=total)
    return dict(fingerprint=fp,records=rows,directoryNames=children)

def assert_inventory(current, expected_root, exact_identity=True):
    fields=('format','classification','root','manifestSha256','treeSha256','entries','regularBytes')
    require(current['fingerprint']=={k:expected_root[k] for k in fields},'Complete root fingerprint differs')
    if 'inventory' in expected_root:
        actual=current['records'];expected=expected_root['inventory']
        require(len(actual)==len(expected),'Inventory entry count differs')
        for a,b in zip(actual,expected):
            require(a['path']==b['path'] and a['kind']==b['kind'] and a['xattrs']==b['xattrs'] and a.get('sha256')==b.get('sha256'),'Inventory content or attributes differ')
            if exact_identity:require(a['identity']==b['identity'],'Inventory lstat identity differs')
    return current

def assert_stable(root, records):
    root=Path(root);expected={r['path']:r for r in records}
    for row in records:
        p=root if row['path']=='.' else root/row['path']
        require(identity(p.lstat())==row['identity'] and xattrs(p)==row['xattrs'],'Root identity changed')
        if row['kind']=='directory':
            wanted=sorted(Path(r['path']).name for r in records if r['path']!='.' and str(Path(r['path']).parent)==('.' if row['path']=='.' else row['path']))
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

def archive_root(root, expected_root, sink, owner=0):
    actual=assert_inventory(inventory(root,owner),expected_root);records=actual['records'];wrapper=HashSink(sink);links={}
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
    # Another alias may already have restored a read-only mode on this inode.
    # Restore attributes while the owner can write, then restore the exact mode.
    os.chmod(path,stat.S_IMODE(s['st_mode'])|stat.S_IWUSR,follow_symlinks=False)
    existing=set(os.listxattr(path,follow_symlinks=False));wanted=dict(row['xattrs'])
    require(not existing-set(wanted),'Extraction introduced unexpected attributes')
    for n,v in wanted.items():os.setxattr(path,n,bytes.fromhex(v),follow_symlinks=False)
    os.chmod(path,stat.S_IMODE(s['st_mode']),follow_symlinks=False)
    os.utime(path,ns=(s['st_atime_ns'],s['st_mtime_ns']),follow_symlinks=False)

def verify_restored(root,expected_root,owner_required=True):
    root=Path(root);records=expected_root['inventory'];observed={};links={};expected_links={}
    require(root.resolve(strict=True)==root and root.is_dir(),'Restoration root is not canonical')
    for row in records:
        path=root if row['path']=='.' else root/row['path'];s=path.lstat();wanted=row['identity']
        require(stat.S_IFMT(s.st_mode)==stat.S_IFMT(wanted['st_mode']) and stat.S_IMODE(s.st_mode)==stat.S_IMODE(wanted['st_mode']),'Restored type or mode differs')
        require((s.st_uid,s.st_gid)==(wanted['st_uid'],wanted['st_gid']),'Restored numeric ownership differs')
        require(s.st_mtime_ns==wanted['st_mtime_ns'] and s.st_atime_ns==wanted['st_atime_ns'] and xattrs(path)==row['xattrs'],'Restored timestamps or attributes differ')
        observed[row['path']]=s
        if row['kind']=='file':
            require(s.st_size==wanted['st_size'],'Restored file size differs');b,_=read_regular(path,MAX_ROOT_BYTES)
            require(digest(b)==row['sha256'],'Restored file bytes differ')
            links.setdefault((s.st_dev,s.st_ino),[]).append(row['path']);expected_links.setdefault((wanted['st_dev'],wanted['st_ino']),[]).append(row['path'])
        else:
            children=sorted(Path(r['path']).name for r in records if r['path']!='.' and str(Path(r['path']).parent)==('.' if row['path']=='.' else row['path']))
            require(names(path)==children,'Restored directory membership differs')
    require(sorted(sorted(v) for v in links.values())==sorted(sorted(v) for v in expected_links.values()),'Restored internal hardlink topology differs')
    require(all(observed[v[0]].st_nlink==len(v) for v in links.values()),'Restored inode has an external hardlink')
    return dict(inventorySha256=inventory_sha(records),ownerRestored=True,modeTimesXattrsRestored=True,internalHardlinksRestored=True,
        fingerprint={k:expected_root[k] for k in ('format','classification','manifestSha256','treeSha256','entries','regularBytes')},
        uidMap=Path('/proc/self/uid_map').read_text().strip(),gidMap=Path('/proc/self/gid_map').read_text().strip(),
        qualification='Numeric owners are verified in this execution namespace. Host1000 may map to namespace0. A production-root restoration preserves archive UID/GID0. New inode IDs and ctime are expected; original IDs/ctime remain in immutable evidence.')

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

def helper_snapshot(proposal):
    result={}
    for name,wanted in proposal['currentHelpers'].items():
        raw,s=read_regular(wanted['path'],2*1024**2)
        actual=dict(path=wanted['path'],sha256=digest(raw),mode=oct(stat.S_IMODE(s.st_mode)),uid=s.st_uid,gid=s.st_gid,identity=identity(s))
        require(actual==wanted,'Installed helper identity changed');result[name]=actual
    return result

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

def production_fence(proposal, remaining=None):
    require(os.geteuid()==os.getegid()==0,'Production fence requires root')
    helper_snapshot(proposal)
    require(hold_snapshot()==proposal['protected']['holds'],'Hold identity changed')
    require(timer_snapshot()==proposal['protected']['timerUnitStates'],'Timer mask or unit state changed')
    expected=[proposal['protected']['current'],proposal['protected']['immediatePrior']]
    expected += [r for r in proposal['selectedRoots'] if remaining is None or r['root'] in remaining]
    mounts=no_mounts([r['root'] for r in expected]);roots=[]
    for row in expected:
        actual=inventory(row['root']);assert_inventory(actual,row);roots.append(actual)
    wanted=sorted(Path(r['root']).name for r in proposal['selectedRoots'] if remaining is None or r['root'] in remaining)+[Path(PRIOR).name]
    require(names(BASE.rstrip('/'))==sorted(wanted),'Rollback root set changed')
    return dict(helpers=proposal['currentHelpers'],holds=proposal['protected']['holds'],timers=proposal['protected']['timerUnitStates'],mountInfoSha256=mounts,roots=roots)

def remote_export(proposal_raw,approval_raw,index):
    proposal=validate_proposal(proposal_raw);validate_approval(approval_raw)
    require(type(index)is int and 0<=index<5,'Invalid exact export index');fd=lock_existing()
    try:
        before=production_fence(proposal);row=proposal['selectedRoots'][index]
        result=archive_root(row['root'],row,sys.stdout.buffer)
        for root in before['roots']:assert_stable(root['fingerprint']['root'],root['records'])
        helper_snapshot(proposal);require(hold_snapshot()==proposal['protected']['holds'] and timer_snapshot()==proposal['protected']['timerUnitStates'],'Hold/timer drift after export')
        require(no_mounts([r['fingerprint']['root'] for r in before['roots']])==before['mountInfoSha256'],'Mount state changed')
        print(json.dumps(dict(schema='proof-of-work-pages-ui-export-v1',proposalSha256=PROPOSAL_SHA,approvalSha256=APPROVAL_SHA,sourceRoot=row['root'],**result)),file=sys.stderr)
    finally:os.close(fd)

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

def export_all(proposal_path,approval_path,output):
    pr,_=read_regular(proposal_path);ar,_=read_regular(approval_path,65536);proposal=validate_proposal(pr);validate_approval(ar)
    output=Path(output);require(output.is_absolute() and output.parent.resolve(strict=True)==output.parent and not os.path.lexists(output),'Export destination must be fresh and canonical')
    space=os.statvfs(output.parent)
    budget=2*sum(row['regularBytes'] for row in proposal['selectedRoots'])+64*1024**2
    require(space.f_bavail*space.f_frsize>=budget and space.f_favail>=2*sum(row['entries'] for row in proposal['selectedRoots'])+128,'Insufficient off-host archive/restoration capacity')
    output.mkdir(mode=0o700);save_new(output/'proposal.json',pr);save_new(output/'human-approval.json',ar)
    source,_=read_regular(Path(__file__).resolve(),1024**2);save_new(output/'exporter.py',source);records=[]
    for index,row in enumerate(proposal['selectedRoots']):
        archive=output/(Path(row['root']).name+'.tgz');fd=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        program='import base64\nnamespace={"__name__":"_export"}\nexec(compile(base64.b64decode('+repr(base64.b64encode(source).decode())+'),"bound-exporter.py","exec"),namespace)\nnamespace["remote_export"](base64.b64decode('+repr(base64.b64encode(pr).decode())+'),base64.b64decode('+repr(base64.b64encode(ar).decode())+'),'+str(index)+')\n'
        try:
            p=subprocess.Popen(SSH+['/usr/bin/python3 -I -B -'],stdin=subprocess.PIPE,stdout=fd,stderr=subprocess.PIPE)
            try:_,stderr=p.communicate(program.encode(),timeout=900)
            except BaseException:p.kill();p.wait(timeout=30);raise
            require(len(stderr)<=1024**2,'Remote export stderr exceeds bound');save_new(output/(str(index)+'.export.stderr'),stderr)
            require(p.returncode==0,'Read-only export failed; preserve partial archive and stderr')
            remote=json.loads(stderr.decode().splitlines()[-1]);os.fsync(fd)
        finally:os.close(fd)
        raw,_=read_regular(archive,MAX_ROOT_BYTES);require(digest(raw)==remote['archiveSha256'] and len(raw)==remote['archiveBytes'],'Export stream checksum differs')
        require(remote['fingerprint']=={k:row[k] for k in ('format','classification','root','manifestSha256','treeSha256','entries','regularBytes')} and remote['inventorySha256']==inventory_sha(row['inventory']),'Export evidence differs')
        records.append(dict(**remote,archivePath=str(archive)));save_new(output/(str(index)+'.export.json'),encoded(records[-1]))
        print(json.dumps({'exported':index+1,'sourceRoot':row['root'],'archiveSha256':remote['archiveSha256'],'archiveBytes':remote['archiveBytes']}),flush=True)
    index=dict(schema='proof-of-work-pages-ui-export-index-v1',proposalSha256=PROPOSAL_SHA,approvalSha256=APPROVAL_SHA,exporterSha256=digest(source),exports=records)
    save_new(output/'export-index.json',encoded(index));return index

def verify_all(output):
    output=Path(output);pr,_=read_regular(output/'proposal.json');ar,_=read_regular(output/'human-approval.json',65536);proposal=validate_proposal(pr);validate_approval(ar)
    raw,_=read_regular(output/'export-index.json');index=json.loads(raw)
    require(index['schema']=='proof-of-work-pages-ui-export-index-v1' and index['proposalSha256']==PROPOSAL_SHA and index['approvalSha256']==APPROVAL_SHA and len(index['exports'])==5,'Export index differs')
    source,_=read_regular(Path(__file__).resolve(),1024**2);saved,_=read_regular(output/'exporter.py',1024**2)
    require(digest(source)==digest(saved)==index['exporterSha256'],'Verifier/exporter source changed')
    restored=output/'restored';require(not os.path.lexists(restored),'Verification is creation-only; do not silently retry');restored.mkdir(mode=0o700);records=[]
    for row,export in zip(proposal['selectedRoots'],index['exports']):
        archive=output/(Path(row['root']).name+'.tgz');require(export['sourceRoot']==row['root'] and export['archivePath']==str(archive),'Reordered export identity')
        b,_=read_regular(archive,MAX_ROOT_BYTES);require(digest(b)==export['archiveSha256'] and len(b)==export['archiveBytes'],'Saved archive changed')
        result=extract_verify(archive,row,restored/Path(row['root']).name);save_new(output/(Path(row['root']).name+'.restoration.json'),encoded(result));records.append(result)
        print(json.dumps({'verified':len(records),'sourceRoot':row['root'],'treeSha256':row['treeSha256']}),flush=True)
    recipe={'schema':'proof-of-work-pages-ui-restoration-recipe-v1','command':'As production root, invoke saved exporter.py restore --custody DIRECTORY --output FRESH_PARENT to recreate complete historical root directories; then independently verify bytes, modes, numeric owners, atime/mtime, xattrs and internal hardlinks. This does not change the active site.',
        'sourceExportIndexSha256':digest(raw),'proposalSha256':PROPOSAL_SHA,'approvalSha256':APPROVAL_SHA,'originalLstatEvidencePreserved':True,'inodeCtimeQualification':'Restored inode numbers and ctime differ; original complete IDs/ctime are retained in proposal inventories.'}
    save_new(output/'restoration-recipe.json',encoded(recipe));custody=dict(schema='proof-of-work-pages-ui-custody-v1',proposalSha256=PROPOSAL_SHA,approvalSha256=APPROVAL_SHA,exporterSha256=digest(source),exportIndexSha256=digest(raw),exports=index['exports'],restorations=records,restorationRecipeSha256=digest(encoded(recipe)),durableDirectory=str(output))
    save_new(output/'custody.json',encoded(custody));return custody

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('export');p.add_argument('--proposal',type=Path,required=True);p.add_argument('--approval',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('verify');p.add_argument('--custody',type=Path,required=True)
    p=sub.add_parser('restore');p.add_argument('--custody',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=parser.parse_args()
    if a.command=='export':result=export_all(a.proposal,a.approval,a.output)
    elif a.command=='verify':result=verify_all(a.custody)
    else:
        require(os.geteuid()==0,'Restoration requires root (or verified isolated root namespace)')
        pr,_=read_regular(a.custody/'proposal.json');proposal=validate_proposal(pr);require(not os.path.lexists(a.output),'Restoration output already exists');a.output.mkdir(mode=0o700)
        result=[extract_verify(a.custody/(Path(r['root']).name+'.tgz'),r,a.output/Path(r['root']).name) for r in proposal['selectedRoots']]
    print(json.dumps(result,sort_keys=True))

if __name__=='__main__':main()
