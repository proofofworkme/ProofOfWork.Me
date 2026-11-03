// Add repository ownership, independent publication and reference reuse to the
// real Core fixture. No RPC or wallet is used outside that private test chain.
import assert from "node:assert/strict";
import { address as chainAddress, networks } from "bitcoinjs-lib";
import { encodeCodeRepository, encodeCodeLinkedCommit } from "../src/shared/protocol/codeRepository.mjs";
import { encodePowcatPart, encodePowcatManifest, powcatSha256 } from "../src/shared/protocol/powcat1.mjs";
import { codeLinkedSourceFromCore, codeTransactionFromRow } from "../server/db/code-reader.mjs";
import { createCodeSnapshot, codeRepositoryPayload } from "../server/code-repositories.mjs";

export async function checkLinkedCode({rpc,sign,mine,broadcast,readFileFromCore,dataOutput,address,existing}) {
  const network = "regtest";
  const payOwner = {script:chainAddress.toOutputScript(address,networks.regtest),value:546n};
  const checked = new Map();
  async function confirmCode(payload) {
    const signed=await sign([payOwner,dataOutput(Buffer.from("pwm1:m:Repository update")),dataOutput(Buffer.from(payload))],3_000);
    await broadcast(signed);
    const [blockHash]=await mine();
    const block=await rpc("getblock",[blockHash,2]);
    const index=block.tx.findIndex(tx => tx.txid===signed.txid);
    const raw=await rpc("getrawtransaction",[signed.txid,true,blockHash]);
    for (const input of raw.vin) input.prevout=(await rpc("getrawtransaction",[input.txid,true])).vout[input.vout];
    raw.canonicalBlockScan={height:block.height,blockIndex:index,blockHash};
    const row={txid:signed.txid,status:"confirmed",block_height:block.height,block_hash:blockHash,block_index:index,
      block_time:new Date(block.time*1000).toISOString(),raw_tx:raw,outputs:raw.vout.map((vout,i) => ({
        vout:i,scriptpubkey:vout.scriptPubKey.hex,value_sats:Math.round(vout.value*100_000_000)}))};
    checked.set(signed.txid,codeTransactionFromRow(row,network)); return signed.txid;
  }
  const repo=await confirmCode(encodeCodeRepository({v:1,name:"Regtest repository",description:"Linked source and binary assets"}));
  const verified=new Map();
  async function publication(txid) {
    const file=await readFileFromCore(txid);
    verified.set(txid,file);
    return file;
  }
  const ref=(parent,path,file,kind) => encodeCodeLinkedCommit({v:3,repo,parent,op:"reference",path,message:"Commit verified linked file",
    sourceTxid:file.txid,sourceKind:"powcat1",contentKind:kind,mime:file.mime,sha256:file.fileHash,size:file.size});
  const binary=await publication(existing);
  assert.equal(binary.size,4_000_000);
  const binaryHead=await confirmCode(ref(repo,"assets/archive.bin",binary,"binary"));
  const text=Buffer.from("\ufeff"+("export const documentText = '<script>never execute</script>'; // café\r\n").repeat(3250));
  const fileHash=powcatSha256(text), partTxids=[];
  const count=Math.ceil(text.length/96_000);
  for (let i=0;i<count;i++) {
    const part=await sign([dataOutput(encodePowcatPart({fileHash,index:i,count,bytes:text.subarray(i*96_000,(i+1)*96_000)}))],100_000);
    await broadcast(part); partTxids.push(part.txid);
  }
  await mine();
  const link=await sign([dataOutput(encodePowcatManifest({fileHash,size:text.length,name:"module.ts",mime:"text/plain",partTxids}))],3_000);
  await broadcast(link); await mine();
  const code=await publication(link.txid);
  const stale=await confirmCode(ref(repo,"src/module.ts",code,"text"));
  const head=await confirmCode(ref(binaryHead,"src/module.ts",code,"text"));
  async function state() {
    const tip=await rpc("getblockchaininfo");
    const call=async (method,args) => {
      try { return {ok:true,result:await rpc(method,args)}; }
      catch(error) { return {ok:false,error:{code:error.code,message:error.message}}; }
    };
    const linkedSources=new Map();
    for (const txid of verified.keys()) linkedSources.set(txid,await codeLinkedSourceFromCore({
      txid,network,checkpointHeight:tip.blocks,checkpointHash:tip.bestblockhash},call,{chain:"regtest"}));
    return createCodeSnapshot({network,checkpointHeight:tip.blocks,checkpointHash:tip.bestblockhash,transactions:[...checked.values()],
      linkedSources,linkedReferencePolicy:{network,activationHeight:1}});
  }
  const snapshot=await state();
  assert.deepEqual(snapshot.repositories[0].files.map(f=>[f.path,f.sourceTxid,f.sha256]),
    [["assets/archive.bin",existing,binary.fileHash],["src/module.ts",link.txid,fileHash]]);
  assert.equal(snapshot.repositories[0].headTxid,head);
  assert(snapshot.events.find(e=>e.txid===stale).validationErrors.includes("code-parent-stale"));
  for (const [path,file] of [["src/module.ts",code],["assets/archive.bin",binary]]) {
    const detail=codeRepositoryPayload(snapshot,new URLSearchParams({repo,version:head,path})).file;
    assert.equal(detail.verified,true); assert.equal(detail.sourceTxid,file.txid);
    assert.equal(detail.size,file.size); assert.equal(detail.sha256,file.fileHash);
    // Tree metadata and selected path receipts do not inline megabytes of content.
    assert(Buffer.byteLength(JSON.stringify(detail))<48_000);
    assert.deepEqual(Buffer.from((await readFileFromCore(detail.sourceTxid)).bytes),Buffer.from(file.bytes));
  }
  const earlier=codeRepositoryPayload(snapshot,new URLSearchParams({repo,version:binaryHead}));
  assert.deepEqual(earlier.files.map(f=>f.path),["assets/archive.bin"]);
  assert.equal(snapshot.events.filter(e=>e.applied && e.kind==="code-commit").length,2);
  assert(Buffer.from(code.bytes).equals(text));
  console.log(JSON.stringify({regtestCode:true,repo,head,importedBinary:existing,newSource:link.txid,textParts:count,staleRejected:stale}));
}
