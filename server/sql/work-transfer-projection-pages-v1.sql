-- Apply as the schema administrator. Public API reads use SELECT.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $work_projection_tablespace$
DECLARE
  previous_default text := current_setting('default_tablespace');
  parent_space oid;
  space_name name;
  matched boolean;
BEGIN
  SELECT coalesce(nullif(c.reltablespace, 0), d.dattablespace), s.spcname INTO STRICT parent_space, space_name
  FROM pg_class c CROSS JOIN pg_database d
  JOIN pg_tablespace s ON true
  WHERE c.oid = 'proof_indexer.ledger_snapshots'::regclass AND d.datname = current_database()
    AND s.oid = coalesce(nullif(c.reltablespace, 0), d.dattablespace);
  PERFORM set_config('default_tablespace', space_name::text, true);
  CREATE TABLE IF NOT EXISTS proof_indexer.work_transfer_projection_pages (
  network text NOT NULL,
  snapshot_id text NOT NULL,
  page_index integer NOT NULL CHECK (page_index >= 0),
  payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 262144),
  page_bytes integer GENERATED ALWAYS AS (octet_length(payload)) STORED,
  page_sha256 bytea GENERATED ALWAYS AS (sha256(payload)) STORED,
  PRIMARY KEY (network, snapshot_id, page_index) INCLUDE (page_bytes),
  FOREIGN KEY (network, snapshot_id) REFERENCES proof_indexer.ledger_snapshots (network, snapshot_id) ON DELETE CASCADE
);
  PERFORM set_config('default_tablespace', previous_default, true);
  -- Verify even a pre-existing heap, primary index, TOAST heap and TOAST index.
  WITH main AS (
    SELECT oid, reltoastrelid FROM pg_class WHERE oid = 'proof_indexer.work_transfer_projection_pages'::regclass
  ), relations AS (
    SELECT oid FROM main UNION ALL SELECT reltoastrelid FROM main
    UNION ALL SELECT indexrelid FROM pg_index, main WHERE indrelid = main.oid AND indisprimary
    UNION ALL SELECT indexrelid FROM pg_index, main WHERE indrelid = main.reltoastrelid
  )
  SELECT count(*) = 4 AND bool_and(coalesce(nullif(c.reltablespace, 0), d.dattablespace) = parent_space)
  INTO matched FROM relations r JOIN pg_class c ON c.oid = r.oid CROSS JOIN pg_database d
  WHERE d.datname = current_database();
  IF matched IS DISTINCT FROM true THEN RAISE EXCEPTION 'WORK projection page storage differs from ledger tablespace'; END IF;
END
$work_projection_tablespace$;

REVOKE ALL ON proof_indexer.work_transfer_projection_pages FROM PUBLIC;
GRANT SELECT, INSERT ON proof_indexer.work_transfer_projection_pages TO proof_indexer;
COMMIT;
