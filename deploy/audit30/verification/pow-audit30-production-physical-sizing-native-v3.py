#!/usr/bin/python3 -I
"""Single fixed readonly sizing unit; reuse exact reviewed per-unit ad03e5 unit primitives."""
import base64,datetime,hashlib,json,os,re,signal,stat,sys,time,types
from pathlib import Path
MANAGED_SHA='ad03e5d02e10018fb7c5dd3c118a7ac876331cad240832c52e4838a4bea0ff2a'
LEAF_SHA='92c54c1f689a1f7d9f80a40c3b42944c9ee007a03438d550d5049584c2070d5c'
IDENTITY_OBSERVATION_SHA='0d6b69eb45fd5f67fd4cda34ba4942fe54884ef20feeefb9a20d1c9b0d773c2a'
APPROVAL='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
RID='20261003T104000Z';UNIT='proofofwork-audit30-physical-sizing-'+RID+'.service';DIRECTORY=Path('/data/proofofwork-release-backups/audit30-physical-sizing-'+RID)
RO=('/var/lib/postgresql/16/main','/run/postgresql','-/data/proofofwork-postgres-tablespaces')
DENIED=('/etc/proofofwork-api','/data/bitcoin','/data/proofofwork-postgres-backups','/data/proofofwork-audit30-restore-20261002T234651Z','/data/proofofwork-audit30-inspect-20261003T005512Z','/data/proofofwork-audit30-inspect-20261003T014100Z')
class PhysicalSizingInterrupted(RuntimeError):pass
def need(v,s):
 if not v:raise ValueError(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_REQUEST_KEY');d[k]=v
 return d

def decode(raw):
 r=json.loads(raw,object_pairs_hook=pairs);keys={'schema','approvalSha256','managedSha256','managedBase64','leafSha256','leafBase64','unit','directory','expectedLive','expectedProtection','identityObservationSha256'}
 need(isinstance(r,dict)and set(r)==keys and r['schema']=='pow-audit30-production-physical-sizing-native-request-v3'and r['identityObservationSha256']==IDENTITY_OBSERVATION_SHA and r['approvalSha256']==APPROVAL and r['managedSha256']==MANAGED_SHA and r['leafSha256']==LEAF_SHA and r['unit']==UNIT and r['directory']==str(DIRECTORY),'FIXED_SIZING_REQUEST')
 managed=base64.b64decode(r['managedBase64'],validate=True);leaf=base64.b64decode(r['leafBase64'],validate=True);need(len(managed)==24954 and sha(managed)==MANAGED_SHA and len(leaf)<=16384 and sha(leaf)==LEAF_SHA,'BYTE_PINNED_FIXED_SOURCES')
 M=types.ModuleType('reviewed_managed_unit');M.__file__='/reviewed/pow-audit30-oct2-full-read-native-v2.py';exec(compile(managed,M.__file__,'exec'),M.__dict__)
 need(isinstance(r['expectedLive'],dict)and set(r['expectedLive'])==set(M.LIVE),'FRESH_CHOSEN_FIVE_REQUIRED')
 for v in r['expectedLive'].values():need(isinstance(v,dict)and set(v)=={'LoadState','ActiveState','SubState','MainPID','InvocationID'}and v['LoadState']=='loaded'and v['ActiveState']=='active'and v['SubState']=='running'and isinstance(v['MainPID'],str)and v['MainPID'].isdigit()and int(v['MainPID'])>0 and isinstance(v['InvocationID'],str)and re.fullmatch('[a-f0-9]{32}',v['InvocationID']),'FRESH_LIVE_SHAPE')
 p=r['expectedProtection'];need(isinstance(p,dict)and set(p)=={'files','mask','units'}and isinstance(p['files'],dict)and set(p['files'])==set(map(str,M.STATIC))and isinstance(p['units'],dict)and set(p['units'])==set(M.PROTECTED),'CLOSED_CURRENT_PROTECTION')
 for name,v in p['files'].items():need(isinstance(v,dict)and set(v)=={'metadata','sha256'}and isinstance(v['metadata'],dict)and set(v['metadata'])==set(M.LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in v['metadata'].values())and isinstance(v['sha256'],str)and re.fullmatch('[a-f0-9]{64}',v['sha256'])and(name not in M.FIXED_HASHES or v['sha256']==M.FIXED_HASHES[name]),'PROTECTION_FILE_SHAPE')
 need(isinstance(p['mask'],dict)and set(p['mask'])=={'metadata','target'}and p['mask']['target']=='/dev/null'and isinstance(p['mask']['metadata'],dict)and set(p['mask']['metadata'])==set(M.LOCK_EXPECTED)and all(type(n)is int and n>=0 for n in p['mask']['metadata'].values()),'MASK_SHAPE')
 for name,v in p['units'].items():need(isinstance(v,dict)and set(v)==set(M.PROTECTED_FIELDS_BY_UNIT[name])and all(isinstance(x,str)for x in v.values()),'EXACT_PER_UNIT_PROTECTION_SHAPE')
 M.UNIT=UNIT;M.DIRECTORY=DIRECTORY;M.OUT=DIRECTORY/'snapshot.json';M.ERR=DIRECTORY/'stderr.log';M.RO=RO;M.DENIED=DENIED;M.DEADLINE=time.monotonic()+420;M.OWNED=None;M.LAUNCHED=False
 M.PROPS=dict(M.PROPS,ReadOnlyPaths=' '.join(RO),InaccessiblePaths=' '.join(DENIED),StandardOutput='append:'+str(M.OUT),StandardError='append:'+str(M.ERR))
 M.ARGV=['/usr/bin/env','-i','PATH=/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL=C','LANG=C','TZ=UTC','/usr/bin/python3','-I','-B','-c',leaf.decode()]
 return r,M,leaf

def current_protection(M,expected):
 chosen=json.loads(json.dumps(expected));name='proofofwork-retention-protection.service';row=M.show(name,M.PROTECTED_FIELDS_BY_UNIT[name]);need(row['LoadState']=='loaded'and row['UnitFileState']==chosen['units'][name]['UnitFileState']=='static'and row['MainPID']=='0'and(row['ActiveState'],row['SubState'])in(('inactive','dead'),('failed','failed'))and(row['InvocationID']==''or re.fullmatch('[a-f0-9]{32}',row['InvocationID'])),'CURRENT_IDLE_STATIC_MONITOR');chosen['units'][name]=row;return M.protection(chosen)
def static_protection(value):return {'files':value['files'],'mask':value['mask'],'units':{name:row for name,row in value['units'].items()if name!='proofofwork-retention-protection.service'}}

def tool_fence(M,expected=None):
 rows={}
 for path in('/usr/lib/postgresql/16/bin/psql','/usr/bin/du'):
  data,meta=M.read_file(Path(path),8388608);need(meta['mode']==0o755,'ROOT_TOOL_MODE');rows[path]={'metadata':meta,'bytes':len(data),'sha256':sha(data)}
 need(expected is None or rows==expected,'READONLY_TOOL_DRIFT');return rows

def validate_result(v,leaf):
 L=types.ModuleType('fixed_sizing_definitions');L.__file__='/reviewed/physical-sizing-leaf.py';exec(compile(leaf,L.__file__,'exec'),L.__dict__)
 keys={'schema','status','startedAtUtc','atUtc','sqlSha256','catalogBefore','catalogAfter','filesystemBefore','filesystemAfter','duSizes','physicalRootsTotals','walIncludedInPgdataSameFilesystemTotal','walSeparateSampleQualification','activeTreeGrowthQualification','backendResourceQualification','pageIntegrityVerified','backupCreated','slotCreated','productionMutation'}
 need(isinstance(v,dict)and set(v)==keys and v['schema']=='pow-audit30-production-physical-sizing-snapshot-v1'and v['status']=='measured-readonly-snapshot'and v['sqlSha256']==sha(L.SQL.encode())and all(v[k]is False for k in('pageIntegrityVerified','backupCreated','slotCreated','productionMutation')),'CLOSED_READONLY_SIZING_RESULT')
 L.validate_catalog(v['catalogBefore']);L.validate_catalog(v['catalogAfter']);need(L.topology(v['catalogBefore'])==L.topology(v['catalogAfter'])and L.scope_identity(v['filesystemBefore'])==L.scope_identity(v['filesystemAfter']),'RESULT_TOPOLOGY')
 expected=[str(L.PGDATA)]+[r['path']for r in v['catalogBefore']['tablespaces']if r['path']];f=v['filesystemBefore'];need(f['roots']==expected and f['walPath']==str(L.PGDATA/'pg_wal')and type(f['walDifferentDevice'])is bool,'RESULT_EXACT_ROOTS')
 need(set(v['duSizes'])==set(v['physicalRootsTotals'])=={'allocatedBytes','apparentBytes'},'RESULT_SIZE_LABELS')
 for key,rows in v['duSizes'].items():
  need(set(rows)==set(expected+[f['walPath']])and all(type(n)is int and n>=0 for n in rows.values()),'RESULT_EXACT_DU_ROWS');total=sum(rows[p]for p in expected)+(rows[f['walPath']]if f['walDifferentDevice']else 0);need(type(v['physicalRootsTotals'][key])is int and v['physicalRootsTotals'][key]==total,'RESULT_TOTALS')
 need(v['walIncludedInPgdataSameFilesystemTotal']is(not f['walDifferentDevice'])and all(isinstance(v[k],str)and 0<len(v[k])<=1024 for k in('activeTreeGrowthQualification','backendResourceQualification','walSeparateSampleQualification')),'RESULT_QUALIFICATIONS')
 when=datetime.datetime.fromisoformat(v['atUtc']);need(when.tzinfo is not None and 0<=(datetime.datetime.now(datetime.timezone.utc)-when).total_seconds()<=420,'RESULT_FRESHNESS')

def main():
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and os.uname().nodename=='pow-bitcoin-01'and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'FIXED_ISOLATED_ROOT');raw=sys.stdin.buffer.read(65537);need(len(raw)<=65536 and sha(raw)==sys.argv[1],'TYPED_REQUEST_RAW_SHA');r,M,leaf=decode(raw)
 M.absent(M.show(UNIT,M.FIELDS));backup=M.quiet();before=M.live();need(before==r['expectedLive'],'CHOSEN_FIVE_CHANGED');protection=current_protection(M,r['expectedProtection']);tools=tool_fence(M);parent=DIRECTORY.parent;s=parent.lstat();need(parent.resolve(strict=True)==parent and stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and not s.st_mode&0o022 and not os.path.lexists(DIRECTORY),'NEW_ROOT_EVIDENCE');DIRECTORY.mkdir(mode=0o700);fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 M.durable(DIRECTORY/'intent.json',{'schema':r['schema'],'requestSha256':sha(raw),'managedSha256':MANAGED_SHA,'leafSha256':LEAF_SHA,'identityObservationSha256':IDENTITY_OBSERVATION_SHA,'unit':UNIT,'argvSha256':sha(encoded(M.ARGV)),'beforeFive':before,'backupBefore':backup,'protectionBefore':protection,'toolsBefore':tools,'productionMutation':False});stamps={}
 for p in(M.OUT,M.ERR):fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.fsync(fd);os.close(fd);stamps[p.name]=M.metadata(p.lstat())
 old={s:signal.getsignal(s)for s in(signal.SIGALRM,signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
 def interrupted(*_):raise PhysicalSizingInterrupted('ROOT420_DEADLINE_OR_SIGNAL')
 for s in old:signal.signal(s,interrupted)
 signal.setitimer(signal.ITIMER_REAL,420);failure=None;cleanup=None;result=None;observed=[]
 try:
  argv=['/usr/bin/systemd-run','--quiet','--no-block','--unit='+UNIT,*['--property='+k+'='+v for k,v in M.PROPS.items()],'--',*M.ARGV];M.LAUNCHED=True;need(M.command(argv)==b'','LAUNCH_OUTPUT')
  while True:
   v=M.show(UNIT,M.FIELDS);M.identity(v,M.OWNED);typed=M.typed();M.OWNED=v['InvocationID'];M.validate_resources(v);fragment=M.fragment(v);observed.append({'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'properties':v,'typed':typed,'fragment':fragment});need(len(observed)<=500 and M.OUT.stat().st_size<=1048576 and M.ERR.stat().st_size<=65536,'CAPTURE_OR_SNAPSHOT_BOUND')
   if v['MainPID']=='0'and v['ActiveState']=='active'and v['SubState']=='exited':need(v['Result']=='success'and v['ExecMainStatus']=='0','SIZING_LEAF_FAILED');break
   time.sleep(1)
  data,dm=M.read_file(M.OUT,1048576,stamps[M.OUT.name]);err,em=M.read_file(M.ERR,65536,stamps[M.ERR.name]);need(not err,'SIZING_STDERR');value=M.parse(data);validate_result(value,leaf);after=M.live();protectionAfter=current_protection(M,r['expectedProtection']);need(after==before and M.quiet()==backup and static_protection(protectionAfter)==static_protection(protection),'FIVE_BACKUP_STATIC_PROTECTION_CHANGED');tool_fence(M,tools);result={'snapshot':value,'snapshotBinding':{'path':str(M.OUT),'bytes':len(data),'sha256':sha(data),'metadata':dm},'stderrBinding':{'path':str(M.ERR),'bytes':len(err),'sha256':sha(err),'metadata':em},'beforeFive':before,'afterFive':after,'backupBefore':backup,'protectionAfter':protectionAfter,'protectionBeforeAfterEqual':protectionAfter==protection,'staticProtectionBeforeAfterEqual':True,'monitorOperationalTupleUnchanged':protectionAfter['units']['proofofwork-retention-protection.service']==protection['units']['proofofwork-retention-protection.service'],'toolsBeforeAfterEqual':tools,'backendResourceQualification':value['backendResourceQualification']}
 except BaseException as e:failure={'errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode())}
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
  try:
   if M.LAUNCHED:cleanup=M.owned_stop()
  except BaseException as e:cleanup={'verified':False,'errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode())}
  outcome={'schema':'pow-audit30-production-physical-sizing-native-outcome-v3','status':'passed'if failure is None and cleanup and cleanup['verified']else'failed','requestSha256':sha(raw),'managedSha256':MANAGED_SHA,'leafSha256':LEAF_SHA,'identityObservationSha256':IDENTITY_OBSERVATION_SHA,'unit':UNIT,'failure':failure,'cleanup':cleanup,'resourceSnapshots':observed,'result':result,'productionMutation':False,'recoveryActivation':False,'automaticRetry':False};binding=M.durable(DIRECTORY/('completed.json'if outcome['status']=='passed'else'failed.json'),outcome)
  for s,h in old.items():signal.signal(s,h)
 need(outcome['status']=='passed','SIZING_FAILED_WITH_DURABLE_EVIDENCE');return {'schema':outcome['schema'],'status':'passed','outcomeBinding':binding,'unitStopVerified':True,'result':result,'productionMutation':False,'recoveryActivation':False,'automaticRetry':False}
if __name__=='__main__':
 try:v=main()
 except BaseException as e:print(json.dumps({'schema':'pow-audit30-production-physical-sizing-native-refusal-v3','errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode()),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
 print(json.dumps(v,sort_keys=True,separators=(',',':')))
