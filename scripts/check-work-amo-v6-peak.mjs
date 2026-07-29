import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  WORK_AMO_V6_AUTH_VERSION,
  WORK_AMO_V6_MODELS,
  calculateWorkAmoV6UnitTerms,
  compareWorkAmoV6CanonicalPositions,
  deriveWorkAmoV6FrozenTerms,
  replayWorkAmoV6CanonicalBlock,
} from "../server/work-amo-v6.mjs";
import {
  WORK_AMO_V5_ATOMS_PER_WORK,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
} from "../server/work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";
import {
  WORK_USD_ATTESTATION_MODEL,
  WORK_USD_ORACLE_SOURCE_IDS,
  buildSignedWorkUsdAttestation,
  buildWorkUsdConsensus,
  deriveWorkUsdOracleIdentity,
  verifyWorkUsdAttestation,
} from "../server/work-usd-oracle.mjs";

const full = process.argv.includes("--full");
const transactionCount = full ? 4_096 : 1_024;
const recordsPerTransaction = 4;
const expectedRecordCount =
  transactionCount * recordsPerTransaction;
const blockHeight = 1_100_000;
const activationHeight = 1_000_000;
const blockHash = "aa".repeat(32);
const referenceBlockHeight = blockHeight - 1;
const referenceBlockHash = "bb".repeat(32);
const declarationTxid = "cc".repeat(32);
const oraclePrivateKey = "01".repeat(32);
const oracleIdentity =
  deriveWorkUsdOracleIdentity(oraclePrivateKey);
const issuedAtUnixMs = 1_785_585_600_000;
const usdPer100mProofsQ8 = "6000000000000";
const openingNetworkValueQ8 =
  21_000_000n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
const spendableAmountAtoms =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK;

const consensus = buildWorkUsdConsensus({
  allowedSourceIds: WORK_USD_ORACLE_SOURCE_IDS,
  freshnessWindowMs: 120_000,
  issuedAtUnixMs,
  maxSpreadBps: 200,
  minimumSources: 3,
  observations: WORK_USD_ORACLE_SOURCE_IDS.map(
    (sourceId, index) => ({
      observedAtUnixMs: issuedAtUnixMs - 1_000 + index,
      sourceId,
      usdPer100mProofsQ8: (
        BigInt(usdPer100mProofsQ8) +
        BigInt(index - 2) * 1_000_000n
      ).toString(),
    }),
  ),
});
const attestation = buildSignedWorkUsdAttestation({
  auxRand: Buffer.alloc(32, 7),
  consensus,
  declarationTxid,
  maxValidityBlocks: 12,
  network: "livenet",
  privateKey: oraclePrivateKey,
  referenceBlockHash,
  referenceBlockHeight,
  validFromHeight: blockHeight,
  validThroughHeight: blockHeight + 11,
});
const oraclePolicy = Object.freeze({
  allowedSourceIds: WORK_USD_ORACLE_SOURCE_IDS,
  declarationTxid,
  freshnessWindowMs: 120_000,
  maxSpreadBps: 200,
  maxValidityBlocks: 12,
  minimumSources: 3,
  model: WORK_USD_ATTESTATION_MODEL,
  oracleKeyId: oracleIdentity.oracleKeyId,
  publicKey: oracleIdentity.publicKey,
});

function transactionId(index) {
  return createHash("sha256")
    .update(`work-amo-v6-peak:${index}`, "utf8")
    .digest("hex");
}

function listingAuthorization(transactionIndex) {
  return {
    ...WORK_AMO_V6_MODELS,
    anchorScriptPubKey: `5120${"ab".repeat(32)}`,
    anchorSigHashType: 0x83,
    anchorType: "sale-ticket-v1",
    anchorValueSats: 546,
    anchorVout: 2,
    buyerAddress: "",
    expiresAt: "",
    network: "livenet",
    nonce: `work-amo-v6-peak-${transactionIndex}`,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    sellerAddress:
      "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
    sellerPublicKey:
      "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitFaceUsdCents: [2_000, 5_000, 10_000][
      transactionIndex % 3
    ],
    unitUsdAttestation: attestation,
    version: WORK_AMO_V6_AUTH_VERSION,
  };
}

