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
