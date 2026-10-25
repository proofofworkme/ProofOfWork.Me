import { createHash, randomBytes } from "node:crypto";
import { setImmediate as yieldToIo } from "node:timers/promises";

// A display read model. Nothing in this module is transaction admission evidence.
export const AMO_BROWSE_CONTRACT = "proof-amo-browse-v1";
const HASH = /^[0-9a-f]{64}$/u;
const SORTS = ["newest", "oldest", "price-asc", "price-desc", "arb-asc", "arb-desc"];
const jsonHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const counts = () => ({ all: 0, sealed: 0, unsealed: 0 });
const lower = (value) => String(value ?? "").trim().toLowerCase();
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, details: { code } });

function integer(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = String(value ?? "");
  return /^\d{1,100}$/u.test(text) ? BigInt(text) : null;
}

function decimal(value) {
  const text = String(value ?? "");
  if (!/^\d{1,100}(?:\.\d{1,32})?$/u.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const numerator = BigInt(whole + fraction);
  return numerator > 0n ? { numerator, denominator: 10n ** BigInt(fraction.length) } : null;
}

function rationalCompare(left, right, descending) {
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  const a = left.numerator * right.denominator;
  const b = right.numerator * left.denominator;
  const comparison = a < b ? -1 : a > b ? 1 : 0;
  return descending ? -comparison : comparison;
}

function listingMetrics(item, summary, definitions, assets, sealed) {
  const work = item.tokenId === assets.work;
  const scale = work ? 10_000_000_000_000_000n : 1n;
  const amount = integer(work ? item.amountSubatoms : item.amount);
  const price = integer(item.priceSats);
  const unitPrice = amount !== null && amount > 0n && price !== null
    ? { numerator: price * scale, denominator: amount } : null;
  const definition = definitions.get(item.tokenId);
  const floor = summary.workFloor;
  const q8 = integer(floor?.liveFloorQ8 ?? floor?.actualValue?.liveFloorQ8 ?? floor?.floorQ8 ?? floor?.actualValue?.floorQ8);
  const mintPrice = integer(definition?.mintPriceSats);
  const mintAmount = integer(definition?.mintAmount);
  const bond = item.tokenId === assets.powb || item.tokenId === assets.incb;
  const bondQ8 = integer(summary.browseBondReferences?.[item.tokenId]?.floorQ8);
  const reference = work
    ? q8 !== null && q8 > 0n ? { numerator: q8, denominator: 100_000_000n } : null
    : bond ? bondQ8 !== null && bondQ8 > 0n ? { numerator: bondQ8, denominator: 100_000_000n } : null
    : decimal(definition?.lastSalePricePerToken) ?? decimal(definition?.pricePerToken) ??
      (mintPrice !== null && mintPrice > 0n && mintAmount !== null && mintAmount > 0n
        ? { numerator: mintPrice, denominator: mintAmount } : null);
  const frozen = item.workAmoFrozenTerms ?? item.frozenTerms;
  const frozenMatches = !work || (item.confirmed === true && frozen?.version === "pwt-sale-v8" &&
    integer(frozen.unitAmountSubatoms) === amount && integer(frozen.unitPriceSats) === price);
  const arb = sealed && frozenMatches && reference && amount !== null && amount > 0n && price !== null && price > 0n
    ? { numerator: reference.numerator * amount - price * reference.denominator * scale,
        denominator: reference.denominator * scale } : null;
  return { unitPrice, arb };
}

// Bound before cloning/freezing. Source rows have already passed the canonical
// reader; only plain JSON is retained, with no mutable evidence shared to callers.
function copyJson(value, budget, depth = 0) {
  if (depth > 32 || ++budget.nodes > budget.maxNodes) throw new Error("AMO browse snapshot exceeds its structural budget.");
  if (value === null || typeof value === "boolean") { budget.bytes += 8; return value; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("AMO browse snapshot contains a nonfinite number.");
    budget.bytes += 24;
    return value;
  }
  if (typeof value === "string") {
    budget.bytes += Buffer.byteLength(value, "utf8") + 4;
    if (budget.bytes > budget.maxBytes) throw new Error("AMO browse snapshot exceeds its byte budget.");
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => copyJson(entry, budget, depth + 1)));
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error("AMO browse snapshot contains unsupported data.");
  }
  const result = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    budget.bytes += Buffer.byteLength(key, "utf8") + 4;
    if (budget.bytes > budget.maxBytes) throw new Error("AMO browse snapshot exceeds its byte budget.");
    result[key] = copyJson(entry, budget, depth + 1);
  }
  if (budget.bytes > budget.maxBytes) throw new Error("AMO browse snapshot exceeds its byte budget.");
  return Object.freeze(result);
}

