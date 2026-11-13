#!/usr/bin/env python3
"""Prepare source-only exact overlay pins. Never installs, restarts, or changes data.
Run on the node VPS after candidate source freezes. Review the diff, tests and
generated pins before committing. A subsequent source change fails plan creation.
"""
import hashlib,json,pathlib,re,subprocess,tempfile,runpy,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
RUNTIME=pathlib.Path('/opt/proofofwork-api')
BASE='e2669bc1fd32eba625c1a65fb2a102ba6433fb7a'
ORDER=[
 'server/sql/proof-search-linked-publish-v1.sql',
 'server/publish-linked-source.mjs','src/shared/protocol/publishArticle.mjs','src/shared/protocol/publishReaderPage.mjs','src/shared/protocol/publishArticleMetadata.mjs','src/shared/protocol/powcatLimits.mjs','src/shared/protocol/powcat1.mjs',
 'server/powcat-index.mjs','server/powcat-reader.mjs','server/publish-linked.mjs',
 'server/search-linked-publish.mjs','server/search-projection.mjs',
 'server/db/search-reader.mjs','server/db/proof-index-reader.mjs',
 'server/boost-growth.mjs','server/db/boost-growth-reader.mjs',
 'scripts/backfill-proof-search.mjs','scripts/backfill-proof-indexer.mjs','server/proof-api.mjs']
sha=lambda raw:hashlib.sha256(raw).hexdigest()
# These live emergency dependencies are outside the 19-file feature scope.
# A changed math/helper/migration baseline requires a separately reviewed update.
EMERGENCY_PRESERVED={
 'server/work-amo-v5-raw.mjs':'5481e61bfdf47a73a1a8a648e6936da3673e0e05a6f18c271f28824cfba72658',
 'server/incb-replay-components.mjs':'37c567dd6b288914227c651446d532fd0bc18b9efd66ff3afe6dc189815be6a6',
 'scripts/migrate-work-amo-v5.mjs':'dee1eb9d9e3c126d12d457c19b37eb9fe286833733fc8f53c9b6d508cc0b9f3c',
}
def preserved_foundations(runtime):
 paths=('server/db/read-only-snapshot.mjs','server/search-generation-sharing.mjs',*EMERGENCY_PRESERVED)
 result={name:sha((runtime/name).read_bytes()) for name in paths}
 for name,digest in EMERGENCY_PRESERVED.items():
  if result[name]!=digest:raise ValueError('Emergency INCB dependency changed: '+name)
 return result
