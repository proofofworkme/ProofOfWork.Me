import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as bitcoin from 'bitcoinjs-lib';
import * as codec from '../src/shared/protocol/jobs.mjs';

const id = n => n.toString(16).padStart(64, '0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requester = 'bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e';
const worker = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const localWindow = { unisat: {} };
async function loadClient(path, imports = {}) {
  const source = await readFile(path, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === 'buffer') return { Buffer };
    throw new Error(`Unexpected test dependency: ${name}`);
  }, window: localWindow, Blob, TextEncoder, TextDecoder, URLSearchParams, Uint8Array, Buffer }, { filename: path });
  return exports;
}
let response, lastRequest;
const api = await loadClient('src/features/jobs/jobsApi.ts', {
  '../../shared/protocol/jobs.mjs': codec,
  '../../shared/api/proofApiClient': { fetchProofApiJson: async (...args) => { lastRequest = args; return structuredClone(response); } },
});
const encoding = await loadClient('src/shared/utils/encoding.ts', { 'bitcoinjs-lib': bitcoin });
const attachment = await loadClient('src/shared/protocol/mailAttachment.ts', {
  'bitcoinjs-lib': bitcoin, '../../functions': { formatBytes: n => `${n} bytes` },
  '../bitcoin/protocolLimits': { MAX_DATA_CARRIER_BYTES: 100000 }, '../utils/encoding': encoding,
});
const plans = await loadClient('src/features/jobs/jobsProtocol.ts', {
  '../../shared/protocol/jobs.mjs': codec, '../../shared/protocol/mailAttachment': attachment,
  '../../shared/utils/encoding': encoding, './jobsApi': api,
  '../boost/boostWallet': { dataCarrierBytesForPayload: payload => bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output.length },
});
const files = await loadClient('src/features/jobs/jobsArtifacts.ts', {
  '../../shared/api/proofApiClient': { fetchProofApiJson: async () => response },
  '../../shared/utils/encoding': encoding, './jobsApi': api,
});
const snapshot = { id: 'fixture-jobs-snapshot', checkpointHeight: codec.JOBS_ACTIVATION_HEIGHT, checkpointHash: 'a'.repeat(64) };
const evidence = { network: 'livenet', complete: true, source: 'proof-indexer-exact-canonical-jobs-replay', snapshot,
  indexedThroughBlock: snapshot.checkpointHeight, indexedThroughBlockHash: snapshot.checkpointHash,
  activationHeight: codec.JOBS_ACTIVATION_HEIGHT, activationPreviousBlockHash: codec.JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH };
const pagination = { hasMore: false, nextCursor: null };
const job = { txid: id(1), headTxid: id(4), title: 'Fixture brief', brief: 'Original criteria', scope: 'Exact agreed scope\r\n',
  rewardSats: '1200', offeredRewardSats: '900', requesterAddress: requester, workerAddress: worker,
  proposalTxid: id(2), assignmentTxid: id(3), deliveryTxid: id(4), acceptanceTxid: '', paymentTxid: '', paidSats: '0',
  status: 'delivered', blockHeight: snapshot.checkpointHeight, blockHash: snapshot.checkpointHash, blockTransactionIndex: 0, blockTime: 1791370800 };
const event = (n, action, authorAddress, metadata) => ({ txid: id(n), action, authorAddress, metadata,
  confirmed: true, valid: true, applied: true, validationErrors: [], blockHeight: snapshot.checkpointHeight,
  blockHash: snapshot.checkpointHash, blockTransactionIndex: n, blockTime: job.blockTime, protocolVout: 1, amountSats: '546', jobTxid: job.txid });
const proposal = event(2, 'propose', worker, { v: 1, job: job.txid, scope: job.scope, rewardSats: job.rewardSats });
const delivery = event(4, 'deliver', worker, { v: 1, job: job.txid, assignment: id(3), text: 'Exact delivered work', artifacts: [] });
const detail = { ...evidence, job, events: [proposal, delivery], proposals: [proposal], deliveries: [delivery], eventsComplete: true, proposalsComplete: true, deliveriesComplete: true };

