import { readFileSync } from "node:fs";
import { isDeepStrictEqual as equal } from "node:util";
import {
  NATIVE_TRANSITION_STORAGE_BASELINE_SHA256, NATIVE_TRANSITION_STORAGE_EXPANDED_SHA256,
  nativeTransitionStorageContractSql,
} from "../../server/db/native-transition-storage.mjs";
import { normalizeExpandedLiquidityPins } from "../../server/work-amo-expanded-liquidity.mjs";
import { DECLARATION_PINS } from "./qualify.mjs";
import { nativeFunctionDefinitions, sha256, stableJson, supersessions } from "./storage.mjs";

const sql = name => readFileSync(new URL(name, import.meta.url), "utf8");
const extension = sql("./extension.sql");
const publication = sql("./publish.sql");
const declaration = normalizeExpandedLiquidityPins(DECLARATION_PINS);
const first = DECLARATION_PINS.blockHeight + 1;
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const gitHash = value => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
const bounded = (n, limit) => Number.isSafeInteger(n) && n > 0 && n <= limit;
const emptySetSha = sha256(Buffer.concat([Buffer.from([1]), Buffer.from("[]")]));
const emptyBindings = { eventCount: 0, recordCount: 0, eventRowsSha256: emptySetSha, recordRowsSha256: emptySetSha };

function requireEvidence(valid, message) {
  if (!valid) throw new Error("AMO replay publication: " + message);
}

function readQualification(bytes, expected) {
  requireEvidence(Buffer.isBuffer(bytes) || typeof bytes === "string" || bytes instanceof Uint8Array, "qualification bytes required");
  const raw = Buffer.from(bytes);
  requireEvidence(raw.length > 0 && raw.length <= 32 * 1024 ** 2 && hash(expected) && sha256(raw) === expected, "qualification digest or size differs");
  const q = JSON.parse(raw.toString("utf8"));
  requireEvidence(q.format === "work-amo-expanded-liquidity-replay-qualification-v1" && q.qualified === true &&
    equal(q.declaration, declaration) && q.anchor?.height === first - 1 && q.anchor.hash === declaration.blockHash &&
    hash(q.anchor.oldNativeSha256) && hash(q.anchor.currentMainRowSha256), "declaration or anchor differs");
  requireEvidence(Array.isArray(q.blocks) && bounded(q.blocks.length, 512) && q.tip?.height === first + q.blocks.length - 1 &&
    q.blocks.at(-1).hash === q.tip.hash, "incomplete suffix");
  requireEvidence(typeof q.databaseIdentity?.databaseName === "string" && q.databaseIdentity.databaseName.length > 0 &&
    typeof q.databaseIdentity.systemIdentifier === "string" && /^[1-9][0-9]{0,19}$/u.test(q.databaseIdentity.systemIdentifier) &&
    bounded(q.databaseIdentity.port,65535) && q.databaseIdentity.unixSocketDirectories === "/var/run/postgresql" &&
    typeof q.databaseIdentity.postmasterStartedUs === "string" && /^\d+(?:\.0+)?$/u.test(q.databaseIdentity.postmasterStartedUs), "database identity missing");
  const s = q.sourceBinding;
  requireEvidence(gitHash(s?.sourceCommit) && gitHash(s.sourceTree) && hash(s.baselineSourceSha256) &&
    hash(s.candidateSourceSha256) && s.baselineSourceSha256 !== s.candidateSourceSha256 && hash(s.dependencySha256), "source identity missing");
  let parent = q.anchor.hash, oldTotal = 0, newTotal = 0, rawTotal = 0;
  for (const [i, b] of q.blocks.entries()) {
    requireEvidence(b.height === first + i && hash(b.hash) && b.previousBlockHash === parent &&
      hash(b.currentMainRowSha256) && hash(b.rawBlockSha256) && hash(b.oldPayloadCommitment) && hash(b.newPayloadCommitment) &&
      hash(b.oldNativeSha256) && hash(b.newNativeSha256) && b.oldNativeSha256 !== b.newNativeSha256 &&
      bounded(b.oldNativeBytes, 128 * 1024 ** 2) && bounded(b.newNativeBytes, 128 * 1024 ** 2) &&
      bounded(b.rawBlockBytes, 4_000_000) && equal(b.relationalBindings, emptyBindings), "invalid or nonempty qualified block");
    for (const chain of [b.oldTransitionChainCommitment,b.newTransitionChainCommitment]) {
      requireEvidence(chain?.model === "canonical-work-amo-raw-transition-chain-sha256-v1" && hash(chain.sha256) &&
        Number.isSafeInteger(chain.payloadBytes) && chain.payloadBytes > 0, "invalid transition commitment");
    }
    requireEvidence(b.oldTransitionChainCommitment.sha256 !== b.newTransitionChainCommitment.sha256 &&
      equal(b.replacementFields, { expandedLiquidity: declaration, transitionChainCommitment: b.newTransitionChainCommitment }),
    "unexpected economic or protocol field change");
    oldTotal += b.oldNativeBytes; newTotal += b.newNativeBytes; rawTotal += b.rawBlockBytes;
    parent = b.hash;
  }
  requireEvidence(Math.max(oldTotal,newTotal) <= 8 * 1024 ** 3 && rawTotal <= 2 * 1024 ** 3, "suffix resource budget exceeded");
  return q;
}

