import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";

import {
  AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
  CANONICAL_TX_CONTENT_FAILURE_CLASS,
  CANONICAL_TX_CONTENT_FAILURE_CODE,
  WORKER_CORE_TIP_ADVANCED_CODE,
  canonicalWorkerFailureFromError,
  canonicalWorkerFailureFromLine,
  containableCanonicalFailure,
  createWorkerRuntime,
  markWorkerNoProgressAlerted,
  nextWorkerNoProgressState,
  pendingBackfillChildTimeoutMs,
  requestWorkerStop,
  resetWorkerNoProgressState,
  runBestEffortPendingBackfill,
  runCanonicalBeforePending,
  runScript,
  shouldEscalateWorkerFailure,
  workerBackfillPhasePlan,
  workerCoreTipAdvanceFromError,
  workerIdleTipPollMs,
  workerNoProgressFromMeta,
  workerPendingEventHealth,
  workerSleepUntilIntervalOrTipAdvance,
  workerWorkAmoV8ActivationLatchReady,
  workerWorkAmoV8DeclarationConfig,
  workerWorkQ16PendingParentMembershipTxids,
  workerWorkPrecisionConfirmedReplayEnvelopeReady,
  workerWorkPrecisionCoreTipReady,
  workerWorkPrecisionEra,
  workerWorkPrecisionFromMeta,
  workerWorkPrecisionForCoreTipAdvance,
  workerWorkPrecisionPendingProjection,
  workerWorkPrecisionPendingParity,
  workerWorkPrecisionPendingWitnessReady,
  workerWorkPrecisionRelationalParity,
  workerWorkPrecisionSnapshotReady,
  workerWorkPrecisionV2MarkerReady,
} from "./run-proof-indexer-worker.mjs";
import {
  workAmoV8DeclarationCommitment,
} from "../server/work-amo-v8-declaration.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5CanonicalStateCommitment,
} from "../server/work-amo-v5.mjs";
import {
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  workAmoV8CanonicalTokenStateCommitment,
} from "../server/work-amo-v8.mjs";
import {
  WORK_PRECISION_V2_MODEL,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
} from "../server/work-units.mjs";

const TXID = "b".repeat(64);
const CHECKPOINT_HASH = "a".repeat(64);
const NEXT_CHECKPOINT_HASH = "c".repeat(64);
const START_MS = Date.parse("2026-07-18T12:00:00.000Z");
const DOMAIN_ERROR =
  `Canonical protocol transaction ${TXID} input 0 has an invalid outpoint`;

const BACKFILL_PATH = new URL("./backfill-proof-indexer.mjs", import.meta.url);
const API_PROOF_INDEX_CONFIG_PATH = new URL(
  "../deploy/proofofwork-api-proof-index.conf",
  import.meta.url,
);
const WORKER_SERVICE_PATH = new URL(
  "../deploy/proofofwork-indexer-worker.service",
  import.meta.url,
);
const WORKER_PATH = new URL(
  "./run-proof-indexer-worker.mjs",
  import.meta.url,
);
const PARITY_PATH = new URL(
  "./check-proof-indexer-parity.mjs",
  import.meta.url,
);
const fixtureMode = process.argv.find((value) => value.startsWith("--fixture="))
  ?.split("=")[1];

function deploymentEnvironmentValues(source, name) {
  const pattern = new RegExp(
    `^Environment=${name.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&")}=(.*)$`,
    "gmu",
  );
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function topLevelFunctionSource(name, path = BACKFILL_PATH) {
  const source = readFileSync(path, "utf8");
  const startPattern = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`,
    "mu",
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Could not find ${name} in ${path.pathname}`);
  }
  const rest = source.slice(startMatch.index + startMatch[0].length);
  const nextMatch =
    /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/mu.exec(
      rest,
    );
  const end = nextMatch
    ? startMatch.index + startMatch[0].length + nextMatch.index
    : source.length;
  return source.slice(startMatch.index, end).trim().replace(/^export\s+/u, "");
}

function isolatedBackfillFunction(name, globals = {}) {
  const context = vm.createContext({ ...globals });
  const definition = topLevelFunctionSource(name);
  new vm.Script(`${definition}\nthis.__checkedFunction = ${name};`, {
    filename: BACKFILL_PATH.pathname,
  }).runInContext(context);
  return context.__checkedFunction;
}

function fixtureFailureRecord({ transient = false } = {}) {
  return {
    error: transient ? "Verifier request returned HTTP 503" : DOMAIN_ERROR,
    errorName: transient
      ? "AbortError"
      : CANONICAL_TX_CONTENT_FAILURE_CLASS,
    ...(transient
      ? { statusCode: 503 }
      : {
          failureClass: CANONICAL_TX_CONTENT_FAILURE_CLASS,
          failureCode: CANONICAL_TX_CONTENT_FAILURE_CODE,
        }),
    height: 958_432,
    phase: "block-scan-verification",
    txid: TXID,
  };
}

function workPrecisionBoundaryFixture({
  blockHash,
  blockHeight,
  previousBlockHash,
}) {
  const closingTokenState = {
    confirmedSupplySubatoms: "0",
    holders: [],
    listings: [],
  };
  const commonState = {
    baseState: Object.fromEntries(
      WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [field, "0"]),
    ),
    creditFixedQ8: "1",
    creditMovementFrozenValueQ8: "0",
    genericTokenStateCommitment: {
      model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      payloadBytes: 1,
      sha256: "31".repeat(32),
    },
    idStateCommitment: {
      model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      payloadBytes: 1,
      sha256: "32".repeat(32),
    },
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
    movements: [],
    network: "livenet",
    networkValueQ8: "1",
    quoteHead: null,
    tokenStateCommitment:
      workAmoV8CanonicalTokenStateCommitment(closingTokenState),
  };
  const openingSufficientState = {
    ...structuredClone(commonState),
    throughBlockHash: previousBlockHash,
    throughBlockHeight: blockHeight - 1,
  };
  const closingSufficientState = {
    ...structuredClone(commonState),
    throughBlockHash: blockHash,
    throughBlockHeight: blockHeight,
  };
  const openingStateCommitment =
    workAmoV5CanonicalStateCommitment(openingSufficientState);
  const closingStateCommitment =
    workAmoV5CanonicalStateCommitment(closingSufficientState);
  return {
    blockAtomic: true,
    blockHash,
    blockHeight,
    closingNetworkValueQ8: "1",
    closingStatePayloadBytes: closingStateCommitment.payloadBytes,
    closingStateSha256: closingStateCommitment.sha256,
    complete: true,
    feeOnce: true,
    invalidZero: true,
    model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
    network: "livenet",
    openingNetworkValueQ8: "1",
    openingStatePayloadBytes: openingStateCommitment.payloadBytes,
    openingStateSha256: openingStateCommitment.sha256,
    payload: {
      blockAtomic: true,
      blockHash,
      blockHeight,
      closingStateCommitment,
      closingSufficientState,
      closingTokenState,
      complete: true,
      feeOnce: true,
      invalidZero: true,
      model: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
      network: "livenet",
      openingStateCommitment,
      openingSufficientState,
      previousBlockHash,
      workTokenStateModel: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
    },
    previousBlockHash,
    stateCommitmentModel: WORK_AMO_V5_STATE_COMMITMENT_MODEL,
    workTokenStateModel: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  };
}

