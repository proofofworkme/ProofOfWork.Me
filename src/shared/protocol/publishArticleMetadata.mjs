import { POWCAT_MAX_FILE_BYTES } from "./powcatLimits.mjs";
export const PUBLISH_LINKED_ARTICLE_SOURCE = "linked-powcat1";
export const PUBLISH_LINKED_ARTICLE_VERIFICATION = "canonical-linked-powcat1-article-v2";
export const PUBLISH_ARTICLE_SOURCE = "same-tx-pwm1-message";
export const PUBLISH_ARTICLE_VERIFICATION = "canonical-same-tx-pwm1-message-v1";
export const PUBLISH_DATA_CARRIER_LIMIT = 100_000;

// Return exact UTF-8, never replacement bytes for unpaired UTF-16 surrogates.
// U+0000 cannot be retained in the proof index's PostgreSQL text fields.
export function publishArticleBodyBytes(body) {
  if (typeof body !== "string" || body.includes("\u0000")) return null;
  const bytes = new TextEncoder().encode(body);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes) === body ? bytes : null;
}

export function normalizePublishArticleMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !((value.v === 1 && value.source === PUBLISH_ARTICLE_SOURCE) ||
        (value.v === 2 && value.source === PUBLISH_LINKED_ARTICLE_SOURCE &&
         typeof value.linkerTxid === "string" && /^[0-9a-f]{64}$/u.test(value.linkerTxid))) ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 140 ||
      !publishArticleBodyBytes(value.title) ||
      !Number.isSafeInteger(value.size) || value.size < 1 || value.size > (value.v === 2 ? POWCAT_MAX_FILE_BYTES : PUBLISH_DATA_CARRIER_LIMIT) ||
      typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256) ||
      Object.keys(value).some(key => !["v", "title", "source", "size", "sha256", ...(value.v === 2 ? ["linkerTxid"] : [])].includes(key))) return null;
  return { v: value.v, title: value.title, source: value.source, size: value.size, sha256: value.sha256,
    ...(value.v === 2 ? {linkerTxid: value.linkerTxid} : {}) };
}

export function publishArticleVerification(metadata) {
  const article = normalizePublishArticleMetadata(metadata);
  return article ? article.v === 2 ? PUBLISH_LINKED_ARTICLE_VERIFICATION : PUBLISH_ARTICLE_VERIFICATION : null;
}
