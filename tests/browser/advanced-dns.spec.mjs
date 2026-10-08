import { expect, test } from "@playwright/test";
import { ADDRESS, OTHER_ADDRESS, HASH, PAGE_TXID, FILE_TXID, LINK_TXID, DNS_EPOCH, NOW,
  fixture, connect, expectNoSignature, dnsPageSnapshot, activeDnsPageLink } from "../fixtures/pagesFixture.mjs";
import { dnsChildPageSnapshot } from "../fixtures/dnsChildPageSnapshot.mjs";
import { parseDnsSubdomainPageLinkPayload } from "../../src/shared/protocol/dnsSubdomainPages.mjs";
import { readDnsPageLinkSnapshot } from "../../src/features/pages/dnsPageLinkClient.mjs";
import { readDnsSubdomainPageLinkSnapshot } from "../../src/features/pages/dnsSubdomainPageLinkClient.mjs";

function exactChild(root) {
  const child = root.subdomains[0];
  return { ...root, id: "app.alice", name: "app.alice.pow", parentRecord: root.record,
    record: child, records: [child], subdomains: [child], pageLink: child.subdomainPageLink,
    subdomainPageLink: child.subdomainPageLink };
}
async function advancedFixture(page) {
  const state = await fixture(page);
  const child = dnsChildPageSnapshot();
  const base = dnsPageSnapshot();
  const record = { ...base.record, ...child.parentRecord };
  const root = { ...base, indexedThroughBlock: child.indexedThroughBlock,
    checkpointHash: child.checkpointHash, record, records: [record],
    pageLinkCoverage: { ...base.pageLinkCoverage, indexedThroughBlock: child.indexedThroughBlock,
      blockCount: child.indexedThroughBlock - base.pageLinkCoverage.activationHeight + 1 },
    pageLinkAdmission: { ...base.pageLinkAdmission, indexedThroughBlock: child.indexedThroughBlock },
    subdomains: child.subdomains, subdomainEvents: child.subdomainEvents,
    subdomainCoverage: child.subdomainCoverage, subdomainAdmission: child.subdomainAdmission,
    subdomainPageLinkCoverage: child.subdomainPageLinkCoverage,
    subdomainPageLinkAdmission: child.subdomainPageLinkAdmission,
    subdomainPageLinkEvents: [], subdomainPageLinkPendingEvents: [] };
  state.dnsRoot = root;
  state.dnsRegistry = { ...root, id: undefined, name: undefined, record: undefined };
  state.dnsReply = url => /app\.alice(?:\.pow)?$/u.test(decodeURIComponent(url.pathname))
    ? exactChild(state.dnsRoot) : state.dnsRoot;
  state.pageTxids.add(FILE_TXID);
  const options = { network: "livenet", validateAddress: address => [ADDRESS, OTHER_ADDRESS].includes(address) };
  expect(readDnsPageLinkSnapshot(root, "alice.pow", options).pageLink).toBeNull();
  expect(readDnsSubdomainPageLinkSnapshot(exactChild(root), "app.alice.pow", options).pageLink.pageTxid).toBe(PAGE_TXID);
  return state;
}
async function openAdvanced(page, path = "/?dns-launch=1") {
  await page.goto(path); await connect(page);
  const card = page.getByRole("region", { name: "Advanced DNS", exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "alice.pow", exact: true })).toBeVisible();
  return card;
}
async function reviewChild(page, card, clear = false, txid = FILE_TXID) {
  await card.getByRole("button", { name: "app.alice.pow", exact: true }).click();
  await expect(card.getByRole("button", { name: "Review clear link", exact: true })).toBeEnabled();
  if (!clear) await card.getByLabel("Published page txid", { exact: true }).fill(txid);
  await card.getByRole("button", { name: clear ? "Review clear link" : "Review page link", exact: true }).click();
  const review = page.getByRole("dialog", { name: clear ? "Review .pow page unlink" : "Review .pow page link", exact: true });
  await expect(review).toBeVisible();
  return review;
}

