# Production comprehensive health and data-integrity audit 12 — 2026-09-17

## Audit date and scope

Read-only production audit performed 2026-09-17 UTC across the ProofOfWork
node/API VPS (`pow-bitcoin-01`, `65.108.122.87`), UI VPS
(`ubuntu-4gb-hel1-1`, `77.42.91.106`), public APIs, indexer worker, full node,
PostgreSQL, application logs, event projections, mempool readiness, storage,
backups, caches, temporary files, and the public surface audit path.

The prior audit chain through audit 11 was reviewed before assigning findings.
No production data, protocol records, ledgers, evidence, backups, services, or
files were changed, deleted, restarted, repaired, deployed, or committed as a
part of the inspection. This file is the only approved audit artifact.

## Systems and services checked

- Bitcoin Core, Electrs, PostgreSQL 16, ProofOfWork API, indexer worker, and
  PostgreSQL WAL receiver on the node/API VPS.
- Caddy, UI storage/provenance/retention timers, deployed UI roots, logs,
  backups, and temporary deployment files on the UI VPS.
- Public `health`, `consistency`, `ids-summary`, and Boost API endpoints.
- Worker canonical scan, Q16 replay/readiness, pending-event witness, and
  canonical summary log output.
- Existing audit scripts and prior audit findings; the bounded public surface
  command did not produce a usable result in this environment and is recorded
  as incomplete rather than passed.

## Health and capacity results

### Node/API VPS

- Root: 98G total, 25G used, 69G available, 26%.
- `/data`: 1.7T total, 1.2T used, 358G available, 78%; inode use 1%.
- Memory: 124GiB total, about 110GiB available; swap 15GiB with 373MiB used.
- Load average: 0.86 / 1.29 / 1.89; uptime 130 days.
- Core, Electrs, PostgreSQL, API, indexer worker, and WAL receiver were active.
- Failed units: `proofofwork-node-storage-health.service` and
  `proofofwork-node-release-health.service`.
- Large data areas included live Core data, mempool data (1.3G), recovery
  material (3.4G), backups (14G), PostgreSQL backups (568M in the visible
  top-level sample), and API cache/recovery/quarantine copies. Nested database
  and backup totals require a separately bounded inventory before cleanup.

### UI VPS

- Root: 38G total, 24G used, 13G available, 65%; inode use 4%.
- Memory: 3.7GiB total, 3.2GiB available; no swap.
- Caddy active; no general systemd failure was present, but
  `proofofwork-ui-release-prune.service` failed because the dry-run detected
  multiple complete-root rollback archives and would-prune candidates.
- `/var/backups/proofofwork-ui` uses 20G. `/var/log/journal` uses 370M;
  `/var/log/btmp` and `.1` together use about 239M. A 183M retained Q16/V7
  temporary root and a 159M preactivation tarball remain present.

### Capacity risk

The UI has not yet failed from exhaustion, but its 13GiB free margin is small
relative to the 20GiB retained backup set. Retention inspection remains failed
and deletion is intentionally disabled pending rollback classification. This is
the clearest repeat-risk for the previously observed full-disk outage. The node
`/data` warning threshold has also been crossed at 78%; live Core/database/
Electrs data must not be confused with disposable material.

## Database, node, indexer, and event results

- `proof_indexer` reported approximately 27GB.
- Largest relation: `work_amo_block_transitions`, approximately 26GB; this is
  canonical math-witness history and is not safe cleanup material.
- Other large relations included `ledger_snapshots` 389MB, `events` 148MB,
  `transactions` 102MB, `event_participants` 65MB, `tx_outputs` 60MB,
  `event_refs` 40MB, and `credit_listings` 40MB.
- No database corruption, invalid index, deadlock, or live-service failure was
  demonstrated in the sampled checks. The direct ad-hoc SQL cardinality probe
  used incorrect schema/quoting and is not treated as a result.
- Core RPC authentication was unavailable to the audit SSH account, so direct
  `getblockchaininfo`, `getindexinfo`, and `getmempoolinfo` calls could not be
  independently completed. The worker’s node-backed evidence reported tip and
  canonical checkpoint height 967355, Q16 readiness true, zero unresolved
  pending protocol events, and a 78,180-transaction mempool witness.
- Worker cycle at 02:13:54 UTC succeeded in 13.4s with zero consecutive
  failures, canonical scan success, `q16PendingUnresolved=0`, and
  `q16PendingWitnessReady=true`.
