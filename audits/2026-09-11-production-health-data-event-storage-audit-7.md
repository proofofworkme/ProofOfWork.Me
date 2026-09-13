# Production health, data, event, and storage audit 7

Date: 2026-09-11.

Scope: read-only production and repository audit requested by the owner,
followed by an owner-approved emergency H7-01 production recovery attempt. The
emergency action only changed node VPS service environment drop-ins to raise the
canonical summary snapshot storage budget and restarted `proofofwork-api` and
`proofofwork-indexer-worker`. No production storage objects were deleted, no
database rows were manually mutated, no wallet/signing behavior was changed, no
UI changes were deployed, and no commit or push had been made at the time of
this addendum.

## Prior audit continuity

I reviewed the existing audit log set before assigning new findings:

- `2026-08-23-read-only-health-data-event-ui-audit.md`
- `2026-08-28-production-health-data-event-audit.md`
- `2026-08-30-production-health-data-event-storage-audit.md`
- `2026-08-31-production-health-data-event-storage-audit-2.md`
- `2026-08-31-storage-retention-node-manifest.md`
- `2026-08-31-storage-retention-ui-manifest.md`
- `2026-09-01-production-health-data-event-storage-audit-3.md`
- `2026-09-02-production-health-data-event-storage-audit-4.md`
- `2026-09-03-read-only-ui-ux-audit.md`
- `2026-09-04-amo-indexer-recovery.md`
- `2026-09-05-production-health-data-event-storage-audit-5.md`
- `2026-09-08-production-health-data-event-storage-audit-6.md`

The latest audit already tracks H5-03 scheduled node release verifier failure,
H5-06 readiness/convergence instability, H5/H6 UI and read-model issues, and
the exact UI/node storage cleanup candidates. This log does not duplicate those
items. The current live blocker below is a concrete new cause inside the H5-06
readiness family: the canonical summary snapshot payload now exceeds the live
configured byte budget.

## Executive status

Production is not fully healthy.

The system is failing closed rather than serving stale canonical math. Static UI
shells are reachable, and the underlying database/event tables look structurally
healthy, but strict API readiness and fresh canonical-summary endpoints are red
because the worker cannot store a current compact canonical summary snapshot.

Initial live blocker:

- The production worker repeatedly fails with
  `POW_CANONICAL_SUMMARY_STORAGE_BUDGET_EXCEEDED`.
- Current attempted canonical summary payloads around block `966433` are
  `16,822,779` to `16,822,787` bytes.
- The configured live budget is `16,777,216` bytes.
- `/health` returns HTTP `503`.
- Fresh `/api/v1/consistency` and `/api/v1/work-floor` return
  `The canonical ProofOfWork summary snapshot is catching up.`

This is the correct fail-closed behavior for the math layer, but it means the
application cannot currently claim every event, address, ID, credit, listing,
and mempool state is being rendered freshly across the UI.

Emergency H7-01 recovery attempt:

- At the owner's explicit approval, node VPS systemd drop-ins were installed at
  `/etc/systemd/system/proofofwork-api.service.d/zzzz-h7-canonical-summary-budget.conf`
  and
  `/etc/systemd/system/proofofwork-indexer-worker.service.d/zzzz-h7-canonical-summary-budget.conf`.
- Both services now inherit
  `POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES=20971520` and
  `POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_SQL_TEXT_MAX_BYTES=23592960`.
- Earlier same-window `60-h7-canonical-summary-budget.conf` drop-ins were
  removed after inspection showed a later API drop-in could override them; the
  final `zzzz-...` names are the active recovery configuration.
- `systemctl daemon-reload` was run, then `proofofwork-api` and
  `proofofwork-indexer-worker` were restarted at
  `2026-09-11T12:02:01Z`.
- Both services returned to active/running state after the restart.

Current live blocker after H7-01:

- Production remains fail-closed at HTTP `503`.
- `/health` and `/health/live` stayed `ok:false` from
  `2026-09-11T12:02:16Z` through `2026-09-11T12:08:44Z`.
- The API reported indexed height `966500` while Core tip was `966502`.
- Fresh `/api/v1/consistency?network=livenet&fresh=1` returned
  `The canonical ProofOfWork index is rebuilding or no longer matches Bitcoin Core.`
- Worker logs now refuse cycles with
  `Canonical indexing is faulted; run a new supervised canonical rebuild.`
- `proof_indexer.meta` key `canonical:fault` is active at height `966500` with
  `type:"reorg"`, expected checkpoint hash
  `000000000000000000011ada8812e1b93daabaea5f4f90b1920e8212a11a36ca`, and
  Bitcoin Core actual block hash
  `000000000000000000002b9b942ee9ae9da493eed410ea71340241ea3e273d0a`.

