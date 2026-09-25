// Guarded import of two independently replayed, exact post-V5 INCB H-1
// summaries. This never updates or deletes an existing ledger snapshot.
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { decimalTextFromQ8, q8TextFromDecimal } from "../server/bond-units.mjs";
import { canonicalSummarySnapshotSqlTextMaxBytes } from "../server/canonical-summary-budget.mjs";
import { createProofIndexPool } from "../server/db/postgres.mjs";
import { canonicalQ16SummarySnapshotSqlEligibility } from "../server/db/proof-index-reader.mjs";
import { POST_V5_INCB_ISSUANCE_REPAIR_TARGETS } from "../server/incb-post-v5-repair.mjs";
import {
  incbRangeReplayWitnessMetaKey,
  verifyIncbRangeReplayWitnessManifest,
} from "../server/incb-range-replay-witness.mjs";
import {
  loadIncbOracleSnapshotArtifact,
  rawTopLevelJsonFields,
  verifiedCanonicalRecoveryMetaState,
} from "./restore-incb-oracle-snapshots.mjs";

export const POST_V5_INCB_H1_IMPORT_MODEL =
  "proof-indexer-post-v5-incb-h1-summary-artifact-v1";
export const POST_V5_INCB_H1_IMPORT_APPLY_ENV =
  "POW_IMPORT_POST_V5_INCB_H1_APPLY";
const NETWORK = "livenet";
const HASH = /^[0-9a-f]{64}$/u;
const ID = /^[0-9a-f]{24}$/u;
const POSITIVE = /^[1-9][0-9]*$/u;
const WORK_MODEL = "canonical-exact-work-network-q8-v1";
const WORK_STATE_MODEL = "canonical-work-q16-transition-checkpoint-v1";
const WORK_AMOUNT_MODEL = "work-subatoms-v2";
const WORK_TRANSITION_MODEL =
  "canonical-work-amo-full-position-block-sequencer-v4";
const WORK_TOKEN_STATE_MODEL = "canonical-work-token-state-subatoms-v3";
const WORK_STATE_COMMITMENT_MODEL =
  "canonical-work-amo-sufficient-state-sha256-v1";
const WORK_PAYLOAD_COMMITMENT_MODEL =
  "canonical-work-amo-payload-sha256-v1";
const LOCK_KEY = "proof-indexer:post-v5-incb-h1-summary-import:v1";
export const POST_V5_INCB_H1_IMPORT_TARGETS = Object.freeze(
  POST_V5_INCB_ISSUANCE_REPAIR_TARGETS.map((target) => Object.freeze({
    blockHash: target.previousBlockHash,
    bondBlockHash: target.blockHash,
    bondHeight: target.blockHeight,
    height: target.blockHeight - 1,
    workNetworkValueQ8: target.workNetworkValueQ8,
  })),
);
const SUMMARY_PAYLOAD_KEYS = Object.freeze([
  "checks", "generatedAt", "indexedThroughBlock",
  "indexedThroughBlockHash", "metrics", "missingLogEvents",
  "network", "ok", "snapshotId", "sourceHashes", "status",
  "summaryPayloads", "summaryPayloadsIndexedAt", "summaryRefresh",
  "totals", "workAmountStorageModel", "workSufficientState",
]);
const WORK_STATE_KEYS = Object.freeze([
  "amountStorageModel", "closingStateCommitment", "decimals",
  "indexedThroughBlock", "indexedThroughBlockHash", "model",
  "precisionModel", "tokenStateCommitment", "transitionModel",
  "unitScale", "workTokenStateModel",
]);
const SUMMARY_KEYS = Object.freeze([
  "growthSummary", "inceptionSummary", "infinitySummary", "logSummary",
  "marketplaceSummary", "tokenSummary", "workFloor", "workSummary",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value : null;
}
function exactKeys(value, keys) {
  return object(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function fail(message) {
  throw new Error("Post-V5 INCB H-1 import: " + message + ".");
}
function canonicalHash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) fail(label + " is not a lowercase hash");
  return value;
}
function canonicalId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail(label + " is not a lowercase snapshot id");
  return value;
}
function exactPositive(value, label) {
  if (typeof value !== "string" || !POSITIVE.test(value)) fail(label + " is not a positive decimal string");
  return value;
}
function exactDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) fail(label + " is not an exact UTC timestamp");
  return value;
}
function equal(value, expected, label) {
  if (value !== expected) fail(label + " disagrees with the pinned witness");
}

