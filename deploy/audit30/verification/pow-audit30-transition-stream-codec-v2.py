#!/usr/bin/python3 -I
"""Streaming binary COPY side-store prototype. No connection or source mutation."""
import argparse,codecs,dataclasses,hashlib,json,os,re,sqlite3,stat,struct,time
from pathlib import Path
MAGIC=b'PGCOPY\n\xff\r\n\x00';SCHEMA='audit30-lossless-stream-copy-byte-cdc-v1'
SHA=re.compile(r'[0-9a-f]{64}\Z');BUFFER=65536;MINIMUM=4096;MASK=16383;MAXIMUM=65536
GEAR=tuple(int.from_bytes(hashlib.sha256(bytes([i])).digest()[:8],'big') for i in range(256))
LAYOUT=[('network','text'),('block_height','integer'),('block_hash','text'),('previous_block_hash','text'),('model','text'),('state_commitment_model','text'),('work_token_state_model','text'),('opening_network_value_q8','numeric'),('closing_network_value_q8','numeric'),('opening_state_sha256','text'),('closing_state_sha256','text'),('opening_state_payload_bytes','integer'),('closing_state_payload_bytes','integer'),('protocol_record_count','integer'),('raw_protocol_candidate_count','integer'),('transaction_count','integer'),('event_count','integer'),('event_set_model','text'),('event_set_sha256','text'),('event_set_payload_bytes','integer'),('block_atomic','boolean'),('fee_once','boolean'),('invalid_zero','boolean'),('complete','boolean'),('payload','jsonb'),('created_at','timestamp with time zone')]
OIDS={'text':25,'integer':23,'numeric':1700,'boolean':16,'jsonb':3802,'timestamp with time zone':1184}
COLUMNS=[dict(name=n,typeName=t,typeOid=OIDS[t]) for n,t in LAYOUT]
DEFAULT={'rowBytes':32*1024**2,'sourceBytes':64*1024**2,'storeBytes':128*1024**2,'nativeRelationBytes':128*1024**2,'partCount':200000,'seconds':120}
HISTORICAL_COLUMNS=[c.copy() for c in COLUMNS if c['name']!='work_token_state_model']+[next(c.copy() for c in COLUMNS if c['name']=='work_token_state_model')]
CEILING={'rowBytes':256*1024**2,'sourceBytes':768*1024**2,'storeBytes':2*1024**3,'nativeRelationBytes':2*1024**3,'partCount':500000,'seconds':600}
def need(ok,msg):
 if not ok:raise ValueError(msg)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def chunk_sha(raw):return sha(raw)