async function one(client, query, params) {
  const result = await client.query(query, params);
  requireEvidence(result.rows.length === 1, "missing or ambiguous database evidence");
  return result.rows[0];
}
async function catalogDigest(client) {
  const row = await one(client, "SELECT " + nativeTransitionStorageContractSql() + " AS catalog");
  return sha256(stableJson(row.catalog));
}

async function chainFence(q, readTip, readCanonicalHash, verifySource, allowLater) {
  requireEvidence(await verifySource(q.sourceBinding) === true, "loaded source/dependency binding changed");
  for (const b of [q.anchor,...q.blocks]) {
    requireEvidence(await readCanonicalHash(b.height) === b.hash, "Core canonical range changed");
  }
  const tip = await readTip();
  requireEvidence(equal(tip,q.tip) || (allowLater && Number.isSafeInteger(tip?.height) && tip.height > q.tip.height && hash(tip.hash)),
    "Core/index tip differs");
}

async function indexFence(client, q, allowLater) {
  const db = await one(client, `SELECT current_database() AS "databaseName", system_identifier::text AS "systemIdentifier",
    current_setting('port')::integer AS port, current_setting('unix_socket_directories') AS "unixSocketDirectories",
    (extract(epoch FROM pg_postmaster_start_time())*1000000)::numeric::text AS "postmasterStartedUs" FROM pg_control_system()`);
  requireEvidence(equal(db,q.databaseIdentity), "wrong database identity");
  const tip = await one(client, `SELECT
    (SELECT max(height) FROM proof_indexer.blocks WHERE canonical AND network='livenet') AS blocks,
    (SELECT max(block_height) FROM proof_indexer.work_amo_block_transitions WHERE network='livenet') AS seals,
    NOT EXISTS(SELECT 1 FROM proof_indexer.meta WHERE key='canonical:fault' AND value IS DISTINCT FROM 'null'::jsonb) AS healthy`);
  requireEvidence(tip.healthy && tip.blocks === tip.seals && (allowLater ? tip.seals >= q.tip.height : tip.seals === q.tip.height), "canonical checkpoint drift");
  const a = await one(client, `SELECT encode(sha256(jsonb_send(to_jsonb(t))),'hex') AS main,
    t.payload#>>'{__powNativeStorage,sha256}' AS native FROM proof_indexer.work_amo_block_transitions t
    JOIN proof_indexer.blocks b ON b.network=t.network AND b.height=t.block_height AND b.block_hash=t.block_hash AND b.canonical
    WHERE t.network='livenet' AND t.block_height=$1 AND t.block_hash=$2`, [q.anchor.height,q.anchor.hash]);
  requireEvidence(a.main === q.anchor.currentMainRowSha256 && a.native === q.anchor.oldNativeSha256, "native anchor changed");
  for (const b of q.blocks) {
    const check = await one(client, `SELECT
      EXISTS(SELECT 1 FROM proof_indexer.blocks WHERE network='livenet' AND height=$1 AND block_hash=$2 AND canonical) AS canonical,
      NOT EXISTS(SELECT 1 FROM proof_indexer.events e WHERE e.network='livenet' AND e.status='confirmed' AND e.block_height=$1
        AND e.protocol = ANY($3::text[])) AS "noEvents",
      NOT EXISTS(SELECT 1 FROM proof_indexer.op_returns r JOIN proof_indexer.transactions t ON t.txid=r.txid AND t.network=r.network
        WHERE t.network='livenet' AND t.status='confirmed' AND t.block_height=$1 AND t.block_hash=$2 AND r.protocol=ANY($3::text[])) AS "noRecords"`,
      [b.height,b.hash,["pwm1","pwa1","pwid1","pwdns1","pwb1","pwt1","pwc1"]]);
    requireEvidence(check.canonical && check.noEvents && check.noRecords, "nonempty or noncanonical stored block " + b.height);
  }
}

