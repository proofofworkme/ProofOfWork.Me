"""Read-only admission for an existing exact read-only shadow capture and empty cache."""
import hashlib,json,os,pathlib,pwd,stat
RELEASE='38ac6e2bff2a-20261003T042000Z'
API_SHA='327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c'
def dir_stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def admit_existing_capture_cache(read,helper_bytes,helper_path):
 n={'__name__':'_exact_original_private_env','__file__':str(helper_path)};exec(compile(helper_bytes,str(helper_path),'exec'),n)
 account=pwd.getpwnam('powadmin');directory=pathlib.Path(n['runroot'](RELEASE));n['check_root_dir'](str(directory));manifest_raw=read(directory/'capture.json');manifest=json.loads(manifest_raw)
 assert manifest['format']=='private-audit5-environments-v1'and manifest['releaseId']==RELEASE and set(manifest['processes'])=={'api','worker'}
 snapshots={}
 for kind in ['api','worker']:
  m=manifest['processes'][kind];before=n['proc_identity'](kind,account);assert m['identityBefore']==m['identityAfter']==m['identityFinal']==before
  blob=read(directory/(kind+'.environ'));assert len(blob)==m['environmentBytes']and hashlib.sha256(blob).hexdigest()==m['environmentSha256']
  if kind=='api':assert m['environmentSha256']==API_SHA
  with open('/proc/'+str(before['pid'])+'/environ','rb')as f:current=f.read(1024**2+1)
  assert len(current)<=1024**2 and current==blob and n['proc_identity'](kind,account)==before
  snapshots[kind]=dict(identity=before,environmentSHA256=hashlib.sha256(blob).hexdigest(),environmentBytes=len(blob))
 cache=pathlib.Path('/data/proofofwork-api-cache-shadow-'+RELEASE);info=cache.lstat();identity_raw=read(directory/'shadow-cache.json');identity=json.loads(identity_raw)
 assert cache.resolve()==cache and stat.S_ISDIR(info.st_mode)and info.st_uid==account.pw_uid and info.st_gid==account.pw_gid and stat.S_IMODE(info.st_mode)==0o700
 assert identity==dict(path=str(cache),dev=info.st_dev,inode=info.st_ino,uid=account.pw_uid,gid=account.pw_gid)
 with os.scandir(cache)as entries:assert next(entries,None)is None
 assert dir_stamp(cache.lstat())==dir_stamp(info) and read(directory/'capture.json')==manifest_raw and read(directory/'shadow-cache.json')==identity_raw
 for kind in ['api','worker']:assert n['proc_identity'](kind,account)==snapshots[kind]['identity']
 return dict(schema='pow-audit30-existing-shadow-capture-cache-reuse-v1',releaseId=RELEASE,capturePath=str(directory),captureSHA256=hashlib.sha256(manifest_raw).hexdigest(),shadowCacheIdentity=identity,shadowCacheEmpty=True,currentApiAndWorkerEnvironmentBytesEqual=True,processes=snapshots,preservedCaptureAndCache=True,privateContentsExported=False)
