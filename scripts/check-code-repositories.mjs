import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as bitcoin from "bitcoinjs-lib";
import {
  CODE_EMPTY_SHA256, CODE_MAX_SOURCE_BYTES, codeSourceBytes, encodeCodeRepository,
  encodeCodeCommit, parseCodePayload, validateCodePath, verifyCodeTransaction, replayCodeTransactions,
  encodeCodeReferenceCommit, enumerateCodePageSources, CODE_REFERENCE_ACTIVATION_HEIGHT,
} from "../src/shared/protocol/codeRepository.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const txid = value => value.toString(16).padStart(64, "0");
const owner = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
const other = "bc1qotherauthority";
const blockHash = "a".repeat(64);
const options = { sha256 };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const nulldata = payload => ({ value: 0, scriptpubkey: Buffer.from(bitcoin.script.compile([
  bitcoin.opcodes.OP_RETURN, Buffer.from(payload),
])).toString("hex") });
const payment = (value = 546, address = owner) => ({ value, scriptpubkey_address: address,
  scriptpubkey: Buffer.from(bitcoin.address.toOutputScript(owner)).toString("hex") });
function attachment(bytes, overrides = {}) {
  const fields = { mime: "text/plain", name: "source.txt", size: bytes.length, sha256: sha256(bytes), ...overrides };
  return `pwm1:a:${Buffer.from(fields.mime).toString("base64url")}:${Buffer.from(fields.name).toString("base64url")}:${fields.size}:${fields.sha256}:0/1:${bytes.toString("base64url")}`;
}
function transaction(id, payloads, overrides = {}) {
  return { txid: txid(id), status: { confirmed: true, block_height: 100, block_hash: blockHash },
    blockTransactionIndex: id, vin: [{ prevout: { scriptpubkey_address: owner } }],
    vout: [payment(), ...payloads.map(nulldata)], ...overrides };
}
function repository(id = 1, overrides = {}) {
  return transaction(id, ["pwm1:m:Code repository", encodeCodeRepository({ v: 1, name: "Example", description: "A public source tree." })], overrides);
}
function put(id, parent, path, content, overrides = {}) {
  const bytes = Buffer.from(content);
  const metadata = { v: 1, repo: txid(1), parent: txid(parent), op: "put", path, message: "Save exact source", size: bytes.length, sha256: sha256(bytes) };
  return transaction(id, ["pwm1:m:Code commit", ...(bytes.length ? [attachment(bytes)] : []), encodeCodeCommit(metadata)], overrides);
}
function remove(id, parent, path, overrides = {}) {
  return transaction(id, ["pwm1:m:Delete source", encodeCodeCommit({ v: 1, repo: txid(1), parent: txid(parent), op: "delete", path, message: "Remove file" })], overrides);
}
const errorIncludes = (event, reason) => {
  assert.equal(event.valid, false);
  assert.ok(event.validationErrors.includes(reason), JSON.stringify(event.validationErrors));
};

test("closed canonical codec preserves Unicode and rejects alternate encodings", () => {
  const value = { v: 1, name: "工程", description: "  description\n" };
  assert.deepEqual(parseCodePayload(encodeCodeRepository(value)), { kind: "repo", metadata: value });
  assert.equal(parseCodePayload(`pwc1:repo:${encode({ description: value.description, name: value.name, v: 1 })}`), null);
  assert.equal(parseCodePayload(`pwc1:repo:${Buffer.from('{"v":1,"name":"工程","description":"x","name":"工程"}').toString("base64url")}`), null);
  assert.equal(parseCodePayload(encodeCodeRepository(value) + "="), null);
  for (const change of [{ v: 2 }, { name: " bad" }, { name: "x\ny" }, { name: "é".repeat(101) },
    { name: "\ud800" }, { description: "a\u0000b" }, { description: "x".repeat(1001) }, { extra: true }]) {
    assert.throws(() => encodeCodeRepository({ ...value, ...change }));
  }
  assert.equal(parseCodePayload(`pwc1:repo:${"x".repeat(6000)}`), null);
});