This new blocker is H7-02. It is not safe to clear manually. The documented
repair path is a supervised canonical rebuild from the protected replay floor,
which mutates derived index tables and clears derived API JSON caches. That
requires a separate explicit approval because the H7-01 approval prohibited
database row mutation.

## VPS health

UI VPS `root@77.42.91.106`:

- Host: `ubuntu-4gb-hel1-1`.
- Uptime sample: `126 days`.
- `/dev/sda1`: `38G` size, `20G` used, `17G` available, `54%` used.
- Inodes: `3%` used.
- Memory: `3.7Gi` total, `3.1Gi` available, no swap.
- `caddy.service`: active/running.
- `proofofwork-ui-storage-health.service`: last run succeeded.
- `proofofwork-ui-release-prune.service`: failed intentionally in dry-run mode
  because it found classified archives that would be pruned only with explicit
  approval.

Node/API VPS `powadmin@65.108.122.87`:

- Host: `pow-bitcoin-01`.
- Uptime sample: `124 days`.
- `/`: `98G` size, `23G` used, `71G` available, `25%` used.
- `/data`: `1.7T` size, `1.2T` used, `345G` available, `78%` used.
- `/data` inodes: `1%` used.
- Memory: `124Gi` total, `108Gi` available; swap `15Gi`, `746Mi` used.
- Active/running: `bitcoind`, `electrs`, `postgresql@16-main`,
  `pg_receivewal@16-main`, `proofofwork-api`.
- `proofofwork-indexer-worker`: active process. Before the emergency budget
  change it failed cycles because the canonical summary snapshot exceeded the
  configured compact payload budget. After the budget change, it fails earlier
  because `canonical:fault` is active at height `966500`.
- `proofofwork-node-storage-health.service`: failed by design at the documented
  `/data` warning line; recent samples report `/data` at `78%` and warn that
  storage runway is narrowing.
- `proofofwork-node-release-health.service`: still fails with
  `CRITICAL live node tracked mode is unsafe or differs from Git: .githooks/commit-msg`.
  This is H5-03 continued, not a new finding.

## Storage inventory

UI storage:

- `/var/backups`: `17G`.
- `/var/backups/proofofwork-ui`: `16G`.
- Major UI backup buckets:
  - `rollbacks`: `6.0G`.
  - `classified-rollback-roots`: `3.6G`.
  - `rollback-classifications`: `2.6G`.
  - `releases`: `2.1G`.
  - `rollback-roots`: `790M`.
- Current release prune dry-run would prune the same already-classified release
  archives recorded in audit 6:
  - `proofofwork-ui-release-89736d9d42f7-20260902T222258Z.tgz`
  - `proofofwork-ui-release-fb4d08ab973e-20260902T155203Z.tgz`
  - `proofofwork-ui-release-5f3ab07b1ddd-20260902T145844Z.tgz`

Node storage:

- `/data/bitcoin`: `907G`.
- `/data/proofofwork-postgres-backups`: `163G`.
- `/data/electrs`: `60G`.
- `/data/proofofwork-postgres-tablespaces`: `23G`.
- `/data/proofofwork-audit5-restore-20260905T144615Z`: `18G`.
- `/data/proofofwork-audit5-restore-20260905T174233Z`: `21G`.
- `/data/proofofwork-audit5-safeguard-20260905T181729Z`: `11G`.
- `/data/proofofwork-release-backups`: `9.3G`.
- `/data/proofofwork-recovery`: `3.6G`.

No cleanup was performed. The two audit5 restore clusters and UI release-prune
targets are already classified in prior audits. The audit5 safeguard dump and
large PostgreSQL backup set should be classified before any deletion decision.
Active Core, electrs, PostgreSQL tablespace, WAL, canonical transition witness,
and protected audit/recovery evidence must not be treated as stale merely
because they are old or large.

## Database health

Read-only PostgreSQL checks against `proof_indexer`:

- Database size: `23 GB`.
- Largest relation: `work_amo_block_transitions`, `22 GB`, `6788` estimated
  live rows. This is large active math witness state, not stale data.
- `ledger_snapshots`: `832 MB`.
- `events`: `117 MB`.
- `transactions`: `76 MB`.
- Invalid indexes: `0`.
- Not-ready indexes: `0`.
- Unvalidated constraints: `0`.
- Lock waiters: `0`.
- Idle-in-transaction sessions: `0`.
- Deadlocks: `0`.
- Replication slot `pg_receivewal_service`: active, retained WAL about `14 MB`.
- PostgreSQL query-health samples after one short contention warning returned
  zero lock waiters and zero idle transactions.

