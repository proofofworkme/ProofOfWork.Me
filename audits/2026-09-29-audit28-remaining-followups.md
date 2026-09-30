# Audit 28: remaining five follow-ups, prepared for review

Date: 2026-09-29 America/Toronto; preparation observations continue into
2026-09-30 UTC. This record supplements the completed initial execution;
it does not retrospectively authorize further production changes.

The user approved local preparation and bounded verification of these five
areas, and separately approved the exact pinned isolated logical restore.
Production deletion, configuration changes, deployment, commits and pushes
remain gated on review of this package. No newly reviewed production item has
been deleted. The original cleanup manifest remains immutable.

## 1. Persistent retention protection

The three previously stopped timers are still enabled. This is a confirmed
reboot risk, not a completed persistent pause:

- UI: `proofofwork-ui-release-prune.timer`.
- UI: `proofofwork-ui-storage-prune.timer`.
- Node: `proofofwork-node-release-prune.timer`.

Prepared policy: retain all designated recovery and rollback sets without
age-based expiry; preserve the exact logical restore source by an explicit pin. Install a root-owned 0600 hold marker under a root-owned 0700
`/etc/proofofwork-retention` on both hosts. Persistently mask the three timers;
add a service condition preventing their associated services from running while
the marker exists. Manual pruning helpers also refuse `--apply` while held.
The UI publisher automatically defers verified retention while held; it can
still publish and preserve complete rollback roots.

The installed timers are actual files under `/etc/systemd/system`, so a simple
`systemctl mask` will conflict with them. Preserve their exact pinned bytes
before replacing only those three files with `/dev/null` symlinks. Do not use a
broad force operation. Exact paths, prior hashes, proposed contents and tool
hashes are in the adjacent remaining-followups manifest. The host-specific UI
pruner candidate preserves its current accepted target list rather than adding
the node's keep-two option to the UI host.

The new read-only retention checker runs as root and requires both a safe marker
and masked/inactive timers. It detects the current enabled/inactive state as
unhealthy. A prepared read-only checker service/timer runs every five minutes with a
32 MiB memory cap, 10% CPU quota, 16 tasks and a 20-second lifetime. Its exact
units are listed in the manifest and require production approval. Results stay
in the journal; no outbound alert delivery is included. Name a destination and
policy before adding notifications. The monitor must be installed after the exact
logical pin-aware helper it attests, so no stale executable can appear protected.

A further exact dependency was verified: the installed logical-backup helper
keeps only the newest verified dumpset. Its next scheduled run is **2026-09-30
03:18:48 UTC (2026-09-29 23:18:48 Toronto)**. A successful new backup can retire
the pinned September 29 source. The corrected restore cannot simply select a
replacement dump if that happens.

Prepared node change: root-owned 0644
`/etc/proofofwork-postgres-logical-backup.pins` contains exactly
`proof_indexer-20260929T031853Z.dumpset`. The guarded logical-backup helper still
creates/verifies fresh backups, preserves this exact set, and applies existing
verified retention to other unpinned sets. A missing or unsafe policy preserves
all old sets rather than deleting with uncertain pins. Install the policy first
and replace the exact pinned helper under its existing exclusive nonblocking
backup lock while the service is inactive; **do not stop or pause backups**.
The root checker binds the guarded helper hash, the exact policy and source
presence, avoiding a false green result from a pin file ignored by an old helper.
Seven pin-policy regressions and the existing hardening contract pass.

This is an additional named production target in the manifest; **it has not
been installed**. Approval before the next successful backup would preserve the
original source for a corrected test. Otherwise revalidate and stop if the
source disappears. Do not treat existing preparation approval as authorization
to change backup retention or copy a new source silently.

Keep the marker and masks until a separately reviewed, pin-aware retention
policy proves recovery equivalence. Removing the marker or resuming retention
requires a new exact approval. Tool rollback must not silently restart pruning.

## 2. Wallet and AMO performance