const OMIT_DISPLAY_KEYS = new Set([
  "worker", "workerReadiness", "readiness", "diagnostics", "checks", "consistency",
  "parsed", "payload", "transactions", "listingAuthority", "listingProjection",
  "migrationReadiness", "liveMempoolSnapshot",
  "workAmoV5ReplayOutput", "workAmoV5ReplayRawWitness", "workAmoV5RawScriptWitness",
]);
const WORK_STATUS_KEYS = new Set(["workMarketplaceV4", "workAmoV5", "workAmoV6", "workAmoV8"]);

function displayWorkStatus(value) {
  if (!value || typeof value !== "object") return value;
  return {
    ...value, displayOnly: true, ready: false, protocolReady: false, writeAdmission: false,
    protocolWritesEnabled: false, listingWritesEnabled: false, settlementWritesEnabled: false,
    reasonCode: "amo-browse-display-requires-fresh-preflight",
    ...(value.activation ? { activation: { ...value.activation, tipVerified: false } } : {}),
  };
}

function compactDisplayValue(value, depth = 0) {
  if (depth > 24) throw new Error("AMO browse summary is too deeply nested.");
  if (Array.isArray(value)) return value.map((entry) => compactDisplayValue(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !OMIT_DISPLAY_KEYS.has(key))
    .map(([key, entry]) => [key, compactDisplayValue(WORK_STATUS_KEYS.has(key) ? displayWorkStatus(entry) : entry, depth + 1)]));
}

export function compactAmoBrowseSummary(summary, items = [], isSealed = () => false) {
  const byToken = new Map();
  const total = { activeListings: items.length, openListings: items.length,
    confirmedOpenListings: 0, pendingOpenListings: 0, sealedListings: 0 };
  for (const item of items) {
    const value = byToken.get(item.tokenId) ?? { openListings: 0, confirmedOpenListings: 0, pendingOpenListings: 0, sealedListings: 0 };
    value.openListings += 1;
    const confirmation = item.confirmed === true ? "confirmedOpenListings" : "pendingOpenListings";
    value[confirmation] += 1;
    total[confirmation] += 1;
    if (isSealed(item)) { value.sealedListings += 1; total.sealedListings += 1; }
    byToken.set(item.tokenId, value);
  }
  const result = compactDisplayValue({
    indexedAt: summary.indexedAt,
    indexedThroughBlock: summary.indexedThroughBlock,
    indexedThroughBlockHash: summary.indexedThroughBlockHash,
    ledgerGeneratedAt: summary.ledgerGeneratedAt,
    network: summary.network,
    snapshotId: summary.snapshotId,
    summaryOnly: true,
    registry: summary.registry,
    token: {
      ...summary.token, listings: [], mints: [], transfers: [], transferBatches: [], holders: [], invalidEvents: [],
      stats: { ...summary.token?.stats, ...total },
      totalCounts: { ...summary.token?.totalCounts, listings: items.length },
      collectionHasMore: { ...summary.token?.collectionHasMore, listings: items.length > 0,
        ...Object.fromEntries(["mints", "transfers", "transferBatches", "holders", "invalidEvents"].map((key) =>
          [key, summary.token?.collectionHasMore?.[key] === true || (summary.token?.[key]?.length ?? 0) > 0])),
      },
      tokens: (summary.token?.tokens ?? []).map((token) => ({ ...token,
        ...(byToken.get(token.tokenId) ?? { openListings: 0, confirmedOpenListings: 0, pendingOpenListings: 0, sealedListings: 0 }),
      })),
    },
    workFloor: summary.workFloor,
    browseBondReferences: summary.browseBondReferences,
    workMarketplaceV4: summary.workMarketplaceV4,
    workAmoV5: summary.workAmoV5,
    workAmoV6: summary.workAmoV6,
    workAmoV8: summary.workAmoV8,
    provenance: { ...summary.provenance, ready: false, requested: "stable", served: "last-good", displayOnly: true },
  });
  return result;
}

