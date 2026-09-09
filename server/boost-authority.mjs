import { address as bitcoinAddress, networks, Transaction } from "bitcoinjs-lib";
import { decodeCanonicalOpReturnOutput } from "./canonical-op-return.mjs";
import { compareBoostCanonicalEvents, boostProjectionError } from "./boost-projection.mjs";
import { verifiedRawTransaction } from "./boost-growth.mjs";
import { WORK_TOKEN_ID, WORK_ATOMIC_PROJECTION_MODEL, WORK_SUBATOM_PROJECTION_MODEL, workAmountSubatomsFromRecord } from "./work-units.mjs";
import { validateWorkAmoV5SaleTicketSignature, WORK_AMO_V5_ACTIVATION_HEIGHT, WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS } from "./work-amo-v5.mjs";

export const BOOST_AUTHORITY_MODEL = "boost-canonical-authority-v1";
const PAID = new Set(["reply", "like", "reboost", "follow", "unfollow", "transfer", "list", "seal", "delist", "buy"]);
const integer = (value) => (typeof value !== "number" || Number.isSafeInteger(value)) && /^(?:0|[1-9]\d*)$/u.test(String(value ?? "")) ? BigInt(value) : null;
const text = (value) => String(value ?? "").trim();
const txid = (value) => /^[0-9a-f]{64}$/u.test(text(value)) ? text(value) : "";
// Base58 addresses are case sensitive. Bech32 canonical scripts decode lower case.
function addressKey(value) { const address = text(value); return /^(?:bc1|tb1|bcrt1)/iu.test(address) ? address.toLowerCase() : address; }
function sameAddress(left, right) { return Boolean(text(left)) && addressKey(left) === addressKey(right); }
function validAddress(value, network = "livenet") {
  try { bitcoinAddress.toOutputScript(text(value), network === "livenet" ? networks.bitcoin : networks.testnet); return true; }
  catch { return false; }
}
function addressForScript(script, network) {
  try { return bitcoinAddress.fromOutputScript(Buffer.from(script, "hex"), network === "livenet" ? networks.bitcoin : networks.testnet); }
  catch { return ""; }
}
function position(item) {
  return [item.blockHeight, item.blockIndex, item.protocolVout, item.recordOrdinal];
}
function positionValid(item) {
  return position(item).every((value) => Number.isSafeInteger(value) && value >= 0) && item.blockHeight > 0;
}
function before(left, right) {
  if (!positionValid(left) || !positionValid(right)) throw boostProjectionError("Boost authority has an incomplete canonical position.");
  const a = position(left); const b = position(right);
  for (let i = 0; i < a.length; i += 1) { if (a[i] !== b[i]) return a[i] < b[i]; }
  return false;
}

