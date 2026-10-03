#!/usr/bin/python3 -I
"""Creation-only compact public audit checkpoint65; no remote/production action.

Explicit Root-reviewed public manifest must be supplied with its exact SHA.
Prior64 actions/761 custody rows and all authorization objects remain immutable.
Reuse only exact frozen Action64 lossless-byte and local file-custody helpers.
No scan, private input, cleanup, retry, approval, deployment or rollback.
"""
import copy,datetime,hashlib,json,os,re,sys,types
from pathlib import Path
ROOT=Path('/home/sixer/ProofOfWork.Me');TMP=Path('/tmp')
BASE='4df964287d9f326845bc22d5d4f454f7a2cadf74'
PREV=ROOT/'deploy/audit30/verification/pow-audit30-append-action64-v3.py'
PREV_SHA='a171c5bf9b3090226a7e8331e8676a4fcf2a2d2d0bf39e135611dd89783e041c'
E=ROOT/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'
C=ROOT/'deploy/audit30/verification/source-custody.json'
T=ROOT/'audits/2026-10-02-audit30-followup-tracker.md'
HY=ROOT/'repository-hygiene.json'
INTENT=TMP/'pow-audit30-action65-public-custody-intent-v1.json'
RECEIPT=TMP/'pow-audit30-action65-public-custody-preservation-v1.json'
MANIFEST=TMP/'pow-audit30-action65-fixed-public-manifest-v1.json'
PROPOSAL=ROOT/'audits/2026-10-03-audit30-oct3-pin-checker-promotion-proposal.md'
LIMITS={E:32*1024**2,C:2*1024**2,T:2*1024**2,HY:2*1024**2}
HEX=re.compile('[a-f0-9]{64}\\Z')
def need(value,why):
 if not value:raise ValueError(why)
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return(json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def sync_directory(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def main():
 need(sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==2 and HEX.fullmatch(sys.argv[1]),'Exact isolated Root manifest role')
 pb=PREV.read_bytes();need(len(pb)==21939 and sha(pb)==PREV_SHA,'Frozen previous local custody helper')
 H=types.ModuleType('fixed_previous_public_custody_definitions');H.__file__=str(PREV);exec(compile(pb,str(PREV),'exec'),H.__dict__)
 need(H.git('rev-parse','HEAD').decode().strip()==BASE,'Fixed Action64 HEAD')
 baselines={p:H.read(p,LIMITS[p]) for p in LIMITS}
 for p,b in baselines.items():need(H.git('show',BASE+':'+str(p.relative_to(ROOT)))==b,'Tracked preappend baseline drift')
 old_e=json.loads(baselines[E]);old_c=json.loads(baselines[C]);old_h=json.loads(baselines[HY]);need(len(old_e['actions'])==64 and len(old_c['files'])==761,'Fixed cardinality')
 for row in old_c['files']:
  b=H.prior_custody_bytes(row,old_c['storedRepresentations']);need(len(b)==row['bytes'] and sha(b)==row['sha256'],'Prior custody drift')
 mb=H.read(MANIFEST);need(sha(mb)==sys.argv[1],'Manifest raw SHA');manifest=json.loads(mb)
 need(set(manifest)=={'schema','baseHead','files','proposal','summary','fullReadRootReview','fullReadPeerReview','trackerNote','item7Checkpoint','item8Checkpoint'} and manifest['schema']=='pow-audit30-action65-fixed-public-manifest-v1' and manifest['baseHead']==BASE,'Closed public manifest')
 need(isinstance(manifest['summary'],str) and len(manifest['summary'])<5000 and isinstance(manifest['trackerNote'],str) and len(manifest['trackerNote'])<10000,'Bounded exact prose')
 need(isinstance(manifest['files'],list) and 1<=len(manifest['files'])<=125,'Bounded exact public file list')
 selected={}
 for binding in manifest['files']:
  p,b=H.public_binding(binding);need(str(p) not in selected,'Duplicate manifest path');selected[str(p)]=(binding,b)
 need(str(Path(__file__).resolve()) in selected,'Self source must be bound')
 selected[str(MANIFEST)]=({'path':str(MANIFEST),'bytes':len(mb),'sha256':sha(mb),'type':'json-public-receipt'},mb)
 for role,expected_schema in [('fullReadRootReview','pow-audit30-root-fresh-oct3-full-read-acceptance-v1'),('fullReadPeerReview','pow-audit30-independent-fresh-oct3-full-read-actual-review-v1')]:
  binding=manifest[role];p,b=H.public_binding(binding);need(str(p) in selected and selected[str(p)][0]==binding,'Accepted review must be preserved');d=json.loads(b);need(d['schema']==expected_schema and d['claims']['productionDataMutation'] is False,'Exact accepted public role');need(d['claims'].get('pinCheckerPromotion',d['claims'].get('promotionAuthorized')) is False and d['claims'].get('additionalDeletion',d['claims'].get('deletionAuthorized')) is False,'No expanded approval')
 pr=manifest['proposal'];need(set(pr)=={'path','bytes','sha256','repositoryPath'} and pr['repositoryPath']==str(PROPOSAL.relative_to(ROOT)),'Exact proposal destination')
 pp=Path(pr['path']);need(pp.parent==TMP and pp.name=='pow-audit30-oct3-pin-checker-promotion-proposal-v2.md','Fixed public proposal source')
 proposal=H.read(pp);need(len(proposal)==pr['bytes'] and sha(proposal)==pr['sha256'] and len(proposal)<32768,'Proposal binding')
 need(not PROPOSAL.exists() and not PROPOSAL.is_symlink(),'Creation-only proposal path')
 known={r['originalPath']:r for r in old_c['files']};need(len(known)==761,'Prior duplicate original paths')
 targets={PROPOSAL:proposal};rows=[]
 for original,(binding,b) in sorted(selected.items()):
  need(H.read(Path(original))==b,'Fresh public source drift')
  if original in known:
   row=known[original];need(H.prior_custody_bytes(row,old_c['storedRepresentations'])==b,'Known source must be byte-equal');continue
  name,stored,extras=H.representation(Path(original),b);target=H.VERIFY/name
  need(target not in targets and not target.exists() and not target.is_symlink(),'Creation-only artifact collision');targets[target]=stored
  rows.append({'originalPath':original,'repositoryPath':str(target.relative_to(ROOT)),'bytes':len(stored),'sha256':sha(stored),**extras})
 rows.append({'originalPath':str(pp),'repositoryPath':str(PROPOSAL.relative_to(ROOT)),'bytes':len(proposal),'sha256':sha(proposal)})
 now=datetime.datetime.now(datetime.timezone.utc).isoformat();e=copy.deepcopy(old_e);c=copy.deepcopy(old_c);hy=copy.deepcopy(old_h)
 e['actions'].append({'atUtc':now,'action':manifest['summary'],'publicSourceCustodyAdded':rows,'currentOct3FullReadRootReview':manifest['fullReadRootReview'],'currentOct3FullReadPeerReview':manifest['fullReadPeerReview'],'reviewablePromotionProposal':pr,'priorItem7CheckpointPreserved':{'gitRevision':BASE,'repositoryPath':str(E.relative_to(ROOT)),'jsonPointer':'/items/7','canonicalBytes':len(encode(old_e['items']['7'])),'canonicalSha256':sha(encode(old_e['items']['7']))},'productionDataMutation':False,'recoveryConfigurationMutation':False,'additionalDeletion':False,'sourceAndCaptureDetailsByExactCustodyReference':True})
 e['updatedAtUtc']=now
 for number in ('7','8'):
  cp=manifest['item'+number+'Checkpoint'];need(isinstance(cp,dict) and cp.get('productionDataMutation') is False and cp.get('additionalDeletion') is False and cp.get('complete') is False,'Checkpoint must retain scope gates');e['items'][number].setdefault('progressCheckpoints',[]).append(dict(cp,atUtc=now,action=65))
 c['files'].extend(rows);c['atUtc']=now
 noteclass='ledger-and-audit-evidence';rp=str(PROPOSAL.relative_to(ROOT));need(rp not in hy['noteInventory'][noteclass],'Proposal must be newly classified');hy['noteInventory'][noteclass].append(rp)
 tracker=baselines[T].decode()+'\n'+manifest['trackerNote']+'\n'
 outputs={E:encode(e),C:encode(c),T:tracker.encode(),HY:encode(hy)}
 for p,b in outputs.items():need(len(b)<=LIMITS[p],'Prewrite audit document limit')
 for p,b in targets.items():need(len(b)<=H.MAX_INPUT,'Prewrite stored artifact representation limit')
 need(e['actions'][:64]==old_e['actions'] and c['files'][:761]==old_c['files'],'Historical action/custody drift')
 for k in old_e:
  if k not in ('actions','items','updatedAtUtc'):need(e[k]==old_e[k],'Approval/mutation/retirement/request drift')
 for k in old_c:
  if k not in ('files','atUtc'):need(c[k]==old_c[k],'Global representation drift')
 for k,olditem in old_e['items'].items():
  nowitem=copy.deepcopy(e['items'][k]);
  if k in ('7','8'):
   nowitem['progressCheckpoints'].pop()
   if 'progressCheckpoints' not in olditem:nowitem.pop('progressCheckpoints')
  need(nowitem==olditem,'Unrelated or historical item drift')
 need(not INTENT.exists() and not RECEIPT.exists(),'No automatic append retry')
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Pre-intent baseline drift')
 H.create(INTENT,encode({'schema':'pow-audit30-action65-public-custody-intent-v1','baseHead':BASE,'atUtc':now,'manifestSha256':sha(mb),'baseline':[{'path':str(p),'bytes':len(b),'sha256':sha(b)} for p,b in baselines.items()],'plannedOutputs':[{'path':str(p),'bytes':len(b),'sha256':sha(b)} for p,b in outputs.items()],'newRows':rows,'partialWriteRequiresExplicitReviewNotAutomaticRetry':True,'productionMutation':False}))
 sync_directory(TMP)
 for p,b in targets.items():H.create(p,b);need(H.read(p)==b,'Created byte mismatch')
 for parent in sorted({p.parent for p in targets}):sync_directory(parent)
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Pre-replace baseline drift')
 for original,(_,b) in selected.items():need(H.read(Path(original))==b,'Source drift during copy')
 need(H.read(pp)==proposal,'Proposal drift during copy')
 for p,b in outputs.items():stage=p.with_name(p.name+'.action65-new');H.create(stage,b);os.replace(stage,p);sync_directory(p.parent)
 for p,b in outputs.items():need(H.read(p,LIMITS[p])==b,'Final document mismatch')
 receipt={'schema':'pow-audit30-action65-public-custody-preservation-v1','atUtc':now,'baseHead':BASE,'manifestSha256':sha(mb),'oldActionsPreserved':64,'oldCustodyRowsPreserved':761,'actionsNow':len(e['actions']),'custodyRowsNow':len(c['files']),'newRows':rows,'approvalMutationRetirementRequestsAndGlobalRepresentationsUnchanged':True,'productionMutation':False,'remoteExecutionByAppend':False,'hygieneCommitPushNotYetPerformed':True}
 H.create(RECEIPT,encode(receipt));sync_directory(TMP);print(json.dumps({k:v for k,v in receipt.items() if k!='newRows'},sort_keys=True))
if __name__=='__main__':main()
