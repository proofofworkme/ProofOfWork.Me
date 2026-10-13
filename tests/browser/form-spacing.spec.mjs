import { expect, test } from "@playwright/test";

const APPEARANCE_KEY = "proofofwork-me-appearance-v1";
const LAYOUT_KEY = "proofofwork-me-computer-layout-v1";
const cases = [
  { width: 320, theme: "light" }, { width: 320, theme: "dark" },
  { width: 1440, theme: "light" }, { width: 1440, theme: "dark" },
];

async function fixture(page, { width, theme, layout = "focus" }) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript(({ theme, layout, appearanceKey, layoutKey }) => {
    localStorage.setItem(appearanceKey, theme);
    localStorage.setItem(layoutKey, layout);
    window.formSpacingSignatures = 0;
    const refuse = async () => { window.formSpacingSignatures++; throw new Error("Form layout checks cannot sign or broadcast"); };
    window.unisat = { getAccounts: async () => [], requestAccounts: async () => [],
      getNetwork: async () => "livenet", on() {}, removeListener() {},
      signPsbt: refuse, signMessage: refuse, pushPsbt: refuse, pushTx: refuse };
  }, { theme, layout, appearanceKey: APPEARANCE_KEY, layoutKey: LAYOUT_KEY });
  const writes = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/test-api(?=\/api\/)/u, "");
    if (!/^\/api\//u.test(path)) return route.continue();
    if (route.request().method() !== "GET") { writes.push(route.request().url()); return route.abort("blockedbyclient"); }
    if (path === "/api/v1/code-repositories") return route.fulfill({ json: {
      network: "livenet", complete: true, source: "proof-indexer-exact-canonical-code-replay",
      indexedThroughBlock: 970546, indexedThroughBlockHash: "a".repeat(64),
      snapshot: { id: "form-spacing-code", checkpointHeight: 970546, checkpointHash: "a".repeat(64) },
      repositories: [], pagination: { total: 0, limit: 30, hasMore: false, nextCursor: null },
    } });
    return route.fulfill({ status: 503, json: { error: "Form fixture has no verified data for this read" } });
  });
  return writes;
}

async function assertGroupedField(input, ownerSelector) {
  await expect(input).toBeVisible();
  await input.focus();
  await expect(input).toHaveCSS("border-left-width", "0px");
  await expect(input).toHaveCSS("border-right-width", "0px");
  await expect(input).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(input).toHaveCSS("outline-style", "none");
  const geometry = await input.evaluate((element, selector) => {
    const owner = element.closest(selector); const style = getComputedStyle(element); const parentStyle = getComputedStyle(owner);
    const rect = element.getBoundingClientRect(); const parent = owner.getBoundingClientRect();
    return { height: rect.height, left: rect.left + parseFloat(style.paddingLeft) - parent.left - parseFloat(parentStyle.borderLeftWidth),
      right: parent.right - parseFloat(parentStyle.borderRightWidth) - rect.right + parseFloat(style.paddingRight),
      border: parentStyle.borderLeftWidth, outline: parentStyle.outlineStyle, outlineWidth: parentStyle.outlineWidth,
      outlineColor: parentStyle.outlineColor, focusColor: getComputedStyle(document.documentElement).getPropertyValue("--focus-outline").trim(),
      fontSize: parseFloat(style.fontSize), outside: rect.left < parent.left || rect.right > parent.right };
  }, ownerSelector);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.left, `${ownerSelector} text left inset`).toBeGreaterThanOrEqual(8);
  expect(geometry.right, `${ownerSelector} text right inset`).toBeGreaterThanOrEqual(8);
  expect(geometry.border).toBe("1px");
  expect(geometry.outline).toBe("solid");
  expect(geometry.outlineWidth).toBe("2px");
  expect(geometry.outside).toBe(false);
  expect(geometry.fontSize).toBeGreaterThanOrEqual(14);
}

