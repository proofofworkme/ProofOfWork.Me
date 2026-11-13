import { parsePowcatTransaction, resolvePowcatFile } from "../src/shared/protocol/powcat1.mjs";
import { decodeCanonicalOpReturnOutput } from "./canonical-op-return.mjs";
import { prefilterCodeRawBlock } from "./code-repositories.mjs";
import { Transaction } from "bitcoinjs-lib";

export const POWCAT_SCAN_MODEL = "powcat1-discovery-v1";
export const POWCAT_SCAN_ANCHOR = Object.freeze({ height: 973974,
  hash: "0000000000000000000197a8d7eeab4e20eae8693e7bb933edd89a75031933e3" });
export const powcatCoverageKey = network => `${network}:powcat1:discovery:v1`;
const partMagic = Buffer.from("powcat1:p").toString("hex");
const linkerMagic = Buffer.from("powcat1:m").toString("hex");
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

export function powcatCarrierKind(payloadHex) {
  if (payloadHex?.startsWith(partMagic)) return "powcat-part";
  if (payloadHex?.startsWith(linkerMagic)) return "powcat-linker";
  return "";
}

export function powcatCandidateOutputs(tx) {
  return (tx?.vout ?? []).flatMap((output, vout) => {
    const script = output?.scriptPubKey?.hex ?? output?.scriptpubkey;
    if (typeof script !== "string" || !script.startsWith("6a")) return [];
    const kind = powcatCarrierKind(decodeCanonicalOpReturnOutput(output).payloadHex);
    return kind ? [{ vout, kind, scriptBytes: script.length / 2 }] : [];
  });
}

class IndexUnavailable extends Error {}
function need(ok, message) { if (!ok) throw new IndexUnavailable(message); }

// Each resolved dependency is independently bound to an active Core block.
// A missing dependency is terminal for an already confirmed linker only
// after a synchronized txindex covers the linker's own block.
export async function resolveIndexedPowcatFile(tx, position, rpc, { includeEvidence = false } = {}) {
  const checked = new Map([[position.blockHeight, position.blockHash]]);
  const dependencies = [{ txid: tx.txid, blockHeight: position.blockHeight, blockHash: position.blockHash }];
  const index = await rpc("getindexinfo", ["txindex"]);
  need(index?.txindex?.synced === true && index.txindex.best_block_height >= position.blockHeight,
    "powcat index needs synchronized Core txindex");
  let resolved = null;
  try {
    resolved = await resolvePowcatFile(tx.txid, async id => {
      if (id === tx.txid) return { hex: tx.hex, blockHeight: position.blockHeight, blockHash: position.blockHash };
      let raw;
      try { raw = await rpc("getrawtransaction", [id, true]); }
      catch (error) {
        if ((error?.rpcCode ?? error?.code) === -5) throw new Error("missing part");
        throw new IndexUnavailable("powcat part transaction unavailable");
      }
      need(raw?.txid === id && typeof raw.hex === "string" && raw.hex.length <= 8_000_000, "powcat part transaction evidence differs");
      let actual;
      try { actual = Transaction.fromHex(raw.hex).getId(); } catch { /* transport/evidence failure */ }
      need(actual === id, "powcat part raw TXID differs");
      if (!raw.blockhash && !(raw.confirmations > 0)) throw new Error("unconfirmed part");
      need(hash(raw.blockhash) && Number.isSafeInteger(raw.confirmations) && raw.confirmations > 0, "powcat part chain changed");
      let header;
      try { header = await rpc("getblockheader", [raw.blockhash, true]); }
      catch { throw new IndexUnavailable("powcat part block unavailable"); }
      need(header?.hash === raw.blockhash && header.confirmations > 0 && Number.isSafeInteger(header.height)
        && (!checked.has(header.height) || checked.get(header.height) === header.hash), "powcat part position changed");
      checked.set(header.height, header.hash);
      dependencies.push({ txid: id, blockHeight: header.height, blockHash: header.hash });
      return { hex: raw.hex, blockHeight: header.height, blockHash: header.hash };
    });
  } catch (error) {
    if (error instanceof IndexUnavailable) throw error;
  }
  for (const [height, expected] of checked) need(await rpc("getblockhash", [height]) === expected, "powcat verification reorganized");
  return resolved && includeEvidence ? { ...resolved, dependencies } : resolved;
}

