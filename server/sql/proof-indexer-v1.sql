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
  block_index integer,
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
  CONSTRAINT transactions_block_index_nonnegative
    CHECK (block_index IS NULL OR block_index >= 0),
  PRIMARY KEY (network, txid),
  FOREIGN KEY (network, block_hash)
    REFERENCES proof_indexer.blocks (network, block_hash)
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE proof_indexer.transactions
  ADD COLUMN IF NOT EXISTS block_index integer;

CREATE INDEX IF NOT EXISTS transactions_status_idx
  ON proof_indexer.transactions (network, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS transactions_confirmed_height_idx
  ON proof_indexer.transactions (network, block_height, txid)
  WHERE status = 'confirmed';

-- `txid` identifies a transaction but never orders confirmed protocol state.
-- AMO V5 uses the zero-based position in the canonical full-node block array.
-- Keep the legacy height/txid index above for historical query compatibility;
-- all deterministic replay uses this explicit position index.
CREATE INDEX IF NOT EXISTS transactions_confirmed_position_idx
  ON proof_indexer.transactions (
    network,
    block_height,
    block_index,
    txid
  )
  WHERE status = 'confirmed' AND block_index IS NOT NULL;

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
  block_index integer,
  record_ordinal integer NOT NULL,
  block_time timestamptz,
  event_time timestamptz,
  raw_payload text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_block_index_nonnegative
    CHECK (block_index IS NULL OR block_index >= 0),
  CONSTRAINT events_op_return_vout_nonnegative
    CHECK (op_return_vout IS NULL OR op_return_vout >= 0),
  CONSTRAINT events_record_ordinal_nonnegative
    CHECK (record_ordinal >= 0),
  UNIQUE (network, event_key),
  FOREIGN KEY (network, txid)
    REFERENCES proof_indexer.transactions (network, txid)
    ON DELETE CASCADE
);

ALTER TABLE proof_indexer.events
  ADD COLUMN IF NOT EXISTS block_index integer,
  ADD COLUMN IF NOT EXISTS record_ordinal integer;

UPDATE proof_indexer.events
SET record_ordinal = 0
WHERE record_ordinal IS NULL
  AND (
    status <> 'confirmed'
    OR (
      block_height IS NOT NULL
      AND block_height < 959621
    )
  );

ALTER TABLE proof_indexer.events
  ALTER COLUMN record_ordinal SET NOT NULL,
  ALTER COLUMN record_ordinal DROP DEFAULT;

CREATE INDEX IF NOT EXISTS events_lookup_idx
  ON proof_indexer.events (network, protocol, kind, status, event_time DESC);

CREATE INDEX IF NOT EXISTS events_txid_idx
  ON proof_indexer.events (network, txid, event_id);

CREATE INDEX IF NOT EXISTS events_confirmed_order_idx
  ON proof_indexer.events (network, block_height, txid, event_id)
  WHERE status = 'confirmed' AND valid = true;

CREATE INDEX IF NOT EXISTS events_confirmed_position_idx
  ON proof_indexer.events (
    network,
    block_height,
    block_index,
    op_return_vout,
    record_ordinal,
    event_id
  )
  WHERE
    status = 'confirmed'
    AND valid = true
    AND block_index IS NOT NULL
    AND op_return_vout IS NOT NULL;

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
  max_supply numeric NOT NULL,
  mint_amount numeric NOT NULL,
  mint_price_sats bigint NOT NULL,
  create_txid text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_height integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT credit_definitions_max_supply_integer
    CHECK (max_supply::text ~ '^(0|[1-9][0-9]*)$'),
  CONSTRAINT credit_definitions_mint_amount_integer
    CHECK (mint_amount::text ~ '^[1-9][0-9]*$'),
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
  confirmed_balance numeric NOT NULL DEFAULT 0,
  pending_delta numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_balances_confirmed_balance_integer
    CHECK (confirmed_balance::text ~ '^(0|[1-9][0-9]*)$'),
  CONSTRAINT credit_balances_pending_delta_integer
    CHECK (pending_delta::text ~ '^-?(0|[1-9][0-9]*)$'),
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
  amount numeric NOT NULL,
  price_sats bigint NOT NULL,
  sale_ticket_txid text,
  sale_ticket_vout integer,
  sale_ticket_value_sats bigint,
  seal_txid text,
  close_txid text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_listings_amount_integer
    CHECK (amount::text ~ '^[1-9][0-9]*$'),
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

