import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import * as bitcoin from "bitcoinjs-lib";
import {
  canonicalRawProtocolRecordSetFromTransaction,
} from "../server/canonical-op-return.mjs";
import {
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  replayWorkAmoV5RawBlock,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "../server/work-amo-v5-raw.mjs";
import {
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_ATOMS_PER_WORK,
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
  WORK_AMO_V5_MAX_SUPPLY,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE,
  workAmoV5CanonicalPayloadCommitment,
  workAmoV5CanonicalStateCommitment,
  workAmoV5CanonicalTokenStateCommitment,
} from "../server/work-amo-v5.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const NETWORK = bitcoin.networks.bitcoin;
const SENDER_ADDRESS = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const BLOCK_HEIGHT = WORK_AMO_V5_ACTIVATION_HEIGHT + 10_000;
const PREVIOUS_BLOCK_HASH = sha256Hex(
  "work-amo-v5-valid-send2-peak-previous-block",
);
const BLOCK_TIME = 1_785_067_200;
const TRANSACTION_FEE_SATS = 111;
const DEFAULT_OPENING_MOVEMENT_COUNT = 64;
const REFERENCE_RECORD_COUNT = 12;
const REFERENCE_OPENING_MOVEMENT_COUNT = 8;
const EXPECTED_REFERENCE_EQUIVALENCE_SHA256 =
  "62d6ff8a02bab4878be425bd71b37c918fadb8f3294498fc926c9794ff263051";
const EXPECTED_REFERENCE_SEMANTIC_EQUIVALENCE_SHA256 =
  "45b3248d89c12f91c7e04bcb8b0c5303be2bb7e275b302d085995b90157397ae";
const MOVEMENT_DENOMINATOR =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK;
const INITIAL_SUPPLY_ATOMS =
  WORK_AMO_V5_MAX_SUPPLY * WORK_AMO_V5_ATOMS_PER_WORK;
const REGISTRY_SCRIPT_HEX = outputScriptHex(
  WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
);
const SENDER_SCRIPT_HEX = outputScriptHex(SENDER_ADDRESS);

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function doubleSha256(value) {
  return createHash("sha256")
    .update(createHash("sha256").update(value).digest())
    .digest();
}

function merkleRoot(txids) {
  let level = txids.map((txid) =>
    Buffer.from(txid, "hex").reverse()
  );
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(Buffer.from(level.at(-1)));
    }
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(
        doubleSha256(
          Buffer.concat([level[index], level[index + 1]]),
        ),
      );
    }
    level = next;
  }
  return Buffer.from(level[0]).reverse().toString("hex");
}

function blockWitness(txids) {
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(PREVIOUS_BLOCK_HASH, "hex")
    .reverse()
    .copy(header, 4);
  Buffer.from(merkleRoot(txids), "hex")
    .reverse()
    .copy(header, 36);
  header.writeUInt32LE(BLOCK_TIME, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  header.writeUInt32LE(txids.length, 76);
  return {
    blockHash:
      Buffer.from(doubleSha256(header)).reverse().toString("hex"),
    blockHeaderHex: header.toString("hex"),
  };
}

function coinbaseFixture() {
  const transaction = new bitcoin.Transaction();
  transaction.version = 1;
  transaction.addInput(
    Buffer.alloc(32),
    0xffff_ffff,
    0xffff_ffff,
    Buffer.from("00", "hex"),
  );
  transaction.addOutput(Buffer.alloc(0), 0n);
  return {
    hex: transaction.toHex(),
    txid: transaction.getId(),
    vin: [{ coinbase: "00" }],
    vout: [{ scriptpubkey: "", value: 0 }],
  };
}

function serializedTransfer(index) {
  const amountAtoms = transferAmountAtoms(index);
  const recipient = recipientFixture(index);
  const message = [
    "pwt1",
    "send2",
    WORK_TOKEN_ID,
    amountAtoms,
    recipient.address,
  ].join(":");
  const inputTxid = sha256Hex(
    `work-amo-v5-valid-send2-prevout:${index}`,
  );
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(
    Buffer.from(inputTxid, "hex").reverse(),
    0,
    0xffff_fffd,
  );
  transaction.addOutput(
    Buffer.from(REGISTRY_SCRIPT_HEX, "hex"),
    BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS),
  );
  transaction.addOutput(
    Buffer.from(opReturnScriptHex(message), "hex"),
    0n,
  );
  return {
    amountAtoms,
    hex: transaction.toHex(),
    inputTxid,
    message,
    recipient,
    txid: transaction.getId(),
  };
}