export async function powcatObservations(tx, position, rpc) {
  const outputs = powcatCandidateOutputs(tx);
  if (!outputs.length) return [];
  need(hash(tx.txid) && typeof tx.hex === "string" && tx.hex.length <= 8_000_000, "powcat candidate lacks raw Core transaction");
  let signed;
  try { signed = Transaction.fromHex(tx.hex); } catch { /* Refuse incomplete raw evidence. */ }
  need(signed?.getId() === tx.txid && outputs.every(output => {
    const script = tx.vout[output.vout]?.scriptPubKey?.hex ?? tx.vout[output.vout]?.scriptpubkey;
    return signed.outs[output.vout] && Buffer.from(signed.outs[output.vout].script).toString("hex") === script;
  }), "powcat raw transaction or binary output differs");
  let rec;
  try { rec = parsePowcatTransaction(tx.hex, tx.txid); }
  catch { /* Retain a compact invalid observation for each candidate output. */ }
  const qualified = rec?.kind === "manifest" && position ? Boolean(await resolveIndexedPowcatFile(tx, position, rpc)) : false;
  return outputs.map(({ vout, kind, scriptBytes }) => {
    const valid = rec?.kind === "part" || qualified;
    const powcat = rec?.kind === "part" ? { fileHash: rec.fileHash, partHash: rec.partHash, index: rec.index, count: rec.count, size: rec.bytes.length }
      : rec?.kind === "manifest" ? { fileHash: rec.fileHash, size: rec.size, count: rec.partTxids.length,
        name: rec.name, mime: rec.mime, partTxids: rec.partTxids } : {};
    const reason = valid ? "" : !rec ? "invalid-carrier" : position ? "invalid-dependencies" : "pending-confirmation";
    return { txid: tx.txid, kind, protocol: "powcat1", protocolVout: vout, recordOrdinal: 0,
      status: position ? "confirmed" : "pending", confirmed: Boolean(position), valid, reason,
      title: kind === "powcat-part" ? "Linked file part" : "Linked file manifest",
      amountSats: 0, dataBytes: scriptBytes, powcat, ...position };
  });
}

// File observations have no recipient, transfer or registry payment. They
// never enter balance projections or historical WORK event seals. One stable
// key per physical output also permits an orphan to confirm at a new position.
export async function persistPowcatObservations(client, network, rows) {
  for (const item of rows) {
    await client.query(`INSERT INTO proof_indexer.events AS e
        (network,event_key,txid,protocol,kind,status,valid,validation_errors,amount_sats,data_bytes,
         block_height,block_index,op_return_vout,record_ordinal,block_time,event_time,raw_payload,payload)
      VALUES ($1,$2,$3,'powcat1',$4,$5,$6,$7::text[],0,$8,$9,$10,$11,0,$12::timestamptz,
        COALESCE($12::timestamptz,now()),$13,$14::jsonb)
      ON CONFLICT (network,event_key) DO UPDATE SET status=EXCLUDED.status, valid=EXCLUDED.valid,
        validation_errors=EXCLUDED.validation_errors,data_bytes=EXCLUDED.data_bytes,block_height=EXCLUDED.block_height,
        block_index=EXCLUDED.block_index,block_time=EXCLUDED.block_time,event_time=CASE WHEN e.status='pending'
        AND EXCLUDED.status='pending' THEN e.event_time ELSE EXCLUDED.event_time END,payload=EXCLUDED.payload,updated_at=now()
      WHERE NOT (e.status='confirmed' AND EXCLUDED.status='pending')`, [network, `powcat1:${item.txid}:${item.protocolVout}`,
      item.txid, item.kind, item.status, item.valid, item.reason ? [item.reason] : [], item.dataBytes,
      item.blockHeight ?? null, item.blockIndex ?? null, item.protocolVout, item.blockTime ?? null,
      item.kind === "powcat-part" ? "powcat1:p" : "powcat1:m", JSON.stringify(item)]);
  }
}