test("exact paths reject traversal and collisions without folding Unicode or case", () => {
  for (const path of ["README.md", "src/Main.ts", "src/main.ts", "工程/é.ts", "工程/e\u0301.ts", "a b/file.ts", "space "]) assert.equal(validateCodePath(path), true, path);
  for (const path of ["", "/src/file", "a//b", "a/", "a/../b", "./file", "a/./file", "../file", "C:/file", "a\\b", "a\nb", "a\u0000b", "a\u0085b", "\ud800", "x".repeat(256), `${"x/".repeat(64)}y`]) assert.equal(validateCodePath(path), false, path);
  const commits = [put(2, 1, "Src/a.ts", "A"), put(3, 2, "src/a.ts", "B"), put(4, 3, "工程/e\u0301.ts", "C"), put(5, 4, "工程/é.ts", "D")];
  const replay = replayCodeTransactions([repository(), ...commits], options);
  assert.equal(replay.repositories[0].files.length, 4);
  assert.deepEqual(replay.repositories[0].files.map(file => file.path), ["Src/a.ts", "src/a.ts", "工程/e\u0301.ts", "工程/é.ts"]);
});

test("commit metadata uses closed operations, bounded exact bytes and zero-byte commitment", () => {
  const metadata = { v: 1, repo: txid(1), parent: txid(1), op: "put", path: "empty.txt", message: "", sha256: CODE_EMPTY_SHA256, size: 0 };
  assert.deepEqual(parseCodePayload(encodeCodeCommit(metadata)), { kind: "commit", metadata });
  for (const change of [{ size: "0" }, { size: -1 }, { size: 60001 }, { sha256: "f".repeat(64) },
    { op: "rename" }, { parent: "A".repeat(64) }, { message: "x".repeat(501) }, { owner }, { path: "../bad" }]) assert.throws(() => encodeCodeCommit({ ...metadata, ...change }));
  assert.throws(() => encodeCodeCommit({ ...metadata, op: "delete" }));
  assert.equal(codeSourceBytes("\ud800"), null);
  assert.equal(codeSourceBytes("a\u0000b"), null);
  assert.equal(Buffer.from(codeSourceBytes("  x\r\n\n")).toString(), "  x\r\n\n");
  assert.equal(Buffer.from(codeSourceBytes("\ufeffsource\r\n")).toString(), "\ufeffsource\r\n");
});

test("creation and put verify raw scripts, exact source bytes and self-payment once", () => {
  const content = "\ufeff  // café 東京\r\n\nexport const x = 1;\n\t  \n";
  const create = verifyCodeTransaction(repository(), options);
  assert.equal(create.kind, "code-repository");
  assert.equal(create.repoTxid, txid(1));
  assert.equal(create.ownerAddress, owner);
  assert.equal(create.amountSats, "546");
  const event = verifyCodeTransaction(put(2, 1, "src/main.ts", content), options);
  assert.equal(event.valid, true);
  assert.equal(event.source.content, content);
  assert.equal(event.source.size, Buffer.byteLength(content));
  assert.equal(event.source.sha256, sha256(Buffer.from(content)));
  assert.equal(event.source.name, "source.txt");
  assert.equal(event.source.mime, "text/plain");
  const noCode = transaction(3, ["pwm1:m:Ordinary Mail"]);
  assert.equal(verifyCodeTransaction(noCode, options), null);
});

test("empty files reconstruct exact bytes without changing Files attachment semantics", () => {
  const tx = put(2, 1, "empty.txt", "");
  const event = verifyCodeTransaction(tx, options);
  assert.equal(event.valid, true);
  assert.equal(event.source.content, "");
  assert.equal(event.source.data, "");
  assert.equal(event.source.sha256, CODE_EMPTY_SHA256);
  tx.vout.splice(2, 0, nulldata(attachment(Buffer.from("not empty"))));
  errorIncludes(verifyCodeTransaction(tx, options), "code-empty-source-attachment-invalid");
});

