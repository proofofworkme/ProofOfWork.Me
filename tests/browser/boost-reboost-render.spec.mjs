import { expect, test } from "@playwright/test";

const ORIGINAL_TXID = "8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7";
const REBOOST_TXID = "c7f1f361d5066b56b3af144b369d199278aaada25d657550e31fdb255c3938c8";

test("reboost renders the original post instead of the target txid", async ({ page }) => {
  let ownerPaid = false;
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
            proofSignalSats: 0,
            proofSignalQ8: "0",
            actionSignalSats: 546,
            actionSignalQ8: "54600000000",
            actionSignalSatsExact: "546",
            ...(ownerPaid ? {
              signalIncrementSats: 546,
              signalIncrementQ8: "54600000000",
              signalIncrementSatsExact: "546",
            } : {}),
            reboostCount: 1,
            reboostedPost: {
              authorAddress: "original-author",
              authorId: "carbonz",
              boostTxid: ORIGINAL_TXID,
              confirmed: true,
              createdAt: "2026-09-04T07:00:00.000Z",
              kind: "boost-post",
              media: null,
              proofSignalSats: 1092,
              proofSignalQ8: "109200000000",
              text: "Incredible feat by armyofyouth@proofofwork.me!",
              totalSignalQ8: "109200000000",
              txid: ORIGINAL_TXID,
            },
            replyCount: 0,
            targetTxid: ORIGINAL_TXID,
            text: "",
            totalSignalQ8: "0",
            txid: REBOOST_TXID,
          }],
          totalCount: 1,
          hasMore: false,
          nextCursor: "",
          start: 0,
          end: 1,
          stats: { total: 1, confirmed: 1, pending: 0 },
          signalStats: {
            totalSignalQ8: "109200000000",
            proofSignalQ8: "109200000000",
            proofSignalSatsExact: "1092",
            totalSignalSatsExact: "1092",
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
  await expect(page.getByTestId("reboosted-post")).toContainText("Original Boost signal");
  await expect(page.getByTestId("reboosted-post")).toContainText("1,092 proofs");
  await expect(page.locator(".boost-post")).toContainText("reboosted");
  await expect(page.locator(".boost-post-head-actions")).toContainText("Action signal 546 proofs");
  await expect(page.locator(".boost-signal-row")).toContainText("Proof 546 proofs");
  await expect(page.locator(".boost-post")).not.toContainText("Added 546 proofs to original Boost signal");
  await page.getByRole("button", { name: "Open original Boost" }).click();
  const originalFromFeed = page.getByRole("dialog", { name: "Boost detail" });
  await expect(originalFromFeed).toContainText("Incredible feat by armyofyouth@proofofwork.me!");
  await expect(originalFromFeed.locator(".boost-post-head-actions")).toContainText("1,092 proofs");
  await page.keyboard.press("Escape");
  await page.getByTestId("boost-post").first().press("Enter");
  const expandedReboost = page.getByRole("dialog", { name: "Boost detail" });
  await expect(expandedReboost).toContainText("reboosted");
  await expandedReboost.getByRole("button", { name: "Open original Boost" }).click();
  await expect(page.getByRole("dialog", { name: "Boost detail" })).toContainText("Incredible feat by armyofyouth@proofofwork.me!");
  await expect(page.getByRole("dialog", { name: "Boost detail" }).locator(".boost-post-head-actions")).toContainText("1,092 proofs");
  await page.keyboard.press("Escape");
  await expect(page.locator(".boost-post")).not.toContainText(`reboost ${ORIGINAL_TXID}`);

  ownerPaid = true;
  await page.reload();
  await expect(page.locator(".boost-post")).toContainText("Added 546 proofs to original Boost signal");
  await expect(page.locator(".boost-post-head-actions")).toContainText("Action signal 546 proofs");

  await page.getByRole("button", { name: "Post a Boost", exact: true }).click();
  let composer = page.getByRole("dialog", { name: "What’s happening?" });
  await expect(composer).toBeVisible();
  await expect(composer.getByText("WORK signal", { exact: true })).toBeVisible();
  await expect(composer.getByText("Proof signal", { exact: true })).toBeVisible();
  await expect(composer.getByText("Attach file")).toBeVisible();
  await expect(composer).toContainText("Add Proof, WORK, or both.");
  await expect(composer.getByLabel("Proof signal")).toHaveAttribute("min", "0");
  await composer.locator('input[type="file"]').setInputFiles({
    name: "proof.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Chain-readable attachment"),
  });
  await expect(composer).toContainText("proof.txt");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "What's happening?", exact: true }).click();
  composer = page.getByRole("dialog", { name: "What’s happening?" });
  await expect(composer).toBeVisible();
  await expect(composer.locator("textarea")).toBeVisible();
  await expect(composer.getByText("WORK signal", { exact: true })).toBeVisible();
  await expect(composer.getByText("Attach file")).toBeVisible();
  const composerFeeControl = page.getByRole("dialog", { name: "What’s happening?" }).locator(".fee-control");
  await expect(composerFeeControl.getByText("Fee sat/vB")).toBeVisible();
  await expect(composerFeeControl.locator('input[type="number"]')).toHaveValue("1");
  await composerFeeControl.getByRole("button", { name: "2 sat" }).click();
  await expect(composerFeeControl.locator('input[type="number"]')).toHaveValue("2");
  await page.keyboard.press("Escape");

  await page.getByTitle("Like and add proof signal to the original Boost").click();
  const likeDialog = page.getByRole("dialog", { name: "Like Boost" });
  await expect(likeDialog).toContainText("546 proofs to the current owner");
  const likeFeeControl = likeDialog.locator(".fee-control");
  await expect(likeFeeControl.locator('input[type="number"]')).toHaveValue("2");
  await likeDialog.getByRole("button", { name: "Cancel" }).click();

  const reboostMenuButton = page.locator(".boost-reboost-action > button").first();
  await reboostMenuButton.click();
  await expect(page.getByRole("menuitem", { name: "Reboost" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Quote" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Quote" }).click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add a comment" }).locator(".fee-control")).toBeVisible();
  await expect(page.getByTestId("quoted-post")).toContainText("Quoted Boost");
  await page.keyboard.press("Escape");

  await page.getByTestId("boost-post").first().press("Enter");
  await expect(page.getByRole("dialog", { name: "Boost detail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Post your reply" })).toBeVisible();
  await page.getByRole("button", { name: "Post your reply" }).click();
  await expect(page.getByRole("dialog", { name: "Replying to Boost" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Replying to Boost" }).locator(".fee-control")).toBeVisible();
});


test("reply shows its paid action signal without adding it to feed totals", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/boost") {
      return route.fulfill({ json: {
        complete: true,
        network: "livenet",
        items: [{
          actionSignalSats: 546,
          actionSignalQ8: "54600000000",
          actionSignalSatsExact: "546",
          authorAddress: "reply-author",
          authorId: "carbonz",
          boostTxid: ORIGINAL_TXID,
          confirmed: true,
          createdAt: "2026-09-05T07:00:00.000Z",
          kind: "boost-reply",
          proofSignalSats: 0,
          proofSignalQ8: "0",
          targetTxid: ORIGINAL_TXID,
          text: "Reply proof signal",
          totalSignalQ8: "0",
          txid: "8d48127f2e2015e7366d141947b6c679c710b963549ebac78ae1479a2c429c3b",
        }],
        totalCount: 1,
        hasMore: false,
        stats: { total: 1, confirmed: 1, pending: 0 },
        signalStats: {
          totalSignalQ8: "0",
          proofSignalQ8: "0",
          proofSignalSatsExact: "0",
          totalSignalSatsExact: "0",
          totalSignalUsd: 0,
          workSignalSubatoms: "0",
        },
      } });
    }
    if (url.pathname.includes("registry") || url.pathname.startsWith("/api/v1/id/")) {
      return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/?boost=1");
  await expect(page.getByTestId("boost-post")).toContainText("Reply proof signal");
  await expect(page.locator(".boost-post-head-actions")).toContainText("Action signal 546 proofs");
  await expect(page.locator(".boost-signal-row")).toContainText("Proof 546 proofs");
});


test("Computer Boost entry buttons open the shared Proof, WORK, and Files composer", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/boost") {
      return route.fulfill({ json: {
        complete: true,
        network: "livenet",
        items: [],
        totalCount: 0,
        hasMore: false,
        stats: { total: 0, confirmed: 0, pending: 0 },
        signalStats: {
          totalSignalQ8: "0", proofSignalQ8: "0", proofSignalSatsExact: "0",
          totalSignalSatsExact: "0", totalSignalUsd: 0, workSignalSubatoms: "0",
        },
      } });
    }
    if (pathname.includes("registry") || pathname.startsWith("/api/v1/id/")) {
      return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/?folder=boost");
  await expect(page.locator(".boost-embedded-app")).toBeVisible();
  const openAndCheck = async (buttonName) => {
    await page.getByRole("button", { name: buttonName, exact: true }).click();
    const composer = page.getByRole("dialog", { name: "What’s happening?" });
    await expect(composer).toBeVisible();
    await expect(composer.getByLabel("Proof signal")).toHaveAttribute("min", "0");
    await expect(composer.getByText("WORK signal", { exact: true })).toBeVisible();
    await expect(composer.getByText("Attach file")).toBeVisible();
    await expect(composer).toContainText("Add Proof, WORK, or both.");
    const bounds = await composer.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    return composer;
  };
  let composer = await openAndCheck("Post a Boost");
  await composer.getByLabel("Proof signal").fill("0");
  await composer.getByLabel("WORK signal").fill("1");
  await composer.locator('input[type="file"]').setInputFiles({
    name: "work-proof.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("WORK-only Boost attachment"),
  });
  await expect(composer).toContainText("work-proof.txt");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "What’s happening?" })).toHaveCount(0);
  composer = await openAndCheck("What's happening?");
  await expect(composer.getByLabel("Proof signal")).toHaveValue("546");
  await expect(page.locator(".compose-pane")).toHaveCount(0);
});

