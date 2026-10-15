import { expect, test } from '@playwright/test';
const address = '1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH';
const txid = '8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b';
const html = '<html><body>Welcome fixture</body></html>\n';
for (const state of ['confirmed', 'pending', 'unavailable', 'wrong-txid']) {
 test(`empty address Desktop welcome: ${state}`, async ({page}, testInfo) => {
  let servedState = state;
  await page.route('**/api/v1/**', async route => {
   const path = new URL(route.request().url()).pathname;
   if (path === `/api/v1/tx/${txid}`) {
    if (servedState === 'unavailable') return route.fulfill({status:404,json:{error:'not found'}});
    const carrier = Buffer.from(`pwm1:m:${html}`);
    return route.fulfill({json:{tx:{txid:servedState === 'wrong-txid' ? 'a'.repeat(64) : txid,
     status:{confirmed:servedState !== 'pending',block_time:1778695081},
     vin:[{prevout:{scriptpubkey_address:address}}],
     vout:[{value:546,scriptpubkey_address:address},
      {value:0,scriptpubkey_type:'op_return',scriptpubkey_asm:`OP_RETURN ${carrier.toString('hex')}`,scriptpubkey:`6a${carrier.length.toString(16).padStart(2,'0')}${carrier.toString('hex')}`}],
    }}});
   }
   return route.fulfill({json:{address,network:'livenet',inboxMessages:[],sentMessages:[],records:[],listings:[]}});
  });
  await page.goto('/?desktop=1');
  await page.getByPlaceholder('address or user@proofofwork.me').fill(address);
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.locator('.desktop-toolbar')).toContainText('0 public files');
  if (state === 'confirmed') {
   await expect(page.locator('.file-tile')).toHaveCount(1);
   await expect(page.locator('.file-tile')).toContainText('Welcome to ProofOfWork.Me.html');
   await expect(page.locator('.file-tile')).toContainText('System reference');
   await expect(page.locator('.file-inspector')).toContainText('not a file belonging to this address');
   await expect(page.getByRole('link',{name:'Open in Browser'})).toHaveAttribute('href',new RegExp(txid));
   await page.screenshot({path:testInfo.outputPath('welcome.png'),fullPage:true});
  } else {
   await expect(page.locator('.file-tile')).toHaveCount(0);
   await expect(page.getByText(/Welcome system reference unavailable:/)).toBeVisible();
   if (state === 'unavailable') {
    servedState = 'confirmed';
    await page.locator('.desktop-toolbar').getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(page.locator('.file-tile')).toHaveCount(1);
    await expect(page.getByText(/Welcome system reference unavailable:/)).toHaveCount(0);
   }
  }
 });
}

test('Desktop toast counts owned publications after welcome and self-send deduplication', async ({ page }) => {
 const owner = '1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv';
 const attachment = { data: 'cHJvb2Y=', mime: 'text/plain', name: 'proof.txt', sha256: 'e'.repeat(64), size: 5 };
 const message = (publication, extra = {}) => ({ amountSats: 546, status: 'confirmed',
  confirmed: true, createdAt: '2026-09-30T12:00:00.000Z', from: owner, to: owner,
  memo: 'Owned publication', network: 'livenet', replyTo: owner, attachment,
  txid: publication, ...extra });
 const welcome = message(txid, { attachment: undefined, memo: html });
 const selfSend = message('b'.repeat(64));
 await page.route('**/api/v1/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (path === `/api/v1/address/${owner}/mail`) return route.fulfill({ json: {
   address: owner, network: 'livenet',
   inboxMessages: [welcome, selfSend, message('c'.repeat(64))],
   sentMessages: [welcome, selfSend],
  }});
  if (path === `/api/v1/tx/${txid}`) {
   const carrier = Buffer.from(`pwm1:m:${html}`);
   return route.fulfill({ json: { tx: { txid, status: { confirmed: true, block_time: 1778695081 },
    vin: [{ prevout: { scriptpubkey_address: owner } }],
    vout: [{ value: 546, scriptpubkey_address: owner }, { value: 0, scriptpubkey_type: 'op_return',
     scriptpubkey_asm: `OP_RETURN ${carrier.toString('hex')}` }],
   } }});
  }
  return route.fulfill({ json: { address: owner, network: 'livenet', inboxMessages: [], sentMessages: [], records: [], listings: [] } });
 });
 await page.goto('/?desktop=1');
 await page.getByPlaceholder('address or user@proofofwork.me').fill(owner);
 await page.getByRole('button', { name: 'Open', exact: true }).click();
 await expect(page.locator('.desktop-toolbar')).toContainText('2 public files');
 await expect(page.locator('.status-text')).toContainText('desktop loaded. 2 public files.');
 await expect(page.locator('.file-tile')).toHaveCount(3);
 await expect(page.locator('.file-tile').filter({ hasText: 'System reference' })).toHaveCount(1);
 await expect(page.locator('.file-inspector')).toContainText('Inbox · Sent');
});

