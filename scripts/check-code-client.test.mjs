import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as bitcoin from "bitcoinjs-lib";
import * as codeProtocol from "../src/shared/protocol/codeRepository.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const id = value => value.toString(16).padStart(64, "0");
let response;
let lastRequest;
async function loadClient(path, imports = {}) {
  const source = await readFile(path, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 }, fileName: path }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === "buffer") return { Buffer };
    throw new Error(`Unexpected test dependency: ${name}`);
  }, Blob, TextEncoder, TextDecoder, URLSearchParams, Uint8Array, Uint32Array, DataView, Buffer }, { filename: path });
  return exports;
}
const api = await loadClient("src/features/code/codeApi.ts", {
  "../../shared/api/proofApiClient": { fetchProofApiJson: async (...args) => { lastRequest = args; return structuredClone(response); } },
  "../../shared/utils/encoding": { sha256Hex: hash },
  "../../shared/protocol/codeRepository.mjs": codeProtocol,
});
const archive = await loadClient("src/features/code/codeArchive.ts", {
  "../../shared/protocol/codeRepository.mjs": codeProtocol,
});
const encoding = await loadClient("src/shared/utils/encoding.ts", { "bitcoinjs-lib": bitcoin });
const attachment = await loadClient("src/shared/protocol/mailAttachment.ts", {
  "bitcoinjs-lib": bitcoin, "../../functions": { formatBytes: value => `${value} bytes` },
  "../bitcoin/protocolLimits": { MAX_DATA_CARRIER_BYTES: 100000 }, "../utils/encoding": encoding,
});
const plan = await loadClient("src/features/code/codeProtocol.ts", {
  "../../shared/protocol/codeRepository.mjs": codeProtocol, "../../shared/utils/encoding": encoding,
  "../../shared/protocol/mailAttachment": attachment,
  "../boost/boostWallet": { dataCarrierBytesForPayload: payload => bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output.length },
});
const reservationState = await loadClient("src/shared/api/surfaceReadState.ts");
const reservations = await loadClient("src/features/code/codeReservations.ts", {
  "../../shared/api/surfaceReadState": reservationState,
});
const repo = { txid: id(1), repoTxid: id(1), headTxid: id(2), name: "Fixture", description: "Source",
  ownerAddress: "bc1qfixture", fileCount: 1, commitCount: 1 };
const snapshot = { id: "fixture-snapshot", checkpointHeight: 100, checkpointHash: "a".repeat(64) };
const evidence = { network: "livenet", complete: true, source: "proof-indexer-exact-canonical-code-replay",
  snapshot, indexedThroughBlock: 100, indexedThroughBlockHash: snapshot.checkpointHash };
const pagination = { limit: 30, total: 1, hasMore: false, nextCursor: null };
const content = "\ufeff  export const café = '東京';\r\n\r\n";
const bytes = Buffer.from(content);
const file = { path: "工程/main.ts", txid: id(2), size: bytes.length, sha256: hash(bytes) };
const detail = { ...evidence, repository: repo, filesComplete: true, files: [file], version: id(2),
  pagination, events: [{ txid: id(2), applied: true, status: "confirmed" }] };
const fullFile = { ...file, content, contentBase64: bytes.toString("base64") };

test("API reads require complete matching checkpoint evidence", async () => {
  response = { ...evidence, repositories: [repo], pagination };
  assert.equal((await api.fetchCodeRepositories("livenet")).repositories[0].name, "Fixture");
  for (const change of [{ complete: false }, { network: "testnet" }, { source: "" },
    { snapshot: { ...snapshot, checkpointHeight: 99 } }, { snapshot: { ...snapshot, checkpointHash: "b".repeat(64) } },
    { snapshot: { ...snapshot, id: "" } }, { indexedThroughBlockHash: "not-a-hash" }]) {
    response = { ...evidence, repositories: [repo], pagination, ...change };
    await assert.rejects(api.fetchCodeRepositories("livenet"), /evidence|checkpoint|snapshot/i);
  }
  response = { ...evidence, repositories: [], pagination: { hasMore: true } };
  await assert.rejects(api.fetchCodeRepositories("livenet"), /pagination/i);
});

