import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

import {
  WORK_ATOMIC_PROJECTION_MODEL,
  WORK_DECIMALS,
  WORK_PRECISION_V2_MODEL,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_TOKEN_ID,
  WORK_UNIT_SCALE_TEXT,
  decimalValueToQ8,
  formatWorkAtoms,
  formatWorkSubatoms,
  isWorkTokenId,
  isCanonicalWorkAtoms,
  normalizeWorkAtoms,
  normalizeWorkSubatoms,
  parseSignedWorkAmountToAtoms,
  parseWorkAmountToAtoms,
  parseWorkAmountToSubatoms,
  q8ToCanonicalDecimal,
  q8ToNumber,
  withWorkPrecisionMetadata,
  withWorkSubatomPrecisionMetadata,
  workAmountAtomsFromRecord,
  workAmountFields,
  workAtomsValueAtFloorQ8,
} from "../server/work-units.mjs";
import {
  WORK_AMO_V8_AUTH_VERSION,
  WORK_AMO_V8_TRANSFER_VERSION,
} from "../server/work-amo-v8.mjs";

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

const backfillWorkProjectionItem = isolatedTypeScriptFunction(
  backfill,
  "workProjectionItem",
  {
    WORK_AMO_V8_AUTH_VERSION,
    WORK_AMO_V8_TRANSFER_VERSION,
    WORK_PRECISION_V2_MODEL,
    WORK_SUBATOM_PROJECTION_MODEL,
    formatWorkSubatoms,
    isWorkTokenId,
    normalizeWorkSubatoms,
    objectValue: (value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {},
    workAmountFields,
    withWorkSubatomPrecisionMetadata,
  },
);

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
const frontendExactIntegerText = (value) =>
  frontendExactIntegerBigInt(value)?.toString() ?? "";
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
const frontendWorkRecordAtoms = (amount, amountAtoms, amountSubatoms) =>
  workAmountModule.workAtomsFromRecord(amountAtoms, amount, amountSubatoms);
const frontendTokenRecordAmountAtoms = (
  token,
  amount,
  amountAtoms,
  amountSubatoms,
) =>
  frontendIsWorkToken(token)
    ? frontendWorkRecordAtoms(amount, amountAtoms, amountSubatoms)
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
const canonicalWorkSupplyAliases = isolatedTypeScriptFunction(
  appSource,
  "canonicalWorkSupplyAliases",
  {
    WORK_TOKEN_MAX_SUPPLY_SUBATOMS: "210000000000000000000000",
    workAtomsFromDecimal: workAmountModule.workAtomsFromDecimal,
    workDecimalFromAtoms: workAmountModule.workDecimalFromAtoms,
    workSubatomsFromCanonicalString:
      workAmountModule.workSubatomsFromCanonicalString,
  },
);
const roundedUnsignedRatioDecimalText = isolatedTypeScriptFunction(
  appSource,
  "roundedUnsignedRatioDecimalText",
);
const canonicalPositiveIntegerText = isolatedTypeScriptFunction(
  appSource,
  "canonicalPositiveIntegerText",
  { exactIntegerText: frontendExactIntegerText },
);
const workQ16UnitPriceDescriptor = isolatedTypeScriptFunction(
  appSource,
  "workQ16UnitPriceDescriptor",
  {
    WORK_AMO_UNIT_SCALE_BIGINT: 10_000_000_000_000_000n,
    WORK_Q16_SUMMARY_UNIT_PRICE_MODEL:
      "exact-work-q16-sats-per-unit-ratio-v1",
    WORK_TOKEN_DECIMALS: 16,
    WORK_TOKEN_MAX_SUPPLY_SUBATOMS: "210000000000000000000000",
    WORK_TOKEN_UNIT_SCALE: "10000000000000000",
    canonicalPositiveIntegerText,
    roundedUnsignedRatioDecimalText,
  },
);
const hasExactRecordKeys = (value, expectedKeys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};
const workQ16PriceDescriptorKeys = [
  "amountSubatoms",
  "decimal",
  "denominator",
  "model",
  "numerator",
  "priceSats",
  "unitScale",
];
const canonicalWorkQ16UnitPriceDescriptor = isolatedTypeScriptFunction(
  appSource,
  "canonicalWorkQ16UnitPriceDescriptor",
  {
    WORK_Q16_UNIT_PRICE_DESCRIPTOR_KEYS: workQ16PriceDescriptorKeys,
    hasExactRecordKeys,
    workQ16UnitPriceDescriptor,
  },
);
const compareWorkQ16UnitPriceDescriptors = isolatedTypeScriptFunction(
  appSource,
  "compareWorkQ16UnitPriceDescriptors",
  { canonicalWorkQ16UnitPriceDescriptor },
);
const workQ16UnitPriceDisplay = isolatedTypeScriptFunction(
  appSource,
  "workQ16UnitPriceDisplay",
  {
    WORK_TOKEN_DECIMALS: 16,
    canonicalWorkQ16UnitPriceDescriptor,
    formatExactDecimal: (value) => value,
  },
);
const tokenMintSupplyState = isolatedTypeScriptFunction(
  appSource,
  "tokenMintSupplyState",
  {
    isBondTokenDefinition: () => false,
    tokenDefinitionIsUncapped: () => false,
    tokenMaximumSupplyUnits: () => 210000000000000000000000n,
    tokenMintAmountUnits: () => 10000000000000000000n,
    tokenSupplyUnits: (_token, value) =>
      workAmountModule.workAtomsFromDecimal(value),
    tokenSupplyValueFromUnits: (_token, value) =>
      workAmountModule.workDecimalFromAtoms(value),
  },
);
const growthQ8Field = isolatedTypeScriptFunction(
  appSource,
  "growthQ8Field",
  { exactIntegerText: frontendExactIntegerText },
);
const normalizeGrowthActualValue = isolatedTypeScriptFunction(
  appSource,
  "normalizeGrowthActualValue",
  {
    growthExactDecimalField: () => undefined,
    growthNumberField: (payload, key) => Number(payload?.[key] ?? 0),
    growthQ8Field,
    normalizeCanonicalMinerFeeCoverage: () => undefined,
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

const exactFrontendSupply = canonicalWorkSupplyAliases(
  "30000000000000001",
  "3.0000000000000001",
);
assert.equal(exactFrontendSupply.amount, "3.0000000000000001");
assert.equal(exactFrontendSupply.amountSubatoms, "30000000000000001");
assert.throws(() =>
  canonicalWorkSupplyAliases(
    "30000000000000001",
    "3.0000000000000002",
  ),
);
assert.throws(() =>
  canonicalWorkSupplyAliases(undefined, "3.0000000000000001"),
);

const exactLastSaleUnitPrice = workQ16UnitPriceDescriptor(
  "25000",
  "10000000000000001",
);
const exactLowestAskUnitPrice = workQ16UnitPriceDescriptor(
  "25000",
  "20000000000000001",
);
assert.equal(
  exactLastSaleUnitPrice.decimal,
  "24999.9999999999975",
);
assert.equal(
  exactLowestAskUnitPrice.decimal,
  "12499.999999999999375",
);
assert.equal(
  compareWorkQ16UnitPriceDescriptors(
    exactLowestAskUnitPrice,
    exactLastSaleUnitPrice,
  ),
  -1,
);
assert.equal(
  workQ16UnitPriceDisplay(exactLastSaleUnitPrice),
  "24999.9999999999975",
);

const oneSubatomRemaining = tokenMintSupplyState(
  { tokenId: WORK_TOKEN_ID },
  "20999999.9999999999999999",
  "0",
);
assert.equal(
  oneSubatomRemaining.confirmedRemainingSupply,
  "0.0000000000000001",
);
assert.equal(oneSubatomRemaining.mintedOut, false);
assert.equal(oneSubatomRemaining.wouldOverfill, true);
assert.equal(
  tokenMintSupplyState(
    { tokenId: WORK_TOKEN_ID },
    "21000000",
    "0",
  ).mintedOut,
  true,
);

const unsafeCreditValueQ8 = "900719925474099312345678";
const normalizedExactCreditValue = normalizeGrowthActualValue({
  creditEventFrozenValueQ8: unsafeCreditValueQ8,
  creditEventLiveValueQ8: unsafeCreditValueQ8,
  creditFrozenNetworkValueQ8: unsafeCreditValueQ8,
  creditLiveNetworkValueQ8: unsafeCreditValueQ8,
  creditMovementFrozenValueQ8: "123456789",
  creditMovementLiveValueQ8: "987654321",
  creditNetworkValueQ8: unsafeCreditValueQ8,
});
assert.equal(
  normalizedExactCreditValue.creditEventFrozenValueQ8,
  unsafeCreditValueQ8,
);
assert.equal(
  normalizedExactCreditValue.creditEventLiveValueQ8,
  unsafeCreditValueQ8,
);
assert.equal(
  normalizedExactCreditValue.creditFrozenNetworkValueQ8,
  unsafeCreditValueQ8,
);
assert.equal(
  normalizedExactCreditValue.creditLiveNetworkValueQ8,
  unsafeCreditValueQ8,
);
assert.equal(
  normalizedExactCreditValue.creditMovementFrozenValueQ8,
  "123456789",
);
assert.equal(
  normalizedExactCreditValue.creditMovementLiveValueQ8,
  "987654321",
);
assert.equal(
  normalizedExactCreditValue.creditNetworkValueQ8,
  unsafeCreditValueQ8,
);

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
assert.equal(oneAtomBalances[0].confirmedBalanceSubatoms, "100000000");
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
  oneAtomBaselineWithConfirmedHistory[0].confirmedBalanceSubatoms,
  "100000000",
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
assert.equal(
  pendingAtomBalances[0].pendingIncomingSubatoms,
  "100000000",
);
assert.equal(
  tokenWalletBalanceHasAmount(pendingAtomBalances[0], "pendingIncoming"),
  true,
);

const fractionalWalletBalances = [
  {
    confirmedBalance: 0.00000001,
    confirmedBalanceSubatoms: "100000000",
    pendingIncoming: 0,
    pendingIncomingSubatoms: "0",
    pendingOutgoing: 0,
    pendingOutgoingSubatoms: "0",
    token: workToken,
  },
  {
    confirmedBalance: 0.00000002,
    confirmedBalanceSubatoms: "200000000",
    pendingIncoming: 0,
    pendingIncomingSubatoms: "0",
    pendingOutgoing: 0,
    pendingOutgoingSubatoms: "0",
    token: workToken,
  },
].sort((left, right) =>
  compareTokenWalletBalanceAmounts(right, left, "confirmedBalance"),
);
assert.equal(
  fractionalWalletBalances[0].confirmedBalanceSubatoms,
  "200000000",
);

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
    creditEventFrozenValueQ8: "900719925474099312345678",
    creditEventLiveValueQ8: "900719925474099312345679",
    creditFrozenNetworkValueQ8: "900719925474099312345678",
    creditLiveNetworkValueQ8: "900719925474099312345679",
    creditMovementFrozenValueQ8: "123456789",
    creditMovementLiveValueQ8: "987654321",
    creditNetworkValueQ8: "900719925474099312345679",
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
    creditNetworkValueQ8: "900719925474099312345680",
  }),
  false,
  "credit live-network Q8 aliases must agree above Number precision",
);
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
  10_000_000_000_000_000n,
);
assert.equal(
  workAmountModule.workAtomsFromRecord(undefined, "1"),
  10_000_000_000_000_000n,
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

const invalidZeroListingTxid =
  "55fdd6f89cfc3daa331b84efa635dcb5918f689517f725686252874f02c4d0c3";
const invalidZeroListing = backfillWorkProjectionItem(
  {
    amount: "0",
    kind: "token-listing",
    tokenId: WORK_TOKEN_ID,
    txid: invalidZeroListingTxid,
    valid: false,
  },
  { strict: false },
);
assert.equal(invalidZeroListing.amount, "0");
assert.equal(invalidZeroListing.amountAtoms, "0");
assert.equal(invalidZeroListing.decimals, 8);
assert.equal(invalidZeroListing.unitScale, "100000000");
assert.equal(invalidZeroListing.txid, invalidZeroListingTxid);
assert.equal(invalidZeroListing.valid, false);
assert.throws(() =>
  backfillWorkProjectionItem(
    {
      amount: "0",
      kind: "token-listing",
      tokenId: WORK_TOKEN_ID,
      txid: invalidZeroListingTxid,
      valid: true,
    },
    { strict: true },
  ),
);

const nativeInvalidZeroListing = {
  amount: "0",
  amountSats: 0,
  attemptedKind: "seal",
  kind: "token-listing-sealed-invalid",
  protocol: "pwt1",
  reason: "work-amo-v6-listing-already-sealed",
  reasonCode: "work-amo-v6-listing-already-sealed",
  saleAuthorization: { version: WORK_AMO_V8_AUTH_VERSION },
  tokenId: WORK_TOKEN_ID,
  txid: "6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c",
  valid: false,
};
const projectedNativeInvalidZero = backfillWorkProjectionItem(
  nativeInvalidZeroListing,
  { strict: false },
);
assert.equal(projectedNativeInvalidZero.amount, "0");
assert.equal(projectedNativeInvalidZero.amountSubatoms, "0");
assert.equal(
  projectedNativeInvalidZero.amountStorageModel,
  WORK_SUBATOM_PROJECTION_MODEL,
);
assert.equal(projectedNativeInvalidZero.decimals, 16);
assert.equal(projectedNativeInvalidZero.unitScale, "10000000000000000");
assert.equal(
  projectedNativeInvalidZero.precisionModel,
  WORK_PRECISION_V2_MODEL,
);
assert.equal("amountAtoms" in projectedNativeInvalidZero, false);
assert.deepEqual(
  projectedNativeInvalidZero.saleAuthorization,
  nativeInvalidZeroListing.saleAuthorization,
);
assert.throws(
  () =>
    backfillWorkProjectionItem(
      { ...nativeInvalidZeroListing, valid: true },
      { strict: true },
    ),
  /one unambiguous subatom amount/u,
);
const unprojectedNativeInvalidNonzero = backfillWorkProjectionItem(
  { ...nativeInvalidZeroListing, amount: "1" },
  { strict: false },
);
assert.equal("amountSubatoms" in unprojectedNativeInvalidNonzero, false);
assert.equal(
  "amountStorageModel" in unprojectedNativeInvalidNonzero,
  false,
);
const unprojectedNativeInvalidAmbiguousZero = backfillWorkProjectionItem(
  { ...nativeInvalidZeroListing, attemptedAmountSubatoms: "1" },
  { strict: false },
);
assert.equal(
  "amountSubatoms" in unprojectedNativeInvalidAmbiguousZero,
  false,
);
const unprojectedInvalidSend3Zero = backfillWorkProjectionItem(
  {
    amount: "0",
    amountSats: 0,
    kind: "token-transfer-invalid",
    protocol: "pwt1",
    tokenId: WORK_TOKEN_ID,
    transferVersion: WORK_AMO_V8_TRANSFER_VERSION,
    valid: false,
  },
  { strict: false },
);
assert.equal("amountSubatoms" in unprojectedInvalidSend3Zero, false);
const unprojectedUnrelatedV8Zero = backfillWorkProjectionItem(
  {
    ...nativeInvalidZeroListing,
    reason: "unrelated-invalid-reason",
    reasonCode: "unrelated-invalid-reason",
  },
  { strict: false },
);
assert.equal("amountSubatoms" in unprojectedUnrelatedV8Zero, false);

const invalidateWorkAtomicDerivedSnapshots =
  isolatedTypeScriptFunction(
    backfill,
    "invalidateWorkAtomicDerivedSnapshots",
    {
      CANONICAL_REBUILD_META_KEY: "canonical:rebuild",
      INCB_RANGE_REPLAY_WITNESS_MANIFEST_MODEL:
        "proof-indexer-incb-range-replay-witness-v1",
      NETWORK: "livenet",
      WORK_ATOMIC_PROJECTION_MODEL,
    },
  );
const invalidationQueries = [];
const invalidationClient = {
  async query(sql, params) {
    invalidationQueries.push({
      params: Array.from(params),
      sql: String(sql),
    });
    return { rows: [{ snapshot_id: "pre-repair-summary" }] };
  },
};
assert.deepEqual(
  Array.from(
    await invalidateWorkAtomicDerivedSnapshots(invalidationClient),
  ),
  ["pre-repair-summary"],
);
assert.deepEqual(
  Array.from(
    await invalidateWorkAtomicDerivedSnapshots(invalidationClient, {
      includeMarked: true,
    }),
  ),
  ["pre-repair-summary"],
);
assert.match(
  invalidationQueries[0].sql,
  /FALSE[\s\S]*workAmountStorageModel/u,
);
assert.match(
  invalidationQueries[1].sql,
  /TRUE[\s\S]*workAmountStorageModel/u,
);
assert.match(invalidationQueries[1].sql, /issuance_locked/u);
assert.match(invalidationQueries[1].sql, /NOT EXISTS/u);

const assertWorkAtomicEventMigrationForRepair =
  isolatedTypeScriptFunction(
    backfill,
    "assertWorkAtomicEventMigration",
    { objectValue: (value) => value ?? {} },
  );
const assertWorkAtomicIssuanceOracleSnapshotsForRepair =
  isolatedTypeScriptFunction(
    backfill,
    "assertWorkAtomicIssuanceOracleSnapshots",
  );
const repairIssuanceOracles = [
  {
    fingerprint: "unchanged-h-minus-one",
    resolved: true,
    snapshotId: "issuance-oracle",
  },
];

const repairInvalidWorkAtomicEventPrecisionRows =
  isolatedTypeScriptFunction(
    backfill,
    "repairInvalidWorkAtomicEventPrecisionRows",
    {
      NETWORK: "livenet",
      WORK_AMO_V8_AUTH_VERSION,
      WORK_AMO_V8_GLOBAL_PRECISION_MODEL:
        WORK_PRECISION_V2_MODEL,
      WORK_AMO_V8_TRANSFER_VERSION,
      WORK_ATOMIC_PROJECTION_MODEL,
      WORK_DECIMALS,
      WORK_SUBATOM_DECIMALS: 16,
      WORK_SUBATOM_PROJECTION_MODEL,
      WORK_SUBATOM_UNIT_SCALE_TEXT: "10000000000000000",
      WORK_TOKEN_ID,
      WORK_UNIT_SCALE_TEXT,
    },
  );
const nativeRepairFixtures = [
  {
    blockHeight: 962946,
    eventId: "3607561",
    txid: "6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c",
  },
  {
    blockHeight: 963019,
    eventId: "3621078",
    txid: "8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc",
  },
  {
    blockHeight: 963517,
    eventId: "3747805",
    txid: "9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0",
  },
];
let nativeRepairSql = "";
let nativeRepairParams = [];
const nativeQ16Repairs =
  await repairInvalidWorkAtomicEventPrecisionRows(
    {
      async query(sql, params) {
        nativeRepairSql = String(sql);
        nativeRepairParams = Array.from(params);
        return {
          rows: nativeRepairFixtures.map((fixture) => ({
            amount: "0",
            amount_atoms: null,
            amount_storage_model: WORK_SUBATOM_PROJECTION_MODEL,
            amount_subatoms: "0",
            authorization_version: WORK_AMO_V8_AUTH_VERSION,
            block_height: fixture.blockHeight,
            decimals: 16,
            event_id: fixture.eventId,
            event_key: `${fixture.txid}:1:0`,
            kind: "token-listing-sealed-invalid",
            precision_model: WORK_PRECISION_V2_MODEL,
            protocol: "pwt1",
            reason_code: "work-amo-v6-listing-already-sealed",
            status: "confirmed",
            txid: fixture.txid,
            unit_scale: "10000000000000000",
            valid: false,
          })),
        };
      },
    },
    {
      activationHeight: 960601,
      projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
    },
  );
assert.equal(nativeQ16Repairs.length, 3);
assert.deepEqual(
  nativeQ16Repairs.map((repair) => repair.eventId),
  nativeRepairFixtures.map((fixture) => fixture.eventId),
);
assert.ok(
  nativeQ16Repairs.every(
    (repair) =>
      repair.amount === "0" &&
      repair.amountAtoms === "" &&
      repair.amountSubatoms === "0" &&
      repair.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL &&
      repair.precisionModel === WORK_PRECISION_V2_MODEL,
  ),
);
assert.match(nativeRepairSql, /JOIN proof_indexer\.blocks canonical_block/u);
assert.match(nativeRepairSql, /canonical_block\.canonical = true/u);
assert.match(nativeRepairSql, /event\.valid = false/u);
assert.match(nativeRepairSql, /event\.status = 'confirmed'/u);
assert.match(nativeRepairSql, /event\.amount_sats = 0/u);
assert.match(nativeRepairSql, /event\.payload->>'amount' = '0'/u);
assert.match(nativeRepairSql, /event\.block_height >= \$7::integer/u);
assert.match(nativeRepairSql, /saleAuthorization,version/u);
assert.match(nativeRepairSql, /NOT \(event\.payload \? 'amountAtoms'\)/u);
assert.match(nativeRepairSql, /NOT \(event\.payload \? 'amountSubatoms'\)/u);
assert.match(nativeRepairSql, /'amountSubatoms', '0'/u);
assert.deepEqual(nativeRepairParams, [
  "livenet",
  WORK_TOKEN_ID,
  "10000000000000000",
  16,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_PRECISION_V2_MODEL,
  960601,
  WORK_AMO_V8_AUTH_VERSION,
  "work-amo-v6-listing-already-sealed",
]);

const q16BeforeRepairAudit = {
  activationHeight: 960601,
  atomic: false,
  events: {
    amount_events: 6,
    atom_events: 2,
    confirmed_mints: 1,
    confirmed_sales: 1,
    confirmed_transfers: 1,
    invalid_events: 3,
    missing_amount_unit_events: 3,
    precision_events: 3,
    repairable_q16_invalid_zero_events: 3,
    subatom_events: 1,
    unrepairable_missing_amount_unit_events: 0,
    valid_events: 3,
  },
  legacy: false,
  projectionModel: WORK_SUBATOM_PROJECTION_MODEL,
  snapshots: {
    unmarked_derived: 0,
    unmarked_derived_referenced: 0,
    unmarked_non_oracle_derived: 0,
  },
  subatomic: true,
};
const q16AfterRepairAudit = {
  ...q16BeforeRepairAudit,
  events: {
    ...q16BeforeRepairAudit.events,
    missing_amount_unit_events: 0,
    precision_events: 6,
    repairable_q16_invalid_zero_events: 0,
    subatom_events: 4,
  },
};
const q16AuditSequence = () => {
  let calls = 0;
  return async (_client, options = {}) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(options.allowRepairableEventPrecision, true);
      assert.equal(options.lock, true);
      return structuredClone(q16BeforeRepairAudit);
    }
    assert.equal(Object.keys(options).length, 0);
    return structuredClone(q16AfterRepairAudit);
  };
};
let q16InvalidationCalls = 0;
let q16OracleReads = 0;
const q16RepairWorkAtomicEventPrecisionMetadata =
  isolatedTypeScriptFunction(
    backfill,
    "repairWorkAtomicEventPrecisionMetadata",
    {
      NETWORK: "livenet",
      WORK_AMO_V8_AUTH_VERSION,
      WORK_AMO_V8_GLOBAL_PRECISION_MODEL:
        WORK_PRECISION_V2_MODEL,
      WORK_ATOMIC_PROJECTION_MODEL,
      WORK_DECIMALS,
      WORK_SUBATOM_DECIMALS: 16,
      WORK_SUBATOM_PROJECTION_MODEL,
      WORK_SUBATOM_UNIT_SCALE_TEXT: "10000000000000000",
      WORK_UNIT_SCALE_TEXT,
      assertWorkAtomicEventMigration:
        assertWorkAtomicEventMigrationForRepair,
      assertWorkAtomicIssuanceOracleSnapshots:
        assertWorkAtomicIssuanceOracleSnapshotsForRepair,
      assertWorkAtomicSnapshotMigrationState: () => {},
      auditWorkAtomicProjection: q16AuditSequence(),
      invalidateWorkAtomicDerivedSnapshots: async (_client, options) => {
        q16InvalidationCalls += 1;
        assert.equal(options.includeMarked, true);
        return ["q16-summary-1", "q16-summary-2"];
      },
      markedExactTipWorkAtomicSummary: async (_client, options) => {
        assert.equal(options.activationHeight, 960601);
        assert.equal(
          options.projectionModel,
          WORK_SUBATOM_PROJECTION_MODEL,
        );
        return null;
      },
      parseWorkAmountToAtoms,
      parseWorkAmountToSubatoms,
      repairInvalidWorkAtomicEventPrecisionRows: async (
        _client,
        options,
      ) => {
        assert.equal(options.activationHeight, 960601);
        assert.equal(
          options.projectionModel,
          WORK_SUBATOM_PROJECTION_MODEL,
        );
        return structuredClone(nativeQ16Repairs);
      },
      workAtomicIssuanceOracleSnapshotState: async () => {
        q16OracleReads += 1;
        return structuredClone(repairIssuanceOracles);
      },
    },
  );