- Worker/API logs repeatedly showed marketplace-summary fallback and rejection
  of a smaller same-checkpoint scoped WORK listing book (823 current/open
  listings versus 783 materialized in the rejected scoped result). The fallback
  prevented publication of the smaller result, but the repeated behavior is a
  current performance/consistency warning and merits targeted investigation.

## API, event-tracking, rendering, and mempool status

- Public health returned `ok=true`, `ready=true`, `available=true`,
  `lagBlocks=0`, indexed through block 967355.
- Public consistency returned `ok=true`, `status=green`, indexed through block
  967355, with `missingLogEvents=[]`.
- Fresh ID summary returned 527 records at block 967355.
- Fresh Boost summary returned 4 items at snapshot
  `bcbbac7fcb305ff9a96222ba`.
- The worker persisted a bounded mempool witness with 78,180 transactions,
  154 pending-membership records, zero unresolved records, and a valid Q16
  witness. This supports correct pending/confirmed gating at the sampled
  checkpoint; it does not prove every unrelated mempool transaction is a
  protocol event.
- No new missing confirmed event, orphan participant/reference, duplicate,
  corrupted record, wrong confirmed/pending status, or UI rendering defect was
  established in this read-only checkpoint.
- The full ordered browser-surface audit was attempted but yielded no usable
  result before its bounded runner returned. Therefore complete responsive UI
  rendering coverage is unresolved for this audit, not green by assumption.

## Math-verification results

The current worker evidence confirms the active V8/Q16 declaration, activation
height 960601, canonical replay readiness, exact-tip requirement, and pending
event witness readiness. Public consistency was green and the canonical summary
was published at the same indexed height. No new arithmetic discrepancy was
demonstrated.

The audit did not independently recompute every stored balance, listing,
transition, fee, supply, and UI display value because the direct database audit
was not authenticated through the SSH account and the full surface runner did
not return. Existing prior integer-reconciliation results remain historical
evidence, not a substitute for a complete current replay.

## Previously reported issues rechecked

- UI disk/backup-retention risk: persists; now 65% used, 13GiB free, 20G
  retained UI backups, retention service failed in dry-run mode.
- Node `/data` storage warning: persists and worsened from prior 75–76% samples
  to 78%.
- Node release-health/provenance failure: persists; service remains failed.
- PostgreSQL WAL receiving: persists and worsened; slot is inactive with
  `wal_status=lost` and an estimated 247GiB WAL gap. This backup/replication
  lane cannot be treated as healthy.
- Slow/fallback exact marketplace reads: persists in logs; repeated fallback and
  rejection messages were observed.
- Prior confirmed event/accounting integrity findings: no new regression was
  observed in the green public consistency and worker readiness checkpoint.

## New findings

No new protocol-record corruption or math defect was proven. The following are
new/current audit-state findings requiring attention:

1. **H12-01 — WAL receiver is lost with a 247GiB gap (high operational risk).**
   Source: PostgreSQL replication slot and service inspection. Impact: the
   receive-WAL backup path is no longer a reliable near-real-time recovery
   stream; continued WAL churn can make recovery/replication irrecoverable from
   this slot. Correction: approve a separately planned, non-destructive WAL
   receiver/backup recovery procedure with fresh base-backup validation.
2. **H12-02 — UI retention guard remains failed with 20G retained backups.**
   Source: UI disk inventory and retention service logs. Impact: continued
   releases can consume the 13GiB free margin and recreate the full-disk
   application outage. Correction: classify rollback roots and archives, then
   approve only the exact safe retention deletions.
3. **H12-03 — Node `/data` crossed the warning threshold.** Source: `df` and
   failed storage-health unit. Impact: future Core/database growth or backup
   accumulation may exhaust the volume. Correction: capacity plan and approved
   classification of non-live recovery/backup artifacts; do not delete live or
   evidence data by age alone.
4. **H12-04 — Complete current UI rendering/math replay coverage is incomplete.**
   Source: bounded surface audit produced no usable result and direct DB audit
   access was unavailable. Impact: no claim can be made that every current UI
   projection and arithmetic alias was rechecked in this pass. Correction:
   provide the production audit database/RPC audit credential path or run the
   approved audit harness from its intended host, then capture full evidence.
5. **H12-05 — Marketplace summary fallback/rejected scoped-book messages recur.**
   Source: API logs at block 967354/967355. Impact: stale/latest-complete
   fallback can increase latency and obscure whether a scoped listing view is
   complete during catch-up. Correction: inspect scoped materialization and
   freshness gates with a bounded reproduction before changing behavior.

## Actions taken