def encoded(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
def pairs(rows):
 d={}
 for k,v in rows:
  need(k not in d,'Duplicate JSON member');d[k]=v
 return d
def identity(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_nlink,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def sync_parent(path):
 p=Path(path).parent;need(p.absolute()==p and p.resolve(strict=True)==p,'Durable canonical parent');fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def safe_input(path,maximum):
 p=Path(path);s=p.lstat();need(p.absolute()==p and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not s.st_mode&0o022 and s.st_size<=maximum,'Unsafe regular input')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:need(identity(os.fstat(fd))==identity(s),'Input changed before open')
 except BaseException:os.close(fd);raise
 return p,s,os.fdopen(fd,'rb')
def fence(p,s,f=None):need(identity(p.lstat())==identity(s) and (f is None or identity(os.fstat(f.fileno()))==identity(s)),'Input identity changed')
def small_json(path,digest,maximum=65536):
 p,s,f=safe_input(path,maximum)
 with f:
  raw=f.read(maximum+1);fence(p,s,f)
 need(len(raw)<=maximum and SHA.fullmatch(digest) and sha(raw)==digest,'JSON input hash/size');return json.loads(raw,object_pairs_hook=pairs),raw

def metadata(columns_raw,checkpoint_raw,sample_raw):
 need(all(isinstance(x,bytes) and len(x)<=65536 for x in [columns_raw,checkpoint_raw,sample_raw]),'Metadata byte bound')
 cols=json.loads(columns_raw,object_pairs_hook=pairs);cp=json.loads(checkpoint_raw,object_pairs_hook=pairs);samples=json.loads(sample_raw,object_pairs_hook=pairs)
 need(cols in (COLUMNS,HISTORICAL_COLUMNS),'Exact26 PG16 create or migration-append column layout required')
 need(isinstance(cp,dict) and set(cp)=={'network','height','hash','sourceFenceSha256','sampleRowKeysSha256'} and cp['network']=='livenet' and type(cp['height']) is int and cp['height']>=960601 and all(isinstance(cp[k],str) and SHA.fullmatch(cp[k]) for k in ['hash','sourceFenceSha256','sampleRowKeysSha256']),'Saved checkpoint shape')
 need(isinstance(samples,list) and len(samples)==3 and all(isinstance(r,dict) and set(r)=={'height','hash'} and type(r['height']) is int and 0<r['height']<=cp['height'] and isinstance(r['hash'],str) and SHA.fullmatch(r['hash']) for r in samples),'Exact sample keys')
 need([r['height'] for r in samples][:2]==[960600,960601] and samples[2]['height']>960601 and sha(json.dumps(samples,separators=(',',':')).encode())==cp['sampleRowKeysSha256'],'Declaration activation latest sample fence')
 return cols,cp,samples

def limits(envelope=None,admission=None,profile=None,profile_sha=None,rows=None):
 e=dict(DEFAULT if envelope is None else envelope)
 need(set(e)==set(DEFAULT) and all(type(e[k]) is int and 0<e[k]<=CEILING[k] for k in e),'Envelope shape/ceiling')
 if any(e[k]>DEFAULT[k] for k in e):
  need(isinstance(admission,dict) and set(admission)=={'schema','approvedEnvelope','profileSha256','rows','profileMemoryPeakBytes','profileElapsedSeconds','approvalSha256'} and admission['schema']=='pow-audit30-stream-envelope-admission-v1','Larger envelope unadmitted')
  need(admission['approvedEnvelope']==e and admission['approvalSha256']=='6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820' and SHA.fullmatch(admission['profileSha256']) and profile_sha==admission['profileSha256'] and isinstance(profile,dict),'Measured larger-envelope proof missing')
  need(profile.get('rows')==admission['rows'] and isinstance(rows,list) and len(admission['rows'])==len(rows) and all(set(r)=={'height','hash','recordSendBytes','payloadStoredBytes'} and type(r['recordSendBytes']) is int and r['recordSendBytes']>0 and type(r['payloadStoredBytes']) is int and r['payloadStoredBytes']>0 for r in admission['rows']),'Actual row-size profile shape')
  need([{k:r[k] for k in ['height','hash']} for r in admission['rows']]==rows,'Measured sample differs')
  need(max(r['recordSendBytes']+32 for r in admission['rows'])<=e['rowBytes'] and sum(r['recordSendBytes']+32 for r in admission['rows'])+21<=e['sourceBytes'],'Measured sample exceeds envelope')
  resource=profile.get('resourceMeasurements');need(isinstance(resource,dict) and set(resource)=={'memoryPeakBytes','elapsedSeconds','memoryMaxBytes','jobMaxBytes','dataReserveBytes','rootReserveBytes'} and resource['memoryPeakBytes']==admission['profileMemoryPeakBytes'] and resource['elapsedSeconds']==admission['profileElapsedSeconds'] and resource['memoryMaxBytes']==8*1024**3 and resource['jobMaxBytes']==80*1024**3 and resource['dataReserveBytes']==100*1024**3 and resource['rootReserveBytes']==10*1024**3,'Actual profile resource telemetry/outer bounds not bound')
  need(type(admission['profileMemoryPeakBytes']) is int and 0<admission['profileMemoryPeakBytes']<=8*1024**3 and isinstance(admission['profileElapsedSeconds'],(int,float)) and not isinstance(admission['profileElapsedSeconds'],bool) and 0<admission['profileElapsedSeconds']<=3600,'Measured profile resource proof')
 return e

class Deadline:
 def __init__(self,seconds):self.end=time.monotonic()+seconds
 def check(self):
  if time.monotonic()>self.end:raise TimeoutError('Streaming deadline')
class Reader:
 def __init__(self,source,maximum,callback=None,deadline=None):self.f=source;self.maximum=maximum;self.total=0;self.hash=hashlib.sha256();self.callback=callback;self.deadline=deadline
 def read(self,n):
  need(0<=n<=BUFFER,'Read buffer bound')
  if self.deadline:self.deadline.check()
  raw=self.f.read(n);need(isinstance(raw,bytes) and len(raw)<=n,'Stream read shape');self.total+=len(raw);need(self.total<=self.maximum,'Source byte cap');self.hash.update(raw)
  if raw and self.callback:self.callback(raw)
  return raw
 def exact(self,n):
  need(0<=n<=BUFFER,'Exact buffer bound');out=bytearray()
  while len(out)<n:
   raw=self.read(n-len(out));need(raw,'Truncated COPY');out.extend(raw)
  return bytes(out)
 def values(self,n):
  while n:
   raw=self.exact(min(BUFFER,n));n-=len(raw);yield raw

class CDC:
 def __init__(self,emit,deadline):self.emit=emit;self.deadline=deadline;self.buf=bytearray();self.rolling=0
 def feed(self,raw):
  self.deadline.check()
  for b in raw:
   self.rolling=((self.rolling<<1)+GEAR[b])&((1<<64)-1);self.buf.append(b)
   if len(self.buf)>=MAXIMUM or len(self.buf)>=MINIMUM and self.rolling&MASK==0:self.flush()
 def flush(self):
  if self.buf:self.emit(bytes(self.buf));self.buf.clear();self.rolling=0

def parse_copy(source,columns_raw,checkpoint_raw,sample_raw,e,callback=None,deadline=None):
 cols,_,samples=metadata(columns_raw,checkpoint_raw,sample_raw);deadline=deadline or Deadline(e['seconds']);r=Reader(source,e['sourceBytes'],callback,deadline);need(r.exact(11)==MAGIC,'COPY signature');flags,ext=struct.unpack('!II',r.exact(8));need(flags==0 and ext<=1024,'COPY flags/extension');r.exact(ext);observed=[]
 while True:
  start=r.total;n=struct.unpack('!h',r.exact(2))[0]
  if n==-1:break
  need(n==26 and len(observed)<len(samples),'COPY26columns/sample count');fields=[];key={};payload_bytes=0
  for i,col in enumerate(cols):
   name,typ=col['name'],col['typeName']
   size=struct.unpack('!i',r.exact(4))[0];need(size>=-1 and size<=e['rowBytes'] and r.total-start+max(size,0)<=e['rowBytes'],'Row/field byte cap');fields.append(size)
   if size==-1:need(name=='work_token_state_model','Unexpected NULL field');continue
   if typ=='jsonb':
    need(size>=2 and r.exact(1)==b'\x01','JSONB version/payload length');decoder=codecs.getincrementaldecoder('utf-8')('strict');first=True;last_nonspace=''
    for raw in r.values(size-1):
     text=decoder.decode(raw,final=False)
     if first and text.strip():need(text.lstrip().startswith('{'),'Payload object envelope');first=False
     if text.strip():last_nonspace=text.rstrip()[-1]
    tail=decoder.decode(b'',final=True)
    if tail.strip():last_nonspace=tail.rstrip()[-1]
    need(not first and last_nonspace=='}','Payload object envelope');payload_bytes=size
   else:
    need(size<=65536,'Scalar field cap');raw=r.exact(size)
    if typ=='integer':need(size==4,'Int4 width');value=struct.unpack('!i',raw)[0];need(value>=0,'Negative integer field')
    elif typ=='boolean':need(raw==b'\x01','Complete/atomic boolean required')
    elif typ=='timestamp with time zone':need(size==8,'Timestamp width')
    elif typ=='numeric':
     need(size>=8 and size%2==0,'Numeric framing');digits,weight,sign,scale=struct.unpack('!HhHH',raw[:8]);need(size==8+2*digits and sign in (0,0x4000) and scale<=16383 and all(0<=v<10000 for(v,)in struct.iter_unpack('!H',raw[8:])),'Numeric width/digits')
    elif typ=='text':
     value=raw.decode('utf-8','strict');need('\x00' not in value,'Text NULL codepoint')
     if name in ['block_hash','previous_block_hash','opening_state_sha256','closing_state_sha256','event_set_sha256']:need(SHA.fullmatch(value),'Hash field shape')
    if name in ['network','block_height','block_hash']:key[name]=value
  need(key=={'network':'livenet','block_height':samples[len(observed)]['height'],'block_hash':samples[len(observed)]['hash']},'Ordered row key/source mismatch');observed.append({'height':key['block_height'],'hash':key['block_hash'],'copyRowBytes':r.total-start,'payloadBytes':payload_bytes,'fieldLengths':fields})
 need(len(observed)==len(samples),'Incomplete sample rows');need(r.read(1)==b'','Trailing COPY bytes');return {'sourceBytes':r.total,'sourceSha256':r.hash.hexdigest(),'layoutModel':'pg16-create-layout-v1' if cols==COLUMNS else 'pg16-migrated-append-layout-v1','columnLayoutRawSha256':sha(columns_raw),'rows':observed,'jsonSemanticValidation':False,'mathAccepted':False}

DDL='''PRAGMA foreign_keys=ON;
CREATE TABLE chunks(sha256 TEXT PRIMARY KEY CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 65536), body BLOB NOT NULL CHECK(bytes=length(body)));
CREATE TABLE parts(ordinal INTEGER PRIMARY KEY CHECK(ordinal>=0),sha256 TEXT NOT NULL REFERENCES chunks(sha256));
CREATE TABLE capture(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_bytes INTEGER NOT NULL,part_count INTEGER NOT NULL,columns_raw BLOB NOT NULL,checkpoint_raw BLOB NOT NULL,sample_raw BLOB NOT NULL,envelope_raw BLOB NOT NULL,framing_raw BLOB NOT NULL);
'''
for _table in ['chunks','parts','capture']:
 for _op in ['UPDATE','DELETE']:DDL+=f"CREATE TRIGGER {_table}_{_op.lower()} BEFORE {_op} ON {_table} BEGIN SELECT RAISE(ABORT,'immutable'); END;\n"
 DDL+=f"CREATE TRIGGER {_table}_late_insert BEFORE INSERT ON {_table} WHEN EXISTS(SELECT1 FROM capture) BEGIN SELECT RAISE(ABORT,'sealed'); END;\n".replace('SELECT1','SELECT 1')
def physical(target):return sum(p.lstat().st_blocks*512 for p in [Path(target),Path(str(target)+'-journal'),Path(str(target)+'-wal'),Path(str(target)+'-shm')] if p.exists())
def open_store(target):
 p=Path(target);s=p.lstat();need(p.absolute()==p and p.resolve(strict=True)==p and stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not s.st_mode&0o077,'Unsafe side store');db=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True);db.execute('PRAGMA query_only=ON');db.execute('PRAGMA cache_size=-4096');return p,s,db

def build(source,source_sha,columns_raw,checkpoint_raw,sample_raw,target,envelope=None,admission=None,profile=None,profile_sha=None):
 _,_,samples=metadata(columns_raw,checkpoint_raw,sample_raw);e=limits(envelope,admission,profile,profile_sha,samples);deadline=Deadline(e['seconds']);need(isinstance(source_sha,str) and SHA.fullmatch(source_sha),'Source hash shape');target=Path(target);need(target.absolute()==target and target.parent.resolve(strict=True)==target.parent,'Store canonical parent');p,s,f=safe_input(source,e['sourceBytes']);
 try:
  fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);os.close(fd);sync_parent(target);db=sqlite3.connect(target)
 except BaseException:f.close();raise
 count=0;occurrences=0;last_physical=0
 try:
  db.execute('PRAGMA synchronous=FULL');db.execute('PRAGMA cache_size=-4096');db.executescript(DDL);db.execute('BEGIN IMMEDIATE')
  def emit(body):
   nonlocal count,occurrences,last_physical
   deadline.check();need(count<e['partCount'] and 0<len(body)<=MAXIMUM,'Manifest/chunk bound');h=chunk_sha(body);previous=db.execute('SELECT bytes,body FROM chunks WHERE sha256=?',(h,)).fetchone()
   need(not previous or previous==(len(body),body),'Digest collision bytes differ')
   if not previous:db.execute('INSERT INTO chunks VALUES(?,?,?)',(h,len(body),body))
   db.execute('INSERT INTO parts VALUES(?,?)',(count,h));count+=1;occurrences+=len(body)
   if count-last_physical>=64:need(physical(target)<=e['storeBytes'],'Store physical cap');last_physical=count
  cdc=CDC(emit,deadline)
  with f:framing=parse_copy(f,columns_raw,checkpoint_raw,sample_raw,e,cdc.feed,deadline);fence(p,s,f)
  fence(p,s);need(framing['sourceSha256']==source_sha and framing['sourceBytes']==s.st_size,'Captured source hash/size differs');cdc.flush();need(occurrences==framing['sourceBytes'],'Stream occurrence parity');need(physical(target)<=e['storeBytes'],'Store physical cap')
  db.execute('INSERT INTO capture VALUES(?,?,?,?,?,?,?,?,?,?)',(1,SCHEMA,source_sha,framing['sourceBytes'],count,columns_raw,checkpoint_raw,sample_raw,encoded(e),encoded(framing)));db.commit();need(physical(target)<=e['storeBytes'],'Store physical cap');stats=dict(sourceBytes=framing['sourceBytes'],sourceSha256=source_sha,uniqueChunks=db.execute('SELECT count(*) FROM chunks').fetchone()[0],uniqueChunkBytes=db.execute('SELECT sum(bytes) FROM chunks').fetchone()[0],partCount=count,sqliteBytes=target.stat().st_size,sqliteAllocatedBytes=physical(target),framing=framing,envelope=e,model=SCHEMA)
 finally:
  if not f.closed:f.close()
  db.close();sync_parent(target)
 return stats

