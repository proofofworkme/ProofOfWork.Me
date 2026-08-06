import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

export const FULL_CANONICAL_SNAPSHOT_MODEL =
  "proof-of-work-full-canonical-snapshot-v1";

const FULL_CANONICAL_SNAPSHOT_CREATION_PROOFS = new WeakMap();

function invalidSnapshotTree(reason) {
  return new TypeError(
    `Canonical snapshot values must be a strict JSON tree (${reason}).`,
  );
}

function nativeConstructorOwnsPrototype(prototype, name) {
  const constructorProperty = Object.getOwnPropertyDescriptor(
    prototype,
    "constructor",
  );
  const constructor = constructorProperty?.value;
  return (
    typeof constructor === "function" &&
    constructor.name === name &&
    constructor.prototype === prototype &&
    Function.prototype.toString.call(constructor) ===
      `function ${name}() { [native code] }`
  );
}

function intrinsicObjectPrototype(prototype) {
  return (
    prototype === Object.prototype ||
    (prototype !== null &&
      Object.getPrototypeOf(prototype) === null &&
      nativeConstructorOwnsPrototype(prototype, "Object"))
  );
}

function intrinsicArrayPrototype(prototype) {
  return (
    prototype === Array.prototype ||
    (Array.isArray(prototype) &&
      intrinsicObjectPrototype(Object.getPrototypeOf(prototype)) &&
      nativeConstructorOwnsPrototype(prototype, "Array"))
  );
}

function inspectedSnapshotTree(value) {
  const containers = [];
  const states = new WeakMap();
  const stack = [{ exiting: false, value }];

  while (stack.length > 0) {
    const frame = stack.pop();
    const current = frame.value;
    if (frame.exiting) {
      states.set(current, 2);
      continue;
    }
    if (current === null) {
      continue;
    }
    const currentType = typeof current;
    if (currentType === "string" || currentType === "boolean") {
      continue;
    }
    if (currentType === "number") {
      if (!Number.isFinite(current)) {
        throw invalidSnapshotTree("non-finite number");
      }
      continue;
    }
    if (currentType !== "object") {
      throw invalidSnapshotTree(`unsupported ${currentType} value`);
    }
    if (nodeTypes.isProxy(current)) {
      throw invalidSnapshotTree("Proxy objects are not allowed");
    }

    const state = states.get(current);
    if (state === 1) {
      throw invalidSnapshotTree("cycle detected");
    }
    if (state === 2) {
      continue;
    }

    const isArray = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (
      (isArray && !intrinsicArrayPrototype(prototype)) ||
      (!isArray &&
        prototype !== null &&
        !intrinsicObjectPrototype(prototype))
    ) {
      throw invalidSnapshotTree("custom or exotic object prototype");
    }

    const children = [];
    const ownKeys = Reflect.ownKeys(current);
    if (isArray) {
      let indexedProperties = 0;
      for (const key of ownKeys) {
        if (key === "length") {
          continue;
        }
        if (
          typeof key !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/u.test(key)
        ) {
          throw invalidSnapshotTree("array has a non-index property");
        }
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= current.length ||
          String(index) !== key
        ) {
          throw invalidSnapshotTree("array index is invalid");
        }
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (!property || !("value" in property) || !property.enumerable) {
          throw invalidSnapshotTree("array accessor or hidden value");
        }
        indexedProperties += 1;
        children.push(property.value);
      }
      if (indexedProperties !== current.length) {
        throw invalidSnapshotTree("sparse array");
      }
    } else {
      for (const key of ownKeys) {
        if (typeof key !== "string") {
          throw invalidSnapshotTree("symbol property");
        }
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (!property || !("value" in property) || !property.enumerable) {
          throw invalidSnapshotTree("accessor or hidden property");
        }
        children.push(property.value);
      }
    }

    states.set(current, 1);
    containers.push(current);
    stack.push({ exiting: true, value: current });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ exiting: false, value: children[index] });
    }
  }

  return containers;
}

function freezeInspectedSnapshotTree(containers) {
  for (let index = containers.length - 1; index >= 0; index -= 1) {
    const value = containers[index];
    if (!Object.isFrozen(value)) {
      Object.freeze(value);
    }
  }
}

function installCreationProof(payload, descriptor, snapshotId, surface) {
  FULL_CANONICAL_SNAPSHOT_CREATION_PROOFS.set(
    payload,
    Object.freeze({ descriptor, snapshotId, surface }),
  );
}

function snapshotDigestBody(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const {
    canonicalSnapshot: _canonicalSnapshot,
    snapshotId: _snapshotId,
    ...body
  } = payload;
  return body;
}

