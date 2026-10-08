import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { encodeJobRecord, JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../../src/shared/protocol/jobs.mjs';

const id = n => n.toString(16).padStart(64, '0');
const requester = 'bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e';
const worker = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const scope = 'Deliver exact work.\r\n<script>window.jobsInjected = true</script>\r\nPreserve this acceptance criterion.  ';
const snapshot = { id: 'fixture-jobs-snapshot', checkpointHeight: JOBS_ACTIVATION_HEIGHT, checkpointHash: 'a'.repeat(64) };
const evidence = { network: 'livenet', complete: true, source: 'proof-indexer-exact-canonical-jobs-replay', snapshot,
  indexedThroughBlock: snapshot.checkpointHeight, indexedThroughBlockHash: snapshot.checkpointHash,
  activationHeight: JOBS_ACTIVATION_HEIGHT, activationPreviousBlockHash: JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH };
const pagination = { limit: 30, total: 1, hasMore: false, nextCursor: null };
const job = { txid: id(1), title: 'Fixture paid work', brief: 'Original scope', scope, rewardSats: '1234567', offeredRewardSats: '900',
  requesterAddress: requester, workerAddress: worker, status: 'delivered', headTxid: id(4), proposalTxid: id(2), assignmentTxid: id(3),
  deliveryTxid: id(4), acceptanceTxid: '', paymentTxid: '', paidSats: '0', blockHeight: snapshot.checkpointHeight,
  blockHash: snapshot.checkpointHash, blockTransactionIndex: 0, blockTime: 1791370800 };
const event = (n, action, authorAddress, metadata) => ({ txid: id(n), action, authorAddress, metadata, confirmed: true,
  valid: true, applied: true, validationErrors: [], blockHeight: snapshot.checkpointHeight, blockHash: snapshot.checkpointHash,
  blockTransactionIndex: n, blockTime: job.blockTime, protocolVout: 1, amountSats: '546', jobTxid: job.txid });
const proposal = event(2, 'propose', worker, { v: 1, job: job.txid, scope, rewardSats: job.rewardSats });
const delivery = event(4, 'deliver', worker, { v: 1, job: job.txid, assignment: id(3), text: scope, artifacts: [] });
const invalid = { ...event(8, 'accept', worker, { v: 1, job: job.txid, delivery: id(4) }), valid: false, applied: false, validationErrors: ['jobs-requester-authority-mismatch'] };
const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 1), 0); funding.addOutput(bitcoin.address.toOutputScript(requester), 2000000n);
const utxo = { txid: funding.getId(), vout: 0, value: 2000000, status: { confirmed: true } };
const blankDraft = { action: 'brief', title: '', scope: '', rewardSats: '546', job: '', proposal: '', assignment: '', delivery: '', text: '', artifacts: '', reason: '', expectedHead: '', feeRate: 1 };

