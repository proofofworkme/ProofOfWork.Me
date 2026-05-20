import { writeFileSync } from "node:fs";

const OUTPUT = "output/bitcoin-computer-agent-adoption-model.md";
const GROWTH_JSON_OUTPUT = "output/bitcoin-computer-growth-model.json";

const inputs = {
  generatedOn: "2026-05-13",
  bitnodes: {
    reachableNodes: 23984,
    snapshotTimeUtc: "2026-04-30 08:58:26 UTC",
    source: "Bitnodes",
  },
  btc: {
    currentUsd: 80879.33,
    currentDate: "2026-05-11",
    historicalUsd: 452.73,
    historicalDate: "2016-05-11",
    tenYearVolatility: 0.5673,
  },
  pow: {
    confirmedPowids: 94,
    uniqueReceiveAddressBalanceSats: 2374139,
    idDensitySatsPerN2: 268.68933906745133,
    mailTxids: 12,
    mailDeliveryEdges: 15,
    mailPaidAttentionFlowSats: 10202,
    mailSatsPerDelivery: 680.1333333333333,
    mailEdgeDensity: 0.012307692307692308,
    fileTxids: 4,
    uniqueFileHashes: 4,
    totalFileBytes: 37284,
    fileFlowSats: 2184,
    satsPerFileBase: 1000,
    marketplaceSales: 1,
    marketplaceVolumeSats: 1000,
    marketplaceAverageSaleSats: 1000,
    browserPageTxids: 0,
    browserPageFlowSats: 0,
    browserAveragePageSats: 1000,
  },
  blockspace: {
    maxBlockWeightUnits: 4_000_000,
    witnessScaleFactor: 4,
    targetBlocksPerDay: 144,
    daysPerYear: 365,
    idVbytesPerWrite: 350,
    mailVbytesPerWrite: 500,
    marketplaceVbytesPerSale: 1500,
    browserVbytesPerPage: 15000,
    txOverheadVbytes: 300,
  },
  scenario: {
    agentShare: 0.51,
    nodeCagr: 0.25,
    mailMessagesPerPairPerYear: 4,
    mailValueMultiple: 5,
    driveFilesPerIdPerYear: 6,
    driveValueMultiple: 5,
    marketplaceSalesPerIdPerYear: 0.2,
    marketplaceValueMultiple: 5,
    browserPagesPerIdPerYear: 1,
    browserValueMultiple: 5,
    canonicalFee: 0.00001,
    horizons: [
      { label: "6 months", years: 0.5, adoption: 0.1 },
      { label: "12 months", years: 1, adoption: 0.2 },
      { label: "24 months", years: 2, adoption: 0.4 },
      { label: "5 years", years: 5, adoption: 0.6 },
      { label: "10 years", years: 10, adoption: 0.8 },
      { label: "25 years", years: 25, adoption: 0.9 },
      { label: "50 years", years: 50, adoption: 1 },
    ],
    feeTiers: [0.01, 0.001, 0.0001, 0.00001],
    elasticities: {
      id: 0.25,
      mail: 0.5,
      drive: 0.75,
      marketplace: 0.5,
      browser: 0.75,
    },
  },
};

const btcLogGrowth = Math.log(inputs.btc.currentUsd / inputs.btc.historicalUsd) / 10;
const btcEquivalentCagr = Math.exp(btcLogGrowth) - 1;
const blockspaceVbytesPerBlock = inputs.blockspace.maxBlockWeightUnits / inputs.blockspace.witnessScaleFactor;
const blockspaceVbytesPerYear =
  blockspaceVbytesPerBlock * inputs.blockspace.targetBlocksPerDay * inputs.blockspace.daysPerYear;
const averageFilePayloadBytes = inputs.pow.totalFileBytes / inputs.pow.uniqueFileHashes;
const driveVbytesPerWrite = Math.ceil(averageFilePayloadBytes + inputs.blockspace.txOverheadVbytes);

function feeMultiplier(feeRate, elasticity) {
  return (0.01 / feeRate) ** elasticity;
}

function futureBtcUsd(years) {
  const base = inputs.btc.currentUsd * Math.exp(btcLogGrowth * years);
  const volatility = inputs.btc.tenYearVolatility * Math.sqrt(years);
  return {
    low: inputs.btc.currentUsd * Math.exp(btcLogGrowth * years - volatility),
    base,
    high: inputs.btc.currentUsd * Math.exp(btcLogGrowth * years + volatility),
  };
}

