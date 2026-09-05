import { decodeCanonicalOpReturnOutput } from "./canonical-op-return.mjs";
import { WORK_TOKEN_ID } from "./work-units.mjs";
import { address as bitcoinAddress, networks, Transaction } from "bitcoinjs-lib";

export const BOOST_GROWTH_MODEL = "boost-growth-observation-v1";
export const BOOST_GROWTH_SOURCE = "proof-indexer-confirmed-boost-growth";
const HEX_TXID = /^[0-9a-f]{64}$/u;
const INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const ACTION_COUNTS = Object.freeze({
  post: "posts", reply: "replies", like: "likes", reboost: "reboosts",
  follow: "follows", unfollow: "unfollows", profile: "profiles", hide: "hides",
  t: "transfers", list5: "listings", seal5: "seals", delist5: "delistings",
  buy5: "sales",
});
const PAID_ACTIONS = new Set([
  "reply", "like", "reboost", "follow", "unfollow", "t", "list5", "seal5",
  "delist5", "buy5",
]);
const SOCIAL_ACTIONS = new Set(["reply", "like", "reboost", "follow", "unfollow"]);
export const BOOST_GROWTH_EXACT_FIELDS = Object.freeze([
  "directProofSignalSats", "registryFeeSats", "saleVolumeSats",
  "attachedWorkSubatoms", "attributedMailSats", "attributedWorkSubatoms",
]);

function integer(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const text = String(value ?? "");
  return INTEGER.test(text) ? BigInt(text) : null;
}

function jsonField(text) {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(text ?? "")) return null;
    const bytes = Buffer.from(text, "base64url");
    if (bytes.toString("base64url") !== text) return null;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.includes("\u0000")) return null;
    const value = JSON.parse(decoded);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

// This classifies observable wire records, not ownership or paid-action consensus.
export function boostGrowthObservedAction(payload) {
  const parts = String(payload ?? "").split(":");
  if (parts[0] !== "pwb1") return null;
  const action = parts[1] === "repost" ? "reboost" : parts[1];
  if (!ACTION_COUNTS[action]) return null;
  const target = (value) => HEX_TXID.test(value ?? "");
  if (action === "post" || action === "reply") {
    if (parts.length !== (action === "post" ? 3 : 4)) return null;
    if (action === "reply" && !target(parts[2])) return null;
    const post = jsonField(parts.at(-1));
    if (!post) return null;
    const text = String(post.text ?? post.body ?? post.message ?? "").trim();
    const media = post.media ?? post.attachment;
    const hasMedia = media && typeof media === "object" && !Array.isArray(media) &&
      (target(media.txid) || target(media.sha256) ||
        [media.mime, media.name, media.source].some((value) => typeof value === "string" && value.trim()) ||
        (integer(media.size) ?? 0n) > 0n);
    if ((!text && !hasMedia) || text.length > 140) return null;
    return action;
  }
  if (["profile", "follow", "unfollow"].includes(action)) {
    if (parts.length !== 3) return null;
    const value = jsonField(parts[2]);
    if (!value) return null;
    if (action !== "profile" && !String(
      value.targetAddress ?? value.followedAddress ?? value.address ?? value.target ?? "",
    ).trim()) return null;
    return action;
  }
  if (["like", "reboost", "hide", "delist5"].includes(action)) {
    return parts.length === 3 && target(parts[2]) ? action : null;
  }
  if (action === "t" || action === "buy5") {
    return parts.length === 4 && target(parts[2]) && parts[3].trim() ? action : null;
  }
  if (parts.length !== (action === "list5" ? 3 : 4)) return null;
  if (action === "seal5" && !target(parts[2])) return null;
  const terms = jsonField(parts.at(-1));
  return terms && target(terms.boostTxid ?? terms.assetTxid ?? terms.targetTxid) &&
      (integer(terms.priceSats ?? terms.price) ?? 0n) > 0n
    ? action : null;
}

export function unavailableBoostGrowth(checkpoint, reason) {
  return {
    model: BOOST_GROWTH_MODEL,
    source: BOOST_GROWTH_SOURCE,
    countScope: "confirmed-indexed-shape-valid-records",
    checkpoint,
    ready: false,
    complete: false,
    reason,
    counts: null,
    economicMetricsVerified: false,
    metricReasons: {},
    ...Object.fromEntries(BOOST_GROWTH_EXACT_FIELDS.map((field) => [field, null])),
  };
}

