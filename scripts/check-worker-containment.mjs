import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  workerWorkAmoV8ActivationLatchReady,
  workerWorkAmoV8DeclarationConfig,
  workerWorkPrecisionConfirmedReplayEnvelopeReady,
  workerWorkPrecisionCoreTipReady,
  workerWorkPrecisionEra,
  workerWorkPrecisionFromMeta,
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
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
} from "../server/work-amo-v5.mjs";

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
const fixtureMode = process.argv.find((value) => value.startsWith("--fixture="))
  ?.split("=")[1];

function deploymentEnvironmentValues(source, name) {
  const pattern = new RegExp(
    `^Environment=${name.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&")}=(.*)$`,
    "gmu",
  );
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

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
  assert.match(
    workerSource,
    /previous_transition\.closing_state_sha256 <>\s*transition\.opening_state_sha256/u,
    "every post-activation transition must chain its opening state to the prior close",
  );
  assert.match(
    workerSource,
    /transition\.payload->'openingSufficientState'\s*IS DISTINCT FROM\s*previous_transition\.payload\s*->'closingSufficientState'/u,
    "the complete sufficient-state payload must be continuous",
  );
  assert.match(
    workerSource,
    /transition\.block_height = \$2[\s\S]*transition\.previous_block_hash <> \$12/u,
    "the activation transition predecessor must be the declaration block",
  );
  assert.match(
    workerSource,
    /transition\.work_token_state_model <> \$4[\s\S]*transition\.payload->>'workTokenStateModel'\s*IS DISTINCT FROM \$4/u,
    "V8 replay must bind both the transition column and top-level payload token-state model",
  );
  assert.doesNotMatch(
    workerSource,
    /transition\.payload->'closingTokenState'\s*->>'model'\s*IS DISTINCT FROM \$4/u,
    "the canonical bare closingTokenState preimage must not be required to duplicate its top-level model",
  );
  assert.match(
    workerSource,
    /getblockchaininfo[\s\S]*getblockhash[\s\S]*Core tip changed across the Q16 relational replay audit/u,
    "Q16 replay must remain bracketed by stable first-party Core tip evidence",
  );
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
      ["0"],
      "AMO V8 writes must deploy disabled",
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
  const replayCommitment = {
    model: "canonical-work-amo-payload-sha256-v1",
    payloadBytes: 32,
    sha256: "7".repeat(64),
  };
  const replaySnapshot = {
    consistencyOk: true,
    consistencyStatus: "green",
    indexedThroughBlock: 102,
    payloadBlockHash: replayTipHash,
    sourceBlockHash: replayTipHash,
    summaryBlockHash: replayTipHash,
    summaryMode: "canonical-summary-refresh",
    tokenStatePayloads: {
      d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8:
        { model: "fixture" },
    },
    workAmountStorageModel: "work-subatoms-v2",
  };
  const replayCoreTip = {
    blockHash: replayTipHash,
    height: 102,
    stable: true,
  };
  const replayEnvelope = {
    activationHeight: 101,
    activationTransition: {
      blockHeight: 101,
      model: "canonical-work-amo-full-position-block-sequencer-v4",
      payload: {
        activationHeight: 101,
        openingSufficientState: {
          tokenStateCommitment: replayCommitment,
        },
        precisionMigrationMarkerKey:
          "workPrecisionV2Migration:livenet",
        precisionOpeningTokenStateCommitment: replayCommitment,
      },
      previousBlockHash: replayDeclarationHash,
      stateCommitmentModel:
        "canonical-work-amo-sufficient-state-sha256-v1",
      workTokenStateModel:
        "canonical-work-token-state-subatoms-v3",
    },
    coreTip: replayCoreTip,
    declarationBlockHash: replayDeclarationHash,
    invalidPrecisionEventCount: 0,
    invalidTransitionCount: 0,
    latestTransition: {
      blockHash: replayTipHash,
      blockHeight: 102,
      model: "canonical-work-amo-full-position-block-sequencer-v4",
      stateCommitmentModel:
        "canonical-work-amo-sufficient-state-sha256-v1",
      workTokenStateModel:
        "canonical-work-token-state-subatoms-v3",
    },
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
      tipHash: replayTipHash,
      tipHeight: 102,
    }),
    true,
  );
  assert.equal(
    workerWorkPrecisionConfirmedReplayEnvelopeReady(replayEnvelope),
    true,
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
  const pendingProjection = workerWorkPrecisionPendingProjection({
    balanceRows: [],
    eventRows: pendingEventRows,
    listingRows: [],
    transactionRows: pendingTransactionRows,
  });
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
      completeModel: "persisted-pending-work-projection-audit-v1",
      discoveryModel: "bounded-best-effort-unconfirmed-discovery-v1",
      inspectedTxids: 0,
      mempoolMembershipCount: pendingMempoolTxids.length,
      protocolTxids: 0,
      scanned: 0,
      stopReason: "",
      unresolved: 0,
    },
  };
  const pendingWitnessOptions = {
    coreTip: replayCoreTip,
    declarationConfig: configuredV7,
    invalidLegacyMutationCount: 0,
    mempoolSnapshot: pendingMempool,
    nowMs: pendingNowMs,
    parity: pendingParity,
    projection: pendingProjection,
  };
  assert.equal(
    workerWorkPrecisionPendingWitnessReady(
      pendingWitness,
      pendingWitnessOptions,
    ),
    true,
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
      eventRows: [],
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
    pendingWorkMintResolvedInvalid: false,
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
    pendingWorkMintResolvedInvalid: false,
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
    true,
    "a whole-transaction terminal-invalid marker resolves a fully inspected multi-mint attempt",
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
