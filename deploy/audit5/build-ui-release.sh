#!/usr/bin/env bash
# Build a detached exact commit locally. No deployment or production access.
set -Eeuo pipefail
umask 077
unset TAR_OPTIONS GZIP BASH_ENV ENV CDPATH
repository=${1:?repository required}
release_commit=${2:?full commit required}
[[ $# == 2 && "$release_commit" =~ ^[0-9a-f]{40}$ ]]
repository=$(realpath -e "$repository")
node=$(realpath -e "${POW_UI_BUILD_NODE:-$(command -v node)}")
npm=$(realpath -e "$(command -v npm)")
runtime_path="$(dirname "$node"):/usr/bin:/bin"
release_id="${release_commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
build_root=$(mktemp -d /tmp/proofofwork-ui-release.XXXXXXXXXX)
source_name="proofofwork-ui-source-$release_id"
payload_name="proofofwork-ui-surfaces-$release_id"
source_checkout="$build_root/$source_name"
surfaces_root="$build_root/$payload_name/surfaces"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_TERMINAL_PROMPT=0
git clone --quiet --no-hardlinks --no-local "$repository" "$source_checkout"
git -C "$source_checkout" checkout --quiet --detach "$release_commit"
[[ $(git -C "$source_checkout" rev-parse HEAD) == "$release_commit" ]]
release_tree=$(git -C "$source_checkout" rev-parse 'HEAD^{tree}')
install -d -m 0700 "$build_root/npm-cache"
install -d -m 0755 "$surfaces_root"
: > "$build_root/user.npmrc"
: > "$build_root/global.npmrc"
cd "$source_checkout"
env -i PATH="$runtime_path" LANG=C.UTF-8 \
  NPM_CONFIG_CACHE="$build_root/npm-cache" NPM_CONFIG_USERCONFIG="$build_root/user.npmrc" \
  NPM_CONFIG_GLOBALCONFIG="$build_root/global.npmrc" "$node" "$npm" ci --ignore-scripts --no-audit --no-fund
env -i PATH="$runtime_path" LANG=C.UTF-8 "$node" node_modules/typescript/bin/tsc
[[ -z $(GIT_OPTIONAL_LOCKS=0 git status --porcelain --untracked-files=all) ]]
build_surface() {
  local surface=$1 api_origin=$2 route_switch=${3:-}
  local -a build_env=(env -i PATH="$runtime_path" LANG=C.UTF-8 "VITE_POW_API_BASE=$api_origin")
  [[ -z "$route_switch" ]] || build_env+=("$route_switch=1")
  "${build_env[@]}" "$node" node_modules/vite/bin/vite.js build \
    --outDir "$surfaces_root/$surface" --emptyOutDir >"$build_root/$surface.build-log" 2>&1
  printf 'built_surface=%s\n' "$surface"
}
build_surface landing https://www.proofofwork.me VITE_LANDING_ONLY
build_surface id https://id.proofofwork.me VITE_ID_LAUNCH_ONLY
build_surface computer https://computer.proofofwork.me
build_surface desktop https://desktop.proofofwork.me VITE_DESKTOP_ONLY
build_surface browser https://browser.proofofwork.me VITE_BROWSER_ONLY
build_surface boost https://boost.proofofwork.me VITE_BOOST_ONLY
build_surface marketplace https://amo.proofofwork.me VITE_MARKETPLACE_ONLY
build_surface token https://credit.proofofwork.me VITE_TOKEN_ONLY
build_surface wallet https://wallet.proofofwork.me VITE_WALLET_ONLY
build_surface work https://work.proofofwork.me VITE_WORK_TOKEN_ONLY
build_surface infinity https://infinity.proofofwork.me VITE_INFINITY_ONLY
build_surface inception https://inception.proofofwork.me VITE_INCEPTION_ONLY
build_surface activity https://log.proofofwork.me VITE_LOG_ONLY
build_surface growth https://growth.proofofwork.me VITE_GROWTH_ONLY
cp --archive "$surfaces_root/computer" "$surfaces_root/nft"
find "$build_root/$payload_name" -type d -exec chmod 0755 {} +
find "$build_root/$payload_name" -type f -exec chmod 0644 {} +
chmod --recursive go-w "$source_checkout"
[[ -z $(GIT_OPTIONAL_LOCKS=0 git status --porcelain --untracked-files=all) ]]
source_bundle="$build_root/$source_name.tgz"
payload_bundle="$build_root/$payload_name.tgz"
# Ordinary files in portable archives, including any duplicate Git/dependency files.
# Internal source symlinks remain symlinks; hard-dereference never follows them.
tar --create --gzip --hard-dereference --file "$source_bundle" --directory "$build_root" "$source_name"
tar --create --gzip --hard-dereference --file "$payload_bundle" --directory "$build_root" "$payload_name"
python3 -I - "$release_id" "$release_commit" "$release_tree" "$build_root" "$source_bundle" "$payload_bundle" "$node" <<'PY'
import hashlib,json,pathlib,subprocess,sys
release,commit,tree,root,source,payload,node=sys.argv[1:]
receipt={'releaseId':release,'commit':commit,'tree':tree,'buildRoot':root,
         'node':node,'nodeVersion':subprocess.check_output([node,'--version'],text=True).strip(),'bundles':{}}
for kind,filename in [('source',source),('surfaces',payload)]:
    path=pathlib.Path(filename); digest=hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
    path.with_suffix(path.suffix+'.sha256').write_text(f'{digest}  {path.name}\n')
    receipt['bundles'][kind]={'path':str(path),'bytes':path.stat().st_size,'sha256':digest}
receipt['sourceAllocatedBytes']=int(subprocess.check_output(['du','-s','-B1',str(pathlib.Path(root,'proofofwork-ui-source-'+release))],text=True).split()[0])
target=pathlib.Path(root,'build-receipt.json');target.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'status':'built','receipt':str(target),**receipt}))
PY
