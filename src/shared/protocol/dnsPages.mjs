// Root DNS page links are an additive self-message lane. They do not change
// root address resolution, registry fees, or network-value accounting.
import { dnsOwnershipEpoch, dnsSubdomainAddressIdentity } from "./dnsSubdomains.mjs";

export const DNS_PAGE_LINK_PREFIX = "pwdns1:page1:";
export const DNS_PAGE_LINK_SELF_PAYMENT_SATS = 546;
// Opens at 970426, following the independently verified Core/index checkpoint
// 970425: 00000000000000000001a22c08622961c9fc0a1b063510bf5fc9141577b77537.
export const DNS_PAGE_LINK_ACTIVATION_HEIGHT = 970426;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TXID = /^[0-9a-f]{64}$/u;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const MAX_PAYLOAD_LENGTH = 2048;
const unsigned = value => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const epochKey = value => `${value.txid}:${value.protocolVout}:${value.recordOrdinal}`;

export function normalizeDnsPageLinkName(value) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\.pow$/u, "") : "";
}
export function dnsPageLinkNameError(value) {
  return LABEL.test(normalizeDnsPageLinkName(value)) ? "" : "Use a root .pow name with 1–63 letters, numbers, or internal hyphens.";
}
function canonicalRecord(value, normalize) {
  if (!value || !["set", "clear"].includes(value.action) ||
      !exactKeys(value, value.action === "set" ? ["action", "name", "epoch", "pageTxid"] : ["action", "name", "epoch"]) ||
      typeof value.name !== "string") return null;
  const name = normalize ? normalizeDnsPageLinkName(value.name) : value.name;
  const epoch = dnsOwnershipEpoch(value.epoch);
  if (!LABEL.test(name) || !epoch || !exactKeys(value.epoch, ["txid", "protocolVout", "recordOrdinal"])) return null;
  const record = { action: value.action, name, epoch };
  if (value.action === "set") {
    if (typeof value.pageTxid !== "string" || !TXID.test(value.pageTxid)) return null;
    record.pageTxid = value.pageTxid;
  }
  return record;
}
function encode(bytes) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const [a, b, c] = bytes.slice(index, index + 3);
    text += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) text += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) text += ALPHABET[c & 63];
  }
  return text;
}
function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/u.test(text) || text.length % 4 === 1) return null;
  let accumulator = 0, bits = 0;
  const bytes = [];
  for (const character of text) {
    accumulator = (accumulator << 6) | ALPHABET.indexOf(character); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((accumulator >> bits) & 255); }
  }
  const value = new Uint8Array(bytes);
  return encode(value) === text ? value : null;
}
export function buildDnsPageLinkPayload(value) {
  const record = canonicalRecord(value, true);
  if (!record) throw new Error("Invalid DNS page-link record.");
  const payload = DNS_PAGE_LINK_PREFIX + encode(new TextEncoder().encode(JSON.stringify(record)));
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error("DNS page-link record is too large.");
  return payload;
}
export function parseDnsPageLinkPayload(payload) {
  if (typeof payload !== "string" || !payload.startsWith(DNS_PAGE_LINK_PREFIX) || payload.length > MAX_PAYLOAD_LENGTH) return null;
  const bytes = decode(payload.slice(DNS_PAGE_LINK_PREFIX.length));
  if (!bytes) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const record = canonicalRecord(JSON.parse(text), false);
    return record && JSON.stringify(record) === text &&
      DNS_PAGE_LINK_PREFIX + encode(new TextEncoder().encode(text)) === payload ? record : null;
  } catch { return null; }
}
function address(value, validateAddress) {
  try { return typeof value === "string" && validateAddress?.(value) === true ? dnsSubdomainAddressIdentity(value) : null; }
  catch { return null; }
}
function sats(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return unsigned(value) ? BigInt(value) : null;
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}
function authorization(event, validateAddress) {
  if (event.pageLinkCarrierCount !== 1) return { reason: "multiple-page-link-carriers", author: null };
  if (!dnsOwnershipEpoch(event)) return { reason: "invalid-canonical-position", author: null };
  if (event.hasCoinbaseInput === true || !Array.isArray(event.inputAddresses) || !event.inputAddresses.length) return { reason: "unknown-or-coinbase-input", author: null };
  let author = null;
  for (const input of event.inputAddresses) {
    const current = address(input, validateAddress);
    if (!current) return { reason: "unknown-or-coinbase-input", author: null };
    if (author !== null && current !== author) return { reason: "mixed-input-authors", author: null };
    author = current;
  }
  if (!Array.isArray(event.outputs)) return { reason: "missing-self-payment", author: null };
  const indexes = new Set(); let paid = false;
  for (const output of event.outputs) {
    if (!unsigned(output?.vout) || output.vout > 0xffffffff || indexes.has(output.vout)) return { reason: "invalid-output-evidence", author: null };
    indexes.add(output.vout);
    if (output.vout >= event.protocolVout || address(output.address, validateAddress) !== author) continue;
    const amount = sats(output.valueSats);
    if (amount === null) return { reason: "invalid-self-payment", author: null };
    if (amount >= BigInt(DNS_PAGE_LINK_SELF_PAYMENT_SATS)) paid = true;
  }
  return paid ? { reason: "", author } : { reason: "missing-self-payment", author: null };
}
export function dnsPageLinkSelfSendAuthor(event, { validateAddress } = {}) {
  return authorization(event, validateAddress).author;
}
function position(event) {
  return TXID.test(event?.txid ?? "") && Number.isSafeInteger(event.blockHeight) && event.blockHeight > 0 &&
    unsigned(event.txIndex) && unsigned(event.protocolVout) && event.protocolVout <= 0xffffffff && unsigned(event.recordOrdinal)
    ? [event.blockHeight, event.txIndex, event.protocolVout, event.recordOrdinal] : null;
}
function compare(left, right) {
  for (let index = 0; index < 4; index += 1) if (left.position[index] !== right.position[index]) return left.position[index] - right.position[index];
  return 0;
}
function envelope(event) {
  return { txid: event.txid, blockHeight: event.blockHeight ?? null, txIndex: event.txIndex ?? null,
    protocolVout: event.protocolVout, recordOrdinal: event.recordOrdinal };
}
function carrierEvidence(event) {
  return { payload: event.payload,
    ...(typeof event.rawPayloadHex === "string" ? { rawPayloadHex: event.rawPayloadHex } : {}),
    ...(typeof event.decodeValid === "boolean" ? { decodeValid: event.decodeValid } : {}) };
}
function fingerprint(event) {
  return JSON.stringify({ ...event, outputs: event.outputs?.map(output => ({ ...output,
    valueSats: typeof output.valueSats === "bigint" ? `${output.valueSats}n` : output.valueSats })) });
}

