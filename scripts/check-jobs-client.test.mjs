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
const snapshot = { id: 'fixture-jobs-snapshot', checkpointHeight: codec.JOBS_V2_ACTIVATION_HEIGHT, checkpointHash: 'a'.repeat(64) };
const evidence = { network: 'livenet', complete: true, source: 'proof-indexer-exact-canonical-jobs-replay', snapshot,
  indexedThroughBlock: snapshot.checkpointHeight, indexedThroughBlockHash: snapshot.checkpointHash,
  activationHeight: codec.JOBS_ACTIVATION_HEIGHT, activationPreviousBlockHash: codec.JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH,
  versions: { supported: [1, 2], current: 2, v2ActivationHeight: codec.JOBS_V2_ACTIVATION_HEIGHT, v2ActivationPreviousBlockHash: codec.JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH, v2Ready: true } };
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
const workSettlement = reward => ({ valid: true, source: 'canonical-work-send3-relational-raw-replay', reward, paymentTxid: id(5), protocolVout: 5, registryVout: 4, blockHeight: snapshot.checkpointHeight, blockHash: snapshot.checkpointHash, blockTransactionIndex: 5 });

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
    versions: { ...evidence.versions, v2Ready: false },
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
test('WORK promises preserve all Q16 places, change currency explicitly and retain historical proof drafts', () => {
  const draft = { ...plans.emptyJobsDraft, title: 'Exact WORK brief', scope: 'Full precision scope', rewardAsset: 'WORK', rewardWork: '1.0000000000000001' };
  const plan = plans.buildJobsPlan(draft), metadata = codec.parseJobBody(plan.memo).metadata;
  assert.equal(metadata.v, 2); assert.equal(metadata.reward.asset, 'WORK');
  assert.equal(metadata.reward.amountSubatoms, '10000000000000001');
  assert.equal(metadata.reward.token, codec.JOBS_WORK_TOKEN_ID); assert.equal(metadata.rewardSats, undefined);
  assert.ok(plan.fields.some(([label, value]) => label === 'Proposed reward' && value.includes('1.0000000000000001 WORK')));
  assert.equal(plans.restoreJobsDraft(plans.jobsDraftFields(draft)).rewardWork, draft.rewardWork);
  for (const rewardWork of ['0', '-1', '1e3', '0.00000000000000001', '21000000.0000000000000001', '01']) assert.throws(() => plans.buildJobsPlan({ ...draft, rewardWork }));
  const legacy = { ...draft, rewardSats: '900' }; delete legacy.rewardAsset; delete legacy.rewardWork;
  assert.equal(JSON.stringify(plans.restoreJobsDraft(plans.jobsDraftFields(legacy))), JSON.stringify(legacy));
  assert.equal(codec.parseJobBody(plans.buildJobsPlan(legacy).memo).metadata.v, 1);
});
test('WORK API receipts require exact frozen asset, canonical token and paid amount without using zero proof aliases', async () => {
  const reward = { asset: 'WORK', token: codec.JOBS_WORK_TOKEN_ID, amountSubatoms: '10000000000000001' };
  const workJob = { ...job, rewardSats: '0', offeredRewardSats: '0', reward, offeredReward: reward, paidReward: null };
  response = { ...evidence, jobs: [workJob], pagination };
  assert.equal((await api.fetchJobs('livenet')).jobs[0].reward.amountSubatoms, reward.amountSubatoms);
  const paid = { ...workJob, status: 'paid', acceptanceTxid: id(5), paymentTxid: id(5), paidReward: reward, workSettlement: workSettlement(reward) };
  response = { ...evidence, jobs: [paid], pagination };
  assert.equal((await api.fetchJobs('livenet')).jobs[0].paidSats, '0');
  for (const change of [{ reward: { ...reward, token: id(9) } }, { rewardSats: '546' }, { paidReward: { ...reward, amountSubatoms: '10000000000000002' } }, { paidReward: null }]) {
    response = { ...evidence, jobs: [{ ...paid, ...change }], pagination };
    await assert.rejects(api.fetchJobs('livenet'), /evidence|terms|payment/i);
  }
  response = { ...evidence, jobs: [{ ...workJob, paidReward: reward }], pagination };
  await assert.rejects(api.fetchJobs('livenet'), /payment/i);
  for (const change of [{ valid: false }, { source: 'raw-send3-shape-only' }, { paymentTxid: id(6) }, { reward: { ...reward, amountSubatoms: '1' } }, { protocolVout: -1 }, { registryVout: 5 }, { blockHeight: snapshot.checkpointHeight + 1 }, { blockHash: id(9) }, { blockTransactionIndex: '5' }]) {
    response = { ...evidence, jobs: [{ ...paid, workSettlement: { ...paid.workSettlement, ...change } }], pagination };
    await assert.rejects(api.fetchJobs('livenet'), /evidence|settlement|checkpoint/i);
  }
  response = { ...evidence, jobs: [{ ...paid, workSettlement: undefined }], pagination };
  await assert.rejects(api.fetchJobs('livenet'), /settlement/i);
  response = { ...detail, job: { ...paid, workSettlement: { ...paid.workSettlement, blockHeight: snapshot.checkpointHeight + 1 } } };
  await assert.rejects(api.fetchJob('livenet', paid.txid), /checkpoint/i);
});
test('WORK-capable paid totals never infer zero from absent or rounded WORK evidence', async () => {
  for (const paidWorkSubatoms of [undefined, 0, '01', '1.2']) {
    response = { ...evidence, jobs: [job], pagination, stats: { paidProofs: '0', paidWorkSubatoms } };
    await assert.rejects(api.fetchJobs('livenet'), /totals/i);
  }
  response = { ...evidence, jobs: [job], pagination, stats: { paidProofs: '0', paidWorkSubatoms: '0' } };
  assert.equal((await api.fetchJobs('livenet')).stats.paidWorkSubatoms, '0');
  response = { ...evidence, versions: undefined, jobs: [job], pagination, stats: { paidProofs: '0' } };
  assert.equal((await api.fetchJobs('livenet')).stats.paidWorkSubatoms, undefined);
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

let currentDetail = detail, activeAddress = requester, reserved = [], fundingPresent = true, corruptPayment = false, corruptWork = false;
let workSpendable = 10000000000000001n, workAdmission = true, workReads = 0, workAdmissionReads = 0;
const paymentReview = await loadClient('src/shared/wallet/paymentReview.ts', { 'bitcoinjs-lib': bitcoin });
const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 1), 0); funding.addOutput(bitcoin.address.toOutputScript(requester), 2000000n);
const reservationScopes = ['', 'd4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8',
  'a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562',
  '3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d'];
