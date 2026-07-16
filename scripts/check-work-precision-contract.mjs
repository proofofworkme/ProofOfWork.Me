import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
  decimalValueToQ8,
  formatWorkAtoms,
  isCanonicalWorkAtoms,
  normalizeWorkAtoms,
  parseSignedWorkAmountToAtoms,
  parseWorkAmountToAtoms,
  q8ToCanonicalDecimal,
  q8ToNumber,
  withWorkPrecisionMetadata,
  workAmountAtomsFromRecord,
  workAmountFields,
  workAtomsValueAtFloorQ8,
} from "../server/work-units.mjs";

const repoRoot = new URL("../", import.meta.url);
const [
  backfill,
  ledgerAudit,
  reader,
  worker,
  workerUnit,
  workAmountSource,
] = await Promise.all([
  readFile(new URL("scripts/backfill-proof-indexer.mjs", repoRoot), "utf8"),
  readFile(new URL("scripts/audit-ledger-consistency.mjs", repoRoot), "utf8"),
  readFile(new URL("server/db/proof-index-reader.mjs", repoRoot), "utf8"),
  readFile(new URL("scripts/run-proof-indexer-worker.mjs", repoRoot), "utf8"),
  readFile(
    new URL("deploy/proofofwork-indexer-worker.service", repoRoot),
    "utf8",
  ),
  readFile(new URL("src/workAmount.ts", repoRoot), "utf8"),
  ]);
