import { createHash } from "node:crypto";
import {
  normalizePublishArticleMetadata, publishArticleBodyBytes, PUBLISH_ARTICLE_VERIFICATION,
} from "../../src/shared/protocol/publishArticle.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const CURSOR_PREFIX = "boost-feed-v1.";
const MAX_CURSOR_BYTES = 2048;
const MAX_WAITERS = 16;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export class PublishReadError extends Error {
  constructor(message, { statusCode = 503, code = "PUBLISH_UNAVAILABLE", cause } = {}) {
    super(message, { cause });
    this.name = "PublishReadError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireEvidence(condition, message = "Confirmed article evidence is unavailable.") {
  if (!condition) throw new PublishReadError(message);
}

function missing() {
  return new PublishReadError("Confirmed article not found.", { statusCode: 404, code: "PUBLISH_NOT_FOUND" });
}

function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? value : null;
}

function snapshot(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    !/[\s\u0000-\u001f\u007f]/u.test(value) && publishArticleBodyBytes(value) !== null;
}

function cursorValue(value) {
  requireEvidence(typeof value === "string" && Buffer.byteLength(value) <= MAX_CURSOR_BYTES,
    "Article directory cursor is invalid; start from the first page.");
  if (!value) return null;
  try {
    requireEvidence(value.startsWith(CURSOR_PREFIX));
    const encoded = value.slice(CURSOR_PREFIX.length);
    requireEvidence(/^[A-Za-z0-9_-]+$/u.test(encoded));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded, "base64url"));
    const result = JSON.parse(decoded);
    requireEvidence(object(result) && Object.keys(result).sort().join() === "fingerprint,offset,snapshotId" &&
      HASH.test(result.fingerprint) && integer(result.offset) && result.offset > 0 && snapshot(result.snapshotId) &&
      Buffer.from(JSON.stringify(result)).toString("base64url") === encoded);
    return result;
  } catch (cause) {
    throw new PublishReadError("Article directory cursor is invalid; start from the first page.", { cause });
  }
}

function checkpoint(payload) {
  requireEvidence(object(payload) && payload.complete === true && payload.network === "livenet" &&
    snapshot(payload.snapshotId) && integer(payload.indexedThroughBlock) && payload.indexedThroughBlock > 0 &&
    HASH.test(payload.indexedThroughBlockHash) && date(payload.indexedAt));
  const provenance = payload.provenance;
  requireEvidence(object(provenance) && provenance.model === "boost-complete-events-v1" &&
    provenance.network === "livenet" && provenance.snapshotId === payload.snapshotId &&
    provenance.indexedThroughBlock === payload.indexedThroughBlock &&
    provenance.indexedThroughBlockHash === payload.indexedThroughBlockHash && provenance.indexedAt === payload.indexedAt &&
    integer(provenance.eventCount) && integer(provenance.totalCount) && provenance.eventCount === provenance.totalCount &&
    integer(provenance.pages) && provenance.pages > 0);
  return Object.freeze({ snapshotId: payload.snapshotId, height: payload.indexedThroughBlock,
    hash: payload.indexedThroughBlockHash, indexedAt: payload.indexedAt });
}

function pageEvidence(payload, requestedCursor, limit) {
  const prior = cursorValue(requestedCursor);
  requireEvidence(Array.isArray(payload.items) && payload.items.length <= limit &&
    integer(payload.start) && integer(payload.end) && integer(payload.totalCount) &&
    payload.totalCount <= payload.provenance.eventCount && payload.start === (prior?.offset ?? 0) &&
    payload.end === payload.start + payload.items.length && payload.end <= payload.totalCount &&
    typeof payload.hasMore === "boolean" && payload.hasMore === (payload.end < payload.totalCount) &&
    typeof payload.nextCursor === "string");
  requireEvidence(!prior || prior.snapshotId === payload.snapshotId,
    "Article directory checkpoint changed; start from the first page.");
  if (payload.hasMore) {
    const next = cursorValue(payload.nextCursor);
    requireEvidence(payload.items.length > 0 && next && next.offset === payload.end &&
      next.snapshotId === payload.snapshotId && (!prior || next.fingerprint === prior.fingerprint));
  } else requireEvidence(payload.nextCursor === "");
}

