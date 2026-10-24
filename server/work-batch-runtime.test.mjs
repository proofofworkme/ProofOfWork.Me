import assert from "node:assert/strict";
import test from "node:test";
import { address, networks, script } from "bitcoinjs-lib";
import {
  WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT, normalizeWorkBatchDeclarationPins,
  WORK_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY,
  WORK_BATCH_DECLARATION_REGISTRY_ADDRESS, workBatchDeclarationCommitment,
} from "./work-batch-declaration.mjs";
import { workBatchConfiguration, resolveWorkBatchReadConfiguration, loadWorkBatchActivation, workBatchPublicStatus } from "./work-batch-runtime.mjs";

const pins = { txid: "a".repeat(64), blockHeight: 1000000, blockHash: "b".repeat(64),
  blockTransactionIndex: 1, protocolVout: 1, recordOrdinal: 0, registryPaymentVout: 0, activationHeight: 1000001 };
const tip = { height: 1000001, blockHash: "c".repeat(64) };
const configuration = { requested: true, pins, writesEnabled: true };
const transaction = () => ({
  txid: pins.txid, _powCanonicalRpcHydration: true,
  status: { confirmed: true, block_height: 1000000, block_hash: pins.blockHash },
  vin: [{ prevout: { scriptpubkey: WORK_BATCH_DECLARATION_AUTHORITY_SCRIPT_PUBKEY, value: 10000 } }],
  vout: [
    { value: 546, scriptpubkey: Buffer.from(address.toOutputScript(WORK_BATCH_DECLARATION_REGISTRY_ADDRESS, networks.bitcoin)).toString("hex") },
    { value: 0, scriptpubkey: Buffer.from(script.compile([106, Buffer.from(workBatchDeclarationCommitment().protocolRecord)])).toString("hex") },
  ],
});
const dependencies = () => ({ configuration, blockHeight: tip.height, blockHash: tip.blockHash,
  getBlockHash: async h => h === 1000000 ? pins.blockHash : tip.blockHash,
  getBlock: async () => ({ hash: pins.blockHash, height: 1000000, tx: ["d".repeat(64), pins.txid] }),
  getTransaction: async () => transaction(),
});

test("configuration requires every exact pin and explicit write opt-in", () => {
  assert.deepEqual(workBatchConfiguration({}), { requested: false, pins: null, writesEnabled: false });
  const env = { WORK_BATCH_DECLARATION_TXID: pins.txid, WORK_BATCH_DECLARATION_HEIGHT: "1000000",
    WORK_BATCH_DECLARATION_BLOCK_HASH: pins.blockHash, WORK_BATCH_DECLARATION_BLOCK_INDEX: "1",
    WORK_BATCH_DECLARATION_PROTOCOL_VOUT: "1", WORK_BATCH_DECLARATION_RECORD_ORDINAL: "0",
    WORK_BATCH_DECLARATION_REGISTRY_PAYMENT_VOUT: "0", WORK_BATCH_ACTIVATION_HEIGHT: "1000001",
    WORK_BATCH_WRITES_ENABLED: "1" };
  assert.equal(workBatchConfiguration(env).pins.txid, pins.txid);
  assert.equal(workBatchConfiguration(env).writesEnabled, true);
  for (const key of Object.keys(env).filter(key => key !== "WORK_BATCH_WRITES_ENABLED")) {
    const next = { ...env }; delete next[key];
    assert.equal(workBatchConfiguration(next).pins, null, key);
  }
  assert.equal(workBatchConfiguration({ ...env, WORK_BATCH_DECLARATION_RECORD_ORDINAL: "00" }).pins, null);
  assert.equal(workBatchConfiguration({ ...env, WORK_BATCH_WRITES_ENABLED: "true" }).writesEnabled, false);
});

test("canonical hydration binds declaration block index and exact checkpoint twice", async () => {
  const active = await loadWorkBatchActivation(dependencies());
  assert.equal(active.active, true);
  assert.match(active.evidenceCommitment.sha256, /^[0-9a-f]{64}$/u);
  const missingHeight = transaction(); delete missingHeight.status.block_height;
  assert.equal((await loadWorkBatchActivation({ ...dependencies(),
    getTransaction: async () => missingHeight })).active, true);
  const wrongHeight = transaction(); wrongHeight.status.block_height = 999999;
  await assert.rejects(loadWorkBatchActivation({ ...dependencies(),
    getTransaction: async () => wrongHeight }), /height-mismatch/u);
  for (const replacement of [
    { getBlockHash: async () => "f".repeat(64) },
    { getBlock: async () => ({ hash: pins.blockHash, height: 1000000, tx: [pins.txid] }) },
    { getTransaction: async () => ({ ...transaction(), _powCanonicalRpcHydration: false }) },
    { getTransaction: async () => ({ ...transaction(), txid: "f".repeat(64) }) },
  ]) await assert.rejects(loadWorkBatchActivation({ ...dependencies(), ...replacement }), /work-batch-/u);
  let checkpointCalls = 0;
  await assert.rejects(loadWorkBatchActivation({ ...dependencies(), getBlockHash: async h => h === 1000000 ?
    pins.blockHash : ++checkpointCalls === 1 ? tip.blockHash : "e".repeat(64) }), /checkpoint-changed/u);
});

