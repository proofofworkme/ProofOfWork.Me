export function pay2SpeakCreatorRouteAddress() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("creator") ?? "").trim();
}