function articleSummary(post) {
  requireEvidence(object(post) && post.kind === "boost-post" && post.confirmed === true &&
    post.network === "livenet" && HASH.test(post.txid) &&
    (!post.boostTxid || post.boostTxid === post.txid));
  const article = normalizePublishArticleMetadata(post.article);
  requireEvidence(article && post.articleVerification === PUBLISH_ARTICLE_VERIFICATION);
  // Address authority comes from the existing confirmed API projection. Never
  // substitute the current asset owner, a profile label, or a caller parameter.
  requireEvidence(typeof post.authorAddress === "string" && post.authorAddress.length <= 128 &&
    /^[A-Za-z0-9]+$/u.test(post.authorAddress));
  const display = post.authorDisplay ?? post.authorAddress;
  requireEvidence(typeof display === "string" && display.length <= 512 && publishArticleBodyBytes(display) !== null);
  return Object.freeze({ txid: post.txid, title: article.title, size: article.size, sha256: article.sha256,
    authorAddress: post.authorAddress, authorDisplay: display || post.authorAddress,
    // Boost's createdAt can fall back to indexedAt or now. The current endpoint
    // exposes no verified block timestamp, so it cannot supply datePublished.
    publishedAt: null });
}

function articleResult(payload, txid) {
  const point = checkpoint(payload);
  requireEvidence(payload.mode === "detail");
  pageEvidence(payload, "", 1);
  const post = payload.post;
  requireEvidence(object(post) && post.txid === txid && post.confirmed === true);
  if (post.kind !== "boost-post" || (!post.article && !post.articleVerification)) throw missing();
  const summary = articleSummary(post);
  const bytes = publishArticleBodyBytes(post.articleBody);
  requireEvidence(bytes && bytes.length === summary.size && sha256(bytes) === summary.sha256);
  return Object.freeze({ ...summary, body: post.articleBody, checkpoint: point });
}

function directoryResult(payload, cursor) {
  const point = checkpoint(payload);
  requireEvidence(payload.mode === "timeline" && payload.format === "article" && payload.sort === "newest" &&
    payload.valueWindow === "all" && payload.view === "all" && payload.source === "proof-indexer-events");
  pageEvidence(payload, cursor, 100);
  const unique = new Map();
  const events = new Set();
  for (const row of payload.items) {
    requireEvidence(object(row) && HASH.test(row.txid) && row.confirmed === true && row.network === "livenet" &&
      ["boost-post", "boost-reboost"].includes(row.kind));
    const event = `${row.kind}:${row.txid}`;
    requireEvidence(!events.has(event)); events.add(event);
    const post = row.kind === "boost-reboost" ? row.reboostedPost : row;
    if (row.kind === "boost-reboost") requireEvidence(object(post) && row.targetTxid === post.txid &&
      (!row.boostTxid || row.boostTxid === post.txid));
    const summary = articleSummary(post);
    const previous = unique.get(summary.txid);
    requireEvidence(!previous || JSON.stringify(previous) === JSON.stringify(summary));
    unique.set(summary.txid, summary);
  }
  return Object.freeze({ articles: Object.freeze([...unique.values()]), checkpoint: point,
    start: payload.start, end: payload.end, totalCount: payload.totalCount,
    hasMore: payload.hasMore, nextCursor: payload.nextCursor });
}

/**
 * The configured first-party API supplies confirmed chain authority; this
 * adapter does not independently replay Core/index history. Rehashing the body
 * prevents accidental unverified or inconsistent responses from reaching HTML.
 *
 * readArticle(txid) -> frozen {txid,title,body,size,sha256,authorAddress,
 *   authorDisplay,publishedAt:string|null,checkpoint:{snapshotId,height,hash,indexedAt}}
 * readDirectory({cursor}={}) -> frozen {articles:[article fields without body or
 *   checkpoint],checkpoint,start,end,totalCount,hasMore,nextCursor}. Counts and
 *   cursor offsets count upstream events; article links deduplicate originals
 *   and reboost targets within this page. Cross-page consumers dedupe by txid.
 *
 * No completed response cache. At most maxConcurrent upstream operations and
 * 16 waiting callers per key; no queue. A disconnected caller must not cancel
 * other callers' shared read. close() aborts every outstanding operation.
 */
