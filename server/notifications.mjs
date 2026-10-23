import { proofIndexEventParticipantsForItem, proofIndexEventRefsForItem } from "./proof-index-event-relations.mjs";
import { notificationAddressKey } from "./notification-query.mjs";
import { parseJobBody } from "../src/shared/protocol/jobs.mjs";
import { parsePermissionBody } from "../src/shared/protocol/permissions.mjs";
import { notificationIdDirection } from "./notification-id-scope.mjs";

export const NOTIFICATION_MODEL = "proof-computer-notifications-v1";
const TXID = /^[0-9a-f]{64}$/u;
const text = value => typeof value === "string" ? value : "";
const unique = values => [...new Set(values.filter(Boolean))];
const bodyOf = item => text(item.memo) || text(item.body);
const labels = {
  "id-register": "ID registration", "id-update": "ID receiver update", "id-transfer": "ID transfer",
  "id-list": "ID listing", "id-seal": "ID listing sealed", "id-delist": "ID delisting", "id-buy": "ID purchase",
  "dns-register": "DNS registration", "dns-update": "DNS resolver update", "dns-transfer": "DNS transfer",
  "dns-list": "DNS listing", "dns-seal": "DNS listing sealed", "dns-delist": "DNS delisting", "dns-buy": "DNS purchase",
  "boost-post": "Boost post", "boost-reply": "Boost reply", "boost-like": "Boost like",
  "boost-reboost": "Boost reboost", "boost-tip": "Content tip", "boost-follow": "Profile followed",
  "boost-unfollow": "Profile unfollowed", "boost-profile": "Profile update", "boost-hide": "Boost hidden",
  "boost-transfer": "Boost transfer", "boost-list5": "Boost listing", "boost-seal5": "Boost listing sealed",
  "boost-delist5": "Boost delisting", "boost-buy5": "Boost purchase",
  "boost-list": "Boost listing", "boost-seal": "Boost listing sealed", "boost-delist": "Boost delisting", "boost-buy": "Boost purchase",
  "token-create": "Credit creation", "token-mint": "Credit mint", "token-transfer": "Credit transfer",
  "token-listing": "Credit listing", "token-listing-sealed": "Credit listing sealed",
  "token-listing-closed": "Credit listing closed", "token-sale": "Credit purchase",
  "mail": "Mail", "message": "Mail", "reply": "Mail reply", "file": "File", "attachment": "File attachment",
  "code-repository": "Repository created", "code-repo": "Repository created", "code-commit": "Code commit",
};
const jobLabels = { brief: "Job published", propose: "Job proposal", assign: "Job assignment",
  deliver: "Job delivery", accept: "Job acceptance and payment", cancel: "Job cancellation" };
const permissionLabels = { grant: "Permission grant", replace: "Permission replacement", revoke: "Permission revocation" };

export function notificationPermissionCandidate(item) {
  return item?.protocol === "pwm1" && bodyOf(item).startsWith("pwperm1:");
}

function isPagePublication(item, body) {
  const htmlMime = value => ["text/html", "application/xhtml+xml"].includes(text(value).toLowerCase().split(";")[0].trim());
  const htmlName = value => /\.x?html?$/iu.test(text(value));
  if (htmlMime(item.attachment?.mime) || htmlName(item.attachment?.name)) return true;
  const raw = text(item.rawPayload) || text(item.protocolPayload) || text(item.payload);
  if (raw.startsWith("pwm1:a:")) {
    const parts = raw.split(":");
    const decode = value => {
      if (!/^[A-Za-z0-9_-]+$/u.test(value ?? "")) return "";
      try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64url")); }
      catch { return ""; }
    };
    if (htmlMime(decode(parts[2])) || htmlName(decode(parts[3]))) return true;
  }
  if (["file", "attachment"].includes(item.kind)) {
    // Older canonical activity rows retain attachment MIME/name in their
    // formatter detail instead of the full attachment object.
    const fields = text(item.detail).split(" · ");
    if (htmlName(fields[0]) || htmlMime(fields.at(-1)) ||
        (Array.isArray(item.tags) && item.tags.some(htmlMime))) return true;
  }
  const source = body.trim();
  return /^<!doctype\s+html[\s>]/iu.test(source) || /^<html[\s>]/iu.test(source) ||
    /<\/(?:html|head|body)>/iu.test(source) ||
    /^<(?:a|article|body|button|canvas|code|div|form|h[1-6]|head|img|input|main|ol|p|pre|script|section|span|style|svg|table|ul)(?:\s|>|\/)/iu.test(source);
}

