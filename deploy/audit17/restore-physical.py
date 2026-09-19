#!/usr/bin/python3 -I
"""Isolated PG16 physical verification/PITR. Run only in a write-confined unit."""
import datetime,gzip,hashlib,json,os,pathlib,pwd,re,shutil,subprocess,sys,tarfile,time
BIN='/usr/lib/postgresql/16/bin/'
SOURCE=pathlib.Path('/data/proofofwork-postgres-backups/physical/16-main/2026-09-19T044045Z.backup')
MANIFEST='d8c37cd1ed5b61bbc058376a8d520cab84dde04da00be4f24a418c1c43e33198'
FLOOR=100*1024**3
MAXIMUM=80*1024**3

def checked_path(name):
 p=pathlib.PurePosixPath(name)
 if p.is_absolute() or '..' in p.parts or not p.parts: raise ValueError('unsafe archive path')
 return p

def run(args,**kw):
 return subprocess.run(args,check=True,text=True,**kw)

def extract(source,dest):
 seen=set()
 # pg_basebackup may emit concatenated gzip members, including an empty first member.
 # GzipFile handles these; tarfile's r|gz inflater can report an empty archive.
 with gzip.open(source,'rb') as compressed, tarfile.open(fileobj=compressed,mode='r|') as archive:
  for member in archive:
   p=checked_path(member.name)
   assert str(p) not in seen; seen.add(str(p))
   target=dest/p
   assert not target.is_symlink()
   assert 0 <= member.size <= MAXIMUM
   assert shutil.disk_usage(dest).free > FLOOR + member.size
   if member.isdir(): target.mkdir(mode=0o700,parents=True,exist_ok=True)
   elif member.isfile():
    target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with target.open('xb') as out, archive.extractfile(member) as inp: shutil.copyfileobj(inp,out,1024*1024)
    target.chmod(0o600)
   else: raise ValueError('links and special archive members forbidden: '+member.name)

