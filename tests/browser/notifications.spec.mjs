import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ADDRESS, OTHER_ADDRESS, HASH, CODE_REPO, CODE_VERSION, ID_RECORD, REGISTRY, fixture, expectNoSignature } from "../fixtures/pagesFixture.mjs";

// Synthetic protocol projections exercise the local UI, never live-chain authority.
const TX = ["1", "2", "3", "4"].map(value => value.repeat(64));
const NOW = "2026-10-23T14:00:00Z";
function item(index, changes = {}) {
  return { id: `livenet:${TX[index]}`, app: "mail", kind: "mail", label: "Message received", detail: "A message for this address",
    direction: "incoming", status: "confirmed", txid: TX[index], protocolVout: 1, recordOrdinal: 0,
    createdAt: NOW, firstSeenAt: NOW, maxEventId: index + 1, actorAddress: OTHER_ADDRESS, recipientAddresses: [ADDRESS], relatedTxids: [],
    evidence: { protocol: "pwm1", valid: true, applied: true, blockHeight: 970000, blockHash: HASH, sourceEventId: `event-${index}` },
    target: { workspace: "mail", txid: TX[index] }, ...changes };
}
function response(address, items, changes = {}) {
  return { model: "proof-computer-notifications-v1", network: "livenet", address, items,
    nextCursor: null, hasMore: false, totalCount: items.length, indexedThroughBlock: 970000, indexedThroughBlockHash: HASH,
    coverage: { complete: true, scope: "indexed-computer-actions", pending: "best-effort", qualification: [] },
    snapshotId: "notification-fixture-snapshot", observedAt: "2026-10-23T14:30:00Z",
    readBoundary: { maxFirstSeenAt: NOW, maxEventId: 100 }, ...changes };
}
async function notificationsFixture(page) {
  const base = await fixture(page);
  const state = { ...base, notifications: [item(0), item(1, { app: "wallet", label: "Credit sent", direction: "outgoing", status: "pending" })], idRecord: { ...ID_RECORD }, idNotifications: [item(0, { label: "ID message received" })], responseChanges: {}, fail: false, secondPage: null, requests: [], calls: 0 };
  await page.route("**/api/v1/ids/**", async route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    const record = id === "alice" ? state.idRecord : id === "pending" ? { ...state.idRecord, id, confirmed: false } : null;
    return route.fulfill({ json: { ...REGISTRY, record, records: record ? [record] : [], status: record ? record.confirmed ? "confirmed" : "pending" : "available" } });
  });
  await page.route("**/api/v1/notifications?**", async route => {
    const url = new URL(route.request().url());
    state.requests.push(url); state.calls++;
    if (state.fail) return route.fulfill({ status: 503, json: { error: "The indexed checkpoint is unavailable." } });
    const id = url.searchParams.get("id");
    const scope = id ? { scope: { type: "id", id, registrationTxid: HASH }, scopeKey: `id:${HASH}` } : {};
    if (url.searchParams.get("cursor")) {
      if (state.secondPage === "conflict") return route.fulfill({ status: 409, json: { error: "The notification snapshot changed; refresh from the beginning." } });
      return route.fulfill({ json: response(url.searchParams.get("address"), state.secondPage ?? [], { ...state.responseChanges, ...scope }) });
    }
    const address = url.searchParams.get("address");
    return route.fulfill({ json: response(address, id ? state.idNotifications : address === ADDRESS ? state.notifications : [],
      { ...(state.secondPage ? { hasMore: true, nextCursor: "fixture-next-page", totalCount: 3 } : {}), ...state.responseChanges, ...scope }) });
  });
  return state;
}
async function connect(page) { await page.locator(".topbar-wallet-button").click(); await expect(page.locator(".topbar-wallet-button")).toContainText(ADDRESS.slice(0, 8)); }
async function open(page) { await page.getByRole("button", { name: /^Notifications/u }).click(); return page.getByRole("dialog", { name: "Notifications", exact: true }); }