Prepared client changes in `src/App.tsx`:

- Every complete token-listing pagination, including wallet-owned listing reads,
  has a 120-second overall deadline propagated into HTTP fetch/body consumption.
  Existing per-request deadlines and the 100-page safety ceiling remain.
- AMO's summary plus complete-book hydration shares one 120-second deadline
  across at most two attempts, rather than three independent full attempts.
- AMO cancels the old request when wallet, network or workspace changes.
  Wallet hydration shares its deadline with pending-seal reads and cancels
  obsolete wallet/workspace and token-selection requests before saving results.
  Cancellation cannot trigger another retry or publish a completed snapshot.
- Fresh and caller-cancelled books do not join an unrelated in-flight request.
  Ordinary non-fresh sharing and exact indexed-at/checkpoint cache fences remain.
- Partial verified pages remain previews; every existing checkpoint, count,
  authority digest, Core UTXO, membership and confirmed-state gate remains.
  No public book becomes signing authority. Exact signing rechecks remain.

This bounds wasted work and waiting. It does not claim faster server computation
or change protocol fees, arithmetic, supply, confirmations or settlement.
The existing last-good/failed-read containment is preserved.

A four-request sequential production baseline took 18.46 seconds total, with a
30-second per-request ceiling and a 120-second run budget. Both summaries were
HTTP 200 and reconciled to direct Core before/after at height **969236**, hash
`000000000000000000010673be0bbadcddc01435c1732aa17ef4795e5ab8fa0d`.
WORK took **7367 ms**, 1,609,151 payload bytes; AMO took **9127 ms**, 2,022,087
payload bytes. These are observations during an isolated restore, not an
unloaded benchmark, p95 or evidence of an improvement from undeployed code.
Existing slow-route findings remain open.

Recommended next investigation: measure server phases and complete-book wall
time, separate serialization from Core verification and relational reads, and
compare identical checkpoints. Preserve fail-closed Core authority during tip
movement. Any server cache, SQL index, pool or schema change needs its own tested
patch and production approval. Do not suppress refusals to improve metrics.

## 3. Monitoring improvements

The installed node monitor still emits the historical
`route-latency-slow-correct` label; the repository correction was not installed
at the monitor's executable path. This is an unresolved prior correction, not a
new duplicate correctness finding.

Prepared monitor replacement uses the neutral `route-latency-warning` label,
records payload bytes, exposes `correctnessOk` separately, and makes top-level
`ok` and its process exit status fail on critical latency. Warning and critical
thresholds remain 2500/10000 ms. A slow response therefore does not acquire a
claim of correct accounting merely through its label, and critical latency no
longer produces an operationally green result.

No raw wallet addresses or new raw response data are introduced by these fields.
The existing monitor's readiness/authority checks stay in place. Retention
state is checked independently by the new root read-only checker. Preserve
failed production oneshot evidence; never blanket-reset failed units.

Follow-up monitoring policy: maintain existing rolling 5xx, p95 and payload
thresholds; count authority/checkpoint refusals as unavailable; distinguish
active failures from historical failures. The prepared recurring checker units require explicit production approval.
External notifications still require a named destination and policy.

## 4. Database assurance

Five-second, read-only live catalog checks found zero invalid/unready indexes
and zero unvalidated constraints. Live database size was **37,724,707,863 bytes**;
`work_amo_block_transitions` occupied **36,472,152,064 bytes** (about 96.7%).
The estimated live-row count of 9604 is a statistics estimate, not a count or a
space-reclamation guarantee. Live page checksums remain **off** (existing H18-06).
No schema, table, database setting, data, WAL or backup policy was changed.

The exact separately approved isolated restore uses:

- Backup: `/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset`.
- Dump: 19,363,782,935 bytes; SHA256
  `6bb26e725f1178f25720eadc46801975b987587578fbf7018203cddc65601031`.
