// Additive child page links. Root DNS, child payment resolution and existing
// page1/sub1 history retain their original rules and accounting.
import { dnsOwnershipEpoch, dnsSubdomainAddressIdentity, parseDnsSubdomainName } from "./dnsSubdomains.mjs";
import { verifyOwnerOutputCommitment } from "./ownerOutputCommitment.mjs";

export const DNS_SUBDOMAIN_PAGE_LINK_PREFIX = "pwdns1:subpage1:";
export const DNS_SUBDOMAIN_PAGE_LINK_SELF_PAYMENT_SATS = 546;
export const DNS_SUBDOMAIN_PAGE_LINK_AUTHORITY_MODEL = "owner-signed-all-outputs-v1";
// Opens after the exact independently checked Core predecessor. Zero remains
// an explicit fail-closed replay option; pre-activation carriers gain no state.
export const DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT = 970499;
export const DNS_SUBDOMAIN_PAGE_LINK_PREDECESSOR_HASH = "00000000000000000001683a72df9a22322b2117aab9a1b264c5284045702d51";
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TXID = /^[0-9a-f]{64}$/u;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const MAX_PAYLOAD_LENGTH = 2048;
const unsigned = value => Number.isSafeInteger(value) && value >= 0;
const exactKeys = (value, keys) => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const epochKey = value => `${value.txid}:${value.protocolVout}:${value.recordOrdinal}`;
const childName = value => `${value.label}.${value.parent}.pow`;
const sorted = values => [...values].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function normalizeDnsSubdomainPageLinkName(value) {
  return parseDnsSubdomainName(value)?.name ?? "";
}
export function dnsSubdomainPageLinkNameError(value) {
  return normalizeDnsSubdomainPageLinkName(value) ? "" : "Use one child level, such as app.alice.pow.";
}
function canonicalRecord(value, normalize) {
  if (!value || !["set", "clear"].includes(value.action) ||
      !exactKeys(value, value.action === "set"
        ? ["action", "parent", "label", "epoch", "child", "pageTxid"]
        : ["action", "parent", "label", "epoch", "child"]) ||
      typeof value.parent !== "string" || typeof value.label !== "string") return null;
  const parent = normalize ? value.parent.trim().toLowerCase() : value.parent;
  const label = normalize ? value.label.trim().toLowerCase() : value.label;
  const epoch = dnsOwnershipEpoch(value.epoch), child = dnsOwnershipEpoch(value.child);
  if (!LABEL.test(parent) || !LABEL.test(label) || !epoch || !child ||
      !exactKeys(value.epoch, ["txid", "protocolVout", "recordOrdinal"]) ||
      !exactKeys(value.child, ["txid", "protocolVout", "recordOrdinal"])) return null;
  const record = { action: value.action, parent, label, epoch, child };
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
export function buildDnsSubdomainPageLinkPayload(value) {
  const record = canonicalRecord(value, true);
  if (!record) throw new Error("Invalid DNS subdomain page-link record.");
  const payload = DNS_SUBDOMAIN_PAGE_LINK_PREFIX + encode(new TextEncoder().encode(JSON.stringify(record)));
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error("DNS subdomain page-link record is too large.");
  return payload;
}
export function parseDnsSubdomainPageLinkPayload(payload) {
  if (typeof payload !== "string" || !payload.startsWith(DNS_SUBDOMAIN_PAGE_LINK_PREFIX) || payload.length > MAX_PAYLOAD_LENGTH) return null;
  const bytes = decode(payload.slice(DNS_SUBDOMAIN_PAGE_LINK_PREFIX.length));
  if (!bytes) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const record = canonicalRecord(JSON.parse(text), false);
    return record && JSON.stringify(record) === text &&
      DNS_SUBDOMAIN_PAGE_LINK_PREFIX + encode(new TextEncoder().encode(text)) === payload ? record : null;
  } catch { return null; }
}
function address(value, validateAddress) {
  try { return typeof value === "string" && validateAddress?.(value) === true ? dnsSubdomainAddressIdentity(value) : null; }
  catch { return null; }
}
function sats(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return unsigned(value) ? BigInt(value) : null;
  return typeof value === "string" && value.length <= 16 && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}