function snapshotDigest(payload, surface) {
  const serialized = JSON.stringify(
    snapshotDigestBody(payload),
    (key, value) => {
      if (key === "canonicalSnapshot") {
        return undefined;
      }
      return typeof value === "bigint" ? value.toString() : value;
    },
  );
  const hash = createHash("sha256");
  hash.update(FULL_CANONICAL_SNAPSHOT_MODEL, "utf8");
  hash.update("\n", "utf8");
  hash.update(String(surface ?? "").trim(), "utf8");
  hash.update("\n", "utf8");
  hash.update(serialized, "utf8");
  return hash.digest("hex");
}

export function canonicalSnapshotContentSha256(payload, surface = "") {
  return snapshotDigest(
    payload,
    String(surface || payload?.canonicalSnapshot?.surface || ""),
  );
}

export function canonicalSnapshotIdentitySha256(payload, surface) {
  return snapshotDigest(payload, surface);
}

function normalizedSnapshotId(value) {
  const snapshotId =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  return snapshotId && snapshotId.length <= 128 && !/\s/u.test(snapshotId)
    ? snapshotId
    : "";
}

function normalizedBlockHash(value) {
  const hash =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{64}$/u.test(hash) ? hash : "";
}

function normalizedSnapshotHeight(value) {
  const height =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]+$/u.test(value)
        ? Number(value)
        : 0;
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

function snapshotHeight(payload) {
  const height = Math.max(
    normalizedSnapshotHeight(payload?.indexedThroughBlock),
    normalizedSnapshotHeight(payload?.metrics?.indexedThroughBlock),
    normalizedSnapshotHeight(payload?.stats?.indexedThroughBlock),
  );
  return Number.isSafeInteger(height) && height > 0 ? height : 0;
}

function snapshotHash(payload) {
  return normalizedBlockHash(
    payload?.indexedThroughBlockHash ??
      payload?.provenance?.indexedThroughBlockHash ??
      payload?.sourceHashes?.blockScan,
  );
}

export function withFullCanonicalSnapshot(payload, surface) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  inspectedSnapshotTree(payload);
  const sourceSnapshotId = normalizedSnapshotId(
    payload.sourceSnapshotId ?? payload.snapshotId,
  );
  const indexedThroughBlock = snapshotHeight(payload);
  const indexedThroughBlockHash = snapshotHash(payload);
  const normalizedSurface = String(surface ?? "").trim();
  if (
    !sourceSnapshotId ||
    !indexedThroughBlock ||
    !indexedThroughBlockHash ||
    !normalizedSurface
  ) {
    return payload;
  }
  const {
    canonicalSnapshot: _canonicalSnapshot,
    snapshotId: _snapshotId,
    ...payloadWithoutEnvelope
  } = payload;
  const identityPayload = {
    ...payloadWithoutEnvelope,
    complete: true,
    snapshotKind: "full-canonical",
    sourceSnapshotId,
  };
  const snapshotId = canonicalSnapshotIdentitySha256(
    identityPayload,
    normalizedSurface,
  );
  const fullPayload = {
    ...identityPayload,
    snapshotId,
  };
  const result = {
    ...fullPayload,
    canonicalSnapshot: {
      contentSha256: snapshotId,
      full: true,
      indexedThroughBlock,
      indexedThroughBlockHash,
      model: FULL_CANONICAL_SNAPSHOT_MODEL,
      snapshotId,
      surface: normalizedSurface,
    },
  };
  const inspected = inspectedSnapshotTree(result);
  freezeInspectedSnapshotTree(inspected);
  installCreationProof(
    result,
    result.canonicalSnapshot,
    snapshotId,
    normalizedSurface,
  );
  return result;
}

