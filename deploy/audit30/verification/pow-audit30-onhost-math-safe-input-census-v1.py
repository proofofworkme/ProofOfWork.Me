#!/usr/bin/python3 -I
"""Proposed read-only stopped-stream metadata capture. Never exports COPY or marker values.

This source is not native-authorized. Its request requires separately reviewed
actual passed-stream intent/completion pins; the preparation template is refused.
No SQL, RPC, unit control, private-cluster start, or remote file writes occur.
"""
import base64,hashlib,json,os,pathlib,re,signal,stat,sys,time,types
P=pathlib.Path
PACKAGE=P('/usr/local/lib/proofofwork-audit30-onhost-math/v2')
JOB=P('/data/proofofwork-audit30-inspect-20261003T014100Z');STREAM=JOB/'stream-followup-v1'
UTILITY_SHA='379b387e33d08b421e126edd261f63b801d8326bdf24477e6a1a8c012c0e1988'
MANAGED_SHA='9c948257ac64de16fb221ac4288fefe1a5d51dc9802bd626862be83bd17acfd9'
COMPLETION_SHA='dc9e158445be2a176ef683ae7b3b5df40a44480f77ef9a57def85826d0225ff1'
MANIFEST_SHA='e904b0379dd6c80f68eebbb556b5bd5caa8619aa79df89f03ed16ebbeb6db977'
SOURCE_INVENTORY_SHA='aae198d18b0f5b347f25022f4c141b546aebf5f62d32e21cd72443ede5edd642'
SOURCE_FENCE_SHA='d9c08752be9e8e7c8d9ce4409b20496783901f116becbb26e205904dc676564b'
SUFFIXES=('.copy','.reconstructed.copy','.columns.json','.checkpoint.json','.marker.copy','.marker-value.json','.context.json')
LIVE=('bitcoind.service','electrs.service','postgresql@16-main.service','proofofwork-api.service','proofofwork-indexer-worker.service')
ROWS=[{'height':960600,'hash':'00000000000000000001ec938998cde4fd86ee6e3c672a6d3d95200cd8a984ac'},{'height':960601,'hash':'000000000000000000020205d5b0aa2d74e2eb5ec6d14dd3abf91132cffde4a2'},{'height':969526,'hash':'00000000000000000001c495201991943ae88860aeaca7db34c37e210e765ee0'}]
COLUMN_NAMES=('network','block_height','block_hash','previous_block_hash','model','state_commitment_model','opening_network_value_q8','closing_network_value_q8','opening_state_sha256','closing_state_sha256','opening_state_payload_bytes','closing_state_payload_bytes','protocol_record_count','raw_protocol_candidate_count','transaction_count','event_count','event_set_model','event_set_sha256','event_set_payload_bytes','block_atomic','fee_once','invalid_zero','complete','payload','created_at','work_token_state_model')
COLUMN_TYPES=((25,'text'),(23,'integer'),(25,'text'),(25,'text'),(25,'text'),(25,'text'),(1700,'numeric'),(1700,'numeric'),(25,'text'),(25,'text'),(23,'integer'),(23,'integer'),(23,'integer'),(23,'integer'),(23,'integer'),(23,'integer'),(25,'text'),(25,'text'),(23,'integer'),(16,'boolean'),(16,'boolean'),(16,'boolean'),(16,'boolean'),(3802,'jsonb'),(1184,'timestamp with time zone'),(25,'text'))
COLUMNS=[dict(name=n,typeOid=t[0],typeName=t[1])for n,t in zip(COLUMN_NAMES,COLUMN_TYPES)]
ENVELOPE=dict(rowBytes=33554432,sourceBytes=67108864,storeBytes=134217728,nativeRelationBytes=134217728,partCount=200000,seconds=120)
C=None;A=None
class Refused(Exception):pass
def need(v,code):
 if not v:raise Refused(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def digest(v):return sha(encoded(v))
def pairs(rows):
 d={}
 for k,v in rows:need(k not in d,'SAFE_CENSUS_DUPLICATE_JSON');d[k]=v
 return d
def parse(raw):return json.loads(raw,object_pairs_hook=pairs)
def exact(v,keys,code):need(isinstance(v,dict)and set(v)==set(keys),code)
def hex64(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)is not None
def same(a,b):return encoded(a)==encoded(b)
def cap(s):return 64*1024**2 if s in('.copy','.reconstructed.copy')else 2*1024**2 if s in('.marker.copy','.marker-value.json')else 1024**2

def validate_request(r):
 exact(r,('schema','utilityBase64','managedBase64','streamCompletedSha256','streamIntentSha256','nodeMetadata','attestorMetadata','publisherMetadata','liveFive'),'SAFE_CENSUS_REQUEST_KEYS')
 need(r['schema']=='pow-audit30-onhost-math-safe-input-request-v1'and hex64(r['streamCompletedSha256'])and hex64(r['streamIntentSha256']),'SAFE_CENSUS_ACTUAL_STREAM_PINS_REQUIRED')
 raws=[]
 for field,h in(('utilityBase64',UTILITY_SHA),('managedBase64',MANAGED_SHA)):
  try:raw=base64.b64decode(r[field],validate=True)
  except(ValueError,TypeError):raise Refused('SAFE_CENSUS_SOURCE_BASE64')
  need(0<len(raw)<=100000 and sha(raw)==h,'SAFE_CENSUS_EXACT_INERT_SOURCE');raws.append(raw)
 exact(r['liveFive'],LIVE,'SAFE_CENSUS_LIVE_NAMES')
 for row in r['liveFive'].values():
  exact(row,('MainPID','InvocationID'),'SAFE_CENSUS_LIVE_FIELDS');need(isinstance(row['MainPID'],str)and re.fullmatch('[1-9][0-9]*',row['MainPID'])and isinstance(row['InvocationID'],str)and re.fullmatch('[a-f0-9]{32}',row['InvocationID']),'SAFE_CENSUS_LIVE_SHAPE')
 stampkeys=('dev','ino','uid','gid','mode','nlink','bytes','mtimeNs','ctimeNs')
 for k in('nodeMetadata','attestorMetadata','publisherMetadata'):
  exact(r[k],stampkeys,'SAFE_CENSUS_TOOL_METADATA');need(type(r[k]['uid'])is int and type(r[k]['gid'])is int and type(r[k]['mode'])is int and all(isinstance(r[k][n],str)and re.fullmatch('[0-9]+',r[k][n])for n in stampkeys if n not in('uid','gid','mode')),'SAFE_CENSUS_TOOL_TYPES')
 return raws

def load(raws):
 global C,A
 C=types.ModuleType('safe_reviewed_utility');C.__file__='<reviewed379b>'
 exec(compile(raws[0],C.__file__,'exec'),C.__dict__)
 A=types.ModuleType('safe_reviewed_managed');A.__file__='<reviewed9c948>'
 exec(compile(raws[1],A.__file__,'exec'),A.__dict__);A.C=C
 need(C.PACKAGE==A.PACKAGE==PACKAGE and C.PG_UID==108 and C.PG_GID==112 and A.JOB==JOB and A.STREAM==STREAM and A.INPUT_SUFFIXES==SUFFIXES,'SAFE_CENSUS_INERT_IMPORT_SCOPE');C.DEADLINE=time.monotonic()+180

def read_authority(p,h,limit,uid,gid,mode):
 # Full metadata excludes only atime, which is neither used nor advanced.
 return A.read(p,h,limit,uid,gid,mode)

def file_hash(p,limit,uid=108,gid=112,mode=0o600):
 C.guard();m=p.lstat();need(p.resolve(strict=True)==p and stat.S_ISREG(m.st_mode)and m.st_nlink==1 and(m.st_uid,m.st_gid,stat.S_IMODE(m.st_mode))==(uid,gid,mode)and 0<m.st_size<=limit and not C.xattrs(p),'SAFE_CENSUS_CAPTURE_AUTHORITY')
 before=C.stamp(m);fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME);h=hashlib.sha256();n=0
 try:
  need(C.stamp(os.fstat(fd))==before,'SAFE_CENSUS_CAPTURE_FD_IDENTITY')
  while True:
   C.guard();b=os.read(fd,65536)
   if not b:break
   n+=len(b);need(n<=limit,'SAFE_CENSUS_CAPTURE_BOUND');h.update(b)
  need(n==m.st_size and C.stamp(os.fstat(fd))==before==C.stamp(p.lstat())and not C.xattrs(p),'SAFE_CENSUS_CAPTURE_CHANGED')
 finally:os.close(fd)
 return dict(bytes=n,sha256=h.hexdigest(),metadata=before)

