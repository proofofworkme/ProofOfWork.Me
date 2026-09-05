import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  GROWTH_MODEL_INPUTS,
  GROWTH_MODEL_ROWS,
  GROWTH_MODEL_CHART_ROWS,
  GROWTH_MODEL_VERSION,
  GROWTH_PRODUCT_COVERAGE,
  GROWTH_ASSUMPTIONS,
  GROWTH_VALUE_LANES,
  GROWTH_MODEL_LIMITATIONS,
  growthModelRow,
  BOOST_GROWTH_MODEL_INPUTS,
  BOOST_GROWTH_MODEL_ROWS,
  BOOST_GROWTH_MODEL_CHART_ROWS,
  GROWTH_MODEL_START_DATE,
  BOOST_GROWTH_MODEL_VERSION,
  LEGACY_GROWTH_MODEL_ROWS,
  LEGACY_GROWTH_MODEL_CHART_ROWS,
  boostGrowthModelRow,
} from "../src/features/growth/growthForecast.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const modelOutput = `output/proofofwork-computer-growth-model-${BOOST_GROWTH_MODEL_VERSION}`;

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-11, `${message}: ${actual} != ${expected}`);
}

function assertFiniteTree(value) {
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  else if (value && typeof value === "object") Object.values(value).forEach(assertFiniteTree);
}

test("prior frontend value, narrower Boost origin, and historical date are retained", () => {
  assert.equal(GROWTH_MODEL_START_DATE, "2026-05-11");
  const priorTotals = [
    21382700330.851665,
    82990187666.32108,
    218426924131.72232,
    973977667859.9232,
    12855391934947.438,
    12830149720545114,
    1.1097759761172899e21,
  ];
  LEGACY_GROWTH_MODEL_ROWS.forEach((row, i) => close(row.totalSats, priorTotals[i], row.label));
  assert.deepEqual(BOOST_GROWTH_MODEL_CHART_ROWS[0], LEGACY_GROWTH_MODEL_CHART_ROWS[0]);
  assert.equal(BOOST_GROWTH_MODEL_CHART_ROWS[0].powids, 94);
  assert.equal(BOOST_GROWTH_MODEL_CHART_ROWS[0].boostSats, 0);
  for (const [key, value] of Object.entries(LEGACY_GROWTH_MODEL_CHART_ROWS[0])) {
    assert.equal(GROWTH_MODEL_CHART_ROWS[0][key], value, `all-product origin ${key}`);
  }
});

test("zero Boost demand reproduces prior monetary values and capacity ratio", () => {
  const inputs = {
    ...BOOST_GROWTH_MODEL_INPUTS,
    boostOriginalPostsPerIdPerYear: 0,
    boostPaidActionsPerIdPerYear: 0,
    boostSalesPerIdPerYear: 0,
  };
  inputs.horizons.forEach((horizon, index) => {
    const row = boostGrowthModelRow(horizon, inputs);
    const legacy = LEGACY_GROWTH_MODEL_ROWS[index];
    for (const key of ["totalSats", "totalUsdBase", "idSats", "mailSats", "driveSats", "marketplaceSats", "browserSats", "tokenSats", "blockspaceUsageRatio"]) {
      assert.equal(row[key], legacy[key], `${horizon.label}: ${key}`);
    }
    assert.equal(row.boostSats, 0);
    assert.equal(row.boostWrites, 0);
    assert.equal(row.boostVbytes, 0);
  });
});

test("every executed physical lane shares one capacity cap, including IDs", () => {
  const inputs = BOOST_GROWTH_MODEL_INPUTS;
  assertFiniteTree(BOOST_GROWTH_MODEL_CHART_ROWS);
  BOOST_GROWTH_MODEL_ROWS.forEach((row, i) => {
    const executedBytes =
      row.idWrites * inputs.idVbytesPerWrite +
      row.mailWrites * inputs.mailVbytesPerWrite +
      row.driveWrites * inputs.driveVbytesPerWrite +
      row.marketplaceWrites * inputs.marketplaceVbytesPerSale +
      row.browserWrites * inputs.browserVbytesPerPage +
      row.tokenWrites * inputs.tokenVbytesPerWrite + row.boostVbytes;
    close(executedBytes, row.executedBlockspaceVbytes, `${row.label} physical bytes`);
    assert.ok(executedBytes <= inputs.blockspaceVbytesPerYear * (1 + 1e-12));
    assert.equal(row.idSats, LEGACY_GROWTH_MODEL_ROWS[i].idSats);
    close(row.totalSats, row.idSats + row.mailSats + row.driveSats + row.marketplaceSats + row.browserSats + row.tokenSats + row.boostSats, "product value sum");
    close(row.totalWrites, row.idWrites + row.mailWrites + row.driveWrites + row.marketplaceWrites + row.browserWrites + row.tokenWrites + row.boostWrites, "unique transaction demand");
    assert.ok(row.boostOriginalPosts <= row.mailWrites);
  });
  assert.ok(BOOST_GROWTH_MODEL_ROWS.at(-1).idWrites < LEGACY_GROWTH_MODEL_ROWS.at(-1).idWrites);
});

