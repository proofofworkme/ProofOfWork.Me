import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePermissionRecord, parsePermissionBody, normalizePermissionPolicy, permissionPolicyEnv,
  permissionFeeRateProofsQ8, permissionMinerFeeProofs, PERMISSION_FEE_RATE_ACTIVATION_HEIGHT,
  PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../src/shared/protocol/permissions.mjs';
import { verifyPermissionTransaction, replayPermissionTransactions, createPermissionSnapshot, permissionsPayload, permissionPayload,
  permissionRecordPayload, permissionCandidateParts, advancePermissionCandidateDigest, PERMISSION_DISCOVERY_EMPTY_SHA256 } from './permissions.mjs';
import { permissionFixture, fixtureOwner, fixtureKeys, signPermissionFixture } from './permission-test-fixtures.mjs';
const owner = fixtureOwner().address, other = fixtureOwner(fixtureKeys[1]).address;
const fixtureTxids = new Map();
const hash = 'b'.repeat(64), txid = number => fixtureTxids.get(number) ?? number.toString(16).padStart(64, '0');
const activationHeight = 100, options = { network: 'livenet', activationHeight };
const policy = { signingEnabled: true, allowedActions: ['mail.send', 'boost.post'], maxTransactionProofs: '5000', dailyLimitProofs: '30000',
  maxMinerFeeProofs: '1000', allowedRecipients: [], workLimits: null };
const feeRatePolicy = { signingEnabled: true, allowedActions: ['mail.send', 'boost.post'], maxTransactionProofs: '5000', dailyLimitProofs: '30000',
  minerFeeRateProofsPerVbyte: '0.5', allowedRecipients: [], workLimits: null };
function op(text) {
  const bytes = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x6a, 0x4d, bytes.length & 255, bytes.length >> 8]), bytes]).toString('hex');
}
function transaction(id, action = 'grant', metadata = {}, extra = {}) {
  const tx = permissionFixture({ nonce:id, action, metadata, policy, height:activationHeight+id, hash, index:id });
  fixtureTxids.set(id,tx.txid); return { ...tx,...extra };
}

