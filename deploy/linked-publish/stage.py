"""Stage only the plan-bound merged dependency closure on the node VPS."""
import hashlib,json,os,stat,subprocess,time
from contextlib import contextmanager
from pathlib import Path
class StageUncertain(RuntimeError): pass
NODE=Path('/opt/node-v24.18.0-linux-x64/bin/node')
STAGES=Path('/data/proofofwork-linked-publish-stage-v2')
EXTRA=('deploy/linked-publish/stage.mjs','deploy/linked-publish/pin-serving.mjs','deploy/linked-publish/census.mjs',
       'server/sql/proof-search-linked-publish-v1.sql','server/sql/proof-search-v1.sql')
def need(value,message):
 if not value:raise ValueError(message)
def directory(path):
 info=path.lstat()
 need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0 and not info.st_mode&0o022,'Unsafe stage directory')
@contextmanager
def source_creation_modes():
 # Only reviewed public source is staged; never apply this to credentials.
 # This coordinator is single-threaded. Restore the caller's private umask
 # even when exclusive creation fails. Never chmod existing artifacts.
 previous=os.umask(0o022)
 try:yield
 finally:os.umask(previous)
def stage_directory(path):
 directory(path)
 need(stat.S_IMODE(path.lstat().st_mode)==0o755,'Stage directory is not readable/traversable')
def create_stage_directory(path):
 directory(path.parent)
 with source_creation_modes():path.mkdir(mode=0o755,exist_ok=True)
 stage_directory(path)
def source_file(path):
 info=path.lstat()
 need(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==info.st_gid==0
      and stat.S_IMODE(info.st_mode)==0o644,'Unsafe staged source metadata')
def write(path,raw):
 with source_creation_modes():fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'wb') as f:
  f.write(raw);f.flush();os.fsync(f.fileno())
 source_file(path)
def stage_sources(release,plan,plan_sha):
 ns=release['engine']['namespace'](release['controller']())
 manifest=plan['runtimeManifestTemplate'];candidates=ns['validate_manifest'](manifest)
 release['source_fence'](plan['sourceCommit'])
 ns['fence'](ns['ROOT'],manifest,candidates);ns['metadata_fence'](ns['ROOT'],manifest['sourceMetadata'])
 need(hashlib.sha256(ns['safe_read'](NODE,200*1024**2)).hexdigest()==manifest['nodeSha256'],'Node changed')
 paths=ns['dependency_closure'](ns['ROOT'],candidates)|ns['ROOT_JSON']
 need(len(paths)<300,'Stage closure too large')
 sources={}
 for name in sorted(paths):
  raw=candidates.get(name)
  if raw is None:
   raw=ns['safe_read'](ns['ROOT']/name)
   need(ns['sha'](raw)==manifest['dependencies'].get(name),'Stage dependency changed: '+name)
  sources[name]=raw
 for name in EXTRA:
  sources[name]=release['engine']['git']('show',plan['sourceCommit']+':'+name)
 need(sum(map(len,sources.values()))<48*1024**2,'Stage size bound exceeded')
 for ancestor in reversed((STAGES.parent,*STAGES.parent.parents)):
  directory(ancestor)
  need(ancestor.lstat().st_mode&0o005==0o005,'Stage ancestor not publicly traversable')
 create_stage_directory(STAGES)
 path=STAGES/plan_sha
 proof={'format':'linked-publish-stage-v1','commit':plan['sourceCommit'],'planSha256':plan_sha,
  'sourceHashes':{name:ns['sha'](raw) for name,raw in sources.items()}}
 if not os.path.lexists(path):
  create_stage_directory(path)
  for name,raw in sources.items():
   dest=path/name
   for relative in reversed(dest.parent.relative_to(path).parents):
    if str(relative)!='.':create_stage_directory(path/relative)
   if dest.parent!=path:create_stage_directory(dest.parent)
   write(dest,raw)
  libs=ns['ROOT']/'node_modules';need(libs.resolve(strict=True)==libs and libs.is_dir(),'Unsafe runtime dependencies')
  os.symlink(libs,path/'node_modules');write(path/'stage.json',(json.dumps(proof,sort_keys=True)+'\n').encode())
 stage_directory(path)
 source_file(path/'stage.json')
 need(json.loads(ns['safe_read'](path/'stage.json'))==proof,'Stage provenance changed')
 need(os.readlink(path/'node_modules')==str(ns['ROOT']/'node_modules'),'Stage modules changed')
 observed=set()
 for parent,dirs,files in os.walk(path,followlinks=False):
  stage_directory(Path(parent))
  for name in dirs:
   item=Path(parent)/name
   if item.is_symlink():need(item==path/'node_modules','Unexpected stage symlink')
  observed.update(str((Path(parent)/name).relative_to(path)) for name in files if Path(parent)/name!=path/'stage.json')
 need(observed==set(sources),'Unexpected stage source')
 for name,raw in sources.items():
  source_file(path/name)
  need(ns['safe_read'](path/name)==raw,'Changed staged bytes: '+name)
 return path
