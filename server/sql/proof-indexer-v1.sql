-- ProofOfWork.Me PostgreSQL event indexer schema.
--
-- This schema is a durable read model over Bitcoin-derived ProofOfWork events.
-- It is intentionally replayable: Bitcoin Core/electrs/mempool remain the
-- source of truth, and confirmed projections are derived from confirmed rows.

BEGIN;

CREATE SCHEMA IF NOT EXISTS proof_indexer;

CREATE TABLE IF NOT EXISTS proof_indexer.meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proof_indexer.blocks (
  network text NOT NULL,
  block_hash text NOT NULL,
  height integer NOT NULL,
  previous_block_hash text,
  block_time timestamptz,
  median_time timestamptz,
  tx_count integer,
  canonical boolean NOT NULL DEFAULT true,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, block_hash)
);

CREATE INDEX IF NOT EXISTS blocks_height_idx
  ON proof_indexer.blocks (network, height, canonical);

CREATE TABLE IF NOT EXISTS proof_indexer.transactions (
  network text NOT NULL,
  txid text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'confirmed', 'dropped', 'orphaned')
  ),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  dropped_at timestamptz,
  block_hash text,
  block_height integer,
  block_time timestamptz,
  fee_sats bigint,
  vsize integer,
  weight integer,
  version integer,
  locktime bigint,
  source text,
  dropped_reason text,
  replaced_by_txid text,
  raw_tx jsonb,
  raw_hex text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, txid),
  FOREIGN KEY (network, block_hash)
    REFERENCES proof_indexer.blocks (network, block_hash)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS transactions_status_idx
  ON proof_indexer.transactions (network, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS transactions_confirmed_height_idx
  ON proof_indexer.transactions (network, block_height, txid)
  WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS proof_indexer.tx_inputs (
  network text NOT NULL,
  txid text NOT NULL,
  vin integer NOT NULL,
  prev_txid text,
  prev_vout integer,
  address text,
  value_sats bigint,
  sequence bigint,
  script_sig text,
  witness jsonb,
  PRIMARY KEY (network, txid, vin),
  FOREIGN KEY (network, txid)
    REFERENCES proof_indexer.transactions (network, txid)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tx_inputs_prevout_idx
  ON proof_indexer.tx_inputs (network, prev_txid, prev_vout);

CREATE INDEX IF NOT EXISTS tx_inputs_address_idx
  ON proof_indexer.tx_inputs (network, address)
  WHERE address IS NOT NULL;

CREATE TABLE IF NOT EXISTS proof_indexer.tx_outputs (
  network text NOT NULL,
  txid text NOT NULL,
  vout integer NOT NULL,
  value_sats bigint NOT NULL DEFAULT 0,
  address text,
  scriptpubkey text,
  scriptpubkey_asm text,
  scriptpubkey_type text,
  spent_by_txid text,
  spent_by_vin integer,
  spent_at timestamptz,
  PRIMARY KEY (network, txid, vout),
  FOREIGN KEY (network, txid)
    REFERENCES proof_indexer.transactions (network, txid)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tx_outputs_address_idx
  ON proof_indexer.tx_outputs (network, address)
  WHERE address IS NOT NULL;

CREATE INDEX IF NOT EXISTS tx_outputs_spend_idx
  ON proof_indexer.tx_outputs (network, spent_by_txid)
  WHERE spent_by_txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS proof_indexer.op_returns (
  network text NOT NULL,
  txid text NOT NULL,
  vout integer NOT NULL,
  output_index integer NOT NULL DEFAULT 0,
  protocol text,
  payload_text text,
  payload_hex text,
  data_bytes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (network, txid, vout, output_index),
  FOREIGN KEY (network, txid, vout)
    REFERENCES proof_indexer.tx_outputs (network, txid, vout)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS op_returns_protocol_idx
  ON proof_indexer.op_returns (network, protocol, txid)
  WHERE protocol IS NOT NULL;

CREATE TABLE IF NOT EXISTS proof_indexer.events (
  event_id bigserial PRIMARY KEY,
  network text NOT NULL,
  event_key text NOT NULL,
  txid text NOT NULL,
  op_return_vout integer,
  protocol text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'confirmed', 'dropped', 'orphaned')
  ),
  valid boolean NOT NULL DEFAULT false,
  validation_errors text[] NOT NULL DEFAULT '{}',
  amount_sats bigint NOT NULL DEFAULT 0,
  data_bytes integer NOT NULL DEFAULT 0,
  block_height integer,
  block_time timestamptz,
  event_time timestamptz,
  raw_payload text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, event_key),
  FOREIGN KEY (network, txid)
    REFERENCES proof_indexer.transactions (network, txid)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS events_lookup_idx
  ON proof_indexer.events (network, protocol, kind, status, event_time DESC);

CREATE INDEX IF NOT EXISTS events_txid_idx
  ON proof_indexer.events (network, txid, event_id);

CREATE INDEX IF NOT EXISTS events_confirmed_order_idx
  ON proof_indexer.events (network, block_height, txid, event_id)
  WHERE status = 'confirmed' AND valid = true;

CREATE INDEX IF NOT EXISTS events_payload_gin_idx
  ON proof_indexer.events USING gin (payload jsonb_path_ops);

CREATE TABLE IF NOT EXISTS proof_indexer.event_participants (
  event_id bigint NOT NULL REFERENCES proof_indexer.events (event_id)
    ON DELETE CASCADE,
  address text NOT NULL,
  role text NOT NULL,
  powid text,
  PRIMARY KEY (event_id, address, role)
);

CREATE INDEX IF NOT EXISTS event_participants_address_idx
  ON proof_indexer.event_participants (address, role, event_id);

CREATE TABLE IF NOT EXISTS proof_indexer.event_refs (
  event_id bigint NOT NULL REFERENCES proof_indexer.events (event_id)
    ON DELETE CASCADE,
  ref_type text NOT NULL,
  ref_value text NOT NULL,
  PRIMARY KEY (event_id, ref_type, ref_value)
);

CREATE INDEX IF NOT EXISTS event_refs_lookup_idx
  ON proof_indexer.event_refs (ref_type, ref_value, event_id);

CREATE INDEX IF NOT EXISTS event_refs_value_idx
  ON proof_indexer.event_refs (ref_value, event_id);

CREATE TABLE IF NOT EXISTS proof_indexer.id_records (
  network text NOT NULL,
  id_lower text NOT NULL,
  display_id text NOT NULL,
  owner_address text NOT NULL,
  receive_address text NOT NULL,
  pgp_public_key text,
  registration_txid text NOT NULL,
  last_event_txid text NOT NULL,
  registered_height integer,
  updated_height integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, id_lower)
);

CREATE INDEX IF NOT EXISTS id_records_owner_idx
  ON proof_indexer.id_records (network, owner_address);

CREATE INDEX IF NOT EXISTS id_records_receiver_idx
  ON proof_indexer.id_records (network, receive_address);

CREATE TABLE IF NOT EXISTS proof_indexer.mail_items (
  network text NOT NULL,
  txid text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'confirmed', 'dropped', 'orphaned')
  ),
  sender_address text,
  subject text,
  parent_txid text,
  body_text text,
  amount_sats bigint NOT NULL DEFAULT 0,
  data_bytes integer NOT NULL DEFAULT 0,
  message jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_time timestamptz,
  PRIMARY KEY (network, txid)
);

