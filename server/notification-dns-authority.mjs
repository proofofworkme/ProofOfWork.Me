import { qualifyDnsSubdomainLogPayload } from "./dns-subdomain-discovery.mjs";
import { qualifyDnsPageLinkLogPayload } from "./dns-page-link-discovery.mjs";
import { qualifyDnsSubdomainPageLinkLogPayload } from "./dns-subdomain-page-links.mjs";

const NETWORKS = new Set(["livenet", "testnet", "testnet4"]);
const HASH = /^[0-9a-f]{64}$/u;
const unavailable = message => Object.assign(new Error(message), { statusCode: 503 });
const noncanonical = item => ["dropped", "orphaned"].includes(item?.confirmationStatus ?? item?.status);
const position = item => [item.txid, item.position?.protocolVout ?? item.protocolVout,
  item.position?.recordOrdinal ?? item.recordOrdinal].join(":");
const families = [
  { prefix: "pwdns1:subpage1:", kind: "dns-subdomain-page-link-", lane: "subdomainPageLink",
    qualify: qualifyDnsSubdomainPageLinkLogPayload },
  { prefix: "pwdns1:page1:", kind: "dns-page-link-", lane: "pageLink", qualify: qualifyDnsPageLinkLogPayload },
  { prefix: "pwdns1:sub1:", kind: "dns-subdomain-", lane: "subdomain", qualify: qualifyDnsSubdomainLogPayload },
];
const texts = item => [item?.payload, item?.rawPayload, item?.protocolPayload, item?.payload?.payload]
  .filter(value => typeof value === "string");
const hexes = item => [item?.rawPayloadHex, item?.workAmoV5RawScriptWitness?.payloadHex,
  ...(Array.isArray(item?.payload?.rawRecordParts) ? item.payload.rawRecordParts : []).map(part => part?.payloadHex)]
  .filter(value => typeof value === "string").map(value => value.toLowerCase());
function familyOf(item) {
  return families.find(family => texts(item).some(value => value.startsWith(family.prefix)) ||
    hexes(item).some(value => value.startsWith(Buffer.from(family.prefix).toString("hex"))) ||
    String(item?.kind ?? "").startsWith(family.kind));
}

