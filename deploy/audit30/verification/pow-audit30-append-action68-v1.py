#!/usr/bin/python3 -I
"""Source-only fixed Action68 append. Root owns separate exact admission/execution.

Preserve the still-uncommitted authenticated Action67 output, all approval history,
and all custody. Add only standalone original-guard PASS and qualified second
pre-writer refusal. Locked-context diagnosis is pending; no success receiver.
"""
import copy, datetime, hashlib, json, os, re, sys, types
from pathlib import Path

ROOT=Path('/home/sixer/ProofOfWork.Me');TMP=Path('/tmp')
BASE='6b121b8c1ddc8befbcfa09ae652ce71e82b34fe0'
PREV=ROOT/'deploy/audit30/verification/pow-audit30-append-action64-v3.py'
PREV_SHA='a171c5bf9b3090226a7e8331e8676a4fcf2a2d2d0bf39e135611dd89783e041c'
PRIOR_INTENT=TMP/'pow-audit30-action67-public-custody-intent-v1.json'
PRIOR_INTENT_SHA='c3d4ea8680bdb96f9d3f1607c2c08a3c88c0c504d2668ada7c217b380d816d8c'
PRIOR_RECEIPT=TMP/'pow-audit30-action67-public-custody-preservation-v1.json'
PRIOR_RECEIPT_SHA='b9f5bb44d570d7d4f02a3a77b541a506d5bb89b76de5927633c9aa0fe6838fa8'
E=ROOT/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'
C=ROOT/'deploy/audit30/verification/source-custody.json'
T=ROOT/'audits/2026-10-02-audit30-followup-tracker.md'
LIMITS={E:32*1024**2,C:2*1024**2,T:2*1024**2}
CHECKER=ROOT/'scripts/check-retention-protection.py'
CHECKER_TEST=ROOT/'scripts/check-audit28-persistent-retention.py'
CHECKER_SHA='795f1308b74ddc69a022ce7e1413fb4698a82e6cfb14265931d1951ee603c908'
CHECKER_TEST_SHA='2adfcc7d670cfdbaadc0ac59290578bb97dc3c1d46a74df49887ce8dbe18048f'
MANIFEST=TMP/'pow-audit30-action68-fixed-public-manifest-v1.json'
INTENT=TMP/'pow-audit30-action68-public-custody-intent-v1.json'
RECEIPT=TMP/'pow-audit30-action68-public-custody-preservation-v1.json'
GUARD_SHA='48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c'
ROOT_CONTROL_SHA='b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168'
APPROVAL_SHA='f37e16a1d9b8c6f52081a7c44d01d8a5142051770d7d16aafe9fcaa9e5354c42'
REQUEST_SHA='f97ce8dbd4cdc00ad4f591a02aee4ec99478cb2e4fb9e96742d43802e5a95b31'
ROOT_SECOND_SHA='b9de7f98b7808bc3bd85bb0d336e48079ff9b8fc8477bfaaa9076903de56c007'
ROLES=('standaloneGuardReceipt','standaloneRootAcceptance','standalonePeerAcceptance',
       'secondAttemptReceipt','secondReconciliationReceipt','secondRootAcceptance',
       'secondPeerAcceptance')
ABSENT=('evidence/commit-intent.json','evidence/completed.json','evidence/failed.json',
        'evidence/intent.json','package/root-completed.json','package/root-native-capture.json',
        'package/root-native-capture.json.failed.json','package/root-native-capture.json.stderr',
        'package/root-worker-before.json')
