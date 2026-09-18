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

---

## Independent read-only follow-up — 2026-09-17, 17:32 UTC onward

This dated follow-up preserves the earlier entries above. It supersedes their
current-health conclusions where the deeper checks below disagree. **Overall
result: degraded; comprehensive integrity is not proven.** Green public health
and consistency endpoints do not imply complete relational or rendering parity.
The user authorized this audit-log update only. No production data, ledger,
protocol record, service configuration, backup, cache, or historical evidence was
modified; no restart, deployment, commit, push, or production cleanup occurred.

### Scope and provenance

Read SOUL, README, PROOFOFWORK_IDS, MARKETPLACE, OP_RETURN_INFRASTRUCTURE,
MAIL_ORGANIZATION, and REPOSITORY_HYGIENE; reviewed prior audit findings and repair
records, including audits 6–12, before opening findings. Rechecked the existing
issue classes below instead of treating each larger count as a new issue.

Systems: UI `77.42.91.106`; node/API/indexer/PostgreSQL `65.108.122.87`.
Checked filesystem/inodes, CPU/memory, RAID, services/timers, database catalog and
relational invariants, Core chain/index/mempool state, worker/API health, backup
logs and retention inventories, public API/surface probes, and browser smoke
renders. Remote SQL was read-only and bounded. Secret environment values were
passed privately to existing deployed audit scripts, never printed.

Local HEAD: `96b9b582f101f103bbf59cede4727e2c7a2ce372`; deployed API:
`8223f1dd338beaa71509332b511271be3e93f22a`; UI manifest:
`62fded8008f9bd70e6b392a570f9b777389a5b2b`.
Preexisting changes to package.json, repository-hygiene.json,
scripts/audit-production-surfaces.mjs, server/proof-api.mjs, this untracked audit,
and scripts/check-production-observability.mjs were preserved. Local checks use
Node 22.23.2; deployed audits use Node 24.18.0. Local source tests are not proof
that the deployed revisions contain the same behavior.

### Health, capacity, and recurrence risk

| System | Observation | Assessment |
| --- | --- | --- |
| UI root | 39,973,924,864 total; 24,782,127,104 used; 13,507,604,480 available bytes; 65%; inodes 4% | 12.58 GiB free, only 2.58 GiB above 10 GiB floor and 0.58 GiB above 12 GiB warning |
| UI CPU/RAM | 2 CPUs, load .12/.05/.01; sample 99–100% idle; 3,410,853,888 bytes available RAM of 4,005,457,920; no swap | No sampled CPU/RAM pressure |
| UI retained backups | 20,586,196,992 bytes; rollback roots 3,349,958,656; rollbacks 6,440,357,888; releases 3,700,789,248 | Dominant capacity pressure; failed dry-run retention unit does not reclaim anything |
| UI logs/temp/live roots | logs 662,712,320; `/var/tmp` 429,801,472; `/var/www` 398,589,952 bytes | Temp includes historical Q16/V7 root and preactivation archive; age alone does not authorize removal |
| Node root | 27%; 73,436,536,832 bytes available; inodes 6% | Adequate current root space |
| Node `/data` | 78%; 380,775,608,320 bytes available; inodes 1% | Existing capacity warning persists |
| Node CPU/RAM | 32 CPUs; load 1.86/2.93/3.62; sample 97–100% idle; 116,361,441,280 bytes RAM available; 616,038,400 swap used | No sampled acute pressure; swap allocation alone is not current thrashing |
| Node RAID | Both arrays `[UU]` | No degraded mirror reported |
| PostgreSQL | database 29,363,797,015 bytes; transitions 27,964,719,104; snapshots 827,924,480 | Transition history dominates database growth |

UI Caddy is active and scheduled release provenance verified. Nine retained
rollback roots and accumulation of archives can consume the remaining deployment
headroom again. A single sample cannot establish days-to-full. Record daily byte
deltas, enforce a pre-deploy peak-space budget (old live + new staged + archive +
rollback + logs), and approve a manifest-based retention plan before the next
large release. The application database is on the node in this architecture;
the UI disk pressure observed here is retained releases/backups, not that live DB.

