import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const FORMAT = 'dns-verified-journal-v1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const requireValid = (value, reason) => { if (!value) throw new Error(`DNS durable verification unavailable: ${reason}`); };

// These are service-authenticated verification receipts, not imported chain
// authority. The private key belongs to this node, never a wallet. Restores must
// retain that key and its receipts together; index/Core binding is still live.
export function createDnsVerificationStore({ directory, lane, model, verifierVersion = 1,
  maxBytes = 96 * 1024 * 1024, maxProjectionBytes = 64 * 1024 * 1024,
  beforeRename = async () => {},
}) {
  requireValid(['subdomains', 'root-pages', 'child-pages'].includes(lane), 'unknown lane');
  const root = path.resolve(directory);
  let initialized;
  const scopes = new Map();
  const stateName = (network, activation) => `${lane}-${network}-${activation}.json`;
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
  const identity = (network, activationHeight) => ({ format: FORMAT, verifierVersion, lane, model, network, activationHeight });
  function validate(state, expected) {
    requireValid(Object.entries(expected).every(([key, value]) => state[key] === value), 'checkpoint identity/version differs');
    requireValid(Array.isArray(state.blocks), 'missing block receipts');
    let witness = hash([model, expected.network, expected.activationHeight]);
    let previous = null, bytes = 0;
    for (let index = 0; index < state.blocks.length; index++) {
      const row = state.blocks[index];
      requireValid(row.height === expected.activationHeight + index && hex(row.blockHash) && hex(row.previousHash) &&
        (!previous || previous === row.previousHash) && Array.isArray(row.events), 'noncontiguous block receipts');
      witness = hash([witness, row.height, row.blockHash, row.blockDescriptorCommitment, row.replayDescriptorCommitment]);
      requireValid(witness === row.witnessSha256, 'receipt witness chain differs');
      bytes += Buffer.byteLength(JSON.stringify(row.events));
      requireValid(bytes <= maxProjectionBytes, 'projection byte budget exceeded');
      previous = row.blockHash;
    }
  }
  async function stateFor(network, activationHeight) {
    requireValid(network === 'livenet' && Number.isSafeInteger(activationHeight) && activationHeight > 0, 'invalid scope');
    const scope = `${network}:${activationHeight}`;
    if (!scopes.has(scope)) {
      const key = await init();
      const expected = identity(network, activationHeight);
      let state = { ...expected, blocks: [] };
      try {
        const envelope = JSON.parse(await safeRead(path.join(root, stateName(network, activationHeight)), maxBytes));
        requireValid(typeof envelope.payload === 'string' && hex(envelope.mac), 'malformed receipt envelope');
        const mac = createHmac('sha256', key).update(envelope.payload).digest();
        requireValid(timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex')), 'receipt authentication failed');
        state = JSON.parse(envelope.payload);
        validate(state, expected);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      scopes.set(scope, state);
    }
    return scopes.get(scope);
  }
  function prefixAt(state, count) {
    if (!count) return null;
    const rows = state.blocks.slice(0, count);
    const last = rows.at(-1);
    return { height: last.height, blockHash: last.blockHash, witnessSha256: last.witnessSha256,
      projectionBytes: rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row.events)), 0),
      events: rows.flatMap(row => row.events) };
  }
  async function restore(network, activationHeight, checkpoint, readCoreHash) {
    const state = await stateFor(network, activationHeight);
    requireValid(typeof readCoreHash === 'function', 'Core binding is required');
    let count = Math.min(state.blocks.length, Math.max(0, checkpoint.height - activationHeight + 1));
    // The authenticated rows are one contiguous chain. Binary search finds its
    // common prefix with Core without throwing away unrelated verified history.
    if (count && await readCoreHash(state.blocks[count - 1].height, network) !== state.blocks[count - 1].blockHash) {
      let low = 0, high = count;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const row = state.blocks[mid - 1];
        if (await readCoreHash(row.height, network) === row.blockHash) low = mid;
        else high = mid - 1;
      }
      count = low;
    }
    return prefixAt(state, count);
  }
  async function append(network, activationHeight, row, events, witnessSha256) {
    const state = await stateFor(network, activationHeight);
    const offset = Number(row.height) - activationHeight;
    requireValid(offset >= 0 && offset <= state.blocks.length, 'receipt gap');
    const block = { height: Number(row.height), blockHash: row.block_hash, previousHash: row.previous_block_hash,
      blockDescriptorCommitment: row.payload.blockDescriptorCommitment,
      replayDescriptorCommitment: row.payload.replayDescriptorCommitment, witnessSha256, events };
    const next = { ...state, blocks: [...state.blocks.slice(0, offset), block] };
    validate(next, identity(network, activationHeight));
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
      scopes.set(`${network}:${activationHeight}`, next);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return { restore, append };
}
