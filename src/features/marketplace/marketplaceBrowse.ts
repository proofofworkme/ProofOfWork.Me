import { useEffect, useRef, useState } from "react";
import { fetchProofApiJson, ProofApiRequestError } from "../../shared/api/proofApiClient";
import { listingDisplayProjectionFingerprint } from "../../shared/api/surfaceReadState";
import { createVisibleReadLoop, waitForDisplayRead } from "../../shared/api/useVisibleReadLoop";

export type BrowseCounts = { all: number; sealed: number; unsealed: number };
export type MarketplaceBrowseQuery = {
  asset: string;
  status: "all" | "sealed" | "unsealed";
  q: string;
  sort: "price-asc" | "price-desc" | "arb-asc" | "arb-desc";
};
export type MarketplaceBrowseResponse<T = unknown, S = unknown> = {
  contract: "proof-amo-browse-v1";
  displayOnly: true;
  network: "livenet";
  source: { membershipSha256: string; fullSourceSha256: string };
  provenance: { displayOnly: true; authoritative: false; completeAtObservation: true; signingRequiresFreshPreflight: true };
  version: string;
  observedAt: string;
  checkpoint: { height: number; blockHash: string };
  state: "last-verified";
  refreshing: boolean;
  refreshError?: { code: string; at: string } | null;
  summary?: S;
  book: {
    items: T[];
    totalCount: number;
    counts: BrowseCounts;
    assetCounts: Record<string, BrowseCounts>;
    hasMore: boolean;
    nextCursor: string | null;
    limit: number;
    start: number;
    end: number;
    asset: string;
    status: string;
    sort: string;
    query: string;
  };
};

export function browseQueryKey(query: MarketplaceBrowseQuery) {
  return JSON.stringify([query.asset, query.status, query.q.trim().toLowerCase(), query.sort]);
}

/** Display evidence is deliberately separate from current signing authority. */
export function assertMarketplaceBrowseResponse<T, S>(
  payload: MarketplaceBrowseResponse<T, S>,
  expectedVersion?: string,
  expected?: { query?: MarketplaceBrowseQuery; checkpoint?: { height?: number; blockHash?: string }; start?: number; limit?: number },
) {
  const validCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const validCounts = (counts: BrowseCounts | undefined) => counts &&
    validCount(counts.all) && validCount(counts.sealed) && validCount(counts.unsealed) &&
    counts.sealed + counts.unsealed === counts.all;
  if (payload?.contract !== "proof-amo-browse-v1" || payload.displayOnly !== true || payload.network !== "livenet" ||
      payload.provenance?.displayOnly !== true || payload.provenance.authoritative !== false ||
      payload.provenance.completeAtObservation !== true || payload.provenance.signingRequiresFreshPreflight !== true ||
      payload.state !== "last-verified" || !/^[0-9a-f]{64}$/u.test(payload.version ?? "") ||
      (expectedVersion && payload.version !== expectedVersion) ||
      !Number.isFinite(Date.parse(payload.observedAt)) ||
      !Number.isSafeInteger(payload.checkpoint?.height) || payload.checkpoint.height < 1 ||
      !/^[0-9a-f]{64}$/u.test(payload.checkpoint?.blockHash ?? "") ||
      (expected?.checkpoint && (payload.checkpoint.height !== expected.checkpoint.height ||
        payload.checkpoint.blockHash !== expected.checkpoint.blockHash)) ||
      (expected?.query && (payload.book.asset !== expected.query.asset || payload.book.status !== expected.query.status ||
        payload.book.sort !== expected.query.sort || payload.book.query !== expected.query.q.trim().toLowerCase())) ||
      !validCount(payload.book?.start) || payload.book.end !== payload.book.start + payload.book.items?.length ||
      payload.book.end > payload.book.totalCount ||
      (expected?.start !== undefined && payload.book.start !== expected.start) ||
      (expected?.limit !== undefined && payload.book.limit !== expected.limit) ||
      payload.book.hasMore !== (payload.book.end < payload.book.totalCount) ||
      !Array.isArray(payload.book?.items) || !validCount(payload.book.totalCount) ||
      !Number.isSafeInteger(payload.book.limit) || payload.book.limit < 1 || payload.book.limit > 100 ||
      payload.book.items.length !== Math.min(payload.book.limit, payload.book.totalCount - payload.book.start) ||
      !validCounts(payload.book.counts) ||
      !payload.book.assetCounts || Object.entries(payload.book.assetCounts).some(([asset, counts]) =>
        !/^[0-9a-f]{64}$/u.test(asset) || !validCounts(counts)) ||
      typeof payload.book.hasMore !== "boolean" ||
      Boolean(payload.book.nextCursor) !== payload.book.hasMore) {
    throw new Error("The AMO display snapshot could not be verified.");
  }
  const items = payload.book.items as Array<{ network?: string; confirmed?: boolean; tokenId?: string; listingId?: string;
    displayEvidence?: { model?: unknown; fullRecordSha256?: unknown; omittedFields?: unknown; fullDetailPath?: unknown } }>;
  if (new Set(items.map((item) => item.listingId)).size !== items.length || items.some((item) =>
    item.network !== "livenet" || item.confirmed !== true || !/^[0-9a-f]{64}$/u.test(item.listingId ?? "") ||
    !/^[0-9a-f]{64}$/u.test(item.tokenId ?? "") ||
    (/^[0-9a-f]{64}$/u.test(payload.book.asset) && item.tokenId !== payload.book.asset))) {
    throw new Error("The AMO display page contains invalid or mismatched listings.");
  }
  listingDisplayProjectionFingerprint({ items,
    itemProjection: { model: "proof-token-listing-display-v2", fullMembershipSha256: payload.source?.membershipSha256,
      fullSourceSha256: payload.source?.fullSourceSha256 } });
  return payload;
}

