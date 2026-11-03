// Read-only verification of a ready candidate generation through its normal
// Search reader and the independent authenticated Core checkpoint verifier.
import assert from "node:assert/strict";
import { searchCoreVerifier } from "../../scripts/backfill-proof-search.mjs";
import { searchPayload, searchDetailPayload, closeSearchReadPool } from "../../server/db/search-reader.mjs";
import { createProofIndexPool } from "../../server/db/postgres.mjs";
import { readSearchCheckpoint, SEARCH_INDEX_VERSION } from "../../server/search-projection.mjs";
import { readPowcatActivity } from "../../server/db/powcat-activity.mjs";
import { readCodeSnapshot, codeLinkedSourceFromCore, codeReferenceSourceFromCore } from "../../server/db/code-reader.mjs";
import { codeRepositoryPayload, codeRepositoriesPayload } from "../../server/code-repositories.mjs";

const network = "livenet", verify = searchCoreVerifier();
const pool = createProofIndexPool();
// Same read authority and RPC envelope used by the Code API. The stage never
// opens an API listener or invokes any node or wallet mutation.
const allowedReads = new Set(["getblockhash", "getrawtransaction", "getblock", "getblockheader",
  "getblockchaininfo", "getindexinfo", "getmempoolentry"]);
async function readRpc(method, params) {
  assert(allowedReads.has(method));
  const headers = {"content-type":"application/json"};
  if (process.env.BITCOIN_RPC_USER || process.env.BITCOIN_RPC_PASSWORD) {
    const auth = [process.env.BITCOIN_RPC_USER ?? "", process.env.BITCOIN_RPC_PASSWORD ?? ""].join(":");
    headers.authorization = "Basic " + Buffer.from(auth).toString("base64");
  }
  const response = await fetch(process.env.BITCOIN_RPC_URL, {method:"POST", redirect:"error", headers,
    body:JSON.stringify({jsonrpc:"2.0",id:"stage-code",method,params}),signal:AbortSignal.timeout(10000)});
  const body = await response.json();
  return {ok:response.ok && !body.error, result:body.result, error:body.error};
}
async function verifyCode() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state = await readCodeSnapshot(client, network, new URLSearchParams(), {verifyCheckpoint:verify,
      resolveReferenceSource:request => codeReferenceSourceFromCore(request,readRpc),
      resolveLinkedSource:request => codeLinkedSourceFromCore(request,readRpc)});
    const list = codeRepositoriesPayload(state);
    assert(list.complete && list.linkedReferencesEnabled);
    const example = state.repositories.find(repo => repo.files.length) ?? state.repositories[0];
    let verifiedPath = null;
    if (example) {
      const file = example.files.find(item => item.sourceKind === "powcat1") ?? example.files[0];
      const params = new URLSearchParams({repo:example.txid,version:example.headTxid});
      if (file) params.set("path",file.path);
      const tree = codeRepositoryPayload(state,params);
      assert(tree.filesComplete && tree.linkedReferencesEnabled);
      if (file) {
        assert.equal(tree.file?.verified,true);
        assert.equal(tree.file.sha256,file.sha256);
        verifiedPath = file.path;
      }
    }
    await client.query("COMMIT");
    return {checkpoint:list.indexedThroughBlock, repositories:list.stats.repositories, verifiedPath};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
try {
  assert.equal(SEARCH_INDEX_VERSION, "proof-search-v5-powcat-files");
  const checkpoint = await readSearchCheckpoint(pool, network);
  const files = await readPowcatActivity(pool, network, { ...checkpoint, verify });
  const search = await searchPayload(network, new URLSearchParams({limit:"1",q:"f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a"}), {pool,verifyCheckpoint:verify});
  assert.equal(search.coverage.ready, true);
  assert.equal(search.coverage.checkpointHeight, checkpoint.height);
  assert.equal(search.coverage.checkpointHash, checkpoint.hash);
  assert.equal(search.coverage.missingRawTransactions, 0);
  assert.equal(search.coverage.missingRawCarriers, 0);
  assert.equal(search.coverage.linkedFiles?.ready, true);
  assert.equal(await verify(checkpoint.height), checkpoint.hash);
  const first = search.results[0];
  assert(first?.id, "Candidate Search did not serve a result through its public reader");
  const detail = await searchDetailPayload(network, first.id, new URLSearchParams(), {pool,verifyCheckpoint:verify});
  assert.equal(detail.record?.id ?? detail.item?.id, first.id);
  const code = await verifyCode();
  assert.deepEqual(await readSearchCheckpoint(pool, network), checkpoint);
  console.log(JSON.stringify({ ok:true, indexVersion:SEARCH_INDEX_VERSION, checkpoint, files, code,
    search:search.coverage.linkedFiles, witnessSha256:search.coverage.witnessSha256, detailVerified:true }));
} finally { await closeSearchReadPool(); await pool.end(); }