REVIEWED_API_INPUTS=('ed571c6426b85568abbc7466f6848923d6676c54a3d103519492f97d1efe507c', '85521ffd7be2742190242b19d1668ee4ee89bd94f93fd33f93ba87f70cadce8c', '2cf05ee8855e75b422cb422d744fa4929a37783a20c6be20ec7d540a5cd6560c')
REVIEWED_API_HUNK=b'<<<<<<< ACTIVE\nimport { bindCanonicalIncbMintPosition } from "./incb-replay-components.mjs";\n||||||| BASE\nimport { isReadOnlySnapshotBudgetError } from "./db/read-only-snapshot.mjs";\nimport { privateRegistryObservationId, withPrivateRegistryObservation, measurePrivateRegistryPhase, measurePrivateRegistryPhaseSync, createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, privateReadContext } from "./wallet-read-observation.mjs";\nconst coalesceWalletRead = createWalletReadCoalescer();\n=======\nimport { bindCanonicalIncbMintPosition } from "./incb-replay-components.mjs";\nimport { verifyLinkedArticle, linkedArticleEvidenceMatches, createCoalescedLinkedFileReader, createLinkedWriterCapabilityEndpoint } from \'./publish-linked.mjs\';\nconst linkedWriterCapabilityEndpoint=createLinkedWriterCapabilityEndpoint({\n  readMarker:()=>proofIndexPublishLinkedCapabilityPayload("livenet"),\n  readHealth:()=>healthPayload({force:true}),\n  readSearch:checkpoint=>linkedArticleSearchWriterReadiness("livenet",checkpoint,{\n    verifyCheckpoint:async height=>{const result=await bitcoinRpc("getblockhash",[height]);return result?.ok?result.result:null;},\n  }),\n  searchContract:{model:LINKED_PUBLISH_SEARCH_MODEL,indexVersion:SEARCH_INDEX_VERSION},\n  blockHashAtHeight:async height=>{const result=await bitcoinRpc("getblockhash",[height]);return result?.ok?result.result:null;},\n  enabled:()=>process.env.PUBLISH_LINKED_WRITES_ENABLED === "1",\n});\nimport { isReadOnlySnapshotBudgetError } from "./db/read-only-snapshot.mjs";\nimport { privateRegistryObservationId, withPrivateRegistryObservation, measurePrivateRegistryPhase, measurePrivateRegistryPhaseSync, createWalletReadCoalescer, walletReadIdentity, measurePrivatePhase, withPrivatePhaseTimings, privateReadContext } from "./wallet-read-observation.mjs";\nconst coalesceWalletRead = createWalletReadCoalescer();\n>>>>>>> CANDIDATE\n'
def resolve(name,raw,inputs=None):
 pattern=re.compile(rb'<<<<<<< ACTIVE\n(.*?)\|\|\|\|\|\|\| BASE\n(.*?)=======\n(.*?)>>>>>>> CANDIDATE\n',re.S)
 replacements=[]
 for match in pattern.finditer(raw):
  active,base,candidate=match.groups()
  if name in ('server/db/proof-index-reader.mjs','scripts/backfill-proof-indexer.mjs') and not base:
   # Only the already-reviewed additive import collision, never arbitrary code.
   assert active and candidate and all(line.startswith(b'import ') and line.endswith(b';') for line in (active+candidate).splitlines()),'Non-import conflict'
   result=active+candidate
  elif name=='server/proof-api.mjs' and inputs==REVIEWED_API_INPUTS and match.group()==REVIEWED_API_HUNK:
   # Exact reviewed live4e8/basee266/combined import collision only.
   # Keep the binder once; observation imports already live later in runtime.
   assert candidate.startswith(active) and candidate.endswith(base) and active
   result=candidate[:-len(base)]
  elif name=='server/proof-api.mjs' and not active and candidate.endswith(base) and base.startswith(b'import { isReadOnlySnapshotBudgetError }'):
   # Preserve moved runtime observation imports; add only new linked endpoint.
   result=candidate[:-len(base)]
   assert result.startswith(b"import { verifyLinkedArticle,") and b'createLinkedWriterCapabilityEndpoint' in result
  else: raise ValueError('Semantic merge requires review: '+name)
  replacements.append((match.group().decode(),result.decode()))
 for old,new in replacements: raw=raw.replace(old.encode(),new.encode(),1)
 assert b'<<<<<<<' not in raw and b'>>>>>>>' not in raw
 return raw,replacements
