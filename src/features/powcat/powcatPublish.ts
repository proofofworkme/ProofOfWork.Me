import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import { encodePowcatManifest, encodePowcatPart, parsePowcatTransaction, powcatSha256, POWCAT_MAX_FILE_BYTES, POWCAT_MAX_PART_BYTES } from "../../shared/protocol/powcat1.mjs";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import { estimateTxVbytes, feeForEstimatedVbytes, type WalletUtxo } from "../../walletUtxos";
import type { PowcatDraft, PowcatFileIdentity, PowcatSigned } from "./powcatJournal.mjs";
import { readLinkedFile } from "./PowcatLink";

export type Stage = number | "manifest";
export type Funding = { txid: string; vout: number; value: number };
export type Prepared = { psbtHex: string; funding: Funding[]; fee: number; extraFee: number; change: number; estimatedVbytes: number };
export type PublishWallet = {
  prepare(payload: Uint8Array, address: string, rate: number): Promise<Prepared>;
  validate(address: string, inputs: (Omit<Funding, "value"> & { value?: number })[], signedTxid?: string): Promise<void>;
  sign(address: string, prepared: Prepared): Promise<PowcatSigned>;
  broadcast(hex: string): Promise<string>;
};
export type Seen = { status: "pending" | "confirmed" | "dropped"; height?: number; hash?: string };
export type SelectedFile = { identity: PowcatFileIdentity; bytes: Uint8Array };

