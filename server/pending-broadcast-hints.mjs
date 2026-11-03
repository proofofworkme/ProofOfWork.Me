import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Transaction } from "bitcoinjs-lib";

export const BROADCAST_HINT_MODEL = "accepted-broadcast-txid-hints-v1";
export const BROADCAST_HINT_LIMIT = 256;
export const BROADCAST_HINT_TTL_MS = 30 * 60_000;
const MAX_FILE_BYTES = 32_768;

function acceptedCarrierTxid(result, txHex, network) {
  if (network !== "livenet" || result?.ok !== true || !/^[0-9a-f]{64}$/u.test(result.txid) ||
      typeof txHex !== "string" || txHex.length > 1_000_000 || !/^(?:[0-9a-f]{2})+$/iu.test(txHex)) return null;
  try {
    const tx = Transaction.fromHex(txHex);
    return tx.getId() === result.txid && tx.outs.some(output => output.script[0] === 0x6a) ? result.txid : null;
  } catch {
    return null;
  }
}

async function checkedCacheRoot(directory) {
  const root = path.resolve(directory);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o022) || await fs.realpath(root) !== root) {
    throw new Error("Unsafe broadcast hint cache directory");
  }
  return root;
}

export function createBroadcastHints({ directory, now = Date.now, warn = message => console.warn(message) }) {
  const entries = new Map();
  const name = "accepted-broadcast-txids-v1.json";
  let restoring, writing, dirty = false;

  function prune() {
    const time = now();
    const ordered = [...entries].filter(([, acceptedAt]) => acceptedAt <= time && time - acceptedAt < BROADCAST_HINT_TTL_MS)
      .sort((left, right) => left[1] - right[1]);
    entries.clear();
    for (const [txid, acceptedAt] of ordered.slice(-BROADCAST_HINT_LIMIT)) entries.set(txid, acceptedAt);
  }

  function restore() {
    restoring ??= (async () => {
      const root = await checkedCacheRoot(directory);
      let file;
      try {
        file = await fs.open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (constants.O_NOATIME ?? 0));
        const stat = await file.stat();
        if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o077) ||
            stat.size > MAX_FILE_BYTES) throw new Error("Unsafe broadcast hint file");
        const buffer = Buffer.alloc(stat.size);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== stat.size) throw new Error("Incomplete broadcast hint file");
        const data = JSON.parse(buffer.toString());
        if (data.model !== BROADCAST_HINT_MODEL || data.network !== "livenet" || !Array.isArray(data.entries) ||
            data.entries.length > BROADCAST_HINT_LIMIT) throw new Error("Invalid broadcast hint file");
        const time = now();
        for (const row of data.entries) {
          if (!Array.isArray(row) || row.length !== 2) continue;
          const [txid, acceptedAt] = row;
          if (typeof txid !== "string" || !/^[0-9a-f]{64}$/u.test(txid) || !Number.isSafeInteger(acceptedAt) ||
              acceptedAt < 0 || acceptedAt > time || time - acceptedAt >= BROADCAST_HINT_TTL_MS) continue;
          entries.set(txid, Math.min(acceptedAt, entries.get(txid) ?? acceptedAt));
        }
        prune();
      } finally {
        await file?.close();
      }
    })().catch(error => { if (error.code !== "ENOENT") warn("Could not restore broadcast discovery hints: " + error.message); });
    return restoring;
  }

  async function save() {
    const root = await checkedCacheRoot(directory);
    const target = path.join(root, name);
    const temporary = target + "." + randomUUID() + ".tmp";
    let prior;
    try { prior = await fs.lstat(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (prior && (!prior.isFile() || prior.uid !== process.getuid() || prior.nlink !== 1 || (prior.mode & 0o077))) {
      throw new Error("Unsafe broadcast hint file");
    }
    const file = await fs.open(temporary, "wx", 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify({ model: BROADCAST_HINT_MODEL, network: "livenet", entries: [...entries] }));
        await file.sync();
      } finally { await file.close(); }
      await fs.rename(temporary, target);
      const parent = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await parent.sync(); } finally { await parent.close(); }
    } finally { await fs.rm(temporary, { force: true }); }
  }

  function queueSave() {
    dirty = true;
    writing ??= (async () => {
      try {
        await restore();
        while (dirty) {
          dirty = false;
          prune();
          try { await save(); } catch (error) { warn("Could not persist broadcast discovery hints: " + error.message); }
        }
      } finally { writing = undefined; }
    })();
    return writing;
  }

  return {
    // A successful gateway submission supplies only a scheduling hint. The
    // worker must prove Core membership and raw txid before persisting events.
    rememberAccepted(result, txHex, network) {
      const txid = acceptedCarrierTxid(result, txHex, network);
      if (!txid) return;
      prune();
      if (entries.has(txid)) return writing;
      entries.set(txid, now());
      prune();
      return queueSave();
    },
    async list() {
      await restore();
      prune();
      return { model: BROADCAST_HINT_MODEL, network: "livenet", txids: [...entries.keys()] };
    },
  };
}