function outputScriptHex(address) {
  return Buffer.from(
    bitcoin.address.toOutputScript(address, NETWORK),
  ).toString("hex");
}

function recipientFixture(index) {
  const hash = createHash("sha256")
    .update(`work-amo-v5-valid-send2-recipient:${index}`)
    .digest()
    .subarray(0, 20);
  const payment = bitcoin.payments.p2wpkh({ hash, network: NETWORK });
  assert.ok(payment.address);
  assert.ok(payment.output);
  return {
    address: payment.address,
    scriptPubKeyHex: Buffer.from(payment.output).toString("hex"),
  };
}

function transferAmountAtoms(index) {
  return 1_000_003n + BigInt(index) * 7_919n;
}

function openingMovement(index) {
  return {
    amountAtoms: (
      50_000_003n + BigInt(index) * 1_000_003n
    ).toString(),
    identity: [
      "opening-transfer",
      sha256Hex(`work-amo-v5-opening-movement:${index}`),
      index,
      0,
    ].join(":"),
  };
}

function openingBaseState() {
  const values = {
    browserFlowSats: "310003",
    computerEventFlowSats: "4200000",
    driveFlowSats: "220003",
    idMarketplaceFeeSats: "110003",
    idMarketplaceVolumeSats: "510003",
    inceptionBondFlowSats: "610003",
    infinityBondFlowSats: "710003",
    mailFlowSats: "810003",
    powids: "0",
    tokenCreationFlowSats: "910003",
    tokenMarketplaceFeeSats: "1010003",
    tokenMintFlowSats: "1110003",
    tokenSaleVolumeSats: "1210003",
    tokenTransferFlowSats: "1310003",
  };
  assert.deepEqual(
    Object.keys(values).sort(),
    [...WORK_AMO_V5_BASE_STATE_FIELDS].sort(),
  );
  return values;
}

function baseNetworkValueQ8(baseState) {
  const flowSats = WORK_AMO_V5_BASE_STATE_FIELDS
    .filter((field) => field !== "powids")
    .reduce((total, field) => total + BigInt(baseState[field]), 0n);
  return flowSats * 5n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
}

function buildOpeningEconomicState({
  genericState,
  idState,
  movementCount,
  workState,
}) {
  const baseState = openingBaseState();
  const movements = Array.from(
    { length: movementCount },
    (_unused, index) => openingMovement(index),
  );
  const creditFixedQ8 =
    7_654_321n * WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE;
  const creditMovementFrozenValueQ8 = 98_765_432_100_003n;
  const baseValueQ8 = baseNetworkValueQ8(baseState);
  const frozenNetworkValueQ8 =
    baseValueQ8 + creditFixedQ8 + creditMovementFrozenValueQ8;
  const creditMovementLiveValueQ8 = movements.reduce(
    (total, movement) =>
      total +
      (BigInt(movement.amountAtoms) * frozenNetworkValueQ8) /
        MOVEMENT_DENOMINATOR,
    0n,
  );
  return {
    baseState,
    creditFixedQ8: creditFixedQ8.toString(),
    creditMovementFrozenValueQ8:
      creditMovementFrozenValueQ8.toString(),
    genericTokenStateCommitment:
      workAmoV5RawGenericStateCommitment(genericState),
    idStateCommitment: workAmoV5RawIdStateCommitment(idState),
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
    movements,
    network: "livenet",
    networkValueQ8: (
      baseValueQ8 +
      creditFixedQ8 +
      creditMovementLiveValueQ8
    ).toString(),
    quoteHead: null,
    throughBlockHash: PREVIOUS_BLOCK_HASH,
    throughBlockHeight: BLOCK_HEIGHT - 1,
    tokenStateCommitment:
      workAmoV5CanonicalTokenStateCommitment(workState),
  };
}