Node inventory: Core 975,920,676,864 allocated bytes; Electrs 63,827,218,432;
PostgreSQL backup tree 156,227,538,944; tablespaces 28,792,815,616; audit-5 restore
22,132,215,808; safeguard 11,271,983,104; older restore 2,281,152,512;
other application backups 14,639,370,240; release backups 11,416,141,824;
recovery 3,910,983,680; live cache 82,739,200; mempool storage 1,354,031,104.
These are inventories, not approved deletion lists. Recovery evidence, restore
fixtures, and rollback records require ownership/dependency review first.

### Core, indexer, database, and backup integrity

Core was fully synchronized at height 967444/hash
`0000000000000000000093a409c5b13020e64a58b80f037e3f3ebb758fa01e72`,
headers equal, verification progress 1, IBD false, unpruned, warnings empty.
Txindex, coinstats, and basic filter indexes matched. `verifychain` level 3 over
the last six blocks passed; this is not a fresh validation of the entire chain.
API snapshot `99a960d2cbd7638c66a19a4e` and worker matched 967444, worker reported
zero unresolved/error/deferred work and readiness queue zero. Core, Electrs,
PostgreSQL, API, and worker were active. Process activity alone does not prove
Electrs independently serves every address correctly.

DB catalogs reported zero invalid/unready indexes, unvalidated constraints,
waiting locks, or deadlocks. No orphan participants/references, invalid finite
balance values, or negative balances were found. PostgreSQL page checksums are
off: a NULL checksum-failure counter cannot certify absence of physical damage.
No full page/index scan, isolated current-backup restore, or complete independent
chain reindex was performed. Cumulative temp_bytes 1,414,991,246,998 is historical
query traffic, not resident disk usage. Application role/database setting remains
`temp_file_limit=1GB`, `log_temp_files=256MB`.

**H10-01 / A11-04 / H12-01 persists:** WAL slot inactive/lost, observed gap
268,848,663,120 bytes (~250.4 GiB). Receiver retries a missing segment every five
seconds (`000000010000007C00000008`). An active receiver service is not a working
PITR chain. Logical backup logs show successful jobs and the latest dump set is
20260917T031851Z (15,081,467,904 bytes); this does not repair the broken WAL lane.
Backup tree: logical 95,668,785,152; physical 36,487,340,032; recovery evidence
10,225,852,416; H7 recovery 13,175,431,168 bytes. Prior restore evidence remains
historical; present off-host recoverability and current restore completeness are
unproven. Approve a fresh base-backup/WAL repair and isolated restore verification.

**H10-03 release-health persists with a changed cause:** all 35 archives verified
and current provenance count is 1, but `opt_checkouts=22` exceeds 9. The earlier
`.git/index` permission issue is resolved (mode 644). Classify checkout history
before any cleanup. Storage-health and release-health node units remain failed.

### Complete relational population checks and discrepancies

Deployed computer-events audit failed; deployed parity audit had 102 checks,
95 passing, five error failures and two historical V5 readiness warnings.
Population: 25,723 transaction rows (25,473 confirmed, 179 pending, 71 dropped),
26,327 events, 25,813 valid confirmed events, 238 credit definitions, 405 balance
rows, 1,120 listings, 505 confirmed ID records, 616 mail rows, 125,632 participant
rows and 55,769 references. Canonical activity coverage, credit definitions,
status payload consistency, and the tested transaction/history/search regressions
passed. Counts are checkpoint-specific, not immutable global totals.

