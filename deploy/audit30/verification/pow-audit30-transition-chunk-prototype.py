#!/usr/bin/python3 -I
"""Local side-store prototype; no DB/network connection and no source mutation."""
import argparse
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import resource
import sqlite3
import stat
import struct
import time

MAGIC=b'PGCOPY\n\xff\r\n\x00'
SOURCE_MAX=64*1024**2
ROW_MAX=32*1024**2
STORE_MAX=128*1024**2
META_MAX=64*1024
PART_MAX=200000
MINIMUM=4096
MASK=16383
MAXIMUM=65536
SCHEMA='audit30-lossless-binary-copy-content-chunks-v1'
GEAR=tuple(int.from_bytes(hashlib.sha256(bytes([i])).digest()[:8],'big') for i in range(256))

def digest(raw):return hashlib.sha256(raw).hexdigest()
def identity(st):return (st.st_dev,st.st_ino,st.st_mode,st.st_nlink,st.st_uid,st.st_gid,st.st_size,st.st_mtime_ns,st.st_ctime_ns)

def pairs(rows):
    out={}
    for k,v in rows:
        if k in out:raise ValueError('Duplicate JSON member')
        out[k]=v
    return out

def nonfinite(value):raise ValueError('Nonfinite JSON')
DECODER=json.JSONDecoder(parse_float=Decimal,object_pairs_hook=pairs,parse_constant=nonfinite)

def jsonb_segments(raw):
    if not raw or raw[0]!=1:raise ValueError('JSONB binary version must be one')
    text=raw[1:].decode('utf8','strict')
    parsed=DECODER.decode(text)
    if not isinstance(parsed,dict):raise ValueError('Transition payload must be object')
    # Exact lexical top-level value spans. Decode determines token boundaries;
    # bytes are sliced/encoded without serializing the parsed value.
    segments=[b'\x01'];pos=0;last=0
    def whitespace(i):
        while i<len(text) and text[i] in ' \t\r\n':i+=1
        return i
    pos=whitespace(pos)
    if text[pos]!='{':raise ValueError('Object opening missing')
    pos=whitespace(pos+1)
    while text[pos]!='}':
        key,end=DECODER.raw_decode(text,pos)
        if not isinstance(key,str):raise ValueError('JSON key invalid')
        pos=whitespace(end)
        if text[pos]!=':':raise ValueError('JSON colon missing')
        pos=whitespace(pos+1);start=pos
        _,end=DECODER.raw_decode(text,pos)
        segments.extend([text[last:start].encode('utf8'),text[start:end].encode('utf8')])
        last=end;pos=whitespace(end)
        if text[pos]==',':pos=whitespace(pos+1)
        elif text[pos]!='}':raise ValueError('JSON delimiter invalid')
    segments.append(text[last:].encode('utf8'))
    if b''.join(segments)!=raw:raise ValueError('Lexical segmentation lost bytes')
    return [x for x in segments if x]

def cdc(raw):
    start=0;rolling=0
    for i,b in enumerate(raw,1):
        rolling=((rolling<<1)+GEAR[b])&((1<<64)-1)
        n=i-start
        if n>=MAXIMUM or n>=MINIMUM and rolling&MASK==0:
            yield raw[start:i];start=i;rolling=0
    if start<len(raw):yield raw[start:]

def binary_parts(raw,payload_index):
    if len(raw)>SOURCE_MAX or len(raw)<21 or not raw.startswith(MAGIC):raise ValueError('Source COPY bound/header')
    flags,ext=struct.unpack_from('!II',raw,len(MAGIC))
    if flags!=0 or ext>1024 or len(raw)<19+ext:raise ValueError('Unsupported COPY flags/extension')
    pos=19+ext;yield raw[:pos]
    rows=0;field_count=None
    while True:
        if pos+2>len(raw):raise ValueError('Truncated row count')
        n=struct.unpack_from('!h',raw,pos)[0];yield raw[pos:pos+2];pos+=2
        if n==-1:
            if pos!=len(raw):raise ValueError('Trailing COPY data')
            break
        if n<1 or n>128 or field_count is not None and n!=field_count or not 0<=payload_index<n:raise ValueError('Wrong COPY field inventory')
        field_count=n;rows+=1;row_start=pos
        for index in range(n):
            if pos+4>len(raw):raise ValueError('Truncated field length')
            size=struct.unpack_from('!i',raw,pos)[0];yield raw[pos:pos+4];pos+=4
            if size<-1 or size>ROW_MAX or pos+max(0,size)>len(raw):raise ValueError('Unsafe field bound')
            if size==-1:
                if index==payload_index:raise ValueError('Missing transition payload')
                continue
            value=raw[pos:pos+size];pos+=size
            if index==payload_index:
                for segment in jsonb_segments(value):yield from cdc(segment)
            else:yield from cdc(value)
        if pos-row_start>ROW_MAX:raise ValueError('Row byte bound')
    if rows==0:raise ValueError('Empty sample cannot certify transitions')