- Job: `/data/proofofwork-audit28-restore-20260929T213000Z`.
- Unit: `proofofwork-audit28-isolated-restore-20260929T213000Z`.
- Caps: 4 GiB memory, one CPU, IOWeight 10, Nice 10, TasksMax 64,
  90-minute unit lifetime, 55-minute restore timeout, 15-minute checksum timeout.
- Storage: maximum 80 GiB job; 100 GiB `/data` free-space floor; initial root
  free-space minimum 10 GiB. Its reviewed script monitors job/data limits.
- Private 0700 Unix socket, port 55432, no TCP listener. No globals, grants,
  owners or production tablespace paths are restored. Never print role hashes.

The initial staging path was not traversable by postgres: the unit failed with
203/EXEC before opening the dump. The launcher failure journal was preserved
outside the empty job. Only that temporary failed unit was cleared. The unchanged
script was restaged as `/var/tmp/audit28-restore-logical.sh`; backup, job and
resource limits stayed identical. Both actual backup checksums passed on retry.

The restore finished at **2026-09-30 02:09:27 UTC**. Data/schema restoration and
offline page verification passed: 1470 files, 4,437,025 blocks, **zero bad
checksums**, zero invalid indexes and zero unvalidated constraints. The isolated
cluster is stopped; its socket and postmaster PID file are absent. Restored
counts: 26,035 transactions, 26,648 events, 238 credit definitions, 435 credit
balances, 20,289 ledger snapshots and 9470 transitions (all database networks;
these are backup-snapshot counts, not current livenet parity claims).

**New P1 finding: continuous storage-watchdog assurance is incomplete.** The
watchdog exited at 01:44:34 UTC when `du` encountered WAL files being recycled.
Its inherited `set -e/pipefail` exited the background subshell; the parent did
not check liveness. CPU, memory and runtime controls remained enforced. Final
job allocation was 37,423,046,656 bytes and free `/data` space 436,713,209,856 bytes;
no measured storage breach was found, but sampling does not certify continuous
enforcement. The data/schema/page result must not be presented as a complete
resource-guard pass.

The original reviewed script stays unchanged. A separately prepared
`deploy/audit28/restore-logical-storage-guarded.sh` retries transient allocation
reads at most three times, fails closed on read errors or watcher exit, checks
watcher liveness between stages, and retains failure evidence. Seven bounded
local regression cases pass, including intentional versus unexpected shutdown.
No corrected full restore was executed: the user's stop boundary is respected.
A fresh full test requires separate approval of the exact new job/script pin in
the manifest, the same backup and caps, and a clear backup-lock window. Preserve
both original recovery data and its launcher/watchdog evidence.

Final direct Core was synced at height **969237**, hash
`0000000000000000000040c40549cdc7cf645bfd66432c1251d418739082a373`.
API health remained ready at that height with zero reported lag. Core, Electrs,
live PostgreSQL, API and indexer service identities remained active and unchanged.
Restore status and final evidence are recorded in the adjacent evidence JSON.
A logical restore can establish recoverability of this exact data/schema backup
and verify newly written isolated pages. It cannot certify production's
checksum-free physical pages, PITR/WAL continuity, global roles/ACLs, external
service dependencies, or chain replay equivalence of the backup checkpoint.
Preserve the full isolated job and its results after shutdown.

A future live-checksum or physical-integrity migration needs a separately pinned
physical backup/restore rehearsal, downtime window, disk budget, WAL and role
coverage, and an exact rollback plan. No live checksum enablement, VACUUM FULL,
REINDEX, physical-file removal or replay pruning is part of this approval package.

## 5. All 816 held items

Every original held observation has a fresh host-qualified lstat result and an
explicit retention class and retain decision in `2026-09-29-audit28-held-review.json`. All paths still
exist; **402** observations changed metadata. Inode, size and mtime drift,
including rotating operational logs, prevents reuse of old deletion fingerprints.
Nested paths are observations, not independently additive storage estimates.

