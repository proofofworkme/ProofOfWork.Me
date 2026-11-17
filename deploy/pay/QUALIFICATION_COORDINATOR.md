# Immediate qualification handoff

`qualification-coordinator.py` removes the manual delay between a completed,
reviewed checker and an already reviewed native probe/enable runner. It is a
transport primitive with no automatic retries within one invocation, not a new activation authority or a generic
native runner. It creates no local evidence files and changes no controller,
resource policy, installed package, historical record, or rollback policy.

The earlier release-specific native runner contained strict artifact/verifier,
report, runtime, Search-hold and restoration checks. Those are **not** replaced
by this coordinator. Prepare and independently review the exact native runner
for each release. It must validate the exact remote evidence SHA supplied as its
only argument, source identity, report content and native admission; it must
preserve Search recovery and refuse reused output namespaces. A supplied script
hash establishes byte identity, not safety, freshness, or user approval.

## Manifest contract

Use a new private regular file (0600, own user, one link) with exactly:

```json
{
  "format": "pay-qualification-handoff-v1",
  "checker": {"path": "/tmp/reviewed-checker.sh", "sha256": "<64 lowercase hex>"},
  "runner": {"path": "/tmp/reviewed-native-runner.py", "sha256": "<64 lowercase hex>"},
  "evidence": "/tmp/new-vps-attempt/checker.log",
  "ssh": {"account": "operator", "host": "node.example", "identityFile": "/home/operator/.ssh/node"},
  "checkerTimeoutSeconds": 8100
}
```

Both source files have the same private ownership/mode/regular-file requirements.
All ancestors must be trusted, non-writable directories; root-owned sticky
`/tmp` and `/var/tmp` are the only exceptions. Symbolic links and hardlinked
source files are refused. Manifest bytes (maximum 16 KiB) are checked against the
explicit command-line SHA **before parsing**, including duplicate-key refusal.
Both source blobs (maximum 256 KiB each) are read and pinned in memory before any
checker execution. A later on-disk change cannot change the dispatched bytes.

The checker is a read-only, reviewed Bash launcher, not a command supplied by
remote output. It must keep raw/private evidence on the VPS. Its only stdout
metadata (stderr is merged) is exactly two lines:

```text
{"evidence":"/tmp/new-vps-attempt/checker.log","bytes":123,"sha256":"<64 lowercase hex>"}
checker_exit=0 evidence_receiver_exit=0
```

Both pipeline statuses and the launcher exit must be zero. The path must match
the manifest exactly; the remote evidence size is bounded to 2 MiB. The native
runner still verifies the actual bytes against that digest. Metadata is limited
to 16 KiB, and the checker deadline must be 1–8100 seconds. On timeout/overflow,
only the owned read-only checker process group receives TERM. If it does not
exit within three seconds, reconcile it; the tool does not escalate to KILL.
Remote read-only descendants might require independent reconciliation.

After independent review, appropriate owner authorization, fresh native gates
and a sole health monitor are ready, invoke:

```sh
python3 -I -B deploy/pay/qualification-coordinator.py /tmp/reviewed-handoff.json \
  --manifest-sha256 <exact-manifest-sha256> --execute-reviewed-once
```

This flag is an explicit execution boundary, **not stored user approval or a durable exactly-once guarantee**. Repeated CLI invocation is not safe resume: the reviewed native runner must enforce creation-only attempt outputs and unchanged native admission. Reconcile any prior uncertain invocation before starting another. The coordinator has no durable marker or cross-invocation mutex and does not promise exactly-once or parallel exclusion. The independently reviewed native runner must enforce creation-only attempt storage and native deployment locking, including refusing parallel or repeated attempts; a manifest does not provide those guarantees.
The fixed SSH command enables strict host-key checking, batch mode and the
specified identity only, then feeds the pinned runner to
`sudo -n /usr/bin/python3 -I -B - <evidence-sha256>`. No arbitrary remote command,
SSH option, or shell argument is accepted. Existing credentials are used in
place; no key contents are copied.

## Failure and completion boundaries

There is no native-dispatch timeout, automatic retry, health-triggered native
signal or resume option. Native controllers retain their own locks, timeouts,
recovery and exact state gates. Any nonzero native/SSH exit is reported as uncertain with doNotRetry, not as a known failed mutation. A transport error or interruption after dispatch
may leave the action complete, failed, or still running. Inspect genuine native
receipts, process ownership, service/Search state and lock before deciding what
comes next. Never reuse a completed/uncertain activation attempt merely because
this program exited nonzero.

A zero coordinator exit means only that the native process returned zero.
Require native receipt and restored-services verification before announcing
activation. This tool does not automate permanent backup deletion, relax any
confirmation requirement, claim a signed payment test, or normalize the prior
one-off dual-identity exception into a stock released-source check.

Offline coverage: run `python3 -I -B deploy/pay/check-qualification-coordinator.test.py`.
The fixtures exercise real local Bash pipes but mock native dispatch completely.
They cannot establish production readiness or current health.
