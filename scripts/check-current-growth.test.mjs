import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURRENT_GROWTH_INPUTS as defaults, CURRENT_GROWTH_MODEL_VERSION, CURRENT_GROWTH_MODEL_ROWS,
  CURRENT_GROWTH_MODEL_CHART_ROWS, CURRENT_GROWTH_PRODUCT_COVERAGE, currentGrowthModelRow, growthPublicationFootprint } from "../src/features/growth/currentGrowthModel.mjs";
import { GROWTH_MODEL_INPUTS as base, GROWTH_MODEL_ROWS, GROWTH_MODEL_VERSION, GROWTH_VALUE_LANES, growthModelRow, growthModelStartRow } from "../src/features/growth/growthForecast.mjs";
import { encodePowcatPart, encodePowcatManifest, POWCAT_MAX_FILE_BYTES, POWCAT_MAX_PART_BYTES } from "../src/shared/protocol/powcat1.mjs";
const horizon = { label: "two IDs", years: 1, adoption: 1 };
const roomy = { ...base, bitnodesReachableNodes: 2, agentShare: 1, nodeCagr: 0, blockspaceVbytesPerYear: 1e30 };
const scenario = { ...defaults, feeRate: 0.01 };
const close = (a, b) => assert.ok(Math.abs(a-b) <= Math.max(1, Math.abs(b))*1e-10, `${a} != ${b}`);
const quiet = { ...scenario, dnsRegistrationsPerIdPerYear: 0, dnsMutationsPerIdPerYear: 0, dnsOwnerActionsPerIdPerYear: 0,
  dnsSalesPerIdPerYear: 0, dnsCancelledListingsPerIdPerYear: 0, permissionActionsPerIdPerYear: 0,
  jobsPerIdPerYear: 0, publishArticlesPerIdPerYear: 0, linkedPublicationShare: 0 };

test("new dated product scenario preserves October arithmetic and May origin", () => {
  assert.equal(CURRENT_GROWTH_MODEL_VERSION, "2026-11-12-products-v2");
  assert.equal(GROWTH_MODEL_VERSION, "2026-10-06-code-v1");
  assert.deepEqual(CURRENT_GROWTH_MODEL_CHART_ROWS[0], growthModelStartRow());
  assert.deepEqual(GROWTH_MODEL_ROWS, base.horizons.map(h => growthModelRow(h)));
  assert.notEqual(CURRENT_GROWTH_MODEL_ROWS[1].totalSats, GROWTH_MODEL_ROWS[1].totalSats);
});

test("zero extra product demand exactly reproduces October lanes at the selected fee rate", () => {
  const old = growthModelRow(horizon, { ...roomy, canonicalFee: quiet.feeRate });
  const fresh = currentGrowthModelRow(horizon, quiet, roomy);
  for (const key of ["totalSats", "totalWrites", "rawBlockspaceVbytes", "executedBlockspaceVbytes", ...GROWTH_VALUE_LANES.map(x=>x.key)]) close(fresh[key], old[key]);
});

test("DNS registry, AMO and owner-only writes are disjoint", () => {
  const before = currentGrowthModelRow(horizon, quiet, roomy);
  const row = currentGrowthModelRow(horizon, {...quiet, dnsRegistrationsPerIdPerYear: 1,
    dnsMutationsPerIdPerYear: 1, dnsOwnerActionsPerIdPerYear: 1, dnsSalesPerIdPerYear: 1, dnsCancelledListingsPerIdPerYear: 1}, roomy);
  assert.equal(row.dnsSats, 2 * (1000+546)*5);
  assert.equal(row.dnsMarketSats, 2 * (1000+5*546)*5);
  close(row.marketplaceSats-before.marketplaceSats, row.dnsMarketSats);
  close(row.totalSats-before.totalSats, row.dnsSats+row.dnsMarketSats);
  close(row.totalWrites-before.totalWrites, 2*(1+1+1+3+2));
  close(row.dnsVbytes, 2*(350+350+1000+5*500));
  const ownerOnly = currentGrowthModelRow(horizon, {...quiet,dnsOwnerActionsPerIdPerYear: 1},roomy);
  assert.equal(ownerOnly.totalSats, before.totalSats);
  assert.equal(ownerOnly.totalWrites, before.totalWrites+2);
});

