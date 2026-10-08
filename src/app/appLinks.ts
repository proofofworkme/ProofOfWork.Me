export type AppLink = {
  href: string;
  label: string;
  localHref: string;
};

export const GITHUB_URL = "https://github.com/proofofworkme";
export const X_URL = "https://x.com/proofofworkme";
export const YOUTUBE_URL = "https://www.youtube.com/@proofofworkme";

export const HOME_APP_URL = "https://www.proofofwork.me/";
export const ID_APP_URL = "https://id.proofofwork.me";
export const DNS_APP_URL = "https://dns.proofofwork.me";
export const COMPUTER_APP_URL = "https://computer.proofofwork.me";
export const DESKTOP_APP_URL = "https://desktop.proofofwork.me";
export const BROWSER_APP_URL = "https://browser.proofofwork.me";
export const PAGES_APP_URL = "https://pages.proofofwork.me";
export const BOOST_APP_URL = "https://boost.proofofwork.me";
export const PUBLISH_APP_URL = "https://publish.proofofwork.me";
export const SEARCH_APP_URL = "https://search.proofofwork.me";
export const CODE_APP_URL = "https://code.proofofwork.me";
export const JOBS_APP_URL = "https://jobs.proofofwork.me";
export const MARKETPLACE_APP_URL = "https://amo.proofofwork.me";
export const TOKEN_APP_URL = "https://credit.proofofwork.me";
export const WALLET_APP_URL = "https://wallet.proofofwork.me";
export const WORK_TOKEN_APP_URL = "https://work.proofofwork.me";
export const INFINITY_APP_URL = "https://infinity.proofofwork.me";
export const INCEPTION_APP_URL = "https://inception.proofofwork.me";
export const LOG_APP_URL = "https://log.proofofwork.me";
export const GROWTH_APP_URL = "https://growth.proofofwork.me";

export const LOCAL_HOME_APP_URL = "/?landing=1";
export const LOCAL_ID_APP_URL = "/?id-launch=1";
export const LOCAL_DNS_APP_URL = "/?dns-launch=1";
export const LOCAL_COMPUTER_APP_URL = "/";
export const LOCAL_DESKTOP_APP_URL = "/?desktop=1";
export const LOCAL_BROWSER_APP_URL = "/?browser=1";
export const LOCAL_PAGES_APP_URL = "/?pages=1";
export const LOCAL_BOOST_APP_URL = "/?boost=1";
export const LOCAL_PUBLISH_APP_URL = "/?publish=1";
export const LOCAL_SEARCH_APP_URL = "/?search-app=1";
export const LOCAL_CODE_APP_URL = "/?code=1";
export const LOCAL_JOBS_APP_URL = "/?jobs=1";
export const LOCAL_MARKETPLACE_APP_URL = "/?marketplace=1";
export const LOCAL_TOKEN_APP_URL = "/?credit=1";
export const LOCAL_WALLET_APP_URL = "/?wallet=1";
export const LOCAL_WORK_TOKEN_APP_URL = "/?work=1";
export const LOCAL_INFINITY_APP_URL = "/?infinity=1";
export const LOCAL_INCEPTION_APP_URL = "/?inception=1";
export const LOCAL_LOG_APP_URL = "/?log=1";
export const LOCAL_GROWTH_APP_URL = "/?growth=1";