The review retains:

- 481 incident/security log observations: preserve incident history; select
  retention and readers before approving exact rotated-file deletion.
- 139 recovery/replay/database/backup observations: no proven equivalent
  replacement or complete dependency release yet.
- 92 historical transport/helper/receipt observations: preserve provenance and
  references until unique content and replacement evidence are established.
- 79 formerly unclassified observations: bounded directory/provenance inspection
  now classifies them as managed recovery containers, historical UI/node rollbacks,
  protocol/configuration migration evidence, live API caches and prior restore
  evidence. No full archive-equivalence or dependency-release proof exists.
- 19 active process dependencies: no deletion eligibility.
- 6 current/designated predecessor release dependencies: no deletion eligibility.

The exact proposed **production deletion manifest is empty**. These retention
decisions are a conservative review outcome, not a claim that all content has
been proved equivalent. Completing cleanup does not mean deleting all held data.
This review does not certify any held item as safe to remove. The bounded
process scan positively confirms active logs and the INCB recovery database;
node descriptor enumeration hit its per-process cap, so absent references are
not absence proofs. The live API explicitly still configures the held cache root.

Preserve UI releases `db853f434f9b-20260930T011125Z`,
`3bc6c9d44e00-20260929T200127Z`, `0e767c69e785-20260929T165314Z`, all associated
complete roots, sidecars and source dependencies. Preserve node releases
`db853f4-20260930T011125Z`, `3bc6c9d-20260929T200136Z`,
`d2c0afa-20260929T160642Z`, their provenance/checksums and the exchanged predecessor
checkout. Preserve all active INCB recovery dependencies and new restore data.
New artifacts created by the prior deployment are outside the original 816;
they receive no implicit deletion approval.

## Verification and deployment/rollback gates

TypeScript and all 15 isolated published-surface builds pass; NFT matches Computer. Client cancellation/deadline/retry tests,
retention guard tests and operational monitor tests pass. Existing 43 client-read
containment checks, 10 API deadline/cancellation cases, WORK Q16, exact bond and
whole-proof fee contracts pass. The initial local HTTP fixture was blocked by
the sandbox; rerunning only that isolated fixture with loopback access passed.
The existing large App bundle warning remains. No speed improvement is claimed.

Before production execution:

1. Review the final diff, the exact remaining-followups manifest, held-review
   manifest and restore evidence. Revalidate installed tool/timer hashes,
   release identities, absence of proposed new targets and recovery references.
   Stop for material drift; do not adapt a hash pin silently.
2. Preserve exact old tooling/timer bytes and receipts under designated rollback
   evidence. Install the approved logical-backup pin/guard only under its idle
   backup lock, without pausing backups; revalidate that the source still exists. Create the hold markers first; install service conditions and masks;
   reload systemd and verify masked/inactive state. Do not restart live databases,
   Core, Electrs or retention services. Install only approved tool replacements.
3. If application publication is approved, bind the already-tested source and
   per-surface bytes to the final clean Git commit and complete UI archive.
   Preserve the current complete UI root and all designated predecessors; use
   the reviewed full-root UI publication workflow, never partial assets. These
   are UI-only changes compatible with the current API; no API/indexer source
   replacement or restart is necessary. Stop if compatibility requires a backend
   change, rather than extending scope. Name the resulting commit, release ID
   and archive/provenance hashes before publication.
4. Verify Core checkpoint reconciliation, route response/status/latency, complete
   listing fences, fresh signing refusal behavior and all affected surfaces.
   Computer is reviewed last. No wallet broadcast or purchase is needed.
5. On authority, readiness, asset or protocol failure, restore the pinned prior
   complete release and exact tooling. Keep retention holds/masks in place.
   Rollback is not permission to delete failed release or restore evidence.
6. Perform mandatory hygiene fix/check and final diff review. Commit and push only
   after explicit approval of these final changes; never bypass hooks.

