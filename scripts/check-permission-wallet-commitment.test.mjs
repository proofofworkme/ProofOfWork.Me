import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import * as permissionSchema from "../src/shared/protocol/permissions.mjs";

bitcoin.initEccLib(ecc);
async function loadClient(relative, imports = {}, globals = {}) {
  const source = await readFile(new URL(`../${relative}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }, fileName: relative }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === "buffer") return { Buffer };
    throw new Error(`Unexpected test dependency: ${name}`);
  }, Buffer, Uint8Array, AbortController, DOMException, TextEncoder, TextDecoder,
  URLSearchParams, setTimeout, clearTimeout, ...globals }, { filename: relative });
  return exports;
}
const numeric = await loadClient("src/features/boost/boostNumeric.ts");
const utxos = await loadClient("src/walletUtxos.ts");
// Public deterministic disposable fixtures; no connected wallet or owner key is used.
const fixtureSecret = Buffer.alloc(32, 7), foreignSecret = Buffer.alloc(32, 8);
const publicKey = ecc.pointFromScalar(fixtureSecret, true), foreignKey = ecc.pointFromScalar(foreignSecret, true);
const owner = bitcoin.payments.p2pkh({ pubkey: publicKey });
const foreign = bitcoin.payments.p2pkh({ pubkey: foreignKey });
const witnessOwner = bitcoin.payments.p2wpkh({ pubkey: publicKey });
const taprootOwner = bitcoin.payments.p2tr({ internalPubkey: publicKey.subarray(1) });
const testnetOwner = bitcoin.payments.p2pkh({ pubkey: publicKey, network: bitcoin.networks.testnet });
const record = "pwm1:m:pwperm1:grant:fixture";

function funding(index, script = owner.output) {
  const tx = new bitcoin.Transaction();
  tx.addInput(Buffer.alloc(32, index + 1), index);
  tx.addOutput(script, 100000n);
  return tx;
}
function unsigned(count = 2) {
  const psbt = new bitcoin.Psbt();
  for (let index = 0; index < count; index++) {
    const tx = funding(index);
    psbt.addInput({ hash: tx.getId(), index: 0, nonWitnessUtxo: tx.toBuffer(), sighashType: bitcoin.Transaction.SIGHASH_ALL });
  }
  psbt.addOutput({ address: owner.address, value: 546n });
  psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(record)] }).output, value: 0n });
  psbt.addOutput({ address: owner.address, value: BigInt(count * 100000 - 1546) });
  return psbt;
}
function sign(hex, flags = [], alterFinal) {
  const psbt = bitcoin.Psbt.fromHex(hex);
  for (let index = 0; index < psbt.inputCount; index++) {
    const flag = flags[index] ?? bitcoin.Transaction.SIGHASH_ALL;
    psbt.data.inputs[index].sighashType = flag;
    psbt.signInput(index, { publicKey, sign: hash => ecc.sign(hash, fixtureSecret) }, [flag]);
  }
  psbt.finalizeAllInputs();
  alterFinal?.(psbt);
  return psbt.toHex();
}
async function boostFixture({ fundingTransactions = [funding(0)], extraUtxos = [], feeSelector } = {}) {
  const steps = [], requests = [], broadcasts = [], signOptions = [];
  const byId = new Map(fundingTransactions.map(tx => [tx.getId(), tx]));
  const walletUtxos = fundingTransactions.map(tx => ({ txid: tx.getId(), vout: 0, value: Number(tx.outs[0].value), status: { confirmed: true } })).concat(extraUtxos);
  const window = { unisat: { getBitcoinUtxos: async () => { steps.push("utxos"); return walletUtxos; } }, setTimeout };
  const client = { fetchProofApiJson: async path => {
    requests.push(path);
    const txid = path.split("/")[4];
    if (path.endsWith("/status")) return { status: "confirmed" };
    if (path.endsWith("/hex")) { steps.push(`hydrate:${txid}`); return { hex: byId.get(txid)?.toHex() }; }
    throw new Error(`Unexpected read: ${path}`);
  }, proofApiUrl: (path, network) => `https://fixture.invalid${path}?network=${network}` };
  const boost = await loadClient("src/features/boost/boostWallet.ts", {
    "bitcoinjs-lib": bitcoin, "@bitcoinerlab/secp256k1": ecc,
    "../../walletUtxos": { ...utxos, selectUtxos: (...args) => {
      steps.push("fees"); return feeSelector ? feeSelector(...args) : utxos.selectUtxos(...args);
    } },
    "../../functions": { errorMessage: (cause, fallback) => cause instanceof Error ? cause.message : fallback, shortAddress: value => value },
    "../../shared/bitcoin/networks": { explorerTxUrl: txid => `https://fixture.invalid/tx/${txid}` },
    "../../shared/api/proofApiClient": client,
    "../../shared/bitcoin/protocolLimits": { MAX_DATA_CARRIER_BYTES: 100000 },
    "./boostNumeric": numeric,
  }, { window, fetch: async (_url, options) => {
    steps.push("broadcast");
    const transaction = bitcoin.Transaction.fromHex(JSON.parse(options.body).txHex);
    broadcasts.push(transaction);
    return { ok: true, status: 200, text: async () => JSON.stringify({ txid: transaction.getId() }) };
  } });
  const wallet = { signPsbt: async (hex, options) => { steps.push("sign"); signOptions.push(options); return sign(hex); } };
  const parameters = { inputCount: 2, network: "livenet", psbtHex: unsigned().toHex(), signInputIndexes: [0, 1],
    signingAddress: owner.address, wallet, requireP2pkhAllInputs: true,
    onSigned: () => { steps.push("receipt"); }, beforeBroadcast: async () => { steps.push("recheck"); } };
  return { boost, client, window, wallet, parameters, steps, requests, broadcasts, signOptions, walletUtxos, byId };
}
const buildOptions = { network: "livenet", fromAddress: owner.address, feeRate: 1,
  payments: [{ address: owner.address, amountSats: 546 }], protocolPayloads: [record], requireP2pkhAllInputs: true };

test("mainnet P2PKH address preflight rejects unsupported wallets before funding or fees", async () => {
  for (const address of [witnessOwner.address, taprootOwner.address, testnetOwner.address, "1not-an-address"]) {
    const fixture = await boostFixture();
    await assert.rejects(fixture.boost.buildBoostPaymentPsbt({ ...buildOptions, fromAddress: address }), /mainnet P2PKH/u);
    assert.deepEqual(fixture.steps, []);
  }
});
test("every funding prevout is checked before fee selection; PSBT explicitly commits ALL", async () => {
  const inputs = [funding(0), funding(1)];
  for (const transaction of inputs) transaction.outs[0].value = 600n;
  const fixture = await boostFixture({ fundingTransactions: inputs });
  const result = await fixture.boost.buildBoostPaymentPsbt(buildOptions);
  const psbt = bitcoin.Psbt.fromHex(result.psbtHex);
  assert.equal(psbt.inputCount, 2);
  assert.ok(fixture.steps.indexOf("fees") > fixture.steps.findLastIndex(step => step.startsWith("hydrate:")));
  assert.ok(psbt.data.inputs.every(input => input.sighashType === 1 && input.nonWitnessUtxo && !input.witnessUtxo));
});
for (const [name, script] of [["foreign P2PKH", foreign.output], ["P2WPKH", witnessOwner.output], ["Taproot", taprootOwner.output]]) {
  test(`unsupported ${name} funding rejects before fees`, async () => {
    const fixture = await boostFixture({ fundingTransactions: [funding(0, script)] });
    await assert.rejects(fixture.boost.buildBoostPaymentPsbt(buildOptions), /Permission funding/u);
    assert.equal(fixture.steps.includes("fees"), false);
  });
}
test("funding evidence must bind both previous txid and exact advertised value", async () => {
  for (const change of ["value", "txid"]) {
    const fixture = await boostFixture();
    if (change === "value") fixture.walletUtxos[0].value++;
    else fixture.byId.set(fixture.walletUtxos[0].txid, funding(20));
    await assert.rejects(fixture.boost.buildBoostPaymentPsbt(buildOptions), /Permission funding/u);
    assert.equal(fixture.steps.includes("fees"), false);
  }
});
test("verified ALL signatures on every P2PKH input precede receipt, recheck and broadcast", async () => {
  const fixture = await boostFixture();
  const result = await fixture.boost.signAndBroadcastBoostPsbt(fixture.parameters);
  assert.equal(result.txid, fixture.broadcasts[0].getId());
  assert.deepEqual(fixture.steps, ["sign", "receipt", "recheck", "broadcast"]);
  assert.deepEqual(Array.from(fixture.signOptions[0].toSignInputs, input => ({ index: input.index, types: Array.from(input.sighashTypes) })), [{ index: 0, types: [1] }, { index: 1, types: [1] }]);
  assert.equal(bitcoin.Psbt.fromHex(sign(fixture.parameters.psbtHex)).data.inputs[0].sighashType, undefined,
    "standard finalization may remove PSBT sighash metadata; final signature is authoritative");
});
test("public-key fallback keeps explicit ALL for every input", async () => {
  const fixture = await boostFixture(); let calls = 0;
  fixture.wallet.getPublicKey = async () => Buffer.from(publicKey).toString("hex");
  fixture.wallet.signPsbt = async (hex, options) => {
    fixture.signOptions.push(options);
    if (calls++ === 0) throw new Error("toSignInput did not match current address");
    return sign(hex);
  };
  await fixture.boost.signAndBroadcastBoostPsbt(fixture.parameters);
  assert.equal(fixture.signOptions.length, 2);
  for (const options of fixture.signOptions) assert.deepEqual(Array.from(options.toSignInputs, input => Array.from(input.sighashTypes)), [[1], [1]]);
  assert.ok(fixture.signOptions[1].toSignInputs.every(input => input.publicKey === Buffer.from(publicKey).toString("hex")));
});
test("canonical uncompressed SEC public keys match the backend P2PKH path", async () => {
  const fixture = await boostFixture();
  const uncompressedKey = ecc.pointFromScalar(fixtureSecret, false);
  const payment = bitcoin.payments.p2pkh({ pubkey: uncompressedKey });
  const previous = funding(0, payment.output), psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: previous.getId(), index: 0, nonWitnessUtxo: previous.toBuffer(), sighashType: 1 });
  psbt.addOutput({ address: payment.address, value: 99000n });
  fixture.wallet.signPsbt = async hex => {
    const signed = bitcoin.Psbt.fromHex(hex);
    signed.signInput(0, { publicKey: uncompressedKey, sign: hash => ecc.sign(hash, fixtureSecret) });
    signed.finalizeAllInputs(); return signed.toHex();
  };
  await fixture.boost.signAndBroadcastBoostPsbt({ ...fixture.parameters, inputCount: 1, signInputIndexes: [0],
    signingAddress: payment.address, psbtHex: psbt.toHex() });
  assert.equal(fixture.broadcasts.length, 1);
});
test("canonical high-S ALL signatures match the backend consensus verification", async () => {
  const fixture = await boostFixture();
  fixture.wallet.signPsbt = async hex => sign(hex, [], psbt => {
    const chunks = bitcoin.script.decompile(psbt.data.inputs[1].finalScriptSig);
    const decoded = bitcoin.script.signature.decode(chunks[0]);
    const order = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
    const lowS = BigInt(`0x${Buffer.from(decoded.signature.subarray(32)).toString("hex")}`);
    decoded.signature.set(Buffer.from((order - lowS).toString(16).padStart(64, "0"), "hex"), 32);
    chunks[0] = bitcoin.script.signature.encode(decoded.signature, 1);
    psbt.data.inputs[1].finalScriptSig = bitcoin.script.compile(chunks);
  });
  await fixture.boost.signAndBroadcastBoostPsbt(fixture.parameters);
  assert.equal(fixture.broadcasts.length, 1);
});
for (const flag of [2, 3, 0x81, 0x82, 0x83]) {
  test(`a non-ALL signature (0x${flag.toString(16)}) on any input prevents receipt and broadcast`, async () => {
    const fixture = await boostFixture();
    fixture.wallet.signPsbt = async hex => sign(hex, [1, flag]);
    await assert.rejects(fixture.boost.signAndBroadcastBoostPsbt(fixture.parameters), /exact SIGHASH_ALL/u);
    assert.deepEqual(fixture.steps, []);
    assert.equal(fixture.broadcasts.length, 0);
  });
}
const finalAlterations = {
  "wrong wallet pubkey": psbt => { const chunks = bitcoin.script.decompile(psbt.data.inputs[1].finalScriptSig); chunks[1] = foreignKey; psbt.data.inputs[1].finalScriptSig = bitcoin.script.compile(chunks); },
  "hybrid SEC pubkey": psbt => { const chunks = bitcoin.script.decompile(psbt.data.inputs[1].finalScriptSig); chunks[1] = ecc.pointFromScalar(fixtureSecret, false); chunks[1][0] = 6; psbt.data.inputs[1].finalScriptSig = bitcoin.script.compile(chunks); },
  "invalid cryptographic signature": psbt => { const chunks = bitcoin.script.decompile(psbt.data.inputs[1].finalScriptSig); const decoded = bitcoin.script.signature.decode(chunks[0]); decoded.signature[0] ^= 1; chunks[0] = bitcoin.script.signature.encode(decoded.signature, 1); psbt.data.inputs[1].finalScriptSig = bitcoin.script.compile(chunks); },
  "nonminimal signature push": psbt => { const chunks = bitcoin.script.decompile(psbt.data.inputs[1].finalScriptSig); psbt.data.inputs[1].finalScriptSig = Buffer.concat([Buffer.from([0x4c, chunks[0].length]), Buffer.from(chunks[0]), Buffer.from([chunks[1].length]), Buffer.from(chunks[1])]); },
  "extra scriptSig push": psbt => { const chunks = bitcoin.script.decompile(psbt.data.inputs[1].finalScriptSig); psbt.data.inputs[1].finalScriptSig = bitcoin.script.compile([...chunks, Buffer.from([1])]); },
  "malformed DER": psbt => { const chunks = bitcoin.script.decompile(psbt.data.inputs[1].finalScriptSig); chunks[0] = Buffer.from([0x30, 0x01, 0x01]); psbt.data.inputs[1].finalScriptSig = bitcoin.script.compile(chunks); },
  "unexpected witness": psbt => { psbt.data.inputs[1].finalScriptWitness = Buffer.from([1, 1, 1]); },
};
for (const [name, alter] of Object.entries(finalAlterations)) {
  test(`${name} prevents receipt and broadcast`, async () => {
    const fixture = await boostFixture(); fixture.wallet.signPsbt = async hex => sign(hex, [], alter);
    await assert.rejects(fixture.boost.signAndBroadcastBoostPsbt(fixture.parameters), /Permission/u);
    assert.equal(fixture.steps.includes("receipt"), false); assert.equal(fixture.broadcasts.length, 0);
  });
}
test("wallet transaction mutation still fails the existing exact-intent check", async () => {
  const fixture = await boostFixture();
  fixture.wallet.signPsbt = async () => { const changed = unsigned(); changed.setLocktime(1); return sign(changed.toHex()); };
  await assert.rejects(fixture.boost.signAndBroadcastBoostPsbt(fixture.parameters), /UniSat changed the transaction/u);
  assert.equal(fixture.steps.includes("receipt"), false); assert.equal(fixture.broadcasts.length, 0);
});
test("missing ALL or incomplete input selection rejects before a wallet signature", async () => {
  for (const variant of ["missing", "wrong", "subset", "count"]) {
    const fixture = await boostFixture(); const parameters = { ...fixture.parameters };
    if (variant === "subset") parameters.signInputIndexes = [0];
    else if (variant === "count") parameters.inputCount = 1;
    else { const psbt = unsigned(); if (variant === "missing") delete psbt.data.inputs[1].sighashType; else psbt.data.inputs[1].sighashType = 0x81; parameters.psbtHex = psbt.toHex(); }
    await assert.rejects(fixture.boost.signAndBroadcastBoostPsbt(parameters), /Permission/u);
    assert.deepEqual(fixture.steps, []);
  }
});
test("shared Boost default retains existing witness signing behavior", async () => {
  const fixture = await boostFixture(); const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: "a".repeat(64), index: 0, witnessUtxo: { script: witnessOwner.output, value: 100000n } });
  psbt.addOutput({ address: witnessOwner.address, value: 99000n });
  fixture.wallet.signPsbt = async (hex, options) => { fixture.signOptions.push(options); return sign(hex); };
  await fixture.boost.signAndBroadcastBoostPsbt({ ...fixture.parameters, inputCount: 1, signInputIndexes: [0],
    signingAddress: witnessOwner.address, psbtHex: psbt.toHex(), requireP2pkhAllInputs: undefined });
  assert.equal(fixture.broadcasts.length, 1);
  assert.equal(fixture.signOptions[0].toSignInputs[0].sighashTypes, undefined);
});
test("strict policy is opt-in; existing default signature scope is preserved", async () => {
  const fixture = await boostFixture(); fixture.wallet.signPsbt = async hex => sign(hex, [0x83, 0x83]);
  await fixture.boost.signAndBroadcastBoostPsbt({ ...fixture.parameters, requireP2pkhAllInputs: undefined });
  assert.equal(fixture.broadcasts.length, 1);
});
test("strict verified signing still stops before broadcast if receipt persistence fails", async () => {
  const fixture = await boostFixture();
  await assert.rejects(fixture.boost.signAndBroadcastBoostPsbt({ ...fixture.parameters,
    onSigned: () => { throw new Error("Receipt storage unavailable"); } }), /Receipt storage unavailable/u);
  assert.equal(fixture.steps.includes("recheck"), false); assert.equal(fixture.broadcasts.length, 0);
});
test("strict verified signing retains evidence before a failed fresh funding recheck", async () => {
  const fixture = await boostFixture();
  await assert.rejects(fixture.boost.signAndBroadcastBoostPsbt({ ...fixture.parameters,
    beforeBroadcast: async () => { throw new Error("Funding became reserved"); } }), /Funding became reserved/u);
  assert.equal(fixture.steps.includes("receipt"), true); assert.equal(fixture.broadcasts.length, 0);
});
test("Permission preparation rejects unsupported account before network, discovery, reservation or builder calls", async () => {
  const fixture = await boostFixture(); let reached = false;
  const permission = await loadClient("src/features/permission/permissionWallet.ts", {
    "bitcoinjs-lib": bitcoin, "../../shared/api/proofApiClient": fixture.client,
    "../../shared/wallet/paymentReview": {},
    "../boost/boostWallet": { ...fixture.boost, ensureWalletNetwork: async () => { reached = true; }, assertActiveWalletAddress: async () => {} },
    "../code/codeWallet": { codeReservedAnchors: async () => { reached = true; }, sameCodeAddress: () => true },
    "./permissionApi": { fetchPermissions: async () => { reached = true; }, fetchPermission: async () => { reached = true; }, permissionPublicationReady: () => true },
    "./permissionProtocol": { PERMISSION_ACTION_LABELS: {} },
  }, { window: { unisat: { getAccounts: async () => [witnessOwner.address] } } });
  await assert.rejects(permission.preparePermissionTransaction({ draft: { action: "grant", feeRate: 1 } }, witnessOwner.address, "livenet", () => {}), /mainnet P2PKH/u);
  assert.equal(reached, false);
});


