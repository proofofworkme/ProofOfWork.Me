#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:-}"
keep="${2:-}"
case "${root}:${keep}" in
  /var/backups/proofofwork-ui/releases:5)
    release_kind="ui"
    ui_manifest="${POW_RELEASE_UI_MANIFEST:-/var/www/.proofofwork-ui-release}"
    ;;
  /data/proofofwork-release-backups/managed:3)
    release_kind="node"
    node_checkout="${POW_RELEASE_NODE_CHECKOUT:-/opt/proofofwork-api}"
    ;;
  *)
    echo "Refusing unapproved release-retention target: ${root}:${keep}" >&2
    exit 1
    ;;
esac
if [[ ! -d "${root}" || -L "${root}" || "$(realpath -e "${root}")" != "${root}" ]]; then
  echo "Release-retention root must be a real canonical directory: ${root}" >&2
  exit 1
fi

evidence_file_is_safe() {
  local path="$1"
  local mode owner
  if [[ ! -f "${path}" || -L "${path}" ||
    "$(realpath -e -- "${path}")" != "${path}" ]]; then
    return 1
  fi
  mode="$(stat --format=%a -- "${path}")"
  owner="$(stat --format=%u -- "${path}")"
  [[ "${owner}" == "${EUID}" ]] && ((!(8#${mode} & 07022)))
}

declare -A protected_archives=()
if [[ "${release_kind}" == "ui" ]]; then
  if [[ "${ui_manifest}" != "/var/www/.proofofwork-ui-release" &&
    "${POW_RELEASE_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
    echo "Non-production UI release manifest requires POW_RELEASE_ALLOW_TEST_ROOTS=1." >&2
    exit 64
  fi
  if ! evidence_file_is_safe "${ui_manifest}"; then
    echo "Refusing retention without a canonical active UI release manifest." >&2
    exit 2
  fi
  active_archive=""
  archive_name_count=0
  while IFS= read -r manifest_line || [[ -n "${manifest_line}" ]]; do
    if [[ "${manifest_line}" == archive_name=* ]]; then
      active_archive="${manifest_line#archive_name=}"
      ((archive_name_count += 1))
    fi
  done <"${ui_manifest}"
  if ((archive_name_count != 1)) ||
    [[ ! "${active_archive}" =~ ^proofofwork-ui-release-[A-Za-z0-9._-]+\.tgz$ ]] ||
    ! evidence_file_is_safe "${root}/${active_archive}" ||
    ! evidence_file_is_safe "${root}/${active_archive}.sha256" ||
    ! evidence_file_is_safe "${root}/${active_archive}.provenance" ||
    ! /usr/bin/cmp --silent -- "${ui_manifest}" "${root}/${active_archive}.provenance"; then
    echo "Refusing retention without archive-bound active UI provenance." >&2
    exit 2
  fi
  protected_archives["${active_archive}"]=1
else
  if [[ "${node_checkout}" != "/opt/proofofwork-api" &&
    "${POW_RELEASE_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
    echo "Non-production node checkout requires POW_RELEASE_ALLOW_TEST_ROOTS=1." >&2
    exit 64
  fi
  if [[ ! -d "${node_checkout}" || -L "${node_checkout}" ||
    "$(realpath -e -- "${node_checkout}")" != "${node_checkout}" ]] ||
    [[ "$(/usr/bin/git -c safe.directory="${node_checkout}" -C "${node_checkout}" rev-parse --show-toplevel)" != "${node_checkout}" ]]; then
    echo "Refusing retention without a canonical live node checkout." >&2
    exit 2
  fi
  live_commit="$(/usr/bin/git -c safe.directory="${node_checkout}" -C "${node_checkout}" rev-parse --verify HEAD^{commit})"
  live_tree="$(/usr/bin/git -c safe.directory="${node_checkout}" -C "${node_checkout}" rev-parse --verify HEAD^{tree})"
  current_provenance_count=0
  while IFS= read -r -d '' provenance_file; do
    if ! evidence_file_is_safe "${provenance_file}"; then
      continue
    fi
    provenance_format=""
    provenance_archive=""
    provenance_digest=""
    provenance_bytes=""
    provenance_commit=""
    provenance_tree=""
    provenance_runtime_entry_count=""
    provenance_runtime_bytes=""
    provenance_runtime_sha256=""
    provenance_commit_time=""
    provenance_recorded_at=""
    provenance_invalid=0
    declare -A provenance_seen=()
    while IFS='=' read -r key value; do
      case "${key}" in
        format | archive | archive_sha256 | archive_bytes | commit | tree | runtime_entry_count | runtime_bytes | runtime_sha256 | commit_time | recorded_at)
          ;;
        *)
          provenance_invalid=1
          continue
          ;;
      esac
      if [[ -n "${provenance_seen[${key}]:-}" ]]; then
        provenance_invalid=1
        continue
      fi
      provenance_seen["${key}"]=1
      case "${key}" in
        format) provenance_format="${value}" ;;
        archive) provenance_archive="${value}" ;;
        archive_sha256) provenance_digest="${value}" ;;
        archive_bytes) provenance_bytes="${value}" ;;
        commit) provenance_commit="${value}" ;;
        tree) provenance_tree="${value}" ;;
        runtime_entry_count) provenance_runtime_entry_count="${value}" ;;
        runtime_bytes) provenance_runtime_bytes="${value}" ;;
        runtime_sha256) provenance_runtime_sha256="${value}" ;;
        commit_time) provenance_commit_time="${value}" ;;
        recorded_at) provenance_recorded_at="${value}" ;;
      esac
    done <"${provenance_file}"
    unset provenance_seen
    provenance_name="${provenance_file##*/}"
    provenance_name="${provenance_name%.provenance}"
    provenance_checksum="${root}/${provenance_archive}.sha256"
    provenance_checksum_digest=""
    provenance_checksum_name=""
    if [[ -f "${provenance_checksum}" && ! -L "${provenance_checksum}" ]]; then
      mapfile -t provenance_checksum_lines <"${provenance_checksum}"
      if ((${#provenance_checksum_lines[@]} == 1)) &&
        [[ "${provenance_checksum_lines[0]}" =~ ^([0-9a-fA-F]{64})\ \ (.+)$ ]]; then
        provenance_checksum_digest="${BASH_REMATCH[1],,}"
        provenance_checksum_name="${BASH_REMATCH[2]}"
      fi
    fi
    if ((provenance_invalid == 0)) &&
      [[ "${provenance_format}" == "proof-of-work-node-release-provenance-v2" ]] &&
      [[ "${provenance_archive}" == "${provenance_name}" ]] &&
      [[ "${provenance_digest}" =~ ^[0-9a-f]{64}$ ]] &&
      [[ "${provenance_checksum_digest}" == "${provenance_digest}" ]] &&
      [[ "${provenance_checksum_name}" == "${provenance_archive}" ||
        "${provenance_checksum_name}" == "${root}/${provenance_archive}" ]] &&
      [[ "${provenance_bytes}" =~ ^[1-9][0-9]*$ ]] &&
      [[ "${provenance_commit}" == "${live_commit}" ]] &&
      [[ "${provenance_tree}" == "${live_tree}" ]] &&
      [[ "${provenance_runtime_entry_count}" =~ ^[1-9][0-9]*$ ]] &&
      [[ "${provenance_runtime_bytes}" =~ ^[1-9][0-9]*$ ]] &&
      [[ "${provenance_runtime_sha256}" =~ ^[0-9a-f]{64}$ ]] &&
      [[ "${provenance_commit_time}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] &&
      [[ "${provenance_recorded_at}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] &&
      evidence_file_is_safe "${root}/${provenance_archive}" &&
      evidence_file_is_safe "${root}/${provenance_archive}.sha256" &&
      [[ "${provenance_bytes}" == "$(stat --format=%s -- "${root}/${provenance_archive}")" ]] &&
      (cd "${root}" && /usr/bin/sha256sum --check --status --strict "${provenance_archive}.sha256"); then
      protected_archives["${provenance_archive}"]=1
      ((current_provenance_count += 1))
    fi
  done < <(
    /usr/bin/find "${root}" -maxdepth 1 -type f \
      -name 'proofofwork-node-release-*.tgz.provenance' -print0
  )
  if ((current_provenance_count < 1)); then
    echo "Refusing retention without archive provenance for the live node commit and tree." >&2
    exit 2
  fi
fi

verified_archives=()
unverified_count=0
while IFS= read -r archive; do
  name="${archive#* }"
  if [[ ! "${name}" =~ ^proofofwork-${release_kind}-release-[A-Za-z0-9._-]+\.tgz$ ]]; then
    echo "Retaining release archive with a non-allowlisted name: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  checksum_file="${root}/${name}.sha256"
  if [[ ! -f "${checksum_file}" || -L "${checksum_file}" ]]; then
    echo "Retaining unverified release archive with no regular checksum sidecar: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  mapfile -t checksum_lines <"${checksum_file}"
  digest=""
  referenced_name=""
  if (( ${#checksum_lines[@]} == 1 )) &&
    [[ "${checksum_lines[0]}" =~ ^([0-9a-fA-F]{64})\ \ (.+)$ ]]; then
    digest="${BASH_REMATCH[1]}"
    referenced_name="${BASH_REMATCH[2]}"
  fi
  if [[ ! "${digest}" =~ ^[0-9a-fA-F]{64}$ ]] ||
    [[ "${referenced_name}" != "${name}" && "${referenced_name}" != "${root}/${name}" ]]; then
    echo "Retaining release archive with an invalid checksum sidecar: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  if [[ "${referenced_name}" == "${root}/${name}" ]]; then
    echo "Verified legacy absolute checksum target; normalize deliberately during a future release: ${name}" >&2
  fi
  if ! (
    cd "${root}"
    /usr/bin/sha256sum --check --status --strict "${name}.sha256"
  ); then
    echo "Retaining release archive that failed checksum validation: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  verified_archives+=("${archive}")
done < <(
  /usr/bin/find "${root}" -maxdepth 1 -type f \
    -name "proofofwork-${release_kind}-release-*.tgz" \
    -printf '%T@ %f\n' | /usr/bin/sort -nr
)
for ((index = keep; index < ${#verified_archives[@]}; index += 1)); do
  name="${verified_archives[index]#* }"
  if [[ -n "${protected_archives[${name}]:-}" ]]; then
    echo "Retaining active release archive outside the ordinary keep window: ${name}" >&2
    continue
  fi
  if [[ "${name}" =~ ^proofofwork-${release_kind}-release-[A-Za-z0-9._-]+\.tgz$ ]]; then
    /usr/bin/rm -f -- \
      "${root}/${name}" \
      "${root}/${name}.sha256" \
      "${root}/${name}.provenance"
  fi
done

if ((unverified_count > 0)); then
  echo "Retained ${unverified_count} unverified release archive(s); verified retention completed but integrity remains degraded." >&2
fi

/usr/bin/find "${root}" -maxdepth 1 -type f -name '.*.tmp' -mmin +1440 -delete

if ((unverified_count > 0)); then
  exit 2
fi
