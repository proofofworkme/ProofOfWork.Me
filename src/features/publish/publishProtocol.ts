import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";
import { appHref } from "../../app/routeRegistry";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { encodeTextBase64Url, sha256Hex } from "../../shared/utils/encoding";
import {
  PUBLISH_ARTICLE_SOURCE,
  PUBLISH_DATA_CARRIER_LIMIT,
  publishArticleBodyBytes,
  type PublishArticleMetadata,
} from "../../shared/protocol/publishArticle.mjs";
import type { ActionReview } from "../../shared/components/ActionTransactionReview";
import type { BoostPaymentPsbt } from "../boost/boostWallet";
import { buildBoostProfilePayload, type BoostIdentityIntent } from "../boost/boostProtocol";

export type PublishPlan = {
  article: PublishArticleMetadata;
  body: string;
  proofSignalSats: number;
  payloads: string[];
  carrierBytes: number;
  identity?: BoostIdentityIntent;
};

export type PreparedPublish = {
  plan: PublishPlan;
  address: string;
  network: BitcoinNetwork;
  identityId: string;
  feeRate: number;
  paymentPsbt: BoostPaymentPsbt;
  review: ActionReview;
};

// Chunk on code-point boundaries without changing any UTF-8 body bytes.
function bodyChunks(body: string) {
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of body) {
    const point = character.codePointAt(0)!;
    const length = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + length > 60_000) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += length;
  }
  chunks.push(current);
  return chunks;
}

export function buildPublishPlan(titleValue: string, body: string, proofSignalSats: number, identity?: BoostIdentityIntent): PublishPlan {
  const title = titleValue.trim();
  if (!title || title.length > 140 || !publishArticleBodyBytes(title)) {
    throw new Error("Enter an article title of up to 140 characters.");
  }
  const bytes = publishArticleBodyBytes(body);
  if (!bytes || !body.trim()) {
    throw new Error("Enter article text. Unsupported text characters cannot be published.");
  }
  if (!Number.isSafeInteger(proofSignalSats) || proofSignalSats < 546) {
    throw new Error("Add at least 546 whole proofs of signal to your article.");
  }
  const article: PublishArticleMetadata = {
    v: 1, title, source: PUBLISH_ARTICLE_SOURCE, size: bytes.length, sha256: sha256Hex(bytes),
  };
  const post = `pwb1:post:${encodeTextBase64Url(JSON.stringify({ v: 1, text: title, article, proofSignalSats }))}`;
  const payloads = [...(identity ? [buildBoostProfilePayload({ id: identity.id, intent: identity })] : []), post,
    ...bodyChunks(body).map(chunk => `pwm1:m:${chunk}`)];
  // Compile the same scripts as the wallet builder. Even an over-budget draft
  // gets an exact count; admission happens before transaction preparation.
  const carrierBytes = payloads.reduce((sum, payload) => sum + bitcoin.payments.embed({
    data: [Buffer.from(payload, "utf8")],
  }).output!.length, 0);
  return { article, body, proofSignalSats, payloads, carrierBytes, identity };
}

export function requirePublishBudget(plan: PublishPlan) {
  if (plan.carrierBytes > PUBLISH_DATA_CARRIER_LIMIT) {
    throw new Error(`Article uses ${plan.carrierBytes.toLocaleString()} of ${PUBLISH_DATA_CARRIER_LIMIT.toLocaleString()} available OP_RETURN bytes. Shorten the text before publishing.`);
  }
}

export function publishHref(params: { txid?: string; profile?: string; network?: BitcoinNetwork; embedded?: boolean } = {}) {
  const base = params.embedded ? "/?folder=publish" : appHref("https://publish.proofofwork.me/", "/?publish=1");
  const url = new URL(base, typeof window === "undefined" ? "https://publish.proofofwork.me" : window.location.origin);
  if (params.txid) url.searchParams.set("article", params.txid);
  if (params.profile) url.searchParams.set("profile", params.profile);
  if (params.network) url.searchParams.set("network", params.network);
  return url.toString();
}
