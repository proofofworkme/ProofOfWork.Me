import { mkdirSync, writeFileSync } from "node:fs";
import {
  GROWTH_MODEL_START_DATE,
  BOOST_GROWTH_MODEL_GENERATED_ON as GROWTH_MODEL_GENERATED_ON,
  BOOST_GROWTH_MODEL_VERSION as GROWTH_MODEL_VERSION,
  BOOST_GROWTH_MODEL_CALIBRATION as GROWTH_MODEL_CALIBRATION,
  BOOST_GROWTH_MODEL_INPUTS as GROWTH_MODEL_INPUTS,
  BOOST_GROWTH_MODEL_CHART_ROWS as GROWTH_MODEL_CHART_ROWS,
  LEGACY_GROWTH_MODEL_GENERATED_ON,
  LEGACY_GROWTH_MODEL_CHART_ROWS,
} from "../src/features/growth/growthForecast.mjs";
import * as Growth from "../src/features/growth/growthForecast.mjs";

// Keep artifacts stable across supported runtimes without converting scenario
// floats into protocol authority. Historical May output has its own generator.
function canonicalize(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite forecast result");
    return value === 0 ? 0 : Number(value.toPrecision(12));
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

const model = canonicalize({
  version: GROWTH_MODEL_VERSION,
  generatedOn: GROWTH_MODEL_GENERATED_ON,
  baselineDate: GROWTH_MODEL_START_DATE,
  calibration: GROWTH_MODEL_CALIBRATION,
  canonicalAccounting: false,
  historicalArtifacts: [
    "output/historical/2026-05-13/proofofwork-computer-growth-model.json",
    "output/historical/2026-05-13/proofofwork-computer-agent-adoption-model.md",
  ],
  baseline: {
    description: "Original May 11, 2026 observations and USD path retained; no September chain calibration is claimed.",
    boostFlow: "Scenario zero at historical origin; not a claim that current confirmed Boost activity is zero.",
  },
  attribution: {
    originalPosts: "Subset of Mail writes; add only Boost metadata vbytes. No extra payment, transaction, or attachment bytes.",
    paidActions: "Standalone social/direct-transfer actions excluding sale-ticket mutations; value only the minimum Boost registry payment.",
    sales: "Incremental Boost-only seller-price flow plus one list, seal, and buy registry payment per completed lifecycle.",
    excluded: ["recipient/follow payments", "optional proof signal", "WORK movement and attachment value", "media/file value and bytes", "miner fees", "sale-ticket funding/refunds"],
    existingMarketplace: "Legacy marketplace sales assumption remains the existing non-Boost product basket.",
    capacity: "All physical writes and Boost metadata share one annual blockspace cap. All service values use that cap; ID network stock remains unthrottled.",
    legacyWriteDisplay: "The earlier frontend left physical ID-write counts unthrottled. The versioned scenario corrects this display; the legacy comparison retains the original counts.",
  },
  inputs: GROWTH_MODEL_INPUTS,
  chartRows: GROWTH_MODEL_CHART_ROWS,
  priorFrontend: {
    generatedOn: LEGACY_GROWTH_MODEL_GENERATED_ON,
    description: "Previous frontend scenario, including its Credit lane; the separately preserved May generator predates that lane.",
    chartRows: LEGACY_GROWTH_MODEL_CHART_ROWS,
  },
});

function number(value, digits = 0) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const forecastRows = model.chartRows.slice(1);
const lines = [
  "# ProofOfWork Computer Growth — Boost scenario",
  "",
  `Scenario version: \`${model.version}\`. Revised ${model.generatedOn}. Historical baseline: ${model.baselineDate}.`,
  "",
  "This is an uncalibrated scenario extension. The original May observations, adoption horizons, non-Boost assumptions, and modeled USD path remain unchanged. No September chain snapshot or current USD quote is claimed. Scenario value is not canonical network value and does not change WORK floors, balances, or historical listing terms.",
  "",
  "The original [May model JSON](historical/2026-05-13/proofofwork-computer-growth-model.json) and [May model report](historical/2026-05-13/proofofwork-computer-agent-adoption-model.md) remain preserved. The prior frontend comparison in this artifact also retains the Credit lane added after that original generator.",
  "",
  "## Explicit Boost assumptions",
  "",
  "| Input | Scenario assumption |",
  "| --- | ---: |",
  `| Original posts per ID per year | ${model.inputs.boostOriginalPostsPerIdPerYear} |`,
  `| Incremental metadata per original post | ${model.inputs.boostOriginalMetadataVbytes} vB |`,
  `| Standalone paid actions per ID per year | ${model.inputs.boostPaidActionsPerIdPerYear} |`,
  `| Registry payment valued per paid action | ${model.inputs.boostRegistryFeeSats} proofs |`,
  `| Size per standalone paid action | ${model.inputs.boostVbytesPerPaidAction} vB |`,
  `| Boost sales per ID per year | ${model.inputs.boostSalesPerIdPerYear} |`,
  `| Seller price per Boost sale | ${number(model.inputs.boostAverageSaleSats)} proofs |`,
  `| List/seal/buy registry payments per sale | ${model.inputs.boostMarketWritesPerSale} × ${model.inputs.boostRegistryFeeSats} proofs |`,
  `| Size per complete sale lifecycle | ${number(model.inputs.boostVbytesPerSale)} vB |`,
  `| Boost fee elasticity | ${model.inputs.elasticities.boost} |`,
  `| Service value multiple | ${model.inputs.valueMultiple}× |`,
  `| Shared annual capacity | ${number(model.inputs.blockspaceVbytesPerYear)} vB |`,
  "",
  "Original Boost posts are a subset of the existing Mail demand. Their count cannot exceed Mail writes. Their existing Mail payments, transaction overhead, and Files/media bytes are already allocated; only the extra Boost metadata consumes additional capacity. Boost-original metadata creates no additional value or transaction count.",
  "",
  "Paid actions are a separate standalone transaction basket; sale-ticket mutations are excluded from that basket and modeled only in the complete sale lifecycle. The scenario values only the 546-proof registry payment for each paid action. Recipient/follow payments, optional signal, WORK movement, media value, miner fees, and sale-ticket funding/refunds add no separate Boost value here. The legacy marketplace assumption remains the non-Boost basket.",
  "",
  "All new usage/value/size assumptions above are scenario choices, not calibrated averages or transaction-size guarantees. The zero Boost value at the historical origin means no Boost baseline was introduced; it is not a current-activity claim.",
  "",
  "## Formula and blockspace",
  "",
  "```text",
  "fee_multiplier = (0.01 / scenario_fee_rate) ^ Boost_elasticity",
  "originals = min(existing_raw_Mail_writes, IDs × originals_per_ID × fee_multiplier)",
  "paid_actions = IDs × paid_actions_per_ID × fee_multiplier",
  "sales = IDs × sales_per_ID × fee_multiplier",
  "Boost_raw_value = (paid_actions × registry_fee + sales × (seller_price + 3 × registry_fee)) × value_multiple",
  "Boost_raw_bytes = originals × metadata_bytes + paid_actions × action_bytes + sales × lifecycle_bytes",
  "capacity_ratio = min(total_raw_bytes, annual_capacity) / total_raw_bytes",
  "Boost_value = Boost_raw_value × capacity_ratio",
  "```",
  "",
  "The capacity ratio is one when demand is zero. Every physical write, including ID writes, and each service-value lane uses the shared ratio. The ID network-value stock keeps the prior unthrottled N² rule. Adding Boost can reduce another service's executed traffic when the shared capacity is full. The prior frontend left its displayed ID-write count unthrottled; only this new version corrects that count, while its legacy comparison preserves the original result.",
  "",
  "## Forecast from the original baseline",
  "",
  "Rows are the original May-baseline horizons, re-evaluated with the September scenario assumptions. They are not newly rebased September forecasts. Counts are annual scenario activity after capacity allocation and may be fractional; display values below are rounded.",
  "",
  "| Horizon | Boost original posts | Paid actions | Boost sales | Boost value (proofs) | Total value (proofs) | Demand executed |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...forecastRows.map((row) => `| ${row.label} | ${number(row.boostOriginalPosts)} | ${number(row.boostPaidActions)} | ${number(row.boostSales, 2)} | ${number(row.boostSats)} | ${number(row.totalSats)} | ${number(row.blockspaceUsageRatio * 100, 4)}% |`),
  "",
  "The full versioned JSON contains every input, raw/capped Boost component, existing product lane, modeled USD value, and prior frontend comparison. Numeric serialization uses 12 significant digits for deterministic rebuilds; canonical proof/Q16 arithmetic is outside this scenario module.",
  "",
  "Regenerate this version from the repository root with `node scripts/generate-growth-forecast.mjs`. The generator and frontend share `src/features/growth/growthForecast.mjs`; the historical May generator remains separate and unchanged.",
  "",
];

mkdirSync("output", { recursive: true });
const basename = `output/proofofwork-computer-growth-model-${GROWTH_MODEL_VERSION}`;
writeFileSync(`${basename}.json`, `${JSON.stringify(model, null, 2)}\n`);
writeFileSync(`${basename}.md`, lines.join("\n"));

const valueLanes = Growth.GROWTH_VALUE_LANES.map(({ key, name }) => [key, name]);
const currentModel = canonicalize({
  version: Growth.GROWTH_MODEL_VERSION,
  generatedOn: Growth.GROWTH_MODEL_GENERATED_ON,
  baselineDate: Growth.GROWTH_MODEL_START_DATE,
  calibration: Growth.GROWTH_MODEL_CALIBRATION,
  canonicalAccounting: false,
  basis: {
    historicalInputs: "May 2026 observations and price benchmark; not refreshed September measurements.",
    time: "Years from 2026-05-11. Future writes are annual rates at each horizon, not cumulative transaction counts.",
    value: "Illustrative ID network stock plus scaled annual service flows; not a treasury balance, realizable price, or canonical replay.",
    usd: "Inherited historical exponential benchmark, not a current quote or a probability forecast.",
    work: "Derived scenario floor and movement-count diagnostics; no circular WORK revaluation added to the forecast total.",
  },
  inputs: Growth.GROWTH_MODEL_INPUTS,
  productCoverage: Growth.GROWTH_PRODUCT_COVERAGE,
  assumptions: Growth.GROWTH_ASSUMPTIONS,
  limitations: Growth.GROWTH_MODEL_LIMITATIONS,
  valueLanes: valueLanes.map(([field, product]) => ({ field, product })),
  chartRows: Growth.GROWTH_MODEL_CHART_ROWS,
  feeScenarios: [0.01, 0.001, 0.0001, 0.00001].map((feeRate) => ({
    feeRate,
    rows: Growth.GROWTH_MODEL_INPUTS.horizons.map((horizon) => Growth.growthModelRow(
      horizon, { ...Growth.GROWTH_MODEL_INPUTS, canonicalFee: feeRate },
    )),
  })),
  history: {
    mayArchive: "output/historical/2026-05-13/",
    narrowBoostVersion: model.version,
    narrowBoostArtifact: `${basename}.json`,
    legacyFrontend: "Preserved LEGACY_GROWTH_MODEL_* exports; distinct from the older five-lane May generator.",
  },
  sources: [
    "src/features/growth/growthForecast.mjs", "README.md", "PROOFOFWORK_IDS.md",
    "MARKETPLACE.md", "MAIL_ORGANIZATION.md", "OP_RETURN_INFRASTRUCTURE.md",
    "BOOST_GROWTH_ACCOUNTING_PROPOSAL.md",
  ],
});
const currentRows = currentModel.chartRows.slice(1);
const selectedYears = [1, 5, 10];
const selectedRows = selectedYears.map((years) => currentRows.find((row) => row.years === years));
for (const row of currentModel.chartRows) {
  for (const [field] of valueLanes) {
    if (!Number.isFinite(row[field]) || row[field] < 0) throw new Error(`Missing or invalid lane ${field}`);
  }
  const summed = valueLanes.reduce((sum, [field]) => sum + row[field], 0);
  if (Math.abs(summed - row.totalSats) > Math.max(1, row.totalSats) * 1e-10) {
    throw new Error(`Forecast lane total mismatch at ${row.label}`);
  }
}

function table(headers, rows, rightAlignedColumns = headers.map((_, index) => index).slice(1)) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map((_, index) => rightAlignedColumns.includes(index) ? "---:" : "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`),
  ].join("\n");
}
function compact(value, digits = 2) {
  const magnitude = Math.abs(value);
  for (const [threshold, suffix] of [[1e24, " Y"], [1e21, " Z"], [1e18, " E"], [1e15, " P"], [1e12, " T"], [1e9, " B"], [1e6, " M"], [1e3, " K"]]) {
    if (magnitude >= threshold) return `${number(value / threshold, digits)}${suffix}`;
  }
  return number(value, magnitude > 0 && magnitude < 1 ? 4 : digits);
}
const report = [
  "# ProofOfWork Computer growth model",
  "",
  `Current scenario: **${currentModel.version}**. Revised **${currentModel.generatedOn}**. Historical model origin: **${currentModel.baselineDate}**.`,
  "",
  "This report models all current product surfaces through eleven economic activity lanes and explicit shared or read-only mappings. It is an uncalibrated scenario extension of historical May inputs. It does not publish a new current-chain measurement or change canonical network value, WORK floors, balances, INCB issuance, or frozen sale-ticket terms.",
  "",
  "The [shared model source](../src/features/growth/growthForecast.mjs) drives this report, the main JSON/charts, and Growth's selected all-product forecast. Production actuals remain separate snapshot-bound API data under the [infrastructure contract](../OP_RETURN_INFRASTRUCTURE.md). The complete [May archive](historical/2026-05-13/README.md) preserves its original report, JSON, SVGs, and PNGs byte-for-byte; the [narrow Boost scenario](proofofwork-computer-growth-model-2026-09-05-boost-v1.md) remains reproducible as a separate comparison.",
  "",
  "## Read the model",
  "",
  "![Product and attribution map](proofofwork-computer-model-compounding.svg)",
  "",
  "1. Historical reachable-node count, assumed node growth, agent share, and adoption determine scenario IDs.",
  "2. Each economic carrier has one product owner. An interface displaying that carrier does not add its value or bytes again.",
  "3. One annual blockspace ceiling scales all physical writes and service flows. The inherited N² ID stock rule remains unthrottled.",
  "4. A derived WORK scenario floor is a diagnostic of the total, not an additional value component. Canonical live WORK revaluation is deliberately outside this forecast.",
  "",
  "Future rows are annual activity rates at their original May-origin horizons, not cumulative confirmed transaction counts or newly rebased September dates. The headline combines an illustrative identity stock with five-times annual service flow, preserving the inherited modeling convention. This is not a cash balance or an estimate of collectible revenue. Fractional transaction counts describe expected scenario rates; displayed values are rounded.",
  "",
  "## Product coverage and ownership",
  "",
  "Product roles follow the [public surface map](../README.md), [ID rules](../PROOFOFWORK_IDS.md), [AMO settlement rules](../MARKETPLACE.md), and [Mail/Files organization](../MAIL_ORGANIZATION.md). A shared or read-only product remains first-class coverage with zero incremental economic value. Its activity is carried by the listed owner.",
  "",
  table(["Product", "Role", "Economic owner / lane", "Activity and boundary"], currentModel.productCoverage.map((item) => [
    item.name ?? item.product, item.role, `${item.owner} / ${item.modeledLane}`, `${item.activity}. ${item.assumption}`,
  ]), []),
  "",
  "Mail covers plain-message traffic and original Boost text carriers; file-bearing, HTML-authoring, and bond carriers belong to their exclusive lanes. Files/Drive covers non-HTML files. Browser counts HTML publication carried by Mail/Files, while viewing an existing page creates no write. Infinity and Inception count their own tagged bond carriers. The Computer shell, Desktop, Log, Growth, and shared entry points do not duplicate those carriers.",
  "",
  "AMO separates ID, generic-credit, governed WORK, POWB, and INCB sale/cancellation baskets. Boost sale tickets are counted in Boost's own lifecycle basket. Wallet counts standalone transfers, excluding AMO settlement and attached WORK already carried by another action. WORK diagnostics and synthetic bond issuance are nonadditive. These partitions are scenario assumptions; they do not replace validation and output ownership in canonical replay.",
  "",
  "## Historical inputs and shared assumptions",
  "",
  table(["Input", "Value", "Meaning"], [
    ["Historical reachable nodes", number(currentModel.inputs.bitnodesReachableNodes), "May model input; original source snapshot April 30, 2026"],
    ["Agent-controlled node share", `${number(currentModel.inputs.agentShare * 100)}%`, "Assumption"],
    ["Annual node growth", `${number(currentModel.inputs.nodeCagr * 100)}%`, "Assumption"],
    ["Historical confirmed IDs", number(currentModel.inputs.currentPowids), "May 11 baseline, not current supply"],
    ["Historical Mail flow", `${number(currentModel.inputs.baselineMailFlowSats)} proofs`, "Origin input before the service multiple; not annualized current traffic"],
    ["Historical Files flow", `${number(currentModel.inputs.baselineFileFlowSats)} proofs`, "Origin input before the service multiple"],
    ["Historical AMO volume", `${number(currentModel.inputs.baselineMarketplaceVolumeSats)} proofs`, "Origin input before the service multiple"],
    ["Historical Browser / Credits / Boost flow", `${number(currentModel.inputs.baselineBrowserFlowSats)} / ${number(currentModel.inputs.baselineTokenFlowSats)} / ${number(currentModel.inputs.baselineBoostFlowSats)} proofs`, "Preserved origin inputs; not a claim of no current activity"],
    ["ID density", `${number(currentModel.inputs.idDensitySatsPerN2, 8)} proofs / N²`, "Historical model density, not a live registry balance"],
    ["Mail edge density", number(currentModel.inputs.mailEdgeDensity, 10), "Inherited historical model relationship density"],
    ["May USD benchmark", `$${number(currentModel.inputs.currentBtcUsd, 2)}`, "May 11, 2026 historical input"],
    ["Ten-year-old USD benchmark", `$${number(currentModel.inputs.historicalBtcUsd, 2)}`, "May 11, 2016 historical input"],
    ["Selected scenario fee", `${number(currentModel.inputs.canonicalFee, 5)} sat/vB`, "Hypothetical usage multiplier input, not an accepted relay quote"],
    ["Service value multiple", `${currentModel.inputs.valueMultiple}×`, "Scenario convention, not a newly declared economic parameter"],
    ["Annual capacity", `${number(currentModel.inputs.blockspaceVbytesPerYear)} vB`, "Inherited theoretical whole-chain ceiling, not reserved app capacity"],
  ], [1]),
  "",
  "Historical observations and their source notes are retained in the [archived report](historical/2026-05-13/proofofwork-computer-agent-adoption-model.md). No new source survey or September calibration is asserted. New products start with zero additional value at the historical origin because no new historical baseline is invented; that zero says nothing about current usage.",
  "",
  table(["Horizon from May origin", "Years", "Assumed adoption"], currentModel.inputs.horizons.map((row) => [row.label, row.years, `${number(row.adoption * 100)}%`])),
  "",
  "## Explicit product assumptions",
  "",
  ...currentModel.assumptions.flatMap((item) => [
    `### ${item.product}`, "",
    `- Usage: ${item.usage}`,
    `- Value: ${item.value}`,
    `- Fee elasticity: ${item.elasticity}`,
    `- Blockspace: ${item.blockspace}`,
    `- Attribution: ${item.attribution}`, "",
  ]),
  "The 1,000-proof ID registration and 546-proof mutation rules are documented in [ProofOfWork IDs](../PROOFOFWORK_IDS.md). AMO fees, sale-ticket principal, and frozen WORK terms follow [Marketplace](../MARKETPLACE.md). The WORK 25,000-proof seller face is a protocol input; deriving a listing's exact WORK amount remains canonical replay, not a forecast operation. Bond quantities or WORK attachments create no second scenario payment lane.",
  "",
  "Boost assumptions remain explicit and uncalibrated. Original posts add metadata to existing Mail demand. Standalone paid actions exclude sale-ticket lifecycle writes. Its scenario adds only stated registry and seller flow; optional proof signal, follow-recipient payments, WORK movement, media, miner fees, and ticket principal are excluded. A separate canonical Boost contribution remains an [unactivated proposal](../BOOST_GROWTH_ACCOUNTING_PROPOSAL.md).",
  "",
  "## Formula and capacity",
  "",
  "```text",
  "nodes(t) = historical_nodes × (1 + node_CAGR)^t",
  "IDs(t) = nodes(t) × assumed_agent_share × horizon_adoption",
  "fee_multiplier(product) = (0.01 / scenario_fee_rate)^product_elasticity",
  "ID_stock = IDs² × historical_ID_density × ID_fee_multiplier",
  "raw_service_value = attributed_annual_proof_flow × service_value_multiple",
  "raw_bytes = sum(exclusive_physical_writes × assumed_vbytes) + Boost_original_metadata",
  "capacity_ratio = raw_bytes > 0 ? min(raw_bytes, annual_capacity) / raw_bytes : 1",
  "executed_writes = raw_writes × capacity_ratio",
  "scenario_total = ID_stock + sum(raw_service_value × capacity_ratio)",
  "derived_WORK_floor = scenario_total / 21000000",
  "```",
  "",
  "AMO sale lifecycles include list, seal, and buy; canceled lifecycles include list and delist. Sale volume is the seller price, while fees are separate registry payments. Ticket creation, ticket refunds, change, and unrelated outputs are not added. The shared model source specifies the exact arithmetic and per-asset basket rates. Its floating-point, 12-significant-digit artifact serialization is for scenarios only; canonical proof amounts, Q8 value, and Q16 WORK remain exact integer protocol data.",
  "",
  "![Demand and executable capacity](proofofwork-computer-model-blockspace.svg)",
  "",
  table(["Horizon", "Raw demand (vB/year)", "Executed (vB/year)", "Demand fulfilled", "Physical writes/year"], currentRows.map((row) => [
    row.label, number(row.rawBlockspaceVbytes), number(row.executedBlockspaceVbytes), `${number(row.blockspaceUsageRatio * 100, 4)}%`, number(row.totalWrites),
  ])),
  "",
  "The capacity ceiling is a hypothetical allocation of the entire inherited theoretical chain budget. It does not establish available relay policy, economic demand, app market share, or future protocol capacity. When demand exceeds capacity, new product traffic displaces some execution in every shared service lane; ID stock is still governed by the inherited N² assumption.",
  "",
  "## Forecast by economic lane",
  "",
  "![Modeled value by lane](proofofwork-computer-model-product-split.svg)",
  "",
  table(["Lane (proofs)", ...selectedRows.map((row) => row.label)], [
    ...valueLanes.map(([field, label]) => [label, ...selectedRows.map((row) => number(row[field]))]),
    ["Total", ...selectedRows.map((row) => number(row.totalSats))],
  ]),
  "",
  "All seven horizon rows and every lane are in the [current JSON](proofofwork-computer-growth-model.json). Shared and read-only surfaces have no independent summand. WORK movement counts and the scenario floor below are diagnostic outputs and must not be added to the total.",
  "",
  table(["Horizon", "IDs", "Total (proofs)", "Derived WORK floor (proofs/WORK)", "WORK movement writes/year"], currentRows.map((row) => [
    row.label, number(row.powids), number(row.totalSats), number(row.workFloorSats, 6), number(row.workMovementWrites),
  ])),
  "",
  "## AMO baskets",
  "",
  "The following are annual scenario rates at the 12-month May-origin horizon, after the common capacity allocation. They are not current book inventory. Listings include both completed-sale and canceled-listing baskets; seal counts belong to sale lifecycles.",
  "",
  table(["Asset", "Sales", "Canceled listings", "Registry writes", "Seller flow (proofs)", "Registry fees (proofs)"], Object.entries(selectedRows[0].marketplaceByAsset).map(([asset, row]) => [
    asset, number(row.sales, 2), number(row.cancelledListings, 2), number(row.writes, 2), number(row.saleVolumeSats), number(row.registryFeeSats),
  ])),
  "",
  "Boost marketplace activity remains its separately modeled basket. This avoids treating its sales as both AMO and Boost value.",
  "",
  "## USD translation and fee sensitivity",
  "",
  "![Illustrative dollar translation](proofofwork-computer-model-dollar-growth.svg)",
  "",
  "The inherited USD path uses `mu = ln(May_2026_USD / May_2016_USD) / 10`, then `USD_benchmark(t) = May_2026_USD × exp(mu × t)`. Scenario dollars equal native proofs divided by 100,000,000 and multiplied by that benchmark. This extrapolates historical growth; it is not a live quote or an expected future price. Growth's current-dollar UI uses the separate live first-party quote, so its live-dollar translation need not equal this static table.",
  "",
  table(["Horizon", "Inherited USD benchmark", "Scenario value (USD)"], currentRows.map((row) => [row.label, `$${number(row.btcUsdBase, 2)}`, `$${number(row.totalUsdBase, 2)}`])),
  "",
  "![Sensitivity to the USD translation path](proofofwork-computer-model-volatility.svg)",
  "",
  "The compatibility filename `volatility` now contains a translation sensitivity comparison: the same native scenario at a fixed May benchmark versus the inherited exponential benchmark. It is not a statistical confidence interval, fitted volatility estimate, or promised return. The original volatility-cone figure remains unchanged in the historical archive.",
  "",
  table(["Scenario fee (sat/vB)", "12m total (proofs)", "5y total (proofs)", "10y total (proofs)"], currentModel.feeScenarios.map((scenario) => [
    number(scenario.feeRate, 5), ...selectedYears.map((years) => number(scenario.rows.find((row) => row.years === years).totalSats)),
  ])),
  "",
  "## Scope limits",
  "",
  ...currentModel.limitations.map((limitation) => `- ${limitation}`),
  "",
  "## Reproduce and inspect",
  "",
  "Run `node scripts/generate-growth-forecast.mjs` from the repository root to regenerate the current main report, JSON, and five deterministic SVG charts, plus the narrower Boost-v1 report/JSON. Run `node scripts/generate-proofofwork-computer-model.mjs` to reproduce the seven deterministic May outputs in the archive. `SHA256SUMS` preserves the original bytes of all twelve archived artifacts, including the five original PNGs.",
  "",
  "SVG is the canonical chart format linked above. Run `node scripts/render-growth-charts.mjs` with the installed Playwright/Chrome runtime to refresh root PNG companions for convenient sharing. PNGs are renderer-dependent companions; they do not replace the deterministic SVG/source checks. All reported numbers come from the shared module, and this generator rejects missing lanes or a lane/total mismatch.",
  "",
  "Source authority remains explicit: [product roles](../README.md), [IDs and fees](../PROOFOFWORK_IDS.md), [sale-ticket and WORK rules](../MARKETPLACE.md), [Mail/Files sharing](../MAIL_ORGANIZATION.md), [snapshot/API behavior](../OP_RETURN_INFRASTRUCTURE.md), and the [draft Boost accounting design](../BOOST_GROWTH_ACCOUNTING_PROPOSAL.md). None of these static artifacts asserts a production deployment or replaces confirmed-chain verification.",
  "",
];
writeFileSync("output/proofofwork-computer-growth-model.json", `${JSON.stringify(currentModel, null, 2)}\n`);
writeFileSync("output/proofofwork-computer-agent-adoption-model.md", report.join("\n"));