def captured(db):
 rows=db.execute('SELECT singleton,schema,source_sha256,source_bytes,part_count,columns_raw,checkpoint_raw,sample_raw,envelope_raw,framing_raw FROM capture').fetchall();need(len(rows)==1,'Unique sealed capture required');r=rows[0];need(len(r)==10 and r[0]==1 and r[1]==SCHEMA and isinstance(r[2],str) and SHA.fullmatch(r[2]),'Capture schema/hash');e=json.loads(r[8],object_pairs_hook=pairs)
 need(set(e)==set(DEFAULT) and all(type(e[k]) is int and 0<e[k]<=CEILING[k] for k in e),'Stored envelope shape');need(type(r[3]) is int and 0<r[3]<=e['sourceBytes'] and type(r[4]) is int and 0<r[4]<=e['partCount'],'Stored source/manifest cap');metadata(r[5],r[6],r[7]);return r,e,json.loads(r[9],object_pairs_hook=pairs)
def chunks(db,r,deadline):
 count=0;total=0;h=hashlib.sha256()
 for ordinal,hash_,size,body in db.execute('SELECT p.ordinal,c.sha256,c.bytes,c.body FROM parts p LEFT JOIN chunks c ON c.sha256=p.sha256 ORDER BY p.ordinal'):
  deadline.check();need(ordinal==count and isinstance(body,bytes) and type(size)is int and 0<size<=MAXIMUM and len(body)==size and chunk_sha(body)==hash_,'Part order/membership/chunk hash');count+=1;total+=size;need(count<=r[4] and total<=r[3],'Reconstruction cap');h.update(body);yield body
 need(count==r[4] and total==r[3] and h.hexdigest()==r[2],'Reconstruction full hash/length')