function opReturnScriptHex(message) {
  return Buffer.from(
    bitcoin.script.compile([
      bitcoin.opcodes.OP_RETURN,
      Buffer.from(message, "utf8"),
    ]),
  ).toString("hex");
}

function transferRecord(index, blockHash, serialized) {
  const {
    amountAtoms,
    hex,
    inputTxid,
    message,
    recipient,
    txid,
  } = serialized;
  const protocolVout = 1;
  const scriptPubKeyHex = opReturnScriptHex(message);
  const blockTransactionIndex = index + 1;
  const tx = {
    blockhash: blockHash,
    blockheight: BLOCK_HEIGHT,
    blockindex: blockTransactionIndex,
    blocktime: BLOCK_TIME,
    fee: TRANSACTION_FEE_SATS,
    hex,
    locktime: 0,
    status: {
      block_hash: blockHash,
      block_height: BLOCK_HEIGHT,
      block_index: blockTransactionIndex,
      block_time: BLOCK_TIME,
      confirmed: true,
    },
    txid,
    version: 2,
    vin: [{
      prevout: {
        scriptpubkey: SENDER_SCRIPT_HEX,
        scriptpubkey_address: SENDER_ADDRESS,
        scriptpubkey_type: "p2pkh",
        value:
          WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS +
          TRANSACTION_FEE_SATS,
      },
      sequence: 0xffff_fffd,
      txid: inputTxid,
      vout: 0,
    }],
    vout: [
      {
        scriptpubkey: REGISTRY_SCRIPT_HEX,
        scriptpubkey_address:
          WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS,
        scriptpubkey_type: "p2pkh",
        value: WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS,
      },
      {
        scriptpubkey: scriptPubKeyHex,
        scriptpubkey_type: "op_return",
        value: 0,
      },
    ],
  };
  const reconstruction =
    canonicalRawProtocolRecordSetFromTransaction(tx);
  assert.equal(reconstruction.rawProtocolCandidateCount, 1);
  assert.equal(reconstruction.records.length, 1);
  const canonicalRecord = reconstruction.records[0];
  assert.equal(canonicalRecord.message, message);
  assert.equal(canonicalRecord.protocol, "pwt1");
  assert.equal(canonicalRecord.protocolVout, protocolVout);
  return {
    amountAtoms,
    recipientAddress: recipient.address,
    record: {
      message,
      payload: canonicalRecord.payload,
      position: {
        blockHash: blockHash,
        blockHeight: BLOCK_HEIGHT,
        blockTransactionIndex,
        protocolVout,
        recordOrdinal: 0,
      },
      protocol: "pwt1",
      protocolVout,
      rawDecodeReasonCode:
        canonicalRecord.rawDecodeReasonCode,
      rawDecodeValid: canonicalRecord.rawDecodeValid,
      rawRecordParts: canonicalRecord.rawRecordParts,
      recordOrdinal: 0,
      transactionMinerFeeSats: String(TRANSACTION_FEE_SATS),
      transactionProtocolRecordCount: 1,
      tx,
      txid,
    },
    txid,
  };
}

