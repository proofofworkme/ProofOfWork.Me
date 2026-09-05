#!/usr/bin/env bash
# Creation-only audit safeguard. Run as postgres in the reviewed bounded unit.
# The one argument is a fresh UTC timestamp: YYYYMMDDTHHMMSSZ.
set -Eeuo pipefail
umask 077
run_id="${1:-}"
[[ "${run_id}" =~ ^[0-9]{8}T[0-9]{6}Z$ && $# == 1 ]]
[[ "${EUID}" == "$(id -u postgres)" ]]
safeguard="/data/proofofwork-audit5-safeguard-${run_id}"
[[ -d "${safeguard}" && ! -L "${safeguard}" && "$(realpath -e "${safeguard}")" == "${safeguard}" ]]
[[ "$(stat -c %u "${safeguard}")" == "${EUID}" && "$(stat -c %a "${safeguard}")" == 700 ]]
[[ -z "$(find "${safeguard}" -mindepth 1 -maxdepth 1 -print -quit)" ]]
exec {backup_lock}</data/proofofwork-postgres-backups/logical/.proofofwork-postgres-logical-backup.lock
flock --exclusive --nonblock "${backup_lock}"
floor=107374182400
maximum=42949672960
available=$(df -B1 --output=avail /data | tail -1 | tr -d ' ')
(( available >= floor + maximum ))
export PGHOST=/var/run/postgresql PGPORT=5432 PGUSER=postgres PGDATABASE=proof_indexer
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS
pg_dump --version >"${safeguard}/version.txt"
date -u +%Y-%m-%dT%H:%M:%SZ >"${safeguard}/started-at.txt"
child_pid=''
monitor_pid=''
cleanup() {
  [[ -z "${monitor_pid}" ]] || kill "${monitor_pid}" 2>/dev/null || true
  [[ -z "${child_pid}" ]] || kill -TERM "${child_pid}" 2>/dev/null || true
  # Never remove backup files automatically, including a failed safeguard.
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
pg_dump --dbname=proof_indexer --format=custom --compress=gzip:6 --file="${safeguard}/proof_indexer.dump" &
child_pid=$!
(
  while sleep 5; do
    used=$(du -s -B1 "${safeguard}" | cut -f1)
    available=$(df -B1 --output=avail /data | tail -1 | tr -d ' ')
    if (( used > maximum || available < floor )); then
      printf 'safeguard_resource_bound used=%s available=%s\n' "${used}" "${available}" >"${safeguard}/resource-bound.txt"
      kill -TERM "${child_pid}"
      exit
    fi
  done
) &
monitor_pid=$!
wait "${child_pid}"
child_pid=''
kill "${monitor_pid}" 2>/dev/null || true
wait "${monitor_pid}" 2>/dev/null || true
monitor_pid=''
pg_dumpall --globals-only --file="${safeguard}/globals.sql"
pg_restore --list "${safeguard}/proof_indexer.dump" >"${safeguard}/restore-toc.txt"
test -s "${safeguard}/globals.sql"
(
  cd "${safeguard}"
  sha256sum proof_indexer.dump globals.sql >SHA256SUMS
  sha256sum --check --strict SHA256SUMS
) >"${safeguard}/checksum-verification.txt"
date -u +%Y-%m-%dT%H:%M:%SZ >"${safeguard}/completed-at.txt"
for member in proof_indexer.dump globals.sql SHA256SUMS; do sync -f "${safeguard}/${member}"; done
sync -f "${safeguard}"
printf 'safeguard_backup status=verified path=%s dump_bytes=%s retention=none\n' "${safeguard}" "$(stat -c %s "${safeguard}/proof_indexer.dump")"