- **H9-03 evidence-completeness regression:** four confirmed external-spend rows
  from `canonical-listing-outpoint-scan` lack raw transaction/canonical proof.
  They have no event dependencies, so no missing valid-event raw transaction was
  found. Rows were updated 2026-09-15T18:22:43.424998Z. Txids:
  `8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf`
  (966878), `939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c`
  (966199), `4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212`
  (966498), `4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359`
  (962992). Impact: incomplete independently replayable spend evidence. Proposed
  correction: fetch and verify Core block/transaction proofs, repair projection
  fields only after approval, and prevent incomplete confirmed inserts.
- **Prior event-metadata repair has regressed:** 1,745 valid confirmed events
  disagree with parent metadata: all 905 token-listing and 840 token-listing-sealed
  events have NULL block_time/event_time; block positions match their parents.
  Impact: event chronology/rendering and evidence parity, not demonstrated balance
  corruption. Reconstruct timestamps from verified parent blocks; fix the writer
  and enforce metadata parity transactionally after approval.
- **Participant semantic drift:** 45 extra tuples, no missing tuples; expected
  125,587 versus 125,632 stored. Sample extras associate registry address
  `1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV`. Extra-set SHA256
  `7910ecb110197ec85886e87efb8226d0fe15d33ca08a664736952a5198c5bef6`.
  Impact: address/search attribution can include spurious relations. Compare
  writer and current canonical participant extractor; approve deterministic
  projection rebuild only after reviewing exact tuple changes.
- **H9-04 remains unresolved:** exactly one missing INCB ticker reference for
  invalid event 4079924, transaction
  `b00b9451bded7d2b7d339556ad2dc5d375e5b52ad877a1d3e2b29149dfc72ccf`.
  This affects invalid-event discoverability, not valid token issuance.
- **H9-05 mail projection drift expanded:** all 616 expected mail rows exist,
  without extra/missing/duplicate rows, but 46 differ in `attachedCredits` only.
  Mismatch-set SHA256
  `818317e1454be50cb3b841305d40124746430a58df2dc7fbf1e25ff2189036ab`.
  Impact: attachment display/replay consistency. Compare exact integer credit
  fields and render normalization before approving a projection-only repair.

Shared transaction positions were inspected: 78 groups include legitimate
sale/derived-close events and invalid historical aliases. Position sharing alone
is not evidence of duplicate accounting. No claim is made that each shared group
received a fresh independent canonical replay.

### Math verification and display consistency

Independent SQL integer arithmetic checked all 905 V8 terms: face/price 25,000;
amount = floor(25,000 × 21,000,000 × 10^16 × 10^8 / N_before);
minimum price = ceil(amount × N / (21,000,000 × 10^16 × 10^8));
N_after = N_before + bond. No discrepancy was found.

All 7,824 transition rows, heights 959621–967444, were consecutive and hash
contiguous with complete/fee-once/invalid-zero/block-atomic flags true. One state
hash boundary at 960601 preserves value and corresponds to the documented Q16
activation; it is not classified as corruption. This checks stored witnesses
and continuity, not independent replay of all underlying transactions.

WORK: 357 rows sum to 210000000000000000000000 subatoms, pending delta zero.
POWB: 11 rows sum to 630496569; INCB: seven rows sum to 224847713398447926.
All 405 balance rows passed nonnegative, finite integer validation. Across all
46 confirmed valid INCB mints, issuance amount equals floor(issuance Q8/10^8)
and issuance Q8 equals proof × 10^8 + attached-WORK live-value Q8.

**New precise storage/display discrepancy:** 39 of those 46 INCB records retain
an `issuanceNetworkValueSats` decimal alias inconsistent with the corresponding
exact Q8 value. Example transaction
`875cd28607cc38608ebec93dcabb2b9ee25ab8425308dd03cc0b4532e05dbe13`:
Q8 `293987255080509083181` means `2939872550805.09083181`, whereas stored decimal
alias is `2950699258666.0571579`. Source inspection shows API normalization paths
prefer Q8, so this does **not** establish that every public screen displays the
wrong amount. It does establish inconsistent stored representations, potentially
connected to the 46 attached-credit projection differences. Recommended fix:
derive all decimal aliases exclusively from immutable exact integers, test every
consumer, and approve narrowly scoped projection normalization; never rewrite
canonical issuance or historical economic terms merely to align displays.

