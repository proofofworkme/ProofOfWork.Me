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
      const projection = /SELECT\s+snapshot_id,\s+generated_at,\s+indexed_through_block,\s+consistency,\s+\((?:summary_parts\."summaryPayloads"|summary_payloads)->\$2\) AS summary_payload\s+FROM/u.exec(sql)?.[0];
      assert.ok(projection, "The outer SELECT returns only the requested component and metadata.");
      assert.doesNotMatch(projection, /(?:^|,)\s*(?:snapshot\.)?payload\s*(?:,|$)|SELECT\s+\*/u);
      assert.match(sql, /CROSS JOIN LATERAL/u);
      assert.match(sql, /OFFSET 0/u);
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
      canonicalQ16SummarySnapshotSqlEligibility: (snapshot, parts) => {
        assert.equal(snapshot, "snapshot");
        assert.equal(parts, "summary_parts");
        return "canonical_q16_eligibility";
      },
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

test("compact WORK omits embedded or referenced history inside both SQL selectors", async () => {
  for (const lookback of [false, true]) {
    const summary = { indexedThroughBlock: 99, floor: { indexedThroughBlock: 99, totalQ8: "1234" },
      token: { stats: { confirmedTransfers: 42 } } };
    let calls = 0;
    const pool = { async query(sql, params) {
      calls++;
      assert.equal(params[1], "workSummary");
      assert.match(sql, /\((?:summary_parts\."summaryPayloads"|summary_payloads)->\$2\) - 'workTransferValueProjection' AS summary_payload/u);
      assert.match(sql, /q8_sidecar_inventory/);
      if (lookback && calls === 1) return { rows: [] };
      return { rows: [{ summary_payload: summary, consistency: { ok: true }, indexed_through_block: 99, snapshot_id: "s99" }] };
    } };
    const context = vm.createContext({
      proofIndexPool: () => pool, currentWorkAmountStorageModel: async () => "work-atoms-v1",
      WORK_SUBATOM_PROJECTION_MODEL: "work-subatoms-v2", SUMMARY_SNAPSHOT_LOOKBACK_LIMIT: 4,
      workTransferProjectionSqlEligibility: () => "q8_sidecar_inventory",
      isWorkTransferProjectionReference: value => value?.model === "canonical-work-transfer-projection-reference-v1",
      readWorkTransferProjection: () => assert.fail("compact selection hydrated lifetime history"),
      safeBlockHeight: n => Number.isSafeInteger(n) ? n : 0, dateIso: value => value,
    });
    const read = vm.runInContext(extract("summaryPayloadIndexedThroughBlock") + "\n" + extract("proofIndexSnapshotPayload") + "\nproofIndexSnapshotPayload", context);
    const result = await read("livenet", "workSummary", { includeWorkTransferProjection: false });
    assert.equal(calls, lookback ? 2 : 1);
    assert.equal(result.floor.totalQ8, "1234");
    assert.equal(result.token.stats.confirmedTransfers, 42);
    assert.equal(result.snapshotId, "s99");
    assert.equal(result.workTransferValueProjection, undefined);
  }
});

test("compact output omits confirmed history while full output retains the source", () => {
  const api = readFileSync(new URL("../proof-api.mjs", import.meta.url), "utf8");
  const start = api.indexOf("function compactWorkSummaryPayload(");
  const run = vm.runInNewContext(api.slice(start, api.indexOf("\n}",start) + 2) + "\ncompactWorkSummaryPayload", {});
  for (const history of [{model:"canonical-work-transfer-value-projection-v1",items:[{}]},
    {model:"canonical-work-transfer-projection-reference-v1",pageCount:50}]) {
    const source = {indexedThroughBlock:99,floor:{totalQ8:"1234"},workTransferValueProjection:history};
    const compact = run(source);
    assert.equal(compact.workTransferValueProjection, undefined);
    assert.equal(compact.floor.totalQ8, source.floor.totalQ8);
    assert.equal(compact.indexedThroughBlock, source.indexedThroughBlock);
    assert.equal(source.workTransferValueProjection,history);
  }
});
