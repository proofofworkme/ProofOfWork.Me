import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JOBS_ACTIVATION_HEIGHT, JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH, JOBS_V2_ACTIVATION_HEIGHT, JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../src/shared/protocol/jobs.mjs";
import { PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH, PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH } from "../../src/shared/protocol/permissions.mjs";

// AppLink is pure route data. Load the actual TypeScript definition rather than
// duplicating a public route list that can silently miss a newly added app.
const linksSource = await readFile(new URL("../../src/app/appLinks.ts", import.meta.url), "utf8");
const { APP_LINKS } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpile(linksSource, { module: ts.ModuleKind.ESNext })).toString("base64")}`);
const navigationSource = await readFile(new URL("../../src/features/computer/computerNavigation.ts", import.meta.url), "utf8");
const navigationDefinition = navigationSource.split("export const COMPUTER_APPS:")[1]?.split("const MAIL_WORKSPACES:")[0];
const COMPUTER_APPS = [...(navigationDefinition ?? "").matchAll(/workspace: "([^"]+)", label: "([^"]+)"/gu)].map(([, workspace, label]) => ({ workspace, label }));
if (!COMPUTER_APPS.length) throw new Error("The canonical Computer app inventory could not be read.");

const PUBLIC_ROOTS = {
  Home: ".landing-app", IDs: ".id-launch-app", DNS: ".id-launch-app", Computer: ".computer-shell",
  Desktop: ".desktop-public-app", Browser: ".browser-public-app", Pages: ".pages-public-app",
  Boost: ".boost-public-app", Publish: ".publish-public-app", Search: ".search-standalone-app",
  Code: ".code-app", Jobs: ".jobs-app", Permission: ".permission-app", AMO: ".marketplace-app",
  Credit: ".token-public-app", Wallet: ".token-wallet-public-app", WORK: ".token-public-app",
  Infinity: ".token-wallet-public-app", Inception: ".token-wallet-public-app",
  Log: ".activity-public-app", Growth: ".growth-public-app",
};
const WORKSPACE_ROOTS = {
  Mail: ".mail-layout", Files: ".files-workspace", Desktop: ".desktop-workspace", Browser: ".browser-window",
  Pages: ".pages-workspace", Boost: ".boost-embedded-app", Publish: ".publish-public-app", Search: ".search-embedded-app",
  Code: ".code-workspace", Jobs: ".jobs-workspace", Permission: ".permission-workspace",
  IDs: ".ids-workspace", DNS: ".dns-workspace", AMO: ".marketplace-workspace",
  Credit: ".token-workspace", Wallet: ".token-wallet-workspace", WORK: ".token-workspace",
  Infinity: ".token-wallet-workspace", Inception: ".token-wallet-workspace", Log: ".activity-workspace", Contacts: ".contacts-workspace",
};
const routes = [
  ...APP_LINKS.map(app => ({ ...app, surface: "public", root: PUBLIC_ROOTS[app.label], layout: "focus" })),
  ...["focus", "desktop"].flatMap(layout => COMPUTER_APPS.map(app => ({ ...app,
    surface: `Computer ${layout}`, localHref: `/?folder=${app.workspace}`, layout, root: WORKSPACE_ROOTS[app.label] }))),
];
for (const route of routes) if (!route.root) throw new Error(`Add a rendered-root check for the canonical ${route.label} app.`);
const VIEWPORTS = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1440, height: 900 }];
const THEMES = ["light", "dark"];
const ADDRESS = "1FvyAqqELFiQyaEWdhFbWF8MZapKPZS8J7";
const FOREIGN = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const HASH = "a".repeat(64);
const NOW = "2026-10-10T16:00:00.000Z";
const id = n => n.toString(16).padStart(64, "0");
const SOURCE = "# Verified source\n\nExact source bytes and trailing spaces.  \n";
const file = { path: "README.md", txid: id(2), size: Buffer.byteLength(SOURCE), sha256: createHash("sha256").update(SOURCE).digest("hex") };
const repo = { txid: id(1), repoTxid: id(1), name: "Interface fixture repository", description: "Verified source for the product matrix",
  ownerAddress: ADDRESS, headTxid: file.txid, fileCount: 1, commitCount: 1 };
const codeEvidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-code-replay",
  indexedThroughBlock: 970546, indexedThroughBlockHash: HASH, snapshot: { id: "interface-code", checkpointHeight: 970546, checkpointHash: HASH } };
const jobHeight = Math.max(JOBS_V2_ACTIVATION_HEIGHT, JOBS_ACTIVATION_HEIGHT);
const jobsEvidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-jobs-replay",
  indexedThroughBlock: jobHeight, indexedThroughBlockHash: HASH,
  snapshot: { id: "interface-jobs", checkpointHeight: jobHeight, checkpointHash: HASH },
  activationHeight: JOBS_ACTIVATION_HEIGHT, activationPreviousBlockHash: JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH,
  versions: { supported: [1, 2], current: 2, v2ActivationHeight: JOBS_V2_ACTIVATION_HEIGHT,
    v2ActivationPreviousBlockHash: JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH, v2Ready: true } };
const job = { txid: id(3), title: "Interface fixture work", brief: "Original scope", scope: "Deliver exact source and inspectable evidence.",
  rewardSats: "1234567", offeredRewardSats: "1234567", requesterAddress: ADDRESS, workerAddress: FOREIGN,
  status: "open", headTxid: id(3), paidSats: "0", proposalTxid: "", assignmentTxid: "", deliveryTxid: "", acceptanceTxid: "", paymentTxid: "",
  blockHeight: jobHeight, blockHash: HASH, blockTransactionIndex: 0, blockTime: 1791648000 };
const permissionHeight = Math.max(PERMISSION_ACTIVATION_HEIGHT + 2, PERMISSION_FEE_RATE_ACTIVATION_HEIGHT + 2, 100);
const grant = { txid: id(4), rootTxid: id(4), headTxid: id(4), walletAddress: ADDRESS, label: "Interface fixture permission",
  policy: { signingEnabled: true, allowedActions: ["mail.send", "boost.post"], maxTransactionProofs: "5000", dailyLimitProofs: "30000", maxMinerFeeProofs: "1000", allowedRecipients: null, workLimits: null },
  status: "active", blockHeight: permissionHeight - 1, blockHash: HASH, blockTransactionIndex: 1 };
const permissionEvidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-permission-replay",
  coverage: { complete: true, indexedThroughBlock: permissionHeight, checkpointHash: HASH,
    activationHeight: PERMISSION_ACTIVATION_HEIGHT, witnessSha256: "c".repeat(64) },
  admission: { ready: PERMISSION_ACTIVATION_HEIGHT > 0, writesEnabled: true,
    activationHeight: PERMISSION_ACTIVATION_HEIGHT, activationPreviousBlockHash: PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH,
    minimumSelfPaymentProofs: "546", autonomousSigningEnabled: false, supportedRecordVersions: [1, 2], feeRatePolicyReady: true,
    feeRateActivationHeight: PERMISSION_FEE_RATE_ACTIVATION_HEIGHT, feeRateActivationPreviousBlockHash: PERMISSION_FEE_RATE_ACTIVATION_PREVIOUS_BLOCK_HASH },
  budget: { available: false, reason: "protected-controller-required" } };
const record = { id: "interface-record", txid: id(5), protocol: "pwm1", kind: "message", status: "confirmed", valid: true,
  validationErrors: [], title: "Interface fixture evidence", excerpt: "Exact public evidence with a readable large proof value.",
  amountSats: "9007199254740993", dataBytes: 186, blockHeight: 970546, blockHash: HASH, blockIndex: 4,
  timestamp: NOW, participants: [{ address: ADDRESS, role: "sender" }], refs: [], source: { vout: 0, ordinal: 0 } };
const searchCoverage = { ready: true, checkpointHeight: 970546, checkpointHash: HASH, indexVersion: "search-v1", lastIndexedAt: NOW,
  sourceCounts: { protocolEvents: 1, attachments: 0 }, byProtocol: { pwm1: { total: 1, confirmed: 1, valid: 1, invalid: 0 } }, kinds: ["message"] };
const articleBody = "A readable article about inspectable work.\n\nExact trailing whitespace.  \n";
const article = { v: 1, title: "Interface fixture article", source: "same-tx-pwm1-message", size: Buffer.byteLength(articleBody), sha256: createHash("sha256").update(articleBody).digest("hex") };
const boost = { txid: id(6), authorAddress: ADDRESS, authorId: "fixture", confirmed: true, createdAt: NOW, kind: "boost-post",
  text: "Interface fixture post with an exact proof signal.", proofSignalQ8: "480234051547767622546", totalSignalQ8: "480234051547767622546", likeCount: 3, replyCount: 2, reboostCount: 1 };
const message = { txid: id(7), confirmed: true, network: "livenet", from: FOREIGN, to: ADDRESS, amountSats: 546,
  createdAt: NOW, memo: "Interface fixture attachment", replyTo: FOREIGN,
  attachment: { name: "interface-fixture.txt", mime: "text/plain", size: file.size, sha256: file.sha256,
    data: Buffer.from(SOURCE).toString("base64url") } };

async function fixtures(page, layout) {
  const writes = [];
  await page.addInitScript(({ address, layout }) => {
    let connected = false;
    window.interfaceSignatures = 0;
    localStorage.setItem("proofofwork-me-computer-layout-v1", layout);
    window.unisat = { getAccounts: async () => connected ? [address] : [], requestAccounts: async () => { connected = true; return [address]; },
      getChain: async () => ({ enum: "BITCOIN_MAINNET" }), getNetwork: async () => "livenet", on() {}, removeListener() {},
      signPsbt: async () => { window.interfaceSignatures++; throw new Error("Interface fixtures must never sign"); } };
  }, { address: ADDRESS, layout });
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    // The optional local API proxy is a known HTTP prefix, not a Vite module.
    if (!/^\/(?:test-api\/)?api\//u.test(url.pathname)) return route.continue();
    url.pathname = url.pathname.replace(/^\/test-api(?=\/api\/)/u, "");
    if (request.method() !== "GET") { writes.push(`${request.method()} ${url.pathname}`); return route.abort("blockedbyclient"); }
    const fulfill = json => route.fulfill({ json });
    if (url.pathname === "/api/v1/code-repositories") return fulfill({ ...codeEvidence, repositories: [repo], pagination: { total: 1, limit: 30, hasMore: false, nextCursor: null } });
    if (url.pathname === "/api/v1/code-repository") return fulfill({ ...codeEvidence, repository: repo, version: file.txid,
      files: [file], filesComplete: true, commits: [], events: [], pagination: { total: 0, limit: 30, hasMore: false, nextCursor: null },
      ...(url.searchParams.has("path") ? { file: { ...file, content: SOURCE, contentBase64: Buffer.from(SOURCE).toString("base64") } } : {}) });
    if (url.pathname === "/api/v1/jobs") return fulfill({ ...jobsEvidence, jobs: [job], pagination: { total: 1, limit: 30, hasMore: false, nextCursor: null }, stats: { paidProofs: "0", paidWorkSubatoms: "0" } });
    if (url.pathname === "/api/v1/job") return fulfill({ ...jobsEvidence, job, events: [], proposals: [], deliveries: [], eventsComplete: true, proposalsComplete: true, deliveriesComplete: true });
    if (url.pathname === "/api/v1/permissions") return fulfill({ ...permissionEvidence, permissions: [grant], pagination: { total: 1, hasMore: false } });
    if (url.pathname === "/api/v1/permission") return fulfill({ ...permissionEvidence, permission: grant, currentPermission: grant, currentStatusVerified: true, events: [], eventsComplete: true });
    if (url.pathname === "/api/v1/search") return fulfill({ network: url.searchParams.get("network") || "livenet", q: url.searchParams.get("q") || "", results: [record], coverage: searchCoverage,
      pagination: { limit: 25, returned: 1, total: 1, nextCursor: null, hasMore: false } });
    if (url.pathname === "/api/v1/search/detail") return fulfill({ network: "livenet", record, payload: { exactAmountSats: record.amountSats },
      rawPayload: "pwm1:m:inspectable evidence", evidence: { blockHash: HASH, outputIndex: 0 }, coverage: searchCoverage });
    if (url.pathname === "/api/v1/boost") {
      const post = url.searchParams.get("format") === "article" ? { ...boost, text: article.title, article, articleVerification: "canonical-same-tx-pwm1-message-v1" } : boost;
      return fulfill({ network: "livenet", indexedAt: NOW, complete: true, snapshotId: "interface-boost", items: [post], totalCount: 1, hasMore: false, start: 0,
        ...(url.searchParams.has("detail") ? { mode: "detail", post: { ...post, articleBody } } : {}) });
    }
    if (url.pathname.endsWith(`/address/${ADDRESS}/mail`)) return fulfill({ address: ADDRESS, network: "livenet", inboxMessages: [message], sentMessages: [],
      historyCoverage: { complete: true, model: "proof-index-address-mail-complete-v1" } });
    if (url.pathname.endsWith("/utxo")) return fulfill([]);
    if (url.pathname === "/api/v1/fees/recommended") return fulfill({ fastestFee: 1, halfHourFee: 1, hourFee: 1, minimumFee: 0.1 });
    // Missing authoritative fixtures are explicitly unavailable. Dense finance,
    // DNS, browser/runtime and receipt fixtures remain covered by their behavior suites.
    return route.fulfill({ status: 503, json: { error: "Interface fixture read unavailable" } });
  });
  return writes;
}

async function populate(page, route) {
  if (route.label === "Code") {
    await page.getByRole("button", { name: repo.name, exact: true }).click();
    await page.getByRole("button", { name: /^README\.md(?: \d+ B)?$/u }).click();
    await expect(page.getByLabel("Exact source text")).toHaveText(SOURCE);
  } else if (route.label === "Jobs") {
    await page.getByRole("button", { name: job.title, exact: true }).click();
    await expect(page.getByText("1,234,567 proofs", { exact: true }).first()).toBeVisible();
  } else if (route.label === "Permission") {
    await page.getByRole("button", { name: grant.label, exact: true }).click();
    await expect(page.getByLabel("Confirmed permission terms", { exact: true })).toContainText("AGENT_DAILY_LIMIT_PROOFS=30000");
  } else if (route.label === "Search") {
    await expect(page.getByRole("button", { name: record.title, exact: true })).toBeVisible();
  } else if (route.label === "Boost" || route.label === "Publish") {
    await expect(page.getByTestId("boost-post").first()).toBeVisible();
  } else if (route.surface !== "public" && ["Mail", "Files"].includes(route.label)) {
    await page.locator(".topbar-wallet-button").click();
    await expect(page.getByText(route.label === "Files" ? "interface-fixture.txt" : "Interface fixture attachment", { exact: true }).first()).toBeVisible();
  }
}

async function interfaceEvidence(page, rootSelector) {
  return page.evaluate(async rootSelector => {
    const root = document.querySelector(rootSelector);
    const visible = element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && !element.closest('[aria-hidden="true"]'); };
    const color = value => {
      if (value === "transparent") return [0, 0, 0, 0];
      const rgb = value.match(/^rgba?\(([^)]+)\)$/u);
      if (rgb) { const parts = rgb[1].replace("/", " ").split(/[\s,]+/u).filter(Boolean).map(Number); return [...parts.slice(0, 3), parts[3] ?? 1]; }
      const srgb = value.match(/^color\(srgb ([^)]+)\)$/u);
      if (srgb) { const parts = srgb[1].replace("/", " ").split(/\s+/u).map(Number); return [...parts.slice(0, 3).map(n => n * 255), parts[3] ?? 1]; }
      const hex = value.match(/^#([a-f\d]{3}|[a-f\d]{6})$/iu)?.[1];
      const expanded = hex?.length === 3 ? [...hex].map(digit => digit.repeat(2)).join("") : hex;
      return expanded ? [0, 2, 4].map(start => parseInt(expanded.slice(start, start + 2), 16)).concat(1) : null;
    };
    const blend = (front, back) => { const a = front[3] + back[3] * (1 - front[3]); return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / a).concat(a); };
    const background = element => { const layers = []; for (let current = element; current; current = current.parentElement) { const parsed = color(getComputedStyle(current).backgroundColor); if (parsed) layers.push(parsed); }
      return layers.reverse().reduce((back, front) => blend(front, back), [255, 255, 255, 1]); };
    const luminance = rgb => rgb.slice(0, 3).map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (front, back) => { const a = luminance(blend(front, back)); const b = luminance(back); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
    const description = element => `${element.tagName.toLowerCase()}.${typeof element.className === "string" ? element.className : ""} ${(element.textContent || element.getAttribute("aria-label") || "").replace(/\s+/gu, " ").slice(0, 75)}`;
    const targetOffenders = [...document.querySelectorAll('button, [role="button"], input:not([type="hidden"]), select, textarea, summary, a[href]')].filter(visible).flatMap(element => {
      let measured = element;
      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) measured = [...(element.labels ?? [])].find(visible) ?? element;
      const rect = measured.getBoundingClientRect();
      return rect.width >= 43.5 && rect.height >= 43.5 ? [] : [{ element: description(measured), width: rect.width, height: rect.height }];
    });
    const textOffenders = [...document.querySelectorAll('h1, h2, h3, h4, p, label, .field-note, .status-text, .brand span, button:not(:disabled), a.primary')]
      .filter(element => visible(element) && element.textContent.trim() && !element.closest("iframe, pre, code") && !element.closest(":disabled"))
      .flatMap(element => { const style = getComputedStyle(element); const parsed = color(style.color); const bg = background(element); const ratio = parsed ? contrast(parsed, bg) : 0;
        const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
        return ratio + 0.02 >= (large ? 3 : 4.5) ? [] : [{ element: description(element), foreground: style.color, background: bg, contrast: ratio }]; });
    // These established fields own one boundary around a borderless input.
    // Ordinary form controls must still distinguish their own boundary/fill.
    const fieldOwner = element => {
      const style = getComputedStyle(element);
      const borderless = parseFloat(style.borderTopWidth) === 0 || style.borderTopStyle === "none";
      return borderless ? element.closest(".computer-app-search-field, .code-filter, .boost-search, .search-query-box") ?? element : element;
    };
    const controls = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), select, textarea')]
      .filter(element => visible(element) && !element.matches(":disabled"));
    const controlOffenders = controls.flatMap(element => {
      const owner = fieldOwner(element); const style = getComputedStyle(owner); const edge = color(style.borderTopColor); const outside = background(owner.parentElement);
      const edgeRatio = edge && parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none" ? contrast(edge, outside) : 0;
      const fillRatio = contrast(background(owner), outside);
      return Math.max(edgeRatio, fillRatio) + 0.02 >= 3 ? [] : [{ element: description(element), owner: description(owner), edge: style.borderTopColor, contrast: edgeRatio, fillContrast: fillRatio }];
    });
    const priorFocus = document.activeElement;
    const activeModal = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
    const wrapperFocusOffenders = [];
    for (const element of controls) {
      const owner = fieldOwner(element);
      // A native modal makes the visible background implicitly inert.
      if (owner === element || (activeModal && !activeModal.contains(element))) continue;
      const initial = getComputedStyle(owner).borderTopColor;
      element.focus({ preventScroll: true });
      // Reduced motion still permits the legacy 0.01ms transition. Measure the
      // painted focus state, rather than its synchronous transition start.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const style = getComputedStyle(owner); const outside = background(owner.parentElement);
      const outline = color(style.outlineColor); const edge = color(style.borderTopColor);
      const outlineVisible = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 && outline && contrast(outline, outside) + 0.02 >= 3;
      const changedEdgeVisible = style.borderTopColor !== initial && parseFloat(style.borderTopWidth) >= 1 && edge && contrast(edge, outside) + 0.02 >= 3;
      if (document.activeElement !== element || !(outlineVisible || changedEdgeVisible)) wrapperFocusOffenders.push({ element: description(element), owner: description(owner), outline: style.outline, edge: style.borderTopColor });
    }
    if (priorFocus instanceof HTMLElement && priorFocus !== document.body) priorFocus.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const rootStyle = getComputedStyle(root); const bodyStyle = getComputedStyle(document.body); const canvas = color(bodyStyle.backgroundColor);
    const action = color(bodyStyle.getPropertyValue("--action").trim());
    const actionText = color(bodyStyle.getPropertyValue("--text-on-action").trim());
    const primaryLinkOffenders = [...document.querySelectorAll("a.primary")].filter(visible).flatMap(element => {
      const style = getComputedStyle(element); const fill = color(style.backgroundColor); const ink = color(style.color);
      const matches = (actual, expected) => actual && expected && actual.every((value, index) => Math.abs(value - expected[index]) <= 1);
      return matches(fill, action) && matches(ink, actionText) && contrast(ink, fill) + 0.02 >= 4.5 ? [] : [{ element: description(element), fill: style.backgroundColor, ink: style.color }];
    });
    const headings = [...document.querySelectorAll("h1, h2, h3")].filter(visible).map(element => ({ element: description(element), font: getComputedStyle(element).fontFamily }));
    const fields = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(visible).flatMap(element => {
      const name = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || [...(element.labels ?? [])].map(label => label.textContent.trim()).filter(Boolean).join(" ");
      return name ? [] : [description(element)];
    });
    const header = document.querySelector(".topbar"); const headerRect = header?.getBoundingClientRect();
    const containers = [...root.querySelectorAll('.review-dialog, .search-inspector, .id-card, .token-dashboard-card, .jobs-receipt, .permission-terms, .code-source, .pages-editor, .boost-post')].filter(visible)
      .flatMap(element => { const rect = element.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1 ? [] : [{ element: description(element), left: rect.left, right: rect.right }]; });
    return { documentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), viewport: innerWidth,
      uiFont: rootStyle.fontFamily, headings, canvas, bgToken: bodyStyle.getPropertyValue("--bg").trim(), actionToken: bodyStyle.getPropertyValue("--action").trim(),
      actionTextToken: bodyStyle.getPropertyValue("--text-on-action").trim(), targetOffenders, textOffenders, controlOffenders, wrapperFocusOffenders, primaryLinkOffenders, fields, containers,
      header: headerRect ? { left: headerRect.left, right: headerRect.right, height: headerRect.height } : null };
  }, rootSelector);
}

async function checkInterface(page, route, theme, label) {
  const evidence = await interfaceEvidence(page, route.root);
  expect(evidence.documentWidth, `${label}: document overflow`).toBeLessThanOrEqual(evidence.viewport + 1);
  expect(evidence.uiFont, `${label}: interface font`).toMatch(/Inter/u);
  expect(evidence.headings.length, `${label}: rendered app headings`).toBeGreaterThan(0);
  for (const heading of evidence.headings) expect(heading.font, `${label}: ${heading.element}`).toMatch(/Inter/u);
  expect(evidence.bgToken, `${label}: shared canvas token`).not.toBe("");
  expect(evidence.actionToken, `${label}: shared primary action token`).not.toBe("");
  expect(evidence.actionTextToken, `${label}: shared primary text token`).not.toBe("");
  expect(evidence.canvas, `${label}: opaque themed canvas`).not.toBeNull();
  expect(evidence.canvas[3]).toBe(1);
  const average = evidence.canvas.slice(0, 3).reduce((sum, value) => sum + value, 0) / 3;
  if (theme === "light") expect(average, `${label}: light canvas`).toBeGreaterThan(220);
  else expect(average, `${label}: dark canvas`).toBeLessThan(55);
  expect(evidence.header, `${label}: retained shared header`).not.toBeNull();
  expect(evidence.header.left).toBeGreaterThanOrEqual(-1);
  expect(evidence.header.right).toBeLessThanOrEqual(evidence.viewport + 1);
  expect(evidence.header.height).toBeGreaterThanOrEqual(44);
  expect(evidence.fields, `${label}: persistent form labels`).toEqual([]);
  expect(evidence.targetOffenders, `${label}: 44px operable targets`).toEqual([]);
  expect(evidence.textOffenders, `${label}: actual text contrast`).toEqual([]);
  expect(evidence.controlOffenders, `${label}: distinguishable form controls`).toEqual([]);
  expect(evidence.wrapperFocusOffenders, `${label}: grouped field focus indication`).toEqual([]);
  expect(evidence.primaryLinkOffenders, `${label}: monochrome primary links with AA text`).toEqual([]);
  expect(evidence.containers, `${label}: app card containment`).toEqual([]);
}

for (const route of routes) {
  test(`${route.surface} ${route.label}: shared interface across themes and viewports`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const writes = await fixtures(page, route.layout);
    for (const theme of THEMES) for (const viewport of VIEWPORTS) {
      await test.step(`${theme} ${viewport.width}×${viewport.height}`, async () => {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.setViewportSize(viewport);
        await page.goto(route.localHref);
        await expect(page.locator(route.root).first()).toBeVisible();
        await populate(page, route);
        await page.evaluate(() => document.fonts.ready);
        if (route.surface !== "public") await expect(page.locator(".computer-shell")).toHaveAttribute("data-computer-layout", route.layout);
        await checkInterface(page, route, theme, `${route.surface} ${route.label} ${theme} ${viewport.width}px`);
        if (process.env.POW_PRODUCT_SCREENSHOTS === "1") await page.screenshot({ path: testInfo.outputPath(`${theme}-${viewport.width}.png`), fullPage: true });
      });
    }
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => window.interfaceSignatures)).toBe(0);
  });
}

for (const surface of ["public", "focus", "desktop"]) for (const theme of THEMES) {
  test(`${surface} Search inspector: ${theme} contrast, short-screen geometry and keyboard focus`, async ({ page }) => {
    await fixtures(page, surface === "desktop" ? "desktop" : "focus");
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(surface === "public" ? APP_LINKS.find(app => app.label === "Search").localHref : "/?folder=search");
    const trigger = page.getByRole("button", { name: record.title, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("9,007,199,254,740,993");
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(-1); expect(bounds.x + bounds.width).toBeLessThanOrEqual(321);
    expect(bounds.y).toBeGreaterThanOrEqual(-1); expect(bounds.y + bounds.height).toBeLessThanOrEqual(641);
    for (const key of ["Tab", "Shift+Tab", "Control+k", "Meta+k"]) {
      await page.keyboard.press(key);
      await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await expect(page.getByRole("dialog", { name: "Computer apps", exact: true })).toHaveCount(0);
    }
    await checkInterface(page, { root: surface === "public" ? ".search-standalone-app" : ".computer-shell" }, theme, `${surface} Search inspector ${theme}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const outline = await trigger.evaluate(element => { const style = getComputedStyle(element); return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }; });
    expect(outline.style).not.toBe("none"); expect(outline.width).toBeGreaterThanOrEqual(2);
  });
}
