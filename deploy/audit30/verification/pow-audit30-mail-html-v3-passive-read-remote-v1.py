#!/usr/bin/python3 -I -B
"""Fixed accepted mail public export and bounded native projection; no source/Exec/environment export."""
import base64,datetime,hashlib,json,os,pathlib,stat,subprocess,sys
BASE=pathlib.Path('/data/proofofwork-release-backups/audit30-mail-api-html-after-20261003T202300Z')
PINS={'public-result.json':(310437,'63c0e7206051c162a0a1d94a86c6ba01802816e47137144a405096cb2a22b051'),'completed.json':(3384589,'eff1c27b17ef0984abaa030241f3723c5126b969aa6bfdd8b8f1eec517d9cf2c')}
FIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('3372731','546739c810df48d4956961b0931b6fc5'),'proofofwork-indexer-worker.service':('3372743','b2dc36ef816c4311b4c9aa0740d781a9')}
UNIT='proofofwork-audit30-mail-api-html-after-20261003T202300Z.service'
SELECT=('LoadState','ActiveState','SubState','MainPID','InvocationID','Result','User','Group','SupplementaryGroups','MemoryMax','MemorySwapMax','CPUQuotaPerSecUSec','TasksMax','RuntimeMaxUSec','NoNewPrivileges','CapabilityBoundingSet','AmbientCapabilities','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','PrivateIPC','PrivateNetwork','RestrictAddressFamilies','ReadWritePaths','ReadOnlyPaths','InaccessiblePaths','ControlGroup','ExecMainStatus','KillMode')
def need(v,c):
 if not v:raise ValueError(c)
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def read(p,maximum):
 s=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=maximum,'ROOT_PUBLIC_FILE_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(stamp(os.fstat(f.fileno()))==stamp(s),'PUBLIC_FD_DRIFT');raw=f.read(maximum+1);need(len(raw)==s.st_size and stamp(os.fstat(f.fileno()))==stamp(s)==stamp(p.lstat()),'PUBLIC_READ_DRIFT')
 return raw,stamp(s)
def state(u):
 p=subprocess.run(['/usr/bin/systemctl','show',u,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Result'],env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},capture_output=True,timeout=10);need(p.returncode==0 and not p.stderr and len(p.stdout)<8192,'SERVICE_METADATA');return dict(x.split('=',1)for x in p.stdout.decode().splitlines())
def five():
 v={u:state(u)for u in FIVE};need(all(v[u]['ActiveState']=='active'and(v[u]['MainPID'],v[u]['InvocationID'])==pair for u,pair in FIVE.items()),'LIVE_FIVE_DRIFT');return v
def select(v):return {k:v[k]for k in SELECT if k in v}
def main():
 need(sys.flags.isolated and os.geteuid()==os.getegid()==0,'ROOT_ISOLATED');before=five();loaded={};meta={}
 for name,(size,digest)in PINS.items():
  raw,s=read(BASE/name,4*1024**2);need(len(raw)==size and hashlib.sha256(raw).hexdigest()==digest,'ACTUAL_RECEIPT_PIN');loaded[name]=json.loads(raw);meta[name]={'path':str(BASE/name),'bytes':size,'sha256':digest,'stamp':s}
  if name=='public-result.json':meta[name]['base64']=base64.b64encode(raw).decode()
 r=loaded['public-result.json'];c=loaded['completed.json'];need(r['schema']=='pow-audit30-mail-api-population-result-v1'and r['stage']=='after'and r['status']=='passed'and r['populationRows']==r['rowsChecked']==r['rowsMatchingRawAndIdentity']==619 and r['actorCount']==r['actorsAttempted']==33 and r['rowsWithDiscrepancies']==0 and not r['errors'],'ALL619_PUBLIC_ACCEPTANCE')
 need(all(r[k]is True for k in ['allExpectedRowsVerified','afterCutoverAccepted','publicHTTPSAll619Verified','privateCaptureUnchanged','sourceUnchanged','liveFiveUnchanged'])and all(r[k]is False for k in ['productionMutation','privatePayloadExported','addressesExported','financialCompleteness'])and r['publicHTTPSOrigin']=='https://computer.proofofwork.me'and r['newCoreCalls']==r['sqlCalls']==0,'PUBLIC_SCOPE_FLAGS')
 need(c['schema']=='pow-audit30-mail-api-native-outcome-v1'and c['status']=='passed'and c['productionMutation']is False and c['failure']is None and c['requestSha256']=='d8a456455ca7642ce3b3a663c5fa640f591a300965f6b9136ff1d352b6dff0b6'and c['result']['result']==r and c['cleanup']['verified']is True,'COMPLETED_BINDING')
 props=r['runtime']['actualProperties'];need(props['User']==props['Group']=='root'and props['SupplementaryGroups']=='1000'and props['MemoryMax']=='536870912'and props['MemorySwapMax']=='0'and props['CapabilityBoundingSet']==props['AmbientCapabilities']==''and props['NoNewPrivileges']=='yes','ACTUAL_GROUP_CAP_RESOURCE')
 need(c['cleanup']['after']['MainPID']=='0'and c['cleanup']['after']['ControlGroup']=='','OWNED_GROUP_STOPPED');need(c['packageAfterCleanup']==c['result']['package']and c['liveAfterCleanup']==c['result']['liveBefore'],'FINAL_NATIVE_CUSTODY')
 stderr,s=read(BASE/'stderr.log',65536);need(stderr==b'','EMPTY_STDERR');after=five();need(before==after,'LIVE_CHANGED_DURING_READ')
 for name,proof in meta.items():need(stamp((BASE/name).lstat())==tuple(proof['stamp']),'FINAL_RECEIPT_DRIFT')
 projection={'schema':c['schema'],'status':c['status'],'requestSha256':c['requestSha256'],'productionMutation':False,'automaticRetry':c['automaticRetry'],'backendResourceCapClaimed':c['backendResourceCapClaimed'],'cleanup':{'attempted':c['cleanup'].get('attempted'),'verified':True,'before':select(c['cleanup']['before']),'after':select(c['cleanup']['after'])},'lastRetainedProperties':select(c['result']['lastRetainedProperties']),'unitSnapshotCount':len(c['unitSnapshots']),'packageAfterCleanup':c['packageAfterCleanup'],'liveFiveUnchangedBeforeThroughAfterCleanup':True,'inlineExecOrSourceOrEnvironmentExported':False}
 print(json.dumps({'schema':'pow-audit30-mail-html-v3-passive-read-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':meta,'completedPublicProjection':projection,'unitState':state(UNIT),'currentFive':after,'currentFiveUnchangedDuringRead':True,'stderrHashOnly':{'bytes':0,'sha256':hashlib.sha256(stderr).hexdigest(),'rawExported':False},'privateBodyOrAddressOrEnvironmentExported':False,'productionMutation':False,'serviceControl':False},sort_keys=True))
if __name__=='__main__':main()
