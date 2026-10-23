import test from "node:test";
import assert from "node:assert/strict";
import { notificationMatchesDirection } from "./notificationFilters.mjs";
test("related shared-input cards retain outgoing and self-directed constituent actions in the outgoing view", () => {
  for (const direction of ["outgoing", "self"]) {
    const card = { direction: "related", actions: [{ direction }, { direction: "related" }] };
    assert.equal(notificationMatchesDirection(card, "outgoing"), true);
    assert.equal(card.direction, "related");
  }
  assert.equal(notificationMatchesDirection({ direction: "related", actions: [{ direction: "incoming" }] }, "outgoing"), false);
});
test("incoming view includes incoming companions while direct card direction and all view remain available", () => {
  const card = { direction: "outgoing", actions: [{ direction: "incoming" }] };
  assert.equal(notificationMatchesDirection(card, "incoming"), true);
  assert.equal(notificationMatchesDirection(card, "outgoing"), true);
  assert.equal(notificationMatchesDirection({ direction: "related" }, "all"), true);
  assert.equal(notificationMatchesDirection({ direction: "self" }, "incoming"), true);
  assert.equal(notificationMatchesDirection({ direction: "incoming" }, "outgoing"), false);
});
