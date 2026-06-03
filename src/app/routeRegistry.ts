export type AppSurface =
  | "landing"
  | "id-launch"
  | "computer"
  | "desktop"
  | "browser"
  | "marketplace"
  | "token"
  | "wallet"
  | "work"
  | "rush"
  | "log"
  | "growth";

function hostname() {
  return window.location.hostname.toLowerCase();
}

function searchIncludes(value: string) {
  return window.location.search.includes(value);
}

export function isLocalPreviewHost() {
  const currentHostname = hostname();
  return (
    currentHostname === "localhost" ||
    currentHostname === "127.0.0.1" ||
    currentHostname === "::1" ||
    currentHostname.endsWith(".localhost")
  );
}

export function appHref(productionHref: string, localHref: string) {
  return isLocalPreviewHost() ? localHref : productionHref;
}

export function isIdLaunchRoute() {
  if (import.meta.env.VITE_ID_LAUNCH_ONLY === "1") {
    return true;
  }

  return hostname() === "id.proofofwork.me" || searchIncludes("id-launch=1");
}

export function isLandingRoute() {
  if (import.meta.env.VITE_LANDING_ONLY === "1") {
    return true;
  }

  const currentHostname = hostname();
  return (
    currentHostname === "proofofwork.me" ||
    currentHostname === "www.proofofwork.me" ||
    searchIncludes("landing=1")
  );
}

export function isDesktopRoute() {
  if (import.meta.env.VITE_DESKTOP_ONLY === "1") {
    return true;
  }

  return hostname() === "desktop.proofofwork.me" || searchIncludes("desktop=1");
}

export function isBrowserRoute() {
  if (import.meta.env.VITE_BROWSER_ONLY === "1") {
    return true;
  }

  return hostname() === "browser.proofofwork.me" || searchIncludes("browser=1");
}

export function isMarketplaceRoute() {
  if (import.meta.env.VITE_MARKETPLACE_ONLY === "1") {
    return true;
  }

  return (
    hostname() === "marketplace.proofofwork.me" ||
    searchIncludes("marketplace=1")
  );
}

export function isTokenRoute() {
  if (import.meta.env.VITE_TOKEN_ONLY === "1") {
    return true;
  }

  const currentHostname = hostname();
  return (
    currentHostname === "credit.proofofwork.me" ||
    currentHostname === "token.proofofwork.me" ||
    currentHostname === "tokens.proofofwork.me" ||
    searchIncludes("credit=1") ||
    searchIncludes("token=1")
  );
}

export function isWalletRoute() {
  if (import.meta.env.VITE_WALLET_ONLY === "1") {
    return true;
  }

  return hostname() === "wallet.proofofwork.me" || searchIncludes("wallet=1");
}

export function isWorkTokenRoute() {
  if (import.meta.env.VITE_WORK_TOKEN_ONLY === "1") {
    return true;
  }

  return hostname() === "work.proofofwork.me" || searchIncludes("work=1");
}

export function isRushRoute() {
  if (import.meta.env.VITE_RUSH_ONLY === "1") {
    return true;
  }

  return searchIncludes("rush=1");
}

export function isActivityRoute() {
  if (
    import.meta.env.VITE_ACTIVITY_ONLY === "1" ||
    import.meta.env.VITE_LOG_ONLY === "1"
  ) {
    return true;
  }

  const currentHostname = hostname();
  return (
    currentHostname === "log.proofofwork.me" ||
    currentHostname === "activity.proofofwork.me" ||
    searchIncludes("log=1") ||
    searchIncludes("activity=1")
  );
}

export function isGrowthRoute() {
  if (import.meta.env.VITE_GROWTH_ONLY === "1") {
    return true;
  }

  return hostname() === "growth.proofofwork.me" || searchIncludes("growth=1");
}

export function detectAppSurface(): AppSurface {
  if (isLandingRoute()) return "landing";
  if (isIdLaunchRoute()) return "id-launch";
  if (isDesktopRoute()) return "desktop";
  if (isBrowserRoute()) return "browser";
  if (isMarketplaceRoute()) return "marketplace";
  if (isTokenRoute()) return "token";
  if (isWalletRoute()) return "wallet";
  if (isWorkTokenRoute()) return "work";
  if (isRushRoute()) return "rush";
  if (isActivityRoute()) return "log";
  if (isGrowthRoute()) return "growth";
  return "computer";
}
