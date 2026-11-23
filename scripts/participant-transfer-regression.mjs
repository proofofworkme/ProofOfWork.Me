import assert from "node:assert/strict";
import {
  parseWorkAmountToAtoms,
  parseWorkAmountToSubatoms,
  WORK_SUBATOM_DECIMALS,
  WORK_SUBATOM_PROJECTION_MODEL,
  WORK_SUBATOM_UNIT_SCALE_TEXT,
} from "../server/work-units.mjs";

export function workAmountMatches(record, expectedAmount) {
  try {
    const expectedAtoms = parseWorkAmountToAtoms(expectedAmount, {
      allowZero: true,
    });
    const expectedSubatoms = parseWorkAmountToSubatoms(expectedAmount, {
      allowZero: true,
    });
    const amountAtoms = record?.amountAtoms;
    const amountSubatoms = record?.amountSubatoms;
    const hasAmountAtoms =
      amountAtoms !== undefined && amountAtoms !== null && amountAtoms !== "";
    const hasAmountSubatoms =
      amountSubatoms !== undefined &&
      amountSubatoms !== null &&
      amountSubatoms !== "";
    if (typeof record?.amount === "number") {
      return (
        !hasAmountAtoms &&
        !hasAmountSubatoms &&
        Number.isSafeInteger(record.amount) &&
        parseWorkAmountToAtoms(record.amount, { allowZero: true }) ===
          expectedAtoms
      );
    }
    const q8Historical =
      typeof record?.amount === "string" &&
      record.amount === expectedAmount &&
      typeof amountAtoms === "string" &&
      amountAtoms === expectedAtoms &&
      !hasAmountSubatoms;
    const q16Current =
      typeof record?.amount === "string" &&
      record.amount === expectedAmount &&
      !hasAmountAtoms &&
      typeof amountSubatoms === "string" &&
      amountSubatoms === expectedSubatoms &&
      record?.amountStorageModel === WORK_SUBATOM_PROJECTION_MODEL &&
      Number(record?.decimals) === WORK_SUBATOM_DECIMALS &&
      String(record?.unitScale ?? "") === WORK_SUBATOM_UNIT_SCALE_TEXT;
    return q8Historical || q16Current;
  } catch {
    return false;
  }
}

function matchesTxid(row, txid) {
  return [row?.txid, row?.txId].some((value) => String(value).trim().toLowerCase() === txid);
}

function assertCanonicalWorkTransfer(row, expected, network, surface) {
  const label = `${surface} transfer ${expected.txid}`;
  assert.equal(row?.txid, expected.txid, `${label} identity`);
  if (row.txId !== undefined) assert.equal(row.txId, expected.txid, `${label} identity alias`);
  if (row.network !== undefined) assert.equal(row.network, network, `${label} network`);
  assert.equal(row.confirmed, true, `${label} confirmation`);
  assert.ok(row.valid === undefined || row.valid === true, `${label} validity`);
  assert.equal(row.blockHeight, expected.blockHeight, `${label} canonical height`);
  assert.equal(row.tokenId, expected.tokenId, `${label} asset`);
  if (row.ticker !== undefined) assert.equal(row.ticker, "WORK", `${label} ticker`);
  assert.equal(row.senderAddress, expected.senderAddress, `${label} sender`);
  assert.equal(row.recipientAddress, expected.recipientAddress, `${label} recipient`);
  assert.ok(workAmountMatches(row, expected.amount), `${label} exact WORK amount`);
}

export function assertExactWorkTransferHistory(page, expected, surface) {
  assert.ok(
    page?.kind === "transfers" && page.start === 0 && page.end === 1 &&
      page.totalCount === 1 && page.hasMore === false && page.nextCursor === "" &&
      Array.isArray(page.items) && page.items.length === 1,
    `${surface} must return exactly one complete transfer result for ${expected.txid}`,
  );
  assert.ok(
    Array.isArray(page.canonicalInvalidTxids) &&
      !page.canonicalInvalidTxids.some((id) => String(id).toLowerCase() === expected.txid),
    `${surface} invalid-event alias for ${expected.txid}`,
  );
  assertCanonicalWorkTransfer(page.items[0], expected, page.network, surface);
}

function sameCheckpoint(left, right) {
  return Number.isSafeInteger(left.indexedThroughBlock) && left.indexedThroughBlock > 0 &&
    left.indexedThroughBlock === right.indexedThroughBlock &&
    /^[0-9a-f]{64}$/u.test(left.indexedThroughBlockHash) &&
    left.indexedThroughBlockHash === right.indexedThroughBlockHash;
}

function isOlderDirectTransfer(row, address, target) {
  // The index writer sets createdAt and event_time to the confirmed parent's
  // block time. Exclude pending and derived rows and require both clocks to agree.
  return row?.confirmed === true && row.valid !== false &&
    row.derived !== true && !["mailbatch1", "batch1"].includes(row.transferVersion) &&
    /^[0-9a-f]{64}$/u.test(row.txid) && row.tokenId === target.tokenId &&
    (row.senderAddress === address || row.recipientAddress === address) &&
    Number.isSafeInteger(row.blockHeight) && row.blockHeight > 0 &&
    row.blockHeight < target.blockHeight && Date.parse(row.createdAt) < Date.parse(target.createdAt);
}

export async function checkWalletParticipantTransfer(readJson, network, address, expected) {
  assert.ok(
    address === expected.senderAddress || address === expected.recipientAddress,
    "historical transfer lookup requires its sender or recipient",
  );
  const params = { network, asset: expected.tokenId, fresh: 1 };
  const historyQuery = { ...params, kind: "transfers", q: address };
  const history = await readJson("/api/v1/token-history", {
    ...historyQuery, txid: expected.txid, limit: 2,
  });
  const surface = `${address} scoped history`;
  assert.equal(history.network, network, `${surface} network`);
  assertExactWorkTransferHistory(history, expected, surface);
  const wallet = await readJson("/api/v1/token", { ...params, address, wallet: 1 });
  assert.ok(
    wallet?.network === network && wallet.walletScoped === true && wallet.authoritativeWallet === true &&
      wallet.summaryOnly === true && wallet.tokenScope === expected.tokenId &&
      Array.isArray(wallet.transfers) && Array.isArray(wallet.invalidEvents),
    `${address} wallet transfer summary is incomplete`,
  );
  assert.ok(
    !wallet.invalidEvents.some((row) => matchesTxid(row, expected.txid)),
    `${address} wallet exposes a stale invalid-event alias for ${expected.txid}`,
  );
  const matches = wallet.transfers.filter((row) => matchesTxid(row, expected.txid));
  if (matches.length > 0) {
    assert.equal(matches.length, 1, `${address} wallet duplicates ${expected.txid}`);
    assertCanonicalWorkTransfer(matches[0], expected, network, `${address} wallet`);
    return;
  }

  // The SQL wallet window selects 500 mixed events plus one sentinel before
  // filtering/projecting individual collections. Even an underfilled transfer
  // summary cannot establish absence from this participant's complete history.
  if (sameCheckpoint(history, wallet)) {
    assert.ok(
      !wallet.transfers.some((row) => isOlderDirectTransfer(row, address, history.items[0])),
      `${address} wallet omitted ${expected.txid} despite returning an older confirmed transfer`,
    );
  }
}
