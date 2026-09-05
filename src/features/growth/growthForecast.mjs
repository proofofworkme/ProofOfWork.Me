// Display-only scenario math. This module does not define canonical network
// value, WORK floors, protocol fees, accounting admission, or historical replay.
// The May 2026 generator/artifacts remain an independent historical record.

export const GROWTH_MODEL_START_DATE = "2026-05-11";
export const BOOST_GROWTH_MODEL_GENERATED_ON = "2026-09-05";
export const BOOST_GROWTH_MODEL_VERSION = "2026-09-05-boost-v1";
export const LEGACY_GROWTH_MODEL_GENERATED_ON = "2026-05-13";
export const BOOST_GROWTH_MODEL_CALIBRATION = "Uncalibrated Boost scenario; historical May 11 baseline retained";
export const LEGACY_GROWTH_MODEL_INPUTS = {
  bitnodesReachableNodes: 23_984,
  agentShare: 0.51,
  nodeCagr: 0.25,
  currentBtcUsd: 80_879.33,
  historicalBtcUsd: 452.73,
  btcBenchmarkYears: 10,
  currentPowids: 94,
  idDensitySatsPerN2: 268.68933906745133,
  baselineMailFlowSats: 10_202,
  baselineFileFlowSats: 2_184,
  baselineMarketplaceVolumeSats: 1_000,
  baselineBrowserFlowSats: 0,
  baselineTokenFlowSats: 0,
  mailEdgeDensity: 0.012307692307692308,
  mailSatsPerDelivery: 680.1333333333333,
  marketplaceAverageSaleSats: 1000,
  browserAveragePageSats: 1000,
  tokenAverageMintSats: 1000,
  satsPerFile: 1000,
  canonicalFee: 0.00001,
  blockspaceVbytesPerYear: 52_560_000_000,
  idVbytesPerWrite: 350,
  mailVbytesPerWrite: 500,
  driveVbytesPerWrite: 9_621,
  marketplaceVbytesPerSale: 1_500,
  browserVbytesPerPage: 15_000,
  tokenVbytesPerWrite: 700,
  mailMessagesPerPairPerYear: 4,
  driveFilesPerIdPerYear: 6,
  marketplaceSalesPerIdPerYear: 0.2,
  browserPagesPerIdPerYear: 1,
  tokenMintsPerIdPerYear: 0.25,
  valueMultiple: 5,
  elasticities: {
    id: 0.25,
    mail: 0.5,
    drive: 0.75,
    marketplace: 0.5,
    browser: 0.75,
    token: 0.6,
  },
  horizons: [
    { label: "6 months", years: 0.5, adoption: 0.1 },
    { label: "12 months", years: 1, adoption: 0.2 },
    { label: "24 months", years: 2, adoption: 0.4 },
    { label: "5 years", years: 5, adoption: 0.6 },
    { label: "10 years", years: 10, adoption: 0.8 },
    { label: "25 years", years: 25, adoption: 0.9 },
    { label: "50 years", years: 50, adoption: 1 },
  ],
};

export const BOOST_GROWTH_MODEL_INPUTS = {
  ...LEGACY_GROWTH_MODEL_INPUTS,
  // Assumptions, not observations. The original posts already occupy Mail/Files.
  baselineBoostFlowSats: 0,
  boostOriginalPostsPerIdPerYear: 4,
  boostOriginalMetadataVbytes: 250,
  boostPaidActionsPerIdPerYear: 12,
  boostRegistryFeeSats: 546,
  boostVbytesPerPaidAction: 500,
  boostSalesPerIdPerYear: 0.02,
  boostAverageSaleSats: 1_000,
  boostMarketWritesPerSale: 3,
  boostVbytesPerSale: 1_500,
  elasticities: { ...LEGACY_GROWTH_MODEL_INPUTS.elasticities, boost: 0.5 },
};

export function growthFeeMultiplier(feeRate, elasticity) {
  return (0.01 / feeRate) ** elasticity;
}

export function growthBtcUsdAtYears(years) {
  const mu =
    Math.log(
      BOOST_GROWTH_MODEL_INPUTS.currentBtcUsd / BOOST_GROWTH_MODEL_INPUTS.historicalBtcUsd,
    ) / BOOST_GROWTH_MODEL_INPUTS.btcBenchmarkYears;
  return BOOST_GROWTH_MODEL_INPUTS.currentBtcUsd * Math.exp(mu * Math.max(0, years));
}

export function growthSatsToUsdAtYears(sats, years) {
  return (sats / 100_000_000) * growthBtcUsdAtYears(years);
}

