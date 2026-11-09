import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  WORK_TRANSFER_PROJECTION_PAGE_BYTES as PAGE, decodeWorkTransferProjection,
  prepareWorkTransferProjection, readWorkTransferProjection, storeWorkTransferProjection,
  validateWorkTransferProjectionReference, workTransferProjectionPageLength, workTransferProjectionSqlEligibility,
} from "./work-transfer-projection-store.mjs";

const binding = { network: "livenet", snapshotId: "snapshot_1", indexedThroughBlock: 974919, indexedThroughBlockHash: "a".repeat(64) };
const projection = {
  model: "canonical-work-transfer-value-projection-v1", amountStorageModel: "work-subatoms-v2",
  items: [{ kind: "token-transfer", amountSubatoms: "900719925474099312345", recipientAddress: "fixture",
    batchRecipientIndex: 0, derived: true, paidSats: 0, creditLiveValueQ8: "0", memo: "é".repeat(PAGE + 9) }],
  batchModel: "canonical-work-batch-transfer-value-projection-v2",
  transferBatches: [{ kind: "token-transfer-batch", transferVersion: "mailbatch1", derived: [{ eventId: "history:0" }],
    recipients: [{ recipientAddress: "fixture", amountSubatoms: "900719925474099312345" }], paidSats: 546 }],
};

test("exact byte roundtrip preserves order, large amounts, parent and recipient history", async () => {
  const { reference, pages } = prepareWorkTransferProjection(projection, binding);
  assert.equal(reference.pageCount, 3);
  assert.deepEqual(pages.map((p, i) => workTransferProjectionPageLength(reference, binding, i)), pages.map(p => p.length));
  assert.ok(Buffer.concat(pages).toString().startsWith('[["model",'));
  assert.equal(JSON.stringify(decodeWorkTransferProjection(reference, pages, binding)), JSON.stringify(projection));
  assert.equal(await readWorkTransferProjection(null, projection, binding), projection);
  assert.throws(() => workTransferProjectionPageLength(reference, binding, 3), /page index/);
  assert.throws(() => decodeWorkTransferProjection(reference, pages.slice(1), binding), /page count/);
  assert.throws(() => decodeWorkTransferProjection(reference, [pages[1], pages[0], pages[2]], binding), /digest|SyntaxError|manifest|JSON|record/);
  assert.throws(() => decodeWorkTransferProjection({ ...reference, itemCount: 2 }, pages, binding), /reconstructed|array count/);
  assert.throws(() => decodeWorkTransferProjection(reference, pages, { ...binding, snapshotId: "same_tip_other" }), /reference identity/);
  validateWorkTransferProjectionReference({ ...reference, pageCount: 1025, payloadBytes: PAGE * 1025 }, binding);
  assert.throws(() => validateWorkTransferProjectionReference({ ...reference, pageCount: 2 ** 31, payloadBytes: PAGE * 2 ** 31 }, binding), /bounds/);
  assert.throws(() => validateWorkTransferProjectionReference({ ...reference, extra: true }, binding), /identity/);
  await assert.rejects(readWorkTransferProjection(null, { model: "unknown-reference", items: [] }, binding), /unknown embedded/);
});

test("Q8 embedded and empty modern projection retain their declared model", () => {
  const original = { model: projection.model, amountStorageModel: "work-atoms-v1", items: [] };
  const { reference, pages } = prepareWorkTransferProjection(original, binding);
  assert.equal(reference.batchModel, null);
  assert.deepEqual(decodeWorkTransferProjection(reference, pages, binding), original);
});

