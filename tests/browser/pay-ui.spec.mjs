import { expect, test } from '@playwright/test';
import * as bitcoin from 'bitcoinjs-lib';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { PAY_ACTIVATION_HEIGHT, PAY_ACTIVATION_PREVIOUS_BLOCK_HASH, PAY_WORK_TOKEN_ID } from '../../src/shared/protocol/pay.mjs';

const id = n => n.toString(16).padStart(64, '0');
const payer = '1FvyAqqELFiQyaEWdhFbWF8MZapKPZS8J7', recipient = 'bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e';
const height = PAY_ACTIVATION_HEIGHT + 2, hash = id(99);
const evidence = { network: 'livenet', complete: true, source: 'proof-indexer-exact-canonical-pay-replay',
  snapshot: { id: 'fixture-pay-snapshot', checkpointHeight: height, checkpointHash: hash }, indexedThroughBlock: height, indexedThroughBlockHash: hash,
  activation: { height: PAY_ACTIVATION_HEIGHT, previousBlockHash: PAY_ACTIVATION_PREVIOUS_BLOCK_HASH, ready: true },
  admission: { ready: true, writesEnabled: true, reason: '' }, pendingEvents: [] };
const invoice = { txid: id(1), headTxid: id(1), issuerAddress: payer, recipientAddress: recipient, title: 'Fixture public invoice',
  description: 'Exact work terms.\r\n<script>window.payInjected = true</script>', amount: { asset: 'proofs', amountSats: '1234567' }, reference: null,
  status: 'open', paymentTxid: '', payerAddress: '', paidAmount: null, blockHeight: PAY_ACTIVATION_HEIGHT, blockHash: id(90), blockTransactionIndex: 0 };
const event = (n, action, extra = {}) => ({ txid: id(n), action, invoiceTxid: id(1), authorAddress: payer, metadata: {},
  confirmed: true, valid: true, applied: true, validationErrors: [], blockHeight: height, blockHash: hash, blockTransactionIndex: n, ...extra });
