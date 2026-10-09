export const JOBS_BODY_PREFIX = 'pwj1:';
export const JOBS_VERSION = 2;
export const JOBS_SUPPORTED_VERSIONS = Object.freeze([1, 2]);
export const JOBS_ACTIVATION_HEIGHT = 970404;
export const JOBS_ACTIVATION_PREVIOUS_BLOCK_HASH = '00000000000000000000cf98017be585521a2a84e4030e20021565479c6218fe';
export const JOBS_V2_ACTIVATION_HEIGHT = 970577;
export const JOBS_V2_ACTIVATION_PREVIOUS_BLOCK_HASH = '00000000000000000001bc401b09150a6f092579644cc5616a828949f48bbd1d';
export const JOBS_WORK_TOKEN_ID = 'd4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8';
export const JOBS_WORK_REGISTRY_ADDRESS = '1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV';
export const JOBS_WORK_SUBATOMS_PER_WORK = '10000000000000000';
export const JOBS_WORK_MAX_SUBATOMS = '210000000000000000000000';
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
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function workSubatoms(value) {
  return typeof value === 'string' && /^[1-9]\d{0,23}$/u.test(value) && BigInt(value) <= BigInt(JOBS_WORK_MAX_SUBATOMS);
}
/** Rewards are exact asset amounts, never a WORK-floor conversion or escrow. */
export function normalizeJobReward(value) {
  if (exactKeys(value, ['asset', 'amountSats']) && value.asset === 'proofs' && proofs(value.amountSats)) {
    return { asset: 'proofs', amountSats: value.amountSats };
  }
  if (exactKeys(value, ['asset', 'token', 'amountSubatoms']) && value.asset === 'WORK' &&
      value.token === JOBS_WORK_TOKEN_ID && workSubatoms(value.amountSubatoms)) {
    return { asset: 'WORK', token: JOBS_WORK_TOKEN_ID, amountSubatoms: value.amountSubatoms };
  }
  return null;
}
export const parseJobReward = normalizeJobReward;
export function jobRewardFromMetadata(metadata) {
  if (!object(metadata)) return null;
  return metadata.v === 1 && proofs(metadata.rewardSats)
    ? { asset: 'proofs', amountSats: metadata.rewardSats }
    : metadata.v === 2 ? normalizeJobReward(metadata.reward) : null;
}
export function parseJobWorkDecimal(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,16})?$/u.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const subatoms = (BigInt(whole) * BigInt(JOBS_WORK_SUBATOMS_PER_WORK) + BigInt(fraction.padEnd(16, '0'))).toString();
  return workSubatoms(subatoms) ? subatoms : null;
}
export function formatJobWorkSubatoms(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) throw new Error('Invalid exact WORK amount.');
  const padded = value.padStart(17, '0'), whole = padded.slice(0, -16), fraction = padded.slice(-16).replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
export function formatJobReward(value) {
  const reward = normalizeJobReward(value);
  if (!reward) throw new Error('Invalid Jobs reward.');
  return reward.asset === 'proofs' ? `${reward.amountSats} proofs` : `${formatJobWorkSubatoms(reward.amountSubatoms)} WORK`;
}
function normalize(action, value) {
  if (!object(value) || !JOBS_SUPPORTED_VERSIONS.includes(value.v)) return null;
  const version = value.v, reward = jobRewardFromMetadata(value);
  let normalized;
  const rewardFields = version === 1 ? { rewardSats: value.rewardSats } : { reward };
  if (action === 'brief' && text(value.title, 200, true, true) && text(value.scope, 10000, true) && reward) {
    normalized = { v: version, title: value.title, scope: value.scope, ...rewardFields };
  } else if (action === 'propose' && txid(value.job) && text(value.scope, 10000, true) && reward) {
    normalized = { v: version, job: value.job, scope: value.scope, ...rewardFields };
  } else if (action === 'assign' && txid(value.job) && txid(value.proposal)) {
    normalized = { v: version, job: value.job, proposal: value.proposal };
  } else if (action === 'deliver' && txid(value.job) && txid(value.assignment) && text(value.text, 10000, true) &&
      Array.isArray(value.artifacts) && value.artifacts.length <= 16 && value.artifacts.every(txid) && new Set(value.artifacts).size === value.artifacts.length) {
    normalized = { v: version, job: value.job, assignment: value.assignment, text: value.text, artifacts: value.artifacts };
  } else if (action === 'accept' && txid(value.job) && txid(value.delivery)) {
    normalized = { v: version, job: value.job, delivery: value.delivery };
  } else if (action === 'cancel' && txid(value.job) && text(value.reason, 1000, true)) {
    normalized = { v: version, job: value.job, reason: value.reason };
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