export function verifyPostV5IncbH1ImportManifest(manifest, suppliedSha256) {
  if (!exactKeys(manifest, ["model", "network", "artifactSha256", "snapshots"])) {
    fail("manifest columns are incomplete or unexpected");
  }
  equal(manifest.model, POST_V5_INCB_H1_IMPORT_MODEL, "manifest model");
  equal(manifest.network, NETWORK, "manifest network");
  canonicalHash(manifest.artifactSha256, "manifest artifact SHA-256");
  equal(manifest.artifactSha256, canonicalHash(suppliedSha256, "supplied artifact SHA-256"), "artifact SHA-256");
  if (!Array.isArray(manifest.snapshots) ||
      manifest.snapshots.length !== POST_V5_INCB_H1_IMPORT_TARGETS.length) {
    fail("manifest must name exactly two ordered H-1 snapshots");
  }
  const seenIds = new Set();
  for (let index = 0; index < POST_V5_INCB_H1_IMPORT_TARGETS.length; index += 1) {
    const witness = manifest.snapshots[index];
    const target = POST_V5_INCB_H1_IMPORT_TARGETS[index];
    if (!exactKeys(witness, ["height", "blockHash", "snapshotId", "workNetworkValueQ8"])) {
      fail("manifest witness " + index + " has unexpected columns");
    }
    equal(witness.height, target.height, "manifest height " + index);
    equal(canonicalHash(witness.blockHash, "manifest block hash " + index),
      target.blockHash, "manifest block hash " + index);
    equal(exactPositive(witness.workNetworkValueQ8, "manifest Q8 " + index),
      target.workNetworkValueQ8, "manifest Q8 " + index);
    canonicalId(witness.snapshotId, "manifest snapshot id " + index);
    if (seenIds.has(witness.snapshotId)) fail("manifest repeats a snapshot id");
    seenIds.add(witness.snapshotId);
  }
  return manifest;
}

async function readCanonicalManifest(path) {
  if (!isAbsolute(String(path ?? ""))) fail("--manifest requires an absolute path");
  const canonicalPath = resolve(path);
  const stat = await lstat(canonicalPath);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      await realpath(canonicalPath) !== canonicalPath || stat.size > 65536) {
    fail("manifest must be a canonical regular file of at most 64 KiB");
  }
  const handle = await open(canonicalPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > 65536n) fail("manifest file size is invalid");
    const text = await handle.readFile({ encoding: "utf8" });
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
      fail("manifest changed during read");
    }
    const fields = rawTopLevelJsonFields(text);
    if (fields.size !== 4) fail("manifest has duplicate or unexpected root fields");
    const snapshotText = String(fields.get("snapshots") ?? "").trim();
    if (!snapshotText.startsWith("[") || !snapshotText.endsWith("]")) {
      fail("manifest snapshots are not a JSON array");
    }
    const items = snapshotText.slice(1, -1).match(/\{[^{}]*\}/gu) ?? [];
    const separators = snapshotText.slice(1, -1).replace(/\{[^{}]*\}/gu, "");
    if (items.length !== POST_V5_INCB_H1_IMPORT_TARGETS.length ||
        !/^[\s,]*$/u.test(separators)) {
      fail("manifest snapshot objects are missing or nested");
    }
    for (const item of items) {
      if (rawTopLevelJsonFields(item).size !== 4) {
        fail("manifest snapshot has duplicate or unexpected fields");
      }
    }
    return JSON.parse(text);
  } finally {
    await handle.close();
  }
}

function checkQ8Alias(value, expected, label) {
  equal(exactPositive(value, label), expected, label);
}
function checkDecimalAlias(value, expected, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || q8TextFromDecimal(value) !== expected) {
    fail(label + " is not the exact decimal form of H-1 Q8");
  }
}
function checkCommitment(value, model, label) {
  if (!exactKeys(value, ["model", "payloadBytes", "sha256"]) ||
      value.model !== model ||
      !Number.isSafeInteger(value.payloadBytes) || value.payloadBytes <= 0) {
    fail(label + " is not a complete canonical commitment");
  }
  canonicalHash(value.sha256, label + " sha256");
}