test("shared product allocations partition Mail and Files without duplicating payment", () => {
  const before=currentGrowthModelRow(horizon,quiet,roomy);
  const row=currentGrowthModelRow(horizon,{...quiet, permissionActionsPerIdPerYear: 10, jobsPerIdPerYear: 10, publishArticlesPerIdPerYear: 10},roomy);
  assert.equal(row.totalSats,before.totalSats);
  assert.equal(row.totalWrites,before.totalWrites);
  close(row.mailWrites, row.boostOriginalPosts+row.codeControlWrites+row.permissionWrites+row.jobsMailWrites+row.publishInlineWrites+row.otherMailWrites);
  close(row.driveWrites,row.codeSourcePuts+row.jobsFileWrites+row.boostMediaWrites+row.otherFileWrites+row.publishLinkedWrites);
  assert.equal(row.jobsWrites,row.jobsMailWrites+row.jobsFileWrites);
  assert.equal(row.pagesWrites,row.browserWrites);
});

test("4 MB means 42 parts plus linker and delivery, not a 4 MB transaction", () => {
  assert.equal(POWCAT_MAX_FILE_BYTES,4_000_000);
  assert.equal(POWCAT_MAX_PART_BYTES,96_000);
  for (const [size,parts] of [[1,1],[96000,1],[96001,2],[4000000,42]]) {
    const f=growthPublicationFootprint(size,true);
    assert.equal(f.parts,parts);
    assert.equal(f.transactions,parts+2);
    assert.ok(f.vbytes>size);
  }
  assert.deepEqual(growthPublicationFootprint(16000),{parts:0,transactions:1,vbytes:16210});
  const hash="a".repeat(64);
  const part=encodePowcatPart({fileHash:hash,index:0,count:42,bytes:new Uint8Array(1)});
  assert.equal(part.length-1,75);
  const ids=Array.from({length:42},(_,i)=>i.toString(16).padStart(64,"0"));
  const manifest=encodePowcatManifest({fileHash:hash,size:4000000,name:"article.md",mime:"text/markdown",partTxids:ids});
  assert.equal(manifest.length,48+10+13+42*32);
});

test("linked parts add bytes and physical writes, never another file or article payment", () => {
  const noLarge=currentGrowthModelRow(horizon,{...scenario,linkedPublicationShare:0},roomy);
  const allLarge=currentGrowthModelRow(horizon,{...scenario,linkedPublicationShare:1},roomy);
  assert.equal(noLarge.totalSats,allLarge.totalSats);
  close(allLarge.totalWrites-noLarge.totalWrites,allLarge.linkedPublications*43);
  assert.equal(allLarge.linkedExtraWrites,allLarge.linkedPublications*43);
  assert.ok(allLarge.rawBlockspaceVbytes>noLarge.rawBlockspaceVbytes);
});

test("all physical lanes including parts and DNS share one cap; derived WORK is nonadditive", () => {
  for (const h of base.horizons) for (const share of [0,0.01,0.1,1]) {
    const row=currentGrowthModelRow(h,{...defaults,linkedPublicationShare:share});
    const bytes=row.idWrites*base.idVbytesPerWrite + row.mailWrites*base.mailVbytesPerWrite +
      row.driveWrites*base.driveVbytesPerWrite + row.browserWrites*base.browserVbytesPerPage +
      row.tokenMintWrites*base.tokenVbytesPerWrite + row.tokenCreateWrites*base.creditCreateVbytesPerWrite +
      row.boostVbytes + (row.marketplaceWrites-row.dnsMarketWrites)*base.marketplaceVbytesPerWrite +
      row.walletWrites*base.walletVbytesPerTransfer + row.infinityWrites*base.infinityVbytesPerAction +
      row.inceptionWrites*base.inceptionVbytesPerAction + row.computerEventWrites*base.idMutationVbytesPerWrite +
      row.codeVbytes+row.contentExtraVbytes+row.dnsVbytes;
    close(bytes,row.executedBlockspaceVbytes);
    assert.ok(bytes<=base.blockspaceVbytesPerYear*(1+1e-12));
    close(row.totalWrites,row.idWrites+row.mailWrites+row.driveWrites+row.browserWrites+row.tokenWrites+
      row.boostWrites+row.marketplaceWrites+row.walletWrites+row.infinityWrites+row.inceptionWrites+row.computerEventWrites+
      row.dnsRegistrations+row.dnsMutations+row.dnsOwnerActions+row.linkedExtraWrites);
    close(row.totalSats,GROWTH_VALUE_LANES.reduce((sum,x)=>sum+row[x.key],row.dnsSats));
    assert.equal(row.workFloorSats,row.totalSats/21000000);
    close(row.workMovementWrites,row.walletWorkTransferWrites+row.marketplaceByAsset.work.sales);
  }
});