function buildGrowthModelRow(horizon, inputs, includeBoost) {
  const nodes =
    inputs.bitnodesReachableNodes *
    (1 + inputs.nodeCagr) ** horizon.years;
  const agentNodes = nodes * inputs.agentShare;
  const powids = agentNodes * horizon.adoption;
  const directedPairs = powids * Math.max(0, powids - 1);
  const idMultiplier = growthFeeMultiplier(
    inputs.canonicalFee,
    inputs.elasticities.id,
  );
  const mailMultiplier = growthFeeMultiplier(
    inputs.canonicalFee,
    inputs.elasticities.mail,
  );
  const driveMultiplier = growthFeeMultiplier(
    inputs.canonicalFee,
    inputs.elasticities.drive,
  );
  const marketplaceMultiplier = growthFeeMultiplier(
    inputs.canonicalFee,
    inputs.elasticities.marketplace,
  );
  const browserMultiplier = growthFeeMultiplier(
    inputs.canonicalFee,
    inputs.elasticities.browser,
  );
  const tokenMultiplier = growthFeeMultiplier(
    inputs.canonicalFee,
    inputs.elasticities.token,
  );
  const rawIdSats =
    powids ** 2 * inputs.idDensitySatsPerN2 * idMultiplier;
  const rawMailSats =
    directedPairs *
    inputs.mailEdgeDensity *
    inputs.mailMessagesPerPairPerYear *
    inputs.mailSatsPerDelivery *
    inputs.valueMultiple *
    mailMultiplier;
  const rawDriveSats =
    powids *
    inputs.driveFilesPerIdPerYear *
    inputs.satsPerFile *
    inputs.valueMultiple *
    driveMultiplier;
  const rawMarketplaceSats =
    powids *
    inputs.marketplaceSalesPerIdPerYear *
    inputs.marketplaceAverageSaleSats *
    inputs.valueMultiple *
    marketplaceMultiplier;
  const rawBrowserSats =
    powids *
    inputs.browserPagesPerIdPerYear *
    inputs.browserAveragePageSats *
    inputs.valueMultiple *
    browserMultiplier;
  const rawTokenSats =
    powids *
    inputs.tokenMintsPerIdPerYear *
    inputs.tokenAverageMintSats *
    inputs.valueMultiple *
    tokenMultiplier;
  const idWrites = powids * idMultiplier;
  const mailWrites =
    directedPairs *
    inputs.mailEdgeDensity *
    inputs.mailMessagesPerPairPerYear *
    mailMultiplier;
  const driveWrites =
    powids * inputs.driveFilesPerIdPerYear * driveMultiplier;
  const marketplaceWrites =
    powids *
    inputs.marketplaceSalesPerIdPerYear *
    marketplaceMultiplier;
  const browserWrites =
    powids * inputs.browserPagesPerIdPerYear * browserMultiplier;
  const tokenWrites =
    powids *
    inputs.tokenMintsPerIdPerYear *
    tokenMultiplier;
  const boostMultiplier = includeBoost
    ? growthFeeMultiplier(inputs.canonicalFee, inputs.elasticities.boost)
    : 0;
  // Original posts share Mail transactions and Files bytes. Only added metadata
  // consumes incremental blockspace; they never create a second value/write lane.
  const rawBoostOriginalPosts = Math.min(
    mailWrites,
    powids * (inputs.boostOriginalPostsPerIdPerYear ?? 0) * boostMultiplier,
  );
  const rawBoostPaidActions =
    powids * (inputs.boostPaidActionsPerIdPerYear ?? 0) * boostMultiplier;
  const rawBoostSales =
    powids * (inputs.boostSalesPerIdPerYear ?? 0) * boostMultiplier;
  const boostWrites = rawBoostPaidActions +
    rawBoostSales * (inputs.boostMarketWritesPerSale ?? 0);
  const rawBoostVbytes =
    rawBoostOriginalPosts * (inputs.boostOriginalMetadataVbytes ?? 0) +
    rawBoostPaidActions * (inputs.boostVbytesPerPaidAction ?? 0) +
    rawBoostSales * (inputs.boostVbytesPerSale ?? 0);
  // Minimum registry flow plus seller prices. No additional Mail payments,
  // recipient signal, WORK movement, media value, ticket refunds, or miner fees.
  const rawBoostSats = (
    rawBoostPaidActions * (inputs.boostRegistryFeeSats ?? 0) +
    rawBoostSales * (
      (inputs.boostAverageSaleSats ?? 0) +
      (inputs.boostMarketWritesPerSale ?? 0) * (inputs.boostRegistryFeeSats ?? 0)
    )
  ) * inputs.valueMultiple;
  const rawBlockspaceVbytes =
    idWrites * inputs.idVbytesPerWrite +
    mailWrites * inputs.mailVbytesPerWrite +
    driveWrites * inputs.driveVbytesPerWrite +
    marketplaceWrites * inputs.marketplaceVbytesPerSale +
    browserWrites * inputs.browserVbytesPerPage +
    tokenWrites * inputs.tokenVbytesPerWrite +
    rawBoostVbytes;
  const blockspaceUsageRatio =
    rawBlockspaceVbytes > 0
      ? Math.min(
          rawBlockspaceVbytes,
          inputs.blockspaceVbytesPerYear,
        ) / rawBlockspaceVbytes
      : 1;
  const boostSats = rawBoostSats * blockspaceUsageRatio;
  // ID value is the original network stock; physical writes share the cap.
  // The legacy view keeps its historical unthrottled ID-write display.
  const executedIdWrites = includeBoost ? idWrites * blockspaceUsageRatio : idWrites;
  const idSats = rawIdSats;
  const mailSats = rawMailSats * blockspaceUsageRatio;
  const driveSats = rawDriveSats * blockspaceUsageRatio;
  const marketplaceSats = rawMarketplaceSats * blockspaceUsageRatio;
  const browserSats = rawBrowserSats * blockspaceUsageRatio;
  const tokenSats = rawTokenSats * blockspaceUsageRatio;
  const totalSats =
    idSats +
    mailSats +
    driveSats +
    marketplaceSats +
    browserSats +
    tokenSats +
    boostSats;
  const btcUsdBase = growthBtcUsdAtYears(horizon.years);

  return {
    ...horizon,
    blockspaceUsageRatio,
    rawBlockspaceVbytes,
    executedBlockspaceVbytes: rawBlockspaceVbytes * blockspaceUsageRatio,
    boostSats,
    boostWrites: boostWrites * blockspaceUsageRatio,
    boostOriginalPosts: rawBoostOriginalPosts * blockspaceUsageRatio,
    boostPaidActions: rawBoostPaidActions * blockspaceUsageRatio,
    boostSales: rawBoostSales * blockspaceUsageRatio,
    boostVbytes: rawBoostVbytes * blockspaceUsageRatio,
    rawBoostOriginalPosts,
    rawBoostPaidActions,
    rawBoostSales,
    rawBoostVbytes,
    rawBoostSats,
    browserSats,
    browserWrites: browserWrites * blockspaceUsageRatio,
    btcUsdBase,
    driveSats,
    driveWrites: driveWrites * blockspaceUsageRatio,
    idSats,
    idWrites: executedIdWrites,
    mailSats,
    mailWrites: mailWrites * blockspaceUsageRatio,
    marketplaceSats,
    marketplaceWrites: marketplaceWrites * blockspaceUsageRatio,
    powids,
    tokenSats,
    tokenWrites: tokenWrites * blockspaceUsageRatio,
    totalSats,
    totalUsdBase: (totalSats / 100_000_000) * btcUsdBase,
    totalWrites:
      executedIdWrites +
      (
        mailWrites +
        driveWrites +
        marketplaceWrites +
        browserWrites +
        tokenWrites +
        boostWrites
      ) *
        blockspaceUsageRatio,
  };
}

