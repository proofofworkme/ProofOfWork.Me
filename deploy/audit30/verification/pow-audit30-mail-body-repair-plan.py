#!/usr/bin/python3 -I
"""Build exact private body-only rehearsal preimages from a complete frozen Core census.
No SQL, network or live writer. Public manifest contains only lengths/hashes/IDs.
"""
import argparse,base64,datetime as dt,hashlib,json,os,pathlib,re,stat,sys,types
FROZEN_SHA='818aaf4207ac5f5c627211eec21ed3991f6fd3a8400cce909c64c6be053ce61c'
SCHEMA='pow-audit30-mail-body-private-rehearsal-plan-v1'
MANIFEST_SCHEMA='pow-audit30-mail-body-proposed-exact-manifest-v1'
MAX_CAPTURE=360*1024**2;MAX_ROWS=10000;MAX_TARGETS=128
SHA=re.compile('[0-9a-f]{64}\\Z')
def need(ok,code):
 if not ok:raise ValueError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(o):return json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
def pairs(p):
 d={}
 for k,v in p:need(k not in d,'DUPLICATE_JSON_KEY');d[k]=v
 return d
def parse(b):return json.loads(b,object_pairs_hook=pairs)
def load_census(path):
 b=pathlib.Path(path).read_bytes();need(sha(b)==FROZEN_SHA,'FROZEN_CENSUS_SOURCE')
 m=types.ModuleType('exact_frozen_census');m.__file__=path;exec(compile(b,path,'exec'),m.__dict__);return m

