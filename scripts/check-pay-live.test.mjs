import test from 'node:test';
import assert from 'node:assert/strict';
import * as bitcoin from 'bitcoinjs-lib';
import { verifyPayEvidence, verifyPayReceipt, verifyPayRawEvent, runPayLive } from './check-pay-live.mjs';
import { PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../src/shared/protocol/pay.mjs';
import { createPaySnapshot, payInvoicePayload, payInvoicesPayload } from '../server/pay.mjs';
import { payFixture, fixtureKeys, fixtureOwner, signPermissionFixture, invoiceMetadata, proofAmount, workAmount,
  issuer, attachPayMailEvidence, attachPayWorkEvidence, hashForHeight } from '../server/pay-test-fixtures.mjs';

const height = PAY_ACTIVATION_HEIGHT + 2, hash = hashForHeight(height);
function evidence(writesEnabled = true) {
  return { network: 'livenet', complete: true, source: 'proof-indexer-exact-canonical-pay-replay',
    indexedThroughBlock: height, indexedThroughBlockHash: hash,
    snapshot: { id: 'snapshot', checkpointHeight: height, checkpointHash: hash },
    activation: { height: PAY_ACTIVATION_HEIGHT, previousBlockHash: PAY_ACTIVATION_PREVIOUS_BLOCK_HASH, ready: true },
    admission: { ready: writesEnabled, writesEnabled }, pendingComplete: false };
}

// Public fixture keys and in-memory transactions are unfunded, never live evidence.
function fixture(amount = proofAmount()) {
  const raw = new Map();
  function fund(tx, key, nonce) {
    const owner = fixtureOwner(key), parent = new bitcoin.Transaction();
    parent.version = 2;
    parent.addInput(Buffer.alloc(32, nonce), 0);
    parent.addOutput(Buffer.from(owner.script, 'hex'), 1000000n);
    raw.set(parent.getId(), parent.toHex());
    tx.vin[0].txid = parent.getId();
    signPermissionFixture(tx, { keys: [key] });
    attachPayMailEvidence(tx);
    if (amount.asset === 'WORK' && tx.vout.length > 2) attachPayWorkEvidence(tx);
    raw.set(tx.txid, tx.hex);
    return tx;
  }
  const invoice = fund(payFixture({ metadata: invoiceMetadata({ amount }) }), fixtureKeys[0], 3);
  const payment = fund(payFixture({ nonce: 2, action: 'pay', metadata: { v: 1, invoice: invoice.txid },
    key: fixtureKeys[1], recipient: issuer, payment: amount.asset === 'WORK' ? '546' : amount.amountSats,
    height: height - 1, work: amount.asset === 'WORK' ? amount : null }), fixtureKeys[1], 4);
  const state = createPaySnapshot({ network: 'livenet', checkpointHeight: height, checkpointHash: hash,
    transactions: [invoice, payment], generatedAt: new Date(0).toISOString() });
  const detail = payInvoicePayload(state, new URLSearchParams({ invoice: invoice.txid }));
  detail.admission = { ready: true, writesEnabled: true };
  const board = payInvoicesPayload(state);
  board.admission = { ready: true, writesEnabled: true };
  return { invoice, payment, state, detail, board, raw };
}

function mockApi(data, { emptyFirstPage = true, notificationContinuation = false, mutate = () => {} } = {}) {
  const calls = [], events = data.detail.events;
  const checkpoint = { network: 'livenet', indexedThroughBlock: height, indexedThroughBlockHash: hash };
  const authority = event => ({ ready: true, valid: true, applied: true, action: event.action,
    invoiceTxid: data.invoice.txid, checkpointHeight: height, checkpointHash: hash, validationErrors: [] });
  const coverage = { ready: true, checkpointHeight: height, checkpointHash: hash };
  const record = event => ({ id: `event:${events.indexOf(event) + 1}`, txid: event.txid,
    protocol: 'pwm1', source: { type: 'event' }, refs: [{ type: 'invoice-txid', value: data.invoice.txid }], payAuthority: authority(event) });
  const read = async (_origin, path) => {
    calls.push(path);
    const url = new URL(path, 'https://computer.proofofwork.me'), p = url.searchParams;
    let response;
    if (url.pathname === '/health') response = { ready: true, checks: { node: { tipHeight: height, bestBlockHash: hash } } };
    else if (url.pathname === '/api/v1/pay-invoices') response = { ...data.board, invoices: emptyFirstPage && !p.has('status') ? [] : data.board.invoices };
    else if (url.pathname === '/api/v1/pay-invoice') response = data.detail;
    else if (/\/hex$/u.test(url.pathname)) {
      const txid = url.pathname.split('/')[4];
      assert.ok(data.raw.has(txid), 'Missing mock raw parent');
      response = { network: 'livenet', txid, hex: data.raw.get(txid), source: 'bitcoin-rpc' };
    } else if (/\/status$/u.test(url.pathname)) {
      const txid = url.pathname.split('/')[4], event = events.find(value => value.txid === txid);
      assert.ok(event);
      response = { network: 'livenet', txid, contract: 'proof-of-work-tx-status-v2', canonical: true,
        confirmed: true, status: 'confirmed', blockHeight: event.blockHeight, blockHash: event.blockHash };
    } else if (url.pathname === '/api/v1/events') {
      const event = events.find(value => value.txid === p.get('txid'));
      response = { ...checkpoint, hasMore: false, items: [{ ...event, eventId: events.indexOf(event) + 1, pay: authority(event) }] };
    } else if (url.pathname === '/api/v1/search') {
      const event = events.find(value => value.txid === p.get('q'));
      response = { network: 'livenet', coverage, results: [record(event)] };
    } else if (url.pathname === '/api/v1/search/detail') {
      const event = events[Number(p.get('id').split(':')[1]) - 1];
      response = { network: 'livenet', coverage, record: record(event) };
    } else if (url.pathname === '/api/v1/notifications') {
      const continuation = notificationContinuation && !p.has('cursor');
      response = { ...checkpoint, snapshotId: 'notifications-snapshot', coverage: { complete: true },
        hasMore: continuation, nextCursor: continuation ? 'second-page' : '',
        items: continuation ? [] : events.map(event => ({ actions: [{ app: 'Pay', txid: event.txid, status: 'confirmed',
          target: { workspace: 'pay', txid: data.invoice.txid }, evidence: { valid: true, applied: true, qualification: authority(event) } }] })) };
    } else assert.fail(`Unexpected read: ${path}`);
    response = structuredClone(response);
    mutate(response, url);
    return response;
  };
  return { read, calls };
}

test('release evidence refuses incomplete history, different tip and unexpected write gate', () => {
  const expected = { height, hash, writesEnabled: true };
  assert.equal(verifyPayEvidence(evidence(), expected).complete, true);
  for (const mutate of [
    value => { value.complete = false; }, value => { value.indexedThroughBlock--; },
    value => { value.snapshot.checkpointHash = 'd'.repeat(64); }, value => { value.admission.writesEnabled = false; },
    value => { value.admission.ready = false; }, value => { value.pendingComplete = true; },
  ]) { const value = evidence(); mutate(value); assert.throws(() => verifyPayEvidence(value, expected)); }
});

test('receipt refuses duplicate settlement, false authority, changed terms, position and money', () => {
  const { detail, payment } = fixture();
  assert.equal(verifyPayReceipt(detail).paymentTxid, payment.txid);
  for (const mutate of [
    value => { value.events.push({ ...value.events[1], txid: 'd'.repeat(64) }); },
    value => { value.events[1].ownerSignatureOutputCommitmentVerified = false; },
    value => { value.events[1].confirmed = false; }, value => { value.events[1].payments[issuer] = '999'; },
    value => { value.receipt.paymentTxid = 'd'.repeat(64); }, value => { value.events[1].authorAddress = issuer; },
    value => { value.invoice.title = 'Changed after signing'; }, value => { value.receipt.blockTransactionIndex++; },
    value => { value.invoice.payerAddress = issuer; },
  ]) { const value = structuredClone(detail); mutate(value); assert.throws(() => verifyPayReceipt(value)); }
});

test('WORK receipt binds canonical replay commitment, exact reward and raw transfer position', () => {
  const { detail } = fixture(workAmount('1'));
  assert.equal(verifyPayReceipt(detail).asset, 'WORK');
  for (const mutate of [
    value => { value.receipt.workSettlement.valid = false; },
    value => { value.receipt.workSettlement.reward.amountSubatoms = '2'; },
    value => { value.receipt.workSettlement.protocolVout++; },
    value => { value.receipt.workSettlement.transitionChainCommitment.sha256 = ''; },
    value => { delete value.events[1].workSettlement; },
  ]) { const value = structuredClone(detail); mutate(value); assert.throws(() => verifyPayReceipt(value)); }
});

test('raw verification binds parents and verifies ALL signatures instead of trusting an API flag', async () => {
  const data = fixture(), event = data.detail.events[0], { read } = mockApi(data);
  assert.equal((await verifyPayRawEvent(event, { read, origin: 'https://computer.proofofwork.me' })).inputSignaturesVerified, 1);
  const mismatch = mockApi(data, { mutate: (value, url) => {
    if (url.pathname.includes(data.invoice.vin[0].txid) && url.pathname.endsWith('/hex')) value.hex = data.invoice.hex;
  } });
  await assert.rejects(verifyPayRawEvent(event, { read: mismatch.read, origin: 'https://computer.proofofwork.me' }), /requested TXID/);
  const raw = bitcoin.Transaction.fromHex(data.invoice.hex);
  raw.ins[0].script[10] ^= 1;
  const broken = structuredClone(event); broken.txid = raw.getId();
  data.raw.set(broken.txid, raw.toHex()); data.detail.events[0] = broken;
  await assert.rejects(verifyPayRawEvent(broken, { read: mockApi(data).read, origin: 'https://computer.proofofwork.me' }), /Raw Pay verification failed/);
});

test('live trace finds an older paid invoice and verifies raw, Log, Search and paginated notifications', async () => {
  for (const amount of [proofAmount(), workAmount('1')]) {
    const data = fixture(amount), { read, calls } = mockApi(data, { notificationContinuation: true });
    let retainedChecks = 0;
    const result = await runPayLive({ env: {}, read, retained: () => { retainedChecks++; } });
    assert.equal(result.liveSettlementVerified, true); assert.equal(result.signingExercised, false);
    assert.equal(result.verified[0].trace.length, 2); assert.equal(result.verified[0].paymentTxid, data.payment.txid);
    assert.equal(retainedChecks, 1); assert.ok(calls.some(path => path.includes('status=paid')));
    assert.ok(calls.some(path => path.includes('cursor=second-page')));
  }
});

test('stale or unqualified surfaces and changed final tip prevent qualification', async () => {
  for (const damage of ['log', 'search', 'notifications', 'tip', 'status']) {
    let healthReads = 0, retainedChecks = 0;
    const { read } = mockApi(fixture(), { mutate: (value, url) => {
      if (damage === 'log' && url.pathname === '/api/v1/events') value.items[0].pay.ready = false;
      if (damage === 'search' && url.pathname === '/api/v1/search/detail') value.coverage.checkpointHeight--;
      if (damage === 'notifications' && url.pathname === '/api/v1/notifications') value.items[0].actions[0].evidence.qualification.applied = false;
      if (damage === 'status' && url.pathname.endsWith('/status')) value.canonical = false;
      if (damage === 'tip' && url.pathname === '/health' && ++healthReads > 1) value.checks.node.tipHeight++;
    } });
    await assert.rejects(runPayLive({ env: {}, read, retained: () => { retainedChecks++; } }));
    assert.equal(retainedChecks, 0);
  }
});

test('empty board qualifies preactivation but never replaces a real confirmed invoice and payment', async () => {
  let retainedChecks = 0;
  const health = { ready: true, checks: { node: { tipHeight: height, bestBlockHash: hash } } };
  const board = writes => ({ ...evidence(writes), invoices: [],
    stats: { invoices: 0, open: 0, paid: 0, cancelled: 0, additionalPayments: 0, paidProofs: '0', paidWorkSubatoms: '0' } });
  const run = mode => runPayLive({ env: { POW_PAY_CHECK_MODE: mode }, retained: () => { retainedChecks++; },
    read: async (_origin, path) => path === '/health' ? health : board(mode === 'released') });
  assert.equal((await run('preactivation')).liveSettlementVerified, false); assert.equal(retainedChecks, 1);
  await assert.rejects(run('released'), /actual confirmed invoice and settlement/); assert.equal(retainedChecks, 1);
});
