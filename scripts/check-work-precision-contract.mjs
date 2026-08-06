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
const frontendNormalizeBroadcastStatus = (value) => {
  const status = String(value ?? "").trim().toLowerCase();
  return ["confirmed", "dropped", "failed", "pending", "replaced", "unknown"].includes(
    status,
  )
    ? status
    : "unknown";
};
const frontendTokenProjectionLifecycleStatus = isolatedTypeScriptFunction(
  appSource,
  "tokenProjectionLifecycleStatus",
  { normalizeBroadcastStatus: frontendNormalizeBroadcastStatus },
);
const frontendTokenProjectionCountsAsPending = isolatedTypeScriptFunction(
  appSource,
  "tokenProjectionCountsAsPending",
  { tokenProjectionLifecycleStatus: frontendTokenProjectionLifecycleStatus },
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
    tokenProjectionCountsAsPending: frontendTokenProjectionCountsAsPending,
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
const exactWorkNetworkValueQ8 = 900_719_925_474_099_312_345_679n;
assert.match(
  appSource,
  /function applyInfinitySummary\(snapshot:[\s\S]*acceptedBondSummariesRef\.current\.set\(snapshot\.tokenId, snapshot\)[\s\S]*setInfinitySummary\(snapshot\)/u,
  "authenticated full bond snapshots must replace the prior snapshot even when canonical values shrink",
);
assert.match(
  appSource,
  /function applyWorkFloorQuote\(quote:[\s\S]*boundaryWasLatched && !incomingBoundaryObserved[\s\S]*acceptedWorkFloorQuoteRef\.current = safetyBoundQuote/u,
  "WORK reads must accept current quote values while keeping the independent V8 write boundary fail closed",
);
assert.doesNotMatch(
  appSource,
  /function (?:infinitySummaryRegresses|workFloorQuoteRegresses)\(/u,
  "canonical value decreases must not be rejected by monotonic UI guards",
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

const repairWorkAtomicEventPrecisionMetadata =
  isolatedTypeScriptFunction(
    backfill,
    "repairWorkAtomicEventPrecisionMetadata",
    {
      NETWORK: "livenet",
      WORK_DECIMALS,
      WORK_UNIT_SCALE_TEXT,
      assertWorkAtomicEventMigration: () => {},
      assertWorkAtomicSnapshotMigrationState: () => {},
      auditWorkAtomicProjection: (() => {
        let calls = 0;
        return async (_client, options = {}) => {
          calls += 1;
          if (calls === 1) {
            assert.equal(options.allowRepairableEventPrecision, true);
            assert.equal(options.lock, true);
            return {
              atomic: true,
              events: {
                amount_events: 1,
                precision_events: 0,
              },
              legacy: false,
            };
          }
          return {
            atomic: true,
            events: {
              amount_events: 1,
              precision_events: 1,
            },
            legacy: false,
          };
        };
      })(),
      invalidateWorkAtomicDerivedSnapshots: async (_client, options) => {
        assert.equal(options.includeMarked, true);
        return ["pre-repair-summary"];
      },
      markedExactTipWorkAtomicSummary: async () => null,
      parseWorkAmountToAtoms,
      repairInvalidWorkAtomicEventPrecisionRows: async () => [
        {
          amount: "0",
          amountAtoms: "0",
          decimals: 8,
          eventId: "1",
          eventKey: `${invalidZeroListingTxid}:token-listing:0`,
          kind: "token-listing",
          status: "confirmed",
          txid: invalidZeroListingTxid,
          unitScale: "100000000",
          valid: false,
        },
      ],
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
      WORK_DECIMALS,
      WORK_UNIT_SCALE_TEXT,
      assertWorkAtomicEventMigration: () => {},
      assertWorkAtomicSnapshotMigrationState: () => {},
      auditWorkAtomicProjection: async () => ({
        atomic: true,
        events: {
          amount_events: 1,
          precision_events: 1,
        },
        legacy: false,
      }),
      invalidateWorkAtomicDerivedSnapshots: async () => {
        throw new Error("Idempotent repair must not invalidate snapshots.");
      },
      markedExactTipWorkAtomicSummary: async () => {
        throw new Error("Idempotent repair must not inspect stale summaries.");
      },
      parseWorkAmountToAtoms,
      repairInvalidWorkAtomicEventPrecisionRows: async () => [],
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
