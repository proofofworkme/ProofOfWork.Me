#!/usr/bin/env node
// Render every current identity asset from the same font-independent vector.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = new URL("../", import.meta.url);
const output = resolve(process.argv[2] || new URL("public/brand/20261011/", root).pathname);
await mkdir(output, { recursive: true });
const source = await readFile(new URL("src/assets/proof-mark.svg", root), "utf8");
const mark = source.match(/<path\b[^>]+\/>/u)?.[0].replace('stroke="#000"', 'stroke="currentColor"');
if (!mark) throw new Error("Missing canonical ProofOfWork mark");
const svg = (size, background, color, inset = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="ProofOfWork.Me">
  <rect width="${size}" height="${size}" fill="${background}"/>
  <g color="${color}" transform="translate(${inset} ${inset}) scale(${(size - inset * 2) / 32})">${mark}</g>
</svg>\n`;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="ProofOfWork.Me">
  <style>:root{color:#242424}@media(prefers-color-scheme:dark){:root{color:#f1f1ef}}</style>
  ${mark}
</svg>\n`;
await writeFile(resolve(output, "favicon.svg"), favicon);
await writeFile(resolve(output, "social-logo.svg"), svg(1200, "#f7f7f5", "#242424", 240));
const browser = await chromium.launch({ channel: process.env.POW_PLAYWRIGHT_CHANNEL || "chrome" });
try {
  for (const [name, size, background, color, inset] of [
    ["favicon.png", 64, "#f7f7f5", "#242424", 0],
    ["apple-touch-icon.png", 180, "#242424", "#f7f7f5", 30],
    ["proofofwork-logo.png", 512, "none", "#242424", 0],
    ["social-logo.jpg", 1200, "#f7f7f5", "#242424", 240],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg(size, background, color, inset)}`);
    await page.screenshot({ path: resolve(output, name), omitBackground: true, ...(name.endsWith(".jpg") ? { quality: 95 } : {}) });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`Brand assets rendered to ${output}`);
