import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  canonicalRawProtocolRecordSetFromTransaction,
  canonicalProtocolCandidateFromOutput,
} from "../server/canonical-op-return.mjs";
import {
  assertCanonicalUnicodeCaseMappingVersion,
} from "../server/canonical-order.mjs";
import {
  WORK_TOKEN_ID,
  workAmountAtomsFromRecord,
} from "../server/work-units.mjs";
import {
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_BLOCK_SEQUENCER_MODEL,
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_DECLARATION_AUTHORITY_SCRIPT_PUBKEY as WORK_AMO_V5_AUTHORITY_SCRIPTPUBKEY,
  WORK_AMO_V5_DECLARATION_BLOCK_HASH,
  WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
  WORK_AMO_V5_DECLARATION_HEIGHT,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS as WORK_AMO_V5_MIN_REGISTRY_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_PAYLOAD_BYTES as WORK_AMO_V5_DECLARATION_MEMO_BYTES,
  WORK_AMO_V5_DECLARATION_PAYLOAD_SHA256 as WORK_AMO_V5_DECLARATION_MEMO_SHA256,
  WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT,
  WORK_AMO_V5_DECLARATION_RECORD_ORDINAL,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS as WORK_AMO_V5_REGISTRY_ADDRESS,
  WORK_AMO_V5_DECLARATION_REGISTRY_PAYMENT_VOUT,
  WORK_AMO_V5_DECLARATION_TXID,
  WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT,
  WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
  WORK_AMO_V5_INCB_TOKEN_ID,
  WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_REASON_CODE,
  WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_TXID,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  WORK_AMO_V5_POWB_TOKEN_ID,
  WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  WORK_AMO_V5_V1_ACTIVATION_HEIGHT as WORK_AMO_V1_ACTIVATION_HEIGHT,
  parseWorkAmoUsdQuoteRecord,
  validateWorkAmoV5SufficientState,
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5CanonicalHistoricalV4ListingWitness,
  workAmoV5CanonicalStateCommitment,
  workAmoV5CanonicalTokenStatePreimage,
  workAmoV5CanonicalTokenStateCommitment,
  workAmoV5ConsensusEventKind,
  workAmoV5EventSetCommitment,
  workAmoV5WorkStateWithoutLegacyListingReservations,
} from "../server/work-amo-v5.mjs";
import {
  WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
  WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState,
  replayWorkAmoV5RawBlock,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "../server/work-amo-v5-raw.mjs";
import {
  WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_MODEL,
  WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_STATUS,
  validatedWorkAmoV5HMinusOneSeedEvidence,
} from "../server/work-amo-v5-seed-evidence.mjs";
import {
  normalizedWorkAmoV5Bip141Witness,
  workAmoV5Bip141WitnessesEqual,
} from "../server/work-amo-v5-bip141.mjs";
import {
  WORK_AMO_V6_AUTH_VERSION,
  workAmoV6CanonicalTokenStateCommitment,
} from "../server/work-amo-v6.mjs";

assertCanonicalUnicodeCaseMappingVersion();

const { Pool } = pg;
const BITCOIN_RPC_URL = String(process.env.BITCOIN_RPC_URL ?? "").trim();
const BITCOIN_RPC_USER = String(process.env.BITCOIN_RPC_USER ?? "").trim();
const BITCOIN_RPC_PASSWORD = String(
  process.env.BITCOIN_RPC_PASSWORD ?? "",
).trim();
const BITCOIN_RPC_TIMEOUT_MS = 15_000;

export {
  WORK_AMO_V1_ACTIVATION_HEIGHT,
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_AUTH_VERSION,
  WORK_AMO_V5_AUTHORITY_SCRIPTPUBKEY,
  WORK_AMO_V5_DECLARATION_BLOCK_HASH,
  WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
  WORK_AMO_V5_DECLARATION_HEIGHT,
  WORK_AMO_V5_DECLARATION_MEMO_BYTES,
  WORK_AMO_V5_DECLARATION_MEMO_SHA256,
  WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT,
  WORK_AMO_V5_DECLARATION_RECORD_ORDINAL,
  WORK_AMO_V5_DECLARATION_REGISTRY_PAYMENT_VOUT,
  WORK_AMO_V5_DECLARATION_TXID,
  WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT,
  WORK_AMO_V5_MIN_REGISTRY_PAYMENT_SATS,
  WORK_AMO_V5_REGISTRY_ADDRESS,
};
const WORK_AMO_V5_RESERVED_TOKEN_IDS = new Set([
  WORK_AMO_V5_POWB_TOKEN_ID,
  WORK_AMO_V5_INCB_TOKEN_ID,
]);
export const WORK_AMO_V5_LEGACY_REASON_CODE =
  WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_REASON_CODE;
export const WORK_AMO_V5_POST_V1_INVALID_LISTING_TXID =
  WORK_AMO_V5_LEGACY_BOOTSTRAP_CARRY_TXID;
export const WORK_AMO_V5_PRE_V1_RELIC_LISTING_TXID =
  "4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1";
export const WORK_AMO_V5_REPLAY_PAGE_SIZE = 10_000;
export const WORK_AMO_V5_REPLAY_MODEL =
  "canonical-work-amo-v5-full-position-replay-v1";
export const WORK_AMO_V5_FEE_TRANSITION_MODEL =
  "canonical-transaction-fee-after-final-record-once-v1";
export const WORK_AMO_V5_INVALID_EVENT_MODEL =
  "invalid-protocol-record-zero-contribution-v1";
const WORK_AMO_VALUE_Q8_SCALE = 100_000_000n;
const WORK_AMO_GROWTH_VALUE_MULTIPLE = 5n;
const WORK_AMO_ID_DENSITY_NUMERATOR = 26_868_933_906_745_133n;
const WORK_AMO_ID_DENSITY_DENOMINATOR = 100_000_000_000_000n;
const WORK_AMO_MOVEMENT_DENOMINATOR = 2_100_000_000_000_000n;
async function canonicalBitcoinRpc(method, params = []) {
  if (!BITCOIN_RPC_URL) {
    throw new Error(
      "BITCOIN_RPC_URL is required for an exact AMO migration tip witness.",
    );
  }
  const headers = { "content-type": "application/json" };
  if (BITCOIN_RPC_USER || BITCOIN_RPC_PASSWORD) {
    headers.authorization = `Basic ${Buffer.from(
      `${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASSWORD}`,
    ).toString("base64")}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BITCOIN_RPC_TIMEOUT_MS);
  try {
    const response = await fetch(BITCOIN_RPC_URL, {
      body: JSON.stringify({
        id: `work-amo-v5-migration-${method}`,
        jsonrpc: "1.0",
        method,
        params,
      }),
      headers,
      method: "POST",
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      throw new Error(
        `Core RPC ${method} failed: ${payload?.error?.message ?? response.status}`,
      );
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

function rowPayload(row) {
  return row?.payload &&
    typeof row.payload === "object" &&
    !Array.isArray(row.payload)
    ? row.payload
    : {};
}

function rawProtocolRecordPartAtVout(rawTx, protocolVout) {
  if (
    !rawTx ||
    typeof rawTx !== "object" ||
    Array.isArray(rawTx) ||
    !Array.isArray(rawTx.vout) ||
    !Number.isSafeInteger(protocolVout) ||
    protocolVout < 0
  ) {
    return null;
  }
  const output = rawTx.vout[protocolVout];
  const candidate = canonicalProtocolCandidateFromOutput(output);
  return candidate
    ? {
        decodeDetail: candidate.detail,
        decodeValid: candidate.decodeValid,
        payloadHex: candidate.payloadHex,
        prefix: candidate.prefix,
        protocolVout,
        reasonCode: candidate.reasonCode,
        scriptPubKeyHex: candidate.scriptPubKeyHex,
        text: candidate.text,
      }
    : null;
}

function rawProtocolRecordParts(rawTx, prefix = "") {
  const parts = [];
  for (let protocolVout = 0; protocolVout < (rawTx?.vout?.length ?? 0);
    protocolVout += 1) {
    const part = rawProtocolRecordPartAtVout(rawTx, protocolVout);
    if (part && (!prefix || part.text.startsWith(prefix))) {
      parts.push(part);
    }
  }
  return parts;
}

function rawValidWorkAmoUsdQuoteRecordParts(rawTx) {
  return rawProtocolRecordParts(rawTx, "pwa1:").filter((part) =>
    Boolean(parseWorkAmoUsdQuoteRecord(part.text)),
  );
}

function rawOutputAddress(output) {
  return String(
    output?.scriptPubKey?.address ??
      output?.scriptpubkey_address ??
      output?.scriptPubKey?.addresses?.[0] ??
      "",
  );
}

function rawOutputSats(output) {
  if (!output || typeof output !== "object") {
    return 0n;
  }
  if (
    Object.hasOwn(output, "scriptpubkey") ||
    Object.hasOwn(output, "scriptpubkey_address") ||
    Object.hasOwn(output, "scriptpubkey_type")
  ) {
    const text = String(output.value ?? "").trim();
    return /^(?:0|[1-9][0-9]*)$/u.test(text)
      ? BigInt(text)
      : 0n;
  }
  try {
    return canonicalCoreBtcValueSats(output.value);
  } catch {
    return 0n;
  }
}

function rawPaymentOutputsBeforeProtocol(rawTx, protocolVout) {
  return (Array.isArray(rawTx?.vout) ? rawTx.vout : [])
    .filter((_output, index) => index < protocolVout)
    .map((output, index) => ({
      address: rawOutputAddress(output),
      amountSats: rawOutputSats(output),
      vout: Number(output?.n ?? index),
    }))
    .filter((output) => output.address && output.amountSats > 0n);
}

function canonicalCoreBtcValueSats(value) {
  const text =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value.toFixed(8)
        : ""
      : String(value ?? "").trim();
  const match = /^([0-9]+)(?:\.([0-9]{0,8}))?$/u.exec(text);
  if (!match) {
    throw new Error("Core returned a non-canonical monetary value.");
  }
  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(8, "0"));
  const sats = whole * 100_000_000n + fractional;
  if (sats > 2_100_000_000_000_000n) {
    throw new Error("Core returned an out-of-range monetary value.");
  }
  return sats;
}

async function canonicalCoreTransactionFeeSats(
  transaction,
  previousTransactions,
) {
  const vin = Array.isArray(transaction?.vin) ? transaction.vin : [];
  const vout = Array.isArray(transaction?.vout) ? transaction.vout : [];
  if (vin.length === 0 || vout.length === 0) {
    throw new Error("Core returned an incomplete transaction for fee proof.");
  }
  const outputTotal = vout.reduce(
    (total, output) =>
      total + canonicalCoreBtcValueSats(output?.value),
    0n,
  );
  if (vin.some((input) => typeof input?.coinbase === "string")) {
    return 0n;
  }
  let inputTotal = 0n;
  for (const input of vin) {
    let previousOutput = input?.prevout;
    if (!previousOutput || previousOutput.value === undefined) {
      const previousTxid = String(input?.txid ?? "").trim().toLowerCase();
      const previousVout = Number(input?.vout);
      if (
        !/^[0-9a-f]{64}$/u.test(previousTxid) ||
        !Number.isSafeInteger(previousVout) ||
        previousVout < 0
      ) {
        throw new Error("Core transaction input prevout is invalid.");
      }
      let previousTransaction = previousTransactions.get(previousTxid);
      if (!previousTransaction) {
        previousTransaction = await canonicalBitcoinRpc(
          "getrawtransaction",
          [previousTxid, true],
        );
        previousTransactions.set(previousTxid, previousTransaction);
      }
      previousOutput = previousTransaction?.vout?.[previousVout];
      if (previousOutput) {
        input.prevout = previousOutput;
      }
    }
    if (previousOutput?.value === undefined) {
      throw new Error(
        "Core could not independently hydrate a transaction input prevout.",
      );
    }
    inputTotal += canonicalCoreBtcValueSats(previousOutput.value);
  }
  if (inputTotal < outputTotal) {
    throw new Error("Core transaction fee proof has negative value.");
  }
  return inputTotal - outputTotal;
}

function canonicalTransactionOutputFacts(transaction, source) {
  const outputs = Array.isArray(transaction?.vout) ? transaction.vout : [];
  return outputs.map((output, index) => {
    const scriptPubKeyHex = String(
      output?.scriptPubKey?.hex ?? output?.scriptpubkey ?? "",
    )
      .trim()
      .toLowerCase();
    const amountSats =
      source === "core"
        ? canonicalCoreBtcValueSats(output?.value)
        : output?.scriptPubKey
          ? canonicalCoreBtcValueSats(output?.value)
          : BigInt(String(output?.value ?? ""));
    if (
      !/^(?:[0-9a-f]{2})+$/u.test(scriptPubKeyHex) ||
      amountSats < 0n ||
      amountSats > 2_100_000_000_000_000n
    ) {
      throw new Error("Canonical transaction output fact is invalid.");
    }
    return {
      address: rawOutputAddress(output),
      amountSats: amountSats.toString(),
      scriptPubKeyHex,
      vout: Number(output?.n ?? index),
    };
  });
}

function canonicalCoreRawReplayTransaction(
  transaction,
  blockHeight,
  blockHash,
) {
  const txid = String(transaction?.txid ?? "").trim().toLowerCase();
  if (
    !/^[0-9a-f]{64}$/u.test(txid) ||
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 1 ||
    !/^[0-9a-f]{64}$/u.test(blockHash)
  ) {
    throw new Error("Canonical Core replay transaction envelope is invalid.");
  }
  const vin = Array.isArray(transaction?.vin)
    ? transaction.vin
    : [];
  const vout = Array.isArray(transaction?.vout)
    ? transaction.vout
    : [];
  return {
    ...transaction,
    blockhash: blockHash,
    blockheight: blockHeight,
    blocktime: Number(transaction?.blocktime ?? transaction?.time ?? 0),
    status: {
      block_hash: blockHash,
      block_height: blockHeight,
      block_time: Number(
        transaction?.blocktime ?? transaction?.time ?? 0,
      ),
      confirmed: true,
    },
    txid,
    vin: vin.map(
      (input) => {
        if (typeof input?.coinbase === "string") {
          return {
            ...input,
            coinbase: input.coinbase.trim().toLowerCase(),
          };
        }
        const previousOutput = input?.prevout;
        return {
          ...input,
          txid: String(input?.txid ?? "").trim().toLowerCase(),
          vout: Number(input?.vout),
          ...(previousOutput
            ? {
                prevout: {
                  ...previousOutput,
                },
              }
            : {}),
        };
      },
    ),
    vout: vout.map((output) => ({ ...output })),
  };
}

function canonicalWorkAmoRawReplayRecords(rawRecords) {
  const grouped = new Map();
  for (const rawRecord of Array.isArray(rawRecords) ? rawRecords : []) {
    const txid = String(rawRecord?.txid ?? "").trim().toLowerCase();
    const key = [
      Number(rawRecord?.blockHeight),
      String(rawRecord?.blockHash ?? "").trim().toLowerCase(),
      Number(rawRecord?.blockTransactionIndex),
      txid,
    ].join(":");
    const group = grouped.get(key) ?? {
      blockHash: String(rawRecord?.blockHash ?? "").trim().toLowerCase(),
      blockHeight: Number(rawRecord?.blockHeight),
      blockTransactionIndex: Number(rawRecord?.blockTransactionIndex),
      rawTransaction: rawRecord?.rawTransaction,
      records: [],
      transactionMinerFeeSats: String(
        rawRecord?.transactionMinerFeeSats ?? "",
      ),
      txid,
    };
    if (
      group.rawTransaction !== rawRecord?.rawTransaction &&
      JSON.stringify(group.rawTransaction) !==
        JSON.stringify(rawRecord?.rawTransaction)
    ) {
      throw new Error(
        `Canonical Core transaction ${txid} changed within raw replay.`,
      );
    }
    group.records.push(rawRecord);
    grouped.set(key, group);
  }
  const records = [];
  for (const group of grouped.values()) {
    const storedParts = group.records
      .map((record) => ({
        decodeDetail: String(record.decodeDetail ?? ""),
        decodeValid: record.decodeValid === true,
        payloadHex: String(record.payloadHex ?? "").toLowerCase(),
        prefix: String(record.prefix ?? ""),
        protocolVout: Number(record.protocolVout),
        reasonCode: String(record.reasonCode ?? ""),
        scriptPubKeyHex: String(record.scriptPubKeyHex ?? "")
          .trim()
          .toLowerCase(),
        text: String(record.text ?? ""),
      }))
      .sort((left, right) => left.protocolVout - right.protocolVout);
    const tx = canonicalCoreRawReplayTransaction(
      group.rawTransaction,
      group.blockHeight,
      group.blockHash,
    );
    const rawRecordSet =
      canonicalRawProtocolRecordSetFromTransaction(tx);
    const replayParts = rawRecordSet.records
      .flatMap((record) => record.rawRecordParts)
      .sort((left, right) => left.protocolVout - right.protocolVout);
    if (
      rawRecordSet.rawProtocolCandidateCount !== group.records.length ||
      JSON.stringify(replayParts) !== JSON.stringify(storedParts)
    ) {
      throw new Error(
        `Canonical Core transaction ${group.txid} raw protocol records diverged during replay reconstruction.`,
      );
    }
    for (const rawRecord of rawRecordSet.records) {
      records.push({
        message: rawRecord.message,
        payload: rawRecord.payload,
        position: {
          blockHash: group.blockHash,
          blockHeight: group.blockHeight,
          blockTransactionIndex: group.blockTransactionIndex,
          protocolVout: rawRecord.protocolVout,
          recordOrdinal: rawRecord.recordOrdinal,
        },
        protocol: rawRecord.protocol,
        rawRecordParts: rawRecord.rawRecordParts,
        rawDecodeReasonCode: rawRecord.rawDecodeReasonCode,
        rawDecodeValid: rawRecord.rawDecodeValid,
        transactionMinerFeeSats: group.transactionMinerFeeSats,
        transactionProtocolRecordCount:
          rawRecordSet.records.length,
        tx,
        txid: group.txid,
      });
    }
  }
  return records.sort((left, right) =>
    [
      "blockHeight",
      "blockTransactionIndex",
      "protocolVout",
      "recordOrdinal",
    ].reduce((difference, field) =>
      difference ||
        Number(left.position[field]) - Number(right.position[field]), 0)
  );
}

async function canonicalRawProtocolCandidateCoverage(
  client,
  {
    consumedCandidateParts,
    expectedFeesByTxid,
    expectedRawTransactionsByTxid,
    fromHeight,
    throughHeight,
  },
) {
  const blockResult = await client.query(
    `
      SELECT height, lower(block_hash) AS block_hash
      FROM proof_indexer.blocks
      WHERE network = 'livenet'
        AND canonical = true
        AND height BETWEEN $1 AND $2
      ORDER BY height
    `,
    [fromHeight, throughHeight],
  );
  if (blockResult.rows.length !== throughHeight - fromHeight + 1) {
    throw new Error(
      "Canonical raw protocol coverage is missing indexed blocks.",
    );
  }
  let rawProtocolCandidateCount = 0;
  let coreTransactionFeeTotalSats = 0n;
  const coreFeeSetHash = createHash("sha256");
  const rawProtocolTransactionTxids = new Set();
  const observedCandidateKeys = new Set();
  const previousTransactions = new Map();
  const canonicalRawProtocolRecords = [];
  const canonicalFullBlocks = [];
  for (const indexedBlock of blockResult.rows) {
    const blockHeight = Number(indexedBlock.height);
    const indexedBlockHash = String(indexedBlock.block_hash ?? "")
      .trim()
      .toLowerCase();
    const coreBlockHash = String(
      await canonicalBitcoinRpc("getblockhash", [blockHeight]),
    )
      .trim()
      .toLowerCase();
    if (coreBlockHash !== indexedBlockHash) {
      throw new Error(
        `Canonical raw protocol block ${blockHeight} diverged from Core.`,
      );
    }
    let block;
    try {
      block = await canonicalBitcoinRpc("getblock", [coreBlockHash, 3]);
    } catch {
      block = await canonicalBitcoinRpc("getblock", [coreBlockHash, 2]);
    }
    if (
      String(block?.hash ?? "").trim().toLowerCase() !== coreBlockHash ||
      Number(block?.height) !== blockHeight ||
      !Array.isArray(block?.tx) ||
      Number(block?.nTx) !== block.tx.length ||
      block.tx.length === 0
    ) {
      throw new Error(
        `Core returned an incomplete canonical block ${blockHeight}.`,
      );
    }
    for (const [blockIndex, transaction] of block.tx.entries()) {
      const txid = String(transaction?.txid ?? "").trim().toLowerCase();
      if (
        !/^[0-9a-f]{64}$/u.test(txid) ||
        !Number.isSafeInteger(blockHeight) ||
        blockHeight < fromHeight ||
        blockHeight > throughHeight ||
        !Number.isSafeInteger(blockIndex) ||
        blockIndex < 0
      ) {
        throw new Error("Canonical raw protocol candidate position is invalid.");
      }
      const parts = rawProtocolRecordParts(transaction);
      let coreFeeSats = 0n;
      if (parts.length > 0) {
        coreFeeSats = await canonicalCoreTransactionFeeSats(
          transaction,
          previousTransactions,
        );
        const expectedFeeSats = expectedFeesByTxid.get(txid);
        if (
          expectedFeeSats !== undefined &&
          BigInt(expectedFeeSats) !== coreFeeSats
        ) {
          throw new Error(
            `Canonical transaction ${txid} fee diverged from direct Core prevouts.`,
          );
        }
        const expectedRawTransaction =
          expectedRawTransactionsByTxid.get(txid);
        const coreOutputFacts = canonicalTransactionOutputFacts(
          transaction,
          "core",
        );
        const indexedOutputFacts = canonicalTransactionOutputFacts(
          expectedRawTransaction,
          "indexed",
        );
        const coreFirstPrevoutScript = String(
          transaction?.vin?.[0]?.prevout?.scriptPubKey?.hex ??
            transaction?.vin?.[0]?.prevout?.scriptpubkey ??
            "",
        )
          .trim()
          .toLowerCase();
        const indexedFirstPrevoutScript = String(
          expectedRawTransaction?.vin?.[0]?.prevout?.scriptPubKey?.hex ??
            expectedRawTransaction?.vin?.[0]?.prevout?.scriptpubkey ??
            "",
        )
          .trim()
          .toLowerCase();
        if (
          expectedRawTransaction &&
          JSON.stringify(coreOutputFacts) !==
            JSON.stringify(indexedOutputFacts)
        ) {
          throw new Error(
            `Canonical transaction ${txid} outputs diverged from direct Core.`,
          );
        }
        if (
          expectedRawTransaction &&
          coreFirstPrevoutScript !== indexedFirstPrevoutScript
        ) {
          throw new Error(
            `Canonical transaction ${txid} authority prevout diverged from direct Core.`,
          );
        }
        rawProtocolTransactionTxids.add(txid);
        coreTransactionFeeTotalSats += coreFeeSats;
        coreFeeSetHash.update(
          [
            blockHeight,
            coreBlockHash,
            blockIndex,
            txid,
            coreFeeSats.toString(),
          ].join("\x1f"),
        );
        coreFeeSetHash.update("\n");
      }
      for (const part of parts) {
        const key = `${txid}:${part.protocolVout}`;
        const expectedPart = consumedCandidateParts.get(key);
        if (
          observedCandidateKeys.has(key) ||
          (
            expectedPart &&
            JSON.stringify(expectedPart) !== JSON.stringify(part)
          )
        ) {
          throw new Error(
            `Canonical Core protocol candidate ${key} is duplicated or changed.`,
          );
        }
        observedCandidateKeys.add(key);
        rawProtocolCandidateCount += 1;
        canonicalRawProtocolRecords.push({
          blockHash: coreBlockHash,
          blockHeight,
          blockTransactionIndex: blockIndex,
          decodeDetail: part.decodeDetail,
          decodeValid: part.decodeValid,
          payloadHex: part.payloadHex,
          prefix: part.prefix,
          protocolVout: part.protocolVout,
          rawTransaction: transaction,
          reasonCode: part.reasonCode,
          scriptPubKeyHex: part.scriptPubKeyHex,
          text: part.text,
          transactionMinerFeeSats: coreFeeSats.toString(),
          txid,
        });
      }
    }
    const blockHeaderHex = String(
      await canonicalBitcoinRpc(
        "getblockheader",
        [coreBlockHash, false],
      ),
    )
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f]{160}$/u.test(blockHeaderHex)) {
      throw new Error(
        `Core returned an invalid canonical block header at ${blockHeight}.`,
      );
    }
    canonicalFullBlocks.push({
      blockHash: coreBlockHash,
      blockHeaderHex,
      blockHeight,
    });
  }
  if (
    [...consumedCandidateParts.keys()].some(
      (key) => !observedCandidateKeys.has(key),
    )
  ) {
    throw new Error(
      "Canonical raw protocol candidate coverage is incomplete.",
    );
  }
  return {
    blockCount: blockResult.rows.length,
    coreTransactionFeeSetSha256: coreFeeSetHash.digest("hex"),
    coreTransactionFeeTotalSats:
      coreTransactionFeeTotalSats.toString(),
    canonicalFullBlocks,
    canonicalRawProtocolRecords,
    rawProtocolCandidateCount,
    rawProtocolTransactionCount: rawProtocolTransactionTxids.size,
  };
}

function exactStringArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function recomputedWorkAmoSufficientState(state) {
  const next = structuredClone(state);
  const base = Object.fromEntries(
    WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [
      field,
      BigInt(next.baseState[field]),
    ]),
  );
  const marketplaceFlowSats =
    base.idMarketplaceVolumeSats +
    base.tokenSaleVolumeSats +
    base.idMarketplaceFeeSats +
    base.tokenMarketplaceFeeSats;
  const baseNetworkValueQ8 =
    (
      base.powids *
      base.powids *
      WORK_AMO_ID_DENSITY_NUMERATOR *
      WORK_AMO_VALUE_Q8_SCALE
    ) /
      WORK_AMO_ID_DENSITY_DENOMINATOR +
    (
      base.mailFlowSats +
      base.inceptionBondFlowSats +
      base.infinityBondFlowSats +
      base.driveFlowSats +
      marketplaceFlowSats +
      base.browserFlowSats +
      base.tokenCreationFlowSats +
      base.tokenMintFlowSats +
      base.tokenTransferFlowSats +
      base.computerEventFlowSats
    ) *
      WORK_AMO_GROWTH_VALUE_MULTIPLE *
      WORK_AMO_VALUE_Q8_SCALE;
  const frozenNetworkValueQ8 =
    baseNetworkValueQ8 +
    BigInt(next.creditFixedQ8) +
    BigInt(next.creditMovementFrozenValueQ8);
  const movementLiveValueQ8 = next.movements.reduce(
    (total, movement) =>
      total +
      (
        BigInt(movement.amountAtoms) * frozenNetworkValueQ8
      ) /
        WORK_AMO_MOVEMENT_DENOMINATOR,
    0n,
  );
  next.networkValueQ8 = (
    baseNetworkValueQ8 +
    BigInt(next.creditFixedQ8) +
    movementLiveValueQ8
  ).toString();
  return next;
}

function canonicalIndependentWorkTokenState(value) {
  const canonical = workAmoV5CanonicalTokenStatePreimage(value);
  return {
    confirmedSupplyAtoms: canonical.confirmedSupplyAtoms,
    holders: canonical.holders.map((holder) => ({ ...holder })),
    listings: canonical.listings.map((listing) =>
      structuredClone(listing)
    ),
  };
}

function exactNonNegativeSafeInteger(value, { positive = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= (positive ? 1 : 0)
    ? parsed
    : null;
}

function workAmoMovementIdentity(payload, kind, row) {
  const txid = String(row?.txid ?? "").trim().toLowerCase();
  const protocolVout = exactNonNegativeSafeInteger(
    row?.protocol_vout ?? row?.op_return_vout,
  );
  const recordOrdinal = exactNonNegativeSafeInteger(row?.record_ordinal);
  if (
    !/^[0-9a-f]{64}$/u.test(txid) ||
    protocolVout === null ||
    recordOrdinal === null
  ) {
    throw new Error("Independent WORK movement position is invalid.");
  }
  return [
    String(kind ?? "").trim().toLowerCase(),
    txid,
    protocolVout,
    recordOrdinal,
  ].join(":");
}

function canonicalHistoricalV4FrozenTerms(row, authorization) {
  const positiveText = (value) => {
    const text = String(value ?? "").trim();
    return /^[1-9][0-9]*$/u.test(text) ? BigInt(text).toString() : "";
  };
  const blockHash = String(row?.block_hash ?? "").trim().toLowerCase();
  const blockHeight = exactNonNegativeSafeInteger(row?.block_height, {
    positive: true,
  });
  const blockIndex = exactNonNegativeSafeInteger(row?.block_index);
  const protocolVout = exactNonNegativeSafeInteger(row?.protocol_vout);
  const recordOrdinal = exactNonNegativeSafeInteger(row?.record_ordinal);
  const unitAmountAtoms = positiveText(
    authorization?.unitAmountAtoms ?? authorization?.amountAtoms,
  );
  const unitPriceSats = positiveText(
    authorization?.unitPriceSats ?? authorization?.priceSats,
  );
  const unitMinimumPriceSats = positiveText(
    authorization?.unitMinimumPriceSats ??
      authorization?.minimumPriceSats,
  );
  const unitNetworkValueBeforeQ8 = positiveText(
    authorization?.unitNetworkValueBeforeQ8 ??
      authorization?.unitNetworkValueQ8,
  );
  const unitFaceUsdCents = Number(authorization?.unitFaceUsdCents);
  const unitFaceUsd = Number(authorization?.unitFaceUsd);
  if (
    authorization?.version !== "pwt-sale-v4" ||
    String(authorization?.tokenId ?? "").trim().toLowerCase() !==
      WORK_TOKEN_ID ||
    !/^[0-9a-f]{64}$/u.test(blockHash) ||
    blockHeight === null ||
    blockHeight < WORK_AMO_V1_ACTIVATION_HEIGHT ||
    blockHeight >= WORK_AMO_V5_ACTIVATION_HEIGHT ||
    blockIndex === null ||
    protocolVout === null ||
    recordOrdinal === null ||
    !unitAmountAtoms ||
    !unitPriceSats ||
    !unitMinimumPriceSats ||
    !unitNetworkValueBeforeQ8 ||
    !Number.isSafeInteger(unitFaceUsdCents) ||
    unitFaceUsd !== unitFaceUsdCents / 100
  ) {
    throw new Error(
      "Independent WORK V4 listing witness is incomplete.",
    );
  }
  return {
    authorizationVersion: "pwt-sale-v4",
    blockHash,
    blockHeight,
    blockIndex,
    blockTransactionIndex: blockIndex,
    canonical: true,
    confirmed: true,
    listingBlockHash: blockHash,
    listingBlockHeight: blockHeight,
    listingBlockIndex: blockIndex,
    listingProtocolVout: protocolVout,
    listingRecordOrdinal: recordOrdinal,
    protocolVout,
    recordOrdinal,
    tokenId: WORK_TOKEN_ID,
    unitAmountAtoms,
    unitFaceUsd,
    unitFaceUsdCents,
    unitMinimumPriceSats,
    unitNetworkValueBeforeQ8,
    unitPriceSats,
    valid: true,
  };
}

function canonicalWorkAmoExactSeedInteger(
  value,
  {
    allowSafeLegacyNumber = false,
    positive = false,
  } = {},
) {
  if (typeof value === "string") {
    const pattern = positive ? /^[1-9][0-9]*$/u : /^(?:0|[1-9][0-9]*)$/u;
    return pattern.test(value) ? BigInt(value).toString() : "";
  }
  if (
    allowSafeLegacyNumber &&
    Number.isSafeInteger(value) &&
    (positive ? value > 0 : value >= 0)
  ) {
    return String(value);
  }
  return "";
}

export function canonicalWorkAmoIndependentBaseVector(actual) {
  if (
    !actual ||
    typeof actual !== "object" ||
    Array.isArray(actual)
  ) {
    throw new Error("Independent AMO H-1 base vector is unavailable.");
  }
  const baseState = {};
  for (const field of WORK_AMO_V5_BASE_STATE_FIELDS) {
    const value = canonicalWorkAmoExactSeedInteger(actual[field], {
      allowSafeLegacyNumber: true,
    });
    if (!value) {
      throw new Error(
        `Independent AMO H-1 base field ${field} is unavailable.`,
      );
    }
    baseState[field] = value;
  }
  const creditEventFrozenValueQ8 =
    canonicalWorkAmoExactSeedInteger(
      actual.creditEventFrozenValueQ8,
      { allowSafeLegacyNumber: true },
    );
  const creditMovementFrozenValueQ8 =
    canonicalWorkAmoExactSeedInteger(
      actual.creditMovementFrozenValueQ8,
      { allowSafeLegacyNumber: true },
    );
  if (
    !creditEventFrozenValueQ8 ||
    !creditMovementFrozenValueQ8 ||
    BigInt(creditEventFrozenValueQ8) <
      BigInt(creditMovementFrozenValueQ8)
  ) {
    throw new Error("Independent AMO H-1 credit vector is unavailable.");
  }
  return {
    baseState,
    creditEventFrozenValueQ8,
    creditMovementFrozenValueQ8,
  };
}

function canonicalWorkAmoJsonNumbersAreExact(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value);
  }
  if (Array.isArray(value)) {
    return value.every(canonicalWorkAmoJsonNumbersAreExact);
  }
  if (value && typeof value === "object") {
    return Object.values(value).every(canonicalWorkAmoJsonNumbersAreExact);
  }
  return true;
}

function canonicalWorkAmoExactGenericSeedProjection(
  value,
  { allowSafeLegacyNumbers = false } = {},
) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  if (
    !source ||
    !canonicalWorkAmoJsonNumbersAreExact(source) ||
    !Array.isArray(source.tokens) ||
    !Array.isArray(source.holders) ||
    !Array.isArray(source.listings)
  ) {
    throw new Error(
      "Canonical AMO generic seed contains an inexact JSON number or incomplete arrays.",
    );
  }
  const sourceTokens = source.tokens.filter(
    (token) =>
      String(token?.tokenId ?? "").trim().toLowerCase() !== WORK_TOKEN_ID,
  );
  const tokenSupply = new Map();
  const tokens = sourceTokens.map((token) => {
    const tokenId = String(token?.tokenId ?? "").trim().toLowerCase();
    const bond = WORK_AMO_V5_RESERVED_TOKEN_IDS.has(tokenId);
    const maxSupply =
      token?.maxSupply === null ||
      token?.maxSupply === undefined ||
      token?.maxSupplyModel === "uncapped"
        ? null
        : canonicalWorkAmoExactSeedInteger(token.maxSupply, {
            allowSafeLegacyNumber:
              allowSafeLegacyNumbers && !bond,
            positive: true,
          });
    const mintAmount = canonicalWorkAmoExactSeedInteger(
      token?.mintAmount,
      {
        allowSafeLegacyNumber:
          allowSafeLegacyNumbers && !bond,
        positive: true,
      },
    );
    const mintPriceSats = canonicalWorkAmoExactSeedInteger(
      token?.mintPriceSats,
      {
        allowSafeLegacyNumber:
          allowSafeLegacyNumbers && !bond,
        positive: true,
      },
    );
    const confirmedSupplyAtoms =
      canonicalWorkAmoExactSeedInteger(
        token?.confirmedSupplyAtoms ??
          token?.confirmedSupply,
        {
          allowSafeLegacyNumber:
            allowSafeLegacyNumbers && !bond,
        },
      );
    if (
      !/^[0-9a-f]{64}$/u.test(tokenId) ||
      (bond ? maxSupply !== null : !maxSupply) ||
      !mintAmount ||
      !mintPriceSats ||
      !confirmedSupplyAtoms ||
      (
        allowSafeLegacyNumbers &&
        !bond &&
        (
          BigInt(maxSupply) > BigInt(Number.MAX_SAFE_INTEGER) ||
          BigInt(mintAmount) > BigInt(Number.MAX_SAFE_INTEGER) ||
          BigInt(mintPriceSats) > BigInt(Number.MAX_SAFE_INTEGER)
        )
      ) ||
      tokenSupply.has(tokenId)
    ) {
      throw new Error(
        `Canonical AMO generic seed definition ${tokenId} is inexact.`,
      );
    }
    tokenSupply.set(tokenId, confirmedSupplyAtoms);
    return {
      ...token,
      confirmedSupplyAtoms,
      maxSupply,
      mintAmount,
      mintPriceSats,
      tokenId,
    };
  });
  const balances = new Map();
  const holders = source.holders
    .filter(
      (holder) =>
        String(holder?.tokenId ?? "").trim().toLowerCase() !==
        WORK_TOKEN_ID,
    )
    .map((holder) => {
      const tokenId = String(holder?.tokenId ?? "").trim().toLowerCase();
      const bond = WORK_AMO_V5_RESERVED_TOKEN_IDS.has(tokenId);
      const balance = canonicalWorkAmoExactSeedInteger(
        holder?.balanceAtoms ??
          holder?.balance ??
          holder?.confirmedBalance,
        {
          allowSafeLegacyNumber:
            allowSafeLegacyNumbers && !bond,
          positive: true,
        },
      );
      const address = String(holder?.address ?? "").trim();
      const key = `${tokenId}\x00${address}`;
      if (
        !tokenSupply.has(tokenId) ||
        !address ||
        !balance ||
        balances.has(key)
      ) {
        throw new Error(
          `Canonical AMO generic seed holder ${key} is inexact.`,
        );
      }
      balances.set(key, balance);
      return {
        ...holder,
        address,
        balance,
        tokenId,
      };
    });
  const listings = source.listings
    .filter(
      (listing) =>
        String(
          listing?.tokenId ??
            listing?.saleAuthorization?.tokenId ??
            "",
        )
          .trim()
          .toLowerCase() !== WORK_TOKEN_ID,
    )
    .map((listing) => {
      const tokenId = String(
        listing?.tokenId ??
          listing?.saleAuthorization?.tokenId ??
          "",
      )
        .trim()
        .toLowerCase();
      const bond = WORK_AMO_V5_RESERVED_TOKEN_IDS.has(tokenId);
      const amount = canonicalWorkAmoExactSeedInteger(
        listing?.amountAtoms ?? listing?.amount,
        {
          allowSafeLegacyNumber:
            allowSafeLegacyNumbers && !bond,
          positive: true,
        },
      );
      const priceSats = canonicalWorkAmoExactSeedInteger(
        listing?.priceSats,
        {
          allowSafeLegacyNumber:
            allowSafeLegacyNumbers && !bond,
          positive: true,
        },
      );
      if (
        !tokenSupply.has(tokenId) ||
        !amount ||
        !priceSats
      ) {
        throw new Error(
          `Canonical AMO generic seed listing ${String(
            listing?.listingId ?? listing?.txid ?? "",
          )} is inexact.`,
        );
      }
      return {
        ...listing,
        amount,
        priceSats,
        tokenId,
      };
    });
  const projection = normalizeWorkAmoV5RawGenericState({
    holders,
    listings,
    tokens,
  });
  if (
    projection.tokens.length !== tokens.length ||
    projection.holders.length !== holders.length ||
    projection.listings.length !== listings.length
  ) {
    throw new Error(
      "Canonical AMO generic seed normalization dropped or merged a row.",
    );
  }
  const computedSupply = new Map();
  const computedBalances = new Map();
  for (const holder of projection.holders) {
    computedSupply.set(
      holder.tokenId,
      (computedSupply.get(holder.tokenId) ?? 0n) +
        BigInt(holder.balance),
    );
    computedBalances.set(
      `${holder.tokenId}\x00${holder.address}`,
      BigInt(holder.balance),
    );
  }
  for (const token of projection.tokens) {
    const supply = (
      computedSupply.get(token.tokenId) ?? 0n
    ).toString();
    if (
      supply !== tokenSupply.get(token.tokenId) ||
      token.confirmedSupplyAtoms !== supply ||
      (
        token.maxSupply !== null &&
        BigInt(supply) > BigInt(token.maxSupply)
      )
    ) {
      throw new Error(
        `Canonical AMO generic seed supply ${token.tokenId} is inexact.`,
      );
    }
  }
  const reserved = new Map();
  for (const listing of projection.listings) {
    const key = `${listing.tokenId}\x00${listing.sellerAddress}`;
    reserved.set(
      key,
      (reserved.get(key) ?? 0n) + BigInt(listing.amount),
    );
  }
  for (const [key, amount] of reserved) {
    if (amount > (computedBalances.get(key) ?? 0n)) {
      throw new Error(
        `Canonical AMO generic seed reservation ${key} exceeds balance.`,
      );
    }
  }
  return projection;
}

function canonicalWorkAmoPersistedActivationSeed(row, seed) {
  const payload = transitionPayload(row);
  const seedHeight = WORK_AMO_V5_ACTIVATION_HEIGHT - 1;
  if (
    !canonicalWorkAmoJsonNumbersAreExact(payload.seedIdState) ||
    !canonicalWorkAmoJsonNumbersAreExact(payload.seedTokenState) ||
    !canonicalWorkAmoJsonNumbersAreExact(payload.seedWorkProjection)
  ) {
    throw new Error(
      "Persisted AMO activation seed contains an unsafe JSON number.",
    );
  }
  const stateValidation = validateWorkAmoV5SufficientState(
    payload.seedSufficientState,
  );
  const openingValidation = validateWorkAmoV5SufficientState(
    payload.openingSufficientState,
  );
  const declaredSeedCommitment = exactCommitment(
    payload.seedSufficientStateCommitment,
    WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  );
  const declaredOpeningCommitment = exactCommitment(
    payload.openingStateCommitment,
    WORK_AMO_V5_STATE_COMMITMENT_MODEL,
  );
  const declaredTransitionChainCommitment = exactCommitment(
    payload.transitionChainCommitment,
    WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
  );
  const declaredBlockDescriptorCommitment = exactCommitment(
    payload.blockDescriptorCommitment,
    WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
  );
  const blockTransactionCount = Number(
    payload.blockTransactionCount,
  );
  const bip141Witness = normalizedWorkAmoV5Bip141Witness(
    payload.bip141Witness,
    blockTransactionCount,
  );
  const genericTokenProjection =
    canonicalWorkAmoExactGenericSeedProjection(
      payload.seedGenericTokenState,
    );
  const idStateProjection = normalizeWorkAmoV5RawIdState(
    payload.seedIdState,
  );
  const tokenState = normalizeWorkAmoV5RawWorkState(
    payload.seedTokenState,
  );
  const workProjection = normalizeWorkAmoV5RawWorkState(
    payload.seedWorkProjection,
  );
  const commitment = stateValidation.valid
    ? workAmoV5CanonicalStateCommitment(stateValidation.state)
    : null;
  const openingCommitment = openingValidation.valid
    ? workAmoV5CanonicalStateCommitment(openingValidation.state)
    : null;
  const genericCommitment =
    workAmoV5RawGenericStateCommitment(genericTokenProjection);
  const idCommitment =
    workAmoV5RawIdStateCommitment(idStateProjection);
  const tokenCommitment =
    workAmoV5CanonicalTokenStateCommitment(tokenState);
  const workProjectionCommitment =
    workAmoV5CanonicalTokenStateCommitment(workProjection);
  if (
    row.complete !== true ||
    payload.complete !== true ||
    payload.network !== "livenet" ||
    payload.model !== WORK_AMO_V5_BLOCK_SEQUENCER_MODEL ||
    payload.blockDescriptorModel !==
      WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL ||
    !declaredBlockDescriptorCommitment ||
    !Number.isSafeInteger(blockTransactionCount) ||
    blockTransactionCount < 1 ||
    !bip141Witness ||
    payload.transitionChainModel !==
      WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL ||
    row.model !== WORK_AMO_V5_BLOCK_SEQUENCER_MODEL ||
    row.state_commitment_model !== WORK_AMO_V5_STATE_COMMITMENT_MODEL ||
    Number(row.block_height) !== WORK_AMO_V5_ACTIVATION_HEIGHT ||
    Number(payload.blockHeight) !== WORK_AMO_V5_ACTIVATION_HEIGHT ||
    !/^[0-9a-f]{64}$/u.test(
      String(row.block_hash ?? "").trim().toLowerCase(),
    ) ||
    String(payload.blockHash ?? "").trim().toLowerCase() !==
      String(row.block_hash ?? "").trim().toLowerCase() ||
    String(row.previous_block_hash ?? "").trim().toLowerCase() !==
      WORK_AMO_V5_DECLARATION_BLOCK_HASH ||
    String(payload.previousBlockHash ?? "").trim().toLowerCase() !==
      WORK_AMO_V5_DECLARATION_BLOCK_HASH ||
    !stateValidation.valid ||
    !openingValidation.valid ||
    stateValidation.state.throughBlockHeight !== seedHeight ||
    stateValidation.state.throughBlockHash !==
      WORK_AMO_V5_DECLARATION_BLOCK_HASH ||
    stateValidation.state.networkValueQ8 !==
      String(seed?.networkValueQ8 ?? "") ||
    String(row.opening_network_value_q8 ?? "") !==
      stateValidation.state.networkValueQ8 ||
    String(payload.openingNetworkValueQ8 ?? "") !==
      stateValidation.state.networkValueQ8 ||
    !declaredSeedCommitment ||
    !declaredOpeningCommitment ||
    !declaredTransitionChainCommitment ||
    commitment.sha256 !== declaredSeedCommitment.sha256 ||
    commitment.payloadBytes !== declaredSeedCommitment.payloadBytes ||
    commitment.sha256 !== declaredOpeningCommitment.sha256 ||
    commitment.payloadBytes !== declaredOpeningCommitment.payloadBytes ||
    commitment.sha256 !== openingCommitment.sha256 ||
    commitment.payloadBytes !== openingCommitment.payloadBytes ||
    commitment.sha256 !==
      String(row.opening_state_sha256 ?? "").trim().toLowerCase() ||
    commitment.payloadBytes !== Number(row.opening_state_payload_bytes) ||
    stateValidation.state.genericTokenStateCommitment.sha256 !==
      genericCommitment.sha256 ||
    stateValidation.state.genericTokenStateCommitment.payloadBytes !==
      genericCommitment.payloadBytes ||
    stateValidation.state.idStateCommitment.sha256 !==
      idCommitment.sha256 ||
    stateValidation.state.idStateCommitment.payloadBytes !==
      idCommitment.payloadBytes ||
    stateValidation.state.tokenStateCommitment.sha256 !==
      tokenCommitment.sha256 ||
    stateValidation.state.tokenStateCommitment.payloadBytes !==
      tokenCommitment.payloadBytes ||
    tokenCommitment.sha256 !== workProjectionCommitment.sha256 ||
    tokenCommitment.payloadBytes !==
      workProjectionCommitment.payloadBytes
  ) {
    throw new Error(
      "Persisted AMO activation seed does not bind exact opening state.",
    );
  }
  return {
    commitment,
    genericTokenProjection,
    idStateProjection,
    source: "persisted-activation-transition",
    state: stateValidation.state,
    tokenState,
    workProjection,
  };
}

async function canonicalWorkAmoSeedEvidence(client, seed) {
  const seedHeight = WORK_AMO_V5_ACTIVATION_HEIGHT - 1;
  const activationTransitionResult = await client.query(
    `
      SELECT
        block_height,
        block_hash,
        complete,
        model,
        opening_network_value_q8::text AS opening_network_value_q8,
        opening_state_payload_bytes,
        opening_state_sha256,
        previous_block_hash,
        state_commitment_model,
        payload
      FROM proof_indexer.work_amo_block_transitions
      WHERE network = 'livenet'
        AND block_height = $1
      LIMIT 2
    `,
    [WORK_AMO_V5_ACTIVATION_HEIGHT],
  );
  if (activationTransitionResult.rows.length !== 1) {
    throw new Error(
      "Canonical AMO activation transition is unavailable or not unique.",
    );
  }
  const evidenceResult = await client.query(
    `
      SELECT
        snapshot_id,
        indexed_through_block,
        source_hashes,
        consistency,
        payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = 'livenet'
        AND payload->>'model' = $1
      ORDER BY snapshot_id ASC
    `,
    [WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_MODEL],
  );
  if (evidenceResult.rows.length !== 1) {
    throw new Error(
      "Canonical AMO H-1 seed evidence is unavailable or not unique.",
    );
  }
  const evidenceRow = evidenceResult.rows[0];
  const evidence =
    validatedWorkAmoV5HMinusOneSeedEvidence(evidenceRow.payload);
  const evidenceSourceHashes =
    evidenceRow?.source_hashes &&
    typeof evidenceRow.source_hashes === "object" &&
    !Array.isArray(evidenceRow.source_hashes)
      ? evidenceRow.source_hashes
      : {};
  const evidenceConsistency =
    evidenceRow?.consistency &&
    typeof evidenceRow.consistency === "object" &&
    !Array.isArray(evidenceRow.consistency)
      ? evidenceRow.consistency
      : {};
  const seedSnapshotIds = Array.isArray(seed?.snapshotIds)
    ? seed.snapshotIds.map((value) => String(value ?? "").trim())
    : [];
  if (
    !evidence ||
    Object.keys(evidenceSourceHashes).sort().join(",") !==
      "amoSeedBlock,amoSeedCanonicalSummary,amoSeedEvidence" ||
    Object.keys(evidenceConsistency).sort().join(",") !== "ok,status" ||
    evidenceRow.snapshot_id !== evidence.snapshotId ||
    Number(evidenceRow.indexed_through_block) !== seedHeight ||
    evidenceSourceHashes.amoSeedBlock !==
      WORK_AMO_V5_DECLARATION_BLOCK_HASH ||
    evidenceSourceHashes.amoSeedCanonicalSummary !==
      evidence.canonicalSummary.canonicalSummaryHash ||
    evidenceSourceHashes.amoSeedEvidence !==
      evidence.evidenceCommitment.sha256 ||
    evidenceConsistency.ok !== true ||
    evidenceConsistency.status !==
      WORK_AMO_V5_H_MINUS_ONE_SEED_EVIDENCE_STATUS ||
    !seedSnapshotIds.includes(evidence.canonicalSummary.snapshotId) ||
    evidence.canonicalSummary.canonicalSummaryHash !==
      String(seed?.summaryHash ?? "").trim().toLowerCase() ||
    evidence.canonicalSummary.networkValueQ8 !==
      String(seed?.networkValueQ8 ?? "")
  ) {
    throw new Error(
      "Canonical AMO H-1 seed evidence does not bind the pinned summary.",
    );
  }
  const snapshotId = evidence.canonicalSummary.snapshotId;
  const snapshotResult = await client.query(
    `
      SELECT
        payload->'summaryPayloads'->'workFloor'
          ->'actualValue' AS actual_value
      FROM proof_indexer.ledger_snapshots
      WHERE network = 'livenet'
        AND snapshot_id = $1
        AND indexed_through_block = $2
        AND lower(source_hashes->>'blockScan') = $3
        AND lower(source_hashes->>'canonicalSummary') = $4
      LIMIT 1
    `,
    [
      snapshotId,
      seedHeight,
      WORK_AMO_V5_DECLARATION_BLOCK_HASH,
      String(seed?.summaryHash ?? "").trim().toLowerCase(),
    ],
  );
  const eventResult = await client.query(
    `
      SELECT
        event_row.event_id,
        event_row.txid,
        event_row.kind,
        event_row.block_height,
        event_row.block_index,
        event_row.op_return_vout,
        event_row.record_ordinal,
        lower(event_tx.block_hash) AS block_hash,
        event_row.payload
      FROM proof_indexer.events event_row
      JOIN proof_indexer.transactions event_tx
        ON event_tx.network = event_row.network
       AND event_tx.txid = event_row.txid
       AND event_tx.status = 'confirmed'
       AND event_tx.block_height = event_row.block_height
       AND event_tx.block_index = event_row.block_index
      JOIN proof_indexer.blocks event_block
        ON event_block.network = event_tx.network
       AND event_block.block_hash = event_tx.block_hash
       AND event_block.height = event_tx.block_height
       AND event_block.canonical = true
      WHERE event_row.network = 'livenet'
        AND event_row.status = 'confirmed'
        AND event_row.valid = true
        AND event_row.protocol = 'pwt1'
        AND event_row.kind IN (
          'token-mint',
          'token-transfer',
          'token-listing',
          'token-listing-sealed',
          'token-sale',
          'token-listing-closed'
        )
        AND event_row.block_height <= $1
        AND lower(COALESCE(event_row.payload->>'tokenId', '')) = $2
      ORDER BY
        event_row.block_height,
        event_row.block_index,
        event_row.op_return_vout,
        event_row.record_ordinal,
        event_row.event_id
    `,
    [seedHeight, WORK_TOKEN_ID],
  );
  const quoteResult = await client.query(
    `
      SELECT
        txid,
        declaration_txid,
        sequence::text,
        previous_quote_txid,
        usd_per_100m_proofs_q8::text,
        block_hash,
        block_height,
        block_index,
        protocol_vout,
        record_ordinal
      FROM proof_indexer.work_usd_quotes
      WHERE network = 'livenet'
        AND status = 'confirmed'
        AND valid = true
        AND block_height <= $1
      ORDER BY
        block_height DESC,
        block_index DESC,
        protocol_vout DESC,
        record_ordinal DESC
      LIMIT 1
    `,
    [seedHeight],
  );
  const actual = snapshotResult.rows[0]?.actual_value;
  const genericTokenProjection =
    canonicalWorkAmoExactGenericSeedProjection(
      evidence.seedGenericTokenState,
    );
  const genericTokenStateCommitment =
    workAmoV5RawGenericStateCommitment(genericTokenProjection);
  const idStateProjection =
    normalizeWorkAmoV5RawIdState(evidence.seedIdState);
  const idStateCommitment =
    workAmoV5RawIdStateCommitment(idStateProjection);
  if (
    genericTokenStateCommitment.sha256 !==
      evidence.commitments.genericTokenState.sha256 ||
    genericTokenStateCommitment.payloadBytes !==
      evidence.commitments.genericTokenState.payloadBytes ||
    idStateCommitment.sha256 !==
      evidence.commitments.idState.sha256 ||
    idStateCommitment.payloadBytes !==
      evidence.commitments.idState.payloadBytes
  ) {
    throw new Error(
      "Canonical AMO H-1 token or ID evidence commitment diverged.",
    );
  }
  const {
    baseState,
    creditEventFrozenValueQ8,
    creditMovementFrozenValueQ8,
  } = canonicalWorkAmoIndependentBaseVector(actual);
  const balances = new Map();
  const activeListings = new Map();
  const movements = [];
  let confirmedSupplyAtoms = 0n;
  const addBalance = (address, delta, label) => {
    const normalized = String(address ?? "").trim();
    const next = (balances.get(normalized) ?? 0n) + delta;
    if (!normalized || next < 0n) {
      throw new Error(`Independent WORK seed replay failed at ${label}.`);
    }
    balances.set(normalized, next);
  };
  for (const row of eventResult.rows) {
    const payload =
      row?.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload)
        ? row.payload
        : {};
    if (row.kind === "token-listing") {
      const authorization =
        payload?.saleAuthorization &&
        typeof payload.saleAuthorization === "object" &&
        !Array.isArray(payload.saleAuthorization)
          ? payload.saleAuthorization
          : payload?.listingAuthorization &&
              typeof payload.listingAuthorization === "object" &&
              !Array.isArray(payload.listingAuthorization)
            ? payload.listingAuthorization
            : null;
      if (authorization?.version !== "pwt-sale-v4") {
        continue;
      }
      const listingId = String(row.txid ?? "").trim().toLowerCase();
      const frozenTerms = canonicalHistoricalV4FrozenTerms(
        row,
        authorization,
      );
      const canonicalWitness =
        workAmoV5CanonicalHistoricalV4ListingWitness(
          authorization,
          frozenTerms,
        );
      const sellerAddress = String(
        authorization.sellerAddress ?? payload.sellerAddress ?? "",
      ).trim();
      if (
        !/^[0-9a-f]{64}$/u.test(listingId) ||
        !sellerAddress ||
        !canonicalWitness ||
        activeListings.has(listingId)
      ) {
        throw new Error(
          "Independent WORK V4 listing replay is ambiguous.",
        );
      }
      activeListings.set(listingId, {
        amountAtoms:
          canonicalWitness.frozenTerms.unitAmountAtoms,
        frozenTerms: canonicalWitness.frozenTerms,
        listingId,
        priceSats: canonicalWitness.frozenTerms.unitPriceSats,
        saleAuthorization: canonicalWitness.saleAuthorization,
        sellerAddress,
      });
      continue;
    }
    if (
      row.kind === "token-listing-sealed" ||
      row.kind === "token-listing-closed"
    ) {
      const listingId = String(
        payload?.listingId ?? payload?.saleAuthorization?.anchorTxid ?? "",
      )
        .trim()
        .toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(listingId)) {
        if (payload?.saleAuthorization?.version === "pwt-sale-v4") {
          throw new Error(
            "Independent WORK listing lifecycle reference is invalid.",
          );
        }
        continue;
      }
      if (row.kind === "token-listing-closed") {
        if (
          !activeListings.delete(listingId) &&
          payload?.saleAuthorization?.version === "pwt-sale-v4"
        ) {
          throw new Error(
            "Independent WORK V4 close has no active reservation.",
          );
        }
      } else if (!activeListings.has(listingId)) {
        if (payload?.saleAuthorization?.version === "pwt-sale-v4") {
          throw new Error(
            "Independent WORK seal has no active V4 reservation.",
          );
        }
        continue;
      }
      continue;
    }
    const amountAtoms = BigInt(workAmountAtomsFromRecord(payload));
    if (amountAtoms <= 0n) {
      throw new Error("Independent WORK seed amount is invalid.");
    }
    if (row.kind === "token-mint") {
      confirmedSupplyAtoms += amountAtoms;
      addBalance(
        payload.minterAddress,
        amountAtoms,
        `${row.kind}:${row.txid}`,
      );
    } else {
      addBalance(
        row.kind === "token-sale"
          ? payload.sellerAddress
          : payload.senderAddress,
        -amountAtoms,
        `${row.kind}:${row.txid}`,
      );
      if (row.kind === "token-sale") {
        const listingId = String(payload?.listingId ?? "")
          .trim()
          .toLowerCase();
        const v4Sale =
          payload?.saleAuthorization?.version === "pwt-sale-v4";
        if (v4Sale && !/^[0-9a-f]{64}$/u.test(listingId)) {
          throw new Error(
            "Independent WORK V4 sale reference is invalid.",
          );
        }
        if (
          /^[0-9a-f]{64}$/u.test(listingId) &&
          !activeListings.delete(listingId) &&
          v4Sale
        ) {
          throw new Error(
            "Independent WORK V4 sale has no active reservation.",
          );
        }
      }
      addBalance(
        row.kind === "token-sale"
          ? payload.buyerAddress
          : payload.recipientAddress,
        amountAtoms,
        `${row.kind}:${row.txid}`,
      );
    }
    movements.push({
      amountAtoms: amountAtoms.toString(),
      identity: workAmoMovementIdentity(
        payload,
        row.kind === "token-mint"
          ? "mint"
          : row.kind === "token-sale"
            ? "sale"
            : "transfer",
        row,
      ),
    });
  }
  const holders = [...balances]
    .filter(([, balance]) => balance > 0n)
    .map(([address, balance]) => ({
      address,
      balanceAtoms: balance.toString(),
    }));
  if (
    holders.reduce(
      (total, holder) => total + BigInt(holder.balanceAtoms),
      0n,
    ) !== confirmedSupplyAtoms
  ) {
    throw new Error("Independent WORK H-1 holder supply diverged.");
  }
  const tokenState = canonicalIndependentWorkTokenState({
    confirmedSupplyAtoms: confirmedSupplyAtoms.toString(),
    holders,
    listings: [...activeListings.values()],
  });
  const independentlyReplayedWorkTokenProjection =
    normalizeWorkAmoV5RawWorkState(tokenState);
  const workTokenProjection =
    normalizeWorkAmoV5RawWorkState(evidence.seedTokenState);
  const pinnedWorkProjection =
    normalizeWorkAmoV5RawWorkState(
      workAmoV5WorkStateWithoutLegacyListingReservations(
        evidence.seedWorkProjection,
      ),
    );
  const independentlyReplayedWorkCommitment =
    workAmoV5CanonicalTokenStateCommitment(
      independentlyReplayedWorkTokenProjection,
    );
  const tokenStateCommitment =
    workAmoV5CanonicalTokenStateCommitment(workTokenProjection);
  const workProjectionCommitment =
    workAmoV5CanonicalTokenStateCommitment(pinnedWorkProjection);
  if (
    independentlyReplayedWorkCommitment.sha256 !==
      tokenStateCommitment.sha256 ||
    independentlyReplayedWorkCommitment.payloadBytes !==
      tokenStateCommitment.payloadBytes ||
    workProjectionCommitment.sha256 !==
      tokenStateCommitment.sha256 ||
    workProjectionCommitment.payloadBytes !==
      tokenStateCommitment.payloadBytes ||
    tokenStateCommitment.sha256 !==
      evidence.commitments.tokenState.sha256 ||
    tokenStateCommitment.payloadBytes !==
      evidence.commitments.tokenState.payloadBytes ||
    workProjectionCommitment.sha256 !==
      evidence.commitments.workProjection.sha256 ||
    workProjectionCommitment.payloadBytes !==
      evidence.commitments.workProjection.payloadBytes ||
    !canonicalWorkAmoV5PayloadsMatch(
      independentlyReplayedWorkTokenProjection,
      workTokenProjection,
    )
  ) {
    throw new Error(
      "Independent WORK event replay diverges from the immutable H-1 seed evidence.",
    );
  }
  const quote = quoteResult.rows[0];
  const quoteHead = quote
    ? {
        blockHash: String(quote.block_hash ?? "").trim().toLowerCase(),
        blockHeight: Number(quote.block_height),
        blockIndex: Number(quote.block_index),
        blockTransactionIndex: Number(quote.block_index),
        previousQuoteTxid: String(quote.previous_quote_txid ?? "")
          .trim()
          .toLowerCase(),
        protocolVout: Number(quote.protocol_vout),
        recordOrdinal: Number(quote.record_ordinal),
        sequence: String(quote.sequence ?? ""),
        txid: String(quote.txid ?? "").trim().toLowerCase(),
        usdPer100mProofsQ8: String(
          quote.usd_per_100m_proofs_q8 ?? "",
        ),
        v1DeclarationTxid: String(quote.declaration_txid ?? "")
          .trim()
          .toLowerCase(),
      }
    : null;
  const state = recomputedWorkAmoSufficientState({
    baseState,
    creditFixedQ8: (
      BigInt(creditEventFrozenValueQ8) -
      BigInt(creditMovementFrozenValueQ8)
    ).toString(),
    creditMovementFrozenValueQ8,
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
    movements,
    network: "livenet",
    networkValueQ8: "0",
    quoteHead,
    genericTokenStateCommitment,
    idStateCommitment,
    throughBlockHash: WORK_AMO_V5_DECLARATION_BLOCK_HASH,
    throughBlockHeight: seedHeight,
    tokenStateCommitment,
  });
  const validation = validateWorkAmoV5SufficientState(state);
  const independentlyRecomputedStateCommitment = validation.valid
    ? workAmoV5CanonicalStateCommitment(validation.state)
    : null;
  if (
    !validation.valid ||
    validation.state.networkValueQ8 !== String(seed?.networkValueQ8 ?? "") ||
    !independentlyRecomputedStateCommitment ||
    independentlyRecomputedStateCommitment.sha256 !==
      evidence.commitments.sufficientState.sha256 ||
    independentlyRecomputedStateCommitment.payloadBytes !==
      evidence.commitments.sufficientState.payloadBytes ||
    !canonicalWorkAmoV5PayloadsMatch(
      validation.state,
      evidence.seedSufficientState,
    )
  ) {
    throw new Error(
      "Independent AMO H-1 sufficient state does not reproduce the immutable seed evidence.",
    );
  }
  const independentEvidence = {
    commitment: independentlyRecomputedStateCommitment,
    evidenceCommitment: evidence.evidenceCommitment,
    genericTokenProjection,
    idStateProjection,
    source: "pinned-h-minus-one-seed-evidence",
    state: validation.state,
    tokenState: workTokenProjection,
    workProjection: pinnedWorkProjection,
  };
  const persistedEvidence = canonicalWorkAmoPersistedActivationSeed(
    activationTransitionResult.rows[0],
    seed,
  );
  if (
    persistedEvidence.commitment.sha256 !==
      independentEvidence.commitment.sha256 ||
    persistedEvidence.commitment.payloadBytes !==
      independentEvidence.commitment.payloadBytes ||
    !canonicalWorkAmoV5PayloadsMatch(
      persistedEvidence.state,
      independentEvidence.state,
    ) ||
    !canonicalWorkAmoV5PayloadsMatch(
      persistedEvidence.genericTokenProjection,
      independentEvidence.genericTokenProjection,
    ) ||
    !canonicalWorkAmoV5PayloadsMatch(
      persistedEvidence.idStateProjection,
      independentEvidence.idStateProjection,
    ) ||
    !canonicalWorkAmoV5PayloadsMatch(
      persistedEvidence.tokenState,
      independentEvidence.tokenState,
    ) ||
    !canonicalWorkAmoV5PayloadsMatch(
      persistedEvidence.workProjection,
      independentEvidence.workProjection,
    )
  ) {
    throw new Error(
      "Persisted AMO activation seed diverges from independent pinned H-1 evidence.",
    );
  }
  return independentEvidence;
}

export function classifyWorkAmoV5LegacyRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (sourceRows.length !== 1) {
    throw new Error(
      `Expected one pinned post-V1 V3 listing event, found ${sourceRows.length}.`,
    );
  }
  const row = sourceRows[0];
  const authorizationVersions = [
    String(row?.sale_version ?? "").trim().toLowerCase(),
    String(row?.listing_version ?? "").trim().toLowerCase(),
  ].filter(Boolean);
  if (
    String(row?.txid ?? "").toLowerCase() !==
      WORK_AMO_V5_POST_V1_INVALID_LISTING_TXID ||
    String(row?.kind ?? "") !== "token-listing" ||
    String(row?.status ?? "") !== "confirmed" ||
    Number(row?.block_height) < WORK_AMO_V1_ACTIVATION_HEIGHT ||
    String(row?.version ?? "").toLowerCase() !== "pwt-sale-v3" ||
    (
      authorizationVersions.length > 0 &&
      (
        new Set(authorizationVersions).size !== 1 ||
        authorizationVersions[0] !== "pwt-sale-v3"
      )
    ) ||
    String(row?.token_id ?? "").toLowerCase() !== WORK_TOKEN_ID ||
    !Number.isSafeInteger(Number(row?.event_id)) ||
    Number(row.event_id) < 1
  ) {
    throw new Error("The pinned post-V1 V3 listing facts do not match.");
  }
  const payload = rowPayload(row);
  const validationErrors = Array.isArray(row.validation_errors)
    ? row.validation_errors
    : [];
  const migrated =
    row.valid === false &&
    exactStringArray(validationErrors, [WORK_AMO_V5_LEGACY_REASON_CODE]) &&
    payload.valid === false &&
    payload.reasonCode === WORK_AMO_V5_LEGACY_REASON_CODE &&
    payload.relic === false &&
    row.listing_status === "dropped";
  if (migrated) {
    return { alreadyMigratedEventIds: [Number(row.event_id)], eventIds: [] };
  }
  if (
    row.valid !== true ||
    validationErrors.length !== 0 ||
    row.listing_status !== "active"
  ) {
    throw new Error(
      "The pinned post-V1 V3 listing is in a partial or unexpected migration state.",
    );
  }
  return { alreadyMigratedEventIds: [], eventIds: [Number(row.event_id)] };
}

function declarationEvidence(row) {
  if (!row) {
    throw new Error("The AMO V5 declaration transaction is not canonical.");
  }
  const memoRows = Array.isArray(row.memo_rows) ? row.memo_rows : [];
  if (memoRows.length !== 1) {
    throw new Error("The AMO V5 declaration memo output is not unique.");
  }
  const payloadHex = String(memoRows[0]?.payload_hex ?? "")
    .trim()
    .toLowerCase();
  if (!/^(?:[0-9a-f]{2})+$/u.test(payloadHex)) {
    throw new Error("The AMO V5 declaration memo bytes are unavailable.");
  }
  const memoBytes = Buffer.from(payloadHex, "hex");
  const memoSha256 = createHash("sha256").update(memoBytes).digest("hex");
  const firstInputScriptpubkey = String(
    row.first_input_scriptpubkey ?? "",
  )
    .trim()
    .toLowerCase();
  const facts = {
    blockHash: String(row.block_hash ?? "").trim().toLowerCase(),
    blockHeight: Number(row.block_height),
    blockIndex: Number(row.block_index),
    blockTransactionIndex: Number(row.block_index),
    canonical: true,
    confirmed: String(row.status ?? "") === "confirmed",
    firstInputScriptpubkey,
    firstInputPrevoutScriptPubKey: firstInputScriptpubkey,
    inputCount: Number(row.input_count),
    memoBytes: memoBytes.length,
    memoSha256,
    payloadBytes: memoBytes.length,
    payloadSha256: memoSha256,
    protocolVout: Number(memoRows[0]?.vout),
    recordOrdinal: Number(memoRows[0]?.output_index),
    registryPaymentCount: Number(row.registry_payment_count),
    registryAddress: WORK_AMO_V5_REGISTRY_ADDRESS,
    registryPaymentSats: Number(row.registry_payment_sats),
    registryPaymentVout: Number(row.registry_payment_vout),
    status: String(row.status ?? ""),
    txid: String(row.txid ?? "").trim().toLowerCase(),
    workProtocolCount: Number(row.work_protocol_count),
    workProtocolVout: Number(row.work_protocol_vout),
  };
  if (
    facts.txid !== WORK_AMO_V5_DECLARATION_TXID ||
    facts.status !== "confirmed" ||
    facts.blockHeight !== WORK_AMO_V5_DECLARATION_HEIGHT ||
    facts.blockHash !== WORK_AMO_V5_DECLARATION_BLOCK_HASH ||
    facts.blockIndex !== WORK_AMO_V5_DECLARATION_BLOCK_INDEX ||
    facts.firstInputScriptpubkey !==
      WORK_AMO_V5_AUTHORITY_SCRIPTPUBKEY ||
    facts.inputCount < 1 ||
    facts.protocolVout !== WORK_AMO_V5_DECLARATION_PROTOCOL_VOUT ||
    facts.recordOrdinal !== WORK_AMO_V5_DECLARATION_RECORD_ORDINAL ||
    facts.workProtocolCount !== 1 ||
    facts.workProtocolVout !== WORK_AMO_V5_DECLARATION_WORK_PROTOCOL_VOUT ||
    facts.registryPaymentCount !== 1 ||
    facts.registryPaymentSats !== WORK_AMO_V5_MIN_REGISTRY_PAYMENT_SATS ||
    facts.registryPaymentVout !==
      WORK_AMO_V5_DECLARATION_REGISTRY_PAYMENT_VOUT ||
    facts.memoBytes !== WORK_AMO_V5_DECLARATION_MEMO_BYTES ||
    facts.memoSha256 !== WORK_AMO_V5_DECLARATION_MEMO_SHA256
  ) {
    throw new Error(
      `AMO V5 declaration evidence mismatch: ${JSON.stringify(facts)}`,
    );
  }
  return facts;
}

export async function backfillCanonicalPositions(client) {
  const transactions = await client.query(
    `
      UPDATE proof_indexer.transactions transaction_row
      SET
        block_index =
          (transaction_row.raw_tx->>'_powBlockIndex')::integer,
        updated_at = now()
      WHERE transaction_row.network = 'livenet'
        AND transaction_row.status = 'confirmed'
        AND transaction_row.block_height < $1
        AND transaction_row.block_index IS NULL
        AND transaction_row.raw_tx->>'_powBlockIndex' ~ '^[0-9]+$'
      RETURNING transaction_row.txid
    `,
    [WORK_AMO_V5_ACTIVATION_HEIGHT],
  );
  const events = await client.query(
    `
      WITH unique_protocol_output AS (
        SELECT
          protocol_output.network,
          protocol_output.txid,
          protocol_output.protocol,
          min(protocol_output.vout)::integer AS protocol_vout
        FROM proof_indexer.op_returns protocol_output
        GROUP BY
          protocol_output.network,
          protocol_output.txid,
          protocol_output.protocol
        HAVING count(*) = 1
      ),
      canonical_bond_companion AS (
        SELECT
          synthetic_event.event_id,
          carrier.protocol_vout,
          recipient.recipient_vout,
          recipient.recipient_amount_sats,
          (
            SELECT count(*)::integer
            FROM proof_indexer.tx_outputs preceding_output
            WHERE preceding_output.network = synthetic_event.network
              AND preceding_output.txid = synthetic_event.txid
              AND preceding_output.vout < carrier.protocol_vout
              AND preceding_output.vout <= recipient.recipient_vout
              AND NULLIF(btrim(preceding_output.address), '') IS NOT NULL
              AND preceding_output.value_sats > 0
          ) AS record_ordinal
        FROM proof_indexer.events synthetic_event
        JOIN LATERAL (
          SELECT
            min(carrier_event.op_return_vout)::integer AS protocol_vout,
            count(*)::integer AS carrier_count
          FROM proof_indexer.events carrier_event
          WHERE carrier_event.network = synthetic_event.network
            AND carrier_event.txid = synthetic_event.txid
            AND carrier_event.status = 'confirmed'
            AND carrier_event.valid = true
            AND carrier_event.protocol = 'pwm1'
            AND carrier_event.kind = CASE
              WHEN synthetic_event.payload->>'validationMode' =
                'canonical-powb-bond-projection'
                THEN 'infinity-bond'
              WHEN synthetic_event.payload->>'validationMode' =
                'canonical-incb-bond-projection'
                THEN 'inception-bond'
              ELSE ''
            END
            AND carrier_event.block_height =
              synthetic_event.block_height
            AND carrier_event.block_index =
              synthetic_event.block_index
            AND carrier_event.block_time =
              synthetic_event.block_time
            AND carrier_event.op_return_vout IS NOT NULL
        ) carrier ON carrier.carrier_count = 1
        JOIN LATERAL (
          SELECT
            min(recipient_output.vout)::integer AS recipient_vout,
            min(recipient_output.value_sats)::bigint
              AS recipient_amount_sats,
            count(*)::integer AS recipient_count
          FROM proof_indexer.tx_outputs recipient_output
          WHERE recipient_output.network = synthetic_event.network
            AND recipient_output.txid = synthetic_event.txid
            AND recipient_output.vout < carrier.protocol_vout
            AND recipient_output.address =
              synthetic_event.payload->>'minterAddress'
            AND recipient_output.value_sats::text = CASE
              WHEN synthetic_event.payload
                ->>'bondRecipientAmountSats' ~ '^[1-9][0-9]*$'
                THEN synthetic_event.payload
                  ->>'bondRecipientAmountSats'
              WHEN synthetic_event.payload->>'validationMode' =
                'canonical-powb-bond-projection'
                AND synthetic_event.payload->>'amount' ~
                  '^[1-9][0-9]*$'
                THEN synthetic_event.payload->>'amount'
              ELSE NULL
            END
            AND (
              NOT COALESCE((
                synthetic_event.payload->>'bondRecipientVout' ~
                  '^(?:0|[1-9][0-9]*)$'
              ), false)
              OR recipient_output.vout::text =
                synthetic_event.payload->>'bondRecipientVout'
            )
        ) recipient ON recipient.recipient_count = 1
        WHERE synthetic_event.network = 'livenet'
          AND synthetic_event.status = 'confirmed'
          AND synthetic_event.valid = true
          AND synthetic_event.protocol = 'pwt1'
          AND synthetic_event.kind = 'token-mint'
          AND synthetic_event.block_height < $1
          AND lower(
            synthetic_event.payload->>'sourceBondTxid'
          ) = synthetic_event.txid
          AND NULLIF(
            synthetic_event.payload->>'minterAddress',
            ''
          ) IS NOT NULL
          AND (
            (
              synthetic_event.payload->>'validationMode' =
                'canonical-powb-bond-projection'
              AND upper(synthetic_event.payload->>'ticker') = 'POWB'
              AND lower(synthetic_event.payload->>'tokenId') = $2
            )
            OR (
              synthetic_event.payload->>'validationMode' =
                'canonical-incb-bond-projection'
              AND upper(synthetic_event.payload->>'ticker') = 'INCB'
              AND lower(synthetic_event.payload->>'tokenId') = $3
            )
          )
      ),
      event_position_repair AS (
        SELECT
          candidate_event.event_id,
          bond_companion.protocol_vout AS bond_protocol_vout,
          bond_companion.recipient_vout AS bond_recipient_vout,
          bond_companion.recipient_amount_sats
            AS bond_recipient_amount_sats,
          bond_companion.record_ordinal AS bond_record_ordinal,
          COALESCE(
            bond_companion.protocol_vout,
            candidate_event.op_return_vout,
            CASE
              WHEN candidate_event.payload->>'protocolVout' ~
                '^(?:0|[1-9][0-9]*)$'
                THEN (
                  SELECT protocol_output.vout
                  FROM proof_indexer.op_returns protocol_output
                  WHERE
                    protocol_output.network = candidate_event.network
                    AND protocol_output.txid = candidate_event.txid
                    AND protocol_output.vout::text =
                      candidate_event.payload->>'protocolVout'
                    AND protocol_output.output_index = 0
                    AND protocol_output.protocol =
                      candidate_event.protocol
                  LIMIT 1
                )
              ELSE NULL
            END,
            unique_protocol_output.protocol_vout
          ) AS protocol_vout,
          CASE
            WHEN bond_companion.record_ordinal IS NOT NULL
              THEN bond_companion.record_ordinal
            WHEN candidate_event.payload->>'recordOrdinal' ~
              '^(?:0|[1-9][0-9]*)$'
              AND (
                candidate_event.payload->>'recordOrdinal'
              )::numeric <= 2147483647
              THEN (
                candidate_event.payload->>'recordOrdinal'
              )::integer
            ELSE candidate_event.record_ordinal
          END AS record_ordinal
        FROM proof_indexer.events candidate_event
        LEFT JOIN canonical_bond_companion bond_companion
          ON bond_companion.event_id = candidate_event.event_id
        LEFT JOIN unique_protocol_output
          ON unique_protocol_output.network = candidate_event.network
         AND unique_protocol_output.txid = candidate_event.txid
         AND unique_protocol_output.protocol = candidate_event.protocol
        WHERE candidate_event.network = 'livenet'
          AND candidate_event.status = 'confirmed'
          AND candidate_event.block_height < $1
      )
      UPDATE proof_indexer.events event_row
      SET
        block_index = transaction_row.block_index,
        op_return_vout = position_repair.protocol_vout,
        record_ordinal = position_repair.record_ordinal,
        payload = CASE
          WHEN position_repair.bond_protocol_vout IS NOT NULL
            THEN event_row.payload || jsonb_build_object(
              'bondRecipientAmountSats',
                position_repair.bond_recipient_amount_sats::text,
              'bondRecipientVout',
                position_repair.bond_recipient_vout,
              'protocolVout',
                position_repair.bond_protocol_vout,
              'recordOrdinal',
                position_repair.bond_record_ordinal
            )
          ELSE event_row.payload
        END,
        updated_at = now()
      FROM
        proof_indexer.transactions transaction_row,
        event_position_repair position_repair
      WHERE transaction_row.network = event_row.network
        AND transaction_row.txid = event_row.txid
        AND transaction_row.status = 'confirmed'
        AND transaction_row.block_height = event_row.block_height
        AND position_repair.event_id = event_row.event_id
        AND event_row.network = 'livenet'
        AND event_row.status = 'confirmed'
        AND event_row.block_height < $1
        AND (
          event_row.block_index IS DISTINCT FROM transaction_row.block_index
          OR event_row.op_return_vout IS DISTINCT FROM
            position_repair.protocol_vout
          OR event_row.record_ordinal IS DISTINCT FROM
            position_repair.record_ordinal
          OR (
            position_repair.bond_protocol_vout IS NOT NULL
            AND (
              event_row.payload->>'bondRecipientAmountSats' IS DISTINCT
                FROM position_repair.bond_recipient_amount_sats::text
              OR event_row.payload->>'bondRecipientVout' IS DISTINCT
                FROM position_repair.bond_recipient_vout::text
              OR event_row.payload->>'protocolVout' IS DISTINCT
                FROM position_repair.bond_protocol_vout::text
              OR event_row.payload->>'recordOrdinal' IS DISTINCT
                FROM position_repair.bond_record_ordinal::text
            )
          )
        )
      RETURNING event_row.event_id
    `,
    [
      WORK_AMO_V5_ACTIVATION_HEIGHT,
      WORK_AMO_V5_POWB_TOKEN_ID,
      WORK_AMO_V5_INCB_TOKEN_ID,
    ],
  );
  return {
    events: Number(events.rowCount ?? 0),
    transactions: Number(transactions.rowCount ?? 0),
  };
}

async function pinnedDeclarationRow(client) {
  const result = await client.query(
    `
      SELECT
        declaration_tx.txid,
        declaration_tx.status,
        declaration_tx.block_hash,
        declaration_tx.block_height,
        declaration_tx.block_index,
        COALESCE(
          declaration_tx.raw_tx #>> '{vin,0,prevout,scriptPubKey,hex}',
          declaration_tx.raw_tx #>> '{vin,0,prevout,scriptpubkey}',
          ''
        ) AS first_input_scriptpubkey,
        (
          SELECT count(*)
          FROM proof_indexer.tx_inputs declaration_input
          WHERE declaration_input.network = declaration_tx.network
            AND declaration_input.txid = declaration_tx.txid
        )::integer AS input_count,
        (
          SELECT min(protocol_output.vout)
          FROM proof_indexer.op_returns protocol_output
          WHERE protocol_output.network = declaration_tx.network
            AND protocol_output.txid = declaration_tx.txid
            AND protocol_output.protocol = 'pwt1'
        ) AS work_protocol_vout,
        (
          SELECT count(*)
          FROM proof_indexer.op_returns protocol_output
          WHERE protocol_output.network = declaration_tx.network
            AND protocol_output.txid = declaration_tx.txid
            AND protocol_output.protocol = 'pwt1'
        )::integer AS work_protocol_count,
        (
          SELECT COALESCE(sum(registry_output.value_sats), 0)
          FROM proof_indexer.tx_outputs registry_output
          WHERE registry_output.network = declaration_tx.network
            AND registry_output.txid = declaration_tx.txid
            AND registry_output.address = $5
            AND registry_output.vout < (
              SELECT min(protocol_output.vout)
              FROM proof_indexer.op_returns protocol_output
              WHERE protocol_output.network = declaration_tx.network
                AND protocol_output.txid = declaration_tx.txid
                AND protocol_output.protocol = 'pwt1'
            )
        ) AS registry_payment_sats,
        (
          SELECT min(registry_output.vout)
          FROM proof_indexer.tx_outputs registry_output
          WHERE registry_output.network = declaration_tx.network
            AND registry_output.txid = declaration_tx.txid
            AND registry_output.address = $5
        ) AS registry_payment_vout,
        (
          SELECT count(*)
          FROM proof_indexer.tx_outputs registry_output
          WHERE registry_output.network = declaration_tx.network
            AND registry_output.txid = declaration_tx.txid
            AND registry_output.address = $5
        )::integer AS registry_payment_count,
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'payload_hex',
                declaration_message.payload_hex,
                'output_index',
                declaration_message.output_index,
                'vout',
                declaration_message.vout
              )
              ORDER BY
                declaration_message.vout,
                declaration_message.output_index
            )
            FROM proof_indexer.op_returns declaration_message
            WHERE declaration_message.network = declaration_tx.network
              AND declaration_message.txid = declaration_tx.txid
              AND left(
                COALESCE(declaration_message.payload_text, ''),
                7
              ) = 'pwm1:m:'
          ),
          '[]'::jsonb
        ) AS memo_rows
      FROM proof_indexer.transactions declaration_tx
      JOIN proof_indexer.blocks declaration_block
        ON declaration_block.network = declaration_tx.network
       AND declaration_block.block_hash = declaration_tx.block_hash
       AND declaration_block.height = declaration_tx.block_height
       AND declaration_block.canonical = true
      WHERE declaration_tx.network = 'livenet'
        AND declaration_tx.txid = $1
        AND declaration_tx.block_height = $2
        AND declaration_tx.block_hash = $3
        AND declaration_tx.status = 'confirmed'
        AND declaration_tx.block_index = $4
      LIMIT 1
    `,
    [
      WORK_AMO_V5_DECLARATION_TXID,
      WORK_AMO_V5_DECLARATION_HEIGHT,
      WORK_AMO_V5_DECLARATION_BLOCK_HASH,
      WORK_AMO_V5_DECLARATION_BLOCK_INDEX,
      WORK_AMO_V5_REGISTRY_ADDRESS,
    ],
  );
  return result.rows[0];
}

async function legacyRows(client) {
  return client.query(
    `
      SELECT
        event_row.event_id,
        event_row.txid,
        event_row.kind,
        event_row.valid,
        event_row.validation_errors,
        event_row.status,
        event_row.block_height,
        event_row.payload,
        lower(COALESCE(
          event_row.payload->'saleAuthorization'->>'version',
          event_row.payload->'listingAuthorization'->>'version',
          ''
        )) AS version,
        lower(COALESCE(
          event_row.payload->'saleAuthorization'->>'version',
          ''
        )) AS sale_version,
        lower(COALESCE(
          event_row.payload->'listingAuthorization'->>'version',
          ''
        )) AS listing_version,
        lower(COALESCE(
          event_row.payload->>'tokenId',
          event_row.payload->'saleAuthorization'->>'tokenId',
          event_row.payload->'listingAuthorization'->>'tokenId',
          ''
        )) AS token_id,
        listing.status AS listing_status
      FROM proof_indexer.events event_row
      JOIN proof_indexer.transactions event_tx
        ON event_tx.network = event_row.network
       AND event_tx.txid = event_row.txid
       AND event_tx.status = 'confirmed'
       AND event_tx.block_height = event_row.block_height
      JOIN proof_indexer.blocks event_block
        ON event_block.network = event_tx.network
       AND event_block.block_hash = event_tx.block_hash
       AND event_block.height = event_tx.block_height
       AND event_block.canonical = true
      JOIN proof_indexer.credit_listings listing
        ON listing.network = event_row.network
       AND listing.listing_id = event_row.txid
      WHERE event_row.network = 'livenet'
        AND event_row.txid = $1
      ORDER BY event_row.event_id
      FOR UPDATE OF event_row, listing
    `,
    [WORK_AMO_V5_POST_V1_INVALID_LISTING_TXID],
  );
}

async function canonicalPositionAudit(client) {
  const result = await client.query(
    `
      SELECT
        (
          SELECT count(*)::integer
          FROM proof_indexer.events parent_event
          LEFT JOIN proof_indexer.transactions parent_tx
            ON parent_tx.network = parent_event.network
           AND parent_tx.txid = parent_event.txid
          WHERE parent_event.network = 'livenet'
            AND parent_event.status = 'confirmed'
            AND parent_event.valid = true
            AND (
              COALESCE(parent_tx.status, '') <> 'confirmed'
              OR parent_event.block_height IS DISTINCT FROM
                parent_tx.block_height
              OR parent_event.block_index IS DISTINCT FROM
                parent_tx.block_index
              OR parent_event.block_index IS NULL
              OR parent_event.op_return_vout IS NULL
              OR parent_event.record_ordinal < 0
              OR parent_event.block_time IS DISTINCT FROM
                parent_tx.block_time
              OR parent_event.event_time IS NULL
              OR parent_event.event_time <
                TIMESTAMPTZ '2009-01-03 18:15:05+00'
            )
        ) AS confirmed_parent_metadata_gaps,
        (
          SELECT count(*)::integer
          FROM proof_indexer.events synthetic_event
          JOIN proof_indexer.transactions synthetic_tx
            ON synthetic_tx.network = synthetic_event.network
           AND synthetic_tx.txid = synthetic_event.txid
          WHERE synthetic_event.network = 'livenet'
            AND synthetic_event.status = 'confirmed'
            AND synthetic_event.valid = true
            AND synthetic_event.protocol = 'pwt1'
            AND synthetic_event.kind = 'token-mint'
            AND (
              lower(synthetic_event.payload->>'tokenId')
                = ANY(ARRAY[$5, $6]::text[])
              OR synthetic_event.payload->>'validationMode' IN (
                'canonical-powb-bond-projection',
                'canonical-incb-bond-projection'
              )
            )
            AND (
              synthetic_tx.status <> 'confirmed'
              OR synthetic_event.block_height IS DISTINCT FROM
                synthetic_tx.block_height
              OR synthetic_event.block_index IS DISTINCT FROM
                synthetic_tx.block_index
              OR synthetic_event.block_time IS DISTINCT FROM
                synthetic_tx.block_time
              OR synthetic_event.op_return_vout IS NULL
              OR synthetic_event.record_ordinal < 1
              OR lower(
                synthetic_event.payload->>'sourceBondTxid'
              ) IS DISTINCT FROM synthetic_event.txid
              OR NOT COALESCE((
                (
                  synthetic_event.payload->>'validationMode' =
                    'canonical-powb-bond-projection'
                  AND upper(
                    synthetic_event.payload->>'ticker'
                  ) = 'POWB'
                  AND lower(
                    synthetic_event.payload->>'tokenId'
                  ) = $5
                )
                OR (
                  synthetic_event.payload->>'validationMode' =
                    'canonical-incb-bond-projection'
                  AND upper(
                    synthetic_event.payload->>'ticker'
                  ) = 'INCB'
                  AND lower(
                    synthetic_event.payload->>'tokenId'
                  ) = $6
                )
              ), false)
              OR synthetic_event.payload->>'protocolVout'
                IS DISTINCT FROM
                  synthetic_event.op_return_vout::text
              OR synthetic_event.payload->>'recordOrdinal'
                IS DISTINCT FROM
                  synthetic_event.record_ordinal::text
              OR NOT COALESCE((
                synthetic_event.payload->>'bondRecipientVout' ~
                  '^(?:0|[1-9][0-9]*)$'
              ), false)
              OR NOT COALESCE((
                synthetic_event.payload->>'bondRecipientAmountSats' ~
                  '^[1-9][0-9]*$'
              ), false)
              OR (
                SELECT count(*)
                FROM proof_indexer.events carrier_event
                WHERE carrier_event.network = synthetic_event.network
                  AND carrier_event.txid = synthetic_event.txid
                  AND carrier_event.status = 'confirmed'
                  AND carrier_event.valid = true
                  AND carrier_event.protocol = 'pwm1'
                  AND carrier_event.kind = CASE
                    WHEN synthetic_event.payload->>'validationMode' =
                      'canonical-powb-bond-projection'
                      THEN 'infinity-bond'
                    WHEN synthetic_event.payload->>'validationMode' =
                      'canonical-incb-bond-projection'
                      THEN 'inception-bond'
                    ELSE ''
                  END
                  AND carrier_event.block_height =
                    synthetic_event.block_height
                  AND carrier_event.block_index =
                    synthetic_event.block_index
                  AND carrier_event.block_time =
                    synthetic_event.block_time
                  AND carrier_event.op_return_vout =
                    synthetic_event.op_return_vout
              ) <> 1
              OR (
                SELECT count(*)
                FROM proof_indexer.tx_outputs recipient_output
                WHERE recipient_output.network =
                    synthetic_event.network
                  AND recipient_output.txid = synthetic_event.txid
                  AND recipient_output.vout::text =
                    synthetic_event.payload->>'bondRecipientVout'
                  AND recipient_output.vout <
                    synthetic_event.op_return_vout
                  AND recipient_output.address =
                    synthetic_event.payload->>'minterAddress'
                  AND recipient_output.value_sats::text =
                    synthetic_event.payload
                      ->>'bondRecipientAmountSats'
              ) <> 1
              OR synthetic_event.record_ordinal IS DISTINCT FROM (
                SELECT count(*)::integer
                FROM
                  proof_indexer.tx_outputs preceding_output,
                  proof_indexer.tx_outputs recipient_output
                WHERE recipient_output.network =
                    synthetic_event.network
                  AND recipient_output.txid = synthetic_event.txid
                  AND recipient_output.vout::text =
                    synthetic_event.payload->>'bondRecipientVout'
                  AND recipient_output.address =
                    synthetic_event.payload->>'minterAddress'
                  AND recipient_output.value_sats::text =
                    synthetic_event.payload
                      ->>'bondRecipientAmountSats'
                  AND preceding_output.network =
                    recipient_output.network
                  AND preceding_output.txid = recipient_output.txid
                  AND preceding_output.vout <
                    synthetic_event.op_return_vout
                  AND preceding_output.vout <= recipient_output.vout
                  AND NULLIF(
                    btrim(preceding_output.address),
                    ''
                  ) IS NOT NULL
                  AND preceding_output.value_sats > 0
              )
            )
        ) AS synthetic_bond_position_gaps,
        count(*) FILTER (
          WHERE event_row.block_height IS DISTINCT FROM
              transaction_row.block_height
            OR event_row.block_index IS NULL
            OR event_row.op_return_vout IS NULL
            OR event_row.record_ordinal < 0
            OR transaction_row.block_index IS NULL
            OR transaction_row.block_index IS DISTINCT FROM
              event_row.block_index
        )::integer AS missing_positions,
        (
          SELECT count(*)::integer
          FROM (
            SELECT 1
            FROM proof_indexer.events duplicate_event
            JOIN proof_indexer.transactions duplicate_tx
              ON duplicate_tx.network = duplicate_event.network
             AND duplicate_tx.txid = duplicate_event.txid
             AND duplicate_tx.status = 'confirmed'
            JOIN proof_indexer.blocks duplicate_block
              ON duplicate_block.network = duplicate_tx.network
             AND duplicate_block.block_hash = duplicate_tx.block_hash
             AND duplicate_block.height = duplicate_tx.block_height
             AND duplicate_block.canonical = true
            WHERE duplicate_event.network = 'livenet'
              AND duplicate_event.status = 'confirmed'
              AND duplicate_event.block_height >= $3
              AND duplicate_event.block_index IS NOT NULL
              AND duplicate_event.op_return_vout IS NOT NULL
            GROUP BY
              duplicate_event.block_height,
              duplicate_event.block_index,
              duplicate_event.op_return_vout,
              duplicate_event.record_ordinal
            HAVING count(*) > 1
          ) duplicate_positions
        ) AS duplicate_positions,
        (
          (
            SELECT count(*)::integer
            FROM proof_indexer.credit_listings conflict_listing
            WHERE conflict_listing.network = 'livenet'
              AND lower(conflict_listing.token_id) = $2
              AND NULLIF(lower(
                conflict_listing.payload
                  ->'saleAuthorization'->>'version'
              ), '') IS NOT NULL
              AND NULLIF(lower(
                conflict_listing.payload
                  ->'listingAuthorization'->>'version'
              ), '') IS NOT NULL
              AND lower(
                conflict_listing.payload
                  ->'saleAuthorization'->>'version'
              ) <> lower(
                conflict_listing.payload
                  ->'listingAuthorization'->>'version'
              )
          )
          +
          (
            SELECT count(*)::integer
            FROM proof_indexer.events conflict_event
            WHERE conflict_event.network = 'livenet'
              AND conflict_event.status = 'confirmed'
              AND conflict_event.block_height >= $3
              AND lower(COALESCE(
                conflict_event.payload
                  ->'saleAuthorization'->>'tokenId',
                conflict_event.payload
                  ->'listingAuthorization'->>'tokenId',
                conflict_event.payload->>'tokenId',
                ''
              )) = $2
              AND NULLIF(lower(
                conflict_event.payload
                  ->'saleAuthorization'->>'version'
              ), '') IS NOT NULL
              AND NULLIF(lower(
                conflict_event.payload
                  ->'listingAuthorization'->>'version'
              ), '') IS NOT NULL
              AND lower(
                conflict_event.payload
                  ->'saleAuthorization'->>'version'
              ) <> lower(
                conflict_event.payload
                  ->'listingAuthorization'->>'version'
              )
          )
        ) AS authorization_conflicts,
        (
          SELECT count(*)::integer
          FROM proof_indexer.credit_listings listing
          JOIN proof_indexer.transactions listing_tx
            ON listing_tx.network = listing.network
           AND listing_tx.txid = listing.listing_id
          WHERE listing.network = 'livenet'
            AND lower(listing.token_id) = $2
            AND listing.status IN ('active', 'sealing')
            AND 'pwt-sale-v3' = ANY(ARRAY[
              lower(COALESCE(
                listing.payload->'saleAuthorization'->>'version',
                ''
              )),
              lower(COALESCE(
                listing.payload->'listingAuthorization'->>'version',
                ''
              ))
            ]::text[])
            AND listing_tx.block_height >= $3
        ) AS post_v1_v3_active,
        (
          SELECT count(*)::integer
          FROM proof_indexer.credit_listings listing
          JOIN proof_indexer.transactions listing_tx
            ON listing_tx.network = listing.network
           AND listing_tx.txid = listing.listing_id
          WHERE listing.network = 'livenet'
            AND lower(listing.token_id) = $2
            AND listing.status IN ('active', 'sealing')
            AND 'pwt-sale-v4' = ANY(ARRAY[
              lower(COALESCE(
                listing.payload->'saleAuthorization'->>'version',
                ''
              )),
              lower(COALESCE(
                listing.payload->'listingAuthorization'->>'version',
                ''
              ))
            ]::text[])
            AND listing_tx.block_height >= $1
        ) AS post_activation_v4_active,
        (
          SELECT count(*)::integer
          FROM proof_indexer.events post_v5_v4_event
          WHERE post_v5_v4_event.network = 'livenet'
            AND post_v5_v4_event.status = 'confirmed'
            AND post_v5_v4_event.block_height >= $1
            AND 'pwt-sale-v4' = ANY(ARRAY[
              lower(COALESCE(
                post_v5_v4_event.payload
                  ->'saleAuthorization'->>'version',
                ''
              )),
              lower(COALESCE(
                post_v5_v4_event.payload
                  ->'listingAuthorization'->>'version',
                ''
              ))
            ]::text[])
        ) AS post_activation_v4_actions,
        (
          SELECT count(*)::integer
          FROM proof_indexer.events historical_v4_event
          JOIN proof_indexer.transactions historical_v4_tx
            ON historical_v4_tx.network = historical_v4_event.network
           AND historical_v4_tx.txid = historical_v4_event.txid
           AND historical_v4_tx.status = 'confirmed'
          JOIN proof_indexer.blocks historical_v4_block
            ON historical_v4_block.network = historical_v4_tx.network
           AND historical_v4_block.block_hash =
             historical_v4_tx.block_hash
           AND historical_v4_block.height =
             historical_v4_tx.block_height
           AND historical_v4_block.canonical = true
          WHERE historical_v4_event.network = 'livenet'
            AND historical_v4_event.status = 'confirmed'
            AND historical_v4_event.block_height >= $3
            AND historical_v4_event.block_height < $1
            AND lower(COALESCE(
              historical_v4_event.payload
                ->'saleAuthorization'->>'tokenId',
              historical_v4_event.payload->>'tokenId',
              ''
            )) = $2
            AND 'pwt-sale-v4' = ANY(ARRAY[
              lower(COALESCE(
                historical_v4_event.payload
                  ->'saleAuthorization'->>'version',
                ''
              )),
              lower(COALESCE(
                historical_v4_event.payload
                  ->'listingAuthorization'->>'version',
                ''
              ))
            ]::text[])
            AND (
              historical_v4_event.kind IN (
                'token-listing',
                'token-listing-sealed',
                'token-sale',
                'token-listing-closed'
              )
              OR (
                historical_v4_event.kind = 'token-event-invalid'
                AND lower(COALESCE(
                  historical_v4_event.payload->>'attemptedKind',
                  ''
                )) IN (
                  'list',
                  'seal',
                  'buy',
                  'delist',
                  'token-listing',
                  'token-listing-sealed',
                  'token-sale',
                  'token-listing-closed'
                )
              )
            )
        ) AS pre_activation_v4_actions,
        (
          SELECT count(*)::integer
          FROM proof_indexer.events listing_event
          JOIN proof_indexer.transactions listing_tx
            ON listing_tx.network = listing_event.network
           AND listing_tx.txid = listing_event.txid
           AND listing_tx.status = 'confirmed'
           AND listing_tx.block_height = listing_event.block_height
           AND listing_tx.block_index = listing_event.block_index
          LEFT JOIN proof_indexer.work_amo_listing_terms terms
            ON terms.network = listing_event.network
           AND terms.listing_id = listing_event.txid
           AND terms.listing_txid = listing_event.txid
           AND terms.listing_block_height = listing_event.block_height
           AND terms.listing_block_index = listing_event.block_index
           AND terms.listing_protocol_vout =
             listing_event.op_return_vout
           AND terms.listing_record_ordinal =
             listing_event.record_ordinal
           AND lower(terms.listing_block_hash) =
             lower(listing_tx.block_hash)
          WHERE listing_event.network = 'livenet'
            AND listing_event.status = 'confirmed'
            AND listing_event.valid = true
            AND listing_event.kind = 'token-listing'
            AND $4 = ANY(ARRAY[
              lower(COALESCE(
                listing_event.payload
                  ->'saleAuthorization'->>'version',
                ''
              )),
              lower(COALESCE(
                listing_event.payload
                  ->'listingAuthorization'->>'version',
                ''
              ))
            ]::text[])
            AND listing_event.block_height >= $1
            AND terms.listing_id IS NULL
        ) AS missing_frozen_terms
      FROM proof_indexer.events event_row
      JOIN proof_indexer.transactions transaction_row
        ON transaction_row.network = event_row.network
       AND transaction_row.txid = event_row.txid
      JOIN proof_indexer.blocks event_block
        ON event_block.network = transaction_row.network
       AND event_block.block_hash = transaction_row.block_hash
       AND event_block.height = transaction_row.block_height
       AND event_block.canonical = true
      WHERE event_row.network = 'livenet'
        AND event_row.status = 'confirmed'
        AND transaction_row.status = 'confirmed'
        AND event_row.protocol = ANY(
          ARRAY['pwm1','pwa1','pwid1','pwt1']::text[]
        )
        AND transaction_row.block_height >= $3
    `,
    [
      WORK_AMO_V5_ACTIVATION_HEIGHT,
      WORK_TOKEN_ID,
      WORK_AMO_V1_ACTIVATION_HEIGHT,
      WORK_AMO_V5_AUTH_VERSION,
      WORK_AMO_V5_POWB_TOKEN_ID,
      WORK_AMO_V5_INCB_TOKEN_ID,
    ],
  );
  const row = result.rows[0] ?? {};
  return {
    authorizationConflicts: Number(row.authorization_conflicts ?? 0),
    confirmedParentMetadataGaps: Number(
      row.confirmed_parent_metadata_gaps ?? 0,
    ),
    duplicatePositions: Number(row.duplicate_positions ?? 0),
    missingFrozenTerms: Number(row.missing_frozen_terms ?? 0),
    missingPositions: Number(row.missing_positions ?? 0),
    preActivationV4Actions: Number(row.pre_activation_v4_actions ?? 0),
    postActivationV4Active: Number(row.post_activation_v4_active ?? 0),
    postActivationV4Actions: Number(
      row.post_activation_v4_actions ?? 0,
    ),
    postV1V3Active: Number(row.post_v1_v3_active ?? 0),
    syntheticBondPositionGaps: Number(
      row.synthetic_bond_position_gaps ?? 0,
    ),
  };
}

async function exactWorkNetworkValueSnapshotEvidence(
  client,
  blockHeight,
  blockHash,
) {
  const result = await client.query(
    `
      SELECT
        snapshot.snapshot_id,
        lower(snapshot.source_hashes->>'canonicalSummary') AS summary_hash,
        snapshot.payload->'totals'->>'workNetworkValueQ8' AS network_value_q8
      FROM proof_indexer.ledger_snapshots snapshot
      WHERE snapshot.network = 'livenet'
        AND snapshot.indexed_through_block = $1
        AND lower(COALESCE(
          snapshot.source_hashes->>'blockScan',
          ''
        )) = $2
        AND lower(COALESCE(
          snapshot.payload->>'indexedThroughBlockHash',
          ''
        )) = $2
        AND lower(COALESCE(
          snapshot.payload->'summaryRefresh'->>'indexedThroughBlockHash',
          ''
        )) = $2
        AND lower(COALESCE(
          snapshot.payload->'summaryPayloads'->'workFloor'
            ->>'indexedThroughBlockHash',
          ''
        )) = $2
        AND snapshot.source_hashes->>'canonicalSummary' ~
          '^[0-9a-fA-F]{64}$'
        AND COALESCE(
          snapshot.consistency->>'ok',
          snapshot.payload->>'ok',
          'false'
        ) = 'true'
        AND COALESCE(
          snapshot.consistency->>'status',
          snapshot.payload->>'status',
          ''
        ) = 'green'
        AND snapshot.payload->'summaryRefresh'->>'mode' =
          'canonical-summary-refresh'
        AND snapshot.payload->'totals'
          ->>'workNetworkValueAccountingModel' =
          'canonical-exact-work-network-q8-v1'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->>'workNetworkValueAccountingModel' =
          'canonical-exact-work-network-q8-v1'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'workNetworkValueAccountingModel' =
          'canonical-exact-work-network-q8-v1'
        AND snapshot.payload->'totals'->>'workNetworkValueQ8' ~
          '^[1-9][0-9]*$'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->>'networkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->>'liveNetworkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'networkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->'summaryPayloads'->'workFloor'
          ->'actualValue'->>'liveNetworkValueQ8' =
          snapshot.payload->'totals'->>'workNetworkValueQ8'
        AND snapshot.payload->>'snapshotId' = snapshot.snapshot_id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(snapshot.consistency->'checks', '[]'::jsonb)
          ) check_item
          WHERE check_item->>'name' =
              'token-components-cover-confirmed-activity'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(snapshot.consistency->'checks', '[]'::jsonb)
          ) check_item
          WHERE check_item->>'name' =
              'canonical-activity-count-matches-public-log'
            AND COALESCE(check_item->>'ok', 'false') = 'true'
        )
      ORDER BY snapshot.generated_at DESC, snapshot.snapshot_id
    `,
    [blockHeight, blockHash],
  );
  if (result.rows.length === 0) {
    return null;
  }
  const values = new Set(
    result.rows.map((row) => String(row.network_value_q8 ?? "").trim()),
  );
  const summaryHashes = new Set(
    result.rows.map((row) =>
      String(row.summary_hash ?? "").trim().toLowerCase()
    ),
  );
  if (
    values.size !== 1 ||
    summaryHashes.size !== 1 ||
    !/^[1-9][0-9]*$/u.test([...values][0] ?? "") ||
    !/^[0-9a-f]{64}$/u.test([...summaryHashes][0] ?? "")
  ) {
    return null;
  }
  return {
    blockHash,
    blockHeight,
    networkValueQ8: [...values][0],
    snapshotCount: result.rows.length,
    snapshotIds: result.rows.map((row) => String(row.snapshot_id ?? "")),
    summaryHash: [...summaryHashes][0],
  };
}

async function canonicalWorkAmoEventSetEvidence(
  client,
  {
    applyV5TransitionSemantics = false,
    collectEvents = false,
    fromHeight,
    throughHeight,
  },
) {
  const hash = createHash("sha256");
  const canonicalEvents = [];
  const consumedCandidateParts = new Map();
  const feesByTxid = new Map();
  const rawTransactionsByTxid = new Map();
  const syntheticParentKeys = [];
  let eventCount = 0n;
  let invalidEventCount = 0n;
  let pageCount = 0;
  let cursor = {
    blockHeight: fromHeight - 1,
    blockIndex: -1,
    protocolVout: -1,
    recordOrdinal: -1,
  };
  for (;;) {
    const page = await client.query(
      `
        SELECT
          event_row.event_id::text AS event_id,
          event_row.event_key,
          event_row.txid,
          event_row.protocol,
          event_row.kind,
          event_row.status,
          event_row.valid,
          to_json(event_row.validation_errors)::text AS validation_errors,
          event_row.block_height,
          event_row.block_index,
          event_row.op_return_vout AS protocol_vout,
          event_row.record_ordinal,
          event_row.raw_payload,
          event_row.amount_sats::text AS amount_sats,
          lower(event_tx.block_hash) AS block_hash,
          COALESCE(event_tx.fee_sats, 0)::text AS fee_sats,
          event_tx.raw_tx,
          event_row.payload::text AS payload_text
        FROM proof_indexer.events event_row
        JOIN proof_indexer.transactions event_tx
          ON event_tx.network = event_row.network
         AND event_tx.txid = event_row.txid
         AND event_tx.status = 'confirmed'
         AND event_tx.block_height = event_row.block_height
         AND event_tx.block_index = event_row.block_index
        JOIN proof_indexer.blocks event_block
          ON event_block.network = event_tx.network
         AND event_block.block_hash = event_tx.block_hash
         AND event_block.height = event_tx.block_height
         AND event_block.canonical = true
        WHERE event_row.network = 'livenet'
          AND event_row.status = 'confirmed'
          AND event_row.protocol = ANY(
            ARRAY['pwm1','pwa1','pwid1','pwt1']::text[]
          )
          AND event_row.block_height BETWEEN $1 AND $2
          AND (
            event_row.block_height,
            event_row.block_index,
            event_row.op_return_vout,
            event_row.record_ordinal
          ) > ($3::integer, $4::integer, $5::integer, $6::integer)
        ORDER BY
          event_row.block_height,
          event_row.block_index,
          event_row.op_return_vout,
          event_row.record_ordinal
        LIMIT $7
      `,
      [
        fromHeight,
        throughHeight,
        cursor.blockHeight,
        cursor.blockIndex,
        cursor.protocolVout,
        cursor.recordOrdinal,
        WORK_AMO_V5_REPLAY_PAGE_SIZE,
      ],
    );
    pageCount += 1;
    for (const row of page.rows) {
      const position = {
        blockHeight: Number(row.block_height),
        blockIndex: Number(row.block_index),
        protocolVout: Number(row.protocol_vout),
        recordOrdinal: Number(row.record_ordinal),
      };
      if (
        !Number.isSafeInteger(position.blockHeight) ||
        position.blockHeight < fromHeight ||
        position.blockHeight > throughHeight ||
        !Number.isSafeInteger(position.blockIndex) ||
        position.blockIndex < 0 ||
        !Number.isSafeInteger(position.protocolVout) ||
        position.protocolVout < 0 ||
        !Number.isSafeInteger(position.recordOrdinal) ||
        position.recordOrdinal < 0 ||
        (
          position.blockHeight < cursor.blockHeight ||
          (
            position.blockHeight === cursor.blockHeight &&
          (
            position.blockIndex < cursor.blockIndex ||
            (
              position.blockIndex === cursor.blockIndex &&
              (
                position.protocolVout < cursor.protocolVout ||
                (
                  position.protocolVout === cursor.protocolVout &&
                  position.recordOrdinal <= cursor.recordOrdinal
                )
              )
            )
          )
          )
        ) ||
        !/^[0-9a-f]{64}$/u.test(
          String(row.block_hash ?? "").trim().toLowerCase(),
        )
      ) {
        throw new Error(
          `Canonical event ${row.event_id} has an invalid full position.`,
        );
      }
      const feeSats = String(row.fee_sats ?? "0").trim();
      if (!/^(?:0|[1-9][0-9]*)$/u.test(feeSats)) {
        throw new Error(`Canonical event ${row.event_id} has an invalid fee.`);
      }
      const txid = String(row.txid ?? "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/u.test(txid)) {
        throw new Error(`Canonical event ${row.event_id} has an invalid txid.`);
      }
      const priorFee = feesByTxid.get(txid);
      if (priorFee !== undefined && priorFee !== feeSats) {
        throw new Error(
          `Canonical transaction ${txid} has inconsistent miner fees.`,
        );
      }
      feesByTxid.set(txid, feeSats);
      const priorRawTransaction = rawTransactionsByTxid.get(txid);
      if (
        priorRawTransaction &&
        JSON.stringify(priorRawTransaction) !== JSON.stringify(row.raw_tx)
      ) {
        throw new Error(
          `Canonical transaction ${txid} has inconsistent raw projections.`,
        );
      }
      rawTransactionsByTxid.set(txid, row.raw_tx);
      const rawRecordPart = rawProtocolRecordPartAtVout(
        row.raw_tx,
        position.protocolVout,
      );
      if (!rawRecordPart) {
        throw new Error(
          `Canonical event ${row.event_id} has no raw Core protocol record.`,
        );
      }
      const rawRecordText = rawRecordPart.text;
      let payload = {};
      let validationErrors = [];
      try {
        payload = JSON.parse(String(row.payload_text ?? "{}"));
      } catch {
        throw new Error(
          `Canonical event ${row.event_id} has invalid payload JSON.`,
        );
      }
      if (String(row.protocol ?? "") === "pwa1") {
        const validQuoteRecordCount =
          rawValidWorkAmoUsdQuoteRecordParts(row.raw_tx).length;
        if (
          Number(payload.recordCount) !== validQuoteRecordCount ||
          (
            row.valid === true &&
            (
              validQuoteRecordCount !== 1 ||
              !parseWorkAmoUsdQuoteRecord(rawRecordText)
            )
          )
        ) {
          throw new Error(
            `Canonical AMO USD quote ${row.event_id} diverges from its raw valid-record count.`,
          );
        }
      }
      const storedRawPayload = String(row.raw_payload ?? "");
      let canonicalRawPayload = {
        model: "canonical-raw-protocol-record-v1",
        rawRecordParts: [rawRecordPart],
      };
      if (
        position.recordOrdinal === 0 &&
        String(row.protocol ?? "") === "pwm1"
      ) {
        const rawRecordParts = rawProtocolRecordParts(row.raw_tx, "pwm1:");
        if (
          rawRecordParts.length === 0 ||
          rawRecordParts[0].protocolVout !== position.protocolVout ||
          storedRawPayload !==
            rawRecordParts.map((part) => part.text).join("\n")
        ) {
          throw new Error(
            `Canonical PWM aggregate event ${row.event_id} does not preserve its ordered raw Core parts.`,
          );
        }
        canonicalRawPayload = {
          model: "canonical-pwm-aggregate-record-v1",
          rawRecordParts,
        };
        for (const part of rawRecordParts) {
          const key = `${txid}:${part.protocolVout}`;
          if (consumedCandidateParts.has(key)) {
            throw new Error(
              `Canonical raw protocol candidate ${key} was consumed twice.`,
            );
          }
          consumedCandidateParts.set(key, part);
        }
      } else if (
        position.recordOrdinal === 0 &&
        storedRawPayload !== rawRecordText
      ) {
        throw new Error(
          `Canonical event ${row.event_id} does not preserve its exact raw Core record.`,
        );
      } else if (position.recordOrdinal === 0) {
        const key = `${txid}:${position.protocolVout}`;
        if (consumedCandidateParts.has(key)) {
          throw new Error(
            `Canonical raw protocol candidate ${key} was consumed twice.`,
          );
        }
        consumedCandidateParts.set(key, rawRecordPart);
      }
      if (
        position.recordOrdinal > 0 &&
        payload?.workAmoV5ReplayRawWitness?.model ===
          "canonical-work-amo-v5-derived-child-v1"
      ) {
        const witness = payload.workAmoV5ReplayRawWitness;
        const descriptor = witness?.descriptor;
        const projectionPosition = descriptor?.projectionPosition;
        if (
          payload?._workAmoV5ReplayBound !== true ||
          payload?.workAmoV5RawCandidate !== false ||
          descriptor?.rawCandidate !== false ||
          descriptor?.economicDelta !== false ||
          descriptor?.claimsEconomicOutputs !== false ||
          descriptor?.chargesTransactionFee !== false ||
          !String(descriptor?.derivedId ?? "").trim() ||
          exactNonNegativeSafeInteger(
            projectionPosition?.blockHeight,
            { positive: true },
          ) !==
            position.blockHeight ||
          exactNonNegativeSafeInteger(
            projectionPosition?.blockTransactionIndex ??
              projectionPosition?.blockIndex,
          ) !== position.blockIndex ||
          exactNonNegativeSafeInteger(projectionPosition?.protocolVout) !==
            position.protocolVout ||
          exactNonNegativeSafeInteger(projectionPosition?.recordOrdinal) !==
            position.recordOrdinal ||
          String(witness?.parentProtocol ?? "") === "" ||
          String(witness?.parentPosition?.blockHash ?? "")
            .trim()
            .toLowerCase() !== position.blockHash
        ) {
          throw new Error(
            `Canonical derived event ${row.event_id} has an invalid replay witness.`,
          );
        }
        canonicalRawPayload = structuredClone(witness);
      } else if (position.recordOrdinal > 0) {
        const recipient = rawPaymentOutputsBeforeProtocol(
          row.raw_tx,
          position.protocolVout,
        )[position.recordOrdinal - 1];
        const rawRecordParts = rawProtocolRecordParts(row.raw_tx, "pwm1:");
        if (
          storedRawPayload !== "" ||
          rawRecordParts.length === 0 ||
          rawRecordParts[0].protocolVout !== position.protocolVout ||
          String(row.protocol ?? "") !== "pwt1" ||
          String(row.kind ?? "") !== "token-mint" ||
          !recipient ||
          String(payload.sourceBondTxid ?? "").trim().toLowerCase() !== txid ||
          String(payload.bondRecipientAddress ?? "") !== recipient.address ||
          String(payload.bondRecipientAmountSats ?? "") !==
            recipient.amountSats.toString() ||
          Number(payload.bondRecipientVout) !== recipient.vout
        ) {
          throw new Error(
            `Canonical synthetic event ${row.event_id} is not derivable from its raw PWM record.`,
          );
        }
        canonicalRawPayload = {
          derivation: {
            recipientAddress: recipient.address,
            recipientAmountSats: recipient.amountSats.toString(),
            recipientIndex: position.recordOrdinal - 1,
            recipientVout: recipient.vout,
            recordOrdinal: position.recordOrdinal,
          },
          model: "canonical-pwm-synthetic-bond-projection-v1",
          rawRecordParts,
        };
        syntheticParentKeys.push(`${txid}:${position.protocolVout}`);
      }
      const fields = [
        row.event_id,
        row.event_key,
        txid,
        row.protocol,
        row.kind,
        row.status,
        row.valid === true ? "1" : "0",
        row.validation_errors,
        row.block_height,
        row.block_index,
        row.protocol_vout,
        row.record_ordinal,
        row.block_hash,
        feeSats,
        row.amount_sats,
        JSON.stringify(canonicalRawPayload),
      ];
      hash.update(fields.map((field) => String(field ?? "")).join("\x1f"));
      hash.update("\n");
      try {
        validationErrors = JSON.parse(
          String(row.validation_errors ?? "[]"),
        );
      } catch {
        throw new Error(
          `Canonical event ${row.event_id} has invalid validation errors.`,
        );
      }
      canonicalEvents.push({
        amountSats: String(row.amount_sats ?? "0"),
        feeSats,
        kind: String(row.kind ?? ""),
        // The commitment binds immutable Core bytes, never mutable/enriched
        // projection JSON. Payload JSON remains relevant only to outcome
        // classification through reasonCode below.
        payload: canonicalRawPayload,
        position: {
          blockHash: String(row.block_hash ?? "").trim().toLowerCase(),
          blockHeight: position.blockHeight,
          blockTransactionIndex: position.blockIndex,
          protocolVout: position.protocolVout,
          recordOrdinal: position.recordOrdinal,
        },
        protocol: String(row.protocol ?? ""),
        projectionPayload: payload,
        rawTransaction: row.raw_tx,
        reasonCode: row.valid === true ? "" : "invalid",
        txid,
        valid: row.valid === true,
      });
      eventCount += 1n;
      if (row.valid !== true) {
        invalidEventCount += 1n;
      }
    }
    if (page.rows.length === 0) {
      break;
    }
    const last = page.rows.at(-1);
    cursor = {
      blockHeight: Number(last.block_height),
      blockIndex: Number(last.block_index),
      protocolVout: Number(last.protocol_vout),
      recordOrdinal: Number(last.record_ordinal),
    };
    if (page.rows.length < WORK_AMO_V5_REPLAY_PAGE_SIZE) {
      break;
    }
  }
  for (const parentKey of syntheticParentKeys) {
    if (!consumedCandidateParts.has(parentKey)) {
      throw new Error(
        `Canonical synthetic projection ${parentKey} has no PWM aggregate parent.`,
      );
    }
  }
  const candidateCoverage = applyV5TransitionSemantics
    ? await canonicalRawProtocolCandidateCoverage(client, {
        consumedCandidateParts,
      expectedFeesByTxid: feesByTxid,
      expectedRawTransactionsByTxid: rawTransactionsByTxid,
        fromHeight,
        throughHeight,
      })
    : {
        pageCount: 0,
        rawProtocolCandidateCount: null,
        rawProtocolTransactionCount: null,
      };
  if (
    applyV5TransitionSemantics &&
    candidateCoverage.rawProtocolTransactionCount !== feesByTxid.size
  ) {
    throw new Error(
      "Canonical AMO protocol transaction coverage is incomplete.",
    );
  }
  const countResult = await client.query(
    `
      SELECT count(*)::bigint AS count
      FROM proof_indexer.events event_row
      JOIN proof_indexer.transactions event_tx
        ON event_tx.network = event_row.network
       AND event_tx.txid = event_row.txid
       AND event_tx.status = 'confirmed'
       AND event_tx.block_height = event_row.block_height
      JOIN proof_indexer.blocks event_block
        ON event_block.network = event_tx.network
       AND event_block.block_hash = event_tx.block_hash
       AND event_block.height = event_tx.block_height
       AND event_block.canonical = true
      WHERE event_row.network = 'livenet'
        AND event_row.status = 'confirmed'
        AND event_row.protocol = ANY(
          ARRAY['pwm1','pwa1','pwid1','pwt1']::text[]
        )
        AND event_row.block_height BETWEEN $1 AND $2
    `,
    [fromHeight, throughHeight],
  );
  const countedEvents = String(countResult.rows[0]?.count ?? "");
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(countedEvents) ||
    BigInt(countedEvents) !== BigInt(eventCount)
  ) {
    throw new Error(
      "Canonical AMO replay pagination did not cover the complete event set.",
    );
  }
  const transactionFeeTotalSats = [...feesByTxid.values()].reduce(
    (total, value) => total + BigInt(value),
    0n,
  );
  if (
    applyV5TransitionSemantics &&
    BigInt(candidateCoverage.coreTransactionFeeTotalSats ?? "-1") !==
      transactionFeeTotalSats
  ) {
    throw new Error(
      "Canonical AMO transaction fees diverge from direct Core evidence.",
    );
  }
  const eventSetCommitment = workAmoV5EventSetCommitment(canonicalEvents);
  return {
    ...(collectEvents
      ? {
          canonicalEvents,
          canonicalFullBlocks:
            candidateCoverage.canonicalFullBlocks ?? [],
          canonicalRawProtocolRecords:
            candidateCoverage.canonicalRawProtocolRecords ?? [],
        }
      : {}),
    eventCount: eventCount.toString(),
    eventRowSetSha256: hash.digest("hex"),
    eventSetModel: eventSetCommitment.model,
    eventSetPayloadBytes: eventSetCommitment.payloadBytes,
    eventSetSha256: eventSetCommitment.sha256,
    fromHeight,
    ...(applyV5TransitionSemantics
      ? {
          feeTransitionModel: WORK_AMO_V5_FEE_TRANSITION_MODEL,
          invalidEventModel: WORK_AMO_V5_INVALID_EVENT_MODEL,
        }
      : {}),
    invalidEventCount: invalidEventCount.toString(),
    pageCount,
    rawProtocolCandidateCount:
      candidateCoverage.rawProtocolCandidateCount,
    rawProtocolCandidateBlockCount:
      candidateCoverage.blockCount ?? 0,
    coreTransactionFeeSetSha256:
      candidateCoverage.coreTransactionFeeSetSha256 ?? null,
    coreTransactionFeeTotalSats:
      candidateCoverage.coreTransactionFeeTotalSats ?? null,
    transactionCount: feesByTxid.size,
    transactionFeeTotalSats: transactionFeeTotalSats.toString(),
    throughHeight,
  };
}

export async function canonicalWorkAmoV1HistoryEventEvidence(
  client,
  throughHeight,
) {
  return canonicalWorkAmoEventSetEvidence(client, {
    applyV5TransitionSemantics: false,
    fromHeight: WORK_AMO_V1_ACTIVATION_HEIGHT,
    throughHeight,
  });
}

export async function canonicalWorkAmoReplayEventEvidence(
  client,
  throughHeight,
) {
  return canonicalWorkAmoEventSetEvidence(client, {
    applyV5TransitionSemantics: true,
    fromHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    throughHeight,
  });
}

function exactUnsignedIntegerText(value, { positive = false } = {}) {
  const text = String(value ?? "").trim();
  if (!(positive ? /^[1-9][0-9]*$/u : /^(?:0|[1-9][0-9]*)$/u).test(text)) {
    return "";
  }
  return text;
}

function exactCommitment(value, expectedModel) {
  const model = String(value?.model ?? "").trim();
  const payloadBytes = Number(value?.payloadBytes);
  const sha256 = String(value?.sha256 ?? "").trim().toLowerCase();
  return model === expectedModel &&
    Number.isSafeInteger(payloadBytes) &&
    payloadBytes > 0 &&
    /^[0-9a-f]{64}$/u.test(sha256)
    ? { model, payloadBytes, sha256 }
    : null;
}

function transitionPayload(row) {
  const payload =
    row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};
  return payload;
}

function canonicalWorkAmoV5ReplayPositionKey(value) {
  const position = value?.position ?? value;
  const fields = [
    exactNonNegativeSafeInteger(position?.blockHeight, { positive: true }),
    exactNonNegativeSafeInteger(
      position?.blockTransactionIndex ?? position?.blockIndex,
    ),
    exactNonNegativeSafeInteger(position?.protocolVout),
    exactNonNegativeSafeInteger(position?.recordOrdinal),
  ];
  if (
    fields.some((field) => field === null)
  ) {
    throw new Error(
      "Canonical AMO V5 replay position is incomplete.",
    );
  }
  return fields.join(":");
}

function canonicalWorkAmoV5ReplayRecordKey(value) {
  const txid = String(value?.txid ?? "").trim().toLowerCase();
  const protocolVout = exactNonNegativeSafeInteger(
    value?.position?.protocolVout,
  );
  const recordOrdinal = exactNonNegativeSafeInteger(
    value?.position?.recordOrdinal,
  );
  if (
    !/^[0-9a-f]{64}$/u.test(txid) ||
    protocolVout === null ||
    recordOrdinal === null
  ) {
    throw new Error(
      "Canonical AMO V5 replay record key is incomplete.",
    );
  }
  return [txid, protocolVout, recordOrdinal].join(":");
}

function compareWorkAmoV5ReplayPositions(left, right) {
  for (const field of [
    "blockHeight",
    "blockTransactionIndex",
    "protocolVout",
    "recordOrdinal",
  ]) {
    const options = { positive: field === "blockHeight" };
    const leftValue = exactNonNegativeSafeInteger(left?.[field], options);
    const rightValue = exactNonNegativeSafeInteger(right?.[field], options);
    if (leftValue === null || rightValue === null) {
      throw new Error(
        "Canonical AMO V5 replay position is incomplete.",
      );
    }
    const difference = leftValue - rightValue;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function canonicalWorkAmoV5PayloadsMatch(left, right) {
  const leftCommitment =
    workAmoV5CanonicalPayloadCommitment(left);
  const rightCommitment =
    workAmoV5CanonicalPayloadCommitment(right);
  return (
    leftCommitment.sha256 === rightCommitment.sha256 &&
    leftCommitment.payloadBytes === rightCommitment.payloadBytes
  );
}

function canonicalWorkAmoV5RawReplayArtifacts(replay) {
  const bip141Witness = normalizedWorkAmoV5Bip141Witness(
    replay?.bip141Witness,
    Number(replay?.blockTransactionCount),
  );
  if (!bip141Witness) {
    throw new Error(
      "Canonical Core replay BIP141 witness summary is invalid.",
    );
  }
  const eventsByKey = new Map(
    replay.events.map((event) => [
      canonicalWorkAmoV5ReplayRecordKey(event),
      event,
    ]),
  );
  const rawReplayRecords = replay.records.map((record) => {
    const event = eventsByKey.get(
      canonicalWorkAmoV5ReplayRecordKey(record),
    );
    if (!event) {
      throw new Error(
        "Canonical Core replay is missing an ordered raw outcome.",
      );
    }
    return {
      derived: event.derived,
      outcome: {
        kind: workAmoV5ConsensusEventKind(
          record.protocol,
          event.valid,
        ),
        reasonCode: event.valid ? "" : event.reasonCode,
        semanticKind: event.semanticKind,
        valid: event.valid,
      },
      output: event.output,
      position: record.position,
      protocol: record.protocol,
      rawCandidate: true,
      rawWitness: record.payload,
      stateDelta: event.stateDelta,
      transitionChainCommitmentAfter:
        event.transitionChainCommitmentAfter,
      transactionMinerFeeSats:
        record.transactionMinerFeeSats,
      transactionProtocolRecordCount:
        record.transactionProtocolRecordCount,
      txid: record.txid,
    };
  });
  const derivedReplayRecords = rawReplayRecords.flatMap((parent) =>
    (Array.isArray(parent.derived) ? parent.derived : []).map(
      (derived) => {
        const protocol = ["pwid1", "pwt1"].includes(
          derived?.protocol,
        )
          ? derived.protocol
          : "pwt1";
        return {
          chargesTransactionFee: false,
          derived: true,
          outcome: {
            kind: workAmoV5ConsensusEventKind(protocol, true),
            reasonCode: "",
            semanticKind: derived.kind,
            valid: true,
          },
          output: {
            projection: {
              ...derived,
              derived: true,
              kind: derived.kind,
              position: derived.projectionPosition,
              protocol,
              reasonCode: "",
              txid: parent.txid,
              valid: true,
            },
          },
          parentPosition: parent.position,
          position: derived.projectionPosition,
          protocol,
          rawCandidate: false,
          rawWitness: {
            descriptor: derived,
            model: "canonical-work-amo-v5-derived-child-v1",
            parentPosition: parent.position,
            parentProtocol: parent.protocol,
          },
          parentTransitionChainCommitmentAfter:
            derived.parentTransitionChainCommitmentAfter,
          stateDelta: {
            baseContributions: [],
            creditFixedQ8: "0",
            creditFixedSats: "0",
            economicOutputs: [],
          },
          transactionMinerFeeSats:
            parent.transactionMinerFeeSats,
          transactionProtocolRecordCount:
            parent.transactionProtocolRecordCount,
          txid: parent.txid,
        };
      },
    ),
  );
  const replayRecords = [
    ...rawReplayRecords,
    ...derivedReplayRecords,
  ].sort((left, right) =>
    compareWorkAmoV5ReplayPositions(left.position, right.position)
  );
  const eventSetCommitment = workAmoV5EventSetCommitment(
    replayRecords.map((record) => ({
      kind: record.outcome.kind,
      outcome: record.outcome,
      payload: record.rawWitness,
      position: record.position,
      protocol: record.protocol,
      reasonCode: record.outcome.reasonCode,
      stateDelta: record.stateDelta,
      transactionMinerFeeSats:
        record.transactionMinerFeeSats,
      txid: record.txid,
      valid: record.outcome.valid,
    })),
  );
  const feeByTxid = new Map(
    replay.feeTransitions.map((trace) => [trace.txid, trace]),
  );
  const traces = [];
  for (let index = 0; index < rawReplayRecords.length; index += 1) {
    const record = rawReplayRecords[index];
    const outcome = replay.outcomes.get(
      canonicalWorkAmoV5ReplayRecordKey(record),
    );
    traces.push({
      bondContributionQ8: outcome?.bondContributionQ8 ?? "0",
      kind: "protocol-record",
      networkValueAfterQ8: outcome?.networkValueAfterQ8,
      networkValueBeforeQ8: outcome?.networkValueBeforeQ8,
      output: record.output,
      position: record.position,
      rawWitness: record.rawWitness,
      reasonCode: record.outcome.reasonCode,
      stateDelta: record.stateDelta,
      transitionChainCommitmentAfter:
        record.transitionChainCommitmentAfter,
      txid: record.txid,
      valid: record.outcome.valid,
    });
    if (rawReplayRecords[index + 1]?.txid !== record.txid) {
      const fee = feeByTxid.get(record.txid);
      if (!fee) {
        throw new Error(
          "Canonical Core replay is missing its transaction fee transition.",
        );
      }
      traces.push({
        ...fee,
        kind: "transaction-fee",
        reasonCode: fee.valid
          ? ""
          : "work-amo-v5-invalid-only-transaction",
      });
    }
  }
  return {
    bip141Witness,
    blockDescriptorCommitment: replay.blockDescriptorCommitment,
    blockDescriptorModel: replay.blockDescriptorModel,
    blockTransactionCount: replay.blockTransactionCount,
    eventSetCommitment,
    rawReplayRecords,
    replayDescriptorCommitment:
      workAmoV5CanonicalPayloadCommitment(replayRecords),
    replayRecords,
    traces,
    transitionChainCommitment: replay.transitionChainCommitment,
    transitionChainModel: replay.transitionChainModel,
  };
}

export async function canonicalWorkAmoV5TransitionEvidence(
  client,
  {
    closing,
    seedEvidence,
    seed,
    throughBlockHash,
    throughHeight,
  },
) {
  const eventEvidence = await canonicalWorkAmoEventSetEvidence(client, {
    applyV5TransitionSemantics: true,
    collectEvents: true,
    fromHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    throughHeight,
  });
  let rawReplayRecords = canonicalWorkAmoRawReplayRecords(
    eventEvidence.canonicalRawProtocolRecords,
  );
  const rawReplayRecordCount = rawReplayRecords.length;
  const canonicalFullBlocksByKey = new Map(
    eventEvidence.canonicalFullBlocks.map((block) => [
      `${block.blockHeight}:${block.blockHash}`,
      block,
    ]),
  );
  const rawRecordsByBlock = new Map();
  for (const record of rawReplayRecords) {
    const key = [
      record.position.blockHeight,
      record.position.blockHash,
    ].join(":");
    const records = rawRecordsByBlock.get(key) ?? [];
    records.push(record);
    rawRecordsByBlock.set(key, records);
  }
  const databaseEventsByPosition = new Map();
  for (const event of eventEvidence.canonicalEvents) {
    const key = canonicalWorkAmoV5ReplayPositionKey(event);
    if (databaseEventsByPosition.has(key)) {
      return {
        complete: false,
        reason: "v5-relational-event-position-duplicated",
      };
    }
    databaseEventsByPosition.set(key, {
      feeSats: event.feeSats,
      payload: event.payload,
      projectionPayload: event.projectionPayload,
      protocol: event.protocol,
      txid: event.txid,
      valid: event.valid,
    });
  }
  rawReplayRecords = null;
  eventEvidence.canonicalEvents = undefined;
  eventEvidence.canonicalFullBlocks = undefined;
  eventEvidence.canonicalRawProtocolRecords = undefined;
  const result = await client.query(
    `
      SELECT transition.*
      FROM proof_indexer.work_amo_block_transitions transition
      JOIN proof_indexer.blocks transition_block
        ON transition_block.network = transition.network
       AND transition_block.block_hash = transition.block_hash
       AND transition_block.height = transition.block_height
       AND transition_block.previous_block_hash =
         transition.previous_block_hash
       AND transition_block.canonical = true
      WHERE transition.network = 'livenet'
        AND transition.block_height BETWEEN $1 AND $2
        AND transition.model = $3
      ORDER BY transition.block_height
    `,
    [
      WORK_AMO_V5_ACTIVATION_HEIGHT,
      throughHeight,
      WORK_AMO_V5_BLOCK_SEQUENCER_MODEL,
    ],
  );
  const expectedTransitionBlockCount =
    throughHeight - WORK_AMO_V5_ACTIVATION_HEIGHT + 1;
  if (
    expectedTransitionBlockCount < 1 ||
    result.rows.length !== expectedTransitionBlockCount
  ) {
    return {
      complete: false,
      reason: "v5-block-transition-set-incomplete",
    };
  }
  const seedValidation = validateWorkAmoV5SufficientState(
    seedEvidence?.state,
  );
  let openingGenericState;
  let openingIdState;
  let openingWorkState;
  try {
    openingGenericState = normalizeWorkAmoV5RawGenericState(
      seedEvidence?.genericTokenProjection,
    );
    openingIdState = normalizeWorkAmoV5RawIdState(
      seedEvidence?.idStateProjection,
    );
    openingWorkState = normalizeWorkAmoV5RawWorkState(
      seedEvidence?.tokenState,
    );
  } catch {
    return {
      complete: false,
      reason: "v5-independent-seed-projections-unavailable",
    };
  }
  if (
    !seedValidation.valid ||
    String(seed?.networkValueQ8 ?? "") !==
      seedValidation.state.networkValueQ8 ||
    workAmoV5RawGenericStateCommitment(openingGenericState).sha256 !==
      seedValidation.state.genericTokenStateCommitment.sha256 ||
    workAmoV5RawIdStateCommitment(openingIdState).sha256 !==
      seedValidation.state.idStateCommitment.sha256 ||
    workAmoV5CanonicalTokenStateCommitment(openingWorkState).sha256 !==
      seedValidation.state.tokenStateCommitment.sha256
  ) {
    return {
      complete: false,
      reason: "v5-independent-seed-state-divergence",
    };
  }
  let openingEconomicState = seedValidation.state;
  let firstOpeningState = null;
  let firstOpeningCommitment = null;
  let priorBlockHeight = WORK_AMO_V5_ACTIVATION_HEIGHT - 1;
  let transitionEventCount = 0n;
  let transitionProtocolRecordCount = 0n;
  let transitionRawProtocolCandidateCount = 0n;
  let transitionTransactionCount = 0n;
  let finalBlockDescriptorCommitment = null;
  let finalBlockTransactionCount = 0;
  let finalBip141Witness = null;
  let finalTransitionChainCommitment = null;
  const transitionSetHash = createHash("sha256");
  for (const row of result.rows) {
    const blockHeight = Number(row.block_height);
    const blockHash = String(row.block_hash ?? "").trim().toLowerCase();
    const previousBlockHash = String(row.previous_block_hash ?? "")
      .trim()
      .toLowerCase();
    const payload = transitionPayload(row);
    if (
      !Number.isSafeInteger(blockHeight) ||
      blockHeight !== priorBlockHeight + 1 ||
      !/^[0-9a-f]{64}$/u.test(blockHash) ||
      previousBlockHash !== openingEconomicState.throughBlockHash ||
      openingEconomicState.throughBlockHeight !== blockHeight - 1
    ) {
      return {
        blockHash,
        blockHeight,
        complete: false,
        reason: "v5-block-transition-chain-broken",
      };
    }
    const blockRecords =
      rawRecordsByBlock.get(`${blockHeight}:${blockHash}`) ?? [];
    rawRecordsByBlock.delete(`${blockHeight}:${blockHash}`);
    const fullBlock = canonicalFullBlocksByKey.get(
      `${blockHeight}:${blockHash}`,
    );
    canonicalFullBlocksByKey.delete(`${blockHeight}:${blockHash}`);
    if (!fullBlock) {
      return {
        blockHash,
        blockHeight,
        complete: false,
        reason: "v5-authoritative-full-block-witness-missing",
      };
    }
    let replay;
    let expected;
    try {
      const canonicalBlockHash = String(
        await canonicalBitcoinRpc("getblockhash", [blockHeight]),
      )
        .trim()
        .toLowerCase();
      if (canonicalBlockHash !== blockHash) {
        throw new Error(
          `Canonical block ${blockHeight} changed before replay.`,
        );
      }
      let block;
      try {
        block = await canonicalBitcoinRpc("getblock", [blockHash, 3]);
      } catch {
        block = await canonicalBitcoinRpc("getblock", [blockHash, 2]);
      }
      if (
        String(block?.hash ?? "").trim().toLowerCase() !== blockHash ||
        Number(block?.height) !== blockHeight ||
        !Array.isArray(block?.tx) ||
        Number(block?.nTx) !== block.tx.length ||
        block.tx.length === 0
      ) {
        throw new Error(
          `Core returned an incomplete replay block ${blockHeight}.`,
        );
      }
      const previousTransactions = new Map();
      for (const transaction of block.tx) {
        if (rawProtocolRecordParts(transaction).length > 0) {
          await canonicalCoreTransactionFeeSats(
            transaction,
            previousTransactions,
          );
        }
      }
      replay = replayWorkAmoV5RawBlock({
        blockHeaderHex: fullBlock.blockHeaderHex,
        blockTransactions: block.tx,
        expectedBlockHash: blockHash,
        expectedBlockHeight: blockHeight,
        expectedPreviousBlockHash: previousBlockHash,
        openingEconomicState,
        openingGenericState,
        openingIdState,
        openingWorkState,
        records: blockRecords,
      });
      expected = canonicalWorkAmoV5RawReplayArtifacts(replay);
    } catch (error) {
      return {
        blockHash,
        blockHeight,
        complete: false,
        detail: error?.message ?? String(error),
        reason: "v5-authoritative-raw-block-replay-failed",
      };
    }
    const openingCommitment =
      workAmoV5CanonicalStateCommitment(openingEconomicState);
    const closingCommitment =
      workAmoV5CanonicalStateCommitment(replay.economicState);
    const storedOpeningCommitment = exactCommitment(
      payload.openingStateCommitment,
      WORK_AMO_V5_STATE_COMMITMENT_MODEL,
    );
    const storedClosingCommitment = exactCommitment(
      payload.closingStateCommitment,
      WORK_AMO_V5_STATE_COMMITMENT_MODEL,
    );
    const storedEventSetCommitment = exactCommitment(
      payload.eventSetCommitment,
      WORK_AMO_V5_EVENT_SET_COMMITMENT_MODEL,
    );
    const storedTransitionChainCommitment = exactCommitment(
      payload.transitionChainCommitment,
      WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
    );
    const replayTransitionChainCommitment = exactCommitment(
      replay.transitionChainCommitment,
      WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
    );
    const storedBlockDescriptorCommitment = exactCommitment(
      payload.blockDescriptorCommitment,
      WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
    );
    const replayBlockDescriptorCommitment = exactCommitment(
      replay.blockDescriptorCommitment,
      WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
    );
    const storedBip141Witness =
      normalizedWorkAmoV5Bip141Witness(
        payload.bip141Witness,
        Number(payload.blockTransactionCount),
      );
    const replayBip141Witness =
      normalizedWorkAmoV5Bip141Witness(
        replay.bip141Witness,
        replay.blockTransactionCount,
      );
    let closingWorkCommitment;
    let closingGenericCommitment;
    let closingIdCommitment;
    try {
      closingWorkCommitment =
        workAmoV6CanonicalTokenStateCommitment(
          payload.closingTokenState,
        );
      closingGenericCommitment =
        workAmoV5RawGenericStateCommitment(
          payload.closingGenericTokenState,
        );
      closingIdCommitment =
        workAmoV5RawIdStateCommitment(
          payload.closingIdState,
        );
    } catch {
      return {
        blockHash,
        blockHeight,
        complete: false,
        reason: "v5-closing-projection-invalid",
      };
    }
    if (blockHeight === WORK_AMO_V5_ACTIVATION_HEIGHT) {
      let seedProjectionsValid = false;
      try {
        const seedStateValidation = validateWorkAmoV5SufficientState(
          payload.seedSufficientState,
        );
        const seedCommitment = exactCommitment(
          payload.seedSufficientStateCommitment,
          WORK_AMO_V5_STATE_COMMITMENT_MODEL,
        );
        const seedWorkState =
          normalizeWorkAmoV5RawWorkState(
            payload.seedTokenState,
          );
        const seedWorkProjection =
          normalizeWorkAmoV5RawWorkState(
            payload.seedWorkProjection,
          );
        seedProjectionsValid =
          seedStateValidation.valid === true &&
          Boolean(seedCommitment) &&
          seedCommitment.sha256 === openingCommitment.sha256 &&
          canonicalWorkAmoV5PayloadsMatch(
            seedStateValidation.state,
            openingEconomicState,
          ) &&
          canonicalWorkAmoV5PayloadsMatch(
            normalizeWorkAmoV5RawGenericState(
              payload.seedGenericTokenState,
            ),
            openingGenericState,
          ) &&
          canonicalWorkAmoV5PayloadsMatch(
            normalizeWorkAmoV5RawIdState(
              payload.seedIdState,
            ),
            openingIdState,
          ) &&
          canonicalWorkAmoV5PayloadsMatch(
            seedWorkState,
            openingWorkState,
          ) &&
          workAmoV5CanonicalTokenStateCommitment(
            seedWorkProjection,
          ).sha256 ===
            workAmoV5CanonicalTokenStateCommitment(
              seedWorkState,
            ).sha256;
      } catch {
        seedProjectionsValid = false;
      }
      if (!seedProjectionsValid) {
        return {
          blockHash,
          blockHeight,
          complete: false,
          reason: "v5-activation-seed-projection-divergence",
        };
      }
    }
    if (
      payload.model !== WORK_AMO_V5_BLOCK_SEQUENCER_MODEL ||
      payload.blockDescriptorModel !==
        WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL ||
      replay.blockDescriptorModel !==
        WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL ||
      !storedBlockDescriptorCommitment ||
      !replayBlockDescriptorCommitment ||
      storedBlockDescriptorCommitment.sha256 !==
        replayBlockDescriptorCommitment.sha256 ||
      storedBlockDescriptorCommitment.payloadBytes !==
        replayBlockDescriptorCommitment.payloadBytes ||
      Number(payload.blockTransactionCount) !==
        replay.blockTransactionCount ||
      !storedBip141Witness ||
      !replayBip141Witness ||
      !workAmoV5Bip141WitnessesEqual(
        storedBip141Witness,
        replayBip141Witness,
      ) ||
      !workAmoV5Bip141WitnessesEqual(
        expected.bip141Witness,
        replayBip141Witness,
      ) ||
      payload.transitionChainModel !==
        WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL ||
      replay.transitionChainModel !==
        WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL ||
      payload.network !== "livenet" ||
      Number(payload.blockHeight) !== blockHeight ||
      String(payload.blockHash ?? "").trim().toLowerCase() !== blockHash ||
      String(payload.previousBlockHash ?? "").trim().toLowerCase() !==
        previousBlockHash ||
      payload.complete !== true ||
      payload.blockAtomic !== true ||
      payload.feeOnce !== true ||
      payload.invalidZero !== true ||
      row.complete !== true ||
      row.block_atomic !== true ||
      row.fee_once !== true ||
      row.invalid_zero !== true ||
      row.model !== WORK_AMO_V5_BLOCK_SEQUENCER_MODEL ||
      row.state_commitment_model !== WORK_AMO_V5_STATE_COMMITMENT_MODEL ||
      !storedOpeningCommitment ||
      !storedClosingCommitment ||
      !storedEventSetCommitment ||
      !storedTransitionChainCommitment ||
      !replayTransitionChainCommitment ||
      storedTransitionChainCommitment.sha256 !==
        replayTransitionChainCommitment.sha256 ||
      storedTransitionChainCommitment.payloadBytes !==
        replayTransitionChainCommitment.payloadBytes ||
      storedOpeningCommitment.sha256 !== openingCommitment.sha256 ||
      storedClosingCommitment.sha256 !== closingCommitment.sha256 ||
      String(row.opening_state_sha256 ?? "").trim().toLowerCase() !==
        openingCommitment.sha256 ||
      String(row.closing_state_sha256 ?? "").trim().toLowerCase() !==
        closingCommitment.sha256 ||
      Number(row.opening_state_payload_bytes) !==
        openingCommitment.payloadBytes ||
      Number(row.closing_state_payload_bytes) !==
        closingCommitment.payloadBytes ||
      String(row.opening_network_value_q8 ?? "") !==
        openingEconomicState.networkValueQ8 ||
      String(row.closing_network_value_q8 ?? "") !==
        replay.economicState.networkValueQ8 ||
      String(payload.openingNetworkValueQ8 ?? "") !==
        openingEconomicState.networkValueQ8 ||
      String(payload.closingNetworkValueQ8 ?? "") !==
        replay.economicState.networkValueQ8 ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.openingSufficientState,
        openingEconomicState,
      ) ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.closingSufficientState,
        replay.economicState,
      ) ||
      closingWorkCommitment.sha256 !==
        replay.tokenStateCommitment.sha256 ||
      closingGenericCommitment.sha256 !==
        replay.genericTokenStateCommitment.sha256 ||
      closingIdCommitment.sha256 !==
        replay.idStateCommitment.sha256 ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.closingTokenState,
        replay.workState,
      ) ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.closingGenericTokenState,
        replay.genericState,
      ) ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.closingIdState,
        replay.idState,
      ) ||
      Number(row.protocol_record_count) !== replay.protocolRecordCount ||
      Number(payload.protocolRecordCount) !== replay.protocolRecordCount ||
      Number(row.raw_protocol_candidate_count) !==
        replay.rawProtocolCandidateCount ||
      Number(payload.rawProtocolCandidateCount) !==
        replay.rawProtocolCandidateCount ||
      Number(row.transaction_count) !== replay.transactionCount ||
      Number(payload.transactionCount) !== replay.transactionCount ||
      Number(row.event_count) !== expected.replayRecords.length ||
      Number(payload.eventCount) !== expected.replayRecords.length ||
      storedEventSetCommitment.sha256 !==
        expected.eventSetCommitment.sha256 ||
      storedEventSetCommitment.payloadBytes !==
        expected.eventSetCommitment.payloadBytes ||
      String(row.event_set_sha256 ?? "").trim().toLowerCase() !==
        expected.eventSetCommitment.sha256 ||
      Number(row.event_set_payload_bytes) !==
        expected.eventSetCommitment.payloadBytes ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.replayRecords,
        expected.replayRecords,
      ) ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.replayDescriptorCommitment,
        expected.replayDescriptorCommitment,
      ) ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.traces,
        expected.traces,
      ) ||
      !canonicalWorkAmoV5PayloadsMatch(
        payload.transitionChainCommitment,
        expected.transitionChainCommitment,
      )
    ) {
      return {
        blockHash,
        blockHeight,
        complete: false,
        reason: "v5-authoritative-block-transition-divergence",
      };
    }
    for (const replayRecord of expected.replayRecords) {
      const key = canonicalWorkAmoV5ReplayPositionKey(replayRecord);
      const databaseEvent = databaseEventsByPosition.get(key);
      const projection = databaseEvent?.projectionPayload ?? {};
      const reasonCode = replayRecord.outcome.valid
        ? ""
        : String(
            projection?.reasonCode ??
              projection?.workAmoV5ReplayOutcome?.reasonCode ??
              "",
          ).trim();
      if (
        !databaseEvent ||
        databaseEvent.txid !== replayRecord.txid ||
        databaseEvent.protocol !== replayRecord.protocol ||
        databaseEvent.valid !== replayRecord.outcome.valid ||
        databaseEvent.feeSats !==
          replayRecord.transactionMinerFeeSats ||
        reasonCode !== replayRecord.outcome.reasonCode ||
        projection?._workAmoV5ReplayBound !== true ||
        projection?.workAmoV5RawCandidate !==
          replayRecord.rawCandidate ||
        projection?.workAmoV5ReplayOutcome?.valid !==
          replayRecord.outcome.valid ||
        String(projection?.workAmoV5ReplayOutcome?.reasonCode ?? "") !==
          replayRecord.outcome.reasonCode ||
        !canonicalWorkAmoV5PayloadsMatch(
          databaseEvent.payload,
          replayRecord.rawWitness,
        ) ||
        !canonicalWorkAmoV5PayloadsMatch(
          projection?.workAmoV5ReplayRawWitness,
          replayRecord.rawWitness,
        ) ||
        !canonicalWorkAmoV5PayloadsMatch(
          projection?.workAmoV5ReplayOutput,
          replayRecord.output,
        ) ||
        (
          replayRecord.rawCandidate === false &&
          (
            projection?.derived !== true ||
            String(projection?.derivedId ?? "") !==
              String(
                replayRecord.rawWitness?.descriptor?.derivedId ?? "",
              )
          )
        )
      ) {
        return {
          blockHash,
          blockHeight,
          complete: false,
          reason: "v5-relational-replay-binding-divergence",
          position: key,
        };
      }
      databaseEventsByPosition.delete(key);
    }
    if (blockHeight === WORK_AMO_V5_ACTIVATION_HEIGHT) {
      firstOpeningState = openingEconomicState;
      firstOpeningCommitment = openingCommitment;
      if (
        Number(seed?.blockHeight) !== blockHeight - 1 ||
        String(seed?.blockHash ?? "").trim().toLowerCase() !==
          previousBlockHash ||
        String(seed?.networkValueQ8 ?? "") !==
          openingEconomicState.networkValueQ8
      ) {
        return {
          blockHash,
          blockHeight,
          complete: false,
          reason: "v5-transition-seed-value-mismatch",
        };
      }
    }
    openingEconomicState = replay.economicState;
    openingGenericState = replay.genericState;
    openingIdState = replay.idState;
    openingWorkState = replay.workState;
    priorBlockHeight = blockHeight;
    transitionEventCount += BigInt(expected.replayRecords.length);
    transitionProtocolRecordCount += BigInt(
      replay.protocolRecordCount,
    );
    transitionRawProtocolCandidateCount += BigInt(
      replay.rawProtocolCandidateCount,
    );
    transitionTransactionCount += BigInt(replay.transactionCount);
    finalTransitionChainCommitment =
      expected.transitionChainCommitment;
    finalBlockDescriptorCommitment =
      expected.blockDescriptorCommitment;
    finalBlockTransactionCount =
      expected.blockTransactionCount;
    finalBip141Witness = expected.bip141Witness;
    transitionSetHash.update(
      [
        blockHeight,
        blockHash,
        openingCommitment.sha256,
        closingCommitment.sha256,
        expected.eventSetCommitment.sha256,
        replay.blockDescriptorCommitment.sha256,
        workAmoV5CanonicalPayloadCommitment(
          expected.bip141Witness,
        ).sha256,
        expected.transitionChainCommitment.sha256,
      ].join("\x1f"),
    );
    transitionSetHash.update("\n");
    row.payload = null;
  }
  if (
    rawRecordsByBlock.size !== 0 ||
    canonicalFullBlocksByKey.size !== 0 ||
    databaseEventsByPosition.size !== 0 ||
    transitionEventCount !== BigInt(eventEvidence.eventCount) ||
    transitionRawProtocolCandidateCount !==
      BigInt(eventEvidence.rawProtocolCandidateCount) ||
    transitionProtocolRecordCount !== BigInt(rawReplayRecordCount) ||
    transitionTransactionCount !==
      BigInt(eventEvidence.transactionCount) ||
    openingEconomicState.networkValueQ8 !==
      String(closing?.networkValueQ8 ?? "") ||
    openingEconomicState.throughBlockHeight !== throughHeight ||
    openingEconomicState.throughBlockHash !== throughBlockHash
  ) {
    return {
      complete: false,
      reason: "v5-end-tip-raw-replay-parity-failed",
    };
  }
  let finalCanonicalBlockHash;
  try {
    finalCanonicalBlockHash = String(
      await canonicalBitcoinRpc("getblockhash", [throughHeight]),
    )
      .trim()
      .toLowerCase();
  } catch (error) {
    return {
      complete: false,
      detail: error?.message ?? String(error),
      reason: "v5-end-tip-core-witness-unavailable",
    };
  }
  if (finalCanonicalBlockHash !== throughBlockHash) {
    return {
      complete: false,
      finalCanonicalBlockHash,
      reason: "v5-end-tip-core-canonicality-changed",
      throughBlockHash,
      throughHeight,
    };
  }
  const finalTipValidation =
    validateWorkAmoV5SufficientState(openingEconomicState);
  if (!finalTipValidation.valid) {
    return {
      complete: false,
      reason: "v5-end-tip-sufficient-state-parity-failed",
    };
  }
  return {
    blockAtomic: true,
    complete: true,
    endTipParity: true,
    eventEvidence: {
      ...eventEvidence,
      canonicalEvents: undefined,
      canonicalFullBlocks: undefined,
      canonicalRawProtocolRecords: undefined,
    },
    feeTransitionModel: WORK_AMO_V5_FEE_TRANSITION_MODEL,
    finalBlockDescriptorCommitment,
    finalBlockTransactionCount,
    finalBip141Witness,
    finalCanonicalBlockHash,
    finalTipCommitment:
      workAmoV5CanonicalStateCommitment(
        finalTipValidation.state,
      ),
    finalTipState: finalTipValidation.state,
    finalTransitionChainCommitment,
    firstOpeningCommitment,
    firstOpeningState,
    invalidEventModel: WORK_AMO_V5_INVALID_EVENT_MODEL,
    model: WORK_AMO_V5_REPLAY_MODEL,
    blockDescriptorModel:
      WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
    transitionBlockCount: result.rows.length,
    transitionEventCount: transitionEventCount.toString(),
    transitionProtocolRecordCount:
      transitionProtocolRecordCount.toString(),
    transitionRawProtocolCandidateCount:
      transitionRawProtocolCandidateCount.toString(),
    transitionSetSha256: transitionSetHash.digest("hex"),
    transitionChainModel: WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
    transitionTransactionCount:
      transitionTransactionCount.toString(),
  };
}

export async function canonicalWorkAmoRelationalTokenStateEvidence(
  client,
  expectedTokenStateCommitment,
) {
  const balanceResult = await client.query(
    `
      SELECT
        address,
        confirmed_balance::text AS balance_atoms
      FROM proof_indexer.credit_balances
      WHERE network = 'livenet'
        AND lower(token_id) = $1
        AND confirmed_balance > 0
      ORDER BY address
    `,
    [WORK_TOKEN_ID],
  );
  const listingResult = await client.query(
    `
      SELECT
        listing.listing_id,
        listing.seller_address,
        listing.amount::text AS amount_atoms,
        listing.price_sats::text AS price_sats,
        listing.payload->'listingAuthorization'
          AS listing_authorization,
        listing.payload->'saleAuthorization'
          AS sale_authorization,
        COALESCE(
          listing.payload->'listingAuthorization'->>'version',
          listing.payload->'saleAuthorization'->>'version',
          ''
        ) AS authorization_version,
        CASE
          WHEN COALESCE(
            listing.payload->'listingAuthorization'->>'version',
            listing.payload->'saleAuthorization'->>'version',
            ''
          ) = $2
            THEN v6_terms.frozen_terms
          ELSE COALESCE(
            v5_terms.frozen_terms,
            listing.payload->'listingFrozenTerms'
          )
        END AS frozen_terms,
        CASE
          WHEN COALESCE(
            listing.payload->'listingAuthorization'->>'version',
            listing.payload->'saleAuthorization'->>'version',
            ''
          ) = $2
            THEN v6_terms.listing_id IS NOT NULL
          ELSE true
        END AS immutable_terms_complete
      FROM proof_indexer.credit_listings listing
      JOIN proof_indexer.transactions listing_tx
        ON listing_tx.network = listing.network
       AND listing_tx.txid = listing.listing_id
       AND listing_tx.status = 'confirmed'
      JOIN proof_indexer.blocks listing_block
        ON listing_block.network = listing_tx.network
       AND listing_block.block_hash = listing_tx.block_hash
       AND listing_block.height = listing_tx.block_height
       AND listing_block.canonical = true
      LEFT JOIN proof_indexer.work_amo_listing_terms v5_terms
        ON v5_terms.network = listing.network
       AND v5_terms.listing_id = listing.listing_id
      LEFT JOIN proof_indexer.work_amo_v6_listing_terms v6_terms
        ON v6_terms.network = listing.network
       AND v6_terms.listing_id = listing.listing_id
       AND v6_terms.listing_txid = listing.listing_id
       AND v6_terms.token_id = lower(listing.token_id)
       AND v6_terms.authorization_version = $2
       AND v6_terms.authorization_version = COALESCE(
         listing.payload->'listingAuthorization'->>'version',
         listing.payload->'saleAuthorization'->>'version',
         ''
       )
       AND v6_terms.unit_amount_atoms = listing.amount
       AND v6_terms.unit_price_sats = listing.price_sats
       AND (
         listing.payload->'listingFrozenTerms' IS NULL
         OR listing.payload->'listingFrozenTerms' =
           v6_terms.frozen_terms
       )
       AND (
         listing.payload->'frozenTerms' IS NULL
         OR listing.payload->'frozenTerms' =
           v6_terms.frozen_terms
       )
       AND (
         listing.payload->'workAmoFrozenTerms' IS NULL
         OR listing.payload->'workAmoFrozenTerms' =
           v6_terms.frozen_terms
       )
       AND (
         listing.payload->'workAmoV6FrozenTerms' IS NULL
         OR listing.payload->'workAmoV6FrozenTerms' =
           v6_terms.frozen_terms
       )
      WHERE listing.network = 'livenet'
        AND lower(listing.token_id) = $1
        AND listing.status IN ('active', 'sealing')
      ORDER BY listing.listing_id
    `,
    [WORK_TOKEN_ID, WORK_AMO_V6_AUTH_VERSION],
  );
  const holders = balanceResult.rows.map((row) => ({
    address: String(row.address ?? ""),
    balanceAtoms: String(row.balance_atoms ?? ""),
  }));
  const confirmedSupplyAtoms = holders
    .reduce((total, holder) => {
      if (!/^[1-9][0-9]*$/u.test(holder.balanceAtoms)) {
        throw new Error("Canonical WORK balance is not a positive integer.");
      }
      return total + BigInt(holder.balanceAtoms);
    }, 0n)
    .toString();
  const invalidV6Listing = listingResult.rows.find(
    (row) =>
      String(row.authorization_version ?? "").trim() ===
        WORK_AMO_V6_AUTH_VERSION &&
      row.immutable_terms_complete !== true,
  );
  if (invalidV6Listing) {
    return {
      complete: false,
      reason: "relational-v6-listing-terms-invalid",
    };
  }
  const listings =
    workAmoV5WorkStateWithoutLegacyListingReservations({
      listings: listingResult.rows.map((row) => ({
        amountAtoms: String(row.amount_atoms ?? ""),
        frozenTerms: row.frozen_terms,
        listingId: String(row.listing_id ?? "").trim().toLowerCase(),
        listingAuthorization: row.listing_authorization,
        priceSats: String(row.price_sats ?? ""),
        saleAuthorization:
          row.sale_authorization ?? row.listing_authorization,
        sellerAddress: String(row.seller_address ?? ""),
      })),
    }).listings;
  let commitment;
  try {
    commitment = workAmoV6CanonicalTokenStateCommitment({
      confirmedSupplyAtoms,
      holders,
      listings,
    });
  } catch (error) {
    return {
      complete: false,
      reason: error?.message ?? "relational-token-state-invalid",
    };
  }
  const expected = exactCommitment(
    expectedTokenStateCommitment,
    commitment.model,
  );
  if (
    !expected ||
    expected.sha256 !== commitment.sha256 ||
    expected.payloadBytes !== commitment.payloadBytes
  ) {
    return {
      commitment,
      complete: false,
      expectedTokenStateCommitment,
      reason: "relational-token-state-commitment-mismatch",
    };
  }
  return {
    commitment,
    complete: true,
    confirmedSupplyAtoms,
    holderCount: holders.length,
    listingCount: listings.length,
    model: "canonical-work-amo-relational-token-state-audit-v1",
  };
}

async function canonicalWorkAmoReplayEvidence(client) {
  const tipResult = await client.query(
    `
      SELECT height, lower(block_hash) AS block_hash
      FROM proof_indexer.blocks
      WHERE network = 'livenet' AND canonical = true
      ORDER BY height DESC, block_hash
      LIMIT 2
    `,
  );
  const tip = tipResult.rows[0];
  const throughHeight = Number(tip?.height);
  const throughBlockHash = String(tip?.block_hash ?? "").toLowerCase();
  if (
    !Number.isSafeInteger(throughHeight) ||
    throughHeight < WORK_AMO_V5_ACTIVATION_HEIGHT ||
    !/^[0-9a-f]{64}$/u.test(throughBlockHash) ||
    (
      tipResult.rows[1] &&
      Number(tipResult.rows[1].height) === throughHeight
    )
  ) {
    return { complete: false, reason: "canonical-tip-unavailable" };
  }
  let coreTipHeight;
  let coreTipBlockHash;
  let coreSeedBlockHash;
  try {
    coreTipHeight = Number(await canonicalBitcoinRpc("getblockcount"));
    [coreTipBlockHash, coreSeedBlockHash] = await Promise.all([
      canonicalBitcoinRpc("getblockhash", [coreTipHeight]),
      canonicalBitcoinRpc("getblockhash", [
        WORK_AMO_V5_ACTIVATION_HEIGHT - 1,
      ]),
    ]);
    coreTipBlockHash = String(coreTipBlockHash ?? "").trim().toLowerCase();
    coreSeedBlockHash = String(coreSeedBlockHash ?? "").trim().toLowerCase();
  } catch (error) {
    return {
      complete: false,
      reason: "core-tip-witness-unavailable",
      detail: error?.message ?? String(error),
    };
  }
  if (
    coreTipHeight !== throughHeight ||
    coreTipBlockHash !== throughBlockHash ||
    coreSeedBlockHash !== WORK_AMO_V5_DECLARATION_BLOCK_HASH
  ) {
    return {
      complete: false,
      coreSeedBlockHash,
      coreTipBlockHash,
      coreTipHeight,
      reason: "core-tip-or-seed-mismatch",
      throughBlockHash,
      throughHeight,
    };
  }
  const seedHeight = WORK_AMO_V5_ACTIVATION_HEIGHT - 1;
  const seedBlockResult = await client.query(
    `
      SELECT lower(block_hash) AS block_hash
      FROM proof_indexer.blocks
      WHERE network = 'livenet'
        AND canonical = true
        AND height = $1
      ORDER BY block_hash
    `,
    [seedHeight],
  );
  if (seedBlockResult.rows.length !== 1) {
    return { complete: false, reason: "v5-h-minus-one-seed-block-unavailable" };
  }
  const seedBlockHash = String(
    seedBlockResult.rows[0].block_hash ?? "",
  ).toLowerCase();
  if (seedBlockHash !== WORK_AMO_V5_DECLARATION_BLOCK_HASH) {
    return {
      complete: false,
      reason: "v5-h-minus-one-seed-block-mismatch",
    };
  }
  const seed =
    await exactWorkNetworkValueSnapshotEvidence(
      client,
      seedHeight,
      seedBlockHash,
    );
  const closing =
    await exactWorkNetworkValueSnapshotEvidence(
      client,
      throughHeight,
      throughBlockHash,
    );
  const rebuildResult = await client.query(
    `
      SELECT value
      FROM proof_indexer.meta
      WHERE key = 'canonical:rebuild'
      LIMIT 1
    `,
  );
  const blockScanResult = await client.query(
    `
      SELECT
        snapshot_id,
        payload
      FROM proof_indexer.ledger_snapshots
      WHERE network = 'livenet'
        AND indexed_through_block = $1
        AND NOT COALESCE(source_hashes ? 'canonicalSummary', false)
        AND (
          COALESCE(source_hashes ? 'blockScan', false)
          OR payload->>'source' = 'proof-indexer-block-scan'
        )
        AND lower(COALESCE(
          NULLIF(payload->>'indexedThroughBlockHash', ''),
          NULLIF(payload->>'blockHash', ''),
          NULLIF(source_hashes->>'blockScan', '')
        )) = $2
        AND COALESCE(payload->>'complete', 'false') = 'true'
        AND CASE
          WHEN payload->>'indexedThroughBlock' ~ '^[1-9][0-9]*$'
            THEN (payload->>'indexedThroughBlock')::integer = $1
          ELSE indexed_through_block = $1
        END
      ORDER BY generated_at DESC
      LIMIT 1
    `,
    [throughHeight, throughBlockHash],
  );
  const rebuild =
    rebuildResult.rows[0]?.value &&
    typeof rebuildResult.rows[0].value === "object" &&
    !Array.isArray(rebuildResult.rows[0].value)
      ? rebuildResult.rows[0].value
      : {};
  const rebuildFromHeight = Number(rebuild.fromHeight);
  const rebuildBootstrapHeight = Number(rebuild.bootstrapHeight);
  const rebuildBootstrapHash = String(rebuild.bootstrapHash ?? "")
    .trim()
    .toLowerCase();
  const rebuildCheckpointValid =
    rebuild.network === "livenet" &&
    rebuild.status === "complete" &&
    rebuild.complete === true &&
    rebuild.active === false &&
    Number.isSafeInteger(rebuildFromHeight) &&
    rebuildFromHeight > 0 &&
    rebuildFromHeight <= WORK_AMO_V1_ACTIVATION_HEIGHT &&
    rebuildBootstrapHeight === rebuildFromHeight - 1 &&
    /^[0-9a-f]{64}$/u.test(rebuildBootstrapHash) &&
    Number(rebuild.indexedThroughBlock) === throughHeight &&
    String(rebuild.indexedThroughBlockHash ?? "").trim().toLowerCase() ===
      throughBlockHash &&
    rebuild.transactionNormalization === "canonical-raw-tx-only";
  if (
    !seed ||
    !closing ||
    !rebuildCheckpointValid ||
    blockScanResult.rows.length !== 1
  ) {
    return {
      complete: false,
      reason: !seed
        ? "v5-h-minus-one-seed-summary-unavailable"
        : !closing
          ? "end-tip-summary-unavailable"
          : !rebuildCheckpointValid
            ? "canonical-rebuild-checkpoint-unavailable"
            : "block-scan-checkpoint-unavailable",
      seed,
      throughBlockHash,
      throughHeight,
    };
  }
  const [canonicalBootstrapCoreHash, canonicalFromCoreHash] =
    await Promise.all([
      canonicalBitcoinRpc("getblockhash", [rebuildBootstrapHeight]),
      canonicalBitcoinRpc("getblockhash", [rebuildFromHeight]),
    ]);
  const replayStartBlock = await client.query(
    `
      SELECT 1
      FROM proof_indexer.blocks
      WHERE network = 'livenet'
        AND canonical = true
        AND height = $1
        AND lower(block_hash) = $2
        AND lower(previous_block_hash) = $3
      LIMIT 1
    `,
    [
      rebuildFromHeight,
      String(canonicalFromCoreHash ?? "").trim().toLowerCase(),
      rebuildBootstrapHash,
    ],
  );
  if (
    String(canonicalBootstrapCoreHash ?? "").trim().toLowerCase() !==
      rebuildBootstrapHash ||
    replayStartBlock.rows.length !== 1
  ) {
    return {
      complete: false,
      reason: "canonical-rebuild-bootstrap-mismatch",
    };
  }
  let seedEvidence;
  try {
    seedEvidence = await canonicalWorkAmoSeedEvidence(
      client,
      seed,
    );
  } catch (error) {
    return {
      complete: false,
      detail: error?.message ?? String(error),
      reason: "v5-seed-evidence-validation-failed",
      seed,
      throughBlockHash,
      throughHeight,
    };
  }
  const v1History =
    await canonicalWorkAmoV1HistoryEventEvidence(
      client,
      throughHeight,
    );
  const transitionReplay =
    await canonicalWorkAmoV5TransitionEvidence(client, {
      closing,
      seedEvidence,
      seed,
      throughBlockHash,
      throughHeight,
    });
  if (transitionReplay.complete !== true) {
    return {
      complete: false,
      reason:
        transitionReplay.reason ??
        "v5-full-position-transition-replay-incomplete",
      seed,
      throughBlockHash,
      throughHeight,
      transitionReplay,
      v1History,
    };
  }
  const relationalTokenState =
    await canonicalWorkAmoRelationalTokenStateEvidence(
      client,
      transitionReplay.finalTipState?.tokenStateCommitment,
    );
  if (relationalTokenState.complete !== true) {
    return {
      complete: false,
      reason:
        relationalTokenState.reason ??
        "relational-token-state-commitment-incomplete",
      relationalTokenState,
      seed,
      throughBlockHash,
      throughHeight,
      transitionReplay,
      v1History,
    };
  }
  return {
    blockAtomic: transitionReplay.blockAtomic === true,
    blockScanSnapshotId: String(
      blockScanResult.rows[0].snapshot_id ?? "",
    ),
    closing,
    complete: true,
    endTipParity: transitionReplay.endTipParity === true,
    feeTransitionModel: transitionReplay.feeTransitionModel,
    invalidEventModel: transitionReplay.invalidEventModel,
    model: WORK_AMO_V5_REPLAY_MODEL,
    network: "livenet",
    coreTipBlockHash,
    coreTipHeight,
    replayFromHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
    relationalTokenState,
    seed,
    independentSeed: {
      commitment: seedEvidence.commitment,
      movementCount: seedEvidence.state.movements.length,
      source: seedEvidence.source,
      tokenStateCommitment:
        seedEvidence.state.tokenStateCommitment,
    },
    throughBlockHash,
    throughHeight,
    transitionReplay,
    v1History,
    v1HistoryFromHeight: WORK_AMO_V1_ACTIVATION_HEIGHT,
  };
}

export async function runWorkAmoV5Migration(
  client,
  { apply = false } = {},
) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('proof-indexer:work-amo-v5:livenet', 0))",
    );
    await client.query(
      `LOCK TABLE
        proof_indexer.transactions,
        proof_indexer.events,
        proof_indexer.credit_listings,
        proof_indexer.work_usd_quotes,
        proof_indexer.work_amo_listing_terms,
        proof_indexer.work_amo_block_transitions,
        proof_indexer.ledger_snapshots
       IN SHARE ROW EXCLUSIVE MODE`,
    );
    const positionsBackfilled = await backfillCanonicalPositions(client);
    const declaration = declarationEvidence(await pinnedDeclarationRow(client));
    const rows = await legacyRows(client);
    const classification = classifyWorkAmoV5LegacyRows(rows.rows);
    let invalidatedLegacyEvents = 0;
    let releasedLegacyListings = 0;
    if (classification.eventIds.length > 0) {
      const invalidated = await client.query(
        `
          UPDATE proof_indexer.events
          SET
            valid = false,
            validation_errors = ARRAY[$2]::text[],
            payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
              'valid', false,
              'reason',
                'Post-V1 WORK pwt-sale-v3 actions are invalid audit history.',
              'reasonCode', $2,
              'refundEligible', false,
              'relic', false,
              'validationErrors', jsonb_build_array($2)
            ),
            updated_at = now()
          WHERE network = 'livenet'
            AND event_id = ANY($1::bigint[])
            AND valid = true
          RETURNING event_id
        `,
        [classification.eventIds, WORK_AMO_V5_LEGACY_REASON_CODE],
      );
      invalidatedLegacyEvents = Number(invalidated.rowCount ?? 0);
      if (invalidatedLegacyEvents !== classification.eventIds.length) {
        throw new Error(
          "The post-V1 V3 event changed during the AMO migration.",
        );
      }
      const released = await client.query(
        `
          UPDATE proof_indexer.credit_listings
          SET
            status = 'dropped',
            payload =
              (
                COALESCE(payload, '{}'::jsonb)
                - 'sealTxid'
                - 'closeTxid'
                - 'closedTxid'
                - 'saleTxid'
                - 'buyerAddress'
              )
              || jsonb_build_object(
                'confirmed', true,
                'valid', false,
                'reasonCode', $2::text,
                'relic', false,
                'status', 'dropped'
              ),
            seal_txid = NULL,
            close_txid = NULL,
            buyer_address = NULL,
            updated_at = now()
          WHERE network = 'livenet'
            AND listing_id = $1
            AND status = 'active'
          RETURNING listing_id
        `,
        [
          WORK_AMO_V5_POST_V1_INVALID_LISTING_TXID,
          WORK_AMO_V5_LEGACY_REASON_CODE,
        ],
      );
      releasedLegacyListings = Number(released.rowCount ?? 0);
      if (releasedLegacyListings !== 1) {
        throw new Error(
          "The post-V1 V3 listing reservation was not released exactly once.",
        );
      }
    }
    const audit = await canonicalPositionAudit(client);
    const replayEvidence = await canonicalWorkAmoReplayEvidence(client);
    const complete =
      audit.authorizationConflicts === 0 &&
      audit.confirmedParentMetadataGaps === 0 &&
      audit.missingPositions === 0 &&
      audit.duplicatePositions === 0 &&
      audit.postV1V3Active === 0 &&
      audit.postActivationV4Active === 0 &&
      audit.postActivationV4Actions === 0 &&
      audit.missingFrozenTerms === 0 &&
      audit.syntheticBondPositionGaps === 0 &&
      replayEvidence.complete === true &&
      replayEvidence.blockAtomic === true &&
      replayEvidence.endTipParity === true;
    if (apply && !complete) {
      const error = new Error(
        "AMO V5 migration apply aborted because canonical replay, " +
          "global parent or bond-companion position audit, block " +
          "atomicity, or end-tip parity is incomplete.",
      );
      error.code = "WORK_AMO_V5_MIGRATION_INCOMPLETE";
      error.details = {
        audit,
        replayEvidence,
      };
      throw error;
    }
    if (complete) {
      await client.query(
        `
          CREATE UNIQUE INDEX IF NOT EXISTS
            events_confirmed_governed_position_uidx
          ON proof_indexer.events (
            network,
            block_height,
            block_index,
            op_return_vout,
            record_ordinal
          )
          WHERE
            status = 'confirmed'
            AND block_height >= 959621
            AND protocol IN ('pwm1', 'pwa1', 'pwid1', 'pwt1')
            AND block_index IS NOT NULL
            AND op_return_vout IS NOT NULL
        `,
      );
    }
    const invalidatedSnapshotIds = [];
    const marker = {
      activationHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
      audit,
      bootstrapCertificate:
        replayEvidence.complete === true
          ? {
              blockDescriptorModel:
                WORK_AMO_V5_RAW_BLOCK_DESCRIPTOR_MODEL,
              finalBlockDescriptorCommitment:
                replayEvidence.transitionReplay
                  ?.finalBlockDescriptorCommitment,
              finalBlockTransactionCount:
                replayEvidence.transitionReplay
                  ?.finalBlockTransactionCount,
              finalBip141Witness:
                replayEvidence.transitionReplay
                  ?.finalBip141Witness,
              finalTipCommitment:
                replayEvidence.transitionReplay?.finalTipCommitment,
              finalTransitionChainCommitment:
                replayEvidence.transitionReplay
                  ?.finalTransitionChainCommitment,
              seedCommitment:
                replayEvidence.independentSeed?.commitment,
              throughBlockHash: replayEvidence.throughBlockHash,
              throughHeight: replayEvidence.throughHeight,
              transitionSetSha256:
                replayEvidence.transitionReplay?.transitionSetSha256,
              transitionChainModel:
                WORK_AMO_V5_RAW_TRANSITION_CHAIN_MODEL,
            }
          : null,
      completedAt: complete ? new Date().toISOString() : null,
      declaration,
      declarationTxid: WORK_AMO_V5_DECLARATION_TXID,
      invalidatedSnapshotCount: invalidatedSnapshotIds.length,
      feeTransitionModel: WORK_AMO_V5_FEE_TRANSITION_MODEL,
      invalidEventModel: WORK_AMO_V5_INVALID_EVENT_MODEL,
      model: "canonical-work-amo-v5-migration-v2",
      network: "livenet",
      positionModel: "canonical-proof-state-order-v1",
      replayEvidence,
      replayFromHeight: WORK_AMO_V5_ACTIVATION_HEIGHT,
      status: complete ? "complete" : "replay-required",
      updatedAt: new Date().toISOString(),
    };
    if (apply) {
      await client.query(
        `
          INSERT INTO proof_indexer.meta (key, value, updated_at)
          VALUES ($1, $2::jsonb, now())
          ON CONFLICT (key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        `,
        ["workAmoV5Migration:livenet", JSON.stringify(marker)],
      );
      const commitCanonicalBlockHash = String(
        await canonicalBitcoinRpc(
          "getblockhash",
          [replayEvidence.throughHeight],
        ),
      )
        .trim()
        .toLowerCase();
      if (
        commitCanonicalBlockHash !==
        replayEvidence.throughBlockHash
      ) {
        const error = new Error(
          "AMO V5 migration apply aborted because the certified " +
            "canonical block changed before commit.",
        );
        error.code = "WORK_AMO_V5_MIGRATION_CANONICALITY_CHANGED";
        error.details = {
          commitCanonicalBlockHash,
          throughBlockHash: replayEvidence.throughBlockHash,
          throughHeight: replayEvidence.throughHeight,
        };
        throw error;
      }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return {
      alreadyMigratedCount: classification.alreadyMigratedEventIds.length,
      applied: apply,
      audit,
      declaration,
      invalidatedLegacyEvents,
      invalidatedSnapshotCount: invalidatedSnapshotIds.length,
      marker,
      positionsBackfilled,
      replayEvidence,
      releasedLegacyListings,
      requiresReplay: !complete,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const connectionString = String(
    process.env.POW_INDEX_DATABASE_URL ?? "",
  ).trim();
  if (!connectionString) {
    throw new Error("POW_INDEX_DATABASE_URL is required.");
  }
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    const result = await runWorkAmoV5Migration(client, {
      apply: process.env.WORK_AMO_V5_MIGRATION_APPLY === "1",
    });
    console.log(JSON.stringify(result));
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
