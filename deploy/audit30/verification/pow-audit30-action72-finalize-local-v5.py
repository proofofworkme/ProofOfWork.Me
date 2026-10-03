"""Local-only peer wording reconciliation; every frozen predecessor remains unchanged."""
from pathlib import Path
import copy,datetime,hashlib,json
TMP=Path('/tmp');REPO=Path('/home/sixer/ProofOfWork.Me')
q=json.loads((TMP/'pow-audit30-action72-proposed-update-v4.json').read_bytes())
m=json.loads((TMP/'pow-audit30-action72-proposed-public-manifest-v4.json').read_bytes())
a=q['proposedAction'];c=q['proposedCurrentContinuation']
a['nextRequired']='Complete the separately reviewed exact new-release evidence-stage owner admission with unchanged global scratch5GiB and actual evidence-stage full-copy5GiB gates, plus root-filesystem10GiB free-space reserve,64MiB growth reserve and128-free-inode reserve. Finish source/archive provenance, guarded frontend publication and all actual HTTPS/surface checks, then this release hygiene/commit/push/handoff. Separate migration, physical/PITR/capacity, custody/dependency and global closure remain pending.'
a['uiEvidenceStageHelpersPrepared']['requiredOwnerCapacityGates']=['global-var-tmp-deploy-5GiB-no-new-copy','actual-evidence-stage-full-copy-5GiB','root-filesystem10GiB-free-space-reserve','root-filesystem64MiB-growth-reserve','128-free-inode-reserve']
for obj in [c['currentApiEvidence'],c['userRemainingChecklist']['2']]:
 obj['nextRequired']=a['nextRequired'];obj['uiEvidenceStageHelpersPrepared']=copy.deepcopy(a['uiEvidenceStageHelpersPrepared'])
 obj['blockingCheckQualification']='Original full-copy scratch guard refused18694144 bytes beyond the5GiB ceiling. Exact current-release census shows only135168 release-owned scratch bytes; no cleanup was authorized or performed. Prepared evidence-stage owner must retain all original capacity gates.'
 if isinstance(obj.get('cutoverStatus'),dict):
  cut=obj['cutoverStatus'];cut['historicalAtCutoverQualification']=cut['qualification']
  cut['qualification']='The dated19:54 source-exchange event is complete. Subsequent actual production strict/positive/scoped and619 raw/derivedHTML mail acceptance passed; frontend publication and release hygiene/handoff remain pending.'
  cut['qualificationObservedThroughUtc']=a['observedThroughUtc']
q['preparedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
q['peerReviewQualification']='Peer reviewed actual API/mail and dated current UI census; this successor corrects only the current cutover qualification and names10GiB/64MiB/128 as root-filesystem free-space/growth/inode reserves. Frozen predecessors remain preserved.'
p=TMP/'pow-audit30-action72-finalize-local-v5.py';raw=p.read_bytes();target='deploy/audit30/verification/'+p.name
assert str(p)not in {r['original']['path']for r in m['members']}
m['members'].append({'original':{'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},'proposedRepositoryPath':target,'repositoryPathAlreadyExists':(REPO/target).exists()})
a['publicSourceCustodyAdded']=[{'repositoryPath':r['proposedRepositoryPath'],'bytes':r['original']['bytes'],'sha256':r['original']['sha256']}for r in m['members']]
p=TMP/'pow-audit30-action72-proposed-update-v5.json';raw=(json.dumps(q,indent=2,sort_keys=True)+'\n').encode()
with p.open('xb')as f:f.write(raw)
m['draft']={'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
p=TMP/'pow-audit30-action72-proposed-public-manifest-v5.json';raw=(json.dumps(m,indent=2,sort_keys=True)+'\n').encode()
with p.open('xb')as f:f.write(raw)
print(json.dumps({'draft':m['draft'],'manifest':{'path':str(p),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()},'members':len(m['members']),'repositoryWritten':False,'productionCalls':False},sort_keys=True))
