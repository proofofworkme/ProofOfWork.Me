import { expect, test } from "@playwright/test";

const ORIGINAL_TXID = "8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7";
const REBOOST_TXID = "c7f1f361d5066b56b3af144b369d199278aaada25d657550e31fdb255c3938c8";

test("reboost renders the original post instead of the target txid", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/boost") {
      return route.fulfill({
        json: {
          complete: true,
          indexedAt: "2026-09-05T07:00:00.000Z",
          network: "livenet",
          snapshotId: "fixture-snapshot",
          items: [{
            actionCount: 1,
            authorAddress: "rebooster-address",
            authorId: "armyofyouth",
            boostTxid: ORIGINAL_TXID,
            confirmed: true,
            createdAt: "2026-09-05T07:00:00.000Z",
            kind: "boost-reboost",
            likeCount: 0,
            proofSignalSats: 546,
            proofSignalQ8: "54600000000",
            reboostCount: 1,
            reboostedPost: {
              authorAddress: "original-author",
              authorId: "carbonz",
              boostTxid: ORIGINAL_TXID,
              confirmed: true,
              createdAt: "2026-09-04T07:00:00.000Z",
              kind: "boost-post",
              media: null,
              proofSignalSats: 546,
              proofSignalQ8: "54600000000",
              text: "Incredible feat by armyofyouth@proofofwork.me!",
              totalSignalQ8: "54600000000",
              txid: ORIGINAL_TXID,
            },
            replyCount: 0,
            targetTxid: ORIGINAL_TXID,
            text: "",
            totalSignalQ8: "54600000000",
            txid: REBOOST_TXID,
          }],
          totalCount: 1,
          hasMore: false,
          nextCursor: "",
          start: 0,
          end: 1,
          stats: { total: 1, confirmed: 1, pending: 0 },
          signalStats: {
            totalSignalQ8: "54600000000",
            proofSignalQ8: "54600000000",
            proofSignalSatsExact: "546",
            totalSignalSatsExact: "546",
            totalSignalUsd: 0,
            workSignalSubatoms: "0",
          },
        },
      });
    }
    if (url.pathname.includes("registry") || url.pathname.startsWith("/api/v1/id/")) {
      return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/?boost=1");
  await expect(page.getByTestId("reboosted-post")).toBeVisible();
  await expect(page.getByTestId("reboosted-post")).toContainText("carbonz@proofofwork.me");
  await expect(page.getByTestId("reboosted-post")).toContainText("Incredible feat by armyofyouth@proofofwork.me!");
  await expect(page.locator(".boost-post")).toContainText("reboosted");
  await expect(page.locator(".boost-post")).not.toContainText(`reboost ${ORIGINAL_TXID}`);
});
