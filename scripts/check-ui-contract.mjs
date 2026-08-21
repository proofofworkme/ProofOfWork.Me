import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";

const files = [
  "README.md",
  "SOUL.md",
  "MAIL_ORGANIZATION.md",
  "OP_RETURN_INFRASTRUCTURE.md",
  "PROOFOFWORK_GENERAL_DECK.md",
  "src/App.tsx",
  "src/exactAmount.ts",
  "src/workAmount.ts",
  "src/walletUtxos.ts",
  "src/app/appLinks.ts",
  "src/app/routeRegistry.ts",
  "src/features/landing/LandingApp.tsx",
  "src/features/landing/LandingRoot.tsx",
  "src/main.tsx",
  "src/shared/activity/logHistoryCache.ts",
  "src/shared/api/proofApiClient.ts",
  "src/shared/api/proofApiReadState.ts",
  "src/shared/components/AppHeader.tsx",
  "src/shared/components/AppStatusRow.tsx",
  "src/shared/components/BrowserNetworkTabs.tsx",
  "src/shared/components/DomainNav.tsx",
  "src/shared/components/HeaderActionsMenu.tsx",
  "src/shared/protocol/idRegistry.ts",
  "src/styles.css",
  "deploy/Caddyfile",
  "vite.config.ts",
];

