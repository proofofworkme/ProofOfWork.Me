#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

logical_root="${POW_BACKUP_LOGICAL_ROOT:-/data/proofofwork-postgres-backups/logical}"
physical_root="${POW_BACKUP_PHYSICAL_ROOT:-/data/proofofwork-postgres-backups/physical/16-main}"
offsite_config="${POW_OFFSITE_CONFIG:-/etc/proofofwork-backup/offsite.env}"
offsite_evidence="${POW_OFFSITE_EVIDENCE:-/var/lib/proofofwork-offsite-backup/latest-success}"
systemctl_bin="${POW_OPS_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
sha256sum_bin="${POW_OPS_SHA256SUM_BIN:-/usr/bin/sha256sum}"
state_root="${POW_BACKUP_HEALTH_STATE_ROOT:-/var/lib/proofofwork-backup-health}"
logical_max_age="${POW_BACKUP_LOGICAL_MAX_AGE_SECONDS:-108000}"
physical_max_age="${POW_BACKUP_PHYSICAL_MAX_AGE_SECONDS:-691200}"
wal_max_age="${POW_BACKUP_WAL_MAX_AGE_SECONDS:-1800}"
offsite_max_age="${POW_BACKUP_OFFSITE_MAX_AGE_SECONDS:-108000}"
full_verify_max_age="${POW_BACKUP_FULL_VERIFY_MAX_AGE_SECONDS:-86400}"
allow_test_roots="${POW_OPS_ALLOW_TEST_ROOTS:-0}"

if [[ "${allow_test_roots}" != "1" ]] && {
  [[ "${logical_root}" != "/data/proofofwork-postgres-backups/logical" ]] ||
    [[ "${physical_root}" != "/data/proofofwork-postgres-backups/physical/16-main" ]] ||
    [[ "${offsite_config}" != "/etc/proofofwork-backup/offsite.env" ]] ||
    [[ "${offsite_evidence}" != "/var/lib/proofofwork-offsite-backup/latest-success" ]] ||
    [[ "${systemctl_bin}" != "/usr/bin/systemctl" ]] ||
    [[ "${sha256sum_bin}" != "/usr/bin/sha256sum" ]] ||
    [[ "${state_root}" != "/var/lib/proofofwork-backup-health" ]];
}; then
  echo "Backup health path overrides are test-only." >&2
  exit 2
fi
for value in "${logical_max_age}" "${physical_max_age}" "${wal_max_age}" \
  "${offsite_max_age}" "${full_verify_max_age}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 60)); then
    echo "Backup health ages must be integer seconds of at least 60." >&2
    exit 2
  fi
done

now_epoch="$(/usr/bin/date -u +%s)"
severity=0
critical() {
  echo "CRITICAL $*" >&2
  severity=2
}

if [[ ! -d "${state_root}" || -L "${state_root}" ]]; then
  echo "CRITICAL backup_health_state=invalid path=${state_root}" >&2
  exit 2
fi

for root in "${logical_root}" "${physical_root}" "${physical_root}/wal"; do
  if [[ ! -d "${root}" || -L "${root}" ]]; then
    critical "backup_path=invalid path=${root}"
  fi
done

