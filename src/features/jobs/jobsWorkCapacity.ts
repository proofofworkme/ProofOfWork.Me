import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { canonicalWorkCapacityAddress, requireCanonicalWorkCapacity } from "../../shared/work/canonicalWorkCapacity";
import { readActionReceipts } from "../../shared/wallet/actionRecovery";
import { JOBS_WORK_TOKEN_ID, normalizeJobReward } from "../../shared/protocol/jobs.mjs";
import { workAtomsFromRecord, workSubatomsFromCanonicalString } from "../../workAmount";

type Row = Record<string, unknown>;
type WalletPayload = Row & {
  holders: Row[]; listings: Row[]; closedListings: Row[]; transfers: Row[]; sales: Row[];
};
const txid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const object = (value: unknown): value is Row => Boolean(value && typeof value === "object" && !Array.isArray(value));
const address = (value: unknown) => canonicalWorkCapacityAddress(typeof value === "string" ? value : "");
const key = (row: Row) => `${row.network}:${row.listingId}`;
const auth = (row: Row): Row => object(row.saleAuthorization) ? row.saleAuthorization : {};
const unavailable = (detail = ""): never => { throw new Error(`Complete authoritative WORK wallet spendability is unavailable${detail ? `: ${detail}` : "."}`); };

function exactAmount(row: Row): bigint {
  // Native Q16 and historical integer/string forms use the same exact parser
  // as Computer. A display Number alone cannot authorize a new debit.
  const amount = workAtomsFromRecord(row.amountAtoms, typeof row.amount === "string" ? row.amount : undefined, row.amountSubatoms);
  if (amount === null || amount <= 0n ||
      row.amountSubatoms === undefined && typeof row.amountAtoms !== "string" && typeof row.amount !== "string") {
    return unavailable("a pending WORK debit has no consistent exact amount");
  }
  return amount;
}
function spendableAnchor(row: Row) {
  const value = auth(row), publicKey = value.sellerPublicKey;
  return Boolean(row.registryAddress && row.sellerAddress && row.tokenId) &&
    ["pwt-sale-v1", "pwt-sale-v2", "pwt-sale-v3", "pwt-sale-v4", "pwt-sale-v5", "pwt-sale-v6", "pwt-sale-v8"].includes(String(value.version)) &&
    value.anchorType === "sale-ticket-v1" && value.anchorVout === 2 && value.anchorValueSats === 546 && value.anchorSigHashType === 131 &&
    typeof value.anchorScriptPubKey === "string" && /^[0-9a-f]+$/u.test(value.anchorScriptPubKey) &&
    typeof publicKey === "string" && /^(?:[0-9a-fA-F]{64}|(?:02|03)[0-9a-fA-F]{64}|04[0-9a-fA-F]{128})$/u.test(publicKey);
}
function sealRank(row: Row) {
  const value = auth(row), signature = value.anchorSignature;
  const sealed = spendableAnchor(row) && txid(value.anchorTxid) && typeof signature === "string" &&
    /^[0-9a-fA-F]+$/u.test(signature) && signature.length >= 18 && signature.length <= 146 && signature.length % 2 === 0;
  return sealed ? row.sealConfirmed === true ? 2 : 1 : 0;
}
function mergeListing(current: Row | undefined, incoming: Row) {
  if (!current || sealRank(current) <= sealRank(incoming)) return incoming;
  return { ...incoming, saleAuthorization: current.saleAuthorization, sealAt: current.sealAt,
    sealConfirmed: current.sealConfirmed, sealDataBytes: current.sealDataBytes, sealTxid: current.sealTxid };
}
function confirmedClosure(row: Row) {
  return Boolean(row.closedConfirmed ?? row.confirmed) || row.relic === true && row.confirmed === true &&
    String(row.status ?? "").trim().toLowerCase() === "disabled" && ["work-market-v2-cutover", "work-market-v4-cutover", "work-amo-v5-pre-unit-relic", "work-amo-v8-preactivation-relic"].includes(String(row.disabledReason ?? "").trim().toLowerCase()) &&
    Number.isSafeInteger(Number(row.disabledAtBlockHeight)) && Number(row.disabledAtBlockHeight) > 0 && txid(String(row.disabledByTxid ?? "").trim().toLowerCase());
}
function assertPayload(value: unknown): asserts value is WalletPayload {
  if (!object(value) || value.network !== "livenet" || value.authoritativeWallet !== true || value.walletScoped !== true ||
      typeof value.source !== "string" || !value.source.split("+").includes("proof-indexer-wallet-token-overlay") ||
      value.checkpointComplete === false || value.listingBookComplete === false ||
      value.tokenScope !== undefined && value.tokenScope !== JOBS_WORK_TOKEN_ID) unavailable();
  const payload = value as WalletPayload;
  for (const collection of ["holders", "listings", "closedListings", "transfers", "sales"] as const) {
    const rows = payload[collection];
    if (!Array.isArray(rows) || rows.some(row => !object(row)) ||
        object(payload.collectionHasMore) && payload.collectionHasMore[collection] === true) unavailable(`incomplete ${collection}`);
    const count = object(payload.totalCounts) ? payload.totalCounts[collection] : undefined;
    if (count !== undefined && count !== null && (!Number.isSafeInteger(count) || count !== rows.length)) unavailable(`inconsistent ${collection} count`);
    for (const row of rows) {
      if (row.network !== undefined && row.network !== "livenet" ||
          ["confirmed", "closedConfirmed"].some(field => row[field] !== undefined && typeof row[field] !== "boolean")) unavailable("inconsistent wallet record scope");
    }
  }
}