// Accepted roots are supplied by the canonical root registry replay. Unknown
// positions fail the whole projection closed; pending records never mutate it.
export function replayDnsPageLinks({ rootEvents = [], pageLinkEvents = [],
  activationHeight = DNS_PAGE_LINK_ACTIVATION_HEIGHT, validateAddress } = {}) {
  if (!unsigned(activationHeight)) throw new Error("Invalid DNS page-link activation height.");
  const roots = new Map(), links = new Map(), seen = new Map(), conflicting = new Set(), counts = new Map();
  const history = [], historicalRecords = [], pending = [], timeline = [];
  const transactionPositions = new Map(), positionsByTransaction = new Map();
  function bind(event, value) {
    const key = `${value[0]}:${value[1]}`;
    if ((transactionPositions.has(key) && transactionPositions.get(key) !== event.txid) ||
        (positionsByTransaction.has(event.txid) && positionsByTransaction.get(event.txid) !== key)) throw new Error("Ambiguous canonical DNS transaction position.");
    transactionPositions.set(key, event.txid); positionsByTransaction.set(event.txid, key);
  }
  for (const event of rootEvents) {
    const value = position(event);
    if (!value || !["register", "transfer", "buy", "update"].includes(event.action) || !LABEL.test(event.name ?? "") ||
        !address(event.ownerAddress, validateAddress) || !address(event.resolverAddress, validateAddress)) throw new Error("Incomplete accepted DNS root event.");
    bind(event, value); timeline.push({ type: "root", event, position: value });
  }
  for (const event of pageLinkEvents) {
    const carriers = counts.get(event.txid) ?? new Set(); carriers.add(`${event.protocolVout}:${event.recordOrdinal}`); counts.set(event.txid, carriers);
    if (event.blockHeight === null || event.blockHeight === undefined) { pending.push(event); continue; }
    const value = position(event);
    if (!value) { history.push({ ...envelope(event), ...carrierEvidence(event), record: parseDnsPageLinkPayload(event.payload), valid: false, status: "rejected", reason: "invalid-canonical-position" }); continue; }
    bind(event, value);
    const key = epochKey(event);
    if (seen.has(key)) { if (fingerprint(seen.get(key)) !== fingerprint(event)) conflicting.add(key); continue; }
    seen.set(key, event); timeline.push({ type: "link", event, position: value });
  }
  timeline.sort(compare);
  for (let index = 1; index < timeline.length; index += 1) if (compare(timeline[index - 1], timeline[index]) === 0) throw new Error("Ambiguous canonical DNS record position.");
  function reason(event, record, isPending = false) {
    if (activationHeight === 0 || (!isPending && event.blockHeight < activationHeight)) return "not-active";
    if (!record) return "invalid-payload";
    const root = roots.get(record.name);
    if (!root) return "root-not-confirmed";
    if (isPending && (!dnsOwnershipEpoch(event) || (event.txIndex != null && !unsigned(event.txIndex)))) return "invalid-canonical-position";
    if (!isPending && root.ownershipEpochBlockHeight >= event.blockHeight) return "root-epoch-not-previously-confirmed";
    if (epochKey(record.epoch) !== epochKey(root.ownershipEpoch)) return "stale-ownership-epoch";
    if (counts.get(event.txid)?.size !== 1) return "multiple-page-link-carriers";
    const auth = authorization(event, validateAddress);
    if (auth.reason) return auth.reason;
    if (auth.author !== root.ownerAddress) return "unauthorized-owner";
    if (record.action === "clear" && !links.has(record.name)) return "page-link-not-active";
    return "";
  }
  for (const item of timeline) {
    const { event } = item;
    if (item.type === "root") {
      const previous = roots.get(event.name);
      if (event.action === "register" && previous) throw new Error("Duplicate accepted DNS root registration.");
      if (event.action !== "register" && !previous) throw new Error("Accepted DNS root mutation has no registration.");
      const ownerAddress = address(event.ownerAddress, validateAddress);
      if (event.action === "update" && previous.ownerAddress !== ownerAddress) throw new Error("Resolver update changed accepted DNS root owner.");
      if (event.action !== "update" && previous && links.has(event.name)) {
        historicalRecords.push({ ...links.get(event.name), status: "invalidated", invalidatedByTxid: event.txid, invalidatedAtBlock: event.blockHeight });
        links.delete(event.name);
      }
      roots.set(event.name, { name: `${event.name}.pow`, id: event.name, ownerAddress,
        resolverAddress: address(event.resolverAddress, validateAddress),
        ownershipEpoch: event.action === "update" ? previous.ownershipEpoch : dnsOwnershipEpoch(event),
        ownershipEpochBlockHeight: event.action === "update" ? previous.ownershipEpochBlockHeight : event.blockHeight });
      continue;
    }
    const record = parseDnsPageLinkPayload(event.payload);
    const rejection = conflicting.has(epochKey(event)) ? "conflicting-duplicate-record" : reason(event, record);
    const entry = { ...envelope(event), ...carrierEvidence(event), record, valid: !rejection, status: rejection ? "rejected" : "accepted", reason: rejection || null };
    history.push(entry);
    if (rejection) continue;
    const previous = links.get(record.name);
    if (record.action === "clear") {
      const cleared = { ...previous, status: "cleared", clearedByTxid: event.txid, clearedAtBlock: event.blockHeight };
      historicalRecords.push(cleared); links.delete(record.name); entry.state = cleared; continue;
    }
    if (previous) historicalRecords.push({ ...previous, status: "replaced", replacedByTxid: event.txid, replacedAtBlock: event.blockHeight });
    const link = { ...envelope(event), name: `${record.name}.pow`, id: record.name,
      pageTxid: record.pageTxid, ownerAddress: roots.get(record.name).ownerAddress,
      epoch: { ...record.epoch }, status: "active" };
    links.set(record.name, link); entry.state = link;
  }
  return { records: [...links.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    roots: [...roots.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0), history, historicalRecords,
    pendingEvents: pending.map(event => {
      const record = parseDnsPageLinkPayload(event.payload), rejection = reason(event, record, true);
      return { ...envelope(event), ...carrierEvidence(event), record, valid: !rejection, status: "pending", reason: rejection || null };
    }) };
}