// Decode nulldata push bytes exactly, including a malformed matching carrier.
// Prefix discovery uses available bytes; only a complete fatal-UTF8 decode may
// authorize. OP_0 and PUSHDATA1/2/4 follow the canonical raw carrier grammar.
function childCarrier(output) {
  const hex = output.scriptPubKeyHex;
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})+$/u.test(hex)) return null;
  const script = Uint8Array.from(hex.match(/../gu), value => Number.parseInt(value, 16));
  if (script[0] !== 0x6a) return null;
  const chunks = []; let offset = 1, valid = true;
  while (offset < script.length) {
    const opcode = script[offset++]; let length = 0, width = 0;
    if (opcode <= 0x4b) length = opcode;
    else if (opcode === 0x4c) width = 1;
    else if (opcode === 0x4d) width = 2;
    else if (opcode === 0x4e) width = 4;
    else { valid = false; break; }
    if (width) {
      if (offset + width > script.length) { valid = false; break; }
      for (let index = 0; index < width; index++) length += script[offset + index] * 2 ** (8 * index);
      offset += width;
    }
    if (offset + length > script.length) { chunks.push(script.subarray(offset)); valid = false; break; }
    chunks.push(script.subarray(offset, offset + length)); offset += length;
  }
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  const prefix = new TextEncoder().encode(DNS_SUBDOMAIN_PAGE_LINK_PREFIX);
  if (bytes.length < prefix.length || prefix.some((byte, index) => bytes[index] !== byte)) return null;
  let payload = "";
  try { payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (payload.includes("\0")) valid = false; }
  catch { valid = false; }
  return { vout: output.vout, valid, payload,
    payloadHex: Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("") };
}
function committedEnvelope(event, author, validateAddress) {
  const proof = verifyOwnerOutputCommitment(event.transactionEvidence, { ownerAddress: author, network: "livenet",
    requireAllInputsCommitted: false, allowAnyoneCanPay: true });
  if (proof.valid !== true) return "owner-output-commitment-unavailable";
  if (proof.txid !== event.txid) return "transaction-evidence-txid-mismatch";
  if (proof.inputAddresses.length !== event.inputAddresses.length || proof.inputAddresses.some((value, index) =>
    address(value, validateAddress) !== address(event.inputAddresses[index], validateAddress))) return "transaction-evidence-inputs-mismatch";
  if (event.outputs.length !== proof.outputs.length || proof.outputs.some((output, index) => {
    const diagnostic = event.outputs[index];
    return diagnostic?.vout !== output.vout || sats(diagnostic.valueSats)?.toString() !== output.valueSats ||
      (output.address === null ? diagnostic.address !== null : address(diagnostic.address, validateAddress) !== address(output.address, validateAddress));
  })) return "transaction-evidence-outputs-mismatch";
  const carriers = proof.outputs.map(childCarrier).filter(Boolean);
  if (carriers.length !== 1 || carriers.length !== event.subdomainPageLinkCarrierCount) return "multiple-subdomain-page-link-carriers";
  const carrier = carriers[0];
  if (!carrier.valid || carrier.vout !== event.protocolVout || event.recordOrdinal !== 0 || carrier.payload !== event.payload ||
      (event.rawPayloadHex !== undefined && event.rawPayloadHex !== carrier.payloadHex) ||
      (event.decodeValid !== undefined && event.decodeValid !== carrier.valid)) return "transaction-evidence-carrier-mismatch";
  return "";
}
function authorization(event, validateAddress) {
  if (!event || typeof event !== "object") return { reason: "invalid-envelope", author: null };
  if (event.subdomainPageLinkCarrierCount !== 1) return { reason: "multiple-subdomain-page-link-carriers", author: null };
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
    if (amount >= BigInt(DNS_SUBDOMAIN_PAGE_LINK_SELF_PAYMENT_SATS)) paid = true;
  }
  if (!paid) return { reason: "missing-self-payment", author: null };
  const commitmentReason = committedEnvelope(event, author, validateAddress);
  return commitmentReason ? { reason: commitmentReason, author: null } : { reason: "", author };
}
// Exact signed spend proof; complete replay separately proves owner/lifecycle.
export function dnsSubdomainPageLinkSelfSendAuthor(event, { validateAddress } = {}) {
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
  return { payload: event.payload, inputAddresses: event.inputAddresses, outputs: event.outputs,
    hasCoinbaseInput: event.hasCoinbaseInput === true, subdomainPageLinkCarrierCount: event.subdomainPageLinkCarrierCount,
    ...(event.transactionEvidence ? { transactionEvidence: event.transactionEvidence } : {}),
    ...(typeof event.rawPayloadHex === "string" ? { rawPayloadHex: event.rawPayloadHex } : {}),
    ...(typeof event.decodeValid === "boolean" ? { decodeValid: event.decodeValid } : {}) };
}
function fingerprint(event) {
  return JSON.stringify({ ...envelope(event), ...carrierEvidence(event), inputAddresses: event.inputAddresses,
    hasCoinbaseInput: event.hasCoinbaseInput === true, subdomainPageLinkCarrierCount: event.subdomainPageLinkCarrierCount,
    transactionEvidence: event.transactionEvidence ? { ...event.transactionEvidence,
      prevouts: Array.isArray(event.transactionEvidence.prevouts) ? event.transactionEvidence.prevouts.map(output => ({ ...output, valueSats: typeof output.valueSats === "bigint" ? `${output.valueSats}n` : output.valueSats })) : event.transactionEvidence.prevouts } : undefined,
    outputs: event.outputs?.map(output => ({ ...output, valueSats: typeof output.valueSats === "bigint" ? `${output.valueSats}n` : output.valueSats })) });
}

