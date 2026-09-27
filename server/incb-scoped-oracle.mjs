import { createHash } from "node:crypto";
import { decimalTextFromQ8 } from "./bond-units.mjs";

export const SCOPED_INCB_ORACLE_MODEL = "canonical-incb-scoped-issuance-oracle-v1";
// Admission stays disabled until the independent completed replay and exact
// source row have been reviewed and pinned. No environment override exists.
export const SCOPED_INCB_ORACLE_PIN = null;

const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const fail = () => { throw new Error("Scoped INCB oracle does not match the approved independent replay proof."); };

// The sealed issuance proof owns its original snapshot ID permanently. A future
// full replay may reproduce that ID; its public summary needs a distinct ID so
// it cannot overwrite the proof or fail on an immutable-row collision.
export function canonicalSummarySnapshotIdOutsideScopedOracle(snapshotId, pin = SCOPED_INCB_ORACLE_PIN) {
  if (!pin || snapshotId !== pin.snapshotId) return snapshotId;
  const distinctId = digest(JSON.stringify({
    model: "canonical-summary-distinct-from-scoped-incb-oracle-v1", snapshotId,
  })).slice(0, 24);
  if (distinctId === snapshotId) return fail();
  return distinctId;
}

export function verifiedScopedIncbOracleSource(sourceRowJson, pin = SCOPED_INCB_ORACLE_PIN) {
  if (!pin || typeof sourceRowJson !== "string" || sourceRowJson.length > 8 * 1024 * 1024 ||
      !/^[0-9a-f]{64}$/u.test(pin.sourceRowSha256) || digest(sourceRowJson) !== pin.sourceRowSha256) return fail();
  const row = JSON.parse(sourceRowJson);
  const p = row.payload;
  if (row.network !== "livenet" || row.snapshot_id !== pin.snapshotId ||
      row.indexed_through_block !== pin.height || p?.snapshotId !== pin.snapshotId ||
      p?.indexedThroughBlock !== pin.height || p?.indexedThroughBlockHash !== pin.blockHash ||
      row.source_hashes?.blockScan !== pin.blockHash ||
      !/^[0-9a-f]{64}$/u.test(row.source_hashes?.canonicalSummary ?? "") ||
      row.consistency?.ok !== true || row.consistency?.status !== "green" ||
      p?.ok !== true || p?.status !== "green" ||
      p?.summaryRefresh?.mode !== "canonical-summary-refresh" ||
      p?.totals?.workNetworkValueQ8 !== pin.workNetworkValueQ8 ||
      p?.workSufficientState?.closingStateCommitment?.sha256 !== pin.closingStateSha256 ||
      p?.workSufficientState?.tokenStateCommitment?.sha256 !== pin.tokenStateSha256 ||
      !Array.isArray(row.consistency.checks) || row.consistency.checks.length < 25 ||
      row.consistency.checks.some((check) => check.ok !== true)) return fail();
  return row;
}

export function scopedIncbOracleWrapper(sourceRowJson, pin = SCOPED_INCB_ORACLE_PIN) {
  const row = verifiedScopedIncbOracleSource(sourceRowJson, pin);
  return { network: "livenet", snapshot_id: pin.snapshotId,
    generated_at: row.generated_at, indexed_through_block: pin.height,
    source_hashes: { scopedIncbOracle: pin.sourceRowSha256, blockScan: pin.blockHash },
    metrics: { targetTxid: pin.txid },
    consistency: { ok: true, status: "scoped-issuance-proof" },
    payload: { model: SCOPED_INCB_ORACLE_MODEL, targetTxid: pin.txid,
      proofSha256: pin.proofSha256, sourceRowJson } };
}

export function verifiedScopedIncbOracleRow(row, pin = SCOPED_INCB_ORACLE_PIN) {
  if (!pin || row?.network !== "livenet" || row?.snapshot_id !== pin.snapshotId ||
      Number(row.indexed_through_block) !== pin.height || row?.payload?.model !== SCOPED_INCB_ORACLE_MODEL ||
      row.payload.targetTxid !== pin.txid || row.payload.proofSha256 !== pin.proofSha256 ||
      row.source_hashes?.scopedIncbOracle !== pin.sourceRowSha256 ||
      row.source_hashes?.blockScan !== pin.blockHash || row.source_hashes?.canonicalSummary !== undefined ||
      row.consistency?.status !== "scoped-issuance-proof" || row.consistency?.ok !== true) return fail();
  const source = verifiedScopedIncbOracleSource(row.payload.sourceRowJson, pin);
  if (new Date(row.generated_at).toISOString() !== new Date(source.generated_at).toISOString()) return fail();
  return source;
}

