import { test, expect } from '@playwright/test';
import * as bitcoin from 'bitcoinjs-lib';

const address = '1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH';
const funding = new bitcoin.Transaction();
funding.addInput(Buffer.alloc(32, 1), 0);
funding.addOutput(bitcoin.address.toOutputScript(address), 2_000_000n);
const utxo = { txid: funding.getId(), vout: 0, value: 2_000_000, status: { confirmed: true } };

async function fixture(page, { theme = 'light', layout = 'focus', wallet = false, empty = false } = {}) {
  await page.emulateMedia({ colorScheme: theme === 'system' ? 'light' : theme, reducedMotion: 'reduce' });
  await page.addInitScript(({ theme, layout, wallet, address, utxo }) => {
    localStorage.setItem('proofofwork-me-appearance-v1', theme);
    localStorage.setItem('proofofwork-me-computer-layout-v1', layout);
    window.mobileSignatures = 0;
    if (wallet) window.unisat = { getAccounts: async () => [address], requestAccounts: async () => [address],
      getNetwork: async () => 'livenet', getBitcoinUtxos: async () => [utxo], on() {}, removeListener() {},
      signPsbt: async () => { window.mobileSignatures++; throw new Error('Fixture wallet rejected signing'); },
      signMessage: async () => { throw new Error('Fixture cannot sign messages'); } };
  }, { theme, layout, wallet, address, utxo });
  const writes = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      if (route.request().method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      if (url.pathname.endsWith('/utxo')) return route.fulfill({ json: [utxo] });
      if (url.pathname.endsWith('/hex')) return route.fulfill({ json: { hex: funding.toHex() } });
      if (url.pathname.endsWith('/status')) return route.fulfill({ json: { status: 'confirmed' } });
      if (url.pathname !== '/api/v1/boost') return route.fulfill({ json: { records: [], listings: [] } });
      const items = empty ? [] : Array.from({ length: 12 }, (_, i) => ({ txid: (i + 1).toString(16).padStart(64, '0'),
        eventId: `mobile-${i}`, authorAddress: address, authorId: 'reader', confirmed: true,
        kind: 'boost-post', text: `Feed item ${i + 1}. A readable proof-backed thought with enough room for its evidence.`,
        createdAt: '2026-10-12T12:00:00Z', proofSignalQ8: '54600000000', totalSignalQ8: '54600000000',
        likeCount: 0, reboostCount: 1, replyCount: 0 }));
      return route.fulfill({ json: { complete: true, network: 'livenet', items, totalCount: items.length,
        hasMore: false, start: 0, indexedAt: '2026-10-12T12:00:00Z',
        ...(url.searchParams.has('profile') ? { mode: 'profile', profileSubject: { address, id: 'reader', name: 'Reader',
          followerCount: 1, followingCount: 1 }, profileTabs: { boosts: items.length } } : {}) } });
    }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort();
    return route.continue();
  });
  return writes;
}
const composer = page => page.getByRole('dialog', { name: 'What’s happening?', exact: true });
const fab = page => page.getByRole('button', { name: 'Create Boost', exact: true });
async function expectDraft(form) {
  await expect(form.getByRole('textbox', { name: 'Boost text', exact: true })).toHaveValue('Keep this entire draft.');
  await expect(form.getByLabel('Proof signal', { exact: true })).toHaveValue('1234');
  await expect(form.getByLabel('WORK signal', { exact: true })).toHaveValue('0.1234567890123456');
  await expect(form.getByLabel('Fee proofs/vB', { exact: true })).toHaveValue('0.5');
  await expect(form.locator('.boost-post-attachment-selected')).toContainText('draft.txt');
}

