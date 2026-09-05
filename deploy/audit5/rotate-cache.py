#!/usr/bin/python3 -I
"""Audit5 exact cache preservation. Apply only after four-record and atoms gates PASS."""
import sys
if not sys.flags.isolated:raise SystemExit('Invoke with /usr/bin/python3 -I')
sys.dont_write_bytecode=True
import os,pathlib,stat,json,hashlib,ctypes,errno,datetime
APP='2ddefac163d5-20260905T180603Z';OPS='0b63c8604456-20260905T205150Z'
PARENT=pathlib.Path('/data');LIVE='proofofwork-api-cache';PRESERVED=LIVE+'.pre-audit5-'+APP
CAPTURE=pathlib.Path('/run/proofofwork-audit5-'+APP+'-window2')
GUARD=pathlib.Path('/run/proofofwork-audit5-window-tools-'+OPS+'-window2/window-quiescence.py')
GUARD_SHA='24210c1d8f551404e70ffa12b1f7ccc0edfa8ec4ed79b28fcedb6ae73cbcadac'
EXPECTED={'device':64514,'inode':94765057,'uid':1000,'gid':1000,'mode':0o750}
OWNER=1000;GROUP=1000;MODE=0o750

def require(ok,message):
    if not ok:raise RuntimeError(message)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def private_read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd);require(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1048576,'unsafe private file')
        with os.fdopen(os.dup(fd),'rb') as f:b=f.read(1048577)
        a=os.fstat(fd);require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns) and len(b)==s.st_size,'private file changed')
        return b
    finally:os.close(fd)
def private_directory(path):
    s=path.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700 and path.resolve()==path,'unsafe private directory')
