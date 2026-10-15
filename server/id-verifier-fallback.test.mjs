import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import * as bitcoin from "bitcoinjs-lib";
import ts from "typescript";
import { canonicalProtocolCandidateFromOutput } from "./canonical-op-return.mjs";
import { workAmoV5HasNoTextStorageNul } from "./work-amo-v5.mjs";

// Extract the production parser and verifier without starting the API or a DB.
const source = readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
const parsedSource = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true);
const functions = new Map(parsedSource.statements.filter(ts.isFunctionDeclaration)
  .map(node => [node.name.text, node.getText(parsedSource)]));
const constants = new Map(parsedSource.statements.filter(ts.isVariableStatement)
  .flatMap(node => node.declarationList.declarations)
  .map(node => [node.name.getText(parsedSource), node.initializer?.getText(parsedSource)]));
const TXID = "a".repeat(64);
const OTHER_TXID = "b".repeat(64);
const ADDRESS = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const ID = Buffer.from("satsfund").toString("base64url");
const REGISTRATION = `pwid1:r2:${ID}:${ADDRESS}:${ADDRESS}`;
const MALFORMED_REASON = "Malformed ProofOfWork ID protocol payload.";
const PAYMENT_REASON = "Required ProofOfWork ID registry payment is missing or misplaced.";

function transaction(messages = [REGISTRATION], { payment = 1000, paymentAfter = false } = {}) {
  const carriers = messages.map(message => {
    const script = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from(message)]);
    return { value: 0, scriptpubkey: Buffer.from(script).toString("hex"),
      scriptpubkey_type: "op_return", scriptpubkey_asm: bitcoin.script.toASM(script) };
  });
  const paid = { value: payment, scriptpubkey_address: ADDRESS,
    scriptpubkey: Buffer.from(bitcoin.address.toOutputScript(ADDRESS)).toString("hex") };
  return { txid: TXID, status: { confirmed: false },
    vout: paymentAfter ? [...carriers, paid] : [paid, ...carriers] };
}

function runtime(tx, { bundle = { state: { activity: [], sales: [], listings: [] }, transactions: [] },
  rpcFailure = false, bundleFailure = false, duplicate = null } = {}) {
  let rpcReads = 0;
  const context = vm.createContext({
    Buffer, bitcoin, canonicalProtocolCandidateFromOutput, workAmoV5HasNoTextStorageNul,
    BITCOIN_ADDRESS_VALIDATION_CACHE: new Map(), BITCOIN_ADDRESS_VALIDATION_CACHE_MAX: 20_000,
    INTERNAL_VERIFIER_STATE_CACHE: new Map(), WORK_AMO_V5_ACTIVATION_HEIGHT: 959621,
    registryAddressForNetwork: () => ADDRESS,
    cachedInternalVerifierState: async (_key, loader) => loader(),
    idVerifierStateBundle: async () => {
      if (bundleFailure) throw new Error("Registry hydration unavailable.");
      return bundle;
    },
    canonicalPublicReadGate: async (_network, options) => {
      assert.equal(options.force, true);
      return duplicate ? duplicate.gates.shift() ?? duplicate.gate : { ok: false };
    },
    proofIndexIdRecordPayload: async (_network, id) => duplicate?.records?.[id] ?? null,
    canonicalBlockHashAtHeight: async height => duplicate?.blockHashes?.[height] ?? "",
    bitcoinRpc: async (method, args) => {
      assert.equal(method, "getmempoolentry");
      assert.equal(args[0], duplicate?.target?.txid);
      return duplicate?.membership ?? { ok: false };
    },
    fetchTransactionFromBitcoinRpc: async (txid, _network, options) => {
      rpcReads += 1;
      if (rpcFailure) throw new Error("Core unavailable.");
      if (duplicate && options) {
        assert.equal(options.bypassCache, true);
        assert.equal(options.cacheResult, false);
        assert.equal(options.includeRawHex, true);
        assert.equal(options.includePrevouts, false);
        return duplicate.raw[txid] ?? null;
      }
      return tx;
    },
  });
  const names = [
    "bitcoinNetwork", "isValidBitcoinAddress", "normalizePowId", "base64FromBase64Url",
    "base64UrlDecodeBytes", "decodeTextBase64Url", "decodeHex", "decodedOpReturnMessages",
    "decodedProtocolMessages", "firstRegistryProtocolOutputIndex", "firstIdProtocolOutputIndex",
    "paymentAmountBeforeIdProtocol", "parseIdRegistrationPayload", "parseIdReceiverUpdatePayload",
    "parseIdTransferPayload", "parseIdMarketplaceTransferPayload", "parseIdListingPayload",
    "parseIdSaleSealPayload", "parseIdDelistingPayload", "parseIdEventPayload",
    "transactionTxid", "transactionConfirmed", "transactionBlockHeight", "transactionBlockHash", "indexedThroughBlockFromTransactions",
    "exactVerifierPositionInteger", "canonicalVerifierItemPosition", "idVerifierItemsFromState",
    "idVerifierDeterministicInvalidReason", "idVerifierPendingDuplicateEvidence", "idVerifierPayload",
  ];
  const constantNames = ["ID_PROTOCOL_PREFIX", "ID_REGISTRATION_PRICE_SATS", "ID_MUTATION_PRICE_SATS"];
  vm.runInContext([
    ...constantNames.map(name => { assert.ok(constants.has(name)); return `const ${name} = ${constants.get(name)};`; }),
    ...names.map(name => { assert.ok(functions.has(name)); return functions.get(name); }),
  ].join("\n"), context);
  return { api: context, rpcReads: () => rpcReads };
}