async function storedScopedIncbOracleRow(client, network, pin = SCOPED_INCB_ORACLE_PIN) {
  if (!pin || network !== "livenet") return null;
  const result = await client.query(
    "SELECT network, snapshot_id, generated_at, indexed_through_block, source_hashes, metrics, consistency, payload " +
    "FROM proof_indexer.ledger_snapshots WHERE network = $1 AND snapshot_id = $2",
    [network, pin.snapshotId],
  );
  if (!result.rows.length) return null;
  if (result.rows.length !== 1) return fail();
  const source = verifiedScopedIncbOracleRow(result.rows[0], pin);
  return { source, sourceRowJson: result.rows[0].payload.sourceRowJson };
}

export async function storedScopedIncbOracle(client, network, pin = SCOPED_INCB_ORACLE_PIN) {
  const oracle = await storedScopedIncbOracleRow(client, network, pin);
  if (!oracle) return null;
  const transitions = await client.query(
    "SELECT transition.closing_state_sha256, transition.closing_network_value_q8::text AS q8, " +
    "transition.payload->'closingSufficientState'->'tokenStateCommitment'->>'sha256' AS token_sha256 " +
    "FROM proof_indexer.work_amo_block_transitions transition JOIN proof_indexer.blocks block " +
    "ON block.network = transition.network AND block.height = transition.block_height " +
    "AND block.block_hash = transition.block_hash AND block.canonical = true " +
    "WHERE transition.network = $1 AND transition.block_height = $2 AND transition.block_hash = $3 " +
    "AND transition.complete = true AND transition.block_atomic = true " +
    "AND transition.fee_once = true AND transition.invalid_zero = true",
    [network, pin.height, pin.blockHash],
  );
  const [transition] = transitions.rows;
  if (transitions.rows.length !== 1 || transition.closing_state_sha256 !== pin.closingStateSha256 ||
      transition.token_sha256 !== pin.tokenStateSha256 || transition.q8 !== pin.workNetworkValueQ8) return fail();
  return oracle;
}

// Used only by exact issuance-provenance readers. The physical wrapper cannot
// satisfy public summary admission and is never used as an incremental ledger.
export async function scopedIncbOracleProjectionRows(client, network, snapshotIds, projection) {
  const pin = SCOPED_INCB_ORACLE_PIN;
  if (!pin || !snapshotIds.includes(pin.snapshotId)) return [];
  const oracle = await storedScopedIncbOracleRow(client, network);
  if (!oracle) return [];
  const result = await client.query(`SELECT ${projection} FROM jsonb_to_record($1::jsonb)
    AS source(network text, snapshot_id text, generated_at timestamptz,
      indexed_through_block integer, source_hashes jsonb, metrics jsonb, consistency jsonb, payload jsonb)`,
    [oracle.sourceRowJson]);
  if (result.rows.length !== 1) return fail();
  return result.rows;
}

export function scopedIncbOracleLedgerPayload(source, pin = SCOPED_INCB_ORACLE_PIN) {
  if (!pin || source?.snapshot_id !== pin.snapshotId) return fail();
  return { canonicalSummaryHash: source.source_hashes.canonicalSummary,
    consistency: source.consistency, generatedAt: new Date(source.generated_at).toISOString(),
    indexedThroughBlock: pin.height, indexedThroughBlockHash: pin.blockHash,
    network: "livenet", snapshotId: pin.snapshotId, source: "proof-indexer-canonical-summary-ledger",
    sourceHashes: source.source_hashes, valuationModel: "canonical-summary-refresh",
    workFloor: source.payload.summaryPayloads.workFloor,
    workNetworkValueAccountingModel: "canonical-exact-work-network-q8-v1",
    workNetworkValueQ8: pin.workNetworkValueQ8, workNetworkValueSats: decimalTextFromQ8(pin.workNetworkValueQ8),
    issuanceOnlyTxid: pin.txid };
}