DDL='''
PRAGMA foreign_keys=ON;
CREATE TABLE chunks(sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, body BLOB NOT NULL,
 CHECK(bytes=length(body)));
CREATE TABLE parts(ordinal INTEGER PRIMARY KEY,sha256 TEXT NOT NULL REFERENCES chunks(sha256));
CREATE TABLE capture(schema TEXT NOT NULL,source_sha256 TEXT NOT NULL,source_bytes INTEGER NOT NULL,
 columns_raw BLOB NOT NULL,columns_sha256 TEXT NOT NULL,payload_index INTEGER NOT NULL,
 part_count INTEGER NOT NULL,checkpoint_raw BLOB NOT NULL,checkpoint_sha256 TEXT NOT NULL);
CREATE TRIGGER chunks_no_update BEFORE UPDATE ON chunks BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER chunks_no_delete BEFORE DELETE ON chunks BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER chunks_no_late_insert BEFORE INSERT ON chunks WHEN EXISTS(SELECT 1 FROM capture)
 BEGIN SELECT RAISE(ABORT,'sealed'); END;
CREATE TRIGGER parts_no_update BEFORE UPDATE ON parts BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER parts_no_delete BEFORE DELETE ON parts BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER parts_no_late_insert BEFORE INSERT ON parts WHEN EXISTS(SELECT 1 FROM capture)
 BEGIN SELECT RAISE(ABORT,'sealed'); END;
CREATE TRIGGER capture_no_update BEFORE UPDATE ON capture BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER capture_no_delete BEFORE DELETE ON capture BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER capture_no_late_insert BEFORE INSERT ON capture WHEN EXISTS(SELECT 1 FROM capture)
 BEGIN SELECT RAISE(ABORT,'sealed'); END;
'''

def validate_metadata(columns_raw,checkpoint_raw,payload_index):
    if len(columns_raw)>META_MAX or len(checkpoint_raw)>META_MAX:raise ValueError('Metadata ceiling')
    columns=json.loads(columns_raw,object_pairs_hook=pairs);checkpoint=json.loads(checkpoint_raw,object_pairs_hook=pairs)
    if not isinstance(columns,list) or not 1<=len(columns)<=128 or any(not isinstance(c,dict) or set(c)!={'name','typeOid','typeName'} or type(c['typeOid']) is not int or c['typeOid']<=0 or not isinstance(c['name'],str) or not c['name'] or not isinstance(c['typeName'],str) or not c['typeName'] for c in columns):raise ValueError('Missing exact column/type metadata')
    if type(payload_index) is not int or not 0<=payload_index<len(columns):raise ValueError('Payload index outside layout')
    if len({c['name'] for c in columns})!=len(columns) or columns[payload_index]['name']!='payload' or columns[payload_index]['typeName']!='jsonb' or columns[payload_index]['typeOid']!=3802:raise ValueError('Wrong payload column/type')
    if not isinstance(checkpoint,dict) or set(checkpoint)!={'network','height','hash','sourceFenceSha256','sampleRowKeysSha256'} or checkpoint['network']!='livenet' or type(checkpoint['height']) is not int or checkpoint['height']<1 or any(not isinstance(checkpoint[k],str) or len(checkpoint[k])!=64 or any(c not in '0123456789abcdef' for c in checkpoint[k]) for k in ('hash','sourceFenceSha256','sampleRowKeysSha256')):raise ValueError('Missing independently admitted saved checkpoint/sample fence')
    return columns

def physical(target):
    return sum(p.stat().st_blocks*512 for p in (target,Path(str(target)+'-journal'),Path(str(target)+'-wal'),Path(str(target)+'-shm')) if p.exists())

def build(raw,columns_raw,checkpoint_raw,payload_index,target):
    started=time.monotonic();columns=validate_metadata(columns_raw,checkpoint_raw,payload_index)
    target=Path(target);fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600);os.close(fd)
    db=sqlite3.connect(target)
    try:
        db.execute('PRAGMA synchronous=FULL');db.execute('PRAGMA cache_size=-4096');db.executescript(DDL)
        count=0;chunk_occurrence_bytes=0
        for part in binary_parts(raw,payload_index):
            if time.monotonic()-started>30:raise TimeoutError('Prototype deadline')
            if count>=PART_MAX:raise ValueError('Manifest part ceiling')
            h=digest(part);existing=db.execute('SELECT body FROM chunks WHERE sha256=?',(h,)).fetchone()
            if existing and existing[0]!=part:raise ValueError('Chunk digest collision')
            if not existing:db.execute('INSERT INTO chunks VALUES(?,?,?)',(h,len(part),part))
            db.execute('INSERT INTO parts VALUES(?,?)',(count,h));count+=1;chunk_occurrence_bytes+=len(part)
            if physical(target)>STORE_MAX:raise ValueError('Prototype physical ceiling')
        # Independent COPY field count against capture metadata, not just index.
        ext=struct.unpack_from('!I',raw,15)[0]
        if struct.unpack_from('!h',raw,19+ext)[0]!=len(columns):raise ValueError('COPY columns differ from frozen layout')
        db.execute('INSERT INTO capture VALUES(?,?,?,?,?,?,?,?,?)',(SCHEMA,digest(raw),len(raw),columns_raw,digest(columns_raw),payload_index,count,checkpoint_raw,digest(checkpoint_raw)))
        db.commit()
        if physical(target)>STORE_MAX:raise ValueError('Prototype physical ceiling')
        stats=dict(sourceBytes=len(raw),uniqueChunkBytes=db.execute('SELECT sum(bytes) FROM chunks').fetchone()[0],uniqueChunks=db.execute('SELECT count(*) FROM chunks').fetchone()[0],partCount=count,occurrenceBytes=chunk_occurrence_bytes,sqliteFileBytes=target.stat().st_size,sqliteAllocatedBytes=target.stat().st_blocks*512,sqlitePages=db.execute('PRAGMA page_count').fetchone()[0],sqlitePageBytes=db.execute('PRAGMA page_size').fetchone()[0],elapsedSeconds=time.monotonic()-started)
    finally:db.close()
    restored=reconstruct(target)
    if restored!=raw:raise ValueError('Whole source stream bytes differ')
    return stats