async function verifyPublication(client, q, qualificationSha, manifestSha) {
  const high = (await one(client, "SELECT max(block_height) AS h FROM proof_indexer.work_transition_archive_v1 WHERE network='livenet'")).h;
  for (const b of q.blocks) {
    const r = await one(client, `SELECT d.qualification_sha256=$3 AND d.manifest_sha256=$4
        AND d.source_commit=$5 AND d.source_tree=$6 AND d.through_height=$7 AND d.through_hash=$8
        AND d.replacement_fields=$9::jsonb AND d.relational_bindings=$10::jsonb
        AND encode(sha256(jsonb_send(d.old_main)),'hex')=$11 AS provenance,
      to_jsonb(t)-'payload'=d.old_main-'payload' AND t.payload#>>'{__powNativeStorage,sha256}'=$12
        AND d.new_manifest->>'sha256'=$12 AND d.old_archive_sha256=$13
        AND a.payload->>'sha256'=$13 AS pointers,
      original=proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,d.old_main->'payload')
        AND corrected=proof_indexer.read_work_transition_payload_v1(t.network,t.block_height,t.block_hash,t.payload)
        AND corrected=original||d.replacement_fields
        AND encode(sha256(jsonb_send(original)),'hex')=$13 AND encode(sha256(jsonb_send(corrected)),'hex')=$12
        AND octet_length(jsonb_send(original))=$14 AND octet_length(jsonb_send(corrected))=$15 AS frames,
      t.block_height<$16 OR EXISTS(SELECT 1 FROM proof_indexer.work_transition_hot_slots_v1 s
        WHERE s.network=t.network AND s.slot=mod(t.block_height,128) AND s.block_height=t.block_height AND s.block_hash=t.block_hash
         AND s.payload_sha256=$12 AND s.payload=corrected) AS hot
      FROM proof_indexer.work_amo_block_transitions t JOIN ${supersessions} d USING(network,block_height,block_hash)
      JOIN proof_indexer.work_transition_archive_v1 a USING(network,block_height,block_hash)
      CROSS JOIN LATERAL (SELECT proof_indexer.reconstruct_work_transition_payload_v1(a.payload) AS original,
        proof_indexer.reconstruct_work_transition_payload_v1(d.new_manifest) AS corrected) native
      WHERE t.network='livenet' AND t.block_height=$1 AND t.block_hash=$2`,
      [b.height,b.hash,qualificationSha,manifestSha,q.sourceBinding.sourceCommit,q.sourceBinding.sourceTree,
        q.tip.height,q.tip.hash,JSON.stringify(b.replacementFields),JSON.stringify(b.relationalBindings),b.currentMainRowSha256,
        b.newNativeSha256,b.oldNativeSha256,b.oldNativeBytes,b.newNativeBytes,high-127]);
    requireEvidence(r.provenance && r.pointers && r.frames && r.hot, "persistent publication evidence differs at " + b.height);
  }
}