async function invalidReason(tx, options) {
  return runtime(tx, options).api.idVerifierDeterministicInvalidReason("livenet", {}, TXID, false);
}

function unresolved(error) {
  return error.statusCode === 503 && error.details?.code === "ID_VERIFIER_UNRESOLVED" &&
    error.details.txid === TXID;
}

test("valid prefixed historical/current registrations and mutations are not malformed", async () => {
  for (const [message, payment] of [
    [`pwid1:r:satsfund:${ADDRESS}:${ADDRESS}`, 1000], [REGISTRATION, 1000],
    [`pwid1:u:${ID}:${ADDRESS}`, 546], [`pwid1:t:${ID}:${ADDRESS}:${ADDRESS}`, 546],
  ]) {
    assert.equal(await invalidReason(transaction([message], { payment })), "", message);
  }
});

test("malformed payloads and invalid addresses still have deterministic rejection", async () => {
  for (const message of ["pwid1:r2:broken", `pwid1:r2:${ID}:invalid:${ADDRESS}`, "pwid1:unsupported:record"]) {
    assert.equal(await invalidReason(transaction([message])), MALFORMED_REASON);
  }
});

test("registry fees remain exact per carrier and must precede the protocol", async () => {
  for (const tx of [transaction([REGISTRATION], { payment: 999 }),
    transaction([REGISTRATION], { paymentAfter: true }),
    transaction([REGISTRATION, REGISTRATION], { payment: 1000 }),
    transaction([`pwid1:u:${ID}:${ADDRESS}`], { payment: 545 })]) {
    assert.equal(await invalidReason(tx), PAYMENT_REASON);
  }
  assert.equal(await invalidReason(transaction([REGISTRATION, REGISTRATION], { payment: 2000 })), "");
});

test("missing raw evidence or a different protocol cannot establish invalid ID state", async () => {
  assert.equal(await invalidReason(null), "");
  assert.equal(await invalidReason(null, { rpcFailure: true }), "");
  assert.equal(await invalidReason(transaction([`pwdns1:r1:${ID}:${ADDRESS}:${ADDRESS}`])), "");
});

test("a valid pending target omitted from cached state remains retryable, never terminal invalid", async () => {
  const tx = transaction();
  for (const transactions of [[], [tx], [{ ...tx, txid: OTHER_TXID }]]) {
    const bundle = { state: { activity: [], sales: [], listings: [] }, transactions };
    const { api } = runtime(tx, { bundle });
    await assert.rejects(api.idVerifierPayload("livenet", TXID), unresolved);
  }
});

