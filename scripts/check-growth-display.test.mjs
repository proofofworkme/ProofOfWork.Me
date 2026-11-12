import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { growthMagnitude } from "../src/features/growth/growthDisplay.mjs";
import { GROWTH_PRODUCT_COVERAGE } from "../src/features/growth/growthForecast.mjs";
test("large values remain bounded presentation, invalid values are not zero", () => {
  assert.equal(growthMagnitude(0), "0");
  assert.equal(growthMagnitude(21000000), "21M");
  assert.match(growthMagnitude(9.007199254740993e25), /E/);
  assert.ok(growthMagnitude(-9.007199254740993e25).length < 15);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(growthMagnitude(value), "Unavailable");
});
test("canonical menu surfaces all have explicit coverage without adding value lanes", () => {
  const source = readFileSync(new URL("../src/app/appLinks.ts", import.meta.url), "utf8");
  const appLinks = source.split("export const APP_LINKS:")[1].split("];", 1)[0];
  const labels = [...appLinks.matchAll(/label: "([^"\n]+)"/g)].map((match) => match[1]);
  assert.ok(labels.length >= 21);
  for (const label of labels) assert.ok(GROWTH_PRODUCT_COVERAGE.some((entry) => entry.name === label || (label === "Credit" && entry.product === "credit")), label);
  assert.equal(new Set(GROWTH_PRODUCT_COVERAGE.map((entry) => entry.product)).size, GROWTH_PRODUCT_COVERAGE.length);
  assert.equal(GROWTH_PRODUCT_COVERAGE.find((entry) => entry.product === "permission").role, "shared");
  assert.match(GROWTH_PRODUCT_COVERAGE.find((entry) => entry.product === "dns").modeledLane, /No standalone DNS forecast/);
});
