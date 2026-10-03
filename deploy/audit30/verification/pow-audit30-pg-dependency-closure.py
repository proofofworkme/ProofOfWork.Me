#!/usr/bin/env python3
"""Creation-only pg closure preparation; build locally, stage only hash-bound root inputs."""
import argparse, base64, hashlib, io, json, os, pathlib, re, socket, stat, sys, tarfile
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
MAX_BYTES=64*1024*1024; MAX_ENTRIES=10000
class Refusal(Exception): pass
def need(value,message):
 if not value: raise Refusal(message)
def enc(x): return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
def sha(b): return hashlib.sha256(b).hexdigest()
def meta(st): return dict(device=st.st_dev,inode=st.st_ino,mode=stat.S_IMODE(st.st_mode),uid=st.st_uid,gid=st.st_gid,nlink=st.st_nlink,bytes=st.st_size,mtimeNs=st.st_mtime_ns,ctimeNs=st.st_ctime_ns)
def safe_path(s):
 need(isinstance(s,str) and s and not s.startswith('/') and '\\' not in s and not any(x in ('','..') for x in s.split('/')) and str(pathlib.PurePosixPath(s))==s,'unsafe member path')
 return s
def read_file(p,maxbytes=MAX_BYTES):
 st=p.lstat(); need(stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_size<=maxbytes,'unsafe source file')
 need(not os.listxattr(p,follow_symlinks=False),'source xattrs')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  need(meta(os.fstat(fd))==meta(st),'source open drift'); data=b''
  while True:
   chunk=os.read(fd,1024*1024)
   if not chunk: break
   data+=chunk; need(len(data)<=maxbytes,'source size cap')
  need(meta(os.fstat(fd))==meta(st),'source read drift')
 finally: os.close(fd)
 need(meta(p.lstat())==meta(st),'source path drift'); return data,meta(st)
def exclusive(p,data,mode=0o600):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 try:
  os.fchmod(fd,mode); view=memoryview(data)
  while view: n=os.write(fd,view); view=view[n:]
  os.fsync(fd)
 finally: os.close(fd)
 fsync_dir(p.parent)
def fsync_dir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try: os.fsync(fd)
 finally: os.close(fd)
def new_dir(p): os.mkdir(p,0o700); os.chmod(p,0o700); fsync_dir(p.parent)
def resolve(name,origin,repo):
 need(re.fullmatch(r'(?:@[a-z0-9_.-]+/)?[a-z0-9_.-]+',name) is not None,'invalid dependency name')
 cursor=origin
 while True:
  candidate=cursor/'node_modules'/name
  if candidate.exists() or candidate.is_symlink():
   need(not candidate.is_symlink() and candidate.is_dir(),'dependency symlink/type')
   need(candidate.resolve()==candidate and candidate.is_relative_to(repo/'node_modules'),'dependency outside node_modules'); return candidate
  if cursor==repo: return None
  need(cursor.is_relative_to(repo),'dependency resolution escape'); cursor=cursor.parent

