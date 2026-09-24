#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
mode="${1:---apply}"
retained_basename="${2:-}"
if [[ "${mode}" == --retain-existing ]]; then
  [[ $# -eq 2 && "${retained_basename}" =~ ^proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset$ ]] || {
    echo 'Usage: proofofwork-postgres-logical-backup [--apply|--check-capacity|--retain-existing <verified-basename>]' >&2
    exit 64
  }
else
  [[ $# -le 1 && ( "${mode}" == --apply || "${mode}" == --check-capacity ) ]] || {
    echo 'Usage: proofofwork-postgres-logical-backup [--apply|--check-capacity|--retain-existing <verified-basename>]' >&2
    exit 64
  }
fi

backup_root="/data/proofofwork-postgres-backups/logical"
keep=1
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ "${mode}" == --retain-existing ]]; then
  basename="${retained_basename}"
else
  basename="proof_indexer-${timestamp}.dumpset"
fi
temporary_set="${backup_root}/.${basename}.tmp"
final_set="${backup_root}/${basename}"
retention_listing=""
candidate_listing=""
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
  if [[ -n "${candidate_listing}" ]]; then rm -f -- "${candidate_listing}"; fi
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
backup_root_device="$(stat --format=%d -- "${backup_root}")"
[[ "${backup_root_device}" =~ ^[0-9]+$ ]] || { echo "Invalid backup-root device identity." >&2; exit 1; }
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
if [[ "${mode}" == --retain-existing ]]; then
  if [[ ! -d "${final_set}" || -L "${final_set}" ||
    "$(realpath -e -- "${final_set}" 2>/dev/null || true)" != "${final_set}" ]]; then
    echo "Requested verified backup is not a canonical directory: ${final_set}" >&2
    exit 1
  fi
elif [[ -e "${temporary_set}" || -e "${final_set}" ]]; then
  echo "Backup set already exists: ${basename}" >&2
  exit 1
fi

