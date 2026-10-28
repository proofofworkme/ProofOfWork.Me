import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { transaction, recipients, batchVout, ACTOR, REGISTRY, carrier, script, pendingDecisionFixture as pending } from "../tests/fixtures/workMailBatch.mjs";
import { validateWorkMailBatchV1RawTransaction, validateWorkMailBatchV1PendingDecision } from "./work-mail-batch-transaction.mjs";
const validate = tx => validateWorkMailBatchV1RawTransaction({ transaction: tx, protocolVout: batchVout(tx) });

test("signed 1/78/256-recipient Mail pays one positional registry fee and binds all payments", () => {
  for (const count of [1, 78, 256]) {
    const result = validate(transaction({ vector: recipients(count) }));
    assert.equal(result.valid, true, result.reasonCode);
    assert.equal(result.registryPayment.amountSats, 546);
    assert.equal(result.registryPayment.vout, count + 1);
    assert.equal(result.mailEnvelope.recipients.length, count);
  }
  const vector = [{ recipientAddress: REGISTRY, amountSubatoms: "1" }, { recipientAddress: ACTOR, amountSubatoms: "2" }];
  assert.equal(validate(transaction({ vector })).valid, true, "registry/self are ordinary Mail recipients");
});

test("one ordinary envelope supports exact subject/reply/body chunks and a complete file", () => {
  const data = Buffer.from("a complete file"), encoded = data.toString("base64url");
  const prefix = `pwm1:a:${Buffer.from("text/plain").toString("base64url")}:${Buffer.from("file.txt").toString("base64url")}:${data.length}:${createHash("sha256").update(data).digest("hex")}:`;
  const mail = ["pwm1:s:U3ViamVjdA", `pwm1:r:${"a".repeat(64)}`, "pwm1:m:", `${prefix}0/2:${encoded.slice(0, 8)}`, `${prefix}1/2:${encoded.slice(8)}`];
  const result = validate(transaction({ mail }));
  assert.equal(result.valid, true, result.reasonCode);
  assert.equal(result.mailEnvelope.kind, "file");
  for (const changed of [mail.slice(0, -1), [...mail, mail.at(-1)], [...mail.slice(0, -2), mail.at(-1), mail.at(-2)]]) {
    assert.equal(validate(transaction({ mail: changed })).valid, false);
  }
});

test("new shape refuses wrong fees, recipients, sibling protocols and malformed envelopes", () => {
  const txs = [
    ...[0, 545, 547, 1092].map(fee => transaction({ fee })),
    transaction({ payments: recipients().map(row => ({ address: row.recipientAddress, value: 0 })) }),
    transaction({ payments: recipients().reverse().map(row => ({ address: row.recipientAddress, value: 546 })) }),
    transaction({ payments: [{ address: ACTOR, value: 546 }] }),
    ...["pwb1:tip2:bad", "pwt1:send3:bad", "pwt1:batch1:bad", "unrecognized"].map(text => transaction({ extraOutputs: [{ script: carrier(text) }] })),
    transaction({ extraOutputs: [{ script: script(REGISTRY), value: 546 }] }),
    transaction({ extraOutputs: [{ script: script(ACTOR), value: 546 }] }),
    transaction({ transform: outputs => [outputs[0], outputs[2], outputs[1], ...outputs.slice(3)] }),
    transaction({ transform: outputs => outputs.map((output, i) => i === 2 ? { ...output, value: 1n } : output) }),
    ...[[], ["pwm1:m:incb"], ["pwm1:m:PoWb"], ["pwm1:m:pwj1:accept:bad"], ["pwm1:m:", "pwm1:unknown:bad"],
      ["pwm1:s:!", "pwm1:m:"], ["pwm1:m:", "pwm1:r:bad"], ["pwm1:m:", "pwm1:a:bad"]].map(mail => transaction({ mail })),
    transaction({ mail: ["pwm1:m:" + "x".repeat(100000)] }),
  ];
  for (const tx of txs) assert.equal(validate(tx).valid, false);
  for (const hashType of [2, 3, 0x81]) assert.equal(validate(transaction({ hashType })).valid, false);
  const forged = transaction(); forged.vout[0].value = "547";
  assert.equal(validate(forged).valid, false, "hydrated outputs cannot disagree with signed bytes");
});


test("pending observations require the complete atomic WORK child set and envelope binding", () => {
  assert.equal(validateWorkMailBatchV1PendingDecision(pending()).valid, true);
  for (const mutate of [x => x.items.pop(), x => x.items.push(x.items[2]), x => { x.items[2].paidSats = 546; },
    x => { x.items[2].mailEnvelope = {}; }, x => { x.items[2].amountSubatoms = "1"; }]) {
    const f = structuredClone(pending()); mutate(f); assert.equal(validateWorkMailBatchV1PendingDecision(f).valid, false);
  }
});
