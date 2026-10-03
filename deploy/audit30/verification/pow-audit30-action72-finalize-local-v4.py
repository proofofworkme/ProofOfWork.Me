"""Local-only reconciliation through actual current-release UI census; no repository writes."""
from pathlib import Path
import copy,datetime,hashlib,json
TMP=Path('/tmp');REPO=Path('/home/sixer/ProofOfWork.Me')
def load(n):return json.loads((TMP/n).read_bytes())
def ref(n):
 p=TMP/n;r=p.read_bytes();return {'path':'deploy/audit30/verification/'+n,'bytes':len(r),'sha256':hashlib.sha256(r).hexdigest()}
q=load('pow-audit30-action72-proposed-update-v3.json');m=load('pow-audit30-action72-proposed-public-manifest-v3.json')
ui=load('pow-audit30-item2-ui-restage-v2-current-task-census-read-native-v1.stdout')
ret=load('pow-audit30-item2-retention-local-validation-20261003.json')
assert ui['all818InodeMetadataUnchanged']is True and ui['inputOriginalAbsent']is True and ui['currentTaskAllocatedBytes']==135168
assert ui['privateTemporaryStages']==[] and ui['stage']['absent']is True and all(r['absent']is True for r in ui['currentArtifactsOutsideScratch'])
assert ui['states']['publication']['LoadState']=='not-found' and ui['states']['ownedFailedRestage']['MainPID']=='0'
assert ret['totalTests']==31 and ret['allPassed']is True and ret['remoteInvocations']==0 and ret['singlePinInputsRejected']is True
a=q['proposedAction'];c=q['proposedCurrentContinuation'];now=ui['atUtc']
a['schema']='pow-audit30-action72-node-cutover-production-api-mail-acceptance-ui-pending-v1'
a['status']='node-code-cutover-and-production-api-mail-complete-frontend-publication-pending'
a['action']='Record the acknowledged item2-v3 API/worker source exchange, actual production strict-v2 and positive WORK/scoped acceptance, and actual HTTPS/raw/derived HTML acceptance of all619 mail records. Preserve the two earlier cutover refusals, production-v1 reader failures with restored timer windows, and all UI staging refusals as dated history. The latest read-only UI census confirms all818 protected input entries and old live/rollback roots unchanged, with no stage/source/archive produced. Frontend staging, publication and release hygiene/handoff remain in progress; no overall release completion is claimed.'
a['atUtc']=now;a['observedThroughUtc']=now
a['qualification']='Dated through the actual20:38:24 UTC current-release UI census. Production API/mail acceptance is complete. Frontend restage refused the original full-copy5GiB scratch capacity gate; only135168 current-release scratch bytes remain, which cannot cover the18694144-byte deficit. A separately reviewed new-release evidence-stage continuation is prepared only.'
a['uiRestageV2Refusal']['qualification']='Exact public stage-private-root guard refused the unchanged5GiB scratch ceiling. The later exact current-release census independently confirms all818 protected inputs/inodes, old live/retained fingerprints and hold metadata unchanged, with original input/stage/source/archive absent and no private temporary stages. Only135168 scratch bytes belong to this release; no move or cleanup authority is inferred.'
a['uiCurrentTaskCensus']={'status':'actual-read-only-pass','atUtc':ui['atUtc'],'machineBinding':ref('pow-audit30-item2-ui-restage-v2-current-task-census-read-native-v1.stdout'),'transport':ref('pow-audit30-item2-ui-restage-v2-current-task-census-read-native-v1.json'),'publicProjection':copy.deepcopy(ui),'currentReleaseScratchBytesInsufficientForDeficit':True,'olderArtifactInspection':False,'moveOrCleanupOrPublicationAuthority':False}
a['retentionLocalValidation']={'status':'actual-local-pass','atUtc':ret['observedAtUtc'],'machineBinding':ref('pow-audit30-item2-retention-local-validation-20261003.json'),'tests':31,'persistentOrderedDualPinTests':6,'namespaceTests':6,'installTests':19,'singlePinInputsRejected':True,'remoteInvocations':0,'historicalSinglePinEvidencePreserved':True}
a['uiEvidenceStageHelpersPrepared']={'status':'local-source-reviewed-fixtures-passed-only','releaseId':'38ac6e2bff2a-20261003T190512Z','stager':ref('pow-audit30-item2-ui-evidence-stage-stager-v2.py'),'provenance':ref('pow-audit30-item2-ui-evidence-stage-provenance-v2.sh'),'publisher':ref('pow-audit30-item2-ui-evidence-stage-publisher-v2.sh'),'fixtures':ref('pow-audit30-item2-ui-evidence-stage-v2.test.py'),'fixtureCount':11,'fullDeclaredInverseBytesVerified':True,'requiredOwnerCapacityGates':['global-var-tmp-deploy-5GiB-no-new-copy','actual-evidence-stage-full-copy-5GiB','total-ui-root-10GiB','retained-root64MiB-growth'],'productionInvoked':False,'publicationInvoked':False,'scopeQualification':'Exact190512 stage/source selectors under its existing evidence directory only. Original capacity, canonical path, mount, payload, archive, exchange and inverse bodies retained. Owner admission and actual staging/publication remain separate.'}
a['nextRequired']='Complete the separately reviewed exact new-release evidence-stage owner admission with unchanged global scratch5GiB, actual evidence-stage full-copy5GiB, total UI10GiB and64MiB growth gates. Finish source/archive provenance, guarded frontend publication and all actual HTTPS/surface checks, then this release hygiene/commit/push/handoff. Separate migration, physical/PITR/capacity, custody/dependency and global closure remain pending.'
c['atUtc']=now;c['observedThroughUtc']=now;c['statusQualification']=a['qualification']
for obj in [c['currentApiEvidence'],c['userRemainingChecklist']['2']]:
 obj['fullStrictStatus']='production-strict-v2-pass; node-cutover-complete; production-api-mail-pass; frontend-publication-pending'
 obj['blockingCheckQualification']='Original full-copy scratch guard refused18694144 bytes beyond the5GiB ceiling. Exact current-release census shows only135168 removable-scope bytes; no cleanup was authorized or performed. Prepared evidence-stage owner must retain all original capacity gates.'
 obj['walletAvailabilityQualification']='Actual production strict-v2 accepted HTTP200 with ready/balance/capacity true at stableCore969758 on20:22:53 UTC. The historical shadow503 at969752 remains unchanged in Action71 and strictMilestone.'
 obj['uiRestageV2Refusal']=copy.deepcopy(a['uiRestageV2Refusal']);obj['uiCurrentTaskCensus']=copy.deepcopy(a['uiCurrentTaskCensus'])
 obj['retentionLocalValidation']=copy.deepcopy(a['retentionLocalValidation']);obj['uiEvidenceStageHelpersPrepared']=copy.deepcopy(a['uiEvidenceStageHelpersPrepared']);obj['nextRequired']=a['nextRequired']
