#!/usr/bin/env node
// Read-only release qualification. This script never signs, broadcasts or enables Pay.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import * as bitcoin from 'bitcoinjs-lib';
import { PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH, normalizePayAmount } from '../src/shared/protocol/pay.mjs';
import { verifyPayTransaction } from '../server/pay.mjs';
import { runLinkedGrowthLive } from './check-linked-growth-live.mjs';

const TXID = /^[0-9a-f]{64}$/u;
const exact = value => typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value);
export function verifyPayEvidence(payload, { height, hash, writesEnabled }) {
  assert.equal(payload?.network, 'livenet');
  assert.equal(payload.complete, true, 'Pay history is incomplete');
  assert.equal(payload.source, 'proof-indexer-exact-canonical-pay-replay');
  assert.equal(payload.indexedThroughBlock, height, 'Pay is behind the independently observed node tip');
  assert.equal(payload.indexedThroughBlockHash, hash, 'Pay checkpoint hash differs');
  assert.equal(payload.snapshot?.checkpointHeight, height);
  assert.equal(payload.snapshot?.checkpointHash, hash);
  assert.ok(payload.snapshot?.id, 'Missing Pay snapshot identity');
  assert.equal(payload.activation?.height, PAY_ACTIVATION_HEIGHT);
  assert.equal(payload.activation?.previousBlockHash, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH);
  assert.equal(payload.activation?.ready, true, 'Pay activation is unavailable');
  assert.equal(payload.admission?.writesEnabled, writesEnabled, 'Unexpected Pay write gate');
  if (writesEnabled) assert.equal(payload.admission?.ready, true, 'Pay writing is not independently ready');
  assert.equal(payload.pendingComplete, false, 'Pending visibility must remain qualified');
  return payload;
}

export function verifyPayReceipt(detail) {
  assert.equal(detail.eventsComplete, true, 'Invoice history is incomplete');
  const invoice = detail.invoice;
  assert.match(invoice?.txid ?? '', TXID);
  assert.ok(normalizePayAmount(invoice.amount), 'Invalid fixed invoice amount');
  assert.ok(['open', 'paid', 'cancelled'].includes(invoice.status));
  assert.ok(Array.isArray(detail.events));
  const issued = detail.events.find(event => event.txid === invoice.txid);
  assert.equal(issued?.action, 'invoice');
  assert.equal(issued?.confirmed, true);
  assert.equal(issued?.valid, true);
  assert.equal(issued?.applied, true);
  assert.equal(issued?.ownerSignatureOutputCommitmentVerified, true);
  assert.equal(issued.authorAddress, invoice.issuerAddress);
  assert.equal(issued.metadata.recipient, invoice.recipientAddress);
  assert.deepEqual(issued.metadata.amount, invoice.amount);
  for (const key of ['title', 'description', 'reference']) assert.equal(issued.metadata[key], invoice[key]);
  for (const key of ['blockHeight', 'blockHash', 'blockTransactionIndex']) assert.equal(issued[key], invoice[key]);
  assert.ok(Number.isSafeInteger(invoice.blockHeight) && invoice.blockHeight >= PAY_ACTIVATION_HEIGHT);
  assert.match(invoice.blockHash ?? '', TXID);
  assert.ok(Number.isSafeInteger(invoice.blockTransactionIndex) && invoice.blockTransactionIndex >= 0);
  const settled = detail.events.filter(event => event.action === 'pay' && event.applied);
  assert.equal(settled.length, invoice.status === 'paid' ? 1 : 0, 'An invoice must settle exactly once');
  if (invoice.status !== 'paid') {
    assert.equal(detail.receipt, null);
    assert.equal(invoice.paidAmount, null);
    assert.equal(invoice.paymentTxid, '');
    assert.equal(invoice.payerAddress, '');
    return { invoiceTxid: invoice.txid, status: invoice.status, paid: false };
  }
  const [event] = settled, receipt = detail.receipt;
  assert.equal(event.confirmed, true);
  assert.equal(event.valid, true);
  assert.equal(event.ownerSignatureOutputCommitmentVerified, true);
  assert.equal(event.invoiceTxid, invoice.txid);
  assert.equal(event.metadata.invoice, invoice.txid);
  assert.equal(event.txid, invoice.paymentTxid);
  assert.equal(invoice.headTxid, event.txid);
  assert.equal(invoice.payerAddress, event.authorAddress);
  assert.ok(event.blockHeight > invoice.blockHeight, 'Settlement must reference an earlier confirmed invoice');
  assert.notEqual(event.authorAddress, invoice.recipientAddress, 'Self-payment cannot settle an invoice');
  assert.equal(receipt?.invoiceTxid, invoice.txid);
  assert.equal(receipt?.paymentTxid, event.txid);
  assert.equal(receipt?.recipientAddress, invoice.recipientAddress);
  assert.equal(receipt?.issuerAddress, invoice.issuerAddress);
  assert.equal(receipt?.payerAddress, event.authorAddress);
  assert.equal(receipt?.blockHeight, event.blockHeight);
  assert.equal(receipt?.blockHash, event.blockHash);
  assert.equal(receipt?.blockTransactionIndex, event.blockTransactionIndex);
  assert.match(event.blockHash ?? '', TXID);
  assert.ok(Number.isSafeInteger(event.blockTransactionIndex) && event.blockTransactionIndex >= 0);
  assert.deepEqual(invoice.paidAmount, invoice.amount);
  assert.deepEqual(receipt.amount, invoice.amount);
  if (invoice.amount.asset === 'WORK') {
    const settlement = receipt.workSettlement;
    assert.equal(settlement?.valid, true, 'WORK receipt lacks accepted canonical transfer evidence');
    assert.equal(settlement.source, 'canonical-work-send3-relational-raw-replay');
    assert.equal(settlement.paymentTxid, event.txid);
    assert.deepEqual(settlement.reward, invoice.amount);
    for (const key of ['blockHeight', 'blockHash', 'blockTransactionIndex']) assert.equal(settlement[key], event[key]);
    for (const key of ['protocolVout', 'registryVout']) assert.equal(settlement[key], event.workTransfer?.[key]);
    assert.equal(settlement.transitionChainCommitment?.model, 'canonical-work-amo-raw-transition-chain-sha256-v1');
    assert.match(settlement.transitionChainCommitment?.sha256 ?? '', TXID);
    assert.ok(Number.isSafeInteger(settlement.transitionChainCommitment?.payloadBytes) && settlement.transitionChainCommitment.payloadBytes > 0);
    assert.deepEqual(event.workSettlement, settlement);
    assert.deepEqual(invoice.workSettlement, settlement);
  } else assert.equal(event.payments[invoice.recipientAddress], invoice.amount.amountSats);
  return { invoiceTxid: invoice.txid, paymentTxid: event.txid, asset: invoice.amount.asset, status: 'paid', paid: true };
}

