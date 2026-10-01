import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import {
  DNS_SUBDOMAIN_ACTIVATION_HEIGHT,
  DNS_SUBDOMAIN_PREFIX,
  buildDnsSubdomainPayload,
} from "../src/shared/protocol/dnsSubdomains.mjs";
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
const HEIGHT = Math.max(WORK_AMO_V5_ACTIVATION_HEIGHT + 40, DNS_SUBDOMAIN_ACTIVATION_HEIGHT);
const FEE = 11;
const CHILD = buildDnsSubdomainPayload({
  action: "create", parent: "alice", label: "abc",
  epoch: { txid: "33".repeat(32), protocolVout: 1, recordOrdinal: 0 },
  resolver: null,
}, { validateAddress: isWorkAmoV5LivenetAddress });
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

test("typed child parser accepts canonical sub1 and does not mistake it for a root mutation", () => {
  const parsed = parseWorkAmoV5RawPwdnsRecord(CHILD);
  assert.equal(parsed.kind, "dns-subdomain-create");
  assert.equal(parsed.id, "abc.alice");
  assert.equal(parsed.epoch.txid, "33".repeat(32));
  assert.equal(parseWorkAmoV5RawPwdnsRecord(DNS_SUBDOMAIN_PREFIX + "malformed"), null);
});

test("complete serialized block discovery binds child candidates and the BIP141 witness", () => {
  const context = block([transaction([CHILD])]);
  const envelope = workAmoV5RawBlockDiscoveryEnvelope(context);
  assert.equal(envelope.blockTransactionCount, 2);
  assert.equal(envelope.rawProtocolCandidateCount, 1);
  assert.equal(envelope.records.length, 1);
  assert.equal(envelope.records[0].message, CHILD);
  assert.equal(envelope.records[0].protocol, "pwdns1");
  assert.equal(envelope.records[0].protocolVout, 1);
  assert.equal(envelope.records[0].recordOrdinal, 0);
  assert.equal(envelope.records[0].blockTransactionIndex, 1);
  assert.equal(envelope.records[0].txid, context.blockTransactions[1].txid);
  assert.match(envelope.blockDescriptorCommitment.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(envelope.bip141Witness.required, true);
  assert.equal(envelope.bip141Witness.witnessTransactionCount, 2);
  assert.deepEqual(envelope.blockDescriptorCommitment, workAmoV5RawBlockDiscoveryEnvelope(structuredClone(context)).blockDescriptorCommitment);
  const changed = block([transaction([CHILD.replace("sub1:", "sub2:")])]);
  assert.notDeepEqual(envelope.blockDescriptorCommitment, workAmoV5RawBlockDiscoveryEnvelope(changed).blockDescriptorCommitment);
});

test("omitted, reordered or mutated serialized transactions cannot produce a complete discovery receipt", () => {
  const context = block([transaction([CHILD])]);
  assert.throws(() => workAmoV5RawBlockDiscoveryEnvelope({ ...context, blockTransactions: context.blockTransactions.slice(0, 1) }), /witness-commitment-mismatch|header-witness-mismatch/u);
  assert.throws(() => workAmoV5RawBlockDiscoveryEnvelope({ ...context, blockTransactions: [...context.blockTransactions].reverse() }), /coinbase-invalid/u);
  const valueMutation = structuredClone(context);
  valueMutation.blockTransactions[1].vout[0].value = "547";
  assert.throws(() => workAmoV5RawBlockDiscoveryEnvelope(valueMutation), /serialized-transaction-witness-mismatch/u);
  const witnessMutation = structuredClone(context);
  witnessMutation.blockTransactions[1].vin[0].txinwitness = ["77".repeat(32)];
  witnessMutation.blockTransactions[1] = serialize(witnessMutation.blockTransactions[1]);
  assert.equal(witnessMutation.blockTransactions[1].txid, context.blockTransactions[1].txid);
  assert.throws(() => workAmoV5RawBlockDiscoveryEnvelope(witnessMutation), /witness-commitment-mismatch/u);
  const wrongHash = { ...context, blockHash: "88".repeat(32) };
  assert.throws(() => workAmoV5RawBlockDiscoveryEnvelope(wrongHash), /header-witness-mismatch/u);
});

test("discovery includes malformed sub1 carriers and cannot certify a truncated candidate replay", () => {
  const context = block([transaction([CHILD, DNS_SUBDOMAIN_PREFIX + "bad"]) ]);
  const discovered = workAmoV5RawBlockDiscoveryEnvelope(context);
  assert.equal(discovered.rawProtocolCandidateCount, 2);
  assert.equal(discovered.records.length, 2);
  const records = rawRecords(context);
  assert.throws(() => replay(context, { records: records.slice(0, 1) }), /record-set-incomplete|record-set|parity/u);
  assert.equal(replay(context).events.every((event) => !event.valid), true);
  const invalidUtf8Carrier = Buffer.concat([Buffer.from(DNS_SUBDOMAIN_PREFIX), Buffer.from([0xff])]);
  const invalidUtf8 = replay(block([transaction([CHILD, invalidUtf8Carrier])]));
  assert.equal(invalidUtf8.events.every((event) => !event.valid), true, "A malformed UTF-8 sub1 carrier still counts against the single-carrier rule.");
});

test("typed child admission follows the activation pin without changing economics, WORK, IDs or generic assets", () => {
  const context = block([transaction([CHILD])]);
  const before = openingState(context.blockHeight);
  const result = replay(context);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].valid, DNS_SUBDOMAIN_ACTIVATION_HEIGHT > 0);
  assert.equal(result.events[0].semanticKind, "dns-subdomain-create");
  assert.deepEqual(result.economicState.baseState, before.openingEconomicState.baseState);
  assert.equal(result.economicState.networkValueQ8, before.openingEconomicState.networkValueQ8);
  assert.equal(result.feeTransitions.length, 1);
  assert.equal(result.feeTransitions[0].valid, false);
  assert.equal(result.feeTransitions[0].creditFixedQ8Added, "0");
  assert.deepEqual(result.workState, before.openingWorkState);
  assert.deepEqual(result.idState, before.openingIdState);
  assert.deepEqual(result.genericState, before.openingGenericState);
  assert.deepEqual(result.tokenStateCommitment, before.openingEconomicState.tokenStateCommitment);
  assert.deepEqual(result.idStateCommitment, before.openingEconomicState.idStateCommitment);
  assert.deepEqual(result.genericTokenStateCommitment, before.openingEconomicState.genericTokenStateCommitment);
  assert.equal(result.derivedEventCount, 0);
  if (DNS_SUBDOMAIN_ACTIVATION_HEIGHT > 0) {
    assert.equal([...result.outcomes.values()][0].chargesTransactionFee, false);
    assert.equal(result.events[0].output.authorAddress, ACTOR);
    assert.deepEqual(result.events[0].stateDelta.economicOutputs, []);
  }
});