-- Canonical AMO USD quotes are an append-only chain. Invalid or competing
-- records remain in `events`; only the winning, fully verified quote is
-- projected here. Sequence and position uniqueness are constrained only for
-- confirmed valid rows so audit history can remain intact.
CREATE TABLE IF NOT EXISTS proof_indexer.work_usd_quotes (
  network text NOT NULL,
  txid text NOT NULL,
  declaration_txid text NOT NULL,
  sequence numeric NOT NULL,
  previous_quote_txid text NOT NULL,
  usd_per_100m_proofs_q8 numeric NOT NULL,
  authority_scriptpubkey text NOT NULL,
  record_count integer NOT NULL,
  registry_address text NOT NULL,
  registry_payment_sats bigint NOT NULL,
  registry_payment_vout integer NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'confirmed', 'dropped', 'orphaned')
  ),
  valid boolean NOT NULL DEFAULT false,
  validation_errors text[] NOT NULL DEFAULT '{}',
  block_hash text,
  block_height integer,
  block_index integer,
  protocol_vout integer,
  record_ordinal integer NOT NULL,
  raw_payload text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_usd_quotes_sequence_integer
    CHECK (sequence::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_usd_quotes_value_integer
    CHECK (usd_per_100m_proofs_q8::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_usd_quotes_record_count_one
    CHECK (record_count = 1),
  CONSTRAINT work_usd_quotes_registry_payment_positive
    CHECK (registry_payment_sats > 0),
  CONSTRAINT work_usd_quotes_registry_payment_vout_nonnegative
    CHECK (registry_payment_vout >= 0),
  CONSTRAINT work_usd_quotes_block_index_nonnegative
    CHECK (block_index IS NULL OR block_index >= 0),
  CONSTRAINT work_usd_quotes_protocol_vout_nonnegative
    CHECK (protocol_vout IS NULL OR protocol_vout >= 0),
  CONSTRAINT work_usd_quotes_record_ordinal_nonnegative
    CHECK (record_ordinal >= 0),
  PRIMARY KEY (network, txid),
  FOREIGN KEY (network, txid)
    REFERENCES proof_indexer.transactions (network, txid)
    ON DELETE CASCADE
);

ALTER TABLE proof_indexer.work_usd_quotes
  ALTER COLUMN record_ordinal DROP DEFAULT;

ALTER TABLE proof_indexer.work_usd_quotes
  ADD COLUMN IF NOT EXISTS record_count integer,
  ADD COLUMN IF NOT EXISTS registry_address text,
  ADD COLUMN IF NOT EXISTS registry_payment_sats bigint,
  ADD COLUMN IF NOT EXISTS registry_payment_vout integer;

ALTER TABLE proof_indexer.work_usd_quotes
  ALTER COLUMN record_count SET NOT NULL,
  ALTER COLUMN registry_address SET NOT NULL,
  ALTER COLUMN registry_payment_sats SET NOT NULL,
  ALTER COLUMN registry_payment_vout SET NOT NULL;

DO $proof_indexer_work_usd_quote_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.work_usd_quotes'::regclass
      AND conname = 'work_usd_quotes_record_count_one'
  ) THEN
    ALTER TABLE proof_indexer.work_usd_quotes
      ADD CONSTRAINT work_usd_quotes_record_count_one
      CHECK (record_count = 1) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.work_usd_quotes'::regclass
      AND conname = 'work_usd_quotes_registry_payment_positive'
  ) THEN
    ALTER TABLE proof_indexer.work_usd_quotes
      ADD CONSTRAINT work_usd_quotes_registry_payment_positive
      CHECK (registry_payment_sats > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.work_usd_quotes'::regclass
      AND conname = 'work_usd_quotes_registry_payment_vout_nonnegative'
  ) THEN
    ALTER TABLE proof_indexer.work_usd_quotes
      ADD CONSTRAINT work_usd_quotes_registry_payment_vout_nonnegative
      CHECK (registry_payment_vout >= 0) NOT VALID;
  END IF;
END;
$proof_indexer_work_usd_quote_constraints$;

ALTER TABLE proof_indexer.work_usd_quotes
  VALIDATE CONSTRAINT work_usd_quotes_record_count_one,
  VALIDATE CONSTRAINT work_usd_quotes_registry_payment_positive,
  VALIDATE CONSTRAINT work_usd_quotes_registry_payment_vout_nonnegative;

CREATE UNIQUE INDEX IF NOT EXISTS work_usd_quotes_confirmed_sequence_uidx
  ON proof_indexer.work_usd_quotes (network, declaration_txid, sequence)
  WHERE status = 'confirmed' AND valid = true;

CREATE UNIQUE INDEX IF NOT EXISTS work_usd_quotes_confirmed_position_uidx
  ON proof_indexer.work_usd_quotes (
    network,
    block_height,
    block_index,
    protocol_vout,
    record_ordinal
  )
  WHERE
    status = 'confirmed'
    AND valid = true
    AND block_height IS NOT NULL
    AND block_index IS NOT NULL
    AND protocol_vout IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_usd_quotes_previous_idx
  ON proof_indexer.work_usd_quotes (
    network,
    previous_quote_txid,
    block_height,
    block_index
  );

CREATE OR REPLACE FUNCTION proof_indexer.reject_work_usd_quotes_update()
RETURNS trigger
LANGUAGE plpgsql
AS $proof_indexer_work_usd_quotes_immutable$
BEGIN
  RAISE EXCEPTION
    'Canonical AMO USD quote projections are immutable; delete only for canonical reorg replay'
    USING ERRCODE = '55000';
END;
$proof_indexer_work_usd_quotes_immutable$;

DROP TRIGGER IF EXISTS work_usd_quotes_immutable
  ON proof_indexer.work_usd_quotes;
CREATE TRIGGER work_usd_quotes_immutable
BEFORE UPDATE ON proof_indexer.work_usd_quotes
FOR EACH ROW
EXECUTE FUNCTION proof_indexer.reject_work_usd_quotes_update();

