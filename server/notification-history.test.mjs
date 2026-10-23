import test from "node:test";
import assert from "node:assert/strict";
import { proofIndexEventHistoryPayload } from "./db/proof-index-reader.mjs";
import { notificationTransactionSql } from "./notification-query.mjs";
import { buildDnsPageLinkPayload } from "../src/shared/protocol/dnsPages.mjs";

const AUTHOR = "1F1zepCJ8VPcPoeMt6G4BPKuE3CYAxCKNY";
const OTHER = "1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV";
const hash = value => value.repeat(64);
const snapshot = { snapshot_id: hash("e"), indexed_through_block: 100,
  generated_at: "2026-10-23T12:00:00.000Z", payload: { indexedThroughBlockHash: hash("f") } };

test("notification SQL uses current-status eligible leaders and exact address semantics", () => {
  const sql = notificationTransactionSql("$3", "$2", "$4");
  assert.match(sql, /earlier.status = e.status/u);
  assert.match(sql, /earlier.block_height = e.block_height/u);
  assert.match(sql, /earlier.kind NOT LIKE 'token-%'/u);
  assert.match(sql, /np.address = \$3/u);
  assert.doesNotMatch(sql, /lower\(np.address\) = lower\(/u);
  assert.match(sql, /ns.block_height <= \$2/u);
  assert.match(sql, /prior.block_height <= \$2/u);
});

const pglitePath = process.env.POW_NOTIFICATION_TEST_PGLITE;
test("real PostgreSQL executes transaction grouping, relations, scope and snapshot continuation", { skip: !pglitePath }, async () => {
  const { PGlite } = await import(pglitePath);
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA proof_indexer;
      CREATE TABLE proof_indexer.blocks(network text,height integer,block_hash text,canonical boolean);
      CREATE TABLE proof_indexer.transactions(network text,txid text,status text,block_height integer,block_index integer,
        block_hash text,first_seen_at timestamptz,updated_at timestamptz,fee_sats bigint,raw_tx jsonb);
      CREATE TABLE proof_indexer.events(event_id bigint PRIMARY KEY,network text,txid text,protocol text,kind text,status text,
        valid boolean,block_height integer,block_index integer,op_return_vout integer,record_ordinal integer,
        event_time timestamptz,block_time timestamptz,created_at timestamptz,updated_at timestamptz,payload jsonb);
      CREATE TABLE proof_indexer.event_participants(event_id bigint,address text,role text,powid text);
      CREATE TABLE proof_indexer.tx_inputs(network text,txid text,address text);
      CREATE TABLE proof_indexer.tx_outputs(network text,txid text,address text);
      CREATE TABLE proof_indexer.event_refs(event_id bigint,ref_type text,ref_value text);`);
    const inserted = new Set();
    let nextId = 0;
    async function event(txid, fields = {}, people = []) {
      const id = ++nextId, height = fields.height ?? id + 10;
      const time = `2026-10-23T10:${String(id).padStart(2, "0")}:00.000Z`;
      if (!inserted.has(txid)) {
        inserted.add(txid);
        await db.query("INSERT INTO proof_indexer.blocks VALUES ('livenet',$1,$2,true)", [height, hash("f")]);
        await db.query("INSERT INTO proof_indexer.transactions VALUES ('livenet',$1,'confirmed',$2,0,$3,$4,$4,100,'{}')", [txid,height,hash("f"),time]);
      }
      const payload = { network: "livenet", txid, protocol: fields.protocol ?? "pwm1", kind: fields.kind ?? "mail", valid: fields.valid ?? true,
        senderAddress: fields.sender ?? OTHER, createdAt: time, ...fields.payload };
      await db.query(`INSERT INTO proof_indexer.events VALUES ($1,'livenet',$2,$3,$4,$5,$6,$7,0,$8,0,$9,$9,$9,$9,$10)`,
        [id,txid,payload.protocol,payload.kind,fields.status ?? "confirmed",payload.valid,height,fields.vout ?? id,time,JSON.stringify(payload)]);
      for (const [address,role] of people) await db.query("INSERT INTO proof_indexer.event_participants VALUES ($1,$2,$3,'')",[id,address,role]);
      return id;
    }
    await db.query("INSERT INTO proof_indexer.blocks VALUES ('livenet',100,$1,true)",[hash("f")]);
    const original = await event(hash("a"),{height:11,sender:AUTHOR,payload:{memo:"<!doctype html><html>Page</html>"}},[[AUTHOR,"sender"],[AUTHOR,"recipient"]]);
    await event(hash("a"),{height:11,protocol:"pwb1",kind:"boost-post",sender:AUTHOR,payload:{authorAddress:AUTHOR}},[[AUTHOR,"author"]]);
    const like = await event(hash("b"),{height:20,protocol:"pwb1",kind:"boost-like",payload:{targetTxid:hash("a")}},[[OTHER,"author"]]);
    await db.query("INSERT INTO proof_indexer.event_refs VALUES ($1,'target-txid',$2)",[like,hash("a")]);
    await event(hash("c"),{height:30,payload:{recipients:[{address:AUTHOR,amountSats:"546"}]}},[[AUTHOR,"recipient"],[OTHER,"sender"]]);
    await event(hash("d"),{height:40,status:"orphaned"},[[AUTHOR,"recipient"]]);
    await event(hash("d"),{height:40},[[AUTHOR,"recipient"]]);
    await event(hash("1"),{height:50,protocol:"pwdns1",kind:"dns-page1",valid:false,payload:{payload:buildDnsPageLinkPayload({action:"set",name:"example",epoch:{txid:hash("9"),protocolVout:1,recordOrdinal:0},pageTxid:hash("a")})}},[[OTHER,"sender"]]);
    await event(hash("2"),{height:60,protocol:"pwdns1",kind:"dns-update",payload:{currentOwnerAddress:AUTHOR}},[[AUTHOR,"owner"],[AUTHOR,"participant"]]);
    const queries = [];
    const client = { query: async (sql,values) => { queries.push(sql); return db.query(sql,values); }, release() {} };
    const options = { pool: { connect: async () => client }, readSnapshot: async () => snapshot, notificationAddress: AUTHOR };
    const params = new URLSearchParams({status:"all",limit:"2"});
    const first = await proofIndexEventHistoryPayload("livenet",params,options);
    assert.equal(first.totalCount,5,"Compound carriers count once; stale leader and encoded DNS links remain visible; current-owner-only does not match.");
    assert.equal(first.items.length,2);
    assert.equal(first.notificationGroups.length,2);
    const seen = new Set(first.items.map(item=>item.txid));
    let page = first;
    while (page.hasMore) {
      params.set("cursor",page.nextCursor);
      page = await proofIndexEventHistoryPayload("livenet",params,options);
      for (const item of page.items) { assert.ok(!seen.has(item.txid)); seen.add(item.txid); }
    }
    assert.equal(seen.size,5);
    assert.ok(seen.has(hash("d")),"A stale lower event ID does not hide current transaction evidence.");
    assert.ok(seen.has(hash("1")),"Encoded Page reference not present in event_refs is selected.");
    assert.equal(page.nextCursor,"");
    const all = await proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all",limit:"100"}),options);
    assert.equal(all.notificationGroups.find(group=>group.txid===hash("a")).events.length,2);
    assert.ok(all.notificationGroups.every(group=>group.firstSeenAt));
    assert.ok(queries.some(sql=>sql.includes("REPEATABLE READ READ ONLY")));
    const changedCase = await proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all"}),{...options,notificationAddress:AUTHOR.toLowerCase()});
    assert.equal(changedCase.totalCount,0);
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all",cursor:first.nextCursor}),{...options,notificationAddress:OTHER}),error=>error.statusCode===409);
    let clientsHeld = 0;
    const scopedPool = { connect: async () => {
      assert.equal(clientsHeld, 0, "A nested reader never waits behind its own retained client."); clientsHeld += 1;
      return { query: client.query, release() { clientsHeld -= 1; } };
    } };
    const callbacks = { ...options, pool: scopedPool, relatedTransactionIds: async basis => {
      assert.equal(clientsHeld, 0, "Protocol projection runs after preflight COMMIT and release.");
      assert.equal(basis.snapshotId, snapshot.snapshot_id);
      assert.match(basis.sourceFingerprint, /^[a-f0-9]{64}$/u);
      return { txids: [hash("b")], references: [{ txid: hash("1"), sourceTxid: hash("a") }] };
    } };
    const supplemented = await proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all",limit:"100"}),callbacks);
    assert.equal(supplemented.totalCount,5); assert.equal(clientsHeld,0);
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all"}),{
      ...callbacks, relatedTransactionIds: async () => ({ txids: [hash("8")], references: [] }),
    }), error => error.statusCode === 503, "Unrepresented supplemental evidence cannot disappear into complete coverage.");
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all"}),{
      ...callbacks, relatedTransactionIds: async () => ({ txids: [], references: [{txid:hash("1"),sourceTxid:hash("8")}] }),
    }), error => error.statusCode === 503, "Missing referenced authorship fails complete attribution.");
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all"}),{
      ...callbacks, relatedTransactionIds: async () => {
        assert.equal(clientsHeld,0);
        await db.query("UPDATE proof_indexer.events SET updated_at='2026-10-23T12:30:00Z' WHERE event_id=$1",[original]);
        return [];
      },
    }), error => error.statusCode === 409, "Mutation during the released callback cannot mix source snapshots.");
    assert.equal(clientsHeld,0);
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all"}),{
      ...callbacks, relatedTransactionIds: async () => {
        await db.query("DELETE FROM proof_indexer.events WHERE event_id=$1",[like]);
        return [];
      },
    }), error => error.statusCode === 409, "Deletion of a non-max source row invalidates its authority cache key and callback fence.");
    assert.equal(clientsHeld,0);
    await db.query("UPDATE proof_indexer.events SET updated_at='2026-10-23T13:00:00Z' WHERE event_id=$1",[original]);
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all",cursor:first.nextCursor}),options),error=>error.statusCode===409);
    await db.query("UPDATE proof_indexer.blocks SET block_hash=$1 WHERE height=100",[hash("0")]);
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all"}),options),error=>error.statusCode===409);
  } finally { await db.close(); }
});
