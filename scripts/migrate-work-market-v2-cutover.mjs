import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  WORK_MARKET_V2_AUTH_VERSION,
} from "../server/work-market-v2.mjs";
import { WORK_TOKEN_ID } from "../server/work-units.mjs";

const { Pool } = pg;

export const WORK_MARKET_V2_CUTOVER_REASON_CODE =
  "work-market-v2-version-required";
export const WORK_MARKET_V2_CUTOVER_TARGETS = [
  {
    blockHeight: 959091,
    kind: "token-listing-sealed",
    txid: "5575f61bb7f42ef26bf56b1575a8ae43fec54c43a5d3b71057bc8fd4839a1af1",
    version: "pwt-sale-v2",
  },
  {
    blockHeight: 959093,
    kind: "token-listing",
    txid: "df317cbbfdc603a390ee0f8b027ba8f0d08ef2200ce914b0b3e7dd46ce0982ce",
    version: "pwt-sale-v2",
  },
];

function exactStringArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function rowPayload(row) {
  return row?.payload && typeof row.payload === "object" &&
    !Array.isArray(row.payload)
    ? row.payload
    : {};
}

export function classifyWorkMarketV2CutoverRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (sourceRows.length !== WORK_MARKET_V2_CUTOVER_TARGETS.length) {
    throw new Error(
      `Expected ${WORK_MARKET_V2_CUTOVER_TARGETS.length} cutover events, found ${sourceRows.length}.`,
    );
  }

  const pristineEventIds = [];
  const alreadyMigratedEventIds = [];
  for (const target of WORK_MARKET_V2_CUTOVER_TARGETS) {
    const matches = sourceRows.filter(
      (candidate) => String(candidate?.txid ?? "") === target.txid,
    );
    const row = matches[0];
    if (
      matches.length !== 1 ||
      !row ||
      row.kind !== target.kind ||
      row.status !== "confirmed" ||
      Number(row.block_height) !== target.blockHeight ||
      row.version !== target.version ||
      !Number.isSafeInteger(Number(row.event_id)) ||
      Number(row.event_id) < 1
    ) {
      throw new Error(`Cutover event ${target.txid} does not match its pinned facts.`);
    }

    const payload = rowPayload(row);
    const validationErrors = Array.isArray(row.validation_errors)
      ? row.validation_errors
      : [];
    const exactMigrated =
      row.valid === false &&
      exactStringArray(validationErrors, [WORK_MARKET_V2_CUTOVER_REASON_CODE]) &&
      payload.valid === false &&
      payload.reason === WORK_MARKET_V2_CUTOVER_REASON_CODE &&
      payload.reasonCode === WORK_MARKET_V2_CUTOVER_REASON_CODE &&
      payload.refundEligible === false &&
      payload.relic === false &&
      exactStringArray(payload.validationErrors, [
        WORK_MARKET_V2_CUTOVER_REASON_CODE,
      ]);
    if (exactMigrated) {
      alreadyMigratedEventIds.push(Number(row.event_id));
      continue;
    }

    const hasPartialCutoverState =
      row.valid === false ||
      validationErrors.length > 0 ||
      payload.valid === false ||
      payload.reason === WORK_MARKET_V2_CUTOVER_REASON_CODE ||
      payload.reasonCode === WORK_MARKET_V2_CUTOVER_REASON_CODE ||
      payload.refundEligible === false ||
      payload.relic === false ||
      (Array.isArray(payload.validationErrors) &&
        payload.validationErrors.includes(WORK_MARKET_V2_CUTOVER_REASON_CODE));
    if (row.valid !== true || hasPartialCutoverState) {
      throw new Error(
        `Cutover event ${target.txid} has an inconsistent pre-migration state.`,
      );
    }
    pristineEventIds.push(Number(row.event_id));
  }

  return { alreadyMigratedEventIds, pristineEventIds };
}

