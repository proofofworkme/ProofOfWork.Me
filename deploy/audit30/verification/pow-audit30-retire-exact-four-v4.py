#!/usr/bin/python3 -I
"""SOURCE-ONLY fixed-four retirement adapter. Default verification; separate
root-custodied direct-human exact-plan approval is mandatory for apply.
No pin/checker installer, age rule, resume, timer/service control, or SQL/RPC.
"""
import argparse,datetime,fcntl,hashlib,json,os,re,signal,stat,sys,time,types
from pathlib import Path
HOST='pow-bitcoin-01'
CUSTODY_SHA='55ab227a919da3a5e33072089297bf4ed86431d9a23bd3187646d0e7af21433d'
CHECKER_SHA='e8e0771335c10e79a75a7671539de8597bc02dca61b0e936768ba378bc252dad'
OLD_CHECKER_SHA='da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a'
HELD_SHA='c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9'
JOBS=tuple('/data/proofofwork-audit30-'+s for s in ('restore-20261002T234651Z','inspect-20261003T005512Z','inspect-20261003T014100Z'))
OLD=Path('/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset')
OCT2=OLD.parent/'proof_indexer-20261002T031851Z.dumpset'
TARGETS=tuple(j+'/cluster' for j in JOBS)+(str(OLD),)
OCT2_MEMBERS={'proof_indexer.dump':(20525963614,'893700c4fff20e4bad721d16188f67dd04e3f44ee9f3f63784c15c51488a7b1a'),'globals.sql':(1137,'f38a588ae95aa4e41b044a437fa9b2a65d315ce91877210c264c6e753d25b3da'),'SHA256SUMS':(163,'699d111713cf8bf7d8c672087faef2599c314270a622d7c661130a3d695ac860')}
PIN=Path('/etc/proofofwork-postgres-logical-backup.pins')
CHECKER=Path('/usr/local/sbin/proofofwork-retention-protection')
LOCK=Path('/run/proofofwork-audit29-ops.lock')
EVIDENCE_PARENT=Path('/data/proofofwork-release-backups')
H=None
SHA=re.compile('[0-9a-f]{64}')
MAX_JSON=32*1024**2
KNOWN_DEPENDENCIES={
 '/data/proofofwork-audit30-inspect-20261003T014100Z/exact-sixteen-readonly-finalization-v1/completed.json':dict(sha256='d818545fa493f1032b3b6bfb7b1ba4b8738e3b15968c3f0ed949a0d1bb09bce8',bytes=7010,uid=108,gid=112,mode=0o600,nlink=1),
 '/usr/local/lib/proofofwork-audit30-transition-stream/20261003T030000Z/phase4-private-plan.json':dict(sha256='4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00',bytes=6713728,uid=0,gid=112,mode=0o440,nlink=1)
}
# These exact observed files are allowed only when explicitly declared in
# the reviewed dependency manifest. Their absence does not prove completeness.
# The original two mandatory dependencies remain independently required.
OBSERVED_CUSTODY_DEPENDENCIES={'/data/proofofwork-audit30-inspect-20261003T014100Z/stream-completion-v2/completed.json': {'sha256': '974e16cfb288e19e7320fa87687d32cff65b2a58296b4e94893ddbdfaea3c841', 'metadata': {'bytes': 10029, 'ctimeNs': 1791009948537706755, 'device': 64514, 'gid': 112, 'inode': 11142815, 'mode': 384, 'mtimeNs': 1791009948537706755, 'nlink': 1, 'uid': 108}}, '/data/proofofwork-audit30-inspect-20261003T014100Z/stream-completion-v2/intent.json': {'sha256': '121d96aaf3af0eae662e1d602b304d54e3db4c5185059e8386164e540d1cf8f3', 'metadata': {'bytes': 5364, 'ctimeNs': 1791009910744703753, 'device': 64514, 'gid': 112, 'inode': 11142810, 'mode': 384, 'mtimeNs': 1791009910744703753, 'nlink': 1, 'uid': 108}}, '/opt/node-v24.18.0-linux-x64/bin/node': {'sha256': '41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c', 'metadata': {'bytes': 123655872, 'ctimeNs': 1783987646454677986, 'device': 64512, 'gid': 0, 'inode': 537530, 'mode': 493, 'mtimeNs': 1782236933000000000, 'nlink': 1, 'uid': 0}}}
LIMIT=900
class Refused(ValueError):pass
class RetirementInterrupted(RuntimeError):pass
def need(v,m):
 if not v:raise Refused(m)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'DUPLICATE_JSON');d[k]=v
 return d
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def root_read(path,digest=None,cap=MAX_JSON,mode=None):
 p=Path(path);s=p.lstat();need(p.is_absolute()and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=cap and not os.listxattr(p,follow_symlinks=False),'ROOT_INPUT_CUSTODY')
 if mode is not None:need(stat.S_IMODE(s.st_mode)==mode,'ROOT_INPUT_MODE')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:
  need(stamp(os.fstat(f.fileno()))==stamp(s),'ROOT_INPUT_FD');b=f.read(cap+1);need(stamp(os.fstat(f.fileno()))==stamp(s),'ROOT_INPUT_FD_DRIFT')
 need(stamp(p.lstat())==stamp(s)and len(b)==s.st_size,'ROOT_INPUT_DRIFT')
 if digest is not None:need(isinstance(digest,str)and SHA.fullmatch(digest)and sha(b)==digest,'ROOT_INPUT_HASH')
 return b

