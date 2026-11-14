import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as bitcoin from 'bitcoinjs-lib';
import * as codec from '../src/shared/protocol/pay.mjs';

const id = n => n.toString(16).padStart(64, '0');
const payer = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', recipient = 'bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e';
const localWindow = { unisat: { getAccounts: async () => [payer] } };
async function loadClient(path, imports = {}) {
  const source = await readFile(path, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === 'buffer') return { Buffer };
    throw new Error(`Unexpected test dependency: ${name}`);
  }, window: localWindow, TextEncoder, TextDecoder, URLSearchParams, Uint8Array, Buffer }, { filename: path });
  return exports;
}
let response, lastRequest;
const api = await loadClient('src/features/pay/payApi.ts', {
  '../../shared/protocol/pay.mjs': codec,
  '../../shared/api/proofApiClient': { fetchProofApiJson: async (...args) => { lastRequest = args; return structuredClone(response); } },
});
const encoding = await loadClient('src/shared/utils/encoding.ts', { 'bitcoinjs-lib': bitcoin });
const boostBase = { dataCarrierBytesForPayload: payload => bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output.length,
  scriptForAddress: address => bitcoin.address.toOutputScript(address) };
const plans = await loadClient('src/features/pay/payProtocol.ts', {
  '../../shared/protocol/pay.mjs': codec, '../../shared/utils/encoding': encoding, '../boost/boostWallet': boostBase, './payApi': api,
});
const height = codec.PAY_ACTIVATION_HEIGHT + 2;
const snapshot = { id: 'fixture-pay-snapshot', checkpointHeight: height, checkpointHash: id(99) };
const evidence = { network: 'livenet', complete: true, source: 'proof-indexer-exact-canonical-pay-replay', snapshot,
  indexedThroughBlock: height, indexedThroughBlockHash: snapshot.checkpointHash,
  activation: { height: codec.PAY_ACTIVATION_HEIGHT, previousBlockHash: codec.PAY_ACTIVATION_PREVIOUS_BLOCK_HASH, ready: true },
  admission: { ready: true, writesEnabled: true, reason: '' }, pendingEvents: [] };
const invoice = { txid: id(1), headTxid: id(1), issuerAddress: payer, recipientAddress: recipient, title: 'Exact invoice', description: 'Public work reference',
  amount: { asset: 'proofs', amountSats: '1200' }, reference: null, status: 'open', paymentTxid: '', payerAddress: '', paidAmount: null,
  blockHeight: codec.PAY_ACTIVATION_HEIGHT, blockHash: id(91), blockTransactionIndex: 0 };
const event = (n, action, extra = {}) => ({ txid: id(n), action, invoiceTxid: invoice.txid, authorAddress: payer, metadata: {},
  confirmed: true, valid: true, applied: true, validationErrors: [], blockHeight: height, blockHash: snapshot.checkpointHash, blockTransactionIndex: n, ...extra });
const detail = { ...evidence, invoice, receipt: null, eventsComplete: true, events: [event(1, 'invoice')] };
const pagination = { hasMore: false, nextCursor: null };

