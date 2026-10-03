#!/usr/bin/python3 -I -B
"""Passive fixed strict-v3 progress, bounded prior failure from owned v3 intent."""
import datetime,hashlib,json,os,pathlib,pwd,re,stat,subprocess
R='38ac6e2bff2a-20261003T042000Z';UNIT='proofofwork-audit29-verify-'+R+'-shadow-strict-v3.service';SHADOW='proofofwork-audit29-shadow-'+R+'-lease-v3.service'
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-'+R);LAUNCH=pathlib.Path('/data/proofofwork-audit29-verify-launch-'+R+'-shadow-strict-v3');OUTPUT=pathlib.Path('/data/proofofwork-audit29-verify-output-'+R+'-shadow-strict-v3/attempt/receipt.json')
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
def need(v,m):
 if not v:raise ValueError(m)
def state(unit):
 r=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result,RuntimeMaxUSec'],env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},capture_output=True,timeout=8,check=True);need(not r.stderr and len(r.stdout)<=8192,'STATE_REFUSED');return dict(x.split('=',1)for x in r.stdout.decode().splitlines()if '='in x)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p):
 s=p.lstat();a=pwd.getpwnam('powadmin');owner=(a.pw_uid,a.pw_gid)if p==OUTPUT else(0,0);need(p.resolve()==p and stat.S_ISREG(s.st_mode)and(s.st_uid,s.st_gid)==owner and s.st_nlink==1 and 0<s.st_size<=4*1024**2 and stat.S_IMODE(s.st_mode)==0o600,'FILE_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:b=os.read(fd,4*1024**2+1);need(len(b)==s.st_size and stamp(os.fstat(fd))==stamp(s)==stamp(p.lstat()),'FILE_DRIFT')
 finally:os.close(fd)
 return json.loads(b),hashlib.sha256(b).hexdigest()
def prior_projection(v):
 p=v.get('priorFailedAttempt',{});need(p.get('schema')=='audit30-strict-v2-bounded-failure-evidence-v1'and p.get('driverReceiptSHA256')=='0f77ed860b40e4762f4ad0962dbc66faded888d6db865bd44e542842eff5689c'and p.get('failure')=='STRICT_GATE_FAILED'and p.get('gates')=={'ids':True,'events':True,'parity':False},'PRIOR_BINDING');need(p.get('timerRestored')is True and p.get('unitStopped')is True and p.get('privateContentsExported')is False and p.get('rawChildOutputExported')is False,'PRIOR_QUALIFICATION')
 gates={}
 for name in ['ids','events','parity']:
  row=p['gateReceipts'][name];public={k:row[k]for k in ['exitCode','stdoutBytes','stderrBytes','stdoutSha256','scriptSha256','checkpointStable']};need(all(type(public[k])is int and 0<=public[k]<=128*1024**2 for k in ['stdoutBytes','stderrBytes'])and re.fullmatch('[0-9a-f]{64}',public['stdoutSha256'])and re.fullmatch('[0-9a-f]{64}',public['scriptSha256']),'PRIOR_GATE_DIGEST')
  if name=='ids':
   counts=row['counts'];need(counts=={'Fetched transactions':587,'Confirmed winners':508,'Pending candidates':20,'Covered confirmed registry transactions':565,'Covered pending registry transactions':22},'PRIOR_COUNTS');public['counts']=counts
  else:
   need(row['checkCount']==(102 if name=='parity'else 49),'PRIOR_CHECK_COUNT');failed=row['failedChecks'];expected=[{'name':'work-token-state-current-relational','ok':False,'severity':'error'},{'name':'work-amo-v5-migration','ok':False,'severity':'warning'},{'name':'work-amo-v5-usd-quote-head','ok':False,'severity':'warning'}]if name=='parity'else[];need(sorted(failed,key=lambda c:c['name'])==sorted(expected,key=lambda c:c['name']),'PRIOR_FAILED_CHECKS');public.update(checkCount=row['checkCount'],failedChecks=expected)
  gates[name]=public
 return dict(schema=p['schema'],driverReceiptPath='/data/proofofwork-audit29-verify-output-'+R+'-shadow-strict-v2/attempt/receipt.json',driverReceiptSHA256=p['driverReceiptSHA256'],failure='STRICT_GATE_FAILED',gates=p['gates'],gateReceipts=gates,timerRestored=True,unitStopped=True,privateContentsExported=False,rawChildOutputExported=False)
def main():
 need(os.geteuid()==os.getegid()==0,'ROOT');states={u:state(u)for u in (UNIT,SHADOW,'proofofwork-postgres-logical-backup.service','proofofwork-postgres-logical-backup.timer',*LIVE)};gates=[];cg=pathlib.Path('/sys/fs/cgroup/system.slice')/UNIT/'cgroup.procs'
 if cg.exists():
  for line in cg.read_text().splitlines():
   try:a=(pathlib.Path('/proc')/line/'cmdline').read_bytes().split(b'\0');matches=[b for b in a if b.rsplit(b'/',1)[-1]in {b'audit-id-registry.mjs',b'audit-computer-events.mjs',b'check-proof-indexer-parity.mjs',b'verify-candidate.mjs'}];gates.extend(b.rsplit(b'/',1)[-1].decode()for b in matches)
   except FileNotFoundError:pass
 proofs={};prior=None
 for p in (ROOT/'strict-native-v3-intent.json',ROOT/'strict-native-v3-completed.json',ROOT/'strict-native-v3-failed.json',LAUNCH/'accepted-receipt.json',LAUNCH/'launcher-final.json',OUTPUT):
  if p.exists():
   key=p.name if p!=OUTPUT else 'driver-receipt.json'
   try:
    v,h=read(p);proofs[key]={'sha256':h,'ok':v.get('ok'),'errorClass':v.get('errorClass'),'failure':v.get('failure'),'gates':v.get('gates')}
    if p==ROOT/'strict-native-v3-intent.json':prior=prior_projection(v)
   except (ValueError,KeyError,FileNotFoundError)as e:proofs[key]={'readErrorClass':type(e).__name__}
 print(json.dumps({'schema':'audit30-strict-v3-passive-progress-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'states':states,'activeGateScripts':sorted(set(gates)),'proofs':proofs,'priorFailedAttempt':prior,'serviceControl':False,'privateContentsExported':False},sort_keys=True))
if __name__=='__main__':main()