CREATE INDEX IF NOT EXISTS mail_items_sender_idx
  ON proof_indexer.mail_items (network, sender_address, event_time DESC)
  WHERE sender_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS proof_indexer.file_attachments (
  network text NOT NULL,
  txid text NOT NULL,
  attachment_index integer NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'confirmed', 'dropped', 'orphaned')
  ),
  name text,
  mime_type text,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  content_bytes bytea,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_time timestamptz,
  PRIMARY KEY (network, txid, attachment_index)
);

CREATE INDEX IF NOT EXISTS file_attachments_confirmed_idx
  ON proof_indexer.file_attachments (network, event_time DESC)
  WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS proof_indexer.credit_definitions (
  network text NOT NULL,
  token_id text NOT NULL,
  ticker text NOT NULL,
  creator_address text,
  registry_address text NOT NULL,
  max_supply numeric(78, 0) NOT NULL,
  mint_amount numeric(78, 0) NOT NULL,
  mint_price_sats bigint NOT NULL,
  create_txid text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_height integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (network, token_id)
);

CREATE INDEX IF NOT EXISTS credit_definitions_ticker_idx
  ON proof_indexer.credit_definitions (network, upper(ticker));

CREATE INDEX IF NOT EXISTS credit_definitions_registry_idx
  ON proof_indexer.credit_definitions (network, registry_address);

