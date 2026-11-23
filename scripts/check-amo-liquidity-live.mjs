import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";
import { normalizeExpandedLiquidityPins } from "../server/work-amo-expanded-liquidity.mjs";
import { workAmoBookFace } from "../src/shared/protocol/workAmoBookFace.mjs";
import { WORK_AMO_FACE_PROOFS, WORK_AMO_LIQUIDITY_FEE_SATS } from "../src/shared/protocol/workAmoExpandedLiquidity.mjs";
import { checkSummaryTip, readSummary, summaryCheckpoint } from "./check-summary-preview-live.mjs";

const hash = /^[0-9a-f]{64}$/u;
const originalDeclaration = "f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a";
const origin = host => `https://${host}.proofofwork.me`;

function verifyAdmission(v8, checkpoint, expectedTxid) {
  assert.equal(v8?.activation?.declaration?.txid, originalDeclaration);
  assert.equal(v8.activation.tipVerified, true);
  assert.equal(v8.tipHeight, checkpoint.height);
  assert.equal(v8.tipHash, checkpoint.blockHash);
  for (const key of ["protocolReady", "writeAdmission", "listingWritesEnabled", "settlementWritesEnabled"]) {
    assert.equal(v8[key], true, `Original V8 admission unavailable: ${key}`);
  }
  assert.equal(v8.estimates?.[25000]?.unitFaceProofs, 25000);
  const tier = v8.expandedLiquidity;
  assert.equal(tier?.tipHeight, checkpoint.height);
  assert.equal(tier.tipHash, checkpoint.blockHash);
  assert.equal(tier.listingWritesEnabled, Boolean(expectedTxid), "Unexpected 250,000-proof List admission");
  if (!expectedTxid) {
    assert.match(tier.reasonCode, /^work-amo-expanded-liquidity-/u);
    assert.equal(v8.estimates[250000], undefined);
  } else {
    assert.equal(tier.replayReady, true);
    assert.equal(tier.schemaReady, true);
    assert.equal(v8.pendingWitnessReady, true);
    assert.equal(v8.workerReadiness?.ready, true);
    assert.equal(tier.declaration?.txid, expectedTxid);
    assert.deepEqual(tier.declaration, normalizeExpandedLiquidityPins(tier.declaration));
    assert.ok(tier.declaration.blockHeight + tier.declaration.firstEligibleBlockOffset <= checkpoint.height);
    assert.equal(v8.estimates[250000]?.unitFaceProofs, 250000);
  }
  return tier;
}

function browsePath(face, params) {
  const query = new URLSearchParams({ asset: WORK_TOKEN_ID, unitFaceProofs: String(face), includeSummary: "0", limit: "1", ...params });
  return `/api/v1/marketplace-browse?${query}`;
}

function verifyPage(page, checkpoint, face, version) {
  assert.equal(page.contract, "proof-amo-browse-v1");
  assert.equal(page.state, "last-verified");
  assert.equal(page.displayOnly, true);
  assert.equal(page.provenance.authoritative, false);
  assert.equal(page.provenance.completeAtObservation, true);
  assert.equal(page.checkpoint.height, checkpoint.height);
  assert.equal(page.checkpoint.blockHash, checkpoint.blockHash);
  assert.match(page.version, hash);
  if (version) assert.equal(page.version, version);
  assert.equal(page.query.unitFaceProofs, face);
  assert.equal(page.book.unitFaceProofs, face);
  assert.equal(page.book.asset, WORK_TOKEN_ID);
  assert.equal(page.book.start, 0);
  assert.ok(Number.isSafeInteger(page.book.totalCount) && page.book.totalCount >= 0);
  assert.equal(page.book.items.length, Math.min(1, page.book.totalCount));
  for (const item of page.book.items) {
    assert.equal(item.confirmed, true);
    assert.equal(item.tokenId, WORK_TOKEN_ID);
    assert.equal(workAmoBookFace(item), face);
    assert.match(item.listingId, hash);
  }
}

