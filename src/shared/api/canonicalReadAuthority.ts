// Server provenance attests a checked canonical branch. Wall-clock timestamps and
// increasing totals are not branch authority. Request sequence is client-local.
export type CanonicalReadEvidence = {
  network?: string;
  indexedThroughBlock?: number;
  indexedThroughBlockHash?: string;
  snapshotId?: string;
  provenance?: {
    contract?: string;
    network?: string;
    surface?: string;
    ready?: boolean;
    coherent?: boolean;
    served?: string;
    requested?: string;
    indexedThroughBlock?: number;
    indexedThroughBlockHash?: string;
    tipHeight?: number;
    tipHash?: string;
    snapshotId?: string;
    componentSnapshotIds?: Record<string, string>;
    completeCollections?: { records?: boolean };
  };
  totalCounts?: { records?: number | null };
  collectionHasMore?: { records?: boolean };
  readSequence?: number;
  freshRead?: boolean;
};

export function canonicalReadEvidence(payload: CanonicalReadEvidence): CanonicalReadEvidence {
  return {
    network: payload.network,
    indexedThroughBlock: payload.indexedThroughBlock,
    indexedThroughBlockHash: payload.indexedThroughBlockHash,
    snapshotId: payload.snapshotId,
    provenance: payload.provenance,
    totalCounts: payload.totalCounts,
    collectionHasMore: payload.collectionHasMore,
    readSequence: payload.readSequence,
    freshRead: payload.freshRead,
  };
}

export type CanonicalSummarySurface = "infinity-summary" | "inception-summary" | "growth-summary" | "work-floor" | "work-summary" | "marketplace-summary";

export function hasCanonicalWorkFloorAuthority(evidence: CanonicalReadEvidence | undefined) {
  const surface = evidence?.provenance?.surface;
  return (surface === "work-floor" || surface === "work-summary" || surface === "growth-summary" || surface === "marketplace-summary") && hasCanonicalReadAuthority(evidence, surface);
}

export function hasCanonicalReadAuthority(
  evidence: CanonicalReadEvidence | undefined,
  surface: "registry" | CanonicalSummarySurface,
  recordCount?: number,
): boolean {
  return evidence?.freshRead === true && canonicalCheckpointMatches(evidence, surface, recordCount);
}

// A coherent summary can be displayed before its complete action book arrives.
// This does not authorize replacing state: that additionally requires a fresh read.
export function hasCanonicalSummaryCheckpoint(
  evidence: CanonicalReadEvidence | undefined,
  surface: CanonicalSummarySurface,
): boolean {
  return canonicalCheckpointMatches(evidence, surface);
}

function canonicalCheckpointMatches(
  evidence: CanonicalReadEvidence | undefined,
  surface: "registry" | CanonicalSummarySurface,
  recordCount?: number,
): boolean {
  const p = evidence?.provenance;
  const registry = surface === "registry";
  const hash = evidence?.indexedThroughBlockHash;
  const snapshot = evidence?.snapshotId;
  if (!evidence || !p ||
      evidence.network !== "livenet" ||
      p.contract !== (registry ? "proof-of-work-canonical-registry-v1" : "proof-of-work-canonical-summary-v1") ||
      (p.network !== undefined && p.network !== evidence.network) ||
      p.surface !== surface || p.ready !== true || p.coherent !== true || p.served !== "exact-tip" ||
      !Number.isSafeInteger(evidence.indexedThroughBlock) || Number(evidence.indexedThroughBlock) < 1 ||
      typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) ||
      typeof snapshot !== "string" || !/^[0-9a-f]{16,64}$/.test(snapshot) ||
      p.indexedThroughBlock !== evidence.indexedThroughBlock || p.tipHeight !== evidence.indexedThroughBlock ||
      p.indexedThroughBlockHash !== hash || p.tipHash !== hash || p.snapshotId !== snapshot) return false;
  if (registry) {
    return p.network === evidence.network && p.completeCollections?.records === true &&
      Number.isSafeInteger(recordCount) && Number(recordCount) >= 0 &&
      evidence.totalCounts?.records === recordCount && evidence.collectionHasMore?.records === false;
  }
  const components = p.componentSnapshotIds;
  const required = surface === "growth-summary" ? ["root", "activity", "registry", "token", "workFloor"]
    : surface === "marketplace-summary" ? ["root", "registry", "token", "workFloor"]
    : surface === "work-summary" ? ["root", "floor", "token"]
    : surface === "work-floor" ? ["root"] : ["root", "token"];
  return Boolean(components && required.every((key) => components[key] === snapshot) &&
    Object.values(components).every((value) => value === snapshot));
}

export function canonicalReadIsOlder(next?: CanonicalReadEvidence, current?: CanonicalReadEvidence) {
  return Number.isSafeInteger(next?.readSequence) && Number.isSafeInteger(current?.readSequence) &&
    Number(next?.readSequence) < Number(current?.readSequence);
}
