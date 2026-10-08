import { DatabaseSync } from 'node:sqlite'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { canonical, fail, integer } from './schema.mjs'

const OUTSTANDING = new Set(['reserved', 'signing', 'signed', 'broadcast_unknown', 'pending'])
export const utcDay = now => new Date(now).toISOString().slice(0, 10)

/** All controllers for one wallet MUST share this same durable database. */
export class PermissionLedger {
  constructor(path, binding) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const dir = lstatSync(dirname(path))
      if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) || dir.uid !== process.getuid()) fail('UNSAFE_STATE_DIRECTORY')
      try { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) fail('UNSAFE_STATE_FILE') } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), wallet TEXT NOT NULL, network TEXT NOT NULL, script TEXT NOT NULL, latest_day TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (request_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, grant_txid TEXT NOT NULL, authorized_day TEXT NOT NULL, settled_day TEXT, cost TEXT NOT NULL, status TEXT NOT NULL, template_digest TEXT NOT NULL, transaction_id TEXT, evidence TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY, request_id TEXT NOT NULL, event TEXT NOT NULL, details TEXT NOT NULL);`)
    this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM binding WHERE id=1').get()
      if (previous && (previous.wallet !== binding.walletAddress || previous.network !== binding.network || previous.script !== binding.walletScriptPubKey)) fail('IMMUTABLE_WALLET_BINDING_MISMATCH')
      if (!previous) this.db.prepare('INSERT INTO binding VALUES(1,?,?,?,?)').run(binding.walletAddress, binding.network, binding.walletScriptPubKey, '')
    })
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  #day(now, update = false) {
    const day = utcDay(now)
    const latest = this.db.prepare('SELECT latest_day FROM binding WHERE id=1').get().latest_day
    if (day < latest) fail('CLOCK_ROLLBACK')
    if (update) this.db.prepare('UPDATE binding SET latest_day=? WHERE id=1').run(day)
    return day
  }
  usage(now) {
    const day = this.#day(now)
    const rows = this.db.prepare('SELECT cost,status,authorized_day,settled_day FROM requests').all()
    let outstanding = 0n, spent = 0n
    for (const row of rows) {
      if (OUTSTANDING.has(row.status)) outstanding += integer(row.cost)
      else if (row.status === 'confirmed' && (row.authorized_day === day || row.settled_day === day)) spent += integer(row.cost)
    }
    return { utcDay: day, committedProofs: outstanding.toString(), spentProofs: spent.toString(), usedProofs: (outstanding + spent).toString() }
  }
  get(id) { return this.db.prepare('SELECT * FROM requests WHERE request_id=?').get(id) || null }
  byOperation(id) { return this.db.prepare('SELECT * FROM requests WHERE operation_id=?').get(id) || null }
  reserve({ id, operationId, requestHash, grantTxid, cost, templateDigest, evidence, dailyLimit, now }) {
    return this.transaction(() => {
      this.#day(now, true)
      const previous = this.byOperation(operationId)
      if (previous) {
        if (previous.request_id !== id || previous.request_hash !== requestHash) fail('IDEMPOTENCY_CONFLICT')
        return { row: previous, created: false }
      }
      const used = integer(this.usage(now).usedProofs)
      if (used + integer(cost) > integer(dailyLimit)) fail('DAILY_LIMIT_EXCEEDED')
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,NULL,?,?,?,NULL,?)').run(id, operationId, requestHash, grantTxid, utcDay(now), cost, 'reserved', templateDigest, canonical(evidence))
      this.db.prepare('INSERT INTO audit(request_id,event,details) VALUES(?,?,?)').run(id, 'reserved', canonical({ cost, grantTxid, templateDigest, day: utcDay(now) }))
      return { row: this.get(id), created: true }
    })
  }
  transition(id, from, to, { transactionId = null, evidence = {}, now = Date.now() } = {}) {
    const transitions = { reserved: ['signing', 'released_unsigned'], signing: ['signed', 'broadcast_unknown'], signed: ['broadcast_unknown'], broadcast_unknown: ['pending', 'confirmed'], pending: ['confirmed'] }
    if (!transitions[from]?.includes(to)) fail('INVALID_LEDGER_TRANSITION')
    return this.transaction(() => {
      const row = this.get(id)
      if (!row || row.status !== from) fail('REQUEST_STATE_CONFLICT')
      if (transactionId && row.transaction_id && row.transaction_id !== transactionId) fail('TRANSACTION_ID_CONFLICT')
      this.#day(now, true)
      this.db.prepare('UPDATE requests SET status=?,transaction_id=COALESCE(?,transaction_id),settled_day=?,evidence=? WHERE request_id=?').run(to, transactionId, to === 'confirmed' ? utcDay(now) : row.settled_day, canonical(evidence), id)
      this.db.prepare('INSERT INTO audit(request_id,event,details) VALUES(?,?,?)').run(id, to, canonical({ transactionId, evidence }))
      return this.get(id)
    })
  }
  close() { this.db.close() }
}
