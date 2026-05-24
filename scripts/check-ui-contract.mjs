import { readFileSync } from "node:fs";

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
  "src/features/rush/RushApp.tsx",
  "src/shared/components/AppHeader.tsx",
  "src/shared/components/AppStatusRow.tsx",
  "src/shared/components/BrowserNetworkTabs.tsx",
  "src/shared/components/DomainNav.tsx",
  "src/shared/components/HeaderActionsMenu.tsx",
  "src/styles.css",
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
  "standalone shells reserve the fixed topbar row",
  /\.desktop-public-app\s*\{[\s\S]*grid-template-rows:\s*var\(--topbar-height\)\s+minmax\(0,\s*1fr\)\s+auto/.test(
    css,
  ) &&
    /\.desktop-public-app\.has-route-status\s*\{[\s\S]*grid-template-rows:\s*var\(--topbar-height\)\s+var\(--status-row-height\)\s+minmax\(0,\s*1fr\)\s+auto/.test(
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
  "id launch shells use the same fixed chrome rows",
  /\.id-launch-app\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*var\(--topbar-height\)\s+var\(--status-row-height\)\s+minmax\(0,\s*1fr\)\s+auto/.test(
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
expect(
  "landing uses the shared header contract",
  !/landing-topbar|landing-brand|domainNavCompact=\{false\}/.test(landingApp),
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
[
  /className="desktop-public-header"/,
  /className="id-launch-topbar"/,
  /brandClassName=/,
].forEach((pattern) =>
  notContains("src/App.tsx", pattern, `no per-route AppHeader override ${pattern}`),
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
  /\.desktop-public-app\.has-route-status\s+\.topbar\s*\+\s*\.desktop-route-status\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*var\(--topbar-height\)[\s\S]*z-index:\s*var\(--sticky-status-z\)/.test(
    css,
  ),
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
expect("stale browser network tab CSS removed", !/browser-network-tabs/.test(css));

if (failures.length) {
  console.error("UI contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("UI contract check passed.");
