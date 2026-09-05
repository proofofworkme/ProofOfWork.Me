import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const targets = [
  [3607561, "6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c"],
  [3621078, "8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc"],
  [3747805, "9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0"],
];
const coreInputs = [
  ["fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5", 3, "863"],
  ["fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5", 2, "546"],
  ["db836174bde97f027c85553e26af3b896b9d3f04745f32f6f99af631865c7bcc", 2, "546"],
  ["488f31b5ac317123a2383e49eaf06fb6351f117e217bdeb9440795de431175a5", 2, "546"],
  ["3c69d397b2ec43c8eb8a83409b7f2dc979f5b887a307f8a12e053b3ebc545a00", 2, "546"],
  ["a8906b1f9bab7a791a5271a3e9276b8a91e0fb502a49235d4be0c1b8e8a27b79", 2, "546"],
].map(([prevTxid, prevVout, valueSats], vin) => ({ vin, prevTxid, prevVout, valueSats }));
const paymentScript = "76a9144752142b83faf13d526a59212f3f228012890dbe88ac";
const historicalAuthorities = {
  "model": "audit5-historical-authorities-v1",
  "seed": {
    "snapshotId": "amo-v5-h1-af98265df1e8e61a7b173807",
    "rowSha256": "18c3380fa370f28e136308b9cca43b80f5a43d5bd617c4b7c9cb77d127419128"
  },
  "migration": {
    "key": "workAmoV5Migration:livenet",
    "rowSha256": "bf8a4098f4a65f43a3fbe189b6ee820afc35cb27e5f63b6cb32fcad2bbe87512"
  },
  "transitions": [
    {
      "blockHeight": 959621,
      "blockHash": "00000000000000000000447e3a8c01b4b0f08aef5c817ddfd10cf51b1d691d69",
      "rowSha256": "c72120ff99307f42ce63426ddd6082ff8a3eb7d7f20fb03f9e5407db9716e37c",
      "blockCanonical": true,
      "canonicalPreviousHash": "0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811"
    },
    {
      "blockHeight": 959804,
      "blockHash": "00000000000000000001d0b122e73a235c361a73c48912e30651402cf455fe48",
      "rowSha256": "dd6551971d3d0ce36c873561f34c807ab9ee1625f2e7c0c7d00b6032c4982b13",
      "blockCanonical": true,
      "canonicalPreviousHash": "00000000000000000001203f1a5c32be74c7b34228896504ad4412483b263c3d"
    }
  ],
  "blocks": [
    {
      "hash": "0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811",
      "height": 959620,
      "canonical": true,
      "previousHash": "0000000000000000000156a564e527e1e72dcfba1939ca8f0a7c598ebb8e9e5a"
    },
    {
      "hash": "00000000000000000000447e3a8c01b4b0f08aef5c817ddfd10cf51b1d691d69",
      "height": 959621,
      "canonical": true,
      "previousHash": "0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811"
    },
    {
      "hash": "00000000000000000001d0b122e73a235c361a73c48912e30651402cf455fe48",
      "height": 959804,
      "canonical": true,
      "previousHash": "00000000000000000001203f1a5c32be74c7b34228896504ad4412483b263c3d"
    }
  ]
};
const before = {
  format: "proofofwork-audit5-repair-evidence-v1", database: "proof_indexer", otherDatabaseSessions: 0,
  aux: { txid: "4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359",
    status: "confirmed", height: 962992, blockIndex: 1161,
    blockHash: "00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b",
    rawVin: 6, rawVout: 2, inputs: coreInputs.slice(1).map(input => ({ ...input, valueSats: null })),
    outputs: [], anchorLinks: coreInputs.slice(1).map(input => ({ txid: input.prevTxid, vout: input.prevVout,
      spentByTxid: "4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359",
      spentByVin: input.vin, valueSats: input.valueSats, scriptPubKey: paymentScript }))
      .sort((a, b) => a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout), opReturnCount: 0 },
  targetEvents: targets.map(([event_id, txid]) => ({ event_id, txid, protocol: "pwt1",
    kind: "token-listing-sealed-invalid", status: "confirmed", valid: false, amount_sats: 0,
    updated_at: "before", payload: { amount: "0", amountSats: 0, attemptedKind: "seal",
      reason: "work-amo-v6-listing-already-sealed", reasonCode: "work-amo-v6-listing-already-sealed",
      saleAuthorization: { version: "pwt-sale-v8" } } })),
  missingZeroMetadataTxids: targets.map(([, txid]) => txid).sort(),
  historicalAuthorities,
  protectedSnapshots: [
  {
    "snapshot_id": "0d013316972dea627a571cfa",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "f38f9f53fa78e98479ce4e09f3d08e87d1fb2835f91423ed658b72909ec44642"
  },
  {
    "snapshot_id": "266a4929fa33e9ea7199501a",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "dd741afac19471491ae7dba8f8f6f836ca643691dd4ce5dcb07003e54a54ba6c"
  },
  {
    "snapshot_id": "28bcfb94e3572f9099112e6c",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "024133f60d2d921a1db70dbed351b22fa8716a1bd1c844dd0f7836df6e91c935"
  },
  {
    "snapshot_id": "2aab25ca991f1d53895b5cb2",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "f68d3499b8b78972b6c1100c17908b2753659a6bd0170266cde06ff4f4677e7a"
  },
  {
    "snapshot_id": "34f3d816786f7e8f2f81b505",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "765f7ba412a739b2dedfe52a726fd06da924a6e601b9aa68aec9e3aa827d6f35"
  },
  {
    "snapshot_id": "35bf2b05cd91025920df228c",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "39d0cfc647e4c8d3e8bf3a433ab29d120cbd329806f7d3b28b04483ce5730e3b"
  },
  {
    "snapshot_id": "40cd14abee715e4b9074a474",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "95a7cb575e7ff6ffd094a76301f6cd57aac35cab1eeff5834dbac8bd510eb1fa"
  },
  {
    "snapshot_id": "6c0d5c24f35b37139bead9ff",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "17b34fc3f0b1e280ffcaa3cc0171e6bf4fe4542438a11d4274f81cf3594d12ac"
  },
  {
    "snapshot_id": "755d057b4161358725012b6f",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "bf24dbdc7236e039c310e0725c223634e7b9dc179b00bc82e55ce8188dc34978"
  },
  {
    "snapshot_id": "7ab9dad4300df08edf54e80f",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "5371ba7763a3ff58d9cf4c718776a7a7e263fe7b05c5c2e1410ac09f28892e0d"
  },
  {
    "snapshot_id": "7b937a7a603b1332d22b06e1",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "3f24a1f57867f73beeb869b88e55057e0afad82d5d458d17e69053d76cf57bf9"
  },
  {
    "snapshot_id": "8037251c8887a49009047864",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "7751ed516d594ca7839d93976063ec51f9a742f3376cddbcf79e73c50811a63f"
  },
  {
    "snapshot_id": "80e84ace387f63fa1c34aa22",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "88a930fae542c731835c034f0669eb94e4c5b71a59fb74079c14ce9ae8b6680c"
  },
  {
    "snapshot_id": "88598ea2c4cd03c3641c9493",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "d1c3f8a639aff290242589e25da31794ded9175d4fdd7a272af8015ffbc5d6bf"
  },
  {
    "snapshot_id": "895dbf988e2f77fc89c1757c",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "cf7c34c86fe6dbebebe935e18e174804940724c59772ffb61b523cef97601008"
  },
  {
    "snapshot_id": "8ff476fff4f2fb14373a34e3",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "5ae7d54936688bd507ec383fef939699bc951b8f89438a53bbd0e14e034a91b3"
  },
  {
    "snapshot_id": "9187c976328d4ad6c1cc1b30",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "9daacc5d5382c75af1c20545d6465b10267c8a1b5d12aed632253d116bdb4359"
  },
  {
    "snapshot_id": "94f8316c91af164ebf92c179",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "106442341380ad8334d4a1ea76c374d72c347126fc935022299258893f1c7cb7"
  },
  {
    "snapshot_id": "9a7831112b60da8ba8a6d5d1",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "ee327257f57d93e6ff2e161f2140216154d205a1d4f4337f96d1c7dcbc2bfae3"
  },
  {
    "snapshot_id": "a5a3faedaa796de67db5dee2",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "b3fbd01c99a4fd1984003aa1af5b49ee5709015c69d73d440d00880cdd1b867d"
  },
  {
    "snapshot_id": "ae8f28b922cecee2580a97e5",
    "origins": [
      "migration-closing-provenance"
    ],
    "resolved": false,
    "row_sha256": null
  },
  {
    "snapshot_id": "amo-v5-h1-af98265df1e8e61a7b173807",
    "origins": [
      "seed-evidence"
    ],
    "resolved": true,
    "row_sha256": "18c3380fa370f28e136308b9cca43b80f5a43d5bd617c4b7c9cb77d127419128"
  },
  {
    "snapshot_id": "b5d36ee98bcbef4fc7a54aed",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "ce873bd52cf0f66f9aff9f58e2d212e698090c0820665906c206f1a03fa57789"
  },
  {
    "snapshot_id": "b8e77cd30cbed6855977c514",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "999bbb0d2b99cd52708756101970ac69460edc0ec850ee0eb925ed9c50d691e8"
  },
  {
    "snapshot_id": "c0cc2df08b40a04e03fee8e1",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "93d32e16ac616e3a7baedf00acc0730e6ddd8f7065852a9bc1e23606b1c177c3"
  },
  {
    "snapshot_id": "c8b800384da576c962ae82a5",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "15b9837e972604593fb292fcc995338b3851242f3ac3d03dc18a963f1759350a"
  },
  {
    "snapshot_id": "cb13bc6edd20d72f6ae3919e",
    "origins": [
      "migration-seed-provenance",
      "seed-summary-provenance"
    ],
    "resolved": false,
    "row_sha256": null
  },
  {
    "snapshot_id": "dca7e548d87d04940c1635ee",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "1bd4b773303c0990fcfccdd4a7b923a053295802785332658740f3680fe138a8"
  },
  {
    "snapshot_id": "e59bf41d4ced5cb965cb0cb6",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "4a00ec697fbac71654f86cbd8c05d7362514876e8d5e07718d0dd293231a1a78"
  },
  {
    "snapshot_id": "ebfca7f3f79b479dbd2d0f43",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "b62542417fbe99cb3f110ef6c94535c82a9dbe5beb8510475ccbef1c754a2dcd"
  },
  {
    "snapshot_id": "efbf9a05058307f1fb35802a",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "87f47719214928cb05cf01713f524c483a28b924cf12b842c6ab450f0f9ce9fa"
  },
  {
    "snapshot_id": "f92c69962c409d55ba1b103c",
    "origins": [
      "issuance"
    ],
    "resolved": true,
    "row_sha256": "c8100c91e319bc5a5a584a33082460faf0213234d27c20182e05c81cc71c18fa"
  }
],
  invariants: ["creditBalances", "creditDefinitions", "creditListings", "eventsExceptApprovedMetadata", "transitionCommitments"]
    .map(name => ({ name, rows: 5, sha256: "b".repeat(64) })),
};
const after = structuredClone(before);
after.aux.inputs = structuredClone(coreInputs);
after.aux.outputs = [{ vout: 0, valueSats: "3118", scriptPubKey: paymentScript },
  { vout: 1, valueSats: "0", scriptPubKey: "6a5d081600ff7f8184ec02" }];