const q16RepairQueries = [];
const q16RepairResult =
  await q16RepairWorkAtomicEventPrecisionMetadata({
    async query(sql, params = []) {
      q16RepairQueries.push({
        params: Array.from(params),
        sql: String(sql),
      });
      return { rows: [] };
    },
  });
assert.equal(q16RepairResult.repairedEvents, 3);
assert.equal(q16RepairResult.alreadyApplied, false);
assert.equal(q16RepairResult.cacheBootstrapRequired, true);
assert.equal(q16InvalidationCalls, 1);
assert.equal(q16OracleReads, 2);
assert.deepEqual(Array.from(q16RepairResult.invalidatedSnapshotIds), [
  "q16-summary-1",
  "q16-summary-2",
]);
assert.match(
  q16RepairQueries.find((query) => query.sql.includes("LOCK TABLE"))?.sql ?? "",
  /proof_indexer\.meta/u,
);
assert.equal(q16RepairQueries.at(-1).sql, "COMMIT");

const idempotentQ16Repair = isolatedTypeScriptFunction(
  backfill,
  "repairWorkAtomicEventPrecisionMetadata",
  {
    NETWORK: "livenet",
    WORK_AMO_V8_AUTH_VERSION,
    WORK_AMO_V8_GLOBAL_PRECISION_MODEL:
      WORK_PRECISION_V2_MODEL,
    WORK_ATOMIC_PROJECTION_MODEL,
    WORK_DECIMALS,
    WORK_SUBATOM_DECIMALS: 16,
    WORK_SUBATOM_PROJECTION_MODEL,
    WORK_SUBATOM_UNIT_SCALE_TEXT: "10000000000000000",
    WORK_UNIT_SCALE_TEXT,
    assertWorkAtomicEventMigration:
      assertWorkAtomicEventMigrationForRepair,
    assertWorkAtomicIssuanceOracleSnapshots:
      assertWorkAtomicIssuanceOracleSnapshotsForRepair,
    assertWorkAtomicSnapshotMigrationState: () => {},
    auditWorkAtomicProjection: async () =>
      structuredClone(q16AfterRepairAudit),
    invalidateWorkAtomicDerivedSnapshots: async () => {
      throw new Error("Idempotent Q16 repair must not invalidate snapshots.");
    },
    markedExactTipWorkAtomicSummary: async () => {
      throw new Error("Idempotent Q16 repair must not inspect summaries.");
    },
    parseWorkAmountToAtoms,
    parseWorkAmountToSubatoms,
    repairInvalidWorkAtomicEventPrecisionRows: async (
      _client,
      options,
    ) => {
      assert.equal(options.activationHeight, 960601);
      assert.equal(
        options.projectionModel,
        WORK_SUBATOM_PROJECTION_MODEL,
      );
      return [];
    },
    workAtomicIssuanceOracleSnapshotState: async () => {
      throw new Error("Idempotent Q16 repair must not inspect oracles.");
    },
  },
);
const idempotentQ16Queries = [];
const idempotentQ16Result = await idempotentQ16Repair({
  async query(sql, params = []) {
    idempotentQ16Queries.push({
      params: Array.from(params),
      sql: String(sql),
    });
    return { rows: [] };
  },
});
assert.equal(idempotentQ16Result.repairedEvents, 0);
assert.equal(idempotentQ16Result.alreadyApplied, true);
assert.equal(idempotentQ16Result.cacheBootstrapRequired, false);
assert.deepEqual(Array.from(idempotentQ16Result.invalidatedSnapshotIds), []);
assert.equal(idempotentQ16Queries.at(-1).sql, "COMMIT");