function verifyCheckpoint(payload, expected, search = false) {
  assert.equal(payload.network, 'livenet');
  if (search) {
    assert.equal(payload.coverage?.ready, true, 'Search is not ready');
    assert.equal(payload.coverage.checkpointHeight, expected.height);
    assert.equal(payload.coverage.checkpointHash, expected.hash);
  } else {
    assert.equal(payload.indexedThroughBlock, expected.height);
    assert.equal(payload.indexedThroughBlockHash, expected.hash);
  }
}

function verifyAuthority(authority, event, expected) {
  assert.equal(authority?.ready, true, 'Pay surface authority is unavailable');
  assert.equal(authority.valid, true);
  assert.equal(authority.applied, true);
  assert.equal(authority.action, event.action);
  assert.equal(authority.invoiceTxid, event.invoiceTxid);
  assert.equal(authority.checkpointHeight, expected.height);
  assert.equal(authority.checkpointHash, expected.hash);
  assert.deepEqual(authority.validationErrors, []);
}

/** Verify signatures against TXID-bound raw parents, never claimed sender fields. */
export async function verifyPayRawEvent(event, { read, origin, rawCache = new Map() }) {
  async function rawTransaction(txid) {
    if (!rawCache.has(txid)) rawCache.set(txid, (async () => {
      const payload = await read(origin, `/api/v1/tx/${txid}/hex?network=livenet`);
      assert.equal(payload.network, 'livenet');
      assert.equal(payload.txid, txid);
      assert.match(payload.hex ?? '', /^(?:[0-9a-f]{2})+$/u);
      const raw = bitcoin.Transaction.fromHex(payload.hex);
      assert.equal(raw.getId(), txid, 'Raw transaction does not match its requested TXID');
      return raw;
    })());
    return rawCache.get(txid);
  }
  const raw = await rawTransaction(event.txid);
  assert.ok(raw.ins.length > 0 && raw.ins.length <= 128, 'Signature verification input budget exceeded');
  const status = await read(origin, `/api/v1/tx/${event.txid}/status?network=livenet`);
  assert.equal(status.network, 'livenet');
  assert.equal(status.txid, event.txid);
  assert.equal(status.contract, 'proof-of-work-tx-status-v2');
  assert.equal(status.confirmed, true);
  assert.equal(status.canonical, true);
  assert.equal(status.status, 'confirmed');
  assert.equal(status.blockHeight, event.blockHeight);
  assert.equal(status.blockHash, event.blockHash);
  const output = value => {
    let address = '';
    try { address = bitcoin.address.fromOutputScript(value.script, bitcoin.networks.bitcoin); } catch { /* OP_RETURN has no address. */ }
    return { scriptpubkey: Buffer.from(value.script).toString('hex'), scriptpubkey_address: address, value: value.value.toString() };
  };
  const vin = [];
  for (const input of raw.ins) {
    const txid = Buffer.from(input.hash).reverse().toString('hex');
    const parent = await rawTransaction(txid), prevout = parent.outs[input.index];
    assert.ok(prevout, 'Raw input parent lacks the spent output');
    vin.push({ txid, vout: input.index, sequence: input.sequence,
      scriptsig: Buffer.from(input.script).toString('hex'), witness: input.witness.map(value => Buffer.from(value).toString('hex')),
      prevout: output(prevout) });
  }
  const verified = verifyPayTransaction({ txid: event.txid, version: raw.version, locktime: raw.locktime,
    vin, vout: raw.outs.map(output), status: { confirmed: true, block_height: status.blockHeight, block_hash: status.blockHash },
    blockTransactionIndex: event.blockTransactionIndex });
  assert.equal(verified?.valid, true, `Raw Pay verification failed: ${verified?.validationErrors?.join(', ')}`);
  assert.equal(verified.ownerSignatureOutputCommitmentVerified, true);
  for (const key of ['action', 'invoiceTxid', 'authorAddress', 'metadata', 'payments', 'rawBody', 'protocolVout', 'workTransfer']) {
    assert.deepEqual(verified[key], event[key], `Pay ${key} differs from signed transaction bytes`);
  }
  if (event.action === 'invoice') assert.ok(BigInt(verified.payments[event.authorAddress] ?? '0') >= 546n);
  return { txid: event.txid, rawTxidVerified: true, inputSignaturesVerified: vin.length, canonicalStatusVerified: true };
}

