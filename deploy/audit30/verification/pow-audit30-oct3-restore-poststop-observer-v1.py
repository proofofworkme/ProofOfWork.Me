import datetime,hashlib,json,os,signal,stat,subprocess,sys
from pathlib import Path

JOB=Path('/data/proofofwork-audit30-restore-20261003T104500Z')
UNIT='proofofwork-audit30-logical-restore-20261003T104500Z.service'
PLAN='6f87050e6b44c74cd6c6ba61fb9c8c922ba8436ee4111e31c1e8bcd3f1d8cfee'
FILES={
 'completed.json':'206f9d76eb5df9d05ca0c12b47e99c3dcb280b558bdbda760cb5fad4c57c3562',
 'table-row-parity.json':'fa6057e02efce49595a8ac445dd8d3b2ab84d0816257700640230a9b46af8ccc',
 'offline-page-check.json':'6dbe7303362f23138ecf269f24412a4eb50dae2808437e1329d61b660de8759f',
 'saved-snapshot-fence.json':'db67874c0a5f1dff3d42acba88f1d0bd6ee43bd98a987e0659afeeb7361873a9'}
LIVE={
 'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),
 'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),
 'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),
 'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),
 'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}

def need(v,s):
 if not v:raise ValueError(s)
def metadata(s):
 return dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def command(argv):
 p=subprocess.run(argv,stdin=0,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C'})
 need(p.returncode==0 and not p.stderr and len(p.stdout)<=16384,'FIXED_METADATA_COMMAND')
 return p.stdout.decode()
def properties(unit,fields):
 raw=command(['/usr/bin/systemctl','show',unit,'--no-pager']+['--property='+k for k in fields]);out={}
 for line in raw.splitlines():
  k,sep,v=line.partition('=');need(sep and k in fields and k not in out,'CLOSED_UNIT_PROPERTIES');out[k]=v
 need(set(out)==set(fields),'COMPLETE_UNIT_PROPERTIES');return out
def public_file(name,pin):
 p=JOB/name;s=p.lstat();m=metadata(s)
 need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and m['uid']==108 and m['gid']==112 and m['mode']==0o600 and m['nlink']==1 and m['bytes']<=65536,'FIXED_PUBLIC_RECEIPT_CUSTODY')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(metadata(os.fstat(f.fileno()))==m and not os.listxattr(f.fileno()),'PUBLIC_RECEIPT_FD')
  raw=f.read(65537);need(metadata(os.fstat(f.fileno()))==m,'PUBLIC_RECEIPT_READ_DRIFT')
 need(metadata(p.lstat())==m and len(raw)==m['bytes'] and hashlib.sha256(raw).hexdigest()==pin,'PUBLIC_RECEIPT_PIN')
 return {'metadata':m,'sha256':pin,'value':json.loads(raw)}
def absent(path):
 try:path.lstat()
 except FileNotFoundError:return True
 return False
def main():
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==1 and os.uname().nodename=='pow-bitcoin-01','ROOT_FIXED_HOST_ISOLATED')
 def timeout(*_):raise TimeoutError('OBSERVATION50_SECOND_DEADLINE')
 signal.signal(signal.SIGALRM,timeout);signal.alarm(50)
 receipts={n:public_file(n,h)for n,h in FILES.items()};c=receipts['completed.json']['value']
 need(c['schema']=='pow-audit30-isolated-logical-restore-completed-v1' and c['planSha256']==PLAN and c['status']=='passed' and c['privateClusterStopped'] is True and c['productionDatabaseMutation'] is False,'ACTUAL_FIXED_COMPLETION')
 # Exact original private/controller PIDs must be absent, not merely idle.
 processAbsences={str(p):absent(Path('/proc')/str(p))for p in(3106741,3106608)}
 need(all(processAbsences.values()),'ORIGINAL_OWNED_PIDS_REMAIN')
 paths=[JOB/'cluster'/'postmaster.pid',JOB/'socket'/'.s.PGSQL.55432',JOB/'socket'/'.s.PGSQL.55432.lock']
 privateAbsences={str(p):absent(p)for p in paths};need(all(privateAbsences.values()),'PRIVATE_PID_OR_SOCKET_REMAINS')
 cg=Path('/sys/fs/cgroup/system.slice')/UNIT;cgAbsent=absent(cg)
 cgroupProcesses=[] if cgAbsent else[c for c in(cg/'cgroup.procs').read_text().splitlines()]
 need(not cgroupProcesses,'OWNED_CGROUP_NOT_EMPTY')
 owned=properties(UNIT,('LoadState','ActiveState','SubState','MainPID','InvocationID','Result','ExecMainStatus','ControlGroup'))
 need(owned['MainPID']=='0' and owned['ActiveState']in('inactive','failed') and owned['LoadState']in('loaded','not-found'),'OWNED_UNIT_NOT_STOPPED')
 if owned['LoadState']=='loaded':need(owned['InvocationID']=='322aeb150b664d7fa8380b8f6c7ed1f1' and owned['Result']=='success' and owned['ExecMainStatus']=='0','OWNED_INVOCATION_RESULT')
 first={n:properties(n,('LoadState','ActiveState','SubState','MainPID','InvocationID'))for n in LIVE}
 for n,pin in LIVE.items():need(first[n]['LoadState']=='loaded' and first[n]['ActiveState']=='active' and first[n]['SubState']=='running' and(first[n]['MainPID'],first[n]['InvocationID'])==pin,'ORIGINAL_FIVE_DRIFT')
 storage=command(['/usr/bin/df','-B1','--output=size,used,avail,pcent,target','/data','/'])
 second={n:properties(n,('LoadState','ActiveState','SubState','MainPID','InvocationID'))for n in LIVE};need(first==second,'FIVE_ENDPOINT_DRIFT')
 signal.alarm(0)
 return dict(schema='pow-audit30-oct3-restore-poststop-observation-v1',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),status='passed-fixed-poststop-observation',restorePlanSha256=PLAN,receipts=receipts,originalPidsAbsent=processAbsences,privatePidAndSocketsAbsent=privateAbsences,ownedCgroupAbsent=cgAbsent,ownedCgroupProcesses=cgroupProcesses,ownedUnit=owned,ownedUnitGarbageCollected=owned['LoadState']=='not-found',unitInvocationObservedDuringActualRun='322aeb150b664d7fa8380b8f6c7ed1f1',originalFive=first,originalFiveUnchanged=True,storageDfText=storage,productionMutation=False,configurationChanged=False,additionalDeletionPerformed=False,livePhysicalPagesCertified=False,pitrCertified=False,qualification='Fixed public receipt custody plus original PID/private socket/cgroup and original-five endpoints. Auto-collected unit metadata is qualified by the preserved actual managed outcome; no stop/control command, private COPY/body read, full current-chain reconciliation or live-page/PITR claim.')
if __name__=='__main__':
 try:r=main()
 except BaseException as e:print(json.dumps({'schema':'pow-audit30-oct3-restore-poststop-refusal-v1','errorClass':type(e).__name__,'reasonSha256':hashlib.sha256(str(e).encode()).hexdigest(),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
 print(json.dumps(r,sort_keys=True,separators=(',',':')))
