#!/usr/bin/python3 -I
"""Exact private-clone streaming capture/binary COPY side-schema proposal driver."""
import argparse,datetime,hashlib,json,os,pwd,re,selectors,signal,stat,struct,subprocess,sys,time,types
from pathlib import Path
CODEC_NAME='pow-audit30-transition-stream-codec-v2.py'
# Freeze this SHA after source review; loading unpinned mutable code is refused.
CODEC_SHA='3fe9dd87f9f5638b02be858b44c535c1431b1af1e8e4f9d60a1afe295f5179f0'
SCHEMA='audit30_transition_stream_chunks_v1';PLAN_SCHEMA='pow-audit30-private-transition-stream-plan-v1'
JOB_RE=re.compile(r'/data/proofofwork-audit30-inspect-(\d{8}T\d{6}Z)\Z');SHA=re.compile(r'[0-9a-f]{64}\Z');META_MAX=65536
C=None
def need(ok,msg):
 if not ok:raise ValueError(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def ident(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def load_codec():
 global C
 path=Path(__file__).absolute().with_name(CODEC_NAME);before=path.lstat();need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and not before.st_mode&0o022 and before.st_size<=65536 and path.resolve(strict=True)==path,'Unsafe codec module');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  need(ident(os.fstat(f.fileno()))==ident(before),'Codec changed before open');raw=f.read(65537);need(ident(os.fstat(f.fileno()))==ident(before),'Codec changed during read')
 need(ident(path.lstat())==ident(before) and len(raw)<=65536 and sha(raw)==CODEC_SHA,'Pinned codec bytes changed');C=types.ModuleType('stream_codec');C.__file__=str(path);exec(compile(raw,str(path),'exec'),C.__dict__);return C

def binding(path,maximum):
 p,s,f=C.safe_input(path,maximum);h=hashlib.sha256()
 with f:
  while True:
   b=f.read(65536)
   if not b:break
   h.update(b)
  C.fence(p,s,f)
 return {'path':str(p),'bytes':s.st_size,'sha256':h.hexdigest(),'identity':list(C.identity(s))}
def validate(plan):
 need(isinstance(plan,dict) and set(plan)=={'schema','base','originalTriggers','envelope','admission','profileBinding'} and plan['schema']==PLAN_SCHEMA,'Exact streaming plan shape');base=plan['base']
 need(isinstance(base,dict) and set(base)=={'schema','privateJob','privateSocket','privatePort','sourceDatabase','network','checkpoint','sourceFenceSha256','sampleRows','columns','precisionMarkerJsonbSendSha256'} and base['schema']=='pow-audit30-private-transition-prototype-plan-v1','Base plan shape');job=base['privateJob'];match=JOB_RE.fullmatch(job) if isinstance(job,str)else None
 need(match is not None,'New admitted inspector clone job');need(datetime.datetime.strptime(match[1],'%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ')==match[1],'Job calendar');need(base['privateSocket']==job+'/socket' and base['privatePort']==55432 and base['sourceDatabase']=='proof_indexer' and base['network']=='livenet','Exact private PG scope');cp=base['checkpoint'];rows=base['sampleRows']
 need(isinstance(cp,dict) and set(cp)=={'height','hash','transitionHeight','transitionHash'} and type(cp['height'])is int and type(cp['transitionHeight'])is int and 960601<cp['transitionHeight']<=cp['height'] and all(isinstance(cp[k],str)and SHA.fullmatch(cp[k])for k in ['hash','transitionHash']),'Saved checkpoint');need(isinstance(rows,list)and len(rows)==3 and rows[-1]=={'height':cp['transitionHeight'],'hash':cp['transitionHash']},'Exact three sample keys');need(all(isinstance(base[k],str)and SHA.fullmatch(base[k])for k in ['sourceFenceSha256','precisionMarkerJsonbSendSha256']),'Source and marker pins')
 cols=encoded(base['columns']);samples=json.dumps(rows,separators=(',',':')).encode();checkpoint=encoded({'network':'livenet','height':cp['height'],'hash':cp['hash'],'sourceFenceSha256':base['sourceFenceSha256'],'sampleRowKeysSha256':sha(samples)});C.metadata(cols,checkpoint,samples)
 triggers=plan['originalTriggers'];expected=[('proof_indexer.meta','work_precision_v2_marker_immutable'),('proof_indexer.work_amo_block_transitions','work_amo_block_transitions_immutable')]
 need(isinstance(triggers,list) and len(triggers)==2 and [(x.get('table'),x.get('name'))for x in triggers]==expected and all(set(x)=={'table','name','enabled','definition','functionDefinition'} and x['enabled']=='O' and all(isinstance(x[k],str)and 0<len(x[k])<=32768 for k in ['definition','functionDefinition'])for x in triggers) and len(encoded(triggers))<=65536,'Exact original immutable triggers')
 profile=None;profile_sha=None;pb=plan['profileBinding']
 if pb is not None:
  need(isinstance(pb,dict)and set(pb)=={'path','sha256'} and isinstance(pb['path'],str)and JOB_RE.fullmatch(str(Path(pb['path']).parent))and Path(pb['path']).name=='phase5-row-size-preflight.json' and isinstance(pb['sha256'],str)and SHA.fullmatch(pb['sha256']),'Actual measured profile binding');profile,profile_raw=C.small_json(pb['path'],pb['sha256'],1024**2);profile_sha=sha(profile_raw)
 e=C.limits(plan['envelope'],plan['admission'],profile,profile_sha,rows);return base,cols,checkpoint,samples,e,profile,profile_sha

def literal(s):return "'"+s.replace("'","''")+"'"
def selection(base):return "SELECT t.* FROM proof_indexer.work_amo_block_transitions t JOIN (VALUES "+','.join('('+str(r['height'])+','+literal(r['hash'])+')'for r in base['sampleRows'])+") AS wanted(height,hash) ON t.block_height=wanted.height AND t.block_hash=wanted.hash WHERE t.network='livenet' ORDER BY t.network,t.block_height,t.block_hash"
def sql_guard(plan,readonly):
 base,cols,cpraw,samples,e,profile,profile_sha=validate(plan);cp=base['checkpoint'];sel=selection(base);triggers="(SELECT jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid),'functionDefinition',pg_get_functiondef(tgfoid)) ORDER BY tgrelid::regclass::text,tgname) FROM pg_trigger WHERE (tgrelid='proof_indexer.work_amo_block_transitions'::regclass AND tgname='work_amo_block_transitions_immutable') OR (tgrelid='proof_indexer.meta'::regclass AND tgname='work_precision_v2_marker_immutable'))"
 sql="\\set ON_ERROR_STOP on\nBEGIN"+(' ISOLATION LEVEL REPEATABLE READ READ ONLY'if readonly else ' READ WRITE')+";\nSET LOCAL search_path=pg_catalog,pg_temp; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='1s'; SET LOCAL temp_file_limit='32MB'; SET LOCAL work_mem='8MB';\nDO $guard$ BEGIN\n"
 sql+=" IF current_setting('server_version_num')::integer NOT BETWEEN160000 AND169999 OR current_setting('listen_addresses')<>'' OR current_setting('unix_socket_directories')<>"+literal(base['privateSocket'])+" OR current_setting('port')<>'55432' OR current_setting('data_directory')<>"+literal(base['privateJob']+'/cluster')+" OR current_setting('default_transaction_read_only')<>'on' OR current_setting('transaction_read_only')<>"+literal('on'if readonly else'off')+" OR current_database()<>'proof_indexer' OR current_user<>'postgres' OR current_setting('server_encoding')<>'UTF8' OR current_setting('data_checksums')<>'on' THEN RAISE EXCEPTION 'PRIVATE_PG_IDENTITY_REFUSAL'; END IF;\n"
 sql+=" IF NOT EXISTS(SELECT1 FROM proof_indexer.blocks WHERE network='livenet' AND canonical AND height="+str(cp['height'])+" AND block_hash="+literal(cp['hash'])+") OR(SELECT max(height)FROM proof_indexer.blocks WHERE network='livenet'AND canonical)<>"+str(cp['height'])+" OR(SELECT max(block_height)FROM proof_indexer.work_amo_block_transitions WHERE network='livenet')<>"+str(cp['transitionHeight'])+" OR NOT EXISTS(SELECT1 FROM proof_indexer.work_amo_block_transitions WHERE network='livenet'AND block_height="+str(cp['transitionHeight'])+" AND block_hash="+literal(cp['transitionHash'])+") THEN RAISE EXCEPTION 'SAVED_CHECKPOINT_REFUSAL'; END IF;\n"
 sql+=" IF(SELECT jsonb_agg(jsonb_build_object('name',attname,'typeOid',atttypid::integer,'typeName',format_type(atttypid,atttypmod))ORDER BY attnum)FROM pg_attribute WHERE attrelid='proof_indexer.work_amo_block_transitions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM "+literal(cols.decode())+"::jsonb THEN RAISE EXCEPTION 'COLUMN_LAYOUT_REFUSAL'; END IF;\n"
 sql+=" IF(SELECT encode(sha256(jsonb_send(value)),'hex')FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet') IS DISTINCT FROM "+literal(base['precisionMarkerJsonbSendSha256'])+" OR NOT EXISTS(SELECT1 FROM proof_indexer.meta WHERE key='workPrecisionV2Migration:livenet' AND value->>'status'='complete'AND value->>'activationHeight'='960601') THEN RAISE EXCEPTION 'MARKER_REFUSAL'; END IF;\n"
 sql+=" IF "+triggers+" IS DISTINCT FROM "+literal(encoded(plan['originalTriggers']).decode())+"::jsonb THEN RAISE EXCEPTION 'ORIGINAL_TRIGGER_REFUSAL'; END IF;\n"
 sql+=" IF(SELECT count(*)FROM("+sel+")x)<>3 OR EXISTS(SELECT1 FROM("+sel+")x WHERE octet_length(record_send(x))+32>"+str(e['rowBytes'])+") OR(SELECT coalesce(sum(octet_length(record_send(x))+32),0)FROM("+sel+")x)+21>"+str(e['sourceBytes'])+" THEN RAISE EXCEPTION 'MEASURED_CAPTURE_CAP'; END IF;\nEND $guard$;\n"
 return sql.replace('BETWEEN160000 AND169999','BETWEEN 160000 AND 169999').replace('SELECT1','SELECT 1')
def capture_sql(plan):
 base,*_=validate(plan);return sql_guard(plan,True)+'\\copy ('+selection(base)+') TO STDOUT WITH (FORMAT binary)\nCOMMIT;\n'

def new_file(path):
 p=Path(path);need(p.absolute()==p and p.parent.resolve(strict=True)==p.parent,'Output path noncanonical');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:C.sync_parent(p)
 except BaseException:os.close(fd);raise
 return os.fdopen(fd,'wb')
def copy_header(f):f.write(C.MAGIC+struct.pack('!II',0,0))
def copy_row(f,values):
 f.write(struct.pack('!h',len(values)))
 for v in values:
  need(v is None or isinstance(v,bytes)and len(v)<=65536,'Spool field bound');f.write(struct.pack('!i',-1 if v is None else len(v)))
  if v is not None:f.write(v)
def copy_end(f):f.write(b'\xff\xff');f.flush();os.fsync(f.fileno())
def prepare_spools(plan,store,store_sha):
 base,cols,checkpoint,samples,e,profile,profile_sha=validate(plan);before=binding(store,e['storeBytes']);need(before['sha256']==store_sha,'Store input SHA');C.reconstruct(store,envelope=e,admission=plan['admission'],profile=profile,profile_sha=profile_sha);p,s,db=C.open_store(store);paths={n:Path(base['privateJob'])/('stream-'+n+'.copy')for n in ['chunks','parts','capture-meta']};deadline=C.Deadline(e['seconds']);meta=None
 try:
  r,se,framing=C.captured(db);need(se==e and r[5]==cols and r[6]==checkpoint and r[7]==samples,'Side store source plan metadata differs');meta={'sourceBytes':r[3],'sourceSha256':r[2],'partCount':r[4],'columnsSha256':sha(cols),'checkpointSha256':sha(checkpoint),'samplesSha256':sha(samples),'chunkModel':C.SCHEMA}
  with new_file(paths['chunks'])as f:
   copy_header(f)
   for h,size,body in db.execute('SELECT sha256,bytes,body FROM chunks ORDER BY sha256'):
    deadline.check();need(isinstance(body,bytes) and 0<size<=65536 and len(body)==size and sha(body)==h,'Spool chunk hash');copy_row(f,[bytes.fromhex(h),struct.pack('!i',size),body])
   copy_end(f)
  with new_file(paths['parts'])as f:
   copy_header(f);n=0
   for ordinal,h in db.execute('SELECT ordinal,sha256 FROM parts ORDER BY ordinal'):
    deadline.check();need(ordinal==n and n<r[4],'Spool part order');copy_row(f,[struct.pack('!i',ordinal),bytes.fromhex(h)]);n+=1
   need(n==r[4],'Spool part count');copy_end(f)
  with new_file(paths['capture-meta'])as f:
   copy_header(f);copy_row(f,[b'\x01',bytes.fromhex(r[2]),struct.pack('!i',r[3]),struct.pack('!i',r[4]),cols,checkpoint,samples,encoded(e),C.SCHEMA.encode()]);copy_end(f)
  C.fence(p,s);need(binding(store,e['storeBytes'])==before,'Store changed during spooling')
 finally:db.close()
 result={n:binding(p,e['storeBytes']+16*1024**2)for n,p in paths.items()};return {'schema':'pow-audit30-stream-native-spools-v1','meta':meta,'files':result,'storeBinding':before}

def validate_spools(plan,spools,rehash=True):
 base,cols,checkpoint,samples,e,_,_=validate(plan);need(isinstance(spools,dict)and set(spools)=={'schema','meta','files','storeBinding'}and spools['schema']=='pow-audit30-stream-native-spools-v1' and set(spools['files'])=={'chunks','parts','capture-meta'},'Exact spool manifest')
 for n,row in spools['files'].items():
  expected=Path(base['privateJob'])/('stream-'+n+'.copy');need(row['path']==str(expected) and binding(expected,e['storeBytes']+16*1024**2)==row,'Spool path/hash/identity changed')
 m=spools['meta'];need(set(m)=={'sourceBytes','sourceSha256','partCount','columnsSha256','checkpointSha256','samplesSha256','chunkModel'} and m['columnsSha256']==sha(cols)and m['checkpointSha256']==sha(checkpoint)and m['samplesSha256']==sha(samples)and m['chunkModel']==C.SCHEMA and isinstance(m['sourceSha256'],str)and SHA.fullmatch(m['sourceSha256']) and type(m['sourceBytes'])is int and 0<m['sourceBytes']<=e['sourceBytes']and type(m['partCount'])is int and 0<m['partCount']<=e['partCount'],'Spool capture source binding')
 need(isinstance(spools['storeBinding'],dict) and spools['storeBinding'].get('path')==base['privateJob']+'/stream-chunks.sqlite','Exact side store location')
 if rehash:need(binding(spools['storeBinding']['path'],e['storeBytes'])==spools['storeBinding'],'Side store identity/hash changed')
 return m

def side_sql(plan,spools):
 base,cols,checkpoint,samples,e,_,_=validate(plan);m=validate_spools(plan,spools)
 sql=sql_guard(plan,False)+f'''CREATE SCHEMA {SCHEMA};
CREATE TABLE {SCHEMA}.chunks(sha bytea PRIMARY KEY CHECK(octet_length(sha)=32),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND65536),body bytea NOT NULL CHECK(octet_length(body)=bytes AND sha256(body)=sha));
CREATE TABLE {SCHEMA}.parts(ordinal integer PRIMARY KEY CHECK(ordinal BETWEEN 0 AND {e['partCount']-1}),sha bytea NOT NULL REFERENCES {SCHEMA}.chunks(sha));
CREATE TABLE {SCHEMA}.capture(singleton boolean PRIMARY KEY CHECK(singleton),source_sha bytea NOT NULL CHECK(octet_length(source_sha)=32),source_bytes integer NOT NULL CHECK(source_bytes BETWEEN 1 AND {e['sourceBytes']}),part_count integer NOT NULL CHECK(part_count BETWEEN 1 AND {e['partCount']}),columns_raw bytea NOT NULL,checkpoint_raw bytea NOT NULL,samples_raw bytea NOT NULL,envelope_raw bytea NOT NULL,model text NOT NULL);
CREATE FUNCTION {SCHEMA}.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$ BEGIN RAISE EXCEPTION 'STREAM_STORE_IMMUTABLE'; END $immutable$;
CREATE FUNCTION {SCHEMA}.unsealed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $unsealed$ BEGIN IF EXISTS(SELECT1 FROM {SCHEMA}.capture) THEN RAISE EXCEPTION 'STREAM_STORE_SEALED'; END IF; RETURN NEW; END $unsealed$;
CREATE FUNCTION {SCHEMA}.seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $seal$ BEGIN
 IF EXISTS(SELECT1 FROM {SCHEMA}.capture) OR NEW.source_bytes<>{m['sourceBytes']} OR encode(NEW.source_sha,'hex')<>{literal(m['sourceSha256'])} OR NEW.part_count<>{m['partCount']} OR sha256(NEW.columns_raw)<>decode({literal(m['columnsSha256'])},'hex') OR sha256(NEW.checkpoint_raw)<>decode({literal(m['checkpointSha256'])},'hex') OR sha256(NEW.samples_raw)<>decode({literal(m['samplesSha256'])},'hex') OR NEW.envelope_raw<>decode({literal(encoded(e).hex())},'hex') OR NEW.model<>{literal(C.SCHEMA)} THEN RAISE EXCEPTION 'STREAM_META_REFUSAL'; END IF;
 IF(SELECT count(*) FROM {SCHEMA}.parts)<>NEW.part_count OR(SELECT min(ordinal)FROM {SCHEMA}.parts)<>0 OR(SELECT max(ordinal)FROM {SCHEMA}.parts)<>NEW.part_count-1 OR(SELECT sum(c.bytes)FROM {SCHEMA}.parts p JOIN {SCHEMA}.chunks c USING(sha))<>NEW.source_bytes OR(SELECT count(*)FROM {SCHEMA}.chunks)<>(SELECT count(DISTINCT sha)FROM {SCHEMA}.parts) THEN RAISE EXCEPTION 'STREAM_MANIFEST_REFUSAL'; END IF;
 IF(SELECT sum(pg_total_relation_size(c.oid))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname={literal(SCHEMA)}AND c.relkind='r')>{e['nativeRelationBytes']} THEN RAISE EXCEPTION 'STREAM_NATIVE_RELATION_CAP'; END IF; RETURN NEW; END $seal$;
CREATE TRIGGER capture_seal BEFORE INSERT ON {SCHEMA}.capture FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.seal();
'''
 for table in ['chunks','parts','capture']:sql+=f'CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON {SCHEMA}.{table} FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.immutable();\n'
 for table in ['chunks','parts']:sql+=f'CREATE TRIGGER unsealed BEFORE INSERT ON {SCHEMA}.{table} FOR EACH ROW EXECUTE FUNCTION {SCHEMA}.unsealed();\n'
 for n,table in [('chunks','chunks'),('parts','parts'),('capture-meta','capture')]:sql+='\\copy '+SCHEMA+'.'+table+' FROM '+literal(spools['files'][n]['path'])+' WITH (FORMAT binary)\n'
 sql+='COMMIT;\n';sql=sql.replace('AND65536','AND 65536').replace('SELECT1','SELECT 1');need(len(sql.encode())<=65536,'Generated side SQL cap');return sql

def export_sql(plan):
 validate(plan);return sql_guard(plan,True)+'\\copy (SELECT p.ordinal,c.bytes,c.body FROM '+SCHEMA+'.parts p JOIN '+SCHEMA+'.chunks c USING(sha) ORDER BY p.ordinal) TO STDOUT WITH (FORMAT binary)\nCOMMIT;\n'
def measurements_sql(plan):
 validate(plan);return sql_guard(plan,True)+"SELECT jsonb_build_object('sourceBytes',(SELECT source_bytes FROM "+SCHEMA+".capture),'sourceSha256',(SELECT encode(source_sha,'hex')FROM "+SCHEMA+".capture),'partCount',(SELECT part_count FROM "+SCHEMA+".capture),'chunkCount',(SELECT count(*)FROM "+SCHEMA+".chunks),'uniqueChunkBytes',(SELECT sum(bytes)FROM "+SCHEMA+".chunks),'schemaTotalBytes',(SELECT sum(pg_total_relation_size(c.oid))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+SCHEMA+"' AND c.relkind='r'),'relations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'heapBytes',pg_relation_size(c.oid),'indexesBytes',pg_indexes_size(c.oid),'tableWithToastBytes',pg_table_size(c.oid),'totalBytes',pg_total_relation_size(c.oid)) ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+SCHEMA+"' AND c.relkind='r'),'fullSourceHashVerifiedExternally',false);\nCOMMIT;\n"

