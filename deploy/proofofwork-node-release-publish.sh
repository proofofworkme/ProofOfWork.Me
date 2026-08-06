#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

retention_root="/data/proofofwork-release-backups/managed"
checkout="/opt/proofofwork-api"
staging_root="/var/tmp/proofofwork-deploy"
source_archive="${1:-}"
max_source_bytes="${POW_NODE_RELEASE_MAX_SOURCE_BYTES:-8589934592}"
minimum_headroom_bytes="${POW_NODE_RELEASE_MIN_HEADROOM_BYTES:-1073741824}"
if [[ -z "${source_archive}" || -n "${2:-}" ]]; then
  echo "Usage: proofofwork-node-release-publish /var/tmp/proofofwork-deploy/proofofwork-node-release-<commit>-<timestamp>.tgz" >&2
  exit 64
fi
if ((EUID != 0)); then
  echo "Node release publication must run as root." >&2
  exit 77
fi
for value in "${max_source_bytes}" "${minimum_headroom_bytes}"; do
  if [[ ! "${value}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Node release byte limits must be positive integers." >&2
    exit 64
  fi
done
for directory in "${retention_root}" "${checkout}" "${staging_root}"; do
  if [[ ! -d "${directory}" || -L "${directory}" ||
    "$(/usr/bin/realpath -e -- "${directory}")" != "${directory}" ]]; then
    echo "Node release root is not a real canonical directory: ${directory}" >&2
    exit 1
  fi
done

# The live checkout is writable by the unprivileged runtime/deploy account while
# this publisher runs as root. Never let Git inherit process, user, system, or
# repository configuration that can launch helpers. Runtime configuration has
# higher precedence than repository-local config and is inherited by child
# upload-pack/pack-objects processes as well.
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

if [[ ! -f "${source_archive}" || -L "${source_archive}" ]]; then
  echo "Release request must be a regular, non-symlink staged file." >&2
  exit 1
fi
source_archive="$(/usr/bin/realpath -e -- "${source_archive}")"
case "${source_archive}" in
  "${staging_root}"/*) ;;
  *)
    echo "Release request must be staged under ${staging_root}." >&2
    exit 1
    ;;
esac
source_mode="$(/usr/bin/stat --format=%a -- "${source_archive}")"
source_owner="$(/usr/bin/stat --format=%u -- "${source_archive}")"
if ((8#${source_mode} & 07022)) || [[ "${source_owner}" != "${EUID}" ]]; then
  echo "Release request has unsafe mode or ownership." >&2
  exit 1
fi

name="${source_archive##*/}"
if [[ ! "${name}" =~ ^proofofwork-node-release-[A-Za-z0-9._-]+\.tgz$ ]]; then
  echo "Release archive name is not allowlisted: ${name}" >&2
  exit 1
fi

# Print: commit<TAB>tree<TAB>runtime_entry_count<TAB>runtime_bytes<TAB>runtime_sha256.
# The Git proof reads every tracked path directly, so index flags, fsmonitor and
# status optimizations cannot hide drift. The runtime proof covers every path
# outside the freshly constructed .git directory, including ignored dependencies.
attest_checkout() {
  local target="$1"
  isolated_git_environment "${target}" /usr/bin/python3 -I - "${target}" <<'PY'
import hashlib
import os
import re
import stat
import struct
import subprocess
import sys

root = os.path.realpath(sys.argv[1])
if not os.path.isdir(root) or os.path.islink(root) or os.path.realpath(root) != sys.argv[1]:
    raise SystemExit("Checkout attestation requires a canonical directory.")

git_environment = dict(os.environ)

def git(*arguments, input_data=None, check=True):
    result = subprocess.run(
        [
            "/usr/bin/git",
            "-C",
            root,
            f"--git-dir={os.path.join(root, '.git')}",
            f"--work-tree={root}",
            *arguments,
        ],
        input=input_data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=git_environment,
        check=False,
    )
    if check and result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise SystemExit(f"Git checkout attestation failed: {message}")
    return result

top = git("rev-parse", "--show-toplevel").stdout.rstrip(b"\n").decode()
if os.path.realpath(top) != root:
    raise SystemExit("Live node path is not its Git checkout root.")
symbolic = git("symbolic-ref", "--quiet", "HEAD", check=False)
if symbolic.returncode == 0:
    raise SystemExit("Live node checkout must be detached.")
if symbolic.returncode not in (1,):
    raise SystemExit("Unable to prove that the live node checkout is detached.")
commit = git("rev-parse", "--verify", "HEAD^{commit}").stdout.strip().decode("ascii")
tree = git("rev-parse", "--verify", "HEAD^{tree}").stdout.strip().decode("ascii")
object_id = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
if not object_id.fullmatch(commit) or not object_id.fullmatch(tree):
    raise SystemExit("Live node commit or tree identity is invalid.")

def split_zero(data):
    return [] if not data else data.rstrip(b"\0").split(b"\0")

def safe_path(path_bytes):
    try:
        path = path_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SystemExit("Checkout contains a non-UTF-8 path.") from error
    if (
        not path
        or path.startswith("/")
        or "\\" in path
        or any(part in ("", ".", "..") for part in path.split("/"))
        or any(ord(character) < 32 or ord(character) == 127 for character in path)
    ):
        raise SystemExit(f"Checkout contains an unsafe path: {path!r}")
    return path

nonignored = split_zero(git("ls-files", "--others", "--exclude-standard", "-z").stdout)
if nonignored:
    raise SystemExit(f"Checkout contains untracked non-ignored path: {safe_path(nonignored[0])}")
ignored = split_zero(
    git("ls-files", "--others", "--ignored", "--exclude-standard", "-z").stdout
)
for ignored_path in ignored:
    path = safe_path(ignored_path)
    if not path.startswith("node_modules/"):
        raise SystemExit(f"Checkout contains non-runtime ignored path: {path}")

node_modules = os.path.join(root, "node_modules")
try:
    node_modules_stat = os.lstat(node_modules)
except FileNotFoundError as error:
    raise SystemExit("Checkout lacks the required node_modules runtime tree.") from error
if not stat.S_ISDIR(node_modules_stat.st_mode) or os.path.islink(node_modules):
    raise SystemExit("Checkout node_modules runtime tree is not a real directory.")

tracked_entries = split_zero(git("ls-tree", "-r", "-z", "--full-tree", commit).stdout)
if not tracked_entries:
    raise SystemExit("Checkout Git tree contains no tracked files.")
for record in tracked_entries:
    try:
        metadata, path_bytes = record.split(b"\t", 1)
        mode_bytes, object_type, expected_object = metadata.split(b" ", 2)
    except ValueError as error:
        raise SystemExit("Git tree returned a malformed tracked record.") from error
    path = safe_path(path_bytes)
    mode = mode_bytes.decode("ascii")
    if object_type != b"blob":
        raise SystemExit(f"Git tree contains unsupported object at {path}.")
    absolute = os.path.join(root, *path.split("/"))
    try:
        details = os.lstat(absolute)
    except FileNotFoundError as error:
        raise SystemExit(f"Checkout is missing tracked path: {path}") from error
    if mode in ("100644", "100755"):
        if not stat.S_ISREG(details.st_mode):
            raise SystemExit(f"Tracked path is not a regular file: {path}")
        if details.st_mode & 0o7022:
            raise SystemExit(f"Tracked path has an unsafe mode: {path}")
        executable = bool(details.st_mode & 0o111)
        if executable != (mode == "100755"):
            raise SystemExit(f"Tracked executable mode differs from Git: {path}")
        actual_object = git("hash-object", "--no-filters", "--", path).stdout.strip()
    elif mode == "120000":
        if not stat.S_ISLNK(details.st_mode):
            raise SystemExit(f"Tracked path is not a symbolic link: {path}")
        target = os.readlink(absolute)
        actual_object = git("hash-object", "--stdin", input_data=os.fsencode(target)).stdout.strip()
    else:
        raise SystemExit(f"Git tree contains unsupported mode {mode} at {path}.")
    if actual_object != expected_object:
        raise SystemExit(f"Checkout tracked bytes differ from Git tree: {path}")

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
        safe_path(os.fsencode(relative))
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
if git("rev-parse", "--verify", "HEAD^{commit}").stdout.strip().decode("ascii") != commit:
    raise SystemExit("Checkout commit changed during attestation.")
if git("rev-parse", "--verify", "HEAD^{tree}").stdout.strip().decode("ascii") != tree:
    raise SystemExit("Checkout tree changed during attestation.")
print(f"{commit}\t{tree}\t{runtime_count}\t{runtime_bytes}\t{runtime_hash.hexdigest()}")
PY
}

if ! live_attestation="$(attest_checkout "${checkout}")"; then
  echo "Refusing to publish a node release without exact live checkout attestation." >&2
  exit 1
fi
IFS=$'\t' read -r commit tree runtime_entry_count runtime_bytes runtime_sha256 <<<"${live_attestation}"
if [[ ! "${commit}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ||
  ! "${tree}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ||
  ! "${runtime_entry_count}" =~ ^[1-9][0-9]*$ ||
  ! "${runtime_bytes}" =~ ^[1-9][0-9]*$ ||
  ! "${runtime_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Live node checkout attestation returned invalid evidence." >&2
  exit 1
fi
short_commit="${commit:0:7}"
if [[ ! "${name}" =~ (^|[-_.])${short_commit}([-_.]|$) ]]; then
  echo "Release archive name does not identify live commit ${short_commit}." >&2
  exit 1
fi

source_bytes="$(/usr/bin/du --summarize --bytes --one-file-system -- "${checkout}" | /usr/bin/awk '{print $1}')"
if [[ ! "${source_bytes}" =~ ^[1-9][0-9]*$ ]] || ((source_bytes > max_source_bytes)); then
  echo "Live node checkout exceeds the source-size safety limit." >&2
  exit 1
fi
required_free_bytes=$((source_bytes + minimum_headroom_bytes))
for storage_root in "${staging_root}" "${retention_root}"; do
  available_bytes="$(/usr/bin/df --block-size=1 --output=avail -- "${storage_root}" | /usr/bin/tail -n 1 | /usr/bin/tr -d '[:space:]')"
  if [[ ! "${available_bytes}" =~ ^[0-9]+$ ]] || ((available_bytes < required_free_bytes)); then
    echo "Insufficient free space to construct a bounded node release under ${storage_root}." >&2
    exit 1
  fi
done

final_archive="${retention_root}/${name}"
final_checksum="${final_archive}.sha256"
final_provenance="${final_archive}.provenance"
for destination in "${final_archive}" "${final_checksum}" "${final_provenance}"; do
  if [[ -e "${destination}" || -L "${destination}" ]]; then
    echo "Refusing to replace existing release evidence: ${destination}" >&2
    exit 1
  fi
done

archive_tmp="$(/usr/bin/mktemp --tmpdir="${retention_root}" ".${name}.archive.XXXXXX.tmp")"
checksum_tmp="$(/usr/bin/mktemp --tmpdir="${retention_root}" ".${name}.checksum.XXXXXX.tmp")"
provenance_tmp="$(/usr/bin/mktemp --tmpdir="${retention_root}" ".${name}.provenance.XXXXXX.tmp")"
build_root="$(/usr/bin/mktemp --directory --tmpdir="${staging_root}" .node-release-build.XXXXXX)"
cleanup() {
  for temporary in "${archive_tmp:-}" "${checksum_tmp:-}" "${provenance_tmp:-}"; do
    if [[ -n "${temporary}" ]]; then
      /usr/bin/rm -f -- "${temporary}"
    fi
  done
  if [[ -n "${build_root:-}" ]]; then
    case "${build_root}" in
      "${staging_root}"/.node-release-build.*)
        /usr/bin/rm --recursive --force --one-file-system -- "${build_root}"
        ;;
      *) echo "Refusing to clean unexpected node release build root: ${build_root}" >&2 ;;
    esac
  fi
}
trap cleanup EXIT
/usr/bin/chmod 0600 "${archive_tmp}" "${checksum_tmp}" "${provenance_tmp}"
/usr/bin/chmod 0700 "${build_root}"
empty_template="${build_root}/empty-git-template"
/usr/bin/mkdir --mode=0700 -- "${empty_template}"
assembled_checkout="${build_root}/proofofwork-api"
# The fixed local transport starts upload-pack separately. It inherits the same
# exact safe-directory entries and helper-neutralizing runtime configuration.
isolated_git_environment "${checkout}" /usr/bin/git -C "${build_root}" \
  clone --quiet --no-local --no-checkout --template="${empty_template}" \
  --upload-pack=/usr/bin/git-upload-pack \
  -- "${checkout}" "${assembled_checkout}"
isolated_checkout_git "${assembled_checkout}" remote remove origin
printf '%s\n' "${commit}" >"${assembled_checkout}/.git/HEAD"
isolated_checkout_git "${assembled_checkout}" read-tree "${commit}"
if ((EUID == 0)); then
  # The live checkout may intentionally be owned by the unprivileged runtime
  # account. Make the clean Git metadata share that owner/group before the
  # already-attested runtime is copied with ownership preservation.
  /usr/bin/chown \
    --recursive \
    --no-dereference \
    --preserve-root \
    --reference="${checkout}" \
    -- "${assembled_checkout}"
fi
/usr/bin/chmod --reference="${checkout}" -- "${assembled_checkout}"

while IFS= read -r -d '' live_entry; do
  /usr/bin/cp --archive --reflink=auto -- "${live_entry}" "${assembled_checkout}/"
done < <(
  /usr/bin/find "${checkout}" -mindepth 1 -maxdepth 1 ! -name .git -print0
)

if ! assembled_attestation="$(attest_checkout "${assembled_checkout}")"; then
  echo "Freshly constructed node release failed checkout attestation." >&2
  exit 1
fi
if [[ "${assembled_attestation}" != "${live_attestation}" ]]; then
  echo "Freshly constructed node release differs from the attested live runtime." >&2
  exit 1
fi

/usr/bin/tar \
  --create \
  --gzip \
  --file="${archive_tmp}" \
  --directory="${build_root}" \
  --numeric-owner \
  --sort=name \
  --hard-dereference \
  proofofwork-api
/usr/bin/chmod 0600 "${archive_tmp}"
archive_bytes="$(/usr/bin/stat --format=%s -- "${archive_tmp}")"
if [[ ! "${archive_bytes}" =~ ^[1-9][0-9]*$ ]] || ((archive_bytes > max_source_bytes)); then
  echo "Constructed node release exceeds the compressed-size safety limit." >&2
  exit 1
fi

if ! second_live_attestation="$(attest_checkout "${checkout}")" ||
  [[ "${second_live_attestation}" != "${live_attestation}" ]]; then
  echo "Live node checkout changed while release evidence was constructed." >&2
  exit 1
fi

digest_line="$(/usr/bin/sha256sum -- "${archive_tmp}")"
digest="${digest_line%% *}"
commit_time="$(isolated_checkout_git "${checkout}" show --no-patch --format=%cI "${commit}")"
recorded_at="$(/usr/bin/date --utc +%Y-%m-%dT%H:%M:%SZ)"
if [[ ! "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Constructed node release digest is invalid." >&2
  exit 1
fi

printf '%s  %s\n' "${digest}" "${name}" >"${checksum_tmp}"
printf '%s\n' \
  'format=proof-of-work-node-release-provenance-v2' \
  "archive=${name}" \
  "archive_sha256=${digest}" \
  "archive_bytes=${archive_bytes}" \
  "commit=${commit}" \
  "tree=${tree}" \
  "runtime_entry_count=${runtime_entry_count}" \
  "runtime_bytes=${runtime_bytes}" \
  "runtime_sha256=${runtime_sha256}" \
  "commit_time=${commit_time}" \
  "recorded_at=${recorded_at}" >"${provenance_tmp}"

/usr/bin/sync -f "${archive_tmp}"
/usr/bin/sync -f "${checksum_tmp}"
/usr/bin/sync -f "${provenance_tmp}"
/usr/bin/mv -- "${checksum_tmp}" "${final_checksum}"
checksum_tmp=""
/usr/bin/mv -- "${provenance_tmp}" "${final_provenance}"
provenance_tmp=""
# Publish the archive last so retention never observes it without both sidecars.
/usr/bin/mv -- "${archive_tmp}" "${final_archive}"
archive_tmp=""
/usr/bin/sync -f "${retention_root}"

cleanup
build_root=""
trap - EXIT
printf 'published archive=%s commit=%s tree=%s runtime_sha256=%s sha256=%s bytes=%s\n' \
  "${name}" "${commit}" "${tree}" "${runtime_sha256}" "${digest}" "${archive_bytes}"
