import { normalizeJobReward, parseJobWorkDecimal, formatJobWorkSubatoms,
  JOBS_WORK_TOKEN_ID, JOBS_WORK_REGISTRY_ADDRESS, JOBS_WORK_SUBATOMS_PER_WORK, JOBS_WORK_MAX_SUBATOMS } from './jobs.mjs';

/** Pay describes existing direct payments. An invoice is neither escrow nor a debit authority. */
export const PAY_BODY_PREFIX = 'pwpay1:';
export const PAY_VERSION = 1;
export const PAY_ACTIONS = Object.freeze(['invoice', 'pay', 'cancel']);
// A separately verified canonical parent is required before either reads or writes open.
export const PAY_ACTIVATION_HEIGHT = 975856;
export const PAY_ACTIVATION_PREVIOUS_BLOCK_HASH = '00000000000000000002104a6f2c1984df28fd344cc34453d91da639f03cbd13';
export const PAY_MAX_METADATA_BYTES = 16000;
export const PAY_WORK_TOKEN_ID = JOBS_WORK_TOKEN_ID;
export const PAY_WORK_REGISTRY_ADDRESS = JOBS_WORK_REGISTRY_ADDRESS;
export const PAY_WORK_SUBATOMS_PER_WORK = JOBS_WORK_SUBATOMS_PER_WORK;
export const PAY_WORK_MAX_SUBATOMS = JOBS_WORK_MAX_SUBATOMS;
export const normalizePayAmount = normalizeJobReward;
export const parsePayWorkDecimal = parseJobWorkDecimal;
export const formatPayWorkSubatoms = formatJobWorkSubatoms;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const TXID = /^[0-9a-f]{64}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, max, nonempty = false, clean = false) {
  if (typeof value !== 'string' || value.includes('\0') || (nonempty && !value.trim()) ||
      (clean && (value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)))) return false;
  const bytes = encoder.encode(value);
  try { return bytes.length <= max && decoder.decode(bytes) === value; } catch { return false; }
}
export function formatPayAmount(value) {
  const amount = normalizePayAmount(value);
  if (!amount) throw new Error('Invalid Pay amount.');
  return amount.asset === 'proofs' ? `${amount.amountSats} proofs` : `${formatPayWorkSubatoms(amount.amountSubatoms)} WORK`;
}
function normalize(action, value) {
  if (!object(value) || value.v !== PAY_VERSION) return null;
  let normalized;
  if (action === 'invoice' && text(value.title, 200, true, true) && text(value.description, 10000) &&
      typeof value.recipient === 'string' && /^(?:[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[a-z0-9]{11,87})$/u.test(value.recipient) &&
      normalizePayAmount(value.amount) && (value.reference === null || (typeof value.reference === 'string' && TXID.test(value.reference)))) {
    normalized = { v: PAY_VERSION, title: value.title, description: value.description, recipient: value.recipient,
      amount: normalizePayAmount(value.amount), reference: value.reference };
  } else if (action === 'pay' && typeof value.invoice === 'string' && TXID.test(value.invoice)) {
    normalized = { v: PAY_VERSION, invoice: value.invoice };
  } else if (action === 'cancel' && typeof value.invoice === 'string' && TXID.test(value.invoice) && text(value.reason, 1000, true)) {
    normalized = { v: PAY_VERSION, invoice: value.invoice, reason: value.reason };
  }
  return normalized && Object.keys(value).length === Object.keys(normalized).length &&
    Object.keys(normalized).every(key => Object.hasOwn(value, key)) ? normalized : null;
}
function base64(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
export function encodePayRecord(action, value) {
  const metadata = normalize(action, value);
  if (!metadata) throw new Error('Invalid Pay metadata.');
  const bytes = encoder.encode(JSON.stringify(metadata));
  if (bytes.length > PAY_MAX_METADATA_BYTES) throw new Error('Pay metadata exceeds its byte budget.');
  return `${PAY_BODY_PREFIX}${action}:${base64(bytes)}`;
}
export function parsePayBody(body) {
  const match = typeof body === 'string' && /^pwpay1:(invoice|pay|cancel):([A-Za-z0-9_-]+)$/u.exec(body);
  if (!match || match[2].length > Math.ceil(PAY_MAX_METADATA_BYTES * 4 / 3)) return null;
  try {
    const binary = atob(match[2].replace(/-/gu, '+').replace(/_/gu, '/'));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (bytes.length > PAY_MAX_METADATA_BYTES || base64(bytes) !== match[2]) return null;
    const json = decoder.decode(bytes), metadata = normalize(match[1], JSON.parse(json));
    return metadata && JSON.stringify(metadata) === json ? { action: match[1], metadata } : null;
  } catch { return null; }
}
