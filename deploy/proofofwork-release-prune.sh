#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:-}"
keep="${2:-}"
case "${root}:${keep}" in
  /var/backups/proofofwork-ui/releases:5)
    release_kind="ui"
    ;;
  /data/proofofwork-release-backups/managed:3)
    release_kind="node"
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

archives=()
while IFS= read -r archive; do
  name="${archive#* }"
  checksum_file="${root}/${name}.sha256"
  if [[ ! -f "${checksum_file}" || -L "${checksum_file}" ]]; then
    echo "Release archive is missing a checksum sidecar: ${name}" >&2
    exit 1
  fi
  mapfile -t checksum_lines <"${checksum_file}"
  digest=""
  referenced_name=""
  trailing=""
  if (( ${#checksum_lines[@]} == 1 )); then
    read -r digest referenced_name trailing <<<"${checksum_lines[0]}"
  fi
  if (
    ((${#checksum_lines[@]} != 1)) ||
    [[ ! "${digest}" =~ ^[0-9a-fA-F]{64}$ ]] ||
    [[ "${referenced_name}" != "${name}" ]] ||
    [[ -n "${trailing}" ]]
  ); then
    echo "Release checksum sidecar does not name exactly ${name}" >&2
    exit 1
  fi
  if ! (
    cd "${root}"
    /usr/bin/sha256sum --check --status --strict "${name}.sha256"
  ); then
    echo "Release archive failed checksum validation: ${name}" >&2
    exit 1
  fi
  archives+=("${archive}")
done < <(
  /usr/bin/find "${root}" -maxdepth 1 -type f \
    -name "proofofwork-${release_kind}-release-*.tgz" \
    -printf '%T@ %f\n' | /usr/bin/sort -nr
)
for ((index = keep; index < ${#archives[@]}; index += 1)); do
  name="${archives[index]#* }"
  if [[ "${name}" =~ ^proofofwork-${release_kind}-release-[A-Za-z0-9._-]+\.tgz$ ]]; then
    /usr/bin/rm -f -- "${root}/${name}" "${root}/${name}.sha256"
  fi
done

/usr/bin/find "${root}" -maxdepth 1 -type f -name '.*.tmp' -mmin +1440 -delete