const blankDraft = { action: 'invoice', title: '', description: '', recipient: '', asset: 'proofs', proofs: '546', work: '1', reference: '', invoice: '', expectedHead: '', reason: '', feeRate: 1 };
async function fixture(page, { unavailable = false, empty = false, wallet = false, paid = false, work = false, closed = false, unsupported = false, unknown = false } = {}) {
  const amount = work ? { asset: 'WORK', token: PAY_WORK_TOKEN_ID, amountSubatoms: '10000000000000001' } : invoice.amount;
  let current = { ...invoice, amount, ...(paid ? { status: 'paid', paymentTxid: id(2), headTxid: id(2), payerAddress: payer, paidAmount: amount } : {}) };
  const settlement = work && paid ? { valid: true, source: 'canonical-work-send3-relational-raw-replay', reward: amount, paymentTxid: id(2), protocolVout: 4, registryVout: 3, blockHeight: height, blockHash: hash, blockTransactionIndex: 2 } : undefined;
  if (settlement) current.workSettlement = settlement;
  const walletAddress = unsupported ? recipient : payer;
  const funding = new bitcoin.Transaction(); funding.addInput(Buffer.alloc(32, 1), 0); funding.addOutput(bitcoin.address.toOutputScript(walletAddress), 2_000_000n);
  const utxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };
  if (wallet) await page.addInitScript(({ walletAddress, utxo }) => {
    const handlers = new Map(); let approved = false; window.paySignatureCalls = 0; window.payAccounts = [walletAddress];
    window.payWalletEvent = values => { window.payAccounts = values; approved = values.length > 0; for (const handler of handlers.get('accountsChanged') ?? []) handler(values); };
    window.unisat = { getAccounts: async () => approved ? window.payAccounts : [], requestAccounts: async () => { approved = true; return window.payAccounts; }, disconnect: async () => { approved = false; },
      getNetwork: async () => 'livenet', getBitcoinUtxos: async () => [utxo], on: (name, handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      removeListener: (name, handler) => handlers.set(name, (handlers.get(name) ?? []).filter(value => value !== handler)),
      signPsbt: async () => { window.paySignatureCalls++; throw new Error('Rejected by disposable fixture wallet'); } };
  }, { walletAddress, utxo });
  if (unknown) await page.addInitScript(({ payer, draft, txid, invoiceId, amount }) => {
    localStorage.setItem(`proofofwork.pay.draft.v1:livenet:${payer}`, JSON.stringify(draft));
    localStorage.setItem('proofofwork-action-receipts-v1', JSON.stringify([{ txid, address: payer, network: 'livenet', title: 'Pay invoice', key: `pay:invoice:${invoiceId}:${invoiceId}`,
      createdAt: '2026-11-14T12:00:00Z', status: 'unknown', fields: [['Pay draft', JSON.stringify(draft)], ['Pay reviewed amount', JSON.stringify(amount)]] }]));
  }, { payer, draft: { ...blankDraft, action: 'pay', invoice: id(1), expectedHead: id(1), asset: work ? 'WORK' : 'proofs', work: '1.0000000000000001' }, txid: id(7), invoiceId: id(1), amount });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
    const envelope = { ...evidence, admission: { ...evidence.admission, writesEnabled: !closed, reason: closed ? 'Pay publication is closed.' : '' } };
    if (url.pathname === '/api/v1/pay-invoices') return route.fulfill(unavailable ? { status: 503, json: { error: 'Pay candidate discovery is incomplete' } } : { json: { ...envelope,
      invoices: empty ? [] : [current], pagination: { hasMore: false, nextCursor: null, total: empty ? 0 : 1 } } });
    if (url.pathname === '/api/v1/pay-invoice') return route.fulfill({ json: { ...envelope, invoice: current, eventsComplete: true,
      events: [event(1, 'invoice'), ...(paid ? [event(2, 'pay')] : []), event(8, 'pay', { valid: false, applied: false, validationErrors: ['pay-already-settled'] })],
      receipt: paid ? { invoiceTxid: id(1), paymentTxid: id(2), issuerAddress: payer, recipientAddress: recipient, payerAddress: payer, amount,
        blockHeight: height, blockHash: hash, blockTransactionIndex: 2, ...(settlement ? { workSettlement: settlement } : {}) } : null } });
    if (url.pathname.endsWith('/utxo')) return route.fulfill({ json: [utxo] });
    if (url.pathname.endsWith('/hex')) return route.fulfill({ json: { hex: funding.toHex() } });
    if (url.pathname.endsWith('/status')) return route.fulfill(unknown ? { status: 503, json: { error: 'Transaction status unavailable' } } : { json: { status: 'confirmed' } });
    if (url.pathname === '/api/v1/registry') return route.fulfill({ json: { network: 'livenet', records: [], listings: [], coverage: { complete: true }, collectionHasMore: { listings: false } } });
    if (url.pathname === '/api/v1/token') return route.fulfill({ json: { network: 'livenet', listings: [], closedListings: [], transfers: [], sales: [], holders: [], canonicalWorkCapacities: [], source: 'proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state', walletScoped: true, authoritativeWallet: true, summaryOnly: true,
      ...(work && url.searchParams.get('asset') === PAY_WORK_TOKEN_ID ? { indexedThroughBlock: height, indexedThroughBlockHash: hash,
        holders: [{ address: payer, tokenId: PAY_WORK_TOKEN_ID, balanceSubatoms: amount.amountSubatoms }],
        canonicalWorkCapacities: [{ model: 'canonical-work-wallet-capacity-v1', network: 'livenet', address: payer, tokenId: PAY_WORK_TOKEN_ID,
          indexedThroughBlock: height, indexedThroughBlockHash: hash, confirmedBalanceSubatoms: amount.amountSubatoms, reservedBalanceSubatoms: '0', transferableBalanceSubatoms: amount.amountSubatoms, reservations: [],
          tokenStateCommitment: { model: 'canonical-work-amo-payload-sha256-v1', sha256: id(20), payloadBytes: 100 } }] } : {}) } });
    if (url.pathname === '/api/v1/work-floor') return route.fulfill({ json: { workAmoV8: { version: 'pwt-sale-v8', pinsRequested: true, pinsConfigured: true, protocolReady: true, writeAdmission: true, activation: { active: true, reached: true, tipVerified: true, evidenceComplete: true } } } });
    if (url.pathname === '/api/v1/boost') return route.fulfill({ json: { network: 'livenet', complete: true, items: [], hasMore: false } });
    return route.fulfill({ json: { records: [], items: [], listings: [], complete: true, minimumFee: 0.1, fastestFee: 1, halfHourFee: 1, hourFee: 1 } });
  });
  return { change: value => { current = { ...current, ...value }; } };
}
async function connect(page) {
  await page.getByRole('button', { name: 'Connect UniSat', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Disconnect UniSat', exact: true })).toBeVisible();
}
for (const route of ['/?pay=1', '/?folder=pay']) test(`${route} unavailable and verified empty are distinct`, async ({ page }) => {
  await fixture(page, { unavailable: true }); await page.goto(route);
  await expect(page.getByText('Pay evidence unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your next payment starts here.' })).toHaveCount(0);
  await page.unroute('**/api/v1/**'); await fixture(page, { empty: true });
  await page.getByRole('button', { name: 'Retry verified read' }).click();
  await expect(page.getByRole('heading', { name: 'Your next payment starts here.' })).toBeVisible();
});
for (const route of ['/?pay=1', '/?folder=pay']) for (const width of [390, 1440]) test(`${route} exact receipt and local QR fit ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 }); await fixture(page, { paid: true, work: true }); await page.goto(route);
  await page.getByRole('link', { name: invoice.title, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirmed payment receipt' })).toBeVisible();
  await expect(page.locator('.pay-invoice-amount')).toHaveText('1.0000000000000001 WORK');
  await expect(page.locator('.pay-prose')).toHaveText(invoice.description);
  expect(await page.evaluate(() => window.payInjected)).toBeUndefined();
  await page.getByText('Share invoice link and QR code', { exact: true }).click();
  const qr = page.getByRole('img', { name: 'QR code opening this exact invoice on ProofOfWork Pay' });
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/u);
  const href = `https://pay.proofofwork.me/?invoice=${id(1)}`;
  await expect(page.getByRole('textbox', { name: 'Invoice link', exact: true })).toHaveValue(href);
  const png = PNG.sync.read(Buffer.from((await qr.getAttribute('src')).split(',')[1], 'base64')), modules = QRCode.create(href, { errorCorrectionLevel: 'M' }).modules;
  const scale = png.width / (modules.size + 8);
  for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) {
    const px = Math.floor((x + 4.5) * scale), py = Math.floor((y + 4.5) * scale);
    expect(png.data[(py * png.width + px) * 4] < 128).toBe(Boolean(modules.get(y, x)));
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (route.includes('folder')) expect(await page.locator('.pay-embedded-app').evaluate(element => getComputedStyle(element).gridColumn)).toBe('1 / -1');
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); document.querySelector('.pay-embedded-app')?.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath('invoice-light.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: testInfo.outputPath('invoice-dark.png'), fullPage: true, animations: 'disabled' });
});
test('exact proof review is invalidated by wallet changes and never signs silently', async ({ page }) => {
  await fixture(page, { wallet: true }); await page.goto(`/?pay=1&invoice=${id(1)}`); await connect(page);
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('dialog')).toContainText('1234567 proofs');
  await expect(page.getByRole('dialog')).toContainText(recipient);
  expect(await page.evaluate(() => window.paySignatureCalls)).toBe(0);
  await page.evaluate(() => window.payWalletEvent([])); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.paySignatureCalls)).toBe(0);
});
test('unsupported signing wallet and closed admission disable publication', async ({ page }) => {
  await fixture(page, { wallet: true, unsupported: true, closed: true }); await page.goto(`/?pay=1&invoice=${id(1)}`); await connect(page);
  await expect(page.getByText(/Pay v1 signing requires a mainnet P2PKH/)).toBeVisible();
  await expect(page.getByText('Pay publication is closed.', { exact: true })).toBeVisible();
  await expect(page.getByText(/self-payments cannot settle it/)).toBeVisible();
  expect(await page.evaluate(() => window.paySignatureCalls)).toBe(0);
});
test('unknown signed payment survives reentry and blocks a second review', async ({ page }) => {
  await fixture(page, { wallet: true, unknown: true }); await page.goto(`/?pay=1&invoice=${id(1)}`); await connect(page);
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await page.getByRole('button', { name: 'Review transaction', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /status unavailable|unresolved or pending/ }).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const receipts = await page.evaluate(() => JSON.parse(localStorage.getItem('proofofwork-action-receipts-v1')));
  expect(receipts[0].txid).toBe(id(7)); expect(receipts[0].status).toBe('unknown');
  expect(await page.evaluate(() => window.paySignatureCalls)).toBe(0);
});
test('local public invoice draft survives reload with exact text and amount', async ({ page }) => {
  await fixture(page); await page.goto('/?pay=1');
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  await page.getByRole('textbox', { name: /^Invoice title/ }).fill('Local unsent invoice');
  await page.getByRole('textbox', { name: 'Public description', exact: false }).fill('Exact private-browser draft');
  await page.getByRole('textbox', { name: 'Fixed receiving address', exact: false }).fill(recipient);
  await page.reload(); await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^Invoice title/ })).toHaveValue('Local unsent invoice');
  await expect(page.getByRole('textbox', { name: 'Fixed receiving address', exact: false })).toHaveValue(recipient);
  await expect(page.getByText(/Signing publishes a public, permanent record/)).toBeVisible();
});
