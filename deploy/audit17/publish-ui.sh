#!/usr/bin/env bash
# Publish the reviewed exact Audit 17 build; retain all eight queued roots.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
unset TAR_OPTIONS GZIP BASH_ENV ENV CDPATH
[[ $EUID == 0 && $# == 0 ]]
release=07929dd3c6e4-20260919T145727Z
commit=07929dd3c6e422fa1955c6cbf07007330eca0519
tree=5ca993c7816b20c3b914e4421bdbdabf49673c5f
source=/var/tmp/proofofwork-deploy/proofofwork-ui-source-$release
archive=/var/backups/proofofwork-ui/releases/proofofwork-ui-release-$release.tgz
receipt=/var/tmp/proofofwork-deploy/audit17-publish-$release
[[ ! -e $receipt && ! -L $receipt ]]
mkdir -m 0700 "$receipt"
exec {lock_fd}</run/proofofwork-ui/deploy.lock
flock --exclusive --wait 15 "$lock_fd"
export POW_UI_DEPLOY_LOCK_FD=$lock_fd GIT_OPTIONAL_LOCKS=0
[[ $(git -C "$source" rev-parse HEAD) == "$commit" ]]
[[ $(git -C "$source" rev-parse 'HEAD^{tree}') == "$tree" ]]
! git -C "$source" symbolic-ref -q HEAD
[[ $(grep '^commit=' /var/www/.proofofwork-ui-release) == commit=84a9871040db0e500a8b7f8cc16fec78c5e669c9 ]]
(( $(df -B1 --output=avail / | tail -1) >= 10737418240 + 536870912 ))
/usr/local/sbin/proofofwork-ui-release-provenance verify-rollback
expected=(10795467c328-20260914T012801Z 4515c3bc3421-20260913T070757Z 45d4617df4ea-20260913T222338Z 4ce5f70c6538-20260913T224020Z 57bb25106fef-20260913T073622Z 62fded8008f9-20260914T025303Z 84a9871040db-20260918T190233Z f23c24fd97a9-20260914T001952Z)
[[ $(find /var/backups/proofofwork-ui/rollback-roots -mindepth 1 -maxdepth 1 -name 'proofofwork-www-pre-*' | wc -l) == 8 ]]
args=()
for prior in "${expected[@]}"; do
  root=/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-$prior
  /usr/local/sbin/proofofwork-ui-retained-root "$root" > "$receipt/$prior.json"
  classification=$(python3 -I - "$receipt/$prior.json" <<'PY'
import json,pathlib,sys
x=json.load(open(sys.argv[1]));print(pathlib.Path(x['root']).name+':'+x['manifestSha256']+':'+x['treeSha256'])
PY
)
  args+=(--retain-rollback-root "$classification")
done
/usr/local/sbin/proofofwork-ui-release-publish --release-id "$release" --commit "$commit" --source-checkout "$source" --archive "$archive" "${args[@]}"
/usr/local/sbin/proofofwork-ui-release-provenance verify
cmp -- /var/www/.proofofwork-ui-release "$archive.provenance"
[[ $(grep '^commit=' /var/www/.proofofwork-ui-release) == commit=$commit ]]
[[ $(grep '^source_tree=' /var/www/.proofofwork-ui-release) == source_tree=$tree ]]
(( $(df -B1 --output=avail / | tail -1) >= 10737418240 ))
printf 'audit17_ui_publish status=verified commit=%s release=%s\n' "$commit" "$release"
df -B1 /