test("repository path, version and cursor requests stay bound to one snapshot", async () => {
  response = { ...detail, file: fullFile };
  const controller = new AbortController();
  const value = await api.fetchCodeRepository("livenet", id(1), { snapshot: snapshot.id,
    version: id(2), path: "工程/main.ts", cursor: "cursor-value", signal: controller.signal });
  assert.equal(value.version, id(2));
  const query = new URL(lastRequest[0], "http://local.test").searchParams;
  assert.equal(query.get("repo"), id(1));
  assert.equal(query.get("snapshot"), snapshot.id);
  assert.equal(query.get("version"), id(2));
  assert.equal(query.get("path"), "工程/main.ts");
  assert.equal(query.get("cursor"), "cursor-value");
  assert.equal(lastRequest[2].signal, controller.signal);
  for (const change of [{ repository: { ...repo, repoTxid: id(9) } },
    { snapshot: { ...snapshot, id: "other-snapshot" } }, { version: id(9) }, { filesComplete: false },
    { files: [file, { ...file }] }, { files: [file, { ...file, path: "工程/main.ts/child" }] },
    { files: [{ ...file, path: "../secret" }] }]) {
    response = { ...detail, ...change };
    await assert.rejects(api.fetchCodeRepository("livenet", id(1), { snapshot: snapshot.id, version: id(2) }), /tree|snapshot|version|repository/i);
  }
});

test("client source rechecks exact BOM, CRLF, empty bytes, hashes and canonical encodings", () => {
  const result = api.verifiedCodeSource(fullFile, file);
  assert.equal(result.source, content);
  assert.deepEqual(Buffer.from(result.bytes), bytes);
  const empty = { ...file, size: 0, sha256: codeProtocol.CODE_EMPTY_SHA256, content: "", contentBase64: "" };
  assert.equal(api.verifiedCodeSource(empty).bytes.length, 0);
  for (const change of [{ content: content.slice(1) }, { size: bytes.length + 1 }, { sha256: "f".repeat(64) },
    { path: "../a" }, { txid: "bad" }, { contentBase64: "!!!!" }]) assert.throws(() => api.verifiedCodeSource({ ...fullFile, ...change }, file));
  const plain = Buffer.from("a");
  assert.throws(() => api.verifiedCodeSource({ ...file, size: 1, sha256: hash(plain), content: "a", contentBase64: "YR==" }), /encoding|canonical/i);
  const invalid = Buffer.from([0xff]);
  assert.throws(() => api.verifiedCodeSource({ ...file, size: 1, sha256: hash(invalid), content: "�", contentBase64: invalid.toString("base64") }));
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function inspectZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 22, true);
    const nameSize = view.getUint16(offset + 26, true);
    const extraSize = view.getUint16(offset + 28, true);
    const name = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(offset + 30, offset + 30 + nameSize));
    const source = bytes.subarray(offset + 30 + nameSize + extraSize, offset + 30 + nameSize + extraSize + size);
    assert.equal(flags, 0x0800); assert.equal(method, 0);
    assert.equal(view.getUint32(offset + 14, true), crc32(source));
    files.push({ name, bytes: Buffer.from(source), offset });
    offset += 30 + nameSize + extraSize + size;
  }
  const centralOffset = offset;
  for (const file of files) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    assert.equal(view.getUint16(offset + 8, true), 0x0800);
    assert.equal(view.getUint32(offset + 42, true), file.offset);
    const nameSize = view.getUint16(offset + 28, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameSize)), file.name);
    offset += 46 + nameSize;
  }
  assert.equal(view.getUint32(offset, true), 0x06054b50);
  assert.equal(view.getUint16(offset + 10, true), files.length);
  assert.equal(view.getUint32(offset + 16, true), centralOffset);
  assert.equal(offset + 22, bytes.length);
  return files;
}

