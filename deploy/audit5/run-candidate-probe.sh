#!/usr/bin/env bash
# One-release, read-only API/Core probe through the private environment launcher.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LC_ALL=C
unset TAR_OPTIONS GZIP BASH_ENV ENV CDPATH NODE_OPTIONS LD_PRELOAD LD_LIBRARY_PATH

[[ $# == 0 && $EUID == 0 ]]

release='661e576453ca-20260922T025214Z'
commit='661e576453caddbd622c5c6255d1de0001bf4804'
tree='ddb2f6892b448c85334d48a25271b6b4e93b0676'
previous_live='68b16f6530494171561170ffac78ad26cdf17a5e'
probe_sha256='84c1d113f57dfc4f5631a11dfce62e5c9f4b0c381f42afa40912a4fe58e8fb4c'
private_env_sha256='e196f5e2155043e924d743e6aa01eb1d68cea75766ef2334b00551f5afe7eb90'
shadow_sha256='48da4605178d43d1cfbf7b33aeb45c1a64e9474913d8e51d1513904dd8d4bf4d'
tools="/var/tmp/proofofwork-deploy/audit5-probe-${release}"
private_env="${tools}/private-env.py"
shadow_entry="${tools}/shadow-entry.mjs"
candidate="/opt/proofofwork-api-stage-${release}"
live='/opt/proofofwork-api'
runroot="/run/proofofwork-audit5-${release}"
output="/data/proofofwork-audit5-probe-${release}"
shadow_unit="proofofwork-audit5-shadow-${release}"
probe_unit="proofofwork-audit5-probe-${release}"
shadow_started=0

refuse() {
  printf 'candidate_probe status=refused reason=%s\n' "$1" >&2
  exit 1
}

cleanup() {
  local result=$?
  trap - EXIT
  if ((shadow_started)) && systemctl is-active --quiet "$shadow_unit"; then
    if ! systemctl stop "$shadow_unit" >/dev/null; then
      printf 'candidate_probe cleanup=failed unit=%s\n' "$shadow_unit" >&2
      result=1
    fi
  fi
  if ((shadow_started)) && systemctl is-active --quiet "$shadow_unit"; then
    printf 'candidate_probe cleanup=still-active unit=%s\n' "$shadow_unit" >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT

[[ "$(stat -c '%u:%g:%a' "$tools")" == '0:0:700' ]] || refuse unsafe_tool_directory
[[ "$(stat -c '%u:%g:%a' "$private_env")" == '0:0:600' ]] || refuse unsafe_private_launcher
[[ "$(stat -c '%u:%g:%a' "$shadow_entry")" == '0:0:600' ]] || refuse unsafe_shadow_entry
[[ "$(sha256sum "$private_env" | cut -d' ' -f1)" == "$private_env_sha256" ]] || refuse private_launcher_hash
[[ "$(sha256sum "$shadow_entry" | cut -d' ' -f1)" == "$shadow_sha256" ]] || refuse shadow_entry_hash

[[ -d "$candidate" && ! -L "$candidate" && "$(realpath -e "$candidate")" == "$candidate" ]] || refuse candidate_path
candidate_commit="$(GIT_OPTIONAL_LOCKS=0 git -c safe.directory="$candidate" -C "$candidate" rev-parse --verify 'HEAD^{commit}')"
candidate_tree="$(GIT_OPTIONAL_LOCKS=0 git -c safe.directory="$candidate" -C "$candidate" rev-parse --verify 'HEAD^{tree}')"
GIT_OPTIONAL_LOCKS=0 git -c safe.directory="$candidate" -C "$candidate" symbolic-ref --quiet HEAD >/dev/null 2>&1 && refuse candidate_not_detached
[[ "$candidate_commit" == "$commit" && "$candidate_tree" == "$tree" ]] || refuse candidate_identity
[[ "$(sha256sum "$candidate/deploy/audit5/probe-candidate.mjs" | cut -d' ' -f1)" == "$probe_sha256" ]] || refuse probe_script_hash

[[ -d "$live" && ! -L "$live" && "$(realpath -e "$live")" == "$live" ]] || refuse live_checkout_path
live_commit="$(GIT_OPTIONAL_LOCKS=0 git -c safe.directory="$live" -C "$live" rev-parse --verify 'HEAD^{commit}')"
[[ "$live_commit" == "$previous_live" ]] || refuse live_checkout_changed
systemctl is-active --quiet proofofwork-api.service || refuse api_service_not_active
systemctl is-active --quiet proofofwork-indexer-worker.service || refuse indexer_service_not_active
[[ -d "$runroot" && ! -L "$runroot" && "$(stat -c '%u:%g:%a' "$runroot")" == '0:0:700' ]] || refuse private_capture_missing

for unit in "$shadow_unit" "$probe_unit"; do
  if systemctl is-active --quiet "$unit" || systemctl show --property=LoadState --value "$unit" 2>/dev/null | grep -qx loaded; then
    refuse "unit_already_exists_${unit}"
  fi
done
[[ -z "$(ss -H -ltn 'sport = :18081')" ]] || refuse candidate_port_in_use

/usr/bin/python3 -I "$private_env" prepare-probe-output --release-id "$release"

shadow_started=1
systemd-run --quiet --collect --unit="$shadow_unit" --property=Type=exec \
  --property=Restart=no --property=RuntimeMaxSec=720s \
  /usr/bin/python3 -I "$private_env" launch --release-id "$release" --mode readonly-shadow

ready=0
for _attempt in {1..90}; do
  if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
      'http://127.0.0.1:18081/health?network=livenet' |
      jq -e '.ready == true and .lagBlocks == 0' >/dev/null 2>&1; then
    ready=1
    break
  fi
  systemctl is-active --quiet "$shadow_unit" || break
  sleep 2
done
((ready == 1)) || refuse candidate_shadow_not_ready

probe_stream=''
probe_status=0
if probe_stream="$(systemd-run --quiet --collect --wait --pipe --unit="$probe_unit" \
    --property=Type=exec --property=Restart=no --property=RuntimeMaxSec=660s \
    /usr/bin/python3 -I "$private_env" launch --release-id "$release" --mode candidate-probe)"; then
  probe_status=0
else
  probe_status=$?
fi

receipt="${output}/receipt.json"
if [[ ! -f "$receipt" || -L "$receipt" ]]; then
  refuse candidate_probe_receipt_missing
fi
powadmin_uid="$(id -u powadmin)"
powadmin_gid="$(id -g powadmin)"
[[ "$(stat -c '%u:%g:%a:%h' "$receipt")" == "${powadmin_uid}:${powadmin_gid}:600:1" ]] || refuse unsafe_probe_receipt
(( $(stat -c '%s' "$receipt") <= 1048576 )) || refuse probe_receipt_oversize

if ((probe_status != 0)); then
  failure="$(jq -r 'if (.failure | type) == "string" and (.failure | test("^[A-Z0-9_]+$")) then .failure else "PROBE_FAILED" end' "$receipt" 2>/dev/null || printf 'PROBE_FAILED')"
  printf 'candidate_probe status=failed release=%s commit=%s failure=%s evidence=%s\n' \
    "$release" "$commit" "$failure" "$output" >&2
  exit 1
fi

summary="$(jq -ce '
  select(.format == "audit5-candidate-http-core-v1" and .ok == true and
         .base == "http://127.0.0.1:18081" and
         .limits.pages == 32 and .limits.rows == 2000 and
         .limits.totalBytes == 201326592 and .limits.httpRequests == 128 and
         .limits.coreRequests == 2300 and .limits.milliseconds == 600000)
  | select((.result.boost.events | type) == "number" and
           (.result.boost.visibleRecords | type) == "number" and
           (.result.boost.proofSignalQ8 | type) == "string" and
           (.result.boost.totalSignalQ8 | type) == "string" and
           (.result.core.height | type) == "number" and
           (.result.core.hash | type) == "string" and
           (.result.core.hash | test("^[0-9a-f]{64}$")) and
           (.result.core.mempoolSequenceStable | type) == "boolean")
  | {boost: {events: .result.boost.events,
             visibleRecords: .result.boost.visibleRecords,
             proofSignalQ8: .result.boost.proofSignalQ8,
             totalSignalQ8: .result.boost.totalSignalQ8,
             rawCarrierSamples: .result.boost.rawCarrierSamples},
     core: {height: .result.core.height,
            mempoolSequenceStable: .result.core.mempoolSequenceStable}}
' "$receipt")" || refuse candidate_probe_receipt_invalid

systemctl stop "$shadow_unit" >/dev/null || refuse candidate_shadow_stop_failed
systemctl is-active --quiet "$shadow_unit" && refuse candidate_shadow_still_active
shadow_started=0
systemctl is-active --quiet proofofwork-api.service || refuse api_service_changed
systemctl is-active --quiet proofofwork-indexer-worker.service || refuse indexer_service_changed
printf 'candidate_probe status=verified release=%s commit=%s summary=%s evidence=%s\n' \
  "$release" "$commit" "$summary" "$output"
