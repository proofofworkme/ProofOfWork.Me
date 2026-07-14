import { existsSync, readFileSync } from "node:fs";

const files = [
  "README.md",
  "SOUL.md",
  "MAIL_ORGANIZATION.md",
  "OP_RETURN_INFRASTRUCTURE.md",
  "PROOFOFWORK_GENERAL_DECK.md",
  "src/App.tsx",
  "src/app/appLinks.ts",
  "src/app/routeRegistry.ts",
  "src/features/landing/LandingApp.tsx",
  "src/features/landing/LandingRoot.tsx",
  "src/main.tsx",
  "src/features/rush/RushApp.tsx",
  "src/shared/api/proofApiClient.ts",
  "src/shared/components/AppHeader.tsx",
  "src/shared/components/AppStatusRow.tsx",
  "src/shared/components/BrowserNetworkTabs.tsx",
  "src/shared/components/DomainNav.tsx",
  "src/shared/components/HeaderActionsMenu.tsx",
  "src/shared/protocol/idRegistry.ts",
  "src/styles.css",
  "vite.config.ts",
];

const read = (path) => readFileSync(path, "utf8");
const contents = new Map(files.map((path) => [path, read(path)]));
const failures = [];

function expect(name, condition) {
  if (!condition) {
    failures.push(name);
  }
}

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
const max1400Css = cssMediaBlock("max-width: 1400px");
const max1180Css = cssMediaBlock("max-width: 1180px");
const max1100Css = cssMediaBlock("max-width: 1100px");
const topbarActionsBlock = cssBlock(".topbar-actions");
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
const proofApiClient = contents.get("src/shared/api/proofApiClient.ts");
const routeRegistry = contents.get("src/app/routeRegistry.ts");
expect(
  "Proof API errors preserve canonical error codes without raw JSON UI",
  /class ProofApiRequestError/.test(proofApiClient) &&
    /JSON\.parse\(responseText\)/.test(proofApiClient) &&
    /isTransientProofApiReadError/.test(proofApiClient) &&
    /CANONICAL_INDEX_UNAVAILABLE/.test(proofApiClient) &&
    /throw proofApiResponseError\(responseText, response\.status\)/.test(
      proofApiClient,
    ),
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
    /fetchTokenState\(\s*network,\s*false,\s*WORK_TOKEN_ID,\s*false,\s*\[address\],\s*true,?\s*\)/.test(
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
  "mail WORK attachments use allowlisted canonical senders",
  /WORK_ATTACHMENT_ALLOWED_SENDERS\s*=\s*new Set/.test(app) &&
    /1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT/.test(app) &&
    /1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x/.test(app) &&
    /1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv/.test(app) &&
    /\.map\(\(senderAddress\) => senderAddress\.toLowerCase\(\)\)/.test(app),
);
expect(
  "WORK attachment controls fall back to already-loaded route balances",
  /function bestKnownTokenWalletBalance[\s\S]*right\.confirmedBalance - left\.confirmedBalance/.test(
    app,
  ) &&
    /const composeAccountWorkWalletBalance = useMemo[\s\S]*const scopedAccountBalances = tokenWalletBalancesFor[\s\S]*const routeBalances = tokenWalletBalancesFor[\s\S]*bestKnownTokenWalletBalance/.test(
      app,
    ) &&
    /const accountWorkListings = accountWorkTokenLaneClean[\s\S]*accountWorkTokenState\.listings[\s\S]*accountAllTokenLaneClean[\s\S]*accountTokenState\.listings/.test(
      app,
    ) &&
    /const workAttachmentVisible =[\s\S]*workAttachmentSpendableBalance > 0/.test(
      app,
    ),
);
expect(
  "clean zero WORK lanes cannot fall through to stale route balances",
  /if \(accountWorkTokenLaneClean\) \{\s*return scopedAccountBalance;\s*\}[\s\S]*if \(accountAllTokenLaneClean\) \{\s*return globalAccountBalance;\s*\}[\s\S]*return bestKnownTokenWalletBalance/.test(
    app,
  ) &&
    !/accountWorkTokenLaneClean && scopedAccountBalance/.test(app) &&
    !/accountAllTokenLaneClean && globalAccountBalance/.test(app) &&
    /composeAccountWorkWalletBalance\?\.confirmedBalance \?\? 0/.test(app),
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
    /const walletTransferBalance =[\s\S]*walletOperationBalances\.find[\s\S]*const walletPendingTokenBalance =[\s\S]*walletOperationBalances\.find/.test(
      app,
    ) &&
    /Math\.floor\(tokenTransferAmount\) <= walletSpendableTokenBalance/.test(
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
  "pending WORK preflight preserves multi-recipient transfer multiplicity",
  /function tokenTransferSpendabilityKey\(transfer:[\s\S]*transfer\.txid[\s\S]*transfer\.tokenId[\s\S]*transfer\.senderAddress[\s\S]*transfer\.recipientAddress[\s\S]*transfer\.amount/.test(
    app,
  ) &&
    /function mergeTokenTransfersForSpendability\([\s\S]*groupedSources[\s\S]*confirmedSource[\s\S]*pendingSource[\s\S]*merged\.push/.test(
      app,
    ) &&
    /const pendingDirectTransfers = mergeTokenTransfersForSpendability\([\s\S]*state\.transfers,[\s\S]*localTransfers[\s\S]*transfer\.tokenId === token\.tokenId/.test(
      app,
    ) &&
    !/const transfersByTxid = new Map/.test(app),
);
expect(
  "approved bond WORK attachment stays visible while balance verification is pending",
  /const bondWorkAttachmentVisible = workAttachmentAllowed;/.test(app) &&
    /const bondWorkBalanceHasCleanLane =[\s\S]*accountWorkTokenLaneClean \|\| accountAllTokenLaneClean/.test(
      app,
    ) &&
    /const bondWorkBalanceLoaded =[\s\S]*accountTokenLaneStatuses\.work\.loaded \|\|[\s\S]*accountTokenLaneStatuses\.all\.loaded/.test(
      app,
    ) &&
    /const bondWorkBalanceError = bondWorkBalanceHasCleanLane[\s\S]*\? ""[\s\S]*accountTokenLaneStatuses\.work\.error \|\|[\s\S]*accountTokenLaneStatuses\.all\.error/.test(
      app,
    ) &&
    /const bondWorkAttachmentBalanceOk =[\s\S]*!bondWorkBalanceLoaded[\s\S]*Boolean\(bondWorkBalanceError\)/.test(
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
    /async function fetchFreshWalletTokenPreflightState[\s\S]*authoritativeWallet !== true[\s\S]*proof-indexer-wallet-token-overlay[\s\S]*isTransientProofApiReadError[\s\S]*No transaction was created/.test(
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
    /function tokenSpendabilityForWallet[\s\S]*confirmedBalance - reservedBalance - pendingOutgoing/.test(
      app,
    ) &&
    /Registry and miner fees are final once broadcast[\s\S]*not automatically refunded/.test(
      app,
    ),
);
expect(
  "Infinity and Inception bond composers attach canonical WORK",
  /const \[bondWorkAmount,\s*setBondWorkAmount\] = useState\(0\)/.test(app) &&
    /async function createInfinityBond[\s\S]*canAttachWorkToMessages\(address,\s*"livenet"\)/.test(
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
expect(
  "all ProofOfWork sale-ticket anchors are freshly excluded from funding selection",
  /async function fetchFreshWalletTokenListingsForAnchors[\s\S]*fresh: "1"[\s\S]*wallet: "1"[\s\S]*authoritativeWallet !== true[\s\S]*walletScoped !== true[\s\S]*Array\.isArray\(payload\.listings\)/.test(
    app,
  ) &&
    /async function fetchFreshProofOfWorkListingAnchorOutpoints[\s\S]*\["", WORK_TOKEN_ID, POWB_TOKEN_ID, INCB_TOKEN_ID\][\s\S]*fetchIdRegistryState\(network, true\)[\s\S]*fetchFreshWalletTokenListingsForAnchors[\s\S]*activeListingAnchorOutpointsForAddress[\s\S]*activeTokenListingAnchorOutpointsForAddress[\s\S]*No transaction was created/.test(
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
const rushApp = contents.get("src/features/rush/RushApp.tsx");
const appStatusRowUsages = app.match(/<AppStatusRow[\s\S]*?\/>/g) ?? [];
const featureStatusRowUsages = [
  ...(landingApp.match(/<AppStatusRow[\s\S]*?\/>/g) ?? []),
  ...(rushApp.match(/<AppStatusRow[\s\S]*?\/>/g) ?? []),
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
    (app.match(/status-dot/g) || []).length === 0 &&
    (rushApp.match(/status-dot/g) || []).length === 0,
);
expect("routes use shared AppStatusRow", appStatusRowUsages.length >= 9);
expect(
  "App route status rows are persistent",
  appStatusRowUsages.every((usage) => /\bpersistent\b/.test(usage)),
);
expect(
  "feature route status rows are persistent",
  featureStatusRowUsages.length >= 2 &&
    featureStatusRowUsages.every((usage) => /\bpersistent\b/.test(usage)),
);
expect(
  "routes do not duplicate status class templates",
  !/className=\{`status /.test(app) && !/className=\{`status /.test(rushApp),
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
  "Inception issues fixed INCB from the hash-bound H-1 live WORK summary",
  /attachedWorkAmount\?: number/.test(app) &&
    /attachedWorkIssuanceUnits\?: number/.test(app) &&
    /attachedWorkLiveFloorAtSendSats\?: number/.test(app) &&
    /attachedWorkLiveValueAtSendSats\?: number/.test(app) &&
    /confirmedIssuanceUnits\?: number/.test(app) &&
    /directProofIssuanceUnits\?: number/.test(app) &&
    /issuanceAccountingModel\?: string/.test(app) &&
    /issuanceCheckpointBlockHash\?: string/.test(app) &&
    /issuanceCheckpointBlockHeight\?: number/.test(app) &&
    /issuanceCheckpointBlockIndex\?: number/.test(app) &&
    /issuanceCheckpointMode\?: string/.test(app) &&
    /issuanceNetworkValueSats\?: number/.test(app) &&
    /issuanceValuationFixedAtSend\?: boolean/.test(app) &&
    /issuanceValueSnapshotBlockHash\?: string/.test(app) &&
    /issuanceValueSnapshotBlockHeight\?: number/.test(app) &&
    /issuanceValueSnapshotCanonicalSummaryHash\?: string/.test(app) &&
    /issuanceValueSnapshotGeneratedAt\?: string/.test(app) &&
    /issuanceValueSnapshotId\?: string/.test(app) &&
    /issuanceValueSnapshotMode\?: string/.test(app) &&
    /issuanceValueSnapshotModel\?: string/.test(app) &&
    /issuanceValueSnapshotWorkNetworkValueSats\?: number/.test(app) &&
    /liveNetworkValueSats\?: number/.test(app) &&
    /inceptionAccounting = bondConfig\.folder === "inception"/.test(
      infinityAppBlock,
    ) &&
    /canonical-pre-bond-live-network-value-v2/.test(infinityAppBlock) &&
    /canonical-summary-h-minus-one-v1/.test(infinityAppBlock) &&
    /canonical-summary-refresh/.test(infinityAppBlock) &&
    /bond-transaction-provenance/.test(infinityAppBlock) &&
    /issuanceValuationFixedAtSend === true/.test(infinityAppBlock) &&
    /inceptionIssuanceAvailable/.test(infinityAppBlock) &&
    /"Live INCB floor"\s*:\s*"Bond floor"[\s\S]*"Live Inception value"\s*:\s*"Network value"[\s\S]*"Live floor USD"\s*:\s*"Floor USD"[\s\S]*"Live network USD"\s*:\s*"Network USD"/.test(
      infinityAppBlock,
    ) &&
    /"Fixed issued supply"\s*:\s*"Confirmed supply"/.test(
      infinityAppBlock,
    ) &&
    /Direct proof issuance/.test(infinityAppBlock) &&
    /Attached WORK issuance/.test(infinityAppBlock) &&
    /Total issued/.test(infinityAppBlock) &&
    /Exact bond issuance value/.test(infinityAppBlock) &&
    /H-1 WORK floor/.test(infinityAppBlock) &&
    /H-1 WORK network value/.test(infinityAppBlock) &&
    /Value snapshot block/.test(infinityAppBlock) &&
    /Bond block provenance/.test(infinityAppBlock) &&
    /last confirmed green canonical live[\s\S]*WORK summary at H-1/.test(
      infinityAppBlock,
    ) &&
    /Every transaction in the bond block is[\s\S]*excluded/.test(
      infinityAppBlock,
    ) &&
    /current or post-bond network value changes only the live INCB floor/.test(
      infinityAppBlock,
    ) &&
    /exact previous block hash/.test(infinityAppBlock) &&
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
expect(
  "livenet WORK and Growth normalizers preserve and require canonical miner-fee proof",
  /creditMinerFeeAccountingModel:\s*[\s\S]*payload\.creditMinerFeeAccountingModel/.test(
    app,
  ) &&
    /creditMinerFeeCoverage/.test(app) &&
    /WORK floor lacks complete canonical Bitcoin miner-fee coverage/.test(app) &&
    /Growth summary lacks complete canonical Bitcoin miner-fee coverage/.test(app),
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
  "Computer WORK workspace shows loading state before ledger data arrives",
  /ledgerLoading/.test(app) &&
    /Loading \{detailToken\?\.ticker \?\? "credit"\} ledger/.test(app) &&
    /tokenLedgerLoading && workTokenLedger\.confirmedSupply === 0[\s\S]*\?\s*"\.\.\."/.test(
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
expect("stale browser network tab CSS removed", !/browser-network-tabs/.test(css));

if (failures.length) {
  console.error("UI contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("UI contract check passed.");
