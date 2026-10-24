import { expect, test } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import { createHash } from "node:crypto";

const wallet = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const owner = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH";
const workRegistry = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const workToken = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
const target = "a".repeat(64), body = "A confirmed article for the fee-control fixture.";
const article = { v: 1, title: "Choose the publication fee", source: "same-tx-pwm1-message",
  size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
const surfaces = [
  { name: "Boost", route: "/?boost=1", publish: false, embedded: false },
  { name: "Publish", route: "/?publish=1", publish: true, embedded: false },
  { name: "Computer Boost", route: "/?folder=boost", publish: false, embedded: true },
  { name: "Computer Publish", route: "/?folder=publish", publish: true, embedded: true },
];

async function fixture(page, { coins = 3, theme = "light" } = {}) {
  const entries = Array.from({ length: coins }, (_, index) => {
    const transaction = new bitcoin.Transaction();
    transaction.addInput(Buffer.alloc(32, index + 1), 0);
    transaction.addOutput(bitcoin.address.toOutputScript(wallet), 546n);
    return { transaction, utxo: { txid: transaction.getId(), vout: 0, value: 546, status: { confirmed: true } } };
  });
  const utxos = entries.map(entry => entry.utxo), mutations = [], confirmations = [];
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript(({ wallet, utxos, theme }) => {
    if (window !== window.top) return;
    localStorage.setItem("proofofwork-me-appearance-v1", theme);
    localStorage.setItem("proofofwork-me-computer-layout-v1", "focus");
    window.socialFeePsbts = [];
    window.unisat = { getAccounts: async () => [wallet], requestAccounts: async () => [wallet],
      getNetwork: async () => "livenet", getBitcoinUtxos: async () => utxos, on() {}, removeListener() {},
      signPsbt: async hex => { window.socialFeePsbts.push(hex); throw new Error("Unsigned fee fixture rejected signing"); },
      signMessage: async () => { throw new Error("Fee fixture cannot sign identity messages"); } };
  }, { wallet, utxos, theme });
  page.on("dialog", async dialog => { confirmations.push(dialog.message()); await dialog.dismiss(); });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname.replace(/^\/test-api(?=\/api\/)/u, "");
    if (path.startsWith("/api/")) {
      if (request.method() !== "GET") { mutations.push(path); return route.abort("blockedbyclient"); }
      if (path.endsWith("/utxo")) return route.fulfill({ json: utxos });
      if (path.endsWith("/hex")) {
        const entry = entries.find(entry => path.includes(entry.utxo.txid));
        return entry ? route.fulfill({ json: { hex: entry.transaction.toHex() } }) : route.fulfill({ status: 404, json: {} });
      }
      if (path.endsWith("/status")) return route.fulfill({ json: { status: "confirmed" } });
      if (path === "/api/v1/token" && url.searchParams.get("asset") === workToken) return route.fulfill({ json: {
        network: "livenet", authoritativeWallet: true, walletScoped: true,
        source: "proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state", checkpointComplete: true, listingBookComplete: true,
        indexedThroughBlock: 970555, indexedThroughBlockHash: "b".repeat(64), listings: [], closedListings: [], sales: [], transfers: [],
        holders: [{ address: wallet, tokenId: workToken, balanceSubatoms: "100000000000000000" }],
        canonicalWorkCapacities: [{ model: "canonical-work-wallet-capacity-v1", network: "livenet", address: wallet, tokenId: workToken,
          indexedThroughBlock: 970555, indexedThroughBlockHash: "b".repeat(64), confirmedBalanceSubatoms: "100000000000000000",
          reservedBalanceSubatoms: "0", transferableBalanceSubatoms: "100000000000000000", reservations: [],
          tokenStateCommitment: { model: "canonical-work-amo-payload-sha256-v1", sha256: "c".repeat(64), payloadBytes: 100 } }],
      } });
      if (path === "/api/v1/work-floor") return route.fulfill({ json: { workAmoV8: { version: "pwt-sale-v8", pinsRequested: true,
        pinsConfigured: true, protocolReady: true, writeAdmission: true,
        activation: { active: true, reached: true, tipVerified: true, evidenceComplete: true } } } });
      if (path !== "/api/v1/boost") return route.fulfill({ json: { records: [], listings: [] } });
      const post = { txid: target, boostTxid: target, authorAddress: owner, currentOwnerAddress: owner,
        confirmed: true, createdAt: "2026-10-24T12:00:00Z", kind: "boost-post", text: article.title,
        article, articleBody: body, articleVerification: "canonical-same-tx-pwm1-message-v1",
        proofSignalQ8: "54600000000", totalSignalQ8: "54600000000", likeCount: 0, replyCount: 0, reboostCount: 0, tipCount: 0 };
      const common = { complete: true, snapshotId: "social-fee-fixture", network: "livenet", hasMore: false, start: 0, indexedAt: post.createdAt };
      if (url.searchParams.has("detail")) return route.fulfill({ json: { ...common, mode: "detail", post, items: [], totalCount: 0 } });
      const items = url.searchParams.has("listings") ? [] : [post];
      return route.fulfill({ json: { ...common, items, totalCount: items.length } });
    }
    // Only the local test application may load real resources. API reads above
    // are fixtures, every mutation is blocked, and the wallet never signs.
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return route.abort("blockedbyclient");
    return route.continue();
  });
  return { entries, mutations, confirmations };
}