export function createWorkAmoV5SendPeakFixture({
  count,
  openingMovementCount = DEFAULT_OPENING_MOVEMENT_COUNT,
} = {}) {
  assert.ok(Number.isSafeInteger(count) && count > 0);
  assert.ok(
    Number.isSafeInteger(openingMovementCount) &&
      openingMovementCount > 0,
  );
  const genericState = normalizeWorkAmoV5RawGenericState({
    holders: [],
    listings: [],
    tokens: [],
  });
  const idState = normalizeWorkAmoV5RawIdState({
    listings: [],
    records: [],
  });
  const workState = {
    confirmedSupplyAtoms: INITIAL_SUPPLY_ATOMS.toString(),
    holders: [{
      address: SENDER_ADDRESS,
      balanceAtoms: INITIAL_SUPPLY_ATOMS.toString(),
    }],
    listings: [],
  };
  const coinbase = coinbaseFixture();
  const serializedTransfers = Array.from(
    { length: count },
    (_unused, index) => serializedTransfer(index),
  );
  const { blockHash, blockHeaderHex } = blockWitness([
    coinbase.txid,
    ...serializedTransfers.map(({ txid }) => txid),
  ]);
  const transfers = serializedTransfers.map(
    (serialized, index) =>
      transferRecord(index, blockHash, serialized),
  );
  assert.equal(
    new Set(transfers.map(({ recipientAddress }) => recipientAddress)).size,
    count,
  );
  assert.equal(
    new Set(transfers.map(({ amountAtoms }) => amountAtoms.toString())).size,
    count,
  );
  const transferredAtoms = transfers.reduce(
    (total, transfer) => total + transfer.amountAtoms,
    0n,
  );
  assert.ok(transferredAtoms < INITIAL_SUPPLY_ATOMS);
  return {
    blockHash,
    blockHeaderHex,
    blockTransactions: [
      coinbase,
      ...transfers.map(({ record }) => record.tx),
    ],
    expected: {
      openingMovementCount,
      transferredAtoms,
      transfers,
    },
    openingEconomicState: buildOpeningEconomicState({
      genericState,
      idState,
      movementCount: openingMovementCount,
      workState,
    }),
    openingGenericState: genericState,
    openingIdState: idState,
    openingWorkState: workState,
    records: transfers.map(({ record }) => record),
  };
}

function equivalenceProjection(replay) {
  return {
    economicState: replay.economicState,
    events: replay.events,
    feeTransitions: replay.feeTransitions,
    genericState: replay.genericState,
    genericTokenStateCommitment:
      replay.genericTokenStateCommitment,
    idState: replay.idState,
    idStateCommitment: replay.idStateCommitment,
    protocolRecordCount: replay.protocolRecordCount,
    rawProtocolCandidateCount: replay.rawProtocolCandidateCount,
    stateCommitment: replay.stateCommitment,
    tokenStateCommitment: replay.tokenStateCommitment,
    transitionChainCommitment: replay.transitionChainCommitment,
    transitionChainModel: replay.transitionChainModel,
    transactionCount: replay.transactionCount,
    workState: replay.workState,
  };
}

function semanticEquivalenceProjection(replay) {
  const {
    transitionChainCommitment: _transitionChainCommitment,
    transitionChainModel: _transitionChainModel,
    ...semantic
  } = equivalenceProjection(replay);
  return {
    ...semantic,
    events: replay.events.map(
      ({
        stateCommitmentAfter: _stateCommitmentAfter,
        transitionChainCommitmentAfter:
          _transitionChainCommitmentAfter,
        ...event
      }) => ({
        ...event,
        derived: event.derived.map(
          ({
            parentTransitionChainCommitmentAfter:
              _parentTransitionChainCommitmentAfter,
            ...derived
          }) => derived,
        ),
      }),
    ),
    feeTransitions: replay.feeTransitions.map(
      ({
        stateCommitmentAfter: _stateCommitmentAfter,
        transitionChainCommitmentAfter:
          _transitionChainCommitmentAfter,
        ...transition
      }) => transition,
    ),
  };
}

