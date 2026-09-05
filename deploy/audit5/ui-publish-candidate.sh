#!/usr/bin/env bash
# Audit-5 publication with exact retained-root classification and bounded scratch.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
unset TAR_OPTIONS GZIP BASH_ENV ENV CDPATH
release_id=${1:?}; commit=${2:?}; tree=${3:?}
[[ $# == 3 && "$release_id" =~ ^[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ && "$commit" =~ ^[0-9a-f]{40}$ && "$tree" =~ ^[0-9a-f]{40}$ && $EUID == 0 ]]
[[ ${release_id:0:12} == ${commit:0:12} ]]
deploy=/var/tmp/proofofwork-deploy
source="$deploy/proofofwork-ui-source-$release_id"
archive="/var/backups/proofofwork-ui/releases/proofofwork-ui-release-$release_id.tgz"
retained=/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-6a7d5c12e403-20260905T050937Z
manifest_sha=46ac2f7d48e3e1b5ebcdb90b7220cdf9ed680d1107fd491ab134c29298805ec8
root_sha=cac7c37bbfaf50f802d8b688de2bb61a317a8ef1013bfa2540a2c3c9eb6aa9c0
classification="${retained##*/}:$manifest_sha:$root_sha"
export GIT_OPTIONAL_LOCKS=0
[[ $(git -C "$source" rev-parse HEAD) == "$commit" && $(git -C "$source" rev-parse 'HEAD^{tree}') == "$tree" ]]
! git -C "$source" symbolic-ref -q HEAD
[[ -z $(git -C "$source" status --porcelain --untracked-files=all) ]]
for pair in 'stage:proofofwork-ui-release-stage.py' 'publish:proofofwork-ui-release-publish.sh' 'provenance:proofofwork-ui-release-provenance.sh'; do
  cmp -- "$source/deploy/${pair#*:}" "/usr/local/sbin/proofofwork-ui-release-${pair%%:*}"
done
cmp -- "$source/deploy/proofofwork-ui-retained-root.py" /usr/local/sbin/proofofwork-ui-retained-root
exec {deploy_fd}</run/proofofwork-ui/deploy.lock
flock --exclusive --nonblock "$deploy_fd"
export POW_UI_DEPLOY_LOCK_FD=$deploy_fd
[[ $(grep '^release_id=' /var/www/.proofofwork-ui-release) == 'release_id=6a7d5c12e403-20260905T050937Z' ]]
[[ $(grep '^commit=' /var/www/.proofofwork-ui-release) == 'commit=6a7d5c12e403e0ddb6247fa2a6865cb70d623a8e' ]]
free=$(df -B1 --output=avail / | tail -1 | tr -d ' ')
((free >= 10737418240 + 67108864))
mem_kib=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
mem=$((mem_kib * 1024))
tmpfree=$(df -B1 --output=avail /dev/shm | tail -1 | tr -d ' ')
((mem >= 1073741824 && tmpfree >= 536870912))
TMPDIR=$(mktemp -d /dev/shm/pow-audit5-provenance.XXXXXXXX)
export TMPDIR
# Outside every live/stage/source/rollback tree. No application mount changes.
mount -t tmpfs -o size=512m,mode=0700,nosuid,nodev,noexec tmpfs "$TMPDIR"
cleanup() {
  # Failed nonempty scratch stays mounted/private for operator inspection.
  if [[ -z $(find "$TMPDIR" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
    umount "$TMPDIR" && rmdir "$TMPDIR"
  fi
}
trap cleanup EXIT
/usr/local/sbin/proofofwork-ui-release-provenance verify-rollback
/usr/local/sbin/proofofwork-ui-retained-root "$retained" --manifest-sha256 "$manifest_sha" --tree-sha256 "$root_sha"
/usr/local/sbin/proofofwork-ui-release-publish --release-id "$release_id" --commit "$commit" \
  --source-checkout "$source" --archive "$archive" --retain-rollback-root "$classification"
/usr/local/sbin/proofofwork-ui-release-provenance verify
cmp -- /var/www/.proofofwork-ui-release "$archive.provenance"
[[ $(grep '^commit=' /var/www/.proofofwork-ui-release) == "commit=$commit" ]]
[[ $(grep '^source_tree=' /var/www/.proofofwork-ui-release) == "source_tree=$tree" ]]
[[ -d "/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-$release_id" && -d "$retained" ]]
free=$(df -B1 --output=avail / | tail -1 | tr -d ' ')
((free >= 10737418240 + 67108864))
printf 'audit5_ui_publish status=verified release=%s commit=%s free=%s prior_roots=preserved\n' "$release_id" "$commit" "$free"