export function boostGrowthModelStartRow() {
  const idSats =
    BOOST_GROWTH_MODEL_INPUTS.currentPowids ** 2 *
    BOOST_GROWTH_MODEL_INPUTS.idDensitySatsPerN2;
  const mailSats =
    BOOST_GROWTH_MODEL_INPUTS.baselineMailFlowSats *
    BOOST_GROWTH_MODEL_INPUTS.valueMultiple;
  const driveSats =
    BOOST_GROWTH_MODEL_INPUTS.baselineFileFlowSats *
    BOOST_GROWTH_MODEL_INPUTS.valueMultiple;
  const marketplaceSats =
    BOOST_GROWTH_MODEL_INPUTS.baselineMarketplaceVolumeSats *
    BOOST_GROWTH_MODEL_INPUTS.valueMultiple;
  const browserSats =
    BOOST_GROWTH_MODEL_INPUTS.baselineBrowserFlowSats *
    BOOST_GROWTH_MODEL_INPUTS.valueMultiple;
  const tokenSats =
    BOOST_GROWTH_MODEL_INPUTS.baselineTokenFlowSats *
    BOOST_GROWTH_MODEL_INPUTS.valueMultiple;
  const totalSats =
    idSats +
    mailSats +
    driveSats +
    marketplaceSats +
    browserSats +
    tokenSats;
  const btcUsdBase = growthBtcUsdAtYears(0);
  return {
    adoption: 0,
    boostSats: 0,
    boostWrites: 0,
    boostOriginalPosts: 0,
    boostPaidActions: 0,
    boostSales: 0,
    boostVbytes: 0,
    rawBoostOriginalPosts: 0,
    rawBoostPaidActions: 0,
    rawBoostSales: 0,
    rawBoostVbytes: 0,
    rawBoostSats: 0,
    rawBlockspaceVbytes: 0,
    executedBlockspaceVbytes: 0,
    blockspaceUsageRatio: 1,
    browserSats,
    browserWrites: 0,
    btcUsdBase,
    driveSats,
    driveWrites: 0,
    idSats,
    idWrites: BOOST_GROWTH_MODEL_INPUTS.currentPowids,
    label: "Model start",
    mailSats,
    mailWrites: 0,
    marketplaceSats,
    marketplaceWrites: 0,
    powids: BOOST_GROWTH_MODEL_INPUTS.currentPowids,
    tokenSats,
    tokenWrites: 0,
    totalSats,
    totalUsdBase: (totalSats / 100_000_000) * btcUsdBase,
    totalWrites: BOOST_GROWTH_MODEL_INPUTS.currentPowids,
    years: 0,
  };
}

export function boostGrowthModelRow(horizon, inputs = BOOST_GROWTH_MODEL_INPUTS) {
  return buildGrowthModelRow(horizon, inputs, true);
}

export const BOOST_GROWTH_MODEL_ROWS = BOOST_GROWTH_MODEL_INPUTS.horizons.map((horizon) => boostGrowthModelRow(horizon));
export const BOOST_GROWTH_MODEL_CHART_ROWS = [boostGrowthModelStartRow(), ...BOOST_GROWTH_MODEL_ROWS];
export const LEGACY_GROWTH_MODEL_ROWS = LEGACY_GROWTH_MODEL_INPUTS.horizons.map(
  (horizon) => buildGrowthModelRow(horizon, LEGACY_GROWTH_MODEL_INPUTS, false),
);
export const LEGACY_GROWTH_MODEL_CHART_ROWS = [boostGrowthModelStartRow(), ...LEGACY_GROWTH_MODEL_ROWS];

export const GROWTH_MODEL_VERSION = "2026-09-05-all-products-v1";
export const GROWTH_MODEL_GENERATED_ON = "2026-09-05";
export const GROWTH_MODEL_CALIBRATION = "Uncalibrated all-product scenario; historical May 11 baseline retained";