function assertReplay({
  count,
  fixture,
  replay,
}) {
  assert.equal(replay.protocolRecordCount, count);
  assert.equal(replay.rawProtocolCandidateCount, count);
  assert.equal(replay.transactionCount, count);
  assert.equal(replay.records.length, count);
  assert.equal(replay.outcomes.size, count);
  assert.equal(replay.events.length, count);
  assert.equal(replay.feeTransitions.length, count);
  assert.equal(
    replay.events.reduce(
      (total, event) => total + event.derived.length,
      0,
    ),
    0,
  );
  assert.ok(replay.events.every((event) => event.valid === true));
  assert.ok(
    replay.feeTransitions.every(
      (transition) =>
        transition.valid === true &&
        transition.transactionMinerFeeSats ===
          String(TRANSACTION_FEE_SATS),
    ),
  );

  for (const transfer of fixture.expected.transfers) {
    const outcome = replay.outcomes.get(`${transfer.txid}:1:0`);
    assert.equal(outcome?.valid, true);
    assert.equal(outcome?.reasonCode, "");
    assert.equal(outcome?.semanticKind, "token-transfer");
    assert.equal(
      outcome?.output?.amountAtoms,
      transfer.amountAtoms.toString(),
    );
    assert.equal(
      outcome?.output?.recipientAddress,
      transfer.recipientAddress,
    );
    assert.equal(outcome?.output?.senderAddress, SENDER_ADDRESS);
    assert.equal(outcome?.stateDelta?.economicOutputs?.length, 1);
    assert.equal(
      outcome?.stateDelta?.economicOutputs?.[0]?.vout,
      0,
    );
    assert.ok(BigInt(outcome.networkValueAfterQ8) >
      BigInt(outcome.networkValueBeforeQ8));
    assert.ok(BigInt(outcome.bondContributionQ8) > 0n);
  }

  assert.equal(
    replay.workState.confirmedSupplyAtoms,
    INITIAL_SUPPLY_ATOMS.toString(),
  );
  assert.equal(replay.workState.listings.length, 0);
  assert.equal(replay.workState.holders.length, count + 1);
  const balances = new Map(
    replay.workState.holders.map((holder) => [
      holder.address,
      BigInt(holder.balanceAtoms),
    ]),
  );
  assert.equal(
    balances.get(SENDER_ADDRESS),
    INITIAL_SUPPLY_ATOMS - fixture.expected.transferredAtoms,
  );
  for (const transfer of fixture.expected.transfers) {
    assert.equal(
      balances.get(transfer.recipientAddress),
      transfer.amountAtoms,
    );
  }
  assert.equal(
    [...balances.values()].reduce(
      (total, balance) => total + balance,
      0n,
    ),
    INITIAL_SUPPLY_ATOMS,
  );

  assert.equal(
    replay.economicState.baseState.tokenTransferFlowSats,
    (
      BigInt(
        fixture.openingEconomicState.baseState.tokenTransferFlowSats,
      ) +
      BigInt(count) *
        BigInt(WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS)
    ).toString(),
  );
  assert.equal(
    replay.economicState.creditFixedQ8,
    (
      BigInt(fixture.openingEconomicState.creditFixedQ8) +
      BigInt(count) *
        BigInt(
          WORK_AMO_V5_DECLARATION_MIN_PAYMENT_SATS +
            TRANSACTION_FEE_SATS,
        ) *
        WORK_AMO_V5_NETWORK_VALUE_Q8_SCALE
    ).toString(),
  );
  assert.equal(
    replay.economicState.movements.length,
    fixture.expected.openingMovementCount + count,
  );
  assert.equal(replay.economicState.throughBlockHeight, BLOCK_HEIGHT);
  assert.equal(
    replay.economicState.throughBlockHash,
    fixture.blockHash,
  );
  assert.deepEqual(
    replay.genericTokenStateCommitment,
    fixture.openingEconomicState.genericTokenStateCommitment,
  );
  assert.deepEqual(
    replay.idStateCommitment,
    fixture.openingEconomicState.idStateCommitment,
  );
  assert.deepEqual(
    replay.tokenStateCommitment,
    workAmoV5CanonicalTokenStateCommitment(replay.workState),
  );
  assert.deepEqual(
    replay.stateCommitment,
    workAmoV5CanonicalStateCommitment(replay.economicState),
  );
}

function processMaxRssBytes() {
  return process.resourceUsage().maxRSS * 1024;
}

