#!/usr/bin/env bash
set -Eeuo pipefail

warn_percent="${POW_STORAGE_WARN_PERCENT:-75}"
critical_percent="${POW_STORAGE_CRITICAL_PERCENT:-85}"
warn_inode_percent="${POW_STORAGE_WARN_INODE_PERCENT:-75}"
critical_inode_percent="${POW_STORAGE_CRITICAL_INODE_PERCENT:-85}"
root_min_free_bytes="${POW_STORAGE_ROOT_MIN_FREE_BYTES:-10737418240}"
data_min_free_bytes="${POW_STORAGE_DATA_MIN_FREE_BYTES:-107374182400}"

for value in \
  "${warn_percent}" \
  "${critical_percent}" \
  "${warn_inode_percent}" \
  "${critical_inode_percent}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 1 || value > 100)); then
    echo "Storage percentage thresholds must be integers from 1 through 100." >&2
    exit 64
  fi
done
for value in "${root_min_free_bytes}" "${data_min_free_bytes}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 1)); then
    echo "Storage free-byte thresholds must be positive integers." >&2
    exit 64
  fi
done
if ((warn_percent >= critical_percent)); then
  echo "Storage warning percentage must be lower than the critical percentage." >&2
  exit 64
fi
if ((warn_inode_percent >= critical_inode_percent)); then
  echo "Inode warning percentage must be lower than the critical percentage." >&2
  exit 64
fi

warnings=0
criticals=0
targets=("/" "/data")

for target in "${targets[@]}"; do
  mounted_target=""
  if ! mounted_target="$(/usr/bin/findmnt --noheadings --output TARGET --target "${target}" | /usr/bin/head -n 1)"; then
    mounted_target=""
  fi
  if [[ "${mounted_target}" != "${target}" ]]; then
    echo "CRITICAL storage target is not its own expected mount: ${target} resolved to ${mounted_target:-missing}" >&2
    ((criticals += 1))
    continue
  fi

  if ! read -r filesystem used_field available_bytes < <(
    LC_ALL=C /usr/bin/df --block-size=1 --output=source,pcent,avail "${target}" | /usr/bin/tail -n 1
  ); then
    echo "CRITICAL unable to read storage metrics for ${target}." >&2
    ((criticals += 1))
    continue
  fi
  if ! read -r inode_used_field available_inodes < <(
    LC_ALL=C /usr/bin/df --output=ipcent,iavail "${target}" | /usr/bin/tail -n 1
  ); then
    echo "CRITICAL unable to read inode metrics for ${target}." >&2
    ((criticals += 1))
    continue
  fi
  used_percent="${used_field%%%}"
  inode_used_percent="${inode_used_field%%%}"
  if [[ ! "${used_percent}" =~ ^[0-9]+$ ]] ||
    [[ ! "${inode_used_percent}" =~ ^[0-9]+$ ]] ||
    [[ ! "${available_bytes}" =~ ^[0-9]+$ ]] ||
    [[ ! "${available_inodes}" =~ ^[0-9]+$ ]]; then
    echo "CRITICAL unable to parse storage metrics for ${target}." >&2
    ((criticals += 1))
    continue
  fi

  minimum_available_bytes="${root_min_free_bytes}"
  if [[ "${target}" == "/data" ]]; then
    minimum_available_bytes="${data_min_free_bytes}"
  fi
  printf 'storage target=%s filesystem=%s used_percent=%s inode_used_percent=%s available_bytes=%s available_inodes=%s\n' \
    "${target}" \
    "${filesystem}" \
    "${used_percent}" \
    "${inode_used_percent}" \
    "${available_bytes}" \
    "${available_inodes}"

  if ((used_percent >= critical_percent)) ||
    ((inode_used_percent >= critical_inode_percent)) ||
    ((available_bytes < minimum_available_bytes)); then
    echo "CRITICAL storage runway breached for ${target}." >&2
    ((criticals += 1))
  elif ((used_percent >= warn_percent)) ||
    ((inode_used_percent >= warn_inode_percent)); then
    echo "WARNING storage runway is narrowing for ${target}." >&2
    ((warnings += 1))
  fi
done

if ((criticals > 0)); then
  exit 2
fi
if ((warnings > 0)); then
  exit 1
fi