async function verifyPaySurfaces(detail, expected, { read, origin }) {
  const events = detail.events.filter(event => event.txid === detail.invoice.txid || event.txid === detail.invoice.paymentTxid);
  const results = [], rawCache = new Map();
  for (const event of events) {
    const raw = await verifyPayRawEvent(event, { read, origin, rawCache });
    const log = await read(origin, '/api/v1/events?' + new URLSearchParams({ network: 'livenet', txid: event.txid, protocol: 'pwm1', status: 'confirmed', limit: '100' }));
    verifyCheckpoint(log, expected);
    assert.equal(log.hasMore, false, 'Log transaction trace is truncated');
    const matches = log.items.filter(item => item.txid === event.txid && item.protocol === 'pwm1');
    assert.equal(matches.length, 1, 'Log must retain the single canonical Mail record');
    const [item] = matches;
    verifyAuthority(item.pay, event, expected);
    assert.equal(item.blockHeight, event.blockHeight);
    assert.equal(item.blockHash, event.blockHash);
    assert.equal(item.protocolVout, event.protocolVout);
    const search = await read(origin, '/api/v1/search?' + new URLSearchParams({ network: 'livenet', q: event.txid, protocol: 'pwm1', status: 'confirmed', sort: 'oldest', limit: '50' }));
    verifyCheckpoint(search, expected, true);
    const searchRecord = search.results.find(record => record.id === `event:${item.eventId}`);
    assert.ok(searchRecord, 'Search results lack the canonical Pay event');
    verifyAuthority(searchRecord.payAuthority, event, expected);
    const searchDetail = await read(origin, '/api/v1/search/detail?' + new URLSearchParams({ network: 'livenet', id: searchRecord.id }));
    verifyCheckpoint(searchDetail, expected, true);
    assert.equal(searchDetail.record.txid, event.txid);
    assert.equal(searchDetail.record.source?.type, 'event');
    verifyAuthority(searchDetail.record.payAuthority, event, expected);
    assert.ok(searchDetail.record.refs.some(ref => ref.type === 'invoice-txid' && ref.value === detail.invoice.txid), 'Search lacks the typed invoice link');
    const address = event.action === 'invoice' ? detail.invoice.issuerAddress : detail.invoice.recipientAddress;
    let cursor = '', snapshotId = '', found = false;
    for (let page = 0; page < 100; page++) {
      const notifications = await read(origin, '/api/v1/notifications?' + new URLSearchParams({ network: 'livenet', address, limit: '100', ...(cursor ? { cursor } : {}) }));
      verifyCheckpoint(notifications, expected);
      assert.equal(notifications.coverage?.complete, true, 'Notifications are incomplete');
      if (snapshotId) assert.equal(notifications.snapshotId, snapshotId);
      snapshotId = notifications.snapshotId;
      const action = notifications.items.flatMap(value => value.actions ?? []).find(value => value.app === 'Pay' && value.txid === event.txid);
      if (action) {
        assert.equal(action.status, 'confirmed');
        assert.equal(action.target?.workspace, 'pay');
        assert.equal(action.target?.txid, detail.invoice.txid);
        assert.equal(action.evidence?.valid, true);
        assert.equal(action.evidence?.applied, true);
        verifyAuthority(action.evidence?.qualification, event, expected);
        found = true; break;
      }
      if (!notifications.hasMore) break;
      assert.ok(notifications.nextCursor && notifications.nextCursor !== cursor, 'Notification cursor did not advance');
      cursor = notifications.nextCursor;
    }
    assert.ok(found, 'Participant notifications lack the qualified Pay action within the read budget');
    results.push({ ...raw, log: true, search: true, notifications: true });
  }
  return results;
}

