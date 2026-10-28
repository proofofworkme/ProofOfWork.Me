import assert from "node:assert/strict";
import test from "node:test";
import { address, networks, payments } from "bitcoinjs-lib";
import {
  WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES, WORK_MAIL_BATCH_MAX_RECIPIENTS, WORK_MAIL_BATCH_MAX_SUBATOMS,
  WORK_MAIL_BATCH_TOKEN_ID, buildWorkMailBatchPayload, canonicalWorkMailBatchAddress,
  parseWorkMailBatchPayload, validateWorkMailBatchRecipients, workMailBatchMovementValueQ8,
  workMailBatchNonSelfAmountSubatoms, workMailBatchMemoIsOrdinary, workMailBatchEnvelopeMatches,
} from "./workMailBatch.mjs";
import { WORK_TOKEN_ID, WORK_SUBATOM_UNIT_SCALE } from "../../../server/work-units.mjs";

const receiver = (number, network = networks.bitcoin) => {
  const hash = Buffer.alloc(20); hash.writeUInt32BE(number, 16);
  return payments.p2pkh({ hash, network }).address;
};
const A = receiver(1), B = receiver(2), C = receiver(3);
const wire = (text) => `pwt1:mailbatch1:${WORK_MAIL_BATCH_TOKEN_ID}:${Buffer.from(text).toString("base64url")}`;
const recipients = [[A, "1"], [B, "20000000000000001"]];

test("round trip retains exact Q16 quantities, order and canonical WORK identity", () => {
  assert.equal(WORK_MAIL_BATCH_TOKEN_ID, WORK_TOKEN_ID);
  assert.equal(WORK_MAIL_BATCH_MAX_SUBATOMS, 21_000_000n * WORK_SUBATOM_UNIT_SCALE);
  const payload = buildWorkMailBatchPayload(recipients);
  assert.equal(payload, wire(JSON.stringify(recipients)));
  assert.deepEqual(parseWorkMailBatchPayload(payload), {
    kind: "mail-batch", amountVersion: "mailbatch1", tokenId: WORK_MAIL_BATCH_TOKEN_ID,
    recipients: [{ recipientAddress: A, amountSubatoms: "1" }, { recipientAddress: B, amountSubatoms: "20000000000000001" }],
    totalAmountSubatoms: "20000000000000002", recipientCount: 2,
  });
  assert.equal(buildWorkMailBatchPayload(parseWorkMailBatchPayload(payload).recipients), payload);
});

test("wire rejects malformed, noncanonical and non-Q16 encodings", () => {
  const good = buildWorkMailBatchPayload(recipients);
  for (const bad of [
    `${good}=`, `${good}\n`, ` ${good}`, good.replace(WORK_MAIL_BATCH_TOKEN_ID, "a".repeat(64)),
    wire(JSON.stringify(recipients, null, 1)), wire(JSON.stringify(recipients).replace('"1"', '1')),
    wire(JSON.stringify(recipients).replace(A, `\\u0031${A.slice(1)}`)),
    wire(JSON.stringify([[A, "01"], [B, "1"]])), wire(JSON.stringify([[A, "0"], [B, "1"]])),
    wire(JSON.stringify([[A, "-1"], [B, "1"]])), wire(JSON.stringify([[A, "+1"], [B, "1"]])),
    wire(JSON.stringify([[A, "1e2"], [B, "1"]])), wire(JSON.stringify([[A, "1.0"], [B, "1"]])),
    wire(JSON.stringify([[A, "1", 0], [B, "1"]])), wire(JSON.stringify([{ recipientAddress: A, amountSubatoms: "1" }, [B, "1"]])),
    wire(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(recipients))])),
    wire(Buffer.from([0xc0, 0xaf])), "pwt1:mailbatch1:" + "a".repeat(WORK_MAIL_BATCH_MAX_PAYLOAD_BYTES),
  ]) assert.equal(parseWorkMailBatchPayload(bad), null, `accepted ${bad.slice(0, 140)}`);
  assert.throws(() => validateWorkMailBatchRecipients(new Array(2)));
  assert.throws(() => buildWorkMailBatchPayload([{ recipientAddress: A, amountSubatoms: "1", label: "extra" }, [B, "1"]]));
});

test("validates checksum, network, duplicate identities and canonical Bech32 casing", () => {
  const witness = address.fromOutputScript(Buffer.from(`0014${"ab".repeat(20)}`, "hex"), networks.bitcoin);
  assert.equal(canonicalWorkMailBatchAddress(witness.toUpperCase()), witness);
  assert.equal(parseWorkMailBatchPayload(buildWorkMailBatchPayload([[witness.toUpperCase(), "1"], [A, "1"]])).recipients[0].recipientAddress, witness);
  assert.equal(parseWorkMailBatchPayload(wire(JSON.stringify([[witness.toUpperCase(), "1"], [A, "1"]]))), null);
  assert.throws(() => buildWorkMailBatchPayload([[witness, "1"], [witness.toUpperCase(), "2"]]));
  assert.throws(() => buildWorkMailBatchPayload([[A, "1"], [A, "2"]]));
  assert.throws(() => buildWorkMailBatchPayload([[A.slice(0, -1) + "x", "1"], [B, "1"]]));
  assert.throws(() => buildWorkMailBatchPayload([[receiver(1, networks.testnet), "1"], [B, "1"]]));
  assert.throws(() => buildWorkMailBatchPayload(recipients, { validateAddress: () => false }));
  assert.throws(() => buildWorkMailBatchPayload(recipients, { network: "unknown" }));
});

