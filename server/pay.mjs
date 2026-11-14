import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { parsePayBody, normalizePayAmount, PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH,
  PAY_WORK_TOKEN_ID, PAY_WORK_REGISTRY_ADDRESS } from '../src/shared/protocol/pay.mjs';
import { decodeCanonicalOpReturnOutput, canonicalRawProtocolRecordSetFromTransaction } from './canonical-op-return.mjs';
import { exactCodeOutputProofs } from './code-repositories.mjs';
import { permissionInputCommitmentErrors } from './permissions.mjs';
import { verifyMailWorkSettlement } from './mail-work-settlement.mjs';

export const PAY_DISCOVERY_MODEL = 'canonical-pay-candidate-discovery-v1';
export const PAY_DISCOVERY_META_KEY = 'pay:candidate-discovery';
export const PAY_SNAPSHOT_MODEL = 'proof-pay-snapshot-v1';
export const PAY_DISCOVERY_EMPTY_SHA256 = createHash('sha256').update('ProofOfWork.Me/Pay/candidate-discovery/v1\n').digest('hex');
const TXID = /^[0-9a-f]{64}$/u;
const markerHex = Buffer.from('pwm1:m:pwpay1:', 'ascii').toString('hex');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const rawScript = output => output?.scriptpubkey ?? output?.scriptPubKey?.hex ?? '';
function address(output) {
  try { return bitcoin.address.fromOutputScript(Buffer.from(rawScript(output), 'hex'), bitcoin.networks.bitcoin); }
  catch { return ''; }
}
export const isPayCandidatePart = decoded => decoded.payloadHex.startsWith(markerHex);
export function payCandidateParts(tx) {
  return (tx.vout ?? []).map((output, vout) => ({ vout, decoded: decodeCanonicalOpReturnOutput(output) })).filter(item => isPayCandidatePart(item.decoded));
}
export function advancePayCandidateDigest(prior, tx) {
  return sha256(Buffer.from(JSON.stringify({ prior, txid: tx.txid, height: tx.status?.block_height ?? tx.height,
    hash: tx.status?.block_hash ?? tx._powBlockHash, index: tx.blockTransactionIndex ?? tx._powBlockIndex,
    candidates: payCandidateParts(tx).map(item => ({ vout: item.vout, script: item.decoded.scriptPubKeyHex })) })));
}
/** Bind Pay to its existing raw Mail record. This creates no new economic event. */
export function payCandidateEventClosure(tx, rows, position, transition) {
  const record = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(item => item.protocol === 'pwm1');
  if (!record || !payCandidateParts(tx).length || !transition || Number(transition.block_height) !== position.blockHeight || transition.block_hash !== position.blockHash) return false;
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
    same(witness.rawWitness?.rawRecordParts, record.rawRecordParts);
}
export function verifyPayWorkSettlement(tx, event, recipient, amount) {
  const result = verifyMailWorkSettlement(tx, event, recipient, amount, {
    evidenceKey: '_payWorkSettlementEvidence', candidateEventClosure: payCandidateEventClosure, reasonPrefix: 'pay',
  });
  if (result.valid || result.reason === 'pay-agreed-work-payment-mismatch') return result;
  const evidence = tx?._payWorkSettlementEvidence, row = evidence?.length === 1 ? evidence[0] : null;
  const transition = row?.transition, position = { blockHeight: event.blockHeight, blockHash: event.blockHash,
    blockTransactionIndex: event.blockTransactionIndex, protocolVout: event.workTransfer?.protocolVout, recordOrdinal: 0 };
  const witnesses = transition?.payload?.replayRecords?.filter(item => item?.txid === event.txid && item.protocol === 'pwt1' && same(item.position, position)) ?? [];
  const traces = transition?.payload?.traces?.filter(item => item?.txid === event.txid && item.kind === 'protocol-record' && same(item.position, position)) ?? [];
  const witness = witnesses.length === 1 ? witnesses[0] : null, trace = traces.length === 1 ? traces[0] : null;
  const raw = canonicalRawProtocolRecordSetFromTransaction(tx).records.find(item => item.protocol === 'pwt1' && item.protocolVout === position.protocolVout);
  const rejected = row?.network === 'livenet' && row.txid === event.txid && row.protocol === 'pwt1' && row.status === 'confirmed' && row.valid === false &&
    Number(row.block_height) === position.blockHeight && row.block_hash === position.blockHash && Number(row.block_index) === position.blockTransactionIndex &&
    Number(row.op_return_vout) === position.protocolVout && Number(row.record_ordinal) === 0 && row.raw_payload === event.workTransfer?.rawPayload &&
    row.payload?._workAmoV5ReplayBound === true && row.payload?.workAmoV5RawCandidate === true && row.payload?.workAmoV5ReplayOutcome?.valid === false &&
    transition?.complete === true && transition.block_atomic === true && transition.fee_once === true && transition.invalid_zero === true &&
    witness?.rawCandidate === true && witness.outcome?.valid === false && trace?.valid === false &&
    same(witness.outcome, row.payload.workAmoV5ReplayOutcome) && same(witness.rawWitness, row.payload.workAmoV5ReplayRawWitness) &&
    same(witness.rawWitness, trace.rawWitness) && same(witness.output, trace.output) && same(witness.output, row.payload.workAmoV5ReplayOutput) &&
    same(witness.stateDelta, trace.stateDelta) && raw && same(witness.rawWitness?.rawRecordParts, raw.rawRecordParts);
  if (rejected) return { valid: false, reason: 'pay-work-transfer-canonically-rejected' };
  throw payReadError('Pay WORK settlement evidence is missing or inconsistent; an unpaid balance cannot be asserted.', 503, 'PAY_WORK_SETTLEMENT_UNAVAILABLE');
}
function validSubject(text) {
  if (!/^pwm1:s:[A-Za-z0-9_-]*$/u.test(text)) return false;
  const encoded = text.slice(7), bytes = Buffer.from(encoded, 'base64url');
  try { return bytes.toString('base64url') === encoded && !new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0'); }
  catch { return false; }
}
/** Full supported input signatures commit to exact outputs. Decoding alone conveys no authority. */
export function verifyPayTransaction(tx, { network = 'livenet', activationHeight = PAY_ACTIVATION_HEIGHT } = {}) {
  const candidates = payCandidateParts(tx);
  if (!candidates.length) return null;
  const decoded = tx.vout.map((output, vout) => ({ ...decodeCanonicalOpReturnOutput(output), vout }));
  const carriers = decoded.filter(item => item.scriptPubKeyHex.startsWith('6a'));
  const pwm = carriers.filter(item => item.prefix === 'pwm1:');
  const messages = pwm.filter(item => item.decodeValid && item.text.startsWith('pwm1:m:'));
  const first = candidates[0], parsed = first.decoded.decodeValid ? parsePayBody(first.decoded.text.slice(7)) : null;
  const workCarriers = carriers.filter(item => item.prefix === 'pwt1:');
  const errors = [], reject = reason => { if (!errors.includes(reason)) errors.push(reason); };
  if (network !== 'livenet') reject('pay-network-unsupported');
  if (!TXID.test(tx.txid ?? '')) reject('pay-txid-invalid');
  if (candidates.length !== 1 || messages.length !== 1) reject('pay-body-ambiguous');
  if (!parsed) reject('pay-metadata-invalid');
  if (decoded.some(item => !item.scriptPubKeyHex) || carriers.some(item => !item.decodeValid ||
      (item.prefix !== 'pwm1:' && !(parsed?.action === 'pay' && item.prefix === 'pwt1:')))) reject('pay-raw-carrier-invalid');
  if (pwm.some(item => !/^pwm1:(?:m|s):/u.test(item.text))) reject('pay-mail-envelope-invalid');
  const subjects = pwm.filter(item => item.text.startsWith('pwm1:s:'));
  if (subjects.length > 1 || subjects.some(item => !validSubject(item.text))) reject('pay-mail-subject-invalid');
  const carrierBytes = carriers.reduce((sum, item) => sum + item.scriptPubKeyHex.length / 2, 0);
  if (carrierBytes > 100000) reject('pay-carrier-budget-exceeded');
  const inputs = Array.isArray(tx.vin) ? tx.vin : [];
  const authors = inputs.map(input => address(input.prevout ?? input.previousOutput));
  const authorAddress = authors[0] ?? '';
  if (!authorAddress || !inputs.length || inputs.some(input => input.coinbase !== undefined) || authors.some(value => value !== authorAddress)) reject('pay-input-authority-unavailable');
  const commitments = permissionInputCommitmentErrors(tx, authorAddress, network).map(reason => reason.replace(/^permission-/, 'pay-'));
  commitments.forEach(reject);
  let workTransfer;
  if (workCarriers.length) {
    const transfer = workCarriers.length === 1 && /^pwt1:send3:([0-9a-f]{64}):([1-9]\d*):([^:]+)$/u.exec(workCarriers[0].text);
    const amount = transfer && normalizePayAmount({ asset: 'WORK', token: transfer[1], amountSubatoms: transfer[2] });
    const lastMail = pwm.at(-1)?.vout ?? -1;
    const registry = transfer ? tx.vout.map((output, vout) => ({ output, vout })).filter(item =>
      item.vout > lastMail && item.vout < workCarriers[0].vout && address(item.output) === PAY_WORK_REGISTRY_ADDRESS) : [];
    if (parsed?.action !== 'pay' || !amount || lastMail >= workCarriers[0].vout || registry.length !== 1 ||
        exactCodeOutputProofs(registry[0].output) !== '546') reject('pay-work-transfer-shape-invalid');
    else workTransfer = { token: amount.token, amountSubatoms: amount.amountSubatoms, recipientAddress: transfer[3],
      rawPayload: workCarriers[0].text, protocolVout: workCarriers[0].vout, registryVout: registry[0].vout };
  }
  if (parsed?.action === 'invoice') {
    try { bitcoin.address.toOutputScript(parsed.metadata.recipient, bitcoin.networks.bitcoin); }
    catch { reject('pay-recipient-address-invalid'); }
  }
  const payments = new Map();
  tx.vout.forEach((output, index) => {
    const value = exactCodeOutputProofs(output);
    if (value === null) reject('pay-output-value-invalid');
    else if (decoded[index].scriptPubKeyHex.startsWith('6a') && value !== '0') reject('pay-funded-carrier-invalid');
    else if (index < (pwm[0]?.vout ?? 0) && address(output)) payments.set(address(output), (payments.get(address(output)) ?? 0n) + BigInt(value));
  });
  const confirmed = tx.status?.confirmed === true;
  const blockHeight = tx.status?.block_height, blockHash = tx.status?.block_hash, blockTransactionIndex = tx.blockTransactionIndex;
  if (confirmed && (!Number.isSafeInteger(blockHeight) || blockHeight < 1 || !TXID.test(blockHash ?? '') ||
      !Number.isSafeInteger(blockTransactionIndex) || blockTransactionIndex < 0)) reject('pay-canonical-position-unavailable');
  if (!Number.isSafeInteger(activationHeight) || activationHeight < 1) reject('pay-activation-disabled');
  else if (confirmed && Number.isSafeInteger(blockHeight) && blockHeight < activationHeight) reject('pay-before-activation');
  const metadata = parsed?.metadata ?? null;
  return { txid: tx.txid, protocol: 'pwm1', app: 'Pay', action: parsed?.action ?? 'invalid', kind: `pay-${parsed?.action ?? 'invalid'}`,
    authorAddress, metadata, invoiceTxid: parsed?.action === 'invoice' ? tx.txid : metadata?.invoice ?? '',
    confirmed, status: confirmed ? 'confirmed' : 'pending', blockHeight, blockHash, blockTransactionIndex,
    blockTime: tx.timestamp ?? null, protocolVout: first.vout, recordOrdinal: 0, rawBody: first.decoded.decodeValid ? first.decoded.text.slice(7) : '',
    payments: Object.fromEntries([...payments].map(([key, value]) => [key, value.toString()])),
    amountSats: [...payments.values()].reduce((sum, value) => sum + value, 0n).toString(), carrierBytes,
    ownerSignatureOutputCommitmentVerified: commitments.length === 0 && inputs.length > 0,
    valid: errors.length === 0, applied: false, validationErrors: errors, ...(workTransfer ? { workTransfer } : {}) };
}

export function replayPayTransactions(transactions, options = {}) {
  const source = new Map(transactions.map(tx => [tx.txid, tx]));
  const events = transactions.map(tx => verifyPayTransaction(tx, options)).filter(Boolean).sort((a, b) => Number(b.confirmed) - Number(a.confirmed) ||
    (a.confirmed ? a.blockHeight - b.blockHeight || a.blockTransactionIndex - b.blockTransactionIndex || a.protocolVout - b.protocolVout : a.txid.localeCompare(b.txid)));
  const invoices = new Map(), seen = new Set(), positions = new Set(), hashes = new Map();
  for (const event of events) {
    if (seen.has(event.txid)) throw payReadError('Pay replay contains duplicate transaction evidence.');
    seen.add(event.txid);
    if (event.confirmed && !event.validationErrors.includes('pay-canonical-position-unavailable')) {
      const slot = `${event.blockHeight}:${event.blockTransactionIndex}`;
      if (positions.has(slot) || (hashes.has(event.blockHeight) && hashes.get(event.blockHeight) !== event.blockHash)) throw payReadError('Pay replay contains ambiguous canonical positions.');
      positions.add(slot); hashes.set(event.blockHeight, event.blockHash);
    }
    if (!event.confirmed || !event.valid) continue;
    const reject = reason => { event.valid = false; event.validationErrors.push(reason); };
    const tx = source.get(event.txid), closure = tx._payMailEvidence;
    if (!closure || !payCandidateEventClosure(tx, closure.rows, event, closure.transition)) {
      throw payReadError('Pay canonical Mail closure is unavailable; settlement cannot be asserted.', 503, 'PAY_MAIL_EVIDENCE_UNAVAILABLE');
    }
    if (closure.rows[0]?.valid !== true) { reject('pay-mail-canonically-rejected'); continue; }
    const payment = recipient => BigInt(event.payments[recipient] ?? '0');
    const value = event.metadata;
    if (event.action === 'invoice') {
      if (payment(event.authorAddress) < 546n) { reject('pay-self-payment-insufficient'); continue; }
      if (value.reference !== null) {
        const evidence = tx._payReferenceEvidence;
        if (!evidence || evidence.txid !== value.reference || typeof evidence.confirmed !== 'boolean') {
          throw payReadError('Invoice reference evidence is unavailable.', 503, 'PAY_REFERENCE_UNAVAILABLE');
        }
        if (!evidence.confirmed || !Number.isSafeInteger(evidence.blockHeight) || !TXID.test(evidence.blockHash ?? '') || evidence.blockHeight >= event.blockHeight) {
          reject('pay-reference-not-earlier-confirmed-block'); continue;
        }
      }
      invoices.set(event.txid, { txid: event.txid, issuerAddress: event.authorAddress, recipientAddress: value.recipient,
        title: value.title, description: value.description, amount: value.amount, reference: value.reference,
        status: 'open', headTxid: event.txid, paymentTxid: '', payerAddress: '', paidAmount: null,
        createdAt: event.blockTime, updatedAt: event.blockTime, blockTime: event.blockTime,
        blockHeight: event.blockHeight, blockHash: event.blockHash, blockTransactionIndex: event.blockTransactionIndex });
      event.applied = true; continue;
    }
    const invoice = invoices.get(event.invoiceTxid);
    if (!invoice) { reject('pay-invoice-unavailable'); continue; }
    if (invoice.blockHeight >= event.blockHeight) { reject('pay-invoice-not-earlier-confirmed-block'); continue; }
    if (event.action === 'cancel') {
      if (event.authorAddress !== invoice.issuerAddress) { reject('pay-issuer-authority-mismatch'); continue; }
      if (invoice.status !== 'open') { reject('pay-invoice-already-closed'); continue; }
      if (payment(event.authorAddress) < 546n) { reject('pay-self-payment-insufficient'); continue; }
      Object.assign(invoice, { status: 'cancelled', headTxid: event.txid, updatedAt: event.blockTime });
      event.applied = true; continue;
    }
    if (event.authorAddress === invoice.recipientAddress) { reject('pay-self-settlement-not-allowed'); continue; }
    // Verify actual payments even after closure, preserving additional-payment evidence.
    if (invoice.amount.asset === 'WORK') {
      if (payment(invoice.recipientAddress) < 546n) { reject('pay-recipient-signal-insufficient'); continue; }
      const settlement = verifyPayWorkSettlement(tx, event, invoice.recipientAddress, invoice.amount);
      if (!settlement.valid) { reject(settlement.reason); continue; }
      event.workSettlement = settlement;
    } else {
      if (event.workTransfer) { reject('pay-unexpected-work-transfer'); continue; }
      if (payment(invoice.recipientAddress) !== BigInt(invoice.amount.amountSats)) { reject('pay-exact-payment-mismatch'); continue; }
    }
    event.paymentMatchesInvoice = true;
    if (invoice.status !== 'open') { event.additionalPayment = true; reject(invoice.status === 'paid' ? 'pay-additional-payment' : 'pay-payment-after-cancellation'); continue; }
    Object.assign(invoice, { status: 'paid', headTxid: event.txid, paymentTxid: event.txid, payerAddress: event.authorAddress,
      paidAmount: { ...invoice.amount }, updatedAt: event.blockTime, ...(event.workSettlement ? { workSettlement: event.workSettlement } : {}) });
    event.applied = true;
  }
  return { invoices: [...invoices.values()], events };
}

export function payReadError(message, statusCode = 503, code = 'PAY_UNAVAILABLE') { return Object.assign(new Error(message), { statusCode, details: { code } }); }
const token = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeToken(value) {
  try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); if (value.length > 4096 || token(parsed) !== value) throw new Error(); return parsed; }
  catch { throw payReadError('Pay continuation is invalid; restart the read.', 400, 'PAY_CURSOR_INVALID'); }
}
export function paySnapshotRequest(params, network) {
  const continuation = params.get('cursor') ? decodeToken(params.get('cursor')) : null;
  const explicit = params.get('snapshot'), snapshot = continuation?.snapshot ?? (explicit ? decodeToken(explicit) : null);
  if (snapshot && (snapshot.model !== PAY_SNAPSHOT_MODEL || snapshot.network !== network || !Number.isSafeInteger(snapshot.checkpointHeight) || snapshot.checkpointHeight < 1 || !TXID.test(snapshot.checkpointHash))) throw payReadError('Pay snapshot is invalid.', 400, 'PAY_SNAPSHOT_INVALID');
  if (continuation && (!Number.isSafeInteger(continuation.offset) || continuation.offset < 0 || (explicit && token(snapshot) !== explicit))) throw payReadError('Pay cursor is invalid.', 400, 'PAY_CURSOR_INVALID');
  return { snapshot, continuation };
}
export function createPaySnapshot({ network, checkpointHeight, checkpointHash, transactions, generatedAt,
  activationHeight = PAY_ACTIVATION_HEIGHT, activationPreviousBlockHash = PAY_ACTIVATION_PREVIOUS_BLOCK_HASH }) {
  if (network !== 'livenet' || !Number.isSafeInteger(checkpointHeight) || checkpointHeight < 1 || !TXID.test(checkpointHash)) throw payReadError('Pay has no exact canonical checkpoint.');
  const options = { network, activationHeight };
  const confirmed = replayPayTransactions(transactions.filter(tx => tx.status?.confirmed === true), options);
  const observed = replayPayTransactions(transactions, options);
  const snapshot = { model: PAY_SNAPSHOT_MODEL, network, checkpointHeight, checkpointHash };
  return { ...confirmed, pendingEvents: observed.events.filter(event => !event.confirmed), snapshot: { ...snapshot, id: token(snapshot) },
    generatedAt, activationHeight, activationPreviousBlockHash };
}
function envelope(state) {
  const ready = Number.isSafeInteger(state.activationHeight) && state.activationHeight > 0 &&
    TXID.test(state.activationPreviousBlockHash ?? '') && state.snapshot.checkpointHeight >= state.activationHeight;
  return { network: state.snapshot.network, snapshot: state.snapshot, snapshotId: state.snapshot.id,
    activation: { height: state.activationHeight, previousBlockHash: state.activationPreviousBlockHash, ready },
    admission: { ready: false, writesEnabled: false, reason: 'Fresh exact-tip admission is required before local signing.' },
    indexedThroughBlock: state.snapshot.checkpointHeight, indexedThroughBlockHash: state.snapshot.checkpointHash,
    generatedAt: state.generatedAt, complete: true, source: 'proof-indexer-exact-canonical-pay-replay', pendingComplete: false,
    pendingBestEffort: true, pendingWarnings: state.pendingWarnings ?? [] };
}
export function payStats(state) {
  const count = status => state.invoices.filter(invoice => invoice.status === status).length;
  return { invoices: state.invoices.length, open: count('open'), paid: count('paid'), cancelled: count('cancelled'),
    paidProofs: state.invoices.reduce((sum, invoice) => sum + BigInt(invoice.paidAmount?.asset === 'proofs' ? invoice.paidAmount.amountSats : '0'), 0n).toString(),
    paidWorkSubatoms: state.invoices.reduce((sum, invoice) => sum + BigInt(invoice.paidAmount?.asset === 'WORK' ? invoice.paidAmount.amountSubatoms : '0'), 0n).toString(),
    events: state.events.length, invalidEvents: state.events.filter(event => !event.valid).length,
    additionalPayments: state.events.filter(event => event.additionalPayment).length };
}
export function payInvoicesPayload(state, params = new URLSearchParams()) {
  const { continuation } = paySnapshotRequest(params, state.snapshot.network);
  const addressFilter = params.get('address') ?? '', q = (params.get('q') ?? '').toLowerCase(), status = params.get('status') ?? '';
  if (status && !['open', 'paid', 'cancelled'].includes(status)) throw payReadError('Pay status filter is invalid.', 400, 'PAY_STATUS_INVALID');
  const scope = JSON.stringify(['invoices', addressFilter, q, status]);
  if (continuation && continuation.scope !== scope) throw payReadError('Pay cursor belongs to another query.', 400, 'PAY_CURSOR_SCOPE');
  const limitText = params.get('limit') ?? '30';
  if (!/^[1-9]\d{0,2}$/u.test(limitText) || Number(limitText) > 200) throw payReadError('Pay limit must be from 1 to 200.', 400, 'PAY_LIMIT_INVALID');
  const involved = new Set(state.events.filter(event => event.authorAddress === addressFilter).map(event => event.invoiceTxid));
  const invoices = state.invoices.filter(invoice => (!addressFilter || invoice.issuerAddress === addressFilter || invoice.recipientAddress === addressFilter || involved.has(invoice.txid)) &&
    (!status || invoice.status === status) && (!q || `${invoice.title}\n${invoice.description}\n${invoice.txid}\n${invoice.issuerAddress}\n${invoice.recipientAddress}\n${invoice.reference ?? ''}`.toLowerCase().includes(q))).reverse();
  const offset = continuation?.offset ?? 0, limit = Number(limitText);
  if (offset > invoices.length) throw payReadError('Pay cursor exceeds the snapshot.', 400, 'PAY_CURSOR_INVALID');
  const values = invoices.slice(offset, offset + limit), hasMore = offset + values.length < invoices.length;
  const { id, ...snapshot } = state.snapshot;
  return { ...envelope(state), invoices: values, stats: payStats(state), pagination: { limit, total: invoices.length, hasMore,
    nextCursor: hasMore ? token({ snapshot, scope, offset: offset + values.length }) : null },
    pendingEvents: state.pendingEvents.filter(event => !addressFilter || event.authorAddress === addressFilter ||
      state.invoices.some(invoice => invoice.txid === event.invoiceTxid && [invoice.issuerAddress, invoice.recipientAddress].includes(addressFilter))) };
}
export function payInvoicePayload(state, params = new URLSearchParams()) {
  const txid = params.get('invoice') ?? '';
  if (!TXID.test(txid)) throw payReadError('Invoice must be its publication transaction ID.', 400, 'PAY_INVOICE_INVALID');
  const invoice = state.invoices.find(item => item.txid === txid);
  if (!invoice) throw payReadError('Invoice is absent from this confirmed snapshot.', 404, 'PAY_INVOICE_NOT_FOUND');
  const events = state.events.filter(event => event.invoiceTxid === txid);
  if (Buffer.byteLength(JSON.stringify(events)) > 8 * 1024 * 1024) throw payReadError('Invoice history exceeds the verified response bound; it cannot be presented as complete.');
  const payment = invoice.paymentTxid ? events.find(event => event.txid === invoice.paymentTxid && event.applied) : null;
  return { ...envelope(state), invoice, events, eventsComplete: true,
    receipt: payment ? { invoiceTxid: invoice.txid, paymentTxid: payment.txid, issuerAddress: invoice.issuerAddress,
      recipientAddress: invoice.recipientAddress, payerAddress: payment.authorAddress, amount: invoice.paidAmount,
      blockHeight: payment.blockHeight, blockHash: payment.blockHash, blockTransactionIndex: payment.blockTransactionIndex,
      ...(payment.workSettlement ? { workSettlement: payment.workSettlement } : {}) } : null,
    pendingEvents: state.pendingEvents.filter(event => event.invoiceTxid === txid) };
}
export function payLogPayloadHasCandidates(payload) {
  return [payload?.items, payload?.events, payload?.activity].some(items => Array.isArray(items) && items.some(item =>
    item?.protocol === 'pwm1' && (String(item.memo ?? item.body ?? '').startsWith('pwpay1:') || /(?:^|\n)pwm1:m:pwpay1:/u.test(String(item.payload ?? item.rawPayload ?? '')))));
}
export function qualifyPayLogPayload(payload, events, checkpoint, unavailable = '') {
  const byTxid = new Map(events.map(event => [event.txid, event]));
  const qualify = item => {
    if (item?.protocol !== 'pwm1') return item;
    const event = byTxid.get(item.txid);
    if (!event && !String(item.memo ?? item.body ?? '').startsWith('pwpay1:') && !/(?:^|\n)pwm1:m:pwpay1:/u.test(String(item.payload ?? item.rawPayload ?? ''))) return item;
    return { ...item, pay: event && event.confirmed ? { ready: true, action: event.action, invoiceTxid: event.invoiceTxid,
      authorAddress: event.authorAddress, valid: event.valid, applied: event.applied, validationErrors: event.validationErrors,
      additionalPayment: event.additionalPayment === true, model: 'canonical-pay-lifecycle-replay-v1', ...checkpoint }
      : { ready: false, reason: unavailable || 'pending-best-effort' } };
  };
  return { ...payload, ...(Array.isArray(payload?.items) ? { items: payload.items.map(qualify) } : {}),
    ...(Array.isArray(payload?.events) ? { events: payload.events.map(qualify) } : {}),
    ...(Array.isArray(payload?.activity) ? { activity: payload.activity.map(qualify) } : {}) };
}
function searchPayCandidate(record) {
  return record?.protocol === 'pwm1' && Array.isArray(record.refs) &&
    record.refs.some(ref => (ref.refType ?? ref.type) === 'app' && (ref.refValue ?? ref.value) === 'Pay');
}
export function paySearchPayloadHasCandidates(payload) {
  return (payload?.results ?? [payload?.record]).some(searchPayCandidate) ||
    /(?:^|\n)pwm1:m:pwpay1:/u.test(String(payload?.rawPayload ?? ''));
}
export function qualifyPaySearchPayload(payload, events, checkpoint, unavailable = '') {
  const byTxid = new Map(events.map(event => [event.txid, event]));
  const qualify = record => {
    if (!record || (!searchPayCandidate(record) && !byTxid.has(record.txid))) return record;
    const event = byTxid.get(record.txid);
    const authority = event?.confirmed && record.protocol === 'pwm1' && record.source?.type === 'event'
      ? { ready: true, action: event.action, invoiceTxid: event.invoiceTxid, valid: event.valid, applied: event.applied,
        additionalPayment: event.additionalPayment === true, validationErrors: event.validationErrors,
        model: 'canonical-pay-lifecycle-replay-v1', ...checkpoint }
      : { ready: false, reason: unavailable || (event?.confirmed ? 'raw-observation' : 'pending-best-effort') };
    return { ...record, app: 'Pay', payAuthority: authority };
  };
  return { ...payload, ...(Array.isArray(payload.results) ? { results: payload.results.map(qualify) } : {}),
    ...(payload.record ? { record: qualify(payload.record) } : {}) };
}

