export type PowcatStage = number | "manifest";
export type PowcatFileIdentity = { fileHash: string; size: number; partSize: number; name: string; mime: string };
export type PowcatReceipt = { txid: string; fee: number; outpoints: string[]; witnessHash: string };
export type PowcatSigned = Omit<PowcatReceipt, "witnessHash"> & { hex: string };
export type PowcatDraft = PowcatFileIdentity & { receipts: Record<string, PowcatReceipt>; supersededLinkers: PowcatReceipt[] };
export interface PowcatJournal {
  read(): Promise<PowcatDraft | null>;
  lastPublished(): Promise<PowcatDraft | null>;
  reservedInputs(): Promise<string[]>;
  begin(identity: PowcatFileIdentity): Promise<PowcatDraft>;
  saveSigned(fileHash: string, stage: PowcatStage, signed: PowcatSigned): Promise<PowcatDraft>;
  raw(fileHash: string, stage: PowcatStage): Promise<string | null>;
  supersedeLinker(fileHash: string, txid: string): Promise<PowcatDraft>;
  finish(fileHash: string): Promise<void>;
}
export function openPowcatJournal(network: string, address: string): Promise<PowcatJournal>;
export function readPowcatReservedInputs(network: string, address: string): Promise<string[]>;
export function withPowcatPublisherLock<T>(network: string, address: string, operation: () => Promise<T>): Promise<T>;
