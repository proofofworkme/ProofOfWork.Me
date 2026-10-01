// Additive DNS child records. This module is shared by browser builders and
// full-node replay; it has no Node-specific dependencies or economic effects.
export const DNS_SUBDOMAIN_PREFIX = "pwdns1:sub1:";
export const DNS_SUBDOMAIN_SELF_PAYMENT_SATS = 546;
// Zero disables child admission. A reviewed rollout pins a positive height.
export const DNS_SUBDOMAIN_ACTIVATION_HEIGHT = 969489;

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TXID_PATTERN = /^[0-9a-f]{64}$/u;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const MAX_PAYLOAD_LENGTH = 2048;

export function normalizeDnsSubdomainLabel(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function dnsSubdomainLabelError(value) {
  const label = normalizeDnsSubdomainLabel(value);
  return LABEL_PATTERN.test(label)
    ? ""
    : "Use 1–63 lowercase letters, numbers, or hyphens, with a letter or number at each end.";
}

export function parseDnsSubdomainName(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().toLowerCase().split(".");
  if (parts.length !== 3 || parts[2] !== "pow") return null;
  const [label, parent] = parts;
  if (!LABEL_PATTERN.test(label) || !LABEL_PATTERN.test(parent)) return null;
  return { parent, label, name: `${label}.${parent}.pow` };
}

// Callers validate the network address first. Base58 identity is case-sensitive;
// valid Bech32/Bech32m addresses use a case-insensitive spelling.
export function dnsSubdomainAddressIdentity(value) {
  if (typeof value !== "string") return "";
  return /^(?:bc1|tb1|bcrt1)[a-z0-9]+$/iu.test(value)
    ? value.toLowerCase()
    : value;
}

function addressIdentity(value, validateAddress) {
  if (typeof value !== "string" || typeof validateAddress !== "function") return null;
  try {
    return validateAddress(value) === true ? dnsSubdomainAddressIdentity(value) : null;
  } catch {
    return null;
  }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function unsignedInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function canonicalEpoch(value) {
  if (!exactKeys(value, ["txid", "protocolVout", "recordOrdinal"]) ||
      typeof value.txid !== "string" || !TXID_PATTERN.test(value.txid) ||
      !unsignedInteger(value.protocolVout) || value.protocolVout > 0xffffffff ||
      !unsignedInteger(value.recordOrdinal)) return null;
  return { txid: value.txid, protocolVout: value.protocolVout, recordOrdinal: value.recordOrdinal };
}

export function dnsOwnershipEpoch(event) {
  return canonicalEpoch({
    txid: event?.txid,
    protocolVout: event?.protocolVout,
    recordOrdinal: event?.recordOrdinal,
  });
}

function canonicalRecord(value, validateAddress, normalize) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (!["create", "update", "revoke"].includes(value.action)) return null;
  const keys = value.action === "revoke"
    ? ["action", "parent", "label", "epoch"]
    : ["action", "parent", "label", "epoch", "resolver"];
  if (!exactKeys(value, keys) || typeof value.parent !== "string" || typeof value.label !== "string") return null;
  const parent = normalize ? normalizeDnsSubdomainLabel(value.parent) : value.parent;
  const label = normalize ? normalizeDnsSubdomainLabel(value.label) : value.label;
  const epoch = canonicalEpoch(value.epoch);
  if (!LABEL_PATTERN.test(parent) || !LABEL_PATTERN.test(label) || !epoch) return null;
  const result = { action: value.action, parent, label, epoch };
  if (value.action !== "revoke") {
    const resolver = value.resolver === null ? null : addressIdentity(value.resolver, validateAddress);
    if (resolver === null && value.resolver !== null) return null;
    result.resolver = resolver;
  }
  return result;
}

function encodeBase64url(bytes) {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    encoded += BASE64URL[a >> 2];
    encoded += BASE64URL[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) encoded += BASE64URL[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) encoded += BASE64URL[c & 63];
  }
  return encoded;
}

function decodeBase64url(encoded) {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) return null;
  const bytes = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of encoded) {
    accumulator = (accumulator << 6) | BASE64URL.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 255);
    }
  }
  const result = new Uint8Array(bytes);
  return encodeBase64url(result) === encoded ? result : null;
}

