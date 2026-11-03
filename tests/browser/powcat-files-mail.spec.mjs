import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { parsePowcatTransaction, resolvePowcatFile } from "../../src/shared/protocol/powcat1.mjs";

test.use({ launchOptions: process.env.POWCAT_CHROME_PATH ? { executablePath: process.env.POWCAT_CHROME_PATH } : {} });
const digest = text => createHash("sha256").update(text).digest("hex");
const scalar = Buffer.from(digest("isolated powcat UI test key, never fund"), "hex");
const signer = { publicKey: Buffer.from(ecc.pointFromScalar(scalar, true)), sign: hash => ecc.sign(hash, scalar) };
const payment = bitcoin.payments.p2wpkh({pubkey: signer.publicKey});
const network = "livenet";
const file = {name: "linked-sample.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(200_000, 0x91)};
const block = n => digest(`isolated block ${n}`);

test("Files signs independent binary parts, recovers a dropped part after reload, repairs linker order, and hands verified bytes to Mail", async ({page}) => {
  test.setTimeout(150_000);
  const funds = new Map(), published = new Map(), heights = new Map(), used = new Set();
  let accepted = false, signatures = 0, firstHex, firstTxid, activeReads = 0, maxReads = 0, busyOnce = true;
  for (let i = 0; i < 6; i++) {
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.from(block(i + 1), "hex"), 0);
    tx.addOutput(payment.output, BigInt(250_000 + i * 1000)); funds.set(tx.getId(), tx);
  }
  const remaining = () => [...funds].filter(([txid]) => !used.has(txid)).map(([txid, tx]) => ({txid, vout: 0, value: Number(tx.outs[0].value), status: {confirmed: true}}));
  await page.exposeFunction("powcatTestFunds", remaining);
  await page.exposeFunction("powcatTestSign", hex => {
    signatures++; const psbt = bitcoin.Psbt.fromHex(hex);
    psbt.signAllInputs(signer); psbt.finalizeAllInputs(); return psbt.toHex();
  });
  await page.addInitScript(address => {
    let connected = sessionStorage.getItem("powcat-test-connected") === "1";
    window.unisat = { getAccounts: async () => connected ? [address] : [], requestAccounts: async () => {
      connected = true; sessionStorage.setItem("powcat-test-connected", "1"); return [address]; },
      getChain: async () => ({enum:"BITCOIN_MAINNET"}), getNetwork: async () => "livenet",
      getBitcoinUtxos: () => window.powcatTestFunds(), signPsbt: hex => window.powcatTestSign(hex), on() {}, removeListener() {} };
  }, payment.address);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace(/^.*(?=\/api\/v1\/)/u, "");
    if (!path.startsWith("/api/v1/")) {
      const base = new URL(test.info().project.use.baseURL);
      return url.origin === base.origin ? route.continue() : route.abort("blockedbyclient");
    }
    const json = value => route.fulfill({json: value});
    if (path === "/api/v1/broadcast/tx") {
      const { txHex } = route.request().postDataJSON();
      const tx = bitcoin.Transaction.fromHex(txHex), txid = tx.getId();
      parsePowcatTransaction(txHex, txid);
      if (!firstHex) { firstHex = txHex; firstTxid = txid; return route.fulfill({status: 400, json: {error: "Disposable node rejected the first submission."}}); }
      if (!accepted) { expect(txHex).toBe(firstHex); accepted = true; }
      for (const input of tx.ins) {
        const source = Buffer.from(input.hash).reverse().toString("hex");
        expect(funds.has(source)).toBe(true); expect(used.has(source)).toBe(false); used.add(source);
      }
      published.set(txid, txHex); return json({source:"node", txid});
    }
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    if (path.endsWith("/utxo")) return json(remaining());
    if (path.endsWith("/hex")) return json({hex: funds.get(path.split("/").at(-2))?.toHex()});
    if (path.endsWith("/status") && path.includes("/tx/")) {
      const txid = path.split("/").at(-2), height = heights.get(txid) ?? (funds.has(txid) ? 10 : undefined);
      if (url.searchParams.has("powcat")) {
        if (activeReads >= 2 || busyOnce) { busyOnce = false; return route.fulfill({status:429, json:{error:"File verification is busy."}}); }
        activeReads++; maxReads = Math.max(maxReads, activeReads);
        await new Promise(resolve => setTimeout(resolve, 30)); activeReads--;
      }
      return json({network, txid, contract: "proof-of-work-tx-status-v2", ...(height ?
        {status: "confirmed", canonical: true, confirmed: true, blockHash: block(height), blockHeight: height} :
        published.has(txid) ? {status: "pending", confirmed: false} : {status: "dropped", absenceProven:true, confirmed:false})});
    }
    if (path.includes("/powcat/")) {
      const txid = path.split("/").at(-1);
      const value = await resolvePowcatFile(txid, async id => ({hex: published.get(id), blockHash: block(heights.get(id)), blockHeight: heights.get(id)}));
      if (url.searchParams.has("download")) return route.fulfill({contentType:"application/octet-stream", body: Buffer.from(value.bytes)});
      const {bytes, ...metadata} = value;
      return json({...metadata, network, confirmed:true, blockHeight: heights.get(txid), blockHash: block(heights.get(txid))});
    }
    if (path === "/api/v1/dns" || path === "/api/v1/registry") return json({network, records:[], listings:[], coverage:{complete:true}, indexedThroughBlock:15, checkpointHash:block(15), collectionHasMore:{listings:false}});
    if (path === "/api/v1/token") return json({network, listings:[], source:"proof-indexer-wallet-token-overlay+proof-indexer-wallet-address-state", walletScoped:true, authoritativeWallet:true, summaryOnly:true});
    if (path === "/api/v1/boost") return json({network, complete:true, items:[], hasMore:false});
    return json({network, records:[], items:[], listings:[], complete:true, minimumFee:0.1, fastestFee:1, halfHourFee:1, hourFee:1});
  });
  await page.goto("/?folder=files", {waitUntil:"domcontentloaded"});
  const launch = page.getByRole("button", {name:"Publish linked file", exact:true});
  await expect(launch).toBeDisabled();
  await page.getByRole("button", {name:"Connect UniSat", exact:true}).first().click();
  await expect(launch).toBeEnabled();
  await launch.click();
  const modal = page.getByRole("dialog", {name:"Publish linked file"});
  await modal.locator('input[type="file"]').setInputFiles(file);
  await expect(modal).toContainText("200,000 bytes");
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({width, height: width === 320 ? 480 : 800});
    const fits = await modal.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fits, `File review fits ${width}px viewport`).toBe(true);
    if (process.env.POWCAT_VISUAL_QA && width !== 768) await modal.screenshot({ path: test.info().outputPath(`files-review-${width}.png`) });
  }
  async function sign(label) {
    await modal.getByRole("button", {name:`Review ${label}`, exact:true}).click();
    await expect(modal.getByText("Exact miner fee", {exact:true})).toBeVisible();
    await modal.getByRole("button", {name:`Sign and broadcast ${label}`, exact:true}).click();
  }
  await sign("part 1");
  await expect(modal).toContainText("Disposable node rejected");
  await page.reload({waitUntil:"domcontentloaded"});
  if (await launch.isDisabled()) await page.getByRole("button", {name:"Connect UniSat", exact:true}).first().click();
  await launch.click();
  await modal.getByText("Saved transactions (1)").click();
  await modal.getByRole("button", {name:"Rebroadcast saved part 1", exact:true}).click();
  await expect(modal).toContainText("exact saved transaction was submitted");
  expect(signatures).toBe(1);
  await modal.locator('input[type="file"]').setInputFiles(file);
  await sign("part 2"); await expect(modal).toContainText("Part 2 submitted");
  await sign("part 3"); await expect(modal).toContainText("Part 3 submitted");
  expect(published.size).toBe(3);
  expect(await modal.getByRole("button", {name:"Review linker", exact:true}).count()).toBe(0);
  for (const txid of published.keys()) heights.set(txid, 20);
  await modal.getByRole("button", {name:"Refresh progress"}).click();
  await sign("linker"); await expect(modal).toContainText("Linker submitted");
  const root1 = [...published.keys()].at(-1); heights.set(root1, 21);
  heights.set(firstTxid, 21); // A reorg re-mined one part in the linker's own block.
  await modal.getByRole("button", {name:"Refresh progress"}).click();
  await modal.getByRole("button", {name:"Prepare a new linker after reorg"}).click();
  await sign("linker"); await expect(modal).toContainText("Linker submitted");
  const root2 = [...published.keys()].at(-1);
  expect(root2).not.toBe(root1); heights.set(root2, 22);
  await modal.getByRole("button", {name:"Verify completed file"}).click();
  await expect(modal).toContainText("Last verified publication"); await expect(modal).toContainText(root2);
  expect(signatures).toBe(5);
  await modal.getByRole("button", {name:"Attach in Mail"}).click();
  await expect(page.getByText("Linked file", {exact:true}).first()).toBeVisible();
  await page.locator('.attachment-picker input[type=file]').setInputFiles({name:"mail-choice.bin", mimeType:"application/octet-stream", buffer: Buffer.alloc(65_000, 0x77)});
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("mail-choice.bin"); await expect(modal).toContainText("65,000 bytes");
  await expect(modal.getByRole("button", {name:"Review part 1"})).toBeEnabled();
  expect(signatures).toBe(5);
  await modal.getByRole("button", {name:"Close", exact:true}).click();
  await expect(page.getByText("Linked file", {exact:true}).first()).toBeVisible();
  await page.goto("/?folder=files", {waitUntil:"domcontentloaded"});
  await page.getByText("Open by linker TXID", {exact:true}).click();
  await page.getByRole("textbox", {name:"File linker TXID"}).fill(root2);
  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", {name:"Verify and download"}).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toBe(file.name);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  expect(Buffer.concat(chunks).equals(file.buffer)).toBe(true);
  expect(signatures).toBe(5); expect(maxReads).toBe(1); expect(busyOnce).toBe(false);
});