function modelRow(horizon, feeRate) {
  const nodes = inputs.bitnodes.reachableNodes * (1 + inputs.scenario.nodeCagr) ** horizon.years;
  const agentNodes = nodes * inputs.scenario.agentShare;
  const powids = agentNodes * horizon.adoption;
  const directedPairs = powids * Math.max(0, powids - 1);
  const idMultiplier = feeMultiplier(feeRate, inputs.scenario.elasticities.id);
  const mailMultiplier = feeMultiplier(feeRate, inputs.scenario.elasticities.mail);
  const driveMultiplier = feeMultiplier(feeRate, inputs.scenario.elasticities.drive);
  const marketplaceMultiplier = feeMultiplier(feeRate, inputs.scenario.elasticities.marketplace);
  const browserMultiplier = feeMultiplier(feeRate, inputs.scenario.elasticities.browser);
  const rawIdSats = powids ** 2 * inputs.pow.idDensitySatsPerN2 * idMultiplier;
  const rawMailSats =
    directedPairs *
    inputs.pow.mailEdgeDensity *
    inputs.scenario.mailMessagesPerPairPerYear *
    inputs.pow.mailSatsPerDelivery *
    inputs.scenario.mailValueMultiple *
    mailMultiplier;
  const rawDriveSats =
    powids *
    inputs.scenario.driveFilesPerIdPerYear *
    inputs.pow.satsPerFileBase *
    inputs.scenario.driveValueMultiple *
    driveMultiplier;
  const rawMarketplaceSats =
    powids *
    inputs.scenario.marketplaceSalesPerIdPerYear *
    inputs.pow.marketplaceAverageSaleSats *
    inputs.scenario.marketplaceValueMultiple *
    marketplaceMultiplier;
  const rawBrowserSats =
    powids *
    inputs.scenario.browserPagesPerIdPerYear *
    inputs.pow.browserAveragePageSats *
    inputs.scenario.browserValueMultiple *
    browserMultiplier;
  const idWrites = powids * idMultiplier;
  const mailWrites =
    directedPairs *
    inputs.pow.mailEdgeDensity *
    inputs.scenario.mailMessagesPerPairPerYear *
    mailMultiplier;
  const driveWrites = powids * inputs.scenario.driveFilesPerIdPerYear * driveMultiplier;
  const marketplaceWrites = powids * inputs.scenario.marketplaceSalesPerIdPerYear * marketplaceMultiplier;
  const browserWrites = powids * inputs.scenario.browserPagesPerIdPerYear * browserMultiplier;
  const idVbytes = idWrites * inputs.blockspace.idVbytesPerWrite;
  const mailVbytes = mailWrites * inputs.blockspace.mailVbytesPerWrite;
  const driveVbytes = driveWrites * driveVbytesPerWrite;
  const marketplaceVbytes = marketplaceWrites * inputs.blockspace.marketplaceVbytesPerSale;
  const browserVbytes = browserWrites * inputs.blockspace.browserVbytesPerPage;
  const rawBlockspaceVbytes = idVbytes + mailVbytes + driveVbytes + marketplaceVbytes + browserVbytes;
  const executedBlockspaceVbytes = Math.min(rawBlockspaceVbytes, blockspaceVbytesPerYear);
  const blockspaceUsageRatio = rawBlockspaceVbytes > 0 ? executedBlockspaceVbytes / rawBlockspaceVbytes : 1;
  const blockspaceSaturation = executedBlockspaceVbytes / blockspaceVbytesPerYear;
  const isBlockspaceCapped = rawBlockspaceVbytes > blockspaceVbytesPerYear;
  const idSats = rawIdSats;
  const mailSats = rawMailSats * blockspaceUsageRatio;
  const driveSats = rawDriveSats * blockspaceUsageRatio;
  const marketplaceSats = rawMarketplaceSats * blockspaceUsageRatio;
  const browserSats = rawBrowserSats * blockspaceUsageRatio;
  const totalSats = idSats + mailSats + driveSats + marketplaceSats + browserSats;
  const btc = totalSats / 100_000_000;
  const usdPath = futureBtcUsd(horizon.years);

  return {
    ...horizon,
    feeRate,
    nodes,
    agentNodes,
    powids,
    directedPairs,
    idMultiplier,
    mailMultiplier,
    driveMultiplier,
    marketplaceMultiplier,
    browserMultiplier,
    rawIdSats,
    rawMailSats,
    rawDriveSats,
    rawMarketplaceSats,
    rawBrowserSats,
    rawTotalSats: rawIdSats + rawMailSats + rawDriveSats + rawMarketplaceSats + rawBrowserSats,
    idSats,
    mailSats,
    driveSats,
    marketplaceSats,
    browserSats,
    totalSats,
    idWrites,
    mailWrites,
    driveWrites,
    marketplaceWrites,
    browserWrites,
    idVbytes,
    mailVbytes,
    driveVbytes,
    marketplaceVbytes,
    browserVbytes,
    rawBlockspaceVbytes,
    executedBlockspaceVbytes,
    blockspaceUsageRatio,
    blockspaceSaturation,
    isBlockspaceCapped,
    btc,
    btcUsdLow: usdPath.low,
    btcUsdBase: usdPath.base,
    btcUsdHigh: usdPath.high,
    usdLow: btc * usdPath.low,
    usdBase: btc * usdPath.base,
    usdHigh: btc * usdPath.high,
  };
}

function fmtNumber(value, decimals = 0) {
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function fmtSats(value) {
  return fmtNumber(Math.round(value));
}

function fmtBtc(value) {
  return fmtNumber(value, value >= 1000 ? 2 : 4);
}

function fmtUsd(value) {
  return `$${fmtNumber(Math.round(value))}`;
}

function fmtUsdPrecise(value) {
  return `$${fmtNumber(value, 2)}`;
}

function fmtPct(value, decimals = 2) {
  return `${(value * 100).toFixed(decimals)}%`;
}

function fmtPctReadable(value, decimals = 2) {
  const percent = value * 100;
  if (percent > 0 && percent < 10 ** -decimals) return `<${(10 ** -decimals).toFixed(decimals)}%`;
  return `${percent.toFixed(decimals)}%`;
}

function fmtFee(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 0 });
}

