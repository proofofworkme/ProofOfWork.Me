import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { validateCodePath } from "../../shared/protocol/codeRepository.mjs";

const source = await readFile(new URL("./codeNavigation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: name => {
  assert.equal(name, "../../shared/protocol/codeRepository.mjs");
  return { validateCodePath };
} });
const { assertCodeSourceReference } = exports;
const reference = { network: "livenet", repo: "a".repeat(64), version: "b".repeat(64),
  path: "site/ café.html", sha256: "c".repeat(64), size: 129 };
const file = { path: reference.path, sha256: reference.sha256, size: reference.size, txid: "d".repeat(64) };

test("a Code handoff retains an exact path and version while matching fresh file evidence", () => {
  assert.doesNotThrow(() => assertCodeSourceReference(reference, "livenet", file));
  assert.equal(reference.path, "site/ café.html");
  assert.equal(reference.version, "b".repeat(64));
});

test("a source cannot cross networks or substitute a different fresh commitment", () => {
  for (const network of ["testnet", "testnet4"]) {
    assert.throws(() => assertCodeSourceReference(reference, network, file), /different network/u);
  }
  for (const change of [{ path: "site/café.html" }, { sha256: "e".repeat(64) }, { size: 130 }]) {
    assert.throws(() => assertCodeSourceReference(reference, "livenet", { ...file, ...change }), /differs/u);
  }
});

test("Code handoffs require an explicit exact version, HTML path and bounded commitment", () => {
  for (const change of [{ version: "" }, { version: "head" }, { repo: "A".repeat(64) },
    { path: "../index.html" }, { path: "index.js" }, { sha256: "bad" }, { size: -1 }, { size: 60001 }, { size: 1.5 }]) {
    assert.throws(() => assertCodeSourceReference({ ...reference, ...change }, "livenet"), /incomplete/u);
  }
  assert.doesNotThrow(() => assertCodeSourceReference({ ...reference, size: 0 }, "livenet"));
});