// The public Log keeps the original economic decoder outcome. Notifications use
// the separately verified DNS lifecycle, while preserving that decoder evidence.
// These events come from complete Core replay at the same checkpoint; neither a
// current name mapping nor a matching transaction alone supplies authority.
export function qualifyNotificationDns(payload, dns) {
  const collections = ["items", "activity", "events"];
  if (!collections.some(collection => (payload?.[collection] ?? []).some(familyOf))) return payload;
  const height = payload?.indexedThroughBlock ?? payload?.provenance?.indexedThroughBlock;
  const hash = payload?.indexedThroughBlockHash ?? payload?.checkpointHash ?? payload?.provenance?.indexedThroughBlockHash;
  const needsAuthority = collections.some(collection => (payload?.[collection] ?? [])
    .some(item => familyOf(item) && !noncanonical(item)));
  if (needsAuthority && (!NETWORKS.has(payload?.network) || dns?.network !== payload.network ||
      !Number.isSafeInteger(height) || height < 1 || !HASH.test(hash ?? "") ||
      dns.indexedThroughBlock !== height || dns.checkpointHash !== hash)) {
    throw unavailable("Notification DNS authority is unavailable at its exact network checkpoint.");
  }
  const maps = new Map();
  function qualify(item) {
    const family = familyOf(item);
    if (!family) return item;
    // A carrier removed from the chain/mempool is intentionally absent from the
    // current replay. Preserve its inspectable history without claiming current
    // lifecycle authority or making unrelated confirmed notifications unavailable.
    if (noncanonical(item)) return { ...item, protocolValid: undefined, applied: undefined,
      dnsAuthority: { ready: false, reason: "noncanonical-carrier", source: "stored-decoder-evidence" } };
    if (item.network !== payload.network || item.protocol !== "pwdns1" || !HASH.test(item.txid ?? "") ||
        ![item.protocolVout, item.recordOrdinal].every(value => Number.isSafeInteger(value) && value >= 0) ||
        (item.confirmed === true && (!HASH.test(item.blockHash ?? "") ||
          !Number.isSafeInteger(item.blockHeight) || item.blockHeight < 1 || item.blockHeight > height ||
          !Number.isSafeInteger(item.blockIndex) || item.blockIndex < 0))) {
      throw unavailable("Notification DNS carrier lacks exact network and position evidence.");
    }
    if (!maps.has(family)) {
      const events = [...(dns[`${family.lane}Events`] ?? []), ...(dns[`${family.lane}PendingEvents`] ?? [])];
      const map = new Map(events.map(event => [position(event), event]));
      if (map.size !== events.length) throw unavailable("Ambiguous notification DNS carrier authority.");
      maps.set(family, map);
    }
    const event = maps.get(family).get(position(item));
    if (!event || (event.network !== undefined && event.network !== payload.network) ||
        (event.blockHash !== undefined && event.blockHash !== item.blockHash) ||
        typeof event.valid !== "boolean") {
      throw unavailable("Notification DNS carrier is absent from exact replay authority.");
    }
    const suppliedTexts = texts(item).filter(value => value.startsWith(family.prefix));
    const suppliedHexes = hexes(item).filter(value => value.startsWith(Buffer.from(family.prefix).toString("hex")));
    if ((event.decodeValid !== false && suppliedTexts.some(value => value !== event.payload)) ||
        suppliedHexes.some(value => value !== (event.rawPayloadHex ?? Buffer.from(event.payload ?? "").toString("hex")).toLowerCase())) {
      throw unavailable("Notification DNS carrier bytes diverge from exact replay authority.");
    }
    let qualified;
    try {
      // The child Log matcher predates raw-hex carriers. The family has already
      // been detected from exact bytes above; tag only this qualification copy
      // so its complete replay/readiness guards cannot silently skip the row.
      qualified = family.qualify({ network: payload.network, indexedThroughBlock: height,
        indexedThroughBlockHash: hash, items: [{ ...item, kind: `${family.kind}candidate` }] }, dns).items[0];
    } catch (error) { throw unavailable(error.message); }
    if (qualified.protocolValid !== event.valid ||
        !(qualified.dnsPageLinkAuthority ?? qualified.dnsSubdomainAuthority)) {
      throw unavailable("Notification DNS carrier lacks complete replay qualification.");
    }
    const action = event.record?.action;
    const kind = action ? `${family.kind}${action}` : `${family.kind}invalid`;
    const valid = event.valid;
    const applied = item.confirmed === true ? valid : undefined;
    const reason = event.reason ?? null;
    const detail = valid ? qualified.title : reason ?? qualified.title;
    return { ...qualified, kind, valid, protocolValid: valid, applied,
      reason, reasonCode: reason ?? "", subject: detail, detail, description: detail,
      decodedKind: item.decodedKind ?? item.kind, decodedValid: item.decodedValid ?? item.valid,
      decodedReason: item.decodedReason ?? item.reason ?? null,
      dnsAuthority: { ready: true, valid, applied, reason,
        model: qualified.dnsPageLinkAuthority ?? qualified.dnsSubdomainAuthority,
        canonicalKind: kind, status: qualified.dnsPageLinkStatus ?? qualified.dnsSubdomainStatus,
        source: "exact-core-dns-carrier-replay", txid: item.txid,
        protocolVout: item.protocolVout, recordOrdinal: item.recordOrdinal,
        checkpointHeight: height, checkpointHash: hash } };
  }
  const result = { ...payload };
  for (const collection of collections) {
    if (Array.isArray(payload?.[collection])) result[collection] = payload[collection].map(qualify);
  }
  return result;
}