for (const embedded of [false, true]) {
 for (const viewport of [{ width: 320, height: 480 }, { width: 1024, height: 768 }]) {
  test(`long confirmed ID stays readable beside Desktop search: ${embedded ? 'Computer' : 'standalone'} ${viewport.width}px`, async ({ page }) => {
   const id = 'longconfirmedidentityabcdefghijklmnopqrstuvwxyz0123456789abcdef';
   const recipient = `${id}@proofofwork.me`;
   const record = { id, ownerAddress: address, receiveAddress: address, network: 'livenet',
    confirmed: true, txid: 'd'.repeat(64), amountSats: 1000, createdAt: '2026-10-15T10:00:00Z' };
   await page.setViewportSize(viewport);
   await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/test-api(?=\/api\/)/u, '');
    if (request.method() !== 'GET') return route.abort('blockedbyclient');
    if (path === `/api/v1/tx/${txid}`) return route.fulfill({ status: 404, json: { error: 'Fixture has no verified welcome reference' } });
    if (path === `/api/v1/ids/${id}`) return route.fulfill({ json: {
     network: 'livenet', record, records: [record], listings: [], sales: [], activity: [], pendingEvents: [],
    } });
    return route.fulfill({ json: { address, network: 'livenet', inboxMessages: [], sentMessages: [], records: [], listings: [] } });
   });
   await page.goto(embedded ? '/?folder=desktop' : '/?desktop=1');
   await page.getByPlaceholder('address or user@proofofwork.me').fill(recipient);
   await page.getByRole('button', { name: 'Open', exact: true }).click();
   const toolbar = page.locator('.desktop-toolbar');
   await expect(toolbar.getByRole('heading')).toHaveText(`${recipient} Desktop`);
   await expect(page.locator('.desktop-empty p')).toHaveText(`${recipient} has no confirmed ProofOfWork.Me files on this network.`);
   const search = toolbar.getByRole('textbox');
   await search.focus();
   await expect(search).toBeFocused();
   await expect(search).toHaveValue(recipient);
   const geometry = await page.locator('.desktop-workspace-loaded').evaluate(workspace => {
    const selectors = ['.desktop-toolbar', '.desktop-toolbar h2', '.desktop-toolbar > .desktop-search', '.desktop-empty', '.desktop-empty p'];
    const nodes = selectors.map(selector => workspace.querySelector(selector));
    const bounds = nodes.map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }; });
    return { viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth, bounds };
   });
   expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
   for (const rect of geometry.bounds) {
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.right).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(rect.scrollWidth).toBeLessThanOrEqual(rect.clientWidth + 1);
   }
   const heading = geometry.bounds[1], field = geometry.bounds[2];
   expect(heading.right <= field.left + 1 || field.right <= heading.left + 1 || heading.bottom <= field.top + 1 || field.bottom <= heading.top + 1).toBe(true);
  });
 }
}