test("higher linked size pressure reduces executed activity under the same cap", () => {
  const h=base.horizons.at(-1);
  const low=currentGrowthModelRow(h,{...defaults,linkedPublicationShare:0});
  const high=currentGrowthModelRow(h,{...defaults,linkedPublicationShare:1});
  assert.ok(high.rawBlockspaceVbytes>low.rawBlockspaceVbytes);
  assert.ok(high.blockspaceUsageRatio<low.blockspaceUsageRatio);
  assert.ok(high.publishWrites<low.publishWrites);
  assert.ok(high.dnsRegistrations<low.dnsRegistrations);
  assert.equal(high.idSats,low.idSats);
});

test("invalid or incomplete scenario inputs fail instead of rendering NaN", () => {
  for (const value of [NaN,Infinity,-1,undefined]) assert.throws(()=>currentGrowthModelRow(horizon,{...defaults,jobsPerIdPerYear:value}));
  for (const value of [0,4000001,1.5]) assert.throws(()=>growthPublicationFootprint(value,true));
  assert.throws(()=>growthPublicationFootprint(96001));
  assert.throws(()=>currentGrowthModelRow(horizon,{...defaults,linkedPublicationShare:1.01}));
  assert.throws(()=>currentGrowthModelRow(horizon,{...defaults,feeRate:0}));
  assert.throws(()=>currentGrowthModelRow(horizon,defaults,{...roomy,blockspaceVbytesPerYear:0}));
});

test("complete product coverage distinguishes new demand, shared and read-only roles", () => {
  assert.equal(CURRENT_GROWTH_PRODUCT_COVERAGE.length,23);
  assert.equal(new Set(CURRENT_GROWTH_PRODUCT_COVERAGE.map(x=>x.product)).size,23);
  for(const product of ["dns","permission","jobs","publish","pages","files"]) assert.doesNotMatch(CURRENT_GROWTH_PRODUCT_COVERAGE.find(x=>x.product===product).modeledLane,/No standalone|no separate forecast/);
  for(const product of ["home","search","growth","log"]) assert.equal(CURRENT_GROWTH_PRODUCT_COVERAGE.find(x=>x.product===product).modeledLane,"No incremental lane");
  const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
  assert.match(app,/option value="october"/);
  assert.match(app,/Current products ·/);
  assert.match(app,/These are not live counts/);
});


test("linked Publish moves one delivery and the same payment from Mail to Files", () => {
  const input={...scenario,permissionActionsPerIdPerYear:0,jobsPerIdPerYear:0};
  const ample={...roomy,bitnodesReachableNodes:100};
  const inline=currentGrowthModelRow(horizon,{...input,linkedPublicationShare:0},ample);
  const linked=currentGrowthModelRow(horizon,{...input,linkedPublicationShare:1},ample);
  assert.ok(linked.publishLinkedWrites>0);
  assert.equal(linked.publishInlineWrites,0);
  close(inline.mailWrites-linked.mailWrites,linked.publishLinkedWrites);
  close(linked.driveWrites-inline.driveWrites,linked.publishLinkedWrites);
  close(inline.mailSats-linked.mailSats,linked.publishLinkedWrites*base.mailSatsPerDelivery*base.valueMultiple);
  close(linked.driveSats-inline.driveSats,inline.mailSats-linked.mailSats);
  close(inline.totalSats,linked.totalSats);
});


test("Jobs Mail controls and file delivery use their own inherited fee curves", () => {
  const ample={...roomy,bitnodesReachableNodes:100};
  const row=currentGrowthModelRow(horizon,{...quiet,jobsPerIdPerYear:0.1,feeRate:0.1},ample);
  close(row.jobsMailWrites,100*0.1*defaults.jobMailRecords*Math.pow(0.01/0.1,base.elasticities.mail));
  close(row.jobsFileWrites,100*0.1*defaults.jobFiles*Math.pow(0.01/0.1,base.elasticities.drive));
});


test("published assumptions retain exact values rather than rounded result formatting", () => {
  const report=readFileSync(new URL("../output/proofofwork-computer-growth-model-2026-11-12-products-v2.md",import.meta.url),"utf8");
  for (const [key,value] of Object.entries(defaults)) assert.ok(report.includes(`| ${key} | ${String(value)} |`),key);
  assert.match(report,/dnsCancelledListingsPerIdPerYear \| 0\.005 \|/u);
});
