import { createHash } from 'node:crypto'
import { permissionMinerFeeProofs } from '../../src/shared/protocol/permissions.mjs'
import { canonical, digest, exactKeys, fail, HEX, integer, normalizePolicy, object, TXID } from './schema.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest()
class Reader {
  constructor(bytes) { this.bytes = bytes; this.offset = 0 }
  take(size) { if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.bytes.length) fail('TRUNCATED_TRANSACTION'); const result = this.bytes.subarray(this.offset, this.offset + size); this.offset += size; return result }
  u32() { return this.take(4).readUInt32LE() }
  u64() { return this.take(8).readBigUInt64LE() }
  compact() {
    const marker = this.take(1)[0]
    if (marker < 0xfd) return marker
    const value = marker === 0xfd ? BigInt(this.take(2).readUInt16LE()) : marker === 0xfe ? BigInt(this.u32()) : this.u64()
    if ((marker === 0xfd && value < 0xfdn) || (marker === 0xfe && value <= 0xffffn) || (marker === 0xff && value <= 0xffffffffn) || value > 500_000n) fail('INVALID_COMPACT_SIZE')
    return Number(value)
  }
  variable() { return this.take(this.compact()) }
}
export function decodeTransaction(rawHex) {
  if (typeof rawHex !== 'string' || !HEX.test(rawHex) || rawHex.length > 1_000_000) fail('INVALID_TRANSACTION_HEX')
  const bytes = Buffer.from(rawHex, 'hex'), reader = new Reader(bytes)
  const versionBytes = reader.take(4), version = versionBytes.readInt32LE()
  let witness = false
  if (bytes[reader.offset] === 0) { reader.take(1); if (reader.take(1)[0] !== 1) fail('INVALID_WITNESS_FLAG'); witness = true }
  const inputStart = reader.offset, count = reader.compact()
  if (!count || count > 1000) fail('INVALID_INPUT_COUNT')
  const inputs = []
  for (let index = 0; index < count; index++) {
    const txid = Buffer.from(reader.take(32)).reverse().toString('hex'), vout = reader.u32(), scriptSig = reader.variable().toString('hex'), sequence = reader.u32()
    if (/^0{64}$/.test(txid)) fail('COINBASE_NOT_ALLOWED')
    inputs.push({ txid, vout, scriptSig, sequence })
  }
  if (new Set(inputs.map(input => `${input.txid}:${input.vout}`)).size !== count) fail('DUPLICATE_INPUT')
  const outputCount = reader.compact()
  if (!outputCount || outputCount > 2000) fail('INVALID_OUTPUT_COUNT')
  const outputs = []
  for (let index = 0; index < outputCount; index++) {
    const value = reader.u64(); if (value > 2_100_000_000_000_000n) fail('INVALID_OUTPUT_VALUE')
    outputs.push({ valueProofs: value.toString(), scriptPubKey: reader.variable().toString('hex') })
  }
  const outputEnd = reader.offset
  if (witness) for (let index = 0; index < count; index++) { const items = reader.compact(); if (items > 1000) fail('INVALID_WITNESS'); inputs[index].witnessStack = []; for (let item = 0; item < items; item++) inputs[index].witnessStack.push(reader.variable().toString('hex')) }
  const lockBytes = reader.take(4), locktime = lockBytes.readUInt32LE()
  if (reader.offset !== bytes.length) fail('TRAILING_TRANSACTION_BYTES')
  const stripped = Buffer.concat([versionBytes, bytes.subarray(inputStart, outputEnd), lockBytes])
  return { version, locktime, inputs, outputs, witness, virtualBytes: Math.ceil((stripped.length * 3 + bytes.length) / 4), txid: Buffer.from(sha256(sha256(stripped))).reverse().toString('hex') }
}
export function transactionShape(tx) {
  return { version: tx.version, locktime: tx.locktime, inputs: tx.inputs.map(({ txid, vout, sequence }) => ({ txid, vout, sequence })), outputs: tx.outputs }
}
export function unsignedTransactionFromPsbt(psbtHex) {
  if (typeof psbtHex !== 'string' || !HEX.test(psbtHex) || psbtHex.length > 1_000_000) fail('INVALID_PSBT')
  const reader = new Reader(Buffer.from(psbtHex, 'hex'))
  if (reader.take(5).toString('hex') !== '70736274ff') fail('INVALID_PSBT')
  const map = () => {
    const entries = new Map()
    for (;;) {
      const key = reader.variable(); if (!key.length) break
      const hex = key.toString('hex'); if (entries.has(hex)) fail('DUPLICATE_PSBT_KEY')
      entries.set(hex, reader.variable())
    }
    return entries
  }
  const global = map()
  // Version-zero PSBT is deliberately the only supported carrier. No global xpubs.
  if (global.size !== 1 || !global.has('00')) fail('UNSUPPORTED_PSBT_GLOBALS')
  const raw = global.get('00').toString('hex'), tx = decodeTransaction(raw)
  if (tx.witness || tx.inputs.some(input => input.scriptSig !== '')) fail('PSBT_UNSIGNED_TRANSACTION_REQUIRED')
  const inputs = tx.inputs.map(() => map()), outputs = tx.outputs.map(() => map())
  if (reader.offset !== reader.bytes.length) fail('TRAILING_PSBT_BYTES')
  return { raw, tx, inputs, outputs }
}
function compactSizeBytes(value) { return value < 0xfd ? 1 : value <= 0xffff ? 3 : value <= 0xffffffff ? 5 : 9 }
/** Match the existing wallet selector's conservative 160-vB input convention.
 * Counts and output scripts come from the exact unsigned transaction; input
 * scripts have already been checked against independently verified prevouts.
 * No requestor/adapter estimate or claimed fee can influence the calculation.
 */