## Event and math health

Stored event/database checks:

- Canonical block coverage in the indexer: heights `948000` through `966433`.
- Confirmed transactions: `25,124`.
- Pending transactions: `37`.
- Confirmed events: `25,801`.
- Pending events: `37`.
- Total events: `26,018`.
- Event participant rows: `127,582`.
- Event reference rows: `55,251`.
- Events without transaction rows: `0`.
- Confirmed events missing block height: `0`.
- Confirmed valid events missing canonical position: `0`.
- Confirmed transaction block reference misses: `0`.

ID checks:

- ID records: `505`.
- Duplicate display-case ID rows: `0`.
- Missing registration event rows: `0`.
- Missing last-event rows: `0`.

Credit checks:

- Credit definitions: `238`; confirmed definitions: `238`.
- Credit balance rows: `404`.
- Negative confirmed balances: `0`.
- Fractional confirmed balances: `0`.
- Fractional pending deltas: `0`.
- `WORK` confirmed supply equals declared max supply exactly:
  `210000000000000000000000`.
- A naive `sum(balance) > max_supply` check flags `POWB` and `INCB`, but both
  are canonical synthetic uncapped definitions with `metadata.maxSupplyModel =
  "uncapped"` and `max_supply = 0`. This is not a supply overflow.

Mail checks:

- Mail rows: `616`.
- Confirmed mail rows: `615`.
- Dropped mail rows: `1`.
- Mail rows missing event rows: `0`.
- A simple equality probe found many rows where `mail_items.body_text` equals a
  Log detail string. That equality alone is not proof of bad projection because
  some source bodies can legitimately match display detail; a semantic replay
  check is required before calling this a defect.

AMO transition checks:

- `work_amo_block_transitions`: `6813` rows.
- Heights: `959621` through `966433`.
- Height gaps: `0`.
- Previous-block-hash mismatches: `0`.
- Opening/previous-closing value mismatches: `0`.
- Decreasing values: `0`.
- Bad completeness flags: `0`.
- Q16 model rows: `5833`.

Pending/mempool state:

- Last successful worker cycle at `2026-09-11T00:13:39Z` reported pending event
  health `ok:true`, `globalUnresolved:0`, `q16PendingUnresolved:0`, and
  `q16ParentMembershipCount:37`.
- Current database pending rows are still `37`.
- Because the worker is now blocked by H7-01, this audit cannot assert a fresh
  published pending/mempool witness after block `966433`.

## Route and render health

Checked Caddy locally on the UI VPS with hostname/SNI resolution to
`127.0.0.1`.

Static roots:

- `www`, `id`, `desktop`, `browser`, `boost`, `amo`, `credit`, `wallet`,
  `work`, `infinity`, `inception`, `log`, `growth`, and `computer` returned
  HTTP `200`.
- `marketplace.proofofwork.me` returned HTTP `308` to
  `https://amo.proofofwork.me/`, matching the current marketplace/AMO routing.

Health endpoints:

- All checked host `/health` routes returned HTTP `503`, because they proxy to
  the same fail-closed API state.

Local public DNS from the audit workspace failed with
`Could not resolve host: computer.proofofwork.me`; after that point, external
public re-sampling from the workspace was not used as evidence.

## Local contract checks

Passed locally at repository HEAD `40c7fa0b0f72ff60d8b399e3f8a7d79325b3ee17`:

- `npm run check:live-data`
- `npm run check:api-truth`
- `npm run check:work-precision`
- `npm run check:bond-exact-arithmetic`
- `npm run check:node-ops`
- `npm run check:hardening`

Incomplete/failed local verification:

- `npm run check:ui-ops` timed out in the local dependency compatibility
  regression fixture while spawning `/usr/bin/python3`. This is logged as a
  local verification failure, not as a live UI service failure.

## H7-01: canonical summary snapshot payload exceeds live compact storage budget

Severity: high, live availability and freshness.

Continuity: this is a concrete current root cause under the existing H5-06
readiness family, not a duplicate of H5-06's earlier generic convergence
diagnosis.

Evidence:

- Worker logs since `2026-09-11T00:00Z` included `123` occurrences of
  `POW_CANONICAL_SUMMARY_STORAGE_BUDGET_EXCEEDED`.
- Failing payload sizes observed: `16,822,779`, `16,822,783`, and
  `16,822,787` bytes.
- Live configured budget:
  `POW_INDEX_CANONICAL_SUMMARY_SNAPSHOT_MAX_BYTES=16777216`.
- Worker failure occurs in `assertCanonicalSummarySnapshotStorageBudget` before
  storing the current canonical summary snapshot.