export function stageCount(file: PowcatFileIdentity) { return Math.ceil(file.size / file.partSize); }
export function partIds(file: PowcatDraft) { return Array.from({ length: stageCount(file) }, (_, i) => file.receipts[i]?.txid ?? ""); }
export function stageLabel(stage: Stage) { return stage === "manifest" ? "Linker" : `Part ${stage + 1}`; }
export function sameFile(a: PowcatFileIdentity, b: PowcatFileIdentity) {
  return a.fileHash === b.fileHash && a.size === b.size && a.name === b.name && a.mime === b.mime && a.partSize === b.partSize;
}
function sampleIds(file: PowcatFileIdentity) {
  return Array.from({ length: stageCount(file) }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
}
export async function readSelectedFile(file: File, partSize: number = POWCAT_MAX_PART_BYTES): Promise<SelectedFile> {
  if (file.size < 1 || file.size > POWCAT_MAX_FILE_BYTES) throw new Error("Choose a file from 1 to 4,000,000 bytes.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const identity = { fileHash: powcatSha256(bytes), size: bytes.length, partSize, name: file.name, mime: file.type || "application/octet-stream" };
  encodePowcatManifest({ ...identity, partTxids: sampleIds(identity) });
  return { identity, bytes };
}
export function stagePayload(file: PowcatFileIdentity, stage: Stage, selected: SelectedFile | null, ids: string[]) {
  if (stage === "manifest") return encodePowcatManifest({ ...file, partTxids: ids });
  if (!selected || !sameFile(selected.identity, file)) throw new Error("Select the original file to continue this upload.");
  const bytes = selected.bytes.subarray(stage * file.partSize, (stage + 1) * file.partSize);
  return encodePowcatPart({ fileHash: file.fileHash, index: stage, count: stageCount(file), bytes });
}
export function outputVbytes(length: number) { return 8 + (length < 253 ? 1 : length <= 65535 ? 3 : 5) + length; }

// Whole-publication estimate assumes one funding input and one change output per unsigned stage.
export function estimatePublication(file: PowcatFileIdentity, rate: number, changeLength: number, draft: PowcatDraft | null) {
  const count = stageCount(file);
  const emptyPartSize = encodePowcatPart({ fileHash: file.fileHash, index: 0, count, bytes: new Uint8Array(1) }).length - 1;
  let total = (draft?.supersededLinkers ?? []).reduce((sum, r) => sum + r.fee, 0);
  for (let i = 0; i <= count; i++) {
    const receipt = draft?.receipts[i === count ? "manifest" : i];
    if (receipt) { total += receipt.fee; continue; }
    const length = i === count ? encodePowcatManifest({ ...file, partTxids: sampleIds(file) }).length :
      emptyPartSize + Math.min(file.partSize, file.size - i * file.partSize);
    const scriptLength = length + 1 + (length <= 75 ? 1 : length <= 255 ? 2 : length <= 65535 ? 3 : 5);
    total += feeForEstimatedVbytes(estimateTxVbytes(1, outputVbytes(scriptLength) + outputVbytes(changeLength)), rate);
  }
  return total;
}

export async function observe(txid: string): Promise<Seen> {
  const read = () => fetchProofApiJson<{status: string; canonical?: boolean; absenceProven?: boolean; blockHeight?: number; blockHash?: string; txid: string; network: string; contract: string}>(
    `/api/v1/tx/${txid}/status?fresh=1&powcat=1`, "livenet");
  const proof = await read().catch(async error => {
    if (error?.status !== 429) throw error;
    await new Promise(resolve => setTimeout(resolve, 1250));
    return read();
  });
  if (proof.txid !== txid || proof.network !== "livenet" || proof.contract !== "proof-of-work-tx-status-v2") throw new Error("Transaction evidence does not match the upload.");
  if (proof.status === "confirmed" && proof.canonical === true && Number.isSafeInteger(proof.blockHeight) && Number(proof.blockHeight) > 0 && /^[a-f0-9]{64}$/u.test(proof.blockHash ?? "")) {
    return { status: "confirmed", height: proof.blockHeight, hash: proof.blockHash };
  }
  if (proof.status === "pending") return { status: "pending" };
  if (proof.status === "dropped" && proof.absenceProven === true) return { status: "dropped" };
  throw new Error("The node could not verify this transaction's current state. Refresh to retry.");
}

export async function observeDraft(draft: PowcatDraft) {
  const rows = Object.entries(draft.receipts), seen: Record<string, Seen> = {};
  for (const [key, receipt] of rows) seen[key] = await observe(receipt.txid);
  return seen;
}
export function allPartsConfirmed(draft: PowcatDraft, seen: Record<string, Seen>) {
  return partIds(draft).every((txid, i) => txid && seen[i]?.status === "confirmed");
}
export function linkerOrderInvalid(draft: PowcatDraft, seen: Record<string, Seen>) {
  const root = seen.manifest;
  return root?.status === "confirmed" && allPartsConfirmed(draft, seen) && partIds(draft).some((_, i) => seen[i].height! >= root.height!);
}
export async function verifyLinker(draft: PowcatDraft) {
  const txid = draft.receipts.manifest.txid;
  const result = await readLinkedFile(txid, "livenet", draft.fileHash);
  if (result.name !== draft.name || result.mime !== draft.mime ||
      result.size !== draft.size || JSON.stringify(result.partTxids) !== JSON.stringify(partIds(draft))) throw new Error("The confirmed linker differs from the upload.");
}
export async function signPowcatPayment(address: string, prepared: Prepared) {
  const provider = window.unisat;
  if (!provider?.signPsbt) throw new Error("Connect UniSat to sign this transaction.");
  const unsigned = bitcoin.Psbt.fromHex(prepared.psbtHex);
  const hex = await provider.signPsbt(prepared.psbtHex, { autoFinalized: true, toSignInputs: unsigned.txInputs.map((_, index) => ({ index, address, sighashTypes: [bitcoin.Transaction.SIGHASH_ALL] })) });
  const signed = bitcoin.Psbt.fromHex(hex);
  if (!Buffer.from(signed.data.globalMap.unsignedTx.toBuffer()).equals(Buffer.from(unsigned.data.globalMap.unsignedTx.toBuffer()))) throw new Error("The wallet changed the reviewed transaction.");
  const tx = signed.extractTransaction(), expected = unsigned.txOutputs, original = unsigned.txInputs;
  if (tx.version !== unsigned.version || tx.locktime !== unsigned.locktime || tx.ins.length !== original.length ||
    tx.ins.some((i, n) => !Buffer.from(i.hash).equals(Buffer.from(original[n].hash)) || i.index !== original[n].index || i.sequence !== original[n].sequence) ||
    tx.outs.length !== expected.length || tx.outs.some((o, n) => o.value !== expected[n].value || !Buffer.from(o.script).equals(Buffer.from(expected[n].script)))) throw new Error("Signed inputs or outputs differ from the review.");
  const txid = tx.getId(), raw = tx.toHex();
  parsePowcatTransaction(raw, txid);
  return { txid, hex: raw, fee: prepared.fee, outpoints: prepared.funding.map(outpoint) };
}
export function outpoint(input: Pick<WalletUtxo, "txid" | "vout">) { return `${input.txid}:${input.vout}`; }