export const APP_LINKS: AppLink[] = [
  { href: HOME_APP_URL, label: "Home", localHref: LOCAL_HOME_APP_URL },
  { href: ID_APP_URL, label: "IDs", localHref: LOCAL_ID_APP_URL },
  { href: DNS_APP_URL, label: "DNS", localHref: LOCAL_DNS_APP_URL },
  {
    href: COMPUTER_APP_URL,
    label: "Computer",
    localHref: LOCAL_COMPUTER_APP_URL,
  },
  { href: DESKTOP_APP_URL, label: "Desktop", localHref: LOCAL_DESKTOP_APP_URL },
  { href: BROWSER_APP_URL, label: "Browser", localHref: LOCAL_BROWSER_APP_URL },
  { href: PAGES_APP_URL, label: "Pages", localHref: LOCAL_PAGES_APP_URL },
  { href: BOOST_APP_URL, label: "Boost", localHref: LOCAL_BOOST_APP_URL },
  { href: PUBLISH_APP_URL, label: "Publish", localHref: LOCAL_PUBLISH_APP_URL },
  { href: SEARCH_APP_URL, label: "Search", localHref: LOCAL_SEARCH_APP_URL },
  { href: CODE_APP_URL, label: "Code", localHref: LOCAL_CODE_APP_URL },
  { href: JOBS_APP_URL, label: "Jobs", localHref: LOCAL_JOBS_APP_URL },
  {
    href: MARKETPLACE_APP_URL,
    label: "AMO",
    localHref: LOCAL_MARKETPLACE_APP_URL,
  },
  {
    href: TOKEN_APP_URL,
    label: "Credit",
    localHref: LOCAL_TOKEN_APP_URL,
  },
  {
    href: WALLET_APP_URL,
    label: "Wallet",
    localHref: LOCAL_WALLET_APP_URL,
  },
  {
    href: WORK_TOKEN_APP_URL,
    label: "WORK",
    localHref: LOCAL_WORK_TOKEN_APP_URL,
  },
  {
    href: INFINITY_APP_URL,
    label: "Infinity",
    localHref: LOCAL_INFINITY_APP_URL,
  },
  {
    href: INCEPTION_APP_URL,
    label: "Inception",
    localHref: LOCAL_INCEPTION_APP_URL,
  },
  { href: LOG_APP_URL, label: "Log", localHref: LOCAL_LOG_APP_URL },
  { href: GROWTH_APP_URL, label: "Growth", localHref: LOCAL_GROWTH_APP_URL },
];

export type AppMenuGroup = {
  label: string;
  links: (AppLink & { displayLabel: string; description: string })[];
};

function appMenuLink(
  label: string,
  displayLabel: string,
  description: string,
): AppMenuGroup["links"][number] {
  const link = APP_LINKS.find((candidate) => candidate.label === label);
  if (!link) throw new Error(`Unknown public app: ${label}`);
  return { ...link, displayLabel, description };
}

export const APP_MENU_GROUPS: AppMenuGroup[] = [
  {
    label: "UTILITY",
    links: [
      appMenuLink("Computer", "COMPUTER", "Mail, files and workspaces"),
      appMenuLink("Desktop", "DESKTOP", "Public files by address"),
      appMenuLink("Browser", "BROWSER", "Verified pages by transaction"),
      appMenuLink("Pages", "PAGES", "Create HTML pages and apps"),
      appMenuLink("Code", "CODE", "Public source repositories"),
      appMenuLink("Jobs", "JOBS", "Commission and deliver work"),
    ],
  },
  {
    label: "ID&SOC",
    links: [
      appMenuLink("IDs", "ID", "Claim your ProofOfWork ID"),
      appMenuLink("DNS", "DNS", "Claim and search .pow names"),
      appMenuLink("Boost", "BOOST", "Proof-ranked posts and people"),
      appMenuLink("Publish", "PUBLISH", "Write and read articles"),
    ],
  },
  {
    label: "FINANCE",
    links: [
      appMenuLink("Wallet", "WALLET", "Balances, transfers and history"),
      appMenuLink("AMO", "AMO", "Listings, seals and markets"),
      appMenuLink("Credit", "CREDIT", "Create and mint credits"),
      appMenuLink("WORK", "WORK", "WORK dashboard and floor"),
      appMenuLink("Infinity", "INFINITY", "Infinity Bonds and POWB"),
      appMenuLink("Inception", "INCEPTION", "Inception Bonds and INCB"),
    ],
  },
  {
    label: "INSIGHTS",
    links: [
      appMenuLink("Log", "LOG", "Transaction-backed activity"),
      appMenuLink("Growth", "GROWTH", "Network value and growth"),
      appMenuLink("Search", "SEARCH", "Find records and content"),
    ],
  },
];
