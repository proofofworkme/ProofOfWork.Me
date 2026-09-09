import { expect, test } from "@playwright/test";
const HASH = "a".repeat(64);
const NOW = "2026-09-08T23:00:00.000Z";
const ADDRESS = "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x";
const TOKEN = { tokenId: HASH, txid: HASH, ticker: "AUDITLONGTOKEN", network: "livenet", confirmed: true,
  createdAt: NOW, creatorAddress: ADDRESS, registryAddress: ADDRESS, creationFeeSats: 1000,
  mintAmount: 1, mintPriceSats: 546, maxSupply: 100, confirmedSupply: 25, pendingSupply: 0,
  confirmedMints: 25, pendingMints: 0, holderCount: 2 };
const DIRECTORY = { tokens: [TOKEN], holders: [], mints: [], transfers: [], listings: [], closedListings: [], sales: [], invalidEvents: [],
  creationSats: 1000, indexedAt: NOW, indexedThroughBlock: 966125, indexedThroughBlockHash: HASH, snapshotId: HASH,
  summaryOnly: true, totalCounts: { tokens: 1, holders: 2, mints: 25 }, directory: { model: "proof-token-directory-v1", complete: true, totalCount: 1 } };
const fulfill = (route, value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
const fallback = (route) => fulfill(route, { items: [], records: [], listings: [], pendingEvents: [], activity: [], tokens: [], mints: [], inboxMessages: [], sentMessages: [], totalCount: 0, page: 0, pageSize: 25, hasMore: false, indexedAt: NOW });

test("Credit history failure is unavailable, retries to authoritative empty, and fits 375px", async ({ page }) => {
  let retry = false;
  await page.setViewportSize({ width: 375, height: 900 });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/token-summary") return fulfill(route, DIRECTORY);
    if (url.pathname === "/api/v1/token-history") {
      if (!retry) return fulfill(route, { error: "History checkpoint is temporarily unavailable." }, 503);
      return fulfill(route, { kind: url.searchParams.get("kind"), items: [], totalCount: 0, page: 0, pageSize: 25, hasMore: false, indexedAt: NOW });
    }
    return fallback(route);
  });
  await page.goto("/?token=1");
  await expect(page.getByRole("heading", { name: "Holder history unavailable", exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "No holders yet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mint history unavailable", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expect(page.getByText("Connect your wallet to verify your confirmed balance.", { exact: false }).first()).toBeVisible();
  retry = true;
  await page.getByRole("button", { name: "Retry", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "No holders yet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Holder history unavailable", exact: true })).toHaveCount(0);
});

test("Computer cold IDs and disconnected mailbox do not claim verified empty state", async ({ page }) => {
  let release;
  const blocked = new Promise((resolve) => release = resolve);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/registry" || url.pathname === "/api/v1/registry-summary") await blocked;
    return fallback(route);
  });
  try {
    await page.goto("/?folder=ids");
    await expect(page.locator(".ids-workspace .files-toolbar")).toContainText("Loading registry", { timeout: 45_000 });
    await expect(page.getByRole("button", { name: "Register ID", exact: true })).toBeDisabled();
    await expect(page.getByText("No IDs for this wallet yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No registry records found yet.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No in-flight ID transfers for this wallet.", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Connect a wallet to see your IDs.", { exact: true })).toBeVisible();
    await expect(page.getByText("Verifying registry records…", { exact: true })).toBeVisible();
  } finally { release(); }
  await page.goto("/?folder=inbox");
  await expect(page.getByRole("heading", { name: "Connect your wallet to view mail", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No Inbox messages", exact: true })).toHaveCount(0);
});
