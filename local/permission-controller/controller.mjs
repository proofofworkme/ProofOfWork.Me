import { canonical, digest, fail, immutable, normalizePolicy, normalizeRequest, authorizeRequest, requestId, TXID } from './schema.mjs'
import { validatePrepared, validateSigned } from './transaction.mjs'

/** Dependency injection is for owner-installed verified adapters; it is never a request parameter. */
export class PermissionController {
  constructor({ config, ledger, policyReader, actionAdapters = {}, bridge, now = Date.now }) {
    this.config = immutable(JSON.parse(canonical(config)))
    this.ledger = ledger; this.policyReader = policyReader; this.actionAdapters = actionAdapters; this.bridge = bridge; this.now = now
    this.inFlight = new Set()
  }
  async policy() {
    const result = await this.policyReader.read(this.config)
    const now = this.now(), e = result.evidence
    if (result.status !== 'active' || result.txid !== this.config.grantTxid || result.headTxid !== this.config.grantTxid || result.walletAddress !== this.config.walletAddress || result.network !== this.config.network) fail('PINNED_GRANT_NOT_ACTIVE')
    if (!e || e.complete !== true || e.authorityVerified !== true || !e.checkpoint || !e.tip || !Number.isSafeInteger(e.checkpoint.height) || e.checkpoint.height < 0 || !TXID.test(e.checkpoint.hash) || canonical(e.checkpoint) !== canonical(e.tip) || !Number.isSafeInteger(e.verifiedAt) || e.verifiedAt > now || now - e.verifiedAt > 15_000) fail('CURRENT_CANONICAL_POLICY_REQUIRED')
    return { ...result, policy: normalizePolicy(result.policy) }
  }
  async inspect() {
    const grant = await this.policy()
    return { version: 1, walletAddress: this.config.walletAddress, network: this.config.network, grantTxid: this.config.grantTxid, status: grant.status, policy: grant.policy, evidence: grant.evidence, budget: this.ledger.usage(this.now()), autonomousSigningAvailable: false, reason: 'ISOLATED_BRIDGE_NOT_INSTALLED' }
  }
  async plan(input) {
    const request = normalizeRequest(input), grant = await this.policy()
    authorizeRequest(request, grant.policy, this.config.walletAddress)
    const id = requestId(this.config, request), previous = this.ledger.byOperation(request.operationId)
    if (previous && previous.request_id !== id) fail('IDEMPOTENCY_CONFLICT')
    const adapter = this.actionAdapters[request.action]
    if (!adapter) return { requestId: id, action: request.action, grantTxid: grant.txid, budget: this.ledger.usage(this.now()), status: previous?.status || 'inspection_only', executable: false, reason: 'VERIFIED_ACTION_ADAPTER_NOT_INSTALLED' }
    // Construction and independent verification are separate adapter methods.
    const context = { request, grant, config: this.config, checkpoint: grant.evidence.checkpoint }
    const prepared = await adapter.prepare(context)
    const expected = await adapter.verify({ ...context, prepared })
    const checked = validatePrepared({ prepared, expected, request, config: this.config, policy: grant.policy, checkpoint: grant.evidence.checkpoint })
    return { requestId: id, action: request.action, grantTxid: grant.txid, status: previous?.status || 'prepared', executable: false, costProofs: checked.costProofs, minerFeeProofs: checked.minerFeeProofs, templateDigest: checked.templateDigest, budget: this.ledger.usage(this.now()), reason: 'SIGNING_REQUIRES_VERIFIED_ISOLATED_BRIDGE' }
  }
  async execute(input) {
    const request = normalizeRequest(input), id = requestId(this.config, request)
    // Duplicate execution must never re-sign, including after grant replacement.
    const previous = this.ledger.byOperation(request.operationId)
    if (previous) { if (previous.request_id !== id) fail('IDEMPOTENCY_CONFLICT'); return receipt(previous) }
    if (this.inFlight.has(id)) fail('REQUEST_IN_PROGRESS')
    this.inFlight.add(id)
    try {
      const grant = await this.policy()
      authorizeRequest(request, grant.policy, this.config.walletAddress)
      if (this.config.autonomousSigning !== true) fail('AUTONOMOUS_SIGNING_DISABLED')
      // A requestor cannot provide an isolation flag or credentials to satisfy this gate.
      if (typeof process.getuid !== 'function' || !Array.isArray(this.config.agentUids) || !this.config.agentUids.length || this.config.agentUids.includes(0) || this.config.agentUids.includes(process.getuid())) fail('AGENT_AND_SIGNER_NOT_ISOLATED')
      const isolation = await this.bridge.readiness(this.config)
      if (!isolation || isolation.verified !== true || isolation.walletAddress !== this.config.walletAddress || isolation.network !== this.config.network || isolation.evidenceHash !== this.config.bridgeEvidenceHash || !TXID.test(isolation.evidenceHash || '')) fail('VERIFIED_ISOLATED_BRIDGE_REQUIRED')
      const adapter = this.actionAdapters[request.action]
      if (!adapter) fail('VERIFIED_ACTION_ADAPTER_NOT_INSTALLED')
      const context = { request, grant, config: this.config, checkpoint: grant.evidence.checkpoint }
      const prepared = await adapter.prepare(context), expected = await adapter.verify({ ...context, prepared })
      const checked = validatePrepared({ prepared, expected, request, config: this.config, policy: grant.policy, checkpoint: grant.evidence.checkpoint })
      const fresh = await this.policy()
      if (digest(fresh.policy) !== digest(grant.policy) || canonical(fresh.evidence.checkpoint) !== canonical(grant.evidence.checkpoint)) fail('POLICY_OR_CHECKPOINT_CHANGED')
      await adapter.recheck({ ...context, prepared, expected })
      const reservation = this.ledger.reserve({ id, operationId: request.operationId, requestHash: digest(request), grantTxid: grant.txid, cost: checked.costProofs, templateDigest: checked.templateDigest, evidence: { checkpoint: grant.evidence.checkpoint }, dailyLimit: grant.policy.dailyLimitProofs, now: this.now() })
      if (!reservation.created) return receipt(reservation.row)
      this.ledger.transition(id, 'reserved', 'signing', { now: this.now() })
      // Signature requests are only exact verified transactions, never arbitrary messages/PSBTs supplied by agents.
      const signed = await this.bridge.signExact({ requestId: id, prepared, signaturePolicy: checked.signaturePolicy, templateDigest: checked.templateDigest, config: this.config })
      const txid = validateSigned(signed.rawTransactionHex, checked)
      this.ledger.transition(id, 'signing', 'signed', { transactionId: txid, evidence: { rawTransactionHex: signed.rawTransactionHex, templateDigest: checked.templateDigest }, now: this.now() })
      const beforeBroadcast = await this.policy()
      if (digest(beforeBroadcast.policy) !== digest(grant.policy)) fail('POLICY_CHANGED_AFTER_SIGNING')
      await adapter.recheck({ ...context, prepared, expected, signedTransactionHex: signed.rawTransactionHex })
      // Persist raw signed recovery evidence before the first possible broadcast.
      this.ledger.transition(id, 'signed', 'broadcast_unknown', { transactionId: txid, evidence: { rawTransactionHex: signed.rawTransactionHex, templateDigest: checked.templateDigest }, now: this.now() })
      const result = await this.bridge.broadcastExact({ rawTransactionHex: signed.rawTransactionHex, expectedTxid: txid, config: this.config })
      if (result.txid !== txid || result.accepted !== true) fail('BROADCAST_OUTCOME_UNKNOWN')
      return receipt(this.ledger.transition(id, 'broadcast_unknown', 'pending', { transactionId: txid, evidence: { rawTransactionHex: signed.rawTransactionHex }, now: this.now() }))
    } finally { this.inFlight.delete(id) }
  }
}
export function receipt(row) {
  return { requestId: row.request_id, grantTxid: row.grant_txid, status: row.status, costProofs: row.cost, templateDigest: row.template_digest, txid: row.transaction_id, authorizationUtcDay: row.authorized_day }
}