async function verifyExpandedListing(read, txid, checkpoint) {
  const query = new URLSearchParams({ network: "livenet", q: txid, limit: "50" });
  const log = await read("log", `/api/v1/log-history?${query}&snapshot=${encodeURIComponent(checkpoint.snapshotId)}`);
  checkSummaryTip(log, checkpoint);
  const records = log.items.filter(item => item.txid === txid && item.kind === "token-listing");
  assert.equal(records.length, 1, "Expected one confirmed expanded List in Log");
  const [record] = records;
  const openingFees = 546 + WORK_AMO_LIQUIDITY_FEE_SATS;
  assert.equal(record.confirmed, true);
  const faces = [record.unitFaceProofs, record.saleAuthorization?.unitFaceProofs, record.frozenTerms?.unitFaceProofs]
    .filter(face => face !== undefined);
  assert.ok(faces.length > 0 && faces.every(face => face === 250000), "Expanded Log entry lacks a consistent signed face");
  assert.equal(record.amountSats, openingFees);
  assert.equal(record.marketplaceMutationFeeSats, openingFees);
  assert.equal(record.liquidityFeeSats, WORK_AMO_LIQUIDITY_FEE_SATS);
  const search = await read("search", `/api/v1/search?${query}&protocol=pwt1&status=confirmed`);
  assert.equal(search.coverage?.ready, true);
  assert.equal(search.coverage.checkpointHeight, checkpoint.height);
  assert.equal(search.coverage.checkpointHash, checkpoint.blockHash);
  const matches = search.results.filter(item => item.txid === txid && item.kind === "token-listing" && item.source?.type === "event");
  assert.equal(matches.length, 1, "Expected one confirmed expanded List in Search");
  assert.equal(matches[0].canonical, true);
  assert.equal(matches[0].valid, true);
  assert.equal(matches[0].amountSats, String(openingFees));
  assert.match(record.blockHash, hash);
  assert.equal(matches[0].blockHash, record.blockHash);
}

export async function verifyAmoLiquidity(read, expectedTxid = "") {
  if (expectedTxid) assert.match(expectedTxid, hash, "Supply the actual confirmed additive declaration txid");
  const checkpoint = summaryCheckpoint(await read("computer", "/health"));
  assert.match(checkpoint.blockHash, hash);
  assert.ok(Number.isSafeInteger(checkpoint.height) && checkpoint.height > 0 && checkpoint.snapshotId);
  const summaries = await Promise.all([["amo", "marketplace"], ["work", "work"], ["growth", "growth"], ["log", "log"]]
    .map(async ([host, route]) => {
      const summary = await read(host, `/api/v1/${route}-summary?network=livenet&fresh=1&compact=1`);
      checkSummaryTip(summary, checkpoint);
      return summary;
    }));
  const tier = verifyAdmission(summaries[0].workAmoV8, checkpoint, expectedTxid);
  assert.deepEqual(verifyAdmission(summaries[1].workAmoV8, checkpoint, expectedTxid), tier);
  if (expectedTxid) {
    const status = await read("computer", `/api/v1/tx/${expectedTxid}/status?network=livenet`);
    assert.equal(status.contract, "proof-of-work-tx-status-v2");
    assert.equal(status.network, "livenet");
    assert.equal(status.txid, expectedTxid);
    assert.equal(status.canonical, true);
    assert.equal(status.confirmed, true);
    assert.equal(status.blockHeight, tier.declaration.blockHeight);
    assert.equal(status.blockHash, tier.declaration.blockHash);
  }
  const books = {};
  let version, assetCounts;
  for (const face of WORK_AMO_FACE_PROOFS) {
    const page = await read("amo", browsePath(face, version ? { version } : {}));
    verifyPage(page, checkpoint, face, version);
    version = page.version;
    const { book } = page;
    assert.equal(book.totalCount, book.counts.all);
    assert.equal(book.counts.sealed + book.counts.unsealed, book.counts.all);
    assert.deepEqual(book.counts, book.workFaceCounts[face]);
    if (assetCounts) assert.deepEqual(book.assetCounts[WORK_TOKEN_ID], assetCounts);
    assetCounts = book.assetCounts[WORK_TOKEN_ID];
    assert.ok(book.counts.all <= assetCounts.all);
    books[face] = { counts: book.counts, listingTxid: book.items[0]?.listingId ?? null };
    if (!books[face].listingTxid) continue;
    const q = books[face].listingTxid;
    for (const queriedFace of WORK_AMO_FACE_PROOFS) {
      const exact = await read("amo", browsePath(queriedFace, { q, version }));
      verifyPage(exact, checkpoint, queriedFace, version);
      assert.equal(exact.book.query, q);
      assert.deepEqual(exact.book.items.map(item => item.listingId), queriedFace === face ? [q] : []);
      assert.equal(exact.book.totalCount, queriedFace === face ? 1 : 0);
    }
  }
  if (books[250000].listingTxid) await verifyExpandedListing(read, books[250000].listingTxid, checkpoint);
  for (const key of ["all", "sealed", "unsealed"]) {
    assert.ok(books[25000].counts[key] + books[250000].counts[key] <= assetCounts[key]);
  }
  assert.deepEqual(summaryCheckpoint(await read("computer", "/health")), checkpoint, "Canonical checkpoint changed during verification");
  return { checkpoint, version, books, existingDeclarationTxid: originalDeclaration,
    expandedList: tier.listingWritesEnabled ? "ready" : "closed", declaration: tier.declaration, reasonCode: tier.reasonCode };
}

