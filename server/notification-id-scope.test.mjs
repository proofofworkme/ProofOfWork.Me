import test from "node:test";
import assert from "node:assert/strict";
import { notificationIdKey, notificationIdScopeFromRegistry, notificationIdLifecycleTxids, notificationIdMatches, notificationIdDirection } from "./notification-id-scope.mjs";
import { proofIndexEventHistoryPayload } from "./db/proof-index-reader.mjs";
import { notificationAction } from "./notifications.mjs";

const txid = value => value.repeat(64);
const encoded = value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const scope = { type: "id", id: "alice", registrationTxid: txid("a") };
const root = { event_id: "1", txid: scope.registrationTxid, protocol: "pwid1", kind: "id-register", status: "confirmed", valid: true,
  block_height: 10, block_index: 0, op_return_vout: 1, record_ordinal: 0, raw_payload: `pwid1:r2:${encoded("Alice")}:oldOwner:oldReceiver`, payload: {} };
const row = (index, raw, extra = {}) => ({ ...root, event_id: String(index), txid: txid(index.toString(16)), block_height: 10 + index,
  protocol: raw.split(":")[0], kind: "record", raw_payload: raw, ...extra });

test("ID scope binds accepted registration identity, not current owner or display spelling", () => {
  assert.equal(notificationIdKey(" @ALIce@proofofwork.me "), "alice");
  const event = { confirmed: true, kind: "id-register", id: "ALICE", txid: root.txid };
  assert.deepEqual(notificationIdScopeFromRegistry({ activity: [event], records: [{id:"alice",ownerAddress:"newOwner"}] }, "@alice"), scope);
  assert.throws(() => notificationIdScopeFromRegistry({ activity: [] }, "alice"), error => error.statusCode === 404);
  assert.throws(() => notificationIdScopeFromRegistry({ activity: [{...event,valid:false}] }, "alice"), error => error.statusCode === 404);
  assert.throws(() => notificationIdScopeFromRegistry({ activity: [event,{...event,txid:txid("b")}] }, "alice"), error => error.statusCode === 503);
  assert.deepEqual(notificationIdLifecycleTxids({ activity:[event,{...event,kind:"id-transfer",txid:txid("b")},
    {...event,kind:"id-update",valid:false,txid:txid("c")},{...event,kind:"id-update",id:"other",txid:txid("d")}] },scope),[txid("a"),txid("b")]);
});

test("all ID lifecycle forms remain linked across ownership and receiver changes", () => {
  const rows = [root,
    row(2,`pwid1:u:${encoded("alice")}:nextReceiver`), row(3,`pwid1:t:${encoded("alice")}:nextOwner:nextReceiver`),
    row(4,`pwid1:list2:${encoded({id:"alice"})}`), row(5,`pwid1:buy2:${encoded({id:"alice"})}:buyer`),
    row(6,`pwid1:list3:${encoded({id:"alice"})}`), row(7,`pwid1:buy3:${txid("6")}:buyer`),
    row(8,`pwid1:list4:${encoded({id:"alice"})}`), row(9,`pwid1:delist4:${txid("8")}`),
    row(10,`pwid1:list5:${encoded({id:"alice"})}`), row(11,`pwid1:seal5:${txid("a")}:${encoded({id:"alice"})}`),
    row(12,`pwid1:buy5:${txid("a")}:buyer`), row(13,`pwid1:delist5:${txid("a")}`),
  ];
  // Keep the listing txid distinct from the registration txid.
  rows[9].txid = txid("e"); rows[10].raw_payload = `pwid1:seal5:${txid("e")}:${encoded({id:"alice"})}`;
  rows[11].raw_payload = `pwid1:buy5:${txid("e")}:buyer`; rows[12].raw_payload = `pwid1:delist5:${txid("e")}`;
  const result = notificationIdMatches(rows,scope);
  assert.equal(result.matches.length,rows.length);
  assert.equal(result.matches.find(match=>match.eventId==="7").source,"id-listing-reference");
  assert.ok(result.matches.every(match=>notificationIdDirection(match)==="related"));
});