test('closed canonical schema preserves exact proof strings and rejects executable or alternate metadata', () => {
  const encoded = encodePermissionRecord('grant', { v: 1, network: 'livenet', label: 'Computer', policy });
  assert.equal(parsePermissionBody(encoded).metadata.policy.maxTransactionProofs, '5000');
  assert.equal(parsePermissionBody(encoded).metadata.policy.allowedActions[0], 'boost.post');
  assert.equal(normalizePermissionPolicy({ ...policy, expiry: 1 }), null);
  assert.equal(normalizePermissionPolicy({ ...policy, dailyLimitProofs: '030000' }), null);
  assert.equal(normalizePermissionPolicy({ ...policy, maxTransactionProofs: 5000 }), null);
  assert.equal(normalizePermissionPolicy({ ...policy, maxMinerFeeProofs: '5001' }), null);
  assert.equal(normalizePermissionPolicy({ ...policy, allowedActions: ['mail.send', 'arbitrary.sign'] }), null);
  assert.equal(normalizePermissionPolicy({ ...policy, allowedActions: ['mail.send', 'mail.send'] }), null);
  const json = JSON.stringify({ network: 'livenet', v: 1, label: 'Computer', policy: normalizePermissionPolicy(policy) });
  assert.equal(parsePermissionBody('pwperm1:grant:' + Buffer.from(json).toString('base64url')), null);
  assert.equal(parsePermissionBody(encoded + '='), null);
  assert.match(permissionPolicyEnv(policy), /AGENT_ALLOWED_RECIPIENTS=self/);
  assert.match(permissionPolicyEnv(policy), /AGENT_DAILY_RESET=UTC/);
});
test('authorization binds every hydrated input and self-payment before the exact Mail carrier', () => {
  const tx = transaction(1);
  assert.equal(verifyPermissionTransaction(tx, options).valid, true);
  assert.equal(verifyPermissionTransaction(tx, options).walletAddress, owner);
  const mixed = transaction(2); mixed.vin.push({ prevout: { scriptpubkey_address: other } });
  assert.ok(verifyPermissionTransaction(mixed, options).validationErrors.includes('permission-input-authority-unavailable'));
  const missing = transaction(2); delete missing.vin[0].prevout;
  assert.equal(verifyPermissionTransaction(missing, options).valid, false);
  const insufficient = transaction(2); insufficient.vout[0].value = '545';
  assert.ok(verifyPermissionTransaction(insufficient, options).validationErrors.includes('permission-self-payment-insufficient'));
  const after = transaction(2); after.vout.reverse();
  assert.equal(verifyPermissionTransaction(after, options).valid, false);
  const funded = transaction(2); funded.vout[1].value = '1';
  assert.ok(verifyPermissionTransaction(funded, options).validationErrors.includes('permission-funded-carrier-invalid'));
  assert.ok(verifyPermissionTransaction(tx, { activationHeight: 0 }).validationErrors.includes('permission-activation-disabled'));
  assert.ok(verifyPermissionTransaction(tx, { activationHeight: 102 }).validationErrors.includes('permission-before-activation'));
});
test('malformed duplicates count as carriers and unknown companion records fail closed', () => {
  const duplicate = transaction(1); duplicate.vout.push({ value: '0', scriptpubkey: op('pwm1:m:pwperm1:bad') + '51' });
  assert.equal(permissionCandidateParts(duplicate).length, 2);
  assert.ok(verifyPermissionTransaction(duplicate, options).validationErrors.includes('permission-body-ambiguous'));
  const companion = transaction(1); companion.vout.push({ value: '0', scriptpubkey: op('pwt1:send3:unrelated') });
  assert.equal(verifyPermissionTransaction(companion, options).valid, false);
  const digest = advancePermissionCandidateDigest(PERMISSION_DISCOVERY_EMPTY_SHA256, duplicate);
  assert.notEqual(digest, advancePermissionCandidateDigest(PERMISSION_DISCOVERY_EMPTY_SHA256, transaction(1)));
});
test('exact-parent replacement and owner revocation defeat stale and third-party grant substitution', () => {
  const grant = transaction(1), replace = transaction(2, 'replace', { grant: txid(1), parent: txid(1), label: 'Reduced', policy: { ...policy, maxTransactionProofs: '4000' } });
  const stale = transaction(3, 'replace', { grant: txid(1), parent: txid(1) });
  const attacker = transaction(4, 'revoke', { grant: txid(1), parent: txid(2) });
  const attackerOwner = fixtureOwner(fixtureKeys[1]);
  attacker.vin[0].prevout.scriptpubkey_address = other; attacker.vin[0].prevout.scriptpubkey = attackerOwner.script;
  attacker.vout[0].scriptpubkey_address = other; attacker.vout[0].scriptpubkey = attackerOwner.script;
  signPermissionFixture(attacker, { keys:[fixtureKeys[1]] }); fixtureTxids.set(4,attacker.txid);
  const revoke = transaction(5, 'revoke', { grant: txid(1), parent: txid(2) });
  const resurrection = transaction(6, 'replace', { grant: txid(1), parent: txid(5) });
  const state = replayPermissionTransactions([resurrection, revoke, attacker, stale, replace, grant], options);
  assert.equal(state.permissions[0].status, 'revoked');
  assert.equal(state.versions[0].status, 'replaced'); assert.equal(state.versions[1].status, 'revoked');
  assert.ok(state.events.find(event => event.txid === txid(3)).validationErrors.includes('permission-parent-stale'));
  assert.ok(state.events.find(event => event.txid === txid(4)).validationErrors.includes('permission-owner-mismatch'));
  assert.ok(state.events.find(event => event.txid === txid(6)).validationErrors.includes('permission-grant-revoked'));
  const withoutRevoke = replayPermissionTransactions([grant, replace], options);
  assert.equal(withoutRevoke.permissions[0].status, 'active');
  assert.equal(withoutRevoke.permissions[0].txid, txid(2));
});
test('pending observations never authorize or supersede and canonical ambiguities abort replay', () => {
  const grant = transaction(1), pending = transaction(2, 'revoke', { grant: txid(1), parent: txid(1) }, { status: { confirmed: false } });
  const result = replayPermissionTransactions([grant, pending], options);
  assert.equal(result.permissions[0].status, 'active'); assert.equal(result.events[1].applied, false);
  assert.throws(() => replayPermissionTransactions([grant, grant], options), /duplicate/);
  const sameSlot = transaction(2); sameSlot.status.block_height = grant.status.block_height; sameSlot.blockTransactionIndex = grant.blockTransactionIndex;
  assert.throws(() => replayPermissionTransactions([grant, sameSlot], options), /ambiguous/);
});
test('snapshot pagination retains exact coverage and isolated inspection never claims current authority', () => {
  const transactions = [transaction(1), transaction(2)];
  const state = createPermissionSnapshot({ network: 'livenet', checkpointHeight: 102, checkpointHash: hash, transactions,
    activationHeight, activationPreviousBlockHash: 'c'.repeat(64), writesEnabled: true, generatedAt: '2026-10-08T00:00:00Z' });
  const list = permissionsPayload(state, new URLSearchParams({ limit: '1' }));
  assert.equal(list.complete, true); assert.equal(list.admission.ready, true); assert.equal(list.budget.available, false);
  const second = permissionsPayload(state, new URLSearchParams({ limit: '1', cursor: list.pagination.nextCursor }));
  assert.equal(second.permissions.length, 1); assert.notEqual(second.permissions[0].txid, list.permissions[0].txid);
  assert.throws(() => permissionsPayload(state, new URLSearchParams({ address: owner, cursor: list.pagination.nextCursor })), /another query/);
  const shifted = { ...state, snapshot: { ...state.snapshot, checkpointHeight: 103 } };
  assert.throws(() => permissionsPayload(shifted, new URLSearchParams({ cursor: list.pagination.nextCursor })), /snapshot changed/);
  assert.throws(() => createPermissionSnapshot({ network: 'livenet', checkpointHeight: 101, checkpointHash: hash, transactions, activationHeight }), /exceeds/);
  const detail = permissionPayload(state, new URLSearchParams({ txid: txid(1) }));
  assert.equal(detail.walletAddress, owner); assert.equal(detail.currentStatusVerified, true);
  assert.equal(detail.evidence.authorityVerified, true); assert.equal(detail.admission.autonomousSigningEnabled, false);
  const isolated = permissionRecordPayload(transaction(1), options);
  assert.equal(isolated.complete, false); assert.equal(isolated.currentStatusVerified, false); assert.equal(isolated.admission.ready, false);
});