let invalidQ16SnapshotMutation = false;
const rejectingQ16Repair = isolatedTypeScriptFunction(
  backfill,
  "repairWorkAtomicEventPrecisionMetadata",
  {
    NETWORK: "livenet",
    WORK_AMO_V8_AUTH_VERSION,
    WORK_AMO_V8_GLOBAL_PRECISION_MODEL:
      WORK_PRECISION_V2_MODEL,
    WORK_ATOMIC_PROJECTION_MODEL,
    WORK_DECIMALS,
    WORK_SUBATOM_DECIMALS: 16,
    WORK_SUBATOM_PROJECTION_MODEL,
    WORK_SUBATOM_UNIT_SCALE_TEXT: "10000000000000000",
    WORK_UNIT_SCALE_TEXT,
    assertWorkAtomicEventMigration:
      assertWorkAtomicEventMigrationForRepair,
    assertWorkAtomicIssuanceOracleSnapshots:
      assertWorkAtomicIssuanceOracleSnapshotsForRepair,
    assertWorkAtomicSnapshotMigrationState: () => {},
    auditWorkAtomicProjection: async () =>
      structuredClone(q16BeforeRepairAudit),
    invalidateWorkAtomicDerivedSnapshots: async () => {
      invalidQ16SnapshotMutation = true;
      return [];
    },
    markedExactTipWorkAtomicSummary: async () => null,
    parseWorkAmountToAtoms,
    parseWorkAmountToSubatoms,
    repairInvalidWorkAtomicEventPrecisionRows: async () => [
      { ...nativeQ16Repairs[0], valid: true },
      nativeQ16Repairs[1],
      nativeQ16Repairs[2],
    ],
    workAtomicIssuanceOracleSnapshotState: async () =>
      structuredClone(repairIssuanceOracles),
  },
);
const rejectingQ16Queries = [];
await assert.rejects(
  rejectingQ16Repair({
    async query(sql, params = []) {
      rejectingQ16Queries.push({
        params: Array.from(params),
        sql: String(sql),
      });
      return { rows: [] };
    },
  }),
  /produced an invalid row/u,
);
assert.equal(invalidQ16SnapshotMutation, false);
assert.equal(rejectingQ16Queries.at(-1).sql, "ROLLBACK");

