import { expect, test } from "@playwright/test";
const author = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const respondent = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const txid = "a".repeat(64), replyTxid = "b".repeat(64), actionTxid = "c".repeat(64);
const post = { txid, boostTxid: txid, authorAddress: author, authorId: "carbonz", currentOwnerAddress: author,
  confirmed: true, kind: "boost-post", createdAt: "2026-09-30T10:00:00Z", text: "A proof worth replying to.",
  totalSignalQ8: "109200000000", proofSignalQ8: "109200000000", likeCount: 1, replyCount: 1, reboostCount: 1 };
const reply = { ...post, txid: replyTxid, authorAddress: respondent, authorId: "responder", kind: "boost-reply", targetTxid: txid, text: "The reply outside the loaded feed." };
async function fixture(page, { fail = false, delay = false } = {}) {
  const queries = [];
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() !== "GET") throw new Error("Read-only tests must never sign or broadcast.");
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [] } });
    queries.push(Object.fromEntries(url.searchParams));
    const common = { complete: true, snapshotId: "fixture", hasMore: false, nextCursor: "", start: 0, network: "livenet" };
    const person = { address: respondent, id: "responder", displayName: "responder@proofofwork.me", followsViewer: true, txid: actionTxid, createdAt: post.createdAt, confirmed: true };
    if (url.searchParams.has("detail")) {
      if (fail) return route.fulfill({ status: 503, json: { error: "Social records are unavailable." } });
      if (delay) await new Promise(resolve => setTimeout(resolve, 400));
      const activity = url.searchParams.get("activity");
      return route.fulfill({ json: { ...common, mode: "detail", post, totalCount: 1,
        items: [{ ...person, eventId: activity, ...(activity === "replies" ? { post: reply } : {}) }] } });
    }
    if (url.searchParams.has("connections")) return route.fulfill({ json: { ...common, mode: "connections", totalCount: 1,
      profileSubject: { address: author, displayName: "carbonz@proofofwork.me" }, items: [person] } });
    return route.fulfill({ json: { ...common, items: [post], totalCount: 1, signalStats: { totalSignalQ8: post.totalSignalQ8, proofSignalQ8: post.proofSignalQ8 },
      ...(url.searchParams.has("profile") ? { mode: "profile", profileSubject: { address: author, id: "carbonz", displayName: "carbonz@proofofwork.me", followerCount: 1, followingCount: 1, totalSignalQ8: post.totalSignalQ8, proofSignalQ8: post.proofSignalQ8 }, profileTabs: { boosts: 1, replies: 0, purchased: 0, likes: 1, "replies-to": 0 } } : {}) } });
  });
  return queries;
}
for (const route of ["/?boost=1", `/?boost=1&profile=${author}`, "/?folder=boost"]) {
  test(`thread and engagement records are independent of the feed at ${route}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const queries = await fixture(page);
    await page.goto(route);
    await page.getByTestId("boost-post").getByText(post.text, { exact: true }).click();
    const detail = page.getByRole("dialog", { name: "Boost detail" });
    await expect(detail.getByText(reply.text, { exact: true })).toBeVisible();
    await expect(detail.getByLabel("Reply, 1 replies").last()).toBeVisible();
    await detail.getByRole("tab", { name: "Likes 1", exact: true }).click();
    await expect(detail.getByRole("link", { name: "View TX" })).toHaveAttribute("href", new RegExp(actionTxid));
    await expect(detail.getByText("responder@proofofwork.me", { exact: true }).first()).toBeVisible();
    await detail.getByRole("tab", { name: "Reboosts 1", exact: true }).click();
    await expect(detail.getByRole("link", { name: "View TX" })).toBeVisible();
    expect(queries.filter(q => q.detail).every(q => !q.profile && !q.q && !q.window)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    await page.screenshot({ path: testInfo.outputPath("activity.png") });
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
  });
}
test("profile counts open connections tabs, proof links, profile navigation and Back", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page);
  await page.goto(`/?boost=1&profile=${author}`);
  await page.getByRole("button", { name: "1 Following", exact: true }).click();
  const connections = page.getByRole("region", { name: "Profile connections" });
  await expect(connections.getByRole("tab", { name: "Following", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(connections.getByRole("link", { name: "responder", exact: true })).toHaveAttribute("href", /profile=responder/);
  await connections.getByText("Proof details", { exact: true }).click();
  await expect(connections.getByRole("link", { name: "View TX" })).toHaveAttribute("href", new RegExp(actionTxid));
  await connections.getByRole("tab", { name: "Followers", exact: true }).click();
  await expect(connections).toContainText("1 confirmed followers");
  await page.screenshot({ path: testInfo.outputPath("connections.png") });
  await connections.getByRole("button", { name: "Back to profile" }).click();
  await expect(page.locator(".boost-profile-copy h2")).toContainText("carbonz");
});
test("detail failure stays unavailable with retry, never a false empty thread", async ({ page }) => {
  await fixture(page, { fail: true });
  await page.goto("/?boost=1");
  await page.getByTestId("boost-post").getByText(post.text, { exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry from first page" })).toBeVisible();
  await expect(page.getByText("No confirmed replies yet.")).toHaveCount(0);
});