export function verifyPostV5IncbH1SummaryRow(row, witness) {
  const target = POST_V5_INCB_H1_IMPORT_TARGETS.find(
    (candidate) => candidate.height === witness?.height,
  );
  if (!target) fail("snapshot height is outside the two-target import");
  equal(row.network, NETWORK, "snapshot network");
  equal(row.snapshotId, canonicalId(witness.snapshotId, "witness snapshot id"), "snapshot id");
  equal(row.indexedThroughBlock, target.height, "snapshot height");
  equal(witness.blockHash, target.blockHash, "witness block hash");
  equal(witness.workNetworkValueQ8, target.workNetworkValueQ8, "witness Q8");
  exactDate(row.generatedAt, "snapshot generated_at");
  if (!object(row.metrics) || !object(row.sourceHashes) ||
      !object(row.consistency) || !object(row.payload)) fail("snapshot columns are incomplete");

  const source = row.sourceHashes;
  const consistency = row.consistency;
  const payload = row.payload;
  if (!exactKeys(payload, SUMMARY_PAYLOAD_KEYS)) fail("snapshot is not a compact full canonical summary");
  if (payload.tokenStatePayloads !== undefined) fail("full summary contains token state payloads");
  equal(source.blockScan, target.blockHash, "source block hash");
  canonicalHash(source.canonicalSummary, "source canonical summary hash");
  equal(payload.snapshotId, row.snapshotId, "payload snapshot id");
  equal(payload.network, NETWORK, "payload network");
  equal(payload.indexedThroughBlock, target.height, "payload height");
  equal(payload.indexedThroughBlockHash, target.blockHash, "payload block hash");
  equal(payload.generatedAt, row.generatedAt, "payload timestamp");
  equal(payload.summaryPayloadsIndexedAt, row.generatedAt, "summary timestamp");
  equal(payload.sourceHashes?.blockScan, target.blockHash, "payload source block hash");
  equal(payload.sourceHashes?.canonicalSummary, source.canonicalSummary, "payload summary hash");
  if (!isDeepStrictEqual(payload.sourceHashes, source) ||
      !isDeepStrictEqual(payload.metrics, row.metrics) ||
      !isDeepStrictEqual(payload.checks, consistency.checks) ||
      !isDeepStrictEqual(payload.missingLogEvents, consistency.missingLogEvents)) {
    fail("snapshot payload disagrees with its stored source, metrics, or consistency columns");
  }
  equal(payload.ok, true, "payload green state");
  equal(payload.status, "green", "payload status");
  equal(consistency.ok, true, "consistency green state");
  equal(consistency.status, "green", "consistency status");
  if (!Array.isArray(consistency.checks)) fail("consistency checks are absent");
  for (const name of [
    "token-components-cover-confirmed-activity",
    "canonical-activity-count-matches-public-log",
  ]) {
    if (!consistency.checks.some((check) => check?.name === name && check.ok === true)) {
      fail("required green consistency check is absent: " + name);
    }
  }
  equal(payload.summaryRefresh?.mode, "canonical-summary-refresh", "summary refresh mode");
  equal(payload.summaryRefresh?.indexedThroughBlock, target.height, "summary refresh height");
  equal(payload.summaryRefresh?.indexedThroughBlockHash, target.blockHash, "summary refresh block hash");
  equal(payload.workAmountStorageModel, WORK_AMOUNT_MODEL, "WORK amount model");

  const summaries = payload.summaryPayloads;
  if (!object(summaries)) fail("summary payloads are absent");
  for (const key of SUMMARY_KEYS) {
    const child = summaries[key];
    if (!object(child)) fail(key + " is absent");
    equal(child.snapshotId, row.snapshotId, key + " snapshot id");
    equal(child.indexedThroughBlock, target.height, key + " height");
  }
  for (const [label, floor] of [
    ["growthSummary.workFloor", summaries.growthSummary.workFloor],
    ["marketplaceSummary.workFloor", summaries.marketplaceSummary.workFloor],
    ["workSummary.floor", summaries.workSummary.floor],
  ]) {
    if (!object(floor)) fail(label + " is absent");
    equal(floor.indexedThroughBlock, target.height, label + " height");
  }

  const totals = payload.totals;
  const floor = summaries.workFloor;
  const actual = floor.actualValue;
  if (!object(totals) || !object(actual)) fail("exact WORK summary values are absent");
  equal(floor.indexedThroughBlockHash, target.blockHash, "WORK floor hash");
  for (const [label, model] of [
    ["totals", totals.workNetworkValueAccountingModel],
    ["WORK floor", floor.workNetworkValueAccountingModel],
    ["WORK actual", actual.workNetworkValueAccountingModel],
  ]) equal(model, WORK_MODEL, label + " value model");
  const expected = target.workNetworkValueQ8;
  for (const [label, value] of [
    ["totals.workNetworkValueQ8", totals.workNetworkValueQ8],
    ["totals.workActualValueQ8", totals.workActualValueQ8],
    ["totals.growthActualValueQ8", totals.growthActualValueQ8],
    ["totals.growthWorkFloorValueQ8", totals.growthWorkFloorValueQ8],
    ["workFloor.networkValueQ8", floor.networkValueQ8],
    ["workFloor.liveNetworkValueQ8", floor.liveNetworkValueQ8],
    ["actualValue.networkValueQ8", actual.networkValueQ8],
    ["actualValue.liveNetworkValueQ8", actual.liveNetworkValueQ8],
    ["actualValue.totalQ8", actual.totalQ8],
    ["actualValue.liveTotalQ8", actual.liveTotalQ8],
  ]) checkQ8Alias(value, expected, label);
  for (const [label, value] of [
    ["workFloor.networkValueSats", floor.networkValueSats],
    ["workFloor.liveNetworkValueSats", floor.liveNetworkValueSats],
    ["actualValue.networkValueSats", actual.networkValueSats],
    ["actualValue.liveNetworkValueSats", actual.liveNetworkValueSats],
    ["actualValue.totalSats", actual.totalSats],
    ["actualValue.liveTotalSats", actual.liveTotalSats],
  ]) checkDecimalAlias(value, expected, label);
  equal(decimalTextFromQ8(expected), decimalTextFromQ8(totals.workNetworkValueQ8),
    "H-1 decimal value");

  const workState = payload.workSufficientState;
  if (!exactKeys(workState, WORK_STATE_KEYS)) fail("Q16 WORK sufficient state is incomplete");
  equal(workState.model, WORK_STATE_MODEL, "WORK sufficient state model");
  equal(workState.amountStorageModel, WORK_AMOUNT_MODEL, "WORK sufficient amount model");
  equal(workState.decimals, 16, "WORK sufficient decimals");
  equal(workState.precisionModel, "canonical-work-subatoms-v2", "WORK precision model");
  equal(workState.unitScale, "10000000000000000", "WORK unit scale");
  equal(workState.transitionModel, WORK_TRANSITION_MODEL, "WORK transition model");
  equal(workState.workTokenStateModel, WORK_TOKEN_STATE_MODEL, "WORK token state model");
  equal(workState.indexedThroughBlock, target.height, "WORK state height");
  equal(workState.indexedThroughBlockHash, target.blockHash, "WORK state hash");
  checkCommitment(workState.closingStateCommitment, WORK_STATE_COMMITMENT_MODEL,
    "WORK closing state commitment");
  checkCommitment(workState.tokenStateCommitment, WORK_PAYLOAD_COMMITMENT_MODEL,
    "WORK token state commitment");
  return { height: target.height, snapshotId: row.snapshotId, workNetworkValueQ8: expected };
}

