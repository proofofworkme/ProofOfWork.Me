import { Buffer } from "buffer";
import {
  normalizePublishArticleMetadata, publishArticleBodyBytes,
  publishArticleBodyFromRecords, publishArticleDataCarrierBytes,
  publishArticleMetadataFromPayload, PUBLISH_ARTICLE_VERIFICATION,
  PUBLISH_DATA_CARRIER_LIMIT, type PublishArticleMetadata,
} from "../../shared/protocol/publishArticle.mjs";
import { sha256Hex } from "../../shared/utils/encoding";

export type MailArticleEvidence = {
  article?: PublishArticleMetadata;
  articleVerification?: typeof PUBLISH_ARTICLE_VERIFICATION;
};

export function verifiedMailArticle(message: {
  article?: unknown; articleVerification?: unknown; memo: string;
  confirmed?: boolean; status?: string; attachment?: unknown;
}) {
  const article = normalizePublishArticleMetadata(message.article);
  const bytes = publishArticleBodyBytes(message.memo);
  return article && !message.attachment &&
    (message.confirmed === true || message.status === "confirmed") &&
    message.articleVerification === PUBLISH_ARTICLE_VERIFICATION && bytes &&
    bytes.length === article.size && sha256Hex(bytes) === article.sha256
    ? article : null;
}

// The raw-history fallback verifies physical scripts, never display ASM or
// replacement UTF-8. Keep the same envelope/commitment verifier as Publish.
export function mailArticleFromTransaction(transaction: {
  status?: { confirmed?: unknown }; vout?: Array<Record<string, unknown>>;
}): MailArticleEvidence {
  if (transaction.status?.confirmed !== true || !transaction.vout) return {};
  if (transaction.vout.some(output => {
    const scripts = [output.scriptpubkey, (output.scriptPubKey as { hex?: unknown })?.hex, output.scriptPubKeyHex]
      .filter(value => value !== undefined).map(value => String(value).trim().toLowerCase());
    return new Set(scripts).size > 1;
  })) return {};
  const carrierBytes = publishArticleDataCarrierBytes(transaction);
  if (carrierBytes === null || carrierBytes > PUBLISH_DATA_CARRIER_LIMIT) return {};
  const records = transaction.vout.flatMap((output, voutIndex) => {
    const scriptHex = String(output.scriptpubkey ??
      (output.scriptPubKey as { hex?: string })?.hex ?? output.scriptPubKeyHex ?? "").trim();
    if (!/^(?:[0-9a-f]{2})+$/iu.test(scriptHex)) return [];
    const script = Buffer.from(scriptHex, "hex");
    if (script[0] !== 0x6a) return [];
    const chunks: Uint8Array[] = [];
    let offset = 1, decodeValid = true;
    while (offset < script.length) {
      const opcode = script[offset++];
      let length = 0;
      if (opcode <= 0x4b) length = opcode;
      else if (opcode >= 0x4c && opcode <= 0x4e) {
        const width = opcode === 0x4c ? 1 : opcode === 0x4d ? 2 : 4;
        if (offset + width > script.length) { decodeValid = false; break; }
        length = script.readUIntLE(offset, width);
        offset += width;
      } else { decodeValid = false; break; }
      if (offset + length > script.length) {
        chunks.push(script.subarray(offset)); decodeValid = false; break;
      }
      chunks.push(script.subarray(offset, offset + length));
      offset += length;
    }
    const bytes = Buffer.concat(chunks);
    const prefix = ["pwm1:", "pwa1:", "pwid1:", "pwdns1:", "pwb1:", "pwt1:"]
      .find(value => Buffer.from(bytes.subarray(0, value.length)).equals(Buffer.from(value, "ascii")));
    if (!prefix) return [];
    let text = prefix;
    if (decodeValid) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        decodeValid = !text.includes("\u0000") && Buffer.from(text, "utf8").equals(bytes);
      } catch { decodeValid = false; }
    }
    return [{ text, prefix, voutIndex, decodeValid }];
  });
  const originals = records.filter(record => record.text.startsWith("pwb1:post:"));
  const article = originals.length === 1 ? publishArticleMetadataFromPayload(originals[0].text) : null;
  if (!article || publishArticleBodyFromRecords(records, article, sha256Hex) === null) return {};
  return { article, articleVerification: PUBLISH_ARTICLE_VERIFICATION };
}