-- A V5 listing's economic terms are derived once at its confirmed canonical
-- position. The row is deliberately update-proof: lifecycle changes belong in
-- `credit_listings`, while a reorg removes and deterministically replays this
-- derived row.
CREATE TABLE IF NOT EXISTS proof_indexer.work_amo_listing_terms (
  network text NOT NULL,
  listing_id text NOT NULL,
  listing_txid text NOT NULL,
  token_id text NOT NULL,
  authorization_version text NOT NULL,
  unit_face_usd_cents integer NOT NULL,
  unit_amount_atoms numeric NOT NULL,
  unit_price_sats bigint NOT NULL,
  unit_minimum_price_sats bigint NOT NULL,
  unit_usd_quote_txid text NOT NULL,
  unit_usd_quote_vout integer NOT NULL,
  unit_usd_quote_sequence numeric NOT NULL,
  unit_usd_quote_block_height integer NOT NULL,
  unit_usd_quote_block_hash text NOT NULL,
  unit_usd_quote_block_index integer NOT NULL,
  unit_usd_per_100m_proofs_q8 numeric NOT NULL,
  unit_network_value_before_q8 numeric NOT NULL,
  listing_block_height integer NOT NULL,
  listing_block_hash text NOT NULL,
  listing_block_index integer NOT NULL,
  listing_protocol_vout integer NOT NULL,
  listing_record_ordinal integer NOT NULL,
  listing_bond_contribution_q8 numeric NOT NULL,
  unit_network_value_after_q8 numeric NOT NULL,
  frozen_terms jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_amo_listing_terms_face
    CHECK (unit_face_usd_cents IN (2000, 5000, 10000)),
  CONSTRAINT work_amo_listing_terms_amount_integer
    CHECK (unit_amount_atoms::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_amo_listing_terms_quote_sequence_integer
    CHECK (unit_usd_quote_sequence::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_amo_listing_terms_quote_value_integer
    CHECK (unit_usd_per_100m_proofs_q8::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_amo_listing_terms_network_before_integer
    CHECK (unit_network_value_before_q8::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_amo_listing_terms_bond_integer
    CHECK (listing_bond_contribution_q8::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_amo_listing_terms_network_after_integer
    CHECK (unit_network_value_after_q8::text ~ '^[1-9][0-9]*$'),
  CONSTRAINT work_amo_listing_terms_price_positive
    CHECK (
      unit_price_sats > 0
      AND unit_minimum_price_sats > 0
      AND unit_price_sats >= unit_minimum_price_sats
    ),
  CONSTRAINT work_amo_listing_terms_network_transition
    CHECK (
      unit_network_value_after_q8 =
        unit_network_value_before_q8 + listing_bond_contribution_q8
    ),
  CONSTRAINT work_amo_listing_terms_quote_precedes_listing
    CHECK (
      (
        unit_usd_quote_block_height,
        unit_usd_quote_block_index,
        unit_usd_quote_vout,
        0
      ) < (
        listing_block_height,
        listing_block_index,
        listing_protocol_vout,
        listing_record_ordinal
      )
      AND unit_usd_quote_block_height >= 959306
      AND listing_block_height >= 959621
      AND listing_block_height <= unit_usd_quote_block_height + 144
    ),
  CONSTRAINT work_amo_listing_terms_positions_nonnegative
    CHECK (
      unit_usd_quote_vout >= 0
      AND unit_usd_quote_block_height > 0
      AND unit_usd_quote_block_index >= 0
      AND listing_block_height > 0
      AND listing_block_index >= 0
      AND listing_protocol_vout >= 0
      AND listing_record_ordinal >= 0
    ),
  PRIMARY KEY (network, listing_id),
  UNIQUE (network, listing_txid),
  FOREIGN KEY (network, listing_txid)
    REFERENCES proof_indexer.transactions (network, txid)
    ON DELETE CASCADE,
  FOREIGN KEY (network, unit_usd_quote_txid)
    REFERENCES proof_indexer.work_usd_quotes (network, txid)
    ON DELETE RESTRICT
);

ALTER TABLE proof_indexer.work_amo_listing_terms
  ALTER COLUMN listing_record_ordinal DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS work_amo_listing_terms_position_uidx
  ON proof_indexer.work_amo_listing_terms (
    network,
    listing_block_height,
    listing_block_index,
    listing_protocol_vout,
    listing_record_ordinal
  );

CREATE OR REPLACE FUNCTION proof_indexer.reject_work_amo_listing_terms_update()
RETURNS trigger
LANGUAGE plpgsql
AS $proof_indexer_work_amo_listing_terms_immutable$
BEGIN
  RAISE EXCEPTION
    'AMO V5 frozen listing terms are immutable; delete only for canonical reorg replay'
    USING ERRCODE = '55000';
END;
$proof_indexer_work_amo_listing_terms_immutable$;

DROP TRIGGER IF EXISTS work_amo_listing_terms_immutable
  ON proof_indexer.work_amo_listing_terms;
CREATE TRIGGER work_amo_listing_terms_immutable
BEFORE UPDATE ON proof_indexer.work_amo_listing_terms
FOR EACH ROW
EXECUTE FUNCTION proof_indexer.reject_work_amo_listing_terms_update();

-- AMO V6 is proof-native. The face is a fixed amount of proofs and the
-- confirmed canonical listing position derives and freezes the WORK amount
-- from the network value immediately before that record.
--
-- The USD-attestation V6 schema was staged in production but never activated.
-- Replace that exact empty shape once, and fail closed if it ever contains
-- history or a migration marker. After replacement this block is a no-op, so
-- normal schema reapplication can never drop proof-native V6 history.
DO $proof_indexer_replace_staged_work_amo_v6_oracle$
DECLARE
  staged_attestations regclass :=
    to_regclass('proof_indexer.work_amo_v6_attestations');
  staged_terms regclass :=
    to_regclass('proof_indexer.work_amo_v6_listing_terms');
  staged_attestation_count bigint := 0;
  staged_terms_count bigint := 0;
  marker_present boolean := false;
  oracle_attestations_exact boolean := false;
  oracle_terms_exact boolean := false;
  oracle_terms_shape boolean := false;
  proof_terms_exact boolean := false;
  proof_terms_shape boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM proof_indexer.meta
    WHERE key = 'workAmoV6Migration:livenet'
  )
  INTO marker_present;

  IF staged_terms IS NOT NULL THEN
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'proof_indexer'
          AND table_name = 'work_amo_v6_listing_terms'
          AND column_name = 'unit_face_usd_cents'
      ),
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'proof_indexer'
          AND table_name = 'work_amo_v6_listing_terms'
          AND column_name = 'unit_face_proofs'
      ),
      (
        SELECT array_agg(column_name::text ORDER BY column_name) =
          ARRAY[
            'authorization_version',
            'created_at',
            'frozen_terms',
            'listing_block_hash',
            'listing_block_height',
            'listing_block_index',
            'listing_bond_contribution_q8',
            'listing_id',
            'listing_network_value_after_q8',
            'listing_network_value_before_q8',
            'listing_protocol_vout',
            'listing_record_ordinal',
            'listing_txid',
            'network',
            'token_id',
            'unit_amount_atoms',
            'unit_face_usd_cents',
            'unit_minimum_price_sats',
            'unit_price_sats',
            'unit_usd_attestation_id',
            'unit_usd_attestation_model',
            'unit_usd_attestation_signature',
            'unit_usd_attestation_version',
            'unit_usd_declaration_txid',
            'unit_usd_oracle_key_id',
            'unit_usd_oracle_public_key',
            'unit_usd_per_100m_proofs_q8',
            'unit_usd_reference_block_hash',
            'unit_usd_reference_block_height',
            'unit_usd_source_set_sha256',
            'unit_usd_valid_from_height',
            'unit_usd_valid_through_height'
          ]::text[]
        FROM information_schema.columns
        WHERE table_schema = 'proof_indexer'
          AND table_name = 'work_amo_v6_listing_terms'
      ),
      (
        SELECT array_agg(column_name::text ORDER BY column_name) =
          ARRAY[
            'authorization_version',
            'created_at',
            'frozen_terms',
            'listing_block_hash',
            'listing_block_height',
            'listing_block_index',
            'listing_bond_contribution_q8',
            'listing_id',
            'listing_network_value_after_q8',
            'listing_network_value_before_q8',
            'listing_protocol_vout',
            'listing_record_ordinal',
            'listing_txid',
            'network',
            'token_id',
            'unit_amount_atoms',
            'unit_face_proofs',
            'unit_minimum_price_sats',
            'unit_price_sats'
          ]::text[]
        FROM information_schema.columns
        WHERE table_schema = 'proof_indexer'
          AND table_name = 'work_amo_v6_listing_terms'
      )
    INTO
      oracle_terms_shape,
      proof_terms_shape,
      oracle_terms_exact,
      proof_terms_exact;
  END IF;

  IF staged_attestations IS NOT NULL THEN
    SELECT
      array_agg(column_name::text ORDER BY column_name) =
        ARRAY[
          'attestation_id',
          'attestation_model',
          'attestation_version',
          'created_at',
          'declaration_txid',
          'freshness_window_ms',
          'issued_at_unix_ms',
          'listing_txid',
          'max_spread_bps',
          'max_validity_blocks',
          'minimum_sources',
          'network',
          'oracle_key_id',
          'oracle_public_key',
          'payload',
          'reference_block_hash',
          'reference_block_height',
          'signature_hex',
          'source_count',
          'source_set_sha256',
          'sources',
          'usd_per_100m_proofs_q8',
          'valid_from_height',
          'valid_through_height'
        ]::text[]
    INTO oracle_attestations_exact
    FROM information_schema.columns
    WHERE table_schema = 'proof_indexer'
      AND table_name = 'work_amo_v6_attestations';
  END IF;

  IF
    staged_terms IS NOT NULL
    AND (
      (oracle_terms_shape AND NOT oracle_terms_exact)
      OR (proof_terms_shape AND NOT proof_terms_exact)
      OR (NOT oracle_terms_shape AND NOT proof_terms_shape)
    )
  THEN
    RAISE EXCEPTION
      'Unknown AMO V6 listing-terms schema; refusing automatic replacement'
      USING ERRCODE = '55000';
  END IF;

  IF
    staged_attestations IS NOT NULL
    AND NOT oracle_attestations_exact
  THEN
    RAISE EXCEPTION
      'Unknown AMO V6 attestation schema; refusing automatic replacement'
      USING ERRCODE = '55000';
  END IF;

  IF oracle_terms_shape OR staged_attestations IS NOT NULL THEN
    IF oracle_terms_shape THEN
      EXECUTE
        'SELECT count(*) FROM proof_indexer.work_amo_v6_listing_terms'
      INTO staged_terms_count;
    END IF;
    IF staged_attestations IS NOT NULL THEN
      EXECUTE
        'SELECT count(*) FROM proof_indexer.work_amo_v6_attestations'
      INTO staged_attestation_count;
    END IF;
    IF
      marker_present
      OR staged_terms_count <> 0
      OR staged_attestation_count <> 0
    THEN
      RAISE EXCEPTION
        'Staged USD-oracle AMO V6 state is not empty; refusing proof-native replacement (terms %, attestations %, marker %)',
        staged_terms_count,
        staged_attestation_count,
        marker_present
        USING ERRCODE = '55000';
    END IF;
    IF oracle_terms_shape THEN
      EXECUTE
        'DROP TABLE proof_indexer.work_amo_v6_listing_terms';
    END IF;
    IF staged_attestations IS NOT NULL THEN
      EXECUTE
        'DROP TABLE proof_indexer.work_amo_v6_attestations';
    END IF;
  END IF;
END;
$proof_indexer_replace_staged_work_amo_v6_oracle$;

DROP FUNCTION IF EXISTS
  proof_indexer.reject_work_amo_v6_attestations_update();
DROP FUNCTION IF EXISTS
  proof_indexer.valid_work_amo_v6_sources(
    jsonb,
    integer,
    bigint,
    integer
  );

CREATE TABLE IF NOT EXISTS proof_indexer.work_amo_v6_listing_terms (
  network text NOT NULL,
  listing_id text NOT NULL,
  listing_txid text NOT NULL,
  token_id text NOT NULL,
  authorization_version text NOT NULL,
  unit_face_proofs integer NOT NULL,
  unit_amount_atoms numeric NOT NULL,
  unit_price_sats bigint NOT NULL,
  unit_minimum_price_sats bigint NOT NULL,
  listing_network_value_before_q8 numeric NOT NULL,
  listing_block_height integer NOT NULL,
  listing_block_hash text NOT NULL,
  listing_block_index integer NOT NULL,
  listing_protocol_vout integer NOT NULL,
  listing_record_ordinal integer NOT NULL,
  listing_bond_contribution_q8 numeric NOT NULL,
  listing_network_value_after_q8 numeric NOT NULL,
  frozen_terms jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, listing_id),
  UNIQUE (network, listing_txid),
  CONSTRAINT work_amo_v6_terms_identity
    CHECK (
      network = 'livenet'
      AND listing_id = listing_txid
      AND listing_id ~ '^[0-9a-f]{64}$'
      AND token_id =
        'd4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8'
      AND authorization_version = 'pwt-sale-v6'
      AND listing_block_hash ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT work_amo_v6_terms_values
    CHECK (
      unit_face_proofs IN (20000, 50000, 100000)
      AND unit_amount_atoms::text ~ '^[1-9][0-9]*$'
      AND unit_amount_atoms <= 2100000000000000
      AND unit_price_sats = unit_face_proofs
      AND unit_minimum_price_sats > 0
      AND unit_minimum_price_sats <= unit_price_sats
      AND listing_network_value_before_q8::text ~ '^[1-9][0-9]*$'
      AND listing_bond_contribution_q8::text ~ '^[1-9][0-9]*$'
      AND listing_network_value_after_q8::text ~ '^[1-9][0-9]*$'
      AND listing_network_value_after_q8 =
        listing_network_value_before_q8 + listing_bond_contribution_q8
      AND unit_amount_atoms = trunc(
        (
          unit_face_proofs::numeric *
          21000000 *
          100000000 *
          100000000
        ) / listing_network_value_before_q8
      )
      AND unit_minimum_price_sats = ceil(
        (
          unit_amount_atoms *
          listing_network_value_before_q8
        ) / (
          21000000::numeric *
          100000000 *
          100000000
        )
      )
    ),
  CONSTRAINT work_amo_v6_terms_positions
    CHECK (
      listing_block_height > 0
      AND listing_block_index >= 0
      AND listing_protocol_vout >= 0
      AND listing_record_ordinal >= 0
    ),
  CONSTRAINT work_amo_v6_terms_frozen_payload
    CHECK ((
      jsonb_typeof(frozen_terms) = 'object'
      AND frozen_terms ?& ARRAY[
        'version',
        'unitModel',
        'stateOrderModel',
        'amountModel',
        'bondTransitionModel',
        'unitWorkOracleModel',
        'unitFaceProofs',
        'listingBlockHeight',
        'listingBlockHash',
        'listingBlockIndex',
        'listingProtocolVout',
        'listingRecordOrdinal',
        'listingNetworkValueBeforeQ8',
        'unitAmountAtoms',
        'unitPriceSats',
        'unitMinimumPriceSats',
        'listingBondContributionQ8',
        'listingNetworkValueAfterQ8'
      ]
      AND frozen_terms - ARRAY[
        'version',
        'unitModel',
        'stateOrderModel',
        'amountModel',
        'bondTransitionModel',
        'unitWorkOracleModel',
        'unitFaceProofs',
        'listingBlockHeight',
        'listingBlockHash',
        'listingBlockIndex',
        'listingProtocolVout',
        'listingRecordOrdinal',
        'listingNetworkValueBeforeQ8',
        'unitAmountAtoms',
        'unitPriceSats',
        'unitMinimumPriceSats',
        'listingBondContributionQ8',
        'listingNetworkValueAfterQ8'
      ] = '{}'::jsonb
      AND jsonb_typeof(frozen_terms->'version') = 'string'
      AND jsonb_typeof(frozen_terms->'unitModel') = 'string'
      AND jsonb_typeof(frozen_terms->'stateOrderModel') = 'string'
      AND jsonb_typeof(frozen_terms->'amountModel') = 'string'
      AND jsonb_typeof(frozen_terms->'bondTransitionModel') = 'string'
      AND jsonb_typeof(frozen_terms->'unitWorkOracleModel') = 'string'
      AND jsonb_typeof(frozen_terms->'unitFaceProofs') = 'number'
      AND jsonb_typeof(frozen_terms->'listingBlockHeight') = 'number'
      AND jsonb_typeof(frozen_terms->'listingBlockHash') = 'string'
      AND jsonb_typeof(frozen_terms->'listingBlockIndex') = 'number'
      AND jsonb_typeof(frozen_terms->'listingProtocolVout') = 'number'
      AND jsonb_typeof(frozen_terms->'listingRecordOrdinal') = 'number'
      AND jsonb_typeof(
        frozen_terms->'listingNetworkValueBeforeQ8'
      ) = 'string'
      AND jsonb_typeof(frozen_terms->'unitAmountAtoms') = 'string'
      AND jsonb_typeof(frozen_terms->'unitPriceSats') = 'string'
      AND jsonb_typeof(frozen_terms->'unitMinimumPriceSats') = 'string'
      AND jsonb_typeof(
        frozen_terms->'listingBondContributionQ8'
      ) = 'string'
      AND jsonb_typeof(
        frozen_terms->'listingNetworkValueAfterQ8'
      ) = 'string'
      AND frozen_terms->>'version' = authorization_version
      AND frozen_terms->>'unitModel' =
        'canonical-work-amo-proof-unit-v1'
      AND frozen_terms->>'stateOrderModel' =
        'canonical-proof-state-order-v1'
      AND frozen_terms->>'amountModel' =
        'canonical-confirmed-position-derived-work-amount-v1'
      AND frozen_terms->>'bondTransitionModel' =
        'canonical-compute-then-bond-v1'
      AND frozen_terms->>'unitWorkOracleModel' =
        'canonical-work-prefix-before-action-v1'
      AND frozen_terms->>'unitFaceProofs' =
        unit_face_proofs::text
      AND frozen_terms->>'listingNetworkValueBeforeQ8' =
        listing_network_value_before_q8::text
      AND frozen_terms->>'listingBlockHeight' =
        listing_block_height::text
      AND frozen_terms->>'listingBlockHash' = listing_block_hash
      AND frozen_terms->>'listingBlockIndex' =
        listing_block_index::text
      AND frozen_terms->>'listingProtocolVout' =
        listing_protocol_vout::text
      AND frozen_terms->>'listingRecordOrdinal' =
        listing_record_ordinal::text
      AND frozen_terms->>'unitAmountAtoms' = unit_amount_atoms::text
      AND frozen_terms->>'unitPriceSats' = unit_price_sats::text
      AND frozen_terms->>'unitMinimumPriceSats' =
        unit_minimum_price_sats::text
      AND frozen_terms->>'listingBondContributionQ8' =
        listing_bond_contribution_q8::text
      AND frozen_terms->>'listingNetworkValueAfterQ8' =
        listing_network_value_after_q8::text
    ) IS TRUE),
  FOREIGN KEY (network, listing_txid)
    REFERENCES proof_indexer.transactions (network, txid)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS work_amo_v6_listing_terms_position_uidx
  ON proof_indexer.work_amo_v6_listing_terms (
    network,
    listing_block_height,
    listing_block_index,
    listing_protocol_vout,
    listing_record_ordinal
  );

CREATE OR REPLACE FUNCTION
  proof_indexer.reject_work_amo_v6_listing_terms_update()
RETURNS trigger
LANGUAGE plpgsql
AS $proof_indexer_work_amo_v6_listing_terms_immutable$
BEGIN
  RAISE EXCEPTION
    'Proof-native AMO V6 frozen listing terms are immutable; delete only for canonical reorg replay'
    USING ERRCODE = '55000';
END;
$proof_indexer_work_amo_v6_listing_terms_immutable$;

DROP TRIGGER IF EXISTS work_amo_v6_listing_terms_immutable
  ON proof_indexer.work_amo_v6_listing_terms;
CREATE TRIGGER work_amo_v6_listing_terms_immutable
BEFORE UPDATE ON proof_indexer.work_amo_v6_listing_terms
FOR EACH ROW
EXECUTE FUNCTION
  proof_indexer.reject_work_amo_v6_listing_terms_update();

CREATE OR REPLACE FUNCTION
  proof_indexer.reject_work_amo_v6_migration_marker_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $proof_indexer_work_amo_v6_marker_immutable$
BEGIN
  IF
    OLD.key = 'workAmoV6Migration:livenet'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.key = 'workAmoV6Migration:livenet'
    )
  THEN
    RAISE EXCEPTION
      'The completed AMO V6 declaration/index marker is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$proof_indexer_work_amo_v6_marker_immutable$;

DROP TRIGGER IF EXISTS work_amo_v6_migration_marker_immutable
  ON proof_indexer.meta;
CREATE TRIGGER work_amo_v6_migration_marker_immutable
BEFORE UPDATE OR DELETE ON proof_indexer.meta
FOR EACH ROW
EXECUTE FUNCTION
  proof_indexer.reject_work_amo_v6_migration_marker_mutation();

CREATE TABLE IF NOT EXISTS proof_indexer.work_amo_block_transitions (
  network text NOT NULL,
  block_height integer NOT NULL,
  block_hash text NOT NULL,
  previous_block_hash text NOT NULL,
  model text NOT NULL,
  state_commitment_model text NOT NULL,
  opening_network_value_q8 numeric NOT NULL,
  closing_network_value_q8 numeric NOT NULL,
  opening_state_sha256 text NOT NULL,
  closing_state_sha256 text NOT NULL,
  opening_state_payload_bytes integer NOT NULL,
  closing_state_payload_bytes integer NOT NULL,
  protocol_record_count integer NOT NULL,
  raw_protocol_candidate_count integer NOT NULL,
  transaction_count integer NOT NULL,
  event_count integer NOT NULL,
  event_set_model text NOT NULL,
  event_set_sha256 text NOT NULL,
  event_set_payload_bytes integer NOT NULL,
  block_atomic boolean NOT NULL,
  fee_once boolean NOT NULL,
  invalid_zero boolean NOT NULL,
  complete boolean NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, block_height),
  UNIQUE (network, block_hash),
  CONSTRAINT work_amo_block_transitions_height_positive
    CHECK (block_height > 0),
  CONSTRAINT work_amo_block_transitions_models
    CHECK (
      model IN (
        'canonical-work-amo-full-position-block-sequencer-v1',
        'canonical-work-amo-full-position-block-sequencer-v2'
      )
      AND state_commitment_model =
        'canonical-work-amo-sufficient-state-sha256-v1'
      AND event_set_model =
        'canonical-work-amo-event-set-sha256-v1'
    ),
  CONSTRAINT work_amo_block_transitions_hashes
    CHECK (
      block_hash ~ '^[0-9a-f]{64}$'
      AND previous_block_hash ~ '^[0-9a-f]{64}$'
      AND opening_state_sha256 ~ '^[0-9a-f]{64}$'
      AND closing_state_sha256 ~ '^[0-9a-f]{64}$'
      AND event_set_sha256 ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT work_amo_block_transitions_values_integer
    CHECK (
      opening_network_value_q8::text ~ '^(0|[1-9][0-9]*)$'
      AND closing_network_value_q8::text ~ '^(0|[1-9][0-9]*)$'
      AND closing_network_value_q8 >= opening_network_value_q8
    ),
  CONSTRAINT work_amo_block_transitions_counts
    CHECK (
      opening_state_payload_bytes > 0
      AND closing_state_payload_bytes > 0
      AND protocol_record_count >= 0
      AND raw_protocol_candidate_count >= 0
      AND transaction_count >= 0
      AND event_count >= 0
      AND event_set_payload_bytes > 0
    ),
  CONSTRAINT work_amo_block_transitions_complete
    CHECK (
      block_atomic = true
      AND fee_once = true
      AND invalid_zero = true
      AND complete = true
    ),
  FOREIGN KEY (network, block_hash)
    REFERENCES proof_indexer.blocks (network, block_hash)
    ON DELETE CASCADE
);

ALTER TABLE proof_indexer.work_amo_block_transitions
  DROP CONSTRAINT IF EXISTS work_amo_block_transitions_models;
ALTER TABLE proof_indexer.work_amo_block_transitions
  ADD CONSTRAINT work_amo_block_transitions_models
  CHECK (
    model IN (
      'canonical-work-amo-full-position-block-sequencer-v1',
      'canonical-work-amo-full-position-block-sequencer-v2'
    )
    AND state_commitment_model =
      'canonical-work-amo-sufficient-state-sha256-v1'
    AND event_set_model =
      'canonical-work-amo-event-set-sha256-v1'
  );

CREATE INDEX IF NOT EXISTS work_amo_block_transitions_tip_idx
  ON proof_indexer.work_amo_block_transitions (
    network,
    block_height DESC
  );

CREATE OR REPLACE FUNCTION
  proof_indexer.reject_work_amo_block_transitions_update()
RETURNS trigger
LANGUAGE plpgsql
AS $proof_indexer_work_amo_block_transitions_immutable$
BEGIN
  RAISE EXCEPTION
    'Canonical AMO block transitions are immutable; delete only for canonical reorg replay'
    USING ERRCODE = '55000';
END;
$proof_indexer_work_amo_block_transitions_immutable$;

DROP TRIGGER IF EXISTS work_amo_block_transitions_immutable
  ON proof_indexer.work_amo_block_transitions;
CREATE TRIGGER work_amo_block_transitions_immutable
BEFORE UPDATE ON proof_indexer.work_amo_block_transitions
FOR EACH ROW
EXECUTE FUNCTION
  proof_indexer.reject_work_amo_block_transitions_update();

DO $proof_indexer_amo_position_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.transactions'::regclass
      AND conname = 'transactions_block_index_nonnegative'
  ) THEN
    ALTER TABLE proof_indexer.transactions
      ADD CONSTRAINT transactions_block_index_nonnegative
      CHECK (block_index IS NULL OR block_index >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.events'::regclass
      AND conname = 'events_block_index_nonnegative'
  ) THEN
    ALTER TABLE proof_indexer.events
      ADD CONSTRAINT events_block_index_nonnegative
      CHECK (block_index IS NULL OR block_index >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.events'::regclass
      AND conname = 'events_op_return_vout_nonnegative'
  ) THEN
    ALTER TABLE proof_indexer.events
      ADD CONSTRAINT events_op_return_vout_nonnegative
      CHECK (op_return_vout IS NULL OR op_return_vout >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.events'::regclass
      AND conname = 'events_record_ordinal_nonnegative'
  ) THEN
    ALTER TABLE proof_indexer.events
      ADD CONSTRAINT events_record_ordinal_nonnegative
      CHECK (record_ordinal >= 0) NOT VALID;
  END IF;
END;
$proof_indexer_amo_position_constraints$;

ALTER TABLE proof_indexer.transactions
  VALIDATE CONSTRAINT transactions_block_index_nonnegative;

ALTER TABLE proof_indexer.events
  VALIDATE CONSTRAINT events_block_index_nonnegative,
  VALIDATE CONSTRAINT events_op_return_vout_nonnegative,
  VALIDATE CONSTRAINT events_record_ordinal_nonnegative;

-- Existing databases predate unbounded synthetic bond issuance and used a
-- numeric(78, 0) typmod for every durable credit unit. Drop only that typmod;
-- unconstrained numeric remains exact and the checks below preserve the
-- integer/non-negative semantics that the application requires. Each block is
-- catalog-gated so repeated schema application does not reacquire a rewrite
-- lock after the migration has completed.
DO $proof_indexer_credit_definition_units$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'proof_indexer.credit_definitions'::regclass
      AND attname IN ('max_supply', 'mint_amount')
      AND NOT attisdropped
      AND atttypid = 'numeric'::regtype
      AND atttypmod <> -1
  ) THEN
    ALTER TABLE proof_indexer.credit_definitions
      ALTER COLUMN max_supply TYPE numeric USING max_supply::numeric,
      ALTER COLUMN mint_amount TYPE numeric USING mint_amount::numeric;
  END IF;
