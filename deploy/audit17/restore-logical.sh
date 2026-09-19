#!/usr/bin/env bash
# Isolated data/schema restore verification; never connects to the live socket.
# Run as postgres inside the bounded transient unit documented in the runbook.
set -Eeuo pipefail
umask 077
mode="${1:---plan}"
run_id="${2:-}"
if [[ ! "${mode}" =~ ^(--plan|--apply)$ || ! "${run_id}" =~ ^[0-9]{8}T[0-9]{6}Z$ || $# -gt 2 ]]; then
  echo 'Usage: restore-logical.sh --plan|--apply YYYYMMDDTHHMMSSZ' >&2
  exit 64
fi
backup=/data/proofofwork-postgres-backups/logical/proof_indexer-20260919T031850Z.dumpset
job="/data/proofofwork-audit17-restore-${run_id}"
bin=/usr/lib/postgresql/16/bin
floor=107374182400
maximum=85899345920
printf 'restore_plan source=%s isolated_root=%s data_floor_bytes=%s maximum_job_bytes=%s listen_addresses=none port=55432 scope=data-schema-no-owner-no-acl-no-tablespaces\n' "${backup}" "${job}" "${floor}" "${maximum}"
[[ "${mode}" == --apply ]] || exit 0
if [[ "${EUID}" != "$(id -u postgres)" ]]; then
  echo 'The isolated restore must run as postgres.' >&2; exit 77
fi
for directory in "${backup}" "${job}"; do
  [[ -d "${directory}" && ! -L "${directory}" && "$(realpath -e "${directory}")" == "${directory}" ]]
  [[ "$(stat -c %u "${directory}")" == "${EUID}" ]]
  (( (8#$(stat -c %a "${directory}") & 07022) == 0 ))
done
[[ -z "$(find "${job}" -mindepth 1 -maxdepth 1 -print -quit)" ]]
for member in proof_indexer.dump globals.sql SHA256SUMS; do
  [[ -f "${backup}/${member}" && ! -L "${backup}/${member}" ]]
done
[[ "$(stat -c %s "${backup}/proof_indexer.dump")" == 15890347429 ]]
expected_checksums=$'cc465d73c1465eac4a11065b174d2733710abf11d18d4e62e10a9ceae60fa262  proof_indexer.dump\nbe2dbe2e9cd6454aefef03ddeba79581bbcee43c9a13152357ac83e4c3215c6c  globals.sql'
[[ "$(cat "${backup}/SHA256SUMS")" == "${expected_checksums}" ]]
exec {backup_lock}</data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock
flock --shared --nonblock "${backup_lock}"
available=$(df -B1 --output=avail /data | tail -1 | tr -d ' ')
(( available >= floor + maximum ))
(( $(df -B1 --output=avail / | tail -1 | tr -d ' ') >= 10737418240 ))
(
  cd "${backup}"
  # Suppress globals contents: this file can contain role password hashes.
  timeout 10m sha256sum --check --strict SHA256SUMS
) >"${job}/backup-checksums.txt"
"${bin}/pg_restore" --list "${backup}/proof_indexer.dump" >"${job}/restore-toc.txt"
mkdir -m 0700 "${job}/socket"
"${bin}/initdb" --pgdata="${job}/cluster" --encoding=UTF8 --locale=en_US.UTF-8 \
  --auth-local=trust --auth-host=reject --data-checksums >"${job}/initdb.log"
cat >>"${job}/cluster/postgresql.conf" <<EOF
listen_addresses = ''
port = 55432
unix_socket_directories = '${job}/socket'
unix_socket_permissions = 0700
shared_buffers = '128MB'
work_mem = '16MB'
maintenance_work_mem = '128MB'
max_connections = 10
max_worker_processes = 2
max_parallel_workers = 0
archive_mode = off
logging_collector = off
EOF
export PGHOST="${job}/socket" PGPORT=55432 PGUSER=postgres PGDATABASE=proof_indexer
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS
started=0
monitor_pid=''
cleanup() {
  [[ -z "${monitor_pid}" ]] || kill "${monitor_pid}" 2>/dev/null || true
  if (( started )); then
    "${bin}/pg_ctl" --pgdata="${job}/cluster" --mode=fast --wait --timeout=60 stop >>"${job}/cluster-control.log" 2>&1 || true
  fi
  # Retain this entire newly created job and evidence; no existing data removal.
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
"${bin}/pg_ctl" --pgdata="${job}/cluster" --log="${job}/postgres.log" --wait --timeout=30 start >"${job}/cluster-control.log"
started=1
owner_pid=$$
(
  while sleep 5; do
    used=$(du -s -B1 "${job}" | cut -f1)
    available=$(df -B1 --output=avail /data | tail -1 | tr -d ' ')
    if (( used > maximum || available < floor )); then
      printf 'restore_resource_bound used=%s available=%s\n' "${used}" "${available}" >"${job}/resource-bound.txt"
      # Stop this isolated cluster directly: a shell can defer its TERM trap
      # while pg_restore is a foreground child.
      "${bin}/pg_ctl" --pgdata="${job}/cluster" --mode=fast --wait --timeout=60 stop >>"${job}/cluster-control.log" 2>&1 || true
      kill -TERM "${owner_pid}"
      exit
    fi
  done
) &
monitor_pid=$!
"${bin}/createdb" --template=template0 --encoding=UTF8 --locale=en_US.UTF-8 proof_indexer
# Globals and production tablespace paths are deliberately not executed.
timeout --signal=TERM --kill-after=60s 55m "${bin}/pg_restore" \
  --dbname=proof_indexer --exit-on-error --no-owner --no-privileges --no-tablespaces \
  "${backup}/proof_indexer.dump" >"${job}/restore.log" 2>&1
"${bin}/psql" -X -qAt -v ON_ERROR_STOP=1 >"${job}/restored-schema-evidence.json" <<'SQL'
SET statement_timeout='120s';
SELECT jsonb_build_object(
  'database',current_database(), 'socket',current_setting('unix_socket_directories'),
  'listenAddresses',current_setting('listen_addresses'), 'port',current_setting('port'),
  'dataDirectory',current_setting('data_directory'), 'databaseBytes',pg_database_size(current_database()),
  'invalidIndexes',(SELECT count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready),
  'unvalidatedConstraints',(SELECT count(*) FROM pg_constraint WHERE NOT convalidated),
  'transactions',(SELECT count(*) FROM proof_indexer.transactions),
  'events',(SELECT count(*) FROM proof_indexer.events),
  'creditDefinitions',(SELECT count(*) FROM proof_indexer.credit_definitions),
  'creditBalances',(SELECT count(*) FROM proof_indexer.credit_balances),
  'ledgerSnapshots',(SELECT count(*) FROM proof_indexer.ledger_snapshots),
  'transitions',(SELECT count(*) FROM proof_indexer.work_amo_block_transitions));
SQL
python3 -I - "${job}/restored-schema-evidence.json" "${job}" <<'PY'
import json,sys
row=json.load(open(sys.argv[1])); root=sys.argv[2]
assert row['database']=='proof_indexer' and row['listenAddresses']=='' and row['port']=='55432'
assert row['socket']==root+'/socket' and row['dataDirectory']==root+'/cluster'
assert row['invalidIndexes']==0 and row['unvalidatedConstraints']==0
assert row['events']>0 and row['transactions']>0 and row['transitions']>0
PY
"${bin}/pg_ctl" --pgdata="${job}/cluster" --mode=fast --wait --timeout=60 stop >>"${job}/cluster-control.log"
started=0
timeout 15m "${bin}/pg_checksums" --check --pgdata="${job}/cluster" >"${job}/page-checksums.txt" 2>&1
printf 'restore_check status=passed isolated_root=%s scope=data-schema-and-page-checksums global_roles_grants=not-restored production_tablespaces=not-used\n' "${job}"