test("read state persists per address, confirmation updates one row, and wallet change isolates activity", async ({ page }) => {
  const state = await notificationsFixture(page);
  await page.goto("/?folder=inbox"); await connect(page);
  const dialog = await open(page);
  await expect(dialog.locator(".notification-row")).toHaveCount(2);
  await dialog.getByRole("article", { name: "Unread: Credit sent", exact: true }).getByRole("button", { name: "Mark read", exact: true }).click();
  state.notifications[1].status = "confirmed";
  await dialog.getByRole("button", { name: "Refresh notifications", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "Read: Credit sent", exact: true })).toContainText("Confirmed");
  await expect(dialog.locator(".notification-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Notifications/u })).toBeFocused();
  await page.reload(); await connect(page); await open(page);
  await expect(dialog.getByRole("article", { name: "Read: Credit sent", exact: true })).toBeVisible();
  await page.evaluate(address => window.__pagesFixture.changeAccount(address), OTHER_ADDRESS);
  await expect(dialog.locator(".notifications-scope")).toContainText(OTHER_ADDRESS);
  await expect(dialog.locator(".notification-row")).toHaveCount(0);
  await expectNoSignature(page, state);
});

test("confirmed ID lookup opens ID-linked history with separate current address views and rejects pending IDs", async ({ page }) => {
  const state = await notificationsFixture(page);
  await page.goto("/?folder=inbox"); const dialog = await open(page);
  const field = dialog.getByLabel("Address or confirmed ProofOfWork ID", { exact: true });
  await field.fill("pending"); await dialog.getByRole("button", { name: "Look up", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("no confirmed owner");
  await expect(dialog.getByRole("button", { name: "View owner address", exact: true })).toHaveCount(0);
  await field.fill("alice@proofofwork.me"); await dialog.getByRole("button", { name: "Look up", exact: true }).click();
  await expect(dialog.locator(".notification-identity")).toContainText(ADDRESS);
  await expect(dialog.locator(".notification-identity")).toContainText(OTHER_ADDRESS);
  await expect(dialog.getByRole("article", { name: "Unread: ID message received", exact: true })).toBeVisible();
  await expect(dialog.locator(".notification-row")).toHaveCount(1);
  await expect(dialog.locator(".notifications-scope")).toContainText("ID history");
  await dialog.getByRole("button", { name: "View owner address", exact: true }).click();
  await expect(dialog.locator(".notification-row")).toHaveCount(2);
  await expect(dialog.locator(".notifications-scope")).toContainText("alice · owner");
  expect(state.requests.some(url => url.searchParams.get("id") === "alice" && !url.searchParams.has("address"))).toBe(true);
  expect(state.requests.filter(url => !url.searchParams.has("id")).every(url => url.searchParams.get("address") === ADDRESS)).toBe(true);
  await expectNoSignature(page, state);
});

test("ID read status survives owner and receiver changes without marking an address history read", async ({ page }) => {
  const state = await notificationsFixture(page);
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await dialog.locator(".notifications-lookup > summary").click();
  const field = dialog.getByLabel("Address or confirmed ProofOfWork ID", { exact: true });
  await field.fill("alice"); await dialog.getByRole("button", { name: "Look up", exact: true }).click();
  await dialog.getByRole("article", { name: "Unread: ID message received", exact: true }).getByRole("button", { name: "Mark read", exact: true }).click();
  const key = `pow:notifications:v1:livenet:${encodeURIComponent(`id:${HASH}`)}`;
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "{}").entries?.["livenet:" + "1".repeat(64)]?.read, key)).toBe(true);
  state.idRecord = { ...state.idRecord, ownerAddress: OTHER_ADDRESS, receiveAddress: ADDRESS };
  await field.fill("ALICE@proofofwork.me"); await dialog.getByRole("button", { name: "Look up", exact: true }).click();
  await expect(dialog.locator(".notification-identity > div").first()).toContainText(OTHER_ADDRESS);
  await dialog.getByRole("button", { name: "Refresh notifications", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "Read: ID message received", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "View receiver address", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "Unread: Message received", exact: true })).toBeVisible();
  await expectNoSignature(page, state);
});

