import { expect, test } from "@playwright/test";

const txid = "a".repeat(64);
const otherTxid = "b".repeat(64);
const address = "bc1qsearchfixture000000000000000000000000000";
const hostileText = '<script>window.searchInjected = true</script><img src=x onerror="window.searchInjected=true">';
const record = {
  id: "event:1", txid, protocol: "pwm1", kind: "message", status: "confirmed", valid: true,
  validationErrors: [], title: "UTXO reservation evidence", excerpt: "UTXO reservation keeps a sale ticket available. The source is inspectable.",
  amountSats: "9007199254740993", dataBytes: 186, blockHeight: 960700, blockHash: "c".repeat(64),
  blockIndex: 4, timestamp: "2026-10-04T12:00:00Z", participants: [{ address, role: "sender", powid: "alice@proofofwork.me" }],
  refs: [{ type: "listing", value: otherTxid }], source: { vout: 0, ordinal: 0 },
};
const file = { ...record, id: `file:${otherTxid}:0`, txid: otherTxid, kind: "file", title: "reservation-notes.md",
  excerpt: hostileText, file: { name: "reservation-notes.md", mimeType: "text/markdown", size: 200, sha256: "d".repeat(64) } };
const coverage = { ready: true, checkpointHeight: 960700, checkpointHash: "c".repeat(64), indexVersion: "search-v1", lastIndexedAt: "2026-10-04T12:00:00Z",
  sourceCounts: { protocolEvents: 2, attachments: 1 }, byProtocol: { pwm1: { total: 3, confirmed: 3, valid: 3, invalid: 0 } }, kinds: ["message", "file", "credit-send", "dns-subdomain"] };

function response({ network = "livenet", q = "", results = [record, file], ready = true, cursor = null, total = results.length } = {}) {
  return { network, q, results, coverage: { ...coverage, ready }, pagination: { limit: 25, returned: results.length, total, nextCursor: cursor, hasMore: Boolean(cursor) } };
}

async function fixture(page, handler) {
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    if (url.pathname === "/api/v1/search/detail") {
      if (handler && await handler(route, url)) return;
      const selected = url.searchParams.get("id") === file.id ? file : record;
      return route.fulfill({ json: { network: url.searchParams.get("network"), record: selected,
        payload: { memo: hostileText, exactAmountSats: selected.amountSats }, rawPayload: hostileText,
        evidence: { blockHash: selected.blockHash, outputIndex: selected.source.vout }, coverage } });
    }
    if (url.pathname === "/api/v1/search") {
      if (handler && await handler(route, url)) return;
      return route.fulfill({ json: response({ network: url.searchParams.get("network"), q: url.searchParams.get("q") }) });
    }
    return route.fulfill({ json: { network: "livenet", records: [], listings: [], items: [], complete: true, totalCount: 0, hasMore: false } });
  });
}