def need(v,s):
 if not v:raise ValueError(s)
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return(json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def syncdir(p):
 fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def validate_roles(m,selected):
 values={}
 for role in ROLES:
  need(isinstance(m[role],dict),'Actual reviewed role still pending')
  p=Path(m[role]['path']);need(str(p)in selected and selected[str(p)][0]==m[role],'Role selected/raw bound')
  values[role]=json.loads(selected[str(p)][1]);need(isinstance(values[role],dict)and bool(values[role]),'Reviewed nonempty role')
 guard=values['standaloneGuardReceipt']
 need(m['standaloneGuardReceipt']['sha256']=='70cd1cd2be29c2e78b6fec7192c88a795914abdf64d21984f9c3cd56bc61bda8'and guard['schema']=='pow-audit30-original-worker-guard-readonly-diagnostic-v1'and guard['originalGuardSHA256']==GUARD_SHA and guard['guardPassed']is True and guard['writerInvoked']is False and guard['sameAttemptDiscardedFailureRecovered']is False and guard['productionMutation']is False and guard['liveFiveUnchangedAndOriginal']is True,'Standalone original guard observation only')
 root=values['standaloneRootAcceptance'];need(root['acceptedOriginalGuardPointInTime']is True and root['stdoutSHA256']==m['standaloneGuardReceipt']['sha256']and root['sameAttemptDiscardedFailureRecovered']is False and root['writerInvoked']is False,'Root standalone guard acceptance')
 attempt=values['secondAttemptReceipt'];need(attempt['exitCode']==1 and attempt['inputBindings']['requestSHA256']==REQUEST_SHA,'Actual second failed invocation')
 r=values['secondReconciliationReceipt'];need(m['secondReconciliationReceipt']['sha256']=='8f1ec874de90d6fbcc5e5bf03dc03a372ba1c0fc87dec6d231d024721034c67e'and r['schema']=='pow-audit30-body-run-readonly-reconciliation-v1'and r['failedRunRequestSHA256']==REQUEST_SHA and r['rootControlSHA256']==ROOT_CONTROL_SHA,'Same second attempt reconciliation')
 need(r['commitOutcomeCertified']is False and r['sameAttemptDiscardedReasonRecovered']is False and r['liveFiveUnchanged']is True and r['endpointAbsentOrExactOwnedStopped']is True and r['observerProductionMutation']is False and r['observerSqlCoreApiCalls']is False and r['observerUnitControlCalls']is False,'Qualified endpoint only')
 need(r['currentInertSourceFences']==[{'passed':True,'stage':'prepared-contract-current'},{'passed':True,'stage':'immutable-package-fence-current'}],'Current package/source fences')
 for name in ABSENT:need(r['receipts'][name]=={'exists':False},'Writer/native receipt must remain absent')
 need(r['receipts']['package/root-intent.json']['publicFields']['humanApprovalSHA256']==APPROVAL_SHA and r['receipts']['package/root-intent.json']['publicFields']['rootControlSHA256']==ROOT_CONTROL_SHA and r['receipts']['package/root-failed.json']['publicFields']['productionCommitOutcomeMustBeReconciled']is True,'Preserved durable second failure')
 unit=r['units']['proofofwork-audit30-production-sixteen-20261003T152000Z-apply.service'];need((unit['LoadState'],unit['ActiveState'],unit['SubState'],unit['MainPID'],unit['InvocationID'],unit['ControlGroup'])==('not-found','inactive','dead','0','',''),'Current writer endpoint absent')
 root=values['secondRootAcceptance'];need(m['secondRootAcceptance']['sha256']==ROOT_SECOND_SHA and root['schema']=='pow-audit30-root-body-refusal-reconciliation-acceptance-v1'and root['runId']=='20261003T152000Z'and root['reconciliationStdoutSHA256']==m['secondReconciliationReceipt']['sha256']and root['writerRouteNotReachedInference']is True and root['operativeReconciliationSourceFullyReviewedBeforeInvocation']is True and all(root[k]is False for k in ('globalDatabaseNoChangeCertified','commitOutcomeCertified','productionBodyRepairComplete','originalDiscardedFailureConjunctRecovered','thirdAttemptExecuted','inverseExecuted','cutoverExecuted')),'Root qualified second refusal acceptance')
 cp=m['item4Checkpoint'];need(cp['complete']is False and cp['productionRepairAccepted']is False and cp['writerNotReachedInferred']is True and cp['databaseCommitOutcomeCertified']is False and cp['originalGuardReasonRecovered']is False and cp['standaloneOriginalGuardPassed']is True and cp['lockedContextDiagnosisCertified']is False and cp['thirdAttemptExecuted']is False and cp['productionDataMutation']is False,'No success/new authority claim')
 need(m['lockedContextDiagnostic']=={'status':'pending-not-certified'},'No invented context diagnosis')
 return values
def main():
 need(sys.flags.isolated and sys.dont_write_bytecode and len(sys.argv)==2 and re.fullmatch('[a-f0-9]{64}',sys.argv[1]),'Exact isolated fixed manifest role')
 b=PREV.read_bytes();need(len(b)==21939 and sha(b)==PREV_SHA,'Frozen public helper bytes')
 H=types.ModuleType('frozen_read_create_representation');H.__file__=str(PREV);exec(compile(b,str(PREV),'exec'),H.__dict__)
 need(H.git('rev-parse','HEAD').decode().strip()==BASE,'Fixed still-uncommitted baseline HEAD')
 prior_raw=H.read(PRIOR_INTENT);receipt_raw=H.read(PRIOR_RECEIPT);need(sha(prior_raw)==PRIOR_INTENT_SHA and sha(receipt_raw)==PRIOR_RECEIPT_SHA,'Actual Action67 lineage')
 prior=json.loads(prior_raw);receipt=json.loads(receipt_raw);need(prior['baseHead']==receipt['baseHead']==BASE and receipt['actionsNow']==67 and receipt['custodyRowsNow']==987,'Prior actual Action67 counts')
 bindings={Path(r['path']):r for r in prior['plannedOutputs']};need(set(bindings)==set(LIMITS),'Exact Action67 document lineage')
 baselines={p:H.read(p,cap)for p,cap in LIMITS.items()}
 for p,b in baselines.items():need(len(b)==bindings[p]['bytes']and sha(b)==bindings[p]['sha256'],'Action67 document drift')
 old_e=json.loads(baselines[E]);old_c=json.loads(baselines[C]);need(len(old_e['actions'])==67 and len(old_c['files'])==987 and len(old_e['finalApprovalRequests'])==2 and len(old_e['finalApprovalResponses'])==1,'Fixed Action67 history cardinality')
 for row in old_c['files']:
  raw=H.prior_custody_bytes(row,old_c['storedRepresentations']);need(len(raw)==row['bytes']and sha(raw)==row['sha256'],'Old custody byte drift')
 checker=H.read(CHECKER);test=H.read(CHECKER_TEST);need(sha(checker)==CHECKER_SHA and sha(test)==CHECKER_TEST_SHA,'Approved canonical postimages remain')
 raw=H.read(MANIFEST);need(sha(raw)==sys.argv[1],'Exact manifest raw SHA');m=json.loads(raw)
 need(set(m)=={'schema','baseHead','files',*ROLES,'summary','trackerNote','item4Checkpoint','tableUpdate','lockedContextDiagnostic'}and m['schema']=='pow-audit30-action68-fixed-public-manifest-v1'and m['baseHead']==BASE,'Closed typed manifest')
 need(isinstance(m['files'],list)and 1<=len(m['files'])<=100 and isinstance(m['summary'],str)and len(m['summary'])<6000 and isinstance(m['trackerNote'],str)and len(m['trackerNote'])<8000,'Bounded explicit public list')
 selected={}
 for row in m['files']:
  p,b=H.public_binding(row);need(str(p)not in selected,'Duplicate fixed source');selected[str(p)]=(row,b)
 need(str(Path(__file__).resolve())in selected,'Exact self source custody')
 validate_roles(m,selected)
 selected[str(MANIFEST)]=({'path':str(MANIFEST),'bytes':len(raw),'sha256':sha(raw),'type':'json-public-receipt'},raw)
 known={r['originalPath']:r for r in old_c['files']};need(len(known)==987,'Old unique paths');targets={};rows=[]
 for original,(binding,b)in sorted(selected.items()):
  need(H.read(Path(original))==b,'Current explicit source drift')
  if original in known:
   need(H.prior_custody_bytes(known[original],old_c['storedRepresentations'])==b,'Known source drift');continue
  name,stored,extra=H.representation(Path(original),b);target=H.VERIFY/name
  need(target not in targets and not target.exists()and not target.is_symlink()and len(stored)<=H.MAX_INPUT,'New exclusive target/cap');targets[target]=stored;rows.append(dict(originalPath=original,repositoryPath=str(target.relative_to(ROOT)),bytes=len(stored),sha256=sha(stored),**extra))
 now=datetime.datetime.now(datetime.timezone.utc).isoformat();e=copy.deepcopy(old_e);c=copy.deepcopy(old_c)
 e['actions'].append(dict(atUtc=now,action=m['summary'],publicSourceCustodyAdded=rows,standaloneGuardReceipt=m['standaloneGuardReceipt'],secondAttemptReceipt=m['secondAttemptReceipt'],secondReconciliationReceipt=m['secondReconciliationReceipt'],secondRootAcceptance=m['secondRootAcceptance'],secondPeerAcceptance=m['secondPeerAcceptance'],lockedContextDiagnostic=m['lockedContextDiagnostic'],productionDataMutation=False,productionDataMutationQualification='Reviewed writer-route-not-reached inference for this failed attempt; no global database/COMMIT certificate.',recoveryConfigurationMutation=False,additionalDeletion=False,automaticRetry=False))
 e['items']['4'].setdefault('progressCheckpoints',[]).append(dict(m['item4Checkpoint'],atUtc=now,action=68));e['updatedAtUtc']=now;c['files'].extend(rows);c['atUtc']=now
 need(e['actions'][:67]==old_e['actions']and c['files'][:987]==old_c['files'],'Historical values preserved')
 for k in old_e:
  if k not in ('actions','items','updatedAtUtc'):need(e[k]==old_e[k],'All old authorization/response/request objects unchanged')
 for k in old_c:
  if k not in ('files','atUtc'):need(c[k]==old_c[k],'Global representation drift')
 for k,v in old_e['items'].items():
  n=copy.deepcopy(e['items'][k])
  if k=='4':n['progressCheckpoints'].pop()
  need(n==v,'Historical item drift')
 update=m['tableUpdate'];need(set(update)=={'item','oldLine','newLine'}and update['item']=='4'and all(type(x)is str for x in update.values()),'Only item4 current table row')
 old=update['oldLine'].encode();new=update['newLine'].encode();need(old.startswith(b'| 4 | ')and new.startswith(b'| 4 | ')and b'\n'not in old+new and baselines[T].count(old+b'\n')==1,'Exact one current row')
 tracker=baselines[T].replace(old+b'\n',new+b'\n',1)+('\n'+m['trackerNote']+'\n').encode();outputs={E:encode(e),C:encode(c),T:tracker}
 for p,b in outputs.items():need(len(b)<=LIMITS[p],'Prewrite document cap')
 need(not INTENT.exists()and not RECEIPT.exists(),'No automatic append retry')
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Preintent baseline drift')
 need(H.read(CHECKER)==checker and H.read(CHECKER_TEST)==test,'Canonical source drift')
 H.create(INTENT,encode(dict(schema='pow-audit30-action68-public-custody-intent-v1',baseHead=BASE,manifestSha256=sha(raw),priorAction67IntentSha256=PRIOR_INTENT_SHA,priorAction67ReceiptSha256=PRIOR_RECEIPT_SHA,baseline=[dict(path=str(p),bytes=len(b),sha256=sha(b))for p,b in baselines.items()],plannedOutputs=[dict(path=str(p),bytes=len(b),sha256=sha(b))for p,b in outputs.items()],newRows=rows,partialWriteRequiresExplicitReview=True,nativeExecution=False)));syncdir(TMP)
 for p,b in targets.items():H.create(p,b);need(H.read(p)==b,'Created byte drift')
 syncdir(H.VERIFY)
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Prereplace baseline drift')
 for original,(_,b)in selected.items():need(H.read(Path(original))==b,'Public source drift during copy')
 need(H.read(CHECKER)==checker and H.read(CHECKER_TEST)==test,'Canonical bytes drift before replace')
 for p,b in outputs.items():stage=p.with_name(p.name+'.action68-new');H.create(stage,b);os.replace(stage,p);syncdir(p.parent)
 for p,b in outputs.items():need(H.read(p,LIMITS[p])==b,'Final public document drift')
 result=dict(schema='pow-audit30-action68-public-custody-preservation-v1',atUtc=now,baseHead=BASE,manifestSha256=sha(raw),oldActionsPreserved=67,oldCustodyRowsPreserved=987,oldHistoricalRequestsPreserved=2,oldActualResponsePreserved=1,actionsNow=len(e['actions']),custodyRowsNow=len(c['files']),newRows=rows,standaloneOriginalGuardOnlyAccepted=True,secondBodyRepairAccepted=False,lockedContextDiagnosisCertified=False,nativeExecution=False,canonicalCheckerNotWritten=True,hygieneCommitPushPending=True)
 H.create(RECEIPT,encode(result));syncdir(TMP);print(json.dumps({k:v for k,v in result.items()if k!='newRows'},sort_keys=True))
if __name__=='__main__':main()
