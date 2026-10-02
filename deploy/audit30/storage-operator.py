#!/usr/bin/python3 -I
"""Reviewed operator: exact Audit30 UI storage tools; network actions are explicit.

prepare writes only a local deterministic package. upload, start, status and fetch
use the fixed UI host. start returns promptly; poll status instead of SSH waits.
No action removes a package, plan, receipt, lock, hold or mask.
"""
import argparse
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile
import uuid

REPO=Path('/home/sixer/ProofOfWork.Me')
HOST='root@77.42.91.106'
KEY='/home/sixer/.ssh/proofofwork_me_ed25519'
EVIDENCE='/var/backups/proofofwork-ui/cleanup-evidence'
AUTH='d99a40236b49b1735c794fb853c4f7f4f0724da8e3f83fab75c7464e0e8ee373'
PINS={
 'ui-storage.py':('deploy/audit30/ui-storage.py','f292da5dcda23393208d05e1cffaea0b50b9a9cc915b81a5b9d55fdd0aa81319'),
 'ui-release-policy.py':('deploy/audit30/ui-release-policy.py','f023bd536223437dd2dce5ece6c4c4995cd9d63c648b7fe2f9eabc354a10f22d'),
 'approval.json':('audits/2026-10-02-audit30-first-batch-approval.json',AUTH),
}
SHA=re.compile('[0-9a-f]{64}\\Z')

RUNNER=r'''import hashlib,json,os,selectors,signal,subprocess,sys,time
from pathlib import Path
package=Path(sys.argv[1]);prefix=Path(sys.argv[2]);args=json.loads(sys.argv[3]);pins=json.loads(sys.argv[4])
for name,expected in pins.items():
 p=package/name;s=p.lstat()
 if s.st_uid!=os.geteuid() or s.st_mode&0o7022 or p.resolve()!=p:raise ValueError('Unsafe private tool file')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb') as f:raw=f.read(2*1024**2)
 if hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('Tool hash changed')
def sync_parent(p):
 fd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def exclusive(p):return os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
outpath=Path(str(prefix)+'.stdout.json');errpath=Path(str(prefix)+'.stderr.log');resultpath=Path(str(prefix)+'.result.json')
out=exclusive(outpath);err=exclusive(errpath);sync_parent(outpath)
start=time.monotonic();child=None;counts=[0,0];hashes=[hashlib.sha256(),hashlib.sha256()];failure=None;code=None
def interrupt(number,frame):
 if child and child.poll() is None:child.send_signal(number)
 raise InterruptedError('Operator signal '+str(number))
for number in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):signal.signal(number,interrupt)
try:
 child=subprocess.Popen(['/usr/bin/python3','-I','-B',str(package/args[0]),*args[1:]],stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=False,env={'PATH':'/usr/bin:/bin','PYTHONDONTWRITEBYTECODE':'1'})
 selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ,0);selector.register(child.stderr,selectors.EVENT_READ,1)
 while selector.get_map():
  for key,_ in selector.select(timeout=2):
   b=os.read(key.fileobj.fileno(),1024**2)
   if not b:selector.unregister(key.fileobj);continue
   i=key.data;counts[i]+=len(b)
   if counts[i]>(64*1024**2 if i==0 else 8*1024**2):raise ValueError('Bounded task output limit exceeded')
   hashes[i].update(b);view=memoryview(b)
   while view:
    written=os.write(out if i==0 else err,view);view=view[written:]
 code=child.wait(timeout=30)
except BaseException as error:
 failure=type(error).__name__
 if child and child.poll() is None:
  child.send_signal(signal.SIGTERM)
  try:code=child.wait(timeout=150)
  except subprocess.TimeoutExpired:child.kill();code=child.wait(timeout=10)
finally:
 os.fsync(out);os.fsync(err);os.close(out);os.close(err)
 result={'status':'completed' if code==0 and failure is None else 'failed','returnCode':code,'errorClass':failure,'seconds':round(time.monotonic()-start,3),'stdoutPath':str(outpath),'stdoutSha256':hashes[0].hexdigest(),'stdoutBytes':counts[0],'stderrPath':str(errpath),'stderrSha256':hashes[1].hexdigest(),'stderrBytes':counts[1],'argv':args,'privatePackage':str(package)}
 fd=exclusive(resultpath)
 try:
  raw=(json.dumps(result,sort_keys=True)+'\n').encode();os.write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
 sync_parent(resultpath)
if result['status']!='completed':raise SystemExit(1)
'''

