import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildIncbRangeReplayWitnessManifest,
  incbRangeReplayWitnessMetaKey,
} from "../server/incb-range-replay-witness.mjs";
import {
  POST_V5_INCB_H1_IMPORT_APPLY_ENV,
  POST_V5_INCB_H1_IMPORT_MODEL,
  POST_V5_INCB_H1_IMPORT_TARGETS,
  classifyPostV5IncbH1ImportState,
  importPostV5IncbH1Summaries,
  parsePostV5IncbH1ImportArgs,
  verifyPostV5IncbH1ImportManifest,
  verifyPostV5IncbH1SummaryRow,
} from "./import-post-v5-incb-h1-summaries.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const id = (value) => sha(value).slice(0, 24);
const clone = (value) => structuredClone(value);
let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  return name;
}
async function checkAsync(name, fn) {
  await fn();
  checks += 1;
  return name;
}
function fixture(target, index) {
  const snapshotId = id("post-v5-h1:" + target.height);
  const generatedAt = new Date(Date.UTC(2026, 8, 23, 16, index, 0)).toISOString();
  const canonicalSummary = sha("full-summary:" + target.height);
  const sourceHashes = { blockScan: target.blockHash, canonicalSummary };
  const q8 = target.workNetworkValueQ8;
  const decimal = (BigInt(q8) / 100000000n).toString() + "." +
    (BigInt(q8) % 100000000n).toString().padStart(8, "0");
  const child = () => ({ snapshotId, indexedThroughBlock: target.height });
  const floor = {
    ...child(), indexedThroughBlockHash: target.blockHash,
    workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
    networkValueQ8: q8, liveNetworkValueQ8: q8,
    liveNetworkValueSats: decimal, networkValueSats: decimal,
    actualValue: {
      workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
      networkValueQ8: q8, liveNetworkValueQ8: q8,
      totalQ8: q8, liveTotalQ8: q8,
      totalSats: decimal, liveTotalSats: decimal,
    },
  };
  const commitment = (model, suffix) => ({
    model, payloadBytes: 123, sha256: sha("state:" + target.height + ":" + suffix),
  });
  const row = {
    network: "livenet", snapshotId, generatedAt,
    indexedThroughBlock: target.height, sourceHashes, metrics: {},
    consistency: {
      ok: true, status: "green", missingLogEvents: [],
      checks: [
        { name: "token-components-cover-confirmed-activity", ok: true },
        { name: "canonical-activity-count-matches-public-log", ok: true },
      ],
    },
    payload: {
      checks: [
        { name: "token-components-cover-confirmed-activity", ok: true },
        { name: "canonical-activity-count-matches-public-log", ok: true },
      ], generatedAt, indexedThroughBlock: target.height,
      indexedThroughBlockHash: target.blockHash,
      metrics: {}, missingLogEvents: [], network: "livenet",
      ok: true, snapshotId, sourceHashes, status: "green",
      summaryPayloads: {
        growthSummary: { ...child(), workFloor: { indexedThroughBlock: target.height } },
        inceptionSummary: child(), infinitySummary: child(),
        logSummary: child(),
        marketplaceSummary: { ...child(), workFloor: { indexedThroughBlock: target.height } },
        tokenSummary: child(), workFloor: floor,
        workSummary: { ...child(), floor: { indexedThroughBlock: target.height } },
      },
      summaryPayloadsIndexedAt: generatedAt,
      summaryRefresh: {
        mode: "canonical-summary-refresh",
        indexedThroughBlock: target.height,
        indexedThroughBlockHash: target.blockHash,
      },
      totals: {
        workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
        workNetworkValueQ8: q8, workActualValueQ8: q8,
        growthActualValueQ8: q8, growthWorkFloorValueQ8: q8,
      },
      workAmountStorageModel: "work-subatoms-v2",
      workSufficientState: {
        amountStorageModel: "work-subatoms-v2",
        closingStateCommitment: commitment(
          "canonical-work-amo-sufficient-state-sha256-v1", "closing"),
        decimals: 16, indexedThroughBlock: target.height,
        indexedThroughBlockHash: target.blockHash,
        model: "canonical-work-q16-transition-checkpoint-v1",
        precisionModel: "canonical-work-subatoms-v2",
        tokenStateCommitment: commitment(
          "canonical-work-amo-payload-sha256-v1", "token"),
        transitionModel: "canonical-work-amo-full-position-block-sequencer-v4",
        unitScale: "10000000000000000",
        workTokenStateModel: "canonical-work-token-state-subatoms-v3",
      },
    },
  };
  const witness = {
    blockHash: target.blockHash, height: target.height,
    snapshotId, workNetworkValueQ8: q8,
  };
  return { row, witness };
}

