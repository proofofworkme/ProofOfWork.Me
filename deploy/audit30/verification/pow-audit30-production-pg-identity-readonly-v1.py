#!/usr/bin/python3 -I
"""One fixed production PG identity read; no unit, size scan, or control operation."""
import base64,datetime,hashlib,json,os,re,resource,signal,subprocess,sys,time,types
MANAGED_SHA='ad03e5d02e10018fb7c5dd3c118a7ac876331cad240832c52e4838a4bea0ff2a'
OLD_FIVE={'bitcoind.service':('1324302','64e1fa7be2e2442d8c7f5763f60b85fb'),'electrs.service':('1324320','72418b1c7ab245e4a37685ed868a1084'),'postgresql@16-main.service':('1537429','e0bf545f0ad944e89fe1005577e61b9c'),'proofofwork-api.service':('2103747','208f8bcbecc54afbb7166754f12065c2'),'proofofwork-indexer-worker.service':('2103760','33b3ee25490749db89e0d55fd29d0afb')}
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','LANG':'C','TZ':'UTC'}
SQL="""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='10s';
SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'dataDirectory',current_setting('data_directory'),'serverVersionNum',current_setting('server_version_num'),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'timeline',(SELECT timeline_id::bigint FROM pg_control_checkpoint()),'backendPid',pg_backend_pid()::bigint,'port',current_setting('port'),'sessionUser',session_user,'currentUser',current_user,'socket',current_setting('unix_socket_directories'),'serverAddress',inet_server_addr()::text,'database',current_database());
COMMIT;"""
SQL_ARGV=['/usr/bin/sudo','-n','-u','postgres','-g','postgres','--','/usr/bin/env','-i','PATH=/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL=C','LANG=C','TZ=UTC','PGCONNECT_TIMEOUT=5','PGAPPNAME=audit30-production-identity-readonly','PGOPTIONS=-c default_transaction_read_only=on','/usr/lib/postgresql/16/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','/run/postgresql','-p','5432','-U','postgres','-d','postgres','-c',SQL]
DEADLINE=0;M=None;LAST_CLIENT_REAP=False
class IdentityObservationInterrupted(RuntimeError):pass
def need(v,s):
 if not v:raise ValueError(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_TYPED_JSON');d[k]=v
 return d
def decode(raw):
 r=json.loads(raw,object_pairs_hook=pairs);need(isinstance(r,dict)and set(r)=={'schema','managedSha256','managedBase64','expectedLive','expectedProtection'}and r['schema']=='pow-audit30-production-pg-identity-readonly-request-v1'and r['managedSha256']==MANAGED_SHA,'EXACT_READONLY_IDENTITY_REQUEST');b=base64.b64decode(r['managedBase64'],validate=True);need(len(b)==24954 and sha(b)==MANAGED_SHA,'EXACT_INERT_MANAGED_DEFINITIONS');m=types.ModuleType('fixed_managed_definitions');m.__file__='/reviewed/ad03-inert.py';exec(compile(b,m.__file__,'exec'),m.__dict__)
 live=r['expectedLive'];need(isinstance(live,dict)and set(live)==set(OLD_FIVE)==set(m.LIVE),'FRESH_ORIGINAL_FIVE_REQUIRED')
 for name,v in live.items():need(isinstance(v,dict)and set(v)=={'LoadState','ActiveState','SubState','MainPID','InvocationID'}and v['LoadState']=='loaded'and v['ActiveState']=='active'and v['SubState']=='running'and(v['MainPID'],v['InvocationID'])==OLD_FIVE[name],'EXACT_ORIGINAL_FIVE')
 p=r['expectedProtection'];need(isinstance(p,dict)and set(p)=={'files','mask','units'}and isinstance(p['files'],dict)and set(p['files'])==set(map(str,m.STATIC))and isinstance(p['units'],dict)and set(p['units'])==set(m.PROTECTED),'FRESH_CLOSED_PROTECTION_REQUIRED')
 for name,v in p['files'].items():need(isinstance(v,dict)and set(v)=={'metadata','sha256'}and isinstance(v['metadata'],dict)and set(v['metadata'])==set(m.LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in v['metadata'].values())and isinstance(v['sha256'],str)and re.fullmatch('[a-f0-9]{64}',v['sha256'])and(name not in m.FIXED_HASHES or v['sha256']==m.FIXED_HASHES[name]),'CLOSED_STATIC_FILE_AUTHORITY')
 need(isinstance(p['mask'],dict)and set(p['mask'])=={'metadata','target'}and p['mask']['target']=='/dev/null'and isinstance(p['mask']['metadata'],dict)and set(p['mask']['metadata'])==set(m.LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in p['mask']['metadata'].values()),'CLOSED_PRUNE_MASK')
 for name,v in p['units'].items():need(isinstance(v,dict)and set(v)==set(m.PROTECTED_FIELDS_BY_UNIT[name])and all(isinstance(x,str)for x in v.values()),'EXACT_PER_UNIT_FIELDS')
 return r,m
def captured(argv,seconds):
 global LAST_CLIENT_REAP
 LAST_CLIENT_REAP=False;need(time.monotonic()<DEADLINE,'ROOT60_DEADLINE');p=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env=ENV,cwd='/');old={}
 try:
  out,err=p.communicate(timeout=min(seconds,max(.01,DEADLINE-time.monotonic())));need(len(out)<=131072 and len(err)<=65536,'OWNED_CLIENT_STREAM_BOUND');return p.returncode,out,err
 finally:
  for s in(signal.SIGALRM,signal.SIGINT,signal.SIGTERM,signal.SIGHUP):old[s]=signal.signal(s,signal.SIG_IGN)
  try:
   if p.poll()is None:
    try:os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:p.wait(timeout=2)
    except subprocess.TimeoutExpired:
     try:os.killpg(p.pid,signal.SIGKILL)
     except ProcessLookupError:pass
   p.wait(timeout=3);LAST_CLIENT_REAP=True
  finally:
   p.stdout.close();p.stderr.close()
   for s,h in old.items():signal.signal(s,h)
