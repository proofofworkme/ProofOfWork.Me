import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { resolveWorkMailBatchReadConfiguration } from "./work-mail-batch-runtime.mjs";
import { normalizeWorkMailBatchDeclarationPins, WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT,
  WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY, WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS,
  workMailBatchDeclarationCommitment, workMailBatchDeclarationEvidenceFromTransaction } from "./work-mail-batch-declaration.mjs";
import { completeWorkMailBatchDeclarationDiscovery } from "./work-mail-batch-selection.mjs";
import { canonicalProtocolCandidateFromOutput } from "./canonical-op-return.mjs";
import { address, networks, script } from "bitcoinjs-lib";
const source = fs.readFileSync(new URL("./proof-api.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function assertWorkMailBatchBroadcastAllowed(");
const end = source.indexOf("\nasync function assertWorkBatchBroadcastAllowed(", start);
assert.ok(start > 0 && end > start);
const functionSource = source.slice(start, end);
const hash = "a".repeat(64);
const ready = { ready: true, checkedTipHeight: 101, checkedTipHash: hash, reasonCode: null };
function fixture(overrides = {}) {
  const seen = { capacity: [], hydration: 0, validations: 0, before: 0, status: 0 };
  const dependencies = {
    signedTransactionOutputs: () => [{ messages: ["pwt1:mailbatch1:fixture"] }],
    decodedOpReturnMessages: ([out]) => out.messages,
    workMailBatchMetadata: async () => { seen.status++; return ready; },
    signedTransactionInputOutpoints: () => [{ txid: "b".repeat(64), vout: 0 }],
    mapWithConcurrency: async (inputs, _count, fn) => Promise.all(inputs.map(fn)),
    fetchTransactionFromBitcoinRpc: async () => { seen.hydration++; return { vout: [{ value: 10000, scriptpubkey: "00" }] }; },
    bitcoin: { Transaction: { fromHex: () => ({ getId: () => hash }) } },
    validateWorkMailBatchV1RawTransaction: () => { seen.validations++; return { valid: true,
      parsed: { totalAmountSubatoms: "780000000000000000" } }; },
    assertCanonicalWorkTransferCapacity: async (...args) => { seen.capacity.push(args); },
    ...overrides,
  };
  const run = Function(...Object.keys(dependencies), `return (${functionSource});`)(...Object.values(dependencies));
  return { run, seen, beforeSubmit: async () => { seen.before++; } };
}

test("legacy nonbatch admission has no new gate, capacity or hydration side effects", async () => {
  const f = fixture({ signedTransactionOutputs: () => [{ messages: ["pwt1:send3:fixture"] }] });
  assert.equal(await f.run("fixture", "livenet"), false);
  assert.equal(f.seen.status + f.seen.hydration + f.seen.validations, 0);
});

test("closed gate prevents hydration and malformed or wrong-network batches fail", async () => {
  const closed = fixture({ workMailBatchMetadata: async () => ({ ready: false, reasonCode: "work-mail-batch-writes-disabled" }) });
  await assert.rejects(closed.run("fixture", "livenet"), error => error.statusCode === 503 && error.details.reasonCode === "work-mail-batch-writes-disabled");
  assert.equal(closed.seen.hydration + closed.seen.validations, 0);
  const wrongNetwork = fixture();
  await assert.rejects(wrongNetwork.run("fixture", "testnet"), error => error.statusCode === 400);
  const duplicate = fixture({ signedTransactionOutputs: () => [
    { messages: ["pwt1:mailbatch1:fixture"] }, { messages: ["pwt1:mailbatch1:second"] }] });
  await assert.rejects(duplicate.run("fixture", "livenet"), error => error.statusCode === 400);
});

test("batch capacity is one exact full sum including self, with fresh tip fences", async () => {
  const f = fixture();
  assert.equal(await f.run("fixture", "livenet", { beforeSubmit: f.beforeSubmit }), true);
  assert.equal(f.seen.before, 1);
  assert.equal(f.seen.hydration, 1);
  assert.equal(f.seen.validations, 1);
  assert.equal(f.seen.status, 2);
  assert.deepEqual(f.seen.capacity, [["fixture", "livenet", [{
    amountSubatoms: "780000000000000000", recipientAddress: "", protocolVout: 0,
  }]]]);
});

test("unknown prevout, invalid signature, insufficient capacity and changed tip reject admission", async () => {
  const unknown = fixture({ fetchTransactionFromBitcoinRpc: async () => null });
  await assert.rejects(unknown.run("fixture", "livenet"), error => error.statusCode === 503);
  const invalid = fixture({ validateWorkMailBatchV1RawTransaction: () => ({ valid: false, reasonCode: "signature-invalid" }) });
  await assert.rejects(invalid.run("fixture", "livenet"), error => error.statusCode === 400 && error.details.reasonCode === "signature-invalid");
  assert.equal(invalid.seen.capacity.length, 0);
  const insufficient = fixture({ assertCanonicalWorkTransferCapacity: async () => { throw new Error("insufficient"); } });
  await assert.rejects(insufficient.run("fixture", "livenet"), /insufficient/u);
  let call = 0;
  const changed = fixture({ workMailBatchMetadata: async () => ({ ...ready, checkedTipHash: ++call === 1 ? hash : "c".repeat(64) }) });
  await assert.rejects(changed.run("fixture", "livenet"), error => error.statusCode === 503 &&
    error.details.reasonCode === "work-mail-batch-tip-changed-during-admission");
});

function isolated(name, nextName, dependencies) {
  const begin = source.indexOf(`async function ${name}(`);
  const finish = source.indexOf(`\nasync function ${nextName}(`, begin);
  assert.ok(begin > 0 && finish > begin);
  return Function(...Object.keys(dependencies), `return (${source.slice(begin, finish)});`)(...Object.values(dependencies));
}

test("persistent activation restores read pins but never enables unconfigured writes", async () => {
  const declaration = normalizeWorkMailBatchDeclarationPins({ txid: hash, blockHeight: 1000000,
    blockHash: "b".repeat(64), blockTransactionIndex: 1, protocolVout: 1,
    recordOrdinal: 0, registryPaymentVout: 0, activationHeight: 1000001 });
  const run = isolated("workMailBatchReadConfiguration", "workMailBatchReplayContext", {
    resolveWorkMailBatchReadConfiguration,
    WORK_MAIL_BATCH_CONFIGURATION: { requested: false, pins: null, writesEnabled: true },
    proofIndexWorkMailBatchActivationMarker: async () => ({ declaration }),
  });
  assert.deepEqual(await run("livenet"), { requested: true, pins: declaration, writesEnabled: false });
  const invalid = isolated("workMailBatchReadConfiguration", "workMailBatchReplayContext", {
    resolveWorkMailBatchReadConfiguration,
    WORK_MAIL_BATCH_CONFIGURATION: { requested: true, pins: null, writesEnabled: true },
    proofIndexWorkMailBatchActivationMarker: async () => ({ declaration }),
  });
  await assert.rejects(invalid("livenet"), /pins-invalid/u);
  const corrupt = isolated("workMailBatchReadConfiguration", "workMailBatchReplayContext", {
    resolveWorkMailBatchReadConfiguration,
    WORK_MAIL_BATCH_CONFIGURATION: { requested: false, pins: null, writesEnabled: false },
    proofIndexWorkMailBatchActivationMarker: async () => { throw new Error("marker-corrupt"); },
  });
  await assert.rejects(corrupt("livenet"), /marker-corrupt/u);
});

test("batch status respects the existing global WORK write pause independently of replay readiness", async () => {
  const configuration = { requested: true, pins: { txid: hash }, writesEnabled: true };
  const activation = { active: true, declaration: { txid: hash }, evidenceCommitment: { sha256: hash } };
  const make = writeAdmission => isolated("workMailBatchMetadata", "workBatchCoreResult", {
    resolveWorkMailBatchReadConfiguration,
    WORK_MAIL_BATCH_CONFIGURATION: configuration,
    workMailBatchReadConfiguration: async () => configuration,
    exactCoreTipFromBlockchainInfo: () => ({ height: 101, blockHash: hash }),
    bitcoinRpc: async () => ({}),
    workMailBatchReplayContext: async () => activation,
    workAmoV8Metadata: async () => ({ protocolReady: true, evidenceComplete: true, indexReady: true,
      tipHeight: 101, tipHash: hash, writeAdmission }),
    proofIndexWorkAmoBlockTransition: async () => ({ payload: { workMailBatchV1: activation } }),
    workMailBatchPublicStatus: value => value,
  });
  const paused = await make(false)("livenet");
  assert.equal(paused.replayReady, true);
  assert.equal(paused.exactTipReady, true);
  assert.equal(paused.reasonCode, "work-mail-batch-work-writes-paused");
  assert.equal((await make(true)("livenet")).reasonCode, null);
});

test("catch-up replay discovers only through H-minus-one and never requires the global tip", async () => {
  const requested = [];
  const pins = { blockHeight: 1000000, activationHeight: 1000001 };
  const run = isolated("workMailBatchReplayContext", "workMailBatchMetadata", {
    workMailBatchReadConfiguration: async (network, maximum, options) => {
      requested.push({ network, maximum }); assert.equal(options.completeDiscovery, true); return { requested: true, pins, writesEnabled: false };
    },
    workMailBatchVerifyDeclarationSelection: async () => {},
    workMailBatchCoreResult: async () => hash,
    loadWorkMailBatchActivation: async options => ({ active: options.blockHeight >= pins.activationHeight }),
    fetchTransactionFromBitcoinRpc: async () => { throw new Error("unexpected hydration"); },
  });
  assert.equal(await run("livenet", 1000000, hash), null);
  assert.equal((await run("livenet", 1000001, hash)).active, true);
  assert.deepEqual(requested, [{ network: "livenet", maximum: 999999 },
    { network: "livenet", maximum: 1000000 }]);
});

test("automatic discovery rejects lagging prefix and fences Core before and after selection", async () => {
  const checkpoint = { complete: true, blockHeight: 1000000, blockHash: hash };
  const run = overrides => isolated("workMailBatchDiscoverDeclaration", "workMailBatchReadConfiguration", {
    proofIndexWorkMailBatchDiscoveryCheckpoint: async () => checkpoint,
    workMailBatchCoreResult: async () => hash,
    discoverWorkMailBatchDeclaration: async () => null,
    workMailBatchSelectionCache: new Map(),
    ...overrides,
  });
  assert.equal(await run({})(1000000), null);
  await assert.rejects(run({})(1000001), /checkpoint-unavailable/u);
  await assert.rejects(run({ workMailBatchCoreResult: async () => "b".repeat(64) })(1000000), /checkpoint-mismatch/u);
  let calls = 0;
  await assert.rejects(run({ workMailBatchCoreResult: async () => ++calls === 1 ? hash : "b".repeat(64) })(1000000), /checkpoint-changed/u);
});

function declarationCandidateFixture(overrides = {}) {
  const height = 1000000, blockHash = "b".repeat(64);
  const txids = ["c".repeat(64), "d".repeat(64), "e".repeat(64)];
  const block = { height, hash: blockHash, tx: txids };
  const candidates = txids.map((txid, blockTransactionIndex) => ({ txid, blockHeight: height,
    blockHash, blockTransactionIndex }));
  const hydrated = [];
  const transaction = txid => ({ txid, _powCanonicalRpcHydration: true,
    status: { confirmed: true, block_height: height, block_hash: blockHash },
    vin: [{ prevout: { value: 10000, scriptpubkey: txid === txids[1] ? "51" :
      WORK_MAIL_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY } }],
    vout: [
      { value: 546, scriptpubkey_address: WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS,
        scriptpubkey: Buffer.from(address.toOutputScript(WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS, networks.bitcoin)).toString("hex") },
      { value: 0, scriptpubkey: Buffer.from(script.compile([106,
        Buffer.from(workMailBatchDeclarationCommitment().protocolRecord)])).toString("hex") },
    ],
  });
  const validate = isolated("workMailBatchValidateDeclarationCandidate", "workMailBatchVerifyDeclarationSelection", {
    workMailBatchDeclarationCommitment, WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT,
    workMailBatchCoreResult: async method => method === "getblock" ? block : blockHash,
    fetchTransactionFromBitcoinRpc: async txid => {
      hydrated.push(txid);
      if (txid === txids[0]) throw new Error("coinbase cannot use generic prevout hydration");
      return transaction(txid);
    },
    transactionBlockHash: tx => tx.status.block_hash,
    canonicalProtocolCandidateFromOutput,
    addressFromVout: output => output.scriptpubkey_address,
    WORK_TOKEN_DEFAULT_REGISTRY_ADDRESS: WORK_MAIL_BATCH_DECLARATION_REGISTRY_ADDRESS,
    workMailBatchDeclarationEvidenceFromTransaction,
    ...overrides,
  });
  return { validate, candidates, block, blockHash, height, txids, hydrated };
}

test("canonical coinbase and non-address public copies cannot block a later authority declaration", async () => {
  const f = declarationCandidateFixture();
  const selected = await completeWorkMailBatchDeclarationDiscovery({
    checkpoint: { blockHeight: f.height, blockHash: f.blockHash },
    readCandidates: async () => ({ candidates: f.candidates, complete: true, overflow: false,
      scan: { complete: true, indexedThroughBlock: f.height, blockHash: f.blockHash } }),
    validateCandidate: candidate => f.validate(candidate, f.height),
  });
  assert.equal(selected.txid, f.txids[2]);
  assert.deepEqual(f.hydrated, f.txids.slice(1));
});

test("coinbase exemption requires exact Core position, hash and canonical evidence", async () => {
  const f = declarationCandidateFixture();
  await assert.rejects(f.validate({ ...f.candidates[1], blockTransactionIndex: 0 }, f.height), /canonical-mismatch/u);
  await assert.rejects(f.validate({ ...f.candidates[0], blockHash: "f".repeat(64) }, f.height), /canonical-mismatch/u);
  await assert.rejects(f.validate({ ...f.candidates[0], blockHeight: f.height + 1 }, f.height + 1), /canonical-mismatch/u);
  assert.equal(f.hydrated.length, 0);
  const reorged = declarationCandidateFixture({ workMailBatchCoreResult: async method =>
    method === "getblock" ? f.block : "f".repeat(64) });
  await assert.rejects(reorged.validate(f.candidates[0], f.height), /canonical-mismatch/u);
  const missing = declarationCandidateFixture({ workMailBatchCoreResult: async () => { throw new Error("Core unavailable"); } });
  await assert.rejects(missing.validate(f.candidates[0], f.height), /Core unavailable/u);
  const prevoutMissing = declarationCandidateFixture({ fetchTransactionFromBitcoinRpc: async () => {
    throw new Error("canonical prevout unavailable"); } });
  await assert.rejects(prevoutMissing.validate(f.candidates[1], f.height), /prevout unavailable/u);
});

test("configured later duplicate cannot make D-plus-one replay use prebatch rules", async () => {
  const declaration = normalizeWorkMailBatchDeclarationPins({ txid: hash, blockHeight: 1000000,
    blockHash: "b".repeat(64), blockTransactionIndex: 1, protocolVout: 1,
    recordOrdinal: 0, registryPaymentVout: 0, activationHeight: 1000001 });
  const later = normalizeWorkMailBatchDeclarationPins({ ...declaration, txid: "e".repeat(64),
    blockHeight: 1000010, blockHash: "f".repeat(64), activationHeight: 1000011 });
  let discovered = 0;
  const replay = isolated("workMailBatchReplayContext", "workMailBatchMetadata", {
    workMailBatchReadConfiguration: async (_network, maximumBlockHeight) => resolveWorkMailBatchReadConfiguration({
      configuration: { requested: true, pins: later, writesEnabled: true }, maximumBlockHeight,
      readMarker: async () => null,
      discover: async () => { discovered++; return declaration; },
    }),
  });
  await assert.rejects(replay("livenet", declaration.activationHeight, "c".repeat(64)), /not-earliest/u);
  assert.equal(discovered, 1);
});

test("actual GET handler resolves batch status network before later route-local declarations", async () => {
  const begin = source.indexOf("async function handleRequest(request, response) {");
  const finish = source.indexOf("\nconst server = http.createServer", begin);
  const parserStart = source.indexOf("function networkFromSearch(searchParams) {");
  const parserEnd = source.indexOf("\nfunction freshReadRequested", parserStart);
  assert.ok(begin > 0 && finish > begin && parserStart > 0 && parserEnd > parserStart);
  const networkFromSearch = Function("NETWORKS", `return (${source.slice(parserStart, parserEnd)});`)(
    new Set(["livenet", "testnet"]));
  const requests = [];
  const dependencies = {
    networkFromSearch,
    workMailBatchMetadata: async network => { requests.push(network); return { protocol: "work-mail-batch-v1", network }; },
    jsonResponse: (response, status, body, cache) => Object.assign(response, { status, body, cache }),
    errorResponse: (response, status, message) => Object.assign(response, { status, message }),
    console: { error: () => {} },
  };
  const handler = Function(...Object.keys(dependencies), `return (${source.slice(begin, finish)});`)(
    ...Object.values(dependencies));
  for (const [query, network] of [["", "livenet"], ["?network=livenet", "livenet"], ["?network=testnet", "testnet"]]) {
    const response = {};
    await handler({ method: "GET", url: "/api/v1/work-mail-batch-status" + query,
      headers: { host: "localhost" } }, response);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { protocol: "work-mail-batch-v1", network });
    assert.equal(response.cache, "no-store");
  }
  assert.deepEqual(requests, ["livenet", "livenet", "testnet"]);
});
