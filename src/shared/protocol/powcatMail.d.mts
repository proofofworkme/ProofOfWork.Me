import type { MailAttachment } from "./mailAttachment";
export const POWCAT_MAIL_MIME: string;
export type PowcatPointer = { txid: string; fileHash: string };
export function buildPowcatPointer(txid: string, fileHash: string): string;
export function parsePowcatPointer(text: string): PowcatPointer | null;
export function buildPowcatMailAttachment(file: PowcatPointer & { name: string }): MailAttachment;
export function powcatPointerFromAttachment(attachment?: MailAttachment): PowcatPointer | null;