- Read prior audit records and repository protocol/operational context.
- Ran read-only host, filesystem, service, database-size, worker-log, public
  health, consistency, ID-summary, and Boost-summary checks.
- Created this audit log only. No cleanup, repair, restart, deploy, commit, or
  push was performed.

## Items requiring approval

- Any deletion or movement of UI release archives, rollback roots, temporary
  files, caches, backups, or audit/recovery artifacts.
- Any WAL receiver reset, new base backup, replication-slot change, database
  maintenance, service restart, or production configuration change.
- Any application/indexer/math correction, data repair, deployment, or protocol
  record change.

## Recommended follow-up actions

1. First, preserve evidence and classify the UI 20G retention tree by exact
   active/rollback/provenance relationships; then approve a minimal deletion
   set with a measured post-cleanup free-space target.
2. Stabilize the PostgreSQL backup/WAL design: establish a fresh base backup,
   validate restoreability, and only then repair or replace the lost receive
   slot under an approved runbook.
3. Set a hard `/data` runway budget that accounts for Core growth, PostgreSQL
   growth, Electrs growth, backups, and recovery evidence separately.
4. Re-run the complete parity, ledger, computer-event, ID, math, and ordered UI
   surface audits from the intended production audit environment with valid
   read-only credentials, and attach compact evidence receipts.
5. Investigate the marketplace scoped listing materialization mismatch and
   fallback latency without weakening fail-closed freshness or canonical-chain
   authority.

---

# Ordered application-surface audit append — 2026-09-17

## Audit date and scope

This append records the requested ordered surface audit performed after review
of all prior audit records. It remained read-only: no code, configuration,
production data, database, ledger, backup, log, infrastructure, service, or
cleanup mutation was performed.

## Pages and services reviewed

The route order was:

1. `proofofwork.me` — HTTP 200, 0.882s.
2. `id.proofofwork.me` — HTTP 200, 0.426s.
3. `desktop.proofofwork.me` — HTTP 200, 0.450s.
4. `browser.proofofwork.me` — HTTP 200, 0.422s.
5. `boost.proofofwork.me` — HTTP 200, 0.458s.
6. `amo.proofofwork.me` — HTTP 200, 0.512s.
7. `credit.proofofwork.me` — HTTP 200, 0.512s.
8. `wallet.proofofwork.me` — HTTP 200, 0.542s.
9. `work.proofofwork.me` — HTTP 200, 0.568s.
10. `infinity.proofofwork.me` — HTTP 200, 0.652s.
11. `inception.proofofwork.me` — HTTP 200, 0.460s.
12. `log.proofofwork.me` — HTTP 200, 0.497s.
13. `growth.proofofwork.me` — HTTP 200, 0.508s.
14. `computer.proofofwork.me` — HTTP 200, 0.427s; API health and consistency
    were checked last as requested.

All routes returned the expected HTML response size in the direct route pass.
The repository’s aggregate surface runner again returned an empty result within
its bounded execution; this is recorded as an audit-tooling limitation, not as
a page-level pass or failure.

## API and performance results in the same order

Fresh canonical API probes returned HTTP 200 through the shared Computer API
and all reported indexed-through block `967355`:

| Surface | Fresh probe | Time | Result |
|---|---|---:|---|
| Home | registry summary | 5.655s | 527 IDs; 6 listing records in payload |
| ID | IDs summary | 5.002s | 527 records |
| Desktop | log summary | 5.302s | 25,817 activity records |
| Browser | activity summary | 6.839s | 25,817 activity records |
| AMO | marketplace summary | 19.066s | 6.18MB response; slow |
| Credit | token summary | 14.225s | 1,385 total records; 784 listings |
| Wallet | WORK token | 20.334s | 1,385 total records; 783 listings; slowest |
| WORK | work summary / floor | 13.918s / 9.120s | HTTP 200; slow fresh reads |
| Infinity | infinity summary | 6.277s | HTTP 200 |
| Inception | inception summary | 6.255s | HTTP 200 |
| Log | log summary | covered by Desktop probe | same indexed checkpoint |
| Growth | growth summary | 7.905s | HTTP 200 |
| Computer | health / consistency | 3.100s / 11.551s | green; consistency complete |

## Full-node verification results

Computer-last verification used the configured Core service account:

- Main chain, height and headers: `967355` / `967355`.
- Initial block download: false.
- Pruned: false.
- Core disk footprint: approximately 876.6GB.
- Core warnings: none.
- `txindex`, `coinstatsindex`, and basic block-filter index: synchronized.
- Mempool: 79,631 transactions, 40,467,919 bytes, 226,339,592 bytes usage,
  2,000,000,000-byte maximum, unbroadcast count 0.
