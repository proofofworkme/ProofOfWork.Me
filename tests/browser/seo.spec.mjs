import { expect, test } from "@playwright/test";
import { PUBLIC_SEO_SURFACES, resolvePageMetadata } from "../../src/app/seoMetadata.mjs";

const flags = { landing: "landing", "id-launch": "id-launch", "dns-launch": "dns-launch", desktop: "desktop", browser: "browser", pages: "pages", boost: "boost", publish: "publish", search: "search-app", code: "code", jobs: "jobs", permission: "permission-app", marketplace: "marketplace", token: "credit", wallet: "wallet", work: "work", infinity: "infinity", inception: "inception", log: "log", growth: "growth" };

async function unavailablePublicReads(page) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (/^\/(?:test-api\/)?api\//u.test(url.pathname)) return route.fulfill({ status: 503, json: { error: "Fixture: public evidence unavailable" } });
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort("blockedbyclient");
    return route.continue();
  });
}

for (const surface of PUBLIC_SEO_SURFACES) {
  test(`${surface.label} keeps its own metadata after the application loads`, async ({ page }) => {
    await unavailablePublicReads(page);
    const route = flags[surface.surface] ? `/?${flags[surface.surface]}=1` : "/";
    await page.goto(route);
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page).toHaveTitle(surface.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", surface.description);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", surface.title);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", surface.title);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${surface.origin}/`);
    await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(1);
    await expect(page.locator('head title')).toHaveCount(1);
  });
}

test("Computer history uses safe workspace labels and clears public root metadata", async ({ page }) => {
  await unavailablePublicReads(page);
  await page.goto("/");
  await expect(page.locator(".topbar")).toBeVisible();
  await page.evaluate(() => history.pushState({}, "", "/?folder=drafts&subject=Never%20publish%20this"));
  await expect(page).toHaveTitle("Drafts | ProofOfWork Computer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(0);
  await expect(page.locator("head")).not.toContainText("Never publish this");
  await page.goBack();
  await expect(page).toHaveTitle(resolvePageMetadata("computer", "https://computer.proofofwork.me/").title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://computer.proofofwork.me/");
  await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(1);
});

test("writer and arbitrary search URLs do not inherit indexable root metadata", async ({ page }) => {
  await unavailablePublicReads(page);
  await page.goto("/write?publish=1");
  await expect(page).toHaveTitle("Write an article | ProofOfWork Publish");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.goto("/?search-app=1&q=Private%20query&status=pending");
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('script[data-proof-seo="structured-data"]')).toHaveCount(0);
  await expect(page).not.toHaveTitle(/Private query/);
});
