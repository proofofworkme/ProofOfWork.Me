import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  WORK_AMO_V7_ALLOWED_FACE_PROOFS,
  WORK_AMO_V7_AUTH_VERSION,
  WORK_AMO_V7_MAX_SUPPLY_SUBATOMS,
  WORK_AMO_V7_MODELS,
  calculateWorkAmoV7UnitTerms,
  compareWorkAmoV7CanonicalPositions,
  deriveWorkAmoV7FrozenTerms,
  replayWorkAmoV7CanonicalBlock,
  workAmoV7CanonicalTokenStatePreimage,
} from "../server/work-amo-v7.mjs";
import {
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
} from "../server/work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";

const full = process.argv.includes("--full");
const transactionCount = full ? 4_096 : 1_024;
const recordsPerTransaction = 4;
const expectedRecordCount =
  transactionCount * recordsPerTransaction;
const blockHeight = 1_300_000;
const activationHeight = 1_200_000;
const blockHash = "aa".repeat(32);
const sellerAddress =
  "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const openingNetworkValueQ8 =
  WORK_AMO_V5_MAX_SUPPLY *
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE *
  1_000n;

function transactionId(index) {
  return createHash("sha256")
    .update(`work-amo-v7-peak:${index}`, "utf8")
    .digest("hex");
}

