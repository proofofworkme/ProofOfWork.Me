#!/usr/bin/python3 -I
"""Append only public measured-sizing evidence; preserve prior audit custody."""
from pathlib import Path
import base64,copy,datetime,hashlib,json,os,stat

ROOT=Path('/home/sixer/ProofOfWork.Me'); TMP=Path('/tmp')
def sha(b): return hashlib.sha256(b).hexdigest()
def encode(v): return (json.dumps(v,sort_keys=True,indent=2)+'\n').encode()
def read(p):
    s=p.lstat()
    assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and p.resolve(strict=True)==p and s.st_size<2*1024**2
    b=p.read_bytes();z=p.lstat()
    stable=lambda a:(a.st_dev,a.st_ino,a.st_mode,a.st_uid,a.st_gid,a.st_nlink,a.st_size,a.st_mtime_ns,a.st_ctime_ns)
    assert stable(s)==stable(z) and len(b)==s.st_size
    return b
def create(p,b):
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())

E=ROOT/'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'
C=ROOT/'deploy/audit30/verification/source-custody.json'
T=ROOT/'audits/2026-10-02-audit30-followup-tracker.md'
e=json.loads(E.read_bytes());c=json.loads(C.read_bytes());oldE=copy.deepcopy(e);oldC=copy.deepcopy(c)
assert len(e['actions'])==62 and len(c['files'])==622
for row in c['files']:
    b=(ROOT/row['repositoryPath']).read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256']
prep_path=TMP/'pow-audit30-production-physical-sizing-source-preparation-v3.json'
prep_raw=read(prep_path);assert sha(prep_raw)=='c3b3aa455c9a4405c45d5798c8baa3f8de41edbdb29221acfda3095bd6f0f3a3'
prep=json.loads(prep_raw);assert len(prep['files'])==12
selected={prep_path}
for binding in prep['files']:
    p=Path(binding['path']);assert p.parent==TMP
    b=read(p);assert len(b)==binding['bytes'] and sha(b)==binding['sha256'];selected.add(p)
extra=(
    'pow-audit30-append-action63-v1.py',
    'pow-audit30-independent-physical-sizing-source-review-v3.json',
    'pow-audit30-independent-action63-append-source-review-v1.json',
    'pow-audit30-production-physical-sizing-native-104000-v3.json',
    'pow-audit30-production-physical-sizing-native-104000-v3.stdout',
    'pow-audit30-vps-independent-action62-preservation-review-v1.json',
    'pow-audit30-oct3-restore-capacity-running-observation-v2.json',
    'pow-audit30-recovery-measured-capacity-qualification-v1.json',
    'pow-audit30-recovery-measured-capacity-qualification-v1.test.py',
)
selected.update(TMP/n for n in extra)
# Peer and later capacity-delta inputs are added by an exact reviewed list file.
extra_list=TMP/'pow-audit30-action63-extra-public-bindings-v1.json'
v=json.loads(read(extra_list));assert v['schema']=='pow-audit30-action63-extra-public-bindings-v1'
for binding in v['files']:
    p=Path(binding['path']);assert p.parent==TMP and p.suffix in ('.json','.py')
    b=read(p);assert len(b)==binding['bytes'] and sha(b)==binding['sha256'];selected.add(p)
selected.add(extra_list)
known={r['originalPath']:r for r in c['files']};rows=[];paths=[]
for p in sorted(selected):
    assert p.parent==TMP and p.suffix in ('.py','.json','.diff','.stdout')
    raw=read(p);assert raw
    if str(p) in known:
        assert known[str(p)].get('rawSha256',known[str(p)]['sha256'])==sha(raw);continue
    name=p.name;representation={}
    if p.suffix=='.stdout':json.loads(raw);name+='.json';b=raw
    elif p.suffix=='.diff':
        b=encode({'schema':'pow-audit30-exact-public-diff-byte-custody-v1','originalInput':str(p),'rawBase64':base64.b64encode(raw).decode(),'rawBytes':len(raw),'rawSha256':sha(raw)})
        name+='.evidence.json';representation={'representation':'closed-base64-envelope-preserves-exact-raw-input','rawBytes':len(raw),'rawSha256':sha(raw)}
    else:b=raw
    target=ROOT/'deploy/audit30/verification'/name
    if target.exists():assert read(target)==b
    else:create(target,b)
    row={'bytes':len(b),'originalPath':str(p),'repositoryPath':str(target.relative_to(ROOT)),'sha256':sha(b),**representation}
    rows.append(row);paths.append(row['repositoryPath'])

