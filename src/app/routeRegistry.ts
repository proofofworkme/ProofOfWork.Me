export type AppSurface =
  | "landing"
  | "id-launch"
  | "dns-launch"
  | "computer"
  | "desktop"
  | "browser"
  | "pages"
  | "boost"
  | "publish"
  | "search"
  | "code"
  | "jobs"
  | "identity-bridge"
  | "marketplace"
  | "token"
  | "wallet"
  | "work"
  | "infinity"
  | "inception"
  | "log"
  | "growth";

function hostname() {
  return window.location.hostname.toLowerCase();
}

function searchFlag(name: string) {
  return new URLSearchParams(window.location.search).get(name) === "1";
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

  return hostname() === "id.proofofwork.me" || searchFlag("id-launch");
}

export function isDnsLaunchRoute() {
  if (import.meta.env.VITE_DNS_LAUNCH_ONLY === "1") {
    return true;
  }

  return hostname() === "dns.proofofwork.me" || searchFlag("dns-launch");
}

export function isLandingRoute() {
  if (import.meta.env.VITE_LANDING_ONLY === "1") {
    return true;
  }

  const currentHostname = hostname();
  return (
    currentHostname === "proofofwork.me" ||
    currentHostname === "www.proofofwork.me" ||
    searchFlag("landing")
  );
}

export function isDesktopRoute() {
  if (import.meta.env.VITE_DESKTOP_ONLY === "1") {
    return true;
  }

  return hostname() === "desktop.proofofwork.me" || searchFlag("desktop");
}

export function isBrowserRoute() {
  if (import.meta.env.VITE_BROWSER_ONLY === "1") {
    return true;
  }

  return hostname() === "browser.proofofwork.me" || searchFlag("browser");
}

export function isPagesRoute() {
  if (import.meta.env.VITE_PAGES_ONLY === "1") {
    return true;
  }

  return hostname() === "pages.proofofwork.me" || searchFlag("pages");
}

export function isBoostRoute() {
  if (import.meta.env.VITE_BOOST_ONLY === "1") {
    return true;
  }

  return hostname() === "boost.proofofwork.me" || searchFlag("boost");
}

export function isPublishRoute() {
  return import.meta.env.VITE_PUBLISH_ONLY === "1" ||
    hostname() === "publish.proofofwork.me" || searchFlag("publish");
}

export function isSearchRoute() {
  return import.meta.env.VITE_SEARCH_ONLY === "1" ||
    hostname() === "search.proofofwork.me" || searchFlag("search-app");
}

export function isJobsRoute() {
  return import.meta.env.VITE_JOBS_ONLY === "1" ||
    hostname() === "jobs.proofofwork.me" || searchFlag("jobs");
}

export function isCodeRoute() {
  return import.meta.env.VITE_CODE_ONLY === "1" ||
    hostname() === "code.proofofwork.me" || searchFlag("code");
}

export function isSocialIdentityBridgeRoute() {
  return (hostname() === "computer.proofofwork.me" || isLocalPreviewHost()) &&
    window.location.pathname === "/" && window.location.search === "?social-identity-bridge=1";
}

export function isMarketplaceRoute() {
  if (
    import.meta.env.VITE_MARKETPLACE_ONLY === "1" ||
    import.meta.env.VITE_AMO_ONLY === "1"
  ) {
    return true;
  }

  return (
    hostname() === "amo.proofofwork.me" ||
    hostname() === "marketplace.proofofwork.me" ||
    searchFlag("amo") ||
    searchFlag("marketplace")
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
    searchFlag("credit") ||
    searchFlag("token")
  );
}

export function isWalletRoute() {
  if (import.meta.env.VITE_WALLET_ONLY === "1") {
    return true;
  }

  return hostname() === "wallet.proofofwork.me" || searchFlag("wallet");
}

export function isWorkTokenRoute() {
  if (import.meta.env.VITE_WORK_TOKEN_ONLY === "1") {
    return true;
  }

  return hostname() === "work.proofofwork.me" || searchFlag("work");
}

export function isInfinityRoute() {
  if (import.meta.env.VITE_INFINITY_ONLY === "1") {
    return true;
  }

  return (
    hostname() === "infinity.proofofwork.me" ||
    searchFlag("infinity")
  );
}

export function isInceptionRoute() {
  if (import.meta.env.VITE_INCEPTION_ONLY === "1") {
    return true;
  }

  return (
    hostname() === "inception.proofofwork.me" ||
    searchFlag("inception")
  );
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
    searchFlag("log") ||
    searchFlag("activity")
  );
}

export function isGrowthRoute() {
  if (import.meta.env.VITE_GROWTH_ONLY === "1") {
    return true;
  }

  return hostname() === "growth.proofofwork.me" || searchFlag("growth");
}

export function detectAppSurface(): AppSurface {
  if (isSocialIdentityBridgeRoute()) return "identity-bridge";
  if (isLandingRoute()) return "landing";
  if (isIdLaunchRoute()) return "id-launch";
  if (isDnsLaunchRoute()) return "dns-launch";
  if (isDesktopRoute()) return "desktop";
  if (isBrowserRoute()) return "browser";
  if (isPagesRoute()) return "pages";
  if (isBoostRoute()) return "boost";
  if (isPublishRoute()) return "publish";
  if (isSearchRoute()) return "search";
  if (isCodeRoute()) return "code";
  if (isJobsRoute()) return "jobs";
  if (isMarketplaceRoute()) return "marketplace";
  if (isTokenRoute()) return "token";
  if (isWalletRoute()) return "wallet";
  if (isWorkTokenRoute()) return "work";
  if (isInfinityRoute()) return "infinity";
  if (isInceptionRoute()) return "inception";
  if (isActivityRoute()) return "log";
  if (isGrowthRoute()) return "growth";
  return "computer";
}
