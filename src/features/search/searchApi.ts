import { fetchProofApiJson, proofApiUrl } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";

export type SearchStatus = "confirmed" | "all" | "pending" | "dropped" | "orphaned";
export type SearchValidity = "valid" | "all" | "invalid";
export type SearchSort = "relevance" | "newest" | "oldest" | "proofs";
export type SearchQuery = {
  network: BitcoinNetwork;
  q: string;
  protocol: string;
  kind: string;
  status: SearchStatus;
  valid: SearchValidity;
  sort: SearchSort;
};

export type SearchRecord = {
  id: string;
  txid: string;
  protocol: string;
  kind: string;
  status: string;
  canonical?: boolean;
  valid: boolean | null;
  validationErrors: string[];
  title: string;
  excerpt: string;
  amountSats: string;
  dataBytes: number;
  blockHeight: number | null;
  blockHash: string | null;
  blockIndex: number | null;
  timestamp: string | number | null;
  participants: { address: string; role: string; powid?: string }[];
  refs: { type: string; value: string }[];
  file?: { name: string; mimeType: string; size: number; sha256: string };
  source: { vout: number | null; ordinal: number | null };
};

export type SearchCoverage = {
  ready: boolean;
  checkpointHeight: number | null;
  checkpointHash: string | null;
  indexVersion: string;
  lastIndexedAt: string | null;
  sourceCounts: Record<string, unknown>;
  byProtocol: Record<string, { total: number; confirmed: number; valid: number; invalid: number }>;
  kinds?: string[];
  scope?: string;
};

export type SearchResponse = {
  network: BitcoinNetwork;
  q: string;
  results: SearchRecord[];
  pagination: { limit: number; returned: number; total: number; nextCursor: string | null; hasMore: boolean };
  coverage: SearchCoverage;
};

export type SearchDetail = {
  network: BitcoinNetwork;
  record: SearchRecord;
  payload: unknown;
  rawPayload: unknown;
  evidence: unknown;
  coverage?: SearchCoverage;
};

export const DEFAULT_SEARCH_QUERY: SearchQuery = {
  network: "livenet", q: "", protocol: "", kind: "", status: "confirmed", valid: "valid", sort: "relevance",
};

export function searchQueryFromLocation(network: BitcoinNetwork = "livenet"): SearchQuery {
  const params = new URLSearchParams(window.location.search);
  const selectedNetwork = params.get("network");
  const status = params.get("status");
  const validity = params.get("valid");
  const sort = params.get("sort");
  return {
    network: ["livenet", "testnet", "testnet4"].includes(selectedNetwork ?? "") ? selectedNetwork as BitcoinNetwork : network,
    q: (params.get("q") ?? "").slice(0, 512),
    protocol: (params.get("protocol") ?? "").slice(0, 64),
    kind: (params.get("kind") ?? "").slice(0, 64),
    status: ["confirmed", "all", "pending", "dropped", "orphaned"].includes(status ?? "") ? status as SearchStatus : "confirmed",
    valid: ["valid", "all", "invalid"].includes(validity ?? "") ? validity as SearchValidity : "valid",
    sort: ["relevance", "newest", "oldest", "proofs"].includes(sort ?? "") ? sort as SearchSort : "relevance",
  };
}

export function searchParams(query: SearchQuery, cursor?: string): URLSearchParams {
  const params = new URLSearchParams({ q: query.q, status: query.status, valid: query.valid, sort: query.sort, limit: "25" });
  if (query.protocol) params.set("protocol", query.protocol);
  if (query.kind) params.set("kind", query.kind);
  if (cursor) params.set("cursor", cursor);
  return params;
}

export function searchApiHref(query: SearchQuery) {
  return proofApiUrl(`/api/v1/search?${searchParams(query)}`, query.network);
}

function checkRecord(record: SearchRecord) {
  if (!record || typeof record.id !== "string" || !record.id || !/^[0-9a-f]{64}$/iu.test(record.txid)
    || typeof record.protocol !== "string" || typeof record.kind !== "string"
    || (record.valid !== null && typeof record.valid !== "boolean")
    || typeof record.amountSats !== "string" || !/^\d+$/u.test(record.amountSats)
    || !Array.isArray(record.participants) || !Array.isArray(record.refs) || !record.source) {
    throw new Error("The search service returned an incomplete record. Try again after the index refreshes.");
  }
}

export async function fetchSearch(query: SearchQuery, signal: AbortSignal, cursor?: string): Promise<SearchResponse> {
  const response = await fetchProofApiJson<SearchResponse>(`/api/v1/search?${searchParams(query, cursor)}`, query.network, { signal, timeoutMs: 30_000 });
  if (response?.network !== query.network || !Array.isArray(response.results) || !response.coverage
    || typeof response.coverage.ready !== "boolean" || !response.pagination
    || !Number.isSafeInteger(response.pagination.total) || response.pagination.total < 0
    || typeof response.pagination.hasMore !== "boolean" || response.results.length > 50
    || (response.pagination.hasMore && !response.pagination.nextCursor)) {
    throw new Error("Search coverage is unavailable for this network. Try again shortly.");
  }
  response.results.forEach(checkRecord);
  return response;
}

export async function fetchSearchDetail(network: BitcoinNetwork, id: string, signal: AbortSignal): Promise<SearchDetail> {
  const response = await fetchProofApiJson<SearchDetail>(`/api/v1/search/detail?id=${encodeURIComponent(id)}`, network, { signal, timeoutMs: 30_000 });
  if (response?.network !== network || response.record?.id !== id) throw new Error("The source record is unavailable for this network.");
  checkRecord(response.record);
  return response;
}

export function exactProofs(value: string) {
  return /^\d+$/u.test(value) ? BigInt(value).toLocaleString("en-US") : "Unavailable";
}
