export function tokenRouteTarget() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("asset") ?? params.get("ticker") ?? "").trim();
}