test("source is reconstructed from exactly one complete fixed Files attachment", () => {
  const bytes = Buffer.from("source\n");
  const original = put(2, 1, "source.ts", bytes.toString());
  for (const [override, reason] of [[{ mime: "application/javascript" }, "code-attachment-ambiguous"],
    [{ name: "source.ts" }, "code-attachment-ambiguous"], [{ size: bytes.length + 1 }, "code-attachment-bytes-unverified"],
    [{ sha256: "f".repeat(64) }, "code-attachment-bytes-unverified"]]) {
    const tx = structuredClone(original); tx.vout[2] = nulldata(attachment(bytes, override));
    errorIncludes(verifyCodeTransaction(tx, options), reason);
  }
  const duplicate = structuredClone(original); duplicate.vout.splice(3, 0, duplicate.vout[2]);
  errorIncludes(verifyCodeTransaction(duplicate, options), "code-attachment-ambiguous");
  const incomplete = structuredClone(original); incomplete.vout[2] = nulldata(attachment(bytes).replace(":0/1:", ":0/2:"));
  errorIncludes(verifyCodeTransaction(incomplete, options), "code-attachment-incomplete");
  const missing = structuredClone(original); missing.vout.splice(2, 1); missing.attachment = { verified: true, data: bytes.toString("base64url") };
  errorIncludes(verifyCodeTransaction(missing, options), "code-source-commitment-mismatch");
  const changed = structuredClone(original); changed.vout[2] = nulldata(attachment(Buffer.from("different\n")));
  errorIncludes(verifyCodeTransaction(changed, options), "code-source-commitment-mismatch");
  const malformed = structuredClone(original); malformed.vout[2] = nulldata(attachment(Buffer.from([0xff])));
  errorIncludes(verifyCodeTransaction(malformed, options), "code-source-text-invalid");
  const nul = structuredClone(original); nul.vout[2] = nulldata(attachment(Buffer.from("a\u0000b")));
  errorIncludes(verifyCodeTransaction(nul, options), "code-source-text-invalid");
  errorIncludes(verifyCodeTransaction(original), "code-attachment-bytes-unverified");
  const split = bytes.toString("base64url");
  const multipart = structuredClone(original);
  const prefix = attachment(bytes).split(":").slice(0, 6).join(":");
  multipart.vout.splice(2, 1, nulldata(`${prefix}:1/2:${split.slice(4)}`), nulldata(`${prefix}:0/2:${split.slice(0, 4)}`));
  assert.equal(verifyCodeTransaction(multipart, options).source.content, bytes.toString());
});

test("authority requires all hydrated input owners and payment before both carrier families", () => {
  const tx = repository();
  for (const vin of [[], [{}], [{ address: owner }], [{ prevout: { scriptpubkey_address: owner } }, { prevout: { scriptpubkey_address: other } }], [{ coinbase: "00", prevout: { scriptpubkey_address: owner } }]]) {
    errorIncludes(verifyCodeTransaction({ ...tx, vin }, options), "code-input-authority-unavailable");
  }
  const insufficient = structuredClone(tx); insufficient.vout[0].value = 545;
  errorIncludes(verifyCodeTransaction(insufficient, options), "code-self-payment-insufficient");
  const late = structuredClone(tx); late.vout.push(late.vout.shift());
  errorIncludes(verifyCodeTransaction(late, options), "code-self-payment-insufficient");
  const splitPayment = structuredClone(tx); splitPayment.vout[0].value = 273; splitPayment.vout.unshift(payment(273));
  assert.equal(verifyCodeTransaction(splitPayment, options).valid, true);
});

test("mixed, ambiguous, malformed and over-budget physical carriers fail closed", () => {
  const tx = repository();
  const duplicated = structuredClone(tx); duplicated.vout.push(duplicated.vout.at(-1));
  errorIncludes(verifyCodeTransaction(duplicated, options), "code-carrier-ambiguous");
  const mixed = structuredClone(tx); mixed.vout.push(nulldata("pwt1:mint:other"));
  errorIncludes(verifyCodeTransaction(mixed, options), "code-mixed-carrier-invalid");
  const interleaved = structuredClone(tx); interleaved.vout.push(nulldata("pwm1:m:later"));
  errorIncludes(verifyCodeTransaction(interleaved, options), "code-mail-envelope-noncontiguous");
  const codeFirst = structuredClone(tx); [codeFirst.vout[1], codeFirst.vout[2]] = [codeFirst.vout[2], codeFirst.vout[1]];
  errorIncludes(verifyCodeTransaction(codeFirst, options), "code-mail-carrier-order-invalid");
  const funded = structuredClone(tx); funded.vout.at(-1).value = 1;
  errorIncludes(verifyCodeTransaction(funded, options), "code-funded-carrier-invalid");
  const malformed = structuredClone(tx); malformed.vout.at(-1).scriptpubkey += "76";
  errorIncludes(verifyCodeTransaction(malformed, options), "code-raw-script-invalid");
  assert.equal(verifyCodeTransaction(malformed, options).kind, "code-commit");
  const malformedUtf8 = transaction(9, ["pwm1:m:Code", Buffer.from([...Buffer.from("pwc1:repo:"), 0xff])]);
  errorIncludes(verifyCodeTransaction(malformedUtf8, options), "code-metadata-invalid");
  const noMail = structuredClone(tx); noMail.vout.splice(1, 1);
  errorIncludes(verifyCodeTransaction(noMail, options), "code-mail-envelope-invalid");
  const over = repository(10); over.vout[1] = nulldata(`pwm1:m:${"x".repeat(100000)}`);
  errorIncludes(verifyCodeTransaction(over, options), "code-carrier-budget-exceeded");
  const max = put(11, 1, "large.txt", "x".repeat(CODE_MAX_SOURCE_BYTES));
  assert.equal(verifyCodeTransaction(max, options).valid, true);
  assert.ok(verifyCodeTransaction(max, options).carrierBytes <= 100000);
});