async function permissionDraftClient() {
  const fixture = await boostFixture();
  const encoding = await loadClient("src/shared/utils/encoding.ts", { "bitcoinjs-lib": bitcoin });
  return loadClient("src/features/permission/permissionProtocol.ts", {
    "../../shared/protocol/permissions.mjs": permissionSchema,
    "../../shared/utils/encoding": encoding,
    "../boost/boostWallet": fixture.boost,
  });
}
function legacyPermissionDraft(client) {
  const { feePolicyVersion, minerFeeRateProofsPerVbyte, ...base } = client.emptyPermissionDraft;
  return { ...base, label: "Retained legacy permission", maxMinerFeeProofs: "1000", feeRate: 2 };
}

test("new draft presets and exact custom rates round-trip without changing publication fees", async () => {
  const client = await permissionDraftClient();
  for (const rate of ["0.1", "0.5", "1", "2", "0.12345678"]) {
    const draft = { ...client.emptyPermissionDraft, label: "Exact agent fee", minerFeeRateProofsPerVbyte: rate, feeRate: 0.5 };
    const restored = client.restorePermissionDraft(client.permissionDraftFields(draft));
    assert.equal(JSON.stringify(restored), JSON.stringify(draft));
    const plan = client.buildPermissionPlan(restored), parsed = permissionSchema.parsePermissionBody(plan.body);
    assert.equal(parsed.metadata.v, 2); assert.equal(parsed.metadata.policy.minerFeeRateProofsPerVbyte, rate);
    assert.equal(parsed.metadata.policy.maxMinerFeeProofs, undefined); assert.equal(plan.draft.feeRate, 0.5);
    assert.match(permissionSchema.permissionPolicyEnv(parsed.metadata.policy), new RegExp(`AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=${rate.replaceAll(".", "\\.")}`));
  }
  const trailing = client.buildPermissionPlan({ ...client.emptyPermissionDraft, label: "Trim decimal", minerFeeRateProofsPerVbyte: "0.50000000" });
  assert.equal(trailing.policy.minerFeeRateProofsPerVbyte, "0.5");
});

