#!/usr/bin/python3 -I -B
"""Local-only exact postcutover request assembly; never SSH, API or native launch."""
import argparse,base64,datetime,hashlib,json,os,pathlib,re,stat,sys,types
NATIVE=pathlib.Path('/tmp/pow-audit30-postcutover-mail-html-native-v1.py');NATIVE_SHA='63bef564fc34e390e1b4ca70c95079ebd8be684dbe07854a5f4dc1071b5ecdc8'
COLLECTOR=pathlib.Path('/tmp/pow-audit30-postcutover-mail-html-collector-v1.py');COLLECTOR_SHA='3bcc3e071222de97529cd54bf045885ffdac2f2f2f305cbb471561dedf7f4dff'
UTILITY=pathlib.Path('/home/sixer/ProofOfWork.Me/deploy/audit30/verification/pow-audit30-treasury-native-v7.py');UTILITY_SHA='7d6b6fe8337db471b2de3147dcff528916b4d8c7629e4d344803913469084b55'
RELEASE='38ac6e2bff2a-20261003T042000Z';COMMIT='38ac6e2bff2ac16890724e5213346ef8a3ebd186'
AUTH={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c')}
OLD={'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
def need(v,m):
 if not v:raise ValueError(m)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(a):
 d={}
 for k,v in a:need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
 return d
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def bound(p,h,maximum=65536):
 p=pathlib.Path(p);s=p.lstat();need(p.resolve()==p and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and 0<s.st_size<=maximum and re.fullmatch('[0-9a-f]{64}',h),'LOCAL_INPUT_SHAPE');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  b=f.read(maximum+1);need(stamp(os.fstat(f.fileno()))==stamp(s),'LOCAL_FD_DRIFT')
 need(stamp(p.lstat())==stamp(s)and len(b)==s.st_size and sha(b)==h,'LOCAL_BYTES_DRIFT');return b
def authority(live,cutover,remote_path,at=None):
 need(type(live)is dict and set(live)==set(AUTH)|set(OLD),'FIVE_SCOPE')
 for unit,row in live.items():need(type(row)is dict and set(row)=={'MainPID','InvocationID'}and isinstance(row['MainPID'],str)and re.fullmatch('[1-9][0-9]*',row['MainPID'])and re.fullmatch('[0-9a-f]{32}',str(row['InvocationID'])),'FIVE_IDENTITY_SHAPE')
 need(all((live[u]['MainPID'],live[u]['InvocationID'])==pair for u,pair in AUTH.items()),'ORIGINAL_AUTHORITIES_CHANGED')
 need(all(live[u]['MainPID']!=pair[0]and live[u]['InvocationID']!=pair[1]for u,pair in OLD.items())and len({r['MainPID']for r in live.values()})==5,'FRESH_APPLICATION_IDENTITIES_REQUIRED')
 need(re.fullmatch(re.escape('/data/proofofwork-audit29-cutover-'+RELEASE)+r'-[a-z0-9][a-z0-9-]{0,24}/[0-9]{3}-final\.json',remote_path),'CUTOVER_RECEIPT_PATH')
 need(cutover.get('ok')is True and cutover.get('phase')=='complete'and cutover.get('commit')==COMMIT and cutover.get('authorityServicesModified')is False and cutover.get('recoveryRemoved')is False,'CUTOVER_NOT_COMPLETE')
 date=datetime.datetime.fromisoformat(cutover['at'].replace('Z','+00:00'));need(date.tzinfo is not None and 0<=((at or datetime.datetime.now(datetime.timezone.utc))-date).total_seconds()<=1800,'CUTOVER_STALE')
def assemble(run_id,live,cutover,receipt_path):
 authority(live,cutover,receipt_path);need(re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z',run_id)and datetime.datetime.strptime(run_id,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==run_id,'RUN_ID')
 raw=bound(NATIVE,NATIVE_SHA);M=types.ModuleType('_postcutover_mail_native');M.__file__=str(NATIVE);exec(compile(raw,str(NATIVE),'exec'),M.__dict__)
 need(M.COLLECTOR_SHA==COLLECTOR_SHA and M.UTILITY_SHA==UTILITY_SHA,'SOURCE_PIN_LINK')
 child={'schema':'pow-audit30-mail-api-population-request-v1','approvalSha256':M.APPROVAL,'stage':'after','runId':run_id,'sourceSha256':COLLECTOR_SHA,'liveFive':live};request_raw=encoded(child);code=bound(COLLECTOR,COLLECTOR_SHA);utility=bound(UTILITY,UTILITY_SHA)
 values={}
 for mode in ['prepare','run']:
  v={'schema':'pow-audit30-mail-api-native-request-v1','approvalSha256':M.APPROVAL,'mode':mode,'collectorBase64':base64.b64encode(code).decode(),'utilityBase64':base64.b64encode(utility).decode(),'collectorRequestBase64':base64.b64encode(request_raw).decode(),'collectorRequestSha256':sha(request_raw)};M.request(v);values[mode]=v
 return child,values
def write(p,b):
 p=pathlib.Path(p);need(p.parent==pathlib.Path('/tmp')and p.resolve(strict=False)==p,'OUTPUT_SCOPE');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
 fd=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
 return {'path':str(p),'bytes':len(b),'sha256':sha(b)}
def main():
 need(sys.flags.isolated,'LOCAL_ISOLATED');a=argparse.ArgumentParser()
 for name in ['run-id','live-five','live-five-sha256','cutover-final','cutover-final-sha256','cutover-receipt-path','output-prefix']:a.add_argument('--'+name,required=True)
 p=a.parse_args();five_raw=bound(p.live_five,p.live_five_sha256);final_raw=bound(p.cutover_final,p.cutover_final_sha256);live=json.loads(five_raw,object_pairs_hook=pairs);final=json.loads(final_raw,object_pairs_hook=pairs);child,values=assemble(p.run_id,live,final,p.cutover_receipt_path)
 files=[write(p.output_prefix+'.collector-request.json',encoded(child))]+[write(p.output_prefix+'.'+mode+'-request.json',encoded(values[mode]))for mode in ['prepare','run']]
 print(json.dumps({'schema':'pow-audit30-postcutover-mail-html-local-assembly-v1','status':'assembled-for-root-review','files':files,'freshFiveSourceSHA256':p.live_five_sha256,'cutoverFinal':{'path':p.cutover_receipt_path,'sha256':p.cutover_final_sha256},'nativeSourceSHA256':NATIVE_SHA,'collectorSourceSHA256':COLLECTOR_SHA,'nativeCallsMade':False,'qualification':'Local requests bind root-observed fresh five and canonical completed cutover receipt. Native collector rechecks actual five and candidate API/UI source before and after; raw mail and addresses remain remote.'},sort_keys=True))
if __name__=='__main__':main()
