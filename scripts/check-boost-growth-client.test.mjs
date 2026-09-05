import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOST_GROWTH_COUNT_FIELDS,
  boostProofsDisplay,
  boostWorkDisplay,
  normalizeBoostGrowth,
} from "../src/features/growth/boostGrowth.mjs";

const checkpoint = { blockHeight: 965563, blockHash: "a".repeat(64), snapshotId: "growth-fixture" };
function fixture() {
  return {
    model: "boost-growth-observation-v1",
    source: "proof-indexer-confirmed-boost-growth",
    countScope: "confirmed-indexed-shape-valid-records",
    ready: true, complete: true, checkpoint,
    economicMetricsVerified: false,
    counts: { ...Object.fromEntries(BOOST_GROWTH_COUNT_FIELDS.map((key) => [key, 0])), events: 2, transactions: 1, posts: 1, likes: 1, socialActions: 1 },
    directProofSignalSats: null,
    registryFeeSats: null,
    saleVolumeSats: "0",
    attachedWorkSubatoms: "210000000000000000000001",
    attributedMailSats: "9007199254740993",
    attributedWorkSubatoms: "210000000000000000000001",
    metricReasons: { directProofSignalSats: "Economic validation unavailable." },
  };
}

test("complete observations preserve exact amounts without treating counts as economics", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const observation = normalizeBoostGrowth(input, checkpoint);
  assert.equal(observation.ready, true);
  assert.equal(observation.counts.posts, 1);
  assert.equal(observation.economicMetricsVerified, false);
  assert.equal(observation.directProofSignalSats, null);
  assert.equal(observation.attributedMailSats, "9007199254740993");
  assert.equal(JSON.stringify(input), before);
  assert.equal("totalSats" in observation, false);
  assert.equal("networkValueQ8" in observation, false);
});

test("old, partial, mismatched and malformed observations stay unavailable", () => {
  const invalid = [undefined, {}, { ...fixture(), complete: false },
    { ...fixture(), ready: false }, { ...fixture(), countScope: "feed-page" },
    { ...fixture(), source: "boost-feed" },
    { ...fixture(), checkpoint: { ...checkpoint, snapshotId: "other" } },
    { ...fixture(), checkpoint: { ...checkpoint, blockHash: "b".repeat(64) } },
    { ...fixture(), checkpoint: { ...checkpoint, blockHeight: checkpoint.blockHeight + 1 } },
    { ...fixture(), counts: { ...fixture().counts, events: "2" } },
    { ...fixture(), counts: { ...fixture().counts, events: 0 } },
    { ...fixture(), counts: { ...fixture().counts, posts: -1 } },
  ];
  for (const value of invalid) {
    const observation = normalizeBoostGrowth(value, checkpoint);
    assert.equal(observation.ready, false);
    assert.equal(observation.counts, null);
    assert.equal(observation.attributedMailSats, null);
    assert.ok(observation.reason);
  }
  assert.equal(normalizeBoostGrowth(fixture(), {}).ready, false);
});

test("unknown amounts are never converted to zero and unsafe numeric amounts are rejected", () => {
  for (const value of [undefined, 546, 9007199254740992, "-1", "1.2", "1e3", "01", "9".repeat(81)]) {
    const normalized = normalizeBoostGrowth({ ...fixture(), registryFeeSats: value }, checkpoint);
    assert.equal(normalized.ready, true);
    assert.equal(normalized.registryFeeSats, null);
    assert.ok(normalized.metricReasons.registryFeeSats);
  }
  assert.equal(normalizeBoostGrowth({ ...fixture(), registryFeeSats: "0" }, checkpoint).registryFeeSats, "0");
});

test("display preserves full Q16 quantities and proofs above Number precision", () => {
  assert.equal(boostProofsDisplay("9007199254740993"), "9,007,199,254,740,993 proofs");
  assert.equal(boostWorkDisplay("1"), "0.0000000000000001 WORK");
  assert.equal(boostWorkDisplay("210000000000000000000001"), "21,000,000.0000000000000001 WORK");
  assert.equal(boostWorkDisplay("1000000000"), "0.0000001 WORK");
  assert.equal(boostWorkDisplay(null), "Unavailable");
  assert.equal(boostProofsDisplay(null), "Unavailable");
});