async function assertSafe(page, writes) {
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => window.formSpacingSignatures)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const sample of cases) {
  test(`Boost composer and search text have space in ${sample.theme} at ${sample.width}px`, async ({ page }, testInfo) => {
    const writes = await fixture(page, sample);
    await page.goto("/?boost=1");
    if (sample.width <= 600) await page.getByRole("button", { name: "Create Boost", exact: true }).click();
    const input = sample.width <= 600
      ? page.getByRole("dialog", { name: "What’s happening?" }).getByRole("textbox", { name: "Boost text", exact: true })
      : page.locator(".boost-inline-draft textarea");
    const draft = "A clear first line.\nKeep the next line and trailing spaces.  ";
    await input.fill(draft);
    if (sample.width > 600) await expect(input).toHaveCSS("padding", "12px");
    else {
      expect(await input.evaluate(element => parseFloat(getComputedStyle(element).paddingLeft))).toBeGreaterThanOrEqual(12);
    }
    await expect(input).toHaveCSS("font-size", sample.width <= 860 ? "16px" : "14px");
    const body = await input.evaluate(element => {
      const style = getComputedStyle(element);
      return { contentHeight: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize) };
    });
    expect(body.lineHeight).toBeGreaterThanOrEqual(body.fontSize * 1.5);
    expect(body.contentHeight).toBeGreaterThanOrEqual(body.lineHeight * 2);
    await page.screenshot({ path: testInfo.outputPath("boost-filled-composer.png") });
    if (sample.width > 600) await page.getByRole("button", { name: "Review Boost", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "What’s happening?" });
    await expect(composer.getByRole("textbox", { name: "Boost text", exact: true })).toHaveValue(draft);
    await expect(composer.getByRole("button", { name: "Post", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(composer).toHaveCount(0);
    if (sample.width <= 600) await page.getByRole("button", { name: "Create Boost", exact: true }).click();
    await expect(input).toHaveValue(draft);
    await page.goto("/?boost=1&mode=search");
    const search = page.getByRole("textbox", { name: "Search Boost", exact: true });
    await search.fill("Readable #proofs");
    await assertGroupedField(search, ".boost-search");
    await expect(search).toHaveValue("Readable #proofs");
    await assertSafe(page, writes);
  });
}

for (const surface of ["public", "focus", "desktop"]) for (const sample of cases) {
  test(`Browser address ${surface} uses one boundary in ${sample.theme} at ${sample.width}px`, async ({ page }, testInfo) => {
    const writes = await fixture(page, { ...sample, layout: surface === "desktop" ? "desktop" : "focus" });
    await page.goto(surface === "public" ? "/?browser=1" : "/?folder=browser");
    const address = page.getByLabel("Transaction ID or .pow name", { exact: true });
    const exact = "abcdef0123456789".repeat(4);
    await address.fill(exact);
    await assertGroupedField(address, ".browser-address");
    await expect(address).toHaveCSS("font-size", sample.width <= 860 ? "16px" : "14px");
    await page.getByRole("button", { name: /^Appearance: /u }).click();
    const nextTheme = sample.theme === "light" ? "Dark" : "Light";
    await page.getByRole("menuitemradio", { name: nextTheme, exact: true }).click();
    await expect(address).toHaveValue(exact);
    await assertGroupedField(address, ".browser-address");
    await page.screenshot({ path: testInfo.outputPath("browser-filled-address.png") });
    await assertSafe(page, writes);
  });
}

for (const sample of cases) {
  test(`equivalent grouped fields retain spacing and focus in ${sample.theme} at ${sample.width}px`, async ({ page }) => {
    const writes = await fixture(page, sample);
    const fields = [
      { url: "/?desktop=1", name: "Public address or confirmed ID", owner: ".desktop-search" },
      { url: "/?search-app=1", name: "Search the Computer", owner: ".search-query-box" },
      { url: "/?code=1", name: "Filter loaded repositories", owner: ".code-filter" },
      { url: "/?jobs=1", name: "Search jobs", owner: ".jobs-search > label" },
    ];
    for (const field of fields) {
      await page.goto(field.url);
      const input = page.getByLabel(field.name, { exact: true });
      await input.fill("An unsent value");
      await assertGroupedField(input, field.owner);
      await expect(input).toHaveValue("An unsent value");
      await assertSafe(page, writes);
    }
  });
}
