import { boostMediaUrl } from "./boostMedia";
import type { BoostProfileImage } from "./boostProtocol";

export type Attachment = { data?: string; mime?: string; name?: string; sha256?: string; size?: number };
export type FileChoice = { pointer: BoostProfileImage; url: string };
export const imageMime = /^image\/(?:png|jpeg|gif|webp|avif)$/u;

export function verifiedProfileImage(pointer: BoostProfileImage | null | undefined, attachment: Attachment | undefined) {
  if (!pointer || !/^[a-f0-9]{64}$/u.test(pointer.txid ?? "") || !imageMime.test(pointer.mime ?? "")) return "";
  return boostMediaUrl({ ...pointer, source: "confirmed-pwm1-attachment" }, attachment);
}

export function profileImageChoices(mail: { inboxMessages?: MailFile[]; sentMessages?: MailFile[] }) {
  const files = new Map<string, FileChoice>();
  for (const message of [...(mail.inboxMessages ?? []), ...(mail.sentMessages ?? [])]) {
    if (message.confirmed !== true && message.status !== "confirmed") continue;
    const attachment = message.attachment;
    if (!attachment) continue;
    const pointer: BoostProfileImage = { txid: message.txid, mime: attachment.mime, name: attachment.name,
      size: attachment.size, sha256: attachment.sha256, source: "confirmed-pwm1-attachment" };
    const url = verifiedProfileImage(pointer, attachment);
    if (url) files.set(`${pointer.txid}:${pointer.sha256}`, { pointer, url });
  }
  return [...files.values()];
}
export type MailFile = { txid: string; confirmed?: boolean; status?: string; attachment?: Attachment };
