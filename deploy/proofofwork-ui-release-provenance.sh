#!/usr/bin/env bash
set -Eeuo pipefail

command="${1:-verify}"
if (($# > 0)); then
  shift
fi
ui_root="${POW_UI_WWW_ROOT:-/var/www}"
archive_root="${POW_UI_RELEASE_ARCHIVE_ROOT:-/var/backups/proofofwork-ui/releases}"
if [[ "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]] && {
  [[ -n "${POW_UI_TEST_FAIL_IGNORED_DISCOVERY_AFTER_OUTPUT:-}" ]] ||
    [[ -n "${POW_UI_TEST_FAIL_SURFACE_DISCOVERY_AFTER_OUTPUT:-}" ]] ||
    [[ -n "${POW_UI_TEST_FAIL_ARCHIVE_TOP_LEVEL_DISCOVERY_AFTER_OUTPUT:-}" ]];
}; then
  echo "UI provenance failure injection requires POW_UI_ALLOW_TEST_ROOTS=1." >&2
  exit 64
fi
if [[ "${ui_root}" != "/var/www" || "${archive_root}" != "/var/backups/proofofwork-ui/releases" ]] &&
  [[ "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
  if [[ "${POW_UI_STAGED_ROOT:-}" != "1" ||
    "${archive_root}" != "/var/backups/proofofwork-ui/releases" ||
    ! "${ui_root}" =~ ^/var/tmp/proofofwork-deploy/proofofwork-www-stage-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "Non-production UI/archive roots require an allowlisted staged root or POW_UI_ALLOW_TEST_ROOTS=1." >&2
    exit 64
  fi
fi
for root in "${ui_root}" "${archive_root}"; do
  if [[ ! -d "${root}" || -L "${root}" || "$(realpath -e "${root}")" != "${root}" ]]; then
    echo "UI provenance root must be a real canonical directory: ${root}" >&2
    exit 64
  fi
done
ui_root_mode="$(stat --format=%a -- "${ui_root}")"
ui_root_owner="$(stat --format=%u -- "${ui_root}")"
if ((8#${ui_root_mode} & 07022)) || [[ "${ui_root_owner}" != "${EUID}" ]]; then
  echo "UI root must be owner-controlled and not group/world writable: ${ui_root}" >&2
  exit 64
fi
archive_root_mode="$(stat --format=%a -- "${archive_root}")"
archive_root_owner="$(stat --format=%u -- "${archive_root}")"
if ((8#${archive_root_mode} & 07022)) || [[ "${archive_root_owner}" != "${EUID}" ]]; then
  echo "UI archive root must be owner-controlled and not group/world writable: ${archive_root}" >&2
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

manifest="${ui_root}/.proofofwork-ui-release"
surfaces=(
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
if ((${#surfaces[@]} != 15)); then
  echo "UI provenance surface set must contain exactly 15 entries." >&2
  exit 70
fi
declare -A surface_seen=()
for surface in "${surfaces[@]}"; do
  if [[ -n "${surface_seen[${surface}]:-}" ]]; then
    echo "UI provenance surface set contains a duplicate: ${surface}" >&2
    exit 70
  fi
  surface_seen["${surface}"]=1
done
unset surface_seen surface
surface_pattern='activity|browser|boost|computer|desktop|growth|id|inception|infinity|landing|marketplace|nft|token|wallet|work'

surface_directory() {
  printf '%s/proofofwork-%s\n' "${ui_root}" "$1"
}

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
            raise SystemExit(f"Refusing a release tree containing nested mount {mount_point}.")
PY
}

attested_source_commit=""
attested_source_tree=""
attested_dependency_entry_count=""
attested_dependency_bytes=""
attested_dependency_sha256=""
attest_source_dependencies() {
  local source_checkout="$1"
  /usr/bin/python3 -I - "${source_checkout}" <<'PY'
import hashlib
import os
import stat
import struct
import sys

source_root = os.path.realpath(sys.argv[1])
dependency_root = os.path.join(source_root, "node_modules")
try:
    source_stat = os.lstat(source_root)
    dependency_stat = os.lstat(dependency_root)
except FileNotFoundError as error:
    raise SystemExit("UI source checkout lacks its node_modules dependency tree.") from error
if not stat.S_ISDIR(dependency_stat.st_mode) or os.path.islink(dependency_root):
    raise SystemExit("UI source node_modules dependency tree is not a real directory.")
owner = source_stat.st_uid
if dependency_stat.st_uid != owner or dependency_stat.st_mode & 0o7022:
    raise SystemExit("UI source node_modules has unsafe mode or ownership.")

tree_hash = hashlib.sha256()
entry_count = 0
regular_bytes = 0

def safe_path(path):
    if (
        not path
        or path.startswith("/")
        or "\\" in path
        or any(part in ("", ".", "..", ".git") for part in path.split("/"))
        or any(ord(character) < 32 or ord(character) == 127 for character in path)
    ):
        raise SystemExit(f"UI dependency tree contains an unsafe path: {path!r}")

def add_field(value):
    tree_hash.update(struct.pack(">Q", len(value)))
    tree_hash.update(value)

def record(relative, kind, details, evidence=b""):
    global entry_count
    add_field(os.fsencode(relative))
    add_field(kind)
    add_field(f"{stat.S_IMODE(details.st_mode):04o}".encode("ascii"))
    add_field(str(details.st_uid).encode("ascii"))
    add_field(str(details.st_gid).encode("ascii"))
    add_field(evidence)
    entry_count += 1
    if entry_count > 250_000:
        raise SystemExit("UI dependency tree exceeds the entry-count safety limit.")

def walk(directory, relative_directory=""):
    global regular_bytes
    try:
        entries = sorted(os.scandir(directory), key=lambda entry: os.fsencode(entry.name))
    except OSError as error:
        raise SystemExit(f"Unable to enumerate UI dependencies: {error}") from error
    for entry in entries:
        relative = entry.name if not relative_directory else f"{relative_directory}/{entry.name}"
        safe_path(relative)
        details = entry.stat(follow_symlinks=False)
        if details.st_uid != owner:
            raise SystemExit(f"UI dependency tree contains foreign-owned path: {relative}")
        if stat.S_ISDIR(details.st_mode):
            if details.st_mode & 0o7022 or (details.st_mode & 0o500) != 0o500:
                raise SystemExit(f"UI dependency directory has an unsafe mode: {relative}")
            record(relative, b"directory", details)
            walk(entry.path, relative)
        elif stat.S_ISREG(details.st_mode):
            if details.st_mode & 0o7022 or not details.st_mode & 0o400:
                raise SystemExit(f"UI dependency file has an unsafe mode: {relative}")
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
                    raise SystemExit(f"UI dependency changed during attestation: {relative}")
                while True:
                    chunk = os.read(descriptor, 1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
            finally:
                os.close(descriptor)
            regular_bytes += details.st_size
            if regular_bytes > 4 * 1024 * 1024 * 1024:
                raise SystemExit("UI dependency tree exceeds the 4 GiB safety limit.")
            record(relative, b"file", details, digest.digest())
        elif stat.S_ISLNK(details.st_mode):
            target = os.readlink(entry.path)
            if (
                not target
                or os.path.isabs(target)
                or "\\" in target
                or any(ord(character) < 32 or ord(character) == 127 for character in target)
            ):
                raise SystemExit(f"UI dependency symbolic link is unsafe: {relative}")
            resolved = os.path.realpath(os.path.join(os.path.dirname(entry.path), target))
            try:
                contained = os.path.commonpath((source_root, resolved)) == source_root
            except ValueError:
                contained = False
            if not contained or not os.path.exists(resolved):
                raise SystemExit(f"UI dependency symbolic link escapes or is dangling: {relative}")
            if resolved == os.path.join(source_root, ".git") or resolved.startswith(os.path.join(source_root, ".git") + os.sep):
                raise SystemExit(f"UI dependency symbolic link enters Git metadata: {relative}")
            record(relative, b"symlink", details, os.fsencode(target))
        else:
            raise SystemExit(f"UI dependency tree contains unsupported file type: {relative}")

record(".", b"directory", dependency_stat)
walk(dependency_root)
if entry_count < 2 or regular_bytes < 1:
    raise SystemExit("UI dependency attestation is empty.")
print(f"{entry_count}\t{regular_bytes}\t{tree_hash.hexdigest()}")
PY
}

attest_source_checkout() {
  local source_checkout="$1"
  local expected_commit="$2"
  local source_commit source_tree untracked ignored_path dependency_attestation
  local untracked_inventory ignored_inventory tree_inventory inventory_error=""
  local tree_record metadata tracked_path
  local tracked_mode tracked_type tracked_object source_path actual_object file_mode link_target
  local tracked_count=0

  if [[ ! -d "${source_checkout}" || -L "${source_checkout}" ||
    "$(realpath -e -- "${source_checkout}")" != "${source_checkout}" ]]; then
    echo "UI source checkout must be a real canonical directory." >&2
    return 1
  fi
  if [[ "${POW_UI_ALLOW_TEST_ROOTS:-}" != "1" ]]; then
    case "${source_checkout}" in
      /var/tmp/proofofwork-deploy/*) ;;
      *)
        echo "UI source checkout must be staged under /var/tmp/proofofwork-deploy." >&2
        return 1
        ;;
    esac
  fi
  if [[ "$(/usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" rev-parse --show-toplevel)" != "${source_checkout}" ]]; then
    echo "UI source path is not its Git checkout root." >&2
    return 1
  fi
  if /usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" symbolic-ref --quiet HEAD >/dev/null; then
    echo "UI source checkout must be detached at the deployed commit." >&2
    return 1
  fi
  reject_nested_mounts "${source_checkout}"
  source_commit="$(/usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" rev-parse --verify HEAD^{commit})"
  source_tree="$(/usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" rev-parse --verify HEAD^{tree})"
  if [[ ! "${source_commit}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ||
    ! "${source_tree}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ||
    "${source_commit}" != "${expected_commit}" ]]; then
    echo "UI source checkout does not match the requested full commit." >&2
    return 1
  fi
  untracked_inventory="$(mktemp "${lock_parent}/.proofofwork-ui-source-untracked.XXXXXXXXXX")"
  if ! /usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" \
    ls-files --others --exclude-standard --directory -z >"${untracked_inventory}"; then
    rm -f -- "${untracked_inventory}"
    echo "UI source untracked-path discovery failed." >&2
    return 1
  fi
  untracked=""
  IFS= read -r -d '' untracked <"${untracked_inventory}" || true
  rm -f -- "${untracked_inventory}"
  if [[ -n "${untracked}" ]]; then
    echo "UI source checkout contains an untracked, non-ignored path: ${untracked}" >&2
    return 1
  fi
  ignored_inventory="$(mktemp "${lock_parent}/.proofofwork-ui-source-ignored.XXXXXXXXXX")"
  if ! {
    if [[ -n "${POW_UI_TEST_FAIL_IGNORED_DISCOVERY_AFTER_OUTPUT:-}" ]]; then
      printf 'node_modules/partial-output\0'
      false
    else
      /usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" \
        ls-files --others --ignored --exclude-standard -z
    fi
  } >"${ignored_inventory}"; then
    rm -f -- "${ignored_inventory}"
    echo "UI source ignored-path discovery failed." >&2
    return 1
  fi
  while IFS= read -r -d '' ignored_path; do
    if [[ "${ignored_path}" != node_modules/* || "${ignored_path}" =~ [[:cntrl:]] ||
      "${ignored_path}" == *\\* || "/${ignored_path}/" == *"/../"* ]]; then
      inventory_error="UI source checkout contains a non-dependency ignored path: ${ignored_path}"
      break
    fi
  done <"${ignored_inventory}"
  rm -f -- "${ignored_inventory}"
  if [[ -n "${inventory_error}" ]]; then
    echo "${inventory_error}" >&2
    return 1
  fi

  tree_inventory="$(mktemp "${lock_parent}/.proofofwork-ui-source-tree.XXXXXXXXXX")"
  if ! /usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" \
    ls-tree -r -z --full-tree "${source_commit}" >"${tree_inventory}"; then
    rm -f -- "${tree_inventory}"
    echo "UI source tracked-tree discovery failed." >&2
    return 1
  fi
  verify_tracked_tree_inventory() {
    while IFS= read -r -d '' tree_record; do
    metadata="${tree_record%%$'\t'*}"
    tracked_path="${tree_record#*$'\t'}"
    read -r tracked_mode tracked_type tracked_object <<<"${metadata}"
    if [[ "${tracked_type}" != "blob" || "${tracked_path}" == /* ||
      "/${tracked_path}/" == *"/../"* || "${tracked_path}" == *\\* ||
      "${tracked_path}" =~ [[:cntrl:]] ]]; then
      echo "UI source tree contains an unsupported tracked entry: ${tracked_path}" >&2
      return 1
    fi
    source_path="${source_checkout}/${tracked_path}"
    case "${tracked_mode}" in
      100644 | 100755)
        if [[ ! -f "${source_path}" || -L "${source_path}" ]]; then
          echo "UI source checkout is missing tracked file: ${tracked_path}" >&2
          return 1
        fi
        file_mode="$(stat --format=%a -- "${source_path}")"
        if ((8#${file_mode} & 07022)) ||
          [[ "${tracked_mode}" == "100755" && ! -x "${source_path}" ]] ||
          [[ "${tracked_mode}" == "100644" && -x "${source_path}" ]]; then
          echo "UI source checkout has an unsafe or incorrect tracked mode: ${tracked_path}" >&2
          return 1
        fi
        if ! actual_object="$(
          /usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" \
            hash-object --no-filters -- "${source_path}"
        )"; then
          echo "UI source checkout could not hash tracked file: ${tracked_path}" >&2
          return 1
        fi
        ;;
      120000)
        if [[ ! -L "${source_path}" ]]; then
          echo "UI source checkout is missing tracked symlink: ${tracked_path}" >&2
          return 1
        fi
        link_target="$(readlink -- "${source_path}")"
        if [[ -z "${link_target}" || "${link_target}" == /* ||
          "$(realpath -m -- "$(dirname -- "${source_path}")/${link_target}")" != "${source_checkout}"/* ]]; then
          echo "UI source checkout contains an escaping tracked symlink: ${tracked_path}" >&2
          return 1
        fi
        if ! actual_object="$(
          printf '%s' "${link_target}" |
            /usr/bin/git -c safe.directory="${source_checkout}" -C "${source_checkout}" hash-object --stdin
        )"; then
          echo "UI source checkout could not hash tracked symlink: ${tracked_path}" >&2
          return 1
        fi
        ;;
      *)
        echo "UI source tree contains unsupported tracked mode ${tracked_mode}: ${tracked_path}" >&2
        return 1
        ;;
    esac
    if [[ "${actual_object}" != "${tracked_object}" ]]; then
      echo "UI source checkout tracked bytes differ from Git: ${tracked_path}" >&2
      return 1
    fi
    ((tracked_count += 1))
    done <"${tree_inventory}"
  }
  if ! verify_tracked_tree_inventory; then
    rm -f -- "${tree_inventory}"
    return 1
  fi
  rm -f -- "${tree_inventory}"
  if ((tracked_count < 1)); then
    echo "UI source checkout contains no tracked files." >&2
    return 1
  fi
  dependency_attestation="$(attest_source_dependencies "${source_checkout}")"
  IFS=$'\t' read -r attested_dependency_entry_count attested_dependency_bytes attested_dependency_sha256 <<<"${dependency_attestation}"
  if [[ ! "${attested_dependency_entry_count}" =~ ^[1-9][0-9]*$ ||
    ! "${attested_dependency_bytes}" =~ ^[1-9][0-9]*$ ||
    ! "${attested_dependency_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "UI source dependency attestation returned invalid evidence." >&2
    return 1
  fi
  attested_source_commit="${source_commit}"
  attested_source_tree="${source_tree}"
}

validate_surface_directory() {
  local surface="$1"
  local directory="$2"
  if [[ ! -d "${directory}" || -L "${directory}" || "$(realpath -e "${directory}")" != "${directory}" ]]; then
    echo "Release surface must be a real canonical directory: ${directory}" >&2
    return 1
  fi
  if [[ ! -f "${directory}/index.html" || -L "${directory}/index.html" ]]; then
    echo "Release surface is missing a regular index.html: ${directory}" >&2
    return 1
  fi
  if ! reject_nested_mounts "${directory}"; then
    return 1
  fi
  if ! /usr/bin/python3 -I - "${directory}" "${EUID}" <<'PY'
import os
import re
import stat
import sys

root = os.path.realpath(sys.argv[1])
expected_owner = int(sys.argv[2])
root_device = os.lstat(root).st_dev

def check(path, details):
    if details.st_dev != root_device:
        raise SystemExit(f"Release surface crosses a filesystem boundary: {path}")
    if details.st_uid != expected_owner:
        raise SystemExit(f"Release surface contains foreign-owned content: {path}")
    if stat.S_ISDIR(details.st_mode):
        if details.st_mode & 0o7022:
            raise SystemExit(
                "Release surface contains an unsafe writable or special mode "
                f"{stat.S_IMODE(details.st_mode):04o}: {path}"
            )
        if stat.S_IMODE(details.st_mode) & 0o005 != 0o005:
            raise SystemExit(f"Release surface is not publicly readable by Caddy: {path}")
    elif stat.S_ISREG(details.st_mode):
        if details.st_mode & 0o7022:
            raise SystemExit(
                "Release surface contains an unsafe writable or special mode "
                f"{stat.S_IMODE(details.st_mode):04o}: {path}"
            )
        if stat.S_IMODE(details.st_mode) & 0o004 != 0o004:
            raise SystemExit(f"Release surface is not publicly readable by Caddy: {path}")
    else:
        raise SystemExit(f"Release surface contains an unsupported file type: {path}")

def walk(directory):
    check(directory, os.lstat(directory))
    try:
        entries = sorted(os.scandir(directory), key=lambda entry: os.fsencode(entry.name))
    except OSError as error:
        raise SystemExit(f"Unable to enumerate release surface: {error}") from error
    for entry in entries:
        details = entry.stat(follow_symlinks=False)
        check(entry.path, details)
        if stat.S_ISDIR(details.st_mode):
            walk(entry.path)

walk(root)
index = os.path.join(root, "index.html")
try:
    with open(index, "rb") as source:
        index_bytes = source.read(2 * 1024 * 1024 + 1)
except OSError as error:
    raise SystemExit(f"Unable to read release surface index: {error}") from error
if len(index_bytes) > 2 * 1024 * 1024:
    raise SystemExit(f"Release surface index exceeds validation bound: {index}")
asset_references = sorted(set(re.findall(rb"/assets/[A-Za-z0-9._/-]+", index_bytes)))
if not asset_references:
    raise SystemExit(f"Release surface index has no local asset references: {root}")
for raw_reference in asset_references:
    reference = raw_reference.decode("ascii")
    if ".." in reference:
        raise SystemExit(f"Release surface index references a missing asset: {root}{reference}")
    path = os.path.join(root, *reference.removeprefix("/").split("/"))
    try:
        details = os.lstat(path)
    except FileNotFoundError as error:
        raise SystemExit(f"Release surface index references a missing asset: {root}{reference}") from error
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise SystemExit(f"Release surface index references a missing asset: {root}{reference}")
PY
  then
    return 1
  fi
}

surface_file_inventory_directory() {
  local directory="$1"
  local inventory="$2"
  if [[ -n "${POW_UI_TEST_FAIL_SURFACE_DISCOVERY_AFTER_OUTPUT:-}" ]]; then
    printf 'index.html\0' >"${inventory}"
    return 1
  fi
  find "${directory}" -xdev -type f -printf '%P\0' >"${inventory}"
}

surface_file_count_directory() {
  local directory="$1"
  local inventory
  local -a files=()
  if ! inventory="$(mktemp "${lock_parent}/.proofofwork-ui-surface-inventory.XXXXXXXXXX")"; then
    echo "Release surface inventory could not be created: ${directory}" >&2
    return 1
  fi
  if ! surface_file_inventory_directory "${directory}" "${inventory}"; then
    rm -f -- "${inventory}"
    echo "Release surface file discovery failed: ${directory}" >&2
    return 1
  fi
  if ! mapfile -d '' -t files <"${inventory}"; then
    rm -f -- "${inventory}"
    echo "Release surface inventory could not be read: ${directory}" >&2
    return 1
  fi
  if ! rm -f -- "${inventory}"; then
    echo "Release surface inventory could not be removed: ${directory}" >&2
    return 1
  fi
  printf '%s\n' "${#files[@]}"
}

surface_tree_sha256_directory() {
  local directory="$1"
  local inventory records relative digest file_mode result fingerprint_status=0
  if ! inventory="$(mktemp "${lock_parent}/.proofofwork-ui-surface-inventory.XXXXXXXXXX")"; then
    echo "Release surface inventory could not be created: ${directory}" >&2
    return 1
  fi
  if ! records="$(mktemp "${lock_parent}/.proofofwork-ui-surface-records.XXXXXXXXXX")"; then
    rm -f -- "${inventory}"
    echo "Release surface fingerprint records could not be created: ${directory}" >&2
    return 1
  fi
  if ! surface_file_inventory_directory "${directory}" "${inventory}"; then
    rm -f -- "${inventory}" "${records}"
    echo "Release surface file discovery failed: ${directory}" >&2
    return 1
  fi
  if ! LC_ALL=C sort --zero-terminated --output="${inventory}" -- "${inventory}"; then
    rm -f -- "${inventory}" "${records}"
    echo "Release surface file ordering failed: ${directory}" >&2
    return 1
  fi
  while IFS= read -r -d '' relative; do
    if [[ -z "${relative}" || "${relative}" == /* || "${relative}" == *\\* ||
      "/${relative}/" == *"/../"* || "/${relative}/" == *"/./"* ]]; then
      echo "Release surface file inventory contains an unsafe path: ${relative}" >&2
      fingerprint_status=1
      break
    fi
    if ! digest="$(sha256sum --binary -- "${directory}/${relative}")" ||
      ! file_mode="$(stat --format=%a -- "${directory}/${relative}")"; then
      echo "Release surface file changed during fingerprinting: ${relative}" >&2
      fingerprint_status=1
      break
    fi
    digest="${digest%% *}"
    if ! printf '%s\0%s\0%s\n' "${relative}" "${file_mode}" "${digest}" >>"${records}"; then
      echo "Release surface fingerprint record could not be written: ${relative}" >&2
      fingerprint_status=1
      break
    fi
  done <"${inventory}"
  if ! rm -f -- "${inventory}"; then
    echo "Release surface inventory could not be removed: ${directory}" >&2
    fingerprint_status=1
  fi
  if ((fingerprint_status != 0)); then
    rm -f -- "${records}"
    return 1
  fi
  if ! result="$(sha256sum --binary -- "${records}")"; then
    rm -f -- "${records}"
    echo "Release surface fingerprint could not be hashed: ${directory}" >&2
    return 1
  fi
  if ! rm -f -- "${records}"; then
    echo "Release surface fingerprint records could not be removed: ${directory}" >&2
    return 1
  fi
  printf '%s\n' "${result%% *}"
}

validate_surface() {
  local surface="$1"
  validate_surface_directory "${surface}" "$(surface_directory "${surface}")"
}

surface_file_count() {
  surface_file_count_directory "$(surface_directory "$1")"
}

surface_tree_sha256() {
  surface_tree_sha256_directory "$(surface_directory "$1")"
}

verified_archive_sha256() {
  local archive="$1"
  local expected_sha256="${2:-}"
  local checksum_file digest referenced_name actual_sha256 archive_bytes
  local archive_mode archive_owner checksum_mode checksum_owner
  local -a checksum_lines=()
  if [[ ! -f "${archive}" || -L "${archive}" || "$(realpath -e "${archive}")" != "${archive}" ]] ||
    [[ "$(dirname -- "${archive}")" != "${archive_root}" ]]; then
    echo "Release archive must be a canonical file in ${archive_root}." >&2
    return 1
  fi
  archive_mode="$(stat --format=%a -- "${archive}")"
  archive_owner="$(stat --format=%u -- "${archive}")"
  if ((8#${archive_mode} & 07022)) || [[ "${archive_owner}" != "${EUID}" ]]; then
    echo "Release archive has unsafe mode or ownership: ${archive}" >&2
    return 1
  fi
  archive_bytes="$(stat --format=%s -- "${archive}")"
  if [[ ! "${archive_bytes}" =~ ^[0-9]+$ ]] || ((archive_bytes > 536870912)); then
    echo "Release archive exceeds the 512 MiB compressed safety limit: ${archive}" >&2
    return 1
  fi
  checksum_file="${archive}.sha256"
  if [[ ! -f "${checksum_file}" || -L "${checksum_file}" ]]; then
    echo "Release archive is missing a regular checksum sidecar: ${archive}" >&2
    return 1
  fi
  checksum_mode="$(stat --format=%a -- "${checksum_file}")"
  checksum_owner="$(stat --format=%u -- "${checksum_file}")"
  if ((8#${checksum_mode} & 07022)) || [[ "${checksum_owner}" != "${EUID}" ]]; then
    echo "Release archive checksum has unsafe mode or ownership: ${checksum_file}" >&2
    return 1
  fi
  mapfile -t checksum_lines <"${checksum_file}"
  digest=""
  referenced_name=""
  if ((${#checksum_lines[@]} == 1)) &&
    [[ "${checksum_lines[0]}" =~ ^([0-9a-f]{64})\ \ (.+)$ ]]; then
    digest="${BASH_REMATCH[1]}"
    referenced_name="${BASH_REMATCH[2]}"
  fi
  if ((${#checksum_lines[@]} != 1)) ||
    [[ ! "${digest}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ "${referenced_name}" != "$(basename -- "${archive}")" && "${referenced_name}" != "${archive}" ]]; then
    echo "Release archive checksum sidecar is not canonical: ${checksum_file}" >&2
    return 1
  fi
  actual_sha256="$(sha256sum --binary -- "${archive}")"
  actual_sha256="${actual_sha256%% *}"
  if [[ "${actual_sha256}" != "${digest}" ]] ||
    [[ -n "${expected_sha256}" && "${actual_sha256}" != "${expected_sha256}" ]]; then
    echo "Release archive checksum does not match: ${archive}" >&2
    return 1
  fi
  printf '%s\n' "${actual_sha256}"
}

verify_archive_payload() {
  local archive="$1"
  local counts_name="$2"
  local digests_name="$3"
  local extraction_root verification_status
  local -n expected_counts="${counts_name}"
  local -n expected_digests="${digests_name}"

  if ! extraction_root="$(mktemp --directory "${TMPDIR:-/tmp}/proofofwork-ui-archive.XXXXXX")"; then
    echo "Release archive extraction root could not be created." >&2
    return 1
  fi
  if ! chmod 0700 "${extraction_root}"; then
    /usr/bin/rm --recursive --force --one-file-system -- "${extraction_root}"
    echo "Release archive extraction root could not be secured." >&2
    return 1
  fi
  verification_status=0
  (
    if ! names_text="$(
      LC_ALL=C tar --list --absolute-names --quoting-style=escape --file "${archive}"
    )"; then
      echo "Release archive path listing failed." >&2
      exit 1
    fi
    if ! verbose_text="$(
      LC_ALL=C tar --list --verbose --absolute-names --quoting-style=escape --file "${archive}"
    )"; then
      echo "Release archive metadata listing failed." >&2
      exit 1
    fi
    if ! mapfile -t archive_names <<<"${names_text}" ||
      ! mapfile -t verbose_entries <<<"${verbose_text}"; then
      echo "Release archive listing could not be read." >&2
      exit 1
    fi
    if ((${#archive_names[@]} == 0 || ${#archive_names[@]} != ${#verbose_entries[@]})); then
      echo "Release archive listing is empty or inconsistent." >&2
      exit 1
    fi
    declare -A seen_archive_entries=()
    total_uncompressed_bytes=0
    for index in "${!archive_names[@]}"; do
      archive_name="${archive_names[${index}]}"
      archive_type="${verbose_entries[${index}]:0:1}"
      normalized_name="${archive_name%/}"
      read -r _archive_mode _archive_owner archive_entry_bytes _archive_rest <<<"${verbose_entries[${index}]}"
      if [[ ! "${archive_entry_bytes}" =~ ^[0-9]+$ ]]; then
        echo "Release archive entry size is not parseable: ${archive_name}" >&2
        exit 1
      fi
      total_uncompressed_bytes=$((total_uncompressed_bytes + archive_entry_bytes))
      if ((total_uncompressed_bytes > 1073741824 || ${#archive_names[@]} > 10000)); then
        echo "Release archive exceeds the entry-count or 1 GiB extraction safety limit." >&2
        exit 1
      fi
      if [[ "${archive_type}" != "-" && "${archive_type}" != "d" ]]; then
        echo "Release archive contains a link or unsupported entry type: ${archive_name}" >&2
        exit 1
      fi
      if [[ -z "${normalized_name}" || "${normalized_name}" == /* ||
        "${normalized_name}" == *"//"* || "/${normalized_name}/" == *"/../"* ||
        "/${normalized_name}/" == *"/./"* || "${normalized_name}" == *"\\"* ]]; then
        echo "Release archive contains an unsafe path: ${archive_name}" >&2
        exit 1
      fi
      if [[ "${normalized_name}" == "surfaces" ]]; then
        if [[ "${archive_type}" != "d" ]]; then
          echo "Release archive surfaces root is not a directory." >&2
          exit 1
        fi
      elif [[ ! "${normalized_name}" =~ ^surfaces/(${surface_pattern})(/[A-Za-z0-9._-]+)*$ ]]; then
        echo "Release archive contains a non-allowlisted path: ${archive_name}" >&2
        exit 1
      fi
      if [[ -n "${seen_archive_entries[${normalized_name}]:-}" ]]; then
        echo "Release archive contains a duplicate path: ${archive_name}" >&2
        exit 1
      fi
      seen_archive_entries["${normalized_name}"]=1
    done

    if ! LC_ALL=C tar \
      --extract \
      --file "${archive}" \
      --directory "${extraction_root}" \
      --no-same-owner \
      --same-permissions \
      --delay-directory-restore \
      --no-overwrite-dir; then
      echo "Release archive extraction failed." >&2
      exit 1
    fi
    top_level_inventory="${extraction_root}/.proofofwork-top-level-inventory"
    if ! : >"${top_level_inventory}"; then
      echo "Release archive top-level inventory could not be created." >&2
      exit 1
    fi
    if ! {
      if [[ -n "${POW_UI_TEST_FAIL_ARCHIVE_TOP_LEVEL_DISCOVERY_AFTER_OUTPUT:-}" ]]; then
        printf '%s\0' "${extraction_root}/surfaces"
        false
      else
        find "${extraction_root}" -mindepth 1 -maxdepth 1 \
          ! -path "${top_level_inventory}" -print0
      fi
    } >"${top_level_inventory}"; then
      echo "Release archive top-level discovery failed." >&2
      exit 1
    fi
    if ! mapfile -d '' -t top_level_entries <"${top_level_inventory}"; then
      echo "Release archive top-level inventory could not be read." >&2
      exit 1
    fi
    if ! rm -f -- "${top_level_inventory}"; then
      echo "Release archive top-level inventory could not be removed." >&2
      exit 1
    fi
    if ((${#top_level_entries[@]} != 1)) ||
      [[ "${top_level_entries[0]}" != "${extraction_root}/surfaces" ]]; then
      echo "Release archive must contain only the surfaces root." >&2
      exit 1
    fi
    for surface in "${surfaces[@]}"; do
      archive_surface="${extraction_root}/surfaces/${surface}"
      if ! validate_surface_directory "${surface}" "${archive_surface}"; then
        exit 1
      fi
      if ! archive_count="$(surface_file_count_directory "${archive_surface}")"; then
        echo "Release archive surface count failed: ${surface}" >&2
        exit 1
      fi
      if ! archive_digest="$(surface_tree_sha256_directory "${archive_surface}")"; then
        echo "Release archive surface digest failed: ${surface}" >&2
        exit 1
      fi
      if [[ "${archive_count}" != "${expected_counts[${surface}]}" ||
        "${archive_digest}" != "${expected_digests[${surface}]}" ]]; then
        echo "Release archive surface does not match active UI bytes: ${surface}" >&2
        exit 1
      fi
    done
  ) || verification_status=$?
  if [[ -d "${extraction_root}" && ! -L "${extraction_root}" ]]; then
    /usr/bin/rm --recursive --force --one-file-system -- "${extraction_root}"
  fi
  return "${verification_status}"
}

record_rollback_evidence() {
  local archive=""
  local archive_real archive_name archive_sha256 archive_provenance recorded_at
  local temporary provenance_temporary surface count digest second_count second_digest
  local second_archive_sha256
  declare -A counts=()
  declare -A digests=()

  while (($# > 0)); do
    case "$1" in
      --archive)
        archive="${2:-}"
        shift 2
        ;;
      *)
        echo "Unknown rollback-evidence argument: $1" >&2
        exit 64
        ;;
    esac
  done
  if [[ -e "${manifest}" || -L "${manifest}" ]]; then
    echo "Refusing to replace an existing UI release or rollback manifest." >&2
    exit 1
  fi
  if [[ -z "${archive}" ]]; then
    echo "A surfaces-only rollback archive is required." >&2
    exit 64
  fi
  archive_real="$(realpath -e -- "${archive}" 2>/dev/null || true)"
  if [[ "${archive_real}" != "${archive}" || "$(dirname -- "${archive}")" != "${archive_root}" ]]; then
    echo "Rollback archive path must be canonical: ${archive}" >&2
    exit 64
  fi
  archive_name="$(basename -- "${archive}")"
  if [[ ! "${archive_name}" =~ ^proofofwork-ui-release-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.tgz$ ]]; then
    echo "Rollback archive name is not allowlisted: ${archive_name}" >&2
    exit 64
  fi
  archive_sha256="$(verified_archive_sha256 "${archive}")"
  archive_provenance="${archive}.provenance"
  if [[ -e "${archive_provenance}" || -L "${archive_provenance}" ]]; then
    echo "Refusing to replace existing rollback archive evidence: ${archive_provenance}" >&2
    exit 1
  fi

  for surface in "${surfaces[@]}"; do
    validate_surface "${surface}"
    count="$(surface_file_count "${surface}")"
    digest="$(surface_tree_sha256 "${surface}")"
    if [[ ! "${count}" =~ ^[1-9][0-9]*$ || ! "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
      echo "Unable to fingerprint rollback surface: ${surface}" >&2
      exit 1
    fi
    counts["${surface}"]="${count}"
    digests["${surface}"]="${digest}"
  done
  if [[ "${counts[nft]}" != "${counts[computer]}" ||
    "${digests[nft]}" != "${digests[computer]}" ]]; then
    echo "NFT compatibility alias must exactly match Computer paths, bytes, and modes." >&2
    exit 1
  fi
  verify_archive_payload "${archive}" counts digests

  recorded_at="$(date --utc +%Y-%m-%dT%H:%M:%SZ)"
  temporary="$(mktemp "${ui_root}/.proofofwork-ui-release.tmp.XXXXXX")"
  provenance_temporary="$(mktemp "${archive_root}/.${archive_name}.provenance.tmp.XXXXXX")"
  trap 'rm -f -- "${temporary:-}" "${provenance_temporary:-}"' EXIT
  {
    printf 'format=proofofwork-ui-rollback-evidence-v1\n'
    printf 'scope=ui-surfaces-only\n'
    printf 'model=exact-surface-files-bytes-and-modes-v1\n'
    printf 'recorded_at=%s\n' "${recorded_at}"
    printf 'archive_name=%s\n' "${archive_name}"
    printf 'archive_sha256=%s\n' "${archive_sha256}"
    printf 'archive_payload_model=surfaces-v1\n'
    for surface in "${surfaces[@]}"; do
      printf 'surface.%s.file_count=%s\n' "${surface}" "${counts[${surface}]}"
      printf 'surface.%s.sha256=%s\n' "${surface}" "${digests[${surface}]}"
    done
  } >"${temporary}"
  chmod 0644 "${temporary}"
  cp -- "${temporary}" "${provenance_temporary}"
  chmod 0644 "${provenance_temporary}"

  second_archive_sha256="$(verified_archive_sha256 "${archive}" "${archive_sha256}")"
  if [[ "${second_archive_sha256}" != "${archive_sha256}" ]]; then
    echo "Rollback archive changed while evidence was recorded." >&2
    exit 1
  fi
  for surface in "${surfaces[@]}"; do
    validate_surface "${surface}"
    second_count="$(surface_file_count "${surface}")"
    second_digest="$(surface_tree_sha256 "${surface}")"
    if [[ "${second_count}" != "${counts[${surface}]}" ||
      "${second_digest}" != "${digests[${surface}]}" ]]; then
      echo "Rollback surface changed while evidence was recorded: ${surface}" >&2
      exit 1
    fi
  done
  verify_archive_payload "${archive}" counts digests
  sync --file-system "${temporary}"
  sync --file-system "${provenance_temporary}"
  if ! ln -- "${provenance_temporary}" "${archive_provenance}"; then
    echo "Refusing to overwrite rollback archive evidence created concurrently." >&2
    exit 1
  fi
  rm -f -- "${provenance_temporary}"
  sync --file-system "${archive_root}"
  if ! ln -- "${temporary}" "${manifest}"; then
    echo "Refusing to overwrite a UI manifest created concurrently." >&2
    exit 1
  fi
  rm -f -- "${temporary}"
  sync --file-system "${ui_root}"
  trap - EXIT
  printf 'ui_rollback_evidence status=recorded archive_sha256=%s\n' "${archive_sha256}"
}

process_release_manifest() {
  local operation="$1"
  shift
  local release_id=""
  local commit=""
  local source_checkout=""
  local archive=""
  local archive_real archive_name archive_sha256 archive_provenance
  local deployed_at temporary provenance_temporary
  local surface count digest second_count second_digest second_archive_sha256
  local original_source_commit original_source_tree
  local original_dependency_entry_count original_dependency_bytes original_dependency_sha256
  declare -A counts=()
  declare -A digests=()

  if [[ "${operation}" != "record" && "${operation}" != "verify-candidate" ]]; then
    echo "Unknown release provenance operation: ${operation}" >&2
    exit 64
  fi
  if [[ "${operation}" == "record" &&
    "${POW_UI_STAGED_ROOT:-}" == "1" ]]; then
    echo "Active UI release provenance cannot be recorded against a staged root." >&2
    exit 64
  fi

  while (($# > 0)); do
    case "$1" in
      --release-id)
        release_id="${2:-}"
        shift 2
        ;;
      --commit)
        commit="${2:-}"
        shift 2
        ;;
      --source-checkout)
        source_checkout="${2:-}"
        shift 2
        ;;
      --archive)
        archive="${2:-}"
        shift 2
        ;;
      *)
        echo "Unknown record argument: $1" >&2
        exit 64
        ;;
    esac
  done
  if [[ ! "${release_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
    echo "Release id must use 1-128 safe filename characters." >&2
    exit 64
  fi
  if [[ ! "${commit}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    echo "Commit must be a full lowercase hexadecimal object id." >&2
    exit 64
  fi
  if [[ -z "${source_checkout}" ]]; then
    echo "A canonical source checkout is required." >&2
    exit 64
  fi
  if [[ "${source_checkout}" != "$(realpath -e -- "${source_checkout}" 2>/dev/null || true)" ]]; then
    echo "UI source checkout path must be canonical." >&2
    exit 64
  fi
  attest_source_checkout "${source_checkout}" "${commit}"
  if [[ -z "${archive}" ]]; then
    echo "Release archive is required." >&2
    exit 64
  fi
  archive_real="$(realpath -e "${archive}")"
  if [[ "${archive_real}" != "${archive}" || "$(dirname -- "${archive}")" != "${archive_root}" ]]; then
    echo "Release archive path must be canonical: ${archive}" >&2
    exit 64
  fi
  archive_name="$(basename -- "${archive}")"
  if [[ ! "${archive_name}" =~ ^proofofwork-ui-release-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.tgz$ ]]; then
    echo "Release archive name is not allowlisted: ${archive_name}" >&2
    exit 64
  fi
  archive_sha256="$(verified_archive_sha256 "${archive}")"
  archive_provenance="${archive}.provenance"

  for surface in "${surfaces[@]}"; do
    validate_surface "${surface}"
    count="$(surface_file_count "${surface}")"
    digest="$(surface_tree_sha256 "${surface}")"
    if [[ ! "${count}" =~ ^[1-9][0-9]*$ || ! "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
      echo "Unable to fingerprint release surface: ${surface}" >&2
      exit 1
    fi
    counts["${surface}"]="${count}"
    digests["${surface}"]="${digest}"
  done
  if [[ "${counts[nft]}" != "${counts[computer]}" ||
    "${digests[nft]}" != "${digests[computer]}" ]]; then
    echo "NFT compatibility alias must exactly match Computer paths, bytes, and modes." >&2
    exit 1
  fi
  verify_archive_payload "${archive}" counts digests

  if [[ "${operation}" == "verify-candidate" ]]; then
    second_archive_sha256="$(verified_archive_sha256 "${archive}" "${archive_sha256}")"
    if [[ "${second_archive_sha256}" != "${archive_sha256}" ]]; then
      echo "Release archive changed while the candidate was verified." >&2
      exit 1
    fi
    original_source_commit="${attested_source_commit}"
    original_source_tree="${attested_source_tree}"
    original_dependency_entry_count="${attested_dependency_entry_count}"
    original_dependency_bytes="${attested_dependency_bytes}"
    original_dependency_sha256="${attested_dependency_sha256}"
    attest_source_checkout "${source_checkout}" "${commit}"
    if [[ "${attested_source_commit}" != "${original_source_commit}" ||
      "${attested_source_tree}" != "${original_source_tree}" ||
      "${attested_dependency_entry_count}" != "${original_dependency_entry_count}" ||
      "${attested_dependency_bytes}" != "${original_dependency_bytes}" ||
      "${attested_dependency_sha256}" != "${original_dependency_sha256}" ]]; then
      echo "UI source checkout changed while the candidate was verified." >&2
      exit 1
    fi
    for surface in "${surfaces[@]}"; do
      validate_surface "${surface}"
      second_count="$(surface_file_count "${surface}")"
      second_digest="$(surface_tree_sha256 "${surface}")"
      if [[ "${second_count}" != "${counts[${surface}]}" ||
        "${second_digest}" != "${digests[${surface}]}" ]]; then
        echo "Release surface changed while the candidate was verified: ${surface}" >&2
        exit 1
      fi
    done
    printf 'ui_release_candidate status=verified release_id=%s commit=%s archive_sha256=%s\n' \
      "${release_id}" "${commit}" "${archive_sha256}"
    return
  fi

  deployed_at="$(date --utc +%Y-%m-%dT%H:%M:%SZ)"
  temporary="$(mktemp "${ui_root}/.proofofwork-ui-release.tmp.XXXXXX")"
  provenance_temporary="$(mktemp "${archive_root}/.${archive_name}.provenance.tmp.XXXXXX")"
  trap 'rm -f -- "${temporary:-}" "${provenance_temporary:-}"' EXIT
  {
    printf 'format=proofofwork-ui-release-v3\n'
    printf 'release_id=%s\n' "${release_id}"
    printf 'commit=%s\n' "${attested_source_commit}"
    printf 'source_tree=%s\n' "${attested_source_tree}"
    printf 'source_attestation=detached-recursive-git-tree-v1\n'
    printf 'source_dependency_model=node-modules-recursive-v1\n'
    printf 'source_dependency_entry_count=%s\n' "${attested_dependency_entry_count}"
    printf 'source_dependency_bytes=%s\n' "${attested_dependency_bytes}"
    printf 'source_dependency_sha256=%s\n' "${attested_dependency_sha256}"
    printf 'deployed_at=%s\n' "${deployed_at}"
    printf 'archive_name=%s\n' "${archive_name}"
    printf 'archive_sha256=%s\n' "${archive_sha256}"
    printf 'archive_payload_model=surfaces-v1\n'
    for surface in "${surfaces[@]}"; do
      printf 'surface.%s.file_count=%s\n' "${surface}" "${counts[${surface}]}"
      printf 'surface.%s.sha256=%s\n' "${surface}" "${digests[${surface}]}"
    done
  } >"${temporary}"
  chmod 0644 "${temporary}"
  cp -- "${temporary}" "${provenance_temporary}"
  chmod 0644 "${provenance_temporary}"

  second_archive_sha256="$(verified_archive_sha256 "${archive}" "${archive_sha256}")"
  if [[ "${second_archive_sha256}" != "${archive_sha256}" ]]; then
    echo "Release archive changed while provenance was recorded." >&2
    exit 1
  fi
  original_source_commit="${attested_source_commit}"
  original_source_tree="${attested_source_tree}"
  original_dependency_entry_count="${attested_dependency_entry_count}"
  original_dependency_bytes="${attested_dependency_bytes}"
  original_dependency_sha256="${attested_dependency_sha256}"
  attest_source_checkout "${source_checkout}" "${commit}"
  if [[ "${attested_source_commit}" != "${original_source_commit}" ||
    "${attested_source_tree}" != "${original_source_tree}" ||
    "${attested_dependency_entry_count}" != "${original_dependency_entry_count}" ||
    "${attested_dependency_bytes}" != "${original_dependency_bytes}" ||
    "${attested_dependency_sha256}" != "${original_dependency_sha256}" ]]; then
    echo "UI source checkout changed while provenance was recorded." >&2
    exit 1
  fi
  for surface in "${surfaces[@]}"; do
    validate_surface "${surface}"
    second_count="$(surface_file_count "${surface}")"
    second_digest="$(surface_tree_sha256 "${surface}")"
    if [[ "${second_count}" != "${counts[${surface}]}" || "${second_digest}" != "${digests[${surface}]}" ]]; then
      echo "Release surface changed while provenance was recorded: ${surface}" >&2
      exit 1
    fi
  done
  sync --file-system "${temporary}"
  sync --file-system "${provenance_temporary}"
  if [[ -e "${archive_provenance}" ]]; then
    if [[ ! -f "${archive_provenance}" || -L "${archive_provenance}" ||
      "$(stat --format=%u -- "${archive_provenance}")" != "${EUID}" ]] ||
      ((8#$(stat --format=%a -- "${archive_provenance}") & 07022)) ||
      ! cmp --silent -- "${provenance_temporary}" "${archive_provenance}"; then
      echo "Refusing to replace different archive provenance: ${archive_provenance}" >&2
      exit 1
    fi
    rm -f -- "${provenance_temporary}"
  else
    mv --no-target-directory -- "${provenance_temporary}" "${archive_provenance}"
    sync --file-system "${archive_root}"
  fi
  mv --no-target-directory -- "${temporary}" "${manifest}"
  sync --file-system "${ui_root}"
  trap - EXIT
  printf 'ui_release_provenance status=recorded release_id=%s commit=%s archive_sha256=%s\n' \
    "${release_id}" "${commit}" "${archive_sha256}"
}

verify_manifest() {
  local line key value surface expected_count expected_digest actual_count actual_digest mode
  local archive archive_provenance actual_archive_sha256 manifest_owner provenance_mode provenance_owner
  declare -A values=()
  declare -A seen=()
  if (($# != 0)); then
    echo "verify accepts no additional arguments." >&2
    exit 64
  fi
  if [[ ! -f "${manifest}" || -L "${manifest}" || "$(realpath -e "${manifest}")" != "${manifest}" ]]; then
    echo "Active UI release manifest is missing or noncanonical: ${manifest}" >&2
    exit 1
  fi
  mode="$(stat --format=%a -- "${manifest}")"
  manifest_owner="$(stat --format=%u -- "${manifest}")"
  if ((8#${mode} & 07022)) || [[ "${manifest_owner}" != "${EUID}" ]]; then
    echo "Active UI release manifest has unsafe mode or ownership." >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" != *=* ]]; then
      echo "Malformed active UI release manifest line." >&2
      exit 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    if [[ -n "${seen[${key}]:-}" ]]; then
      echo "Duplicate active UI release manifest key: ${key}" >&2
      exit 1
    fi
    case "${key}" in
      format | release_id | commit | source_tree | source_attestation | source_dependency_model | source_dependency_entry_count | source_dependency_bytes | source_dependency_sha256 | deployed_at | archive_name | archive_sha256 | archive_payload_model) ;;
      *)
        allowed_key=false
        for surface in "${surfaces[@]}"; do
          if [[ "${key}" == "surface.${surface}.file_count" ||
            "${key}" == "surface.${surface}.sha256" ]]; then
            allowed_key=true
            break
          fi
        done
        if [[ "${allowed_key}" != "true" ]]; then
          echo "Unknown active UI release manifest key: ${key}" >&2
          exit 1
        fi
        ;;
    esac
    seen["${key}"]=1
    values["${key}"]="${value}"
  done <"${manifest}"

  if [[ "${values[format]:-}" != "proofofwork-ui-release-v3" ]] ||
    [[ ! "${values[release_id]:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] ||
    [[ ! "${values[commit]:-}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] ||
    [[ ! "${values[source_tree]:-}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]] ||
    [[ "${values[source_attestation]:-}" != "detached-recursive-git-tree-v1" ]] ||
    [[ "${values[source_dependency_model]:-}" != "node-modules-recursive-v1" ]] ||
    [[ ! "${values[source_dependency_entry_count]:-}" =~ ^[1-9][0-9]*$ ]] ||
    [[ ! "${values[source_dependency_bytes]:-}" =~ ^[1-9][0-9]*$ ]] ||
    [[ ! "${values[source_dependency_sha256]:-}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ ! "${values[deployed_at]:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    [[ ! "${values[archive_name]:-}" =~ ^proofofwork-ui-release-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.tgz$ ]] ||
    [[ ! "${values[archive_sha256]:-}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ "${values[archive_payload_model]:-}" != "surfaces-v1" ]]; then
    echo "Active UI release manifest metadata is invalid." >&2
    exit 1
  fi
  if [[ "${values[surface.nft.file_count]:-}" != "${values[surface.computer.file_count]:-}" ||
    "${values[surface.nft.sha256]:-}" != "${values[surface.computer.sha256]:-}" ]]; then
    echo "Active UI release manifest does not preserve the NFT compatibility alias." >&2
    exit 1
  fi

  archive="${archive_root}/${values[archive_name]}"
  actual_archive_sha256="$(verified_archive_sha256 "${archive}" "${values[archive_sha256]}")"
  archive_provenance="${archive}.provenance"
  if [[ -f "${archive_provenance}" && ! -L "${archive_provenance}" ]]; then
    provenance_mode="$(stat --format=%a -- "${archive_provenance}")"
    provenance_owner="$(stat --format=%u -- "${archive_provenance}")"
  else
    provenance_mode=""
    provenance_owner=""
  fi
  if [[ "${actual_archive_sha256}" != "${values[archive_sha256]}" ]] ||
    [[ ! -f "${archive_provenance}" || -L "${archive_provenance}" ]] ||
    [[ "${provenance_owner}" != "${EUID}" ]] ||
    [[ ! "${provenance_mode}" =~ ^[0-7]+$ ]] ||
    ((8#${provenance_mode} & 07022)) ||
    ! cmp --silent -- "${manifest}" "${archive_provenance}"; then
    echo "Active UI release is not bound to matching retained archive provenance." >&2
    exit 1
  fi

  for surface in "${surfaces[@]}"; do
    expected_count="${values[surface.${surface}.file_count]:-}"
    expected_digest="${values[surface.${surface}.sha256]:-}"
    if [[ ! "${expected_count}" =~ ^[1-9][0-9]*$ || ! "${expected_digest}" =~ ^[0-9a-f]{64}$ ]]; then
      echo "Active UI release manifest is missing surface evidence: ${surface}" >&2
      exit 1
    fi
    validate_surface "${surface}"
    actual_count="$(surface_file_count "${surface}")"
    actual_digest="$(surface_tree_sha256 "${surface}")"
    if [[ "${actual_count}" != "${expected_count}" || "${actual_digest}" != "${expected_digest}" ]]; then
      echo "Active UI release provenance mismatch: ${surface}" >&2
      exit 1
    fi
  done
  printf 'ui_release_provenance status=verified release_id=%s commit=%s archive_sha256=%s\n' \
    "${values[release_id]}" "${values[commit]}" "${values[archive_sha256]}"
}

verify_rollback_evidence() {
  local line key value surface expected_count expected_digest actual_count actual_digest mode
  local archive archive_provenance actual_archive_sha256 manifest_owner provenance_mode provenance_owner
  declare -A values=()
  declare -A seen=()
  declare -A counts=()
  declare -A digests=()
  if (($# != 0)); then
    echo "verify-rollback accepts no additional arguments." >&2
    exit 64
  fi
  if [[ ! -f "${manifest}" || -L "${manifest}" ||
    "$(realpath -e -- "${manifest}" 2>/dev/null || true)" != "${manifest}" ]]; then
    echo "UI rollback evidence manifest is missing or noncanonical: ${manifest}" >&2
    exit 1
  fi
  mode="$(stat --format=%a -- "${manifest}")"
  manifest_owner="$(stat --format=%u -- "${manifest}")"
  if ((8#${mode} & 07022)) || [[ "${manifest_owner}" != "${EUID}" ]]; then
    echo "UI rollback evidence manifest has unsafe mode or ownership." >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" != *=* ]]; then
      echo "Malformed UI rollback evidence manifest line." >&2
      exit 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    if [[ -n "${seen[${key}]:-}" ]]; then
      echo "Duplicate UI rollback evidence manifest key: ${key}" >&2
      exit 1
    fi
    case "${key}" in
      format | scope | model | recorded_at | archive_name | archive_sha256 | archive_payload_model) ;;
      *)
        allowed_key=false
        for surface in "${surfaces[@]}"; do
          if [[ "${key}" == "surface.${surface}.file_count" ||
            "${key}" == "surface.${surface}.sha256" ]]; then
            allowed_key=true
            break
          fi
        done
        if [[ "${allowed_key}" != "true" ]]; then
          echo "Unknown UI rollback evidence manifest key: ${key}" >&2
          exit 1
        fi
        ;;
    esac
    seen["${key}"]=1
    values["${key}"]="${value}"
  done <"${manifest}"

  if [[ "${values[format]:-}" != "proofofwork-ui-rollback-evidence-v1" ]] ||
    [[ "${values[scope]:-}" != "ui-surfaces-only" ]] ||
    [[ "${values[model]:-}" != "exact-surface-files-bytes-and-modes-v1" ]] ||
    [[ ! "${values[recorded_at]:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
    [[ ! "${values[archive_name]:-}" =~ ^proofofwork-ui-release-[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.tgz$ ]] ||
    [[ ! "${values[archive_sha256]:-}" =~ ^[0-9a-f]{64}$ ]] ||
    [[ "${values[archive_payload_model]:-}" != "surfaces-v1" ]]; then
    echo "UI rollback evidence manifest metadata is invalid." >&2
    exit 1
  fi
  if [[ "${values[surface.nft.file_count]:-}" != "${values[surface.computer.file_count]:-}" ||
    "${values[surface.nft.sha256]:-}" != "${values[surface.computer.sha256]:-}" ]]; then
    echo "UI rollback evidence does not preserve the NFT compatibility alias." >&2
    exit 1
  fi

  archive="${archive_root}/${values[archive_name]}"
  actual_archive_sha256="$(verified_archive_sha256 "${archive}" "${values[archive_sha256]}")"
  archive_provenance="${archive}.provenance"
  if [[ -f "${archive_provenance}" && ! -L "${archive_provenance}" ]]; then
    provenance_mode="$(stat --format=%a -- "${archive_provenance}")"
    provenance_owner="$(stat --format=%u -- "${archive_provenance}")"
  else
    provenance_mode=""
    provenance_owner=""
  fi
  if [[ "${actual_archive_sha256}" != "${values[archive_sha256]}" ]] ||
    [[ ! -f "${archive_provenance}" || -L "${archive_provenance}" ]] ||
    [[ "${provenance_owner}" != "${EUID}" ]] ||
    [[ ! "${provenance_mode}" =~ ^[0-7]+$ ]] ||
    ((8#${provenance_mode} & 07022)) ||
    ! cmp --silent -- "${manifest}" "${archive_provenance}"; then
    echo "UI rollback evidence is not bound to matching retained archive provenance." >&2
    exit 1
  fi

  for surface in "${surfaces[@]}"; do
    expected_count="${values[surface.${surface}.file_count]:-}"
    expected_digest="${values[surface.${surface}.sha256]:-}"
    if [[ ! "${expected_count}" =~ ^[1-9][0-9]*$ ||
      ! "${expected_digest}" =~ ^[0-9a-f]{64}$ ]]; then
      echo "UI rollback evidence is missing surface evidence: ${surface}" >&2
      exit 1
    fi
    validate_surface "${surface}"
    actual_count="$(surface_file_count "${surface}")"
    actual_digest="$(surface_tree_sha256 "${surface}")"
    if [[ "${actual_count}" != "${expected_count}" ||
      "${actual_digest}" != "${expected_digest}" ]]; then
      echo "UI rollback evidence mismatch: ${surface}" >&2
      exit 1
    fi
    counts["${surface}"]="${expected_count}"
    digests["${surface}"]="${expected_digest}"
  done
  verify_archive_payload "${archive}" counts digests
  printf 'ui_rollback_evidence status=verified archive_sha256=%s\n' \
    "${values[archive_sha256]}"
}

verify_rollback_capability() {
  local line key format_value="" format_count=0
  if (($# != 0)); then
    echo "verify-rollback accepts no additional arguments." >&2
    exit 64
  fi
  if [[ ! -f "${manifest}" || -L "${manifest}" ||
    "$(realpath -e -- "${manifest}" 2>/dev/null || true)" != "${manifest}" ]]; then
    echo "UI rollback capability is unattributed: ${manifest}" >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" != *=* ]]; then
      echo "UI rollback capability manifest is malformed." >&2
      exit 1
    fi
    key="${line%%=*}"
    if [[ "${key}" == "format" ]]; then
      format_value="${line#*=}"
      ((format_count += 1))
    fi
  done <"${manifest}"
  if ((format_count != 1)); then
    echo "UI rollback capability manifest has no unique format." >&2
    exit 1
  fi
  case "${format_value}" in
    proofofwork-ui-release-v3)
      verify_manifest
      ;;
    proofofwork-ui-rollback-evidence-v1)
      verify_rollback_evidence
      ;;
    *)
      echo "UI rollback capability manifest has an unknown format: ${format_value}" >&2
      exit 1
      ;;
  esac
}

case "${command}" in
  record-rollback-evidence) record_rollback_evidence "$@" ;;
  record) process_release_manifest "record" "$@" ;;
  verify-candidate) process_release_manifest "verify-candidate" "$@" ;;
  verify) verify_manifest "$@" ;;
  verify-rollback) verify_rollback_capability "$@" ;;
  *)
    echo "Usage: $0 verify-candidate --release-id ID --commit HEX --source-checkout /canonical/checkout --archive /canonical/release.tgz | record --release-id ID --commit HEX --source-checkout /canonical/checkout --archive /canonical/release.tgz | record-rollback-evidence --archive /canonical/release.tgz | verify | verify-rollback" >&2
    exit 64
    ;;
esac
