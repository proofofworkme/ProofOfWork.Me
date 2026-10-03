# Audit30 separate physical/WAL recovery proposal

This is a gated implementation candidate. It has not been installed, activated,
or accepted against production. The approved remaining-phase receipt authorizes
preparation; a final reviewed activation receipt and exact raw plans are required
before the new root, slot, units or physical/WAL files are created. Existing
logical backups, pins, held records, masks, physical paths and native units remain
preserved. No cleanup, expiry, compression, timer or automatic restart is added.

The read-only baseline `91f8b632dcfcef746a9193019929c5ef835d1867881b10cf4aee1d062dae726e`
shows the existing effective `max_slot_wal_keep_size=16384MB`, `wal_level=replica`
and `archive_mode=off`. There is no proposed production configuration change or
restart. Legacy mount evidence `9b74d3c77613f38cba2f5c094aa9bcd29d6eafd8fd75e22823cb5d5039681946`
shows `/var/backups/postgresql` mounted from a deleted, empty physical directory.
Neither that alias nor the native wrapper's `expirebasebackups` action is used.

The new root is `/data/proofofwork-postgres-recovery-audit30`, with private
`wal`, `bases`, and `evidence` directories. Each is canonical postgres:postgres
0700 on the same allocation domain. Admission requires root-side inode/mount
proof that it is a new distinct directory, not a symlink/bind alias to any legacy
or live path. The plan pins its device/inode/ownership; the service repeats those
checks and refuses nested mounts. The ordinary node prune mask remains exact.
Root-side preflight/final receipts must separately bind the root0600 generic
hold bytes because the unprivileged service does not relax their permissions.

`reserve-slot.sql` is one explicitly approved creation-only operation for
`pow_audit30_receivewal`, with immediate WAL reservation. A collision refuses;
there is no slot reuse/drop. The receiver uses this slot, `--synchronous`, local
Unix authentication, immediate durable flush feedback, five-second feedback,
and `--no-loop`. This does not change primary commit/quorum requirements. Any
matching application name or wildcard in `synchronous_standby_names` refuses.
The existing 16GB slot cap limits retained source WAL at checkpoint boundaries;
it is not a byte-exact quota or a guarantee against live-root exhaustion. A lost
or unreserved slot, stale receiver feedback, service/source drift or storage
failure stops the new receiver and preserves its evidence. It never drops the
slot, stops PostgreSQL/Core, or silently declares continuity restored.
The exact slot-creation receipt and initial reserved LSN are frozen into both
plans. Repeated archive censuses reject symlinks, unexpected names, wrong
timelines, truncated complete files or missing closed segments from that
reservation through the receiver's last closed durable-flush segment. This is
metadata continuity monitoring; payload hash/replay validation remains a later
acceptance gate, and a current `.partial` file cannot certify a target.

One explicit base backup uses `--format=plain --wal-method=stream`, a temporary
base-backup slot distinct from the receiver's active slot, a spread checkpoint,
20MB/s data-transfer limit, SHA256 manifest, default fsync, and `--no-clean`.
Every nondefault tablespace must be freshly enumerated and mapped into
`bases/{runId}/tablespaces/{oid}`. Unexpected location or symlink refuses. The
candidate validates `pg_verifybackup`, manifest WAL ranges, private table-space
bindings and continued receiver health. It retains the base and manifest.

The aggregate base ceiling is 80GiB and the WAL ceiling is 32GiB. Admission
requires at least 100GiB plus both ceilings available on `/data`; every sample
requires 100GiB `/data` and 10GiB live-root free. Metadata/log evidence has a
separate 1GiB allowance. These are measured limits, not filesystem quotas:
five-second polling, bounded `du`, SQL/file fences and stopping latency permit
overshoot. Unit MemoryHigh/Max are 1GiB/2GiB; CPUQuota is 50%, CPU/IO weights10,
Nice15, TasksMax32. The bounded base job has a two-hour deadline and requires a
fresh 2h15m clear logical-backup window before taking the existing shared backup
lock. The continuous WAL unit holds no backup lock and adds no timer. A watchdog
is observed independently while work runs; its loss or unhealthy final shutdown
fails closed. All process stops are limited to subprocesses this controller
created within the new managed control group.