CREATE TABLE IF NOT EXISTS proof_indexer.credit_balances (
  network text NOT NULL,
  token_id text NOT NULL,
  address text NOT NULL,
  confirmed_balance numeric(78, 0) NOT NULL DEFAULT 0,
  pending_delta numeric(78, 0) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, token_id, address),
  FOREIGN KEY (network, token_id)
    REFERENCES proof_indexer.credit_definitions (network, token_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS credit_balances_address_idx
  ON proof_indexer.credit_balances (network, address);

CREATE TABLE IF NOT EXISTS proof_indexer.credit_listings (
  network text NOT NULL,
  listing_id text NOT NULL,
  token_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'active', 'sealing', 'sold', 'delisted', 'dropped', 'orphaned')
  ),
  seller_address text NOT NULL,
  buyer_address text,
  amount numeric(78, 0) NOT NULL,
  price_sats bigint NOT NULL,
  sale_ticket_txid text,
  sale_ticket_vout integer,
  sale_ticket_value_sats bigint,
  seal_txid text,
  close_txid text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, listing_id),
  FOREIGN KEY (network, token_id)
    REFERENCES proof_indexer.credit_definitions (network, token_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS credit_listings_token_status_idx
  ON proof_indexer.credit_listings (network, token_id, status, price_sats);

CREATE INDEX IF NOT EXISTS credit_listings_seller_idx
  ON proof_indexer.credit_listings (network, seller_address, status);

CREATE INDEX IF NOT EXISTS credit_listings_ticket_idx
  ON proof_indexer.credit_listings (network, sale_ticket_txid, sale_ticket_vout)
  WHERE sale_ticket_txid IS NOT NULL;

CREATE TABLE IF NOT EXISTS proof_indexer.ledger_snapshots (
  network text NOT NULL,
  snapshot_id text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  indexed_through_block integer,
  source_hashes jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  consistency jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb,
  PRIMARY KEY (network, snapshot_id)
);

CREATE INDEX IF NOT EXISTS ledger_snapshots_recent_idx
  ON proof_indexer.ledger_snapshots (network, generated_at DESC);

CREATE INDEX IF NOT EXISTS ledger_snapshots_summary_latest_idx
  ON proof_indexer.ledger_snapshots (
    network,
    indexed_through_block DESC NULLS LAST,
    generated_at DESC
  )
  WHERE payload ? 'summaryPayloads';

CREATE INDEX IF NOT EXISTS ledger_snapshots_scan_health_idx
  ON proof_indexer.ledger_snapshots (
    network,
    (
      CASE
        WHEN NULLIF(
          COALESCE(
            NULLIF(payload->>'indexedThroughBlockHash', ''),
            NULLIF(payload->>'blockHash', ''),
            NULLIF(source_hashes->>'blockScan', '')
          ),
          ''
        ) IS NOT NULL THEN 0
        ELSE 1
      END
    ),
    indexed_through_block DESC NULLS LAST,
    generated_at DESC
  );

CREATE INDEX IF NOT EXISTS ledger_snapshots_canonical_payload_latest_idx
  ON proof_indexer.ledger_snapshots (
    network,
    (
      CASE
        WHEN payload->>'snapshotId' = snapshot_id
          AND payload ? 'activityPayload'
          AND payload ? 'registryHistoryPayloads'
          AND payload ? 'summaryPayloads'
          AND payload ? 'tokenHistoryPayloads'
          AND payload ? 'tokenStatePayloads'
        THEN 0
        ELSE 1
      END
    ),
    generated_at DESC
  )
  WHERE payload ? 'snapshotId';

COMMIT;
