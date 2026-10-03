-- PROPOSAL ONLY. Explicit production approval and before/after receipts required.
-- This creates one new physical replication slot; it never reuses or drops one.
\set ON_ERROR_STOP on
SET statement_timeout = '10s';
SET lock_timeout = '2s';
DO $audit30$
BEGIN
  IF current_setting('wal_level') <> 'replica'
     OR current_setting('max_slot_wal_keep_size') <> '16384'
     OR current_setting('archive_mode') <> 'off' THEN
    RAISE EXCEPTION 'Current approved replication settings differ';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_replication_slots
             WHERE slot_name = 'pow_audit30_receivewal') THEN
    RAISE EXCEPTION 'Dedicated slot already exists; no implicit reuse';
  END IF;
  IF (SELECT count(*) FROM pg_replication_slots)
       > current_setting('max_replication_slots')::integer - 2
     OR (SELECT count(*) FROM pg_stat_replication)
       > current_setting('max_wal_senders')::integer - 3 THEN
    RAISE EXCEPTION 'Insufficient slot or sender budget';
  END IF;
END
$audit30$;
SELECT slot_name, lsn::text
FROM pg_create_physical_replication_slot('pow_audit30_receivewal', true);
-- Keep the existing effective 16GB cap. No ALTER SYSTEM, reload or restart.