async function connect(page) {
  await page.getByRole("button", { name: "Connect UniSat", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Disconnect UniSat", exact: true }).first()).toBeEnabled();
}
// Playwright's initial centering can put a short-page action behind sticky
// chrome. Scroll normally into the measured free band before its ordinary click.
async function prepareMobileLikeClick(page) {
  const button = page.getByRole("button", { name: /^Like, /u }).first();
  await button.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 6; attempt++) {
    const geometry = await button.evaluate(element => {
      const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && element.contains(hit)) return { reachable: true };
      let top = 0, bottom = innerHeight;
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        if (/(auto|scroll|overlay)/u.test(getComputedStyle(ancestor).overflowY) && ancestor.scrollHeight > ancestor.clientHeight) {
          const area = ancestor.getBoundingClientRect();
          top = Math.max(top, area.top + ancestor.clientTop);
          bottom = Math.min(bottom, area.top + ancestor.clientTop + ancestor.clientHeight);
          break;
        }
      }
      const blocked = [...document.querySelectorAll("body *")].flatMap(node => {
        if (node.contains(element) || element.contains(node)) return [];
        const style = getComputedStyle(node), area = node.getBoundingClientRect();
        return ["fixed", "sticky"].includes(style.position) && style.visibility !== "hidden" && style.pointerEvents !== "none" &&
          area.width > 0 && area.height > 0 && area.left <= x && area.right >= x && area.bottom > top && area.top < bottom
          ? [[Math.max(top, area.top), Math.min(bottom, area.bottom)]] : [];
      }).sort((left, right) => left[0] - right[0]);
      const free = []; let cursor = top;
      for (const [start, end] of blocked) { if (start > cursor) free.push([cursor, start]); cursor = Math.max(cursor, end); }
      if (cursor < bottom) free.push([cursor, bottom]);
      const band = free.filter(([start, end]) => end - start >= box.height + 8)
        .sort((left, right) => (right[1] - right[0]) - (left[1] - left[0]))[0];
      return { reachable: false, x, y, targetY: band ? (band[0] + band[1]) / 2 : null };
    });
    if (geometry.reachable) return;
    expect(geometry.targetY, "Like needs a visible band between sticky chrome").not.toBeNull();
    await page.mouse.move(geometry.x, geometry.targetY);
    await page.mouse.wheel(0, Math.round(geometry.y - geometry.targetY));
    await page.waitForTimeout(80);
  }
  await expect.poll(() => button.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && element.contains(hit));
  }), { message: "Normal scrolling must expose the Like button's center" }).toBe(true);
}

