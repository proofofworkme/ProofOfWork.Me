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
  const provenance = payload?.provenance;
  const componentSnapshotIds = provenance?.componentSnapshotIds;
  const requiredComponents = ["root", "registry", "token", "workFloor"];
  const components = {
    registry: payload?.registry,
    root: payload,
    token: payload?.token,
    workFloor: payload?.workFloor,
  };
  return (
    Boolean(snapshotId) &&
    (directBinding || derivedBinding) &&
    payloadMatchesAuditSentinel(payload, sentinel, false) &&
    payloadMatchesAuditSentinel(provenance, sentinel, false) &&
    provenance?.ready === true &&
    provenance?.coherent === true &&
    provenance?.catchingUp === false &&
    provenance?.lagBlocks === 0 &&
    provenance?.contract === "proof-of-work-canonical-summary-v1" &&
    provenance?.surface === "marketplace-summary" &&
    provenance?.requested === "fresh" &&
    provenance?.served === "exact-tip" &&
    provenance?.tipHeight === sentinel.indexedThroughBlock &&
    provenance?.tipHash === sentinel.indexedThroughBlockHash &&
    directSnapshotId(provenance) === snapshotId &&
    componentSnapshotIds &&
    typeof componentSnapshotIds === "object" &&
    !Array.isArray(componentSnapshotIds) &&
    Object.keys(componentSnapshotIds).length === requiredComponents.length &&
    requiredComponents.every((component) => {
      const candidate = components[component];
      return (
        String(componentSnapshotIds[component] ?? "").trim() === snapshotId &&
        directSnapshotId(candidate) === snapshotId &&
        payloadMatchesAuditSentinel(candidate, sentinel, false)
      );
    })
  );
}
