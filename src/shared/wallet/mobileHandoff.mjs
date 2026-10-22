// UniSat's supported mobile-web entry point (not an app-to-app connect callback):
// https://github.com/unisat-wallet/dev-support/issues/97#issuecomment-5307723509
const PUBLIC_ROUTE_PARAMS = new Set([
  "landing", "id-launch", "dns-launch", "desktop", "browser", "pages", "boost",
  "publish", "search", "code", "jobs", "permission", "marketplace", "amo",
  "token", "wallet", "work", "infinity", "inception", "log", "growth",
  "folder", "network", "tab", "tx", "txid", "article", "profile", "asset",
  "ticker", "name", "repo", "path", "version", "job", "mode", "write",
  "q", "kind", "protocol", "sort", "status", "valid", "start", "activity",
  "record", "listingId", "t", "v",
]);

export function isMobileWalletBrowser({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  return /Android|iPhone|iPad|iPod/iu.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
}

export function unisatMobileHandoff(currentUrl) {
  const destination = new URL(currentUrl);
  if (!["https:", "http:"].includes(destination.protocol) || destination.username || destination.password) {
    throw new Error("UniSat can only open a public web page without URL credentials.");
  }
  // Only public navigation state crosses browsers. Never serialize storage,
  // drafts, signatures, callback credentials, or arbitrary fragment state.
  destination.hash = "";
  for (const key of [...destination.searchParams.keys()]) {
    if (!PUBLIC_ROUTE_PARAMS.has(key)) destination.searchParams.delete(key);
  }
  const data = encodeURIComponent(btoa(JSON.stringify([destination.href])));
  return {
    destination: destination.href,
    href: `https://app.unisat.cloud/request?method=openDapp&from=ProofOfWorkMe&data=${data}`,
  };
}
