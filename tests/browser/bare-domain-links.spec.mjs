import { expect, test } from "@playwright/test";
const txid = "a".repeat(64), address = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
for (const embedded of [false, true]) {
  test((embedded ? "Computer" : "Boost") + " safely links bare uppercase domains without rewriting source", async ({ page }) => {
    await page.setViewportSize({ width: embedded ? 390 : 1280, height: 900 });
    const tick = String.fromCharCode(96);
    const text = "PROOFOFWORK.ME\nBoost.ProofOfWork.Me/Path?Case=Yes#part\nwww.example.com, " +
      "user@example.com javascript:example.com alice.pow\n" + tick + "$WORK example.org" + tick;
    const post = { txid, boostTxid: txid, text, kind: "boost-post", authorAddress: address,
      authorId: "creator", currentOwnerAddress: address, confirmed: true, createdAt: "2026-11-12T13:00:00Z",
      proofSignalQ8: "54600000000", totalSignalQ8: "54600000000", replyCount: 0, likeCount: 0, reboostCount: 0 };
    await page.route("**/api/v1/**", route => {
      expect(route.request().method()).toBe("GET");
      const url = new URL(route.request().url());
      return route.fulfill({ json: url.pathname === "/api/v1/boost"
        ? { complete: true, snapshotId: "domain-fixture", network: "livenet", hasMore: false,
          nextCursor: "", start: 0, items: [post], totalCount: 1, indexedAt: post.createdAt }
        : { records: [], listings: [], stats: { total: 0 } } });
    });
    await page.goto("/?" + (embedded ? "folder=boost" : "boost=1"));
    const body = page.getByTestId("boost-post").first().locator(".boost-post-text");
    await expect(body).toBeVisible({ timeout: 45000 });
    expect(await body.textContent()).toBe(text);
    const links = body.locator("a.boost-web-link");
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveText("PROOFOFWORK.ME");
    await expect(links.nth(0)).toHaveAttribute("href", "https://proofofwork.me/");
    await expect(links.nth(1)).toHaveAttribute("href", "https://boost.proofofwork.me/Path?Case=Yes#part");
    await expect(links.nth(2)).toHaveAttribute("href", "https://www.example.com/");
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    await expect(body.locator(".boost-dns-link")).toHaveCount(1);
    const initialUrl = page.url();
    await page.context().route("https://proofofwork.me/", route => route.fulfill({ contentType: "text/html", body: "Domain destination fixture" }));
    const popupReady = page.waitForEvent("popup");
    await links.first().click();
    const popup = await popupReady;
    await popup.waitForLoadState();
    expect(popup.url()).toBe("https://proofofwork.me/");
    expect(page.url()).toBe(initialUrl);
    await expect(page.getByRole("dialog", { name: "Boost detail", exact: true })).toHaveCount(0);
    await popup.close();
  });
}