// Only the private DB reader supplies these witnesses. Bind the exact wire
// outputs, first input and carrier to the canonical block-scan transaction.
// The previous-output script is trusted Core block-scan enrichment. This reader
// does not independently replay the previous transaction or its script spend.
export function boostAuthorityWitness(row, checkpoint) {
  const raw = verifiedRawTransaction(row, { blockHeight: checkpoint.indexedThroughBlock });
  if (!raw || row.status !== "confirmed" || !raw.hex) throw boostProjectionError("Boost canonical wire evidence is unavailable.");
  const decoded = Transaction.fromHex(raw.hex);
  if (decoded.ins.length !== raw.vin?.length) throw boostProjectionError("Boost canonical input evidence is incomplete.");
  const inputs = decoded.ins.map((input, index) => {
    const prevTxid = Buffer.from(input.hash).reverse().toString("hex");
    const source = raw.vin[index];
    if (source.txid !== prevTxid || source.vout !== input.index) throw boostProjectionError("Boost input outpoint does not match its wire transaction.");
    return { txid: prevTxid, vout: input.index };
  });
  const prevout = raw.vin[0]?.prevout;
  const actor = addressForScript(prevout?.scriptpubkey ?? prevout?.scriptPubKey?.hex ?? "", checkpoint.network);
  if (!actor) throw boostProjectionError("Boost first-input authority is unavailable.");
  const outputs = decoded.outs.map((output, vout) => ({ vout, valueSats: output.value.toString(), script: Buffer.from(output.script).toString("hex"), address: addressForScript(Buffer.from(output.script).toString("hex"), checkpoint.network) }));
  const carriers = new Map();
  for (let vout = 0; vout < raw.vout.length; vout += 1) {
    const carrier = decodeCanonicalOpReturnOutput(raw.vout[vout]);
    if (carrier.decodeValid && carrier.prefix === "pwb1:") carriers.set(vout, carrier.text);
  }
  const workTransfers = (row.events ?? []).filter((event) => event.protocol === "pwt1" && event.kind === "token-transfer" && event.status === "confirmed" && event.valid === true && event.payload?.valid !== false).map((event) => {
    const transfer = event.payload;
    const vout = event.op_return_vout ?? transfer.protocolVout;
    const ordinal = event.record_ordinal ?? transfer.recordOrdinal;
    const carrier = decodeCanonicalOpReturnOutput(raw.vout[vout]);
    if (!Number.isSafeInteger(vout) || ordinal !== 0 || !carrier.decodeValid || carrier.prefix !== "pwt1:" || carrier.text !== text(event.raw_payload ?? transfer.payload)) throw boostProjectionError("Boost attached WORK cannot bind to its accepted raw carrier.");
    if (transfer.tokenId === WORK_TOKEN_ID && row.block_height >= WORK_AMO_V5_ACTIVATION_HEIGHT) {
      const outcome = transfer.workAmoV5ReplayOutcome;
      const accepted = transfer.workAmoV5ReplayOutput?.projection;
      const acceptedPosition = accepted?.position;
      if (transfer._workAmoV5ReplayBound !== true || transfer.workAmoV5RawCandidate !== true || outcome?.valid !== true || outcome.kind !== "pwt1-valid" || outcome.reasonCode !== "" || accepted?.valid !== true || accepted.kind !== "token-transfer" || accepted.tokenId !== WORK_TOKEN_ID || accepted.txid !== row.txid || accepted.parsed?.payload !== carrier.text || acceptedPosition?.blockHeight !== row.block_height || acceptedPosition.blockHash !== row.block_hash || acceptedPosition.blockTransactionIndex !== row.block_index || acceptedPosition.protocolVout !== vout || acceptedPosition.recordOrdinal !== ordinal || !sameAddress(accepted.senderAddress, transfer.senderAddress ?? transfer.fromAddress ?? transfer.from) || !sameAddress(accepted.recipientAddress, transfer.recipientAddress ?? transfer.toAddress ?? transfer.to)) throw boostProjectionError("Boost attached WORK has no bound accepted canonical replay outcome.");
      const acceptedAmount = workAmountSubatomsFromRecord({ ...accepted, amountStorageModel: accepted.amountSubatoms !== undefined ? WORK_SUBATOM_PROJECTION_MODEL : WORK_ATOMIC_PROJECTION_MODEL });
      if (acceptedAmount !== workAmountSubatomsFromRecord(transfer)) throw boostProjectionError("Boost attached WORK amount conflicts with its accepted replay.");
    }
    return { ...transfer, protocolVout: vout, recordOrdinal: ordinal };
  });
  const workFeeOutputs = new Map();
  for (const transfer of workTransfers) {
    if (transfer.tokenId !== WORK_TOKEN_ID) continue;
    const fee = integer(transfer.paidSats ?? transfer.amountSats);
    if (fee === null || fee < 546n) throw boostProjectionError("Boost attached WORK has no exact accepted registry fee.");
    const output = [...outputs].reverse().find((output) => output.vout < transfer.protocolVout && !workFeeOutputs.has(output.vout) && sameAddress(output.address, WORK_AMO_V5_DECLARATION_REGISTRY_ADDRESS) && integer(output.valueSats) >= fee);
    if (!output) throw boostProjectionError("Boost attached WORK registry fee cannot bind to its wire output.");
    workFeeOutputs.set(output.vout, integer(output.valueSats));
  }
  return { actor, inputs, outputs, carriers, workTransfers, workFeeOutputs, blockHeight: row.block_height, blockIndex: row.block_index, blockHash: row.block_hash };
}