def structural_read(s,row):
 need(s in('.columns.json','.checkpoint.json','.context.json'),'SAFE_CENSUS_STRUCTURAL_ALLOWLIST')
 raw=read_authority(STREAM/('native'+s),row['sha256'],cap(s),108,112,0o600)
 need(len(raw)==row['bytes'],'SAFE_CENSUS_STRUCTURAL_BYTES');return parse(raw)

def structural(context,columns,checkpoint,inputs):
 need(same(columns,COLUMNS),'SAFE_CENSUS_EXACT_HISTORICAL_COLUMNS')
 exact(context,('schema','privateJob','evidenceDirectory','prefix','basePlan','envelope','sourceFenceSha256','sourceSnapshot','sampleRows','fullColumns','markerJsonbSendSha256','sourceSha256','reconstructedSha256','fullByteEquality','bindings','precisionPins','mathAccepted','allHistoricalReplay'),'SAFE_CENSUS_CONTEXT_FIELDS')
 need(context['schema']=='pow-audit30-stream-native-oracle-inputs-v1'and context['privateJob']==str(JOB)and context['evidenceDirectory']==str(STREAM)and context['prefix']=='native','SAFE_CENSUS_CONTEXT_FIXED_SCOPE')
 need(context['sourceFenceSha256']==SOURCE_FENCE_SHA and same(context['envelope'],ENVELOPE)and same(context['sampleRows'],ROWS)and same(context['fullColumns'],COLUMNS),'SAFE_CENSUS_CONTEXT_MEASURED_SCOPE')
 need(context['fullByteEquality']is True and context['mathAccepted']is False and context['allHistoricalReplay']is False and context['precisionPins']=='Separate source-reviewed immutable-marker/arithmetic operator; not invented by codec','SAFE_CENSUS_NO_INVENTED_MATH')
 need(hex64(context['markerJsonbSendSha256'])and context['sourceSha256']==context['reconstructedSha256']==inputs['.copy']['sha256']and inputs['.copy']==inputs['.reconstructed.copy'],'SAFE_CENSUS_EXACT_NATIVE_HASHES')
 snapshot=dict(height=ROWS[-1]['height'],hash=ROWS[-1]['hash'],transitionHeight=ROWS[-1]['height'],transitionHash=ROWS[-1]['hash'])
 need(same(context['sourceSnapshot'],snapshot),'SAFE_CENSUS_EXACT_SAVED_SNAPSHOT')
 b=context['basePlan'];exact(b,('schema','privateJob','privateSocket','privatePort','sourceDatabase','network','checkpoint','sourceFenceSha256','sampleRows','columns','precisionMarkerJsonbSendSha256'),'SAFE_CENSUS_BASE_PLAN_KEYS')
 need(b['schema']=='pow-audit30-private-transition-prototype-plan-v1'and b['privateJob']==str(JOB)and b['privateSocket']==str(JOB/'socket')and type(b['privatePort'])is int and b['privatePort']==55432 and b['sourceDatabase']=='proof_indexer'and b['network']=='livenet'and b['sourceFenceSha256']==SOURCE_FENCE_SHA and same(b['checkpoint'],snapshot)and same(b['sampleRows'],ROWS)and same(b['columns'],COLUMNS)and b['precisionMarkerJsonbSendSha256']==context['markerJsonbSendSha256'],'SAFE_CENSUS_BASE_PLAN_SCOPE')
 expected=[dict(fileName='native'+s,bytes=inputs[s]['bytes'],sha256=inputs[s]['sha256'])for s in SUFFIXES if s!='.context.json']
 need(same(context['bindings'],expected),'SAFE_CENSUS_ALL_SIX_BINDINGS')
 sample_sha=sha(json.dumps(ROWS,separators=(',',':')).encode())
 want=dict(network='livenet',height=ROWS[-1]['height'],hash=ROWS[-1]['hash'],sourceFenceSha256=SOURCE_FENCE_SHA,sampleRowKeysSha256=sample_sha)
 need(same(checkpoint,want),'SAFE_CENSUS_EXACT_CHECKPOINT')
 return True