def load_capture(raw,census,wrapper_sha):
 need(len(raw)<=MAX_CAPTURE and raw.endswith(b'\n'),'PRIVATE_CAPTURE_BOUND_OR_TERMINATION')
 lines=raw.splitlines();need(3<=len(lines)<=MAX_ROWS+3,'PRIVATE_CAPTURE_ROW_BOUND');objects=[parse(x) for x in lines]
 head,foot=objects[0],objects[-1]
 need(set(head)=={'phase','schema','frozenCensusSHA256','wrapperSHA256','sqlSHA256'} and head['schema']=='pow-audit30-mail-private-sql-lines-v1' and head['phase']=='private-capture-header','CAPTURE_HEADER')
 sql=census.SQL.replace("SET LOCAL statement_timeout='60s';","SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='60s';",1)
 need(head['frozenCensusSHA256']==FROZEN_SHA and head['wrapperSHA256']==wrapper_sha and head['sqlSHA256']==sha(sql.encode()),'CAPTURE_SOURCE_BINDING')
 need(set(foot)=={'phase','status','records','publicCensusBase64','publicCensusSHA256'} and foot['phase']=='private-capture-footer' and foot['status']=='complete' and foot['records']==len(objects)-2,'CAPTURE_INCOMPLETE')
 publicbytes=base64.b64decode(foot['publicCensusBase64'],validate=True);need(sha(publicbytes)==foot['publicCensusSHA256'],'PUBLIC_CENSUS_HASH');public=parse(publicbytes)
 need(public.get('schema')=='pow-audit30-mail-body-census-v1' and public.get('ok') is True and public.get('coreVerified') is True and public.get('errors')==[] and public.get('sourceSha256')==FROZEN_SHA,'PUBLIC_CENSUS_NOT_CORE_PASSED')
 rawrows=[]
 for envelope in objects[1:-1]:
  need(set(envelope)=={'phase','recordBase64','recordSHA256'} and envelope['phase']=='private-sql-line','CAPTURE_LINE_SHAPE')
  b=base64.b64decode(envelope['recordBase64'],validate=True);need(sha(b)==envelope['recordSHA256'] and len(b)<=8*1024**2,'CAPTURE_LINE_HASH');rawrows.append((b,parse(b)))
 need(rawrows[0][1].get('phase')=='snapshot' and rawrows[0][1].get('transactionReadOnly')=='on' and all(r.get('phase')=='row' for _,r in rawrows[1:]),'CAPTURE_PHASE_ORDER')
 snapshot=rawrows[0][1];rows=rawrows[1:]
 need(snapshot['mailRows']==len(rows)<=MAX_ROWS and len({r['txid'] for _,r in rows})==len(rows) and all(r['network']=='livenet' and SHA.fullmatch(r['txid']) for _,r in rows),'CAPTURE_FULL_POPULATION')
 need([r['txid'] for _,r in rows]==sorted(r['txid'] for _,r in rows),'CAPTURE_ORDER')
 pubs=public.get('rows');need(isinstance(pubs,list) and len(pubs)==len(rows) and [r['txid'] for r in pubs]==[r['txid'] for _,r in rows],'PUBLIC_POPULATION_BINDING')
 expected_snapshot={k:v for k,v in snapshot.items() if k!='meta'};expected_snapshot['metaSha256']=census.h(census.canonical(snapshot['meta']))
 need(public['snapshot']==expected_snapshot,'PUBLIC_SNAPSHOT_BINDING')
 recalculated=[];counts={};targets=[]
 for (b,row),given in zip(rows,pubs):
  class SavedCore:
   def verify(self,r,ops):
    proof=given.get('canonicalCore');t=r['transaction']
    need(type(proof) is dict and set(proof)=={'blockHash','blockHeight','blockIndex','coreScriptsBound'} and proof==dict(blockHash=t['blockHash'],blockHeight=t['blockHeight'],blockIndex=t['blockIndex'],coreScriptsBound=True),'CAPTURE_CORE_PROOF')
    return proof
  calc=census.census_record(row,SavedCore());need(calc==given,'PUBLIC_RAW_ROW_DISAGREEMENT');recalculated.append(calc)
  counts[calc['status']]=counts.get(calc['status'],0)+1
  for k,v in [('repairCandidates',calc['bodyOnlyRepairCandidate']),('byteDifferences',not calc['storedBytesEqualRaw']),('nullEmptyEquivalent',calc['nullEmptyByteEquivalent'])]:counts[k]=counts.get(k,0)+int(v)
  if calc['bodyOnlyRepairCandidate']:
   rawbody=census.raw_body(row['opReturns'])[0].decode('utf-8')
   need(row['mail']['body_text']!=rawbody and rawbody and ('\x00' not in rawbody) and row['mail']['status']=='confirmed','TARGET_GENUINE_TRIM_ONLY')
   targets.append(dict(network='livenet',txid=row['txid'],oldBody=row['mail']['body_text'],newBody=rawbody,rawSourceRecordSHA256=sha(b),publicProof=calc))
 need(public['counts']==counts and public['allStoredBodiesByteExact']==(counts.get('byteDifferences',0)==0),'PUBLIC_COUNTS_DISAGREE')
 need(len(targets)<=MAX_TARGETS,'TARGET_COUNT_BOUND')
 return dict(public=public,snapshotRawBase64=base64.b64encode(rawrows[0][0]).decode(),sourceRows=[dict(txid=r['txid'],recordBase64=base64.b64encode(b).decode(),recordSHA256=sha(b)) for b,r in rows],targets=targets)

def build(raw,census,wrapper_sha,engine_sha):
 need(SHA.fullmatch(wrapper_sha) and SHA.fullmatch(engine_sha),'SOURCE_PIN_SHAPE');value=load_capture(raw,census,wrapper_sha);public=value['public']
 manifest=dict(schema=MANIFEST_SCHEMA,censusSHA256=FROZEN_SHA,captureWrapperSHA256=wrapper_sha,privateCaptureSHA256=sha(raw),transactionEngineSHA256=engine_sha,network='livenet',populationRows=len(value['sourceRows']),targetCount=len(value['targets']),savedCensusSnapshot=public['snapshot'],coreTipBefore=public['coreTipBefore'],coreTipAfter=public['coreTipAfter'],targets=[dict(network=t['network'],txid=t['txid'],sourceRecordSHA256=t['rawSourceRecordSHA256'],proof=t['publicProof']) for t in value['targets']],sqlScope='UPDATE existing confirmed proof_indexer.mail_items.body_text only',productionApplyApproved=False,qualification='Exact complete captured mail population and frozen census Core proof; not a new Core replay. Pending rows and null/empty equivalence are excluded. Fresh exact manifest approval and reviewed live runtime fences are required before any production writer. This package exposes only NEW private-clone rehearsal; no live mutation entrypoint.')
 return dict(schema=SCHEMA,manifest=manifest,manifestSHA256=sha(encoded(manifest)),snapshotRawBase64=value['snapshotRawBase64'],sourceRows=value['sourceRows'],targets=value['targets'])

