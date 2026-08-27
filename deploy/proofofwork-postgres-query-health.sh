#!/usr/bin/env bash
set -Eeuo pipefail

database="${POW_POSTGRES_HEALTH_DATABASE:-proof_indexer}"
warn_fanout="${POW_POSTGRES_WARN_QUERY_FANOUT:-4}"
critical_fanout="${POW_POSTGRES_CRITICAL_QUERY_FANOUT:-8}"
warn_age_seconds="${POW_POSTGRES_WARN_QUERY_AGE_SECONDS:-20}"
critical_age_seconds="${POW_POSTGRES_CRITICAL_QUERY_AGE_SECONDS:-60}"
warn_connections="${POW_POSTGRES_WARN_CONNECTIONS:-70}"
critical_connections="${POW_POSTGRES_CRITICAL_CONNECTIONS:-90}"
warn_lock_wait_seconds="${POW_POSTGRES_WARN_LOCK_WAIT_SECONDS:-5}"
critical_lock_wait_seconds="${POW_POSTGRES_CRITICAL_LOCK_WAIT_SECONDS:-20}"
warn_idle_transaction_seconds="${POW_POSTGRES_WARN_IDLE_TRANSACTION_SECONDS:-5}"
critical_idle_transaction_seconds="${POW_POSTGRES_CRITICAL_IDLE_TRANSACTION_SECONDS:-20}"
tablespace_name="proof_indexer_large_state_v1"
tablespace_path="/data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1"