export function createPublishReader({ apiOrigin, fetchImpl = globalThis.fetch, timeoutMs = 15_000,
  maxResponseBytes = 2 * 1024 ** 2, maxConcurrent = 2 } = {}) {
  let origin;
  try {
    origin = new URL(apiOrigin);
    if (typeof apiOrigin !== "string" || /\s/u.test(apiOrigin) || !["https:", "http:"].includes(origin.protocol) ||
        origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
  } catch { throw new TypeError("apiOrigin must be a trusted HTTP(S) origin without credentials, path, query or fragment."); }
  for (const [name, value, ceiling] of [["timeoutMs", timeoutMs, 60_000],
    ["maxResponseBytes", maxResponseBytes, 8 * 1024 ** 2], ["maxConcurrent", maxConcurrent, 16]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new TypeError(`Invalid ${name}.`);
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
  const inflight = new Map();
  let closed = false;

  async function fetchJson(url, signal) {
    const deadline = performance.now() + timeoutMs;
    const response = await fetchImpl(url.href, { signal, redirect: "error", credentials: "omit",
      cache: "no-store", headers: { Accept: "application/json" } });
    const cancel = () => { void response.body?.cancel().catch(() => {}); };
    if (response.redirected || response.url && response.url !== url.href || response.status >= 300 && response.status < 400) {
      cancel(); throw new PublishReadError("Article source redirected unexpectedly.");
    }
    if (response.status === 404) { cancel(); throw missing(); }
    if (response.status !== 200) { cancel(); throw new PublishReadError("Article source is temporarily unavailable."); }
    const length = response.headers.get("content-length");
    if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") ||
        length !== null && (!/^\d+$/u.test(length) || Number(length) > maxResponseBytes) || !response.body) {
      cancel(); throw new PublishReadError("Article source returned an invalid or oversized response.");
    }
    const stream = response.body.getReader();
    const buffer = Buffer.allocUnsafe(maxResponseBytes);
    let bytes = 0;
    let chunks = 0;
    try {
      for (;;) {
        if (performance.now() >= deadline) throw new PublishReadError("Article source timed out.", { code: "PUBLISH_TIMEOUT" });
        const chunk = await stream.read();
        if (chunk.done) break;
        chunks += 1;
        requireEvidence(chunks <= 65_536, "Article source response has too many chunks.");
        const offset = bytes;
        bytes += chunk.value.byteLength;
        requireEvidence(bytes <= maxResponseBytes, "Article source response exceeds its byte limit.");
        buffer.set(chunk.value, offset);
      }
    } catch (error) {
      void stream.cancel().catch(() => {});
      throw error;
    } finally { stream.releaseLock(); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)));
  }

  async function run(key, params, validate) {
    if (closed) throw new PublishReadError("Article reader is closed.");
    let job = inflight.get(key);
    if (!job) {
      if (inflight.size >= maxConcurrent) throw new PublishReadError("Article reader is busy; retry shortly.", { code: "PUBLISH_BUSY" });
      const controller = new AbortController();
      let rejectStopped;
      const stopped = new Promise((_, reject) => { rejectStopped = reject; });
      job = { waiters: 0, controller, promise: null, stop: null };
      job.stop = error => { clearTimeout(timer); controller.abort(error); rejectStopped(error); };
      inflight.set(key, job);
      const timer = setTimeout(() => job.stop(new PublishReadError("Article source timed out.", { code: "PUBLISH_TIMEOUT" })), timeoutMs);
      const url = new URL("/api/v1/boost", origin);
      url.search = new URLSearchParams({ network: "livenet", fresh: "1", ...params }).toString();
      const work = Promise.resolve().then(() => fetchJson(url, controller.signal)).then(validate).catch(cause => {
        if (cause instanceof PublishReadError) throw cause;
        throw new PublishReadError("Article source could not supply verified content.", { cause });
      });
      // Keep the slot until the producer actually settles, even if a broken
      // injected transport ignores abort. Timeouts cannot create extra work.
      const finish = () => { clearTimeout(timer); if (inflight.get(key) === job) inflight.delete(key); };
      work.then(finish, finish);
      job.promise = Promise.race([work, stopped]);
    }
    if (job.waiters >= MAX_WAITERS) throw new PublishReadError("Too many readers are waiting; retry shortly.", { code: "PUBLISH_BUSY" });
    job.waiters += 1;
    try { return await job.promise; } finally { job.waiters -= 1; }
  }

  return Object.freeze({
    async readArticle(txid) {
      if (typeof txid !== "string" || !HASH.test(txid)) throw missing();
      return run(`article:${txid}`, { detail: txid, activity: "replies", limit: "1" }, payload => articleResult(payload, txid));
    },
    async readDirectory(options = {}) {
      requireEvidence(object(options) && Object.keys(options).every(key => key === "cursor"));
      const { cursor = "" } = options;
      cursorValue(cursor);
      return run(`directory:${cursor}`, { format: "article", limit: "100", sort: "newest", window: "all", view: "all", ...(cursor ? { cursor } : {}) },
        payload => directoryResult(payload, cursor));
    },
    close() {
      closed = true;
      for (const job of inflight.values()) job.stop(new PublishReadError("Article reader is closed."));
    },
  });
}