// Both upstream histories are COMPLETE ACCEPTED canonical events, never raw
// claims or a latest-state cache. Raw subpage1 includes every malformed carrier.
export function replayDnsSubdomainPageLinks({ rootEvents = [], subdomainEvents = [], pageLinkEvents = [],
  activationHeight = DNS_SUBDOMAIN_PAGE_LINK_ACTIVATION_HEIGHT, validateAddress } = {}) {
  if (!unsigned(activationHeight)) throw new Error("Invalid DNS subdomain page-link activation height.");
  const roots = new Map(), children = new Map(), links = new Map(), seen = new Map(), conflicting = new Set(), counts = new Map();
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
  for (const event of subdomainEvents) {
    const value = position(event);
    if (!value || !["create", "update", "revoke"].includes(event.action) || !LABEL.test(event.parent ?? "") ||
        !LABEL.test(event.label ?? "") || !dnsOwnershipEpoch(event.epoch) ||
        !exactKeys(event.epoch, ["txid", "protocolVout", "recordOrdinal"]) ||
        (event.action !== "revoke" && event.resolver !== null && !address(event.resolver, validateAddress))) throw new Error("Incomplete accepted DNS child event.");
    bind(event, value); timeline.push({ type: "child", event, position: value });
  }
  for (const event of pageLinkEvents) {
    const carriers = counts.get(event.txid) ?? new Set(); carriers.add(`${event.protocolVout}:${event.recordOrdinal}`); counts.set(event.txid, carriers);
    if (event.blockHeight === null || event.blockHeight === undefined) { pending.push(event); continue; }
    const value = position(event);
    if (!value) { history.push({ ...envelope(event), ...carrierEvidence(event), record: parseDnsSubdomainPageLinkPayload(event.payload), valid: false, status: "rejected", reason: "invalid-canonical-position" }); continue; }
    bind(event, value);
    const key = epochKey(event);
    if (seen.has(key)) { if (fingerprint(seen.get(key)) !== fingerprint(event)) conflicting.add(key); continue; }
    seen.set(key, event); timeline.push({ type: "link", event, position: value });
  }
  timeline.sort(compare);
  for (let index = 1; index < timeline.length; index += 1) if (compare(timeline[index - 1], timeline[index]) === 0) throw new Error("Ambiguous canonical DNS record position.");
  function invalidate(name, event, cause) {
    if (!links.has(name)) return;
    historicalRecords.push({ ...links.get(name), status: "invalidated", invalidationReason: cause,
      invalidatedByTxid: event.txid, invalidatedAtBlock: event.blockHeight });
    links.delete(name);
  }
  function reason(event, record, isPending = false) {
    if (activationHeight === 0 || (!isPending && event.blockHeight < activationHeight)) return "not-active";
    if (!record) return "invalid-payload";
    const root = roots.get(record.parent), child = children.get(childName(record));
    if (!root) return "root-not-confirmed";
    if (isPending && (!dnsOwnershipEpoch(event) || (event.txIndex != null && !unsigned(event.txIndex)))) return "invalid-canonical-position";
    if (!isPending && root.ownershipEpochBlockHeight >= event.blockHeight) return "root-epoch-not-previously-confirmed";
    if (epochKey(record.epoch) !== epochKey(root.ownershipEpoch)) return "stale-ownership-epoch";
    if (!child) return "subdomain-not-active";
    if (epochKey(record.child) !== epochKey(child.childLifecycle)) return "stale-subdomain-lifecycle";
    if (!isPending && child.createdAtBlock >= event.blockHeight) return "subdomain-not-previously-confirmed";
    if (counts.get(event.txid)?.size !== 1) return "multiple-subdomain-page-link-carriers";
    const auth = authorization(event, validateAddress);
    if (auth.reason) return auth.reason;
    if (auth.author !== root.ownerAddress) return "unauthorized-owner";
    if (record.action === "clear" && !links.has(childName(record))) return "page-link-not-active";
    return "";
  }
  for (const item of timeline) {
    const { event } = item;
    if (item.type === "root") {
      const previous = roots.get(event.name), ownerAddress = address(event.ownerAddress, validateAddress);
      if (event.action === "register" && previous) throw new Error("Duplicate accepted DNS root registration.");
      if (event.action !== "register" && !previous) throw new Error("Accepted DNS root mutation has no registration.");
      if (event.action === "update" && previous.ownerAddress !== ownerAddress) throw new Error("Resolver update changed accepted DNS root owner.");
      if (event.action !== "update" && previous) {
        for (const [name, child] of children) {
          if (child.parent !== event.name) continue;
          invalidate(name, event, "root-ownership-change"); children.delete(name);
        }
      }
      roots.set(event.name, { name: `${event.name}.pow`, id: event.name, ownerAddress,
        resolverAddress: address(event.resolverAddress, validateAddress),
        ownershipEpoch: event.action === "update" ? previous.ownershipEpoch : dnsOwnershipEpoch(event),
        ownershipEpochBlockHeight: event.action === "update" ? previous.ownershipEpochBlockHeight : event.blockHeight });
      continue;
    }
    if (item.type === "child") {
      const root = roots.get(event.parent), name = childName(event), previous = children.get(name);
      if (!root || epochKey(event.epoch) !== epochKey(root.ownershipEpoch) || root.ownershipEpochBlockHeight >= event.blockHeight ||
          (event.action === "create" ? Boolean(previous) : !previous)) throw new Error("Inconsistent accepted DNS child lifecycle.");
      if (event.action === "revoke") {
        invalidate(name, event, "subdomain-revoked"); children.delete(name); continue;
      }
      children.set(name, { name, parent: event.parent, label: event.label, ownerAddress: root.ownerAddress,
        epoch: { ...event.epoch }, childLifecycle: previous?.childLifecycle ?? dnsOwnershipEpoch(event),
        createdAtBlock: previous?.createdAtBlock ?? event.blockHeight,
        resolverOverride: event.resolver === null ? null : address(event.resolver, validateAddress),
        ...envelope(event), status: "active" });
      continue;
    }
    const record = parseDnsSubdomainPageLinkPayload(event.payload);
    const rejection = conflicting.has(epochKey(event)) ? "conflicting-duplicate-record" : reason(event, record);
    const entry = { ...envelope(event), ...carrierEvidence(event), record, valid: !rejection, status: rejection ? "rejected" : "accepted", reason: rejection || null };
    history.push(entry);
    if (rejection) continue;
    const name = childName(record), previous = links.get(name);
    if (record.action === "clear") {
      const cleared = { ...previous, status: "cleared", clearedByTxid: event.txid, clearedAtBlock: event.blockHeight };
      historicalRecords.push(cleared); links.delete(name); entry.state = cleared; continue;
    }
    if (previous) historicalRecords.push({ ...previous, status: "replaced", replacedByTxid: event.txid, replacedAtBlock: event.blockHeight });
    const link = { ...envelope(event), name, parent: record.parent, label: record.label,
      pageTxid: record.pageTxid, ownerAddress: roots.get(record.parent).ownerAddress,
      epoch: { ...record.epoch }, child: { ...record.child }, status: "active" };
    links.set(name, link); entry.state = link;
  }
  return { records: sorted(links.values()), roots: sorted(roots.values()),
    children: sorted([...children.values()].map(child => ({ ...child,
      resolverAddress: child.resolverOverride ?? roots.get(child.parent).resolverAddress }))), history, historicalRecords,
    pendingEvents: pending.map(event => {
      const record = parseDnsSubdomainPageLinkPayload(event.payload);
      const rejection = positionsByTransaction.has(event.txid) ? "confirmed-transaction-is-pending" : reason(event, record, true);
      return { ...envelope(event), ...carrierEvidence(event), record, valid: !rejection, status: "pending", reason: rejection || null };
    }) };
}