test('Pay requires complete exact replay, pinned activation and independent publication admission', async () => {
  response = { ...evidence, invoices: [invoice], pagination };
  assert.equal((await api.fetchPayInvoices('livenet')).invoices[0].amount.amountSats, '1200');
  for (const change of [{ complete: false }, { network: 'testnet' }, { source: 'raw-mail' }, { activation: { ...evidence.activation, height: 0 } },
    { snapshot: { ...snapshot, checkpointHash: id(20) } }, { admission: undefined }, { pendingEvents: [{ txid: id(3), confirmed: true }] }]) {
    response = { ...evidence, invoices: [], pagination, ...change };
    await assert.rejects(api.fetchPayInvoices('livenet'), /evidence|confirmation/i);
  }
  for (const admission of [{ ready: false, writesEnabled: true }, { ready: true, writesEnabled: false }]) assert.throws(() => api.requirePayPublication({ ...evidence, admission }), /closed/i);
});
test('pagination stays at its exact snapshot and details reject duplicate or forged receipts', async () => {
  response = { ...evidence, invoices: [invoice], pagination };
  await api.fetchPayInvoices('livenet', { q: 'work', address: payer, snapshot: snapshot.id, cursor: 'next' });
  const params = new URL(lastRequest[0], 'https://fixture.test').searchParams;
  assert.equal(params.get('address'), payer); assert.equal(params.get('snapshot'), snapshot.id); assert.equal(params.get('cursor'), 'next');
  for (const change of [{ invoices: [invoice, invoice] }, { pagination: { hasMore: true } }, { snapshot: { ...snapshot, id: 'changed' } }]) {
    response = { ...evidence, invoices: [invoice], pagination, ...change };
    await assert.rejects(api.fetchPayInvoices('livenet', { snapshot: snapshot.id }), /duplicate|coverage/i);
  }
  const paid = { ...invoice, status: 'paid', headTxid: id(2), paymentTxid: id(2), payerAddress: payer, paidAmount: invoice.amount };
  const receipt = { invoiceTxid: invoice.txid, paymentTxid: id(2), issuerAddress: payer, recipientAddress: recipient, payerAddress: payer, amount: invoice.amount,
    blockHeight: height, blockHash: snapshot.checkpointHash, blockTransactionIndex: 2 };
  const paidDetail = { ...detail, invoice: paid, events: [...detail.events, event(2, 'pay')], receipt };
  response = paidDetail; assert.equal((await api.fetchPayInvoice('livenet', invoice.txid)).receipt.paymentTxid, id(2));
  for (const change of [{ eventsComplete: false }, { events: [event(1, 'invoice'), event(1, 'invoice')] },
    { invoice: { ...paid, paidAmount: { asset: 'proofs', amountSats: '1199' } } },
    { receipt: { ...receipt, recipientAddress: payer } }, { receipt: { ...receipt, amount: { asset: 'proofs', amountSats: '1201' } } }]) {
    response = { ...paidDetail, ...change }; await assert.rejects(api.fetchPayInvoice('livenet', invoice.txid), /history|receipt|settlement/i);
  }
});
test('invoice plans fix exact terms and preserve Q16 decimals and local drafts', () => {
  const draft = { ...plans.emptyPayDraft, title: 'Café invoice', description: ' Exact terms\r\n', recipient, asset: 'WORK', work: '1.0000000000000001' };
  const plan = plans.buildPayPlan(draft), parsed = codec.parsePayBody(plan.memo);
  assert.equal(parsed.metadata.amount.amountSubatoms, '10000000000000001'); assert.equal(parsed.metadata.recipient, recipient);
  assert.equal(parsed.metadata.description, draft.description); assert.equal(plan.payloads.at(-1), `pwm1:m:${plan.memo}`);
  assert.equal(JSON.stringify(plans.restorePayDraft(plans.payDraftFields(draft))), JSON.stringify(draft));
  for (const change of [{ work: '1e-16' }, { work: '1.00000000000000001' }, { recipient: `${recipient} ` }, { asset: 'proofs', proofs: '545' }]) assert.throws(() => plans.buildPayPlan({ ...draft, ...change }));
  const stored = new Map(), storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  plans.persistPayDraft(storage, 'pay', draft); assert.equal(JSON.parse(stored.get('pay')).work, draft.work);
  assert.throws(() => plans.persistPayDraft({ ...storage, setItem() {} }, 'missing', draft), /autosave/i);
  assert.equal(plans.restorePayDraft([['Pay draft', '{broken']]), undefined);
});

