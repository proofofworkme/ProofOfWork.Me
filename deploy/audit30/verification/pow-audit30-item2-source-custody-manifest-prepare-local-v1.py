"""Local-only explicit public custody inventory. Does not copy files or edit custody."""
from pathlib import Path
import datetime,hashlib,json,os,stat
REPO=Path('/home/sixer/ProofOfWork.Me');VERIFY=REPO/'deploy/audit30/verification';TMP=Path('/tmp')
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path):
 s=path.lstat();assert path.resolve()==path and stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_size<=4*1024**2
 def stamp(x):return(x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_nlink,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
 with path.open('rb')as f:
  assert stamp(os.fstat(f.fileno()))==stamp(s);r=f.read(4*1024**2+1)
  assert len(r)==s.st_size and stamp(os.fstat(f.fileno()))==stamp(s)==stamp(path.lstat())
 return r
base_raw=read(VERIFY/'source-custody.json');assert len(base_raw)==447848 and sha(base_raw)=='5f23d7b72cb3a4beb91456598e3492eb9f484a529f858bbb55e006ae023c61aa'
old=json.loads(base_raw);assert len(old['files'])==1027 and len(old['storedRepresentations'])==4
known={r['repositoryPath']for r in old['files']};assert len(known)==1027
mapped={v['repositoryPath']for v in old['storedRepresentations'].values()}
tracker=json.loads((REPO/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json').read_bytes());assert len(tracker['actions'])==72
bindings={}
def add_binding(path,origin,bytes_,hash_,evidence):
 if not isinstance(path,str)or not path.startswith('deploy/audit30/verification/')or not isinstance(origin,str):return
 if not isinstance(bytes_,int)or not isinstance(hash_,str)or len(hash_)!=64:return
 bindings.setdefault(path,[]).append({'origin':origin,'bytes':bytes_,'sha256':hash_,'evidence':evidence})
def collect(value,evidence):
 if isinstance(value,dict):
  path=value.get('repositoryPath',value.get('proposedRepositoryPath'))
  if isinstance(value.get('original'),dict):
   r=value['original'];add_binding(path,r.get('path'),r.get('bytes'),r.get('sha256'),evidence)
  add_binding(path,value.get('originalPath',value.get('sourcePath')),value.get('bytes'),value.get('sha256'),evidence)
  for child in value.values():collect(child,evidence)
 elif isinstance(value,list):
  for child in value:collect(child,evidence)
for i,a in enumerate(tracker['actions'],1):collect(a,'execution-action-'+str(i))
existing=[]
for p in sorted(VERIFY.rglob('*')):
 if not p.is_file():continue
 rel=p.relative_to(REPO).as_posix()
 if rel in known or rel in mapped or p.name=='source-custody.json' or rel.endswith('.diff'):continue
 raw=read(p);existing.append((p,rel,raw))
 if p.suffix=='.json':
  try:collect(json.loads(raw),rel)
  except (json.JSONDecodeError,UnicodeDecodeError):pass
for n in ['pow-audit30-action72-proposed-public-manifest-v5.json','pow-audit30-item2-ui-preserved-public-source-manifest-v3.json']:
 collect(json.loads(read(TMP/n)),str(TMP/n))
rows={};origins={'hashBoundKnownOriginal':0,'durableRepositoryOrigin':0};origin_evidence={};pending=[]
for path,rel,raw in existing:
 matching=[b for b in bindings.get(rel,[])if b['bytes']==len(raw)and b['sha256']==sha(raw)]
 selected=None
 for b in matching:
  origin=Path(b['origin'])
  if not origin.is_absolute()or not (origin.is_relative_to(TMP)or origin.is_relative_to(VERIFY))or not origin.exists():continue
  if read(origin)==raw:selected=b;break
 if selected:
  origin=selected['origin'];qualification='Exact current public repository bytes match the known original source and actual custody/action binding. Execution outcomes remain those of the dated receipts; source custody does not certify additional acceptance.';origins['hashBoundKnownOriginal']+=1;origin_evidence[rel]=selected
 else:
  origin=str(path);qualification='Root-durable public verification file used as the truthful current origin. Earlier preparation/execution provenance is preserved in the original actions and receipts; no unproved /tmp origin or native outcome is inferred.';origins['durableRepositoryOrigin']+=1
 rows[rel]={'originalPath':origin,'repositoryPath':rel,'bytes':len(raw),'sha256':sha(raw),'purpose':'preserve-existing-approved-public-verification-file','qualification':qualification}
ui_manifest=TMP/'pow-audit30-item2-ui-preserved-public-source-manifest-v3.json';ui=json.loads(read(ui_manifest));assert len(ui['sources'])==52 and ui['nativeInvocationsByThisAgent']==0
sources=[dict(r)for r in ui['sources']]
for n in ['pow-audit30-item2-ui-preserved-public-source-manifest-v2.json','pow-audit30-item2-ui-preserved-public-source-manifest-v3.json','pow-audit30-item2-semantic-hygiene-custody-review-v1.json','pow-audit30-item2-source-custody-append-v1.py','pow-audit30-item2-source-custody-append-v1.test.py','pow-audit30-item2-source-custody-manifest-prepare-local-v1.py']:
 p=TMP/n;raw=read(p);sources.append({'path':str(p),'bytes':len(raw),'sha256':sha(raw),'publicReviewed':True,'privateDataIncluded':False})
for source in sources:
 p=Path(source['path']);assert p.parent==TMP and source['publicReviewed']is True and source['privateDataIncluded']is False
 raw=read(p);assert len(raw)==source['bytes']and sha(raw)==source['sha256'];rel='deploy/audit30/verification/'+p.name
 if rel in known:continue
 if rel in rows:assert rows[rel]['bytes']==len(raw)and rows[rel]['sha256']==sha(raw);continue
 target=REPO/rel
 if target.exists():assert read(target)==raw
 else:pending.append({'sourcePath':str(p),'repositoryPath':rel,'bytes':len(raw),'sha256':sha(raw)})
 rows[rel]={'originalPath':str(p),'repositoryPath':rel,'bytes':len(raw),'sha256':sha(raw),'purpose':'exact-reviewed-public-source-fixture-or-typed-request','qualification':'Reviewed local public preparation/source or bounded read-only diagnostic only. Actual native outcomes remain separately bound by Root receipts; source-copy custody does not imply publication or completion.'}
assert 1<=len(rows)<=512
at=datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest={'schema':'pow-audit30-item2-source-custody-append-manifest-v1','custodyPreimage':{'path':'deploy/audit30/verification/source-custody.json','bytes':447848,'sha256':sha(base_raw),'rows':1027,'storedRepresentations':4},'atUtc':at,'files':[rows[k]for k in sorted(rows)],'additionalQualification':'Append-only Root-reviewed public custody for actual original16 repair, backup protection, shadow and production API/mail acceptance, preserved refusals and scoped UI preparation. Earlier1027 rows and four exact raw-diff envelopes remain unchanged. CurrentContinuation/dates control current completion status; source custody itself is neither native acceptance, financial completeness, migration/recovery activation nor retirement authority. This draft inventory awaits Root review/copy and later exact UI/closure additions before apply.','publicReviewed':True,'privateDataIncluded':False}
out=TMP/'pow-audit30-item2-source-custody-proposed-manifest-v1.json';raw=(json.dumps(manifest,indent=2,sort_keys=True)+'\n').encode()
with out.open('xb')as f:f.write(raw)
discovery={'schema':'pow-audit30-item2-source-custody-public-discovery-v1','atUtc':at,'status':'read-only-explicit-draft-not-applied','custodyPreimage':manifest['custodyPreimage'],'manifest':{'path':str(out),'bytes':len(raw),'sha256':sha(raw)},'existingUnboundPublicFiles':len(existing),'appendRows':len(rows),'remainingAppendCap':512-len(rows),'originCounts':origins,'knownOriginBindings':origin_evidence,'pendingPublicCopies':pending,'fourStoredMappingsUnchanged':True,'rawDiffCandidatesAdded':0,'repositoryCopiesPerformed':False,'custodyMutationPerformed':False,'productionCalls':False}
out=TMP/'pow-audit30-item2-source-custody-public-discovery-v1.json';raw=(json.dumps(discovery,indent=2,sort_keys=True)+'\n').encode()
with out.open('xb')as f:f.write(raw)
print(json.dumps({'manifest':discovery['manifest'],'discovery':{'path':str(out),'bytes':len(raw),'sha256':sha(raw)},'appendRows':len(rows),'existingUnboundFiles':len(existing),'pendingCopies':len(pending),'originCounts':origins,'repositoryWritten':False,'productionCalls':False},sort_keys=True))
