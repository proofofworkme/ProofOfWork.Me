import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bitcoin from 'bitcoinjs-lib';
import { encodePayRecord, parsePayBody, normalizePayAmount, PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH,
  parsePayWorkDecimal, formatPayAmount } from '../src/shared/protocol/pay.mjs';
import { verifyPayTransaction, verifyPayWorkSettlement, replayPayTransactions, createPaySnapshot, payInvoicesPayload, payInvoicePayload,
  payStats, qualifyPayLogPayload, qualifyPaySearchPayload, payAdmission } from './pay.mjs';
import { payFixture, paidFixtures, invoiceMetadata, proofAmount, workAmount, issuer, payer,
  fixtureKeys, fixtureOwner, signPermissionFixture, attachPayMailEvidence, attachPayWorkEvidence, hashForHeight } from './pay-test-fixtures.mjs';
import { notificationAction } from './notifications.mjs';
import { proofIndexEventRefsForItem } from './proof-index-event-relations.mjs';
import { buildSearchDocument } from './search-projection.mjs';

test('canonical Pay metadata is exact UTF-8, closed schema and immutable integer currency', () => {
  const metadata = invoiceMetadata({ description: 'Keep\r\n雪\n', amount: workAmount('1') });
  const body = encodePayRecord('invoice', metadata);
  assert.deepEqual(parsePayBody(body), { action: 'invoice', metadata });
  assert.equal(parsePayWorkDecimal('0.0000000000000001'), '1');
  assert.equal(formatPayAmount(workAmount('1')), '0.0000000000000001 WORK');
  for (const value of [{ asset: 'proofs', amountSats: 1200 }, proofAmount('545'), proofAmount('01200'),
    workAmount('0'), workAmount('210000000000000000000001'), { ...workAmount(), token: 'a'.repeat(64) }]) assert.equal(normalizePayAmount(value), null);
  const raw = json => `pwpay1:invoice:${Buffer.from(json).toString('base64url')}`;
  for (const json of [JSON.stringify({ ...metadata, extra: true }), JSON.stringify(metadata).replace('"v":1', '"v":1,"v":1'),
    JSON.stringify(metadata).replace('"v":1', '"v":1.0'), JSON.stringify(metadata).replace('"title":', ' "title":'),
    JSON.stringify({ title: metadata.title, ...metadata })]) assert.equal(parsePayBody(raw(json)), null);
  assert.throws(() => encodePayRecord('invoice', { ...metadata, recipient: 'alice.pow' }));
});

test('verified direct payment derives one receipt and preserves source evidence', () => {
  const records = paidFixtures(), state = replayPayTransactions(records.slice().reverse());
  assert.equal(state.invoices[0].status, 'paid'); assert.equal(state.invoices[0].payerAddress, payer);
  assert.equal(state.invoices[0].paymentTxid, records[1].txid); assert.deepEqual(state.invoices[0].paidAmount, proofAmount());
  const snapshot = createPaySnapshot({ network: 'livenet', checkpointHeight: PAY_ACTIVATION_HEIGHT + 1,
    checkpointHash: hashForHeight(PAY_ACTIVATION_HEIGHT + 1), transactions: records });
  const list = payInvoicesPayload(snapshot), detail = payInvoicePayload(snapshot, new URLSearchParams({ invoice: records[0].txid }));
  assert.equal(list.stats.paidProofs, '1200'); assert.equal(list.stats.paidWorkSubatoms, '0');
  assert.equal(detail.receipt.paymentTxid, records[1].txid); assert.equal(detail.eventsComplete, true);
  assert.equal(list.admission.writesEnabled, false);
  assert.deepEqual(list.activation, { height: PAY_ACTIVATION_HEIGHT, previousBlockHash: PAY_ACTIVATION_PREVIOUS_BLOCK_HASH, ready: true });
});

test('pending, pre-activation, same-block references and reorged payments cannot settle', () => {
  const [invoice, payment] = paidFixtures();
  const pending = structuredClone(payment); pending.status = { confirmed: false };
  assert.equal(replayPayTransactions([invoice, pending]).invoices[0].status, 'open');
  const sameBlock = structuredClone(payment); sameBlock.status = { ...invoice.status }; sameBlock.blockTransactionIndex = 2; attachPayMailEvidence(sameBlock);
  assert.equal(replayPayTransactions([invoice, sameBlock]).events.at(-1).validationErrors[0], 'pay-invoice-not-earlier-confirmed-block');
  const old = payFixture({ height: PAY_ACTIVATION_HEIGHT - 1 });
  assert.equal(replayPayTransactions([old]).invoices.length, 0);
  assert.equal(replayPayTransactions([invoice]).invoices[0].status, 'open');
});

