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
export const COMPUTER_APP_URL = "https://computer.proofofwork.me";
export const DESKTOP_APP_URL = "https://desktop.proofofwork.me";
export const BROWSER_APP_URL = "https://browser.proofofwork.me";
export const MARKETPLACE_APP_URL = "https://marketplace.proofofwork.me";
export const TOKEN_APP_URL = "https://token.proofofwork.me";
export const WALLET_APP_URL = "https://wallet.proofofwork.me";
export const WORK_TOKEN_APP_URL = "https://work.proofofwork.me";
export const RUSH_APP_URL = "https://rush.proofofwork.me";
export const LOG_APP_URL = "https://log.proofofwork.me";
export const GROWTH_APP_URL = "https://growth.proofofwork.me";

export const LOCAL_HOME_APP_URL = "/?landing=1";
export const LOCAL_ID_APP_URL = "/?id-launch=1";
export const LOCAL_COMPUTER_APP_URL = "/";
export const LOCAL_DESKTOP_APP_URL = "/?desktop=1";
export const LOCAL_BROWSER_APP_URL = "/?browser=1";
export const LOCAL_MARKETPLACE_APP_URL = "/?marketplace=1";
export const LOCAL_TOKEN_APP_URL = "/?token=1";
export const LOCAL_WALLET_APP_URL = "/?wallet=1";
export const LOCAL_WORK_TOKEN_APP_URL = "/?work=1";
export const LOCAL_RUSH_APP_URL = "/?rush=1";
export const LOCAL_LOG_APP_URL = "/?log=1";
export const LOCAL_GROWTH_APP_URL = "/?growth=1";

export const APP_LINKS: AppLink[] = [
  { href: HOME_APP_URL, label: "Home", localHref: LOCAL_HOME_APP_URL },
  { href: ID_APP_URL, label: "IDs", localHref: LOCAL_ID_APP_URL },
  {
    href: COMPUTER_APP_URL,
    label: "Computer",
    localHref: LOCAL_COMPUTER_APP_URL,
  },
  { href: DESKTOP_APP_URL, label: "Desktop", localHref: LOCAL_DESKTOP_APP_URL },
  { href: BROWSER_APP_URL, label: "Browser", localHref: LOCAL_BROWSER_APP_URL },
  {
    href: MARKETPLACE_APP_URL,
    label: "Marketplace",
    localHref: LOCAL_MARKETPLACE_APP_URL,
  },
  {
    href: TOKEN_APP_URL,
    label: "Token",
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
  { href: LOG_APP_URL, label: "Log", localHref: LOCAL_LOG_APP_URL },
  { href: GROWTH_APP_URL, label: "Growth", localHref: LOCAL_GROWTH_APP_URL },
];