const palette = { bg: "#f7f5ef", ink: "#242820", muted: "#666b61", grid: "#d9dccf", brass: "#a4772d", olive: "#60713f", blue: "#446c85", red: "#aa5a48", white: "#ffffff" };
const escapeXml = (value) => String(value).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const coord = (value) => Number(value.toFixed(3));
function textSvg(value, x, y, { size = 20, fill = palette.ink, weight = 400, anchor = "start" } = {}) {
  return `<text x="${coord(x)}" y="${coord(y)}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}
function textLines(values, x, y, options = {}) {
  return values.map((value, index) => textSvg(value, x, y + index * (options.lineHeight ?? 28), options)).join("\n");
}
function svgFigure(title, subtitle, body, footer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" role="img" aria-labelledby="title description">
<title id="title">${escapeXml(title)}</title><desc id="description">${escapeXml(subtitle)} ${escapeXml(footer)}</desc>
<style>text { font-family: Arial, Helvetica, sans-serif; } .mono { font-variant-numeric: tabular-nums; }</style>
<rect width="1600" height="1000" fill="${palette.bg}"/>
${textSvg(title, 70, 74, { size: 42, weight: 700 })}
${textSvg(subtitle, 70, 112, { size: 21, fill: palette.muted })}
${body}
<line x1="70" y1="911" x2="1530" y2="911" stroke="${palette.grid}"/>
${textSvg(footer, 70, 946, { size: 18, fill: palette.muted })}
${textSvg(`${currentModel.version} · revised ${currentModel.generatedOn} · baseline ${currentModel.baselineDate}`, 70, 975, { size: 17, fill: palette.muted })}
</svg>\n`;
}
function linePlot(series, { yLabel, minYear = 0, maxYear = 10, height = 610 } = {}) {
  const left = 160, top = 200, width = 1330;
  const values = series.flatMap((item) => item.points.map((point) => point.value)).filter((value) => value > 0);
  const lower = Math.floor(Math.log10(Math.min(...values)));
  const upper = Math.ceil(Math.log10(Math.max(...values)));
  const x = (year) => left + ((year - minYear) / (maxYear - minYear)) * width;
  const y = (value) => top + height - ((Math.log10(value) - lower) / Math.max(1, upper - lower)) * height;
  const elements = [textSvg(`${yLabel} · logarithmic scale`, left, 182, { size: 18, fill: palette.muted })];
  for (let power = lower; power <= upper; power += 1) {
    const ypos = y(10 ** power);
    elements.push(`<line x1="${left}" x2="${left + width}" y1="${coord(ypos)}" y2="${coord(ypos)}" stroke="${palette.grid}"/>`);
    elements.push(textSvg(compact(10 ** power, 0), left - 20, ypos + 6, { size: 17, anchor: "end", fill: palette.muted }));
  }
  for (const year of [minYear, 1, 2, 5, 10]) {
    elements.push(`<line x1="${coord(x(year))}" x2="${coord(x(year))}" y1="${top}" y2="${top + height}" stroke="${palette.grid}" stroke-dasharray="3 7"/>`);
    elements.push(textSvg(year === 0 ? "Baseline" : year === 0.5 ? "6m" : `${year} ${year === 1 ? "year" : "years"}`, x(year), top + height + 34, { size: 18, anchor: "middle", fill: palette.muted }));
  }
  series.forEach((item, index) => {
    const xpos = left + index * 420;
    elements.push(`<line x1="${xpos}" x2="${xpos + 42}" y1="143" y2="143" stroke="${item.color}" stroke-width="4"${item.dash ? ' stroke-dasharray="10 7"' : ""}/>`);
    elements.push(textSvg(item.name, xpos + 54, 150, { size: 18 }));
    elements.push(`<polyline fill="none" stroke="${item.color}" stroke-width="4"${item.dash ? ' stroke-dasharray="10 7"' : ""} points="${item.points.map((point) => `${coord(x(point.years))},${coord(y(point.value))}`).join(" ")}"/>`);
    if (!item.dash) for (const point of item.points) elements.push(`<circle cx="${coord(x(point.years))}" cy="${coord(y(point.value))}" r="5" fill="${palette.bg}" stroke="${item.color}" stroke-width="3"/>`);
  });
  elements.push(textSvg("Years from the historical May 11, 2026 model origin", left + width / 2, top + height + 70, { size: 18, anchor: "middle", fill: palette.muted }));
  return elements.join("\n");
}
const tenYearRows = currentModel.chartRows.filter((row) => row.years <= 10);
const dollarFigure = svgFigure(
  "Illustrative network value in dollars",
  "All-product scenario · eleven value lanes · inherited historical USD benchmark",
  linePlot([{ name: "Historical USD-path translation", color: palette.brass, points: tenYearRows.map((row) => ({ years: row.years, value: row.totalUsdBase })) }], { yLabel: "Scenario USD" }),
  "Uncalibrated scenario. These are modeled dollars, not current quotes, canonical value, or expected future prices.",
);
const blockRows = tenYearRows.filter((row) => row.years > 0);
const blockFigure = svgFigure(
  "One capacity budget for every physical write",
  "Raw annual demand competes for the inherited 52.56 billion vB whole-chain ceiling",
  linePlot([
    { name: "Raw demand", color: palette.brass, points: blockRows.map((row) => ({ years: row.years, value: row.rawBlockspaceVbytes })) },
    { name: "Executed scenario demand", color: palette.olive, points: blockRows.map((row) => ({ years: row.years, value: row.executedBlockspaceVbytes })) },
    { name: "Annual theoretical ceiling", color: palette.blue, dash: true, points: [0.5, 10].map((years) => ({ years, value: currentModel.inputs.blockspaceVbytesPerYear })) },
  ], { yLabel: "Virtual bytes per year", minYear: 0.5 }),
  "The ceiling is not reserved app capacity. All service flows share it; the inherited N² identity stock remains unthrottled.",
);
const sensitivityFigure = svgFigure(
  "USD translation sensitivity",
  "The same native proof forecast under two explicit USD assumptions",
  linePlot([
    { name: "Inherited exponential USD path", color: palette.brass, points: tenYearRows.map((row) => ({ years: row.years, value: row.totalUsdBase })) },
    { name: "Fixed May 2026 USD benchmark", color: palette.blue, dash: true, points: tenYearRows.map((row) => ({ years: row.years, value: row.totalSats / 1e8 * currentModel.inputs.currentBtcUsd })) },
  ], { yLabel: "Scenario USD" }),
  "Sensitivity comparison only. There is no fitted volatility model, confidence interval, or promised return in this figure.",
);
const cells = [];
const maxima = Math.log10(Math.max(...selectedRows.flatMap((row) => valueLanes.map(([field]) => row[field]))));
selectedRows.forEach((row, index) => cells.push(textSvg(row.label, 635 + index * 340, 183, { size: 22, weight: 700, anchor: "middle" })));
valueLanes.forEach(([field, name], index) => {
  const ypos = 205 + index * 50;
  cells.push(textSvg(name, 85, ypos + 31, { size: 21, weight: 500 }));
  selectedRows.forEach((row, column) => {
    const strength = Math.max(0, Math.min(1, Math.log10(Math.max(1, row[field])) / maxima));
    const shade = [235, 237, 225].map((component, channel) => Math.round(component + ([91, 110, 63][channel] - component) * strength));
    cells.push(`<rect x="${465 + column * 340}" y="${ypos}" width="310" height="42" rx="6" fill="rgb(${shade.join(",")})"/>`);
    cells.push(textSvg(`${compact(row[field])} proofs`, 620 + column * 340, ypos + 29, { size: 20, anchor: "middle", fill: strength > 0.58 ? "#ffffff" : palette.ink }));
  });
});
cells.push(textSvg("Each cell shows its complete lane value; color intensity uses one logarithmic scale.", 85, 820, { size: 20, fill: palette.muted }));
cells.push(textSvg("WORK is derived. Shared interfaces and read-only surfaces add no independent summand.", 85, 858, { size: 20, fill: palette.muted }));
const productFigure = svgFigure("Modeled value by economic lane", "All eleven lanes are visible, including smaller products · display values are rounded", cells.join("\n"), "These illustrative stock/flow scores are not a treasury balance, market price, or canonical economic accounting.");

