import { Buffer } from "buffer";
import { Transaction } from "bitcoinjs-lib";
import { parsePowcatTransaction, POWCAT_MAX_FILE_BYTES, POWCAT_MAX_PART_BYTES, POWCAT_MAX_PARTS } from "../../shared/protocol/powcat1.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const identityFields = ["fileHash", "size", "partSize", "name", "mime"];
let databasePromise;

function requireJournal(condition, message) {
  if (!condition) throw new Error(`Linked file recovery: ${message}`);
}

function walletKey(network, address) {
  requireJournal(typeof network === "string" && network && typeof address === "string" && address, "select a wallet and network.");
  return JSON.stringify([network, address]);
}

function sameIdentity(left, right) {
  return left && identityFields.every(key => left[key] === right[key]);
}

function allReceipts(draft) {
  return [...Object.values(draft.receipts), ...draft.supersededLinkers];
}

function checkedStage(draft, stage) {
  if (stage === "manifest") return stage;
  requireJournal(Number.isInteger(stage) && stage >= 0 && stage < Math.ceil(draft.size / draft.partSize), "invalid part index.");
  return String(stage);
}

function inspectRaw(hex, txid) {
  requireJournal(typeof hex === "string" && hex.length > 0 && hex.length <= 800_000 && hex.length % 2 === 0 && /^[0-9a-f]+$/u.test(hex), "invalid signed transaction bytes.");
  const tx = Transaction.fromHex(hex);
  requireJournal(HASH.test(txid) && tx.getId() === txid && tx.weight() <= 400_000 && tx.ins.length && !tx.isCoinbase(), "signed transaction does not match its receipt.");
  return {
    witnessHash: Buffer.from(tx.getHash(true)).toString("hex"),
    outpoints: tx.ins.map(input => `${Buffer.from(input.hash).reverse().toString("hex")}:${input.index}`),
  };
}

