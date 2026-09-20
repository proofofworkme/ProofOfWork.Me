import {
  isWorkAmoV5LivenetAddress,
  WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL,
} from "./work-amo-v5.mjs";
import {
  validateWorkAmoV8BoundaryTransitionPayload,
  WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL,
} from "./work-amo-v8.mjs";
import { WORK_TOKEN_ID } from "./work-units.mjs";

export const CANONICAL_WORK_WALLET_CAPACITY_MODEL =
  "canonical-work-wallet-capacity-v1";

function addressKey(value) {
  if (typeof value !== "string") return null;
  const address = value.trim();
  if (!isWorkAmoV5LivenetAddress(address)) return null;
  return /^bc1/iu.test(address) ? address.toLowerCase() : address;
}

// Replay preserves address keys exactly. A valid uppercase Bech32 history key
// must not be merged with the lowercase address derived from a Core script.
function storedAddressKey(value) {
  return typeof value === "string" && value === value.trim() &&
    isWorkAmoV5LivenetAddress(value) ? value : null;
}

function requestScope({ network, blockHeight, blockHash, addresses } = {}) {
  if (network !== "livenet" || !Number.isSafeInteger(blockHeight) ||
      blockHeight < 1 || typeof blockHash !== "string" ||
      !/^[0-9a-f]{64}$/u.test(blockHash) || !Array.isArray(addresses)) return null;
  const normalized = addresses.map(addressKey);
  if (normalized.some((address) => !address) ||
      new Set(normalized).size !== normalized.length) return null;
  return { network, blockHeight, blockHash, addresses: normalized };
}

function exactCommitment(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === "model,payloadBytes,sha256" &&
    value.model === WORK_AMO_V5_PAYLOAD_COMMITMENT_MODEL &&
    Number.isSafeInteger(value.payloadBytes) && value.payloadBytes > 0 &&
    typeof value.sha256 === "string" && /^[0-9a-f]{64}$/u.test(value.sha256)
    ? { model: value.model, payloadBytes: value.payloadBytes, sha256: value.sha256 }
    : null;
}

function transitionEnvelope(transition) {
  if (!transition || typeof transition !== "object") return null;
  const result = { ...transition };
  for (const [camel, snake] of [
    ["blockHeight", "block_height"], ["blockHash", "block_hash"],
    ["previousBlockHash", "previous_block_hash"],
    ["openingNetworkValueQ8", "opening_network_value_q8"],
    ["closingNetworkValueQ8", "closing_network_value_q8"],
    ["openingStateSha256", "opening_state_sha256"],
    ["closingStateSha256", "closing_state_sha256"],
    ["openingStatePayloadBytes", "opening_state_payload_bytes"],
    ["closingStatePayloadBytes", "closing_state_payload_bytes"],
    ["stateCommitmentModel", "state_commitment_model"],
    ["workTokenStateModel", "work_token_state_model"],
    ["blockAtomic", "block_atomic"], ["feeOnce", "fee_once"],
    ["invalidZero", "invalid_zero"],
  ]) {
    if (result[camel] !== undefined && result[snake] !== undefined &&
        result[camel] !== result[snake]) return null;
    result[camel] ??= result[snake];
  }
  return result;
}