test('first canonical full payment wins; additional real payment remains inspectable once', () => {
  const records = paidFixtures();
  const extra = payFixture({ nonce: 3, action: 'pay', metadata: { v: 1, invoice: records[0].txid }, key: fixtureKeys[1], recipient: issuer,
    payment: '1200', height: PAY_ACTIVATION_HEIGHT + 1, index: 2 });
  const state = replayPayTransactions([extra, ...records]);
  assert.equal(state.invoices[0].paymentTxid, records[1].txid); assert.equal(state.events.at(-1).additionalPayment, true);
  assert.equal(state.events.at(-1).payments[issuer], '1200'); assert.equal(payStats(state).paidProofs, '1200');
  assert.equal(payStats(state).additionalPayments, 1);
});

test('wrong exact amount, wrong recipient and self-payment never settle', () => {
  const invoice = payFixture();
  for (const [recipient, payment, key] of [[issuer, '1199', fixtureKeys[1]], [issuer, '1201', fixtureKeys[1]],
    [payer, '1200', fixtureKeys[1]], [issuer, '1200', fixtureKeys[0]]]) {
    const tx = payFixture({ action: 'pay', metadata: { v: 1, invoice: invoice.txid }, recipient, payment, key, nonce: 4, height: PAY_ACTIVATION_HEIGHT + 1 });
    const state = replayPayTransactions([invoice, tx]);
    assert.equal(state.invoices[0].status, 'open'); assert.equal(state.events.at(-1).valid, false);
  }
});

test('issuer alone cancels an open invoice; cancellation and payment honor canonical order', () => {
  const [invoice, payment] = paidFixtures();
  const cancel = key => payFixture({ action: 'cancel', metadata: { v: 1, invoice: invoice.txid, reason: 'No longer needed' },
    key, nonce: 8, height: PAY_ACTIVATION_HEIGHT + 1, index: 0 });
  assert.equal(replayPayTransactions([invoice, cancel(fixtureKeys[1])]).invoices[0].status, 'open');
  const state = replayPayTransactions([payment, invoice, cancel(fixtureKeys[0])]);
  assert.equal(state.invoices[0].status, 'cancelled'); assert.equal(state.events.at(-1).additionalPayment, true);
  const later = cancel(fixtureKeys[0]); later.blockTransactionIndex = 2; attachPayMailEvidence(later);
  assert.equal(replayPayTransactions([invoice, payment, later]).invoices[0].status, 'paid');
});

test('output-committing signatures are mandatory; unsupported or rewritten inputs stay rejected', () => {
  for (const type of [bitcoin.Transaction.SIGHASH_NONE, bitcoin.Transaction.SIGHASH_SINGLE, bitcoin.Transaction.SIGHASH_ALL | bitcoin.Transaction.SIGHASH_ANYONECANPAY]) {
    assert.equal(verifyPayTransaction(payFixture({ types: [type] })).ownerSignatureOutputCommitmentVerified, false);
  }
  const changed = payFixture(); changed.vout[0].value = '547';
  assert.equal(verifyPayTransaction(changed).valid, false);
  const spoofed = payFixture(); spoofed.vin[0].prevout.scriptpubkey_address = payer;
  assert.equal(verifyPayTransaction(spoofed).valid, false);
  const badRecipient = payFixture({ metadata: invoiceMetadata({ recipient: issuer.slice(0,-1) + '2' }) });
  assert.ok(verifyPayTransaction(badRecipient).validationErrors.includes('pay-recipient-address-invalid'));
});

test('raw canonical Mail closure and external reference evidence fail unavailable, not false zero', () => {
  const invoice = payFixture(); delete invoice._payMailEvidence;
  assert.throws(() => replayPayTransactions([invoice]), error => error.details.code === 'PAY_MAIL_EVIDENCE_UNAVAILABLE');
  attachPayMailEvidence(invoice); invoice._payMailEvidence.transition.payload.replayRecords[0].rawWitness.rawRecordParts = [];
  assert.throws(() => replayPayTransactions([invoice]), /closure/);
  const ref = payFixture({ metadata: invoiceMetadata({ reference: 'f'.repeat(64) }) });
  assert.throws(() => replayPayTransactions([ref]), error => error.details.code === 'PAY_REFERENCE_UNAVAILABLE');
  ref._payReferenceEvidence = { txid: 'f'.repeat(64), confirmed: true, blockHeight: PAY_ACTIVATION_HEIGHT, blockHash: hashForHeight(PAY_ACTIVATION_HEIGHT) };
  assert.equal(replayPayTransactions([ref]).invoices.length, 0);
  ref._payReferenceEvidence.blockHeight--; assert.equal(replayPayTransactions([ref]).invoices.length, 1);
});

