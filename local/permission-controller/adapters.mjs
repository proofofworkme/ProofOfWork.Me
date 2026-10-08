import { execFile } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { address, exactKeys, fail, HEX, object, TXID } from './schema.mjs'

const execFileAsync = promisify(execFile)
export function normalizeConfig(config) {
  exactKeys(config, ['version', 'network', 'walletAddress', 'walletScriptPubKey', 'grantTxid', 'policyApiBase', 'stateDirectory', 'agentUids', 'autonomousSigning', 'secretReference', 'socketPath', 'accessTokenFile'], ['bridgeEvidenceHash'])
  if (config.version !== 1 || config.network !== 'livenet' || !TXID.test(config.grantTxid) || !HEX.test(config.walletScriptPubKey)) fail('INVALID_CONFIG')
  address(config.walletAddress)
  const url = new URL(config.policyApiBase)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) fail('UNSAFE_POLICY_ENDPOINT')
  for (const key of ['stateDirectory', 'socketPath', 'accessTokenFile']) if (!isAbsolute(config[key])) fail('ABSOLUTE_CONFIG_PATH_REQUIRED')
  if (!Array.isArray(config.agentUids) || !config.agentUids.length || config.agentUids.some(uid => !Number.isSafeInteger(uid) || uid < 0) || typeof config.autonomousSigning !== 'boolean') fail('INVALID_ISOLATION_CONFIG')
  exactKeys(config.secretReference, ['provider', 'item'])
  if (config.secretReference.provider !== 'secret-service' || typeof config.secretReference.item !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(config.secretReference.item)) fail('INVALID_SECRET_REFERENCE')
  if (config.autonomousSigning && !TXID.test(config.bridgeEvidenceHash || '')) fail('VERIFIED_BRIDGE_EVIDENCE_REQUIRED')
  return Object.freeze(structuredClone(config))
}
export function privateFile(path, { maxBytes = 65_536 } = {}) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > maxBytes) fail('UNSAFE_PRIVATE_FILE')
  return readFileSync(path)
}
export function loadConfig(path) { return normalizeConfig(JSON.parse(privateFile(path).toString('utf8'))) }
export const ledgerPath = config => join(config.stateDirectory, 'wallet-ledger.sqlite')

/** The source is an owner-pinned first-party canonical verifier, not an arbitrary explorer. */
export class CanonicalPolicyApi {
  constructor({ fetchImpl = fetch } = {}) { this.fetchImpl = fetchImpl }
  async read(config) {
    const url = new URL('/api/v1/permission', config.policyApiBase)
    url.search = new URLSearchParams({ network: config.network, txid: config.grantTxid, fresh: '1' }).toString()
    const result = await this.fetchImpl(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!result.ok) fail('CANONICAL_POLICY_UNAVAILABLE')
    const bytes = await boundedBody(result, 262_144)
    const data = object(JSON.parse(bytes.toString('utf8')))
    // Explicit first-party detail-envelope mapping; raw record inspection is
    // intentionally insufficient to prove absence of a later revocation.
    if (data.complete !== true || data.currentStatusVerified !== true || data.eventsComplete !== true || !data.permission || !data.currentPermission || data.permission.txid !== data.grantTxid || data.currentPermission.walletAddress !== data.walletAddress || data.permission.walletAddress !== data.walletAddress || !data.evidence || typeof data.evidence.verifiedAt !== 'string') fail('COMPLETE_PERMISSION_DETAIL_REQUIRED')
    const verifiedAt = Date.parse(data.evidence.verifiedAt)
    if (!Number.isSafeInteger(verifiedAt)) fail('INVALID_VERIFICATION_TIME')
    return { status: data.status, txid: data.grantTxid, headTxid: data.currentPermission.headTxid, walletAddress: data.walletAddress, network: data.network, policy: data.policy, evidence: { complete: data.evidence.complete, authorityVerified: data.evidence.authorityVerified, checkpoint: data.evidence.checkpoint, tip: data.tip, verifiedAt } }
  }
}
async function boundedBody(response, max) {
  let size = 0; const parts = []
  for await (const part of response.body) { size += part.length; if (size > max) fail('POLICY_RESPONSE_TOO_LARGE'); parts.push(Buffer.from(part)) }
  return Buffer.concat(parts)
}

/** Stock UniSat has no documented external unlock or policy-enforcement API. */
export class DisabledUniSatBridge {
  async readiness() { return { verified: false, reason: 'ISOLATED_UNISAT_BRIDGE_NOT_VERIFIED' } }
  async signExact() { fail('ISOLATED_UNISAT_BRIDGE_NOT_VERIFIED') }
  async broadcastExact() { fail('ISOLATED_UNISAT_BRIDGE_NOT_VERIFIED') }
}

/** Never call this during inspection; only an independently verified bridge may consume a secret. */
export class SecretServiceReferenceAdapter {
  constructor(config) { this.config = normalizeConfig(config) }
  async withUnlockSecret({ isolationEvidenceHash, exactTransactionConsent }, consume) {
    const config = this.config
    if (config.autonomousSigning !== true || config.agentUids.includes(0) || config.agentUids.includes(process.getuid()) || !TXID.test(isolationEvidenceHash || '') || isolationEvidenceHash !== config.bridgeEvidenceHash || !TXID.test(exactTransactionConsent?.templateDigest || '') || exactTransactionConsent?.ownerApproved !== true) fail('SECRET_ACCESS_NOT_AUTHORIZED')
    // No shell, arbitrary command, arbitrary keyring attributes or returned secret.
    const { stdout } = await execFileAsync('/usr/bin/secret-tool', ['lookup', 'application', 'proofofwork.me', 'service', 'permission-unisat', 'item', config.secretReference.item], { encoding: 'buffer', maxBuffer: 4096, timeout: 10_000 })
    const secret = Buffer.from(stdout)
    stdout.fill(0)
    try {
      if (!secret.length) fail('KEYRING_ITEM_UNAVAILABLE')
      // secret-tool appends a newline; preserve the secret's other bytes.
      const value = secret.at(-1) === 10 ? secret.subarray(0, -1) : secret
      return await consume(value)
    } finally { secret.fill(0) }
  }
}
