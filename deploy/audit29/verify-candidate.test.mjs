import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkedBase, checkedRole, readonlyEnvironment, sameTip, verifyPendingDates,
  verifyWalletResponse, verifyFencedWalletRead }
  from "./verify-candidate.mjs";
import { digest, inventory, listingCommitmentRecord, verifyBookPair }
  from "../audit5/probe-candidate.mjs";

const HASH = "a".repeat(64);
const TXID = "b".repeat(64);
const WORK = "d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8";
test("candidate origins separate public GETs from authenticated numeric-loopback authority", () => {
  assert.equal(checkedBase("https://api.proofofwork.me"), "https://api.proofofwork.me");
  assert.equal(checkedBase("http://127.0.0.1:18081", true), "http://127.0.0.1:18081");
  for (const url of ["https://api.proofofwork.me", "http://localhost:18081", "http://127.0.0.1:9999",
    "http://user:secret@127.0.0.1:18081", "http://127.0.0.1:18081/api/v1"])
    assert.throws(() => checkedBase(url, true));
  assert.throws(() => checkedBase("https://unrelated.example"));
  assert.equal(checkedRole("shadow", "http://127.0.0.1:18081", "http://127.0.0.1:18081").mode, "shadow");
  assert.equal(checkedRole("production", "https://computer.proofofwork.me", "http://127.0.0.1:8081").mode, "production");
  for (const [mode, base, authority] of [
    ["shadow", "http://127.0.0.1:8081", "http://127.0.0.1:18081"],
    ["shadow", "http://127.0.0.1:18081", "http://127.0.0.1:8081"],
    ["production", "https://computer.proofofwork.me", "http://127.0.0.1:18081"],
    ["production", "http://127.0.0.1:18081", "http://127.0.0.1:8081"],
  ]) assert.throws(() => checkedRole(mode, base, authority), /ROLE_ORIGIN_MISMATCH/u);
});
test("private child configuration stays readonly and targets the candidate rather than8081", () => {
  const input = { POW_INDEX_DATABASE_URL: "postgresql://user:secret@127.0.0.1/db?options=-c%20search_path%3Dpg_catalog",
    POW_API_BASE: "http://127.0.0.1:8081", POW_INTERNAL_VERIFIER_TOKEN: "x".repeat(40) };
  const original = structuredClone(input);
  const env = readonlyEnvironment(input, "http://127.0.0.1:18081");
  assert.deepEqual(input, original);
  assert.equal(env.POW_API_BASE, "http://127.0.0.1:18081");
  assert.equal(env.POW_ID_AUDIT_API_BASE, env.POW_API_BASE);
  assert.equal(env.POW_INDEX_PARITY_STRICT, "1");
  assert.equal(env.POW_INDEX_DB_POOL_MAX, "1");
  assert.equal(env.POW_INDEX_FETCH_RETRIES, "0");
  assert.equal(env.POW_ID_AUDIT_WRITE_REPORTS, "0");
  assert.match(new URL(env.POW_INDEX_DATABASE_URL).searchParams.get("options"), /default_transaction_read_only=on/u);
  assert.equal(env.POW_INTERNAL_VERIFIER_TOKEN, input.POW_INTERNAL_VERIFIER_TOKEN);
  assert.equal(env.NODE_DISABLE_COMPILE_CACHE, "1");
  assert.throws(() => readonlyEnvironment({ ...input, NODE_OPTIONS: "--import=unsafe.mjs" }, env.POW_API_BASE), /CODE_LOADER/u);
  assert.throws(() => readonlyEnvironment({ ...input, LD_PRELOAD: "unsafe.so" }, env.POW_API_BASE), /CODE_LOADER/u);
});
test("stable tip requires both height and hash", () => {
  const tip = { height: 969391, hash: HASH };
  assert.equal(sameTip(tip, { ...tip }), true);
  assert.equal(sameTip(tip, { ...tip, height: tip.height + 1 }), false);
  assert.equal(sameTip(tip, { ...tip, hash: TXID }), false);
  assert.equal(sameTip({ height: 0, hash: HASH }, { height: 0, hash: HASH }), false);
});
test("pending time parity preserves strict semantics and current admission provenance", () => {
  const row = { txid: TXID, id: "ross", confirmed: false, createdAt: "2026-09-16T11:38:58.000Z",
    createdAtSource: "proof-indexer-retained-event-time", indexedEventTime: "2026-09-16T11:38:58.000Z",
    indexedFirstSeenAt: "2026-06-17T19:21:36.392Z", mempoolAcceptedAt: "2026-10-01T04:00:00.000Z",
    mempoolAcceptedAtSource: "bitcoin-core-getmempoolentry", amountSats: 1000,
    ownerAddress: "owner", receiveAddress: "receiver" };
  const canonical = { records: [row], activity: [{ ...row, kind: "id-register" }], sales: [], listings: [] };
  const indexed = structuredClone(canonical);
  delete indexed.records[0].mempoolAcceptedAt;
  assert.equal(verifyPendingDates(canonical, indexed).pendingRecords, 1);
  indexed.records[0].createdAt = "2026-10-01T04:00:00.000Z";
  assert.throws(() => verifyPendingDates(canonical, indexed), /REGISTRY_SEMANTIC_PARITY_FAILED/u);
  indexed.records[0].createdAt = row.createdAt;
  canonical.records[0].mempoolAcceptedAtSource = "transaction-mempool-time";
  assert.throws(() => verifyPendingDates(canonical, indexed), /PENDING_TIMESTAMP_PROVENANCE_FAILED/u);
});
test("wallet verifies exact capacity and retains qualified503 as unavailable", () => {
  const tip = { height: 969391, hash: HASH };
  const payload = { authoritativeWallet: true, indexedThroughBlock: tip.height,
    indexedThroughBlockHash: HASH, holders: [{ address: "owner", tokenId: WORK,
      balanceSubatoms: "9999997003878536", pendingDeltaSubatoms: "0" }],
    canonicalWorkCapacities: [{ address: "owner", model: "canonical-work-wallet-capacity-v1",
      network: "livenet", tokenId: WORK, indexedThroughBlock: tip.height, indexedThroughBlockHash: HASH,
      confirmedBalanceSubatoms: "9999997003878536",
      transferableBalanceSubatoms: "9999970087899719", reservedBalanceSubatoms: "26915978817" }] };
  assert.equal(verifyWalletResponse(200, payload, "owner", tip).ready, true);
  payload.canonicalWorkCapacities[0].transferableBalanceSubatoms = "9999997003878536";
  assert.throws(() => verifyWalletResponse(200, payload, "owner", tip), /CONSERVATION_FAILED/u);
  const unavailable = { ok: false,
    error: `Fresh wallet credit state is temporarily unavailable for ${WORK}.`,
    details: { code: "CANONICAL_WALLET_INDEX_UNAVAILABLE",
    requiredSource: "proof-indexer-wallet-token-overlay" } };
  const result = verifyFencedWalletRead(503, unavailable, "owner", tip, { ...tip });
  assert.equal(result.ready, false);
  assert.equal(result.balanceVerified, false);
  assert.equal(result.capacityVerified, false);
  assert.equal(result.verificationStatus, "known-unresolved-availability");
  assert.equal(result.checkpoint.stable, true);
  assert.equal(result.confirmedBalanceSubatoms, undefined);
  assert.throws(() => verifyWalletResponse(503, { error: "other" }, "owner", tip), /UNQUALIFIED/u);
});
test("known wallet unavailability rejects other errors, malformed contracts and stale fences", () => {
  const tip = { height: 969391, hash: HASH };
  const unavailable = { ok: false,
    error: `Fresh wallet credit state is temporarily unavailable for ${WORK}.`,
    details: { code: "CANONICAL_WALLET_INDEX_UNAVAILABLE",
      requiredSource: "proof-indexer-wallet-token-overlay" } };
  for (const payload of [null, {}, { ...unavailable, ok: true },
    { ...unavailable, error: "Other wallet error." },
    { ...unavailable, details: { ...unavailable.details, code: "CANONICAL_WORK_CAPACITY_UNAVAILABLE" } },
    { ...unavailable, details: { ...unavailable.details, requiredSource: "historical-cache" } },
    { ...unavailable, indexedThroughBlock: tip.height - 1, indexedThroughBlockHash: HASH },
    { ...unavailable, authoritativeWallet: true }, { ...unavailable, holders: [] },
    { ...unavailable, details: { ...unavailable.details, reason: "different-contract" } },
  ]) assert.throws(() => verifyWalletResponse(503, payload, "owner", tip), /UNQUALIFIED/u);
  assert.throws(() => verifyWalletResponse(503, unavailable, "owner", { ...tip, height: 0 }), /CHECKPOINT_INVALID/u);
  for (const after of [{ ...tip, height: tip.height + 1 }, { ...tip, hash: TXID }])
    assert.throws(() => verifyFencedWalletRead(503, unavailable, "owner", tip, after), /CORE_CHECKPOINT_MOVED/u);
  assert.throws(() => verifyWalletResponse(502, unavailable, "owner", tip), /AUTHORITY_OR_CHECKPOINT/u);
});