def verify_export(plan,spools,export_path,output,source):
 base,cols,checkpoint,samples,e,profile,profile_sha=validate(plan);m=validate_spools(plan,spools);deadline=C.Deadline(e['seconds']);maximum=m['sourceBytes']+22*m['partCount']+21;f=None;original=None;out=None;sourcehash=hashlib.sha256();count=0;total=0
 try:
  p,s,f=C.safe_input(export_path,maximum);src,srcmeta,original=C.safe_input(source,e['sourceBytes']);need(srcmeta.st_size==m['sourceBytes'],'Original source size');out=new_file(output)
  r=C.Reader(f,maximum,deadline=deadline);need(r.exact(11)==C.MAGIC and r.exact(8)==b'\x00'*8,'Native export COPYheader');
  while True:
   n=struct.unpack('!h',r.exact(2))[0]
   if n==-1:break
   need(n==3 and count<m['partCount'],'Native export row count')
   need(struct.unpack('!i',r.exact(4))[0]==4,'Native ordinal width');ordinal=struct.unpack('!i',r.exact(4))[0];need(ordinal==count,'Native export ordinal gap/reorder')
   need(struct.unpack('!i',r.exact(4))[0]==4,'Native chunk size width');size=struct.unpack('!i',r.exact(4))[0];need(0<size<=65536 and struct.unpack('!i',r.exact(4))[0]==size,'Native chunk framing');body=r.exact(size);need(original.read(size)==body,'Native complete stream byte difference');out.write(body);sourcehash.update(body);total+=size;need(total<=m['sourceBytes'],'Native total cap');count+=1
  need(r.read(1)==b'' and count==m['partCount'] and total==m['sourceBytes'] and sourcehash.hexdigest()==m['sourceSha256'] and original.read(1)==b'','Native source hash/length/count');C.fence(p,s,f);C.fence(src,srcmeta,original);out.flush();os.fsync(out.fileno())
 finally:
  if f:f.close()
  if original:original.close()
  if out:out.close()
 proof=binding(output,e['sourceBytes']);need(proof['sha256']==m['sourceSha256'],'Native reconstruction SHA');p,s,f=C.safe_input(output,e['sourceBytes'])
 with f:framing=C.parse_copy(f,cols,checkpoint,samples,e);C.fence(p,s,f)
 return {'status':'native-stream-source-byte-equivalence-pass','fullByteEquality':True,'sourceSha256':m['sourceSha256'],'sourceBytes':total,'partCount':count,'framing':framing,'mathAccepted':False,'allHistoricalReplay':False,'newSideSchemaOnly':True}