function outputAddress(output) {
  const script = output?.scriptpubkey ?? output?.scriptPubKey?.hex ?? output?.scriptPubKeyHex;
  if (typeof script === "string") {
    try { return bitcoinAddress.fromOutputScript(Buffer.from(script, "hex"), networks.bitcoin); }
    catch { return ""; }
  }
  return String(output?.scriptpubkey_address ?? output?.scriptPubKey?.address ?? "");
}

function verifiedRawTransaction(row, checkpoint) {
  const tx = row.raw_tx;
  const scan = tx?.canonicalBlockScan;
  const verified = tx && tx.txid === row.txid && Array.isArray(tx.vout) &&
    scan?.network === "livenet" && Number(scan.height) === Number(row.block_height) &&
    scan.blockHash === row.block_hash &&
    Number(row.block_height) <= checkpoint.blockHeight &&
    Number.isSafeInteger(row.block_index) && Number(tx._powBlockIndex) === row.block_index;
  if (!verified) return null;
  // Core JSON denominates `value` in whole coins. Read exact integer proofs
  // from its committed wire transaction; never convert that JSON float.
  if (tx.hex) {
    try {
      const decoded = Transaction.fromHex(tx.hex);
      if (decoded.getId() !== row.txid || decoded.outs.length !== tx.vout.length) return null;
      const vout = decoded.outs.map((output, index) => {
        const source = tx.vout[index];
        const script = Buffer.from(output.script).toString("hex");
        const sourceScript = String(source.scriptpubkey ?? source.scriptPubKey?.hex ?? source.scriptPubKeyHex ?? "").toLowerCase();
        if (sourceScript !== script) throw new Error("Raw transaction output script mismatch.");
        return { ...source, value: output.value.toString() };
      });
      return { ...tx, vout };
    } catch { return null; }
  }
  // Historical Esplora-shaped rows already store exact integer proof values.
  // A Core-shaped row without its wire witness is unavailable, not zero.
  return tx.vout.some((output) => output?.scriptPubKey) ? null : tx;
}

function boundRawRecord(tx, event) {
  if (!tx || !Number.isSafeInteger(event.op_return_vout)) return null;
  const decoded = decodeCanonicalOpReturnOutput(tx.vout[event.op_return_vout]);
  return decoded.decodeValid && decoded.text === event.raw_payload ? decoded.text : null;
}

function replayOutput(event) {
  const item = event.payload ?? {};
  return item.workAmoV5ReplayOutcome?.valid === true &&
      item.workAmoV5ReplayOutcome.kind === `${event.protocol}-valid` &&
      item.workAmoV5RawCandidate !== false &&
      item.workAmoV5ReplayOutput && typeof item.workAmoV5ReplayOutput === "object"
    ? item.workAmoV5ReplayOutput : null;
}