const repairWorkAtomicEventPrecisionMetadata =
  isolatedTypeScriptFunction(
    backfill,
    "repairWorkAtomicEventPrecisionMetadata",
    {
      NETWORK: "livenet",
      WORK_ATOMIC_PROJECTION_MODEL,
      WORK_DECIMALS,
      WORK_UNIT_SCALE_TEXT,
      assertWorkAtomicEventMigration:
        assertWorkAtomicEventMigrationForRepair,
      assertWorkAtomicIssuanceOracleSnapshots:
        assertWorkAtomicIssuanceOracleSnapshotsForRepair,
      assertWorkAtomicSnapshotMigrationState: () => {},
      auditWorkAtomicProjection: (() => {
        let calls = 0;
        return async (_client, options = {}) => {
          calls += 1;
          if (calls === 1) {
            assert.equal(options.allowRepairableEventPrecision, true);
            assert.equal(options.lock, true);
            return {
              activationHeight: 0,
              atomic: true,
              events: {
                amount_events: 1,
                invalid_events: 1,
                precision_events: 0,
                valid_events: 0,
              },
              legacy: false,
              projectionModel: WORK_ATOMIC_PROJECTION_MODEL,
              subatomic: false,
            };
          }
          return {
            activationHeight: 0,
            atomic: true,
            events: {
              amount_events: 1,
              invalid_events: 1,
              precision_events: 1,
              valid_events: 0,
            },
            legacy: false,
            projectionModel: WORK_ATOMIC_PROJECTION_MODEL,
            subatomic: false,
          };
        };
      })(),
      invalidateWorkAtomicDerivedSnapshots: async (_client, options) => {
        assert.equal(options.includeMarked, true);
        return ["pre-repair-summary"];
      },
      markedExactTipWorkAtomicSummary: async (_client, options) => {
        assert.equal(options.activationHeight, 0);
        assert.equal(
          options.projectionModel,
          WORK_ATOMIC_PROJECTION_MODEL,
        );
        return null;
      },
      parseWorkAmountToAtoms,
      repairInvalidWorkAtomicEventPrecisionRows: async (
        _client,
        options,
      ) => {
        assert.equal(options.activationHeight, 0);
        assert.equal(
          options.projectionModel,
          WORK_ATOMIC_PROJECTION_MODEL,
        );
        return [{
          amount: "0",
          amountAtoms: "0",
          decimals: 8,
          eventId: "1",
          eventKey: `${invalidZeroListingTxid}:token-listing:0`,
          kind: "token-listing",
          projectionModel: WORK_ATOMIC_PROJECTION_MODEL,
          status: "confirmed",
          txid: invalidZeroListingTxid,
          unitScale: "100000000",
          valid: false,
        }];
      },
      workAtomicIssuanceOracleSnapshotState: async () =>
        structuredClone(repairIssuanceOracles),
    },
  );