def build(repo,out):
 repo=repo.absolute(); need(repo.resolve()==repo,'repository aliases'); lock_raw,_=read_file(repo/'package-lock.json'); lock=json.loads(lock_raw)
 need(lock.get('lockfileVersion')==3 and isinstance(lock.get('packages'),dict),'lock3 required')
 root=resolve('pg',repo,repo); need(root is not None,'pg absent')
 packages={}; edges=[]; absent=[]; queue=[root]
 while queue:
  source=queue.pop(0); raw,identity=read_file(source/'package.json'); package=json.loads(raw); name=package['name']; version=package['version']
  if name in packages:
   need(packages[name]['source']==source,'multiple dependency roots/version collision'); continue
  lock_key=str(source.relative_to(repo)); locked=lock['packages'].get(lock_key)
  need(isinstance(locked,dict) and locked.get('version')==version,'installed dependency differs lock')
  need(locked.get('integrity') is not None,'dependency integrity missing from lock')
  packages[name]=dict(source=source,version=version,lockKey=lock_key,lockIntegrity=locked['integrity'],packageJSONSHA256=sha(raw),packageJSONMetadata=identity)
  optional=package.get('optionalDependencies',{}); dependencies=dict(package.get('dependencies',{})); dependencies.update(optional)
  peer=package.get('peerDependencies',{}); peer_meta=package.get('peerDependenciesMeta',{})
  for kind,items in [('dependency',dependencies),('peer',peer)]:
   for child,spec in sorted(items.items()):
    child_path=resolve(child,source,repo); opt=child in optional if kind=='dependency' else peer_meta.get(child,{}).get('optional') is True
    if child_path is None:
     need(opt,'required dependency absent'); absent.append(dict(parent=name,name=child,kind=kind,spec=spec,optional=True)); continue
    child_json=json.loads(read_file(child_path/'package.json')[0]); need(child_json.get('name')==child,'dependency name mismatch')
    edges.append(dict(parent=name,name=child,kind=kind,spec=spec,version=child_json['version'],destination='pg' if child=='pg' else 'pg/node_modules/'+child))
    queue.append(child_path)
 need('pg-native' not in packages,'native closure unsupported')
 records={'.':dict(path='.',kind='directory'), 'pg':dict(path='pg',kind='directory'), 'pg/node_modules':dict(path='pg/node_modules',kind='directory')}; blobs={}; total=0; device=root.lstat().st_dev
 for name,package in sorted(packages.items()):
  source=package['source']; dest=pathlib.PurePosixPath('pg' if name=='pg' else 'pg/node_modules/'+name)
  for current,dirs,files in os.walk(source,followlinks=False):
   current=pathlib.Path(current); st=current.lstat(); need(stat.S_ISDIR(st.st_mode) and st.st_dev==device and not os.listxattr(current,follow_symlinks=False),'unsafe package directory')
   rel=current.relative_to(source); path=str(dest/rel); safe_path(path); records.setdefault(path,dict(path=path,kind='directory'))
   if name=='pg': need('node_modules' not in dirs,'pg nested closure would collide')
   for leaf in sorted(dirs): need(not (current/leaf).is_symlink(),'directory symlink')
   for leaf in sorted(files):
    src=current/leaf; need(src.lstat().st_dev==device,'file mount crossing'); data,_=read_file(src); path=str(dest/rel/leaf); safe_path(path); need(path not in records,'duplicate member')
    records[path]=dict(path=path,kind='file',bytes=len(data),sha256=sha(data)); blobs[path]=data; total+=len(data)
    need(total<=MAX_BYTES and len(records)<=MAX_ENTRIES,'dependency closure cap')
   need(meta(current.lstat())==meta(st),'directory changed during census')
 need('pg/lib/index.js' in blobs,'fixed pg entry missing')
 # Scoped package prefixes need explicit intermediate directories.
 for path in list(records):
  parent=pathlib.PurePosixPath(path).parent
  while str(parent)!='.': records.setdefault(str(parent),dict(path=str(parent),kind='directory')); parent=parent.parent
 ordered=[records[k] for k in sorted(records)]; need(len(ordered)<=MAX_ENTRIES,'entry cap')
 manifest=dict(schema='pow-audit30-pg-portable-closure-v1',approvalSha256=APPROVAL,sourceRepository=str(repo),packageLockSHA256=sha(lock_raw),rootPackage='pg',pgEntry='pg/lib/index.js',pgEntrySHA256=sha(blobs['pg/lib/index.js']),packages=[dict(name=n,**{k:v for k,v in p.items() if k!='source'}) for n,p in sorted(packages.items())],edges=edges,optionalAbsences=absent,records=ordered,recordsSHA256=sha(enc(ordered)),logicalBytes=total,entryCount=len(ordered),qualification='Installed package bytes match the recorded inventory and locked versions; npm archive-integrity extraction was not independently repeated. Optional pg-native is absent and normal pg JavaScript is used.')
 archive=io.BytesIO()
 with tarfile.open(fileobj=archive,mode='w',format=tarfile.USTAR_FORMAT) as tf:
  for row in ordered:
   info=tarfile.TarInfo(row['path']); info.uid=info.gid=0; info.uname=info.gname=''; info.mtime=0; info.mode=0o700 if row['kind']=='directory' else 0o600
   if row['kind']=='directory': info.type=tarfile.DIRTYPE; tf.addfile(info)
   else: info.size=row['bytes']; tf.addfile(info,io.BytesIO(blobs[row['path']]))
 raw=archive.getvalue(); need(len(raw)<=MAX_BYTES+MAX_ENTRIES*1024,'archive cap')
 need(not out.exists(),'output exists'); new_dir(out); exclusive(out/'pg-dependencies.tar',raw); exclusive(out/'portable-manifest.json',enc(manifest))
 receipt=dict(schema='pow-audit30-pg-closure-build-receipt-v1',approvalSha256=APPROVAL,archiveSHA256=sha(raw),archiveBytes=len(raw),manifestSHA256=sha(enc(manifest)),manifestBytes=len(enc(manifest)),pgEntrySHA256=manifest['pgEntrySHA256'],packageLockSHA256=manifest['packageLockSHA256'],packageCount=len(packages),entryCount=len(ordered),logicalBytes=total)
 exclusive(out/'build-receipt.json',enc(receipt)); return receipt

