import { createHash } from "node:crypto";
import { notificationAddressKey } from "./notification-query.mjs";
import { canonicalRawProtocolRecordSetFromTransaction } from "./canonical-op-return.mjs";

const TXID = /^[a-f0-9]{64}$/u;
const unavailable = message => Object.assign(new Error(message), { statusCode: 503 });
const conflict = () => Object.assign(new Error("Address notification history changed. Refresh to continue."), { statusCode: 409 });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function exactNotificationAddressHistory(entries) {
  if (!Array.isArray(entries) || entries.length > 10_000) throw unavailable("Complete address history exceeds the notification read budget.");
  const seen = new Set();
  return entries.map(entry => {
    const txid = entry.tx_hash, height = entry.height;
    if (!TXID.test(txid ?? "") || !Number.isSafeInteger(height) || height < -1 || seen.has(txid)) throw unavailable("Address history is incomplete or ambiguous.");
    seen.add(txid); return { txid, height };
  }).sort((a, b) => a.txid.localeCompare(b.txid));
}

function exactValue(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)) return BigInt(value);
  throw unavailable("Transaction amount evidence is incomplete.");
}

export function addressTransactionNotification(tx, entry, address, network, blockHash, observedAt) {
  if (!tx || tx.txid !== entry.txid || !Array.isArray(tx.vin) || !tx.vin.length || !Array.isArray(tx.vout) || !tx.vout.length) throw unavailable("Address transaction evidence is incomplete.");
  const confirmed = entry.height > 0;
  if (confirmed !== (tx.status?.confirmed === true) || (confirmed && tx.status.block_hash !== blockHash)) throw conflict();
  const inputs = tx.vin.map((input, vin) => {
    if (input.coinbase) return { vin, coinbase: true, address: null, valueSatsExact: "0" };
    if (!TXID.test(input.txid ?? "") || !Number.isSafeInteger(input.vout) || input.vout < 0 || !input.prevout || typeof input.prevout.scriptpubkey !== "string") throw unavailable("Transaction input evidence is incomplete.");
    return { vin, txid: input.txid, vout: input.vout, address: input.prevout.scriptpubkey_address ?? null, valueSatsExact: exactValue(input.prevout.value).toString() };
  });
  const outputs = tx.vout.map((output, vout) => {
    if (typeof output.scriptpubkey !== "string") throw unavailable("Transaction output evidence is incomplete.");
    return { vout, address: output.scriptpubkey_address ?? null, script: output.scriptpubkey, valueSatsExact: exactValue(output.value).toString() };
  });
  const own = row => row.address && notificationAddressKey(row.address) === address;
  const sum = rows => rows.reduce((amount, row) => amount + BigInt(row.valueSatsExact), 0n);
  const spent = sum(inputs.filter(own)), received = sum(outputs.filter(own));
  if (!inputs.some(own) && !outputs.some(own)) throw unavailable("Address history returned an unrelated transaction.");
  const from = inputs.some(own), externalInput = inputs.some(row => !own(row) && !row.coinbase), externalOutput = outputs.some(row => !own(row) && BigInt(row.valueSatsExact) > 0n);
  // A return/change output does not turn an outgoing payment into a self-send.
  const direction = from ? externalInput ? "related" : externalOutput ? "outgoing" : "self" : "incoming";
  const senderAddresses = [...new Set(inputs.map(row => row.address).filter(Boolean))];
  const recipientAddresses = [...new Set(outputs.filter(row => BigInt(row.valueSatsExact) > 0n).map(row => row.address).filter(Boolean))];
  const inputTotal = sum(inputs), outputTotal = sum(outputs), coinbase = inputs.some(row => row.coinbase);
  if (!coinbase && inputTotal < outputTotal) throw unavailable("Transaction input and output evidence does not balance.");
  const action = {
    id: `${network}:${entry.txid}:transaction`, txid: entry.txid, app: "Wallet", kind: "address-transaction",
    label: from && externalInput ? "Shared-input transaction" : direction === "self" ? "Self-transfer" : direction === "incoming" ? "Proofs received" : "Proofs sent",
    detail: "Address transaction", direction, status: confirmed ? "confirmed" : "pending",
    protocolVout: null, recordOrdinal: null,
    createdAt: tx.status?.block_time ? new Date(tx.status.block_time * 1000).toISOString() : observedAt,
    actorAddress: senderAddresses.length === 1 ? senderAddresses[0] : null, senderAddresses, recipientAddresses, relatedTxids: [],
    evidence: { protocol: "transaction", valid: null, chainStatus: confirmed ? "confirmed" : "pending", sourceEventId: null,
      blockHeight: confirmed ? entry.height : null, blockHash: confirmed ? blockHash : null,
      qualification: { ready: true, model: "core-address-transaction-v1", intent: "Transaction shape does not establish preparation intent or ownership of other addresses." },
      amounts: { spentSatsExact: spent.toString(), receivedSatsExact: received.toString(), netSatsExact: (received - spent).toString(), ...(coinbase ? {} : { feeSatsExact: (inputTotal - outputTotal).toString() }) }, inputs, outputs },
    target: { workspace: "search", txid: entry.txid },
  };
  // Unindexed transactions have no immutable database observation/event fence.
  // Aggregate read operations enumerate these IDs explicitly instead.
  return { ...action, id: `${network}:${entry.txid}`, actions: [action], firstSeenAt: null, maxEventId: null };
}

