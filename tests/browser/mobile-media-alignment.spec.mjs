import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

const id = "rThDEqJsRtk";
const source = `Watch this: https://youtu.be/${id}?si=mRJf8Ygs-iVetqUb&t=30  \n`;
const txid = "a".repeat(64);
const address = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const post = (key, text, extras = {}) => ({ txid: key, boostTxid: key, text,
  kind: "boost-post", authorAddress: address, authorId: "creator", currentOwnerAddress: address,
  confirmed: true, createdAt: "2026-10-11T15:00:00Z", proofSignalQ8: "54600000000",
  totalSignalQ8: "54600000000", replyCount: 1, likeCount: 0, reboostCount: 0, ...extras });

async function fixture(page, { article = false, tampered = false, text = source, contexts = false } = {}) {
  const main = post(txid, article ? "Video article" : text, article ? {
    article: { v: 1, title: "Video article", source: "same-tx-pwm1-message",
      size: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") },
    articleVerification: "canonical-same-tx-pwm1-message-v1",
  } : {});
  const reply = post("b".repeat(64), text, { kind: "boost-reply", targetTxid: txid });
  const items = contexts ? [main, reply,
    post("c".repeat(64), "", { kind: "boost-reboost", reboostedPost: main, targetTxid: txid }),
    post("d".repeat(64), "Quoted video", { quoteTxid: txid, quotedPost: main })] : [main];
  const iframeReads = [];
  await page.route("https://i.ytimg.com/**", route => route.fulfill({ contentType: "image/svg+xml", body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#282828"/></svg>' }));
  await page.route("https://www.youtube-nocookie.com/**", route => {
    iframeReads.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>YouTube player fixture</title><p>Player loaded</p>" });
  });
  await page.route("**/api/v1/**", route => {
    if (route.request().method() !== "GET") throw new Error("Rendering video cards must remain read-only.");
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
    const common = { complete: true, snapshotId: "youtube-fixture", network: "livenet", hasMore: false, nextCursor: "", start: 0 };
    if (url.searchParams.has("detail")) return route.fulfill({ json: { ...common, mode: "detail",
      post: { ...main, ...(article ? { articleBody: tampered ? `${text}altered` : text } : {}) },
      items: article ? [] : [{ txid: reply.txid, eventId: "reply", address, confirmed: true,
        createdAt: reply.createdAt, kind: "boost-reply", post: reply }], totalCount: article ? 0 : 1 } });
    return route.fulfill({ json: { ...common, items, totalCount: items.length, indexedAt: main.createdAt } });
  });
  return { iframeReads };
}


async function containedCards(scope) {
  for (const card of await scope.locator('.youtube-link-card').all()) {
    const box = await card.boundingBox();
    const frame = await card.locator('.youtube-player-frame').boundingBox();
    expect(frame.x).toBeGreaterThanOrEqual(box.x);
    expect(frame.x + frame.width).toBeLessThanOrEqual(box.x + box.width + 1);
    const image = card.locator('img');
    if (await image.count()) await expect(image).toHaveCSS('object-fit', 'contain');
    const icon = card.locator('.youtube-play-icon');
    if (await icon.count()) {
      const r = await icon.boundingBox();
      expect(Math.abs(r.x + r.width / 2 - frame.x - frame.width / 2)).toBeLessThan(1);
    }
    const iframe = card.locator('iframe');
    if (await iframe.count()) {
      const r = await iframe.boundingBox();
      expect(r.width).toBeGreaterThanOrEqual(200);
      expect(r.height).toBeGreaterThanOrEqual(200);
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
  }
}
for (const width of [320,360,390,600,601,620,621]) {
  test(`media and metadata remain aligned at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await fixture(page,{contexts:true});
    await page.goto('/?boost=1');
    await expect(page.getByTestId('youtube-link-card')).toHaveCount(4);
    await containedCards(page);
    const author = page.locator('.boost-post > .boost-post-body > .boost-post-head .boost-author').first();
    expect((await author.boundingBox()).height).toBeGreaterThanOrEqual(44);
    if(width<=600){
      const row=author.locator('..');
      const meta=await row.locator(':scope > span').first().boundingBox();
      const r=await author.boundingBox();
      expect(meta.y).toBeGreaterThanOrEqual(r.y+r.height);
    }
    const main=page.getByTestId('boost-post').first();
    await main.getByRole('button',{name:'Play YouTube video'}).click();
    await expect(main.locator('iframe')).toBeVisible();
    await containedCards(page);
    const nested=page.getByTestId('reboosted-post').locator('.youtube-link-card');
    if((await nested.locator('.youtube-player-frame').boundingBox()).width<200){
      await expect(nested.getByRole('button')).toBeDisabled();
      await expect(nested.getByRole('link',{name:'Open on YouTube'})).toBeVisible();
      await expect(nested.locator('iframe')).toHaveCount(0);
    }
    await main.locator('.boost-post-text').click();
    const detail=page.getByRole('dialog',{name:'Boost detail',exact:true});
    await expect(detail).toBeVisible();await containedCards(detail);
    await page.keyboard.press('Escape');
    await author.click();
    await expect(page).toHaveURL(/profile=/);await containedCards(page);
  });
}
for(const embedded of [false,true]){
  test(`shared media in ${embedded?'Computer':'standalone'} Publish and Boost composer`,async({page})=>{
    await page.setViewportSize({width:320,height:900});
    await fixture(page,{article:true});
    await page.goto(`/?${embedded?'folder=publish':'publish=1'}&article=${txid}`);
    await expect(page.locator('.publish-reading .youtube-link-card')).toBeVisible();
    await containedCards(page);
    await page.getByRole('button',{name:'Play YouTube video'}).click();await containedCards(page);
    await page.goto(`/?${embedded?'folder=boost':'boost=1'}`);
    await page.getByRole('button',{name:'Create Boost',exact:true}).click();
    const composer=page.getByRole('dialog',{name:'What’s happening?'});
    await composer.locator('textarea').fill(source);
    await composer.getByText('Preview Boost',{exact:true}).click();
    await expect(composer.getByTestId('youtube-link-card')).toBeVisible();await containedCards(composer);
    await composer.getByRole('button',{name:'Play YouTube video'}).click();await containedCards(composer);
  });
}
async function centeredStatus(page){
 const row=page.locator('.app-status-row .status').or(page.locator('.app-status-row.status')).first();
 const r=await row.boundingBox(),t=await row.locator('.status-text').boundingBox(),d=await row.locator('.status-dot').boundingBox();
 expect(r.height).toBeGreaterThanOrEqual(44);
 expect(Math.abs(t.y+t.height/2-(r.y+(r.height-1)/2))).toBeLessThan(1);
 expect(Math.abs(d.y+d.height/2-(t.y+t.height/2))).toBeLessThan(1);
}
for(const width of [320,360,390,600,601,620,621]){
 test(`status success loading and errors align at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await fixture(page);await page.goto('/?boost=1');
  await expect(page.locator('.status-text').first()).toContainText('indexed');await centeredStatus(page);
  let release;const pending=new Promise(r=>release=r);
  await page.route('**/api/v1/boost?**',async route=>{await pending;await route.fulfill({json:{complete:false,items:[]}})});
  await page.getByRole('button',{name:'Refresh',exact:true}).last().click();
  await expect(page.locator('.status-text').first()).toContainText('Refreshing');await centeredStatus(page);release();
  await page.route('**/api/v1/boost?**',route=>route.fulfill({status:400,json:{error:'Offline'}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).last().click();
  await expect(page.locator('.status-text').first()).toHaveText('Offline');await centeredStatus(page);
  await page.unroute('**/api/v1/boost?**');
  await page.route('**/api/v1/boost?**',route=>route.fulfill({json:{complete:false,items:[]}}));
  await page.getByRole('button',{name:'Refresh',exact:true}).last().click();
  const status=page.locator('.status.bad').first();await expect(status).toBeVisible();
  await expect(status.locator('[role="alert"]')).toContainText('unavailable');
  await status.getByRole('button',{name:'Show full status'}).click();
  await expect(status.getByRole('button',{name:'Collapse status'})).toHaveAttribute('aria-expanded','true');
  if(width<=620){
   const t=await status.locator('.status-text').boundingBox(),d=await status.locator('.status-dot').boundingBox();
   const lh=await status.locator('.status-text').evaluate(e=>parseFloat(getComputedStyle(e).lineHeight));
   expect(Math.abs(d.y+d.height/2-t.y-lh/2)).toBeLessThan(1);
  }
 });
}

test('nested player switches to external fallback on resize without clipping',async({page})=>{
 await fixture(page,{contexts:true});await page.setViewportSize({width:390,height:900});await page.goto('/?boost=1');
 const card=page.getByTestId('reboosted-post').locator('.youtube-link-card');
 await card.getByRole('button',{name:'Play YouTube video'}).click();await expect(card.locator('iframe')).toBeVisible();
 await page.setViewportSize({width:320,height:900});
 await expect(card.locator('iframe')).toHaveCount(0);await expect(card.getByRole('button')).toBeDisabled();
 await expect(card.getByRole('link',{name:'Open on YouTube'})).toHaveAttribute('href',`https://www.youtube.com/watch?v=${id}&t=30s`);
 await containedCards(page);
 await page.setViewportSize({width:390,height:900});await containedCards(page);
});
