#!/usr/bin/python3 -I
"""Fixed active production PG16 size snapshot only; no page/backup certificate."""
import datetime,hashlib,json,os,re,signal,stat,subprocess,sys,time
from pathlib import Path
IDENTITY_OBSERVATION_SHA='0d6b69eb45fd5f67fd4cda34ba4942fe54884ef20feeefb9a20d1c9b0d773c2a'
PGDATA=Path('/var/lib/postgresql/16/main')
TABLESPACE_PARENT=Path('/data/proofofwork-postgres-tablespaces')
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','LANG':'C','TZ':'UTC','PGCONNECT_TIMEOUT':'5','PGAPPNAME':'audit30-physical-size-readonly','PGOPTIONS':'-c default_transaction_read_only=on'}
SQL="""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='2s';
SET LOCAL idle_in_transaction_session_timeout='20s'; SET LOCAL work_mem='8MB'; SET LOCAL temp_file_limit='32MB';
SELECT jsonb_build_object(
 'readOnly',current_setting('transaction_read_only'),
 'dataDirectory',current_setting('data_directory'),'serverVersionNum',current_setting('server_version_num'),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'timeline',(SELECT timeline_id FROM pg_control_checkpoint()),
 'databaseCount',(SELECT count(*) FROM pg_database),
 'databases',CASE WHEN (SELECT count(*) FROM pg_database)<=128 THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('oid',oid::bigint,'name',datname,'bytes',pg_database_size(oid)) ORDER BY oid),'[]'::jsonb) FROM pg_database) ELSE '[]'::jsonb END,
 'tablespaceCount',(SELECT count(*) FROM pg_tablespace),
 'tablespaces',CASE WHEN (SELECT count(*) FROM pg_tablespace)<=34 THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('oid',oid::bigint,'name',spcname,'path',pg_tablespace_location(oid),'bytes',pg_tablespace_size(oid)) ORDER BY oid),'[]'::jsonb) FROM pg_tablespace) ELSE '[]'::jsonb END);
COMMIT;"""
DEADLINE=0
class SizingInterrupted(RuntimeError):pass
def need(v,s):
 if not v:raise ValueError(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_JSON');d[k]=v
 return d
def metadata(path):
 s=path.lstat();return dict(device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
def command(argv,cap=1048576):
 need(time.monotonic()<DEADLINE,'LEAF_DEADLINE');r=subprocess.run(argv,env=ENV,stdin=subprocess.DEVNULL,capture_output=True,cwd='/',timeout=min(20,max(.01,DEADLINE-time.monotonic())))
 need(r.returncode==0 and not r.stderr and len(r.stdout)<=cap,'READONLY_COMMAND_REFUSED');return r.stdout

def catalog():
 raw=command(['/usr/lib/postgresql/16/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h','/run/postgresql','-p','5432','-U','postgres','-d','postgres','-c',SQL]);v=json.loads(raw,object_pairs_hook=pairs);validate_catalog(v);return v

def validate_catalog(v):
 keys={'readOnly','dataDirectory','serverVersionNum','systemIdentifier','timeline','databaseCount','databases','tablespaceCount','tablespaces'}
 need(isinstance(v,dict)and set(v)==keys and v['readOnly']=='on'and v['dataDirectory']==str(PGDATA)and isinstance(v['serverVersionNum'],str)and re.fullmatch('16[0-9]{4}',v['serverVersionNum'])and v['serverVersionNum']=='160015'and v['systemIdentifier']=='7652445986754609384'and type(v['timeline'])is int and v['timeline']==1,'FIXED_LIVE_PG16_IDENTITY')
 for count,key,limit in(('databaseCount','databases',128),('tablespaceCount','tablespaces',34)):
  need(type(v[count])is int and 1<=v[count]<=limit and isinstance(v[key],list)and len(v[key])==v[count],'CATALOG_POPULATION_BOUND')
  need([r.get('oid')for r in v[key]]==sorted(set(r.get('oid')for r in v[key])),'CATALOG_ORDER_OR_DUPLICATE')
  for r in v[key]:
   need(set(r)==({'oid','name','bytes'}if key=='databases'else{'oid','name','bytes','path'})and type(r['oid'])is int and r['oid']>0 and isinstance(r['name'],str)and 0<len(r['name'].encode())<=128 and type(r['bytes'])is int and r['bytes']>=0,'CATALOG_ROW')
   if key=='tablespaces':
    if r['oid']in(1663,1664):need(r['path']==''and r['name']==('pg_default'if r['oid']==1663 else'pg_global'),'BUILTIN_TABLESPACE')
    else:need(isinstance(r['path'],str)and re.fullmatch(re.escape(str(TABLESPACE_PARENT))+'/[A-Za-z0-9_-]+',r['path']),'EXTERNAL_TABLESPACE_LOCATION')
 need({r['oid']for r in v['tablespaces']if r['path']==''}=={1663,1664},'ALL_BUILTIN_TABLESPACES')

def topology(v):
 return {k:v[k]for k in('readOnly','dataDirectory','serverVersionNum','systemIdentifier','timeline','databaseCount','tablespaceCount')}|{'databases':[{k:r[k]for k in('oid','name')}for r in v['databases']],'tablespaces':[{k:r[k]for k in('oid','name','path')}for r in v['tablespaces']]}

def directory(p):
 s=p.lstat();need(p.is_absolute()and p.resolve(strict=True)==p and stat.S_ISDIR(s.st_mode)and s.st_uid==108 and s.st_gid==112 and not s.st_mode&0o022 and not os.listxattr(p,follow_symlinks=False),'CANONICAL_PG_DIRECTORY');need(os.statvfs(p).f_flag&os.ST_RDONLY,'ACTUAL_READONLY_MOUNT');return metadata(p)

def filesystem_scope(v):
 root=directory(PGDATA);wal=PGDATA/'pg_wal';wm=directory(wal);links=PGDATA/'pg_tblspc';lm=directory(links)
 spaces=[r for r in v['tablespaces']if r['path']];need(len(spaces)<=32 and len({r['path']for r in spaces})==len(spaces),'EXTERNAL_SCOPE_UNIQUE');need(set(os.listdir(links))=={str(r['oid'])for r in spaces},'CATALOG_TBLSPC_MEMBERSHIP')
 roots=[PGDATA];records={str(PGDATA):root,str(wal):wm,str(links):lm};symlinks={}
 for r in spaces:
  target=Path(r['path']);link=links/str(r['oid']);s=link.lstat();need(stat.S_ISLNK(s.st_mode)and s.st_uid==108 and s.st_gid==112 and os.readlink(link)==str(target)and link.resolve(strict=True)==target and not os.listxattr(link,follow_symlinks=False),'EXACT_CATALOG_TABLESPACE_SYMLINK');records[str(target)]=directory(target);symlinks[str(link)]={'metadata':metadata(link),'target':str(target)};roots.append(target)
 allroots=roots+[wal];need(len({(m['device'],m['inode'])for m in records.values()})==len(records),'MEASUREMENT_ROOT_ALIAS');need(all(not a.is_relative_to(b)and not b.is_relative_to(a)for i,a in enumerate(roots)for b in roots[i+1:]),'MEASUREMENT_ROOT_OVERLAP')
 raw=Path('/proc/self/mountinfo').read_bytes();need(len(raw)<=1048576,'MOUNTINFO_BOUND');mounts=[]
 for line in raw.splitlines():
  columns=line.split();need(len(columns)>=10 and b'-'in columns,'MOUNTINFO_SHAPE');target=columns[4].decode();target=re.sub(r'\\([0-7]{3})',lambda m:chr(int(m[1],8)),target);p=Path(target)
  if any(p!=x and p.is_relative_to(x)for x in roots):need(p==wal,'UNMEASURED_NESTED_MOUNT')
  if p==wal:need(wm['device']!=root['device'],'WAL_SAME_FILESYSTEM_BIND_ALIAS')
  if p in allroots:mounts.append({'target':target,'mountId':columns[0].decode(),'device':columns[2].decode(),'options':columns[5].decode()})
 return {'roots':[str(x)for x in roots],'walPath':str(wal),'walDifferentDevice':wm['device']!=root['device'],'directoryMetadata':records,'tablespaceSymlinks':symlinks,'selectedMounts':mounts,'mountinfoSha256':sha(raw)}

def scope_identity(v):
 return {'roots':v['roots'],'walPath':v['walPath'],'walDifferentDevice':v['walDifferentDevice'],'directories':{p:{k:m[k]for k in('device','inode','uid','gid','mode')}for p,m in v['directoryMetadata'].items()},'tablespaceSymlinks':v['tablespaceSymlinks'],'selectedMounts':v['selectedMounts']}

def parse_du(raw,roots):
 pieces=raw.split(b'\x00');need(pieces[-1]==b''and len(pieces)==len(roots)+1,'DU_COMPLETE_NULL_ROWS');rows={}
 for row in pieces[:-1]:
  n,sep,p=row.partition(b'\t');need(sep and re.fullmatch(rb'[0-9]+',n),'DU_SIZE_GRAMMAR');path=p.decode();need(path in roots and path not in rows,'DU_EXACT_ROOT');rows[path]=int(n)
 need(set(rows)==set(roots),'DU_MISSING_ROOT');return rows

def measured(scope):
 roots=scope['roots'];wal=[scope['walPath']];result={}
 for apparent,label in((False,'allocatedBytes'),(True,'apparentBytes')):
  args=['/usr/bin/du','-x','-s','-B1','--null']+(['--apparent-size']if apparent else[])+['--']
  result[label]=parse_du(command(args+roots,65536),roots)|parse_du(command(args+wal,65536),wal)
 return result

def main():
 global DEADLINE
 need(os.geteuid()==108 and os.getegid()==112 and sys.flags.isolated and len(sys.argv)==1,'FIXED_NATIVE_PG_ROLE');DEADLINE=time.monotonic()+150
 def interrupted(*_):raise SizingInterrupted('LEAF_DEADLINE_OR_SIGNAL')
 old={s:signal.getsignal(s)for s in(signal.SIGALRM,signal.SIGTERM,signal.SIGINT)}
 for s in old:signal.signal(s,interrupted)
 signal.setitimer(signal.ITIMER_REAL,150)
 try:
  started=datetime.datetime.now(datetime.timezone.utc).isoformat();before=catalog();scopeBefore=filesystem_scope(before);sizes=measured(scopeBefore);after=catalog();scopeAfter=filesystem_scope(after);need(topology(after)==topology(before)and scope_identity(scopeAfter)==scope_identity(scopeBefore),'CATALOG_OR_ROOT_TOPOLOGY_DRIFT')
  totals={}
  for label,rows in sizes.items():
   total=sum(rows[p]for p in scopeBefore['roots'])+(rows[scopeBefore['walPath']]if scopeBefore['walDifferentDevice']else 0);totals[label]=total
  return {'schema':'pow-audit30-production-physical-sizing-snapshot-v1','status':'measured-readonly-snapshot','startedAtUtc':started,'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sqlSha256':sha(SQL.encode()),'catalogBefore':before,'catalogAfter':after,'filesystemBefore':scopeBefore,'filesystemAfter':scopeAfter,'duSizes':sizes,'physicalRootsTotals':totals,'walIncludedInPgdataSameFilesystemTotal':not scopeBefore['walDifferentDevice'],'walSeparateSampleQualification':'WAL sample runs separately from PGDATA; do not subtract it as an exact coherent base size.','activeTreeGrowthQualification':'Catalog totals and du snapshots observe an active tree at different times. Files may grow or disappear; command errors refuse, but successful observations are not an atomic filesystem snapshot or guaranteed future base/WAL capacity.','backendResourceQualification':'Client unit CPU/memory/IO caps do not constrain existing production PostgreSQL backends; fixed READ ONLY catalog SQL is bounded by15s statement/2s lock and8MB work_mem/32MB temp.','pageIntegrityVerified':False,'backupCreated':False,'slotCreated':False,'productionMutation':False}
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:v=main()
 except BaseException as e:print(json.dumps({'schema':'pow-audit30-production-physical-sizing-refusal-v1','errorClass':type(e).__name__,'reasonSha256':sha(str(e).encode()),'productionMutation':False}),file=sys.stderr);raise SystemExit(1)
 print(json.dumps(v,sort_keys=True,separators=(',',':')))
