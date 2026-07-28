import assert from "node:assert/strict";
import { readFileSync, writeSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";

import {
  AUTHORITATIVE_WORKER_CHECKPOINT_SQL,
  CANONICAL_TX_CONTENT_FAILURE_CLASS,
  CANONICAL_TX_CONTENT_FAILURE_CODE,
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
  workerNoProgressFromMeta,
} from "./run-proof-indexer-worker.mjs";

const TXID = "b".repeat(64);
const CHECKPOINT_HASH = "a".repeat(64);
const NEXT_CHECKPOINT_HASH = "c".repeat(64);
const START_MS = Date.parse("2026-07-18T12:00:00.000Z");
const DOMAIN_ERROR =
  `Canonical protocol transaction ${TXID} input 0 has an invalid outpoint`;
const BACKFILL_PATH = new URL("./backfill-proof-indexer.mjs", import.meta.url);
const fixtureMode = process.argv.find((value) => value.startsWith("--fixture="))
  ?.split("=")[1];

function topLevelFunctionSource(name) {
  const source = readFileSync(BACKFILL_PATH, "utf8");
  const startPattern = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`,
    "mu",
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Could not find ${name} in ${BACKFILL_PATH.pathname}`);
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
        storeCanonicalSummarySnapshot: "1",
      },
      {
        canonicalBarrier: false,
        kind: "best-effort-pending",
        sourceLabels: ["mempool-scan"],
        storeCanonicalSummarySnapshot: "0",
      },
    ],
    "the production hot path must publish confirmed summaries before pending work",
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
  const pendingExtendedVerifierTimeoutMs = isolatedBackfillFunction(
    "pendingExtendedVerifierTimeoutMs",
    {
      BACKFILL_PROCESS_STARTED_AT_MS: 0,
      PENDING_LEGACY_VERIFIER_TIMEOUT_MS: 30_000,
      PENDING_ONLY_BACKFILL: true,
      PENDING_ONLY_CHILD_TIMEOUT_MS: 30_000,
      PENDING_ONLY_PERSISTENCE_HEADROOM_MS: 9_000,
      PENDING_ONLY_VERIFIER_MAX_MS: 20_000,
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
      childTimeoutMs: 30_000,
      nowMs: 10_000,
      pendingOnly: true,
      processStartedAtMs: 10_000,
    }),
    20_000,
  );
  assert.equal(
    pendingExtendedVerifierTimeoutMs({
      childTimeoutMs: 30_000,
      nowMs: 15_000,
      pendingOnly: true,
      processStartedAtMs: 10_000,
    }),
    16_000,
  );
  assert.equal(
    pendingExtendedVerifierTimeoutMs({
      childTimeoutMs: 30_000,
      nowMs: 30_001,
      pendingOnly: true,
      processStartedAtMs: 10_000,
    }),
    0,
    "an exhausted pending pass must skip the extended verifier and preserve shutdown headroom",
  );
  assert.equal(pendingBackfillChildTimeoutMs(null), 30_000);
  assert.equal(pendingBackfillChildTimeoutMs("invalid"), 30_000);
  assert.equal(pendingBackfillChildTimeoutMs("15000"), 20_000);
  assert.equal(pendingBackfillChildTimeoutMs("25000"), 25_000);
  assert.equal(pendingBackfillChildTimeoutMs("900000"), 30_000);

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
      pendingWatchdogReturnsControl: true,
      progressReset: true,
      rateLimitedAlert: true,
      sigtermStopsChildWithoutRespawn: true,
      workerContainment: true,
    }),
  );
}