function listingAuthorization(transactionIndex) {
  return {
    ...WORK_AMO_V7_MODELS,
    anchorScriptPubKey: `5120${"ab".repeat(32)}`,
    anchorSigHashType: 0x83,
    anchorType: "sale-ticket-v1",
    anchorValueSats: 546,
    anchorVout: 2,
    buyerAddress: "",
    expiresAt: "",
    network: "livenet",
    nonce: `work-amo-v7-peak-${transactionIndex}`,
    registryAddress: WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
    sellerAddress,
    sellerPublicKey:
      "0306baa226e3a87a99547df2144f2e6206a4a479a46df41ec1618945c064568237",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
    unitFaceProofs: WORK_AMO_V7_ALLOWED_FACE_PROOFS[
      transactionIndex % WORK_AMO_V7_ALLOWED_FACE_PROOFS.length
    ],
    version: WORK_AMO_V7_AUTH_VERSION,
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
  for (
    let layoutIndex = 0;
    layoutIndex < layouts.length;
    layoutIndex += 1
  ) {
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

assert.equal(records.length, expectedRecordCount);
assert.equal(
  records.filter((record) => record.eventKind === "listing")
    .length,
  transactionCount,
);

function replay(inputRecords) {
  return replayWorkAmoV7CanonicalBlock({
    activationHeight,
    applyTransactionFee: ({ state, transaction }) => {
      const feeBondQ8 =
        BigInt(transaction.transactionMinerFeeSats) *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
      return {
        output: { feeBondQ8: feeBondQ8.toString() },
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
        const spendableAmountSubatoms =
          BigInt(state.balanceSubatoms) -
          BigInt(state.reservedSubatoms);
        const derived = deriveWorkAmoV7FrozenTerms(
          entry.authorization,
          {
            activationHeight,
            listingBondContributionQ8: bondQ8,
            listingPosition: entry.position,
            networkValueBeforeQ8,
            spendableAmountSubatoms,
          },
        );
        assert.equal(
          derived.valid,
          true,
          derived.reasonCode ??
            "peak V7 listing must derive frozen terms",
        );
        const beforeFormula = calculateWorkAmoV7UnitTerms({
          networkValueBeforeQ8,
          unitFaceProofs:
            entry.authorization.unitFaceProofs,
        });
        const afterFormula = calculateWorkAmoV7UnitTerms({
          networkValueBeforeQ8:
            networkValueBeforeQ8 + bondQ8,
          unitFaceProofs:
            entry.authorization.unitFaceProofs,
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
          derived.frozenTerms.unitAmountSubatoms,
          beforeFormula.unitAmountSubatoms,
          "listing amount must freeze from N-before",
        );
        assert.notEqual(
          derived.frozenTerms.unitAmountSubatoms,
          afterFormula.unitAmountSubatoms,
          "the listing's own bond must not enter its amount",
        );
        const nextReserved =
          BigInt(state.reservedSubatoms) +
          BigInt(derived.frozenTerms.unitAmountSubatoms);
        assert.ok(
          nextReserved <= BigInt(state.balanceSubatoms),
          "Q16 reservations must never exceed the seller balance",
        );
        return {
          output: {
            amountSubatoms:
              derived.frozenTerms.unitAmountSubatoms,
            authorization: entry.authorization,
            eventKind: "listing",
            frozenTerms: derived.frozenTerms,
            marker: entry.marker,
            priceSats: derived.frozenTerms.unitPriceSats,
            sellerAddress:
              entry.authorization.sellerAddress,
          },
          state: {
            ...state,
            listingCount: state.listingCount + 1,
            networkValueQ8:
              BigInt(state.networkValueQ8) + bondQ8,
            recordCount: state.recordCount + 1,
            reservedSubatoms: nextReserved.toString(),
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
      balanceSubatoms:
        WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
      feeCount: 0,
      listingCount: 0,
      networkValueQ8: openingNetworkValueQ8,
      recordCount: 0,
      reservedSubatoms: "0",
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
  "reversed input must produce the identical Q16 closing state",
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
assert.ok(BigInt(forward.state.reservedSubatoms) > 0n);
assert.ok(
  BigInt(forward.state.reservedSubatoms) <=
    WORK_AMO_V7_MAX_SUPPLY_SUBATOMS,
);

const protocolTraces = forward.traces.filter(
  (trace) => trace.kind === "protocol-record",
);
for (let index = 1; index < protocolTraces.length; index += 1) {
  assert.ok(
    compareWorkAmoV7CanonicalPositions(
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
  [
    ...new Set(
      listingTraces.map(
        (trace) => trace.output.authorization.unitFaceProofs,
      ),
    ),
  ].sort((left, right) => left - right),
  [...WORK_AMO_V7_ALLOWED_FACE_PROOFS],
);

const tokenState = {
  confirmedSupplySubatoms:
    WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
  holders: [
    {
      address: sellerAddress,
      balanceSubatoms:
        WORK_AMO_V7_MAX_SUPPLY_SUBATOMS.toString(),
    },
  ],
  listings: listingTraces.map((trace) => ({
    amountSubatoms: trace.output.amountSubatoms,
    frozenTerms: trace.output.frozenTerms,
    listingId: trace.txid,
    priceSats: trace.output.priceSats,
    saleAuthorization: trace.output.authorization,
    sellerAddress: trace.output.sellerAddress,
  })),
};
const tokenStatePreimage =
  workAmoV7CanonicalTokenStatePreimage(tokenState);
assert.equal(
  tokenStatePreimage.reservedSubatoms,
  forward.state.reservedSubatoms,
  "the canonical Q16 token-state reservation must equal replay state",
);
assert.equal(
  tokenStatePreimage.listings.length,
  transactionCount,
);
assert.equal(tokenStatePreimage.definition.decimals, 16);
assert.equal(
  tokenStatePreimage.definition.unitScale,
  "10000000000000000",
);

const traceSha256 = createHash("sha256")
  .update(JSON.stringify(forwardView), "utf8")
  .digest("hex");

process.stdout.write(
  `${JSON.stringify(
    {
      allowedFaceProofs: WORK_AMO_V7_ALLOWED_FACE_PROOFS,
      blockHeight,
      closingNetworkValueQ8:
        forward.closingNetworkValueQ8,
      deterministicReverseInput: true,
      elapsedMs: Math.round(elapsedMs),
      full,
      listingCount: transactionCount,
      networkValuePrecision: "Q8",
      quantityPrecision: "Q16",
      recordCount: expectedRecordCount,
      reservationConserved: true,
      reservedSubatoms: forward.state.reservedSubatoms,
      traceSha256,
      transactionCount,
      valid: true,
      version: WORK_AMO_V7_AUTH_VERSION,
    },
    null,
    2,
  )}\n`,
);
