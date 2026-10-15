import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Opt in only after the bounded live checker has supplied exact public evidence.
test("built Publish no-JavaScript article and directory visual matrix", async ({ browser }) => {
  test.skip(process.env.POW_PUBLISH_SSR_VISUAL !== "1", "Requires an explicitly selected built candidate and verified public article report.");
  test.setTimeout(180_000);
  const evidence = JSON.parse(await readFile(process.env.POW_PUBLISH_SSR_REPORT, "utf8"));
  const article = evidence.articles[1] ?? evidence.articles[0];
  expect(evidence.failed).toBe(0);
  expect(article).toBeTruthy();
  const origin = process.env.POW_UI_BASE_URL;
  expect(origin).toBe(evidence.origin);
  const output = process.env.POW_PUBLISH_SSR_VISUAL_OUTPUT;
  await mkdir(output, { recursive: true });
  const metrics = [];
  for (const width of [320, 390, 1280]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 }, colorScheme: theme });
    const external = [];
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage();
    for (const kind of ["article", "directory"]) {
      const response = await page.goto(`${origin}/${kind === "article" ? `?article=${article.txid}` : "articles"}`, { waitUntil: "load" });
      expect(response.status()).toBe(200);
      await page.evaluate(() => document.fonts.ready);
      const measurements = await page.evaluate(() => {
        const main = document.getElementById("publish-server-content"), heading = main.querySelector("h1"), body = main.querySelector("[data-publish-exact-body]");
        return { viewport: innerWidth, viewportHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight, contentBottom: main.getBoundingClientRect().bottom + scrollY,
          background: getComputedStyle(document.body).backgroundColor,
          color: getComputedStyle(main).color, fontFamily: getComputedStyle(body ?? main).fontFamily,
          fonts: [...document.fonts].filter(font => font.family.includes("Inter")).map(font => ({ family: font.family, status: font.status })),
          heading: heading.textContent, headingWhiteSpace: getComputedStyle(heading).whiteSpace,
          title: document.title, body: body?.textContent,
          targets: [...main.querySelectorAll("nav a, summary, ol h2 a, a[rel=next]")].map(link => ({ text: link.textContent, height: link.getBoundingClientRect().height, width: link.getBoundingClientRect().width })),
          links: [...main.querySelectorAll("a")].map(link => link.href),
        };
      });
      const { body, ...publicMeasurements } = measurements;
      if (kind === "article") {
        publicMeasurements.bodyBytes = Buffer.byteLength(body);
        publicMeasurements.bodySha256 = createHash("sha256").update(body).digest("hex");
      }
      const screenshot = `${kind}-${width}-${theme}.png`;
      await page.screenshot({ path: join(output, screenshot), fullPage: true });
      metrics.push({ kind, width, theme, screenshot, ...publicMeasurements, externalRequests: [...external] });
    }
    await context.close();
  }
  await writeFile(join(output, "no-js-visual-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  for (const item of metrics) {
    expect.soft(item.scrollWidth, `${item.kind}/${item.width}/${item.theme} overflow`).toBeLessThanOrEqual(item.width + 1);
    expect.soft(item.scrollHeight, `${item.kind} has no empty application viewport below the content`).toBeLessThanOrEqual(Math.max(item.viewportHeight, Math.ceil(item.contentBottom)) + 1);
    expect.soft(item.fontFamily).toContain("Inter Variable");
    expect.soft(item.fonts.some(font => font.status === "loaded"), "A self-hosted Inter font is actually loaded").toBeTruthy();
    expect.soft(item.targets.every(target => target.height >= 44), `${item.kind} native navigation targets`).toBeTruthy();
    expect.soft(item.headingWhiteSpace).toBe("normal");
    expect.soft(item.background).toBe(item.theme === "dark" ? "rgb(33, 33, 33)" : "rgb(247, 247, 245)");
    expect.soft(item.externalRequests).toEqual([]);
    if (item.kind === "article") {
      expect.soft(item.bodySha256).toBe(article.sha256); expect.soft(item.bodyBytes).toBe(article.size);
      expect.soft(item.heading).toBe(article.title); expect.soft(item.title).toBe(`${article.title} | ProofOfWork Publish`);
    } else expect.soft(item.links).toContain(article.canonicalUrl);
  }
});