export function createBoostGrowthObservation(checkpoint) {
  const result = unavailableBoostGrowth(checkpoint, null);
  result.counts = Object.fromEntries([
    "events", "transactions", ...Object.values(ACTION_COUNTS), "socialActions",
  ].map((field) => [field, 0]));
  const totals = Object.fromEntries(BOOST_GROWTH_EXACT_FIELDS.map((field) => [field, 0n]));
  const seenTransactions = new Set();
  const seenRecords = new Set();
  const failMetric = (field, reason) => { result.metricReasons[field] ||= reason; };

  return {
    addTransaction(row) {
      if (row.status !== "confirmed" || !HEX_TXID.test(row.txid ?? "") ||
          Number(row.block_height) > checkpoint.blockHeight) return;
      if (seenTransactions.has(row.txid)) throw new Error("Duplicate Boost source transaction.");
      seenTransactions.add(row.txid);
      const events = Array.isArray(row.events) ? row.events : [];
      const tx = verifiedRawTransaction(row, checkpoint);
      if (tx) {
        for (let vout = 0; vout < tx.vout.length; vout += 1) {
          const raw = decodeCanonicalOpReturnOutput(tx.vout[vout]);
          if (raw.prefix === "pwb1:" && !events.some((event) =>
            event.protocol === "pwb1" && event.status === "confirmed" &&
            event.op_return_vout === vout && event.record_ordinal === 0 &&
            typeof event.valid === "boolean" &&
            (!raw.decodeValid || event.raw_payload === raw.text)
          )) throw new Error("A raw Boost carrier has no exact indexed outcome.");
        }
      }
      const observed = [];
      for (const event of events) {
        if (event.protocol !== "pwb1" || event.status !== "confirmed" ||
            event.valid !== true || event.payload?.valid === false ||
            (Array.isArray(event.validation_errors) && event.validation_errors.length > 0)) continue;
        const action = boostGrowthObservedAction(event.raw_payload);
        if (!action) continue;
        const expectedKind = `boost-${{ t: "transfer", list5: "list", seal5: "seal", delist5: "delist", buy5: "buy" }[action] ?? action}`;
        if (event.kind !== expectedKind) continue;
        if (!Number.isSafeInteger(event.op_return_vout) || event.op_return_vout < 0 ||
            !Number.isSafeInteger(event.record_ordinal) || event.record_ordinal < 0) {
          throw new Error("Boost record position is unavailable.");
        }
        const key = `${row.txid}:${event.op_return_vout}:${event.record_ordinal}`;
        if (seenRecords.has(key)) throw new Error("Duplicate Boost record position.");
        seenRecords.add(key);
        observed.push({ action, event });
        result.counts.events += 1;
        result.counts[ACTION_COUNTS[action]] += 1;
        if (SOCIAL_ACTIONS.has(action)) result.counts.socialActions += 1;
      }
      if (observed.length === 0) return;
      result.counts.transactions += 1;
      const rawBound = tx && observed.every(({ event }) => boundRawRecord(tx, event));
      const paid = observed.some(({ action }) => PAID_ACTIONS.has(action));
      if (paid) {
        failMetric("registryFeeSats", "Confirmed Boost registry-output authority is not yet part of canonical Boost replay.");
        failMetric("directProofSignalSats", "Paid Boost outputs cannot yet be separated into verified registry fees and signal.");
      }
      if (observed.some(({ action }) => action === "buy5")) {
        failMetric("saleVolumeSats", "Indexed Boost purchase records do not yet prove canonical seller settlement.");
      }
      if (!rawBound) {
        for (const field of ["directProofSignalSats", "attributedMailSats", "attachedWorkSubatoms", "attributedWorkSubatoms"]) {
          failMetric(field, "Exact confirmed raw-transaction evidence is unavailable.");
        }
        return;
      }
      // Only original self-send outputs have unambiguous signal evidence today.
      const proofOutputs = new Set();
      for (const { action, event } of observed) {
        if (action !== "post") {
          if (!paid) failMetric("directProofSignalSats", "This Boost action has no verified signal-output attribution.");
          continue;
        }
        const sender = outputAddress(tx.vin?.[0]?.prevout);
        if (!sender) {
          failMetric("directProofSignalSats", "The original-post sender prevout is unavailable.");
          continue;
        }
        for (let vout = 0; vout < event.op_return_vout; vout += 1) {
          const output = tx.vout[vout];
          const amount = integer(output?.value);
          if (!outputAddress(output)) continue;
          if (outputAddress(output) !== sender || amount === null) {
            failMetric("directProofSignalSats", "Original-post outputs cannot be isolated from other payments.");
            continue;
          }
          if (!proofOutputs.has(vout)) totals.directProofSignalSats += amount;
          proofOutputs.add(vout);
        }
      }
      const mailOutputs = new Set();
      const workRecords = new Set();
      const siblingPositions = new Set();
      for (const event of events) {
        if (event.status !== "confirmed" || event.valid !== true || event.payload?.valid === false) continue;
        const siblingKey = `${event.protocol}:${event.op_return_vout}:${event.record_ordinal}`;
        if (siblingPositions.has(siblingKey)) continue;
        siblingPositions.add(siblingKey);
        const output = replayOutput(event);
        if (event.protocol === "pwm1" && ["mail", "reply", "file", "attachment"].includes(event.kind)) {
          // Mail envelopes may begin before their body carrier; use the canonical
          // replay's recipient output ownership instead of summing display rows.
          const recipients = output?.recipients ?? output?.projection?.recipients;
          if (!Array.isArray(recipients)) {
            failMetric("attributedMailSats", "Canonical Mail output attribution is unavailable.");
            continue;
          }
          for (const recipient of recipients) {
            const vout = recipient.vout;
            const amount = integer(recipient.amountSats);
            const actual = tx.vout[vout];
            if (!Number.isSafeInteger(vout) || amount === null ||
                integer(actual?.value) !== amount || outputAddress(actual) !== recipient.address) {
              failMetric("attributedMailSats", "Canonical Mail attribution does not match the raw outputs.");
              continue;
            }
            if (!mailOutputs.has(vout)) totals.attributedMailSats += amount;
            mailOutputs.add(vout);
          }
        }
        if (event.protocol !== "pwt1" || event.kind !== "token-transfer") continue;
        const parts = String(event.raw_payload ?? "").split(":");
        if (parts[2] !== WORK_TOKEN_ID) continue;
        const amount = integer(parts[3]);
        const canonical = output?.projection ?? output;
        const exactAmount = parts[1] === "send3" ? integer(canonical?.amountSubatoms)
          : parts[1] === "send2" ? integer(canonical?.amountAtoms) : null;
        if (!output || !boundRawRecord(tx, event) || amount === null || amount <= 0n ||
            exactAmount !== amount || canonical?.tokenId !== WORK_TOKEN_ID ||
            canonical?.recipientAddress !== parts[4]) {
          failMetric("attachedWorkSubatoms", "Canonical WORK transfer evidence is incomplete.");
          failMetric("attributedWorkSubatoms", "Canonical WORK transfer evidence is incomplete.");
          continue;
        }
        const key = `${event.op_return_vout}:${event.record_ordinal}`;
        if (workRecords.has(key)) continue;
        workRecords.add(key);
        const subatoms = parts[1] === "send2" ? amount * 100000000n : amount;
        totals.attachedWorkSubatoms += subatoms;
        totals.attributedWorkSubatoms += subatoms;
      }
      // A raw WORK record missing from the sibling projection is not a zero attachment.
      for (let vout = 0; vout < tx.vout.length; vout += 1) {
        const raw = decodeCanonicalOpReturnOutput(tx.vout[vout]);
        if (raw.prefix === "pwm1:" && !events.some((event) => event.protocol === "pwm1")) {
          failMetric("attributedMailSats", "Raw Mail carriers have no indexed validation outcome.");
        }
        if (raw.decodeValid && /^pwt1:send[23]:/u.test(raw.text) && raw.text.split(":")[2] === WORK_TOKEN_ID) {
          const outcome = events.find((event) => event.protocol === "pwt1" &&
            event.op_return_vout === vout && event.record_ordinal === 0 &&
            event.raw_payload === raw.text && event.status === "confirmed");
          const invalid = outcome?.valid === false &&
            outcome.payload?.workAmoV5ReplayOutcome?.valid === false;
          const accepted = outcome?.valid === true && outcome.kind === "token-transfer" &&
            outcome.payload?.valid !== false && workRecords.has(`${vout}:0`);
          if (!invalid && !accepted) {
            failMetric("attachedWorkSubatoms", "A raw WORK attachment has no exact canonical validation outcome.");
            failMetric("attributedWorkSubatoms", "A raw WORK attachment has no exact canonical validation outcome.");
          }
        }
      }
    },
    finish() {
      result.ready = true;
      result.complete = true;
      result.economicMetricsVerified = Object.keys(result.metricReasons).length === 0;
      for (const field of BOOST_GROWTH_EXACT_FIELDS) {
        result[field] = result.metricReasons[field] ? null : totals[field].toString();
      }
      return result;
    },
  };
}

