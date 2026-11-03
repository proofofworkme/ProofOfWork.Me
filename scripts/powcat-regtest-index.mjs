// Disposable PostgreSQL integration for the existing isolated Core regtest.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { persistPowcatObservations, powcatObservations, scanPowcatCoverage } from "../server/powcat-index.mjs";

export async function openRegtestIndex(directory, rpc) {
  assert(process.getuid() !== 0 && directory.startsWith("/"), "Use an unprivileged regtest scratch account.");
  const bin = process.env.PG_BIN || "/usr/lib/postgresql/16/bin";
  const data = join(directory, "pg-data");
  const run = promisify(execFile);
  await run(join(bin, "initdb"), ["--no-locale", "-A", "trust", "-D", data]);
  await run(join(bin, "pg_ctl"), ["-D", data, "-l", join(directory, "pg.log"), "-o", `-c listen_addresses='' -k '${directory}'`, "-w", "start"]);
  const pool = new pg.Pool({ host: directory, port: 5432, user: process.env.USER, database: "postgres" });
  const close = async () => {
    await pool.end();
    await run(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
  };
  try {
    await pool.query(await readFile(new URL("../server/sql/proof-indexer-v1.sql", import.meta.url), "utf8"));
    const height = await rpc("getblockcount");
    const anchor = { height, hash: await rpc("getblockhash", [height]) };
    async function transaction(client, txid, status, pos) {
      if (pos) await client.query(`INSERT INTO proof_indexer.blocks(network,height,block_hash)
        VALUES('regtest',$1,$2) ON CONFLICT DO NOTHING`, [pos.blockHeight, pos.blockHash]);
      await client.query(`INSERT INTO proof_indexer.transactions(network,txid,status,block_height,block_hash,block_index)
        VALUES('regtest',$1,$2,$3,$4,$5) ON CONFLICT (network,txid) DO UPDATE SET status=EXCLUDED.status,
        block_height=EXCLUDED.block_height,block_hash=EXCLUDED.block_hash,block_index=EXCLUDED.block_index`,
      [txid, status, pos?.blockHeight, pos?.blockHash, pos?.blockIndex]);
    }
    return { close,
      async pending(txid) {
        const raw = await rpc("getrawtransaction", [txid, true]);
        await transaction(pool, txid, "pending");
        await persistPowcatObservations(pool, "regtest", await powcatObservations(raw, null, rpc));
      },
      async scan(maxBlocks = 64) {
        const tip = await rpc("getblockchaininfo");
        const client = await pool.connect();
        try {
          return await scanPowcatCoverage({ client, network: "regtest", anchor, target: { height: tip.blocks, blockHash: tip.bestblockhash },
            rpc, maxBlocks, persistRaw: (raw, pos) => transaction(client, raw.txid, "confirmed", pos) });
        } finally { client.release(); }
      },
      async event(txid) {
        const result = await pool.query("SELECT status, valid, payload, amount_sats FROM proof_indexer.events WHERE network='regtest' AND txid=$1", [txid]);
        assert.equal(result.rowCount, 1);
        return result.rows[0];
      },
      async verifyCounts() {
        const result = await pool.query(`SELECT kind, count(*) AS count, sum(amount_sats) AS value
          FROM proof_indexer.events WHERE protocol='powcat1' AND status='confirmed' AND valid GROUP BY kind ORDER BY kind`);
        assert.deepEqual(result.rows, [{kind:"powcat-linker",count:"1",value:"0"},{kind:"powcat-part",count:"42",value:"0"}]);
        assert.equal((await pool.query("SELECT count(*) AS n FROM proof_indexer.event_participants")).rows[0].n, "0");
      },
    };
  } catch (error) { await close(); throw error; }
}