q['preparedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
q['requiredRootReconciliation']=['Root review the exact actual production strict/positive/mail/current UI census milestone and unchanged capacity refusal before applying this dated Action72.','Preserve every explicit public SHA binding without private body/address/environment or raw native3MiB/Exec/source output copies.','Keep the separately proposed evidence-stage owner and later actual staging/publication facts distinct from this dated census; do not infer publication from source preparation.','Keep item2in-progress for frontend and its own hygiene/handoff; global human6 remains pending separate3–5.']
names={r['original']['path']for r in m['members']}
extra=['pow-audit30-item2-retention-local-validation-20261003.json','pow-audit30-append-action72-v2.py','pow-audit30-action72-finalize-local-v3.py','pow-audit30-action72-finalize-local-v4.py',
 'pow-audit30-item2-ui-restage-v2-current-task-census-read-v1.py','pow-audit30-item2-ui-restage-v2-current-task-census-read-v1.test.py','pow-audit30-item2-ui-restage-v2-current-task-census-read-local-v1.py','pow-audit30-item2-ui-restage-v2-current-task-census-read-native-v1.stdout','pow-audit30-item2-ui-restage-v2-current-task-census-read-native-v1.stderr','pow-audit30-item2-ui-restage-v2-current-task-census-read-native-v1.json',
 'pow-audit30-item2-ui-evidence-stage-stager-v2.py','pow-audit30-item2-ui-evidence-stage-provenance-v2.sh','pow-audit30-item2-ui-evidence-stage-publisher-v2.sh','pow-audit30-item2-ui-evidence-stage-v2.test.py','pow-audit30-item2-ui-evidence-stage-v2-build.py']
for n in extra:
 p=TMP/n
 if str(p)in names:continue
 raw=p.read_bytes();target='deploy/audit30/verification/'+n;t=REPO/target
 if t.exists():assert t.read_bytes()==raw
 m['members'].append({'original':{'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},'proposedRepositoryPath':target,'repositoryPathAlreadyExists':t.exists()});names.add(str(p))
a['publicSourceCustodyAdded']=[{'repositoryPath':r['proposedRepositoryPath'],'bytes':r['original']['bytes'],'sha256':r['original']['sha256']}for r in m['members']]
p=TMP/'pow-audit30-action72-proposed-update-v4.json';raw=(json.dumps(q,indent=2,sort_keys=True)+'\n').encode()
with p.open('xb')as f:f.write(raw)
m['draft']={'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()};m['status']='explicit-public-list-api-mail-and-current-ui-census-reconciled-frontend-pending-awaiting-root-review'
p=TMP/'pow-audit30-action72-proposed-public-manifest-v4.json';data=(json.dumps(m,indent=2,sort_keys=True)+'\n').encode()
with p.open('xb')as f:f.write(data)
print(json.dumps({'draft':m['draft'],'manifest':{'path':str(p),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()},'members':len(m['members']),'trackerWritten':False,'productionCalls':False},sort_keys=True))