export function runWorkAmoV5SendPeakFixture({
  count,
  openingMovementCount = DEFAULT_OPENING_MOVEMENT_COUNT,
  reverse = false,
} = {}) {
  const fixture = createWorkAmoV5SendPeakFixture({
    count,
    openingMovementCount,
  });
  if (typeof global.gc === "function") {
    global.gc();
  }
  const rssStartBytes = process.memoryUsage().rss;
  const maxRssBeforeBytes = processMaxRssBytes();
  const startedAt = performance.now();
  const replay = replayWorkAmoV5RawBlock({
    blockHeaderHex: fixture.blockHeaderHex,
    blockTransactions: fixture.blockTransactions,
    expectedBlockHash: fixture.blockHash,
    expectedBlockHeight: BLOCK_HEIGHT,
    expectedPreviousBlockHash: PREVIOUS_BLOCK_HASH,
    openingEconomicState: fixture.openingEconomicState,
    openingGenericState: fixture.openingGenericState,
    openingIdState: fixture.openingIdState,
    openingWorkState: fixture.openingWorkState,
    records: reverse
      ? fixture.records.slice().reverse()
      : fixture.records,
  });
  const wallTimeMs = performance.now() - startedAt;
  const rssEndBytes = process.memoryUsage().rss;
  const maxRssBytes = processMaxRssBytes();
  assertReplay({ count, fixture, replay });
  const equivalence = workAmoV5CanonicalPayloadCommitment(
    equivalenceProjection(replay),
  );
  const semanticEquivalence = workAmoV5CanonicalPayloadCommitment(
    semanticEquivalenceProjection(replay),
  );
  return {
    count,
    equivalence,
    maxRssBytes,
    maxRssGrowthBytes: Math.max(
      0,
      maxRssBytes - maxRssBeforeBytes,
    ),
    openingMovementCount,
    order: reverse ? "reverse" : "forward",
    rssDeltaBytes: rssEndBytes - rssStartBytes,
    rssEndBytes,
    rssStartBytes,
    semanticEquivalence,
    stateCommitment: replay.stateCommitment,
    tokenStateCommitment: replay.tokenStateCommitment,
    transitionChainCommitment:
      replay.transitionChainCommitment,
    transitionChainModel: replay.transitionChainModel,
    wallTimeMs,
  };
}

function workerArgument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function positiveIntegerArgument(name) {
  const value = Number(workerArgument(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`--${name} must be a positive safe integer`);
  }
  return value;
}

function runWorker() {
  const result = runWorkAmoV5SendPeakFixture({
    count: positiveIntegerArgument("count"),
    openingMovementCount:
      positiveIntegerArgument("opening-movements"),
    reverse: workerArgument("order") === "reverse",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function childBenchmark({
  count,
  openingMovementCount,
  reverse,
}) {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      SCRIPT_PATH,
      "--worker",
      `--count=${count}`,
      `--opening-movements=${openingMovementCount}`,
      `--order=${reverse ? "reverse" : "forward"}`,
    ],
    {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: count >= 5_000 ? 30 * 60_000 : 15 * 60_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `AMO V5 peak worker failed for ${count} ${reverse ? "reverse" : "forward"}.`,
        result.error?.message ?? "",
        result.stderr ?? "",
        result.stdout ?? "",
      ].filter(Boolean).join("\n"),
    );
  }
  return JSON.parse(result.stdout);
}

function requestedCounts() {
  const explicit = workerArgument("counts");
  if (explicit) {
    const counts = explicit.split(",").map((value) => Number(value));
    if (
      counts.length === 0 ||
      counts.some(
        (count) => !Number.isSafeInteger(count) || count <= 0,
      )
    ) {
      throw new TypeError("--counts must contain positive safe integers");
    }
    return [...new Set(counts)];
  }
  return process.argv.includes("--full") ? [1_000, 5_000] : [1_000];
}

