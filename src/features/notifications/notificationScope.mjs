// ID queries use the canonical ID returned by confirmed registry resolution.
// Read preferences only bind after the API supplies its registration root.
export function notificationQueryKey(query) {
  return JSON.stringify([query.network, query.id !== undefined ? "id" : "address", query.id ?? query.address]);
}
export function notificationQueryParams(query, cursor) {
  const params = new URLSearchParams({ limit: "50" });
  if (typeof query.id === "string" && query.id && query.address === undefined) params.set("id", query.id);
  else if (typeof query.address === "string" && query.id === undefined) params.set("address", query.address);
  else throw new Error("Choose one notification address or ID.");
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}
export function notificationReadScope(query, response) {
  if (query.id !== undefined) {
    const scope = response?.scope;
    return response?.network === query.network && response.address === null && scope?.type === "id" && scope.id === query.id
      && /^[a-f0-9]{64}$/u.test(scope.registrationTxid) && response.scopeKey === `id:${scope.registrationTxid}` ? response.scopeKey : null;
  }
  return query.address || null;
}
