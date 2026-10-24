import assert from "node:assert/strict";
import test from "node:test";
import { address, networks, payments } from "bitcoinjs-lib";
import {
  WORK_BATCH_MAX_PAYLOAD_BYTES, WORK_BATCH_MAX_RECIPIENTS, WORK_BATCH_MAX_SUBATOMS,
  WORK_BATCH_TOKEN_ID, buildWorkBatchPayload, canonicalWorkBatchAddress,
  parseWorkBatchPayload, validateWorkBatchRecipients, workBatchMovementValueQ8,
  workBatchNonSelfAmountSubatoms,
} from "./workBatch.mjs";
import { WORK_TOKEN_ID, WORK_SUBATOM_UNIT_SCALE } from "../../../server/work-units.mjs";

const receiver = (number, network = networks.bitcoin) => {
  const hash = Buffer.alloc(20); hash.writeUInt32BE(number, 16);
  return payments.p2pkh({ hash, network }).address;
};
const A = receiver(1), B = receiver(2), C = receiver(3);
const wire = (text) => `pwt1:batch1:${WORK_BATCH_TOKEN_ID}:${Buffer.from(text).toString("base64url")}`;
const recipients = [[A, "1"], [B, "20000000000000001"]];

test("round trip retains exact Q16 quantities, order and canonical WORK identity", () => {
  assert.equal(WORK_BATCH_TOKEN_ID, WORK_TOKEN_ID);
  assert.equal(WORK_BATCH_MAX_SUBATOMS, 21_000_000n * WORK_SUBATOM_UNIT_SCALE);
  const payload = buildWorkBatchPayload(recipients);
  assert.equal(payload, wire(JSON.stringify(recipients)));
  assert.deepEqual(parseWorkBatchPayload(payload), {
    kind: "batch", amountVersion: "batch1", tokenId: WORK_BATCH_TOKEN_ID,
    recipients: [{ recipientAddress: A, amountSubatoms: "1" }, { recipientAddress: B, amountSubatoms: "20000000000000001" }],
    totalAmountSubatoms: "20000000000000002", recipientCount: 2,
  });
  assert.equal(buildWorkBatchPayload(parseWorkBatchPayload(payload).recipients), payload);
});

test("wire rejects malformed, noncanonical and non-Q16 encodings", () => {
  const good = buildWorkBatchPayload(recipients);
  for (const bad of [
    `${good}=`, `${good}\n`, ` ${good}`, good.replace(WORK_BATCH_TOKEN_ID, "a".repeat(64)),
    wire(JSON.stringify(recipients, null, 1)), wire(JSON.stringify(recipients).replace('"1"', '1')),
    wire(JSON.stringify(recipients).replace(A, `\\u0031${A.slice(1)}`)),
    wire(JSON.stringify([[A, "01"], [B, "1"]])), wire(JSON.stringify([[A, "0"], [B, "1"]])),
    wire(JSON.stringify([[A, "-1"], [B, "1"]])), wire(JSON.stringify([[A, "+1"], [B, "1"]])),
    wire(JSON.stringify([[A, "1e2"], [B, "1"]])), wire(JSON.stringify([[A, "1.0"], [B, "1"]])),
    wire(JSON.stringify([[A, "1", 0], [B, "1"]])), wire(JSON.stringify([{ recipientAddress: A, amountSubatoms: "1" }, [B, "1"]])),
    wire(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(recipients))])),
    wire(Buffer.from([0xc0, 0xaf])), "pwt1:batch1:" + "a".repeat(WORK_BATCH_MAX_PAYLOAD_BYTES),
  ]) assert.equal(parseWorkBatchPayload(bad), null, `accepted ${bad.slice(0, 140)}`);
  assert.throws(() => validateWorkBatchRecipients(new Array(2)));
  assert.throws(() => buildWorkBatchPayload([{ recipientAddress: A, amountSubatoms: "1", label: "extra" }, [B, "1"]]));
});

test("validates checksum, network, duplicate identities and canonical Bech32 casing", () => {
  const witness = address.fromOutputScript(Buffer.from(`0014${"ab".repeat(20)}`, "hex"), networks.bitcoin);
  assert.equal(canonicalWorkBatchAddress(witness.toUpperCase()), witness);
  assert.equal(parseWorkBatchPayload(buildWorkBatchPayload([[witness.toUpperCase(), "1"], [A, "1"]])).recipients[0].recipientAddress, witness);
  assert.equal(parseWorkBatchPayload(wire(JSON.stringify([[witness.toUpperCase(), "1"], [A, "1"]]))), null);
  assert.throws(() => buildWorkBatchPayload([[witness, "1"], [witness.toUpperCase(), "2"]]));
  assert.throws(() => buildWorkBatchPayload([[A, "1"], [A, "2"]]));
  assert.throws(() => buildWorkBatchPayload([[A.slice(0, -1) + "x", "1"], [B, "1"]]));
  assert.throws(() => buildWorkBatchPayload([[receiver(1, networks.testnet), "1"], [B, "1"]]));
  assert.throws(() => buildWorkBatchPayload(recipients, { validateAddress: () => false }));
  assert.throws(() => buildWorkBatchPayload(recipients, { network: "unknown" }));
});

test("cardinality, exact supply cap and one-subatom positive tails remain bounded", () => {
  const full = Array.from({ length: WORK_BATCH_MAX_RECIPIENTS }, (_, index) => [receiver(index + 1), "1"]);
  assert.equal(parseWorkBatchPayload(buildWorkBatchPayload(full)).recipientCount, 256);
  assert.throws(() => buildWorkBatchPayload([...full, [receiver(257), "1"]]));
  assert.throws(() => buildWorkBatchPayload([[A, "1"]]));
  assert.equal(parseWorkBatchPayload(buildWorkBatchPayload([[A, (WORK_BATCH_MAX_SUBATOMS - 1n).toString()], [B, "1"]])).totalAmountSubatoms, WORK_BATCH_MAX_SUBATOMS.toString());
  assert.throws(() => buildWorkBatchPayload([[A, WORK_BATCH_MAX_SUBATOMS.toString()], [B, "1"]]));
});

test("batch movement excludes self, values at one opening and floors only once", () => {
  const batch = validateWorkBatchRecipients([[A, "8"], [B, "1"], [C, "1"]]);
  const opening = (WORK_BATCH_MAX_SUBATOMS / 2n).toString();
  assert.equal(workBatchNonSelfAmountSubatoms(batch, A), "2");
  assert.equal(workBatchMovementValueQ8(batch, A, opening), "1");
  const reordered = validateWorkBatchRecipients([[C, "1"], [A, "8"], [B, "1"]]);
  assert.equal(workBatchMovementValueQ8(reordered, A, opening), "1");
  assert.equal(workBatchMovementValueQ8(batch, A, "0"), "0");
  assert.throws(() => workBatchMovementValueQ8(batch, A, 1));
});
