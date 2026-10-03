import * as bitcoin from "bitcoinjs-lib";
import { verifyBitcoinIdentityMessageSignature } from "./bitcoinMessageVerifier.mjs";

// Preserve the signed Boost intent format and storage namespace. Selection is
// browser-local preference; it does not publish a profile or authorize spending.
export const SOCIAL_IDENTITY_STORAGE_KEY = "proofofwork.boost.profileIntent.v1";
export const SOCIAL_IDENTITY_REQUEST = "proofofwork.socialIdentity.request.v1";
export const SOCIAL_IDENTITY_RESPONSE = "proofofwork.socialIdentity.response.v1";
export const SOCIAL_IDENTITY_CHANGED = "proofofwork.socialIdentity.changed.v1";
export const SOCIAL_IDENTITY_ORIGINS = Object.freeze([
  "https://boost.proofofwork.me",
  "https://publish.proofofwork.me",
  "https://computer.proofofwork.me",
]);

export function normalizeSocialIdentityId(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/^@/u, "").replace(/@proofofwork\.me$/u, "")
    : "";
}

export function socialIdentityIntentMessage(intent) {
  return [
    "ProofOfWork.Me Boost profile intent",
    `network:${intent.network}`,
    `address:${intent.address.trim()}`,
    `id:${normalizeSocialIdentityId(intent.id)}@proofofwork.me`,
    `createdAt:${intent.createdAt}`,
  ].join("\n");
}

export function socialIdentityAccountKey(address, network) {
  // Base58 addresses are case-sensitive. Never lowercase this key.
  return `${network}:${address.trim()}`;
}

export function validSocialIdentityAccount(address, network) {
  if (typeof address !== "string" || address !== address.trim() || address.length > 90) return false;
  if (!["livenet", "testnet", "testnet4"].includes(network)) return false;
  try {
    bitcoin.address.toOutputScript(address, network === "livenet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet);
    return true;
  } catch {
    return false;
  }
}

export function verifiedSocialIdentityIntent(value, address, network, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { createdAt, id, message, signature } = value;
  if (!validSocialIdentityAccount(value.address, value.network)) return undefined;
  if ((address !== undefined && value.address !== address.trim()) || (network !== undefined && value.network !== network)) return undefined;
  if (typeof id !== "string" || !id || id.length > 255 || /[\r\n\u0000]/u.test(id) || normalizeSocialIdentityId(id) !== id) return undefined;
  if (typeof createdAt !== "string" || createdAt.length !== 24) return undefined;
  const createdTime = Date.parse(createdAt);
  if (!Number.isFinite(createdTime) || createdTime > now + 300_000 || new Date(createdTime).toISOString() !== createdAt) return undefined;
  if (typeof message !== "string" || message.length > 1024 || typeof signature !== "string" || signature.length > 512) return undefined;
  const intent = { address: value.address, createdAt, id, message, network: value.network, signature };
  if (message !== socialIdentityIntentMessage(intent)) return undefined;
  return verifyBitcoinIdentityMessageSignature(intent.address, message, signature) ? intent : undefined;
}

export function newestSocialIdentityIntent(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  return Date.parse(candidate.createdAt) > Date.parse(current.createdAt) ? candidate : current;
}

export function readSocialIdentityIntent(storage, address, network) {
  try {
    const values = JSON.parse(storage.getItem(SOCIAL_IDENTITY_STORAGE_KEY) ?? "{}");
    if (!values || typeof values !== "object" || Array.isArray(values)) return undefined;
    const exact = values[socialIdentityAccountKey(address, network)];
    const legacy = values[`${network}:${address.trim().toLowerCase()}`];
    return verifiedSocialIdentityIntent(exact, address, network) ?? verifiedSocialIdentityIntent(legacy, address, network);
  } catch {
    return undefined;
  }
}

export function storeSocialIdentityIntent(storage, intent) {
  const verified = verifiedSocialIdentityIntent(intent);
  if (!verified) return false;
  try {
    const parsed = JSON.parse(storage.getItem(SOCIAL_IDENTITY_STORAGE_KEY) ?? "{}");
    const map = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const key = socialIdentityAccountKey(verified.address, verified.network);
    if (JSON.stringify(map[key]) === JSON.stringify(verified)) return true;
    storage.setItem(SOCIAL_IDENTITY_STORAGE_KEY, JSON.stringify({ ...map, [key]: verified }));
    return true;
  } catch {
    return false;
  }
}

export function trustedSocialIdentityOrigin(origin, ownOrigin) {
  if (SOCIAL_IDENTITY_ORIGINS.includes(origin)) return true;
  // Local previews share the exact origin, never arbitrary localhost ports.
  if (origin !== ownOrigin) return false;
  try {
    const url = new URL(ownOrigin);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function validSocialIdentityRequest(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    value.type === SOCIAL_IDENTITY_REQUEST &&
    /^[a-f0-9]{32}$/u.test(value.nonce) &&
    ["sync", "subscribe", "unsubscribe"].includes(value.operation) &&
    validSocialIdentityAccount(value.address, value.network)
  );
}
