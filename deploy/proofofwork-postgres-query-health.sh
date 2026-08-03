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
  "${critical_lock_wait_seconds}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 1)); then
    echo "PostgreSQL query-health thresholds must be positive integers." >&2
    exit 64
  fi
done
if ((warn_fanout >= critical_fanout)) ||
  ((warn_age_seconds >= critical_age_seconds)) ||
  ((warn_connections >= critical_connections)) ||
  ((warn_lock_wait_seconds >= critical_lock_wait_seconds)); then
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
      )::bigint
    FROM scoped_sessions;
  ")"

IFS='|' read -r total_connections active_queries oldest_query_seconds max_same_query lock_waiters oldest_lock_wait_seconds idle_in_transaction <<<"${metrics}"
for value in \
  "${total_connections}" \
  "${active_queries}" \
  "${oldest_query_seconds}" \
  "${max_same_query}" \
  "${lock_waiters}" \
  "${oldest_lock_wait_seconds}" \
  "${idle_in_transaction}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
    echo "PostgreSQL query-health metrics were not parseable." >&2
    exit 65
  fi
done

printf 'postgres database=%s cluster_client_connections=%s active=%s oldest_active_seconds=%s max_same_query_fanout=%s lock_waiters=%s oldest_lock_wait_seconds=%s idle_in_transaction=%s\n' \
  "${database}" \
  "${total_connections}" \
  "${active_queries}" \
  "${oldest_query_seconds}" \
  "${max_same_query}" \
  "${lock_waiters}" \
  "${oldest_lock_wait_seconds}" \
  "${idle_in_transaction}"

if ((max_same_query >= critical_fanout)) ||
  ((oldest_query_seconds >= critical_age_seconds)) ||
  ((total_connections >= critical_connections)) ||
  ((oldest_lock_wait_seconds >= critical_lock_wait_seconds)); then
  echo "CRITICAL PostgreSQL query contention threshold breached." >&2
  exit 2
fi
if ((max_same_query >= warn_fanout)) ||
  ((oldest_query_seconds >= warn_age_seconds)) ||
  ((total_connections >= warn_connections)) ||
  ((oldest_lock_wait_seconds >= warn_lock_wait_seconds)) ||
  ((idle_in_transaction > 0)); then
  echo "WARNING PostgreSQL query contention is elevated." >&2
  exit 1
fi
