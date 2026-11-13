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
  await page.getByLabel("Article text", {exact:true}).fill("x".repeat(4_000_000));
  await expect(page.getByRole("button", {name:"Upload article text in linked parts"})).toBeVisible();
  await page.getByRole("button", {name:"Save draft and back",exact:true}).click();
  await expect(page).not.toHaveURL(/write=1/);
  await expect(page.getByLabel("Article text", {exact:true})).toHaveCount(0);
  await page.goto("/?publish=1&write=1");
  await expect(page.getByLabel("Article title", {exact:true})).toHaveValue("Four megabyte draft", {timeout:60_000});
  expect(await page.getByLabel("Article text", {exact:true}).inputValue()).toBe("x".repeat(4_000_000));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1)).toBe(false);
  await page.getByLabel("Article text", {exact:true}).fill("x".repeat(4_000_001));
  await expect(page.getByRole("alert").filter({hasText:"4,000,000 UTF-8 bytes"})).toBeVisible();
  await expect(page.getByRole("button", {name:"Upload article text in linked parts"})).toHaveCount(0);
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