const repairQueries = [];
const repairResult = await repairWorkAtomicEventPrecisionMetadata({
  async query(sql, params = []) {
    repairQueries.push({
      params: Array.from(params),
      sql: String(sql),
    });
    return { rows: [] };
  },
});
assert.equal(repairResult.repairedEvents, 1);
assert.equal(repairResult.alreadyApplied, false);
assert.equal(repairResult.cacheBootstrapRequired, true);
assert.deepEqual(
  Array.from(repairResult.invalidatedSnapshotIds),
  ["pre-repair-summary"],
);
assert.equal(repairResult.cacheInvalidationRequired.length, 3);
assert.equal(repairQueries.at(-1).sql, "COMMIT");

const idempotentWorkAtomicEventPrecisionRepair =
  isolatedTypeScriptFunction(
    backfill,
    "repairWorkAtomicEventPrecisionMetadata",
    {
      NETWORK: "livenet",
      WORK_ATOMIC_PROJECTION_MODEL,
      WORK_DECIMALS,
      WORK_UNIT_SCALE_TEXT,
      assertWorkAtomicEventMigration:
        assertWorkAtomicEventMigrationForRepair,
      assertWorkAtomicIssuanceOracleSnapshots:
        assertWorkAtomicIssuanceOracleSnapshotsForRepair,
      assertWorkAtomicSnapshotMigrationState: () => {},
      auditWorkAtomicProjection: async () => ({
        activationHeight: 0,
        atomic: true,
        events: {
          amount_events: 1,
          invalid_events: 1,
          precision_events: 1,
          valid_events: 0,
        },
        legacy: false,
        projectionModel: WORK_ATOMIC_PROJECTION_MODEL,
        subatomic: false,
      }),
      invalidateWorkAtomicDerivedSnapshots: async () => {
        throw new Error("Idempotent repair must not invalidate snapshots.");
      },
      markedExactTipWorkAtomicSummary: async () => {
        throw new Error("Idempotent repair must not inspect stale summaries.");
      },
      parseWorkAmountToAtoms,
      repairInvalidWorkAtomicEventPrecisionRows: async () => [],
      workAtomicIssuanceOracleSnapshotState: async () => {
        throw new Error("Idempotent repair must not inspect oracles.");
      },
    },
  );
