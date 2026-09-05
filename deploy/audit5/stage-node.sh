#!/usr/bin/env bash
# Construct/attest an isolated candidate; never stop services or exchange live.
set -Eeuo pipefail
umask 027
export PATH=/opt/node-v24.18.0-linux-x64/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
unset BASH_ENV ENV CDPATH NODE_OPTIONS LD_PRELOAD LD_LIBRARY_PATH
release=${1:?}; commit=${2:?}; digest=${3:?}
[[ $# == 3 && $EUID == 0 && "$release" =~ ^[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ && "$commit" =~ ^[0-9a-f]{40}$ && "$digest" =~ ^[0-9a-f]{64}$ ]]
[[ ${release:0:12} == ${commit:0:12} ]]
bundle="/var/tmp/proofofwork-deploy/proofofwork-audit5-source-$release.bundle"
stage="/opt/proofofwork-api-stage-$release"
work="/var/tmp/proofofwork-deploy/audit5-node-work-$release"
helper_dir=$(dirname "$(realpath -e "$0")")
attestor="$helper_dir/attest-node.py"
[[ $(realpath -e "$helper_dir") == "$helper_dir" && ! -L "$helper_dir" && $(stat -c '%u:%g:%a' "$helper_dir") == 0:0:700 ]]
[[ -f "$attestor" && ! -L "$attestor" && $(stat -c '%u:%g:%a' "$attestor") == 0:0:600 ]]
[[ $(realpath -e /opt) == /opt && $(realpath -e /var/tmp/proofofwork-deploy) == /var/tmp/proofofwork-deploy ]]
for parent in /opt /var/tmp/proofofwork-deploy; do
  [[ $(stat -c '%u:%g' "$parent") == 0:0 ]]
  (( (8#$(stat -c %a "$parent") & 07022) == 0 ))
done
[[ -f "$bundle" && ! -L "$bundle" && $(stat -c %u "$bundle") == 0 ]]
(( (8#$(stat -c %a "$bundle") & 07022) == 0 ))
[[ ! -e "$stage" && ! -L "$stage" && ! -e "$work" && ! -L "$work" ]]
actual=$(sha256sum "$bundle"); [[ ${actual%% *} == "$digest" ]]
[[ $(/opt/node-v24.18.0-linux-x64/bin/node --version) == v24.18.0 ]]
free=$(df -B1 --output=avail /opt | tail -1 | tr -d ' ')
((free >= 10737418240+1073741824))
git -c safe.directory=/opt/proofofwork-api -C /opt/proofofwork-api bundle verify "$bundle"
git bundle list-heads "$bundle" | awk -v commit="$commit" '$1==commit {found=1} END {exit !found}'
# Clone as root to read the root-private bundle, then assign only the new tree.
git clone --no-checkout --no-hardlinks -- "$bundle" "$stage"
chown --recursive --no-dereference powadmin:powadmin "$stage"
chmod 0755 "$stage"
mkdir -m 0711 -- "$work"
install -d -o powadmin -g powadmin -m 0700 "$work/npm-cache"
install -o powadmin -g powadmin -m 0600 /dev/null "$work/user.npmrc"
install -o powadmin -g powadmin -m 0600 /dev/null "$work/global.npmrc"
runuser -u powadmin -- /usr/bin/env -i PATH="$PATH" LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git -C "$stage" checkout --detach "$commit"
# Preserve private Git metadata without touching any existing release.
chmod --recursive go-rwx "$stage/.git"
runuser -u powadmin -- /usr/bin/env -i PATH="$PATH" LC_ALL=C \
  NPM_CONFIG_CACHE="$work/npm-cache" NPM_CONFIG_USERCONFIG="$work/user.npmrc" NPM_CONFIG_GLOBALCONFIG="$work/global.npmrc" \
  npm --prefix "$stage" ci --ignore-scripts --no-audit --no-fund
# Never run git status in production: it may refresh index modes.
# Root executes only the protected reviewed helper. The candidate and npm cache
# belong to powadmin; neither may supply root code or a root output pathname.
(umask 077; set -o noclobber; /usr/bin/python3 -I "$attestor" "$stage" > "$work/candidate-attestation.tsv")
read -r actual_commit tree entries bytes fingerprint < "$work/candidate-attestation.tsv"
[[ "$actual_commit" == "$commit" && "$tree" =~ ^[0-9a-f]{40}$ && "$fingerprint" =~ ^[0-9a-f]{64}$ ]]
[[ $(stat -c '%u:%g:%a' "$stage") == $(stat -c '%u:%g:%a' /opt/proofofwork-api) ]]
[[ $(stat -c %d "$stage") == $(stat -c %d /opt/proofofwork-api) ]]
printf 'audit5_node_stage status=attested release=%s commit=%s tree=%s entries=%s bytes=%s runtime_sha256=%s\n' "$release" "$actual_commit" "$tree" "$entries" "$bytes" "$fingerprint"