export function estimatedTransactionVirtualBytes(tx, inputScripts) {
  if (!Array.isArray(inputScripts) || inputScripts.length !== tx.inputs.length) fail('INPUT_TEMPLATE_MISMATCH')
  for (const script of inputScripts) {
    if (typeof script !== 'string' || !/^(?:76a914[a-f0-9]{40}88ac|0014[a-f0-9]{40}|5120[a-f0-9]{64})$/.test(script)) fail('UNSUPPORTED_FEE_ESTIMATE_INPUT')
  }
  return 8 + compactSizeBytes(tx.inputs.length) + compactSizeBytes(tx.outputs.length) + tx.inputs.length * 160 +
    tx.outputs.reduce((total, output) => { const bytes = output.scriptPubKey.length / 2; return total + 8 + compactSizeBytes(bytes) + bytes }, 0)
}
/** Expected template MUST come from the separately trusted action verifier, never the requestor or signer. */
export function validatePrepared({ prepared, expected, request, config, policy, checkpoint }) {
  policy = normalizePolicy(policy)
  exactKeys(prepared, ['psbtHex', 'unsignedTransactionHex'])
  object(expected)
  exactKeys(expected, ['action', 'requestDigest', 'checkpoint', 'version', 'locktime', 'inputs', 'outputs', 'work', 'signaturePolicy'])
  if (expected.action !== request.action || expected.requestDigest !== digest(request) || canonical(expected.checkpoint) !== canonical(checkpoint)) fail('ACTION_TEMPLATE_BINDING_MISMATCH')
  const psbt = unsignedTransactionFromPsbt(prepared.psbtHex), tx = decodeTransaction(prepared.unsignedTransactionHex)
  if (psbt.raw !== prepared.unsignedTransactionHex || tx.witness || tx.inputs.some(input => input.scriptSig !== '')) fail('PSBT_TEMPLATE_MISMATCH')
  if (!Array.isArray(expected.inputs) || !Array.isArray(expected.outputs) || expected.inputs.length !== tx.inputs.length || expected.outputs.length !== tx.outputs.length || expected.version !== tx.version || expected.locktime !== tx.locktime) fail('TRANSACTION_TEMPLATE_MISMATCH')
  let totalInput = 0n, walletInput = 0n, totalOutput = 0n, walletOutput = 0n
  for (let index = 0; index < expected.inputs.length; index++) {
    const input = expected.inputs[index], actual = tx.inputs[index]
    exactKeys(input, ['txid', 'vout', 'sequence', 'valueProofs', 'scriptPubKey', 'kind'])
    if (!TXID.test(input.txid) || !HEX.test(input.scriptPubKey) || !['wallet', 'sale-ticket'].includes(input.kind) || !Number.isSafeInteger(input.vout) || !Number.isSafeInteger(input.sequence) || input.txid !== actual.txid || input.vout !== actual.vout || input.sequence !== actual.sequence) fail('INPUT_TEMPLATE_MISMATCH')
    const value = integer(input.valueProofs, { positive: true }); totalInput += value
    if (input.kind === 'wallet') { if (input.scriptPubKey !== config.walletScriptPubKey) fail('WALLET_INPUT_MISMATCH'); walletInput += value }
    else if (request.action !== 'amo.buywork') fail('FOREIGN_INPUT_DENIED')
    // Funding amount and script cannot be supplied only as PSBT metadata.
    const witnessUtxo = psbt.inputs[index].get('01'), nonWitnessUtxo = psbt.inputs[index].get('00')
    if (!witnessUtxo && !nonWitnessUtxo) fail('MISSING_PSBT_FUNDING')
    if (witnessUtxo) {
      const funding = new Reader(witnessUtxo), amount = funding.u64(), script = funding.variable().toString('hex')
      if (funding.offset !== witnessUtxo.length || amount !== value || script !== input.scriptPubKey) fail('PSBT_FUNDING_MISMATCH')
    }
    if (nonWitnessUtxo) {
      const funding = decodeTransaction(nonWitnessUtxo.toString('hex')), output = funding.outputs[input.vout]
      if (funding.txid !== input.txid || !output || output.valueProofs !== input.valueProofs || output.scriptPubKey !== input.scriptPubKey) fail('PSBT_FUNDING_MISMATCH')
    }
  }
  if (!walletInput) fail('WALLET_FUNDING_REQUIRED')
  for (let index = 0; index < expected.outputs.length; index++) {
    const output = expected.outputs[index], actual = tx.outputs[index]
    exactKeys(output, ['valueProofs', 'scriptPubKey', 'kind'], ['recipientAddress'])
    if (!['change', 'payment', 'protocol', 'registry', 'sale-ticket'].includes(output.kind) || output.valueProofs !== actual.valueProofs || output.scriptPubKey !== actual.scriptPubKey) fail('OUTPUT_TEMPLATE_MISMATCH')
    const value = integer(output.valueProofs); totalOutput += value
    if (output.kind === 'change' && output.scriptPubKey !== config.walletScriptPubKey) fail('CHANGE_SCRIPT_MISMATCH')
    if (output.scriptPubKey === config.walletScriptPubKey) walletOutput += value
    if (output.kind === 'payment' && (!output.recipientAddress || (policy.allowedRecipients !== null && ![config.walletAddress, ...policy.allowedRecipients].includes(output.recipientAddress)))) fail('RECIPIENT_DENIED')
  }
  const fee = totalInput - totalOutput, cost = walletInput - walletOutput
  if (fee < 0n || cost < 0n || cost > integer(policy.maxTransactionProofs)) fail('TRANSACTION_LIMIT_EXCEEDED')
  let feeRateEvidence
  if (Object.hasOwn(policy, 'minerFeeRateProofsPerVbyte')) {
    const estimatedVirtualBytes = estimatedTransactionVirtualBytes(tx, expected.inputs.map(input => input.scriptPubKey))
    const targetFee = permissionMinerFeeProofs(policy.minerFeeRateProofsPerVbyte, estimatedVirtualBytes)
    if (targetFee === null) fail('INVALID_MINER_FEE_RATE')
    // Exact ceiling is the only rounding allowance. Dust must be returned or
    // funding reselected; it cannot silently raise the granted construction fee.
    if (fee.toString() !== targetFee) fail('MINER_FEE_RATE_MISMATCH')
    feeRateEvidence = { minerFeeRateProofsPerVbyte: policy.minerFeeRateProofsPerVbyte, estimatedVirtualBytes }
  } else if (fee > integer(policy.maxMinerFeeProofs)) fail('TRANSACTION_LIMIT_EXCEEDED')
  if (request.action.startsWith('amo.')) {
    const work = expected.work, limits = policy.workLimits
    if (!limits || !work || work.canonicalVerified !== true || work.quantityBoundVerified !== true) fail('WORK_EVIDENCE_REQUIRED')
    integer(work.amountSubatoms, { positive: true }); integer(work.priceProofs, { positive: true })
    if (integer(work.amountSubatoms) > integer(limits.maxAmountSubatoms)) fail('WORK_AMOUNT_EXCEEDED')
    if (request.action === 'amo.buywork' && integer(work.priceProofs) > integer(limits.maxPurchaseProofs)) fail('WORK_PURCHASE_PRICE_EXCEEDED')
    if (request.action !== 'amo.buywork' && integer(work.priceProofs) < integer(limits.minSaleProofs)) fail('WORK_SALE_PRICE_TOO_LOW')
    if (request.action === 'amo.listwork' && (!Number.isSafeInteger(work.openListings) || work.openListings < 0 || work.openListings >= limits.maxOpenListings)) fail('OPEN_LISTINGS_LIMIT_EXCEEDED')
    if (request.action !== 'amo.listwork' && work.listingTxid !== request.payload.listingTxid) fail('WORK_LISTING_MISMATCH')
  } else if (expected.work !== null) fail('UNEXPECTED_ASSET_OPERATION')
  if (!expected.signaturePolicy || expected.signaturePolicy.verified !== true || !Array.isArray(expected.signaturePolicy.inputs) || !expected.signaturePolicy.inputs.length) fail('SIGNATURE_POLICY_REQUIRED')
  for (const input of expected.signaturePolicy.inputs) {
    exactKeys(input, ['index', 'sighashTypes'])
    if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= tx.inputs.length || expected.inputs[input.index].kind !== 'wallet' || !Array.isArray(input.sighashTypes) || !input.sighashTypes.length || input.sighashTypes.some(type => !Number.isInteger(type) || type < 0 || type > 255)) fail('INVALID_SIGNATURE_POLICY')
  }
  const indexes = expected.signaturePolicy.inputs.map(input => input.index)
  if (new Set(indexes).size !== indexes.length || expected.inputs.some((input, index) => input.kind === 'wallet' && !indexes.includes(index))) fail('INCOMPLETE_SIGNATURE_POLICY')
  for (const input of expected.signaturePolicy.inputs) {
    const declared = psbt.inputs[input.index].get('03')
    if (declared && (declared.length !== 4 || !input.sighashTypes.includes(declared.readUInt32LE()))) fail('PSBT_SIGHASH_DENIED')
  }
  return { costProofs: cost.toString(), minerFeeProofs: fee.toString(), ...feeRateEvidence, templateDigest: digest(transactionShape(tx)), signaturePolicy: expected.signaturePolicy, inputScripts: expected.inputs.map(input => input.scriptPubKey), shape: transactionShape(tx) }
}
export function validateSigned(rawHex, checked) {
  const tx = decodeTransaction(rawHex)
  if (canonical(transactionShape(tx)) !== canonical(checked.shape)) fail('SIGNED_TRANSACTION_CHANGED')
  if (checked.estimatedVirtualBytes !== undefined && tx.virtualBytes > checked.estimatedVirtualBytes) fail('SIGNED_FEE_ESTIMATE_EXCEEDED')
  for (const policy of checked.signaturePolicy.inputs) {
    const input = tx.inputs[policy.index], script = checked.inputScripts[policy.index], stack = input.witnessStack || []
    let type
    if (/^5120[a-f0-9]{64}$/.test(script)) {
      // Only Taproot key-path signatures are supported by this v1 validator.
      if (input.scriptSig || stack.length !== 1 || ![128, 130].includes(stack[0].length)) fail('UNSUPPORTED_WALLET_SIGNATURE')
      type = stack[0].length === 128 ? 0 : Number.parseInt(stack[0].slice(-2), 16)
      if (stack[0].length === 130 && type === 0) fail('NONCANONICAL_SIGNATURE')
    } else if (/^0014[a-f0-9]{40}$/.test(script)) {
      if (input.scriptSig || stack.length !== 2 || !/^0[23][a-f0-9]{64}$/.test(stack[1]) || !/^30[a-f0-9]{14,144}$/.test(stack[0])) fail('UNSUPPORTED_WALLET_SIGNATURE')
      const pubkeyHash = createHash('ripemd160').update(sha256(Buffer.from(stack[1], 'hex'))).digest('hex')
      if (pubkeyHash !== script.slice(4)) fail('SIGNED_WALLET_KEY_MISMATCH')
      type = Number.parseInt(stack[0].slice(-2), 16)
    } else fail('UNSUPPORTED_WALLET_SIGNATURE')
    if (!policy.sighashTypes.includes(type)) fail('SIGNED_SIGHASH_DENIED')
  }
  return tx.txid
}
