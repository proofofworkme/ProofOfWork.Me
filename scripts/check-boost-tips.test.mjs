import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBoostTip, parseBoostTip, boostTipAmount, BOOST_TIP_DEFAULT_SATS } from "../src/shared/protocol/boostTip.mjs";
import { buildSearchDocument } from "../server/search-projection.mjs";
import { boostGrowthObservedAction } from "../server/boost-growth.mjs";
const target = "a".repeat(64);
test("tips preserve exact amounts, Mail companion and content references across Search and Growth", () => {
  assert.equal(BOOST_TIP_DEFAULT_SATS, 546);
  for (const amount of [1, 546, 12345, 2100000000000000]) {
    const tip = buildBoostTip(target, amount);
    assert.deepEqual(parseBoostTip(tip.payload), { targetTxid: target, amountSats: amount });
    assert.equal(boostGrowthObservedAction(tip.payload), "tip");
    assert.ok(tip.mailPayload.startsWith("pwm1:m:Tip "));
    const document = buildSearchDocument({ id: "event:tip", txid: "b".repeat(64), protocol: "pwb1", kind: "boost-tip",
      status: "confirmed", valid: true, amountSats: String(amount), payload: { title: "Boost tip", tipAmountSats: String(amount), targetTxid: target }, rawPayload: tip.payload }, "c".repeat(64));
    assert.equal(document.record.amountSats, String(amount));
    assert.ok(document.searchText.includes(target));
    assert.ok(document.searchText.includes("tip"));
  }
  for (const value of ["", "0", "01", "1.1", "-1", " 546", "1e3", "NaN", "9007199254740993"]) assert.equal(boostTipAmount(value), null);
  assert.throws(() => buildBoostTip("bad", 546));
});