export function classifyPostV5IncbH1ImportState(storedRows, candidates) {
  if (!Array.isArray(storedRows) || !Array.isArray(candidates) ||
      candidates.length !== POST_V5_INCB_H1_IMPORT_TARGETS.length) {
    fail("stored or candidate row set is incomplete");
  }
  const expectedIds = new Set(candidates.map((candidate) => candidate.snapshotId));
  const expectedHeights = new Set(candidates.map((candidate) => candidate.indexedThroughBlock));
  const completeRows = [];
  for (const row of storedRows) {
    const isExpectedId = expectedIds.has(row.snapshot_id);
    const isSummary = Boolean(
      row.payload?.summaryPayloads || row.payload?.summaryRefresh ||
      row.source_hashes?.canonicalSummary,
    );
    if (isExpectedId && !expectedHeights.has(Number(row.indexed_through_block))) {
      fail("a candidate snapshot id is already used at another height");
    }
    if (!isSummary && !isExpectedId) continue; // Existing block-scan-only rows stay intact.
    completeRows.push(row);
  }
  if (completeRows.length === 0) return "ready";
  if (completeRows.length !== candidates.length) {
    fail("existing full summary state is partial or duplicated");
  }
  for (const candidate of candidates) {
    const matches = completeRows.filter((row) =>
      row.snapshot_id === candidate.snapshotId &&
      Number(row.indexed_through_block) === candidate.indexedThroughBlock &&
      row.row_sha256 === candidate.rowSha256);
    if (matches.length !== 1) {
      fail("an existing full summary differs from the exact clone artifact");
    }
  }
  return "already-applied";
}