const records = [];
let expectedRecordBondQ8 = 0n;
let expectedFeeBondQ8 = 0n;
for (
  let transactionIndex = 1;
  transactionIndex <= transactionCount;
  transactionIndex += 1
) {
  const txid = transactionId(transactionIndex);
  const transactionMinerFeeSats =
    500 + (transactionIndex % 101);
  expectedFeeBondQ8 +=
    BigInt(transactionMinerFeeSats) *
    WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
  const authorization = listingAuthorization(transactionIndex);
  const layouts = [
    {
      eventKind: "bond",
      marker: "vout-3-ordinal-0",
      protocolVout: 3,
      recordOrdinal: 0,
    },
    {
      authorization,
      eventKind: "listing",
      marker: "vout-1-ordinal-1",
      protocolVout: 1,
      recordOrdinal: 1,
    },
    {
      eventKind: "bond",
      marker: "vout-2-ordinal-0",
      protocolVout: 2,
      recordOrdinal: 0,
    },
    {
      eventKind: "bond",
      marker: "vout-1-ordinal-0",
      protocolVout: 1,
      recordOrdinal: 0,
    },
  ];
  for (let layoutIndex = 0; layoutIndex < layouts.length; layoutIndex += 1) {
    const bondQ8 =
      50_000_000_000n +
      BigInt((transactionIndex + layoutIndex) % 97) *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
    expectedRecordBondQ8 += bondQ8;
    const layout = layouts[layoutIndex];
    records.push({
      ...layout,
      bondQ8: bondQ8.toString(),
      position: {
        blockHash,
        blockHeight,
        blockTransactionIndex: transactionIndex,
        protocolVout: layout.protocolVout,
        recordOrdinal: layout.recordOrdinal,
      },
      transactionMinerFeeSats:
        transactionMinerFeeSats.toString(),
      transactionProtocolRecordCount: recordsPerTransaction,
      txid,
    });
  }
}

const listingRecords = records.filter(
  (record) => record.eventKind === "listing",
);
assert.equal(records.length, expectedRecordCount);
assert.equal(listingRecords.length, transactionCount);
assert.equal(
  new Set(
    listingRecords.map(
      (record) => record.authorization.unitUsdAttestation,
    ),
  ).size,
  1,
  "every peak listing must reuse the same signed attestation object",
);

const canonicalBlockHashAtHeight = (height) =>
  height === referenceBlockHeight ? referenceBlockHash : "";

function replay(inputRecords) {
  return replayWorkAmoV6CanonicalBlock({
    activationHeight,
    applyTransactionFee: ({ state, transaction }) => {
      const feeBondQ8 =
        BigInt(transaction.transactionMinerFeeSats) *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
      return {
        output: {
          feeBondQ8: feeBondQ8.toString(),
        },
        state: {
          ...state,
          feeCount: state.feeCount + 1,
          networkValueQ8:
            BigInt(state.networkValueQ8) + feeBondQ8,
        },
      };
    },
    blockHash,
    blockHeight,
    evaluateRecord: ({
      entry,
      networkValueBeforeQ8,
      state,
    }) => {
      const bondQ8 = BigInt(entry.bondQ8);
      if (entry.eventKind === "listing") {
        const derived = deriveWorkAmoV6FrozenTerms(
          entry.authorization,
          {
            activationHeight,
            canonicalBlockHashAtHeight,
            listingBondContributionQ8: bondQ8,
            listingPosition: entry.position,
            networkValueBeforeQ8,
            oraclePolicy,
            spendableAmountAtoms,
            verifyAttestation: verifyWorkUsdAttestation,
          },
        );
        assert.equal(
          derived.valid,
          true,
          derived.reasonCode ??
            "peak listing must derive frozen terms",
        );
        const beforeFormula = calculateWorkAmoV6UnitTerms({
          networkValueBeforeQ8,
          unitFaceUsdCents:
            entry.authorization.unitFaceUsdCents,
          usdPer100mProofsQ8:
            attestation.usdPer100mProofsQ8,
        });
        const afterFormula = calculateWorkAmoV6UnitTerms({
          networkValueBeforeQ8:
            networkValueBeforeQ8 + bondQ8,
          unitFaceUsdCents:
            entry.authorization.unitFaceUsdCents,
          usdPer100mProofsQ8:
            attestation.usdPer100mProofsQ8,
        });
        assert.equal(beforeFormula.valid, true);
        assert.equal(afterFormula.valid, true);
        assert.equal(
          derived.frozenTerms.listingNetworkValueBeforeQ8,
          networkValueBeforeQ8.toString(),
        );
        assert.equal(
          derived.frozenTerms.listingNetworkValueAfterQ8,
          (networkValueBeforeQ8 + bondQ8).toString(),
        );
        assert.equal(
          derived.frozenTerms.unitAmountAtoms,
          beforeFormula.unitAmountAtoms,
          "listing formula must freeze from N-before",
        );
        assert.notEqual(
          derived.frozenTerms.unitAmountAtoms,
          afterFormula.unitAmountAtoms,
          "the listing's own bond must not enter its frozen formula",
        );
        return {
          output: {
            attestationId:
              derived.frozenTerms.unitUsdAttestationId,
            eventKind: "listing",
            marker: entry.marker,
            unitAmountAtoms:
              derived.frozenTerms.unitAmountAtoms,
            unitFaceUsdCents:
              derived.frozenTerms.unitFaceUsdCents,
          },
          state: {
            ...state,
            listingCount: state.listingCount + 1,
            networkValueQ8:
              BigInt(state.networkValueQ8) + bondQ8,
            recordCount: state.recordCount + 1,
          },
          valid: true,
        };
      }
      return {
        output: {
          eventKind: "bond",
          marker: entry.marker,
        },
        state: {
          ...state,
          networkValueQ8:
            BigInt(state.networkValueQ8) + bondQ8,
          recordCount: state.recordCount + 1,
        },
        valid: true,
      };
    },
    openingState: {
      feeCount: 0,
      listingCount: 0,
      networkValueQ8: openingNetworkValueQ8,
      recordCount: 0,
    },
    records: inputRecords,
    valueFromState: (state) => state.networkValueQ8,
  });
}