function rawItem(index, label) {
  return item(index, { app: "computer", kind: "transfer", label, firstSeenAt: null, maxEventId: null,
    protocolVout: null, recordOrdinal: null, actorAddress: null, senderAddresses: [ADDRESS, OTHER_ADDRESS],
    evidence: { protocol: "transaction", valid: null, sourceEventId: null, chainStatus: "confirmed",
      inputs: [{ address: ADDRESS, valueProofs: "90071992547409931234567890123456" }, { address: OTHER_ADDRESS, valueProofs: "15" }],
      outputs: [{ address: ADDRESS, valueProofs: "90071992547409931234567890000000" }] }, target: { workspace: "search", txid: TX[index] } });
}
test("raw-only mark all includes unloaded transfer IDs and later discovered history stays unread", async ({ page }) => {
  const state = await notificationsFixture(page);
  state.notifications = [rawItem(0, "Proofs received")];
  state.secondPage = [rawItem(1, "Older transfer")];
  state.responseChanges = { totalCount: 2, readBoundary: { maxFirstSeenAt: null, maxEventId: 0, explicitIds: [0, 1].map(index => `livenet:${TX[index]}`) } };
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await expect(page.getByRole("button", { name: /^Notifications/u })).toHaveAccessibleName(/1\+ unread/u);
  await dialog.getByRole("button", { name: "Mark all read", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Notifications/u })).toHaveAccessibleName(/0 unread/u);
  await dialog.getByRole("button", { name: "Load older notifications", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "Read: Older transfer", exact: true })).toBeVisible();
  const row = dialog.getByRole("article", { name: "Read: Proofs received", exact: true });
  await row.locator(".notification-evidence > summary").click();
  await expect(row.locator("dl")).toContainText(ADDRESS); await expect(row.locator("dl")).toContainText(OTHER_ADDRESS);
  await expect(row.locator(".notification-source-json")).toContainText("90071992547409931234567890123456");
  await expect(row.locator("dl")).toContainText("No protocol record");
  await expect(row.locator("dl")).not.toContainText("Output unavailable");
  await expect(row.getByRole("link", { name: "View transaction in explorer", exact: true })).toHaveAttribute("href", `https://mempool.space/tx/${TX[0]}`);
  await expect(row.getByRole("link", { name: "View transaction in explorer", exact: true })).toHaveAttribute("target", "_blank");
  await expect(row.getByRole("button", { name: "Open record", exact: true })).toHaveCount(0);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  state.notifications = [rawItem(2, "Late discovered transfer"), ...state.notifications, ...state.secondPage]; state.secondPage = null;
  state.responseChanges = { readBoundary: { maxFirstSeenAt: null, maxEventId: 0, explicitIds: [0, 1, 2].map(index => `livenet:${TX[index]}`) } };
  await dialog.getByRole("button", { name: "Refresh notifications", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "Unread: Late discovered transfer", exact: true })).toBeVisible();
  await expect(dialog.getByRole("article", { name: "Read: Older transfer", exact: true })).toBeVisible();
  await expectNoSignature(page, state);
});

test("pagination keeps historical actions accessible and failures do not become empty activity", async ({ page }) => {
  const state = await notificationsFixture(page);
  state.secondPage = [item(2, { app: "dns", label: "Page link set", direction: "self" })];
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await expect(page.getByRole("button", { name: /^Notifications/u })).toHaveAccessibleName(/2\+ unread/u);
  await dialog.getByRole("button", { name: "Load older notifications", exact: true }).click();
  await expect(dialog.locator(".notification-row")).toHaveCount(3);
  await dialog.getByRole("combobox", { name: "App", exact: true }).selectOption("dns");
  await expect(dialog.locator(".notification-row")).toHaveCount(1);
  await expect(dialog.getByRole("article")).toContainText("Page link set");
  state.fail = true;
  await dialog.getByRole("button", { name: "Refresh notifications", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("last verified activity");
  await expect(dialog.getByRole("article")).toContainText("Page link set");
  await expect(dialog.getByRole("heading", { name: "No notifications yet", exact: true })).toHaveCount(0);
  await expectNoSignature(page, state);
});

test("snapshot conflicts preserve the old page until explicit refresh", async ({ page }) => {
  const state = await notificationsFixture(page); state.secondPage = "conflict";
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await dialog.getByRole("button", { name: "Load older notifications", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/snapshot|refresh/iu);
  await expect(dialog.locator(".notification-row")).toHaveCount(2);
  state.secondPage = null;
  await dialog.getByRole("button", { name: "Refresh notifications", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /older activity|older notifications/u })).toHaveCount(0);
});

test("opening an exact Code notification preserves the Mail draft and never signs", async ({ page }) => {
  const state = await notificationsFixture(page);
  state.notifications = [item(0, { app: "code", label: "Source committed", target: { workspace: "code", txid: CODE_REPO, version: CODE_VERSION } })];
  await page.goto("/?folder=inbox"); await connect(page);
  await page.getByRole("button", { name: "Compose", exact: true }).first().click();
  await page.getByLabel("To", { exact: true }).fill(OTHER_ADDRESS);
  await page.getByLabel("Subject", { exact: true }).fill("Preserve notification draft");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Unsent exact bytes.  \n");
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "Open record", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`folder=code.*repo=${CODE_REPO}.*version=${CODE_VERSION}`));
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Mail", exact: true }).click();
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Preserve notification draft");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("Unsent exact bytes.  \n");
  await expectNoSignature(page, state);
});

