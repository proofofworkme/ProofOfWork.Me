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
   return route.fulfill({json:{inboxMessages:[],sentMessages:[],records:[],listings:[]}});
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
