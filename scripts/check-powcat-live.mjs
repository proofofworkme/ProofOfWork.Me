// Production acceptance reads only. The no-publication case is tested using
// independent, checkpoint-matched index and Search counts, never a funded wallet.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const base = "https://computer.proofofwork.me/api/v1/";
const get = path => fetch(base + path, {cache:"no-store", redirect:"error", signal:AbortSignal.timeout(110_000)});
async function json(path) {
  const res=await get(path);
  assert.equal(res.status,200,path+" unavailable");
  return res.json();
}
const stats = await json("powcat-activity?network=livenet&fresh=1");
assert.equal(stats.complete,true); assert.equal(stats.source,"powcat1-discovery-v1");
assert.equal(stats.fromHeight,973975);
const checkpoint = stats.indexedThroughBlockHash;
assert.match(checkpoint,/^[0-9a-f]{64}$/u);
const search = await json("search?network=livenet&protocol=powcat1&status=confirmed&valid=valid&kind=powcat-linker&limit=1");
assert.equal(search.coverage?.ready,true);
assert.equal(search.coverage.linkedFiles?.ready,true,"Search has not indexed linked files at its checkpoint.");
assert.equal(search.coverage.linkedFiles.checkpointHash, checkpoint,"Search and Growth differ; recheck after indexing.");
assert.equal(BigInt(search.pagination.total),BigInt(stats.publications),"Search and Growth disagree on publications.");
const log = await json("log-history?network=livenet&kind=powcat-linker&limit=1&fresh=1");
assert(Array.isArray(log.items)); assert.equal(BigInt(log.totalCount),BigInt(stats.publications),"Log and Growth disagree.");
if (search.results.length) {
  const record=search.results[0], link=record.linkedFile;
  assert.equal(record.status,"confirmed"); assert.equal(record.valid,true);
  assert.equal(link.txid,record.txid);
  const event=await json("log-history?network=livenet&kind=powcat-linker&txid="+link.txid+"&limit=1");
  assert(event.items?.some(item => item.txid===link.txid && item.powcat?.fileHash===link.fileHash),"Log file SHA differs from Search.");
  const metadata=await json("powcat/"+link.txid+"?network=livenet");
  assert.equal(metadata.fileHash,link.fileHash); assert(metadata.size>0 && metadata.size<=4_000_000);
  const download=await get("powcat/"+link.txid+"?network=livenet&download=1");
  assert.equal(download.status,200);
  const digest=createHash("sha256"); let length=0;
  for await (const bytes of download.body) { length+=bytes.byteLength; assert(length<=metadata.size); digest.update(bytes); }
  assert.equal(length,metadata.size); assert.equal(digest.digest("hex"),metadata.fileHash);
}
const code=await json("code-repositories?network=livenet&limit=1&fresh=1");
assert.equal(code.complete,true); assert.equal(code.source,"proof-indexer-exact-canonical-code-replay");
assert.equal(code.linkedReferencesEnabled,true,"Code's reader has not qualified the linked commit version.");
assert(Array.isArray(code.repositories));
if (code.repositories.length) {
  const repo=code.repositories[0].repoTxid ?? code.repositories[0].txid;
  const tree=await json("code-repository?network=livenet&fresh=1&repo="+repo);
  assert.equal(tree.complete,true); assert.equal(tree.linkedReferencesEnabled,true); assert.equal(tree.filesComplete,true);
  const entry=tree.files.find(item=>item.sourceKind==="powcat1");
  if (entry) {
    const detail=await json("code-repository?network=livenet&repo="+repo+"&version="+tree.version+"&path="+encodeURIComponent(entry.path));
    assert.equal(detail.file?.verified,true); assert.equal(detail.file.sourceTxid,entry.sourceTxid);
    const original=await json("powcat/"+entry.sourceTxid+"?network=livenet");
    assert.equal(original.fileHash,detail.file.sha256); assert.equal(original.size,detail.file.size);
  }
}
const missing=await get("powcat/"+"0".repeat(64)+"?network=livenet&download=1");
assert.equal(missing.status,409,"Absent TXID cannot produce a successful download.");
console.log(JSON.stringify({ok:true,checkpoint,parts:stats.parts,publications:stats.publications,verifiedDownload:Boolean(search.results.length)}));
