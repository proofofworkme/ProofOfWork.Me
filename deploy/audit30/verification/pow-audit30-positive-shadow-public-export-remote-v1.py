
import base64,hashlib,json,os,pathlib,pwd,stat,subprocess
need=lambda v,m: None if v else (_ for _ in ()).throw(ValueError(m))
def read(path,pin,uid,gid):
 p=pathlib.Path(path);s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_uid==uid and s.st_gid==gid and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<=262144,'PUBLIC_FILE_SHAPE')
 stamp=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  need(stamp(os.fstat(fd))==stamp(s),'OPEN_DRIFT');raw=b''
  while b:=os.read(fd,65536):raw+=b;need(len(raw)<=262144,'READ_CAP')
  need(stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'READ_DRIFT')
 finally:os.close(fd)
 need(hashlib.sha256(raw).hexdigest()==pin,'PUBLIC_SHA');return raw
root='/data/proofofwork-audit30-positive-scoped-38ac6e2bff2a-20261003T042000Z-shadow-v1'
account=pwd.getpwnam('powadmin');rows={}
for name,path,pin,uid,gid in [('owner',root+'/completed.json','7b2bab1d1abe56a71888c809a7c562e756bb3ea3de2260a4c5aa673196b6163c',0,0),('child','/data/proofofwork-audit30-positive-scoped-output-38ac6e2bff2a-20261003T042000Z-shadow-v1/receipt.json','0647c7a70391d5caf6ff1d45667cbcde73dd47a423be4c4ef1df00241b23b4ef',account.pw_uid,account.pw_gid)]:
 raw=read(path,pin,uid,gid);rows[name]={'path':path,'sha256':pin,'bytes':len(raw),'base64':base64.b64encode(raw).decode()}
u='proofofwork-audit30-positive-scoped-38ac6e2bff2a-20261003T042000Z-shadow-v1.service'
e={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
s=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result'],env=e,capture_output=True,timeout=10,check=True)
need(not s.stderr,'STATE_READ');state=dict(x.split('=',1)for x in s.stdout.decode().splitlines()if '='in x)
need(state.get('MainPID')=='0' and state.get('ActiveState') in ['inactive','failed'] and (state.get('LoadState')=='not-found' or state.get('InvocationID')=='78573673e98945ee945fc1d2e61edb5a'),'OWNED_STOPPED_REQUIRED')
print(json.dumps({'schema':'pow-audit30-positive-shadow-public-export-v1','receipts':rows,'ownedUnitState':state,'privateContentsExported':False},sort_keys=True))