test("raw Boost IDs retain precise claimed-author and target roles without trusting enriched IDs", () => {
  const rows = [root,
    row(2,`pwb1:follow:${encoded({targetId:"ALICE",targetAddress:"oldReceiver"})}`),
    row(3,`pwb1:unfollow:${encoded({targetId:"alice",targetAddress:"oldReceiver"})}`),
    row(4,`pwb1:profile:${encoded({id:"alice"})}`),
    row(5,`pwb1:reply:${txid("f")}:${encoded({profileId:"alice",text:"hello"})}`),
    row(6,`pwb1:post:${encoded({text:"hello @alice"})}`,{payload:{authorId:"alice",currentOwnerId:"alice",participants:["oldOwner"]}}),
    row(7,"pwm1:m:alice",{payload:{id:"alice",senderAddress:"oldOwner"}}),
    row(8,`pwdns1:r1:${encoded("alice")}:oldOwner:oldReceiver`,{payload:{id:"alice"}}),
  ];
  const result = notificationIdMatches(rows,scope);
  assert.deepEqual(result.matches.map(match=>match.eventId),["1","2","3","4","5"]);
  assert.equal(notificationIdDirection(result.matches[1]),"incoming");
  assert.equal(notificationIdDirection(result.matches[3]),"outgoing");
  assert.equal(notificationIdDirection(undefined),"related");
  const action=notificationAction({protocol:"pwb1",kind:"boost-follow",txid:txid("2"),notificationIdMatch:result.matches[1],
    actor:"oldOwner",recipientAddress:"newOwner",confirmed:true,valid:true},null,"livenet");
  assert.equal(action.direction,"incoming");assert.equal(action.evidence.idReference.registrationTxid,scope.registrationTxid);
  assert.equal(notificationAction({protocol:"pwm1",kind:"mail",txid:txid("8"),actor:"oldOwner",confirmed:true},null,"livenet").direction,"related");
});

test("registration boundary excludes earlier claims; pending and rejected attempts never remap identity", () => {
  const rows = [root,
    row(2,`pwb1:follow:${encoded({targetId:"alice"})}`,{block_height:9}),
    row(3,`pwid1:u:${encoded("alice")}:attacker`,{status:"pending",block_height:null,block_index:null}),
    row(4,`pwid1:t:${encoded("alice")}:attacker`,{valid:false}),
    row(5,`pwb1:follow:${encoded({targetId:"other"})}`,{payload:{targetId:"alice",currentOwnerId:"alice"}}),
  ];
  assert.deepEqual(notificationIdMatches(rows,scope).matches.map(match=>match.eventId),["1","3","4"]);
  assert.throws(()=>notificationIdMatches([{...root,valid:false}],scope),error=>error.statusCode===503);
  assert.throws(()=>notificationIdMatches([root,{...root,event_id:"2"}],scope),error=>error.statusCode===503);
  assert.throws(()=>notificationIdMatches([root,row(3,`pwid1:u:${encoded("alice")}:receiver`,{block_index:null})],scope),error=>error.statusCode===503);
});

test("listing references require earlier confirmed source and never follow an unrelated listing", () => {
  const rows=[root,row(2,`pwid1:list5:${encoded({id:"alice"})}`,{status:"pending",block_height:null}),
    row(3,`pwid1:buy5:${txid("2")}:buyer`,{status:"pending",block_height:null}),
    row(4,`pwid1:list5:${encoded({id:"other"})}`),row(5,`pwid1:buy5:${txid("4")}:buyer`),
    row(6,`pwid1:delist5:${txid("7")}`),row(7,`pwid1:list5:${encoded({id:"alice"})}`)];
  assert.deepEqual(notificationIdMatches(rows,scope).matches.map(match=>match.eventId),["1","2","7"]);
});

