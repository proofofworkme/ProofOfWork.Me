#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:-}"
keep="${2:-}"
case "${root}:${keep}" in
  /var/backups/proofofwork-ui/releases:5)
    release_kind="ui"
    ui_manifest="${POW_RELEASE_UI_MANIFEST:-/var/www/.proofofwork-ui-release}"
    ui_rollback_root="${POW_RELEASE_UI_ROLLBACK_ROOT:-/var/backups/proofofwork-ui/rollback-roots}"
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
root_mode="$(stat --format=%a -- "${root}")"
root_owner="$(stat --format=%u -- "${root}")"
if [[ "${root_owner}" != "${EUID}" ]] || ((8#${root_mode} & 07022)); then
  echo "Release-retention root must be owner-controlled and not group/world writable: ${root}" >&2
  exit 1
fi

if [[ "${release_kind}" == "ui" ]]; then
  deploy_lock="${POW_UI_DEPLOY_LOCK:-/run/proofofwork-ui/deploy.lock}"
  if [[ "${deploy_lock}" != "/run/proofofwork-ui/deploy.lock" &&
    "${POW_RELEASE_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
    echo "Non-production UI deployment lock requires POW_RELEASE_ALLOW_TEST_ROOTS=1." >&2
    exit 64
  fi
  lock_parent="$(dirname -- "${deploy_lock}")"
  if [[ ! -d "${lock_parent}" || -L "${lock_parent}" ||
    "$(realpath -e -- "${lock_parent}" 2>/dev/null || true)" != "${lock_parent}" ]] ||
    [[ "$(stat --format=%u -- "${lock_parent}")" != "${EUID}" ]] ||
    ((8#$(stat --format=%a -- "${lock_parent}") & 07022)); then
    echo "UI deployment lock parent must be owner-controlled and not group/world writable." >&2
    exit 64
  fi
  if [[ -e "${deploy_lock}" || -L "${deploy_lock}" ]]; then
    if [[ ! -f "${deploy_lock}" || -L "${deploy_lock}" ||
      "$(realpath -e -- "${deploy_lock}" 2>/dev/null || true)" != "${deploy_lock}" ||
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
ui_surfaces=(
  activity
  browser
  boost
  computer
  desktop
  growth
  id
  inception
  infinity
  landing
  marketplace
  nft
  token
  wallet
  work
)
legacy_ui_surfaces=(
  activity
  browser
  computer
  desktop
  growth
  id
  inception
  infinity
  landing
  marketplace
  nft
  token
  wallet
  work
)
protect_ui_manifest_archive() {
  local manifest="$1"
  local label="$2"
  local manifest_line key value manifest_format manifest_archive manifest_digest
  local checksum_file checksum_digest="" checksum_name="" allowed_key surface
  local -a checksum_lines=()
  local -a manifest_surfaces=("${ui_surfaces[@]}")
  declare -A manifest_values=()
  declare -A manifest_seen=()
  if ! evidence_file_is_safe "${manifest}"; then
    echo "Refusing retention without canonical ${label} UI release provenance." >&2
    exit 2
  fi
  while IFS= read -r manifest_line || [[ -n "${manifest_line}" ]]; do
    if [[ "${manifest_line}" != *=* ]]; then
      echo "Refusing retention with malformed ${label} UI provenance." >&2
      exit 2
    fi
    key="${manifest_line%%=*}"
    value="${manifest_line#*=}"
    if [[ -n "${manifest_seen[${key}]:-}" ]]; then
      echo "Refusing retention with duplicate ${label} UI provenance key: ${key}" >&2
      exit 2
    fi
    manifest_seen["${key}"]=1
    manifest_values["${key}"]="${value}"
  done <"${manifest}"
  manifest_format="${manifest_values[format]:-}"
  case "${manifest_format}" in
    proofofwork-ui-release-v3 | proofofwork-ui-rollback-evidence-v1) ;;
    *)
      echo "Refusing retention with unknown ${label} UI provenance format: ${manifest_format}" >&2
      exit 2
      ;;
  esac
  for key in "${!manifest_values[@]}"; do
    allowed_key=false
    case "${key}" in
      format|archive_name|archive_sha256|archive_payload_model)
        allowed_key=true
        ;;
      release_id|commit|source_tree|source_attestation|source_dependency_model|source_dependency_entry_count|source_dependency_bytes|source_dependency_sha256|deployed_at)
        if [[ "${manifest_format}" == "proofofwork-ui-release-v3" ]]; then
          allowed_key=true
        fi
        ;;
      scope|model|recorded_at)
        if [[ "${manifest_format}" == "proofofwork-ui-rollback-evidence-v1" ]]; then
          allowed_key=true
        fi
        ;;
    esac
    if [[ "${allowed_key}" != "true" ]]; then
      for surface in "${ui_surfaces[@]}"; do
        if [[ "${key}" == "surface.${surface}.file_count" ||
          "${key}" == "surface.${surface}.sha256" ]]; then
          allowed_key=true
          break
        fi
      done
    fi
    if [[ "${allowed_key}" != "true" ]]; then
      echo "Refusing retention with unknown ${label} UI provenance key: ${key}" >&2
      exit 2
    fi
  done

  if [[ "${manifest_format}" == "proofofwork-ui-release-v3" ]]; then
    if [[ ! "${manifest_values[release_id]:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] ||
      [[ ! "${manifest_values[commit]:-}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] ||
      [[ ! "${manifest_values[source_tree]:-}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] ||
      [[ "${manifest_values[source_attestation]:-}" != "detached-recursive-git-tree-v1" ]] ||
      [[ "${manifest_values[source_dependency_model]:-}" != "node-modules-recursive-v1" ]] ||
      [[ ! "${manifest_values[source_dependency_entry_count]:-}" =~ ^[1-9][0-9]*$ ]] ||
      [[ ! "${manifest_values[source_dependency_bytes]:-}" =~ ^[1-9][0-9]*$ ]] ||
      [[ ! "${manifest_values[source_dependency_sha256]:-}" =~ ^[0-9a-f]{64}$ ]] ||
      [[ ! "${manifest_values[deployed_at]:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
      echo "Refusing retention with malformed ${label} UI release v3 provenance." >&2
      exit 2
    fi
  elif [[ "${manifest_values[scope]:-}" != "ui-surfaces-only" ||
    "${manifest_values[model]:-}" != "exact-surface-files-bytes-and-modes-v1" ||
    ! "${manifest_values[recorded_at]:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    echo "Refusing retention with malformed ${label} UI rollback evidence." >&2
    exit 2
  fi

  manifest_archive="${manifest_values[archive_name]:-}"
  manifest_digest="${manifest_values[archive_sha256]:-}"
  if [[ ! "${manifest_archive}" =~ ^proofofwork-ui-release-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.tgz$ ]] ||
    [[ ! "${manifest_digest}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ "${manifest_values[archive_payload_model]:-}" != "surfaces-v1" ]] ||
    ! evidence_file_is_safe "${root}/${manifest_archive}" ||
    ! evidence_file_is_safe "${root}/${manifest_archive}.sha256" ||
    ! evidence_file_is_safe "${root}/${manifest_archive}.provenance" ||
    ! /usr/bin/cmp --silent -- "${manifest}" "${root}/${manifest_archive}.provenance"; then
    echo "Refusing retention without archive-bound ${label} UI provenance." >&2
    exit 2
  fi
  if [[ -z "${manifest_values[surface.boost.file_count]:-}" &&
    -z "${manifest_values[surface.boost.sha256]:-}" ]]; then
    manifest_surfaces=("${legacy_ui_surfaces[@]}")
  fi
  for surface in "${manifest_surfaces[@]}"; do
    if [[ ! "${manifest_values[surface.${surface}.file_count]:-}" =~ ^[1-9][0-9]*$ ||
      ! "${manifest_values[surface.${surface}.sha256]:-}" =~ ^[0-9a-f]{64}$ ]]; then
      echo "Refusing retention with incomplete ${label} UI surface evidence: ${surface}" >&2
      exit 2
    fi
  done
  if [[ "${manifest_values[surface.nft.file_count]}" != "${manifest_values[surface.computer.file_count]}" ||
    "${manifest_values[surface.nft.sha256]}" != "${manifest_values[surface.computer.sha256]}" ]]; then
    echo "Refusing retention with a drifted ${label} UI NFT compatibility alias." >&2
    exit 2
  fi
  checksum_file="${root}/${manifest_archive}.sha256"
  mapfile -t checksum_lines <"${checksum_file}"
  if ((${#checksum_lines[@]} == 1)) &&
    [[ "${checksum_lines[0]}" =~ ^([0-9a-fA-F]{64})\ \ (.+)$ ]]; then
    checksum_digest="${BASH_REMATCH[1],,}"
    checksum_name="${BASH_REMATCH[2]}"
  fi
  if [[ "${checksum_digest}" != "${manifest_digest}" ]] ||
    [[ "${checksum_name}" != "${manifest_archive}" &&
      "${checksum_name}" != "${root}/${manifest_archive}" ]] ||
    ! (cd "${root}" && /usr/bin/sha256sum --check --status --strict "${manifest_archive}.sha256"); then
    echo "Refusing retention with checksum-drifted ${label} UI provenance." >&2
    exit 2
  fi
  protected_archives["${manifest_archive}"]=1
}

if [[ "${release_kind}" == "ui" ]]; then
  if [[ "${ui_manifest}" != "/var/www/.proofofwork-ui-release" &&
    "${POW_RELEASE_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
    echo "Non-production UI release manifest requires POW_RELEASE_ALLOW_TEST_ROOTS=1." >&2
    exit 64
  fi
  if [[ "${ui_rollback_root}" != "/var/backups/proofofwork-ui/rollback-roots" &&
    "${POW_RELEASE_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
    echo "Non-production UI rollback root requires POW_RELEASE_ALLOW_TEST_ROOTS=1." >&2
    exit 64
  fi
  if [[ ! -d "${ui_rollback_root}" || -L "${ui_rollback_root}" ||
    "$(realpath -e -- "${ui_rollback_root}" 2>/dev/null || true)" != "${ui_rollback_root}" ]] ||
    [[ "$(stat --format=%u -- "${ui_rollback_root}" 2>/dev/null || true)" != "${EUID}" ]] ||
    ((8#$(stat --format=%a -- "${ui_rollback_root}" 2>/dev/null || echo 7777) & 07022)); then
    echo "UI rollback root must be a canonical owner-controlled directory." >&2
    exit 64
  fi
  protect_ui_manifest_archive "${ui_manifest}" "active"
  rollback_discovery_file="$(
    /usr/bin/mktemp \
      --tmpdir="${lock_parent}" \
      '.proofofwork-ui-rollback-discovery.XXXXXXXXXX'
  )"
  cleanup_rollback_discovery_file() {
    if [[ -n "${rollback_discovery_file:-}" ]]; then
      /usr/bin/rm -f -- "${rollback_discovery_file}" || true
    fi
  }
  trap cleanup_rollback_discovery_file EXIT
  if ! /usr/bin/find "${ui_rollback_root}" -mindepth 1 -maxdepth 1 \
    -name 'proofofwork-www-pre-*' -print0 >"${rollback_discovery_file}"; then
    echo "Refusing retention because complete-root UI rollback discovery failed." >&2
    exit 2
  fi
  mapfile -d '' -t rollback_roots <"${rollback_discovery_file}"
  /usr/bin/rm -f -- "${rollback_discovery_file}"
  rollback_discovery_file=""
  trap - EXIT
  if ((${#rollback_roots[@]} > 1)); then
    echo "Refusing retention with more than one complete-root UI rollback." >&2
    exit 2
  fi
  for rollback_checkout in "${rollback_roots[@]}"; do
    rollback_name="${rollback_checkout##*/}"
    if [[ ! "${rollback_name}" =~ ^proofofwork-www-pre-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] ||
      [[ ! -d "${rollback_checkout}" || -L "${rollback_checkout}" ||
        "$(realpath -e -- "${rollback_checkout}" 2>/dev/null || true)" != "${rollback_checkout}" ]] ||
      [[ "$(stat --format=%u -- "${rollback_checkout}" 2>/dev/null || true)" != "${EUID}" ]] ||
      ((8#$(stat --format=%a -- "${rollback_checkout}" 2>/dev/null || echo 7777) & 07022)); then
      echo "Complete-root UI rollback must be canonical and owner-controlled." >&2
      exit 2
    fi
    protect_ui_manifest_archive \
      "${rollback_checkout}/.proofofwork-ui-release" \
      "complete-root rollback"
  done
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
  provenance_discovery_file="$(
    /usr/bin/mktemp \
      --tmpdir="${root}" \
      '.proofofwork-node-provenance-discovery.XXXXXXXXXX'
  )"
  cleanup_provenance_discovery_file() {
    if [[ -n "${provenance_discovery_file:-}" ]]; then
      /usr/bin/rm -f -- "${provenance_discovery_file}" || true
    fi
  }
  trap cleanup_provenance_discovery_file EXIT
  if ! /usr/bin/find "${root}" -maxdepth 1 -type f \
    -name 'proofofwork-node-release-*.tgz.provenance' \
    -print0 >"${provenance_discovery_file}"; then
    echo "Refusing retention because node provenance discovery failed." >&2
    exit 2
  fi
  mapfile -d '' -t provenance_files <"${provenance_discovery_file}"
  /usr/bin/rm -f -- "${provenance_discovery_file}"
  provenance_discovery_file=""
  trap - EXIT
  for provenance_file in "${provenance_files[@]}"; do
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
  done
  if ((current_provenance_count < 1)); then
    echo "Refusing retention without archive provenance for the live node commit and tree." >&2
    exit 2
  fi
fi

verified_archives=()
unverified_count=0
archive_discovery_file="$(
  /usr/bin/mktemp \
    --tmpdir="${root}" \
    '.proofofwork-release-archive-discovery.XXXXXXXXXX'
)"
cleanup_archive_discovery_file() {
  if [[ -n "${archive_discovery_file:-}" ]]; then
    /usr/bin/rm -f -- "${archive_discovery_file}" || true
  fi
}
trap cleanup_archive_discovery_file EXIT
if ! /usr/bin/find "${root}" -maxdepth 1 -type f \
  -name "proofofwork-${release_kind}-release-*.tgz" \
  -printf '%T@ %f\n' >"${archive_discovery_file}"; then
  echo "Refusing retention because release archive discovery failed." >&2
  exit 2
fi
if ! LC_ALL=C /usr/bin/sort -nr \
  --output="${archive_discovery_file}" \
  -- "${archive_discovery_file}"; then
  echo "Refusing retention because release archive ordering failed." >&2
  exit 2
fi
mapfile -t archive_candidates <"${archive_discovery_file}"
/usr/bin/rm -f -- "${archive_discovery_file}"
archive_discovery_file=""
trap - EXIT
for archive in "${archive_candidates[@]}"; do
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
done
stale_temporary_discovery_file="$(
  /usr/bin/mktemp \
    --tmpdir="${root}" \
    '.proofofwork-stale-temporary-discovery.XXXXXXXXXX'
)"
cleanup_stale_temporary_discovery_file() {
  if [[ -n "${stale_temporary_discovery_file:-}" ]]; then
    /usr/bin/rm -f -- "${stale_temporary_discovery_file}" || true
  fi
}
trap cleanup_stale_temporary_discovery_file EXIT
if ! /usr/bin/find "${root}" -maxdepth 1 -type f \
  -name '.*.tmp' -mmin +1440 -print0 >"${stale_temporary_discovery_file}"; then
  echo "Refusing retention because stale temporary discovery failed." >&2
  exit 2
fi
mapfile -d '' -t stale_temporary_files <"${stale_temporary_discovery_file}"
/usr/bin/rm -f -- "${stale_temporary_discovery_file}"
stale_temporary_discovery_file=""
trap - EXIT
for stale_temporary_file in "${stale_temporary_files[@]}"; do
  stale_temporary_name="${stale_temporary_file##*/}"
  if [[ ! "${stale_temporary_name}" =~ ^\..+\.tmp$ ]] ||
    ! evidence_file_is_safe "${stale_temporary_file}" ||
    [[ "$(dirname -- "${stale_temporary_file}")" != "${root}" ]]; then
    echo "Refusing retention with unsafe stale temporary evidence: ${stale_temporary_file}" >&2
    exit 2
  fi
done
for ((index = keep; index < ${#verified_archives[@]}; index += 1)); do
  name="${verified_archives[index]#* }"
  if [[ -n "${protected_archives[${name}]:-}" ]]; then
    echo "Retaining active or rollback release archive outside the ordinary keep window: ${name}" >&2
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

for stale_temporary_file in "${stale_temporary_files[@]}"; do
  /usr/bin/rm -f -- "${stale_temporary_file}"
done

if ((unverified_count > 0)); then
  exit 2
fi