test('Jobs evidence requires the exact source, activation pin and consistent checkpoint', async () => {
  response = { ...evidence, jobs: [job], pagination };
  assert.equal((await api.fetchJobs('livenet')).jobs[0].rewardSats, '1200');
  for (const change of [{ complete: false }, { source: 'arbitrary-indexer' }, { network: 'testnet' },
    { activationHeight: 1 }, { activationPreviousBlockHash: id(9) }, { indexedThroughBlock: 970402 },
    { snapshot: { ...snapshot, checkpointHash: id(9) } }, { snapshot: { ...snapshot, id: '' } }]) {
    response = { ...evidence, jobs: [], pagination, ...change };
    await assert.rejects(api.fetchJobs('livenet'), /evidence|checkpoint/i);
  }
  response = { ...evidence, indexedThroughBlock: codec.JOBS_ACTIVATION_HEIGHT - 1,
    indexedThroughBlockHash: codec.JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH,
    snapshot: { ...snapshot, checkpointHeight: codec.JOBS_ACTIVATION_HEIGHT - 1, checkpointHash: codec.JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH }, jobs: [], pagination };
  assert.equal((await api.fetchJobs('livenet')).jobs.length, 0);
});
test('Jobs pagination pins filters, cursor and explicit snapshot without silent duplicates', async () => {
  response = { ...evidence, jobs: [job], pagination };
  const controller = new AbortController();
  await api.fetchJobs('livenet', { q: 'Exact work', status: 'delivered', address: worker, cursor: 'cursor', snapshot: snapshot.id, signal: controller.signal });
  const params = new URL(lastRequest[0], 'https://local.test').searchParams;
  assert.equal(params.get('snapshot'), snapshot.id); assert.equal(params.get('cursor'), 'cursor');
  assert.equal(params.get('address'), worker); assert.equal(params.get('q'), 'Exact work');
  assert.equal(lastRequest[2].signal, controller.signal);
  for (const change of [{ snapshot: { ...snapshot, id: 'different' } }, { jobs: [job, job] }, { pagination: { hasMore: true } }]) {
    response = { ...evidence, jobs: [job], pagination, ...change };
    await assert.rejects(api.fetchJobs('livenet', { snapshot: snapshot.id }), /pagination|duplicate/i);
  }
});
test('complete job details retain invalid history but reject forged paid amounts and incomplete arrays', async () => {
  const invalid = { ...event(6, 'invalid', '', null), valid: false, applied: false, validationErrors: ['jobs-body-invalid'] };
  response = { ...detail, events: [...detail.events, invalid] };
  assert.equal((await api.fetchJob('livenet', job.txid)).events.at(-1).valid, false);
  for (const change of [{ eventsComplete: false }, { proposalsComplete: false }, { deliveriesComplete: false },
    { job: { ...job, status: 'paid', acceptanceTxid: id(5), paymentTxid: id(5), paidSats: '1199' } },
    { job: { ...job, rewardSats: '2100000000000001' } }, { events: [proposal, proposal] }]) {
    response = { ...detail, ...change };
    await assert.rejects(api.fetchJob('livenet', job.txid), /evidence|history|payment|terms/i);
  }
});
test('plans encode the canonical body inside ordinary Mail and retain exact drafted terms', () => {
  const draft = { ...plans.emptyJobsDraft, title: 'Café work', scope: ' Exact criteria\r\n', rewardSats: '2100000000000000' };
  const plan = plans.buildJobsPlan(draft);
  assert.ok(plan.payloads[0].startsWith('pwm1:s:'));
  assert.ok(plan.payloads.at(-1).startsWith('pwm1:m:pwj1:brief:'));
  assert.equal(codec.parseJobBody(plan.memo).metadata.scope, draft.scope);
  assert.equal(codec.parseJobBody(plan.memo).metadata.rewardSats, draft.rewardSats);
  assert.equal(JSON.stringify(plans.restoreJobsDraft(plans.jobsDraftFields(draft))), JSON.stringify(draft));
  for (const change of [{ rewardSats: '0546' }, { rewardSats: '545' }, { rewardSats: '1.2' },
    { rewardSats: '2100000000000001' }, { title: ' leading space' }, { scope: ' ' }]) assert.throws(() => plans.buildJobsPlan({ ...draft, ...change }));
});
test('delivery attachments and downloads prove exact bytes, size and hash, never metadata alone', () => {
  const bytes = Buffer.from('\ufeff<script>untrusted work</script>\r\n');
  const file = { name: 'evidence.txt', mime: 'text/plain', size: bytes.length, sha256: hash(bytes), data: bytes.toString('base64url') };
  const draft = { ...plans.emptyJobsDraft, action: 'deliver', job: job.txid, expectedHead: id(3), assignment: id(3), text: 'File evidence', attachment: file };
  const plan = plans.buildJobsPlan(draft);
  const tx = { txid: id(8), status: { confirmed: true }, vout: plan.payloads.map(payload => ({ value: 0, scriptpubkey: Buffer.from(bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output).toString('hex') })) };
  assert.deepEqual(Buffer.from(files.verifiedJobsFile(tx, id(8)).bytes), bytes);
  for (const change of [{ sha256: id(9) }, { size: bytes.length + 1 }, { data: '!!!!' }]) assert.throws(() => plans.buildJobsPlan({ ...draft, attachment: { ...file, ...change } }));
  assert.throws(() => files.verifiedJobsFile({ ...tx, status: { confirmed: false } }, id(8)), /Confirmed/i);
  const forged = structuredClone(tx);
  forged.vout.at(-1).scriptpubkey = Buffer.from(bitcoin.payments.embed({ data: [Buffer.from(attachment.buildAttachmentPayloads({ ...file, sha256: id(9) })[0])] }).output).toString('hex');
  assert.throws(() => files.verifiedJobsFile(forged, id(8)), /SHA-256/i);
  assert.throws(() => plans.buildJobsPlan({ ...draft, artifacts: `${id(9)} ${id(9)}` }), /unique/i);
});
test('autosave is verified and unreadable receipts never silently become empty drafts', () => {
  const stored = new Map(); const storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  plans.persistJobsDraft(storage, 'jobs', plans.emptyJobsDraft);
  assert.equal(JSON.parse(stored.get('jobs')).rewardSats, '546');
  assert.throws(() => plans.persistJobsDraft({ ...storage, setItem() {} }, 'other', plans.emptyJobsDraft), /autosave/i);
  assert.equal(plans.restoreJobsDraft([['Jobs draft', '{broken']]), undefined);
});