function classification(item) {
  const kind = text(item.kind), protocol = text(item.protocol), body = bodyOf(item);
  const job = protocol === "pwm1" && body.startsWith("pwj1:") ? parseJobBody(body) : null;
  const permission = notificationPermissionCandidate(item) ? parsePermissionBody(body) : null;
  if (job || (protocol === "pwm1" && body.startsWith("pwj1:"))) return { app: "Jobs", workspace: "jobs", label: jobLabels[job?.action] ?? "Job record", priority: 100, job };
  if (permission || notificationPermissionCandidate(item)) return { app: "Permission", workspace: "permission", label: permissionLabels[permission?.action] ?? "Permission record", priority: 100, permission };
  if (protocol === "pwc1" || kind.startsWith("code-")) return { app: "Code", workspace: "code", label: labels[kind] ?? "Code record", priority: 95 };
  if (protocol === "pwdns1" || kind.startsWith("dns-")) {
    const action = item.dnsPageLinkAction ?? item.subdomainAction ?? item.record?.action ?? item.action;
    const page = item.dnsPageLinkAuthority || /page/u.test(kind) || /^pwdns1:(?:sub)?page1:/u.test(text(item.payload) || text(item.rawPayload));
    return { app: "DNS", workspace: "dns", label: page ? `DNS page ${action === "clear" ? "unlink" : "link"}` : /subdomain/u.test(kind) ? `DNS subdomain ${action ?? "action"}` : labels[kind] ?? "DNS record", priority: 90 };
  }
  if (protocol === "pwid1" || kind.startsWith("id-")) return { app: "IDs", workspace: "ids", label: labels[kind] ?? "ID record", priority: 90 };
  if (protocol === "pwb1" || kind.startsWith("boost-")) return { app: item.article ? "Publish" : "Boost", workspace: item.article ? "publish" : "boost", label: item.article ? "Article published" : labels[kind] ?? "Boost record", priority: 85 };
  if (protocol === "pwt1" || kind.startsWith("token-")) return { app: "Wallet", workspace: "wallet", label: labels[kind] ?? "Credit record", priority: 60 };
  if (kind === "infinity-bond" || item.subject === "powb" || /^powb(?:\b|:)/u.test(body) || (item.tags ?? []).includes("Infinity")) return { app: "Infinity", workspace: "infinity", label: "Infinity bond", priority: 80 };
  if (kind === "inception-bond" || item.subject === "incb" || /^incb(?:\b|:)/u.test(body) || (item.tags ?? []).includes("Inception")) return { app: "Inception", workspace: "inception", label: "Inception bond", priority: 80 };
  if (protocol === "pwm1" && isPagePublication(item, body)) return { app: "Pages", workspace: "browser", label: "Page publication", priority: 40 };
  if (item.attachment || ["file", "attachment"].includes(kind)) return { app: "Files", workspace: "files", label: "File publication", priority: 35 };
  return { app: protocol === "pwm1" ? "Mail" : "Computer", workspace: protocol === "pwm1" ? "inbox" : "log", label: labels[kind] ?? "Computer record", priority: 10 };
}

function qualification(item, classification) {
  const lifecycle = classification.app === "Jobs" ? item.jobs
    : classification.app === "Permission" ? item.permission
    : classification.app === "Code" ? item.codeAuthority
    : ["Boost", "Publish"].includes(classification.app) ? item.boostAuthority
    : classification.app === "IDs" ? item.idAuthority
    : classification.app === "DNS" ? item.dnsAuthority : null;
  const chainStatus = text(item.confirmationStatus) || text(item.status) || (item.confirmed ? "confirmed" : "pending");
  const valid = item.protocolValid === false || lifecycle?.valid === false ? false
    : item.protocolValid === true || lifecycle?.valid === true ? true : item.valid !== false;
  if (["dropped", "orphaned"].includes(chainStatus)) return { status: chainStatus, valid, lifecycle };
  if (!valid || /invalid/u.test(text(item.kind))) return { status: "invalid", valid: false, lifecycle };
  if (chainStatus !== "confirmed") return { status: chainStatus === "pending" ? "pending" : "unavailable", valid, lifecycle };
  if ((["Jobs", "Permission", "Code"].includes(classification.app) || (["Boost", "Publish"].includes(classification.app) && item.boostAuthority) || (classification.app === "DNS" && item.dnsAuthority)) && lifecycle?.ready !== true) return { status: "unavailable", valid, lifecycle };
  if (item.applied === false || lifecycle?.applied === false) return { status: "invalid", valid: false, lifecycle };
  return { status: "confirmed", valid, lifecycle };
}