test("agent custom rate validation refuses unsupported precision or bounds instead of rounding", async () => {
  const client = await permissionDraftClient();
  for (const rate of ["", "0", "0.05", "-1", "0.123456789", "1e-1", "01.0", " 0.5 "]) {
    assert.throws(() => client.buildPermissionPlan({ ...client.emptyPermissionDraft, label: "Rejected rate", minerFeeRateProofsPerVbyte: rate }), /fee rate|transaction fee rate/u);
  }
});

test("legacy draft and confirmed-policy replacement retain historical caps without inventing a rate", async () => {
  const client = await permissionDraftClient(), legacy = legacyPermissionDraft(client);
  assert.equal(client.isPermissionDraft(legacy), true);
  assert.equal(JSON.stringify(client.restorePermissionDraft(client.permissionDraftFields(legacy))), JSON.stringify(legacy));
  assert.throws(() => client.buildPermissionPlan(legacy), /Choose an agent transaction fee rate/u);
  const policy = { signingEnabled: true, allowedActions: ["mail.send"], maxTransactionProofs: "5000", dailyLimitProofs: "30000", maxMinerFeeProofs: "1000", allowedRecipients: null, workLimits: null };
  const replacement = client.permissionDraftFromPolicy(policy, "Legacy grant", "a".repeat(64), "b".repeat(64));
  assert.equal(replacement.minerFeeRateProofsPerVbyte, ""); assert.equal(replacement.legacyMaxMinerFeeProofs, "1000");
  assert.throws(() => client.buildPermissionPlan(replacement), /Choose an agent transaction fee rate/u);
  const upgraded = client.permissionDraftWithFeeRate(legacy, "0.5");
  assert.equal(upgraded.maxMinerFeeProofs, undefined); assert.equal(upgraded.legacyMaxMinerFeeProofs, "1000"); assert.equal(upgraded.feeRate, 2);
  const plan = client.buildPermissionPlan(upgraded);
  assert.equal(plan.metadata.v, 2); assert.equal(plan.policy.minerFeeRateProofsPerVbyte, "0.5");
  assert.equal(plan.policy.maxMinerFeeProofs, undefined); assert.equal(policy.maxMinerFeeProofs, "1000");
});