function deterministicView(replayResult) {
  return replayResult.traces.map((trace) => ({
    bondContributionQ8: trace.bondContributionQ8,
    kind: trace.kind,
    networkValueAfterQ8: trace.networkValueAfterQ8,
    networkValueBeforeQ8: trace.networkValueBeforeQ8,
    output: trace.output,
    position: trace.position ?? null,
    txid: trace.txid,
    valid: trace.valid,
  }));
}

const startedAt = performance.now();
const forward = replay(records);
const reversed = replay([...records].reverse());
const elapsedMs = performance.now() - startedAt;
const forwardView = deterministicView(forward);
const reversedView = deterministicView(reversed);

assert.deepEqual(
  reversedView,
  forwardView,
  "reversed input must produce the identical canonical trace",
);
assert.deepEqual(
  reversed.state,
  forward.state,
  "reversed input must produce the identical closing state",
);
assert.equal(forward.protocolRecordCount, expectedRecordCount);
assert.equal(forward.transactionCount, transactionCount);
assert.equal(forward.state.recordCount, expectedRecordCount);
assert.equal(forward.state.listingCount, transactionCount);
assert.equal(forward.state.feeCount, transactionCount);
assert.equal(
  forward.closingNetworkValueQ8,
  (
    openingNetworkValueQ8 +
    expectedRecordBondQ8 +
    expectedFeeBondQ8
  ).toString(),
);

const protocolTraces = forward.traces.filter(
  (trace) => trace.kind === "protocol-record",
);
for (let index = 1; index < protocolTraces.length; index += 1) {
  assert.ok(
    compareWorkAmoV6CanonicalPositions(
      protocolTraces[index - 1].position,
      protocolTraces[index].position,
    ) < 0,
    "trace order must be block/tx/vout/ordinal canonical order",
  );
}
const listingTraces = protocolTraces.filter(
  (trace) => trace.output?.eventKind === "listing",
);
assert.equal(listingTraces.length, transactionCount);
assert.deepEqual(
  [...new Set(listingTraces.map(
    (trace) => trace.output.attestationId,
  ))],
  [attestation.attestationId],
  "one valid inline attestation must be reusable by every same-block listing",
);

const traceSha256 = createHash("sha256")
  .update(JSON.stringify(forwardView), "utf8")
  .digest("hex");

console.log(
  JSON.stringify(
    {
      attestationId: attestation.attestationId,
      blockHeight,
      closingNetworkValueQ8:
        forward.closingNetworkValueQ8,
      deterministicReverseInput: true,
      elapsedMs: Math.round(elapsedMs),
      formulaUsesNetworkValueBefore: true,
      full,
      listingCount: transactionCount,
      recordCount: expectedRecordCount,
      reusedAttestation: true,
      traceSha256,
      transactionCount,
      valid: true,
    },
    null,
    2,
  ),
);