test("unavailable Core or registry hydration cannot produce a terminal-invalid response", async () => {
  const unavailableCore = runtime(null, { rpcFailure: true });
  await assert.rejects(unavailableCore.api.idVerifierPayload("livenet", TXID), unresolved);
  const unavailableBundle = runtime(transaction(), { bundleFailure: true });
  await assert.rejects(unavailableBundle.api.idVerifierPayload("livenet", TXID), /Registry hydration unavailable/u);
  assert.equal(unavailableBundle.rpcReads(), 0);
});

test("proven malformed or unpaid pending targets still return invalid verifier evidence", async () => {
  for (const [tx, expected] of [[transaction(["pwid1:r2:broken"]), MALFORMED_REASON],
    [transaction([REGISTRATION], { payment: 999 }), PAYMENT_REASON]]) {
    const { api } = runtime(tx);
    const result = await api.idVerifierPayload("livenet", TXID);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].kind, "id-event-invalid");
    assert.equal(result.items[0].valid, false);
    assert.equal(result.items[0].confirmed, false);
    assert.equal(result.items[0].reason, expected);
  }
});

test("an accepted pending target retains its exact evidence without invoking fallback", async () => {
  const item = { txid: TXID, kind: "id-register", confirmed: false, valid: true,
    id: "satsfund", ownerAddress: ADDRESS, receiveAddress: ADDRESS,
    protocolVout: 1, recordOrdinal: 0, createdAt: "2026-09-16T12:00:00.000Z" };
  const bundle = { state: { activity: [item], sales: [], listings: [] }, transactions: [transaction()] };
  const { api, rpcReads } = runtime(null, { bundle, rpcFailure: true });
  const result = await api.idVerifierPayload("livenet", TXID);
  assert.equal(result.items.length, 1);
  for (const [key, value] of Object.entries(item)) assert.equal(result.items[0][key], value, key);
  assert.equal(rpcReads(), 0);
});

const captured = JSON.parse(readFileSync(new URL("./fixtures/id-pending-duplicate-20261015.json", import.meta.url)));
function capturedTransaction(row, confirmed) {
  const raw = bitcoin.Transaction.fromHex(row.hex);
  assert.equal(raw.getId(), row.txid, "captured bytes bind the exact transaction");
  return { txid: row.txid, hex: row.hex,
    status: { confirmed, ...(confirmed ? { block_hash: row.blockHash, block_height: row.blockHeight } : {}) },
    vout: raw.outs.map(output => {
      const script = Buffer.from(output.script);
      let address = "";
      try { address = bitcoin.address.fromOutputScript(script); } catch { /* OP_RETURN */ }
      return { value: Number(output.value), scriptpubkey: script.toString("hex"),
        scriptpubkey_asm: bitcoin.script.toASM(script),
        scriptpubkey_type: script[0] === bitcoin.opcodes.OP_RETURN ? "op_return" : "address",
        scriptpubkey_address: address };
    }) };
}
function duplicateRuntime(change = () => {}) {
  const target = capturedTransaction(captured.target, false);
  const winner = capturedTransaction(captured.winner, true);
  const gate = { ok: true, atTip: true, indexedThroughBlock: captured.checkpoint.height,
    tipHeight: captured.checkpoint.height, canonicalHash: captured.checkpoint.blockHash,
    storedHash: captured.checkpoint.blockHash, ready: false, workerOk: false };
  const duplicate = { target, raw: { [target.txid]: target, [winner.txid]: winner },
    gate, gates: [], membership: { ok: true, result: { time: 1783076761 } },
    blockHashes: { [captured.winner.blockHeight]: captured.winner.blockHash },
    records: { ai: { records: [{ id: "ai", txid: winner.txid, confirmed: true, network: "livenet",
      blockHeight: captured.winner.blockHeight, blockHash: captured.winner.blockHash }] } } };
  change(duplicate);
  const { api } = runtime(target, { duplicate });
  api.registryAddressForNetwork = () => captured.registryAddress;
  return { api, duplicate };
}
const duplicateUnresolved = error => error.statusCode === 503 &&
  error.details?.code === "ID_VERIFIER_UNRESOLVED" && error.details.txid === captured.target.txid;

