import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { permissionBlockWitnessSeed, permissionBlockWitnessNext, permissionIndexWitnessSeed, permissionIndexWitnessNext } from './db/permission-reader.mjs';

const FORMAT = 'permission-verified-journal-v1';
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const requireValid = (value, reason) => { if (!value) throw new Error(`Permission durable verification unavailable: ${reason}`); };

// These are service-authenticated verification receipts, not imported chain
// authority. The private key belongs to this node, never a wallet. Restores must
// retain that key and its receipts together; index/Core binding is still live.
export function createPermissionVerificationStore({ directory, verifierVersion = 1,
  maxBytes = 96 * 1024 * 1024, maxProjectionBytes = 64 * 1024 * 1024,
  beforeRename = async () => {}, readOnly = false,
}) {
  const root = path.resolve(directory);
  let initialized;
  const scopes = new Map();
  const stateName = (scope, generation = 0) => path.join(root,
    `permission-${scope.network}-${scope.activationHeight}${generation ? `.replay-${generation}` : ''}.json`);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  // Lock the directory inode. The kernel releases the advisory lock even on process death.
  async function locked(fn) {
    requireValid(!readOnly, 'read-only journal');
    const handle = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      await new Promise((resolve, reject) => {
        const lock = spawn('/usr/bin/flock', ['-x', '-w', '5', '3'], { stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
        lock.once('error', reject);
        lock.once('exit', code => code === 0 ? resolve() : reject(new Error('Permission journal writer busy')));
      });
      return await fn();
    } finally { await handle.close(); }
  }
  async function safeRead(file, limit) {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      requireValid(info.isFile() && info.nlink === 1 && info.uid === process.getuid() &&
        (info.mode & 0o077) === 0 && info.size <= limit, 'unsafe checkpoint file');
      const bytes = await handle.readFile();
      requireValid(bytes.length <= limit, 'checkpoint byte budget exceeded');
      return bytes;
    } finally { await handle.close(); }
  }
  async function syncDirectory() {
    const handle = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  async function init() {
    if (!initialized) initialized = (async () => {
      if (!readOnly) await fs.mkdir(root, { mode: 0o700, recursive: true });
      const info = await fs.lstat(root);
      requireValid(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() &&
        (info.mode & 0o077) === 0 && await fs.realpath(root) === root, 'unsafe checkpoint directory');
      const keyPath = path.join(root, 'authentication.key');
      try { return await safeRead(keyPath, 32); }
      catch (error) {
        if (error.code !== 'ENOENT' || readOnly) throw error;
        requireValid(!(await fs.readdir(root)).some(name => name.endsWith('.json')), 'checkpoint authentication key is missing');
        const key = randomBytes(32);
        // Publish only a complete, fsynced key; a crash cannot leave a partial key.
        const temp = path.join(root, `.key-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
        const handle = await fs.open(temp, 'wx', 0o600);
        try { await handle.writeFile(key); await handle.sync(); } finally { await handle.close(); }
        try { await fs.link(temp, keyPath); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        finally { await fs.unlink(temp); }
        await syncDirectory();
        return safeRead(keyPath, 32);
      }
    })().then(key => { requireValid(key.length === 32, 'invalid authentication key'); return key; }).catch(error => { initialized = undefined; throw error; });
    return initialized;
  }
  const identity = scope => ({ format: FORMAT, verifierVersion, network: scope.network,
    activationHeight: scope.activationHeight, activationPreviousBlockHash: scope.activationPreviousBlockHash,
    feeRateActivationHeight: scope.feeRateActivationHeight, feeRateActivationPreviousBlockHash: scope.feeRateActivationPreviousBlockHash });
  function validate(state, expected) {
    requireValid(Object.entries(expected).every(([key, value]) => state[key] === value), 'checkpoint identity/version differs');
    requireValid(Array.isArray(state.blocks), 'missing block receipts');
    let witness = permissionBlockWitnessSeed(expected.network, expected.activationHeight, expected.activationPreviousBlockHash);
    let indexWitness = permissionIndexWitnessSeed(expected.network, expected.activationHeight, expected.activationPreviousBlockHash);
    let previous = expected.activationPreviousBlockHash, bytes = 0;
    for (let index = 0; index < state.blocks.length; index++) {
      const receipt = state.blocks[index], row = receipt.row;
      requireValid(row && row.height === expected.activationHeight + index && hex(row.block_hash) &&
        row.previous_block_hash === previous && row.complete === true && row.block_atomic === true &&
        row.fee_once === true && row.invalid_zero === true && Array.isArray(receipt.transactions), 'noncontiguous block receipts');
      witness = permissionBlockWitnessNext(witness, row);
      indexWitness = permissionIndexWitnessNext(indexWitness, row);
      requireValid(witness === receipt.witnessSha256 && indexWitness === receipt.indexWitnessSha256, 'receipt witness chain differs');
      bytes += Buffer.byteLength(JSON.stringify(receipt.transactions));
      requireValid(bytes <= maxProjectionBytes, 'projection byte budget exceeded');
      previous = row.block_hash;
    }
  }
  async function stateFor(scope) {
    const { network, activationHeight, activationPreviousBlockHash, feeRateActivationHeight, feeRateActivationPreviousBlockHash } = scope;
    requireValid(network === 'livenet' && Number.isSafeInteger(activationHeight) && activationHeight > 0 && hex(activationPreviousBlockHash) && Number.isSafeInteger(feeRateActivationHeight) && feeRateActivationHeight >= activationHeight && hex(feeRateActivationPreviousBlockHash), 'invalid scope');
    const scopeKey = JSON.stringify(identity(scope));
    if (!scopes.has(scopeKey)) {
      const key = await init();
      const expected = identity(scope);
      let state = { ...expected, blocks: [] }, generation = 0, fileSha256 = null;
      for (let revision = 0; ; revision++) {
        let raw;
        try { raw = await safeRead(stateName(scope, revision), maxBytes); }
        catch (error) { if (error.code === 'ENOENT') break; throw error; }
        requireValid(revision <= 32, 'journal revision limit');
        const envelope = JSON.parse(raw);
        requireValid(typeof envelope.payload === 'string' && hex(envelope.mac), 'malformed receipt envelope');
        const mac = createHmac('sha256', key).update(envelope.payload).digest();
        requireValid(timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex')), 'receipt authentication failed');
        state = JSON.parse(envelope.payload);
        if (revision) {
          const replay = state.replay;
          requireValid(replay?.predecessorSha256 === fileSha256 && replay.evidence?.predecessorSha256 === fileSha256 &&
            sha(JSON.stringify(replay.evidence)) === replay.evidenceSha256, 'replay predecessor or evidence differs');
        }
        validate(state, expected);
        fileSha256 = sha(raw); generation = revision;
      }
      scopes.set(scopeKey, { state, generation, fileSha256 });
    }
    return scopes.get(scopeKey);
  }
  async function current(scope, original) {
    const target = stateName(scope, original.generation);
    let raw;
    try { raw = await safeRead(target, maxBytes); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const successor = await fs.lstat(stateName(scope, original.generation + 1)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if ((raw ? sha(raw) : null) !== original.fileSha256 || successor) {
      scopes.delete(JSON.stringify(identity(scope)));
      throw new Error('Permission journal changed before publication');
    }
  }

  function prefixAt(state, count) {
    if (!count) return null;
    const rows = state.blocks.slice(0, count);
    const last = rows.at(-1);
    return { height: last.row.height, blockHash: last.row.block_hash, witnessSha256: last.witnessSha256,
      indexWitnessSha256: last.indexWitnessSha256,
      projectionBytes: rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.transactions)), 0),
      transactions: structuredClone(rows.flatMap(row => row.transactions)) };
  }
  async function restore(scope, checkpoint, readCoreHash) {
    const { network, activationHeight } = scope;
    const { state } = await stateFor(scope);
    requireValid(typeof readCoreHash === 'function', 'Core binding is required');
    let count = Math.min(state.blocks.length, Math.max(0, checkpoint.height - activationHeight + 1));
    // The authenticated rows are one contiguous chain. Binary search finds its
    // common prefix with Core without throwing away unrelated verified history.
    if (count && await readCoreHash(state.blocks[count - 1].row.height, network) !== state.blocks[count - 1].row.block_hash) {
      let low = 0, high = count;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const row = state.blocks[mid - 1];
        if (await readCoreHash(row.row.height, network) === row.row.block_hash) low = mid;
        else high = mid - 1;
      }
      count = low;
    }
    return prefixAt(state, count);
  }
  function receipt(row, transactions, witnessSha256, indexWitnessSha256) {
    // Keep only the exact fields used by both witness chains, never full native
    // transition bodies. The authenticated transaction projection came from Core.
    const indexRow = Object.fromEntries(['height', 'block_hash', 'previous_block_hash', 'model', 'complete',
      'block_atomic', 'fee_once', 'invalid_zero', 'protocol_record_count', 'raw_protocol_candidate_count',
      'storage_commitment', 'payload'].map(key => [key, key === 'height' ? Number(row[key]) : row[key]]));
    indexRow.payload = { blockDescriptorCommitment: row.payload.blockDescriptorCommitment,
      replayDescriptorCommitment: row.payload.replayDescriptorCommitment };
    return structuredClone({ row: indexRow, witnessSha256, indexWitnessSha256, transactions });
  }
  async function append(scope, row, transactions, witnessSha256, indexWitnessSha256) {
    const original = await stateFor(scope);
    const { state } = original;
    const offset = Number(row.height) - scope.activationHeight;
    requireValid(offset >= 0 && offset <= state.blocks.length, 'receipt gap');
    const block = receipt(row, transactions, witnessSha256, indexWitnessSha256);
    if (state.blocks[offset]?.row.block_hash === block.row.block_hash) {
      requireValid(JSON.stringify(state.blocks[offset]) === JSON.stringify(block), 'same-block receipt differs');
      return; // Older queued reads cannot truncate newer verified progress.
    }
    const next = { ...state, blocks: [...state.blocks.slice(0, offset), block] };
    await publish(scope, original, next, original.generation);
  }
  async function inspect(scope) {
    const { state, fileSha256, generation } = await stateFor(scope);
    requireValid(fileSha256 && state.blocks.length, 'no authenticated replay predecessor');
    return { fileSha256, generation, blocks: structuredClone(state.blocks) };
  }
  async function supersede(scope, predecessorSha256, fromHeight, replacements, evidence, fence) {
    const original = await stateFor(scope), { state } = original;
    const offset = fromHeight - scope.activationHeight;
    requireValid(original.fileSha256 === predecessorSha256 && original.generation < 32 &&
      Number.isSafeInteger(offset) && offset >= 0 && replacements.length && offset + replacements.length === state.blocks.length &&
      evidence?.predecessorSha256 === predecessorSha256 && evidence.retainedThrough === fromHeight - 1 &&
      evidence.through === state.blocks.at(-1).row.height && typeof fence === 'function', 'invalid replay publication');
    const next = { ...state, replay: { predecessorSha256, fromHeight, evidenceSha256: sha(JSON.stringify(evidence)), evidence },
      blocks: [...state.blocks.slice(0, offset), ...replacements] };
    await publish(scope, original, next, original.generation + 1, fence);
  }
  async function publish(scope, original, next, generation, fence) {
    validate(next, identity(scope));
    const payload = JSON.stringify(next);
    const key = await init();
    const raw = JSON.stringify({ payload, mac: createHmac('sha256', key).update(payload).digest('hex') });
    requireValid(Buffer.byteLength(raw) <= maxBytes, 'checkpoint byte budget exceeded');
    const target = stateName(scope, generation);
    await locked(async () => {
      await current(scope, original);
      const temporary = `${target}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
        await beforeRename();
        if (fence) await fence();
        await fs.rename(temporary, target);
        await syncDirectory();
        scopes.set(JSON.stringify(identity(scope)), { state: next, generation, fileSha256: sha(raw) });
      } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
  }
  return { restore, append, inspect, receipt, supersede };
}