export function notificationAction(item, address, network = item?.network) {
  const info = classification(item), qualified = qualification(item, info);
  const { currentOwnerAddress: _projectedOwner, currentOwnerId: _projectedOwnerId, ...historicalSource } = item;
  const currentOwnerKey = notificationAddressKey(item.currentOwnerAddress);
  const explicitAddresses = [item.ownerAddress, item.authorAddress, item.senderAddress, item.actor]
    .filter(Boolean).map(notificationAddressKey);
  const people = [...proofIndexEventParticipantsForItem(historicalSource, historicalSource), ...(item.notificationParticipants ?? [])]
    .filter(person => !currentOwnerKey || !["owner", "participant"].includes(person.role) ||
      notificationAddressKey(person.address) !== currentOwnerKey || explicitAddresses.includes(currentOwnerKey) ||
      (person.txid === item.txid && person.protocolVout === item.protocolVout && person.recordOrdinal === item.recordOrdinal));
  if (item.boostAuthority?.historicalTargetOwner) {
    people.push({ address: item.boostAuthority.historicalTargetOwner, role: "target-owner" });
  }
  const own = person => notificationAddressKey(person.address) === notificationAddressKey(address);
  const fromRoles = new Set(["actor", "author", "sender", "creator", "minter"]);
  const toRoles = new Set(["recipient", "receiver", "previous-receiver", "owner", "buyer", "follow-target", "target-owner", "counterparty", "registry"]);
  const outgoing = people.some(person => own(person) && fromRoles.has(person.role));
  const incoming = people.some(person => own(person) && toRoles.has(person.role));
  const actorAddress = people.find(person => ["author", "sender", "actor"].includes(person.role))?.address ?? "";
  const recipientAddresses = unique(people.filter(person => toRoles.has(person.role)).map(person => person.address));
  const refs = [...proofIndexEventRefsForItem(item), ...(item.notificationRefs ?? [])];
  const relatedTxids = unique([...refs.map(ref => ref.refValue ?? ref.ref_value), item.quoteTxid, item.pageTxid, item.metadata?.sourceTxid].filter(value => TXID.test(value ?? "") && value !== item.txid));
  let targetTxid = item.txid;
  if (info.app === "Jobs") targetTxid = item.jobs?.jobTxid || info.job?.metadata?.job || item.txid;
  if (info.app === "Code") targetTxid = item.repoTxid || item.metadata?.repo || item.txid;
  if (info.app === "Permission") targetTxid = item.permission?.rootTxid || info.permission?.metadata?.grant || item.txid;
  if (info.app === "Boost") targetTxid = item.targetTxid || item.boostTxid || item.txid;
  return {
    id: `${network}:${item.txid}:${item.protocol ?? "unknown"}:${item.protocolVout ?? "legacy"}:${item.recordOrdinal ?? item.kind ?? "record"}`,
    app: info.app, kind: item.kind, label: info.label, detail: text(item.subject) || text(item.detail) || text(item.description),
    direction: item.notificationIdMatch ? notificationIdDirection(item.notificationIdMatch)
      : address == null ? "related" : incoming && outgoing ? "self" : outgoing ? "outgoing" : incoming ? "incoming" : "related",
    status: qualified.status, txid: item.txid, protocolVout: item.protocolVout ?? null,
    recordOrdinal: item.recordOrdinal ?? null, createdAt: item.createdAt, actorAddress, recipientAddresses, relatedTxids,
    evidence: { protocol: item.protocol, valid: qualified.valid, applied: item.applied ?? qualified.lifecycle?.applied,
      chainStatus: item.confirmationStatus ?? item.status, sourceEventId: item.eventId,
      ...(item.decodedKind ? { decodedKind: item.decodedKind, decodedValid: item.decodedValid, decodedReason: item.decodedReason } : {}),
      blockHeight: item.blockHeight, blockHash: item.blockHash, blockIndex: item.blockIndex,
      qualification: qualified.lifecycle ?? (item.dnsPageLinkAuthority ? { ready: true, model: item.dnsPageLinkAuthority } : undefined),
      reason: item.reason ?? item.dnsPageLinkReason ?? qualified.lifecycle?.reason,
      participants: people, refs, ...(item.notificationIdMatch ? { idReference: item.notificationIdMatch } : {}),
      amounts: Object.fromEntries(["amountSats", "amountSatsExact", "totalSats", "totalSatsExact", "priceSats", "priceSatsExact", "paidSats", "paidSatsExact", "amountAtoms", "amountAtomsExact", "amountSubatoms", "amountSubatomsExact", "amountQ8", "amountQ8Exact", "tipAmountSats", "tipAmountSatsExact", "tipWorkSubatoms", "tipWorkSubatomsExact", "tokenId", "ticker"].filter(key => item[key] !== undefined).map(key => [key, item[key]])),
    },
    target: { workspace: info.workspace, txid: targetTxid, ...(info.app === "Code" ? { version: item.txid } : {}) },
    priority: info.priority,
  };
}

