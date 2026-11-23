import { createHash } from "node:crypto";

function directSnapshotId(payload) {
  return String(payload?.snapshotId ?? "").trim();
}

function directIndexedThroughBlock(payload) {
  const value = payload?.indexedThroughBlock;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function directIndexedThroughBlockHash(payload) {
  const value = String(payload?.indexedThroughBlockHash ?? "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/u.test(value) ? value : "";
}

export function auditSnapshotSentinel(payload) {
  const snapshotId = directSnapshotId(payload);
  const indexedThroughBlock = directIndexedThroughBlock(payload);
  const indexedThroughBlockHash = directIndexedThroughBlockHash(payload);
  if (!snapshotId || !indexedThroughBlock || !indexedThroughBlockHash) {
    throw new Error(
      "audit snapshot sentinel is missing its exact id, height, or block hash",
    );
  }
  return { indexedThroughBlock, indexedThroughBlockHash, snapshotId };
}

export function snapshotSentinelsMatch(left, right) {
  return (
    left.snapshotId === right.snapshotId &&
    left.indexedThroughBlock === right.indexedThroughBlock &&
    left.indexedThroughBlockHash === right.indexedThroughBlockHash
  );
}

export function payloadMatchesAuditSentinel(
  payload,
  sentinel,
  requireSnapshot = true,
) {
  return (
    directIndexedThroughBlock(payload) === sentinel.indexedThroughBlock &&
    directIndexedThroughBlockHash(payload) ===
      sentinel.indexedThroughBlockHash &&
    (!requireSnapshot || directSnapshotId(payload) === sentinel.snapshotId)
  );
}

export function marketplaceSummaryMatchesAuditSentinel(payload, sentinel) {
  const snapshotId = directSnapshotId(payload);
  const derivedFromSnapshotId = String(
    payload?.derivedFromSnapshotId ?? "",
  ).trim();
  const directBinding =
    snapshotId === sentinel.snapshotId && !derivedFromSnapshotId;
  const derivedBinding =
    snapshotId !== sentinel.snapshotId &&
    derivedFromSnapshotId === sentinel.snapshotId;
  return Boolean(snapshotId) && (directBinding || derivedBinding) &&
    freshSummaryProvenanceMatches(payload, sentinel, "marketplace-summary", ["root", "registry", "token", "workFloor"]);
}

function freshSummaryProvenanceMatches(payload, sentinel, surface, requiredComponents) {
  const snapshotId = directSnapshotId(payload);
  const provenance = payload?.provenance;
  const componentSnapshotIds = provenance?.componentSnapshotIds;
  return (
    payloadMatchesAuditSentinel(payload, sentinel, false) &&
    payloadMatchesAuditSentinel(provenance, sentinel, false) &&
    provenance?.ready === true &&
    provenance?.coherent === true &&
    provenance?.catchingUp === false &&
    provenance?.lagBlocks === 0 &&
    provenance?.contract === "proof-of-work-canonical-summary-v1" &&
    provenance?.surface === surface &&
    provenance?.requested === "fresh" &&
    provenance?.served === "exact-tip" &&
    provenance?.tipHeight === sentinel.indexedThroughBlock &&
    provenance?.tipHash === sentinel.indexedThroughBlockHash &&
    provenance?.snapshotId === snapshotId &&
    componentSnapshotIds &&
    typeof componentSnapshotIds === "object" &&
    !Array.isArray(componentSnapshotIds) &&
    Object.keys(componentSnapshotIds).length === requiredComponents.length &&
    requiredComponents.every((component) => {
      const candidate = component === "root" ? payload : payload?.[component];
      return (
        componentSnapshotIds[component] === snapshotId &&
        candidate?.snapshotId === snapshotId &&
        payloadMatchesAuditSentinel(candidate, sentinel, false)
      );
    })
  );
}

function fullMarketplaceChildMatchesEvidence(payload, sourceSnapshotId) {
  // Keep the published field order used by summaryWithDerivedSnapshot. These
  // are the two reconciliations the full marketplace summary can expose.
  function matches(label, evidence) {
    const encoded = JSON.stringify({ evidence, label, sourceSnapshotId });
    return createHash("sha256").update(encoded).digest("hex").slice(0, 24) === payload.snapshotId;
  }
  if (matches("marketplace-token-listing-authority", payload.token?.listingAuthority ?? null)) {
    return true;
  }
  const listings = payload.registry?.listings;
  return Array.isArray(listings) && matches(
    "marketplace-id-listing-reconciliation",
    listings.map((listing) => listing?.listingId).filter(Boolean),
  );
}

export function marketplaceSummarySetAligned({ marketplace, token, work, growth }, workTokenId) {
  if (!directSnapshotId(work) || !directIndexedThroughBlock(work) || !directIndexedThroughBlockHash(work)) {
    return false;
  }
  const sentinel = auditSnapshotSentinel(work);
  const direct = [
    [work, "work-summary", ["root", "floor", "token"]],
    [token, `token-summary:${workTokenId}`, ["root"]],
    [growth, "growth-summary", ["root", "activity", "registry", "token", "workFloor"]],
  ];
  if (!direct.every(([payload, surface, components]) =>
    payload?.network === "livenet" &&
    typeof payload.snapshotId === "string" &&
    !Object.hasOwn(payload, "derivedFromSnapshotId") &&
    payloadMatchesAuditSentinel(payload, sentinel) &&
    freshSummaryProvenanceMatches(payload, sentinel, surface, components)
  )) {
    return false;
  }

  // The immutable marketplace reader may rebind all components to one child
  // after verifying the listing authority. Its direct parent must be this ledger.
  if (
    marketplace?.network !== "livenet" || typeof marketplace.snapshotId !== "string" ||
    !marketplaceSummaryMatchesAuditSentinel(marketplace, sentinel)
  ) return false;
  if (!Object.hasOwn(marketplace, "derivedFromSnapshotId")) return true;
  return marketplace.derivedFromSnapshotId === sentinel.snapshotId &&
    fullMarketplaceChildMatchesEvidence(marketplace, sentinel.snapshotId);
}
