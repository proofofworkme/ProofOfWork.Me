import { expect, test } from "@playwright/test";

const address = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const txid = "a".repeat(64);
const exact = "4,802,340,515,477.67622546 proofs";
async function fixture(page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [] } });
    const item = { authorAddress: address, authorId: "armyofyouth", confirmed: true,
      createdAt: "2026-09-26T12:00:00Z", kind: "boost-post", txid,
      text: "Building the ProofOfWork Computer. Every post carries a proof you can inspect.",
      proofSignalQ8: "480234051547767622546", totalSignalQ8: "480234051547767622546",
      likeCount: 3, replyCount: 2, reboostCount: 1, followerCount: 22 };
    await route.fulfill({ json: { complete: true, items: [item], totalCount: 1, hasMore: false,
      network: "livenet", indexedAt: "2026-09-26T12:00:00Z", stats: { total: 1, confirmed: 1, pending: 0 },
      signalStats: { totalSignalQ8: item.totalSignalQ8, proofSignalQ8: item.proofSignalQ8, workSignalSubatoms: "0" },
      ...(url.searchParams.has("profile") ? { mode: "profile", profileSubject: { address, id: "armyofyouth", name: "armyofyouth@proofofwork.me", followerCount: 22, followingCount: 6, totalSignalQ8: item.totalSignalQ8 }, profileTabs: { boosts: 1, replies: 0, purchased: 0, likes: 3, "replies-to": 0 } } : {}) } });
  });
}

for (const width of [320, 390, 960, 1440]) {
  test(`social feed keeps evidence accessible and fits ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await fixture(page);
    await page.goto("/?boost=1");
    const post = page.getByTestId("boost-post");
    await expect(post).toBeVisible();
    const signal = post.locator(".boost-post-head-actions [title]").first();
    await expect(signal).toHaveAttribute("title", exact);
    await expect(signal).toHaveText("4.80T proofs");
    await expect(post.locator(".boost-proof-record")).toBeHidden();
    await post.locator(".boost-proof-details > summary").click();
    await expect(post.locator(".boost-proof-record")).toContainText(txid);
    await expect(post.locator(".boost-signal-row")).toContainText(exact);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await post.locator(".boost-proof-details > summary").press("Enter");
    await expect(post.locator(".boost-proof-record")).toBeHidden();
    await post.getByLabel("More Boost actions").click();
    await expect(post.getByRole("link", { name: "TX", exact: true })).toHaveAttribute("href", new RegExp(txid));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await post.getByLabel("More Boost actions").click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    if (width < 1120) await expect(page.locator(".boost-discovery-content")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("feed.png"), fullPage: true });
    await page.getByRole("textbox", { name: "Boost text", exact: true }).fill("A draft worth proving.");
    await page.getByRole("button", { name: "Review Boost", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "What’s happening?" });
    await expect(composer.getByRole("textbox", { name: "Boost text" })).toHaveValue("A draft worth proving.");
    await composer.getByText("Preview Boost", { exact: true }).click();
    await expect(composer.locator(".boost-composer-preview p")).toHaveText("A draft worth proving.");
    await expect(composer.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
    await expect(composer.getByRole("button", { name: "Connect to post" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto(`/?boost=1&profile=${address}`);
    await expect(page.locator(".boost-profile-copy h2")).toContainText("armyofyouth");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath("profile.png"), fullPage: true });
  });
}

test("owner asset controls still open the tools drawer without signing", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  await page.addInitScript((walletAddress) => {
    const refuse = async () => { throw new Error("UI verification cannot sign"); };
    window.unisat = { getAccounts: async () => [walletAddress], requestAccounts: async () => [walletAddress],
      getNetwork: async () => "livenet", on() {}, removeListener() {}, signPsbt: refuse, signMessage: refuse, pushTx: refuse };
  }, address);
  await fixture(page);
  await page.goto("/?boost=1");
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).click();
  const post = page.getByTestId("boost-post");
  await post.getByLabel("More Boost actions").click();
  await post.getByRole("button", { name: "List", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "Boost tools" });
  await expect(tools.getByRole("spinbutton", { name: "Price proofs" })).toBeVisible();
  await tools.getByRole("button", { name: "Close listing" }).click();
  await page.keyboard.press("Escape");
  await post.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(tools.getByRole("textbox", { name: "New owner address or ID" })).toBeVisible();
  await expect(tools).toContainText("546 proofs");
  await page.keyboard.press("Escape");
  await expect(tools).toHaveCount(0);
});