/** The existing Computer WORK spending rule, scoped to one fresh wallet response.
 * Canonical reservations cannot be released by a pending spend. Pending incoming
 * credit is never funding, and a V8 intent uses only its receipt's existing hold. */
export function jobsWorkCapacityFromPayload(value: unknown, walletAddress: string, nowMs = Date.now()) {
  assertPayload(value);
  const owner = address(walletAddress);
  if (!owner) unavailable("missing wallet address");
  const holders = value.holders.filter(row => String(row.address ?? "") === owner && row.tokenId === JOBS_WORK_TOKEN_ID);
  if (holders.length > 1) unavailable("ambiguous canonical WORK holder");
  const balance = holders.length ? workSubatomsFromCanonicalString(holders[0].balanceSubatoms) : 0n;
  if (balance === null) unavailable("missing exact confirmed WORK balance");
  const capacity = requireCanonicalWorkCapacity(value.canonicalWorkCapacities, {
    address: walletAddress, network: "livenet", tokenId: JOBS_WORK_TOKEN_ID,
    indexedThroughBlock: value.indexedThroughBlock as number, indexedThroughBlockHash: value.indexedThroughBlockHash as string,
    confirmedBalanceSubatoms: balance!,
  });
  const closed = new Map<string, Row>();
  for (const row of value.closedListings) {
    const prior = closed.get(key(row));
    if (!prior || confirmedClosure(row) || !confirmedClosure(prior)) closed.set(key(row), row);
  }
  const confirmedClosed = new Set([...closed.values()].filter(confirmedClosure).map(key));
  const active = new Map(value.listings.filter(row => spendableAnchor(row) && !confirmedClosed.has(key(row))).map(row => [key(row), row]));
  for (const row of closed.values()) if (!confirmedClosure(row)) active.set(key(row), mergeListing(active.get(key(row)), row));
  const listings = [...active.values()];
  const activeIds = new Set(capacity.reservations.keys());
  let pendingReserved = 0n, unknownListingAmount = false;
  const anchors = new Map<string, { txid: string; vout: number }>();
  for (const row of listings) {
    if (row.tokenId !== JOBS_WORK_TOKEN_ID || address(row.sellerAddress) !== owner) continue;
    const listingId = typeof row.listingId === "string" ? row.listingId : unavailable("unbound WORK listing");
    if (!txid(listingId)) unavailable("unbound WORK listing");
    activeIds.add(listingId);
    const authorization = auth(row);
    if (spendableAnchor(row)) {
      const anchor = authorization.anchorTxid || listingId;
      const anchorTxid = typeof anchor === "string" ? anchor : unavailable("unbound WORK sale-ticket anchor");
      if (!txid(anchorTxid)) unavailable("unbound WORK sale-ticket anchor");
      anchors.set(`${anchorTxid}:2`, { txid: anchorTxid, vout: 2 });
    }
    if (capacity.reservations.has(listingId) || row.confirmed || !spendableAnchor(row) ||
        authorization.expiresAt && Date.parse(String(authorization.expiresAt)) <= nowMs) continue;
    if (authorization.version === "pwt-sale-v8") {
      if (capacity.pendingListingReserve === undefined) unknownListingAmount = true;
      else pendingReserved += capacity.pendingListingReserve;
    } else {
      const amount = workAtomsFromRecord(row.amountAtoms, row.amount, row.amountSubatoms);
      if ((amount === null || amount <= 0n) && (object(row.estimate) && row.estimate.estimateOnly === true ||
          object(row.workAmoEstimate) && row.workAmoEstimate.estimateOnly === true)) unknownListingAmount = true;
      else pendingReserved += exactAmount(row);
    }
  }
  const transfers = new Map<string, Row[]>();
  for (const row of value.transfers) {
    // Canonical WORK keeps exact recipient spelling. Uniformly uppercased
    // Bech32 input must not silently become an incoming/self funding release.
    if (row.tokenId !== JOBS_WORK_TOKEN_ID || address(row.senderAddress) !== owner || String(row.recipientAddress ?? "").trim() === owner) continue;
    const transaction = String(row.txid ?? "").trim().toLowerCase();
    if (!txid(transaction)) {
      if (row.confirmed) continue;
      unavailable("unbound WORK transfer");
    }
    const amount = row.confirmed ? workAtomsFromRecord(row.amountAtoms, row.amount, row.amountSubatoms) : exactAmount(row);
    if (amount === null || amount <= 0n) continue;
    const exactKeys = row.amountSubatoms !== undefined;
    const sender = String(row.senderAddress ?? "").trim(), receiver = String(row.recipientAddress ?? "").trim();
    const identity = `${transaction}:${row.tokenId}:${exactKeys ? sender : sender.toLowerCase()}:${exactKeys ? receiver : receiver.toLowerCase()}:${amount}`;
    transfers.set(identity, [...(transfers.get(identity) ?? []), row]);
  }
  let pendingOutgoing = 0n;
  for (const group of transfers.values()) if (!group.some(row => row.confirmed)) {
    for (const row of group) pendingOutgoing += exactAmount(row);
  }
  const sales = new Map<string, Row>();
  for (const row of value.sales) {
    if (row.tokenId !== JOBS_WORK_TOKEN_ID || !row.txid) continue;
    if (!txid(row.txid)) unavailable("unbound WORK sale");
    const identity = String(row.listingId || row.txid), prior = sales.get(identity);
    if (!prior || row.confirmed || !prior.confirmed) sales.set(identity, row);
  }
  for (const row of sales.values()) if (!row.confirmed && address(row.sellerAddress) === owner && !activeIds.has(String(row.listingId))) {
    pendingOutgoing += exactAmount(row);
  }
  const reserved = capacity.reserved + pendingReserved, calculated = capacity.confirmed - reserved - pendingOutgoing;
  return { anchorOutpoints: [...anchors.values()], spendableSubatoms: unknownListingAmount || calculated < 0n ? 0n : calculated,
    reservedSubatoms: reserved, pendingOutgoingSubatoms: pendingOutgoing, pendingWorkListingAmountUnknown: unknownListingAmount };
}