END;
$proof_indexer_credit_definition_units$;

DO $proof_indexer_credit_balance_units$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'proof_indexer.credit_balances'::regclass
      AND attname IN ('confirmed_balance', 'pending_delta')
      AND NOT attisdropped
      AND atttypid = 'numeric'::regtype
      AND atttypmod <> -1
  ) THEN
    ALTER TABLE proof_indexer.credit_balances
      ALTER COLUMN confirmed_balance TYPE numeric
        USING confirmed_balance::numeric,
      ALTER COLUMN pending_delta TYPE numeric USING pending_delta::numeric;
  END IF;
END;
$proof_indexer_credit_balance_units$;

DO $proof_indexer_credit_listing_units$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'proof_indexer.credit_listings'::regclass
      AND attname = 'amount'
      AND NOT attisdropped
      AND atttypid = 'numeric'::regtype
      AND atttypmod <> -1
  ) THEN
    ALTER TABLE proof_indexer.credit_listings
      ALTER COLUMN amount TYPE numeric USING amount::numeric;
  END IF;
END;
$proof_indexer_credit_listing_units$;

DO $proof_indexer_credit_unit_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.credit_definitions'::regclass
      AND conname = 'credit_definitions_max_supply_integer'
  ) THEN
    ALTER TABLE proof_indexer.credit_definitions
      ADD CONSTRAINT credit_definitions_max_supply_integer
      CHECK (max_supply::text ~ '^(0|[1-9][0-9]*)$') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.credit_definitions'::regclass
      AND conname = 'credit_definitions_mint_amount_integer'
  ) THEN
    ALTER TABLE proof_indexer.credit_definitions
      ADD CONSTRAINT credit_definitions_mint_amount_integer
      CHECK (mint_amount::text ~ '^[1-9][0-9]*$') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.credit_balances'::regclass
      AND conname = 'credit_balances_confirmed_balance_integer'
  ) THEN
    ALTER TABLE proof_indexer.credit_balances
      ADD CONSTRAINT credit_balances_confirmed_balance_integer
      CHECK (confirmed_balance::text ~ '^(0|[1-9][0-9]*)$') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.credit_balances'::regclass
      AND conname = 'credit_balances_pending_delta_integer'
  ) THEN
    ALTER TABLE proof_indexer.credit_balances
      ADD CONSTRAINT credit_balances_pending_delta_integer
      CHECK (pending_delta::text ~ '^-?(0|[1-9][0-9]*)$') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'proof_indexer.credit_listings'::regclass
      AND conname = 'credit_listings_amount_integer'
  ) THEN
    ALTER TABLE proof_indexer.credit_listings
      ADD CONSTRAINT credit_listings_amount_integer
      CHECK (amount::text ~ '^[1-9][0-9]*$') NOT VALID;
  END IF;