after.aux.anchorLinks.push({ txid: coreInputs[0].prevTxid, vout: 3,
  spentByTxid: before.aux.txid, spentByVin: 0, valueSats: "863", scriptPubKey: paymentScript });
after.aux.anchorLinks.sort((a, b) => a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout);
after.missingZeroMetadataTxids = [];
for (const event of after.targetEvents) {
  event.updated_at = "after";
  Object.assign(event.payload, { amountSubatoms: "0", decimals: 16, unitScale: "10000000000000000",
    amountStorageModel: "work-subatoms-v2", precisionModel: "canonical-work-subatoms-v2" });
}
const directory = mkdtempSync(join(tmpdir(), "pow-audit5-repair-fixtures-"));
let checks = 0;
function check(label, original, repaired, succeeds) {
  const first = join(directory, "before.json");
  const second = join(directory, "after.json");
  writeFileSync(first, JSON.stringify(original));
  writeFileSync(second, JSON.stringify(repaired));
  const result = spawnSync(process.execPath, ["scripts/check-audit5-data-repair.mjs", first, second],
    { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status === 0, succeeds, `${label}: ${result.stderr}`);
  checks += 1;
}
try {
  check("exact authorized repair", before, after, true);
  for (const value of ["0", false, null]) {
    const wrongBefore = structuredClone(before);
    const wrongAfter = structuredClone(after);
    wrongBefore.targetEvents[0].payload.amountSats = value;
    wrongAfter.targetEvents[0].payload.amountSats = value;
    check("reject changed numeric-zero JSON type", wrongBefore, wrongAfter, false);
  }
  for (const [label, mutate] of [
    ["live application connection", row => { row.otherDatabaseSessions = 1; }],
    ["changed anchor link", row => { row.aux.anchorLinks[0].valueSats = "601"; }],
    ["changed protected snapshot", row => { row.protectedSnapshots[0].row_sha256 = "c".repeat(64); }],
    ["changed seed authority", row => { row.historicalAuthorities.seed.rowSha256 = "c".repeat(64); }],
    ["changed completed marker", row => { row.historicalAuthorities.migration.rowSha256 = "c".repeat(64); }],
    ["changed activation transition", row => { row.historicalAuthorities.transitions[0].rowSha256 = "c".repeat(64); }],
    ["changed bootstrap transition", row => { row.historicalAuthorities.transitions[1].rowSha256 = "c".repeat(64); }],
    ["changed seed canonical block", row => { row.historicalAuthorities.blocks[0].hash = "c".repeat(64); }],
    ["changed provenance origin", row => { row.protectedSnapshots.find(r => !r.resolved).origins = ["issuance"]; }],
    ["missing ordinary issuance snapshot", row => { const r = row.protectedSnapshots.find(r => r.origins.includes("issuance")); r.resolved = false; r.row_sha256 = null; }],
    ["newly present historical summary", row => { const r = row.protectedSnapshots.find(r => !r.resolved); r.resolved = true; r.row_sha256 = "c".repeat(64); }],
    ["missing protected reference", row => { row.protectedSnapshots.pop(); }],
    ["duplicate protected reference", row => { row.protectedSnapshots[1] = structuredClone(row.protectedSnapshots[0]); }],
    ["unknown reference origin", row => { row.protectedSnapshots[0].origins = ["unknown"]; }],
    ["changed economics", row => { row.invariants[0].sha256 = "d".repeat(64); }],
    ["missing invariant category", row => { row.invariants[0].name = row.invariants[1].name; }],
    ["extra event mutation", row => { row.targetEvents[0].payload.address = "unexpected"; }],
    ["forged event identity", row => { row.targetEvents[0].event_id = 3621078; }],
    ["wrong precision scale", row => { row.targetEvents[0].payload.unitScale = "100000000"; }],
    ["extra repair candidate", row => { row.missingZeroMetadataTxids.push("f".repeat(64)); }],
    ["negative fee", row => { row.aux.inputs.forEach(input => { input.valueSats = "1"; }); }],
    ["old synthetic positive fee", row => { row.aux.inputs.forEach(input => { input.valueSats = "600"; }); }],
    ["wrong prevout with same total", row => { row.aux.inputs[0].prevVout = 2; }],
    ["wrong parent transaction", row => { row.aux.inputs[1].prevTxid = "f".repeat(64); }],
    ["reordered input relation", row => { row.aux.inputs[1].vin = 2; }],
    ["redistributed values same fee", row => { row.aux.inputs[0].valueSats = "862"; row.aux.inputs[1].valueSats = "547"; }],
    ["invented parsed OP_RETURN row", row => { row.aux.opReturnCount = 1; }],
    ["changed raw OP_RETURN script", row => { row.aux.outputs[1].scriptPubKey = "6a0116"; }],
    ["changed payment output script", row => { row.aux.outputs[0].scriptPubKey = "51"; }],
    ["missing approved funding link", row => { row.aux.anchorLinks = row.aux.anchorLinks.filter(link => link.spentByVin !== 0); }],
    ["wrong funding amount", row => { row.aux.anchorLinks.find(link => link.spentByVin === 0).valueSats = "864"; }],
    ["wrong funding input ordinal", row => { row.aux.anchorLinks.find(link => link.spentByVin === 0).spentByVin = 6; }],
    ["wrong funding parent", row => { row.aux.anchorLinks.find(link => link.spentByVin === 0).txid = "f".repeat(64); }],
    ["seventh spend link", row => { row.aux.anchorLinks.push({ ...row.aux.anchorLinks[0], vout: 4 }); }],
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    check(label, before, changed, false);
  }
  // Fail before any write even when a bad baseline and result agree.
  for (const [label, mutate] of [
    ["correlated missing issuance authority", row => { const r = row.protectedSnapshots.find(r => r.origins.includes("issuance")); r.resolved = false; r.row_sha256 = null; }],
    ["correlated marker replacement", row => { row.historicalAuthorities.migration.rowSha256 = "c".repeat(64); }],
    ["correlated provenance reclassification", row => { row.protectedSnapshots.find(r => !r.resolved).origins = ["witness"]; }],
    ["correlated transition replacement", row => { row.historicalAuthorities.transitions[1].rowSha256 = "c".repeat(64); }],
  ]) {
    const original = structuredClone(before), repaired = structuredClone(after);
    mutate(original); mutate(repaired); check(label, original, repaired, false);
  }
  console.log(JSON.stringify({ ok: true, checks }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
