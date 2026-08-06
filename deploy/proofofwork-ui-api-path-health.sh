#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

curl_bin="${POW_OPS_CURL_BIN:-/usr/bin/curl}"
python_bin="${POW_OPS_PYTHON_BIN:-/usr/bin/python3}"
access_log="${POW_UI_ACCESS_LOG:-/var/log/caddy/access.json}"
window_seconds="${POW_UI_API_ERROR_WINDOW_SECONDS:-300}"
transport_warning_count="${POW_UI_API_502_WARNING_COUNT:-1}"
transport_critical_count="${POW_UI_API_502_CRITICAL_COUNT:-5}"
readiness_warning_count="${POW_UI_API_503_WARNING_COUNT:-1}"
readiness_critical_count="${POW_UI_API_503_CRITICAL_COUNT:-5}"
application_warning_count="${POW_UI_API_OTHER_5XX_WARNING_COUNT:-1}"
application_critical_count="${POW_UI_API_OTHER_5XX_CRITICAL_COUNT:-5}"
aborted_warning_count="${POW_UI_API_STATUS_0_WARNING_COUNT:-5}"
aborted_critical_count="${POW_UI_API_STATUS_0_CRITICAL_COUNT:-20}"
slow_seconds="${POW_UI_API_SLOW_SECONDS:-10}"
slow_warning_count="${POW_UI_API_SLOW_WARNING_COUNT:-10}"
slow_critical_count="${POW_UI_API_SLOW_CRITICAL_COUNT:-50}"
allow_test_roots="${POW_OPS_ALLOW_TEST_ROOTS:-0}"

if [[ "${allow_test_roots}" != "1" ]] && {
  [[ "${curl_bin}" != "/usr/bin/curl" ]] ||
    [[ "${python_bin}" != "/usr/bin/python3" ]] ||
    [[ "${access_log}" != "/var/log/caddy/access.json" ]];
}; then
  echo "UI API health path overrides are test-only." >&2
  exit 2
fi
for value in "${window_seconds}" "${transport_warning_count}" "${transport_critical_count}" \
  "${readiness_warning_count}" "${readiness_critical_count}" \
  "${application_warning_count}" "${application_critical_count}" \
  "${aborted_warning_count}" "${aborted_critical_count}" "${slow_seconds}" \
  "${slow_warning_count}" "${slow_critical_count}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]] || ((value < 1)); then
    echo "UI API health thresholds must be positive integers." >&2
    exit 2
  fi
done
if ((window_seconds < 60 ||
  transport_critical_count < transport_warning_count ||
  readiness_critical_count < readiness_warning_count ||
  application_critical_count < application_warning_count ||
  aborted_critical_count < aborted_warning_count ||
  slow_seconds < 1 || slow_critical_count < slow_warning_count)); then
  echo "UI API health thresholds are inconsistent." >&2
  exit 2
fi

temporary_root="$(/usr/bin/mktemp --directory)"
trap '/usr/bin/rm -rf -- "${temporary_root}"' EXIT
severity=0

fetch() {
  local name="$1"
  local url="$2"
  local output="$3"
  shift 3
  local code
  if ! code="$("${curl_bin}" --silent --show-error --noproxy '*' \
    --connect-timeout 3 --max-time 10 --output "${output}" \
    --write-out '%{http_code}' "$@" "${url}")"; then
    echo "CRITICAL endpoint=${name} transport=failed" >&2
    severity=2
    return 1
  fi
  printf '%s' "${code}"
}

private_live="${temporary_root}/private-live.json"
private_code="$(fetch private-live http://10.77.0.2:8081/health/live "${private_live}")" || true
if [[ "${private_code:-}" != "200" ]] || ! "${python_bin}" - "${private_live}" <<'PY'
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
    or payload.get("mode") != "availability"
):
    raise SystemExit(1)
PY
then
  echo "CRITICAL endpoint=private-live http_status=${private_code:-none} availability=invalid" >&2
  severity=2
fi

