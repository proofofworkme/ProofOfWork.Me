import { expect, test } from "@playwright/test";

test.setTimeout(120_000);
async function preview(page) {
  await page.route("**/api/v1/**", route => route.request().method() === "GET" ? route.fulfill({json: {
    complete:true,snapshotId:"fixture",items:[],records:[],listings:[],totalCount:0,hasMore:false,start:0,
    network:"livenet",indexedAt:"2026-11-12T00:00:00Z",
  }}) : route.abort());
  await page.goto("/?publish=1&write=1");
  await expect(page.getByLabel("Article title", {exact:true})).toBeVisible({timeout:60_000});
}
test("4 MB linked draft persists across reload without changing transaction limits", async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await preview(page);
  await page.getByLabel("Article title", {exact:true}).fill("Four megabyte draft");
  await page.getByLabel("Article text", {exact:true}).click();
  await page.evaluate(async()=>navigator.clipboard.writeText("x".repeat(4_000_000)));
  await page.keyboard.press("Control+V");
  await expect(page.getByRole("button", {name:"Upload article text in linked parts"})).toBeVisible();
  await page.getByRole("button", {name:"Save draft and back",exact:true}).click();
  await expect(page).not.toHaveURL(/write=1/);
  await expect(page.getByLabel("Article text", {exact:true})).toHaveCount(0);
  await page.goto("/?publish=1&write=1");
  await expect(page.getByLabel("Article title", {exact:true})).toHaveValue("Four megabyte draft", {timeout:60_000});
  expect((await page.getByLabel("Article text", {exact:true}).inputValue()).length).toBeLessThanOrEqual(16384);
  await expect(page.getByText(/The full article is retained/)).toBeVisible();
  const intact = () => page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("proofofwork-publish-drafts",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const raw=await new Promise(resolve=>{const t=db.transaction("drafts","readonly"),r=t.objectStore("drafts").get("proofofwork.publish.draft.v1:livenet:disconnected");t.oncomplete=()=>resolve(r.result);});db.close();
    return JSON.parse(raw).body==="x".repeat(4000000);
  });
  await expect.poll(intact).toBe(true);

  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1)).toBe(false);
  await page.getByLabel("Article text", {exact:true}).click();
  await page.keyboard.press("End");
  await page.evaluate(async()=>navigator.clipboard.writeText("y"));
  await page.keyboard.press("Control+V");
  await expect(page.getByRole("alert").filter({hasText:"4,000,000 UTF-8 bytes"})).toBeVisible();
  await expect.poll(intact).toBe(true);
  await expect(page.getByRole("button", {name:"Upload article text in linked parts"})).toBeVisible();
});
test("IndexedDB quota failure preserves unsaved text and blocks Back until saving succeeds", async ({page}) => {
  await preview(page);
  await page.getByLabel("Article title", {exact:true}).fill("Preserve my draft");
  await page.evaluate(() => { window.originalPublishPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function() { throw new DOMException("Fixture quota", "QuotaExceededError"); }; });
  await page.getByLabel("Article text", {exact:true}).fill("Unsaved exact text");
  await expect(page.getByRole("alert").filter({hasText:"autosave is unavailable"})).toBeVisible();
  await page.getByRole("button", {name:"Save draft and back",exact:true}).click();
  await expect(page.getByLabel("Article text", {exact:true})).toHaveValue("Unsaved exact text");
  expect(await page.evaluate(() => window.dispatchEvent(new Event("proofofwork:before-publish-writer-leave", {cancelable:true})))).toBe(false);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPublishPut; });
  await page.getByRole("button", {name:"Save draft and back",exact:true}).click();
  await expect(page).not.toHaveURL(/write=1/);
  await expect(page.getByLabel("Article text", {exact:true})).toHaveCount(0);
  await page.goto("/?publish=1&write=1");
  await expect(page.getByLabel("Article text", {exact:true})).toHaveValue("Unsaved exact text", {timeout:60_000});
});