for (const surface of ['standalone', 'focus', 'desktop']) for (const theme of ['light', 'dark']) {
  test(`mobile complete draft, Back, focus and scroll: ${surface} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const writes = await fixture(page, { theme, layout: surface });
    await page.goto(surface === 'standalone' ? '/?boost=1' : '/?folder=boost');
    await expect(page.locator('.boost-post')).toHaveCount(12);
    await expect(page.locator('.boost-composer-strip')).toBeHidden();
    await expect(page.locator('.boost-nav-compose')).toBeHidden();
    await expect(fab(page)).toBeVisible();
    const button = await fab(page).boundingBox(), nav = await page.locator('.boost-compact-nav').boundingBox();
    expect(button.width).toBe(56); expect(button.height).toBe(56);
    expect(nav.y - button.y - button.height).toBeGreaterThanOrEqual(15);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const tools = page.getByRole('dialog', { name: 'Boost tools' });
    await tools.getByLabel('Boost sort', { exact: true }).selectOption('newest');
    await page.keyboard.press('Escape');
    await expect(page.locator('.boost-filter-summary')).toContainText('Newest');
    await page.evaluate(() => window.scrollTo(0, 300));
    const before = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: info.outputPath('mobile-feed.png') });
    await fab(page).click();
    const form = composer(page);
    await expect(form).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Boost text', exact: true })).toBeFocused();
    await form.getByRole('textbox', { name: 'Boost text', exact: true }).fill('Keep this entire draft.');
    await form.getByLabel('Proof signal', { exact: true }).fill('1234');
    await form.getByLabel('WORK signal', { exact: true }).fill('0.1234567890123456');
    await form.getByRole('button', { name: '0.5 proofs/vB', exact: true }).click();
    await form.locator('input[type=file]').setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsent draft file') });
    await expectDraft(form);
    await form.getByRole('button', { name: 'Close Boost composer' }).click();
    await expect(form).toHaveCount(0);
    await expect(fab(page)).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    await fab(page).click(); await expectDraft(form);
    await page.goBack(); await expect(form).toHaveCount(0); await expect(fab(page)).toBeFocused();
    await fab(page).click(); await expectDraft(form);
    await page.keyboard.press('Escape'); await expect(form).toHaveCount(0);
    await fab(page).click(); await expectDraft(form);
    await form.getByRole('button', { name: 'Close Boost composer' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(form.getByRole('button', { name: 'Connect to post' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(form.getByRole('button', { name: 'Close Boost composer' })).toBeFocused();
    await page.screenshot({ path: info.outputPath('mobile-composer.png') });
    expect(writes).toEqual([]); expect(await page.evaluate(() => window.mobileSignatures)).toBe(0);
  });
}

for (const width of [320, 360, 600, 601, 960, 1440]) {
  test(`Boost breakpoint ${width}px and short viewport`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 480 }); await fixture(page);
    await page.goto('/?boost=1');
    if (width <= 600) { await expect(page.locator('.boost-composer-strip')).toBeHidden(); await fab(page).click(); }
    else { await expect(fab(page)).toBeHidden(); await page.getByRole('button', { name: 'Review Boost', exact: true }).click(); }
    const form = composer(page); await expect(form).toBeVisible();
    const box = await form.boundingBox();
    if (width <= 600) { expect(box.x).toBe(0); expect(box.y).toBe(0); expect(box.width).toBe(width); expect(box.height).toBe(480); }
    else { expect(box.width).toBeLessThanOrEqual(620); expect(box.y).toBeGreaterThan(0); }
    const connect = form.getByRole('button', { name: 'Connect to post' });
    await connect.scrollIntoViewIfNeeded(); await expect(connect).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath('short-composer.png') });
  });
}

test('draft survives responsive changes, System appearance and simulated visual keyboard viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page, { theme: 'system' }); await page.goto('/?boost=1');
  await fab(page).click(); const form = composer(page);
  await form.getByRole('textbox', { name: 'Boost text', exact: true }).fill('Resize this draft.');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 960, height: 480 });
  await expect(form.getByRole('textbox', { name: 'Boost text', exact: true })).toHaveValue('Resize this draft.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 360 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await form.boundingBox()).height).toBe(360);
  const connect = form.getByRole('button', { name: 'Connect to post' }); await connect.scrollIntoViewIfNeeded();
  const box = await connect.boundingBox(); expect(box.y + box.height).toBeLessThanOrEqual(360);
  await page.screenshot({ path: info.outputPath('simulated-keyboard.png') });
  await page.keyboard.press('Escape'); await fab(page).click();
  await expect(form.getByRole('textbox', { name: 'Boost text', exact: true })).toHaveValue('Resize this draft.');
});

for (const route of ['/?boost=1', '/?boost=1&profile=reader', '/?boost=1&mode=search']) {
  test(`empty mobile entry point ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 }); await fixture(page, { empty: true }); await page.goto(route);
    await expect(fab(page)).toBeVisible(); await fab(page).click(); await expect(composer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    if (route === '/?boost=1') { await page.getByRole('tab', { name: 'Following', exact: true }).click(); await fab(page).click(); await expect(composer(page)).toBeVisible(); }
  });
}

test('quote context and comment survive mobile dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page); await page.goto('/?boost=1');
  const post = page.locator('.boost-post').first();
  await post.getByRole('button', { name: 'Reboost, 1 reboosts', exact: true }).click();
  await post.getByRole('menuitem', { name: 'Quote', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add a comment', exact: true });
  await form.getByRole('textbox', { name: 'Boost text', exact: true }).fill('Keep this quote.');
  await page.keyboard.press('Escape');
  await expect(post.getByRole('button', { name: 'Reboost, 1 reboosts', exact: true })).toBeFocused();
  await post.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Boost detail', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await fab(page).click();
  await expect(form.getByRole('textbox', { name: 'Boost text', exact: true })).toHaveValue('Keep this quote.');
  await expect(form.locator('.boost-quoted-post')).toContainText('Feed item 1.');
  await form.getByRole('button', { name: 'Remove quote', exact: true }).click();
  await expect(composer(page).getByRole('textbox', { name: 'Boost text', exact: true })).toHaveValue('Keep this quote.');
  await expect(composer(page).locator('.boost-quoted-post')).toHaveCount(0);
});

test('wallet rejection retains draft and does not broadcast', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const writes = await fixture(page, { wallet: true });
  await page.goto('/?boost=1'); await page.getByRole('button', { name: 'Connect UniSat', exact: true }).click();
  await fab(page).click(); const form = composer(page);
  await form.getByRole('textbox', { name: 'Boost text', exact: true }).fill('Never broadcast this fixture.');
  await form.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('Fixture wallet rejected signing');
  expect(await page.evaluate(() => window.mobileSignatures)).toBe(1); expect(writes).toEqual([]);
  await page.keyboard.press('Escape'); await fab(page).click();
  await expect(form.getByRole('textbox', { name: 'Boost text', exact: true })).toHaveValue('Never broadcast this fixture.');
});