test("missing or malformed pins and activation boundary fail closed", async () => {
  assert.equal((await loadWorkBatchActivation({ configuration: workBatchConfiguration({}) })).active, false);
  await assert.rejects(loadWorkBatchActivation({ configuration: { requested: true, pins: null } }), /pins-invalid/u);
  let calls = 0;
  const result = await loadWorkBatchActivation({ ...dependencies(), blockHeight: 1000000, blockHash: pins.blockHash,
    getTransaction: async () => { calls++; return transaction(); } });
  assert.equal(result.active, false);
  assert.equal(calls, 0);
  await assert.rejects(loadWorkBatchActivation({ ...dependencies(), blockHash: "" }), /checkpoint-required/u);
});

test("read activation survives disabled writes; readiness requires exact replay and tip", async () => {
  const activation = await loadWorkBatchActivation(dependencies());
  const params = { configuration, activation, tip, replayReady: true, exactTipReady: true };
  assert.equal(workBatchPublicStatus(params).ready, true);
  const disabled = workBatchPublicStatus({ ...params, configuration: { ...configuration, writesEnabled: false } });
  assert.equal(disabled.active, true);
  assert.equal(disabled.ready, false);
  assert.equal(disabled.registryFeeProofs, 546);
  assert.equal(disabled.limits.maxRecipients, 256);
  assert.equal(workBatchPublicStatus({ ...params, replayReady: false }).ready, false);
  assert.equal(workBatchPublicStatus({ ...params, exactTipReady: false }).ready, false);
  assert.equal(workBatchPublicStatus({ ...params, reasonCode: "work-batch-selection-unavailable" }).ready, false);
});

test("automatic read discovery cannot enable writes and activates only at D+1", async () => {
  const configured = workBatchConfiguration({ WORK_BATCH_WRITES_ENABLED: "1" });
  assert.equal(configured.writesEnabled, false);
  const discovered = await resolveWorkBatchReadConfiguration({ configuration: configured,
    readMarker: async () => null, discover: async () => pins, maximumBlockHeight: pins.blockHeight });
  assert.equal(discovered.writesEnabled, false);
  assert.equal(discovered.pins.txid, pins.txid);
  const activated = await loadWorkBatchActivation({ ...dependencies(), configuration: discovered });
  assert.equal(activated.active, true);
  assert.equal(workBatchPublicStatus({ configuration: discovered, activation: activated,
    tip, replayReady: true, exactTipReady: true }).ready, false);
  assert.equal((await loadWorkBatchActivation({ ...dependencies(), configuration: discovered,
    blockHeight: pins.blockHeight, blockHash: pins.blockHash })).active, false);
});

test("marker loss wins before discovery; valid marker recovery remains read-only", async () => {
  let calls = 0;
  const options = { configuration: { requested: false, pins: null, writesEnabled: true },
    discover: async () => { calls++; return pins; } };
  await assert.rejects(resolveWorkBatchReadConfiguration({ ...options,
    readMarker: async () => { throw new Error("activation marker is missing"); } }), /marker is missing/u);
  assert.equal(calls, 0);
  const recovered = await resolveWorkBatchReadConfiguration({ ...options,
    readMarker: async () => ({ declaration: pins }) });
  assert.equal(recovered.writesEnabled, false);
  assert.deepEqual(recovered.pins, normalizeWorkBatchDeclarationPins(pins));
  assert.equal(calls, 0);
  await assert.rejects(resolveWorkBatchReadConfiguration({ ...options,
    configuration: { ...configuration, pins: { ...pins, txid: "e".repeat(64) } },
    readMarker: async () => ({ declaration: pins }) }), /configured-marker-mismatch/u);
  await assert.rejects(resolveWorkBatchReadConfiguration({ ...options,
    configuration: { requested: true, pins: null }, readMarker: async () => null }), /pins-invalid/u);
});

test("the fixed floor skips discovery only after the marker guard", async () => {
  let guards = 0, discoveries = 0;
  const options = { configuration: workBatchConfiguration({}),
    readMarker: async () => { guards++; return null; },
    discover: async () => { discoveries++; return null; } };
  const result = await resolveWorkBatchReadConfiguration({ ...options,
    maximumBlockHeight: WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT - 1 });
  assert.deepEqual(result, { requested: false, pins: null, writesEnabled: false });
  assert.equal(guards, 1); assert.equal(discoveries, 0);
  await resolveWorkBatchReadConfiguration({ ...options, maximumBlockHeight: WORK_BATCH_MIN_DECLARATION_BLOCK_HEIGHT });
  assert.equal(discoveries, 1);
  await assert.rejects(resolveWorkBatchReadConfiguration({ ...options,
    discover: async () => { throw new Error("prefix incomplete"); } }), /prefix incomplete/u);
});

test("configured pins without a marker cannot bypass earlier discovery or missing reached authority", async () => {
  const options = { configuration, readMarker: async () => null };
  assert.equal(await resolveWorkBatchReadConfiguration({ ...options,
    maximumBlockHeight: pins.blockHeight - 1, discover: async () => null }), configuration);
  assert.equal(await resolveWorkBatchReadConfiguration({ ...options,
    maximumBlockHeight: pins.blockHeight, discover: async () => pins }), configuration);
  await assert.rejects(resolveWorkBatchReadConfiguration({ ...options,
    maximumBlockHeight: pins.blockHeight, discover: async () => null }), /not-discovered/u);
  await assert.rejects(resolveWorkBatchReadConfiguration({ ...options,
    maximumBlockHeight: pins.blockHeight, discover: async () => ({ ...pins, txid: "e".repeat(64) }) }), /not-earliest/u);
});