class ChunkReader:
 def __init__(self,iterator):self.it=iter(iterator);self.current=b'';self.pos=0;self.done=False
 def read(self,n):
  need(n<=BUFFER,'ChunkReader read bound');out=bytearray()
  while len(out)<n:
   if self.pos==len(self.current):
    try:self.current=next(self.it);self.pos=0
    except StopIteration:self.done=True;break
   take=min(n-len(out),len(self.current)-self.pos);out.extend(self.current[self.pos:self.pos+take]);self.pos+=take
  return bytes(out)
def reconstruct(target,output=None,source=None,envelope=None,admission=None,profile=None,profile_sha=None):
 p,s,db=open_store(target);rawsource=None;srcfile=None;out=None
 try:
  r,e,framing=captured(db);_,_,samples=metadata(r[5],r[6],r[7]);approved=limits(envelope,admission,profile,profile_sha,samples);need(e==approved,'Stored envelope differs from admitted envelope');need(physical(target)<=e['storeBytes'],'Store physical cap');deadline=Deadline(e['seconds']);srcmeta=None
  need(db.execute('SELECT count(*) FROM chunks').fetchone()[0]==db.execute('SELECT count(DISTINCT sha256) FROM parts').fetchone()[0] and not db.execute('PRAGMA foreign_key_check').fetchone(),'Unused or dangling chunk inventory')
  if source:rawsource,srcmeta,srcfile=safe_input(source,e['sourceBytes']);need(srcmeta.st_size==r[3],'Original source length differs')
  if output:
   output=Path(output);need(output.absolute()==output and output.parent.resolve(strict=True)==output.parent,'Output canonical parent');out=os.fdopen(os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb');sync_parent(output)
  def emit(body):
   if out:out.write(body)
   if srcfile:need(srcfile.read(len(body))==body,'Whole byte stream differs')
  result=parse_copy(ChunkReader(chunks(db,r,deadline)),r[5],r[6],r[7],e,emit,deadline);need(result==framing and result['sourceBytes']==r[3] and result['sourceSha256']==r[2],'Stored framing/source commitment differs')
  if srcfile:need(srcfile.read(1)==b'','Source trailing bytes');fence(rawsource,srcmeta,srcfile)
  if out:out.flush();os.fsync(out.fileno())
  fence(p,s);return dict(status='stream-byte-and-framing-equivalence-pass',**result,byteForByteSourceCompared=source is not None,chunkModel=SCHEMA)
 finally:
  if out:out.close()
  if srcfile:srcfile.close()
  db.close()

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['build','verify']);p.add_argument('--source');p.add_argument('--source-sha256');p.add_argument('--columns');p.add_argument('--columns-sha256');p.add_argument('--checkpoint');p.add_argument('--checkpoint-sha256');p.add_argument('--samples');p.add_argument('--samples-sha256');p.add_argument('--store',required=True);p.add_argument('--output');p.add_argument('--envelope');p.add_argument('--envelope-sha256');p.add_argument('--admission');p.add_argument('--admission-sha256');p.add_argument('--profile');p.add_argument('--profile-sha256');a=p.parse_args()
 envelope=small_json(a.envelope,a.envelope_sha256)[0] if a.envelope else None;admission=small_json(a.admission,a.admission_sha256)[0] if a.admission else None;profile=small_json(a.profile,a.profile_sha256,1024**2)[0] if a.profile else None
 if a.mode=='verify':result=reconstruct(a.store,a.output,a.source,envelope,admission,profile,a.profile_sha256)
 else:
  need(all([a.source,a.source_sha256,a.columns,a.columns_sha256,a.checkpoint,a.checkpoint_sha256,a.samples,a.samples_sha256]),'Build exact source/metadata bindings required');cols,colsraw=small_json(a.columns,a.columns_sha256);cp,cpraw=small_json(a.checkpoint,a.checkpoint_sha256);samples,samplesraw=small_json(a.samples,a.samples_sha256);envelope=small_json(a.envelope,a.envelope_sha256)[0] if a.envelope else None;admission=small_json(a.admission,a.admission_sha256)[0] if a.admission else None;profile=small_json(a.profile,a.profile_sha256,1024**2)[0] if a.profile else None
  result=build(a.source,a.source_sha256,colsraw,cpraw,samplesraw,a.store,envelope,admission,profile,a.profile_sha256);result['verification']=reconstruct(a.store,a.output,a.source,envelope,admission,profile,a.profile_sha256)
 print(json.dumps(result,sort_keys=True))
if __name__=='__main__':main()
