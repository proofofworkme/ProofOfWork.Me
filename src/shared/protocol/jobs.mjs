export const JOBS_BODY_PREFIX = 'pwj1:';
export const JOBS_VERSION = 1;
export const JOBS_ACTIVATION_HEIGHT = 970404;
export const JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH = '00000000000000000000cf98017be585521a2a84e4030e20021565479c6218fe';
export const JOBS_MAX_METADATA_BYTES = 16000;
export const JOBS_ACTIONS = Object.freeze(['brief', 'propose', 'assign', 'deliver', 'accept', 'cancel']);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const TXID = /^[0-9a-f]{64}$/u;
const txid = value => typeof value === 'string' && TXID.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, max, nonempty = false, clean = false) {
  if (typeof value !== 'string' || value.includes('\0') || (nonempty && !value.trim()) ||
      (clean && (value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)))) return false;
  const bytes = encoder.encode(value);
  try { return bytes.length <= max && decoder.decode(bytes) === value; } catch { return false; }
}
function proofs(value) {
  return typeof value === 'string' && /^[1-9]\d{0,15}$/u.test(value) && BigInt(value) >= 546n && BigInt(value) <= 2100000000000000n;
}
function normalize(action, value) {
  if (!object(value) || value.v !== JOBS_VERSION) return null;
  let normalized;
  if (action === 'brief' && text(value.title, 200, true, true) && text(value.scope, 10000, true) && proofs(value.rewardSats)) {
    normalized = { v: 1, title: value.title, scope: value.scope, rewardSats: value.rewardSats };
  } else if (action === 'propose' && txid(value.job) && text(value.scope, 10000, true) && proofs(value.rewardSats)) {
    normalized = { v: 1, job: value.job, scope: value.scope, rewardSats: value.rewardSats };
  } else if (action === 'assign' && txid(value.job) && txid(value.proposal)) {
    normalized = { v: 1, job: value.job, proposal: value.proposal };
  } else if (action === 'deliver' && txid(value.job) && txid(value.assignment) && text(value.text, 10000, true) &&
      Array.isArray(value.artifacts) && value.artifacts.length <= 16 && value.artifacts.every(txid) && new Set(value.artifacts).size === value.artifacts.length) {
    normalized = { v: 1, job: value.job, assignment: value.assignment, text: value.text, artifacts: value.artifacts };
  } else if (action === 'accept' && txid(value.job) && txid(value.delivery)) {
    normalized = { v: 1, job: value.job, delivery: value.delivery };
  } else if (action === 'cancel' && txid(value.job) && text(value.reason, 1000, true)) {
    normalized = { v: 1, job: value.job, reason: value.reason };
  }
  return normalized && Object.keys(value).length === Object.keys(normalized).length &&
    Object.keys(normalized).every(key => Object.hasOwn(value, key)) ? normalized : null;
}
function base64(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
export function encodeJobRecord(action, value) {
  const metadata = normalize(action, value);
  if (!metadata) throw new Error('Invalid Jobs metadata.');
  const bytes = encoder.encode(JSON.stringify(metadata));
  if (bytes.length > JOBS_MAX_METADATA_BYTES) throw new Error('Jobs metadata exceeds its byte budget.');
  return `${JOBS_BODY_PREFIX}${action}:${base64(bytes)}`;
}
export function parseJobBody(body) {
  const match = typeof body === 'string' && /^pwj1:(brief|propose|assign|deliver|accept|cancel):([A-Za-z0-9_-]+)$/u.exec(body);
  if (!match || match[2].length > Math.ceil(JOBS_MAX_METADATA_BYTES * 4 / 3)) return null;
  try {
    const binary = atob(match[2].replace(/-/gu, '+').replace(/_/gu, '/'));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (bytes.length > JOBS_MAX_METADATA_BYTES || base64(bytes) !== match[2]) return null;
    const json = decoder.decode(bytes), metadata = normalize(match[1], JSON.parse(json));
    return metadata && JSON.stringify(metadata) === json ? { action: match[1], metadata } : null;
  } catch { return null; }
}
