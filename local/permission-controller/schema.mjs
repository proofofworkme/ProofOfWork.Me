import { createHash } from 'node:crypto'
import { permissionFeeRateProofsQ8 } from '../../src/shared/protocol/permissions.mjs'

export class PermissionError extends Error {
  constructor(code, message = code) { super(message); this.name = 'PermissionError'; this.code = code }
}
export const fail = (code, message) => { throw new PermissionError(code, message) }
export const ACTIONS = Object.freeze(['mail.send', 'boost.post', 'amo.listwork', 'amo.sealwork', 'amo.buywork', 'publish.article'])
export const TXID = /^[a-f0-9]{64}$/
export const HEX = /^(?:[a-f0-9]{2})+$/
export const object = (value, code = 'INVALID_OBJECT') => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail(code)
  return value
}
export function exactKeys(value, required, optional = []) {
  object(value)
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => ![...required, ...optional].includes(key))) fail('UNKNOWN_OR_MISSING_FIELD')
}
export function integer(value, { positive = false } = {}) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value) || (positive && value === '0')) fail('INVALID_INTEGER')
  return BigInt(value)
}
function text(value, maxBytes, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.length) || Buffer.byteLength(value) > maxBytes || value.includes('\0')) fail('INVALID_TEXT')
  return value
}
export function address(value) { return text(value, 100) }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) fail('INVALID_CANONICAL_VALUE')
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('INVALID_CANONICAL_NUMBER')
  return JSON.stringify(value)
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
export function immutable(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value) } return value }
export function normalizePolicy(policy) {
  object(policy)
  const ratePolicy = Object.hasOwn(policy, 'minerFeeRateProofsPerVbyte')
  exactKeys(policy, ['signingEnabled', 'allowedActions', 'maxTransactionProofs', 'dailyLimitProofs', ratePolicy ? 'minerFeeRateProofsPerVbyte' : 'maxMinerFeeProofs', 'allowedRecipients', 'workLimits'])
  if (typeof policy.signingEnabled !== 'boolean' || !Array.isArray(policy.allowedActions) || new Set(policy.allowedActions).size !== policy.allowedActions.length || policy.allowedActions.some(action => !ACTIONS.includes(action))) fail('INVALID_POLICY_ACTIONS')
  for (const key of ['maxTransactionProofs', 'dailyLimitProofs']) integer(policy[key])
  if (ratePolicy) { if (permissionFeeRateProofsQ8(policy.minerFeeRateProofsPerVbyte) === null) fail('INVALID_MINER_FEE_RATE') }
  else if (integer(policy.maxMinerFeeProofs) > integer(policy.maxTransactionProofs)) fail('INCONSISTENT_POLICY_LIMITS')
  if (integer(policy.maxTransactionProofs) > integer(policy.dailyLimitProofs)) fail('INCONSISTENT_POLICY_LIMITS')
  if (policy.allowedRecipients !== null) {
    if (!Array.isArray(policy.allowedRecipients) || new Set(policy.allowedRecipients).size !== policy.allowedRecipients.length) fail('INVALID_RECIPIENTS')
    policy.allowedRecipients.forEach(address)
  }
  if (policy.workLimits !== null) {
    exactKeys(policy.workLimits, ['maxAmountSubatoms', 'minSaleProofs', 'maxPurchaseProofs', 'maxOpenListings'])
    for (const key of ['maxAmountSubatoms', 'minSaleProofs', 'maxPurchaseProofs']) integer(policy.workLimits[key])
    if (!Number.isSafeInteger(policy.workLimits.maxOpenListings) || policy.workLimits.maxOpenListings < 0) fail('INVALID_OPEN_LISTINGS_LIMIT')
  }
  return JSON.parse(canonical(policy))
}
export function normalizeRequest(request) {
  exactKeys(request, ['operationId', 'action', 'payload'])
  if (typeof request.operationId !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(request.operationId) || !ACTIONS.includes(request.action)) fail('INVALID_REQUEST')
  const p = object(request.payload)
  switch (request.action) {
    case 'mail.send':
      exactKeys(p, ['recipients', 'body'], ['subject'])
      if (!Array.isArray(p.recipients) || !p.recipients.length || p.recipients.length > 32) fail('INVALID_RECIPIENTS')
      p.recipients.forEach(recipient => { exactKeys(recipient, ['address', 'proofs']); address(recipient.address); integer(recipient.proofs, { positive: true }) })
      if (new Set(p.recipients.map(recipient => recipient.address)).size !== p.recipients.length) fail('DUPLICATE_RECIPIENT')
      text(p.body, 90_000); if (p.subject !== undefined) text(p.subject, 512, { empty: true })
      break
    case 'boost.post': exactKeys(p, ['text', 'proofs']); text(p.text, 560); if ([...p.text].length > 140) fail('BOOST_TOO_LONG'); integer(p.proofs, { positive: true }); break
    case 'publish.article': exactKeys(p, ['title', 'body', 'proofs']); text(p.title, 512); text(p.body, 90_000); integer(p.proofs, { positive: true }); break
    case 'amo.listwork': exactKeys(p, ['faceProofs']); if (p.faceProofs !== '25000') fail('UNSUPPORTED_WORK_FACE'); break
    case 'amo.sealwork': case 'amo.buywork': exactKeys(p, ['listingTxid']); if (!TXID.test(p.listingTxid)) fail('INVALID_LISTING_TXID'); break
  }
  return JSON.parse(canonical(request))
}
export function authorizeRequest(request, policy, walletAddress) {
  if (!policy.signingEnabled) fail('GRANT_SIGNING_DISABLED')
  if (!policy.allowedActions.includes(request.action)) fail('ACTION_DENIED')
  if (request.action.startsWith('amo.') && policy.workLimits === null) fail('WORK_ACTION_DENIED')
  if (request.action === 'mail.send' && policy.allowedRecipients !== null) {
    const allowed = new Set([walletAddress, ...policy.allowedRecipients])
    if (request.payload.recipients.some(recipient => !allowed.has(recipient.address))) fail('RECIPIENT_DENIED')
  }
}
export function requestId(config, request) {
  return digest({ domain: 'permission-request-v1', network: config.network, walletAddress: config.walletAddress, request })
}
