import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { q8TextFromDecimal } from "../server/bond-units.mjs";
import {
  EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
  classifyIncbOracleRecoveryState,
  loadIncbOracleSnapshotArtifact,
  parseIncbOracleArtifactLine,
  parseRestoreIncbOracleSnapshotArgs,
  requiredIncbOracleRestoreDatabaseUrl,
  rawTopLevelJsonFields,
  restoreIncbOracleSnapshots,
  verifiedCanonicalRecoveryMetaState,
  verifiedLegacyIncbSnapshotBindings,
  verifyIncbOracleSnapshotRow,
} from "./restore-incb-oracle-snapshots.mjs";

const NETWORK = "livenet";
const TOKEN_ID =
  "3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d";
const SNAPSHOT_MODEL = "canonical-summary-h-minus-one-v1";
const SNAPSHOT_MODE = "canonical-summary-refresh";

let checks = 0;

function check(name, callback) {
  callback();
  checks += 1;
  return name;
}

async function checkAsync(name, callback) {
  await callback();
  checks += 1;
  return name;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bindingFixture(snapshotId, index) {
  const snapshotBlockHeight = 957_000 + index;
  const decimalValue = index === 0
    ? "125484756765514.14"
    : `${100_000 + index}.${String(index + 1).padStart(8, "0")}`;
  return {
    binding: {
      blockHash: sha256(`block:${snapshotId}`),
      blockHeight: snapshotBlockHeight,
      canonicalSummaryHash: sha256(`summary:${snapshotId}`),
      generatedAt: new Date(
        Date.UTC(2026, 6, 1, 0, index, 0, 603 + index),
      ).toISOString(),
      mode: SNAPSHOT_MODE,
      model: SNAPSHOT_MODEL,
      snapshotId,
      workNetworkValueQ8: q8TextFromDecimal(decimalValue),
    },
    decimalValue,
  };
}

function eventRow(binding, decimalValue, suffix = "") {
  const currentBlockHash = sha256(`current-block:${binding.snapshotId}`);
  return {
    block_height: binding.blockHeight + 1,
    canonical_current_block: true,
    canonical_current_block_hash: currentBlockHash,
    canonical_current_block_height: binding.blockHeight + 1,
    canonical_previous_block_hash: binding.blockHash,
    canonical_snapshot_block: true,
    canonical_snapshot_block_hash: binding.blockHash,
    canonical_snapshot_block_height: binding.blockHeight,
    event_id: `event:${binding.snapshotId}${suffix}`,
    snapshot_block_hash: binding.blockHash,
    snapshot_block_height: binding.blockHeight,
    snapshot_canonical_summary_hash: binding.canonicalSummaryHash,
    snapshot_generated_at: binding.generatedAt,
    snapshot_id: binding.snapshotId,
    snapshot_mode: binding.mode,
    snapshot_model: binding.model,
    snapshot_work_network_value_q8: "",
    snapshot_work_network_value_sats: decimalValue,
    transaction_block_hash: currentBlockHash,
    transaction_block_height: binding.blockHeight + 1,
    transaction_status: "confirmed",
    txid: sha256(`tx:${binding.snapshotId}${suffix}`),
  };
}

function artifactRow(binding, decimalValue) {
  return {
    consistency: {
      ok: true,
      status: "green",
    },
    generated_at: binding.generatedAt,
    indexed_through_block: binding.blockHeight,
    metrics: {
      eventCount: binding.blockHeight,
    },
    network: NETWORK,
    payload: {
      generatedAt: binding.generatedAt,
      indexedThroughBlock: binding.blockHeight,
      indexedThroughBlockHash: binding.blockHash,
      network: NETWORK,
      ok: true,
      snapshotId: binding.snapshotId,
      status: "green",
      summaryPayloads: {
        workFloor: {
          actualValue: {
            liveNetworkValueSats: decimalValue,
          },
          indexedThroughBlock: binding.blockHeight,
          indexedThroughBlockHash: binding.blockHash,
          liveNetworkValueSats: decimalValue,
          network: NETWORK,
          snapshotId: binding.snapshotId,
        },
      },
      summaryRefresh: {
        indexedThroughBlock: binding.blockHeight,
        indexedThroughBlockHash: binding.blockHash,
        mode: SNAPSHOT_MODE,
      },
    },
    snapshot_id: binding.snapshotId,
    source_hashes: {
      blockScan: binding.blockHash,
      canonicalSummary: binding.canonicalSummaryHash,
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureSet() {
  const fixtures = EXPECTED_INCB_ORACLE_SNAPSHOT_IDS.map(
    (snapshotId, index) => {
      const fixture = bindingFixture(snapshotId, index);
      return {
        ...fixture,
        artifact: artifactRow(
          fixture.binding,
          index === 0
            ? Number(fixture.decimalValue)
            : fixture.decimalValue,
        ),
        event: eventRow(fixture.binding, fixture.decimalValue),
      };
    },
  );
  const events = fixtures.map((fixture) => fixture.event);
  for (let index = 0; index < 12; index += 1) {
    events.push(
      eventRow(
        fixtures[index].binding,
        fixtures[index].decimalValue,
        ":repeat",
      ),
    );
  }
  return { events, fixtures };
}

function canonicalArtifactLine(row) {
  return JSON.stringify(row);
}

function parsedArtifactRow(row) {
  return parseIncbOracleArtifactLine(canonicalArtifactLine(row));
}

function exactLegacyWorkValueEvidence(payload) {
  const valueAt = (path) => {
    let value = payload;
    for (const key of path) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        value = undefined;
        break;
      }
      value = value[key];
    }
    if (value === undefined || value === null) {
      return { text: null, type: null };
    }
    return {
      text: String(value),
      type: typeof value === "number" ? "number" : typeof value,
    };
  };
  return {
    decimals: [
      ["summaryPayloads", "workFloor", "liveNetworkValueSats"],
      [
        "summaryPayloads",
        "workFloor",
        "actualValue",
        "liveNetworkValueSats",
      ],
      ["summaryPayloads", "workFloor", "actualValue", "liveTotalSats"],
      ["summaryPayloads", "workFloor", "actualValue", "totalSats"],
    ].map(valueAt),
    models: [
      ["totals", "workNetworkValueAccountingModel"],
      [
        "summaryPayloads",
        "workFloor",
        "workNetworkValueAccountingModel",
      ],
      [
        "summaryPayloads",
        "workFloor",
        "actualValue",
        "workNetworkValueAccountingModel",
      ],
    ].map(valueAt),
    q8: [
      ["totals", "workNetworkValueQ8"],
      ["summaryPayloads", "workFloor", "networkValueQ8"],
      ["summaryPayloads", "workFloor", "liveNetworkValueQ8"],
      [
        "summaryPayloads",
        "workFloor",
        "actualValue",
        "networkValueQ8",
      ],
      [
        "summaryPayloads",
        "workFloor",
        "actualValue",
        "liveNetworkValueQ8",
      ],
      ["summaryPayloads", "workFloor", "actualValue", "totalQ8"],
      ["summaryPayloads", "workFloor", "actualValue", "liveTotalQ8"],
    ].map(valueAt),
  };
}

function databaseRow(row) {
  const payload = JSON.parse(row.rawPayloadJson);
  return {
    consistency: JSON.parse(row.rawConsistencyJson),
    legacy_work_value_evidence: exactLegacyWorkValueEvidence(payload),
    // node-postgres returns `timestamptz` columns as Date objects. Keep the
    // fake faithful so the post-insert verifier exercises millisecond
    // preservation instead of seeing the artifact's original ISO string.
    generated_at: new Date(row.generatedAt),
    indexed_through_block: row.indexedThroughBlock,
    metrics: JSON.parse(row.rawMetricsJson),
    network: row.network,
    payload,
    raw_consistency_json: row.rawConsistencyJson,
    raw_metrics_json: row.rawMetricsJson,
    raw_payload_json: row.rawPayloadJson,
    raw_source_hashes_json: row.rawSourceHashesJson,
    snapshot_id: row.snapshotId,
    source_hashes: JSON.parse(row.rawSourceHashesJson),
  };
}

function completedCanonicalMetaRows() {
  return [{
    key: "canonical:rebuild",
    value: {
      active: false,
      complete: true,
      completedAt: "2026-07-19T15:37:02.603Z",
      incbRangeReplayVerification: {
        verified: true,
      },
      indexedThroughBlock: 960_236,
      indexedThroughBlockHash: sha256("indexed-through"),
      mode: "pwt-range-replay",
      network: NETWORK,
      rangeReplayFromHeight: 958_383,
      status: "complete",
      verifierBinding: {
        bindingId: sha256("binding"),
        model: "proof-indexer-pwt-range-replay-verifier-binding-v1",
        network: NETWORK,
        rangeReplayFromHeight: 958_383,
        witnessSetHash: sha256("witness-set"),
      },
    },
  }];
}

class FakeRecoveryClient {
  constructor(
    events,
    {
      failInsertAt = 0,
      metaRows = completedCanonicalMetaRows(),
    } = {},
  ) {
    this.events = events;
    this.failInsertAt = failInsertAt;
    this.insertAttempts = 0;
    this.log = [];
    this.metaRows = metaRows;
    this.snapshots = new Map();
    this.transactionSnapshot = null;
  }

  async query(sql, parameters = []) {
    const normalized = String(sql).replace(/\s+/gu, " ").trim();
    this.log.push(normalized);
    if (normalized === "BEGIN ISOLATION LEVEL SERIALIZABLE") {
      this.transactionSnapshot = new Map(this.snapshots);
      return { rowCount: null, rows: [] };
    }
    if (normalized === "ROLLBACK") {
      if (this.transactionSnapshot) {
        this.snapshots = new Map(this.transactionSnapshot);
      }
      this.transactionSnapshot = null;
      return { rowCount: null, rows: [] };
    }
    if (normalized === "COMMIT") {
      this.transactionSnapshot = null;
      return { rowCount: null, rows: [] };
    }
    if (
      normalized.startsWith("SET LOCAL ") ||
      normalized.startsWith("SELECT pg_advisory_xact_lock") ||
      normalized.startsWith("LOCK TABLE ")
    ) {
      return { rowCount: null, rows: [] };
    }
    if (
      normalized.includes("FROM proof_indexer.meta") &&
      normalized.includes("FOR UPDATE")
    ) {
      return {
        rowCount: this.metaRows.length,
        rows: clone(this.metaRows),
      };
    }
    if (
      normalized.includes("FROM proof_indexer.events") &&
      normalized.includes("block_height < $2")
    ) {
      return { rowCount: this.events.length, rows: this.events };
    }
    if (
      normalized.startsWith("WITH candidate AS") &&
      normalized.includes("AS legacy_work_value_evidence")
    ) {
      const payload = JSON.parse(parameters[3]);
      return {
        rowCount: 1,
        rows: [{
          consistency_json: JSON.stringify(JSON.parse(parameters[2])),
          legacy_work_value_evidence:
            exactLegacyWorkValueEvidence(payload),
          metrics_json: JSON.stringify(JSON.parse(parameters[1])),
          payload_json: JSON.stringify(payload),
          source_hashes_json: JSON.stringify(JSON.parse(parameters[0])),
        }],
      };
    }
    if (normalized.startsWith("WITH refs AS MATERIALIZED")) {
      const complete = EXPECTED_INCB_ORACLE_SNAPSHOT_IDS.every(
        (snapshotId) => this.snapshots.has(snapshotId),
      );
      return {
        rowCount: 1,
        rows: [{
          referenced_ids: 29,
          unresolved_ids: complete
            ? []
            : EXPECTED_INCB_ORACLE_SNAPSHOT_IDS.filter(
                (snapshotId) => !this.snapshots.has(snapshotId),
              ),
        }],
      };
    }
    if (
      normalized.startsWith("SELECT network, snapshot_id") &&
      normalized.includes("FROM proof_indexer.ledger_snapshots")
    ) {
      const rows = [...this.snapshots.values()]
        .sort((left, right) =>
          left.snapshot_id.localeCompare(right.snapshot_id)
        );
      return { rowCount: rows.length, rows };
    }
    if (normalized.startsWith("INSERT INTO proof_indexer.ledger_snapshots")) {
      this.insertAttempts += 1;
      if (this.insertAttempts === this.failInsertAt) {
        throw new Error(`simulated insert failure ${this.insertAttempts}`);
      }
      const [
        network,
        snapshotId,
        generatedAt,
        indexedThroughBlock,
        sourceHashesJson,
        metricsJson,
        consistencyJson,
        payloadJson,
      ] = parameters;
      if (this.snapshots.has(snapshotId)) {
        throw new Error(`duplicate snapshot ${snapshotId}`);
      }
      this.snapshots.set(snapshotId, databaseRow({
        generatedAt,
        indexedThroughBlock,
        network,
        rawConsistencyJson: consistencyJson,
        rawMetricsJson: metricsJson,
        rawPayloadJson: payloadJson,
        rawSourceHashesJson: sourceHashesJson,
        snapshotId,
      }));
      return {
        rowCount: 1,
        rows: [{ snapshot_id: snapshotId }],
      };
    }
    throw new Error(`Unexpected fake query: ${normalized}`);
  }

  release() {
    this.log.push("RELEASE");
  }
}

class FakeRecoveryPool {
  constructor(client) {
    this.client = client;
  }

  async connect() {
    return this.client;
  }
}

const { events, fixtures } = fixtureSet();
const artifactLines = fixtures.map((fixture) =>
  canonicalArtifactLine(fixture.artifact)
);
const artifactText = `${artifactLines.join("\n")}\n`;
const artifactSha256 = sha256(artifactText);
const tempDirectory = await mkdtemp(
  join(tmpdir(), "pow-incb-oracle-restore-check-"),
);
const artifactPath = join(tempDirectory, "incb-oracle-snapshots.jsonl");

try {
  await writeFile(artifactPath, artifactText, { flag: "wx", mode: 0o600 });

  const bindings = verifiedLegacyIncbSnapshotBindings(events);
  check("live binding set is exact", () => {
    assert.equal(bindings.size, 18);
    assert.deepEqual(
      [...bindings.keys()].sort(),
      [...EXPECTED_INCB_ORACLE_SNAPSHOT_IDS].sort(),
    );
  });

  check("all artifact rows match immutable mint bindings", () => {
    for (const [index, fixture] of fixtures.entries()) {
      const candidate = parsedArtifactRow(fixture.artifact);
      candidate.exactLegacyWorkValueEvidence =
        exactLegacyWorkValueEvidence(candidate.payload);
      if (index === 0) {
        const lossyNumber =
          candidate.payload.summaryPayloads.workFloor.liveNetworkValueSats;
        assert.equal(typeof lossyNumber, "number");
        assert.notEqual(
          q8TextFromDecimal(lossyNumber),
          fixture.binding.workNetworkValueQ8,
        );
      }
      const verified = verifyIncbOracleSnapshotRow(
        candidate,
        bindings.get(fixture.binding.snapshotId),
      );
      assert.equal(verified.snapshotId, fixture.binding.snapshotId);
      assert.equal(
        verified.workNetworkValueQ8,
        fixture.binding.workNetworkValueQ8,
      );
      assert.equal(
        verified.workNetworkValueMode,
        "locked-bound-legacy-work-value-v1",
      );
    }
  });

  check("divergent repeated mint binding fails closed", () => {
    const divergentEvents = clone(events);
    divergentEvents.at(-1).snapshot_generated_at =
      "2026-07-01T23:59:59.000Z";
    assert.throws(
      () => verifiedLegacyIncbSnapshotBindings(divergentEvents),
      /diverge/u,
    );
  });

  check("wrong mint model fails closed", () => {
    const wrongModel = clone(events);
    wrongModel[0].snapshot_model = "wrong-model";
    assert.throws(
      () => verifiedLegacyIncbSnapshotBindings(wrongModel),
      /wrong snapshot model/u,
    );
  });

  check("noncanonical transaction binding fails closed", () => {
    const noncanonical = clone(events);
    noncanonical[0].transaction_status = "orphaned";
    assert.throws(
      () => verifiedLegacyIncbSnapshotBindings(noncanonical),
      /confirmed canonical H-1 reference/u,
    );
  });

  check("artifact identity mismatch fails closed", () => {
    const altered = clone(fixtures[0].artifact);
    altered.payload.indexedThroughBlockHash = sha256("wrong-block");
    const candidate = parsedArtifactRow(altered);
    candidate.exactLegacyWorkValueEvidence =
      exactLegacyWorkValueEvidence(candidate.payload);
    assert.throws(
      () => verifyIncbOracleSnapshotRow(
        candidate,
        bindings.get(altered.snapshot_id),
      ),
      /immutable INCB mint binding/u,
    );
  });

  check("legacy decimal mismatch fails closed", () => {
    const altered = clone(fixtures[0].artifact);
    altered.payload.summaryPayloads.workFloor.liveNetworkValueSats =
      "1.00000000";
    const candidate = parsedArtifactRow(altered);
    candidate.exactLegacyWorkValueEvidence =
      exactLegacyWorkValueEvidence(candidate.payload);
    assert.throws(
      () => verifyIncbOracleSnapshotRow(
        candidate,
        bindings.get(altered.snapshot_id),
      ),
      /does not match its mint Q8 binding/u,
    );
  });

  check("unexpected artifact column fails closed", () => {
    const altered = {
      ...fixtures[0].artifact,
      unexpected: true,
    };
    assert.throws(
      () => parseIncbOracleArtifactLine(JSON.stringify(altered)),
      /unexpected column set/u,
    );
  });

  check("duplicate raw JSON column fails closed", () => {
    const line = artifactLines[0].replace(
      /^\{/u,
      "{\"network\":\"livenet\",",
    );
    assert.throws(
      () => rawTopLevelJsonFields(line),
      /duplicate field network/u,
    );
    assert.throws(
      () => parseIncbOracleArtifactLine(line),
      /duplicate field network/u,
    );
  });

  check("wrong artifact network fails closed", () => {
    const altered = {
      ...fixtures[0].artifact,
      network: "testnet",
    };
    assert.throws(
      () => parseIncbOracleArtifactLine(JSON.stringify(altered)),
      /not livenet/u,
    );
  });

  await checkAsync("streamed artifact load verifies exact SHA and row set", async () => {
    const artifact = await loadIncbOracleSnapshotArtifact(
      artifactPath,
      artifactSha256,
      { expectedArtifactSha256: artifactSha256 },
    );
    assert.equal(artifact.rows.size, 18);
    assert.equal(artifact.sha256, artifactSha256);
    assert.equal(artifact.bytes, Buffer.byteLength(artifactText));
  });

  await checkAsync("streamed artifact load rejects a SHA mismatch", async () => {
    await assert.rejects(
      loadIncbOracleSnapshotArtifact(
        artifactPath,
        sha256("not-the-artifact"),
        { expectedArtifactSha256: artifactSha256 },
      ),
      /supplied artifact SHA-256 does not match/u,
    );
  });

  await checkAsync("streamed artifact load rejects duplicate rows", async () => {
    const duplicatePath = join(tempDirectory, "duplicate.jsonl");
    const duplicateText = `${artifactText}${artifactLines[0]}\n`;
    const duplicateSha256 = sha256(duplicateText);
    await writeFile(duplicatePath, duplicateText, {
      flag: "wx",
      mode: 0o600,
    });
    await assert.rejects(
      loadIncbOracleSnapshotArtifact(
        duplicatePath,
        duplicateSha256,
        { expectedArtifactSha256: duplicateSha256 },
      ),
      /duplicates snapshot/u,
    );
  });

  await checkAsync("streamed artifact load rejects symlink input", async () => {
    const linkPath = join(tempDirectory, "artifact-link.jsonl");
    await symlink(artifactPath, linkPath);
    await assert.rejects(
      loadIncbOracleSnapshotArtifact(
        linkPath,
        artifactSha256,
        { expectedArtifactSha256: artifactSha256 },
      ),
      /non-symlink regular file/u,
    );
  });

  check("state classifier accepts only exact first and replay states", () => {
    const expectedFingerprints = new Map(
      EXPECTED_INCB_ORACLE_SNAPSHOT_IDS.map(
        (snapshotId) => [snapshotId, sha256(snapshotId)],
      ),
    );
    assert.equal(
      classifyIncbOracleRecoveryState({
        actualFingerprints: new Map(),
        existingSnapshotIds: [],
        expectedFingerprints,
        unresolvedSnapshotIds: EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
      }),
      "first-apply",
    );
    assert.equal(
      classifyIncbOracleRecoveryState({
        actualFingerprints: new Map(expectedFingerprints),
        existingSnapshotIds: EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
        expectedFingerprints,
        unresolvedSnapshotIds: [],
      }),
      "already-applied",
    );
    assert.throws(
      () => classifyIncbOracleRecoveryState({
        actualFingerprints: new Map(),
        existingSnapshotIds: [EXPECTED_INCB_ORACLE_SNAPSHOT_IDS[0]],
        expectedFingerprints,
        unresolvedSnapshotIds:
          EXPECTED_INCB_ORACLE_SNAPSHOT_IDS.slice(1),
      }),
      /partial or mixed/u,
    );
    const divergent = new Map(expectedFingerprints);
    divergent.set(EXPECTED_INCB_ORACLE_SNAPSHOT_IDS[0], sha256("wrong"));
    assert.throws(
      () => classifyIncbOracleRecoveryState({
        actualFingerprints: divergent,
        existingSnapshotIds: EXPECTED_INCB_ORACLE_SNAPSHOT_IDS,
        expectedFingerprints,
        unresolvedSnapshotIds: [],
      }),
      /not byte-identical/u,
    );
  });

  check("canonical recovery metadata accepts only safe inactive state", () => {
    assert.deepEqual(
      verifiedCanonicalRecoveryMetaState([]),
      {
        fault: "absent",
        rebuild: "absent",
      },
    );
    assert.deepEqual(
      verifiedCanonicalRecoveryMetaState(completedCanonicalMetaRows()),
      {
        fault: "absent",
        rebuild: "certified-complete-pwt-range-replay",
      },
    );
    assert.throws(
      () => verifiedCanonicalRecoveryMetaState([{
        key: "canonical:rebuild",
        value: {
          ...completedCanonicalMetaRows()[0].value,
          active: true,
          complete: false,
          status: "active",
        },
      }]),
      /inactive completed canonical rebuild state/u,
    );
  });

  check("CLI defaults to rollback and requires the explicit apply gate", () => {
    const argumentsList = [
      "--artifact",
      artifactPath,
      "--sha256",
      artifactSha256,
    ];
    assert.equal(
      parseRestoreIncbOracleSnapshotArgs(argumentsList, {
        POW_INDEX_DATABASE_URL: "postgresql://restore.invalid/proof_indexer",
      }).apply,
      false,
    );
    assert.throws(
      () => parseRestoreIncbOracleSnapshotArgs(
        [...argumentsList, "--apply"],
        {
          POW_INDEX_DATABASE_URL:
            "postgresql://restore.invalid/proof_indexer",
        },
      ),
      /POW_RESTORE_INCB_ORACLE_SNAPSHOTS_APPLY=1/u,
    );
    assert.equal(
      parseRestoreIncbOracleSnapshotArgs(
        [...argumentsList, "--apply"],
        {
          NETWORK,
          POW_INDEX_DATABASE_URL:
            "postgresql://restore.invalid/proof_indexer",
          POW_RESTORE_INCB_ORACLE_SNAPSHOTS_APPLY: "1",
        },
      ).apply,
      true,
    );
    assert.throws(
      () => parseRestoreIncbOracleSnapshotArgs(argumentsList, {
        NETWORK: "testnet",
        POW_INDEX_DATABASE_URL: "postgresql://restore.invalid/proof_indexer",
      }),
      /pinned to livenet/u,
    );
  });

  check("restore requires the canonical database variable", () => {
    assert.equal(
      requiredIncbOracleRestoreDatabaseUrl({
        POW_INDEX_DATABASE_URL:
          " postgresql://restore.invalid/proof_indexer ",
      }),
      "postgresql://restore.invalid/proof_indexer",
    );
    for (const env of [
      {},
      {
        DATABASE_URL: "postgresql://generic.invalid/proof_indexer",
      },
      {
        PROOF_INDEX_DATABASE_URL:
          "postgresql://legacy.invalid/proof_indexer",
      },
    ]) {
      assert.throws(
        () => requiredIncbOracleRestoreDatabaseUrl(env),
        /POW_INDEX_DATABASE_URL is required/u,
      );
      assert.throws(
        () => parseRestoreIncbOracleSnapshotArgs(
          [
            "--artifact",
            artifactPath,
            "--sha256",
            artifactSha256,
          ],
          env,
        ),
        /POW_INDEX_DATABASE_URL is required/u,
      );
    }
  });

  await checkAsync(
    "missing canonical database variable fails before artifact access",
    async () => {
      const previous = process.env.POW_INDEX_DATABASE_URL;
      delete process.env.POW_INDEX_DATABASE_URL;
      try {
        await assert.rejects(
          restoreIncbOracleSnapshots({
            apply: false,
            artifactPath: "/definitely/missing/oracle-snapshots.jsonl",
            artifactSha256,
            expectedArtifactSha256: artifactSha256,
          }),
          /POW_INDEX_DATABASE_URL is required/u,
        );
      } finally {
        if (previous === undefined) {
          delete process.env.POW_INDEX_DATABASE_URL;
        } else {
          process.env.POW_INDEX_DATABASE_URL = previous;
        }
      }
    },
  );

  await checkAsync("dry run locks, verifies, and rolls back without inserts", async () => {
    const client = new FakeRecoveryClient(events);
    const result = await restoreIncbOracleSnapshots({
      apply: false,
      artifactPath,
      artifactSha256,
      expectedArtifactSha256: artifactSha256,
      pool: new FakeRecoveryPool(client),
    });
    assert.equal(result.state, "first-apply");
    assert.equal(result.committed, false);
    assert.equal(result.wouldInsert, 18);
    assert.equal(client.snapshots.size, 0);
    assert.ok(
      client.log.some((sql) =>
        sql.includes("proof_indexer.blocks") &&
        sql.includes("proof_indexer.events") &&
        sql.includes("proof_indexer.ledger_snapshots") &&
        sql.includes("proof_indexer.meta") &&
        sql.includes("proof_indexer.transactions") &&
        sql.includes("IN SHARE ROW EXCLUSIVE MODE")
      ),
    );
    assert.ok(client.log.includes("ROLLBACK"));
    assert.ok(!client.log.includes("COMMIT"));
  });

  await checkAsync("verification error after BEGIN rolls back", async () => {
    const invalidEvents = clone(events);
    invalidEvents[0].canonical_previous_block_hash = sha256("orphan");
    const client = new FakeRecoveryClient(invalidEvents);
    await assert.rejects(
      restoreIncbOracleSnapshots({
        apply: false,
        artifactPath,
        artifactSha256,
        expectedArtifactSha256: artifactSha256,
        pool: new FakeRecoveryPool(client),
      }),
      /confirmed canonical H-1 reference/u,
    );
    assert.ok(client.log.includes("ROLLBACK"));
    assert.ok(!client.log.includes("COMMIT"));
    assert.equal(client.snapshots.size, 0);
  });

  await checkAsync("active canonical fault rolls back before inserts", async () => {
    const client = new FakeRecoveryClient(events, {
      metaRows: [
        {
          key: "canonical:fault",
          value: {
            active: true,
            network: NETWORK,
            status: "fault",
          },
        },
        ...completedCanonicalMetaRows(),
      ],
    });
    await assert.rejects(
      restoreIncbOracleSnapshots({
        apply: true,
        artifactPath,
        artifactSha256,
        expectedArtifactSha256: artifactSha256,
        pool: new FakeRecoveryPool(client),
      }),
      /blocked by an active canonical fault/u,
    );
    assert.ok(client.log.includes("ROLLBACK"));
    assert.ok(!client.log.includes("COMMIT"));
    assert.equal(client.insertAttempts, 0);
    assert.equal(client.snapshots.size, 0);
  });

  await checkAsync("mid-apply insert failure rolls back the transaction", async () => {
    const client = new FakeRecoveryClient(events, {
      failInsertAt: 2,
    });
    await assert.rejects(
      restoreIncbOracleSnapshots({
        apply: true,
        artifactPath,
        artifactSha256,
        expectedArtifactSha256: artifactSha256,
        pool: new FakeRecoveryPool(client),
      }),
      /simulated insert failure 2/u,
    );
    assert.equal(client.insertAttempts, 2);
    assert.ok(client.log.includes("ROLLBACK"));
    assert.ok(!client.log.includes("COMMIT"));
    assert.equal(client.snapshots.size, 0);
  });

  await checkAsync("first apply inserts 18 exact rows and replay changes zero", async () => {
    const client = new FakeRecoveryClient(events);
    const pool = new FakeRecoveryPool(client);
    const first = await restoreIncbOracleSnapshots({
      apply: true,
      artifactPath,
      artifactSha256,
      expectedArtifactSha256: artifactSha256,
      pool,
    });
    assert.equal(first.state, "first-apply");
    assert.equal(first.inserted, 18);
    assert.equal(first.committed, true);
    assert.equal(first.referencedIds, 29);
    assert.deepEqual(first.unresolvedAfter, []);
    assert.equal(first.targetReferences, 30);
    assert.equal(client.snapshots.size, 18);

    const insertCount = client.log.filter((sql) =>
      sql.startsWith("INSERT INTO proof_indexer.ledger_snapshots")
    ).length;
    assert.equal(insertCount, 18);
    assert.ok(
      client.log
        .filter((sql) =>
          sql.startsWith("INSERT INTO proof_indexer.ledger_snapshots")
        )
        .every((sql) => !sql.includes("ON CONFLICT")),
    );

    const replay = await restoreIncbOracleSnapshots({
      apply: true,
      artifactPath,
      artifactSha256,
      expectedArtifactSha256: artifactSha256,
      pool,
    });
    assert.equal(replay.state, "already-applied");
    assert.equal(replay.inserted, 0);
    assert.equal(replay.committed, true);
    assert.equal(client.snapshots.size, 18);
    assert.equal(
      client.log.filter((sql) =>
        sql.startsWith("INSERT INTO proof_indexer.ledger_snapshots")
      ).length,
      18,
    );
  });

  process.stdout.write(`${JSON.stringify({
    checks,
    model: "check-restore-incb-oracle-snapshots-v1",
    ok: true,
  })}\n`);
} finally {
  await rm(tempDirectory, { force: true, recursive: true });
}
