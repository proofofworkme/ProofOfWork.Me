import { useEffect } from "react";
import { confirmSocialIdentityOwner } from "./socialIdentity";
import {
  SOCIAL_IDENTITY_CHANGED,
  SOCIAL_IDENTITY_RESPONSE,
  SOCIAL_IDENTITY_STORAGE_KEY,
  newestSocialIdentityIntent,
  readSocialIdentityIntent,
  storeSocialIdentityIntent,
  trustedSocialIdentityOrigin,
  validSocialIdentityRequest,
  verifiedSocialIdentityIntent,
} from "./socialIdentityCore.mjs";

export default function SocialIdentityBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const pending = new Set<string>();
    const subscriptions = new Map<string, { origin: string; address: string; network: "livenet" | "testnet" | "testnet4" }>();
    let active = true;
    const notify = () => {
      for (const [nonce, subscription] of subscriptions) {
        window.parent.postMessage({ type: SOCIAL_IDENTITY_CHANGED, nonce, address: subscription.address, network: subscription.network }, subscription.origin);
      }
    };
    const receive = async (event: MessageEvent) => {
      if (event.source !== window.parent || !trustedSocialIdentityOrigin(event.origin, window.location.origin)) return;
      if (!validSocialIdentityRequest(event.data)) return;
      const request = event.data;
      if (request.operation === "unsubscribe") { subscriptions.delete(request.nonce); return; }
      if (pending.has(request.nonce) || pending.size >= 32) return;
      pending.add(request.nonce);
      try {
        if (request.operation === "subscribe") {
          if (subscriptions.size < 32) subscriptions.set(request.nonce, { origin: event.origin, address: request.address, network: request.network });
          window.parent.postMessage({ type: SOCIAL_IDENTITY_RESPONSE, nonce: request.nonce, address: request.address, network: request.network }, event.origin);
          return;
        }
        const current = readSocialIdentityIntent(window.localStorage, request.address, request.network);
        const incoming = verifiedSocialIdentityIntent(request.intent, request.address, request.network);
        const check = async (intent: typeof current) => intent && await confirmSocialIdentityOwner(intent).catch(() => false) ? intent : undefined;
        const [acceptedCurrent, acceptedIncoming] = await Promise.all([check(current), check(incoming)]);
        let selected = newestSocialIdentityIntent(acceptedCurrent, acceptedIncoming);
        // Another hub iframe can save a selection during the fresh registry read.
        // Verify that later signed preference before considering a replacement.
        const later = readSocialIdentityIntent(window.localStorage, request.address, request.network);
        if (later && later.createdAt !== current?.createdAt) selected = newestSocialIdentityIntent(selected, await check(later));
        if (!active) return;
        if (selected && storeSocialIdentityIntent(window.localStorage, selected)) {
          if (JSON.stringify(selected) !== JSON.stringify(current)) notify();
        }
        window.parent.postMessage({ type: SOCIAL_IDENTITY_RESPONSE, nonce: request.nonce, address: request.address, network: request.network, intent: selected }, event.origin);
      } finally {
        pending.delete(request.nonce);
      }
    };
    const changed = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && event.key === SOCIAL_IDENTITY_STORAGE_KEY) notify();
    };
    window.addEventListener("message", receive);
    window.addEventListener("storage", changed);
    return () => {
      active = false;
      window.removeEventListener("message", receive);
      window.removeEventListener("storage", changed);
    };
  }, []);
  return <span hidden>Shared ProofOfWork social identity</span>;
}