// One atomic update covers both the compact draft and the exact signed bytes.
// The callback executes synchronously within the storage transaction.
export function createPowcatJournal(network, address, store) {
  const owner = walletKey(network, address);
  const rawKey = txid => JSON.stringify([owner, txid]);
  async function state() {
    return (await store.read(owner)) ?? { active: null, last: null };
  }
  function update(operation) {
    return store.update(owner, (current, put, drop) => {
      const record = current ?? { active: null, last: null };
      const result = operation(record, put, drop);
      put(owner, record);
      return result;
    });
  }
  function active(record, fileHash) {
    requireJournal(record.active && record.active.fileHash === fileHash, "the active file changed. Refresh recovery before continuing.");
    return record.active;
  }
  return {
    read: async () => (await state()).active,
    lastPublished: async () => (await state()).last,
    reservedInputs: async () => {
      const { active: draft } = await state();
      return draft ? [...new Set(allReceipts(draft).flatMap(receipt => receipt.outpoints))] : [];
    },
    begin(identity) {
      const { fileHash, size, partSize, name, mime } = identity;
      requireJournal(typeof fileHash === "string" && HASH.test(fileHash) &&
        Number.isSafeInteger(size) && size >= 1 && size <= POWCAT_MAX_FILE_BYTES &&
        Number.isSafeInteger(partSize) && partSize >= 1 && partSize <= POWCAT_MAX_PART_BYTES &&
        Math.ceil(size / partSize) <= POWCAT_MAX_PARTS && typeof name === "string" && name && typeof mime === "string" && mime,
      "invalid publication plan.");
      return update(record => {
        requireJournal(!record.active || sameIdentity(record.active, identity), "resume the active file first.");
        record.active ??= sameIdentity(record.last, identity)
          ? structuredClone(record.last) : { fileHash, size, partSize, name, mime, receipts: {}, supersededLinkers: [] };
        return record.active;
      });
    },
    async saveSigned(fileHash, stage, { txid, hex, fee, outpoints }) {
      const signed = inspectRaw(hex, txid);
      requireJournal(Number.isSafeInteger(fee) && fee >= 0 && Array.isArray(outpoints) &&
        signed.outpoints.length === outpoints.length && signed.outpoints.every(point => outpoints.includes(point)) &&
        new Set(outpoints).size === outpoints.length, "invalid fee or input outpoints.");
      const carrier = parsePowcatTransaction(hex, txid);
      return update((record, put) => {
        const draft = active(record, fileHash);
        const key = checkedStage(draft, stage);
        const count = Math.ceil(draft.size / draft.partSize);
        if (carrier.kind === "part") {
          const expectedSize = Math.min(draft.partSize, draft.size - draft.partSize * carrier.index);
          requireJournal(carrier.fileHash === fileHash && carrier.index === stage && carrier.count === count && carrier.bytes.length === expectedSize, "part differs from the publication plan.");
        } else {
          requireJournal(stage === "manifest" && carrier.kind === "manifest" && carrier.fileHash === fileHash && carrier.size === draft.size &&
            carrier.name === draft.name && carrier.mime === draft.mime && carrier.partTxids.length === count &&
            carrier.partTxids.every((part, i) => draft.receipts[i]?.txid === part), "linker differs from the signed parts.");
        }
        const prior = draft.receipts[key];
        if (prior) {
          requireJournal(prior.txid === txid && prior.witnessHash === signed.witnessHash && prior.fee === fee, "this stage already has a different signed transaction.");
          return draft;
        }
        const spent = new Set(allReceipts(draft).flatMap(receipt => receipt.outpoints));
        requireJournal(!signed.outpoints.some(input => spent.has(input)), "an input is already reserved by this file.");
        draft.receipts[key] = { txid, fee, outpoints: signed.outpoints, witnessHash: signed.witnessHash };
        put(rawKey(txid), hex);
        return draft;
      });
    },
    async raw(fileHash, stage) {
      const draft = active(await state(), fileHash);
      const receipt = draft.receipts[checkedStage(draft, stage)];
      if (!receipt) return null;
      const hex = await store.read(rawKey(receipt.txid));
      requireJournal(inspectRaw(hex, receipt.txid).witnessHash === receipt.witnessHash, "saved transaction bytes have changed.");
      return hex;
    },
    supersedeLinker(fileHash, txid) {
      return update(record => {
        const draft = active(record, fileHash);
        requireJournal(draft.receipts.manifest?.txid === txid, "linker receipt has changed.");
        draft.supersededLinkers.push(draft.receipts.manifest);
        delete draft.receipts.manifest;
        return draft;
      });
    },
    finish(fileHash) {
      return update((record, _put, drop) => {
        const draft = active(record, fileHash);
        requireJournal(draft.receipts.manifest, "linker has not been signed.");
        // Keep the most recently completed publication recoverable from reorgs.
        const keep = new Set(allReceipts(draft).map(receipt => receipt.txid));
        for (const receipt of record.last ? allReceipts(record.last) : []) {
          if (!keep.has(receipt.txid)) drop(rawKey(receipt.txid));
        }
        record.last = draft;
        record.active = null;
      });
    },
  };
}

function openDatabase() {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("proofofwork-linked-file-recovery-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("journal");
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}

export async function openPowcatJournal(network, address) {
  const db = await openDatabase();
  const store = {
    read(key) {
      return new Promise((resolve, reject) => {
        const request = db.transaction("journal").objectStore("journal").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },
    update(key, operation) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction("journal", "readwrite", { durability: "strict" });
        const objects = tx.objectStore("journal");
        const request = objects.get(key);
        let result;
        let failure;
        request.onsuccess = () => {
          try {
            result = operation(request.result, (id, value) => objects.put(value, id), id => objects.delete(id));
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.onabort = () => reject(failure ?? tx.error ?? new Error("Recovery storage aborted."));
        tx.oncomplete = () => resolve(result);
      });
    },
  };
  return createPowcatJournal(network, address, store);
}

export async function readPowcatReservedInputs(network, address) {
  return (await openPowcatJournal(network, address)).reservedInputs();
}

export async function withPowcatPublisherLock(network, address, operation) {
  requireJournal(globalThis.navigator?.locks, "exclusive browser signing is unavailable.");
  return navigator.locks.request(`proofofwork-linked-file:${walletKey(network, address)}`, { ifAvailable: true }, lock => {
    requireJournal(lock, "another tab is publishing from this wallet.");
    return operation();
  });
}