async function bitcoinRpc(method, params, env = process.env) {
  const url = String(env.BITCOIN_RPC_URL ?? "").trim();
  if (!url) fail("BITCOIN_RPC_URL is required for Core hash checks");
  const headers = { "content-type": "application/json" };
  const user = String(env.BITCOIN_RPC_USER ?? "");
  const password = String(env.BITCOIN_RPC_PASSWORD ?? "");
  if (user || password) {
    headers.authorization = "Basic " +
      Buffer.from(user + ":" + password).toString("base64");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      body: JSON.stringify({ id: "post-v5-incb-h1-import", jsonrpc: "1.0", method, params }),
      headers, method: "POST", signal: controller.signal,
    });
    if (!response.ok) fail("Core RPC " + method + " returned HTTP " + response.status);
    const result = await response.json();
    if (result?.error || typeof result?.result !== "string") {
      fail("Core RPC " + method + " did not return a block hash");
    }
    return canonicalHash(result.result, "Core RPC " + method + " result");
  } finally {
    clearTimeout(timer);
  }
}

async function verifyCoreHashes(rpc) {
  for (const target of POST_V5_INCB_H1_IMPORT_TARGETS) {
    equal(await rpc("getblockhash", [target.height]), target.blockHash,
      "Core H-1 block hash " + target.height);
    equal(await rpc("getblockhash", [target.bondHeight]), target.bondBlockHash,
      "Core bond block hash " + target.bondHeight);
  }
}

async function verifyRecoveryMeta(client, rpc) {
  const result = await client.query(
    "SELECT key, value FROM proof_indexer.meta WHERE key = ANY($1::text[]) ORDER BY key",
    [["canonical:rebuild", "canonical:fault"]],
  );
  const state = verifiedCanonicalRecoveryMetaState(result.rows);
  if (state.rebuild !== "certified-complete-pwt-range-replay") {
    fail("current canonical recovery is not a certified completed PWT range replay");
  }
  const rebuild = result.rows.find((row) => row.key === "canonical:rebuild")?.value;
  if (Number(rebuild?.rangeReplayFromHeight) !== 958383 ||
      Number(rebuild?.verifierBinding?.rangeReplayFromHeight) !== 958383) {
    fail("completed PWT replay does not have the immutable 958383 boundary");
  }
  const binding = rebuild.verifierBinding;
  const verification = rebuild.incbRangeReplayVerification;
  const witnessMetaKey = incbRangeReplayWitnessMetaKey(NETWORK, binding.bindingId);
  if (binding.witnessSetMetaKey !== witnessMetaKey ||
      !Number.isSafeInteger(Number(binding.witnessCount)) ||
      !Number.isSafeInteger(Number(binding.witnessPreserveCount)) ||
      Number(binding.witnessedThroughBlock) > Number(rebuild.indexedThroughBlock) ||
      verification.witnessSetHash !== binding.witnessSetHash ||
      Number(verification.witnessCount) !== Number(binding.witnessCount) ||
      Number(verification.witnessPreserveCount) !== Number(binding.witnessPreserveCount)) {
    fail("completed replay certificate disagrees with its immutable binding");
  }
  const witnessRows = await client.query(
    "SELECT key, value FROM proof_indexer.meta WHERE key = $1", [witnessMetaKey],
  );
  if (witnessRows.rows.length !== 1) {
    fail("completed replay witness manifest is absent or ambiguous");
  }
  verifyIncbRangeReplayWitnessManifest(witnessRows.rows[0].value, {
    bindingId: binding.bindingId,
    count: binding.witnessCount,
    hash: binding.witnessSetHash,
    metaKey: witnessMetaKey,
    network: NETWORK,
    preserveCount: binding.witnessPreserveCount,
    rangeReplayFromHeight: 958383,
    throughHash: binding.witnessedThroughBlockHash,
    throughHeight: binding.witnessedThroughBlock,
  });
  equal(await rpc("getblockhash", [Number(binding.witnessedThroughBlock)]),
    canonicalHash(binding.witnessedThroughBlockHash, "replay witness tip hash"),
    "replay witness tip hash");
  if (Number(rebuild?.indexedThroughBlock) <
      POST_V5_INCB_H1_IMPORT_TARGETS.at(-1).bondHeight) {
    fail("completed replay does not cover both confirmed bonds");
  }
  equal(await rpc("getblockhash", [Number(rebuild.indexedThroughBlock)]),
    canonicalHash(rebuild.indexedThroughBlockHash, "completed replay tip hash"),
    "completed replay tip hash");
  return state;
}

