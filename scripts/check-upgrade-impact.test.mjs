import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { functional, surfaceHosts, validateImpact } from "./check-upgrade-impact.mjs";
const fixture = () => JSON.parse(readFileSync(new URL("../release-impact.json", import.meta.url)));
test("upgrade gate refuses omitted and duplicate surfaces, dangling tests and stale surface inventories", () => {
  validateImpact(fixture(),existsSync);
  const omit = fixture(); omit.reviews.find(row => row.targets.includes("indexer")).targets.splice(0,1);
  assert.throws(() => validateImpact(omit,existsSync));
  const dup = fixture(); dup.reviews[0].targets.push("search");
  assert.throws(() => validateImpact(dup,existsSync));
  assert.throws(() => validateImpact(fixture(),()=>false));
  assert.throws(() => validateImpact(fixture(),existsSync,[...Object.keys(surfaceHosts),"new-product"]));
});
test("functional path detection covers wire, read models, services, public pages, worker and product UI", () => {
  for (const path of ["src/shared/protocol/new.mjs","server/sql/v2.sql","src/features/wallet/Mail.tsx","scripts/run-proof-indexer-worker.mjs","scripts/generate-feed.mjs","public/index.html","deploy/proofofwork-search-index.service","deploy/indexer/schema.sql","package.json"]) assert(functional(path),path);
  for (const path of ["AGENTS.md","server/example.test.mjs","tests/browser/read.spec.mjs"]) assert(!functional(path),path);
});
