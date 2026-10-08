import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePermissionRecord, parsePermissionBody, normalizePermissionPolicy, permissionPolicyEnv } from '../src/shared/protocol/permissions.mjs';
import { verifyPermissionTransaction, replayPermissionTransactions, createPermissionSnapshot, permissionsPayload, permissionPayload,
  permissionRecordPayload, permissionCandidateParts, advancePermissionCandidateDigest, PERMISSION_DISCOVERY_EMPTY_SHA256 } from './permissions.mjs';
const owner = '1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv', other = '1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH';
const hash = 'b'.repeat(64), txid = number => number.toString(16).padStart(64, '0');
const activationHeight = 100, options = { network: 'livenet', activationHeight };
const policy = { signingEnabled: true, allowedActions: ['mail.send', 'boost.post'], maxTransactionProofs: '5000', dailyLimitProofs: '30000',
  maxMinerFeeProofs: '1000', allowedRecipients: [], workLimits: null };
function op(text) {
  const bytes = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x6a, 0x4d, bytes.length & 255, bytes.length >> 8]), bytes]).toString('hex');
}
function transaction(id, action = 'grant', metadata = {}, extra = {}) {
  const body = encodePermissionRecord(action, { v: 1, network: 'livenet', ...(action === 'revoke' ? {} : { label: 'Daily Computer', policy }), ...metadata });
  return { txid: txid(id), vin: [{ prevout: { scriptpubkey_address: owner, value: '10000', scriptpubkey: '51' } }],
    vout: [{ scriptpubkey_address: owner, value: '546', scriptpubkey: '51' }, { value: '0', scriptpubkey: op('pwm1:m:' + body) }],
    status: { confirmed: true, block_height: activationHeight + id, block_hash: hash }, blockTransactionIndex: id, ...extra };
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
  attacker.vin[0].prevout.scriptpubkey_address = other; attacker.vout[0].scriptpubkey_address = other;
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