/** A reference is a canonical transaction pointer, never a claim that its content was verified. */
export async function payReferenceFromCore({ txid, checkpointHeight, checkpointHash }, rpc) {
  const unavailable = () => payReadError('Invoice reference cannot be independently verified.', 503, 'PAY_REFERENCE_UNAVAILABLE');
  if (!TXID.test(txid ?? '') || typeof rpc !== 'function') throw unavailable();
  const call = async (method, args) => { try { return await rpc(method, args); } catch { throw unavailable(); } };
  const fence = async () => {
    const result = await call('getblockhash', [checkpointHeight]);
    if (!result?.ok || result.result !== checkpointHash) throw payReadError('Pay checkpoint changed during reference verification.', 409, 'PAY_CHECKPOINT_REORG');
  };
  await fence();
  const response = await call('getrawtransaction', [txid, true]);
  if (!response?.ok) {
    if (Number(response?.error?.code) !== -5) throw unavailable();
    const index = await call('getindexinfo', ['txindex']);
    if (!index?.ok || index.result?.txindex?.synced !== true || Number(index.result.txindex.best_block_height) < checkpointHeight) throw unavailable();
    await fence();
    return { txid, confirmed: false };
  }
  const transaction = response.result;
  try { if (bitcoin.Transaction.fromHex(transaction.hex).getId() !== txid) throw new Error(); } catch { throw unavailable(); }
  if (!transaction.blockhash || Number(transaction.confirmations) < 1) { await fence(); return { txid, confirmed: false }; }
  const header = await call('getblockheader', [transaction.blockhash, true]);
  if (!header?.ok || header.result?.hash !== transaction.blockhash || !Number.isSafeInteger(header.result.height) || header.result.confirmations < 1) throw unavailable();
  const blockHeight = header.result.height, blockHash = transaction.blockhash;
  const canonical = await call('getblockhash', [blockHeight]);
  if (!canonical?.ok || canonical.result !== blockHash) throw unavailable();
  await fence();
  return { txid, confirmed: blockHeight <= checkpointHeight, blockHeight, blockHash };
}

