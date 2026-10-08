import { createHash } from 'node:crypto';
import { workAmoV5CanonicalPayloadCommitment } from './work-amo-v5.mjs';
import { PERMISSION_ACTIVATION_HEIGHT, PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH } from '../src/shared/protocol/permissions.mjs';
import { permissionCandidateParts, permissionReadError } from './permissions.mjs';

const prefixHex = Buffer.from('pwm1:m:pwperm1:').toString('hex');
const TXID = /^[0-9a-f]{64}$/u;
const key = record => [record.txid, record.position?.protocolVout ?? record.protocolVout, record.position?.recordOrdinal ?? record.recordOrdinal].join(':');
const commit = value => workAmoV5CanonicalPayloadCommitment(value);
const same = (left, right) => left?.model === right?.model && left?.sha256 === right?.sha256 && left?.payloadBytes === right?.payloadBytes;
export function permissionCandidates(records) {
  return records.filter(record => record.protocol === 'pwm1' && record.rawRecordParts?.some(part => String(part.payloadHex ?? '').startsWith(prefixHex)));
}
/** Keep all raw ledger commitments; retain hydrated bodies only for Permission candidates. */
export function permissionCoreBlockWitness(envelope, transactions, { blockHeight, blockHash } = {}) {
  const candidates = permissionCandidates(envelope.records), byTxid = new Map(transactions.map(tx => [tx.txid, tx]));
  if (byTxid.size !== transactions.length || candidates.length !== transactions.length || candidates.some(record => {
    const tx = byTxid.get(record.txid);
    const expected = record.rawRecordParts.filter(part => String(part.payloadHex ?? '').startsWith(prefixHex));
    const physical = tx ? permissionCandidateParts(tx) : [];
    return !tx || tx.status?.confirmed !== true || !Number.isSafeInteger(blockHeight) || !TXID.test(blockHash ?? '') ||
      tx.status.block_height !== blockHeight || tx.status.block_hash !== blockHash || tx.blockTransactionIndex !== record.blockTransactionIndex ||
      physical.length !== expected.length || physical.some((part, index) => part.vout !== (expected[index].protocolVout ?? expected[index].vout) || part.decoded.scriptPubKeyHex !== expected[index].scriptPubKeyHex);
  })) throw permissionReadError('Permission Core candidate hydration is incomplete.');
  return { descriptor: { ...envelope.blockDescriptorCommitment }, rawProtocolCandidateCount: envelope.rawProtocolCandidateCount,
    rawRecords: envelope.records.map(record => ({ key: key(record), protocol: record.protocol,
      txIndex: record.blockTransactionIndex, rawWitness: commit(record.payload) })), transactions };
}
export function assertPermissionRawBlockCoverage(row, core) {
  const payload = row?.payload, records = payload?.replayRecords;
  if (!Array.isArray(records) || !same(commit(records), payload.replayDescriptorCommitment) ||
      !same(core?.descriptor, payload.blockDescriptorCommitment) ||
      Number(row.raw_protocol_candidate_count) !== core?.rawProtocolCandidateCount || Number(payload.rawProtocolCandidateCount) !== core?.rawProtocolCandidateCount) throw permissionReadError('Permission raw descriptor differs from complete Core block evidence.');
  const raw = records.filter(record => record?.rawCandidate === true), remaining = new Map(core.rawRecords.map(record => [record.key, record]));
  if (remaining.size !== core.rawRecords.length || raw.length !== core.rawRecords.length || Number(row.protocol_record_count) !== raw.length) throw permissionReadError('Permission raw ledger carrier set is incomplete.');
  for (const record of raw) {
    const expected = remaining.get(key(record));
    if (!expected || record.protocol !== expected.protocol || record.position?.blockHeight !== Number(row.height) ||
        record.position?.blockHash !== row.block_hash || record.position?.blockTransactionIndex !== expected.txIndex ||
        !same(commit(record.rawWitness), expected.rawWitness)) throw permissionReadError('Permission indexed raw bytes or positions differ from Core.');
    remaining.delete(key(record));
  }
  if (remaining.size) throw permissionReadError('Permission Core carrier was omitted from the index.');
  return core.transactions;
}

