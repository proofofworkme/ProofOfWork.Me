#!/usr/bin/env bash
set -euo pipefail

version="24.18.0"
archive="node-v${version}-linux-x64.tar.xz"
expected_sha256="55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
install_root="/opt"
install_dir="${install_root}/node-v${version}-linux-x64"
download_url="https://nodejs.org/dist/v${version}/${archive}"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if [[ -x "${install_dir}/bin/node" ]]; then
  installed_version="$("${install_dir}/bin/node" --version)"
  if [[ "${installed_version}" != "v${version}" ]]; then
    echo "Unexpected Node.js version at ${install_dir}: ${installed_version}" >&2
    exit 1
  fi
  echo "Node.js ${installed_version} is already installed at ${install_dir}."
  exit 0
fi
if [[ -e "${install_dir}" ]]; then
  echo "Refusing to overwrite incomplete Node.js install at ${install_dir}." >&2
  exit 1
fi

work_dir="$(mktemp -d "${install_root}/.node-install.XXXXXX")"
trap 'rm -rf "${work_dir}"' EXIT

curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  --output "${work_dir}/${archive}" \
  "${download_url}"

(
  cd "${work_dir}"
  printf '%s  %s\n' "${expected_sha256}" "${archive}" | sha256sum --check --strict
)

tar --extract --xz --file "${work_dir}/${archive}" --directory "${work_dir}"
candidate_dir="${work_dir}/node-v${version}-linux-x64"
candidate_version="$("${candidate_dir}/bin/node" --version)"
if [[ "${candidate_version}" != "v${version}" ]]; then
  echo "Downloaded Node.js version mismatch: ${candidate_version}" >&2
  exit 1
fi
chown --recursive root:root "${candidate_dir}"
chmod 0755 "${candidate_dir}" "${candidate_dir}/bin" "${candidate_dir}/bin/node"
mv "${candidate_dir}" "${install_dir}"

installed_version="$("${install_dir}/bin/node" --version)"
if [[ "${installed_version}" != "v${version}" ]]; then
  echo "Installed Node.js version mismatch: ${installed_version}" >&2
  exit 1
fi

echo "Installed Node.js ${installed_version} at ${install_dir}."