test('metadata v2 uses canonical Q8 fee rates without changing legacy bytes, exports or cap semantics', () => {
  const legacyBody = 'pwperm1:grant:eyJ2IjoxLCJuZXR3b3JrIjoibGl2ZW5ldCIsImxhYmVsIjoiQ29tcHV0ZXIiLCJwb2xpY3kiOnsic2lnbmluZ0VuYWJsZWQiOnRydWUsImFsbG93ZWRBY3Rpb25zIjpbImJvb3N0LnBvc3QiLCJtYWlsLnNlbmQiXSwibWF4VHJhbnNhY3Rpb25Qcm9vZnMiOiI1MDAwIiwiZGFpbHlMaW1pdFByb29mcyI6IjMwMDAwIiwibWF4TWluZXJGZWVQcm9vZnMiOiIxMDAwIiwiYWxsb3dlZFJlY2lwaWVudHMiOltdLCJ3b3JrTGltaXRzIjpudWxsfX0';
  assert.equal(encodePermissionRecord('grant', { v: 1, network: 'livenet', label: 'Computer', policy }), legacyBody);
  assert.equal(permissionPolicyEnv(policy), 'AGENT_SIGNING_ENABLED=true\nAGENT_ALLOWED_ACTIONS=boost.post,mail.send\nAGENT_MAX_TRANSACTION_PROOFS=5000\nAGENT_DAILY_LIMIT_PROOFS=30000\nAGENT_MAX_MINER_FEE_PROOFS=1000\nAGENT_DAILY_RESET=UTC\nAGENT_ALLOWED_RECIPIENTS=self\nAGENT_WORK_LIMITS=null');
  for (const rate of ['0.1', '0.5', '1', '2', '0.12345678']) {
    const current = { ...feeRatePolicy, minerFeeRateProofsPerVbyte: rate };
    const body = encodePermissionRecord('grant', { v: 2, network: 'livenet', label: 'Computer', policy: current });
    const decoded = parsePermissionBody(body);
    assert.equal(decoded.metadata.v, 2);
    assert.equal(decoded.metadata.policy.minerFeeRateProofsPerVbyte, rate);
    assert.equal(Object.hasOwn(decoded.metadata.policy, 'maxMinerFeeProofs'), false);
    assert.match(permissionPolicyEnv(current), new RegExp(`AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=${rate.replace('.', '\\.')}`));
    assert.doesNotMatch(permissionPolicyEnv(current), /AGENT_MAX_MINER_FEE_PROOFS/);
  }
  for (const [version, value] of [[1, feeRatePolicy], [2, policy], [2, { ...feeRatePolicy, maxMinerFeeProofs: '1000' }]]) {
    assert.throws(() => encodePermissionRecord('grant', { v: version, network: 'livenet', label: 'Computer', policy: value }), /metadata/);
    const body = 'pwperm1:grant:' + Buffer.from(JSON.stringify({ v: version, network: 'livenet', label: 'Computer', policy: value })).toString('base64url');
    assert.equal(parsePermissionBody(body), null);
  }
  for (const version of [1, 2]) assert.equal(parsePermissionBody(encodePermissionRecord('revoke', {
    v: version, network: 'livenet', grant: 'a'.repeat(64), parent: 'b'.repeat(64),
  })).metadata.v, version);
  assert.equal(normalizePermissionPolicy({ ...policy, maxMinerFeeProofs: '5001' }), null);
});

