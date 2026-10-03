import type { BoostIdentityIntent } from "../boost/boostProtocol";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import {
  SOCIAL_IDENTITY_CHANGED,
  SOCIAL_IDENTITY_ORIGINS,
  SOCIAL_IDENTITY_REQUEST,
  SOCIAL_IDENTITY_RESPONSE,
  SOCIAL_IDENTITY_STORAGE_KEY,
  newestSocialIdentityIntent,
  normalizeSocialIdentityId,
  readSocialIdentityIntent,
  storeSocialIdentityIntent,
  validSocialIdentityAccount,
  verifiedSocialIdentityIntent,
} from "./socialIdentityCore.mjs";

export type SocialIdentityOwnerCheck = (intent: BoostIdentityIntent) => Promise<boolean>;

export async function confirmSocialIdentityOwner(intent: BoostIdentityIntent) {
  const payload = await fetchProofApiJson<{
    network?: BitcoinNetwork;
    record?: { id?: string; confirmed?: boolean; network?: BitcoinNetwork; ownerAddress?: string } | null;
  }>(`/api/v1/ids/${encodeURIComponent(intent.id)}?current=1&fresh=1`, intent.network, { timeoutMs: 15_000 });
  const record = payload.record;
  return Boolean(
    payload.network === intent.network && record?.confirmed === true &&
    (!record.network || record.network === intent.network) &&
    normalizeSocialIdentityId(record.id) === intent.id &&
    record.ownerAddress?.trim() === intent.address
  );
}

async function acceptedIntent(value: unknown, address: string, network: BitcoinNetwork, confirmOwner: SocialIdentityOwnerCheck) {
  const intent = verifiedSocialIdentityIntent(value, address, network);
  if (!intent) return undefined;
  try {
    return await confirmOwner(intent) ? intent : undefined;
  } catch {
    return undefined;
  }
}

let bridgeFrame: Promise<HTMLIFrameElement> | undefined;

function bridgeUrl() {
  const origin = SOCIAL_IDENTITY_ORIGINS.includes(window.location.origin)
    ? "https://computer.proofofwork.me"
    : window.location.origin;
  return new URL("/?social-identity-bridge=1", origin);
}

function ensureBridgeFrame() {
  if (bridgeFrame) return bridgeFrame;
  bridgeFrame = new Promise<HTMLIFrameElement>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "Shared ProofOfWork social identity";
    frame.referrerPolicy = "no-referrer";
    frame.src = bridgeUrl().href;
    const timeout = window.setTimeout(() => fail(), 15_000);
    const fail = () => {
      window.clearTimeout(timeout);
      frame.remove();
      bridgeFrame = undefined;
      reject(new Error("Shared social identity bridge is unavailable."));
    };
    frame.onerror = fail;
    frame.onload = () => {
      window.clearTimeout(timeout);
      resolve(frame);
    };
    document.body.append(frame);
  });
  return bridgeFrame;
}

function nonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("");
}

async function exchange(
  address: string,
  network: BitcoinNetwork,
  operation: "sync" | "subscribe",
  intent?: BoostIdentityIntent,
  subscriptionNonce?: string,
) {
  const frame = await ensureBridgeFrame();
  const origin = bridgeUrl().origin;
  const requestNonce = subscriptionNonce ?? nonce();
  const request = { type: SOCIAL_IDENTITY_REQUEST, nonce: requestNonce, operation, address, network, intent };
  return new Promise<unknown>((resolve, reject) => {
    const finish = () => {
      window.clearInterval(retry);
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const value = event.data;
      if (!value || value.type !== SOCIAL_IDENTITY_RESPONSE || value.nonce !== requestNonce || value.address !== address || value.network !== network) return;
      finish();
      resolve(value.intent);
    };
    const send = () => frame.contentWindow?.postMessage(request, origin);
    window.addEventListener("message", receive);
    // A lazy bridge component may mount after iframe load. Retry only the same
    // nonce; the bridge coalesces duplicate requests while verification runs.
    const retry = window.setInterval(send, 350);
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error("Shared social identity verification timed out."));
    }, 25_000);
    send();
  });
}