test("original Boost posts add metadata but never duplicate Mail transactions or value", () => {
  const horizon = BOOST_GROWTH_MODEL_INPUTS.horizons[0];
  const inputs = {
    ...BOOST_GROWTH_MODEL_INPUTS,
    blockspaceVbytesPerYear: 1e30,
    boostPaidActionsPerIdPerYear: 0,
    boostSalesPerIdPerYear: 0,
  };
  const withOriginals = boostGrowthModelRow(horizon, inputs);
  const withoutOriginals = boostGrowthModelRow(horizon, { ...inputs, boostOriginalPostsPerIdPerYear: 0 });
  assert.equal(withOriginals.boostSats, 0);
  assert.equal(withOriginals.boostWrites, 0);
  assert.equal(withOriginals.totalWrites, withoutOriginals.totalWrites);
  assert.equal(withOriginals.totalSats, withoutOriginals.totalSats);
  close(withOriginals.rawBlockspaceVbytes - withoutOriginals.rawBlockspaceVbytes, withOriginals.boostOriginalPosts * inputs.boostOriginalMetadataVbytes, "metadata-only delta");
  const saturatedOriginals = boostGrowthModelRow(horizon, { ...inputs, boostOriginalPostsPerIdPerYear: 1e15 });
  assert.equal(saturatedOriginals.boostOriginalPosts, saturatedOriginals.mailWrites);
});

test("paid actions and complete sales carry one explicit value/write allocation", () => {
  const inputs = {
    ...BOOST_GROWTH_MODEL_INPUTS,
    bitnodesReachableNodes: 1,
    agentShare: 1,
    nodeCagr: 0,
    canonicalFee: 0.01,
    blockspaceVbytesPerYear: 1e30,
  };
  const row = boostGrowthModelRow({ label: "one ID", years: 1, adoption: 1 }, inputs);
  assert.equal(row.boostOriginalPosts, 0); // One ID creates no directed Mail pair.
  assert.equal(row.boostPaidActions, 12);
  assert.equal(row.boostSales, 0.02);
  close(row.boostWrites, 12.06, "12 actions plus three mutations for each sale");
  close(row.boostSats, 33023.8, "registry fees and seller prices once, at 5x");
  assert.equal(row.boostVbytes, 6030);
  const cheaper = boostGrowthModelRow({ label: "one ID", years: 1, adoption: 1 }, { ...inputs, canonicalFee: 0.00001 });
  close(cheaper.boostPaidActions / row.boostPaidActions, Math.sqrt(1000), "declared fee elasticity");
});

const oneIdHorizon = { label: "one ID", years: 1, adoption: 1 };
function quietInputs(overrides = {}) {
  return {
    ...GROWTH_MODEL_INPUTS,
    bitnodesReachableNodes: 1,
    agentShare: 1,
    nodeCagr: 0,
    canonicalFee: 0.01,
    blockspaceVbytesPerYear: 1e30,
    mailMessagesPerPairPerYear: 0,
    driveFilesPerIdPerYear: 0,
    browserPagesPerIdPerYear: 0,
    tokenMintsPerIdPerYear: 0,
    creditCreatesPerIdPerYear: 0,
    boostOriginalPostsPerIdPerYear: 0,
    boostPaidActionsPerIdPerYear: 0,
    boostSalesPerIdPerYear: 0,
    walletGenericTransfersPerIdPerYear: 0,
    walletWorkTransfersPerIdPerYear: 0,
    infinityActionsPerIdPerYear: 0,
    inceptionActionsPerIdPerYear: 0,
    idMutationsPerIdPerYear: 0,
    marketplaceAssets: Object.fromEntries(Object.entries(GROWTH_MODEL_INPUTS.marketplaceAssets).map(([asset, value]) => [
      asset, { ...value, salesPerIdPerYear: 0, cancelledListingsPerIdPerYear: 0 },
    ])),
    ...overrides,
  };
}

