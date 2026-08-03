BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS proof_indexer.readiness_epoch_shards (
  network text NOT NULL,
  shard smallint NOT NULL CHECK (shard >= 0 AND shard < 64),
  epoch bigint NOT NULL CHECK (epoch >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (network, shard)
);

CREATE TABLE IF NOT EXISTS proof_indexer.readiness_epoch_queue (
  transaction_id xid8 PRIMARY KEY,
  network text NOT NULL,
  shard smallint NOT NULL CHECK (shard >= 0 AND shard < 64),
  enqueued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE proof_indexer.readiness_epoch_queue SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold = 100
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'proof_indexer_readiness_owner'
  ) THEN
    CREATE ROLE proof_indexer_readiness_owner NOLOGIN;
  END IF;
END;
$$;

ALTER ROLE proof_indexer_readiness_owner
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;
GRANT USAGE ON SCHEMA proof_indexer TO proof_indexer_readiness_owner;
ALTER TABLE proof_indexer.readiness_epoch_shards
  OWNER TO proof_indexer_readiness_owner;
ALTER TABLE proof_indexer.readiness_epoch_queue
  OWNER TO proof_indexer_readiness_owner;
ALTER TABLE proof_indexer.readiness_epoch_shards SET LOGGED;
ALTER TABLE proof_indexer.readiness_epoch_queue SET LOGGED;
ALTER TABLE proof_indexer.readiness_epoch_shards DISABLE ROW LEVEL SECURITY;
ALTER TABLE proof_indexer.readiness_epoch_shards NO FORCE ROW LEVEL SECURITY;
ALTER TABLE proof_indexer.readiness_epoch_queue DISABLE ROW LEVEL SECURITY;
ALTER TABLE proof_indexer.readiness_epoch_queue NO FORCE ROW LEVEL SECURITY;

INSERT INTO proof_indexer.readiness_epoch_shards (network, shard, epoch)
SELECT 'livenet', shard, 1
FROM generate_series(0, 63) AS shard
ON CONFLICT (network, shard) DO NOTHING;

CREATE OR REPLACE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_transaction_id xid8 := pg_catalog.pg_current_xact_id();
BEGIN
  INSERT INTO proof_indexer.readiness_epoch_queue (
    transaction_id,
    network,
    shard
  ) VALUES (
    current_transaction_id,
    'livenet',
    pg_catalog.mod(current_transaction_id::text::numeric, 64)::smallint
  )
  ON CONFLICT (transaction_id) DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch_for_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  prior_key text := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.key
    ELSE NULL
  END;
  current_key text := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.key
    ELSE NULL
  END;
  current_transaction_id xid8;
BEGIN
  IF prior_key IN (
      'workPrecisionV2Migration:livenet',
      'workQ16PendingRebuild:livenet'
    ) OR current_key IN (
      'workPrecisionV2Migration:livenet',
      'workQ16PendingRebuild:livenet'
    ) THEN
    current_transaction_id := pg_catalog.pg_current_xact_id();
    INSERT INTO proof_indexer.readiness_epoch_queue (
      transaction_id,
      network,
      shard
    ) VALUES (
      current_transaction_id,
      'livenet',
      pg_catalog.mod(current_transaction_id::text::numeric, 64)::smallint
    )
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION proof_indexer.commit_livenet_readiness_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.transaction_id <> pg_catalog.pg_current_xact_id() THEN
    RAISE EXCEPTION 'Readiness epoch queue transaction mismatch';
  END IF;
  UPDATE proof_indexer.readiness_epoch_shards
  SET epoch = epoch + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE network = NEW.network AND shard = NEW.shard;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Missing readiness epoch shard for network % shard %',
      NEW.network,
      NEW.shard;
  END IF;
  DELETE FROM proof_indexer.readiness_epoch_queue
  WHERE transaction_id = NEW.transaction_id;
  RETURN NULL;
END;
$$;

ALTER FUNCTION proof_indexer.enqueue_livenet_readiness_epoch()
  OWNER TO proof_indexer_readiness_owner;
ALTER FUNCTION proof_indexer.enqueue_livenet_readiness_epoch_for_meta()
  OWNER TO proof_indexer_readiness_owner;
ALTER FUNCTION proof_indexer.commit_livenet_readiness_epoch()
  OWNER TO proof_indexer_readiness_owner;

REVOKE ALL ON TABLE proof_indexer.readiness_epoch_shards FROM PUBLIC;
REVOKE ALL ON TABLE proof_indexer.readiness_epoch_queue FROM PUBLIC;
REVOKE ALL ON TABLE proof_indexer.readiness_epoch_shards FROM proof_indexer;
REVOKE ALL ON TABLE proof_indexer.readiness_epoch_queue FROM proof_indexer;
REVOKE ALL (network, shard, epoch, updated_at)
  ON TABLE proof_indexer.readiness_epoch_shards FROM PUBLIC;
REVOKE ALL (network, shard, epoch, updated_at)
  ON TABLE proof_indexer.readiness_epoch_shards FROM proof_indexer;
REVOKE ALL (transaction_id, network, shard, enqueued_at)
  ON TABLE proof_indexer.readiness_epoch_queue FROM PUBLIC;
REVOKE ALL (transaction_id, network, shard, enqueued_at)
  ON TABLE proof_indexer.readiness_epoch_queue FROM proof_indexer;
REVOKE ALL ON FUNCTION proof_indexer.enqueue_livenet_readiness_epoch() FROM PUBLIC;
REVOKE ALL ON FUNCTION proof_indexer.enqueue_livenet_readiness_epoch_for_meta() FROM PUBLIC;
REVOKE ALL ON FUNCTION proof_indexer.commit_livenet_readiness_epoch() FROM PUBLIC;
REVOKE ALL ON FUNCTION proof_indexer.enqueue_livenet_readiness_epoch() FROM proof_indexer;
REVOKE ALL ON FUNCTION proof_indexer.enqueue_livenet_readiness_epoch_for_meta() FROM proof_indexer;
REVOKE ALL ON FUNCTION proof_indexer.commit_livenet_readiness_epoch() FROM proof_indexer;
GRANT SELECT ON proof_indexer.readiness_epoch_shards TO proof_indexer;
GRANT SELECT ON proof_indexer.readiness_epoch_queue TO proof_indexer;
GRANT EXECUTE ON FUNCTION proof_indexer.enqueue_livenet_readiness_epoch() TO proof_indexer;
GRANT EXECUTE ON FUNCTION proof_indexer.enqueue_livenet_readiness_epoch_for_meta() TO proof_indexer;
GRANT EXECUTE ON FUNCTION proof_indexer.commit_livenet_readiness_epoch() TO proof_indexer;

DROP TRIGGER IF EXISTS readiness_epoch_commit
ON proof_indexer.readiness_epoch_queue;
CREATE CONSTRAINT TRIGGER readiness_epoch_commit
AFTER INSERT ON proof_indexer.readiness_epoch_queue
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION proof_indexer.commit_livenet_readiness_epoch();
ALTER TABLE proof_indexer.readiness_epoch_queue
ENABLE ALWAYS TRIGGER readiness_epoch_commit;

DO $$
DECLARE
  table_name text;
  trigger_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'blocks',
    'credit_balances',
    'credit_definitions',
    'credit_listings',
    'events',
    'ledger_snapshots',
    'op_returns',
    'transactions',
    'tx_inputs',
    'tx_outputs',
    'work_amo_block_transitions',
    'work_amo_listing_terms',
    'work_amo_v6_listing_terms',
    'work_amo_v7_listing_terms',
    'work_amo_v8_listing_terms'
  ] LOOP
    IF to_regclass(format('proof_indexer.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION
        'Required readiness table is missing: proof_indexer.%',
        table_name;
    END IF;
    trigger_name := format('readiness_epoch_%s', table_name);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON proof_indexer.%I',
      trigger_name,
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON proof_indexer.%I FOR EACH STATEMENT EXECUTE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch()',
      trigger_name,
      table_name
    );
    EXECUTE format(
      'ALTER TABLE proof_indexer.%I ENABLE ALWAYS TRIGGER %I',
      table_name,
      trigger_name
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS readiness_epoch_meta ON proof_indexer.meta;
CREATE TRIGGER readiness_epoch_meta
AFTER INSERT OR UPDATE OR DELETE ON proof_indexer.meta
FOR EACH ROW
EXECUTE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch_for_meta();
ALTER TABLE proof_indexer.meta ENABLE ALWAYS TRIGGER readiness_epoch_meta;

DROP TRIGGER IF EXISTS readiness_epoch_meta_truncate ON proof_indexer.meta;
CREATE TRIGGER readiness_epoch_meta_truncate
AFTER TRUNCATE ON proof_indexer.meta
FOR EACH STATEMENT
EXECUTE FUNCTION proof_indexer.enqueue_livenet_readiness_epoch();
ALTER TABLE proof_indexer.meta
ENABLE ALWAYS TRIGGER readiness_epoch_meta_truncate;

DO $$
DECLARE
  invalid_function_count integer;
  readiness_trigger_count integer;
BEGIN
  IF current_setting('max_prepared_transactions')::integer <> 0 THEN
    RAISE EXCEPTION
      'Readiness epochs require max_prepared_transactions=0';
  END IF;
  IF (
    SELECT count(*)
    FROM proof_indexer.readiness_epoch_shards
    WHERE network = 'livenet'
  ) <> 64 OR EXISTS (
    SELECT 1
    FROM generate_series(0, 63) expected(shard)
    LEFT JOIN proof_indexer.readiness_epoch_shards actual
      ON actual.network = 'livenet'
     AND actual.shard = expected.shard
    WHERE actual.shard IS NULL OR actual.epoch < 1
  ) THEN
    RAISE EXCEPTION 'Readiness epoch shard contract is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM proof_indexer.readiness_epoch_queue) THEN
    RAISE EXCEPTION 'Readiness epoch queue is not empty';
  END IF;

  SELECT count(*) INTO readiness_trigger_count
  FROM pg_catalog.pg_trigger trigger_row
  JOIN pg_catalog.pg_class table_row
    ON table_row.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.oid = table_row.relnamespace
  WHERE namespace_row.nspname = 'proof_indexer'
    AND trigger_row.tgisinternal = false
    AND trigger_row.tgname LIKE 'readiness_epoch_%'
    AND trigger_row.tgenabled = 'A';
  IF readiness_trigger_count <> 18 THEN
    RAISE EXCEPTION
      'Expected 18 always-enabled readiness triggers, found %',
      readiness_trigger_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_row
    JOIN pg_catalog.pg_class table_row
      ON table_row.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = 'proof_indexer'
      AND table_row.relname = 'readiness_epoch_queue'
      AND trigger_row.tgname = 'readiness_epoch_commit'
      AND trigger_row.tgisinternal = false
      AND trigger_row.tgenabled = 'A'
      AND trigger_row.tgdeferrable = true
      AND trigger_row.tginitdeferred = true
  ) THEN
    RAISE EXCEPTION 'Readiness epoch commit trigger is not deferred';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger trigger_row
    JOIN pg_catalog.pg_class table_row
      ON table_row.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = table_row.relnamespace
    WHERE namespace_row.nspname = 'proof_indexer'
      AND table_row.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
  ) <> 1 THEN
    RAISE EXCEPTION
      'Readiness epoch tables must have exactly one total trigger';
  END IF;

  SELECT count(*) INTO invalid_function_count
  FROM pg_catalog.pg_proc function_row
  JOIN pg_catalog.pg_namespace namespace_row
    ON namespace_row.oid = function_row.pronamespace
  JOIN pg_catalog.pg_language language_row
    ON language_row.oid = function_row.prolang
  WHERE namespace_row.nspname = 'proof_indexer'
    AND function_row.proname IN (
      'commit_livenet_readiness_epoch',
      'enqueue_livenet_readiness_epoch',
      'enqueue_livenet_readiness_epoch_for_meta'
    )
    AND (
      function_row.prosecdef IS DISTINCT FROM true
      OR function_row.proowner <>
        'proof_indexer_readiness_owner'::regrole
      OR language_row.lanname <> 'plpgsql'
      OR function_row.proconfig IS DISTINCT FROM
        ARRAY['search_path=pg_catalog, pg_temp']::text[]
    );
  IF invalid_function_count <> 0 OR (
    SELECT count(*)
    FROM pg_catalog.pg_proc function_row
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = function_row.pronamespace
    WHERE namespace_row.nspname = 'proof_indexer'
      AND function_row.proname IN (
        'commit_livenet_readiness_epoch',
        'enqueue_livenet_readiness_epoch',
        'enqueue_livenet_readiness_epoch_for_meta'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Readiness epoch function contract is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles role_row
    WHERE role_row.rolname = 'proof_indexer_readiness_owner'
      AND role_row.rolcanlogin = false
      AND role_row.rolsuper = false
      AND role_row.rolcreaterole = false
      AND role_row.rolcreatedb = false
      AND role_row.rolreplication = false
      AND role_row.rolbypassrls = false
      AND pg_catalog.has_schema_privilege(
        role_row.oid,
        'proof_indexer',
        'USAGE'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    WHERE membership.roleid =
        'proof_indexer_readiness_owner'::regrole
       OR membership.member =
        'proof_indexer_readiness_owner'::regrole
  ) THEN
    RAISE EXCEPTION 'Readiness epoch owner role is not isolated';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = relation.relnamespace
    WHERE namespace_row.nspname = 'proof_indexer'
      AND relation.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
      AND relation.relkind = 'r'
      AND relation.relpersistence = 'p'
      AND relation.relrowsecurity = false
      AND relation.relforcerowsecurity = false
      AND relation.relhasrules = false
      AND relation.relam = (
        SELECT access_method.oid
        FROM pg_catalog.pg_am access_method
        WHERE access_method.amname = 'heap'
      )
      AND relation.relowner =
        'proof_indexer_readiness_owner'::regrole
  ) <> 2 THEN
    RAISE EXCEPTION 'Readiness epoch relation contract is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_inherits inheritance_row
    JOIN pg_catalog.pg_class child_relation
      ON child_relation.oid = inheritance_row.inhrelid
    JOIN pg_catalog.pg_namespace child_namespace
      ON child_namespace.oid = child_relation.relnamespace
    JOIN pg_catalog.pg_class parent_relation
      ON parent_relation.oid = inheritance_row.inhparent
    JOIN pg_catalog.pg_namespace parent_namespace
      ON parent_namespace.oid = parent_relation.relnamespace
    WHERE (
      child_namespace.nspname = 'proof_indexer'
      AND child_relation.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
    ) OR (
      parent_namespace.nspname = 'proof_indexer'
      AND parent_relation.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Readiness epoch inheritance contract is invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_rewrite rewrite_row
    JOIN pg_catalog.pg_class relation
      ON relation.oid = rewrite_row.ev_class
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = relation.relnamespace
    WHERE namespace_row.nspname = 'proof_indexer'
      AND relation.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
  ) THEN
    RAISE EXCEPTION 'Readiness epoch rewrite-rule contract is invalid';
  END IF;
  IF EXISTS (
    WITH expected(
      relation_name,
      attribute_number,
      attribute_name,
      data_type,
      not_null,
      dropped,
      identity_column,
      generated_column,
      default_expression
    ) AS (
      VALUES
        (
          'readiness_epoch_queue', 1, 'transaction_id', 'xid8',
          true, false, false, false, NULL::text
        ),
        (
          'readiness_epoch_queue', 2, 'network', 'text',
          true, false, false, false, NULL::text
        ),
        (
          'readiness_epoch_queue', 3, 'shard', 'smallint',
          true, false, false, false, NULL::text
        ),
        (
          'readiness_epoch_queue', 4, 'enqueued_at',
          'timestamp with time zone', true, false, false, false,
          'clock_timestamp()'
        ),
        (
          'readiness_epoch_shards', 1, 'network', 'text',
          true, false, false, false, NULL::text
        ),
        (
          'readiness_epoch_shards', 2, 'shard', 'smallint',
          true, false, false, false, NULL::text
        ),
        (
          'readiness_epoch_shards', 3, 'epoch', 'bigint',
          true, false, false, false, NULL::text
        ),
        (
          'readiness_epoch_shards', 4, 'updated_at',
          'timestamp with time zone', true, false, false, false,
          'clock_timestamp()'
        )
    ), actual AS (
      SELECT
        relation.relname AS relation_name,
        attribute_row.attnum::integer AS attribute_number,
        attribute_row.attname::text AS attribute_name,
        pg_catalog.format_type(
          attribute_row.atttypid,
          attribute_row.atttypmod
        ) AS data_type,
        attribute_row.attnotnull AS not_null,
        attribute_row.attisdropped AS dropped,
        attribute_row.attidentity <> '' AS identity_column,
        attribute_row.attgenerated <> '' AS generated_column,
        pg_catalog.pg_get_expr(
          default_row.adbin,
          default_row.adrelid
        ) AS default_expression
      FROM pg_catalog.pg_attribute attribute_row
      JOIN pg_catalog.pg_class relation
        ON relation.oid = attribute_row.attrelid
      JOIN pg_catalog.pg_namespace namespace_row
        ON namespace_row.oid = relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef default_row
        ON default_row.adrelid = attribute_row.attrelid
       AND default_row.adnum = attribute_row.attnum
      WHERE namespace_row.nspname = 'proof_indexer'
        AND relation.relname IN (
          'readiness_epoch_queue',
          'readiness_epoch_shards'
        )
        AND attribute_row.attnum > 0
    ), drift AS (
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      UNION ALL
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    )
    SELECT 1 FROM drift
  ) THEN
    RAISE EXCEPTION 'Readiness epoch column contract is invalid';
  END IF;
  IF EXISTS (
    WITH expected(
      relation_name,
      index_name,
      access_method,
      valid,
      ready,
      live,
      unique_index,
      immediate,
      primary_index,
      exclusion_index,
      nulls_not_distinct,
      predicate,
      expressions,
      definition
    ) AS (
      VALUES
        (
          'readiness_epoch_queue',
          'readiness_epoch_queue_pkey',
          'btree', true, true, true, true, true, true, false, false,
          NULL::text, NULL::text,
          'CREATE UNIQUE INDEX readiness_epoch_queue_pkey ON proof_indexer.readiness_epoch_queue USING btree (transaction_id)'
        ),
        (
          'readiness_epoch_shards',
          'readiness_epoch_shards_pkey',
          'btree', true, true, true, true, true, true, false, false,
          NULL::text, NULL::text,
          'CREATE UNIQUE INDEX readiness_epoch_shards_pkey ON proof_indexer.readiness_epoch_shards USING btree (network, shard)'
        )
    ), actual AS (
      SELECT
        relation.relname AS relation_name,
        index_relation.relname AS index_name,
        access_method.amname AS access_method,
        index_row.indisvalid AS valid,
        index_row.indisready AS ready,
        index_row.indislive AS live,
        index_row.indisunique AS unique_index,
        index_row.indimmediate AS immediate,
        index_row.indisprimary AS primary_index,
        index_row.indisexclusion AS exclusion_index,
        index_row.indnullsnotdistinct AS nulls_not_distinct,
        pg_catalog.pg_get_expr(
          index_row.indpred,
          index_row.indrelid
        ) AS predicate,
        pg_catalog.pg_get_expr(
          index_row.indexprs,
          index_row.indrelid
        ) AS expressions,
        pg_catalog.pg_get_indexdef(index_row.indexrelid) AS definition
      FROM pg_catalog.pg_index index_row
      JOIN pg_catalog.pg_class relation
        ON relation.oid = index_row.indrelid
      JOIN pg_catalog.pg_namespace namespace_row
        ON namespace_row.oid = relation.relnamespace
      JOIN pg_catalog.pg_class index_relation
        ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_am access_method
        ON access_method.oid = index_relation.relam
      WHERE namespace_row.nspname = 'proof_indexer'
        AND relation.relname IN (
          'readiness_epoch_queue',
          'readiness_epoch_shards'
        )
    ), drift AS (
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      UNION ALL
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    )
    SELECT 1 FROM drift
  ) THEN
    RAISE EXCEPTION 'Readiness epoch index contract is invalid';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = relation.relnamespace
    JOIN pg_catalog.pg_roles relation_owner
      ON relation_owner.oid = relation.relowner
    JOIN pg_catalog.pg_am access_method
      ON access_method.oid = relation.relam
    WHERE namespace_row.nspname = 'proof_indexer'
      AND relation.relname IN (
        'blocks',
        'credit_balances',
        'credit_definitions',
        'credit_listings',
        'events',
        'ledger_snapshots',
        'meta',
        'op_returns',
        'transactions',
        'tx_inputs',
        'tx_outputs',
        'work_amo_block_transitions',
        'work_amo_listing_terms',
        'work_amo_v6_listing_terms',
        'work_amo_v7_listing_terms',
        'work_amo_v8_listing_terms'
      )
      AND relation.relkind = 'r'
      AND relation.relpersistence = 'p'
      AND relation_owner.rolname = 'proof_indexer'
      AND access_method.amname = 'heap'
      AND relation.relrowsecurity = false
      AND relation.relforcerowsecurity = false
      AND relation.relhasrules = false
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_rewrite rewrite_row
        WHERE rewrite_row.ev_class = relation.oid
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_inherits inheritance_row
        WHERE inheritance_row.inhrelid = relation.oid
           OR inheritance_row.inhparent = relation.oid
      )
  ) <> 16 THEN
    RAISE EXCEPTION 'Readiness source relation contract is invalid';
  END IF;
  IF EXISTS (
    WITH expected(relation_name, constraint_type, definition) AS (
      VALUES
        (
          'readiness_epoch_queue',
          'c'::text,
          'CHECK (((shard >= 0) AND (shard < 64)))'
        ),
        (
          'readiness_epoch_queue',
          'p'::text,
          'PRIMARY KEY (transaction_id)'
        ),
        (
          'readiness_epoch_queue',
          't'::text,
          'TRIGGER DEFERRABLE INITIALLY DEFERRED'
        ),
        (
          'readiness_epoch_shards',
          'c'::text,
          'CHECK ((epoch >= 1))'
        ),
        (
          'readiness_epoch_shards',
          'c'::text,
          'CHECK (((shard >= 0) AND (shard < 64)))'
        ),
        (
          'readiness_epoch_shards',
          'p'::text,
          'PRIMARY KEY (network, shard)'
        )
    ), actual AS (
      SELECT
        relation.relname AS relation_name,
        constraint_row.contype::text AS constraint_type,
        constraint_row.convalidated,
        pg_catalog.pg_get_constraintdef(constraint_row.oid)
          AS definition
      FROM pg_catalog.pg_constraint constraint_row
      JOIN pg_catalog.pg_class relation
        ON relation.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace namespace_row
        ON namespace_row.oid = relation.relnamespace
      WHERE namespace_row.nspname = 'proof_indexer'
        AND relation.relname IN (
          'readiness_epoch_queue',
          'readiness_epoch_shards'
        )
    )
    SELECT 1
    WHERE (SELECT count(*) FROM actual) <> 6
       OR EXISTS (
         SELECT 1
         FROM expected
         LEFT JOIN actual USING (
           relation_name,
           constraint_type,
           definition
         )
         WHERE actual.relation_name IS NULL
            OR actual.convalidated IS DISTINCT FROM true
       )
  ) THEN
    RAISE EXCEPTION 'Readiness epoch constraints are invalid';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
      'proof_indexer',
      'proof_indexer.readiness_epoch_shards',
      'SELECT'
    ) OR NOT pg_catalog.has_table_privilege(
      'proof_indexer',
      'proof_indexer.readiness_epoch_queue',
      'SELECT'
    ) OR pg_catalog.has_table_privilege(
      'proof_indexer',
      'proof_indexer.readiness_epoch_shards',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) OR pg_catalog.has_table_privilege(
      'proof_indexer',
      'proof_indexer.readiness_epoch_queue',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) OR pg_catalog.has_any_column_privilege(
      'proof_indexer',
      'proof_indexer.readiness_epoch_shards',
      'INSERT,UPDATE,REFERENCES'
    ) OR pg_catalog.has_any_column_privilege(
      'proof_indexer',
      'proof_indexer.readiness_epoch_queue',
      'INSERT,UPDATE,REFERENCES'
    ) THEN
    RAISE EXCEPTION 'Readiness epoch table privileges are invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) privilege
    WHERE namespace_row.nspname = 'proof_indexer'
      AND relation.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
      AND (
        privilege.grantee = 0
        OR (
          privilege.grantee <> relation.relowner
          AND privilege.privilege_type IN (
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
          )
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute attribute_row
    JOIN pg_catalog.pg_class relation
      ON relation.oid = attribute_row.attrelid
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      attribute_row.attacl
    ) privilege
    WHERE namespace_row.nspname = 'proof_indexer'
      AND relation.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
      AND attribute_row.attnum > 0
      AND attribute_row.attisdropped = false
      AND (
        privilege.grantee = 0
        OR (
          privilege.grantee <> relation.relowner
          AND privilege.privilege_type IN (
            'INSERT',
            'UPDATE',
            'REFERENCES'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Readiness epoch ACL contract is invalid';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) privilege
    WHERE namespace_row.nspname = 'proof_indexer'
      AND relation.relname IN (
        'readiness_epoch_queue',
        'readiness_epoch_shards'
      )
      AND privilege.grantee = 'proof_indexer'::regrole
      AND privilege.privilege_type = 'SELECT'
      AND privilege.is_grantable = false
  ) <> 2 THEN
    RAISE EXCEPTION 'Readiness epoch SELECT grants are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc function_row
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = function_row.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) privilege
    WHERE namespace_row.nspname = 'proof_indexer'
      AND function_row.proname IN (
        'commit_livenet_readiness_epoch',
        'enqueue_livenet_readiness_epoch',
        'enqueue_livenet_readiness_epoch_for_meta'
      )
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee NOT IN (
        function_row.proowner,
        'proof_indexer'::regrole
      )
  ) OR (
    SELECT count(*)
    FROM pg_catalog.pg_proc function_row
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = function_row.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) privilege
    WHERE namespace_row.nspname = 'proof_indexer'
      AND function_row.proname IN (
        'commit_livenet_readiness_epoch',
        'enqueue_livenet_readiness_epoch',
        'enqueue_livenet_readiness_epoch_for_meta'
      )
      AND privilege.grantee = 'proof_indexer'::regrole
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.is_grantable = false
  ) <> 3 THEN
    RAISE EXCEPTION 'Readiness epoch function ACL contract is invalid';
  END IF;
END;
$$;

COMMIT;