const read = (path) => readFileSync(path, "utf8");
const contents = new Map(files.map((path) => [path, read(path)]));
const walletUtxoRuntimeSource = ts.transpileModule(
  contents.get("src/walletUtxos.ts"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const workAmountRuntimeSource = ts.transpileModule(
  contents.get("src/workAmount.ts"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const {
  enrichWalletCuratedUtxoConfirmations,
  normalizeWalletUtxos,
  selectSmallestSingleConfirmedUtxo,
} = await import(
  `data:text/javascript;base64,${Buffer.from(walletUtxoRuntimeSource).toString("base64")}`
);
const {
  WORK_DECIMALS,
  WORK_LEGACY_DECIMALS,
  WORK_LEGACY_TO_CANONICAL_FACTOR,
  WORK_LEGACY_UNIT_SCALE,
  WORK_UNIT_SCALE,
  workAtomsFromRecord,
  workLegacyAtomsFromSubatoms,
  workSubatomsFromCanonicalString,
} = await import(
  `data:text/javascript;base64,${Buffer.from(workAmountRuntimeSource).toString("base64")}`
);
const failures = [];

function expect(name, condition) {
  if (!condition) {
    failures.push(name);
  }
}

expect(
  "frontend WORK quantity helpers use exact Q16 subatoms without changing the historical Q8 scale",
  WORK_DECIMALS === 16 &&
    WORK_UNIT_SCALE === 10_000_000_000_000_000n &&
    WORK_LEGACY_DECIMALS === 8 &&
    WORK_LEGACY_UNIT_SCALE === 100_000_000n &&
    WORK_LEGACY_TO_CANONICAL_FACTOR === 100_000_000n,
);
expect(
  "frontend WORK subatom parser accepts only canonical integer text",
  workSubatomsFromCanonicalString("1") === 1n &&
    workSubatomsFromCanonicalString("0001") === null &&
    workSubatomsFromCanonicalString(" 1") === null &&
    workSubatomsFromCanonicalString("1 ") === null &&
    workSubatomsFromCanonicalString(1) === null,
);
expect(
  "frontend WORK record aliases fail closed unless legacy Q8 and current Q16 values agree exactly",
  workAtomsFromRecord("10", 0, "1000000000") === 1_000_000_000n &&
    workAtomsFromRecord("10", 0, "1000000001") === null &&
    workLegacyAtomsFromSubatoms("1000000000") === 10n &&
    workLegacyAtomsFromSubatoms("1") === null,
);

function notContains(path, pattern, label) {
  expect(`${path}: ${label}`, !pattern.test(contents.get(path)));
}

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

function cssMediaBlock(query) {
  const marker = `@media (${query})`;
  const start = css.indexOf(marker);
  if (start < 0) return "";
  const next = css.indexOf("\n@media ", start + marker.length);
  return css.slice(start, next < 0 ? css.length : next);
}

for (const [path, text] of contents) {
  expect(`${path}: no Pay2Speak surface`, !/pay2speak|Pay2Speak|payspeak/i.test(text));
}

const css = contents.get("src/styles.css");
function cssHexVariable(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";
}

function relativeLuminance(hex) {
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) return 0;
  const channels = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function cssContrastRatio(foregroundName, backgroundName) {
  const foreground = relativeLuminance(cssHexVariable(foregroundName));
  const background = relativeLuminance(cssHexVariable(backgroundName));
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

const max1400Css = cssMediaBlock("max-width: 1400px");
const max1180Css = cssMediaBlock("max-width: 1180px");
const max1100Css = cssMediaBlock("max-width: 1100px");
const topbarActionsBlock = cssBlock(".topbar-actions");
const mailSendBlock = cssBlock(".mail-send-button");
const mailSendReadyBlock = cssBlock('.mail-send-button[data-state="ready"]');
const mailSendReadyHoverBlock = cssBlock(
  '.mail-send-button[data-state="ready"]:hover:not(:disabled)',
);
const mailSendReadyFocusBlock = cssBlock(
  '.mail-send-button[data-state="ready"]:focus-visible',
);
const mailSendDisabledBlock = cssBlock(
  '.mail-send-button[data-state="disabled"]:disabled',
);
const mailSendBusyBlock = cssBlock(
  '.mail-send-button[data-state="busy"]:disabled',
);
expect(
  "Mail Send state colors change without a low-contrast interpolation",
  /transition:\s*[\s\S]*box-shadow 160ms ease[\s\S]*transform 160ms ease/.test(
    mailSendBlock,
  ) &&
    !/(?:background(?:-color)?|border-color|color|opacity)\s+\d+ms/.test(
      mailSendBlock,
    ),
);
expect(
  "Mail Send ready and hover states use readable primary contrast",
  /background:\s*var\(--accent\)/.test(mailSendReadyBlock) &&
    /color:\s*var\(--surface\)/.test(mailSendReadyBlock) &&
    /opacity:\s*1/.test(mailSendReadyBlock) &&
    /background:\s*var\(--accent-strong\)/.test(mailSendReadyHoverBlock) &&
    /color:\s*var\(--surface\)/.test(mailSendReadyHoverBlock) &&
    cssContrastRatio("--surface", "--accent") >= 4.5 &&
    cssContrastRatio("--surface", "--accent-strong") >= 4.5,
);
expect(
  "Mail Send disabled state is opaque, neutral, and readable",
  /background:\s*var\(--surface-soft\)/.test(mailSendDisabledBlock) &&
    /border-color:\s*var\(--border-strong\)/.test(mailSendDisabledBlock) &&
    /color:\s*var\(--text-muted\)/.test(mailSendDisabledBlock) &&
    /cursor:\s*not-allowed/.test(mailSendDisabledBlock) &&
    /opacity:\s*1/.test(mailSendDisabledBlock) &&
    cssContrastRatio("--text-muted", "--surface-soft") >= 4.5,
);
expect(
  "Mail Send busy state is distinct, readable, and communicates progress",
  /background:\s*var\(--surface-soft\)/.test(mailSendBusyBlock) &&
    /border-color:\s*var\(--accent\)/.test(mailSendBusyBlock) &&
    /color:\s*var\(--accent-strong\)/.test(mailSendBusyBlock) &&
    /cursor:\s*progress/.test(mailSendBusyBlock) &&
    /opacity:\s*1/.test(mailSendBusyBlock) &&
    /\.mail-send-spinner\s*\{[\s\S]*animation:\s*mail-send-spin/.test(css) &&
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.mail-send-spinner\s*\{[\s\S]*animation:\s*none/.test(
      css,
    ) &&
    cssContrastRatio("--accent-strong", "--surface-soft") >= 4.5,
);
expect(
  "Mail Send has a strong keyboard focus indicator",
  /outline:\s*2px solid var\(--parchment\)/.test(mailSendReadyFocusBlock) &&
    /outline-offset:\s*3px/.test(mailSendReadyFocusBlock) &&
    /box-shadow:\s*var\(--focus\)/.test(mailSendReadyFocusBlock),
);
expect(
  "disabled primary buttons cannot receive enabled hover styling",
  /\.primary:hover:not\(:disabled\)/.test(css) &&
    /\.compose-button:hover:not\(:disabled\)/.test(css) &&
    !/\.primary:hover\s*,/.test(css) &&
    !/\.compose-button:hover\s*\{/.test(css),
);
expect("shared topbar has a fixed height token", /--topbar-height:\s*64px/.test(css));
expect(
  "shared topbar cannot expand vertically on desktop",
  /\.topbar\s*\{[\s\S]*height:\s*var\(--topbar-height\)[\s\S]*max-height:\s*var\(--topbar-height\)[\s\S]*min-height:\s*var\(--topbar-height\)/.test(
    css,
  ),
);
expect(
  "standalone shells reserve the shared header stack row",
  /\.desktop-public-app\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/.test(
    css,
  ) &&
    /\.desktop-public-app\.has-route-status\s*\{[\s\S]*grid-template-rows:\s*auto\s+var\(--status-row-height\)\s+minmax\(0,\s*1fr\)\s+auto/.test(
      css,
    ),
);
expect(
  "shared header has no split desktop/mobile action rails",
  !/topbar-controls|topbar-actions-desktop|topbar-actions-mobile/.test(css),
);
expect(
  "shared topbar actions stay in the single flex header row",
  /display:\s*inline-flex/.test(topbarActionsBlock) &&
    /flex:\s*0 0 auto/.test(topbarActionsBlock) &&
    !/grid-area:/.test(topbarActionsBlock) &&
    !/justify-self:/.test(topbarActionsBlock),
);
expect(
  "id launch shells use the same account-aware chrome rows",
  /\.id-launch-app\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*auto\s+var\(--status-row-height\)\s+minmax\(0,\s*1fr\)\s+auto/.test(
    css,
  ),
);
expect(
  "wallet shell cannot override the shared id launch grid",
  !/(^|\n)\s*(display|flex-direction):/m.test(cssBlock(".token-wallet-public-app")),
);
[
  /ProofOfWork chrome restore/i,
  /ProofOfWork strict UI contract/i,
  /Product cleanup/i,
  /\.pow-shell\b/,
  /\.pow-layout\b/,
  /\.pow-main-stage\b/,
].forEach((pattern) => notContains("src/styles.css", pattern, `no stale ${pattern}`));
[
  /landing-topbar/,
  /landing-brand/,
  /landing-nav/,
  /desktop-public-header/,
  /id-launch-topbar/,
].forEach((pattern) =>
  notContains("src/styles.css", pattern, `no route-specific header class ${pattern}`),
);
[
  /\.desktop-public-app\s+\.brand\b/,
  /\.desktop-public-app\s+\.app-menu-trigger\b/,
  /\.activity-public-app\s+\.topbar\b/,
  /\.growth-public-app\s+\.topbar\b/,
  /\.browser-public-app\s+\.topbar\b/,
  /\.id-launch-app\s+\.topbar\b/,
].forEach((pattern) =>
  notContains("src/styles.css", pattern, `no route-specific shared header override ${pattern}`),
);

const appHeader = contents.get("src/shared/components/AppHeader.tsx");
expect(
  "AppHeader renders one shared header actions menu",
  (appHeader.match(/<HeaderActionsMenu\b/g) || []).length === 1,
);
expect(
  "AppHeader has no split desktop/mobile action rail",
  !/topbar-controls|topbar-actions-desktop|topbar-actions-mobile|NetworkSelectMenu/.test(
    appHeader,
  ),
);
expect(
  "AppHeader has no route-specific class escape hatch",
  !/brandClassName|className\??:|headerClassName|\["topbar",\s*className\]/.test(appHeader),
);
expect(
  "AppHeader always renders the shared topbar base",
  /<header className="topbar">/.test(appHeader) && /className="brand"/.test(appHeader),
);
expect(
  "AppHeader can render the shared connected account strip",
  /type AppHeaderAccountStat/.test(appHeader) &&
    /account-signal-bar/.test(appHeader) &&
    /visibleAccountStats/.test(appHeader),
);
expect(
  "AppHeader exposes refresh as a direct topbar action",
  /const refreshAction\s*=\s*onRefresh\s*\?\?/.test(appHeader) &&
    /className="topbar-action-button topbar-refresh-button"/.test(appHeader) &&
    /onClick=\{\(\) => void refreshAction\(\)\}/.test(appHeader),
);
expect(
  "AppHeader exposes wallet as a direct topbar action",
  /className="topbar-action-button topbar-wallet-button"/.test(appHeader) &&
    /Connect UniSat/.test(appHeader),
);
const appHeaderMenuTag =
  appHeader.match(/<HeaderActionsMenu[\s\S]*?\/>/)?.[0] ?? "";
expect(
  "AppHeader uses HeaderActionsMenu only for network options",
  /networkOptions=/.test(appHeaderMenuTag) &&
    !/onRefresh=|connectWallet=|disconnectWallet=|address=/.test(
      appHeaderMenuTag,
    ),
);
expect(
  "AppHeader does not expose per-route compact nav",
  !/domainNavCompact|<DomainNav\s+compact=/.test(appHeader),
);

const headerActionsMenu = contents.get("src/shared/components/HeaderActionsMenu.tsx");
expect(
  "HeaderActionsMenu only toggles network choices",
  /networkOptions/.test(headerActionsMenu) &&
    !/Connect UniSat|Install UniSat|Refresh|Wallet|LogOut|UNISAT_DOWNLOAD_URL/.test(
      headerActionsMenu,
    ),
);

const landingApp = contents.get("src/features/landing/LandingApp.tsx");
const landingRoot = contents.get("src/features/landing/LandingRoot.tsx");
const main = contents.get("src/main.tsx");
const viteConfig = contents.get("vite.config.ts");
expect(
  "landing uses the shared header contract",
  !/landing-topbar|landing-brand|domainNavCompact=\{false\}/.test(landingApp),
);
expect(
  "landing route is selected before the transaction-capable App import",
  /detectAppSurface\(\) === "landing"[\s\S]*import\("\.\/features\/landing\/LandingRoot"\)[\s\S]*import\("\.\/App"\)/.test(
    main,
  ),
);
expect(
  "landing root reads only the first-party registry summary and preserves unknown state",
  /fetchProofApiJson<RegistrySummaryResponse>[\s\S]*\/api\/v1\/registry-summary/.test(
    landingRoot,
  ) &&
    /fresh=1/.test(landingRoot) &&
    /refreshRegistry\(false\)[\s\S]*refreshRegistry\(true\)/.test(landingRoot) &&
    /registryLoaded/.test(landingRoot) &&
    /registryFresh/.test(landingRoot) &&
    /AbortController/.test(landingRoot) &&
    /payload\.records\.map\(\(record, index\)/.test(landingRoot) &&
    /Registry summary record \$\{index \+ 1\} is malformed/.test(landingRoot) &&
    !/payload\.records\.flatMap/.test(landingRoot) &&
    !/from "\.\.\/\.\.\/App"|bitcoinjs|signPsbt|buildPaymentPsbt/.test(
      landingRoot,
    ) &&
    /registryLoaded \? confirmedRecords\.length\.toLocaleString\(\) : "…"/.test(
      landingApp,
    ),
);
expect(
  "landing retains verified registry data when its background exact-tip refresh is degraded",
  /lastGoodRegistryRef/.test(landingRoot) &&
    /fresh\s*&&[\s\S]*lastGoodRegistryRef\.current\.loaded[\s\S]*isTransientProofApiReadError\(error\)[\s\S]*proofApiLastGoodReadStatus/.test(
      landingRoot,
    ) &&
    /registryWarning=\{registryWarning\}/.test(landingRoot) &&
    /registryWarning[\s\S]*tone: "idle"/.test(landingApp) &&
    /Verified last-good ProofOfWork ID registry summary loaded\. This view is not current/.test(
      landingApp,
    ),
);
expect(
  "landing and Computer share one canonical ID registry address helper",
  /registryAddressForNetwork/.test(landingRoot) &&
    /registryAddressForNetwork/.test(contents.get("src/shared/protocol/idRegistry.ts")) &&
    /from "\.\/shared\/protocol\/idRegistry"/.test(
      contents.get("src/App.tsx"),
    ),
);
expect(
  "landing dependencies are split from Bitcoin signing dependencies",
  /\/node_modules\/lucide-react\//.test(viteConfig) &&
    /\/node_modules\/react\//.test(viteConfig) &&
    /return undefined;/.test(viteConfig) &&
    !/return "vendor"/.test(viteConfig),
);

const appLinks = contents.get("src/app/appLinks.ts");
expect("app links include Wallet", /label:\s*"Wallet"/.test(appLinks));
expect("app links include Growth", /label:\s*"Growth"/.test(appLinks));
expect(
  "app links publish AMO as the canonical governed exchange",
  /MARKETPLACE_APP_URL\s*=\s*"https:\/\/amo\.proofofwork\.me"/.test(
    appLinks,
  ) && /label:\s*"AMO"/.test(appLinks),
);
expect("app links include no Pay2Speak label", !/Pay2Speak/.test(appLinks));

const domainNav = contents.get("src/shared/components/DomainNav.tsx");
expect(
  "DomainNav has one shared desktop contract",
  !/compact\??:|compact\s*=|domain-nav\.compact/.test(domainNav),
);
expect(
  "DomainNav only intercepts explicit Computer-handled navigation",
  /handled\s*===\s*true/.test(domainNav) && !/handled\s*!==\s*false/.test(domainNav),
);

const browserNetworkTabs = contents.get("src/shared/components/BrowserNetworkTabs.tsx");
expect(
  "browser network control is a select dropdown",
  /<select[\s\S]+className="network-select browser-network-select"/.test(
    browserNetworkTabs,
  ),
);
expect(
  "browser network control no longer renders tab buttons",
  !/browser-network-tabs/.test(browserNetworkTabs),
);

const app = contents.get("src/App.tsx");
const applyWorkFloorQuoteBlock = app.slice(
  app.indexOf("function applyWorkFloorQuote"),
  app.indexOf("async function freshWorkWriteMode"),
);
const composePaneBlock = app.slice(
  app.indexOf("function ComposePane("),
  app.indexOf("function AttachmentCard("),
);
const sendOpReturnBlock = app.slice(
  app.indexOf("async function sendOpReturn"),
  app.indexOf("async function createInfinityBond"),
);
const proofApi = read("server/proof-api.mjs");
const exactAmount = contents.get("src/exactAmount.ts");
const walletUtxoPolicy = contents.get("src/walletUtxos.ts");
const transferTokenSource = app.slice(
  app.indexOf("async function transferToken"),
  app.indexOf("async function listToken"),
);
const workAmoV6ProofUnitSource = app.slice(
  app.indexOf("function workAmoV6ActivationReady"),
  app.indexOf("function workAmoListingFaceUsdCents"),
);
const listTokenSource = app.slice(
  app.indexOf("async function listToken"),
  app.indexOf("async function sealTokenListing"),
);
const sealTokenListingSource = app.slice(
  app.indexOf("async function sealTokenListing"),
  app.indexOf("async function delistTokenListing"),
);
const delistTokenListingSource = app.slice(
  app.indexOf("async function delistTokenListing"),
  app.indexOf("async function buyTokenListing"),
);
const buyTokenListingSource = app.slice(
  app.indexOf("async function buyTokenListing"),
  app.indexOf("function clearTokenMintAssistantTimer"),
);
const canListTokenSource = app.slice(
  app.indexOf("const tokenListInput"),
  app.indexOf("const selectedTokenSupplyState"),
);
const tokenWalletWorkspaceSource = app.slice(
  app.indexOf("function TokenWalletWorkspace"),
  app.indexOf("type TokenAppProps"),
);
const proofApiClient = contents.get("src/shared/api/proofApiClient.ts");
const proofApiReadState = contents.get("src/shared/api/proofApiReadState.ts");
const logHistoryCache = contents.get("src/shared/activity/logHistoryCache.ts");
const routeRegistry = contents.get("src/app/routeRegistry.ts");
const caddyfile = contents.get("deploy/Caddyfile");
expect(
  "AMO is canonical while legacy Marketplace routes remain compatible",
  /VITE_AMO_ONLY/.test(routeRegistry) &&
    /hostname\(\) === "amo\.proofofwork\.me"/.test(routeRegistry) &&
    /hostname\(\) === "marketplace\.proofofwork\.me"/.test(routeRegistry) &&
    /searchFlag\("amo"\)/.test(routeRegistry) &&
    /amo\.proofofwork\.me\s*\{[\s\S]*import common_marketplace_app/.test(
      caddyfile,
    ) &&
    /marketplace\.proofofwork\.me\s*\{[\s\S]*redir https:\/\/amo\.proofofwork\.me\{uri\} 308/.test(
      caddyfile,
    ) &&
    /window\.location\.hostname === "amo\.proofofwork\.me"/.test(
      domainNav,
    ) &&
    /link\.label === "AMO"/.test(domainNav),
);
expect(
  "Proof API errors preserve canonical error codes without raw JSON UI",
  /class ProofApiRequestError/.test(proofApiReadState) &&
    /JSON\.parse\(responseText\)/.test(proofApiClient) &&
    /isTransientProofApiReadError/.test(proofApiReadState) &&
    /CANONICAL_INDEX_UNAVAILABLE/.test(proofApiReadState) &&
    /throw proofApiResponseError\(responseText, response\.status\)/.test(
      proofApiClient,
    ),
);
expect(
  "canonical catch-up responses retain provenance and are transient read failures",
  /readonly details: Record<string, unknown>/.test(proofApiReadState) &&
    /details: details \?\? \{\}/.test(proofApiClient) &&
    /CANONICAL_INDEX_CATCHING_UP/.test(proofApiReadState) &&
    /error\.status === 503/.test(proofApiReadState) &&
    /function proofApiLastGoodReadStatus/.test(proofApiReadState) &&
    /explicitlyUnavailable/.test(proofApiReadState) &&
    /summarySnapshot/.test(proofApiReadState) &&
    /lagBlocks/.test(proofApiReadState) &&
    /Showing verified last-good/.test(proofApiReadState) &&
    /Canonical scan is at the full-node tip; actions recheck live admission before signing/.test(
      proofApiReadState,
    ) &&
    /This view is not current/.test(proofApiReadState) &&
    /Exact-tip actions remain unavailable/.test(proofApiReadState),
);
expect(
  "bond quantities remain exact above JavaScript safe-integer range",
  /export function exactIntegerBigInt/.test(exactAmount) &&
    /BigInt\(text\)/.test(exactAmount) &&
    /export function formatExactInteger/.test(exactAmount) &&
    /export function formatExactQ8/.test(exactAmount) &&
    /confirmedSupply\?: ExactIntegerValue/.test(app) &&
    /amount: ExactIntegerValue/.test(app) &&
    /compareExactIntegers\(right\.confirmedSupply, left\.confirmedSupply\)/.test(
      app,
    ) &&
    /bondProofAmountDisplay\([\s\S]*floorQ8/.test(app),
);
expect(
  "bond supply regression guards compare exact bigint ranks",
  /function tokenDefinitionConfirmedSupply[\s\S]*exactIntegerBigInt\(token\.confirmedSupply\) \?\? 0n/.test(
    app,
  ) &&
    /function tokenStateConfirmedSupplyRank[\s\S]*reduce<bigint>[\s\S]*exactIntegerBigInt\(mint\.amount\)[\s\S]*0n/.test(
      app,
    ) &&
    /currentSupply > 0n && nextSupply < currentSupply/.test(app) &&
    !/function tokenDefinitionConfirmedSupply[\s\S]{0,160}finiteNonNegativeNumber/.test(
      app,
    ),
);
expect(
  "rejected bond movements retain their exact protocol amount",
  /walletInvalidEvents\.map\(\(event\) => \(\{[\s\S]*?amount: event\.amount,/.test(
    app,
  ) &&
    !/walletInvalidEvents\.map\(\(event\) => \(\{[\s\S]{0,180}Number\(event\.amount\)/.test(
      app,
    ),
);
expect(
  "bond wallet pending labels treat exact zero as zero",
  /tokenWalletBalanceHasAmount\(\s*balance,\s*"pendingIncoming",?\s*\)[\s\S]*pending in/.test(
    app,
  ) &&
    /tokenWalletBalanceHasAmount\(\s*balance,\s*"pendingOutgoing",?\s*\)[\s\S]*pending out/.test(
      app,
    ),
);
expect(
  "bond supply charts preserve exact domains until coordinate conversion",
  /function infinityBondChartNumericValue[\s\S]*Exclude<InfinityBondChartMetric, "supply">/.test(
    app,
  ) &&
    /const exactSupplyByPoint = new Map[\s\S]*exactIntegerBigInt\(point\.confirmedSupply\)/.test(
      app,
    ) &&
    /const observedRange = rawYMax - rawYMin[\s\S]*exactBondChartPadding\(domainRange\)[\s\S]*exactBondChartRatio\(value, yMin, yMax\)/.test(
      app,
    ) &&
    !/exactIntegerNumber\(point\.confirmedSupply\)/.test(app),
);
expect(
  "read warnings are independent from action status and clear by source and attempt",
  /proofApiReadWarningsRef/.test(app) &&
    /setProofApiReadWarningRevision/.test(app) &&
    /function showLastGoodReadWarning[\s\S]*setProofApiReadWarning/.test(app) &&
    !/function showLastGoodReadWarning[\s\S]*setStatusForWorkspace/.test(
      app.slice(
        app.indexOf("function showLastGoodReadWarning"),
        app.indexOf("function nextProofApiReadAttempt"),
      ),
    ) &&
    /clearProofApiReadWarning[\s\S]*source[\s\S]*successfulAttempt/.test(
      proofApiReadState,
    ) &&
    /secondaryStatus=\{degradedReadStatus\}/.test(app) &&
    /tokenDataPriming \|\| \(tokenDataLoading && !activeTokenStateLoaded\)/.test(
      app,
    ),
);
expect(
  "read surfaces retain only matching coherent last-good state without weakening exact-tip writes",
    /acceptedTokenStatesRef\.current\.get\(scopeKey\)[\s\S]*renderTokenState\(lastGoodState, scopeKey\)[\s\S]*showLastGoodReadWarning/.test(
      app,
    ) &&
    /acceptedMarketplaceSnapshotRef/.test(app) &&
    /async function fetchMarketplaceSummary[\s\S]*one coherent registry, credit, and WORK-floor snapshot/.test(
      app,
    ) &&
    /async function refreshMarketplaceSummary[\s\S]*acceptedMarketplaceSnapshotRef\.current = snapshot[\s\S]*lastGoodSnapshot = acceptedMarketplaceSnapshotRef\.current[\s\S]*showLastGoodReadWarning/.test(
      app,
    ) &&
    /async function refreshInfinity[\s\S]*lastGoodSnapshot[\s\S]*showLastGoodReadWarning/.test(
      app,
    ) &&
    /async function refreshGrowth[\s\S]*lastGoodSnapshot[\s\S]*showLastGoodReadWarning/.test(
      app,
    ) &&
    /async function fetchFreshWalletTokenPreflightState[\s\S]*fresh: "1"[\s\S]*No transaction was created/.test(
      app,
    ),
);
expect(
  "Log last-good pages are isolated by query kind page cursor and snapshot",
  /identity\.kind/.test(logHistoryCache) &&
    /normalizedActivityHistoryCacheQuery\(identity\.query\)/.test(
      logHistoryCache,
    ) &&
    /identity\.pageIndex/.test(logHistoryCache) &&
    /identity\.cursor/.test(logHistoryCache) &&
    /identity\.snapshotId/.test(logHistoryCache) &&
    /activityHistoryPagesRef\.current\.get\(cacheKey\)/.test(app) &&
    /setActivityHistoryPage\(undefined\)/.test(app),
);
expect(
  "connected account strip refreshes wallet-scoped token balances",
  /accountTokenState/.test(app) &&
    /accountWorkTokenState/.test(app) &&
    /accountPowbTokenState/.test(app) &&
    /accountIncbTokenState/.test(app) &&
    /fetchTokenState\(\s*network,\s*false,\s*"",\s*true,\s*\[address\],\s*true\s*\)/.test(
      app,
    ) &&
    /fetchTokenState\(\s*network,\s*true,\s*WORK_TOKEN_ID,\s*false,\s*\[address\],\s*true,\s*true,?\s*\)/.test(
      app,
    ) &&
    /fetchTokenState\(\s*network,\s*false,\s*POWB_TOKEN_ID,\s*true,\s*\[address\],\s*true,?\s*\)/.test(
      app,
    ) &&
    /fetchTokenState\(\s*network,\s*false,\s*INCB_TOKEN_ID,\s*true,\s*\[address\],\s*true,?\s*\)/.test(
      app,
    ),
);
expect(
  "wallet balance lanes commit independently and preserve per-lane last-good data",
  /const loadAccountTokenLane = \([\s\S]*\[lane\]: \{ \.\.\.current\[lane\], loading: true \}[\s\S]*void load\(\)[\s\S]*commit\(state\)[\s\S]*\[lane\]: \{ error: "", loaded: true, loading: false \}[\s\S]*\.catch\(\(error\)[\s\S]*\.\.\.current\[lane\][\s\S]*loading: false/.test(
    app,
  ) &&
    /loadAccountTokenLane\(\s*"all"[\s\S]*setAccountTokenState/.test(app) &&
    /loadAccountTokenLane\(\s*"work"[\s\S]*setAccountWorkTokenState/.test(
      app,
    ) &&
    /loadAccountTokenLane\(\s*"powb"[\s\S]*setAccountPowbTokenState/.test(
      app,
    ) &&
    /loadAccountTokenLane\(\s*"incb"[\s\S]*setAccountIncbTokenState/.test(
      app,
    ) &&
    !/void Promise\.all\(\[\s*fetchTokenState\(network, false, "", true, \[address\], true\)/.test(
      app,
    ) &&
    /Last verified balances remain visible\./.test(app),
);
expect(
  "WORK wallet sign-in paints current authority before background fresh refresh",
  /const loadAccountTokenLane = \([\s\S]*options: \{ refresh\?: \(\) => Promise<PowTokenState> \} = \{\}[\s\S]*options\.refresh[\s\S]*\.refresh\(\)[\s\S]*loaded: true,[\s\S]*loading: false/.test(
    app,
  ) &&
    /loadAccountTokenLane\(\s*"work"[\s\S]*fetchTokenState\(\s*network,\s*false,\s*WORK_TOKEN_ID[\s\S]*setAccountWorkTokenState,[\s\S]*refresh:\s*\(\) =>[\s\S]*fetchTokenState\(\s*network,\s*true,\s*WORK_TOKEN_ID/.test(
      app,
    ),
);
expect(
  "legacy WORK attachment allowlist is scoped outside normal Mail",
  /WORK_ATTACHMENT_LEGACY_ALLOWED_SENDERS\s*=\s*new Set/.test(app) &&
    /1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT/.test(app) &&
    /1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x/.test(app) &&
    /1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv/.test(app) &&
    /\.map\(\(senderAddress\) => senderAddress\.toLowerCase\(\)\)/.test(app) &&
    /function canUseLegacyWorkAttachmentSender[\s\S]*WORK_ATTACHMENT_LEGACY_ALLOWED_SENDERS/.test(
      app,
    ),
);
expect(
  "Mail and Inception WORK attachments use verified Q16 holders while Infinity remains allowlisted",
  /function canAttachWorkToMessages[\s\S]*confirmedSpendableWorkHolder/.test(
    app,
  ) &&
    /const messageWorkAttachmentAllowed = canAttachWorkToMessages\([\s\S]*workAttachmentSpendableAtoms > 0n/.test(
      app,
    ) &&
    /function canAttachWorkToBond[\s\S]*bondConfig\.folder === "inception"[\s\S]*targetNetwork === "livenet"[\s\S]*Boolean\(senderAddress\.trim\(\)\)[\s\S]*confirmedWorkHolder[\s\S]*return canUseLegacyWorkAttachmentSender\(senderAddress, targetNetwork\)/.test(
    app,
  ) &&
    /const inceptionWorkHolderEligible =[\s\S]*bondWorkBalanceHasCleanLane[\s\S]*bondWorkBalanceLoaded[\s\S]*!bondWorkBalanceError[\s\S]*workAtomsFromIntegerString\([\s\S]*workAttachmentPreviewSpendability\?\.confirmedBalanceSubatoms[\s\S]*\?\? 0n\) > 0n/.test(
      app,
    ) &&
    /const bondWorkAttachmentAllowed = canAttachWorkToBond\(/.test(app) &&
    /const bondWorkAttachmentBalanceOk =[\s\S]*bondWorkBalanceHasCleanLane[\s\S]*bondWorkBalanceLoaded[\s\S]*!bondWorkBalanceError[\s\S]*bondWorkAmountAtoms <= workAttachmentSpendableAtoms/.test(
      app,
    ) &&
    /WORK attachments to normal messages are exposed to every connected mainnet sender whose authoritative wallet-scoped state proves positive spendable WORK/.test(
      contents.get("README.md"),
    ) &&
    /Infinity Bonds remain a V1 allowlisted sender feature/.test(
      contents.get("README.md"),
    ) &&
    /Inception Bonds expose WORK attachment to every connected mainnet address whose authoritative wallet-scoped state proves a positive confirmed WORK balance/.test(
      contents.get("README.md"),
    ),
);
expect(
  "WORK attachment previews reuse canonical wallet spendability",
  /const accountWorkSpendabilityState = accountWorkTokenLaneClean[\s\S]*accountWorkTokenState[\s\S]*accountAllTokenLaneClean[\s\S]*accountTokenState/.test(
    app,
  ) &&
    /const workAttachmentPreviewSpendability = useMemo[\s\S]*tokenSpendabilityForWallet\([\s\S]*tokenListings[\s\S]*tokenClosedListings[\s\S]*tokenTransfers[\s\S]*tokenSales/.test(
      app,
    ) &&
    /const workAttachmentVisible =[\s\S]*workAttachmentSpendableAtoms > 0n/.test(
      app,
    ),
);
expect(
  "WORK attachment previews fail closed without a clean Q16 wallet lane",
  /const accountWorkSpendabilityState = accountWorkTokenLaneClean[\s\S]*accountAllTokenLaneClean[\s\S]*: undefined/.test(
    app,
  ) &&
    /if \(!address \|\| !accountWorkSpendabilityState\) \{\s*return undefined;\s*\}/.test(
      app,
    ) &&
    /catch \{\s*return undefined;\s*\}/.test(app) &&
    /workAtomsFromIntegerString\([\s\S]*workAttachmentPreviewSpendability\?\.spendableBalanceSubatoms[\s\S]*workNumberFromAtoms\(workAttachmentSpendableAtoms\)/.test(
      app,
    ),
);
expect(
  "clean scoped account lanes suppress stale zero WORK and bond balances",
  /function mergeAccountTokenWalletBalanceLanes\([\s\S]*allLaneClean: boolean[\s\S]*if \(lane\.clean\)[\s\S]*merged\.filter[\s\S]*else if \(allLaneClean\)[\s\S]*mergeTokenWalletBalancesByToken/.test(
    app,
  ) &&
    /mergeAccountTokenWalletBalanceLanes\([\s\S]*accountTokenWalletBalances,[\s\S]*accountAllTokenLaneClean,[\s\S]*accountWorkTokenLaneClean[\s\S]*accountPowbTokenLaneClean[\s\S]*accountIncbTokenLaneClean/.test(
      app,
    ) &&
    /function accountTokenLaneHasCleanAuthority\([\s\S]*statuses\.all\.loaded[\s\S]*statuses\[lane\]\.loaded/.test(
      app,
    ) &&
    /const confirmedCreditBalances = mergeTokenWalletBalancesByToken\([\s\S]*routeCreditBalances,[\s\S]*accountCreditBalances/.test(
      app,
    ) &&
    /const connectedBondWalletBalances = mergeTokenWalletBalancesByToken\([\s\S]*routeBondBalances,[\s\S]*accountBondBalances/.test(
      app,
    ) &&
    !/accountCreditBalances\.length > 0\s*\?/.test(app) &&
    !/accountBondBalances\.length > 0\s*\?/.test(app),
);
expect(
  "connected wallet consumers never resurrect clean canonical zero balances",
  /function walletBalancesForConnection\([\s\S]*return address \? accountBalances : routeBalances/.test(
    app,
  ) &&
    /const accountActiveBondWalletBalances = useMemo\([\s\S]*accountWalletBalances\.filter[\s\S]*activeBondConfig\.tokenId[\s\S]*const activeBondWalletBalances = walletBalancesForConnection\([\s\S]*accountActiveBondWalletBalances,[\s\S]*routeActiveBondWalletBalances/.test(
      app,
    ) &&
    /const walletTransferBalances = walletBalancesForConnection\([\s\S]*address,[\s\S]*accountWalletBalances,[\s\S]*tokenWalletBalances/.test(
      app,
    ) &&
    /const walletOperationBalances = bondWorkspaceActive[\s\S]*activeBondWalletBalances[\s\S]*walletTransferBalances/.test(
      app,
    ) &&
    /const accountActiveBondTokenDefinition =[\s\S]*accountActiveBondWalletBalances\[0\]\?\.token[\s\S]*accountIncbTokenState\.tokens[\s\S]*accountPowbTokenState\.tokens[\s\S]*accountTokenState\.tokens\.find/.test(
      app,
    ) &&
    /const activeBondTokenDefinition =[\s\S]*accountActiveBondTokenDefinition \?\? activeBondTokenDefinitions\[0\]/.test(
      app,
    ) &&
    /const walletTransferToken = bondWorkspaceActive[\s\S]*\? activeBondTokenDefinition/.test(
      app,
    ) &&
    /const walletTransferBalanceRow = walletOperationBalances\.find[\s\S]*const walletTransferBalance =[\s\S]*walletTransferBalanceRow\?\.confirmedBalance[\s\S]*const walletPendingTokenBalance =[\s\S]*walletTransferBalanceRow\?\.pendingOutgoing/.test(
      app,
    ) &&
    /tokenRecordAmountAtoms\([\s\S]*walletTransferToken,[\s\S]*tokenTransferInput\.amount,[\s\S]*tokenTransferInput\.amountAtoms[\s\S]*walletSpendableTokenAtoms/.test(
      app,
    ) &&
    /if \(walletTransferBalances\.length === 0\)[\s\S]*walletTransferBalances\.some[\s\S]*setTokenTransferTokenId\(walletTransferBalances\[0\]\.token\.tokenId\)/.test(
      app,
    ) &&
    /const walletBalanceCountLoaded = address[\s\S]*accountTokenLaneStatuses\.all\.loaded[\s\S]*activeTokenStateLoaded/.test(
      app,
    ) &&
    /\{walletBalanceCountLoaded[\s\S]*walletTransferBalances\.length\.toLocaleString\(\)/.test(
      app,
    ) &&
    !/\? tokenWalletBalances\.length\.toLocaleString\(\)/.test(app),
);
expect(
  "wallet transfer amount keeps user-entered fractional credit values under the spendable maximum",
  /const \[tokenTransferAmount, setTokenTransferAmount\] = useState\("1"\)/.test(
    app,
  ) &&
    /const tokenTransferDisabledReason =[\s\S]*tokenTransferAmountUnits > walletSpendableTokenAtoms[\s\S]*Amount exceeds/.test(
      app,
    ) &&
    /busy[\s\S]*tokenAction === "transfer"[\s\S]*Transfer is already in progress[\s\S]*Another wallet action is already in progress/.test(
      app,
    ) &&
    !/setTokenTransferAmount\(nextAmount\)/.test(app),
);
expect(
  "pending WORK preflight preserves multi-recipient transfer multiplicity",
  /function tokenTransferSpendabilityKey\(transfer:[\s\S]*transfer\.txid[\s\S]*transfer\.tokenId[\s\S]*transfer\.senderAddress[\s\S]*transfer\.recipientAddress[\s\S]*transfer\.amount/.test(
    app,
  ) &&
    /function mergeTokenTransfersForSpendability\([\s\S]*groupedSources[\s\S]*confirmedSource[\s\S]*pendingSource[\s\S]*merged\.push/.test(
      app,
    ) &&
    /const pendingDirectTransferRows = mergeTokenTransfersForSpendability\([\s\S]*state\.transfers,[\s\S]*localTransfers[\s\S]*transfer\.tokenId === token\.tokenId[\s\S]*const pendingDirectTransferAtoms = exactUnits[\s\S]*tokenRecordAmountAtoms/.test(
      app,
    ) &&
    !/const transfersByTxid = new Map/.test(app),
);
expect(
  "pending transfer reservations survive refresh and self sends remain net zero",
  /const TOKEN_LOCAL_PENDING_TRANSFER_TTL_MS = 30 \* 60_000/.test(app) &&
    /function tokenTransferShouldSurviveRefresh[\s\S]*transfer\.confirmed !== false[\s\S]*TOKEN_LOCAL_PENDING_TRANSFER_TTL_MS/.test(
      app,
    ) &&
    /function tokenTransfersWithPreservedLocalPending[\s\S]*mergeTokenTransfersForSpendability\([\s\S]*incoming,[\s\S]*current\.filter\(tokenTransferShouldSurviveRefresh\)/.test(
      app,
    ) &&
    /const transfers = tokenTransfersWithPreservedLocalPending\([\s\S]*tokenTransfers[\s\S]*state\.transfers[\s\S]*const accepted = \{ \.\.\.state, listings, transfers \}/.test(
      app,
    ) &&
    /transfer\.senderAddress[\s\S]*normalizedWalletAddress &&[\s\S]*transfer\.recipientAddress[\s\S]*!==[\s\S]*normalizedWalletAddress/.test(
      app,
    ),
);
expect(
  "bond WORK attachment visibility follows the route-specific eligibility gate",
  /const bondWorkAttachmentVisible = bondWorkAttachmentAllowed;/.test(app) &&
    /const inceptionWorkBalanceRequired =[\s\S]*activeBondConfig\.folder === "inception"/.test(
      app,
    ) &&
    /const bondWorkBalanceHasCleanLane = inceptionWorkBalanceRequired[\s\S]*\? accountWorkTokenLaneClean[\s\S]*accountWorkTokenLaneClean \|\| accountAllTokenLaneClean/.test(
      app,
    ) &&
    /const bondWorkBalanceLoaded = inceptionWorkBalanceRequired[\s\S]*accountTokenLaneStatuses\.work\.loaded[\s\S]*accountTokenLaneStatuses\.all\.loaded/.test(
      app,
    ) &&
    /const bondWorkBalanceError = bondWorkBalanceHasCleanLane[\s\S]*inceptionWorkBalanceRequired[\s\S]*accountTokenLaneStatuses\.work\.error[\s\S]*accountTokenLaneStatuses\.all\.error/.test(
      app,
    ) &&
    /const bondWorkAttachmentBalanceOk =[\s\S]*bondWorkAttachmentAllowed[\s\S]*bondWorkBalanceHasCleanLane[\s\S]*bondWorkBalanceLoaded[\s\S]*!bondWorkBalanceError[\s\S]*bondWorkAmountAtoms <= workAttachmentSpendableAtoms/.test(
      app,
    ) &&
    /max=\{[\s\S]*bondWorkBalanceLoaded && !bondWorkBalanceError[\s\S]*: undefined/.test(
      app,
    ) &&
    /Loading the confirmed WORK balance\./.test(app) &&
    /The WORK balance preview is temporarily unavailable\./.test(app) &&
    /A fresh spendability check runs before signing\./.test(app),
);
expect(
  "WORK attachment sends retry canonical preflight without stale fallback",
  /const TOKEN_SPENDABLE_RECHECK_DELAYS_MS = \[0, 2_000, 5_000, 10_000\]/.test(
    app,
  ) &&
    /function isAuthoritativeWalletTokenPayload[\s\S]*authoritativeWallet === true[\s\S]*walletScoped === true[\s\S]*proof-indexer-wallet-token-overlay/.test(
      app,
    ) &&
    /async function fetchTokenState[\s\S]*requireAuthoritativeWallet[\s\S]*!isAuthoritativeWalletTokenPayload\(payload\)/.test(
      app,
    ) &&
    /async function fetchFreshWalletTokenPreflightState[\s\S]*!isAuthoritativeWalletTokenPayload\(payload\)[\s\S]*isTransientProofApiReadError[\s\S]*No transaction was created/.test(
      app,
    ) &&
    (app.match(/await fetchFreshWalletWorkState\(/gu)?.length ?? 0) === 2 &&
    /The index caught a new block\. Rechecking WORK/.test(app),
);
expect(
  "direct credit sends fail closed on canonical wallet spendability before PSBT creation",
  /async function transferToken[\s\S]*fetchFreshWalletTokenPreflightState\([\s\S]*tokenSpendabilityForWallet\([\s\S]*No transaction was created\.[\s\S]*buildPaymentPsbt\(/.test(
    app,
  ) &&
    /function tokenSpendabilityForWallet[\s\S]*confirmedBalanceAtoms -[\s\S]*reservedBalanceAtoms -[\s\S]*pendingOutgoingAtoms/.test(
      app,
    ) &&
    /Registry and miner fees are final once broadcast[\s\S]*not automatically refunded/.test(
      app,
    ),
);
expect(
  "credit listings use canonical holder spendability and the active AMO protocol before PSBT creation",
  /fetchFreshWalletTokenPreflightState\(\s*address,\s*token\.tokenId/.test(
    listTokenSource,
  ) &&
    /tokenSpendabilityForWallet\(\s*address,\s*token,\s*freshState,\s*tokenListings,\s*tokenClosedListings,\s*tokenTransfers,\s*tokenSales/.test(
      listTokenSource,
    ) &&
    /tokenAmountDisplay\([\s\S]*spendability\.spendableBalance,[\s\S]*spendability\.spendableBalanceSubatoms[\s\S]*available; \$\{attemptedAmountDisplay\} attempted\. No transaction was created\./.test(
      listTokenSource,
    ) &&
    /activeTokenListingAnchorOutpointsForAddress\(\s*spendability\.activeListings/.test(
      listTokenSource,
    ) &&
    !/walletSpendableTokenBalance/.test(listTokenSource) &&
    /const normalizedTokenListAmountUnits =[\s\S]*tokenRecordAmountAtoms\([\s\S]*tokenListInput\.amount/.test(
      app,
    ) &&
    /normalizedTokenListAmountUnits !== null[\s\S]*normalizedTokenListAmountUnits <= walletSpendableTokenAtoms/.test(
      canListTokenSource,
    ) &&
    /const workAmoV8ListingTermsSelected =[\s\S]*workV8DeclarationBoundaryObserved\(workFloorQuote\)[\s\S]*const workAmoListingFreshPreflightReady =[\s\S]*workAmoListingCanAttemptFreshPreflight\(workFloorQuote\)[\s\S]*const workAmoListInputReady = Boolean\([\s\S]*workAmoV8ListingTermsSelected[\s\S]*workAmoV8FaceProofsAllowed\(tokenListFaceProofs\)[\s\S]*workAmoV6FaceProofsAllowed\(tokenListFaceProofs\)[\s\S]*workAmoListingFreshPreflightReady[\s\S]*workAmoEstimateForFace\(workFloorQuote, tokenListFaceProofs\)[\s\S]*workV8CanAttemptFreshPreflight\(workFloorQuote\)[\s\S]*walletSpendableTokenAtoms > 0n/.test(
      canListTokenSource,
    ) &&
    !/max=\{Math\.max\(1, listSpendableBalance\)\}/.test(app) &&
    !/fetchTokenState|tokenWalletBalancesFor|walletMode|activeFolder/.test(
      listTokenSource,
    ),
);
expect(
  "fractional WORK purchases keep their exact pending seller reservation",
  /const sale:\s*PowTokenSale\s*=\s*\{[\s\S]*amount:\s*listing\.amount,[\s\S]*amountAtoms:\s*listing\.amountAtoms,[\s\S]*listingId:\s*listing\.listingId/.test(
    buyTokenListingSource,
  ) &&
    /const uncoveredPendingSaleAtoms = exactUnits[\s\S]*tokenRecordAmountAtoms\([\s\S]*sale\.amountAtoms/.test(
      app,
    ),
);
expect(
  "wallet transfer copy names explicit admitted send2 or send3 and exposes paused WORK without changing bond copy",
  /const workTransferMode =[\s\S]*workWriteModeForDraftPayload\(workFloorQuote\)[\s\S]*workTransferMode === "native-q16"[\s\S]*"pwt1:send3"[\s\S]*workTransferMode === "legacy-q8"[\s\S]*"pwt1:send2"[\s\S]*"paused WORK transfer"[\s\S]*"pwt1:send"/.test(
    app,
  ) &&
    /transferDescription:\s*`Sends a pwt1:send \$\{bondConfig\.ticker\} event/.test(
      app,
    ),
);
expect(
  "wallet transfer log orders newest movement first before confirmation state",
  /const walletMovementTimeMs = \(movement: TokenWalletMovement\) =>[\s\S]*Date\.parse\(movement\.createdAt\)/.test(
    tokenWalletWorkspaceSource,
  ) &&
    /\.sort\(\s*\(left, right\) =>\s*walletMovementTimeMs\(right\) - walletMovementTimeMs\(left\) \|\|\s*Number\(right\.confirmed\) - Number\(left\.confirmed\)/.test(
      tokenWalletWorkspaceSource,
    ),
);
expect(
  "Infinity and Inception bond composers attach canonical Q16 WORK through the active transfer version",
  /const \[bondWorkAmount,\s*setBondWorkAmount\] = useState\("0"\)/.test(app) &&
    /async function createInfinityBond[\s\S]*if \(!bondWorkAttachmentAllowed\)[\s\S]*latestWorkSpendability\.confirmedBalanceSubatoms[\s\S]*latestWorkSpendability\.spendableBalanceSubatoms/.test(
      app,
    ) &&
    /async function createInfinityBond[\s\S]*preparedBondWorkMode = \(await freshWorkWriteMode\(\)\)\.mode[\s\S]*buildTokenSendPayload\([\s\S]*WORK_TOKEN_ID[\s\S]*preparedBondWorkMode/.test(
      app,
    ) &&
    /async function createInfinityBond[\s\S]*postProtocolPayments:[\s\S]*WORK_TOKEN_REGISTRY_ADDRESS[\s\S]*postProtocolPayloads:\s*attachedWorkPayloads/.test(
      app,
    ) &&
    /async function createInfinityBond[\s\S]*attachedCredits:[\s\S]*attachedWorkCredits/.test(
      app,
    ) &&
    /Attach WORK/.test(app),
);
expect(
  "mail WORK attachments preserve mail then WORK output order",
  /postProtocolPayloads\s*=\s*\[\]/.test(app) &&
    /for \(const script of opReturnScripts\)[\s\S]*for \(const payment of normalizedPostProtocolPayments\)[\s\S]*for \(const script of postProtocolOpReturnScripts\)/.test(
      app,
    ) &&
    /postProtocolPayments:[\s\S]*WORK_TOKEN_REGISTRY_ADDRESS[\s\S]*postProtocolPayloads:\s*attachedWorkPayloads/.test(
      app,
    ),
);
expect(
  "mail WORK attachment readiness hydrates canonical admission before Send can enable",
  /const mailWorkAttachmentRequested\s*=/.test(app) &&
    /const mailWorkFloorHydrationRequired\s*=/.test(app) &&
    /const mailWorkWriteMode\s*=[\s\S]*workWriteModeForQuote\(workFloorQuote\)/.test(
      app,
    ) &&
    /const mailWorkAdmissionChecking\s*=[\s\S]*mailWorkFloorHydrationRequired/.test(
      app,
    ) &&
    /const mailWorkAdmissionPaused\s*=[\s\S]*mailWorkWriteMode/.test(app) &&
    (app.match(/mailWorkFloorHydrationRequired/g)?.length ?? 0) >= 3 &&
    /useEffect\(\(\) => \{[\s\S]{0,1800}mailWorkFloorHydrationRequired[\s\S]{0,1800}(?:refreshWorkFloor|fetchWorkFloorQuote)/.test(
      app,
    ),
);
expect(
  "pre-boundary floor regressions cannot manufacture a V8 write embargo",
  /const v8BoundaryNeedsFailClosedRetention\s*=\s*boundaryWasLatched\s*\|\|\s*incomingBoundaryObserved/.test(
    applyWorkFloorQuoteBlock,
  ) &&
    (applyWorkFloorQuoteBlock.match(/v8BoundaryNeedsFailClosedRetention/g)
      ?.length ?? 0) >= 2 &&
    /(?:if\s*\(v8BoundaryNeedsFailClosedRetention\)|v8BoundaryNeedsFailClosedRetention\s*\?)[\s\S]*failClosedWorkAmoV8Status/.test(
      applyWorkFloorQuoteBlock,
    ),
);
expect(
  "mail send admission exposes an explicit visible readiness reason",
  /const mailWorkAdmissionReason\s*=/.test(app) &&
    /const messageWorkAmountInvalid\s*=/.test(app) &&
    /messageWorkAmount\.trim\(\)\s*!==\s*""[\s\S]*parsedMessageWorkAmountAtoms\s*===\s*null/.test(
      app,
    ) &&
    /Enter a WORK amount using up to 16 decimal places/.test(app) &&
    /const mailWorkBalanceInsufficient\s*=/.test(app) &&
    /WORK attachment total \$\{formatWorkAmount\(workAttachmentTotalAtoms\)\} exceeds/.test(
      app,
    ) &&
    /const \[mailWorkAdmissionError, setMailWorkAdmissionError\]/.test(app) &&
    /refreshWorkFloor\(true, true\)[\s\S]*Verified WORK transfer admission is unavailable/.test(
      app,
    ) &&
    /const composeSendState\s*=[\s\S]*mailSendBusy[\s\S]*"busy"[\s\S]*"ready"[\s\S]*"disabled"/.test(
      app,
    ) &&
    /sendState=\{composeSendState\}/.test(app) &&
    /sendStatus=\{[\s\S]{0,300}mailWorkAdmissionReason[\s\S]{0,300}\}/.test(
      app,
    ) &&
    /sendStatus:\s*string/.test(composePaneBlock) &&
    /id="compose-send-status"/.test(composePaneBlock) &&
    /aria-live="polite"/.test(composePaneBlock) &&
    /\{sendStatus\}/.test(composePaneBlock),
);
expect(
  "mail Send uses dedicated ready, disabled, and busy interaction states",
  /const \[mailSendBusy, setMailSendBusy\] = useState\(false\)/.test(app) &&
    /const mailSendInFlightRef = useRef\(false\)/.test(app) &&
    /mailSendInFlightRef\.current \|\| mailSendBusy/.test(sendOpReturnBlock) &&
    /mailSendInFlightRef\.current = true/.test(sendOpReturnBlock) &&
    /finally\s*\{[\s\S]*mailSendInFlightRef\.current = false/.test(
      sendOpReturnBlock,
    ) &&
    /setMailSendBusy\(true\)/.test(sendOpReturnBlock) &&
    /finally\s*\{[\s\S]*setMailSendBusy\(false\)/.test(sendOpReturnBlock) &&
    /sendState:\s*"ready"\s*\|\s*"disabled"\s*\|\s*"busy"/.test(
      composePaneBlock,
    ) &&
    /className="primary mail-send-button"/.test(composePaneBlock) &&
    /data-state=\{sendState\}/.test(composePaneBlock) &&
    /aria-busy=\{sendState === "busy"\}/.test(composePaneBlock) &&
    /disabled=\{sendState !== "ready"\}/.test(composePaneBlock) &&
    /aria-describedby=[\s\S]{0,180}compose-send-status/.test(composePaneBlock) &&
    /sendState === "busy"[\s\S]*Sending/.test(composePaneBlock) &&
    !/busy\s*\?\s*"Sending"\s*:\s*"Send"/.test(composePaneBlock),
);
const mailWorkSignalBlock =
  app.match(
    /function mailAttachedWorkCredits[\s\S]*?function attachmentHref/,
  )?.[0] ?? "";
const mailSortBlock =
  app.match(/function sortMessages[\s\S]*?async function getWalletNetwork/)?.[0] ??
  "";
const computerMailBlock =
  app.match(/const activeMessages = useMemo[\s\S]*?const selectedMessage/)?.[0] ??
  "";
const filesWorkspaceBlock =
  app.match(/function FilesWorkspace[\s\S]*?function FilePreview/)?.[0] ?? "";
const computerFilesSourceBlock =
  app.match(/const allFileMessages[\s\S]*?const desktopFileMessages/)?.[0] ??
  "";
const desktopWorkspaceMailSortBlock =
  app.match(/function DesktopWorkspace[\s\S]*?function FilesWorkspace/)?.[0] ??
  "";
expect(
  "mail WORK signal accepts only canonical WORK and exact Q16 subatoms",
  /credit\.tokenId[\s\S]*WORK_TOKEN_ID/.test(mailWorkSignalBlock) &&
    /normalizeTokenTicker\(credit\.ticker\) === WORK_TOKEN_TICKER/.test(
      mailWorkSignalBlock,
    ) &&
    /workRecordAtoms\([\s\S]*credit\.amount,[\s\S]*credit\.amountAtoms,[\s\S]*credit\.amountSubatoms/.test(
      mailWorkSignalBlock,
    ) &&
    /reduce\([\s\S]*total \+ atoms[\s\S]*0n/.test(mailWorkSignalBlock),
);
expect(
  "mail WORK signal is direction-aware",
  /message\.folder === "sent"[\s\S]*return workCredits/.test(
    mailWorkSignalBlock,
  ) &&
    /samePaymentAddress\(credit\.recipientAddress, message\.to\)/.test(
      mailWorkSignalBlock,
    ) &&
    /message\.folder !== "sent"[\s\S]*formatWorkAmount\(totalAtoms\)/.test(
      mailWorkSignalBlock,
    ),
);
expect(
  "mail highest signal sorting is exact and deterministic",
  /signalMode: MailSignalMode = "proofs"/.test(mailSortBlock) &&
    /signalMode === "work"[\s\S]*mailWorkSignalAtoms\(left\)[\s\S]*mailWorkSignalAtoms\(right\)/.test(
      mailSortBlock,
    ) &&
    /leftWorkAtoms > rightWorkAtoms \? -1 : 1/.test(mailSortBlock) &&
    /right\.amountSats - left\.amountSats[\s\S]*Date\.parse\(right\.createdAt\) - Date\.parse\(left\.createdAt\)[\s\S]*left\.txid\.localeCompare\(right\.txid\)/.test(
      mailSortBlock,
    ),
);
expect(
  "Proofs and WORK signals cover every Computer mail collection",
  [
    'activeFolder === "inbox"',
    'activeFolder === "incoming"',
    'activeFolder === "sent"',
    'activeFolder === "outbox"',
    'activeFolder === "favorites"',
    'activeFolder === "archive"',
    'activeFolder === "files"',
    'activeFolder === "custom"',
  ].every((folderBranch) => computerMailBlock.includes(folderBranch)) &&
    /sortMode,[\s\S]*mailSignalMode/.test(computerMailBlock),
);
expect(
  "mail signal controls select highest-value mode",
  /function MailSignalToggle/.test(app) &&
    /aria-label="Mail ranking signal"/.test(app) &&
    /setMailSignalMode\(signalMode\);[\s\S]*setSortMode\("value"\)/.test(app) &&
    /Highest WORK/.test(app) &&
    /Highest proofs/.test(app),
);
expect(
  "Computer Files exposes WORK signal without changing public Desktop sorting",
  /<MailSignalToggle[\s\S]*signalMode=\{signalMode\}/.test(
    filesWorkspaceBlock,
  ) &&
    /showWorkSignal/.test(filesWorkspaceBlock) &&
    !/<MailSignalToggle/.test(desktopWorkspaceMailSortBlock) &&
    /sortMessages\([\s\S]*sortMode,[\s\S]*\)/.test(
      desktopWorkspaceMailSortBlock,
    ) &&
    !/sortMessages\([\s\S]*sortMode,[\s\S]*signalMode/.test(
      desktopWorkspaceMailSortBlock,
    ),
);
expect(
  "Computer Files remains confirmed-only for received and sent mail",
  /message\.folder === "inbox"[\s\S]*message\.confirmed[\s\S]*sentDeliveryStatus\(message\) === "confirmed"/.test(
    computerFilesSourceBlock,
  ),
);
expect(
  "mail merge and presentation preserve WORK attachments",
  /function mergeSentAttachedCredits[\s\S]*sentDeliveryStatus\(preferred\) === "confirmed"[\s\S]*return preferred\.attachedCredits;[\s\S]*new Map<string, MailAttachedCredit>[\s\S]*fallback\.attachedCredits[\s\S]*preferred\.attachedCredits/.test(
    app,
  ) &&
    /function mergeSentRecord[\s\S]*mergeSentAttachedCredits\(preferred, fallback\)/.test(
      app,
    ) &&
    /function mergeSentMessageSources[\s\S]*confirmedCanonical[\s\S]*attachedCredits: canonical\.attachedCredits/.test(
      app,
    ) &&
    /message\.network === "livenet"[\s\S]*sentDeliveryStatus\(message\) === "confirmed"[\s\S]*attachedCredits: undefined/.test(
      app,
    ) &&
    (app.match(/mailWorkSignalLabel\(message\)/g)?.length ?? 0) >= 5 &&
    /mailWorkSignalLabel\(threadMessage\)/.test(app),
);
const idMarketplaceCardBlock =
  app.match(/function IdMarketplaceCard[\s\S]*?function PendingIdEventList/)?.[0] ??
  "";
const prepareIdSaleAuthorizationBlock =
  app.match(
    /async function prepareIdSaleAuthorization[\s\S]*?async function publishIdListing/,
  )?.[0] ?? "";
expect(
  "ID marketplace buttons use action-specific busy labels",
  /idMarketplaceAction/.test(idMarketplaceCardBlock) &&
    /publishInProgress/.test(idMarketplaceCardBlock) &&
    /buyInProgress/.test(idMarketplaceCardBlock) &&
    !/busy\s*\?\s*"Publishing"/.test(idMarketplaceCardBlock) &&
    !/busy\s*\?\s*"Buying"/.test(idMarketplaceCardBlock),
);
expect(
  "ID marketplace publish uses narrow ID record verification",
  /fetchIdRecordState\(network,\s*managedIdRecord\.id\)/.test(
    prepareIdSaleAuthorizationBlock,
  ) &&
    !/fetchIdRegistryState\(network,\s*true\)/.test(
      prepareIdSaleAuthorizationBlock,
    ),
);
expect(
  "ID marketplace buy button uses the purchase guard",
  /disabled=\{!canPurchaseId\}/.test(idMarketplaceCardBlock),
);
[
  /className="desktop-public-header"/,
  /className="id-launch-topbar"/,
  /brandClassName=/,
].forEach((pattern) =>
  notContains("src/App.tsx", pattern, `no per-route AppHeader override ${pattern}`),
);
const browserAppBlock = app.match(/function BrowserApp[\s\S]*?function BrowserWorkspace/)?.[0] ?? "";
const browserWorkspaceBlock =
  app.match(/function BrowserWorkspace[\s\S]*?function DesktopApp/)?.[0] ?? "";
expect(
  "standalone Browser route has dedicated metadata and canonical URLs",
  [
  /browserRoute\s*\?\s*\{[\s\S]*title:\s*"ProofOfWork Browser"/,
  /Render ProofOfWork HTML message bodies and verified HTML attachments by transaction ID\./,
  /function browserRoutePath\(txid:\s*string,\s*network:\s*BitcoinNetwork\)/,
  /params\.set\("browser",\s*"1"\)/,
  /window\.history\.pushState\(null,\s*"",\s*nextPath\)/,
  /syncBrowserRoute\(txid,\s*targetNetwork\)/,
  ].every((pattern) => pattern.test(app)),
);
expect(
  "Browser iframes do not grant clipboard write to rendered pages",
  !/allow="clipboard-write"/.test(app),
);
expect(
  "confirmed and pending Browser pages share one static iframe renderer",
  /function BrowserPageFrame\(\{ page \}: \{ page: BrowserPage \}\)/.test(app) &&
    /sandbox=""[\s\S]{0,100}srcDoc=\{browserStaticDocument\(page\.html\)\}/.test(
      app,
    ) &&
    (app.match(/<BrowserPageFrame\b/g) || []).length === 2 &&
    !/<ConfirmedBrowserPageFrame\b/.test(app),
);
expect(
  "Browser rendering has no script bridge, context injection, or bridge assets",
  !/allow-scripts|allow-same-origin|postMessage|POW_CONTEXT|browserPageContext|browser-sandbox/.test(
    app,
  ) &&
    !existsSync("public/browser-sandbox.html") &&
    !existsSync("public/browser-sandbox.js"),
);
expect(
  "Browser static HTML is sanitized in an inert template before serialization",
  /const template = document\.createElement\("template"\)/.test(app) &&
    /template\.innerHTML = browserStaticStructuralShells\(html\);[\s\S]{0,100}sanitizeBrowserStaticFragment\(template\.content\)/.test(
      app,
    ) &&
    /<body\$\{bodyAttributes\} data-pow-static-page="" inert="">/.test(app) &&
    !/new DOMParser\(/.test(app),
);
expect(
  "Browser sanitizer preserves safe document and body presentation attributes",
  /function browserStaticStructuralShells\(html: string\)/.test(app) &&
    /html\|head\|body/.test(app) &&
    /pow-static-\$\{name\.toLowerCase\(\)\}/.test(app) &&
    /function browserStaticAttributeMarkup/.test(app) &&
    /const htmlAttributes = browserStaticAttributeMarkup\(htmlShell\)/.test(
      app,
    ) &&
    /const bodyAttributes = browserStaticAttributeMarkup/.test(app) &&
    /headHtml/.test(app) &&
    /bodyHtml/.test(app),
);
expect(
  "Browser sanitizer removes refresh, base, executable, and embedded navigation elements",
  /"base"/.test(app) &&
    /"meta"/.test(app) &&
    /"script"/.test(app) &&
    /"iframe"/.test(app) &&
    /"object"/.test(app) &&
    /BROWSER_STATIC_REMOVED_ELEMENTS/.test(app) &&
    /fragment\.querySelectorAll\([\s\S]{0,100}BROWSER_STATIC_REMOVED_ELEMENTS/.test(
      app,
    ) &&
    /element\.remove\(\)/.test(app),
);
expect(
  "Browser sanitizer strips navigation and form URLs while allowing only in-memory media",
  [
    '"action"',
    '"formaction"',
    '"href"',
    '"ping"',
    '"src"',
    '"srcdoc"',
    '"srcset"',
    '"xlink:href"',
    '"formmethod"',
    '"formtarget"',
    '"target"',
  ].every((attribute) => app.includes(attribute)) &&
    /!\/\^\(\?:blob\|data\):\/iu\.test\(normalizedValue\)/.test(app) &&
    /attributeName\.startsWith\("on"\)/.test(app) &&
    /element\.removeAttribute\(attribute\.name\)/.test(app),
);
expect(
  "Browser forms are replaced with inert non-form containers",
  /fragment\.querySelectorAll\("form"\)/.test(app) &&
    /document\.createElement\("div"\)/.test(app) &&
    /data-pow-static-form/.test(app) &&
    /replacement\.setAttribute\("inert", ""\)/.test(app) &&
    /form\.replaceWith\(replacement\)/.test(app),
);
expect(
  "route flags use exact URLSearchParams matching",
  /new URLSearchParams\(window\.location\.search\)\.get\(name\) === "1"/.test(
    routeRegistry,
  ) && !/window\.location\.search\.includes/.test(routeRegistry),
);
expect(
  "Computer restores exact folder routes on browser history navigation",
  /window\.addEventListener\("popstate", restoreComputerLocation\)/.test(app) &&
    /computerFolderFromSearch\(\) \?\? "inbox"/.test(app),
);
expect(
  "standalone Browser restores txid and network from browser history",
  /window\.addEventListener\("popstate", restoreBrowserLocation\)/.test(
    browserAppBlock,
  ) &&
    /networkFromBrowserLocation\(\)/.test(browserAppBlock) &&
    /txidFromBrowserLocation\(\)/.test(browserAppBlock) &&
    /loadGenerationRef\.current/.test(browserAppBlock) &&
    /loadPage\(nextTxid, nextNetwork, false\)/.test(browserAppBlock),
);
expect(
  "Computer Browser ignores late page loads after network changes",
  /const loadGenerationRef = useRef\(0\)/.test(browserWorkspaceBlock) &&
    /const generation = \+\+loadGenerationRef\.current/.test(
      browserWorkspaceBlock,
    ) &&
    /generation !== loadGenerationRef\.current/.test(browserWorkspaceBlock) &&
    /generation === loadGenerationRef\.current/.test(browserWorkspaceBlock) &&
    /loadGenerationRef\.current \+= 1;[\s\S]{0,120}setNetwork\(activeNetwork\)/.test(
      browserWorkspaceBlock,
    ),
);
expect(
  "Desktop and Files never substitute hardcoded Welcome bytes",
  !/canonicalWelcomeAttachment|canonicalWelcomeFileMessage|withCanonicalWelcomeFile|CANONICAL_WELCOME_HTML/.test(
    app,
  ) &&
    /fileSurfaceMessages\(\s*publicDesktopMail\(inboxMessages, sentMessages\),?\s*\)/.test(
      app,
    ),
);
expect(
  "attachment reconstruction caps declared part counts before allocation",
  /const MAX_ATTACHMENT_PARTS = 1_024/.test(app) &&
    /total > MAX_ATTACHMENT_PARTS[\s\S]{0,1000}Array\.from\(\{ length: total \}/.test(
      app,
    ),
);
expect(
  "Browser static document CSP blocks scripts and rendered-page capabilities",
  /function browserStaticDocument\(html: string\)[\s\S]*script-src 'none'/.test(
    app,
  ) &&
    /connect-src 'none'/.test(app) &&
    /form-action 'none'/.test(app) &&
    /frame-src 'none'/.test(app) &&
    /object-src 'none'/.test(app) &&
    /worker-src 'none'/.test(app) &&
    /http-equiv="Content-Security-Policy"/.test(app),
);
expect(
  "signed PSBT intent and node txid are verified before broadcast",
  /function assertSignedTransactionIntent/.test(app) &&
    (app.match(/assertSignedTransactionIntent\(/g) || []).length >= 3 &&
    /result\.txid !== localTxid/.test(app) &&
    /No transaction was broadcast/.test(app),
);
const detailedSignerBlock =
  app.match(
    /async function signAndBroadcastPsbtDetailed[\s\S]*?async function signAndBroadcastPsbt\(/,
  )?.[0] ?? "";
expect(
  "failed signed PSBT extraction cannot bypass checks through wallet push",
  !/pushPsbt\(/.test(detailedSignerBlock),
);
expect(
  "final signer blocks protected sale-ticket anchor spends before broadcast",
  /async function assertTransactionIntentDoesNotSpendReservedListingAnchors[\s\S]*fetchFreshProofOfWorkListingAnchorOutpoints[\s\S]*ProofOfWork\.Me blocked this transaction[\s\S]*No transaction was broadcast/.test(
    app,
  ) &&
    /allowedReservedListingAnchorOutpoints/.test(detailedSignerBlock) &&
    (detailedSignerBlock.match(
      /assertTransactionIntentDoesNotSpendReservedListingAnchors/g,
    ) || []).length >= 2 &&
    /expectedIntent/.test(detailedSignerBlock) &&
    /rawUnsignedTransactionIntent\(signedTransaction\)/.test(
      detailedSignerBlock,
    ) &&
    /allowedReservedListingAnchorOutpoints:\s*mergeListingAnchorOutpoints\(\[\s*listingAnchorOutpoint\(latestListing\)/.test(
      app,
    ) &&
    /allowedReservedListingAnchorOutpoints:\s*mergeListingAnchorOutpoints\(\[\s*tokenListingAnchorOutpoint\(listing\)/.test(
      app,
    ),
);
const sealTokenListingBlock =
  app.match(
    /async function sealTokenListing[\s\S]*?async function delistTokenListing/,
  )?.[0] ?? "";
expect(
  "credit sale-ticket seal cannot spend its listing anchor",
  /excludeOutpoints:\s*activeTokenListingAnchorOutpointsForAddress/.test(
    sealTokenListingBlock,
  ) && !/allowedReservedListingAnchorOutpoints/.test(sealTokenListingBlock),
);
expect(
  "Computer credit state and in-flight reads are isolated by scope",
  /acceptedTokenStatesRef = useRef\(\s*new Map<string, PowTokenState>\(\)/.test(
    app,
  ) &&
    /tokenRefreshInFlightRef = useRef\(\s*new Map/.test(app) &&
    /activeTokenStateScopeRef\.current !== scopeKey/.test(app),
);
expect(
  "workspace status and busy completions stay with their originating folder",
  /workspaceStatusesRef = useRef\(\s*new Map<string, WorkspaceStatus>/.test(
    app,
  ) &&
    /setStatusForWorkspace/.test(app) &&
    /activeWorkspaceStatusKeyRef\.current === workspaceKey/.test(app) &&
    /async function refreshMarketplaceSummary[\s\S]*requestWorkspaceKey[\s\S]*setStatusForWorkspace\(requestWorkspaceKey/.test(
      app,
    ) &&
    /async function refreshInfinity[\s\S]*requestWorkspaceKey[\s\S]*setBusyForWorkspace\(requestWorkspaceKey/.test(
      app,
    ),
);
const chooseSellerAnchorPlanBlock =
  app.match(/async function chooseSellerAnchorPlan[\s\S]*?async function fetchBroadcastStatus/)?.[0] ?? "";
const selectChainedInitialInputsBlock =
  app.match(/async function selectChainedInitialInputs[\s\S]*?function buildChainedMintPsbt/)?.[0] ?? "";
const buildPaymentPsbtBlock =
  app.match(/async function buildPaymentPsbt[\s\S]*?async function signSellerAnchorAuthorization/)?.[0] ?? "";
const buildAnchoredMarketplacePsbtBlock =
  app.match(/async function buildAnchoredMarketplacePsbt[\s\S]*?async function broadcastRawTransactionViaProofApi/)?.[0] ?? "";
const listingAnchorDetailsBlock =
  app.match(/function listingAnchorDetails[\s\S]*?async function assertListingAnchorUnspent/)?.[0] ?? "";
const assertListingAnchorUnspentBlock =
  app.match(/async function assertListingAnchorUnspent[\s\S]*?async function buildAnchoredMarketplacePsbt/)?.[0] ?? "";
const signTokenSaleTicketAuthorizationBlock =
  app.match(/async function signTokenSaleTicketAuthorization[\s\S]*?function encodeCompactSize/)?.[0] ?? "";
const tokenWalletWorkspaceBlock =
  app.match(/function TokenWalletWorkspace\([\s\S]*?function TokenApp\(/)?.[0] ?? "";
const tokenMarketplaceBookBlock =
  app.match(
    /<MarketplaceListingBookTabs[\s\S]*?<PaginationControls\s+label="Sale tickets"/,
  )?.[0] ?? "";
const walletRecoverableV3WorkRelicsSource =
  tokenWalletWorkspaceBlock.match(
    /const walletRecoverableV3WorkRelics =[\s\S]*?const walletTokenById/,
  )?.[0] ?? "";
const walletV3RelicRecoveryBlock =
  tokenWalletWorkspaceBlock.match(
    /\{walletRecoverableV3WorkRelics\.length \? \([\s\S]*?\) : null\}/,
  )?.[0] ?? "";
expect(
  "WORK legacy sale tickets remain replayable while V6 owns current AMO writes",
  /isWorkMarketSaleAuthorizationVersion/.test(listingAnchorDetailsBlock) &&
    /listingAnchorDetails\(listing, network\)/.test(
      assertListingAnchorUnspentBlock,
    ) &&
    /assertListingAnchorUnspent\(listing, network\)/.test(
      signTokenSaleTicketAuthorizationBlock,
    ) &&
    /assertListingAnchorUnspent\(listing, network\)/.test(
      buildAnchoredMarketplacePsbtBlock,
    ) &&
    /TOKEN_SALE_AUTH_WORK_MARKET_V2_VERSION\s*=\s*"pwt-sale-v3"/.test(app) &&
    /TOKEN_SALE_AUTH_WORK_CONFIRMATION_FLOOR_VERSION\s*=\s*"pwt-sale-v4"/.test(
      app,
    ) &&
    /TOKEN_SALE_AUTH_WORK_AMO_UNIT_VERSION\s*=\s*"pwt-sale-v5"/.test(app) &&
    /TOKEN_SALE_AUTH_WORK_AMO_PROOF_UNIT_VERSION\s*=\s*"pwt-sale-v6"/.test(
      app,
    ) &&
    /workAmoStaticAuthorizationForListing\(listing\)/.test(
      sealTokenListingSource,
    ) &&
    /workAmoFrozenTerms\(listing\)/.test(buyTokenListingSource) &&
    /async function delistTokenListing[\s\S]*buildTokenDelistingPayload\(\s*listing\.listingId\s*\)/.test(
      app,
    ),
);
expect(
  "Wallet preserves owner-only V3 WORK relic recovery before V8 and hides it after activation",
  /normalizedWalletAddress &&\s*!workV8DeclarationBoundaryObserved\(workFloorQuote\)\s*\?\s*closedListings/.test(
    walletRecoverableV3WorkRelicsSource,
  ) &&
    /item\.relic === true[\s\S]*item\.confirmed === true[\s\S]*!closedListingIdsWithCloseTransaction\.has\([\s\S]*tokenListingStateKey\(item\)[\s\S]*item\.sellerAddress\.trim\(\)\.toLowerCase\(\) ===\s*normalizedWalletAddress[\s\S]*isWorkToken\(item\)[\s\S]*item\.saleAuthorization\.version ===\s*TOKEN_SALE_AUTH_WORK_MARKET_V2_VERSION/.test(
      walletRecoverableV3WorkRelicsSource,
    ) &&
    /\)\s*:\s*\[\];\s*const walletTokenById/.test(
      walletRecoverableV3WorkRelicsSource,
  ) &&
    /V3 WORK sale-ticket recovery[\s\S]*cannot be sealed or bought[\s\S]*Recover with delist5/.test(
      walletV3RelicRecoveryBlock,
    ) &&
    /onClick=\{\(\) => delistListing\(item\)\}/.test(
      walletV3RelicRecoveryBlock,
    ) &&
    /label:\s*item\.relic === true && !item\.closedTxid\s*\?\s*"Retired listing"\s*:\s*"Delisted"/.test(
      tokenWalletWorkspaceBlock,
    ) &&
    !/sealListing|buyTokenListing|refund|snapshot/i.test(
      walletV3RelicRecoveryBlock,
    ),
);
expect(
  "WORK AMO keeps V6 readiness immutable and cuts over to fail-closed V8 admission",
  /WORK_AMO_V6_ALLOWED_FACE_PROOFS\s*=\s*\[20_000,\s*50_000,\s*100_000\]\s*as const/.test(
    app,
  ) &&
    /WORK_AMO_V6_UNIT_MODEL\s*=\s*"canonical-work-amo-proof-unit-v1"/.test(
      app,
    ) &&
    /function workAmoV6ActivationReady[\s\S]*status\?\.version === TOKEN_SALE_AUTH_WORK_AMO_PROOF_UNIT_VERSION[\s\S]*status\.activation\?\.active === true[\s\S]*status\.activation\.evidenceComplete === true/.test(
      app,
    ) &&
    /function workAmoV6SettlementWritesReady[\s\S]*workAmoV6ActivationReady\(quote\)[\s\S]*status\?\.ready === true[\s\S]*status\.protocolWritesEnabled === true[\s\S]*status\.settlementWritesEnabled === true/.test(
      app,
    ) &&
    /function workAmoV6ListingWritesReady[\s\S]*workAmoV6SettlementWritesReady\(quote\)[\s\S]*status\?\.listingWritesEnabled === true/.test(
      app,
    ) &&
    /function workV8ActivationReached[\s\S]*status\?\.version === TOKEN_SALE_AUTH_WORK_AMO_SUBATOM_VERSION[\s\S]*status\.activation\?\.reached === true/.test(
      workAmoV6ProofUnitSource,
    ) &&
    /function workV8WriteAdmissionReady[\s\S]*workV8ActivationReached\(quote\)[\s\S]*status\?\.activation\?\.active === true[\s\S]*status\?\.activation\?\.evidenceComplete === true[\s\S]*status\?\.protocolReady === true[\s\S]*status\.writeAdmission === true/.test(
      workAmoV6ProofUnitSource,
    ) &&
    /type WorkAmoV8Status = \{[\s\S]*pinsConfigured\?: boolean;[\s\S]*pinsRequested\?: boolean/.test(
      app,
    ) &&
    /function workV8DeclarationBoundaryObserved[\s\S]*legacyWriteEmbargo === true[\s\S]*pinsRequested === true[\s\S]*pinsConfigured === true[\s\S]*declarationConfirmed === true[\s\S]*reached === true/.test(
      workAmoV6ProofUnitSource,
    ) &&
    /function workWriteModeForQuote[\s\S]*status\?\.version !== TOKEN_SALE_AUTH_WORK_AMO_SUBATOM_VERSION[\s\S]*return "paused"[\s\S]*status\?\.pinsRequested === true[\s\S]*status\.pinsConfigured !== true[\s\S]*status\?\.pinsConfigured === true[\s\S]*status\.activation\?\.tipVerified !== true[\s\S]*workV8DeclarationBoundaryObserved\(quote\)[\s\S]*workV8WriteAdmissionReady\(quote\)[\s\S]*workAmoV6ActivationReady\(quote\) \? "legacy-q8" : "paused"/.test(
      workAmoV6ProofUnitSource,
    ) &&
    /const workV8DeclarationBoundaryLatchRef = useRef\(false\)/.test(app) &&
    /function applyWorkFloorQuote[\s\S]*boundaryWasLatched[\s\S]*failClosedWorkAmoV8Status[\s\S]*work-amo-v8-exact-tip-regressed/.test(
      app,
    ) &&
    /function clearResolvedWorkAmoV8DeclarationPauseStatus[\s\S]*workV8WriteAdmissionReady\(quote\)[\s\S]*status\?\.listingWritesEnabled !== true[\s\S]*status\?\.settlementWritesEnabled !== true[\s\S]*work-amo-v8-declaration-evidence-\(\?:mismatch\|unavailable\)[\s\S]*WORK AMO V8 write admission is ready/.test(
      app,
    ) &&
    /function applyWorkFloorQuote[\s\S]*setWorkFloorQuote\(safetyBoundQuote\);[\s\S]*clearResolvedWorkAmoV8DeclarationPauseStatus\(safetyBoundQuote\)/.test(
      app,
    ) &&
    /async function freshWorkWriteMode[\s\S]*boundaryWasLatched && !boundaryObserved[\s\S]*"paused"[\s\S]*expectedMode && mode !== expectedMode/.test(
      app,
    ) &&
    /function assertWorkAmoSettlementEnabled[\s\S]*!workV8DeclarationBoundaryObserved\(quote\)[\s\S]*assertWorkAmoV6SettlementEnabled\(quote\)[\s\S]*!workAmoSettlementWritesReady\(quote\)/.test(
      workAmoV6ProofUnitSource,
    ) &&
    /function assertWorkAmoListingEnabled[\s\S]*!workV8DeclarationBoundaryObserved\(quote\)[\s\S]*assertWorkAmoV6ListingEnabled\(quote\)[\s\S]*!workAmoListingWritesReady\(quote\)/.test(
      workAmoV6ProofUnitSource,
    ) &&
    /assertWorkAmoListingEnabled\(freshFloor\)/.test(listTokenSource),
);
expect(
  "WORK AMO V6 and V8 serialize only the proof face and label USD as display-only",
  /function tokenSaleAuthorizationWireDraft[\s\S]*isWorkAmoDerivedUnitAuthorization\(draft\.version\)[\s\S]*amount:\s*_amount[\s\S]*amountAtoms:\s*_amountAtoms[\s\S]*priceSats:\s*_priceSats[\s\S]*return wire/.test(
    app,
  ) &&
    /function tokenSaleAuthorizationWireDraft[\s\S]*amountSubatoms:\s*_amountSubatoms/.test(
      app,
    ) &&
    /WORK_AMO_V6_STATIC_AUTHORIZATION_KEYS[\s\S]*"unitFaceProofs"[\s\S]*"anchorSignature"/.test(
      app,
    ) &&
    /WORK_AMO_V8_STATIC_AUTHORIZATION_KEYS\s*=\s*\[[\s\S]*\.\.\.WORK_AMO_V6_STATIC_AUTHORIZATION_KEYS,[\s\S]*"blockSequencerModel"/.test(
      app,
    ) &&
    /blockSequencerModel: v8Authorization[\s\S]*WORK_AMO_V8_BLOCK_SEQUENCER_MODEL/.test(
      app,
    ) &&
    /unitFaceProofs:[\s\S]*v6Authorization[\s\S]*workAmoV6FaceProofsAllowed[\s\S]*v8Authorization[\s\S]*workAmoV8FaceProofsAllowed/.test(
      app,
    ) &&
    /workAmoAllowedFaceProofs\.map/.test(tokenWalletWorkspaceBlock) &&
    /const workAmoAllowedFaceProofs = workAmoV8TermsVisible[\s\S]*WORK_AMO_V8_ALLOWED_FACE_PROOFS[\s\S]*WORK_AMO_V6_ALLOWED_FACE_PROOFS/.test(
      tokenWalletWorkspaceBlock,
    ) &&
    /WORK_AMO_V8_ALLOWED_FACE_PROOFS\s*=\s*\[25_000\]\s*as const/.test(app) &&
    /USD is display-only/.test(tokenWalletWorkspaceBlock) &&
    /workEstimate = workAmoEstimateForFace\([\s\S]*unitFaceProofs:\s*workListing[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_SUBATOM_VERSION/.test(
      listTokenSource,
    ) &&
    /const estimate =\s*listing\.confirmed !== true\s*&&\s*rawEstimate/.test(
      app,
    ) &&
    /const freshAdmission = await freshWorkWriteMode\(\)[\s\S]*preparedWorkListingMode = freshAdmission\.mode[\s\S]*workV8Listing = preparedWorkListingMode === "native-q16"[\s\S]*version: workListing[\s\S]*workV8Listing[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_SUBATOM_VERSION[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_PROOF_UNIT_VERSION[\s\S]*beforeBroadcast:[\s\S]*freshWorkWriteMode\(preparedWorkListingMode\)/.test(
      listTokenSource,
    ) &&
    /selectedListTokenIsWork\s*\?\s*\([\s\S]*work-amo-face-selector[\s\S]*\)\s*:\s*\([\s\S]*Amount[\s\S]*Price proofs/.test(
      tokenWalletWorkspaceBlock,
    ),
);
expect(
  "confirmed AMO terms freeze without repricing and only the active protocol era can settle",
  /WORK_AMO_V1_FACE_USD_CENTS\s*=\s*\[\s*1000,\s*2000,\s*5000,\s*10000,\s*20000,\s*50000,\s*100000,\s*200000,\s*500000,\s*1000000,[\s\S]*function workAmoHistoricalFaceUsdCents[\s\S]*WORK_AMO_V1_FACE_USD_CENTS\.some/.test(
    app,
  ) &&
    /function workAmoFrozenTerms[\s\S]*grandfatheredV4[\s\S]*TOKEN_SALE_AUTH_WORK_CONFIRMATION_FLOOR_VERSION[\s\S]*grandfatheredV4ProjectionComplete[\s\S]*frozen\.canonical === true[\s\S]*frozen\.confirmed === true[\s\S]*frozen\.valid === true[\s\S]*WORK_AMO_V1_ACTIVATION_HEIGHT[\s\S]*WORK_AMO_V5_ACTIVATION_HEIGHT/.test(
      app,
    ) &&
    /function workAmoV6FrozenProjection[\s\S]*WORK_AMO_V6_FROZEN_TERM_KEYS[\s\S]*unitFaceProofs[\s\S]*listingProtocolVout[\s\S]*listingRecordOrdinal[\s\S]*networkValueAfterQ8 !==[\s\S]*networkValueBeforeQ8 \+ listingBondContributionQ8[\s\S]*workAmoV6UnitTerms\([\s\S]*amountAtoms\.toString\(\) !== expected\.unitAmountAtoms[\s\S]*priceSats\.toString\(\) !== expected\.unitPriceSats/.test(
      app,
    ) &&
    /function workAmoV8FrozenProjection[\s\S]*WORK_AMO_V8_FROZEN_TERM_KEYS[\s\S]*unitAmountSubatoms[\s\S]*workAmoV8UnitTerms\([\s\S]*listingAmountSubatoms !== amountSubatoms[\s\S]*!Number\.isSafeInteger\(listingPriceSats\)/.test(
      app,
    ) &&
    /function workAmoListingFaceProofs[\s\S]*const v8 =[\s\S]*workAmoV8FaceProofsAllowed\(rawFace\)[\s\S]*workAmoV6FaceProofsAllowed\(rawFace\)/.test(
      app,
    ) &&
    /function workAmoV6FrozenProjection[\s\S]*!workAmoV6FaceProofsAllowed\(faceProofs\)/.test(
      app,
    ) &&
    /function workAmoV8FrozenProjection[\s\S]*!workAmoV8FaceProofsAllowed\(faceProofs\)/.test(
      app,
    ) &&
    /function confirmWorkAmoEstimateListing[\s\S]*workAmoProofFaceLabel\(faceProofs\)/.test(
      app,
    ) &&
    /function confirmWorkAmoFrozenAction[\s\S]*workAmoProofFaceLabel\(frozen\.faceProofs\)/.test(
      app,
    ) &&
    /function workAmoFrozenTerms[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_SUBATOM_VERSION[\s\S]*workAmoV8FrozenProjection\(listing\)[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_PROOF_UNIT_VERSION[\s\S]*workAmoV6FrozenProjection\(listing\)[\s\S]*amountAtoms \* WORK_LEGACY_TO_CANONICAL_FACTOR/.test(
      app,
    ) &&
    /const v5ProjectionComplete =[\s\S]*WORK_AMO_UNIT_MODEL[\s\S]*WORK_AMO_STATE_ORDER_MODEL[\s\S]*unitUsdQuoteTxid[\s\S]*listingBlockHeight[\s\S]*frozenNetworkValueAfterQ8 ===[\s\S]*frozenNetworkValueBeforeQ8 \+ frozenListingBondContributionQ8/.test(
      app,
    ) &&
    /function workAmoStaticAuthorizationForListing[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_PROOF_UNIT_VERSION[\s\S]*unitFaceProofs:\s*faceProofs[\s\S]*WORK_AMO_V6_UNIT_MODEL[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_UNIT_VERSION/.test(
      app,
    ) &&
    /const freshAdmission = await freshWorkWriteMode\(\)[\s\S]*preparedWorkSettlementMode = freshAdmission\.mode[\s\S]*assertWorkAmoSettlementEnabled\(freshAdmission\.quote\)/.test(
      sealTokenListingSource,
    ) &&
    /assertWorkAmoListingWriteEra\([\s\S]*listing,[\s\S]*preparedWorkSettlementMode/.test(
      sealTokenListingSource,
    ) &&
    /workAmoStaticAuthorizationForListing\(listing\)/.test(
      sealTokenListingSource,
    ) &&
    /confirmWorkAmoFrozenAction\("seal", listing\)/.test(
      sealTokenListingSource,
    ) &&
    /buildPaymentPsbt\(\{[\s\S]*excludeOutpoints:\s*activeTokenListingAnchorOutpointsForAddress\([\s\S]*amountSats:\s*TOKEN_MIN_MUTATION_PRICE_SATS[\s\S]*protocolPayloads:\s*\[payload\]/.test(
      sealTokenListingSource,
    ) &&
    !/anchorSpendMode:\s*"wallet"/.test(sealTokenListingSource) &&
    !/signInputIndexes:\s*paymentPsbt\.walletInputIndexes/.test(
      sealTokenListingSource,
    ) &&
    /signAndBroadcastPsbt\(\{[\s\S]*signingAddress:\s*address/.test(
      sealTokenListingSource,
    ) &&
    /const freshAdmission = await freshWorkWriteMode\(\)[\s\S]*preparedWorkSettlementMode = freshAdmission\.mode[\s\S]*assertWorkAmoSettlementEnabled\(freshAdmission\.quote\)/.test(
      buyTokenListingSource,
    ) &&
    /assertWorkAmoListingWriteEra\([\s\S]*listing,[\s\S]*preparedWorkSettlementMode/.test(
      buyTokenListingSource,
    ) &&
    /tokenSellerPaymentRequiredSats\(listing\)/.test(
      buyTokenListingSource,
    ) &&
    /const purchaseAuthorization = isWorkToken\(listing\)[\s\S]*workAmoStaticAuthorizationForListing\(listing\)[\s\S]*buildTokenBuyPayload\(\s*listing\.listingId,\s*address,\s*purchaseAuthorization/.test(
      buyTokenListingSource,
    ) &&
    /confirmWorkAmoFrozenAction\("purchase", listing\)/.test(
      buyTokenListingSource,
    ) &&
    /freshWorkWriteMode\(\)[\s\S]*assertWorkAmoSettlementEnabled\(freshAdmission\.quote\)[\s\S]*assertWorkAmoListingWriteEra\([\s\S]*allowLegacyWithoutFrozen: true[\s\S]*beforeBroadcast/.test(
      delistTokenListingSource,
    ) &&
    [sealTokenListingSource, buyTokenListingSource, delistTokenListingSource].every(
      (source) =>
        /beforeBroadcast:[\s\S]*freshWorkWriteMode\([\s\S]*preparedWorkSettlementMode/.test(
          source,
        ),
    ),
);
expect(
  "AMO sale-ticket action labels prioritize seal state before WORK terms",
  /const listingIsWork = isWorkToken\(listing\)/.test(
    tokenMarketplaceBookBlock,
  ) &&
    /const buyLabel = !address[\s\S]*listingIsWork && !workReadEraReady[\s\S]*!hasSeal[\s\S]*"Needs seal"[\s\S]*sealPending[\s\S]*"Seal pending"[\s\S]*listingIsWork && !workAmoProtocolWritesEnabled[\s\S]*listingIsWork && !workFrozen[\s\S]*"Terms unavailable"[\s\S]*: "Buy"/.test(
      tokenMarketplaceBookBlock,
    ) &&
    /const buyDisabled =[\s\S]*!address[\s\S]*!sealConfirmed/.test(
      tokenMarketplaceBookBlock,
    ) &&
    !/Frozen terms unavailable/.test(app),
);
expect(
  "WORK AMO seller payment helper coerces frozen price and sale-ticket sats numerically",
  /function tokenSellerPaymentRequiredSats[\s\S]*workAmoFrozenTerms\(listing\)\?\.priceSats[\s\S]*Number\(\s*frozenPriceSats \?\? listing\.priceSats\s*\)[\s\S]*Number\(listing\.saleAuthorization\.anchorValueSats\)[\s\S]*return priceSats \+ anchorValueSats/.test(
    app,
  ),
);
expect(
  "AMO V6 remains exact Q8 while V8 derives exact Q16 subatoms without a USD oracle",
  /function workAmoV6UnitTerms[\s\S]*WORK_AMO_V6_ATOMS_PER_WORK[\s\S]*100_000_000n[\s\S]*const amountAtoms = \(BigInt\(face\) \* valueDenominator\) \/ networkValue[\s\S]*amountAtoms \* networkValue \+ valueDenominator - 1n/.test(
    workAmoV6ProofUnitSource,
  ) &&
    /function workAmoV8UnitTerms[\s\S]*WORK_AMO_V8_SUBATOMS_PER_WORK[\s\S]*100_000_000n[\s\S]*const amountSubatoms =[\s\S]*\(BigInt\(face\) \* valueDenominator\) \/ networkValue[\s\S]*amountSubatoms \* networkValue \+ valueDenominator - 1n/.test(
      workAmoV6ProofUnitSource,
    ) &&
    !/\/api\/v1\/work-amo-v6\/attestation/.test(app) &&
    !/\/api\/v1\/work-amo-v8\/attestation/.test(app) &&
    !/WorkUsdAttestation|unitUsdAttestation|WORK_AMO_V6_USD_ORACLE_MODEL|WORK_AMO_V6_ORACLE_SOURCE_IDS|fetchWorkAmoV6Attestation/.test(
      app,
    ) &&
    !/btcUsd/.test(listTokenSource) &&
    !/btcUsd/.test(canListTokenSource),
);
expect(
  "WORK transfer UI writes send3 only under V8 admission and never falls back after activation",
  /const TOKEN_SEND_ATOMS_ACTION = "send2"/.test(app) &&
    /const TOKEN_SEND_SUBATOMS_ACTION = "send3"/.test(app) &&
    /function buildTokenSendPayload[\s\S]*workWriteMode === "paused"[\s\S]*No legacy send2 fallback is permitted[\s\S]*workWriteMode === "native-q16"[\s\S]*TOKEN_SEND_SUBATOMS_ACTION[\s\S]*amountSubatoms\.toString\(\)[\s\S]*workLegacyAtomsFromSubatoms\(amountSubatoms\)[\s\S]*TOKEN_SEND_ATOMS_ACTION/.test(
      app,
    ) &&
    /parts\[0\] === TOKEN_SEND_ATOMS_ACTION[\s\S]*workSubatomsFromLegacyAtoms\(parts\[2\]\)[\s\S]*amountVersion: TOKEN_SEND_ATOMS_ACTION[\s\S]*parts\[0\] === TOKEN_SEND_SUBATOMS_ACTION[\s\S]*workSubatomsFromCanonicalString\(parts\[2\]\)[\s\S]*amountVersion: TOKEN_SEND_SUBATOMS_ACTION/.test(
      app,
    ) &&
    /function normalizeTokenAmountRecord[\s\S]*amountVersion === TOKEN_SEND_SUBATOMS_ACTION[\s\S]*"native-q16"[\s\S]*amountVersion === TOKEN_SEND_ATOMS_ACTION[\s\S]*"legacy-q8"/.test(
      app,
    ) &&
    /function buildTokenSendPayload\([\s\S]*workWriteMode: WorkWriteMode = "paused"/.test(
      app,
    ) &&
    /async function transferToken[\s\S]*const freshAdmission = await freshWorkWriteMode\(\)[\s\S]*preparedWorkMode = freshAdmission\.mode[\s\S]*beforeBroadcast:[\s\S]*freshWorkWriteMode\(preparedWorkMode\)/.test(
      app,
    ) &&
    /async function sendOpReturn[\s\S]*preparedWorkAttachmentMode =[\s\S]*await freshWorkWriteMode\(\)[\s\S]*beforeBroadcast:[\s\S]*freshWorkWriteMode\(preparedWorkAttachmentMode\)/.test(
      app,
    ) &&
    /async function createInfinityBond[\s\S]*preparedBondWorkMode = \(await freshWorkWriteMode\(\)\)\.mode[\s\S]*beforeBroadcast:[\s\S]*freshWorkWriteMode\(preparedBondWorkMode\)/.test(
      app,
    ),
);
expect(
  "WORK mint UI pauses every single and chained entry point when V8 admission is unknown or not ready",
  /function assertWorkMintWriteEnabled[\s\S]*isWorkToken\(token\)[\s\S]*workWriteModeForQuote\(quote\) === "paused"[\s\S]*No mint transaction was created/u.test(
    app,
  ) &&
    /const tokenMintPayload = useMemo\([\s\S]*workWriteModeForQuote\(workFloorQuote\) === "paused"[\s\S]*isWorkToken\(selectedToken\)[\s\S]*\? ""[\s\S]*buildTokenMintPayload/u.test(
      app,
    ) &&
    /const canMintToken =[\s\S]*!isWorkToken\(selectedToken\) \|\|[\s\S]*workWriteModeForQuote\(workFloorQuote\) !== "paused"[\s\S]*tokenMintPayload/u.test(
      app,
    ) &&
    /async function runTokenChainedMint[\s\S]*assertGenericTokenMintTarget\(token\);[\s\S]*assertWorkMintWriteEnabled\(token, workFloorQuote\);[\s\S]*buildTokenMintPayload/u.test(
      app,
    ) &&
    /async function runTokenChainedMint[\s\S]*const preparedWorkMintMode = workMint[\s\S]*await freshWorkWriteMode\(\)[\s\S]*beforeBroadcast:[\s\S]*freshWorkWriteMode\(preparedWorkMintMode\)/u.test(
      app,
    ) &&
    /async function mintToken\([\s\S]*assertWorkMintWriteEnabled\(mintTarget, workFloorQuote\);[\s\S]*WORK precision writes are paused/u.test(
      app,
    ),
);
expect(
  "Q16 scale is exclusive to canonical WORK while generic credits remain whole-unit",
  /function workTokenAmountScale\(token: unknown\): bigint \{[\s\S]*isWorkToken\(token as any\) \? WORK_AMO_UNIT_SCALE_BIGINT : 1n/.test(
    app,
  ) &&
    /function tokenUnitPriceSats[\s\S]*workTokenAmountScale\(token\)/.test(
      app,
    ),
);
expect(
  "native V8 listings prefer subatoms while historical listings normalize by exact multiplication",
  /const workNativeQ16Listing =[\s\S]*TOKEN_SALE_AUTH_WORK_AMO_SUBATOM_VERSION[\s\S]*frozenTerms\?\.version/.test(
    app,
  ) &&
    /function normalizeTokenListingRecord[\s\S]*workNativeQ16Listing[\s\S]*\? undefined[\s\S]*frozenTerms\?\.unitAmountAtoms/.test(
      app,
    ) &&
    /amountAtoms:[\s\S]*workAmountSubatoms !== null && workNativeQ16Listing[\s\S]*\? undefined[\s\S]*: listing\.amountAtoms/.test(
      app,
    ) &&
    /function workAmoV8FrozenProjection[\s\S]*listingAmountSubatoms !== amountSubatoms[\s\S]*!Number\.isSafeInteger\(listingPriceSats\)/.test(
      app,
    ) &&
    !/String\(listing\.amountAtoms \?\? ""\) !== ""/.test(app) &&
    /function workAmoFrozenTerms[\s\S]*amountAtoms \* WORK_LEGACY_TO_CANONICAL_FACTOR/.test(
      app,
    ),
);

expect(
  "historical V5 quote sequences remain exact while proof-native V6 and V8 have no manual publication path",
  /type WorkAmoV5FrozenTerms[\s\S]*unitUsdQuoteSequence\?: string;/.test(
    app,
  ) &&
    /type WorkAmoV5QuoteHead[\s\S]*sequence\?: string;/.test(app) &&
    /type WorkAmoV5QuotePublication[\s\S]*nextSequence\?: string;[\s\S]*ready\?: boolean;/.test(
      app,
    ) &&
    /function canonicalPositiveIntegerText[\s\S]*typeof value !== "string"[\s\S]*canonical === value && canonical !== "0"/.test(
      app,
    ) &&
    /function workAmoFrozenTerms[\s\S]*canonicalPositiveIntegerText\(\s*frozen\?\.unitUsdQuoteSequence[\s\S]*Boolean\(frozenUsdQuoteSequence\)/.test(
      app,
    ) &&
    !/Number\(\s*frozen\.unitUsdQuoteSequence\s*\)/u.test(app) &&
    /quoteHead:[\s\S]*canonicalPositiveIntegerText\(\s*payload\.workAmoV5\.quoteHead\.sequence[\s\S]*quotePublication:[\s\S]*canonicalPositiveIntegerText\(\s*payload\.workAmoV5\.quotePublication\.nextSequence/.test(
      app,
    ) &&
    !/async function publishWorkAmoUsdQuote/.test(app) &&
    !/workAmoQuotePublicationIsReady/.test(app) &&
    /Proof-native AMO write gate[\s\S]*No USD oracle, signed price attestation, or recurring[\s\S]*on-chain price publication is required/.test(
      app,
    ),
);
expect(
  "all ProofOfWork sale-ticket anchors are freshly excluded from funding selection",
  /async function fetchFreshWalletTokenListingsForAnchors[\s\S]*fresh: "1"[\s\S]*wallet: "1"[\s\S]*authoritativeWallet !== true[\s\S]*walletScoped !== true[\s\S]*Array\.isArray\(payload\.listings\)[\s\S]*options\.allowCurrentFallback[\s\S]*wallet: "1"[\s\S]*payload\.walletScoped === true[\s\S]*Array\.isArray\(payload\.listings\)/.test(
    app,
  ) &&
    /async function fetchFreshProofOfWorkListingAnchorOutpoints[\s\S]*allowCurrentTokenFallback[\s\S]*\["", WORK_TOKEN_ID, POWB_TOKEN_ID, INCB_TOKEN_ID\][\s\S]*fetchIdRegistryState\(network, true\)[\s\S]*fetchFreshWalletTokenListingsForAnchors[\s\S]*allowCurrentFallback:[\s\S]*options\.allowCurrentTokenFallback[\s\S]*tokenScope === POWB_TOKEN_ID \|\| tokenScope === INCB_TOKEN_ID[\s\S]*activeListingAnchorOutpointsForAddress[\s\S]*activeTokenListingAnchorOutpointsForAddress[\s\S]*No transaction was created/.test(
      app,
    ) &&
    /fetchFreshProofOfWorkListingAnchorOutpoints/.test(
      chooseSellerAnchorPlanBlock,
    ) &&
    /fetchFreshProofOfWorkListingAnchorOutpoints[\s\S]*mergeListingAnchorOutpoints\(\s*excludeOutpoints \?\? \[\],[\s\S]*reservedListingAnchors/.test(
      selectChainedInitialInputsBlock,
    ) &&
    /fetchFreshProofOfWorkListingAnchorOutpoints[\s\S]*mergeListingAnchorOutpoints\(\s*excludeOutpoints \?\? \[\],[\s\S]*reservedListingAnchors/.test(
      buildPaymentPsbtBlock,
    ) &&
    /fetchFreshProofOfWorkListingAnchorOutpoints[\s\S]*mergeListingAnchorOutpoints\(\s*excludeOutpoints \?\? \[\],[\s\S]*reservedListingAnchors,[\s\S]*anchor\.txid/.test(
      buildAnchoredMarketplacePsbtBlock,
    ),
);
expect(
  "transfer-lane preparation accepts UniSat wallet UTXO shapes but never raw API fallback",
  /utxo\.value[\s\S]*utxo\.satoshis[\s\S]*utxo\.satoshi[\s\S]*utxo\.amount/.test(
    walletUtxoPolicy,
  ) &&
    /utxo\.height \?\? utxo\.blockHeight \?\? utxo\.block_height/.test(
      walletUtxoPolicy,
    ) &&
    /Number\.isSafeInteger\(blockHeight\) && blockHeight > 0/.test(
      walletUtxoPolicy,
    ) &&
    /window\.unisat\?\.getBitcoinUtxos[\s\S]*\? "wallet-curated"[\s\S]*: "wallet-generic"/.test(
      app,
    ) &&
    /walletUtxoSource === "wallet-curated"[\s\S]*walletUtxos\.length > 0[\s\S]*walletUtxos\.every[\s\S]*return walletUtxos[\s\S]*const statusEvidence = await fetchAddressApiUtxos\([\s\S]*walletUtxos\.length === 0[\s\S]*return statusEvidence\.length > 0 \? statusEvidence : walletUtxos[\s\S]*return enrichWalletCuratedUtxoConfirmations\(\s*walletUtxos,\s*statusEvidence/.test(
      app,
    ) &&
    /hasAttachedWalletAssets\(utxo\.inscriptions\)[\s\S]*hasAttachedWalletAssets\(utxo\.atomicals\)/.test(
      walletUtxoPolicy,
    ) &&
    /function enrichWalletCuratedUtxoConfirmations[\s\S]*statusEvidence\.flatMap[\s\S]*`\$\{utxo\.txid\}:\$\{utxo\.vout\}`[\s\S]*utxo\.source !== "wallet-curated"[\s\S]*typeof utxo\.status\?\.confirmed === "boolean"[\s\S]*typeof confirmed !== "boolean"/.test(
      walletUtxoPolicy,
    ) &&
    /async function prepareTokenTransferUtxos[\s\S]*requireConfirmedUtxos: true,[\s\S]*requireWalletUtxos: true/.test(
      app,
    ) &&
    /requireWalletUtxos &&[\s\S]*utxo\.source !== "wallet-curated"[\s\S]*stopped before signing/.test(
      buildPaymentPsbtBlock,
    ) &&
    /Generic wallet outputs are shown only; preparation remains disabled/.test(
      app,
    ),
);
expect(
  "wallet proof summaries separate full-node total from UniSat-spendable protected outputs",
  /const \[accountChainUtxos,[\s\S]*setAccountChainUtxos\] = useState<MempoolUtxo\[]>/.test(
    app,
  ) &&
    /fetchAddressApiUtxos\(address,\s*network\)[\s\S]*setAccountChainUtxos\(utxos\)[\s\S]*setAccountChainUtxosLoaded\(true\)/.test(
      app,
    ) &&
    /connectedWalletProofFundingContext[\s\S]*accountChainUtxosLoaded && !accountChainUtxosError[\s\S]*connectedWalletChainProofAvailability\.confirmedBalanceSats[\s\S]*connectedWalletProofAvailability\.spendableSats/.test(
      app,
    ) &&
    /label: "total confirmed"[\s\S]*label: "spendable proofs"[\s\S]*label: "protected proofs"/.test(
      app,
    ) &&
    /function proofFundingErrorMessage[\s\S]*wallet-spendable proofs are available[\s\S]*protected or unavailable in UniSat[\s\S]*No protected output was selected/.test(
      app,
    ) &&
    /proofFundingErrorMessage\([\s\S]*"Credit purchase failed\.",[\s\S]*connectedWalletProofFundingContext/.test(
      app,
    ),
);
expect(
  "proofs-only Mail keeps funding fast while credit-bearing sends stay strict",
  /type ListingAnchorReadMode = "strict" \| "current-token-fallback"/.test(
    app,
  ) &&
    /listingAnchorReadMode:\s*attachedWorkPayloads\.length > 0[\s\S]*\? "strict"[\s\S]*: "current-token-fallback"/.test(
      app,
    ) &&
    /allowCurrentTokenFallback:[\s\S]*listingAnchorReadMode === "current-token-fallback"/.test(
      buildPaymentPsbtBlock,
    ) &&
    /prefetchedWalletUtxos:\s*accountUtxosLoaded \? accountUtxos : undefined/.test(
      app,
    ),
);
const officialUnisatUtxoTxid = "ab".repeat(32);
const officialUnisatUtxoFixture = {
  addressType: 1,
  atomicals: [],
  inscriptions: [],
  pubkey: `02${"11".repeat(32)}`,
  satoshis: 1_546,
  scriptPk: `5120${"22".repeat(32)}`,
  txid: officialUnisatUtxoTxid,
  vout: 2,
};
const normalizedOfficialUnisatUtxos = normalizeWalletUtxos(
  [
    officialUnisatUtxoFixture,
    {
      ...officialUnisatUtxoFixture,
      satoshis: 2_546,
      vout: 3,
    },
  ],
  "wallet-curated",
);
const confirmedOfficialUnisatEvidence = normalizeWalletUtxos(
  [
    {
      confirmed: true,
      txid: officialUnisatUtxoTxid.toUpperCase(),
      value: 1_546,
      vout: 2,
    },
    {
      confirmed: false,
      txid: officialUnisatUtxoTxid,
      value: 2_546,
      vout: 3,
    },
  ],
  "api",
);
const enrichedOfficialUnisatUtxos = enrichWalletCuratedUtxoConfirmations(
  normalizedOfficialUnisatUtxos,
  confirmedOfficialUnisatEvidence,
);
const unresolvedOfficialUnisatUtxos = enrichWalletCuratedUtxoConfirmations(
  normalizedOfficialUnisatUtxos,
  [],
);
const wrongOutpointOfficialUnisatUtxos =
  enrichWalletCuratedUtxoConfirmations(normalizedOfficialUnisatUtxos, [
    {
      source: "api",
      status: { confirmed: true },
      txid: officialUnisatUtxoTxid,
      value: 1_546,
      vout: 99,
    },
  ]);
const rejectedAssetBearingUnisatUtxos = normalizeWalletUtxos(
  [
    {
      ...officialUnisatUtxoFixture,
      inscriptions: [{ inscriptionId: "unsafe-inscription" }],
    },
    {
      ...officialUnisatUtxoFixture,
      atomicals: [{ atomicalId: "unsafe-atomical" }],
      vout: 4,
    },
  ],
  "wallet-curated",
);
expect(
  "official UniSat rows stay curated and use exact first-party outpoint evidence",
  normalizedOfficialUnisatUtxos.length === 2 &&
    normalizedOfficialUnisatUtxos.every(
      (utxo) =>
        utxo.source === "wallet-curated" &&
        typeof utxo.status?.confirmed !== "boolean",
    ) &&
    enrichedOfficialUnisatUtxos.find((utxo) => utxo.vout === 2)?.status
      ?.confirmed === true &&
    enrichedOfficialUnisatUtxos.find((utxo) => utxo.vout === 3)?.status
      ?.confirmed === false &&
    unresolvedOfficialUnisatUtxos.every(
      (utxo) =>
        utxo.source === "wallet-curated" &&
        utxo.status?.confirmed !== true,
    ) &&
    wrongOutpointOfficialUnisatUtxos.every(
      (utxo) => typeof utxo.status?.confirmed !== "boolean",
    ) &&
    rejectedAssetBearingUnisatUtxos.length === 0,
);
const smallestConfirmedLane = selectSmallestSingleConfirmedUtxo(
  [
    {
      source: "wallet-curated",
      status: { confirmed: true },
      txid: "01".repeat(32),
      value: 800,
      vout: 0,
    },
    {
      source: "wallet-curated",
      status: { confirmed: true },
      txid: "02".repeat(32),
      value: 900,
      vout: 0,
    },
    {
      source: "wallet-curated",
      status: { confirmed: true },
      txid: "03".repeat(32),
      value: 4_000,
      vout: 0,
    },
    {
      source: "api",
      status: { confirmed: true },
      txid: "04".repeat(32),
      value: 850,
      vout: 0,
    },
  ],
  546,
  1,
  100,
  43,
);
expect(
  "direct credit transfers prefer one smallest confirmed curated lane and retain normal fallback",
  /function selectSmallestSingleConfirmedUtxo[\s\S]*utxo\.status\?\.confirmed === true[\s\S]*utxo\.source === "wallet-curated"[\s\S]*left\.value - right\.value[\s\S]*return selectUtxos\(\s*\[candidate\],[\s\S]*return undefined/.test(
    walletUtxoPolicy,
  ) &&
    smallestConfirmedLane?.selected.length === 1 &&
    smallestConfirmedLane.selected[0].value === 900 &&
    /utxoSelectionStrategy === "smallest-single-confirmed"[\s\S]*selectSmallestSingleConfirmedUtxo\([\s\S]*\?\?[\s\S]*selectUtxos\(/.test(
      buildPaymentPsbtBlock,
    ) &&
    /activeTokenListingAnchorOutpointsForAddress\([\s\S]*requireConfirmedUtxos: true,[\s\S]*utxoSelectionStrategy: "smallest-single-confirmed"/.test(
      transferTokenSource,
    ) &&
    !/requireWalletUtxos/.test(transferTokenSource) &&
    /requireWalletUtxos &&[\s\S]*utxo\.source !== "wallet-curated"[\s\S]*raw node outputs cannot be selected/.test(
      buildPaymentPsbtBlock,
    ),
);
const walletSyncBlock =
  app.match(/const syncWallet = async \(\) => \{[\s\S]*?const handleWalletChange/)?.[0] ?? "";
expect(
  "wallet account and network events preserve the active Computer workspace",
  /walletSyncGenerationRef/.test(walletSyncBlock) &&
    /ensureWalletNetwork/.test(walletSyncBlock) &&
    !/setActiveFolder\(/.test(walletSyncBlock),
);
expect(
  "mobile Computer navigation is collapsed until explicitly opened",
  /className="sidebar-toggle"/.test(app) &&
    /aria-expanded=\{sidebarExpanded\}/.test(app) &&
    /\.sidebar:not\(\.is-expanded\) > \.folders/.test(css),
);
expect(
  "Proof API reads expose caller cancellation without losing timeout protection",
  /signal\?: AbortSignal/.test(proofApiClient) &&
    /options\.signal\?\.addEventListener\("abort"/.test(proofApiClient) &&
    /options\.signal\?\.removeEventListener\("abort"/.test(proofApiClient),
);
expect(
  "standalone Browser keeps the network selector in the form, not the shared topbar",
  /<BrowserNetworkTabs\s+network=\{network\}\s+onChange=\{setNetwork\}/.test(
    browserAppBlock,
  ) && !/<AppHeader[\s\S]*?onNetworkChange=\{setNetwork\}/.test(browserAppBlock),
);
const appStatusRow = contents.get("src/shared/components/AppStatusRow.tsx");
const appStatusRowUsages = app.match(/<AppStatusRow[\s\S]*?\/>/g) ?? [];
const featureStatusRowUsages = [
  ...(landingApp.match(/<AppStatusRow[\s\S]*?\/>/g) ?? []),
];
expect("App pages do not opt out of compact shared nav", !/domainNavCompact=\{false\}/.test(app));
expect("App pages do not duplicate the topbar class", !/className="topbar"/.test(app));
expect(
  "App imports the shared status row",
  /from "\.\/shared\/components\/AppStatusRow"/.test(app),
);
expect("shared status row component exists", /export function AppStatusRow/.test(appStatusRow));
expect(
  "status row markup is centralized",
  (appStatusRow.match(/status-dot/g) || []).length === 1 &&
    (app.match(/status-dot/g) || []).length === 0,
);
expect("routes use shared AppStatusRow", appStatusRowUsages.length >= 9);
expect(
  "App route status rows are persistent",
  appStatusRowUsages.every((usage) => /\bpersistent\b/.test(usage)),
);
expect(
  "feature route status rows are persistent",
  featureStatusRowUsages.length >= 1 &&
    featureStatusRowUsages.every((usage) => /\bpersistent\b/.test(usage)),
);
expect(
  "routes do not duplicate status class templates",
  !/className=\{`status /.test(app),
);
expect(
  "shared status row has fixed height",
  /--status-row-height:\s*38px/.test(css) &&
    /\.status\s*\{[\s\S]*height:\s*var\(--status-row-height\)[\s\S]*min-height:\s*var\(--status-row-height\)/.test(
      css,
    ),
);
expect(
  "route status rows stick under the shared topbar",
  /\.desktop-public-app\.has-route-status\s+\.app-header-stack\s*\+\s*\.desktop-route-status\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*var\(--topbar-height\)[\s\S]*z-index:\s*var\(--sticky-status-z\)/.test(
    css,
  ) &&
    /\.app-header-stack\.has-account-stats\s*\+\s*\.app-status-row\s*\{[\s\S]*top:\s*calc\(var\(--topbar-height\)\s*\+\s*44px\)/.test(
      css,
    ),
);
expect(
  "shared sticky chrome does not create desktop horizontal overflow",
  /box-sizing:\s*border-box/.test(cssBlock(".topbar")) &&
    /max-width:\s*100%/.test(cssBlock(".topbar")) &&
    /width:\s*100%/.test(cssBlock(".topbar")) &&
    /box-sizing:\s*border-box/.test(cssBlock(".app-status-row")) &&
    /max-width:\s*100%/.test(cssBlock(".app-status-row")),
);
const folderTypeBlock = app.match(/type Folder =[\s\S]*?;\n\nconst COMPUTER_ROUTE_FOLDERS/)?.[0] ?? "";
const computerFolderListBlock =
  app.match(/const COMPUTER_ROUTE_FOLDERS:[\s\S]*?\];/)?.[0] ?? "";
expect(
  "Computer global nav does not intercept standalone app links",
  !/onDomainNavigate=\{openComputerDomain\}/.test(app) &&
    !/function\s+openComputerDomain/.test(app) &&
    !/DOMAIN_NAV_TO_COMPUTER_FOLDER/.test(app),
);
expect(
  "standalone marketplace is not coerced into ID registry mode",
  /marketplaceMode/.test(app) && /activityMode/.test(app) && /growthMode/.test(app),
);
expect(
  "AMO UI preserves the active era, exact pre-V8 relics, and historical Marketplace V1",
  /aria-label="WORK AMO protocol view"/.test(app) &&
    /<span>AMO<\/span>/.test(app) &&
    /workV8BoundaryObserved \? "Pre-V8 Relics" : "V4 Relic"/.test(app) &&
    /<span>Marketplace V1 Relic<\/span>/.test(app) &&
    /<h3>Pre-V8 AMO Relics<\/h3>[\s\S]*cannot be sealed, purchased, or delisted/.test(
      app,
    ) &&
    /function workAmoPreV8RelicRows[\s\S]*canonical-work-amo-v8-preactivation-relic-cutover-v1[\s\S]*WORK_LEGACY_TO_CANONICAL_FACTOR/.test(
      app,
    ) &&
    /relicCutover:[\s\S]*indexReady === true[\s\S]*migrationReadiness\?\.marker\?\.relicCutover/.test(
      proofApi,
    ) &&
    /These WORK listings were disabled at activation height[\s\S]*new V8 unit is exactly 25,000 proofs[\s\S]*exact 16-decimal WORK/.test(
      app,
    ) &&
    !/Sellers may create new \$20, \$50, or \$100 AMO/.test(app) &&
    /<h3>WORK AMO State<\/h3>[\s\S]*single 25,000-proof face[\s\S]*exact 16-decimal WORK/.test(
      app,
    ),
);
expect(
  "Growth stays standalone and is not a Computer folder",
  !/\|\s*"growth"/.test(folderTypeBlock) &&
    !/"growth"/.test(computerFolderListBlock) &&
    !/activeFolder\s*===\s*"growth"/.test(app) &&
    !/openFolder\("growth"\)/.test(app),
);
expect(
  "Computer includes Infinity/POWB and Inception/INCB workspaces",
  /\|\s*"infinity"/.test(folderTypeBlock) &&
    /\|\s*"inception"/.test(folderTypeBlock) &&
    /"infinity"/.test(computerFolderListBlock) &&
    /"inception"/.test(computerFolderListBlock) &&
    /activeFolder\s*===\s*"infinity"/.test(app) &&
    /activeFolder\s*===\s*"inception"/.test(app) &&
    /openFolder\("infinity"\)/.test(app) &&
    /openFolder\("inception"\)/.test(app) &&
    /activeFolder === "infinity" \|\| activeFolder === "inception" \? \([\s\S]*<InfinityApp[\s\S]*\bembedded\b/.test(
      app,
    ),
);
const infinityAppBlock =
  app.match(/function InfinityApp[\s\S]*?function TokenWalletApp/)?.[0] ?? "";
expect(
  "Inception issues fixed INCB from the hash-bound H-1 live WORK summary across Q8 and Q16 transfer eras",
  /attachedWorkAmount\?: number/.test(app) &&
    /attachedWorkAmountAtoms\?: string/.test(app) &&
    /attachedWorkAmountSubatoms\?: string/.test(app) &&
    /attachedWorkAmountAtoms:\s*optionalStringValue\("attachedWorkAmountAtoms"\)/.test(
      app,
    ) &&
    /attachedWorkAmountSubatoms:\s*optionalStringValue\([\s\S]*"attachedWorkAmountSubatoms"/.test(
      app,
    ) &&
    /attachedWorkIssuanceUnits\?: ExactIntegerValue/.test(app) &&
    /attachedWorkLiveFloorAtSendSats\?: ExactDecimalValue/.test(app) &&
    /attachedWorkLiveValueAtSendSats\?: ExactDecimalValue/.test(app) &&
    /attachedWorkLiveValueAtSendQ8\?: string/.test(app) &&
    /confirmedIssuanceUnits\?: ExactIntegerValue/.test(app) &&
    /directProofIssuanceUnits\?: ExactIntegerValue/.test(app) &&
    /issuanceAccountingModel\?: string/.test(app) &&
    /issuanceCheckpointBlockHash\?: string/.test(app) &&
    /issuanceCheckpointBlockHeight\?: number/.test(app) &&
    /issuanceCheckpointBlockIndex\?: number/.test(app) &&
    /issuanceCheckpointMode\?: string/.test(app) &&
    /issuanceNetworkValueSats\?: ExactDecimalValue/.test(app) &&
    /issuanceNetworkValueQ8\?: string/.test(app) &&
    /issuanceValuationFixedAtSend\?: boolean/.test(app) &&
    /issuanceValueSnapshotBlockHash\?: string/.test(app) &&
    /issuanceValueSnapshotBlockHeight\?: number/.test(app) &&
    /issuanceValueSnapshotCanonicalSummaryHash\?: string/.test(app) &&
    /issuanceValueSnapshotGeneratedAt\?: string/.test(app) &&
    /issuanceValueSnapshotId\?: string/.test(app) &&
    /issuanceValueSnapshotMode\?: string/.test(app) &&
    /issuanceValueSnapshotModel\?: string/.test(app) &&
    /issuanceValueSnapshotWorkNetworkValueSats\?: ExactDecimalValue/.test(app) &&
    /issuanceValueSnapshotWorkNetworkValueQ8\?: string/.test(app) &&
    /liveNetworkValueSats\?: ExactDecimalValue/.test(app) &&
    /liveNetworkValueQ8\?: string/.test(app) &&
    /networkValueAccountingModel\?: string/.test(app) &&
    /inceptionAccounting = bondConfig\.folder === "inception"/.test(
      infinityAppBlock,
    ) &&
    /canonical-pre-bond-live-network-value-v2/.test(infinityAppBlock) &&
    /canonical-summary-h-minus-one-v1/.test(infinityAppBlock) &&
    /canonical-summary-refresh/.test(infinityAppBlock) &&
    /bond-transaction-provenance/.test(infinityAppBlock) &&
    /fixed-incb-issuance-plus-market-flow-v1/.test(infinityAppBlock) &&
    /issuanceValuationFixedAtSend === true/.test(infinityAppBlock) &&
    /workRecordAtoms\([\s\S]*attachedWorkAmount,[\s\S]*summary\?\.actualValue\.attachedWorkAmountAtoms,[\s\S]*summary\?\.actualValue\.attachedWorkAmountSubatoms/.test(
      infinityAppBlock,
    ) &&
    /attachedWorkAmountAtoms > 0n[\s\S]*attachedWorkAmountDisplay/.test(
      infinityAppBlock,
    ) &&
    !/Math\.floor\(attachedWorkAmount\)/.test(infinityAppBlock) &&
    /inceptionIssuanceAvailable/.test(infinityAppBlock) &&
    /"INCB floor"\s*:\s*"Bond floor"[\s\S]*"Inception network value"\s*:\s*"Network value"[\s\S]*<span>Floor USD<\/span>[\s\S]*<span>Network USD<\/span>/.test(
      infinityAppBlock,
    ) &&
    /"Fixed issued supply"\s*:\s*"Confirmed supply"/.test(
      infinityAppBlock,
    ) &&
    /const floorSats =\s*summary\?\.actualValue\.floorSats/.test(
      infinityAppBlock,
    ) &&
    /const networkValueSats =\s*summary\?\.actualValue\.networkValueSats/.test(
      infinityAppBlock,
    ) &&
    /Direct proof issuance/.test(infinityAppBlock) &&
    /Attached WORK issuance/.test(infinityAppBlock) &&
    /Total issued/.test(infinityAppBlock) &&
    /Fixed cumulative issuance value/.test(infinityAppBlock) &&
    /Weighted H-1 WORK floor/.test(infinityAppBlock) &&
    /Latest H-1 WORK network value/.test(infinityAppBlock) &&
    /Latest value snapshot block/.test(infinityAppBlock) &&
    /Latest bond block provenance/.test(infinityAppBlock) &&
    /Each bond is valued once[\s\S]*confirmed green live WORK summary at H-1/.test(
      infinityAppBlock,
    ) &&
    /Every transaction in that[\s\S]*bond block is excluded/.test(
      infinityAppBlock,
    ) &&
    /INCB network value equals fixed cumulative issuance value plus[\s\S]*confirmed INCB sale volume, transfer fees, and AMO[\s\S]*mutation fees/.test(
      infinityAppBlock,
    ) &&
    /Later WORK value changes do not reprice INCB/.test(
      infinityAppBlock,
    ) &&
    /exact previous block hash/.test(infinityAppBlock) &&
    !/Latest historical floor|Live INCB floor|Live Inception value|Live network USD/.test(
      infinityAppBlock,
    ) &&
    !/issuanceCheckpointWorkNetworkValueSats|send-time pre-transaction checkpoint|Attached WORK at confirmation|Frozen network value|Frozen INCB floor/.test(
      infinityAppBlock,
    ),
);
expect(
  "WORK miner fee cards disclose cumulative Bitcoin miner cost",
  (app.match(/Bitcoin miner fees paid/g) || []).length >= 2 &&
    /All-time cumulative Bitcoin transaction fees paid to miners across confirmed WORK transactions/.test(
      app,
    ) &&
    !/Credit miner fees/.test(app),
);
expect(
  "WORK client fallback attributes each Bitcoin miner fee once in frozen and live totals",
  /const creditMinerFeesByTxid = new Map<string, number>\(\)/.test(app) &&
    /const eventMinerFeeSatsOnce =/.test(app) &&
    /eventMinerFeeSatsOnce\(event, frozenMinerFeeTxids\)/.test(app) &&
    /eventMinerFeeSatsOnce\(event, liveMinerFeeTxids\)/.test(app) &&
    (app.match(/event\.attributedMinerFeeSats \?\? event\.minerFeeSats/g) || [])
      .length === 2,
);
const refreshWorkFloorBlock =
  app.match(
    /async function refreshWorkFloor\([\s\S]*?\n  async function refreshTokenMarketData/u,
  )?.[0] ?? "";
expect(
  "WORK floor refresh fails closed instead of synthesizing unverified livenet accounting",
  /fetchWorkFloorQuote\("livenet", fresh\)/.test(refreshWorkFloorBlock) &&
    /Verified WORK floor is unavailable/.test(refreshWorkFloorBlock) &&
    !/fetchIdRegistryState|fetchGlobalActivity|fetchTokenState|growthActualNetworkValue|growthActualValuePoints/.test(
      refreshWorkFloorBlock,
    ),
);
const workFloorChartBlock =
  app.match(
    /const WORK_FLOOR_LOG_SCALE_RATIO[\s\S]*?const INFINITY_BOND_CHART_OPTIONS/u,
  )?.[0] ?? "";
expect(
  "WORK floor chart switches to a disclosed logarithmic scale for extreme confirmed ranges",
  /WORK_FLOOR_LOG_SCALE_RATIO = 100/.test(workFloorChartBlock) &&
    /rawMin > 0 && rawMax \/ rawMin >= WORK_FLOOR_LOG_SCALE_RATIO/.test(
      workFloorChartBlock,
    ) &&
    /Math\.log10\(rawMin\)/.test(workFloorChartBlock) &&
    /mode: "logarithmic"/.test(workFloorChartBlock) &&
    /on a logarithmic scale/.test(workFloorChartBlock) &&
    /Price \/ WORK[\s\S]*\(log scale\)/.test(workFloorChartBlock),
);
expect(
  "WORK floor chart preserves a safe linear fallback",
  /mode: "linear"/.test(workFloorChartBlock) &&
    /ticks: \[domainMin, \(domainMin \+ domainMax\) \/ 2, domainMax\]/.test(
      workFloorChartBlock,
    ),
);
expect(
  "WORK floor chart keeps high-value ticks inside a wider compact-label gutter",
  /const padLeft = 112/.test(workFloorChartBlock) &&
    /growthCompactNumber\(value, 1\)/.test(workFloorChartBlock) &&
    /workFloorChartAxisPriceLabel\(tick, unit\)/.test(workFloorChartBlock) &&
    !/workFloorAxisPriceLabel\(tick, unit\)/.test(workFloorChartBlock),
);
expect(
  "livenet WORK and Growth normalizers preserve and require canonical miner-fee proof",
  /creditMinerFeeAccountingModel:\s*[\s\S]*payload\.creditMinerFeeAccountingModel/.test(
    app,
  ) &&
    /creditMinerFeeCoverage/.test(app) &&
    /WORK floor lacks complete canonical miner-fee and exact-Q8 accounting/.test(
      app,
    ) &&
    /Growth summary lacks complete canonical miner-fee and exact-Q8 accounting/.test(
      app,
    ),
);
expect(
  "Growth financial display has no local livenet accounting fallback",
  /const actualValue =\s*growthSummary\?\.actualValue \?\? workFloorQuote\?\.actualValue/.test(
    app,
  ) &&
    /Verified Growth ledger unavailable/.test(app) &&
    !/growthSummary\?\.actualValue \?\? computedActualValue/.test(app),
);
expect(
  "wallet standalone has explicit public alignment shell",
  /token-wallet-public-app/.test(app) && /token-wallet-workspace/.test(app),
);
expect(
  "desktop nav links collapse only through the shared compact breakpoint",
  !/\.domain-nav-links\s*\{[\s\S]*display:\s*none/.test(max1400Css) &&
    !/\.domain-nav-links\s*\{[\s\S]*display:\s*none/.test(max1180Css) &&
    !/domain-nav\.compact/.test(css),
);
expect(
  "desktop header does not squeeze full nav between breakpoints",
  !/@media\s*\(min-width:\s*1181px\)\s*and\s*\(max-width:\s*1280px\)[\s\S]*\.topbar/.test(
    css,
  ),
);
expect(
  "compact nav uses dropdown at the shared breakpoint",
  /\.domain-nav-links\s*\{[\s\S]*display:\s*none/.test(max1100Css) &&
    /\.app-menu-trigger\s*\{[\s\S]*display:\s*inline-flex/.test(max1100Css),
);
expect(
  "topbar is a single flex row and never creates a second nav row",
  /display:\s*flex/.test(cssBlock(".topbar")) &&
    !/grid-template-areas:/.test(cssBlock(".topbar")) &&
    !/grid-template-columns:/.test(cssBlock(".topbar")) &&
    !/\.topbar\s+\.domain-nav\s*\{[\s\S]*(grid-column:\s*1\s*\/\s*-1|grid-row:\s*2)/.test(
      max1100Css,
    ),
);
expect(
  "Computer marketplace uses a single scroll column",
  /\.marketplace-workspace \.marketplace-content[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(
    css,
  ),
);
expect(
  "AMO proof-face choices and proof-native status remain contained responsively",
  /work-amo-face-selector[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(
    css,
  ) &&
    /\.work-amo-quote-control\s*\{[\s\S]*min-width:\s*0[\s\S]*padding:\s*12px/.test(
      css,
    ) &&
    /\.work-amo-quote-control input,[\s\S]*max-width:\s*100%[\s\S]*min-width:\s*0/.test(
      css,
    ),
);
expect(
  "Computer WORK workspace shows loading state before ledger data arrives",
  /ledgerLoading/.test(app) &&
    /Loading \{detailToken\?\.ticker \?\? "credit"\} ledger/.test(app) &&
    /tokenLedgerLoading &&[\s\S]*compareExactIntegers\(workTokenLedger\.confirmedSupply, 0\) === 0[\s\S]*\?\s*"\.\.\."/.test(
      app,
    ),
);
expect(
  "WORK bootstraps from the compact summary and pages history",
  /async function fetchWorkSummary[\s\S]*\/api\/v1\/work-summary/.test(app) &&
    /const workSummaryRead =[\s\S]*fetchWorkSummary\(network,\s*fresh\)/.test(
      app,
    ) &&
    /fetchTokenHistoryPage<PowTokenMint>[\s\S]*"mints"/.test(app) &&
    /Loading current WORK summary from the ProofOfWork index/.test(app),
);
expect(
  "WORK renders structured floor fallback provenance independently of token fallback",
  /function workFloorLastGoodReference[\s\S]*indexedThroughBlock[\s\S]*snapshotId/.test(
    app,
  ) &&
    /function workFloorLastGoodStatusText[\s\S]*WORK exact-tip refresh did not produce a newer verified summary[\s\S]*Showing verified last-good[\s\S]*Pending mints, bonds, and transfers do not affect the confirmed WORK floor/.test(
      app,
    ) &&
    /catch \(error\)[\s\S]*fresh && lastGoodQuote[\s\S]*proofApiLastGoodReadStatus\([\s\S]*setWorkFloorLastGoodStatus\([\s\S]*structuredStatus \|\| workFloorLastGoodStatusText\(lastGoodQuote\)/.test(
      refreshWorkFloorBlock,
    ) &&
    /let tokenUsedIndexedFallback = false;[\s\S]*let floorUsedIndexedFallback = false;[\s\S]*const usedIndexedFallback =[\s\S]*tokenUsedIndexedFallback \|\| floorUsedIndexedFallback/.test(
      app,
    ) &&
    !/setWorkFloorUsingLastGood/.test(app) &&
    /workFloorLastGoodStatus \? \([\s\S]*<strong>\{workFloorLastGoodStatus\}<\/strong>/.test(
      app,
    ) &&
    /pending mints, bonds, and transfers wait for confirmation[\s\S]*do not affect the floor/.test(
      app,
    ),
);
expect(
  "WORK preserves scoped holder previews and canonical holder totals",
  /function tokenHolderMatchesDefinition[\s\S]*singleTokenScope/.test(app) &&
    /function tokenHoldersForDefinition[\s\S]*tokenHolderMatchesDefinition/.test(
      app,
    ) &&
    /const holderHistoryTotalHint = tokenHolderTotalCount/.test(app) &&
    /holderHistoryTotalHint > holderHistoryLocalCount/.test(app) &&
    /detailHolderTotalCount\.toLocaleString\(\)/.test(app) &&
    /detailHolders=\{tokenDetailHolders\}/.test(app) &&
    /holders=\{selectedTokenHolders\}/.test(app),
);
expect(
  "WORK uses wallet-scoped balances independently of the holder preview",
  (app.match(/walletBalances=\{accountWalletBalances\}/g) || []).length >= 2 &&
    /selectedWalletBalance\?\.confirmedBalance/.test(app) &&
    /detailWalletBalance\?\.confirmedBalance/.test(app),
);
expect(
  "WORK mint progress cannot round an incomplete supply to 100 percent",
  /function tokenProgressLabel[\s\S]*if \(progress >= 100\)[\s\S]*Math\.floor\(progress \* 1000\) \/ 1000/.test(
    app,
  ),
);
expect(
  "reserved bond credits cannot enter generic create or mint flows",
  /const creditFactoryTokenDefinitions = useMemo\([\s\S]*orderedTokenDefinitions\.filter\(\(token\) => !isBondTokenDefinition\(token\)\)/.test(
    app,
  ) &&
    /function buildTokenCreatePayload[\s\S]*tokenTickerReservationError\(ticker\)[\s\S]*No credit creation transaction was created/.test(
      app,
    ) &&
    /function buildTokenMintPayload[\s\S]*assertGenericTokenMintTarget[\s\S]*No mint transaction was created/.test(
      app,
    ) &&
    /async function runTokenChainedMint[\s\S]*assertGenericTokenMintTarget\(token\)/.test(
      app,
    ) &&
    /async function mintToken[\s\S]*mintTarget && isBondTokenDefinition\(mintTarget\)[\s\S]*No mint transaction was created/.test(
      app,
    ) &&
    /async function prepareTokenMintUtxos[\s\S]*isBondTokenDefinition\(selectedToken\)[\s\S]*No mint preparation transaction was created/.test(
      app,
    ) &&
    !/POWB_TOKEN_MAX_SUPPLY|INCB_TOKEN_MAX_SUPPLY/.test(app),
);
expect(
  "bond definitions preserve uncapped API semantics without generic mint progress",
  /maxSupply: number \| null;[\s\S]*maxSupplyModel\?: string;[\s\S]*uncapped\?: boolean;/.test(
    app,
  ) &&
    /function normalizeTokenDefinitionRecord[\s\S]*const uncapped =[\s\S]*maxSupply: uncapped \? null[\s\S]*maxSupplyModel: uncapped \? "uncapped"[\s\S]*uncapped,/.test(
      app,
    ) &&
    /function tokenMaxSupplyLabel[\s\S]*\? "Uncapped"/.test(app) &&
    /!tokenDefinitionIsUncapped\(token\) \? \([\s\S]*token\.ticker} mint progress/.test(
      app,
    ) &&
    /!detailUncapped \? \([\s\S]*className="token-progress-block"/.test(app),
);
expect(
  "mixed credit scopes preserve null aggregate supply and use per-credit totals",
  /confirmedSupply\?: ExactIntegerValue \| null;[\s\S]*pendingSupply\?: ExactIntegerValue \| null;/.test(
    app,
  ) &&
    /payload\?\.confirmedSupply === null[\s\S]*\? null[\s\S]*payload\?\.pendingSupply === null[\s\S]*\? null/.test(
      app,
    ) &&
    /const mixedTokenScope = tokens\.length > 1;[\s\S]*confirmedSupply: mixedTokenScope[\s\S]*\? null[\s\S]*pendingSupply: mixedTokenScope[\s\S]*\? null/.test(
      app,
    ) &&
    /const cachedSingleTokenLedger =[\s\S]*tokenLedgerFor\([\s\S]*confirmedSupply:[\s\S]*tokenDefinitions\.length > 1[\s\S]*\? null[\s\S]*cachedSingleTokenLedger\?\.confirmedSupply/.test(
      app,
    ),
);
expect(
  "WORK connected-wallet sync stays on the global compact summary",
  /const workWorkspace = workTokenMode \|\| activeFolder === "work"[\s\S]*const workSummary = workWorkspace[\s\S]*fetchWorkSummary\("livenet",\s*false\)[\s\S]*address:\s*workWorkspace \? "" :/.test(
    app,
  ),
);
expect(
  "Computer marketplace shows loading states before credit market data arrives",
  /tokenMarketLoading/.test(app) &&
    /Loading credit markets/.test(app) &&
    /Loading credit sale tickets/.test(app) &&
    /Loading credit market history/.test(app),
);
const normalizeTokenApiStateBlock =
  app.match(
    /function normalizeTokenApiState[\s\S]*?function isAuthoritativeWalletTokenPayload/,
  )?.[0] ?? "";
const tokenMarketplaceSummaryStatsBlock =
  app.match(
    /function tokenMarketplaceSummaryStats[\s\S]*?function TokenMarketplaceStatsGrid/,
  )?.[0] ?? "";
expect(
  "Marketplace preserves authoritative token summary metadata",
  /type PowTokenState = \{[\s\S]*collectionHasMore\?[\s\S]*stats\?: PowTokenSummaryStats[\s\S]*totalCounts\?/.test(
    app,
  ) &&
    /payload\?\.collectionHasMore/.test(normalizeTokenApiStateBlock) &&
    /payload\?\.stats/.test(normalizeTokenApiStateBlock) &&
    /payload\?\.totalCounts/.test(normalizeTokenApiStateBlock) &&
    /setTokenSummary\(tokenSummaryMetadata\(state\)\)/.test(app),
);
expect(
  "Marketplace credit history keeps one canonical page during refresh",
  /const tokenMarketLogViewKey = \[[\s\S]*TOKEN_LIST_PREVIEW_COUNT,[\s\S]*\]\.join\(":"\)/.test(
    app,
  ) &&
    /const tokenMarketLogRequestKey = \[[\s\S]*tokenMarketLogViewKey,[\s\S]*tokenMarketLogDataVersion,[\s\S]*tokenMarketHistoryRefreshNonce,[\s\S]*\]\.join\(":"\)/.test(
      app,
    ) &&
    /items: sortTokenMarketLogItems\(page\.items \?\? \[\]\)/.test(app) &&
    /current\?\.viewKey === tokenMarketLogViewKey \? current : undefined/.test(
      app,
    ) &&
    /tokenMarketLogRemotePageForView\([\s\S]*remoteTokenMarketLogPage,[\s\S]*tokenMarketLogViewKey/.test(
      app,
    ) &&
    !/remoteTokenMarketLogPage\?\.key === tokenMarketLogKey/.test(app),
);
expect(
  "Marketplace credit history normalizes and labels pending seals consistently",
  /kind === "market-log"[\s\S]*\.map\(normalizeTokenMarketLogItem\)/.test(
    app,
  ) &&
    /function tokenMarketListingStatusLabel[\s\S]*tokenListingHasConfirmedSaleTicketSeal[\s\S]*tokenListingHasPendingSaleTicketSeal[\s\S]*return listing\.confirmed \? "Waiting for seal" : "Pending listing"/.test(
      app,
    ) &&
    (app.match(/tokenMarketListingStatusLabel\(item\.listing\)/g)?.length ??
      0) === 2,
);
expect(
  "Marketplace aggregate cards use authoritative totals instead of compact previews",
  /function marketplaceStatsWithAuthoritativeSummary[\s\S]*authoritative\?\.confirmedSales[\s\S]*previewStats\.confirmedSales/.test(
    app,
  ) &&
    /function optionalMarketplaceMetric\(value: unknown\)[\s\S]*value === null[\s\S]*value === undefined[\s\S]*value === ""[\s\S]*return undefined/.test(
      app,
    ) &&
    /summary:\s*tokenSummary/.test(app) &&
    /scopedToken\.confirmedSales/.test(tokenMarketplaceSummaryStatsBlock) &&
    /summaryStats\?\.confirmedSalesVolumeSats/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /label: "Confirmed Sales"[\s\S]*marketStats\.confirmedSales/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /label: "Volume proofs"[\s\S]*marketStats\.confirmedVolumeSats/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    !/marketStats\.totalVolumeSats/.test(tokenMarketplaceSummaryStatsBlock),
);
expect(
  "Marketplace separates confirmed and pending listing totals",
  /confirmedOpenListings\?: number/.test(app) &&
    /pendingOpenListings\?: number/.test(app) &&
    /scopedToken\?\.confirmedOpenListings/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /scopedToken\?\.pendingOpenListings/.test(tokenMarketplaceSummaryStatsBlock) &&
    /function summedTokenMarketplaceCount[\s\S]*counts\.every\(\(count\) => count !== undefined\)/.test(
      app,
    ) &&
    /summedTokenMarketplaceCount\(networkTokens, "confirmedOpenListings"\)/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /summedTokenMarketplaceCount\(networkTokens, "pendingOpenListings"\)/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /networkConfirmedListings \?\?[\s\S]*previewConfirmedListings/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /networkPendingListings \?\?[\s\S]*totalOpenListings/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /totalOpenListings - confirmedListings/.test(
      tokenMarketplaceSummaryStatsBlock,
    ) &&
    /label: "Confirmed Listings"/.test(tokenMarketplaceSummaryStatsBlock) &&
    /label: "Pending Listings"/.test(tokenMarketplaceSummaryStatsBlock) &&
    !/label: "Active Listings"/.test(tokenMarketplaceSummaryStatsBlock),
);
expect(
  "Marketplace token cache tracks the current summary metadata",
  /acceptedTokenStatesRef\.current\.set\(tokenDataLoadedScopeKey,\s*\{[\s\S]*tokenSummaryMetadata\(tokenSummary\)/.test(
    app,
  ) &&
    /tokenSales,[\s\S]*tokenSummary,[\s\S]*tokenTransfers,[\s\S]*\]\);/.test(app),
);
expect("stale browser network tab CSS removed", !/browser-network-tabs/.test(css));

if (failures.length) {
  console.error("UI contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("UI contract check passed.");