The bounded base also holds a separate creation-only
`.base-admission.lock`, exclusively and nonblocking with a frozen identity.
Under that lock `bases` must be empty: the approved operation creates one base,
not multiple concurrent bases or an implicit retry over retained partial work.
The initial receiver likewise requires empty `wal`; restarting after any retained
WAL requires a new reviewed continuation/coverage proof. Exact live service
identities are monitored, so an approved future application/service restart also
needs an explicitly reconciled receiver plan. These conservative stops are
operational constraints and do not imply a recovery objective has been met.

Final activation gates, in order:

1. Preserve fresh logical backup/hash/TOC, original last-verified pin, generic
   holds/masks, live service PID/invocation identities and all old native unit
   and configuration bytes. Census live physical allocated bytes and all
   tablespaces; the one base plus WAL and reserve must fit the fixed ceilings.
2. Independently review these candidates and the final managed-credential
   verifier. Freeze a new activation approval, exact file/package hashes,
   root0600 source plans, and per-unit raw plan SHA drop-ins. Root-owned package
   contains this controller and the separately reviewed frozen logical guard.
   The receiver package is `/usr/local/lib/proofofwork-audit30-recovery/receivewal`;
   the base package is `/usr/local/lib/proofofwork-audit30-recovery/basebackup/{runId}`.
   Each has its own adjacent `reviewed-plan.json`, root:root0600, and remains
   immutable. The credential is root:root0440 under a dedicated root0550 read-only
   tmpfs mount; environment, actual service/cgroup, typed D-Bus LoadCredential,
   source-plan location, package authority and pre/post bytes are attested by
   the independently reviewed frozen guard. There is no arbitrary `/etc` source
   exception or capability/permission change.
   No plan template or structural validator proves production acceptance.
3. Create the new root/directories/evidence jobs and private base-admission lock exclusively with before/after
   inode, mount, owner/mode and capacity receipts. Create the one slot with
   before/after system identifier/timeline/LSN/slot receipts. Install only the
   new candidate units/package/plans; do not enable a timer or old wrapper.
   Their `Requisite` dependencies require already active services and do not
   implicitly start PostgreSQL or the receiver when the base unit is requested.
4. Explicitly start the receiver, verify the exact unit namespace/resources,
   slot PID, Unix application identity, fsynced flush LSN, source cap and current
   timeline. Then explicitly run one base capture and `pg_verifybackup`; archive
   its manifest hash/WAL ranges and all interrupted/completed receipts.
5. Bind a later named/time/LSN target with a root-approved WAL-only operation if
   needed. Require complete fixed-size WAL segments for the entire base-start to
   target interval on the same system/timeline; partial segments alone do not
   certify a target. Hash/fence all recovery inputs, preserve source files, and
   restore into a separate nonaliased private job with no TCP or live-directory
   access. Pin copied tablespace mappings, disable primary connection/library
   execution, enforce resource/watchdog/PID fences, and require exact recovery
   target reached/paused plus snapshot-bound application/table/accounting oracle,
   amcheck, stopped private cluster and final live-service continuity.
6. Only actual successful target recovery plus ongoing WAL continuity receipts
   can support a production PITR acceptance statement. A base manifest or unit
   liveness cannot certify PITR, an RPO, current chain state, or physical checksum
   health of production pages (production checksums remain off). Archive/base
   retention and unattended restart require a separate reviewed scope; this
   proposal stops at measured capacity and never expires existing data.

PostgreSQL16 primary references: [pg_receivewal](https://www.postgresql.org/docs/16/app-pgreceivewal.html),
[pg_basebackup](https://www.postgresql.org/docs/16/app-pgbasebackup.html), and
[pg_verifybackup](https://www.postgresql.org/docs/16/app-pgverifybackup.html).

Preparation limit: the managed credential helper and complete candidate must
pass independent/native acceptance with final source hashes before activation.
No permission or capability weakening is authorized. Root-side activation and
later target recovery remain pending.