actual=json.loads(read(TMP/'pow-audit30-production-physical-sizing-native-104000-v3.json'))
outcome=json.loads(read(TMP/'pow-audit30-production-physical-sizing-native-104000-v3.stdout'))
running=json.loads(read(TMP/'pow-audit30-oct3-restore-capacity-running-observation-v2.json'))
assert actual['exitCode']==0 and actual['seconds']==4.427663 and actual['captures']['stderr']['bytes']==0
assert outcome['status']=='passed' and outcome['unitStopVerified'] and outcome['result']['staticProtectionBeforeAfterEqual']
s=outcome['result']['snapshot'];assert s['status']=='measured-readonly-snapshot' and s['catalogBefore']==s['catalogAfter']
assert s['catalogAfter']['systemIdentifier']=='7652445986754609384' and s['catalogAfter']['readOnly']=='on'
assert s['catalogAfter']['databaseCount']==4 and s['catalogAfter']['tablespaceCount']==3
assert s['physicalRootsTotals']['allocatedBytes']==40149663744 and s['walIncludedInPgdataSameFilesystemTotal']
assert not s['productionMutation'] and not s['backupCreated'] and not s['slotCreated'] and not s['pageIntegrityVerified']
assert running['newUnitRunningObserved'] and not running['restoreCompleted'] and running['properties']['InvocationID']=='322aeb150b664d7fa8380b8f6c7ed1f1'
assert running['filesystems'][1]['availableBytes']==259876732928
required=293*1024**3;shortfall=required-running['filesystems'][1]['availableBytes']
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
text=('Action63 preserves all62 prior action values and622 custody rows. After independently verifying the actual production identity, the corrected strict104000 sizing source executes once10:48:59-10:49:03 and passes in4.427663s with empty stderr and its managed audit unit stopped. Four database and three tablespace catalogs match before/after, including one external tablespace. Allocated PGDATA+external roots total40,149,663,744bytes; proof_indexer catalog size40,023,374,871bytes. The separately sampled83,963,904-byte WAL is already included in PGDATA and is not counted twice. This is an active-tree READ ONLY catalog/du snapshot, not an atomic snapshot, live-page integrity, future growth, physical backup or PITR certificate. Originalfive/static protection/tools remain unchanged. At10:57UTC the exact322aeb/Main3106608 isolated Oct3 restore unit is observed active/running under8GiB/2h; no completed restore result is claimed. The separate df command finishes10:57:56 with node/data availability259,876,732,928bytes (86percent df-rounded use), root67,003,199,488bytes. The unchanged80base+80private+32WAL+1evidence envelope plus100GiBreserve needs293GiB, exceeding this snapshot by54,729,621,504bytes. The preserved b16 controller initial admission checks only212GiB and would pass this snapshot; a final whole-workflow plan must separately account for all193GiB peak allocations and refuse unchanged activation here. No smaller ceilings are selected from measured source size, and ongoing restore growth remains unknown. Earlier capacity observations/refusals remain dated evidence. The original Oct2 survivor is still absent, so its promotion/retirement plans remain blocked; Oct3 hashes/catalog pass but current full restore equivalence/private-stop/capacity receipts remain pending. Exact16 production repair approval remains requested and unanswered; no production-data change, recovery configuration, pin/checker promotion, additional deletion or API/worker/UI cutover occurred. All source tests, peer reviews, public receipts and raw diffs are preserved exactly; prior approval/mutation/request lists and May9 operator-paid/noIDs finding remain unchanged.')
e['actions'].append({'atUtc':now,'action':text,'actualReadonlySizingTransportReceipt':actual,'actualReadonlySizingOutcome':outcome,'newRestoreAndCapacityObservation':running,'publicSourceCustodyAdded':rows,'recoveryCapacityQualification':{'requiredWholePeakPlusReserveBytes':required,'currentDataAvailableBytes':259876732928,'shortfallBytes':shortfall,'existingInitialPredicateBytes':212*1024**3,'existingInitialPredicatePassesSnapshot':True,'wholeWorkflowPeakGateImplementedByOriginalB16':False,'smallerCapsSelected':False},'productionDataMutation':False,'recoveryConfigurationMutation':False,'additionalDeletion':False})
e['updatedAtUtc']=now
e['items']['7']['status']='Historical Oct2 restore remains dated valid; current Oct2 source is absent and old promotion/retirement plans stay blocked. Current Oct3 hashes/catalog pass; its new104500 restore was observed running at10:57 UTC, final equivalence/private-stop/capacity receipts pending. Corrected strict production physical sizing104000 passes READ ONLY:40,149,663,744 allocated root bytes including WAL once. Live-page/PITR/future growth remain uncertified. Whole293GiB recovery peak does not fit current242.029GiB free; original controller212GiB initial guard would pass and final full-peak admission needs correction. Sep29 pin/checker and three earlier private clusters/evidence untouched. Production repair, recovery activation, promotion and additional retirement remain gated.'
e['items']['7'].setdefault('progressCheckpoints',[]).append({'atUtc':now,'action':63,'currentOct3ContentVerified':True,'currentOct3RestorePassed':False,'newRestoreRunningObserved':True,'physicalSizeMeasured':True,'physicalRootAllocatedBytes':40149663744,'livePageIntegrityCertified':False,'recoveryEquivalentCertified':False,'currentWholeRecoveryPeakFits':False,'existingInitialRecoveryPredicateInsufficientForWholePeak':True,'finalRecoveryPromotionAndRetirementApprovalPending':True})
c['files'].extend(rows);c['atUtc']=now
assert e['actions'][:62]==oldE['actions'] and c['files'][:622]==oldC['files'] and c['storedRepresentations']==oldC['storedRepresentations']
for k in ('approval','productionDataMutations','additionalRetirements','finalApprovalRequests'):assert e[k]==oldE[k]
for row in rows:
    b=(ROOT/row['repositoryPath']).read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256']
    if 'rawSha256' in row:assert base64.b64decode(json.loads(b)['rawBase64'],validate=True)==read(Path(row['originalPath']))