test("restored legacy receipt preserves its original task key across explicit upgrade and serialization", async () => {
  const client = await permissionDraftClient(), legacy = legacyPermissionDraft(client);
  const recoveryKey = `permission:grant:${"c".repeat(64)}`;
  const upgraded = client.permissionDraftWithFeeRate({ ...legacy, recoveryKey }, "0.12345678");
  const restored = client.restorePermissionDraft(client.permissionDraftFields(upgraded));
  assert.equal(restored.recoveryKey, recoveryKey);
  const plan = client.buildPermissionPlan(restored);
  assert.equal(plan.draft.recoveryKey, recoveryKey); assert.notEqual(plan.key, recoveryKey);
  assert.equal(plan.metadata.recoveryKey, undefined); assert.equal(plan.metadata.policy.legacyMaxMinerFeeProofs, undefined);
  assert.equal(client.isPermissionDraft({ ...legacy, feePolicyVersion: 2, minerFeeRateProofsPerVbyte: "0.5" }), false);
});

test("v2 publication requires explicit backend support, exact activation pins and ready history", async () => {
  const client = await loadClient("src/features/permission/permissionApi.ts", {
    "../../shared/api/proofApiClient": {}, "../../shared/protocol/permissions.mjs": permissionSchema,
  });
  const evidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-permission-replay", currentStatusVerified: true,
    coverage: { complete: true, indexedThroughBlock: permissionSchema.PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, indexedThroughBlockHash: "a".repeat(64), activationHeight: permissionSchema.PERMISSION_ACTIVATION_HEIGHT },
    admission: { ready: true, writesEnabled: true, autonomousSigningEnabled: false, activationHeight: permissionSchema.PERMISSION_ACTIVATION_HEIGHT,
      activationPreviousBlockHash: permissionSchema.PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH, minimumSelfPaymentProofs: permissionSchema.PERMISSION_MIN_SELF_PAYMENT_PROOFS,
      supportedRecordVersions: [1, 2], feeRatePolicyReady: true, feeRateActivationHeight: permissionSchema.PERMISSION_FEE_RATE_ACTIVATION_HEIGHT,
      feeRateActivationPreviousBlockHash: permissionSchema.PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH } };
  assert.equal(client.permissionPublicationReady(evidence, 2), true);
  assert.equal(client.permissionPublicationReady({ ...evidence, coverage: { ...evidence.coverage, indexedThroughBlock: permissionSchema.PERMISSION_FEE_RATE_ACTIVATION_HEIGHT - 1 } }, 2), false);
  for (const admission of [ { supportedRecordVersions: [1] }, { feeRatePolicyReady: false }, { feeRateActivationHeight: 0 }, { feeRateActivationPreviousBlockHash: "b".repeat(64) }, { writesEnabled: false } ]) {
    assert.equal(client.permissionPublicationReady({ ...evidence, admission: { ...evidence.admission, ...admission } }, 2), false);
  }
  assert.equal(client.permissionPublicationReady({ ...evidence, admission: { ...evidence.admission, supportedRecordVersions: undefined, feeRatePolicyReady: undefined } }, 2), false);
  assert.equal(client.permissionPublicationReady({ ...evidence, admission: { ...evidence.admission, supportedRecordVersions: undefined, feeRatePolicyReady: undefined } }), true);
});


