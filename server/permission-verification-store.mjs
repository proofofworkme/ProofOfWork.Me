import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
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
  beforeRename = async () => {},
}) {
  const root = path.resolve(directory);
  let initialized;
  const scopes = new Map();
  const stateName = (network, activation) => `permission-${network}-${activation}.json`;
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
      await fs.mkdir(root, { mode: 0o700, recursive: true });
      const info = await fs.lstat(root);
      requireValid(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() &&
        (info.mode & 0o077) === 0 && await fs.realpath(root) === root, 'unsafe checkpoint directory');
      const keyPath = path.join(root, 'authentication.key');
      try { return await safeRead(keyPath, 32); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
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
    const scopeKey = JSON.stringify(scope);
    if (!scopes.has(scopeKey)) {
      const key = await init();
      const expected = identity(scope);
      let state = { ...expected, blocks: [] };
      try {
        const envelope = JSON.parse(await safeRead(path.join(root, stateName(network, activationHeight)), maxBytes));
        requireValid(typeof envelope.payload === 'string' && hex(envelope.mac), 'malformed receipt envelope');
        const mac = createHmac('sha256', key).update(envelope.payload).digest();
        requireValid(timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex')), 'receipt authentication failed');
        state = JSON.parse(envelope.payload);
        validate(state, expected);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      scopes.set(scopeKey, state);
    }
    return scopes.get(scopeKey);
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
    const state = await stateFor(scope);
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
  async function append(scope, row, transactions, witnessSha256, indexWitnessSha256) {
    const { network, activationHeight } = scope;
    const state = await stateFor(scope);
    const offset = Number(row.height) - activationHeight;
    requireValid(offset >= 0 && offset <= state.blocks.length, 'receipt gap');
    // Keep only the exact fields used by both witness chains, never full native
    // transition bodies. The authenticated transaction projection came from Core.
    const indexRow = Object.fromEntries(['height', 'block_hash', 'previous_block_hash', 'model', 'complete',
      'block_atomic', 'fee_once', 'invalid_zero', 'protocol_record_count', 'raw_protocol_candidate_count',
      'storage_commitment', 'payload'].map(key => [key, key === 'height' ? Number(row[key]) : row[key]]));
    indexRow.payload = { blockDescriptorCommitment: row.payload.blockDescriptorCommitment,
      replayDescriptorCommitment: row.payload.replayDescriptorCommitment };
    const block = structuredClone({ row: indexRow, witnessSha256, indexWitnessSha256, transactions });
    if (state.blocks[offset]?.row.block_hash === block.row.block_hash) {
      requireValid(JSON.stringify(state.blocks[offset]) === JSON.stringify(block), 'same-block receipt differs');
      return; // Older queued reads cannot truncate newer verified progress.
    }
    const next = { ...state, blocks: [...state.blocks.slice(0, offset), block] };
    validate(next, identity(scope));
    const payload = JSON.stringify(next);
    const key = await init();
    const raw = JSON.stringify({ payload, mac: createHmac('sha256', key).update(payload).digest('hex') });
    requireValid(Buffer.byteLength(raw) <= maxBytes, 'checkpoint byte budget exceeded');
    const target = path.join(root, stateName(network, activationHeight));
    const temporary = `${target}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
    try {
      await beforeRename();
      await fs.rename(temporary, target);
      await syncDirectory();
      scopes.set(JSON.stringify(scope), next);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { restore, append };
}
