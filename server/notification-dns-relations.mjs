import { parseDnsPageLinkPayload } from "../src/shared/protocol/dnsPages.mjs";
import { parseDnsSubdomainPageLinkPayload } from "../src/shared/protocol/dnsSubdomainPages.mjs";
import { parseDnsSubdomainPayload } from "../src/shared/protocol/dnsSubdomains.mjs";
import { notificationAddressKey } from "./notification-query.mjs";

// Older generic index rows intentionally retain their raw carrier validity.
// Decode additive references for read selection only; complete DNS replay still
// qualifies every returned action before the API calls it accepted.
export function notificationDnsRelation(row, validateAddress) {
  const payload = typeof row.payload === "string" ? row.payload : row.payload?.payload ?? row.payload?.rawPayload;
  const page = parseDnsPageLinkPayload(payload) ?? parseDnsSubdomainPageLinkPayload(payload);
  const child = page ? null : parseDnsSubdomainPayload(payload, { validateAddress });
  return {
    txid: row.txid, blockHeight: Number(row.block_height), blockIndex: Number(row.block_index),
    protocolVout: Number(row.op_return_vout), recordOrdinal: Number(row.record_ordinal), status: row.status,
    pageTxid: page?.pageTxid ?? "", resolver: child?.resolver ? notificationAddressKey(child.resolver) : "",
    record: page ?? child,
  };
}