t=T.read_text();old='| 7 | Backup restoration, physical integrity and PITR | Logical restoration and isolated PITR mechanics pass; recovery activation remains gated | Isolated restore/testing approved; live recovery configuration and pin changes remain gated | All tables/sequences/238 credit accounting/roles/ownerACL/amcheck and4,709,345 offline blocks pass, cluster stopped/live5 unchanged; live WAL continuity/current pages not certified |'
new='| 7 | Backup restoration, physical integrity and PITR | Historical Oct2 restore/PITR mechanics pass; current Oct2 source absent; Oct3 content verified, replacement restore pending | Isolated restore/testing approved; final recovery/pin changes remain gated | New104500 restore observed running10:57UTC. Strict sizing measures40.15GB allocated roots; WAL included once. Current242.03GiB data availability cannot cover293GiB recovery peak/reserve; initial212GiB guard needs whole-workflow qualification. Sep29 pin/checker preserved; live pages/PITR and current full restore remain uncertified |'
assert t.count(old)==1;t=t.replace(old,new)
E.write_bytes(encode(e));C.write_bytes(encode(c));T.write_text(t+'\n- '+now+': '+text+'\n')
receipt={'schema':'pow-audit30-action63-public-custody-preservation-v1','atUtc':now,'oldActionsPreserved':62,'oldCustodyRowsPreserved':622,'actionsNow':len(e['actions']),'custodyRowsNow':len(c['files']),'newPaths':paths,'newRows':rows,'approvalAndMutationListsUnchanged':True,'productionMutation':False,'currentOct3RestorePassed':False,'physicalSizeMeasured':True,'hygieneCommitPushNotYetPerformed':True}
create(TMP/'pow-audit30-action63-public-custody-preservation-v1.json',encode(receipt))
print(json.dumps({k:v for k,v in receipt.items() if k not in ('newRows','newPaths')},sort_keys=True));print('newPublicPaths',len(paths))
