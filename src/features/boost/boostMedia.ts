import {
  base64FromBase64Url,
  base64UrlDecodeBytes,
  sha256Hex,
} from "../../shared/utils/encoding";

type BoostMediaPointer = {
  mime?: string;
  name?: string;
  sha256?: string;
  size?: number;
  source?: string;
};

type ProofAttachment = {
  data?: string;
  mime?: string;
  name?: string;
  sha256?: string;
  size?: number;
};

export function boostMediaUrl(
  media: BoostMediaPointer | undefined,
  attachment: ProofAttachment | undefined,
) {
  if (!attachment?.data || !attachment.mime) return "";
  if (media?.source === "same-tx-pwm1-attachment") {
    if (!/^[0-9a-f]{64}$/u.test(media.sha256 ?? "") ||
        !Number.isSafeInteger(media.size) || (media.size ?? 0) < 1 ||
        !media.mime || !media.name ||
        attachment.sha256 !== media.sha256 ||
        attachment.size !== media.size ||
        attachment.mime !== media.mime ||
        attachment.name !== media.name) {
      return "";
    }
    try {
      const bytes = base64UrlDecodeBytes(attachment.data);
      if (bytes.byteLength !== media.size || sha256Hex(bytes) !== media.sha256) {
        return "";
      }
    } catch {
      return "";
    }
  }
  return `data:${attachment.mime};base64,${base64FromBase64Url(attachment.data)}`;
}