export function coherentFullCanonicalSnapshot(payload, surface = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const creationProof = FULL_CANONICAL_SNAPSHOT_CREATION_PROOFS.get(payload);
  let inspected = null;
  if (!creationProof) {
    try {
      inspected = inspectedSnapshotTree(payload);
    } catch {
      return null;
    }
  }
  const descriptor = payload.canonicalSnapshot;
  const snapshotId = normalizedSnapshotId(payload.snapshotId);
  const indexedThroughBlock = snapshotHeight(payload);
  const indexedThroughBlockHash = snapshotHash(payload);
  const contentSha256 =
    typeof descriptor?.contentSha256 === "string"
      ? descriptor.contentSha256.trim().toLowerCase()
      : "";
  const expectedSurface = String(surface ?? "").trim();
  if (
    payload.complete !== true ||
    payload.snapshotKind !== "full-canonical" ||
    !descriptor ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor) ||
    descriptor.model !== FULL_CANONICAL_SNAPSHOT_MODEL ||
    descriptor.full !== true ||
    descriptor.snapshotId !== snapshotId ||
    normalizedSnapshotHeight(descriptor.indexedThroughBlock) !==
      indexedThroughBlock ||
    normalizedBlockHash(descriptor.indexedThroughBlockHash) !==
      indexedThroughBlockHash ||
    (expectedSurface && descriptor.surface !== expectedSurface) ||
    typeof descriptor.surface !== "string" ||
    !descriptor.surface ||
    descriptor.surface !== descriptor.surface.trim() ||
    !/^[0-9a-f]{64}$/u.test(contentSha256) ||
    contentSha256 !== snapshotId
  ) {
    return null;
  }
  if (
    !creationProof ||
    creationProof.descriptor !== descriptor ||
    creationProof.snapshotId !== snapshotId ||
    creationProof.surface !== descriptor.surface
  ) {
    const digest = snapshotDigest(payload, descriptor.surface);
    if (digest !== snapshotId) {
      return null;
    }
    if (inspected) {
      try {
        freezeInspectedSnapshotTree(inspected);
      } catch {
        return null;
      }
    }
    installCreationProof(payload, descriptor, snapshotId, descriptor.surface);
  }
  return {
    contentSha256,
    indexedThroughBlock,
    indexedThroughBlockHash,
    model: descriptor.model,
    snapshotId,
    surface: String(descriptor.surface ?? ""),
  };
}

export function fullCanonicalSnapshotClaimed(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  if (nodeTypes.isProxy(payload)) {
    return true;
  }
  const prototype = Object.getPrototypeOf(payload);
  if (
    prototype !== null &&
    !intrinsicObjectPrototype(prototype)
  ) {
    return true;
  }
  const canonicalSnapshot = Object.getOwnPropertyDescriptor(
    payload,
    "canonicalSnapshot",
  );
  const snapshotKind = Object.getOwnPropertyDescriptor(payload, "snapshotKind");
  return Boolean(
    canonicalSnapshot &&
      (!("value" in canonicalSnapshot) || canonicalSnapshot.value)
  ) || Boolean(
    snapshotKind &&
      (!("value" in snapshotKind) || snapshotKind.value === "full-canonical")
  );
}

export function stripFullCanonicalSnapshotClaim(payload) {
  if (!fullCanonicalSnapshotClaimed(payload)) {
    return payload;
  }
  if (nodeTypes.isProxy(payload)) {
    return {};
  }
  const withoutFullCanonicalClaim = {};
  for (const key of Reflect.ownKeys(payload)) {
    if (
      typeof key !== "string" ||
      key === "canonicalSnapshot" ||
      key === "snapshotId" ||
      key === "snapshotKind"
    ) {
      continue;
    }
    const property = Object.getOwnPropertyDescriptor(payload, key);
    if (!property || !("value" in property) || !property.enumerable) {
      continue;
    }
    Object.defineProperty(withoutFullCanonicalClaim, key, {
      configurable: true,
      enumerable: true,
      value: property.value,
      writable: true,
    });
  }
  const snapshotKind = Object.getOwnPropertyDescriptor(payload, "snapshotKind");
  if (
    snapshotKind &&
    "value" in snapshotKind &&
    snapshotKind.value &&
    snapshotKind.value !== "full-canonical"
  ) {
    withoutFullCanonicalClaim.snapshotKind = snapshotKind.value;
  }
  return withoutFullCanonicalClaim;
}

export function coherentCanonicalSnapshotAtBoundary(payload, surface) {
  if (!fullCanonicalSnapshotClaimed(payload)) {
    return payload;
  }
  return coherentFullCanonicalSnapshot(payload, surface)
    ? payload
    : stripFullCanonicalSnapshotClaim(payload);
}

export function transformFullCanonicalSnapshot(
  payload,
  surface,
  transform,
  { preserveCanonicalClaim = true } = {},
) {
  const transformed = transform(payload);
  if (transformed === payload) {
    return coherentCanonicalSnapshotAtBoundary(payload, surface);
  }
  if (
    fullCanonicalSnapshotClaimed(transformed) &&
    coherentFullCanonicalSnapshot(transformed, surface)
  ) {
    return transformed;
  }
  if (!fullCanonicalSnapshotClaimed(payload)) {
    return coherentCanonicalSnapshotAtBoundary(transformed, surface);
  }
  if (
    !coherentFullCanonicalSnapshot(payload, surface) ||
    preserveCanonicalClaim !== true
  ) {
    return stripFullCanonicalSnapshotClaim(transformed);
  }
  const rewrapped = withFullCanonicalSnapshot(transformed, surface);
  return coherentFullCanonicalSnapshot(rewrapped, surface)
    ? rewrapped
    : stripFullCanonicalSnapshotClaim(transformed);
}
