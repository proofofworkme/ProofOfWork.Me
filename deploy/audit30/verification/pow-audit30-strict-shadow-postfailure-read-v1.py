#!/usr/bin/python3 -I
"""Fixed read-only postfailure timer/live/owned-unit and closed driver receipt observation."""
import datetime,hashlib,json,os,pathlib,pwd,re,stat
ROOT=pathlib.Path('/data/proofofwork-release-backups/audit30-node-release-38ac6e2bff2a-20261003T042000Z');LAUNCH=pathlib.Path('/data/proofofwork-audit29-verify-launch-38ac6e2bff2a-20261003T042000Z-shadow-strict-v1');OUTPUT=pathlib.Path('/data/proofofwork-audit29-verify-output-38ac6e2bff2a-20261003T042000Z-shadow-strict-v1/attempt/receipt.json')
PIN='b3c71c2a48ffb59a297c0fa7264fd417b498b0464d34577859c6bb0ee17fb1c9'
def need(v,m):
 if not v:raise ValueError(m)
def fence(v):
 if v is None:return None
 need(type(v)is dict and set(v)=={'height','hash'}and type(v['height'])is int and 0<=v['height']<=9007199254740991 and re.fullmatch('[0-9a-f]{64}',str(v['hash'])),'FENCE_SHAPE');return v
ENUM={'CORE_CHECKPOINT_MOVED','STRICT_GATE_FAILED','READONLY_GATE_FAILED','READONLY_VERIFICATION_FAILED','OVERALL_TIME_BUDGET_EXCEEDED','REGISTRY_AUTHORITY_UNAVAILABLE','REGISTRY_SEMANTIC_PARITY_FAILED','CORE_READ_REFUSED','READONLY_SQL_PREFLIGHT_FAILED'}
def enum(v):return v if v in ENUM else {'unrecognizedSHA256':hashlib.sha256(str(v).encode()).hexdigest()}if v is not None else None
def driver_projection(v):
 need(v.get('format')=='audit29-candidate-readonly-v1'and v.get('mode')=='shadow'and v.get('base')==v.get('authority')=='http://127.0.0.1:18081','DRIVER_SCOPE');g=v.get('gates',{});need(set(g)=={'ids','events','parity'}and all(type(x)is bool for x in g.values()),'GATES');out={'ok':v.get('ok')is True,'failure':enum(v.get('failure')),'originalFailure':enum(v.get('originalFailure')),'gates':g,'checkpointBefore':fence(v.get('checkpointBefore')),'checkpointAfter':fence(v.get('checkpointAfter')),'gateReceipts':{}}
 for name,row in v.get('gateReceipts',{}).items():
  need(name in g and type(row)is dict,'GATE_SCOPE');r={k:row.get(k)for k in ['exitCode','stdoutBytes','stderrBytes','stdoutSha256','scriptSha256','startedAt','completedAt','checkpointStable','checkCount','outputNotJson']};r['before']=fence(row.get('before'));r['after']=fence(row.get('after'));checks=row.get('checks',[]);need(type(checks)is list and len(checks)<=2048,'CHECK_BOUND');r['checksTotal']=len(checks);r['failedCheckNameSHA256']=[hashlib.sha256(str(c.get('name')).encode()).hexdigest()for c in checks if c.get('ok')is not True];r['counts']={k:x for k,x in row.get('counts',{}).items()if k in ['Fetched transactions','Confirmed winners','Pending candidates','Covered confirmed registry transactions','Covered pending registry transactions']and type(x)is int and 0<=x<=1000000};out['gateReceipts'][name]=r
 return out
def main():
 need(os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0,'ROOT');p=ROOT/'strict-native-tools-v1'/'assembly.py';m=p.lstat();need(p.resolve()==p and stat.S_ISREG(m.st_mode)and m.st_uid==m.st_gid==0 and stat.S_IMODE(m.st_mode)==0o600 and m.st_nlink==1 and m.st_size<32768,'ASSEMBLY_SHAPE');raw=p.read_bytes();need(hashlib.sha256(raw).hexdigest()==PIN,'ASSEMBLY_PIN');a={'__name__':'_frozen_observer','__file__':str(p)};exec(compile(raw,str(p),'exec'),a);failed_raw=a['read'](ROOT/'strict-native-v1-failed.json',65536);failed=json.loads(failed_raw);need(failed.get('schema')=='pow-audit30-strict-native-failed-v1'and failed.get('unit')==a['UNIT'],'FAILURE_SCOPE');before=a['live']();timer=a['timer_shape']();unit=a['state'](a['UNIT']);inv=failed['invocationID'];need(unit.get('MainPID','0')=='0'and(unit.get('LoadState')=='not-found'or unit.get('InvocationID')==inv),'OWNED_STRICT_STILL_RUNNING_OR_CHANGED');need(before==a['live'](),'LIVE_FIVE_DRIFT')
 result={'schema':'pow-audit30-strict-shadow-postfailure-read-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'strictFailureSHA256':hashlib.sha256(failed_raw).hexdigest(),'nativeErrorClass':failed.get('errorClass'),'cleanupErrors':failed.get('cleanupErrors'),'timerBefore':failed.get('timerBefore'),'timerAtFailure':failed.get('timerAfterFailure'),'timerAtObservation':timer,'timerRestoredAtFailure':failed.get('timerRestored'),'timerRestoredAtObservation':timer==failed.get('timerBefore'),'unit':{k:unit.get(k)for k in ['LoadState','ActiveState','SubState','MainPID','InvocationID','Result','User','Group','Restart','KillMode','RuntimeMaxUSec']},'ownedUnitStopped':True,'liveFiveUnchanged':True,'acceptedReceiptExists':os.path.lexists(LAUNCH/'accepted-receipt.json'),'productionMutation':False,'timerControl':False,'automaticRetry':False}
 if os.path.lexists(LAUNCH/'launcher-final.json'):
  r=a['read'](LAUNCH/'launcher-final.json',65536);j=json.loads(r);result['launcher']={'sha256':hashlib.sha256(r).hexdigest(),'ok':j.get('ok'),'errorClass':j.get('errorClass'),'durationSeconds':j.get('durationSeconds'),'childResult':j.get('childResult')}
 files=list(LAUNCH.glob('backup-window-*.restored.json'));need(len(files)<=1,'RESTORED_MULTIPLICITY')
 if files:
  r=a['read'](files[0],65536);j=json.loads(r);result['timerRestoreReceipt']={'sha256':hashlib.sha256(r).hexdigest(),'restored':j.get('restored')is True,'beforeEqualsAfter':j.get('before')==j.get('after')}
 if os.path.lexists(OUTPUT):
  helper=a['read'](a['TOOLS']/'private-verify.py',expected=a['PINS']['private-verify.py']);h={'__name__':'_frozen_private_read','__file__':str(a['TOOLS']/'private-verify.py')};exec(compile(helper,h['__file__'],'exec'),h);account=pwd.getpwnam('powadmin');r=h['read'](OUTPUT,account.pw_uid,limit=4*1024**2,mode=0o600,group=account.pw_gid);result['driverReceiptSHA256']=hashlib.sha256(r).hexdigest();result['driver']=driver_projection(json.loads(r))
 need(before==a['live']()and timer==a['timer_shape'](),'FINAL_OBSERVATION_DRIFT');print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