test("autosaved legacy draft captures its exact v1 task key before either an ordinary edit or a fee upgrade", async () => {
  const client = await permissionDraftClient(), legacy = legacyPermissionDraft(client);
  const policy = permissionSchema.normalizePermissionPolicy({ signingEnabled: legacy.signingEnabled, allowedActions: legacy.allowedActions,
    maxTransactionProofs: legacy.maxTransactionProofs, dailyLimitProofs: legacy.dailyLimitProofs, maxMinerFeeProofs: legacy.maxMinerFeeProofs,
    allowedRecipients: null, workLimits: null });
  const body = permissionSchema.encodePermissionRecord("grant", { v: 1, network: "livenet", label: legacy.label, policy });
  const expectedKey = `permission:grant:${Buffer.from(bitcoin.crypto.sha256(Buffer.from(body))).toString("hex")}`;
  assert.equal(client.legacyPermissionDraftRecoveryKey(legacy), expectedKey);
  assert.equal(client.permissionDraftWithFeeRate(legacy, "0.5").recoveryKey, expectedKey);
  const edited = { ...client.permissionDraftWithRecoveryKey(legacy), label: "Changed before selecting a rate", allowedActions: ["mail.send"] };
  const upgraded = client.restorePermissionDraft(client.permissionDraftFields(client.permissionDraftWithFeeRate(edited, "0.5")));
  assert.equal(upgraded.recoveryKey, expectedKey);
  assert.notEqual(client.buildPermissionPlan(upgraded).key, expectedKey);
  for (const label of ["", " leading", "trailing ", "control\nlabel", "x".repeat(201)]) assert.equal(client.legacyPermissionDraftRecoveryKey({ ...legacy, label }), undefined);
  assert.equal(client.legacyPermissionDraftRecoveryKey({ ...legacy, maxMinerFeeProofs: "invalid" }), undefined);
  assert.equal(client.permissionDraftWithFeeRate({ ...legacy, recoveryKey: `permission:grant:${"f".repeat(64)}` }, "0.5").recoveryKey, `permission:grant:${"f".repeat(64)}`);
  assert.equal(client.legacyPermissionDraftRecoveryKey({ ...legacy, action: "replace", grant: "a".repeat(64), parent: "b".repeat(64) }), `permission:root:${"a".repeat(64)}:${"b".repeat(64)}`);
});
