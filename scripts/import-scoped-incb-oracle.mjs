import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { createProofIndexPool } from "../server/db/postgres.mjs";
import { canonicalQ16SummarySnapshotSqlEligibility } from "../server/db/proof-index-reader.mjs";
import { SCOPED_INCB_ORACLE_PIN, scopedIncbOracleWrapper, verifiedScopedIncbOracleRow,
  storedScopedIncbOracle } from "../server/incb-scoped-oracle.mjs";
import { verifyIncbRangeReplayWitnessManifest } from "../server/incb-range-replay-witness.mjs";
import { verifiedCanonicalRecoveryMetaState } from "./restore-incb-oracle-snapshots.mjs";
import { verifyPostV5IncbH1SummaryRow } from "./import-post-v5-incb-h1-summaries.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const fail = (message) => { throw new Error("Scoped INCB oracle import: " + message); };
async function pinnedFile(path, expectedHash) {
  if (!isAbsolute(path) || !/^[0-9a-f]{64}$/u.test(expectedHash)) fail("unapproved artifact");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.size < 1n || before.size > 16n * 1024n * 1024n) fail("invalid artifact size");
    const data = await handle.readFile(); const after = await handle.stat({bigint:true});
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || hash(data) !== expectedHash) fail("artifact changed or digest mismatch");
    return data.toString("utf8");
  } finally { await handle.close(); }
}

export function verifyScopedIncbReplayProof(proof, pin) {
  if (!pin || proof?.model !== "canonical-incb-scoped-replay-proof-v1" || proof.txid !== pin.txid ||
      proof.sourceRowSha256 !== pin.sourceRowSha256 || proof.sourceCommit !== pin.sourceCommit ||
      proof.sourceArchiveSha256 !== pin.sourceArchiveSha256) fail("proof identity differs");
  const rebuild = proof.rebuild, binding = rebuild?.verifierBinding, verification = rebuild?.incbRangeReplayVerification;
  const state = verifiedCanonicalRecoveryMetaState([{key:"canonical:rebuild",value:rebuild}]);
  if (state.rebuild !== "certified-complete-pwt-range-replay" || rebuild.rangeReplayFromHeight !== 958383 ||
      binding?.rangeReplayFromHeight !== 958383 || rebuild.indexedThroughBlock < pin.height + 1 ||
      binding.witnessedThroughBlock > rebuild.indexedThroughBlock ||
      verification.witnessSetHash !== binding.witnessSetHash ||
      verification.witnessCount !== binding.witnessCount ||
      verification.witnessPreserveCount !== binding.witnessPreserveCount ||
      verification.consumedPreserveCount !== binding.witnessPreserveCount ||
      verification.rederivedWitnessCount !== binding.witnessCount - binding.witnessPreserveCount) fail("source replay certificate is incomplete");
  verifyIncbRangeReplayWitnessManifest(proof.witnessManifest, {
    bindingId:binding.bindingId, count:binding.witnessCount, hash:binding.witnessSetHash,
    metaKey:binding.witnessSetMetaKey, network:"livenet", preserveCount:binding.witnessPreserveCount,
    rangeReplayFromHeight:958383, throughHash:binding.witnessedThroughBlockHash,
    throughHeight:binding.witnessedThroughBlock });
  return proof;
}

async function coreHash(height, env) {
  const headers = {"content-type":"application/json"};
  if (env.BITCOIN_RPC_USER || env.BITCOIN_RPC_PASSWORD) headers.authorization = "Basic " +
    Buffer.from((env.BITCOIN_RPC_USER ?? "") + ":" + (env.BITCOIN_RPC_PASSWORD ?? "")).toString("base64");
  const response = await fetch(env.BITCOIN_RPC_URL, {method:"POST", headers,
    body:JSON.stringify({jsonrpc:"1.0",id:"scoped-incb-oracle",method:"getblockhash",params:[height]}),
    signal:AbortSignal.timeout(20000)});
  if (!response.ok) fail("Core hash check failed");
  const body = await response.json();
  if (body.error || !/^[0-9a-f]{64}$/u.test(body.result ?? "")) fail("Core hash result is invalid");
  return body.result;
}