INSTALL=r'''import fcntl,hashlib,io,json,os,stat,subprocess,sys,tarfile
from pathlib import Path
expected=sys.argv[1];pins=json.loads(sys.argv[2]);target=Path(sys.argv[3]);limit=2*1024**2
raw=sys.stdin.buffer.read(limit+1)
if len(raw)>limit or hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('Upload package hash differs')
parent=target.parent;s=parent.lstat()
if parent.resolve()!=parent or s.st_uid or s.st_mode&0o7022 or not stat.S_ISDIR(s.st_mode):raise ValueError('Unsafe evidence parent')
lock=Path('/run/proofofwork-ui/deploy.lock');s=lock.lstat()
if s.st_uid or s.st_mode&0o7022 or not stat.S_ISREG(s.st_mode) or s.st_nlink!=1:raise ValueError('Unsafe deployment lock')
fd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
try:
 helper='/usr/local/sbin/proofofwork-ui-capacity'
 for command in [['check','--additional-bytes',str(len(raw)*3+1024**2),'--additional-inodes','32'],['check-scratch','--additional-bytes','0']]:
  subprocess.run(['/usr/bin/python3','-I','-B',helper,*command,'--path','/var/tmp/proofofwork-deploy','--phase','audit30-private-tools'],check=True,capture_output=True,timeout=60)
 archive=tarfile.open(fileobj=io.BytesIO(raw),mode='r:');members=archive.getmembers()
 if len(members)!=len(pins) or set(m.name for m in members)!=set(pins):raise ValueError('Expanded tool package')
 payload={}
 for m in members:
  if not m.isfile() or m.name not in pins or '/' in m.name or m.mode!=0o644 or m.uid or m.gid or m.size>1024**2:raise ValueError('Unsafe tool package member')
  b=archive.extractfile(m).read()
  if hashlib.sha256(b).hexdigest()!=pins[m.name]:raise ValueError('Tool member hash differs')
  payload[m.name]=b
 if os.path.lexists(target):raise ValueError('Private package path already exists; retain/review it')
 target.mkdir(mode=0o700)
 for name,b in payload.items():
  f=os.open(target/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
  try:
   view=memoryview(b)
   while view:view=view[os.write(f,view):]
   os.fsync(f)
  finally:os.close(f)
 for p in (target,parent):
  f=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(f)
  finally:os.close(f)
 print(json.dumps({'status':'installed-private-tools','package':str(target),'packageSha256':expected,'members':pins,'holdsOrMasksChanged':False}))
finally:os.close(fd)
'''

def sha(raw):return hashlib.sha256(raw).hexdigest()
def package():
    files={}
    for name,(relative,expected) in PINS.items():
        raw=(REPO/relative).read_bytes()
        if sha(raw)!=expected:raise ValueError('Local reviewed source hash changed: '+name)
        files[name]=raw
    files['runner.py']=RUNNER.encode();pins={n:sha(b) for n,b in files.items()};data=io.BytesIO()
    with tarfile.open(fileobj=data,mode='w',format=tarfile.USTAR_FORMAT) as archive:
        for name,raw in sorted(files.items()):
            info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o644;info.uid=info.gid=info.mtime=0;archive.addfile(info,io.BytesIO(raw))
    raw=data.getvalue();h=sha(raw);return raw,h,pins,EVIDENCE+'/audit30-private-tools-'+h