async function verifyDbWitnesses(client, manifest) {
  const heights = POST_V5_INCB_H1_IMPORT_TARGETS.flatMap(
    (target) => [target.height, target.bondHeight],
  );
  const blocks = await client.query(
    "SELECT height, block_hash, previous_block_hash FROM proof_indexer.blocks " +
    "WHERE network = $1 AND canonical = true AND height = ANY($2::integer[])",
    [NETWORK, heights],
  );
  if (blocks.rows.length !== heights.length ||
      new Set(blocks.rows.map((row) => Number(row.height))).size !== heights.length) {
    fail("canonical block witnesses are absent or ambiguous");
  }
  const transitions = await client.query(
    "SELECT block_height, block_hash, previous_block_hash, model, " +
    "state_commitment_model, work_token_state_model, opening_network_value_q8::text AS opening_q8, " +
    "closing_network_value_q8::text AS closing_q8, closing_state_sha256, " +
    "closing_state_payload_bytes, block_atomic, fee_once, invalid_zero, complete, payload " +
    "FROM proof_indexer.work_amo_block_transitions WHERE network = $1 " +
    "AND block_height = ANY($2::integer[])",
    [NETWORK, heights],
  );
  if (transitions.rows.length !== heights.length ||
      new Set(transitions.rows.map((row) => Number(row.block_height))).size !== heights.length) {
    fail("WORK transition witnesses are absent or ambiguous");
  }
  const byBlock = new Map(blocks.rows.map((row) => [Number(row.height), row]));
  const byTransition = new Map(transitions.rows.map((row) => [Number(row.block_height), row]));
  for (let index = 0; index < POST_V5_INCB_H1_IMPORT_TARGETS.length; index += 1) {
    const target = POST_V5_INCB_H1_IMPORT_TARGETS[index];
    const h1Block = byBlock.get(target.height);
    const bondBlock = byBlock.get(target.bondHeight);
    const h1 = byTransition.get(target.height);
    const bond = byTransition.get(target.bondHeight);
    equal(h1Block.block_hash, target.blockHash, "canonical H-1 block");
    equal(bondBlock.block_hash, target.bondBlockHash, "canonical bond block");
    equal(bondBlock.previous_block_hash, target.blockHash, "canonical bond predecessor");
    for (const [height, transition, hash] of [
      [target.height, h1, target.blockHash],
      [target.bondHeight, bond, target.bondBlockHash],
    ]) {
      equal(transition.block_hash, hash, "WORK transition block hash " + height);
      equal(transition.model, WORK_TRANSITION_MODEL, "WORK transition model " + height);
      equal(transition.state_commitment_model, WORK_STATE_COMMITMENT_MODEL,
        "WORK state commitment model " + height);
      equal(transition.work_token_state_model, WORK_TOKEN_STATE_MODEL,
        "WORK token state model " + height);
      if (transition.complete !== true || transition.block_atomic !== true ||
          transition.fee_once !== true || transition.invalid_zero !== true) {
        fail("WORK transition flags are incomplete at " + height);
      }
    }
    equal(h1.closing_q8, target.workNetworkValueQ8, "H-1 closing WORK Q8");
    equal(bond.opening_q8, target.workNetworkValueQ8, "bond opening WORK Q8");
    equal(bond.previous_block_hash, target.blockHash, "bond transition predecessor");
    const row = manifest.snapshots[index];
    equal(row.blockHash, h1.block_hash, "manifest transition hash");
    equal(row.workNetworkValueQ8, h1.closing_q8, "manifest transition Q8");
  }
  return byTransition;
}