let currentDetail = detail, admission = evidence, activeAddress = payer, fundingPresent = true, reserved = [], corruptAmount = false, corruptWork = false;
let workSpendable = 10000000000000001n, workAdmission = true, ownCapacityTxid;
const paymentBuilds = [], paymentReview = await loadClient('src/shared/wallet/paymentReview.ts', { 'bitcoinjs-lib': bitcoin });
const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 1), 0); funding.addOutput(bitcoin.address.toOutputScript(payer), 2000000n);
const wallet = await loadClient('src/features/pay/payWallet.ts', {
  'bitcoinjs-lib': bitcoin, './payProtocol': plans, '../../shared/protocol/pay.mjs': codec,
  './payApi': { ...api, fetchPayInvoices: async () => admission, fetchPayInvoice: async () => structuredClone(currentDetail) },
  '../../shared/api/proofApiClient': { fetchProofApiJson: async () => fundingPresent ? [{ txid: funding.getId(), vout: 0, status: { confirmed: true } }] : [] },
  '../../shared/wallet/paymentReview': paymentReview,
  '../code/codeWallet': { sameCodeAddress: (a, b) => a === b, codeReservedAnchors: async () => reserved },
  '../jobs/jobsWorkCapacity': { fetchJobsWorkCapacity: async (_address, options) => { ownCapacityTxid = options.ownSignedTxid; return { spendableSubatoms: workSpendable, anchorOutpoints: [{ txid: id(80), vout: 2 }] }; } },
  '../boost/boostWorkComposer': { BOOST_WORK_REGISTRY_ADDRESS: codec.PAY_WORK_REGISTRY_ADDRESS, BOOST_WORK_MUTATION_PROOFS: 546,
    requireBoostWorkWriteAdmission: async () => { if (!workAdmission) throw new Error('WORK transfer admission unavailable'); },
    buildBoostWorkSendPayload: (amount, address) => `pwt1:send3:${codec.PAY_WORK_TOKEN_ID}:${amount}:${address}` },
  '../boost/boostWallet': { ...boostBase,
    assertMainnetP2pkhWallet: address => { if (!address.startsWith('1')) throw new Error('P2PKH signing required'); },
    ensureWalletNetwork: async (_wallet, _network, address) => { if (address !== activeAddress) throw new Error('Account changed'); },
    assertActiveWalletAddress: async (_wallet, address) => { if (address !== activeAddress) throw new Error('Account changed'); },
    buildBoostPaymentPsbt: async options => {
      paymentBuilds.push(options);
      const { fromAddress, payments, protocolPayloads, postProtocolPayments = [], postProtocolPayloads = [] } = options;
      const psbt = new bitcoin.Psbt(); psbt.addInput({ hash: funding.getId(), index: 0, nonWitnessUtxo: funding.toBuffer(), sighashType: bitcoin.Transaction.SIGHASH_ALL });
      const amount = payments[0].amountSats + (corruptAmount ? 1 : 0), fee = 1000, change = 2000000 - amount - postProtocolPayments.reduce((sum, item) => sum + item.amountSats, 0) - fee;
      psbt.addOutput({ address: payments[0].address, value: BigInt(amount) });
      for (const payload of protocolPayloads) psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output, value: 0n });
      for (const item of postProtocolPayments) psbt.addOutput({ address: item.address, value: BigInt(item.amountSats) });
      for (const payload of postProtocolPayloads) psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(corruptWork ? payload.replace('10000000000000001', '10000000000000002') : payload)] }).output, value: 0n });
      psbt.addOutput({ address: fromAddress, value: BigInt(change) });
      return { psbtHex: psbt.toHex(), feeSats: fee, changeSats: change, dustFeeSats: 0, inputCount: 1, walletInputIndexes: [0] };
    } },
});
const payPlan = plans.buildPayPlan({ ...plans.emptyPayDraft, action: 'pay', invoice: invoice.txid, expectedHead: invoice.headTxid });
test('payment review binds fixed recipient, exact proofs, ALL inputs and confirmed terms', async () => {
  assert.ok(payPlan.payloads.every(payload => /^pwm1:(s|m):/u.test(payload)), 'Pay envelope permits subject and body only; invoice linkage is in the exact body');
  const prepared = await wallet.preparePayTransaction(payPlan, payer, 'livenet', () => {});
  assert.equal(prepared.destination, recipient); assert.equal(prepared.amountSats, '1200'); assert.equal(paymentBuilds.at(-1).requireP2pkhAllInputs, true);
  for (const change of [{ headTxid: id(9) }, { status: 'paid' }, { recipientAddress: payer }]) {
    currentDetail = { ...detail, invoice: { ...invoice, ...change } };
    await assert.rejects(wallet.verifyPayAuthority(payPlan, payer, 'livenet', () => {}), /changed|paid|self-payment/i);
  }
  currentDetail = { ...detail, pendingEvents: [event(3, 'pay', { confirmed: false })] };
  await assert.rejects(wallet.verifyPayAuthority(payPlan, payer, 'livenet', () => {}), /pending/i);
  currentDetail = detail; corruptAmount = true;
  await assert.rejects(wallet.preparePayTransaction(payPlan, payer, 'livenet', () => {}), /intent/i); corruptAmount = false;
  activeAddress = recipient; await assert.rejects(wallet.verifyPayAuthority(payPlan, payer, 'livenet', () => {}), /Account changed/i); activeAddress = payer;
  await assert.rejects(wallet.verifyPayAuthority(payPlan, recipient, 'livenet', () => {}), /P2PKH/i);
  reserved = [{ txid: funding.getId(), vout: 0 }]; await assert.rejects(wallet.verifyPayFunding(prepared), /reserved/i); reserved = [];
  fundingPresent = false; await assert.rejects(wallet.verifyPayFunding(prepared), /funding/i); fundingPresent = true;
});
test('WORK payment review preserves exact send3, separate fees, reservations and own signed receipt exemption', async () => {
  const amount = { asset: 'WORK', token: codec.PAY_WORK_TOKEN_ID, amountSubatoms: '10000000000000001' };
  currentDetail = { ...detail, invoice: { ...invoice, amount } };
  const prepared = await wallet.preparePayTransaction(payPlan, payer, 'livenet', () => {}), payments = prepared.review.evidence.outputs.filter(item => item.kind === 'payment');
  assert.equal(payments[0].proofs, '546'); assert.equal(payments[0].address, recipient);
  assert.equal(payments[1].proofs, '546'); assert.equal(payments[1].address, codec.PAY_WORK_REGISTRY_ADDRESS);
  assert.equal(prepared.review.evidence.records.at(-1), `pwt1:send3:${codec.PAY_WORK_TOKEN_ID}:10000000000000001:${recipient}`);
  assert.ok(paymentBuilds.at(-1).excludeOutpoints.some(item => item.txid === id(80)));
  await wallet.verifyPayFunding(prepared, id(7)); assert.equal(ownCapacityTxid, id(7));
  workSpendable--; await assert.rejects(wallet.verifyPayFunding(prepared), /spendable/i); workSpendable++;
  workAdmission = false; await assert.rejects(wallet.verifyPayFunding(prepared), /admission/i); workAdmission = true;
  corruptWork = true; await assert.rejects(wallet.preparePayTransaction(payPlan, payer, 'livenet', () => {}), /intent/i); corruptWork = false;
  currentDetail = detail;
});
test('cancel requires current issuer and independent write gate; creation is a self-signal only', async () => {
  const create = plans.buildPayPlan({ ...plans.emptyPayDraft, title: 'Request', recipient });
  const created = await wallet.preparePayTransaction(create, payer, 'livenet', () => {});
  assert.equal(created.destination, payer); assert.equal(created.amountSats, '546');
  admission = { ...evidence, admission: { ready: true, writesEnabled: false } };
  await assert.rejects(wallet.preparePayTransaction(create, payer, 'livenet', () => {}), /closed/i); admission = evidence;
  const cancel = plans.buildPayPlan({ ...payPlan.draft, action: 'cancel', reason: 'Work no longer required' });
  assert.equal((await wallet.verifyPayAuthority(cancel, payer, 'livenet', () => {})).destination, payer);
  currentDetail = { ...detail, invoice: { ...invoice, issuerAddress: recipient } };
  await assert.rejects(wallet.verifyPayAuthority(cancel, payer, 'livenet', () => {}), /issuer/i); currentDetail = detail;
});
const recovery = await loadClient('src/shared/wallet/actionRecovery.ts');
const holds = await loadClient('src/shared/work/workBatchRecovery.ts', { '../wallet/actionRecovery': recovery, '../protocol/pay.mjs': codec });
test('unknown Pay WORK receipts block every WORK writer until recovery and cannot be lost before broadcast', () => {
  const stored = new Map(), storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const receipt = { txid: id(7), address: payer, network: 'livenet', title: 'Pay invoice', key: payPlan.key, createdAt: new Date().toISOString(), status: 'unknown',
    fields: [...plans.payDraftFields({ ...payPlan.draft, asset: 'WORK' }), ['Pay reviewed amount', JSON.stringify({ asset: 'WORK', token: codec.PAY_WORK_TOKEN_ID, amountSubatoms: '1' })]] };
  recovery.saveActionReceipt(storage, receipt);
  assert.throws(() => holds.assertNoUnresolvedWorkBatch(storage, payer), /unknown or pending/i);
  assert.doesNotThrow(() => holds.assertNoUnresolvedWorkBatch(storage, payer, receipt.txid));
  assert.doesNotThrow(() => holds.assertNoUnresolvedWorkBatch(storage, recipient));
  recovery.saveActionReceipt(storage, { ...receipt, fields: plans.payDraftFields(payPlan.draft) });
  assert.throws(() => holds.assertNoUnresolvedWorkBatch(storage, payer), /unreadable/i);
  recovery.saveActionReceipt(storage, { ...receipt, status: 'confirmed' }); assert.doesNotThrow(() => holds.assertNoUnresolvedWorkBatch(storage, payer));
  assert.throws(() => recovery.saveActionReceipt({ ...storage, setItem() {} }, { ...receipt, txid: id(8) }), /No broadcast/i);
});