def fence(r):
 C.check_tools(r);C.reserve();C.package_fence();need(sha(C.attest())==C.ATTESTATION,'SAFE_CENSUS_WHOLE_CANDIDATE');A.live(r['liveFive']);A.stopped();A.metadata_dir(STREAM,108,112,0o700)
 source_raw=read_authority(PACKAGE/A.SOURCE_COMPLETION,COMPLETION_SHA,65536,0,0,0o600);source=parse(source_raw);A.validate_source_completion(source,dict(sourceCopyManifestSha256=MANIFEST_SHA))
 manifest_raw=read_authority(PACKAGE/'source-copy-manifest.json',MANIFEST_SHA,32*1024**2,0,112,0o440);manifest=parse(manifest_raw)
 need(manifest.get('sourceInventorySHA256')==SOURCE_INVENTORY_SHA and manifest.get('candidateAttestationSHA256')==C.ATTESTATION,'SAFE_CENSUS_SOURCE_MANIFEST_BINDING')
 copied={k:manifest[k]for k in('entries','entryCount','regularBytes')};need(C.inventory_tree(C.DEST)==copied,'SAFE_CENSUS_SOURCE_TREE_CHANGED')
 done_raw=read_authority(STREAM/'completed.json',r['streamCompletedSha256'],8*1024**2,108,112,0o600);intent_raw=read_authority(STREAM/'intent.json',r['streamIntentSha256'],8*1024**2,108,112,0o600);done=parse(done_raw);intent=parse(intent_raw);A.validate_stream(done,intent)
 return dict(sourceCompletion=sha(source_raw),sourceManifest=sha(manifest_raw),copyTreeSha256=digest(copied),streamCompleted=sha(done_raw),streamIntent=sha(intent_raw),streamDirectory=A.metadata_dir(STREAM,108,112,0o700))