// Pending discovery is best effort. Do not turn a missed observation or RPC
// outage into a drop. A confirmed transaction waits for the block scanner.
export async function reconcilePowcatPending(client, network, mempool, rpc) {
  const pending = (await client.query(`SELECT DISTINCT txid FROM proof_indexer.events
    WHERE network=$1 AND protocol='powcat1' AND status='pending' LIMIT 65`, [network])).rows;
  // Common case: avoid shipping the entire node mempool to PostgreSQL. For
  // larger pending file sets use a bounded anti-join so present transactions
  // cannot permanently hide missing ones beyond the first page.
  const absent = pending.length < 65 ? pending.filter(row => !Object.hasOwn(mempool, row.txid)) :
    (await client.query(`SELECT DISTINCT e.txid FROM proof_indexer.events e
      WHERE e.network=$1 AND e.protocol='powcat1' AND e.status='pending' AND NOT EXISTS
        (SELECT 1 FROM unnest($2::text[]) AS live(txid) WHERE live.txid=e.txid) LIMIT 64`,
    [network, Object.keys(mempool)])).rows;
  if (!absent.length) return;
  const index = await rpc("getindexinfo", ["txindex"]);
  if (!index?.txindex?.synced || index.txindex.best_block_height < await rpc("getblockcount", [])) return;
  async function missing(method, params) {
    try { await rpc(method, params); return false; }
    catch (e) { if ((e?.rpcCode ?? e?.code) === -5) return true; throw e; }
  }
  for (const { txid } of absent) {
    if (!await missing("getmempoolentry", [txid]) || !await missing("getrawtransaction", [txid, false])) continue;
    await client.query(`UPDATE proof_indexer.events SET status='dropped', valid=false, updated_at=now(),
      payload=payload || '{"status":"dropped","confirmed":false,"valid":false}'::jsonb
      WHERE network=$1 AND txid=$2 AND protocol='powcat1' AND status='pending'`, [network, txid]);
  }
}

