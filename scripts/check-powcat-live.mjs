// Read-only mainnet gate. Both empty and populated results require affirmative
// evidence from the typed Log reader and the matching Search generation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const base = "https://computer.proofofwork.me/api/v1/";
const get = path => fetch(base + path, {cache: "no-store", redirect: "error", signal: AbortSignal.timeout(110_000)});
const hash = /^[a-f0-9]{64}$/u;
async function json(path) {
  const response = await get(path);
  assert.equal(response.status, 200, path + " unavailable");
  return response.json();
}

export function checkInventory(kind, stats, search, log) {
  const total = kind === "powcat-part" ? stats.parts : stats.publications;
  const witness = search.coverage?.linkedFiles;
  const height = stats.indexedThroughBlock, checkpoint = stats.indexedThroughBlockHash;
  assert.equal(stats.network, "livenet");
  assert.equal(stats.complete, true);
  assert.equal(stats.source, "powcat1-discovery-v1");
  assert.equal(stats.fromHeight, 973975);
  assert(Number.isSafeInteger(height) && height >= stats.fromHeight);
  assert.match(checkpoint, hash);
  assert.match(total, /^(?:0|[1-9][0-9]*)$/u);
  assert.equal(search.network, stats.network);
  assert.equal(search.coverage?.ready, true);
  assert.equal(search.coverage.indexVersion, "proof-search-v5-powcat-files");
  assert.equal(search.coverage.checkpointHash, checkpoint);
  assert.equal(search.coverage.checkpointHeight, height);
  assert.equal(witness?.ready, true, "Search has not qualified linked files");
  assert.equal(witness.checkpointHash, checkpoint);
  assert.equal(witness.checkpointHeight, height);
  assert.equal(String(witness.confirmedParts), stats.parts);
  assert.equal(String(witness.confirmedLinkers), stats.publications);
  assert.equal(log.network, stats.network);
  assert.equal(log.kind, kind);
  assert.equal(log.indexedThroughBlock, height);
  assert.equal(log.indexedThroughBlockHash, checkpoint);
  assert.equal(log.linkedFiles?.source, stats.source, "Log did not qualify its linked-file filter");
  assert.equal(log.linkedFiles.fromHeight, stats.fromHeight);
  assert.equal(log.linkedFiles.checkpointHeight, height);
  assert.equal(log.linkedFiles.checkpointHash, checkpoint);
  assert.equal(log.linkedFiles.confirmedOnly, true);
  for (const count of [search.pagination.total, log.totalCount, log.linkedFiles.confirmedCount]) {
    assert.equal(String(count), total, kind + " count differs from Growth");
  }
  const expectedLength = total === "0" ? 0 : 1;
  assert.equal(search.results.length, expectedLength);
  assert.equal(search.pagination.returned, expectedLength);
  assert.equal(log.items.length, expectedLength);
  for (const record of [...search.results, ...log.items]) {
    assert.equal(record.protocol, "powcat1");
    assert.equal(record.kind, kind);
    assert.equal(record.status, "confirmed");
    assert.equal(record.valid, true);
    assert.match(record.txid, hash);
    assert.match(record.blockHash, hash);
  }
  if (expectedLength) {
    assert.equal(search.results[0].canonical, true);
    assert.equal(log.items[0].confirmed, true);
  }
}

export function checkExactRecord(kind, txid, checkpoint, detail, page) {
  assert.equal(detail.coverage?.linkedFiles?.checkpointHash, checkpoint);
  assert.equal(detail.coverage.linkedFiles.ready, true);
  assert.equal(detail.record.txid, txid);
  assert.equal(detail.record.kind, kind);
  assert.equal(detail.record.valid, true);
  assert.equal(detail.record.canonical, true);
  assert.equal(page.indexedThroughBlockHash, checkpoint);
  assert.equal(page.linkedFiles?.checkpointHash, checkpoint);
  assert.equal(page.linkedFiles.confirmedOnly, true);
  assert.equal(page.query, txid);
  const item = page.items.find(row => row.txid === txid && row.kind === kind);
  assert(item && item.confirmed && item.valid, "Exact Log TXID not present");
  assert.equal(item.blockHash, detail.record.blockHash);
  const expected = detail.payload?.powcat;
  assert.match(expected?.fileHash, hash);
  assert.equal(item.powcat?.fileHash, expected.fileHash);
  assert.equal(item.powcat.size, expected.size);
  if (kind === "powcat-part") {
    assert.match(expected.partHash, hash);
    for (const key of ["partHash", "index", "count"]) assert.equal(item.powcat[key], expected[key]);
  } else {
    for (const key of ["mime", "name", "count"]) assert.equal(item.powcat[key], expected[key]);
    assert.deepEqual(item.powcat.partTxids, expected.partTxids);
    assert.equal(detail.record.linkedFile?.txid, txid);
    assert.equal(detail.record.linkedFile.fileHash, expected.fileHash);
  }
}

