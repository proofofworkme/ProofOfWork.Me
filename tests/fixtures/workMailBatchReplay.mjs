import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import { ACTOR, hydrated } from "./workMailBatch.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "../../server/canonical-op-return.mjs";
import { normalizeWorkAmoV5RawGenericState, normalizeWorkAmoV5RawIdState, normalizeWorkAmoV5RawWorkState,
  replayWorkAmoV5RawBlock, workAmoV5RawGenericStateCommitment, workAmoV5RawIdStateCommitment } from "../../server/work-amo-v5-raw.mjs";
import { WORK_AMO_V5_BASE_STATE_FIELDS, WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL } from "../../server/work-amo-v5.mjs";
import { workAmoV8CanonicalTokenStateCommitment } from "../../server/work-amo-v8.mjs";
import { WORK_SUBATOM_PROJECTION_MODEL } from "../../server/work-units.mjs";
import { WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL } from "../../server/work-mail-batch-declaration.mjs";
export const HEIGHT = 1_200_000;
const PRIOR_HASH = "21".repeat(32);
const OPENING_VALUE = 2_100_000_000_000_000n;
const MOVEMENT_DENOMINATOR = 21_000_000n * 10_000_000_000_000_000n;
export const SUPPLY = 21_000_000n * 10_000_000_000_000_000n;
const sha256d = (bytes) => createHash("sha256").update(createHash("sha256").update(bytes).digest()).digest();
export const ACTIVE = {
  canonical: true,
  confirmed: true,
  evidenceComplete: true,
  activationHeight: HEIGHT,
  declaration: { txid: "31".repeat(32), blockHash: PRIOR_HASH, blockHeight: HEIGHT - 1,
    blockTransactionIndex: 1, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: 0 },
  evidenceCommitment: { model: WORK_MAIL_BATCH_DECLARATION_COMMITMENT_MODEL, payloadBytes: 1, sha256: "32".repeat(32) },
};

function block(transactions, height = HEIGHT) {
  const coinbase = new bitcoin.Transaction();
  coinbase.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from("0401020304", "hex"));
  coinbase.addOutput(Buffer.from("51", "hex"), 0n);
  const blockTransactions = [hydrated(coinbase), ...transactions].map((tx, index) => ({ ...tx, _powBlockIndex: index }));
  let hashes = blockTransactions.map(tx => Buffer.from(tx.txid, "hex").reverse());
  while (hashes.length > 1) {
    if (hashes.length % 2) hashes.push(Buffer.from(hashes.at(-1)));
    hashes = Array.from({ length: hashes.length / 2 }, (_, index) => sha256d(Buffer.concat([hashes[index * 2], hashes[index * 2 + 1]])));
  }
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(PRIOR_HASH, "hex").reverse().copy(header, 4);
  hashes[0].copy(header, 36);
  header.writeUInt32LE(1_700_000_000, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  return {
    blockTransactions,
    blockHeight: height,
    blockHash: Buffer.from(sha256d(header)).reverse().toString("hex"),
    blockHeaderHex: header.toString("hex"),
  };
}

function openingState(height, amount = SUPPLY.toString()) {
  const generic = normalizeWorkAmoV5RawGenericState({ holders: [], listings: [], tokens: [] });
  const ids = normalizeWorkAmoV5RawIdState({ records: [], listings: [] });
  const work = normalizeWorkAmoV5RawWorkState({
    amountStorageModel: WORK_SUBATOM_PROJECTION_MODEL,
    confirmedSupplySubatoms: amount,
    holders: [{ address: ACTOR, balanceSubatoms: amount }],
    listings: [],
  });
  return {
    openingGenericState: generic,
    openingIdState: ids,
    openingWorkState: work,
    openingEconomicState: {
      baseState: Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map(field => [field, field === "computerEventFlowSats" ? "4200000" : "0"])),
      creditFixedQ8: "0", creditMovementFrozenValueQ8: "0",
      genericTokenStateCommitment: workAmoV5RawGenericStateCommitment(generic),
      idStateCommitment: workAmoV5RawIdStateCommitment(ids),
      model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, movements: [], network: "livenet",
      networkValueQ8: OPENING_VALUE.toString(), quoteHead: null,
      throughBlockHash: PRIOR_HASH, throughBlockHeight: height - 1,
      tokenStateCommitment: workAmoV8CanonicalTokenStateCommitment(work),
    },
  };
}

export function replay(transactions, { height = HEIGHT, amount, workMailBatchV1 = ACTIVE, ...overrides } = {}) {
  const context = block(transactions, height);
  const records = context.blockTransactions.flatMap((tx, blockTransactionIndex) => {
    const reconstructed = canonicalRawProtocolRecordSetFromTransaction(tx);
    return reconstructed.records.map(record => ({
      ...record,
      tx, txid: tx.txid,
      position: { blockHash: context.blockHash, blockHeight: height, blockTransactionIndex,
        protocolVout: record.protocolVout, recordOrdinal: record.recordOrdinal },
      transactionMinerFeeSats: tx.feeSats,
      transactionProtocolRecordCount: reconstructed.records.length,
    }));
  });
  return replayWorkAmoV5RawBlock({
    blockHeaderHex: context.blockHeaderHex, blockTransactions: context.blockTransactions,
    expectedBlockHash: context.blockHash, expectedBlockHeight: height,
    expectedPreviousBlockHash: PRIOR_HASH, records, ...openingState(height, amount),
    workAmoV8: { activationHeight: HEIGHT - 100 }, workMailBatchV1, ...overrides,
  });
}
