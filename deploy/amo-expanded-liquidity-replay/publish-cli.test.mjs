import assert from "node:assert/strict";
import test from "node:test";
import { checkRawQualification, parsePublicationArgs } from "./publish-cli.mjs";
import { qualifyExpandedLiquidityReplay } from "./qualify.mjs";
import { scenario } from "./fixtures/replay.mjs";

test("publication CLI requires an explicit mode, evidence digests, and the current Search hold for publication", () => {
  const source = "a".repeat(64), qualification = "b".repeat(64), hold = "c".repeat(64);
  const args = ["/private/source",source,"/private/qualification",qualification,"/private/receipt"];
  assert.equal(parsePublicationArgs(["publish",...args,hold]).holdSha,hold);
  for (const mode of ["rehearse","verify"]) assert.equal(parsePublicationArgs([mode,...args]).mode,mode);
  for (const invalid of [[...args],["publish",...args],["verify",...args,hold],
    ["publish",...args,"bad"],["rehearse","relative",...args.slice(1)]]) {
    assert.throws(()=>parsePublicationArgs(invalid),/Use MODE/u);
  }
});

test("publication fence checks declared transaction, prevout and exact serialized bytes of every qualified block", async () => {
  const {options} = scenario();
  const q = await qualifyExpandedLiquidityReplay(options);
  await checkRawQualification(q,options);
  const changedBlock = q.blocks.at(-1);
  await assert.rejects(checkRawQualification(q,{...options,readRawBlock:async hash =>
    hash === changedBlock.hash ? "00".repeat(changedBlock.rawBlockBytes) : options.readRawBlock(hash)}), /block bytes differ/u);
  const lostPrevout = {...await options.readDeclarationEvidence(),prevoutTransactionHex:"00"};
  await assert.rejects(checkRawQualification(q,{...options,readDeclarationEvidence:async()=>lostPrevout}));
});
