#!/usr/bin/python3 -I
"""Preserve fixed public evidence and append a qualified audit checkpoint only."""
from pathlib import Path
import base64,copy,datetime,hashlib,json,os,stat
ROOT=Path('/home/sixer/ProofOfWork.Me');TMP=Path('/tmp')
def sha(b):return hashlib.sha256(b).hexdigest()
def encode(v):return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def create(p,b):
 fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
def read(p):
 s=p.lstat();assert stat.S_ISREG(s.st_mode)and s.st_nlink==1 and p.resolve(strict=True)==p and s.st_size<2*1024**2
 b=p.read_bytes();z=p.lstat();assert (z.st_dev,z.st_ino,z.st_mode,z.st_uid,z.st_gid,z.st_nlink,z.st_size,z.st_mtime_ns,z.st_ctime_ns)==(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)and len(b)==s.st_size;return b
families=(
 'pow-audit30-logical-backup-journal-refusal-diagnostic-',
 'pow-audit30-logical-backup-journal-bounded-',
 'pow-audit30-physical-sizing-failure-observer-',
 'pow-audit30-production-pg-identity-readonly-',
 'pow-audit30-oct3-full-read-',
 'pow-audit30-oct3-latest-backup-full-read-',
 'pow-audit30-latest-logical-restore-signal-',
 'pow-audit30-oct3-logical-restore-',
)
extra=(
 'pow-audit30-append-action62-v1.py',
 'pow-audit30-append-action62-v2.py',
 'pow-audit30-independent-logical-journal-diagnostic-source-review-v1.json',
 'pow-audit30-vps-peer-logical-journal-bounded-source-review-v1.json',
 'pow-audit30-independent-physical-sizing-failure-observer-source-review-v2.json',
 'pow-audit30-production-physical-sizing-request-v3.json',
 'pow-audit30-production-physical-sizing-native-v3.json',
 'pow-audit30-production-physical-sizing-native-v3.stderr',
 'pow-audit30-physical-sizing-identity-binding-diagnosis-v1.json',
 'pow-audit30-independent-production-pg-identity-source-review-v1.json',
 'pow-audit30-independent-oct3-full-read-source-review-v1.json',
 'pow-audit30-independent-oct3-full-read-actual-request-review-v1.json',
 'pow-audit30-independent-logical-restore-signal-source-review-v2.json',
 'pow-audit30-new-oct3-logical-restore-contract-preparation-v1.json',
 'pow-audit30-oct3-new-logical-restore-local-preparation-v1.json',
 'pow-audit30-independent-oct3-restore-template-review-v1.json',
 'pow-audit30-independent-oct3-concrete-restore-binding-review-v1.json',
 'pow-audit30-new-oct3-restore-running-observation-v1.json',
)
E=ROOT/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json';C=ROOT/'deploy/audit30/verification/source-custody.json';T=ROOT/'audits/2026-10-02-audit30-followup-tracker.md'
e=json.loads(E.read_bytes());c=json.loads(C.read_bytes());oldE=copy.deepcopy(e);oldC=copy.deepcopy(c);assert len(e['actions'])==61 and len(c['files'])==536
for row in c['files']:
 b=(ROOT/row['repositoryPath']).read_bytes();assert len(b)==row['bytes']and sha(b)==row['sha256']
selected={p for pre in families for p in TMP.glob(pre+'*')if p.is_file()};selected|={TMP/n for n in extra}
assert all(p.exists()for p in selected)
known={r['originalPath']:r for r in c['files']};rows=[];paths=[]
for p in sorted(selected):
 assert p.parent==TMP and p.suffix in('.py','.json','.diff','.stdout','.stderr')
 raw=read(p)
 if not raw:continue
 if str(p)in known:
  assert known[str(p)].get('rawSha256',known[str(p)]['sha256'])==sha(raw);continue
 name=p.name
 if p.suffix in('.stdout','.stderr'):
  json.loads(raw);name+='.json';b=raw;representation={}
 elif p.suffix=='.diff':
  b=encode({'schema':'pow-audit30-exact-public-diff-byte-custody-v1','originalInput':str(p),'rawBase64':base64.b64encode(raw).decode(),'rawBytes':len(raw),'rawSha256':sha(raw)})
  name+='.evidence.json';representation={'representation':'closed-base64-envelope-preserves-exact-raw-input','rawBytes':len(raw),'rawSha256':sha(raw)}
 else:b=raw;representation={}
 target=ROOT/'deploy/audit30/verification'/name
 if target.exists():assert read(target)==b
 else:create(target,b)
 row={'bytes':len(b),'originalPath':str(p),'repositoryPath':str(target.relative_to(ROOT)),'sha256':sha(b),**representation};rows.append(row);paths.append(row['repositoryPath'])