export async function fetchMarketplaceBrowse<T = unknown, S = unknown>(options: {
  query?: MarketplaceBrowseQuery;
  cursor?: string;
  version?: string;
  checkpoint?: { height?: number; blockHash?: string };
  start?: number;
  includeSummary?: boolean;
  refresh?: boolean;
  limit?: number;
  signal?: AbortSignal;
} = {}) {
  const query: MarketplaceBrowseQuery = options.query ?? { asset: "all", status: "all", q: "", sort: "arb-desc" };
  const params = new URLSearchParams({
    asset: query.asset, status: query.status, q: query.q.trim(), sort: query.sort,
    limit: String(options.limit ?? 25), includeSummary: options.includeSummary === false ? "0" : "1",
  });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.version) params.set("version", options.version);
  if (options.refresh) params.set("refresh", "1");
  return assertMarketplaceBrowseResponse(await fetchProofApiJson<MarketplaceBrowseResponse<T, S>>(
    `/api/v1/marketplace-browse?${params}`, "livenet", { signal: options.signal, timeoutMs: 15_000 },
  ), options.version, { query, checkpoint: options.checkpoint, start: options.start ?? 0, limit: options.limit ?? 25 });
}

type BrowsePage<T> = {
  response: MarketplaceBrowseResponse<T>;
  queryKey: string;
  asset: string;
  pageIndex: number;
  cursors: string[];
};

/** A page never becomes a complete local book. Filters and totals belong to the server snapshot. */
export function useMarketplaceBrowse<T>(options: {
  enabled: boolean;
  query: MarketplaceBrowseQuery;
  version?: string;
  checkpoint?: { height?: number; blockHash?: string };
  onVersionExpired?: () => void;
  refreshNonce?: number;
}) {
  const { enabled, query, version, refreshNonce = 0 } = options;
  const queryKey = browseQueryKey(query);
  const [page, setPage] = useState<BrowsePage<T>>();
  const [target, setTarget] = useState<{ key: string; pageIndex: number; cursors: string[]; version?: string }>({
    key: "", pageIndex: 0, cursors: [""],
  });
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const acceptedRef = useRef(page);
  const expiredVersionsRef = useRef(new Set<string>());
  const onVersionExpiredRef = useRef(options.onVersionExpired);
  onVersionExpiredRef.current = options.onVersionExpired;
  const targetMatches = target.key === queryKey && target.version === version;
  const pageIndex = targetMatches ? target.pageIndex : 0;
  const cursors = targetMatches ? target.cursors : [""];
  const cursor = cursors[pageIndex] ?? "";
  useEffect(() => {
    if (!enabled || !version) { setLoading(false); return; }
    let current = true;
    const stop = createVisibleReadLoop(async (signal) => {
      setLoading(true);
      setError("");
      // Let fast typing settle; cancellation discards obsolete search responses.
      await waitForDisplayRead(query.q.trim() ? 180 : 0, signal);
      try {
        let response: MarketplaceBrowseResponse<T> | undefined;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            response = await fetchMarketplaceBrowse<T>({ query, cursor, version,
              checkpoint: options.checkpoint, start: pageIndex * 25, includeSummary: false, signal });
            break;
          } catch (failure) {
            if (signal.aborted) throw failure;
            if (!(failure instanceof ProofApiRequestError) || failure.status !== 503 || attempt === 5) throw failure;
            await waitForDisplayRead(3_000, signal);
          }
        }
        if (!response || signal.aborted || !current) return;
        const next = { response, queryKey, asset: query.asset, pageIndex, cursors };
        acceptedRef.current = next;
        setPage(next);
      } catch (failure) {
        if (!signal.aborted && current) {
          if (failure instanceof ProofApiRequestError && failure.status === 409 &&
              version && !expiredVersionsRef.current.has(version)) {
            expiredVersionsRef.current.add(version);
            onVersionExpiredRef.current?.();
          }
          setError(failure instanceof ProofApiRequestError && failure.status === 409
            ? "This snapshot expired. Updating to the latest summary and first page; the previous results remain visible."
            : failure instanceof Error ? failure.message : "AMO listings are unavailable.");
        }
      } finally {
        if (current) setLoading(false);
      }
    });
    return () => { current = false; stop(); };
  }, [enabled, queryKey, version, cursor, pageIndex, refreshNonce, retry]);
  const visiblePage = enabled && page?.asset === query.asset ? page : undefined;
  const matches = Boolean(visiblePage && visiblePage.queryKey === queryKey &&
    visiblePage.pageIndex === pageIndex && (!version || visiblePage.response.version === version));
  const goToPage = (nextIndex: number) => {
    const accepted = acceptedRef.current;
    if (!matches || loading || !accepted || nextIndex < 0) return;
    const nextCursors = [...accepted.cursors];
    if (nextIndex === accepted.pageIndex + 1 && accepted.response.book.nextCursor) {
      nextCursors[nextIndex] = accepted.response.book.nextCursor;
    }
    if (nextCursors[nextIndex] === undefined) return;
    setTarget({ key: queryKey, pageIndex: nextIndex, cursors: nextCursors, version });
  };
  return { response: visiblePage?.response, pageIndex: visiblePage?.pageIndex ?? 0,
    loading: enabled && (!matches && !error || loading), error, matches, goToPage, retry: () => setRetry((value) => value + 1) };
}