test("case-equivalent Bech32 own profile never offers Follow", async ({ page }) => {
  const owner = "bc1qqyqszqgpqyqszqgpqyqszqgpqyqszqgpyfl4f3";
  const ownerAlias = owner.toUpperCase();
  await page.addInitScript(({ walletAddress }) => {
    window.unisat = {
      getAccounts: async () => [walletAddress],
      requestAccounts: async () => [walletAddress],
      getNetwork: async () => "livenet",
    };
  }, { walletAddress: owner });
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/boost") {
      return route.fulfill({ json: {
        complete: true,
        network: "livenet",
        items: [{
          authorAddress: ownerAlias,
          boostTxid: ORIGINAL_TXID,
          confirmed: true,
          createdAt: "2026-09-05T07:00:00.000Z",
          kind: "boost-post",
          proofSignalSats: 546,
          proofSignalQ8: "54600000000",
          text: "My own Boost",
          totalSignalQ8: "54600000000",
          txid: ORIGINAL_TXID,
        }],
        totalCount: 1,
        hasMore: false,
        profileSubject: {
          address: ownerAlias,
          query: ownerAlias,
          followerCount: 0,
          followingCount: 0,
        },
        stats: { total: 1, confirmed: 1, pending: 0 },
        signalStats: {
          totalSignalQ8: "54600000000", proofSignalQ8: "54600000000",
          proofSignalSatsExact: "546", totalSignalSatsExact: "546",
          totalSignalUsd: 0, workSignalSubatoms: "0",
        },
      } });
    }
    if (pathname === "/api/v1/ids/boost") {
      return route.fulfill({ json: { record: { receiveAddress: owner } } });
    }
    if (pathname === "/api/v1/registry") {
      return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`/?boost=1&profile=${ownerAlias}`);
  await expect(page.getByTestId("boost-post")).toContainText("My own Boost");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disconnect UniSat" })).toBeVisible();
  await expect(page.locator(".boost-follow-button")).toHaveCount(0);
});
