import { Buffer } from "buffer";
import { fetchProofApiJson } from "../../shared/api/proofApiClient";
import type { BitcoinNetwork } from "../../shared/bitcoin/networks";
import { sha256Hex } from "../../shared/utils/encoding";
import { validateCodePath, codeSourceBytes } from "../../shared/protocol/codeRepository.mjs";

export type CodeSnapshot = { id: string; checkpointHeight: number; checkpointHash: string };
export type CodeRepository = {
  txid: string; repoTxid: string; name: string; description: string; ownerAddress: string;
  ownerId?: string; headTxid: string; fileCount: number; commitCount: number;
  blockHeight?: number | null; blockTime?: number | null; timestamp?: string;
};
export type CodeFile = { path: string; txid: string; sha256: string; size: number };
export type CodeEvent = {
  txid: string; parent?: string; parentTxid?: string; op?: "put" | "delete"; path?: string;
  message?: string; sha256?: string; size?: number; applied?: boolean; accepted?: boolean;
  status?: string; confirmed?: boolean; reason?: string; validationErrors?: string[];
  blockHeight?: number | null; blockTime?: number | null; timestamp?: string;
};
export type CodePage = { limit: number; hasMore: boolean; nextCursor?: string | null; total?: number };
type ReadEvidence = {
  network?: BitcoinNetwork; snapshot: CodeSnapshot; complete: true; source: string;
  indexedThroughBlock: number; indexedThroughBlockHash: string;
  pendingComplete?: boolean; pendingWarnings?: string[];
};
export type CodeList = ReadEvidence & { repositories: CodeRepository[]; pagination: CodePage; pendingEvents?: CodeEvent[]; stats?: { repositories: number; acceptedCommits: number; unappliedCommits: number; files: number } };
export type CodeDetail = ReadEvidence & {
  repository: CodeRepository; files: CodeFile[]; filesComplete: true;
  commits?: CodeEvent[]; events?: CodeEvent[]; pendingEvents?: CodeEvent[]; pagination: CodePage;
  version?: string; selectedVersion?: string; selectedVersionTxid?: string;
  file?: (CodeFile & { content: string; contentBase64: string }) | null;
};
function txid(value: unknown) { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function assertEvidence(value: ReadEvidence, network: BitcoinNetwork) {
  if (!value || value.complete !== true || (value.network && value.network !== network) || typeof value.source !== "string" || !value.source.trim() || typeof value.snapshot?.id !== "string" || !value.snapshot.id.trim() ||
    !Number.isSafeInteger(value.indexedThroughBlock) || value.indexedThroughBlock < 0 || !txid(value.indexedThroughBlockHash) ||
    value.snapshot.checkpointHeight !== value.indexedThroughBlock || value.snapshot.checkpointHash !== value.indexedThroughBlockHash) {
    throw new Error("Complete confirmed Code evidence is unavailable. Refresh again in a moment.");
  }
}
function assertRepository(repo: CodeRepository) {
  if (!repo || !txid(repo.repoTxid ?? repo.txid) || !txid(repo.headTxid) || typeof repo.name !== "string" || typeof repo.ownerAddress !== "string" ||
    !Number.isSafeInteger(repo.fileCount) || repo.fileCount < 0 || !Number.isSafeInteger(repo.commitCount) || repo.commitCount < 0) {
    throw new Error("Repository evidence is incomplete. Refresh before continuing.");
  }
}
function assertPage(page: CodePage) {
  if (!page || typeof page.hasMore !== "boolean" || (page.hasMore && !page.nextCursor)) throw new Error("Code pagination evidence is unavailable.");
}
export async function fetchCodeRepositories(network: BitcoinNetwork, params: { cursor?: string; fresh?: boolean; signal?: AbortSignal } = {}) {
  const query = new URLSearchParams({ limit: "30" });
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.fresh) query.set("fresh", "1");
  const value = await fetchProofApiJson<CodeList>(`/api/v1/code-repositories?${query}`, network, { signal: params.signal });
  assertEvidence(value, network); assertPage(value.pagination);
  if (!Array.isArray(value.repositories)) throw new Error("Repository list is unavailable.");
  value.repositories.forEach(assertRepository);
  return value;
}
export async function fetchCodeRepository(network: BitcoinNetwork, repo: string, params: {
  cursor?: string; snapshot?: string; version?: string; path?: string; fresh?: boolean; signal?: AbortSignal;
} = {}) {
  if (!txid(repo)) throw new Error("Repository transaction must contain 64 hexadecimal characters.");
  const query = new URLSearchParams({ repo, limit: "30" });
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.snapshot) query.set("snapshot", params.snapshot);
  if (params.version) query.set("version", params.version);
  if (params.path !== undefined) query.set("path", params.path);
  if (params.fresh) query.set("fresh", "1");
  const value = await fetchProofApiJson<CodeDetail>(`/api/v1/code-repository?${query}`, network, { signal: params.signal });
  assertEvidence(value, network); assertRepository(value.repository); assertPage(value.pagination);
  if (value.filesComplete !== true || !Array.isArray(value.files) || value.files.some(file => !validateCodePath(file.path) || !txid(file.txid) || !txid(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 60000)) {
    throw new Error("The complete repository tree is unavailable. Refresh again in a moment.");
  }
  const paths = [...value.files.map(file => file.path)].sort();
  const pathSet = new Set(paths);
  if (pathSet.size !== paths.length || paths.some(path => path.split("/").slice(0, -1).some((_, index, parts) => pathSet.has(parts.slice(0, index + 1).join("/"))))) {
    throw new Error("Repository tree contains duplicate paths or a file-directory collision.");
  }
  const returnedVersion = codeVersion(value);
  if (params.version && returnedVersion !== params.version) throw new Error("The returned repository version differs from the requested version.");
  if (params.path !== undefined) {
    const expectedFile = value.files.find(file => file.path === params.path);
    if (value.file && (!expectedFile || value.file.path !== params.path || value.file.txid !== expectedFile.txid || value.file.sha256 !== expectedFile.sha256 || value.file.size !== expectedFile.size)) {
      throw new Error("Returned source evidence differs from the selected version's tree.");
    }
    if (!value.file && expectedFile) throw new Error("Source is missing from the selected version's tree.");
  }
  if ((value.repository.repoTxid ?? value.repository.txid) !== repo || (params.snapshot && value.snapshot.id !== params.snapshot)) {
    throw new Error("Repository snapshot changed. Refresh the repository before continuing.");
  }
  return value;
}
export function verifiedCodeSource(file: NonNullable<CodeDetail["file"]>, expected?: CodeFile) {
  if (!file || !validateCodePath(file.path) || !txid(file.txid) || !txid(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 60000 || typeof file.contentBase64 !== "string" || typeof file.content !== "string") throw new Error("Verified source bytes are unavailable.");
  const encoded = file.contentBase64;
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) throw new Error("Invalid source encoding.");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.toString("base64") !== encoded) throw new Error("Source encoding is not canonical base64.");
  const bytes = new Uint8Array(buffer);
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!codeSourceBytes(source) || source !== file.content || bytes.length !== file.size || sha256Hex(bytes) !== file.sha256 ||
    (expected && (file.path !== expected.path || file.txid !== expected.txid || file.size !== expected.size || file.sha256 !== expected.sha256))) {
    throw new Error("Source bytes do not match the confirmed file commitment.");
  }
  return { source, bytes };
}
export function codeEvents(detail: CodeDetail) { return detail.events ?? detail.commits ?? []; }
export function codeRepoId(repo: CodeRepository) { return repo.repoTxid ?? repo.txid; }
export function codeVersion(detail: CodeDetail, requested = "") { return (detail.selectedVersionTxid ?? detail.selectedVersion ?? detail.version ?? requested) || detail.repository.headTxid; }