export function payAdmission(state, gate, enabled = false) {
  const checkpoint = state.snapshot ?? { checkpointHeight: state.indexedThroughBlock, checkpointHash: state.indexedThroughBlockHash };
  const active = checkpoint.checkpointHeight >= PAY_ACTIVATION_HEIGHT && PAY_ACTIVATION_HEIGHT > 0 && TXID.test(PAY_ACTIVATION_PREVIOUS_BLOCK_HASH);
  const ready = active && gate?.available === true && gate?.atTip === true &&
    checkpoint.checkpointHeight === Number(gate.indexedThroughBlock) && checkpoint.checkpointHash === gate.canonicalHash;
  return { ready, writesEnabled: ready && enabled === true,
    reason: !ready ? 'Pay discovery has not reached the exact active canonical checkpoint.' : !enabled ? 'Pay publication is not enabled.' : '' };
}

/** First-party relay admission. Public chain writes outside this relay still require canonical replay. */
export async function assertPayBroadcastAllowed(txHex, network, { rpc, readState, readGate, enabled }) {
  let wire;
  try { wire = bitcoin.Transaction.fromHex(txHex); } catch { return; }
  const output = wire.outs.map(item => ({ scriptpubkey: Buffer.from(item.script).toString('hex'), value: item.value.toString() }));
  if (!payCandidateParts({ vout: output }).length) return;
  if (network !== 'livenet' || !enabled()) throw payReadError('Pay publication is not enabled.', 503, 'PAY_WRITES_DISABLED');
  const state = await readState(), gate = await readGate();
  if (!payAdmission(state, gate, enabled()).writesEnabled) throw payReadError('Pay publication requires complete exact-tip discovery.', 503, 'PAY_ADMISSION_UNAVAILABLE');
  if (wire.ins.length > 128) throw payReadError('Pay funding exceeds the bounded input verifier.', 400, 'PAY_INPUT_LIMIT');
  const previous = new Map();
  for (const input of wire.ins) {
    const id = Buffer.from(input.hash).reverse().toString('hex');
    if (previous.has(id)) continue;
    const result = await rpc('getrawtransaction', [id, true]);
    if (!result?.ok || Number(result.result?.confirmations) < 1) throw payReadError('Pay requires verified confirmed funding.', 503, 'PAY_FUNDING_UNAVAILABLE');
    let transaction;
    try { transaction = bitcoin.Transaction.fromHex(result.result.hex); if (transaction.getId() !== id) throw new Error(); }
    catch { throw payReadError('Pay previous transaction bytes do not verify.'); }
    previous.set(id, transaction);
  }
  const tx = { txid: wire.getId(), version: wire.version, locktime: wire.locktime, status: { confirmed: false }, vout: output,
    vin: wire.ins.map(input => {
      const txid = Buffer.from(input.hash).reverse().toString('hex'), prev = previous.get(txid)?.outs[input.index];
      const prevout = prev ? { value: prev.value.toString(), scriptpubkey: Buffer.from(prev.script).toString('hex') } : null;
      return { txid, vout: input.index, sequence: input.sequence, scriptsig: Buffer.from(input.script).toString('hex'),
        witness: input.witness.map(bytes => Buffer.from(bytes).toString('hex')),
        prevout: prevout ? { ...prevout, scriptpubkey_address: address(prevout) } : null };
    }) };
  const event = verifyPayTransaction(tx);
  if (!event?.valid) throw payReadError(`Pay transaction is invalid: ${event?.validationErrors?.join(', ') ?? 'unrecognized record'}.`, 400, 'PAY_TRANSACTION_INVALID');
  const paid = recipient => BigInt(event.payments[recipient] ?? '0');
  if (event.action === 'invoice') {
    if (paid(event.authorAddress) < 546n) throw payReadError('Invoice publication requires its self-payment.', 400, 'PAY_SELF_PAYMENT_REQUIRED');
    if (event.metadata.reference) {
      const ref = await payReferenceFromCore({ txid: event.metadata.reference, checkpointHeight: state.snapshot.checkpointHeight, checkpointHash: state.snapshot.checkpointHash }, rpc);
      if (!ref.confirmed) throw payReadError('Invoice reference must already be confirmed.', 400, 'PAY_REFERENCE_UNCONFIRMED');
    }
  } else {
    const invoice = state.invoices.find(item => item.txid === event.invoiceTxid);
    if (!invoice || invoice.status !== 'open') throw payReadError('Invoice is unavailable or already closed.', 409, 'PAY_INVOICE_CLOSED');
    if (event.action === 'cancel') {
      if (event.authorAddress !== invoice.issuerAddress || paid(event.authorAddress) < 546n) throw payReadError('Only the issuer can cancel with its self-payment.', 400, 'PAY_CANCEL_UNAUTHORIZED');
    } else {
      if (event.authorAddress === invoice.recipientAddress) throw payReadError('An invoice recipient cannot pay itself.', 400, 'PAY_SELF_SETTLEMENT');
      const amount = invoice.amount;
      const matches = amount.asset === 'proofs' ? !event.workTransfer && paid(invoice.recipientAddress) === BigInt(amount.amountSats)
        : paid(invoice.recipientAddress) >= 546n && event.workTransfer?.token === PAY_WORK_TOKEN_ID &&
          event.workTransfer.amountSubatoms === amount.amountSubatoms && event.workTransfer.recipientAddress === invoice.recipientAddress;
      if (!matches) throw payReadError('Payment differs from the exact invoice terms.', 400, 'PAY_PAYMENT_MISMATCH');
    }
  }
  const finalGate = await readGate();
  if (!payAdmission(state, finalGate, enabled()).writesEnabled) throw payReadError('Pay checkpoint changed before relay.', 409, 'PAY_ADMISSION_CHANGED');
}
