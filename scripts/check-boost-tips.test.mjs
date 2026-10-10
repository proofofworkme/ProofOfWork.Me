import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBoostTip, parseBoostTip, boostTipAmount, BOOST_TIP_DEFAULT_SATS, buildBoostWorkTip, parseBoostWorkTip, boostTipWorkAmount, BOOST_TIP_WORK_TOKEN_ID } from "../src/shared/protocol/boostTip.mjs";
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

test("WORK tips use an additive exact Q16 record without a Mail carrier", () => {
  for (const amount of ["1", "10000000000000001", "210000000000000000000000"]) {
    const tip = buildBoostWorkTip(target, amount);
    assert.deepEqual(tip, { payload: `pwb1:tip2:${target}:${BOOST_TIP_WORK_TOKEN_ID}:${amount}` });
    assert.deepEqual(parseBoostWorkTip(tip.payload), { targetTxid: target, tokenId: BOOST_TIP_WORK_TOKEN_ID, amountSubatoms: amount });
    assert.equal(parseBoostTip(tip.payload), null);
    const document = buildSearchDocument({ id: "event:work-tip", txid: "b".repeat(64), protocol: "pwb1", kind: "boost-tip",
      status: "confirmed", valid: true, amountSats: "0", payload: { title: "Boost tip", tipCurrency: "WORK", tipWorkSubatoms: amount,
        tokenId: BOOST_TIP_WORK_TOKEN_ID, targetTxid: target }, rawPayload: tip.payload }, "c".repeat(64));
    assert.equal(document.record.amountSats, "0");
    assert.equal(document.payload.tipWorkSubatoms, amount);
    for (const value of [target, amount, BOOST_TIP_WORK_TOKEN_ID, "WORK"]) assert.ok(document.searchText.includes(value));
  }
  assert.equal(buildBoostWorkTip(target, 1n).payload, `pwb1:tip2:${target}:${BOOST_TIP_WORK_TOKEN_ID}:1`);
  for (const amount of ["", "0", "01", "1.1", "-1", " 1", "1 ", "1e3", "NaN", "210000000000000000000001", 1, null]) {
    assert.equal(boostTipWorkAmount(amount), null);
    assert.throws(() => buildBoostWorkTip(target, amount));
    if (typeof amount === "string") assert.equal(parseBoostWorkTip(`pwb1:tip2:${target}:${BOOST_TIP_WORK_TOKEN_ID}:${amount}`), null);
  }
  for (const payload of [`pwb1:tip2:bad:${BOOST_TIP_WORK_TOKEN_ID}:1`, `pwb1:tip2:${target}:${"d".repeat(64)}:1`,
    `pwb1:tip2:${target}:${BOOST_TIP_WORK_TOKEN_ID}:1:extra`, `pwb1:tip2:${target}:${BOOST_TIP_WORK_TOKEN_ID}`]) assert.equal(parseBoostWorkTip(payload), null);
  assert.equal(parseBoostWorkTip(buildBoostTip(target, 546).payload), null);
});