if [[ ! "${database}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "PostgreSQL health database name is invalid." >&2
  exit 64
fi
for value in \
  "${warn_fanout}" \
  "${critical_fanout}" \
  "${warn_age_seconds}" \
  "${critical_age_seconds}" \
  "${warn_connections}" \
  "${critical_connections}" \
  "${warn_lock_wait_seconds}" \
  "${critical_lock_wait_seconds}" \
  "${warn_idle_transaction_seconds}" \
  "${critical_idle_transaction_seconds}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 1)); then
    echo "PostgreSQL query-health thresholds must be positive integers." >&2
    exit 64
  fi
done
if ((warn_fanout >= critical_fanout)) ||
  ((warn_age_seconds >= critical_age_seconds)) ||
  ((warn_connections >= critical_connections)) ||
  ((warn_lock_wait_seconds >= critical_lock_wait_seconds)) ||
  ((warn_idle_transaction_seconds >= critical_idle_transaction_seconds)); then
  echo "PostgreSQL warning thresholds must be lower than critical thresholds." >&2
  exit 64
fi

metrics="$(/usr/bin/psql \
  --dbname="${database}" \
  --no-psqlrc \
  --quiet \
  --tuples-only \
  --no-align \
  --field-separator='|' \
  --set=ON_ERROR_STOP=1 \
  --command="
    SET statement_timeout = '5s';
    WITH all_client_sessions AS (
      SELECT
        datname,
        state,
        query_start,
        xact_start,
        wait_event_type,
        COALESCE(query_id::text, md5(COALESCE(query, ''))) AS fingerprint
      FROM pg_stat_activity
      WHERE backend_type = 'client backend'
        AND pid <> pg_backend_pid()
    ),
    scoped_sessions AS (
      SELECT *
      FROM all_client_sessions
      WHERE datname = current_database()
    ),
    fanout AS (
      SELECT COUNT(*)::bigint AS active_count
      FROM scoped_sessions
      WHERE state = 'active'
      GROUP BY fingerprint
    )
    SELECT
      (SELECT COUNT(*)::bigint FROM all_client_sessions),
      COUNT(*) FILTER (WHERE state = 'active')::bigint,
      COALESCE(
        EXTRACT(EPOCH FROM (clock_timestamp() - MIN(query_start) FILTER (WHERE state = 'active')))::bigint,
        0
      ),
      COALESCE((SELECT MAX(active_count) FROM fanout), 0),
      COUNT(*) FILTER (WHERE wait_event_type = 'Lock')::bigint,
      COALESCE(
        EXTRACT(EPOCH FROM (
          clock_timestamp() - MIN(query_start)
            FILTER (WHERE wait_event_type = 'Lock')
        ))::bigint,
        0
      ),
      COUNT(*) FILTER (
        WHERE state LIKE 'idle in transaction%'
      )::bigint,
      COALESCE(
        EXTRACT(EPOCH FROM (
          clock_timestamp() - MIN(xact_start)
            FILTER (WHERE state LIKE 'idle in transaction%')
        ))::bigint,
        0
      )::bigint
    FROM scoped_sessions;
  ")"

IFS='|' read -r total_connections active_queries oldest_query_seconds max_same_query lock_waiters oldest_lock_wait_seconds idle_in_transaction oldest_idle_transaction_seconds <<<"${metrics}"
for value in \
  "${total_connections}" \
  "${active_queries}" \
  "${oldest_query_seconds}" \
  "${max_same_query}" \
  "${lock_waiters}" \
  "${oldest_lock_wait_seconds}" \
  "${idle_in_transaction}" \
  "${oldest_idle_transaction_seconds}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
    echo "PostgreSQL query-health metrics were not parseable." >&2
    exit 65
  fi
done

placement_metrics="$(/usr/bin/psql \
  --dbname="${database}" \
  --no-psqlrc \
  --quiet \
  --tuples-only \
  --no-align \
  --field-separator='|' \
  --set=ON_ERROR_STOP=1 \
  --command="
    SET statement_timeout = '5s';
    WITH target AS (
      SELECT
        oid,
        spcowner,
        pg_tablespace_location(oid) AS location
      FROM pg_tablespace
      WHERE spcname = 'proof_indexer_large_state_v1'
    ),
    expected_parents(relname) AS (
      VALUES
        ('ledger_snapshots'::name),
        ('work_amo_block_transitions'::name)
    ),
    parents AS (
      SELECT
        relation.oid,
        relation.relkind,
        relation.relpersistence,
        relation.relowner,
        relation.reltoastrelid
      FROM pg_class relation
      JOIN pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      JOIN expected_parents expected
        ON expected.relname = relation.relname
      WHERE namespace.nspname = 'proof_indexer'
    ),
    toasts AS (
      SELECT toast.oid
      FROM parents parent
      JOIN pg_class toast
        ON toast.oid = parent.reltoastrelid
    ),
    base_relations AS (
      SELECT oid FROM parents
      UNION ALL
      SELECT oid FROM toasts
    ),
    indexes AS (
      SELECT
        index_row.indexrelid AS oid,
        index_row.indisvalid,
        index_row.indisready
      FROM pg_index index_row
      JOIN base_relations base
        ON base.oid = index_row.indrelid
    ),
    closure AS (
      SELECT oid FROM base_relations
      UNION ALL
      SELECT oid FROM indexes
    ),
    owned_sequences AS (
      SELECT DISTINCT sequence.oid
      FROM parents parent
      JOIN pg_depend dependency
        ON dependency.classid = 'pg_class'::regclass
       AND dependency.refclassid = 'pg_class'::regclass
       AND dependency.refobjid = parent.oid
       AND dependency.deptype IN ('a', 'i')
      JOIN pg_class sequence
        ON sequence.oid = dependency.objid
       AND sequence.relkind = 'S'
    )
    SELECT
      (SELECT count(*)::bigint FROM target),
      (
        SELECT count(*)::bigint
        FROM target
        WHERE pg_get_userbyid(spcowner) = 'postgres'
          AND location =
            '/data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1'
          AND NOT has_tablespace_privilege(
            'proof_indexer',
            oid,
            'CREATE'
          )
      ),
      (SELECT count(*)::bigint FROM parents),
      (
        SELECT count(*)::bigint
        FROM parents
        WHERE relkind = 'r'
          AND relpersistence = 'p'
          AND reltoastrelid <> 0
          AND pg_get_userbyid(relowner) = 'proof_indexer'
      ),
      (SELECT count(*)::bigint FROM toasts),
      (SELECT count(*)::bigint FROM closure),
      (
        SELECT count(*)::bigint
        FROM closure expected
        JOIN pg_class relation
          ON relation.oid = expected.oid
        JOIN target
          ON target.oid = relation.reltablespace
      ),
      (SELECT count(*)::bigint FROM indexes),
      (
        SELECT count(*)::bigint
        FROM indexes
        WHERE indisvalid IS DISTINCT FROM true
           OR indisready IS DISTINCT FROM true
      ),
      (
        SELECT count(*)::bigint
        FROM pg_class relation
        JOIN target
          ON target.oid = relation.reltablespace
        LEFT JOIN closure expected
          ON expected.oid = relation.oid
        WHERE expected.oid IS NULL
      ),
      (SELECT count(*)::bigint FROM owned_sequences),
      COALESCE(
        (SELECT sum(pg_total_relation_size(oid))::bigint FROM parents),
        0
      );
  ")"

IFS='|' read -r tablespace_count tablespace_identity_ready parent_count parent_shape_ready toast_count closure_count placed_count index_count invalid_index_count unrelated_count owned_sequence_count placed_bytes <<<"${placement_metrics}"
for value in \
  "${tablespace_count}" \
  "${tablespace_identity_ready}" \
  "${parent_count}" \
  "${parent_shape_ready}" \
  "${toast_count}" \
  "${closure_count}" \
  "${placed_count}" \
  "${index_count}" \
  "${invalid_index_count}" \
  "${unrelated_count}" \
  "${owned_sequence_count}" \
  "${placed_bytes}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
    echo "PostgreSQL tablespace-health metrics were not parseable." >&2
    exit 65
  fi
done

printf 'postgres database=%s cluster_client_connections=%s active=%s oldest_active_seconds=%s max_same_query_fanout=%s lock_waiters=%s oldest_lock_wait_seconds=%s idle_in_transaction=%s oldest_idle_transaction_seconds=%s\n' \
  "${database}" \
  "${total_connections}" \
  "${active_queries}" \
  "${oldest_query_seconds}" \
  "${max_same_query}" \
  "${lock_waiters}" \
  "${oldest_lock_wait_seconds}" \
  "${idle_in_transaction}" \
  "${oldest_idle_transaction_seconds}"

printf 'postgres_storage database=%s tablespace=%s location=%s parents=%s toasts=%s indexes=%s closure=%s placed=%s bytes=%s invalid_indexes=%s unrelated=%s owned_sequences=%s\n' \
  "${database}" \
  "${tablespace_name}" \
  "${tablespace_path}" \
  "${parent_count}" \
  "${toast_count}" \
  "${index_count}" \
  "${closure_count}" \
  "${placed_count}" \
  "${placed_bytes}" \
  "${invalid_index_count}" \
  "${unrelated_count}" \
  "${owned_sequence_count}"

if ((tablespace_count != 1)) ||
  ((tablespace_identity_ready != 1)) ||
  ((parent_count != 2)) ||
  ((parent_shape_ready != 2)) ||
  ((toast_count != 2)) ||
  ((closure_count != 17)) ||
  ((placed_count != 17)) ||
  ((index_count != 13)) ||
  ((invalid_index_count != 0)) ||
  ((unrelated_count != 0)) ||
  ((owned_sequence_count != 0)) ||
  ((placed_bytes < 1)); then
  echo "CRITICAL PostgreSQL large-state tablespace placement differs." >&2
  exit 2
fi

if ((max_same_query >= critical_fanout)) ||
  ((oldest_query_seconds >= critical_age_seconds)) ||
  ((total_connections >= critical_connections)) ||
  ((oldest_lock_wait_seconds >= critical_lock_wait_seconds)) ||
  ((oldest_idle_transaction_seconds >= critical_idle_transaction_seconds)); then
  echo "CRITICAL PostgreSQL query contention threshold breached." >&2
  exit 2
fi
if ((max_same_query >= warn_fanout)) ||
  ((oldest_query_seconds >= warn_age_seconds)) ||
  ((total_connections >= warn_connections)) ||
  ((oldest_lock_wait_seconds >= warn_lock_wait_seconds)) ||
  ((oldest_idle_transaction_seconds >= warn_idle_transaction_seconds)); then
  echo "WARNING PostgreSQL query contention is elevated." >&2
  exit 1
fi
