// Read-only rendered release check. No signing, broadcasting or state-changing API calls.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: process.env.POW_PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  for (const host of ['www', 'growth']) {
    const page = await browser.newPage();
    const response = await page.goto(`https://${host}.proofofwork.me/`, { waitUntil: 'domcontentloaded' });
    assert(response?.ok(), `${host} unavailable`);
    await page.locator('h1').first().waitFor({ state: 'visible' });
    assert((await page.locator('body').innerText()).trim().length > 100, `${host} empty`);
    await page.close();
  }
  for (const [host, query] of [['boost', ''], ['computer', '?folder=boost']]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await page.goto(`https://${host}.proofofwork.me/${query}`, { waitUntil: 'domcontentloaded' });
    const link = page.locator('.boost-post-permalink:visible').first();
    await link.waitFor({ state: 'visible', timeout: 60000 });
    await link.click();
    assert.match(new URL(page.url()).searchParams.get('detail') || '', /^[a-f0-9]{64}$/);
    const post = page.getByRole('region', { name: 'Boost post', exact: true });
    await post.waitFor({ state: 'visible' });
    await post.getByTestId('boost-post').first().waitFor({ state: 'visible', timeout: 60000 });
    assert.equal(await page.getByRole('dialog').count(), 0);
    const permalink = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await post.getByTestId('boost-post').first().waitFor({ state: 'visible', timeout: 60000 });
    await post.getByRole('button', { name: 'Back to Boost' }).click();
    await post.waitFor({ state: 'detached' });
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await post.waitFor({ state: 'visible' });
    assert.equal(page.url(), permalink);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log(JSON.stringify({ host, permalink, passed: true }));
    await page.close();
  }
} finally { await browser.close(); }