async function fixture(page, { unavailable = false, empty = false, wallet = false, paid = false, unknown = false } = {}) {
  let current = paid ? { ...job, status: 'paid', headTxid: id(5), acceptanceTxid: id(5), paymentTxid: id(5), paidSats: job.rewardSats } : { ...job };
  if (wallet) await page.addInitScript(({ requester, utxo }) => {
    const handlers = new Map(); window.jobsSignatureCalls = 0; window.jobsAccounts = [requester];
    window.jobsWalletEvent = (event, values) => { if (event === 'accountsChanged') window.jobsAccounts = values; for (const handler of handlers.get(event) ?? []) handler(values); };
    window.unisat = { getAccounts: async () => window.jobsAccounts, requestAccounts: async () => window.jobsAccounts,
      getNetwork: async () => 'livenet', getBitcoinUtxos: async () => [utxo],
      on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
      removeListener: (event, handler) => handlers.set(event, (handlers.get(event) ?? []).filter(value => value !== handler)),
      signPsbt: async () => { window.jobsSignatureCalls++; throw new Error('Rejected by disposable test wallet'); } };
  }, { requester, utxo });
  if (unknown) {
    const draft = { ...blankDraft, title: 'Retained broadcast brief', scope: 'Exact unsent criteria', rewardSats: '900' };
    const memo = encodeJobRecord('brief', { v: 1, title: draft.title, scope: draft.scope, rewardSats: draft.rewardSats });
    const key = `jobs:brief:${createHash('sha256').update(memo).digest('hex')}`;
    await page.addInitScript(({ requester, draft, key, txid }) => {
      localStorage.setItem(`proofofwork.jobs.draft.v1:livenet:${requester}`, JSON.stringify(draft));
      localStorage.setItem('proofofwork-action-receipts-v1', JSON.stringify([{ txid, address: requester, network: 'livenet', title: 'Publish job', key,
        createdAt: '2026-10-07T12:00:00Z', status: 'unknown', fields: [['Jobs draft', JSON.stringify(draft)]] }]));
    }, { requester, draft, key, txid: id(9) });
  }
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
    if (url.pathname === '/api/v1/jobs') return route.fulfill(unavailable
      ? { status: 503, json: { error: 'Jobs candidate discovery is incomplete', details: { code: 'JOBS_DISCOVERY_INCOMPLETE' } } }
      : { json: { ...evidence, jobs: empty ? [] : [current], pagination } });
    if (url.pathname === '/api/v1/job') return route.fulfill({ json: { ...evidence, job: current,
      events: [proposal, delivery, invalid], proposals: [proposal], deliveries: [delivery], eventsComplete: true, proposalsComplete: true, deliveriesComplete: true } });
    if (url.pathname.endsWith('/utxo')) return route.fulfill({ json: [utxo] });
    if (url.pathname.endsWith('/hex')) return route.fulfill({ json: { hex: funding.toHex() } });
    if (url.pathname.endsWith('/status')) return route.fulfill(unknown
      ? { status: 503, json: { error: 'Fixture transaction status unavailable' } }
      : { json: { status: 'confirmed', confirmed: true } });
    if (url.pathname === '/api/v1/registry') return route.fulfill({ json: { network: 'livenet', records: [], listings: [], coverage: { complete: true }, collectionHasMore: { listings: false } } });
    if (url.pathname === '/api/v1/token') return route.fulfill({ json: { network: 'livenet', listings: [], source: 'proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state', walletScoped: true, authoritativeWallet: true, summaryOnly: true } });
    if (url.pathname === '/api/v1/boost') return route.fulfill({ json: { network: 'livenet', complete: true, items: [], hasMore: false } });
    return route.fulfill({ json: { records: [], items: [], listings: [], complete: true, minimumFee: 0.1, fastestFee: 1, halfHourFee: 1, hourFee: 1 } });
  });
  return { change: value => { current = { ...current, ...value }; } };
}
async function connect(page) {
  const button = page.getByRole('button', { name: 'Connect UniSat', exact: true });
  await button.first().click();
  await expect(page.getByRole('button', { name: 'Disconnect UniSat', exact: true })).toBeVisible();
}
async function prepareBrief(page, title = 'Local review brief') {
  await page.getByRole('button', { name: 'Post a job', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Job title', exact: false }).fill(title);
  await page.getByRole('textbox', { name: 'Brief and acceptance criteria', exact: true }).fill('Exact work and acceptance criteria.');
  await page.getByRole('textbox', { name: 'Offered reward in proofs', exact: false }).fill('900');
  await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
}

for (const url of ['/?jobs=1', '/?folder=jobs']) {
  test(`${url} incomplete evidence is unavailable; verified absence is empty`, async ({ page }) => {
    await fixture(page, { unavailable: true }); await page.goto(url);
    await expect(page.getByText('Jobs evidence unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText(/Jobs candidate discovery is incomplete/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The first job starts here.' })).toHaveCount(0);
    await page.unroute('**/api/v1/**'); await fixture(page, { empty: true });
    await page.getByRole('button', { name: 'Retry verified read', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The first job starts here.' })).toBeVisible();
    await page.getByRole('button', { name: 'My Jobs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect to see My Jobs', exact: true })).toBeVisible();
  });
}
for (const surface of ['standalone', 'computer']) {
  for (const width of [390, 1440]) {
  test(`${surface} Jobs board, receipt and inert evidence fit ${width}px with exact proofs`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await fixture(page, { paid: true });
    await page.goto(surface === 'computer' ? '/?folder=jobs' : '/?jobs=1');
    await expect(page.getByRole('button', { name: job.title, exact: true })).toBeVisible({ timeout: 30000 });
    if (surface === 'computer') {
      const layout = await page.locator('.jobs-embedded-app').evaluate(element => {
        const app = element.getBoundingClientRect(), parent = element.parentElement.getBoundingClientRect();
        return { grid: getComputedStyle(element).gridColumn, overflow: getComputedStyle(element).overflowY,
          right: app.right, left: app.left, parentRight: parent.right, parentLeft: parent.left, width: app.width };
      });
      expect(layout.grid).toBe(width <= 900 ? '1 / -1' : '2 / -1');
      expect(layout.overflow).toBe('auto');
      expect(Math.abs(layout.right - layout.parentRight)).toBeLessThanOrEqual(1);
      if (width <= 900) expect(Math.abs(layout.left - layout.parentLeft)).toBeLessThanOrEqual(1);
      else expect(layout.width).toBeGreaterThan(700);
    }
    await page.screenshot({ path: `/tmp/proofofwork-jobs-fixture-${surface}-board-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: job.title, exact: true }).click();
    await expect(page.locator('.jobs-prose').first()).toContainText('window.jobsInjected = true');
    expect(await page.evaluate(() => window.jobsInjected)).toBeUndefined();
    await page.getByRole('button', { name: 'Work receipt', exact: true }).click();
    await expect(page.locator('.jobs-receipt')).toContainText('1,234,567 proofs');
    await expect(page.locator('.jobs-receipt')).toContainText(requester);
    await expect(page.locator('.jobs-receipt')).toContainText(worker);
    await expect(page.locator('.jobs-receipt')).toContainText('Acceptance and direct payment');
    await expect(page.locator('.jobs-receipt')).toContainText(id(5));
    await page.getByText('Inspect complete confirmed history (3)', { exact: true }).click();
    await expect(page.getByText('Unapplied evidence', { exact: true })).toBeVisible();
    await expect(page.getByText('jobs-requester-authority-mismatch', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }))).toEqual({ width, viewport: width });
    if (surface === 'computer') {
      const scroll = await page.locator('.jobs-embedded-app').evaluate((element, width) => {
        const scroller = width <= 900 ? document.scrollingElement : element;
        scroller.scrollTop = scroller.scrollHeight;
        const result = { height: scroller.clientHeight, content: scroller.scrollHeight, scrolled: scroller.scrollTop };
        scroller.scrollTop = 0; return result;
      }, width);
      expect(scroll.content).toBeGreaterThan(scroll.height);
      expect(scroll.scrolled).toBeGreaterThan(0);
    }
    await page.screenshot({ path: `/tmp/proofofwork-jobs-fixture-${surface}-receipt-${width}.png`, fullPage: true });
  });
  }
}
test('embedded Jobs autosaves exact fields, fences failed storage and restores the draft', async ({ page }) => {
  await fixture(page); await page.goto('/?folder=jobs');
  await page.getByRole('button', { name: 'Post a job', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Job title', exact: false }).fill('Retained local job');
  await page.getByRole('textbox', { name: 'Brief and acceptance criteria', exact: true }).fill('Exact unsent work\n');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('proofofwork.jobs.draft.v1:livenet:disconnected') ?? '{}').title)).toBe('Retained local job');
  expect(await page.evaluate(() => window.dispatchEvent(new Event('proofofwork:before-jobs-writer-leave', { cancelable: true })))).toBe(true);
  expect(await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('proofofwork.jobs.draft')) throw new Error('Fixture quota'); return original.call(this, key, value); };
    const allowed = window.dispatchEvent(new Event('proofofwork:before-jobs-writer-leave', { cancelable: true }));
    Storage.prototype.setItem = original; return allowed;
  })).toBe(false);
  await expect(page.getByRole('textbox', { name: 'Job title', exact: false })).toHaveValue('Retained local job');
  await page.reload(); await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Brief and acceptance criteria', exact: true })).toHaveValue('Exact unsent work\n');
});
for (const url of ['/?jobs=1', '/?folder=jobs']) {
  test(`${url} authoritative wallet summaries permit job review before signing`, async ({ page }) => {
    await fixture(page, { wallet: true }); await page.goto(url); await connect(page); await prepareBrief(page);
    await expect(page.getByRole('dialog', { name: 'Publish job', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.jobsSignatureCalls)).toBe(0);
  });
}
test('disposable rejected signature preserves the reviewed brief without changing chain state', async ({ page }) => {
  await fixture(page, { wallet: true }); await page.goto('/?jobs=1'); await connect(page); await prepareBrief(page);
  await expect(page.getByRole('dialog', { name: 'Publish job', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('546 proofs');
  await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
  await expect(page.getByText('Rejected by disposable test wallet', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Job title', exact: false })).toHaveValue('Local review brief');
  expect(await page.evaluate(() => window.jobsSignatureCalls)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('proofofwork-action-receipts-v1') ?? '[]').length)).toBe(0);
});
test('wallet account change invalidates review before any signature', async ({ page }) => {
  await fixture(page, { wallet: true }); await page.goto('/?jobs=1'); await connect(page); await prepareBrief(page);
  await expect(page.getByRole('dialog', { name: 'Publish job', exact: true })).toBeVisible();
  await page.evaluate(address => window.jobsWalletEvent('accountsChanged', [address]), worker);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Wallet account changed. Review Jobs actions again.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.jobsSignatureCalls)).toBe(0);
  expect(await page.evaluate(address => JSON.parse(localStorage.getItem(`proofofwork.jobs.draft.v1:livenet:${address}`)).title, requester)).toBe('Local review brief');
});
test('acceptance review pays the exact frozen worker reward and rejects a changed confirmed head', async ({ page }) => {
  const controller = await fixture(page, { wallet: true }); await page.goto(`/?jobs=1&job=${job.txid}`); await connect(page);
  await page.getByRole('button', { name: 'Accept and pay', exact: true }).click();
  await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Accept delivery and pay', exact: true }); await expect(review).toBeVisible();
  await expect(review).toContainText('1234567 proofs'); await expect(review).toContainText(worker); await expect(review).toContainText(scope.replace(/\r\n/gu, '\n'));
  controller.change({ headTxid: id(9) });
  await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
  await expect(page.getByText(/The confirmed job changed/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await page.evaluate(() => window.jobsSignatureCalls)).toBe(0);
});
test('unknown broadcast evidence blocks a duplicate review while retaining task fields', async ({ page }) => {
  await fixture(page, { wallet: true, unknown: true }); await page.goto('/?jobs=1'); await connect(page);
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Job title', exact: false })).toHaveValue('Retained broadcast brief');
  await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
  await expect(page.getByText(/Fixture transaction status unavailable|unresolved or pending/).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(await page.evaluate(() => window.jobsSignatureCalls)).toBe(0);
  const receipts = await page.evaluate(() => JSON.parse(localStorage.getItem('proofofwork-action-receipts-v1')));
  expect(receipts[0].status).toBe('unknown'); expect(receipts[0].txid).toBe(id(9));
});