async function openAction(page, action) {
  if (action === "post") {
    const desktop = page.getByRole("button", { name: "Post a Boost", exact: true });
    if (await desktop.isVisible()) await desktop.click();
    else await page.getByRole("button", { name: "Create Boost", exact: true }).click();
    const form = page.getByRole("dialog", { name: "What’s happening?", exact: true });
    await form.getByRole("textbox", { name: "Boost text", exact: true }).fill("Respect the selected fee.");
    await form.getByLabel("Proof signal", { exact: true }).fill("546");
    await form.getByLabel("WORK signal", { exact: true }).fill("0");
    return form;
  }
  if (action === "article") {
    await page.getByRole("button", { name: "Write your next article", exact: true }).click();
    const form = page.locator(".publish-composer");
    await form.getByRole("textbox", { name: "Article title", exact: true }).fill("A fractional-fee article");
    await form.getByRole("textbox", { name: "Article text", exact: true }).fill("An exact article draft at a chosen fee.");
    return form;
  }
  if (action === "like") {
    await page.getByRole("button", { name: /^Like, /u }).first().click();
    return page.getByRole("dialog", { name: "Like Boost", exact: true });
  }
  if (action === "reboost") {
    await page.getByRole("button", { name: /^Reboost, /u }).first().click();
    await page.getByRole("menuitem", { name: "Reboost", exact: true }).click();
    return page.getByRole("dialog", { name: "Reboost", exact: true });
  }
  if (action === "reply") {
    await page.getByRole("button", { name: /^Reply, /u }).first().click();
    const form = page.getByRole("dialog", { name: "Replying to Boost", exact: true });
    await form.locator("textarea").fill("A reply at the chosen fee.");
    return form;
  }
  await page.getByRole("button", { name: /^Tip, /u }).first().click();
  const form = page.getByRole("dialog", { name: "Tip", exact: true });
  if (action === "work-tip") {
    await form.getByRole("combobox", { name: "Tip currency", exact: true }).selectOption("WORK");
    await form.getByRole("textbox", { name: /^Tip amount \(WORK\)/u }).fill("0.0000000000000001");
    await expect(form).toContainText("Spendable WORK: 10");
  }
  return form;
}
function submitButton(form, action) {
  const names = { post: "Post", article: "Review publication", like: "Like · 546 proofs", reboost: "Reboost · 546 proofs", reply: "Reply",
    "proof-tip": "Review tip · 546 proofs", "work-tip": "Review tip · 0.0000000000000001 WORK" };
  return form.getByRole("button", { name: names[action], exact: true });
}
async function submitToRejectedWallet(page, form, action) {
  await submitButton(form, action).click();
  if (["article", "proof-tip", "work-tip"].includes(action)) {
    const review = page.getByRole("dialog", { name: action === "article" ? "Publish article" : "Review content tip", exact: true });
    await expect(review).toContainText("Estimated effective fee rate");
    await expect(review).toContainText("0.15");
    await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
  }
  await expect.poll(() => page.evaluate(() => window.socialFeePsbts.length)).toBe(1);
  return bitcoin.Psbt.fromHex(await page.evaluate(() => window.socialFeePsbts[0]));
}
function inspectUnsignedFee(psbt, entries) {
  const inputTotal = psbt.txInputs.reduce((sum, input) => {
    const txid = Buffer.from(input.hash).reverse().toString("hex");
    const entry = entries.find(entry => entry.utxo.txid === txid);
    expect(entry, "every input must bind a confirmed fixture prevout").toBeDefined();
    return sum + entry.utxo.value;
  }, 0);
  const totalOutputs = psbt.txOutputs.reduce((sum, output) => sum + Number(output.value), 0);
  const varIntBytes = size => size < 253 ? 1 : size <= 65535 ? 3 : 5;
  const estimatedVbytes = 10 + 160 * psbt.inputCount + psbt.txOutputs.reduce((sum, output) => sum + 8 + varIntBytes(output.script.length) + output.script.length, 0);
  const fee = inputTotal - totalOutputs;
  // Independent integer oracle, never imported from the production fee code.
  expect(fee).toBe(Number((BigInt(estimatedVbytes) * 15n + 99n) / 100n));
  expect(psbt.inputCount).toBe(3);
  expect(fee).toBeLessThan(546);
  expect(psbt.txOutputs.at(-1).address).toBe(wallet);
  expect(psbt.txOutputs.at(-1).value).toBeGreaterThanOrEqual(546n);
  return psbt.txOutputs.filter(output => output.script[0] === 0x6a)
    .map(output => Buffer.from(bitcoin.script.decompile(output.script)[1]).toString("utf8"));
}

