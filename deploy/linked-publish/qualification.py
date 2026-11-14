"""Fail-closed, read-only evidence admission. Never enables a writer."""
import hashlib,json,os,re,stat
from pathlib import Path
REQUIRED_GATES=frozenset({'functional-tests','native-4mb','browser-ui','deployment-tests','hygiene','rollback-fixtures','independent-review'})
def need(value,message):
 if not value:raise ValueError(message)
def evidence_bytes(path,digest,limit=32*1024**2):
 p=Path(path)
 need(p.is_absolute() and str(p).startswith('/data/') and p.resolve(strict=True)==p,'Evidence must be a canonical VPS /data file')
 before=p.lstat()
 need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and not before.st_mode&0o022 and before.st_size<=limit,'Unsafe evidence file')
 raw=p.read_bytes();after=p.lstat()
 need((before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns),'Evidence changed')
 need(re.fullmatch('[0-9a-f]{64}',digest or '') and hashlib.sha256(raw).hexdigest()==digest,'Evidence digest changed')
 return raw
def validate_native_evidence(raw):
 value=json.loads(raw);test=value.get('test',{})
 need(value.get('passed') is True and value.get('syntheticOnly') is True and
      value.get('cleanShutdown') is True and value.get('postmasterPidAbsent') is True and
      value.get('privateSocketAbsent') is True and value.get('shutdownReturnCode')==0 and
      value.get('diskLimitExceeded') is False and value.get('diskMonitorErrors')==[] and
      test.get('passed') is True and test.get('bodyBytes')==4_000_000 and
      type(test.get('checks')) is int and test['checks']>=17 and
      test.get('sourceWitnessStubbed') is False and test.get('sharedConfirmedGenerationVerified') is True and
      test.get('productionMutation') is False, 'Native 4 MB full-witness/shared-generation evidence failed')
 events=dict(line.split() for line in value.get('memoryEvents','').splitlines() if len(line.split())==2)
 need(events.get('oom')=='0' and events.get('oom_kill')=='0','Native evidence has OOM or missing memory accounting')
 return value
EXPECTED_BROWSER_CASES=frozenset([
 '4 MB linked draft persists across reload without changing transaction limits',
 'IndexedDB quota failure preserves unsaved text and blocks Back until saving succeeds',
 'verified linked Boost preview is removed when parent evidence is reorganized',
 'standalone Publish linkifies only DNS names in verified article bodies',
 'Computer linkifies only DNS names in verified article bodies',
 'Computer Publish restores the selected ID and draft when mounted and reopened with an already connected wallet',
 'Publish does not expose DNS links when the article body commitment fails',
 'Publish shares Boost navigation geometry at 390px',
 'Publish shares Boost navigation geometry at 768px',
 'Publish shares Boost navigation geometry at 960px',
 'Publish shares Boost navigation geometry at 1440px',
 'Publish shares Boost navigation geometry at 1280px in Computer',
 'articles share Boost engagement and fit 390px',
 'articles share Boost engagement and fit 1440px',
 'composer alignment: Publish standalone light 1440x900',
 'composer alignment: Publish standalone light 768x900',
 'composer alignment: Publish standalone light 320x640',
 'composer alignment: Publish standalone light 844x390',
 'composer alignment: Publish standalone dark 1440x900',
 'composer alignment: Publish standalone dark 768x900',
 'composer alignment: Publish standalone dark 320x640',
 'composer alignment: Publish standalone dark 844x390',
 'composer alignment: Publish Computer light 1440x900',
 'composer alignment: Publish Computer light 768x900',
 'composer alignment: Publish Computer light 320x640',
 'composer alignment: Publish Computer light 844x390',
 'composer alignment: Publish Computer dark 1440x900',
 'composer alignment: Publish Computer dark 768x900',
 'composer alignment: Publish Computer dark 320x640',
 'composer alignment: Publish Computer dark 844x390',
 'full text drafts autosave, preview, and enforce the complete carrier budget',
 'writer is a normal page with draft-preserving history at 390px',
 'writer is a normal page with draft-preserving history at 1440px',
 'direct writer path restores the scoped draft and has a safe Articles fallback',
 'a dropped publication restores into the writer without reviving stale recovery text on Forward',
 'storage failure preserves unsaved article text through manual, browser, and workspace Back',
 'article reader refuses text that does not match its exact on-chain commitment',
 'publication review contains exact transaction evidence and wallet rejection preserves the draft',
 'unknown signed publication blocks another article signature',
 'connecting preserves the active guest article over an existing empty wallet draft',
 'standalone Publish: selected confirmed PowID opens exact publication review while new-ID availability is unavailable',
 'standalone Publish: transferred confirmed ownership blocks publication review and preserves the draft',
 'standalone Publish: unavailable confirmed ownership blocks publication review and preserves the draft',
 'standalone Publish: an ID transfer after publication review prevents wallet signing and preserves the draft',
 'Computer Publish: selected confirmed PowID opens exact publication review while new-ID availability is unavailable',
 'Computer Publish: transferred confirmed ownership blocks publication review and preserves the draft',
 'Computer Publish: unavailable confirmed ownership blocks publication review and preserves the draft',
 'Computer Publish: an ID transfer after publication review prevents wallet signing and preserves the draft',
 'Publish waits for the save completion before allowing Back',
 'Publish blocks exit during a mocked signature and closes with an empty draft after mocked broadcast',
 'Publish failed draft read allows explicit Back without changing saved drafts',
 'Publish delayed linked receipt recovery cannot overwrite a newer writer session',
])
def validate_browser_evidence(raw):
 value=json.loads(raw);rows=value.get('results')
 need(value.get('syntheticApi') is True and value.get('noWalletSigning') is True and
      value.get('complete') is True and isinstance(rows,list) and len(rows)==len(EXPECTED_BROWSER_CASES) and
      {r.get('name') for r in rows}==EXPECTED_BROWSER_CASES and all(r.get('status')=='passed' for r in rows),
      'Browser rollback/reader evidence has failed, skipped or missing cases')
 return value
