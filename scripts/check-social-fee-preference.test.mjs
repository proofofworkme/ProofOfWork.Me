import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/features/boost/socialFeePreference.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const storageKey = "proofofwork.social-fee.v1";
const cookieName = "proofofwork_social_fee_v1";
const now = 1_800_000_000_000;
const record = (rate, updatedAt = now) => JSON.stringify({ rate, updatedAt });
function fixture({ hostname = "boost.proofofwork.me", protocol = "https:", values = new Map(), jar = { value: "" }, blocked = false, silentCookieWriteFailure = false } = {}) {
  const events = new Map();
  const window = {
    location: { hostname, protocol },
    localStorage: {
      getItem(key) { if (blocked) throw new Error("Blocked storage"); return values.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error("Blocked storage"); values.set(key, value); },
    },
    dispatchEvent(event) { for (const listener of events.get(event.type) ?? []) listener(event); },
    addEventListener(type, listener) { const list = events.get(type) ?? new Set(); list.add(listener); events.set(type, list); },
    removeEventListener(type, listener) { events.get(type)?.delete(listener); },
  };
  let cookieWrites = 0;
  const document = {
    get cookie() { if (blocked) throw new Error("Blocked cookies"); return jar.value; },
    set cookie(value) { cookieWrites++; if (blocked) throw new Error("Blocked cookies"); if (!silentCookieWriteFailure) jar.value = value.split(";")[0]; },
    visibilityState: "visible",
    addEventListener() {}, removeEventListener() {},
  };
  let slots = [], cursor = 0, effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback) { cursor++; return callback; },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => value !== slots[index].dependencies[i])) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { dependencies, cleanup: effect() }; });
      }
    },
  };
  const context = { exports: {}, window, document, Event, Date: class extends Date { static now() { return now; } },
    require(name) { assert.equal(name, "react"); return react; } };
  vm.runInNewContext(compiled, context);
  return {
    api: context.exports, values, jar, cookieWrites: () => cookieWrites,
    event(type, values = {}) { window.dispatchEvent({ type, ...values }); },
    render(locked) {
      cursor = 0; effects = [];
      const result = context.exports.useSocialFeeRate({ locked });
      for (const effect of effects) effect();
      return result;
    },
  };
}

test("social fees retain accepted decimals and reject invalid persisted or input rates", () => {
  const { api } = fixture();
  for (const rate of [0.1, 0.15, 0.12345678, 1, 2.5]) assert.equal(api.validSocialFeeRate(rate), true);
  for (const rate of [0, 0.09, 0.123456789, NaN, Infinity, -1, "0.15", null]) assert.equal(api.validSocialFeeRate(rate), false);
  for (const text of ["0.15", " .15 ", "1.", "0.12345678"]) assert.equal(api.socialFeeRateFromInput(text), Number(text));
  for (const text of ["", "0.", "0x1", "1e-1", "0.123456789", "Infinity", "0.15proofs"]) assert.equal(api.socialFeeRateFromInput(text), undefined);
  assert.equal(api.readSocialFeeRatePreference(), 1);
  assert.equal(api.writeSocialFeeRatePreference(0.15), true);
  assert.equal(api.writeSocialFeeRatePreference(0), false);
  assert.equal(api.readSocialFeeRatePreference(), 0.15);
});

test("a selected fee follows only canonical social product hosts through the shared cookie", () => {
  const jar = { value: "" };
  const boost = fixture({ jar }); boost.api.writeSocialFeeRatePreference(0.15);
  assert.equal(boost.cookieWrites(), 1);
  assert.equal(fixture({ hostname: "publish.proofofwork.me", jar }).api.readSocialFeeRatePreference(), 0.15);
  assert.equal(fixture({ hostname: "computer.proofofwork.me", jar }).api.readSocialFeeRatePreference(), 0.15);
  for (const hostname of ["wallet.proofofwork.me", "other.proofofwork.me", "boost.proofofwork.me.example", "localhost"]) {
    const other = fixture({ hostname, jar });
    assert.equal(other.api.readSocialFeeRatePreference(), 1);
    other.api.writeSocialFeeRatePreference(0.5);
    assert.equal(other.cookieWrites(), 0);
    assert.equal(other.api.readSocialFeeRatePreference(), 0.5);
  }
});

test("origin storage preserves local preview selection and newest valid evidence wins", () => {
  const values = new Map();
  const preview = fixture({ hostname: "localhost", protocol: "http:", values });
  preview.api.writeSocialFeeRatePreference(0.15);
  assert.equal(preview.cookieWrites(), 0);
  assert.equal(fixture({ hostname: "localhost", protocol: "http:", values }).api.readSocialFeeRatePreference(), 0.15);
  const jar = { value: `${cookieName}=${encodeURIComponent(record(0.5, now - 100))}` };
  assert.equal(fixture({ values, jar }).api.readSocialFeeRatePreference(), 0.15);
  jar.value = `${cookieName}=${encodeURIComponent(record(0.25, now + 1))}`;
  assert.equal(fixture({ values, jar }).api.readSocialFeeRatePreference(), 0.25);
});

test("malformed, excessive precision and implausible future records cannot override the default", () => {
  for (const raw of ["not json", "null", record(0.05), record(0.123456789), record(0.15, now + 60_001), record(0.15, -1)]) {
    const values = new Map([[storageKey, raw]]);
    const jar = { value: `${cookieName}=${encodeURIComponent(raw)}` };
    assert.equal(fixture({ values, jar }).api.readSocialFeeRatePreference(), 1);
  }
});

test("blocked persistence and silently refused cookies cannot reset the session selection", () => {
  const blocked = fixture({ blocked: true });
  assert.equal(blocked.api.writeSocialFeeRatePreference(0.15), true);
  assert.equal(blocked.api.readSocialFeeRatePreference(), 0.15);
  const jar = { value: `${cookieName}=${encodeURIComponent(record(1, now - 100))}` };
  const partial = fixture({ jar, silentCookieWriteFailure: true });
  partial.api.writeSocialFeeRatePreference(0.15);
  assert.equal(partial.api.readSocialFeeRatePreference(), 0.15);
  assert.equal(fixture({ jar, values: partial.values }).api.readSocialFeeRatePreference(), 0.15);
});

test("a locked social form keeps its rate across focus and storage changes until dismissed", () => {
  const app = fixture();
  let [rate, choose] = app.render(false);
  assert.equal(rate, 1);
  choose(0.15);
  [rate] = app.render(true);
  assert.equal(rate, 0.15);
  app.values.set(storageKey, record(0.5, now + 10));
  app.event("storage", { key: storageKey }); app.event("focus");
  [rate] = app.render(true);
  assert.equal(rate, 0.15);
  app.render(false);
  [rate] = app.render(false);
  assert.equal(rate, 0.5);
  [, choose] = app.render(true);
  choose(0);
  [rate] = app.render(true);
  assert.equal(rate, 0, "incomplete decimal typing remains editable");
  assert.equal(app.api.readSocialFeeRatePreference(), 0.5, "incomplete editing is not persisted");
});
