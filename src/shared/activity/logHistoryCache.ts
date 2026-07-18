export type ActivityHistoryCacheIdentity = {
  cursor?: string;
  kind: string;
  pageIndex: number;
  pageSize: number;
  query: string;
  snapshotId?: string;
};

export function normalizedActivityHistoryCacheQuery(value: string) {
  const query = value.trim();
  if (
    /^[0-9a-f]{64}$/iu.test(query) ||
    /^bc1[ac-hj-np-z02-9]+$/iu.test(query) ||
    /@proofofwork\.me$/iu.test(query)
  ) {
    return query.toLowerCase();
  }
  return query;
}

export function activityHistoryCacheKey(
  identity: ActivityHistoryCacheIdentity,
) {
  return JSON.stringify([
    identity.kind.trim().toLowerCase(),
    normalizedActivityHistoryCacheQuery(identity.query),
    Math.max(0, Math.floor(identity.pageIndex)),
    Math.max(1, Math.floor(identity.pageSize)),
    identity.cursor?.trim() ?? "",
    identity.snapshotId?.trim() ?? "",
  ]);
}