function historicalReceiver(activity, item) {
  let receiver = "";
  for (const change of activity) {
    if (!before(change, item)) break;
    if (["id-register", "id-update", "id-transfer", "id-buy"].includes(change.kind)) receiver = text(change.receiveAddress ?? change.ownerAddress) || receiver;
  }
  return receiver;
}

function ticketTerms(item, actor, witness) {
  const terms = item.saleAuthorization;
  if (!terms || terms.version !== "pwb-sale-v1" || !sameAddress(terms.sellerAddress, actor)) return null;
  const price = integer(terms.priceSats);
  const vout = Number(terms.saleTicketVout ?? terms.anchorVout);
  const value = integer(terms.saleTicketValueSats ?? terms.anchorValueSats);
  if (!price || price > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(vout) || vout <= item.protocolVout || value !== 546n || terms.anchorSigHashType !== 0x83 || terms.anchorType !== "sale-ticket-v1" || !text(terms.nonce)) return null;
  const output = witness.outputs[vout];
  if (!output || integer(output.valueSats) !== value || !sameAddress(output.address, actor) || text(terms.anchorScriptPubKey).toLowerCase() !== output.script) return null;
  if (terms.anchorVout !== undefined && Number(terms.anchorVout) !== vout || terms.saleTicketVout !== undefined && Number(terms.saleTicketVout) !== vout || terms.anchorValueSats !== undefined && integer(terms.anchorValueSats) !== value || terms.saleTicketValueSats !== undefined && integer(terms.saleTicketValueSats) !== value) return null;
  if (terms.buyerAddress && !validAddress(terms.buyerAddress, item.network)) return null;
  if (terms.expiresAt && !Number.isFinite(Date.parse(terms.expiresAt))) return null;
  return { boostTxid: txid(terms.boostTxid), listingTxid: item.txid, priceSats: Number(price), sellerAddress: actor, ticketVout: vout, ticketValueSats: value.toString(), buyerAddress: text(terms.buyerAddress), expiresAt: text(terms.expiresAt), terms, sealed: false };
}

function sameTicketTerms(left, right) {
  return ["version", "boostTxid", "sellerAddress", "sellerPublicKey", "buyerAddress", "priceSats", "nonce", "expiresAt", "anchorType", "anchorSigHashType", "anchorScriptPubKey", "anchorValueSats", "anchorVout", "saleTicketValueSats", "saleTicketVout"].every((key) => text(left?.[key]) === text(right?.[key]));
}

/** Reversible read projection: retain every raw record and report rejections.
 * Invalid, pending and terminal records never change canonical ownership. */