test("all products and workspaces have explicit economic or shared ownership", () => {
  assert.deepEqual(GROWTH_PRODUCT_COVERAGE.map((product) => product.product).sort(), [
    "amo", "boost", "browser", "computer", "credit", "desktop", "files", "growth",
    "home", "ids", "inception", "infinity", "log", "mail", "wallet", "work",
  ]);
  for (const entry of GROWTH_PRODUCT_COVERAGE) {
    for (const field of ["name", "role", "owner", "modeledLane", "activity", "assumption", "source"]) {
      assert.ok(entry[field].length > 0, `${entry.product} ${field}`);
    }
  }
  assert.equal(new Set(GROWTH_VALUE_LANES.map((lane) => lane.key)).size, 11);
  assert.ok(!GROWTH_VALUE_LANES.some((lane) => /workFloor|workMovement|desktop|computerSats|log/i.test(lane.key)));
  for (const name of ["Home", "Log", "Growth"]) {
    assert.equal(GROWTH_PRODUCT_COVERAGE.find((entry) => entry.name === name).modeledLane, "No incremental lane");
  }
  assert.match(GROWTH_PRODUCT_COVERAGE.find((entry) => entry.name === "Computer").activity, /NFT/);
  assert.match(GROWTH_ASSUMPTIONS.find((entry) => entry.product === "Browser authoring").attribution, /exclusively/);
  assert.ok(GROWTH_MODEL_LIMITATIONS.some((line) => /endogenous live WORK revaluation/.test(line)));
});

test("all-product lanes share the physical cap and WORK remains nonadditive", () => {
  const inputs = GROWTH_MODEL_INPUTS;
  assertFiniteTree(GROWTH_MODEL_CHART_ROWS);
  GROWTH_MODEL_ROWS.forEach((row, i) => {
    const bytes = row.idWrites * inputs.idVbytesPerWrite +
      row.mailWrites * inputs.mailVbytesPerWrite + row.driveWrites * inputs.driveVbytesPerWrite +
      row.browserWrites * inputs.browserVbytesPerPage + row.tokenMintWrites * inputs.tokenVbytesPerWrite +
      row.tokenCreateWrites * inputs.creditCreateVbytesPerWrite + row.boostVbytes +
      row.marketplaceWrites * inputs.marketplaceVbytesPerWrite + row.walletWrites * inputs.walletVbytesPerTransfer +
      row.infinityWrites * inputs.infinityVbytesPerAction + row.inceptionWrites * inputs.inceptionVbytesPerAction +
      row.computerEventWrites * inputs.idMutationVbytesPerWrite;
    close(bytes, row.executedBlockspaceVbytes, `${row.label} all physical bytes`);
    assert.ok(bytes <= inputs.blockspaceVbytesPerYear * (1 + 1e-12));
    close(row.totalWrites, row.idWrites + row.mailWrites + row.driveWrites + row.browserWrites +
      row.tokenWrites + row.boostWrites + row.marketplaceWrites + row.walletWrites +
      row.infinityWrites + row.inceptionWrites + row.computerEventWrites, "unique physical transactions");
    close(row.totalSats, GROWTH_VALUE_LANES.reduce((total, lane) => total + row[lane.key], 0), "all eleven values sum once");
    assert.equal(row.idSats, LEGACY_GROWTH_MODEL_ROWS[i].idSats);
    assert.equal(row.workMovementWrites, row.walletWorkTransferWrites + row.marketplaceByAsset.work.sales);
    assert.equal(row.workFloorSats, row.totalSats / 21_000_000);
    assert.ok(row.boostOriginalPosts <= row.mailWrites);
  });
});

test("HTML authoring and file publication own their Mail carriers once", () => {
  const baseline = growthModelRow(oneIdHorizon, quietInputs());
  const page = growthModelRow(oneIdHorizon, quietInputs({ browserPagesPerIdPerYear: 1 }));
  const file = growthModelRow(oneIdHorizon, quietInputs({ driveFilesPerIdPerYear: 1 }));
  assert.equal(page.mailWrites, 0);
  assert.equal(page.driveWrites, 0);
  assert.equal(page.browserWrites, 1);
  close(page.totalWrites - baseline.totalWrites, 1, "one HTML carrier");
  close(page.totalSats - baseline.totalSats, 5_000, "one HTML payment");
  close(page.executedBlockspaceVbytes - baseline.executedBlockspaceVbytes, 15_000, "HTML byte basket");
  assert.equal(file.mailWrites, 0);
  assert.equal(file.browserWrites, 0);
  assert.equal(file.driveWrites, 1);
  close(file.totalWrites - baseline.totalWrites, 1, "one file carrier");
  close(file.totalSats - baseline.totalSats, 5_000, "one file payment");
  close(file.executedBlockspaceVbytes - baseline.executedBlockspaceVbytes, 9_621, "file byte basket");
});