let currentDetail = detail, activeAddress = requester, reserved = [], fundingPresent = true, corruptPayment = false;
const sameAddress = (a, b) => Boolean(a && b && a === b);
const paymentReview = await loadClient('src/shared/wallet/paymentReview.ts', { 'bitcoinjs-lib': bitcoin });
const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 1), 0); funding.addOutput(bitcoin.address.toOutputScript(requester), 2000000n);
const wallet = await loadClient('src/features/jobs/jobsWallet.ts', {
  'bitcoinjs-lib': bitcoin, './jobsApi': { ...api, fetchJobs: async () => evidence, fetchJob: async () => structuredClone(currentDetail) }, './jobsProtocol': plans,
  '../../shared/api/proofApiClient': { fetchProofApiJson: async path => path.includes('/utxo') ? fundingPresent ? [{ txid: funding.getId(), vout: 0, status: { confirmed: true } }] : [] : { txid: path.split('/').at(-1), status: { confirmed: true } } },
  '../../shared/wallet/paymentReview': paymentReview,
  '../code/codeWallet': { sameCodeAddress: sameAddress, codeReservedAnchors: async () => reserved },
  '../boost/boostWallet': { ensureWalletNetwork: async (_wallet, _network, address) => { if (address !== activeAddress) throw new Error('Account changed'); }, assertActiveWalletAddress: async (_wallet, address) => { if (address !== activeAddress) throw new Error('Account changed'); },
    buildBoostPaymentPsbt: async ({ fromAddress, payments, protocolPayloads }) => {
      const psbt = new bitcoin.Psbt(); psbt.addInput({ hash: funding.getId(), index: 0, witnessUtxo: funding.outs[0] });
      const amount = payments[0].amountSats + (corruptPayment ? 1 : 0), fee = 1000, change = 2000000 - amount - fee;
      psbt.addOutput({ address: payments[0].address, value: BigInt(amount) });
      for (const payload of protocolPayloads) psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output, value: 0n });
      psbt.addOutput({ address: fromAddress, value: BigInt(change) });
      return { psbtHex: psbt.toHex(), feeSats: fee, changeSats: change, dustFeeSats: 0, inputCount: 1, walletInputIndexes: [0] };
    } },
});
const acceptance = plans.buildJobsPlan({ ...plans.emptyJobsDraft, action: 'accept', job: job.txid, expectedHead: job.headTxid, delivery: job.deliveryTxid });
test('acceptance freezes requester, assigned worker, exact reward and latest confirmed delivery', async () => {
  const prepared = await wallet.prepareJobsTransaction(acceptance, requester, 'livenet', () => {});
  assert.equal(prepared.amountSats, '1200'); assert.equal(prepared.destination, worker);
  assert.equal(prepared.review.evidence.outputs.find(value => value.kind === 'payment').proofs, '1200');
  assert.ok(prepared.review.fields.some(([label, value]) => label === 'Current agreed scope' && value === job.scope));
  for (const change of [{ headTxid: id(9) }, { status: 'paid' }, { deliveryTxid: id(9) }, { requesterAddress: worker }]) {
    currentDetail = { ...detail, job: { ...job, ...change } };
    await assert.rejects(wallet.verifyJobsAuthority(acceptance, requester, 'livenet', () => {}), /confirmed|requester|paid|changed/i);
  }
  currentDetail = detail; activeAddress = worker;
  await assert.rejects(wallet.verifyJobsAuthority(acceptance, requester, 'livenet', () => {}), /Account changed/);
  activeAddress = requester; corruptPayment = true;
  await assert.rejects(wallet.prepareJobsTransaction(acceptance, requester, 'livenet', () => {}), /payment|intent/i);
  corruptPayment = false;
});
test('cancellation before payment and fresh funding reservations are guarded', async () => {
  const cancel = plans.buildJobsPlan({ ...acceptance.draft, action: 'cancel', reason: 'Attested cancellation' });
  assert.equal((await wallet.verifyJobsAuthority(cancel, requester, 'livenet', () => {})).destination, requester);
  const prepared = await wallet.prepareJobsTransaction(acceptance, requester, 'livenet', () => {});
  await wallet.verifyJobsFunding(prepared);
  reserved = [{ txid: funding.getId(), vout: 0 }];
  await assert.rejects(wallet.verifyJobsFunding(prepared), /reserved|changed/i);
  reserved = []; fundingPresent = false;
  await assert.rejects(wallet.verifyJobsFunding(prepared), /funding|changed/i);
  fundingPresent = true;
});