for (const { width, embedded } of [{ width: 390, embedded: false }, { width: 768, embedded: false }, { width: 1440, embedded: false }, { width: 1280, embedded: true }]) {
  test(`public search and source inspector fit ${width}px${embedded ? " in Computer" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    const requests = [];
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/v1/search") requests.push(new URL(request.url())); });
    await page.goto(embedded ? "/?folder=search" : "/?search-app=1");
    await expect(page.getByRole("heading", { name: "Find the record.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: record.title, exact: true })).toBeVisible();
    expect(requests[0].searchParams.get("network")).toBe("livenet");
    expect(requests[0].searchParams.get("status")).toBe("confirmed");
    expect(requests[0].searchParams.get("valid")).toBe("valid");
    await expect(page.locator(".search-proofs").first()).toHaveText("9,007,199,254,740,993 proofs");
    await expect(page.locator(".search-excerpt").nth(1)).toHaveText(hostileText);
    expect(await page.evaluate(() => window.searchInjected)).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.getByRole("button", { name: record.title, exact: true }).click();
    const inspector = page.getByRole("dialog");
    await expect(inspector).toBeVisible();
    await expect(page).toHaveURL(/record=/);
    await expect(inspector.getByText("9,007,199,254,740,993", { exact: true })).toBeVisible();
    await inspector.getByRole("button", { name: "Raw payload", exact: true }).click();
    await expect(inspector.locator("pre")).toHaveText(hostileText);
    expect(await page.evaluate(() => window.searchInjected)).toBeUndefined();
    await page.keyboard.press("Escape");
    await expect(inspector).not.toBeVisible();
    await expect(page).not.toHaveURL(/record=/);
  });
}

test("query, protocol, action and network filters are shareable and restored by Back", async ({ page }) => {
  await fixture(page);
  await page.goto("/?search-app=1&q=UTXO");
  await expect(page.getByRole("searchbox", { name: "Search the Computer" })).toHaveValue("UTXO");
  await expect(page.locator(".search-excerpt mark").first()).toHaveText("UTXO");
  await page.getByLabel("Protocol", { exact: true }).selectOption("pwdns1");
  await expect(page).toHaveURL(/protocol=pwdns1/);
  await expect(page.getByLabel("Action", { exact: true }).locator("option[value='dns-subdomain']")).toHaveCount(1);
  await page.getByLabel("Action", { exact: true }).selectOption("dns-subdomain");
  await expect(page).toHaveURL(/kind=dns-subdomain/);
  const nextRead = page.waitForRequest(request => { const url = new URL(request.url()); return url.pathname === "/api/v1/search" && url.searchParams.get("network") === "testnet4"; });
  await page.getByLabel("Network", { exact: true }).selectOption("testnet4");
  await nextRead;
  await expect(page).toHaveURL(/network=testnet4/);
  await expect(page.locator(".search-result-meta a").first()).toHaveAttribute("href", `https://mempool.space/testnet4/tx/${txid}`);
  await page.goBack();
  await expect(page.getByLabel("Network", { exact: true })).toHaveValue("livenet");
  await expect(page.getByLabel("Action", { exact: true })).toHaveValue("dns-subdomain");
  await expect(page).toHaveURL(/search-app=1/);
});

test("leaving public Search restores Computer's network and clears Search filters", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page);
  await page.goto("/?folder=search&network=livenet&q=UTXO&protocol=pwm1");
  await expect(page.getByRole("button", { name: record.title, exact: true })).toBeVisible();
  await page.getByLabel("Network", { exact: true }).selectOption("testnet4");
  await expect(page).toHaveURL(/network=testnet4/);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.locator(".folders").getByRole("button", { name: /^Log(?:\s|$)/ }).click();
  const url = new URL(page.url());
  expect(url.searchParams.get("folder")).toBe("log");
  expect(url.searchParams.get("network")).toBe("livenet");
  for (const key of ["q", "protocol", "kind", "status", "valid", "sort", "record", "cursor"]) expect(url.searchParams.has(key)).toBe(false);
});