test("mark all read includes older history but preserves late indexed activity as unread", async ({ page }) => {
  const state = await notificationsFixture(page);
  state.secondPage = [item(2, { label: "Older action", firstSeenAt: "2026-10-01T00:00:00Z" })];
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await dialog.getByRole("button", { name: "Mark all read", exact: true }).click();
  await dialog.getByRole("button", { name: "Load older notifications", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "Read: Older action", exact: true })).toBeVisible();
  state.notifications.unshift(item(3, { label: "Newly indexed action", maxEventId: 101 }));
  state.secondPage = null;
  await dialog.getByRole("button", { name: "Refresh notifications", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "Unread: Newly indexed action", exact: true })).toBeVisible();
  await expect(dialog.getByRole("article", { name: "Read: Message received", exact: true })).toBeVisible();
  await expectNoSignature(page, state);
});

test("compound transaction shows each action qualification and exact Q16 evidence", async ({ page }) => {
  const state = await notificationsFixture(page);
  const action = item(0, { app: "work", kind: "token-transfer", label: "WORK transfer", status: "invalid",
    evidence: { protocol: "pwt1", valid: false, applied: false, chainStatus: "confirmed",
      reason: "Transfer not applied", qualification: { valid: false, source: "fixture" },
      amounts: { amountSubatoms: "90071992547409931234567890123456" } },
    target: { workspace: "search", txid: TX[0] } });
  state.notifications = [item(0, { actions: [item(0), action] })];
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await expect(dialog.locator(".notification-row")).toHaveCount(1);
  await dialog.locator(".notification-evidence > summary").click();
  await dialog.locator(".notification-action-evidence > summary").filter({ hasText: "WORK transfer" }).click();
  const evidence = dialog.locator(".notification-action-evidence").filter({ hasText: "WORK transfer" });
  await expect(evidence).toContainText("Invalid action");
  await expect(evidence).toContainText("90071992547409931234567890123456");
  await expect(evidence).toContainText("Transfer not applied");
  await evidence.getByRole("button", { name: "Open this action", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`folder=search.*q=${TX[0]}.*status=all.*valid=all`));
  await expectNoSignature(page, state);
});