test("ZIP is an inspectable standard archive retaining Unicode paths, BOM and exact bytes", async () => {
  const values = [{ path: "工程/main.ts", bytes }, { path: "empty.txt", bytes: new Uint8Array() }];
  const blob = archive.codeRepositoryZip(values);
  assert.equal(blob.type, "application/zip");
  const files = inspectZip(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(files.map(file => file.name), values.map(file => file.path));
  assert.deepEqual(files[0].bytes, bytes);
  assert.equal(files[1].bytes.length, 0);
  assert.equal(inspectZip(new Uint8Array(await archive.codeRepositoryZip([]).arrayBuffer())).length, 0);
});

test("ZIP export rejects traversal, duplicate and file-directory conflicting paths", () => {
  for (const path of ["../secret", "/absolute", "a\\b", "a//b", "a\u0000b"]) {
    assert.throws(() => archive.codeRepositoryZip([{ path, bytes }]), /path|repository/i);
  }
  assert.throws(() => archive.codeRepositoryZip([{ path: "a", bytes }, { path: "a", bytes }]), /duplicate|path|repository/i);
  assert.throws(() => archive.codeRepositoryZip([{ path: "a", bytes }, { path: "a/b", bytes }]), /conflict|path|repository/i);
});

function verifyPlan(value) {
  const owner = "bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e";
  const tx = { txid: id(8), status: { confirmed: true, block_height: 100, block_hash: "a".repeat(64) },
    blockTransactionIndex: 8, vin: [{ prevout: { scriptpubkey_address: owner } }],
    vout: [{ value: 546, scriptpubkey_address: owner, scriptpubkey: Buffer.from(bitcoin.address.toOutputScript(owner)).toString("hex") },
      ...value.payloads.map(payload => ({ value: 0,
        scriptpubkey: Buffer.from(bitcoin.payments.embed({ data: [Buffer.from(payload)] }).output).toString("hex") }))] };
  const event = codeProtocol.verifyCodeTransaction(tx, { sha256: hash });
  assert.equal(event.valid, true, event.validationErrors.join(","));
  assert.equal(event.amountSats, "546");
  assert.equal(value.carrierBytes, tx.vout.slice(1).reduce((total, output) => total + output.scriptpubkey.length / 2, 0));
  return event;
}

test("writer plans emit ordinary Mail then exact Files source then canonical Code metadata", () => {
  const creation = plan.buildCodePlan({ ...plan.emptyCodeDraft, name: "工程 café", description: " Exact description\r\n" });
  assert.equal(creation.payloads.length, 2);
  assert.equal(creation.payloads[0], "pwm1:m:Code repository: 工程 café");
  assert.equal(verifyPlan(creation).metadata.name, "工程 café");
  const write = plan.buildCodePlan({ ...plan.emptyCodeDraft, kind: "put", repo: id(1), parent: id(2),
    path: "工程/main.ts", message: "Exact CRLF source", content });
  assert.ok(write.payloads[0].startsWith("pwm1:m:"));
  assert.ok(write.payloads.slice(1, -1).every(payload => payload.startsWith("pwm1:a:")));
  assert.ok(write.payloads.at(-1).startsWith("pwc1:commit:"));
  const event = verifyPlan(write);
  assert.equal(event.source.content, content);
  assert.equal(event.source.name, "source.txt");
  assert.equal(event.source.mime, "text/plain");
  assert.equal(event.metadata.path, "工程/main.ts");
  assert.equal(event.source.sha256, hash(bytes));
  const restored = plan.restoredCodeDraft(plan.codeDraftFields(write.draft));
  assert.equal(restored.content, content);
  assert.equal(restored.path, "工程/main.ts");
});

test("writer empty put and delete need no attachment; source bounds count exact UTF-8 bytes", () => {
  const draft = { ...plan.emptyCodeDraft, kind: "put", repo: id(1), parent: id(2), path: "empty.txt" };
  const empty = plan.buildCodePlan(draft);
  assert.equal(empty.payloads.length, 2);
  assert.equal(empty.sha256, codeProtocol.CODE_EMPTY_SHA256);
  assert.equal(verifyPlan(empty).source.content, "");
  const deletion = plan.buildCodePlan({ ...draft, kind: "delete" });
  assert.equal(deletion.payloads.length, 2);
  assert.equal(verifyPlan(deletion).metadata.op, "delete");
  assert.equal(Object.hasOwn(verifyPlan(deletion).metadata, "sha256"), false);
  const maximum = plan.buildCodePlan({ ...draft, content: "界".repeat(20000) });
  assert.equal(maximum.size, 60000);
  assert.equal(verifyPlan(maximum).source.size, 60000);
  for (const source of ["界".repeat(20000) + "x", "a\u0000b", "\ud800"]) {
    assert.throws(() => plan.buildCodePlan({ ...draft, content: source }), /UTF-8|Unicode|NUL|60,000/i);
  }
  assert.throws(() => plan.buildCodePlan({ ...plan.emptyCodeDraft, name: "界".repeat(67) }), /200 UTF-8/i);
});

test("funding reservations accept authoritative complete books and reject truncated or summary evidence", () => {
  const registry = { records: [], listings: [], coverage: { complete: true } };
  assert.doesNotThrow(() => reservations.assertCodeRegistryReservations(registry));
  for (const change of [{ records: undefined }, { coverage: { complete: false } }, { summaryOnly: true },
    { collectionHasMore: { listings: true } }, { totalCounts: { listings: 1 } }]) {
    assert.throws(() => reservations.assertCodeRegistryReservations({ ...registry, ...change }), /reservations|evidence/i);
  }
  const credits = { listings: [], authoritativeWallet: true, walletScoped: true, source: "canonical-fixture" };
  assert.doesNotThrow(() => reservations.assertCodeCreditReservations(credits));
  assert.doesNotThrow(() => reservations.assertCodeCreditReservations({ ...credits, listingBookComplete: true, summaryOnly: true, hasMore: true, totalCounts: { listings: 0 } }));
  for (const change of [{ authoritativeWallet: false }, { walletScoped: false }, { source: " " },
    { listings: undefined }, { summaryOnly: true }, { hasMore: true }, { listingBookComplete: false },
    { collectionHasMore: { listings: true } }, { totalCounts: { listings: 1 } }, { totalCounts: { listings: 0.5 } }]) {
    assert.throws(() => reservations.assertCodeCreditReservations({ ...credits, ...change }), /reservations/i);
  }
});