def command(argv,cleanup=False):
 profiles={name:('LoadState','ActiveState','SubState','MainPID','InvocationID')for name in M.LIVE};profiles|=M.PROTECTED_FIELDS_BY_UNIT;profiles['proofofwork-postgres-logical-backup.service']=('LoadState','ActiveState','SubState','MainPID','InvocationID');profiles['proofofwork-postgres-logical-backup.timer']=('LoadState','ActiveState','SubState','UnitFileState','InvocationID','NextElapseUSecRealtime');need(not cleanup and len(argv)>=5 and argv[:2]==['/usr/bin/systemctl','show']and argv[3]=='--no-pager'and argv[2]in profiles and argv[4:]==['--property='+k for k in profiles[argv[2]]],'ONLY_FIXED_METADATA_SHOW');code,out,err=captured(argv,10);need(code==0 and not err,'FIXED_METADATA_READ_REFUSED');return out
def protection(r):
 expected=json.loads(json.dumps(r['expectedProtection']));name='proofofwork-retention-protection.service';row=M.show(name,M.PROTECTED_FIELDS_BY_UNIT[name]);need(row['LoadState']=='loaded'and row['UnitFileState']==expected['units'][name]['UnitFileState']=='static'and row['MainPID']=='0'and(row['ActiveState'],row['SubState'])in(('inactive','dead'),('failed','failed'))and(row['InvocationID']==''or re.fullmatch('[a-f0-9]{32}',row['InvocationID'])),'CURRENT_IDLE_STATIC_MONITOR');expected['units'][name]=row;return M.protection(expected)
def static(v):return {'files':v['files'],'mask':v['mask'],'units':{k:r for k,r in v['units'].items()if k!='proofofwork-retention-protection.service'}}
def identity(raw):
 v=json.loads(raw,object_pairs_hook=pairs);keys={'readOnly','dataDirectory','serverVersionNum','systemIdentifier','timeline','backendPid','port','sessionUser','currentUser','socket','serverAddress','database'};need(isinstance(v,dict)and set(v)==keys,'CLOSED_PUBLIC_IDENTITY_FIELDS');need(v['readOnly']=='on'and v['dataDirectory']=='/var/lib/postgresql/16/main'and isinstance(v['serverVersionNum'],str)and re.fullmatch('16[0-9]{4}',v['serverVersionNum'])and isinstance(v['systemIdentifier'],str)and re.fullmatch('[1-9][0-9]{0,19}',v['systemIdentifier'])and int(v['systemIdentifier'])<2**64 and type(v['timeline'])is int and 1<=v['timeline']<=0xffffffff and type(v['backendPid'])is int and 1<=v['backendPid']<=0x7fffffff and v['port']=='5432'and v['sessionUser']==v['currentUser']=='postgres'and v['socket']=='/var/run/postgresql'and v['serverAddress']is None and v['database']=='postgres','FIXED_PRODUCTION_LOCAL_READONLY_IDENTITY');return v