test('fee-rate arithmetic has an exact minimum, closed precision and one proof ceiling', () => {
  assert.equal(permissionFeeRateProofsQ8('0.1'), 10_000_000n);
  assert.equal(permissionFeeRateProofsQ8('0.12345678'), 12_345_678n);
  assert.equal(permissionFeeRateProofsQ8('1.00000001'), 100_000_001n);
  for (const invalid of ['0', '0.01', '0.09999999', '0.10', '00.5', '1.0', '1e0', '-0.5', '+1', ' 0.5', '0.500000000', '2100000000000000.00000001', 1, null]) {
    assert.equal(permissionFeeRateProofsQ8(invalid), null, String(invalid));
    assert.equal(normalizePermissionPolicy({ ...feeRatePolicy, minerFeeRateProofsPerVbyte: invalid }), null, String(invalid));
  }
  assert.equal(permissionMinerFeeProofs('0.1', 1), '1');
  assert.equal(permissionMinerFeeProofs('0.5', 233), '117');
  assert.equal(permissionMinerFeeProofs('0.12345678', 100_000_000), '12345678');
  assert.equal(permissionMinerFeeProofs('2100000000000000', 1), '2100000000000000');
  assert.equal(permissionMinerFeeProofs('2100000000000000', 2), null);
  for (const bytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '233', NaN]) assert.equal(permissionMinerFeeProofs('0.5', bytes), null);
});