test("cardinality, exact supply cap and one-subatom positive tails remain bounded", () => {
  const full = Array.from({ length: WORK_MAIL_BATCH_MAX_RECIPIENTS }, (_, index) => [receiver(index + 1), "1"]);
  assert.equal(parseWorkMailBatchPayload(buildWorkMailBatchPayload(full)).recipientCount, 256);
  assert.throws(() => buildWorkMailBatchPayload([...full, [receiver(257), "1"]]));
  assert.equal(parseWorkMailBatchPayload(buildWorkMailBatchPayload([[A, "1"]])).recipientCount, 1);
  assert.throws(() => buildWorkMailBatchPayload([]));
  assert.equal(parseWorkMailBatchPayload(buildWorkMailBatchPayload([[A, (WORK_MAIL_BATCH_MAX_SUBATOMS - 1n).toString()], [B, "1"]])).totalAmountSubatoms, WORK_MAIL_BATCH_MAX_SUBATOMS.toString());
  assert.throws(() => buildWorkMailBatchPayload([[A, WORK_MAIL_BATCH_MAX_SUBATOMS.toString()], [B, "1"]]));
});

test("batch movement excludes self, values at one opening and floors only once", () => {
  const batch = validateWorkMailBatchRecipients([[A, "8"], [B, "1"], [C, "1"]]);
  const opening = (WORK_MAIL_BATCH_MAX_SUBATOMS / 2n).toString();
  assert.equal(workMailBatchNonSelfAmountSubatoms(batch, A), "2");
  assert.equal(workMailBatchMovementValueQ8(batch, A, opening), "1");
  const reordered = validateWorkMailBatchRecipients([[C, "1"], [A, "8"], [B, "1"]]);
  assert.equal(workMailBatchMovementValueQ8(reordered, A, opening), "1");
  assert.equal(workMailBatchMovementValueQ8(batch, A, "0"), "0");
  assert.throws(() => workMailBatchMovementValueQ8(batch, A, 1));
});

test("Mail wire cannot be decoded as standalone batch1", async () => {
  const legacy = await import("./workBatch.mjs");
  assert.equal(legacy.parseWorkBatchPayload(buildWorkMailBatchPayload(recipients)), null);
  assert.equal(parseWorkMailBatchPayload(legacy.buildWorkBatchPayload(recipients)), null);
});


test("ordinary Mail precheck excludes Jobs and naked bond memos without changing replies/files", () => {
  for (const message of ["incb", " PoWb ", "pwj1:accept:broken", "  pwj1:not-json"]) {
    assert.equal(workMailBatchMemoIsOrdinary({ message }), false);
  }
  for (const options of [{ message: "" }, { message: "Hello" }, { message: "powb", parentTxid: "a".repeat(64) },
    { message: "incb", hasAttachment: true }]) assert.equal(workMailBatchMemoIsOrdinary(options), true);
  assert.equal(workMailBatchMemoIsOrdinary({ message: "pwj1:accept:bad", hasAttachment: true }), false);
});


test("summary Mail envelope retains exact bounded payment vector and carrier commitment shape", () => {
  const vector = parseWorkMailBatchPayload(buildWorkMailBatchPayload(recipients)).recipients;
  const envelope = { protocolVout: 2, lastProtocolVout: 3, recordOrdinal: 0, kind: "reply",
    payloadCommitment: { model: "canonical-work-amo-payload-sha256-v1", sha256: "ab".repeat(32), payloadBytes: 122 },
    recipients: vector.map((row, vout) => ({ recipientAddress: row.recipientAddress, amountSats: "546", vout })) };
  assert.equal(workMailBatchEnvelopeMatches(envelope, vector, 5), true);
  for (const mutate of [value => { delete value.kind; }, value => { value.kind = "token"; },
    value => { value.payloadCommitment.payloadBytes = 0; }, value => { value.protocolVout = 1; },
    value => { value.lastProtocolVout = 1; }, value => { value.recordOrdinal = 1; },
    value => { value.recipients[0].amountSats = "0546"; }, value => { value.recipients[0].amountSats = 546; },
    value => { value.recipients[0].amountSats = "2100000000000001"; },
    value => { value.recipients[0].recipientAddress = C; }, value => { value.recipients[0].vout = 1; },
    value => { value.recipients.push(value.recipients[0]); }]) {
    const changed = structuredClone(envelope); mutate(changed);
    assert.equal(workMailBatchEnvelopeMatches(changed, vector, 5), false, String(mutate));
  }
});