const scopedReserved = new Map(), creditChanges = new Map(), reservationRequests = [], paymentBuilds = [];
const walletApi = { fetchProofApiJson: async (path, network) => {
  if (path.includes('/utxo')) return fundingPresent ? [{ txid: funding.getId(), vout: 0, status: { confirmed: true } }] : [];
  if (path.startsWith('/api/v1/registry?')) return { network, records: [], listings: [], coverage: { complete: true } };
  if (path.startsWith('/api/v1/boost?')) return { network, complete: true, items: [], hasMore: false };
  if (path.startsWith('/api/v1/token?')) {
    const params = new URL(path, 'https://fixture.test').searchParams, scope = params.get('asset');
    reservationRequests.push({ address: params.get('address'), scope, fresh: params.get('fresh'), wallet: params.get('wallet') });
    const anchors = [...(scope === '' ? reserved : []), ...(scopedReserved.get(scope) ?? [])];
    return { network, authoritativeWallet: true, walletScoped: true,
      source: 'proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state', summaryOnly: true,
      listings: anchors.map(anchor => ({ listingId: anchor.txid, sellerAddress: requester,
        saleAuthorization: { anchorTxid: anchor.txid, anchorVout: anchor.vout } })), ...creditChanges.get(scope) };
  }
  return { txid: path.split('/').at(-1), status: { confirmed: true } };
} };
const boostWallet = { ensureWalletNetwork: async (_wallet, _network, address) => { if (address !== activeAddress) throw new Error('Account changed'); }, assertActiveWalletAddress: async (_wallet, address) => { if (address !== activeAddress) throw new Error('Account changed'); },
    dataCarrierBytesForPayload: payload => bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output.length,
    scriptForAddress: address => bitcoin.address.toOutputScript(address),
    fetchReservedAmoAnchorOutpoints: async (_address, _network, additional) => additional,
    buildBoostPaymentPsbt: async options => {
      paymentBuilds.push(options);
      const { fromAddress, payments, protocolPayloads, postProtocolPayments = [], postProtocolPayloads = [] } = options;
      const psbt = new bitcoin.Psbt(); psbt.addInput({ hash: funding.getId(), index: 0, witnessUtxo: funding.outs[0] });
      const amount = payments[0].amountSats + (corruptPayment ? 1 : 0), fee = 1000, change = 2000000 - amount - postProtocolPayments.reduce((sum, item) => sum + item.amountSats, 0) - fee;
      psbt.addOutput({ address: payments[0].address, value: BigInt(amount) });
      for (const payload of protocolPayloads) psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output, value: 0n });
      for (const item of postProtocolPayments) psbt.addOutput({ address: item.address, value: BigInt(item.amountSats) });
      for (const payload of postProtocolPayloads) psbt.addOutput({ script: bitcoin.payments.embed({ data: [Buffer.from(corruptWork ? payload.replace('10000000000000001', '10000000000000002') : payload)] }).output, value: 0n });
      psbt.addOutput({ address: fromAddress, value: BigInt(change) });
      return { psbtHex: psbt.toHex(), feeSats: fee, changeSats: change, dustFeeSats: 0, inputCount: 1, walletInputIndexes: [0] };
    } };
