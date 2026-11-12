/**
 * Materialize a rejected canonical PWID record without changing its replay
 * output, byte witness, reason, attribution, or position. This is a projection
 * shape, not a protocol-validity decision.
 */
export function canonicalPwidRejectionProjection(item, semanticKind) {
  if (item?.protocol !== "pwid1" || item?.valid !== false ||
      item?._workAmoV5ReplayBound !== true ||
      item?.workAmoV5RawCandidate !== true ||
      item?.workAmoV5ReplayOutcome?.kind !== "pwid1-invalid" ||
      item?.workAmoV5ReplayOutcome?.valid !== false) {
    throw new Error("PWID rejection projection requires an exact invalid raw replay.");
  }
  let attemptedKind = semanticKind;
  if (semanticKind === "protocol-event-invalid") {
    if (item.workAmoV5RawDecodeValid !== true) {
      attemptedKind = "id-event";
    } else {
      const action = String(item.payload ?? "").split(":")[1]?.trim().toLowerCase() ?? "";
      const actions = { r: "register", r2: "register", u: "update", t: "transfer",
        buy5: "buy", list5: "list", seal5: "seal", delist5: "delist" };
      attemptedKind = `id-${actions[action] ?? (action || "event")}`;
    }
  }
  if (typeof attemptedKind !== "string" || !attemptedKind.startsWith("id-") ||
      attemptedKind.endsWith("-invalid")) {
    throw new Error("PWID rejection projection lacks its canonical attempted kind.");
  }
  return { ...item, kind: "id-event-invalid", attemptedKind };
}