export function buildDnsSubdomainPayload(value, { validateAddress } = {}) {
  const record = canonicalRecord(value, validateAddress, true);
  if (!record) throw new Error("Invalid DNS subdomain record.");
  const payload = DNS_SUBDOMAIN_PREFIX + encodeBase64url(new TextEncoder().encode(JSON.stringify(record)));
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error("DNS subdomain record is too large.");
  return payload;
}

export function parseDnsSubdomainPayload(payload, { validateAddress } = {}) {
  if (typeof payload !== "string" || !payload.startsWith(DNS_SUBDOMAIN_PREFIX) || payload.length > MAX_PAYLOAD_LENGTH) return null;
  const bytes = decodeBase64url(payload.slice(DNS_SUBDOMAIN_PREFIX.length));
  if (!bytes) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text);
    const record = canonicalRecord(parsed, validateAddress, false);
    // Exact reserialization excludes duplicate/extra keys, alternate ordering,
    // whitespace, alternate number encodings, and noncanonical address casing.
    return record && JSON.stringify(record) === text &&
      DNS_SUBDOMAIN_PREFIX + encodeBase64url(new TextEncoder().encode(text)) === payload ? record : null;
  } catch {
    return null;
  }
}

function epochKey(epoch) {
  return `${epoch.txid}:${epoch.protocolVout}:${epoch.recordOrdinal}`;
}

function eventPosition(event) {
  if (!TXID_PATTERN.test(event?.txid ?? "") ||
      !Number.isSafeInteger(event.blockHeight) || event.blockHeight < 1 ||
      !unsignedInteger(event.txIndex) || !unsignedInteger(event.protocolVout) ||
      event.protocolVout > 0xffffffff || !unsignedInteger(event.recordOrdinal)) return null;
  return [event.blockHeight, event.txIndex, event.protocolVout, event.recordOrdinal];
}

function comparePosition(left, right) {
  for (let index = 0; index < 4; index += 1) {
    if (left.position[index] !== right.position[index]) return left.position[index] - right.position[index];
  }
  return 0;
}

function exactSats(value) {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return unsignedInteger(value) ? BigInt(value) : null;
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) return BigInt(value);
  return null;
}

function selfSendAuthorization(event, validateAddress) {
  if (event === null || typeof event !== "object") return { author: null, reason: "invalid-envelope" };
  if (event.subdomainCarrierCount !== 1) return { author: null, reason: "multiple-subdomain-carriers" };
  if (!dnsOwnershipEpoch(event)) return { author: null, reason: "invalid-canonical-position" };
  if (event.hasCoinbaseInput === true || !Array.isArray(event.inputAddresses) || event.inputAddresses.length === 0) return { author: null, reason: "unknown-or-coinbase-input" };
  let author = null;
  for (const inputAddress of event.inputAddresses) {
    const identity = addressIdentity(inputAddress, validateAddress);
    if (!identity) return { author: null, reason: "unknown-or-coinbase-input" };
    if (author !== null && identity !== author) return { author: null, reason: "mixed-input-authors" };
    author = identity;
  }
  if (!Array.isArray(event.outputs)) return { author: null, reason: "missing-self-payment" };
  const outputIndexes = new Set();
  let paid = false;
  for (const output of event.outputs) {
    if (!unsignedInteger(output?.vout) || output.vout > 0xffffffff || outputIndexes.has(output.vout)) return { author: null, reason: "invalid-output-evidence" };
    outputIndexes.add(output.vout);
    if (output.vout >= event.protocolVout || addressIdentity(output.address, validateAddress) !== author) continue;
    const value = exactSats(output.valueSats);
    if (value === null) return { author: null, reason: "invalid-self-payment" };
    if (value >= BigInt(DNS_SUBDOMAIN_SELF_PAYMENT_SATS)) paid = true;
  }
  return paid ? { author, reason: "" } : { author: null, reason: "missing-self-payment" };
}

// Structural carrier admission only: this does not prove DNS parent ownership.
// The caller must count every sub1 carrier in the complete transaction.
export function dnsSubdomainSelfSendAuthor(event, { validateAddress } = {}) {
  return selfSendAuthorization(event, validateAddress).author;
}

function authorizationReason(event, ownerAddress, validateAddress) {
  const { author, reason } = selfSendAuthorization(event, validateAddress);
  if (reason) return reason;
  return author === ownerAddress ? "" : "unauthorized-owner";
}