public_live="${temporary_root}/public-live.json"
public_live_code="$(fetch public-live https://computer.proofofwork.me/health/live "${public_live}" \
  --resolve computer.proofofwork.me:443:127.0.0.1)" || true
if [[ "${public_live_code:-}" != "200" ]] || ! "${python_bin}" - "${public_live}" <<'PY'
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
    or payload.get("mode") != "availability"
):
    raise SystemExit(1)
PY
then
  echo "CRITICAL endpoint=public-live http_status=${public_live_code:-none} availability=invalid" >&2
  severity=2
fi

public_ready="${temporary_root}/public-ready.json"
public_ready_code="$(fetch public-ready https://computer.proofofwork.me/health "${public_ready}" \
  --resolve computer.proofofwork.me:443:127.0.0.1)" || true
if [[ "${public_ready_code:-}" != "200" ]] || ! "${python_bin}" - "${public_ready}" <<'PY'
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
  echo "CRITICAL endpoint=public-ready http_status=${public_ready_code:-none} readiness=not-ready" >&2
  severity=2
fi

if [[ ! -f "${access_log}" || -L "${access_log}" || ! -r "${access_log}" ]]; then
  echo "CRITICAL caddy_access_log=unreadable path=${access_log}" >&2
  severity=2
else
  read -r transport_errors caddy_upstream_errors readiness_errors application_errors aborted_requests slow_requests malformed_records unscoped_malformed unsafe_log_files truncated_log_files scanned_log_files < <("${python_bin}" - "${access_log}" "${window_seconds}" "${slow_seconds}" <<'PY'
import gzip
import json
import os
import re
import stat
import sys
import time
from collections import defaultdict

path = sys.argv[1]
window = int(sys.argv[2])
slow_seconds = int(sys.argv[3])
cutoff = time.time() - window
transport_count = 0
caddy_upstream_unavailable_count = 0
application_count = 0
aborted_count = 0
slow_count = 0
malformed_count = 0
unscoped_malformed_count = 0
unsafe_count = 0
truncated_count = 0
max_decoded_bytes = 32 * 1024 * 1024
max_record_bytes = 1024 * 1024
caddy_error_pair_window_seconds = 1.0
caddy_upstream_unavailable_events = defaultdict(list)
readiness_503_events = defaultdict(list)

def request_identity(record, status, uri):
    request = record.get("request", {})
    if not isinstance(request, dict):
        request = {}
    return (
        str(request.get("host", "")),
        str(request.get("method", "")),
        str(request.get("proto", "")),
        uri,
        status,
    )

def paired_caddy_error_count():
    paired = 0
    for identity, error_timestamps in caddy_upstream_unavailable_events.items():
        access_timestamps = sorted(readiness_503_events.get(identity, ()))
        access_index = 0
        for error_timestamp in sorted(error_timestamps):
            while (
                access_index < len(access_timestamps)
                and access_timestamps[access_index] < error_timestamp
            ):
                access_index += 1
            if (
                access_index < len(access_timestamps)
                and access_timestamps[access_index] - error_timestamp
                <= caddy_error_pair_window_seconds
            ):
                paired += 1
                access_index += 1
    return paired

directory = os.path.dirname(path)
filename = os.path.basename(path)
stem, extension = os.path.splitext(filename)
candidates = [path]
for entry in os.scandir(directory):
    if entry.name == filename or not entry.name.startswith(f"{stem}-"):
        continue
    if not (entry.name.endswith(extension) or entry.name.endswith(f"{extension}.gz")):
        continue
    try:
        metadata = entry.stat(follow_symlinks=False)
    except FileNotFoundError:
        continue
    if entry.is_symlink() or not stat.S_ISREG(metadata.st_mode):
        unsafe_count += 1
        continue
    # A rotated file cannot contain a record newer than its final mtime.
    if metadata.st_mtime >= cutoff:
        candidates.append(entry.path)

recent_ts = re.compile(rb'"ts"\s*:\s*(-?[0-9]+(?:\.[0-9]+)?)')
for candidate in sorted(set(candidates)):
    try:
        metadata = os.stat(candidate, follow_symlinks=False)
        if not stat.S_ISREG(metadata.st_mode):
            unsafe_count += 1
            continue
        compressed = candidate.endswith(".gz")
        handle = gzip.open(candidate, "rb") if compressed else open(candidate, "rb")
    except (FileNotFoundError, OSError):
        unsafe_count += 1
        continue
    with handle:
        # Tracked rotation caps each uncompressed file at 25 MiB. Bound both
        # the decoded file window and each individual record allocation.
        if not compressed and metadata.st_size > max_decoded_bytes:
            handle.seek(metadata.st_size - max_decoded_bytes)
            discarded = handle.readline(max_record_bytes + 1)
            truncated_count += 1
            if not discarded.endswith(b"\n"):
                continue
        decoded_bytes = 0
        while True:
            remaining = max_decoded_bytes - decoded_bytes
            if remaining <= 0:
                if handle.read(1):
                    truncated_count += 1
                break
            read_limit = min(max_record_bytes + 1, remaining + 1)
            raw_line = handle.readline(read_limit)
            if not raw_line:
                break
            decoded_bytes += len(raw_line)
            if decoded_bytes > 32 * 1024 * 1024:
                truncated_count += 1
                break
            if not raw_line.endswith(b"\n"):
                if len(raw_line) >= read_limit:
                    truncated_count += 1
                    break
                # Caddy may be appending the final record while this sample runs.
                continue
            try:
                record = json.loads(raw_line)
                if not isinstance(record, dict):
                    raise TypeError("Caddy log record is not an object")
                request = record.get("request", {})
                if not isinstance(request, dict):
                    raise TypeError("Caddy log request is not an object")
                timestamp = float(record.get("ts", 0))
                status = int(record.get("status", 0))
                duration = float(record.get("duration", 0))
                uri = request.get("uri", "")
                logger = str(record.get("logger", ""))
                message = record.get("msg", "")
                error_id = record.get("err_id", "")
                error_trace = record.get("err_trace", "")
            except (TypeError, ValueError, json.JSONDecodeError):
                timestamp_match = recent_ts.search(raw_line)
                if timestamp_match is None:
                    unscoped_malformed_count += 1
                    continue
                try:
                    malformed_timestamp = float(timestamp_match.group(1))
                except ValueError:
                    unscoped_malformed_count += 1
                    continue
                if malformed_timestamp >= cutoff:
                    malformed_count += 1
                continue
            if timestamp < cutoff or not uri.startswith("/api/"):
                continue
            identity = request_identity(record, status, uri)
            if (
                status == 503
                and logger.startswith("http.log.error")
                and message == "no upstreams available"
                and isinstance(error_id, str)
                and bool(error_id)
                and isinstance(error_trace, str)
                and error_trace.startswith("reverseproxy.")
            ):
                caddy_upstream_unavailable_count += 1
                caddy_upstream_unavailable_events[identity].append(timestamp)
                continue
            # Caddy error records are additional structured evidence for the
            # paired access record. Do not count other error-log rows twice.
            if logger.startswith("http.log.error"):
                continue
            if status in (502, 504):
                transport_count += 1
            elif status == 503:
                readiness_503_events[identity].append(timestamp)
            elif 500 <= status <= 599:
                application_count += 1
            elif status == 0:
                aborted_count += 1
            if duration >= slow_seconds:
                slow_count += 1
readiness_count = sum(map(len, readiness_503_events.values())) - paired_caddy_error_count()
print(
    transport_count,
    caddy_upstream_unavailable_count,
    readiness_count,
    application_count,
    aborted_count,
    slow_count,
    malformed_count,
    unscoped_malformed_count,
    unsafe_count,
    truncated_count,
    len(set(candidates)),
)
PY
)
  echo "ui_api_path private_live_http=${private_code:-none} public_live_http=${public_live_code:-none} public_ready_http=${public_ready_code:-none} api_error_window_seconds=${window_seconds} transport_502_504_count=${transport_errors} caddy_upstream_unavailable_503_count=${caddy_upstream_errors} readiness_503_count=${readiness_errors} other_5xx_count=${application_errors} status_0_count=${aborted_requests} slow_threshold_seconds=${slow_seconds} slow_request_count=${slow_requests} recent_malformed_log_records=${malformed_records} unscoped_malformed_log_records=${unscoped_malformed} unsafe_log_files=${unsafe_log_files} truncated_log_files=${truncated_log_files} scanned_log_files=${scanned_log_files}"
  if ((transport_critical_count > 0 && transport_errors >= transport_critical_count)); then
    echo "CRITICAL caddy_api_transport_502_504=${transport_errors} window_seconds=${window_seconds}" >&2
    severity=2
  elif ((transport_errors >= transport_warning_count && transport_warning_count > 0)); then
    echo "WARNING caddy_api_transport_502_504=${transport_errors} window_seconds=${window_seconds}" >&2
    if ((severity < 1)); then
      severity=1
    fi
  fi
  if ((transport_critical_count > 0 && caddy_upstream_errors >= transport_critical_count)); then
    echo "CRITICAL caddy_api_upstream_unavailable_503=${caddy_upstream_errors} window_seconds=${window_seconds}" >&2
    severity=2
  elif ((caddy_upstream_errors >= transport_warning_count && transport_warning_count > 0)); then
    echo "WARNING caddy_api_upstream_unavailable_503=${caddy_upstream_errors} window_seconds=${window_seconds}" >&2
    if ((severity < 1)); then
      severity=1
    fi
  fi
  if ((application_critical_count > 0 && application_errors >= application_critical_count)); then
    echo "CRITICAL caddy_api_other_5xx=${application_errors} window_seconds=${window_seconds}" >&2
    severity=2
  elif ((application_errors >= application_warning_count && application_warning_count > 0)); then
    echo "WARNING caddy_api_other_5xx=${application_errors} window_seconds=${window_seconds}" >&2
    if ((severity < 1)); then
      severity=1
    fi
  fi
  if ((readiness_critical_count > 0 && readiness_errors >= readiness_critical_count)); then
    echo "CRITICAL caddy_api_readiness_503=${readiness_errors} window_seconds=${window_seconds}" >&2
    severity=2
  elif ((readiness_errors >= readiness_warning_count && readiness_warning_count > 0)); then
    echo "WARNING caddy_api_readiness_503=${readiness_errors} window_seconds=${window_seconds}" >&2
    if ((severity < 1)); then
      severity=1
    fi
  fi
  if ((malformed_records > 0)); then
    echo "WARNING caddy_recent_malformed_log_records=${malformed_records}" >&2
    if ((severity < 1)); then
      severity=1
    fi
  fi
  if ((unsafe_log_files > 0 || truncated_log_files > 0)); then
    echo "CRITICAL caddy_log_coverage unsafe_files=${unsafe_log_files} truncated_files=${truncated_log_files}" >&2
    severity=2
  fi
  if ((aborted_critical_count > 0 && aborted_requests >= aborted_critical_count)); then
    echo "CRITICAL caddy_api_status_0=${aborted_requests} window_seconds=${window_seconds}" >&2
    severity=2
  elif ((aborted_requests >= aborted_warning_count && aborted_warning_count > 0)); then
    echo "WARNING caddy_api_status_0=${aborted_requests} window_seconds=${window_seconds}" >&2
    if ((severity < 1)); then
      severity=1
    fi
  fi
  if ((slow_critical_count > 0 && slow_requests >= slow_critical_count)); then
    echo "CRITICAL caddy_api_slow_requests=${slow_requests} threshold_seconds=${slow_seconds} window_seconds=${window_seconds}" >&2
    severity=2
  elif ((slow_requests >= slow_warning_count && slow_warning_count > 0)); then
    echo "WARNING caddy_api_slow_requests=${slow_requests} threshold_seconds=${slow_seconds} window_seconds=${window_seconds}" >&2
    if ((severity < 1)); then
      severity=1
    fi
  fi
fi

exit "${severity}"
