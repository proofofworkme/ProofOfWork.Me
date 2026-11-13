// Display-only product scenario. Never imported by canonical accounting/replay.
// Keep growthForecast.mjs and its October 6 arithmetic as historical comparison.
import { GROWTH_MODEL_INPUTS, GROWTH_VALUE_LANES, GROWTH_PRODUCT_COVERAGE,
  growthModelRow, growthModelStartRow, growthFeeMultiplier } from "./growthForecast.mjs";
// Versioned scenario limits, checked against the canonical encoder in tests.
const POWCAT_MAX_FILE_BYTES = 4_000_000;
const POWCAT_MAX_PART_BYTES = 96_000;

export const CURRENT_GROWTH_MODEL_VERSION = "2026-11-12-products-v2";
export const CURRENT_GROWTH_MODEL_DATE = "2026-11-12";
// These are illustrative workload assumptions, not measured current usage.
export const CURRENT_GROWTH_INPUTS = Object.freeze({
  feeRate: 0.1,
  dnsRegistrationsPerIdPerYear: 0.1,
  dnsMutationsPerIdPerYear: 0.1,
  dnsOwnerActionsPerIdPerYear: 0.2,
  dnsSalesPerIdPerYear: 0.02,
  dnsCancelledListingsPerIdPerYear: 0.005,
  dnsAverageSaleSats: 1_000,
  dnsRegistrationVbytes: 350,
  dnsMutationVbytes: 350,
  dnsOwnerActionVbytes: 1_000,
  permissionActionsPerIdPerYear: 0.1,
  permissionVbytes: 1_200,
  jobsPerIdPerYear: 0.1,
  jobMailRecords: 4,
  jobFiles: 1,
  jobMetadataVbytes: 350,
  publishArticlesPerIdPerYear: 1,
  publishInlineBytes: 16_000,
  boostMediaPerIdPerYear: 0.5,
  linkedPublicationShare: 0.01,
  linkedBytes: POWCAT_MAX_FILE_BYTES,
});

function finiteNonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid scenario ${name}`);
}

// One input/change envelope per stage is a 210-vB scenario allowance, not a
// wallet quote. Binary part and manifest framing come from powcat1. Delivery
// is counted once, separate from publication parts + linker; it owns payment.
export function growthPublicationFootprint(size, linked = false) {
  if (!Number.isSafeInteger(size) || size < 1 || size > POWCAT_MAX_FILE_BYTES) {
    throw new Error("Scenario content size must be 1–4,000,000 bytes");
  }
  if (!linked) {
    if (size > POWCAT_MAX_PART_BYTES) throw new Error("Large scenario content requires linked publication");
    return { parts: 0, transactions: 1, vbytes: size + 210 };
  }
  const parts = Math.ceil(size / POWCAT_MAX_PART_BYTES);
  // 75-byte part headers; 48-byte manifest header + assumed 64-byte name/MIME;
  // canonical push/output framing conservatively allowed 16 bytes per stage.
  const vbytes = size + parts * (75 + 210 + 16) +
    48 + 64 + parts * 32 + 210 + 16 + 500;
  return { parts, transactions: parts + 2, vbytes };
}

export function currentGrowthModelRow(horizon, scenario = CURRENT_GROWTH_INPUTS, baseInputs = GROWTH_MODEL_INPUTS) {
  for (const key of Object.keys(CURRENT_GROWTH_INPUTS)) finiteNonnegative(scenario[key], key);
  if (scenario.feeRate <= 0) throw new Error("Scenario fee rate must be positive");
  if (scenario.linkedPublicationShare > 1) throw new Error("Linked scenario share exceeds one");
  const large = growthPublicationFootprint(scenario.linkedBytes, true);
  const article = growthPublicationFootprint(scenario.publishInlineBytes);
  if (!(baseInputs.blockspaceVbytesPerYear > 0) || !Number.isFinite(baseInputs.blockspaceVbytesPerYear)) {
    throw new Error("Invalid scenario blockspace capacity");
  }
  const raw = growthModelRow(horizon, { ...baseInputs, canonicalFee: scenario.feeRate, blockspaceVbytesPerYear: Number.MAX_VALUE });
  const usage = (rate, elasticity) => raw.powids * rate * growthFeeMultiplier(scenario.feeRate, elasticity);
  const take = (pool, demand) => Math.min(Math.max(0, pool), demand);
  // Allocate shared Mail demand in declared order; never create copies of it.
  let mailPool = Math.max(0, raw.mailWrites - raw.boostOriginalPosts - raw.codeControlWrites);
  const permissionWrites = take(mailPool, usage(scenario.permissionActionsPerIdPerYear, baseInputs.elasticities.mail));
  mailPool -= permissionWrites;
  const jobsRequested = usage(scenario.jobsPerIdPerYear, baseInputs.elasticities.mail);
  const jobsMailWrites = take(mailPool, jobsRequested * scenario.jobMailRecords);
  mailPool -= jobsMailWrites;
  const publishWrites = take(mailPool, usage(scenario.publishArticlesPerIdPerYear, baseInputs.elasticities.mail));
  mailPool -= publishWrites;
  let filePool = Math.max(0, raw.driveWrites - raw.codeSourcePuts);
  const jobsFileWrites = take(filePool, usage(scenario.jobsPerIdPerYear * scenario.jobFiles, baseInputs.elasticities.drive));
  filePool -= jobsFileWrites;
  const boostMediaWrites = take(filePool, usage(scenario.boostMediaPerIdPerYear, baseInputs.elasticities.drive));
  filePool -= boostMediaWrites;
  // Linked size sensitivity applies to Files + Boost media and Publish body;
  // Code, job attachments and HTML retain their declared carrier averages.
  const fileLinked = (filePool + boostMediaWrites) * scenario.linkedPublicationShare;
  const articleLinked = publishWrites * scenario.linkedPublicationShare;
  const linkedPublications = fileLinked + articleLinked;
  const linkedExtraWrites = linkedPublications * (large.transactions - 1);
  const contentExtraVbytes = fileLinked * (large.vbytes - baseInputs.driveVbytesPerWrite) +
    articleLinked * (large.vbytes - baseInputs.driveVbytesPerWrite) +
    (publishWrites - articleLinked) * (article.vbytes - baseInputs.mailVbytesPerWrite) +
    permissionWrites * (scenario.permissionVbytes - baseInputs.mailVbytesPerWrite) +
    (jobsMailWrites + jobsFileWrites) * scenario.jobMetadataVbytes;
  const dnsRegistrations = usage(scenario.dnsRegistrationsPerIdPerYear, baseInputs.elasticities.id);
  const dnsMutations = usage(scenario.dnsMutationsPerIdPerYear, baseInputs.elasticities.computerEvent);
  const dnsOwnerActions = usage(scenario.dnsOwnerActionsPerIdPerYear, baseInputs.elasticities.computerEvent);
  const dnsSales = usage(scenario.dnsSalesPerIdPerYear, baseInputs.elasticities.marketplace);
  const dnsCancelledListings = usage(scenario.dnsCancelledListingsPerIdPerYear, baseInputs.elasticities.marketplace);
  const dnsMarketWrites = dnsSales * baseInputs.marketplaceSaleWrites + dnsCancelledListings * baseInputs.marketplaceCancellationWrites;
  const dnsRegistryFlowSats = dnsRegistrations * 1_000 + dnsMutations * 546;
  const dnsMarketFlowSats = dnsSales * scenario.dnsAverageSaleSats + dnsMarketWrites * 546;
  const dnsSats = dnsRegistryFlowSats * baseInputs.valueMultiple;
  const dnsMarketSats = dnsMarketFlowSats * baseInputs.valueMultiple;
  const dnsVbytes = dnsRegistrations * scenario.dnsRegistrationVbytes +
    dnsMutations * scenario.dnsMutationVbytes + dnsOwnerActions * scenario.dnsOwnerActionVbytes +
    dnsMarketWrites * baseInputs.marketplaceVbytesPerWrite;
  // Linked Publish delivery is Files, not ordinary Mail. Reclassify its
  // existing payment and carrier before accounting for extra publication bytes.
  const articleCarrierReclassificationVbytes = articleLinked * (baseInputs.driveVbytesPerWrite - baseInputs.mailVbytesPerWrite);
  const rawBlockspaceVbytes = raw.rawBlockspaceVbytes + articleCarrierReclassificationVbytes + contentExtraVbytes + dnsVbytes;
  const ratio = Math.min(1, baseInputs.blockspaceVbytesPerYear / rawBlockspaceVbytes);
  // Scale the original already-disjoint flow/physical fields exactly once. ID
  // stock remains the original unthrottled scenario, not a new chain valuation.
  const row = { ...raw };
  const scaled = ["idWrites", "mailWrites", "driveWrites", "browserWrites", "tokenWrites", "tokenCreateWrites", "tokenMintWrites",
    "walletWrites", "walletGenericTransferWrites", "walletWorkTransferWrites", "infinityWrites", "inceptionWrites", "computerEventWrites",
    "computerEventActions", "idRegistrationFlowSats", "idMutationFlowSats", "boostWrites", "boostOriginalPosts", "boostPaidActions",
    "boostSales", "boostVbytes", "marketplaceWrites", "codeSourcePuts", "codeControlWrites", "codeWrites", "codeVbytes", "workMovementWrites"];
  for (const key of [...scaled, ...GROWTH_VALUE_LANES.map(lane => lane.key).filter(key => key !== "idSats")]) row[key] *= ratio;
  row.marketplaceByAsset = Object.fromEntries(Object.entries(raw.marketplaceByAsset).map(([key, fields]) =>
    [key, Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, value * ratio]))]));
  const linkedArticleShare = raw.mailWrites > 0 ? articleLinked / raw.mailWrites : 0;
  const linkedArticlePayment = row.mailSats * linkedArticleShare;
  row.mailSats *= 1 - linkedArticleShare;
  row.driveSats += linkedArticlePayment;
  row.mailWrites = (raw.mailWrites - articleLinked) * ratio;
  row.driveWrites += articleLinked * ratio;
  row.marketplaceSats += dnsMarketSats * ratio;
  row.marketplaceWrites += dnsMarketWrites * ratio;
  row.dnsSats = dnsSats * ratio;
  row.dnsRegistryFlowSats = dnsRegistryFlowSats * ratio;
  row.dnsMarketSats = dnsMarketSats * ratio;
  row.dnsRegistrations = dnsRegistrations * ratio;
  row.dnsMutations = dnsMutations * ratio;
  row.dnsOwnerActions = dnsOwnerActions * ratio;
  row.dnsMarketWrites = dnsMarketWrites * ratio;
  row.dnsSales = dnsSales * ratio;
  row.dnsCancelledListings = dnsCancelledListings * ratio;
  row.permissionWrites = permissionWrites * ratio;
  row.jobsMailWrites = jobsMailWrites * ratio;
  row.jobsFileWrites = jobsFileWrites * ratio;
  row.jobsWrites = (jobsMailWrites + jobsFileWrites) * ratio;
  row.publishWrites = publishWrites * ratio;
  row.publishInlineWrites = (publishWrites - articleLinked) * ratio;
  row.publishLinkedWrites = articleLinked * ratio;
  row.pagesWrites = raw.browserWrites * ratio;
  row.boostMediaWrites = boostMediaWrites * ratio;
  row.otherMailWrites = mailPool * ratio;
  row.otherFileWrites = filePool * ratio;
  row.linkedPublications = linkedPublications * ratio;
  row.linkedExtraWrites = linkedExtraWrites * ratio;
  row.contentExtraVbytes = contentExtraVbytes * ratio;
  row.dnsVbytes = dnsVbytes * ratio;
  row.blockspaceUsageRatio = ratio;
  row.rawBlockspaceVbytes = rawBlockspaceVbytes;
  row.executedBlockspaceVbytes = rawBlockspaceVbytes * ratio;
  row.totalWrites = (raw.totalWrites + dnsRegistrations + dnsMutations + dnsOwnerActions + dnsMarketWrites + linkedExtraWrites) * ratio;
  row.totalSats = GROWTH_VALUE_LANES.reduce((sum, lane) => sum + row[lane.key], row.dnsSats);
  row.totalUsdBase = row.totalSats / 100_000_000 * row.btcUsdBase;
  row.workFloorSats = row.totalSats / baseInputs.workMaxSupply;
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "number" && (!Number.isFinite(value) || (key !== "contentExtraVbytes" && value < 0))) throw new Error(`Invalid scenario result ${key}`);
  }
  return row;
}

export const CURRENT_GROWTH_MODEL_ROWS = GROWTH_MODEL_INPUTS.horizons.map(h => currentGrowthModelRow(h));
// No new activity is backfilled into the observed May origin.
export const CURRENT_GROWTH_MODEL_CHART_ROWS = [growthModelStartRow(), ...CURRENT_GROWTH_MODEL_ROWS];

const updates = {
  dns: { modeledLane: "dnsSats; DNS trades in marketplaceSats", assumption: "Illustrative DNS registrations, mutations and sale lifecycles have explicit demand and bytes. Subdomains/page links consume bytes but their owner self-payments add no new value." },
  permission: { modeledLane: "Mail subset: permissionWrites", assumption: "0.1 grant/replacement/revocation records per projected ID/year before inherited fee elasticity, capped by available Mail demand. Existing Mail value counts once; no Permission registry fee." },
  jobs: { modeledLane: "Mail / Files subsets: jobsWrites", assumption: "0.1 illustrative job lifecycle per projected ID/year: four Mail records and one file delivery, capped by carrier demand. Offered rewards are not payments; no invented reward value is added." },
  publish: { modeledLane: "Mail / Files subsets: publishWrites; linkedExtraWrites", assumption: "One illustrative article per projected ID/year before inherited elasticity, capped by content demand; linked delivery moves to Files with the same assumed payment. 16,000-byte inline bodies and 1% at 4 MB are scenario assumptions, not measured publishing behavior." },
  pages: { modeledLane: "browserSats; pagesWrites (nonadditive)", assumption: "Explicit alias of the existing one HTML publication per projected ID/year at 15,000 vB before inherited elasticity. Reading or linking the same page adds no second content payment." },
  files: { modeledLane: "driveSats; linkedExtraWrites", assumption: "General Files and Boost media include an illustrative 1% 4 MB linked-publication tail. Parts and linker add transactions/bytes, not another file payment. Code and Jobs retain their carrier-size assumptions." },
  amo: { modeledLane: "marketplaceSats (including DNS); Boost sales in boostSats", assumption: "Explicit DNS sale/cancellation basket joins IDs, credits, WORK, POWB and INCB. Seller price and registry fees count once; ticket principal/refunds do not." },
};
export const CURRENT_GROWTH_PRODUCT_COVERAGE = GROWTH_PRODUCT_COVERAGE.map(item => ({ ...item, ...updates[item.product] }));