test("bond direct payments exclude synthetic issuance and shared Mail/WORK duplication", () => {
  const baseline = growthModelRow(oneIdHorizon, quietInputs());
  const bonds = growthModelRow(oneIdHorizon, quietInputs({ infinityActionsPerIdPerYear: 1, inceptionActionsPerIdPerYear: 1 }));
  assert.equal(bonds.infinitySats, 5_000);
  assert.equal(bonds.inceptionSats, 5_000);
  assert.equal(bonds.tokenSats, 0);
  assert.equal(bonds.mailSats, 0);
  assert.equal(bonds.walletWrites, 0);
  assert.equal(bonds.workMovementWrites, 0);
  close(bonds.totalSats - baseline.totalSats, 10_000, "two direct payments, no issuance summand");
  close(bonds.totalWrites - baseline.totalWrites, 2, "two tagged carriers");
  close(bonds.executedBlockspaceVbytes - baseline.executedBlockspaceVbytes, 1_000, "two tagged carrier byte budgets");
});

test("ID and Credit fees preserve the 1,000/546 split without duplicate registration bytes", () => {
  const baseline = growthModelRow(oneIdHorizon, quietInputs());
  assert.equal(baseline.idWrites, 1);
  assert.equal(baseline.computerEventWrites, 0);
  assert.equal(baseline.computerEventActions, 1);
  assert.equal(baseline.idRegistrationFlowSats, 1_000);
  assert.equal(baseline.computerEventSats, 5_000);
  assert.equal(baseline.totalWrites, 1);
  assert.equal(baseline.executedBlockspaceVbytes, 350);
  const mutation = growthModelRow(oneIdHorizon, quietInputs({ idMutationsPerIdPerYear: 1 }));
  assert.equal(mutation.idMutationFlowSats, 546);
  assert.equal(mutation.computerEventActions, 2);
  close(mutation.totalSats - baseline.totalSats, 2_730, "one mutation fee");
  close(mutation.executedBlockspaceVbytes - baseline.executedBlockspaceVbytes, 350, "one mutation transaction");
  const credits = growthModelRow(oneIdHorizon, quietInputs({ creditCreatesPerIdPerYear: 1, tokenMintsPerIdPerYear: 1 }));
  assert.equal(credits.tokenCreateWrites, 1);
  assert.equal(credits.tokenMintWrites, 1);
  assert.equal(credits.tokenWrites, 2);
  assert.equal(credits.tokenSats, 7_730); // (546 creation + 1,000 assumed mint payment) × 5.
  assert.equal(credits.walletWrites, 0);
  assert.equal(credits.marketplaceWrites, 0);
});

test("AMO lifecycles separate WORK sales from Wallet standalone transfers", () => {
  const inputs = quietInputs();
  inputs.marketplaceAssets.work = { ...inputs.marketplaceAssets.work, salesPerIdPerYear: 1, cancelledListingsPerIdPerYear: 1 };
  const market = growthModelRow(oneIdHorizon, inputs);
  const work = market.marketplaceByAsset.work;
  assert.equal(work.sales, 1);
  assert.equal(work.listings, 2);
  assert.equal(work.seals, 1);
  assert.equal(work.delistings, 1);
  assert.equal(work.writes, 5);
  assert.equal(work.saleVolumeSats, 25_000);
  assert.equal(work.registryFeeSats, 2_730);
  assert.equal(market.marketplaceSats, 138_650);
  assert.equal(market.marketplaceWrites, 5);
  assert.equal(market.walletWrites, 0);
  assert.equal(market.workMovementWrites, 1);
  const wallet = growthModelRow(oneIdHorizon, { ...inputs, walletGenericTransfersPerIdPerYear: 1, walletWorkTransfersPerIdPerYear: 1 });
  assert.equal(wallet.walletWrites, 2);
  assert.equal(wallet.walletSats, 5_460);
  assert.equal(wallet.workMovementWrites, 2);
  assert.equal(wallet.marketplaceSats, market.marketplaceSats);
  close(wallet.totalSats - market.totalSats, 5_460, "two standalone transfer fees, no WORK floor added");
  close(wallet.totalWrites - market.totalWrites, 2, "two standalone transfers");
  close(wallet.executedBlockspaceVbytes - market.executedBlockspaceVbytes, 1_400, "standalone byte budget");
});

