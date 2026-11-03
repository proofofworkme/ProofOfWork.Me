import { createHash } from "node:crypto";
import { resolvePowcatFile } from "../src/shared/protocol/powcat1.mjs";

const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const height = value => Number.isSafeInteger(value) && value >= 0;
const failure = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// rpc is an authenticated, network-specific Core transport returning the
// unwrapped result. A one-TX proof avoids fetching entire blocks or verbose
// transactions containing unbounded lists of decoded outputs/ASM.
export function createPowcatReader({ rpc, chain, maxConcurrent = 2 }) {
  if (!["main", "regtest"].includes(chain) || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 2) {
    throw new Error("Invalid powcat reader configuration.");
  }
  let active = 0;
  return async function read(txid, { signal } = {}) {
    if (!hash(txid)) throw failure(400, "Invalid linker TXID.");
    if (active >= maxConcurrent) throw failure(429, "File verification is busy.");
    active++;
    const deadline = Date.now() + 90_000;
    async function call(method, params) {
      if (signal?.aborted || Date.now() > deadline) throw failure(503, "File verification was interrupted.");
      try {
        return await rpc(method, params);
      } catch (error) {
        if (["gettxoutproof", "verifytxoutproof"].includes(method) && error?.code === -5) {
          throw failure(409, "Confirmed transaction evidence is unavailable.");
        }
        throw failure(503, "File verification could not read the selected node.");
      }
    }
    try {
      const tip = await call("getblockchaininfo", []);
      if (tip?.chain !== chain || !height(tip.blocks) || !hash(tip.bestblockhash) || tip.initialblockdownload !== false) {
        throw failure(503, "File verification requires a synchronized node on the selected chain.");
      }
      const byHash = new Map();
      let rootBlock;
      const file = await resolvePowcatFile(txid, async id => {
        const proof = await call("gettxoutproof", [[id]]);
        if (typeof proof !== "string" || proof.length < 160 || proof.length > 8192 ||
          proof.length % 2 || !/^[0-9a-f]+$/u.test(proof)) throw failure(503, "Invalid transaction inclusion proof.");
        const matches = await call("verifytxoutproof", [proof]);
        if (!Array.isArray(matches) || matches.length !== 1 || matches[0] !== id) throw failure(409, "Transaction inclusion proof did not verify.");
        const header = Buffer.from(proof.slice(0, 160), "hex");
        const digest = createHash("sha256").update(header).digest();
        const blockHash = createHash("sha256").update(digest).digest().reverse().toString("hex");
        if (!byHash.has(blockHash)) {
          const block = await call("getblockheader", [blockHash, true]);
          if (block?.hash !== blockHash || !height(block.height) || block.height > tip.blocks ||
            !Number.isSafeInteger(block.confirmations) || block.confirmations <= 0) throw failure(409, "Block is outside the active checkpoint.");
          byHash.set(blockHash, block.height);
        }
        const blockHeight = byHash.get(blockHash);
        if (id === txid) rootBlock = { blockHeight, blockHash };
        const hex = await call("getrawtransaction", [id, 0]);
        return { hex, blockHeight, blockHash };
      });
      for (const [blockHash, blockHeight] of byHash) {
        if (await call("getblockhash", [blockHeight]) !== blockHash) throw failure(409, "File dependency was reorganized.");
      }
      if (await call("getblockhash", [tip.blocks]) !== tip.bestblockhash) throw failure(409, "File verification checkpoint was reorganized.");
      return { ...file, ...rootBlock };
    } catch (error) {
      if (error?.statusCode) throw error;
      throw failure(422, "The transactions do not form a valid powcat1 file.");
    } finally {
      active--;
    }
  };
}

export function powcatDownloadHeaders(file) {
  const filename = encodeURIComponent(file.name).replace(/['()*]/gu, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  return {
    "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "*",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="proof-file"; filename*=UTF-8''${filename}`,
    "Content-Length": file.size,
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Content-Type": "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  };
}