for (const [label, path] of [["standalone", "/?dns-launch=1"], ["Computer", "/?folder=dns"]]) {
  test(`${label} Advanced DNS reads root and child Pages links from shared confirmed records`, async ({ page }) => {
    const state = await advancedFixture(page);
    const card = await openAdvanced(page, path);
    const rootRow = card.getByRole("row").filter({ has: page.getByRole("button", { name: "alice.pow", exact: true }) });
    const childRow = card.getByRole("row").filter({ has: page.getByRole("button", { name: "app.alice.pow", exact: true }) });
    await expect(rootRow).toContainText("No page link");
    await expect(childRow).toContainText(PAGE_TXID);
    await expect(childRow).toContainText("Confirmed");
    await expect(childRow.getByRole("link", { name: "Browser ↗", exact: true })).toHaveAttribute("href", /name=app\.alice\.pow/u);
    // A link published from Pages becomes visible solely when the next canonical
    // snapshot confirms it; no local bridge or successful broadcast is evidence.
    state.dnsRoot.pageLink = { ...activeDnsPageLink(), blockHeight: state.dnsRoot.indexedThroughBlock - 1 };
    await card.getByRole("button", { name: "Refresh links", exact: true }).click();
    await expect(rootRow).toContainText(PAGE_TXID);
    await expect(rootRow).toContainText("Confirmed");
    await expect(rootRow.getByRole("link", { name: "Browser ↗", exact: true })).toHaveAttribute("href", /name=alice\.pow/u);
    await expectNoSignature(page, state);
  });
}

for (const action of ["set", "replace", "clear"]) {
  test(`Advanced DNS ${action} reviews exact child identity, carrier and 546-proof self-payment before cancellation`, async ({ page }) => {
    const state = await advancedFixture(page);
    if (action === "set") state.dnsRoot.subdomains[0].subdomainPageLink = null;
    const card = await openAdvanced(page);
    await card.getByRole("button", { name: "app.alice.pow", exact: true }).click();
    if (action !== "clear") await card.getByLabel("Published page txid", { exact: true }).fill(FILE_TXID);
    await card.getByRole("button", { name: action === "clear" ? "Review clear link" : "Review page link", exact: true }).click();
    const review = page.getByRole("dialog", { name: action === "clear" ? "Review .pow page unlink" : "Review .pow page link", exact: true });
    await expect(review).toBeVisible();
    await expect(review).toContainText("app.alice.pow");
    await expect(review).toContainText("546 proofs");
    await expect(review).toContainText("546-proof self-payment");
    const payment = review.locator(".review-list").first().getByRole("listitem").first();
    await expect(payment).toContainText(ADDRESS);
    await expect(payment).toContainText("546 proofs");
    await review.getByText("Inspect exact transaction evidence", { exact: true }).click();
    const records = await review.locator(".review-protocol").allTextContents();
    expect(records).toHaveLength(2);
    expect(records[0]).toBe("pwm1:m:app.alice.pow Pages link");
    const { childLifecycle } = state.dnsRoot.subdomains[0];
    expect(parseDnsSubdomainPageLinkPayload(records[1])).toEqual({ action: action === "clear" ? "clear" : "set",
      parent: "alice", label: "app", epoch: state.dnsRoot.record.ownershipEpoch, child: childLifecycle,
      ...(action === "clear" ? {} : { pageTxid: FILE_TXID }) });
    await expectNoSignature(page, state);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expectNoSignature(page, state);
    expect(state.dnsRoot.record.receiveAddress).toBe(OTHER_ADDRESS);
  });
}

test("Advanced DNS refuses a recreated child before requesting its wallet signature", async ({ page }) => {
  const state = await advancedFixture(page);
  const card = await openAdvanced(page);
  const review = await reviewChild(page, card);
  const child = state.dnsRoot.subdomains[0];
  const changed = { ...child.childLifecycle, txid: FILE_TXID };
  child.childLifecycle = changed; child.createdTxid = changed.txid; child.txid = changed.txid; child.updatedTxid = changed.txid;
  child.subdomainPageLink.child = changed;
  Object.assign(state.dnsRoot.subdomainEvents[0], changed);
  await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
  await expect(card).toContainText("revoked or recreated");
  await expectNoSignature(page, state);
});