def load(path):
 global H
 raw=root_read(path,CUSTODY_SHA,65536);H=types.ModuleType('fixed_custody');H.__file__=str(path);exec(compile(raw,str(path),'exec'),H.__dict__)
 need(tuple(H.TARGETS)==TARGETS and tuple(H.JOBS)==JOBS,'HELPER_SCOPE')

def sync_dir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def durable(path,value):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(encoded(value)+b'\n');f.flush();os.fsync(f.fileno())
 sync_dir(path.parent)

def read_binding(row):
 need(isinstance(row,dict)and set(row)=={'path','sha256'}and isinstance(row['path'],str)and isinstance(row['sha256'],str)and SHA.fullmatch(row['sha256']),'EXACT_RECEIPT_BINDING')
 return json.loads(root_read(row['path'],row['sha256'],mode=0o600),object_pairs_hook=pairs)

def validate_plan(p):
 keys={'schema','host','controllerSha256','runId','candidatePaths','proofs','liveFive','holdFence','oct2Fence','evidencePath'}
 need(isinstance(p,dict)and set(p)==keys and p['schema']=='pow-audit30-retire-exact-four-plan-v1'and p['host']==HOST and SHA.fullmatch(p['controllerSha256']),'EXACT_PLAN')
 rid=p['runId'];need(isinstance(rid,str)and re.fullmatch('[0-9]{8}T[0-9]{6}Z',rid)and datetime.datetime.strptime(rid,'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==rid,'CALENDAR_RUN')
 need(p['candidatePaths']==list(TARGETS)and p['evidencePath']==str(EVIDENCE_PARENT/('audit30-exact-four-retirement-'+rid)),'EXACT_FOUR_ONLY')
 need(isinstance(p['proofs'],dict)and set(p['proofs'])=={'rootBefore','content','rootAfter','prerequisiteReview','promotion'},'PROOF_SCOPE')
 need(set(p['liveFive'])==set(H.LIVE),'LIVE_FIVE_SCOPE')
 need(isinstance(p['holdFence'],dict)and set(p['holdFence'])=={'hold','review','masks','heldCensus'},'HOLD_FENCE_SCOPE')
 need(set(p['holdFence']['masks'])=={'proofofwork-node-release-prune.timer'},'MASK_SCOPE')
 need(isinstance(p['oct2Fence'],dict)and set(p['oct2Fence'])=={'path','records','fullFileHashes'}and p['oct2Fence']['path']==str(OCT2),'RETAINED_OCT2_SCOPE')
 return p

def target_rows(proofs):
 b,c,a=(proofs[k]for k in ('rootBefore','content','rootAfter'))
 need(b.get('schema')==a.get('schema')=='pow-audit30-retirement-root-custody-census-v1'and c.get('schema')=='pow-audit30-retirement-content-custody-v1','CUSTODY_SCHEMAS')
 need(b.get('productionMutation')is False and a.get('productionMutation')is False and c.get('productionMutation')is False and c.get('deletionAuthorized')is False and c.get('noAtime')is True,'CUSTODY_NOT_AUTHORITY')
 for value in (b,c,a):need([r.get('path')for r in value.get('targets',[])]==list(TARGETS),'ORDERED_CUSTODY_TARGETS')
 need(b['targets']==a['targets']and b['retainedNonClusterEvidence']==a['retainedNonClusterEvidence']and b['liveFive']==a['liveFive'],'CUSTODY_ENDPOINT_DRIFT')
 for v in (b,a):
  readers=v.get('processReaders',{});need(readers.get('completeForObservedLiveProcesses')is True and readers.get('matches')==[] and readers.get('candidateReadersObserved')is False,'OBSERVED_READER_OR_UNKNOWN')
  need(len(v.get('privateControls',[]))==3,'STOPPED_CONTROL_SCOPE')
 rows=[]
 for meta,content in zip(b['targets'],c['targets']):
  records=meta['records'];hashes=content['fullFileHashes'];need(1<=len(records)<=6000 and records[0]['path']==meta['path']and records[0]['kind']=='directory'and records==sorted(records,key=lambda r:os.fsencode(r['path'])),'ROOT_RECORD_SCOPE');need(content.get('allRegularBytesHashed')is True and meta['metadataSha256']==content['metadataSha256']==sha(encoded(records))and content['fullFileHashesSha256']==sha(encoded(hashes)),'FULL_CONTENT_METADATA_BINDING')
  need([r['path']for r in hashes]==[r['path']for r in records if r['kind']=='file']and len(records)==meta['entries']==content['entries'],'FULL_FILE_SCOPE')
  bypath={r['path']:r for r in hashes};need(len(bypath)==len(hashes)and len({r['path']for r in records})==len(records),'DUPLICATE_CUSTODY_MEMBER')
  for r in records:
   need(r['path']==meta['path']or r['path'].startswith(meta['path']+'/'),'MEMBER_ESCAPE')
   need(all(type(r.get(k))is int and r[k]>=0 for k in('device','inode','uid','gid','mode','nlink','bytes','allocatedBytes','mtimeNs','ctimeNs')),'CUSTODY_INTEGER_FIELDS');need(r['kind']in('file','directory')and r['uid']==108 and r['gid']==112 and r['xattrs']==[]and not r['mode']&0o022,'UNSAFE_CUSTODY_MEMBER')
   if r['kind']=='file':need(r['nlink']==1 and bypath[r['path']]['metadataSha256']==sha(encoded(r))and SHA.fullmatch(bypath[r['path']]['sha256']),'HARDLINK_OR_UNBOUND_CONTENT')
  amount=H.allocation(records);need(all(meta[k]==content[k]==amount[k]for k in('entries','regularBytes','allocatedBytes'))and amount['regularBytes']<=((32 if meta['path']==str(OLD)else 80)*1024**3)and amount['allocatedBytes']<=((32 if meta['path']==str(OLD)else 80)*1024**3),'CONTENT_ALLOCATION_BOUND');rows.append(dict(path=meta['path'],records=records,fullFileHashes=hashes))
 return rows

def proofs(p):
 values={k:read_binding(v)for k,v in p['proofs'].items()};rows=target_rows(values)
 need(values['content']['rootBeforeSha256']==p['proofs']['rootBefore']['sha256']and values['rootBefore']['liveFive']==p['liveFive'],'ROOT_CONTENT_LINEAGE')
 r=values['prerequisiteReview'];flags=('recoveryEquivalenceReviewed','uniqueHistoryAndSourceWorkRetained','dependencyMatchesExactlyReviewed','allUnknownOrSkippedDependenciesResolved','originalPrivateCompletionAndMathAccepted','wholeOct2RestoreAndBytesAccepted','heldParentAndAllEvidenceRetained')
 need(r.get('schema')=='pow-audit30-exact-four-prerequisite-review-v1'and r.get('status')=='accepted-for-final-human-review'and r.get('candidatePaths')==list(TARGETS)and r.get('custodyBindings')=={k:p['proofs'][k]for k in('rootBefore','content','rootAfter')}and all(r.get(k)is True for k in flags),'UNRESOLVED_PREREQUISITE')
 need(isinstance(r.get('inputs'),list)and 1<=len(r['inputs'])<=32 and isinstance(r.get('dependencyFiles'),list)and bool(r['dependencyFiles']),'PREREQUISITE_INPUTS')
 for binding in r['inputs']:read_binding(binding)
 promotion=values['promotion'];wanted=dict(schema='pow-audit30-logical-pin-checker-promotion-completed-v1',status='completed',pinPath=str(PIN),oldPin='proof_indexer-20260929T031853Z.dumpset',newPin=OCT2.name,checkerPath=str(CHECKER),oldCheckerSha256=OLD_CHECKER_SHA,newCheckerSha256=CHECKER_SHA,pinAndCheckerCoupled=True,oldPinBytesPreserved=True,holdAndMasksUnchanged=True,ordinaryTimersUnchanged=True,deletionAuthorized=False)
 need(all(promotion.get(k)==v and type(promotion.get(k))is type(v)for k,v in wanted.items()),'COUPLED_PROMOTION_NOT_PROVEN')
 need(SHA.fullmatch(promotion.get('approvalReceiptSha256','')),'PROMOTION_APPROVAL_MISSING')
 return values,rows

def held_state(path):
 p=Path(path)
 if not os.path.lexists(p):return{'path':str(p),'exists':False}
 s=p.lstat();need(not stat.S_ISLNK(s.st_mode)and p.resolve(strict=True)==p and not os.listxattr(p,follow_symlinks=False),'HELD_ALIAS_OR_XATTR')
 if stat.S_ISDIR(s.st_mode):return dict(path=str(p),exists=True,kind='directory',device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode))
 need(stat.S_ISREG(s.st_mode),'HELD_UNSUPPORTED')
 return dict(path=str(p),exists=True,kind='file',device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)

def hold_fence(p):
 f=p['holdFence'];
 for key in('hold','review'):
  b=f[key];need(set(b)=={'path','sha256','metadata'}and H.metadata(Path(b['path']),True)==b['metadata'],'HOLD_OBJECT_IDENTITY')
 root_read(f['hold']['path'],f['hold']['sha256'],65536);review=read_binding({k:f['review'][k]for k in('path','sha256')});need(f['review']['path']=='/etc/proofofwork-retention/audit28-held-review.json'and f['review']['sha256']==HELD_SHA and f['hold']['path']=='/etc/proofofwork-retention/audit28.hold','ORIGINAL_HOLD_SCOPE')
 paths=[r['path']for r in review['retain']if r.get('role')=='node'];need(len(paths)==521 and len(set(paths))==521 and [r['path']for r in f['heldCensus']]==paths,'COMPLETE_HELD_CENSUS')
 need(not any(t==v or v.startswith(t+'/')for t in TARGETS for v in paths),'INDIVIDUAL_HELD_TARGET_REQUIRES_SEPARATE_DESIGN')
 need([held_state(path)for path in paths]==f['heldCensus'],'HELD_CENSUS_DRIFT')
 for unit,expected in f['masks'].items():
  path=Path('/etc/systemd/system')/unit;s=path.lstat();need(stat.S_ISLNK(s.st_mode)and s.st_uid==0 and os.readlink(path)=='/dev/null'and expected==dict(device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns,target='/dev/null'),'MASK_DRIFT')
  need(H.properties(unit,('LoadState','ActiveState'))=={'LoadState':'masked','ActiveState':'inactive'},'MASK_NOT_PAUSED')
 need(root_read(PIN,cap=4096)==(OCT2.name+'\n').encode(),'CURRENT_PIN_NOT_OCT2');root_read(CHECKER,CHECKER_SHA,65536,0o755)

def dependency_contract(path,row):
 observed=OBSERVED_CUSTODY_DEPENDENCIES.get(str(path))
 if observed is not None:
  m=row['metadata'];keys={'device','inode','mode','uid','gid','nlink','bytes','mtimeNs','ctimeNs'}
  need(isinstance(m,dict)and set(m)==keys and all(type(v)is int and v>=0 for v in m.values())and row['sha256']==observed['sha256']and m==observed['metadata'],'OBSERVED_CUSTODY_DEPENDENCY_CONTRACT')
  return observed['metadata']['bytes'],(observed['metadata']['uid'],)
 # Only these two immutable, already reviewed dependencies differ from the
 # original generic owner/size contract. Inode/time/device still come from
 # the fresh exact manifest and are checked before, during and after read.
 known=KNOWN_DEPENDENCIES.get(str(path))
 if known is None:return 4*1024**2,(0,1000)
 m=row['metadata'];keys={'device','inode','mode','uid','gid','nlink','bytes','mtimeNs','ctimeNs'}
 need(isinstance(m,dict)and set(m)==keys and all(type(v)is int and v>=0 for v in m.values())and row['sha256']==known['sha256']and all(m[k]==v for k,v in known.items()if k!='sha256'),'KNOWN_DEPENDENCY_CONTRACT')
 return known['bytes'],(known['uid'],)

def dependency_fence(review):
 files=review['dependencyFiles'];need(len(files)<=75000 and len({r['path']for r in files})==len(files)and set(KNOWN_DEPENDENCIES)<={r['path']for r in files},'DEPENDENCY_BOUND')
 total=0
 for r in files:
  need(set(r)=={'path','metadata','sha256'},'DEPENDENCY_FIELDS');path=Path(r['path']);cap,owners=dependency_contract(path,r);s=path.lstat();m=dict(device=s.st_dev,inode=s.st_ino,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,nlink=s.st_nlink,bytes=s.st_size,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
  need(path.resolve(strict=True)==path and stat.S_ISREG(s.st_mode)and s.st_uid in owners and not s.st_mode&0o022 and s.st_nlink==1 and not os.listxattr(path,follow_symlinks=False)and m==r['metadata']and s.st_size<=cap,'DEPENDENCY_IDENTITY')
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
  with os.fdopen(fd,'rb')as stream:need(stamp(os.fstat(stream.fileno()))==stamp(s),'DEPENDENCY_FD');raw=stream.read(cap+1);need(stamp(os.fstat(stream.fileno()))==stamp(s),'DEPENDENCY_FD_DRIFT')
  total+=len(raw);need(total<=192*1024**2 and stamp(path.lstat())==stamp(s)and sha(raw)==r['sha256'],'DEPENDENCY_BYTES')

def retained_fence(before,removed):
 mount=H.bounded_read(Path('/proc/self/mountinfo'),H.MAX_PROC_FILE)
 for old in before['retainedNonClusterEvidence']:
  actual=H.retained_evidence(old['jobRoot'],mount);expected=old
  if old['jobRoot']+'/cluster'in removed:
   actual=json.loads(encoded(actual));expected=json.loads(encoded(old));a,b=actual['metadataRecords'][0],expected['metadataRecords'][0]
   need(a['nlink']==b['nlink']-1,'RETAINED_PARENT_LINK_DRIFT')
   for key in('nlink','bytes','allocatedBytes','mtimeNs','ctimeNs'):a.pop(key);b.pop(key)
   # Only allocation/metadata digest of the surviving parent directory may change.
   for value in(actual,expected):
    for key in('allocatedBytes','metadataRecordsSha256'):value.pop(key)
  need(actual==expected,'NONCLUSTER_EVIDENCE_DRIFT')

def stopped_controls(remaining):
 for target,unit in zip(TARGETS[:3],H.PRIVATE_UNITS):
  value=H.properties(unit);need(value['MainPID']=='0'and value['ActiveState']in('inactive','failed')and value['LoadState']in('loaded','not-found'),'PRIVATE_UNIT_RUNNING')
  need((value['ActiveState']=='inactive'and value['SubState']=='dead')or(value['LoadState']=='loaded'and value['ActiveState']=='failed'and value['SubState']=='failed'),'PRIVATE_TERMINAL_SHAPE')
  if value['LoadState']=='not-found':need(not value['InvocationID'],'PRIVATE_GC_INVOCATION')
  if target not in remaining:continue
  need(not os.path.lexists(Path(target)/'postmaster.pid'),'PRIVATE_POSTMASTER_PID')
  raw=H.command(['/usr/lib/postgresql/16/bin/pg_controldata',target]);d={k:v.strip()for k,v in(line.split(':',1)for line in raw.decode().splitlines()if':'in line)}
  need(d.get('Database cluster state')=='shut down'and d.get('Database system identifier')=='7692221671691040144'and d.get('Data page checksum version')=='1','PRIVATE_CONTROL_DRIFT')

def oct2_fence(p,full):
 f=p['oct2Fence'];rawmount=H.bounded_read(Path('/proc/self/mountinfo'),H.MAX_PROC_FILE);rows=H.walk(OCT2,rawmount);need(rows==f['records'],'RETAINED_OCT2_METADATA')
 files={r['path']:r for r in f['fullFileHashes']};need(len(rows)==4 and {Path(r['path']).name for r in rows[1:]}==set(OCT2_MEMBERS)and all(r['kind']=='file'and r['bytes']==OCT2_MEMBERS[Path(r['path']).name][0]for r in rows[1:]),'EXACT_RETAINED_OCT2_MEMBERS');need(set(files)=={r['path']for r in rows if r['kind']=='file'}and len(files)==len(f['fullFileHashes']),'RETAINED_OCT2_HASH_SCOPE')
 for row in rows:
  if row['kind']=='file':
   h=files[row['path']];need(h['metadataSha256']==sha(encoded(row))and h['sha256']==OCT2_MEMBERS[Path(row['path']).name][1],'RETAINED_OCT2_HASH_BINDING')
   if full:need(H.read_hash(Path(row['path']),row)==h['sha256'],'RETAINED_OCT2_BYTES')

def fresh(p,values,rows,removed,full=False):
 H.quiet();H.capacity();need(H.live()==p['liveFive'],'LIVE_FIVE_DRIFT');hold_fence(p);dependency_fence(values['prerequisiteReview']);retained_fence(values['rootBefore'],removed);oct2_fence(p,full)
 remaining=[r['path']for r in rows if r['path']not in removed];stopped_controls(remaining)
 allrecords={r['path']:r['records']for r in rows};readers=H.proc_readers(allrecords);need(readers['matches']==[]and readers['completeForObservedLiveProcesses']is True,'FRESH_READER_OR_ALIAS')
 for path in removed:need(not os.path.lexists(path),'RETIRED_TARGET_REAPPEARED')
 H.tick()

def check_target(row,full=True):
 mount=H.bounded_read(Path('/proc/self/mountinfo'),H.MAX_PROC_FILE);actual=H.walk(Path(row['path']),mount);need(actual==row['records'],'TARGET_METADATA_DRIFT')
 if full:
  files={r['path']:r for r in row['fullFileHashes']}
  for record in actual:
   if record['kind']=='file':need(H.read_hash(Path(record['path']),record)==files[record['path']]['sha256'],'TARGET_BYTES_DRIFT')

def fd_matches(fd,row,directory_changed=False):
 s=os.fstat(fd);actual=dict(device=s.st_dev,inode=s.st_ino,uid=s.st_uid,gid=s.st_gid,mode=stat.S_IMODE(s.st_mode),nlink=s.st_nlink,bytes=s.st_size,allocatedBytes=s.st_blocks*512,mtimeNs=s.st_mtime_ns,ctimeNs=s.st_ctime_ns)
 keys=set(actual)-({'nlink','bytes','allocatedBytes','mtimeNs','ctimeNs'}if directory_changed else set());need(all(actual[k]==row[k]for k in keys)and not os.listxattr(fd),'DELETION_FD_IDENTITY')
 need(stat.S_ISDIR(s.st_mode)if row['kind']=='directory'else stat.S_ISREG(s.st_mode),'DELETION_FD_TYPE')

def retire_tree(row,persist,heartbeat):
 """Adapt Audit30 dirfd retirement; no recursive rmtree or unchecked member."""
 root=Path(row['path']);records={r['path']:r for r in row['records']};hashes={r['path']:r['sha256']for r in row['fullFileHashes']};parent=os.open(root.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 parentstamp=stamp(os.fstat(parent));need(root.parent.resolve(strict=True)==root.parent and stamp(root.parent.lstat())==parentstamp,'TARGET_PARENT_IDENTITY')
 def named(fd,name,path,expected,changed=False):
  s=os.stat(name,dir_fd=fd,follow_symlinks=False);need((s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid)==(expected['device'],expected['inode'],(stat.S_IFDIR if expected['kind']=='directory'else stat.S_IFREG)|expected['mode'],expected['uid'],expected['gid']),'NAMED_DELETION_IDENTITY')
  need(path.resolve(strict=True)==path,'NAMED_CANONICAL_PATH')
  if not changed:need(H.metadata(path)==expected,'NAMED_METADATA_DRIFT')
 def walk(fd,name,path):
  heartbeat();expected=records[str(path)];named(fd,name,path,expected);flags=os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME|(os.O_DIRECTORY if expected['kind']=='directory'else 0);opened=os.open(name,flags,dir_fd=fd)
  try:
   fd_matches(opened,expected)
   if expected['kind']=='file':
    digest=hashlib.sha256();count=0
    while True:
     heartbeat();chunk=os.read(opened,1024**2)
     if not chunk:break
     count+=len(chunk);need(count<=expected['bytes'],'DELETION_FILE_GREW');digest.update(chunk)
    need(count==expected['bytes']and digest.hexdigest()==hashes[str(path)],'IMMEDIATE_FILE_BYTES');fd_matches(opened,expected);named(fd,name,path,expected)
    os.unlink(name,dir_fd=fd);os.fsync(fd);persist(dict(path=str(path),kind='file',device=expected['device'],inode=expected['inode'],sha256=hashes[str(path)],outcome='unlinked'))
   else:
    children=sorted((e.name for e in os.scandir(opened)),key=os.fsencode);wanted=sorted([Path(p).name for p in records if Path(p).parent==path],key=os.fsencode);need(children==wanted,'EXTRA_OR_MISSING_DIRECTORY_MEMBER')
    for child in children:walk(opened,child,path/child)
    need(list(os.scandir(opened))==[],'DIRECTORY_NOT_EMPTY');fd_matches(opened,expected,True);named(fd,name,path,expected,True);os.rmdir(name,dir_fd=fd);os.fsync(fd);persist(dict(path=str(path),kind='directory',device=expected['device'],inode=expected['inode'],outcome='removed-empty'))
  finally:os.close(opened)
 try:walk(parent,root.name,root);need(stamp(root.parent.lstat())[:5]==stamp(os.fstat(parent))[:5]and stamp(os.fstat(parent))[:5]==parentstamp[:5]and os.fstat(parent).st_nlink==parentstamp[5]-1,'TARGET_PARENT_REPLACED')
 finally:os.close(parent)

def approval(raw,plan_sha,controller_sha,p):
 a=json.loads(raw,object_pairs_hook=pairs);wanted=dict(schema='pow-audit30-human-exact-four-retirement-approval-v1',status='approved',approvalSource='direct-human',operation='retire-exact-four',planSha256=plan_sha,controllerSha256=controller_sha,candidatePaths=list(TARGETS),coupledPromotionReceiptSha256=p['proofs']['promotion']['sha256'],noAutomaticRetry=True,noTimerOrPinOrServiceChanges=True,jobRootsAndEvidencePreserved=True,retainedOct2Preserved=True)
 need(set(a)==set(wanted)|{'approvedAtUtc'}and all(a.get(k)==v and type(a.get(k))is type(v)for k,v in wanted.items()),'SEPARATE_HUMAN_EXACT_PLAN_APPROVAL')
 observed=datetime.datetime.fromisoformat(a['approvedAtUtc'].replace('Z','+00:00'));need(observed.tzinfo is not None,'APPROVAL_TIMEZONE');return a

def acquire_lock():
 s=LOCK.lstat();need(LOCK.resolve(strict=True)==LOCK and stat.S_ISREG(s.st_mode)and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and not os.listxattr(LOCK,follow_symlinks=False),'OPS_LOCK_CUSTODY');fd=os.open(LOCK,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  need(stamp(os.fstat(fd))==stamp(s),'OPS_LOCK_FD');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);need(stamp(os.fstat(fd))==stamp(s)==stamp(LOCK.lstat()),'OPS_LOCK_POSTFLOCK');return fd
 except BaseException:os.close(fd);raise

def execute(p,raw,plan_sha,apply=False,approval_path=None,approval_sha=None):
 need((os.geteuid(),os.getegid())==(0,0)and os.uname().nodename==HOST,'ROOT_FIXED_HOST');validate_plan(p);need(raw==encoded(p)and sha(raw)==plan_sha,'CANONICAL_PLAN_BYTES');need(sha(root_read(__file__,cap=65536))==p['controllerSha256'],'CONTROLLER_BYTES')
 H.DEADLINE=time.monotonic()+LIMIT;H.LAST_CHECK=0;values,rows=proofs(p);lock=acquire_lock();old={};completed=[];entrycount=0;latest=None;phase='preflight';current=None;out=Path(p['evidencePath'])
 try:
  if apply:
   need(approval_path is not None and approval_sha is not None,'NO_DELETION_WITHOUT_APPROVAL');approval(root_read(approval_path,approval_sha,65536,0o600),plan_sha,p['controllerSha256'],p)
   need(not os.path.lexists(out),'EVIDENCE_EXISTS_NO_RESUME');s=EVIDENCE_PARENT.lstat();need(EVIDENCE_PARENT.resolve(strict=True)==EVIDENCE_PARENT and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'EVIDENCE_PARENT');out.mkdir(mode=0o700);sync_dir(out.parent)
   def interrupted(*_):raise RetirementInterrupted('EXACT_FOUR_INTERRUPTED')
   for number in(signal.SIGTERM,signal.SIGINT,signal.SIGHUP):old[number]=signal.signal(number,interrupted)
   durable(out/'intent.json',dict(schema='pow-audit30-exact-four-retirement-intent-v1',status='approved-intent',atUtc=utc(),plan=p,planSha256=plan_sha,approvalReceiptPath=str(approval_path),approvalReceiptSha256=approval_sha,automaticRetry=False))
  fresh(p,values,rows,set(),True)
  for row in rows:check_target(row)
  if not apply:return dict(schema='pow-audit30-exact-four-verified-v1',status='verified',planSha256=plan_sha,candidateCount=4,deletionAuthorized=False,continuousFutureReaderExclusion=False)
  def persist(entry):
   nonlocal entrycount,latest
   entrycount+=1;path=out/(str(entrycount).zfill(6)+'-partial.json');durable(path,dict(schema='pow-audit30-exact-four-entry-progress-v1',status='partial',sequence=entrycount,planSha256=plan_sha,completedTargets=completed,currentTarget=current,entry=entry,previousReceiptSha256=latest['sha256']if latest else None));latest=dict(path=str(path),sha256=sha(root_read(path,cap=65536)))
  def heartbeat():
   H.tick();H.periodic()
  for row in rows:
   current=row['path'];phase='immediate-before-target';fresh(p,values,rows,set(completed));check_target(row);phase='dirfd-retirement';retire_tree(row,persist,heartbeat);completed.append(current)
   durable(out/('target-'+str(len(completed))+'-completed.json'),dict(schema='pow-audit30-exact-four-target-completed-v1',planSha256=plan_sha,path=current,outcome='retired',completedTargets=completed,entryProgressCount=entrycount,lastEntryReceipt=latest))
  phase='final-preservation';fresh(p,values,rows,set(completed),True);need(completed==list(TARGETS),'EXACT_COMPLETE_SCOPE')
  value=dict(schema='pow-audit30-exact-four-retirement-completed-v1',status='completed',planSha256=plan_sha,approvalReceiptSha256=approval_sha,completedTargets=completed,entryProgressCount=entrycount,lastEntryReceipt=latest,jobRootsAndNonclusterEvidencePreserved=True,retainedOct2BytesPreserved=True,holdAndMasksUnchanged=True,pinAndCheckerRemainPromoted=True,liveFiveUnchanged=True,ordinaryTimersUnchanged=True,automaticRetry=False,continuousFutureReaderExclusion=False,physicalBytesRecoveryQualification='Observed free-space changes include background activity and evidence; logical/allocated candidate bytes are not promised recovery.')
  durable(out/'completed.json',value);return value
 except BaseException as first:
  for number in old:signal.signal(number,signal.SIG_IGN)
  if apply and out.is_dir():
   try:durable(out/'failed.json',dict(schema='pow-audit30-exact-four-retirement-failed-v1',status='failed',planSha256=plan_sha,errorClass=type(first).__name__,phase=phase,currentTarget=current,completedTargets=completed,entryProgressCount=entrycount,lastEntryReceipt=latest,automaticRetry=False,partialRetirementRequiresNewExplicitReconciliation=True))
   except BaseException as error:raise RuntimeError('FAILURE_RECEIPT_UNAVAILABLE:'+type(first).__name__+'/'+type(error).__name__)from first
  raise
 finally:
  os.close(lock)
  for number,handler in old.items():signal.signal(number,handler)

def main():
 os.umask(0o077);need(sys.flags.isolated,'ISOLATED_PYTHON_REQUIRED');a=argparse.ArgumentParser();a.add_argument('mode',choices=['verify','apply']);a.add_argument('--plan',required=True);a.add_argument('--plan-sha256',required=True);a.add_argument('--approval');a.add_argument('--approval-sha256');args=a.parse_args();load(Path(__file__).parent/'custody.py');raw=root_read(args.plan,args.plan_sha256,mode=0o600);p=json.loads(raw,object_pairs_hook=pairs);result=execute(p,raw,args.plan_sha256,args.mode=='apply',args.approval,args.approval_sha256);print(json.dumps(result,sort_keys=True))
if __name__=='__main__':
 try:main()
 except BaseException as e:print(json.dumps(dict(status='refused',errorClass=type(e).__name__,rawDetailsSuppressed=True,automaticRetry=False)),file=sys.stderr);sys.exit(1)
