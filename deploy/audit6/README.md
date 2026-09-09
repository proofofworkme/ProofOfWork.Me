# Audit 6 deployment safeguards

Status: local implementation. Production installation/publication remains gated.
This directory does not authorize a release. The exact candidate, rollback
compatibility, application behavior, math/event proofs and deployment safety
receipts must pass the separately approved release plan.

## UI transaction and recovery

`ui-deployment.py` wraps the existing UI publisher and provenance helpers. It
never stops Caddy, deletes a release, changes protocol data or handles a wallet.
Production paths are fixed. Test overrides require both `--test-only` and a
private canonical JSON configuration with every mutable root under `/tmp`.

The root-owned durable job progresses through `prepared`, `armed`,
`published-awaiting-smoke`, then `committed`. Every state file is fsynced and
atomically replaced, including the parent directory. The existing publisher
performs the actual `RENAME_EXCHANGE`. Its `status=published` marker is **not**
the new controller's commit point: live provenance and HTTP byte checks must
also pass before the durable `committed` state is written.

Preparation creates a third, separately attested rollback root: exact prior
HTML plus the union of all prior/candidate non-index resources. It binds that
root to a new archive through the unchanged `record-rollback-evidence` and
`verify-rollback` helpers. Every prior resource must also exist unchanged in the
candidate, so cached clients work across forward publication. Same-URL content
or mode conflicts are refused. The original prior root/archive stay untouched.
A receipt alone cannot bypass this computed resource-continuity gate.

A failure or a fresh process finding an unfinished armed publication identifies
all three exact inodes, verifies original evidence and the prepared continuity
root, then atomically serves that separately attested rollback root. It preserves
the untouched original under the retained prior name and the rejected candidate
under its staged name. A browser that received candidate HTML just before
rollback can still retrieve its candidate JS/CSS afterward. Recovery verifies
both original evidence and the complete served prior/candidate resource closure
over HTTP. Unknown identities, changed helper/controller bytes, conflicting
resources or failed proof refuse guessed restoration. Kills after original-root
preservation, continuity exchange or displaced-root preservation resume from
durable identities. Even an armed operation that died before publication uses
the continuity root: an `armed` journal alone cannot prove whether a publisher's
own trap briefly served and then restored the candidate.

A `prepared` job never gets published by the recovery timer. A `committed` job
is not rolled back by a later watchdog pass. The controller pins its own hash,
the continuity helper and all three existing helper hashes; do not replace these while a job is
unfinished. The shared existing deployment lock prevents overlap with the
publisher, other controller processes and cleanup. The timer skips a busy lock.

Install the template deployment service and separate recovery service/timer
only after the host certification below passes. The deployment unit is enabled
per release and started by systemd, with restart on failure, a 15-minute limit,
control-group kill behavior, and an independently enabled 10-second recovery
timer. Before arming a production publication, the controller confirms that it
is the service's actual MainPID, the release instance is enabled, the timer is
active/enabled and the core supervision properties match the reviewed unit.

The service must share the host `/var/tmp`: `PrivateTmp=true` would hide the
staged input. `/var` is writable because binding only `/var/www` would turn the
exchange target into a mountpoint and violate the existing atomic publication
contract. `/var/log` and `/var/cache` are explicitly read-only. The controller
accepts only its fixed paths; this service filesystem grant must still be
reviewed during installation. Checked helpers receive TMPDIR equal to the controlled staging directory,
so archive verification does not try to write to the read-only host `/tmp`.
The exact production sandbox needs its host test.

## What the checks establish

The HTTP check reads every regular file from all 15 surfaces, including retained
assets, and verifies the exact expected byte count and SHA256 over loopback
HTTP through Caddy. Production uses HTTPS with the actual virtual-host name,
SNI and certificate verification. Requests are read-only, four at a time,
with a 180-second aggregate deadline and at most four final 10-second socket
timeouts. Bounds are 25,000 files, 16 MiB per file and 2 GiB total.

This does not establish external DNS/client reachability, interactive browser
behavior, API math, wallet signing, protocol correctness or compatibility of a
new UI with the old node. Those are separate release gates. The gate receipt is
a root-owned reviewed attestation, not a substitute for running its checks:

```json
{
  "model": "proofofwork-reviewed-ui-candidate-v1",
  "candidateCommit": "<full exact commit>",
  "passed": true,
  "rollbackCompatible": true,
  "noPlannedOutage": true,
  "checks": [
    {"name": "<actually completed required gate>", "passed": true,
     "evidenceSha256": "<SHA256 of retained evidence>"}
  ]
}
```

Use a new release ID and the publisher's existing exact candidate/source/archive
naming. `prepare --release <id> --commit <commit> --gates-receipt <file>` verifies
the candidate and prior root before writing a job. The release coordinator must
review all gates and enable/start the reviewed instance only after preparation.
No installer or production invocation is performed by the test scripts.

## Local fault checks

```sh
python3 -I scripts/check-audit6-deployment.py --jobs=2
python3 -I scripts/check-audit6-deployment-modes.py
```

The first suite uses byte-identical copies of the real publisher/provenance
helpers, real local directory exchanges, a loopback HTTP fixture and fresh
recovery OS processes. It covers kill before exchange; kill after the actual
publisher exchange; kill after publication; failed post-publication HTTP; kill
after rollback exchange; kill after durable commit; successful commit; pending
preparation; helper/gate drift; candidate HTML/asset requests crossing rollback; resource
conflicts; missing continuity proofs; both additional root-preservation kill
boundaries; and supervision file contracts. The injected
post-exchange pause intercepts the publisher's `record` call, which occurs only
after its real exchange. It does not replace the exchange algorithm.

These process-tree checks alone do not certify systemd. The mode suite executes
the node verifier's exact permission-bit predicate, preserving the publisher's
0111 executable classification and unsafe mode rejection without depending on
root's `test -x` access under CAP_DAC_READ_SEARCH (H5-03).

## Host systemd certification: isolated resources only

`scripts/check-audit6-deployment-systemd.py` requires root, PID 1 systemd,
`--execute`, and an existing systemd invocation ID for the harness itself. It
refuses an ordinary SSH-child invocation. The full harness runs as one bounded
detached unit, so its local HTTP fixture survives departure of the launching
SSH session. Individual controller services and independent watchdog timers are
also manager-owned. Each has a unique `pow-audit6-fixture-*` name. The harness
and every child test service share one unique aggregate slice; child units are
not merely assumed to inherit the harness unit's limits. The reviewed envelope
is 25% of one CPU, 384 MiB memory high / 512 MiB hard memory with no swap, 256 tasks, and
10 MiB/s reads plus 5 MiB/s writes on the fixture/bundle backing devices. The
runner checks the effective cgroup limits and refuses if available RAM is below
1 GiB. Caps and initial available RAM are retained in the receipt. Every test service
and timer is bound to the bounded detached harness unit, so an unexpected
harness exit cannot leave recurring test timers behind. This affects only
synthetic test resources; the independent recovery case still runs while its
deployment test unit is killed/stopped. The fixture's
per-service restart/kill/sandbox settings stay intact inside that aggregate cap.

Prerequisites are Python 3, Bash, Git, tar, coreutils, util-linux/flock,
`systemd-run`/`systemctl`/journald, cgroup v2 with the CPU/memory/pids/I/O
controllers, and renameat2 on one temporary filesystem. Automatic block-device
discovery must produce the tested filesystem devices; a missing effective I/O
limit is a refusal, not a pass.
No package installation, database connection, Core call or production route is
part of this test. Put a reviewed root-owned copy of these files beneath a new
`/var/tmp/proofofwork-audit6-safeguard-<unique>/` bundle:

- `scripts/check-audit6-deployment.py`
- `scripts/check-audit6-deployment-systemd.py`
- `deploy/audit6/ui-deployment.py`, `ui-continuity.py`, service/timer files, and the fixture slice
- `deploy/proofofwork-ui-release-publish.sh`
- `deploy/proofofwork-ui-release-provenance.sh`
- `deploy/proofofwork-ui-retained-root.py`

Use a new lowercase alphanumeric ID of 8–32 characters consistently. The
slice file is an isolated runtime-only test unit; check that its name is unused
before installing it. Loading this new unit does not restart any application
unit. The exact reviewed setup/invocation is:

```sh
set -eu
test ! -e /run/systemd/system/powaudit6certify<unique>.slice
install -m 0644 \
  /var/tmp/proofofwork-audit6-safeguard-<unique>/deploy/audit6/proofofwork-ui-deployment-fixture.slice \
  /run/systemd/system/powaudit6certify<unique>.slice
systemctl daemon-reload
systemd-run --unit=pow-audit6-certify-<unique> --collect \
  --slice=powaudit6certify<unique>.slice \
  --property=Type=exec --property=RuntimeMaxSec=45min \
  --property=KillMode=control-group --property=TimeoutStopSec=30s \
  --property=PrivateTmp=false --property=UMask=0022 \
  /usr/bin/python3 -I \
  /var/tmp/proofofwork-audit6-safeguard-<unique>/scripts/check-audit6-deployment-systemd.py \
  --execute --output /tmp/pow-audit6-systemd-results-<unique> \
  --slice=powaudit6certify<unique>.slice \
  --harness-unit=pow-audit6-certify-<unique>.service
```

After that command returns, disconnect the launching session and reconnect to
read the result. Do not use `--wait` or tie the harness to a login shell. Read
`receipt.json`, the three per-case JSON receipts, and the bounded journal for
the harness. Success requires three passing scenarios, matching hashes of the
reviewed source/helpers/units, untouched retained prior inode and manifest, the
separately attested served rollback inode, all 45 prior/candidate fixture static
files verified through HTTP, and a fresh recovery invocation
for killed processes. The independent timer case additionally confirms that
the deployment test unit was stopped and the timer's invocation restored it.

The cases are actual MainPID SIGKILL after the publisher exchange, an incorrect
HTTP response after successful publication, and SIGKILL of the full deployment
unit followed by disabling its own restart so the independent timer must act.
The test reads service properties from the tracked production unit files and
preserves sandbox/restart/kill/resource settings; only entrypoints, dependencies,
state paths and writable roots are adapted to isolated fixtures. The generated
static fixture uses HTTP, not Caddy/TLS. Its temporary roots and exact test units
are cleaned after receipts and bounded logs are saved. The output directory is
retained. After the harness and its exact test units finish, the operator may
stop the unique certification slice, remove only its generated runtime unit
file, and reload systemd. Preserve the result directory for audit. No existing
unit, live root, live routing or release archive is touched.

A passing host test establishes actual manager-controlled interruption recovery
for this adapter on that host. It still does not prove a host reboot/power-loss,
the production filesystem/mount layout, production Caddy/TLS or live application
behavior. Those limits must remain explicit in the production gate review.

## Cleanup reference guard

`ui-cleanup-guard.py` never deletes anything. It reads every unfinished journal
under the existing shared deployment lock and protects the candidate root,
source checkout/runtime, original prior root/archive, separately attested
recovery root/archive, and archive checksum/provenance sidecars. It also
protects the current serving root/archive and durable journals. Missing or
ambiguous original identities, changed original manifests and unknown journal
states refuse all cleanup. Candidate paths intersecting either a protected
ancestor or descendant are refused.

A standalone CLI scan is only a review snapshot. A future approved cleanup
entrypoint must call `assert_removable(config, held_lock_fd, exact_paths)`
immediately before deletion and retain that same lock through its existing
provenance checks and separately approved deletion. This function rescans
journals; a cached report is not a permission token. A subprocess guard can
inherit the caller's verified `POW_UI_DEPLOY_LOCK_FD`, preserving the parent
lock. Reference exclusion is an additional check, not a replacement for the
existing retain/delete classifications, active provenance and explicit scope.

`python3 -I scripts/check-audit6-deployment-references.py` verifies protected
root/archive/source closure, path ancestry, the killed-publisher layout,
terminal-vs-active references, journal/manifest drift refusal and lock retention.
No production deletion or cleanup configuration change is part of this work.

## Node release boundary

See `node-no-outage-design.md`. The current stopped-service node publisher must
not be used under this approval. A UI-only safe controller does not make a node
cutover safe. The current release remains serving until a concrete parallel
route and exclusive-writer handoff have their own reviewed recovery and fault
proofs.
