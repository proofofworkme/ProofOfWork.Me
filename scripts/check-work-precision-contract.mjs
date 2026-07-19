import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
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
  appSource,
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
  readFile(new URL("src/App.tsx", repoRoot), "utf8"),
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

function topLevelFunctionSource(source, name) {
  const startPattern = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${name}(?:<[^>]+>)?\\s*\\(`,
    "mu",
  );
  const startMatch = startPattern.exec(source);
  if (!startMatch) {
    throw new Error(`Could not find ${name}.`);
  }
  const rest = source.slice(startMatch.index + startMatch[0].length);
  const nextMatch = /\n(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/mu.exec(
    rest,
  );
  const end = nextMatch
    ? startMatch.index + startMatch[0].length + nextMatch.index
    : source.length;
  return source.slice(startMatch.index, end).trim().replace(/^export\s+/u, "");
}

function isolatedTypeScriptFunction(source, name, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  const definition = topLevelFunctionSource(source, name);
  const transpiled = ts.transpileModule(definition, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  new vm.Script(`${transpiled}\nthis.__checkedFunction = ${name};`).runInContext(
    context,
  );
  return context.__checkedFunction;
}

const frontendExactIntegerBigInt = (value) => {
  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  return /^(?:0|[1-9]\d*)$/u.test(text) ? BigInt(text) : null;
};
const frontendCompareExactIntegers = (left, right) => {
  const leftExact = frontendExactIntegerBigInt(left);
  const rightExact = frontendExactIntegerBigInt(right);
  if (leftExact === null || rightExact === null) {
    return 0;
  }
  return leftExact < rightExact ? -1 : leftExact > rightExact ? 1 : 0;
};
const frontendExactDecimalText = (value) => {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text) ? text : "";
};
const frontendIsWorkToken = (token) =>
  String(token?.tokenId ?? "").trim().toLowerCase() === WORK_TOKEN_ID ||
  String(token?.ticker ?? "").trim().toUpperCase() === "WORK";
const frontendIsBondTokenDefinition = (token) =>
  ["POWB", "INCB"].includes(
    String(token?.ticker ?? "").trim().toUpperCase(),
  );
const frontendWorkRecordAtoms = (amount, amountAtoms) =>
  workAmountModule.workAtomsFromRecord(amountAtoms, amount);
const frontendTokenRecordAmountAtoms = (token, amount, amountAtoms) =>
  frontendIsWorkToken(token)
    ? frontendWorkRecordAtoms(amount, amountAtoms)
    : frontendExactIntegerBigInt(amount);
const tokenWalletBalanceAmountUnits = isolatedTypeScriptFunction(
  appSource,
  "tokenWalletBalanceAmountUnits",
  { tokenRecordAmountAtoms: frontendTokenRecordAmountAtoms },
);
const tokenWalletBalanceHasAmount = isolatedTypeScriptFunction(
  appSource,
  "tokenWalletBalanceHasAmount",
  { tokenWalletBalanceAmountUnits },
);
const compareTokenWalletBalanceAmounts = isolatedTypeScriptFunction(
  appSource,
  "compareTokenWalletBalanceAmounts",
  { tokenWalletBalanceAmountUnits },
);
const tokenWalletBalanceHasConfirmed = isolatedTypeScriptFunction(
  appSource,
  "tokenWalletBalanceHasConfirmed",
  { tokenWalletBalanceHasAmount },
);
const tokenHolderMatchesDefinition = isolatedTypeScriptFunction(
  appSource,
  "tokenHolderMatchesDefinition",
  {
    normalizeTokenTicker: (ticker) => String(ticker ?? "").toUpperCase(),
  },
);
const tokenHolderBalanceUnits = isolatedTypeScriptFunction(
  appSource,
  "tokenHolderBalanceUnits",
  { tokenRecordAmountAtoms: frontendTokenRecordAmountAtoms },
);
const compareTokenHolderBalances = isolatedTypeScriptFunction(
  appSource,
  "compareTokenHolderBalances",
  { tokenHolderBalanceUnits },
);
const tokenWalletBalancesFor = isolatedTypeScriptFunction(
  appSource,
  "tokenWalletBalancesFor",
  {
    compareTokenWalletBalanceAmounts,
    exactIntegerBigInt: frontendExactIntegerBigInt,
    isBondTokenDefinition: frontendIsBondTokenDefinition,
    isWorkToken: frontendIsWorkToken,
    tokenRecordAmountAtoms: frontendTokenRecordAmountAtoms,
    tokenHolderMatchesDefinition,
    tokenWalletBalanceHasAmount,
    workNumberFromAtoms: (atoms) => Number(atoms) / 100_000_000,
    workRecordAtoms: frontendWorkRecordAtoms,
  },
);
const bondDecimalQ8 = isolatedTypeScriptFunction(
  appSource,
  "bondDecimalQ8",
  {
    exactDecimalText: frontendExactDecimalText,
    exactIntegerBigInt: frontendExactIntegerBigInt,
  },
);
const infinitySummaryRegresses = isolatedTypeScriptFunction(
  appSource,
  "infinitySummaryRegresses",
  {
    bondDecimalQ8,
    compareExactIntegers: frontendCompareExactIntegers,
    tokenStateRegresses: () => false,
  },
);
const highestExactWorkQ8 = isolatedTypeScriptFunction(
  appSource,
  "highestExactWorkQ8",
  { exactIntegerBigInt: frontendExactIntegerBigInt },
);
const workFloorQuoteLiveValueQ8 = isolatedTypeScriptFunction(
  appSource,
  "workFloorQuoteLiveValueQ8",
  { highestExactWorkQ8 },
);
const workFloorQuoteFrozenValueQ8 = isolatedTypeScriptFunction(
  appSource,
  "workFloorQuoteFrozenValueQ8",
  { highestExactWorkQ8 },
);
const workFloorQuoteRegresses = isolatedTypeScriptFunction(
  appSource,
  "workFloorQuoteRegresses",
  {
    workFloorQuoteFrozenValue: () => 0,
    workFloorQuoteFrozenValueQ8,
    workFloorQuoteLiveValue: () => 0,
    workFloorQuoteLiveValueQ8,
  },
);
const exactWorkQ8AliasMatches = isolatedTypeScriptFunction(
  appSource,
  "exactWorkQ8AliasMatches",
  {
    bondDecimalQ8,
    exactIntegerBigInt: frontendExactIntegerBigInt,
  },
);
const growthActualValueHasCanonicalWorkQ8 = isolatedTypeScriptFunction(
  appSource,
  "growthActualValueHasCanonicalWorkQ8",
  {
    WORK_NETWORK_VALUE_ACCOUNTING_MODEL:
      "canonical-exact-work-network-q8-v1",
    exactIntegerBigInt: frontendExactIntegerBigInt,
    exactWorkQ8AliasMatches,
  },
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

const walletAddress = "1WorkAtomicWallet111111111111111111";
const workToken = {
  ticker: "WORK",
  tokenId: WORK_TOKEN_ID,
};
const oneAtomBalances = tokenWalletBalancesFor(
  walletAddress,
  [workToken],
  [],
  [],
  [],
  [
    {
      address: walletAddress,
      balance: 0.00000001,
      balanceAtoms: "1",
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
    },
  ],
);
assert.equal(oneAtomBalances.length, 1);
assert.equal(oneAtomBalances[0].confirmedBalanceAtoms, "1");
assert.equal(tokenWalletBalanceHasConfirmed(oneAtomBalances[0]), true);
assert.equal(oneAtomBalances.filter(tokenWalletBalanceHasConfirmed).length, 1);

const oneAtomBaselineWithConfirmedHistory = tokenWalletBalancesFor(
  walletAddress,
  [workToken],
  [
    {
      amount: 1,
      amountAtoms: "100000000",
      confirmed: true,
      minterAddress: walletAddress,
      tokenId: WORK_TOKEN_ID,
    },
  ],
  [],
  [],
  [
    {
      address: walletAddress,
      balance: 0.00000001,
      balanceAtoms: "1",
      ticker: "WORK",
      tokenId: WORK_TOKEN_ID,
    },
  ],
);
assert.equal(oneAtomBaselineWithConfirmedHistory.length, 1);
assert.equal(
  oneAtomBaselineWithConfirmedHistory[0].confirmedBalanceAtoms,
  "1",
  "an exact holder baseline must prevent confirmed history double-counting",
);

const pendingAtomBalances = tokenWalletBalancesFor(
  walletAddress,
  [workToken],
  [],
  [
    {
      amount: 0.00000001,
      amountAtoms: "1",
      confirmed: false,
      recipientAddress: walletAddress,
      senderAddress: "1PendingWorkSender11111111111111111",
      tokenId: WORK_TOKEN_ID,
    },
  ],
  [],
  [],
);
assert.equal(pendingAtomBalances.length, 1);
assert.equal(pendingAtomBalances[0].pendingIncomingAtoms, "1");
assert.equal(
  tokenWalletBalanceHasAmount(pendingAtomBalances[0], "pendingIncoming"),
  true,
);

const fractionalWalletBalances = [
  {
    confirmedBalance: 0.00000001,
    confirmedBalanceAtoms: "1",
    pendingIncoming: 0,
    pendingIncomingAtoms: "0",
    pendingOutgoing: 0,
    pendingOutgoingAtoms: "0",
    token: workToken,
  },
  {
    confirmedBalance: 0.00000002,
    confirmedBalanceAtoms: "2",
    pendingIncoming: 0,
    pendingIncomingAtoms: "0",
    pendingOutgoing: 0,
    pendingOutgoingAtoms: "0",
    token: workToken,
  },
].sort((left, right) =>
  compareTokenWalletBalanceAmounts(right, left, "confirmedBalance"),
);
assert.equal(fractionalWalletBalances[0].confirmedBalanceAtoms, "2");

const fractionalHolders = [
  {
    address: "1LowWorkHolder111111111111111111111",
    balance: 0.00000001,
    balanceAtoms: "1",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
  },
  {
    address: "1HighWorkHolder11111111111111111111",
    balance: 0.00000002,
    balanceAtoms: "2",
    ticker: "WORK",
    tokenId: WORK_TOKEN_ID,
  },
].sort((left, right) => compareTokenHolderBalances(right, left));
assert.equal(fractionalHolders[0].balanceAtoms, "2");
const exactBondNetworkValueQ8 = 900_719_925_474_099_312_345_678n;
const bondSummary = (networkValueQ8) => ({
  networkValueQ8: networkValueQ8.toString(),
  networkValueSats: "9007199254740993.12345678",
  stats: {
    confirmedBondActions: 1,
    confirmedSupply: "9007199254740993",
  },
  token: {},
});
assert.equal(
  infinitySummaryRegresses(
    bondSummary(exactBondNetworkValueQ8 - 1n),
    bondSummary(exactBondNetworkValueQ8),
  ),
  true,
  "a one-Q8 bond network regression above Number precision must be rejected",
);
assert.equal(
  infinitySummaryRegresses(
    bondSummary(exactBondNetworkValueQ8),
    bondSummary(exactBondNetworkValueQ8),
  ),
  false,
);
const exactWorkNetworkValueQ8 = 900_719_925_474_099_312_345_679n;
const workFloorSummary = (networkValueQ8, frozenValueQ8 = networkValueQ8) => ({
  actualValue: {
    frozenNetworkValueQ8: frozenValueQ8.toString(),
    frozenTotalQ8: frozenValueQ8.toString(),
    liveNetworkValueQ8: networkValueQ8.toString(),
    liveTotalQ8: networkValueQ8.toString(),
    networkValueQ8: networkValueQ8.toString(),
    totalQ8: networkValueQ8.toString(),
  },
  chartPoints: [{}, {}, {}],
  frozenNetworkValueQ8: frozenValueQ8.toString(),
  liveNetworkValueQ8: networkValueQ8.toString(),
  networkValueQ8: networkValueQ8.toString(),
  totalQ8: networkValueQ8.toString(),
});
assert.equal(
  workFloorQuoteRegresses(
    workFloorSummary(exactWorkNetworkValueQ8 - 1n, exactWorkNetworkValueQ8),
    workFloorSummary(exactWorkNetworkValueQ8),
  ),
  true,
  "a one-Q8 WORK network regression above Number precision must be rejected",
);
assert.equal(
  workFloorQuoteRegresses(
    workFloorSummary(exactWorkNetworkValueQ8 + 1n),
    workFloorSummary(exactWorkNetworkValueQ8),
  ),
  false,
  "a one-Q8 WORK network advance above Number precision must be accepted",
);

const decimalFromQ8 = (value) => {
  const whole = value / 100_000_000n;
  const fraction = (value % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${fraction}`;
};
const exactWorkActualValue = (() => {
  const baseQ8 = exactWorkNetworkValueQ8 - 300_000_000n;
  const frozenQ8 = exactWorkNetworkValueQ8 - 100_000_000n;
  const floorQ8 = 42_949_672_955n;
  const frozenFloorQ8 = floorQ8 - 1n;
  return {
    baseNetworkValueQ8: baseQ8.toString(),
    baseNetworkValueSatsExact: decimalFromQ8(baseQ8),
    baseTotalQ8: baseQ8.toString(),
    baseTotalSatsExact: decimalFromQ8(baseQ8),
    floorQ8: floorQ8.toString(),
    floorSatsExact: decimalFromQ8(floorQ8),
    frozenFloorQ8: frozenFloorQ8.toString(),
    frozenFloorSatsExact: decimalFromQ8(frozenFloorQ8),
    frozenNetworkValueQ8: frozenQ8.toString(),
    frozenNetworkValueSatsExact: decimalFromQ8(frozenQ8),
    frozenTotalQ8: frozenQ8.toString(),
    frozenTotalSatsExact: decimalFromQ8(frozenQ8),
    liveFloorQ8: floorQ8.toString(),
    liveFloorSatsExact: decimalFromQ8(floorQ8),
    liveNetworkValueQ8: exactWorkNetworkValueQ8.toString(),
    liveNetworkValueSatsExact: decimalFromQ8(exactWorkNetworkValueQ8),
    liveTotalQ8: exactWorkNetworkValueQ8.toString(),
    liveTotalSatsExact: decimalFromQ8(exactWorkNetworkValueQ8),
    networkValueQ8: exactWorkNetworkValueQ8.toString(),
    networkValueSatsExact: decimalFromQ8(exactWorkNetworkValueQ8),
    totalQ8: exactWorkNetworkValueQ8.toString(),
    totalSatsExact: decimalFromQ8(exactWorkNetworkValueQ8),
    workNetworkValueAccountingModel:
      "canonical-exact-work-network-q8-v1",
  };
})();
assert.equal(growthActualValueHasCanonicalWorkQ8(exactWorkActualValue), true);
assert.equal(
  growthActualValueHasCanonicalWorkQ8({
    ...exactWorkActualValue,
    totalSatsExact: decimalFromQ8(exactWorkNetworkValueQ8 - 1n),
  }),
  false,
  "a one-Q8 exact decimal alias mismatch must fail closed",
);
assert.equal(
  growthActualValueHasCanonicalWorkQ8({
    ...exactWorkActualValue,
    workNetworkValueAccountingModel: "legacy-number-model",
  }),
  false,
  "the WORK exact-Q8 model marker is mandatory",
);
assert.match(
  topLevelFunctionSource(appSource, "tokenWalletBalancesFor"),
  /tokenWalletBalanceHasAmount\(item, "confirmedBalance"\)[\s\S]*compareTokenWalletBalanceAmounts/u,
);
assert.match(
  appSource,
  /confirmedTokenCount = balances\.filter\(\s*tokenWalletBalanceHasConfirmed/u,
);
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
    checks: 94,
    model: WORK_ATOMIC_PROJECTION_MODEL,
    ok: true,
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_UNIT_SCALE_TEXT,
  }),
);
