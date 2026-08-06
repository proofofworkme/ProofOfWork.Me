#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

logical_root="${POW_BACKUP_LOGICAL_ROOT:-/data/proofofwork-postgres-backups/logical}"
physical_root="${POW_BACKUP_PHYSICAL_ROOT:-/data/proofofwork-postgres-backups/physical/16-main}"
state_root="${POW_OFFSITE_STATE_ROOT:-/var/lib/proofofwork-offsite-backup}"
cache_root="${POW_OFFSITE_CACHE_ROOT:-/var/cache/proofofwork-restic}"
config_root="${POW_OFFSITE_CONFIG_ROOT:-/etc/proofofwork-backup}"
restic_bin="${POW_OFFSITE_RESTIC_BIN:-/usr/bin/restic}"
check_subset="${POW_OFFSITE_CHECK_SUBSET:-5%}"
logical_max_age="${POW_OFFSITE_LOGICAL_MAX_AGE_SECONDS:-108000}"
physical_max_age="${POW_OFFSITE_PHYSICAL_MAX_AGE_SECONDS:-691200}"
wal_max_age="${POW_OFFSITE_WAL_MAX_AGE_SECONDS:-1800}"
allow_test_roots="${POW_OPS_ALLOW_TEST_ROOTS:-0}"

if [[ "${POW_OFFSITE_BACKUP_ENABLED:-0}" != "1" ]]; then
  echo "Off-site backup is disabled; set POW_OFFSITE_BACKUP_ENABLED=1 only after destination approval." >&2
  exit 2
fi
if [[ "${allow_test_roots}" != "1" ]] && {
  [[ "${logical_root}" != "/data/proofofwork-postgres-backups/logical" ]] ||
    [[ "${physical_root}" != "/data/proofofwork-postgres-backups/physical/16-main" ]] ||
    [[ "${state_root}" != "/var/lib/proofofwork-offsite-backup" ]] ||
    [[ "${cache_root}" != "/var/cache/proofofwork-restic" ]] ||
    [[ "${config_root}" != "/etc/proofofwork-backup" ]] ||
    [[ "${restic_bin}" != "/usr/bin/restic" ]];
}; then
  echo "Off-site backup path overrides are test-only." >&2
  exit 2
fi
if [[ ! "${RESTIC_REPOSITORY:-}" =~ ^sftp:proofofwork-offsite-backup:/[A-Za-z0-9._-][A-Za-z0-9._/-]*$ ]] ||
  [[ "${RESTIC_REPOSITORY}" == *"/../"* || "${RESTIC_REPOSITORY}" == *"/.." ||
    "${RESTIC_REPOSITORY}" == *"//"* ]]; then
  echo "RESTIC_REPOSITORY must use the fixed SFTP alias and an absolute remote path." >&2
  exit 2
fi
if [[ -n "${RESTIC_PASSWORD:-}" || -n "${RESTIC_PASSWORD_COMMAND:-}" ]]; then
  echo "Inline or command-derived restic passwords are forbidden." >&2
  exit 2
fi
if [[ "${RESTIC_PASSWORD_FILE:-}" != "${config_root}/restic-password" ]]; then
  echo "RESTIC_PASSWORD_FILE must use the fixed protected path." >&2
  exit 2
fi
if [[ ! "${check_subset}" =~ ^([1-9]|[1-9][0-9]|100)%$ ]]; then
  echo "POW_OFFSITE_CHECK_SUBSET must be an integer percentage from 1% to 100%." >&2
  exit 2
fi
for value in "${logical_max_age}" "${physical_max_age}" "${wal_max_age}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 60)); then
    echo "Off-site source ages must be integer seconds of at least 60." >&2
    exit 2
  fi
done

for root in "${logical_root}" "${physical_root}" "${state_root}" "${cache_root}" "${config_root}"; do
  if [[ ! -d "${root}" || -L "${root}" ]]; then
    echo "Required off-site backup directory is unsafe: ${root}" >&2
    exit 2
  fi
done
if [[ "$(/usr/bin/stat --format='%U:%G %a' -- "${config_root}")" != "root:postgres 750" ]] &&
  [[ "${allow_test_roots}" != "1" ]]; then
  echo "Off-site configuration root must be root:postgres 0750: ${config_root}" >&2
  exit 2
fi

