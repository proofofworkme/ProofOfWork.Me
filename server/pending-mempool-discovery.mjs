// Core supplies all membership, epochs and transaction data. These cursors only
// schedule bounded discovery; they cannot make a transaction or event valid.
const MODEL = "pending-arrival-discovery-v1";
const LAST = "f".repeat(64);
const MAX_RETRY = 128;
const isTxid = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const epoch = value => Number.isSafeInteger(value) && value >= 0;
const before = (a, b) => a.time - b.time || (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0);

export function acceptedHintTxids(payload, network) {
  const ids = payload?.txids;
  if (payload?.model !== "accepted-broadcast-txid-hints-v1" || payload.network !== network ||
      !Array.isArray(ids) || ids.length > 256 || !ids.every(isTxid) || new Set(ids).size !== ids.length) return [];
  return ids;
}

export function pendingDiscoverySeen(state, mempool) {
  const sampled = state.discovery?.model === MODEL ? state.discovery.sampleSecond : null;
  // A transaction that left and came back after the previous sample must be
  // inspected again, even if the worker never observed its departure.
  return new Set([...state.processedTxids].filter(id => mempool[id] &&
    (!epoch(sampled) || mempool[id].time < sampled)));
}

export function planPendingDiscovery({ entries, state, priorityTxids, hintTxids, limit, seenLimit, sampledAtMs, legacyPlan }) {
  const sampleSecond = Math.floor(sampledAtMs / 1000);
  const closedSecond = Math.max(0, sampleSecond - 1);
  const membership = new Map(entries);
  const prior = state.discovery?.model === MODEL ? state.discovery : {};
  const anchor = prior.arrivalCursor;
  const oldestHead = entries[Math.min(seenLimit, entries.length) - 1]?.[1]?.time;
  const initialTime = Math.min(closedSecond, epoch(oldestHead) ? Math.max(0, oldestHead - 1) : closedSecond);
  const cursor = anchor && epoch(anchor.time) && isTxid(anchor.txid) && anchor.time <= closedSecond ?
    { time: anchor.time, txid: anchor.txid } : { time: initialTime, txid: LAST };
  const share = limit > 0 ? Math.max(1, Math.floor(limit / 2)) : 0;
  const smallShare = limit > 0 ? Math.min(16, Math.max(1, Math.floor(limit / 8))) : 0;
  const retries = Array.isArray(prior.retry) ? [...new Set(prior.retry.slice(0, MAX_RETRY))]
    .filter(id => isTxid(id) && membership.has(id) && !state.processedTxids.has(id)) : [];
  const hintSet = new Set(hintTxids.filter(id => membership.has(id)));
  const settled = new Map();
  for (const item of (Array.isArray(prior.settledHints) ? prior.settledHints.slice(0, 256) : [])) {
    if (hintSet.has(item?.txid) && epoch(item.time) && item.time === membership.get(item.txid)?.time) {
      settled.set(item.txid, item.time);
    }
  }
  const hints = [...hintSet];
  const pivot = hints.indexOf(prior.hintCursor) + 1;
  const hintPage = [...hints.slice(pivot), ...hints.slice(0, pivot)].filter(id => !settled.has(id)).slice(0, smallShare);
  const due = [];
  for (const [txid, meta] of entries) {
    const time = meta?.time;
    if (!epoch(time) || time > closedSecond || state.processedTxids.has(txid) || before({ time, txid }, cursor) <= 0) continue;
    due.push({ time, txid });
  }
  due.sort(before);
  const arrivalPage = due.slice(0, share);
  const special = new Set();
  // If the whole recovery set fits in its guaranteed ordinary share, retain
  // its prior verifier order and priority cursor even for overlapping arrivals.
  const priorityReserve = limit - share - 2 * smallShare - 1;
  const ordinaryPriority = priorityTxids.length <= priorityReserve ? new Set(priorityTxids) : new Set();
  const lane = (ids, name) => {
    const selected = [];
    for (const id of ids) {
      if (ordinaryPriority.has(id) || special.has(id)) continue;
      selected.push({ entry: [id, membership.get(id)], lane: name });
      special.add(id);
    }
    return selected;
  };
  const hintLane = lane(hintPage,"hint");
  const retryLane = lane(retries.slice(0,smallShare),"retry");
  const arrivalLane = lane(arrivalPage.map(item => item.txid),"arrival");
  const small = limit < 8;
  const ordinaryEntries = small ? entries : entries.filter(([id]) => !special.has(id));
  const ordinary = ordinaryEntries.length ? legacyPlan(ordinaryEntries, state, priorityTxids,
    { candidateLimit: small ? limit : limit - special.size, seenLimit }) : [];
  const candidates = [];
  const lanes = [ordinary, hintLane, arrivalLane, retryLane];
  const turn = Number.isSafeInteger(prior.turn) && prior.turn >= 0 ? prior.turn % lanes.length : 0;
  const scheduled = new Set();
  // Rotate the first slot across passes as well as interleaving candidates.
  // Even a pass interrupted after one transaction can progress each lane.
  for (let index = 0; candidates.length < limit && lanes.some(items => index < items.length); index++) {
    for (let lane = 0; lane < lanes.length && candidates.length < limit; lane++) {
      const candidate = lanes[(turn + lane) % lanes.length][index];
      if (candidate && !scheduled.has(candidate.entry[0])) {
        candidates.push(candidate);
        scheduled.add(candidate.entry[0]);
      }
    }
  }
  return { candidates, turn, sampleSecond, closedSecond, cursor, arrivalPage, retries, settled, membership,
    hintPage, hintSet, selectedHints: new Set(hintPage), priorHintCursor: isTxid(prior.hintCursor) ? prior.hintCursor : null,
    allArrivalsPlanned: share > 0 && arrivalPage.length === due.length };
}

export function finishPendingDiscovery(plan, attempted, processed, departed) {
  const retry = new Set(plan.retries.filter(id => !processed.has(id) && !departed.has(id)));
  // Rotate attempted failures to the back without losing an obligation. A
  // saturated retry set fences progress at the first untracked failure.
  for (const id of attempted) if (retry.delete(id)) retry.add(id);
  let cursor = plan.cursor;
  let retrySaturated = false;
  for (const point of plan.arrivalPage) {
    if (!attempted.has(point.txid)) break;
    if (!processed.has(point.txid) && !departed.has(point.txid)) {
      if (!retry.has(point.txid) && retry.size >= MAX_RETRY) {
        retrySaturated = true;
        break;
      }
      retry.add(point.txid);
    }
    cursor = point;
  }
  if (plan.allArrivalsPlanned && (!plan.arrivalPage.length || cursor === plan.arrivalPage.at(-1))) {
    cursor = { time: plan.closedSecond, txid: LAST };
  }
  let hintCursor = plan.priorHintCursor;
  for (const id of plan.hintPage) if (attempted.has(id)) hintCursor = id;
  for (const id of attempted) {
    if (plan.selectedHints.has(id) && processed.has(id) && !departed.has(id)) {
      plan.settled.set(id,plan.membership.get(id).time);
    }
  }
  return { model: MODEL, arrivalCursor: cursor, sampleSecond: plan.sampleSecond,
    turn: attempted.size ? (plan.turn + 1) % 4 : plan.turn,
    retry: [...retry], retrySaturated, hintCursor, settledHints:[...plan.settled].map(([txid,time])=>({txid,time})) };
}