test("Advanced DNS rechecks the root ownership epoch before requesting a wallet signature", async ({ page }) => {
  const state = await advancedFixture(page);
  const card = await openAdvanced(page);
  await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
  await card.getByRole("button", { name: "Review page link", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review .pow page link", exact: true });
  await expect(review).toBeVisible();
  state.dnsRoot.record.ownershipEpoch = { ...DNS_EPOCH, txid: FILE_TXID };
  await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
  await expect(card).toContainText("ownership period changed");
  await expectNoSignature(page, state);
});

for (const kind of ["root", "child"]) {
  test(`Advanced DNS rejects an inconsistent unselected ${kind} link before rendering a confirmed route`, async ({ page }) => {
    const state = await advancedFixture(page);
    state.dnsRoot.pageLink = { ...activeDnsPageLink(), blockHeight: state.dnsRoot.indexedThroughBlock - 1 };
    if (kind === "root") state.dnsRoot.pageLink.ownerAddress = OTHER_ADDRESS;
    else state.dnsRoot.subdomains[0].subdomainPageLink.child = { ...DNS_EPOCH, txid: FILE_TXID };
    const card = await openAdvanced(page);
    if (kind === "root") await card.getByRole("button", { name: "app.alice.pow", exact: true }).click();
    const name = kind === "root" ? "alice.pow" : "app.alice.pow";
    const row = card.getByRole("row").filter({ has: page.getByRole("button", { name, exact: true }) });
    await expect(row).toContainText("Verification unavailable");
    await expect(row).not.toContainText(PAGE_TXID);
    await expect(row.getByRole("link")).toHaveCount(0);
    await expectNoSignature(page, state);
  });
}

test("Advanced DNS hides unverified root and child links and prevents link reviews", async ({ page }) => {
  const state = await advancedFixture(page);
  state.dnsRoot.pageLink = { ...activeDnsPageLink(), blockHeight: state.dnsRoot.indexedThroughBlock - 1 };
  state.dnsRoot.pageLinkCoverage.complete = false;
  state.dnsRoot.subdomainPageLinkCoverage.complete = false;
  const card = await openAdvanced(page);
  await expect(card.getByRole("table")).toContainText("Verification unavailable");
  await expect(card.getByRole("table")).not.toContainText(PAGE_TXID);
  await card.getByLabel("Published page txid", { exact: true }).fill(PAGE_TXID);
  await expect(card.getByRole("button", { name: "Review page link", exact: true })).toBeDisabled();
  await card.getByRole("button", { name: "app.alice.pow", exact: true }).click();
  await card.getByLabel("Published page txid", { exact: true }).fill(FILE_TXID);
  await expect(card).toContainText("subdomain page-link coverage is unavailable");
  await expect(card.getByRole("button", { name: "Review page link", exact: true })).toBeDisabled();
  await expectNoSignature(page, state);
});

for (const [label, path] of [["standalone", "/?dns-launch=1"], ["Computer", "/?folder=dns"]]) {
  test(`${label} Advanced DNS restores retained child fields for inspection and fences another account`, async ({ page }) => {
    const state = await advancedFixture(page);
    const receipt = { txid: LINK_TXID, address: ADDRESS, network: "livenet", title: "Review .pow page link",
      key: "dns-page-link:app.alice.pow", createdAt: NOW, status: "dropped",
      fields: [["DNS name", "app.alice.pow"], ["Link action", "set"], ["Pages transaction", FILE_TXID]] };
    await page.addInitScript(receipt => {
      if (window === window.top) localStorage.setItem("proofofwork-action-receipts-v1", JSON.stringify([receipt]));
    }, receipt);
    const card = await openAdvanced(page, path);
    const recovery = page.getByRole("region", { name: "Transaction recovery", exact: true });
    await recovery.locator(".action-recovery-disclosure > summary").click();
    await recovery.locator(".action-recovery-history > summary").click();
    await recovery.getByRole("button", { name: "Restore task fields", exact: true }).click();
    await expect(card.getByLabel("DNS name", { exact: true })).toHaveValue("app.alice.pow");
    await expect(card.getByLabel("Published page txid", { exact: true })).toHaveValue(FILE_TXID);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
    await expect(page.locator(".topbar-wallet-button")).toContainText("1F1p9UEH");
    await expect(card.getByLabel("DNS name", { exact: true })).toHaveValue("");
    await expect(card.getByLabel("Published page txid", { exact: true })).toHaveValue("");
    await expect(recovery).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Review page link", exact: true })).toBeDisabled();
    await expectNoSignature(page, state);
  });
}