test('metadata v2 has a separate nonretroactive boundary while v1 remains valid at original admission', () => {
  const feeRateActivationHeight = activationHeight + 2;
  const boundaryOptions = { ...options, feeRateActivationHeight };
  const grant = transaction(1, 'grant', {}, { status: { confirmed: true, block_height: activationHeight, block_hash: hash } });
  const before = transaction(7, 'grant', { v: 2, policy: feeRatePolicy }, { status: { confirmed: true, block_height: activationHeight + 1, block_hash: hash } });
  const earlyReplace = transaction(8, 'replace', { v: 2, grant: grant.txid, parent: grant.txid, policy: feeRatePolicy },
    { status: { confirmed: true, block_height: activationHeight + 1, block_hash: hash } });
  const earlyRevoke = transaction(9, 'revoke', { v: 2, grant: grant.txid, parent: grant.txid },
    { status: { confirmed: true, block_height: activationHeight + 1, block_hash: hash } });
  assert.equal(verifyPermissionTransaction(grant, boundaryOptions).valid, true);
  for (const lookalike of [before, earlyReplace, earlyRevoke]) {
    const rejected = verifyPermissionTransaction(lookalike, boundaryOptions);
    assert.equal(rejected.valid, false); assert.equal(rejected.metadata.v, 2);
    assert.ok(rejected.validationErrors.includes('permission-fee-rate-before-activation'));
  }
  const upgrade = transaction(2, 'replace', { v: 2, grant: grant.txid, parent: grant.txid, policy: feeRatePolicy });
  const state = replayPermissionTransactions([before, earlyReplace, earlyRevoke, upgrade, grant], boundaryOptions);
  assert.equal(state.permissions.length, 1); assert.equal(state.permissions[0].txid, upgrade.txid);
  assert.equal(state.versions[0].policy.maxMinerFeeProofs, '1000');
  assert.equal(state.versions[1].policy.minerFeeRateProofsPerVbyte, '0.5');
  for (const lookalike of [before, earlyReplace, earlyRevoke]) assert.equal(state.events.find(event => event.txid === lookalike.txid).applied, false);
  const legacyRevoke = transaction(3, 'revoke', { v: 1, grant: grant.txid, parent: upgrade.txid });
  assert.equal(replayPermissionTransactions([grant, upgrade, legacyRevoke], boundaryOptions).permissions[0].status, 'revoked');
  const newRevoke = transaction(4, 'revoke', { v: 2, grant: grant.txid, parent: upgrade.txid });
  assert.equal(replayPermissionTransactions([grant, upgrade, newRevoke], boundaryOptions).permissions[0].status, 'revoked');
  assert.ok(verifyPermissionTransaction(upgrade, { ...options, feeRateActivationHeight: 0 }).validationErrors.includes('permission-fee-rate-activation-disabled'));
});

test('complete snapshots expose fee-rate admission only after independent parent verification and its boundary', () => {
  const legacy = transaction(1), current = transaction(2, 'grant', { v: 2, policy: feeRatePolicy });
  const common = { network: 'livenet', checkpointHeight: activationHeight + 2, checkpointHash: hash, transactions: [legacy, current],
    activationHeight, activationPreviousBlockHash: 'c'.repeat(64), feeRateActivationHeight: activationHeight + 2,
    feeRateActivationPreviousBlockHash: 'd'.repeat(64), writesEnabled: true };
  const unavailable = permissionsPayload(createPermissionSnapshot(common));
  assert.equal(unavailable.admission.ready, true); assert.equal(unavailable.admission.feeRatePolicyReady, false);
  assert.equal(unavailable.permissions.length, 1); assert.equal(unavailable.permissions[0].policy.maxMinerFeeProofs, '1000');
  const ready = permissionsPayload(createPermissionSnapshot({ ...common, feeRateAdmissionVerified: true }));
  assert.equal(ready.admission.feeRatePolicyReady, true); assert.deepEqual(ready.admission.supportedRecordVersions, [1, 2]);
  assert.equal(ready.permissions.length, 2); assert.equal(ready.admission.autonomousSigningEnabled, false); assert.equal(ready.budget.available, false);
  const before = permissionsPayload(createPermissionSnapshot({ ...common, checkpointHeight: activationHeight + 1,
    transactions: [legacy], feeRateAdmissionVerified: true }));
  assert.equal(before.admission.ready, true); assert.equal(before.admission.feeRatePolicyReady, false);
  assert.equal(PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, 970546);
  assert.equal(PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH, '000000000000000000018bee4a1759e02b289063d6d5a9afe704dd68d50101dc');
});