Eleven targeted local checks passed: work precision v1/v2, exact bond arithmetic,
canonical order, V8 AMO, INCB replay witness, INCB oracle restoration fixtures,
API truth, UI static checks, and Boost regression suite. `check:live-data` failed
a static source-shape expectation around the preexisting marketplace observability
wrapper. That is a test/source disagreement, not demonstrated production math
failure. Historical Boost audit-6 synthetic repro still demonstrates H6-01 owner
authorization and H6-02 unfollow-target relation gaps in local source; its fixed
line references are historical. Production has ten valid Boost events and no
unfollow/hide event exercising those paths; deployed equivalence was not proven.

### Mempool, APIs, and rendering

Core initially had 81,493 mempool transactions (41,060,126 serialized bytes;
230,277,960 usage under 2 GB limit), no unbroadcast transactions. Comparing the
179 indexed pending txids to two Core snapshots across block 967445 found one
absent in both. Core confirmed it in that block, and a subsequent DB read showed
`confirmed`, height 967445: transaction
`529f5f02437a7c22b3fa6ae0e4af02d88f409bd6868f7b95aae207ce9b59ba98`.
This was normal convergence, not a persistent ghost. Nonconfirmed block-metadata
and event payload/relational status parity checks passed. Visibility remains
best-effort; this is not a proof that every possible mempool action is ingested.

The previously dirty aggregate surface runner completed in ~172 seconds this
time, checking 13 hosts and four assets per host. Thus **H12-07 did not reproduce
with this local modified runner**, without claiming a deployed tooling fix.
Fresh reads remain slow (H10-05/H12-06): AMO 18.151s, WORK 12.668s, Wallet 12.604s,
Credit 8.998s, other probes roughly 5–9s. The 19,580,786-byte canonical payload
continues the known size-budget concern. Logs still show accepted fallback
without current coverage and rejected scoped books (830 versus 790); this is the
known 40-row historical/coverage class, not newly proven financial divergence.

Browser smoke checks covered 14 hosts including Boost, each at 1440 and 390 px:
all initial documents 200, no observed page exceptions, 5xx responses, or horizontal
overflow during the short initial window. Many data panels were still loading;
these checks are not complete per-object or wallet-authenticated rendering tests.

Strict deployed ID audit returned HTTP 503 from the internal registry-audit
endpoint. The separately bounded cross-ledger audit expired after 240 seconds
while retrying CANONICAL_SUMMARY_TIP_CHANGED/CANONICAL_SUMMARY_UNAVAILABLE. These
are unresolved evidence/availability gaps, not successful strict ID or full
cross-ledger proofs. No claim of universal math correctness is justified.

### Follow-up priorities and approval boundary

1. Repair and restore-test the lost WAL chain; establish verifiable off-host RPO.
2. Review UI release retention and peak deployment budget; measure node database
   and backup growth. Retire only artifacts proven independent of live/recovery
   needs, with explicit approval. No production items were removed here.
3. Preserve exact mismatch sets; fix metadata/raw-evidence/participant/reference/
   mail writers and deterministic projections after approved review. Re-run all
   102 parity checks against one immutable checkpoint before calling integrity
   green. Keep invalid historical events discoverable.
4. Reconcile INCB exact/decimal aliases across DB/API/UI without changing economic
   values; rerun strict ID and cross-ledger audits with bounded per-stage evidence.
5. Resolve prior Boost defects, large payloads, fallback coverage and slow reads;
   add checkpoint-bound rendering tests with confirmed/pending/reorg fixtures.

No current finding authorizes deleting backups, resetting slots, rewriting rows,
changing protocol math, or deploying fixes. CPU, memory, network usage, and disk
are point-in-time measurements; provider transfer quotas and future growth were
not established. Full physical DB verification and exhaustive chain-to-browser
coverage remain follow-up work, not implied passes.