test('WORK settlement uses accepted raw replay and exact subatoms, not a decoded transfer', () => {
  const records = paidFixtures(workAmount('1')), state = replayPayTransactions(records);
  assert.equal(state.invoices[0].status, 'paid'); assert.equal(payStats(state).paidWorkSubatoms, '1'); assert.equal(payStats(state).paidProofs, '0');
  assert.equal(state.invoices[0].workSettlement.source, 'canonical-work-send3-relational-raw-replay');
  for (const mutate of [tx => { delete tx._payWorkSettlementEvidence; }, tx => { tx._payWorkSettlementEvidence[0].valid = false; },
    tx => { tx._payWorkSettlementEvidence[0].transition.payload.replayRecords[1].stateDelta.movement.amountSubatoms = '2'; },
    tx => { tx._payWorkSettlementEvidence[0].payload.workAmoV5ReplayOutput.projection.senderAddress = issuer; },
    tx => { tx._payWorkSettlementEvidence[0].transition.payload.replayRecords[1].rawWitness.rawRecordParts = []; }]) {
    const changed = structuredClone(records); mutate(changed[1]);
    assert.throws(() => replayPayTransactions(changed), error => error.details?.code === 'PAY_WORK_SETTLEMENT_UNAVAILABLE');
  }
});

test('Log, Search and notifications expose qualified Pay without changing Mail economics', () => {
  const records = paidFixtures(), state = replayPayTransactions(records);
  const original = { txid: records[1].txid, protocol: 'pwm1', kind: 'mail', confirmed: true, status: 'confirmed', valid: true,
    memo: state.events[1].rawBody, amountSats: '1200', senderAddress: payer, recipientAddress: issuer };
  const qualified = qualifyPayLogPayload({ items: [original] }, state.events, {}).items[0];
  assert.equal(qualified.amountSats, '1200'); assert.equal(qualified.kind, 'mail'); assert.equal(qualified.pay.applied, true);
  assert.equal(notificationAction(qualified, issuer).target.workspace, 'pay');
  assert.equal(notificationAction(qualified, issuer).target.txid, records[0].txid);
  assert.equal(notificationAction(original, issuer).status, 'unavailable');
  const refs = proofIndexEventRefsForItem({ protocol: 'pwm1', txid: records[0].txid, memo: state.events[0].rawBody });
  assert.ok(refs.some(ref => ref.refType === 'invoice-title' && ref.refValue === 'A complete page'));
  const document = buildSearchDocument({ id: 'event:1', txid: records[0].txid, protocol: 'pwm1', kind: 'mail', sourceClass: 'event', amountSats: '546',
    payload: { memo: state.events[0].rawBody }, refs: refs.map(ref => ({ type: ref.refType, value: ref.refValue })) }, 'a'.repeat(64));
  assert.match(document.searchText, /A complete page/);
  assert.equal(qualifyPaySearchPayload({ results: [document.record] }, state.events, {}).results[0].payAuthority.applied, true);
});

test('exact-tip admission remains independent from confirmed history and explicit configuration', () => {
  const state = { snapshot: { checkpointHeight: PAY_ACTIVATION_HEIGHT, checkpointHash: hashForHeight(PAY_ACTIVATION_HEIGHT) } };
  const gate = { available: true, atTip: true, indexedThroughBlock: PAY_ACTIVATION_HEIGHT, canonicalHash: hashForHeight(PAY_ACTIVATION_HEIGHT) };
  assert.equal(payAdmission(state, gate, false).writesEnabled, false); assert.equal(payAdmission(state, gate, true).writesEnabled, true);
  assert.equal(payAdmission(state, { ...gate, atTip: false }, true).writesEnabled, false);
  assert.equal(payAdmission(state, { ...gate, canonicalHash: 'f'.repeat(64) }, true).writesEnabled, false);
});
