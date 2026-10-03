#!/usr/bin/env python3
"""Bounded read-only admission evidence for excluding old mail targets from normal worker startup."""
import datetime,hashlib,json,os,pathlib,re,stat,subprocess,sys
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','TZ':'UTC'}
CLI='/usr/local/bin/bitcoin-cli';MAX_TARGET_HEIGHT=962933
FORBIDDEN=['POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT','POW_INDEX_BACKFILL_CANONICAL_REBUILD','POW_INDEX_REPAIR_CANONICAL_MAIL_PROJECTION','POW_INDEX_REPAIR_CANONICAL_TXIDS','POW_INDEX_REPAIR_EVENT_RELATIONS','POW_INDEX_REPAIR_ID_TXIDS','POW_INDEX_REPAIR_INCB_ISSUANCE_TXIDS']
WORK='d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8'
SQL=r"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH checkpoint AS (
 SELECT indexed_through_block,lower(payload->>'indexedThroughBlockHash') AS checkpoint_hash
 FROM proof_indexer.ledger_snapshots WHERE network='livenet'
 AND indexed_through_block IS NOT NULL AND NOT (source_hashes ? 'canonicalSummary')
 AND source_hashes ? 'blockScan' AND payload->>'source'='proof-indexer-block-scan'
 AND consistency->>'status' IN ('block-scan-current','block-scan-partial')
 AND payload->>'indexedThroughBlockHash' ~* '^[0-9a-f]{64}$'
 AND source_hashes->>'blockScan' ~* '^[0-9a-f]{64}$'
 AND lower(source_hashes->>'blockScan')=lower(payload->>'indexedThroughBlockHash')
 ORDER BY indexed_through_block DESC,generated_at DESC LIMIT 1),
 worker AS (SELECT value FROM proof_indexer.meta WHERE key='worker:lastRun'),
 rebuild AS (SELECT value FROM proof_indexer.meta WHERE key='canonical:rebuild'),
 definition AS (SELECT metadata,max_supply::text,mint_amount::text FROM proof_indexer.credit_definitions WHERE network='livenet' AND token_id='d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8')
SELECT jsonb_build_object('checkpoint', (SELECT to_jsonb(checkpoint) FROM checkpoint),
 'worker', (SELECT jsonb_build_object('state',value->>'state','network',value->>'network','backfillSources',value->>'backfillSources','workPrecisionEra',value#>>'{workPrecision,era}',
 'activePwtRangeReplay',jsonb_path_exists(value,'$.**.activePwtRangeReplay ? (@ == true)'),
 'backfillPhases', CASE WHEN jsonb_typeof(value->'backfillPhases')='array' THEN
   (SELECT jsonb_agg(jsonb_build_object('kind',phase->>'kind','sources',phase->'sources') ORDER BY ordinal)
    FROM jsonb_array_elements(value->'backfillPhases') WITH ORDINALITY p(phase,ordinal)) ELSE NULL END,
 'startedAt',value->>'startedAt','finishedAt',value->>'finishedAt') FROM worker),
 'rebuild', (SELECT jsonb_build_object('status',value->>'status','active',value->'active','complete',value->'complete','mode',value->>'mode','model',value->>'model','rangeReplayFromHeight',value->'rangeReplayFromHeight','network',value->>'network',
 'completedAt',value->>'completedAt',
 'verificationObjectPresent',jsonb_typeof(value->'incbRangeReplayVerification')='object',
 'recursiveActivePwtRangeReplay',jsonb_path_exists(value,'$.**.activePwtRangeReplay ? (@ == true)'),
 'activePwtRangeReplay',value->>'mode'='pwt-range-replay' AND value->>'status'='active'
 AND value->'active'='true'::jsonb AND value->'complete'='false'::jsonb
 AND (value->>'completedAt') IS NULL AND value->'incbRangeReplayVerification' IS NULL)FROM rebuild),
 'workDefinition',(SELECT jsonb_build_object('amountStorageModel',metadata->>'amountStorageModel','precisionModel',metadata->>'precisionModel','maxSupply',max_supply,'mintAmount',mint_amount)FROM definition),
 'snapshot',pg_current_snapshot()::text,'transactionReadOnly',current_setting('transaction_read_only'));