const cards = [
  { title: "01  Identity", value: "N² stock", color: palette.brass, lines: ["Historical reachable nodes", "Assumed agents and adoption", "Inherited network density"] },
  { title: "02  Protocol activity", value: "11 value lanes", color: palette.olive, lines: ["One owner per paid carrier", "AMO split by five asset baskets", "Shared views add no value"] },
  { title: "03  Capacity", value: "52.56B vB/year", color: palette.blue, lines: ["All physical writes share a cap", "Boost originals add metadata", "Service flows scale together"] },
  { title: "04  Diagnostics", value: "Derived WORK floor", color: palette.red, lines: ["Scenario total divided by 21M", "Movement counts are separate", "No circular value added"] },
];
const mapParts = cards.map((card, index) => {
  const xpos = 70 + index * 375;
  return `<rect x="${xpos}" y="208" width="335" height="335" rx="14" fill="${palette.white}" stroke="${palette.grid}"/>
<rect x="${xpos}" y="208" width="335" height="8" rx="4" fill="${card.color}"/>
${textSvg(card.title, xpos + 22, 267, { size: 23, weight: 700 })}
${textSvg(card.value, xpos + 22, 331, { size: card.value.length > 16 ? 27 : 31, weight: 700, fill: card.color })}
${textLines(card.lines, xpos + 22, 397, { size: 19, fill: palette.muted, lineHeight: 38 })}`;
});
mapParts.push(`<rect x="70" y="606" width="1460" height="236" rx="14" fill="#e8ebdd"/>`);
mapParts.push(textSvg("Every surface is covered; every economic carrier is counted once.", 105, 653, { size: 29, weight: 700 }));
mapParts.push(textLines([
  "Write owners: IDs · Mail · Files/Drive · Browser authoring · AMO · Credits · Wallet · Infinity · Inception · Boost",
  "Shared and read-only views: Computer · Desktop · Log · Growth · WORK dashboard · Home and compatibility routes",
  "No duplicate file bytes, sale-ticket principal, WORK attachment value, synthetic bond issuance, or view-only traffic.",
], 105, 712, { size: 21, lineHeight: 44, fill: palette.muted }));
const compoundingFigure = svgFigure("One Computer. Explicit product ownership.", "A scenario map of activity, capacity, and derived diagnostics", mapParts.join("\n"), "Model breadth is not protocol activation. Current economic truth remains the shared confirmed-chain ledger.");
for (const [name, svg] of Object.entries({ compounding: compoundingFigure, "dollar-growth": dollarFigure, "product-split": productFigure, blockspace: blockFigure, volatility: sensitivityFigure })) {
  writeFileSync(`output/proofofwork-computer-model-${name}.svg`, svg);
}