export async function syncSocialIdentityIntent(
  address: string,
  network: BitcoinNetwork,
  confirmOwner: SocialIdentityOwnerCheck = confirmSocialIdentityOwner,
): Promise<BoostIdentityIntent | undefined> {
  if (typeof window === "undefined" || !validSocialIdentityAccount(address, network)) return undefined;
  const local = readSocialIdentityIntent(window.localStorage, address, network);
  const [acceptedLocal, shared] = await Promise.all([
    acceptedIntent(local, address, network, confirmOwner),
    exchange(address, network, "sync", local).catch(() => undefined),
  ]);
  const acceptedShared = await acceptedIntent(shared, address, network, confirmOwner);
  const selected = newestSocialIdentityIntent(acceptedLocal, acceptedShared);
  if (selected) storeSocialIdentityIntent(window.localStorage, selected);
  return selected;
}

export async function publishSocialIdentityIntent(
  intent: BoostIdentityIntent,
  confirmOwner: SocialIdentityOwnerCheck = confirmSocialIdentityOwner,
): Promise<BoostIdentityIntent | undefined> {
  if (typeof window === "undefined") return undefined;
  const accepted = await acceptedIntent(intent, intent.address, intent.network, confirmOwner);
  if (!accepted) return undefined;
  storeSocialIdentityIntent(window.localStorage, accepted);
  const selected = await syncSocialIdentityIntent(intent.address, intent.network, confirmOwner);
  window.dispatchEvent(new Event("proofofwork-social-identity-change"));
  return selected;
}

export function subscribeSocialIdentityIntent(
  address: string,
  network: BitcoinNetwork,
  onIntent: (intent: BoostIdentityIntent | undefined) => void,
  confirmOwner: SocialIdentityOwnerCheck = confirmSocialIdentityOwner,
) {
  if (typeof window === "undefined" || !validSocialIdentityAccount(address, network)) return () => {};
  const subscriptionNonce = nonce();
  let active = true;
  let syncing = false;
  let rerun = false;
  const refresh = async () => {
    if (!active) return;
    if (syncing) { rerun = true; return; }
    syncing = true;
    const selected = await syncSocialIdentityIntent(address, network, confirmOwner);
    syncing = false;
    if (active) onIntent(selected);
    if (rerun) { rerun = false; void refresh(); }
  };
  const receive = async (event: MessageEvent) => {
    const frame = await bridgeFrame?.catch(() => undefined);
    if (!active || !frame || event.source !== frame.contentWindow || event.origin !== bridgeUrl().origin) return;
    const value = event.data;
    if (value?.type === SOCIAL_IDENTITY_CHANGED && value.nonce === subscriptionNonce && value.address === address && value.network === network) void refresh();
  };
  const storageChanged = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === SOCIAL_IDENTITY_STORAGE_KEY) void refresh();
  };
  const visible = () => { if (document.visibilityState === "visible") void refresh(); };
  window.addEventListener("message", receive);
  window.addEventListener("storage", storageChanged);
  window.addEventListener("focus", refresh);
  window.addEventListener("proofofwork-social-identity-change", refresh);
  document.addEventListener("visibilitychange", visible);
  void exchange(address, network, "subscribe", undefined, subscriptionNonce).catch(() => undefined);
  return () => {
    active = false;
    window.removeEventListener("message", receive);
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("proofofwork-social-identity-change", refresh);
    document.removeEventListener("visibilitychange", visible);
    void bridgeFrame?.then(frame => frame.contentWindow?.postMessage({
      type: SOCIAL_IDENTITY_REQUEST, nonce: subscriptionNonce, operation: "unsubscribe", address, network,
    }, bridgeUrl().origin)).catch(() => undefined);
  };
}
