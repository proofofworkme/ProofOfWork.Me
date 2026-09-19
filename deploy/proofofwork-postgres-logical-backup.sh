#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
mode="${1:---apply}"
[[ $# -le 1 && ( "${mode}" == --apply || "${mode}" == --check-capacity ) ]] || {
  echo 'Usage: proofofwork-postgres-logical-backup [--apply|--check-capacity]' >&2; exit 64;
}

backup_root="/data/proofofwork-postgres-backups/logical"
keep=7
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
basename="proof_indexer-${timestamp}.dumpset"
temporary_set="${backup_root}/.${basename}.tmp"
final_set="${backup_root}/${basename}"
retention_listing=""
temporary_set_identity=""
backup_lock="${backup_root}/.proofofwork-postgres-logical-backup.lock"
minimum_free_bytes="${POW_POSTGRES_BACKUP_MIN_FREE_BYTES:-107374182400}"
monitor_pid=''
dump_pid=''
[[ "${minimum_free_bytes}" =~ ^[0-9]{1,15}$ ]] && ((minimum_free_bytes >= 10737418240)) || {
  echo 'Backup reserve must be an integer of at least 10 GiB.' >&2; exit 64;
}

cleanup() {
  [[ -z "${monitor_pid}" ]] || kill "${monitor_pid}" 2>/dev/null || true
  [[ -z "${dump_pid}" ]] || kill -TERM "${dump_pid}" 2>/dev/null || true
  if [[ -n "${temporary_set_identity}" ]]; then
    printf 'backup_incomplete retained_path=%s identity=%s review_required=true\n' "${temporary_set}" "${temporary_set_identity}" >&2
  fi
  # This invocation's empty inventory scratch file is independent of backup data.
  if [[ -n "${retention_listing}" ]]; then rm -f -- "${retention_listing}"; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

if [[ ! -d "${backup_root}" || -L "${backup_root}" ]]; then
  echo "Backup root must be a real directory: ${backup_root}" >&2
  exit 1
fi
if [[ "$(realpath -e "${backup_root}")" != "${backup_root}" ]]; then
  echo "Backup root resolved outside its canonical path." >&2
  exit 1
fi
backup_root_mode="$(stat --format=%a -- "${backup_root}")"
backup_root_owner="$(stat --format=%u -- "${backup_root}")"
if [[ "${backup_root_owner}" != "${EUID}" ]] ||
  ((8#${backup_root_mode} & 07022)); then
  echo "Backup root must be owner-controlled and not group/world writable." >&2
  exit 1
fi
if [[ -e "${backup_lock}" || -L "${backup_lock}" ]]; then
  if [[ ! -f "${backup_lock}" || -L "${backup_lock}" ||
    "$(realpath -e -- "${backup_lock}" 2>/dev/null || true)" != "${backup_lock}" ||
    "$(stat --format=%u -- "${backup_lock}")" != "${EUID}" ]] ||
    ((8#$(stat --format=%a -- "${backup_lock}") & 07022)); then
    echo "Logical-backup lock must be a canonical owner-controlled regular file." >&2
    exit 1
  fi
fi
exec {backup_lock_fd}>"${backup_lock}"
chmod 0600 "${backup_lock}"
if ! /usr/bin/flock --exclusive --nonblock "${backup_lock_fd}"; then
  echo "Another logical backup operation holds ${backup_lock}." >&2
  exit 1
fi
if [[ -e "${temporary_set}" || -e "${final_set}" ]]; then
  echo "Backup set already exists: ${basename}" >&2
  exit 1
fi

# Reserve the current database size plus 10% and 1 GiB overhead. Never start a dump that spends live-data reserve.
database_bytes="$(/usr/bin/psql -X -qAt -v ON_ERROR_STOP=1 --dbname=proof_indexer --command="SET statement_timeout='10s'; SELECT pg_database_size(current_database());")"
[[ "${database_bytes}" =~ ^[0-9]{1,15}$ ]] || { echo 'Invalid database-size measurement.' >&2; exit 1; }
maximum_dump_bytes=$((database_bytes * 11 / 10 + 1073741824))
available_bytes="$(LC_ALL=C /usr/bin/df -B1 --output=avail "${backup_root}" | /usr/bin/tail -1 | /usr/bin/tr -d ' ')"
[[ "${available_bytes}" =~ ^[0-9]{1,15}$ ]] || exit 1
printf 'backup_capacity available_bytes=%s reserve_bytes=%s maximum_dump_bytes=%s\n' "${available_bytes}" "${minimum_free_bytes}" "${maximum_dump_bytes}"
if ((available_bytes < minimum_free_bytes + maximum_dump_bytes)); then
  echo 'CRITICAL logical backup refused: live-data reserve would be at risk.' >&2
  exit 2
fi
[[ "${mode}" != --check-capacity ]] || exit 0
/usr/bin/mkdir --mode=0700 "${temporary_set}"
temporary_set_identity="$(stat --format='%d:%i' -- "${temporary_set}")"
/usr/bin/pg_dump \
  --dbname=proof_indexer \
  --format=custom \
  --compress=gzip:6 \
  --file="${temporary_set}/proof_indexer.dump" &
dump_pid=$!
(
  while sleep 5; do
    available="$(LC_ALL=C /usr/bin/df -B1 --output=avail "${backup_root}" | /usr/bin/tail -1 | /usr/bin/tr -d ' ')"
    size="$(/usr/bin/stat -c %s "${temporary_set}/proof_indexer.dump" 2>/dev/null || echo 0)"
    if [[ ! "${available}" =~ ^[0-9]{1,15}$ || ! "${size}" =~ ^[0-9]{1,15}$ ]] ||
      ((available < minimum_free_bytes || size > maximum_dump_bytes)); then
      printf 'CRITICAL backup capacity bound reached; preserving incomplete set %s\n' "${temporary_set}" >&2
      kill -TERM "${dump_pid}" 2>/dev/null || true
      exit
    fi
  done
) &
monitor_pid=$!
dump_status=0
wait "${dump_pid}" || dump_status=$?
dump_pid=''
kill "${monitor_pid}" 2>/dev/null || true
wait "${monitor_pid}" 2>/dev/null || true
monitor_pid=''
((dump_status == 0)) || exit "${dump_status}"
/usr/bin/pg_dumpall \
  --globals-only \
  --file="${temporary_set}/globals.sql"
/usr/bin/pg_restore --list "${temporary_set}/proof_indexer.dump" >/dev/null
/usr/bin/test -s "${temporary_set}/globals.sql"

(
  cd "${temporary_set}"
  /usr/bin/sha256sum proof_indexer.dump globals.sql >SHA256SUMS
  /usr/bin/sha256sum --check --strict SHA256SUMS >/dev/null
)
/usr/bin/sync -f "${temporary_set}/proof_indexer.dump"
/usr/bin/sync -f "${temporary_set}/globals.sql"
/usr/bin/sync -f "${temporary_set}/SHA256SUMS"
/usr/bin/sync -f "${temporary_set}"
/usr/bin/mv -- "${temporary_set}" "${final_set}"
temporary_set_identity=""
/usr/bin/sync -f "${backup_root}"

retention_listing="$(
  /usr/bin/mktemp \
    --tmpdir="${backup_root}" \
    ".${basename}.retention.XXXXXX"
)"
if ! /usr/bin/find "${backup_root}" -maxdepth 1 -mindepth 1 -type d \
  -name 'proof_indexer-*.dumpset' -printf '%T@ %f\0' |
  /usr/bin/sort -z -nr >"${retention_listing}"; then
  echo "Unable to enumerate logical backup retention safely." >&2
  exit 1
fi
mapfile -d '' -t backups <"${retention_listing}"
/usr/bin/rm -f -- "${retention_listing}"
retention_listing=""
for ((index = keep; index < ${#backups[@]}; index += 1)); do
  name="${backups[index]#* }"
  if [[ "${name}" =~ ^proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset$ ]]; then
    printf 'backup_retention_review candidate=%s reason=outside-newest-%s action=preserve\n' "${backup_root}/${name}" "${keep}"
  fi
done
# Age alone cannot establish independence from audit evidence or recovery work.
# Incomplete sets and older complete sets require a documented dependency review.
/usr/bin/find "${backup_root}" -maxdepth 1 -mindepth 1 -type d \
  -name '.proof_indexer-*.dumpset.tmp' -mmin +1440 \
  -printf 'backup_retention_review candidate=%p reason=incomplete-older-than-one-day action=preserve\n'

trap - EXIT