for (const surface of surfaces) {
  for (const action of [surface.publish ? "article" : "post", "like", "reboost", "reply", "proof-tip", "work-tip"]) {
    test(`0.15 reaches unsigned ${action} PSBT in ${surface.name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const state = await fixture(page); await page.goto(surface.route); await connect(page);
      const form = await openAction(page, action);
      const fee = form.getByLabel("Fee proofs/vB", { exact: true });
      await fee.fill("0.15"); await expect(fee).toHaveValue("0.15");
      const psbt = await submitToRejectedWallet(page, form, action);
      const carriers = inspectUnsignedFee(psbt, state.entries);
      if (action === "post" || action === "article") expect(carriers.some(value => value.startsWith("pwb1:post:"))).toBe(true);
      if (action === "like" || action === "reboost") expect(carriers).toContain(`pwb1:${action}:${target}`);
      if (action === "reply") expect(carriers.some(value => value.startsWith("pwb1:reply:"))).toBe(true);
      if (action === "proof-tip") expect(carriers).toContain(`pwb1:tip:${target}:546`);
      if (action === "work-tip") {
        expect(carriers).toEqual([`pwb1:tip2:${target}:${workToken}:1`, `pwt1:send3:${workToken}:1:${owner}`]);
        expect(psbt.txOutputs.some(output => output.address === workRegistry && output.value === 546n)).toBe(true);
        expect(psbt.txOutputs.some(output => output.address === owner)).toBe(false);
      }
      expect(state.confirmations).toEqual([]);
      expect(state.mutations).toEqual([]);
    });
  }
}

for (const surface of surfaces) for (const theme of ["light", "dark"]) {
  test(`fee selector is reachable at 320x480 in ${surface.name} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    const state = await fixture(page, { theme }); await page.goto(surface.route); await connect(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await prepareMobileLikeClick(page);
    const form = await openAction(page, "like"), fee = form.getByLabel("Fee proofs/vB", { exact: true });
    await fee.fill("0.15"); await fee.focus(); await expect(fee).toBeFocused();
    await fee.scrollIntoViewIfNeeded();
    const box = await fee.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(481);
    expect(box.height).toBeGreaterThanOrEqual(44);
    for (const preset of ["0.1", "0.5", "1", "2"]) {
      const button = form.getByRole("button", { name: `${preset} proofs/vB`, exact: true });
      await button.scrollIntoViewIfNeeded(); await button.click();
      await expect(fee).toHaveValue(preset);
      const geometry = await button.boundingBox();
      expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44);
    }
    await fee.fill("0.15");
    const submit = submitButton(form, "like"); await submit.scrollIntoViewIfNeeded();
    const bottom = await submit.boundingBox(); expect(bottom.y + bottom.height).toBeLessThanOrEqual(481);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    const modalWidth = await form.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(modalWidth.scroll).toBeLessThanOrEqual(modalWidth.client + 1);
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0);
    expect(state.mutations).toEqual([]);
  });
}

for (const surface of surfaces) {
  test(`unavoidable dust discloses effective rate and cancellation prevents signing in ${surface.name}`, async ({ page }) => {
    const state = await fixture(page, { coins: 2 }); await page.goto(surface.route); await connect(page);
    const form = await openAction(page, "like"); await form.getByLabel("Fee proofs/vB", { exact: true }).fill("0.15");
    await submitButton(form, "like").click();
    await expect.poll(() => state.confirmations.length).toBe(1);
    expect(state.confirmations[0]).toContain("Selected fee rate: 0.15 proofs/vB");
    expect(state.confirmations[0]).toContain("Estimated effective rate:");
    expect(state.confirmations[0]).toContain("546 proofs");
    expect(state.confirmations[0]).toContain("below-dust change");
    await expect(form).toBeVisible(); await expect(form.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0);
    expect(state.mutations).toEqual([]);
  });
}

