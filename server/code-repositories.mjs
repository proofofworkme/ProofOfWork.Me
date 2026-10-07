import { createHash } from 'node:crypto';
import { replayCodeTransactions } from '../src/shared/protocol/codeRepository.mjs';
import { decodeCanonicalOpReturnOutput } from './canonical-op-return.mjs';

export const CODE_DISCOVERY_MODEL = 'canonical-code-candidate-discovery-v1';
export const CODE_DISCOVERY_META_KEY = 'code:candidate-discovery';
export const CODE_SNAPSHOT_MODEL = 'proof-code-snapshot-v1';
export const CODE_DISCOVERY_EMPTY_SHA256 = createHash('sha256').update('ProofOfWork.Me/Code/candidate-discovery/v1\n').digest('hex');
const TXID = /^[0-9a-f]{64}$/u;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const CODE_RAW_BLOCK_MAX_BYTES = 8_000_000;
const CODE_RAW_ZERO_HASH = Buffer.alloc(32);
function codeRawHash256(parts) {
  const first = createHash('sha256');
  for (const part of parts) first.update(part);
  return createHash('sha256').update(first.digest()).digest();
}

/**
 * Negative discovery admission for authenticated first-party Core getblock(0).
 * Body/consensus authority remains Core's, as in the getblock(2) scanner. This
 * checks header hash/parent and complete canonical transaction framing; it does
 * not independently verify transaction Merkle or witness commitments. A positive
 * must use getblock(2), exact candidate parity and the existing hydration/seals.
 */
export function prefilterCodeRawBlock(rawHex, { blockHash, previousBlockHash, candidatePredicate = decoded => decoded.prefix === 'pwc1:' } = {}) {
  const refuse = detail => { throw new Error(`Code Core raw block admission failed: ${detail}.`); };
  if (!TXID.test(blockHash ?? '') || !TXID.test(previousBlockHash ?? '')) refuse('exact hash and parent required');
  if (typeof rawHex !== 'string' || rawHex.length < 162 || rawHex.length > CODE_RAW_BLOCK_MAX_BYTES * 2 || rawHex.length % 2) refuse('invalid or oversized hex');
  const raw = Buffer.from(rawHex, 'hex');
  // Buffer's decoder can silently stop at invalid hex; exact reencoding closes
  // that behavior without a costly grouped regexp over the entire block body.
  if (raw.length * 2 !== rawHex.length || raw.toString('hex') !== rawHex) refuse('noncanonical hex');
  if (codeRawHash256([raw.subarray(0, 80)]).reverse().toString('hex') !== blockHash) refuse('header hash differs');
  const parent = Buffer.from(raw.subarray(4, 36)).reverse().toString('hex');
  if (parent !== previousBlockHash) refuse('parent differs');
  let offset = 80;
  function take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || offset + length > raw.length) refuse('truncated framing');
    const bytes = raw.subarray(offset, offset + length); offset += length; return bytes;
  }
  function compactSize() {
    const tag = take(1)[0];
    if (tag < 253) return tag;
    const size = tag === 253 ? 2 : tag === 254 ? 4 : 8;
    const bytes = take(size);
    const value = size === 2 ? BigInt(bytes.readUInt16LE()) : size === 4 ? BigInt(bytes.readUInt32LE()) : bytes.readBigUInt64LE();
    if (value < (size === 2 ? 253n : size === 4 ? 65536n : 4294967296n) || value > BigInt(Number.MAX_SAFE_INTEGER)) refuse('noncanonical CompactSize');
    return Number(value);
  }
  function count(minimumBytes, label, allowZero = false) {
    const value = compactSize();
    if ((!allowZero && value === 0) || value > Math.floor((raw.length - offset) / minimumBytes)) refuse(`impossible ${label} count`);
    return value;
  }
  const transactionCount = count(60, 'transaction');
  const candidates = [];
  for (let transactionIndex = 0; transactionIndex < transactionCount; transactionIndex++) {
    const version = take(4); let witness = false;
    if (raw[offset] === 0) {
      take(1); if (take(1)[0] !== 1) refuse('unsupported witness flags'); witness = true;
    }
    const strippedStart = offset;
    const inputs = count(41, 'input');
    for (let i = 0; i < inputs; i++) {
      const outpoint = take(36);
      const coinbase = outpoint.subarray(0, 32).equals(CODE_RAW_ZERO_HASH) && outpoint.readUInt32LE(32) === 0xffffffff;
      if ((transactionIndex === 0 && (inputs !== 1 || !coinbase)) || (transactionIndex > 0 && coinbase)) refuse('coinbase placement');
      take(compactSize()); take(4);
    }
    const outputs = count(9, 'output');
    const transactionCandidates = [];
    for (let vout = 0; vout < outputs; vout++) {
      take(8); const script = take(compactSize());
      if (script[0] !== 0x6a) continue;
      const scriptPubKeyHex = script.toString('hex');
      const decoded = decodeCanonicalOpReturnOutput({ scriptPubKey: { hex: scriptPubKeyHex } });
      if (candidatePredicate(decoded)) transactionCandidates.push({ transactionIndex, vout, scriptPubKeyHex });
    }
    const strippedEnd = offset;
    if (witness) {
      let present = false;
      for (let i = 0; i < inputs; i++) {
        const items = count(1, 'witness item', true); if (items) present = true;
        for (let j = 0; j < items; j++) take(compactSize());
      }
      if (!present) refuse('superfluous witness record');
    }
    const locktime = take(4);
    if (transactionCandidates.length) {
      const txid = codeRawHash256([version, raw.subarray(strippedStart, strippedEnd), locktime]).reverse().toString('hex');
      candidates.push(...transactionCandidates.map(candidate => ({ ...candidate, txid })));
    }
  }
  if (offset !== raw.length) refuse('trailing block bytes');
  return { blockHash, previousBlockHash: parent, time: raw.readUInt32LE(68), transactionCount, candidates,
    noCodeCandidates: candidates.length === 0, bodyAuthority: 'authenticated-first-party-core', transactionRootsVerified: false };
}