/** Uncertain local acceptances hold the wallet until status recovery resolves them.
 * Only the current just-signed transaction may exclude its own receipt at broadcast. */
export function assertNoUnresolvedJobsWorkAcceptance(storage: Storage, walletAddress: string, ownSignedTxid?: string) {
  if (ownSignedTxid !== undefined && !txid(ownSignedTxid)) unavailable("invalid current signed transaction");
  for (const receipt of readActionReceipts(storage)) {
    if (receipt.txid === ownSignedTxid || receipt.network !== "livenet" || address(receipt.address) !== address(walletAddress) ||
        !receipt.key.startsWith("jobs:") || !["unknown", "pending"].includes(receipt.status)) continue;
    const fields = Object.fromEntries(receipt.fields);
    let draft: Row, reviewed: unknown;
    try {
      draft = JSON.parse(fields["Jobs draft"] ?? "null");
      reviewed = fields["Jobs reviewed reward"] === undefined ? undefined : JSON.parse(fields["Jobs reviewed reward"]);
      if (!object(draft)) throw new Error();
    } catch { return unavailable("unreadable unresolved Jobs receipt"); }
    if (draft.action !== "accept") continue;
    const reward = reviewed === undefined ? null : normalizeJobReward(reviewed);
    if (reviewed !== undefined && !reward) unavailable("unreadable reviewed acceptance reward");
    if (reward?.asset === "WORK" || draft.rewardAsset === "WORK") {
      throw new Error("An earlier signed WORK job acceptance is unknown or pending. Check Transaction recovery before spending more WORK.");
    }
  }
}
export async function fetchJobsWorkCapacity(walletAddress: string, { ownSignedTxid }: { ownSignedTxid?: string } = {}) {
  assertNoUnresolvedJobsWorkAcceptance(localStorage, walletAddress, ownSignedTxid);
  const params = new URLSearchParams({ address: walletAddress, asset: JOBS_WORK_TOKEN_ID, wallet: "1", fresh: "1" });
  const payload = await fetchProofApiJson<unknown>(`/api/v1/token?${params}`, "livenet");
  assertNoUnresolvedJobsWorkAcceptance(localStorage, walletAddress, ownSignedTxid);
  return jobsWorkCapacityFromPayload(payload, walletAddress);
}
