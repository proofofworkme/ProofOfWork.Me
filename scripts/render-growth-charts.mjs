import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

// PNGs are convenient companion renders. The source SVGs, model JSON, and
// report are the deterministic artifacts enforced by repository hygiene.
const names = ["compounding", "dollar-growth", "product-split", "blockspace", "volatility"];
const executablePath = process.env.GROWTH_CHART_CHROMIUM_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : { channel: "chrome" }),
  headless: true,
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const name of names) {
    const base = `output/proofofwork-computer-model-${name}`;
    const svg = readFileSync(`${base}.svg`, "utf8");
    const dimensions = /<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/u.exec(svg);
    if (!dimensions) throw new Error(`SVG dimensions missing: ${base}`);
    await page.setViewportSize({ width: Number(dimensions[1]), height: Number(dimensions[2]) });
    await page.setContent(`<style>html,body{margin:0;padding:0;}svg{display:block;}</style>${svg}`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => {
      const svgRoot = document.querySelector("svg");
      const width = svgRoot.viewBox.baseVal.width;
      const height = svgRoot.viewBox.baseVal.height;
      return Array.from(svgRoot.querySelectorAll("text")).flatMap((element) => {
        const bounds = element.getBBox();
        return bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height
          ? [element.textContent] : [];
      });
    });
    if (overflow.length) throw new Error(`Chart text exceeds SVG bounds (${name}): ${overflow.join("; ")}`);
    await page.screenshot({ path: `${base}.png`, animations: "disabled" });
    process.stdout.write(`Rendered ${base}.png\n`);
  }
} finally {
  await browser.close();
}