function validateCandidate(candidate, maxListings, assets) {
  const { summary, book, checkpoint } = candidate ?? {};
  const height = checkpoint?.height;
  const hash = checkpoint?.blockHash;
  if (!Number.isSafeInteger(height) || height < 1 || !HASH.test(hash ?? "") ||
      summary?.network !== "livenet" || summary?.provenance?.coherent !== true ||
      summary?.provenance?.ready !== true || summary?.provenance?.served !== "exact-tip" ||
      summary.indexedThroughBlock !== height || summary.indexedThroughBlockHash !== hash ||
      summary.provenance.indexedThroughBlock !== height || summary.provenance.indexedThroughBlockHash !== hash ||
      !summary.snapshotId || summary.provenance.snapshotId !== summary.snapshotId ||
      ![summary.registry, summary.token, summary.workFloor].every((part) => part?.snapshotId === summary.snapshotId) ||
      book?.indexedThroughBlock !== height || book?.indexedThroughBlockHash !== hash ||
      !book.snapshotId || !Array.isArray(book.items) || book.items.length > maxListings ||
      book.totalCount !== book.items.length || book.hasMore !== false || book.start !== 0 ||
      book.end !== book.items.length || book.listingProjection?.scope !== "complete-book" ||
      book.listingProjection?.activeListingCount !== book.items.length ||
      book.listingAuthority?.model !== "proof-token-market-core-gettxout-v1" ||
      book.listingAuthority?.includeMempool !== true ||
      book.listingAuthority?.checkpoint?.height !== height || book.listingAuthority?.checkpoint?.blockHash !== hash ||
      book.itemProjection?.model !== "proof-token-listing-display-v2" ||
      !HASH.test(book.listingAuthority?.checkedOutpointsSha256 ?? "") ||
      !HASH.test(book.itemProjection?.fullSourceSha256 ?? "") ||
      !HASH.test(book.itemProjection?.fullMembershipSha256 ?? "") ||
      !HASH.test(book.listingProjection?.membershipSha256 ?? "")) {
    throw new Error("AMO browse source is incomplete or does not share one verified checkpoint.");
  }
  const authority = book.listingAuthority;
  const projection = book.listingProjection;
  for (const tokenId of [assets.powb, assets.incb]) {
    const reference = summary.browseBondReferences?.[tokenId];
    if (!reference && !book.items.some((item) => item.tokenId === tokenId)) continue;
    if (reference?.displayOnly !== true || reference.indexedThroughBlock !== height ||
        reference.indexedThroughBlockHash !== hash || !reference.snapshotId ||
        !/^(0|[1-9]\d{0,99})$/u.test(reference.floorQ8 ?? "") ||
        !Number.isFinite(Date.parse(reference.indexedAt))) {
      throw new Error("AMO browse bond floor does not share the verified listing checkpoint.");
    }
  }
  if (![authority.checkedListingCount, authority.inputListingCount, authority.outputListingCount,
      authority.spentListingCount, authority.unspentListingCount, projection.coreUnspentListingCount,
      projection.excludedByProtocolCount].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      authority.checkedListingCount !== authority.inputListingCount ||
      authority.outputListingCount !== authority.unspentListingCount ||
      authority.spentListingCount + authority.unspentListingCount !== authority.inputListingCount ||
      projection.coreUnspentListingCount !== authority.unspentListingCount ||
      projection.activeListingCount + projection.excludedByProtocolCount !== projection.coreUnspentListingCount) {
    throw new Error("AMO browse source lacks complete Core membership counts.");
  }
  const ids = new Set();
  const omittedFields = new Set(["workAmoV5ReplayOutput", "workAmoV5ReplayRawWitness", "workAmoV5RawScriptWitness", "parsed", "listing", "payload"]);
  for (const item of book.items) {
    const evidence = item?.displayEvidence;
    if (!HASH.test(item?.listingId ?? "") || !HASH.test(item?.tokenId ?? "") || ids.has(item.listingId) ||
        item.network !== "livenet" || item.confirmed !== true ||
        evidence?.model !== "proof-token-listing-display-v2" || !HASH.test(evidence.fullRecordSha256 ?? "") ||
        !Array.isArray(evidence.omittedFields) || !evidence.omittedFields.every((field) => omittedFields.has(field)) ||
        typeof evidence.fullDetailPath !== "string" || !evidence.fullDetailPath.startsWith("/api/v1/token-history?")) {
      throw new Error("AMO browse source contains an invalid or repeated listing.");
    }
    const detail = new URL(evidence.fullDetailPath, "https://proof.invalid").searchParams;
    if (detail.get("kind") !== "listings" || detail.get("network") !== "livenet" || detail.get("projection") !== "full" ||
        detail.get("listingId") !== item.listingId || detail.get("q") !== item.listingId) {
      throw new Error("AMO browse listing detail does not bind its original evidence.");
    }
    ids.add(item.listingId);
  }
}