function humanBytes(value) {
  const absolute = Math.abs(value);
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = absolute;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${value < 0 ? "-" : ""}${size.toFixed(2)} ${units[unit]}`;
}

function printRun(result) {
  console.log(
    [
      `${result.count.toLocaleString("en-US")} ${result.order}`,
      `${result.wallTimeMs.toFixed(2)} ms`,
      `RSS ${humanBytes(result.rssStartBytes)} -> ${humanBytes(result.rssEndBytes)}`,
      `delta ${humanBytes(result.rssDeltaBytes)}`,
      `max ${humanBytes(result.maxRssBytes)}`,
      `max growth ${humanBytes(result.maxRssGrowthBytes)}`,
      `root ${result.stateCommitment.sha256}`,
    ].join(" | "),
  );
}

function main() {
  const referenceForward = childBenchmark({
    count: REFERENCE_RECORD_COUNT,
    openingMovementCount: REFERENCE_OPENING_MOVEMENT_COUNT,
    reverse: false,
  });
  const referenceReverse = childBenchmark({
    count: REFERENCE_RECORD_COUNT,
    openingMovementCount: REFERENCE_OPENING_MOVEMENT_COUNT,
    reverse: true,
  });
  assert.deepEqual(
    referenceForward.equivalence,
    referenceReverse.equivalence,
  );
  assert.deepEqual(
    referenceForward.stateCommitment,
    referenceReverse.stateCommitment,
  );
  assert.deepEqual(
    referenceForward.tokenStateCommitment,
    referenceReverse.tokenStateCommitment,
  );
  assert.deepEqual(
    referenceForward.transitionChainCommitment,
    referenceReverse.transitionChainCommitment,
  );
  assert.deepEqual(
    referenceForward.semanticEquivalence,
    referenceReverse.semanticEquivalence,
  );
  if (EXPECTED_REFERENCE_EQUIVALENCE_SHA256) {
    assert.equal(
      referenceForward.equivalence.sha256,
      EXPECTED_REFERENCE_EQUIVALENCE_SHA256,
    );
  }
  if (EXPECTED_REFERENCE_SEMANTIC_EQUIVALENCE_SHA256) {
    assert.equal(
      referenceForward.semanticEquivalence.sha256,
      EXPECTED_REFERENCE_SEMANTIC_EQUIVALENCE_SHA256,
    );
  }
  console.log(
    `AMO V5 reference equivalence (${REFERENCE_RECORD_COUNT} valid send2 records): ${referenceForward.equivalence.sha256}`,
  );
  console.log(
    `AMO V5 reference semantic equivalence (${REFERENCE_RECORD_COUNT} valid send2 records): ${referenceForward.semanticEquivalence.sha256}`,
  );

  const results = [];
  for (const count of requestedCounts()) {
    const forward = childBenchmark({
      count,
      openingMovementCount: DEFAULT_OPENING_MOVEMENT_COUNT,
      reverse: false,
    });
    const reverse = childBenchmark({
      count,
      openingMovementCount: DEFAULT_OPENING_MOVEMENT_COUNT,
      reverse: true,
    });
    assert.deepEqual(forward.equivalence, reverse.equivalence);
    assert.deepEqual(
      forward.semanticEquivalence,
      reverse.semanticEquivalence,
    );
    assert.deepEqual(forward.stateCommitment, reverse.stateCommitment);
    assert.deepEqual(
      forward.tokenStateCommitment,
      reverse.tokenStateCommitment,
    );
    assert.deepEqual(
      forward.transitionChainCommitment,
      reverse.transitionChainCommitment,
    );
    printRun(forward);
    printRun(reverse);
    results.push({ forward, reverse });
  }
  console.log(
    JSON.stringify(
      {
        model: "work-amo-v5-valid-state-mutating-peak-regression-v1",
        reference: {
          count: REFERENCE_RECORD_COUNT,
          equivalence: referenceForward.equivalence,
          openingMovementCount: REFERENCE_OPENING_MOVEMENT_COUNT,
          semanticEquivalence:
            referenceForward.semanticEquivalence,
        },
        results,
      },
      null,
      2,
    ),
  );
}

if (process.argv.includes("--worker")) {
  runWorker();
} else if (process.argv[1] === SCRIPT_PATH) {
  main();
}
