import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { rolldown } from "rolldown";

// Render the actual receipt and shared dialog from source with supplied
// post-broadcast data. No production test hook, wallet, signing or API exists
// in this component fixture; transaction admission is tested separately.
let bundle;
let styles;
const receipt = { kind: "credit", assetLabel: "WORK", amountLabel: "0.0000000000000001 WORK",
  priceSats: 25000, txid: "a".repeat(64), listingId: "b".repeat(64),
  buyerAddress: "bc1q" + "c".repeat(58), sellerAddress: "bc1q" + "d".repeat(58), network: "livenet" };
test.beforeAll(async () => {
  const source = await readFile("src/App.tsx", "utf8");
  const parsed = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["MarketplacePurchaseReceiptModal", "marketplacePurchaseTweetUrl"];
  const functions = names.map(name => {
    const node = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    if (!node) throw new Error(`Missing actual receipt dependency: ${name}`);
    return node.getText(parsed);
  }).join("\n");
  const input = resolve("__purchase_receipt_fixture.tsx");
  const build = await rolldown({ input, plugins: [{ name: "actual-receipt-fixture",
    resolveId: id => id === input ? id : null,
    load: id => id === input ? { moduleType: "tsx", code: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { ArrowUpRight, Send } from "lucide-react";
      import { ReviewDialog } from "./src/shared/components/ReviewDialog";
      import { explorerTxUrl } from "./src/shared/bitcoin/networks";
      ${functions}
      function Fixture() {
        const [open, setOpen] = useState(false);
        const [removed, setRemoved] = useState(false);
        window.removeReceiptOpener = () => setRemoved(true);
        window.openReceipt = () => setOpen(true);
        return <><main>{!removed && <button onClick={() => setOpen(true)}>Open broadcast receipt</button>}
          <button>Refresh marketplace</button>
          <input aria-label="Preserved draft" defaultValue="keep this draft" /></main>
          <MarketplacePurchaseReceiptModal receipt={open ? ${JSON.stringify(receipt)} : undefined} onClose={() => setOpen(false)} />
        </>;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    ` } : null }], define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  try { bundle = (await build.generate({ format: "iife" })).output.find(file => file.type === "chunk").code; }
  finally { await build.close(); }
  const inter = (await readFile("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")).toString("base64");
  const mono = (await readFile("node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2")).toString("base64");
  styles = (await Promise.all(["src/styles.css", "src/interface.css"].map(file => readFile(file, "utf8")))).join("\n") + `
@font-face { font-family: 'Inter Variable'; font-weight: 100 900; src: url(data:font/woff2;base64,${inter}); }
@font-face { font-family: 'IBM Plex Mono'; font-weight: 400; src: url(data:font/woff2;base64,${mono}); }`;
});

for (const theme of ["light", "dark"]) for (const viewport of [{ width: 320, height: 480 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`Purchase receipt: ${theme} ${viewport.width}px exact evidence and modal lifecycle`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const requests = [];
    await page.route("**/*", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/__purchase-receipt") return route.fulfill({ contentType: "text/html", body: `<html data-theme="${theme}"><body><div id="root"></div><script>${bundle.replace(/<\/script/gu, "<\\/script")}</script></body></html>` });
      requests.push(route.request().url()); return route.abort();
    });
    await page.goto("/__purchase-receipt");
    await page.addStyleTag({ content: styles });
    await page.evaluate(() => document.fonts.ready);
    const opener = page.getByRole("button", { name: "Open broadcast receipt", exact: true });
    const dialog = page.getByRole("dialog", { name: "Credit purchase broadcast", exact: true });
    for (const dismissal of ["Escape", "button"]) {
      await opener.click();
      await expect(dialog).toBeVisible();
      const close = dialog.getByRole("button", { name: "Close purchase receipt", exact: true });
      await expect(close).toBeFocused();
      await expect(dialog).toContainText("Confirmation is pending.");
      for (const value of [receipt.amountLabel, receipt.txid, receipt.listingId, receipt.buyerAddress, receipt.sellerAddress]) {
        const field = dialog.getByText(value, { exact: true });
        await expect(field).toBeVisible();
        expect(await field.evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          return selection.toString();
        })).toBe(value);
      }
      await close.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("link", { name: "Post on X", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      }
      await page.getByLabel("Preserved draft").evaluate(node => node.focus());
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      for (const control of await dialog.locator("button, a").all()) {
        const box = await control.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      }
      if (dismissal === "Escape") {
        await page.screenshot({ path: testInfo.outputPath("receipt.png") });
        await page.keyboard.press("Escape");
      } else await close.click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(page.getByLabel("Preserved draft")).toHaveValue("keep this draft");
    }
    await opener.click();
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.removeReceiptOpener());
    await expect(opener).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh marketplace", exact: true })).toBeFocused();
    // The Buy control can also disappear in the same render that opens the receipt.
    await page.evaluate(() => { document.activeElement.blur(); window.openReceipt(); });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh marketplace", exact: true })).toBeFocused();
    expect(requests).toEqual([]);
  });
}