async function run() {
  const stats = await json("powcat-activity?network=livenet&fresh=1");
  const checkpoint = stats.indexedThroughBlockHash;
  let verifiedDownload = false;
  for (const kind of ["powcat-part", "powcat-linker"]) {
    const logUrl = "log-history?network=livenet&fresh=1&confirmedOnly=1&kind=" + kind;
    const search = await json("search?network=livenet&protocol=powcat1&status=confirmed&valid=valid&limit=1&kind=" + kind);
    const log = await json(logUrl + "&limit=1");
    checkInventory(kind, stats, search, log);
    if (!search.results.length) continue;
    const record = search.results[0];
    const detail = await json("search/detail?network=livenet&id=" + encodeURIComponent(record.id));
    const event = await json(logUrl + "&q=" + record.txid + "&limit=1");
    checkExactRecord(kind, record.txid, checkpoint, detail, event);
    if (kind !== "powcat-linker") continue;
    const link = detail.record.linkedFile;
    const metadata = await json("powcat/" + link.txid + "?network=livenet");
    for (const key of ["txid", "fileHash", "size", "name", "mime"]) assert.equal(metadata[key], link[key]);
    assert.equal(metadata.confirmed, true);
    assert.equal(metadata.blockHash, record.blockHash);
    assert(Number.isSafeInteger(metadata.size) && metadata.size > 0 && metadata.size <= 4_000_000);
    const download = await get("powcat/" + link.txid + "?network=livenet&download=1");
    assert.equal(download.status, 200);
    const digest = createHash("sha256");
    let length = 0;
    for await (const bytes of download.body) {
      length += bytes.byteLength;
      assert(length <= metadata.size);
      digest.update(bytes);
    }
    assert.equal(length, metadata.size);
    assert.equal(digest.digest("hex"), metadata.fileHash);
    verifiedDownload = true;
  }
  const code = await json("code-repositories?network=livenet&limit=1&fresh=1");
  assert.equal(code.complete, true);
  assert.equal(code.source, "proof-indexer-exact-canonical-code-replay");
  assert.equal(code.linkedReferencesEnabled, true, "Code has not qualified linked commits");
  assert.equal(code.indexedThroughBlockHash, checkpoint);
  assert.equal(code.repositories.length, Math.min(1, code.pagination.total));
  if (code.repositories.length) {
    const repo = code.repositories[0].repoTxid ?? code.repositories[0].txid;
    const tree = await json("code-repository?network=livenet&fresh=1&repo=" + repo);
    assert.equal(tree.complete, true);
    assert.equal(tree.linkedReferencesEnabled, true);
    assert.equal(tree.filesComplete, true);
    assert.equal(tree.indexedThroughBlockHash, checkpoint);
    const entry = tree.files.find(item => item.sourceKind === "powcat1");
    if (entry) {
      const detail = await json("code-repository?network=livenet&repo=" + repo + "&version=" + tree.version +
        "&snapshot=" + encodeURIComponent(tree.snapshotId) + "&path=" + encodeURIComponent(entry.path));
      assert.equal(detail.file?.verified, true);
      assert.equal(detail.file.sourceTxid, entry.sourceTxid);
      const original = await json("powcat/" + entry.sourceTxid + "?network=livenet");
      assert.equal(original.fileHash, detail.file.sha256);
      assert.equal(original.size, detail.file.size);
      assert.equal(original.blockHash, detail.file.sourceEvidence.blockHash);
    }
  }
  const missing = await get("powcat/" + "0".repeat(64) + "?network=livenet&download=1");
  assert.equal(missing.status, 409, "Absent TXID cannot produce a successful download");
  console.log(JSON.stringify({ok:true,checkpoint,parts:stats.parts,publications:stats.publications,verifiedDownload}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