/** Independent complete first-party Core verification; no feed, search or local marker proves authority. */
export function createPermissionDiscovery({ readIndex, readCoreBlock, readCoreHash, hydratePending,
  maxCacheBytes = 128 * 1024 * 1024, maxProjectionBytes = 64 * 1024 * 1024, readBudgetMs = 25000, now = () => Date.now() }) {
  const blocks = new Map(), inFlight = new Map(), reads = new Map(), prefixes = new Map();
  let cacheBytes = 0;
  async function block(row) {
    const id = `${row.height}:${row.block_hash}`;
    if (blocks.has(id)) return blocks.get(id);
    if (!inFlight.has(id)) inFlight.set(id, Promise.resolve(readCoreBlock(row)).then(witness => {
      const size = Buffer.byteLength(JSON.stringify(witness));
      if (cacheBytes + size > maxCacheBytes) throw permissionReadError('Permission immutable Core cache reached its byte budget.');
      cacheBytes += size; blocks.set(id, witness); return witness;
    }).finally(() => inFlight.delete(id)));
    return inFlight.get(id);
  }
  async function read(network, checkpoint, activationHeight, parentHash) {
    if (network !== 'livenet' || !Number.isSafeInteger(activationHeight) || activationHeight < 1 || !TXID.test(parentHash) ||
        !Number.isSafeInteger(checkpoint?.height) || checkpoint.height < activationHeight - 1 || !TXID.test(checkpoint?.blockHash) || typeof readCoreHash !== 'function') throw permissionReadError('Permission discovery requires a pinned first-admission boundary and exact checkpoint.');
    const deadline = now() + readBudgetMs, budget = () => { if (now() > deadline) throw permissionReadError('Permission verification exceeded its read budget; retry to continue catch-up.'); };
    if (await readCoreHash(activationHeight - 1, network) !== parentHash || await readCoreHash(checkpoint.height, network) !== checkpoint.blockHash) throw permissionReadError('Permission activation parent or checkpoint is no longer canonical.');
    const scope = `${network}:${activationHeight}:${parentHash}`;
    let prefix = prefixes.get(scope);
    if (prefix && (prefix.height > checkpoint.height || await readCoreHash(prefix.height, network) !== prefix.blockHash)) { prefixes.delete(scope); prefix = null; }
    const confirmed = prefix ? [...prefix.transactions] : [];
    let bytes = prefix?.projectionBytes ?? 0, next = prefix ? prefix.height + 1 : activationHeight, previousHash = prefix?.blockHash ?? parentHash;
    const coverage = await readIndex(network, { activationHeight, activationPreviousBlockHash: parentHash, expectedHeight: checkpoint.height, expectedHash: checkpoint.blockHash,
      ...(prefix ? { fromHeight: prefix.height + 1, verifiedPrefix: { height: prefix.height, blockHash: prefix.blockHash, witnessSha256: prefix.witnessSha256 } } : {}),
      async onBlock(row) {
        budget();
        if (Number(row.height) !== next || row.previous_block_hash !== previousHash || !TXID.test(row.block_hash)) throw permissionReadError('Permission discovery block sequence has a gap or fork.');
        const transactions = assertPermissionRawBlockCoverage(row, await block(row));
        budget(); bytes += Buffer.byteLength(JSON.stringify(transactions));
        if (bytes > maxProjectionBytes) throw permissionReadError('Permission projection reached its byte budget.');
        confirmed.push(...transactions); previousHash = row.block_hash; next += 1;
      } });
    if (coverage?.complete !== true || coverage.indexedThroughBlock !== checkpoint.height || coverage.checkpointHash !== checkpoint.blockHash ||
        coverage.activationHeight !== activationHeight || coverage.activationPreviousBlockHash !== parentHash ||
        coverage.blockCount !== checkpoint.height - activationHeight + 1 || next !== checkpoint.height + 1 || previousHash !== checkpoint.blockHash || !TXID.test(coverage.witnessSha256)) throw permissionReadError('Permission discovery lacks complete exact checkpoint coverage.');
    budget();
    if (await readCoreHash(activationHeight - 1, network) !== parentHash || await readCoreHash(checkpoint.height, network) !== checkpoint.blockHash) throw permissionReadError('Permission Core checkpoint changed during discovery.', 409, 'PERMISSION_CHECKPOINT_REORG');
    const prior = prefixes.get(scope);
    if (!prior || prior.height <= checkpoint.height) prefixes.set(scope, { height: checkpoint.height, blockHash: checkpoint.blockHash,
      witnessSha256: coverage.witnessSha256, projectionBytes: bytes, transactions: [...confirmed] });
    const pending = [], pendingWarnings = [];
    for (const txid of coverage.pendingTxids ?? []) {
      if (now() > deadline) break;
      try {
        const transactions = await hydratePending(txid, network), size = Buffer.byteLength(JSON.stringify(transactions));
        if (!Array.isArray(transactions) || transactions.some(tx => tx.txid !== txid || tx.status?.confirmed === true)) throw new Error('pending identity');
        if (bytes + size <= maxProjectionBytes) { pending.push(...transactions); bytes += size; }
      } catch { pendingWarnings.push({ txid, reason: 'pending-raw-evidence-unavailable' }); }
    }
    return { transactions: [...confirmed, ...pending], pendingWarnings,
      coverage: { ...coverage, pendingTxids: undefined, model: 'permission-core-raw-block-coverage-v1',
        permissionSha256: createHash('sha256').update(JSON.stringify(confirmed)).digest('hex') } };
  }
  return async function discover(network, checkpoint, activationHeight = PERMISSION_ACTIVATION_HEIGHT, parentHash = PERMISSION_ACTIVATION_PREVIOUS_BLOCK_HASH) {
    const scope = `${network}:${activationHeight}:${parentHash}:${checkpoint?.height}:${checkpoint?.blockHash}`;
    if (!reads.has(scope)) reads.set(scope, read(network, checkpoint, activationHeight, parentHash).finally(() => reads.delete(scope)));
    return reads.get(scope);
  };
}