function coalesceVerifiedIdAliases(actions) {
  const result = [], positions = new Map();
  for (const action of actions) {
    const authority = action.app === "IDs" ? action.evidence.qualification : null;
    const key = authority?.ready === true && authority.valid === true &&
      authority.model === "canonical-id-lifecycle-replay-v1"
      ? `${action.id}:${authority.sourceEventId}` : null;
    if (!key || !positions.has(key)) {
      if (key) positions.set(key, result.length);
      result.push(action);
      continue;
    }
    const index = positions.get(key), previous = result[index];
    const preferred = String(action.evidence.sourceEventId) === String(authority.sourceEventId) ? action : previous;
    const decoderEvidence = entry => entry.evidence.decodedEvents ?? [{
      sourceEventId: entry.evidence.sourceEventId, kind: entry.evidence.decodedKind ?? entry.kind,
      valid: entry.evidence.decodedValid ?? entry.evidence.valid, reason: entry.evidence.decodedReason ?? entry.evidence.reason,
    }];
    result[index] = { ...preferred, evidence: { ...preferred.evidence,
      sourceEventIds: unique([...(previous.evidence.sourceEventIds ?? [previous.evidence.sourceEventId]),
        ...(action.evidence.sourceEventIds ?? [action.evidence.sourceEventId])]),
      decodedEvents: [...decoderEvidence(previous), ...decoderEvidence(action)] } };
  }
  return result;
}

export function notificationPayload(history, address, { observedAt = new Date().toISOString() } = {}) {
  if (!history || !Array.isArray(history.items)) throw Object.assign(new Error("Notification history is unavailable."), { statusCode: 503 });
  const grouped = new Map();
  for (const item of history.items) {
    if (!grouped.has(item.txid)) grouped.set(item.txid, { txid: item.txid, events: [] });
    grouped.get(item.txid).events.push(item);
  }
  const groups = history.notificationGroups ?? [...grouped.values()];
  const items = groups.map(group => {
    const actions = coalesceVerifiedIdAliases(group.events.map(item => notificationAction(item, address, history.network)));
    const primary = [...actions].sort((a, b) => b.priority - a.priority || (a.protocolVout ?? 0) - (b.protocolVout ?? 0))[0];
    if (!primary) throw Object.assign(new Error("Notification transaction has no inspectable action."), { statusCode: 503 });
    const incoming = actions.some(action => ["incoming", "self"].includes(action.direction));
    const outgoing = actions.some(action => ["outgoing", "self"].includes(action.direction));
    return { ...primary, id: `${history.network}:${group.txid}`, actions,
      firstSeenAt: group.firstSeenAt ?? null,
      maxEventId: Math.max(...actions.flatMap(action => action.evidence.sourceEventIds ?? [action.evidence.sourceEventId]).map(eventId => Number(eventId) || 0)),
      direction: incoming && outgoing ? "self" : outgoing ? "outgoing" : incoming ? "incoming" : "related",
      actorAddress: primary.actorAddress || actions.find(action => action.actorAddress)?.actorAddress || "",
      recipientAddresses: unique(actions.flatMap(action => action.recipientAddresses)), relatedTxids: unique(actions.flatMap(action => action.relatedTxids)) };
  });
  const qualifications = unique(items.flatMap(item => item.actions.filter(action => action.status === "unavailable").map(action => `${action.app}: qualification unavailable`)));
  const result = { ...history, items, model: NOTIFICATION_MODEL, address, observedAt,
    readBoundary: { maxFirstSeenAt: history.notificationMaxFirstSeenAt ?? null, maxEventId: history.maxEventId },
    coverage: { complete: history.complete !== false && history.coverage?.complete !== false, scope: "indexed-computer-actions", pending: "best-effort", qualification: qualifications,
      source: "strict-event-history-transaction-projection", referenceAttribution: "verified-historical-participants-owners-resolvers-and-original-authorship",
      localActions: "Browser views, local edits, navigation and other actions without chain records are not indexed.",
      mentions: "Free-text mentions and current ID mappings do not establish historical recipients." } };
  delete result.notificationGroups;
  delete result.notificationMaxFirstSeenAt;
  if (history.scope?.type === "id") {
    result.address = null;
    result.coverage.scope = "explicit-id-linked-history";
    result.coverage.referenceAttribution = "wire-id-references-and-registration-lifecycle";
    result.coverage.mentions = "Address-only payments and messages do not record which ID was chosen. Former owners' unrelated wallet activity and free-text mentions are excluded.";
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024) throw Object.assign(new Error("Notification page exceeds the bounded response size; request a smaller limit."), { statusCode: 503 });
  return result;
}
