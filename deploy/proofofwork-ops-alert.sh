#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

unit="${1:-}"
state_root="${POW_ALERT_STATE_ROOT:-/var/lib/proofofwork-alerts}"
curl_config="${POW_ALERT_CURL_CONFIG:-/etc/proofofwork-alerts/curl.conf}"
dedupe_seconds="${POW_ALERT_DEDUPE_SECONDS:-900}"
allow_test_roots="${POW_OPS_ALLOW_TEST_ROOTS:-0}"

if [[ ! "${unit}" =~ ^[A-Za-z0-9_.@:-]+\.(service|socket|timer|mount)$ ]]; then
  echo "Invalid failed unit name." >&2
  exit 1
fi
if [[ ! "${dedupe_seconds}" =~ ^[0-9]+$ ]] || ((dedupe_seconds < 60)); then
  echo "POW_ALERT_DEDUPE_SECONDS must be an integer of at least 60." >&2
  exit 1
fi
if [[ "${allow_test_roots}" != "1" ]] && {
  [[ "${state_root}" != "/var/lib/proofofwork-alerts" ]] ||
    [[ "${curl_config}" != "/etc/proofofwork-alerts/curl.conf" ]];
}; then
  echo "Alert path overrides are test-only." >&2
  exit 1
fi
if [[ ! -d "${state_root}" || -L "${state_root}" ]]; then
  echo "Alert state root must be a real directory: ${state_root}" >&2
  exit 1
fi

stamp_key="$(printf '%s' "${unit}" | /usr/bin/sha256sum | /usr/bin/cut --delimiter=' ' --fields=1)"
exec 9>"${state_root}/${stamp_key}.lock"
/usr/bin/flock --exclusive 9

now_epoch="$(/usr/bin/date -u +%s)"
journal_stamp_path="${state_root}/${stamp_key}.journal.last"
webhook_stamp_path="${state_root}/${stamp_key}.webhook.last"
active_state="$(/usr/bin/systemctl show --property=ActiveState --value "${unit}" 2>/dev/null || true)"
result="$(/usr/bin/systemctl show --property=Result --value "${unit}" 2>/dev/null || true)"
restart_count="$(/usr/bin/systemctl show --property=NRestarts --value "${unit}" 2>/dev/null || true)"
host="$(/usr/bin/hostname --fqdn 2>/dev/null || /usr/bin/hostname)"
message="event=unit_failure host=${host} unit=${unit} active_state=${active_state:-unknown} result=${result:-unknown} restarts=${restart_count:-unknown} observed_at_epoch=${now_epoch}"

journal_deduplicated=0
if [[ -f "${journal_stamp_path}" && ! -L "${journal_stamp_path}" ]]; then
  previous_epoch="$(<"${journal_stamp_path}")"
  if [[ "${previous_epoch}" =~ ^[0-9]+$ ]] &&
    ((now_epoch >= previous_epoch)) &&
    ((now_epoch - previous_epoch < dedupe_seconds)); then
    /usr/bin/logger --priority daemon.notice --tag proofofwork-ops-alert -- \
      "event=unit_failure_deduplicated unit=${unit} window_seconds=${dedupe_seconds}"
    journal_deduplicated=1
  fi
fi
if ((journal_deduplicated == 0)); then
  /usr/bin/logger --priority daemon.crit --tag proofofwork-ops-alert -- "${message}"
  printf '%s\n' "${message}" >&2
  printf '%s\n' "${now_epoch}" >"${journal_stamp_path}.tmp"
  /usr/bin/mv -- "${journal_stamp_path}.tmp" "${journal_stamp_path}"
fi

# Journal delivery is always available. A webhook is optional and remains
# disabled until an operator installs a root-only curl config containing its
# URL, method, and authentication header.
if [[ -e "${curl_config}" ]]; then
  if [[ ! -f "${curl_config}" || -L "${curl_config}" ]]; then
    /usr/bin/logger --priority daemon.crit --tag proofofwork-ops-alert -- \
      "event=alert_webhook_rejected reason=unsafe_config_path"
    exit 0
  fi
  config_owner="$(/usr/bin/stat --format='%U:%G' "${curl_config}")"
  config_mode="$(/usr/bin/stat --format='%a' "${curl_config}")"
  if [[ "${config_owner}" != "root:root" || "${config_mode}" != "600" ]]; then
    /usr/bin/logger --priority daemon.crit --tag proofofwork-ops-alert -- \
      "event=alert_webhook_rejected reason=unsafe_config_metadata owner=${config_owner} mode=${config_mode}"
    exit 0
  fi

  webhook_deduplicated=0
  if [[ -f "${webhook_stamp_path}" && ! -L "${webhook_stamp_path}" ]]; then
    previous_webhook_epoch="$(<"${webhook_stamp_path}")"
    if [[ "${previous_webhook_epoch}" =~ ^[0-9]+$ ]] &&
      ((now_epoch >= previous_webhook_epoch)) &&
      ((now_epoch - previous_webhook_epoch < dedupe_seconds)); then
      webhook_deduplicated=1
    fi
  fi
  if ((webhook_deduplicated == 1)); then
    exit 0
  fi

  webhook_delivered=0
  for attempt in 1 2 3; do
    if /usr/bin/curl --config "${curl_config}" --fail --silent --show-error \
      --connect-timeout 2 --max-time 4 --data-raw "${message}" >/dev/null; then
      webhook_delivered=1
      break
    fi
    if ((attempt < 3)); then
      /usr/bin/sleep "${attempt}"
    fi
  done
  if ((webhook_delivered == 1)); then
    printf '%s\n' "${now_epoch}" >"${webhook_stamp_path}.tmp"
    /usr/bin/mv -- "${webhook_stamp_path}.tmp" "${webhook_stamp_path}"
  else
    /usr/bin/logger --priority daemon.crit --tag proofofwork-ops-alert -- \
      "event=alert_webhook_failed unit=${unit} attempts=3"
    exit 1
  fi
fi
