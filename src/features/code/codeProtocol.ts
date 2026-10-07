import { encodeCodeRepository, encodeCodeCommit, validateCodePath, codeSourceBytes } from "../../shared/protocol/codeRepository.mjs";
import { base64UrlEncodeBytes, sha256Hex } from "../../shared/utils/encoding";
import { buildAttachmentPayloads } from "../../shared/protocol/mailAttachment";
import { dataCarrierBytesForPayload } from "../boost/boostWallet";

export type CodeDraft = {
  kind: "repo" | "put" | "delete";
  name: string; description: string; repo: string; parent: string;
  path: string; message: string; content: string; feeRate: number;
};
export const emptyCodeDraft: CodeDraft = {
  kind: "repo", name: "", description: "", repo: "", parent: "", path: "", message: "", content: "", feeRate: 1,
};
export type CodePlan = {
  draft: CodeDraft; payloads: string[]; carrierBytes: number; key: string;
  fields: [string, string][]; size?: number; sha256?: string;
};
export function exactSourceBytes(source: string) {
  const bytes = codeSourceBytes(source);
  if (!bytes) throw new Error("Source must be valid UTF-8 text without NUL or incomplete Unicode characters.");
  return bytes;
}

export function buildCodePlan(draft: CodeDraft): CodePlan {
  let payload: string;
  let size: number | undefined;
  let sha256: string | undefined;
  let attachments: string[] = [];
  const fields: [string, string][] = [];
  if (draft.kind === "repo") {
    const name = codeSourceBytes(draft.name);
    if (!draft.name.trim()) throw new Error("Enter a repository name.");
    if (!name || name.length > 200) throw new Error("Repository names may contain at most 200 UTF-8 bytes.");
    if (draft.name.trim() !== draft.name || /[\u0000-\u001f\u007f-\u009f]/u.test(draft.name)) throw new Error("Repository names cannot contain control characters or leading or trailing whitespace.");
    const description = codeSourceBytes(draft.description);
    if (!description || description.length > 1000) throw new Error("Descriptions may contain at most 1,000 UTF-8 bytes without NUL characters.");
    payload = encodeCodeRepository({ v: 1, name: draft.name, description: draft.description });
    fields.push(["Repository name", draft.name], ["Description", draft.description], ["Owner", "The connected wallet address; immutable"]);
  } else {
    if (!/^[a-f0-9]{64}$/u.test(draft.repo) || !/^[a-f0-9]{64}$/u.test(draft.parent)) throw new Error("Select a confirmed repository and main parent before preparing a commit.");
    const message = codeSourceBytes(draft.message);
    if (!message || message.length > 500) throw new Error("Commit messages may contain at most 500 UTF-8 bytes without NUL characters.");
    if (!validateCodePath(draft.path)) throw new Error("Enter a relative file path with no empty segments, traversal, backslashes, or control characters.");
    if (draft.kind === "put") {
      const bytes = exactSourceBytes(draft.content);
      if (bytes.length > 60_000) throw new Error("One source file may contain at most 60,000 UTF-8 bytes.");
      size = bytes.length;
      sha256 = sha256Hex(bytes);
      // Empty sources have the standard empty hash and deliberately no Files attachment.
      if (bytes.length) attachments = buildAttachmentPayloads({ name: "source.txt", mime: "text/plain", size, sha256, data: base64UrlEncodeBytes(bytes) });
    }
    payload = draft.kind === "put"
      ? encodeCodeCommit({ v: 1, repo: draft.repo, parent: draft.parent, op: "put", path: draft.path, message: draft.message, size: size!, sha256: sha256! })
      : encodeCodeCommit({ v: 1, repo: draft.repo, parent: draft.parent, op: "delete", path: draft.path, message: draft.message });
    fields.push(["Repository", draft.repo], ["Confirmed parent", draft.parent], ["Operation", draft.kind === "put" ? "Write one source file" : "Delete one source file"], ["Exact path", draft.path], ["Commit message", draft.message]);
    if (size !== undefined && sha256) fields.push(["Source size", `${size} UTF-8 bytes`], ["SHA-256", sha256]);
  }
  const memo = draft.kind === "repo" ? `Code repository: ${draft.name}` : `Code commit: ${draft.message}`;
  const payloads = [`pwm1:m:${memo}`, ...attachments, payload];
  const carrierBytes = payloads.reduce((total, record) => total + dataCarrierBytesForPayload(record), 0);
  if (carrierBytes > 100_000) throw new Error("The complete transaction exceeds 100,000 bytes of on-chain data. Shorten the source or metadata.");
  fields.push(["Aggregate record scripts", `${carrierBytes.toLocaleString()} / 100,000 bytes`]);
  return { draft: { ...draft }, payloads, carrierBytes, size, sha256, fields,
    key: draft.kind === "repo" ? `code:create:${sha256Hex(exactSourceBytes(draft.name))}` : `code:repo:${draft.repo}` };
}
export function persistCodeDraft(storage: Storage, key: string, draft: CodeDraft) {
  const encoded = JSON.stringify(draft);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new Error("Draft autosave could not be verified. Copy your source before leaving this editor.");
}
export function codeDraftFields(draft: CodeDraft): [string, string][] {
  return [["Kind", draft.kind], ["Name", draft.name], ["Description", draft.description], ["Repository", draft.repo], ["Parent", draft.parent], ["Path", draft.path], ["Message", draft.message], ["Source", draft.content], ["Fee rate", String(draft.feeRate)]];
}
export function restoredCodeDraft(fields: [string, string][]): CodeDraft | undefined {
  const values = Object.fromEntries(fields);
  if (!["repo", "put", "delete"].includes(values.Kind) || !Number.isFinite(Number(values["Fee rate"]))) return;
  return { kind: values.Kind as CodeDraft["kind"], name: values.Name ?? "", description: values.Description ?? "", repo: values.Repository ?? "", parent: values.Parent ?? "", path: values.Path ?? "", message: values.Message ?? "", content: values.Source ?? "", feeRate: Number(values["Fee rate"]) };
}
export function lineChange(before: string, after: string) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let tail = 0;
  while (tail < oldLines.length - start && tail < newLines.length - start && oldLines[oldLines.length - tail - 1] === newLines[newLines.length - tail - 1]) tail++;
  return { start: start + 1, removed: oldLines.slice(start, oldLines.length - tail), added: newLines.slice(start, newLines.length - tail), unchanged: before === after };
}