def command(path,mode,release_id,unit,run_id=None,runtime_seconds=300):
 args=['/usr/bin/systemd-run','--quiet','--pipe','--wait','--collect','--service-type=exec','--unit='+unit,
 '--property=User=powadmin','--property=Group=powadmin','--property=NoNewPrivileges=true',
 '--property=PrivateDevices=true','--property=PrivateTmp=true','--property=ProtectSystem=strict',
 '--property=ProtectHome=true','--property=CapabilityBoundingSet=','--property=MemorySwapMax=0',
 '--property=MemoryMax=512M','--property=CPUQuota=100%','--property=IOWeight=25',
 '--property=IOSchedulingClass=idle','--property=Nice=10','--property=RuntimeMaxSec='+str(runtime_seconds),
 '--property=LimitCORE=0','--property=WorkingDirectory='+str(path),
 '--property=EnvironmentFile=/etc/proofofwork-api/proof-indexer-db.env',
 '--property=EnvironmentFile=/etc/proofofwork-api/bitcoin-rpc.env',
 '--setenv=NETWORK=livenet','--setenv=POW_INDEX_DB_POOL_MAX=1',
 '--setenv=POW_INDEX_DB_STATEMENT_TIMEOUT_MS=15000',str(NODE),str(path/'deploy/linked-publish/stage.mjs'),mode,release_id]
 return args+([run_id] if run_id else [])
def stopped(unit):
 p=subprocess.run(['/usr/bin/systemctl','show',unit,'--property=LoadState','--property=ActiveState','--property=MainPID'],capture_output=True,text=True,timeout=15)
 row=dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
 return row.get('LoadState')=='not-found' or (row.get('ActiveState') in ('inactive','failed') and row.get('MainPID')=='0')
def run_stage(path,mode,release_id,plan_sha,sequence,hold_check,run_id=None,deadline=None):
 hold_check()
 unit='pow-linked-'+plan_sha[:12]+'-'+str(sequence)+'-'+mode
 need(stopped(unit),'Stage unit already active')
 remaining=330 if deadline is None else deadline-time.monotonic()
 need(remaining>=1,'Prebuild deadline exhausted before child launch')
 timeout=min(330,remaining)
 runtime_seconds=min(300,int(remaining))
 try:
  p=subprocess.run(command(path,mode,release_id,unit,run_id,runtime_seconds),capture_output=True,timeout=timeout)
 except BaseException as error:
  try:
   subprocess.run(['/usr/bin/systemctl','stop',unit],check=True,capture_output=True,timeout=40)
   need(stopped(unit),'Stage child remains active')
  except BaseException as recovery:raise StageUncertain('Staged child recovery unverified: '+unit) from recovery
  raise RuntimeError('Staged child stopped after interruption: '+unit) from error
 try:
  if not stopped(unit):raise StageUncertain('Staged child exit not verified: '+unit)
 except BaseException as error:
  raise StageUncertain('Staged terminal observation unavailable: '+unit) from error
 hold_check()
 need(deadline is None or time.monotonic()<deadline,'Prebuild deadline exhausted after child stop')
 need(len(p.stdout)<2*1024**2 and len(p.stderr)<2*1024**2,'Staged evidence output exceeds bound')
 try:result=json.loads(p.stdout)
 except (ValueError,UnicodeError) as error:raise RuntimeError('Staged result unavailable: '+unit) from error
 need(p.returncode==0 and result.get('ok') is True,'Staged '+mode+' failed: '+str(result.get('code','unknown')))
 return result
