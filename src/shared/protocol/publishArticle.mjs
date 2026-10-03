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
      value.v !== 1 || value.source !== PUBLISH_ARTICLE_SOURCE ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 140 ||
      !publishArticleBodyBytes(value.title) ||
      !Number.isSafeInteger(value.size) || value.size < 1 || value.size > PUBLISH_DATA_CARRIER_LIMIT ||
      typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256) ||
      Object.keys(value).some(key => !["v", "title", "source", "size", "sha256"].includes(key))) return null;
  return { v: 1, title: value.title, source: PUBLISH_ARTICLE_SOURCE, size: value.size, sha256: value.sha256 };
}

export function publishArticleMetadataFromPayload(payload) {
  if (typeof payload !== "string" || !payload.startsWith("pwb1:post:")) return null;
  const encoded = payload.slice("pwb1:post:".length);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  try {
    const binary = atob(encoded.replace(/-/gu, "+").replace(/_/gu, "/"));
    if (btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "") !== encoded) return null;
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    const post = JSON.parse(json);
    if (!post || post.v !== 1 || typeof post.text !== "string" || !post.text.trim() || post.text.trim().length > 140 ||
        !publishArticleBodyBytes(post.text) || post.media || post.attachment) return null;
    const article = normalizePublishArticleMetadata(post.article);
    return article && post.text === article.title ? article : null;
  } catch { return null; }
}

// Canonical decoders supply exact, fatal-UTF-8 records in physical output order.
// One original and one contiguous text-only PWM envelope remove txid/body
// ambiguity. A hash callback keeps this verifier usable in Node and the browser.
export function publishArticleBodyFromRecords(records, metadata, sha256) {
  const article = normalizePublishArticleMetadata(metadata);
  if (!article || !Array.isArray(records) || typeof sha256 !== "function") return null;
  const position = record => record?.voutIndex ?? record?.protocolVout;
  const ordered = [...records].sort((a, b) => position(a) - position(b));
  if (ordered.some((record, index) => !Number.isSafeInteger(position(record)) || position(record) < 0 ||
      (index > 0 && position(ordered[index - 1]) === position(record)))) return null;
  const originals = ordered.filter(record => record?.prefix === "pwb1:" && String(record.text).startsWith("pwb1:post:"));
  if (originals.length !== 1 || originals[0].decodeValid !== true) return null;
  if (JSON.stringify(publishArticleMetadataFromPayload(originals[0].text)) !== JSON.stringify(article)) return null;
  const pwm = ordered.filter(record => record?.prefix === "pwm1:");
  if (!pwm.length || pwm.some(record => record.decodeValid !== true ||
      typeof record.text !== "string" || !/^pwm1:(?:m|s):/u.test(record.text))) return null;
  const first = position(pwm[0]), last = position(pwm.at(-1));
  if (ordered.some(record => record.prefix !== "pwm1:" && position(record) > first && position(record) < last)) return null;
  const chunks = pwm.filter(record => record.text.startsWith("pwm1:m:"));
  if (!chunks.length || pwm.filter(record => record.text.startsWith("pwm1:s:")).length > 1) return null;
  const body = chunks.map(record => record.text.slice("pwm1:m:".length)).join("");
  const bytes = publishArticleBodyBytes(body);
  return bytes && bytes.length === article.size && sha256(bytes) === article.sha256 ? body : null;
}

export function publishArticleDataCarrierBytes(transaction) {
  if (!Array.isArray(transaction?.vout)) return null;
  let size = 0;
  for (const output of transaction.vout) {
    const script = output?.scriptpubkey ?? output?.scriptPubKey?.hex ?? output?.scriptPubKeyHex;
    if (typeof script !== "string" || !/^(?:[0-9a-fA-F]{2})+$/u.test(script)) return null;
    if (script.slice(0, 2).toLowerCase() === "6a") size += script.length / 2;
  }
  return size;
}
