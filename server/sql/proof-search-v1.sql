-- Disposable, versioned Search projections. No protocol or economic state lives here.
CREATE TABLE IF NOT EXISTS proof_indexer.search_runs (
  run_id text PRIMARY KEY,
  network text NOT NULL,
  index_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('building', 'ready', 'superseded')),
  checkpoint_height integer NOT NULL,
  checkpoint_hash text NOT NULL,
  source_witness jsonb NOT NULL,
  source_cursor text NOT NULL DEFAULT '',
  volatile_only boolean NOT NULL DEFAULT false,
  source_floor_height integer NOT NULL DEFAULT 0,
  projected_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE proof_indexer.search_runs ADD COLUMN IF NOT EXISTS volatile_only boolean NOT NULL DEFAULT false;
ALTER TABLE proof_indexer.search_runs ADD COLUMN IF NOT EXISTS source_floor_height integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS search_runs_ready_idx ON proof_indexer.search_runs
  (network, index_version, completed_at DESC) WHERE state = 'ready';
CREATE TABLE IF NOT EXISTS proof_indexer.search_documents (
  network text NOT NULL,
  run_id text NOT NULL REFERENCES proof_indexer.search_runs(run_id) ON DELETE CASCADE,
  id text NOT NULL,
  source_hash text NOT NULL,
  protocol text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  valid boolean,
  canonical boolean NOT NULL,
  block_height integer,
  block_index integer,
  vout integer,
  ordinal integer,
  amount_proofs numeric(78, 0) NOT NULL,
  record jsonb NOT NULL,
  payload jsonb NOT NULL,
  raw_payload text NOT NULL,
  evidence jsonb NOT NULL,
  search_text text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS
    (to_tsvector('simple'::regconfig, search_text)) STORED,
  PRIMARY KEY (network, run_id, id)
);
CREATE INDEX IF NOT EXISTS search_documents_vector_idx ON proof_indexer.search_documents USING gin (search_vector);
CREATE INDEX IF NOT EXISTS search_documents_filters_idx ON proof_indexer.search_documents
  (network, run_id, status, protocol, kind, valid);
CREATE INDEX IF NOT EXISTS search_documents_position_idx ON proof_indexer.search_documents
  (network, run_id, block_height DESC, block_index DESC, vout DESC, ordinal DESC, id);