async function canonicalCandidate(client, row) {
  const sql = [
    "WITH snapshot AS (SELECT $1::text AS network, $2::text AS snapshot_id,",
    "$3::timestamptz AS generated_at, $4::integer AS indexed_through_block,",
    "$5::jsonb AS source_hashes, $6::jsonb AS metrics,",
    "$7::jsonb AS consistency, $8::jsonb AS payload)",
    "SELECT encode(sha256(convert_to(to_jsonb(snapshot)::text, 'UTF8')), 'hex') AS row_sha256,",
    "octet_length(payload::text) <= $9 AS within_budget,",
    "(" + canonicalQ16SummarySnapshotSqlEligibility("snapshot") + ") AS q16_eligible",
    "FROM snapshot",
  ].join(" ");
  const result = await client.query(sql, [
    row.network, row.snapshotId, row.generatedAt, row.indexedThroughBlock,
    row.rawSourceHashesJson, row.rawMetricsJson, row.rawConsistencyJson,
    row.rawPayloadJson, canonicalSummarySnapshotSqlTextMaxBytes(),
  ]);
  const candidate = result.rows[0];
  if (result.rows.length !== 1 || !HASH.test(candidate?.row_sha256 ?? "") ||
      candidate.within_budget !== true || candidate.q16_eligible !== true) {
    fail("candidate does not satisfy the live canonical Q16 summary selector");
  }
  return { ...row, rowSha256: candidate.row_sha256 };
}

function verifyStateCommitments(candidates, transitions) {
  for (const row of candidates) {
    const transition = transitions.get(row.indexedThroughBlock);
    const state = row.payload.workSufficientState;
    const closing = state.closingStateCommitment;
    const token = state.tokenStateCommitment;
    equal(closing.model, transition.state_commitment_model,
      "snapshot closing state commitment model");
    equal(closing.payloadBytes, transition.closing_state_payload_bytes,
      "snapshot closing state payload length");
    equal(closing.sha256, transition.closing_state_sha256,
      "snapshot closing state digest");
    const witnessToken = transition.payload?.closingSufficientState?.tokenStateCommitment;
    if (!object(witnessToken)) fail("transition token commitment is absent");
    equal(token.model, witnessToken.model, "snapshot token commitment model");
    equal(token.payloadBytes, witnessToken.payloadBytes, "snapshot token commitment length");
    equal(token.sha256, witnessToken.sha256, "snapshot token commitment digest");
  }
}

async function storedSnapshots(client, manifest) {
  const heights = POST_V5_INCB_H1_IMPORT_TARGETS.map((target) => target.height);
  const ids = manifest.snapshots.map((entry) => entry.snapshotId);
  const result = await client.query(
    "SELECT network, snapshot_id, indexed_through_block, source_hashes, payload, " +
    "encode(sha256(convert_to(to_jsonb(snapshot)::text, 'UTF8')), 'hex') AS row_sha256 " +
    "FROM proof_indexer.ledger_snapshots snapshot WHERE network = $1 " +
    "AND (indexed_through_block = ANY($2::integer[]) OR snapshot_id = ANY($3::text[]))",
    [NETWORK, heights, ids],
  );
  return result.rows;
}

async function insertSnapshot(client, row) {
  const result = await client.query(
    "INSERT INTO proof_indexer.ledger_snapshots " +
    "(network, snapshot_id, generated_at, indexed_through_block, source_hashes, metrics, consistency, payload) " +
    "VALUES ($1, $2, $3::timestamptz, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb) " +
    "RETURNING snapshot_id",
    [
      row.network, row.snapshotId, row.generatedAt, row.indexedThroughBlock,
      row.rawSourceHashesJson, row.rawMetricsJson, row.rawConsistencyJson,
      row.rawPayloadJson,
    ],
  );
  if (result.rowCount !== 1 || result.rows[0]?.snapshot_id !== row.snapshotId) {
    fail("exact summary row insert failed");
  }
}

