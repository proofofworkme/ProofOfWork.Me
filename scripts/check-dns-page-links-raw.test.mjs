import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import {
  DNS_PAGE_LINK_ACTIVATION_HEIGHT,
  DNS_PAGE_LINK_PREFIX,
  buildDnsPageLinkPayload,
} from "../src/shared/protocol/dnsPages.mjs";
import {
  WORK_AMO_V5_ACTIVATION_HEIGHT,
  WORK_AMO_V5_BASE_STATE_FIELDS,
  WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL,
  isWorkAmoV5LivenetAddress,
  parseWorkAmoV5RawPwdnsRecord,
  workAmoV5CanonicalTokenStateCommitment,
} from "../server/work-amo-v5.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "../server/canonical-op-return.mjs";
import {
  normalizeWorkAmoV5RawGenericState,
  normalizeWorkAmoV5RawIdState,
  normalizeWorkAmoV5RawWorkState,
  replayWorkAmoV5RawBlock,
  workAmoV5RawBlockDiscoveryEnvelope,
  workAmoV5RawGenericStateCommitment,
  workAmoV5RawIdStateCommitment,
} from "../server/work-amo-v5-raw.mjs";

const ACTOR = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const OTHER = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const PRIOR_HASH = "22".repeat(32);
const HEIGHT = Math.max(WORK_AMO_V5_ACTIVATION_HEIGHT + 40, DNS_PAGE_LINK_ACTIVATION_HEIGHT);
const FEE = 11;
const PAGE = buildDnsPageLinkPayload({
  action: "set", name: "alice",
  epoch: { txid: "33".repeat(32), protocolVout: 1, recordOrdinal: 0 },
  pageTxid: "77".repeat(32),
});
const sha256d = (bytes) => createHash("sha256").update(createHash("sha256").update(bytes).digest()).digest();
const scriptForAddress = (address) => Buffer.from(bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)).toString("hex");
const opReturn = (text) => Buffer.from(bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(text)])).toString("hex");

function serialize(tx) {
  const serialized = new bitcoin.Transaction();
  serialized.version = 2;
  for (const input of tx.vin) {
    const index = typeof input.coinbase === "string"
      ? serialized.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from(input.coinbase, "hex"))
      : serialized.addInput(Buffer.from(input.txid, "hex").reverse(), input.vout);
    if (input.txinwitness) serialized.setWitness(index, input.txinwitness.map((item) => Buffer.from(item, "hex")));
  }
  for (const output of tx.vout) serialized.addOutput(Buffer.from(output.scriptpubkey, "hex"), BigInt(output.value));
  return { ...tx, hex: serialized.toHex(), txid: serialized.getId() };
}

function transaction(messages, { actor = ACTOR, outputAddress = actor, value = 546, secondActor = null } = {}) {
  return serialize({
    vin: [
      {
        txid: "44".repeat(32), vout: 0, txinwitness: ["55".repeat(32)],
        prevout: { scriptpubkey: scriptForAddress(actor), scriptpubkey_address: actor, value: String(value + FEE) },
      },
      ...(secondActor ? [{ txid: "66".repeat(32), vout: 0, prevout: { scriptpubkey: scriptForAddress(secondActor), scriptpubkey_address: secondActor, value: "0" } }] : []),
    ],
    vout: [
      { value: String(value), scriptpubkey: scriptForAddress(outputAddress), scriptpubkey_address: outputAddress },
      ...messages.map((message) => ({ value: "0", scriptpubkey: opReturn(message) })),
    ],
  });
}

function merkle(hashes) {
  let level = hashes.map((hash) => Buffer.from(hash));
  while (level.length > 1) {
    if (level.length % 2) level.push(Buffer.from(level.at(-1)));
    level = Array.from({ length: level.length / 2 }, (_, index) => sha256d(Buffer.concat([level[index * 2], level[index * 2 + 1]])));
  }
  return level[0];
}

function block(txs, height = HEIGHT) {
  const reserved = Buffer.alloc(32);
  const witnessRoot = merkle([Buffer.alloc(32), ...txs.map((tx) => Buffer.from(bitcoin.Transaction.fromHex(tx.hex).getHash(true)))]);
  const commitment = sha256d(Buffer.concat([witnessRoot, reserved]));
  const coinbase = serialize({
    vin: [{ coinbase: "0401020304", txinwitness: [reserved.toString("hex")] }],
    vout: [{ value: "0", scriptpubkey: "51" }, { value: "0", scriptpubkey: `6a24aa21a9ed${commitment.toString("hex")}` }],
  });
  const blockTransactions = [coinbase, ...txs].map((tx, index) => ({ ...tx, _powBlockIndex: index }));
  const header = Buffer.alloc(80);
  header.writeInt32LE(1, 0);
  Buffer.from(PRIOR_HASH, "hex").reverse().copy(header, 4);
  merkle(blockTransactions.map((tx) => Buffer.from(tx.txid, "hex").reverse())).copy(header, 36);
  header.writeUInt32LE(1_700_000_000, 68);
  header.writeUInt32LE(0x1d00ffff, 72);
  return {
    blockTransactions,
    blockHeight: height,
    blockHash: Buffer.from(sha256d(header)).reverse().toString("hex"),
    previousBlockHash: PRIOR_HASH,
    blockHeaderHex: header.toString("hex"),
  };
}

