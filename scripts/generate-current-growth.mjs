import { mkdirSync, writeFileSync } from "node:fs";
import { CURRENT_GROWTH_MODEL_VERSION, CURRENT_GROWTH_MODEL_DATE, CURRENT_GROWTH_INPUTS,
  CURRENT_GROWTH_MODEL_CHART_ROWS, CURRENT_GROWTH_PRODUCT_COVERAGE, currentGrowthModelRow } from "../src/features/growth/currentGrowthModel.mjs";
import { GROWTH_MODEL_INPUTS, GROWTH_MODEL_START_DATE, GROWTH_MODEL_VERSION } from "../src/features/growth/growthForecast.mjs";
function canonical(value) {
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Invalid scenario output"); return Number(value.toPrecision(12)); }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const model=canonical({version:CURRENT_GROWTH_MODEL_VERSION,generatedOn:CURRENT_GROWTH_MODEL_DATE,
  baselineDate:GROWTH_MODEL_START_DATE,canonicalAccounting:false,calibratedToCurrentActivity:false,
  basis:"Illustrative annual activity at historical May horizons, not a current-year prediction. Shared carrier demand is partitioned, never duplicated. ID stock remains the inherited unthrottled N-squared assumption. Historical USD path is not a quote.",
  historicalComparison:GROWTH_MODEL_VERSION,
  limitations:["WORK revaluation, exact Q16 settlements, batch recipient distributions and endogenous feedback are not simulated.",
    "Linked-publication envelopes, size mix and all new usage rates are assumptions, not measured costs or wallet quotes.",
    "A model row does not enable capability, prove transaction admission or change any confirmed balance or record.",
    "Jobs offered rewards add nothing; accepted payment behavior is covered only by existing shared carrier assumptions.",
    "DNS owner self-payments and linked parts/linkers have no added scenario payment value. DNS trades appear only in AMO.",
    "Standalone social payment estimates use direct owner payments; historical Boost registry wording is not current policy."],
  inheritedInputs:GROWTH_MODEL_INPUTS,scenarioInputs:CURRENT_GROWTH_INPUTS,
  productCoverage:CURRENT_GROWTH_PRODUCT_COVERAGE,chartRows:CURRENT_GROWTH_MODEL_CHART_ROWS,
  sizeSensitivity:[0,0.01,0.1,1].map(linkedPublicationShare=>({linkedPublicationShare,
    rows:GROWTH_MODEL_INPUTS.horizons.map(h=>currentGrowthModelRow(h,{...CURRENT_GROWTH_INPUTS,linkedPublicationShare}))}))});
const root=`output/proofofwork-computer-growth-model-${model.version}`;
mkdirSync("output",{recursive:true});
writeFileSync(root+".json",JSON.stringify(model,null,2)+"\n");
const number=value=>Number(value).toLocaleString("en-US",{maximumFractionDigits:2});
writeFileSync(root+".md",[
  "# ProofOfWork Computer Growth: current-product scenario", "",
  `Version: \`${model.version}\`. Revised ${model.generatedOn}. Origin: ${model.baselineDate}.`, "",
  "This version updates product workload coverage, not current chain calibration. Every new rate and size mix is an illustrative assumption. It is not a prediction, treasury valuation, canonical WORK floor or signing quote. October 6 and May scenarios remain preserved.", "",
  "## New explicit assumptions", "",
  "| Input | Illustrative value |", "| --- | ---: |",
  ...Object.entries(model.scenarioInputs).map(([key,value])=>`| ${key} | ${String(value)} |`), "",
  "Rates are per projected ID per year before inherited lane elasticity. Fee-rate sensitivity uses 0.1 proof/vB in this scenario rather than the historical 0.00001. Mail allocations follow Boost originals, Code controls, Permission, Jobs controls, then Publish; Files allocate Code, Jobs delivery, Boost media, then other files. Shared allocations are capped by remaining carrier demand. Linked Publish delivery moves from Mail to Files with its same assumed payment once. Pages owns the existing HTML basket. DNS is an explicit additional registry/market workload. DNS subdomains/page links consume blockspace but owner self-payments do not add value.", "",
  "At 96,000 bytes per part, 4 MB requires 42 parts, a linker and a paid delivery: 44 transactions. Only 43 are additional to the already-counted delivery. Parts/linker add bytes and writes, not a second file payment. The illustrative 1% large-content tail applies to general Files, Boost media and Publish, not Code/Jobs/HTML. Existing file reuse and reading do not republish bytes. All physical activity shares one annual cap. Higher payload demand can reduce other executed activity; it does not create free capacity.", "",
  "## Horizon results", "",
  "Counts are annual executed scenario rates at horizons measured from May 11, not cumulative counts or months from today. Values are display estimates; published numeric serialization is rounded to 12 significant digits.", "",
  "| Horizon | Scenario total (proofs) | Transactions | DNS registrations | Permission | Jobs records | Articles | Linked publications | Capacity executed |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...model.chartRows.slice(1).map(r=>`| ${r.label} | ${number(r.totalSats)} | ${number(r.totalWrites)} | ${number(r.dnsRegistrations)} | ${number(r.permissionWrites)} | ${number(r.jobsWrites)} | ${number(r.publishWrites)} | ${number(r.linkedPublications)} | ${number(r.blockspaceUsageRatio*100)}% |`), "",
  "## Scope and limits", "", ...model.limitations.map(s=>`- ${s}`), "",
  "The JSON contains complete inherited/new assumptions, 23 product allocations, baseline and rows, plus 0%, 1%, 10% and 100% large-content sensitivity cases. The shared pure model source is `src/features/growth/currentGrowthModel.mjs`; run `npm run model:growth:current` to reproduce both files.", ""
].join("\n"));
