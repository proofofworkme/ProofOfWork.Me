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
  | "infinity"
  | "inception"
  | "rush"
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

export function isMarketplaceRoute() {
  if (import.meta.env.VITE_MARKETPLACE_ONLY === "1") {
    return true;
  }

  return (
    hostname() === "marketplace.proofofwork.me" ||
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

export function isRushRoute() {
  if (import.meta.env.VITE_RUSH_ONLY === "1") {
    return true;
  }

  return searchFlag("rush");
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
  if (isLandingRoute()) return "landing";
  if (isIdLaunchRoute()) return "id-launch";
  if (isDesktopRoute()) return "desktop";
  if (isBrowserRoute()) return "browser";
  if (isMarketplaceRoute()) return "marketplace";
  if (isTokenRoute()) return "token";
  if (isWalletRoute()) return "wallet";
  if (isWorkTokenRoute()) return "work";
  if (isInfinityRoute()) return "infinity";
  if (isInceptionRoute()) return "inception";
  if (isRushRoute()) return "rush";
  if (isActivityRoute()) return "log";
  if (isGrowthRoute()) return "growth";
  return "computer";
}