verify_logical_dumpset_structure() {
  local dumpset="$1"
  local entry entry_name entry_count=0
  local owner mode
  local dump_pattern='^[0-9a-f]{64}  proof_indexer\.dump$'
  local globals_pattern='^[0-9a-f]{64}  globals\.sql$'
  local -a manifest_lines=()

  if [[ ! -d "${dumpset}" || -L "${dumpset}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${dumpset}")" != "${dumpset}" ]] ||
    [[ ! "$(/usr/bin/basename -- "${dumpset}")" =~ ^proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset$ ]]; then
    return 1
  fi
  mode="$(/usr/bin/stat --format='%a' -- "${dumpset}")"
  owner="$(/usr/bin/stat --format='%U:%G' -- "${dumpset}")"
  if [[ "${mode}" != "700" ]] || {
    [[ "${allow_test_roots}" != "1" ]] && [[ "${owner}" != "postgres:postgres" ]];
  }; then
    return 1
  fi

  while IFS= read -r -d '' entry; do
    ((entry_count += 1))
    entry_name="${entry##*/}"
    case "${entry_name}" in
      SHA256SUMS | globals.sql | proof_indexer.dump) ;;
      *) return 1 ;;
    esac
  done < <(/usr/bin/find "${dumpset}" -mindepth 1 -maxdepth 1 -print0)
  if ((entry_count != 3)); then
    return 1
  fi

  for entry_name in proof_indexer.dump globals.sql SHA256SUMS; do
    entry="${dumpset}/${entry_name}"
    if [[ ! -f "${entry}" || -L "${entry}" || ! -s "${entry}" ]] ||
      [[ "$(/usr/bin/stat --format='%a' -- "${entry}")" != "600" ]] || {
        [[ "${allow_test_roots}" != "1" ]] &&
          [[ "$(/usr/bin/stat --format='%U:%G' -- "${entry}")" != "postgres:postgres" ]];
      }; then
      return 1
    fi
  done

  mapfile -t manifest_lines <"${dumpset}/SHA256SUMS"
  if ((${#manifest_lines[@]} != 2)) ||
    [[ ! "${manifest_lines[0]}" =~ ${dump_pattern} ]] ||
    [[ ! "${manifest_lines[1]}" =~ ${globals_pattern} ]]; then
    return 1
  fi
  return 0
}

verify_physical_backup_structure() {
  local backup="$1"
  local artifact mode owner
  if [[ ! -d "${backup}" || -L "${backup}" ]] ||
    [[ "$(/usr/bin/realpath -e -- "${backup}")" != "${backup}" ]] ||
    [[ ! "$(/usr/bin/basename -- "${backup}")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.backup$ ]]; then
    return 1
  fi
  mode="$(/usr/bin/stat --format='%a' -- "${backup}")"
  owner="$(/usr/bin/stat --format='%U:%G' -- "${backup}")"
  if [[ "${mode}" != "700" ]] || {
    [[ "${allow_test_roots}" != "1" ]] && [[ "${owner}" != "postgres:postgres" ]];
  }; then
    return 1
  fi
  for artifact in base.tar.gz backup_manifest; do
    if [[ ! -f "${backup}/${artifact}" || -L "${backup}/${artifact}" ||
      ! -s "${backup}/${artifact}" ]] ||
      [[ "$(/usr/bin/stat --format='%a' -- "${backup}/${artifact}")" != "600" ]] || {
        [[ "${allow_test_roots}" != "1" ]] &&
          [[ "$(/usr/bin/stat --format='%U:%G' -- "${backup}/${artifact}")" != "postgres:postgres" ]];
      }; then
      return 1
    fi
  done

  artifact="${backup}/status"
  if [[ ! -f "${artifact}" || -L "${artifact}" || ! -s "${artifact}" ]]; then
    return 1
  fi
  mode="$(/usr/bin/stat --format='%a' -- "${artifact}")"
  owner="$(/usr/bin/stat --format='%U:%G' -- "${artifact}")"
  if { [[ "${mode}" != "600" ]] && [[ "${mode}" != "640" ]]; } || {
    [[ "${allow_test_roots}" != "1" ]] && [[ "${owner}" != "postgres:postgres" ]];
  }; then
    return 1
  fi
}

latest_logical="$(/usr/bin/find "${logical_root}" -maxdepth 1 -mindepth 1 -type d \
  -name 'proof_indexer-*.dumpset' -printf '%T@ %p\n' 2>/dev/null |
  /usr/bin/sort --numeric-sort | /usr/bin/tail --lines=1 | /usr/bin/cut --delimiter=' ' --fields=2- || true)"
logical_age="unknown"
if [[ -z "${latest_logical}" || -L "${latest_logical}" ||
  ! "$(/usr/bin/basename -- "${latest_logical}")" =~ ^proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset$ ]]; then
  critical "logical_backup=missing_or_unsafe"
elif ! verify_logical_dumpset_structure "${latest_logical}"; then
  critical "logical_backup=invalid_manifest_or_artifacts path=${latest_logical}"
else
  logical_cache_key="$(
    printf '%s\0' \
      "${latest_logical}" \
      "$(/usr/bin/stat --format='%Y:%Z:%s' "${latest_logical}/proof_indexer.dump")" \
      "$(/usr/bin/stat --format='%Y:%Z:%s' "${latest_logical}/globals.sql")" \
      "$("${sha256sum_bin}" "${latest_logical}/SHA256SUMS")" |
      "${sha256sum_bin}" | /usr/bin/cut --delimiter=' ' --fields=1
  )"
  logical_cache="${state_root}/logical-verification"
  cached_key=""
  cached_epoch=""
  cached_format=""
  logical_cache_owner=""
  logical_cache_mode=""
  if [[ -f "${logical_cache}" && ! -L "${logical_cache}" ]]; then
    logical_cache_owner="$(/usr/bin/stat --format='%U:%G' "${logical_cache}")"
    logical_cache_mode="$(/usr/bin/stat --format='%a' "${logical_cache}")"
  fi
  if [[ "${logical_cache_mode}" == "600" ]] && {
    [[ "${logical_cache_owner}" == "postgres:postgres" ]] ||
      [[ "${allow_test_roots}" == "1" ]];
  }; then
    cached_format="$(/usr/bin/sed -n 's/^format=//p' "${logical_cache}")"
    cached_key="$(/usr/bin/sed -n 's/^cache_key=//p' "${logical_cache}")"
    cached_epoch="$(/usr/bin/sed -n 's/^verified_at_epoch=//p' "${logical_cache}")"
  fi
  logical_verification="cached"
  if [[ "${cached_format}" != "proofofwork-logical-backup-verification-v1" ||
    "${cached_key}" != "${logical_cache_key}" ||
    ! "${cached_epoch}" =~ ^[0-9]+$ ]] ||
    ((now_epoch < cached_epoch || now_epoch - cached_epoch > full_verify_max_age)); then
    logical_verification="full"
    if ! (cd "${latest_logical}" && "${sha256sum_bin}" --check --status --strict SHA256SUMS); then
      critical "logical_backup=checksum_failed path=${latest_logical}"
      logical_verification="failed"
    else
      logical_cache_tmp="$(/usr/bin/mktemp "${state_root}/.logical-verification.XXXXXX")"
      if ! printf 'format=proofofwork-logical-backup-verification-v1\ncache_key=%s\nverified_at_epoch=%s\n' \
        "${logical_cache_key}" "${now_epoch}" >"${logical_cache_tmp}" ||
        ! /usr/bin/mv -- "${logical_cache_tmp}" "${logical_cache}"; then
        /usr/bin/rm -f -- "${logical_cache_tmp}"
        critical "logical_backup=verification_cache_publish_failed"
      fi
    fi
  fi
  if [[ "${logical_verification}" != "failed" ]]; then
    logical_age=$((now_epoch - $(/usr/bin/stat --format='%Y' "${latest_logical}/SHA256SUMS")))
    if ((logical_age < 0 || logical_age > logical_max_age)); then
      critical "logical_backup=stale age_seconds=${logical_age} max_age_seconds=${logical_max_age}"
    fi
  fi
fi

latest_physical="$(/usr/bin/find "${physical_root}" -maxdepth 1 -mindepth 1 -type d \
  -name '*.backup' -printf '%T@ %p\n' 2>/dev/null |
  /usr/bin/sort --numeric-sort | /usr/bin/tail --lines=1 | /usr/bin/cut --delimiter=' ' --fields=2- || true)"
physical_age="unknown"
if [[ -z "${latest_physical}" || -L "${latest_physical}" ||
  ! "$(/usr/bin/basename -- "${latest_physical}")" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.backup$ ]]; then
  critical "physical_backup=missing_or_unsafe"
elif ! verify_physical_backup_structure "${latest_physical}"; then
  critical "physical_backup=invalid_artifacts path=${latest_physical}"
elif ! /usr/bin/python3 - "${latest_physical}/status" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        status = json.load(handle)
except Exception:
    raise SystemExit(1)
if status.get("status") != "ok" or status.get("type") != "basebackup":
    raise SystemExit(1)
PY
then
  critical "physical_backup=status_invalid path=${latest_physical}"
else
  physical_age=$((now_epoch - $(/usr/bin/stat --format='%Y' "${latest_physical}/status")))
  if ((physical_age < 0 || physical_age > physical_max_age)); then
    critical "physical_backup=stale age_seconds=${physical_age} max_age_seconds=${physical_max_age}"
  fi
fi

latest_wal="$(/usr/bin/find "${physical_root}/wal" -maxdepth 1 -type f \
  -regextype posix-extended -regex '.*/[0-9A-F]{24}(\.gz)?' -printf '%T@ %p\n' 2>/dev/null |
  /usr/bin/sort --numeric-sort | /usr/bin/tail --lines=1 | /usr/bin/cut --delimiter=' ' --fields=2- || true)"