- Last successful worker cycle recorded `2026-09-11T00:13:39Z`.
- The worker later reached checkpoint height `966433` but failed before current
  snapshot publication.
- `/health` and `/health/live` returned `ok:false`.
- Fresh canonical summary endpoints returned a catching-up error instead of
  serving stale data.

Impact:

- Correctness guard is working: stale current math is not being served as fresh.
- Production readiness is red.
- UI shells render, but data-heavy views cannot truthfully present fresh
  canonical summary, work-floor, marketplace, growth, infinity, inception, or
  cross-ledger consistency state until a current snapshot can be published.
- Event rows and AMO transition witness tables do not show corruption in this
  audit, but the live app is not fully healthy because fresh published summary
  state is blocked.

Recommended repair path:

1. Prefer a compact-summary payload reduction that removes or splits nonessential
   repeated preview fields while preserving exact source hashes, totals, current
   summary coverage, and the Q16 sufficient-state witness.
2. Treat simply raising the byte budget as an explicit protocol/ops decision,
   not a silent hotfix. If it is used as an emergency runway, prove the SQL read
   gate, API read budget, storage budget, and parity contracts before and after.
3. Required verification after any fix:
   `check:live-data`, `check:api-truth`, `check:worker-containment`,
   `indexer:parity`, `audit:ledger`, `audit:computer-events`,
   `check:marketplace-regressions`, `check:mail-regressions`, and fresh
   production `/health` plus representative UI surface reads at one exact tip.

Emergency action taken:

- Compact snapshot budget raised from `16777216` bytes to `20971520` bytes.
- SQL text snapshot read budget set to `23592960` bytes.
- API and worker restarted successfully.
- H7-01 could not be fully verified through snapshot publication because H7-02
  now blocks canonical indexing before the worker can complete a fresh cycle.

## H7-02: active canonical reorg fault at height 966500

Severity: high, live availability and canonical correctness.

Continuity: this is a new post-H7-01 blocker exposed by the emergency restart,
not a duplicate of the summary byte-budget failure.

Evidence:

- `proof_indexer.meta` contains active `canonical:fault` with
  `type:"reorg"`, `phase:"checkpoint"`, `status:"fault"`, and
  `height:966500`.
- Stored expected hash:
  `000000000000000000011ada8812e1b93daabaea5f4f90b1920e8212a11a36ca`.
- Bitcoin Core actual hash:
  `000000000000000000002b9b942ee9ae9da493eed410ea71340241ea3e273d0a`.
- `canonical:rebuild` metadata records a completed
  `pwt-range-replay` through height `966500` using the stale expected hash.
- Worker cycles now stop with
  `Canonical indexing is faulted; run a new supervised canonical rebuild.`

Impact:

- The API is behaving correctly by refusing fresh canonical claims.
- The app remains down across health-gated surfaces until the canonical index is
  rebuilt against the current Core chain.
- Manual fault clearing would hide the correctness problem and must not be used.

Required repair path:

1. Back up PostgreSQL and active service/config files.
2. Stop `proofofwork-api` and `proofofwork-indexer-worker`.
3. Run the documented supervised canonical rebuild with
   `POW_INDEX_BACKFILL_CANONICAL_REBUILD=1` and
   `POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT=948000`.
4. Clear only derived API JSON caches required by `OP_RETURN_INFRASTRUCTURE.md`.
5. Rebuild canonical projections through current Core tip.
6. Generate a fresh full ledger/canonical summary snapshot.
7. Restart services and require successful production health, parity, ledger,
   event, marketplace, mail, and UI-surface verification.

## Carry-forward findings, not duplicated

- H5-03 continued: scheduled node release verifier still fails because the live
  checkout mode differs from Git at `.githooks/commit-msg`.
- Node `/data` storage warning continued: `/data` is at `78%`, above the
  documented warning threshold but below the critical threshold.
- UI release prune dry-run continued: it identifies classified prune candidates
  but exits nonzero until explicit approval is given.
- H5/H6 UI/read-model findings remain governed by audit 5 and audit 6. This
  pass did not reassign them or claim them fixed.

## Final position

The chain-derived database looks internally coherent within the checks above:
no structural database corruption, no invalid indexes, no broken event
relations, no ID registry join gaps, no negative/fractional credit balances, no
AMO transition gaps, and exact local math contracts pass.

The application is still not fully healthy. H7-01's emergency budget runway has
been installed, but current canonical publication is now blocked by H7-02, an
active canonical reorg fault at height `966500`. Strict health and fresh summary
reads fail closed as designed. Storage is not full, but node `/data` is again
over warning level and should be handled before the next large
recovery/deployment cycle. No stale or backup data was removed in this audit.