now=datetime.datetime.now(datetime.timezone.utc).isoformat();journal=json.loads((TMP/'pow-audit30-logical-backup-journal-bounded-native-v1.stdout').read_bytes());failure=json.loads((TMP/'pow-audit30-physical-sizing-failure-observer-native-v2.stdout').read_bytes());full=json.loads((TMP/'pow-audit30-oct3-full-read-native-102500-v1.stdout').read_bytes());identity=json.loads((TMP/'pow-audit30-production-pg-identity-readonly-native-v1.stdout').read_bytes());running=json.loads((TMP/'pow-audit30-new-oct3-restore-running-observation-v1.json').read_bytes())
assert journal['journalSelectionParsed']and not journal['rotationCollectorPassed'];assert failure['savedCleanupVerified']and failure['endpointAbsentOrExactOwnedStopped']and failure['stderrSourceGuard']=='FIXED_LIVE_PG16_IDENTITY';assert full['status']=='passed'and full['unitStopVerified']and full['result']['allThreeMemberHashesVerified'];assert identity['status']=='observed-readonly-identity'and identity['productionIdentity']['systemIdentifier']=='7652445986754609384';assert running['newUnitRunningObserved']and not running['restoreCompleted']
text=('Action62 preserves all61 prior action values and536 custody rows. Actual10:17 fixed diagnostic proves Oct2-read and first-sizing prelaunch unit/evidence absence only at that endpoint; its fixed journal read exits0 with236B allocation/mapping-warning stderr, not an accepted clean selection or sole-cause certificate. Actual10:27 audit-only1GiB bounded journal read exits0 with empty stderr, using the unchanged fixed parser. Its selected scheduled dfda5 backup invocation reports keeping Oct3, deleting Oct2 and preserving pinned Sep29; this is a qualified historical action report plus current absence, not a full journal-history certificate. No agent backup deletion or pin/checker change occurred. The distinct10:18 sizing attempt creates a failed audit job. Actual10:30 fixed saved-outcome observer proves its cleanup verified and the same704282 invocation stopped with MainPID0/empty ControlGroup; no accepted sizing result. Closed leaf failure is FIXED_LIVE_PG16_IDENTITY. The audit source incorrectly borrowed systemIdentifier7692221671691040144 from private clones. A separate10:39 READ ONLY identity observation confirms production7652445986754609384/160015/timeline1, transaction readOnly on, originalfive/static endpoints unchanged and owned client reaped. It does not retroactively observe every failed conjunct or measure physical size. Actual10:31:39-10:32:57 full Oct3 read passes in78.020104s: all three exact member hashes, stable FD/path/lock metadata and first discovered197-entry catalog f4dc249; managed audit unit stopped and originalfive/static protection unchanged. This is content/catalog proof, not restore equivalence. Tested signal successor753a and byte-equal fd946 combined creator bind the new104500 isolated restore plan6f870/requestcaf75 and the actual Oct3 source. At10:38 the exact new322aeb unit is observed active/running/MainPID3106608 with MemoryMax8GiB/RuntimeMax2h. Full restore, roles/ACL/allrows/credit/page/offline/private-stop/capacity receipts remain pending; no current restore PASS. Oct2-specific promotion/retirement plans stay blocked, and any replacement survivor-specific promotion/recovery/additional deletion still requires final approval. All failures and raw diffs are preserved as exact public evidence/envelopes. The first local custody helper refuses an atime-inclusive stat comparison after partial public copies; the corrected helper preserves those copies, verifies exact bytes, and excludes only access time from the stability comparison. No remote operation was repeated. Exact16 final production-data approval remains requested and unanswered; May9 operator-paid/noIDs remains unchanged. No production repair, API/worker/UI cutover, live recovery activation, extra retirement, global dependency closure or automatic retry occurred.')
actual={name:json.loads((TMP/name).read_bytes())for name in('pow-audit30-logical-backup-journal-refusal-diagnostic-native-v1.json','pow-audit30-logical-backup-journal-bounded-native-v1.json','pow-audit30-production-physical-sizing-native-v3.json','pow-audit30-physical-sizing-failure-observer-native-v2.json','pow-audit30-oct3-full-read-native-102500-v1.json','pow-audit30-production-pg-identity-readonly-native-v1.json')}
action={'atUtc':now,'action':text,'actualReadonlyTransportReceipts':actual,'publicSourceCustodyAdded':rows,'scheduledBackupRotationSelection':journal['journalSelection'],'sizingFailureAndCurrentCleanup':{k:failure[k]for k in('savedOutcome','stderrSummary','stderrSourceGuard','savedCleanupVerified','endpointAbsentOrExactOwnedStopped')},'productionIdentityObservation':identity['productionIdentity'],'currentOct3ContentProof':{'transportSeconds':actual['pow-audit30-oct3-full-read-native-102500-v1.json']['seconds'],'outcomeBinding':full['outcome'],'allThreeMemberHashesVerified':True,'catalogEntries':full['result']['toc']['entries'],'catalogSha256':full['result']['toc']['sha256'],'auditUnitStopVerified':True,'isolatedRestoreEquivalent':False},'newIsolatedRestoreRunningObservation':running,'productionDataMutation':False,'recoveryConfigurationMutation':False,'additionalDeletion':False}
e['actions'].append(action);e['updatedAtUtc']=now;e['items']['7']['status']='Historical Oct2 restore remains dated valid; its current source is absent and its old promotion/retirement plans stay blocked. Scheduled backup journal reports Oct3-kept/Oct2-deleted/Sep29-pinned. Current Oct3 all-three hashes/catalog pass; new isolated104500 restore is running, final equivalence/private-stop/capacity receipts pending. Original Sep29 pin/checker and three earlier private clusters/evidence remain untouched. Failed sizing job is observed stopped; audit-tool private-identifier binding defect is identified and production identity observed separately, while physical size remains unmeasured. No production repair, recovery activation, new pin/checker or additional retirement approval/action.'
e['items']['7'].setdefault('progressCheckpoints',[]).append({'atUtc':now,'action':62,'currentOct3ContentVerified':True,'currentOct3RestorePassed':False,'newRestoreRunningObserved':True,'physicalSizeMeasured':False,'sizingAuditSourcePrivateIdentifierDefect':True,'productionIdentityObserved':True,'finalRecoveryPromotionAndRetirementApprovalPending':True})
c['files'].extend(rows);c['atUtc']=now
assert e['actions'][:61]==oldE['actions']and c['files'][:536]==oldC['files']and c['storedRepresentations']==oldC['storedRepresentations']
for k in('approval','productionDataMutations','additionalRetirements','finalApprovalRequests'):assert e[k]==oldE[k]
for row in rows:
 b=(ROOT/row['repositoryPath']).read_bytes();assert len(b)==row['bytes']and sha(b)==row['sha256']
 if 'rawSha256'in row:v=json.loads(b);decoded=base64.b64decode(v['rawBase64'],validate=True);assert decoded==(TMP/Path(row['originalPath']).name).read_bytes()and sha(decoded)==row['rawSha256']
E.write_bytes(encode(e));C.write_bytes(encode(c));T.write_text(T.read_text()+'\n- '+now+': '+text+'\n')
receipt={'schema':'pow-audit30-action62-public-custody-preservation-v1','atUtc':now,'oldActionsPreserved':61,'oldCustodyRowsPreserved':536,'actionsNow':len(e['actions']),'custodyRowsNow':len(c['files']),'newPaths':paths,'newRows':rows,'approvalAndMutationListsUnchanged':True,'productionMutation':False,'currentOct3RestorePassed':False,'newRestoreRunningObserved':True,'hygieneCommitPushNotYetPerformed':True};create(TMP/'pow-audit30-action62-public-custody-preservation-v1.json',encode(receipt));print(json.dumps({k:v for k,v in receipt.items()if k not in('newRows','newPaths')},sort_keys=True));print('newPublicPaths',len(paths))