// Each entry is a disjoint non-Boost AMO activity basket. A completed sale
// includes list/seal/buy; a cancellation includes list/delist. Ticket principal
// and refunds are not revenue, and trades are not standalone Wallet transfers.
export const GROWTH_MODEL_INPUTS = {
  ...BOOST_GROWTH_MODEL_INPUTS,
  idRegistrationFeeSats: 1_000,
  idMutationFeeSats: 546,
  idMutationsPerIdPerYear: 0.1,
  idMutationVbytesPerWrite: 350,
  creditCreatesPerIdPerYear: 0.01,
  creditCreateFeeSats: 546,
  creditCreateVbytesPerWrite: 700,
  walletGenericTransfersPerIdPerYear: 1,
  walletWorkTransfersPerIdPerYear: 1,
  walletTransferFeeSats: 546,
  walletVbytesPerTransfer: 700,
  infinityActionsPerIdPerYear: 0.1,
  infinityAverageBondSats: 1_000,
  infinityVbytesPerAction: 500,
  inceptionActionsPerIdPerYear: 0.1,
  inceptionAverageBondSats: 1_000,
  inceptionVbytesPerAction: 500,
  workMaxSupply: 21_000_000,
  marketplaceSaleWrites: 3,
  marketplaceCancellationWrites: 2,
  marketplaceRegistryFeeSats: 546,
  marketplaceVbytesPerWrite: 500,
  marketplaceAssets: {
    ids: { name: "IDs", salesPerIdPerYear: 0.2, cancelledListingsPerIdPerYear: 0.05, averageSaleSats: 1_000 },
    credits: { name: "Generic credits", salesPerIdPerYear: 0.05, cancelledListingsPerIdPerYear: 0.01, averageSaleSats: 1_000 },
    work: { name: "WORK", salesPerIdPerYear: 0.05, cancelledListingsPerIdPerYear: 0.01, averageSaleSats: 25_000 },
    powb: { name: "POWB", salesPerIdPerYear: 0.02, cancelledListingsPerIdPerYear: 0.005, averageSaleSats: 1_000 },
    incb: { name: "INCB", salesPerIdPerYear: 0.02, cancelledListingsPerIdPerYear: 0.005, averageSaleSats: 1_000 },
  },
  elasticities: {
    ...BOOST_GROWTH_MODEL_INPUTS.elasticities,
    wallet: 0.6,
    infinity: 0.5,
    inception: 0.5,
    computerEvent: 0.25,
  },
};

export const GROWTH_VALUE_LANES = [
  { key: "idSats", name: "IDs" },
  { key: "mailSats", name: "Mail" },
  { key: "driveSats", name: "Files / Drive" },
  { key: "browserSats", name: "Browser authoring" },
  { key: "marketplaceSats", name: "AMO" },
  { key: "tokenSats", name: "Credits" },
  { key: "boostSats", name: "Boost" },
  { key: "infinitySats", name: "Infinity" },
  { key: "inceptionSats", name: "Inception" },
  { key: "walletSats", name: "Wallet transfers" },
  { key: "computerEventSats", name: "Registry events" },
];

export const GROWTH_MODEL_LIMITATIONS = [
  "The May 11, 2026 baseline, node sample, adoption horizons, and historical modeled USD path are retained. New scenario assumptions are not current chain calibration.",
  "All-product coverage maps every public app to its economic owner or shared/read-only role. It is not an exact canonical replay or a forecast of every possible action variant.",
  "Mail means ordinary text messages, including text-only Boost originals, excluding file, HTML-page, and bond publications. Non-HTML files belong to Drive; HTML publication belongs exclusively to Browser authoring, whether carried as a Mail body or Files attachment. Reading the same record adds no transaction or value.",
  "Boost originals reuse Mail transactions and existing Files media; only their additional Boost metadata consumes extra bytes. Standalone paid actions and Boost sale lifecycles are separate baskets. Optional recipient/follow signal, WORK attachments, profile/hide actions, and incomplete/cancelled Boost listings are outside the incremental Boost scenario.",
  "Infinity and Inception count direct tagged-bond payments and their own transaction bytes. Synthetic POWB/INCB issuance is not another payment. Their sale and mutation flows belong only to AMO. Attached WORK and INCB issuance from it require exact replay and are not valued again here.",
  "Generic credit creation/minting belongs to Credits; standalone generic and WORK transfer fees belong to Wallet; trade payments and market mutations belong to AMO. WORK is not assigned new credit creation or mint demand.",
  "ID stock retains the original N-squared rule. Registration fees and nonmarket receiver/direct-transfer mutation fees belong to Registry events; registration transaction bytes are counted only in the ID-write lane.",
  "The WORK diagnostic shows standalone WORK transfers plus AMO WORK sales and divides the scenario total by 21,000,000. It adds no value or writes. It omits endogenous live WORK revaluation, frozen confirmation ordering, exact Q16 quantities, and the resulting feedback on AMO/INCB; it is not the canonical live floor or a settlement quote.",
  "The non-Boost AMO basket models complete list/seal/buy and list/delist lifecycles. WORK uses the current 25,000-proof face; no frozen WORK amount is guessed. Other seller prices are assumptions. Ticket principal/refunds, miner fees, open inventory, and failed attempts are excluded from scenario value.",
  "Floating-point scenario counts and values are display estimates. Canonical balances, fees, issuance, sale terms, and WORK floors remain exact chain-derived arithmetic outside this model.",
];

