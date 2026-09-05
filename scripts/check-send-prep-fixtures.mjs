import assert from "node:assert/strict";
import { assertUtxos, SendPrepFixturePreconditionError } from "./check-send-prep-regressions.mjs";

const fixture = { address: "public-test-fixture", label: "send prep", minConfirmedUtxos: 1 };
const output = { txid: "ab".repeat(32), vout: 0, value: 546, status: { confirmed: true } };
assert.throws(() => assertUtxos(fixture, []), SendPrepFixturePreconditionError);
assert.throws(() => assertUtxos(fixture, [{ ...output, status: { confirmed: false } }]), SendPrepFixturePreconditionError);
assert.throws(() => assertUtxos(fixture, [{ ...output, status: {} }]), /unqualified/u);
assert.throws(() => assertUtxos(fixture, [output, output]), /duplicate/u);
assert.throws(() => assertUtxos(fixture, [{ ...output, value: 0.5 }]), /malformed/u);
assert.throws(() => assertUtxos({ ...fixture, minConfirmedUtxos: 0 }, []), /positive/u);
assert.deepEqual(assertUtxos(fixture, [output]), {
  address: fixture.address, confirmedUtxos: 1, confirmedValueSats: "546", totalUtxos: 1,
});
assert.equal(assertUtxos(fixture, [
  { ...output, value: Number.MAX_SAFE_INTEGER },
  { ...output, vout: 1, value: Number.MAX_SAFE_INTEGER },
]).confirmedValueSats, "18014398509481982");
console.log("Send-preparation fixture precondition and exact UTXO checks passed (8 cases).");