const fixtures = POST_V5_INCB_H1_IMPORT_TARGETS.map(fixture);
const manifestBase = {
  model: POST_V5_INCB_H1_IMPORT_MODEL, network: "livenet",
  artifactSha256: sha("artifact"), snapshots: fixtures.map((item) => item.witness),
};
check("exact two-target witness manifest", () => {
  assert.equal(verifyPostV5IncbH1ImportManifest(manifestBase, sha("artifact")), manifestBase);
  assert.throws(() => verifyPostV5IncbH1ImportManifest(
    { ...manifestBase, snapshots: manifestBase.snapshots.slice(0, 1) }, sha("artifact")));
  assert.throws(() => verifyPostV5IncbH1ImportManifest(
    { ...manifestBase, snapshots: [...manifestBase.snapshots].reverse() }, sha("artifact")));
  assert.throws(() => verifyPostV5IncbH1ImportManifest(manifestBase, sha("other")));
});
check("full green exact Q8 and snapshot coverage", () => {
  for (const { row, witness } of fixtures) {
    assert.equal(verifyPostV5IncbH1SummaryRow(row, witness).snapshotId, row.snapshotId);
  }
  const badQ8 = clone(fixtures[0].row);
  badQ8.payload.summaryPayloads.workFloor.actualValue.totalQ8 = "1";
  assert.throws(() => verifyPostV5IncbH1SummaryRow(badQ8, fixtures[0].witness));
  const badSummary = clone(fixtures[0].row);
  badSummary.payload.summaryPayloads.inceptionSummary.snapshotId = id("different");
  assert.throws(() => verifyPostV5IncbH1SummaryRow(badSummary, fixtures[0].witness));
  const badConsistency = clone(fixtures[0].row);
  badConsistency.payload.checks[0].ok = false;
  assert.throws(() => verifyPostV5IncbH1SummaryRow(
    badConsistency, fixtures[0].witness));
  const badWorkState = clone(fixtures[0].row);
  badWorkState.payload.workSufficientState.tokenStateCommitment.sha256 = sha("wrong");
  // A syntactically valid alternate commitment is rejected against the DB transition in preflight.
  assert.equal(verifyPostV5IncbH1SummaryRow(badWorkState, fixtures[0].witness).snapshotId,
    badWorkState.snapshotId);
  const noState = clone(fixtures[0].row);
  delete noState.payload.workSufficientState;
  assert.throws(() => verifyPostV5IncbH1SummaryRow(noState, fixtures[0].witness));
});
check("duplicate or divergent full summaries abort without changing scan rows", () => {
  const candidates = fixtures.map(({ row }) => ({
    snapshotId: row.snapshotId, indexedThroughBlock: row.indexedThroughBlock,
    rowSha256: sha(row.snapshotId),
  }));
  const scan = fixtures.map(({ row }) => ({
    snapshot_id: "scan:" + row.snapshotId,
    indexed_through_block: row.indexedThroughBlock,
    source_hashes: { blockScan: row.sourceHashes.blockScan },
    payload: { blockScan: true },
  }));
  assert.equal(classifyPostV5IncbH1ImportState(scan, candidates), "ready");
  const full = candidates.map((candidate) => ({
    snapshot_id: candidate.snapshotId,
    indexed_through_block: candidate.indexedThroughBlock,
    row_sha256: candidate.rowSha256,
    source_hashes: { canonicalSummary: sha("summary") },
    payload: { summaryPayloads: {} },
  }));
  assert.equal(classifyPostV5IncbH1ImportState([...scan, ...full], candidates),
    "already-applied");
  assert.throws(() => classifyPostV5IncbH1ImportState([...scan, full[0]], candidates));
  assert.throws(() => classifyPostV5IncbH1ImportState([...scan, full[0],
    { ...full[1], row_sha256: sha("drift") }], candidates));
});
check("CLI requires explicit, absolute artifact pins", () => {
  const parsed = parsePostV5IncbH1ImportArgs([
    "--artifact", "/tmp/a", "--manifest", "/tmp/m", "--sha256", sha("a"),
  ]);
  assert.equal(parsed.apply, false);
  assert.throws(() => parsePostV5IncbH1ImportArgs([
    "--artifact", "relative", "--manifest", "/tmp/m", "--sha256", sha("a"),
  ]));
  assert.throws(() => parsePostV5IncbH1ImportArgs(["--apply"]));
});

