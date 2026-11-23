import assert from "node:assert/strict";

// These integers and bounds are fixed by the V6 proof-unit declaration.
// Keep the release verifier independent of the runtime estimator.
const FACES = [20_000, 50_000, 100_000];
const SUPPLY_ATOMS = 21_000_000n * 100_000_000n;
const DENOMINATOR = SUPPLY_ATOMS * 100_000_000n;

export function assertWorkAmoV6ProofEstimates(status, label) {
  const { estimates, networkValueBeforeQ8 } = status;
  assert.ok(
    estimates && typeof estimates === "object" && !Array.isArray(estimates),
    `${label} is missing the V6 estimates map`,
  );
  if (networkValueBeforeQ8 === "") {
    assert.deepEqual(
      Object.keys(estimates), [],
      `${label} has V6 estimates without a network value`,
    );
    return;
  }
  assert.ok(
    typeof networkValueBeforeQ8 === "string" && /^[1-9][0-9]*$/u.test(networkValueBeforeQ8),
    `${label} has a noncanonical V6 network value`,
  );
  const networkValue = BigInt(networkValueBeforeQ8);
  const expectedFaces = [];
  for (const face of FACES) {
    const atoms = (BigInt(face) * DENOMINATOR) / networkValue;
    if (atoms === 0n || atoms > SUPPLY_ATOMS) continue;

    expectedFaces.push(String(face));
    const minimum = (atoms * networkValue + DENOMINATOR - 1n) / DENOMINATOR;
    const estimate = estimates[String(face)];
    assert.ok(
      estimate?.estimateOnly === true &&
        estimate.unitFaceProofs === face &&
        estimate.unitPriceSats === String(face) &&
        estimate.unitAmountAtoms === atoms.toString() &&
        estimate.unitMinimumPriceSats === minimum.toString() &&
        estimate.unitNetworkValueBeforeQ8 === networkValueBeforeQ8,
      `${label} is missing exact V6 terms for ${face} proofs at N=${networkValueBeforeQ8}`,
    );
  }
  // Object.keys enumerates canonical integer keys in ascending order.
  assert.deepEqual(
    Object.keys(estimates), expectedFaces,
    `${label} has unexpected V6 estimate faces at N=${networkValueBeforeQ8}`,
  );
}

export function assertWorkAmoV6ResponseEstimates(payload, label, { requireFloor = false } = {}) {
  const floor = payload.workFloor ?? payload.floor;
  const source = payload.workNetworkValueQ8 ?? floor?.liveNetworkValueQ8 ??
    floor?.actualValue?.liveNetworkValueQ8 ?? floor?.networkValueQ8;
  const networkValue = source ?? "";
  if (requireFloor) {
    assert.ok(floor && typeof networkValue === "string" && /^[1-9][0-9]*$/u.test(networkValue),
      `${label} is missing its canonical V6 floor input`);
  }
  for (const status of [payload.workAmoV6, ...(floor ? [floor.workAmoV6] : [])]) {
    assert.equal(status?.networkValueBeforeQ8, networkValue,
      `${label} V6 estimates disagree with the response's own network value`);
    assertWorkAmoV6ProofEstimates(status, label);
  }
}