export async function importPostV5IncbH1Summaries({
  apply = false,
  artifactPath,
  artifactSha256,
  manifestPath,
  pool: suppliedPool,
  rpc: suppliedRpc,
  env = process.env,
} = {}) {
  if (apply && env[POST_V5_INCB_H1_IMPORT_APPLY_ENV] !== "1") {
    fail("--apply requires " + POST_V5_INCB_H1_IMPORT_APPLY_ENV + "=1");
  }
  const manifest = verifyPostV5IncbH1ImportManifest(
    await readCanonicalManifest(manifestPath), artifactSha256,
  );
  const artifact = await loadIncbOracleSnapshotArtifact(
    artifactPath, artifactSha256, {
      expectedArtifactSha256: manifest.artifactSha256,
      expectedSnapshotIds: manifest.snapshots.map((row) => row.snapshotId),
    },
  );
  const sourceRows = manifest.snapshots.map((witness) => {
    const row = artifact.rows.get(witness.snapshotId);
    if (!row) fail("artifact is missing " + witness.snapshotId);
    verifyPostV5IncbH1SummaryRow(row, witness);
    return row;
  });
  const rpc = suppliedRpc ?? ((method, params) => bitcoinRpc(method, params, env));
  await verifyCoreHashes(rpc);

  const dbUrl = String(env.POW_INDEX_DATABASE_URL ?? "").trim();
  if (!suppliedPool && !dbUrl) fail("POW_INDEX_DATABASE_URL is required");
  const pool = suppliedPool ?? createProofIndexPool({
    connectionString: dbUrl,
    env: {
      ...env,
      POW_INDEX_DB_APP_NAME: "post-v5-incb-h1-summary-import",
      POW_INDEX_DB_POOL_MAX: "1",
    },
  });
  const ownsPool = !suppliedPool;
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK_KEY],
    );
    await client.query(
      "LOCK TABLE proof_indexer.blocks, proof_indexer.work_amo_block_transitions, " +
      "proof_indexer.ledger_snapshots, proof_indexer.meta IN SHARE ROW EXCLUSIVE MODE",
    );
    const recovery = await verifyRecoveryMeta(client, rpc);
    const transitions = await verifyDbWitnesses(client, manifest);
    const candidates = [];
    for (const row of sourceRows) candidates.push(await canonicalCandidate(client, row));
    verifyStateCommitments(candidates, transitions);
    const state = classifyPostV5IncbH1ImportState(
      await storedSnapshots(client, manifest), candidates,
    );

    let inserted = 0;
    if (apply && state === "ready") {
      for (const row of candidates) {
        await insertSnapshot(client, row);
        inserted += 1;
      }
      const afterState = classifyPostV5IncbH1ImportState(
        await storedSnapshots(client, manifest), candidates,
      );
      equal(afterState, "already-applied", "post-insert summary state");
      await verifyRecoveryMeta(client, rpc);
      await verifyCoreHashes(rpc);
    }
    if (!apply) {
      await client.query("ROLLBACK");
      transactionOpen = false;
    } else {
      await client.query("COMMIT");
      transactionOpen = false;
    }
    return {
      apply, artifactSha256: manifest.artifactSha256,
      inserted, recovery, state,
      snapshots: candidates.map((row) => ({
        blockHash: row.sourceHashes.blockScan,
        height: row.indexedThroughBlock,
        rowSha256: row.rowSha256,
        snapshotId: row.snapshotId,
        workNetworkValueQ8: row.payload.totals.workNetworkValueQ8,
      })),
    };
  } catch (error) {
    if (transactionOpen && client) {
      try { await client.query("ROLLBACK"); } catch { /* Keep original failure. */ }
    }
    throw error;
  } finally {
    client?.release();
    if (ownsPool) await pool.end();
  }
}

export function parsePostV5IncbH1ImportArgs(argv) {
  if (!Array.isArray(argv)) fail("CLI arguments are invalid");
  const result = { apply: false };
  const required = new Set(["--artifact", "--manifest", "--sha256"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") {
      if (result.apply) fail("--apply was supplied twice");
      result.apply = true;
      continue;
    }
    if (!required.has(flag) || !argv[index + 1] ||
        String(argv[index + 1]).startsWith("--") ||
        Object.hasOwn(result, flag)) {
      fail("unknown, duplicate, or valueless CLI flag: " + flag);
    }
    result[flag] = argv[++index];
  }
  for (const flag of required) {
    if (!result[flag]) fail("required CLI flag is absent: " + flag);
  }
  if (!isAbsolute(result["--artifact"]) || !isAbsolute(result["--manifest"])) {
    fail("artifact and manifest paths must be absolute");
  }
  return {
    apply: result.apply,
    artifactPath: result["--artifact"],
    artifactSha256: result["--sha256"],
    manifestPath: result["--manifest"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  importPostV5IncbH1Summaries(parsePostV5IncbH1ImportArgs(process.argv.slice(2)))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
