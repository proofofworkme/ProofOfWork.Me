#!/usr/bin/env bash
set -Eeuo pipefail

warn_percent="${POW_STORAGE_WARN_PERCENT:-75}"
critical_percent="${POW_STORAGE_CRITICAL_PERCENT:-85}"
warn_inode_percent="${POW_STORAGE_WARN_INODE_PERCENT:-75}"
critical_inode_percent="${POW_STORAGE_CRITICAL_INODE_PERCENT:-85}"
root_min_free_bytes="${POW_STORAGE_ROOT_MIN_FREE_BYTES:-10737418240}"

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
if [[ ! "${root_min_free_bytes}" =~ ^[0-9]+$ ]] || ((root_min_free_bytes < 1)); then
  echo "Storage free-byte threshold must be a positive integer." >&2
  exit 64
fi
if ((warn_percent >= critical_percent)); then
  echo "Storage warning percentage must be lower than the critical percentage." >&2
  exit 64
fi
if ((warn_inode_percent >= critical_inode_percent)); then
  echo "Inode warning percentage must be lower than the critical percentage." >&2
  exit 64
fi

mounted_target="$(/usr/bin/findmnt --noheadings --output TARGET --target / | /usr/bin/head -n 1)"
if [[ "${mounted_target}" != "/" ]]; then
  echo "CRITICAL storage target / resolved to ${mounted_target:-missing}." >&2
  exit 2
fi

read -r filesystem used_field available_bytes < <(
  LC_ALL=C /usr/bin/df --block-size=1 --output=source,pcent,avail / | /usr/bin/tail -n 1
)
read -r inode_used_field available_inodes < <(
  LC_ALL=C /usr/bin/df --output=ipcent,iavail / | /usr/bin/tail -n 1
)
used_percent="${used_field%%%}"
inode_used_percent="${inode_used_field%%%}"
if [[ ! "${used_percent}" =~ ^[0-9]+$ ]] ||
  [[ ! "${inode_used_percent}" =~ ^[0-9]+$ ]] ||
  [[ ! "${available_bytes}" =~ ^[0-9]+$ ]] ||
  [[ ! "${available_inodes}" =~ ^[0-9]+$ ]]; then
  echo "CRITICAL unable to parse storage metrics for /." >&2
  exit 2
fi

printf 'storage target=/ filesystem=%s used_percent=%s inode_used_percent=%s available_bytes=%s available_inodes=%s\n' \
  "${filesystem}" \
  "${used_percent}" \
  "${inode_used_percent}" \
  "${available_bytes}" \
  "${available_inodes}"

if ((used_percent >= critical_percent)) ||
  ((inode_used_percent >= critical_inode_percent)) ||
  ((available_bytes < root_min_free_bytes)); then
  echo "CRITICAL UI storage runway breached for /." >&2
  exit 2
fi
if ((used_percent >= warn_percent)) ||
  ((inode_used_percent >= warn_inode_percent)); then
  echo "WARNING UI storage runway is narrowing for /." >&2
  exit 1
fi
