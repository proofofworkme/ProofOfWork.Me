import { expect, test } from "@playwright/test";
import { composerAppearance } from "../fixtures/composerGeometry.mjs";

const address = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const txid = "a".repeat(64);

for (const surface of ["boost", "publish"]) {
  for (const embedded of [false, true]) {
    for (const theme of ["light", "dark"]) {
      test(`${surface} retained history keeps its identity warning through refresh: ${embedded ? "Computer" : "standalone"} ${theme}`, async ({ page }, testInfo) => {
        const width = theme === "light" ? 1440 : 390;
        await page.setViewportSize({ width, height: 900 });
        await composerAppearance(page, theme);
        await page.route("**/api/v1/**", async route => {
          if (route.request().method() !== "GET") return route.abort("blockedbyclient");
          const url = new URL(route.request().url());
          if (url.pathname !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [] } });
          if (url.searchParams.get("fresh") === "1") return route.fulfill({ status: 503,
            json: { error: "Current identity checkpoint is unavailable.", details: { code: "BOOST_HISTORY_UNAVAILABLE" } } });
          const item = { authorAddress: address, authorDisplay: address, confirmed: true,
            createdAt: "2026-10-18T12:00:00Z", kind: "boost-post", txid,
            text: "Exact retained article title", proofSignalQ8: "54600000000", totalSignalQ8: "54600000000",
            ...(surface === "publish" ? { article: { v: 1, title: "Exact retained article title",
              source: "same-tx-pwm1-message", size: 5, sha256: "b".repeat(64) },
            articleVerification: "canonical-same-tx-pwm1-message-v1" } : {}) };
          return route.fulfill({ json: { complete: true, snapshotId: "retained-history",
            indexedThroughBlock: 972027, indexedThroughBlockHash: "c".repeat(64), network: "livenet",
            indexedAt: item.createdAt, items: [item], totalCount: 1, hasMore: false, start: 0,
            provenance: { identityRegistry: { model: "boost-address-only-retained-history-v1",
              status: "unavailable", reason: "registry-checkpoint-ahead-of-retained-history" } } } });
        });
        await page.goto(`/?${embedded ? `folder=${surface}` : `${surface}=1`}`);
        const workspace = page.locator(".boost-public-app");
        const post = workspace.getByTestId("boost-post");
        await expect(post).toBeVisible();
        await expect(post).toContainText("Exact retained article title");
        const warning = workspace.locator(".app-status-degraded");
        await expect(warning).toContainText("Showing confirmed history through block 972,027.");
        await expect(warning).toContainText("Current ID labels are unavailable");
        await warning.getByRole("button", { name: "Show full status" }).click();
        await expect(warning).toContainText("Actions still require fresh verification.");
        await expect(post.locator(`a[href*="profile=${address}"]`).first()).toBeVisible();
        const refresh = workspace.getByRole("button", { name: "Refresh", exact: true }).last();
        await refresh.click();
        await expect(workspace.locator(".app-status-primary")).toContainText("Current identity checkpoint is unavailable.");
        await expect(warning).toContainText("Current ID labels are unavailable");
        await expect(post).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        await page.screenshot({ path: testInfo.outputPath("retained-history.png"), fullPage: true });
      });
    }
  }
}
