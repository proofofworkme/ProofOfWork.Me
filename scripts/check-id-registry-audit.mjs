#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertAuditMatchesCoverage,
  auditConfiguration,
  buildAuditResult,
  compareCanonicalUtf8,
  fetchRegistryAuditData,
  fetchRegistryTransactions,
  runAudit,
} from "./audit-id-registry.mjs";
import {
  PWID_RAW_REPLAY_ACTIVATION_HEIGHT,
  advanceIdRegistryAuditRollingHash,
  advanceIdRegistryAuditTransitionChain,
  assertIdRegistryAuditAttemptPositionCoverage,
  assertIdRegistryAuditFinalFence,
  createIdRegistryAuditRollingHash,
  createIdRegistryAuditTransitionChain,
  finalizeIdRegistryAuditTransitionChain,
  qualifiedLegacyPwidOutcome,
  qualifiedPostActivationPwidOutcome,
} from "../server/id-registry-audit-contract.mjs";
import {
  decodeWorkAmoV5CanonicalBase64UrlJsonObject,
  workAmoV5HasNoTextStorageNul,
} from "../server/work-amo-v5.mjs";

const source = readFileSync("scripts/audit-id-registry.mjs", "utf8");
const serverSource = readFileSync("server/proof-api.mjs", "utf8");
const readerSource = readFileSync("server/db/proof-index-reader.mjs", "utf8");
assert.doesNotMatch(source, /mempool\.space|blockchain\.info/u);
assert.doesNotMatch(source, /txs\/mempool/u);
assert.match(source, /\/api\/v1\/address\/\$\{encodeURIComponent\(REGISTRY_ADDRESS\)\}/u);
assert.doesNotMatch(source, /\/api\/v1\/block\/\$\{normalizedHash\}\/txids/u);
assert.match(source, /\/api\/v1\/internal\/id-registry-audit/u);
assert.match(source, /\/api\/v1\/internal\/id-registry-audit-fence/u);
assert.match(source, /"x-pow-internal-verifier"/u);
assert.match(serverSource, /forceCanonicalFallback:\s*authenticatedLoopbackRead/u);
assert.match(
  serverSource,
  /hydrateExactConfirmedRegistryHistory[\s\S]*idRegistryStateFromTransactions[\s\S]*chainProjection\.projectionSha256[\s\S]*registryProjection\.projectionSha256/u,
);
assert.match(
  serverSource,
  /updatedHeight > checkpoint\.height/u,
);
assert.match(
  serverSource,
  /!confirmedHistory\.has\(record\.lastEventTxid\)/u,
);
assert.match(
  serverSource,
  /function registryAuditRawReplayAcceptedEvent[\s\S]*dataBytes:\s*Buffer\.byteLength\(protocolPayload,\s*"utf8"\)[\s\S]*protocolPayloadSha256:\s*createHash\("sha256"\)[\s\S]*\.update\(protocolPayload,\s*"utf8"\)[\s\S]*\.digest\("hex"\)/u,
);
assert.doesNotMatch(
  `${serverSource}\n${readerSource}\n${source}`,
  /ID_REGISTRY_AUDIT_MAX_CONFIRMED_TXS|ID_REGISTRY_AUDIT_MAX_RAW_REPLAY_BLOCKS|ID_REGISTRY_AUDIT_MAX_ROWS|POW_ID_AUDIT_MAX_PAGES|value\.length > 10_000/u,
);
assert.match(
  readerSource,
  /proofIndexIdRegistryAuditStream/u,
);
assert.match(
  readerSource,
  /work_amo_block_transitions[\s\S]*transition\.block_height > \$2[\s\S]*ORDER BY transition\.block_height[\s\S]*LIMIT \$4/u,
);
assert.match(
  readerSource,
  /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY[\s\S]*assertIdRegistryAuditFinalFence/u,
);
assert.match(
  readerSource,
  /event_tx\.block_time = event_row\.block_time[\s\S]*event_row\.event_time = event_tx\.block_time/u,
);
assert.match(
  readerSource,
  /transactionBlockTimeMs[\s\S]*new Date\(transactionBlockTimeValue\)\.getTime\(\)[\s\S]*blockTimeMs !== transactionBlockTimeMs[\s\S]*eventTimeMs !== transactionBlockTimeMs/u,
);
assert.doesNotMatch(
  readerSource,
  /blockTimeValue !== transactionBlockTimeValue|eventTimeValue !== transactionBlockTimeValue/u,
);
const equalTimestampLeft = new Date("2026-08-26T06:24:33.349Z");
const equalTimestampRight = new Date("2026-08-26T06:24:33.349Z");
assert.notEqual(
  equalTimestampLeft,
  equalTimestampRight,
  "PostgreSQL returns separately parsed timestamp objects for separate columns.",
);
assert.equal(
  equalTimestampLeft.getTime(),
  equalTimestampRight.getTime(),
  "ID audit evidence must compare equal timestamp instants rather than Date identities.",
);
assert.doesNotMatch(
  readerSource,
  /ID_REGISTRY_AUDIT_SERIALIZED_RESPONSE_LIMIT_EXCEEDED|ID_REGISTRY_AUDIT_BYTE_LIMIT_EXCEEDED/u,
);
assert.match(readerSource, /SET LOCAL statement_timeout = '30s'/u);
assert.match(readerSource, /SET LOCAL lock_timeout = '5s'/u);
assert.match(
  serverSource,
  /registryAuditCanonicalPwidCarriers[\s\S]*canonicalRawProtocolRecordSetFromTransaction[\s\S]*registryAuditAttemptParity/u,
);
assert.match(
  serverSource,
  /completeIdVerifierStateBundle[\s\S]*registryAuditProjectionSha256\(stored\.payload\)[\s\S]*registryAuditProjectionSha256\(transition\)/u,
);
assert.match(
  serverSource,
  /registryAuditRawReplayOutcome[\s\S]*canonicalReplayOutcomeCount[\s\S]*canonicalReplayOutcomeSha256/u,
);
const rawReplayAuditSource = serverSource.slice(
  serverSource.indexOf("async function registryAuditCanonicalRawReplay"),
  serverSource.indexOf(
    "function registryAuditProjectionFromCanonicalState",
    serverSource.indexOf("async function registryAuditCanonicalRawReplay"),
  ),
);
assert.match(
  rawReplayAuditSource,
  /for \(const record of pwidRecords\)[\s\S]*outcomes\.push\([\s\S]*if \(record\?\.outcome\?\.valid !== true\)[\s\S]*acceptedEvents\.push/u,
  "Every raw PWID attempt must be retained before valid lifecycle projection.",
);

const auditHash = (value) => BigInt(value).toString(16).padStart(64, "0");
function transitionFixture({
  closingNetworkValueQ8 = "100",
  closingStateSha256,
  hash,
  height,
  openingNetworkValueQ8 = "100",
  openingStateSha256,
  previousHash,
  replayRecords = [],
}) {
  const stateModel = "fixture-state-v1";
  const eventModel = "fixture-event-set-v1";
  const commitment = (model, sha256, payloadBytes = 32) => ({
    model,
    payloadBytes,
    sha256,
  });
  const eventSet = commitment(eventModel, auditHash(height + 50_000));
  const opening = commitment(stateModel, openingStateSha256);
  const closing = commitment(stateModel, closingStateSha256);
  const transitionChain = commitment(
    "fixture-transition-chain-v1",
    auditHash(height + 60_000),
  );
  const replayDescriptor = commitment(
    "fixture-replay-descriptor-v1",
    auditHash(height + 70_000),
  );
  const blockDescriptor = commitment(
    "fixture-block-descriptor-v1",
    auditHash(height + 80_000),
  );
  const payload = {
    blockAtomic: true,
    blockDescriptorCommitment: blockDescriptor,
    blockHash: hash,
    blockHeight: height,
    closingNetworkValueQ8,
    closingStateCommitment: closing,
    complete: true,
    eventCount: replayRecords.length,
    eventSetCommitment: eventSet,
    feeOnce: true,
    invalidZero: true,
    model: "fixture-block-sequencer-v1",
    openingNetworkValueQ8,
    openingStateCommitment: opening,
    previousBlockHash: previousHash,
    protocolRecordCount: replayRecords.length,
    rawProtocolCandidateCount: replayRecords.length,
    replayDescriptorCommitment: replayDescriptor,
    replayRecords,
    transactionCount: replayRecords.length,
    transitionChainCommitment: transitionChain,
    transitionChainModel: transitionChain.model,
  };
  return {
    blockAtomic: true,
    blockHash: hash,
    blockHeight: height,
    canonicalPreviousBlockHash: previousHash,
    closingNetworkValueQ8,
    closingStatePayloadBytes: closing.payloadBytes,
    closingStateSha256,
    complete: true,
    eventCount: replayRecords.length,
    eventSetModel: eventModel,
    eventSetPayloadBytes: eventSet.payloadBytes,
    eventSetSha256: eventSet.sha256,
    feeOnce: true,
    invalidZero: true,
    model: payload.model,
    openingNetworkValueQ8,
    openingStatePayloadBytes: opening.payloadBytes,
    openingStateSha256,
    payload,
    previousBlockHash: previousHash,
    protocolRecordCount: replayRecords.length,
    rawProtocolCandidateCount: replayRecords.length,
    stateCommitmentModel: stateModel,
    transactionCount: replayRecords.length,
  };
}

// More than both retired lifetime ceilings must stream successfully.
let rolling = createIdRegistryAuditRollingHash("id-audit-over-old-row-cap");
for (let start = 0; start < 6_144; start += 137) {
  rolling = advanceIdRegistryAuditRollingHash(
    rolling,
    Array.from(
      { length: Math.min(137, 6_144 - start) },
      (_, offset) => ({ position: start + offset }),
    ),
  );
}
assert.equal(rolling.count, 6_144);

const transitionCount = 300;
const transitionStart = PWID_RAW_REPLAY_ACTIVATION_HEIGHT;
const transitions = [];
let previousHash = auditHash(900_000);
let openingStateSha256 = auditHash(910_000);
for (let offset = 0; offset < transitionCount; offset += 1) {
  const height = transitionStart + offset;
  const hash = auditHash(920_000 + offset);
  const closingStateSha256 = auditHash(930_000 + offset);
  transitions.push(
    transitionFixture({
      closingStateSha256,
      hash,
      height,
      openingStateSha256,
      previousHash,
    }),
  );
  previousHash = hash;
  openingStateSha256 = closingStateSha256;
}
let transitionState = createIdRegistryAuditTransitionChain({
  checkpointHash: transitions.at(-1).blockHash,
  checkpointHeight: transitions.at(-1).blockHeight,
});
for (let start = 0; start < transitions.length; start += 64) {
  transitionState = advanceIdRegistryAuditTransitionChain(
    transitionState,
    transitions.slice(start, start + 64),
  );
}
assert.equal(
  finalizeIdRegistryAuditTransitionChain(transitionState).transitionCount,
  transitionCount,
);

const firstTransition = transitions[0];
const oneTransitionState = () =>
  createIdRegistryAuditTransitionChain({
    checkpointHash: firstTransition.blockHash,
    checkpointHeight: firstTransition.blockHeight,
  });
assert.throws(
  () =>
    advanceIdRegistryAuditTransitionChain(oneTransitionState(), [
      {
        ...firstTransition,
        blockHeight: firstTransition.blockHeight + 1,
        payload: {
          ...firstTransition.payload,
          blockHeight: firstTransition.blockHeight + 1,
        },
      },
    ]),
  /contiguous|commitments/u,
  "A transition cursor gap/tamper must fail closed.",
);
assert.throws(
  () =>
    advanceIdRegistryAuditTransitionChain(oneTransitionState(), [
      {
        ...firstTransition,
        canonicalPreviousBlockHash: auditHash(999_001),
      },
    ]),
  /commitments/u,
  "A canonical previous-hash mismatch must fail closed.",
);
assert.throws(
  () =>
    advanceIdRegistryAuditTransitionChain(
      advanceIdRegistryAuditTransitionChain(
        createIdRegistryAuditTransitionChain({
          checkpointHash: transitions[1].blockHash,
          checkpointHeight: transitions[1].blockHeight,
        }),
        [transitions[0]],
      ),
      [{
        ...transitions[1],
        openingNetworkValueQ8: "101",
        payload: {
          ...transitions[1].payload,
          openingNetworkValueQ8: "101",
        },
      }],
    ),
  /commitments|contiguous/u,
  "An opening-state mismatch must fail closed.",
);
assert.throws(
  () =>
    advanceIdRegistryAuditTransitionChain(oneTransitionState(), [
      {
        ...firstTransition,
        eventSetSha256: auditHash(999_002),
      },
    ]),
  /commitments/u,
  "A transition commitment mismatch must fail closed.",
);
assert.throws(
  () =>
    finalizeIdRegistryAuditTransitionChain({
      ...oneTransitionState(),
      nextHeight: firstTransition.blockHeight + 1,
      lastBlockHash: auditHash(999_003),
    }),
  /checkpoint/u,
  "A final transition fence mismatch must fail closed.",
);
assert.throws(
  () =>
    assertIdRegistryAuditFinalFence(
      { rows: { count: 1, sha256: auditHash(1) } },
      { rows: { count: 1, sha256: auditHash(2) } },
    ),
  /drifted/u,
);

const omittedZeroPaymentAttempt = {
  amountSats: 0,
  blockHeight: transitionStart,
  blockIndex: 3,
  protocolVout: 1,
  recordOrdinal: 0,
  txid: auditHash(123_456),
};
assert.throws(
  () =>
    assertIdRegistryAuditAttemptPositionCoverage(
      [omittedZeroPaymentAttempt],
      [],
    ),
  /disagree/u,
  "A completely omitted zero-payment PWID row must be detected from transition discovery.",
);
const canonicalProjectionSource = serverSource.slice(
  serverSource.indexOf("function registryAuditProjectionFromCanonicalState"),
  serverSource.indexOf(
    "function registryAuditRelationalRawClosingState",
    serverSource.indexOf("function registryAuditProjectionFromCanonicalState"),
  ),
);
assert.match(
  canonicalProjectionSource,
  /rawReplay\?\.closingState\?\.records[\s\S]*rawReplay\?\.closingState\?\.listings/u,
  "Confirmed post-activation records and listings must come from raw replay closing state.",
);
assert.match(
  canonicalProjectionSource,
  /const pendingRecords = \(Array\.isArray\(state\?\.records\)[\s\S]*record\?\.confirmed !== true/u,
  "Raw confirmed closing state must never be reclassified as pending records.",
);
assert.match(
  canonicalProjectionSource,
  /event\.kind === "id-buy"[\s\S]*event\.blockHeight >= PWID_RAW_REPLAY_ACTIVATION_HEIGHT/u,
  "Every accepted post-activation raw buy must enter canonical sale history.",
);
assert.match(
  readerSource,
  /payload\.tipHeight[\s\S]*block-scan-current|scanPayload\.tipHeight[\s\S]*block-scan-current/u,
);
assert.match(
  readerSource,
  /replay_metadata_present[\s\S]*raw_script_witness_present/u,
);
const parseIdEventSource = serverSource.match(
  /(function parseIdEventPayload\(payload, network\) \{[\s\S]*?\n\})\n\nfunction shortAddress/u,
)?.[1];
assert.ok(parseIdEventSource, "The pending ID parser must remain inspectable.");
assert.equal(
  workAmoV5HasNoTextStorageNul({
    id: "safe",
    saleAuthorization: { nonce: "safe" },
  }),
  true,
);
assert.equal(workAmoV5HasNoTextStorageNul({ id: "unsafe\u0000id" }), false);
assert.equal(
  workAmoV5HasNoTextStorageNul({
    saleAuthorization: { nonce: "unsafe\u0000nonce" },
  }),
  false,
);
assert.equal(
  workAmoV5HasNoTextStorageNul({
    saleAuthorization: { "unsafe\u0000key": true },
  }),
  false,
);
const nullParser = () => null;
const isolatedIdEventParser = Function(
  "workAmoV5HasNoTextStorageNul",
  "parseIdRegistrationPayload",
  "parseIdReceiverUpdatePayload",
  "parseIdTransferPayload",
  "parseIdMarketplaceTransferPayload",
  "parseIdListingPayload",
  "parseIdSaleSealPayload",
  "parseIdDelistingPayload",
  `"use strict"; return (${parseIdEventSource});`,
)(
  workAmoV5HasNoTextStorageNul,
  () => ({
    id: "unsafe\u0000id",
    ownerAddress: "owner",
    pgpKey: "",
    receiveAddress: "receiver",
  }),
  nullParser,
  nullParser,
  nullParser,
  nullParser,
  nullParser,
  nullParser,
);
assert.equal(
  isolatedIdEventParser("r2:fixture", "livenet"),
  null,
  "Pending/legacy ID parsing must never return a decoded NUL-bearing event.",
);

const rawTokenSaleAuthorizationSource = serverSource.match(
  /(function rawTokenSaleAuthorization\(message\) \{[\s\S]*?\n\})\n\nfunction signedTransactionInputOutpoints/u,
)?.[1];
assert.ok(
  rawTokenSaleAuthorizationSource,
  "The raw token sale-authorization boundary must remain inspectable.",
);
const isolatedRawTokenSaleAuthorization = Function(
  "TOKEN_PROTOCOL_PREFIX",
  "TOKEN_LIST_ACTION",
  "TOKEN_SEAL_ACTION",
  "TOKEN_BUY_ACTION",
  "decodeWorkAmoV5CanonicalBase64UrlJsonObject",
  `"use strict"; return (${rawTokenSaleAuthorizationSource});`,
)(
  "pwt1:",
  "list5",
  "seal5",
  "buy5",
  decodeWorkAmoV5CanonicalBase64UrlJsonObject,
);
const genericTokenId = "a".repeat(64);
const encodedSaleAuthorization = (authorization) =>
  Buffer.from(JSON.stringify(authorization), "utf8").toString("base64url");
const unicodeSaleAuthorization = {
  metadata: { label: "東京 🚀" },
  nonce: "雪-🚀-café",
  tokenId: genericTokenId,
};
assert.deepEqual(
  isolatedRawTokenSaleAuthorization(
    `pwt1:list5:${encodedSaleAuthorization(unicodeSaleAuthorization)}`,
  ),
  unicodeSaleAuthorization,
  "Canonical sale authorization decoding must preserve valid Unicode.",
);
for (const authorization of [
  { nonce: "unsafe\u0000nonce", tokenId: genericTokenId },
  {
    metadata: { nested: ["safe", "unsafe\u0000value"] },
    nonce: "safe",
    tokenId: genericTokenId,
  },
  {
    ["unsafe\u0000key"]: "value",
    nonce: "safe",
    tokenId: genericTokenId,
  },
]) {
  assert.equal(
    isolatedRawTokenSaleAuthorization(
      `pwt1:list5:${encodedSaleAuthorization(authorization)}`,
    ),
    null,
    "Decoded sale-authorization NUL keys and values must fail closed.",
  );
}
const malformedUtf8Authorization = Buffer.concat([
  Buffer.from(`{"tokenId":"${genericTokenId}","nonce":"`, "utf8"),
  Buffer.from([0x80]),
  Buffer.from('"}', "utf8"),
]).toString("base64url");
assert.equal(
  isolatedRawTokenSaleAuthorization(
    `pwt1:list5:${malformedUtf8Authorization}`,
  ),
  null,
  "Malformed UTF-8 must not become replacement-character authorization JSON.",
);
assert.equal(
  isolatedRawTokenSaleAuthorization(
    `pwt1:list5:${encodedSaleAuthorization(unicodeSaleAuthorization)}=`,
  ),
  null,
  "Noncanonical base64url authorization bytes must fail exact round-trip.",
);
assert.equal(
  isolatedRawTokenSaleAuthorization(
    `pwt1:list5: ${encodedSaleAuthorization(unicodeSaleAuthorization)}`,
  ),
  null,
  "Sale-authorization base64url must not be normalized before its exact round-trip.",
);
const tokenPayloadParserSource = serverSource.slice(
  serverSource.indexOf("function parseTokenPayload"),
  serverSource.indexOf(
    "function normalizeTokenScope",
    serverSource.indexOf("function parseTokenPayload"),
  ),
);
assert.equal(
  [...tokenPayloadParserSource.matchAll(
    /canonicalSaleAuthorizationJsonFromBase64Url/gu,
  )].length,
  3,
  "List, seal, and buy sale-authorization paths must share the canonical decoder.",
);
assert.doesNotMatch(
  tokenPayloadParserSource,
  /decodeTextBase64Url/u,
  "Token sale-authorization parsing must not bypass canonical wire decoding.",
);
assert.match(
  serverSource,
  /function parseTokenSaleAuthorizationJson[\s\S]*!workAmoV5HasNoTextStorageNul\(parsed\)/u,
);
assert.match(
  serverSource,
  /function pendingWorkVerifierStageDecodedObject[\s\S]*return decodeWorkAmoV5CanonicalBase64UrlJsonObject\(value\)/u,
);
assert.doesNotMatch(
  serverSource,
  /JSON\.parse\(decodeTextBase64Url/u,
  "No proof-API JSON authorization helper may retain the lossy decoder bypass.",
);
assert.match(
  serverSource,
  /registryAuditElectrumCheckpoint[\s\S]*blockchain\.block\.header[\s\S]*electrumCheckpointHash/u,
);
const publicIdActivitySource = serverSource.slice(
  serverSource.indexOf("function idActivityItemsFromEvents"),
  serverSource.indexOf("function formatBytes", serverSource.indexOf("function idActivityItemsFromEvents")),
);
assert.match(publicIdActivitySource, /dataBytes: event\.dataBytes \?\? 0/u);
assert.doesNotMatch(
  publicIdActivitySource,
  /protocolDataBytes|protocolPayload|protocolVout|recordOrdinal|spentOutpoints|recipients:/u,
);
const registryResolverSource = serverSource.slice(
  serverSource.indexOf("function idRegistryStateFromTransactions"),
  serverSource.indexOf("function idRecordsFromTransactions", serverSource.indexOf("function idRegistryStateFromTransactions")),
);
assert.match(
  registryResolverSource,
  /initialConfirmedState = options\.initialConfirmedState[\s\S]*normalizeWorkAmoV5RawIdState[\s\S]*confirmed: true/u,
  "Pending lifecycle validation must support an exact confirmed-state seed.",
);
assert.match(
  serverSource,
  /const pendingState = idRegistryStateFromTransactions\([\s\S]*initialConfirmedState: rawReplay\.closingState[\s\S]*_powAuditEvents: legacyState\._powAuditEvents/u,
  "Pending ID actions must be evaluated on the canonical raw closing state while legacy audit events stay separately replayed.",
);
assert.match(
  registryResolverSource,
  /const eventPaymentOutputs = paymentOutputsBeforeIdProtocol\(vout\)/u,
);
assert.doesNotMatch(
  registryResolverSource,
  /paymentOutputsBeforeIdProtocol\(vout,\s*protocolVout/u,
);
assert.match(source, /POW_ID_AUDIT_COVERAGE_TIMEOUT_MS/u);
assert.match(source, /AbortSignal\.timeout\(timeoutMs\)/u);
assert.match(source, /\{ flag: "wx" \}/u);
assert.match(source, /writeReports && directory/u);
assert.match(
  source,
  /function summarizeByRefundAddress[\s\S]*sats: 0n[\s\S]*checkedSatsNumber/u,
  "Refund totals must aggregate with BigInt and fail before inexact JSON conversion.",
);

const supplementaryCodePoint = "\u{10000}";
const privateUseBmpCodePoint = "\u{e000}";
assert.equal(
  supplementaryCodePoint < privateUseBmpCodePoint,
  true,
  "The regression vector must reverse UTF-16 and unsigned UTF-8 order.",
);
assert.deepEqual(
  [supplementaryCodePoint, privateUseBmpCodePoint].sort(compareCanonicalUtf8),
  [privateUseBmpCodePoint, supplementaryCodePoint],
  "Canonical audit ordering must compare unsigned UTF-8 bytes.",
);

const emptyLegacyReplayMetadata = {
  payloadSource: "",
  replayBound: false,
  replayMetadataPresent: false,
  replayOutcomeKind: "",
  replayOutcomeValid: null,
  replayRawCandidate: null,
};
assert.equal(
  qualifiedLegacyPwidOutcome({
    accepted: true,
    blockHeight: 956_029,
    invalidRow: {
      ...emptyLegacyReplayMetadata,
      kind: "id-list-invalid",
      reasonCode:
        "The canonical first-party verifier rejected this protocol event.",
      validationMode: "",
    },
    parsedAttempt: { kind: "list" },
  }),
  "same-carrier-contradictory-diagnostic-row",
);
assert.equal(
  qualifiedLegacyPwidOutcome({
    accepted: false,
    blockHeight: 948_418,
    invalidRow: {
      ...emptyLegacyReplayMetadata,
      kind: "id-event-invalid",
      reasonCode: "Malformed ProofOfWork ID protocol payload.",
      validationMode: "canonical-first-party-state",
    },
    parsedAttempt: null,
  }),
  "legacy-malformed-parser-rejection",
);
assert.throws(
  () =>
    qualifiedLegacyPwidOutcome({
      accepted: false,
      blockHeight: 948_418,
      invalidRow: {
        ...emptyLegacyReplayMetadata,
        kind: "id-event-invalid",
        reasonCode: "Malformed ProofOfWork ID protocol payload.",
        validationMode: "canonical-first-party-state",
      },
      parsedAttempt: { kind: "register" },
    }),
  /not independently qualified/u,
);
assert.throws(
  () =>
    qualifiedLegacyPwidOutcome({
      accepted: true,
      blockHeight: 959_621,
      invalidRow: {
        ...emptyLegacyReplayMetadata,
        kind: "id-list-invalid",
        reasonCode:
          "The canonical first-party verifier rejected this protocol event.",
        validationMode: "",
      },
      parsedAttempt: { kind: "list" },
    }),
  /outside the qualified legacy audit domain/u,
);

const postActivationCarrier = {
  blockIndex: 2_174,
  blockHeight: PWID_RAW_REPLAY_ACTIVATION_HEIGHT + 496,
  protocolVout: 1,
  rawDecodeDetail: "",
  rawDecodeReasonCode: "",
  rawDecodeValid: true,
  rawPayload: "pwid1:r2:fixture",
  rawPayloadHex: Buffer.from("pwid1:r2:fixture", "utf8").toString("hex"),
  rawPayloadSha256: createHash("sha256")
    .update(Buffer.from("pwid1:r2:fixture", "utf8"))
    .digest("hex"),
  recordOrdinal: 0,
  scriptPubKeyHex: "6a1170776964313a72323a66697874757265",
  scriptPubKeySha256: createHash("sha256")
    .update(Buffer.from("6a1170776964313a72323a66697874757265", "hex"))
    .digest("hex"),
  txid: "d".repeat(64),
};
const postActivationValidOutcome = {
  attributedRegistrySats: 1_000,
  consensusKind: "pwid1-valid",
  projectionKind: "id-register",
  rawCandidate: true,
  rawDecodeDetail: "",
  rawDecodeReasonCode: "",
  rawDecodeValid: true,
  rawPayloadHex: postActivationCarrier.rawPayloadHex,
  rawPayloadSha256: postActivationCarrier.rawPayloadSha256,
  reasonCode: "",
  scriptPubKeyHex: postActivationCarrier.scriptPubKeyHex,
  scriptPubKeySha256: postActivationCarrier.scriptPubKeySha256,
  semanticKind: "id-register",
  valid: true,
};
const rawWitnessRow = {
  amountSats: 1_000,
  attemptedKind: "",
  eventKey: `pwid1:id-register:${postActivationCarrier.txid}:v5:${postActivationCarrier.blockHeight}:${postActivationCarrier.blockIndex}:1:0`,
  payloadRawPayload: postActivationCarrier.rawPayload,
  payloadRawPayloadPresent: true,
  payloadRawPayloadSha256: postActivationCarrier.rawPayloadSha256,
  payloadReason: "",
  payloadReasonCode: "",
  rawScriptDecodeDetail: "",
  rawDecodeReasonCode: "",
  rawDecodeValid: true,
  rawScriptDecodeValid: true,
  rawScriptPayloadHex: postActivationCarrier.rawPayloadHex,
  rawScriptPubKeyHex: postActivationCarrier.scriptPubKeyHex,
  rawScriptReasonCode: "",
  rawScriptWitnessPresent: true,
  reasonCode: "",
  replayOutcomeReasonCode: "",
  storedRawPayload: postActivationCarrier.rawPayload,
  storedRawPayloadPresent: true,
  storedRawPayloadSha256: postActivationCarrier.rawPayloadSha256,
  validationErrors: [],
};
const metadataAbsentValidRow = {
  ...rawWitnessRow,
  kind: "id-register",
  replayBound: false,
  replayMetadataPresent: false,
  replayOutcomeKind: "",
  replayOutcomeValid: null,
  replayRawCandidate: null,
  valid: true,
};
assert.equal(
  qualifiedPostActivationPwidOutcome({
    acceptedEvent: { amountSats: 1_000, kind: "id-register" },
    carrier: postActivationCarrier,
    outcome: postActivationValidOutcome,
    row: metadataAbsentValidRow,
  }),
  "post-activation-valid-transition-bound-metadata-absent",
);
assert.equal(
  qualifiedPostActivationPwidOutcome({
    acceptedEvent: { amountSats: 1_000, kind: "id-register" },
    carrier: postActivationCarrier,
    outcome: postActivationValidOutcome,
    row: {
      ...metadataAbsentValidRow,
      replayBound: true,
      replayMetadataPresent: true,
      replayOutcomeKind: "pwid1-valid",
      replayOutcomeValid: true,
      replayRawCandidate: true,
    },
  }),
  "post-activation-valid-replay-bound",
);
assert.throws(
  () =>
    qualifiedPostActivationPwidOutcome({
      acceptedEvent: { amountSats: 1_000, kind: "id-register" },
      carrier: postActivationCarrier,
      outcome: postActivationValidOutcome,
      row: {
        ...metadataAbsentValidRow,
        replayMetadataPresent: true,
      },
    }),
  /replay metadata disagrees/u,
  "An explicitly present false/partial replay tuple must never count as absent.",
);

for (const rawDecodeReasonCode of [
  "work-amo-v5-raw-op-return-script-malformed",
  "work-amo-v5-raw-op-return-utf8-invalid",
  "work-amo-v5-raw-op-return-text-storage-invalid",
]) {
  const carrier = {
    ...postActivationCarrier,
    rawDecodeReasonCode,
    rawDecodeValid: false,
  };
  const outcome = {
    ...postActivationValidOutcome,
    attributedRegistrySats: 0,
    consensusKind: "pwid1-invalid",
    projectionKind: "protocol-event-invalid",
    rawDecodeReasonCode,
    rawDecodeValid: false,
    reasonCode: rawDecodeReasonCode,
    semanticKind: "protocol-event-invalid",
    valid: false,
  };
  const row = {
    ...rawWitnessRow,
    amountSats: 0,
    attemptedKind: "id-event",
    eventKey: `pwid1:id-event-invalid:${postActivationCarrier.txid}:v5:${postActivationCarrier.blockHeight}:${postActivationCarrier.blockIndex}:1:0`,
    kind: "id-event-invalid",
    rawDecodeReasonCode,
    rawDecodeValid: false,
    rawScriptDecodeValid: false,
    rawScriptReasonCode: rawDecodeReasonCode,
    payloadRawPayload: "pwid1:",
    payloadRawPayloadSha256: createHash("sha256")
      .update("pwid1:", "utf8")
      .digest("hex"),
    payloadReason: rawDecodeReasonCode,
    payloadReasonCode: rawDecodeReasonCode,
    reasonCode: rawDecodeReasonCode,
    replayBound: true,
    replayMetadataPresent: true,
    replayOutcomeKind: "pwid1-invalid",
    replayOutcomeReasonCode: rawDecodeReasonCode,
    replayOutcomeValid: false,
    replayRawCandidate: true,
    storedRawPayload: "pwid1:",
    storedRawPayloadSha256: createHash("sha256")
      .update("pwid1:", "utf8")
      .digest("hex"),
    valid: false,
    validationErrors: [rawDecodeReasonCode],
  };
  assert.equal(
    qualifiedPostActivationPwidOutcome({
      acceptedEvent: null,
      carrier,
      outcome,
      row,
    }),
    "post-activation-invalid-replay-bound",
  );
  assert.throws(
    () =>
      qualifiedPostActivationPwidOutcome({
        acceptedEvent: null,
        carrier,
        outcome,
        row: { ...row, reasonCode: `${rawDecodeReasonCode}-changed` },
      }),
    /exactly bound|exact canonical replay rejection/u,
  );
  for (const mutation of [
    { amountSats: 1 },
    { attemptedKind: "id-register" },
    { eventKey: `${row.eventKey}-changed` },
    { payloadRawPayload: "pwid1:changed" },
    { payloadReason: `${rawDecodeReasonCode}-changed` },
    { replayOutcomeReasonCode: `${rawDecodeReasonCode}-changed` },
    { storedRawPayload: "pwid1:changed" },
    { validationErrors: [`${rawDecodeReasonCode}-changed`] },
  ]) {
    assert.throws(
      () =>
        qualifiedPostActivationPwidOutcome({
          acceptedEvent: null,
          carrier,
          outcome,
          row: { ...row, ...mutation },
        }),
      /exactly bound|exact canonical replay rejection/u,
      `Persisted PWID field mutation must fail: ${Object.keys(mutation)[0]}`,
    );
  }
}

const semanticNulPayload =
  `pwid1:r2:${Buffer.from("semantic\u0000nul", "utf8").toString("base64url")}:fixture`;
const semanticNulBytes = Buffer.from(semanticNulPayload, "utf8");
const semanticNulCarrier = {
  ...postActivationCarrier,
  rawPayload: semanticNulPayload,
  rawPayloadHex: semanticNulBytes.toString("hex"),
  rawPayloadSha256: createHash("sha256").update(semanticNulBytes).digest("hex"),
  scriptPubKeyHex:
    `6a${semanticNulBytes.length.toString(16).padStart(2, "0")}` +
    semanticNulBytes.toString("hex"),
};
semanticNulCarrier.scriptPubKeySha256 = createHash("sha256")
  .update(Buffer.from(semanticNulCarrier.scriptPubKeyHex, "hex"))
  .digest("hex");
const semanticNulReason = "work-amo-v5-raw-pwid-invalid";
assert.equal(
  qualifiedPostActivationPwidOutcome({
    acceptedEvent: null,
    carrier: semanticNulCarrier,
    outcome: {
      ...postActivationValidOutcome,
      attributedRegistrySats: 0,
      consensusKind: "pwid1-invalid",
      projectionKind: "protocol-event-invalid",
      rawPayloadHex: semanticNulCarrier.rawPayloadHex,
      rawPayloadSha256: semanticNulCarrier.rawPayloadSha256,
      reasonCode: semanticNulReason,
      scriptPubKeyHex: semanticNulCarrier.scriptPubKeyHex,
      scriptPubKeySha256: semanticNulCarrier.scriptPubKeySha256,
      semanticKind: "protocol-event-invalid",
      valid: false,
    },
    row: {
      ...rawWitnessRow,
      amountSats: 0,
      attemptedKind: "id-register",
      eventKey: `pwid1:id-event-invalid:${semanticNulCarrier.txid}:v5:${semanticNulCarrier.blockHeight}:${semanticNulCarrier.blockIndex}:1:0`,
      kind: "id-event-invalid",
      payloadRawPayload: semanticNulPayload,
      payloadRawPayloadSha256: semanticNulCarrier.rawPayloadSha256,
      payloadReason: semanticNulReason,
      payloadReasonCode: semanticNulReason,
      rawScriptPayloadHex: semanticNulCarrier.rawPayloadHex,
      rawScriptPubKeyHex: semanticNulCarrier.scriptPubKeyHex,
      reasonCode: semanticNulReason,
      replayBound: true,
      replayMetadataPresent: true,
      replayOutcomeKind: "pwid1-invalid",
      replayOutcomeReasonCode: semanticNulReason,
      replayOutcomeValid: false,
      replayRawCandidate: true,
      storedRawPayload: semanticNulPayload,
      storedRawPayloadSha256: semanticNulCarrier.rawPayloadSha256,
      valid: false,
      validationErrors: [semanticNulReason],
    },
  }),
  "post-activation-invalid-replay-bound",
  "A wire-safe PWID whose decoded semantic field contains NUL remains an exact canonical rejection.",
);

const internalToken = "audit-test-internal-verifier-token-000000000000";
assert.equal(
  auditConfiguration({ POW_INTERNAL_VERIFIER_TOKEN: internalToken }).apiBase,
  "http://127.0.0.1:8081",
);
assert.equal(
  auditConfiguration({
    POW_ID_AUDIT_API_BASE: "http://[::1]:8081",
    POW_INTERNAL_VERIFIER_TOKEN: internalToken,
  }).apiBase,
  "http://[::1]:8081",
);
assert.throws(
  () =>
    auditConfiguration({
      POW_ID_AUDIT_API_BASE: "http://localhost:8081",
      POW_INTERNAL_VERIFIER_TOKEN: internalToken,
    }),
  /requires numeric loopback/u,
);
assert.throws(
  () => auditConfiguration({}),
  /requires POW_INTERNAL_VERIFIER_TOKEN/u,
);
assert.throws(
  () =>
    auditConfiguration({
      POW_ID_AUDIT_API_BASE: "https://computer.proofofwork.me",
      POW_ID_AUDIT_PRODUCTION: "1",
      POW_INTERNAL_VERIFIER_TOKEN: internalToken,
    }),
  /requires numeric loopback/u,
);
assert.throws(
  () =>
    auditConfiguration({
      POW_ID_AUDIT_ADDRESS_API_BASE: "http://127.0.0.1:8082",
      POW_ID_AUDIT_API_BASE: "http://127.0.0.1:8081",
      POW_ID_AUDIT_PRODUCTION: "1",
      POW_INTERNAL_VERIFIER_TOKEN: internalToken,
    }),
  /same exact origin/u,
);
assert.equal(
  auditConfiguration({
    POW_ID_AUDIT_API_BASE: "https://computer.proofofwork.me",
    POW_ID_AUDIT_PRODUCTION: "0",
  }).apiBase,
  "https://computer.proofofwork.me",
);

const registryAddress = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const ownerAddress = registryAddress;
const blockHash = "b".repeat(64);
const olderBlockHash = "f".repeat(64);
const txid = "a".repeat(64);
const unrelatedTxid = "c".repeat(64);
const olderTxid = "d".repeat(64);
const pendingNoiseTxid = "e".repeat(64);
const pendingDuplicateTxid = "1".repeat(64);
const pendingCandidateTxid = "2".repeat(64);
const checkpointHash = "7".repeat(64);
const message = `pwid1:r2:${Buffer.from("audit-test").toString("base64url")}:${ownerAddress}:${ownerAddress}`;
const pendingMessage = `pwid1:r2:${Buffer.from("audit-pending").toString("base64url")}:${ownerAddress}:${ownerAddress}`;

function registrationTransaction({
  blockIndex,
  confirmed,
  idTxid,
  protocolMessage,
  status = {},
}) {
  return {
    ...(confirmed ? { _powBlockIndex: blockIndex } : {}),
    status: {
      confirmed,
      ...(confirmed ? { block_index: blockIndex } : {}),
      ...(!confirmed ? { mempool_time: 1700000100 } : {}),
      ...status,
    },
    txid: idTxid,
    vin: [
      {
        prevout: {
          scriptpubkey: "00",
          scriptpubkey_address: ownerAddress,
          value: 2_000,
        },
      },
    ],
    vout: [
      { scriptpubkey: "00", scriptpubkey_address: registryAddress, value: 1000 },
      {
        scriptpubkey: "6a",
        scriptpubkey_asm: `OP_RETURN ${Buffer.from(protocolMessage).toString("hex")}`,
        scriptpubkey_type: "op_return",
        value: 0,
      },
    ],
  };
}

const tx = registrationTransaction({
  blockIndex: 0,
  confirmed: true,
  idTxid: txid,
  protocolMessage: message,
  status: {
    block_hash: blockHash,
    block_height: 900000,
    block_time: 1700000000,
  },
});
const unrelatedTx = {
  _powBlockIndex: 1,
  txid: unrelatedTxid,
  status: { ...tx.status, block_index: 1 },
  vin: [{ prevout: { scriptpubkey: "00", scriptpubkey_address: ownerAddress, value: 1 } }],
  vout: [{ scriptpubkey: "00", scriptpubkey_address: registryAddress, value: 1 }],
};
const olderTx = {
  _powBlockIndex: 0,
  txid: olderTxid,
  status: {
    block_hash: olderBlockHash,
    block_height: 899999,
    block_time: 1699999000,
    block_index: 0,
    confirmed: true,
  },
  vin: [{ prevout: { scriptpubkey: "00", scriptpubkey_address: ownerAddress, value: 1 } }],
  vout: [{ scriptpubkey: "00", scriptpubkey_address: registryAddress, value: 1 }],
};
const pendingNoiseTx = {
  txid: pendingNoiseTxid,
  status: { confirmed: false, mempool_time: 1700000100 },
  vin: [{ prevout: { scriptpubkey: "00", scriptpubkey_address: ownerAddress, value: 1 } }],
  vout: [{ scriptpubkey: "00", scriptpubkey_address: registryAddress, value: 1 }],
};
const pendingDuplicateTx = registrationTransaction({
  blockIndex: undefined,
  confirmed: false,
  idTxid: pendingDuplicateTxid,
  protocolMessage: message,
});
const pendingCandidateTx = registrationTransaction({
  blockIndex: undefined,
  confirmed: false,
  idTxid: pendingCandidateTxid,
  protocolMessage: pendingMessage,
});
const confirmedTxids = [txid, unrelatedTxid, olderTxid].sort();
const pendingTxids = [
  pendingNoiseTxid,
  pendingDuplicateTxid,
  pendingCandidateTxid,
].sort();
const hashTxids = (values) =>
  createHash("sha256")
    .update([...values].sort(compareCanonicalUtf8).join("\n"), "utf8")
    .digest("hex");

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compareCanonicalUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

const baseConfirmedRecords = [
  {
    blockHeight: 900000,
    blockIndex: 0,
    id: "audit-test",
    lastEventTxid: txid,
    ownerAddress,
    pgpKey: "",
    receiveAddress: ownerAddress,
    txid,
    updatedHeight: 900000,
  },
];
const basePendingRecords = [
  {
    id: "audit-pending",
    ownerAddress,
    pgpKey: "",
    receiveAddress: ownerAddress,
    txid: pendingCandidateTxid,
  },
];

function coveragePayload(overrides = {}) {
  const nextConfirmedTxids = overrides.confirmedTxids ?? confirmedTxids;
  const nextPendingTxids = overrides.pendingTxids ?? pendingTxids;
  const nextPendingTransactions =
    overrides.pendingTransactions ?? [
      pendingNoiseTx,
      pendingDuplicateTx,
      pendingCandidateTx,
    ];
  const projection = {
    checkpoint: {
      blockHash: overrides.checkpointHash ?? checkpointHash,
      height: overrides.checkpointHeight ?? 960000,
    },
    confirmedRecords:
      overrides.confirmedRecords ?? baseConfirmedRecords,
    events: overrides.events ?? [],
    listings: overrides.listings ?? [],
    pendingEvents: overrides.pendingEvents ?? [],
    pendingRecords: overrides.pendingRecords ?? basePendingRecords,
    sales: overrides.sales ?? [],
  };
  const projectionFingerprint =
    overrides.projectionSha256 ??
    createHash("sha256").update(canonicalJson(projection), "utf8").digest("hex");
  const pendingMempoolTimeSha256 = createHash("sha256")
    .update(
      canonicalJson(
        nextPendingTransactions
          .map((transaction) => ({
            mempoolTime: transaction.status.mempool_time,
            txid: transaction.txid,
          }))
          .sort((left, right) =>
            compareCanonicalUtf8(left.txid, right.txid),
          ),
      ),
      "utf8",
    )
    .digest("hex");
  const snapshotSha256 = overrides.snapshotSha256 ?? "9".repeat(64);
  const relationalRowsSha256 = "2".repeat(64);
  const readFencePreimage = {
    checkpointHash: projection.checkpoint.blockHash,
    checkpointHeight: projection.checkpoint.height,
    confirmedTxidCount: nextConfirmedTxids.length,
    confirmedTxidsSha256: hashTxids(nextConfirmedTxids),
    electrumCheckpointHash: projection.checkpoint.blockHash,
    electrumCheckpointHeight: projection.checkpoint.height,
    electrumHeaderSha256: "8".repeat(64),
    indexScanSnapshotId: "fixture-snapshot",
    indexScanStatus: "block-scan-current",
    pendingMempoolTimeSha256,
    pendingTxidCount: nextPendingTxids.length,
    pendingTxidsSha256: hashTxids(nextPendingTxids),
    registryProjectionSha256: projectionFingerprint,
    relationalRowsSha256,
    snapshotSha256,
    transitionCount:
      projection.checkpoint.height - PWID_RAW_REPLAY_ACTIVATION_HEIGHT + 1,
    transitionSha256: "7".repeat(64),
  };
  const readFence = {
    ...readFencePreimage,
    fenceSha256: createHash("sha256")
      .update(canonicalJson(readFencePreimage), "utf8")
      .digest("hex"),
  };
  return {
    auditedAt: "2026-08-26T00:00:00.000Z",
    coverage: {
      confirmedComplete: true,
      confirmedTxidCount: nextConfirmedTxids.length,
      confirmedTxids: nextConfirmedTxids,
      confirmedTxidsSha256: hashTxids(nextConfirmedTxids),
      electrumHistoryEntryCount:
        nextConfirmedTxids.length + nextPendingTxids.length,
      lifecycleParity: {
        canonicalRawClosingStateSha256: "6".repeat(64),
        canonicalRawReplayBlockCount: 1,
        canonicalRawReplayBlockPaging:
          "all-transition-discovered-pwid-blocks;bounded-page-recompute",
        canonicalRawReplayDescriptorSha256: "5".repeat(64),
        canonicalSemantics:
          "legacy-idRegistryStateFromTransactions+post-activation-raw-block-sequencer",
        chainReplayVerified: true,
        projectionSha256: projectionFingerprint,
        relationalClosingStateSha256: "6".repeat(64),
      },
      pendingObservation: {
        completeWithinScope: true,
        coreMembershipProven: true,
        coreMempoolTimeCount: nextPendingTransactions.length,
        coreMempoolTimeSha256: pendingMempoolTimeSha256,
        fenced: true,
        scope: "registry-address-touching-electrum-observation",
        source: "electrum-address-history+bitcoin-core-membership",
        wholeMempoolComplete: false,
      },
      pendingTxidCount: nextPendingTxids.length,
      pendingTxids: nextPendingTxids,
      pendingTxidsSha256: hashTxids(nextPendingTxids),
      pwidAttemptParity: {
        acceptedPositionCount: 1,
        canonicalReplayOutcomeCount: 0,
        canonicalReplayOutcomeHashModel:
          "proof-id-audit-rolling-sha256-v1",
        canonicalReplayOutcomeSha256: "a".repeat(64),
        canonicalOutcomeHashModel: "proof-id-audit-rolling-sha256-v1",
        canonicalOutcomeSha256: "4".repeat(64),
        coreBoundRelationalRowsHashModel:
          "proof-id-audit-rolling-sha256-v1",
        coreBoundRelationalRowsSha256: "b".repeat(64),
        diagnosticRowCount: 0,
        diagnosticSha256: "3".repeat(64),
        invalidCount: 0,
        invalidOutcomeSemantics:
          "post-activation-canonical-raw-replay-rejection;pre-activation-qualified-legacy",
        legacyPositionCount: 1,
        mixedOutcomePositionCount: 0,
        mixedOutcomeRowsQualifiedAs:
          "pre-activation-same-carrier-contradictory-diagnostic-rows-only",
        maxCarrierPayloadBytes: 128,
        physicalCarrierComplete: true,
        postActivationPositionCount: 0,
        positionCount: 1,
        relationalRowsHashModel: "proof-id-audit-rolling-sha256-v1",
        relationalRowsSha256,
        rowCount: 1,
        segmentCount: 1,
        transactionCount: 1,
        transactionTxidsHashModel: "proof-id-audit-rolling-sha256-v1",
        transactionTxidsSha256: "c".repeat(64),
        validCount: 1,
      },
      readFence,
      snapshotSha256,
    },
    network: "livenet",
    pendingTransactions: nextPendingTransactions,
    registryAddress,
    registryProjection: {
      ...projection,
      projectionSha256: projectionFingerprint,
    },
  };
}

const baseEnv = {
  POW_ID_AUDIT_API_BASE: "http://127.0.0.1:18090",
  POW_ID_AUDIT_PRODUCTION: "1",
  POW_ID_AUDIT_RETRIES: "0",
  POW_ID_AUDIT_TIMEOUT_MS: "1000",
  POW_INTERNAL_VERIFIER_TOKEN: internalToken,
};

const originalFetch = globalThis.fetch;
const requests = [];
const presentedTokens = [];
const redirectPolicies = [];
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  requests.push(url);
  presentedTokens.push(options.headers?.["x-pow-internal-verifier"]);
  redirectPolicies.push(options.redirect);
  if (url.includes("/internal/id-registry-audit")) {
    return Response.json(coveragePayload());
  }
  if (url.includes(`/txs/chain/${txid}`)) return Response.json([olderTx]);
  if (url.includes(`/txs/chain/${olderTxid}`)) return Response.json([]);
  if (url.includes("/txs/chain")) return Response.json([unrelatedTx, tx]);
  if (url.includes(`/block/${blockHash}/txids`)) {
    return Response.json([txid, unrelatedTxid]);
  }
  if (url.includes(`/block/${olderBlockHash}/txids`)) {
    return Response.json([olderTxid]);
  }
  return new Response("not found", { status: 404 });
};

try {
  const config = auditConfiguration(baseEnv);
  const data = await fetchRegistryAuditData(config);
  assert.equal(data.transactions.length, 6);
  assert.equal(data.coverage.statsConfirmed, 1);
  assert.equal(data.coverage.pendingRecords, 1);
  assert.equal(
    data.transactions.find((item) => item.txid === txid)._powBlockIndex,
    0,
  );
  assert.equal(
    data.transactions.find((item) => item.txid === txid).status.confirmed,
    true,
  );
  assert.ok(data.transactions.some((item) => item.txid === olderTxid));
  assert.ok(data.transactions.some((item) => item.txid === pendingNoiseTxid));
  assert.ok(requests.some((url) => url.includes(`/txs/chain/${txid}`)));
  assert.ok(requests.some((url) => url.includes(`/txs/chain/${olderTxid}`)));
  assert.ok(
    requests.every((url) =>
      url.startsWith("http://127.0.0.1:18090/api/v1/"),
    ),
  );
  assert.ok(presentedTokens.every((token) => token === internalToken));
  assert.ok(redirectPolicies.every((policy) => policy === "error"));
  assert.ok(!requests.some((url) => url.includes("txs/mempool")));
  assert.equal(
    requests.filter(
      (requestUrl) =>
        new URL(requestUrl).pathname ===
        "/api/v1/internal/id-registry-audit",
    ).length,
    1,
    "one audit run performs the heavyweight canonical replay only once",
  );
  assert.equal(
    requests.filter(
      (requestUrl) =>
        new URL(requestUrl).pathname ===
        "/api/v1/internal/id-registry-audit-fence",
    ).length,
    1,
    "the final stability sample uses the lightweight fence endpoint",
  );

  const result = buildAuditResult(
    data.transactions,
    "2026-08-26T00:00:00.000Z",
  );
  assert.equal(result.totals.winners, 1);
  assert.equal(result.totals.pendingCandidates, 1);
  assert.equal(result.winners[0].id, "audit-test");
  assert.equal(assertAuditMatchesCoverage(result, data.coverage), true);

  const splitPayment = structuredClone(tx);
  splitPayment.txid = "6".repeat(64);
  splitPayment.vout = [
    { scriptpubkey: "00", scriptpubkey_address: registryAddress, value: 400 },
    { scriptpubkey: "00", scriptpubkey_address: registryAddress, value: 600 },
    tx.vout[1],
  ];
  assert.equal(buildAuditResult([splitPayment]).totals.winners, 1);

  const ambiguousEnvelope = structuredClone(tx);
  ambiguousEnvelope.txid = "8".repeat(64);
  ambiguousEnvelope.vout.splice(1, 0, {
    scriptpubkey: "6a",
    scriptpubkey_asm: `OP_RETURN ${Buffer.from("pwid1:u:earlier-event").toString("hex")}`,
    scriptpubkey_type: "op_return",
    value: 0,
  });
  assert.throws(
    () => buildAuditResult([ambiguousEnvelope]),
    /ambiguous multi-event ID registration envelope/u,
  );

  assert.throws(
    () =>
      assertAuditMatchesCoverage(result, {
        ...data.coverage,
        confirmedRecords: [
          { ...data.coverage.confirmedRecords[0], txid: "3".repeat(64) },
        ],
      }),
    /confirmed ID identity mismatch/iu,
  );

  const originalLog = console.log;
  console.log = () => {};
  const noWriteDirectory = await mkdtemp(
    join(tmpdir(), "pow-id-audit-no-write-"),
  );
  try {
    const execution = await runAudit({
      argv: ["--output-dir", noWriteDirectory],
      env: baseEnv,
    });
    assert.equal(execution.jsonPath, "");
    assert.equal(execution.csvPath, "");
    assert.deepEqual(await readdir(noWriteDirectory), []);
    await assert.rejects(
      runAudit({ argv: ["--write-reports"], env: baseEnv }),
      /requires an explicit/u,
    );
  } finally {
    console.log = originalLog;
    await rm(noWriteDirectory, { recursive: true });
  }
} finally {
  globalThis.fetch = originalFetch;
}

async function expectFetchFailure(fetchImplementation, env, pattern) {
  globalThis.fetch = fetchImplementation;
  try {
    await assert.rejects(
      fetchRegistryTransactions(auditConfiguration(env)),
      pattern,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const incompletePrevoutTx = structuredClone(tx);
delete incompletePrevoutTx.vin[0].prevout;
await expectFetchFailure(
  async (input) => {
    const url = String(input);
    if (url.includes("/internal/id-registry-audit")) {
      return Response.json(coveragePayload());
    }
    if (url.includes("/txs/chain")) return Response.json([incompletePrevoutTx]);
    return Response.json([]);
  },
  baseEnv,
  /incompletely hydrated/u,
);

const missingCorePositionTx = structuredClone(tx);
delete missingCorePositionTx._powBlockIndex;
delete missingCorePositionTx.status.block_index;
await expectFetchFailure(
  async (input) => {
    const url = String(input);
    if (url.includes("/internal/id-registry-audit")) {
      return Response.json(coveragePayload());
    }
    if (url.includes("/txs/chain")) return Response.json([missingCorePositionTx]);
    return Response.json([]);
  },
  baseEnv,
  /descending block order|Bitcoin Core block position/u,
);

await expectFetchFailure(
  async (input) => {
    const url = String(input);
    if (url.includes("/internal/id-registry-audit")) {
      return Response.json(coveragePayload());
    }
    if (url.includes("/txs/chain/")) return Response.json([tx]);
    if (url.includes("/txs/chain")) return Response.json([tx]);
    return Response.json([]);
  },
  baseEnv,
  /repeated transaction|repeated cursor|descending block order/u,
);

await expectFetchFailure(
  async (input) => {
    const url = String(input);
    if (url.includes("/internal/id-registry-audit")) {
      return Response.json(coveragePayload());
    }
    if (url.includes("/txs/chain/")) return Response.json([]);
    if (url.includes("/txs/chain")) return Response.json([unrelatedTx, tx]);
    return Response.json([]);
  },
  baseEnv,
  /history is incomplete/u,
);

let coverageCalls = 0;
await expectFetchFailure(
  async (input) => {
    const url = String(input);
    if (url.includes("/internal/id-registry-audit")) {
      coverageCalls += 1;
      return Response.json(
        coveragePayload({
          snapshotSha256: String(coverageCalls).padStart(64, "0"),
        }),
      );
    }
    if (url.includes(`/txs/chain/${txid}`)) return Response.json([olderTx]);
    if (url.includes(`/txs/chain/${olderTxid}`)) return Response.json([]);
    if (url.includes("/txs/chain")) return Response.json([unrelatedTx, tx]);
    if (url.includes(`/block/${blockHash}/txids`)) {
      return Response.json([txid, unrelatedTxid]);
    }
    if (url.includes(`/block/${olderBlockHash}/txids`)) {
      return Response.json([olderTxid]);
    }
    return Response.json([]);
  },
  baseEnv,
  /coverage changed/u,
);

let mempoolTimeCoverageCalls = 0;
await expectFetchFailure(
  async (input) => {
    const url = String(input);
    if (url.includes("/internal/id-registry-audit")) {
      mempoolTimeCoverageCalls += 1;
      const pendingTransactions = [
        structuredClone(pendingNoiseTx),
        structuredClone(pendingDuplicateTx),
        structuredClone(pendingCandidateTx),
      ];
      if (mempoolTimeCoverageCalls > 1) {
        pendingTransactions[0].status.mempool_time += 1;
      }
      return Response.json(coveragePayload({ pendingTransactions }));
    }
    if (url.includes(`/txs/chain/${txid}`)) return Response.json([olderTx]);
    if (url.includes(`/txs/chain/${olderTxid}`)) return Response.json([]);
    if (url.includes("/txs/chain")) return Response.json([unrelatedTx, tx]);
    return Response.json([]);
  },
  baseEnv,
  /coverage changed/u,
);

await expectFetchFailure(
  async () =>
    Response.json(
      coveragePayload({
        confirmedTxids: [],
        confirmedRecords: [],
        pendingRecords: [],
        pendingTransactions: [],
        pendingTxids: [],
      }),
    ),
  baseEnv,
  /cannot accept zero confirmed history/u,
);

await expectFetchFailure(
  async () =>
    Response.json(
      coveragePayload({
        pendingTransactions: [],
      }),
    ),
  baseEnv,
  /pending registry transaction hydration is incomplete/iu,
);

await expectFetchFailure(
  async () => Response.json(coveragePayload({ projectionSha256: "4".repeat(64) })),
  baseEnv,
  /projection fingerprint is inconsistent/u,
);

await expectFetchFailure(
  async () => {
    const payload = coveragePayload();
    const { fenceSha256: _fenceSha256, ...readFencePreimage } =
      payload.coverage.readFence;
    readFencePreimage.electrumCheckpointHash = "0".repeat(64);
    payload.coverage.readFence = {
      ...readFencePreimage,
      fenceSha256: createHash("sha256")
        .update(canonicalJson(readFencePreimage), "utf8")
        .digest("hex"),
    };
    return Response.json(payload);
  },
  baseEnv,
  /fence checkpoint is invalid/u,
);

await expectFetchFailure(
  async () =>
    Response.json(
      coveragePayload({
        confirmedRecords: [
          { ...baseConfirmedRecords[0], updatedHeight: 960001 },
        ],
      }),
    ),
  baseEnv,
  /outside the exact chain checkpoint/u,
);

await expectFetchFailure(
  async () =>
    Response.json(
      coveragePayload({
        confirmedRecords: [
          { ...baseConfirmedRecords[0], lastEventTxid: "4".repeat(64) },
        ],
      }),
    ),
  baseEnv,
  /outside the exact chain checkpoint or history/u,
);

await expectFetchFailure(
  async () =>
    Response.json(
      coveragePayload({
        pendingEvents: [
          {
            buyerAddress: "",
            currentOwnerAddress: ownerAddress,
            currentReceiveAddress: ownerAddress,
            id: "audit-test",
            kind: "update",
            listingId: "",
            ownerAddress: "",
            priceSats: null,
            receiveAddress: ownerAddress,
            sellerAddress: "",
            transferVersion: "",
            txid: "4".repeat(64),
          },
        ],
      }),
    ),
  baseEnv,
  /pending registry projection is outside/u,
);

let retryCalls = 0;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/internal/id-registry-audit") && retryCalls < 2) {
    retryCalls += 1;
    return new Response("retry", { status: retryCalls === 1 ? 429 : 503 });
  }
  if (url.includes("/internal/id-registry-audit")) {
    return Response.json(coveragePayload());
  }
  if (url.includes(`/txs/chain/${txid}`)) return Response.json([olderTx]);
  if (url.includes(`/txs/chain/${olderTxid}`)) return Response.json([]);
  if (url.includes("/txs/chain")) return Response.json([unrelatedTx, tx]);
  if (url.includes(`/block/${blockHash}/txids`)) {
    return Response.json([txid, unrelatedTxid]);
  }
  if (url.includes(`/block/${olderBlockHash}/txids`)) {
    return Response.json([olderTxid]);
  }
  return Response.json([]);
};
try {
  await fetchRegistryTransactions(
    auditConfiguration({
      ...baseEnv,
      POW_ID_AUDIT_RETRIES: "2",
      POW_ID_AUDIT_RETRY_DELAY_MS: "0",
    }),
  );
  assert.equal(retryCalls, 2);
} finally {
  globalThis.fetch = originalFetch;
}

let timeoutCalls = 0;
await expectFetchFailure(
  async () => {
    timeoutCalls += 1;
    throw new DOMException("timed out", "TimeoutError");
  },
  {
    ...baseEnv,
    POW_ID_AUDIT_RETRIES: "1",
    POW_ID_AUDIT_RETRY_DELAY_MS: "0",
  },
  /timed out/u,
);
assert.equal(timeoutCalls, 2);

let remoteTokenHeader;
await expectFetchFailure(
  async (_input, options = {}) => {
    remoteTokenHeader = options.headers?.["x-pow-internal-verifier"];
    return Response.json({});
  },
  {
    ...baseEnv,
    POW_ID_AUDIT_API_BASE: "https://computer.proofofwork.me",
    POW_ID_AUDIT_PRODUCTION: "0",
  },
  /incomplete coverage/u,
);
assert.equal(remoteTokenHeader, undefined);

let redirectedRequestCount = 0;
let redirectedToken;
let redirectSourceToken;
await expectFetchFailure(
  async (_input, options = {}) => {
    redirectSourceToken = options.headers?.["x-pow-internal-verifier"];
    if (options.redirect === "error") {
      throw new TypeError("redirect blocked before target request");
    }
    redirectedRequestCount += 1;
    redirectedToken = options.headers?.["x-pow-internal-verifier"];
    return Response.json({});
  },
  baseEnv,
  /redirect blocked before target request/u,
);
assert.equal(redirectSourceToken, internalToken);
assert.equal(redirectedRequestCount, 0);
assert.equal(redirectedToken, undefined);

const mismatch = buildAuditResult([tx], "2026-08-26T00:00:00.000Z");
assert.throws(
  () =>
    assertAuditMatchesCoverage(mismatch, {
      pendingRecords: 0,
      statsConfirmed: 2,
    }),
  /winner count mismatch/u,
);

console.log("ID registry audit contract checks passed.");