if [[ "${mode}" != --retain-existing ]]; then
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
fi

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
candidate_verify_reason=""
verify_complete_backup_set() {
  local path="$1"
  local directory_mode directory_identity directory_device member member_path member_mode fuser_status checksum_line checksum_name mount_status
  local saw_dump=false saw_globals=false checksum_bytes
  local -a members=() checksum_lines=()
  candidate_verify_reason=directory-path-owner
  [[ -d "${path}" && ! -L "${path}" &&
    "$(/usr/bin/realpath -e -- "${path}" 2>/dev/null || true)" == "${path}" &&
    "$(/usr/bin/stat --format=%u -- "${path}" 2>/dev/null || true)" == "${EUID}" ]] || return 1
  candidate_verify_reason=directory-mode
  directory_mode="$(/usr/bin/stat --format=%a -- "${path}" 2>/dev/null)" || return 1
  ((8#${directory_mode} & 07022)) && return 1
  candidate_verify_reason=directory-device
  directory_device="$(/usr/bin/stat --format=%d -- "${path}" 2>/dev/null)" || return 1
  [[ "${directory_device}" == "${backup_root_device}" ]] || return 1
  candidate_verify_reason=directory-mountpoint
  mount_status=0
  /usr/bin/mountpoint --quiet -- "${path}" >/dev/null 2>&1 || mount_status=$?
  ((mount_status == 32)) || return 1
  candidate_verify_reason=directory-identity
  directory_identity="$(/usr/bin/stat --format='%d:%i' -- "${path}" 2>/dev/null)" || return 1
  candidate_verify_reason=member-list-create
  candidate_listing="$(/usr/bin/mktemp --tmpdir="${backup_root}" ".${basename}.candidate.XXXXXX")" || return 1
  candidate_verify_reason=member-list-enumeration
  if ! /usr/bin/find "${path}" -mindepth 1 -maxdepth 1 -printf '%f\0' >"${candidate_listing}" ||
    ! /usr/bin/sort -z -o "${candidate_listing}" "${candidate_listing}"; then
    /usr/bin/rm -f -- "${candidate_listing}"
    candidate_listing=""
    return 1
  fi
  mapfile -d '' -t members <"${candidate_listing}"
  /usr/bin/rm -f -- "${candidate_listing}"
  candidate_listing=""
  candidate_verify_reason=member-inventory
  (("${#members[@]}" == 3)) &&
    [[ "${members[0]:-}" == SHA256SUMS &&
      "${members[1]:-}" == globals.sql &&
      "${members[2]:-}" == proof_indexer.dump ]] || return 1
  for member in "${members[@]}"; do
    member_path="${path}/${member}"
    candidate_verify_reason="member-file:${member}"
    [[ -f "${member_path}" && ! -L "${member_path}" &&
      "$(/usr/bin/stat --format=%u -- "${member_path}" 2>/dev/null || true)" == "${EUID}" ]] || return 1
    candidate_verify_reason="member-mode:${member}"
    member_mode="$(/usr/bin/stat --format=%a -- "${member_path}" 2>/dev/null)" || return 1
    ((8#${member_mode} & 07022)) && return 1
    candidate_verify_reason="member-mountpoint:${member}"
    mount_status=0
    /usr/bin/mountpoint --quiet -- "${member_path}" >/dev/null 2>&1 || mount_status=$?
    ((mount_status == 32)) || return 1
  done
  candidate_verify_reason=checksum-manifest-size
  checksum_bytes="$(/usr/bin/stat --format=%s -- "${path}/SHA256SUMS" 2>/dev/null || true)"
  [[ "${checksum_bytes}" =~ ^[0-9]{1,3}$ ]] && ((checksum_bytes <= 256)) || return 1
  candidate_verify_reason=checksum-manifest-line-count
  mapfile -t checksum_lines <"${path}/SHA256SUMS"
  [[ "${#checksum_lines[@]}" -eq 2 ]] || return 1
  for checksum_line in "${checksum_lines[@]}"; do
    candidate_verify_reason=checksum-manifest-format
    [[ "${checksum_line}" =~ ^([0-9a-f]{64})\ \ (globals\.sql|proof_indexer\.dump)$ ]] || return 1
    checksum_name="${BASH_REMATCH[2]}"
    case "${checksum_name}" in
      globals.sql) [[ "${saw_globals}" == false ]] || { candidate_verify_reason=duplicate-globals-checksum; return 1; }; saw_globals=true ;;
      proof_indexer.dump) [[ "${saw_dump}" == false ]] || { candidate_verify_reason=duplicate-dump-checksum; return 1; }; saw_dump=true ;;
    esac
  done
  candidate_verify_reason=checksum-manifest-coverage
  [[ "${saw_dump}" == true && "${saw_globals}" == true ]] || return 1
  candidate_verify_reason=directory-identity-stable
  [[ "$(/usr/bin/stat --format='%d:%i' -- "${path}" 2>/dev/null || true)" == "${directory_identity}" &&
    "$(/usr/bin/realpath -e -- "${path}" 2>/dev/null || true)" == "${path}" ]] || return 1
  candidate_verify_reason=checksum-validation
  if ! (cd "${path}" && /usr/bin/sha256sum --check --strict SHA256SUMS >/dev/null); then
    return 1
  fi
  candidate_verify_reason=globals-file-nonempty
  /usr/bin/test -s "${path}/globals.sql" || return 1
  candidate_verify_reason=restore-catalog
  if ! /usr/bin/pg_restore --list "${path}/proof_indexer.dump" >/dev/null; then
    return 1
  fi
  candidate_verify_reason=fuser-unavailable
  [[ -x /usr/bin/fuser ]] || return 1
  candidate_verify_reason=open-reader-check
  fuser_status=0
  /usr/bin/fuser --silent -- \
    "${path}/proof_indexer.dump" \
    "${path}/globals.sql" \
    "${path}/SHA256SUMS" >/dev/null 2>&1 || fuser_status=$?
  ((fuser_status == 1)) || return 1
  candidate_verify_reason=backup-byte-measurement
  backup_candidate_bytes="$(/usr/bin/du --summarize --bytes --one-file-system -- "${path}" | /usr/bin/awk '{print $1}')" || return 1
  [[ "${backup_candidate_bytes}" =~ ^[0-9]+$ ]] || return 1
  candidate_verify_reason=directory-identity-after-verification
  [[ "$(/usr/bin/stat --format='%d:%i' -- "${path}" 2>/dev/null || true)" == "${directory_identity}" ]] || return 1
  backup_candidate_identity="${directory_identity}"
  candidate_verify_reason=verified
}

retained_current_set=false
for entry in "${backups[@]}"; do
  name="${entry#* }"
  [[ "${name}" =~ ^proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset$ ]] || {
    printf 'backup_retention_review candidate=%s reason=unexpected-name action=preserve\n' "${backup_root}/${name}"
    continue
  }
  candidate="${backup_root}/${name}"
  if [[ "${candidate}" == "${final_set}" ]]; then
    if ! verify_complete_backup_set "${candidate}"; then
      printf "Requested current logical backup failed retention verification: candidate=%s predicate=%s\n" \
        "${candidate}" "${candidate_verify_reason:-unknown}" >&2
      exit 1
    fi
    retained_current_set=true
    printf 'backup_retention_kept candidate=%s bytes=%s verified_sha256=true restore_catalog=true\n' \
      "${candidate}" "${backup_candidate_bytes}"
    continue
  fi
  if ! verify_complete_backup_set "${candidate}"; then
    printf 'backup_retention_review candidate=%s reason=verification-failed predicate=%s action=preserve\n' "${candidate}" "${candidate_verify_reason:-unknown}"
    continue
  fi
  candidate_bytes="${backup_candidate_bytes}"
  candidate_identity="${backup_candidate_identity}"
  if [[ "$(/usr/bin/stat --format='%d:%i' -- "${candidate}" 2>/dev/null || true)" != "${candidate_identity}" ||
    "$(/usr/bin/realpath -e -- "${candidate}" 2>/dev/null || true)" != "${candidate}" ]]; then
    printf 'backup_retention_review candidate=%s reason=identity-changed action=preserve\n' "${candidate}"
    continue
  fi
  /usr/bin/rm --recursive --one-file-system -- "${candidate}"
  /usr/bin/sync -f "${backup_root}"
  printf 'backup_retention_deleted candidate=%s bytes=%s verified_sha256=true restore_catalog=true\n' \
    "${candidate}" "${candidate_bytes}"
done
if [[ "${retained_current_set}" != true ]]; then
  echo "Verified current logical backup was missing from its own completed inventory." >&2
  exit 1
fi
# Retire only older complete sets whose exact members, checksums, restore catalog,
# ownership, path identity, and lack of open readers are verified above. Incomplete
# sets remain for manual review because age alone does not establish irrelevance.
/usr/bin/find "${backup_root}" -maxdepth 1 -mindepth 1 -type d \
  -name '.proof_indexer-*.dumpset.tmp' -mmin +1440 \
  -printf 'backup_retention_review candidate=%p reason=incomplete-older-than-one-day action=preserve\n'

trap - EXIT
