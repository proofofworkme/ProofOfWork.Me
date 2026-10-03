#!/usr/bin/python3 -I
"""Fixed path/access evidence only; no application imports, SQL, or mutations."""
import datetime,hashlib,json,os,pathlib,pwd,signal,subprocess,sys,time
UTILITY_PIN='a22d3e024a59a7dc036c73011e95f1ac7fa38588c1cd583108a269276f82c5df'
STAGE='/opt/proofofwork-api-stage-38ac6e2bff2a-20261003T042000Z'
PATHS=[('root','/'),('opt','/opt'),('stage',STAGE),('server',STAGE+'/server'),('db',STAGE+'/server/db'),('postgres-module',STAGE+'/server/db/postgres.mjs'),('mail-module',STAGE+'/server/proof-index-mail-projection.mjs'),('dependencies',STAGE+'/node_modules'),('pg-directory',STAGE+'/node_modules/pg'),('pg-library',STAGE+'/node_modules/pg/lib'),('pg-entry',STAGE+'/node_modules/pg/lib/index.js'),('stage-package',STAGE+'/package.json'),('pg-package',STAGE+'/node_modules/pg/package.json')]
CHILD='''import hashlib,json,os,pathlib,stat
PATHS='''+repr(PATHS)+'''
rows=[]
for label,path in PATHS:
 row={'label':label,'pathSHA256':hashlib.sha256(path.encode()).hexdigest(),'readAccess':os.access(path,os.R_OK,effective_ids=True),'searchOrExecuteAccess':os.access(path,os.X_OK,effective_ids=True)}
 try:
  s=os.lstat(path);row.update({'statAvailable':True,'kind':'directory'if stat.S_ISDIR(s.st_mode)else 'file'if stat.S_ISREG(s.st_mode)else 'symlink'if stat.S_ISLNK(s.st_mode)else 'other','mode':format(stat.S_IMODE(s.st_mode),'04o'),'uid':s.st_uid,'gid':s.st_gid,'bytes':s.st_size,'device':s.st_dev,'inode':s.st_ino,'nlink':s.st_nlink})
  if stat.S_ISREG(s.st_mode):
   if s.st_size>131072:row['hashRefused']='SIZE_BOUND'
   else:
    try:
     fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
     try:
      a=os.fstat(fd);raw=os.read(fd,131073);b=os.fstat(fd);stamp=lambda v:(v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_gid,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
      if len(raw)>131072 or stamp(a)!=stamp(b) or stamp(a)!=stamp(os.lstat(path)):raise RuntimeError('METADATA_DRIFT')
      row['contentSHA256']=hashlib.sha256(raw).hexdigest()
     finally:os.close(fd)
    except OSError as e:row['hashRefused']='ACCESS_DENIED'if e.errno==13 else 'ABSENT'if e.errno==2 else 'FILE_REFUSED'
 except OSError as e:row.update({'statAvailable':False,'statRefused':'ACCESS_DENIED'if e.errno==13 else 'ABSENT'if e.errno==2 else 'PATH_REFUSED'})
 rows.append(row)
print(json.dumps({'schema':'pow-audit30-fixed-mail-path-access-v1','uid':os.getuid(),'gid':os.getgid(),'effectiveUid':os.geteuid(),'effectiveGid':os.getegid(),'groups':os.getgroups(),'rows':rows},sort_keys=True))
'''
ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C','TZ':'UTC'}
def need(v,label):
 if not v:raise ValueError(label)
def observed_stamp(path,utility):
 try:return {'present':True,'metadata':utility['stamp'](path)}
 except FileNotFoundError:return {'present':False}
def closed_rows(v,uid,gid):
 need(set(v)=={'schema','uid','gid','effectiveUid','effectiveGid','groups','rows'}and v['schema']=='pow-audit30-fixed-mail-path-access-v1'and (v['uid'],v['gid'],v['effectiveUid'],v['effectiveGid'])==(uid,gid,uid,gid)and v['groups']==[]and [r['label']for r in v['rows']]==[x[0]for x in PATHS],'ROLE_METADATA_SCOPE')
 base={'label','pathSHA256','readAccess','searchOrExecuteAccess','statAvailable'};metadata={'kind','mode','uid','gid','bytes','device','inode','nlink'}
 for r,(_,path)in zip(v['rows'],PATHS):
  need(r['pathSHA256']==hashlib.sha256(path.encode()).hexdigest()and all(type(r[k])is bool for k in ['readAccess','searchOrExecuteAccess','statAvailable']),'PATH_ROW_SCOPE')
  if r['statAvailable']:
   need(base|metadata<=set(r)<=base|metadata|{'contentSHA256','hashRefused'}and r['kind']in ['directory','file','symlink','other']and len(r['mode'])==4 and all(x in '01234567'for x in r['mode'])and all(type(r[k])is int and r[k]>=0 for k in ['uid','gid','bytes','device','inode','nlink'])and not('contentSHA256'in r and 'hashRefused'in r),'PATH_STAT_SCOPE')
   if 'contentSHA256'in r:need(len(r['contentSHA256'])==64 and all(x in '0123456789abcdef'for x in r['contentSHA256']),'PATH_HASH_SCOPE')
   if 'hashRefused'in r:need(r['hashRefused']in ['SIZE_BOUND','ACCESS_DENIED','ABSENT','FILE_REFUSED'],'PATH_HASH_SCOPE')
  else:need(set(r)==base|{'statRefused'}and r['statRefused']in ['ACCESS_DENIED','ABSENT','PATH_REFUSED'],'PATH_REFUSAL_SCOPE')
 return v
