// Run only against a disposable PostgreSQL server using a private socket; this
// test never uses the configured indexer database or a production connection.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { join } from "node:path";
import pg from "pg";
import { readPowcatActivity } from "../server/db/powcat-activity.mjs";
import { normalizeHistoryEventItem } from "../server/db/proof-index-reader.mjs";
import { buildPowcatMailAttachment } from "../src/shared/protocol/powcatMail.mjs";

const scratch = process.env.POWCAT_REGTEST_SCRATCH;
assert(scratch?.startsWith("/") && process.getuid() !== 0, "Use an approved scratch directory and an unprivileged account.");
const dir = await mkdtemp(join(scratch, "powcat-growth-"));
const run = promisify(execFile);
const bin = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";
const db = join(dir, "db");
let started = false, pool;
try {
  await run(join(bin, "initdb"), ["--no-locale", "-A", "trust", "-D", db]);
  await run(join(bin, "pg_ctl"), ["-D", db, "-l", join(dir, "test.log"), "-o", `-c listen_addresses='' -k '${dir}'`, "-w", "start"]);
  started = true;
  pool = new pg.Pool({ host: dir, port: 5432, user: process.env.USER, database: "postgres" });
  await pool.query(await readFile(new URL("../server/sql/proof-indexer-v1.sql", import.meta.url), "utf8"));
  const height = 973976, blockHash = "ab".repeat(32), fileHash = "ed".repeat(32);
  const checkpoint = { height, hash: blockHash, verify: async n => n === height ? blockHash : null };
  const marker = { model: "powcat1-discovery-v1", network: "livenet", fromHeight: 973975,
    anchorHash: "0000000000000000000197a8d7eeab4e20eae8693e7bb933edd89a75031933e3", complete: true,
    confirmedParts: 0, confirmedLinkers: 0, indexedThroughBlock: height, indexedThroughBlockHash: blockHash };
  const read = () => readPowcatActivity(pool, "livenet", checkpoint);
  await assert.rejects(read, {statusCode: 503});
  await pool.query("INSERT INTO proof_indexer.meta(key,value) VALUES('livenet:powcat1:discovery:v1',$1)", [marker]);
  const parent = "aa".repeat(32);
  await pool.query("INSERT INTO proof_indexer.blocks(network,height,block_hash) VALUES('livenet',$1,$2),('livenet',$3,$4)",
    [height-1,parent,height,blockHash]);
  assert.equal((await read()).publications, "0");
  const txid = n => n.toString(16).padStart(64,"0");
  const attachment = buildPowcatMailAttachment({ name: "report.html", txid: txid(43), fileHash });
  const canon = (await Promise.all(Array.from({length:47}, (_,i) => {
    const n = i + 1, part = n <= 42, kind = part ? "powcat-part" : n === 44 ? "file" : "powcat-linker";
    const size = part ? Math.min(96_000, 4_000_000 - i*96_000) : 4_000_000;
    const status = n === 45 ? "pending" : n === 46 ? "orphaned" : "confirmed";
    const valid = n !== 47;
    const payload = kind === "file" ? { attachment } : { powcat: { size, fileHash } };
    return pool.query("INSERT INTO proof_indexer.transactions(network,txid,status,block_hash,block_height,fee_sats) VALUES ('livenet',$1,$2,$3,$4,$5)",
      [txid(n),status,part ? parent : blockHash,part ? height-1:height,part ? 100_000 : 3_000]).then(() =>
        pool.query("INSERT INTO proof_indexer.events(network,event_key,txid,protocol,kind,status,valid,amount_sats,block_height,record_ordinal,payload) VALUES ('livenet',$1,$1,$2,$3,$4,$5,$6,$7,0,$8)",
          [txid(n),kind === "file" ? "pwm1" : "powcat1",kind,status,valid,kind === "file" ? 546:0,part ? height-1:height,payload]));
  })));
  assert.equal(canon.length,47);
  await assert.rejects(read,{statusCode:503}); // Discovered corpus and event rows must agree.
  marker.confirmedParts=42; marker.confirmedLinkers=1;
  await pool.query("UPDATE proof_indexer.meta SET value=$1 WHERE key='livenet:powcat1:discovery:v1'",[marker]);
  const counts = await read();
  assert.deepEqual([counts.parts,counts.partBytes,counts.publications,counts.distinctFiles,counts.publishedBytes,counts.minerFeeProofs], ["42","4000000","1","1","4000000","4203000"]);
  assert.equal((await pool.query("SELECT sum(amount_sats) AS paid FROM proof_indexer.events WHERE valid AND status='confirmed'")).rows[0].paid,"546");
  const log = normalizeHistoryEventItem({kind:"file",txid:txid(44),confirmed:true, valid:true, attachment},"livenet",{publicOnly:true});
  assert.deepEqual(log.linkedFile,{txid:txid(43),fileHash});
  for (const kind of ["powcat-part","powcat-linker"]) {
    assert.equal(normalizeHistoryEventItem({kind,txid:txid(43),valid:true,confirmed:true},"livenet",{publicOnly:true}).kind,kind);
    assert.equal(normalizeHistoryEventItem({kind,txid:txid(43),valid:false,confirmed:true},"livenet",{publicOnly:true}),null);
  }
  await assert.rejects(() => readPowcatActivity(pool,"livenet",{...checkpoint,verify:async () => parent}),{statusCode:503});
  await pool.query("UPDATE proof_indexer.blocks SET canonical=false WHERE block_hash=$1",[blockHash]);
  await assert.rejects(read,{statusCode:503});
  await pool.query("UPDATE proof_indexer.events SET status='orphaned' WHERE block_height=$1",[height]);
  await assert.rejects(read,{statusCode:503});
  const replacement = "bc".repeat(32);
  await pool.query("INSERT INTO proof_indexer.blocks(network,height,block_hash) VALUES('livenet',$1,$2)", [height,replacement]);
  await pool.query("UPDATE proof_indexer.meta SET value=$1 WHERE key='livenet:powcat1:discovery:v1'", [{...marker,confirmedLinkers:0,indexedThroughBlockHash:replacement}]);
  checkpoint.hash=replacement; checkpoint.verify=async () => replacement;
  const after = await read();
  assert.equal(after.publications,"0"); assert.equal(after.parts,"42");
  await pool.query("UPDATE proof_indexer.transactions SET fee_sats=NULL WHERE txid=$1",[txid(1)]);
  assert.equal((await read()).minerFeeProofs,null);
  console.log("PASS PostgreSQL: 42 parts + one publication + one 546-proof file delivery; orphan, stale fence, invalid and pending excluded; missing fees unavailable.");
} finally {
  if (pool) await pool.end();
  if (started) await run(join(bin,"pg_ctl"),["-D",db,"-m","immediate","-w","stop"]);
  await rm(dir,{recursive:true,force:true});
}