verify_logical_dumpset() {
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
  (cd "${dumpset}" && /usr/bin/sha256sum --check --status --strict SHA256SUMS)
}

verify_physical_backup() {
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
  for artifact in base.tar.gz backup_manifest status; do
    if [[ ! -f "${backup}/${artifact}" || -L "${backup}/${artifact}" ||
      ! -s "${backup}/${artifact}" ]] ||
      [[ "$(/usr/bin/stat --format='%a' -- "${backup}/${artifact}")" != "600" ]] || {
        [[ "${allow_test_roots}" != "1" ]] &&
          [[ "$(/usr/bin/stat --format='%U:%G' -- "${backup}/${artifact}")" != "postgres:postgres" ]];
      }; then
      return 1
    fi
  done
}

for protected_file in offsite.env restic-password ssh_config known_hosts identity; do
  path="${config_root}/${protected_file}"
  if [[ ! -f "${path}" || -L "${path}" ]]; then
    echo "Required off-site backup file is unsafe: ${path}" >&2
    exit 2
  fi
  owner="$(/usr/bin/stat --format='%U:%G' "${path}")"
  mode="$(/usr/bin/stat --format='%a' "${path}")"
  if [[ "${owner}" != "root:postgres" || "${mode}" != "640" ]]; then
    echo "Off-site backup file must be root:postgres 0640: ${path} (${owner} ${mode})" >&2
    exit 2
  fi
done
if [[ ! -x "${restic_bin}" ]]; then
  echo "Restic is not installed at ${restic_bin}." >&2
  exit 2
fi

latest_logical="$(/usr/bin/find "${logical_root}" -maxdepth 1 -mindepth 1 -type d \
  -name 'proof_indexer-*.dumpset' -printf '%T@ %p\n' |
  /usr/bin/sort --numeric-sort | /usr/bin/tail --lines=1 | /usr/bin/cut --delimiter=' ' --fields=2-)"
if [[ -z "${latest_logical}" ]] ||
  ! verify_logical_dumpset "${latest_logical}"; then
  echo "Latest logical backup is missing or failed verification." >&2
  exit 2
fi
now_epoch="$(/usr/bin/date -u +%s)"
logical_age=$((now_epoch - $(/usr/bin/stat --format='%Y' "${latest_logical}/SHA256SUMS")))
if ((logical_age < 0 || logical_age > logical_max_age)); then
  echo "Latest logical backup is stale: ${logical_age} seconds." >&2
  exit 2
fi
latest_physical="$(/usr/bin/find "${physical_root}" -maxdepth 1 -mindepth 1 -type d \
  -name '*.backup' -printf '%T@ %p\n' |
  /usr/bin/sort --numeric-sort | /usr/bin/tail --lines=1 | /usr/bin/cut --delimiter=' ' --fields=2-)"
if [[ -z "${latest_physical}" ]] ||
  ! verify_physical_backup "${latest_physical}"; then
  echo "Latest physical backup is missing or incomplete." >&2
  exit 2
fi
if ! /usr/bin/python3 - "${latest_physical}/status" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    status = json.load(handle)
if status.get("status") != "ok" or status.get("type") != "basebackup":
    raise SystemExit(1)
PY
then
  echo "Latest physical backup status is not ok." >&2
  exit 2
fi
physical_age=$((now_epoch - $(/usr/bin/stat --format='%Y' "${latest_physical}/status")))
if ((physical_age < 0 || physical_age > physical_max_age)); then
  echo "Latest physical backup is stale: ${physical_age} seconds." >&2
  exit 2
fi
latest_wal="$(/usr/bin/find "${physical_root}/wal" -maxdepth 1 -type f \
  -regextype posix-extended -regex '.*/[0-9A-F]{24}(\.gz)?' \
  -printf '%T@ %p\n' | /usr/bin/sort --numeric-sort |
  /usr/bin/tail --lines=1 | /usr/bin/cut --delimiter=' ' --fields=2-)"
if [[ -z "${latest_wal}" || -L "${latest_wal}" ||
  ! "$(/usr/bin/basename -- "${latest_wal}")" =~ ^[0-9A-F]{24}([.]gz)?$ ]]; then
  echo "Latest WAL archive evidence is missing." >&2
  exit 2
fi
wal_age=$((now_epoch - $(/usr/bin/stat --format='%Y' "${latest_wal}")))
if ((wal_age < 0 || wal_age > wal_max_age)); then
  echo "Latest WAL archive evidence is stale: ${wal_age} seconds." >&2
  exit 2
