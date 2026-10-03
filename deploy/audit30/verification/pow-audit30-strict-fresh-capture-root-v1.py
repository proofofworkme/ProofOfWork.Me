#!/usr/bin/env python3
"""Creation-only fresh verifier capture, using exact installed helper; no service control."""
import datetime,hashlib,json,os,pathlib,stat,subprocess
ENV={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0'}
TOOLS=pathlib.Path('/var/tmp/proofofwork-deploy/audit29-tools')
PINS={'private-verify.py':'8a569828272b10abc8848dd01678a1a3b45002acd489802f89b6e056de3e0c1e','private-env.py':'99cbe9cd118c63b08480efd28c2ae7c059b5204daef8db08b896a38fc791d515'}
LIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
def stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def root_read(p,limit):
 assert p.resolve()==p
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  a=os.fstat(fd);assert stat.S_ISREG(a.st_mode) and stat.S_IMODE(a.st_mode)==0o600 and a.st_uid==a.st_gid==0 and a.st_nlink==1 and 0<a.st_size<=limit
  data=b''
  while True:
   b=os.read(fd,min(65536,limit+1-len(data)))
   if not b:break
   data+=b;assert len(data)<=limit
  assert len(data)==a.st_size and stamp(a)==stamp(os.fstat(fd))==stamp(p.lstat());return data
 finally:os.close(fd)
def state(u):
 r=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,MainPID,InvocationID,Result'],env=ENV,capture_output=True,timeout=10)
 assert r.returncode==0 and not r.stderr and len(r.stdout)<65536
 return dict(v.split('=',1)for v in r.stdout.decode().splitlines()if '='in v)
def live():
 rows={u:state(u)for u in LIVE}
 assert all(rows[u]['MainPID']==pid and rows[u]['InvocationID']==inv and rows[u]['ActiveState']=='active'for u,(pid,inv)in LIVE.items())
 return rows
def main():
 assert os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0;os.umask(0o077)
 s=TOOLS.lstat();assert TOOLS.resolve()==TOOLS and stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700
 hashes={name:hashlib.sha256(root_read(TOOLS/name,2*1024**2)).hexdigest()for name in PINS};assert hashes==PINS
 before=live();backup=state('proofofwork-postgres-logical-backup.service');assert backup['ActiveState']=='inactive'and backup['MainPID']=='0'and backup['Result']=='success'
 capture='38ac6e2bff2a-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 directory=pathlib.Path('/run/proofofwork-audit5-'+capture);assert not os.path.lexists(directory)
 argv=['/usr/bin/python3','-I','-B',str(TOOLS/'private-verify.py'),'--private-env-sha256',PINS['private-env.py'],'capture','--capture-id',capture]
 r=subprocess.run(argv,env=ENV,capture_output=True,timeout=30);assert r.returncode==0 and not r.stderr and len(r.stdout)<65536
 result=json.loads(r.stdout);assert result['ok']is True and result['operation']=='capture'and result['directory']==str(directory)
 s=directory.lstat();assert directory.resolve()==directory and stat.S_ISDIR(s.st_mode)and stat.S_IMODE(s.st_mode)==0o700 and s.st_uid==s.st_gid==0
 raw=root_read(directory/'capture.json',65536);manifest=json.loads(raw);assert manifest['format']=='private-audit5-environments-v1'and manifest['releaseId']==capture
 assert hashlib.sha256(raw).hexdigest()==result['manifestSha256'] and manifest['processes']['api']['environmentSha256']==result['apiEnvironSha256']=='327427c12f187d5b200a9a2323025bd659688e72c3e10faac24545fc514fdb5c'
 for kind in ['api','worker']:
  row=manifest['processes'][kind];assert row['identityBefore']==row['identityAfter']==row['identityFinal'];blob=root_read(directory/(kind+'.environ'),2*1024**2);assert len(blob)==row['environmentBytes'] and hashlib.sha256(blob).hexdigest()==row['environmentSha256']
 after=live();assert before==after;assert {name:hashlib.sha256(root_read(TOOLS/name,2*1024**2)).hexdigest()for name in PINS}==hashes
 print(json.dumps(dict(schema='pow-audit30-strict-fresh-private-capture-v1',captureId=capture,capturedAt=manifest['capturedAt'],directory=str(directory),manifestSHA256=result['manifestSha256'],apiEnvironSHA256=result['apiEnvironSha256'],liveFiveUnchanged=True,prior042000CaptureTouched=False,helperSHA256=hashes,privateContentsExported=False,productionMutation=False,timerChanges=False),sort_keys=True))
if __name__=='__main__':main()
