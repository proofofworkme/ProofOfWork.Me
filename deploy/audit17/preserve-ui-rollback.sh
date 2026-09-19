#!/usr/bin/env bash
# Preserve one verified historical UI root outside the active rollback queue.
# No deletion; the exact complete root, release archive and provenance survive.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
unset TAR_OPTIONS GZIP BASH_ENV ENV CDPATH
[[ $EUID == 0 && $# == 0 ]]
name=proofofwork-www-pre-2ddefac163d5-20260905T204437Z
root=/var/backups/proofofwork-ui/rollback-roots/$name
hold=/var/backups/proofofwork-ui/recovery-evidence/audit17-20260919
archive_name=proofofwork-ui-release-6a7d5c12e403-20260905T050937Z.tgz
archive=/var/backups/proofofwork-ui/releases/$archive_name
manifest_sha=2e75546ca7b21ff7b8a1d96d1a891c9bdc9e97dfa74b451f58dd4519c790a1ec
tree_sha=a4458c5747136f0f692e648c7199378ad748ef3c23017f7ed2d53e4122939d34
[[ ! -e $hold && ! -L $hold ]]
[[ $(realpath -e "$root") == "$root" && ! -L $root ]]
(( $(df -B1 --output=avail / | tail -1) > 11811160064 ))
exec {lock_fd}</run/proofofwork-ui/deploy.lock
flock --exclusive --wait 15 "$lock_fd"
export POW_UI_DEPLOY_LOCK_FD=$lock_fd
# Any service reference or open process path requires investigation instead.
if grep -R -F -l -- "$name" /etc/caddy /etc/systemd/system /etc/cron.d; then
  echo 'Historical root is referenced by service configuration.' >&2; exit 1
else
  [[ $? == 1 ]]
fi
python3 -I - "$root" <<'PY'
import os,pathlib,sys
root=sys.argv[1]
for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
    target=line.split()[4]
    if target == root or target.startswith(root+'/'):
        raise SystemExit('Historical root contains a mount')
for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit(): continue
    for category in ('cwd','root','exe','fd'):
        path=proc/category
        try: paths=list(path.iterdir()) if category=='fd' else [path]
        except FileNotFoundError: continue
        for entry in paths:
            try: target=os.readlink(entry)
            except FileNotFoundError: continue
            if target==root or target.startswith(root+'/'):
                raise SystemExit('Historical root has an active process reference')
PY
/usr/local/sbin/proofofwork-ui-retained-root "$root" --manifest-sha256 "$manifest_sha" --tree-sha256 "$tree_sha"
POW_UI_RETAINED_ROOT=1 POW_UI_WWW_ROOT="$root" /usr/local/sbin/proofofwork-ui-release-provenance verify-rollback
install -d -m 0700 /var/backups/proofofwork-ui/recovery-evidence
[[ ! -L /var/backups/proofofwork-ui/recovery-evidence ]]
mkdir -m 0700 "$hold"
/usr/local/sbin/proofofwork-ui-retained-root "$root" > "$hold/before.json"
for suffix in '' .sha256 .provenance; do
  [[ -f $archive$suffix && ! -L $archive$suffix ]]
  cp --preserve=all -- "$archive$suffix" "$hold/$archive_name$suffix"
  cmp -- "$archive$suffix" "$hold/$archive_name$suffix"
done
(cd "$hold" && sha256sum --check "$archive_name.sha256")
tar --create --gzip --one-file-system --numeric-owner --file "$hold/complete-root.tgz" --directory "$(dirname "$root")" "$name"
tar --compare --gzip --numeric-owner --file "$hold/complete-root.tgz" --directory "$(dirname "$root")"
(cd "$hold" && sha256sum complete-root.tgz > complete-root.tgz.sha256)
/usr/local/sbin/proofofwork-ui-retained-root "$root" --manifest-sha256 "$manifest_sha" --tree-sha256 "$tree_sha" > "$hold/pre-move.json"
[[ $(stat -c %d "$root") == $(stat -c %d "$hold") ]]
mv -T -- "$root" "$hold/$name"
python3 -I - "$hold/$name" "$manifest_sha" "$tree_sha" > "$hold/after.json" <<'PY'
import importlib.machinery,importlib.util,json,sys
loader=importlib.machinery.SourceFileLoader('retained','/usr/local/sbin/proofofwork-ui-retained-root')
spec=importlib.util.spec_from_loader(loader.name,loader);module=importlib.util.module_from_spec(spec);loader.exec_module(module)
result=module.fingerprint(sys.argv[1])
assert result['manifestSha256']==sys.argv[2] and result['treeSha256']==sys.argv[3]
print(json.dumps(result,sort_keys=True))
PY
cat > "$hold/RECOVERY.txt" <<'RECOVERY'
Audit 17: historical root preserved, not deleted. Not a live service path.
The original root is retained here with unchanged complete-tree fingerprint.
The complete-root tar was compared against it before the same-filesystem move.
Release archive, checksum and provenance have independent copies here so future
ordinary release retention cannot remove the only recovery evidence.
To reclassify for rollback, hold /run/proofofwork-ui/deploy.lock, verify checksums
and before/after fingerprints, ensure the original rollback path is absent, and
rename the retained root back there. Restore archive sidecars from this directory
if absent from releases, then run retained-root verify-rollback before use.
Do not delete this directory through automated retention.
RECOVERY
printf 'audit17_rollback_preservation status=verified root=%s manifest_sha256=%s tree_sha256=%s\n' "$hold/$name" "$manifest_sha" "$tree_sha"
df -B1 /
