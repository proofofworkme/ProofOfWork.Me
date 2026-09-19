import { address, networks } from "bitcoinjs-lib";
import { decodeCanonicalOpReturnOutput } from "./canonical-op-return.mjs";
import { boostProjectionError, compareBoostCanonicalEvents } from "./boost-projection.mjs";

const MAX_MONEY = 2_100_000_000_000_000n;
function amount(value) {
  const text = String(value ?? "");
  return /^(?:0|[1-9]\d*)$/u.test(text) && BigInt(text) <= MAX_MONEY ? BigInt(text) : null;
}
function scriptFor(value) {
  try { return Buffer.from(address.toOutputScript(value, networks.bitcoin)).toString("hex"); }
  catch { return ""; }
}
function carrier(tx, item) {
  if (!Number.isSafeInteger(item.protocolVout) || item.protocolVout < 0 || item.recordOrdinal !== 0) return "";
  const record = decodeCanonicalOpReturnOutput(tx.vout?.[item.protocolVout]);
  return record.decodeValid && record.prefix === "pwb1:" ? record.text : "";
}
function jsonTerms(text) {
  try {
    const bytes = Buffer.from(text, "base64url");
    if (bytes.toString("base64url") !== text) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; }
}

// readCanonicalTransaction must bind Core raw bytes, canonical block hash, and
// transaction position. Unavailable evidence throws; a proved malformed purchase
// is rejected without altering raw history or canonical issuance/ledger records.
export async function verifiedBoostTicketClosures(items, readCanonicalTransaction) {
  const buys = items.filter(item => ["boost-buy", "boost-delist"].includes(item.kind) && item.confirmed === true && item.valid === true);
  const verified = new Set();
  for (const buy of buys) {
    const listingId = String(buy.listingId ?? buy.listingTxid ?? buy.targetTxid ?? "");
    const candidates = items.filter(item => item.kind === "boost-list" && item.confirmed === true && item.valid === true && item.txid === listingId);
    if (candidates.length !== 1) continue;
    const listing = candidates[0];
    if (compareBoostCanonicalEvents(listing, buy) >= 0) continue;
    const [listTx, buyTx] = await Promise.all([readCanonicalTransaction(listing), readCanonicalTransaction(buy)]);
    if (!listTx || !buyTx) throw boostProjectionError("Core Boost purchase evidence is unavailable.");
    const wireListing = carrier(listTx, listing).split(":");
    if (wireListing.length !== 3 || wireListing[1] !== "list5") continue;
    const terms = jsonTerms(wireListing[2]);
    if (!terms || terms.version !== "pwb-sale-v1" || terms.anchorType !== "sale-ticket-v1" ||
        terms.anchorVout !== 2 || terms.saleTicketVout !== 2 || terms.anchorSigHashType !== 0x83 ||
        amount(terms.anchorValueSats) !== 546n || amount(terms.saleTicketValueSats) !== 546n) continue;
    const price = amount(terms.priceSats), seller = terms.sellerAddress, script = scriptFor(seller);
    if (price === null || price <= 0n || !script || terms.anchorScriptPubKey !== script ||
        terms.boostTxid !== (listing.boostTxid ?? listing.targetTxid) ||
        seller !== listing.sellerAddress || amount(listing.priceSats) !== price ||
        listTx.vin?.[0]?.prevout?.scriptpubkey_address !== seller) continue;
    const anchor = listTx.vout?.[2];
    if (anchor?.scriptpubkey !== script || amount(anchor?.value) !== 546n) continue;
    const wireBuy = carrier(buyTx, buy).split(":");
    if (buy.kind === "boost-delist") {
      if (wireBuy.length !== 3 || wireBuy[1] !== "delist5" || wireBuy[2] !== listingId ||
          buyTx.vin?.[0]?.prevout?.scriptpubkey_address !== seller) continue;
    } else if (wireBuy.length !== 4 || wireBuy[1] !== "buy5" || wireBuy[2] !== listingId ||
        wireBuy[3] !== buy.buyerAddress || !scriptFor(wireBuy[3]) ||
        (terms.buyerAddress && terms.buyerAddress !== wireBuy[3])) continue;
    if (buy.kind === "boost-buy" && terms.expiresAt) {
      const expires = Date.parse(terms.expiresAt), confirmedTime = buyTx.status?.block_time;
      if (!Number.isFinite(expires) || !Number.isSafeInteger(confirmedTime) || confirmedTime * 1000 >= expires) continue;
    }
    const inputs = (buyTx.vin ?? []).filter(input => input.txid === listingId && input.vout === 2);
    if (inputs.length !== 1 || inputs[0].prevout?.scriptpubkey !== script || amount(inputs[0].prevout?.value) !== 546n) continue;
    // Preserve minimum-payment semantics and sum exact outputs before the
    // carrier. If seller and registry coincide, allocate the registry fee once
    // before checking consideration plus return of the seller-owned anchor.
    const registryScript = scriptFor(buy.applicationBoostRegistryReceiver);
    if (!registryScript) continue;
    let sellerPaid = 0n, registryPaid = 0n, amountsValid = true;
    for (const output of (buyTx.vout ?? []).slice(0, buy.protocolVout)) {
      const value = amount(output.value);
      if (value === null) { amountsValid = false; break; }
      if (output.scriptpubkey === script) sellerPaid += value;
      if (output.scriptpubkey === registryScript) registryPaid += value;
    }
    if (!amountsValid || registryPaid < 546n ||
        (buy.kind === "boost-buy" && sellerPaid < price + 546n + (script === registryScript ? 546n : 0n))) continue;
    verified.add(String(buy.eventId));
  }
  return verified;
}
