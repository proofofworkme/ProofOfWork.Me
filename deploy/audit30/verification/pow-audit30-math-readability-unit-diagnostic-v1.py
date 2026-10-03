import pathlib,subprocess,shlex,hashlib,json,os
source='''import subprocess,json,hashlib,pathlib,os
unit='proofofwork-audit30-math-source-readability-v2.service';props='LoadState,ActiveState,SubState,User,Group,InvocationID,MainPID,ExecStart,MemoryMax,MemorySwapMax,CPUQuotaPerSecUSec,TasksMax,RuntimeMaxUSec,Restart,NoNewPrivileges,PrivateNetwork,CapabilityBoundingSet,Result,ExecMainStatus,ControlGroup'
env={'PATH':'/usr/bin:/bin','LC_ALL':'C'}
def show(u,p):
 r=subprocess.run(['/usr/bin/systemctl','show',u,'--property='+p],env=env,stdin=subprocess.DEVNULL,capture_output=True,timeout=10);assert r.returncode==0 and not r.stderr and len(r.stdout)<=65536;return dict(x.split('=',1)for x in r.stdout.decode().splitlines()if '='in x)
a=show(unit,props);b=show(unit,props);assert a==b
live={n:show(n,'ActiveState,MainPID,InvocationID')for n in ['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service']}
p=pathlib.Path('/usr/local/lib/proofofwork-audit30-onhost-math/v2/source-copy-failed.json');failure=json.loads(p.read_bytes()) if p.exists() else None
print(json.dumps({'schema':'pow-audit30-math-readability-readonly-unit-diagnostic-v1','unit':unit,'actualUnitProperties':a,'liveFiveCurrent':live,'failureReceipt':failure,'sourceCopyPreserved':pathlib.Path('/usr/local/lib/proofofwork-audit30-onhost-math/v2/source').is_dir(),'noStopResetRetry':True,'productionMutation':False}))
'''
ssh=['/usr/bin/ssh','-i','/home/sixer/.ssh/proofofwork_node_ed25519','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','powadmin@65.108.122.87'];r=subprocess.run(ssh+['sudo -n /usr/bin/python3 -I -B -c '+shlex.quote(source)],stdin=subprocess.DEVNULL,capture_output=True,timeout=40);p=pathlib.Path('/tmp/pow-audit30-math-readability-unit-diagnostic-native-v1.json');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.write(fd,r.stdout);os.fsync(fd);os.close(fd);assert r.returncode==0 and not r.stderr
v=json.loads(r.stdout);print(json.dumps({'captureSHA256':hashlib.sha256(r.stdout).hexdigest(),'bytes':len(r.stdout),'properties':v['actualUnitProperties'],'failureReceipt':v['failureReceipt'],'liveFiveCurrent':v['liveFiveCurrent']}))