test("unavailable and incomplete coverage cannot appear as a verified empty search", async ({ page }) => {
  let phase = "unavailable";
  await fixture(page, async (route, url) => {
    if (url.pathname !== "/api/v1/search") return false;
    if (phase === "unavailable") await route.fulfill({ status: 503, json: { error: "Search index is warming." } });
    else await route.fulfill({ json: response({ results: [], ready: false }) });
    return true;
  });
  await page.goto("/?search-app=1");
  await expect(page.getByRole("alert")).toContainText("Search index is warming.");
  await expect(page.getByRole("heading", { name: "No matching records", exact: true })).toHaveCount(0);
  await expect(page.locator(".search-result-toolbar")).not.toContainText("0 matching");
  phase = "incomplete";
  await page.getByRole("button", { name: "Retry search", exact: true }).click();
  await expect(page.getByText("Index coverage is incomplete", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No matches in the indexed records yet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No matching records", exact: true })).toHaveCount(0);
});

test("a response from a different network stays unavailable", async ({ page }) => {
  await fixture(page, async (route, url) => {
    if (url.pathname !== "/api/v1/search") return false;
    await route.fulfill({ json: response({ network: "testnet4" }) }); return true;
  });
  await page.goto("/?search-app=1&network=livenet");
  await expect(page.getByRole("alert")).toContainText("Search coverage is unavailable for this network");
  await expect(page.locator(".search-result")).toHaveCount(0);
});

test("superseded slow queries cannot replace newer results", async ({ page }) => {
  let finishOld;
  await fixture(page, async (route, url) => {
    if (url.pathname !== "/api/v1/search") return false;
    const query = url.searchParams.get("q");
    if (query === "old") {
      await new Promise(resolve => { finishOld = resolve; });
      await route.fulfill({ json: response({ q: query, results: [{ ...record, title: "Old result must stay absent" }] }) }).catch(() => {});
    } else await route.fulfill({ json: response({ q: query, results: [{ ...record, title: query === "new" ? "New current result" : record.title }] }) });
    return true;
  });
  await page.goto("/?search-app=1");
  await expect(page.getByRole("button", { name: record.title, exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("old");
  const oldRead = page.waitForRequest(request => new URL(request.url()).searchParams.get("q") === "old");
  await page.getByRole("button", { name: "Search", exact: true }).click(); await oldRead;
  await page.getByRole("searchbox").fill("new");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: "New current result", exact: true })).toBeVisible();
  finishOld();
  await expect(page.getByRole("button", { name: "Old result must stay absent", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/q=new/);
});

test("pagination removes duplicate records and keeps the query scope", async ({ page }) => {
  await fixture(page, async (route, url) => {
    if (url.pathname !== "/api/v1/search") return false;
    await route.fulfill({ json: url.searchParams.has("cursor")
      ? response({ q: url.searchParams.get("q"), results: [record, file], total: 2 })
      : response({ q: url.searchParams.get("q"), results: [record], cursor: "page-two", total: 2 }) }); return true;
  });
  await page.goto("/?search-app=1&q=reservation");
  await expect(page.locator(".search-result")).toHaveCount(1);
  const pageRead = page.waitForRequest(request => new URL(request.url()).searchParams.get("cursor") === "page-two");
  await page.getByRole("button", { name: "More results", exact: true }).click();
  const request = await pageRead;
  expect(new URL(request.url()).searchParams.get("q")).toBe("reservation");
  await expect(page.locator(".search-result")).toHaveCount(2);
  await expect(page.getByRole("button", { name: record.title, exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "More results", exact: true })).toHaveCount(0);
});

test("invalid and raw evidence are visibly distinct from canonical records", async ({ page }) => {
  const invalid = { ...record, valid: false, validationErrors: ["Owner authorization missing"], status: "confirmed", title: "Rejected mutation" };
  const raw = { ...file, valid: null, protocol: "unknown", title: "Unclassified carrier" };
  await fixture(page, async (route, url) => {
    if (url.pathname === "/api/v1/search") await route.fulfill({ json: response({ results: [invalid, raw] }) });
    else await route.fulfill({ json: { network: "livenet", record: invalid, payload: {}, rawPayload: "pwid1:t", evidence: {} } });
    return true;
  });
  await page.goto("/?search-app=1&valid=all");
  await expect(page.locator(".search-badge.is-invalid")).toHaveText("Invalid");
  await expect(page.locator(".search-badge.is-raw")).toHaveText("Raw carrier");
  await page.getByRole("button", { name: "Rejected mutation", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("This record does not establish canonical protocol state.");
  await expect(page.getByRole("dialog")).toContainText("Owner authorization missing");
});

test("checkpoint coverage and unverified chain positions stay explicit", async ({ page }) => {
  const noncanonical = { ...record, canonical: false, title: "Unverified historical source" };
  await fixture(page, async (route, url) => {
    if (url.pathname === "/api/v1/search") await route.fulfill({ json: { ...response({ results: url.searchParams.get("q") === "absent" ? [] : [noncanonical] }), coverage: { ...coverage, scope: "complete-at-checkpoint" } } });
    else await route.fulfill({ json: { network: "livenet", record: noncanonical, payload: {}, rawPayload: "pwm1:m", evidence: {} } });
    return true;
  });
  await page.goto("/?search-app=1&status=all");
  await expect(page.getByText("Search covers verified history through block 960,700. Newer records may not be indexed yet.", { exact: true })).toBeVisible();
  await expect(page.locator(".search-badge.is-unverified")).toHaveText("Unverified chain position");
  await expect(page.locator(".search-badge.is-confirmed")).toHaveCount(0);
  await page.getByRole("button", { name: noncanonical.title, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("It does not establish current canonical state.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: noncanonical.title, exact: true })).toBeFocused();
  await page.getByRole("searchbox").fill("absent");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No matching records through block 960,700", exact: true })).toBeVisible();
});