/** Bind every physical candidate in a positive raw prefilter to Core's JSON. */
export function assertCodeRawBlockCandidatesMatch(prefilter, block, candidatePredicate = decoded => decoded.prefix === 'pwc1:') {
  if (block?.hash !== prefilter.blockHash || block.previousblockhash !== prefilter.previousBlockHash ||
      Number(block.time) !== prefilter.time || Number(block.nTx) !== prefilter.transactionCount ||
      !Array.isArray(block.tx) || block.tx.length !== prefilter.transactionCount) throw new Error('Code Core raw/decoded block envelope differs.');
  const candidates = block.tx.flatMap((tx, transactionIndex) => (tx.vout ?? []).flatMap((output, vout) => {
    const decoded = decodeCanonicalOpReturnOutput(output);
    return candidatePredicate(decoded) ? [{ transactionIndex, vout, txid: tx.txid, scriptPubKeyHex: decoded.scriptPubKeyHex }] : [];
  }));
  if (!prefilter.candidates.length || candidates.length !== prefilter.candidates.length || candidates.some((candidate, index) => {
    const expected = prefilter.candidates[index];
    return candidate.transactionIndex !== expected.transactionIndex || candidate.vout !== expected.vout ||
      candidate.txid !== expected.txid || candidate.scriptPubKeyHex !== expected.scriptPubKeyHex;
  })) throw new Error('Code Core raw/decoded candidate positions or scripts differ.');
}
export function exactCodeOutputProofs(output) {
  const supplied = output?.valueSats;
  if (supplied !== undefined || !output?.scriptPubKey) {
    const value = supplied ?? output?.value ?? output?.proofs;
    if ((typeof value === 'number' && !Number.isSafeInteger(value)) || !/^(?:0|[1-9]\d*)$/u.test(String(value))) return null;
    return BigInt(value) <= 2_100_000_000_000_000n ? String(value) : null;
  }
  const text = String(output.value);
  const decimal = /^(0|[1-9]\d*)(?:\.(\d+))?(?:e(-?\d{1,2}))?$/u.exec(text);
  if (!decimal) return null;
  const fraction = decimal[2] ?? '';
  const scale = 8 + Number(decimal[3] ?? 0) - fraction.length;
  if (scale < 0 || scale > 30) return null;
  const proofs = BigInt(decimal[1] + fraction) * 10n ** BigInt(scale);
  return proofs <= 2_100_000_000_000_000n ? proofs.toString() : null;
}
export function advanceCodeCandidateDigest(prior, tx) {
  const candidates = tx.vout.map((output, vout) => ({ vout, decoded: decodeCanonicalOpReturnOutput(output) }))
    .filter(item => item.decoded.prefix === 'pwc1:').map(item => ({ vout: item.vout, script: item.decoded.scriptPubKeyHex }));
  return sha256(Buffer.from(JSON.stringify({ prior, txid: tx.txid, height: tx.status?.block_height ?? tx.height,
    hash: tx.status?.block_hash ?? tx._powBlockHash, index: tx.blockTransactionIndex ?? tx._powBlockIndex, candidates })));
}
export function codeCandidateEventClosure(tx, rows, position, transition) {
  if (!transition || Number(transition.block_height) !== position.blockHeight || transition.block_hash !== position.blockHash) return false;
  const candidates = tx.vout.map((output, vout) => ({ vout, decoded: decodeCanonicalOpReturnOutput(output) }))
    .filter(item => item.decoded.prefix === 'pwc1:');
  const records = rows.filter(row => row.txid === tx.txid && row.protocol === 'pwc1');
  const witnesses = (transition.payload?.replayRecords ?? []).filter(record => record.txid === tx.txid && record.protocol === 'pwc1' && record.rawCandidate === true);
  if (!candidates.length || records.length !== candidates.length || witnesses.length !== candidates.length) return false;
  return candidates.every(({ vout, decoded }) => records.some(row => row.status === 'confirmed' &&
    Number(row.block_height) === position.blockHeight && Number(row.block_index) === position.blockTransactionIndex &&
    Number(row.op_return_vout) === vout && Number(row.record_ordinal) === 0 && row.raw_payload === decoded.text &&
    row.payload?._workAmoV5ReplayBound === true && row.payload?.workAmoV5RawCandidate === true &&
    row.payload?.workAmoV5RawScriptWitness?.scriptPubKeyHex === decoded.scriptPubKeyHex &&
    row.payload?.workAmoV5ReplayOutcome?.valid === row.valid &&
    row.payload?.workAmoV5ReplayOutcome?.kind === `pwc1-${row.valid ? 'valid' : 'invalid'}` &&
    witnesses.some(witness => witness.position?.blockHeight === position.blockHeight && witness.position?.blockHash === position.blockHash &&
      witness.position?.blockTransactionIndex === position.blockTransactionIndex && witness.position?.protocolVout === vout && witness.position?.recordOrdinal === 0 &&
      witness.outcome?.valid === row.valid && witness.outcome?.kind === row.payload.workAmoV5ReplayOutcome.kind &&
      witness.rawWitness?.rawRecordParts?.length === 1 && witness.rawWitness.rawRecordParts[0].scriptPubKeyHex === decoded.scriptPubKeyHex)));
}
export function codeReadError(message, statusCode = 503, code = 'CODE_UNAVAILABLE') {
  return Object.assign(new Error(message), { statusCode, details: { code } });
}
function token(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function decodeToken(value) {
  try {
    if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (token(parsed) !== value) throw new Error();
    return parsed;
  } catch { throw codeReadError('Code continuation is invalid; restart the repository read.', 400, 'CODE_CURSOR_INVALID'); }
}
export function codeSnapshotRequest(params, network) {
  const cursor = params.get('cursor');
  const continuation = cursor ? decodeToken(cursor) : null;
  const explicit = params.get('snapshot');
  const snapshot = continuation?.snapshot ?? (explicit ? decodeToken(explicit) : null);
  if (snapshot && (snapshot.model !== CODE_SNAPSHOT_MODEL || snapshot.network !== network ||
      !Number.isSafeInteger(snapshot.checkpointHeight) || snapshot.checkpointHeight < 1 || !TXID.test(snapshot.checkpointHash))) {
    throw codeReadError('Code snapshot is invalid.', 400, 'CODE_SNAPSHOT_INVALID');
  }
  if (continuation && (!Number.isSafeInteger(continuation.offset) || continuation.offset < 0)) {
    throw codeReadError('Code cursor offset is invalid.', 400, 'CODE_CURSOR_INVALID');
  }
  if (explicit && continuation && token(snapshot) !== explicit) throw codeReadError('Code cursor and snapshot differ.', 400, 'CODE_CURSOR_INVALID');
  return { snapshot, continuation };
}
function eventSummary(event) {
  const { source, ...rest } = event;
  return { ...rest, ...(event.metadata ?? {}), parent: event.parentTxid,
    reason: (event.validationErrors ?? []).join('; '),
    ...(source ? { sha256: source.sha256, size: source.size } : {}) };
}
function repositorySummary(repo) {
  const { files, commits, ...rest } = repo;
  return { ...rest, fileCount: files.length, commitCount: commits.filter(event => event.kind === 'code-commit' && event.applied).length };
}
export function createCodeSnapshot({ network, checkpointHeight, checkpointHash, transactions, generatedAt }, replay = replayCodeTransactions) {
  if (!Number.isSafeInteger(checkpointHeight) || checkpointHeight < 1 || !TXID.test(checkpointHash)) throw codeReadError('Code has no exact canonical checkpoint.');
  const snapshot = { model: CODE_SNAPSHOT_MODEL, network, checkpointHeight, checkpointHash };
  const confirmed = transactions.filter(tx => tx.status?.confirmed === true).sort((a, b) =>
    a.status.block_height - b.status.block_height || a.blockTransactionIndex - b.blockTransactionIndex);
  const result = replay(confirmed, { sha256 });
  const observed = replay(transactions, { sha256 });
  const byTxid = new Map(confirmed.map(tx => [tx.txid, tx]));
  for (const event of result.events) {
    const tx = byTxid.get(event.txid);
    event.rawEvidence = { outputs: tx.vout.map((output, vout) => {
      const decoded = decodeCanonicalOpReturnOutput(output);
      return { vout, candidate: decoded.candidate, prefix: decoded.prefix, scriptPubKeyHex: decoded.scriptPubKeyHex,
        decodeValid: decoded.decodeValid, reasonCode: decoded.reasonCode };
    })
      .filter(output => output.candidate), blockHeight: tx.status.block_height, blockHash: tx.status.block_hash,
      blockTransactionIndex: tx.blockTransactionIndex };
  }
  return { ...result, pendingEvents: observed.events.filter(event => !event.confirmed),
    transactions: byTxid,
    snapshot: { ...snapshot, id: token(snapshot) }, generatedAt };
}
function page(items, params, state, scope) {
  const { continuation } = codeSnapshotRequest(params, state.snapshot.network);
  const limitText = params.get('limit') ?? '50';
  if (!/^[1-9]\d{0,2}$/u.test(limitText) || Number(limitText) > 200) throw codeReadError('Code page limit must be from 1 to 200.', 400, 'CODE_LIMIT_INVALID');
  const limit = Number(limitText);
  const offset = continuation?.offset ?? 0;
  if (continuation && continuation.scope !== scope) throw codeReadError('Code cursor belongs to another query.', 400, 'CODE_CURSOR_SCOPE');
  if (offset > items.length) throw codeReadError('Code cursor exceeds the snapshot.', 400, 'CODE_CURSOR_INVALID');
  const values = items.slice(offset, offset + limit);
  const hasMore = offset + values.length < items.length;
  const { id, ...snapshot } = state.snapshot;
  return { values, pagination: { limit, total: items.length, hasMore,
    nextCursor: hasMore ? token({ snapshot, scope, offset: offset + values.length }) : null } };
}
function envelope(state) {
  return { network: state.snapshot.network, snapshot: state.snapshot,
    snapshotId: state.snapshot.id, indexedThroughBlock: state.snapshot.checkpointHeight,
    indexedThroughBlockHash: state.snapshot.checkpointHash, checkpointHash: state.snapshot.checkpointHash,
    generatedAt: state.generatedAt, source: 'proof-indexer-exact-canonical-code-replay', complete: true,
    pendingComplete: false, pendingBestEffort: true, pendingWarnings: state.pendingWarnings ?? [] };
}
export function codeRepositoriesPayload(state, params = new URLSearchParams()) {
  const owner = params.get('owner') ?? '';
  const q = (params.get('q') ?? '').toLowerCase();
  const items = state.repositories.filter(repo => (!owner || repo.ownerAddress === owner) &&
    (!q || `${repo.name}\n${repo.description}\n${repo.ownerAddress}`.toLowerCase().includes(q)))
    .map(repositorySummary);
  const pagination = page(items, params, state, JSON.stringify(['repositories', owner, q]));
  const repositories = new Set(state.repositories.map(repo => repo.txid));
  return { ...envelope(state), repositories: pagination.values, pagination: pagination.pagination,
    stats: { repositories: state.repositories.length,
      acceptedCommits: state.events.filter(event => event.kind === 'code-commit' && event.applied).length,
      unappliedCommits: state.events.filter(event => event.kind === 'code-commit' && !event.applied).length,
      files: state.repositories.reduce((total, repo) => total + repo.files.length, 0) },
    invalidEvents: state.events.filter(event => !event.valid && !repositories.has(event.repoTxid)).map(eventSummary),
    pendingEvents: state.pendingEvents.map(eventSummary) };
}
export function qualifyCodeLogPayload(payload, events, checkpoint) {
  const byTxid = new Map(events.map(event => [event.txid, event]));
  const qualify = item => {
    if (item?.protocol !== 'pwc1') return item;
    const authority = byTxid.get(item.txid);
    if (!authority) return { ...item, applied: false, codeAuthority: { ready: false, reason: 'code-candidate-not-in-snapshot' } };
    if (!authority.confirmed) return { ...item, applied: false, codeAuthority: { ready: false, reason: 'pending-best-effort' } };
    return { ...item, structuralValid: item.valid, valid: authority.valid, applied: authority.applied,
      validationErrors: authority.validationErrors, reason: authority.validationErrors.join('; '),
      codeAuthority: { ready: true, model: 'canonical-code-repository-head-replay-v1', ...checkpoint } };
  };
  return { ...payload,
    ...(Array.isArray(payload?.items) ? { items: payload.items.map(qualify) } : {}),
    ...(Array.isArray(payload?.events) ? { events: payload.events.map(qualify) } : {}),
    ...(Array.isArray(payload?.activity) ? { activity: payload.activity.map(qualify) } : {}) };
}
export function codeRepositoryPayload(state, params = new URLSearchParams()) {
  const repoTxid = params.get('repo') ?? '';
  if (!TXID.test(repoTxid)) throw codeReadError('Code repository must be its creation transaction ID.', 400, 'CODE_REPOSITORY_INVALID');
  const repo = state.repositories.find(item => item.txid === repoTxid);
  if (!repo) throw codeReadError('Repository is absent from this confirmed snapshot.', 404, 'CODE_REPOSITORY_NOT_FOUND');
  const version = params.get('version') ?? repo.headTxid;
  const event = state.events.find(item => item.txid === version && item.applied && item.repoTxid === repoTxid);
  if (version !== repoTxid && !event) throw codeReadError('Revision is not an accepted repository version.', 404, 'CODE_VERSION_NOT_FOUND');
  // Replay the immutable accepted prefix for historical trees, retaining every
  // candidate through the requested canonical position for conflict evidence.
  const versionTransactions = [...state.transactions.values()];
  const versionIndex = versionTransactions.findIndex(tx => tx.txid === version);
  if (versionIndex < 0) throw codeReadError('Revision raw transaction is unavailable.');
  const historical = replayCodeTransactions(versionTransactions.slice(0, versionIndex + 1), { sha256 })
    .repositories.find(item => item.txid === repoTxid);
  if (!historical) throw codeReadError('Revision cannot be verified against raw evidence.');
  const history = state.events.filter(item => item.repoTxid === repoTxid).map(eventSummary);
  const paged = page(history, params, state, JSON.stringify(['repository', repoTxid, version]));
  const files = historical.files.map(({ content, data, ...file }) => file);
  const result = { ...envelope(state), repository: repositorySummary(repo), version,
    files, filesComplete: true, commits: paged.values, events: paged.values,
    pagination: paged.pagination, pendingEvents: state.pendingEvents.filter(item => item.repoTxid === repoTxid).map(eventSummary) };
  if (params.has('path')) {
    const path = params.get('path');
    const file = historical.files.find(item => item.path === path);
    if (!file) return { ...result, file: null };
    const tx = state.transactions.get(file.txid);
    const bytes = Buffer.from(file.data ?? '', 'base64url');
    if (!tx || bytes.length !== file.size || sha256(bytes) !== file.sha256 ||
        new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(bytes) !== file.content) throw codeReadError('Source bytes do not match their chain evidence.');
    result.file = { ...file, contentBase64: bytes.toString('base64'), verified: true,
      evidence: { txid: tx.txid, blockHeight: tx.status.block_height, blockHash: tx.status.block_hash,
        blockTransactionIndex: tx.blockTransactionIndex,
        outputs: tx.vout.map((output, vout) => ({ vout, ...decodeCanonicalOpReturnOutput(output) })) } };
  }
  return result;
}
