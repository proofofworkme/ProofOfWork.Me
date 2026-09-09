import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { canonicalProtocolCandidateFromOutput } from "../server/canonical-op-return.mjs";

const source = await readFile(new URL("../server/proof-api.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("proof-api.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = ast.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "pendingWorkMarketPayloadFromTransactions");
assert.ok(declaration, "current recovery function exists");
let verified = [], warnings = [];
const env = {
  canonicalProtocolCandidateFromOutput,
  dedupeTransactions: (txs) => txs,
  transactionConfirmed: () => false,
  transactionTxid: (tx) => tx.txid,
  tokenProtocolSortedTransactions: (txs) => txs,
  inputAddresses: () => ["actor"],
  isValidBitcoinAddress: () => true,
  pendingWorkVerifierStageRawTransaction: (tx) => {
    verified.push(tx.txid);
    throw Error("strict verifier retained");
  },
  console: { error: (text) => warnings.push(text) },
  errorSummary: (error) => error.message,
};
const recover = new Function(...Object.keys(env), `${declaration.getText(ast)};return pendingWorkMarketPayloadFromTransactions`)(...Object.values(env));
const carrier = (text) => `6a${Buffer.byteLength(text).toString(16).padStart(2, "0")}${Buffer.from(text).toString("hex")}`;
const transaction = (i, scriptpubkey) => ({
  _powCanonicalRpcHydration: true, txid: i.toString(16).padStart(64, "0"),
  vin: [{}], vout: [{ scriptpubkey }],
});

const ordinary = transaction(1, `0014${"a".repeat(40)}`);
const mail = transaction(2, carrier("pwm1:m:ordinary mail"));
const misleadingAsm = { ...transaction(3, "51"), vout: [{ scriptpubkey: "51", scriptpubkey_asm: "OP_RETURN pwt1:list5:fake" }] };
assert.equal(recover("livenet", [ordinary, mail, misleadingAsm]), null);
assert.deepEqual(verified, []);
assert.deepEqual(warnings, []);

const pwt = transaction(4, carrier("pwt1:list5:test"));
const malformedPwt = transaction(5, `${carrier("pwt1:")}76`);
assert.equal(recover("livenet", [ordinary, pwt, malformedPwt]), null);
assert.deepEqual(verified, [pwt.txid, malformedPwt.txid]);
assert.equal(warnings.length, 2);
assert.ok(warnings.every((text) => text.includes("strict verifier retained")));
process.stdout.write("Audit 6 WORK discovery: non-carriers skipped; valid and malformed PWT carriers retain strict verification.\n");

const sweepDeclaration = ast.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "workAmoV8ExactReadinessSweep");
assert.ok(sweepDeclaration, "current readiness sweep exists");
const firstProbe = { tipHeight: 123, tipHash: "a".repeat(64), workerReadiness: { state: "ready" } };
const nextProbe = { ...firstProbe, tipHash: "b".repeat(64) };
async function runSweep(probes, migrationRead, diagnostics = {}) {
  const scope = {
    workAmoV8ExactLiveProbe: async () => {
      const next = probes.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    workAmoV8ExactLiveProbeKey: (probe) => probe ? `${probe.tipHeight}:${probe.tipHash}` : "",
    proofIndexWorkPrecisionV2MigrationReadiness: migrationRead,
  };
  const sweep = new Function(...Object.keys(scope), `${sweepDeclaration.getText(ast)};return workAmoV8ExactReadinessSweep`)(...Object.values(scope));
  return { result: await sweep("livenet", {}, { diagnostics }), diagnostics };
}
const readyMigration = Object.freeze({ evidenceComplete: true, exactTipReady: true });
const readySweep = await runSweep([firstProbe, firstProbe], async () => readyMigration);
assert.deepEqual(readySweep.result, { migrationReadiness: readyMigration, probe: firstProbe });
assert.equal(readySweep.diagnostics.outcome, "readiness-fence-stable");
assert.deepEqual(Object.keys(readySweep.diagnostics.phases), ["beforeProbe", "migrationRead", "afterProbe"]);
assert.ok(readySweep.diagnostics.elapsedMs >= 0);
assert.equal(readySweep.diagnostics.afterCheckpoint.tipHash, firstProbe.tipHash);
const changedSweep = await runSweep([firstProbe, nextProbe], async () => readyMigration);
assert.equal(changedSweep.result, null);
assert.equal(changedSweep.diagnostics.outcome, "readiness-fence-changed");
const missingBefore = await runSweep([null], () => { throw Error("must not read migration"); });
assert.equal(missingBefore.result, null);
assert.equal(missingBefore.diagnostics.outcome, "before-probe-unavailable");
const missingAfter = await runSweep([firstProbe, null], async () => readyMigration);
assert.equal(missingAfter.result, null);
assert.equal(missingAfter.diagnostics.outcome, "after-probe-unavailable");
const sqlFailure = Object.assign(Error("private SQL and connection details"), { code: "57014" });
const unavailableSweep = await runSweep([firstProbe, firstProbe], async () => { throw sqlFailure; });
assert.deepEqual(unavailableSweep.result, { migrationReadiness: null, probe: firstProbe });
assert.equal(unavailableSweep.diagnostics.outcome, "migration-read-unavailable");
assert.equal(unavailableSweep.diagnostics.migrationReadError, "57014");
assert.ok(!JSON.stringify(unavailableSweep.diagnostics).includes("private"));
const failedProbeDiagnostics = {};
await assert.rejects(runSweep([sqlFailure], async () => readyMigration, failedProbeDiagnostics), { message: sqlFailure.message });
assert.equal(failedProbeDiagnostics.failedPhase, "beforeProbe");
assert.equal(failedProbeDiagnostics.outcome, "probe-read-error");
assert.equal(failedProbeDiagnostics.readError, "57014");
assert.deepEqual((await runSweep([firstProbe, firstProbe], async () => readyMigration, null)).result, readySweep.result);
process.stdout.write("Audit 6 WORK readiness: six phase/failure paths preserve authority results and redact raw errors.\n");