def private_read(path,expected,enforce_root=True):
 p=pathlib.Path(path);need(str(p)==path and p.is_absolute() and p.resolve(strict=True)==p,'PRIVATE_PATH_CANONICAL');m=p.lstat()
 need(stat.S_ISREG(m.st_mode) and (not enforce_root or m.st_uid==m.st_gid==0) and stat.S_IMODE(m.st_mode)==0o600 and m.st_nlink==1 and m.st_size<=MAX_CAPTURE,'PRIVATE_FILE_SHAPE')
 parent=p.parent.lstat();need(stat.S_ISDIR(parent.st_mode) and (not enforce_root or parent.st_uid==parent.st_gid==0) and stat.S_IMODE(parent.st_mode)==0o700,'PRIVATE_PARENT_SHAPE')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 def stable(v):return (v.st_dev,v.st_ino,v.st_mode,v.st_uid,v.st_gid,v.st_nlink,v.st_size,v.st_mtime_ns,v.st_ctime_ns)
 try:
  with os.fdopen(fd,'rb',closefd=False) as f:b=f.read(MAX_CAPTURE+1)
  need(stable(os.fstat(fd))==stable(m)==stable(p.lstat()) and sha(b)==expected,'PRIVATE_FILE_CHANGED')
 finally:os.close(fd)
 return b

def durable_new(path,raw):
 p=pathlib.Path(path);need(p.is_absolute() and str(p)==path and p.parent.resolve(strict=True)==p.parent,'OUTPUT_CANONICAL');s=p.parent.stat();need(s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'OUTPUT_PRIVATE_PARENT')
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  pos=0
  while pos<len(raw):pos+=os.write(fd,raw[pos:])
  os.fsync(fd)
 finally:os.close(fd)
 d=os.open(p.parent,os.O_DIRECTORY|os.O_RDONLY|os.O_NOFOLLOW)
 try:need(os.fstat(d).st_ino==s.st_ino and os.fstat(d).st_dev==s.st_dev,'OUTPUT_PARENT_CHANGED');os.fsync(d)
 finally:os.close(d)

def main():
 a=argparse.ArgumentParser();a.add_argument('--capture',required=True);a.add_argument('--capture-sha256',required=True);a.add_argument('--census-source',required=True);a.add_argument('--wrapper-sha256',required=True);a.add_argument('--engine-sha256',required=True);a.add_argument('--private-plan',required=True);a.add_argument('--public-manifest',required=True);o=a.parse_args();need(os.geteuid()==0 and sys.flags.isolated,'ROOT_ISOLATED_REQUIRED')
 c=load_census(o.census_source);p=build(private_read(o.capture,o.capture_sha256),c,o.wrapper_sha256,o.engine_sha256)
 durable_new(o.private_plan,encoded(p));durable_new(o.public_manifest,encoded(p['manifest']))
 sys.stdout.buffer.write(encoded(dict(schema='pow-audit30-mail-body-plan-custody-v1',privatePlanSHA256=sha(encoded(p)),privatePlanBytes=len(encoded(p)),publicManifestSHA256=p['manifestSHA256'],targetCount=len(p['targets']),productionExecuted=False)))
if __name__=='__main__':
 try:main()
 except Exception as e:sys.stdout.write(json.dumps(dict(status='refused',errorClass=type(e).__name__,code=str(e) if re.fullmatch('[A-Z_]+',str(e)) else 'DETAIL_REDACTED')));sys.exit(1)