function marketScenarioRow(inputs, powids, multiplier) {
  return Object.fromEntries(Object.entries(inputs.marketplaceAssets).map(([asset, assumption]) => {
    const sales = powids * assumption.salesPerIdPerYear * multiplier;
    const cancelledListings = powids * assumption.cancelledListingsPerIdPerYear * multiplier;
    const writes = sales * inputs.marketplaceSaleWrites +
      cancelledListings * inputs.marketplaceCancellationWrites;
    const saleVolumeSats = sales * assumption.averageSaleSats;
    const registryFeeSats = writes * inputs.marketplaceRegistryFeeSats;
    return [asset, {
      sales,
      cancelledListings,
      listings: sales + cancelledListings,
      seals: sales,
      delistings: cancelledListings,
      writes,
      saleVolumeSats,
      registryFeeSats,
      valueSats: (saleVolumeSats + registryFeeSats) * inputs.valueMultiple,
      vbytes: writes * inputs.marketplaceVbytesPerWrite,
    }];
  }));
}

export function growthModelRow(horizon, inputs = GROWTH_MODEL_INPUTS) {
  // Reuse the preserved legacy/Boost demand equations before capacity allocation.
  // The inherited Mail/Drive/Browser rates now name disjoint content baskets.
  const raw = buildGrowthModelRow(horizon, {
    ...inputs,
    blockspaceVbytesPerYear: Number.MAX_VALUE,
  }, true);
  const usage = (rate, elasticity) => raw.powids * rate *
    growthFeeMultiplier(inputs.canonicalFee, elasticity);
  const tokenCreateWrites = usage(inputs.creditCreatesPerIdPerYear, inputs.elasticities.token);
  const tokenMintWrites = raw.tokenWrites;
  const tokenWrites = tokenCreateWrites + tokenMintWrites;
  const tokenSats = raw.tokenSats + tokenCreateWrites * inputs.creditCreateFeeSats * inputs.valueMultiple;
  const walletGenericTransferWrites = usage(inputs.walletGenericTransfersPerIdPerYear, inputs.elasticities.wallet);
  const walletWorkTransferWrites = usage(inputs.walletWorkTransfersPerIdPerYear, inputs.elasticities.wallet);
  const walletWrites = walletGenericTransferWrites + walletWorkTransferWrites;
  const walletSats = walletWrites * inputs.walletTransferFeeSats * inputs.valueMultiple;
  const infinityWrites = usage(inputs.infinityActionsPerIdPerYear, inputs.elasticities.infinity);
  const infinitySats = infinityWrites * inputs.infinityAverageBondSats * inputs.valueMultiple;
  const inceptionWrites = usage(inputs.inceptionActionsPerIdPerYear, inputs.elasticities.inception);
  const inceptionSats = inceptionWrites * inputs.inceptionAverageBondSats * inputs.valueMultiple;
  const computerEventWrites = usage(inputs.idMutationsPerIdPerYear, inputs.elasticities.computerEvent);
  const idRegistrationFlowSats = raw.idWrites * inputs.idRegistrationFeeSats;
  const idMutationFlowSats = computerEventWrites * inputs.idMutationFeeSats;
  const computerEventSats = (idRegistrationFlowSats + idMutationFlowSats) * inputs.valueMultiple;
  const rawMarketplaceByAsset = marketScenarioRow(inputs, raw.powids,
    growthFeeMultiplier(inputs.canonicalFee, inputs.elasticities.marketplace));
  const marketSum = (field) => Object.values(rawMarketplaceByAsset)
    .reduce((sum, asset) => sum + asset[field], 0);
  const marketplaceWrites = marketSum("writes");
  const marketplaceSats = marketSum("valueSats");
  const rawBlockspaceVbytes =
    raw.idWrites * inputs.idVbytesPerWrite +
    raw.mailWrites * inputs.mailVbytesPerWrite +
    raw.driveWrites * inputs.driveVbytesPerWrite +
    raw.browserWrites * inputs.browserVbytesPerPage +
    tokenMintWrites * inputs.tokenVbytesPerWrite +
    tokenCreateWrites * inputs.creditCreateVbytesPerWrite +
    raw.boostVbytes + marketSum("vbytes") +
    walletWrites * inputs.walletVbytesPerTransfer +
    infinityWrites * inputs.infinityVbytesPerAction +
    inceptionWrites * inputs.inceptionVbytesPerAction +
    computerEventWrites * inputs.idMutationVbytesPerWrite;
  const ratio = rawBlockspaceVbytes > 0
    ? Math.min(rawBlockspaceVbytes, inputs.blockspaceVbytesPerYear) / rawBlockspaceVbytes
    : 1;
  const row = {
    ...raw,
    blockspaceUsageRatio: ratio,
    rawBlockspaceVbytes,
    executedBlockspaceVbytes: rawBlockspaceVbytes * ratio,
    idWrites: raw.idWrites * ratio,
    mailSats: raw.mailSats * ratio,
    mailWrites: raw.mailWrites * ratio,
    driveSats: raw.driveSats * ratio,
    driveWrites: raw.driveWrites * ratio,
    browserSats: raw.browserSats * ratio,
    browserWrites: raw.browserWrites * ratio,
    tokenSats: tokenSats * ratio,
    tokenWrites: tokenWrites * ratio,
    tokenCreateWrites: tokenCreateWrites * ratio,
    tokenMintWrites: tokenMintWrites * ratio,
    walletSats: walletSats * ratio,
    walletWrites: walletWrites * ratio,
    walletGenericTransferWrites: walletGenericTransferWrites * ratio,
    walletWorkTransferWrites: walletWorkTransferWrites * ratio,
    infinitySats: infinitySats * ratio,
    infinityWrites: infinityWrites * ratio,
    inceptionSats: inceptionSats * ratio,
    inceptionWrites: inceptionWrites * ratio,
    computerEventSats: computerEventSats * ratio,
    computerEventWrites: computerEventWrites * ratio,
    computerEventActions: (raw.idWrites + computerEventWrites) * ratio,
    idRegistrationFlowSats: idRegistrationFlowSats * ratio,
    idMutationFlowSats: idMutationFlowSats * ratio,
    boostSats: raw.boostSats * ratio,
    boostWrites: raw.boostWrites * ratio,
    boostOriginalPosts: raw.boostOriginalPosts * ratio,
    boostPaidActions: raw.boostPaidActions * ratio,
    boostSales: raw.boostSales * ratio,
    boostVbytes: raw.boostVbytes * ratio,
    marketplaceSats: marketplaceSats * ratio,
    marketplaceWrites: marketplaceWrites * ratio,
    marketplaceByAsset: Object.fromEntries(Object.entries(rawMarketplaceByAsset).map(([asset, values]) => [
      asset, Object.fromEntries(Object.entries(values).map(([field, value]) => [field, value * ratio])),
    ])),
    totalWrites: (
      raw.idWrites + raw.mailWrites + raw.driveWrites + raw.browserWrites +
      tokenWrites + raw.boostWrites + marketplaceWrites + walletWrites +
      infinityWrites + inceptionWrites + computerEventWrites
    ) * ratio,
  };
  row.totalSats = GROWTH_VALUE_LANES.reduce((sum, lane) => sum + row[lane.key], 0);
  row.totalUsdBase = row.totalSats / 100_000_000 * row.btcUsdBase;
  row.workMovementWrites = row.walletWorkTransferWrites + row.marketplaceByAsset.work.sales;
  row.workFloorSats = row.totalSats / inputs.workMaxSupply;
  return row;
}

