import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkAmoV5PwmMessages } from "../../../server/work-amo-v5.mjs";
import { buildPowcatMailAttachment, powcatPointerFromAttachment } from "./powcatMail.mjs";

const file = { name: "draft.html", txid: "17".repeat(32), fileHash: "a2".repeat(32) };
const encode = value => Buffer.from(value).toString("base64url");

test("ordinary Mail/Files replay delivers a linked file using one verified attachment", () => {
  const attachment = buildPowcatMailAttachment(file);
  const carrier = ["pwm1:a", encode(attachment.mime), encode(attachment.name), attachment.size,
    attachment.sha256, "0/1", attachment.data].join(":");
  const record = parseWorkAmoV5PwmMessages(["pwm1:m:Here is the file.", carrier]);
  assert.equal(record.kind, "file");
  assert.equal(record.contributionField, "driveFlowSats");
  assert.equal(record.memo, "Here is the file.");
  assert.equal(record.attachment.name, "draft.html.powcat");
  assert.deepEqual(powcatPointerFromAttachment(record.attachment), { txid: file.txid, fileHash: file.fileHash });
});

test("reserved MIME, pointer bytes, canonical encoding and reference digest must agree", () => {
  const valid = buildPowcatMailAttachment(file);
  for (const changes of [{ mime: "text/plain" }, { size: 140 }, { sha256: file.fileHash },
    { data: valid.data + "==" }, { data: valid.data.replace(/^./u, "B") }]) {
    assert.equal(powcatPointerFromAttachment({ ...valid, ...changes }), null);
  }
});
