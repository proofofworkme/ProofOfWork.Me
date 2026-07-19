import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function importTypeScriptModule(relativePath) {
  const url = new URL(relativePath, pathToFileURL(`${process.cwd()}/`));
  const source = await readFile(url, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: url.pathname,
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

const { activityHistoryCacheKey } = await importTypeScriptModule(
  "src/shared/activity/logHistoryCache.ts",
);
const {
  clearProofApiReadWarning,
  currentProofApiReadWarning,
  ProofApiRequestError,
  proofApiLastGoodReadStatus,
  setProofApiReadWarning,
} = await importTypeScriptModule("src/shared/api/proofApiReadState.ts");
const {
  compareExactIntegers,
  exactIntegerBigInt,
  formatExactDecimal,
  formatExactInteger,
  formatExactQ8,
} = await importTypeScriptModule("src/exactAmount.ts");

const catchingUp = new ProofApiRequestError("catching up", {
  code: "CANONICAL_INDEX_CATCHING_UP",
  details: {
    indexedThroughBlock: 958_431,
    lagBlocks: 59,
    summarySnapshot: {
      indexedThroughBlock: 958_420,
      snapshotId: "ff4bf2984490c79d326866e3",
    },
    tipHeight: 958_490,
  },
  status: 503,
});
const catchingUpText = proofApiLastGoodReadStatus(catchingUp, {
  label: "WORK",
});
assert.match(catchingUpText, /is catching up/iu);
assert.match(catchingUpText, /59 blocks behind the full-node tip at 958,490/iu);
assert.match(catchingUpText, /summary block 958,420/iu);
assert.match(catchingUpText, /scan checkpoint is block 958,431/iu);
assert.match(catchingUpText, /snapshot ff4bf2984490c79d326866e3/iu);
assert.match(catchingUpText, /This view is not current/iu);

const summaryPublicationUnavailable = new ProofApiRequestError("catching up", {
  code: "CANONICAL_INDEX_CATCHING_UP",
  details: {
    indexedThroughBlock: 958_490,
    lagBlocks: 0,
    summarySnapshot: {
      indexedThroughBlock: 958_420,
      snapshotId: "last-good-summary",
    },
    tipHeight: 958_490,
  },
  status: 503,
});
const summaryPublicationText = proofApiLastGoodReadStatus(
  summaryPublicationUnavailable,
  { label: "WORK" },
);
assert.match(
  summaryPublicationText,
  /exact-tip summary publication is temporarily unavailable/iu,
);
assert.doesNotMatch(summaryPublicationText, /is catching up/iu);
assert.match(summaryPublicationText, /summary block 958,420/iu);
assert.match(
  summaryPublicationText,
  /scan checkpoint is block 958,490 at the full-node tip 958,490/iu,
);

const generic503 = new ProofApiRequestError("temporarily unavailable", {
  status: 503,
});
const generic503Text = proofApiLastGoodReadStatus(generic503);
assert.match(generic503Text, /is temporarily unavailable/iu);
assert.doesNotMatch(generic503Text, /is catching up/iu);

const unavailableWithLag = new ProofApiRequestError("unavailable", {
  code: "CANONICAL_INDEX_UNAVAILABLE",
  details: { lagBlocks: 10 },
  status: 503,
});
assert.match(
  proofApiLastGoodReadStatus(unavailableWithLag),
  /is temporarily unavailable/iu,
);
assert.doesNotMatch(
  proofApiLastGoodReadStatus(unavailableWithLag),
  /is catching up/iu,
);

const warnings = new Map();
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 2,
    source: "token",
    text: "token warning",
  }),
  true,
);
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 1,
    source: "token",
    text: "stale token warning",
  }),
  false,
);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "token warning");
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 3,
    source: "work-floor",
    text: "floor warning",
  }),
  true,
);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "floor warning");
assert.equal(clearProofApiReadWarning(warnings, "work", "token", 4), true);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "floor warning");
assert.equal(
  setProofApiReadWarning(warnings, "work", {
    attempt: 5,
    source: "token",
    text: "new token warning",
  }),
  true,
);
assert.equal(clearProofApiReadWarning(warnings, "work", "token", 4), false);
assert.equal(
  currentProofApiReadWarning(warnings, "work")?.text,
  "new token warning",
);
assert.equal(clearProofApiReadWarning(warnings, "work", "token", 5), true);
assert.equal(currentProofApiReadWarning(warnings, "work")?.text, "floor warning");

const baseHistoryIdentity = {
  kind: "history",
  pageIndex: 0,
  pageSize: 50,
  query: "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
  snapshotId: "snapshot-a",
};
const baseHistoryKey = activityHistoryCacheKey(baseHistoryIdentity);
assert.equal(
  baseHistoryKey,
  activityHistoryCacheKey({
    ...baseHistoryIdentity,
    query: baseHistoryIdentity.query.toLowerCase(),
  }),
);
for (const changedIdentity of [
  { ...baseHistoryIdentity, kind: "search" },
  { ...baseHistoryIdentity, pageIndex: 1 },
  { ...baseHistoryIdentity, cursor: "cursor-a" },
  { ...baseHistoryIdentity, snapshotId: "snapshot-b" },
  { ...baseHistoryIdentity, query: "different-query" },
]) {
  assert.notEqual(baseHistoryKey, activityHistoryCacheKey(changedIdentity));
}
assert.notEqual(
  activityHistoryCacheKey({ ...baseHistoryIdentity, query: "1Base58Address" }),
  activityHistoryCacheKey({ ...baseHistoryIdentity, query: "1base58address" }),
);
assert.equal(
  activityHistoryCacheKey({
    ...baseHistoryIdentity,
    query: "CarbonZ@ProofOfWork.Me",
  }),
  activityHistoryCacheKey({
    ...baseHistoryIdentity,
    query: "carbonz@proofofwork.me",
  }),
);

const aboveSafeInteger = "12692190658411191";
const adjacentAboveSafeInteger = "12692190658411192";
assert.equal(exactIntegerBigInt(aboveSafeInteger), 12_692_190_658_411_191n);
assert.equal(formatExactInteger(aboveSafeInteger), "12,692,190,658,411,191");
assert.equal(
  compareExactIntegers(adjacentAboveSafeInteger, aboveSafeInteger),
  1,
);
assert.equal(Number(adjacentAboveSafeInteger), Number(aboveSafeInteger));
assert.equal(
  formatExactDecimal("188495944821384.822", {
    maximumFractionDigits: 8,
  }),
  "188,495,944,821,384.822",
);
assert.equal(
  formatExactQ8("18849594482138482200000"),
  "188,495,944,821,384.822",
);
assert.equal(
  formatExactDecimal(1e25),
  "10,000,000,000,000,000,000,000,000",
);

console.log(
  JSON.stringify({
    checks: 40,
    logCacheDimensions: ["query", "kind", "page", "cursor", "snapshot"],
    ok: true,
  }),
);