class CaptureFailure(RuntimeError):
 def __init__(self,message,partial):super().__init__(message);self.partial=partial
STOP_REQUEST=None
def signal_stop(sig,_frame):
 global STOP_REQUEST
 STOP_REQUEST=signal.Signals(sig).name

def stream_child(argv,sql,output,maximum,seconds):
 """Bounded child/pipe supervisor. Caller owns whole-job Watchdog/PG shutdown."""
 global STOP_REQUEST
 need(isinstance(sql,bytes)and len(sql)<=65536 and type(maximum)is int and maximum>0 and type(seconds)is int and 0<seconds<=600,'Child input/output bounds');out=new_file(output);p=None;sel=selectors.DefaultSelector();digest=hashlib.sha256();stderr_hash=hashlib.sha256();count=0;stderr_count=0;start=time.monotonic();handlers={};success=False;reason=None
 try:
  for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]:handlers[sig]=signal.signal(sig,signal_stop)
  p=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8'});os.set_blocking(p.stdin.fileno(),False);os.set_blocking(p.stdout.fileno(),False);os.set_blocking(p.stderr.fileno(),False);sel.register(p.stdin,selectors.EVENT_WRITE,'stdin');sel.register(p.stdout,selectors.EVENT_READ,'stdout');sel.register(p.stderr,selectors.EVENT_READ,'stderr');pos=0
  while sel.get_map():
   if STOP_REQUEST:raise InterruptedError('Operator '+STOP_REQUEST)
   if time.monotonic()-start>seconds:raise TimeoutError('Private streaming child deadline')
   for key,_ in sel.select(.1):
    if key.data=='stdin':
     if pos==len(sql):sel.unregister(key.fileobj);key.fileobj.close();continue
     try:n=os.write(key.fileobj.fileno(),sql[pos:pos+65536]);pos+=n
     except BrokenPipeError:sel.unregister(key.fileobj);key.fileobj.close()
    else:
     raw=os.read(key.fileobj.fileno(),65536)
     if not raw:sel.unregister(key.fileobj);continue
     if key.data=='stdout':count+=len(raw);digest.update(raw);need(count<=maximum,'Private streaming stdout cap');out.write(raw)
     else:stderr_count+=len(raw);stderr_hash.update(raw);need(stderr_count<=8*1024**2,'Private stderr cap')
  rc=p.wait(timeout=2);need(rc==0 and stderr_count==0,'Private child failed/stderr');success=True
 except BaseException as exc:reason=type(exc).__name__+':'+str(exc);raise CaptureFailure(reason,{'status':'partial-private-stream-preserved','output':str(output),'writtenBytes':out.tell(),'observedStdoutBytes':count,'observedStdoutSha256':digest.hexdigest(),'stderrBytes':stderr_count,'stderrSha256':stderr_hash.hexdigest(),'seconds':time.monotonic()-start})from exc
 finally:
  # Repeated ordinary signals cannot skip cleanup. Only this child group is stopped.
  for sig in handlers:signal.signal(sig,signal.SIG_IGN)
  try:
   if p and p.poll()is None:
    try:os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:p.wait(timeout=2)
    except subprocess.TimeoutExpired:
     try:os.killpg(p.pid,signal.SIGKILL)
     except ProcessLookupError:pass
     p.wait(timeout=3)
  finally:
   if p:
    for pipe in [p.stdin,p.stdout,p.stderr]:
     if pipe and not pipe.closed:pipe.close()
   sel.close();out.flush();os.fsync(out.fileno());out.close()
   for sig,handler in handlers.items():signal.signal(sig,handler)
   STOP_REQUEST=None
 return {'status':'private-stream-captured','path':str(output),'bytes':count,'sha256':digest.hexdigest(),'seconds':time.monotonic()-start,'stderrBytes':stderr_count}