test("outgoing filter includes directed companion actions without relabeling shared-input cards", async ({ page }) => {
  const state = await notificationsFixture(page);
  const raw = { ...rawItem(0, "Shared-input transaction"), direction: "related", actorAddress: null };
  state.notifications = [item(0, { label: "Shared-input credit purchase", direction: "related", actorAddress: null,
    actions: [item(0, { app: "wallet", kind: "token-sale", label: "Credit purchase", direction: "self" }), raw] }),
    item(1, { label: "Other incoming message", direction: "incoming" })];
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await expect(dialog.locator(".notification-row")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Outgoing", exact: true }).click();
  await expect(dialog.locator(".notification-row")).toHaveCount(1);
  const row = dialog.getByRole("article", { name: "Unread: Shared-input credit purchase", exact: true });
  await expect(row).toBeVisible();
  await expect(row.locator(".notification-row-meta").first()).toContainText("Related activity");
  await expect(dialog.getByRole("article", { name: "Unread: Other incoming message", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "All", exact: true }).click();
  await expect(dialog.locator(".notification-row")).toHaveCount(2);
  await expectNoSignature(page, state);
});

test("Boost notification opens a record outside the feed and can be dismissed", async ({ page }) => {
  const state = await notificationsFixture(page);
  const detailRequests = [];
  await page.route("**/api/v1/boost?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("detail")) detailRequests.push(url.searchParams.get("detail"));
    return route.fulfill({ json: { network: "livenet", complete: true, mode: "detail", snapshotId: "boost-fixture-snapshot", items: [], totalCount: 0, hasMore: false, nextCursor: null,
      ...(url.searchParams.has("detail") ? { post: { authorAddress: OTHER_ADDRESS, confirmed: true, createdAt: NOW,
        kind: "boost-post", txid: url.searchParams.get("detail"), text: "Exact historical Boost",
        proofSignalQ8: "54600000000", totalSignalQ8: "54600000000", likeCount: 0, replyCount: 0, reboostCount: 0 } } : {}) } });
  });
  state.notifications = [item(0, { app: "boost", label: "Reply received", target: { workspace: "boost", txid: TX[2] } })];
  await page.goto("/?folder=inbox"); await connect(page); const dialog = await open(page);
  await dialog.getByRole("button", { name: "Open record", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Boost detail", exact: true });
  await expect(detail).toContainText("Exact historical Boost");
  expect(detailRequests).toContain(TX[2]);
  await detail.getByRole("button", { name: "Close Boost detail", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(page).not.toHaveURL(/detail=/u);
  await expectNoSignature(page, state);
});

test("Publish notification changes the exact article while already in Publish", async ({ page }) => {
  const state = await notificationsFixture(page);
  const details = [];
  await page.route("**/api/v1/boost?**", async route => {
    const url = new URL(route.request().url());
    const txid = url.searchParams.get("detail");
    if (txid) details.push(txid);
    return route.fulfill({ json: { network: "livenet", complete: true, mode: "detail", snapshotId: "publish-fixture-snapshot",
      items: [], totalCount: 0, hasMore: false, nextCursor: null,
      ...(txid ? { post: { authorAddress: OTHER_ADDRESS, confirmed: true, createdAt: NOW, kind: "boost-post", txid,
        text: `Historical article ${txid}`, proofSignalQ8: "54600000000", totalSignalQ8: "54600000000",
        likeCount: 0, replyCount: 0, reboostCount: 0 } } : {}) } });
  });
  state.notifications = [item(0, { app: "publish", target: { workspace: "publish", txid: TX[2] } })];
  await page.goto(`/?folder=publish&article=${TX[1]}`); await connect(page);
  await expect.poll(() => details.includes(TX[1])).toBe(true);
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "Open record", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`folder=publish.*article=${TX[2]}`));
  await expect.poll(() => details.includes(TX[2])).toBe(true);
  await expect(page.getByRole("region", { name: "Published article", exact: true })).toContainText(TX[2]);
  await expectNoSignature(page, state);
});

test("a blocked workspace handoff keeps notifications unread and explains the guard", async ({ page }) => {
  const state = await notificationsFixture(page);
  await page.goto(`/?folder=code&repo=${CODE_REPO}`); await connect(page);
  await page.evaluate(() => window.addEventListener("proofofwork:before-code-writer-leave", event => event.preventDefault()));
  const dialog = await open(page);
  await dialog.getByRole("article", { name: "Unread: Message received", exact: true }).getByRole("button", { name: "Open record", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/workspace|notifications/iu);
  await expect(dialog.getByRole("article", { name: "Unread: Message received", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`folder=code&repo=${CODE_REPO}`));
  await expectNoSignature(page, state);
});

for (const layout of ["Focus", "Desktop"]) for (const viewport of [{ width: 320, height: 568 }, { width: 960, height: 400 }, { width: 1440, height: 1000 }]) {
  test(`${layout} notifications fit ${viewport.width}x${viewport.height} with keyboard access`, async ({ page }) => {
    const state = await notificationsFixture(page);
    await page.setViewportSize(viewport);
    await page.goto("/?folder=inbox");
    await page.getByRole("group", { name: "Computer layout", exact: true }).getByRole("button", { name: layout, exact: true }).click();
    const theme = layout === "Focus" ? "Light" : "Dark";
    await page.getByRole("button", { name: /^Appearance:/u }).click();
    await page.getByRole("menuitemradio", { name: theme, exact: true }).click();
    await connect(page); const dialog = await open(page);
    await expect(dialog.locator(".notification-row")).toHaveCount(2);
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await dialog.locator(".notification-evidence summary").first().click();
    await expect(dialog.locator(".notification-evidence").first()).toContainText(TX[0]);
    await dialog.getByRole("button", { name: "Close notifications", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    await mkdir("/tmp/pow-notifications-qa", { recursive: true });
    await page.screenshot({ path: `/tmp/pow-notifications-qa/${layout.toLowerCase()}-${viewport.width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Notifications/u })).toBeFocused();
    await expectNoSignature(page, state);
  });
}