test("confirmed exact canonical order controls head; stale attempts remain inspectable", () => {
  const txs = [repository(), put(2, 1, "a.ts", "first\n"), put(3, 1, "a.ts", "stale\n"), put(4, 2, "a.ts", "second\n"), remove(5, 4, "a.ts")];
  const replay = replayCodeTransactions(txs.toReversed(), options);
  assert.equal(replay.repositories[0].headTxid, txid(5));
  assert.equal(replay.repositories[0].files.length, 0);
  assert.equal(replay.repositories[0].commits.length, 5);
  errorIncludes(replay.events.find(event => event.txid === txid(3)), "code-parent-stale");
  assert.equal(replay.events.find(event => event.txid === txid(3)).applied, false);
  assert.deepEqual(replayCodeTransactions(txs, options), replay);
  const adversarialIds = [repository(1), put(20, 1, "a", "earlier", { blockTransactionIndex: 2 }), put(2, 20, "a", "later", { blockTransactionIndex: 3 })];
  assert.equal(replayCodeTransactions(adversarialIds, options).repositories[0].files[0].content, "later");
});

test("immutable owner, missing roots, deletes and prefix collisions cannot mutate trees", () => {
  const foreign = put(3, 2, "b", "bad", { vin: [{ prevout: { scriptpubkey_address: other } }], vout: [payment(546, other), ...put(3, 2, "b", "bad").vout.slice(1)] });
  const txs = [repository(), put(2, 1, "src", "file"), foreign, put(4, 2, "src/a.ts", "collision"), remove(5, 2, "missing"), remove(6, 2, "src"), put(7, 6, "src/a.ts", "nested"), put(8, 7, "src", "reverse collision")];
  const replay = replayCodeTransactions(txs, options);
  assert.equal(replay.repositories[0].headTxid, txid(7));
  assert.equal(replay.repositories[0].files[0].path, "src/a.ts");
  for (const [id, reason] of [[3, "code-owner-mismatch"], [4, "code-path-prefix-collision"], [5, "code-delete-path-missing"], [8, "code-path-prefix-collision"]]) errorIncludes(replay.events.find(event => event.txid === txid(id)), reason);
  const missing = replayCodeTransactions([put(2, 1, "a", "data")], options);
  errorIncludes(missing.events[0], "code-repository-unavailable");
  assert.equal(missing.repositories.length, 0);
});

test("pending/orphaned records never mutate confirmed state; replay from scratch handles reorg", () => {
  const first = put(2, 1, "a", "first");
  const second = put(3, 2, "a", "second");
  const pending = put(4, 3, "a", "pending", { status: { confirmed: false } });
  const before = replayCodeTransactions([repository(), first, second, pending], options);
  assert.equal(before.repositories[0].headTxid, txid(3));
  assert.equal(before.events.find(event => event.txid === txid(4)).applied, false);
  const after = replayCodeTransactions([repository(), { ...first, status: "orphaned" }, second, pending], options);
  assert.equal(after.repositories[0].headTxid, txid(1));
  assert.equal(after.repositories[0].files.length, 0);
  errorIncludes(after.events.find(event => event.txid === txid(3)), "code-parent-stale");
  assert.equal(replayCodeTransactions([repository(1, { status: "pending" })], options).repositories.length, 0);
});

