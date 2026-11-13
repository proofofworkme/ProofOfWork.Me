import test from "node:test";
import { execFileSync } from "node:child_process";

test("activity runtime adapter preserves exact scope, overlay bytes and rollback metadata", () => {
  execFileSync("python3", ["-I", "-B", "deploy/activity-fee-factor/check.test.py"], {
    encoding: "utf8", timeout: 30_000,
  });
});

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("activity live checker derives only the three accepted linked runtime pins", () => {
  const source = readFileSync("scripts/check-activity-fee-factor-live.mjs", "utf8");
  const start = source.indexOf("`import ast,json,pathlib");
  const end = source.indexOf("`], { encoding:", start);
  assert.ok(start >= 0 && end > start);
  const program = source.slice(start + 1, end);
  const keys = [
    "server/proof-api.mjs", "server/db/proof-index-reader.mjs",
    "server/db/read-only-snapshot.mjs", "server/wallet-read-observation.mjs",
    "scripts/backfill-proof-indexer.mjs", "server/pwid-rejection-projection.mjs",
  ];
  const replaced = [keys[0], keys[1], keys[4]];
  const old = Object.fromEntries(keys.map((path, index) => [path, String(index + 1).repeat(64)]));
  const linked = Object.fromEntries(replaced.map((path, index) => [path, String(index + 7).repeat(64)]));
  linked["server/unrelated-linked.mjs"] = "a".repeat(64);
  const root = mkdtempSync(join(tmpdir(), "pow-activity-pins-"));
  try {
    for (const family of ["audit-remediation", "activity-fee-factor", "linked-publish"]) {
      mkdirSync(join(root, "deploy", family), { recursive: true });
    }
    writeFileSync(join(root, "deploy/audit-remediation/profile.py"), "AFTER = " + JSON.stringify(old) + "\nPRESERVED = {}\n");
    writeFileSync(join(root, "deploy/activity-fee-factor/profile.py"), "AFTER = {}\nPRESERVED = {}\n");
    const path = join(root, "deploy/linked-publish/profile.py");
    const run = value => {
      writeFileSync(path, "AFTER = " + JSON.stringify(value) + "\n");
      return JSON.parse(execFileSync("python3", ["-I", "-B", "-c", program], {
        cwd: root, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"],
      }));
    };
    const result = run(linked);
    assert.deepEqual(Object.keys(result).sort(), keys.toSorted());
    for (const key of keys) assert.equal(result[key], replaced.includes(key) ? linked[key] : old[key]);
    const missing = { ...linked }; delete missing[replaced[0]];
    assert.throws(() => run(missing));
    assert.throws(() => run({ ...linked, [replaced[0]]: "invalid" }));
    assert.throws(() => run({ ...linked, [keys[2]]: "b".repeat(64) }));
    writeFileSync(path, "AFTER = {}\nAFTER = " + JSON.stringify(linked) + "\n");
    assert.throws(() => execFileSync("python3", ["-I", "-B", "-c", program], {
      cwd: root, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"],
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
