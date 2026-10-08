import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import {
  parsePermissionBody, permissionPolicyEnv, PERMISSION_BODY_PREFIX,
  PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH,
  PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH,
  PERMISSION_MIN_SELF_PAYMENT_PROOFS,
} from '../src/shared/protocol/permissions.mjs';
import { decodeCanonicalOpReturnOutput, canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { exactCodeOutputProofs } from './code-repositories.mjs';

export const PERMISSION_SNAPSHOT_MODEL = 'proof-permission-snapshot-v1';
export const PERMISSION_DISCOVERY_EMPTY_SHA256 = createHash('sha256').update('ProofOfWork.Me/Permission/candidate-discovery/v1\n').digest('hex');
const TXID = /^[0-9a-f]{64}$/u;
const markerHex = Buffer.from(`pwm1:m:${PERMISSION_BODY_PREFIX}`, 'ascii').toString('hex');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const address = output => output?.scriptpubkey_address ?? output?.scriptPubKey?.address ?? output?.address ?? '';
export const isPermissionCandidatePart = decoded => decoded.payloadHex.startsWith(markerHex);
export function permissionCandidateParts(tx) {
  return (tx.vout ?? []).map((output, vout) => ({ vout, decoded: decodeCanonicalOpReturnOutput(output) })).filter(item => isPermissionCandidatePart(item.decoded));
}
export function advancePermissionCandidateDigest(prior, tx) {
  return sha256(Buffer.from(JSON.stringify({ prior, txid: tx.txid, height: tx.status?.block_height ?? tx.height,
    hash: tx.status?.block_hash ?? tx._powBlockHash, index: tx.blockTransactionIndex ?? tx._powBlockIndex,
    candidates: permissionCandidateParts(tx).map(item => ({ vout: item.vout, script: item.decoded.scriptPubKeyHex })) })));
}
/** The existing aggregate Mail record owns economics once; Permission adds no economic lane. */
export function permissionCandidateEventClosure(tx, rows, position, transition) {
  const record = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(item => item.protocol === 'pwm1');
  if (!record || !permissionCandidateParts(tx).length || !transition || Number(transition.block_height) !== position.blockHeight || transition.block_hash !== position.blockHash) return false;
  const records = rows.filter(row => row.txid === tx.txid && row.protocol === 'pwm1');
  const witnesses = (transition.payload?.replayRecords ?? []).filter(item => item.txid === tx.txid && item.protocol === 'pwm1' && item.rawCandidate === true);
  if (records.length !== 1 || witnesses.length !== 1) return false;
  const row = records[0], witness = witnesses[0];
  return row.status === 'confirmed' && Number(row.block_height) === position.blockHeight && Number(row.block_index) === position.blockTransactionIndex &&
    Number(row.op_return_vout) === record.protocolVout && Number(row.record_ordinal) === 0 && row.raw_payload === record.message &&
    row.payload?._workAmoV5ReplayBound === true && row.payload?.workAmoV5RawCandidate === true &&
    witness.position?.blockHeight === position.blockHeight && witness.position?.blockHash === position.blockHash &&
    witness.position?.blockTransactionIndex === position.blockTransactionIndex && witness.position?.protocolVout === record.protocolVout &&
    witness.position?.recordOrdinal === 0 && witness.outcome?.valid === row.valid &&
    JSON.stringify(witness.rawWitness?.rawRecordParts) === JSON.stringify(record.rawRecordParts);
}
function subjectValid(text) {
  if (!/^pwm1:s:[A-Za-z0-9_-]*$/u.test(text)) return false;
  const encoded = text.slice(7), bytes = Buffer.from(encoded, 'base64url');
  try { return bytes.toString('base64url') === encoded && !new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0'); }
  catch { return false; }
}

const rawScriptHex = output => output?.scriptpubkey ?? output?.scriptPubKey?.hex;
function permissionScriptBytes(hex) {
  return typeof hex === 'string' && hex.length % 2 === 0 && /^[0-9a-f]*$/iu.test(hex) ? Buffer.from(hex, 'hex') : null;
}
/**
 * V1 deliberately supports only ordinary P2PKH inputs. A confirmed spend alone
 * does not prove approval of its capsule: NONE/SINGLE signatures omit outputs.
 * Verify the exact owner key and ALL digest of every supported input; unsupported
 * script paths remain visible rejected records instead of permission authority.
 */
export function permissionInputCommitmentErrors(tx, walletAddress, network = 'livenet') {
  const errors = [], reject = reason => { if (!errors.includes(reason)) errors.push(reason); };
  const inputs = Array.isArray(tx.vin) ? tx.vin : [];
  const checked = [];
  if (!inputs.length) { reject('permission-input-signature-unavailable'); return errors; }
  for (const input of inputs) {
    const prevout = input.prevout ?? input.previousOutput;
    const script = permissionScriptBytes(rawScriptHex(prevout));
    if (!script || !/^76a914[0-9a-f]{40}88ac$/u.test(script.toString('hex'))) {
      reject('permission-input-spend-path-unsupported'); continue;
    }
    let derivedAddress = '';
    try { derivedAddress = bitcoin.address.fromOutputScript(script, bitcoin.networks.bitcoin); } catch {}
    if (network !== 'livenet' || !walletAddress || derivedAddress !== walletAddress || address(prevout) !== derivedAddress) {
      reject('permission-input-public-key-mismatch'); continue;
    }
    const bytes = permissionScriptBytes(input.scriptsig ?? input.scriptSig?.hex);
    // Two minimal direct pushes: strict DER signature plus SEC public key. This
    // closes extra stack items, redeem scripts, executable tails and PUSHDATA.
    const signatureLength = bytes?.[0] ?? 0;
    const publicKeyLength = bytes?.[signatureLength + 1] ?? 0;
    if (!bytes || signatureLength < 9 || signatureLength > 73 ||
        ![33, 65].includes(publicKeyLength) || bytes.length !== signatureLength + publicKeyLength + 2 ||
        (Array.isArray(input.witness) && input.witness.length > 0) ||
        (Array.isArray(input.txinwitness) && input.txinwitness.length > 0)) {
      reject('permission-input-signature-unavailable'); continue;
    }
    const signatureBytes = bytes.subarray(1, signatureLength + 1);
    let signature;
    try { signature = bitcoin.script.signature.decode(signatureBytes); }
    catch { reject('permission-input-signature-unavailable'); continue; }
    if (signature.hashType !== bitcoin.Transaction.SIGHASH_ALL) {
      reject('permission-input-signature-sighash-unsupported'); continue;
    }
    const publicKey = bytes.subarray(signatureLength + 2);
    if (!((publicKey.length === 33 && (publicKey[0] === 2 || publicKey[0] === 3)) ||
          (publicKey.length === 65 && publicKey[0] === 4)) || !ecc.isPoint(publicKey) ||
        !Buffer.from(bitcoin.crypto.hash160(publicKey)).equals(script.subarray(3, 23))) {
      reject('permission-input-public-key-mismatch'); continue;
    }
    checked.push({ script, signature: signature.signature, publicKey });
  }
  if (!inputs.length || checked.length !== inputs.length) return errors;
  let transaction;
  try {
    if (!Number.isSafeInteger(tx.version) || tx.version < -0x80000000 || tx.version > 0x7fffffff ||
        !Number.isSafeInteger(tx.locktime) || tx.locktime < 0 || tx.locktime > 0xffffffff || !TXID.test(tx.txid ?? '')) throw new Error();
    transaction = new bitcoin.Transaction(); transaction.version = tx.version; transaction.locktime = tx.locktime;
    for (const input of inputs) {
      if (!TXID.test(input.txid ?? '') || !Number.isSafeInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff ||
          !Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.sequence > 0xffffffff) throw new Error();
      transaction.addInput(Buffer.from(input.txid, 'hex').reverse(), input.vout, input.sequence,
        permissionScriptBytes(input.scriptsig ?? input.scriptSig?.hex));
    }
    for (const output of tx.vout) {
      const script = permissionScriptBytes(rawScriptHex(output)), proofs = exactCodeOutputProofs(output);
      if (!script || proofs === null) throw new Error();
      transaction.addOutput(script, BigInt(proofs));
    }
    if (transaction.getId() !== tx.txid) throw new Error();
  } catch { reject('permission-signature-transaction-invalid'); return errors; }
  for (const [index, input] of checked.entries()) {
    try {
      const digest = transaction.hashForSignature(index, input.script, bitcoin.Transaction.SIGHASH_ALL);
      if (!ecc.verify(digest, input.publicKey, input.signature, false)) reject('permission-input-signature-invalid');
    } catch { reject('permission-input-signature-invalid'); }
  }
  return errors;
}

/** Raw scripts and independently hydrated prevouts establish authority, never a claimed PowID. */
export function verifyPermissionTransaction(tx, { network = 'livenet', activationHeight = PERMISSION_ACTIVATION_HEIGHT,
  feeRateActivationHeight = PERMISSION_FEE_RATE_ACTIVATION_HEIGHT } = {}) {
  const candidates = permissionCandidateParts(tx);
  if (!candidates.length) return null;
  const decoded = tx.vout.map((output, vout) => ({ ...decodeCanonicalOpReturnOutput(output), vout }));
  const carriers = decoded.filter(item => item.scriptPubKeyHex.startsWith('6a'));
  const messages = carriers.filter(item => item.decodeValid && item.text.startsWith('pwm1:m:'));
  const subjects = carriers.filter(item => item.decodeValid && item.text.startsWith('pwm1:s:'));
  const first = candidates[0], parsed = first.decoded.decodeValid ? parsePermissionBody(first.decoded.text.slice(7)) : null;
  const errors = [], reject = reason => { if (!errors.includes(reason)) errors.push(reason); };
  if (!TXID.test(tx.txid ?? '')) reject('permission-txid-invalid');
  if (candidates.length !== 1 || messages.length !== 1) reject('permission-body-ambiguous');
  if (!parsed) reject('permission-metadata-invalid');
  if (parsed && parsed.metadata.network !== network) reject('permission-network-mismatch');
  if (decoded.some(item => !item.scriptPubKeyHex) || carriers.some(item => !item.decodeValid || item.prefix !== 'pwm1:')) reject('permission-raw-carrier-invalid');
  if (carriers.some(item => !/^pwm1:(?:m|s):/u.test(item.text)) || subjects.length > 1 || subjects.some(item => !subjectValid(item.text))) reject('permission-mail-envelope-invalid');
  const carrierBytes = carriers.reduce((sum, item) => sum + item.scriptPubKeyHex.length / 2, 0);
  if (carrierBytes > 100000) reject('permission-carrier-budget-exceeded');
  const inputs = Array.isArray(tx.vin) ? tx.vin : [];
  const authors = inputs.map(input => address(input.prevout ?? input.previousOutput));
  const walletAddress = authors[0] ?? '';
  if (!walletAddress || inputs.length === 0 || inputs.some(input => input.coinbase !== undefined) || authors.some(value => value !== walletAddress)) reject('permission-input-authority-unavailable');
  const inputCommitmentErrors = permissionInputCommitmentErrors(tx, walletAddress, network);
  inputCommitmentErrors.forEach(reject);
  const walletScriptHex = String(rawScriptHex(inputs[0]?.prevout ?? inputs[0]?.previousOutput) ?? '').toLowerCase();
  let selfPayment = 0n;
  tx.vout.forEach((output, index) => {
    const value = exactCodeOutputProofs(output);
    if (value === null) reject('permission-output-value-invalid');
    else if (decoded[index].scriptPubKeyHex.startsWith('6a') && value !== '0') reject('permission-funded-carrier-invalid');
    else if (index < (carriers[0]?.vout ?? 0) && address(output) === walletAddress && decoded[index].scriptPubKeyHex === walletScriptHex) selfPayment += BigInt(value);
  });
  if (selfPayment < BigInt(PERMISSION_MIN_SELF_PAYMENT_PROOFS)) reject('permission-self-payment-insufficient');
  const confirmed = tx.status?.confirmed === true;
  const blockHeight = tx.status?.block_height, blockHash = tx.status?.block_hash, blockTransactionIndex = tx.blockTransactionIndex;
  if (confirmed && (!Number.isSafeInteger(blockHeight) || blockHeight < 1 || !TXID.test(blockHash ?? '') ||
      !Number.isSafeInteger(blockTransactionIndex) || blockTransactionIndex < 0)) reject('permission-canonical-position-unavailable');
  if (!Number.isSafeInteger(activationHeight) || activationHeight < 1) reject('permission-activation-disabled');
  else if (confirmed && Number.isSafeInteger(blockHeight) && blockHeight < activationHeight) reject('permission-before-activation');
  if (parsed?.metadata.v === 2) {
    if (!Number.isSafeInteger(feeRateActivationHeight) || feeRateActivationHeight < 1 || feeRateActivationHeight < activationHeight) reject('permission-fee-rate-activation-disabled');
    else if (confirmed && Number.isSafeInteger(blockHeight) && blockHeight < feeRateActivationHeight) reject('permission-fee-rate-before-activation');
  }
  return { txid: tx.txid, protocol: 'pwm1', app: 'Permission', action: parsed?.action ?? 'invalid',
    kind: `permission-${parsed?.action ?? 'invalid'}`, walletAddress, authorAddress: walletAddress,
    metadata: parsed?.metadata ?? null, rootTxid: parsed?.action === 'grant' ? tx.txid : parsed?.metadata.grant ?? '',
    parentTxid: parsed?.metadata.parent ?? '', confirmed, status: confirmed ? 'confirmed' : 'pending',
    blockHeight, blockHash, blockTransactionIndex, blockTime: tx.timestamp ?? null,
    protocolVout: first.vout, recordOrdinal: 0, rawBody: first.decoded.decodeValid ? first.decoded.text.slice(7) : '',
    selfPaymentProofs: selfPayment.toString(), carrierBytes, ownerSignatureOutputCommitmentVerified: inputCommitmentErrors.length === 0 && inputs.length > 0, valid: errors.length === 0,
    applied: false, validationErrors: errors };
}
export function replayPermissionTransactions(transactions, options = {}) {
  const events = transactions.map(tx => verifyPermissionTransaction(tx, options)).filter(Boolean).sort((a, b) => Number(b.confirmed) - Number(a.confirmed) ||
    (a.confirmed ? a.blockHeight - b.blockHeight || a.blockTransactionIndex - b.blockTransactionIndex || a.protocolVout - b.protocolVout : a.txid.localeCompare(b.txid)));
  const current = new Map(), versions = new Map(), seen = new Set(), positions = new Set(), hashes = new Map();
  for (const event of events) {
    if (seen.has(event.txid)) throw permissionReadError('Permission replay contains duplicate transaction evidence.');
    seen.add(event.txid);
    if (event.confirmed && !event.validationErrors.includes('permission-canonical-position-unavailable')) {
      const position = `${event.blockHeight}:${event.blockTransactionIndex}`;
      if (positions.has(position) || (hashes.has(event.blockHeight) && hashes.get(event.blockHeight) !== event.blockHash)) throw permissionReadError('Permission replay contains ambiguous canonical positions.');
      positions.add(position); hashes.set(event.blockHeight, event.blockHash);
    }
    if (!event.confirmed || !event.valid) continue;
    const reject = reason => { event.valid = false; event.validationErrors.push(reason); };
    const old = current.get(event.rootTxid);
    if (event.action !== 'grant') {
      if (!old) { reject('permission-grant-unavailable'); continue; }
      if (old.walletAddress !== event.walletAddress) { reject('permission-owner-mismatch'); continue; }
      if (old.status !== 'active') { reject('permission-grant-revoked'); continue; }
      if (old.headTxid !== event.parentTxid) { reject('permission-parent-stale'); continue; }
      if (old.blockHeight >= event.blockHeight) { reject('permission-parent-not-earlier-confirmed-block'); continue; }
      old.status = event.action === 'revoke' ? 'revoked' : 'replaced';
      old.changedByTxid = event.txid;
      old.changedAtBlock = event.blockHeight;
    }
    if (event.action === 'revoke') {
      current.set(event.rootTxid, { ...old, headTxid: event.txid, status: 'revoked' });
    } else {
      const value = { txid: event.txid, rootTxid: event.rootTxid, headTxid: event.txid,
        walletAddress: event.walletAddress, label: event.metadata.label, policy: event.metadata.policy,
        status: 'active', blockHeight: event.blockHeight, blockHash: event.blockHash,
        blockTransactionIndex: event.blockTransactionIndex, blockTime: event.blockTime };
      versions.set(event.txid, value); current.set(event.rootTxid, value);
    }
    event.applied = true;
  }
  return { permissions: [...current.values()], versions: [...versions.values()], events };
}
export function permissionReadError(message, statusCode = 503, code = 'PERMISSION_UNAVAILABLE') {
  return Object.assign(new Error(message), { statusCode, details: { code } });
}
const token = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeToken(value) {
  try {
    if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (token(parsed) !== value) throw new Error(); return parsed;
  } catch { throw permissionReadError('Permission continuation is invalid; restart the read.', 400, 'PERMISSION_CURSOR_INVALID'); }
}
export function permissionSnapshotRequest(params, network) {
  const continuation = params.get('cursor') ? decodeToken(params.get('cursor')) : null;
  const explicit = params.get('snapshot'), snapshot = continuation?.snapshot ?? (explicit ? decodeToken(explicit) : null);
  if (snapshot && (snapshot.model !== PERMISSION_SNAPSHOT_MODEL || snapshot.network !== network || !Number.isSafeInteger(snapshot.checkpointHeight) || snapshot.checkpointHeight < 1 || !TXID.test(snapshot.checkpointHash))) throw permissionReadError('Permission snapshot is invalid.', 400, 'PERMISSION_SNAPSHOT_INVALID');
  if (continuation && (!Number.isSafeInteger(continuation.offset) || continuation.offset < 0 || (explicit && token(snapshot) !== explicit))) throw permissionReadError('Permission cursor is invalid.', 400, 'PERMISSION_CURSOR_INVALID');
  return { snapshot, continuation };
}
export function createPermissionSnapshot({ network, checkpointHeight, checkpointHash, transactions, generatedAt,
  activationHeight = PERMISSION_ACTIVATION_HEIGHT, activationPreviousBlockHash = PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH,
  feeRateActivationHeight = PERMISSION_FEE_RATE_ACTIVATION_HEIGHT,
  feeRateActivationPreviousBlockHash = PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH,
  feeRateAdmissionVerified = false, writesEnabled = false }) {
  if (network !== 'livenet' || !Number.isSafeInteger(checkpointHeight) || checkpointHeight < 1 || !TXID.test(checkpointHash)) throw permissionReadError('Permission has no exact canonical checkpoint.');
  if (transactions.some(tx => tx.status?.confirmed === true && (tx.status.block_height > checkpointHeight ||
      (tx.status.block_height === checkpointHeight && tx.status.block_hash !== checkpointHash)))) throw permissionReadError('Permission source transaction exceeds or differs from its exact checkpoint.');
  const feeRateParentVerified = feeRateAdmissionVerified === true && Number.isSafeInteger(activationHeight) && activationHeight > 0 && Number.isSafeInteger(feeRateActivationHeight) &&
    feeRateActivationHeight >= activationHeight && TXID.test(feeRateActivationPreviousBlockHash ?? '');
  const options = { network, activationHeight, feeRateActivationHeight: feeRateParentVerified ? feeRateActivationHeight : 0 };
  const snapshot = { model: PERMISSION_SNAPSHOT_MODEL, network, checkpointHeight, checkpointHash };
  const confirmed = replayPermissionTransactions(transactions.filter(tx => tx.status?.confirmed === true), options);
  const observed = replayPermissionTransactions(transactions, options);
  return { ...confirmed, pendingEvents: observed.events.filter(event => !event.confirmed),
    snapshot: { ...snapshot, id: token(snapshot) }, generatedAt, activationHeight, activationPreviousBlockHash,
    feeRateActivationHeight, feeRateActivationPreviousBlockHash, feeRateAdmissionVerified: feeRateParentVerified, writesEnabled };
}
function requestAtSnapshot(state, params) {
  const request = permissionSnapshotRequest(params, state.snapshot.network);
  const { id, ...expected } = state.snapshot;
  if (request.snapshot && token(request.snapshot) !== token(expected)) throw permissionReadError('Permission snapshot changed; restart the read.', 409, 'PERMISSION_SNAPSHOT_CHANGED');
  return request;
}
function envelope(state) {
  const indexedThroughBlock = state.snapshot.checkpointHeight, checkpointHash = state.snapshot.checkpointHash;
  return { network: state.snapshot.network, snapshot: state.snapshot, snapshotId: state.snapshot.id,
    indexedThroughBlock, indexedThroughBlockHash: checkpointHash, checkpointHash,
    generatedAt: state.generatedAt, complete: true, source: 'proof-indexer-exact-canonical-permission-replay',
    coverage: { complete: true, indexedThroughBlock, checkpointHash, activationHeight: state.activationHeight,
      witnessSha256: state.discoveryWitnessSha256 ?? null },
    admission: { ready: state.writesEnabled === true && state.activationHeight > 0,
      writesEnabled: state.writesEnabled === true, activationHeight: state.activationHeight,
      activationPreviousBlockHash: state.activationPreviousBlockHash, minimumSelfPaymentProofs: PERMISSION_MIN_SELF_PAYMENT_PROOFS,
      supportedRecordVersions: [1, 2], feeRateActivationHeight: state.feeRateActivationHeight,
      feeRateActivationPreviousBlockHash: state.feeRateActivationPreviousBlockHash,
      feeRatePolicyReady: state.writesEnabled === true && state.activationHeight > 0 && state.feeRateAdmissionVerified === true &&
        indexedThroughBlock >= state.feeRateActivationHeight,
      autonomousSigningEnabled: false, reason: state.writesEnabled === true ? null : 'permission-writes-disabled' },
    evidence: { complete: true, authorityVerified: true, checkpoint: { height: indexedThroughBlock, hash: checkpointHash }, verifiedAt: state.generatedAt },
    budget: { available: false, reset: 'UTC', scope: 'wallet', reason: 'protected-controller-required' },
    pendingComplete: false, pendingBestEffort: true, pendingWarnings: state.pendingWarnings ?? [] };
}
export function permissionsPayload(state, params = new URLSearchParams()) {
  const { continuation } = requestAtSnapshot(state, params);
  const owner = params.get('address') ?? params.get('owner') ?? '', q = (params.get('q') ?? '').toLowerCase();
  const scope = JSON.stringify(['permissions', owner, q]);
  if (continuation && continuation.scope !== scope) throw permissionReadError('Permission cursor belongs to another query.', 400, 'PERMISSION_CURSOR_SCOPE');
  const limitText = params.get('limit') ?? '30';
  if (!/^[1-9]\d{0,2}$/u.test(limitText) || Number(limitText) > 200) throw permissionReadError('Permission limit must be from 1 to 200.', 400, 'PERMISSION_LIMIT_INVALID');
  const permissions = state.permissions.filter(item => (!owner || item.walletAddress === owner) && (!q || `${item.txid}\n${item.rootTxid}\n${item.label}\n${item.walletAddress}`.toLowerCase().includes(q))).reverse();
  const offset = continuation?.offset ?? 0, limit = Number(limitText);
  if (offset > permissions.length) throw permissionReadError('Permission cursor exceeds this snapshot.', 400, 'PERMISSION_CURSOR_INVALID');
  const values = permissions.slice(offset, offset + limit), hasMore = offset + values.length < permissions.length;
  const { id, ...snapshot } = state.snapshot;
  return { ...envelope(state), permissions: values, stats: { grants: state.permissions.length,
    active: state.permissions.filter(item => item.status === 'active').length, revoked: state.permissions.filter(item => item.status === 'revoked').length,
    events: state.events.length, invalidEvents: state.events.filter(item => !item.valid).length },
    pagination: { limit, total: permissions.length, hasMore, nextCursor: hasMore ? token({ snapshot, scope, offset: offset + values.length }) : null }, pendingEvents: state.pendingEvents };
}
export function permissionPayload(state, params = new URLSearchParams()) {
  requestAtSnapshot(state, params);
  const txid = params.get('permission') ?? params.get('txid') ?? '';
  if (!TXID.test(txid)) throw permissionReadError('Permission must be a grant transaction ID.', 400, 'PERMISSION_TXID_INVALID');
  const permission = state.versions.find(item => item.txid === txid);
  if (!permission) throw permissionReadError('Permission grant is absent from this confirmed snapshot.', 404, 'PERMISSION_NOT_FOUND');
  const currentPermission = state.permissions.find(item => item.rootTxid === permission.rootTxid);
  const events = state.events.filter(item => item.rootTxid === permission.rootTxid);
  if (Buffer.byteLength(JSON.stringify(events)) > 8 * 1024 * 1024) throw permissionReadError('Permission history exceeds the verified response bound.');
  return { ...envelope(state), grantTxid: txid, walletAddress: permission.walletAddress,
    status: permission.status, policy: permission.policy, permission, currentPermission, currentStatusVerified: true,
    events, eventsComplete: true, env: permissionPolicyEnv(permission.policy),
    pendingEvents: state.pendingEvents.filter(item => item.rootTxid === permission.rootTxid) };
}
/** Isolated record inspection never asserts absence of a later replacement or revocation. */
export function permissionRecordPayload(tx, options = {}) {
  const record = verifyPermissionTransaction(tx, options);
  if (!record) throw permissionReadError('Transaction contains no Permission carrier.', 404, 'PERMISSION_CARRIER_NOT_FOUND');
  return { network: options.network ?? 'livenet', complete: false, currentStatusVerified: false,
    authorityVerified: record.valid && record.confirmed, source: 'first-party-raw-permission-record', record,
    admission: { ready: false, autonomousSigningEnabled: false, reason: 'complete-permission-history-required' },
    budget: { available: false, reason: 'protected-controller-required' } };
}
