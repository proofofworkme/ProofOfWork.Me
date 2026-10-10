import { expect, test } from "@playwright/test";

const AUTHOR = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const OWNER = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const LEGACY = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const P2SH = "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy";
const SEGWIT = "bc1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpyfl4f3";
const TAPROOT = "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed";
const ORIGINAL_TXID = "a".repeat(64);
const REPLY_TXID = "b".repeat(64);
const REBOOST_TXID = "c".repeat(64);
const QUOTE_TXID = "d".repeat(64);
const QUOTED_TXID = "e".repeat(64);
const signal = {
  totalSignalQ8: "54600000000", totalSignalSatsExact: "546",
  proofSignalQ8: "54600000000", proofSignalSatsExact: "546",
  totalSignalUsd: 0, workSignalSubatoms: "0",
};
const post = (txid, text, overrides = {}) => ({
  txid, boostTxid: txid, authorAddress: AUTHOR, authorId: "carbonz",
  currentOwnerAddress: AUTHOR, confirmed: true, kind: "boost-post",
  createdAt: "2026-10-01T14:00:00Z", proofSignalSats: 546,
  replyCount: 1, likeCount: 0, reboostCount: 0, ...signal, text, ...overrides,
});
const original = post(ORIGINAL_TXID,
  "Original $MiXeD99 #Mixed_tag @ArmyOfYouth armyofyouth@proofofwork.me armyofyouth.pow");
const reply = post(REPLY_TXID, "Reply $OTHER #Reply_tag @armyofyouth app.armyofyouth.pow", {
  kind: "boost-reply", targetTxid: ORIGINAL_TXID,
  actionSignalSats: 546, actionSignalQ8: signal.totalSignalQ8,
});
const quoted = post(QUOTED_TXID, "Quoted $QUOTED #Quote_tag @armyofyouth armyofyouth.pow");
const contextItems = [original, reply,
  post(REBOOST_TXID, "", { kind: "boost-reboost", targetTxid: ORIGINAL_TXID,
    boostTxid: ORIGINAL_TXID, reboostedPost: original,
    actionSignalSats: 546, actionSignalQ8: signal.totalSignalQ8 }),
  post(QUOTE_TXID, "Quote comment $COMMENT #Comment_tag @armyofyouth armyofyouth.pow", {
    quoteTxid: QUOTED_TXID, quotedPost: quoted,
  })];

function subject(query) {
  const isAddress = [AUTHOR, OWNER, LEGACY, P2SH, SEGWIT, TAPROOT, SEGWIT.toUpperCase()].includes(query);
  const address = isAddress ? query.toLowerCase().startsWith("bc1") ? query.toLowerCase() : query : OWNER;
  const id = query.replace(/@proofofwork\.me$/u, "");
  return {
    resolved: true, query, address,
    ...(isAddress ? {} : { id, displayName: `${id}@proofofwork.me` }),
    profile: { address, name: isAddress ? "Address author" : "Confirmed creator" },
    followerCount: 12, followingCount: 3, boostCount: 1, ...signal,
  };
}

async function fixture(page, { items = contextItems, previewState = "resolved", delayPreview = 0, network = "livenet" } = {}) {
  const queries = [];
  const previews = [];
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") throw new Error("Boost text navigation must remain read-only.");
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/boost") {
      return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
    }
    const query = Object.fromEntries(url.searchParams);
    queries.push(query);
    const common = {
      complete: true, snapshotId: "boost-text-fixture", network,
      indexedAt: "2026-10-01T14:00:00Z", hasMore: false, nextCursor: "", start: 0,
      signalStats: signal, stats: { total: items.length, confirmed: items.length, pending: 0 },
    };
    if (query.profile && query.limit === "1") {
      previews.push(query);
      if (delayPreview) await new Promise((resolve) => setTimeout(resolve, delayPreview));
      if (previewState === "unavailable") return route.fulfill({ status: 503, json: { error: "Registry checkpoint unavailable." } });
      const profileSubject = ["pending", "unregistered"].includes(previewState)
        ? { query: query.profile, resolved: false, address: "", pending: previewState === "pending" }
        : subject(query.profile);
      if (previewState === "invalid-address") profileSubject.address = "address-without-a-valid-checksum";
      return route.fulfill({ json: {
        ...common, complete: previewState !== "incomplete", mode: "profile", profileSubject,
        items: [], totalCount: 0, end: 0,
      } });
    }
    if (query.detail) {
      const detailPost = items.find((item) => item.txid === query.detail) || original;
      return route.fulfill({ json: {
        ...common, mode: "detail", post: detailPost, totalCount: 1, end: 1,
        items: [{ txid: REPLY_TXID, eventId: "thread-reply", address: AUTHOR,
          confirmed: true, createdAt: reply.createdAt, kind: "boost-reply", post: reply }],
      } });
    }
    return route.fulfill({ json: {
      ...common, items, totalCount: items.length, end: items.length,
      ...(query.profile ? { mode: "profile", profileSubject: subject(query.profile),
        profileTabs: { boosts: 1, replies: 0, purchased: 0, likes: 0, "replies-to": 0 } } : {}),
    } });
  });
  return { queries, previews };
}

