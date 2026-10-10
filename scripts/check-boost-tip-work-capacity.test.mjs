import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jobs from "../src/shared/protocol/jobs.mjs";

const token = jobs.JOBS_WORK_TOKEN_ID, wallet = "1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH", recipient = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const txid = "a".repeat(64), target = "b".repeat(64);
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
async function load(path, imports = {}) {
  const source = await readFile(path, "utf8");
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, URLSearchParams, localStorage: storage, require: name => {
    assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name];
  } });
  return exports;
}
const amounts = await load("src/workAmount.ts");
const capacity = await load("src/shared/work/canonicalWorkCapacity.ts");
const recovery = await load("src/shared/wallet/actionRecovery.ts");
const existing = await load("src/features/jobs/jobsWorkCapacity.ts", {
  "../../shared/api/proofApiClient": {}, "../../shared/work/canonicalWorkCapacity": capacity,
  "../../shared/wallet/actionRecovery": recovery, "../../shared/protocol/jobs.mjs": jobs, "../../workAmount": amounts,
});
let requests = [], payload, duringRead;
const helper = await load("src/features/boost/boostTipWorkCapacity.ts", {
  "../../shared/api/proofApiClient": { fetchProofApiJson: async (...args) => { requests.push(args); duringRead?.(); return payload; } },
  "../../shared/wallet/actionRecovery": recovery, "../../shared/work/canonicalWorkCapacity": capacity,
  "../jobs/jobsWorkCapacity": existing, "./boostWorkComposer": { BOOST_WORK_TOKEN_ID: token },
});
function receipt(fields = [["Currency", "WORK"]], key = `boost-tip:${target}`, status = "unknown", address = wallet) {
  return { txid, address, network: "livenet", title: "Content tip", key, status, createdAt: new Date().toISOString(), fields };
}
function fixture() {
  return { network: "livenet", authoritativeWallet: true, walletScoped: true,
    source: "proof-indexer-wallet-token-overlay", indexedThroughBlock: 970555, indexedThroughBlockHash: "c".repeat(64),
    holders: [{ address: wallet, tokenId: token, balanceSubatoms: "100" }], listings: [], closedListings: [], transfers: [], sales: [],
    canonicalWorkCapacities: [{ model: "canonical-work-wallet-capacity-v1", network: "livenet", address: wallet, tokenId: token,
      indexedThroughBlock: 970555, indexedThroughBlockHash: "c".repeat(64), confirmedBalanceSubatoms: "100",
      reservedBalanceSubatoms: "10", transferableBalanceSubatoms: "90", reservations: [{ listingId: "d".repeat(64), amountSubatoms: "10" }],
      tokenStateCommitment: { model: "canonical-work-amo-payload-sha256-v1", sha256: "e".repeat(64), payloadBytes: 100 } }] };
}
test("WORK tips use complete canonical capacity after pending debits and reject truncated evidence", async () => {
  values.clear(); requests = []; payload = fixture();
  payload.transfers = [{ txid, tokenId: token, senderAddress: wallet, recipientAddress: recipient, amountSubatoms: "30", confirmed: false }];
  const result = await helper.fetchBoostTipWorkCapacity(wallet);
  assert.equal(result.spendableSubatoms, 60n);
  assert.match(requests[0][0], /wallet=1/); assert.match(requests[0][0], /fresh=1/);
  assert.equal(requests[0][1], "livenet");
  payload.collectionHasMore = { transfers: true };
  await assert.rejects(helper.fetchBoostTipWorkCapacity(wallet), /incomplete transfers/);
});
test("an unknown or pending WORK tip on any target holds the wallet; only its own signed receipt is exempt", () => {
  for (const status of ["unknown", "pending"]) {
    values.clear(); recovery.saveActionReceipt(storage, receipt(undefined, `boost-tip:${"f".repeat(64)}`, status));
    assert.throws(() => helper.assertNoUnresolvedWorkTipDebit(storage, wallet), /earlier signed WORK debit/);
    assert.doesNotThrow(() => helper.assertNoUnresolvedWorkTipDebit(storage, wallet, txid));
    assert.doesNotThrow(() => helper.assertNoUnresolvedWorkTipDebit(storage, recipient));
  }
});
test("proof-only and resolved tips preserve ordinary WORK availability", () => {
  for (const [currency, status] of [["proofs", "unknown"], ["WORK", "confirmed"], ["WORK", "dropped"]]) {
    values.clear(); recovery.saveActionReceipt(storage, receipt([["Currency", currency]], undefined, status));
    assert.doesNotThrow(() => helper.assertNoUnresolvedWorkTipDebit(storage, wallet));
  }
});
test("existing direct WORK sends and accepted WORK Jobs retain the same wallet-wide debit hold", () => {
  values.clear(); recovery.saveActionReceipt(storage, receipt([], `credit-transfer:${token}`));
  assert.throws(() => helper.assertNoUnresolvedWorkTipDebit(storage, wallet), /earlier signed WORK debit/);
  values.clear(); recovery.saveActionReceipt(storage, receipt([["Jobs draft", JSON.stringify({ action: "accept", rewardAsset: "WORK" })]], "jobs:accept:fixture"));
  assert.throws(() => helper.assertNoUnresolvedWorkTipDebit(storage, wallet), /WORK job acceptance/);
});
test("a receipt appearing during the wallet read closes the spending race", async () => {
  values.clear(); payload = fixture(); requests = [];
  duringRead = () => recovery.saveActionReceipt(storage, receipt());
  try { await assert.rejects(helper.fetchBoostTipWorkCapacity(wallet), /earlier signed WORK debit/); }
  finally { duringRead = undefined; }
});
test("unreadable recovery evidence is retained and fails closed", () => {
  values.clear(); storage.setItem(recovery.ACTION_RECEIPTS_KEY, "broken");
  assert.throws(() => helper.assertNoUnresolvedWorkTipDebit(storage, wallet));
  assert.equal(storage.getItem(recovery.ACTION_RECEIPTS_KEY), "broken");
});
