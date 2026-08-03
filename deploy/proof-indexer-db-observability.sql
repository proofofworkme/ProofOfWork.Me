CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

COMMENT ON EXTENSION pg_stat_statements IS
  'Operator-only normalized query telemetry for the ProofOfWork read model';

DO $$
DECLARE
  extension_oid oid;
  function_row record;
  relation_row record;
BEGIN
  SELECT oid INTO extension_oid
  FROM pg_catalog.pg_extension
  WHERE extname = 'pg_stat_statements';
  IF extension_oid IS NULL THEN
    RAISE EXCEPTION 'pg_stat_statements extension is unavailable';
  END IF;

  FOR function_row IN
    SELECT procedure_row.oid
    FROM pg_catalog.pg_proc procedure_row
    JOIN pg_catalog.pg_depend dependency
      ON dependency.classid = 'pg_catalog.pg_proc'::regclass
     AND dependency.objid = procedure_row.oid
     AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
     AND dependency.refobjid = extension_oid
     AND dependency.deptype = 'e'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',
      function_row.oid::regprocedure
    );
  END LOOP;

  FOR relation_row IN
    SELECT namespace_row.nspname, relation.oid, relation.relname
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace_row
      ON namespace_row.oid = relation.relnamespace
    JOIN pg_catalog.pg_depend dependency
      ON dependency.classid = 'pg_catalog.pg_class'::regclass
     AND dependency.objid = relation.oid
     AND dependency.refclassid = 'pg_catalog.pg_extension'::regclass
     AND dependency.refobjid = extension_oid
     AND dependency.deptype = 'e'
    WHERE relation.relkind IN ('r', 'v', 'm')
  LOOP
    EXECUTE format(
      'REVOKE SELECT ON %I.%I FROM PUBLIC',
      relation_row.nspname,
      relation_row.relname
    );
  END LOOP;
END;
$$;