export function growthModelStartRow() {
  // Historical observed origin is preserved; new assumptions are never backfilled
  // into that origin as if they were confirmed September measurements.
  const row = {
    ...boostGrowthModelStartRow(),
    tokenCreateWrites: 0,
    tokenMintWrites: 0,
    walletSats: 0,
    walletWrites: 0,
    walletGenericTransferWrites: 0,
    walletWorkTransferWrites: 0,
    infinitySats: 0,
    infinityWrites: 0,
    inceptionSats: 0,
    inceptionWrites: 0,
    computerEventSats: 0,
    computerEventWrites: 0,
    computerEventActions: 0,
    idRegistrationFlowSats: 0,
    idMutationFlowSats: 0,
    marketplaceByAsset: marketScenarioRow(GROWTH_MODEL_INPUTS, 0, 0),
    workMovementWrites: 0,
  };
  return { ...row, workFloorSats: row.totalSats / GROWTH_MODEL_INPUTS.workMaxSupply };
}

export const GROWTH_MODEL_ROWS = GROWTH_MODEL_INPUTS.horizons.map((horizon) => growthModelRow(horizon));
export const GROWTH_MODEL_CHART_ROWS = [growthModelStartRow(), ...GROWTH_MODEL_ROWS];

const assumption = GROWTH_MODEL_INPUTS;
export const GROWTH_ASSUMPTIONS = [
  {
    product: "IDs",
    usage: "Projected agent nodes × adoption; ID writes use the original ID fee multiplier.",
    value: `N² × ${assumption.idDensitySatsPerN2} proofs density × fee multiplier; registration fees are in Registry events.`,
    elasticity: String(assumption.elasticities.id),
    blockspace: `${assumption.idVbytesPerWrite} vB per registration; physical writes share the common cap.`,
    attribution: "ID network stock is unthrottled. Registration transaction bytes are counted here once; the same registration is not a second Registry-event write.",
  },
  {
    product: "Mail",
    usage: `${assumption.mailMessagesPerPairPerYear} messages per directed pair per year × ${assumption.mailEdgeDensity} edge density.`,
    value: `${assumption.mailSatsPerDelivery} proofs per delivery × ${assumption.valueMultiple} service multiple.`,
    elasticity: String(assumption.elasticities.mail),
    blockspace: `${assumption.mailVbytesPerWrite} vB per ordinary message.`,
    attribution: "Ordinary text messages, including text-only Boost originals; excludes file, HTML-page, and bond publications.",
  },
  {
    product: "Files / Drive",
    usage: `${assumption.driveFilesPerIdPerYear} non-HTML files per ID per year.`,
    value: `${assumption.satsPerFile} proofs per file × ${assumption.valueMultiple} service multiple.`,
    elasticity: String(assumption.elasticities.drive),
    blockspace: `${assumption.driveVbytesPerWrite} vB per publication, including its Mail carrier.`,
    attribution: "Files and Desktop expose the same record; neither Mail nor Desktop adds its payment or bytes again. Boost media reuses these published files.",
  },
  {
    product: "Browser authoring",
    usage: `${assumption.browserPagesPerIdPerYear} HTML pages per ID per year.`,
    value: `${assumption.browserAveragePageSats} proofs per page × ${assumption.valueMultiple} service multiple.`,
    elasticity: String(assumption.elasticities.browser),
    blockspace: `${assumption.browserVbytesPerPage} vB per HTML publication. Reading adds zero bytes.`,
    attribution: "HTML Mail bodies and HTML Files attachments are allocated exclusively here; Mail/Drive do not add the same page again.",
  },
  {
    product: "Boost",
    usage: `${assumption.boostOriginalPostsPerIdPerYear} text originals, ${assumption.boostPaidActionsPerIdPerYear} standalone paid actions, and ${assumption.boostSalesPerIdPerYear} sales per ID per year. Originals are capped by Mail demand.`,
    value: `${assumption.boostRegistryFeeSats} registry proofs per paid action; each sale adds ${assumption.boostAverageSaleSats} seller proofs plus ${assumption.boostMarketWritesPerSale} registry fees, then × ${assumption.valueMultiple}.`,
    elasticity: String(assumption.elasticities.boost),
    blockspace: `${assumption.boostOriginalMetadataVbytes} additional metadata vB per original; ${assumption.boostVbytesPerPaidAction} vB per paid action; ${assumption.boostVbytesPerSale} vB per sale lifecycle.`,
    attribution: "Original transactions stay in Mail; media stays in Files; WORK attachments have no added forecast value. Boost sales are excluded from the non-Boost AMO basket.",
  },
  ...["infinity", "inception"].map((bond) => ({
    product: bond === "infinity" ? "Infinity / POWB" : "Inception / INCB",
    usage: `${assumption[`${bond}ActionsPerIdPerYear`]} direct bond actions per ID per year.`,
    value: `${assumption[`${bond}AverageBondSats`]} direct proofs per bond × ${assumption.valueMultiple} service multiple.`,
    elasticity: String(assumption.elasticities[bond]),
    blockspace: `${assumption[`${bond}VbytesPerAction`]} vB per tagged bond transaction, including its Mail carrier.`,
    attribution: "Direct bond payment counted once; synthetic issuance adds no second payment. Bond trades belong to AMO, and attached WORK is outside this value forecast.",
  })),
  {
    product: "Credits",
    usage: `${assumption.creditCreatesPerIdPerYear} generic credit creations and ${assumption.tokenMintsPerIdPerYear} generic credit mints per ID per year.`,
    value: `${assumption.creditCreateFeeSats} proofs per creation and ${assumption.tokenAverageMintSats} proofs per mint, then × ${assumption.valueMultiple}.`,
    elasticity: String(assumption.elasticities.token),
    blockspace: `${assumption.creditCreateVbytesPerWrite} vB per creation; ${assumption.tokenVbytesPerWrite} vB per mint.`,
    attribution: "Creation/mint only. Transfers belong to Wallet; trades to AMO; no new WORK or bond issuance is assumed here.",
  },
  {
    product: "Wallet transfers",
    usage: `${assumption.walletGenericTransfersPerIdPerYear} generic-credit and ${assumption.walletWorkTransfersPerIdPerYear} WORK standalone transfers per ID per year.`,
    value: `${assumption.walletTransferFeeSats} registry proofs per transfer × ${assumption.valueMultiple} service multiple.`,
    elasticity: String(assumption.elasticities.wallet),
    blockspace: `${assumption.walletVbytesPerTransfer} vB per standalone transfer.`,
    attribution: "Market purchases and attached transfers are excluded from this standalone basket. WORK quantity revaluation is not added to the total.",
  },
  {
    product: "AMO",
    usage: Object.values(assumption.marketplaceAssets).map((asset) => `${asset.name}: ${asset.salesPerIdPerYear} sales / ${asset.cancelledListingsPerIdPerYear} canceled listings per ID per year`).join("; "),
    value: `Seller-price assumptions: ${Object.values(assumption.marketplaceAssets).map((asset) => `${asset.name} ${asset.averageSaleSats} proofs`).join(", ")}. Each lifecycle write adds ${assumption.marketplaceRegistryFeeSats} registry proofs; combined flow × ${assumption.valueMultiple}.`,
    elasticity: String(assumption.elasticities.marketplace),
    blockspace: `${assumption.marketplaceVbytesPerWrite} vB per write; completed sales use ${assumption.marketplaceSaleWrites} writes (list/seal/buy), cancellations ${assumption.marketplaceCancellationWrites} (list/delist).`,
    attribution: "Separate IDs/generic-credit/WORK/POWB/INCB baskets; excludes Boost sales, Wallet standalone transfers, ticket refunds, and guessed WORK settlement quantities.",
  },
  {
    product: "Registry events",
    usage: `ID registration writes already modeled under IDs, plus ${assumption.idMutationsPerIdPerYear} nonmarket receiver/direct-transfer mutations per ID per year.`,
    value: `${assumption.idRegistrationFeeSats} registry proofs per registration and ${assumption.idMutationFeeSats} per mutation, then × ${assumption.valueMultiple}.`,
    elasticity: `Registrations ${assumption.elasticities.id}; mutations ${assumption.elasticities.computerEvent}.`,
    blockspace: `${assumption.idMutationVbytesPerWrite} vB per additional mutation; registration bytes remain only in IDs.`,
    attribution: "Known nonmarket ID registry flow only. No generic fee is assigned to Log itself, and AMO mutations remain in AMO.",
  },
  {
    product: "WORK diagnostic",
    usage: "Standalone WORK transfers from Wallet plus WORK sale movements from AMO, referenced once.",
    value: `Scenario total / ${assumption.workMaxSupply} WORK; diagnostic only, no added capitalization or endogenous movement value.`,
    elasticity: "Inherited from Wallet and AMO; no additional multiplier.",
    blockspace: "Zero additional writes or bytes; movements are already in Wallet/AMO.",
    attribution: "Endpoint scenario floor only. It does not simulate canonical Q16 replay, historical frozen terms, movement feedback, or settlement prices.",
  },
];