def reconstruct(target):
    started=time.monotonic()
    target=Path(target)
    if target.is_symlink() or not stat.S_ISREG(target.lstat().st_mode) or target.stat().st_size>STORE_MAX:raise ValueError('Unsafe side store')
    db=sqlite3.connect(target.as_uri()+'?mode=ro',uri=True)
    try:
        cap=db.execute('SELECT * FROM capture').fetchall()
        if len(cap)!=1 or cap[0][0]!=SCHEMA:raise ValueError('Missing unique sealed capture')
        _,source_hash,source_bytes,columns_raw,columns_hash,payload_index,n,checkpoint_raw,checkpoint_hash=cap[0]
        if type(source_bytes) is not int or not 0<source_bytes<=SOURCE_MAX or digest(columns_raw)!=columns_hash or digest(checkpoint_raw)!=checkpoint_hash:raise ValueError('Capture binding corrupt')
        columns=validate_metadata(columns_raw,checkpoint_raw,payload_index)
        if type(n) is not int or not 0<n<=PART_MAX:raise ValueError('Manifest part ceiling')
        output=bytearray()
        rows=db.execute('SELECT p.ordinal,c.sha256,c.bytes,c.body FROM parts p LEFT JOIN chunks c ON c.sha256=p.sha256 ORDER BY p.ordinal')
        observed=0
        for ordinal,h,size,body in rows:
            if time.monotonic()-started>30:raise TimeoutError('Reconstruction deadline')
            if ordinal!=observed or not isinstance(body,bytes) or len(body)!=size or digest(body)!=h:raise ValueError('Part ordering/membership/hash corrupt')
            observed+=1;output.extend(body)
            if len(output)>SOURCE_MAX:raise ValueError('Reconstruction bound')
        if observed!=n or len(output)!=source_bytes or digest(output)!=source_hash:raise ValueError('Whole source commitment differs')
        reconstructed=bytes(output)
        ext=struct.unpack_from('!I',reconstructed,15)[0]
        if struct.unpack_from('!h',reconstructed,19+ext)[0]!=len(columns):raise ValueError('COPY columns differ from frozen layout')
        for _ in binary_parts(reconstructed,payload_index):
            if time.monotonic()-started>30:raise TimeoutError('Reconstruction deadline')
        return reconstructed
    finally:db.close()

def main():
    resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2))
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',required=True);p.add_argument('--source-sha256',required=True);p.add_argument('--columns',required=True);p.add_argument('--checkpoint',required=True);p.add_argument('--payload-index',type=int,required=True);p.add_argument('--target',required=True);p.add_argument('--reconstructed');a=p.parse_args()
    source=Path(a.source)
    before=source.lstat()
    if source.is_symlink() or not stat.S_ISREG(before.st_mode) or before.st_nlink!=1 or before.st_size>SOURCE_MAX:raise ValueError('Unsafe captured input')
    with os.fdopen(os.open(source,os.O_RDONLY|os.O_NOFOLLOW),'rb') as f:
        if identity(os.fstat(f.fileno()))!=identity(before):raise ValueError('Captured source changed before open')
        raw=f.read(SOURCE_MAX+1)
        if identity(os.fstat(f.fileno()))!=identity(before):raise ValueError('Captured source changed during read')
    if identity(source.lstat())!=identity(before) or digest(raw)!=a.source_sha256:raise ValueError('Captured source identity/hash changed')
    def metadata(path):
        with open(path,'rb') as f:value=f.read(META_MAX+1)
        if len(value)>META_MAX:raise ValueError('Metadata ceiling')
        return value
    stats=build(raw,metadata(a.columns),metadata(a.checkpoint),a.payload_index,a.target)
    if a.reconstructed:
        fd=os.open(a.reconstructed,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as f:f.write(reconstruct(Path(a.target)));f.flush();os.fsync(f.fileno())
    print(json.dumps(dict(schema=SCHEMA,status='local-sample-verified',sourceSha256=digest(raw),stats=stats,sourceMutated=False,productionPitrCertified=False,qualification='Local SQLite/sample allocation only; actual PostgreSQL side-schema growth/replay/migration are separate gates.'),sort_keys=True))

if __name__=='__main__':main()