def psql(base):return ['/usr/lib/postgresql/16/bin/psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-h',base['privateSocket'],'-p','55432','-U','postgres','-d','proof_indexer','-f','-']
def main():
 load_codec();p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['emit-capture','capture','prepare-spools','emit-side','emit-export','export','emit-measurements','verify-export']);p.add_argument('--plan',required=True);p.add_argument('--plan-sha256',required=True);p.add_argument('--output',required=True);p.add_argument('--store');p.add_argument('--store-sha256');p.add_argument('--spools');p.add_argument('--spools-sha256');p.add_argument('--source');p.add_argument('--export');a=p.parse_args();plan,raw=C.small_json(a.plan,a.plan_sha256);base,cols,checkpoint,samples,e,profile,profile_sha=validate(plan);spools=C.small_json(a.spools,a.spools_sha256,1024**2)[0]if a.spools else None
 if a.mode.startswith('emit-'):
  sql={'emit-capture':lambda:capture_sql(plan),'emit-side':lambda:side_sql(plan,spools),'emit-export':lambda:export_sql(plan),'emit-measurements':lambda:measurements_sql(plan)}[a.mode]().encode()
  with new_file(a.output)as f:f.write(sql);f.flush();os.fsync(f.fileno())
  result={'status':'bounded-private-sql-emitted','file':binding(a.output,65536),'sideWritesOnly':a.mode=='emit-side'}
 elif a.mode=='prepare-spools':
  result=prepare_spools(plan,a.store,a.store_sha256)
  with new_file(a.output)as f:f.write(encoded(result));f.flush();os.fsync(f.fileno())
  result={'status':'private-binary-spools-prepared','manifest':binding(a.output,1024**2),'sourceSha256':result['meta']['sourceSha256']}
 elif a.mode=='verify-export':result=verify_export(plan,spools,a.export,a.output,a.source)
 else:
  need(os.geteuid()==pwd.getpwnam('postgres').pw_uid,'Native private capture requires postgres service role');is_capture=a.mode=='capture';need(Path(a.output).parent==Path(base['privateJob'])and Path(a.output).name==('stream-transitions-source.copy'if is_capture else'stream-ordered-export.copy'),'Exact private capture output');m=None if is_capture else validate_spools(plan,spools);maximum=e['sourceBytes']if is_capture else m['sourceBytes']+22*m['partCount']+21
  result=stream_child(psql(base),(capture_sql(plan)if is_capture else export_sql(plan)).encode(),a.output,maximum,e['seconds'])
  if is_capture:
   p,s,f=C.safe_input(a.output,e['sourceBytes'])
   with f:result['framing']=C.parse_copy(f,cols,checkpoint,samples,e);C.fence(p,s,f)
 print(json.dumps(result,sort_keys=True))
if __name__=='__main__':
 try:main()
 except CaptureFailure as exc:print(json.dumps(exc.partial,sort_keys=True));sys.exit(2)
