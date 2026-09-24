import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalQ8IntegerText,
  q8IntegerTextsAgree,
  q8SatsDecimalText,
} from "./work-units.mjs";

test("canonical Q8 reconciliation preserves values above Number precision", () => {
  const exact = "1438911276484413066246628916";
  const oneQ8UnitLess = "1438911276484413066246628915";

  assert.equal(Number(BigInt(exact)), Number(BigInt(oneQ8UnitLess)));
  assert.equal(q8IntegerTextsAgree(exact, exact), true);
  assert.equal(q8IntegerTextsAgree(exact, oneQ8UnitLess), false);
  assert.equal(
    q8SatsDecimalText(exact),
    "14389112764844130662.46628916",
  );
});

test("Q8 comparison rejects noncanonical, numeric, and incomplete values", () => {
  assert.equal(canonicalQ8IntegerText("0"), "0");
  assert.equal(canonicalQ8IntegerText("0001"), "");
  assert.equal(canonicalQ8IntegerText(1), "");
  assert.equal(q8IntegerTextsAgree("1"), false);
  assert.equal(q8IntegerTextsAgree("1", "1.0"), false);
  assert.equal(q8IntegerTextsAgree("1", 1), false);
  assert.equal(q8SatsDecimalText(""), "");
});