export async function readPublicPayJson(origin, path) {
  const response = await fetch(new URL(path, origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${path.split('?')[0]} is unavailable (${response.status})`);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= 8 * 1024 ** 2, 'Pay response exceeds verification bound');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function runPayLive({ env = process.env, read = readPublicPayJson, retained = runLinkedGrowthLive } = {}) {
  const mode = env.POW_PAY_CHECK_MODE ?? 'released';
  assert.ok(['preactivation', 'released'].includes(mode), 'Invalid Pay verification mode');
  const writesEnabled = mode === 'released';
  const origins = ['https://pay.proofofwork.me', 'https://computer.proofofwork.me'];
  const before = await read(origins[1], '/health');
  assert.equal(before.ready, true, 'Canonical services are not ready');
  const height = before.checks?.node?.tipHeight, hash = before.checks?.node?.bestBlockHash;
  assert.ok(Number.isSafeInteger(height) && height >= PAY_ACTIVATION_HEIGHT);
  assert.match(hash ?? '', TXID);
  const expected = { height, hash, writesEnabled };
  const first = verifyPayEvidence(await read(origins[0], '/api/v1/pay-invoices?network=livenet&fresh=1&limit=20'), expected);
  const embedded = verifyPayEvidence(await read(origins[1], '/api/v1/pay-invoices?network=livenet&fresh=1&limit=20'), expected);
  assert.deepEqual(embedded.invoices, first.invoices, 'Standalone and Computer invoice views disagree');
  assert.deepEqual(embedded.stats, first.stats, 'Standalone and Computer totals disagree');
  for (const field of ['invoices', 'open', 'paid', 'cancelled', 'additionalPayments']) assert.ok(Number.isSafeInteger(first.stats?.[field]) && first.stats[field] >= 0);
  assert.equal(first.stats.invoices, first.stats.open + first.stats.paid + first.stats.cancelled);
  assert.ok(exact(first.stats.paidProofs) && exact(first.stats.paidWorkSubatoms));
  let invoiceId = env.POW_PAY_PROBE_INVOICE_TXID ?? first.invoices.find(invoice => invoice.status === 'paid')?.txid;
  if (!invoiceId) {
    const paid = verifyPayEvidence(await read(origins[0], '/api/v1/pay-invoices?network=livenet&fresh=1&status=paid&limit=1'), expected);
    assert.deepEqual(paid.stats, first.stats, 'Paid invoice query changed the canonical totals');
    invoiceId = paid.invoices.find(invoice => invoice.status === 'paid')?.txid;
  }
  const results = [];
  if (invoiceId) {
    assert.match(invoiceId, TXID);
    const path = '/api/v1/pay-invoice?' + new URLSearchParams({ network: 'livenet', invoice: invoiceId, fresh: '1' });
    const detail = verifyPayEvidence(await read(origins[0], path), expected);
    assert.equal(detail.invoice?.txid, invoiceId, 'Pay returned a different invoice');
    const result = verifyPayReceipt(detail);
    const other = verifyPayEvidence(await read(origins[1], path), expected);
    assert.deepEqual(other.invoice, detail.invoice);
    assert.deepEqual(other.receipt, detail.receipt);
    assert.deepEqual(other.events, detail.events);
    verifyPayReceipt(other);
    result.trace = await verifyPaySurfaces(detail, expected, { read, origin: origins[1] });
    results.push(result);
  }
  if (writesEnabled) assert.ok(results.some(result => result.paid), 'Released Pay requires an actual confirmed invoice and settlement; empty-reader checks are insufficient');
  const after = await read(origins[1], '/health');
  assert.equal(after.ready, true);
  assert.equal(after.checks.node.tipHeight, height, 'Node tip changed; rerun at a stable checkpoint');
  assert.equal(after.checks.node.bestBlockHash, hash);
  await retained({ env });
  return { ok: true, mode, height, hash, invoices: first.stats.invoices, verified: results,
    liveSettlementVerified: results.some(result => result.paid), signingExercised: false,
    evidenceBoundary: 'Raw bytes, input signatures and confirmed status verified through public APIs; complete canonical replay and WORK acceptance qualified by the current Pay reader.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runPayLive())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