wal_age="unknown"
if [[ -z "${latest_wal}" || -L "${latest_wal}" ]]; then
  critical "wal_archive=missing"
else
  wal_name="$(/usr/bin/basename -- "${latest_wal}")"
  if [[ ! "${wal_name}" =~ ^[0-9A-F]{24}([.]gz)?$ ]]; then
    critical "wal_archive=unexpected_latest_file name=${wal_name}"
  fi
  wal_age=$((now_epoch - $(/usr/bin/stat --format='%Y' "${latest_wal}")))
  if ((wal_age < 0 || wal_age > wal_max_age)); then
    critical "wal_archive=stale age_seconds=${wal_age} max_age_seconds=${wal_max_age}"
  fi
fi

for unit in pg_receivewal@16-main.service pg_compresswal@16-main.timer pg_basebackup@16-main.timer proofofwork-postgres-logical-backup.timer; do
  if ! "${systemctl_bin}" is-active --quiet "${unit}"; then
    critical "backup_unit=${unit} active=false"
  fi
done

offsite_state="not-configured"
if [[ -e "${offsite_config}" ]]; then
  if [[ ! -f "${offsite_config}" || -L "${offsite_config}" ]]; then
    critical "offsite_config=unsafe"
    offsite_state="unsafe"
  elif [[ "$(/usr/bin/stat --format='%U:%G %a' "${offsite_config}")" != "root:postgres 640" ]]; then
    critical "offsite_config=unsafe_metadata"
    offsite_state="unsafe"
  elif /usr/bin/grep --quiet --extended-regexp '^POW_OFFSITE_BACKUP_ENABLED=1$' "${offsite_config}"; then
    offsite_state="enabled"
    if ! "${systemctl_bin}" is-active --quiet proofofwork-postgres-offsite-backup.timer; then
      critical "offsite_timer=inactive"
    fi
    if [[ ! -f "${offsite_evidence}" || -L "${offsite_evidence}" ||
      "$(/usr/bin/stat --format='%U:%G %a' "${offsite_evidence}")" != "postgres:postgres 600" ]]; then
      critical "offsite_evidence=missing"
    else
      evidence_format="$(/usr/bin/sed -n 's/^format=//p' "${offsite_evidence}")"
      evidence_epoch="$(/usr/bin/sed -n 's/^completed_at_epoch=//p' "${offsite_evidence}")"
      evidence_snapshot="$(/usr/bin/sed -n 's/^snapshot_id=//p' "${offsite_evidence}")"
      if [[ "${evidence_format}" != "proofofwork-offsite-backup-v1" ||
        ! "${evidence_epoch}" =~ ^[0-9]+$ ||
        ! "${evidence_snapshot}" =~ ^[0-9a-f]{64}$ ]]; then
        critical "offsite_evidence=invalid"
      else
        offsite_age=$((now_epoch - evidence_epoch))
        if ((offsite_age < 0 || offsite_age > offsite_max_age)); then
          critical "offsite_backup=stale age_seconds=${offsite_age} max_age_seconds=${offsite_max_age}"
        fi
      fi
    fi
  else
    offsite_state="disabled"
  fi
fi

echo "postgres_backup_health logical_age_seconds=${logical_age} logical_verification=${logical_verification:-unavailable} physical_age_seconds=${physical_age} wal_age_seconds=${wal_age} offsite=${offsite_state}"
exit "${severity}"