function openingState(height) {
  const generic = normalizeWorkAmoV5RawGenericState({ holders: [], listings: [], tokens: [] });
  const ids = normalizeWorkAmoV5RawIdState({ listings: [], records: [{ id: "alice", ownerAddress: ACTOR, receiveAddress: ACTOR }] });
  const work = normalizeWorkAmoV5RawWorkState({ confirmedSupplyAtoms: "10", holders: [{ address: ACTOR, balanceAtoms: "10" }], listings: [] });
  const economic = {
    baseState: Object.fromEntries(WORK_AMO_V5_BASE_STATE_FIELDS.map((field) => [field, field === "computerEventFlowSats" ? "4200000" : "0"])),
    creditFixedQ8: "0", creditMovementFrozenValueQ8: "0",
    genericTokenStateCommitment: workAmoV5RawGenericStateCommitment(generic),
    idStateCommitment: workAmoV5RawIdStateCommitment(ids),
    model: WORK_AMO_V5_NETWORK_ACCUMULATOR_MODEL, movements: [], network: "livenet",
    networkValueQ8: "2100000000000000", quoteHead: null,
    throughBlockHash: PRIOR_HASH, throughBlockHeight: height - 1,
    tokenStateCommitment: workAmoV5CanonicalTokenStateCommitment(work),
  };
  return { openingEconomicState: economic, openingGenericState: generic, openingIdState: ids, openingWorkState: work };
}

function rawRecords(context) {
  return context.blockTransactions.flatMap((tx, blockTransactionIndex) => {
    const reconstruction = canonicalRawProtocolRecordSetFromTransaction(tx);
    return reconstruction.records.map((record) => ({
      ...record, tx, txid: tx.txid,
      position: {
        blockHash: context.blockHash, blockHeight: context.blockHeight, blockTransactionIndex,
        protocolVout: record.protocolVout, recordOrdinal: record.recordOrdinal,
      },
      rawPayloadHex: record.rawRecordParts.map((part) => part.payloadHex).join(""),
      rawScriptPubKeyHex: record.rawRecordParts[0]?.scriptPubKeyHex ?? "",
      transactionMinerFeeSats: String(FEE),
      transactionProtocolRecordCount: reconstruction.records.length,
    }));
  });
}

function replay(context, overrides = {}) {
  return replayWorkAmoV5RawBlock({
    blockHeaderHex: context.blockHeaderHex, blockTransactions: context.blockTransactions,
    expectedBlockHash: context.blockHash, expectedBlockHeight: context.blockHeight,
    expectedPreviousBlockHash: context.previousBlockHash, records: rawRecords(context),
    ...openingState(context.blockHeight), ...overrides,
  });
}

test("page1 is independently discovered from exact serialized raw blocks, including malformed and invalid UTF-8 companions", () => {
  const invalid = Buffer.concat([Buffer.from(DNS_PAGE_LINK_PREFIX), Buffer.from([0xff])]);
  const context = block([transaction([PAGE, DNS_PAGE_LINK_PREFIX + "bad", invalid])]);
  const envelope = workAmoV5RawBlockDiscoveryEnvelope(context);
  assert.equal(envelope.rawProtocolCandidateCount, 3);
  assert.equal(envelope.records.length, 3);
  assert.equal(envelope.records.every(record => record.protocol === "pwdns1"), true);
  assert.equal(envelope.records[0].message, PAGE);
  assert.equal(envelope.records[2].rawRecordParts[0].decodeValid, false);
  assert.throws(() => replay(context, { records: rawRecords(context).slice(0, 2) }), /record-set-incomplete|record-set|parity/u);
});

test("activated page1 remains independently qualified and adds no WORK economic contribution", () => {
  assert.equal(DNS_PAGE_LINK_ACTIVATION_HEIGHT, 970426);
  assert.equal(parseWorkAmoV5RawPwdnsRecord(PAGE), null, "the independent DNS page-link projection owns authority");
  const context = block([transaction([PAGE])]);
  const before = openingState(context.blockHeight), result = replay(context);
  assert.equal(result.events.length, 1); assert.equal(result.events[0].valid, false);
  assert.deepEqual(result.economicState.baseState, before.openingEconomicState.baseState);
  assert.equal(result.economicState.networkValueQ8, before.openingEconomicState.networkValueQ8);
  assert.equal(result.feeTransitions[0].valid, false); assert.equal(result.feeTransitions[0].creditFixedQ8Added, "0");
  assert.deepEqual(result.workState, before.openingWorkState);
  assert.deepEqual(result.idState, before.openingIdState);
  assert.deepEqual(result.genericState, before.openingGenericState);
});

test("page1 beside ordinary Mail keeps the existing fee-once and self-payment accounting", () => {
  const withPage = replay(block([transaction([PAGE, "pwm1:m:Linked Pages source"]) ]));
  const mailOnly = replay(block([transaction(["pwm1:m:Linked Pages source"]) ]));
  assert.deepEqual(withPage.economicState.baseState, mailOnly.economicState.baseState);
  assert.equal(withPage.economicState.networkValueQ8, mailOnly.economicState.networkValueQ8);
  assert.equal(withPage.feeTransitions.length, 1); assert.equal(mailOnly.feeTransitions.length, 1);
  assert.equal(withPage.economicState.baseState.mailFlowSats, "546");
  assert.equal(withPage.economicState.creditFixedQ8, String(BigInt(FEE) * 100_000_000n));
  assert.deepEqual(withPage.workState, mailOnly.workState);
  assert.deepEqual(withPage.idState, mailOnly.idState);
  assert.deepEqual(withPage.genericState, mailOnly.genericState);
});
