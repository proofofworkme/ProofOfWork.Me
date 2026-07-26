export const CANONICAL_UNICODE_CASE_MAPPING_VERSION = "17.0";

export function compareCanonicalUtf8(left, right) {
  return Buffer.compare(
    Buffer.from(String(left ?? ""), "utf8"),
    Buffer.from(String(right ?? ""), "utf8"),
  );
}

export function canonicalUnicodeCaseMappingCompatible(
  version = process.versions.unicode,
) {
  return String(version ?? "") ===
    CANONICAL_UNICODE_CASE_MAPPING_VERSION;
}

export function assertCanonicalUnicodeCaseMappingVersion() {
  if (canonicalUnicodeCaseMappingCompatible()) {
    return;
  }
  const error = new Error(
    `Canonical PowID case mapping requires Unicode ${CANONICAL_UNICODE_CASE_MAPPING_VERSION}; runtime reports ${String(process.versions.unicode ?? "unknown")}.`,
  );
  error.code = "POWID_UNICODE_CASE_MAPPING_VERSION_MISMATCH";
  throw error;
}