def validate_release_qualification(report,plan,tree,read=evidence_bytes):
 manifest=plan['runtimeManifestTemplate']
 need(report.get('format')=='linked-publish-release-qualification-v1' and
      report.get('phase')=='writer-off-preactivation' and report.get('rootReconciled') is True and
      report.get('activationAllowed') is False,'Final root reconciliation for writer-off release is missing')
 need(report.get('commit')==plan['sourceCommit'] and report.get('tree')==tree and
      report.get('planSha256')==plan['planSha256'],'Qualification source/plan differs')
 expected={r['path']:r['after'] for r in manifest['sources']}
 need(report.get('runtimeAfter')==expected,'Qualification runtime differs')
 gates=report.get('gates')
 need(isinstance(gates,dict) and set(gates)==REQUIRED_GATES,'Missing exact release gates')
 for name,row in gates.items():
  need(row.get('passed') is True and row.get('exitCode')==0 and row.get('commit')==plan['sourceCommit'],'Unpassed or stale gate: '+name)
  raw=read(row.get('path',''),row.get('sha256'))
  if name=='native-4mb':validate_native_evidence(raw)
  if name=='browser-ui':validate_browser_evidence(raw)
 rollback=report.get('rollback')
 need(rollback=={'mode':'native-and-browser-fixtures','v2Rendering':True,'v2FullBodySearch':True,
   'writerDisabled':True,'sharedConfirmedAndReorg':True,'liveNewWriteVerified':False},
   'Writer-off v2 rollback fixture qualification is incomplete')
 return {'ok':True,'phase':'writer-off-preactivation','activationAllowed':False,'sourceCommit':plan['sourceCommit']}
def validate_retained_rollback(report,plan,read=evidence_bytes):
 need(report.get('format')=='linked-publish-retained-rollback-v1' and report.get('commit')==plan['sourceCommit'],
      'Wrong retained rollback source')
 need(report.get('writerEnabled') is False and report.get('readerVersion')==2 and
      report.get('indexerVersion')==2 and report.get('searchVersion')=='proof-search-v6-linked-publish-content',
      'Rollback must retain v2 readers and full-body Search with writes disabled')
 need(report.get('runtimeAfter')=={r['path']:r['after'] for r in plan['runtimeManifestTemplate']['sources']},'Rollback runtime provenance differs')
 required={'runtimeArchive','uiManifest','rendererManifest','releaseSync','preactivationLive','nativeV2','browserV2'}
 artifacts=report.get('artifacts')
 need(isinstance(artifacts,dict) and set(artifacts)==required,'Rollback custody/verification evidence missing')
 content={name:read(row.get('path',''),row.get('sha256')) for name,row in artifacts.items()}
 validate_native_evidence(content['nativeV2']);validate_browser_evidence(content['browserV2'])
 live=json.loads(content['preactivationLive'])
 need(live.get('mode')=='preactivation' and not live.get('error') and live.get('newLinkedWriteVerified') is False,
      'Live writer-off preactivation failed')
 checks={r.get('name'):r for r in live.get('checks',[])}
 for name in ('disabled-writer reader/indexer/Search/capacity readiness','public writer remains disabled'):
  need(checks.get(name,{}).get('pass') is True,'Missing live rollback gate: '+name)
 need(report.get('rootReconciled') is True,'Retained rollback not reconciled')
 return {'ok':True,'writerEnabled':False,'sourceCommit':plan['sourceCommit'],
         'liveNewWriteVerified':False,'scope':'retained v2-capable writer-off rollback'}
def read_release_qualification(path,digest,plan,tree):
 report=json.loads(evidence_bytes(path,digest,4*1024**2))
 return validate_release_qualification(report,plan,tree)


# This is an additional evidence schema, never an activation entry point.
# qualification_sha256 and identity are independent trusted caller inputs:
# do not obtain either from the report being validated. The digest must identify
# a receipt emitted by the reviewed hardwired live JS collector, never an
# offline receipt or caller-supplied self-digest. JSON flags cannot authenticate
# a malicious trusted caller. No user-hash API or activation entry point exists.
# A self-consistent JSON file or self-reported "passed" value is not authority.
DUAL_IDENTITIES = {
 'artifact': {'commit':'064b6991ae2a48e2069baedc767cd918d28ba052','tree':'e6f76332d26f88c3f7df98dc689d013193729c83'},
 'baselineOperator': {'commit':'c7cfa32ae01ae70042bac0539ddf74d816ae474a','tree':'fe7a2f82097c925235c1bfca3d3281584d3e7ab4'},
 'backend': {'commit':'609d5a10a07a83bb5f1e858e7f6c1d706e741ee1','tree':'cae54e036af5254698c5cd45020b382cb0982052'},
}
DUAL_BACKEND_ARTIFACT_DELTA_SHA256='39e886ad82b297c53922f5619c2ae70f06e44ba4d451630d01ca98417a844507'
DUAL_ARCHIVAL_PINS={
 'nativeV2':'516b7712365a221bf64a6bb389db56f0b1d97fdf9bffccadabd0406df054bc68',
 'browserV2':'b344fbb4f069c8b92daaf314f7e68fdc0c68e93e0a3e3336ff42668f7b9c33c7',
 'qualification':'342ea3e50e956edcaf5f57434cd6e51fec64d251def3832c9e43a9934f8e4bf1',
 'plan':'6ca83113503039e2ef7a03f232cb1b59b80804da8cc7f068c6e4c83fe91a5483',
}
DUAL_LIVE_MAX_AGE_SECONDS=900
def dual_json(raw):
 def pairs(rows):
  result={}
  for key,value in rows:
   need(key not in result,'Duplicate dual-evidence JSON key')
   result[key]=value
  return result
 try:
  value=json.loads(raw,object_pairs_hook=pairs)
 except (TypeError,UnicodeError,json.JSONDecodeError) as error:
  raise ValueError('Malformed dual evidence JSON') from error
 need(isinstance(value,dict),'Dual evidence must be a JSON object')
 return value
