import { expect, test } from "@playwright/test";

const ADDRESS = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const ID = "armyofyouth";
const NOW = "2026-09-05T07:00:00.000Z";

function fixtureItems() {
  return Array.from({ length: 18 }, (_, index) => ({
    authorAddress: ADDRESS,
    authorId: ID,
    confirmed: true,
    createdAt: NOW,
    eventId: `fixture-event-${index}`,
    kind: "boost-post",
    likeCount: 0,
    media: null,
    proofSignalQ8: "54600000000",
    proofSignalSats: 546,
    profile: { id: ID, name: `${ID}@proofofwork.me`, profileId: ID },
    replyCount: 0,
    text: `Scroll fixture post ${index + 1}.\n\nThis deliberately long timeline item keeps the document taller than the viewport so the page-level scroll contract is observable.`,
    totalSignalQ8: "54600000000",
    txid: `${(index + 1).toString(16).padStart(64, "0")}`,
  }));
}

async function installFixtures(page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/boost") {
      return route.fulfill({ json: { records: [], listings: [], stats: { total: 0 } } });
    }
    const profile = url.searchParams.has("profile");
    const items = fixtureItems();
    return route.fulfill({
      json: {
        complete: true,
        end: items.length,
        hasMore: false,
        indexedAt: NOW,
        items,
        mode: profile ? "profile" : "timeline",
        network: "livenet",
        nextCursor: "",
        profileSubject: profile
          ? {
              address: ADDRESS,
              followerCount: 0,
              followingCount: 0,
              id: ID,
              name: `${ID}@proofofwork.me`,
              profile: { id: ID, name: `${ID}@proofofwork.me`, profileId: ID },
              query: ADDRESS,
              totalSignalQ8: "54600000000",
            }
          : undefined,
        profileTabs: profile
          ? { boosts: items.length, replies: 0, purchased: 0, likes: 0, "replies-to": 0 }
          : undefined,
        signalStats: {
          proofSignalQ8: "982800000000",
          totalSignalQ8: "982800000000",
          totalSignalUsd: 0,
          workSignalSubatoms: "0",
        },
        snapshotId: "fixture-snapshot",
        start: 0,
        stats: { confirmed: items.length, pending: 0, total: items.length },
        totalCount: items.length,
      },
    });
  });
}

for (const profile of [false, true]) {
  test(`standalone ${profile ? "profile" : "timeline"} uses one page-level vertical scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installFixtures(page);
    await page.goto(`/?boost=1${profile ? `&profile=${ADDRESS}` : ""}`);
    await expect(page.locator(".boost-post")).toHaveCount(18);

    const geometry = await page.evaluate(() => {
      const scrollContainers = [...document.querySelectorAll("*")]
        .filter((element) => {
          if (element === document.documentElement || element === document.body) return false;
          const style = getComputedStyle(element);
          return ["auto", "scroll"].includes(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 1;
        })
        .map((element) => ({
          className: element.className,
          height: element.clientHeight,
          scrollHeight: element.scrollHeight,
          tagName: element.tagName,
        }));
      return {
        bodyOverflow: getComputedStyle(document.body).overflowY,
        documentHeight: document.documentElement.scrollHeight,
        nestedScrollContainers: scrollContainers,
        pageScrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
        viewportHeight: window.innerHeight,
      };
    });

    expect(geometry.pageScrollable).toBe(true);
    expect(geometry.bodyOverflow).not.toBe("hidden");
    expect(geometry.nestedScrollContainers).toEqual([]);
    await expect(page.locator(".app-header-stack")).toHaveCSS("position", "sticky");
  });
}
