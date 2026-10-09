import { encodeJobRecord, formatJobReward, parseJobWorkDecimal, JOBS_WORK_TOKEN_ID, type JobReward } from "../../shared/protocol/jobs.mjs";
import { buildAttachmentPayloads, type MailAttachment } from "../../shared/protocol/mailAttachment";
import { base64UrlDecodeBytes, base64UrlEncodeBytes, encodeTextBase64Url, sha256Hex } from "../../shared/utils/encoding";
import { dataCarrierBytesForPayload } from "../boost/boostWallet";
import { exactProofs, JOB_TXID, type JobAction } from "./jobsApi";

export type JobsDraft = {
  action: JobAction; title: string; scope: string; rewardSats: string; job: string;
  proposal: string; assignment: string; delivery: string; text: string; artifacts: string;
  reason: string; expectedHead: string; feeRate: number; attachment?: MailAttachment;
  rewardAsset?: "proofs" | "WORK"; rewardWork?: string;
};
export const emptyJobsDraft: JobsDraft = { action: "brief", title: "", scope: "", rewardSats: "546", rewardAsset: "proofs", rewardWork: "1", job: "", proposal: "", assignment: "", delivery: "", text: "", artifacts: "", reason: "", expectedHead: "", feeRate: 1 };
export type JobsPlan = { draft: JobsDraft; memo: string; metadata: Record<string, unknown>; payloads: string[]; carrierBytes: number; fields: [string, string][]; key: string };
export const JOB_ACTION_LABELS: Record<JobAction, string> = { brief: "Publish job", propose: "Propose scope and reward", assign: "Assign proposal", deliver: "Deliver work", accept: "Accept delivery and pay", cancel: "Cancel job" };
export function draftJobReward(draft: JobsDraft): JobReward {
  if (draft.rewardAsset === "WORK") {
    const amountSubatoms = parseJobWorkDecimal(draft.rewardWork ?? "");
    if (!amountSubatoms) throw new Error("Enter an exact positive WORK reward with up to 16 decimal places and no more than 21,000,000 WORK.");
    return { asset: "WORK", token: JOBS_WORK_TOKEN_ID, amountSubatoms };
  }
  if (!exactProofs(draft.rewardSats, 546n)) throw new Error("Enter an exact whole-proof reward of at least 546 proofs.");
  return { asset: "proofs", amountSats: draft.rewardSats };
}
export function buildJobsPlan(draft: JobsDraft): JobsPlan {
  let metadata: Record<string, unknown>;
  const reward = ["brief", "propose"].includes(draft.action) ? draftJobReward(draft) : undefined;
  const version = draft.rewardAsset === "WORK" ? 2 : 1;
  const artifacts = draft.artifacts.trim() ? draft.artifacts.split(/[\s,;]+/u).filter(Boolean) : [];
  if (draft.action !== "brief" && (!JOB_TXID.test(draft.job) || !JOB_TXID.test(draft.expectedHead))) throw new Error("Select a verified confirmed job before preparing this action.");
  const validText = (value: string, maximum: number) => value.trim().length > 0 && !value.includes("\0") && new TextEncoder().encode(value).length <= maximum;
  if (draft.action === "brief" && (!validText(draft.title, 200) || draft.title.trim() !== draft.title || /[\u0000-\u001f\u007f-\u009f]/u.test(draft.title))) throw new Error("Enter a trimmed job title of up to 200 UTF-8 bytes without control characters.");
  if (["brief", "propose"].includes(draft.action) && !validText(draft.scope, 10000)) throw new Error("Enter exact scope and acceptance criteria of up to 10,000 UTF-8 bytes.");
  if (draft.action === "deliver" && (!validText(draft.text, 10000) || artifacts.length > 16 || artifacts.some(value => !JOB_TXID.test(value)) || new Set(artifacts).size !== artifacts.length)) throw new Error("Enter delivery text of up to 10,000 UTF-8 bytes and up to 16 unique lowercase transaction references.");
  if (draft.action === "cancel" && !validText(draft.reason, 1000)) throw new Error("Enter a cancellation reason of up to 1,000 UTF-8 bytes.");
  switch (draft.action) {
    case "brief": metadata = version === 2 ? { v: 2, title: draft.title, scope: draft.scope, reward } : { v: 1, title: draft.title, scope: draft.scope, rewardSats: draft.rewardSats }; break;
    case "propose": metadata = version === 2 ? { v: 2, job: draft.job, scope: draft.scope, reward } : { v: 1, job: draft.job, scope: draft.scope, rewardSats: draft.rewardSats }; break;
    case "assign": metadata = { v: version, job: draft.job, proposal: draft.proposal }; break;
    case "deliver": metadata = { v: version, job: draft.job, assignment: draft.assignment, text: draft.text, artifacts }; break;
    case "accept": metadata = { v: version, job: draft.job, delivery: draft.delivery }; break;
    case "cancel": metadata = { v: version, job: draft.job, reason: draft.reason }; break;
  }
  if (draft.attachment && draft.action !== "deliver") throw new Error("Files can be attached only to a delivery.");
  if (draft.attachment) {
    const bytes = base64UrlDecodeBytes(draft.attachment.data);
    if (bytes.length < 1 || bytes.length > 60000 || bytes.length !== draft.attachment.size ||
      base64UrlEncodeBytes(bytes) !== draft.attachment.data || sha256Hex(bytes) !== draft.attachment.sha256) throw new Error("Saved delivery file bytes do not match their exact size and SHA-256. Attach the original file again.");
  }
  const memo = encodeJobRecord(draft.action, metadata);
  const subject = `${JOB_ACTION_LABELS[draft.action]}${draft.title ? `: ${draft.title}` : ""}`;
  const payloads = [`pwm1:s:${encodeTextBase64Url(subject)}`, ...(draft.job ? [`pwm1:r:${draft.job}`] : []), `pwm1:m:${memo}`, ...(draft.attachment ? buildAttachmentPayloads(draft.attachment) : [])];
  const carrierBytes = payloads.reduce((sum, payload) => sum + dataCarrierBytesForPayload(payload), 0);
  if (carrierBytes > 100_000) throw new Error("The full Mail/Files transaction exceeds 100,000 on-chain script bytes. Shorten the delivery or use a smaller file.");
  const fields: [string, string][] = [["Action", JOB_ACTION_LABELS[draft.action]]];
  if (draft.job) fields.push(["Job transaction", draft.job], ["Reviewed confirmed head", draft.expectedHead]);
  if (draft.action === "brief") fields.push(["Title", draft.title]);
  if (reward) fields.push(["Exact scope", draft.scope], ["Proposed reward", `${formatJobReward(reward)} · promise, not escrow`]);
  if (draft.action === "assign") fields.push(["Proposal transaction", draft.proposal]);
  if (draft.action === "deliver") fields.push(["Assignment transaction", draft.assignment], ["Delivery text", draft.text], ["Referenced transactions", artifacts.join("\n") || "None"]);
  if (draft.action === "accept") fields.push(["Accepted delivery transaction", draft.delivery]);
  if (draft.action === "cancel") fields.push(["Cancellation reason", draft.reason]);
  if (draft.attachment) fields.push(["Attached file", draft.attachment.name], ["File size", `${draft.attachment.size} bytes`], ["File SHA-256", draft.attachment.sha256]);
  fields.push(["Public record scripts", `${carrierBytes} / 100000 bytes`]);
  const key = draft.action === "brief" ? `jobs:brief:${sha256Hex(new TextEncoder().encode(memo))}` : `jobs:job:${draft.job}:${draft.expectedHead}`;
  return { draft: { ...draft }, memo, metadata, payloads, carrierBytes, fields, key };
}
export function persistJobsDraft(storage: Storage, key: string, draft: JobsDraft) {
  const encoded = JSON.stringify(draft);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new Error("Job draft autosave could not be verified. Copy your fields before leaving.");
}
export function jobsDraftFields(draft: JobsDraft): [string, string][] { return [["Jobs draft", JSON.stringify(draft)]]; }
export function restoreJobsDraft(fields: [string, string][]): JobsDraft | undefined {
  try { const value = JSON.parse(Object.fromEntries(fields)["Jobs draft"] ?? "null"); return isJobsDraft(value) ? value : undefined; } catch { return; }
}
export function isJobsDraft(value: unknown): value is JobsDraft {
  if (!value || typeof value !== "object") return false;
  const item = value as JobsDraft;
  return Object.prototype.hasOwnProperty.call(JOB_ACTION_LABELS, item.action) && [item.title, item.scope, item.rewardSats, item.job, item.proposal, item.assignment, item.delivery, item.text, item.artifacts, item.reason, item.expectedHead].every(v => typeof v === "string") && (item.rewardAsset === undefined || item.rewardAsset === "proofs" || item.rewardAsset === "WORK") && (item.rewardWork === undefined || typeof item.rewardWork === "string") && (item.rewardAsset !== "WORK" || typeof item.rewardWork === "string") && Number.isFinite(item.feeRate) && (!item.attachment || (typeof item.attachment.name === "string" && typeof item.attachment.mime === "string" && typeof item.attachment.data === "string" && Number.isSafeInteger(item.attachment.size) && JOB_TXID.test(item.attachment.sha256)));
}
