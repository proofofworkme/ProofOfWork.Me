#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CANONICAL_UNICODE_CASE_MAPPING_VERSION,
  assertCanonicalUnicodeCaseMappingVersion,
  canonicalUnicodeCaseMappingCompatible,
  compareCanonicalUtf8,
} from "../server/canonical-order.mjs";
import {
  compareWorkAmoUtf8,
  parseWorkAmoV5RawPwidRecord,
} from "../server/work-amo-v5.mjs";

const corpus = [
  "",
  "0",
  "9",
  "A",
  "Z",
  "a",
  "z",
  "é",
  "€",
  "𐀀",
];
const expected = [
  "",
  "0",
  "9",
  "A",
  "Z",
  "a",
  "z",
  "é",
  "€",
  "𐀀",
];

assert.equal(CANONICAL_UNICODE_CASE_MAPPING_VERSION, "17.0");
assert.equal(canonicalUnicodeCaseMappingCompatible("17.0"), true);
assert.equal(canonicalUnicodeCaseMappingCompatible("16.0"), false);
assert.doesNotThrow(() => assertCanonicalUnicodeCaseMappingVersion());

assert.deepEqual([...corpus].sort(compareCanonicalUtf8), expected);
assert.deepEqual([...corpus].sort(compareWorkAmoUtf8), expected);
assert.equal(compareWorkAmoUtf8, compareCanonicalUtf8);

const englishOrder = Math.sign(
  new Intl.Collator("en").compare("ä", "z"),
);
const swedishOrder = Math.sign(
  new Intl.Collator("sv").compare("ä", "z"),
);
assert.notEqual(
  englishOrder,
  swedishOrder,
  "The fixture must exercise a real locale-dependent ordering difference.",
);
for (const locale of ["en", "sv", "tr", "de"]) {
  // Constructing a host collator must not influence canonical protocol order.
  new Intl.Collator(locale).compare("ä", "z");
  assert.deepEqual([...corpus].sort(compareCanonicalUtf8), expected);
}

const powIdOwner = "1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv";
const malformedUtf8Id = Buffer.from([0xc3, 0x28]).toString("base64url");
assert.equal(
  parseWorkAmoV5RawPwidRecord(
    `pwid1:r2:${malformedUtf8Id}:${powIdOwner}:${powIdOwner}`,
  ),
  null,
);
const replacementCharacterId =
  Buffer.from("\ufffd", "utf8").toString("base64url");
assert.equal(
  parseWorkAmoV5RawPwidRecord(
    `pwid1:r2:${replacementCharacterId}:${powIdOwner}:${powIdOwner}`,
  )?.id,
  "\ufffd",
);

const consensusFiles = [
  "server/incb-range-replay-witness.mjs",
  "server/proof-api.mjs",
  "server/db/proof-index-reader.mjs",
  "scripts/backfill-proof-indexer.mjs",
];
const requiredConsensusFunctions = new Map([
  [
    "server/incb-range-replay-witness.mjs",
    ["entryOrder"],
  ],
  [
    "server/proof-api.mjs",
    [
      "compareCreditValueReplayEvents",
      "compareRegistryEventOrder",
      "pendingWorkMintWitnessProof",
      "tokenProtocolSortedTransactions",
      "tokenReplayEntriesForRegistry",
      "workAmoV5HistoricalMovements",
    ],
  ],
  [
    "server/db/proof-index-reader.mjs",
    ["idLifecycleStateFromItems"],
  ],
  [
    "scripts/backfill-proof-indexer.mjs",
    [
      "canonicalIncbRangeReplayCompletionWitnesses",
      "canonicalPwtRangeReplayVerificationIsValid",
      "rebuildConfirmedCreditBalancesFromCanonicalEvents",
    ],
  ],
]);

for (const file of consensusFiles) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /\.localeCompare\s*\(/u,
    `${file} must not use locale-sensitive ordering.`,
  );
  for (const functionName of requiredConsensusFunctions.get(file) ?? []) {
    assert.match(
      source,
      new RegExp(`function\\s+${functionName}\\s*\\(`, "u"),
      `${file} must retain the audited ${functionName} path.`,
    );
  }
}

console.log("Canonical UTF-8 ordering checks passed.");
