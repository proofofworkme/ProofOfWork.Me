#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

curl_bin="${POW_OPS_CURL_BIN:-/usr/bin/curl}"
python_bin="${POW_OPS_PYTHON_BIN:-/usr/bin/python3}"
systemctl_bin="${POW_OPS_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
state_root="${POW_NODE_HEALTH_STATE_ROOT:-/var/lib/proofofwork-ops-health}"
allow_test_roots="${POW_OPS_ALLOW_TEST_ROOTS:-0}"

if [[ "${allow_test_roots}" != "1" ]] && {
  [[ "${curl_bin}" != "/usr/bin/curl" ]] ||
    [[ "${python_bin}" != "/usr/bin/python3" ]] ||
    [[ "${systemctl_bin}" != "/usr/bin/systemctl" ]] ||
    [[ "${state_root}" != "/var/lib/proofofwork-ops-health" ]];
}; then
  echo "Node API health path overrides are test-only." >&2
  exit 2
fi
if [[ ! -d "${state_root}" || -L "${state_root}" ]]; then
  echo "Node API health state root must be a real directory: ${state_root}" >&2
  exit 2
fi

severity=0
for unit in proofofwork-api.service proofofwork-api-wg.socket proofofwork-indexer-worker.service; do
  if ! "${systemctl_bin}" is-active --quiet "${unit}"; then
    echo "CRITICAL unit=${unit} active=false" >&2
    severity=2
  fi
done

temporary_root="$(/usr/bin/mktemp --directory)"
trap '/usr/bin/rm -rf -- "${temporary_root}"' EXIT
fetch() {
  local name="$1"
  local path="$2"
  local output="$3"
  local code
  if ! code="$("${curl_bin}" --silent --show-error --noproxy '*' \
    --connect-timeout 2 --max-time 15 --output "${output}" \
    --write-out '%{http_code}' "http://127.0.0.1:8081${path}")"; then
    echo "CRITICAL endpoint=${name} transport=failed" >&2
    severity=2
    return 1
  fi
  printf '%s' "${code}"
}

live_path="${temporary_root}/live.json"
live_code="$(fetch live /health/live "${live_path}")" || true
if [[ "${live_code:-}" != "200" ]] || ! "${python_bin}" - "${live_path}" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        payload = json.load(handle)
except Exception:
    raise SystemExit(1)
if (
    payload.get("service") != "proofofwork-op-return-api"
    or payload.get("available") is not True
    or payload.get("mode") not in {"liveness", "availability"}
):
    raise SystemExit(1)
PY
then
  echo "CRITICAL endpoint=live http_status=${live_code:-none} liveness=invalid" >&2
  severity=2
fi

ready_path="${temporary_root}/ready.json"
ready_code="$(fetch ready /health "${ready_path}")" || true
if [[ "${ready_code:-}" != "200" ]] || ! "${python_bin}" - "${ready_path}" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        payload = json.load(handle)
except Exception:
    raise SystemExit(1)
if (
    payload.get("service") != "proofofwork-op-return-api"
    or payload.get("ready") is not True
    or payload.get("mode") != "readiness"
):
    raise SystemExit(1)
PY
then
  echo "CRITICAL endpoint=ready http_status=${ready_code:-none} readiness=not-ready" >&2
  severity=2
fi

restart_count="$("${systemctl_bin}" show --property=NRestarts --value proofofwork-indexer-worker.service 2>/dev/null || true)"
restart_state="${state_root}/indexer-worker-restarts"
if [[ ! "${restart_count}" =~ ^[0-9]+$ ]]; then
  echo "CRITICAL worker_restart_count=unavailable" >&2
  severity=2
else
  previous_count=""
  if [[ -f "${restart_state}" && ! -L "${restart_state}" ]]; then
    previous_count="$(<"${restart_state}")"
  fi
  if [[ "${previous_count}" =~ ^[0-9]+$ ]] && ((restart_count > previous_count)); then
    echo "CRITICAL worker_restarts_increased previous=${previous_count} current=${restart_count}" >&2
    severity=2
  fi
  printf '%s\n' "${restart_count}" >"${restart_state}.tmp"
  /usr/bin/mv -- "${restart_state}.tmp" "${restart_state}"
fi

echo "node_api_health live_http=${live_code:-none} ready_http=${ready_code:-none} worker_restarts=${restart_count:-unknown}"
exit "${severity}"
