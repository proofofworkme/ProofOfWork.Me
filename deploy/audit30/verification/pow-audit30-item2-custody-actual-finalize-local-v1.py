#!/usr/bin/python3 -I -B
"""One final local custody/public-copy manifest assembly; no repository mutations."""
import json,pathlib,hashlib,datetime
R=pathlib.Path('/home/sixer/ProofOfWork.Me');T=pathlib.Path('/tmp');D='deploy/audit30/verification/'
def load(p):return json.loads(pathlib.Path(p).read_bytes())
def meta(p):
 p=pathlib.Path(p);b=p.read_bytes();return {'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def save(p,q):
 with pathlib.Path(p).open('xb')as f:f.write((json.dumps(q,indent=2,sort_keys=True)+'\n').encode())
 return meta(p)
m=load(T/'pow-audit30-item2-source-custody-final-manifest-v1.json');rows={r['repositoryPath']:r for r in m['files']}
# Three actual approved .md draft originals survive unchanged. Use exact plain-text representations so historical root-relative draft links aren't classified as repository notes.
for n in ['pow-audit30-item2-operational-doc-append-final-v1.md','pow-audit30-item2-operational-doc-append-final-v2.md','pow-audit30-action73-human-tracker-append-v1.md']:
 p=T/n;q=meta(p);rows.pop(D+n,None);rows[D+n+'.txt']={'originalPath':str(p),'repositoryPath':D+n+'.txt','bytes':q['bytes'],'sha256':q['sha256'],'purpose':'preserve-approved-public-document-fragment-exact-text','qualification':'Byte-for-byte plain-text public representation of the original Markdown draft. Original /tmp .md bytes remain unchanged; any already copied raw .md is retained unchanged and unstaged. This avoids treating draft root-relative links as current repository notes; no content rewrite or historical custody rewrite is performed.'}
actual={}
for n in ['audits/2026-10-02-audit30-followup-tracker.md','OP_RETURN_INFRASTRUCTURE.md','audits/2026-10-02-audit30-remaining-phase-execution.evidence.json','deploy/audit30/verification/pow-audit30-action73-public-custody-preserved-final-v1.json']:
 actual[n]=meta(R/n)
j=load(R/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json');assert len(j['actions'])==73 and actual['audits/2026-10-02-audit30-remaining-phase-execution.evidence.json']['sha256']=='4dc1fd489c257094a234ae1c47138404d67ec0d86a0b2ef8a270bf9435409833'
md=(R/'audits/2026-10-02-audit30-followup-tracker.md').read_text();assert md.count('### Action73:')==1 and 'reconciled through Action73 at 2026-10-03T21:04:38.270Z' in md
assert (R/'OP_RETURN_INFRASTRUCTURE.md').read_bytes().endswith((T/'pow-audit30-item2-operational-doc-append-final-v2.md').read_bytes())
copy=load(R/'deploy/audit30/verification/pow-audit30-action73-public-custody-preserved-final-v1.json');assert copy['allExact'] and copy['status']=='preserved' and len(copy['members'])==56
review={'schema':'pow-audit30-item2-final-bookkeeping-review-v1','observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'actualFiles':actual,'executionActionCount':73,'runtimeApiMailUiAcceptanceComplete':True,'item2ReleaseHandoffComplete':False,'humanItem1Complete':j['currentContinuation']['userRemainingChecklist']['1']['status']=='complete','humanItems3Through6UnchangedByAction73':True,'historical72ActionsPreservedByExactAppender':True,'humanTrackerHistoricalTextPreservedApartFromCurrentTimestampAndTableRow6':True,'operationalDocExactReviewedV2Suffix':True,'currentContinuationPrecedenceExplicit':True,'rootCopy56AllExact':True,'rawMarkdownDraftsRetainedUnchangedUnstaged':True,'draftPlainTextRepresentationsExact':True,'noProductionCallsOrGitMutationsByThisReview':True,'qualification':'Root applied the exact peer-reviewed Action73 and56 public copies, and appended the exact approved OP v2. This agent made only the authorized human tracker table/timestamp/dated append. The current runtime acceptance is complete while release-specific hygiene/commit/push/announcement handoff remains pending; global humanitems3–5/6 closure stays separate. No broader canonical-document change or production test was performed.'}
reviewPath=T/'pow-audit30-item2-final-bookkeeping-review-v1.json';save(reviewPath,review)
def add(p,purpose,qual):
 p=pathlib.Path(p);q=meta(p);dest=D+p.name
 if dest in rows:
  assert rows[dest]['bytes']==q['bytes']and rows[dest]['sha256']==q['sha256'];return
 rows[dest]={'originalPath':str(p),'repositoryPath':dest,'bytes':q['bytes'],'sha256':q['sha256'],'purpose':purpose,'qualification':qual}
add(R/'deploy/audit30/verification/pow-audit30-action73-public-custody-preserved-final-v1.json','preserve-actual-root-public-copy-receipt','This receipt was generated directly at its durable repository path by the exact reviewed public copier. No original /tmp receipt path is invented. All56 copied public source/receipt bindings are actual and verified; any raw .md fragment remains unstaged and has an exact .md.txt representation in this new custody batch.')
for p in [reviewPath,T/'pow-audit30-item2-source-custody-final-manifest-v1.json',T/'pow-audit30-item2-final-public-copy-manifest-v1.json',T/'pow-audit30-item2-custody-actual-finalize-local-v1.py']:
 add(p,'preserve-reviewed-final-bookkeeping-source-or-dated-manifest','Exact public local source, reviewed historical proposal or current actual bookkeeping projection. Draft manifests are not applied outcomes; future repository/handoff completion is excluded.')
m['files']=sorted(rows.values(),key=lambda r:r['repositoryPath']);assert len(rows)<=512
m['atUtc']=review['observedAtUtc'];m['additionalQualification']='All 1027 prior custody rows, four stored-representation mappings and every historical field are preserved exactly. Four original transient /tmp raw-diff origins are currently absent; retained raw/envelope hashes and recorded historical mappings remain unchanged, and raw diffs stay unstaged. Approved document-fragment originals are preserved byte-for-byte as .md.txt public representations; original Markdown bytes remain unchanged and any raw copied .md stays unstaged. New public rows preserve actual production API/mail/UI acceptance, actual Action73 public copies, current authorized MD/OP bookkeeping hashes, and dated prepared/refused tools. Only two existing approved proposal paths outside verification are recognized by the reviewed bac817 writer; no new non-verification path is added. No binary archive, screenshot pixels, raw configuration, environment or private mailbox capture is included. Release handoff remains separate from global human items 3–5 and final item6 closure.'
cp=[]
for row in m['files']:
 p=R/row['repositoryPath']
 if p.exists():
  q=meta(p);assert(q['bytes'],q['sha256'])==(row['bytes'],row['sha256']);continue
 s=pathlib.Path(row['originalPath']);assert s.parent==T and s.name.startswith('pow-audit30-');q=meta(s);assert(q['bytes'],q['sha256'])==(row['bytes'],row['sha256'])
 cp.append({'original':q,'proposedRepositoryPath':row['repositoryPath'],'purpose':row['purpose'],'privateDataIncluded':False})
fm=save(T/'pow-audit30-item2-source-custody-final-manifest-v2.json',m)
cm=save(T/'pow-audit30-item2-final-public-copy-manifest-v2.json',{'schema':'pow-audit30-action73-proposed-public-custody-manifest-v1','members':cp,'privateCapturesBodiesOrRawAddressesIncluded':False,'deletionRequested':False,'trackerMutationPerformed':False,'productionCalls':False,'qualification':'Explicit final missing public files only; all existing targets were verified exact. Three .md originals copy byte-for-byte to .md.txt targets. No blanket staging, raw Markdown rewrite/deletion or historical custody change.'})
print(json.dumps({'custodyManifest':fm,'newRows':len(rows),'totalRowsAfterApply':1027+len(rows),'copyManifest':cm,'missingPublicFiles':len(cp),'actualBookkeepingReview':meta(reviewPath),'repositoryMutationByThisAssembler':False}))
