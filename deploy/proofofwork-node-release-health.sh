#!/usr/bin/env bash
set -Eeuo pipefail

retention_root="/data/proofofwork-release-backups/managed"
checkout="/opt/proofofwork-api"
checkout_parent="$(/usr/bin/dirname -- "${checkout}")"
max_checkout_count="${POW_RELEASE_MAX_CHECKOUT_COUNT:-9}"
if [[ ! "${max_checkout_count}" =~ ^[0-9]+$ ]] || ((max_checkout_count < 2)); then
  echo "Release checkout-count limit must be an integer of at least two." >&2
  exit 64
fi
for directory in "${retention_root}" "${checkout}"; do
  if [[ ! -d "${directory}" || -L "${directory}" ||
    "$(/usr/bin/realpath -e -- "${directory}")" != "${directory}" ]]; then
    echo "CRITICAL node release directory is not canonical: ${directory}" >&2
    exit 2
  fi
done
if [[ "$(GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" rev-parse --show-toplevel)" != "${checkout}" ]]; then
  echo "CRITICAL live node path is not its Git checkout root." >&2
  exit 2
fi
if GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" symbolic-ref --quiet HEAD >/dev/null; then
  echo "CRITICAL live node checkout is not detached." >&2
  exit 2
fi

live_commit="$(GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" rev-parse --verify HEAD^{commit})"
live_tree="$(GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" rev-parse --verify HEAD^{tree})"
if [[ ! "${live_commit}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ||
  ! "${live_tree}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  echo "CRITICAL live node commit or tree identity is invalid." >&2
  exit 2
fi

unexpected_path="$(
  GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" \
    ls-files --others --exclude-standard --directory | /usr/bin/sed -n '1p'
)"
if [[ -n "${unexpected_path}" ]]; then
  echo "CRITICAL live node checkout contains untracked non-ignored path: ${unexpected_path}" >&2
  exit 2
fi
while IFS= read -r -d '' ignored_path; do
  if [[ "${ignored_path}" != node_modules/* ]]; then
    echo "CRITICAL live node checkout contains non-runtime ignored path: ${ignored_path}" >&2
    exit 2
  fi
done < <(
  GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" \
    ls-files --others --ignored --exclude-standard -z
)
if [[ ! -d "${checkout}/node_modules" || -L "${checkout}/node_modules" ]]; then
  echo "CRITICAL live node checkout lacks a real node_modules runtime tree." >&2
  exit 2
fi

tracked_count=0
while IFS= read -r -d '' tree_record; do
  metadata="${tree_record%%$'\t'*}"
  tracked_path="${tree_record#*$'\t'}"
  read -r tracked_mode tracked_type tracked_object <<<"${metadata}"
  if [[ "${tracked_type}" != "blob" || "${tracked_path}" == /* ||
    "/${tracked_path}/" == *"/../"* || "${tracked_path}" == *\\* ||
    "${tracked_path}" =~ [[:cntrl:]] ]]; then
    echo "CRITICAL live node Git tree contains an unsupported path: ${tracked_path}" >&2
    exit 2
  fi
  live_path="${checkout}/${tracked_path}"
  case "${tracked_mode}" in
    100644 | 100755)
      if [[ ! -f "${live_path}" || -L "${live_path}" ]]; then
        echo "CRITICAL live node checkout is missing tracked file: ${tracked_path}" >&2
        exit 2
      fi
      file_mode="$(/usr/bin/stat --format=%a -- "${live_path}")"
      if ((8#${file_mode} & 07022)) ||
        [[ "${tracked_mode}" == "100755" && ! -x "${live_path}" ]] ||
        [[ "${tracked_mode}" == "100644" && -x "${live_path}" ]]; then
        echo "CRITICAL live node tracked mode is unsafe or differs from Git: ${tracked_path}" >&2
        exit 2
      fi
      actual_object="$(
        GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" \
          hash-object --no-filters -- "${live_path}"
      )"
      ;;
    120000)
      if [[ ! -L "${live_path}" ]]; then
        echo "CRITICAL live node checkout is missing tracked symlink: ${tracked_path}" >&2
        exit 2
      fi
      link_target="$(/usr/bin/readlink -- "${live_path}")"
      if [[ -z "${link_target}" || "${link_target}" == /* ||
        "$(/usr/bin/realpath -m -- "$(/usr/bin/dirname -- "${live_path}")/${link_target}")" != "${checkout}"/* ]]; then
        echo "CRITICAL live node tracked symlink escapes the checkout: ${tracked_path}" >&2
        exit 2
      fi
      actual_object="$(
        printf '%s' "${link_target}" |
          GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" hash-object --stdin
      )"
      ;;
    *)
      echo "CRITICAL live node Git tree contains unsupported mode ${tracked_mode}: ${tracked_path}" >&2
      exit 2
      ;;
  esac
  if [[ "${actual_object}" != "${tracked_object}" ]]; then
    echo "CRITICAL live node tracked bytes differ from Git tree: ${tracked_path}" >&2
    exit 2
  fi
  ((tracked_count += 1))
done < <(
  GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" \
    ls-tree -r -z --full-tree "${live_commit}"
)
if ((tracked_count < 1)); then
  echo "CRITICAL live node Git tree contains no tracked files." >&2
  exit 2
fi

# Use the same length-prefixed path/type/mode/content model as the publisher.
if ! runtime_attestation="$(/usr/bin/python3 -I - "${checkout}" <<'PY'
import hashlib
import os
import stat
import struct
import sys

root = os.path.realpath(sys.argv[1])
with open("/proc/self/mountinfo", encoding="utf-8") as mount_source:
    for line in mount_source:
        fields = line.split()
        if len(fields) < 5:
            raise SystemExit("Mount metadata contains a malformed record.")
        mount_point = (
            fields[4]
            .replace("\\040", " ")
            .replace("\\011", "\t")
            .replace("\\012", "\n")
            .replace("\\134", "\\")
        )
        mount_point = os.path.realpath(mount_point)
        try:
            nested = mount_point == root or os.path.commonpath((root, mount_point)) == root
        except ValueError:
            nested = False
        if nested:
            raise SystemExit(f"Checkout contains mounted content at {mount_point}.")

def safe_path(path):
    if (
        not path
        or path.startswith("/")
        or "\\" in path
        or any(part in ("", ".", "..") for part in path.split("/"))
        or any(ord(character) < 32 or ord(character) == 127 for character in path)
    ):
        raise SystemExit(f"Checkout contains an unsafe path: {path!r}")

root_stat = os.lstat(root)
owner = root_stat.st_uid
if not stat.S_ISDIR(root_stat.st_mode) or root_stat.st_mode & 0o7022:
    raise SystemExit("Checkout root has an unsafe mode.")

runtime_hash = hashlib.sha256()
runtime_count = 0
runtime_bytes = 0

def add_field(value):
    runtime_hash.update(struct.pack(">Q", len(value)))
    runtime_hash.update(value)

def record_runtime(relative, kind, mode, uid, gid, evidence=b""):
    global runtime_count
    add_field(os.fsencode(relative))
    add_field(kind)
    add_field(f"{stat.S_IMODE(mode):04o}".encode("ascii"))
    add_field(str(uid).encode("ascii"))
    add_field(str(gid).encode("ascii"))
    add_field(evidence)
    runtime_count += 1

def walk(directory, relative_directory=""):
    global runtime_bytes
    try:
        entries = sorted(os.scandir(directory), key=lambda entry: os.fsencode(entry.name))
    except OSError as error:
        raise SystemExit(f"Unable to enumerate checkout runtime: {error}") from error
    for entry in entries:
        relative = entry.name if not relative_directory else f"{relative_directory}/{entry.name}"
        safe_path(relative)
        try:
            details = entry.stat(follow_symlinks=False)
        except OSError as error:
            raise SystemExit(f"Unable to inspect checkout path {relative}: {error}") from error
        if details.st_uid != owner:
            raise SystemExit(f"Checkout contains foreign-owned path: {relative}")
        in_runtime = relative != ".git" and not relative.startswith(".git/")
        if stat.S_ISDIR(details.st_mode):
            if details.st_mode & 0o7022 or (details.st_mode & 0o500) != 0o500:
                raise SystemExit(f"Checkout directory has an unsafe mode: {relative}")
            if in_runtime:
                record_runtime(
                    relative, b"directory", details.st_mode, details.st_uid, details.st_gid
                )
            walk(entry.path, relative)
        elif stat.S_ISREG(details.st_mode):
            if details.st_mode & 0o7022 or not details.st_mode & 0o400:
                raise SystemExit(f"Checkout file has an unsafe mode: {relative}")
            if in_runtime:
                digest = hashlib.sha256()
                descriptor = os.open(entry.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                try:
                    opened = os.fstat(descriptor)
                    if (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_size) != (
                        details.st_dev,
                        details.st_ino,
                        details.st_mode,
                        details.st_size,
                    ):
                        raise SystemExit(f"Checkout file changed during attestation: {relative}")
                    while True:
                        chunk = os.read(descriptor, 1024 * 1024)
                        if not chunk:
                            break
                        digest.update(chunk)
                finally:
                    os.close(descriptor)
                runtime_bytes += details.st_size
                record_runtime(
                    relative,
                    b"file",
                    details.st_mode,
                    details.st_uid,
                    details.st_gid,
                    digest.digest(),
                )
        elif stat.S_ISLNK(details.st_mode):
            target = os.readlink(entry.path)
            if (
                not target
                or os.path.isabs(target)
                or "\\" in target
                or any(ord(character) < 32 or ord(character) == 127 for character in target)
            ):
                raise SystemExit(f"Checkout symbolic link is unsafe: {relative}")
            resolved = os.path.realpath(os.path.join(os.path.dirname(entry.path), target))
            try:
                contained = os.path.commonpath((root, resolved)) == root
            except ValueError:
                contained = False
            if not contained or not os.path.exists(resolved):
                raise SystemExit(f"Checkout symbolic link escapes or is dangling: {relative}")
            if in_runtime and (resolved == os.path.join(root, ".git") or resolved.startswith(os.path.join(root, ".git") + os.sep)):
                raise SystemExit(f"Runtime symbolic link enters Git metadata: {relative}")
            if in_runtime:
                record_runtime(
                    relative,
                    b"symlink",
                    details.st_mode,
                    details.st_uid,
                    details.st_gid,
                    os.fsencode(target),
                )
        else:
            raise SystemExit(f"Checkout contains unsupported file type: {relative}")

record_runtime(
    ".", b"directory", root_stat.st_mode, root_stat.st_uid, root_stat.st_gid
)
walk(root)
if runtime_count < 1 or runtime_bytes < 1:
    raise SystemExit("Checkout runtime attestation is empty.")
print(f"{runtime_count}\t{runtime_bytes}\t{runtime_hash.hexdigest()}")
PY
)"; then
  echo "CRITICAL live node runtime attestation failed." >&2
  exit 2
fi
IFS=$'\t' read -r live_runtime_entry_count live_runtime_bytes live_runtime_sha256 <<<"${runtime_attestation}"
if [[ ! "${live_runtime_entry_count}" =~ ^[1-9][0-9]*$ ||
  ! "${live_runtime_bytes}" =~ ^[1-9][0-9]*$ ||
  ! "${live_runtime_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "CRITICAL live node runtime attestation returned invalid evidence." >&2
  exit 2
fi
if [[ "$(GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" rev-parse --verify HEAD^{commit})" != "${live_commit}" ]] ||
  [[ "$(GIT_OPTIONAL_LOCKS=0 /usr/bin/git -c safe.directory="${checkout}" -C "${checkout}" rev-parse --verify HEAD^{tree})" != "${live_tree}" ]]; then
  echo "CRITICAL live node checkout changed during release-health attestation." >&2
  exit 2
fi

archive_count=0
unverified_count=0
legacy_absolute_count=0
provenance_count=0
current_provenance_count=0

while IFS= read -r archive; do
  ((archive_count += 1))
  name="${archive##*/}"
  if [[ ! "${name}" =~ ^proofofwork-node-release-[A-Za-z0-9._-]+\.tgz$ ]]; then
    echo "CRITICAL non-allowlisted node release archive: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  archive_mode="$(/usr/bin/stat --format=%a -- "${archive}")"
  archive_owner="$(/usr/bin/stat --format=%u -- "${archive}")"
  if ((8#${archive_mode} & 07022)) || [[ "${archive_owner}" != "${EUID}" ]]; then
    echo "CRITICAL node release archive has unsafe mode or ownership: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  checksum_file="${archive}.sha256"
  if [[ ! -f "${checksum_file}" || -L "${checksum_file}" ]]; then
    echo "CRITICAL node release archive lacks a regular checksum sidecar: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  checksum_mode="$(/usr/bin/stat --format=%a -- "${checksum_file}")"
  checksum_owner="$(/usr/bin/stat --format=%u -- "${checksum_file}")"
  if ((8#${checksum_mode} & 07022)) || [[ "${checksum_owner}" != "${EUID}" ]]; then
    echo "CRITICAL node release checksum has unsafe mode or ownership: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  mapfile -t checksum_lines <"${checksum_file}"
  digest=""
  referenced_name=""
  if ((${#checksum_lines[@]} == 1)) &&
    [[ "${checksum_lines[0]}" =~ ^([0-9a-fA-F]{64})\ \ (.+)$ ]]; then
    digest="${BASH_REMATCH[1],,}"
    referenced_name="${BASH_REMATCH[2]}"
  fi
  if [[ ! "${digest}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ "${referenced_name}" != "${name}" && "${referenced_name}" != "${retention_root}/${name}" ]]; then
    echo "CRITICAL node release checksum target is invalid: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  if [[ "${referenced_name}" == "${retention_root}/${name}" ]]; then
    ((legacy_absolute_count += 1))
  fi
  if ! (
    cd "${retention_root}"
    /usr/bin/sha256sum --check --status --strict "${name}.sha256"
  ); then
    echo "CRITICAL node release archive checksum failed: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi

  provenance_file="${archive}.provenance"
  if [[ ! -f "${provenance_file}" || -L "${provenance_file}" ]]; then
    echo "CRITICAL node release archive lacks v2 provenance: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  provenance_mode="$(/usr/bin/stat --format=%a -- "${provenance_file}")"
  provenance_owner="$(/usr/bin/stat --format=%u -- "${provenance_file}")"
  if ((8#${provenance_mode} & 07022)) || [[ "${provenance_owner}" != "${EUID}" ]]; then
    echo "CRITICAL node release provenance has unsafe mode or ownership: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  format=""
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
  declare -A seen_keys=()
  while IFS='=' read -r key value; do
    case "${key}" in
      format | archive | archive_sha256 | archive_bytes | commit | tree | runtime_entry_count | runtime_bytes | runtime_sha256 | commit_time | recorded_at) ;;
      *) provenance_invalid=1; continue ;;
    esac
    if [[ -n "${seen_keys[${key}]:-}" ]]; then
      provenance_invalid=1
      continue
    fi
    seen_keys["${key}"]=1
    case "${key}" in
      format) format="${value}" ;;
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
  unset seen_keys
  if ((provenance_invalid != 0)) ||
    [[ "${format}" != "proof-of-work-node-release-provenance-v2" ]] ||
    [[ "${provenance_archive}" != "${name}" ]] ||
    [[ "${provenance_digest}" != "${digest}" ]] ||
    [[ ! "${provenance_bytes}" =~ ^[1-9][0-9]*$ ]] ||
    [[ "${provenance_bytes}" != "$(/usr/bin/stat --format=%s -- "${archive}")" ]] ||
    [[ ! "${provenance_commit}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] ||
    [[ ! "${provenance_tree}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] ||
    [[ ! "${provenance_runtime_entry_count}" =~ ^[1-9][0-9]*$ ]] ||
    [[ ! "${provenance_runtime_bytes}" =~ ^[1-9][0-9]*$ ]] ||
    [[ ! "${provenance_runtime_sha256}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ ! "${provenance_commit_time}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] ||
    [[ ! "${provenance_recorded_at}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
    echo "CRITICAL node release provenance is invalid: ${name}" >&2
    ((unverified_count += 1))
    continue
  fi
  ((provenance_count += 1))
  if [[ "${provenance_commit}" == "${live_commit}" &&
    "${provenance_tree}" == "${live_tree}" &&
    "${provenance_runtime_entry_count}" == "${live_runtime_entry_count}" &&
    "${provenance_runtime_bytes}" == "${live_runtime_bytes}" &&
    "${provenance_runtime_sha256}" == "${live_runtime_sha256}" ]]; then
    ((current_provenance_count += 1))
  fi
done < <(
  /usr/bin/find "${retention_root}" -maxdepth 1 -type f \
    -name 'proofofwork-node-release-*.tgz' -print | /usr/bin/sort
)

checkout_count="$(
  /usr/bin/find "${checkout_parent}" -maxdepth 1 -mindepth 1 -type d -name 'proofofwork-api*' -printf '.\n' |
    /usr/bin/wc -l
)"
checkout_count="${checkout_count//[[:space:]]/}"
printf 'release live_commit=%s live_tree=%s runtime_sha256=%s archives=%s verified=%s unverified=%s legacy_absolute=%s provenance=%s current_provenance=%s opt_checkouts=%s\n' \
  "${live_commit}" \
  "${live_tree}" \
  "${live_runtime_sha256}" \
  "${archive_count}" \
  "$((archive_count - unverified_count))" \
  "${unverified_count}" \
  "${legacy_absolute_count}" \
  "${provenance_count}" \
  "${current_provenance_count}" \
  "${checkout_count}"

if ((unverified_count > 0)); then
  echo "CRITICAL unverified node release archives are retained for operator review." >&2
  exit 2
fi
if ((current_provenance_count < 1)); then
  echo "CRITICAL no verified retained archive proves the live node commit, tree, and runtime." >&2
  exit 2
fi
if ((checkout_count > max_checkout_count)); then
  echo "WARNING /opt contains more node release checkouts than the bounded inventory allows." >&2
  exit 1
fi
if ((legacy_absolute_count > 0)); then
  echo "WARNING legacy absolute checksum targets should be normalized during a future release." >&2
  exit 1
fi