test("missing positions, duplicate evidence and competing block hashes cannot manufacture order", () => {
  errorIncludes(verifyCodeTransaction(repository(1, { blockTransactionIndex: undefined }), options), "code-canonical-position-unavailable");
  assert.throws(() => replayCodeTransactions([repository(), repository()], options), /duplicate transaction/);
  assert.throws(() => replayCodeTransactions([repository(), put(2, 1, "a", "x", { blockTransactionIndex: 1 })], options), /ambiguous canonical/);
  assert.throws(() => replayCodeTransactions([repository(), put(2, 1, "a", "x", { status: { confirmed: true, block_height: 100, block_hash: "b".repeat(64) } })], options), /mixes canonical block hashes/);
});

const referencePosition = { status: { confirmed: true, block_height: CODE_REFERENCE_ACTIVATION_HEIGHT, block_hash: blockHash } };
function page(id = 90, content = "\ufeff<!doctype html>\r\n<p>Exact café 東京</p>\r\n \t", payloads) {
  return transaction(id, payloads ?? [`pwm1:m:${content}`], { network: "livenet",
    status: { confirmed: true, block_height: CODE_REFERENCE_ACTIVATION_HEIGHT - 1, block_hash: "b".repeat(64) } });
}
function reference(id = 2, parent = 1, source = page(), changes = {}) {
  const candidate = enumerateCodePageSources(source, options)[0];
  const metadata = { v: 2, repo: txid(1), parent: txid(parent), op: "reference", path: "index.html",
    message: "Reference existing Page", sourceTxid: source.txid, sourceKind: candidate.kind,
    sourceVout: candidate.vout, sha256: candidate.sha256, size: candidate.size, ...changes };
  return transaction(id, ["pwm1:m:Code reference", encodeCodeReferenceCommit(metadata)], referencePosition);
}
function referenceOptions(source = page()) {
  return { ...options, network: "livenet", referenceSources: new Map([[source.txid, source]]) };
}

test("reference codec is additive, closed, and cannot reinterpret a v1 put", () => {
  const tx = reference();
  const text = verifyCodeTransaction(tx, { ...referenceOptions(), structuralOnly: true }).rawPayload;
  const parsed = parseCodePayload(text);
  assert.equal(parsed.kind, "commit2");
  assert.equal(parsed.metadata.v, 2);
  assert.equal(encodeCodeReferenceCommit(parsed.metadata), text);
  assert.equal(parseCodePayload(text.replace("pwc1:commit2:", "pwc1:commit:")), null);
  assert.throws(() => encodeCodeCommit(parsed.metadata));
  for (const change of [{ v: 1 }, { op: "put" }, { sourceTxid: "F".repeat(64) }, { sourceKind: "auto" },
    { sourceVout: -1 }, { sourceVout: 1.1 }, { sourceVout: 2 ** 32 }, { size: 0 }, { size: 60001 }, { sourceUrl: "https://example.org" }]) {
    assert.throws(() => encodeCodeReferenceCommit({ ...parsed.metadata, ...change }));
  }
  assert.equal(parseCodePayload(`pwc1:commit2:${encode({ ...parsed.metadata, extra: true })}`), null);
});

test("reference activation is fenced without changing legacy commits", () => {
  const ref = reference();
  const historical = verifyCodeTransaction({ ...ref, status: { ...ref.status, block_height: CODE_REFERENCE_ACTIVATION_HEIGHT - 1 } }, referenceOptions());
  errorIncludes(historical, "code-metadata-invalid");
  assert.equal(historical.metadata, null);
  assert.equal(historical.repoTxid, "");
  assert.equal(historical.sourceVerification, undefined);
  errorIncludes(verifyCodeTransaction(ref, { ...referenceOptions(), network: "testnet4" }), "code-reference-network-unsupported");
  errorIncludes(verifyCodeTransaction(ref, options), "code-reference-network-unsupported");
  assert.equal(verifyCodeTransaction(ref, referenceOptions()).valid, true);
  assert.equal(verifyCodeTransaction(put(2, 1, "old.html", "<p>Legacy</p>"), options).valid, true);
});