for (const surface of surfaces.filter(surface => surface.publish)) {
  test(`Publish writer shares chosen fee with engagement and reload in ${surface.name}`, async ({ page }) => {
    const state = await fixture(page); await page.goto(surface.route); await connect(page);
    const writer = await openAction(page, "article");
    await writer.getByLabel("Fee proofs/vB", { exact: true }).fill("0.15");
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    let like = await openAction(page, "like"); await expect(like.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    await like.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload(); await connect(page);
    like = await openAction(page, "like"); await expect(like.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.social-fee.v1")).rate)).toBe(0.15);
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0); expect(state.mutations).toEqual([]);
  });
  test(`Publish dust review keeps the selected rate distinct from actual miner fee in ${surface.name}`, async ({ page }) => {
    const state = await fixture(page, { coins: 2 }); await page.goto(surface.route); await connect(page);
    const writer = await openAction(page, "article"); await writer.getByLabel("Fee proofs/vB", { exact: true }).fill("0.15");
    await submitButton(writer, "article").click();
    const review = page.getByRole("dialog", { name: "Publish article", exact: true });
    await expect(review).toContainText("Estimated effective fee rate");
    await expect(review).toContainText("0.15"); await expect(review).toContainText("546 proofs");
    await expect(review).toContainText(/dust/iu);
    await review.getByRole("button", { name: "Back to task", exact: true }).click();
    await expect(writer.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0); expect(state.mutations).toEqual([]);
  });
}

test("social fee survives route reloads and Computer workspace remounts", async ({ page }) => {
  const state = await fixture(page); await page.goto("/?boost=1"); await connect(page);
  let form = await openAction(page, "like"); await form.getByLabel("Fee proofs/vB", { exact: true }).fill("0.15");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const route of ["/?publish=1", "/?folder=boost", "/?folder=publish"]) {
    await page.goto(route); await connect(page);
    form = await openAction(page, "like"); await expect(form.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  const openApp = async name => {
    await page.getByRole("button", { name: "Find an app", exact: true }).click();
    const launcher = page.getByRole("dialog", { name: "Computer apps", exact: true });
    await launcher.getByLabel("Find an app", { exact: true }).fill(name);
    await launcher.getByRole("button", { name, exact: true }).click();
    await expect(launcher).toHaveCount(0);
  };
  await openApp("Mail"); await expect(page.getByRole("region", { name: "Publish workspace", exact: true })).toHaveCount(0);
  await openApp("Boost"); form = await openAction(page, "like");
  await expect(form.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
  expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0); expect(state.mutations).toEqual([]);
});

for (const surface of surfaces.filter(surface => !surface.publish)) for (const action of ["post", "reply"]) {
  test(`delayed ${action} preflight freezes fee and ignores duplicate submission in ${surface.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await fixture(page); await page.goto(surface.route); await connect(page);
    const form = await openAction(page, action), fee = form.getByLabel("Fee proofs/vB", { exact: true });
    await fee.fill("0.15");
    await page.evaluate(() => {
      window.socialFeeNetworkReads = 0;
      const pending = new Promise(resolve => { window.socialFeeReleasePreflight = resolve; });
      window.unisat.getNetwork = async () => {
        window.socialFeeNetworkReads++;
        if (window.socialFeeNetworkReads === 1) await pending;
        return "livenet";
      };
    });
    // Two same-tick submit events exercise the synchronous in-flight guard,
    // before React can render the disabled submit button for the first event.
    await form.locator("form").evaluate(element => { element.requestSubmit(); element.requestSubmit(); });
    await expect.poll(() => page.evaluate(() => window.socialFeeNetworkReads)).toBe(1);
    await expect(fee).toBeDisabled(); await expect(form.locator('button[type="submit"]')).toBeDisabled();
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0);
    await page.evaluate(() => window.socialFeeReleasePreflight());
    await expect.poll(() => page.evaluate(() => window.socialFeePsbts.length)).toBe(1);
    await expect(fee).toBeEnabled();
    inspectUnsignedFee(bitcoin.Psbt.fromHex(await page.evaluate(() => window.socialFeePsbts[0])), state.entries);
    expect(state.confirmations).toEqual([]); expect(state.mutations).toEqual([]);
  });
}

for (const draftKind of ["fee-only", "signal-only", "blank quote"]) {
  test(`external preference cannot change a dismissed ${draftKind} Boost draft`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await fixture(page); await page.goto("/?boost=1"); await connect(page);
    if (draftKind === "blank quote") {
      await page.getByRole("button", { name: /^Reboost, /u }).first().click();
      await page.getByRole("menuitem", { name: "Quote", exact: true }).click();
    } else await page.getByRole("button", { name: "Post a Boost", exact: true }).click();
    const composer = page.locator(".boost-post-composer");
    await expect(composer.getByRole("textbox", { name: "Boost text", exact: true })).toHaveValue("");
    if (draftKind === "signal-only") await composer.getByLabel("Proof signal", { exact: true }).fill("1234");
    await composer.getByLabel("Fee proofs/vB", { exact: true }).fill("0.15");
    await composer.getByRole("button", { name: "Close Boost composer", exact: true }).click();
    await expect(composer).toHaveCount(0);
    await page.evaluate(() => {
      const key = "proofofwork.social-fee.v1", value = JSON.stringify({ rate: 0.5, updatedAt: Date.now() + 10 });
      localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
      window.dispatchEvent(new Event("focus"));
    });
    await page.getByRole("button", { name: "Post a Boost", exact: true }).click();
    await expect(composer.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    if (draftKind === "signal-only") await expect(composer.getByLabel("Proof signal", { exact: true })).toHaveValue("1234");
    if (draftKind === "blank quote") await expect(page.getByRole("dialog", { name: "Add a comment", exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0); expect(state.mutations).toEqual([]);
  });
}

for (const surface of surfaces.filter(surface => surface.publish)) {
  test(`reviewing a saved 0.15 article adopts its fee over a newer 0.5 preference in ${surface.name}`, async ({ page }) => {
    const state = await fixture(page);
    await page.addInitScript(({ wallet }) => {
      localStorage.setItem("proofofwork.social-fee.v1", JSON.stringify({ rate: 0.5, updatedAt: Date.now() }));
      localStorage.setItem(`proofofwork.publish.draft.v1:livenet:${wallet}`, JSON.stringify({
        title: "Preserved article", body: "Keep the draft's chosen fee.", signal: 546, feeRate: 0.15,
      }));
    }, { wallet });
    await page.goto(surface.route); await connect(page);
    await page.getByRole("button", { name: "Write your next article", exact: true }).click();
    const writer = page.locator(".publish-composer");
    await expect(writer.getByRole("textbox", { name: "Article title", exact: true })).toHaveValue("Preserved article");
    await expect(writer.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.social-fee.v1")).rate)).toBe(0.5);
    await submitButton(writer, "article").click();
    const review = page.getByRole("dialog", { name: "Publish article", exact: true });
    await expect(review).toContainText("selected rate 0.15 proofs/vB");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.social-fee.v1")).rate)).toBe(0.15);
    await review.getByRole("button", { name: "Back to task", exact: true }).click();
    await page.getByRole("button", { name: "Save draft and back", exact: true }).click();
    const like = await openAction(page, "like"); await expect(like.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0); expect(state.mutations).toEqual([]);
  });
}

// Final review cases are separately selectable for the VPS acceptance run.
test("final fee review: secure browser cookie propagates across canonical product hosts only", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page);
  const local = new URL(baseURL);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(local.hostname);
  const origins = new Set(["https://boost.proofofwork.me", "https://publish.proofofwork.me",
    "https://computer.proofofwork.me", "https://fee-fixture.proofofwork.me"]);
  const proxied = [];
  // HMR must not attempt a real socket to the intercepted HTTPS host.
  await page.routeWebSocket("**/*", socket => socket.close());
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (/^(?:\/test-api)?\/api\//u.test(url.pathname)) return route.fallback();
    if (!origins.has(url.origin)) return route.fallback();
    if (request.method() !== "GET") return route.abort("blockedbyclient");
    const upstream = new URL(url.pathname + url.search, local);
    proxied.push({ requested: url.origin, upstream: upstream.origin });
    // Browser origins stay HTTPS/canonical; only the intercepted response bytes
    // come from the isolated local development server. No public host is read.
    const response = await route.fetch({ url: upstream.href, maxRedirects: 0 });
    return route.fulfill({ response });
  });
  const cookieName = "proofofwork_social_fee_v1";
  await page.goto("https://boost.proofofwork.me/?boost=1"); await connect(page);
  let form = await openAction(page, "like");
  await form.getByLabel("Fee proofs/vB", { exact: true }).fill("0.15");
  const cookies = (await page.context().cookies("https://boost.proofofwork.me/")).filter(cookie => cookie.name === cookieName);
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({ domain: ".proofofwork.me", path: "/", secure: true, sameSite: "Lax" });
  expect(JSON.parse(decodeURIComponent(cookies[0].value)).rate).toBe(0.15);
  for (const url of ["https://publish.proofofwork.me/?publish=1", "https://computer.proofofwork.me/?folder=publish"]) {
    await page.goto(url); await connect(page);
    expect(await page.evaluate(() => localStorage.getItem("proofofwork.social-fee.v1"))).toBeNull();
    form = await openAction(page, "like");
    await expect(form.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("0.15");
    expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0);
  }
  // This sibling receives a Domain cookie at the browser layer, but the
  // preference module must neither adopt it nor overwrite it on other hosts.
  await page.goto("https://fee-fixture.proofofwork.me/?boost=1"); await connect(page);
  expect(await page.evaluate(name => document.cookie.includes(`${name}=`), cookieName)).toBe(true);
  form = await openAction(page, "like");
  await expect(form.getByLabel("Fee proofs/vB", { exact: true })).toHaveValue("1");
  await form.getByLabel("Fee proofs/vB", { exact: true }).fill("0.5");
  const unchanged = (await page.context().cookies("https://boost.proofofwork.me/")).find(cookie => cookie.name === cookieName);
  expect(unchanged.value).toBe(cookies[0].value);
  expect(proxied.length).toBeGreaterThan(4);
  expect(proxied.every(entry => entry.upstream === local.origin)).toBe(true);
  expect(new Set(proxied.map(entry => entry.requested))).toEqual(origins);
  expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0);
  expect(state.confirmations).toEqual([]); expect(state.mutations).toEqual([]);
});

for (const surface of surfaces.filter(surface => surface.publish)) {
  test(`final fee review: raw Publish input stays invalid through draft restore and retains 0.15 in ${surface.name}`, async ({ page }) => {
    const state = await fixture(page); await page.goto(surface.route); await connect(page);
    const writer = await openAction(page, "article"), fee = writer.getByLabel("Fee proofs/vB", { exact: true });
    for (const invalid of ["0", "0.09", "0.123456789", "1e3", "0x10"]) {
      await fee.fill(invalid); await submitButton(writer, "article").click();
      await expect(writer.getByRole("alert")).toContainText("at least 0.1 proofs/vB with up to 8 decimal places");
      await expect(fee).toHaveValue(invalid);
      await expect(page.getByRole("dialog", { name: "Publish article", exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0);
      expect(await page.evaluate(() => localStorage.getItem("proofofwork.social-fee.v1"))).toBeNull();
      if (["1e3", "0x10"].includes(invalid)) {
        await writer.getByRole("button", { name: "Save draft and back", exact: true }).click();
        await page.getByRole("button", { name: "Write your next article", exact: true }).click();
        await expect(fee).toHaveValue("0");
        await submitButton(writer, "article").click();
        await expect(writer.getByRole("alert")).toContainText("at least 0.1 proofs/vB with up to 8 decimal places");
        await expect(page.getByRole("dialog", { name: "Publish article", exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => window.socialFeePsbts.length)).toBe(0);
        expect(await page.evaluate(() => localStorage.getItem("proofofwork.social-fee.v1"))).toBeNull();
      }
    }
    await fee.fill("0.15");
    await writer.getByRole("button", { name: "Save draft and back", exact: true }).click();
    await page.getByRole("button", { name: "Write your next article", exact: true }).click();
    await expect(fee).toHaveValue("0.15");
    const psbt = await submitToRejectedWallet(page, writer, "article");
    inspectUnsignedFee(psbt, state.entries);
    expect(state.confirmations).toEqual([]); expect(state.mutations).toEqual([]);
  });
}

for (const surface of surfaces) for (const action of surface.publish ? ["article", "proof-tip"] : ["proof-tip"]) {
  test(`final fee review: external preference cannot replace reviewed 0.15 ${action} in ${surface.name}`, async ({ page }) => {
    const state = await fixture(page); await page.goto(surface.route); await connect(page);
    const form = await openAction(page, action); await form.getByLabel("Fee proofs/vB", { exact: true }).fill("0.15");
    await submitButton(form, action).click();
    const review = page.getByRole("dialog", { name: action === "article" ? "Publish article" : "Review content tip", exact: true });
    await expect(review).toContainText("selected rate 0.15 proofs/vB");
    const before = await review.locator(".review-fields").allTextContents();
    await page.evaluate(() => {
      const key = "proofofwork.social-fee.v1", value = JSON.stringify({ rate: 0.5, updatedAt: Date.now() + 10 });
      localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
      window.dispatchEvent(new Event("focus"));
    });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("proofofwork.social-fee.v1")).rate)).toBe(0.5);
    await expect(review).toContainText("selected rate 0.15 proofs/vB");
    expect(await review.locator(".review-fields").allTextContents()).toEqual(before);
    await review.getByRole("button", { name: "Continue to wallet", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.socialFeePsbts.length)).toBe(1);
    inspectUnsignedFee(bitcoin.Psbt.fromHex(await page.evaluate(() => window.socialFeePsbts[0])), state.entries);
    expect(state.confirmations).toEqual([]); expect(state.mutations).toEqual([]);
  });
}
