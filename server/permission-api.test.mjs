import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { encodePermissionRecord, PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../src/shared/protocol/permissions.mjs';
import { createPermissionSnapshot, permissionsPayload, permissionPayload, permissionRecordPayload, permissionSnapshotRequest, permissionReadError } from './permissions.mjs';
import { CanonicalPolicyApi } from '../local/permission-controller/adapters.mjs';
import { PermissionController } from '../local/permission-controller/controller.mjs';
const source = await readFile(new URL('./proof-api.mjs', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('async function verifiedPermissionPayload('), source.indexOf('\nfunction dnsSubdomainPublicRecord', source.indexOf('async function verifiedPermissionPayload(')));
const time = Date.parse('2026-10-08T12:00:00Z'), height = PERMISSION_ACTIVATION_HEIGHT + 1, hash = 'b'.repeat(64);
const owner = '1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH', grantTxid = 'a'.repeat(64);
const policy = { signingEnabled: true, allowedActions: ['mail.send'], maxTransactionProofs: '5000', dailyLimitProofs: '30000', maxMinerFeeProofs: '1000', allowedRecipients: null, workLimits: null };
function op(text) { const bytes = Buffer.from(text); return Buffer.concat([Buffer.from([0x6a, 0x4d, bytes.length & 255, bytes.length >> 8]), bytes]).toString('hex'); }
function transaction(action = 'grant', txid = grantTxid, metadata = {}) {
  return { txid, vin: [{ prevout: { scriptpubkey_address: owner, scriptpubkey: '51', value: '10000' } }],
    vout: [{ scriptpubkey_address: owner, scriptpubkey: '51', value: '546' },
      { value: '0', scriptpubkey: op('pwm1:m:' + encodePermissionRecord(action, { v: 1, network: 'livenet',
        ...(action === 'revoke' ? {} : { label: 'Integration fixture', policy }), ...metadata })) }],
    status: { confirmed: true, block_height: action === 'grant' ? height : height + 1, block_hash: hash }, blockTransactionIndex: action === 'grant' ? 1 : 2 };
}
function runtime({ transactions = [transaction()], tipHeight = height, changedTip = false, warnings = [] } = {}) {
  let calls = 0;
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const context = vm.createContext({
    Date: FixedDate, PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH,
    permissionSnapshotRequest, permissionReadError, createPermissionSnapshot, permissionsPayload, permissionPayload,
    bitcoinRpc: async method => { assert.equal(method, 'getblockchaininfo'); calls += 1; return { height: changedTip && calls > 1 ? tipHeight + 1 : tipHeight, blockHash: hash }; },
    exactCoreTipFromBlockchainInfo: value => value,
    discoverPermissions: async (network, checkpoint, activation, parent) => {
      assert.equal(network, 'livenet'); assert.deepEqual(JSON.parse(JSON.stringify(checkpoint)), { height: tipHeight, blockHash: hash });
      assert.equal(activation, PERMISSION_ACTIVATION_HEIGHT); assert.equal(parent, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH);
      return { transactions, pendingWarnings: warnings, coverage: { complete: true, witnessSha256: 'c'.repeat(64) } };
    },
  });
  vm.runInContext(functionSource + '\nthis.read = verifiedPermissionPayload;', context);
  return context.read;
}
test('actual API integration envelope is accepted by the owner-pinned controller adapter without substituting wallet or policy', async () => {
  const read = runtime(), params = new URLSearchParams({ network: 'livenet', txid: grantTxid, fresh: '1' });
  const payload = await read('livenet', params, true);
  const config = { grantTxid, walletAddress: owner, network: 'livenet', policyApiBase: 'https://permission.proofofwork.me/' };
  const policyReader = new CanonicalPolicyApi({ fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.get('txid'), grantTxid); assert.equal(url.searchParams.get('fresh'), '1'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(payload), { status: 200 });
  } });
  const controller = new PermissionController({ config, policyReader, ledger: { usage: () => ({ usedProofs: '0' }) }, now: () => time });
  const inspection = await controller.inspect();
  assert.equal(inspection.walletAddress, owner); assert.equal(inspection.grantTxid, grantTxid);
  assert.equal(inspection.policy.maxTransactionProofs, '5000'); assert.equal(inspection.autonomousSigningAvailable, false);
});
test('revoked grant and raw-only record envelopes cannot authorize the controller', async () => {
  const revoked = await runtime({ tipHeight: height + 1, transactions: [transaction(), transaction('revoke', 'd'.repeat(64), { grant: grantTxid, parent: grantTxid })] })('livenet', new URLSearchParams({ txid: grantTxid }), true);
  const config = { grantTxid, walletAddress: owner, network: 'livenet', policyApiBase: 'https://permission.proofofwork.me/' };
  for (const payload of [revoked, { complete: false, currentStatusVerified: false, authorityVerified: true, record: { txid: grantTxid } }]) {
    const policyReader = new CanonicalPolicyApi({ fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }) });
    const controller = new PermissionController({ config, policyReader, ledger: { usage: () => ({ usedProofs: '0' }) }, now: () => time });
    await assert.rejects(() => controller.inspect(), /PINNED_GRANT_NOT_ACTIVE|COMPLETE_PERMISSION_DETAIL_REQUIRED/);
  }
});
test('API verification fences changing tips and refuses stale pagination rather than mixing snapshots', async () => {
  await assert.rejects(() => runtime({ changedTip: true })('livenet', new URLSearchParams(), false), /tip changed/);
  const snapshot = Buffer.from(JSON.stringify({ model: 'proof-permission-snapshot-v1', network: 'livenet', checkpointHeight: height - 1, checkpointHash: hash })).toString('base64url');
  await assert.rejects(() => runtime()('livenet', new URLSearchParams({ snapshot }), false), error => error.statusCode === 409 && error.details.code === 'PERMISSION_SNAPSHOT_STALE');
});
test('incomplete pending hydration warns without changing confirmed grants or inventing a budget', async () => {
  const warning = { txid: 'e'.repeat(64), reason: 'pending-raw-evidence-unavailable' };
  const payload = await runtime({ warnings: [warning] })('livenet', new URLSearchParams(), false);
  assert.equal(payload.permissions.length, 1); assert.equal(payload.complete, true); assert.deepEqual(payload.pendingWarnings, [warning]);
  assert.equal(payload.pendingComplete, false); assert.equal(payload.budget.available, false); assert.equal(payload.admission.autonomousSigningEnabled, false);
});
test('actual raw-inspection route retains canonical block annotation while withholding current authorization', async () => {
  const start = source.indexOf('    if (url.pathname === "/api/v1/permissions" || url.pathname === "/api/v1/permission")');
  const route = source.slice(start, source.indexOf('    if (url.pathname === "/api/v1/jobs"', start));
  const tx = { ...transaction(), _powCanonicalRpcHydration: true }; delete tx.blockTransactionIndex;
  let observed;
  const context = vm.createContext({ url: new URL(`https://permission.proofofwork.me/api/v1/permission?txid=${grantTxid}&inspect=1`),
    network: 'livenet', permissionInspectionRead: true, response: {}, permissionReadError, permissionRecordPayload,
    fetchTransactionFromBitcoinRpc: async () => tx, transactionHasCompleteCanonicalPrevouts: () => true,
    transactionConfirmed: value => value.status.confirmed === true,
    transactionBlockHeight: value => value.status.block_height, transactionBlockHash: value => value.status.block_hash,
    transactionBlockIndex: value => value._powBlockIndex,
    annotateBlockOrder: async transactions => transactions.map(value => ({ ...value, _powBlockIndex: 49 })),
    bitcoinRpc: async (method, args) => { assert.equal(method, 'getblockhash'); assert.equal(args[0], height); return { ok: true, result: hash }; },
    jsonResponse: (_response, status, payload, cache) => { observed = { status, payload, cache }; },
  });
  await vm.runInContext('(async function(){\n' + route + '\n})()', context);
  assert.equal(observed.status, 200); assert.equal(observed.cache, 'no-store');
  assert.equal(observed.payload.record.blockTransactionIndex, 49); assert.equal(observed.payload.authorityVerified, true);
  assert.equal(observed.payload.currentStatusVerified, false); assert.equal(observed.payload.complete, false); assert.equal(observed.payload.admission.ready, false);
});
test('canonical deny-all policy remains inspectable and refuses actions before planning', async () => {
  const deny = transaction();
  deny.vout[1].scriptpubkey = op('pwm1:m:' + encodePermissionRecord('grant', { v: 1, network: 'livenet', label: 'Deny all', policy: { ...policy, signingEnabled: false, allowedActions: [] } }));
  const payload = await runtime({ transactions: [deny] })('livenet', new URLSearchParams({ txid: grantTxid }), true);
  const config = { grantTxid, walletAddress: owner, network: 'livenet', policyApiBase: 'https://permission.proofofwork.me/' };
  const policyReader = new CanonicalPolicyApi({ fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }) });
  const controller = new PermissionController({ config, policyReader, ledger: { usage: () => ({ usedProofs: '0' }) }, now: () => time });
  assert.deepEqual((await controller.inspect()).policy.allowedActions, []);
  await assert.rejects(() => controller.plan({ operationId: 'deny_all_operation_01', action: 'mail.send', payload: { recipients: [{ address: owner, proofs: '546' }], body: 'Fixture' } }), /GRANT_SIGNING_DISABLED/);
});
