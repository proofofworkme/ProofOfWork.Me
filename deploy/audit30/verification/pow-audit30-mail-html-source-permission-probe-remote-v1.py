#!/usr/bin/python3 -I -B
"""Fixed public-source mode/hash plus capless read-open probe. No private bytes or writes."""
import datetime,hashlib,json,os,pathlib,pwd,stat,subprocess,sys
SOURCES={
 '/opt/proofofwork-api/src/App.tsx':('87fd17ac3ade8eff1a5beae96f0bac6b43866d16ac8487d9bc347aa01b2a7ca2',4*1024**2),
 '/opt/proofofwork-api/src/shared/utils/encoding.ts':('ab938b32d9884bd20ad33658aeb0fa1cc79e4d8576529f7127e266f3b06b4ca9',65536),
 '/opt/proofofwork-api/server/proof-api.mjs':('9ab92c0fe3cb358fcaacccd62915eabc4c9ee75e42d29c6c989259b1305436f4',4*1024**2),
}
def need(v,c):
 if not v:raise ValueError(c)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def metadata(path):
 s=path.lstat();need(path.resolve(strict=True)==path,'CANONICAL_FIXED_PATH')
 return {'path':str(path),'uid':s.st_uid,'gid':s.st_gid,'mode':oct(stat.S_IMODE(s.st_mode)),'regular':stat.S_ISREG(s.st_mode),'directory':stat.S_ISDIR(s.st_mode),'bytes':s.st_size,'metadata':list(stamp(s))}
def main():
 need(sys.flags.isolated and os.geteuid()==os.getegid()==0,'ROOT_ISOLATED')
 owner=pwd.getpwnam('powadmin');need(owner.pw_uid>0 and owner.pw_gid>0,'FIXED_PUBLIC_OWNER')
 rows={};before={};parents=set()
 for name,(expected,limit)in SOURCES.items():
  p=pathlib.Path(name);s=p.lstat();before[p]=stamp(s)
  need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==owner.pw_uid and s.st_nlink==1 and s.st_size<=limit,'PUBLIC_SOURCE_SHAPE')
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   need(stamp(os.fstat(fd))==before[p],'SOURCE_FD_DRIFT');raw=os.read(fd,limit+1)
   need(len(raw)==s.st_size and hashlib.sha256(raw).hexdigest()==expected and stamp(os.fstat(fd))==before[p]==stamp(p.lstat()),'SOURCE_PIN_DRIFT')
  finally:os.close(fd)
  rows[name]=metadata(p)|{'sha256':expected,'bodyExported':False}
  parents.update(p.parents)
 ancestor_rows=[metadata(p)for p in sorted(parents,key=str)]
 child="import hashlib,json,os; paths="+repr(list(SOURCES))+";out={};\nfor p in paths:\n try:\n  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);os.close(fd);out[p]={'readOpenAccepted':True}\n except OSError as e:out[p]={'readOpenAccepted':False,'errorClass':type(e).__name__,'errno':e.errno,'reasonSha256':hashlib.sha256(str(e).encode()).hexdigest()}\nprint(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'capabilityLines':[x for x in open('/proc/self/status').read().splitlines()if x.startswith(('CapInh:','CapPrm:','CapEff:','CapBnd:','CapAmb:','NoNewPrivs:'))],'opens':out},sort_keys=True))"
 probes={}
 for label,groups in [('rootOnly','0'),('rootWithPublicOwnerGroup','0,'+str(owner.pw_gid))]:
  argv=['/usr/bin/setpriv','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','--groups='+groups,'/usr/bin/python3','-I','-B','-c',child]
  r=subprocess.run(argv,env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},capture_output=True,timeout=20)
  need(r.returncode==0 and not r.stderr and len(r.stdout)<=16384,'CAPPED_PROBE_REFUSED');probes[label]=json.loads(r.stdout)
 for p,old in before.items():need(stamp(p.lstat())==old,'FINAL_SOURCE_DRIFT')
 print(json.dumps({'schema':'pow-audit30-mail-html-source-permission-probe-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':rows,'ancestors':ancestor_rows,'publicOwner':{'uid':owner.pw_uid,'gid':owner.pw_gid},'caplessReadOpenProbes':probes,'privateMailOrEnvironmentRead':False,'productionMutation':False,'serviceControl':False},sort_keys=True))
if __name__=='__main__':main()
