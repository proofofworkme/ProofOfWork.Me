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

# The live checkout is writable by the unprivileged runtime/deploy account while
# this retention validator has narrowly elevated read/traverse access. Never let
# Git inherit process, user, system, or repository configuration that can launch
# helpers. Runtime configuration has higher precedence than repository-local
# config and is inherited by child upload-pack/pack-objects processes as well.
# Git appends its canonical `git pack-objects` argv to packObjectsHook; the fixed
# `/usr/bin/env` prefix preserves that argv under the isolated PATH without
# permitting the repository to choose a command.
isolated_git_environment() {
  local trusted_checkout="$1"
  shift
  /usr/bin/env --ignore-environment \
    PATH=/usr/bin:/bin \
    LC_ALL=C \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_SYSTEM=/dev/null \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_OPTIONAL_LOCKS=0 \
    GIT_NO_LAZY_FETCH=1 \
    GIT_NO_REPLACE_OBJECTS=1 \
    GIT_LITERAL_PATHSPECS=1 \
    GIT_ATTR_NOSYSTEM=1 \
    GIT_TERMINAL_PROMPT=0 \
    GIT_PAGER= \
    PAGER= \
    GIT_EDITOR=/usr/bin/false \
    GIT_SEQUENCE_EDITOR=/usr/bin/false \
    GIT_ASKPASS=/usr/bin/false \
    SSH_ASKPASS=/usr/bin/false \
    GIT_SSH=/usr/bin/false \
    GIT_SSH_COMMAND=/usr/bin/false \
    GIT_PROXY_COMMAND=/usr/bin/false \
    GIT_EXTERNAL_DIFF=/usr/bin/false \
    GIT_CONFIG_COUNT=35 \
    GIT_CONFIG_KEY_0=safe.directory \
    "GIT_CONFIG_VALUE_0=${trusted_checkout}" \
    GIT_CONFIG_KEY_1=safe.directory \
    "GIT_CONFIG_VALUE_1=${trusted_checkout}/.git" \
    GIT_CONFIG_KEY_2=core.fsmonitor \
    GIT_CONFIG_VALUE_2=false \
    GIT_CONFIG_KEY_3=core.untrackedCache \
    GIT_CONFIG_VALUE_3=false \
    GIT_CONFIG_KEY_4=core.hooksPath \
    GIT_CONFIG_VALUE_4=/dev/null \
    GIT_CONFIG_KEY_5=core.pager \
    GIT_CONFIG_VALUE_5=cat \
    GIT_CONFIG_KEY_6=pager.show \
    GIT_CONFIG_VALUE_6=false \
    GIT_CONFIG_KEY_7=log.showSignature \
    GIT_CONFIG_VALUE_7=false \
    GIT_CONFIG_KEY_8=maintenance.auto \
    GIT_CONFIG_VALUE_8=0 \
    GIT_CONFIG_KEY_9=gc.auto \
    GIT_CONFIG_VALUE_9=0 \
    GIT_CONFIG_KEY_10=gc.autoDetach \
    GIT_CONFIG_VALUE_10=false \
    GIT_CONFIG_KEY_11=protocol.allow \
    GIT_CONFIG_VALUE_11=never \
    GIT_CONFIG_KEY_12=protocol.file.allow \
    GIT_CONFIG_VALUE_12=always \
    GIT_CONFIG_KEY_13=uploadpack.packObjectsHook \
    GIT_CONFIG_VALUE_13=/usr/bin/env \
    GIT_CONFIG_KEY_14=core.alternateRefsCommand \
    GIT_CONFIG_VALUE_14=/usr/bin/false \
    GIT_CONFIG_KEY_15=credential.helper \
    GIT_CONFIG_VALUE_15= \
    GIT_CONFIG_KEY_16=core.askPass \
    GIT_CONFIG_VALUE_16=/usr/bin/false \
    GIT_CONFIG_KEY_17=core.sshCommand \
    GIT_CONFIG_VALUE_17=/usr/bin/false \
    GIT_CONFIG_KEY_18=submodule.recurse \
    GIT_CONFIG_VALUE_18=false \
    GIT_CONFIG_KEY_19=fetch.recurseSubmodules \
    GIT_CONFIG_VALUE_19=false \
    GIT_CONFIG_KEY_20=core.excludesFile \
    GIT_CONFIG_VALUE_20=/dev/null \
    GIT_CONFIG_KEY_21=core.attributesFile \
    GIT_CONFIG_VALUE_21=/dev/null \
    GIT_CONFIG_KEY_22=core.sparseCheckout \
    GIT_CONFIG_VALUE_22=false \
    GIT_CONFIG_KEY_23=core.sparseCheckoutCone \
    GIT_CONFIG_VALUE_23=false \
    GIT_CONFIG_KEY_24=fetch.fsckObjects \
    GIT_CONFIG_VALUE_24=true \
    GIT_CONFIG_KEY_25=transfer.fsckObjects \
    GIT_CONFIG_VALUE_25=true \
    GIT_CONFIG_KEY_26=receive.fsckObjects \
    GIT_CONFIG_VALUE_26=true \
    GIT_CONFIG_KEY_27=pack.threads \
    GIT_CONFIG_VALUE_27=1 \
    GIT_CONFIG_KEY_28=pack.windowMemory \
    GIT_CONFIG_VALUE_28=32m \
    GIT_CONFIG_KEY_29=pack.deltaCacheSize \
    GIT_CONFIG_VALUE_29=32m \
    GIT_CONFIG_KEY_30=core.fileMode \
    GIT_CONFIG_VALUE_30=true \
    GIT_CONFIG_KEY_31=core.symlinks \
    GIT_CONFIG_VALUE_31=true \
    GIT_CONFIG_KEY_32=core.ignoreCase \
    GIT_CONFIG_VALUE_32=false \
    GIT_CONFIG_KEY_33=core.precomposeUnicode \
    GIT_CONFIG_VALUE_33=false \
    GIT_CONFIG_KEY_34=advice.detachedHead \
    GIT_CONFIG_VALUE_34=false \
    "$@"
}

isolated_checkout_git() {
  local trusted_checkout="$1"
  shift
  isolated_git_environment "${trusted_checkout}" \
    /usr/bin/git \
    --git-dir="${trusted_checkout}/.git" \
    --work-tree="${trusted_checkout}" \
    "$@"
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
    [[ "$(isolated_checkout_git "${node_checkout}" rev-parse --show-toplevel)" != "${node_checkout}" ]]; then
    echo "Refusing retention without a canonical live node checkout." >&2
    exit 2
  fi
  live_commit="$(isolated_checkout_git "${node_checkout}" rev-parse --verify HEAD^{commit})"
  live_tree="$(isolated_checkout_git "${node_checkout}" rev-parse --verify HEAD^{tree})"
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