function resolvedRecord(record, root) {
  const resolverAddress = record.resolverOverride ?? root.resolverAddress;
  return {
    ...record,
    ownerAddress: root.ownerAddress,
    inherited: record.resolverOverride === null,
    resolverAddress,
    resolvedAddress: resolverAddress,
  };
}

function plainEnvelope(event) {
  return {
    txid: event.txid,
    blockHeight: event.blockHeight ?? null,
    txIndex: event.txIndex ?? null,
    protocolVout: event.protocolVout,
    recordOrdinal: event.recordOrdinal,
  };
}

function evidenceFingerprint(event) {
  return JSON.stringify({
    ...plainEnvelope(event),
    payload: event.payload,
    inputAddresses: event.inputAddresses,
    hasCoinbaseInput: event.hasCoinbaseInput === true,
    outputs: Array.isArray(event.outputs) ? event.outputs.map((output) => ({
      vout: output?.vout,
      address: output?.address,
      valueSats: typeof output?.valueSats === "bigint" ? `${output.valueSats}n` : output?.valueSats,
    })) : null,
  });
}

// rootEvents are already accepted root registry events, never raw root claims.
// Rebuild from the canonical chain on every replay; no persisted child cache is
// authoritative. A missing/ambiguous root position fails the entire read closed.
export function replayDnsSubdomains({
  rootEvents = [],
  subdomainEvents = [],
  activationHeight = DNS_SUBDOMAIN_ACTIVATION_HEIGHT,
  validateAddress,
} = {}) {
  if (!unsignedInteger(activationHeight)) throw new Error("Invalid DNS subdomain activation height.");
  const roots = new Map();
  const children = new Map();
  const historicalRecords = [];
  const history = [];
  const pendingEvents = [];
  const timeline = [];
  const transactionPositions = new Map();
  const positionsByTransaction = new Map();
  const seenChildren = new Map();
  const ambiguousChildren = new Set();
  const carriersByTransaction = new Map();

  function bindTransactionPosition(event, position) {
    const key = `${position[0]}:${position[1]}`;
    const existing = transactionPositions.get(key);
    if (existing && existing !== event.txid) throw new Error("Ambiguous canonical DNS transaction position.");
    const existingPosition = positionsByTransaction.get(event.txid);
    if (existingPosition && existingPosition !== key) throw new Error("DNS transaction has conflicting canonical positions.");
    transactionPositions.set(key, event.txid);
    positionsByTransaction.set(event.txid, key);
  }

  for (const event of rootEvents) {
    const position = eventPosition(event);
    if (!position || !["register", "transfer", "buy", "update"].includes(event.action) ||
        !LABEL_PATTERN.test(event.name ?? "") ||
        !addressIdentity(event.ownerAddress, validateAddress) ||
        !addressIdentity(event.resolverAddress, validateAddress)) throw new Error("Incomplete accepted DNS root event.");
    bindTransactionPosition(event, position);
    timeline.push({ type: "root", event, position });
  }
  for (const event of subdomainEvents) {
    const carriers = carriersByTransaction.get(event.txid) ?? new Set();
    carriers.add(`${event.protocolVout}:${event.recordOrdinal}`);
    carriersByTransaction.set(event.txid, carriers);
    if (event.blockHeight === null || event.blockHeight === undefined) {
      pendingEvents.push(event);
      continue;
    }
    const position = eventPosition(event);
    if (!position) {
      history.push({ ...plainEnvelope(event), record: parseDnsSubdomainPayload(event.payload, { validateAddress }), valid: false, status: "rejected", reason: "invalid-canonical-position" });
      continue;
    }
    bindTransactionPosition(event, position);
    const key = epochKey(event);
    if (seenChildren.has(key)) {
      if (evidenceFingerprint(seenChildren.get(key)) !== evidenceFingerprint(event)) ambiguousChildren.add(key);
      continue;
    }
    seenChildren.set(key, event);
    timeline.push({ type: "child", event, position });
  }
  timeline.sort(comparePosition);
  for (let index = 1; index < timeline.length; index += 1) {
    if (comparePosition(timeline[index - 1], timeline[index]) === 0) throw new Error("Ambiguous canonical DNS record position.");
  }

  function childReason(event, record, pending = false) {
    if (activationHeight === 0 || (!pending && event.blockHeight < activationHeight)) return "not-active";
    if (!record) return "invalid-payload";
    const root = roots.get(record.parent);
    if (!root) return "parent-not-confirmed";
    if (pending && (!dnsOwnershipEpoch(event) ||
        (event.txIndex !== null && event.txIndex !== undefined && !unsignedInteger(event.txIndex)))) return "invalid-canonical-position";
    if (!pending && root.ownershipEpochBlockHeight >= event.blockHeight) return "parent-epoch-not-previously-confirmed";
    if (epochKey(record.epoch) !== epochKey(root.ownershipEpoch)) return "stale-ownership-epoch";
    const authorization = authorizationReason({ ...event, subdomainCarrierCount: carriersByTransaction.get(event.txid)?.size }, root.ownerAddress, validateAddress);
    if (authorization) return authorization;
    const current = children.get(`${record.label}.${record.parent}.pow`);
    if (record.action === "create" && current) return "subdomain-already-active";
    if (record.action !== "create" && !current) return "subdomain-not-active";
    return "";
  }

  for (const item of timeline) {
    const { event } = item;
    if (item.type === "root") {
      const previous = roots.get(event.name);
      if (event.action === "register" && previous) throw new Error("Duplicate accepted DNS root registration.");
      if (event.action !== "register" && !previous) throw new Error("Accepted DNS root mutation has no registration.");
      const ownerAddress = addressIdentity(event.ownerAddress, validateAddress);
      const resolverAddress = addressIdentity(event.resolverAddress, validateAddress);
      if (event.action === "update" && previous.ownerAddress !== ownerAddress) throw new Error("Resolver update changed accepted DNS root owner.");
      const root = {
        name: `${event.name}.pow`,
        parent: event.name,
        ownerAddress,
        resolverAddress,
        ownershipEpoch: event.action === "update" ? previous.ownershipEpoch : dnsOwnershipEpoch(event),
        ownershipEpochBlockHeight: event.action === "update" ? previous.ownershipEpochBlockHeight : event.blockHeight,
      };
      if (event.action !== "update" && previous) {
        for (const [name, child] of children) {
          if (child.parent !== event.name) continue;
          historicalRecords.push({ ...resolvedRecord(child, previous), status: "invalidated", invalidatedByTxid: event.txid, invalidatedAtBlock: event.blockHeight });
          children.delete(name);
        }
      }
      roots.set(event.name, root);
      continue;
    }
    const record = parseDnsSubdomainPayload(event.payload, { validateAddress });
    const reason = ambiguousChildren.has(epochKey(event)) ? "conflicting-duplicate-record" : childReason(event, record);
    const entry = { ...plainEnvelope(event), record, valid: reason === "", status: reason ? "rejected" : "accepted", reason: reason || null };
    history.push(entry);
    if (reason) continue;
    const name = `${record.label}.${record.parent}.pow`;
    const root = roots.get(record.parent);
    const previous = children.get(name);
    if (record.action === "revoke") {
      const revoked = {
        ...resolvedRecord(previous, root),
        status: "revoked",
        txid: event.txid,
        lastEventTxid: event.txid,
        updatedTxid: event.txid,
        updatedAtBlock: event.blockHeight,
        protocolVout: event.protocolVout,
        recordOrdinal: event.recordOrdinal,
        revokedAtBlock: event.blockHeight,
      };
      historicalRecords.push(revoked);
      children.delete(name);
      entry.state = revoked;
      continue;
    }
    const child = {
      name,
      parent: record.parent,
      label: record.label,
      ownerAddress: root.ownerAddress,
      resolverOverride: record.resolver,
      epoch: { ...record.epoch },
      status: "active",
      txid: event.txid,
      createdTxid: previous?.createdTxid ?? event.txid,
      lastEventTxid: event.txid,
      updatedTxid: event.txid,
      createdAtBlock: previous?.createdAtBlock ?? event.blockHeight,
      updatedAtBlock: event.blockHeight,
      protocolVout: event.protocolVout,
      recordOrdinal: event.recordOrdinal,
    };
    children.set(name, child);
    entry.state = resolvedRecord(child, root);
  }
  const pending = pendingEvents.map((event) => {
    const record = parseDnsSubdomainPayload(event.payload, { validateAddress });
    const reason = childReason(event, record, true);
    return { ...plainEnvelope(event), record, valid: reason === "", status: "pending", reason: reason || null };
  });
  return {
    records: [...children.values()].map((child) => resolvedRecord(child, roots.get(child.parent))).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    roots: [...roots.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    history,
    historicalRecords,
    pendingEvents: pending,
  };
}
