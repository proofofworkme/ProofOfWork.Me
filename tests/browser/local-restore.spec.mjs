import { expect, test } from "@playwright/test";

const CONTACTS = "proofofwork.contacts.v1";
const FOLDERS = "proofofwork.customFolders.v1";
const contact = { address: "1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x", network: "livenet", name: "Saved contact" };
function file(data) {
  return { name: "review-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "ProofOfWork.Me", version: 1, data })) };
}
async function open(page) {
  await page.route("**/api/v1/**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"read fixture unavailable"}' }));
  await page.addInitScript(({ key, folders, contact }) => {
    localStorage.setItem(key, JSON.stringify([contact])); localStorage.setItem(folders, '[]'); localStorage.setItem("unrelated", "preserve");
  }, { key: CONTACTS, folders: FOLDERS, contact });
  await page.goto("/");
}
test("Import previews replacements, ignores unsupported keys, and cancellation writes nothing", async ({ page }) => {
  await open(page);
  const before = await page.evaluate(key => localStorage.getItem(key), CONTACTS);
  await page.locator('.backup-file-input').setInputFiles(file({ [CONTACTS]: '[]', unrelated: 'overwrite', "proofofwork.theme.v1": '"light"' }));
  const preview = page.getByRole("dialog", { name: "Review local restore" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("Current: 1 record", { exact: true })).toBeVisible();
  await expect(preview.getByText(/2 unsupported keys ignored/)).toBeVisible();
  await expect(preview.getByText("Keep current group", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), CONTACTS)).toBe(before);
  await preview.getByRole("button", { name: "Keep current data" }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), CONTACTS)).toBe(before);
});
test("Approved restore replaces only previewed supported groups", async ({ page }) => {
  await open(page);
  await page.locator('.backup-file-input').setInputFiles(file({ [CONTACTS]: '[]', unrelated: 'overwrite' }));
  await page.getByRole("dialog").getByRole("button", { name: "Replace listed local groups" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), CONTACTS)).toBe('[]');
  expect(await page.evaluate(key => localStorage.getItem(key), FOLDERS)).toBe('[]');
  expect(await page.evaluate(() => localStorage.getItem("unrelated"))).toBe("preserve");
});
test("Restore rejects stale previews and malformed supported data before writing", async ({ page }) => {
  await open(page);
  await page.locator('.backup-file-input').setInputFiles(file({ [CONTACTS]: '[]' }));
  await page.evaluate(key => localStorage.setItem(key, '[{"name":"changed"}]'), CONTACTS);
  await page.getByRole("dialog").getByRole("button", { name: "Replace listed local groups" }).click();
  await expect(page.getByRole("alert")).toContainText("Local data changed after this preview");
  expect(await page.evaluate(key => localStorage.getItem(key), CONTACTS)).toBe('[{"name":"changed"}]');
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator('.backup-file-input').setInputFiles(file({ [CONTACTS]: '{}' }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), CONTACTS)).toBe('[{"name":"changed"}]');
});

test("Restore preview contains keyboard focus and reflows a large draft inventory", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await open(page);
  const data = { [CONTACTS]: '[]' };
  for (let index = 0; index < 80; index++) data[`proofofwork.draft.v1:livenet:${'long-address-'.repeat(6)}${index}`] = '{"memo":"fixture"}';
  await page.locator('.backup-file-input').setInputFiles(file(data));
  const preview = page.getByRole("dialog");
  await expect(preview.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(preview.getByRole("button", { name: "Replace listed local groups" })).toBeFocused();
  await expect(preview.getByRole("listitem")).toHaveCount(25);
  await preview.getByRole("button", { name: "Next groups" }).click();
  await expect(preview.getByRole("status")).toContainText("Groups 26–50");
  const geometry = await preview.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  await page.screenshot({ path: "/tmp/pow-batch-two-restore-320.png" });
  await page.keyboard.press("Escape"); await expect(preview).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("proofofwork.draft.v1:")).length)).toBe(0);
});