ROLLBACK;
"""
def need(v,m):
 if not v:raise ValueError(m)
def state(unit):
 r=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,ActiveState,SubState,MainPID,InvocationID'],env=ENV,capture_output=True,timeout=10);need(r.returncode==0 and not r.stderr and len(r.stdout)<65536,'SERVICE_READ_FAILED');return dict(x.split('=',1)for x in r.stdout.decode().splitlines()if '='in x)
def stable_read(path,cap):
 p=pathlib.Path(path);m=p.lstat();need(p.resolve()==p and stat.S_ISREG(m.st_mode)and m.st_nlink==1 and m.st_size<=cap,'SOURCE_READ_BOUND')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  def stamp(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  need(stamp(os.fstat(fd))==stamp(m),'SOURCE_OPEN_DRIFT');b=os.read(fd,cap+1);need(len(b)==m.st_size and stamp(os.fstat(fd))==stamp(m)==stamp(p.lstat()),'SOURCE_READ_DRIFT');return b
 finally:os.close(fd)
def rpc(method,*args):
 need(method in {'getblockchaininfo','getblockhash'},'RPC_SCOPE');r=subprocess.run([CLI,'-datadir=/data/bitcoin','-conf=/etc/bitcoin/bitcoin.conf',method,*map(str,args)],env=ENV,capture_output=True,timeout=15);need(r.returncode==0 and not r.stderr and len(r.stdout)<65536,'CORE_READ_FAILED')
 if method=='getblockhash':
  text=r.stdout.decode('ascii').strip();need(re.fullmatch('[0-9a-f]{64}',text)is not None,'CORE_HASH_SHAPE');return text
 return json.loads(r.stdout)
def validate_observations(row,runtime,core_hash,max_height=MAX_TARGET_HEIGHT):
 need(row.get('transactionReadOnly')=='on','SQL_NOT_READ_ONLY');cp=row.get('checkpoint')or{};height=cp.get('indexed_through_block');need(type(height)is int and height>max_height and re.fullmatch('[0-9a-f]{64}',str(cp.get('checkpoint_hash')))is not None,'CHECKPOINT_NOT_ABOVE_TARGETS');need(core_hash==cp['checkpoint_hash'],'CHECKPOINT_NOT_CANONICAL')
 need(runtime.get('NETWORK','livenet')=='livenet' and runtime.get('POW_INDEX_WORKER_BACKFILL_SOURCES','block-scan,mempool-scan')=='block-scan,mempool-scan','RUNTIME_SOURCE_SET');need(not any(k in runtime for k in FORBIDDEN),'RUNTIME_REPAIR_OVERRIDE')
 worker=row.get('worker')or{};need(worker.get('network')=='livenet' and worker.get('state')in {'idle','running','canonical-phase-complete'}and worker.get('workPrecisionEra')=='q16','WORKER_STATE_UNQUALIFIED')
 need(worker.get('backfillSources')in {None,'block-scan,mempool-scan'},'WORKER_META_SOURCE_SET')
 need(worker.get('activePwtRangeReplay')is False,'WORKER_RANGE_REPLAY_ACTIVE_OR_UNKNOWN')
 need(worker.get('backfillPhases')==[{'kind':'confirmed','sources':['block-scan']},{'kind':'best-effort-pending','sources':['mempool-scan']}],'WORKER_PHASE_PLAN_UNAVAILABLE_OR_CHANGED')
 rebuild=row.get('rebuild');need(rebuild is None or (rebuild.get('status')=='complete' and rebuild.get('active')is False and rebuild.get('complete')is True),'REBUILD_ACTIVE_OR_UNQUALIFIED')
 if rebuild is not None:
  need(rebuild.get('recursiveActivePwtRangeReplay')is False and rebuild.get('activePwtRangeReplay')is False,'REBUILD_RANGE_REPLAY_ACTIVE_OR_UNKNOWN')
  if rebuild.get('mode')=='pwt-range-replay':
   height=rebuild.get('rangeReplayFromHeight');date=rebuild.get('completedAt')
   need(rebuild.get('network')=='livenet' and type(height)is int and 0<height<=cp['indexed_through_block'] and isinstance(date,str) and bool(date.strip()) and rebuild.get('verificationObjectPresent')is True,'REBUILD_RANGE_REPLAY_COMPLETION_SHAPE')
   try:completed=datetime.datetime.fromisoformat(date.replace('Z','+00:00'))
   except (ValueError,TypeError):raise ValueError('REBUILD_RANGE_REPLAY_COMPLETION_DATE')
   need(completed.tzinfo is not None,'REBUILD_RANGE_REPLAY_COMPLETION_DATE')
 definition=row.get('workDefinition')or{};need(definition.get('amountStorageModel')=='work-subatoms-v2' and definition.get('precisionModel')=='canonical-work-subatoms-v2','WORK_Q16_DEFINITION')
 return True
def execute(runid):
 need(os.geteuid()==os.getegid()==0 and re.fullmatch(r'\d{8}T\d{6}Z',runid)is not None,'ROOT_RUN_ID')
 units=['bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service'];before={u:state(u)for u in units};need(all(v['ActiveState']=='active'and int(v['MainPID'])>0 and re.fullmatch('[0-9a-f]{32}',v['InvocationID'])for v in before.values()),'LIVE_SERVICES')
 worker=before[units[-1]];pid=int(worker['MainPID']);cmd=pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().rstrip(b'\0').split(b'\0');node=b'/opt/node-v24.18.0-linux-x64/bin/node';need(cmd in [[node,b'/opt/proofofwork-api/scripts/run-proof-indexer-worker.mjs',b'--loop'],[node,b'scripts/run-proof-indexer-worker.mjs',b'--loop']] and os.readlink(f'/proc/{pid}/cwd')=='/opt/proofofwork-api','WORKER_COMMAND_ARGS')
 pairs=pathlib.Path(f'/proc/{pid}/environ').read_bytes().split(b'\0');runtime={}
 for pair in pairs:
  if b'='not in pair:continue
  key,value=pair.split(b'=',1);name=key.decode('ascii','ignore')
  if name in FORBIDDEN+['NETWORK','POW_INDEX_WORKER_BACKFILL_SOURCES']:runtime[name]=value.decode('ascii','strict')
 source={name:hashlib.sha256(stable_read('/opt/proofofwork-api/'+name,8*1024**2)).hexdigest()for name in ['scripts/run-proof-indexer-worker.mjs','scripts/backfill-proof-indexer.mjs']}
 tip_before=rpc('getblockchaininfo');unit='proofofwork-audit30-worker-mail-guard-v2-'+runid+'.service';need(state(unit)['LoadState']=='not-found','SQL_UNIT_EXISTS')
 properties=['User=postgres','Group=postgres','NoNewPrivileges=yes','PrivateNetwork=yes','PrivateTmp=yes','PrivateDevices=yes','PrivateIPC=yes','ProtectSystem=strict','ProtectHome=yes','CapabilityBoundingSet=','AmbientCapabilities=','RestrictAddressFamilies=AF_UNIX','RuntimeMaxSec=30s','TimeoutStopSec=5s','KillMode=control-group','MemoryMax=128M','MemorySwapMax=0','CPUQuota=50%','TasksMax=16','UMask=0077','UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH PGSERVICE PGSERVICEFILE PGPASSWORD PGPASSFILE PGUSER PGDATABASE PGOPTIONS']
 argv=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+unit,'--service-type=exec',*['--property='+p for p in properties],'/usr/bin/env','-i','PATH=/usr/lib/postgresql/16/bin:/usr/bin:/bin','LC_ALL=C','TZ=UTC','PGHOST=/var/run/postgresql','PGPORT=5432','PGDATABASE=proof_indexer','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=10000','/usr/lib/postgresql/16/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer']
 r=subprocess.run(argv,input=SQL.encode(),env=ENV,capture_output=True,timeout=40);need(r.returncode==0 and not r.stderr and len(r.stdout)<65536,'SQL_READ_FAILED');row=json.loads(r.stdout);core_hash=rpc('getblockhash',(row.get('checkpoint')or{}).get('indexed_through_block'));validate_observations(row,runtime,core_hash)
 need(before=={u:state(u)for u in units},'LIVE_SERVICE_IDENTITY_DRIFT');tip_after=rpc('getblockchaininfo');need(tip_after['blocks']==tip_before['blocks'] and tip_after['bestblockhash']==tip_before['bestblockhash'],'CORE_TIP_CHANGED');need(state(unit).get('MainPID','0')=='0','READONLY_SQL_NOT_STOPPED')
 return dict(schema='pow-audit30-worker-mail-historical-exclusion-guard-v2',atUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),ok=True,sourceSha256=source,sqlSha256=hashlib.sha256(SQL.encode()).hexdigest(),runtimeAllowlisted=runtime,workerArgvQualified=True,observations=row,coreTip=dict(height=tip_after['blocks'],hash=tip_after['bestblockhash']),targetMaxHeight=MAX_TARGET_HEIGHT,checkpointHashVerified=core_hash,liveServices=before,liveServicesUnchanged=True,productionDataMutation=False,qualification='Fresh normal source set and hashed checkpoint exclude the 16 proven historical mail targets from restart block scan; genuine future reorg processing can still revisit confirmed history. Explicit stored phase plan and recursive active-range flags are false at this observation. The PWT completion predicate is a strict shallow source-state shape, not a full verification of preserved historical INCB witness manifests. This guard does not approve a manual repair or certify all replay witness internals. The root transport must separately bind these executed guard bytes by SHA256.')
if __name__=='__main__':
 try:print(json.dumps(execute(sys.argv[1]),sort_keys=True));status=0
 except Exception as e:print(json.dumps(dict(ok=False,errorClass=type(e).__name__,error=str(e)[:120])));status=1
 sys.exit(status)