const socketPath = process.env.POW_WORK_PROJECTION_TEST_SOCKET;
// This fixture is a dedicated UNIX socket and database. No default DATABASE_URL is accepted.
test("PostgreSQL atomically stores, verifies, retries, isolates and prunes snapshot pages", { skip: !socketPath }, async () => {
  assert.match(socketPath, /^\/(?:var\/)?tmp\/pow-[a-z0-9/-]+\/socket$/);
  const pool = new pg.Pool({ host: socketPath, port: Number(process.env.POW_WORK_PROJECTION_TEST_PORT || 55936),
    database: "work_projection_fixture", user: process.env.USER, max: 3, connectionTimeoutMillis: 3000, statement_timeout: 12000 });
  const db = await pool.connect();
  const second = await pool.connect();
  const referenceFor = () => ({ ...binding, snapshotId: randomUUID() });
  const prepared = prepareWorkTransferProjection(projection, referenceFor());
  const ref = prepared.reference;
  async function writeParent(client, reference) {
    const { network, snapshotId, indexedThroughBlock, indexedThroughBlockHash } = reference;
    const payload = { network, snapshotId, indexedThroughBlockHash, summaryPayloads: { workSummary: { workTransferValueProjection: reference } } };
    await client.query("INSERT INTO proof_indexer.ledger_snapshots(network,snapshot_id,indexed_through_block,payload) VALUES($1,$2,$3,$4)",
      [network, snapshotId, indexedThroughBlock, payload]);
  }
  const pageSql = "SELECT count(*)::int AS n FROM proof_indexer.work_transfer_projection_pages WHERE network=$1 AND snapshot_id=$2";
  async function pageCount(client, value) {
    return (await client.query(pageSql, [value.network, value.snapshotId])).rows[0].n;
  }
  async function eligible(client, reference) {
    const sql = "SELECT " + workTransferProjectionSqlEligibility("s") + " AS ok FROM proof_indexer.ledger_snapshots s WHERE network=$1 AND snapshot_id=$2";
    return (await client.query(sql, [reference.network,reference.snapshotId])).rows[0]?.ok;
  }
  try {
    assert.equal((await db.query("SELECT current_database() AS name")).rows[0].name, "work_projection_fixture");
    await db.query("CREATE SCHEMA IF NOT EXISTS proof_indexer");
    await db.query("CREATE TABLE IF NOT EXISTS proof_indexer.ledger_snapshots(network text NOT NULL,snapshot_id text NOT NULL," +
      "indexed_through_block integer,payload jsonb,PRIMARY KEY(network,snapshot_id))");
    await db.query("DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='proof_indexer') THEN CREATE ROLE proof_indexer; END IF; END$$");
    const migration = await readFile(new URL("../sql/work-transfer-projection-pages-v1.sql", import.meta.url), "utf8");
    const schema = await readFile(new URL("../sql/proof-indexer-v1.sql", import.meta.url), "utf8");
    const definition = migration.match(/CREATE TABLE IF NOT EXISTS proof_indexer\.work_transfer_projection_pages[\s\S]*?\n\);/)[0];
    assert.ok(schema.includes(definition));
    await db.query(migration);

    await assert.rejects(storeWorkTransferProjection(db, prepared), /SAVEPOINT can only be used in transaction blocks/);
    await db.query("BEGIN"); await writeParent(db, ref); await storeWorkTransferProjection(db, prepared);
    assert.equal(await pageCount(second, ref), 0);
    await assert.rejects(readWorkTransferProjection(second, ref, ref), /snapshot does not bind/);
    await db.query("ROLLBACK"); assert.equal(await pageCount(db, ref), 0);

    await db.query("BEGIN"); await writeParent(db, ref); await storeWorkTransferProjection(db, prepared);
    await db.query("COMMIT");
    assert.deepEqual(await readWorkTransferProjection(second, ref, ref), projection);
    assert.equal(await eligible(second, ref), true);
    const rights = (await db.query("SELECT has_table_privilege('proof_indexer','proof_indexer.work_transfer_projection_pages','SELECT') AS r," +
      "has_table_privilege('proof_indexer','proof_indexer.work_transfer_projection_pages','INSERT') AS w," +
      "has_table_privilege('proof_indexer','proof_indexer.work_transfer_projection_pages','UPDATE') AS u," +
      "has_table_privilege('proof_indexer','proof_indexer.work_transfer_projection_pages','DELETE') AS d")).rows[0];
    assert.deepEqual(rights, { r: true, w: true, u: false, d: false });
    await Promise.all([db,second].map(async c => {
      await c.query("BEGIN"); await storeWorkTransferProjection(c, prepared); await c.query("COMMIT");
    }));
    assert.equal(await pageCount(db, ref), 3);
    await db.query("BEGIN READ ONLY");
    assert.deepEqual(await readWorkTransferProjection(db, ref, ref), projection);
    await db.query("COMMIT");

    const args = [ref.network, ref.snapshotId];
    await db.query("BEGIN");
    await db.query("DELETE FROM proof_indexer.work_transfer_projection_pages WHERE network=$1 AND snapshot_id=$2 AND page_index=1", args);
    assert.equal(await eligible(db, ref), false);
    await assert.rejects(readWorkTransferProjection(db, ref, ref), /missing|page identity/); await db.query("ROLLBACK");
    await db.query("BEGIN");
    await db.query("UPDATE proof_indexer.work_transfer_projection_pages SET payload=set_byte(payload,0,0) WHERE network=$1 AND snapshot_id=$2 AND page_index=0", args);
    await assert.rejects(readWorkTransferProjection(db, ref, ref), /digest|SyntaxError|manifest|JSON|record/);
    await assert.rejects(storeWorkTransferProjection(db, prepared), /conflict/); await db.query("ROLLBACK");
    await db.query("BEGIN");
    await db.query("INSERT INTO proof_indexer.work_transfer_projection_pages(network,snapshot_id,page_index,payload) VALUES($1,$2,3,$3)", [...args,Buffer.from("extra")]);
    await assert.rejects(readWorkTransferProjection(db, ref, ref), /extra pages/); await db.query("ROLLBACK");

    await db.query("BEGIN");
    await db.query("UPDATE proof_indexer.ledger_snapshots SET payload=jsonb_set(payload,'{summaryPayloads,workSummary,workTransferValueProjection,payloadBytes}',to_jsonb('malformed'::text)) WHERE network=$1 AND snapshot_id=$2", args);
    assert.equal(await eligible(db, ref), false); await db.query("ROLLBACK");
    await db.query("BEGIN");
    await db.query("UPDATE proof_indexer.ledger_snapshots SET payload=jsonb_set(payload,'{summaryPayloads,workSummary,workTransferValueProjection}',$3::jsonb) WHERE network=$1 AND snapshot_id=$2", [...args,projection]);
    assert.equal(await eligible(db, ref), true); await db.query("ROLLBACK");
    const fork = prepareWorkTransferProjection({ ...projection, items: [{ branch: "fork" }] },
      { ...referenceFor(), indexedThroughBlockHash: "b".repeat(64) });
    await db.query("BEGIN"); await writeParent(db, fork.reference); await storeWorkTransferProjection(db, fork); await db.query("COMMIT");
    assert.deepEqual(await readWorkTransferProjection(db, ref, ref), projection);
    await assert.rejects(readWorkTransferProjection(db, ref, fork.reference), /reference identity/);

    await db.query("DELETE FROM proof_indexer.ledger_snapshots WHERE network=$1 AND snapshot_id=$2", args);
    assert.equal(await pageCount(db, ref), 0);
    assert.equal(await pageCount(db, fork.reference), fork.reference.pageCount);
    await assert.rejects(readWorkTransferProjection(db, ref, ref), /snapshot does not bind/);
  } finally {
    await db.query("ROLLBACK").catch(() => {}); await second.query("ROLLBACK").catch(() => {});
    db.release(); second.release(); await pool.end();
  }
});