def dual_time(value,now,*,fresh=False):
 from datetime import datetime
 need(isinstance(value,str) and value.endswith('Z'),'Evidence time must be explicit UTC')
 try:timestamp=datetime.fromisoformat(value[:-1]+'+00:00').timestamp()
 except (ValueError,OverflowError) as error:raise ValueError('Invalid evidence time') from error
 need(type(now) in (int,float) and 0<=timestamp<=now,'Future or invalid evidence time')
 if fresh:need(now-timestamp<=DUAL_LIVE_MAX_AGE_SECONDS,'Stale live dual evidence')
 return timestamp
def dual_subject(value,role,identity):
 need(value=={'role':role,**identity[role]},'Evidence subject identity differs')
def validate_dual_retained_rollback(report,plan,identity,*,now,qualification_sha256=None,read=evidence_bytes,retirement_evidence=None,retirement_trust=None):
 """Validate independently pinned writer-off evidence, not permission to activate.

 This consumes an independently admitted JS receipt; it does not reconstruct
 the JS Git-tree/product-closure proof from receipt booleans. Historical
 native/browser receipts must carry their actual subject and time.
 Missing subject metadata refuses; this validator never adds it or relabels tests.
 The original exact-source schemas and their admission behavior are unchanged.
 """
 need(isinstance(identity,dict) and set(identity)=={'artifact','baselineOperator','backend','operator'},'Expected four independent identities')
 need(all(identity.get(role)==value for role,value in DUAL_IDENTITIES.items()),'Fixed artifact/baselineOperator/backend identity differs')
 impl=identity['operator']
 need(isinstance(impl,dict) and set(impl)=={'commit','tree'} and all(isinstance(v,str) and re.fullmatch('[0-9a-f]{40}',v) for v in impl.values()),'Invalid committed operator identity')
 need(impl['commit'] not in {v['commit'] for v in DUAL_IDENTITIES.values()},'Committed operator identity must not be relabeled')
 need(isinstance(qualification_sha256,str) and re.fullmatch('[0-9a-f]{64}',qualification_sha256),'Independent qualification receipt pin required')
 need(report.get('format')=='linked-publish-dual-retained-rollback-v1' and report.get('identities')==identity,'Wrong dual retained rollback identity')
 need(report.get('activationAllowed') is False and report.get('writerEnabled') is False and report.get('liveNewWriteVerified') is False,'Dual evidence cannot authorize activation or claim a signed write')
 need(report.get('rootReconciled') is True and report.get('readerVersion')==2 and report.get('indexerVersion')==2 and report.get('searchVersion')=='proof-search-v6-linked-publish-content','Incomplete writer-off rollback')
 need(plan.get('sourceCommit')==identity['backend']['commit'] and report.get('planSha256')==plan.get('planSha256') and re.fullmatch('[0-9a-f]{64}',plan.get('planSha256','')),'Backend plan identity differs')
 expected={row['path']:row['after'] for row in plan['runtimeManifestTemplate']['sources']}
 need(expected and len(expected)==len(plan['runtimeManifestTemplate']['sources']) and report.get('runtimeAfter')==expected,'Runtime source inventory differs')
 required={'runtimeArchive','uiManifest','rendererManifest','dualQualification','preactivationLive','nativeV2','browserV2'}
 artifacts=report.get('artifacts')
 need(isinstance(artifacts,dict) and set(artifacts)==required,'Missing exact dual rollback evidence')
 content={}
 for name,row in artifacts.items():
  need(isinstance(row,dict) and set(row)=={'path','sha256'},'Wrong evidence reference')
  raw=read(row['path'],row['sha256'])
  need(isinstance(raw,bytes) and hashlib.sha256(raw).hexdigest()==row['sha256'],'Evidence bytes do not match reference')
  content[name]=raw
 need(artifacts['dualQualification']['sha256']==qualification_sha256,'Qualification not independently pinned')
 q=dual_json(content['dualQualification'])
 need(q.get('format')=='proof-of-work-dual-qualification-v1' and q.get('mode')=='verification-only' and q.get('identities')==identity,'Wrong verified qualification receipt')
 for key in ('exactHeadDeployment','activationAllowed','writerEnabled','liveNewWriteVerified'):
  need(q.get(key) is False,'Qualification must remain explicitly verification-only')
 need(q.get('liveCollectionVerified') is True and q.get('collectionMethod')=='hardwired-live-read-v1','Hardwired live collector receipt required')
 proof=q.get('identityProof',{})
 need(proof.get('format')=='proof-of-work-explicit-release-identities-v1' and all(proof.get(role)==identity[role] for role in identity),'Qualification identity proof differs')
 delta=proof.get('backendArtifactDelta')
 need(isinstance(delta,list) and all(isinstance(row,dict) and set(row)=={'path','before','after'} and all(row[side] is None or isinstance(row[side],dict) and set(row[side])=={'mode','type','blob'} for side in ('before','after')) for row in delta),'Malformed backend artifact delta')
 delta=[{'path':row['path'],**{side:None if row[side] is None else {key:row[side][key] for key in ('mode','type','blob')} for side in ('before','after')}} for row in delta]
 need(isinstance(delta,list) and len(delta)==15 and hashlib.sha256(json.dumps(delta,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()==DUAL_BACKEND_ARTIFACT_DELTA_SHA256 and proof.get('digests',{}).get('backendArtifactDeltaSha256')==DUAL_BACKEND_ARTIFACT_DELTA_SHA256,'Authenticated backend-to-artifact product equivalence is missing')
 issued=dual_time(q.get('issuedAt'),now,fresh=True)
 evidence=q.get('evidence')
 need(isinstance(evidence,dict) and set(evidence)=={'primary','build','sourceProvenance','uiManifest','renderer','runtime','lifecycle','preactivation','activity','growth','nativeV2','browserV2'},'Qualification observations missing')
 observed={}
 for name,role in [('primary','operator'),('build','artifact'),('sourceProvenance','artifact'),('uiManifest','artifact'),('renderer','artifact'),('runtime','backend'),('lifecycle','artifact'),('preactivation','artifact'),('nativeV2','backend'),('browserV2','backend'),('activity','artifact'),('growth','artifact')]:
  entry=evidence.get(name)
  need(isinstance(entry,dict) and isinstance(entry.get('raw'),str),'Qualification observation missing')
  dual_subject(entry.get('subject'),role,identity)
  need(dual_time(entry.get('observedAt'),now,fresh=True)<=issued,'Observation postdates qualification')
  raw=entry['raw'].encode()
  need(hashlib.sha256(raw).hexdigest()==entry.get('sha256'),'Observation digest differs')
  observed[name]=raw
 for name,artifact in [('uiManifest','uiManifest'),('renderer','rendererManifest'),('preactivation','preactivationLive')]:
  need(observed[name]==content[artifact],'Separately retained observation differs')
 fields={}
 for line in content['uiManifest'].decode().strip().splitlines():
  key,separator,value=line.partition('=')
  need(separator and key not in fields,'Malformed or duplicate UI manifest field');fields[key]=value
 need(fields.get('format')=='proofofwork-ui-release-v5' and fields.get('commit')==identity['artifact']['commit'] and fields.get('source_tree')==identity['artifact']['tree'],'Original UI artifact provenance differs')
 renderer=dual_json(content['rendererManifest'])
 need(renderer.get('format')=='proof-of-work-publish-render-source-v1' and renderer.get('ok') is True and renderer.get('ui',{}).get('commit')==identity['artifact']['commit'] and renderer.get('ui',{}).get('tree')==identity['artifact']['tree'] and renderer.get('ui',{}).get('trackedDirty') is False,'Renderer UI identity differs')
 # Archive digest binds the preserved base archive bytes; sourceCommit identifies
 # the accepted runtime overlay, not necessarily the archive base commit.
 runtime=dual_json(observed['runtime'])
 need(runtime.get('sourceCommit')==identity['backend']['commit'] and runtime.get('writerEnabled') is False and runtime.get('runtimeAfter')==expected and runtime.get('archiveSha256')==artifacts['runtimeArchive']['sha256']==plan.get('runtimeArchiveSha256'),'Runtime archive/source observation differs')
 lifecycle=dual_json(observed['lifecycle'])
 need(lifecycle.get('publicationHealthy') is True and lifecycle.get('retentionComplete') is True and lifecycle.get('unfinishedIntents')==[] and lifecycle.get('pair',{}).get('current','').startswith(identity['artifact']['commit'][:12]+'-'),'Lifecycle is not completed for deployed artifact')
 old_holds=((lifecycle.get('verifiedPreservedRelease1042') or {}).get('releaseId')=='1042efea2aa1-20261112T074918Z' and (lifecycle.get('verifiedPreservedFallback') or {}).get('releaseId')=='c3969c39c2b2-20261101T051206Z')
 if old_holds:
  need(lifecycle.get('verifiedRetiredPayloads') is None and retirement_evidence is None and retirement_trust is None,'Conflicting in-place and retired evidence')
 else:
  need(lifecycle.get('verifiedPreservedRelease1042') is None and lifecycle.get('verifiedPreservedFallback') is None,'Partial hold/retirement evidence')
  retired=validate_dual_retirement_evidence(retirement_evidence,retirement_trust)
  need(lifecycle.get('verifiedRetirementPolicyCodeSha256')==retired['policyCodeSha256'],'Fresh installed lifecycle package binding differs')
  need(lifecycle.get('verifiedRetiredPayloads')==retired['proof'] and lifecycle.get('verifiedRetirementCurrentPair')==retired['verifiedCurrentPair']==lifecycle.get('pair'),'Fresh lifecycle retirement proof differs')
  need(lifecycle.get('configSha256')==retired['configSha256'] and lifecycle.get('stateSha256')==retired['stateSha256'] and lifecycle.get('index')=={'path':retirement_evidence['currentIndex']['path'],'sha256':retired['currentIndexSha256']},'Lifecycle retirement trust bindings differ')
  need(lifecycle.get('binding',{}).get('config')=={'path':RET_CONFIG_PATH,'sha256':retired['configSha256']} and lifecycle.get('binding',{}).get('state')=={'path':RET_STATE_PATH,'sha256':retired['stateSha256']},'Lifecycle root evidence bindings differ')
 activity=dual_json(observed['activity']);growth=dual_json(observed['growth'])
 need(activity.get('ok') is True and activity.get('retentionComplete') is True and activity.get('qualificationSubject')==identity['artifact'] and activity.get('pair')==lifecycle.get('pair'),'Activity retained pair differs')
 need(growth.get('ok') is True and growth.get('commit')==identity['artifact']['commit'] and growth.get('canonicalParity') is True and growth.get('verified')==['growth','computer'],'Growth canonical product verification differs')
 floor=lifecycle.get('verifiedCapacityFloor',{})
 need(floor.get('rootReserveBytes')==8*1024**3 and floor.get('growthReserveBytes')==64*1024**2,'Capacity reserve proof differs')
 wrapper=dual_json(content['preactivationLive'])
 need(wrapper.get('format')=='publish-linked-dual-preactivation-v1' and all(wrapper.get(role)==identity[role] for role in ('artifact','baselineOperator','operator')),'Preactivation identities differ')
 remote=wrapper.get('remoteReceipt',{})
 need(remote.get('format')=='publish-linked-remote-preactivation-v1' and type(remote.get('exitCode')) is int and remote.get('ok') is True and remote.get('commit')==identity['artifact']['commit'] and remote.get('tree')==identity['artifact']['tree'] and remote.get('exitCode')==0 and remote.get('cgroupAbsent') is True and remote.get('noTokenTransferred') is True and remote.get('productionMutation') is False,'Remote preactivation failed or uncertain')
 need(isinstance(remote.get('rawResult'),str) and hashlib.sha256(remote['rawResult'].encode()).hexdigest()==remote.get('rawResultSha256'),'Remote checker bytes differ')
 live=dual_json(remote['rawResult'])
 need(live.get('mode')=='preactivation' and not live.get('error') and live.get('newLinkedWriteVerified') is False,'Live writer-off preactivation failed')
 checks=live.get('checks',[])
 need(isinstance(checks,list) and len({r.get('name') for r in checks})==len(checks),'Duplicate live checks')
 for name in ('disabled-writer reader/indexer/Search/capacity readiness','public writer remains disabled','complete article feed'):
  need(any(row.get('name')==name and row.get('pass') is True for row in checks),'Missing live rollback gate: '+name)
 archival=[]
 for name,role,validator in [('nativeV2','backend',validate_native_evidence),('browserV2','backend',validate_browser_evidence)]:
  observation=dual_json(observed[name])
  if observation.get('format')=='proof-of-work-archival-test-observation-v1':
   need(set(observation)=={'format','originalRaw','originalSha256','subjectIdentity','executionTimeUnknown','executedAt','freshnessClaim','qualificationSha256','planSha256','applicableArtifact','backendArtifactDeltaSha256'},'Exact archival custody fields required')
   # The independently admitted hardwired collector reads the pinned original
   # qualification and plan, verifies their gate pointers and byte hashes.
   # This wrapper describes custody; it never edits or dates the original test.
   need(observation.get('subjectIdentity')==identity['backend'] and observation.get('applicableArtifact')==identity['artifact'],'Archival test applicability differs')
   need(observation.get('executionTimeUnknown') is True and observation.get('executedAt','missing') is None and observation.get('freshnessClaim') is False,'Archival test must not claim execution time or freshness')
   need(observation.get('qualificationSha256')==DUAL_ARCHIVAL_PINS['qualification'] and observation.get('planSha256')==DUAL_ARCHIVAL_PINS['plan'] and observation.get('backendArtifactDeltaSha256')==DUAL_BACKEND_ARTIFACT_DELTA_SHA256,'Archival original custody/product proof differs')
   need(isinstance(observation.get('originalRaw'),str) and observation['originalRaw'].encode()==content[name] and hashlib.sha256(content[name]).hexdigest()==observation.get('originalSha256')==DUAL_ARCHIVAL_PINS[name],'Archival original bytes differ')
   archival.append(name)
  else:
   need(observed[name]==content[name],'Separately retained original test differs')
   value=dual_json(content[name])
   need(value.get('subjectIdentity')==identity[role],'Original test subject identity differs or is missing')
   executed=dual_time(value.get('executedAt'),now)
   need(executed<=dual_time(evidence[name]['observedAt'],now) and now-executed<=7*24*60*60,'Original test evidence is stale or postdates observation')
  validator(content[name])
 return {'ok':True,'format':'linked-publish-dual-retained-rollback-result-v1','identities':identity,
         'qualificationSha256':qualification_sha256,'activationAllowed':False,'writerEnabled':False,
         'liveNewWriteVerified':False,'executionTimeUnknown':bool(archival),'historicalFreshnessClaim':False if archival else True,'archivalTests':archival,'testEvidenceMode':'pinned-original-archival-unknown-time' if archival else 'historical-original-subjects','scope':'retained writer-off artifacts qualified by a separate verifier; not exact-HEAD deployment'}


# Pure byte-level successor evidence contract, copied from reviewed receipt state machine.
# No filesystem absence, live-history, or authorization claim is made here.
RET_PROPOSAL_SHA = '6fd05dc1e04e6fbcab293683c5a0d10d184ff0bd83039a66d7f2c7ec53161004'

RET_INVENTORY_SHA = 'dcf09bd3ec9453230ece39ce67ccf9f39716388ad26bc609ad09d1fe5c308107'

RET_RESTORE_SHA = 'd83a52bef8bb3bca179e970a41d2300a9b7e1f688e53ac27342e2a8273766278'

RET_PAIR = {'current': '064b6991ae2a-20261114T020148Z',
        'previous': 'e2669bc1fd32-20261112T163804Z'}

RET_BASE = '/var/backups/proofofwork-ui'

RET_PATHS = (
    RET_BASE + '/releases/proofofwork-ui-release-1042efea2aa1-20261112T074918Z.tgz',
    RET_BASE + '/rollback-roots/proofofwork-www-pre-e2669bc1fd32-20261112T163804Z',
    RET_BASE + '/releases/proofofwork-ui-release-c3969c39c2b2-20261101T051206Z.tgz',
    RET_BASE + '/rollback-roots/proofofwork-www-pre-54088ca155bc-20261103T032112Z',
)

RET_SHA = re.compile(r'[0-9a-f]{64}\Z')

def RET_require(condition, message):
    if not condition:
        raise ValueError(message)

def RET_digest(raw):
    return hashlib.sha256(raw).hexdigest()

def RET_encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

def RET_hash_value(value):
    RET_require(isinstance(value, str) and RET_SHA.fullmatch(value), 'Invalid evidence RET_digest')
    return value

def RET_authenticate_proposal(proposal, inventory, restore):
    """Bind exact reviewed bytes, including restore limitations, not loose fields."""
    RET_require(RET_digest(proposal) == RET_PROPOSAL_SHA, 'Proposal bytes differ')
    RET_require(RET_digest(inventory) == RET_INVENTORY_SHA, 'Inventory bytes differ')
    RET_require(RET_digest(restore) == RET_RESTORE_SHA, 'Restore receipt bytes differ')
    p, i, r = (json.loads(raw) for raw in (proposal, inventory, restore))
    RET_require(p['status'] == 'PROPOSAL_ONLY_NOT_AUTHORIZED_FOR_EXECUTION', 'Wrong proposal')
    RET_require(tuple(x['path'] for x in p['selected']) == RET_PATHS, 'Removal scope differs')
    RET_require(p['pair'] == i['pair'] == RET_PAIR, 'Retained pair differs')
    RET_require(p['inventorySha256'] == RET_INVENTORY_SHA, 'Inventory binding differs')
    RET_require(p['rehearsalReceipt']['sha256'] == RET_RESTORE_SHA, 'Restore binding differs')
    RET_require(p['allHistoricalEntriesHaveRetainedEquivalent']
            and i['allHistoricalEntriesHaveRetainedEquivalent']
            and p['historicalUnequalCount'] == 0, 'Historical evidence is not preserved')
    RET_require(r['uiInventoryBeforeAfterEqual'] and r['staticReferencePass']
            and r['restoredEntries'] == 2839
            and r['scope'].startswith('isolated static archive restoration; NOT production'),
            'Static recovery evidence differs')
    return p

def RET_validate_chain(records):
    """Pure fail-closed state machine; an intent without a result is unresolved."""
    RET_require(isinstance(records, list) and records, 'Missing journal')
    previous = None
    state = 'new'
    index = 0
    approval = None
    for sequence, record in enumerate(records):
        RET_require(set(record) == {'sequence', 'previousSha256', 'event', 'data'},
                'Unexpected journal fields')
        RET_require(type(record['sequence']) is int and record['sequence'] == sequence
                and record['previousSha256'] == previous, 'Journal chain differs')
        event, data = record['event'], record['data']
        if state == 'new':
            RET_require(event == 'prepared' and set(data) == {
                'proposalSha256', 'inventorySha256', 'restoreSha256', 'approvalSha256',
                'preflightSha256', 'pair'}, 'Missing exact preparation')
            RET_require(data['proposalSha256'] == RET_PROPOSAL_SHA
                    and data['inventorySha256'] == RET_INVENTORY_SHA
                    and data['restoreSha256'] == RET_RESTORE_SHA
                    and data['pair'] == RET_PAIR, 'Preparation authority differs')
            approval = RET_hash_value(data['approvalSha256'])
            RET_hash_value(data['preflightSha256'])
            state = 'ready'
        elif state == 'ready' and index < len(RET_PATHS):
            RET_require(event == 'action-started' and set(data) == {
                'path', 'index', 'freshFenceSha256', 'frozenInventorySha256'}, 'Missing action intent')
            RET_require(type(data['index']) is int and data['index'] == index
                    and data['path'] == RET_PATHS[index], 'Action scope/order differs')
            RET_hash_value(data['freshFenceSha256'])
            RET_hash_value(data['frozenInventorySha256'])
            state = 'uncertain'
        elif state == 'uncertain':
            RET_require(event == 'action-reconciled' and set(data) == {
                'path', 'index', 'absenceProofSha256', 'preservationProofSha256'},
                'Uncertain action must reconcile; never retry automatically')
            RET_require(type(data['index']) is int and data['index'] == index
                    and data['path'] == RET_PATHS[index], 'Reconciliation scope differs')
            RET_hash_value(data['absenceProofSha256'])
            RET_hash_value(data['preservationProofSha256'])
            index += 1
            state = 'ready'
        elif state == 'ready' and index == len(RET_PATHS):
            RET_require(event == 'completed' and set(data) == {
                'finalFenceSha256', 'retainedPairProofSha256', 'sidecarsProofSha256',
                'historicalEvidenceProofSha256', 'successorPolicyCodeSha256'},
                'Missing final retained/evidence verification')
            for value in data.values():
                RET_hash_value(value)
            state = 'complete'
        else:
            raise ValueError('Journal already completed')
        previous = RET_digest(RET_encoded(record))
    return {'status': state, 'nextIndex': index, 'lastSha256': previous,
            'approvalSha256': approval}

RET_EVIDENCE_DIR = RET_BASE + '/cleanup-evidence/older-backup-retirement-6fd05dc1e04e'

RET_TERMINAL_PATH = RET_EVIDENCE_DIR + '/completed.json'

RET_SOURCE_INDEX = {'path': RET_BASE + '/cleanup-evidence/audit30-policy-admission-index-ordinary-064b6991ae2a-20261114T020148Z.json',
                'sha256': '5a7b025d95cd55a2b40f2a69b0189b74d75484ff237bac327f920a6b2a231c54'}

RET_PRIOR_CONFIG_SHA = '58660f364d39f2cd0a5b94e2cb8e33b496e7686e2473c622dc9ec6e268f42798'

RET_CONFIG_PATH='/etc/proofofwork-retention/ui-lifecycle.json'
RET_STATE_PATH='/var/lib/proofofwork-ui-retention/state.json'
def validate_dual_retirement_evidence(bundle,trusted):
 """Pure authenticated-byte consistency, NOT filesystem or permission validation.

 Trusted bindings must be supplied independently by fresh installed lifecycle
 verification (including installed policy code), never derived from this bundle.
 """
 import base64,binascii
 need(isinstance(trusted,dict) and set(trusted)=={'configSha256','stateSha256','currentIndexSha256','policyCodeSha256','verifiedCurrentPair'},'Independent lifecycle retirement bindings required')
 for key in ('configSha256','stateSha256','currentIndexSha256','policyCodeSha256'):RET_hash_value(trusted[key])
 need(isinstance(bundle,dict) and set(bundle)=={'terminal','ownerApproval','config','state','sourceIndex','currentIndex','appendedAdmissions','sidecars','finalProofs','proposal','inventory','staticRestore'},'Exact raw retirement inventory required')
 total=0
 def read(row,path=None,digest=None):
  nonlocal total
  need(isinstance(row,dict) and set(row)=={'path','base64','sha256'},'Exact raw retirement reference required')
  p=row['path'];need(isinstance(p,str) and p.startswith('/') and str(Path(p))==p and '..' not in Path(p).parts,'Noncanonical evidence path')
  need(path is None or p==path,'Retirement evidence path differs')
  RET_hash_value(row['sha256']);need(digest is None or row['sha256']==digest,'Retirement expected digest differs')
  need(isinstance(row['base64'],str) and len(row['base64'])<=24*1024**2,'Oversized retirement encoding')
  try:raw=base64.b64decode(row['base64'],validate=True)
  except (ValueError,binascii.Error) as error:raise ValueError('Malformed retirement base64') from error
  total+=len(raw);need(0<len(raw) and total<=16*1024**2 and base64.b64encode(raw).decode()==row['base64'],'Retirement bytes limit/encoding differs')
  need(RET_digest(raw)==row['sha256'],'Retirement raw digest differs')
  return raw
 def obj(row,path=None,digest=None):return dual_json(read(row,path,digest))
 config=obj(bundle['config'],RET_CONFIG_PATH,trusted['configSha256'])
 state=obj(bundle['state'],RET_STATE_PATH,trusted['stateSha256'])
 need(config.get('schema')=='pow-ui-retention-lifecycle-config-v1' and config.get('statePath')==RET_STATE_PATH,'Retirement config scope differs')
 need(config.get('package',{}).get('sha256')==trusted['policyCodeSha256'],'Verified installed package manifest differs')
 need(state.get('schema')=='pow-ui-retention-lifecycle-state-v1' and state.get('configSha256')==trusted['configSha256'] and state.get('pending','missing') is None,'Retirement lifecycle state not stable')
 binding=config.get('payloadRetirement')
 need(isinstance(binding,dict) and set(binding)=={'mode','proposalSha256','receipt','priorConfigSha256','sourceIndex','policyCodeSha256'} and binding['mode']=='complete','Retirement config incomplete')
 need(binding['proposalSha256']==RET_PROPOSAL_SHA and binding['priorConfigSha256']==RET_PRIOR_CONFIG_SHA and binding['sourceIndex']==RET_SOURCE_INDEX and binding['policyCodeSha256']==trusted['policyCodeSha256'],'Retirement config authority differs')
 need(isinstance(binding['receipt'],dict) and set(binding['receipt'])=={'path','sha256'} and binding['receipt']['path']==RET_TERMINAL_PATH,'Wrong terminal reference')
 terminal_raw=read(bundle['terminal'],RET_TERMINAL_PATH,binding['receipt']['sha256'])
 terminal=dual_json(terminal_raw)
 need(RET_encoded(terminal)==terminal_raw,'Noncanonical terminal bytes')
 need(set(terminal)=={'schema','proposalSha256','inventorySha256','restoreSha256','approvalSha256','journal','journalHeadSha256','retiredPayloadPaths','retirementRetainedPair','sourceIndex','preservedSidecars','preservedHistoricalEvidenceSha256','priorConfigSha256','policyCodeSha256'},'Terminal receipt fields differ')
 need(terminal['schema']=='pow-exact-payload-retirement-completed-v1' and terminal['proposalSha256']==RET_PROPOSAL_SHA and terminal['inventorySha256']==RET_INVENTORY_SHA and terminal['restoreSha256']==RET_RESTORE_SHA and terminal['retiredPayloadPaths']==list(RET_PATHS) and terminal['retirementRetainedPair']==RET_PAIR and terminal['sourceIndex']==RET_SOURCE_INDEX and terminal['priorConfigSha256']==RET_PRIOR_CONFIG_SHA and terminal['policyCodeSha256']==trusted['policyCodeSha256'],'Terminal scope differs')
 approval=obj(bundle['ownerApproval'],RET_EVIDENCE_DIR+'/owner-approval.json',terminal['approvalSha256'])
 need(set(approval)=={'schema','proposalSha256','retiredPayloadPaths','retainedPair','permanent','sourceMessageId','approvedAtUtc'} and approval['schema']=='pow-owner-exact-payload-retirement-approval-v1' and approval['proposalSha256']==RET_PROPOSAL_SHA and approval['retiredPayloadPaths']==list(RET_PATHS) and approval['retainedPair']==RET_PAIR and approval['permanent'] is True and all(isinstance(approval[k],str) and approval[k].strip() for k in ('sourceMessageId','approvedAtUtc')),'Exact owner approval evidence differs')
 chain=RET_validate_chain(terminal['journal'])
 need(chain['status']=='complete' and chain['lastSha256']==terminal['journalHeadSha256'] and chain['approvalSha256']==terminal['approvalSha256'],'Unresolved or unauthenticated terminal journal')
 final=terminal['journal'][-1]['data'];need(final['successorPolicyCodeSha256']==trusted['policyCodeSha256'],'Terminal successor code differs')
 proof_names={'finalFenceSha256':'final-fence.json','retainedPairProofSha256':'retained-pair-proof.json','sidecarsProofSha256':'sidecars-proof.json','historicalEvidenceProofSha256':'historical-evidence-proof.json'}
 need(isinstance(bundle['finalProofs'],dict) and set(bundle['finalProofs'])==set(proof_names),'Missing final proof documents')
 for key,name in proof_names.items():
  raw=read(bundle['finalProofs'][key],RET_EVIDENCE_DIR+'/'+name,final[key])
  if key=='sidecarsProofSha256':
   # The installed controller emits the canonical exact sidecar list, not an
   # object. Bind its bytes to the terminal list (and below to the proposal).
   need(raw==RET_encoded(terminal['preservedSidecars']),'Final sidecar proof differs from exact terminal list')
  else:dual_json(raw)
 need(terminal['preservedHistoricalEvidenceSha256']==final['historicalEvidenceProofSha256'],'Historical proof binding differs')
 proposal_raw=read(bundle['proposal'],RET_EVIDENCE_DIR+'/proposal.json',RET_PROPOSAL_SHA)
 inventory_raw=read(bundle['inventory'],RET_EVIDENCE_DIR+'/inventory.json',RET_INVENTORY_SHA)
 restore_raw=read(bundle['staticRestore'],RET_EVIDENCE_DIR+'/static-restore.json',RET_RESTORE_SHA)
 # Duplicate-key refusal precedes authoritative exact pinned proposal parsing.
 for raw in (proposal_raw,inventory_raw,restore_raw):dual_json(raw)
 proposal=RET_authenticate_proposal(proposal_raw,inventory_raw,restore_raw)
 sidecars=[{'path':r['path'],'sha256':r['sha256']} for r in proposal['sidecarsKeep']]
 need(terminal['preservedSidecars']==sidecars and isinstance(bundle['sidecars'],list) and len(bundle['sidecars'])==len(sidecars),'Sidecar scope differs')
 for row,pin in zip(bundle['sidecars'],sidecars):read(row,pin['path'],pin['sha256'])
 source=obj(bundle['sourceIndex'],RET_SOURCE_INDEX['path'],RET_SOURCE_INDEX['sha256'])
 index_binding=state.get('index')
 need(isinstance(index_binding,dict) and set(index_binding)=={'path','sha256'} and index_binding['sha256']==trusted['currentIndexSha256'],'State/current index binding differs')
 def policy_path(path,prefix):
  p=Path(path);need(p.parent==Path(RET_BASE+'/cleanup-evidence') and p.name.startswith(prefix) and p.name.endswith('.json'),'Wrong policy evidence path')
 policy_path(index_binding['path'],'audit30-policy-admission-index-')
 current=obj(bundle['currentIndex'],index_binding['path'],index_binding['sha256'])
 need(source.get('schema') in ('pow-audit30-ui-admission-index-v1','pow-ui-retention-admission-index-v2') and current.get('schema')==source['schema'] and current.get('scopeApprovalSha256')==source.get('scopeApprovalSha256')==config.get('scopeApprovalSha256'),'Admission index authority differs')
 prefix=source.get('admissions');rows=current.get('admissions')
 need(isinstance(prefix,list) and prefix and isinstance(rows,list) and len(prefix)<=len(rows)<=256 and rows[:len(prefix)]==prefix,'Source admission prefix changed')
 need(isinstance(source.get('completedRetirements',[]),list) and isinstance(current.get('completedRetirements',[]),list) and current.get('completedRetirements',[])[:len(source.get('completedRetirements',[]))]==source.get('completedRetirements',[]),'Historical retirement prefix changed')
 need(current.get('migration')==source.get('migration'),'Migration authority changed')
 for row in rows:
  need(isinstance(row,dict) and set(row)=={'path','sha256'},'Invalid admission reference');policy_path(row['path'],'audit30-policy-admission-');RET_hash_value(row['sha256'])
 need(len({r['path'] for r in rows})==len(rows),'Duplicate admissions')
 appended=bundle['appendedAdmissions'];need(isinstance(appended,list) and len(appended)==len(rows)-len(prefix),'Missing appended admissions')
 pair=RET_PAIR.copy()
 for row,pin in zip(appended,rows[len(prefix):]):
  admission=obj(row,pin['path'],pin['sha256'])
  need(admission.get('schema')=='pow-audit30-ordinary-ui-release-admission-v1' and admission.get('host')=='77.42.91.106' and admission.get('scopeApprovalSha256')==source.get('scopeApprovalSha256') and admission.get('bootstrap') is False and admission.get('migrationAnchor') is None,'Appended admission authority differs')
  next_pair=admission.get('retainedPair')
  need(isinstance(next_pair,dict) and set(next_pair)=={'current','previous'} and all(isinstance(v,str) and re.fullmatch(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',v) for v in next_pair.values()) and next_pair['previous']==pair['current'] and next_pair['current'] not in pair.values() and admission.get('releaseIds')==[next_pair['current']],'Descendant lineage differs')
  pair=next_pair
 need(pair==trusted['verifiedCurrentPair'],'Fresh independently verified pair differs')
 proof={'model':'intentionally-retired-payloads-retained-evidence-v1','proposalSha256':RET_PROPOSAL_SHA,'receipt':binding['receipt'],'receiptSha256':binding['receipt']['sha256'],'journalHeadSha256':terminal['journalHeadSha256'],'policyCodeSha256':trusted['policyCodeSha256'],'retiredPayloadPaths':list(RET_PATHS),'retirementRetainedPair':RET_PAIR.copy(),'sourceIndex':RET_SOURCE_INDEX.copy(),'recoveryVerification':'isolated-static-only'}
 need(current.get('payloadRetirement')==proof,'Current index retirement proof differs')
 return {'ok':True,'proof':proof,'verifiedCurrentPair':pair,'configSha256':trusted['configSha256'],'stateSha256':trusted['stateSha256'],'currentIndexSha256':trusted['currentIndexSha256'],'policyCodeSha256':trusted['policyCodeSha256'],'filesystemVerified':False,'activationAllowed':False}
