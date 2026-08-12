#!/usr/bin/env node

import { readFileSync } from "node:fs";
import "./check-work-amo-v8-gates.mjs";
import {
  workAmountUnitsForStorageModel,
  workBalanceProjection,
  workSupplyFieldsForStorageModel,
} from "../server/db/proof-index-reader.mjs";
import {
  workerWorkAmoV8DeclarationConfig,
  workerWorkPrecisionConfirmedReplayEnvelopeReady,
  workerWorkPrecisionCoreTipReady,
  workerWorkPrecisionPendingProjection,
  workerWorkPrecisionRelationalParity,
  workerWorkPrecisionSnapshotReady,
} from "./run-proof-indexer-worker.mjs";
import {
  workAmoV8DeclarationCommitment,
} from "../server/work-amo-v8-declaration.mjs";
import {
  configuredWorkPrecisionV2Pins,
} from "./migrate-work-precision-v2.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  workAmoV5CanonicalStateCommitment,
} from "../server/work-amo-v5.mjs";
import {
  WORK_AMO_V8_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
  workAmoV8CanonicalTokenStateCommitment,
} from "../server/work-amo-v8.mjs";
import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_PRECISION_V2_MODEL,
  WORK_PRECISION_V2_MIGRATION_META_KEY,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
} from "../server/work-units.mjs";

const server = readFileSync("server/proof-api.mjs", "utf8");
const reader = readFileSync("server/db/proof-index-reader.mjs", "utf8");
const backfill = readFileSync("scripts/backfill-proof-indexer.mjs", "utf8");
const worker = readFileSync("scripts/run-proof-indexer-worker.mjs", "utf8");
const marketplaceRegressions = readFileSync(
  "scripts/check-marketplace-regressions.mjs",
  "utf8",
);
const workAmoV5 = readFileSync("server/work-amo-v5.mjs", "utf8");
const workAmoV6 = readFileSync("server/work-amo-v6.mjs", "utf8");
const workAmoV6Migration = readFileSync(
  "scripts/migrate-work-amo-v6.mjs",
  "utf8",
);
const workAmoV6DeclarationBuilder = readFileSync(
  "scripts/build-work-amo-v6-declaration.mjs",
  "utf8",
);
const workAmoV8 = readFileSync("server/work-amo-v8.mjs", "utf8");
const workAmoV8WorkerReadiness = readFileSync(
  "server/work-amo-v8-worker-readiness.mjs",
  "utf8",
);
const workQ16PendingProjection = readFileSync(
  "server/work-q16-pending-projection.mjs",
  "utf8",
);
const workAmoV8Migration = readFileSync(
  "scripts/migrate-work-precision-v2.mjs",
  "utf8",
);
const workAmoV8DeclarationBuilder = readFileSync(
  "scripts/build-work-amo-v8-declaration.mjs",
  "utf8",
);
const workAmoV8Declaration = readFileSync(
  "server/work-amo-v8-declaration.mjs",
  "utf8",
);
const workUnits = readFileSync("server/work-units.mjs", "utf8");
const backfillQ16PendingWitness = sourceSliceBetween(
  backfill,
  /async function persistExactWorkQ16PendingWitness/,
  /async function storeMempoolScanState/,
);
const backfillMempoolScan = sourceSliceBetween(
  backfill,
  /async function backfillMempoolScanSource/,
  /async function backfillSource/,
);
const workerQ16PendingAudit = sourceSliceBetween(
  worker,
  /async function assertWorkPrecisionPendingReady/,
  /function endpoint/,
);
const readerPrecisionV2Readiness = sourceSliceBetween(
  reader,
  /export async function proofIndexWorkPrecisionV2MigrationReadiness/,
  /export async function proofIndexWorkAmoV8ActivationLatch/,
);
const workAmoV6IndexedDeclarationEvidence =
  /export async function indexedWorkAmoV6DeclarationEvidence[\s\S]*?(?=export async function coreWorkAmoV6DeclarationEvidence)/u.exec(
    workAmoV6Migration,
  )?.[0] ?? "";
const workAmoV6ReaderDeclarationEvidence =
  /function workAmoV6IndexedEvidenceMatchesMarker[\s\S]*?(?=function canonicalWorkPrecisionStateRows)/u.exec(
    reader,
  )?.[0] ?? "";
const proofIndexSchema = readFileSync(
  "server/sql/proof-indexer-v1.sql",
  "utf8",
);
const ledgerAudit = readFileSync(
  "scripts/audit-ledger-consistency.mjs",
  "utf8",
);
const ledgerAuditExact = readFileSync(
  "scripts/ledger-audit-exact.mjs",
  "utf8",
);
const service = readFileSync("deploy/proofofwork-api-proof-index.conf", "utf8");
const failures = [];
const readerPublicLogKinds =
  /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    reader,
  )?.[1] ?? "";
const backfillPublicLogKinds =
  /const PUBLIC_LOG_EVENT_KINDS = new Set\(\[([\s\S]*?)\]\);/u.exec(
    backfill,
  )?.[1] ?? "";
const normalizedQuotedItems = (value) =>
  [...String(value).matchAll(/"([^"]+)"/gu)]
    .map((match) => match[1])
    .sort()
    .join(",");