const v8CoreDeclarationVerifier = topLevelFunctionSource(
  "exactWorkAmoV8CoreDeclarationEvidence",
);
assert.match(
  v8CoreDeclarationVerifier,
  /workAmoV8DeclarationCarrierEvidence\(hydrated,[\s\S]*declarationProtocolVout/u,
  "the V8 latch must verify the exact raw declaration carrier output",
);
assert.doesNotMatch(
  v8CoreDeclarationVerifier,
  /canonicalRawProtocolRecordSetFromTransaction/u,
  "the V8 latch must not select the subject-position PWM aggregate",
);

function emitFixtureFailure(options) {
  const line = JSON.stringify({
    ...fixtureFailureRecord(options),
  });
  // Node 22 can report the asynchronous stream callback before a child pipe
  // has actually delivered its final chunk. This fixture models a fatal
  // worker record, so make the process-boundary write synchronous.
  writeSync(process.stderr.fd, `${line}\n`);
}

if (fixtureMode === "poison-exit") {
  await emitFixtureFailure();
  process.exitCode = 7;
} else if (fixtureMode === "transient-exit") {
  await emitFixtureFailure({ transient: true });
  process.exitCode = 8;
} else if (fixtureMode === "poison-timeout") {
  await emitFixtureFailure();
  const timer = setInterval(() => {}, 1_000);
  process.once("SIGTERM", () => clearInterval(timer));
} else if (fixtureMode === "wait-for-stop") {
  const timer = setInterval(() => {}, 1_000);
  process.once("SIGTERM", () => clearInterval(timer));
} else if (fixtureMode === "ignore-term") {
  setInterval(() => {}, 1_000);
  process.on("SIGTERM", () => {});
} else {
  await runChecks();
}

async function runChecks() {
  const workerSource = readFileSync(WORKER_PATH, "utf8");
  const paritySource = readFileSync(PARITY_PATH, "utf8");
  const registryHistorySnapshotsSource = topLevelFunctionSource(
    "registryHistorySnapshots",
  );
  assert.match(
    registryHistorySnapshotsSource,
    /unpagedEndpoint\("\/api\/v1\/registry"/u,
  );
  assert.doesNotMatch(
    registryHistorySnapshotsSource,
    /\/api\/v1\/registry-history/u,
    "one scan-bound registry state must produce every stored history family",
  );
  const historySnapshotSource = topLevelFunctionSource("readHistorySnapshot");
  assert.match(historySnapshotSource, /payloadStart !== items\.length/u);
  assert.match(historySnapshotSource, /totalCount !== items\.length/u);
  const tokenHistorySnapshotSource = topLevelFunctionSource(
    "tokenHistorySnapshotFromState",
  );
  assert.match(
    tokenHistorySnapshotSource,
    /indexedThroughBlockHash: state\?\.indexedThroughBlockHash/u,
  );
  const scopedTokenSnapshotsSource = topLevelFunctionSource(
    "tokenHistorySnapshotsForScope",
  );
  assert.match(
    scopedTokenSnapshotsSource,
    /Number\(marketLog\.indexedThroughBlock\)[\s\S]*Number\(state\.indexedThroughBlock\)[\s\S]*marketLog\.indexedThroughBlockHash[\s\S]*state\.indexedThroughBlockHash[\s\S]*startsWith\("proof-indexer-"\)/u,
  );
  const updateTransactionStatusSource = topLevelFunctionSource(
    "updateTransactionStatus",
    WORKER_PATH,
  );
  const refreshPendingStatusesSource = topLevelFunctionSource(
    "refreshPendingStatuses",
    WORKER_PATH,
  );
  const dropWorkQ16PendingStageMemberSource = topLevelFunctionSource(
    "dropWorkQ16PendingStageMember",
  );
  const upsertEventSource = topLevelFunctionSource("upsertEvent");
  const nonconfirmedEventMetadataEnd = paritySource.indexOf(
    ") AS nonconfirmed_events_with_block_metadata",
  );
  const nonconfirmedEventMetadataStart = paritySource.lastIndexOf(
    "(\n          SELECT count(*)",
    nonconfirmedEventMetadataEnd,
  );
  assert.ok(
    nonconfirmedEventMetadataStart >= 0 &&
      nonconfirmedEventMetadataEnd > nonconfirmedEventMetadataStart,
    "the nonconfirmed event metadata parity invariant must remain inspectable",
  );
  const nonconfirmedEventMetadataSource = paritySource.slice(
    nonconfirmedEventMetadataStart,
    nonconfirmedEventMetadataEnd,
  );
  for (const source of [
    updateTransactionStatusSource,
    dropWorkQ16PendingStageMemberSource,
  ]) {
    assert.doesNotMatch(
      source,
      /op_return_vout\s*=\s*NULL|record_ordinal\s*=\s*0/u,
      "pending and dropped reconciliation must preserve exact raw protocol positions",
    );
    assert.match(
      source,
      /block_height\s*=\s*NULL[\s\S]*block_index\s*=\s*NULL[\s\S]*block_time\s*=\s*NULL/u,
      "pending and dropped reconciliation must still clear confirmed block metadata",
    );
  }
  assert.match(
    upsertEventSource,
    /ELSE COALESCE\(\s*EXCLUDED\.op_return_vout,\s*proof_indexer\.events\.op_return_vout\s*\)[\s\S]*WHEN EXCLUDED\.op_return_vout IS NOT NULL\s*THEN EXCLUDED\.record_ordinal\s*ELSE proof_indexer\.events\.record_ordinal/u,
    "a positionless pending refresh must not erase a previously proven raw protocol position",
  );
  assert.match(
    nonconfirmedEventMetadataSource,
    /block_height IS NOT NULL[\s\S]*block_index IS NOT NULL[\s\S]*block_time IS NOT NULL/u,
    "nonconfirmed parity must continue rejecting confirmed block metadata",
  );
  assert.doesNotMatch(
    nonconfirmedEventMetadataSource,
    /op_return_vout|record_ordinal/u,
    "nonconfirmed parity must treat protocol output and record ordinal as protocol metadata",
  );
  assert.match(
    refreshPendingStatusesSource,
    /workQ16PendingLegacyStatusMembership\(pool\)[\s\S]*NOT \(txid = ANY\(\$4::text\[\]\)\)/u,
    "legacy status selection must exclude every Q16 parent-witness member",
  );
  assert.match(
    refreshPendingStatusesSource,
    /q16ParentDeferred: 0[\s\S]*outcome\?\.reason === "q16-parent-witness-owned"[\s\S]*summary\.q16ParentDeferred \+= 1[\s\S]*summary\.deferred \+= Math\.max\(0, summary\.staleCandidates - summary\.checked\)/u,
    "a capped or timed-out pending status sweep must retain an explicit deferred backlog witness",
  );
  const workPrecisionReplayReadySource = topLevelFunctionSource(
    "assertWorkPrecisionReplayReady",
    WORKER_PATH,
  );
  assert.match(
    workPrecisionReplayReadySource,
    /'workSufficientState',[\s\S]*snapshot\.payload->'workSufficientState'/u,
    "Q16 worker readiness must read the compact sufficient-state witness",
  );
  assert.match(
    workPrecisionReplayReadySource,
    /snapshot\.payload \? 'workSufficientState'[\s\S]*NOT \(snapshot\.payload \? 'tokenStatePayloads'\)/u,
    "Q16 worker readiness must select compact snapshots and reject the obsolete full-state root",
  );
  assert.match(
    workPrecisionReplayReadySource,
    /octet_length\(snapshot\.payload::text\) <=[\s\S]*CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES[\s\S]*jsonb_object_keys[\s\S]*canonicalSummarySnapshotRootKeysSql/u,
    "Q16 worker readiness must enforce the canonical reader's payload-size and root-key envelope",
  );
  assert.match(
    updateTransactionStatusSource,
    /LOCK TABLE proof_indexer\.transactions IN ROW EXCLUSIVE MODE[\s\S]*SELECT status, raw_tx[\s\S]*workQ16PendingLegacyStatusMembership\(client, \{ lock: true \}\)[\s\S]*q16-parent-witness-owned/u,
    "legacy status mutation must serialize with atomic publication before rechecking Q16 ownership under a witness-row lock",
  );
  const invalidTransitionAuditStart = workerSource.indexOf(
    "SELECT count(*)::integer\n" +
      "            FROM proof_indexer.work_amo_block_transitions transition\n" +
      "            LEFT JOIN proof_indexer.blocks block",
  );
  const invalidTransitionAuditEnd = workerSource.indexOf(
    ") AS invalid_transition_count",
    invalidTransitionAuditStart,
  );
  assert.ok(
    invalidTransitionAuditStart >= 0 &&
      invalidTransitionAuditEnd > invalidTransitionAuditStart,
    "the historical transition audit must remain directly inspectable",
  );
  const invalidTransitionAudit = workerSource.slice(
    invalidTransitionAuditStart,
    invalidTransitionAuditEnd,
  );
  assert.match(
    invalidTransitionAudit,
    /previous_transition\.closing_state_sha256 <>\s*transition\.opening_state_sha256/u,
    "every post-activation transition must chain its opening state to the prior close",
  );
  assert.match(
    invalidTransitionAudit,
    /block\.previous_block_hash <>\s*transition\.previous_block_hash/u,
    "the transition predecessor must match the current canonical block header",
  );
  assert.match(
    invalidTransitionAudit,
    /previous_transition\.closing_network_value_q8 <>\s*transition\.opening_network_value_q8[\s\S]*previous_transition\.closing_state_payload_bytes <>\s*transition\.opening_state_payload_bytes/u,
    "the historical transition audit must retain exact scalar value and payload-byte continuity",
  );
  assert.doesNotMatch(
    invalidTransitionAudit,
    /(?:previous_)?transition\.payload/u,
    "the historical transition audit must not detoast every payload",
  );
  assert.match(
    invalidTransitionAudit,
    /transition\.block_height = \$2[\s\S]*transition\.previous_block_hash <> \$10/u,
    "the activation transition predecessor must be the declaration block",
  );
  assert.match(
    invalidTransitionAudit,
    /transition\.model <> \$3[\s\S]*transition\.work_token_state_model <> \$4[\s\S]*transition\.state_commitment_model <> \$5/u,
    "V8 historical replay must bind the exact immutable scalar models",
  );
  assert.doesNotMatch(
    workerSource,
    /transition\.payload->'closingTokenState'\s*->>'model'\s*IS DISTINCT FROM \$4/u,
    "the canonical bare closingTokenState preimage must not be required to duplicate its top-level model",
  );
  assert.match(
    workerSource,
    /const currentSuccess = \{[\s\S]*workPrecision: runtime\.workPrecision[\s\S]*lastSuccess: currentSuccess/u,
    "a completed worker cycle must persist its full Q16 proof under lastSuccess",
  );
  assert.match(
    workerSource,
    /globalUnresolved: witness\.scan\.globalUnresolved[\s\S]*q16PendingUnresolved: witness\.scan\.q16PendingUnresolved[\s\S]*const pendingEventHealth = workerPendingEventHealth\([\s\S]*pendingEventHealth,[\s\S]*lastSuccess: currentSuccess/u,
    "a completed worker cycle must publish generic and Q16 unresolved counts without weakening Q16 readiness",
  );
  assert.match(
    workerSource,
    /canonicalPhase,[\s\S]*lastSuccess,[\s\S]*lastSuccessAt: lastSuccess\?\.finishedAt \?\? null[\s\S]*state: "canonical-phase-complete"/u,
    "the confirmed-only phase must preserve the prior completed-cycle proof",
  );
  assert.doesNotMatch(
    workerSource,
    /lastSuccess: canonicalSuccess/u,
    "a confirmed-only phase must never relabel itself as the completed Q16 proof",
  );
  assert.match(
    workerSource,
    /getblockchaininfo[\s\S]*getblockhash[\s\S]*Core tip changed across the Q16 relational replay audit/u,
    "Q16 replay must remain bracketed by stable first-party Core tip evidence",
  );
  assert.match(
    workerSource,
    /afterHeight > height[\s\S]*throwIfWorkerCoreTipAdvanced\([\s\S]*"exact-core-tip-read"/u,
    "a higher Core tip must be classified only after a fresh retained-tip check",
  );
  assert.match(
    workerSource,
    /const coreTipAdvance = workerCoreTipAdvanceFromError\(error\)[\s\S]*state: "canonical-tip-deferred"[\s\S]*continue;[\s\S]*consecutiveFailures \+= 1/u,
    "a typed monotonic tip advance must defer before generic failure accounting",
  );
  assert.equal(
    (workerSource.match(/assertWorkPrecisionReplayReady\(/gu) ?? []).length,
    3,
    "each cycle must retain the canonical barrier and one final confirmed replay audit",
  );
  assert.equal(
    (workerSource.match(/assertWorkPrecisionPendingReady\(/gu) ?? []).length,
    2,
    "each cycle must run one final pending replay audit",
  );
  assert.ok(
    (workerSource.match(/'payload', transition\.payload/gu) ?? []).length >= 2,
    "activation and latest transition payloads must remain fully loaded for commitment checks",
  );
  assert.match(
    workerSource,
    /validateWorkAmoV8BoundaryTransitionPayload\(activation\)[\s\S]*validateWorkAmoV8BoundaryTransitionPayload\(latest\)[\s\S]*activationBoundary\.valid === true[\s\S]*latestBoundary\.valid === true/u,
    "worker readiness must behaviorally validate both boundary payloads",
  );
  const beforeTip = { blockHash: "1".repeat(64), height: 100 };
  const afterTip = { blockHash: "2".repeat(64), height: 101 };
  const typedAdvance = {
    after: afterTip,
    before: beforeTip,
    phase: "confirmed-index-tip-lag",
    retainedPriorTip: true,
  };
  const typedAdvanceError = Object.assign(new Error("tip advanced"), {
    code: WORKER_CORE_TIP_ADVANCED_CODE,
    coreTipAdvance: typedAdvance,
  });
  assert.deepEqual(
    workerCoreTipAdvanceFromError(typedAdvanceError),
    typedAdvance,
    "an exact typed monotonic Core advance is neutral-classifiable",
  );
  assert.equal(
    workerCoreTipAdvanceFromError(
      Object.assign(new Error(typedAdvanceError.message), {
        code: "UNRELATED",
        coreTipAdvance: typedAdvance,
      }),
    ),
    null,
    "matching error prose without the exact type must remain a failure",
  );
  for (const after of [
    { ...afterTip, height: beforeTip.height },
    { ...afterTip, height: beforeTip.height - 1 },
  ]) {
    assert.equal(
      workerCoreTipAdvanceFromError(
        Object.assign(new Error("non-monotonic tip"), {
          code: WORKER_CORE_TIP_ADVANCED_CODE,
          coreTipAdvance: { ...typedAdvance, after },
        }),
      ),
      null,
      "same-height and lower-height tip changes must remain failures",
    );
  }
  const deferredWorkPrecision = workerWorkPrecisionForCoreTipAdvance(
    {
      era: "q16",
      pendingRebuild: { owner: "backfill", ready: true },
      replay: { era: "q16", ready: true },
    },
    typedAdvance,
  );
  assert.equal(deferredWorkPrecision.replay.ready, false);
  assert.equal(deferredWorkPrecision.replay.deferred, true);
  assert.equal(deferredWorkPrecision.pendingRebuild.ready, false);
  assert.match(
    workerSource,
    /sourceBlockHash[\s\S]*payloadBlockHash[\s\S]*summaryBlockHash[\s\S]*canonical-summary-refresh[\s\S]*consistencyStatus === "green"/u,
    "the Q16 snapshot must bind every checkpoint hash and green summary state",
  );
  assert.match(
    workerSource,
    /pendingRequired: true,[\s\S]*ready: false,[\s\S]*assertWorkPrecisionPendingReady/u,
    "confirmed replay must remain not-ready until the pending witness passes",
  );
  for (const deploymentSource of [
    readFileSync(API_PROOF_INDEX_CONFIG_PATH, "utf8"),
    readFileSync(WORKER_SERVICE_PATH, "utf8"),
  ]) {
    const expectedPins = {
      BLOCK_HASH:
        "00000000000000000001ec938998cde4fd86ee6e3c672a6d3d95200cd8a984ac",
      BLOCK_INDEX: "2369",
      HEIGHT: "960600",
      MEMO_BYTES: "5593",
      MEMO_SHA256:
        "1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528",
      PROTOCOL_VOUT: "3",
      RECORD_ORDINAL: "0",
      REGISTRY_PAYMENT_VOUT: "4",
      TXID: "f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a",
    };
    for (const [pin, expected] of Object.entries(expectedPins)) {
      assert.deepEqual(
        deploymentEnvironmentValues(
          deploymentSource,
          `WORK_AMO_V8_DECLARATION_${pin}`,
        ),
        [expected],
        `AMO V8 declaration ${pin} must match canonical confirmation evidence`,
      );
    }
    assert.deepEqual(
      deploymentEnvironmentValues(
        deploymentSource,
        "WORK_AMO_V8_ACTIVATION_HEIGHT",
      ),
      ["960601"],
      "AMO V8 D+1 activation must match the canonical boundary",
    );
    assert.deepEqual(
      deploymentEnvironmentValues(
        deploymentSource,
        "WORK_AMO_V8_WRITES_ENABLED",
      ),
      ["1"],
      "AMO V8 deployment write gate must be enabled",
    );
  }
  assert.deepEqual(
    deploymentEnvironmentValues(
      readFileSync(API_PROOF_INDEX_CONFIG_PATH, "utf8"),
      "WORK_AMO_V6_WRITES_ENABLED",
    ),
    ["0"],
    "the historical V6 API write gate must remain closed after V8 activation",
  );
  const v7DeclarationCommitment = workAmoV8DeclarationCommitment();
  const emptyV7Config = workerWorkAmoV8DeclarationConfig({});
  assert.equal(emptyV7Config.requested, false);
  assert.equal(emptyV7Config.configured, false);
  assert.equal(
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_WRITES_ENABLED: "0",
    }).requested,
    false,
    "the staged disabled write gate alone must not request V8",
  );
  assert.equal(
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_WRITES_ENABLED: "1",
    }).requested,
    true,
    "enabling writes must request the complete declaration",
  );
  assert.equal(
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_WRITES_ENABLED: "perhaps",
    }).requested,
    true,
    "a malformed nonempty write gate must fail closed as requested",
  );
  const partialV7Config = workerWorkAmoV8DeclarationConfig({
    WORK_AMO_V8_DECLARATION_HEIGHT: "100",
  });
  assert.equal(partialV7Config.requested, true);
  assert.equal(partialV7Config.configured, false);
  const configuredV7Environment = {
    WORK_AMO_V8_ACTIVATION_HEIGHT: "101",
    WORK_AMO_V8_DECLARATION_BLOCK_HASH: "c".repeat(64),
    WORK_AMO_V8_DECLARATION_BLOCK_INDEX: "8",
    WORK_AMO_V8_DECLARATION_HEIGHT: "100",
    WORK_AMO_V8_DECLARATION_MEMO_BYTES: String(
      v7DeclarationCommitment.protocolRecordBytes,
    ),
    WORK_AMO_V8_DECLARATION_MEMO_SHA256:
      v7DeclarationCommitment.protocolRecordSha256,
    WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT: "3",
    WORK_AMO_V8_DECLARATION_RECORD_ORDINAL: "0",
    WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT: "4",
    WORK_AMO_V8_DECLARATION_TXID: "d".repeat(64),
  };
  const configuredV7 = workerWorkAmoV8DeclarationConfig(
    configuredV7Environment,
  );
  assert.equal(configuredV7.requested, true);
  assert.equal(configuredV7.configured, true);
  assert.equal(configuredV7.activationHeight, 101);
  assert.equal(
    workerWorkAmoV8DeclarationConfig({
      ...configuredV7Environment,
      WORK_AMO_V8_ACTIVATION_HEIGHT: "102",
    }).configured,
    false,
    "AMO V8 activation must be declaration height plus exactly one",
  );
  for (const name of [
    "WORK_AMO_V8_ACTIVATION_HEIGHT",
    "WORK_AMO_V8_DECLARATION_TXID",
    "WORK_AMO_V8_DECLARATION_HEIGHT",
    "WORK_AMO_V8_DECLARATION_BLOCK_HASH",
    "WORK_AMO_V8_DECLARATION_BLOCK_INDEX",
    "WORK_AMO_V8_DECLARATION_MEMO_SHA256",
    "WORK_AMO_V8_DECLARATION_MEMO_BYTES",
    "WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT",
    "WORK_AMO_V8_DECLARATION_RECORD_ORDINAL",
    "WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT",
  ]) {
    const singlePin = workerWorkAmoV8DeclarationConfig({ [name]: "0" });
    assert.equal(singlePin.requested, true, `${name}=0 must be requested`);
    assert.equal(singlePin.configured, false, `${name}=0 must not configure V8`);
  }
  for (const invalidIndex of ["-1", "-0", "01"]) {
    const invalid = workerWorkAmoV8DeclarationConfig({
      ...configuredV7Environment,
      WORK_AMO_V8_DECLARATION_BLOCK_INDEX: invalidIndex,
    });
    assert.equal(invalid.requested, true);
    assert.equal(
      invalid.configured,
      false,
      `noncanonical declaration index ${invalidIndex} must fail`,
    );
  }
  for (const [name, invalidValue] of [
    ["WORK_AMO_V8_DECLARATION_HEIGHT", " 100"],
    ["WORK_AMO_V8_DECLARATION_BLOCK_INDEX", "8 "],
    ["WORK_AMO_V8_DECLARATION_TXID", "D".repeat(64)],
    ["WORK_AMO_V8_DECLARATION_BLOCK_HASH", ` ${"c".repeat(64)}`],
  ]) {
    const invalid = workerWorkAmoV8DeclarationConfig({
      ...configuredV7Environment,
      [name]: invalidValue,
    });
    assert.equal(invalid.requested, true);
    assert.equal(
      invalid.configured,
      false,
      `${name} must reject noncanonical whitespace or case`,
    );
  }
  for (const invalidGate of [" 0", "0 ", " true", "false "]) {
    const invalid = workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_WRITES_ENABLED: invalidGate,
    });
    assert.equal(
      invalid.requested,
      true,
      `write gate ${JSON.stringify(invalidGate)} must fail closed as requested`,
    );
    assert.equal(invalid.configured, false);
  }
  const activationLatch = {
    activationHeight: 101,
    authorityScriptPubKey:
      WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
    coreVerified: true,
    declarationBlockHash:
      configuredV7.declarationBlockHash,
    declarationBlockIndex:
      configuredV7.declarationBlockIndex,
    declarationHeight: 100,
    declarationMemoBytes:
      configuredV7.declarationMemoBytes,
    declarationMemoSha256:
      configuredV7.declarationMemoSha256,
    declarationProtocolVout:
      configuredV7.declarationProtocolVout,
    declarationRecordOrdinal:
      configuredV7.declarationRecordOrdinal,
    declarationRegistryPaymentVout:
      configuredV7.declarationRegistryPaymentVout,
    declarationTxid: configuredV7.declarationTxid,
    evidenceComplete: true,
    firstObservedTipHash: "f".repeat(64),
    firstObservedTipHeight: 101,
    indexVerified: true,
    inputCount: 1,
    model: "canonical-work-amo-v8-activation-latch-v1",
    network: "livenet",
    observedAt: "2026-07-31T12:00:00.000Z",
    outputCount: 5,
    protocol: "pwm1",
    reached: true,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    registryPaymentSats: "546",
  };
  assert.equal(
    workerWorkAmoV8ActivationLatchReady(
      activationLatch,
      configuredV7,
    ),
    true,
  );
  assert.equal(
    workerWorkAmoV8ActivationLatchReady(
      { ...activationLatch, declarationHeight: 99 },
      configuredV7,
    ),
    false,
  );
  assert.equal(
    workerWorkAmoV8ActivationLatchReady(
      {
        ...activationLatch,
        firstObservedTipHeight:
          configuredV7.activationHeight + 1,
      },
      configuredV7,
    ),
    false,
  );
  assert.equal(
    workerWorkAmoV8ActivationLatchReady(
      { ...activationLatch, unexpected: true },
      configuredV7,
    ),
    false,
  );
  const markerCommitment = {
    model: "canonical-work-amo-payload-sha256-v1",
    payloadBytes: 32,
    sha256: "7".repeat(64),
  };
  const emptyRowsSha256 = createHash("sha256")
    .update(Buffer.from("[]", "utf8"))
    .digest("hex");
  const emptyRowsCommitment = {
    count: 0,
    payloadBytes: 2,
    sha256: emptyRowsSha256,
  };
  const markerEvidenceCommitted = {
    authorityScriptPubKey:
      WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
    blockHash: configuredV7.declarationBlockHash,
    blockHeight: configuredV7.declarationHeight,
    blockTransactionIndex:
      configuredV7.declarationBlockIndex,
    inputCount: 1,
    outputCount: 5,
    payloadBytes: configuredV7.declarationMemoBytes,
    payloadSha256: configuredV7.declarationMemoSha256,
    protocol: "pwm1",
    protocolVout: configuredV7.declarationProtocolVout,
    recordOrdinal: configuredV7.declarationRecordOrdinal,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    registryPaymentSats: "546",
    registryPaymentVout:
      configuredV7.declarationRegistryPaymentVout,
    txid: configuredV7.declarationTxid,
  };
  const markerEvidence = {
    ...markerEvidenceCommitted,
    commitmentSha256: createHash("sha256")
      .update(
        Buffer.from(
          `ProofOfWork.Me/WORK-PRECISION-V2-DECLARATION-EVIDENCE/v1\n${
            JSON.stringify(markerEvidenceCommitted)
          }`,
          "utf8",
        ),
      )
      .digest("hex"),
    coreVerified: true,
    evidenceComplete: true,
    indexVerified: true,
    model:
      "canonical-work-precision-v2-declaration-core-index-evidence-v1",
  };
  const markerTimestamp = "2026-07-31T12:01:00.000Z";
  const precisionMarker = {
    activationHeight: configuredV7.activationHeight,
    activationOpening: {
      declarationClosingStatePayloadBytes: 32,
      declarationClosingStateSha256: "6".repeat(64),
      declarationTransitionModel:
        "canonical-work-amo-full-position-block-sequencer-v2",
      legacyTokenStateCommitment: markerCommitment,
      subatomTokenStateCommitment: markerCommitment,
    },
    after: {
      balances: emptyRowsCommitment,
      listings: emptyRowsCommitment,
    },
    before: {
      balances: emptyRowsCommitment,
      listings: emptyRowsCommitment,
    },
    completedAt: markerTimestamp,
    conversionFactor: "100000000",
    declarationBlockHash: configuredV7.declarationBlockHash,
    declarationBlockIndex: configuredV7.declarationBlockIndex,
    declarationEvidence: markerEvidence,
    declarationHeight: configuredV7.declarationHeight,
    declarationMemoBytes: configuredV7.declarationMemoBytes,
    declarationMemoSha256: configuredV7.declarationMemoSha256,
    declarationProtocolVout:
      configuredV7.declarationProtocolVout,
    declarationRecordOrdinal:
      configuredV7.declarationRecordOrdinal,
    declarationRegistryPaymentVout:
      configuredV7.declarationRegistryPaymentVout,
    declarationTextBytes: v7DeclarationCommitment.payloadBytes,
    declarationTextSha256: v7DeclarationCommitment.payloadSha256,
    declarationTxid: configuredV7.declarationTxid,
    decimals: 16,
    globalPrecisionModel: "canonical-work-subatoms-v2",
    derivedProjectionPolicy:
      "invalidate-and-replay-from-activation",
    legacyDecimals: 8,
    legacyProjectionModel: "work-atoms-v1",
    maxSupplySubatoms: "210000000000000000000000",
    migrationModel: "canonical-work-q8-to-q16-migration-v1",
    mintAmountSubatoms: "10000000000000000000",
    model: "canonical-work-q8-to-q16-migration-v1",
    network: "livenet",
    projectionModel: "work-subatoms-v2",
    rawConfirmedHistoryMutation: "none",
    relicCutover: {
      count: 0,
      items: [],
      model: "canonical-work-amo-v8-preactivation-relic-cutover-v1",
      payloadBytes: 2,
      sha256: emptyRowsSha256,
    },
    replayFromHeight: configuredV7.activationHeight,
    snapshotPolicy:
      "preserve-preactivation-canonical-invalidate-wrong-era-derived-require-post-migration-current-snapshot",
    status: "complete",
    transferVersion: "send3",
    unitScale: "10000000000000000",
    updatedAt: markerTimestamp,
    version: "pwt-sale-v8",
  };
  assert.equal(
    workerWorkPrecisionV2MarkerReady(
      precisionMarker,
      configuredV7,
    ),
    true,
  );
  assert.equal(
    workerWorkPrecisionV2MarkerReady(
      {
        ...precisionMarker,
        mintAmountSubatoms: "1000000000000000000",
      },
      configuredV7,
    ),
    false,
  );
  assert.equal(
    workerWorkPrecisionV2MarkerReady(
      {
        ...precisionMarker,
        declarationEvidence: {
          ...markerEvidence,
          inputCount: 2,
        },
      },
      configuredV7,
    ),
    false,
    "declaration evidence must be recomputed, not shape-checked",
  );
  const q8Definition = {
    max_supply: "2100000000000000",
    metadata: {
      amountStorageModel: "work-atoms-v1",
      decimals: 8,
      unitScale: "100000000",
    },
    mint_amount: "100000000000",
  };
  assert.equal(
    workerWorkPrecisionEra({
      declarationConfig: configuredV7,
      definition: q8Definition,
      marker: {},
      observedHeight: 100,
      tipHeight: 100,
    }),
    "q8",
  );
  assert.equal(
    workerWorkPrecisionEra({
      declarationConfig: configuredV7,
      definition: q8Definition,
      marker: {},
      observedHeight: 101,
      tipHeight: 101,
    }),
    "q16",
    "the first activation block must irreversibly select Q16",
  );
  assert.equal(
    workerWorkPrecisionEra({
      declarationConfig: emptyV7Config,
      definition: q8Definition,
      marker: {},
      observedHeight: 1,
      q16Latched: true,
      tipHeight: 1,
    }),
    "q16",
    "a persisted Q16 worker era must never fall back to Q8",
  );
  assert.equal(
    workerWorkPrecisionFromMeta(
      {
        network: "livenet",
        workPrecision: { era: "q16", ready: false },
      },
      "livenet",
    )?.era,
    "q16",
  );
  assert.equal(
    workerWorkPrecisionFromMeta(
      {
        network: "testnet",
        workPrecision: { era: "q16", ready: false },
      },
      "livenet",
    ),
    null,
  );
  const listingId = "e".repeat(64);
  const saleAuthorization = {
    sellerAddress: "seller",
    version: "pwt-sale-v6",
  };
  const frozenTerms = {
    unitAmountAtoms: "1",
    version: "pwt-sale-v6",
  };
  const relationalFixture = {
    balanceRows: [{ address: "holder", confirmed_balance: "2" }],
    closingTokenState: {
      holders: [{ address: "holder", balanceSubatoms: "2" }],
      listings: [{
        amountSubatoms: "1",
        frozenTerms,
        listingId,
        priceSats: "20",
        saleAuthorization,
        sellerAddress: "seller",
      }],
    },
    listingRows: [{
      amount: "1",
      frozen_terms: frozenTerms,
      listing_id: listingId,
      price_sats: "20",
      sale_authorization: saleAuthorization,
      seller_address: "seller",
      status: "active",
      v7_authorization_version: null,
    }],
  };
  assert.equal(
    workerWorkPrecisionRelationalParity(relationalFixture),
    true,
  );
  assert.equal(
    workerWorkPrecisionRelationalParity({
      ...relationalFixture,
      listingRows: [{
        ...relationalFixture.listingRows[0],
        amount: "2",
      }],
    }),
    false,
  );
  assert.equal(
    workerWorkPrecisionRelationalParity({
      ...relationalFixture,
      balanceRows: [
        ...relationalFixture.balanceRows,
        { address: "broken", confirmed_balance: "-1" },
      ],
    }),
    false,
    "negative relational rows must fail instead of being filtered",
  );
  assert.equal(
    workerWorkPrecisionRelationalParity({
      ...relationalFixture,
      balanceRows: [
        ...relationalFixture.balanceRows,
        { address: "holder", confirmed_balance: "0" },
      ],
    }),
    false,
    "duplicate relational keys must fail",
  );
  assert.equal(
    workerWorkPrecisionRelationalParity({
      ...relationalFixture,
      balanceRows: [
        ...relationalFixture.balanceRows,
        { address: "zero", confirmed_balance: "0" },
      ],
    }),
    true,
    "a unique canonical zero row is semantically absent",
  );
  assert.equal(
    workerWorkPrecisionRelationalParity({
      ...relationalFixture,
      listingRows: [{
        ...relationalFixture.listingRows[0],
        seller_address: "wrong-seller",
      }],
    }),
    false,
  );

  const replayTipHash = "9".repeat(64);
  const replayDeclarationHash = "8".repeat(64);
  const replayActivationHash = "7".repeat(64);
  const replayActivationTransition = workPrecisionBoundaryFixture({
    blockHash: replayActivationHash,
    blockHeight: 101,
    previousBlockHash: replayDeclarationHash,
  });
  replayActivationTransition.payload = {
    ...replayActivationTransition.payload,
    activationHeight: 101,
    precisionMigrationMarkerKey:
      "workPrecisionV2Migration:livenet",
    precisionOpeningTokenStateCommitment:
      replayActivationTransition.payload.openingSufficientState
        .tokenStateCommitment,
  };
  const replayCommitment =
    replayActivationTransition.payload
      .precisionOpeningTokenStateCommitment;
  const replayLatestTransition = workPrecisionBoundaryFixture({
    blockHash: replayTipHash,
    blockHeight: 102,
    previousBlockHash: replayActivationHash,
  });
  const replayWorkSufficientState = {
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    closingStateCommitment:
      replayLatestTransition.payload.closingStateCommitment,
    decimals: WORK_SUBATOM_DECIMALS,
    indexedThroughBlock: 102,
    indexedThroughBlockHash: replayTipHash,
    model: "canonical-work-q16-transition-checkpoint-v1",
    precisionModel: WORK_PRECISION_V2_MODEL,
    tokenStateCommitment:
      replayLatestTransition.payload.closingSufficientState
        .tokenStateCommitment,
    transitionModel: WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
    unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
    workTokenStateModel: WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  };
  const replaySnapshot = {
    consistencyOk: true,
    consistencyStatus: "green",
    indexedThroughBlock: 102,
    payloadBytes: 1_024,
    payloadBlockHash: replayTipHash,
    payloadRootKeys: [
      "indexedThroughBlockHash",
      "summaryRefresh",
      "workAmountStorageModel",
      "workSufficientState",
    ],
    sourceBlockHash: replayTipHash,
    summaryBlockHash: replayTipHash,
    summaryMode: "canonical-summary-refresh",
    workAmountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    workSufficientState: replayWorkSufficientState,
  };
  const replayCoreTip = {
    blockHash: replayTipHash,
    height: 102,
    stable: true,
  };
  const replayEnvelope = {
    activationHeight: 101,
    activationTransition: replayActivationTransition,
    coreTip: replayCoreTip,
    declarationBlockHash: replayDeclarationHash,
    invalidPrecisionEventCount: 0,
    invalidTransitionCount: 0,
    latestTransition: replayLatestTransition,
    markerOpeningCommitment: replayCommitment,
    snapshot: replaySnapshot,
    tipHash: replayTipHash,
    tipHeight: 102,
    transitionCount: 2,
  };
  assert.equal(
    workerWorkPrecisionCoreTipReady(replayCoreTip, {
      tipHash: replayTipHash,
      tipHeight: 102,
    }),
    true,
  );
  assert.equal(
    workerWorkPrecisionSnapshotReady(replaySnapshot, {
      latestTransition: replayLatestTransition,
      tipHash: replayTipHash,
      tipHeight: 102,
    }),
    true,
  );
  const snapshotReady = (snapshot, latestTransition = replayLatestTransition) =>
    workerWorkPrecisionSnapshotReady(snapshot, {
      latestTransition,
      tipHash: replayTipHash,
      tipHeight: 102,
    });
  const {
    workSufficientState: _missingWorkSufficientState,
    ...snapshotWithoutWorkSufficientState
  } = replaySnapshot;
  for (const [label, snapshot] of [
    ["missing compact state", snapshotWithoutWorkSufficientState],
    [
      "oversized canonical snapshot",
      {
        ...replaySnapshot,
        payloadBytes: 18 * 1024 * 1024 + 1,
      },
    ],
    [
      "unexpected canonical snapshot root",
      {
        ...replaySnapshot,
        payloadRootKeys: [
          ...replaySnapshot.payloadRootKeys,
          "unexpectedRoot",
        ],
      },
    ],
    [
      "stale compact state height",
      {
        ...replaySnapshot,
        workSufficientState: {
          ...replayWorkSufficientState,
          indexedThroughBlock: 101,
        },
      },
    ],
    [
      "mismatched compact state hash",
      {
        ...replaySnapshot,
        workSufficientState: {
          ...replayWorkSufficientState,
          indexedThroughBlockHash: "6".repeat(64),
        },
      },
    ],
    [
      "mismatched token-state commitment",
      {
        ...replaySnapshot,
        workSufficientState: {
          ...replayWorkSufficientState,
          tokenStateCommitment: {
            ...replayWorkSufficientState.tokenStateCommitment,
            sha256: "5".repeat(64),
          },
        },
      },
    ],
    [
      "mismatched closing-state commitment",
      {
        ...replaySnapshot,
        workSufficientState: {
          ...replayWorkSufficientState,
          closingStateCommitment: {
            ...replayWorkSufficientState.closingStateCommitment,
            sha256: "4".repeat(64),
          },
        },
      },
    ],
  ]) {
    assert.equal(snapshotReady(snapshot), false, `${label} must fail closed`);
  }
  assert.equal(
    snapshotReady(replaySnapshot, null),
    false,
    "compact state without its exact transition must fail closed",
  );
  assert.equal(
    workerWorkPrecisionConfirmedReplayEnvelopeReady(replayEnvelope),
    true,
  );
  assert.equal(
    workerWorkPrecisionConfirmedReplayEnvelopeReady({
      ...replayEnvelope,
      requireSnapshot: false,
      snapshot: {
        ...replaySnapshot,
        summaryBlockHash: "6".repeat(64),
      },
    }),
    true,
    "the canonical phase may verify transition replay before the summary snapshot exists",
  );
  for (const mutation of [
    { coreTip: { ...replayCoreTip, blockHash: "6".repeat(64) } },
    {
      latestTransition: {
        ...replayEnvelope.latestTransition,
        blockHash: "6".repeat(64),
      },
    },
    {
      activationTransition: {
        ...replayEnvelope.activationTransition,
        previousBlockHash: "6".repeat(64),
      },
    },
    {
      activationTransition: {
        ...replayEnvelope.activationTransition,
        payload: {
          ...replayEnvelope.activationTransition.payload,
          previousBlockHash: "6".repeat(64),
        },
      },
    },
    {
      latestTransition: {
        ...replayEnvelope.latestTransition,
        payload: {
          ...replayEnvelope.latestTransition.payload,
          model: "tampered-boundary-model",
        },
      },
    },
    {
      snapshot: {
        ...replaySnapshot,
        consistencyStatus: "red",
      },
    },
    {
      snapshot: {
        ...replaySnapshot,
        summaryBlockHash: "6".repeat(64),
      },
    },
    { transitionCount: 1 },
  ]) {
    assert.equal(
      workerWorkPrecisionConfirmedReplayEnvelopeReady({
        ...replayEnvelope,
        ...mutation,
      }),
      false,
      `confirmed replay mutation must fail: ${Object.keys(mutation)[0]}`,
    );
  }
  const parentMembershipTxids = ["6".repeat(64), "7".repeat(64)];
  const parentMembershipSha256 = createHash("sha256")
    .update(
      Buffer.from(
        "ProofOfWork.Me/WORK-Q16-PENDING-MEMBERSHIP/v1\n" +
          JSON.stringify(parentMembershipTxids),
        "utf8",
      ),
    )
    .digest("hex");
  const parentWitness = {
    membershipSnapshot: {
      count: parentMembershipTxids.length,
      model: "canonical-work-q16-pending-membership-v2",
      sha256: parentMembershipSha256,
      txids: parentMembershipTxids,
    },
    model: "canonical-work-q16-pending-rebuild-v2",
    network: "livenet",
    ready: true,
  };
  assert.deepEqual(
    workerWorkQ16PendingParentMembershipTxids(parentWitness),
    parentMembershipTxids,
    "legacy status ownership must derive only from the exact committed Q16 parent membership",
  );
  assert.equal(
    workerWorkQ16PendingParentMembershipTxids({
      ...parentWitness,
      membershipSnapshot: {
        ...parentWitness.membershipSnapshot,
        count: parentMembershipTxids.length - 1,
      },
    }),
    null,
    "a malformed Q16 parent witness must fail closed before legacy status mutation",
  );
  const pendingMemberTxid = "7".repeat(64);
  const pendingUnrelatedTxids = Array.from(
    { length: 1_000 },
    (_, index) => index.toString(16).padStart(64, "0"),
  );
  const pendingMempoolTxids = [
    pendingMemberTxid,
    ...pendingUnrelatedTxids,
  ].sort();
  const pendingEventRows = [{
    event_id: "pending-work-event",
    kind: "token-listing",
    protocol_vout: 1,
    raw_payload: "pwt1:list5:fixture",
    record_ordinal: 0,
    txid: pendingMemberTxid,
    valid: true,
  }];
  const pendingTransactionRows = [{
    raw_tx: {
      pendingProtocolResolvedInvalid: false,
      pendingWorkMintAttemptCount: 0,
      pendingWorkMintInspectionVersion: 1,
      pendingWorkMintRecoveryNeeded: false,
      pendingWorkMintResolvedInvalid: false,
    },
    status: "pending",
    txid: pendingMemberTxid,
  }];
  const pendingEventParticipantRows = [{
    address: "bc1pendingowner",
    event_id: "pending-work-event",
    powid: "work-owner",
    protocol: "pwt1",
    protocol_vout: 1,
    record_ordinal: 0,
    role: "owner",
    txid: pendingMemberTxid,
  }];
  const pendingEventRefRows = [{
    event_id: "pending-work-event",
    protocol: "pwt1",
    protocol_vout: 1,
    record_ordinal: 0,
    ref_type: "token-id",
    ref_value: "d".repeat(64),
    txid: pendingMemberTxid,
  }];
  const pendingMailRows = [{
    amount_sats: "546",
    body_text: null,
    data_bytes: 12,
    event_time: null,
    message: { kind: "mail", protocol: "pwm1", txid: pendingMemberTxid },
    parent_txid: null,
    sender_address: null,
    status: "pending",
    subject: null,
    txid: pendingMemberTxid,
  }];
  const pendingProjection = workerWorkPrecisionPendingProjection({
    balanceRows: [],
    eventParticipantRows: pendingEventParticipantRows,
    eventRefRows: pendingEventRefRows,
    eventRows: pendingEventRows,
    listingRows: [],
    mailRows: pendingMailRows,
    transactionRows: pendingTransactionRows,
  });
  const volatileRefreshedProjection =
    workerWorkPrecisionPendingProjection({
      balanceRows: [],
      eventParticipantRows: pendingEventParticipantRows,
      eventRefRows: pendingEventRefRows,
      eventRows: pendingEventRows,
      listingRows: [],
      mailRows: pendingMailRows,
      transactionRows: [{
        ...pendingTransactionRows[0],
        raw_tx: {
          ...pendingTransactionRows[0].raw_tx,
          fee: 1234,
          statusObservation: {
            observedAt: "2026-08-02T01:39:23.495Z",
            status: "pending",
          },
          vin: [{ txid: "a".repeat(64), vout: 0 }],
          vout: [{ value: 0.00000546 }],
        },
      }],
    });
  assert.deepEqual(
    volatileRefreshedProjection,
    pendingProjection,
    "volatile transaction-envelope refreshes must not stale the exact WORK readiness projection",
  );
  const nullableMailDriftProjection =
    workerWorkPrecisionPendingProjection({
      balanceRows: [],
      eventParticipantRows: pendingEventParticipantRows,
      eventRefRows: pendingEventRefRows,
      eventRows: pendingEventRows,
      listingRows: [],
      mailRows: [{
        ...pendingMailRows[0],
        body_text: "stale body",
        event_time: "2026-08-02T01:39:23.495Z",
        sender_address: "stale-sender",
        subject: "stale subject",
      }],
      transactionRows: pendingTransactionRows,
    });
  assert.notEqual(
    nullableMailDriftProjection.mailItems.sha256,
    pendingProjection.mailItems.sha256,
    "every nullable PWM Mail field must be an exact readiness hash input",
  );
  const missingMailProjection = workerWorkPrecisionPendingProjection({
    balanceRows: [],
    eventParticipantRows: pendingEventParticipantRows,
    eventRefRows: pendingEventRefRows,
    eventRows: pendingEventRows,
    listingRows: [],
    mailRows: [],
    transactionRows: pendingTransactionRows,
  });
  assert.notEqual(
    missingMailProjection.mailItems.sha256,
    pendingProjection.mailItems.sha256,
    "missing or ghost PWM Mail membership must change the readiness hash",
  );
  const staleOverlayProjection =
    workerWorkPrecisionPendingProjection({
      balanceRows: [],
      eventParticipantRows: pendingEventParticipantRows,
      eventRefRows: pendingEventRefRows,
      eventRows: pendingEventRows,
      listingRows: [],
      transactionRows: [{
        ...pendingTransactionRows[0],
        raw_tx: {
          ...pendingTransactionRows[0].raw_tx,
          indexedFrom: "mempool",
          item: { refreshed: true },
        },
      }],
    });
  assert.notEqual(
    staleOverlayProjection.transactions.sha256,
    pendingProjection.transactions.sha256,
    "a stale indexedFrom/item Mail overlay must invalidate Q16 readiness",
  );
  const markerChangedProjection =
    workerWorkPrecisionPendingProjection({
      balanceRows: [],
      eventParticipantRows: pendingEventParticipantRows,
      eventRefRows: pendingEventRefRows,
      eventRows: pendingEventRows,
      listingRows: [],
      transactionRows: [{
        ...pendingTransactionRows[0],
        raw_tx: {
          ...pendingTransactionRows[0].raw_tx,
          pendingWorkMintAttemptCount: 1,
        },
      }],
    });
  assert.equal(
    pendingProjection.model,
    "canonical-work-q16-pending-projection-v5",
  );
  assert.notEqual(
    markerChangedProjection.transactions.sha256,
    pendingProjection.transactions.sha256,
    "every WORK inspection-marker mutation must invalidate the transaction readiness commitment",
  );
  for (const transactionMutation of [
    { status: "dropped" },
    { txid: "8".repeat(64) },
  ]) {
    const changedProjection = workerWorkPrecisionPendingProjection({
      balanceRows: [],
      eventParticipantRows: pendingEventParticipantRows,
      eventRefRows: pendingEventRefRows,
      eventRows: pendingEventRows,
      listingRows: [],
      transactionRows: [{
        ...pendingTransactionRows[0],
        ...transactionMutation,
      }],
    });
    assert.notEqual(
      changedProjection.transactions.sha256,
      pendingProjection.transactions.sha256,
      "transaction identity and relational status remain exact readiness inputs",
    );
  }
  const participantChangedProjection =
    workerWorkPrecisionPendingProjection({
      balanceRows: [],
      eventParticipantRows: [{
        ...pendingEventParticipantRows[0],
        address: "bc1differentowner",
      }],
      eventRefRows: pendingEventRefRows,
      eventRows: pendingEventRows,
      listingRows: [],
      transactionRows: pendingTransactionRows,
    });
  assert.notEqual(
    participantChangedProjection.eventParticipants.sha256,
    pendingProjection.eventParticipants.sha256,
    "every rendered pending WORK participant must invalidate readiness when it changes",
  );
  const refChangedProjection = workerWorkPrecisionPendingProjection({
    balanceRows: [],
    eventParticipantRows: pendingEventParticipantRows,
    eventRefRows: [{
      ...pendingEventRefRows[0],
      ref_value: "different-work-reference",
    }],
    eventRows: pendingEventRows,
    listingRows: [],
    transactionRows: pendingTransactionRows,
  });
  assert.notEqual(
    refChangedProjection.eventRefs.sha256,
    pendingProjection.eventRefs.sha256,
    "every rendered pending WORK ID/token reference must invalidate readiness when it changes",
  );
  const pendingParity = workerWorkPrecisionPendingParity({
    balanceRows: [],
    eventRows: pendingEventRows,
    listingRows: [],
    mempoolTxids: pendingMempoolTxids,
    recoveryRows: [],
    transactionRows: pendingTransactionRows,
  });
  assert.equal(pendingParity.ready, true);
  assert.equal(
    workerWorkPrecisionPendingParity({
      balanceRows: [],
      eventRows: pendingEventRows,
      listingRows: [],
      mempoolTxids: pendingMempoolTxids,
      recoveryRows: [],
      transactionRows: [{
        raw_tx: {},
        status: "pending",
        txid: pendingMemberTxid,
      }],
    }).ready,
    false,
    "every persisted pending WORK transaction must carry the exact inspection marker",
  );
  assert.equal(
    workerWorkPrecisionPendingParity({
      balanceRows: [],
      eventRows: pendingEventRows,
      listingRows: [],
      mempoolTxids: pendingMempoolTxids,
      recoveryRows: [],
      transactionRows: [{
        ...pendingTransactionRows[0],
        raw_tx: {
          ...pendingTransactionRows[0].raw_tx,
          pendingProtocolResolvedInvalid: true,
        },
      }],
    }).ready,
    false,
    "a terminal-invalid protocol marker cannot coexist with a valid persisted WORK projection",
  );
  const pendingMempoolSnapshot = (txids) => ({
    count: txids.length,
    model: "canonical-core-mempool-txid-set-v1",
    sha256: createHash("sha256")
      .update(
        Buffer.from(
          `ProofOfWork.Me/WORK-Q16-PENDING-MEMPOOL/v1\n${JSON.stringify(txids)}`,
          "utf8",
        ),
      )
      .digest("hex"),
    txids,
  });
  const pendingMempool = pendingMempoolSnapshot(pendingMempoolTxids);
  const pendingMembership = {
    count: 1,
    model: "canonical-work-q16-pending-membership-v2",
    sha256: createHash("sha256")
      .update(
        Buffer.from(
          `ProofOfWork.Me/WORK-Q16-PENDING-MEMBERSHIP/v1\n${JSON.stringify([pendingMemberTxid])}`,
          "utf8",
        ),
      )
      .digest("hex"),
    txids: [pendingMemberTxid],
  };
  const {
    txids: _pendingMempoolTxids,
    ...compactPendingMempool
  } = pendingMempool;
  const pendingNowMs = Date.now();
  const pendingAbsenceEvidence = {
    model: "canonical-work-q16-pending-absence-evidence-v1",
    observations: [],
  };
  const pendingComponentSha256 = (label, value) =>
    workAmoV5CanonicalPayloadCommitment({ label, value }).sha256;
  const pendingReadinessCheckpointCore = {
    maxPreparedTransactions: "0",
    model: "proof-index-worker-readiness-epoch-checkpoint-v1",
    network: "livenet",
    postmasterStartedAt: new Date(pendingNowMs - 60_000).toISOString(),
    queueCount: 0,
    readinessEpochs: Array.from(
      { length: 64 },
      (_value, shard) => [shard, String(shard + 1)],
    ),
    searchPath: "pg_catalog, pg_temp",
  };
  const pendingReadinessCheckpoint = {
    ...pendingReadinessCheckpointCore,
    sha256: createHash("sha256")
      .update(
        Buffer.from(
          `ProofOfWork.Me/PROOF-INDEX-WORKER-READINESS-EPOCH-CHECKPOINT/v1\n${
            JSON.stringify(pendingReadinessCheckpointCore)
          }`,
          "utf8",
        ),
      )
      .digest("hex"),
  };
  const pendingReadinessCheckpointWithEpochDelta = (shard, delta) => {
    const core = {
      ...pendingReadinessCheckpointCore,
      readinessEpochs: pendingReadinessCheckpointCore.readinessEpochs.map(
        ([index, epoch]) => [
          index,
          index === shard ? (BigInt(epoch) + BigInt(delta)).toString() : epoch,
        ],
      ),
    };
    return {
      ...core,
      sha256: createHash("sha256")
        .update(
          Buffer.from(
            `ProofOfWork.Me/PROOF-INDEX-WORKER-READINESS-EPOCH-CHECKPOINT/v1\n${
              JSON.stringify(core)
            }`,
            "utf8",
          ),
        )
        .digest("hex"),
    };
  };
  const pendingDecisionOutcomes = [{
    kind: "token-listing",
    protocolVout: 1,
    rawPayloadSha256: createHash("sha256")
      .update(Buffer.from("pwt1:list5:fixture", "utf8"))
      .digest("hex"),
    recordOrdinal: 0,
    txid: pendingMemberTxid,
    valid: true,
  }];
  const pendingConfirmedBaseCommitment = {
    ...workAmoV5CanonicalPayloadCommitment({
      fixture: "confirmed-work-base",
    }),
    tokenStateCommitment:
      replayLatestTransition.payload.closingSufficientState
        .tokenStateCommitment,
  };
  const pendingStageCore = {
    absenceEvidence: pendingAbsenceEvidence,
    absenceEvidenceSha256: pendingComponentSha256(
      "ABSENCE-EVIDENCE",
      pendingAbsenceEvidence,
    ),
    canonicalTip: {
      hash: replayTipHash,
      height: 102,
    },
    codeVersion:
      "proof-api-canonical-work-q16-pending-verifier-stage-v5",
    confirmedBaseCommitment: pendingConfirmedBaseCommitment,
    confirmedRemovalCount: 0,
    confirmedRemovalSha256: pendingComponentSha256(
      "CONFIRMED-REMOVALS",
      [],
    ),
    confirmedRemovalTxids: [],
    decisionCount: 1,
    decisionOutcomeCount: pendingDecisionOutcomes.length,
    decisionOutcomesSha256: pendingComponentSha256(
      "DECISION-OUTCOMES",
      pendingDecisionOutcomes,
    ),
    decisionsSha256: pendingComponentSha256(
      "DECISIONS",
      [{ items: [{ valid: true }], txid: pendingMemberTxid }],
    ),
    model: "canonical-work-q16-pending-verifier-stage-v2",
    network: "livenet",
    orderedReplayCount: 1,
    orderedReplaySha256: pendingComponentSha256(
      "ORDERED-REPLAY",
      [pendingMemberTxid],
    ),
    parentWitnessSha256: "e".repeat(64),
    pendingDropConfirmationMs: 300_000,
    priorMembershipCount: 1,
    priorMembershipSha256: pendingComponentSha256(
      "PRIOR-MEMBERSHIP",
      [pendingMemberTxid],
    ),
    priorMembershipTxids: [pendingMemberTxid],
    readinessEpochCheckpoint: pendingReadinessCheckpoint,
    removalCount: 0,
    removalSha256: pendingComponentSha256("REMOVALS", []),
    removalTxids: [],
    replayTxids: [pendingMemberTxid],
    requestModel:
      "canonical-work-q16-pending-verifier-stage-request-v2",
  };
  const pendingStageCommitment =
    workAmoV5CanonicalPayloadCommitment(pendingStageCore);
  const pendingVerifierStage = {
    ...pendingStageCore,
    stagePayloadBytes: pendingStageCommitment.payloadBytes,
    stageSha256: pendingStageCommitment.sha256,
  };
  const pendingWitness = {
    activationHeight: configuredV7.activationHeight,
    amountStorageModel: "work-subatoms-v2",
    canonicalTip: {
      hash: replayTipHash,
      height: 102,
    },
    declarationTxid: configuredV7.declarationTxid,
    generatedAt: new Date(pendingNowMs).toISOString(),
    invalidLegacyMutationCount: 0,
    membershipSnapshot: pendingMembership,
    mempoolSnapshot: compactPendingMempool,
    model: "canonical-work-q16-pending-rebuild-v2",
    network: "livenet",
    parity: pendingParity,
    precisionModel: "canonical-work-subatoms-v2",
    projection: pendingProjection,
    ready: true,
    scan: {
      canonicalDeferred: 0,
      complete: true,
      completeModel: "atomic-staged-pending-work-projection-audit-v1",
      discoveryModel: "bounded-best-effort-unconfirmed-discovery-v1",
      globalUnresolved: 0,
      inspectedTxids: 1,
      mempoolMembershipCount: pendingMempoolTxids.length,
      protocolTxids: 0,
      q16PendingUnresolved: 0,
      scanned: 0,
      stopReason: "",
    },
    verifierStage: pendingVerifierStage,
  };
  const pendingAttemptStartedAt = new Date(
    pendingNowMs - 1_000,
  ).toISOString();
  const pendingAttemptIdentity = {
    initialMempool: compactPendingMempool,
    model: "canonical-work-q16-pending-publication-attempt-v1",
    network: "livenet",
    requestSha256: "d".repeat(64),
    startedAt: pendingAttemptStartedAt,
  };
  const pendingAttempt = {
    attemptId:
      workAmoV5CanonicalPayloadCommitment(pendingAttemptIdentity).sha256,
    completedAt: pendingWitness.generatedAt,
    ...pendingAttemptIdentity,
    publicationReadinessEpochCheckpoint: pendingReadinessCheckpoint,
    stageSha256: pendingVerifierStage.stageSha256,
    status: "published",
    witnessGeneratedAt: pendingWitness.generatedAt,
  };
  const pendingWitnessOptions = {
    confirmedRemovalRows: [],
    coreTip: replayCoreTip,
    declarationConfig: configuredV7,
    expectedTokenStateCommitment:
      replayLatestTransition.payload.closingSufficientState
        .tokenStateCommitment,
    eventRows: pendingEventRows,
    invalidLegacyMutationCount: 0,
    mempoolSnapshot: pendingMempool,
    nowMs: pendingNowMs,
    pendingAttempt,
    parity: pendingParity,
    projection: pendingProjection,
    readinessEpochCheckpoint: pendingReadinessCheckpoint,
  };
  assert.equal(
    workerWorkPrecisionPendingWitnessReady(
      pendingWitness,
      pendingWitnessOptions,
    ),
    true,
  );
  assert.equal(
    workerWorkPrecisionPendingWitnessReady(
      pendingWitness,
      {
        ...pendingWitnessOptions,
        readinessEpochCheckpoint: pendingReadinessCheckpointWithEpochDelta(
          7,
          1,
        ),
      },
    ),
    true,
    "confirmed-phase epoch advancement must not force a Q16 pending witness refresh when projection parity is still exact",
  );
  assert.equal(
    workerWorkPrecisionPendingWitnessReady(
      pendingWitness,
      {
        ...pendingWitnessOptions,
        pendingAttempt: {
          ...pendingAttempt,
          publicationReadinessEpochCheckpoint:
            pendingReadinessCheckpointWithEpochDelta(7, 1),
        },
      },
    ),
    false,
    "a pending witness publication epoch cannot be ahead of the current worker checkpoint",
  );
  const churnedMempoolTxids = [
    ...pendingMempoolTxids,
    "f".repeat(64),
  ].sort();
  const churnedParity = workerWorkPrecisionPendingParity({
    balanceRows: [],
    eventRows: pendingEventRows,
    listingRows: [],
    mempoolTxids: churnedMempoolTxids,
    recoveryRows: [],
    transactionRows: pendingTransactionRows,
  });
  assert.equal(
    workerWorkPrecisionPendingWitnessReady(
      pendingWitness,
      {
        ...pendingWitnessOptions,
        mempoolSnapshot: pendingMempoolSnapshot(churnedMempoolTxids),
        parity: churnedParity,
      },
    ),
    true,
    "unrelated mempool churn must not invalidate exact persisted WORK membership",
  );
  for (const [witnessMutation, optionMutation] of [
    [{ ready: false }, {}],
    [{ model: "canonical-work-q16-pending-rebuild-v1" }, {}],
    [{ invalidLegacyMutationCount: 1 }, {}],
    [{
      canonicalTip: {
        hash: "6".repeat(64),
        height: 102,
      },
    }, {}],
    [{
      projection: {
        ...pendingProjection,
        commitmentSha256: "6".repeat(64),
      },
    }, {}],
    [{
      parity: {
        ...pendingParity,
        ready: false,
      },
    }, {}],
    [{}, { invalidLegacyMutationCount: 1 }],
    [{
      verifierStage: {
        ...pendingVerifierStage,
        decisionsSha256: "6".repeat(64),
      },
    }, {}],
    [{}, {
      expectedTokenStateCommitment: {
        ...pendingWitnessOptions.expectedTokenStateCommitment,
        sha256: "6".repeat(64),
      },
    }],
    [{}, { confirmedRemovalRows: [{ txid: "6".repeat(64) }] }],
    [{
      scan: {
        ...pendingWitness.scan,
        completeModel: "persisted-pending-work-projection-audit-v1",
      },
    }, {}],
    [{
      scan: {
        ...pendingWitness.scan,
        inspectedTxids: pendingMempoolTxids.length + 1,
      },
    }, {}],
    [{
      scan: {
        ...pendingWitness.scan,
        mempoolMembershipCount: pendingMempoolTxids.length - 1,
      },
    }, {}],
    [{
      generatedAt: new Date(
        pendingNowMs - 11 * 60_000,
      ).toISOString(),
    }, {}],
  ]) {
    assert.equal(
      workerWorkPrecisionPendingWitnessReady(
        { ...pendingWitness, ...witnessMutation },
        { ...pendingWitnessOptions, ...optionMutation },
      ),
      false,
      "mutated pending readiness witness must fail closed",
    );
  }
  const unresolvedRecoveryParity = workerWorkPrecisionPendingParity({
    balanceRows: [],
    eventRows: [],
    listingRows: [],
    mempoolTxids: pendingMempoolTxids,
    recoveryRows: [{
      raw_tx: {
        pendingWorkMintAttemptCount: 1,
        pendingWorkMintInspectionVersion: 1,
        pendingWorkMintRecoveryNeeded: true,
        pendingWorkMintResolvedInvalid: false,
        pendingProtocolResolvedInvalid: false,
      },
      status: "pending",
      txid: pendingMemberTxid,
    }],
    transactionRows: [{
      ...pendingTransactionRows[0],
      raw_tx: {
        pendingWorkMintAttemptCount: 1,
        pendingWorkMintInspectionVersion: 1,
        pendingWorkMintRecoveryNeeded: true,
        pendingWorkMintResolvedInvalid: false,
        pendingProtocolResolvedInvalid: false,
      },
    }],
  });
  assert.equal(unresolvedRecoveryParity.ready, false);
  for (const raw_tx of [
    {
      pendingWorkMintAttemptCount: 1,
      pendingWorkMintInspectionVersion: 1,
      pendingWorkMintRecoveryNeeded: false,
      pendingWorkMintResolvedInvalid: false,
      pendingProtocolResolvedInvalid: false,
    },
    {
      pendingWorkMintAttemptCount: 2,
      pendingWorkMintInspectionVersion: 1,
      pendingWorkMintRecoveryNeeded: false,
      pendingWorkMintResolvedInvalid: false,
      pendingProtocolResolvedInvalid: false,
    },
    {
      pendingWorkMintAttemptCount: "1",
      pendingWorkMintInspectionVersion: "1",
      pendingWorkMintRecoveryNeeded: "false",
      pendingWorkMintResolvedInvalid: "true",
      pendingProtocolResolvedInvalid: "true",
    },
  ]) {
    assert.equal(
      workerWorkPrecisionPendingParity({
        balanceRows: [],
        eventRows: [],
        listingRows: [],
        mempoolTxids: pendingMempoolTxids,
        recoveryRows: [{
          raw_tx,
          status: "pending",
          txid: pendingMemberTxid,
        }],
        transactionRows: [{
          ...pendingTransactionRows[0],
          raw_tx,
        }],
      }).ready,
      false,
      "missing, ambiguous, or noncanonical WORK decision markers must fail closed",
    );
  }
  assert.equal(
    workerWorkPrecisionPendingParity({
      balanceRows: [],
      eventRows: [{
        event_id: "pending-work-mint-invalid",
        kind: "token-event-invalid",
        payload: { attemptedKind: "token-mint" },
        txid: pendingMemberTxid,
        valid: false,
      }],
      listingRows: [],
      mempoolTxids: pendingMempoolTxids,
      recoveryRows: [{
        raw_tx: {
          pendingWorkMintAttemptCount: 1,
          pendingWorkMintInspectionVersion: 1,
          pendingWorkMintRecoveryNeeded: false,
          pendingWorkMintResolvedInvalid: true,
          pendingProtocolResolvedInvalid: true,
        },
        status: "pending",
        txid: pendingMemberTxid,
      }],
      transactionRows: [{
        ...pendingTransactionRows[0],
        raw_tx: {
          pendingWorkMintAttemptCount: 1,
          pendingWorkMintInspectionVersion: 1,
          pendingWorkMintRecoveryNeeded: false,
          pendingWorkMintResolvedInvalid: true,
          pendingProtocolResolvedInvalid: true,
        },
      }],
    }).ready,
    true,
    "one exact terminal invalid marker may close a single WORK mint attempt",
  );
  const supplyCapTerminalRaw = {
    pendingWorkMintAttemptCount: 1,
    pendingWorkMintInspectionVersion: 1,
    pendingWorkMintRecoveryNeeded: false,
    pendingWorkMintResolvedInvalid: true,
    pendingProtocolResolvedInvalid: true,
  };
  assert.equal(
    workerWorkPrecisionPendingParity({
      balanceRows: [],
      eventRows: [{
        event_id: "pending-work-supply-cap",
        kind: "token-event-invalid",
        payload: { provisionalReason: "supply-cap" },
        txid: pendingMemberTxid,
        valid: false,
      }],
      listingRows: [],
      mempoolTxids: pendingMempoolTxids,
      recoveryRows: [{
        raw_tx: supplyCapTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
      transactionRows: [{
        raw_tx: supplyCapTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
    }).ready,
    true,
    "one exact invalid supply-cap decision may coexist with the terminal-invalid protocol marker",
  );
  const multiMintTerminalRaw = {
    pendingWorkMintAttemptCount: 2,
    pendingWorkMintInspectionVersion: 1,
    pendingWorkMintRecoveryNeeded: false,
    pendingWorkMintResolvedInvalid: true,
    pendingProtocolResolvedInvalid: true,
  };
  assert.equal(
    workerWorkPrecisionPendingParity({
      balanceRows: [],
      eventRows: [],
      listingRows: [],
      mempoolTxids: pendingMempoolTxids,
      recoveryRows: [{
        raw_tx: multiMintTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
      transactionRows: [{
        raw_tx: multiMintTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
    }).ready,
    false,
    "a whole-transaction marker cannot replace exact per-record multi-mint outcomes",
  );
  assert.equal(
    workerWorkPrecisionPendingParity({
      balanceRows: [],
      eventRows: [0, 1].map((recordOrdinal) => ({
        event_id: `pending-work-mint-invalid-${recordOrdinal}`,
        kind: "token-event-invalid",
        payload: { attemptedKind: "token-mint" },
        record_ordinal: recordOrdinal,
        txid: pendingMemberTxid,
        valid: false,
      })),
      listingRows: [],
      mempoolTxids: pendingMempoolTxids,
      recoveryRows: [{
        raw_tx: multiMintTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
      transactionRows: [{
        raw_tx: multiMintTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
    }).ready,
    true,
    "two explicit invalid outcomes close two inspected WORK mint attempts",
  );
  assert.equal(
    workerWorkPrecisionPendingParity({
      balanceRows: [],
      eventRows: pendingEventRows,
      listingRows: [],
      mempoolTxids: pendingMempoolTxids,
      recoveryRows: [{
        raw_tx: multiMintTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
      transactionRows: [{
        raw_tx: multiMintTerminalRaw,
        status: "pending",
        txid: pendingMemberTxid,
      }],
    }).ready,
    false,
    "a terminal-invalid multi-mint marker cannot coexist with a valid persisted WORK projection",
  );
  const malformedMembershipParity = workerWorkPrecisionPendingParity({
    balanceRows: [],
    eventRows: [{ event_id: "bad-event", txid: "not-a-txid" }],
    listingRows: [],
    mempoolTxids: pendingMempoolTxids,
    recoveryRows: [],
    transactionRows: [],
  });
  assert.equal(malformedMembershipParity.ready, false);

  const failure = canonicalWorkerFailureFromLine(
    JSON.stringify(fixtureFailureRecord()),
  );
  assert.deepEqual(failure, {
    deterministic: true,
    error: DOMAIN_ERROR,
    failureClass: CANONICAL_TX_CONTENT_FAILURE_CLASS,
    failureCode: CANONICAL_TX_CONTENT_FAILURE_CODE,
    failingBlockHeight: 958_432,
    phase: "block-scan-verification",
    txid: TXID,
  });
  assert.deepEqual(
    canonicalWorkerFailureFromError({ workerFailure: failure }),
    failure,
    "the structured child failure must survive process-boundary wrapping",
  );
  assert.equal(
    canonicalWorkerFailureFromLine(
      JSON.stringify({
        height: 958_432,
        phase: "pending-status",
        txid: TXID,
      }),
    ),
    null,
    "pending cleanup errors must not activate canonical containment",
  );
  const transientLine = JSON.stringify(fixtureFailureRecord({ transient: true }));
  assert.equal(
    canonicalWorkerFailureFromLine(transientLine),
    null,
    "an AbortError/503 from the tx verifier loop must remain retryable",
  );
  assert.equal(
    canonicalWorkerFailureFromLine(
      JSON.stringify({
        ...fixtureFailureRecord(),
        failureClass: "AbortError",
      }),
    ),
    null,
    "the deterministic failure class must match exactly",
  );
  const cappedFailure = canonicalWorkerFailureFromLine(
    JSON.stringify({
      error: "x".repeat(8_000),
      failureClass: CANONICAL_TX_CONTENT_FAILURE_CLASS,
      failureCode: CANONICAL_TX_CONTENT_FAILURE_CODE,
      height: 958_432,
      phase: "block-scan-verification",
      txid: TXID,
    }),
  );
  assert.ok(cappedFailure.error.length <= 4_096);

  class FixtureCanonicalTransactionContentInvariantError extends Error {
    constructor(message) {
      super(message);
      this.code = CANONICAL_TX_CONTENT_FAILURE_CODE;
      this.name = CANONICAL_TX_CONTENT_FAILURE_CLASS;
    }
  }
  const assertCanonicalProtocolTransactionContent = isolatedBackfillFunction(
    "assertCanonicalProtocolTransactionContent",
    {
      CanonicalTransactionContentInvariantError:
        FixtureCanonicalTransactionContentInvariantError,
      isHexTxid: (value) => /^[0-9a-f]{64}$/u.test(String(value)),
    },
  );
  let deterministicDomainError;
  try {
    assertCanonicalProtocolTransactionContent({
      txid: TXID,
      vin: [{ txid: "not-a-txid", vout: 0 }],
    });
  } catch (error) {
    deterministicDomainError = error;
  }
  assert.ok(
    deterministicDomainError instanceof
      FixtureCanonicalTransactionContentInvariantError,
  );
  const verificationFailureRecord = isolatedBackfillFunction(
    "canonicalBlockScanVerificationFailureRecord",
    {
      CANONICAL_TX_CONTENT_FAILURE_CLASS,
      CANONICAL_TX_CONTENT_FAILURE_CODE,
      CanonicalTransactionContentInvariantError:
        FixtureCanonicalTransactionContentInvariantError,
    },
  );
  const deterministicRecord = verificationFailureRecord(
    deterministicDomainError,
    { height: 958_432, txid: TXID },
  );
  assert.equal(
    deterministicRecord.failureCode,
    CANONICAL_TX_CONTENT_FAILURE_CODE,
  );
  assert.equal(
    deterministicRecord.failureClass,
    CANONICAL_TX_CONTENT_FAILURE_CLASS,
  );
  const transientError = new Error("Verifier request returned HTTP 503");
  transientError.name = "AbortError";
  transientError.statusCode = 503;
  const transientRecord = verificationFailureRecord(transientError, {
    height: 958_432,
    txid: TXID,
  });
  assert.equal(transientRecord.failureCode, undefined);
  assert.equal(transientRecord.failureClass, undefined);
  assert.equal(transientRecord.errorName, "AbortError");
  assert.equal(transientRecord.statusCode, 503);
  assert.deepEqual(
    canonicalWorkerFailureFromLine(JSON.stringify(deterministicRecord)),
    failure,
  );
  assert.equal(
    canonicalWorkerFailureFromLine(JSON.stringify(transientRecord)),
    null,
  );

  const order = [];
  const pendingResult = await runCanonicalBeforePending(
    async () => {
      order.push("canonical");
    },
    async () => {
      order.push("pending");
      return { checked: 1 };
    },
  );
  assert.deepEqual(order, ["canonical", "pending"]);
  assert.deepEqual(pendingResult, { checked: 1 });
  assert.match(
    workerSource,
    /assertWorkPrecisionReplayReady\([\s\S]*requireCurrentSnapshot: false,[\s\S]*requireRelationalParity: false,[\s\S]*runCanonicalBeforePending\([\s\S]*runBackfillPhase\(backfillPhases\[0\]\)[\s\S]*publishCanonicalSummaryAtConfirmedCheckpoint\(\)[\s\S]*pendingStatus = await refreshPendingStatusesSafely\(\);[\s\S]*runBackfillPhase\(backfillPhases\[1\]\)[\s\S]*assertWorkPrecisionReplayReady\(\s*pool,\s*workPrecision,\s*\)[\s\S]*assertWorkPrecisionPendingReady/u,
    "Q16 canonical replay must relax snapshot/parity, publish the confirmed summary, then run the pending witness and recheck strictly",
  );
  assert.doesNotMatch(
    workerSource,
    /POW_INDEX_BACKFILL_ACTIVITY_SNAPSHOT:[\s\S]*POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT: "1"/u,
    "the worker must not duplicate complete rendered histories into every canonical summary row",
  );
  assert.match(
    workerSource,
    /if \(pendingEventHealth\.ok !== true\) \{[\s\S]*throw new Error/u,
    "unresolved observed pending protocol events must prevent a green worker cycle",
  );
  assert.match(
    workerSource,
    /runScript\("check-proof-indexer-parity\.mjs"[\s\S]*POW_INDEX_PARITY_STRICT: "1"[\s\S]*Worker parity check failed[\s\S]*throw error/u,
    "a scheduled parity run must be strict and must fail the worker cycle",
  );
  for (const variable of [
    "POW_INDEX_PARITY_LOG_FRESH",
    "POW_INDEX_PARITY_SNAPSHOT_FRESH",
    "POW_INDEX_PARITY_TOKEN_FRESH",
  ]) {
    assert.match(
      workerSource,
      new RegExp(`${variable}: "1"`, "u"),
      `${variable} must be enabled for every scheduled worker parity run`,
    );
  }
  const blockedOrder = [];
  await assert.rejects(
    runCanonicalBeforePending(
      async () => {
        blockedOrder.push("canonical");
        throw new Error("canonical checkpoint rejected");
      },
      async () => {
        blockedOrder.push("pending");
      },
    ),
    /canonical checkpoint rejected/u,
  );
  assert.deepEqual(blockedOrder, ["canonical"]);

  assert.deepEqual(
    workerBackfillPhasePlan("block-scan,mempool-scan", "1"),
    [
      {
        canonicalBarrier: true,
        kind: "confirmed",
        sourceLabels: ["block-scan"],
        storeCanonicalSummarySnapshot: "0",
      },
      {
        canonicalBarrier: false,
        kind: "best-effort-pending",
        sourceLabels: ["mempool-scan"],
        storeCanonicalSummarySnapshot: "0",
      },
    ],
    "the production hot path must publish confirmed summaries before pending witness work",
  );
  assert.deepEqual(
    workerBackfillPhasePlan("mempool-scan,block-scan", "1"),
    workerBackfillPhasePlan("block-scan,mempool-scan", "1"),
    "configuration order must not move mempool work ahead of confirmed publication",
  );
  assert.deepEqual(
    workerBackfillPhasePlan("block-scan,token-mints,mempool-scan", "1"),
    [
      {
        canonicalBarrier: true,
        kind: "combined",
        sourceLabels: ["block-scan", "token-mints", "mempool-scan"],
        storeCanonicalSummarySnapshot: "1",
      },
    ],
    "explicit supervised source sets must retain their existing combined semantics",
  );

  const mempoolScanTimeBudgetReached = isolatedBackfillFunction(
    "mempoolScanTimeBudgetReached",
  );
  assert.equal(
    mempoolScanTimeBudgetReached(1_000, 0, 20_000, 15_000),
    false,
    "the pending scanner must attempt at least one candidate per pass",
  );
  assert.equal(
    mempoolScanTimeBudgetReached(1_000, 1, 15_999, 15_000),
    false,
  );
  assert.equal(
    mempoolScanTimeBudgetReached(1_000, 1, 16_000, 15_000),
    true,
    "the pending scanner must yield at a transaction boundary once its budget is spent",
  );
  const pendingVerifierRequestTimeoutMs = isolatedBackfillFunction(
    "pendingVerifierRequestTimeoutMs",
    {
      PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
      PENDING_VERIFIER_TIMEOUT_MS: 30_000,
    },
  );
  assert.equal(pendingVerifierRequestTimeoutMs({}, 10_000), 30_000);
  assert.equal(
    pendingVerifierRequestTimeoutMs(
      { pendingVerifierDeadlineMs: 35_000 },
      10_000,
    ),
    25_000,
    "each verifier spec must shrink to the absolute child deadline",
  );
  assert.equal(
    pendingVerifierRequestTimeoutMs(
      { pendingVerifierDeadlineMs: 10_999 },
      10_000,
    ),
    0,
    "a verifier must not start inside the reserved persistence window",
  );
  const pendingExtendedVerifierTimeoutMs = isolatedBackfillFunction(
    "pendingExtendedVerifierTimeoutMs",
    {
      BACKFILL_PROCESS_STARTED_AT_MS: 0,
      PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
      PENDING_ONLY_BACKFILL: true,
      PENDING_ONLY_CHILD_TIMEOUT_MS: 90_000,
      PENDING_ONLY_PERSISTENCE_HEADROOM_MS: 9_000,
      PENDING_ONLY_VERIFIER_MAX_MS: 30_000,
    },
  );
  assert.equal(
    pendingExtendedVerifierTimeoutMs({
      childTimeoutMs: 30_000,
      nowMs: 10_000,
      pendingOnly: false,
      processStartedAtMs: 10_000,
    }),
    30_000,
    "the historical verifier allowance remains unchanged outside pending-only mode",
  );
  assert.equal(
    pendingExtendedVerifierTimeoutMs({
      childTimeoutMs: 90_000,
      nowMs: 10_000,
      pendingOnly: true,
      processStartedAtMs: 10_000,
    }),
    30_000,
  );
  assert.equal(
    pendingExtendedVerifierTimeoutMs({
      childTimeoutMs: 90_000,
      nowMs: 75_000,
      pendingOnly: true,
      processStartedAtMs: 10_000,
    }),
    16_000,
  );
  assert.equal(
    pendingExtendedVerifierTimeoutMs({
      childTimeoutMs: 90_000,
      nowMs: 90_001,
      pendingOnly: true,
      processStartedAtMs: 10_000,
    }),
    0,
    "an exhausted pending pass must skip the extended verifier and preserve shutdown headroom",
  );
  {
    const stageRequest = { model: "fixture-pending-stage-request" };
    const exactTipError = Object.assign(
      new Error(
        "/api/v1/internal/pending-work-verifier-stage returned HTTP 503",
      ),
      {
        details: { code: "PENDING_WORK_STAGE_EXACT_TIP_UNAVAILABLE" },
        statusCode: 503,
      },
    );
    const pendingOnlyCalls = [];
    const requestPendingOnlyWorkStage = isolatedBackfillFunction(
      "requestWorkQ16PendingStage",
      {
        BACKFILL_PROCESS_STARTED_AT_MS: 1_000,
        Date: { now: () => 11_000 },
        PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
        PENDING_ONLY_BACKFILL: true,
        PENDING_ONLY_CHILD_TIMEOUT_MS: 90_000,
        PENDING_ONLY_PERSISTENCE_HEADROOM_MS: 9_000,
        REQUEST_RETRIES: 8,
        REQUEST_TIMEOUT_MS: 180_000,
        WORK_Q16_PENDING_STAGE_PATH:
          "/api/v1/internal/pending-work-verifier-stage",
        canonicalWorkQ16PendingStageResponse: () => {
          throw new Error("a failed stage request must not be canonicalized");
        },
        explicitLoopbackApiBaseConfigured: () => true,
        readJson: async (url, options) => {
          pendingOnlyCalls.push({ options, url });
          throw exactTipError;
        },
        unpagedEndpoint: (path) =>
          new URL(`http://127.0.0.1:8099${path}`),
      },
    );
    await assert.rejects(
      () => requestPendingOnlyWorkStage(stageRequest),
      (error) => error === exactTipError,
    );
    assert.equal(pendingOnlyCalls.length, 1);
    assert.equal(
      pendingOnlyCalls[0].options.retries,
      0,
      "the outer canonical cycle, not one stale stage request, must own tip-race retries",
    );
    assert.equal(pendingOnlyCalls[0].options.timeoutMs, 71_000);
    assert.equal(pendingOnlyCalls[0].options.body, stageRequest);
    assert.equal(pendingOnlyCalls[0].options.method, "POST");

    let supervisedOptions = null;
    const stagePayload = { model: "fixture-pending-stage" };
    const requestSupervisedWorkStage = isolatedBackfillFunction(
      "requestWorkQ16PendingStage",
      {
        BACKFILL_PROCESS_STARTED_AT_MS: 1_000,
        Date: { now: () => 11_000 },
        PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
        PENDING_ONLY_BACKFILL: false,
        PENDING_ONLY_CHILD_TIMEOUT_MS: 90_000,
        PENDING_ONLY_PERSISTENCE_HEADROOM_MS: 9_000,
        REQUEST_RETRIES: 8,
        REQUEST_TIMEOUT_MS: 180_000,
        WORK_Q16_PENDING_STAGE_PATH:
          "/api/v1/internal/pending-work-verifier-stage",
        canonicalWorkQ16PendingStageResponse: (payload) => payload,
        explicitLoopbackApiBaseConfigured: () => true,
        readJson: async (_url, options) => {
          supervisedOptions = options;
          return stagePayload;
        },
        unpagedEndpoint: (path) =>
          new URL(`http://127.0.0.1:8099${path}`),
      },
    );
    assert.equal(
      await requestSupervisedWorkStage(stageRequest),
      stagePayload,
    );
    assert.equal(
      supervisedOptions.retries,
      8,
      "the liveness correction must stay scoped to the pending-only worker child",
    );
    assert.equal(supervisedOptions.timeoutMs, 180_000);
  }
  assert.equal(pendingBackfillChildTimeoutMs(null), 10_000);
  assert.equal(pendingBackfillChildTimeoutMs("invalid"), 10_000);
  assert.equal(pendingBackfillChildTimeoutMs("1000"), 5_000);
  assert.equal(pendingBackfillChildTimeoutMs("15000"), 15_000);
  assert.equal(pendingBackfillChildTimeoutMs("900000"), 600_000);

  assert.equal(typeof workerSleepUntilIntervalOrTipAdvance, "function");
  assert.equal(workerIdleTipPollMs(null, 30_000), 1_000);
  assert.equal(workerIdleTipPollMs("250", 30_000), 1_000);
  assert.equal(workerIdleTipPollMs("1500", 30_000), 1_500);
  assert.equal(workerIdleTipPollMs("60000", 30_000), 30_000);

  {
    const source = readFileSync(WORKER_PATH, "utf8");
    assert.match(
      source,
      /async function readWorkerCoreWakeTip\([\s\S]*workerBitcoinCoreRpc\(\s*"getblockchaininfo"[\s\S]*bestblockhash/u,
    );
    assert.match(
      source,
      /workerSleepUntilIntervalOrTipAdvance\([\s\S]*readWorkerCoreWakeTip[\s\S]*await workerSleep\(runtime, Math\.min\(poll, remainingMs\)\)[\s\S]*core-tip-advanced/u,
    );
    assert.match(
      source,
      /runCycle\(pool, lastSuccess, runtime\)[\s\S]*workerSleepUntilIntervalOrTipAdvance\([\s\S]*cycle\.canonicalProgress/u,
    );
    assert.match(
      source,
      /const retryDelayMs = workerIdleTipPollMs\([\s\S]*IDLE_TIP_POLL_MS,[\s\S]*INTERVAL_MS[\s\S]*\)/u,
      "tip-change deferrals must retry at poll speed, not at the full worker interval",
    );
  }
  assert.deepEqual(
    workerPendingEventHealth({ era: "q8", ready: true }),
    {
      globalUnresolved: null,
      model: "bounded-best-effort-pending-event-health-v1",
      ok: true,
      q16PendingUnresolved: null,
      required: false,
      scope: "all-observed-pending-protocol-events",
    },
    "the global pending-event health gate is explicitly not required before Q16",
  );
  assert.deepEqual(
    workerPendingEventHealth({
      era: "q16",
      globalUnresolved: 0,
      q16PendingUnresolved: 0,
      ready: true,
    }),
    {
      globalUnresolved: 0,
      model: "bounded-best-effort-pending-event-health-v1",
      ok: true,
      q16PendingUnresolved: 0,
      required: true,
      scope: "all-observed-pending-protocol-events",
    },
    "a complete Q16 scan is healthy only when every observed protocol event resolves",
  );
  assert.equal(
    workerPendingEventHealth({
      era: "q16",
      globalUnresolved: 1,
      q16PendingUnresolved: 0,
      ready: true,
    }).ok,
    false,
    "a generic unresolved pending protocol event must degrade whole-index health",
  );
  assert.equal(
    workerPendingEventHealth({
      era: "q16",
      globalUnresolved: "0",
      q16PendingUnresolved: 0,
      ready: true,
    }).ok,
    false,
    "pending health counters must remain exact JSON integers",
  );

  const pendingOnlyBackfillMode = isolatedBackfillFunction(
    "pendingOnlyBackfillMode",
  );
  const pendingOnlyConfiguration = {
    enabled: true,
    maintenanceMode: false,
    sourceFilterSize: 1,
    sourceLabels: ["mempool-scan"],
    storeCanonicalSummarySnapshot: false,
    storeLedgerSnapshot: false,
  };
  assert.equal(pendingOnlyBackfillMode(pendingOnlyConfiguration), true);
  assert.throws(
    () =>
      pendingOnlyBackfillMode({
        ...pendingOnlyConfiguration,
        sourceFilterSize: 2,
        sourceLabels: ["block-scan", "mempool-scan"],
      }),
    /exact source set/u,
  );
  assert.throws(
    () =>
      pendingOnlyBackfillMode({
        ...pendingOnlyConfiguration,
        storeCanonicalSummarySnapshot: true,
      }),
    /canonical-summary storage to be disabled/u,
  );
  assert.throws(
    () =>
      pendingOnlyBackfillMode({
        ...pendingOnlyConfiguration,
        maintenanceMode: true,
      }),
    /cannot be combined/u,
  );
  const runPendingOnlyBackfillPass = isolatedBackfillFunction(
    "runPendingOnlyBackfillPass",
  );
  const pendingSourceCalls = [];
  const pendingSource = { label: "mempool-scan", mempoolScan: true };
  const pendingPassResults = await runPendingOnlyBackfillPass(
    { id: "fixture-client" },
    [pendingSource],
    async (client, source) => {
      pendingSourceCalls.push({ client, source });
      return { indexed: 2, source: source.label };
    },
  );
  assert.deepEqual(pendingSourceCalls, [
    {
      client: { id: "fixture-client" },
      source: pendingSource,
    },
  ]);
  assert.deepEqual([...pendingPassResults], [
    { indexed: 2, source: "mempool-scan" },
  ]);

  const transition = (
    previous,
    nowMs,
    progress = {
      checkpointHash: CHECKPOINT_HASH,
      checkpointHeight: 958_431,
    },
  ) =>
    nextWorkerNoProgressState(previous, {
      alertIntervalMs: 60_000,
      baseDelayMs: 1_000,
      failure,
      maxDelayMs: 8_000,
      network: "livenet",
      nowMs,
      progress,
      threshold: 3,
    });

  const first = transition(null, START_MS);
  const second = transition(first, START_MS + 1_000);
  const third = transition(second, START_MS + 3_000);
  assert.equal(first.active, false);
  assert.equal(first.retryDelayMs, 1_000);
  assert.equal(second.repeatCount, 2);
  assert.equal(second.retryDelayMs, 2_000);
  assert.equal(third.active, true);
  assert.equal(third.alertReady, true);
  assert.equal(third.repeatCount, 3);
  assert.equal(third.retryDelayMs, 4_000);
  assert.equal(third.action, "retry");
  assert.equal(third.network, "livenet");

  const alerted = markWorkerNoProgressAlerted(third, START_MS + 3_000);
  const rateLimited = transition(alerted, START_MS + 10_000);
  const alertDueAgain = transition(rateLimited, START_MS + 64_000);
  assert.equal(rateLimited.alertReady, false);
  assert.equal(rateLimited.retryDelayMs, 8_000);
  assert.equal(alertDueAgain.alertReady, true);

  const progressResetsCircuit = transition(alertDueAgain, START_MS + 65_000, {
    checkpointHash: NEXT_CHECKPOINT_HASH,
    checkpointHeight: 958_432,
  });
  assert.equal(progressResetsCircuit.active, false);
  assert.equal(progressResetsCircuit.repeatCount, 1);
  const cleared = resetWorkerNoProgressState(
    alertDueAgain,
    {
      checkpointHash: NEXT_CHECKPOINT_HASH,
      checkpointHeight: 958_432,
    },
    START_MS + 66_000,
    "canonical-scan-success",
    "livenet",
  );
  assert.equal(cleared.active, false);
  assert.equal(cleared.repeatCount, 0);
  assert.equal(cleared.clearedFingerprint, alertDueAgain.fingerprint);
  assert.equal(
    workerNoProgressFromMeta(
      { network: "testnet", noProgress: third },
      "livenet",
    ),
    null,
    "cross-network containment metadata must be rejected",
  );
  assert.equal(
    workerNoProgressFromMeta(
      { network: "livenet", noProgress: third },
      "livenet",
    ),
    third,
  );

  assert.equal(shouldEscalateWorkerFailure(null, 2, 3), false);
  assert.equal(shouldEscalateWorkerFailure(null, 3, 3), true);
  assert.equal(
    shouldEscalateWorkerFailure(failure, 100, 3),
    false,
    "recognized canonical poison must remain contained",
  );
  assert.equal(
    containableCanonicalFailure(failure, {
      checkpointHash: CHECKPOINT_HASH,
      checkpointHeight: 958_431,
    }),
    failure,
  );
  assert.equal(
    containableCanonicalFailure(failure, {
      checkpointHash: null,
      checkpointHeight: 958_431,
    }),
    null,
    "containment requires an authoritative hash-bound checkpoint",
  );
  assert.equal(
    containableCanonicalFailure(failure, {
      checkpointHash: CHECKPOINT_HASH,
      checkpointHeight: 958_432,
    }),
    null,
    "the checkpoint must precede the failing block",
  );
  assert.equal(
    containableCanonicalFailure(
      { ...failure, failureCode: undefined },
      {
        checkpointHash: CHECKPOINT_HASH,
        checkpointHeight: 958_431,
      },
    ),
    null,
    "a generic deterministic boolean is not a trusted containment identity",
  );

  assert.match(
    AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
    /NOT \(source_hashes \? 'canonicalSummary'\)/u,
  );
  assert.match(
    AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
    /payload->>'source' = 'proof-indexer-block-scan'/u,
  );
  assert.match(
    AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
    /consistency->>'status' IN \('block-scan-current', 'block-scan-partial'\)/u,
  );
  assert.match(
    AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
    /source_hashes->>'blockScan' ~\* '\^\[0-9a-f\]\{64\}\$'/u,
  );
  assert.match(
    AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
    /lower\(source_hashes->>'blockScan'\) =[\s\S]*lower\(payload->>'indexedThroughBlockHash'\)/u,
  );

  const childRuntime = createWorkerRuntime("livenet");
  let nonzeroError;
  try {
    await runScript(
      "check-worker-containment.mjs",
      ["--fixture=poison-exit"],
      {},
      { runtime: childRuntime, timeoutMs: 5_000 },
    );
  } catch (error) {
    nonzeroError = error;
  }
  assert.match(nonzeroError?.message ?? "", /code 7/u);
  assert.deepEqual(canonicalWorkerFailureFromError(nonzeroError), failure);
  assert.equal(childRuntime.activeChild, null);

  const transientRuntime = createWorkerRuntime("livenet");
  let transientChildError;
  try {
    await runScript(
      "check-worker-containment.mjs",
      ["--fixture=transient-exit"],
      {},
      { runtime: transientRuntime, timeoutMs: 5_000 },
    );
  } catch (error) {
    transientChildError = error;
  }
  assert.match(transientChildError?.message ?? "", /code 8/u);
  assert.equal(canonicalWorkerFailureFromError(transientChildError), null);
  assert.equal(transientRuntime.activeChild, null);

  const timeoutRuntime = createWorkerRuntime("livenet");
  let timeoutError;
  const timeoutStartedAt = Date.now();
  try {
    await runScript(
      "check-worker-containment.mjs",
      ["--fixture=poison-timeout"],
      {},
      { runtime: timeoutRuntime, timeoutMs: 1_000 },
    );
  } catch (error) {
    timeoutError = error;
  }
  const timeoutElapsedMs = Date.now() - timeoutStartedAt;
  assert.match(timeoutError?.message ?? "", /wall-clock budget/u);
  assert.equal(timeoutError?.code, "POW_INDEX_CHILD_TIMEOUT");
  assert.equal(timeoutError?.timeoutMs, 1_000);
  assert.ok(
    timeoutElapsedMs >= 900,
    `timeout returned too early: ${timeoutElapsedMs}ms`,
  );
  assert.ok(
    timeoutElapsedMs < 3_000,
    `timeout did not terminate promptly: ${timeoutElapsedMs}ms`,
  );
  assert.deepEqual(canonicalWorkerFailureFromError(timeoutError), failure);
  assert.equal(timeoutRuntime.activeChild, null);

  const pendingRuntime = createWorkerRuntime("livenet");
  const pendingSequence = ["canonical-current"];
  const pendingStartedAt = Date.now();
  const pendingPhase = await runBestEffortPendingBackfill(
    {},
    pendingRuntime,
    {
      args: ["--fixture=ignore-term"],
      forceKillGraceMs: 100,
      scriptName: "check-worker-containment.mjs",
      timeoutMs: 250,
    },
  );
  const pendingElapsedMs = Date.now() - pendingStartedAt;
  pendingSequence.push("pending-returned", "canonical-next");
  assert.deepEqual(pendingSequence, [
    "canonical-current",
    "pending-returned",
    "canonical-next",
  ]);
  assert.equal(pendingPhase.ok, false);
  assert.equal(pendingPhase.timedOut, true);
  assert.match(pendingPhase.error, /250ms wall-clock budget/u);
  assert.ok(
    pendingElapsedMs >= 200,
    `pending watchdog returned too early: ${pendingElapsedMs}ms`,
  );
  assert.ok(
    pendingElapsedMs < 2_000,
    `pending watchdog did not return control promptly: ${pendingElapsedMs}ms`,
  );
  assert.equal(pendingRuntime.activeChild, null);

  const stopRuntime = createWorkerRuntime("livenet");
  const activeChildPromise = runScript(
    "check-worker-containment.mjs",
    ["--fixture=wait-for-stop"],
    {},
    { runtime: stopRuntime, timeoutMs: 10_000 },
  );
  for (let attempt = 0; attempt < 50 && !stopRuntime.activeChild; attempt += 1) {
    await delay(10);
  }
  assert.ok(stopRuntime.activeChild, "fixture child should be active");
  const stopStartedAt = Date.now();
  requestWorkerStop(stopRuntime);
  await assert.rejects(activeChildPromise, (error) => {
    assert.equal(error?.code, "POW_INDEX_WORKER_STOPPING");
    return true;
  });
  const stopElapsedMs = Date.now() - stopStartedAt;
  assert.ok(
    stopElapsedMs < 2_000,
    `SIGTERM did not return control promptly: ${stopElapsedMs}ms`,
  );
  assert.equal(stopRuntime.activeChild, null);
  await assert.rejects(
    runScript(
      "check-worker-containment.mjs",
      ["--fixture=poison-exit"],
      {},
      { runtime: stopRuntime, timeoutMs: 1_000 },
    ),
    (error) => {
      assert.equal(error?.code, "POW_INDEX_WORKER_STOPPING");
      return true;
    },
  );
  assert.equal(stopRuntime.activeChild, null, "stopping must prevent respawn");

  console.log(
    JSON.stringify({
      authoritativeCheckpoint: true,
      canonicalBeforePending: true,
      childNonzeroAndTimeout: true,
      deterministicDomainOnly: true,
      circuitActivation: "contained-retry",
      genericEscalation: true,
      pendingOnlySourceBoundary: true,
      pendingStatusBeforeWitness: true,
      pendingWitnessExact: true,
      pendingWatchdogReturnsControl: true,
      progressReset: true,
      rateLimitedAlert: true,
      sigtermStopsChildWithoutRespawn: true,
      workerContainment: true,
      workPrecisionCoreTipHash: true,
      workPrecisionEraLatch: true,
      workPrecisionFullRelationalParity: true,
      workPrecisionTransitionSnapshotEnvelope: true,
    }),
  );
}