- `/data`: 78% used with 358GB available.
- PostgreSQL `proof_indexer`: approximately 27GB.

The public health endpoint returned `ok=true`, `ready=true`, `available=true`,
and `lagBlocks=0`. Public consistency returned `ok=true`, `status=green`,
indexed through `967355`, snapshot `bcbbac7fcb305ff9a96222ba`, and
`missingLogEvents=[]`.

## Data and math verification results

The shared API, indexer checkpoint, full-node tip, and public consistency result
converged on the same height. The worker evidence from the preceding audit
continued to show Q16 replay readiness, zero unresolved pending protocol
events, and a valid pending witness. No new rounding, precision, unit,
balance, fee, supply, duplicate, orphan, or confirmed/pending-status defect was
demonstrated in this pass.

This pass did not claim an independent exhaustive replay of every balance,
listing, seal, purchase, credit, ID, and UI number because the aggregate audit
runner did not return and the audit SSH account does not have direct Core RPC
credentials. Core was nevertheless verified through its configured service
account, and public canonical consistency was green.

## Previously reported issues rechecked

- **WAL receiving / lost slot:** unresolved from audit 12; remains a recovery
  and backup reliability risk.
- **Node `/data` runway:** unresolved and currently at 78% used.
- **Node release-health:** unresolved; the release-health unit remains failed.
- **UI retention:** unresolved; UI remains at 65% used with 13GB available,
  20GB under `/var/backups/proofofwork-ui`, and the release-prune unit failed.
- **Fresh exact-read latency:** persists materially. Marketplace was 19.1s,
  Credit 14.2s, WORK summary 13.9s, and Wallet WORK 20.3s.
- **Aggregate surface audit timeout/empty result:** persists; direct route and
  API probes were used as bounded fallback evidence.
- **Canonical event and math integrity:** no new regression observed; health and
  consistency remained green.

## New findings and severity

### H12-06 — Fresh wallet/WORK reads remain operationally slow (medium)

The fresh Wallet WORK endpoint took 20.334s and returned a 5.27MB payload;
WORK summary took 13.918s and Credit token summary took 14.225s. This increases
timeout risk, duplicate refresh pressure, and stale-result race exposure even
when values are correct. Recommended correction: reduce payloads, separate
summary from history/listing detail, cache immutable checkpoint slices, and
instrument query/source timing by surface.

### H12-07 — Aggregate ordered audit runner still produces no evidence (medium)

The canonical audit script returned no JSON and an empty output file within its
bounded execution, while direct route/API probes succeeded. This weakens repeat
audits and makes regressions harder to distinguish from tool failure.
Recommended correction: add per-surface progress output, hard cancellation,
partial-result emission, and an explicit exit code/report for timeout versus
failed validation.

No new data-integrity or protocol-math defect was opened.

## Recommended improvements

1. Optimize marketplace, token, Wallet, and WORK fresh reads before increasing
   client timeouts; preserve exact canonical checkpoints while splitting large
   payloads.
2. Repair the audit runner’s timeout/partial-output behavior and make each
   surface independently resumable.
3. Resolve the lost PostgreSQL WAL lane through an approval-gated recovery plan
   with a fresh base backup and restore validation.
4. Classify UI rollback/release archives and establish a hard free-space floor;
   do not delete candidates without explicit approval.
5. Keep Core/indexer consistency and fail-closed canonical freshness gates as
   the authority while investigating marketplace scoped-book materialization.
6. Add alerting on API latency percentiles, payload bytes, repeated fallback
   decisions, WAL-slot loss, `/data` runway, and UI backup growth.

## Storage items requiring review

- UI `/var/backups/proofofwork-ui`: approximately 20GB.
- UI `/var/log/journal`: approximately 370MB.
- UI `/var/tmp` includes a 183MB Q16/V7 retained root and 159MB preactivation
  tarball, plus deployment bundles; classify before any removal.
- Node `/data`: 78% used; live Core, Electrs, PostgreSQL tablespaces, backups,
  recovery evidence, caches, and audit artifacts require separate ownership and
  retention decisions.

## Actions requiring explicit approval

Any code, configuration, data repair, WAL-slot reset, database maintenance,
service restart, deployment, backup movement/deletion, cache cleanup, log
rotation change, release archive deletion, or infrastructure change remains
approval-gated. No such action was taken during this audit.