const directory = await mkdtemp(join(tmpdir(), "post-v5-incb-h1-test-"));
try {
  const artifactPath = join(directory, "snapshots.ndjson");
  const manifestPath = join(directory, "manifest.json");
  const artifactText = fixtures.map(({ row }) => JSON.stringify({
    network: row.network,
    snapshot_id: row.snapshotId,
    generated_at: row.generatedAt,
    indexed_through_block: row.indexedThroughBlock,
    source_hashes: row.sourceHashes,
    metrics: row.metrics,
    consistency: row.consistency,
    payload: row.payload,
  })).join("\n") + "\n";
  const artifactSha256 = sha(artifactText);
  await writeFile(artifactPath, artifactText);
  await writeFile(manifestPath, JSON.stringify({
    ...manifestBase, artifactSha256,
  }));
  const replayManifest = buildIncbRangeReplayWitnessManifest({
    bindingId: sha("binding"), createdAt: "2026-07-20T12:00:00.000Z",
    entries: [], network: "livenet", rangeReplayFromHeight: 958383,
    throughHash: sha("replay-tip"), throughHeight: 958400,
  });
  const replayMetaKey = incbRangeReplayWitnessMetaKey("livenet", sha("binding"));
  const hashes = new Map([[958400, sha("replay-tip")], [968200, sha("tip")],
    ...POST_V5_INCB_H1_IMPORT_TARGETS.flatMap((target) => [
    [target.height, target.blockHash],
    [target.bondHeight, target.bondBlockHash],
  ])]);
  let stored = fixtures.map(({ row }) => ({
    snapshot_id: "scan:" + row.snapshotId,
    indexed_through_block: row.indexedThroughBlock,
    source_hashes: { blockScan: row.sourceHashes.blockScan },
    payload: { blockScan: true },
  }));
  const queries = [];
  const meta = [
    {
      key: "canonical:rebuild",
      value: {
        network: "livenet", active: false, complete: true, status: "complete",
        completedAt: "2026-09-23T12:00:00.000Z",
        indexedThroughBlock: 968200, indexedThroughBlockHash: sha("tip"),
        mode: "pwt-range-replay", rangeReplayFromHeight: 958383,
        verifierBinding: {
          model: "proof-indexer-pwt-range-replay-verifier-binding-v1",
          network: "livenet", rangeReplayFromHeight: 958383,
          bindingId: sha("binding"), witnessSetHash: replayManifest.commitment.hash,
          witnessSetMetaKey: replayMetaKey, witnessCount: 0,
          witnessPreserveCount: 0, witnessedThroughBlock: 958400,
          witnessedThroughBlockHash: sha("replay-tip"),
        },
        incbRangeReplayVerification: {
          verified: true, witnessSetHash: replayManifest.commitment.hash,
          witnessCount: 0, witnessPreserveCount: 0,
        },
      },
    },
    { key: "canonical:fault", value: { network: "livenet", active: false } },
  ];
  const dbBlocks = POST_V5_INCB_H1_IMPORT_TARGETS.flatMap((target) => [
    { height: target.height, block_hash: target.blockHash },
    { height: target.bondHeight, block_hash: target.bondBlockHash,
      previous_block_hash: target.blockHash },
  ]);
  const dbTransitions = POST_V5_INCB_H1_IMPORT_TARGETS.flatMap((target, index) => {
    const state = fixtures[index].row.payload.workSufficientState;
    const common = {
      model: state.transitionModel,
      state_commitment_model: state.closingStateCommitment.model,
      work_token_state_model: state.workTokenStateModel,
      block_atomic: true, fee_once: true, invalid_zero: true, complete: true,
      closing_state_sha256: state.closingStateCommitment.sha256,
      closing_state_payload_bytes: state.closingStateCommitment.payloadBytes,
      payload: { closingSufficientState: {
        tokenStateCommitment: state.tokenStateCommitment,
      } },
    };
    return [
      { ...common, block_height: target.height, block_hash: target.blockHash,
        closing_q8: target.workNetworkValueQ8 },
      { ...common, block_height: target.bondHeight,
        block_hash: target.bondBlockHash, previous_block_hash: target.blockHash,
        opening_q8: target.workNetworkValueQ8 },
    ];
  });
  const fakeClient = {
    release() {},
    async query(sql, params) {
      queries.push(sql);
      if (sql.includes("FROM proof_indexer.meta")) {
        return sql.includes("WHERE key = $1")
          ? { rows: [{ key: replayMetaKey, value: replayManifest }] }
          : { rows: meta };
      }
      if (sql.includes("FROM proof_indexer.blocks")) return { rows: dbBlocks };
      if (sql.includes("FROM proof_indexer.work_amo_block_transitions WHERE")) {
        return { rows: dbTransitions };
      }
      if (sql.includes("WITH snapshot AS")) {
        return { rows: [{
          row_sha256: sha(params[1]), within_budget: true, q16_eligible: true,
        }] };
      }
      if (sql.includes("FROM proof_indexer.ledger_snapshots snapshot")) {
        return { rows: stored };
      }
      if (sql.includes("INSERT INTO proof_indexer.ledger_snapshots")) {
        stored = [...stored, {
          snapshot_id: params[1], indexed_through_block: params[3],
          source_hashes: JSON.parse(params[4]),
          payload: JSON.parse(params[7]),
          row_sha256: sha(params[1]),
        }];
        return { rowCount: 1, rows: [{ snapshot_id: params[1] }] };
      }
      return { rows: [] };
    },
  };
  const pool = { async connect() { return fakeClient; } };
  const rpc = async (method, [height]) => {
    assert.equal(method, "getblockhash");
    return hashes.get(height);
  };
  const options = { artifactPath, artifactSha256, manifestPath, pool, rpc };
  await checkAsync("dry run proves all gates and rolls back with no insert", async () => {
    const result = await importPostV5IncbH1Summaries(options);
    assert.equal(result.state, "ready");
    assert.equal(result.inserted, 0);
    assert(queries.includes("ROLLBACK"));
    assert(!queries.some((sql) => sql.includes("INSERT INTO proof_indexer.ledger_snapshots")));
  });
  await checkAsync("apply needs independent environment gate", async () => {
    await assert.rejects(importPostV5IncbH1Summaries({ ...options, apply: true }));
  });
  await checkAsync("Core mismatch aborts before DB access", async () => {
    const previousQueries = queries.length;
    await assert.rejects(importPostV5IncbH1Summaries({
      ...options, rpc: async () => sha("wrong-core-block"),
    }));
    assert.equal(queries.length, previousQueries);
  });
  await checkAsync("active canonical fault aborts and rolls back", async () => {
    meta[1].value.active = true;
    const before = queries.length;
    await assert.rejects(importPostV5IncbH1Summaries(options));
    assert(queries.slice(before).includes("ROLLBACK"));
    meta[1].value.active = false;
  });
  await checkAsync("replay witness binding drift aborts and rolls back", async () => {
    const original = meta[0].value.verifierBinding.witnessSetHash;
    meta[0].value.verifierBinding.witnessSetHash = sha("drifted-witness-set");
    const before = queries.length;
    await assert.rejects(importPostV5IncbH1Summaries(options));
    assert(queries.slice(before).includes("ROLLBACK"));
    meta[0].value.verifierBinding.witnessSetHash = original;
  });
  await checkAsync("WORK H-1 Q8 mismatch aborts and rolls back", async () => {
    const original = dbTransitions[0].closing_q8;
    dbTransitions[0].closing_q8 = "1";
    const before = queries.length;
    await assert.rejects(importPostV5IncbH1Summaries(options));
    assert(queries.slice(before).includes("ROLLBACK"));
    dbTransitions[0].closing_q8 = original;
  });
  await checkAsync("apply inserts exactly two rows and rechecks state", async () => {
    const result = await importPostV5IncbH1Summaries({
      ...options, apply: true, env: { [POST_V5_INCB_H1_IMPORT_APPLY_ENV]: "1" },
    });
    assert.equal(result.inserted, 2);
    assert.equal(result.state, "ready");
    assert.equal(queries.filter((sql) =>
      sql.includes("INSERT INTO proof_indexer.ledger_snapshots")).length, 2);
    assert(queries.includes("COMMIT"));
    assert.equal(stored.length, 4);
  });
  await checkAsync("repeated apply is exact and idempotent", async () => {
    const result = await importPostV5IncbH1Summaries({
      ...options, apply: true, env: { [POST_V5_INCB_H1_IMPORT_APPLY_ENV]: "1" },
    });
    assert.equal(result.state, "already-applied");
    assert.equal(result.inserted, 0);
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log(checks + " post-V5 INCB H-1 importer checks passed");
