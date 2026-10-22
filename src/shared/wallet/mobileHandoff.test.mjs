import { test } from "node:test";
import assert from "node:assert/strict";
import { isMobileWalletBrowser, unisatMobileHandoff } from "./mobileHandoff.mjs";

test("mobile detection does not replace desktop, including touch-screen Windows", () => {
  for (const userAgent of ["Mozilla Android Chrome Mobile", "iPhone", "iPad", "iPod"]) {
    assert.equal(isMobileWalletBrowser({ userAgent }), true);
  }
  assert.equal(isMobileWalletBrowser({ platform: "MacIntel", maxTouchPoints: 5 }), true);
  for (const environment of [{}, { userAgent: "Chrome Linux" }, { platform: "Win32", maxTouchPoints: 10 }, { platform: "MacIntel", maxTouchPoints: 0 }]) {
    assert.equal(isMobileWalletBrowser(environment), false);
  }
});

test("handoff targets the current public route with UniSat's exact array encoding", () => {
  const destination = "https://computer.proofofwork.me/?folder=wallet&network=livenet&asset=WORK";
  const result = unisatMobileHandoff(destination);
  const link = new URL(result.href);
  assert.equal(link.origin + link.pathname, "https://app.unisat.cloud/request");
  assert.equal(link.searchParams.get("method"), "openDapp");
  assert.equal(link.searchParams.get("from"), "ProofOfWorkMe");
  assert.deepEqual(JSON.parse(atob(link.searchParams.get("data"))), [destination]);
  assert.equal(result.destination, destination);
});

test("arbitrary callback credentials, draft parameters and fragments never cross browsers", () => {
  const result = unisatMobileHandoff("https://publish.proofofwork.me/write?network=livenet&draft=private&callback=secret&access_token=secret#private-draft");
  assert.equal(result.destination, "https://publish.proofofwork.me/write?network=livenet");
  assert.equal(atob(new URL(result.href).searchParams.get("data")).includes("private"), false);
});

test("public Unicode paths and searches survive round trip; invalid schemes and credentials fail", () => {
  const input = "https://code.proofofwork.me/café?repo=abc&path=文章/🧭.txt";
  const result = unisatMobileHandoff(input);
  assert.deepEqual(JSON.parse(atob(new URL(result.href).searchParams.get("data"))), [new URL(input).href]);
  for (const value of ["javascript:alert(1)", "file:///tmp/test", "https://user:password@example.com", "not a URL"]) {
    assert.throws(() => unisatMobileHandoff(value));
  }
});
