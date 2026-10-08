import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { PermissionController } from './controller.mjs'
import { PermissionLedger } from './ledger.mjs'
import { normalizeConfig, CanonicalPolicyApi, DisabledUniSatBridge, SecretServiceReferenceAdapter } from './adapters.mjs'
import { canonical, digest, normalizeRequest, requestId } from './schema.mjs'
import { decodeTransaction, validatePrepared, validateSigned } from './transaction.mjs'

const timestamp = Date.parse('2026-10-08T12:00:00Z')
const config = () => ({ version: 1, network: 'livenet', walletAddress: 'wallet-fixture', walletScriptPubKey: `5120${'bb'.repeat(32)}`, grantTxid: 'a'.repeat(64), policyApiBase: 'https://permission.proofofwork.me', stateDirectory: '/tmp/controller-fixture', agentUids: [process.getuid() + 1001], autonomousSigning: false, secretReference: { provider: 'secret-service', item: 'unisat_local' }, socketPath: '/tmp/controller-fixture/controller.sock', accessTokenFile: '/tmp/controller-fixture/access-token' })
const policy = () => ({ signingEnabled: true, allowedActions: ['mail.send', 'amo.listwork'], maxTransactionProofs: '5000', dailyLimitProofs: '30000', maxMinerFeeProofs: '1000', allowedRecipients: ['recipient-fixture'], workLimits: null })
const request = operationId => ({ operationId: operationId || 'fixture_operation_0001', action: 'mail.send', payload: { recipients: [{ address: 'recipient-fixture', proofs: '1000' }], body: 'Fixture message' } })
const checkpoint = { height: 123, hash: 'c'.repeat(64) }
function grant(c = config(), time = timestamp) { return { status: 'active', txid: c.grantTxid, headTxid: c.grantTxid, walletAddress: c.walletAddress, network: c.network, policy: policy(), evidence: { complete: true, authorityVerified: true, checkpoint, tip: checkpoint, verifiedAt: time } } }
function compact(n) { if (n >= 253) throw new Error('Fixture too large'); return Buffer.from([n]) }
function field(bytes) { return Buffer.concat([compact(bytes.length), bytes]) }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b }
function wire({ witness = null, payment = '1000', change = '8900', changeScript = config().walletScriptPubKey } = {}) {
  const inputs = Buffer.concat([compact(1), Buffer.from('aa'.repeat(32), 'hex'), u32(0), compact(0), u32(0xfffffffd)])
  const outputs = Buffer.concat([compact(2), u64(payment), field(Buffer.from(`0014${'cc'.repeat(20)}`, 'hex')), u64(change), field(Buffer.from(changeScript, 'hex'))])
  const parts = [u32(2), ...(witness ? [Buffer.from([0, 1])] : []), inputs, outputs]
  if (witness) parts.push(compact(1), field(Buffer.from(witness, 'hex')))
  parts.push(u32(0)); return Buffer.concat(parts).toString('hex')
}
function fixture(c = config(), r = request()) {
  const raw = wire(), utxo = Buffer.concat([u64(10000), field(Buffer.from(c.walletScriptPubKey, 'hex'))])
  const psbt = Buffer.concat([Buffer.from('70736274ff', 'hex'), field(Buffer.from([0])), field(Buffer.from(raw, 'hex')), compact(0), field(Buffer.from([1])), field(utxo), compact(0), compact(0), compact(0)]).toString('hex')
  const expected = { action: r.action, requestDigest: digest(normalizeRequest(r)), checkpoint, version: 2, locktime: 0, inputs: [{ txid: 'aa'.repeat(32), vout: 0, sequence: 0xfffffffd, valueProofs: '10000', scriptPubKey: c.walletScriptPubKey, kind: 'wallet' }], outputs: [{ valueProofs: '1000', scriptPubKey: `0014${'cc'.repeat(20)}`, kind: 'payment', recipientAddress: 'recipient-fixture' }, { valueProofs: '8900', scriptPubKey: c.walletScriptPubKey, kind: 'change' }], work: null, signaturePolicy: { verified: true, inputs: [{ index: 0, sighashTypes: [0, 1] }] } }
  return { prepared: { unsignedTransactionHex: raw, psbtHex: psbt }, expected }
}
function setup({ c = config(), bridge = new DisabledUniSatBridge(), read, clock = () => timestamp, adapt = true } = {}) {
  const ledger = new PermissionLedger(':memory:', c)
  const adapter = { prepare: async ({ request: r }) => fixture(c, r).prepared, verify: async ({ request: r }) => fixture(c, r).expected, recheck: async () => {} }
  const controller = new PermissionController({ config: c, ledger, policyReader: { read: read || (async () => grant(c, clock())) }, actionAdapters: adapt ? { 'mail.send': adapter } : {}, bridge, now: clock })
  return { controller, ledger }
}
function verifiedBridge(c, overrides = {}) {
  return { readiness: async () => ({ verified: true, walletAddress: c.walletAddress, network: c.network, evidenceHash: c.bridgeEvidenceHash }), signExact: async () => ({ rawTransactionHex: wire({ witness: '11'.repeat(64) }) }), broadcastExact: async ({ expectedTxid }) => ({ txid: expectedTxid, accepted: true }), ...overrides }
}
test('agents cannot submit credentials, raw PSBTs, permission substitutions, arbitrary messages or unidentified fields', () => {
  for (const field of ['password', 'unisat_password', 'seed', 'psbtHex', 'grantTxid', 'agentId', 'expiresAt']) assert.throws(() => normalizeRequest({ ...request(), [field]: 'value' }), { code: 'UNKNOWN_OR_MISSING_FIELD' })
  assert.throws(() => normalizeRequest({ ...request(), action: 'wallet.signMessage' }), { code: 'INVALID_REQUEST' })
})
test('read-only planning verifies exact unsigned transaction and does not reserve or touch signing', async () => {
  const { controller, ledger } = setup()
  const result = await controller.plan(request())
  assert.equal(result.costProofs, '1100'); assert.equal(result.minerFeeProofs, '100'); assert.equal(result.executable, false)
  assert.equal(ledger.usage(timestamp).usedProofs, '0'); assert.equal(ledger.byOperation(request().operationId), null); ledger.close()
})
test('inspection-only action adapter absence remains useful and cannot enable execution', async () => {
  const { controller, ledger } = setup({ adapt: false })
  assert.equal((await controller.plan(request())).reason, 'VERIFIED_ACTION_ADAPTER_NOT_INSTALLED')
  await assert.rejects(controller.execute(request()), { code: 'AUTONOMOUS_SIGNING_DISABLED' }); ledger.close()
})
test('current-tip, issuer wallet, supplied head and full canonical evidence are mandatory', async () => {
  for (const change of [{ walletAddress: 'other-wallet' }, { headTxid: 'd'.repeat(64) }, { status: 'revoked' }, { evidence: { ...grant().evidence, authorityVerified: false } }, { evidence: { ...grant().evidence, tip: { height: 124, hash: 'd'.repeat(64) } } }, { evidence: { ...grant().evidence, verifiedAt: timestamp - 15001 } }]) {
    const { controller, ledger } = setup({ read: async () => ({ ...grant(), ...change }) })
    await assert.rejects(controller.plan(request())); assert.equal(ledger.usage(timestamp).usedProofs, '0'); ledger.close()
  }
})
test('wallet binding is immutable while grant replacement retains durable usage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'permission-ledger-')), path = join(dir, 'wallet.sqlite'), c = config()
  const ledger = new PermissionLedger(path, c)
  reserve(ledger, '1'.repeat(64), '15000'); ledger.close()
  const replacement = new PermissionLedger(path, { ...c, grantTxid: 'd'.repeat(64) })
  assert.equal(replacement.usage(timestamp).usedProofs, '15000'); replacement.close()
  assert.throws(() => new PermissionLedger(path, { ...c, walletAddress: 'different-wallet' }), { code: 'IMMUTABLE_WALLET_BINDING_MISMATCH' })
  rmSync(dir, { recursive: true })
})
function reserve(ledger, id, cost, now = timestamp, limit = '30000') { return ledger.reserve({ id, operationId: `operation_${id}`, requestHash: id, grantTxid: config().grantTxid, cost, templateDigest: 'f'.repeat(64), evidence: {}, dailyLimit: limit, now }) }
test('durable atomic reservations reject simultaneous overspend across independent SQLite connections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'permission-concurrent-')), path = join(dir, 'wallet.sqlite')
  const ledger = new PermissionLedger(path, config()); ledger.close()
  const moduleUrl = pathToFileURL(join(import.meta.dirname, 'ledger.mjs')).href
  const gate = new Int32Array(new SharedArrayBuffer(4)); let ready = 0
  const child = id => `import {parentPort,workerData} from 'node:worker_threads'; import {PermissionLedger} from ${JSON.stringify(moduleUrl)}; const db=new PermissionLedger(${JSON.stringify(path)},${JSON.stringify(config())});parentPort.postMessage({ready:true});Atomics.wait(workerData.gate,0,0,10000);let result; try {db.reserve(${JSON.stringify({ id, operationId: `operation_${id}`, requestHash: id, grantTxid: config().grantTxid, cost: '15000', templateDigest: 'f'.repeat(64), evidence: {}, dailyLimit: '20000', now: timestamp })});result='reserved'}catch(e){result=e.code}finally{db.close()}parentPort.postMessage({result})`
  const results = await Promise.all(['1'.repeat(64), '2'.repeat(64)].map(id => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(child(id))}`), { workerData: { gate }, execArgv: [] })
    worker.on('error', reject); worker.on('message', message => { if (message.ready) { ready++; if (ready === 2) { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0, 2) } } else resolve(message.result) })
  })))
  assert.deepEqual(results.sort(), ['DAILY_LIMIT_EXCEEDED', 'reserved'])
  const final = new PermissionLedger(path, config()); assert.equal(final.usage(timestamp).usedProofs, '15000'); final.close(); rmSync(dir, { recursive: true })
})
test('outstanding signatures survive midnight and clock rollback never resets capacity', () => {
  const ledger = new PermissionLedger(':memory:', config()), next = timestamp + 86_400_000
  reserve(ledger, '1'.repeat(64), '20000'); ledger.transition('1'.repeat(64), 'reserved', 'signing', { now: timestamp })
  assert.equal(ledger.usage(next).usedProofs, '20000')
  assert.throws(() => reserve(ledger, '2'.repeat(64), '15000', next), { code: 'DAILY_LIMIT_EXCEEDED' })
  reserve(ledger, '3'.repeat(64), '5000', next)
  assert.throws(() => ledger.usage(timestamp), { code: 'CLOCK_ROLLBACK' }); ledger.close()
})
test('confirmed transactions are charged on both authorization and settlement days without double counting', () => {
  const ledger = new PermissionLedger(':memory:', config()), id = '1'.repeat(64), next = timestamp + 86_400_000
  reserve(ledger, id, '10000')
  for (const [from, to] of [['reserved', 'signing'], ['signing', 'signed'], ['signed', 'broadcast_unknown'], ['broadcast_unknown', 'confirmed']]) ledger.transition(id, from, to, { now: to === 'confirmed' ? next : timestamp })
  assert.equal(ledger.usage(next).usedProofs, '10000'); assert.equal(ledger.usage(next + 86_400_000).usedProofs, '0'); ledger.close()
})
test('idempotency cannot be bypassed by changing the action body or replacing a grant', () => {
  const ledger = new PermissionLedger(':memory:', config()), id = '1'.repeat(64)
  assert.equal(reserve(ledger, id, '10000').created, true); assert.equal(reserve(ledger, id, '10000').created, false)
  assert.throws(() => ledger.reserve({ id: '2'.repeat(64), operationId: `operation_${id}`, requestHash: id, grantTxid: 'd'.repeat(64), cost: '1', templateDigest: id, evidence: {}, dailyLimit: '30000', now: timestamp }), { code: 'IDEMPOTENCY_CONFLICT' }); ledger.close()
})
test('unknown signing outcome preserves reservation and never automatically re-signs', async () => {
  const c = { ...config(), autonomousSigning: true, bridgeEvidenceHash: 'e'.repeat(64) }; let calls = 0
  const { controller, ledger } = setup({ c, bridge: verifiedBridge(c, { signExact: async () => { calls++; throw new Error('Disconnected') } }) })
  await assert.rejects(controller.execute(request()), /Disconnected/)
  assert.equal((await controller.execute(request())).status, 'signing'); assert.equal(calls, 1); assert.equal(ledger.usage(timestamp).usedProofs, '1100'); ledger.close()
})
test('exact signed recovery evidence is persisted before uncertain broadcast; repeated request returns receipt', async () => {
  const c = { ...config(), autonomousSigning: true, bridgeEvidenceHash: 'e'.repeat(64) }; let calls = 0
  const { controller, ledger } = setup({ c, bridge: verifiedBridge(c, { broadcastExact: async () => { calls++; const row = ledger.byOperation(request().operationId); assert.equal(row.status, 'broadcast_unknown'); assert.ok(JSON.parse(row.evidence).rawTransactionHex); throw new Error('Timeout') } }) })
  await assert.rejects(controller.execute(request()), /Timeout/)
  const result = await controller.execute(request()); assert.equal(result.status, 'broadcast_unknown'); assert.match(result.txid, /^[a-f0-9]{64}$/); assert.equal(calls, 1); ledger.close()
})
test('same-user wallet/password isolation and missing bridge proof fail before any reservation', async () => {
  for (const c of [{ ...config(), autonomousSigning: true, bridgeEvidenceHash: 'e'.repeat(64), agentUids: [process.getuid()] }, { ...config(), autonomousSigning: true, bridgeEvidenceHash: 'e'.repeat(64) }]) {
    const { controller, ledger } = setup({ c })
    await assert.rejects(controller.execute(request())); assert.equal(ledger.usage(timestamp).usedProofs, '0'); ledger.close()
  }
})
test('raw output, funding amount, recipient, change and fee substitution all fail exact validation', () => {
  const c = config(), r = request(), f = fixture(c, r)
  const verify = value => validatePrepared({ ...value, request: r, config: c, policy: policy(), checkpoint })
  assert.equal(verify(f).costProofs, '1100')
  for (const mutate of [value => { value.expected.outputs[0].recipientAddress = 'attacker' }, value => { value.expected.inputs[0].valueProofs = '11000' }, value => { value.expected.inputs[0].scriptPubKey = `5120${'dd'.repeat(32)}` }, value => { value.prepared.unsignedTransactionHex = wire({ payment: '1001' }) }, value => { value.expected.action = 'publish.article' }]) {
    const altered = structuredClone(f); mutate(altered); assert.throws(() => verify(altered))
  }
  assert.throws(() => verify({ ...f, expected: { ...f.expected, outputs: f.expected.outputs.map(output => ({ ...output, kind: 'change' })) } }), { code: 'CHANGE_SCRIPT_MISMATCH' })
})
test('signed transaction outputs and sighash scope cannot escape the reviewed template', () => {
  const c = config(), r = request(), checked = validatePrepared({ ...fixture(c, r), request: r, config: c, policy: policy(), checkpoint })
  assert.equal(validateSigned(wire({ witness: '11'.repeat(64) }), checked), decodeTransaction(wire({ witness: '11'.repeat(64) })).txid)
  assert.throws(() => validateSigned(wire({ witness: '11'.repeat(64), payment: '1001' }), checked), { code: 'SIGNED_TRANSACTION_CHANGED' })
  assert.throws(() => validateSigned(wire({ witness: `${'11'.repeat(64)}83` }), checked), { code: 'SIGNED_SIGHASH_DENIED' })
})
test('owner-pinned endpoint cannot redirect and request cannot substitute its grant', async () => {
  let observed
  const g = grant(), wireDetail = { complete: true, currentStatusVerified: true, eventsComplete: true, status: g.status, grantTxid: g.txid, walletAddress: g.walletAddress, network: g.network, policy: g.policy, permission: { txid: g.txid, walletAddress: g.walletAddress }, currentPermission: { headTxid: g.headTxid, walletAddress: g.walletAddress }, evidence: { ...g.evidence, verifiedAt: new Date(g.evidence.verifiedAt).toISOString() }, tip: g.evidence.tip }
  const reader = new CanonicalPolicyApi({ fetchImpl: async (url, options) => { observed = { url: url.href, options }; return new Response(JSON.stringify(wireDetail), { status: 200 }) } })
  assert.deepEqual(await reader.read(config()), grant()); assert.equal(new URL(observed.url).searchParams.get('txid'), config().grantTxid); assert.equal(observed.options.redirect, 'error')
  for (const base of ['http://example.com', 'http://localhost:8081', 'https://user:pass@example.com', 'https://example.com/arbitrary']) assert.throws(() => normalizeConfig({ ...config(), policyApiBase: base }))
})
test('keyring secret access is unavailable without independent isolation and exact transaction consent', async () => {
  const keyring = new SecretServiceReferenceAdapter(config())
  await assert.rejects(keyring.withUnlockSecret({}, () => assert.fail('No secret must be fetched')), { code: 'SECRET_ACCESS_NOT_AUTHORIZED' })
})
test('disabled signing grant and absent WORK restrictions deny actions before planning', async () => {
  const { controller, ledger } = setup({ read: async () => ({ ...grant(), policy: { ...policy(), signingEnabled: false } }) })
  await assert.rejects(controller.plan(request()), { code: 'GRANT_SIGNING_DISABLED' }); ledger.close()
  const next = setup(); await assert.rejects(next.controller.plan({ operationId: 'work_fixture_0001', action: 'amo.listwork', payload: { faceProofs: '25000' } }), { code: 'WORK_ACTION_DENIED' }); next.ledger.close()
})