REVIEWED = {
 'server/db/search-reader.mjs': ('6d372ed6da44a1b1d54431d40b494bc701105de0e310e82fad13acc3dd1a3e6f','278fa1e497c7f5e0a3cfabe45f4f25ab3aed95520b1935116b1f927b4b5a7337','3ffd1850c67bff11ef6697c788bc6c27ad1b990ee13bfe80d5e5dc589348c649'),
 'scripts/backfill-proof-search.mjs': ('7f52a01e705fff7ec4740428a248fee71f8266f905854557cb38ddb53bb3f7cb','7c4c5ce29fdb30a22a3da6b3531c4bf13a2ef49ac8774b0cfc1ba924c661b7b9','871e6298aa455cf7f74a32824abb099fa4ecd2a2fd3580e62466b69ecbd8c642'),
}
def main():
 existing={};after={};merges={};new=[];canonical={};replay=[]
 with tempfile.TemporaryDirectory(dir=ROOT.parent,prefix='linked-profile-') as tmp:
  for name in ORDER:
   candidate=(ROOT/name).read_bytes();canonical[name]=sha(candidate);active=RUNTIME/name
   result=candidate
   if active.exists():
    a=active.read_bytes();b=subprocess.check_output(['git','-C',str(ROOT),'show',BASE+':'+name])
    existing[name]=sha(a); paths=[pathlib.Path(tmp)/x for x in ('active','base','candidate')]
    for p,raw in zip(paths,(a,b,candidate)):p.write_bytes(raw)
    m=subprocess.run(['git','merge-file','--stdout','--diff3','-L','ACTIVE','-L','BASE','-L','CANDIDATE',*paths],capture_output=True)
    result=m.stdout
    if m.returncode:
     reviewed=name in REVIEWED
     if reviewed:
      assert (sha(a),sha(b),sha(candidate))==REVIEWED[name], 'Reviewed Search source changed: '+name
      result,replacements=candidate,[]
     else: result,replacements=resolve(name,m.stdout,(sha(a),sha(b),sha(candidate)))
     merges[name]={'inputs':dict(active=sha(a),base=sha(b),canonical=sha(candidate),conflicted=sha(m.stdout)),
       'returncode':m.returncode,'replacements':replacements,'useReviewedCanonical':reviewed}
    replay.append((name,candidate,a,b,m,result))
   else:new.append(name)
   if not name.endswith('.sql'): subprocess.run(['/opt/node-v24.18.0-linux-x64/bin/node','--input-type=module','--check'],input=result,check=True,capture_output=True)
   after[name]=sha(result)
 accepted=sha(subprocess.check_output(['sudo','-n','cat','/etc/proofofwork-retention/node-source-overlays.json']))
 preserved=preserved_foundations(RUNTIME)
 text='"""Generated exact linked Publish runtime overlay. Review before commit."""\n'
 for k,v in dict(FAMILY='proof-of-work-linked-publish-runtime-v1',BASE_SOURCE_COMMIT=BASE,ACCEPTED_SHA=accepted,
   API_SHA=existing['server/proof-api.mjs'],EXISTING=existing,AFTER=after,MERGES=merges,PRESERVED=preserved,
   CANONICAL=canonical,INSTALL_ORDER=ORDER).items():text+=k+' = '+repr(v)+'\n'
 text+='NEW = frozenset('+repr(new)+')\nALLOWED = frozenset(EXISTING) | NEW\n'
 text+=("""
def validate_manifest(manifest):
    require(manifest.get('format') == FAMILY and manifest.get('baselineHead') == BASELINE_HEAD
            and manifest.get('acceptedInventorySha256') == ACCEPTED_SHA, 'Unexpected linked Publish baseline')
    candidates = validate_engine_manifest({**manifest, 'format': 'proof-of-work-amo-browse-scoped-runtime-v1'})
    require(set(AFTER) == set(ALLOWED), 'Linked Publish overlay is not sealed')
    require([row['path'] for row in manifest['sources']] == INSTALL_ORDER, 'Unexpected linked Publish scope')
    for row in manifest['sources']:
        require(row['before'] == EXISTING.get(row['path']) and row['after'] == AFTER[row['path']], 'Unreviewed linked Publish bytes')
    require(all(manifest['dependencies'].get(name) == digest for name,digest in PRESERVED.items()), 'Accepted runtime foundation changed')
    return candidates
""")
 resolver=runpy.run_path(str(ROOT/'deploy/linked-publish/release.py'))['resolve_merge']
 for name,candidate,a,b,m,result in replay:
  actual=resolver({'MERGES':merges,'EXISTING':existing,'AFTER':after},name,candidate,a,b,m)
  assert actual==result and sha(actual)==after[name], 'Exact profile merge replay failed: '+name
 if sys.argv[1:] == ['--check']:
  assert (ROOT/'deploy/linked-publish/profile.py').read_text()==text, 'Generated profile is stale'
 else:
  assert not sys.argv[1:], 'Only --check is supported'
  (ROOT/'deploy/linked-publish/profile.py').write_text(text)
 print(json.dumps({'ok':True,'profileSha256':sha(text.encode()),'sources':len(after),'new':new,'resolvedImportConflicts':list(merges),'productionChanged':False,'exactMergeReplays':len(replay)}))
if __name__=='__main__':main()