fi
if ! /usr/bin/systemctl is-active --quiet pg_receivewal@16-main.service; then
  echo "PostgreSQL WAL receiver is not active." >&2
  exit 2
fi

export RESTIC_CACHE_DIR="${cache_root}"
sftp_command="/usr/bin/ssh -F ${config_root}/ssh_config"
sftp_command+=" -o BatchMode=yes -o PasswordAuthentication=no"
sftp_command+=" -o KbdInteractiveAuthentication=no -o PreferredAuthentications=publickey"
sftp_command+=" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
sftp_command+=" -o UserKnownHostsFile=${config_root}/known_hosts"
sftp_command+=" -o ConnectTimeout=10 -o ServerAliveInterval=60 -o ServerAliveCountMax=5"
sftp_command+=" -i ${config_root}/identity proofofwork-offsite-backup -s sftp"
restic=("${restic_bin}" --option "sftp.command=${sftp_command}")

# This intentionally refuses to initialize, forget, or prune a repository.
# The snapshots preflight proves that an operator initialized and approved it.
"${restic[@]}" snapshots --json --latest 1 >/dev/null
started_epoch="$(/usr/bin/date -u +%s)"
backup_host="$(/usr/bin/hostname)"
backup_json="$(/usr/bin/mktemp "${state_root}/.backup.XXXXXX")"
snapshot_json="$(/usr/bin/mktemp "${state_root}/.snapshot.XXXXXX")"
evidence_tmp="$(/usr/bin/mktemp "${state_root}/.success.XXXXXX")"
cleanup() {
  /usr/bin/rm -f -- "${backup_json}" "${snapshot_json}" "${evidence_tmp}"
}
trap cleanup EXIT
"${restic[@]}" backup --json --tag proofofwork-postgres --host "${backup_host}" \
  --exclude='*.partial' --exclude='.proof_indexer-*.dumpset.tmp' \
  "${logical_root}" "${physical_root}" >"${backup_json}"
snapshot_id="$(/usr/bin/python3 - "${backup_json}" <<'PY'
import json
import re
import sys

snapshot_ids = []
with open(sys.argv[1], encoding="utf-8") as handle:
    for line in handle:
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            raise SystemExit(1)
        if message.get("message_type") == "summary":
            snapshot_id = message.get("snapshot_id")
            if isinstance(snapshot_id, str) and re.fullmatch(r"[0-9a-f]{64}", snapshot_id):
                snapshot_ids.append(snapshot_id)
if len(snapshot_ids) != 1:
    raise SystemExit(1)
print(snapshot_ids[0])
PY
)"
"${restic[@]}" snapshots --json "${snapshot_id}" >"${snapshot_json}"
/usr/bin/python3 - "${snapshot_json}" "${logical_root}" "${physical_root}" \
  "${started_epoch}" "${snapshot_id}" "${backup_host}" <<'PY'
from datetime import datetime
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    snapshots = json.load(handle)
if len(snapshots) != 1:
    raise SystemExit(1)
snapshot = snapshots[0]
if set(snapshot.get("paths", [])) != {sys.argv[2], sys.argv[3]}:
    raise SystemExit(1)
timestamp = datetime.fromisoformat(snapshot["time"].replace("Z", "+00:00")).timestamp()
if timestamp < int(sys.argv[4]) - 300:
    raise SystemExit(1)
if snapshot.get("id") != sys.argv[5] or snapshot.get("hostname") != sys.argv[6]:
    raise SystemExit(1)
PY
"${restic[@]}" check --read-data-subset="${check_subset}"

completed_epoch="$(/usr/bin/date -u +%s)"
printf 'format=proofofwork-offsite-backup-v1\ncompleted_at_epoch=%s\nsnapshot_id=%s\ncheck_subset=%s\n' \
  "${completed_epoch}" "${snapshot_id}" "${check_subset}" >"${evidence_tmp}"
/usr/bin/mv -- "${evidence_tmp}" "${state_root}/latest-success"
/usr/bin/sync -f "${state_root}/latest-success"
/usr/bin/sync -f "${state_root}"
trap - EXIT
/usr/bin/rm -f -- "${backup_json}" "${snapshot_json}"
echo "offsite_backup status=verified snapshot_id=${snapshot_id} check_subset=${check_subset}"