async function atomic(client, run) {
  await client.query("BEGIN");
  try { await run(); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
}

export async function scanPowcatCoverage({ client, rpc, network, anchor, target, maxBlocks, persistRaw }) {
  const key = powcatCoverageKey(network);
  const locked = await client.query("SELECT pg_try_advisory_lock(hashtext($1),hashtext($2)) AS locked", [key, network]);
  if (!locked.rows[0]?.locked) return { busy: true };
  try {
    const pin = { model: POWCAT_SCAN_MODEL, network, fromHeight: anchor.height + 1, anchorHash: anchor.hash };
    const previous = (await client.query("SELECT value FROM proof_indexer.meta WHERE key=$1", [key])).rows[0]?.value;
    let marker = previous ?? { ...pin, indexedThroughBlock: anchor.height, indexedThroughBlockHash: anchor.hash,
      confirmedParts: 0, confirmedLinkers: 0, complete: false };
    need(Object.entries(pin).every(([k, v]) => marker[k] === v) && Number.isSafeInteger(marker.indexedThroughBlock)
      && marker.indexedThroughBlock >= anchor.height && hash(marker.indexedThroughBlockHash) &&
      [marker.confirmedParts, marker.confirmedLinkers].every(n => Number.isSafeInteger(n) && n >= 0), "powcat coverage marker mismatch");
    need(Number.isSafeInteger(maxBlocks) && maxBlocks >= 1 && maxBlocks <= 1024, "invalid powcat scan budget");
    need(await rpc("getblockhash", [anchor.height]) === anchor.hash, "powcat launch-era anchor mismatch");
    const tip = await rpc("getblockcount", []);
    async function save(height, blockHash, complete, partDelta = 0, linkerDelta = 0) {
      const confirmedParts = marker.confirmedParts + partDelta, confirmedLinkers = marker.confirmedLinkers + linkerDelta;
      need([confirmedParts, confirmedLinkers].every(n => Number.isSafeInteger(n) && n >= 0), "powcat discovery totals inconsistent");
      marker = { ...pin, indexedThroughBlock: height, indexedThroughBlockHash: blockHash, complete, confirmedParts, confirmedLinkers };
      await client.query(`INSERT INTO proof_indexer.meta(key,value) VALUES ($1,$2::jsonb)
        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [key, JSON.stringify(marker)]);
    }
    let scanned = 0;
    while (scanned < maxBlocks && marker.indexedThroughBlock > anchor.height &&
      (marker.indexedThroughBlock > tip || await rpc("getblockhash", [marker.indexedThroughBlock]) !== marker.indexedThroughBlockHash)) {
      const height = marker.indexedThroughBlock, orphan = marker.indexedThroughBlockHash;
      const header = await rpc("getblockheader", [orphan, true]);
      need(header?.hash === orphan && header.height === height && hash(header.previousblockhash), "powcat detached header unavailable");
      await atomic(client, async () => {
        const detached = await client.query(`WITH prior AS MATERIALIZED (
          SELECT event_id,kind,valid FROM proof_indexer.events WHERE network=$1 AND protocol='powcat1'
          AND block_height=$2 AND payload->>'blockHash'=$3 AND status='confirmed' FOR UPDATE
        ) UPDATE proof_indexer.events e SET status='orphaned',valid=false,updated_at=now(),
          payload=payload || '{"status":"orphaned","confirmed":false,"valid":false}'::jsonb
          FROM prior WHERE e.event_id=prior.event_id RETURNING prior.kind,prior.valid`,
        [network, height, orphan]);
        await save(height - 1, header.previousblockhash, false,
          -detached.rows.filter(row => row.valid && row.kind === "powcat-part").length,
          -detached.rows.filter(row => row.valid && row.kind === "powcat-linker").length);
      });
      scanned++;
    }
    need(Number.isSafeInteger(target.height) && target.height >= anchor.height && target.height <= tip &&
      hash(target.blockHash) && await rpc("getblockhash", [target.height]) === target.blockHash, "powcat target is not canonical");
    while (scanned < maxBlocks && marker.indexedThroughBlock < target.height) {
      const height = marker.indexedThroughBlock + 1;
      const blockHash = await rpc("getblockhash", [height]);
      const block = prefilterCodeRawBlock(await rpc("getblock", [blockHash, 0]), {
        blockHash, previousBlockHash: marker.indexedThroughBlockHash, candidatePredicate: c => Boolean(powcatCarrierKind(c.payloadHex)),
      });
      const transactions = [];
      const byTxid = new Map();
      for (const c of block.candidates) {
        if (!byTxid.has(c.txid)) byTxid.set(c.txid, []);
        byTxid.get(c.txid).push(c);
      }
      for (const expected of byTxid.values()) {
        const c = expected[0];
        const raw = await rpc("getrawtransaction", [c.txid, true, blockHash]);
        need(raw?.txid === c.txid && raw.blockhash === blockHash && raw.in_active_chain === true, "powcat candidate moved");
        const candidates = powcatCandidateOutputs(raw);
        need(candidates.length === expected.length && candidates.every((row, i) => row.vout === expected[i].vout &&
          raw.vout[row.vout]?.scriptPubKey?.hex === expected[i].scriptPubKeyHex), "powcat candidate output mismatch");
        const position = { blockHeight: height, blockHash, blockIndex: c.transactionIndex, blockTime: new Date(block.time * 1000).toISOString() };
        transactions.push({ raw, position, observations: await powcatObservations(raw, position, rpc) });
      }
      await atomic(client, async () => {
        for (const t of transactions) {
          await persistRaw(t.raw, t.position, block.time);
          await persistPowcatObservations(client, network, t.observations);
        }
        need(await rpc("getblockhash", [height]) === blockHash, "powcat block changed before persistence");
        const observations = transactions.flatMap(t => t.observations);
        await save(height, blockHash, height === target.height && blockHash === target.blockHash,
          observations.filter(row => row.valid && row.kind === "powcat-part").length,
          observations.filter(row => row.valid && row.kind === "powcat-linker").length);
      });
      scanned++;
    }
    if (!marker.complete && marker.indexedThroughBlock === target.height && marker.indexedThroughBlockHash === target.blockHash) {
      await save(target.height, target.blockHash, true);
    }
    return { ...marker, scanned };
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext($1),hashtext($2))", [key, network]); }
}
