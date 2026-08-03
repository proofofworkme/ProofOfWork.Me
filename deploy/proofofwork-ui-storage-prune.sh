#!/usr/bin/env bash
set -Eeuo pipefail

mode="${1:---dry-run}"
case "${mode}" in
  --dry-run | --apply) ;;
  *)
    echo "Usage: $0 [--dry-run|--apply]" >&2
    exit 64
    ;;
esac

www_root="${POW_UI_WWW_ROOT:-/var/www}"
var_tmp_root="${POW_UI_VAR_TMP_ROOT:-/var/tmp}"
if [[ "${www_root}" != "/var/www" || "${var_tmp_root}" != "/var/tmp" ]] &&
  [[ "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
  echo "Non-production cleanup roots require POW_UI_ALLOW_TEST_ROOTS=1." >&2
  exit 64
fi
for root in "${www_root}" "${var_tmp_root}"; do
  if [[ ! -d "${root}" || -L "${root}" || "$(realpath -e "${root}")" != "${root}" ]]; then
    echo "Cleanup root must be a real canonical directory: ${root}" >&2
    exit 64
  fi
done
www_root_mode="$(stat --format=%a -- "${www_root}")"
www_root_owner="$(stat --format=%u -- "${www_root}")"
if ((8#${www_root_mode} & 07022)) || [[ "${www_root_owner}" != "${EUID}" ]]; then
  echo "UI root must be owner-controlled and not group/world writable: ${www_root}" >&2
  exit 64
fi

deploy_lock="${POW_UI_DEPLOY_LOCK:-/run/proofofwork-ui/deploy.lock}"
if [[ "${deploy_lock}" != "/run/proofofwork-ui/deploy.lock" &&
  "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
  echo "Non-production UI deployment lock requires POW_UI_ALLOW_TEST_ROOTS=1." >&2
  exit 64
fi
lock_parent="$(dirname -- "${deploy_lock}")"
if [[ ! -d "${lock_parent}" || -L "${lock_parent}" ||
  "$(realpath -e -- "${lock_parent}")" != "${lock_parent}" ]]; then
  echo "UI deployment lock parent must be a real canonical directory." >&2
  exit 64
fi
lock_parent_mode="$(stat --format=%a -- "${lock_parent}")"
lock_parent_owner="$(stat --format=%u -- "${lock_parent}")"
if ((8#${lock_parent_mode} & 07022)) || [[ "${lock_parent_owner}" != "${EUID}" ]]; then
  echo "UI deployment lock parent has unsafe ownership or mode." >&2
  exit 64
fi
if [[ -e "${deploy_lock}" || -L "${deploy_lock}" ]]; then
  if [[ ! -f "${deploy_lock}" || -L "${deploy_lock}" ||
    "$(realpath -e -- "${deploy_lock}")" != "${deploy_lock}" ||
    "$(stat --format=%u -- "${deploy_lock}")" != "${EUID}" ]] ||
    ((8#$(stat --format=%a -- "${deploy_lock}") & 07022)); then
    echo "UI deployment lock must be a canonical owner-controlled regular file." >&2
    exit 64
  fi
fi
inherited_deploy_lock_fd="${POW_UI_DEPLOY_LOCK_FD:-}"
if [[ -n "${inherited_deploy_lock_fd}" ]]; then
  if [[ ! "${inherited_deploy_lock_fd}" =~ ^[1-9][0-9]*$ ]] ||
    ((inherited_deploy_lock_fd < 3)) ||
    [[ ! -f "/proc/self/fd/${inherited_deploy_lock_fd}" ]] ||
    [[ "$(realpath -e -- "/proc/self/fd/${inherited_deploy_lock_fd}" 2>/dev/null || true)" != "${deploy_lock}" ]]; then
    echo "Inherited UI deployment lock descriptor is invalid." >&2
    exit 64
  fi
  deploy_lock_fd="${inherited_deploy_lock_fd}"
else
  exec {deploy_lock_fd}>"${deploy_lock}"
  chmod 0600 "${deploy_lock}"
fi
if ! flock --exclusive --nonblock "${deploy_lock_fd}"; then
  echo "Another UI deployment or cleanup operation holds ${deploy_lock}." >&2
  exit 1
fi

now="$(date +%s)"
max_paths=256
surface_pattern='activity|browser|computer|desktop|growth|id|inception|infinity|landing|marketplace|nft|token|wallet|work'
# Pre-deploy, previous, and rollback roots are historical recovery evidence.
# They are intentionally excluded until a retained archive manifest can prove
# exact coverage for the corresponding release set.
declare -A group_class=()
declare -A group_paths=()
declare -A group_time=()
declare -A path_time=()
deletions=()
marker_name='.proofofwork-rebuildable-stage-v1'

reject_nested_mounts() {
  local directory="$1"
  local mountinfo="${POW_UI_MOUNTINFO_PATH:-/proc/self/mountinfo}"
  if [[ "${mountinfo}" != "/proc/self/mountinfo" &&
    "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
    echo "Non-production mount metadata requires POW_UI_ALLOW_TEST_ROOTS=1." >&2
    return 1
  fi
  if [[ ! -f "${mountinfo}" || -L "${mountinfo}" ]]; then
    echo "Mount metadata must be a regular, non-symlink file: ${mountinfo}" >&2
    return 1
  fi
  /usr/bin/python3 -I - "${directory}" "${mountinfo}" <<'PY'
import os
import sys

root = os.path.realpath(sys.argv[1])
mountinfo = sys.argv[2]

def unescape(value: str) -> str:
    return (
        value.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    )

with open(mountinfo, encoding="utf-8") as source:
    for line in source:
        fields = line.split()
        if len(fields) < 5:
            raise SystemExit("Mount metadata contains a malformed record.")
        mount_point = os.path.realpath(unescape(fields[4]))
        try:
            nested = mount_point == root or os.path.commonpath((root, mount_point)) == root
        except ValueError:
            nested = False
        if nested:
            raise SystemExit(f"Refusing cleanup tree containing nested mount {mount_point}.")
PY
}

validate_marker() {
  local path="$1"
  local descriptor="$2"
  local marker="${path}/${marker_name}"
  local expected_class="${descriptor%%:*}"
  local expected_release="${descriptor#*:}"
  local line key value mode owner
  local format="" marker_class="" marker_release=""
  local -A seen=()

  if [[ ! -f "${marker}" || -L "${marker}" ||
    "$(realpath -e -- "${marker}")" != "${marker}" ]]; then
    echo "Cleanup marker must be a canonical regular file: ${marker}" >&2
    return 1
  fi
  mode="$(stat --format=%a -- "${marker}")"
  owner="$(stat --format=%u -- "${marker}")"
  if ((8#${mode} & 07022)) || [[ "${owner}" != "${EUID}" ]]; then
    echo "Cleanup marker has unsafe mode or ownership: ${marker}" >&2
    return 1
  fi
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" != *=* ]]; then
      echo "Cleanup marker contains a malformed line: ${marker}" >&2
      return 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    if [[ -n "${seen[${key}]:-}" ]]; then
      echo "Cleanup marker contains a duplicate key: ${marker}" >&2
      return 1
    fi
    seen["${key}"]=1
    case "${key}" in
      format) format="${value}" ;;
      class) marker_class="${value}" ;;
      release_id) marker_release="${value}" ;;
      *)
        echo "Cleanup marker contains an unknown key: ${marker}" >&2
        return 1
        ;;
    esac
  done <"${marker}"
  if [[ "${format}" != "proofofwork-rebuildable-ui-stage-v1" ||
    "${marker_class}" != "${expected_class}" ||
    "${marker_release}" != "${expected_release}" ]]; then
    echo "Cleanup marker does not bind its allowlisted path: ${marker}" >&2
    return 1
  fi
}

validate_candidate_tree() {
  local path="$1"
  local unsafe_mode unexpected_type foreign_owner
  reject_nested_mounts "${path}"
  unsafe_mode="$(find "${path}" -xdev \( -type d -o -type f \) -perm /7022 -print -quit)"
  unexpected_type="$(find "${path}" -xdev -mindepth 1 \( ! -type d ! -type f ! -type l \) -print -quit)"
  foreign_owner="$(find "${path}" -xdev ! -uid "${EUID}" -print -quit)"
  if [[ -n "${unsafe_mode}" ]]; then
    echo "Cleanup candidate contains an unsafe writable or special mode: ${unsafe_mode}" >&2
    return 1
  fi
  if [[ -n "${unexpected_type}" ]]; then
    echo "Cleanup candidate contains an unsupported file type: ${unexpected_type}" >&2
    return 1
  fi
  if [[ -n "${foreign_owner}" ]]; then
    echo "Cleanup candidate contains foreign-owned content: ${foreign_owner}" >&2
    return 1
  fi
}

describe_candidate() {
  local path="$1"
  local parent base
  parent="$(dirname -- "${path}")"
  base="$(basename -- "${path}")"
  if [[ "${parent}" == "${www_root}" ]] &&
    [[ "${base}" =~ ^proofofwork-(${surface_pattern})\.(failed|stage)-([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    printf '%s:%s\n' "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  if [[ "${parent}" == "${www_root}" ]] &&
    [[ "${base}" =~ ^\.staging-([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    printf 'staging:%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "${parent}" == "${www_root}" ]] &&
    [[ "${base}" =~ ^proofofwork-stage-([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    printf 'stage-root:%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "${parent}" == "${www_root}" ]] &&
    [[ "${base}" =~ ^proofofwork-ui-stage-([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    printf 'ui-stage-root:%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  if [[ "${parent}" == "${var_tmp_root}" ]] &&
    [[ "${base}" =~ ^proofofwork-ui-([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    printf 'var-tmp-ui:%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

register_candidate() {
  local path="$1"
  local descriptor class timestamp current
  descriptor="$(describe_candidate "${path}")" || return 0
  class="${descriptor%%:*}"
  if [[ -L "${path}" || ! -d "${path}" || "$(realpath -e "${path}")" != "${path}" ]]; then
    echo "Refusing noncanonical cleanup candidate: ${path}" >&2
    exit 1
  fi
  if [[ ! -e "${path}/${marker_name}" && ! -L "${path}/${marker_name}" ]]; then
    echo "Retaining unmarked cleanup candidate: ${path}" >&2
    return 0
  fi
  validate_marker "${path}" "${descriptor}"
  validate_candidate_tree "${path}"
  timestamp="$(stat --format=%Y -- "${path}")"
  if [[ ! "${timestamp}" =~ ^[0-9]+$ ]]; then
    echo "Unable to read cleanup candidate timestamp: ${path}" >&2
    exit 1
  fi
  current="${group_time[${descriptor}]:-0}"
  if ((timestamp > current)); then
    group_time["${descriptor}"]="${timestamp}"
  fi
  group_class["${descriptor}"]="${class}"
  group_paths["${descriptor}"]+="${path}"$'\n'
  path_time["${path}"]="${timestamp}"
}

while IFS= read -r -d '' path; do
  register_candidate "${path}"
done < <(find "${www_root}" -mindepth 1 -maxdepth 1 -type d -print0)
while IFS= read -r -d '' path; do
  register_candidate "${path}"
done < <(find "${var_tmp_root}" -mindepth 1 -maxdepth 1 -type d -print0)

classes=(failed stage staging stage-root ui-stage-root var-tmp-ui)
for class in "${classes[@]}"; do
  keep_sets=0
  minimum_age_seconds=259200
  case "${class}" in
    failed)
      keep_sets=1
      minimum_age_seconds=1209600
      ;;
    var-tmp-ui)
      minimum_age_seconds=604800
      ;;
  esac

  rows=()
  for descriptor in "${!group_time[@]}"; do
    if [[ "${group_class[${descriptor}]}" == "${class}" ]]; then
      rows+=("${group_time[${descriptor}]} ${descriptor}")
    fi
  done
  if ((${#rows[@]} == 0)); then
    continue
  fi
  mapfile -t ordered < <(printf '%s\n' "${rows[@]}" | sort -nr)
  for index in "${!ordered[@]}"; do
    descriptor="${ordered[${index}]#* }"
    timestamp="${group_time[${descriptor}]}"
    age_seconds=$((now - timestamp))
    if ((index < keep_sets || age_seconds < minimum_age_seconds)); then
      continue
    fi
    while IFS= read -r path; do
      if [[ -n "${path}" ]]; then
        deletions+=("${descriptor}"$'\t'"${path}")
      fi
    done <<<"${group_paths[${descriptor}]}"
  done
done

if ((${#deletions[@]} > max_paths)); then
  echo "Refusing to prune ${#deletions[@]} paths; safety cap is ${max_paths}." >&2
  exit 1
fi

reclaimed_bytes=0
for deletion in "${deletions[@]}"; do
  descriptor="${deletion%%$'\t'*}"
  path="${deletion#*$'\t'}"
  actual_descriptor="$(describe_candidate "${path}")" || {
    echo "Cleanup candidate left the allowlist: ${path}" >&2
    exit 1
  }
  if [[ "${actual_descriptor}" != "${descriptor}" ]] ||
    [[ -L "${path}" || ! -d "${path}" || "$(realpath -e "${path}")" != "${path}" ]]; then
    echo "Cleanup candidate changed during validation: ${path}" >&2
    exit 1
  fi
  validate_marker "${path}" "${descriptor}"
  validate_candidate_tree "${path}"
  actual_timestamp="$(stat --format=%Y -- "${path}")"
  if [[ "${actual_timestamp}" != "${path_time[${path}]}" ]]; then
    echo "Cleanup candidate timestamp changed during validation: ${path}" >&2
    exit 1
  fi
  bytes="$(du --summarize --block-size=1 -- "${path}" | awk '{print $1}')"
  if [[ ! "${bytes}" =~ ^[0-9]+$ ]]; then
    echo "Unable to measure cleanup candidate: ${path}" >&2
    exit 1
  fi
  validate_marker "${path}" "${descriptor}"
  validate_candidate_tree "${path}"
  if [[ "${mode}" == "--apply" ]]; then
    /usr/bin/rm --recursive --force --one-file-system -- "${path}"
    printf 'pruned group=%s bytes=%s path=%s\n' "${descriptor}" "${bytes}" "${path}"
  else
    printf 'would_prune group=%s bytes=%s path=%s\n' "${descriptor}" "${bytes}" "${path}"
  fi
  reclaimed_bytes=$((reclaimed_bytes + bytes))
done

printf 'ui_storage_prune mode=%s groups=%s candidate_paths=%s candidate_bytes=%s\n' \
  "${mode#--}" \
  "${#group_time[@]}" \
  "${#deletions[@]}" \
  "${reclaimed_bytes}"