def verify_archive(raw,manifest):
 need(set(manifest)>= {'schema','approvalSha256','records','recordsSHA256','logicalBytes','entryCount','pgEntrySHA256'},'manifest missing fields')
 need(manifest['schema']=='pow-audit30-pg-portable-closure-v1' and manifest['approvalSha256']==APPROVAL,'manifest identity')
 rows=manifest['records']; need(isinstance(rows,list) and len(rows)<=MAX_ENTRIES and len(rows)==manifest['entryCount'] and sha(enc(rows))==manifest['recordsSHA256'],'records commitment')
 need([r['path'] for r in rows]==sorted(set(r['path'] for r in rows)) and rows[0]=={'path':'.','kind':'directory'},'ordered unique root records')
 blobs={}; total=0
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as tf:
  members=tf.getmembers(); need(len(members)==len(rows),'archive count')
  for row,member in zip(rows,members):
   path=safe_path(row['path']); need(path=='.' or path=='pg' or path.startswith('pg/'),'unexpected closure root')
   need(member.name==path and not member.pax_headers and member.uid==member.gid==0 and member.uname==member.gname=='' and member.mtime==0,'archive identity/header')
   if row['kind']=='directory': need(set(row)=={'path','kind'} and member.isdir() and member.mode==0o700 and member.size==0,'directory member')
   else:
    need(set(row)=={'path','kind','bytes','sha256'} and row['kind']=='file' and member.isfile() and member.mode==0o600 and member.size==row['bytes'],'file member')
    f=tf.extractfile(member); data=f.read(MAX_BYTES+1); need(len(data)==row['bytes'] and sha(data)==row['sha256'],'member bytes differ'); blobs[path]=data; total+=len(data); need(total<=MAX_BYTES,'logical size cap')
  need(total==manifest['logicalBytes'] and sha(blobs.get('pg/lib/index.js',b''))==manifest['pgEntrySHA256'],'aggregate/entry bytes')
  for row in rows[1:]: need(str(pathlib.PurePosixPath(row['path']).parent) in {r['path'] for r in rows if r['kind']=='directory'},'missing parent')
 return rows,blobs