test("new demand responds to declared fee elasticity before shared capacity", () => {
  const inputs = quietInputs({ walletWorkTransfersPerIdPerYear: 1, infinityActionsPerIdPerYear: 1, inceptionActionsPerIdPerYear: 1, creditCreatesPerIdPerYear: 1, idMutationsPerIdPerYear: 1 });
  const base = growthModelRow(oneIdHorizon, inputs);
  const cheaper = growthModelRow(oneIdHorizon, { ...inputs, canonicalFee: 0.00001 });
  for (const [field, elasticity] of [["walletWrites", 0.6], ["infinityWrites", 0.5], ["inceptionWrites", 0.5], ["tokenCreateWrites", 0.6], ["computerEventWrites", 0.25]]) {
    close(cheaper[field] / base[field], 1000 ** elasticity, `${field} fee response`);
  }
  const capped = growthModelRow(oneIdHorizon, { ...inputs, blockspaceVbytesPerYear: base.rawBlockspaceVbytes / 2 });
  assert.equal(capped.blockspaceUsageRatio, 0.5);
  for (const field of ["idWrites", "walletWrites", "infinityWrites", "inceptionWrites", "tokenCreateWrites", "computerEventWrites"]) {
    close(capped[field], base[field] / 2, `${field} shared throttle`);
  }
  assert.equal(capped.idSats, base.idSats);
});

test("generator reproduces all-product and narrow Boost artifacts without touching archived May history", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "growth-forecast-test-"));
  const outputs = [
    "output/proofofwork-computer-growth-model.json",
    "output/proofofwork-computer-agent-adoption-model.md",
    ...["compounding", "dollar-growth", "product-split", "blockspace", "volatility"].map((name) => `output/proofofwork-computer-model-${name}.svg`),
    `${modelOutput}.json`, `${modelOutput}.md`,
  ];
  try {
    for (const relative of ["scripts/generate-growth-forecast.mjs", "src/features/growth/growthForecast.mjs"]) {
      const target = path.join(temporaryRoot, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(root, relative), target);
    }
    const historical = path.join(temporaryRoot, "output/historical/2026-05-13/proofofwork-computer-growth-model.json");
    mkdirSync(path.dirname(historical), { recursive: true });
    writeFileSync(historical, "preserved historical artifact\n");
    const run = () => {
      const result = spawnSync(process.execPath, ["scripts/generate-growth-forecast.mjs"], { cwd: temporaryRoot, encoding: "utf8", timeout: 30_000 });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    };
    run();
    const first = outputs.map((output) => readFileSync(path.join(temporaryRoot, output), "utf8"));
    run();
    outputs.forEach((output, i) => {
      assert.equal(readFileSync(path.join(temporaryRoot, output), "utf8"), first[i], `deterministic ${output}`);
      assert.equal(readFileSync(path.join(root, output), "utf8"), first[i], `checked-in ${output}`);
    });
    assert.equal(readFileSync(historical, "utf8"), "preserved historical artifact\n");
    const current = JSON.parse(first[0]);
    assert.equal(current.canonicalAccounting, false);
    assert.equal(current.version, GROWTH_MODEL_VERSION);
    assertFiniteTree(current);
    assert.deepEqual(current.productCoverage, GROWTH_PRODUCT_COVERAGE);
    assert.deepEqual(current.assumptions, GROWTH_ASSUMPTIONS);
    assert.deepEqual(current.limitations, GROWTH_MODEL_LIMITATIONS);
    current.chartRows.forEach((row, i) => close(row.totalSats, GROWTH_MODEL_CHART_ROWS[i].totalSats, "current shared frontend/report value"));
    const boost = JSON.parse(first.at(-2));
    assert.equal(boost.canonicalAccounting, false);
    assert.equal(boost.version, BOOST_GROWTH_MODEL_VERSION);
    assertFiniteTree(boost);
    boost.chartRows.forEach((row, i) => {
      for (const [field, expected] of Object.entries(BOOST_GROWTH_MODEL_CHART_ROWS[i])) {
        if (typeof expected === "number") close(row[field], expected, `preserved Boost ${i} ${field}`);
        else assert.equal(row[field], expected);
      }
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