function book() {
  const rows = [{ listingId: TXID, txid: TXID, network: "livenet", confirmed: true,
    tokenId: WORK, blockHeight: 969000, blockIndex: 1, protocolVout: 1, recordOrdinal: 0,
    amountSubatoms: "100", workAmoV5ReplayOutput: { witness: "retained" } }];
  const membership = digest(rows.map((item) => ({ item: listingCommitmentRecord(item),
    key: [item.listingId, item.blockHeight, item.blockIndex, item.protocolVout, item.recordOrdinal] })));
  const sourceSha256 = "d".repeat(64); const coreDigest = "c".repeat(64);
  const page = { network: "livenet", source: "proof-indexer-complete-core-reconciled-token-listings",
    kind: "listings", indexedAt: "2026-10-01T00:00:00.000Z", indexedThroughBlock: 969391,
    indexedThroughBlockHash: HASH, snapshotId: digest({ coreDigest, coreHash: HASH,
      membershipSha256: membership, protocolMembershipSha256: membership, relationalHash: HASH, sourceSha256 }),
    listingAuthority: { model: "proof-token-market-core-gettxout-v1", includeMempool: true,
      checkpoint: { height: 969391, blockHash: HASH }, checkedOutpointsSha256: coreDigest,
      checkedListingCount: 1, inputListingCount: 1, outputListingCount: 1, spentListingCount: 0, unspentListingCount: 1 },
    listingProjection: { model: "proof-token-market-cutover-after-core-v1", membershipSha256: membership,
      activeListingCount: 1, excludedByProtocolCount: 0, coreUnspentListingCount: 1 },
    items: rows, start: 0, end: 1, totalCount: 1, hasMore: false, cursor: "", nextCursor: "" };
  const display = structuredClone(page);
  delete display.items[0].workAmoV5ReplayOutput;
  display.itemProjection = { model: "proof-token-listing-display-v1", fullMembershipSha256: membership, fullSourceSha256: sourceSha256 };
  display.items[0].displayEvidence = { model: display.itemProjection.model,
    fullRecordSha256: digest(listingCommitmentRecord(rows[0])), omittedFields: ["workAmoV5ReplayOutput"],
    fullDetailPath: `/api/v1/token-history?network=livenet&kind=listings&q=${TXID}&listingId=${TXID}&projection=full` };
  return { page, display };
}
test("book completion checks Core/protocol fences and full/display membership without forcing999", async () => {
  const { page, display } = book();
  const full = await inventory({ get: async () => page }, "/api/v1/token-history", "book");
  const shown = await inventory({ get: async () => display }, "/api/v1/token-history", "book");
  assert.equal(verifyBookPair(full, shown).listings, 1);
  display.items[0].amountSubatoms = "101";
  assert.throws(() => verifyBookPair(full, shown), /SUBSTANTIVE_LISTING_FIELD_CHANGED/u);
});
test("book rejects moving projection metadata, repeated cursors and truncated inventories", async () => {
  const { page } = book();
  const first = { ...page, totalCount: 2, hasMore: true, nextCursor: "opaque", listingProjection: {
    ...page.listingProjection, activeListingCount: 2, coreUnspentListingCount: 2 }, listingAuthority: {
    ...page.listingAuthority, checkedListingCount: 2, inputListingCount: 2, outputListingCount: 2, unspentListingCount: 2 } };
  const second = { ...first, cursor: "opaque", nextCursor: "", start: 1, end: 2, hasMore: false,
    items: [{ ...page.items[0], listingId: HASH }], indexedAt: "2026-10-01T00:00:01.000Z" };
  let calls = 0;
  await assert.rejects(inventory({ get: async () => calls++ ? second : first }, "/api/v1/token-history", "book"), /PAGED_CHECKPOINT_CHANGED/u);
  await assert.rejects(inventory({ get: async () => ({ ...first, hasMore: false, nextCursor: "" }) }, "/api/v1/token-history", "book"), /INCOMPLETE/u);
  const initial = { ...first, totalCount: 3,
    listingProjection: { ...first.listingProjection, activeListingCount: 3, coreUnspentListingCount: 3 },
    listingAuthority: { ...first.listingAuthority, checkedListingCount: 3, inputListingCount: 3,
      outputListingCount: 3, unspentListingCount: 3 } };
  const repeated = { ...initial, cursor: "opaque", start: 1, end: 2,
    items: [{ ...page.items[0], listingId: HASH }] };
  calls = 0;
  await assert.rejects(inventory({ get: async () => calls++ ? repeated : initial },
    "/api/v1/token-history", "book"), /REPEATED_CURSOR/u);
});
test("verification source reuses existing strict gates and never persists child environments or raw errors", () => {
  const source = readFileSync(new URL("./verify-candidate.mjs", import.meta.url), "utf8");
  assert.match(source, /scripts\/check-proof-indexer-parity\.mjs/u);
  assert.match(source, /receipt\.checkCount === 102/u);
  assert.match(source, /authorityBase/u);
  assert.match(source, /report\.walletQualification = report\.wallet\.ready/u);
  assert.doesNotMatch(source, /requireFact\(report\.wallet\.ready/u);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*process\.env/u);
  assert.doesNotMatch(source, /writeFile\([^\n]*(?:run\.raw|env)/u);
});