test("exact captured paid ai duplicate is invalid only against a complete stable confirmed winner", async () => {
  const { api } = duplicateRuntime();
  const result = await api.idVerifierPayload("livenet", captured.target.txid);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.valid, false);
  assert.equal(item.confirmed, false);
  assert.equal(item.kind, "id-event-invalid");
  assert.equal(item.protocol, "pwid1");
  assert.equal(item.protocolVout, 1);
  assert.equal(item.recordOrdinal, 0);
  assert.equal(item.id, "ai");
  assert.match(item.payload, /^pwid1:r2:YWk:/);
  assert.match(item.reason, /duplicates an existing confirmed registration/);
  assert.equal(item.duplicateRegistrationEvidence.targetTxid, captured.target.txid);
  assert.equal(item.duplicateRegistrationEvidence.indexedThroughBlock, captured.checkpoint.height);
  assert.equal(item.duplicateRegistrationEvidence.indexedThroughBlockHash, captured.checkpoint.blockHash);
  assert.equal(item.duplicateRegistrationEvidence.winners[0].txid, captured.winner.txid);
  assert.equal(item.duplicateRegistrationEvidence.winners[0].id, "ai");
});

for (const [name, change] of [
  ["incomplete coverage", d => { d.gate.ok = false; }],
  ["canonical lag", d => { d.gate.atTip = false; }],
  ["opening checkpoint mismatch", d => { d.gate.storedHash = "c".repeat(64); }],
  ["missing winner coverage", d => { d.records = {}; }],
  ["pending competitor", d => { d.records.ai.records[0].confirmed = false; }],
  ["winner from another network", d => { d.records.ai.records[0].network = "testnet"; }],
  ["wrong winner name", d => { d.records.ai.records[0].id = "other"; }],
  ["missing target raw bytes", d => { delete d.raw[captured.target.txid]; }],
  ["wrong raw target txid", d => { d.raw[captured.target.txid] = { ...d.target, txid: OTHER_TXID }; }],
  ["target already confirmed", d => { d.target.status.confirmed = true; }],
  ["target left mempool", d => { d.membership = { ok: false }; }],
  ["missing raw winner", d => { delete d.raw[captured.winner.txid]; }],
  ["raw winner unconfirmed", d => { d.raw[captured.winner.txid].status.confirmed = false; }],
  ["wrong raw winner txid", d => { d.raw[captured.winner.txid].txid = OTHER_TXID; }],
  ["winner orphaned", d => { d.blockHashes[captured.winner.blockHeight] = "d".repeat(64); }],
  ["winner after checkpoint", d => { d.records.ai.records[0].blockHeight = d.gate.tipHeight + 1; }],
  ["winner block hash missing", d => { delete d.records.ai.records[0].blockHash; }],
  ["tip changed during reads", d => { d.gates = [d.gate, { ...d.gate, tipHeight: d.gate.tipHeight + 1, indexedThroughBlock: d.gate.tipHeight + 1 }]; }],
  ["same-height reorg during reads", d => { d.gates = [d.gate, { ...d.gate, storedHash: "e".repeat(64), canonicalHash: "e".repeat(64) }]; }],
  ["closing coverage incomplete", d => { d.gates = [d.gate, { ...d.gate, ok: false }]; }],
]) {
  test(`duplicate fallback remains unresolved for ${name}`, async () => {
    const { api } = duplicateRuntime(change);
    await assert.rejects(api.idVerifierPayload("livenet", captured.target.txid), duplicateUnresolved);
  });
}

test("mixed registration/mutation and duplicate/new-name carriers never become blanket invalid", async () => {
  for (const message of [`pwid1:u:YWk:${ADDRESS}`, `pwid1:r2:bmV3:${ADDRESS}:${ADDRESS}`]) {
    const { api } = duplicateRuntime(d => {
      const extra = transaction([message]).vout[1];
      d.target.vout.push(extra);
      d.target.vout[0].value = 2000;
    });
    await assert.rejects(api.idVerifierPayload("livenet", captured.target.txid), duplicateUnresolved);
  }
});

test("a raw winner without the matching registration or payment proves no duplicate", async () => {
  for (const change of [d => { d.raw[captured.winner.txid].vout = []; },
    d => { d.raw[captured.winner.txid].vout[0].value = 999; }]) {
    const { api } = duplicateRuntime(change);
    await assert.rejects(api.idVerifierPayload("livenet", captured.target.txid), duplicateUnresolved);
  }
});

