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

for (const { embedded, width } of [{ embedded: false, width: 320 }, { embedded: true, width: 390 }, { embedded: false, width: 1280 }]) {
  test(`${embedded ? "Computer" : "Boost"} at ${width}px plays shared links without changing text or opening the post`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { iframeReads } = await fixture(page, { contexts: true });
    await page.goto(`/?${embedded ? "folder=boost" : "boost=1"}`);
    await expect(page.getByTestId("youtube-link-card")).toHaveCount(4);
    const main = page.getByTestId("boost-post").first();
    expect(await main.locator(".boost-post-text").textContent()).toBe(source);
    expect(iframeReads).toHaveLength(0);
    const initialUrl = page.url();
    await main.getByRole("button", { name: "Play YouTube video" }).click();
    await expect(main.locator("iframe")).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&start=30`);
    await expect(main.locator("iframe")).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    await expect(page.getByRole("dialog", { name: "Boost detail", exact: true })).toHaveCount(0);
    expect(page.url()).toBe(initialUrl);
    expect(await main.locator(".boost-post-text").textContent()).toBe(source);
    await expect(main.getByRole("link", { name: "Open on YouTube" })).toHaveAttribute("href", `https://www.youtube.com/watch?v=${id}&t=30s`);
    const geometry = await main.locator("iframe").boundingBox();
    expect(geometry.width).toBeGreaterThanOrEqual(200);
    expect(geometry.height).toBeGreaterThanOrEqual(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const reboost = page.getByTestId("reboosted-post");
    if ((await reboost.locator(".youtube-player-frame").boundingBox()).width >= 200) {
      await reboost.getByRole("button", { name: "Play YouTube video" }).click();
      await expect(reboost.locator("iframe")).toBeVisible();
      expect((await reboost.locator("iframe").boundingBox()).width).toBeGreaterThanOrEqual(200);
    } else {
      await expect(reboost.locator("iframe")).toHaveCount(0);
      await expect(reboost.getByRole("link", { name: "Open on YouTube" })).toBeVisible();
    }
    await main.locator(".boost-post-text").click();
    await expect(page.getByRole("dialog", { name: "Boost detail", exact: true }).locator(".boost-thread-reply .youtube-link-card")).toHaveCount(1);
  });
}

for (const embedded of [false, true]) {
  test(`${embedded ? "Computer Publish" : "Publish"} adds playback only after exact article verification`, async ({ page }) => {
    await fixture(page, { article: true });
    await page.goto(`/?${embedded ? "folder=publish" : "publish=1"}&article=${txid}`);
    const body = page.locator(".publish-article-body");
    await expect(body).toBeVisible();
    expect(await body.textContent()).toBe(source);
    await expect(body.locator("iframe, button, .youtube-link-card")).toHaveCount(0);
    await expect(page.locator(".publish-reading .youtube-link-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Play YouTube video" }).click();
    await expect(page.locator(".publish-reading iframe")).toHaveCount(1);
    expect(createHash("sha256").update(await body.textContent()).digest("hex")).toBe(createHash("sha256").update(source).digest("hex"));
  });
}

test("Publish never loads video cards for a mismatched committed article", async ({ page }) => {
  const { iframeReads } = await fixture(page, { article: true, tampered: true });
  await page.goto(`/?publish=1&article=${txid}`);
  await expect(page.getByRole("heading", { name: "Article text unavailable" })).toBeVisible();
  await expect(page.getByTestId("youtube-link-card")).toHaveCount(0);
  expect(iframeReads).toHaveLength(0);
});

test("malformed hosts and code samples remain literal text", async ({ page }) => {
  const text = `https://youtube.com.evil.example/watch?v=${id}\nhttps://evil.example/?u=https://youtu.be/${id}\n\`https://youtu.be/${id}\``;
  await fixture(page, { text });
  await page.goto("/?boost=1");
  await expect(page.getByTestId("boost-post")).toHaveCount(1);
  expect(await page.locator(".boost-post-text").textContent()).toBe(text);
  await expect(page.getByTestId("youtube-link-card")).toHaveCount(0);
});

test("Publish draft preview displays playable links without modifying the draft", async ({ page }) => {
  await fixture(page);
  await page.goto("/?publish=1&write=1");
  await page.getByRole("textbox", { name: "Article title", exact: true }).fill("Draft video");
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(source);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".publish-preview .youtube-link-card")).toHaveCount(1);
  expect(await page.locator(".publish-preview .publish-article-body").textContent()).toBe(source);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(source);
});

test("Boost composer previews links without changing the posted text", async ({ page }) => {
  await fixture(page);
  await page.goto("/?folder=boost");
  await page.getByRole("button", { name: "Post a Boost", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "What’s happening?" });
  await composer.locator("textarea").fill(source);
  await composer.getByText("Preview Boost", { exact: true }).click();
  await expect(composer.getByTestId("youtube-link-card")).toBeVisible();
  await composer.getByRole("button", { name: "Play YouTube video" }).click();
  await expect(composer.locator("iframe")).toHaveCount(1);
  await expect(composer.locator("textarea")).toHaveValue(source);
  await composer.getByRole("link", { name: "Open on YouTube" }).focus();
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);
});