def role(uid,gid):
 p=None;start=time.monotonic();old={s:signal.getsignal(s)for s in [signal.SIGTERM,signal.SIGINT]};stdout=stderr=b''
 def interrupted(s,f):raise RuntimeError('PATH_DIAGNOSTIC_SIGNAL')
 for s in old:signal.signal(s,interrupted)
 try:
  p=subprocess.Popen([sys.executable,'-I','-B','-c',CHILD],cwd='/',env=ENV,user=uid,group=gid,extra_groups=[],umask=0o077,start_new_session=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  stdout,stderr=p.communicate(timeout=10);need(p.returncode==0 and not stderr and len(stdout)<=32768,'ROLE_METADATA_REFUSED');v=closed_rows(json.loads(stdout),uid,gid);return {'observed':v,'seconds':round(time.monotonic()-start,3),'childStopped':True,'stdoutBytes':len(stdout),'stdoutSHA256':hashlib.sha256(stdout).hexdigest(),'stderrBytes':0,'stderrSHA256':hashlib.sha256(stderr).hexdigest()}
 except BaseException:
  for s in old:signal.signal(s,signal.SIG_IGN)
  if p is not None:
   try:
    if p.poll()is None:
     try:os.killpg(p.pid,signal.SIGKILL)
     except ProcessLookupError:pass
   finally:p.wait(timeout=5)
  raise
 finally:
  if p is not None:
   for stream in [p.stdout,p.stderr]:
    if stream is not None:stream.close()
  for s,h in old.items():signal.signal(s,h)
def main(source,leaf,utility):
 need(hashlib.sha256(utility).hexdigest()==UTILITY_PIN,'UTILITY_PIN');n={'__name__':'_fixed_no_import','__file__':'fixed-reviewed-import-utility.py'};exec(compile(utility,n['__file__'],'exec'),n);need(os.getuid()==0,'ROOT');need(hashlib.sha256(leaf).hexdigest()==n['LEAF_PIN'],'LEAF_PIN');a,c,predicates=n['context'](source);before=[observed_stamp(path,n)for _,path in PATHS];account=c['account'];need((c['database_account'].pw_uid,c['database_account'].pw_gid)==(108,112),'NATIVE_PG_ACCOUNT');roles={'postgres':role(108,112),'powadmin':role(account.pw_uid,account.pw_gid)};need([observed_stamp(path,n)for _,path in PATHS]==before,'PATH_METADATA_CHANGED');need(c['a']['live']()==c['before']and c['a']['timer_shape']()==c['timer']and c['original']['proc_identity']('api',account)==c['source_identity'],'LIVE_DRIFT')
 for name,pin in [('server/db/postgres.mjs','2b959860e0513907447459c1b196bfaaf81fba5131bfa050e528f911c18e616c'),('server/proof-index-mail-projection.mjs','bc3c4efa87e3a9b7c0918d340d5626ca08491d7c6695f8951ce2c817c88f900c')]:c['h']['read'](a['CWD']/name,account.pw_uid,expected=pin)
 need(hashlib.sha256(pathlib.Path('/proc/'+str(c['source_identity']['pid'])+'/environ').read_bytes()).hexdigest()==a['ENV_SHA'],'FINAL_ENV_DRIFT')
 print(json.dumps({'schema':'pow-audit30-mail-import-path-metadata-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'roles':roles,'parentPathMetadataUnchanged':True,'pinnedModulesUnchanged':True,'liveFiveUnchanged':True,'timerUnchanged':True,'applicationImports':0,'sqlCalls':0,'apiCalls':0,'coreCalls':0,'filesystemMutation':False,'permissionChanges':False,'originalFocusedFailureCauseReconstructed':False,'qualification':'Fixed thirteen path labels and metadata/read/search booleans under exact native role ids with empty supplementary groups. Public source/package bytes hashed only; no application imports or body/DSN reads. This is new path evidence, not reconstruction of the discarded original child stderr.'},sort_keys=True))
