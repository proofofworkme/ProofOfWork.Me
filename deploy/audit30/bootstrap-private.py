import base64,datetime,hashlib,importlib.util,json,os,pathlib,pwd,re,shlex,stat,subprocess,sys
from pathlib import Path
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
def pairs(a):
 d={}
 for k,v in a:
  assert k not in d;d[k]=v
 return d
assert os.geteuid()==0 and sys.flags.isolated
os.umask(0o077)
raw=sys.stdin.buffer.read(2*1024**2+1);assert len(raw)<=2*1024**2
v=json.loads(raw,object_pairs_hook=pairs)
assert set(v)=={'schema','approvalSha256','kind','package','sources','planBase64','planSha256'} and v['schema']=='pow-audit30-phase7-private-bootstrap-v1' and v['approvalSha256']==APPROVAL
assert v['kind'] in ('restore','pitr')
package=Path(v['package']);assert re.fullmatch(r'/data/proofofwork-audit30-phase7-tools-'+v['kind']+r'-[0-9]{8}T[0-9]{6}Z',str(package))
assert package.parent.resolve(strict=True)==package.parent and not package.exists() and not package.is_symlink()
expected={'restore-latest-logical.py'}|({'rehearse-pitr-mechanics.py'} if v['kind']=='pitr' else set())
assert set(v['sources'])==expected
sources={}
for n,row in v['sources'].items():
 assert set(row)=={'base64','sha256'} and re.fullmatch(r'[0-9a-f]{64}',row['sha256'])
 b=base64.b64decode(row['base64'],validate=True);assert len(b)<1024**2 and hashlib.sha256(b).hexdigest()==row['sha256'];compile(b,n,'exec');sources[n]=b
planraw=base64.b64decode(v['planBase64'],validate=True);assert len(planraw)<65536 and hashlib.sha256(planraw).hexdigest()==v['planSha256']
plan=json.loads(planraw,object_pairs_hook=pairs);assert plan['approvalSha256']==APPROVAL and plan['host']==os.uname().nodename
run=plan['runId'];datetime.datetime.strptime(run,'%Y%m%dT%H%M%SZ');assert re.fullmatch(r'[0-9]{8}T[0-9]{6}Z',run) and package.name.endswith(run)
if v['kind']=='restore':
 assert plan['schema']=='pow-audit30-latest-logical-restore-plan-v1' and plan['controllerSha256']==v['sources']['restore-latest-logical.py']['sha256']
 assert plan['job']=='/data/proofofwork-audit30-restore-'+run and plan['unit']=='proofofwork-audit30-logical-restore-'+run+'.service'
 credential='restore-plan';executable='restore-latest-logical.py'
else:
 assert plan['schema']=='pow-audit30-pitr-mechanics-plan-v1' and plan['sourceSha256']==v['sources']['rehearse-pitr-mechanics.py']['sha256'] and plan['guardSha256']==v['sources']['restore-latest-logical.py']['sha256']
 assert plan['job']=='/data/proofofwork-audit30-pitr-mechanics-'+run and plan['unit']=='proofofwork-audit30-pitr-mechanics-'+run+'.service'
 credential='rehearsal-plan';executable='rehearse-pitr-mechanics.py'
job=Path(plan['job']);assert job.parent.resolve(strict=True)==job.parent and not job.exists() and not job.is_symlink()
unit=plan['unit'];assert subprocess.run(['systemctl','show',unit,'-p','LoadState','--value'],capture_output=True,text=True,timeout=10).stdout.strip()=='not-found'
pg=pwd.getpwnam('postgres')
def fsyncdir(p):
 f=os.open(p,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(f)
 finally:os.close(f)
def create(p,b,mode,gid):
 f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
 with os.fdopen(f,'wb') as o:o.write(b);o.flush();os.fchown(o.fileno(),0,gid);os.fchmod(o.fileno(),mode);os.fsync(o.fileno())
 fsyncdir(Path(p).parent)
package.mkdir(mode=0o750);os.chown(package,0,pg.pw_gid);os.chmod(package,0o750)
for n,b in sources.items():create(package/n,b,0o440,pg.pw_gid)
create(package/'reviewed-plan.json',planraw,0o600,0)
# Pure structure validation before the private job or transient unit exists.
spec=importlib.util.spec_from_file_location('phase7_authority',package/executable);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.validate_plan(plan)
job.mkdir(mode=0o700);os.chown(job,pg.pw_uid,pg.pw_gid);fsyncdir(job.parent)
properties={
 'Type':'exec','CPUQuota':'100%','CPUWeight':'10','MemoryHigh':str(6*1024**3),'MemoryMax':str(8*1024**3),'TasksMax':'64','IOWeight':'10','Nice':'15','RuntimeMaxSec':'2h','TimeoutStopSec':'90s','KillMode':'control-group','UMask':'0077',
 'NoNewPrivileges':'yes','PrivateNetwork':'yes','PrivateTmp':'yes','PrivateIPC':'yes','PrivateDevices':'yes','ProtectSystem':'strict','ProtectHome':'yes','ProtectKernelTunables':'yes','ProtectKernelModules':'yes','ProtectControlGroups':'yes','RestrictAddressFamilies':'AF_UNIX','CapabilityBoundingSet':'','AmbientCapabilities':'',
 'ReadWritePaths':str(job),'ReadOnlyPaths':'/data/proofofwork-postgres-backups/logical','InaccessiblePaths':'/var/lib/postgresql /run/postgresql /data/proofofwork-postgres-tablespaces -/data/proofofwork-postgres-backups/physical /etc/proofofwork-api','LoadCredential':credential+':'+str(package/'reviewed-plan.json')}
cmd=['systemd-run','--unit='+unit.removesuffix('.service'),'--description=Audit30 approved isolated '+v['kind']+' verification','--wait','--pipe','--uid=postgres','--gid=postgres']+['--property='+k+'='+val for k,val in properties.items()]+['/usr/bin/python3','-I','-B',str(package/executable)]
if v['kind']=='restore':cmd+=['run']
cmd+=['--plan','/run/credentials/'+unit+'/'+credential,'--plan-sha256',v['planSha256']]
print(json.dumps({'phase':'bootstrap-created','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'package':str(package),'job':str(job),'unit':unit,'sourceHashes':{k:v['sources'][k]['sha256'] for k in v['sources']},'planSha256':v['planSha256'],'command':cmd,'productionDataMutation':False},sort_keys=True),flush=True)
r=subprocess.run(cmd,stdin=subprocess.DEVNULL,timeout=7400)
evidence={}
allowed=['intent.json','source-verification.json','private-start-identity.json','role-verification.json','owner-acl-parity.json','table-row-parity.json','accounting-mail-observations.json','saved-snapshot-fence.json','credit-source-integrity.json','exact-credit-invariants.json','offline-page-check.json','resource-failure.json','watchdog-stop-requested.json','failed.json','completed.json','completion.json','failure.json','cleanup-failure.json']
for n in allowed:
 p=job/n
 if not p.exists():continue
 assert p.resolve(strict=True)==p and stat.S_ISREG(p.lstat().st_mode) and p.stat().st_size<2*1024**2
 b=p.read_bytes();evidence[n]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'value':json.loads(b,object_pairs_hook=pairs)}
print(json.dumps({'phase':'bootstrap-finished','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'package':str(package),'job':str(job),'unit':unit,'returnCode':r.returncode,'evidence':evidence,'productionDataMutation':False,'retainedAllCreatedFiles':True},sort_keys=True),flush=True)
raise SystemExit(r.returncode)