// The protocol reader remains the authority for application actions. This
// bounded union adds every exact address-history transaction, including those
// without protocol carriers, before pagination. No canonical rows are written.
export function createAddressNotificationReader({ readProtocolPage, readAddressHistory, verifyCheckpoint, hydrateTransaction, canonicalHash, indexedTransactions = async () => new Map(), now = Date.now }) {
  const snapshots = new Map();
  const loading = new Map();
  return async function read(network, address, params) {
    let cursor = null;
    if (params.get("cursor")) {
      try { cursor = JSON.parse(Buffer.from(params.get("cursor"), "base64url").toString()); } catch { throw conflict(); }
      if (cursor?.model !== "address-notifications-v1" || cursor.network !== network || cursor.address !== address || !TXID.test(cursor.snapshotId ?? "") || !Number.isSafeInteger(cursor.offset) || cursor.offset < 1) throw conflict();
    }
    const rawLimit = params.get("limit") ?? "50", limit = Number(rawLimit);
    if (!/^[1-9]\d{0,2}$/u.test(rawLimit) || limit > 100) throw Object.assign(new Error("Notification limit must be from 1 to 100."), { statusCode: 400 });
    const initial = await readProtocolPage(network, address, "");
    const checkpoint = { height: initial.indexedThroughBlock, blockHash: initial.indexedThroughBlockHash };
    await verifyCheckpoint(checkpoint);
    const entries = exactNotificationAddressHistory(await readAddressHistory(address, network));
    if (entries.some(entry => entry.height > checkpoint.height)) throw unavailable("The notification index has not reached the complete address history checkpoint.");
    const historyHash = digest(entries);
    const source = digest([network, address, initial.snapshotId, initial.maxEventId, initial.maxUpdatedAt, initial.totalCount, initial.items.map(item => [item.id, item.status]), historyHash, checkpoint]);
    if (cursor && cursor.snapshotId !== source) throw conflict();
    let snapshot = snapshots.get(source);
    if (!snapshot || snapshot.expiresAt <= now()) {
      if (!loading.has(source)) {
        if (loading.size >= 2) throw unavailable("Complete notification reads are busy; retry shortly.");
        loading.set(source, (async () => {
      const items = [...initial.items]; let page = initial, pages = 1;
      while (page.hasMore) {
        if (++pages > 100 || !page.nextCursor) throw unavailable("Complete protocol notification history exceeds the read budget.");
        page = await readProtocolPage(network, address, page.nextCursor);
        if (page.snapshotId !== initial.snapshotId || page.totalCount !== initial.totalCount) throw conflict();
        items.push(...page.items);
      }
      if (new Set(items.map(item => item.txid)).size !== initial.totalCount) throw unavailable("Protocol notification history is incomplete.");
      const byTxid = new Map(items.map(item => [item.txid, { txid: item.txid, height: item.evidence.blockHeight ?? 0, item }]));
      const rawIds = [];
      for (const entry of entries) {
        const existing = byTxid.get(entry.txid);
        if (existing) {
          const status = existing.item.evidence?.chainStatus;
          if ((status && status !== (entry.height > 0 ? "confirmed" : "pending")) ||
              (entry.height > 0 && existing.item.evidence?.blockHeight !== entry.height)) throw conflict();
          existing.addressEntry = entry;
        }
        else { byTxid.set(entry.txid, { ...entry, addressEntry: entry }); rawIds.push(`${network}:${entry.txid}`); }
      }
      const ordered = [...byTxid.values()].sort((a, b) => (b.height <= 0 ? Number.MAX_SAFE_INTEGER : b.height) - (a.height <= 0 ? Number.MAX_SAFE_INTEGER : a.height) || b.txid.localeCompare(a.txid));
      if (ordered.length > 10_000 || Buffer.byteLength(JSON.stringify(items)) > 32 * 1024 * 1024) throw unavailable("Complete notification history exceeds the read budget.");
      const missing = ordered.filter(row => !row.item);
      if (missing.length > 500) throw unavailable("Unindexed address history exceeds the bounded Core hydration budget.");
      // Verify every otherwise-unrepresented transaction before claiming full
      // action coverage, even when its card falls on a later page.
      let index = 0; const rawHashes = new Map();
      await Promise.all(Array.from({ length: Math.min(2, missing.length) }, async () => {
        while (index < missing.length) {
          const row = missing[index++];
          row.transaction = await hydrateTransaction(row.txid, network);
          if (canonicalRawProtocolRecordSetFromTransaction(row.transaction).rawProtocolCandidateCount > 0) throw unavailable("A Computer protocol transaction is missing its indexed actions; complete notifications are unavailable.");
          if (row.height > 0 && !rawHashes.has(row.height)) rawHashes.set(row.height, Promise.resolve(canonicalHash(row.height)));
          const rawHash = row.height > 0 ? await rawHashes.get(row.height) : null;
          if (row.height > 0 && !TXID.test(rawHash ?? "")) throw unavailable("Transaction canonical block is unavailable.");
          addressTransactionNotification(row.transaction, row, address, network, rawHash, new Date(now()).toISOString());
        }
      }));
      if (Buffer.byteLength(JSON.stringify(ordered)) > 48 * 1024 * 1024) throw unavailable("Complete address evidence exceeds the notification memory budget.");
      const built = { initial, ordered, rawIds, observedAt: new Date(now()).toISOString(), expiresAt: now() + 60_000 };
      while (snapshots.size >= 2) snapshots.delete(snapshots.keys().next().value);
      snapshots.set(source, built);
      return built;
        })().finally(() => loading.delete(source)));
      }
      snapshot = await loading.get(source);
    }
    const offset = cursor?.offset ?? 0;
    if (offset > snapshot.ordered.length) throw conflict();
    const selected = snapshot.ordered.slice(offset, offset + limit);
    const indexed = await indexedTransactions(network, selected.filter(row => row.addressEntry?.height > 0).map(row => row.txid));
    const items = [], hashes = new Map();
    for (const row of selected) {
      if (!row.addressEntry) { items.push(row.item); continue; }
      const entry = row.addressEntry;
      const protocolChainStatus = row.item?.evidence?.chainStatus;
      if (protocolChainStatus && protocolChainStatus !== (entry.height > 0 ? "confirmed" : "pending")) throw conflict();
      let hash = null;
      if (entry.height > 0) { if (!hashes.has(entry.height)) hashes.set(entry.height, await canonicalHash(entry.height)); hash = hashes.get(entry.height); if (!TXID.test(hash ?? "")) throw unavailable("Transaction canonical block is unavailable."); }
      const stored = indexed.get(row.txid);
      const tx = stored?.block_height === entry.height && stored?.block_hash === hash && stored.raw_tx?.txid === row.txid
        ? { ...stored.raw_tx, status: { ...stored.raw_tx.status, confirmed: true, block_hash: hash, block_height: entry.height } }
        : row.transaction ?? await hydrateTransaction(row.txid, network);
      if (!row.item && canonicalRawProtocolRecordSetFromTransaction(tx).rawProtocolCandidateCount > 0) throw unavailable("A Computer protocol transaction is missing its indexed actions; complete notifications are unavailable.");
      const raw = addressTransactionNotification(tx, entry, address, network, hash, snapshot.observedAt);
      items.push(row.item ? { ...row.item, senderAddresses: raw.senderAddresses,
        actions: [...(row.item.actions ?? [row.item]), ...raw.actions],
        direction: raw.direction === "self" ? row.item.direction : raw.direction,
        recipientAddresses: [...new Set([...row.item.recipientAddresses, ...raw.recipientAddresses])] } : raw);
    }
    await verifyCheckpoint(checkpoint);
    if (digest(exactNotificationAddressHistory(await readAddressHistory(address, network))) !== historyHash) throw conflict();
    const nextOffset = offset + items.length, hasMore = nextOffset < snapshot.ordered.length;
    return { ...snapshot.initial, address, scope: { type: "address", address }, scopeKey: `address:${address}`,
      items, snapshotId: source, observedAt: snapshot.observedAt, totalCount: snapshot.ordered.length, hasMore,
      cursor: params.get("cursor") ?? "", limit, pageSize: limit, emitted: nextOffset,
      start: offset, end: nextOffset, page: Math.floor(offset / limit), pageCount: Math.max(1, Math.ceil(snapshot.ordered.length / limit)),
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ model: "address-notifications-v1", network, address, snapshotId: source, offset: nextOffset })).toString("base64url") : "",
      readBoundary: { ...snapshot.initial.readBoundary, explicitIds: snapshot.rawIds },
      coverage: { ...snapshot.initial.coverage, scope: "address-transactions-and-computer-actions", source: "exact-electrum-core-and-indexed-protocol-union", addressHistoryCount: entries.length, transactionOnlyCount: snapshot.rawIds.length,
        localActions: "Views, drafts and other actions without an on-chain record are local activity. Transaction shape alone does not identify which app created a transfer." } };
  };
}
