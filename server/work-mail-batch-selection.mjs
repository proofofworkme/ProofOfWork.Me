import { setImmediate as yieldToIo } from "node:timers/promises";
import { workMailBatchDeclarationCommitment, WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT } from "./work-mail-batch-declaration.mjs";
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const position = value => value && Number.isSafeInteger(value.blockHeight) && value.blockHeight > 0 &&
  Number.isSafeInteger(value.blockTransactionIndex) && value.blockTransactionIndex >= 0 &&
  value.blockTransactionIndex <= 2147483647 && hash(value.txid);
const compare = (a, b) => a.blockHeight - b.blockHeight || a.blockTransactionIndex - b.blockTransactionIndex ||
  (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0);
const fail = reason => { throw new Error(reason); };
const cursor = value => ({ blockHeight: value.blockHeight,
  blockTransactionIndex: value.blockTransactionIndex, txid: value.txid });
const checkpointValid = value => Number.isSafeInteger(value?.blockHeight) && value.blockHeight > 0 && hash(value.blockHash);
const endOfBlock = height => ({ blockHeight: height, blockTransactionIndex: 2147483647, txid: "f".repeat(64) });

/** Bounded, resumable discovery from a qualified sealed prefix. Missing Core
 * evidence never advances a page. A verified prefix extension resumes after
 * the previous negative boundary instead of rescanning public memo copies. */
export async function discoverWorkMailBatchDeclaration({ checkpoint, cache = new Map(),
  readCandidates, validateCandidate, verifyCheckpoint, maxCandidates = 64 } = {}) {
  if (!checkpointValid(checkpoint)) fail("work-mail-batch-discovery-checkpoint-invalid");
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 1024) {
    fail("work-mail-batch-discovery-budget-invalid");
  }
  if (checkpoint.blockHeight < WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT) return null;
  const prefix = `discovery:${workMailBatchDeclarationCommitment().protocolRecordSha256}:`;
  const key = `${prefix}${checkpoint.blockHash}`;
  let cached = cache.get(key);
  if (!cached && typeof verifyCheckpoint === "function") {
    const previous = [...cache.entries()].filter(([name, value]) => name.startsWith(prefix) &&
      checkpointValid(value.checkpoint) && value.checkpoint.blockHeight < checkpoint.blockHeight)
      .sort((a, b) => b[1].checkpoint.blockHeight - a[1].checkpoint.blockHeight);
    for (const [name, value] of previous) {
      if (await verifyCheckpoint(value.checkpoint)) { cached = value; break; }
      cache.delete(name);
    }
  }
  const sameCheckpoint = cached?.checkpoint?.blockHash === checkpoint.blockHash;
  if (cached?.found) return { ...cached.found };
  if (sameCheckpoint && cached?.complete) return null;
  const progress = { checkpoint: { blockHeight: checkpoint.blockHeight, blockHash: checkpoint.blockHash },
    complete: false, found: null, after: cached?.complete ? endOfBlock(cached.checkpoint.blockHeight) :
      cached?.after ? cursor(cached.after) : null };
  const persist = () => {
    const current = cache.get(key);
    if (current?.complete || current?.found || (current?.after && progress.after &&
        compare(current.after, progress.after) > 0)) return;
    cache.set(key, { ...progress, after: progress.after ? cursor(progress.after) : null });
    // Only small control metadata is cached, never transaction or wallet bytes.
    while (cache.size > 128) cache.delete(cache.keys().next().value);
  };
  let checked = 0;
  while (checked < maxCandidates) {
    const limit = Math.min(16, maxCandidates - checked);
    const page = await readCandidates({ expectedTipHeight: checkpoint.blockHeight,
      expectedTipHash: checkpoint.blockHash, limit, ...(progress.after ? { after: progress.after } : {}) });
    if (page?.scan?.complete !== true || page.scan.indexedThroughBlock !== checkpoint.blockHeight ||
        page.scan.blockHash !== checkpoint.blockHash || !Array.isArray(page.candidates) ||
        page.candidates.length > limit || (page.complete !== true && page.overflow !== true)) {
      fail("work-mail-batch-declaration-selection-incomplete");
    }
    let previous = progress.after;
    const txids = new Set();
    for (const candidate of page.candidates) {
      if (!position(candidate) || candidate.blockHeight < WORK_MAIL_BATCH_MIN_DECLARATION_BLOCK_HEIGHT ||
          candidate.blockHeight > checkpoint.blockHeight ||
          (previous && compare(candidate, previous) <= 0) || txids.has(candidate.txid)) {
        fail("work-mail-batch-declaration-candidate-order-invalid");
      }
      txids.add(candidate.txid);
      const valid = await validateCandidate(candidate);
      checked++;
      if (valid) {
        if (valid.txid !== candidate.txid || valid.blockHeight !== candidate.blockHeight ||
            valid.blockHash !== candidate.blockHash || valid.blockTransactionIndex !== candidate.blockTransactionIndex) {
          fail("work-mail-batch-declaration-candidate-evidence-mismatch");
        }
        progress.found = { ...valid }; persist();
        return { ...valid };
      }
      previous = candidate;
    }
    if (page.overflow !== true) {
      if (page.complete !== true) fail("work-mail-batch-declaration-selection-incomplete");
      progress.complete = true; progress.after = endOfBlock(checkpoint.blockHeight); persist();
      return null;
    }
    if (page.candidates.length !== limit || !position(page.nextCursor) ||
        !previous || compare(page.nextCursor, previous) !== 0 ||
        (progress.after && compare(page.nextCursor, progress.after) <= 0)) {
      fail("work-mail-batch-declaration-cursor-invalid");
    }
    progress.after = cursor(page.nextCursor); persist();
  }
  fail("work-mail-batch-declaration-discovery-in-progress");
}

/** Canonical replay finishes a finite immutable prefix within one invocation.
 * Batches remain bounded and yield between passes, but child-process retries
 * never need to inherit an in-memory cursor to pass the candidate budget. */
export async function completeWorkMailBatchDeclarationDiscovery({ yieldControl = yieldToIo, ...options } = {}) {
  const cache = options.cache ?? new Map();
  for (;;) {
    try { return await discoverWorkMailBatchDeclaration({ ...options, cache }); }
    catch (error) {
      if (error?.message !== "work-mail-batch-declaration-discovery-in-progress") throw error;
      await yieldControl();
    }
  }
}

export async function verifyWorkMailBatchDeclarationSelection({ pins, completeDiscovery = false, ...options } = {}) {
  const discover = completeDiscovery ? completeWorkMailBatchDeclarationDiscovery : discoverWorkMailBatchDeclaration;
  const found = await discover({ ...options,
    checkpoint: { blockHeight: pins.blockHeight, blockHash: pins.blockHash } });
  if (!found) fail("work-mail-batch-declaration-not-discovered");
  for (const field of ["txid", "blockHash", "blockHeight", "blockTransactionIndex",
    "protocolVout", "recordOrdinal", "registryPaymentVout", "activationHeight"]) {
    if (pins[field] !== undefined && found[field] !== pins[field]) {
      fail("work-mail-batch-pins-not-earliest-canonical-declaration");
    }
  }
  return true;
}
