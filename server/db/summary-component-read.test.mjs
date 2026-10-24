import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./proof-index-reader.mjs", import.meta.url), "utf8");
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  return source.slice(match.index, source.indexOf("\n}", match.index) + 2);
}

test("direct and lookback reads project only the requested summary with conservative embedded coverage", async () => {
  for (const lookback of [false, true]) {
    let calls = 0;
    const consistency = { ok: true, checks: [{ name: "canonical-activity-count-matches-public-log", ok: true }] };
    const summary = { indexedThroughBlock: 100,
      token: { amountSubatoms: "900719925474099312345" },
      workFloor: { indexedThroughBlock: 99, totalQ8: "900719925474099312345" } };
    const pool = { async query(sql, args) {
      calls++;
      assert.equal(args[1], "marketplaceSummary");
      const outputSelect = sql.slice(sql.lastIndexOf("\n        SELECT\n") + 1);
      assert.match(outputSelect, /payload->'summaryPayloads'->\$2 AS summary_payload/);
      assert.match(sql, /canonical-activity-count-matches-public-log/);
      assert.match(sql, /token-components-cover-confirmed-activity/);
      assert.match(sql, /source_hashes \? 'canonicalSummary'/);
      assert.match(sql, /canonical_q16_eligibility/);
      if (lookback && calls === 1) return { rows: [] };
      return { rows: [{ summary_payload: summary, consistency,
        indexed_through_block: 999, snapshot_id: "canonical-snapshot", generated_at: "2026-10-24T00:00:00Z" }] };
    } };
    const context = vm.createContext({
      proofIndexPool: () => pool, currentWorkAmountStorageModel: async () => "subatoms",
      WORK_SUBATOM_PROJECTION_MODEL: "subatoms", SUMMARY_SNAPSHOT_LOOKBACK_LIMIT: 4,
      canonicalQ16SummarySnapshotSqlEligibility: () => "canonical_q16_eligibility",
      safeBlockHeight: (value) => Number.isSafeInteger(value) && value > 0 ? value : 0,
      dateIso: (value) => value,
    });
    const read = vm.runInContext(`${extract("summaryPayloadIndexedThroughBlock")}\n${extract("proofIndexSnapshotPayload")}\nproofIndexSnapshotPayload`, context);
    const result = await read("livenet", "marketplaceSummary");
    assert.equal(calls, lookback ? 2 : 1);
    assert.equal(result.indexedThroughBlock, 99);
    assert.equal(result.snapshotId, "canonical-snapshot");
    assert.equal(result.token.amountSubatoms, "900719925474099312345");
    assert.equal(result.workFloor.totalQ8, "900719925474099312345");
    assert.equal(result.token.consistency, consistency);
    assert.equal(result.workFloor.consistency, consistency);
    assert.equal(summary.token.consistency, undefined);
  }
});