def ssh(argv,input=None,timeout=55,check=True):
    command=' '.join(shlex.quote(str(x)) for x in argv)
    return subprocess.run(['ssh','-i',KEY,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',HOST,command],input=input,capture_output=True,check=check,timeout=timeout)
def evidence_path(value):
    p=Path(value)
    if str(p.parent)!=EVIDENCE or not p.name.startswith('audit30-') or p.name in ('.','..'):raise ValueError('Exact durable Audit30 evidence path required')
    return str(p)
def pin(value):
    if not value or not SHA.fullmatch(value):raise ValueError('Exact SHA256 required')
    return value
def start(a,h,pins,directory):
    authority=['--approval',directory+'/approval.json','--approval-sha256',AUTH]
    if a.operation=='bootstrap':args=['ui-release-policy.py','admit-bootstrap',*authority,'--record']
    elif a.operation=='plan-reconcile':
        args=['ui-storage.py','plan-reconcile',*authority,'--reconciliation-review',evidence_path(a.reconciliation_review),'--reconciliation-review-sha256',pin(a.reconciliation_review_sha256)]
    elif a.operation in ('plan-cleanup','plan-preservation','plan-inverse'):
        args=['ui-storage.py',a.operation,*authority]
        if a.operation!='plan-cleanup':
            receipt='cleanup' if a.operation=='plan-preservation' else 'preservation'
            args+=['--'+receipt+'-receipt',evidence_path(a.receipt),'--'+receipt+'-receipt-sha256',pin(a.receipt_sha256)]
    elif a.operation in ('verify','apply'):args=['ui-storage.py',a.operation,*authority,'--plan',evidence_path(a.plan),'--plan-sha256',pin(a.plan_sha256)]
    else:
        command={'policy-admit':'admit-release','policy-plan':'plan','policy-verify':'verify','policy-apply':'apply'}[a.operation]
        args=['ui-release-policy.py',command,*authority,'--index',evidence_path(a.index),'--index-sha256',pin(a.index_sha256)]
        if command=='admit-release':args+=['--record']
        elif command in ('verify','apply'):args+=['--plan',evidence_path(a.plan),'--plan-sha256',pin(a.plan_sha256)]
    if bool(a.citation_review)!=bool(a.citation_review_sha256) or a.citation_review and a.operation not in ('plan-cleanup','policy-plan'):raise ValueError('Citation path/SHA pair is admitted only by cleanup/policy plans')
    if a.citation_review:args+=['--citation-review',evidence_path(a.citation_review),'--citation-review-sha256',pin(a.citation_review_sha256)]
    if bool(a.reconciliation_review)!=bool(a.reconciliation_review_sha256) or a.reconciliation_review and a.operation!='plan-reconcile':raise ValueError('Reconciliation path/SHA pair is admitted only by explicit reconciliation planning')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:12]
    unit='pow-audit30-storage-'+stamp;prefix=EVIDENCE+'/audit30-run-'+a.operation+'-'+stamp
    deadline='90min' if a.operation in ('apply','policy-apply') else '30min'
    command=['systemd-run','--unit',unit,'--collect','--property=Type=exec','--property=CPUQuota=50%','--property=MemoryMax=2G','--property=MemorySwapMax=0','--property=IOSchedulingClass=idle','--property=IOWeight=10','--property=Nice=15','--property=RuntimeMaxSec='+deadline,'--property=TimeoutStopSec=180s','--property=KillMode=mixed','--property=UMask=0077','--property=NoNewPrivileges=yes','--property=PrivateTmp=no','--','/usr/bin/python3','-I','-B',directory+'/runner.py',directory,prefix,json.dumps(args),json.dumps(pins)]
    result=ssh(command);return {'unit':unit,'prefix':prefix,'package':directory,'packageSha256':h,'deadline':deadline,'controllerArgv':args,'launchOutput':result.stdout.decode(),'launchError':result.stderr.decode(),'resultPath':prefix+'.result.json','stdoutPath':prefix+'.stdout.json','stderrPath':prefix+'.stderr.log'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['prepare','upload','start','status','fetch']);p.add_argument('--operation',choices=['bootstrap','plan-cleanup','plan-reconcile','plan-preservation','plan-inverse','verify','apply','policy-admit','policy-plan','policy-verify','policy-apply']);p.add_argument('--receipt');p.add_argument('--receipt-sha256');p.add_argument('--plan');p.add_argument('--plan-sha256');p.add_argument('--index');p.add_argument('--index-sha256');p.add_argument('--unit');p.add_argument('--prefix');p.add_argument('--remote-path');p.add_argument('--sha256');p.add_argument('--output',type=Path);p.add_argument('--citation-review');p.add_argument('--citation-review-sha256');p.add_argument('--reconciliation-review');p.add_argument('--reconciliation-review-sha256')
    a=p.parse_args();raw,h,pins,directory=package()
    if a.command=='prepare':
        target=Path('/tmp/pow-audit30-ui-tools-'+h+'.tar')
        if target.exists():
            if target.read_bytes()!=raw:raise ValueError('Local package collision')
        else:
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            try:os.write(fd,raw);os.fsync(fd)
            finally:os.close(fd)
        out={'localPackage':str(target),'packageSha256':h,'bytes':len(raw),'privateRemotePackage':directory,'members':pins,'productionMutation':False}
    elif a.command=='upload':out=json.loads(ssh(['/usr/bin/python3','-I','-B','-c',INSTALL,h,json.dumps(pins),directory],raw).stdout)
    elif a.command=='start':
        if not a.operation:raise ValueError('Exact operation required')
        out=start(a,h,pins,directory)
    elif a.command=='status':
        if not a.unit or not re.fullmatch('pow-audit30-storage-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}',a.unit):raise ValueError('Exact unit required')
        prefix=evidence_path(a.prefix)
        code="import json,os,sys;from pathlib import Path;p=Path(sys.argv[1]+'.result.json');s=p.lstat() if p.exists() else None;assert s is None or (s.st_uid==0 and not s.st_mode&0o7022 and s.st_size<=65536);print(p.read_text() if s else json.dumps({'status':'running-or-no-result','prefix':sys.argv[1]}))"
        out=json.loads(ssh(['/usr/bin/python3','-I','-B','-c',code,prefix]).stdout);unit=ssh(['systemctl','show',a.unit,'--property=LoadState,ActiveState,SubState,Result,ExecMainStatus,MemoryCurrent,CPUUsageNSec'],timeout=30,check=False);out['unitState']=unit.stdout.decode();out['unitQueryReturnCode']=unit.returncode;out['unitStateQualification']='Collected transient units may report not-found/default properties; durable result JSON is the operation outcome authority.'
    else:
        target=evidence_path(a.remote_path);expected=pin(a.sha256)
        if not a.output or a.output.exists():raise ValueError('Fresh local output path required')
        code="import hashlib,os,stat,sys;from pathlib import Path;p=Path(sys.argv[1]);s=p.lstat();assert p.resolve()==p and s.st_uid==0 and not s.st_mode&0o7022 and stat.S_ISREG(s.st_mode) and s.st_size<=64*1024**2;fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME);f=os.fdopen(fd,'rb');raw=f.read(s.st_size+1);assert len(raw)==s.st_size and hashlib.sha256(raw).hexdigest()==sys.argv[2];sys.stdout.buffer.write(raw)"
        b=ssh(['/usr/bin/python3','-I','-B','-c',code,target,expected],timeout=55).stdout
        if sha(b)!=expected:raise ValueError('Fetched bytes hash differs')
        fd=os.open(a.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            view=memoryview(b)
            while view:view=view[os.write(fd,view):]
            os.fsync(fd)
        finally:os.close(fd)
        out={'localPath':str(a.output),'sha256':expected,'bytes':len(b),'remotePath':target,'productionMutation':False}
    print(json.dumps(out,sort_keys=True))

if __name__=='__main__':main()