test("a child beside ordinary self-mail neither claims that payment twice nor adds a second miner fee", () => {
  const withChild = replay(block([transaction([CHILD, "pwm1:m:abc.alice.pow"]) ]));
  const mailOnly = replay(block([transaction(["pwm1:m:abc.alice.pow"]) ]));
  assert.deepEqual(withChild.economicState.baseState, mailOnly.economicState.baseState);
  assert.equal(withChild.economicState.networkValueQ8, mailOnly.economicState.networkValueQ8);
  assert.equal(withChild.feeTransitions.length, 1);
  assert.equal(mailOnly.feeTransitions.length, 1);
  assert.equal(withChild.economicState.baseState.computerEventFlowSats, "4200000");
  assert.equal(withChild.economicState.baseState.mailFlowSats, "546");
  assert.equal(withChild.economicState.creditFixedQ8, String(BigInt(FEE) * 100_000_000n));
  assert.equal(withChild.events.filter((event) => event.protocol === "pwm1").length, 1);
  assert.deepEqual(withChild.idState, mailOnly.idState);
  assert.deepEqual(withChild.workState, mailOnly.workState);
  assert.deepEqual(withChild.genericState, mailOnly.genericState);
});

test("structural raw admission rejects another recipient, mixed authors and underpayment", () => {
  for (const tx of [transaction([CHILD], { outputAddress: OTHER }), transaction([CHILD], { secondActor: OTHER }), transaction([CHILD], { value: 545 })]) {
    const result = replay(block([tx]));
    assert.equal(result.events[0].valid, false);
    assert.equal(result.feeTransitions.length, 1);
    assert.equal(result.feeTransitions[0].valid, false);
    assert.equal(result.feeTransitions[0].creditFixedQ8Added, "0");
    assert.equal(result.events[0].reasonCode, "dns-subdomain-carrier-not-admitted");
  }
  if (DNS_SUBDOMAIN_ACTIVATION_HEIGHT > WORK_AMO_V5_ACTIVATION_HEIGHT) {
    assert.equal(replay(block([transaction([CHILD])], DNS_SUBDOMAIN_ACTIVATION_HEIGHT - 1)).events[0].valid, false);
  }
});