const surfaceReadState = await loadClient('src/shared/api/surfaceReadState.ts');
const reservations = await loadClient('src/features/code/codeReservations.ts', {
  '../../shared/api/surfaceReadState': surfaceReadState,
});
const codeWallet = await loadClient('src/features/code/codeWallet.ts', {
  'bitcoinjs-lib': bitcoin, '../../shared/api/proofApiClient': walletApi,
  '../../shared/wallet/paymentReview': paymentReview, './codeReservations': reservations,
  './codeApi': { fetchCodeRepository: async () => { throw new Error('Unexpected repository read'); } },
  '../boost/boostProtocol': { boostListingAnchorOutpoints: () => [] }, '../boost/boostWallet': boostWallet,
});
const wallet = await loadClient('src/features/jobs/jobsWallet.ts', {
  'bitcoinjs-lib': bitcoin, './jobsApi': { ...api, fetchJobs: async () => evidence, fetchJob: async () => structuredClone(currentDetail) }, './jobsProtocol': plans,
  '../../shared/api/proofApiClient': walletApi, '../../shared/wallet/paymentReview': paymentReview,
  '../code/codeWallet': codeWallet, '../boost/boostWallet': boostWallet,
  './jobsWorkCapacity': { fetchJobsWorkCapacity: async () => { workReads++; return { anchorOutpoints: [{ txid: id(80), vout: 2 }], spendableSubatoms: workSpendable }; } },
  '../../shared/protocol/jobs.mjs': codec,
  '../boost/boostWorkComposer': { BOOST_WORK_REGISTRY_ADDRESS: codec.JOBS_WORK_REGISTRY_ADDRESS, BOOST_WORK_MUTATION_PROOFS: 546,
    requireBoostWorkWriteAdmission: async () => { workAdmissionReads++; if (!workAdmission) throw new Error('WORK Q16 transfer admission is unavailable'); },
    buildBoostWorkSendPayload: (amount, address) => `pwt1:send3:${codec.JOBS_WORK_TOKEN_ID}:${amount}:${address}` },
});
const acceptance = plans.buildJobsPlan({ ...plans.emptyJobsDraft, action: 'accept', job: job.txid, expectedHead: job.headTxid, delivery: job.deliveryTxid });
test('WORK acceptance pays the exact frozen Q16 amount, with separate Mail and registry fees and fresh spendability', async () => {
  const reward = { asset: 'WORK', token: codec.JOBS_WORK_TOKEN_ID, amountSubatoms: '10000000000000001' };
  currentDetail = { ...detail, job: { ...job, rewardSats: '0', offeredRewardSats: '0', reward, offeredReward: reward, paidReward: null } };
  const workPlan = plans.buildJobsPlan({ ...acceptance.draft, rewardAsset: 'WORK', rewardWork: '1.0000000000000001' });
  workReads = 0; workAdmissionReads = 0;
  const prepared = await wallet.prepareJobsTransaction(workPlan, requester, 'livenet', () => {});
  assert.equal(prepared.amountSats, '546'); assert.equal(prepared.destination, worker);
  assert.equal(prepared.reward.amountSubatoms, reward.amountSubatoms);
  const outputs = prepared.review.evidence.outputs, payments = outputs.filter(output => output.kind === 'payment');
  assert.equal(payments.length, 2); assert.equal(payments[0].address, worker); assert.equal(payments[0].proofs, '546');
  assert.equal(payments[1].address, codec.JOBS_WORK_REGISTRY_ADDRESS); assert.equal(payments[1].proofs, '546');
  assert.equal(prepared.review.evidence.records.at(-1), `pwt1:send3:${codec.JOBS_WORK_TOKEN_ID}:10000000000000001:${worker}`);
  assert.ok(payments[1].index > outputs.filter(output => output.kind === 'record').at(-2).index);
  assert.ok(paymentBuilds.at(-1).excludeOutpoints.some(item => item.txid === id(80)));
  assert.ok(prepared.review.fields.some(([label, value]) => label === 'Exact WORK reward' && value === '1.0000000000000001 WORK'));
  assert.ok(workReads >= 3 && workAdmissionReads >= 3);
  await wallet.verifyJobsFunding(prepared);
  workSpendable = 10000000000000000n;
  await assert.rejects(wallet.verifyJobsFunding(prepared), /spendable/i);
  workSpendable = 10000000000000001n; workAdmission = false;
  await assert.rejects(wallet.prepareJobsTransaction(workPlan, requester, 'livenet', () => {}), /admission/i);
  workAdmission = true; corruptWork = true;
  await assert.rejects(wallet.prepareJobsTransaction(workPlan, requester, 'livenet', () => {}), /intent|record/i);
  corruptWork = false;
  currentDetail = { ...currentDetail, versions: { ...evidence.versions, v2Ready: false } };
  await assert.rejects(wallet.prepareJobsTransaction(workPlan, requester, 'livenet', () => {}), /Jobs v2 admission/i);
  currentDetail = detail;
});
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
test('posting a job accepts production wallet summaries and excludes reservations from every credit and bond scope', async () => {
  reservationRequests.length = 0;
  const brief = plans.buildJobsPlan({ ...plans.emptyJobsDraft, title: 'Welcome To Jobs', scope: 'Test Job Listing.' });
  const emptyPrepared = await wallet.prepareJobsTransaction(brief, requester, 'livenet', () => {});
  assert.equal(emptyPrepared.destination, requester);
  assert.equal(emptyPrepared.amountSats, '546');
  assert.deepEqual(reservationRequests.map(request => request.scope).sort(), [...reservationScopes].sort());
  assert.ok(reservationRequests.every(request => request.address === requester && request.fresh === '1' && request.wallet === '1'));
  for (const [index, scope] of reservationScopes.entries()) {
    scopedReserved.set(scope, [{ txid: id(index + 40), vout: index }]);
    creditChanges.set(scope, { hasMore: true, collectionHasMore: { listings: false, transfers: true }, totalCounts: { listings: 1 } });
  }
  const prepared = await wallet.prepareJobsTransaction(brief, requester, 'livenet', () => {});
  assert.deepEqual(Array.from(paymentBuilds.at(-1).excludeOutpoints, item => `${item.txid}:${item.vout}`).sort(),
    reservationScopes.map((_scope, index) => `${id(index + 40)}:${index}`).sort());
  await wallet.verifyJobsFunding(prepared);
  scopedReserved.set(reservationScopes[3], [{ txid: funding.getId(), vout: 0 }]);
  await assert.rejects(wallet.verifyJobsFunding(prepared), /reserved|changed/i);
  scopedReserved.clear(); creditChanges.clear();
});
test('Jobs preparation and fresh funding reject explicitly incomplete or nonauthoritative wallet reservations', async () => {
  const brief = plans.buildJobsPlan({ ...plans.emptyJobsDraft, title: 'Welcome To Jobs', scope: 'Test Job Listing.' });
  const prepared = await wallet.prepareJobsTransaction(brief, requester, 'livenet', () => {});
  for (const change of [{ authoritativeWallet: false }, { walletScoped: false }, { source: ' ' },
    { source: 'summary-cache' }, { listings: undefined }, { listingBookComplete: false },
    { collectionHasMore: { listings: true } }, { totalCounts: { listings: 1 } }]) {
    creditChanges.set(reservationScopes[2], change);
    const priorBuilds = paymentBuilds.length;
    await assert.rejects(wallet.prepareJobsTransaction(brief, requester, 'livenet', () => {}), /reservations/i);
    assert.equal(paymentBuilds.length, priorBuilds);
    await assert.rejects(wallet.verifyJobsFunding(prepared), /reservations/i);
  }
  creditChanges.clear();
});
