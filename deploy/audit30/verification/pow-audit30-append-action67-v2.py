#!/usr/bin/python3 -I
"""Unexecuted fixed public Action67 append, using the frozen Action64 helpers.

Root must separately review the exact final manifest and admit one execution.
No remote/configuration operation is implemented. Old pending requests remain
historical; actual human response and configuration results append separately.
The body attempt cannot be classified from its failed transport alone.
"""
import base64,copy,datetime,hashlib,json,os,re,sys,types
from pathlib import Path
ROOT=Path('/home/sixer/ProofOfWork.Me');TMP=Path('/tmp')
BASE='6b121b8c1ddc8befbcfa09ae652ce71e82b34fe0'
PREV=ROOT/'deploy/audit30/verification/pow-audit30-append-action64-v3.py'
PREV_SHA='a171c5bf9b3090226a7e8331e8676a4fcf2a2d2d0bf39e135611dd89783e041c'
E=ROOT/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'
C=ROOT/'deploy/audit30/verification/source-custody.json'
T=ROOT/'audits/2026-10-02-audit30-followup-tracker.md'
CHECKER=ROOT/'scripts/check-retention-protection.py'
CHECKER_TEST=ROOT/'scripts/check-audit28-persistent-retention.py'
OLD_CHECKER='da5d1336ce857acc571ba0849c2b0150ef5fc6dfdacf80e65b9f1d3611c48e8a'
NEW_CHECKER='795f1308b74ddc69a022ce7e1413fb4698a82e6cfb14265931d1951ee603c908'
NEW_CHECKER_TEST='2adfcc7d670cfdbaadc0ac59290578bb97dc3c1d46a74df49887ce8dbe18048f'
SCOPE='fe09d0ba6c9c1e561a569fb425c9812f9b077cb646fbdd615768e0546ead0437'
HUMAN_SHA='184065046a3b6031ca0b47e5e1932321bab2672298a7da1fc9654c6d3a3fec49'
MESSAGE_SHA='d93213cc5dec29d6c4aaf3178f76597665211100423e41d61d60fd163dfb5dcf'
CONFIG_APPROVAL_SHA='46c60e55ab4b95a4b0f51d2efa17969466417c0ad53b8542a0de26667825b089'
CONFIG_COMPLETED_SHA='70c15c91665c1fb7ba62675b0809d2a67f6971eb1f2c215595505f28eb6000f3'
CONFIG_READBACK_SHA='5421a9fd55eb3a63cce35d03ec592515708a0d7aa22de4a6c0a847fbf96e60ae'
MANIFEST=TMP/'pow-audit30-action67-fixed-public-manifest-v1.json'
INTENT=TMP/'pow-audit30-action67-public-custody-intent-v1.json'
RECEIPT=TMP/'pow-audit30-action67-public-custody-preservation-v1.json'
LIMITS={E:32*1024**2,C:2*1024**2,T:2*1024**2}
ROLES=('humanResponseReceipt','humanMessageCapsule','bodyApprovalReceipt','configApprovalReceipt','configurationCompletedReceipt','configurationReadbackReceipt','configRootAcceptance','configPeerAcceptance','bodyAttemptReceipt','bodyReconciliationReceipt','bodyPeerAcceptance')
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
 b=PREV.read_bytes();need(sha(b)==PREV_SHA and len(b)==21939,'Frozen public helpers')
 H=types.ModuleType('frozen_public_custody_defs');H.__file__=str(PREV);exec(compile(b,str(PREV),'exec'),H.__dict__)
 need(H.git('rev-parse','HEAD').decode().strip()==BASE,'Exact Action66 HEAD')
 baselines={p:H.read(p,cap)for p,cap in LIMITS.items()}
 for p,b in baselines.items():need(b==H.git('show',BASE+':'+str(p.relative_to(ROOT))),'Tracked baseline drift')
 old_e=json.loads(baselines[E]);old_c=json.loads(baselines[C])
 need(len(old_e['actions'])==66 and len(old_c['files'])==890 and len(old_e['finalApprovalRequests'])==2 and 'finalApprovalResponses'not in old_e,'Fixed counts/new response namespace')
 for row in old_c['files']:
  b=H.prior_custody_bytes(row,old_c['storedRepresentations']);need(len(b)==row['bytes']and sha(b)==row['sha256'],'Prior public custody drift')
 checker=H.read(CHECKER);old_checker=H.git('show',BASE+':scripts/check-retention-protection.py')
 need(len(checker)==20718 and sha(checker)==NEW_CHECKER and len(old_checker)==20677 and sha(old_checker)==OLD_CHECKER,'Exact separately approved canonical checker sync')
 checker_test=H.read(CHECKER_TEST);need(len(checker_test)==4289 and sha(checker_test)==NEW_CHECKER_TEST,'Exact separately approved maintained test sync')
 raw=H.read(MANIFEST);need(sha(raw)==sys.argv[1],'Exact manifest SHA');m=json.loads(raw)
 keys={'schema','baseHead','files',*ROLES,'summary','trackerNote','item4Checkpoint','item7Checkpoint','tableUpdates'}
 need(set(m)==keys and m['schema']=='pow-audit30-action67-fixed-public-manifest-v1'and m['baseHead']==BASE,'Closed manifest')
 need(isinstance(m['files'],list)and 1<=len(m['files'])<=120 and isinstance(m['summary'],str)and len(m['summary'])<7000 and isinstance(m['trackerNote'],str)and len(m['trackerNote'])<10000,'Bounded fixed list/prose')
 selected={}
 for row in m['files']:
  p,b=H.public_binding(row);need(str(p)not in selected,'Duplicate path');selected[str(p)]=(row,b)
 need(str(Path(__file__).resolve())in selected,'Exact self source included')
 for name,expected in [('pow-audit30-canonical-dual-pin-retention-checker-v1.py',checker),('pow-audit30-canonical-dual-pin-persistent-retention-tests-v1.py',checker_test)]:need(str(TMP/name)in selected and selected[str(TMP/name)][1]==expected,'Exact canonical source/test custody')
 role_values={}
 for role in ROLES:
  p,b=H.public_binding(m[role]);need(str(p)in selected and selected[str(p)][0]==m[role],'Role bound and preserved');role_values[role]=json.loads(b)
 human=role_values['humanResponseReceipt'];need(m['humanResponseReceipt']['sha256']==HUMAN_SHA and human.get('schema')=='pow-audit30-direct-human-two-proposal-approval-v1'and human.get('status')=='approved'and human.get('authority')=='human'and human.get('sourceMessageSha256')==MESSAGE_SHA and human.get('sourceMessageBytes')==9,'Exact actual two-proposal human response')
 need(human.get('additionalDeletionApproved')is False and human.get('recoveryActivationApproved')is False and human.get('productionSchemaMigrationApproved')is False,'No broader human scope')
 need(len(human.get('approvedProposals',[]))==2,'Two exact proposals')
 for i,row in enumerate(human['approvedProposals']):
  request=old_e['finalApprovalRequests'][i];need(row['path']==str(ROOT/request['proposalPath'])and row['sha256']==request['proposalSHA256']and sha(H.read(Path(row['path'])))==row['sha256'],'Original two requested proposal identities')
 capsule=role_values['humanMessageCapsule'];need(set(capsule)=={'schema','kind','originalInput','encoding','rawBytes','rawSha256','rawBase64'}and capsule['schema']=='pow-audit30-exact-public-byte-custody-v1'and capsule['kind']=='direct-human-public-message'and capsule['encoding']=='base64'and capsule['originalInput']==human['sourceMessagePath'],'Exact public message capsule')
 message=base64.b64decode(capsule['rawBase64'],validate=True);need(message==b'i approve'and len(message)==capsule['rawBytes']==9 and sha(message)==capsule['rawSha256']==MESSAGE_SHA and H.read(Path(capsule['originalInput']))==message,'Exact actual message bytes')
 body=role_values['bodyApprovalReceipt'];need(body.get('schema')=='pow-audit30-exact-sixteen-production-approval-v1'and body.get('status')=='approved'and body.get('authority')=='human'and body.get('humanApprovalEvidenceSHA256')==HUMAN_SHA and body.get('productionDataChangeApproved')is True and body.get('targetCount')==16 and body.get('onlyMailItemsBodyText')is True and body.get('automaticRetryAllowed')is False and body.get('inverseRequiresSeparateInvocation')is True,'Separate exact16 approval only')
 approval=role_values['configApprovalReceipt'];need(m['configApprovalReceipt']['sha256']==CONFIG_APPROVAL_SHA and approval.get('schema')=='pow-audit30-coupled-pin-checker-direct-human-approval-v1'and approval.get('status')=='approved'and approval.get('scopeSha256')==SCOPE and approval.get('humanApprovalSourceSha256')==MESSAGE_SHA,'Separate exact configuration approval')
 completed=role_values['configurationCompletedReceipt'];need(m['configurationCompletedReceipt']['sha256']==CONFIG_COMPLETED_SHA and completed.get('schema')=='pow-audit30-logical-pin-checker-promotion-completed-v1'and completed.get('status')=='completed'and completed.get('scopeSha256')==SCOPE and completed.get('approvalReceiptSha256')==CONFIG_APPROVAL_SHA and completed.get('humanApprovalSourceSha256')==MESSAGE_SHA and completed.get('newCheckerSha256')==NEW_CHECKER,'Actual scoped V6 completion')
 need(completed.get('newPin')=='proof_indexer-20260929T031853Z.dumpset\nproof_indexer-20261003T031852Z.dumpset'and completed.get('oldPinBytesPreserved')is True and completed.get('individualAtomicReplacements')is True and completed.get('jointAtomicTransaction')is False and completed.get('knownHeldAbsencesUnresolved')==18 and completed.get('deletionAuthorized')is False and completed.get('recoveryActivation')is False,'Dual-pin preservation/limits')
 readback=role_values['configurationReadbackReceipt'];need(m['configurationReadbackReceipt']['sha256']==CONFIG_READBACK_SHA and readback.get('schema')=='pow-audit30-dual-pin-promotion-public-verification-v1'and readback.get('status')=='passed-fixed-receipt-and-installed-byte-verification'and readback.get('exactOrderedSep29AndOct3Pin')is True and readback.get('completedReceiptAndInstalledEndpointsEqual')is True and readback.get('configurationChangedByObserver')is False,'Actual two-postimage readback')
 rr=readback['receipt'];need(rr['sha256']==CONFIG_COMPLETED_SHA and base64.b64decode(rr['rawBase64'],validate=True)==selected[m['configurationCompletedReceipt']['path']][1],'Raw actual completed equality')
 need({row['path']:{'metadata':row['metadata'],'sha256':row['sha256']}for row in completed['installed']}==readback['installed'],'Actual installed metadata/SHA equality')
 for role in('configRootAcceptance','configPeerAcceptance','bodyReconciliationReceipt'):need(isinstance(role_values[role],dict)and bool(role_values[role]),'Reviewed nonempty public acceptance/reconciliation role')
 attempt=role_values['bodyAttemptReceipt'];need(attempt.get('exitCode')==1,'Preserved failed body invocation, not success')
 reconciliation=role_values['bodyReconciliationReceipt'];need(m['bodyReconciliationReceipt']['sha256']=='c58e4abf4cccb21efdc6b9d8119ba84a0774ead15c353eb7ce131df1e6c79e91'and reconciliation.get('schema')=='pow-audit30-body-run-readonly-reconciliation-v1'and reconciliation.get('failedRunRequestSHA256')==attempt['inputBindings']['requestSHA256']and reconciliation.get('rootControlSHA256')=='b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168','Exact same-attempt readonly reconciliation')
 need(reconciliation.get('commitOutcomeCertified')is False and reconciliation.get('sameAttemptDiscardedReasonRecovered')is False and reconciliation.get('liveFiveUnchanged')is True and reconciliation.get('endpointAbsentOrExactOwnedStopped')is True and reconciliation.get('observerProductionMutation')is False and reconciliation.get('observerSqlCoreApiCalls')is False and reconciliation.get('observerUnitControlCalls')is False,'Qualified endpoint/source-ordering evidence only')
 need(reconciliation.get('currentInertSourceFences')==[{'passed':True,'stage':'prepared-contract-current'},{'passed':True,'stage':'immutable-package-fence-current'}],'Prepared/package fences')
 receipts=reconciliation['receipts']
 for name in('evidence/commit-intent.json','evidence/completed.json','evidence/failed.json','evidence/intent.json','package/root-completed.json','package/root-native-capture.json','package/root-native-capture.json.failed.json','package/root-native-capture.json.stderr','package/root-worker-before.json'):need(receipts[name]=={'exists':False},'Writer/native evidence must be absent')
 need(receipts['package/root-intent.json']['exists']is True and receipts['package/root-failed.json']['exists']is True and receipts['package/root-intent.json']['publicFields']['humanApprovalSHA256']==m['bodyApprovalReceipt']['sha256']and receipts['package/root-intent.json']['publicFields']['rootControlSHA256']==reconciliation['rootControlSHA256']and receipts['package/root-failed.json']['publicFields']['productionCommitOutcomeMustBeReconciled']is True,'Preserved failed root attempt')
 unit=reconciliation['units']['proofofwork-audit30-production-sixteen-20261003T145500Z-apply.service'];need(unit['LoadState']=='not-found'and unit['MainPID']=='0'and unit['ActiveState']=='inactive'and unit['SubState']=='dead'and unit['InvocationID']==unit['ControlGroup']=='','No current production-writer unit')
 need(m['bodyPeerAcceptance']['sha256']=='b89e049b13f0f9728889d1eadc8f93588fb2d309702be3d0e11cd3984b3751f8'and isinstance(role_values['bodyPeerAcceptance'],dict)and bool(role_values['bodyPeerAcceptance']),'Exact independent qualified reconciliation review')
 cp4=m['item4Checkpoint'];cp7=m['item7Checkpoint']
 need(cp4.get('writerNotReachedInferred')is True and cp4.get('databaseCommitOutcomeCertified')is False and cp4.get('originalGuardReasonRecovered')is False and cp4.get('operativeReconciliationSourceFullyReviewedBeforeInvocation')is False,'No expanded outcome/pre-review claim')
 need(isinstance(cp4,dict)and cp4.get('complete')is False and cp4.get('productionRepairAccepted')is False and (cp4.get('productionDataMutation')is False or cp4.get('productionDataMutation')is None)and cp4.get('automaticRetry')is False,'Failed body attempt remains qualified')
 need(isinstance(cp7,dict)and cp7.get('complete')is False and cp7.get('promotionPerformed')is True and cp7.get('additionalDeletion')is False and cp7.get('recoveryActivation')is False,'Scoped completed configuration only, item7 incomplete')
 selected[str(MANIFEST)]=({'path':str(MANIFEST),'bytes':len(raw),'sha256':sha(raw),'type':'json-public-receipt'},raw)
 known={row['originalPath']:row for row in old_c['files']};need(len(known)==890,'Prior unique paths');targets={};rows=[]
 for original,(binding,b)in sorted(selected.items()):
  need(H.read(Path(original))==b,'Current public source drift')
  if original in known:
   need(H.prior_custody_bytes(known[original],old_c['storedRepresentations'])==b,'Known source drift');continue
  name,stored,extra=H.representation(Path(original),b);target=H.VERIFY/name
  need(target not in targets and not target.exists()and not target.is_symlink()and len(stored)<=H.MAX_INPUT,'Creation target/cap')
  targets[target]=stored;rows.append(dict(originalPath=original,repositoryPath=str(target.relative_to(ROOT)),bytes=len(stored),sha256=sha(stored),**extra))
 now=datetime.datetime.now(datetime.timezone.utc).isoformat();e=copy.deepcopy(old_e);c=copy.deepcopy(old_c)
 response={'atUtc':now,'humanResponseReceipt':m['humanResponseReceipt'],'humanMessageCapsule':m['humanMessageCapsule'],'priorRequestIndices':[0,1],'bodyApprovalReceipt':m['bodyApprovalReceipt'],'configApprovalReceipt':m['configApprovalReceipt'],'historicalPendingRequestsPreserved':True,'additionalDeletionApproved':False,'recoveryActivationApproved':False}
 e['finalApprovalResponses']=[response]
 e['actions'].append(dict(atUtc=now,action=m['summary'],publicSourceCustodyAdded=rows,actualHumanResponse=response,configurationCompletedReceipt=m['configurationCompletedReceipt'],configurationReadbackReceipt=m['configurationReadbackReceipt'],bodyAttemptReceipt=m['bodyAttemptReceipt'],bodyReconciliationReceipt=m['bodyReconciliationReceipt'],bodyPeerAcceptance=m['bodyPeerAcceptance'],productionDataMutation=cp4['productionDataMutation'],recoveryConfigurationMutation=True,recoveryActivation=False,additionalDeletion=False))
 for key,cp in(('4',cp4),('7',cp7)):e['items'][key].setdefault('progressCheckpoints',[]).append(dict(cp,atUtc=now,action=67))
 e['updatedAtUtc']=now;c['files'].extend(rows);c['atUtc']=now
 need(e['actions'][:66]==old_e['actions']and e['finalApprovalRequests']==old_e['finalApprovalRequests']and c['files'][:890]==old_c['files'],'Historical actions/requests/rows preserved')
 for k in old_e:
  if k not in('actions','items','updatedAtUtc'):need(e[k]==old_e[k],'Existing authorization/mutation/request drift')
 for k in old_c:
  if k not in('files','atUtc'):need(c[k]==old_c[k],'Global representation drift')
 for k,v in old_e['items'].items():
  n=copy.deepcopy(e['items'][k])
  if k in('4','7'):
   n['progressCheckpoints'].pop()
   if 'progressCheckpoints'not in v:need(not n['progressCheckpoints'],'Unexpected old item checkpoints');n.pop('progressCheckpoints')
  need(n==v,'Historical item drift')
 tracker=baselines[T];need(isinstance(m['tableUpdates'],list)and len(m['tableUpdates'])<=3,'Bounded current table updates')
 for update in m['tableUpdates']:
  need(set(update)=={'item','oldLine','newLine'}and update['item']in('4','7','8')and all(type(update[k])is str for k in update),'Closed table update')
  old=update['oldLine'].encode();new=update['newLine'].encode();prefix=('| '+update['item']+' | ').encode()
  need(old.startswith(prefix)and new.startswith(prefix)and b'\n'not in old+new and tracker.count(old+b'\n')==1,'Exact one old table row')
  tracker=tracker.replace(old+b'\n',new+b'\n',1)
 outputs={E:encode(e),C:encode(c),T:tracker+('\n'+m['trackerNote']+'\n').encode()}
 for p,b in outputs.items():need(len(b)<=LIMITS[p],'Prewrite document cap')
 need(not INTENT.exists()and not RECEIPT.exists(),'No automatic append retry')
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Preintent baseline drift')
 need(H.read(CHECKER)==checker,'Separately synced checker drift')
 need(H.read(CHECKER_TEST)==checker_test,'Separately synced test drift')
 H.create(INTENT,encode(dict(schema='pow-audit30-action67-public-custody-intent-v1',baseHead=BASE,manifestSha256=sha(raw),baseline=[dict(path=str(p),bytes=len(b),sha256=sha(b))for p,b in baselines.items()],plannedOutputs=[dict(path=str(p),bytes=len(b),sha256=sha(b))for p,b in outputs.items()],newRows=rows,canonicalCheckerPreimageGitBase=BASE,canonicalCheckerOldSha256=OLD_CHECKER,canonicalCheckerNewSha256=NEW_CHECKER,partialWriteRequiresExplicitReview=True,nativeExecution=False)));syncdir(TMP)
 for p,b in targets.items():H.create(p,b);need(H.read(p)==b,'Created byte drift')
 syncdir(H.VERIFY)
 for p,b in baselines.items():need(H.read(p,LIMITS[p])==b,'Prereplace baseline drift')
 for original,(_,b)in selected.items():need(H.read(Path(original))==b,'Public source drift during copy')
 need(H.read(CHECKER)==checker,'Canonical checker drift before replace')
 need(H.read(CHECKER_TEST)==checker_test,'Canonical maintained test drift before replace')
 for p,b in outputs.items():stage=p.with_name(p.name+'.action67-new');H.create(stage,b);os.replace(stage,p);syncdir(p.parent)
 for p,b in outputs.items():need(H.read(p,LIMITS[p])==b,'Final public output drift')
 receipt=dict(schema='pow-audit30-action67-public-custody-preservation-v1',atUtc=now,baseHead=BASE,manifestSha256=sha(raw),oldActionsPreserved=66,oldCustodyRowsPreserved=890,oldFinalApprovalRequestsPreserved=2,actionsNow=len(e['actions']),custodyRowsNow=len(c['files']),newRows=rows,actualHumanResponseAdded=True,configurationPromotionRecorded=True,bodyOutcomeQualification=cp4['productionDataMutation'],nativeExecution=False,canonicalCheckerNotWrittenByHelper=True,hygieneCommitPushPending=True)
 H.create(RECEIPT,encode(receipt));syncdir(TMP);print(json.dumps({k:v for k,v in receipt.items()if k!='newRows'},sort_keys=True))
if __name__=='__main__':main()
