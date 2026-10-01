# Audit 29 release controller invocation

These are preparation instructions, not an executed release receipt. The
controller publishes an already staged, accepted candidate. It does not build,
upload, extract, delete recovery, change protocol/ledger data, or clear holds.
All examples contain placeholders which the release operator must replace with
the exact reviewed values. Preserve every failed attempt and its receipt.

Before production use, run these local private-fixture checks:

```sh
python3 -I -B deploy/audit29/check-release.test.py
python3 -I -B deploy/audit29/check-private-verify.test.py
python3 -I -B scripts/check-audit29-ops-install.py
python3 -B scripts/check-ui-stage-dedup.py
python3 -I -B scripts/check-audit5-ui-workflow.py
```

Copy the reviewed controller and, on the node, the unchanged Audit 5 attestor to
a new root-owned, non-writable-by-others `audit29-tools` directory inside
`/var/tmp/proofofwork-deploy`. Compare their SHA256 values against the final
reviewed repository before executing either. The controller rejects unsafe
helper/receipt ownership and requires each installed helper's exact SHA256 on
the command line. It does not derive approved hashes from live mutable files.

Candidate identity is a full lowercase commit and tree hash. The release ID is
`COMMIT12-YYYYMMDDTHHMMSSZ`. Copy all acceptance/attestation/classification inputs
to canonical root-owned files. Hash them after copying and supply those exact
hashes. An existing receipt directory refuses reuse.

For prepublication acceptance, run the read-only candidate driver through the
private launcher, with candidate and internal authority both exactly
`http://127.0.0.1:18081`. The driver must identify the staged candidate commit,
tree and attested runtime, pass IDs, Computer events and strict 102-check parity,
verify the complete paginated WORK book and wallet authority, and retain a
stable Core checkpoint. The controller accepts only an `ok: true` receipt less
than 30 minutes old with those candidate bindings, all three gates `true`, and
the exact shadow origins. A public/live verification receipt cannot authorize
cutover. No credentials belong in a command line, receipt or transcript.

## UI transport admission

Every source/bundle/surfaces transport and extraction needs a separate admission
before allocating, while its parent keeps the existing shared deployment lock
through completion. `admit-ui` is read-only apart from its private receipts and
does not itself transport anything. Conservative additional bytes must include
uncompressed files, allocation rounding, metadata, and the entire concurrent
peak; additional inode counts must cover all new entries. The controller also
charges 8 MiB/32 inodes for its evidence. It retains the 5 GiB scratch ceiling,
10 GiB root reserve, and installed capacity helper's growth/inode reserves.

```sh
# Run this in the same trusted root shell which will perform the transport.
exec {audit29_lock_fd}</run/proofofwork-ui/deploy.lock
flock --exclusive --nonblock "$audit29_lock_fd"
python3 -I -B /var/tmp/proofofwork-deploy/audit29-tools/release.py admit-ui \
  --release-id COMMIT12-UTC --admission-id source-receive-1 \
  --lock-fd "$audit29_lock_fd" --additional-bytes CONSERVATIVE_BYTES \
  --additional-inodes CONSERVATIVE_INODES --helper-sha capacity=REVIEWED_SHA256
# Only on success: run the reviewed exact receiver/extractor under this same FD.
# Repeat admission with a fresh admission-id immediately before each next phase.
# Close this shell's FD only after all transport/extraction/staging is finished.
exec {audit29_lock_fd}<&-
```

Receipts go to
`/var/tmp/proofofwork-deploy/audit29-admit-RELEASE-ADMISSION_ID`. Admission is not a
reservation after the parent drops its lock. The staged root, exact source
checkout and managed archive must already have passed the reviewed stager and
provenance tools before publication. Keep failed payloads and stages as evidence.

## Node cutover

Required pre-existing candidate paths use the audited Audit 5 staging layout:

- `/opt/proofofwork-api-stage-RELEASE`, fully attested as powadmin.
- `/var/tmp/proofofwork-deploy/proofofwork-audit5-source-RELEASE.bundle`;
  `--archive-sha256` binds this incoming source bundle, not a future archive.
- A five-field candidate attestation and a five-field old live attestation:
  commit, tree, runtime entry count, runtime bytes, runtime SHA256.
- The old verified archive under `/data/proofofwork-release-backups/managed` and
  its exact SHA256-bound provenance, matching all five old live fields.
- A release-bound `proofofwork-audit29-shadow-RELEASE.service` and the fresh,
  complete shadow receipt described above.

