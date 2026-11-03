export const POWCAT_MAX_FILE_BYTES: 4000000;
export const POWCAT_MAX_PART_BYTES: 96000;
export const POWCAT_MAX_PARTS: 67;

export type PowcatManifest = {
  fileHash: string;
  size: number;
  name: string;
  mime: string;
  partTxids: string[];
};
export type PowcatPart = { fileHash: string; index: number; count: number; bytes: Uint8Array };
export type PowcatRecord = ({ kind: "manifest" } & PowcatManifest) |
  ({ kind: "part"; partHash: string } & PowcatPart);
export type PowcatConfirmedTransaction = { hex: string; blockHeight: number; blockHash: string; confirmed?: boolean };
export type PowcatFile = PowcatManifest & { txid: string; bytes: Uint8Array };

export function powcatSha256(bytes: Uint8Array): string;
export function encodePowcatPart(value: PowcatPart): Uint8Array;
export function encodePowcatManifest(value: PowcatManifest): Uint8Array;
export function powcatScript(payload: Uint8Array): Uint8Array;
export function parsePowcatTransaction(rawHex: string, expectedTxid: string): PowcatRecord;
export function resolvePowcatFile(rootTxid: string, loadConfirmed: (txid: string) =>
  Promise<PowcatConfirmedTransaction>): Promise<PowcatFile>;