function humanUsd(value) {
  const units = [
    [1e33, "decillion"],
    [1e30, "nonillion"],
    [1e27, "octillion"],
    [1e24, "septillion"],
    [1e21, "sextillion"],
    [1e18, "quintillion"],
    [1e15, "quadrillion"],
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  const unit = units.find(([size]) => value >= size);
  if (!unit) return fmtUsd(value);
  const [size, label] = unit;
  const scaled = value / size;
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `$${scaled.toFixed(decimals).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")} ${label}`;
}

function humanVbytes(value) {
  const units = [
    [1e21, "sextillion vB"],
    [1e18, "quintillion vB"],
    [1e15, "quadrillion vB"],
    [1e12, "trillion vB"],
    [1e9, "billion vB"],
    [1e6, "million vB"],
    [1e3, "thousand vB"],
  ];
  const unit = units.find(([size]) => value >= size);
  if (!unit) return `${fmtNumber(value, 0)} vB`;
  const [size, label] = unit;
  const scaled = value / size;
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")} ${label}`;
}

function table(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map((header, index) => (index === 0 ? "---" : "---:")).join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function productTable(rows) {
  return table(
    ["Horizon", "PowIDs", "ID sats", "Mail sats", "Drive sats", "Marketplace sats", "Browser sats", "Total sats", "BTC", "Base USD", "Volatility USD range"],
    rows.map((row) => [
      row.label,
      fmtNumber(Math.round(row.powids)),
      fmtSats(row.idSats),
      fmtSats(row.mailSats),
      fmtSats(row.driveSats),
      fmtSats(row.marketplaceSats),
      fmtSats(row.browserSats),
      fmtSats(row.totalSats),
      fmtBtc(row.btc),
      `${fmtUsd(row.usdBase)} (${humanUsd(row.usdBase)})`,
      `${humanUsd(row.usdLow)} to ${humanUsd(row.usdHigh)}`,
    ]),
  );
}

function aggregateFeeTable(rows) {
  return table(
    ["Horizon", "Fee tier", "PowIDs", "Total sats", "BTC", "Base USD", "Low USD", "High USD"],
    rows.map((row) => [
      row.label,
      `${fmtFee(row.feeRate)} sat/vB`,
      fmtNumber(Math.round(row.powids)),
      fmtSats(row.totalSats),
      fmtBtc(row.btc),
      humanUsd(row.usdBase),
      humanUsd(row.usdLow),
      humanUsd(row.usdHigh),
    ]),
  );
}

function growthEngineTable(rows) {
  return table(
    ["Horizon", "Years", "Future nodes", "Agent nodes", "Adoption", "PowIDs", "BTC/USD low", "BTC/USD base", "BTC/USD high"],
    rows.map((row) => [
      row.label,
      fmtNumber(row.years, 1),
      fmtNumber(Math.round(row.nodes)),
      fmtNumber(Math.round(row.agentNodes)),
      fmtPct(row.adoption, 0),
      fmtNumber(Math.round(row.powids)),
      fmtUsd(row.btcUsdLow),
      fmtUsd(row.btcUsdBase),
      fmtUsd(row.btcUsdHigh),
    ]),
  );
}

function blockspaceConstraintTable(rows) {
  return table(
    ["Horizon", "Raw annual demand", "Executable blockspace", "Ceiling used", "Usage fulfilled", "Capped?"],
    rows.map((row) => [
      row.label,
      humanVbytes(row.rawBlockspaceVbytes),
      humanVbytes(row.executedBlockspaceVbytes),
      fmtPct(row.blockspaceSaturation, 2),
      fmtPctReadable(row.blockspaceUsageRatio, 2),
      row.isBlockspaceCapped ? "yes" : "no",
    ]),
  );
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function humanUsdShort(value) {
  const units = [
    [1e30, "N"],
    [1e27, "O"],
    [1e24, "Sp"],
    [1e21, "Sx"],
    [1e18, "Qn"],
    [1e15, "Qd"],
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  const unit = units.find(([size]) => value >= size);
  if (!unit) return fmtUsd(value);
  const [size, label] = unit;
  const scaled = value / size;
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `$${scaled.toFixed(decimals).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}${label}`;
}

function svgText(lines, x, y, options = {}) {
  const {
    size = 28,
    weight = 500,
    fill = "#0f172a",
    lineHeight = size * 1.28,
    anchor = "start",
    family = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  } = options;
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`,
    )
    .join("\n");
}

function svgShell(title, subtitle, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<rect width="1600" height="900" fill="#f8fafc"/>
${svgText([title], 80, 82, { size: 56, weight: 850, fill: "#0f172a" })}
${svgText([subtitle], 82, 126, { size: 25, weight: 500, fill: "#475569" })}
${body}
${svgText(["ProofOfWork.Me Bitcoin Computer Model | generated from output/bitcoin-computer-agent-adoption-model.md"], 80, 848, { size: 20, fill: "#64748b" })}
</svg>
`;
}

function renderCompoundingVisual() {
  const cards = [
    {
      title: "1. Agents appear",
      value: "51% of nodes",
      body: ["Bitcoin nodes grow.", "Agent nodes inherit PowIDs.", "Every PowID becomes", "addressable."],
      color: "#0f766e",
    },
    {
      title: "2. Identity compounds",
      value: "n squared",
      body: ["More PowIDs create more", "possible relationships.", "The graph becomes", "the asset."],
      color: "#2563eb",
    },
    {
      title: "3. Usage hits blockspace",
      value: "52.56B vB/year",
      body: ["Write demand compounds.", "Bitcoin blockspace is finite.", "Usage becomes scarce", "at the ceiling."],
      color: "#c2410c",
    },
    {
      title: "4. Bitcoin reprices it",
      value: "log + vol",
      body: ["Sats/BTC value is translated", "to USD with Bitcoin's 10Y", "log growth and volatility."],
      color: "#7c3aed",
    },
  ];

  const cardSvg = cards
    .map((card, index) => {
      const x = 80 + index * 375;
      return `<rect x="${x}" y="205" width="330" height="360" rx="22" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
<rect x="${x}" y="205" width="330" height="12" rx="6" fill="${card.color}"/>
${svgText([card.title], x + 28, 270, { size: 28, weight: 750, fill: "#0f172a" })}
${svgText([card.value], x + 28, 340, { size: 43, weight: 850, fill: card.color })}
${svgText(card.body, x + 28, 415, { size: 22, weight: 500, fill: "#334155", lineHeight: 31 })}`;
    })
    .join("\n");

  const body = `${cardSvg}
<rect x="160" y="635" width="1280" height="96" rx="24" fill="#0f172a"/>
${svgText(["Native value is IDs + Mail + Drive + Marketplace + Browser in sats/BTC."], 800, 680, { size: 32, weight: 800, fill: "#ffffff", anchor: "middle" })}
${svgText(["USD value is a translation layer after Bitcoin's historical growth and volatility are applied."], 800, 720, { size: 24, fill: "#cbd5e1", anchor: "middle" })}`;

  return svgShell("What is compounding?", "More agents, more IDs, lower fees, finite blockspace, then Bitcoin reprices the result.", body);
}

function renderDollarGrowthVisual(rows) {
  const selected = rows.slice(0, 5);
  const minLog = Math.log10(selected[0].usdBase);
  const maxLog = Math.log10(selected.at(-1).usdBase);
  const baseline = 690;
  const minHeight = 190;
  const maxHeight = 510;
  const body = selected
    .map((row, index) => {
      const x = 80 + index * 300;
      const logShare = (Math.log10(row.usdBase) - minLog) / (maxLog - minLog);
      const barHeight = minHeight + logShare * (maxHeight - minHeight);
      const y = baseline - barHeight;
      return `<rect x="${x}" y="${y}" width="250" height="${barHeight}" rx="20" fill="#7c3aed" opacity="${0.58 + index * 0.08}"/>
${svgText([row.label], x + 125, y - 26, { size: 24, weight: 750, fill: "#334155", anchor: "middle" })}
${svgText([humanUsdShort(row.usdBase)], x + 125, y + 64, { size: 44, weight: 900, fill: "#ffffff", anchor: "middle" })}
${svgText([humanUsd(row.usdBase)], x + 125, y + 108, { size: 20, weight: 650, fill: "#ede9fe", anchor: "middle" })}
${svgText([`${humanUsdShort(row.usdLow)} - ${humanUsdShort(row.usdHigh)}`], x + 125, y + 148, { size: 20, weight: 650, fill: "#f5f3ff", anchor: "middle" })}`;
    })
    .join("\n");

  const footer = `<rect x="170" y="735" width="1260" height="74" rx="20" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
${svgText(["This is why exponents matter: the same model moves from millions to billions to trillions", "as agents, usage, fees, and Bitcoin compound together."], 800, 766, { size: 22, weight: 700, fill: "#0f172a", anchor: "middle", lineHeight: 28 })}`;

  return svgShell("Dollar growth, in human words", "Canonical deep-fee path. Big labels show base USD. Smaller line shows volatility range.", `${body}${footer}`);
}

function renderProductSplitVisual(rows) {
  const selected = [rows[0], rows[2], rows[4]];
  const productColors = {
    id: "#2563eb",
    mail: "#0f766e",
    drive: "#c2410c",
    marketplace: "#7c3aed",
    browser: "#0891b2",
  };
  const bars = selected
    .map((row, index) => {
      const x = 220;
      const y = 260 + index * 150;
      const width = 1080;
      const idW = (row.idSats / row.totalSats) * width;
      const mailW = (row.mailSats / row.totalSats) * width;
      const driveW = (row.driveSats / row.totalSats) * width;
      const marketplaceW = (row.marketplaceSats / row.totalSats) * width;
      const browserW = Math.max(0, width - idW - mailW - driveW - marketplaceW);
      const btcUsd = row.btcUsdBase;
      const idUsd = (row.idSats / 100_000_000) * btcUsd;
      const mailUsd = (row.mailSats / 100_000_000) * btcUsd;
      const driveUsd = (row.driveSats / 100_000_000) * btcUsd;
      const marketplaceUsd = (row.marketplaceSats / 100_000_000) * btcUsd;
      const browserUsd = (row.browserSats / 100_000_000) * btcUsd;
      return `${svgText([row.label], 190, y + 50, { size: 28, weight: 850, fill: "#0f172a", anchor: "end" })}
<rect x="${x}" y="${y}" width="${idW}" height="64" rx="12" fill="${productColors.id}"/>
<rect x="${x + idW}" y="${y}" width="${mailW}" height="64" fill="${productColors.mail}"/>
<rect x="${x + idW + mailW}" y="${y}" width="${driveW}" height="64" fill="${productColors.drive}"/>
<rect x="${x + idW + mailW + driveW}" y="${y}" width="${marketplaceW}" height="64" fill="${productColors.marketplace}"/>
<rect x="${x + idW + mailW + driveW + marketplaceW}" y="${y}" width="${browserW}" height="64" rx="12" fill="${productColors.browser}"/>
${svgText([`Total: ${humanUsd(row.usdBase)}`], 1365, y + 42, { size: 24, weight: 800, fill: "#0f172a", anchor: "end" })}
${svgText([`IDs ${humanUsdShort(idUsd)}  |  Mail ${humanUsdShort(mailUsd)}  |  Drive ${humanUsdShort(driveUsd)}  |  Market ${humanUsdShort(marketplaceUsd)}  |  Browser ${humanUsdShort(browserUsd)}`], x, y + 100, { size: 20, weight: 650, fill: "#334155" })}`;
    })
    .join("\n");

  const legend = `<rect x="170" y="182" width="28" height="28" rx="6" fill="${productColors.id}"/>${svgText(["IDs"], 210, 205, { size: 24, weight: 750 })}
<rect x="300" y="182" width="28" height="28" rx="6" fill="${productColors.mail}"/>${svgText(["Mail"], 340, 205, { size: 24, weight: 750 })}
<rect x="440" y="182" width="28" height="28" rx="6" fill="${productColors.drive}"/>${svgText(["Drive"], 480, 205, { size: 24, weight: 750 })}
<rect x="585" y="182" width="28" height="28" rx="6" fill="${productColors.marketplace}"/>${svgText(["Marketplace"], 625, 205, { size: 24, weight: 750 })}
<rect x="800" y="182" width="28" height="28" rx="6" fill="${productColors.browser}"/>${svgText(["Browser"], 840, 205, { size: 24, weight: 750 })}`;

  return svgShell("IDs + Mail + Drive + Marketplace + Browser", "The aggregate is not one product. It is five reinforcing products measured together.", `${legend}${bars}`);
}

function renderBlockspaceVisual(rows) {
  const selected = [rows[0], rows[1], rows[2], rows[3], rows[4]];
  const maxLog = Math.log10(Math.max(...selected.map((row) => row.rawBlockspaceVbytes)));
  const minLog = Math.log10(Math.min(...selected.map((row) => row.rawBlockspaceVbytes)));
  const cards = selected
    .map((row, index) => {
      const x = 80 + index * 300;
      const logShare = (Math.log10(row.rawBlockspaceVbytes) - minLog) / (maxLog - minLog);
      const demandHeight = 70 + logShare * 145;
      const capY = 548;
      const demandY = capY - demandHeight;
      const capLabel = row.isBlockspaceCapped ? "FULL" : `${fmtPct(row.blockspaceSaturation, 0)} used`;
      const capFill = row.isBlockspaceCapped ? "#dc2626" : "#0f766e";
      return `<rect x="${x}" y="235" width="250" height="450" rx="24" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
${svgText([row.label], x + 125, 295, { size: 26, weight: 850, fill: "#0f172a", anchor: "middle" })}
<line x1="${x + 34}" y1="${capY}" x2="${x + 216}" y2="${capY}" stroke="#0f172a" stroke-width="4" stroke-dasharray="10 8"/>
<rect x="${x + 82}" y="${demandY}" width="86" height="${demandHeight}" rx="16" fill="#c2410c" opacity="0.82"/>
${svgText([capLabel], x + 125, 598, { size: 27, weight: 900, fill: capFill, anchor: "middle" })}
${svgText(["raw demand", humanVbytes(row.rawBlockspaceVbytes)], x + 125, 642, { size: 18, weight: 700, fill: "#334155", anchor: "middle", lineHeight: 24 })}`;
    })
    .join("\n");

  const header = `<rect x="190" y="156" width="1220" height="54" rx="18" fill="#0f172a"/>
${svgText([`Current theoretical ceiling: ${humanVbytes(blockspaceVbytesPerYear)} per year`], 800, 191, { size: 27, weight: 850, fill: "#ffffff", anchor: "middle" })}`;

  const footer = `<rect x="170" y="735" width="1260" height="74" rx="20" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
${svgText(["Once raw write demand crosses the ceiling, Mail, Drive, Marketplace, and Browser are throttled by executable blockspace.", "Scarce blockspace becomes part of the model instead of infinite throughput."], 800, 766, { size: 22, weight: 700, fill: "#0f172a", anchor: "middle", lineHeight: 28 })}`;

  return svgShell("Blockspace is the ceiling", "Usage demand compounds until it hits today's theoretical Bitcoin blockspace limit.", `${header}${cards}${footer}`);
}

function renderVolatilityVisual(rows) {
  const row = rows[4];
  const items = [
    { label: "Low volatility path", value: row.usdLow, color: "#0f766e", text: "Bitcoin still grows, but below the base path." },
    { label: "Base log-growth path", value: row.usdBase, color: "#2563eb", text: "Backward-facing 10Y Bitcoin log growth." },
    { label: "High volatility path", value: row.usdHigh, color: "#7c3aed", text: "Same sats value, stronger USD repricing." },
  ];
  const cards = items
    .map((item, index) => {
      const x = 110 + index * 490;
      return `<rect x="${x}" y="235" width="430" height="360" rx="26" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
<rect x="${x}" y="235" width="430" height="16" rx="8" fill="${item.color}"/>
${svgText([item.label], x + 215, 312, { size: 28, weight: 800, fill: "#0f172a", anchor: "middle" })}
${svgText([humanUsdShort(item.value)], x + 215, 404, { size: 56, weight: 900, fill: item.color, anchor: "middle" })}
${svgText([humanUsd(item.value)], x + 215, 450, { size: 22, weight: 700, fill: "#334155", anchor: "middle" })}
${svgText([item.text], x + 215, 520, { size: 22, fill: "#475569", anchor: "middle" })}`;
    })
    .join("\n");

  const footer = `${svgText([`10-year canonical model: the Bitcoin Computer is ${fmtBtc(row.btc)} BTC in every path.`], 800, 685, { size: 30, weight: 850, fill: "#0f172a", anchor: "middle" })}
${svgText(["Only the USD translation changes with Bitcoin volatility."], 800, 728, { size: 24, weight: 650, fill: "#475569", anchor: "middle" })}`;

  return svgShell("Volatility does not change the Bitcoin Computer", "It changes what the same BTC-denominated value looks like in dollars.", `${cards}${footer}`);
}

function writeVisuals(rows) {
  const visuals = [
    ["output/bitcoin-computer-model-compounding.svg", renderCompoundingVisual()],
    ["output/bitcoin-computer-model-dollar-growth.svg", renderDollarGrowthVisual(rows)],
    ["output/bitcoin-computer-model-product-split.svg", renderProductSplitVisual(rows)],
    ["output/bitcoin-computer-model-blockspace.svg", renderBlockspaceVisual(rows)],
    ["output/bitcoin-computer-model-volatility.svg", renderVolatilityVisual(rows)],
  ];

  for (const [path, svg] of visuals) {
    writeFileSync(path, svg);
  }
}

const canonicalRows = inputs.scenario.horizons.map((horizon) => modelRow(horizon, inputs.scenario.canonicalFee));
const aggregateRows = inputs.scenario.horizons.flatMap((horizon) =>
  inputs.scenario.feeTiers.map((feeRate) => modelRow(horizon, feeRate)),
);
const growthRows = inputs.scenario.horizons.map((horizon) => modelRow(horizon, inputs.scenario.canonicalFee));
writeVisuals(canonicalRows);

const markdown = `# ProofOfWork.Me Bitcoin Computer Model

Generated on ${inputs.generatedOn}.

This is the singular forward model for ProofOfWork.Me.

All prior standalone charts, product-only markdown models, and old projection files are deprecated. This model measures:

1. ProofOfWork IDs
2. ProofOfWork Mail
3. ProofOfWork Files / Bitcoin Drive
4. ProofOfWork Marketplace
5. ProofOfWork Browser
6. The aggregate Bitcoin Computer

The model is success-case by design:

\`\`\`text
agent adoption succeeds
Bitcoin node count grows exponentially
BTC/USD follows Bitcoin's backward-facing log-growth benchmark
BTC/USD includes a one-standard-deviation volatility cone
lower relay fees unlock exponentially more agent usage
Bitcoin Computer write demand grows exponentially until today's blockspace ceiling
IDs, Mail, Drive, Marketplace, and Browser reinforce each other
\`\`\`

## Visual Read

These visuals are generated from this same canonical model.

They are written for normal human pattern recognition: big labels, plain words, and no scientific notation.

![What is compounding](bitcoin-computer-model-compounding.png)

![Dollar growth in human words](bitcoin-computer-model-dollar-growth.png)

![IDs Mail Drive Marketplace Browser product split](bitcoin-computer-model-product-split.png)

![Blockspace ceiling](bitcoin-computer-model-blockspace.png)

![Bitcoin volatility translation](bitcoin-computer-model-volatility.png)

SVG versions:

- [What is compounding](bitcoin-computer-model-compounding.svg)
- [Dollar growth in human words](bitcoin-computer-model-dollar-growth.svg)
- [IDs Mail Drive Marketplace Browser product split](bitcoin-computer-model-product-split.svg)
- [Blockspace ceiling](bitcoin-computer-model-blockspace.svg)
- [Bitcoin volatility translation](bitcoin-computer-model-volatility.svg)

## Real Inputs

### Bitcoin Network Input

\`\`\`text
Reachable Bitcoin nodes: ${fmtNumber(inputs.bitnodes.reachableNodes)}
Snapshot time: ${inputs.bitnodes.snapshotTimeUtc}
Source: ${inputs.bitnodes.source}
\`\`\`

Bitnodes describes its method as estimating the Bitcoin peer-to-peer network by finding reachable nodes.

Sources:

\`\`\`text
https://bitnodes.io/
https://bitnodes.io/api/
\`\`\`

### BTC/USD Input

\`\`\`text
Current BTC/USD used: ${fmtUsdPrecise(inputs.btc.currentUsd)}
Current BTC/USD date: ${inputs.btc.currentDate}
10Y historical BTC/USD used: ${fmtUsdPrecise(inputs.btc.historicalUsd)}
10Y historical date: ${inputs.btc.historicalDate}
\`\`\`

Sources:

\`\`\`text
https://coinmarketcap.com/currencies/bitcoin/
https://coinmarketcap.com/historical/20160511/
https://portfolioslab.com/tools/stock-comparison/BTC-USD/SPY
\`\`\`

### ProofOfWork.Me On-Chain Inputs

These are from confirmed ProofOfWork.Me registry/mail/file data already modeled in this repo.

\`\`\`text
Confirmed PowIDs: ${fmtNumber(inputs.pow.confirmedPowids)}
Current n^2: ${fmtNumber(inputs.pow.confirmedPowids ** 2)}
Unique receive-address balance: ${fmtSats(inputs.pow.uniqueReceiveAddressBalanceSats)} sats
ID value density: ${inputs.pow.idDensitySatsPerN2} sats per n^2 unit
\`\`\`

Mail:

\`\`\`text
Confirmed protocol txids: ${inputs.pow.mailTxids}
Confirmed delivery edges: ${inputs.pow.mailDeliveryEdges}
Paid attention flow: ${fmtSats(inputs.pow.mailPaidAttentionFlowSats)} sats
Average sats per delivery: ${inputs.pow.mailSatsPerDelivery.toFixed(2)} sats
Current address-level mail edge density: ${(inputs.pow.mailEdgeDensity * 100).toFixed(4)}%
\`\`\`

Files / Bitcoin Drive:

\`\`\`text
Confirmed file txids: ${inputs.pow.fileTxids}
Unique file hashes: ${inputs.pow.uniqueFileHashes}
Total file bytes: ${fmtNumber(inputs.pow.totalFileBytes)}
File-bearing payment flow: ${fmtSats(inputs.pow.fileFlowSats)} sats
Canonical forward sats per file: ${fmtSats(inputs.pow.satsPerFileBase)} sats
\`\`\`

Marketplace:

\`\`\`text
Confirmed marketplace sales: ${inputs.pow.marketplaceSales}
Confirmed marketplace volume: ${fmtSats(inputs.pow.marketplaceVolumeSats)} sats
Average sats per sale: ${fmtSats(inputs.pow.marketplaceAverageSaleSats)} sats
Canonical forward sales per ID per year: ${inputs.scenario.marketplaceSalesPerIdPerYear}
\`\`\`

Browser:

\`\`\`text
Confirmed browser page txids: ${inputs.pow.browserPageTxids}
Confirmed browser page flow: ${fmtSats(inputs.pow.browserPageFlowSats)} sats
Average sats per browser page: ${fmtSats(inputs.pow.browserAveragePageSats)} sats
Canonical forward browser pages per ID per year: ${inputs.scenario.browserPagesPerIdPerYear}
\`\`\`

## Bitcoin Growth Benchmark

Backward-facing Bitcoin log growth:

\`\`\`text
btc_log_growth_mu = ln(current_btc_usd / historical_btc_usd) / 10
btc_log_growth_mu = ${fmtPct(btcLogGrowth)}
equivalent_cagr = e^mu - 1 = ${fmtPct(btcEquivalentCagr)}
\`\`\`

Bitcoin volatility input:

\`\`\`text
btc_10y_annualized_volatility_sigma = ${fmtPct(inputs.btc.tenYearVolatility)}
\`\`\`

Future BTC/USD paths:

\`\`\`text
base_btc_usd(t) = current_btc_usd * e^(mu * t)
low_btc_usd(t)  = current_btc_usd * e^(mu * t - sigma * sqrt(t))
high_btc_usd(t) = current_btc_usd * e^(mu * t + sigma * sqrt(t))
\`\`\`

The volatility band changes only the USD translation. It does not change the sats or BTC valuation of the Bitcoin Computer.

## Bitcoin Blockspace Ceiling

This version adds the blockspace constraint.

The success case assumes Bitcoin Computer usage compounds exponentially as agents, PowIDs, fee collapse, Mail, Drive, Marketplace, and Browser reinforce each other. That usage cannot grow through infinite blockspace. It compounds until it hits the current theoretical Bitcoin blockspace ceiling.

Protocol-derived ceiling:

\`\`\`text
Max block weight: ${fmtNumber(inputs.blockspace.maxBlockWeightUnits)} weight units
Witness scale factor: ${inputs.blockspace.witnessScaleFactor}
Theoretical max virtual size per block: ${fmtNumber(blockspaceVbytesPerBlock)} vB
Target blocks per day: ${inputs.blockspace.targetBlocksPerDay}
Annual theoretical ceiling: ${fmtNumber(blockspaceVbytesPerYear)} vB
\`\`\`

Sources:

\`\`\`text
https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki
https://github.com/bitcoin/bitcoin/blob/master/src/consensus/consensus.h
\`\`\`

Blockspace accounting assumptions:

\`\`\`text
ID write size: ${fmtNumber(inputs.blockspace.idVbytesPerWrite)} vB
Mail write size: ${fmtNumber(inputs.blockspace.mailVbytesPerWrite)} vB
Average current file payload: ${fmtNumber(averageFilePayloadBytes, 0)} bytes
Drive write size: ${fmtNumber(driveVbytesPerWrite)} vB
Marketplace sale write size: ${fmtNumber(inputs.blockspace.marketplaceVbytesPerSale)} vB
Browser page write size: ${fmtNumber(inputs.blockspace.browserVbytesPerPage)} vB
\`\`\`

Important boundary:

\`\`\`text
The blockspace ceiling is protocol-derived.
The per-product write sizes are model accounting assumptions.
The model does not claim every block will be filled by ProofOfWork.Me.
It asks what the Bitcoin Computer can execute if demand compounds until today's ceiling is binding.
\`\`\`

## Scenario Inputs

\`\`\`text
Agent-controlled Bitcoin node share: ${fmtPct(inputs.scenario.agentShare, 0)}
Bitcoin node CAGR: ${fmtPct(inputs.scenario.nodeCagr, 0)}
Canonical fee tier: ${fmtFee(inputs.scenario.canonicalFee)} sat/vB
\`\`\`

Adoption curve:

\`\`\`text
6 months: 10%
12 months: 20%
24 months: 40%
5 years: 60%
10 years: 80%
25 years: 90%
50 years: 100%
\`\`\`

Fee tiers:

\`\`\`text
0.01 sat/vB
0.001 sat/vB
0.0001 sat/vB
0.00001 sat/vB
\`\`\`

Fee-collapse multipliers:

\`\`\`text
fee_drop_factor = 0.01 / fee_rate
product_multiplier = fee_drop_factor ^ elasticity

ID elasticity = ${inputs.scenario.elasticities.id}
Mail elasticity = ${inputs.scenario.elasticities.mail}
Drive elasticity = ${inputs.scenario.elasticities.drive}
Marketplace elasticity = ${inputs.scenario.elasticities.marketplace}
Browser elasticity = ${inputs.scenario.elasticities.browser}
\`\`\`

## Growth Engine

${growthEngineTable(growthRows)}

## Blockspace Constraint

This is the canonical lowest-fee success path at ${fmtFee(inputs.scenario.canonicalFee)} sat/vB.

\`\`\`text
raw_blockspace_demand_vbytes =
  id_writes * id_write_vbytes
  + mail_writes * mail_write_vbytes
  + drive_writes * drive_write_vbytes
  + marketplace_writes * marketplace_sale_vbytes
  + browser_writes * browser_page_vbytes

executable_blockspace_vbytes =
  min(raw_blockspace_demand_vbytes, annual_theoretical_blockspace_ceiling)

blockspace_usage_fulfillment_ratio =
  executable_blockspace_vbytes / raw_blockspace_demand_vbytes
\`\`\`

${blockspaceConstraintTable(canonicalRows)}

## Product Formulas

### IDs

\`\`\`text
id_value_sats =
  projected_powids^2
  * current_id_sats_per_n2_unit
  * id_fee_multiplier
\`\`\`

ID is modeled as network stock value. It is not reduced by the annual blockspace fulfillment ratio once the ID graph exists.

### Mail

\`\`\`text
mail_value_sats =
  projected_powids
  * (projected_powids - 1)
  * current_mail_edge_density
  * messages_per_pair_per_year
  * sats_per_delivery
  * value_multiple
  * mail_fee_multiplier
  * blockspace_usage_fulfillment_ratio
\`\`\`

### Files / Bitcoin Drive

\`\`\`text
drive_value_sats =
  projected_powids
  * files_per_id_per_year
  * sats_per_file
  * value_multiple
  * drive_fee_multiplier
  * blockspace_usage_fulfillment_ratio
\`\`\`

### Marketplace

\`\`\`text
marketplace_value_sats =
  projected_powids
  * marketplace_sales_per_id_per_year
  * average_sale_sats
  * value_multiple
  * marketplace_fee_multiplier
  * blockspace_usage_fulfillment_ratio
\`\`\`

### Browser

\`\`\`text
browser_value_sats =
  projected_powids
  * browser_pages_per_id_per_year
  * average_browser_page_sats
  * value_multiple
  * browser_fee_multiplier
  * blockspace_usage_fulfillment_ratio
\`\`\`

### Bitcoin Computer

\`\`\`text
bitcoin_computer_value_sats =
  id_value_sats
  + mail_value_sats
  + drive_value_sats
  + marketplace_value_sats
  + browser_value_sats
\`\`\`

The BTC column is a sats-denominated valuation converted into BTC as a unit of account. It is not a claim that those sats are locked in the protocol.

## Canonical Product Growth

This is the canonical lowest-fee success path at ${fmtFee(inputs.scenario.canonicalFee)} sat/vB.

${productTable(canonicalRows)}

## Aggregate Fee Sensitivity

This is still one model. Fee tier is a variable inside the model, not a separate model.

Every fee tier also runs through the same annual blockspace ceiling.

${aggregateFeeTable(aggregateRows)}

## Plain Read

At the canonical deep-fee success path:

\`\`\`text
6 months:
${fmtSats(canonicalRows[0].totalSats)} sats
${fmtBtc(canonicalRows[0].btc)} BTC
${humanUsd(canonicalRows[0].usdBase)} base USD
${humanUsd(canonicalRows[0].usdLow)} to ${humanUsd(canonicalRows[0].usdHigh)} volatility range

10 years:
${fmtSats(canonicalRows[4].totalSats)} sats
${fmtBtc(canonicalRows[4].btc)} BTC
${humanUsd(canonicalRows[4].usdBase)} base USD
${humanUsd(canonicalRows[4].usdLow)} to ${humanUsd(canonicalRows[4].usdHigh)} volatility range

50 years:
${fmtSats(canonicalRows[6].totalSats)} sats
${fmtBtc(canonicalRows[6].btc)} BTC
${humanUsd(canonicalRows[6].usdBase)} base USD
${humanUsd(canonicalRows[6].usdLow)} to ${humanUsd(canonicalRows[6].usdHigh)} volatility range
\`\`\`

## Canonical Status

This markdown is the singular ProofOfWork.Me Bitcoin Computer model going forward.

Deprecated:

\`\`\`text
old standalone ID models
old standalone Mail models
old standalone Drive models
old projection charts
old graphics
old modeling-data exports
\`\`\`

The source of truth for ProofOfWork.Me is the chain.

The Bitcoin node count is network-observed.

The Bitcoin price benchmark is backward-facing historical log growth with volatility.

The node growth, agent share, agent adoption curve, fee tiers, fee elasticities, and per-product blockspace usage assumptions are success-case scenario assumptions.
`;

writeFileSync(OUTPUT, `${markdown.trim()}\n`);
writeFileSync(
  GROWTH_JSON_OUTPUT,
  `${JSON.stringify(
    {
      generatedOn: inputs.generatedOn,
      startDate: inputs.btc.currentDate,
      products: ["IDs", "Mail", "Drive", "Marketplace", "Browser"],
      inputs: {
        bitnodesReachableNodes: inputs.bitnodes.reachableNodes,
        agentShare: inputs.scenario.agentShare,
        blockspaceVbytesPerYear,
        btc: {
          currentUsd: inputs.btc.currentUsd,
          currentDate: inputs.btc.currentDate,
          historicalUsd: inputs.btc.historicalUsd,
          historicalDate: inputs.btc.historicalDate,
          logGrowthMu: btcLogGrowth,
          equivalentCagr: btcEquivalentCagr,
          tenYearVolatility: inputs.btc.tenYearVolatility,
        },
        canonicalFee: inputs.scenario.canonicalFee,
        currentPowids: inputs.pow.confirmedPowids,
        nodeCagr: inputs.scenario.nodeCagr,
        productAssumptions: {
          id: {
            elasticity: inputs.scenario.elasticities.id,
            idDensitySatsPerN2: inputs.pow.idDensitySatsPerN2,
            vbytesPerWrite: inputs.blockspace.idVbytesPerWrite,
          },
          mail: {
            elasticity: inputs.scenario.elasticities.mail,
            edgeDensity: inputs.pow.mailEdgeDensity,
            messagesPerPairPerYear: inputs.scenario.mailMessagesPerPairPerYear,
            satsPerDelivery: inputs.pow.mailSatsPerDelivery,
            valueMultiple: inputs.scenario.mailValueMultiple,
            vbytesPerWrite: inputs.blockspace.mailVbytesPerWrite,
          },
          drive: {
            elasticity: inputs.scenario.elasticities.drive,
            filesPerIdPerYear: inputs.scenario.driveFilesPerIdPerYear,
            satsPerFile: inputs.pow.satsPerFileBase,
            valueMultiple: inputs.scenario.driveValueMultiple,
            vbytesPerWrite: driveVbytesPerWrite,
          },
          marketplace: {
            averageSaleSats: inputs.pow.marketplaceAverageSaleSats,
            elasticity: inputs.scenario.elasticities.marketplace,
            salesPerIdPerYear: inputs.scenario.marketplaceSalesPerIdPerYear,
            valueMultiple: inputs.scenario.marketplaceValueMultiple,
            vbytesPerSale: inputs.blockspace.marketplaceVbytesPerSale,
          },
          browser: {
            averagePageSats: inputs.pow.browserAveragePageSats,
            elasticity: inputs.scenario.elasticities.browser,
            pagesPerIdPerYear: inputs.scenario.browserPagesPerIdPerYear,
            valueMultiple: inputs.scenario.browserValueMultiple,
            vbytesPerPage: inputs.blockspace.browserVbytesPerPage,
          },
        },
      },
      realBaseline: {
        idSats: Math.round(inputs.pow.uniqueReceiveAddressBalanceSats),
        mailSats: Math.round(inputs.pow.mailPaidAttentionFlowSats * inputs.scenario.mailValueMultiple),
        driveSats: Math.round(inputs.pow.fileFlowSats * inputs.scenario.driveValueMultiple),
        marketplaceSats: Math.round(inputs.pow.marketplaceVolumeSats * inputs.scenario.marketplaceValueMultiple),
        browserSats: Math.round(inputs.pow.browserPageFlowSats * inputs.scenario.browserValueMultiple),
        totalSats: Math.round(
          inputs.pow.uniqueReceiveAddressBalanceSats +
            inputs.pow.mailPaidAttentionFlowSats * inputs.scenario.mailValueMultiple +
            inputs.pow.fileFlowSats * inputs.scenario.driveValueMultiple +
            inputs.pow.marketplaceVolumeSats * inputs.scenario.marketplaceValueMultiple +
            inputs.pow.browserPageFlowSats * inputs.scenario.browserValueMultiple,
        ),
        usdBase:
          ((inputs.pow.uniqueReceiveAddressBalanceSats +
            inputs.pow.mailPaidAttentionFlowSats * inputs.scenario.mailValueMultiple +
            inputs.pow.fileFlowSats * inputs.scenario.driveValueMultiple +
            inputs.pow.marketplaceVolumeSats * inputs.scenario.marketplaceValueMultiple +
            inputs.pow.browserPageFlowSats * inputs.scenario.browserValueMultiple) /
            100_000_000) *
          inputs.btc.currentUsd,
      },
      canonicalRows: canonicalRows.map((row) => ({
        adoption: row.adoption,
        blockspaceUsageRatio: row.blockspaceUsageRatio,
        browserSats: Math.round(row.browserSats),
        browserWrites: row.browserWrites,
        btcUsdBase: row.btcUsdBase,
        driveSats: Math.round(row.driveSats),
        driveWrites: row.driveWrites,
        idSats: Math.round(row.idSats),
        idWrites: row.idWrites,
        label: row.label,
        mailSats: Math.round(row.mailSats),
        mailWrites: row.mailWrites,
        marketplaceSats: Math.round(row.marketplaceSats),
        marketplaceWrites: row.marketplaceWrites,
        powids: row.powids,
        totalSats: Math.round(row.totalSats),
        usdBase: row.usdBase,
        totalWrites: row.idWrites + (row.mailWrites + row.driveWrites + row.marketplaceWrites + row.browserWrites) * row.blockspaceUsageRatio,
        years: row.years,
      })),
    },
    null,
    2,
  )}\n`,
);
