#!/usr/bin/env bash
# Construct and archive a candidate before source upload. Never publish /var/www.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
unset TAR_OPTIONS GZIP BASH_ENV ENV CDPATH
release_id=${1:?}; source_allocated=${2:?}
[[ $# == 2 && "$release_id" =~ ^[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ && "$source_allocated" =~ ^[1-9][0-9]{0,11}$ && $EUID == 0 ]]
((source_allocated <= 1073741824))
script_dir=$(dirname "$(realpath -e "$0")")
capacity="$script_dir/ui-capacity.py"
[[ -f "$capacity" && ! -L "$capacity" && $(stat -c %u "$capacity") == 0 ]]
(( (8#$(stat -c %a "$capacity") & 07022) == 0 ))
deploy=/var/tmp/proofofwork-deploy
payload="$deploy/proofofwork-ui-surfaces-$release_id"
stage="$deploy/proofofwork-www-stage-$release_id"
[[ -d "$payload/surfaces" && ! -L "$payload" && ! -e "$stage" && ! -L "$stage" ]]
[[ $(realpath -e "$payload") == "$payload" ]]
[[ ! -e "$deploy/proofofwork-ui-source-$release_id" && ! -L "$deploy/proofofwork-ui-source-$release_id" ]]
exec {deploy_fd}</run/proofofwork-ui/deploy.lock
flock --exclusive --nonblock "$deploy_fd"
export POW_UI_DEPLOY_LOCK_FD=$deploy_fd
floor=10737418240; reserve=67108864
free=$(df -B1 --output=avail / | tail -1 | tr -d ' ')
live=$(du -s -B1 /var/www | cut -f1)
incoming=$(python3 -I "$capacity" incoming "$payload/surfaces")
read -r unique metadata largest < <(python3 -I -c 'import json,sys;p=json.load(sys.stdin);print(p["uniqueIncomingBytes"],p["incomingMetadataBytes"],p["largestSurfaceCopyBytes"])' <<<"$incoming")
# Includes distinct new assets retained alongside old compatibility bytes, all
# incoming metadata, and a whole surface before its internal dedup completes.
required=$((live + unique + metadata + largest))
((free >= floor + reserve + required))
printf 'ui_capacity phase=before-stage free=%s required_additional=%s incoming=%s\n' "$free" "$required" "$incoming"
record=$(/usr/local/sbin/proofofwork-ui-release-stage --release-id "$release_id" --surfaces-root "$payload/surfaces" --stage-root "$stage" --deduplicate-managed-files)
printf '%s\n' "$record"
[[ "$record" == "ui_release_stage status=staged release_id=$release_id "* ]]
# Stager proved every new payload byte/metadata and rejected links/nested mounts.
# Dispose only this release's freshly received scratch payload after that proof.
[[ $(realpath -e "$payload") == "$payload" && $(stat -c %u "$payload") == 0 ]]
[[ ! -n $(find "$payload" -xdev -type l -print -quit) ]]
rm -rf --one-file-system -- "$payload"
[[ ! -e "$payload" ]]
managed=$(python3 -I "$capacity" managed "$stage")
archive_upper=$(python3 -I -c 'import json,sys;print(json.load(sys.stdin)["archiveUpperBoundBytes"])' <<<"$managed")
free=$(df -B1 --output=avail / | tail -1 | tr -d ' ')
((free >= floor + reserve + archive_upper))
archive_root=/var/backups/proofofwork-ui/releases
[[ -d "$archive_root" && ! -L "$archive_root" && $(realpath -e "$archive_root") == "$archive_root" && $(stat -c %u "$archive_root") == 0 ]]
(( (8#$(stat -c %a "$archive_root") & 07022) == 0 ))
archive_name="proofofwork-ui-release-$release_id.tgz"
archive="$archive_root/$archive_name"
for destination in "$archive" "$archive.sha256" "$archive.provenance"; do [[ ! -e "$destination" && ! -L "$destination" ]]; done
archive_tmp=$(mktemp "$archive_root/.$archive_name.audit5.XXXXXXXX")
archive_base=$(mktemp -d /dev/shm/pow-audit5-archive-base.XXXXXXXX)
install -d -m 0755 "$archive_base/surfaces"
roots=()
for name in activity boost browser computer desktop growth id inception infinity landing marketplace nft token wallet work; do roots+=("proofofwork-$name"); done
tar --sort=name --create --gzip --hard-dereference --file "$archive_tmp" \
  --transform='s|^proofofwork-|surfaces/|' --directory "$archive_base" surfaces --directory "$stage" "${roots[@]}"
rmdir "$archive_base/surfaces" "$archive_base"
archive_bytes=$(stat -c %s "$archive_tmp")
((archive_bytes <= archive_upper))
chmod 0644 "$archive_tmp"
digest=$(sha256sum "$archive_tmp"); digest=${digest%% *}
checksum_tmp=$(mktemp "$archive_root/.$archive_name.checksum.audit5.XXXXXXXX")
printf '%s  %s\n' "$digest" "$archive_name" > "$checksum_tmp"
chmod 0644 "$checksum_tmp"
sync -f "$archive_tmp"
sync -f "$checksum_tmp"
ln "$checksum_tmp" "$archive.sha256"
ln "$archive_tmp" "$archive"
rm -- "$checksum_tmp" "$archive_tmp"
sync -f "$archive_root"
free=$(df -B1 --output=avail / | tail -1 | tr -d ' ')
# Actual compressed archive allocation is now reflected in free; only now may
# the separately pinned source stream be uploaded. The receiver gates each file.
((free >= floor + reserve + source_allocated))
printf 'ui_archive status=created path=%s sha256=%s bytes=%s free=%s\n' "$archive" "$digest" "$archive_bytes" "$free"
printf 'ui_capacity phase=after-stage free=%s candidate_allocated=%s source_budget=%s archive_upper_bound=%s\n' "$free" "$(du -s -B1 "$stage" | cut -f1)" "$source_allocated" "$archive_upper"
