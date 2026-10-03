#!/usr/bin/python3 -I
"""Creation-only public package-preparation/request checkpoint; no native action."""
import copy,datetime,hashlib,json,os,re,sys,types
from pathlib import Path
ROOT=Path('/home/sixer/ProofOfWork.Me');TMP=Path('/tmp')
BASE='87c16cbaad1cb6e22eda78cf6686d9094953638e'
PREV=ROOT/'deploy/audit30/verification/pow-audit30-append-action64-v3.py'
PREV_SHA='a171c5bf9b3090226a7e8331e8676a4fcf2a2d2d0bf39e135611dd89783e041c'
E=ROOT/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'
C=ROOT/'deploy/audit30/verification/source-custody.json'
T=ROOT/'audits/2026-10-02-audit30-followup-tracker.md'
MANIFEST=TMP/'pow-audit30-action66-fixed-public-manifest-v1.json'
INTENT=TMP/'pow-audit30-action66-public-custody-intent-v1.json'
RECEIPT=TMP/'pow-audit30-action66-public-custody-preservation-v1.json'
LIMITS={E:32*1024**2,C:2*1024**2,T:2*1024**2}
def need(v,s):
 if not v:raise ValueError(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return(json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def syncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def main():
 need(sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'Exact isolated manifest role')
 b=PREV.read_bytes();need(sha(b)==PREV_SHA and len(b)==21939,'Frozen local public helpers')
 H=types.ModuleType('frozen_public_custody_defs');H.__file__=str(PREV);exec(compile(b,str(PREV),'exec'),H.__dict__)
 need(H.git('rev-parse','HEAD').decode().strip()==BASE,'Exact Action65 HEAD')
 baselines={p:H.read(p,cap)for p,cap in LIMITS.items()}
 for p,b in baselines.items():need(b==H.git('show',BASE+':'+str(p.relative_to(ROOT))),'Tracked baseline drift')
 old_e=json.loads(baselines[E]);old_c=json.loads(baselines[C]);need(len(old_e['actions'])==65 and len(old_c['files'])==872 and len(old_e['finalApprovalRequests'])==1,'Fixed counts')
 for row in old_c['files']:
  b=H.prior_custody_bytes(row,old_c['storedRepresentations']);need(len(b)==row['bytes']and sha(b)==row['sha256'],'Prior public custody drift')
 raw=H.read(MANIFEST);need(sha(raw)==sys.argv[1],'Exact manifest SHA');m=json.loads(raw)
 need(set(m)=={'schema','baseHead','files','requestReceipt','summary','trackerNote','item7Checkpoint'} and m['schema']=='pow-audit30-action66-fixed-public-manifest-v1'and m['baseHead']==BASE,'Closed manifest')
 need(isinstance(m['files'],list)and 1<=len(m['files'])<=30 and isinstance(m['summary'],str)and len(m['summary'])<5000 and isinstance(m['trackerNote'],str)and len(m['trackerNote'])<8000,'Bounded public list/prose')
 selected={}
 for row in m['files']:
  p,b=H.public_binding(row);need(str(p)not in selected,'Duplicate path');selected[str(p)]=(row,b)
 need(str(Path(__file__).resolve())in selected,'Exact self source included')
 p,b=H.public_binding(m['requestReceipt']);need(str(p)in selected and selected[str(p)][0]==m['requestReceipt'],'Request bound and preserved');request=json.loads(b)
 need(request['schema']=='pow-audit30-dual-pin-checker-final-approval-request-v1'and request['status']=='requested-awaiting-human-response'and request['toolAccepted']is True,'Actual dispatch snapshot only')
 for k in ('humanResponseReceived','productionApprovalReceiptCreated','recoveryConfigurationAuthorized','productionDataMutation','additionalDeletionAuthorized','nativeInvoked'):need(request[k]is False,'No inferred approval/action')
 need(request['reviewedScopeSHA256']=='fe09d0ba6c9c1e561a569fb425c9812f9b077cb646fbdd615768e0546ead0437','Exact two-file scope')
 proposal=ROOT/request['proposalPath'];need(sha(H.read(proposal))==request['proposalSHA256']=='cd5852c4b9415f60104b6bc72c82e580e003f000219844ef3a694d6ae86507ec','Fixed unchanged proposal')
 selected[str(MANIFEST)]=({'path':str(MANIFEST),'bytes':len(raw),'sha256':sha(raw),'type':'json-public-receipt'},raw)
 known={row['originalPath']:row for row in old_c['files']};need(len(known)==872,'Prior unique paths');targets={};rows=[]
 for original,(binding,b)in sorted(selected.items()):
  need(H.read(Path(original))==b,'Current public source drift')
  if original in known:
   need(H.prior_custody_bytes(known[original],old_c['storedRepresentations'])==b,'Known source drift');continue
  name,stored,extra=H.representation(Path(original),b);target=H.VERIFY/name
  need(target not in targets and not target.exists()and not target.is_symlink()and len(stored)<=H.MAX_INPUT,'Creation target/cap')
  targets[target]=stored;rows.append(dict(originalPath=original,repositoryPath=str(target.relative_to(ROOT)),bytes=len(stored),sha256=sha(stored),**extra))
 now=datetime.datetime.now(datetime.timezone.utc).isoformat();e=copy.deepcopy(old_e);c=copy.deepcopy(old_c)
 cp=m['item7Checkpoint'];need(isinstance(cp,dict)and cp.get('complete')is False and cp.get('productionDataMutation')is False and cp.get('additionalDeletion')is False and cp.get('recoveryConfigurationMutation')is False,'Incomplete source-only checkpoint')
 e['actions'].append(dict(atUtc=now,action=m['summary'],publicSourceCustodyAdded=rows,finalApprovalRequestReceipt=m['requestReceipt'],productionDataMutation=False,recoveryConfigurationMutation=False,additionalDeletion=False))
 e['finalApprovalRequests'].append(request);e['items']['7'].setdefault('progressCheckpoints',[]).append(dict(cp,atUtc=now,action=66));e['updatedAtUtc']=now
 c['files'].extend(rows);c['atUtc']=now
 need(e['actions'][:65]==old_e['actions']and e['finalApprovalRequests'][:1]==old_e['finalApprovalRequests']and c['files'][:872]==old_c['files'],'Historical preservation')
 for k in old_e:
  if k not in ('actions','items','updatedAtUtc','finalApprovalRequests'):need(e[k]==old_e[k],'Existing authorization/mutation drift')
 for k in old_c:
  if k not in ('files','atUtc'):need(c[k]==old_c[k],'Global representation drift')
 for k,v in old_e['items'].items():
  n=copy.deepcopy(e['items'][k])
  if k=='7':n['progressCheckpoints'].pop()
  need(n==v,'Historical item drift')
 outputs={E:encode(e),C:encode(c),T:baselines[T]+('\n'+m['trackerNote']+'\n').encode()}
 for p,b in outputs.items():need(len(b)<=LIMITS[p],'Prewrite document cap')
 need(not INTENT.exists()and not RECEIPT.exists(),'No automatic append retry')
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Preintent baseline drift')
 H.create(INTENT,encode(dict(schema='pow-audit30-action66-public-custody-intent-v1',baseHead=BASE,manifestSha256=sha(raw),baseline=[dict(path=str(p),bytes=len(b),sha256=sha(b))for p,b in baselines.items()],plannedOutputs=[dict(path=str(p),bytes=len(b),sha256=sha(b))for p,b in outputs.items()],newRows=rows,partialWriteRequiresExplicitReview=True,productionMutation=False)));syncdir(TMP)
 for p,b in targets.items():H.create(p,b);need(H.read(p)==b,'Created byte drift')
 syncdir(H.VERIFY)
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Prereplace baseline drift')
 for original,(_,b)in selected.items():need(H.read(Path(original))==b,'Public source drift during copy')
 for p,b in outputs.items():stage=p.with_name(p.name+'.action66-new');H.create(stage,b);os.replace(stage,p);syncdir(p.parent)
 for p,b in outputs.items():need(H.read(p,LIMITS[p])==b,'Final public output drift')
 receipt=dict(schema='pow-audit30-action66-public-custody-preservation-v1',atUtc=now,baseHead=BASE,manifestSha256=sha(raw),oldActionsPreserved=65,oldCustodyRowsPreserved=872,oldFinalApprovalRequestsPreserved=1,actionsNow=len(e['actions']),custodyRowsNow=len(c['files']),newRows=rows,productionMutation=False,nativeExecution=False,newRequestIsDispatchNotHumanApproval=True,hygieneCommitPushPending=True)
 H.create(RECEIPT,encode(receipt));syncdir(TMP);print(json.dumps({k:v for k,v in receipt.items()if k!='newRows'},sort_keys=True))
if __name__=='__main__':main()