const workAmountModule = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(workAmountSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).toString("base64")}`
);

assert.equal(WORK_DECIMALS, 8);
assert.equal(WORK_UNIT_SCALE_TEXT, "100000000");
assert.match(WORK_TOKEN_ID, /^[0-9a-f]{64}$/u);
assert.equal(parseWorkAmountToAtoms("0.00000001"), "1");
assert.equal(parseWorkAmountToAtoms("1"), "100000000");
assert.equal(parseWorkAmountToAtoms("1.23456789"), "123456789");
assert.equal(
  parseWorkAmountToAtoms("21000000"),
  "2100000000000000",
);
assert.equal(parseSignedWorkAmountToAtoms("-1.00000001"), "-100000001");
assert.equal(formatWorkAtoms("1"), "0.00000001");
assert.equal(formatWorkAtoms("123456789"), "1.23456789");
assert.equal(formatWorkAtoms("100000000"), "1");
assert.equal(
  formatWorkAtoms("2100000000000000"),
  "21000000",
);
assert.equal(normalizeWorkAtoms("123456789"), "123456789");
assert.equal(isCanonicalWorkAtoms("123456789"), true);
assert.equal(isCanonicalWorkAtoms("0123456789"), false);
assert.equal(workAmountModule.workAtomsFromRecord("01", "1"), null);
assert.equal(
  workAmountModule.workAtomsFromRecord("", "1"),
  100_000_000n,
);
assert.equal(
  workAmountModule.workAtomsFromRecord(undefined, "1"),
  100_000_000n,
);
assert.equal(decimalValueToQ8("11678198.442567484"), 1167819844256748n);
const productionScaleValueQ8 = workAtomsValueAtFloorQ8(
  357406000000000n,
  "11678198.442567484",
);
assert.equal(productionScaleValueQ8, 4173858192564272756880n);
assert.equal(
  q8ToCanonicalDecimal(productionScaleValueQ8),
  "41738581925642.7275688",
);
assert.equal(q8ToNumber(productionScaleValueQ8), 41738581925642.73);

for (const invalid of [
  "",
  "0",
  ".1",
  "1.",
  "01",
  "1e-8",
  "1,000",
  "-1",
  "1.234567890",
]) {
  assert.throws(() => parseWorkAmountToAtoms(invalid), undefined, invalid);
}
for (const invalid of ["-0", "-01", "+1", "1.0", "1e8"]) {
  assert.equal(isCanonicalWorkAtoms(invalid, { allowNegative: true }), false);
}

assert.deepEqual(
  workAmountFields({ amount: "42" }),
  {
    amount: "42",
    amountAtoms: "4200000000",
    decimals: 8,
    unitScale: "100000000",
  },
);
assert.deepEqual(
  workAmountFields({ amountAtoms: "123456789" }),
  {
    amount: "1.23456789",
    amountAtoms: "123456789",
    decimals: 8,
    unitScale: "100000000",
  },
);
assert.equal(
  workAmountAtomsFromRecord({
    saleAuthorization: {
      amount: 7,
      version: "pwt-sale-v1",
    },
  }),
  "700000000",
);
assert.equal(
  workAmountAtomsFromRecord({
    saleAuthorization: {
      amountAtoms: "7",
      version: "pwt-sale-v2",
    },
  }),
  "7",
);
assert.deepEqual(withWorkPrecisionMetadata({ ticker: "WORK" }), {
  amountStorageModel: WORK_ATOMIC_PROJECTION_MODEL,
  decimals: 8,
  ticker: "WORK",
  unitScale: "100000000",
});

assert.match(backfill, /action === "send" \|\| action === "send2"/u);
assert.match(backfill, /--audit-work-atoms/u);
assert.match(backfill, /--migrate-work-atoms/u);
assert.match(backfill, /--verify-work-atoms-post-bootstrap/u);
assert.match(backfill, /POW_INDEX_WORK_ATOMIC_MIGRATION_APPLY/u);
assert.match(backfill, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
assert.match(backfill, /pg_advisory_xact_lock/u);
assert.match(backfill, /proof_indexer\.transactions/u);
assert.match(backfill, /rebuildConfirmedCreditBalancesFromCanonicalEvents/u);
assert.match(backfill, /invalidateWorkAtomicDerivedSnapshots/u);
assert.match(backfill, /verifyWorkAtomicPostBootstrap/u);
assert.match(backfill, /issuanceValueSnapshotId/u);
assert.match(backfill, /unmarked_non_oracle_derived/u);
assert.match(backfill, /workAmountStorageModel/u);
assert.match(backfill, /assertWorkAtomicEventMigration/u);
assert.match(backfill, /preservePendingDeltas/u);
assert.match(reader, /"pwt-sale-v2"/u);
assert.match(reader, /authorization\?\.version === "pwt-sale-v2"/u);
assert.match(reader, /isWorkTokenId\(authorization\?\.tokenId\)/u);
assert.match(reader, /WORK_TOKEN_TICKER/u);
assert.match(reader, /balanceAtoms/u);
assert.match(reader, /pendingDeltaAtoms/u);
assert.match(reader, /confirmedSupplyAtoms/u);
assert.match(reader, /amountAtoms/u);
assert.match(reader, /function incbExactIssuanceMetadata/u);
assert.match(reader, /attachedWorkAmountAtoms/u);
assert.match(reader, /attachedWorkLiveValueAtSendQ8/u);
assert.match(reader, /issuanceDustQ8/u);
assert.match(reader, /issuanceNetworkValueQ8/u);
assert.match(reader, /issuanceValueSnapshotWorkNetworkValueQ8/u);
assert.match(
  reader,
  /fractional exact issuance metadata does not conserve value/u,
);
assert.match(worker, /POW_INDEX_REQUIRE_WORK_ATOMS/u);
assert.match(worker, /assertWorkAtomicProjectionReady/u);
assert.match(workerUnit, /Environment=POW_INDEX_REQUIRE_WORK_ATOMS=1/u);
assert.match(
  ledgerAudit,
  /function workAmountMatches[\s\S]*typeof record\?\.amount === "string"[\s\S]*typeof record\?\.amountAtoms === "string"/u,
);
assert.match(ledgerAudit, /workAmountMatches\(item, "101000"\)/u);
assert.match(ledgerAudit, /workAmountMatches\(item, "10000"\)/u);
assert.match(ledgerAudit, /workAmountMatches\(item, "20000"\)/u);
assert.doesNotMatch(
  ledgerAudit,
  /item\.amount === (?:101_000|10_000|20_000)/u,
);

console.log(
  JSON.stringify({
    checks: 74,
    model: WORK_ATOMIC_PROJECTION_MODEL,
    ok: true,
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_UNIT_SCALE_TEXT,
  }),
);