### Evidence receipts and final hygiene review

Raw read-only receipts are in `/tmp/pow-audit-20260917-followup/` on the audit workspace; this temporary directory is not durable backup storage. The findings, populations, representative txids and mismatch-set hashes above are preserved in this log. File hashes below allow comparison if receipts are retained; hashes alone do not preserve their contents.

| Receipt | SHA256 |
| --- | --- |
| node-host.txt | `b831879fa89cb96a9a0fb906d1b5ba8c6d15dcc5618569076e5440e328916b47` |
| ui-host.txt | `35c9cdff1429bdca67d56166df0078eff676bf36ce508a26087a056140f322f6` |
| node-core-backup.txt | `ad0b2382c5ea57dedb270d892401915cd7c2fa8eccc842cdac794287c727c947` |
| node-logs.txt | `d9dca0c8630766ff3664b923d97f9afc56dd6ae8f5b442e95ffbb253d5e6c8ca` |
| db-health.txt | `b4f787c5f4e2346e01c124ca76fd1b1395f57672b6feb2342a85777193e3ea0d` |
| computer-events.json | `89978e1526c8448dbf930d08e10cd58d59de644403c03a7efdc29e0e3cb08593` |
| parity.json | `daa6402736c3228c56a33f607fa723136e7645c07a30a405a6484d2813c80bdf` |
| math-sql.txt | `092a5dcba0ea2db66e0190c2d155dce9989899ea5405e8b38432edfcfec942ba` |
| projection-diagnosis.txt | `1f9a119bc5b4c2b56df5f8d45cc18c95b5f24a4947b5193cb12306e8ac144827` |
| mempool-core.json | `0c102eae4cfdd49308a2fe0825e6b17ea5e138d61b9b0854b87c2997db6e507c` |
| pending-recheck.json | `44a2494c533084d31e1f6c5e3f4a2e5c0495f3a8cc9033a9b6a6116592f6f5fd` |
| pending-db-recheck.txt | `a63414e66a43fe0629677e2eba85741747048b42b96d4e1781cbcfeafab0dd4a` |
| surfaces.json | `00a4ecfc597d574581705469ef42d75850a565c950bb568b5f7558b7ec3a8403` |
| render.json | `d38bde886f40b82f40543f931d0047537e9fb8d7ac14408461204238bc273ea7` |
| ids.stderr | `9213496962c9bd20d4121012a9e00e20a6901170a11f8ea078736b33fc0841d5` |
| ledger.txt | `16f528efbf7c655bbc5340b5d4e2ee7cc5263df639a2d754947d79126a827262` |
| local-checks.json | `35ed1aae46cb03a0ed10f18c82e4b5c039ec609594710f568606f721f7f4ebcc` |
| boost-repro.json | `ffaababff3712ea81806c7982dba5ae29f41a5228538a954dff13148571c9b71` |

Mandatory `npm run hygiene:fix` found no allowlisted rebuildable state and removed nothing; `npm run hygiene:check` passed. Reviewed canonical-document impact, note classifications, generated-artifact policy, ignored files, git status and diff whitespace. This audit changes no protocol/product behavior and requires no canonical-document or SOUL rewrite. All preexisting code/config changes remain outside this audit’s edits. No staging or commit was performed.

Final extended mobile render checks waited 30 seconds on AMO, Inception, Computer and Growth. All documents returned 200, with no observed page exceptions or 5xx responses. AMO still showed loading placeholders after 31.9 seconds, confirming the existing slow/freshness-read usability issue; this was not counted as a fully loaded rendering pass. Inception displayed issued supply 224,847,713,398,447,926 matching the checked DB balance total. Computer was unauthenticated, so account mail rendering remains untested. Extended-render receipt SHA256: `41d269d593992fa8d8a31ab3be70bd8bd14ebc6a71109152d85b39bee93fe949`. Audit closed 2026-09-17 17:43 UTC.