function coreHydrationRuntime(raw) {
  const context = vm.createContext({
    Buffer, bitcoin, TRANSACTION_CACHE: new Map(), declarationHydrationAuthority: Symbol("declaration"),
    WORK_AMO_V5_DECLARATION_TXID: "", WORK_AMO_V6_DECLARATION_TXID: "", TX_FETCH_CONCURRENCY: 2,
    bitcoinRpcHydrationProducer: value => value,
    bitcoinRpc: async method => method === "getrawtransaction" ? { ok: true, result: raw }
      : { ok: true, result: { time: 1783076761 } },
    mapWithConcurrencyStopAndDrain: async (items, _limit, project) => Promise.all(items.map(project)),
  });
  vm.runInContext(["coreScriptTypeToMempoolType", "coreVoutToMempoolVout", "fetchTransactionFromBitcoinRpc"]
    .map(name => functions.get(name)).join("\n"), context);
  return context;
}
function capturedCoreRaw() {
  const tx = bitcoin.Transaction.fromHex(captured.target.hex);
  const normalized = capturedTransaction(captured.target, false);
  return { txid: tx.getId(), hex: captured.target.hex, version: tx.version, locktime: tx.locktime,
    vin: tx.ins.map(input => ({ txid: Buffer.from(input.hash).reverse().toString("hex"),
      vout: input.index, sequence: input.sequence, scriptSig: { hex: Buffer.from(input.script).toString("hex") } })),
    vout: normalized.vout.map(output => ({ value: output.value / 100_000_000,
      scriptPubKey: { hex: output.scriptpubkey, asm: output.scriptpubkey_asm,
        address: output.scriptpubkey_address, type: output.scriptpubkey_type === "op_return" ? "nulldata" : "witness_v0_keyhash" } })) };
}
test("duplicate evidence uses production Core hydration that binds raw bytes and every verbose output", async () => {
  const options = { bypassCache: true, cacheResult: false, includePrevouts: false, includeRawHex: true };
  const correct = await coreHydrationRuntime(capturedCoreRaw()).fetchTransactionFromBitcoinRpc(
    captured.target.txid, "livenet", options);
  assert.equal(correct.txid, captured.target.txid);
  assert.equal(correct.hex, captured.target.hex);
  assert.equal(correct.vout[0].value, 1000);
  for (const mutate of [raw => { delete raw.hex; }, raw => { raw.hex = "malformed"; },
    raw => { raw.hex = captured.winner.hex; }, raw => { raw.txid = OTHER_TXID; },
    raw => { raw.vout[0].value = 0; }, raw => { raw.vout[1].scriptPubKey.hex = "6a"; },
    raw => { raw.vin[0].txid = OTHER_TXID; }]) {
    const raw = capturedCoreRaw();
    mutate(raw);
    await assert.rejects(coreHydrationRuntime(raw).fetchTransactionFromBitcoinRpc(
      captured.target.txid, "livenet", options), /raw transaction bytes/);
  }
});


test("a duplicate mixed with any other OP_RETURN protocol remains unresolved without a generic invalid match", async () => {
  for (const message of ["pwt1:send3:token:owner:1", "pwdns1:r1:YWk:owner:owner", "pwm1:m:job", "pwid1:r2:YWk:owner:owner"]) {
    const { api } = duplicateRuntime(d => {
      d.target.vout.unshift(transaction([message]).vout[1]);
    });
    // Test the new witness directly: the prior malformed/payment fallback has
    // its own historical behavior and is outside this duplicate-only repair.
    assert.equal(await api.idVerifierPendingDuplicateEvidence("livenet", captured.target.txid), null);
  }
});

test("ID plus WORK, DNS or Mail before the ID carrier does not produce a duplicate invalid item", async () => {
  for (const message of ["pwt1:send3:token:owner:1", "pwdns1:r1:YWk:owner:owner", "pwm1:m:job"]) {
    const { api } = duplicateRuntime(d => {
      d.target.vout.unshift(transaction([message]).vout[1]);
    });
    await assert.rejects(api.idVerifierPayload("livenet", captured.target.txid), duplicateUnresolved);
  }
});