def observe(r):
 before=M.live();need(before==r['expectedLive'],'ORIGINAL_FIVE_CHANGED');window=M.quiet();prot=protection(r);sql={'argvSha256':sha(json.dumps(SQL_ARGV,sort_keys=True,separators=(',',':')).encode()),'sqlSha256':sha(SQL.encode()),'clientWholeSeconds':20,'serverStatementSeconds':5,'serverLockSeconds':2,'serverIdleSeconds':10,'identityAccepted':False};value=None
 try:
  code,out,err=captured(SQL_ARGV,20);sql|={'exitCode':code,'stdoutBytes':len(out),'stdoutSha256':sha(out),'stderrBytes':len(err),'stderrSha256':sha(err),'ownedClientReaped':True};need(code==0 and not err and len(out)<=8192,'FIXED_IDENTITY_SQL_REFUSED');value=identity(out);sql['identityAccepted']=True
 except IdentityObservationInterrupted:raise
 except Exception as e:sql['refusal']={'errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode())};sql['ownedClientReaped']=LAST_CLIENT_REAP
 after=M.live();window2=M.quiet();prot2=protection(r);need(after==before and window2==window and static(prot2)==static(prot),'FIVE_WINDOW_STATIC_PROTECTION_DRIFT');return {'schema':'pow-audit30-production-pg-identity-readonly-observation-v1','status':'observed-readonly-identity'if sql['identityAccepted']else'observed-readonly-refusal','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'managedSha256':MANAGED_SHA,'productionIdentity':value,'identityCommand':sql,'expectedLive':after,'quietWindow':window2,'expectedProtection':prot2,'originalFiveBeforeAfterEqual':True,'staticProtectionBeforeAfterEqual':True,'monitorOperationalTupleUnchanged':prot2['units']['proofofwork-retention-protection.service']==prot['units']['proofofwork-retention-protection.service'],'rawStderrExported':False,'unitCreationOrControlPerformed':False,'databaseOrFilesystemSizeMeasured':False,'productionMutation':False,'automaticRetry':False,'retirementAuthority':False,'qualification':'One public production identity at a new RR READ ONLY statement, under unchanged five/static protection endpoints. System identifier is observed, not guessed or a size/recovery certificate. Client resource limits do not constrain the PostgreSQL backend; statement/lock/idle limits do.'}
def main():
 global DEADLINE,M
 need(sys.flags.isolated and sys.dont_write_bytecode and os.geteuid()==os.getegid()==0 and os.uname().nodename=='pow-bitcoin-01'and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'FIXED_ISOLATED_ROOT_IDENTITY');DEADLINE=time.monotonic()+60;resource.setrlimit(resource.RLIMIT_AS,(128*1024**2,128*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(30,30))
 def interrupted(*_):raise IdentityObservationInterrupted('ROOT60_SIGNAL_OR_DEADLINE')
 old={s:signal.signal(s,interrupted)for s in(signal.SIGALRM,signal.SIGINT,signal.SIGTERM,signal.SIGHUP)};signal.setitimer(signal.ITIMER_REAL,60)
 try:
  raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536 and sha(raw)==sys.argv[1],'EXACT_TYPED_IDENTITY_REQUEST');r,M=decode(raw);M.command=command;M.DEADLINE=DEADLINE;v=observe(r);v['requestSha256']=sha(raw);out=json.dumps(v,sort_keys=True,separators=(',',':'));need(time.monotonic()<DEADLINE and len(out.encode())<=65536,'RETURN_DEADLINE_OR_PUBLIC64K');print(out)
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps({'schema':'pow-audit30-production-pg-identity-readonly-refusal-v1','errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode()),'productionMutation':False,'unitCreationOrControlPerformed':False}),file=sys.stderr);raise SystemExit(1)
