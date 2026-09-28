import { expect, test } from "@playwright/test";

const SHARED_TXID = "a".repeat(64);
const media = {
  mime: "image/png",
  name: "shared.png",
  sha256: "b".repeat(64),
  size: 8,
  source: "same-tx-pwm1-attachment",
};
const post = (index) => ({
  authorAddress: `author-${index}`,
  confirmed: true,
  createdAt: "2026-09-28T00:00:00.000Z",
  eventId: `post-${index}`,
  kind: "boost-post",
  media,
  proofSignalQ8: "0",
  proofSignalSats: 0,
  text: `Post ${index}`,
  totalSignalQ8: "0",
  txid: String(index).repeat(64),
  boostTxid: SHARED_TXID,
  workSignalSubatoms: "0",
});

test("overlapping Boost attachment reads for the same network and txid share one GET", async ({ page }) => {
  const txReads = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/boost") {
      return route.fulfill({
        json: {
          complete: true,
          end: 2,
          hasMore: false,
          indexedAt: "2026-09-28T00:00:00.000Z",
          items: [post(1), post(2)],
          network: "livenet",
          nextCursor: "",
          signalStats: {
            proofSignalQ8: "0",
            totalSignalQ8: "0",
            totalSignalUsd: 0,
            workSignalSubatoms: "0",
          },
          snapshotId: "c".repeat(64),
          start: 0,
          totalCount: 2,
        },
      });
    }
    if (url.pathname === `/api/v1/tx/${SHARED_TXID}`) {
      txReads.push(url.pathname);
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
  });

  await page.goto("/?boost=1");
  await expect(page.locator(".boost-post")).toHaveCount(2);
  await expect.poll(() => txReads.length).toBe(1);
  expect(txReads).toEqual([`/api/v1/tx/${SHARED_TXID}`]);
});