export function validateBoostAuthority(items, { witnesses, registryActivity = [], ticketSpends = [], checkpointTime = "" }) {
  const activity = registryActivity.filter((item) => text(item.id).toLowerCase() === "boost" && item.confirmed === true && item.valid !== false).sort(compareBoostCanonicalEvents);
  if (activity.some((item) => !positionValid(item))) throw boostProjectionError("Boost registry history has incomplete canonical positions.");
  const assets = new Map(); const listings = new Map(); const outcomes = []; const projected = [];
  const spentProofs = new Map(); const attributedWork = new Map(); const seenPositions = new Set();
  const activeTickets = new Map();
  const orderedSpends = [...ticketSpends].sort(compareBoostCanonicalEvents);
  const spentTickets = new Set(ticketSpends.map((spend) => `${spend.prevTxid}:${spend.prevVout}`));
  let spendIndex = 0;
  const ordered = [...items].sort(compareBoostCanonicalEvents);
  for (const source of ordered) {
    if (source.confirmed !== true) {
      if (source.confirmed === false && source.status === "pending" && source.valid !== false) projected.push({ ...source, boostAuthority: { model: BOOST_AUTHORITY_MODEL, accepted: false, pending: true }, proofSignalSats: 0, signalSats: 0, workSignalSubatoms: undefined });
      continue;
    }
    const action = text(source.kind).replace(/^boost-/u, "");
    const positionKey = JSON.stringify(position(source));
    if (!positionValid(source) || seenPositions.has(positionKey)) throw boostProjectionError("Boost history has an incomplete or duplicate canonical position.");
    seenPositions.add(positionKey);
    if (source.valid === false) {
      outcomes.push({ txid: source.txid, protocolVout: source.protocolVout, recordOrdinal: source.recordOrdinal, accepted: false, reason: "wire-shape-invalid" });
      continue;
    }
    let reason = "";
    const witness = witnesses.get(source.txid);
    if (!positionValid(source) || !witness || witness.blockHeight !== source.blockHeight || witness.blockIndex !== source.blockIndex || witness.blockHash !== source.blockHash || source.recordOrdinal !== 0 || witness.carriers.get(source.protocolVout) !== text(source.payload ?? source.rawPayload ?? source.protocolPayload)) throw boostProjectionError("Boost record cannot bind to its canonical transaction position and carrier.");
    const actor = witness.actor;
    while (spendIndex < orderedSpends.length && orderedSpends[spendIndex].txid !== source.txid && before(orderedSpends[spendIndex], source)) {
      const spend = orderedSpends[spendIndex++];
      const entry = activeTickets.get(`${spend.prevTxid}:${spend.prevVout}`);
      if (entry && entry.asset.listing === entry.listing) entry.asset.listing = null;
    }
    if ((source.senderAddress && !sameAddress(source.senderAddress, actor)) || (source.authorAddress && !sameAddress(source.authorAddress, actor))) reason ||= "first-input-authority-mismatch";
    const payments = witness.outputs.filter((output) => output.vout < source.protocolVout && output.address).map((output) => ({ ...output, valueSats: (integer(output.valueSats) - (witness.workFeeOutputs?.get(output.vout) ?? 0n) - (spentProofs.get(`${source.txid}:${output.vout}`) ?? 0n)).toString() })).filter((output) => integer(output.valueSats) > 0n);
    const paidTo = (address) => payments.filter((output) => sameAddress(output.address, address)).reduce((sum, output) => sum + integer(output.valueSats), 0n);
    const receiver = PAID.has(action) ? historicalReceiver(activity, source) : "";
    if (PAID.has(action) && (!receiver || paidTo(receiver) < 546n)) reason ||= "boost-registry-fee-missing";
    let assetTxid = txid(source.boostTxid ?? source.targetTxid ?? source.parentTxid);
    if (action === "post" || action === "reply") assetTxid = source.txid;
    if (["seal", "buy", "delist"].includes(action)) assetTxid = listings.get(txid(source.listingId ?? source.targetTxid))?.boostTxid ?? "";
    const target = assets.get(txid(source.targetTxid ?? source.parentTxid));
    const asset = assets.get(assetTxid);
    let signalAddress = ""; let signal = 0n;
    if (action === "post") {
      signalAddress = actor;
      if (paidTo(actor) <= 0n) reason ||= "post-self-send-missing";
    } else if (["reply", "like", "reboost"].includes(action)) {
      if (!target) reason ||= "confirmed-target-missing";
      signalAddress = target?.ownerAddress ?? "";
    } else if (["follow", "unfollow"].includes(action)) {
      signalAddress = text(source.targetAddress ?? source.followedAddress);
      if (!validAddress(signalAddress, source.network) || sameAddress(signalAddress, actor)) reason ||= "follow-target-invalid";
      if (action === "follow" && paidTo(signalAddress) - (sameAddress(signalAddress, receiver) ? 546n : 0n) < 546n) reason ||= "follow-target-payment-missing";
    } else if (["transfer", "list", "seal", "delist", "hide"].includes(action)) {
      if (!asset) reason ||= "confirmed-target-missing";
      if (asset && !sameAddress(actor, action === "hide" ? asset.authorAddress : asset.ownerAddress)) reason ||= action === "hide" ? "hide-author-required" : "current-owner-required";
    } else if (action !== "buy" && action !== "profile") reason ||= "unsupported-action";
    if (signalAddress) signal = paidTo(signalAddress) - (sameAddress(signalAddress, receiver) ? 546n : 0n);
    if (signal < 0n) signal = 0n;
    if (signal > BigInt(Number.MAX_SAFE_INTEGER)) throw boostProjectionError("Boost direct proof signal exceeds exact integer storage.");
    const allowed = new Set([receiver, signalAddress].filter(Boolean).map(addressKey));
    if (["post", "reply", "like", "reboost", "follow", "unfollow"].includes(action) && payments.some((output) => !allowed.has(addressKey(output.address)))) reason ||= "signal-recipient-is-not-current-owner";
    const declaredWork = integer(source.workSignalSubatoms ?? "0");
    const actualWork = (witness.workTransfers ?? []).filter((transfer) => transfer.tokenId === WORK_TOKEN_ID && sameAddress(transfer.from ?? transfer.fromAddress ?? transfer.senderAddress, actor) && sameAddress(transfer.to ?? transfer.toAddress ?? transfer.recipientAddress, signalAddress)).reduce((sum, transfer) => sum + BigInt(workAmountSubatomsFromRecord(transfer) ?? 0), 0n);
    const workKey = JSON.stringify([source.txid, actor, signalAddress]);
    if (declaredWork === null || declaredWork > actualWork - (attributedWork.get(workKey) ?? 0n)) reason ||= "work-signal-not-backed-by-accepted-transfer";
    let listing;
    if (action === "list") {
      listing = ticketTerms(source, actor, witness);
      if (!listing || listing.boostTxid !== assetTxid) reason ||= "sale-ticket-terms-invalid";
    } else if (action === "seal") {
      // A seal can attest the existing ticket; it cannot replace its terms.
      listing = listings.get(txid(source.listingId));
      if (!listing || asset?.listing !== listing || !sameTicketTerms(source.saleAuthorization, listing.terms) || validateWorkAmoV5SaleTicketSignature({ authorization: source.saleAuthorization, listingId: listing.listingTxid, network: source.network ?? "livenet", unitPriceSats: listing.priceSats }).valid !== true) reason ||= "seal-does-not-match-active-listing";
    } else if (action === "buy") {
      listing = listings.get(txid(source.listingId ?? source.targetTxid));
      const buyer = text(source.buyerAddress ?? source.newOwnerAddress);
      const active = listing && listing.sealed && asset?.listing === listing && sameAddress(asset.ownerAddress, listing.sellerAddress);
      const spends = listing && witness.inputs.some((input) => input.txid === listing.listingTxid && input.vout === listing.ticketVout);
      const expired = listing?.expiresAt && (!Number.isFinite(Date.parse(source.createdAt ?? source.timestamp)) || Date.parse(source.createdAt ?? source.timestamp) >= Date.parse(listing.expiresAt));
      const sellerRequired = listing ? BigInt(listing.priceSats) + BigInt(listing.ticketValueSats) : 0n;
      const settlement = listing && payments.some((output) => sameAddress(output.address, listing.sellerAddress) && integer(output.valueSats) >= sellerRequired);
      const feeSeparate = listing && (!sameAddress(listing.sellerAddress, receiver) || paidTo(receiver) >= sellerRequired + 546n);
      // Ticket input zero may be the seller's pre-signed input. The declared
      // new owner is constrained by the sealed terms, not guessed from input 0.
      if (!active || !spends || !validAddress(buyer, source.network) || (listing.buyerAddress && !sameAddress(buyer, listing.buyerAddress)) || expired || !settlement || !feeSeparate) reason ||= "buyer-settlement-or-ticket-invalid";
    } else if (action === "delist") {
      listing = listings.get(txid(source.listingId ?? source.targetTxid));
      if (!listing || asset?.listing !== listing || !witness.inputs.some((input) => input.txid === listing.listingTxid && input.vout === listing.ticketVout)) reason ||= "active-listing-required";
    } else if (action === "transfer" && !validAddress(source.newOwnerAddress ?? source.ownerAddress ?? source.currentOwnerAddress, source.network)) reason ||= "new-owner-address-invalid";
    const outcome = { txid: source.txid, protocolVout: source.protocolVout, recordOrdinal: source.recordOrdinal, accepted: !reason, reason: reason || undefined };
    outcomes.push(outcome);
    if (reason) continue;
    // The protocol addresses original assets by txid. No documented rule can
    // distinguish two otherwise accepted creations in the same transaction.
    if ((action === "post" || action === "reply") && assets.has(source.txid)) throw boostProjectionError("Boost has ambiguous original asset carriers in one transaction.");
    // Multiple Boost records may share a transaction. Attribute each proof or
    // WORK subatom at most once; later carriers cannot reuse an earlier fee.
    const consume = (address, amount) => {
      for (const output of payments) {
        if (!sameAddress(output.address, address) || amount <= 0n) continue;
        const key = `${source.txid}:${output.vout}`;
        const available = integer(witness.outputs[output.vout]?.valueSats ?? output.valueSats) - (witness.workFeeOutputs?.get(output.vout) ?? 0n) - (spentProofs.get(key) ?? 0n);
        const used = available < amount ? available : amount;
        spentProofs.set(key, (spentProofs.get(key) ?? 0n) + used); amount -= used;
      }
    };
    if (PAID.has(action)) consume(receiver, 546n);
    if (signalAddress) consume(signalAddress, signal);
    if (action === "buy") consume(listing.sellerAddress, BigInt(listing.priceSats) + BigInt(listing.ticketValueSats));
    attributedWork.set(workKey, (attributedWork.get(workKey) ?? 0n) + declaredWork);
    const item = { ...source, authorAddress: actor, senderAddress: actor, boostTxid: assetTxid || source.boostTxid, proofSignalSats: Number(signal), signalSats: Number(signal), workSignalSubatoms: declaredWork > 0n ? declaredWork.toString() : undefined, validationScope: "canonical-state-transition", stateTransitionVerified: true, boostAuthority: { model: BOOST_AUTHORITY_MODEL, accepted: true } };
    if (action === "post" || action === "reply") assets.set(source.txid, { authorAddress: actor, ownerAddress: actor, listing: null, hidden: false });
    if (action === "list") { asset.listing = listing; listings.set(source.txid, listing); activeTickets.set(`${listing.listingTxid}:${listing.ticketVout}`, { asset, listing }); item.listingTxid = source.txid; item.sellerAddress = actor; }
    if (action === "seal") { listing.sealed = true; item.listingTxid = listing.listingTxid; item.sellerAddress = listing.sellerAddress; }
    if (action === "hide") asset.hidden = true;
    if (action === "delist") asset.listing = null;
    if (action === "transfer" || action === "buy") { asset.ownerAddress = addressKey(source.newOwnerAddress ?? source.buyerAddress ?? source.ownerAddress ?? source.currentOwnerAddress); asset.listing = null; item.newOwnerAddress = asset.ownerAddress; }
    projected.push(item);
  }
  for (const item of projected) {
    if (!["boost-list", "boost-seal"].includes(item.kind)) continue;
    const listing = listings.get(item.listingTxid);
    const expired = listing?.expiresAt && (!Number.isFinite(Date.parse(checkpointTime)) || Date.parse(checkpointTime) >= Date.parse(listing.expiresAt));
    item.listingActive = Boolean(listing && !expired && assets.get(item.boostTxid)?.listing === listing && !assets.get(item.boostTxid)?.hidden && !spentTickets.has(`${listing.listingTxid}:${listing.ticketVout}`));
  }
  return { items: projected, outcomes, model: BOOST_AUTHORITY_MODEL };
}