// Only adds observations. It never merges them into actualValue or workFloor.
export function withBoostGrowthObservation(summary, observation) {
  return { ...summary, boost: observation };
}

/** An optional observation must never delay or exhaust the canonical summary path. */
export function createBoostGrowthObservationLoader(load, {
  waitMs = 150, cacheTtlMs = 30_000, cacheSize = 4,
} = {}) {
  const cache = new Map();
  let running = null;
  return async (network, checkpoint) => {
    const key = JSON.stringify([network, checkpoint?.snapshotId, checkpoint?.blockHeight, checkpoint?.blockHash]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    cache.delete(key);
    const unavailable = () => unavailableBoostGrowth(checkpoint, "Confirmed Boost observations are being prepared; retry shortly.");
    if (running && running.key !== key) return unavailable();
    if (!running) {
      const task = { key, promise: null };
      task.promise = Promise.resolve().then(() => load(network, checkpoint))
        .catch(() => unavailableBoostGrowth(checkpoint, "Confirmed Boost history is unavailable."))
        .then((result) => {
          if (result?.ready === true && result.complete === true) {
            cache.set(key, { result, expiresAt: Date.now() + cacheTtlMs });
            while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
          }
          return result;
        }).finally(() => { if (running === task) running = null; });
      running = task;
    }
    let timer;
    try {
      return await Promise.race([
        running.promise,
        new Promise((resolve) => { timer = setTimeout(() => resolve(unavailable()), waitMs); }),
      ]);
    } finally { clearTimeout(timer); }
  };
}