def collect(r):
 before=fence(r);captures={s:file_hash(STREAM/('native'+s),cap(s))for s in SUFFIXES};inputs={s:{k:captures[s][k]for k in('bytes','sha256')}for s in SUFFIXES}
 need(inputs['.copy']==inputs['.reconstructed.copy'],'SAFE_CENSUS_BYTE_STORE_NOT_EQUAL')
 columns=structural_read('.columns.json',captures['.columns.json']);checkpoint=structural_read('.checkpoint.json',captures['.checkpoint.json']);context=structural_read('.context.json',captures['.context.json']);structural(context,columns,checkpoint,inputs)
 # All outputs are closed structural schemas; marker JSON/COPY are only hashed.
 after=fence(r);need(before==after,'SAFE_CENSUS_FINAL_AUTHORITY_CHANGED')
 repeated={s:file_hash(STREAM/('native'+s),cap(s))for s in SUFFIXES};need(captures==repeated,'SAFE_CENSUS_FINAL_INPUT_CHANGED');A.live(r['liveFive']);A.stopped();C.check_tools(r)
 safe=dict(schema='pow-audit30-onhost-math-safe-input-census-v1',context=context,columns=columns,checkpoint=checkpoint,inputs=inputs,sourceCopyCompletionSha256=COMPLETION_SHA,sourceCopyManifestSha256=MANIFEST_SHA,streamCompletedSha256=r['streamCompletedSha256'],streamIntentSha256=r['streamIntentSha256'],nodeMetadata=r['nodeMetadata'],attestorMetadata=r['attestorMetadata'],publisherMetadata=r['publisherMetadata'],liveFive=r['liveFive'])
 result=dict(schema='pow-audit30-onhost-math-safe-input-capture-v1',status='passed',safeInputCensus=safe,safeInputCensusSha256=digest(safe),captureMetadata=captures,authority=before,sourceAndInputsRepeatedlyUnchanged=True,privateClusterCurrentlyStopped=True,liveFiveCurrentlyUnchanged=True,copyOrMarkerValueExported=False,sqlOrCoreInvoked=False,unitControlled=False,remoteFilesWritten=False,mathAccepted=False,qualification='Structural metadata and raw-file hashes only. No arithmetic, whole-genesis, skipped-interval or production-repair acceptance.')
 need(len(encoded(result))<=128*1024,'SAFE_CENSUS_OUTPUT_CAP');return result

def main():
 need(os.geteuid()==os.getegid()==0 and sys.flags.isolated and len(sys.argv)==2 and hex64(sys.argv[1])and os.uname().nodename=='pow-bitcoin-01','SAFE_CENSUS_ROOT_FIXED_TRANSPORT')
 old={s:signal.getsignal(s)for s in(signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGALRM)}
 def interrupted(s,f):raise Refused('SAFE_CENSUS_SIGNAL_OR_180S_DEADLINE')
 for s in old:signal.signal(s,interrupted)
 signal.setitimer(signal.ITIMER_REAL,180)
 try:
  raw=sys.stdin.buffer.read(1024**2+1);need(0<len(raw)<=1024**2 and sha(raw)==sys.argv[1],'SAFE_CENSUS_RAW_REQUEST_PIN');r=parse(raw);need(encoded(r)==raw,'SAFE_CENSUS_CANONICAL_REQUEST');raws=validate_request(r);load(raws);return collect(r)
 finally:
  signal.setitimer(signal.ITIMER_REAL,0)
  for s,h in old.items():signal.signal(s,h)
if __name__=='__main__':
 try:result=main()
 except BaseException as e:
  code=str(e)if isinstance(e,Refused)or(C is not None and isinstance(e,C.Refused))or(A is not None and isinstance(e,A.Refused))else type(e).__name__
  print(json.dumps(dict(status='refused',code=code,productionMutation=False,privatePayloadExported=False)));sys.exit(1)
 print(encoded(result).decode())