test("Page candidates bind complete exact body and chunk-zero attachment selectors", () => {
  const body = "\ufeff<!doctype html>\r\n<p>Body</p>\r\n \t";
  const content = "\ufeff<html>\r\n<p>Attachment café</p>\n</html>\t";
  const bytes = Buffer.from(content), data = bytes.toString("base64url");
  const prefix = attachment(bytes, { mime: "text/html", name: "Original.html" }).split(":").slice(0, 6).join(":");
  const source = page(90, body, [`pwm1:m:${body.slice(0, 20)}`, `${prefix}:1/2:${data.slice(8)}`,
    `pwm1:m:${body.slice(20)}`, `${prefix}:0/2:${data.slice(0, 8)}`]);
  const candidates = enumerateCodePageSources(source, options);
  assert.deepEqual(candidates.map(item => [item.kind, item.vout]), [["body", 1], ["attachment", 4]]);
  assert.equal(candidates[0].content, body);
  assert.equal(candidates[1].content, content);
  assert.equal(Buffer.from(candidates[1].data, "base64url").toString(), content);
  const selected = candidates[1];
  const ref = reference(2, 1, source, { sourceKind: "attachment", sourceVout: selected.vout, sha256: selected.sha256, size: selected.size });
  assert.equal(verifyCodeTransaction(ref, referenceOptions(source)).source.content, content);
  const wrongSelector = reference(2, 1, source, { sourceKind: "attachment", sourceVout: 2, sha256: selected.sha256, size: selected.size });
  errorIncludes(verifyCodeTransaction(wrongSelector, referenceOptions(source)), "code-reference-source-commitment-mismatch");
  const duplicate = structuredClone(source); duplicate.vout.push(duplicate.vout[4]);
  assert.throws(() => enumerateCodePageSources(duplicate, options), /ambiguous/);
  const missing = structuredClone(source); missing.vout.splice(2, 1);
  assert.throws(() => enumerateCodePageSources(missing, options), /incomplete/);
});

test("references retain commit identity, resolve source separately, and preserve history", () => {
  const source = page(), opts = referenceOptions(source), ref = reference(2, 1, source);
  assert.equal(ref.vout.length, 3, "the reference publishes no source attachment");
  const state = replayCodeTransactions([repository(), ref], opts);
  const file = state.repositories[0].files[0];
  assert.equal(file.txid, ref.txid);
  assert.equal(file.sourceTxid, source.txid);
  assert.equal(file.sourceKind, "body");
  assert.equal(file.sourceVout, 1);
  assert.equal(file.content, enumerateCodePageSources(source, options)[0].content);
  assert.equal(state.repositories[0].headTxid, ref.txid);
  assert.equal(state.events[1].sourceVerification, "verified");
  const update = put(3, 2, "index.html", "<p>Edited</p>", referencePosition);
  const after = replayCodeTransactions([repository(), ref, update], opts);
  assert.equal(after.repositories[0].files[0].content, "<p>Edited</p>");
  assert.equal(after.repositories[0].commits[1].source.sourceTxid, source.txid);
  assert.equal(after.repositories[0].commits[1].source.content, file.content);
});

test("missing Page evidence fails authoritative replay while structural observations stay explicit", () => {
  const ref = reference(), opts = { ...options, network: "livenet" };
  const observed = verifyCodeTransaction(ref, { ...opts, structuralOnly: true });
  assert.equal(observed.valid, true);
  assert.equal(observed.applied, false);
  assert.equal(observed.sourceVerification, "deferred");
  assert.equal(observed.source, undefined);
  assert.throws(() => verifyCodeTransaction(ref, opts), { code: "CODE_REFERENCE_SOURCE_UNAVAILABLE" });
  assert.throws(() => replayCodeTransactions([repository(), ref], { ...opts, structuralOnly: true }), { code: "CODE_REFERENCE_SOURCE_UNAVAILABLE" });
});