def stage(request):
 need(set(request)=={'schema','approvalSha256','runId','host','archiveBase64','archiveSHA256','manifestBase64','manifestSHA256','privatePlanSource'},'stage keys')
 need(request['schema']=='pow-audit30-pg-root-stage-request-v1' and request['approvalSha256']==APPROVAL and re.fullmatch(r'\d{8}T\d{6}Z',request['runId']) is not None,'stage identity')
 need(os.geteuid()==os.getegid()==0 and socket.gethostname()==request['host'],'root host identity')
 raw=base64.b64decode(request['archiveBase64'],validate=True); mraw=base64.b64decode(request['manifestBase64'],validate=True)
 need(len(raw)<=MAX_BYTES+MAX_ENTRIES*1024 and len(mraw)<=4*1024*1024 and sha(raw)==request['archiveSHA256'] and sha(mraw)==request['manifestSHA256'],'stage transport commitment')
 manifest=json.loads(mraw); rows,blobs=verify_archive(raw,manifest); source=request['privatePlanSource']
 need(set(source)=={'path','metadata','sha256'} and re.fullmatch(r'/data/proofofwork-release-backups/audit30-mail-body-census-\d{8}T\d{6}Z/phase4-private-plan\.json',source['path']) is not None,'private plan source path')
 p=pathlib.Path(source['path']); pst=p.parent.lstat(); need(stat.S_ISDIR(pst.st_mode) and pst.st_uid==pst.st_gid==0 and stat.S_IMODE(pst.st_mode)==0o700 and p.parent.resolve()==p.parent,'private plan parent')
 data,identity=read_file(p,360*1024*1024); need(identity==source['metadata'] and identity['uid']==identity['gid']==0 and identity['mode']==0o600 and sha(data)==source['sha256'],'private plan custody')
 target=pathlib.Path('/data')/('proofofwork-audit30-inspect-inputs-'+request['runId']); need(not target.exists() and not target.is_symlink(),'staging exists')
 need(stat.S_ISDIR(target.parent.lstat().st_mode) and target.parent.resolve()==target.parent and target.parent.lstat().st_uid==0,'data parent')
 os.umask(0o077); new_dir(target); exclusive(target/'phase4-private-plan.json',data); closure=target/'pg-dependencies'; new_dir(closure)
 for row in rows[1:]:
  dest=closure/row['path']
  if row['kind']=='directory': new_dir(dest)
  else: exclusive(dest,blobs[row['path']])
 actual=[]
 for row in rows:
  item=dict(path=row['path'],kind=row['kind'],metadata=meta((closure/row['path']).lstat()))
  if row['kind']=='file': item['sha256']=row['sha256']
  actual.append(item)
 need(meta(p.lstat())==identity and sha(read_file(p,360*1024*1024)[0])==source['sha256'],'private plan final drift')
 receipt=dict(schema='pow-audit30-pg-root-staging-receipt-v1',approvalSha256=APPROVAL,runId=request['runId'],host=request['host'],portableArchiveSHA256=request['archiveSHA256'],portableManifestSHA256=request['manifestSHA256'],privatePlan=dict(path=str(target/'phase4-private-plan.json'),metadata=meta((target/'phase4-private-plan.json').lstat()),sha256=sha(data)),dependencySource=dict(path=str(closure),records=actual,recordsSha256=sha(enc(actual))),logicalBytes=manifest['logicalBytes'],pgEntrySHA256=manifest['pgEntrySHA256'])
 exclusive(target/'root-staging-receipt.json',enc(receipt)); return receipt

def main():
 ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='mode',required=True); b=sub.add_parser('build'); b.add_argument('--repository',type=pathlib.Path,required=True); b.add_argument('--output',type=pathlib.Path,required=True); sub.add_parser('stage'); args=ap.parse_args()
 if args.mode=='build': return build(args.repository,args.output)
 raw=sys.stdin.buffer.read(100*1024*1024+1); need(len(raw)<=100*1024*1024,'request cap'); return stage(json.loads(raw))
if __name__=='__main__':
 try: result=main(); print(json.dumps(result,sort_keys=True,separators=(',',':'))); code=0
 except Exception as e: print(json.dumps({'ok':False,'errorClass':type(e).__name__,'error':str(e)[:240]},sort_keys=True)); code=1
 sys.exit(code)