export async function importScopedIncbOracle({artifactPath, proofPath, apply=false,
  pool:suppliedPool, env=process.env, rpc: suppliedRpc, pin=SCOPED_INCB_ORACLE_PIN}={}) {
  if (!pin) fail("independent proof has not been approved and pinned");
  if (apply && env.POW_IMPORT_SCOPED_INCB_ORACLE_APPLY !== "1") fail("apply environment is required");
  const artifact = await pinnedFile(artifactPath,pin.sourceArtifactSha256);
  const sourceText = artifact.endsWith("\n") ? artifact.slice(0,-1) : artifact;
  const proof = verifyScopedIncbReplayProof(JSON.parse(await pinnedFile(proofPath,pin.proofSha256)),pin);
  const wrapper = scopedIncbOracleWrapper(sourceText,pin);
  const row = verifiedScopedIncbOracleRow(wrapper,pin);
  verifyPostV5IncbH1SummaryRow({network:row.network,snapshotId:row.snapshot_id,
    generatedAt:new Date(row.generated_at).toISOString(),indexedThroughBlock:row.indexed_through_block,
    sourceHashes:row.source_hashes,metrics:row.metrics,consistency:row.consistency,payload:row.payload},pin);
  const rpc = suppliedRpc ?? ((height) => coreHash(height,env));
  for (const [height,expected] of [[pin.height,pin.blockHash],[pin.height+1,pin.bondBlockHash],
    [proof.rebuild.indexedThroughBlock,proof.rebuild.indexedThroughBlockHash],
    [proof.rebuild.verifierBinding.witnessedThroughBlock,proof.rebuild.verifierBinding.witnessedThroughBlockHash]]) {
    if (await rpc(height) !== expected) fail("independent replay no longer matches Core");
  }
  const pool = suppliedPool ?? createProofIndexPool({connectionString:env.POW_INDEX_DATABASE_URL,
    env:{...env,POW_INDEX_DB_POOL_MAX:"1",POW_INDEX_DB_APP_NAME:"scoped-incb-oracle-import"}});
  let client;
  try {
    client = await pool.connect(); await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query("LOCK TABLE proof_indexer.ledger_snapshots, proof_indexer.meta, proof_indexer.blocks, proof_indexer.work_amo_block_transitions IN SHARE ROW EXCLUSIVE MODE");
    const recovery = await client.query("SELECT key,value FROM proof_indexer.meta WHERE key = ANY($1::text[]) ORDER BY key FOR SHARE",[["canonical:rebuild","canonical:fault"]]);
    const state = verifiedCanonicalRecoveryMetaState(recovery.rows);
    const live = recovery.rows.find((item) => item.key === "canonical:rebuild")?.value;
    if (!["complete","certified-complete-pwt-range-replay"].includes(state.rebuild) ||
        live.indexedThroughBlock < pin.height+1 || await rpc(live.indexedThroughBlock) !== live.indexedThroughBlockHash) fail("production recovery is not complete and Core-bound");
    const admission = await client.query(`SELECT ${canonicalQ16SummarySnapshotSqlEligibility("source")} AS eligible
      FROM jsonb_to_record($1::jsonb) AS source(network text,snapshot_id text,generated_at timestamptz,
        indexed_through_block integer,source_hashes jsonb,metrics jsonb,consistency jsonb,payload jsonb)`,[sourceText]);
    if (admission.rows.length !== 1 || admission.rows[0].eligible !== true) fail("source full Q16 summary is ineligible");
    const existing = await client.query("SELECT network,snapshot_id,generated_at,indexed_through_block,source_hashes,metrics,consistency,payload FROM proof_indexer.ledger_snapshots WHERE network=$1 AND snapshot_id=$2 FOR UPDATE",["livenet",pin.snapshotId]);
    if (existing.rows.length > 1) fail("ambiguous existing oracle");
    if (existing.rows.length) verifiedScopedIncbOracleRow(existing.rows[0],pin);
    else await client.query("INSERT INTO proof_indexer.ledger_snapshots (network,snapshot_id,generated_at,indexed_through_block,source_hashes,metrics,consistency,payload) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)",
      [wrapper.network,wrapper.snapshot_id,wrapper.generated_at,wrapper.indexed_through_block,
        JSON.stringify(wrapper.source_hashes),JSON.stringify(wrapper.metrics),JSON.stringify(wrapper.consistency),JSON.stringify(wrapper.payload)]);
    if (!await storedScopedIncbOracle(client,"livenet",pin)) fail("stored oracle is unavailable");
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return {state:existing.rows.length ? "already-applied":"ready",dryRun:!apply,
      inserted:apply && !existing.rows.length ? 1:0,targetTxid:pin.txid,snapshotId:pin.snapshotId,
      sourceRowSha256:pin.sourceRowSha256,proofSha256:pin.proofSha256,productionRecoveryChanged:false,
      publicSummaryAdmitted:false};
  } catch (error) { if (client) await client.query("ROLLBACK"); throw error; }
  finally {client?.release();if (!suppliedPool) await pool.end();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); let artifactPath,proofPath,apply=false;
  while(args.length) {const flag=args.shift();if(flag==="--artifact") artifactPath=args.shift();
    else if(flag==="--proof") proofPath=args.shift();else if(flag==="--apply") apply=true;else fail("unknown argument");}
  console.log(JSON.stringify(await importScopedIncbOracle({artifactPath,proofPath,apply}),null,2));
}