Unresolved dependencies before an application execution package can be fully
pinned: the final reviewed clean Git commit and its publisher-provenance/archive
binding. All per-surface build hashes already exist in the build evidence. No production application
execution is requested until those concrete artifacts exist. Independent
retention/monitoring tooling can be approved by the exact prepared hashes now.
No further deletion, retention resume, database migration or external alert
delivery is requested. The corrected isolated restore is an additional explicit
approval gate; it has not been silently rerun. Further storage eligibility work remains read-only/preparatory until
separate exact manifests establish safe redundancy.

The logical-backup rollback uses the exact retain-all fallback in the manifest,
continuing new backup creation and verification. Never restore its unguarded
predecessor while the original restore source is required. Eight pin-policy and
fallback regressions pass. Final client deadline/context tests cover 14 cases.

## Approved execution update — 2026-09-30 UTC

The user approved the next production-tooling, corrected-restore and commit/push
steps. At 02:41 UTC, exact tooling and timer fingerprints matched; the original
backup source remained present. Both UI retention timers and the node release
retention timer are now persistently masked/inactive with root-owned hold markers
and service conditions. Prior tools/timer bytes and link receipts are preserved
at the manifest's exact evidence roots. The logical-backup pin and guard are
installed; scheduled backup creation was not paused. UI retention monitoring passes.
The corrected restore remains approved but awaits a clear backup-lock window
after the scheduled 03:18:48 UTC backup. No storage deletion was performed.

The first hardened node checker failed because its empty capability set could
not inspect the postgres-owned 0700 backup source, although direct root execution
passed. The failure journal and original unit were preserved. The user separately
approved exact candidate `deploy/audit28/retention-protection-node-readonly.service`
SHA256 `0d128a66f97990fcd7184b1e6b995acc823f09ee6c2afae6a11708baa5062b43`.
Installed at 02:44 UTC, it allows only CAP_DAC_READ_SEARCH in its bounding/ambient
sets; strict read-only filesystem protection and all resource limits are unchanged.
The service now passes with exit zero. This explicitly approved candidate supersedes
the earlier prepared node unit for installation. The canonical node unit now
contains the same approved correction; its original pin and remote preserved
bytes remain historical baseline evidence. Receipt and amendment are in
the evidence JSON. All live application service processes remain unchanged;
production UI uses Caddy and the worker is proofofwork-indexer-worker.service.
Application source publication still requires review of its final commit-bound
archive. All 816 held observations remain retained; productionDelete stays empty.

### Newly identified existing condition — AUD28-FU-02 (P2)

A resource-bounded local source-extracted fault test injected a failed `df`
read into the logical-backup capacity watcher. The watcher exited with status 1
while the mock dump writer remained alive. The parent ignores the watcher exit
status. The watcher block is byte-identical to the pre-pin-guard helper, so this
is an existing latent condition, not introduced by the approved retention change.
No production backup, database or filesystem command was executed by the fixture;
no actual production reserve breach was observed. Preparation evidence includes
source/block/fixture hashes and the result. Existing audit logs were checked for
this specific finding; a prior broad backup-monitor inspection is not this
failure result. A bounded fail-closed watcher correction needs separate tested
source/configuration review before installation. The current exact source pin
and retain-all rollback protection must remain in place during any future fix.

### Exact UI publication and verification — 2026-09-30 UTC

The user explicitly approved complete UI release `bbb03cebb6c6-20260930T024800Z`,
commit `bbb03cebb6c66d91b8b033dbf4e732f11a0ad967`, archive SHA256
`c5258926d28133181d9f52d2c5b165ac58a2ec7baab2900f424635241ccfc7e4`.
Publication completed at 03:19:14 UTC after fresh Core-bound readiness passed.
The first attempt stopped before exchange for mandatory retained-root attestations;
exact retain-only attestations were supplied for already designated rollback roots.
The complete previous live root is preserved at
`/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-bbb03cebb6c6-20260930T024800Z`.
Independent provenance verification passed. All 15 surfaces returned HTTP 200
in the original order, with Computer last, no browser exceptions and no failed
static assets. Two served Computer DNS loading/failure/retry cases passed.
The browser made no write requests. Public Growth events and independent DNS AMO
statistics rendered. This does not establish connected-wallet or purchase signing
coverage; no broadcasts were performed. Caddy remains active at PID 3092586.
No API/indexer replacement or application restart occurred; backend remains db853f4.