function capacityState(transition, scope) {
  const envelope = transitionEnvelope(transition);
  if (!envelope || envelope.network !== scope.network ||
      envelope.blockHeight !== scope.blockHeight ||
      envelope.blockHash !== scope.blockHash) return null;
  const validation = validateWorkAmoV8BoundaryTransitionPayload(envelope);
  if (!validation.valid) return null;
  const state = validation.closingTokenState;
  const commitment = exactCommitment(validation.closingState.tokenStateCommitment);
  if (!commitment || !Array.isArray(state.holders) || !Array.isArray(state.listings) ||
      (state.model !== undefined && state.model !== WORK_AMO_V8_TOKEN_STATE_PREIMAGE_MODEL)) return null;
  const holders = new Map();
  const positive = (value) => typeof value === "string" && /^[1-9][0-9]*$/u.test(value);
  for (const holder of state.holders) {
    const address = storedAddressKey(holder?.address);
    if (!address ||
        !positive(holder.balanceSubatoms) || holders.has(address)) return null;
    holders.set(address, { balance: BigInt(holder.balanceSubatoms), reserved: 0n, reservations: [] });
  }
  const listingIds = new Set();
  let reserved = 0n;
  for (const listing of state.listings) {
    const seller = storedAddressKey(listing?.sellerAddress);
    if (!seller ||
        typeof listing.listingId !== "string" || !/^[0-9a-f]{64}$/u.test(listing.listingId) ||
        listingIds.has(listing.listingId) || !positive(listing.amountSubatoms) ||
        !holders.has(seller)) return null;
    listingIds.add(listing.listingId);
    const holder = holders.get(seller);
    const amount = BigInt(listing.amountSubatoms);
    holder.reserved += amount;
    reserved += amount;
    holder.reservations.push({ listingId: listing.listingId, amountSubatoms: listing.amountSubatoms });
  }
  if ((state.reservedSubatoms !== undefined && state.reservedSubatoms !== reserved.toString()) ||
      [...holders.values()].some((holder) => holder.reserved > holder.balance)) return null;
  const capacities = new Map();
  for (const [address, holder] of holders) {
    holder.reservations.sort((left, right) =>
      left.listingId < right.listingId ? -1 : left.listingId > right.listingId ? 1 : 0);
    capacities.set(address, {
      model: CANONICAL_WORK_WALLET_CAPACITY_MODEL,
      network: scope.network,
      address,
      tokenId: WORK_TOKEN_ID,
      indexedThroughBlock: scope.blockHeight,
      indexedThroughBlockHash: scope.blockHash,
      confirmedBalanceSubatoms: holder.balance.toString(),
      reservedBalanceSubatoms: holder.reserved.toString(),
      transferableBalanceSubatoms: (holder.balance - holder.reserved).toString(),
      reservations: holder.reservations,
      tokenStateCommitment: commitment,
    });
  }
  return { capacities, commitment, closingStateSha256: envelope.closingStateSha256,
    closingStatePayloadBytes: envelope.closingStatePayloadBytes };
}

function requestedCapacities(state, scope) {
  return scope.addresses.map((address) => structuredClone(state.capacities.get(address) ?? {
    model: CANONICAL_WORK_WALLET_CAPACITY_MODEL,
    network: scope.network,
    address,
    tokenId: WORK_TOKEN_ID,
    indexedThroughBlock: scope.blockHeight,
    indexedThroughBlockHash: scope.blockHash,
    confirmedBalanceSubatoms: "0",
    reservedBalanceSubatoms: "0",
    transferableBalanceSubatoms: "0",
    reservations: [],
    tokenStateCommitment: state.commitment,
  }));
}

// The boundary validator rehashes sufficient state and the complete token state.
// Capacity is derived from every replay reservation, independent of Core's book.
export function canonicalWorkWalletCapacitiesFromTransition(transition, options) {
  const scope = requestScope(options);
  if (!scope) return null;
  const state = capacityState(transition, scope);
  return state ? requestedCapacities(state, scope) : null;
}

// Each read first checks a canonical DB fence. Only compact verified capacities
// are cached; transaction payloads and token-state preimages are not retained.
export function createCanonicalWorkWalletCapacityReader({ readCheckpoint, readTransition }) {
  const cache = new Map();
  const inFlight = new Map();
  return async (network, options = {}) => {
    const scope = requestScope({ ...options, network });
    if (!scope) return null;
    const checkpoint = await readCheckpoint(scope);
    const commitment = exactCommitment(checkpoint?.tokenStateCommitment);
    if (!commitment || checkpoint.network !== network ||
        checkpoint.blockHeight !== scope.blockHeight || checkpoint.blockHash !== scope.blockHash ||
        !/^[0-9a-f]{64}$/u.test(checkpoint.closingStateSha256 ?? "") ||
        !Number.isSafeInteger(checkpoint.closingStatePayloadBytes) || checkpoint.closingStatePayloadBytes < 1) return null;
    const key = JSON.stringify([network, scope.blockHeight, scope.blockHash,
      checkpoint.closingStateSha256, checkpoint.closingStatePayloadBytes, commitment]);
    let state = cache.get(key);
    if (!state) {
      let pending = inFlight.get(key);
      if (!pending) {
        if (inFlight.size >= 8) return null;
        pending = (async () => {
          const loaded = capacityState(await readTransition(scope), scope);
          if (!loaded || loaded.closingStateSha256 !== checkpoint.closingStateSha256 ||
              loaded.closingStatePayloadBytes !== checkpoint.closingStatePayloadBytes ||
              JSON.stringify(loaded.commitment) !== JSON.stringify(commitment)) return null;
          cache.set(key, loaded);
          if (cache.size > 8) cache.delete(cache.keys().next().value);
          return loaded;
        })();
        inFlight.set(key, pending);
      }
      try {
        state = await pending;
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
      if (!state) return null;
    }
    return requestedCapacities(state, scope);
  };
}
