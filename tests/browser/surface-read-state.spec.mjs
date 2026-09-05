import { expect, test } from "@playwright/test";
const HASH = "a".repeat(64);
const NOW = "2026-09-05T15:00:00.000Z";
const TOKEN = { tokenId: HASH, txid: HASH, ticker: "AUD", network: "livenet", confirmed: true,
  createdAt: NOW, creatorAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x", registryAddress: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x",
  creationFeeSats: 1000, mintAmount: 1, mintPriceSats: 546, maxSupply: 100,
  confirmedSupply: 25, pendingSupply: 2, confirmedMints: 25, pendingMints: 2 };
const directory = { tokens: [TOKEN], mints: [], holders: [], transfers: [], listings: [], closedListings: [], sales: [],
  invalidEvents: [], creationSats: 1000, indexedAt: NOW, indexedThroughBlock: 965622, indexedThroughBlockHash: HASH,
  snapshotId: HASH, summaryOnly: true, totalCounts: { tokens: 1, mints: 27 },
  directory: { model: "proof-token-directory-v1", complete: true, totalCount: 1 } };
function delayed() { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; }
async function fulfill(route, payload) { await route.fulfill({ contentType: "application/json", body: JSON.stringify(payload) }); }
async function fallback(route) {
  const url = new URL(route.request().url());
  await fulfill(route, { kind: url.searchParams.get("kind"), items: [], records: [], listings: [], pendingEvents: [], activity: [], tokens: [], mints: [], totalCount: 0, page: 0, pageSize: 25, hasMore: false, indexedAt: NOW });
}

test("Credit waits for its directory and uses exact aggregate supply despite empty mint preview", async ({ page }) => {
  const gate = delayed(); const reads = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()); reads.push(url.pathname);
    if (url.pathname === "/api/v1/token-summary") {
      expect(url.searchParams.get("projection")).toBe("directory-v1");
      expect(url.searchParams.get("compact")).toBe("1");
      await gate.promise;
      return fulfill(route, directory);
    }
    return fallback(route);
  });
  await page.goto("/?token=1");
  await expect(page.getByRole("heading", { name: "Loading credits", exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByLabel("Credit stats")).toContainText("Loading");
  await expect(page.getByRole("heading", { name: "No credits yet", exact: true })).toHaveCount(0);
  gate.release();
  const card = page.locator(".token-record").filter({ hasText: "AUD" });
  await expect(card).toContainText("25");
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  await expect(page.getByLabel("Credit stats")).toContainText("1Created credits");
  await page.waitForTimeout(1300); // exceed the former duplicate refresh timer
  expect(reads.filter((path) => path === "/api/v1/token-summary")).toHaveLength(1);
  expect(reads.filter((path) => path === "/api/v1/token")).toHaveLength(0);
});

test("Home reads qualified counts and retains them after malformed fresh counts", async ({ page }) => {
  const reads = []; const gate = delayed();
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/registry-summary") return fallback(route);
    reads.push(url.searchParams.get("projection"));
    if (url.searchParams.has("fresh")) { await gate.promise; return fulfill(route, { registryCounts: { model: "proof-registry-counts-v1", complete: false, confirmedCount: 0, pendingCount: 0, totalCount: 0 } }); }
    return fulfill(route, { indexedAt: NOW, registryCounts: { model: "proof-registry-counts-v1", complete: true, confirmedCount: 505, pendingCount: 2, totalCount: 507 } });
  });
  await page.goto("/?landing=1");
  await expect(page.locator(".landing-app")).toContainText("505");
  gate.release();
  await expect(page.locator(".landing-app")).toContainText("complete ID counts are unavailable");
  await expect(page.locator(".landing-app")).toContainText("505");
  expect(reads.every((projection) => projection === "counts-v1")).toBe(true);
});

test("Desktop rejects pending IDs via one current ID lookup without scanning the registry", async ({ page }) => {
  const reads = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()); reads.push(url);
    if (url.pathname === "/api/v1/ids/pending-audit") return fulfill(route, { record: null, records: [], pendingEvents: [] });
    return fallback(route);
  });
  await page.goto("/?desktop=1");
  await page.getByPlaceholder("address or user@proofofwork.me").fill("pending-audit@proofofwork.me");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect.poll(() => reads.filter((url) => url.pathname === "/api/v1/ids/pending-audit").length).toBe(1);
  expect(reads.find((url) => url.pathname === "/api/v1/ids/pending-audit").searchParams.get("current")).toBe("1");
  expect(reads.filter((url) => url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/registry-summary")).toHaveLength(0);
});

