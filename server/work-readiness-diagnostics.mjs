/** Add a precise read-failure explanation without changing any admission bit. */
export function qualifyWorkReadinessStatus(status, {
  declarationEvidenceVerified = false,
  migrationReadinessAvailable = false,
  exactTipVerified = false,
} = {}) {
  if (
    declarationEvidenceVerified !== true ||
    status?.protocolWritesEnabled === true ||
    status?.reasonCode !== "work-amo-v8-declaration-evidence-unavailable"
  ) return status;
  return {
    ...status,
    reasonCode: !exactTipVerified
      ? "work-amo-v8-exact-readiness-sweep-unavailable"
      : !migrationReadinessAvailable
        ? "work-amo-v8-migration-readiness-unavailable"
        : "work-amo-v8-precision-migration-not-ready",
    readinessDiagnostics: {
      declarationEvidenceVerified: true,
      exactTipVerified,
      migrationReadinessAvailable,
      admissionReasonCode: status.reasonCode,
    },
  };
}