async function renderSurfaces() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ channel: process.env.POW_PLAYWRIGHT_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort());
    const surfaces = [
      ["www", "/", ".landing-app h1"], ["growth", "/", "[aria-label='Growth headline stats']"],
      ["work", "/", ".work-floor-metrics-card"], ["log", "/", "#log-events"],
      ["search", "/", ".search-filters"], ["wallet", "/", "#wallet-overview"], ["permission", "/", ".permission-app"],
      ["computer", "/?folder=log", "#log-events"], ["computer", "/?folder=wallet", "#wallet-overview"],
      ["computer", "/?folder=search", ".search-filters"], ["computer", "/?folder=permission", ".permission-embedded-app"],
    ];
    for (const [host, path, selector] of surfaces) {
      const response = await page.goto(new URL(path, origin(host)).href, { waitUntil: "domcontentloaded" });
      assert.ok(response?.ok(), `${host}${path}`);
      await page.locator(selector).first().waitFor({ timeout: 45_000 });
    }
    for (const host of ["amo", "computer"]) {
      const url = new URL(origin(host));
      if (host === "computer") url.searchParams.set("folder", "marketplace");
      url.searchParams.set("asset", WORK_TOKEN_ID);
      assert.ok((await page.goto(url.href, { waitUntil: "domcontentloaded" }))?.ok());
      for (const face of WORK_AMO_FACE_PROOFS) {
        const tab = page.locator(`#work-amo-face-tab-${face}`);
        await tab.click({ timeout: 60_000 });
        const panel = page.locator(`#work-amo-face-book-${face}:visible`);
        await panel.getByText(new RegExp(`Last verified .* the ${face.toLocaleString("en-US")}-proof WORK book`)).waitFor({ timeout: 60_000 });
        assert.equal(await tab.getAttribute("aria-selected"), "true");
      }
    }
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await verifyAmoLiquidity((host, path) => readSummary(host, path, origin(host)),
    process.env.POW_AMO_EXPECTED_DECLARATION_TXID);
  await renderSurfaces();
  console.log(JSON.stringify({ ok: true, ...result }));
}