test("Log search waits for matching results and counts returned pending rows outside the global head", async ({ page }) => {
  const gate = delayed();
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/log-history") {
      const query = url.searchParams.get("q") || "";
      if (query === HASH) {
        await gate.promise;
        return fulfill(route, { kind: "activity", query, items: [{ txid: HASH, kind: "id-register", id: "auditpending", network: "livenet", confirmed: false, createdAt: NOW, amountSats: 1000, dataBytes: 32 }], totalCount: 1, page: 0, pageSize: 50, indexedAt: NOW });
      }
      return fulfill(route, { kind: "activity", query, items: [], totalCount: 0, page: 0, pageSize: 50, indexedAt: NOW });
    }
    return fallback(route);
  });
  await page.goto("/?log=1");
  await page.getByPlaceholder("address, user@proofofwork.me, or txid").fill(HASH);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Searching log", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No activity", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Log stats")).toContainText("Searching");
  gate.release();
  const stats = page.getByLabel("Log stats").locator(":scope > div");
  await expect(stats.nth(0)).toContainText("1Total actions");
  await expect(stats.nth(1)).toContainText("0Confirmed");
  await expect(stats.nth(2)).toContainText("1Pending");
  await expect(page.locator(".activity-feed")).toContainText("auditpending@proofofwork.me");
  await page.getByPlaceholder("address, user@proofofwork.me, or txid").fill("b".repeat(64));
  await expect(page.getByRole("heading", { name: "Search to verify this query", exact: true })).toBeVisible();
  await expect(page.locator(".activity-feed")).toHaveCount(0);
});

test("Boost never reports partial or zero facts while awaiting a matching indexed search", async ({ page }) => {
  const initial = delayed(); const search = delayed(); const reads = [];
  const item = (eventId, text) => ({ eventId, txid: String(eventId).repeat(64), kind: "boost-post",
    confirmed: true, authorAddress: TOKEN.creatorAddress, authorDisplay: "Audit author", text,
    createdAt: NOW, proofSignalSats: 546, proofSignalQ8: "54600000000", proofSignalSatsExact: "546",
    totalSignalQ8: "54600000000", totalSignalSatsExact: "546", workSignalValueQ8: "0",
    workSignalValueSatsExact: "0", workSignalSubatoms: "0" });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/boost") return fallback(route);
    const query = url.searchParams.get("q") || ""; reads.push(query);
    await (query ? search.promise : initial.promise);
    const total = query ? 1 : 2;
    return fulfill(route, { complete: true, mode: "timeline", network: "livenet", snapshotId: HASH,
      indexedAt: NOW, totalCount: total, start: 0, end: 1, hasMore: !query, nextCursor: query ? "" : "next-page",
      items: [query ? item(2, "The indexed memo matched this confirmed record.") : item(1, "Initial confirmed post.")],
      signalStats: { totalSignalQ8: String(BigInt(total) * 54600000000n), proofSignalQ8: String(BigInt(total) * 54600000000n),
        totalSignalUsd: 0, workSignalSubatoms: "0" } });
  });
  await page.goto("/?boost=1");
  await expect(page.getByRole("heading", { name: "Loading Boost history" })).toBeVisible({ timeout: 45_000 });
  const posts = page.locator(".account-signal-item").filter({ hasText: "Posts" });
  const totalSignal = page.locator(".account-signal-item").filter({ hasText: "Total Signal" });
  await expect(posts).toContainText("Loading");
  initial.release();
  await expect(posts).toContainText("2"); // full result count, despite one loaded row
  await expect(totalSignal).toContainText("1,092 proofs");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByPlaceholder("Search Boost", { exact: true }).fill("hidden-term");
  await expect(posts).toContainText("Loading");
  await expect(totalSignal).toContainText("Loading");
  await expect(page.locator(".boost-post")).toHaveCount(0);
  await page.clock.runFor(300);
  await expect.poll(() => reads.includes("hidden-term")).toBe(true);
  await expect(posts).toContainText("Loading");
  search.release();
  await expect(posts).toContainText("1");
  await expect(totalSignal).toContainText("546 proofs");
  await expect(page.locator(".boost-post")).toContainText("The indexed memo matched this confirmed record.");
});