export const GROWTH_PRODUCT_COVERAGE = [
  { product: "home", name: "Home", role: "read-only", owner: "None", modeledLane: "No incremental lane", activity: "Landing page and apex redirect", assumption: "Navigation creates no chain activity.", source: "README.md production app roles" },
  { product: "ids", name: "IDs", role: "economic", owner: "IDs / Registry events", modeledLane: "idSats + computerEventSats", activity: "ID stock, registrations, receiver updates, and direct ownership transfers", assumption: "Identity stock and registry payments are separate components; registration bytes occur once.", source: "PROOFOFWORK_IDS.md; confirmed registry and Growth summary" },
  { product: "computer", name: "Computer", role: "aggregate", owner: "Underlying activity products", modeledLane: "totalSats", activity: "Shell, Mail, Files, embedded workspaces, and NFT route alias", assumption: "Aggregate of owned activity lanes; the shell and NFT alias add no second copy.", source: "MAIL_ORGANIZATION.md; confirmed Mail/Files and Growth summary" },
  { product: "mail", name: "Mail", role: "economic", owner: "Mail", modeledLane: "mailSats", activity: "Computer workspace for ordinary messages and text-only Boost originals", assumption: "Files, HTML pages, and tagged bonds are allocated to their specific lane; the ordinary Mail basket excludes those carriers.", source: "MAIL_ORGANIZATION.md Mail and attachment rules" },
  { product: "files", name: "Files", role: "economic", owner: "Files / Drive", modeledLane: "driveSats", activity: "Computer workspace for non-HTML file publication and retrieval", assumption: "A published file and its Mail carrier occur once; HTML authoring belongs to Browser and repeat retrieval is read-only.", source: "MAIL_ORGANIZATION.md Files and Drive aliases" },
  { product: "desktop", name: "Desktop", role: "shared", owner: "Files / Drive or Browser authoring", modeledLane: "driveSats / browserSats", activity: "Read-only access to existing Files and HTML records", assumption: "Zero additional value or writes for displaying the same file.", source: "MAIL_ORGANIZATION.md Files/Desktop rules" },
  { product: "browser", name: "Browser", role: "shared", owner: "Browser authoring", modeledLane: "browserSats", activity: "HTML publication through Mail/Files; read-only rendering", assumption: "Publish once in the Browser authoring basket; Mail/Drive and repeat views do not duplicate it.", source: "MAIL_ORGANIZATION.md Browser rules" },
  { product: "boost", name: "Boost", role: "economic", owner: "Boost with shared Mail/Files", modeledLane: "boostSats; original carrier in mailSats", activity: "Original posts, paid social actions, and Boost sale lifecycles", assumption: "Originals add metadata only; paid-action and sale baskets are disjoint; media and WORK are not valued twice.", source: "PROOFOFWORK_IDS.md Boost Social; snapshot-bound Boost observations" },
  { product: "amo", name: "AMO", role: "economic", owner: "AMO / Boost", modeledLane: "marketplaceSats; Boost sale flow in boostSats", activity: "ID, credit, WORK, POWB, INCB, and Boost markets; legacy Marketplace hostname", assumption: "Each sale/mutation belongs to one asset basket, with seller price and registry fee separated.", source: "MARKETPLACE.md current sale-ticket protocols" },
  { product: "credit", name: "Credits", role: "economic", owner: "Credits", modeledLane: "tokenSats", activity: "Generic credit creation and minting; token/tokens hostname aliases", assumption: "Creation and mint assumptions only; ownership transfers and markets belong to their respective baskets.", source: "README.md Credits; confirmed credit definitions and mints" },
  { product: "wallet", name: "Wallet", role: "economic", owner: "Wallet transfers / AMO", modeledLane: "walletSats; trades in marketplaceSats", activity: "Balances, standalone generic/WORK transfers, and market controls", assumption: "Balance display is read-only; standalone transfer fees are incremental; trades are counted only in AMO.", source: "README.md Wallet; confirmed credit transfer history" },
  { product: "work", name: "WORK", role: "derived", owner: "Wallet / AMO / aggregate", modeledLane: "workMovementWrites + workFloorSats (nonadditive)", activity: "WORK movement count and scenario total divided by capped supply", assumption: "No new WORK mint demand and no separate floor capitalization or endogenous movement revaluation.", source: "MARKETPLACE.md WORK V8; canonical WORK floor is separate" },
  { product: "infinity", name: "Infinity", role: "economic", owner: "Infinity / AMO", modeledLane: "infinitySats; POWB trades in marketplaceSats", activity: "Direct bond payments, synthetic issuance, and POWB markets", assumption: "Bond payment once; synthetic issuance adds no payment; sale/mutation fees occur in AMO.", source: "MARKETPLACE.md Infinity Bond rules" },
  { product: "inception", name: "Inception", role: "economic", owner: "Inception / AMO", modeledLane: "inceptionSats; INCB trades in marketplaceSats", activity: "Direct bond payments, synthetic issuance, and INCB markets", assumption: "Direct payment once; attached WORK and exact INCB issuance feedback are outside the forward-value model.", source: "MARKETPLACE.md Inception Bond rules" },
  { product: "log", name: "Log", role: "read-only", owner: "Underlying activity products", modeledLane: "No incremental lane", activity: "Confirmed event discovery and transaction evidence", assumption: "The event's owner counts its flow; viewing or indexing a Log row adds no payment.", source: "OP_RETURN_INFRASTRUCTURE.md Log and event history" },
  { product: "growth", name: "Growth", role: "read-only", owner: "Aggregate / scenario diagnostics", modeledLane: "No incremental lane", activity: "Confirmed metrics and forward scenarios", assumption: "A dashboard, metric, or forecast creates no new chain value.", source: "README.md Growth; shared confirmed summary snapshot" },
];