// Receives a dedicated session, a byte-pinned qualified receipt, independent
// Core/source probes, and an explicit mode. Never enables writers or programs services.
export async function publishExpandedLiquidityReplay({client, qualificationBytes, qualificationSha256,
  readTip, readCanonicalHash, verifySource, mode, databaseIdentity}) {
  requireEvidence(["rehearse","publish","verify"].includes(mode), "explicit publication mode required");
  const q = readQualification(qualificationBytes,qualificationSha256);
  if (databaseIdentity) requireEvidence(equal(databaseIdentity,q.databaseIdentity), "requested database differs from qualification");
  const manifestSha = sha256(stableJson({
    format: "work-amo-expanded-liquidity-native-publication-v1", qualificationSha256,
    extensionSha256: sha256(extension), functionSqlSha256: sha256(nativeFunctionDefinitions.join("\n")),
    publicationSqlSha256: sha256(publication), catalog: NATIVE_TRANSITION_STORAGE_EXPANDED_SHA256,
  }));
  await chainFence(q,readTip,readCanonicalHash,verifySource,mode === "verify");
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE" + (mode === "verify" ? " READ ONLY" : ""));
  let commitDispatched = false;
  try {
    await client.query("SET LOCAL search_path=pg_catalog,pg_temp");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='1200s'");
    if (mode !== "verify") {
      await client.query("SELECT pg_advisory_xact_lock(190725,977230)");
      await client.query(`LOCK TABLE proof_indexer.work_amo_block_transitions, proof_indexer.blocks, proof_indexer.meta,
        proof_indexer.events, proof_indexer.transactions, proof_indexer.op_returns, proof_indexer.work_transition_archive_v1,
        proof_indexer.work_transition_hot_slots_v1, proof_indexer.work_transition_chunks_v1 IN SHARE ROW EXCLUSIVE MODE`);
    }
    await indexFence(client,q,mode === "verify");
    const catalog = await catalogDigest(client);
    const exists = await one(client,"SELECT to_regclass($1)::text AS name",[supersessions]);
    const already = catalog === NATIVE_TRANSITION_STORAGE_EXPANDED_SHA256;
    if (already) {
      requireEvidence(exists.name === supersessions, "missing immutable publication table");
    } else {
      requireEvidence(mode !== "verify" && catalog === NATIVE_TRANSITION_STORAGE_BASELINE_SHA256 && !exists.name, "unexpected native storage predecessor");
      await client.query(extension);
      for (const definition of nativeFunctionDefinitions) await client.query(definition);
      requireEvidence(await catalogDigest(client) === NATIVE_TRANSITION_STORAGE_EXPANDED_SHA256, "installed native catalog differs");
      await client.query("CREATE TEMP TABLE expanded_replay_input(qualification jsonb, qualification_sha text, manifest_sha text) ON COMMIT DROP");
      await client.query("INSERT INTO pg_temp.expanded_replay_input VALUES ($1::jsonb,$2,$3)",[JSON.stringify(q),qualificationSha256,manifestSha]);
      await client.query(publication);
    }
    await verifyPublication(client,q,qualificationSha256,manifestSha);
    await chainFence(q,readTip,readCanonicalHash,verifySource,mode === "verify");
    requireEvidence(await catalogDigest(client) === NATIVE_TRANSITION_STORAGE_EXPANDED_SHA256, "final native catalog differs");
    commitDispatched = mode === "publish" && !already;
    await client.query(mode === "rehearse" ? "ROLLBACK" : "COMMIT");
    return { format: "work-amo-expanded-liquidity-native-publication-result-v1", mode, qualificationSha256,
      manifestSha256:manifestSha, tip:q.tip, blocks:q.blocks.length, committed:mode !== "rehearse", alreadyPublished:already };
  } catch (error) {
    if (commitDispatched) throw new Error("AMO replay COMMIT outcome uncertain; verify the exact qualification on a fresh session", {cause:error});
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