test("proven absent Page is invalid at its exact checkpoint without blocking other repositories", () => {
  const ref = reference(), source = page();
  const checkpoint = { checkpointHeight: CODE_REFERENCE_ACTIVATION_HEIGHT, checkpointHash: blockHash };
  const absent = { txid: source.txid, network: "livenet", status: "unavailable-at-checkpoint", referenceAbsent: true, ...checkpoint };
  const opts = { ...options, network: "livenet", ...checkpoint, referenceSources: new Map([[source.txid, absent]]) };
  const state = replayCodeTransactions([repository(), ref, repository(20)], opts);
  assert.equal(state.repositories.length, 2);
  assert.equal(state.repositories.find(repo => repo.txid === txid(1)).headTxid, txid(1));
  assert.equal(state.repositories.find(repo => repo.txid === txid(20)).headTxid, txid(20));
  errorIncludes(state.events.find(event => event.txid === ref.txid), "code-reference-source-absent");
  for (const changed of [{ checkpointHash: "c".repeat(64) }, { checkpointHeight: CODE_REFERENCE_ACTIVATION_HEIGHT + 1 }, { status: "unknown" }, { extra: true }]) {
    assert.throws(() => replayCodeTransactions([repository(), ref], { ...opts, referenceSources: new Map([[source.txid, { ...absent, ...changed }]]) }),
      { code: "CODE_REFERENCE_SOURCE_UNAVAILABLE" });
  }
  assert.throws(() => replayCodeTransactions([repository(), ref], { ...opts, checkpointHeight: undefined }), { code: "CODE_REFERENCE_SOURCE_UNAVAILABLE" });
});

test("provably invalid reference paths reject before requesting unavailable dependencies", () => {
  const file = put(2, 1, "src", "plain file"), collision = reference(3, 2, page(), { path: "src/index.html" });
  const state = replayCodeTransactions([repository(), file, collision], { ...options, network: "livenet" });
  assert.equal(state.repositories[0].headTxid, txid(2));
  errorIncludes(state.events.find(event => event.txid === txid(3)), "code-path-prefix-collision");
});

test("reference validity requires same-network older canonical Page bytes and rejects recursion", () => {
  const source = page(), ref = reference(), opts = referenceOptions(source);
  for (const [change, reason] of [[{ network: "testnet4" }, "code-reference-source-identity-mismatch"],
    [{ status: "pending" }, "code-reference-source-unconfirmed"], [{ status: "orphaned" }, "code-reference-source-unconfirmed"],
    [{ status: { ...source.status, block_height: CODE_REFERENCE_ACTIVATION_HEIGHT } }, "code-reference-source-not-earlier"],
    [{ status: { ...source.status, block_height: CODE_REFERENCE_ACTIVATION_HEIGHT + 1 } }, "code-reference-source-not-earlier"]]) {
    errorIncludes(verifyCodeTransaction(ref, { ...opts, referenceSources: new Map([[source.txid, { ...source, ...change }]]) }), reason);
  }
  const different = page(90, "<p>Substituted bytes</p>");
  errorIncludes(verifyCodeTransaction(ref, referenceOptions(different)), "code-reference-source-commitment-mismatch");
  const recursive = { ...source, vout: [...source.vout, ref.vout.at(-1)] };
  assert.deepEqual(enumerateCodePageSources(recursive, options), []);
  errorIncludes(verifyCodeTransaction(ref, referenceOptions(recursive)), "code-reference-source-commitment-mismatch");
  const orphaned = { ...source, status: "orphaned" };
  const descendant = put(3, 2, "index.html", "<p>Descendant</p>", referencePosition);
  const state = replayCodeTransactions([repository(), ref, descendant], referenceOptions(orphaned));
  assert.equal(state.repositories[0].headTxid, txid(1));
  errorIncludes(state.events.find(event => event.txid === txid(3)), "code-parent-stale");
});

test("Page source limits and malformed bytes never silently become referenced HTML", () => {
  const maximum = "<p>" + "x".repeat(CODE_MAX_SOURCE_BYTES - 7) + "</p>";
  assert.equal(enumerateCodePageSources(page(90, maximum), options)[0].size, CODE_MAX_SOURCE_BYTES);
  assert.deepEqual(enumerateCodePageSources(page(90, maximum + "x"), options), []);
  assert.deepEqual(enumerateCodePageSources(page(90, "Ordinary text"), options), []);
  const invalid = page(90, "", [Buffer.concat([Buffer.from("pwm1:m:<p>"), Buffer.from([0xff])])]);
  assert.throws(() => enumerateCodePageSources(invalid, options), /malformed/);
  const badHash = page(90, "", [attachment(Buffer.from("<p>Valid UTF-8</p>"), { mime: "text/html", sha256: "f".repeat(64) })]);
  assert.throws(() => enumerateCodePageSources(badHash, options), /commitment/);
  const nul = page(90, "", [attachment(Buffer.from("<p>\u0000</p>"), { mime: "text/html" })]);
  assert.throws(() => enumerateCodePageSources(nul, options), /invalid source/);
});