END;
$proof_indexer_credit_unit_constraints$;

ALTER TABLE proof_indexer.credit_definitions
  VALIDATE CONSTRAINT credit_definitions_max_supply_integer,
  VALIDATE CONSTRAINT credit_definitions_mint_amount_integer;

ALTER TABLE proof_indexer.credit_balances
  VALIDATE CONSTRAINT credit_balances_confirmed_balance_integer,
  VALIDATE CONSTRAINT credit_balances_pending_delta_integer;

ALTER TABLE proof_indexer.credit_listings
  VALIDATE CONSTRAINT credit_listings_amount_integer;

-- Synthetic bond definitions are uncapped by protocol. `max_supply` remains
-- NOT NULL for the shared definition schema, so zero is the neutral storage
-- marker; the public/API contract is the explicit uncapped metadata below.
UPDATE proof_indexer.credit_definitions
SET
  max_supply = 0,
  metadata = (metadata - 'maxSupplyStorage') || jsonb_build_object(
    'maxSupply', NULL,
    'maxSupplyModel', 'uncapped',
    'uncapped', true
  )
WHERE (
    (
      token_id = 'a3d0bc8528f91dfc52400a885bed7e49235396aa82aa9f95db41be629f1d5562'
        AND upper(ticker) = 'POWB'
    ) OR (
      token_id = '3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d'
        AND upper(ticker) = 'INCB'
    )
  )
  AND (
    max_supply <> 0
    OR metadata ? 'maxSupplyStorage'
    OR metadata->'maxSupply' IS DISTINCT FROM 'null'::jsonb
    OR metadata->>'maxSupplyModel' IS DISTINCT FROM 'uncapped'
    OR metadata->>'uncapped' IS DISTINCT FROM 'true'
  );

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

CREATE OR REPLACE FUNCTION
  proof_indexer.reject_work_amo_h_minus_one_seed_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $proof_indexer_work_amo_h_minus_one_seed_evidence_immutable$
BEGIN
  IF
    OLD.payload->>'model' =
      'canonical-work-amo-v5-h-minus-one-seed-evidence-v1'
    OR (
      TG_OP = 'UPDATE'
      AND NEW.payload->>'model' =
        'canonical-work-amo-v5-h-minus-one-seed-evidence-v1'
    )
  THEN
    RAISE EXCEPTION
      'AMO V5 H-1 seed evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$proof_indexer_work_amo_h_minus_one_seed_evidence_immutable$;

DROP TRIGGER IF EXISTS work_amo_h_minus_one_seed_evidence_immutable
  ON proof_indexer.ledger_snapshots;
CREATE TRIGGER work_amo_h_minus_one_seed_evidence_immutable
BEFORE UPDATE OR DELETE ON proof_indexer.ledger_snapshots
FOR EACH ROW
EXECUTE FUNCTION
  proof_indexer.reject_work_amo_h_minus_one_seed_evidence_mutation();

COMMIT;
