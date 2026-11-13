import { powcatPointerFromAttachment } from "./powcatMail.mjs";
import { POWCAT_MAX_FILE_BYTES, powcatSha256 } from "./powcat1.mjs";
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
  if (!article || article.v !== 1 || !Array.isArray(records) || typeof sha256 !== "function") return null;
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

export function publishArticleVerification(metadata) {
  const article = normalizePublishArticleMetadata(metadata);
  return article ? article.v === 2 ? PUBLISH_LINKED_ARTICLE_VERIFICATION : PUBLISH_ARTICLE_VERIFICATION : null;
}

// This verifies only the small same-transaction pointer commitment. Canonical
// adapters must independently bind that attachment to the original raw post.
export function publishLinkedArticlePointerMatches(metadata, attachment) {
  const article = normalizePublishArticleMetadata(metadata);
  const pointer = powcatPointerFromAttachment(attachment);
  return !!article && article.v === 2 && !!pointer &&
    pointer.txid === article.linkerTxid && pointer.fileHash === article.sha256;
}

// The adapter supplies a completely resolved canonical powcat file, including
// earlier-block part/linker order and reorg fences. This pure step checks bytes,
// not chain authority; it never grants a verification marker on its own.
export function publishLinkedArticleBody(metadata, file) {
  const article = normalizePublishArticleMetadata(metadata);
  if (!article || article.v !== 2 || !file || file.txid !== article.linkerTxid ||
      file.mime !== "text/plain" || file.size !== article.size || file.fileHash !== article.sha256 ||
      !(file.bytes instanceof Uint8Array) || file.bytes.length !== article.size ||
      powcatSha256(file.bytes) !== article.sha256) return null;
  try {
    const body = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(file.bytes);
    const bytes = publishArticleBodyBytes(body);
    return body.trim() && bytes && bytes.length === file.bytes.length &&
      powcatSha256(bytes) === article.sha256 ? body : null;
  } catch { return null; }
}

// Linked articles use exactly one canonical 139-byte pointer attachment; no
// inline text, subject or second attachment can compete with the body source.
export function linkedArticlePointerFromRecords(records, metadata, carrierBytes) {
  const article = normalizePublishArticleMetadata(metadata);
  if (!article || article.v !== 2 || !Array.isArray(records) ||
      !Number.isSafeInteger(carrierBytes) || carrierBytes < 1 || carrierBytes > PUBLISH_DATA_CARRIER_LIMIT) return null;
  const position = record => record?.voutIndex ?? record?.protocolVout;
  const ordered = [...records].sort((a, b) => position(a) - position(b));
  if (ordered.some((record, index) => !Number.isSafeInteger(position(record)) || position(record) < 0 ||
      (index > 0 && position(ordered[index - 1]) === position(record)))) return null;
  const originals = ordered.filter(record => record?.prefix === "pwb1:" && String(record.text).startsWith("pwb1:post:"));
  if (originals.length !== 1 || originals[0].decodeValid !== true ||
      JSON.stringify(publishArticleMetadataFromPayload(originals[0].text)) !== JSON.stringify(article)) return null;
  const pwm = ordered.filter(record => record?.prefix === "pwm1:");
  if (pwm.length !== 1 || pwm[0].decodeValid !== true) return null;
  const match = /^pwm1:a:([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):139:([0-9a-f]{64}):0\/1:([A-Za-z0-9_-]{186})$/u.exec(pwm[0].text);
  if (!match) return null;
  try {
    const decode = encoded => {
      const raw = atob(encoded.replace(/-/gu, "+").replace(/_/gu, "/"));
      if (btoa(raw).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "") !== encoded) throw new Error("Noncanonical base64url");
      return new TextDecoder("utf-8", {fatal: true}).decode(Uint8Array.from(raw, c => c.charCodeAt(0)));
    };
    const attachment = {mime: decode(match[1]), name: decode(match[2]), size: 139, sha256: match[3], data: match[4]};
    if (!attachment.name || attachment.name.length > 120 || /[\u0000-\u001f]/u.test(attachment.name) ||
        !publishLinkedArticlePointerMatches(article, attachment)) return null;
    return {txid: article.linkerTxid, fileHash: article.sha256};
  } catch { return null; }
}