export async function runWorkMarketV2CutoverMigration(
  client,
  { apply = false } = {},
) {
  await client.query("BEGIN");
  try {
    await client.query(
      "LOCK TABLE proof_indexer.credit_listings IN SHARE ROW EXCLUSIVE MODE",
    );
    const result = await client.query(
      `
        SELECT
          event_id,
          txid,
          kind,
          valid,
          validation_errors,
          status,
          block_height,
          payload,
          payload->'saleAuthorization'->>'version' AS version
        FROM proof_indexer.events
        WHERE network = 'livenet'
          AND txid = ANY($1::text[])
        ORDER BY block_height, event_id
        FOR UPDATE
      `,
      [WORK_MARKET_V2_CUTOVER_TARGETS.map((target) => target.txid)],
    );
    const classification = classifyWorkMarketV2CutoverRows(result.rows);
    const unsupportedProjectionResult = await client.query(
      `
        SELECT
          cl.listing_id,
          cl.status,
          cl.seal_txid,
          cl.close_txid
        FROM proof_indexer.credit_listings cl
        WHERE cl.network = 'livenet'
          AND lower(cl.token_id) = $1
          AND lower(COALESCE(
            cl.payload->'saleAuthorization'->>'version',
            ''
          )) = $2
          AND (
            NOT EXISTS (
              SELECT 1
              FROM proof_indexer.events listing_event
              JOIN proof_indexer.transactions listing_tx
                ON listing_tx.network = listing_event.network
               AND listing_tx.txid = listing_event.txid
               AND listing_tx.status = 'confirmed'
              JOIN proof_indexer.blocks listing_block
                ON listing_block.network = listing_tx.network
               AND listing_block.block_hash = listing_tx.block_hash
               AND listing_block.height = listing_tx.block_height
               AND listing_block.canonical = true
              WHERE listing_event.network = cl.network
                AND listing_event.txid = lower(cl.listing_id)
                AND listing_event.valid = true
                AND listing_event.status = 'confirmed'
                AND listing_event.kind = ANY(
                  ARRAY['token-listing','token-listings']::text[]
                )
                AND lower(COALESCE(
                  listing_event.payload->>'listingId',
                  listing_event.txid
                )) = lower(cl.listing_id)
                AND lower(COALESCE(
                  listing_event.payload->>'tokenId',
                  listing_event.payload->'saleAuthorization'->>'tokenId',
                  ''
                )) = $1
                AND lower(COALESCE(
                  listing_event.payload->'saleAuthorization'->>'version',
                  ''
                )) = $2
            )
            OR (
              COALESCE(cl.seal_txid, '') <> ''
              AND NOT EXISTS (
                SELECT 1
                FROM proof_indexer.events seal_event
                JOIN proof_indexer.transactions seal_tx
                  ON seal_tx.network = seal_event.network
                 AND seal_tx.txid = seal_event.txid
                 AND seal_tx.status = 'confirmed'
                JOIN proof_indexer.blocks seal_block
                  ON seal_block.network = seal_tx.network
                 AND seal_block.block_hash = seal_tx.block_hash
                 AND seal_block.height = seal_tx.block_height
                 AND seal_block.canonical = true
                WHERE seal_event.network = cl.network
                  AND seal_event.txid = lower(cl.seal_txid)
                  AND seal_event.valid = true
                  AND seal_event.status = 'confirmed'
                  AND seal_event.kind = 'token-listing-sealed'
                  AND lower(seal_event.payload->>'listingId') =
                    lower(cl.listing_id)
                  AND lower(COALESCE(
                    seal_event.payload->>'tokenId',
                    seal_event.payload->'saleAuthorization'->>'tokenId',
                    ''
                  )) = $1
                  AND lower(COALESCE(
                    seal_event.payload->'saleAuthorization'->>'version',
                    ''
                  )) = $2
              )
            )
            OR (
              (
                cl.status IN ('sold', 'delisted')
                OR COALESCE(cl.close_txid, '') <> ''
              )
              AND NOT EXISTS (
                SELECT 1
                FROM proof_indexer.events close_event
                JOIN proof_indexer.transactions close_tx
                  ON close_tx.network = close_event.network
                 AND close_tx.txid = close_event.txid
                 AND close_tx.status = 'confirmed'
                JOIN proof_indexer.blocks close_block
                  ON close_block.network = close_tx.network
                 AND close_block.block_hash = close_tx.block_hash
                 AND close_block.height = close_tx.block_height
                 AND close_block.canonical = true
                WHERE close_event.network = cl.network
                  AND close_event.txid = lower(cl.close_txid)
                  AND close_event.valid = true
                  AND close_event.status = 'confirmed'
                  AND close_event.kind = ANY(
                    ARRAY['token-sale','token-listing-closed']::text[]
                  )
                  AND lower(close_event.payload->>'listingId') =
                    lower(cl.listing_id)
              )
            )
          )
        ORDER BY cl.listing_id
        FOR UPDATE
      `,
      [WORK_TOKEN_ID, WORK_MARKET_V2_AUTH_VERSION],
    );
    if (unsupportedProjectionResult.rows.length > 0) {
      throw new Error(
        `Unsupported WORK Marketplace V2 projections require canonical rebuild: ${unsupportedProjectionResult.rows
          .map((row) => String(row?.listing_id ?? "unknown"))
          .join(", ")}`,
      );
    }
    let updatedCount = 0;

    if (apply && classification.pristineEventIds.length > 0) {
      const update = await client.query(
        `
          UPDATE proof_indexer.events
          SET
            valid = FALSE,
            validation_errors = ARRAY[$2]::text[],
            payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
              'valid', FALSE,
              'reason', $2,
              'reasonCode', $2,
              'refundEligible', FALSE,
              'relic', FALSE,
              'validationErrors', jsonb_build_array($2)
            ),
            updated_at = NOW()
          WHERE network = 'livenet'
            AND event_id = ANY($1::bigint[])
            AND valid = TRUE
          RETURNING event_id, txid
        `,
        [classification.pristineEventIds, WORK_MARKET_V2_CUTOVER_REASON_CODE],
      );
      updatedCount = update.rows.length;
      if (updatedCount !== classification.pristineEventIds.length) {
        throw new Error(
          `Expected to invalidate ${classification.pristineEventIds.length} pristine events, updated ${updatedCount}.`,
        );
      }
    }

    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return {
      alreadyMigratedCount: classification.alreadyMigratedEventIds.length,
      applied: apply,
      pristineCount: classification.pristineEventIds.length,
      reasonCode: WORK_MARKET_V2_CUTOVER_REASON_CODE,
      targets: WORK_MARKET_V2_CUTOVER_TARGETS,
      unsupportedV3ProjectionCount: 0,
      updatedCount,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const connectionString = String(
    process.env.POW_INDEX_DATABASE_URL ?? "",
  ).trim();
  if (!connectionString) {
    throw new Error("POW_INDEX_DATABASE_URL is required.");
  }
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    const result = await runWorkMarketV2CutoverMigration(client, {
      apply: process.env.WORK_MARKET_V2_CUTOVER_APPLY === "1",
    });
    console.log(JSON.stringify(result));
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