function assertRoute(href, embedded, expected) {
  const url = new URL(href, "https://boost.proofofwork.me");
  expect(url.searchParams.get(embedded ? "folder" : "boost")).toBe(embedded ? "boost" : "1");
  expect(url.searchParams.has(embedded ? "boost" : "folder")).toBe(false);
  for (const [key, value] of Object.entries(expected)) {
    if (key === "q" || /^bc1/i.test(value)) expect(url.searchParams.get(key)?.toLowerCase()).toBe(value.toLowerCase());
    else expect(url.searchParams.get(key)).toBe(value);
  }
  return url;
}

function assertBrowserRoute(href, sourceUrl, name, network) {
  const source = new URL(sourceUrl), url = new URL(href, source);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(source.hostname) || source.hostname.endsWith(".localhost");
  expect(url.origin).toBe(local ? source.origin : "https://browser.proofofwork.me");
  expect(url.pathname).toBe("/");
  expect(url.searchParams.get("name")).toBe(name);
  expect(url.searchParams.get("network")).toBe(network);
  expect(url.searchParams.get("browser")).toBe(local ? "1" : null);
  expect(url.searchParams.has("folder")).toBe(false);
  return url;
}

for (const embedded of [false, true]) {
  const route = embedded ? "/?folder=boost" : "/?boost=1";
  const surface = embedded ? "Computer" : "standalone Boost";
  test(`${surface} linkifies normal posts, replies, reboosts, quotes, and thread replies`, async ({ page }) => {
    const { queries, previews } = await fixture(page);
    await page.goto(route);
    await expect(page.getByTestId("boost-post")).toHaveCount(4);
    const contexts = [page.getByTestId("boost-post").nth(0), page.getByTestId("boost-post").nth(1),
      page.getByTestId("reboosted-post"), page.getByTestId("quoted-post")];
    for (const context of contexts) {
      await expect(context.locator(".boost-text-link")).not.toHaveCount(0);
      const mention = context.locator(".boost-text-link").filter({ hasText: /^@armyofyouth$/i }).first();
      assertRoute(await mention.getAttribute("href"), embedded, { profile: "armyofyouth@proofofwork.me" });
      await expect(context.locator(".boost-dns-link")).toHaveCount(1);
    }
    const cash = contexts[0].getByRole("link", { name: "$MiXeD99", exact: true });
    const hash = contexts[0].getByRole("link", { name: "#Mixed_tag", exact: true });
    assertRoute(await cash.getAttribute("href"), embedded, { q: "$MiXeD99" });
    assertRoute(await hash.getAttribute("href"), embedded, { q: "#Mixed_tag" });
    expect(await cash.getAttribute("href")).toMatch(/q=%24/);
    expect(await hash.getAttribute("href")).toMatch(/q=%23/);
    assertRoute(await contexts[0].getByRole("link", { name: "armyofyouth@proofofwork.me", exact: true }).getAttribute("href"), embedded, { profile: "armyofyouth@proofofwork.me" });
    expect(previews).toHaveLength(0);

    await contexts[0].press("Enter");
    const detail = page.getByRole("dialog", { name: "Boost detail", exact: true });
    await expect(detail.locator(".boost-thread-reply").getByRole("link", { name: "#Reply_tag", exact: true })).toBeVisible();
    await expect(detail.locator(".boost-thread-reply .boost-dns-link")).toHaveText("app.armyofyouth.pow");
    expect(queries.some((query) => query.detail === ORIGINAL_TXID)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await cash.click();
    await expect(page.getByRole("textbox", { name: "Search Boost", exact: true })).toHaveValue(/\$mixed99/i);
    assertRoute(page.url(), embedded, { q: "$MiXeD99" });
    await expect.poll(() => queries.at(-1)?.q?.toLowerCase()).toBe("$mixed99");
    await expect(page.getByRole("dialog", { name: "Boost detail", exact: true })).toHaveCount(0);
    if (embedded) await expect(page.locator(".boost-embedded-app")).toBeVisible();
  });

  test(`${surface} initializes keywords, tags, and legacy search links in the dedicated view`, async ({ page }) => {
    const { queries } = await fixture(page, { items: [post(ORIGINAL_TXID, "$generic_7 #網絡_2026")] });
    for (const [parameter, q] of [["q", "$generic_7"], ["q", "#網絡_2026"], ["search", "keyword phrase"], ["q", ""], ["search", ""]]) {
      await page.goto(`${route}&${parameter}=${encodeURIComponent(q)}`);
      const input = page.getByRole("textbox", { name: "Search Boost", exact: true });
      await expect(input).toHaveValue(q);
      await expect(page.locator(".boost-feed-panel > .boost-search-head")).toBeVisible();
      await expect(page.locator(".boost-composer-strip")).toHaveCount(0);
      await expect(page.locator(".boost-sidebar .boost-search")).toHaveCount(0);
      const results = page.getByRole("region", { name: "Boost search results", exact: true });
      if (q) {
        await expect.poll(() => queries.at(-1)?.q).toBe(q);
        expect(queries.at(-1)?.view).toBe("all");
        if (/^[#$]/u.test(q)) await expect(results.getByRole("link", { name: q, exact: true })).toBeVisible();
      } else {
        await expect(results.getByRole("heading", { name: "Search Boost", exact: true })).toBeVisible();
        await expect(page.getByTestId("boost-post")).toHaveCount(0);
      }
      if (parameter === "search" && q) {
        await input.fill("$generic_7");
        await input.press("Enter");
        await expect.poll(() => queries.at(-1)?.q).toBe("$generic_7");
        assertRoute(page.url(), embedded, { mode: "search", q: "$generic_7" });
        expect(new URL(page.url()).searchParams.has("search")).toBe(false);
      }
    }
  });

  for (const width of [1920, 390]) {
    test(`${surface} centers search above results without a composer at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
      const { queries } = await fixture(page, { items: [post(ORIGINAL_TXID, "$generic_7 #網絡_2026")] });
      await page.goto(`${route}&q=${encodeURIComponent("$generic_7")}`);
      const input = page.getByRole("textbox", { name: "Search Boost", exact: true });
      const control = page.locator(".boost-route-search");
      await expect(input).toHaveValue("$generic_7");
      await expect(input).toHaveAttribute("placeholder", "Search Boost");
      await expect(control).toHaveCount(1);
      await expect(page.locator(".boost-feed-panel > .boost-search-head:first-child")).toBeVisible();
      await expect(page.locator(".boost-search-head").getByRole("search", { name: "Search Boost", exact: true })).toBeVisible();
      await expect(page.locator(".boost-sidebar .boost-search")).toHaveCount(0);
      await expect(page.locator(".boost-composer-strip")).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Boost text", exact: true })).toHaveCount(0);
      await expect(page.getByRole("tablist", { name: "Boost timeline", exact: true })).toHaveCount(0);
      const results = page.getByRole("region", { name: "Boost search results", exact: true });
      await expect(results).toHaveAttribute("id", "boost-search-results");
      await expect(page.getByTestId("boost-post")).toBeVisible();
      await expect.poll(() => queries.at(-1)?.q).toBe("$generic_7");
      expect(queries.at(-1)?.view).toBe("all");

      const geometry = await control.evaluate((element) => {
        const box = (node) => {
          const { x, y, width, height, right, bottom } = node.getBoundingClientRect();
          return { x, y, width, height, right, bottom, centerY: y + height / 2 };
        };
        const style = getComputedStyle(element);
        return {
          control: box(element), icon: box(element.querySelector(":scope > svg")),
          input: box(element.querySelector("input")),
          insetRight: parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth),
          gap: parseFloat(style.columnGap),
          overflow: element.scrollWidth - element.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          panel: box(element.closest(".boost-feed-panel")),
          toolbar: box(element.closest(".boost-feed-panel").querySelector(".boost-feed-toolbar")),
          results: box(element.closest(".boost-feed-panel").querySelector("#boost-search-results")),
        };
      });
      expect(geometry.control.height).toBeGreaterThanOrEqual(43);
      expect(geometry.control.height).toBeLessThanOrEqual(46);
      expect(Math.abs(geometry.icon.centerY - geometry.input.centerY)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.control.centerY - geometry.input.centerY)).toBeLessThanOrEqual(1);
      expect(geometry.input.y).toBeGreaterThanOrEqual(geometry.control.y);
      expect(geometry.input.bottom).toBeLessThanOrEqual(geometry.control.bottom);
      const expectedRight = geometry.control.right - geometry.insetRight;
      expect(geometry.input.x).toBeGreaterThanOrEqual(geometry.icon.right + geometry.gap - 1);
      expect(geometry.input.width).toBeGreaterThanOrEqual(expectedRight - geometry.icon.right - geometry.gap - 1);
      expect(Math.abs(geometry.input.right - expectedRight)).toBeLessThanOrEqual(1);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.control.x).toBeGreaterThanOrEqual(0);
      expect(geometry.control.right).toBeLessThanOrEqual(width + 1);
      expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1);
      expect(geometry.control.x).toBeGreaterThanOrEqual(geometry.panel.x);
      expect(geometry.control.right).toBeLessThanOrEqual(geometry.panel.right);
      expect(geometry.control.bottom).toBeLessThanOrEqual(geometry.toolbar.y);
      expect(geometry.control.bottom).toBeLessThanOrEqual(geometry.results.y);

      await input.fill("#網絡_2026");
      await expect(input).toHaveValue("#網絡_2026");
      await expect.poll(() => queries.at(-1)?.q).toBe("#網絡_2026");
      assertRoute(page.url(), embedded, { mode: "search", q: "#網絡_2026" });
      await expect(input).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("central-search.png") });
    });

    test(`${surface} opens empty search, refines and clears queries, and returns to the timeline at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
      const { queries } = await fixture(page, { items: [], network: "testnet4" });
      await page.goto(`${route}&network=testnet4`);
      await expect(page.locator(".boost-composer-strip")).toBeVisible();
      await expect(page.locator(".boost-sidebar .boost-search")).toHaveCount(0);
      await expect.poll(() => queries.length).toBeGreaterThan(0);
      const beforeSearch = queries.length;
      const navigation = page.locator(width === 390 ? ".boost-compact-nav" : ".boost-sidebar");
      const entry = navigation.getByRole("link", { name: "Search Boost", exact: true });
      assertRoute(await entry.getAttribute("href"), embedded, { mode: "search", network: "testnet4" });
      await entry.click();
      const input = page.getByRole("textbox", { name: "Search Boost", exact: true });
      const results = page.getByRole("region", { name: "Boost search results", exact: true });
      await expect(input).toHaveValue("");
      await expect(input).toBeFocused();
      await expect(page.locator(".boost-composer-strip")).toHaveCount(0);
      await expect(results).toContainText("keyword, hashtag, or cashtag");
      await page.waitForTimeout(350); // Allow the normal debounce to reveal an accidental unfiltered read.
      expect(queries.slice(beforeSearch)).toEqual([]);

      await input.fill("keyword phrase");
      await input.press("Enter");
      await expect.poll(() => queries.at(-1)?.q).toBe("keyword phrase");
      expect(queries.at(-1)).toMatchObject({ view: "all", network: "testnet4" });
      assertRoute(page.url(), embedded, { mode: "search", q: "keyword phrase", network: "testnet4" });
      await input.fill("$generic_7");
      await expect.poll(() => queries.at(-1)?.q).toBe("$generic_7");
      await input.fill("#網絡_2026");
      await expect.poll(() => queries.at(-1)?.q).toBe("#網絡_2026");
      const beforeClear = queries.length;
      await input.fill("cancel pending query");
      await input.fill("");
      await expect(results.getByRole("heading", { name: "Search Boost", exact: true })).toBeVisible();
      await expect(page.locator(".boost-composer-strip")).toHaveCount(0);
      await page.waitForTimeout(350);
      expect(queries.slice(beforeClear)).toEqual([]);
      assertRoute(page.url(), embedded, { mode: "search", q: "", network: "testnet4" });
      const back = page.locator(".boost-search-head").getByRole("link", { name: "Back to timeline", exact: true });
      const backUrl = assertRoute(await back.getAttribute("href"), embedded, { network: "testnet4" });
      for (const parameter of ["mode", "q", "search"]) expect(backUrl.searchParams.has(parameter)).toBe(false);
      await back.click();
      await expect(page.locator(".boost-composer-strip")).toBeVisible();
      await expect(page.locator(".boost-search-head")).toHaveCount(0);
      await expect(page.getByRole("tablist", { name: "Boost timeline", exact: true })).toBeVisible();
      if (width === 390) {
        await page.locator(".boost-compact-nav").getByRole("link", { name: "Search Boost", exact: true }).click();
        const home = page.locator(".boost-compact-nav").getByRole("link", { name: "Home", exact: true });
        assertRoute(await home.getAttribute("href"), embedded, { network: "testnet4" });
        await home.click();
        await expect(page.locator(".boost-composer-strip")).toBeVisible();
      }
    });
  }
}

for (const embedded of [false, true]) {
  for (const network of ["livenet", "testnet4"]) {
    test(`${embedded ? "Computer" : "standalone Boost"} opens bare .pow names in a separate Browser on ${network}`, async ({ page }) => {
      const { previews, queries } = await fixture(page, { network, items: [post(ORIGINAL_TXID,
        "Visit (armyofyouth.pow), App.ArmyOfYouth.POW!  \n")] });
      const dnsReads = [];
      page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/v1/dns/")) dnsReads.push(request.url()); });
      // This test verifies the link boundary only. The existing Browser DNS
      // suite separately verifies canonical resolution and sandbox rendering.
      await page.context().route("**/*", route => {
        const url = new URL(route.request().url());
        return route.request().isNavigationRequest() && (url.hostname === "browser.proofofwork.me" || url.searchParams.get("browser") === "1")
          ? route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Browser link fixture</title>" })
          : route.fallback();
      });
      await page.goto(`/?${embedded ? "folder=boost" : "boost=1"}&network=${network}`);
      const sourceUrl = page.url(), body = page.getByTestId("boost-post").locator(".boost-post-text");
      await expect(body).toHaveText("Visit (armyofyouth.pow), App.ArmyOfYouth.POW!  \n");
      const root = body.getByRole("link", { name: "armyofyouth.pow (open in Browser, new tab)", exact: true });
      const child = body.getByRole("link", { name: "App.ArmyOfYouth.POW (open in Browser, new tab)", exact: true });
      for (const [link, name] of [[root, "armyofyouth.pow"], [child, "app.armyofyouth.pow"]]) {
        assertBrowserRoute(await link.getAttribute("href"), sourceUrl, name, network);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
      await root.focus();
      await expect(root).toBeFocused();
      await root.hover();
      await page.waitForTimeout(400); // Longer than the existing mention-preview delay.
      expect(previews).toHaveLength(0);
      expect(dnsReads).toHaveLength(0);
      await expect(page.getByTestId("boost-mention-preview")).toHaveCount(0);
      const popupReady = page.waitForEvent("popup");
      await root.press("Enter");
      const popup = await popupReady;
      // The popup event can arrive while its initial empty document is ready.
      // Wait for the exact link navigation rather than that initial load state.
      await popup.waitForURL(new URL(await root.getAttribute("href"), sourceUrl).href, { waitUntil: "domcontentloaded" });
      assertBrowserRoute(popup.url(), sourceUrl, "armyofyouth.pow", network);
      expect(page.url()).toBe(sourceUrl);
      expect(queries.some(query => query.detail)).toBe(false);
      await expect(page.getByRole("dialog", { name: "Boost detail", exact: true })).toHaveCount(0);
      await popup.close();
      const childPopupReady = page.waitForEvent("popup");
      await child.click();
      const childPopup = await childPopupReady;
      await childPopup.waitForURL(new URL(await child.getAttribute("href"), sourceUrl).href, { waitUntil: "domcontentloaded" });
      assertBrowserRoute(childPopup.url(), sourceUrl, "app.armyofyouth.pow", network);
      expect(page.url()).toBe(sourceUrl);
      expect(queries.some(query => query.detail)).toBe(false);
      await childPopup.close();
    });
  }
}

test("DNS projection preserves punctuation and excludes URLs, emails, code and invalid partial names", async ({ page }) => {
  const text = "armyofyouth.pow! app.armyofyouth.pow, www.armyofyouth.pow; https://www.armyofyouth.pow/path person@armyofyouth.pow armyofyouth.pow/path `inline.pow`\n```\nfenced.pow\n```\ndeep.app.armyofyouth.pow -invalid.pow invalid_.pow <img src=x>";
  await fixture(page, { items: [post(ORIGINAL_TXID, text)] });
  await page.goto("/?boost=1");
  const body = page.getByTestId("boost-post").locator(".boost-post-text");
  expect(await body.textContent()).toBe(text);
  await expect(body.locator(".boost-dns-link")).toHaveText(["armyofyouth.pow", "app.armyofyouth.pow", "www.armyofyouth.pow"]);
  await expect(body.locator("img")).toHaveCount(0);
});

test("ID mentions share a confirmed owner preview, stay keyboard-accessible, and open without a Boost detail", async ({ page }, testInfo) => {
  const { previews, queries } = await fixture(page, { items: [original], delayPreview: 400 });
  await page.goto("/?boost=1");
  const mention = page.getByRole("link", { name: "@ArmyOfYouth", exact: true });
  const email = page.getByTestId("boost-post").getByRole("link", { name: "armyofyouth@proofofwork.me", exact: true });
  await expect(mention).toHaveAttribute("aria-haspopup", "dialog");
  await mention.focus();
  let preview = page.getByTestId("boost-mention-preview");
  await expect(preview).toContainText("Loading confirmed profile");
  await email.focus();
  await expect(preview).toContainText("Confirmed creator");
  await expect(preview).toContainText("3 Following");
  await expect(preview).toContainText("12 Followers");
  const open = preview.getByRole("link", { name: "Open profile", exact: true });
  assertRoute(await open.getAttribute("href"), false, { profile: OWNER });
  expect(previews).toHaveLength(1);
  expect(previews[0]).toMatchObject({ profile: "armyofyouth@proofofwork.me", limit: "1" });
  expect(previews[0]).not.toHaveProperty("q");
  expect(previews[0]).not.toHaveProperty("detail");
  expect(previews[0]).not.toHaveProperty("window");
  await expect(email).toHaveAttribute("aria-expanded", "true");
  await email.press("ArrowDown");
  await expect(open).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(email).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("mention-preview-desktop.png") });
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(email).toHaveAttribute("aria-expanded", "false");
  await mention.hover();
  await expect(preview).toContainText("Confirmed creator");
  await preview.hover();
  await expect(preview).toBeVisible();
  expect(previews).toHaveLength(1);
  await open.click();
  assertRoute(page.url(), false, { profile: OWNER });
  await expect(page.locator(".boost-profile-copy h2")).toBeVisible();
  expect(queries.some((query) => query.detail)).toBe(false);
});

test("Unicode, punctuation, and quoted PowIDs keep the complete identity in profile routes", async ({ page }) => {
  const tokens = [
    ["@名.work+1", "名.work+1"],
    ['@"space name"', "space name"],
    ['"space name"@proofofwork.me', "space name"],
    ["名.work+1@proofofwork.me", "名.work+1"],
    [`@"${LEGACY}"`, LEGACY.toLowerCase()],
  ];
  const { previews } = await fixture(page, { items: [
    post(ORIGINAL_TXID, tokens.slice(0, 4).map(([text]) => text).join(" ")),
    post(QUOTE_TXID, tokens[4][0]),
  ] });
  await page.goto("/?folder=boost");
  for (const [text, id] of tokens) {
    const mention = page.getByTestId("boost-post").getByRole("link", { name: text, exact: true });
    await expect(mention).toBeVisible();
    assertRoute(await mention.getAttribute("href"), true, { profile: `${id}@proofofwork.me` });
    await mention.focus();
    await expect(page.getByTestId("boost-mention-preview")).toContainText("Confirmed creator");
    await page.keyboard.press("Escape");
  }
  expect(previews.map((query) => query.profile).sort()).toEqual([
    "space name@proofofwork.me", "名.work+1@proofofwork.me", `${LEGACY.toLowerCase()}@proofofwork.me`,
  ].sort());
  await page.getByTestId("boost-post").getByRole("link", { name: "@名.work+1", exact: true }).click();
  assertRoute(page.url(), true, { profile: "名.work+1@proofofwork.me" });
  await expect(page.locator(".boost-embedded-app")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Boost detail", exact: true })).toHaveCount(0);
});

test("raw legacy, P2SH, SegWit, and Taproot address mentions work without an ID and stay contained on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const addresses = [LEGACY, P2SH, SEGWIT.toUpperCase(), TAPROOT];
  const { previews } = await fixture(page, { items: addresses.map((address, index) =>
    post(String(index + 1).repeat(64), `Address mention @${address}`)) });
  await page.goto("/?folder=boost");
  for (const address of addresses) {
    const mention = page.getByRole("link", { name: `@${address}`, exact: true });
    assertRoute(await mention.getAttribute("href"), true, { profile: address });
    await mention.focus();
    const preview = page.getByTestId("boost-mention-preview");
    await expect(preview).toContainText("Address author");
    await expect(preview).toContainText(address.toLowerCase().startsWith("bc1") ? address.toLowerCase() : address);
    const bounds = await preview.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    if (address === TAPROOT) await page.screenshot({ path: testInfo.outputPath("mention-preview-mobile.png") });
    await page.keyboard.press("Escape");
  }
  expect(previews).toHaveLength(4);
});

for (const previewState of ["pending", "unregistered", "unavailable", "incomplete", "invalid-address"]) {
  test(`${previewState} mention resolution does not invent a confirmed profile`, async ({ page }) => {
    await fixture(page, { items: [original], previewState });
    await page.goto("/?boost=1");
    await page.getByRole("link", { name: "@ArmyOfYouth", exact: true }).focus();
    const preview = page.getByTestId("boost-mention-preview");
    await expect(preview).toContainText(["pending", "unregistered"].includes(previewState)
      ? "No confirmed profile resolves this mention." : "Profile preview unavailable.");
    await expect(preview.getByRole("link", { name: "Open profile", exact: true })).toHaveCount(0);
    await expect(preview).not.toContainText("12 Followers");
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
  });
}

test("text stays literal and tag or mention markers inside external URLs and other emails do not become partial links", async ({ page }) => {
  const text = "<img src=x onerror=alert(1)> https://example.com/@armyofyouth/$WORK/#tag person@example.com $WORK #tag";
  await fixture(page, { items: [post(ORIGINAL_TXID, text)] });
  await page.goto("/?boost=1");
  const body = page.getByTestId("boost-post").locator(".boost-post-text");
  await expect(body).toHaveText(text);
  await expect(body.locator("img")).toHaveCount(0);
  await expect(body.locator(".boost-text-link")).toHaveCount(2);
  await expect(body.getByRole("link", { name: "$WORK", exact: true })).toHaveCount(1);
  await expect(body.getByRole("link", { name: "#tag", exact: true })).toHaveCount(1);
});