def main():
 assert sys.flags.isolated and os.geteuid()==pwd.getpwnam('postgres').pw_uid and len(sys.argv)==2
 job=pathlib.Path(sys.argv[1]);assert re.fullmatch(r'/data/proofofwork-audit17-pitr-\d{8}T\d{6}Z',str(job))
 assert job.resolve()==job and job.stat().st_uid==os.geteuid() and job.stat().st_mode&0o777==0o700
 assert sorted(p.name for p in job.iterdir())==['plan.json']
 plan=json.loads((job/'plan.json').read_text());name=plan['targetName'];assert re.fullmatch(r'audit17_\d{8}T\d{6}Z',name)
 assert plan['manifestSha256']==MANIFEST
 # Linux unit mount namespace must make live database and tablespace paths inaccessible.
 for live in ('/var/lib/postgresql/16/main', '/data/proofofwork-postgres-tablespaces'):
  assert not os.access(live,os.R_OK|os.W_OK|os.X_OK), 'live data is accessible'
 assert not os.access('/etc',os.W_OK)
 assert shutil.disk_usage(job).free>FLOOR+MAXIMUM
 assert hashlib.sha256((SOURCE/'backup_manifest').read_bytes()).hexdigest()==MANIFEST
 cluster=job/'cluster'; wal=job/'wal'; socket=job/'socket';space=job/'tablespaces'/'486390'
 for p in (cluster,wal,socket,space): p.mkdir(mode=0o700,parents=True)
 (cluster/'pg_wal').mkdir(mode=0o700)
 extract(SOURCE/'pg_wal.tar.gz',cluster/'pg_wal')
 receipts=[]
 # Copy closed WAL only. A partial current segment is never accepted.
 first=int('BC',16)*256+int('C6',16);last=int(plan['targetWal'][8:16],16)*256+int(plan['targetWal'][16:],16)
 assert plan['targetWal'][:8]=='00000001' and first<=last<first+1000
 for number in range(first,last+1):
  filename=f'00000001{number//256:08X}{number%256:08X}'
  source=SOURCE.parent/'wal'/filename
  if not source.is_file(): source=source.with_suffix('.gz')
  if not source.is_file(): source=cluster/'pg_wal'/filename
  assert source.is_file() and not source.is_symlink(), filename
  before=source.stat();digest=hashlib.sha256();total=0
  opener=gzip.open if source.suffix=='.gz' else open
  with opener(source,'rb') as inp,(wal/filename).open('xb') as out:
   while block:=inp.read(1024*1024):
    out.write(block);digest.update(block);total+=len(block)
  after=source.stat();assert (before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns)
  assert total==16*1024*1024
  receipts.append({'name':filename,'bytes':total,'sha256':digest.hexdigest()})
 (job/'wal-receipt.json').write_text(json.dumps(receipts,indent=2)+'\n')
 print('closed WAL copied:',len(receipts),flush=True)
 for filename,dest in [('base.tar.gz',cluster),('486390.tar.gz',space)]:
  dest.mkdir(mode=0o700,parents=True,exist_ok=True);before=(SOURCE/filename).stat();extract(SOURCE/filename,dest);after=(SOURCE/filename).stat()
  assert (before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns)
  print('extracted',filename,flush=True)
 shutil.copyfile(SOURCE/'backup_manifest',cluster/'backup_manifest')
 (cluster/'pg_tblspc'/'486390').symlink_to(space)
 with (job/'verifybackup.log').open('w') as log: run([BIN+'pg_verifybackup','--exit-on-error','--wal-directory='+str(wal),str(cluster)],stdout=log,stderr=subprocess.STDOUT,timeout=1800)
 print('backup manifest, file checksums and required WAL verified',flush=True)
 # PostgreSQL may replay CREATE TABLESPACE with absolute historical paths.
 # Refuse tablespace DDL and additionally rely on unit write isolation.
 with (job/'tablespace-wal.log').open('w') as log:
  run([BIN+'pg_waldump','--path='+str(wal),'--start=BC/C601FAF8','--end='+plan['targetLsn'],'--rmgr=Tablespace'],stdout=log,stderr=subprocess.STDOUT,timeout=300)
 assert (job/'tablespace-wal.log').stat().st_size==0,'tablespace WAL requires separate review'
 for filename in ('tablespace_map','postgresql.auto.conf','postgresql.conf','pg_hba.conf','pg_ident.conf'):
  p=cluster/filename
  if p.exists(): shutil.copyfile(p,job/('original-'+filename))
 assert (cluster/'tablespace_map').read_text().strip()=='486390 /data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1'
 (cluster/'tablespace_map').write_text('486390 '+str(space)+'\n')
 (cluster/'postgresql.auto.conf').write_text('')
 (cluster/'pg_hba.conf').write_text('local all all trust\n')
 (cluster/'pg_ident.conf').write_text('')
 conf=f"""data_directory = '{cluster}'
hba_file = '{cluster}/pg_hba.conf'
ident_file = '{cluster}/pg_ident.conf'
listen_addresses = ''
port = 55433
unix_socket_directories = '{socket}'
unix_socket_permissions = 0700
ssl = off
shared_buffers = '128MB'
work_mem = '16MB'
max_connections = 100
max_worker_processes = 8
max_wal_senders = 10
max_prepared_transactions = 0
max_locks_per_transaction = 64
max_parallel_workers = 0
archive_mode = off
primary_conninfo = ''
primary_slot_name = ''
logging_collector = off
hot_standby = on
restore_command = 'cp {wal}/%f %p'
recovery_target_name = '{name}'
recovery_target_timeline = '1'
recovery_target_action = 'pause'
"""
 (cluster/'postgresql.conf').write_text(conf)
 assert not (cluster/'standby.signal').exists()
 (cluster/'recovery.signal').touch(exist_ok=False)
 env={'PATH':BIN+':/usr/bin:/bin','LANG':'C.UTF-8','PGHOST':str(socket),'PGPORT':'55433','PGUSER':'postgres','PGDATABASE':'proof_indexer'}
 started=False
 try:
  # Wait for PostgreSQL readiness before checking its PID; -W has a startup race.
  started=True
  with (job/'cluster-control.log').open('w') as log: run([BIN+'pg_ctl','-D',str(cluster),'-l',str(job/'postgres.log'),'-w','-t','300','start'],stdout=log,stderr=subprocess.STDOUT,timeout=310)
  started=True
  deadline=time.monotonic()+2400
  while time.monotonic()<deadline:
   assert shutil.disk_usage(job).free>FLOOR
   q=subprocess.run([BIN+'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',"SELECT pg_is_in_recovery() AND pg_is_wal_replay_paused();"],env=env,text=True,capture_output=True,timeout=15)
   if q.returncode==0 and q.stdout.strip()=='t':break
   assert subprocess.run([BIN+'pg_ctl','-D',str(cluster),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
   time.sleep(5)
  else: raise TimeoutError('recovery did not pause')
  sql="""SET statement_timeout='120s'; SELECT jsonb_build_object('inRecovery',pg_is_in_recovery(),'paused',pg_is_wal_replay_paused(),'replayLsn',pg_last_wal_replay_lsn(),'dataDirectory',current_setting('data_directory'),'listenAddresses',current_setting('listen_addresses'),'socket',current_setting('unix_socket_directories'),'tablespaces',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'path',pg_tablespace_location(oid))) FROM pg_tablespace),'transactions',(SELECT count(*) FROM proof_indexer.transactions),'events',(SELECT count(*) FROM proof_indexer.events),'invalidIndexes',(SELECT count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready));"""
  result=run([BIN+'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-c',sql],env=env,capture_output=True,timeout=150)
  evidence=json.loads(result.stdout);assert evidence['inRecovery'] and evidence['paused'] and evidence['listenAddresses']=='' and evidence['dataDirectory']==str(cluster) and evidence['socket']==str(socket)
  assert all(not t['path'] or t['path']==str(space) for t in evidence['tablespaces'])
  assert evidence['invalidIndexes']==0 and evidence['events']>26385
  lsn=lambda x: int(x.split('/')[0],16)*2**32+int(x.split('/')[1],16)
  assert lsn(evidence['replayLsn'])>=lsn(plan['targetLsn'])
  assert ('recovery stopping at restore point "'+name+'"') in (job/'postgres.log').read_text()
  (job/'recovery-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
 finally:
  if started and subprocess.run([BIN+'pg_ctl','-D',str(cluster),'status'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
   with (job/'cluster-control.log').open('a') as log:run([BIN+'pg_ctl','-D',str(cluster),'-m','fast','-w','-t','60','stop'],stdout=log,stderr=subprocess.STDOUT,timeout=70)
 print('PITR passed; isolated cluster stopped; evidence retained at',job,flush=True)
if __name__=='__main__':main()
