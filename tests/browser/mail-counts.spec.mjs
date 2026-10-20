import { expect, test } from "@playwright/test";
import { fixture, ADDRESS, OTHER_ADDRESS, NOW } from "../fixtures/pagesFixture.mjs";

for (const layout of ["Focus", "Desktop"]) test(`${layout}: known Mail counts survive unavailable scans and become verified`, async ({ page }) => {
  await fixture(page);
  const messages = ["confirmed", "confirmed", "pending"].map((status, index) => ({
    txid: String(index + 2).repeat(64), from: ADDRESS, to: OTHER_ADDRESS,
    network: "livenet", memo: `Count fixture ${index}`, status, createdAt: NOW,
    amountSats: 546, feeRate: 1,
  }));
  await page.addInitScript(messages => {
    localStorage.setItem("proofofwork.sent.v5", JSON.stringify([
      ...messages, { ...messages[0], txid: "9".repeat(64), from: messages[0].to },
      { ...messages[0], txid: "8".repeat(64), network: "testnet" },
    ]));
  }, messages);
  let available = false;
  await page.route("**/api/v1/address/*/mail*", route => available
    ? route.fulfill({ json: { address: ADDRESS, network: "livenet", inboxMessages: [],
      sentMessages: messages.slice(0, 2), historyCoverage: {
        model: "proof-index-address-mail-complete-v1", complete: true,
      } } })
    : route.fulfill({ status: 503, json: { error: "Mailbox temporarily unavailable" } }));
  await page.route("**/api/v1/tx/*/status*", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto("/?folder=sent");
  const folders = page.locator("nav.folders");
  const count = name => folders.getByRole("button", { name: new RegExp(`^${name} `) }).locator("strong");
  await expect(count("Sent")).toHaveText("—");
  await page.locator(".topbar-wallet-button").click();
  await page.getByRole("group", { name: "Computer layout", exact: true })
    .getByRole("button", { name: layout, exact: true }).click();
  await page.getByRole("button", { name: /^Appearance: /u }).click();
  await page.getByRole("menuitemradio", { name: layout === "Focus" ? "Light" : "Dark", exact: true }).click();
  await expect(count("Sent")).toHaveText("2+");
  await expect(count("Outbox")).toHaveText("1+");
  await expect(count("Inbox")).toHaveText("—");
  await expect(count("Sent")).toHaveAttribute("aria-label", "2 known items; mailbox scan incomplete");
  await page.screenshot({ path: `/tmp/mail-counts-${layout}.png`, fullPage: true });
  available = true;
  await page.locator(".list-toolbar").getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(count("Sent")).toHaveText("2");
  await expect(count("Inbox")).toHaveText("0");
  available = false;
  await page.locator(".list-toolbar").getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(count("Sent")).toHaveText("2");
  await page.evaluate(other => window.__pagesFixture.changeAccount(other), OTHER_ADDRESS);
  await expect(count("Sent")).toHaveText("1+");
  await expect(count("Outbox")).toHaveText("—");
  expect(await page.evaluate(() => window.__pagesFixture.signCalls)).toBe(0);
});