const idempotentRepairQueries = [];
const idempotentRepairResult =
  await idempotentWorkAtomicEventPrecisionRepair({
    async query(sql, params = []) {
      idempotentRepairQueries.push({
        params: Array.from(params),
        sql: String(sql),
      });
      return { rows: [] };
    },
  });
assert.equal(idempotentRepairResult.repairedEvents, 0);
assert.equal(idempotentRepairResult.alreadyApplied, true);
assert.equal(idempotentRepairResult.cacheBootstrapRequired, false);
assert.deepEqual(
  Array.from(idempotentRepairResult.invalidatedSnapshotIds),
  [],
);
assert.deepEqual(
  Array.from(idempotentRepairResult.cacheInvalidationRequired),
  [],
);
assert.equal(idempotentRepairQueries.at(-1).sql, "COMMIT");

assert.match(
  backfill,
  /action === "send" \|\|[\s\S]*action === "send2" \|\|[\s\S]*action === WORK_AMO_V8_TRANSFER_VERSION/u,
);
assert.match(backfill, /--audit-work-atoms/u);
assert.match(backfill, /--migrate-work-atoms/u);
assert.match(backfill, /--repair-work-atomic-events/u);
assert.match(backfill, /--verify-work-atoms-post-bootstrap/u);
assert.match(backfill, /POW_INDEX_WORK_ATOMIC_MIGRATION_APPLY/u);
assert.match(backfill, /POW_INDEX_WORK_ATOMIC_EVENT_REPAIR_APPLY/u);
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
assert.match(backfill, /repairInvalidWorkAtomicEventPrecisionRows/u);
assert.match(backfill, /allowRepairableEventPrecision/u);
assert.match(backfill, /"invalid_events"[\s\S]*"valid_events"/u);
assert.match(
  topLevelFunctionSource(
    backfill,
    "repairWorkAtomicEventPrecisionMetadata",
  ),
  /includeMarked: true[\s\S]*markedExactTipWorkAtomicSummary/u,
);
assert.match(backfill, /precision_events/u);
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
  /function workAmountMatches[\s\S]*const q8Historical =[\s\S]*typeof amountAtoms === "string"[\s\S]*!hasAmountSubatoms/u,
);
assert.match(
  ledgerAudit,
  /const q16Current =[\s\S]*typeof amountSubatoms === "string"[\s\S]*amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL[\s\S]*WORK_SUBATOM_DECIMALS[\s\S]*WORK_SUBATOM_UNIT_SCALE_TEXT/u,
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
    checks: 131,
    model: WORK_ATOMIC_PROJECTION_MODEL,
    ok: true,
    tokenId: WORK_TOKEN_ID,
    unitScale: WORK_UNIT_SCALE_TEXT,
  }),
);
