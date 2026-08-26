#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

www_root="${POW_UI_PUBLISH_WWW_ROOT:-/var/www}"
staging_root="${POW_UI_PUBLISH_STAGING_ROOT:-/var/tmp/proofofwork-deploy}"
archive_root="${POW_UI_RELEASE_ARCHIVE_ROOT:-/var/backups/proofofwork-ui/releases}"
rollback_root_parent="${POW_UI_PUBLISH_ROLLBACK_ROOT:-/var/backups/proofofwork-ui/rollback-roots}"
provenance_script="${POW_UI_PUBLISH_PROVENANCE_SCRIPT:-/usr/local/sbin/proofofwork-ui-release-provenance}"
deploy_lock="${POW_UI_DEPLOY_LOCK:-/run/proofofwork-ui/deploy.lock}"
allow_test_roots="${POW_UI_ALLOW_TEST_ROOTS:-}"

release_id=""
commit=""
source_checkout=""
archive=""

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
      echo "Unknown publish argument: $1" >&2
      exit 64
      ;;
  esac
done

if ((EUID != 0)) && [[ "${allow_test_roots}" != "1" ]]; then
  echo "UI release publication must run as root." >&2
  exit 77
fi
if [[ ! "${release_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "Release id must use 1-128 safe filename characters." >&2
  exit 64
fi
if [[ ! "${commit}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  echo "Commit must be a full lowercase hexadecimal object id." >&2
  exit 64
fi

if [[ "${allow_test_roots}" != "1" ]] && {
  [[ "${www_root}" != "/var/www" ]] ||
    [[ "${staging_root}" != "/var/tmp/proofofwork-deploy" ]] ||
    [[ "${archive_root}" != "/var/backups/proofofwork-ui/releases" ]] ||
    [[ "${rollback_root_parent}" != "/var/backups/proofofwork-ui/rollback-roots" ]] ||
    [[ "${provenance_script}" != "/usr/local/sbin/proofofwork-ui-release-provenance" ]] ||
    [[ "${deploy_lock}" != "/run/proofofwork-ui/deploy.lock" ]];
}; then
  echo "Non-production UI publisher paths require POW_UI_ALLOW_TEST_ROOTS=1." >&2
  exit 64
fi
if [[ "${allow_test_roots}" != "1" ]] && {
  [[ -n "${POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_HELPER_AFTER_SYSCALL:-}" ]] ||
    [[ -n "${POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_DURABILITY:-}" ]] ||
    [[ -n "${POW_UI_PUBLISH_TEST_FAIL_BEFORE_EXCHANGE:-}" ]] ||
    [[ -n "${POW_UI_PUBLISH_TEST_FAIL_AFTER_SWAP:-}" ]] ||
    [[ -n "${POW_UI_PUBLISH_TEST_FAIL_ACTIVE_PROVENANCE:-}" ]] ||
    [[ -n "${POW_UI_PUBLISH_TEST_FAIL_ROLLBACK_DURABILITY:-}" ]] ||
    [[ -n "${POW_UI_PUBLISH_TEST_FAIL_RESTORE_VERIFICATION:-}" ]];
}; then
  echo "Publisher failure injection requires POW_UI_ALLOW_TEST_ROOTS=1." >&2
  exit 64
fi

stage_root="${staging_root}/proofofwork-www-stage-${release_id}"
rollback_root="${rollback_root_parent}/proofofwork-www-pre-${release_id}"
expected_source_checkout="${staging_root}/proofofwork-ui-source-${release_id}"
expected_archive="${archive_root}/proofofwork-ui-release-${release_id}.tgz"

if [[ "${source_checkout}" != "${expected_source_checkout}" ]]; then
  echo "Source checkout must use the exact release-bound staging path: ${expected_source_checkout}" >&2
  exit 64
fi
if [[ "${archive}" != "${expected_archive}" ]]; then
  echo "Archive must use the exact release-bound managed path: ${expected_archive}" >&2
  exit 64
fi

canonical_safe_directory() {
  local directory="$1"
  local label="$2"
  local mode owner
  if [[ ! -d "${directory}" || -L "${directory}" ||
    "$(realpath -e -- "${directory}" 2>/dev/null || true)" != "${directory}" ]]; then
    echo "${label} must be a real canonical directory: ${directory}" >&2
    return 1
  fi
  mode="$(stat --format=%a -- "${directory}")"
  owner="$(stat --format=%u -- "${directory}")"
  if [[ "${owner}" != "${EUID}" ]] || ((8#${mode} & 07022)); then
    echo "${label} must be owner-controlled and not group/world writable: ${directory}" >&2
    return 1
  fi
}

for directory_and_label in \
  "${www_root}|UI root" \
  "${staging_root}|UI staging root" \
  "${archive_root}|UI archive root" \
  "${rollback_root_parent}|UI rollback root parent" \
  "${stage_root}|staged UI root" \
  "${source_checkout}|UI source checkout"; do
  canonical_safe_directory "${directory_and_label%%|*}" "${directory_and_label#*|}"
done

www_root_metadata="$(stat --format='%a:%u:%g' -- "${www_root}")"
stage_root_metadata="$(stat --format='%a:%u:%g' -- "${stage_root}")"
if [[ "${stage_root_metadata}" != "${www_root_metadata}" ]]; then
  echo "Staged UI root must preserve the live /var/www root mode, uid, and gid." >&2
  exit 1
fi

refuse_existing_rollback_roots() {
  local -a existing_rollback_roots
  shopt -s nullglob
  existing_rollback_roots=("${rollback_root_parent}"/proofofwork-www-pre-*)
  shopt -u nullglob
  if ((${#existing_rollback_roots[@]} > 0)); then
    echo "Refusing publication while a complete-root UI rollback awaits post-soak evidence classification: ${existing_rollback_roots[0]}" >&2
    return 1
  fi
}

refuse_existing_rollback_roots
if [[ ! -f "${archive}" || -L "${archive}" ||
  "$(realpath -e -- "${archive}" 2>/dev/null || true)" != "${archive}" ]]; then
  echo "Managed UI archive must be a canonical regular file: ${archive}" >&2
  exit 1
fi
if [[ ! -f "${provenance_script}" || -L "${provenance_script}" ||
  ! -x "${provenance_script}" ]]; then
  echo "UI provenance helper must be a regular executable: ${provenance_script}" >&2
  exit 1
fi
if [[ "${allow_test_roots}" != "1" ]] && {
  [[ "$(stat --format=%u -- "${provenance_script}")" != "0" ]] ||
    ((8#$(stat --format=%a -- "${provenance_script}") & 07022));
}; then
  echo "UI provenance helper has unsafe ownership or mode." >&2
  exit 1
fi
if [[ -e "${stage_root}/.proofofwork-ui-release" ||
  -L "${stage_root}/.proofofwork-ui-release" ]]; then
  echo "Staged UI root must not carry a pre-existing active manifest." >&2
  exit 1
fi

www_device="$(stat --format=%d -- "${www_root}")"
for exchange_path in "${stage_root}" "${rollback_root_parent}"; do
  if [[ "$(stat --format=%d -- "${exchange_path}")" != "${www_device}" ]]; then
    echo "UI live, staged, and rollback roots must share one filesystem." >&2
    exit 1
  fi
done

reject_nested_mounts() {
  local directory="$1"
  local mountinfo="${POW_UI_MOUNTINFO_PATH:-/proc/self/mountinfo}"
  if [[ "${mountinfo}" != "/proc/self/mountinfo" && "${allow_test_roots}" != "1" ]]; then
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
with open(sys.argv[2], encoding="utf-8") as source:
    for line in source:
        fields = line.split()
        if len(fields) < 5:
            raise SystemExit("Mount metadata contains a malformed record.")
        mount = (
            fields[4]
            .replace("\\040", " ")
            .replace("\\011", "\t")
            .replace("\\012", "\n")
            .replace("\\134", "\\")
        )
        mount = os.path.realpath(mount)
        try:
            nested = mount == root or os.path.commonpath((root, mount)) == root
        except ValueError:
            nested = False
        if nested:
            raise SystemExit(f"UI release root contains a nested mount: {mount}")
PY
}

reject_nested_mounts "${www_root}"
reject_nested_mounts "${stage_root}"
reject_nested_mounts "${rollback_root_parent}"

surfaces=(
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
if ((${#surfaces[@]} != 14)); then
  echo "UI publisher surface set must contain exactly 14 entries." >&2
  exit 70
fi
declare -A surface_seen=()
for surface in "${surfaces[@]}"; do
  if [[ -n "${surface_seen[${surface}]:-}" ]]; then
    echo "UI publisher surface set contains a duplicate: ${surface}" >&2
    exit 70
  fi
  surface_seen["${surface}"]=1
done
unset surface_seen surface

verify_prior_asset_compatibility() {
  /usr/bin/python3 -I - "${www_root}" "${stage_root}" "${surfaces[@]}" <<'PY'
import hashlib
import os
import re
import stat
import sys

live_root = os.path.realpath(sys.argv[1])
stage_root = os.path.realpath(sys.argv[2])
surfaces = sys.argv[3:]
quoted_reference_pattern = re.compile(
    rb'''["'`](?P<reference>[^"'`?#\x00-\x20]+)'''
)
css_url_pattern = re.compile(
    rb'''url\(\s*["']?(?P<reference>[^)"'?#\x00-\x20]+)''',
    re.IGNORECASE,
)
css_import_pattern = re.compile(
    rb'''@import\s+(?:url\(\s*)?["']?(?P<reference>[^)"';?#\x00-\x20]+)''',
    re.IGNORECASE,
)
maximum_index_bytes = 2 * 1024 * 1024
maximum_asset_bytes = 64 * 1024 * 1024
maximum_total_bytes = 512 * 1024 * 1024
maximum_dependencies = 256
maximum_reference_edges = 4096
maximum_reference_candidates = 262144
dependency_count = 0
reference_edge_count = 0
reference_candidate_count = 0
total_bytes = 0

def canonical_file(root, relative, label):
    path = os.path.join(root, *relative.split("/"))
    if os.path.realpath(path) != path:
        raise SystemExit(f"{label} is not canonical: {relative}")
    details = os.lstat(path)
    if not stat.S_ISREG(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise SystemExit(f"{label} is not a regular file: {relative}")
    return path, details

def file_identity(details):
    return (
        details.st_dev,
        details.st_ino,
        details.st_mode,
        details.st_uid,
        details.st_gid,
        details.st_size,
        details.st_mtime_ns,
        details.st_ctime_ns,
    )

def digest_file(path, expected, capture=False):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    digest = hashlib.sha256()
    captured = []
    try:
        opened = os.fstat(descriptor)
        if file_identity(opened) != file_identity(expected):
            raise SystemExit(f"Compatibility asset changed during hashing: {path}")
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            if capture:
                captured.append(chunk)
        if file_identity(os.fstat(descriptor)) != file_identity(expected):
            raise SystemExit(f"Compatibility asset changed during hashing: {path}")
    finally:
        os.close(descriptor)
    return digest.digest(), b"".join(captured)

def resolve_reference(surface_root, current_path, reference_bytes):
    try:
        reference = reference_bytes.decode("ascii")
    except UnicodeDecodeError:
        return None
    if (
        "\\" in reference
        or any(ord(character) < 32 or ord(character) == 127 for character in reference)
    ):
        return None
    assets_root = os.path.join(surface_root, "assets")
    if reference.startswith("/assets/"):
        resolved = os.path.join(assets_root, reference.removeprefix("/assets/"))
    elif reference.startswith("assets/"):
        resolved = os.path.join(surface_root, reference)
    elif reference.startswith("//") or re.match(
        r"^[A-Za-z][A-Za-z0-9+.-]*:", reference
    ):
        return None
    elif reference.startswith("/"):
        resolved = os.path.normpath(
            os.path.join(surface_root, reference.removeprefix("/"))
        )
    else:
        resolved = os.path.normpath(os.path.join(os.path.dirname(current_path), reference))
    try:
        if os.path.commonpath((surface_root, resolved)) != surface_root:
            return None
    except ValueError:
        return None
    relative = os.path.relpath(resolved, surface_root).replace(os.sep, "/")
    if (
        not relative
        or relative.startswith("../")
        or relative.startswith("/")
        or "\\" in relative
        or any(part in ("", ".", "..") for part in relative.split("/"))
        or any(ord(character) < 32 or ord(character) == 127 for character in relative)
    ):
        return None
    live_path = os.path.join(surface_root, *relative.split("/"))
    if not os.path.lexists(live_path):
        return None
    live_details = os.lstat(live_path)
    if not stat.S_ISREG(live_details.st_mode) or stat.S_ISLNK(live_details.st_mode):
        return None
    return relative

def dependency_references(surface_root, current_path, content):
    global reference_candidate_count, reference_edge_count
    references = []
    patterns = [quoted_reference_pattern]
    if os.path.splitext(current_path)[1].lower() == ".css":
        patterns.extend((css_url_pattern, css_import_pattern))
    for pattern in patterns:
        for match in pattern.finditer(content):
            reference_candidate_count += 1
            if reference_candidate_count > maximum_reference_candidates:
                raise SystemExit("Prior UI compatibility reference-candidate bound exceeded.")
            relative = resolve_reference(
                surface_root, current_path, match.group("reference")
            )
            if relative is not None:
                reference_edge_count += 1
                if reference_edge_count > maximum_reference_edges:
                    raise SystemExit("Prior UI compatibility reference-edge bound exceeded.")
                references.append(relative)
    return references

for surface in surfaces:
    surface_relative = f"proofofwork-{surface}"
    live_surface_root = os.path.join(live_root, surface_relative)
    index_relative = f"{surface_relative}/index.html"
    live_index, live_index_details = canonical_file(
        live_root, index_relative, "Prior UI index"
    )
    if live_index_details.st_size > maximum_index_bytes:
        raise SystemExit(f"Prior UI index exceeds compatibility bound: {surface}")
    _, index_bytes = digest_file(live_index, live_index_details, capture=True)
    pending = dependency_references(live_surface_root, live_index, index_bytes)
    visited = set()
    while pending:
        surface_dependency = pending.pop()
        if surface_dependency in visited:
            continue
        visited.add(surface_dependency)
        dependency_count += 1
        if dependency_count > maximum_dependencies:
            raise SystemExit("Prior UI compatibility dependency bound exceeded.")
        relative = f"{surface_relative}/{surface_dependency}"
        live_asset, live_details = canonical_file(
            live_root, relative, "Prior UI compatibility dependency"
        )
        try:
            stage_asset, stage_details = canonical_file(
                stage_root, relative, "Staged UI compatibility dependency"
            )
        except FileNotFoundError as error:
            raise SystemExit(
                f"Staged UI release is missing prior dependency: {surface}/{surface_dependency}"
            ) from error
        if live_details.st_size > maximum_asset_bytes:
            raise SystemExit(
                f"Prior UI compatibility dependency exceeds per-file bound: {surface}/{surface_dependency}"
            )
        total_bytes += live_details.st_size
        if total_bytes > maximum_total_bytes:
            raise SystemExit("Prior UI compatibility dependency byte bound exceeded.")
        capture_dependency = os.path.splitext(surface_dependency)[1].lower() in (
            ".css",
            ".js",
            ".mjs",
        )
        live_digest, dependency_bytes = digest_file(
            live_asset, live_details, capture=capture_dependency
        )
        stage_digest, _ = digest_file(stage_asset, stage_details)
        if live_details.st_size != stage_details.st_size or live_digest != stage_digest:
            raise SystemExit(
                f"Staged UI compatibility dependency collision differs from prior bytes: {surface}/{surface_dependency}"
            )
        if capture_dependency:
            pending.extend(
                dependency_references(live_surface_root, live_asset, dependency_bytes)
            )

print(f"ui_release_compatibility dependencies={dependency_count} bytes={total_bytes}")
PY
}

passthrough_digest() {
  local root="$1"
  shift
  /usr/bin/python3 -I - "${root}" "$@" <<'PY'
import hashlib
import os
import stat
import struct
import sys

root = os.path.realpath(sys.argv[1])
excluded = {".proofofwork-ui-release", *(f"proofofwork-{name}" for name in sys.argv[2:])}
digest = hashlib.sha256()
count = 0
total_bytes = 0

def add(value):
    digest.update(struct.pack(">Q", len(value)))
    digest.update(value)

def record(relative, kind, details, evidence=b""):
    global count
    add(os.fsencode(relative))
    add(kind)
    add(f"{stat.S_IMODE(details.st_mode):04o}".encode("ascii"))
    add(str(details.st_uid).encode("ascii"))
    add(str(details.st_gid).encode("ascii"))
    add(evidence)
    count += 1

def walk(directory, relative_directory=""):
    global total_bytes
    for entry in sorted(os.scandir(directory), key=lambda value: os.fsencode(value.name)):
        if not relative_directory and entry.name in excluded:
            continue
        relative = entry.name if not relative_directory else f"{relative_directory}/{entry.name}"
        if (
            not relative
            or relative.startswith("/")
            or "\\" in relative
            or any(part in ("", ".", "..") for part in relative.split("/"))
            or any(ord(character) < 32 or ord(character) == 127 for character in relative)
        ):
            raise SystemExit(f"Unsafe passthrough path: {relative!r}")
        details = entry.stat(follow_symlinks=False)
        if stat.S_ISDIR(details.st_mode):
            record(relative, b"directory", details)
            walk(entry.path, relative)
        elif stat.S_ISREG(details.st_mode):
            file_digest = hashlib.sha256()
            descriptor = os.open(entry.path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            try:
                opened = os.fstat(descriptor)
                if (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_size) != (
                    details.st_dev,
                    details.st_ino,
                    details.st_mode,
                    details.st_size,
                ):
                    raise SystemExit(f"Passthrough file changed during hashing: {relative}")
                while True:
                    chunk = os.read(descriptor, 1024 * 1024)
                    if not chunk:
                        break
                    file_digest.update(chunk)
            finally:
                os.close(descriptor)
            total_bytes += details.st_size
            record(relative, b"file", details, file_digest.digest())
        else:
            raise SystemExit(f"Unsupported passthrough file type: {relative}")

walk(root)
print(f"{count}\t{total_bytes}\t{digest.hexdigest()}")
PY
}

live_passthrough="$(passthrough_digest "${www_root}" "${surfaces[@]}")"
stage_passthrough="$(passthrough_digest "${stage_root}" "${surfaces[@]}")"
if [[ "${live_passthrough}" != "${stage_passthrough}" ]]; then
  echo "Staged UI root does not preserve every non-release /var/www path, mode, owner, and byte." >&2
  exit 1
fi

lock_parent="$(dirname -- "${deploy_lock}")"
canonical_safe_directory "${lock_parent}" "UI deployment lock parent"
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

# Repeat the growth guard under the shared lock so a lock-aware classifier or
# publisher cannot race the earlier fail-fast check.
refuse_existing_rollback_roots
verify_prior_asset_compatibility

verify_current_rollback_capability() {
  POW_UI_WWW_ROOT="${www_root}" \
  POW_UI_RELEASE_ARCHIVE_ROOT="${archive_root}" \
  POW_UI_ALLOW_TEST_ROOTS="${allow_test_roots}" \
  POW_UI_DEPLOY_LOCK="${deploy_lock}" \
  POW_UI_DEPLOY_LOCK_FD="${deploy_lock_fd}" \
    "${provenance_script}" verify-rollback
}

verify_current_rollback_capability

exchange_directories() {
  /usr/bin/python3 -I - "$1" "$2" "${3:-0}" <<'PY'
import ctypes
import errno
import os
import stat
import sys

left, right, inject_after_syscall = sys.argv[1:]
for path in (left, right):
    details = os.lstat(path)
    if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
        raise SystemExit(f"renameat2 exchange requires a real directory: {path}")
left_before = os.lstat(left)
right_before = os.lstat(right)
if left_before.st_dev != right_before.st_dev:
    raise SystemExit("renameat2 exchange paths are on different filesystems.")
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = getattr(libc, "renameat2", None)
if renameat2 is None:
    raise SystemExit("renameat2(RENAME_EXCHANGE) is unavailable in libc.")
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
result = renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2)
if result != 0:
    error = ctypes.get_errno()
    unsupported = error in (errno.ENOSYS, errno.EINVAL, errno.EOPNOTSUPP, errno.EXDEV)
    description = os.strerror(error)
    if unsupported:
        raise SystemExit(f"renameat2(RENAME_EXCHANGE) is unsupported: {description}")
    raise SystemExit(f"renameat2(RENAME_EXCHANGE) failed: {description}")
if inject_after_syscall == "1":
    raise SystemExit("Injected exchange-helper failure after renameat2 syscall.")
PY
}

rename_directory() {
  /usr/bin/python3 -I - "$1" "$2" <<'PY'
import os
import stat
import sys

source, destination = sys.argv[1:]
details = os.lstat(source)
if not stat.S_ISDIR(details.st_mode) or stat.S_ISLNK(details.st_mode):
    raise SystemExit("Rollback source is not a real directory.")
if os.path.lexists(destination):
    raise SystemExit("Rollback destination already exists.")
if details.st_dev != os.stat(os.path.dirname(destination)).st_dev:
    raise SystemExit("Rollback rename would cross filesystems.")
os.rename(source, destination)
PY
}

directory_identity() {
  if [[ ! -d "$1" || -L "$1" ]]; then
    return 1
  fi
  stat --format='%d:%i' -- "$1"
}

verify_directory_identity() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(directory_identity "${path}" 2>/dev/null || true)"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Directory identity verification failed for ${path}." >&2
    return 1
  fi
}

fsync_parent_directories() {
  /usr/bin/python3 -I - "$@" <<'PY'
import os
import sys

parents = {os.path.dirname(path) for path in sys.argv[1:]}
for parent in parents:
    descriptor = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
PY
}

probe_left="${staging_root}/.proofofwork-exchange-probe-left.$$"
probe_right="${staging_root}/.proofofwork-exchange-probe-right.$$"
if [[ -e "${probe_left}" || -L "${probe_left}" || -e "${probe_right}" || -L "${probe_right}" ]]; then
  echo "Atomic exchange probe path already exists." >&2
  exit 1
fi
mkdir --mode=0700 -- "${probe_left}" "${probe_right}"
probe_present=1
committed=0
exchange_armed=0
old_root_path="${stage_root}"
prior_www_identity=""
staged_www_identity=""

cleanup_and_rollback() {
  local status=$? candidate candidate_identity live_identity restore_root=""
  local rollback_cleanup_ok=1 relabel_succeeded=0
  trap - EXIT
  if ((exchange_armed == 1 && committed == 0)); then
    live_identity="$(directory_identity "${www_root}" 2>/dev/null || true)"
    if [[ "${live_identity}" == "${prior_www_identity}" ]]; then
      exchange_armed=0
    elif [[ "${live_identity}" != "${staged_www_identity}" ]]; then
      echo "CRITICAL: UI release failed with an unrecognized live root identity." >&2
      status=70
    else
      for candidate in "${old_root_path}" "${stage_root}" "${rollback_root}"; do
        candidate_identity="$(directory_identity "${candidate}" 2>/dev/null || true)"
        if [[ "${candidate_identity}" == "${prior_www_identity}" ]]; then
          restore_root="${candidate}"
          break
        fi
      done
      if [[ -z "${restore_root}" ]]; then
        echo "CRITICAL: UI release failed and the complete prior root could not be located for rollback." >&2
        status=70
      elif exchange_directories "${www_root}" "${restore_root}"; then
        exchange_armed=0
        if ! verify_directory_identity "${www_root}" "${prior_www_identity}"; then
          rollback_cleanup_ok=0
        fi
        if ! verify_directory_identity "${restore_root}" "${staged_www_identity}"; then
          rollback_cleanup_ok=0
        fi
        if [[ "${restore_root}" == "${rollback_root}" &&
          -n "${POW_UI_PUBLISH_TEST_FAIL_RESTORE_VERIFICATION:-}" ]]; then
          echo "Injected restored-root identity verification failure." >&2
          rollback_cleanup_ok=0
        fi
        if ! fsync_parent_directories "${www_root}" "${restore_root}"; then
          rollback_cleanup_ok=0
        fi
        if [[ "${restore_root}" == "${rollback_root}" ]]; then
          if rename_directory "${rollback_root}" "${stage_root}"; then
            relabel_succeeded=1
            if ! verify_directory_identity "${stage_root}" "${staged_www_identity}"; then
              rollback_cleanup_ok=0
            fi
            if [[ -e "${rollback_root}" || -L "${rollback_root}" ]]; then
              rollback_cleanup_ok=0
            fi
            if ! fsync_parent_directories "${rollback_root}" "${stage_root}"; then
              rollback_cleanup_ok=0
            fi
          else
            rollback_cleanup_ok=0
          fi
          if ((relabel_succeeded == 0)); then
            echo "CRITICAL: the prior UI root was restored, but the failed candidate could not be returned to its truthful stage path." >&2
          fi
        fi
        if ((rollback_cleanup_ok == 1)); then
          echo "UI release post-swap verification failed; the complete prior /var/www root was atomically restored." >&2
        else
          echo "CRITICAL: the prior UI root was exchanged back, but rollback verification, durability, or truthful relabeling failed." >&2
          status=70
        fi
      else
        echo "CRITICAL: UI release failed and the complete-root rollback exchange also failed." >&2
        status=70
      fi
    fi
  fi
  if ((probe_present == 1)); then
    rmdir -- "${probe_left}" "${probe_right}" 2>/dev/null || true
  fi
  exit "${status}"
}
trap cleanup_and_rollback EXIT

probe_left_identity="$(directory_identity "${probe_left}")"
probe_right_identity="$(directory_identity "${probe_right}")"
exchange_directories "${probe_left}" "${probe_right}"
verify_directory_identity "${probe_left}" "${probe_right_identity}"
verify_directory_identity "${probe_right}" "${probe_left_identity}"
fsync_parent_directories "${probe_left}" "${probe_right}"
exchange_directories "${probe_left}" "${probe_right}"
verify_directory_identity "${probe_left}" "${probe_left_identity}"
verify_directory_identity "${probe_right}" "${probe_right_identity}"
fsync_parent_directories "${probe_left}" "${probe_right}"
rmdir -- "${probe_left}" "${probe_right}"
probe_present=0

POW_UI_WWW_ROOT="${stage_root}" \
POW_UI_RELEASE_ARCHIVE_ROOT="${archive_root}" \
POW_UI_STAGED_ROOT=1 \
POW_UI_ALLOW_TEST_ROOTS="${allow_test_roots}" \
POW_UI_DEPLOY_LOCK="${deploy_lock}" \
POW_UI_DEPLOY_LOCK_FD="${deploy_lock_fd}" \
  "${provenance_script}" verify-candidate \
    --release-id "${release_id}" \
    --commit "${commit}" \
    --source-checkout "${source_checkout}" \
    --archive "${archive}"

if [[ "$(passthrough_digest "${www_root}" "${surfaces[@]}")" != "${live_passthrough}" ||
  "$(passthrough_digest "${stage_root}" "${surfaces[@]}")" != "${stage_passthrough}" ]]; then
  echo "Live or staged passthrough content changed before atomic exchange." >&2
  exit 1
fi
if [[ "$(stat --format='%a:%u:%g' -- "${www_root}")" != "${www_root_metadata}" ||
  "$(stat --format='%a:%u:%g' -- "${stage_root}")" != "${stage_root_metadata}" ]]; then
  echo "Live or staged UI root metadata changed before atomic exchange." >&2
  exit 1
fi

# Rebind the rollback proof to the exact live bytes immediately before the
# exchange. This closes the window in which an out-of-band writer could drift
# a fully attributed or legacy bytes-only root after the first locked check.
verify_current_rollback_capability

if [[ -n "${POW_UI_PUBLISH_TEST_FAIL_BEFORE_EXCHANGE:-}" ]]; then
  echo "Injected failure after candidate verification and before atomic exchange." >&2
  exit 1
fi

sync --file-system "${stage_root}"
sync --file-system "${archive}"
prior_www_identity="$(directory_identity "${www_root}")"
staged_www_identity="$(directory_identity "${stage_root}")"
exchange_helper_injection=0
if [[ -n "${POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_HELPER_AFTER_SYSCALL:-}" ]]; then
  exchange_helper_injection=1
fi
exchange_armed=1
exchange_directories "${www_root}" "${stage_root}" \
  "${exchange_helper_injection}"
old_root_path="${stage_root}"
verify_directory_identity "${www_root}" "${staged_www_identity}"
verify_directory_identity "${stage_root}" "${prior_www_identity}"
if [[ "$(stat --format='%a:%u:%g' -- "${www_root}")" != "${stage_root_metadata}" ]]; then
  echo "Published UI root metadata changed during atomic exchange." >&2
  exit 1
fi

if [[ -n "${POW_UI_PUBLISH_TEST_FAIL_EXCHANGE_DURABILITY:-}" ]]; then
  echo "Injected post-exchange durability failure." >&2
  exit 1
fi
fsync_parent_directories "${www_root}" "${stage_root}"

if [[ -n "${POW_UI_PUBLISH_TEST_FAIL_AFTER_SWAP:-}" ]]; then
  echo "Injected post-swap verification failure." >&2
  exit 1
fi

if [[ -n "${POW_UI_PUBLISH_TEST_FAIL_ACTIVE_PROVENANCE:-}" ]]; then
  echo "Injected active-provenance finalization failure after atomic exchange." >&2
  exit 1
fi

POW_UI_WWW_ROOT="${www_root}" \
POW_UI_RELEASE_ARCHIVE_ROOT="${archive_root}" \
POW_UI_ALLOW_TEST_ROOTS="${allow_test_roots}" \
POW_UI_DEPLOY_LOCK="${deploy_lock}" \
POW_UI_DEPLOY_LOCK_FD="${deploy_lock_fd}" \
  "${provenance_script}" record \
    --release-id "${release_id}" \
    --commit "${commit}" \
    --source-checkout "${source_checkout}" \
    --archive "${archive}"

POW_UI_WWW_ROOT="${www_root}" \
POW_UI_RELEASE_ARCHIVE_ROOT="${archive_root}" \
POW_UI_ALLOW_TEST_ROOTS="${allow_test_roots}" \
POW_UI_DEPLOY_LOCK="${deploy_lock}" \
POW_UI_DEPLOY_LOCK_FD="${deploy_lock_fd}" \
  "${provenance_script}" verify

if [[ "$(passthrough_digest "${www_root}" "${surfaces[@]}")" != "${stage_passthrough}" ]]; then
  echo "Post-swap UI root lost or changed non-release /var/www content." >&2
  exit 1
fi

rename_directory "${stage_root}" "${rollback_root}"
old_root_path="${rollback_root}"
verify_directory_identity "${rollback_root}" "${prior_www_identity}"

if [[ -n "${POW_UI_PUBLISH_TEST_FAIL_ROLLBACK_DURABILITY:-}" ]]; then
  echo "Injected rollback-preservation durability failure." >&2
  exit 1
fi
fsync_parent_directories "${stage_root}" "${rollback_root}"
verify_directory_identity "${www_root}" "${staged_www_identity}"
committed=1
exchange_armed=0
trap - EXIT

printf 'ui_release_publish status=published release_id=%s commit=%s rollback_root=%s\n' \
  "${release_id}" "${commit}" "${rollback_root}"
