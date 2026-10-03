#!/usr/bin/python3 -I -B
"""Local explicit final manifest assembler only; no repository writes or calls."""
import json,pathlib,hashlib,datetime
T=pathlib.Path('/tmp');R=pathlib.Path('/home/sixer/ProofOfWork.Me');D='deploy/audit30/verification/'
def load(p):return json.loads(pathlib.Path(p).read_bytes())
def meta(p):
 b=pathlib.Path(p).read_bytes();return {'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def dump(p,j):
 b=(json.dumps(j,indent=2,sort_keys=True)+'\n').encode()
 with pathlib.Path(p).open('xb')as f:f.write(b)
 return meta(p)
m=load(T/'pow-audit30-item2-source-custody-proposed-manifest-v1.json');rows={x['repositoryPath']:x for x in m['files']};prior=load(R/'deploy/audit30/verification/source-custody.json');oldpaths={r['repositoryPath']for r in prior['files']}
def add(p,destination=None,purpose='preserve-reviewed-final-item2-public-evidence'):
 p=pathlib.Path(p);q=meta(p);dest=destination or D+p.name
 if dest in oldpaths:return
 row={'originalPath':str(p),'repositoryPath':dest,'bytes':q['bytes'],'sha256':q['sha256'],'purpose':purpose,'qualification':'Exact public reviewed source/typed input or bounded actual outcome. This row preserves bytes only; acceptance is limited to the dated native/HTTPS/browser receipts. No raw environment, private mail capture, binary bundle/archive or screenshot content is included.'}
 if dest in rows:
  assert (rows[dest]['bytes'],rows[dest]['sha256'])==(row['bytes'],row['sha256']);return
 rows[dest]=row
for x in load(T/'pow-audit30-action73-proposed-public-custody-manifest-v1.json')['members']:add(x['original']['path'],x['proposedRepositoryPath'])
for n in ['pow-audit30-action73-proposed-update-v1.json','pow-audit30-action73-proposed-public-custody-manifest-v1.json','pow-audit30-action73-public-preserve-v1.py','pow-audit30-append-action73-v1.py','pow-audit30-item2-operational-doc-append-final-v1.md','pow-audit30-item2-source-custody-append-v2.py','pow-audit30-item2-source-custody-append-v2.test.py','pow-audit30-item2-source-custody-prior-read-only-v2.json','pow-audit30-item2-source-custody-finalize-local-v1.py']:
 add(T/n)
m['files']=sorted(rows.values(),key=lambda x:x['repositoryPath']);m['atUtc']='2026-10-03T21:04:38.270Z';m['additionalQualification']='All1027 prior custody rows, four stored-representation mappings and every historical field are preserved exactly. The four original transient /tmp raw-diff origins are currently absent; their recorded historical mappings and current retained raw/envelope repository hashes remain unchanged, and retained raw diffs remain unstaged. New public rows include actual production API/mail/UI acceptance and prepared or refused tools with their dated qualification. Only two pre-existing approved proposal paths outside verification are admitted by the reviewed bac817 writer; no new non-verification path is added. Binary archives, screenshot pixels, private environment/mail captures and historical deletions are excluded. Release handoff is scoped separately from global humanitems3–5.'
assert len(m['files'])<=512
copy=[]
for row in m['files']:
 p=R/row['repositoryPath']
 if p.exists():
  q=meta(p);assert(q['bytes'],q['sha256'])==(row['bytes'],row['sha256']);continue
 s=pathlib.Path(row['originalPath']);assert s.parent==T and s.name.startswith('pow-audit30-');q=meta(s);assert(q['bytes'],q['sha256'])==(row['bytes'],row['sha256'])
 copy.append({'original':q,'proposedRepositoryPath':row['repositoryPath'],'purpose':row['purpose'],'privateDataIncluded':False})
out=dump(T/'pow-audit30-item2-source-custody-final-manifest-v1.json',m)
cp=dump(T/'pow-audit30-item2-final-public-copy-manifest-v1.json',{'schema':'pow-audit30-action73-proposed-public-custody-manifest-v1','members':copy,'privateCapturesBodiesOrRawAddressesIncluded':False,'deletionRequested':False,'trackerMutationPerformed':False,'productionCalls':False,'qualification':'Explicit missing reviewed public files only; every existing repository target was verified exact before this manifest. No broad copy/glob/staging. Root owns copy and custody preview/apply.'})
print(json.dumps({'finalCustodyManifest':out,'newRows':len(rows),'remaining512Capacity':512-len(rows),'missingPublicCopyManifest':cp,'missingPublicFiles':len(copy),'repositoryMutation':False,'productionCalls':False}))