def write_receipt(name,value):
    blob=(json.dumps(value,indent=2)+'\n').encode();fd=os.open(CAPTURE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as out:out.write(blob);out.flush();os.fsync(out.fileno())
    fd=os.open(CAPTURE,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
    return hashlib.sha256(blob).hexdigest()
def directory_meta(fd):
    s=os.fstat(fd);return {'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode)}
def snapshot(fd):
    names=sorted(os.listdir(fd));require(len(names)==6,'expected exactly six cache files; inspect drift')
    rows=[]
    for name in names:
        s=os.stat(name,dir_fd=fd,follow_symlinks=False)
        require(stat.S_ISREG(s.st_mode) and s.st_dev==EXPECTED['device'],'unexpected cache member or device')
        rows.append({'name':name,'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'links':s.st_nlink,'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns})
    return rows
def rename_no_replace(parent_fd):
    libc=ctypes.CDLL(None,use_errno=True);rename=libc.renameat2
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
    result=rename(parent_fd,os.fsencode(LIVE),parent_fd,os.fsencode(PRESERVED),1)
    if result:raise OSError(ctypes.get_errno(),'exact no-replace cache rename refused')
def rotate(parent_fd,old_fd,before):
    require(directory_meta(old_fd)==EXPECTED,'cache directory identity changed')
    require(snapshot(old_fd)==before,'cache members changed before rename')
    rename_no_replace(parent_fd)
    os.fsync(parent_fd)
    require(directory_meta(old_fd)==EXPECTED and snapshot(old_fd)==before,'preserved cache members changed')
    preserved_fd=os.open(PRESERVED,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent_fd)
    try:require(directory_meta(preserved_fd)==EXPECTED,'preserved path does not identify original cache')
    finally:os.close(preserved_fd)
    os.mkdir(LIVE,mode=MODE,dir_fd=parent_fd)
    new_fd=os.open(LIVE,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent_fd)
    try:
        os.fchown(new_fd,OWNER,GROUP);os.fchmod(new_fd,MODE);os.fsync(new_fd);os.fsync(parent_fd)
        new=directory_meta(new_fd)
        require(new['device']==EXPECTED['device'] and new['inode']!=EXPECTED['inode'] and (new['uid'],new['gid'],new['mode'])==(OWNER,GROUP,MODE) and not os.listdir(new_fd),'new cache is not a fresh empty canonical directory')
        require(snapshot(old_fd)==before,'preserved cache changed while creating replacement')
        return new
    finally:os.close(new_fd)
def inspect():
    rows={}
    for name in [LIVE,PRESERVED]:
        p=PARENT/name
        if not os.path.lexists(p):rows[str(p)]={'exists':False};continue
        s=p.lstat();rows[str(p)]={'exists':True,'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'mode':oct(stat.S_IMODE(s.st_mode)),'symlink':stat.S_ISLNK(s.st_mode),'directory':stat.S_ISDIR(s.st_mode)}
    return rows

def main():
    require(len(sys.argv)==2 and sys.argv[1] in ['review','inspect','apply'],'expected review/inspect/apply')
    phase=sys.argv[1]
    if phase=='review':
        print(json.dumps({'source':str(PARENT/LIVE),'preserved':str(PARENT/PRESERVED),'expectedIdentity':EXPECTED,'newOwnerMode':[OWNER,GROUP,oct(MODE)],'requiredPriorGates':['full four-record comparator PASS before bootstrap','strict atomic audit PASS'],'quiescenceGuard':str(GUARD),'quiescenceSha256':GUARD_SHA,'copiesOrDeletes':False,'automaticRollbackOrRetry':False},indent=2));return
    require(os.geteuid()==0,'root required');private_directory(CAPTURE)
    if phase=='inspect':print(json.dumps({'at':now(),'paths':inspect()},indent=2));return
    for name in ['cache-rotation-before.json','cache-rotation-completed.json','cache-rotation-failure.json']:
        require(not os.path.lexists(CAPTURE/name),'existing rotation evidence; inspect rather than retry')
    private_directory(GUARD.parent);body=private_read(GUARD);require(hashlib.sha256(body).hexdigest()==GUARD_SHA,'wrong quiescence helper')
    guard={'__file__':str(GUARD),'__name__':'cache_rotation_guard'};exec(compile(body,str(GUARD),'exec'),guard)
    previous=sys.argv
    try:sys.argv=[str(GUARD),'verify-stopped'];guard['main']()
    finally:sys.argv=previous
    parent_fd=os.open(PARENT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);old_fd=None
    try:
        p=os.fstat(parent_fd);require(p.st_uid==p.st_gid==0 and stat.S_IMODE(p.st_mode)==0o755 and p.st_dev==EXPECTED['device'] and PARENT.resolve()==PARENT,'unsafe data parent')
        require(not os.path.lexists(PARENT/PRESERVED),'preserved cache destination already exists')
        old_fd=os.open(LIVE,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent_fd);require(directory_meta(old_fd)==EXPECTED,'wrong current cache identity')
        before=snapshot(old_fd);free=os.fstatvfs(parent_fd);require(free.f_bavail*free.f_frsize>=107374182400+1048576,'data free-space floor violated')
        receipt={'at':now(),'source':str(PARENT/LIVE),'preserved':str(PARENT/PRESERVED),'directory':EXPECTED,'files':before,'logicalBytes':sum(x['bytes'] for x in before),'method':'same-parent RENAME_NOREPLACE, preserve original inode and all six file metadata identities; no large cache-body rehash or copying'}
        digest=write_receipt('cache-rotation-before.json',receipt)
        try:new=rotate(parent_fd,old_fd,before)
        except Exception:
            write_receipt('cache-rotation-failure.json',{'at':now(),'beforeSha256':digest,'paths':inspect(),'action':'Preserve all paths and evidence. Inspect exact inodes; no automatic rollback or retry.'});raise
        result={'at':now(),'beforeSha256':digest,'preservedDirectory':EXPECTED,'preservedFiles':len(before),'preservedLogicalBytes':sum(x['bytes'] for x in before),'newCanonicalDirectory':new,'deletions':0,'copies':0,'status':'preserved-and-replaced-with-empty-cache'}
        print(json.dumps({**result,'receiptSha256':write_receipt('cache-rotation-completed.json',result)},indent=2))
    finally:
        if old_fd is not None:os.close(old_fd)
        os.close(parent_fd)
if __name__=='__main__':
    try:main()
    except Exception as error:
        print('cache_rotation status=refused_preserved '+str(error),file=sys.stderr);sys.exit(1)