/** No persistence: a restart warms through the canonical readers before serving. */
export function createAmoBrowseSnapshotStore({
  build, observe, assets, isSealed, now = Date.now, onError = () => {},
  intervalMs = 60_000, observationIntervalMs = 15_000, minimumRefreshMs = 15_000,
  maxAgeMs = 10 * 60_000, maxVersions = 2, maxListings = 5_000,
  maxBytes = 32 * 1024 * 1024, maxNodes = 750_000,
}) {
  const versions = new Map();
  const incarnation = randomBytes(16).toString("hex");
  let latest = null;
  let inFlight = null;
  let observationFlight = null;
  let lastAttemptAt = -Infinity;
  let lastFailure = null;
  let chainObservation = null;
  let timer = null;
  let observationTimer = null;
  let started = false;
  let queued = false;
  let generation = 0;
  let lifecycle = 0;
  const reportError = (error) => {
    // Observability must not turn an already handled warm-up failure into an
    // unhandled rejection in a detached timer.
    try { onError(error); } catch { /* retain the qualified snapshot */ }
  };

  function prune() {
    for (const [version, value] of versions) if (now() - value.observedMs > maxAgeMs) versions.delete(version);
    while (versions.size > maxVersions) versions.delete(versions.keys().next().value);
    if (latest && !versions.has(latest.version)) latest = null;
  }

  async function prepare(candidate) {
    validateCandidate(candidate, maxListings, assets);
    const observedMs = Date.parse(candidate.observedAt);
    if (!Number.isFinite(observedMs) || observedMs > now() + 1_000 || now() - observedMs > maxAgeMs) {
      throw new Error("AMO browse observation time is unavailable or expired.");
    }
    const budget = { bytes: 0, nodes: 0, maxBytes, maxNodes };
    // Budget the original summary before projection; a malformed diagnostic
    // envelope cannot cause an unbounded copy merely because it will be omitted.
    const boundedSummary = copyJson(candidate.summary, budget);
    const summary = copyJson(compactAmoBrowseSummary(boundedSummary, candidate.book.items, isSealed), budget);
    const definitions = new Map((summary.token?.tokens ?? []).map((item) => [item.tokenId, item]));
    const assetCounts = Object.create(null);
    for (const id of definitions.keys()) assetCounts[id] = counts();
    const entries = [];
    let deadline = performance.now() + 4;
    for (const source of candidate.book.items) {
      const item = copyJson(source, budget);
      const sealed = isSealed(item);
      const metrics = listingMetrics(item, summary, definitions, assets, sealed);
      const definition = definitions.get(item.tokenId);
      const searchable = JSON.stringify([item, definition?.ticker, definition?.name]).toLowerCase();
      budget.bytes += Buffer.byteLength(searchable);
      if (budget.bytes > maxBytes) throw new Error("AMO browse snapshot exceeds its search budget.");
      entries.push({ item, sealed, searchable, ...metrics, time: Date.parse(item.createdAt) || 0 });
      const total = assetCounts[item.tokenId] ??= counts();
      total.all += 1;
      total[sealed ? "sealed" : "unsealed"] += 1;
      if (performance.now() >= deadline) { await yieldToIo(); deadline = performance.now() + 4; }
    }
    const ordered = new Map();
    const fallback = (a, b) => b.time - a.time || (a.item.listingId < b.item.listingId ? -1 : a.item.listingId > b.item.listingId ? 1 : 0);
    for (const sort of SORTS) {
      ordered.set(sort, [...entries].sort((a, b) => {
        if (sort === "newest") return fallback(a, b);
        if (sort === "oldest") return -fallback(a, b);
        const key = sort.startsWith("price-") ? "unitPrice" : "arb";
        return rationalCompare(a[key], b[key], sort.endsWith("-desc")) || fallback(a, b);
      }));
      await yieldToIo();
    }
    const source = copyJson({
      snapshotId: candidate.summary.snapshotId,
      indexedAt: candidate.summary.indexedAt,
      indexedThroughBlock: candidate.checkpoint.height,
      indexedThroughBlockHash: candidate.checkpoint.blockHash,
      listingSnapshotId: candidate.book.snapshotId,
      listingIndexedAt: candidate.book.indexedAt,
      membershipSha256: candidate.book.itemProjection.fullMembershipSha256,
      fullSourceSha256: candidate.book.itemProjection.fullSourceSha256,
      protocolMembershipSha256: candidate.book.listingProjection.membershipSha256,
      checkedOutpointsSha256: candidate.book.listingAuthority.checkedOutpointsSha256,
    }, budget);
    return {
      version: jsonHash([incarnation, source, candidate.observedAt, ++generation]),
      observedMs, observedAt: new Date(observedMs).toISOString(), summary, source,
      checkpoint: copyJson(candidate.checkpoint, budget), entries, ordered,
      assetCounts: copyJson(assetCounts, budget),
      itemProjection: copyJson(candidate.book.itemProjection, budget),
    };
  }

  function schedule() {
    if (!started) return;
    queued = false;
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, intervalMs);
    timer.unref?.();
  }

  function refresh() {
    if (inFlight) return inFlight;
    if (now() - lastAttemptAt < minimumRefreshMs) {
      if (started && !queued) {
        queued = true;
        clearTimeout(timer);
        timer = setTimeout(() => { queued = false; void refresh(); }, minimumRefreshMs - (now() - lastAttemptAt));
        timer.unref?.();
      }
      return Promise.resolve(false);
    }
    queued = false;
    lastAttemptAt = now();
    const startedLifecycle = lifecycle;
    inFlight = Promise.resolve().then(build).then(prepare).then(async (candidate) => {
      if (observe) {
        const observation = await observe([{ version: candidate.version, ...candidate.checkpoint }]);
        if (!Number.isSafeInteger(observation?.height) || !HASH.test(observation?.blockHash ?? "") ||
            !Array.isArray(observation?.invalidVersions) || observation.invalidVersions.includes(candidate.version)) {
          throw new Error("AMO browse checkpoint changed before publication.");
        }
        chainObservation = { available: true, checkedAt: new Date(now()).toISOString(), height: observation.height, blockHash: observation.blockHash };
      }
      if (lifecycle !== startedLifecycle) return false;
      versions.set(candidate.version, candidate);
      latest = candidate;
      lastFailure = null;
      prune();
      return true;
    }).catch((error) => {
      lastFailure = { code: "AMO_BROWSE_REFRESH_UNAVAILABLE", at: new Date(now()).toISOString() };
      reportError(error);
      prune();
      return false;
    }).finally(() => { inFlight = null; lastAttemptAt = now(); schedule(); });
    return inFlight;
  }

  async function poll() {
    if (observationFlight || !observe) return observationFlight;
    observationFlight = (async () => {
      try {
        prune();
        const checkpoints = [...versions.values()].map((snapshot) => ({ version: snapshot.version, ...snapshot.checkpoint }));
        const result = await observe(checkpoints);
        if (!Number.isSafeInteger(result?.height) || !HASH.test(result?.blockHash ?? "") || !Array.isArray(result?.invalidVersions)) {
          throw new Error("AMO browse chain observation is malformed.");
        }
        chainObservation = { available: true, checkedAt: new Date(now()).toISOString(), height: result.height, blockHash: result.blockHash };
        for (const version of result.invalidVersions) versions.delete(version);
        if (latest && !versions.has(latest.version)) latest = null;
        if (result.invalidVersions.length || (latest && latest.checkpoint.blockHash !== result.blockHash)) void refresh();
      } catch (error) {
        chainObservation = { available: false, checkedAt: new Date(now()).toISOString() };
        reportError(error);
      } finally {
        observationFlight = null;
        if (started) { observationTimer = setTimeout(() => { void poll(); }, observationIntervalMs); observationTimer.unref?.(); }
      }
    })();
    return observationFlight;
  }

  function read(params = new URLSearchParams()) {
    prune();
    const asset = lower(params.get("asset") || "all");
    const status = lower(params.get("status") || "all");
    const sort = lower(params.get("sort") || "arb-desc");
    const q = lower(params.get("q"));
    const limit = Number(params.get("limit") || 25);
    if (!(asset === "all" || asset === "credits" || Object.hasOwn(assets, asset) || HASH.test(asset)) ||
        !["all", "sealed", "unsealed"].includes(status) || !SORTS.includes(sort) || q.length > 512 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || params.has("page") || params.has("offset")) {
      throw fail(400, "AMO_BROWSE_REQUEST_INVALID", "Invalid AMO browse scope, filter, sort or page size.");
    }
    const fingerprint = jsonHash([asset, status, sort, q, limit]);
    let cursor = null;
    if (params.get("cursor")) {
      try {
        const raw = params.get("cursor");
        if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(raw)) throw new Error();
        cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        if (cursor.contract !== AMO_BROWSE_CONTRACT || !HASH.test(cursor.version ?? "") || cursor.fingerprint !== fingerprint ||
            !Number.isSafeInteger(cursor.offset) || cursor.offset <= 0 || cursor.offset > maxListings ||
            !HASH.test(cursor.last ?? "")) throw new Error();
      } catch { throw fail(409, "AMO_BROWSE_CURSOR_CONFLICT", "AMO browse continuation changed; restart from the first page."); }
    }
    const explicitVersion = params.get("version");
    if (explicitVersion && cursor && explicitVersion !== cursor.version) {
      throw fail(409, "AMO_BROWSE_CURSOR_CONFLICT", "AMO browse version does not match its cursor.");
    }
    const requestedVersion = explicitVersion || cursor?.version;
    const snapshot = requestedVersion ? versions.get(requestedVersion) : latest;
    if (!snapshot) {
      if (requestedVersion) throw fail(409, "AMO_BROWSE_VERSION_EXPIRED", "This AMO browse version expired; restart from the first page.");
      throw fail(503, "AMO_BROWSE_WARMING", "The verified AMO browsing snapshot is warming. Please retry shortly.");
    }
    const scopeToken = assets[asset] ?? asset;
    const scopeMatches = (id) => asset === "all" || (asset === "credits" ? id !== assets.powb && id !== assets.incb : id === scopeToken);
    const scopeCounts = counts();
    for (const [id, values] of Object.entries(snapshot.assetCounts)) if (scopeMatches(id)) {
      for (const key of Object.keys(scopeCounts)) scopeCounts[key] += values[key];
    }
    const filtered = snapshot.ordered.get(sort).filter((entry) => scopeMatches(entry.item.tokenId) &&
      (status === "all" || (status === "sealed") === entry.sealed) && (!q || entry.searchable.includes(q)));
    const offset = cursor?.offset ?? 0;
    if (cursor && (offset >= filtered.length || filtered[offset - 1]?.item.listingId !== cursor.last)) {
      throw fail(409, "AMO_BROWSE_CURSOR_CONFLICT", "AMO browse continuation has an invalid boundary.");
    }
    const end = Math.min(offset + limit, filtered.length);
    const items = filtered.slice(offset, end).map((entry) => entry.item);
    const hasMore = end < filtered.length;
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({
      contract: AMO_BROWSE_CONTRACT, version: snapshot.version, fingerprint, offset: end, last: items.at(-1).listingId,
    })).toString("base64url") : "";
    return {
      contract: AMO_BROWSE_CONTRACT, network: "livenet", displayOnly: true,
      state: "last-verified", version: snapshot.version, observedAt: snapshot.observedAt,
      checkpoint: snapshot.checkpoint, source: snapshot.source,
      refreshing: Boolean(inFlight) || queued, refreshState: inFlight ? "running" : queued ? "queued" : "idle", refreshError: lastFailure,
      ...(params.get("includeSummary") === "0" ? {} : { summary: snapshot.summary }),
      book: { items, totalCount: filtered.length, counts: scopeCounts, assetCounts: snapshot.assetCounts,
        itemProjection: snapshot.itemProjection,
        hasMore, nextCursor, limit, start: offset, end, page: Math.floor(offset / limit),
        asset, status, sort, query: q },
      query: { asset, status, q, sort },
      provenance: {
        displayOnly: true, authoritative: false, completeAtObservation: true,
        observedAt: snapshot.observedAt, ageMs: Math.max(0, now() - snapshot.observedMs), maxAgeMs,
        currentChain: chainObservation,
        mempool: { includedAtObservation: true, continuouslyCurrent: false },
        signingRequiresFreshPreflight: true,
      },
    };
  }

  return {
    read, refresh, poll,
    start() {
      if (started) return;
      started = true;
      void refresh();
      void poll();
    },
    stop() { lifecycle += 1; started = false; queued = false; clearTimeout(timer); clearTimeout(observationTimer); },
  };
}
