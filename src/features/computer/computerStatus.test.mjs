import assert from "node:assert/strict";
import test from "node:test";
import { computerShellStatus } from "./computerStatus.mjs";

const entry = { tone: "idle", text: "Workspace selected. Refresh to load verified data.", presentation: "entry" };
const required = { tone: "bad", text: "Connect UniSat first.", presentation: "connection-required" };
const resolve = (status, extra = {}) => computerShellStatus({ workspace: "boost", status, connected: false, ...extra });

test("self-contained workspace owns passive loading/settled state, while Mail keeps its entry status", () => {
  for (const workspace of ["browser", "pages", "boost", "publish", "search", "code", "jobs", "permission"]) {
    assert.equal(resolve(entry, { workspace }), undefined);
  }
  for (const workspace of ["inbox", "desktop", "ids", "dns", "wallet", "marketplace", "log"]) {
    assert.equal(resolve(entry, { workspace }).primary, entry);
  }
});

test("connected scope removes only an explicitly obsolete connection instruction", () => {
  assert.equal(resolve(required).primary, required);
  assert.equal(resolve(required, { connected: true }), undefined);
  assert.equal(resolve(required, { connected: false }).primary, required);
  const signatureCapability = { tone: "bad", text: "UniSat signPsbt is not available." };
  assert.equal(resolve(signatureCapability, { connected: true }).primary, signatureCapability);
});

test("read failures, incomplete coverage, action progress and transaction evidence survive", () => {
  for (const status of [
    { tone: "bad", text: "Current checkpoint could not be verified." },
    { tone: "idle", text: "Coverage is incomplete; pending visibility is best effort." },
    { tone: "idle", text: "Waiting for your local wallet signature…" },
    { tone: "good", text: "Broadcast pending confirmation.", links: [{ text: "Transaction", href: "https://example.test/tx" }] },
    { ...entry, tone: "bad" },
    { ...entry, links: [{ text: "Evidence", href: "https://example.test/evidence" }] },
  ]) assert.equal(resolve(status, { connected: true }).primary, status);
});

test("last-verified evidence stays visible when the shell's generic message is removed", () => {
  const secondaryStatus = { tone: "idle", text: "Last verified at block 100. Refresh unavailable.", links: [{ text: "Source", href: "https://example.test/source" }] };
  assert.deepEqual(resolve(entry, { secondaryStatus }), { primary: secondaryStatus });
  assert.deepEqual(resolve(required, { connected: true, secondaryStatus }), { primary: secondaryStatus });
  const action = { tone: "bad", text: "Broadcast outcome is unknown. Check recovery before retrying." };
  assert.deepEqual(resolve(action, { secondaryStatus }), { primary: action, secondary: secondaryStatus });
});