const pglitePath = process.env.POW_NOTIFICATION_TEST_PGLITE;
test("real SQL ID pages use registration identity, exact carrier matches and all transaction siblings", {skip:!pglitePath}, async()=>{
  const {PGlite}=await import(pglitePath); const db=new PGlite();
  try {
    await db.exec(`CREATE SCHEMA proof_indexer;
      CREATE TABLE proof_indexer.blocks(network text,height integer,block_hash text,canonical boolean);
      CREATE TABLE proof_indexer.transactions(network text,txid text,status text,block_height integer,block_index integer,block_hash text,first_seen_at timestamptz,updated_at timestamptz,fee_sats bigint,raw_tx jsonb);
      CREATE TABLE proof_indexer.events(event_id bigint PRIMARY KEY,network text,txid text,protocol text,kind text,status text,valid boolean,block_height integer,block_index integer,op_return_vout integer,record_ordinal integer,event_time timestamptz,block_time timestamptz,created_at timestamptz,updated_at timestamptz,raw_payload text,payload jsonb);
      CREATE TABLE proof_indexer.event_participants(event_id bigint,address text,role text,powid text);
      CREATE TABLE proof_indexer.event_refs(event_id bigint,ref_type text,ref_value text);`);
    const rows=[root,row(2,`pwid1:t:${encoded("alice")}:nextOwner:nextReceiver`,{kind:"id-transfer"}),
      row(3,`pwb1:follow:${encoded({targetId:"alice"})}`,{kind:"boost-follow"}),
      row(4,`pwm1:m:unrelated former-owner activity`,{kind:"mail",payload:{senderAddress:"oldOwner",authorId:"alice"}}),
      row(5,`pwm1:m:compound sibling`,{kind:"mail",txid:txid("3"),block_height:13}),
      row(6,`pwid1:r2:${encoded("other")}:oldOwner:oldReceiver`,{kind:"id-register"})];
    const seen=new Set();
    for(const source of rows){
      const time=`2026-10-23T10:${String(source.block_height).padStart(2,"0")}:00.000Z`;
      if(!seen.has(source.txid)){seen.add(source.txid);await db.query("INSERT INTO proof_indexer.blocks VALUES('livenet',$1,$2,true)",[source.block_height,txid("f")]);
        await db.query("INSERT INTO proof_indexer.transactions VALUES('livenet',$1,'confirmed',$2,0,$3,$4,$4,100,'{}')",[source.txid,source.block_height,txid("f"),time]);}
      const payload={...source.payload,txid:source.txid,protocol:source.protocol,kind:source.kind,valid:true,payload:source.raw_payload,senderAddress:"oldOwner",createdAt:time};
      await db.query("INSERT INTO proof_indexer.events VALUES($1,'livenet',$2,$3,$4,$5,$6,$7,0,$8,0,$9,$9,$9,$9,$10,$11)",[source.event_id,source.txid,source.protocol,source.kind,source.status,source.valid,source.block_height,Number(source.event_id),time,source.raw_payload,JSON.stringify(payload)]);
      await db.query("INSERT INTO proof_indexer.event_participants VALUES($1,'oldOwner','author','alice')",[source.event_id]);
    }
    await db.query("INSERT INTO proof_indexer.blocks VALUES('livenet',100,$1,true)",[txid("f")]);
    const snapshot={snapshot_id:txid("e"),indexed_through_block:100,generated_at:"2026-10-23T12:00:00Z",payload:{indexedThroughBlockHash:txid("f")}};
    const client={query:(sql,values)=>db.query(sql,values),release(){}};
    const options={pool:{connect:async()=>client},readSnapshot:async()=>snapshot,notificationIdScope:scope};
    const params=new URLSearchParams({status:"all",limit:"1"});
    let page=await proofIndexEventHistoryPayload("livenet",params,options);const first=page;
    assert.equal(page.totalCount,3);assert.equal(page.scopeKey,`id:${scope.registrationTxid}`);
    assert.equal(page.notificationGroups[0].events.length,2);
    assert.equal(page.notificationGroups[0].events.filter(item=>item.notificationIdMatch).length,1,"A sibling is inspectable without being falsely attributed to the ID.");
    const txids=[];
    while(true){txids.push(...page.items.map(item=>item.txid));if(!page.hasMore)break;params.set("cursor",page.nextCursor);page=await proofIndexEventHistoryPayload("livenet",params,options);}
    assert.equal(new Set(txids).size,3);assert.ok(!txids.includes(txid("4")));
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all",cursor:first.nextCursor}),{...options,notificationIdScope:{type:"id",id:"other",registrationTxid:txid("6")}}),error=>error.statusCode===409);
    await assert.rejects(proofIndexEventHistoryPayload("livenet",new URLSearchParams({status:"all"}),{...options,relatedTransactionIds:async()=>({txids:[txid("4")]})}),error=>error.statusCode===503);
  }finally{await db.close();}
});