const workAmoV8Commitment = workAmoV8DeclarationCommitment();
const exactWorkAmoV8WorkerEnv = {
  WORK_AMO_V8_ACTIVATION_HEIGHT: "101",
  WORK_AMO_V8_DECLARATION_BLOCK_HASH: "b".repeat(64),
  WORK_AMO_V8_DECLARATION_BLOCK_INDEX: "0",
  WORK_AMO_V8_DECLARATION_HEIGHT: "100",
  WORK_AMO_V8_DECLARATION_MEMO_BYTES: String(
    workAmoV8Commitment.protocolRecordBytes,
  ),
  WORK_AMO_V8_DECLARATION_MEMO_SHA256:
    workAmoV8Commitment.protocolRecordSha256,
  WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT: "1",
  WORK_AMO_V8_DECLARATION_RECORD_ORDINAL: "0",
  WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT: "2",
  WORK_AMO_V8_DECLARATION_TXID: "a".repeat(64),
  WORK_AMO_V8_WRITES_ENABLED: "0",
};
const workPrecisionV2PinsReject = (env) => {
  try {
    configuredWorkPrecisionV2Pins(env, workAmoV8Commitment);
    return false;
  } catch {
    return true;
  }
};
const workerFixtureDeclarationHash = "d".repeat(64);
const workerFixtureTipHash = "e".repeat(64);
function apiTruthBoundaryFixture({ blockHash, blockHeight, previousBlockHash }) {
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
      sha256: "41".repeat(32),
    },
    idStateCommitment: {
      model: WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
      payloadBytes: 1,
      sha256: "42".repeat(32),
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
const workerFixtureActivationTransition = apiTruthBoundaryFixture({
  blockHash: "c".repeat(64),
  blockHeight: 101,
  previousBlockHash: workerFixtureDeclarationHash,
});
workerFixtureActivationTransition.payload = {
  ...workerFixtureActivationTransition.payload,
  activationHeight: 101,
  precisionMigrationMarkerKey: WORK_PRECISION_V2_MIGRATION_META_KEY,
  precisionOpeningTokenStateCommitment:
    workerFixtureActivationTransition.payload.openingSufficientState
      .tokenStateCommitment,
};
const workerFixtureOpeningCommitment =
  workerFixtureActivationTransition.payload
    .precisionOpeningTokenStateCommitment;
const workerFixtureLatestTransition = apiTruthBoundaryFixture({
  blockHash: workerFixtureTipHash,
  blockHeight: 102,
  previousBlockHash: workerFixtureActivationTransition.blockHash,
});
const workerFixtureSnapshot = {
  consistencyOk: true,
  consistencyStatus: "green",
  indexedThroughBlock: 102,
  payloadBlockHash: workerFixtureTipHash,
  sourceBlockHash: workerFixtureTipHash,
  summaryBlockHash: workerFixtureTipHash,
  summaryMode: "canonical-summary-refresh",
  tokenStatePayloads: {
    [WORK_TOKEN_ID]: {
      amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    },
  },
  workAmountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
};
const workerFixtureReplayEnvelope = {
  activationHeight: 101,
  activationTransition: workerFixtureActivationTransition,
  coreTip: {
    blockHash: workerFixtureTipHash,
    height: 102,
    stable: true,
  },
  declarationBlockHash: workerFixtureDeclarationHash,
  invalidPrecisionEventCount: 0,
  invalidTransitionCount: 0,
  latestTransition: workerFixtureLatestTransition,
  markerOpeningCommitment: workerFixtureOpeningCommitment,
  snapshot: workerFixtureSnapshot,
  tipHash: workerFixtureTipHash,
  tipHeight: 102,
  transitionCount: 2,
};
const workQ8PayloadMetadata = {
  amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
  decimals: WORK_DECIMALS,
  unitScale: WORK_UNIT_SCALE_TEXT,
};
const workQ16PayloadMetadata = {
  amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
  decimals: WORK_SUBATOM_DECIMALS,
  precisionModel: WORK_PRECISION_V2_MODEL,
  unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
};

function expect(name, condition) {
  if (!condition) {
    failures.push(name);
  }
}

function sliceBetween(startPattern, endPattern) {
  const start = server.search(startPattern);
  if (start < 0) {
    return "";
  }
  const rest = server.slice(start);
  const end = rest.search(endPattern);
  return end < 0 ? rest : rest.slice(0, end);
}

function sourceSliceBetween(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  if (start < 0) {
    return "";
  }
  const rest = text.slice(start);
  const end = rest.search(endPattern);
  return end < 0 ? rest : rest.slice(0, end);
}

const summaryRead = sliceBetween(
  /async function summaryCanonicalLedgerPayload/,
  /async function activityPayloadWithLiveWorkTokenOverlay/,
);
const freshSummaryRead = summaryRead.split('\n  if (network === "livenet")')[0];
const provenance = sliceBetween(
  /async function summaryPayloadWithCanonicalProvenance/,
  /function growthSummaryPayloadFromLedger/,
);
const compaction = sliceBetween(
  /function compactTokenSummaryPayload/,
  /function workTokenLiveSeenTxids/,
);
const publicGate = sliceBetween(
  /async function loadCanonicalPublicReadGate/,
  /async function canonicalPublicReadGate/,
);
const healthPayload = sliceBetween(
  /async function loadHealthPayload/,
  /let healthPayloadCache/,
);
const requestGate = sliceBetween(
  /const authenticatedLoopbackRead = internalVerifierRequestAllowed/,
  /if \(url\.pathname === "\/api\/v1\/internal\/token-verifier"\)/,
);
const logRoute = sliceBetween(
  /url\.pathname === "\/api\/v1\/activity" \|\| url\.pathname === "\/api\/v1\/log"/,
  /url\.pathname === "\/api\/v1\/activity-history"/,
);
const broadcastAdmission = sliceBetween(
  /function broadcastOriginAllowed/,
  /async function broadcastSlipstreamPayload/,
);
const requestBodyRead = sliceBetween(
  /function requestBodyReadError/,
  /function normalizeBroadcastTxid/,
);
const tokenReplay = sliceBetween(
  /function tokenStateFromTransactions/,
  /function workTransfersFromTransactions/,
);
const verifier = sliceBetween(
  /async function completeTokenVerifierState/,
  /async function completeIdVerifierStateBundle/,
);
const currentBlockInceptionDisposition = sliceBetween(
  /function currentBlockRejectedInceptionAttachmentDispositions/,
  /function tokenStateWithInceptionInvalidDispositions/,
);
const invalidOnlyInceptionResolution = sliceBetween(
  /function inceptionInvalidOnlyVerifierStateResolved/,
  /function canonicalItemPrecedesBondTransaction/,
);
const pendingWorkSupplyCapVerifier = sliceBetween(
  /function pendingWorkMintFromHydratedTransaction/,
  /async function tokenVerifierDeterministicInvalidReason/,
);
const workAmoBroadcastAdmission = sliceBetween(
  /function workAmoV8SignedMutationShape/,
  /async function broadcastSlipstreamPayload/,
);
const readerWorkMintStats = sourceSliceBetween(
  reader,
  /export async function proofIndexTokenMintStatsPayload/,
  /async function exactTokenMintHistoryPage/,
);
const readerWorkMintOverlay = sourceSliceBetween(
  reader,
  /async function tokenStateWithMintEventOverlay/,
  /async function filterClosedTokenListingHistoryPage/,
);
const readerWorkHolders = sourceSliceBetween(
  reader,
  /async function proofIndexTokenHoldersFromTables/,
  /function tokenMetricSummariesFromHolders/,
);
const readerWorkHolderSummaries = sourceSliceBetween(
  reader,
  /function tokenMetricSummariesFromHolders/,
  /function canonicalTokenSaleEvidenceForListing/,
);
const readerCurrentTokenPayload = sourceSliceBetween(
  reader,
  /async function proofIndexTokenPayloadFromCurrentTables/,
  /async function scopedHoldersFromBalances/,
);
const readerScopedWorkHolders = sourceSliceBetween(
  reader,
  /async function scopedHoldersFromBalances/,
  /async function scopedTokenStateFromAllPayload/,
);
const readerScopedTokenPayload = sourceSliceBetween(
  reader,
  /async function scopedTokenStateFromAllPayload/,
  /export async function proofIndexTokenPayload/,
);
const readerWalletTokenPayload = sourceSliceBetween(
  reader,
  /export async function proofIndexWalletTokenOverlayPayload/,
  /async function proofIndexScopedHolderHistoryPayload/,
);
const readerScopedHolderHistory = sourceSliceBetween(
  reader,
  /async function proofIndexScopedHolderHistoryPayload/,
  /async function confirmedIdRecordsFromCurrentTables/,
);
const readerCurrentWorkMintBranches = [
  ...readerCurrentTokenPayload.matchAll(
    /if \(isWorkTokenId\(mint\.tokenId\)\) \{([\s\S]*?)\n      \} else if/gu,
  ),
].map((match) => match[1]);
const readerMintOverlayExactWorkAggregation = sourceSliceBetween(
  readerWorkMintOverlay,
  /const confirmedWorkUnits = workScoped/,
  /const confirmedSupply = workSupply/,
);
const readerScopedExactWorkAggregation = sourceSliceBetween(
  readerScopedTokenPayload,
  /const confirmedWorkUnits = workScoped/,
  /const creationSats = tokens\.reduce/,
);
const stableCrossLedgerAudit = (() => {
  const start = ledgerAudit.indexOf("async function readStableCrossLedgerBatch");
  const end = ledgerAudit.indexOf("function isGullishBuyerTokenSale", start);
  return start < 0 ? "" : ledgerAudit.slice(start, end < 0 ? undefined : end);
})();

expect(
  "fresh canonical summaries require an exact-tip ledger",
  /exactTipLedgerPayloadOrNull/u.test(summaryRead) &&
    /Fresh canonical ledger is catching up/u.test(summaryRead),
);
expect(
  "fresh ledger token fallback starts from the exact relational token state",
  /async function ledgerTokenPayload[\s\S]*indexedTokenStateForCanonicalLedger\(network, scope\)[\s\S]*tokenStateWithLivePendingTransactionCheck\(indexedFallback, network\)[\s\S]*fastTokenPayloadSnapshot/u.test(
    server,
  ),
);
expect(
  "pending credit liveness only drops after affirmative Core absence proof",
  /async function tokenStateWithLivePendingTransactionCheck[\s\S]*bitcoinCoreTxStatusPayload\(txid, network\)[\s\S]*status\.absenceProven === true[\s\S]*pending-liveness-core-proof/u.test(
    server,
  ),
);
expect(
  "fresh canonical summaries do not return the finite stale fallback",
  !/return ledgerPayloadHasFiniteNetworkValues\(fallback\) \? fallback : null/u.test(
    freshSummaryRead,
  ),
);
expect(
  "summary responses expose one canonical provenance contract",
  /proof-of-work-canonical-summary-v1/u.test(provenance) &&
    /missingSnapshotIds\.length === 0 && snapshotIds\.length === 1/u.test(
      provenance,
    ) &&
    /verifiedSummaryPayloadCheckpoint/u.test(provenance) &&
    /served: ready \? "exact-tip" : "last-good"/u.test(provenance),
);
expect(
  "stable summaries also reject incoherent or unidentified snapshots",
  /if \(!coherent \|\| \(network === "livenet" && !snapshotId\)\)/u.test(
    provenance,
  ) && /CANONICAL_SUMMARY_INCOHERENT/u.test(provenance),
);
expect(
  "fresh summary provenance fails closed while catching up",
  /if \(requestedFresh && !ready\)/u.test(provenance) &&
    /CANONICAL_SUMMARY_CATCHING_UP/u.test(provenance),
);
expect(
  "truncated credit summaries preserve authoritative statistics",
  /const authoritativeStat/u.test(compaction) &&
    /preserveExistingTokenMetrics && existing !== undefined/u.test(
      compaction,
    ) &&
    /if \(!preserveExistingTokenMetrics\) \{[\s\S]*return computed/u.test(
      compaction,
    ) && /return null/u.test(compaction),
);
expect(
  "credit summaries expose collection totals and continuation state",
  /totalCounts/u.test(compaction) &&
    /collectionHasMore/u.test(compaction) &&
    /hasMore: Object\.values\(collectionHasMore\)\.some\(Boolean\)/u.test(
      compaction,
    ),
);
expect(
  "compact credit definitions expose authoritative per-token market totals",
  [
    "confirmedSales",
    "confirmedSalesVolumeSats",
    "pendingSales",
    "pendingSalesVolumeSats",
    "confirmedOpenListings",
    "pendingOpenListings",
  ].every((field) =>
    compaction.includes(`${field}: mergedTokenMarketMetric(`),
  ) &&
    /summaryCollectionIsTruncated/u.test(compaction) &&
    /preserveExistingTokenMetrics && truncated[\s\S]*return undefined/u.test(
      compaction,
    ),
);
expect(
  "marketplace mutation accounting follows unique transaction registry payments",
  /function marketplaceMutationPaymentIdentity/u.test(server) &&
    /function uniqueMarketplaceMutationActivity/u.test(server) &&
    /function marketplaceMutationPaymentFlowSats/u.test(server) &&
    /marketplaceMutationPaymentFlowSats\(selected, kinds\)/u.test(server),
);
expect(
  "proof-index value deltas verify and consolidate marketplace registry payments",
  /function proofIndexConfirmedValueEventDeltaFromRows/u.test(reader) &&
    /registryCandidatesByPayment/u.test(reader) &&
    /marketplace_payment_keys/u.test(reader) &&
    /proof_indexer\.tx_outputs/u.test(reader) &&
    /payment_verified/u.test(reader),
);
expect(
  "deep ledger audit requires atomic WORK amount strings",
  /function workAmountMatches[\s\S]*amountAtoms/u.test(ledgerAudit) &&
    /workAmountMatches\(item, "101000"\)/u.test(ledgerAudit) &&
    !/item\.amount === 101_000/u.test(ledgerAudit),
);
expect(
  "deep ledger audit includes the exact post-activation credit carry",
  /postActivationCreditFixedQ8/u.test(ledgerAuditExact) &&
    /postActivationCreditFixedSats/u.test(ledgerAuditExact) &&
    /legacyBootstrapCreditFixedSats \+[\s\S]*postActivationCreditFixedSats/u.test(
      ledgerAuditExact,
    ) &&
    /legacyBootstrapCreditFixedSats \+[\s\S]*postActivationCreditFixedSats/u.test(
      ledgerAudit,
    ) &&
    /q8FieldsAbsent &&[\s\S]*legacyFieldsAgree &&[\s\S]*postActivationFieldsAgree &&[\s\S]*numbersAgree/u.test(
      ledgerAudit,
    ),
);
expect(
  "stable canonical reads use a canonical checkpoint while exact-tip truth is independent of worker heartbeat health",
  /const available =/u.test(publicGate) &&
    /const atTip =[\s\S]*available &&[\s\S]*indexedThroughBlock === tipHeight/u.test(
      publicGate,
    ) &&
    /const ready =/u.test(publicGate) &&
    /atTip &&[\s\S]*workerReadiness\.ready === true/u.test(publicGate) &&
    /proofIndexWorkerExactTipReadiness\(status/u.test(publicGate) &&
    /exactCoreTipFromBlockchainInfo\(tipResponse\)/u.test(publicGate) &&
    /indexedThroughBlock <= tipHeight/u.test(publicGate),
);
expect(
  "whole-index health degrades on any unresolved observed pending protocol event without disabling canonical availability",
  /const pendingHealthEnvelope = workerReadiness\.q16Required[\s\S]*database\?\.worker\?\.lastSuccess[\s\S]*const pendingEventHealth =[\s\S]*const pendingStatus =/u.test(
    healthPayload,
  ) &&
    /bounded-best-effort-pending-event-health-v1[\s\S]*pendingGlobalUnresolved === 0[\s\S]*pendingQ16Unresolved === 0[\s\S]*pendingEventHealth\?\.ok === true/u.test(
      healthPayload,
    ) &&
    /const pendingEventHealthRequired = workerReadiness\.q16Required/u.test(
      healthPayload,
    ) &&
    /const pendingStatusOk =[\s\S]*Number\.isSafeInteger\(pendingStatusErrors\)[\s\S]*pendingStatusErrors === 0[\s\S]*pendingStatusUnavailableValid/u.test(
      healthPayload,
    ) &&
    /const pendingAccuracyOk = pendingEventHealthOk && pendingStatusOk/u.test(
      healthPayload,
    ) &&
    /const indexOk =[\s\S]*workerOk &&[\s\S]*pendingAccuracyOk &&[\s\S]*const indexAvailable =[\s\S]*canonicalStateOk &&[\s\S]*readModelsOk;/u.test(
      healthPayload,
    ) &&
    !/const indexAvailable =[\s\S]*pendingAccuracyOk/u.test(
      healthPayload.slice(
        healthPayload.indexOf("const indexAvailable ="),
        healthPayload.indexOf("const diskOk ="),
      ),
    ) &&
    /pendingEvents: \{[\s\S]*globalUnresolved:[\s\S]*q16PendingUnresolved:[\s\S]*required: pendingEventHealthRequired[\s\S]*status: \{[\s\S]*errors:[\s\S]*unavailable:/u.test(
      healthPayload,
    ),
);
expect(
  "node health requires synced unpruned mainnet Core with exact-tip txindex",
  /function exactCoreTipFromBlockchainInfo[\s\S]*info\?\.chain !== "main"[\s\S]*initialblockdownload !== false[\s\S]*headers !== height[\s\S]*verificationProgress < 0\.999/u.test(
    server,
  ) &&
    /function exactCoreNodeAuthority[\s\S]*chain\?\.pruned !== false[\s\S]*txindex\.synced !== true[\s\S]*txindexHeight !== tip\.height/u.test(
      server,
    ) &&
    /bitcoinRpc\("getindexinfo", \["txindex"\]\)/u.test(healthPayload) &&
    /const available =[\s\S]*coreAuthority !== null/u.test(healthPayload) &&
    /ok: coreAuthority !== null/u.test(healthPayload),
);
expect(
  "block-scan selectors cannot mistake canonical summary rows for checkpoints",
  (reader.match(/AND NOT \(source_hashes \? 'canonicalSummary'\)/gu) ?? [])
    .length >= 5,
);
expect(
  "fresh reads require canonical exact-tip truth without treating a stale worker heartbeat as chain lag",
  /if \(freshRead && gate\.atTip !== true\)/u.test(requestGate) &&
    !/if \(freshRead && gate\.ready !== true\)/u.test(requestGate) &&
    /CANONICAL_INDEX_CATCHING_UP/u.test(requestGate),
);
expect(
  "fresh paginated Log reads use relational state bound to the exact summary",
  /"limit"/u.test(logRoute) &&
    /"offset"/u.test(logRoute) &&
    /freshRead && !exactLogQueryTxid[\s\S]*freshProofIndexLogHistoryPayload/u.test(
      logRoute,
    ) &&
    /exactLogHistoryMissPayload/u.test(logRoute) &&
    /if \(exactLogQueryTxid\)[\s\S]*indexed exact Log lookup is temporarily unavailable/u.test(
      logRoute,
    ) &&
    /activityHistoryPayload/u.test(logRoute) &&
    /pageSnapshotTotal !== summaryTotal/u.test(server) &&
    /boundSearchParams\.set\("snapshot", summarySnapshotId\)/u.test(
      server,
    ) &&
    /e\.status = 'confirmed'[\s\S]*e\.updated_at <= \$\{snapshotTimeParam\}::timestamptz[\s\S]*e\.status = 'pending'[\s\S]*e\.created_at <= \$\{snapshotTimeParam\}::timestamptz/u.test(
      reader,
    ) &&
    /snapshotTotalCount/u.test(reader) &&
    /offsetRaw[\s\S]*transactionId/u.test(server) &&
    /offsetRaw[\s\S]*transactionId/u.test(reader),
);
expect(
  "fresh full Log reads use canonical transaction truth bound to the exact summary",
  /async function freshProofIndexLogPayload/u.test(server) &&
    /proofIndexCanonicalActivityPayload\(network, \{[\s\S]*snapshotId: summarySnapshotId/u.test(
      server,
    ) &&
    /pageSnapshotTotal !== summaryTotal/u.test(server) &&
    /activity\.length !== summaryTotal/u.test(server) &&
    /pagePending !== summaryPending/u.test(server) &&
    /verifiedCanonicalMinerFeeCoverage/u.test(server) &&
    /verifiedFreshLogCheckpointAfterRead\(summary, network, "log"\)/u.test(
      server,
    ) &&
    /await freshProofIndexLogPayload\(network\)/u.test(logRoute) &&
    /e\.status = 'confirmed'[\s\S]*e\.updated_at <= \$4::timestamptz[\s\S]*e\.status = 'pending'[\s\S]*e\.created_at <= \$4::timestamptz/u.test(
      reader,
    ) &&
    /snapshotTotalCount: requestedSnapshotId \? items\.length/u.test(reader),
);
expect(
  "fresh standalone Log history uses the same exact-summary relational gate",
  (server.match(/freshRead && !exactLogQueryTxid/gu) ?? []).length >= 2 &&
    (server.match(/\? await freshProofIndexLogHistoryPayload/gu) ?? [])
      .length >= 2 &&
    /network === "livenet" \|\|[\s\S]*logHistoryEligibility\.eligible \|\|[\s\S]*freshRead && !exactLogQueryTxid/u.test(
      server,
    ) &&
    /verifiedFreshLogCheckpointAfterRead\([\s\S]*"log-history"/u.test(
      server,
    ) &&
    /CANONICAL_LOG_HISTORY_TIP_CHANGED/u.test(server),
);
expect(
  "stable Log and consistency reads expose only one hash-bound last-good snapshot",
  /async function stableProofIndexLogPayload[\s\S]*stableCanonicalLogSummaryPayload\(network, "Log"\)[\s\S]*proofIndexCanonicalActivityPayload\(network, \{[\s\S]*snapshotId: summarySnapshotId/u.test(
    server,
  ) &&
    /async function stableProofIndexLogHistoryPayload[\s\S]*boundSearchParams\.set\("snapshot", summarySnapshotId\)[\s\S]*proofIndexLogHistoryPayload\([\s\S]*\{\s*currentRelational:\s*true\s*\}/u.test(
      server,
    ) &&
    /async function stableProofIndexLogHistoryPayload[\s\S]*proofIndexCanonicalActivityPayload\(network, \{[\s\S]*eventIds: pageEventIds,[\s\S]*snapshotId: summarySnapshotId/u.test(
      server,
    ) &&
    /canonicalPage\?\.membershipRestricted !== true/u.test(server) &&
    /e\.event_id = ANY\(\$\{eventIdsParam\}::bigint\[\]\)/u.test(reader) &&
    /transaction_row\.updated_at <= \$\{snapshotTimeParam\}::timestamptz/u.test(
      reader,
    ) &&
    /terminal_tx\.updated_at <= \$5::timestamptz/u.test(reader) &&
    /candidate\.block_height = terminal_tx\.block_height/u.test(reader) &&
    /candidate\.status = 'pending'[\s\S]*terminal_tx\.status <> 'confirmed'/u.test(
      reader,
    ) &&
    /CANONICAL_LOG_EXACT_QUERY_OUTSIDE_SNAPSHOT/u.test(server) &&
    /CANONICAL_LOG_EXACT_QUERY_NOT_IN_SNAPSHOT/u.test(server) &&
    /async function ledgerConsistencyPayload[\s\S]*if \(!fresh\)[\s\S]*activitySummaryPayload\(network, false\)[\s\S]*proofIndexCanonicalSummaryLedgerPayload\([\s\S]*summaryHeight,[\s\S]*summaryHash/u.test(
      server,
    ) &&
    /verifyStableLogCheckpointAfterRead\([\s\S]*summary,[\s\S]*network,[\s\S]*"ledger-consistency"/u.test(
      server,
    ) &&
    /surface: "ledger-consistency"/u.test(server),
);
expect(
  "Core and Electrum pending reads preserve Bitcoin Core mempool admission time",
  (server.match(/bitcoinRpc\("getmempoolentry"/gu) ?? []).length >= 2 &&
    (server.match(/mempool_time: mempoolTime/gu) ?? []).length >= 2,
);
expect(
  "transaction status requires authoritative v2 evidence and never maps dependency failure to dropped",
  /async function bitcoinCoreTxStatusPayload/u.test(server) &&
    /proof-of-work-tx-status-v2/u.test(server) &&
    /TX_STATUS_UNAVAILABLE/u.test(server) &&
    /absenceProven: true/u.test(server) &&
    /bitcoinRpc\("getindexinfo", \["txindex"\]\)/u.test(server) &&
    /chain\.chain !== "main"/u.test(server) &&
    /txindex\.synced !== true/u.test(server) &&
    /bitcoinRpc\("getblockhash"/u.test(server) &&
    /bitcoinRpc\("getblock"/u.test(server) &&
    /canonical_scan_proof/u.test(reader),
);
expect(
  "historical dropped mail witnesses are transaction-gated and sender-only",
  /HISTORICAL_DROPPED_MAIL_OUTBOX_WITNESSES[\s\S]*8e9074486fa0a6a75fd01f20c8a41a56ccd964be569e61e81e92c60266c001f0[\s\S]*1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH/u.test(
    reader,
  ) &&
    /function historicalDroppedMailOutboxWitnessesForAddress[\s\S]*normalizedAddressKey\(witness\.senderAddress\) === targetKey/u.test(
      reader,
    ) &&
    /SELECT txid, first_seen_at, last_seen_at, dropped_at[\s\S]*FROM proof_indexer\.transactions[\s\S]*AND status = 'dropped'/u.test(
      reader,
    ) &&
    /droppedMailOutboxWitnessMessage[\s\S]*status: "dropped"[\s\S]*proof-indexer-mail\+historical-dropped-mail-witness[\s\S]*droppedOutboxWitnesses/u.test(
      reader,
    ),
);
expect(
  "worker status transitions are locked, evidence-gated, and canonical promotions are deferred",
  /const PENDING_DROP_CONFIRMATION_MS = pendingDropConfirmationMs\(\s*process\.env\.POW_INDEX_PENDING_DROP_CONFIRMATION_MS/u.test(
    worker,
  ) &&
    /function pendingDropConfirmationMs[\s\S]*Math\.max\(\s*5 \* 60_000,[\s\S]*Number\.isFinite\(configured\)/u.test(
      worker,
    ) &&
    /function authoritativeDroppedStatusEvidence[\s\S]*sources\.length === requiredSources\.length[\s\S]*requiredSources\.every/u.test(
      worker,
    ) &&
    [
      "absent-from-synced-unpruned-mainnet-bitcoin-core-txindex-and-mempool",
      "bitcoin-core:getrawtransaction",
      "bitcoin-core:getmempoolentry",
      "bitcoin-core:getblockchaininfo",
      "bitcoin-core:getindexinfo:txindex",
    ].every((value) => worker.includes(value)) &&
    /SELECT status, raw_tx[\s\S]*FOR UPDATE/u.test(worker) &&
    /WHERE network = \$1 AND txid = \$2 AND status = 'pending'/u.test(worker) &&
    /canonical-block-scan-required/u.test(worker) &&
    /repeat-absence-required/u.test(worker) &&
    /priorObservation\?\.absenceStartedAt \?\? ""/u.test(
      worker,
    ) &&
    /evidence\.absenceStartedAt = new Date\(absenceStartedAtMs\)\.toISOString\(\)/u.test(
      worker,
    ) &&
    /observedAtMs >= absenceStartedAtMs \+ PENDING_DROP_CONFIRMATION_MS/u.test(
      worker,
    ) &&
    /normalizedStatus === "confirmed"[\s\S]*statusObservation[\s\S]*canonical-block-scan-required/u.test(
      worker,
    ) &&
    /absenceProven:[\s\S]*normalizedStatus === "dropped" \? payload\.absenceProven : undefined/u.test(
      worker,
    ) &&
    /priorObservation\?\.status === "dropped" &&[\s\S]*authoritativeDroppedStatusEvidence\(priorObservation\)/u.test(
      worker,
    ) &&
    (worker.match(/'dropped', true/gu) ?? []).length >= 2 &&
    (worker.match(
      /UPDATE proof_indexer\.mail_items mail[\s\S]*?status = event\.status,[\s\S]*?event_time = event\.event_time,[\s\S]*?message = event\.payload[\s\S]*?FROM proof_indexer\.events event/gu,
    ) ?? []).length >= 2 &&
    /block_hash = NULL/u.test(worker) &&
    !/SET status = 'dropped'[\s\S]*\(listing_id = \$2 OR seal_txid = \$2 OR close_txid = \$2\)/u.test(
      worker,
    ),
);
expect(
  "dropped token definitions cannot remain in current token state",
  (reader.match(
    /definition_transaction\.status IN \('confirmed', 'pending'\)/gu,
  ) ?? []).length >= 2 &&
    (reader.match(/metadata->>'canonicalSynthetic' = 'true'/gu) ?? [])
      .length >= 2,
);
expect(
  "same-height pending Log membership versions the canonical summary",
  normalizedQuotedItems(backfillPublicLogKinds) ===
    normalizedQuotedItems(readerPublicLogKinds) &&
    /async function publicLogRelationalFingerprint/u.test(backfill) &&
    /publicLogFingerprintsMatch\([\s\S]*currentPublicLogFingerprint[\s\S]*previousPublicLogFingerprint/u.test(
      backfill,
    ) &&
    /publicLogRelational: finalPublicLogFingerprint\.hash/u.test(backfill) &&
    /publicLogFingerprint: finalPublicLogFingerprint/u.test(backfill) &&
    /runCanonicalBeforePending\([\s\S]*runBackfillPhase\(backfillPhases\[0\]\)[\s\S]*pendingStatus = await refreshPendingStatusesSafely\(\);[\s\S]*runBackfillPhase\(backfillPhases\[1\]\)/u.test(
      worker,
    ) &&
    !/async \(\) => \{\s*await runBackfillPhase\(backfillPhases\[1\]\);\s*pendingStatus = await refreshPendingStatusesSafely\(\);/u.test(
      worker,
    ),
);
expect(
  "rebroadcasts and dropped listing actions cannot retain stale terminal state",
  /dropped_at = CASE[\s\S]*EXCLUDED\.status IN \('pending', 'confirmed'\)[\s\S]*THEN NULL/u.test(
    backfill,
  ) &&
    /- 'statusObservation'/u.test(backfill) &&
    /WITH affected AS[\s\S]*base_event\.payload AS base_payload/u.test(
      worker,
    ) &&
    /buyer_address = NULL/u.test(worker) &&
    /- 'closeTxid'[\s\S]*- 'closedTxid'[\s\S]*- 'buyerAddress'/u.test(
      worker,
    ),
);
expect(
  "event block heights are inserted with an explicit integer parameter type",
  /CASE WHEN \$3 = 'confirmed' THEN \$5::integer ELSE NULL END/u.test(
    backfill,
  ),
);
expect(
  "browser broadcast origins are validated",
  /hostname\.endsWith\("\.proofofwork\.me"\)/u.test(broadcastAdmission) &&
    /BROADCAST_ORIGIN_REJECTED/u.test(broadcastAdmission) &&
    /return BROADCAST_ALLOW_MISSING_ORIGIN/u.test(broadcastAdmission),
);
expect(
  "broadcast has per-client, global, and concurrency limits",
  /BROADCAST_CLIENT_RATE_LIMIT/u.test(broadcastAdmission) &&
    /BROADCAST_GLOBAL_RATE_LIMIT/u.test(broadcastAdmission) &&
    /BROADCAST_CONCURRENCY_LIMIT/u.test(broadcastAdmission),
);
expect(
  "livenet broadcast requires an exact-tip verified canonical gate",
  /canonicalPublicReadGate\(network, \{ force: true \}\)/u.test(
    broadcastAdmission,
  ) &&
    /beforeSubmit/u.test(broadcastAdmission) &&
    /BROADCAST_CANONICAL_CHECKPOINT_CHANGED/u.test(broadcastAdmission),
);
expect(
  "broadcast uploads and HTTP request intake have explicit deadlines",
  /REQUEST_BODY_TIMEOUT/u.test(requestBodyRead) &&
    /clearTimeout\(timer\)/u.test(requestBodyRead) &&
    /request\.off\("data", onData\)/u.test(requestBodyRead) &&
    /request\.destroy\(\)/u.test(requestBodyRead) &&
    /timeoutMs: BROADCAST_BODY_TIMEOUT_MS/u.test(server) &&
    /server\.headersTimeout = HTTP_HEADERS_TIMEOUT_MS/u.test(server) &&
    /server\.requestTimeout = HTTP_REQUEST_TIMEOUT_MS/u.test(server) &&
    [
      "POW_API_BROADCAST_BODY_TIMEOUT_MS=10000",
      "POW_API_HEADERS_TIMEOUT_MS=10000",
      "POW_API_REQUEST_TIMEOUT_MS=30000",
    ].every((setting) => service.includes(setting)),
);
expect(
  "proof-index API service confinement is self-contained",
  [
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    "UMask=0027",
  ].every((setting) => service.includes(setting)),
);
expect(
  "generic credit mints reject reserved bond assets",
  /BOND_TOKEN_IDS\.has\(parsed\.tokenId\)/u.test(tokenReplay),
);
expect(
  "generic credit mints require their definition to precede the event",
  /tokenDefinitionPrecedesTransaction\(mintedToken, tx\)/u.test(tokenReplay),
);
expect(
  "the ordered verifier seeds every configured bond family",
  /for \(const config of BOND_TOKEN_CONFIGS\)/u.test(verifier) &&
    /bondMintsFromActivity/u.test(verifier),
);
expect(
  "current-block Inception rejection requires exact bond provenance and an explicit WORK replay rejection",
  /currentBlockHash/u.test(currentBlockInceptionDisposition) &&
    /sourceKind/u.test(currentBlockInceptionDisposition) &&
    /bondBlockIndex !== seedBlockIndex/u.test(currentBlockInceptionDisposition) &&
    /insufficient-spendable-balance/u.test(currentBlockInceptionDisposition) &&
    /attemptedAtoms/u.test(currentBlockInceptionDisposition),
);
expect(
  "zero-mint Inception verification is bound to the exact target and canonical block",
  /normalizedTargetTxid[\s\S]*sourceBondTxid[\s\S]*verifierBlockHash/u.test(
    invalidOnlyInceptionResolution,
  ) && /inceptionInvalidOnlyVerifierStateResolved/u.test(verifier),
);
expect(
  "pending WORK supply-cap classification is Core-current and exact-tip indexed",
  /network !== "livenet"[\s\S]*tokenScope !== WORK_TOKEN_ID/u.test(
    pendingWorkSupplyCapVerifier,
  ) &&
    /fetchTransactionFromBitcoinRpc[\s\S]*requireCanonicalPrevouts: true[\s\S]*getmempoolentry/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /inputAddresses\(vin\)\[0\][\s\S]*isValidBitcoinAddress\(actorAddress, network\)/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /proofIndexExactlyCoversCoreTip/u.test(pendingWorkSupplyCapVerifier) &&
    /!\[0, 1\]\.includes\(targetPendingMints\)/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /candidate\.txid !== normalizedTxid/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /pendingCandidatesComplete !== true/u.test(pendingWorkSupplyCapVerifier) &&
    /compareCanonicalUtf8\([\s\S]*candidate\.txid,[\s\S]*normalizedTargetTxid,[\s\S]*\) >= 0/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    (pendingWorkSupplyCapVerifier.match(
      /proofIndexTokenMintStatsPayload\(/gu,
    ) ?? []).length === 2 &&
    /validatedWitnessSupply !== witnessProof\.witnessSupply/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /finalMempoolMembership\.some\(\(present\) => present !== true\)/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /finalWitnessProof\.witnesses\.some/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    /finalSupply\.targetPendingMints !== supply\.targetPendingMints/u.test(
      pendingWorkSupplyCapVerifier,
    ) &&
    !/supply\.acceptedSupply/u.test(pendingWorkSupplyCapVerifier) &&
    /proof-indexer-pending-work-supply-cap-verifier/u.test(
      pendingWorkSupplyCapVerifier,
    ),
);
expect(
  "ledger audit retries only classified canonical read failures inside one shared bounded budget",
  /createCanonicalConvergenceBudget/u.test(ledgerAudit) &&
    /MarketplaceRegressionHttpError/u.test(ledgerAudit) &&
    /waitForCanonicalConvergenceWithinBudget/u.test(ledgerAudit) &&
    /LEDGER_AUDIT_CANONICAL_CONVERGENCE_MAX_MS/u.test(ledgerAudit) &&
    /ledgerAuditCanonicalConvergenceBudget/u.test(ledgerAudit) &&
    /throw new MarketplaceRegressionHttpError\(/u.test(ledgerAudit) &&
    /isReady: \(\) => true/u.test(ledgerAudit) &&
    /isRetryableValue: \(\) => false/u.test(ledgerAudit),
);
expect(
  "ledger audit accepts only exact historical Q8 or metadata-bound current Q16 WORK amounts",
  /parseWorkAmountToAtoms/u.test(ledgerAudit) &&
    /parseWorkAmountToSubatoms/u.test(ledgerAudit) &&
    /const q8Historical =/u.test(ledgerAudit) &&
    /const q16Current =/u.test(ledgerAudit) &&
    /!hasAmountAtoms/u.test(ledgerAudit) &&
    /!hasAmountSubatoms/u.test(ledgerAudit) &&
    /amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL/u.test(ledgerAudit) &&
    /Number\(record\?\.decimals\) === WORK_SUBATOM_DECIMALS/u.test(
      ledgerAudit,
    ) &&
    /String\(record\?\.unitScale \?\? ""\) === WORK_SUBATOM_UNIT_SCALE_TEXT/u.test(
      ledgerAudit,
    ),
);
expect(
  "ledger audit brackets fresh cross-ledger reads with stable sentinels",
  /CROSS_LEDGER_AUDIT_MAX_ATTEMPTS = 3/u.test(ledgerAudit) &&
    (stableCrossLedgerAudit.match(
      /readJson\(\s*"\/api\/v1\/work-floor\?fresh=1"/gu,
    ) ?? []).length === 2 &&
    [
      '"/api/v1/consistency"',
      '"/api/v1/marketplace-summary?fresh=1"',
      '"/api/v1/infinity-summary?fresh=1"',
      '"/api/v1/inception-summary?fresh=1"',
      '"/api/v1/growth-summary?fresh=1"',
      "`/api/v1/token?asset=${POWB_TOKEN_ID}&fresh=1`",
      "`/api/v1/token?asset=${INCB_TOKEN_ID}&fresh=1`",
    ].every((path) => stableCrossLedgerAudit.includes(path)) &&
    /if \(snapshotSentinelsMatch\(before, after\)\) \{[\s\S]*return \{/u.test(
      stableCrossLedgerAudit,
    ) &&
    /payloadMatchesAuditSentinel\(payload, after, false\)/u.test(
      stableCrossLedgerAudit,
    ) &&
    /cross-ledger payloads diverged inside one stable canonical snapshot/u.test(
      stableCrossLedgerAudit,
    ) &&
    (stableCrossLedgerAudit.match(/\bcontinue;/gu) ?? []).length === 1 &&
    /if \(attempt < CROSS_LEDGER_AUDIT_MAX_ATTEMPTS\)[\s\S]*continue;/u.test(
      stableCrossLedgerAudit,
    ),
);
expect(
  "WORK pending cap ordering matches canonical pending transaction replay",
  /function sortWorkMintsForPendingCap[\s\S]*compareCanonicalUtf8\(left\.txid, right\.txid\)[\s\S]*Date\.parse\(left\.createdAt\)/u.test(
    server,
  ),
);
expect(
  "live USD remains derived from actual total proofs",
  /const liveTotalUsd =[\s\S]*?satsToUsdAtBtcUsd\(\s*correctedNetworkValueSats,\s*btcUsdMetadata\.btcUsd\s*\)/u.test(
    server,
  ) &&
    /totalUsd: liveTotalUsd/u.test(server),
);
expect(
  "historical AMO V5 replay pins the confirmed corrective declaration and exact faces",
  /WORK_AMO_V5_AUTH_VERSION = "pwt-sale-v5"/u.test(workAmoV5) &&
    /54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36/u.test(
      workAmoV5,
    ) &&
    /WORK_AMO_V5_ACTIVATION_HEIGHT = 959_621/u.test(workAmoV5) &&
    /WORK_AMO_V5_DECLARATION_BLOCK_INDEX = 141/u.test(workAmoV5) &&
    /2_000,\s*5_000,\s*10_000/u.test(workAmoV5),
);
expect(
  "historical AMO V5 replay uses full canonical positions and integer-only unit math",
  /blockHeight[\s\S]*blockTransactionIndex[\s\S]*protocolVout[\s\S]*recordOrdinal/u.test(
    workAmoV5,
  ) &&
    /workAmoCeilDiv/u.test(workAmoV5) &&
    /workAmoFloorDiv/u.test(workAmoV5) &&
    /targetNumerator[\s\S]*targetDenominator[\s\S]*unitAmountAtoms[\s\S]*unitMinimumPriceSats/u.test(
      workAmoV5,
    ) &&
    /workAmoV5FrozenTermsMatch/u.test(workAmoV5),
);
expect(
  "historical AMO V5 API admission remains independently pinned and fail closed",
  /WORK_AMO_V5_DECLARATION_PINS_CONFIGURED/u.test(server) &&
    /WORK_AMO_V5_WRITES_CONFIGURED/u.test(server) &&
    /proofIndexWorkAmoReplayReadiness/u.test(server) &&
    /proofIndexWorkUsdQuoteHead/u.test(server) &&
    /workAmoV5BroadcastDecision/u.test(server) &&
    /WORK_AMO_V5_WRITES_PAUSED/u.test(server) &&
    /listingFrozenTerms/u.test(server),
);
expect(
  "historical AMO V5 read caching preserves fresh negative checks and exact-tip positive reuse",
  /function reusableWorkAmoV5StatusCache\([\s\S]*cache\.payload\.indexReady === true[\s\S]*Number\(cache\.expiresAt\) > now/u.test(
    server,
  ) &&
    /reusableWorkAmoV5StatusCache\(workAmoV5StatusCache/u.test(server) &&
    /proofIndexWorkAmoReplayReadiness\(network,\s*\{[\s\S]*force,[\s\S]*throughBlockHash: tipHash/u.test(
      server,
    ),
);
expect(
  "historical AMO V5 production gate remains closed",
  /Environment=WORK_AMO_V5_DECLARATION_TXID=54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36/u.test(
    service,
  ) &&
    /Environment=WORK_AMO_V5_DECLARATION_HEIGHT=959620/u.test(service) &&
    /Environment=WORK_AMO_V5_DECLARATION_BLOCK_INDEX=141/u.test(service) &&
    /Environment=WORK_AMO_V5_WRITES_ENABLED=0/u.test(service),
);
expect(
  "historical AMO V5 index schema persists positions, quotes, and frozen terms",
  /block_index\s+integer/iu.test(proofIndexSchema) &&
    /record_ordinal\s+integer/iu.test(proofIndexSchema) &&
    /work_usd_quotes/iu.test(proofIndexSchema) &&
    /work_amo_listing_terms/iu.test(proofIndexSchema) &&
    /op_return_vout/iu.test(proofIndexSchema),
);
expect(
  "historical AMO V5 indexer recognizes quote records and reader exposes readiness",
  /pwa1:/u.test(backfill) &&
    /proofIndexWorkAmoV5Declaration/u.test(reader) &&
    /proofIndexWorkUsdQuoteHead/u.test(reader) &&
    /proofIndexWorkAmoListingTerms/u.test(reader) &&
    /proofIndexWorkAmoReplayReadiness/u.test(reader),
);
expect(
  "AMO V6 owns current writes with proof-native faces and one exact readiness gate",
  /WORK_AMO_V6_AUTH_VERSION = "pwt-sale-v6"/u.test(workAmoV6) &&
    /WORK_AMO_V6_UNIT_MODEL =\s*"canonical-work-amo-proof-unit-v1"/u.test(
      workAmoV6,
    ) &&
    /WORK_AMO_V6_ALLOWED_FACE_PROOFS = Object\.freeze\(\[\s*20_000,\s*50_000,\s*100_000,\s*\]\)/u.test(
      workAmoV6,
    ) &&
    /export function workAmoV6UnitTerms\(\{[\s\S]*networkValueBeforeQ8,[\s\S]*unitFaceProofs,[\s\S]*unitPriceSats = BigInt\(face\)[\s\S]*unitAmountAtoms = workAmoFloorDiv\([\s\S]*unitPriceSats \* denominator,[\s\S]*networkValue,[\s\S]*unitMinimumPriceSats = workAmoCeilDiv\([\s\S]*unitAmountAtoms \* networkValue,[\s\S]*denominator/u.test(
      workAmoV6,
    ) &&
    /function workAmoV6StatusFromEvidence[\s\S]*settlementWritesEnabled =\s*ready && protocolWritesEnabled === true[\s\S]*listingWritesEnabled = settlementWritesEnabled/u.test(
      workAmoV6,
    ) &&
    /if \(metadata\?\.protocolWritesEnabled !== true\)[\s\S]*if \(actionName === "list5"\)[\s\S]*metadata\?\.listingWritesEnabled !== true/u.test(
      workAmoV6,
    ) &&
    /validateWorkAmoV6SealOrBuyTerms\([\s\S]*legacyValidation/u.test(
      workAmoV6,
    ) &&
    /actionAuthorization: action\.saleAuthorization/u.test(workAmoV6) &&
    /legacyValidation: \(\{[\s\S]*actionAuthorization,[\s\S]*validateWorkAmoV5ReferencedAuthorization\(\s*actionAuthorization,/u.test(
      server,
    ),
);
expect(
  "AMO V6 signable authorization is proof-native and rejects every derived or USD field",
  /WORK_AMO_V6_STATIC_AUTHORIZATION_FIELDS = Object\.freeze\(\[[\s\S]*"unitFaceProofs"[\s\S]*\]\)/u.test(
    workAmoV6,
  ) &&
    /const V6_DERIVED_AUTHORIZATION_FIELDS = Object\.freeze\(\[[\s\S]*"unitFaceUsd"[\s\S]*"unitUsdAttestation"[\s\S]*\]\)/u.test(
      workAmoV6,
    ) &&
    /V6_DERIVED_AUTHORIZATION_FIELDS\.some\([\s\S]*work-amo-v6-derived-fields-not-signable/u.test(
      workAmoV6,
    ),
);
expect(
  "AMO V6 API pins every declaration coordinate and exposes deterministic proof estimates only",
  /WORK_AMO_V6_DECLARATION_PINS_CONFIGURED[\s\S]*WORK_AMO_V6_DECLARATION_TXID[\s\S]*WORK_AMO_V6_DECLARATION_HEIGHT[\s\S]*WORK_AMO_V6_DECLARATION_BLOCK_HASH[\s\S]*WORK_AMO_V6_DECLARATION_BLOCK_INDEX[\s\S]*WORK_AMO_V6_DECLARATION_MEMO_SHA256[\s\S]*WORK_AMO_V6_DECLARATION_MEMO_BYTES[\s\S]*WORK_AMO_V6_DECLARATION_PROTOCOL_VOUT[\s\S]*WORK_AMO_V6_DECLARATION_RECORD_ORDINAL[\s\S]*WORK_AMO_V6_DECLARATION_REGISTRY_PAYMENT_VOUT/u.test(
    server,
  ) &&
    /WORK_AMO_V6_ACTIVATION_HEIGHT =[\s\S]*WORK_AMO_V6_DECLARATION_HEIGHT \+ 1/u.test(
      server,
    ) &&
    /Number\.isSafeInteger\(WORK_AMO_V6_DECLARATION_RECORD_ORDINAL\) &&\s*WORK_AMO_V6_DECLARATION_RECORD_ORDINAL === 0/u.test(
      server,
    ) &&
    /function workAmoV6Estimates\(networkValueBeforeQ8\)[\s\S]*WORK_AMO_V6_ALLOWED_FACE_PROOFS\.flatMap\([\s\S]*workAmoV6UnitTerms\(\{[\s\S]*unitFaceProofs/u.test(
      server,
    ) &&
    !/\/api\/v1\/work-amo-v6\/attestation/u.test(server) &&
    /process\.stdout\.write\(declaration\.text\);/u.test(
      workAmoV6DeclarationBuilder,
    ) &&
    !/process\.stdout\.write\(`\$\{declaration\.text\}\\n`\)/u.test(
      workAmoV6DeclarationBuilder,
    ),
);
expect(
  "AMO V6 remains exactly pinned for replay and write-closed after the V8 boundary without an oracle credential",
  [
      "TXID",
      "HEIGHT",
      "BLOCK_HASH",
      "BLOCK_INDEX",
      "MEMO_SHA256",
      "MEMO_BYTES",
      "PROTOCOL_VOUT",
      "RECORD_ORDINAL",
      "REGISTRY_PAYMENT_VOUT",
    ].every((field) =>
      new RegExp(
        `Environment=WORK_AMO_V6_DECLARATION_${field}=${{
          TXID: "975fd82aa84995e014b240618ee1a1254d0a735e6e1241372d0bed0a0d9f0799",
          HEIGHT: "960218",
          BLOCK_HASH:
            "00000000000000000001ac35a5b7e43c782297fcb9cde0fb458fbd5451ad55df",
          BLOCK_INDEX: "102",
          MEMO_SHA256:
            "b43daeea38fcacaf6afa6a48d3d0fde631497a4af9f3bb137fc07975d18bbe01",
          MEMO_BYTES: "3350",
          PROTOCOL_VOUT: "3",
          RECORD_ORDINAL: "0",
          REGISTRY_PAYMENT_VOUT: "4",
        }[field]}$`,
        "mu",
      ).test(
        service,
      ),
    ) &&
    /Environment=WORK_AMO_V6_WRITES_ENABLED=0$/mu.test(service) &&
    !/WORK_AMO_V6_(?:ORACLE|ATTESTOR)|work-amo-v6-oracle-key/u.test(
      service,
    ),
);
expect(
  "AMO V6 index migration binds immutable proof-native terms to exact declaration evidence",
  /CREATE TABLE IF NOT EXISTS proof_indexer\.work_amo_v6_listing_terms/iu.test(
      proofIndexSchema,
    ) &&
    /unit_face_proofs integer NOT NULL/iu.test(proofIndexSchema) &&
    /unit_face_proofs IN \(20000, 50000, 100000\)/iu.test(
      proofIndexSchema,
    ) &&
    /work_amo_v6_listing_terms_immutable/iu.test(proofIndexSchema) &&
    /work_amo_v6_migration_marker_immutable/iu.test(proofIndexSchema) &&
    /export async function proofIndexWorkAmoV6MigrationReadiness/u.test(
      reader,
    ) &&
    /export async function proofIndexWorkAmoV6ListingTerms/u.test(reader) &&
    /WORK_AMO_V6_INDEX_MIGRATION_MODEL =\s*"canonical-work-amo-v6-proof-native-index-migration-v1"/u.test(
      workAmoV6Migration,
    ) &&
    /WORK_AMO_V6_INDEX_MIGRATION_META_KEY =\s*"workAmoV6Migration:livenet"/u.test(
      workAmoV6Migration,
    ),
);
expect(
  "AMO V6 declaration evidence uses the exact raw pwm1:m carrier while allowing sibling mail and credit records",
  [
    workAmoV6IndexedDeclarationEvidence,
    workAmoV6ReaderDeclarationEvidence,
  ].every(
    (source) =>
      /FROM proof_indexer\.op_returns declaration_carrier/u.test(source) &&
      /declaration_carrier\.vout = \$[57]/u.test(source) &&
      /declaration_carrier\.output_index = \$[68]/u.test(source) &&
      /AS raw_carrier_count/u.test(source) &&
      /declaration_carrier\.payload_text/u.test(source) &&
      /declaration_carrier\.payload_hex/u.test(source) &&
      /declaration_carrier\.data_bytes/u.test(source) &&
      !/FROM proof_indexer\.events/u.test(source),
  ) &&
    /row\.payload_text !== pins\.declarationProtocolRecord[\s\S]*Number\(row\.data_bytes\) !== payload\.length/u.test(
      workAmoV6IndexedDeclarationEvidence,
    ) &&
    /Number\(row\.raw_carrier_count\) === 1[\s\S]*Number\(row\.registry_output_count\) === 1/u.test(
      workAmoV6IndexedDeclarationEvidence,
    ) &&
    /row\?\.payload_text !== expectedDeclaration\.protocolRecord[\s\S]*Number\(row\?\.data_bytes\) !== payload\.length/u.test(
      workAmoV6ReaderDeclarationEvidence,
    ) &&
    /Number\(row\?\.raw_carrier_count\) === 1[\s\S]*Number\(row\?\.registry_output_count\) === 1/u.test(
      workAmoV6ReaderDeclarationEvidence,
    ),
);
expect(
  "AMO V6 API readiness consumes the dedicated V6 migration proof",
  /proofIndexWorkAmoV6MigrationReadiness/u.test(server) &&
    /workAmoV6Metadata[\s\S]*proofIndexWorkAmoV6MigrationReadiness/u.test(
      server,
    ) &&
    /function workAmoV6ReplayInputsForBlock[\s\S]*proofIndexWorkAmoV6MigrationReadiness\([\s\S]*migrationReadiness\?\.ready !== true[\s\S]*migrationReadiness\?\.active !== true[\s\S]*migrationReadiness\?\.canonical !== true[\s\S]*migrationReadiness\?\.confirmed !== true[\s\S]*migrationReadiness\?\.evidenceComplete !== true/u.test(
      server,
    ),
);
expect(
  "worker V8 configuration treats every nonempty pin and an enabled write gate as requested while an all-empty closed gate stays staged",
  workerWorkAmoV8DeclarationConfig({
    WORK_AMO_V8_WRITES_ENABLED: "0",
  }).requested === false &&
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_DECLARATION_HEIGHT: "0",
      WORK_AMO_V8_WRITES_ENABLED: "0",
    }).requested === true &&
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_DECLARATION_HEIGHT: "-1",
      WORK_AMO_V8_WRITES_ENABLED: "0",
    }).requested === true &&
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_DECLARATION_HEIGHT: "01",
      WORK_AMO_V8_WRITES_ENABLED: "0",
    }).configured === false &&
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_DECLARATION_HEIGHT: "-0",
      WORK_AMO_V8_WRITES_ENABLED: "0",
    }).configured === false &&
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_WRITES_ENABLED: " 0",
    }).requested === true &&
    workerWorkAmoV8DeclarationConfig({
      WORK_AMO_V8_WRITES_ENABLED: "1",
    }).requested === true &&
    workerWorkAmoV8DeclarationConfig(exactWorkAmoV8WorkerEnv)
      .configured === true &&
    workerWorkAmoV8DeclarationConfig({
      ...exactWorkAmoV8WorkerEnv,
      WORK_AMO_V8_ACTIVATION_HEIGHT: "102",
    }).configured === false &&
    workerWorkAmoV8DeclarationConfig({
      ...exactWorkAmoV8WorkerEnv,
      WORK_AMO_V8_ACTIVATION_HEIGHT: " 101",
    }).configured === false &&
    workerWorkAmoV8DeclarationConfig({
      ...exactWorkAmoV8WorkerEnv,
      WORK_AMO_V8_DECLARATION_TXID: "A".repeat(64),
    }).configured === false,
);
expect(
  "precision migration accepts only exact canonical V8 declaration pins and exact D+1 activation",
  configuredWorkPrecisionV2Pins(
    { WORK_AMO_V8_WRITES_ENABLED: "0" },
    workAmoV8Commitment,
  ).configured === false &&
    configuredWorkPrecisionV2Pins(
      exactWorkAmoV8WorkerEnv,
      workAmoV8Commitment,
    ).configured === true &&
    configuredWorkPrecisionV2Pins(
      exactWorkAmoV8WorkerEnv,
      workAmoV8Commitment,
    ).activationHeight === 101 &&
    workPrecisionV2PinsReject({
      ...exactWorkAmoV8WorkerEnv,
      WORK_AMO_V8_DECLARATION_HEIGHT: "01",
    }) &&
    workPrecisionV2PinsReject({
      ...exactWorkAmoV8WorkerEnv,
      WORK_AMO_V8_DECLARATION_HEIGHT: "-0",
    }) &&
    workPrecisionV2PinsReject({
      ...exactWorkAmoV8WorkerEnv,
      WORK_AMO_V8_ACTIVATION_HEIGHT: " 101",
    }) &&
    workPrecisionV2PinsReject({
      ...exactWorkAmoV8WorkerEnv,
      WORK_AMO_V8_DECLARATION_TXID: "A".repeat(64),
    }),
);
expect(
  "worker Q16 snapshots bind the exact tip hash, explicit subatom model, green canonical summary, and WORK token state",
  workerWorkPrecisionSnapshotReady(workerFixtureSnapshot, {
    tipHash: workerFixtureTipHash,
    tipHeight: 102,
  }) === true &&
    workerWorkPrecisionSnapshotReady({
      ...workerFixtureSnapshot,
      consistencyStatus: "red",
    }, {
      tipHash: workerFixtureTipHash,
      tipHeight: 102,
    }) === false &&
    workerWorkPrecisionSnapshotReady({
      ...workerFixtureSnapshot,
      payloadBlockHash: "0".repeat(64),
    }, {
      tipHash: workerFixtureTipHash,
      tipHeight: 102,
    }) === false &&
    workerWorkPrecisionSnapshotReady({
      ...workerFixtureSnapshot,
      workAmountStorageModel: "work-atoms-v1",
    }, {
      tipHash: workerFixtureTipHash,
      tipHeight: 102,
    }) === false,
);
expect(
  "worker confirmed replay envelope binds D predecessor, activation-through-tip count, transition hash, and the exact Q16 snapshot",
  workerWorkPrecisionCoreTipReady(
    workerFixtureReplayEnvelope.coreTip,
    {
      tipHash: workerFixtureTipHash,
      tipHeight: 102,
    },
  ) === true &&
    workerWorkPrecisionCoreTipReady({
      ...workerFixtureReplayEnvelope.coreTip,
      stable: false,
    }, {
      tipHash: workerFixtureTipHash,
      tipHeight: 102,
    }) === false &&
  workerWorkPrecisionConfirmedReplayEnvelopeReady(
    workerFixtureReplayEnvelope,
  ) === true &&
    workerWorkPrecisionConfirmedReplayEnvelopeReady({
      ...workerFixtureReplayEnvelope,
      activationTransition: {
        ...workerFixtureReplayEnvelope.activationTransition,
        previousBlockHash: "0".repeat(64),
      },
    }) === false &&
    workerWorkPrecisionConfirmedReplayEnvelopeReady({
      ...workerFixtureReplayEnvelope,
      latestTransition: {
        ...workerFixtureReplayEnvelope.latestTransition,
        blockHash: "0".repeat(64),
      },
    }) === false &&
    workerWorkPrecisionConfirmedReplayEnvelopeReady({
      ...workerFixtureReplayEnvelope,
      transitionCount: 1,
    }) === false,
);
expect(
  "worker Q16 relational parity compares the complete holder and listing sets and rejects malformed, missing, or extra rows",
  workerWorkPrecisionRelationalParity({
    balanceRows: [{ address: "holder-a", confirmed_balance: "7" }],
    closingTokenState: {
      holders: [{ address: "holder-a", balanceSubatoms: "7" }],
      listings: [{
        amountSubatoms: "5",
        frozenTerms: { model: "frozen" },
        listingId: "listing-a",
        priceSats: "20",
        saleAuthorization: { version: "pwt-sale-v6" },
        sellerAddress: "seller-a",
      }],
    },
    listingRows: [{
      amount: "5",
      frozen_terms: { model: "frozen" },
      listing_id: "listing-a",
      price_sats: "20",
      sale_authorization: { version: "pwt-sale-v6" },
      seller_address: "seller-a",
      status: "active",
      v7_authorization_version: null,
    }],
  }) === true &&
    workerWorkPrecisionRelationalParity({
      balanceRows: [],
      closingTokenState: {
        holders: [{ address: "holder-a", balanceSubatoms: "7" }],
        listings: [],
      },
      listingRows: [],
    }) === false &&
    workerWorkPrecisionRelationalParity({
      balanceRows: [
        { address: "holder-a", confirmed_balance: "7" },
        { address: "holder-extra", confirmed_balance: "1" },
      ],
      closingTokenState: {
        holders: [{ address: "holder-a", balanceSubatoms: "7" }],
        listings: [],
      },
      listingRows: [],
    }) === false &&
    workerWorkPrecisionRelationalParity({
      balanceRows: [{ address: "holder-a", confirmed_balance: "07" }],
      closingTokenState: {
        holders: [{ address: "holder-a", balanceSubatoms: "7" }],
        listings: [],
      },
      listingRows: [],
    }) === false,
);
expect(
  "worker pending projection commits every Q16 pending relation instead of treating an incomplete phase as ready",
  (() => {
    const empty = workerWorkPrecisionPendingProjection({
      balanceRows: [],
      eventRows: [],
      listingRows: [],
      transactionRows: [],
    });
    const oneSubatom = workerWorkPrecisionPendingProjection({
      balanceRows: [{ address: "holder-a", pending_delta: "1" }],
      eventRows: [],
      listingRows: [],
      transactionRows: [],
    });
    return (
      empty.balances.count === 0 &&
      empty.events.count === 0 &&
      empty.listings.count === 0 &&
      empty.transactions.count === 0 &&
      /^[0-9a-f]{64}$/u.test(empty.commitmentSha256) &&
      oneSubatom.balances.count === 1 &&
      oneSubatom.events.count === 0 &&
      oneSubatom.commitmentSha256 !== empty.commitmentSha256
    );
  })(),
);
expect(
  "worker Q16 readiness resamples one stable Core height and hash",
  /async function readExactWorkerCoreTip[\s\S]*getblockchaininfo[\s\S]*getblockhash[\s\S]*afterHeight !== height[\s\S]*afterHash !== blockHash[\s\S]*heightHash !== blockHash[\s\S]*stable: true/u.test(
    worker,
  ),
);
expect(
  "worker Q16 readiness brackets the exact DB canonical tip audit with stable Core samples",
  /async function assertWorkPrecisionReplayReady[\s\S]*const coreTipBefore = await readExactWorkerCoreTip\(\)[\s\S]*WITH canonical_tip AS[\s\S]*AS tip_height[\s\S]*AS tip_hash[\s\S]*const coreTipAfter = await readExactWorkerCoreTip\(\)[\s\S]*coreTipBefore\.height !== coreTipAfter\.height[\s\S]*coreTipBefore\.blockHash !== coreTipAfter\.blockHash/u.test(
    worker,
  ),
);
expect(
  "worker Q16 readiness checks immutable scalar transition hash, value, state, and payload-byte continuity",
  /block\.previous_block_hash <>[\s\S]*transition\.previous_block_hash/u.test(
    worker,
  ) &&
    /previous_transition\.block_hash <>[\s\S]*transition\.previous_block_hash/u.test(
    worker,
  ) &&
    /previous_transition\.closing_network_value_q8 <>[\s\S]*transition\.opening_network_value_q8/u.test(
      worker,
    ) &&
    /previous_transition\.closing_state_sha256 <>[\s\S]*transition\.opening_state_sha256/u.test(
      worker,
    ) &&
    /previous_transition\.closing_state_payload_bytes <>[\s\S]*transition\.opening_state_payload_bytes/u.test(
      worker,
    ) &&
    !/previous_transition\.payload/u.test(worker),
);
expect(
  "worker Q16 readiness validates immutable scalar transition models without mutating the bare closing preimage",
  /transition\.model <> \$3[\s\S]*transition\.work_token_state_model <> \$4[\s\S]*transition\.state_commitment_model <> \$5/u.test(
    worker,
  ) &&
    !/transition\.payload->'closingTokenState'\s*->>'model'\s*IS DISTINCT FROM \$4/u.test(
      worker,
    ),
);
expect(
  "worker and reader behaviorally validate the full activation and latest transition payload boundaries",
  /validateWorkAmoV8BoundaryTransitionPayload\(activation\)[\s\S]*validateWorkAmoV8BoundaryTransitionPayload\(latest\)[\s\S]*activationBoundary\.valid === true[\s\S]*latestBoundary\.valid === true/u.test(
    worker,
  ) &&
    /validateWorkAmoV8BoundaryTransitionPayload\(activationTransition\)[\s\S]*activationBoundaryValidation\.valid === true[\s\S]*validateWorkAmoV8BoundaryTransitionPayload\(latestTransition\)[\s\S]*latestBoundaryValidation\.valid === true/u.test(
      reader,
    ),
);
expect(
  "worker Q16 readiness binds all snapshot hashes and model before full relational parity",
  /jsonb_build_object\([\s\S]*'consistencyStatus'[\s\S]*'payloadBlockHash'[\s\S]*'sourceBlockHash'[\s\S]*'summaryBlockHash'[\s\S]*'workAmountStorageModel'[\s\S]*WORK_SUBATOM_PROJECTION_MODEL/u.test(
    worker,
  ) &&
    /workerWorkPrecisionConfirmedReplayEnvelopeReady\(\{[\s\S]*coreTip: coreTipAfter[\s\S]*tipHash,[\s\S]*tipHeight,[\s\S]*workerWorkPrecisionRelationalParity\(\{[\s\S]*balanceRows: balanceResult\.rows[\s\S]*listingRows: listingResult\.rows/u.test(
      worker,
    ),
);
expect(
  "worker pending witness binds Q16, stable Core membership for persisted WORK, every projected relation, and freshness",
  /export function workerWorkPrecisionPendingWitnessReady[\s\S]*witness\.ready === true[\s\S]*WORK_SUBATOM_PROJECTION_MODEL[\s\S]*WORK_PRECISION_V2_MODEL[\s\S]*invalidLegacyMutationCount[\s\S]*workerWorkPrecisionCoreTipReady[\s\S]*canonicalWorkerMempoolSnapshot\(currentMempoolTxids\)[\s\S]*canonicalWorkerJsonText\(witnessedProjection\) ===\s*canonicalWorkerJsonText\(currentProjection\)[\s\S]*scan\.complete === true[\s\S]*atomic-staged-pending-work-projection-audit-v1[\s\S]*bounded-best-effort-unconfirmed-discovery-v1[\s\S]*WORK_AMO_V8_PENDING_WITNESS_MAX_AGE_MS/u.test(
    worker,
  ),
);
expect(
  "worker pending audit compares stable Core and mempool samples with every pending WORK projection",
  /async function assertWorkPrecisionPendingReady[\s\S]*confirmedReplay\?\.ready !== true[\s\S]*readExactWorkerCoreMempoolSnapshot/u.test(
    worker,
  ) &&
    /SELECT address, pending_delta::text[\s\S]*AND status = 'pending'[\s\S]*listing\.status = 'pending'[\s\S]*listing\.status = 'sealing'/u.test(
      worker,
    ) &&
    /invalidLegacyResult[\s\S]*const stableCore =[\s\S]*const stableMempool = membership\.expectedTxids\.every[\s\S]*mempoolBeforeTxids\.has\(txid\)[\s\S]*mempoolAfterTxids\.has\(txid\)[\s\S]*workerWorkPrecisionPendingWitnessReady/u.test(
      worker,
    ),
);
expect(
  "all Q16 readiness surfaces share the semantic transaction projection instead of volatile raw envelopes",
  /canonical-work-q16-pending-projection-v5/u.test(
    workQ16PendingProjection,
  ) &&
    /pendingProtocolResolvedInvalid[\s\S]*pendingWorkMintAttemptCount[\s\S]*pendingWorkMintInspectionVersion[\s\S]*pendingWorkMintRecoveryNeeded[\s\S]*pendingWorkMintResolvedInvalid/u.test(
      workQ16PendingProjection,
    ) &&
    [backfillQ16PendingWitness, worker, readerPrecisionV2Readiness]
      .every((source) =>
        /workQ16PendingTransactionProjectionRows/u.test(source)
      ) &&
    /eventParticipants[\s\S]*eventRefs/u.test(backfillQ16PendingWitness) &&
    /eventParticipants[\s\S]*eventRefs/u.test(worker) &&
    /eventParticipants[\s\S]*eventRefs/u.test(
      readerPrecisionV2Readiness,
    ) &&
    [backfillQ16PendingWitness, worker, readerPrecisionV2Readiness]
      .every((source) =>
        /mailItems/u.test(source) &&
        /workQ16PendingMailProjectionRows/u.test(source)
      ) &&
    /volatileOverlayAbsent/u.test(workQ16PendingProjection),
);
expect(
  "indexed address-mail reads merge only recent pending mail from the node overlay",
  /function pendingOnlyMailPayload[\s\S]*inboxMessages\.filter\(\(message\) => !message\?\.confirmed\)[\s\S]*sentMessages\.filter\([\s\S]*message\?\.status !== "confirmed"[\s\S]*pendingOnlyOverlay/u.test(
    server,
  ) &&
    /async function mailPayloadWithPendingRecentOverlay[\s\S]*recentNodeMailPayload[\s\S]*pendingOnlyMailPayload[\s\S]*mergeMailPayloads/u.test(
      server,
    ) &&
    /const indexedOnlyPayload = \(\) =>[\s\S]*mailPayloadWithIndexedEventOverlay[\s\S]*mailPayloadWithPendingRecentOverlay[\s\S]*reconcileMailPayloadStatuses[\s\S]*repairPendingMailWorkAttachments/u.test(
      server,
    ),
);
for (const [surface, source] of [
  ["backfill pending witness", backfillQ16PendingWitness],
  ["worker pending audit", workerQ16PendingAudit],
  ["reader pending readiness", readerPrecisionV2Readiness],
]) {
  expect(
    `${surface} uses the canonical event output column with one protocol-position alias`,
    /op_return_vout AS protocol_vout[\s\S]*FROM proof_indexer\.events/u.test(
      source,
    ) &&
      !/SELECT\s+event_id,\s+txid,\s+kind,\s+protocol,\s+protocol_vout,/u.test(
        source,
      ),
  );
  expect(
    `${surface} qualifies every joined pending-listing projection`,
    /listing\.listing_id,[\s\S]*listing\.status,[\s\S]*listing\.seller_address,[\s\S]*listing\.buyer_address,[\s\S]*listing\.amount::text,[\s\S]*listing\.price_sats::text,[\s\S]*listing\.sale_ticket_txid,[\s\S]*listing\.seal_txid,[\s\S]*listing\.payload[\s\S]*FROM proof_indexer\.credit_listings listing[\s\S]*LEFT JOIN proof_indexer\.transactions seal_tx/u.test(
      source,
    ) &&
      !/SELECT\s+listing_id,\s+status,/u.test(source),
  );
}
expect(
  "worker publishes no Q16-ready state before the pending audit completes",
  /workPrecision\.era === WORK_PRECISION_Q16_ERA[\s\S]*pendingRequired: true,[\s\S]*ready: false,[\s\S]*state: "canonical-phase-complete"/u.test(
    worker,
  ) &&
    /workPrecision\.era === WORK_PRECISION_Q16_ERA[\s\S]*await assertWorkPrecisionPendingReady\([\s\S]*pendingRebuild:[\s\S]*WORK_AMO_V8_PENDING_REBUILD_MODEL[\s\S]*ready: workPrecisionReplay\.ready === true/u.test(
      worker,
    ),
);
expect(
  "worker status maintenance precedes the final backfill-owned Q16 pending witness",
  /runCanonicalBeforePending\([\s\S]*runBackfillPhase\(backfillPhases\[0\]\)[\s\S]*pendingStatus = await refreshPendingStatusesSafely\(\);[\s\S]*runBackfillPhase\(backfillPhases\[1\]\)[\s\S]*assertWorkPrecisionPendingReady/u.test(
    worker,
  ),
);
expect(
  "the pending scan retains the last exact witness until its atomic replacement is complete",
  /const q16PendingActive =[\s\S]*const state = await mempoolScanState/u.test(
    backfillMempoolScan,
  ) &&
    !/storeWorkQ16PendingWitnessNotReady/u.test(backfill) &&
    /await persistExactWorkQ16PendingWitness\(client/u.test(
      backfillMempoolScan,
    ) &&
    /storeCurrentWorkQ16PendingStage[\s\S]*catch \(error\)[\s\S]*unresolved \+= 1/u.test(
      backfillMempoolScan,
    ) &&
    /BEGIN ISOLATION LEVEL SERIALIZABLE[\s\S]*catch \(error\)[\s\S]*ROLLBACK[\s\S]*throw error/u.test(
      backfillQ16PendingWitness,
    ),
);
expect(
  "normal worker phases preserve and consume only the last fully successful Q16 proof",
  /const currentSuccess = \{[\s\S]*workPrecision: runtime\.workPrecision[\s\S]*lastSuccess: currentSuccess/u.test(
    worker,
  ) &&
    /canonicalPhase,[\s\S]*lastSuccess,[\s\S]*lastSuccessAt: lastSuccess\?\.finishedAt \?\? null[\s\S]*state: "canonical-phase-complete"/u.test(
      worker,
    ) &&
    !/lastSuccess: canonicalSuccess/u.test(worker) &&
    /WORK_AMO_V8_TRANSIENT_WORKER_STATES[\s\S]*"canonical-phase-complete"[\s\S]*"running"[\s\S]*"starting"/u.test(
      workAmoV8WorkerReadiness,
    ) &&
    /lastSuccess\.workPrecision[\s\S]*durableReplay\.ready === true[\s\S]*replay\.tipHeight === tipHeight[\s\S]*replay\.tipHash === normalizedHash\(tipHash\)/u.test(
      workAmoV8WorkerReadiness,
    ) &&
    /idleProofReady[\s\S]*replayCommitmentsEqual\(currentReplay, durableReplay\)/u.test(
      workAmoV8WorkerReadiness,
    ),
);
expect(
  "V8 readiness keeps completed-worker and current-reader pending proofs independent at one Core tip",
  /const indexReady =[\s\S]*migrationReadiness\?\.pendingReady === true &&[\s\S]*workerReadiness\.ready === true &&[\s\S]*pendingMembershipLive;/u.test(
    server,
  ) &&
    !/workerReadiness\.pendingMembershipCount ===[\s\S]*pendingMembershipSnapshot\?\.count/u.test(
      server,
    ) &&
    !/workerReadiness\.pendingProjectionSha256 ===[\s\S]*migrationReadiness\?\.pendingWitness/u.test(
      server,
    ),
);
expect(
  "marketplace deployment convergence selects authoritative V8 before historical V6 and V5",
  /function workAmoV8IsAuthoritative[\s\S]*activation\?\.reached === true[\s\S]*migrationReadiness\?\.active === true/u.test(
    marketplaceRegressions,
  ) &&
    /function canonicalWorkAmoStatusIndexReady[\s\S]*workAmoV8IsAuthoritative\(v8\)[\s\S]*workAmoV8StatusIndexReady\(v8\)[\s\S]*workAmoV6StatusFromPayload/u.test(
      marketplaceRegressions,
    ) &&
    /function expectedActiveWorkMarketVersion[\s\S]*workAmoV8IsAuthoritative\(workAmoV8\)[\s\S]*return WORK_AMO_V8_AUTH_VERSION[\s\S]*workAmoV6StatusFromPayload/u.test(
      marketplaceRegressions,
    ) &&
    /assertWorkAmoEraSelectionContract\(\)/u.test(
      marketplaceRegressions,
    ),
);
expect(
  "backfill and worker share one durable Q16 pending witness key and model",
  /WORK_Q16_PENDING_REBUILD_META_KEY =\s*"workQ16PendingRebuild:livenet"/u.test(
    backfill,
  ) &&
    /WORK_Q16_PENDING_REBUILD_MODEL =\s*"canonical-work-q16-pending-rebuild-v2"/u.test(
      backfill,
    ) &&
    /WORK_AMO_V8_PENDING_REBUILD_META_KEY =\s*"workQ16PendingRebuild:livenet"/u.test(
      worker,
    ) &&
    /WORK_AMO_V8_PENDING_REBUILD_MODEL =\s*"canonical-work-q16-pending-rebuild-v2"/u.test(
      worker,
    ),
);
expect(
  "backfill publishes the Q16 pending witness only after stable Core and exact DB commitments",
  /async function persistExactWorkQ16PendingWitness[\s\S]*WORK_PROJECTION_STATE_Q16[\s\S]*getrawmempool[\s\S]*BEGIN ISOLATION LEVEL SERIALIZABLE[\s\S]*LOCK TABLE[\s\S]*FOR UPDATE[\s\S]*workQ16PendingCommitment[\s\S]*recheckedMempoolSnapshot[\s\S]*recheckedTipHeight[\s\S]*ready: true[\s\S]*complete:/u.test(
      backfill,
    ) &&
    /atomic-staged-pending-work-projection-audit-v1[\s\S]*bounded-best-effort-unconfirmed-discovery-v1[\s\S]*WORK_Q16_PENDING_REBUILD_META_KEY[\s\S]*await client\.query\("COMMIT"\)/u.test(
      backfill,
    ) &&
    !/storeWorkQ16PendingWitnessNotReady/u.test(backfill),
);
expect(
  "Q16 pending readiness separates exact persisted-state parity from bounded best-effort discovery",
  /function workQ16PendingMembershipStableAcrossSnapshots[\s\S]*WORK_Q16_PENDING_MEMPOOL_MODEL[\s\S]*initialMembership\.has\(txid\)[\s\S]*finalMembership\.has\(txid\)/u.test(
    backfill,
  ) &&
    /async function persistExactWorkQ16PendingWitness[\s\S]*workQ16PendingMembershipStableAcrossSnapshots[\s\S]*membership\.expectedTxids[\s\S]*atomic-staged-pending-work-projection-audit-v1[\s\S]*bounded-best-effort-unconfirmed-discovery-v1/u.test(
      backfill,
    ) &&
    !/finalSha256 === initialSha256/u.test(backfill),
);
expect(
  "Q16 pending readiness proves mempool membership, exact inspection markers, transaction parity, and zero noncanonical balance deltas",
  /function workQ16PendingMembership[\s\S]*canonical-work-q16-pending-membership-v2[\s\S]*function workQ16PendingInspectionMarkerReason[\s\S]*pendingWorkMintAttemptCount[\s\S]*pendingProtocolResolvedInvalid[\s\S]*function workQ16PendingParity[\s\S]*outsideMempoolTxids[\s\S]*missingTransactionTxids[\s\S]*invalidInspectionRows[\s\S]*pending-work-events-do-not-mutate-holder-balances-v1[\s\S]*canonical-work-q16-pending-parity-v2[\s\S]*ready:/u.test(
    backfill,
  ) &&
    /const parity = workQ16PendingParity\([\s\S]*if \(!parity\.ready\)[\s\S]*parity,[\s\S]*projection/u.test(
      backfill,
    ) &&
    /function workQ16PendingParity[\s\S]*canonical-work-q16-pending-parity-v2[\s\S]*pendingParity\.ready === true[\s\S]*pendingWitness\.parity/u.test(
      reader,
    ) &&
    /function workQ16PendingInspectionMarkerReason[\s\S]*protocol-terminal-valid-projection-conflict[\s\S]*invalidInspectionRows/u.test(
      reader,
    ) &&
    /function workerWorkPrecisionPendingInspectionMarkerReason[\s\S]*protocol-terminal-valid-projection-conflict[\s\S]*invalidInspectionRows/u.test(
      worker,
    ) &&
    /function workQ16PendingInspectionMarkerReason[\s\S]*decisionCount !== attemptCount[\s\S]*work-decision-count-mismatch[\s\S]*resolvedInvalid !== \(validMintDecisionCount === 0\)[\s\S]*work-resolved-invalid-marker-mismatch/u.test(
      backfill,
    ) &&
    /function workQ16PendingInspectionMarkerReason[\s\S]*decisionCount !== attemptCount[\s\S]*work-decision-count-mismatch[\s\S]*resolvedInvalid !== \(validMintDecisionCount === 0\)[\s\S]*work-resolved-invalid-marker-mismatch/u.test(
      reader,
    ) &&
    /function workerWorkPrecisionPendingInspectionMarkerReason[\s\S]*decisionCount !== attemptCount[\s\S]*work-decision-count-mismatch[\s\S]*resolvedInvalid !== \(validMintDecisionCount === 0\)[\s\S]*work-resolved-invalid-marker-mismatch/u.test(
      worker,
    ),
);
expect(
  "AMO V8 accepts only an exact Core mempool array and keeps full pending membership internal",
  /function workQ16MempoolSnapshot[\s\S]*!Array\.isArray\(txids\)[\s\S]*normalizedTxids\.some[\s\S]*new Set\(normalizedTxids\)\.size[\s\S]*return null/u.test(
    server,
  ) &&
    /async function workAmoV8ExactLiveProbe[\s\S]*mempoolTxidsResult\?\.ok !== true[\s\S]*!Array\.isArray\(mempoolTxidsResult\.result\)[\s\S]*return null[\s\S]*liveMempoolTxids = \[\.\.\.mempoolTxidsResult\.result\][\s\S]*workQ16MempoolSnapshot/u.test(
      server,
    ) &&
    /const publicMigrationReadiness =[\s\S]*membershipSnapshot:[\s\S]*count: pendingMembershipSnapshot\.count,[\s\S]*model: pendingMembershipSnapshot\.model,[\s\S]*sha256: pendingMembershipSnapshot\.sha256,[\s\S]*migrationReadiness: publicMigrationReadiness/u.test(
      server,
    ) &&
    /function canonicalWorkerMempoolSnapshot[\s\S]*!Array\.isArray\(value\)[\s\S]*getrawmempool\(false\) array/u.test(
      worker,
    ) &&
    /function canonicalMempoolTxidSnapshot[\s\S]*!Array\.isArray\(mempool\) && !verboseMempool[\s\S]*exact Core mempool array or verbose object/u.test(
      backfill,
    ),
);
expect(
  "reader runtime keeps a one-subatom holder and mint aggregate exact while preserving historical one-atom payloads",
  (() => {
    const q16Balance = workBalanceProjection(
      "1",
      workQ16PayloadMetadata,
    );
    const q8Balance = workBalanceProjection(
      "1",
      workQ8PayloadMetadata,
    );
    const q16Supply = workSupplyFieldsForStorageModel(
      "1",
      "-1",
      WORK_SUBATOM_PROJECTION_MODEL,
    );
    const q8Supply = workSupplyFieldsForStorageModel(
      "1",
      "-1",
      WORK_ATOMIC_PROJECTION_MODEL,
    );
    return (
      q16Balance.amount === "0.0000000000000001" &&
      q16Balance.subatoms === "1" &&
      q16Balance.atoms === undefined &&
      q16Balance.decimals === 16 &&
      q16Balance.amountStorageModel ===
        WORK_SUBATOM_PROJECTION_MODEL &&
      q8Balance.amount === "0.00000001" &&
      q8Balance.atoms === "1" &&
      q8Balance.subatoms === undefined &&
      q8Balance.decimals === 8 &&
      q8Balance.amountStorageModel ===
        WORK_ATOMIC_PROJECTION_MODEL &&
      q16Supply.confirmedSupply === "0.0000000000000001" &&
      q16Supply.pendingSupply === "-0.0000000000000001" &&
      q16Supply.confirmedSupplySubatoms === "1" &&
      q16Supply.pendingSupplySubatoms === "-1" &&
      q16Supply.confirmedSupplyAtoms === undefined &&
      q16Supply.decimals === 16 &&
      q16Supply.precisionModel === WORK_PRECISION_V2_MODEL &&
      q8Supply.confirmedSupply === "0.00000001" &&
      q8Supply.pendingSupply === "-0.00000001" &&
      q8Supply.confirmedSupplyAtoms === "1" &&
      q8Supply.pendingSupplyAtoms === "-1" &&
      q8Supply.confirmedSupplySubatoms === undefined &&
      q8Supply.decimals === 8 &&
      workAmountUnitsForStorageModel(
        {
          amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
          amountSubatoms: "1",
          decimals: WORK_SUBATOM_DECIMALS,
          precisionModel: WORK_PRECISION_V2_MODEL,
          unitScale: WORK_SUBATOM_UNIT_SCALE_TEXT,
        },
        WORK_SUBATOM_PROJECTION_MODEL,
      ) === "1" &&
      workAmountUnitsForStorageModel(
        {
          amountAtoms: "1",
          amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
          decimals: WORK_DECIMALS,
          unitScale: WORK_UNIT_SCALE_TEXT,
        },
        WORK_SUBATOM_PROJECTION_MODEL,
      ) === "100000000"
    );
  })(),
);
expect(
  "reader WORK projection helpers emit mutually exclusive Q8 atom or Q16 subatom fields with exact BigInt-derived supplies",
  /export function workBalanceProjection[\s\S]*const units = storedWorkAtoms[\s\S]*WORK_SUBATOM_PROJECTION_MODEL[\s\S]*subatoms: units[\s\S]*atoms: units/u.test(
    reader,
  ) &&
    /export function workSupplyFieldsForStorageModel[\s\S]*normalizeWorkSubatoms : normalizeWorkAtoms[\s\S]*formatWorkSubatoms : formatWorkAtoms[\s\S]*confirmedSupplySubatoms[\s\S]*pendingSupplySubatoms[\s\S]*precisionModel: WORK_PRECISION_V2_MODEL[\s\S]*confirmedSupplyAtoms[\s\S]*pendingSupplyAtoms/u.test(
      reader,
    ) &&
    /export function workAmountUnitsForStorageModel[\s\S]*legacyWorkAtomsToSubatoms[\s\S]*Native Q16 WORK cannot be projected back/u.test(
      reader,
    ),
);
expect(
  "reader WORK mint statistics aggregate exact active-model units and publish matching Q8 or Q16 fields",
  /const workStorageModel = workScoped[\s\S]*currentWorkAmountStorageModel[\s\S]*const exactIntegerUnits = exactWholeUnits \|\| workScoped[\s\S]*const amount = workScoped[\s\S]*BigInt\([\s\S]*workAmountUnitsForStorageModel[\s\S]*const workSupply = workScoped[\s\S]*workSupplyFieldsForStorageModel/u.test(
    readerWorkMintStats,
  ) &&
    /pendingCandidateSupplySubatoms[\s\S]*pendingCandidateSupplyAtoms/u.test(
      readerWorkMintStats,
    ) &&
    /pendingCandidates:[\s\S]*amountStorageModel: workStorageModel[\s\S]*amountSubatoms:[\s\S]*amountAtoms:/u.test(
      readerWorkMintStats,
    ),
);
expect(
  "reader mint overlays select WORK by exact units before any generic Number aggregation",
  /if \(isWorkTokenId\(item\.tokenId\)\)[\s\S]*BigInt\([\s\S]*amountSubatoms \?\? item\.amountAtoms/u.test(
    readerWorkMintOverlay,
  ) &&
    /const workStorageModel = workScoped[\s\S]*const confirmedWorkUnits = workScoped[\s\S]*workAmountUnitsForStorageModel[\s\S]*const pendingWorkUnits = workScoped[\s\S]*workAmountUnitsForStorageModel[\s\S]*const workSupply = workScoped[\s\S]*workSupplyFieldsForStorageModel[\s\S]*const confirmedSupply = workSupply[\s\S]*Number\(mint\.amount/u.test(
      readerWorkMintOverlay,
    ),
);
expect(
  "authoritative WORK holder and mint aggregation never coerces active-model units through Number",
  /const amount = workScoped[\s\S]*\? BigInt\([\s\S]*workAmountUnitsForStorageModel[\s\S]*: exactWholeUnits[\s\S]*: Number\(mint\.amount\)/u.test(
    readerWorkMintStats,
  ) &&
    readerCurrentWorkMintBranches.length === 2 &&
    readerCurrentWorkMintBranches.every(
      (branch) => !/\bNumber\s*\(/u.test(branch),
    ) &&
    readerMintOverlayExactWorkAggregation.length > 0 &&
    !/\bNumber\s*\(/u.test(readerMintOverlayExactWorkAggregation) &&
    readerScopedExactWorkAggregation.length > 0 &&
    !/\bNumber\s*\(/u.test(readerScopedExactWorkAggregation),
);
expect(
  "reader holder and current-token aggregates carry exact active-model WORK fields through every authoritative sum",
  /workBalanceUnitFields\(workBalance,[\s\S]*balanceAtoms[\s\S]*balanceSubatoms[\s\S]*workBalanceUnitFields\(workPending,[\s\S]*pendingDeltaAtoms[\s\S]*pendingDeltaSubatoms/u.test(
    readerWorkHolders,
  ) &&
    /const storageModel = holder\.amountStorageModel[\s\S]*confirmedSupplyUnits = addAtomicStrings[\s\S]*pendingSupplyUnits = addAtomicStrings[\s\S]*workSupplyFieldsForStorageModel/u.test(
      readerWorkHolderSummaries,
    ) &&
    /const workStorageModels = new Map[\s\S]*workAmountUnitsForStorageModel\([\s\S]*confirmedSupplyUnits = addAtomicStrings[\s\S]*pendingSupplyUnits = addAtomicStrings[\s\S]*workSupplyFieldsForStorageModel\([\s\S]*const workSupply = workScoped[\s\S]*confirmedSupplySubatoms \?\?[\s\S]*confirmedSupplyAtoms/u.test(
      readerCurrentTokenPayload,
    ),
);
expect(
  "reader scoped WORK payloads retain Q8 atom fields or Q16 subatom fields without Number coercion",
  /workBalanceUnitFields\(balance,[\s\S]*balanceAtoms[\s\S]*balanceSubatoms/u.test(
    readerScopedWorkHolders,
  ) &&
    /const workStorageModel = workScoped[\s\S]*const confirmedWorkUnits = workScoped[\s\S]*balanceSubatoms[\s\S]*balanceAtoms[\s\S]*const pendingWorkUnits = workScoped[\s\S]*workAmountUnitsForStorageModel[\s\S]*const workSupply = workScoped[\s\S]*workSupplyFieldsForStorageModel/u.test(
      readerScopedTokenPayload,
    ),
);
expect(
  "reader wallet payload exposes model-specific WORK units instead of hardcoded Q8 fields",
  /workBalanceProjection\(row\.confirmed_balance/u.test(
    readerWalletTokenPayload,
  ) &&
    /workBalanceUnitFields\(balance,[\s\S]*atomField: "balanceAtoms"[\s\S]*subatomField: "balanceSubatoms"/u.test(
      readerWalletTokenPayload,
    ) &&
    /workBalanceProjection\(row\.pending_delta/u.test(
      readerWalletTokenPayload,
    ) &&
    /workBalanceUnitFields\(pending,[\s\S]*atomField: "pendingDeltaAtoms"[\s\S]*subatomField: "pendingDeltaSubatoms"/u.test(
      readerWalletTokenPayload,
    ),
);
expect(
  "reader holder-history payload exposes model-specific WORK units instead of hardcoded Q8 fields",
  /workBalanceProjection\(row\.confirmed_balance, token\.metadata\)/u.test(
    readerScopedHolderHistory,
  ) &&
    /workBalanceUnitFields\(balance,[\s\S]*atomField: "balanceAtoms"[\s\S]*subatomField: "balanceSubatoms"/u.test(
      readerScopedHolderHistory,
    ),
);
expect(
  "WORK precision keeps immutable V6 Q8 units separate from canonical V8 Q16 subatoms",
  /export const WORK_DECIMALS = 8;/u.test(workUnits) &&
    /export const WORK_UNIT_SCALE = 100_000_000n;/u.test(workUnits) &&
    /export const WORK_SUBATOM_DECIMALS = 16;/u.test(workUnits) &&
    /export const WORK_SUBATOM_UNIT_SCALE = 10_000_000_000_000_000n;/u.test(
      workUnits,
    ) &&
    /WORK_SUBATOM_CONVERSION_FACTOR =\s*WORK_SUBATOM_UNIT_SCALE \/ WORK_LEGACY_UNIT_SCALE/u.test(
      workUnits,
    ) &&
    /export const WORK_AMO_DECIMALS = WORK_LEGACY_DECIMALS;/u.test(
      workUnits,
    ) &&
    /export const WORK_AMO_UNIT_SCALE = WORK_LEGACY_UNIT_SCALE;/u.test(
      workUnits,
    ) &&
    /export const WORK_AMO_V8_DECIMALS = WORK_SUBATOM_DECIMALS;/u.test(
      workAmoV8,
    ) &&
    /export const WORK_AMO_V8_SUBATOMS_PER_WORK =\s*WORK_SUBATOM_UNIT_SCALE/u.test(
      workAmoV8,
    ),
);
expect(
  "Q16 record projection requires explicit precision metadata and rejects ambiguous aliases",
  /function normalizeWorkSubatoms[\s\S]*must not use surrounding whitespace/u.test(
    workUnits,
  ) &&
    /function workAmountSubatomsFromRecord[\s\S]*model !== WORK_SUBATOM_PROJECTION_MODEL[\s\S]*WORK precision metadata is required/u.test(
      workUnits,
    ) &&
    /model === WORK_SUBATOM_PROJECTION_MODEL[\s\S]*atomAliases\.length > 0 \|\| subatomAliases\.length !== 1[\s\S]*exactly one subatom alias and no legacy atom alias/u.test(
      workUnits,
    ) &&
    /atomAliases\.length > 1 \|\| subatomAliases\.length > 1[\s\S]*Legacy WORK amount aliases are ambiguous/u.test(
      workUnits,
    ) &&
    /normalizeWorkSubatoms\(subatomAliases\[0\],[\s\S]*!==\s*normalized[\s\S]*aliases conflict/u.test(
      workUnits,
    ),
);
expect(
  "AMO V8 derives the singleton proof-native Q16 unit while rejecting legacy relic settlements",
  /WORK_AMO_V8_AUTH_VERSION = "pwt-sale-v8"/u.test(workAmoV8) &&
    /WORK_AMO_V8_TRANSFER_VERSION = "send3"/u.test(workAmoV8) &&
    /WORK_AMO_V8_ALLOWED_FACE_PROOFS = Object\.freeze\(\[\s*25_000,\s*\]\)/u.test(
      workAmoV8,
    ) &&
    /export function workAmoV8UnitTerms\(\{[\s\S]*unitAmountSubatoms = workAmoFloorDiv\([\s\S]*unitPriceSats \* denominator,[\s\S]*networkValue,[\s\S]*unitMinimumPriceSats = workAmoCeilDiv\([\s\S]*unitAmountSubatoms \* networkValue/u.test(
      workAmoV8,
    ) &&
    /function canonicalWorkAmoV8TokenStateListing[\s\S]*version === WORK_AMO_V8_AUTH_VERSION[\s\S]*validateWorkAmoV8StaticAuthorization[\s\S]*validateWorkAmoV8FrozenTerms[\s\S]*return null;/u.test(
      workAmoV8,
    ) &&
    /validateWorkAmoV8SealOrBuyTerms[\s\S]*listingVersion !== WORK_AMO_V8_AUTH_VERSION[\s\S]*work-amo-v8-relic-listing-nonsettleable[\s\S]*validateWorkAmoV8FrozenTerms/u.test(
      workAmoV8,
    ),
);
expect(
  "send3 is mandatory exactly at the confirmed V8 boundary with no legacy fallback",
  /export function workAmoV8TransferEraDecision[\s\S]*v8Required = height >= activation[\s\S]*v8Required =\s*projectionModel === WORK_SUBATOM_PROJECTION_MODEL[\s\S]*nativeV8 !== v8Required[\s\S]*work-amo-v8-send3-required[\s\S]*work-amo-v8-send3-before-activation/u.test(
    workAmoV8,
  ) &&
    /TOKEN_SEND_SUBATOMS_ACTION = WORK_AMO_V8_TRANSFER_VERSION/u.test(
      server,
    ) &&
    /TOKEN_SEND_SUBATOMS_ACTION !== "send3"/u.test(server) &&
    /function canonicalWorkSubatomsText[\s\S]*text !== text\.trim\(\)[\s\S]*WORK_TOKEN_MAX_SUPPLY_SUBATOMS[\s\S]*parts\.length === 4 && parts\[0\] === TOKEN_SEND_SUBATOMS_ACTION[\s\S]*canonicalWorkSubatomsText\(parts\[2\]\)[\s\S]*amountVersion: TOKEN_SEND_SUBATOMS_ACTION/u.test(
      server,
    ) &&
    /parsed\.tokenId !== WORK_TOKEN_ID[\s\S]*workAmoV8TransferEraDecision\([\s\S]*activationHeight:[\s\S]*blockHeight,[\s\S]*confirmed,[\s\S]*projectionModel:[\s\S]*transferVersion: parsedTransferVersion/u.test(
      server,
    ),
);
expect(
  "V8 metadata separates an irreversible reached boundary from exact write readiness",
  /export function workAmoV8StatusFromEvidence[\s\S]*const activation = \{[\s\S]*reached: Boolean\([\s\S]*indexed >= expected\.activationHeight[\s\S]*evidenceComplete =[\s\S]*precisionMigrationReady === true[\s\S]*protocolReady: ready[\s\S]*writeAdmission: settlementWritesEnabled/u.test(
    workAmoV8,
  ) &&
    /let workAmoV8ReachedLatch = false[\s\S]*async function workAmoV8Metadata[\s\S]*tipVerified[\s\S]*tipHeight >= expectedDeclaration\.activationHeight[\s\S]*workAmoV8ReachedLatch = true[\s\S]*proofIndexWorkPrecisionV2MigrationReadiness/u.test(
      server,
    ) &&
    /const indexReady =[\s\S]*migrationReadiness\?\.ready === true[\s\S]*migrationReadiness\?\.parityReady === true[\s\S]*migrationReadiness\?\.replayReady === true[\s\S]*Number\(migrationReadiness\?\.tipHeight\) === tipHeight/u.test(
      server,
    ) &&
    /Number\(migrationReadiness\?\.tipHeight\) === tipHeight[\s\S]*String\(migrationReadiness\?\.tipHash \?\? ""\)[\s\S]*\.toLowerCase\(\) === tipHash/u.test(
      server,
    ) &&
    /activation: \{[\s\S]*reached: workAmoV8ReachedLatch,[\s\S]*tipVerified,[\s\S]*migrationReadiness: publicMigrationReadiness,[\s\S]*writesConfigured: WORK_AMO_V8_WRITES_CONFIGURED/u.test(
      server,
    ) &&
    /withWorkMarketplaceV4Metadata[\s\S]*workAmoV8Metadata\(network,[\s\S]*workAmoV8,[\s\S]*floor:[\s\S]*workAmoV8,[\s\S]*workFloor:[\s\S]*workAmoV8/u.test(
      server,
    ),
);
expect(
  "API V8 pins accept only raw canonical integers and lowercase hashes while every malformed nonempty request stays fail-closed",
  /function canonicalWorkAmoV8ConfiguredInteger\([\s\S]*const raw = String\(value \?\? ""\);[\s\S]*\/\^\(\?:0\|\[1-9\]\[0-9\]\*\)\$\//u.test(
    server,
  ) &&
    /function canonicalWorkAmoV8ConfiguredInteger\([\s\S]*Number\.isSafeInteger\(parsed\) && parsed >= minimum/u.test(
      server,
    ) &&
    /function canonicalWorkAmoV8ConfiguredHash\([\s\S]*const raw = String\(value \?\? ""\);[\s\S]*\/\^\[0-9a-f\]\{64\}\$\//u.test(
      server,
    ) &&
    /const WORK_AMO_V8_WRITES_SOURCE = String\([\s\S]*const WORK_AMO_V8_WRITES_RAW = WORK_AMO_V8_WRITES_SOURCE\.trim\(\);[\s\S]*const WORK_AMO_V8_WRITES_REQUESTED =\s*WORK_AMO_V8_WRITES_CONFIGURED \|\|[\s\S]*WORK_AMO_V8_WRITES_SOURCE !== WORK_AMO_V8_WRITES_RAW/u.test(
      server,
    ) &&
    /const WORK_AMO_V8_ACTIVATION_HEIGHT_RAW = String\([\s\S]*canonicalWorkAmoV8ConfiguredInteger\([\s\S]*WORK_AMO_V8_EXPECTED_ACTIVATION_HEIGHT[\s\S]*WORK_AMO_V8_DECLARATION_HEIGHT \+ 1/u.test(
      server,
    ) &&
    /const WORK_AMO_V8_DECLARATION_PINS_REQUESTED =\s*WORK_AMO_V8_WRITES_REQUESTED \|\|[\s\S]*process\.env\.WORK_AMO_V8_DECLARATION_HEIGHT[\s\S]*process\.env\.WORK_AMO_V8_ACTIVATION_HEIGHT[\s\S]*\.some\(\(value\) => String\(value \?\? ""\)\.length > 0\)/u.test(
      server,
    ) &&
    /const WORK_AMO_V8_DECLARATION_PINS_CONFIGURED =[\s\S]*Number\.isSafeInteger\(WORK_AMO_V8_ACTIVATION_HEIGHT\)[\s\S]*WORK_AMO_V8_ACTIVATION_HEIGHT ===\s*WORK_AMO_V8_EXPECTED_ACTIVATION_HEIGHT/u.test(
      server,
    ) &&
    /const WORK_AMO_V8_DECLARATION_PIN_STATE =[\s\S]*\? "configured"[\s\S]*WORK_AMO_V8_DECLARATION_PINS_REQUESTED[\s\S]*\? "invalid"[\s\S]*: "unrequested"/u.test(
      server,
    ) &&
    /pinsRequested: WORK_AMO_V8_DECLARATION_PINS_REQUESTED[\s\S]*pinsConfigured: Boolean\(configuredDeclaration\)/u.test(
      server,
    ),
);
expect(
  "backfill and precision migration use the same strict V8 pin grammar as API and worker",
  /function canonicalWorkAmoV8ConfiguredInteger\([\s\S]*const raw = String\(value \?\? ""\);[\s\S]*\/\^\(\?:0\|\[1-9\]\[0-9\]\*\)\$\//u.test(
    backfill,
  ) &&
    /function canonicalWorkAmoV8ConfiguredHash\([\s\S]*const raw = String\(value \?\? ""\);[\s\S]*\/\^\[0-9a-f\]\{64\}\$\//u.test(
      backfill,
    ) &&
    /const WORK_AMO_V8_CONFIGURED_ACTIVATION_HEIGHT =\s*canonicalWorkAmoV8ConfiguredInteger\([\s\S]*process\.env\.WORK_AMO_V8_ACTIVATION_HEIGHT[\s\S]*WORK_AMO_V8_CONFIGURED_ACTIVATION_HEIGHT ===\s*WORK_AMO_V8_EXPECTED_ACTIVATION_HEIGHT/u.test(
      backfill,
    ) &&
    /function optionalSafeInteger\([\s\S]*const raw = String\(value \?\? ""\);[\s\S]*UNSIGNED_INTEGER_PATTERN\.test\(raw\)[\s\S]*Number\.isSafeInteger\(parsed\)/u.test(
      workAmoV8Migration,
    ) &&
    /function canonicalConfiguredHash\([\s\S]*const raw = String\(value \?\? ""\);[\s\S]*TXID_PATTERN\.test\(raw\)/u.test(
      workAmoV8Migration,
    ) &&
    /export function configuredWorkPrecisionV2Pins\([\s\S]*canonicalConfiguredHash\([\s\S]*optionalSafeInteger\([\s\S]*configuredActivationHeight !== declarationHeight \+ 1/u.test(
      workAmoV8Migration,
    ),
);
expect(
  "broadcast admission gates transfers and AMO actions on V8 before considering V6",
  /signedTransactionOutputs\(txHex\)[\s\S]*workTransferActions[\s\S]*parsed\?\.kind !== "send"[\s\S]*workTransferRequiredRegistryPaymentSats[\s\S]*selectWorkAmoV5DistinctRegistryPayment\([\s\S]*requiredSats:\s*workTransferRequiredRegistryPaymentSats[\s\S]*workTransferRegistryPaymentValid[\s\S]*workMintActions[\s\S]*parsed\?\.kind !== "mint"/u.test(
    workAmoBroadcastAdmission,
  ) &&
    /WORK_AMO_V8_DECLARATION_PINS_REQUESTED &&[\s\S]*!WORK_AMO_V8_DECLARATION_PINS_CONFIGURED[\s\S]*WORK_AMO_V8_PINS_INVALID/u.test(
      workAmoBroadcastAdmission,
    ) &&
    /if \(WORK_AMO_V8_DECLARATION_PINS_CONFIGURED\)[\s\S]*workAmoV8Metadata\([\s\S]*activation\?\.reached !== true[\s\S]*activation\?\.tipVerified !== true[\s\S]*WORK_AMO_V8_ACTIVATION_UNKNOWN/u.test(
      workAmoBroadcastAdmission,
    ) &&
    /activation\?\.reached === true[\s\S]*metadata\?\.writeAdmission === true[\s\S]*metadata\?\.protocolReady === true[\s\S]*metadata\?\.evidenceComplete === true[\s\S]*workAmoV8ActiveMutationDecision/u.test(
      workAmoBroadcastAdmission,
    ) &&
    /function workAmoV8ActiveMutationDecision[\s\S]*TOKEN_SEND_SUBATOMS_ACTION[\s\S]*workAmoV8BroadcastDecision/u.test(
      workAmoBroadcastAdmission,
    ) &&
    /WORK_AMO_V8_SEND3_BEFORE_ACTIVATION[\s\S]*if \(WORK_AMO_V6_DECLARATION_PINS_CONFIGURED\)/u.test(
      workAmoBroadcastAdmission,
    ) &&
    workAmoBroadcastAdmission.indexOf(
      "if (WORK_AMO_V8_DECLARATION_PINS_CONFIGURED)",
    ) <
      workAmoBroadcastAdmission.indexOf(
        "if (WORK_AMO_V6_DECLARATION_PINS_CONFIGURED)",
      ),
);
expect(
  "WORK mint broadcast admission preserves the exact wire amount and fails closed with all other V8 writes after activation",
  /workMintActions\.some\([\s\S]*mint\.amount !== WORK_TOKEN_MINT_AMOUNT[\s\S]*WORK_MINT_AMOUNT_INVALID/u.test(
    workAmoBroadcastAdmission,
  ) &&
    /activation\?\.reached === true[\s\S]*metadata\?\.writeAdmission === true[\s\S]*metadata\?\.protocolReady === true[\s\S]*metadata\?\.evidenceComplete === true[\s\S]*workTransferActions\.length > 0 \|\|[\s\S]*workMintActions\.length > 0[\s\S]*!protocolReady[\s\S]*WORK_AMO_V8_WRITES_PAUSED/u.test(
      workAmoBroadcastAdmission,
    ) &&
    /function workAmoV8ActiveMutationDecision[\s\S]*if \(workMintActions\.length > 0\)[\s\S]*workMintActions\.length === 1[\s\S]*marketplaceActions\.length === 0[\s\S]*signedTokenProtocolRecords\.length === 1[\s\S]*paysWorkRegistry === true[\s\S]*WORK_AMO_V8_MINT_SHAPE_INVALID/u.test(
      workAmoBroadcastAdmission,
    ) &&
    /workMintActions\[0\]\.amount !== WORK_TOKEN_MINT_AMOUNT[\s\S]*WORK_AMO_V8_MINT_AMOUNT_INVALID/u.test(
      workAmoBroadcastAdmission,
    ) &&
    /WORK_AMO_V8_DECLARATION_PINS_REQUESTED[\s\S]*WORK_MINT_AMOUNT_INVALID[\s\S]*if \(WORK_AMO_V8_DECLARATION_PINS_CONFIGURED\)/u.test(
      workAmoBroadcastAdmission,
    ),
);
expect(
  "precision migration binds exact declaration evidence and relicizes the D+1 opening deterministically",
  /WORK_PRECISION_V2_MIGRATION_MODEL =\s*"canonical-work-q8-to-q16-migration-v1"/u.test(
    workAmoV8Migration,
  ) &&
    /indexedWorkPrecisionV2DeclarationEvidence[\s\S]*JOIN proof_indexer\.op_returns carrier[\s\S]*carrier\.vout = \$5[\s\S]*carrier\.output_index = \$6/u.test(
      workAmoV8Migration,
    ) &&
    /indexedWorkPrecisionV2DeclarationEvidence[\s\S]*carrier\.payload_text[\s\S]*carrier\.payload_hex[\s\S]*carrier\.data_bytes/u.test(
      workAmoV8Migration,
    ) &&
    /coreWorkPrecisionV2DeclarationEvidence[\s\S]*getblockhash[\s\S]*getblock[\s\S]*declarationProtocolVout/u.test(
      workAmoV8Migration,
    ) &&
    /readWorkPrecisionV2ActivationOpening[\s\S]*transition\.block_height = \$1[\s\S]*scaleWorkPrecisionV2TokenState/u.test(
      workAmoV8Migration,
    ) &&
    /readWorkPrecisionV2ActivationOpening[\s\S]*canonical-work-amo-full-position-block-sequencer-v2/u.test(
      workAmoV8Migration,
    ) &&
    /DELETE FROM proof_indexer\.credit_balances[\s\S]*INSERT INTO proof_indexer\.credit_balances[\s\S]*expectedScaledState\.balances/u.test(
      workAmoV8Migration,
    ) &&
    /scaleWorkPrecisionV2TokenState[\s\S]*const relicListings =[\s\S]*listings: \[\][\s\S]*WORK_AMO_V8_RELIC_CUTOVER_MODEL/u.test(
      workAmoV8Migration,
    ) &&
    /expectedScaledState = \{[\s\S]*balances: scaledOpeningBalances,[\s\S]*listings: \[\][\s\S]*relicCutover: activationOpening\.relicCutover/u.test(
      workAmoV8Migration,
    ) &&
    /WITH relic AS[\s\S]*'actionable', false[\s\S]*'relic', true[\s\S]*'relicCutoverModel'[\s\S]*status = 'dropped'/u.test(
      workAmoV8Migration,
    ) &&
    /AS active_count[\s\S]*AS relic_count[\s\S]*active_count \?\? -1\) !== 0[\s\S]*relic_count \?\? -1\) !== relicItems\.length/u.test(
      workAmoV8Migration,
    ) &&
    /verifyWorkPrecisionV2RowsConserved[\s\S]*WORK_PRECISION_V2_MIGRATION_META_KEY[\s\S]*workPrecisionV2MarkerMatches/u.test(
      workAmoV8Migration,
    ),
);
expect(
  "precision readiness rejects every wrong-era WORK transfer and listing mutation",
  /AS invalid_post_activation_legacy_count[\s\S]*AS invalid_pre_activation_v7_count/u.test(
    reader,
  ) &&
    /event\.block_height >= \$11[\s\S]*event\.raw_payload LIKE 'pwt1:send:%'[\s\S]*event\.raw_payload LIKE 'pwt1:send2:%'[\s\S]*event\.kind = 'token-listing'[\s\S]*saleAuthorization'->>'version'[\s\S]*<> \$12/u.test(
      reader,
    ) &&
    /event\.block_height < \$11[\s\S]*event\.raw_payload LIKE 'pwt1:send3:%'[\s\S]*event\.kind = 'token-listing'[\s\S]*saleAuthorization'->>'version'[\s\S]*= \$12/u.test(
      reader,
    ) &&
    /WORK_AMO_V8_AUTH_VERSION,[\s\S]*WORK_AMO_V8_BLOCK_SEQUENCER_MODEL/u.test(
      reader,
    ) &&
    /Number\(row\.invalid_post_activation_legacy_count\) === 0[\s\S]*Number\(row\.invalid_pre_activation_v7_count\) === 0/u.test(
      reader,
    ),
);
expect(
  "precision readiness is bound to the exact canonical DB and Core tip hash",
  /\) AS tip_height,[\s\S]*\) AS tip_hash,[\s\S]*\) AS transition_height,[\s\S]*\) AS transition_hash/u.test(
    reader,
  ) &&
    /const tipHash = normalizedLowerText\(row\.tip_hash\)[\s\S]*Number\(row\.transition_height\) === tipHeight[\s\S]*\/\^\[0-9a-f\]\{64\}\$\/u\.test\(tipHash\)[\s\S]*normalizedLowerText\(row\.transition_hash\) === tipHash/u.test(
      reader,
    ) &&
    /return \{[\s\S]*replayReady,[\s\S]*status: ready \? "complete" : "not-ready",[\s\S]*tipHash,[\s\S]*tipHeight/u.test(
      reader,
    ),
);
expect(
  "snapshots are stamped and selected by the exact WORK precision model at their checkpoint",
  /function workDefinitionStorageModel[\s\S]*const q8 =[\s\S]*WORK_ATOMIC_PROJECTION_MODEL[\s\S]*const q16 =[\s\S]*WORK_SUBATOM_PROJECTION_MODEL[\s\S]*: ""/u.test(
    reader,
  ) &&
    /async function currentWorkAmountStorageModel[\s\S]*LIMIT 2[\s\S]*result\.rows\.length === 1[\s\S]*workDefinitionStorageModel/u.test(
      reader,
    ) &&
    /async function workAmountStorageModelAtHeight[\s\S]*WORK_PRECISION_V2_MIGRATION_META_KEY[\s\S]*marker\.status !== "complete"[\s\S]*height < activationHeight[\s\S]*WORK_ATOMIC_PROJECTION_MODEL[\s\S]*WORK_SUBATOM_PROJECTION_MODEL/u.test(
      reader,
    ) &&
    /async function storeLedgerSnapshot[\s\S]*currentWorkProjectionModel\(client,[\s\S]*if \(!workAmountStorageModel\)[\s\S]*snapshotPayload = \{[\s\S]*workAmountStorageModel/u.test(
      backfill,
    ) &&
    /async function storeCanonicalSummarySnapshot[\s\S]*workProjectionModelAtHeight\(\s*client,\s*summaryCheckpointHeight[\s\S]*if \(!workAmountStorageModel\)[\s\S]*snapshotPayload = \{[\s\S]*workAmountStorageModel/u.test(
      backfill,
    ) &&
    /async function ledgerSnapshot\([\s\S]*payload->>'workAmountStorageModel' =\s*ANY\(\$3::text\[\]\)[\s\S]*currentWorkAmountStorageModel\(pool, network\)[\s\S]*payload->>'workAmountStorageModel' = \$2/u.test(
      reader,
    ),
);
expect(
  "WORK definition reads reject missing or conflicting precision metadata instead of falling back to Q8",
  /function tokenDefinitionFromRow[\s\S]*const workStorageModel = isWorkTokenId\(tokenId\)[\s\S]*workDefinitionStorageModel\(row\)[\s\S]*isWorkTokenId\(tokenId\) && !workStorageModel[\s\S]*missing or conflicting Q8\/Q16 precision metadata/u.test(
    reader,
  ) &&
    !/function tokenDefinitionFromRow[\s\S]*amountStorageModel:\s*WORK_LEGACY_ATOMIC_PROJECTION_MODEL[\s\S]*const metadataWithoutPosition/u.test(
      reader,
    ),
);
expect(
  "backfill dispatches every mutable WORK projection through one explicit Q8 or Q16 definition state",
  /const WORK_PROJECTION_STATE_Q8 = "q8"[\s\S]*const WORK_PROJECTION_STATE_Q16 = "q16"[\s\S]*const WORK_PROJECTION_STATE_INVALID = "invalid"/u.test(
    backfill,
  ) &&
    /function workDefinitionProjectionState[\s\S]*const q8 =[\s\S]*WORK_ATOMIC_PROJECTION_MODEL[\s\S]*const q16 =[\s\S]*WORK_SUBATOM_PROJECTION_MODEL[\s\S]*WORK_PROJECTION_STATE_INVALID/u.test(
      backfill,
    ) &&
    /workPrecisionV2MarkerReady as sharedWorkPrecisionV2MarkerReady/u.test(
      backfill,
    ) &&
    /function workPrecisionV2MarkerAuthorizesQ16[\s\S]*sharedWorkPrecisionV2MarkerReady\(marker, pins,[\s\S]*network: NETWORK/u.test(
      backfill,
    ) &&
    /async function upsertProjection[\s\S]*WORK definition projection cannot update without one exact active Q8 or Q16 model[\s\S]*WORK holder projection cannot update without one exact active Q8 or Q16 model[\s\S]*WORK listing projection cannot update without one exact active Q8 or Q16 model/u.test(
      backfill,
    ) &&
    /function workBalanceForProjection[\s\S]*Q8 WORK balance storage cannot accept native subatom aliases[\s\S]*Native Q16 WORK balance storage cannot accept legacy atom aliases[\s\S]*Native Q16 WORK balance aliases are ambiguous/u.test(
      backfill,
    ),
);
expect(
  "WORK mint projection preserves Q8 history and maps the unchanged wire amount to exact Q16 only from D+1",
  /async function protocolIntegrityItemForPersistence[\s\S]*item\?\.kind[\s\S]*"token-mint"[\s\S]*isWorkTokenId\(item\?\.tokenId\)[\s\S]*currentWorkPrecisionV2Marker[\s\S]*const activationHeight = Number\(marker\?\.activationHeight\)[\s\S]*blockHeight >= activationHeight[\s\S]*String\(item\?\.amount \?\? ""\) !== "1000"[\s\S]*amountSubatoms: WORK_TOKEN_MINT_AMOUNT_SUBATOMS/u.test(
    backfill,
  ) &&
    /const WORK_TOKEN_MINT_AMOUNT_SUBATOMS =\s*WORK_AMO_V8_MINT_AMOUNT_SUBATOMS\.toString\(\)/u.test(
      backfill,
    ),
);
expect(
  "backfill reconstructs Mail and Inception WORK attachments in canonical Q16 across both transfer eras",
  /function preparedProtocolItemsWithCanonicalMailAttachments[\s\S]*const nativeQ16 =[\s\S]*WORK_SUBATOM_PROJECTION_MODEL[\s\S]*WORK_AMO_V8_TRANSFER_VERSION[\s\S]*canonicalWorkSubatomsText\(item\?\.amountSubatoms\)[\s\S]*BigInt\(amountAtoms\) \* WORK_ATOM_TO_SUBATOM_SCALE/u.test(
    backfill,
  ) &&
    /nativeQ16[\s\S]*item\?\.amountAtoms[\s\S]*!nativeQ16[\s\S]*item\?\.amountSubatoms[\s\S]*withWorkSubatomPrecisionMetadata\([\s\S]*amountSubatoms,[\s\S]*legacyAmountAtoms:[\s\S]*legacyAmountStorageModel:[\s\S]*precisionModel: WORK_AMO_V8_GLOBAL_PRECISION_MODEL/u.test(
      backfill,
    ) &&
    /existing\.amountSubatoms !== transfer\.amountSubatoms/u.test(
      backfill,
    ),
);
expect(
  "V8 replay readiness rejects stale, forked, missing-model, and Q8 snapshots at the exact tip",
  /current_snapshot\.snapshot_height,[\s\S]*current_snapshot\.snapshot_hash,[\s\S]*current_snapshot\.snapshot_work_amount_storage_model/u.test(
    reader,
  ) &&
    /snapshot\.payload->>'workAmountStorageModel' = \$15[\s\S]*snapshot\.consistency->>'ok'[\s\S]*= 'true'[\s\S]*snapshot\.consistency->>'status'[\s\S]*= 'green'[\s\S]*summaryRefresh'->>'mode' =\s*'canonical-summary-refresh'/u.test(
      reader,
    ) &&
    /snapshot\.payload->>'indexedThroughBlockHash'[\s\S]*snapshot\.source_hashes->>'blockScan'[\s\S]*summaryRefresh'[\s\S]*indexedThroughBlockHash/u.test(
      reader,
    ) &&
    /Number\(row\.snapshot_height\) === tipHeight[\s\S]*snapshotHash === tipHash[\s\S]*row\.snapshot_work_amount_storage_model ===\s*WORK_SUBATOM_PROJECTION_MODEL/u.test(
      reader,
    ),
);
expect(
  "V8 declaration builder adds one presentation newline outside the exact declaration commitment",
  /presentation newline is not part of declaration\.text or either hash/u.test(
    workAmoV8DeclarationBuilder,
  ) &&
    /process\.stdout\.write\(`\$\{declaration\.text\}\\n`\);/u.test(
      workAmoV8DeclarationBuilder,
    ) &&
    /precisionRule=from activation,[\s\S]*maximum supply, mint increment, supply, balances, transfers, reservations, and listing amounts use exactly sixteen decimal places/u.test(
      workAmoV8Declaration,
    ) &&
    /precisionMigrationRule=at the activation opening boundary,[\s\S]*each confirmed canonical current eight-decimal WORK atom becomes exactly 100000000 sixteen-decimal subatoms[\s\S]*raw confirmed history is not rewritten/u.test(
      workAmoV8Declaration,
    ) &&
    /allowedFaceProofs=\$\{WORK_AMO_V8_ALLOWED_FACE_PROOFS\.join\(","\)\}/u.test(
      workAmoV8Declaration,
    ) &&
    /unitFormula=unitPriceSats=F;unitAmountSubatoms=floor[\s\S]*unitMinimumPriceSats=ceil/u.test(
      workAmoV8Declaration,
    ) &&
    !/unitPriceProofs=|unitMinimumPriceProofs=/u.test(
      workAmoV8Declaration,
    ) &&
    /settlementRule=a confirmed V8 listing may be sealed or purchased only with its frozen terms[\s\S]*readinessFailureRule=[\s\S]*no legacy precision or listing protocol is re-enabled after activation/u.test(
      workAmoV8Declaration,
    ),
);
expect(
  "V8 admission auto-discovers the exact declaration and irreversibly closes legacy writes without a manual-pin window",
  /async function discoverExactWorkAmoV8Declaration[\s\S]*workAmoV8DeclarationEmbargoLatch = true[\s\S]*canonical-registry-discovery/u.test(
    server,
  ) &&
    /WORK_AMO_V8_DECLARATION_DISCOVERY_UNAVAILABLE[\s\S]*WORK_AMO_V8_LEGACY_WRITE_EMBARGO[\s\S]*WORK_AMO_V8_PINS_REQUIRED_AFTER_DECLARATION/u.test(
      server,
    ) &&
    /async function discoverIndexedWorkAmoV8DeclarationPins[\s\S]*exact_carrier_count[\s\S]*registry_payment_count[\s\S]*ORDER BY[\s\S]*tx\.block_height ASC,[\s\S]*tx\.block_index ASC/u.test(
      backfill,
    ) &&
    /async function persistWorkAmoV8ActivationLatch/u.test(
      backfill,
    ),
);

async function optionalLiveChecks() {
  const base = String(process.env.POW_API_BASE ?? "").replace(/\/+$/u, "");
  if (!base) {
    return;
  }
  const getJson = async (path) => {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    return response.json();
  };
  for (const route of [
    "/api/v1/log-summary?network=livenet",
    "/api/v1/token-summary?network=livenet",
    "/api/v1/work-floor?network=livenet",
    "/api/v1/marketplace-summary?network=livenet",
    "/api/v1/growth-summary?network=livenet",
  ]) {
    const payload = await getJson(route);
    expect(`${route} exposes coherent provenance`, payload?.provenance?.coherent === true);
    expect(`${route} exposes a snapshot id`, Boolean(payload?.provenance?.snapshotId));
  }
  const logPage = await getJson("/api/v1/log?network=livenet&limit=1");
  const items = Array.isArray(logPage?.items)
    ? logPage.items
    : Array.isArray(logPage?.activity)
      ? logPage.activity
      : [];
  expect("legacy Log limit=1 returns at most one row", items.length <= 1);
  expect(
    "legacy Log pagination exposes totalCount",
    Number.isFinite(Number(logPage?.totalCount)),
  );
}

await optionalLiveChecks();

if (failures.length > 0) {
  console.error("API truth contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("API truth contract check passed.");