At 03:24 UTC Core, Electrs and the canonical indexer reconciled at block 969245,
hash `000000000000000000020016a6354a66ab7e80e3e840ab429dbad02b02768ccd`,
with zero lag, matching summary coverage and readiness passing. Earlier transient
readiness/route-latency observations remain documented; this is not evidence of
a server-side speed fix. All 816 held paths remain present after publication.
Retention remains deferred; this phase deleted no storage items. The approved
corrected restore still waits for the scheduled backup to finish.

### Approved follow-up closeout — 2026-09-30 UTC

The scheduled logical backup completed successfully at 03:37:08 UTC. Its newest
set passed checksum/catalog verification, and the log explicitly records
preservation of the original pinned source. The corrected isolated restore was
admitted at 03:37:49 UTC with every reviewed pin and bound unchanged and passed
at 04:05:00 UTC. Backup checksums passed; the restored private database contains
26,035 transactions, 26,648 events, 238 credit definitions, 435 credit balances,
20,289 ledger snapshots and 9,470 transitions across the saved backup's scope.
There are zero invalid indexes and zero unvalidated constraints. Offline page
checks scanned 1,470 files and 4,437,022 blocks with zero bad checksums.

The job allocated 37,423,022,080 bytes, below its 80 GiB cap; available data space
at completion was 379,514,814,464 bytes, above the 100 GiB floor. Unit journal
reports 27min 8.129s CPU, 4.0 GiB peak memory and zero swap. Resource limits
were revalidated on admission; read-only progress records observed the watchdog
through import. No resource-failure marker exists; intentional watcher shutdown
is recorded. The private postmaster and socket are absent. Both original and
corrected restored datasets remain preserved, together with results and the
pinned backup. This verifies data/schema and offline restored pages only; it
does not establish roles/grants, PITR, production page checksums or complete
independent protocol replay. Different offline page totals between separate
restores do not establish a ledger discrepancy; logical counts match the original
restored backup and both page checks pass.

At final verification Core, Electrs, txindex, canonical indexer and summary
coverage reconcile at block 969252, hash
`0000000000000000000150faa48f43caf4acb67364b3208d969a5ef5fad832ee`;
API readiness passes with zero lag. Core, Electrs, production PostgreSQL, API,
indexer-worker and Caddy process IDs are unchanged. Final retention checks pass
on both hosts; all three pruning timers remain persistently masked/inactive.
All 295 UI and 521 node held paths remain present after scheduled backup and
restore. No storage item was deleted in this phase. Remote final receipts are
`/var/backups/proofofwork-ui/release-tooling/audit28-remaining-20260930T020000Z/completed-verification.json`
and `/data/proofofwork-audit28-retention-tooling-20260930T020000Z/completed-verification.json`.

The approved execution scope is complete, subject to repository closeout.
Remaining audit recommendations require separately reviewed work: fail-closed
logical-backup capacity monitoring (AUD28-FU-02), server-side wallet/AMO route
profiling and optimization, live database checksum/recovery assurance, and proof
of redundancy/dependencies before any held-item deletion. The scheduled backup's
existing unit has no memory/CPU/runtime cap and reported 18.8 GiB peak memory;
this is operational context for the backup-hardening recommendation, not a new
resource-policy change or an observed reserve breach. All retention decisions
remain retain with no automatic expiry. No fix for the newly found backup
watcher condition, deletion, database migration or alert destination was added.
