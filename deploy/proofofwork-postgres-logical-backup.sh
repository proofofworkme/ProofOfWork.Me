#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

backup_root="/data/proofofwork-postgres-backups/logical"
keep=14
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
basename="proof_indexer-${timestamp}.dumpset"
temporary_set="${backup_root}/.${basename}.tmp"
final_set="${backup_root}/${basename}"

cleanup() {
  rm -rf -- "${temporary_set}"
}
trap cleanup EXIT

if [[ ! -d "${backup_root}" || -L "${backup_root}" ]]; then
  echo "Backup root must be a real directory: ${backup_root}" >&2
  exit 1
fi
if [[ "$(realpath -e "${backup_root}")" != "${backup_root}" ]]; then
  echo "Backup root resolved outside its canonical path." >&2
  exit 1
fi
if [[ -e "${temporary_set}" || -e "${final_set}" ]]; then
  echo "Backup set already exists: ${basename}" >&2
  exit 1
fi

/usr/bin/mkdir --mode=0700 "${temporary_set}"
/usr/bin/pg_dump \
  --dbname=proof_indexer \
  --format=custom \
  --compress=gzip:6 \
  --file="${temporary_set}/proof_indexer.dump"
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
/usr/bin/sync -f "${backup_root}"

mapfile -t backups < <(
  /usr/bin/find "${backup_root}" -maxdepth 1 -mindepth 1 -type d \
    -name 'proof_indexer-*.dumpset' -printf '%T@ %f\n' | /usr/bin/sort -nr
)
for ((index = keep; index < ${#backups[@]}; index += 1)); do
  name="${backups[index]#* }"
  if [[ "${name}" =~ ^proof_indexer-[0-9]{8}T[0-9]{6}Z\.dumpset$ ]]; then
    /usr/bin/rm -rf -- "${backup_root}/${name}"
  fi
done
/usr/bin/find "${backup_root}" -maxdepth 1 -mindepth 1 -type d \
  -name '.proof_indexer-*.dumpset.tmp' -mmin +1440 -exec /usr/bin/rm -rf -- {} +

trap - EXIT
