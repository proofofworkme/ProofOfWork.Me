import test from "node:test";
import assert from "node:assert/strict";
import { addressTransactionNotification, createAddressNotificationReader } from "./notification-address-history.mjs";

const hash = value => value.repeat(64);
const address = "1ExactCaseAddress", other = "1OtherAddress";
const output = (owner, value) => ({ scriptpubkey_address: owner, scriptpubkey: "00", value });
const tx = (txid, recipient = address) => ({ txid, status: {confirmed:true,block_height:10,block_hash:hash("f"),block_time:100},
  vin:[{txid:hash("e"),vout:0,prevout:output(other,1000)}],vout:[output(recipient,900)] });
function readWithMissing(override) {
  const protocol={id:`livenet:${hash("b")}`,txid:hash("b"),status:"confirmed",direction:"incoming",
    evidence:{blockHeight:20,chainStatus:"confirmed"},recipientAddresses:[address],actions:[{txid:hash("b"),kind:"mail"}]};
  const initial={model:"proof-computer-notifications-v1",network:"livenet",address,snapshotId:"ledger",maxEventId:42,maxUpdatedAt:"stable",
    indexedThroughBlock:30,indexedThroughBlockHash:hash("f"),items:[protocol],totalCount:1,hasMore:false,nextCursor:"",
    readBoundary:{maxFirstSeenAt:"2026-10-23T00:00:00Z",maxEventId:42},coverage:{complete:true,qualification:[]}};
  return createAddressNotificationReader({readProtocolPage:async()=>initial,
    readAddressHistory:async()=>[{tx_hash:hash("a"),height:10},{tx_hash:hash("b"),height:20}],
    verifyCheckpoint:async()=>{},canonicalHash:async()=>hash("f"),now:()=>1000,
    hydrateTransaction:async txid=>txid===hash("a") ? override(tx(txid)) : tx(txid)});
}

test("complete read boundary excludes unverified raw evidence even when the bad row is on a later page", async t=>{
  const cases=[
    ["unrelated address",transaction=>({...transaction,vout:[output(other,900)]}),503],
    ["missing prevout",transaction=>({...transaction,vin:[{txid:hash("e"),vout:0}]}),503],
    ["wrong transaction",transaction=>({...transaction,txid:hash("c")}),503],
    ["changed confirmation",transaction=>({...transaction,status:{confirmed:false}}),409],
    ["changed canonical block",transaction=>({...transaction,status:{...transaction.status,block_hash:hash("d")}}),409],
  ];
  for(const [name,mutate,status] of cases) await t.test(name,async()=>{
    const read=readWithMissing(mutate);
    await assert.rejects(read("livenet",address,new URLSearchParams({limit:"1"})),error=>error.statusCode===status,
      "Page one must not claim complete coverage or offer Mark all read for evidence that fails only on page two.");
  });
});

test("a known Computer carrier on a later page blocks complete generic-only coverage",async()=>{
  const payload=Buffer.from("pwm1:m:hello"),script=Buffer.concat([Buffer.from([0x6a,payload.length]),payload]).toString("hex");
  const read=readWithMissing(transaction=>({...transaction,vout:[...transaction.vout,{scriptpubkey:script,value:0}]}));
  await assert.rejects(read("livenet",address,new URLSearchParams({limit:"1"})),error=>error.statusCode===503);
});

test("malformed spending outpoints cannot become exact transaction evidence",()=>{
  const transaction=tx(hash("a"));transaction.vin[0].vout=-1;
  assert.throws(()=>addressTransactionNotification(transaction,{txid:hash("a"),height:10},address,"livenet",hash("f"),"2026-10-23T00:00:00Z"),
    error=>error.statusCode===503);
});