```sh
systemd-run --unit=proofofwork-audit29-release-COMMIT12-UTC-node \
  --service-type=exec --wait --pipe \
  --property=User=root --property=KillMode=control-group \
  --property=RuntimeMaxSec=30min --property=TimeoutStopSec=30s \
  /usr/bin/python3 -I -B /var/tmp/proofofwork-deploy/audit29-tools/release.py node \
  --release-id COMMIT12-UTC --commit FULL_COMMIT --tree FULL_TREE \
  --candidate-attestation /ROOT_PRIVATE/candidate.tsv --attestation-sha256 SHA256 \
  --archive-sha256 SOURCE_BUNDLE_SHA256 \
  --shadow-receipt /ROOT_PRIVATE/shadow/receipt.json --shadow-sha256 SHA256 \
  --old-attestation /ROOT_PRIVATE/old.tsv --old-attestation-sha256 SHA256 \
  --recovery-archive /data/proofofwork-release-backups/managed/OLD_ARCHIVE.tgz \
  --recovery-sha256 SHA256 --recovery-provenance-sha256 SHA256 \
  --shadow-unit proofofwork-audit29-shadow-COMMIT12-UTC.service \
  --helper-sha attestor=SHA256 --helper-sha exchange=SHA256 \
  --helper-sha publisher=SHA256
```

Add `--quiet-unit EXACT.service` for every other known mutating maintenance
job. These extra units are inspected, never stopped automatically. The actual
backup unit, processes and temporary sets must be quiet. The controller holds
only previously active maintenance timers, acquires the real backup writer
lock, stops the shadow and application services, drains without terminating any
database sessions, and verifies both exact tree attestations before exchange.
Core, Electrs, PostgreSQL and WAL receiver process identities remain unchanged.

After verifying the exchange, the controller restores application service and
readiness immediately. Managed archive reconstruction happens while the API is
serving. The previous verified archive and previous checkout are preserved.
The installed publisher reconstructs the new archive from the attested live
tree; the private `.tgz` trigger is explicitly recorded as a request, not as
archive evidence. Its published archive SHA256 is verified and recorded.

Receipts go to `/data/proofofwork-audit29-cutover-RELEASE`. A known exchanged
pair can be exchanged back on failure, retaining the failed candidate and
original error. An unknown pair leaves application/timer holds for inspection.

## UI publication

Supply a reviewed root-owned JSON build attestation containing exact `commit`,
`tree`, and `archiveSha256`; an exact old live manifest SHA256 and complete-root
tree SHA256 from the reviewed retained-root fingerprint function; and a JSON
list containing **every** existing rollback root. Each classification is:

```json
{"root":"/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-EXACT_ID","classification":"retain","manifestSha256":"SHA256","treeSha256":"SHA256"}
```

No omitted, added, duplicate, or remove classification is accepted; the
installed publisher supports at most 16 existing roots. All existing roots and
the new complete prior root are preserved. Use the same fresh shadow receipt
from the exact shared repository commit/tree.

```sh
systemd-run --unit=proofofwork-audit29-release-COMMIT12-UTC-ui \
  --service-type=exec --wait --pipe \
  --property=User=root --property=KillMode=control-group \
  --property=RuntimeMaxSec=30min --property=TimeoutStopSec=30s \
  /usr/bin/python3 -I -B /var/tmp/proofofwork-deploy/audit29-tools/release.py ui \
  --release-id COMMIT12-UTC --commit FULL_COMMIT --tree FULL_TREE \
  --candidate-attestation /ROOT_PRIVATE/ui-build.json --attestation-sha256 SHA256 \
  --archive-sha256 MANAGED_UI_ARCHIVE_SHA256 \
  --shadow-receipt /ROOT_PRIVATE/shadow/receipt.json --shadow-sha256 SHA256 \
  --old-manifest-sha256 SHA256 --old-tree-sha256 SHA256 \
  --classifications /ROOT_PRIVATE/retained.json --classifications-sha256 SHA256 \
  --helper-sha capacity=SHA256 --helper-sha stager=SHA256 \
  --helper-sha provenance=SHA256 --helper-sha retained=SHA256 \
  --helper-sha publisher=SHA256
```

The exact pre-staged source/archive paths are
`/var/tmp/proofofwork-deploy/proofofwork-ui-source-RELEASE`,
`/var/tmp/proofofwork-deploy/proofofwork-www-stage-RELEASE`, and
`/var/backups/proofofwork-ui/releases/proofofwork-ui-release-RELEASE.tgz`.
Receipts go to `/var/tmp/proofofwork-deploy/audit29-publish-RELEASE`.

The controller always passes `--defer-verified-retention`, preserving historical
hold markers and masked prune timers. Atomic exchange and rollback remain the
audited installed publisher's responsibility. If it refuses, the controller
checks the exact prior inode, complete root fingerprint and rollback provenance
before restoring previously active timers. An unproven result keeps the timer
hold and durable evidence for explicit inspection; it never attempts a second
unreviewed UI exchange.

Normal work is capped at 20 minutes. Failure recovery has a separate allowance
of at most 8 minutes; timer restoration and all commands share an immutable
29-minute controller lifetime inside the 30-minute cgroup. A timeout kills the
specific child process group. An owner SIGKILL cannot leave controller child
writers outside the systemd cgroup; durable pre-action receipts explain any
held services/timers. The controller never enables, disables, unmasks, resets
failed units, starts previously inactive timers, or removes recovery evidence.

After the controller succeeds, the release operator must separately verify
public HTTP, the connected-wallet/Desktop/AMO UI, protected current gates and
fresh capacity. Record actual results in the remediation audit; an invocation
or local fixture result does not prove production acceptance. Cleanup remains
the separately approved exact controller and is never implied by release.
