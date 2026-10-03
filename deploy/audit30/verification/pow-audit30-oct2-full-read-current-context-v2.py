#!/usr/bin/python3 -I
"""Fixed metadata-only Oct2 full-read request context; no native unit action."""
import base64,datetime,hashlib,json,os,re,resource,signal,stat,sys,time,types
from pathlib import Path
NATIVE_SHA='ad03e5d02e10018fb7c5dd3c118a7ac876331cad240832c52e4838a4bea0ff2a'
NATIVE_BYTES=24954
RUN='20261003T093000Z'
class ContextInterrupted(RuntimeError):pass
def need(v,m):
 if not v:raise ValueError(m)
def sha(v):return hashlib.sha256(v).hexdigest()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'Duplicate context JSON');d[k]=v
 return d
def load_native(v):
 need(isinstance(v,dict)and set(v)=={'schema','run','nativeSourceSha256','nativeSourceBase64'}and v['schema']=='pow-audit30-oct2-full-read-current-context-request-v1'and v['run']==RUN and v['nativeSourceSha256']==NATIVE_SHA,'Closed fixed context request')
 raw=base64.b64decode(v['nativeSourceBase64'],validate=True);need(len(raw)==NATIVE_BYTES and sha(raw)==NATIVE_SHA,'Exact inert managed-v2 definitions')
 m=types.ModuleType('frozen-oct2-managed-definitions');m.__file__='raw-sha-pinned-inert-managed-v2';exec(compile(raw,m.__file__,'exec'),m.__dict__);need(m.RID==RUN,'Exact context/native namespace');return m

def collect(m):
 before=m.live();window=m.quiet();files={}
 for p in m.STATIC:
  raw,metadata=m.read_file(p,2097152);h=sha(raw);need(str(p)not in m.FIXED_HASHES or h==m.FIXED_HASHES[str(p)],'Fixed protected old bytes');files[str(p)]={'metadata':metadata,'sha256':h}
 s=m.MASK.lstat();need(m.MASK.parent.resolve(strict=True)==m.MASK.parent and stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0 and os.readlink(m.MASK)=='/dev/null'and not os.listxattr(m.MASK,follow_symlinks=False),'Exact current root prune mask')
 protection={'files':files,'mask':{'metadata':m.metadata(s),'target':'/dev/null'},'units':{name:m.show(name,m.PROTECTED_FIELDS_BY_UNIT[name])for name in m.PROTECTED}}
 need(m.protection(protection)==protection,'Protected current endpoints differ');after=m.live();window_after=m.quiet();need(after==before and window_after==window,'Current five/window endpoint drift');need(m.protection(protection)==protection,'Final protection endpoint drift')
 return dict(schema='pow-audit30-oct2-full-read-current-context-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),run=RUN,nativeSourceSha256=NATIVE_SHA,expectedLive=before,expectedProtection=protection,backupWindow=window,liveBeforeAfterEqual=True,protectedEndpointEquality=True,requiredBackupClearSeconds=900,chosenActionMayPrecedeCutover=True,knownHeldAbsencesUnresolved=18,productionMutation=False,unitCreationOrControlPerformed=False,sqlExecuted=False,fullBackupReadPerformed=False,backupLockAcquired=False,pinOrCheckerChanged=False,privateContentsExported=False,automaticRetry=False,qualification='Fixed public file hashes/metadata and selected systemd states only. The chosen-action five is current; postcutover identities are required only if the action follows cutover. No backup bytes, globals contents, private environment or SQL read. Endpoint equality does not prove continuous or future exclusion, resolve the18 known absences, or authorize promotion/recovery/deletion.')

def main():
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and len(sys.argv)==1 and os.uname().nodename=='pow-bitcoin-01','Fixed isolated root context role')
 resource.setrlimit(resource.RLIMIT_AS,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(30,30));old={}
 def interrupted(n,f):raise ContextInterrupted('Fixed60s context signal/deadline')
 for n in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM):old[n]=signal.signal(n,interrupted)
 signal.setitimer(signal.ITIMER_REAL,60)
 try:
  raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536,'Context input byte cap');v=json.loads(raw,object_pairs_hook=pairs);m=load_native(v);m.DEADLINE=time.monotonic()+60;print(json.dumps(collect(m),sort_keys=True,separators=(',',':')))
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for n,h in old.items():signal.signal(n,h)
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(schema='pow-audit30-oct2-full-read-current-context-refused-v1',errorClass=type(e).__name__,reasonSha256=sha(str(e).encode()),productionMutation=False,unitCreationOrControlPerformed=False,sqlExecuted=False,automaticRetry=False)),file=sys.stderr);raise SystemExit(1)
