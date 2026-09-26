# ProofOfWork.Me Production Health and Data-Integrity Audit 24

## Audit date and scope

- Date: 2026-09-26 UTC
- Scope: UI VPS, node/API/full-node VPS, PostgreSQL indexer database, Bitcoin Core node, Electrs, indexer worker, API services, public Computer/Marketplace/ID/mail rendering paths, production observability, backup and retention systems, and protocol math gates.
- Change policy: read-only production audit. No production data, protocol records, ledgers, evidence, historical records, backups, caches, temporary files, deployment config, commits, pushes, or deploys were manually changed or removed.
- Approved repository change: create this audit log after completing the audit.

## Systems and services checked

### UI VPS

- Host: `ubuntu-4gb-hel1-1`
- SSH target: `root@77.42.91.106`
- Checked: disk, memory, CPU/load, inodes, failed services, Caddy/logrotate/storage timers, UI release backup retention, UI storage trends, release archives, rollback roots, recovery evidence, scratch directories, temporary-file usage, and active web/app storage.

### Node, API, full-node, and database VPS

- Host: `pow-bitcoin-01`
- SSH target: `powadmin@65.108.122.87` using the production node key and sudo for service-local checks.
- Checked: disk, memory, CPU/load, swap, inodes, Bitcoin Core, Electrs, PostgreSQL 16, ProofOfWork API, indexer worker, API watchdog/WireGuard service, backup timers, storage trend timers, query health, production observability, release health, release backup storage, logical backup integrity, API logs, system logs, public endpoints, internal verifier routes, and production regression/audit scripts.

## Health and capacity results

### UI VPS capacity

- Root filesystem: 39,973,924,864 bytes total, 8,046,874,624 bytes used, 30,242,856,960 bytes available, 22 percent used.
- Inodes: 3 percent used.
- Memory: 4.0 GB total, about 3.4 GB available.
- Swap: none configured.
- UI storage trend: healthy. The latest trend record reported about 30.24 GB free, with a 10 GB reserve and about 19.5 GB headroom beyond reserve.
- Caddy, logrotate, storage health, release provenance, release prune, storage prune, storage trend, and fstrim timers were active.
- Root capacity is currently healthy. The previous UI disk-full failure condition is not present.

### UI storage retained for review

The current UI storage state is healthy, but there is removable-candidate material that needs classification before deletion:

- `/var/backups/proofofwork-ui`: about 3.71 GB.
- `/var/backups/proofofwork-ui/recovery-evidence`: about 1.57 GB.
- `/var/backups/proofofwork-ui/releases`: about 1.31 GB.
- `/var/backups/proofofwork-ui/rollback-roots`: about 232 MB.
- `/var/backups/proofofwork-ui/cleanup-evidence`: about 169 MB.
- `/var/tmp/proofofwork-deploy`: about 248 MB.
- `/var/tmp/proofofwork-ui-a6-surfaces`: about 204 MB.
- `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`: about 192 MB.

The UI release prune job is retaining the latest verified rollback archives, but older out-of-pattern archives remain outside the current prune pattern:

- `ui-pre-work-atoms-20260716T185321Z.tgz`
- `proofofwork-ui-pre-mail-work-admission-27a3c25.tgz`
- `proofofwork-ui-pre-amo-v5-20260726T200700Z.tgz`
- `proofofwork-ui-release-cbb0de3-20260824T013448Z.tgz.pre-normalized-20260824T020000Z`
- `proofofwork-ui-release-dd7bcc0295d1-20260921T020136Z.tgz.rejected-hardlink`
- Matching checksum sidecars and a small historical Caddyfile backup.

These are not causing an immediate capacity problem, but they are cleanup candidates. Because some are recovery/evidence artifacts, they should not be removed without explicit approval and classification.

### UI service health

- No active Caddy failure was found.
- One stale failed transient unit remains: `proofofwork-boost-ui-publish-6c5e7b5a3d03.service`, failed on 2026-09-22 during a canonical publisher assertion. This appears to be old failed-state clutter, not an active serving fault.

### Node/API VPS capacity

- Root filesystem: 105,089,261,568 bytes total, about 22.5 GB used, about 77.2 GB available, 23 percent used.
- `/data`: 1,764,768,071,680 bytes total, about 1,176.6 GB used, about 579.2 GB available, 68 percent used.
- Inodes: healthy, about 1 percent used on `/data` and 5 percent used on `/`.
- Memory: 134,125,752,320 bytes total, about 116 to 119 GB available during the audit.
- Swap: 17,179,865,088 bytes total, about 1.16 GB used after the backup window.
- The node/API VPS has healthy free space today. The main future capacity risks are intentional large data sets: Bitcoin Core chain data, Electrs, PostgreSQL/indexer tablespace growth, one retained logical database backup, release backup evidence, and two large final-source replay directories.

### Node/API storage usage

Major storage consumers:

- `/data/bitcoin`: about 978.3 GB.
- `/data/bitcoin/blocks`: about 879.2 GB.
- `/data/bitcoin/indexes`: about 87.6 GB.
- `/data/bitcoin/chainstate`: about 11.4 GB.
- `/data/electrs`: about 64.1 GB.
- `/data/proofofwork-postgres-tablespaces`: about 34.2 GB.
- `/data/proofofwork-postgres-backups`: about 18.3 GB after the successful scheduled logical backup.
- `/data/proofofwork-release-backups`: about 8.83 GB.
- `/data/proofofwork-incb-final-source-replay-20260924T143604Z`: about 32.9 GB.
- `/data/proofofwork-incb-final-source-replay-20260925T022000Z`: about 30.3 GB.
- `/tmp`: about 4.94 GB.
- `/var/tmp`: about 542 MB.

`/data/proofofwork-release-backups` crossed the node storage trend review threshold of 8 GiB. The largest item is `operator-review-opt-checkouts-20260820T184500Z.tar.zst` at about 5.78 GB. The node release prune job is currently running in dry-run mode, so release backup storage will not shrink automatically.

The two INCB final-source replay directories together use about 63 GB. They may be evidence or reproducibility material and should be classified before deletion.

## Full node and mempool health

- Bitcoin Core reported `initialblockdownload=false`, `pruned=false`, `verificationprogress=1`, and no warnings.
- Core chain height matched headers during the audit.
- Example Core state during the audit: height 968630, best block hash `00000000000000000001f57744b67db316c2c285accaa25d9ebd0543a142278a`.
- UTXO set check: `gettxoutsetinfo muhash` completed at height 968630, with 165,252,611 txouts and total amount 20,089,241.75229681.
- Mempool was loaded and healthy, with about 74,693 transactions, about 39.6 MB of transaction bytes, about 221 MB memory usage, 2 GB configured max mempool, `fullrbf=true`, `unbroadcastcount=0`, and `mempoolminfee=0`.
- Public `/health` later reported node, Electrs, worker, txindex, and index coverage at tip height 968632 with lag 0.

## Database health and integrity

- Database: `proof_indexer`
- Main schema: `proof_indexer`
- Database size: 34,727,410,711 bytes.
- PostgreSQL tablespace usage: about 34.2 GB.
- Largest relation: `proof_indexer.work_amo_block_transitions`, about 33.35 GB total.
- Other significant relations: `ledger_snapshots`, `events`, `transactions`, `event_participants`, `tx_outputs`, `event_refs`, and `credit_listings`.
- Autovacuum and autoanalyze were active recently on hot tables.
- `pg_stat_database_conflicts` showed no conflict counts.
- No invalid indexes were reported by query-health after the backup window.

Production counts observed around tip 968630 to 968632:

- `transactions`: 25,943 total; 25,694 confirmed; 165 pending; 84 dropped.
- `events`: 26,554 total; 26,378 confirmed; 163 pending; 13 dropped.
- `op_returns`: 25,817.
- `event_refs`: 56,639.
- `event_participants`: 126,350.
- `id_records`: 507.
- `mail_items`: 617.
- `credit_definitions`: 238.
- `credit_balances`: 425.
- `credit_listings`: 1,210.

Integrity spot checks all returned zero:

- Duplicate transaction ids.
- Duplicate event primary keys.
- Duplicate event identity tuples.
- Orphan `event_refs`.
- Orphan `event_participants`.
- Confirmed transactions missing block metadata.
- Pending or dropped transactions with block metadata.
- Negative credit balances.
- Non-integer credit balances.
- Duplicate credit balance keys.
- Duplicate ID records.
- Duplicate credit definitions.
- Duplicate listing ids.
- Duplicate sale-ticket outpoints.

No database corruption or duplicate canonical records were found by these checks.

## Backup health

The PostgreSQL logical backup timer successfully ran during the audit.

- Backup set: `/data/proofofwork-postgres-backups/logical/proof_indexer-20260926T031852Z.dumpset`
- Dump bytes: 18,294,637,901.
- `sha256sum -c SHA256SUMS`: `proof_indexer.dump: OK`, `globals.sql: OK`.
- `pg_restore --list proof_indexer.dump`: 212 catalog/list entries.
- Retention automatically deleted the previous verified set `proof_indexer-20260926T011502Z.dumpset`.
- No manual backup deletion was performed by this audit.

The backup system is repaired compared with the prior broken-retention state, but it creates an operational health-monitoring issue: during `pg_dump`, PostgreSQL query-health went critical because the dump's long-running `COPY proof_indexer.work_amo_block_transitions` query exceeded the active-query threshold. Query-health passed after the backup completed.

The backup also reached about 13.3 GB peak memory usage. This is acceptable on the current 128 GB node, but it should be treated as part of capacity planning.

## API, indexer, and application health

### Public health and consistency

- Public `/health`: ready, available, and ok at tip 968632 after the audit checks; node, Electrs, worker, txindex, and index coverage were healthy.
- Public `/api/v1/consistency`: `ok=true`, 25 checks, no failures.
- `check:production-observability`: passed before the heavy audit workload with alert count 0.
- `check:summary-route-readiness`: passed.

### Summary route latency

The summary readiness checks are correct, but latency remains sensitive under load.

- Earlier readiness check: WORK summary about 1.37 seconds; marketplace summary about 1.39 seconds.
- Later readiness check after heavy audit and backup activity: WORK summary about 4.97 seconds; marketplace summary about 7.78 seconds. It still passed, but emitted latency warnings.
- API observation briefly failed during the audit/backup window because routes crossed latency and error thresholds. It recovered and passed at the next recheck after the workload drained.

The observed 503s were fail-closed availability responses rather than data-corruption evidence.

### Indexer and event rendering

The indexer, worker, health endpoint, ledger audit, mail regression audit, marketplace regression audit, and Computer event audit all reached healthy terminal results except for the full parity gate's known derived-index residues.

Successful checks:

- `audit:ledger`: passed for `https://computer.proofofwork.me`, snapshot `deb501bd5918143735704f90`, value `14407019274173309403.29513116` proofs.
- `audit:computer-events`: `ok=true`, no failures.
- `check:mail-regressions`: passed, with registry source `proof-indexer-current-id-events+proof-indexer-confirmed-id-records`.
- `check:marketplace-regressions`: passed, including V2 cutover, V5/V6/V8 gates, POWB listing, WORK lifecycle, active/closed listing truth, wallet scopes, and targeted transfers.
- Public registry summary: total count 527, count 527, source `proof-indexer-current-id-events+proof-indexer-confirmed-id-records`.
- Public ID rendering example: `carbonz` rendered as confirmed with owner and receiver `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW`, source `proof-index:registry-id`.

Observed availability stress:

- Marketplace regression eventually passed, but a fresh WORK wallet read for address `17W7JZ9KjjGUwdAyXeGxhzYe2vGe8YTRzA` retried through repeated `CANONICAL_WALLET_INDEX_UNAVAILABLE` 503s and passed on attempt 12 after about 79 seconds.
- API logs during heavy audit/backup load showed some `work-amo-index-not-ready`, Core raw queue saturation, and pending verifier fail-closed responses.
- These conditions affect availability and user-facing status freshness. They did not show corruption.

## Mempool visibility and pending status accuracy

- Bitcoin Core mempool was loaded and healthy.
- The public health route reported Electrs at tip and worker coverage at tip.
- Pending and dropped database counts were internally consistent.
- Pending verifier logs showed fail-closed responses when Core raw transaction/prevout binding could not be completed quickly under load, including `POW_BITCOIN_RPC_RAW_QUEUE_FULL`.
- This is a capacity and freshness concern for pending visibility, not evidence that confirmed chain records are being mis-rendered.

## Math verification results

Math gates passed:

- `check:work-amo-v8`: passed.
- `check:work-precision-v2`: passed.
- `check:bond-exact-arithmetic`: passed.
- `audit:ledger`: passed.
- `audit:computer-events`: passed.
- Public consistency: passed.

WORK summary values observed:

- Snapshot: `deb501bd5918143735704f90`.
- Network value: `14407019274173309403.29513116` sats/proofs-equivalent value as reported by the route.
- Floor sats per WORK: `686048536865.39568587`.
- Floor Q8: `68604853686539568587`.
- Total Q8: `1440701927417330940329513116`.
- POW IDs: 507.
- Confirmed tokens: 238.
- Token mints: 21,875.
- Marketplace sales: 86.
- Marketplace sale volume: 9,675,286 sats.
- Marketplace mutation fees: 1,336,062 sats.
- Confirmed Computer actions: 26,036.

No protocol math discrepancy was found in the deterministic math gates that completed. The remaining non-green parity items are derived-index/rendering metadata issues, not arithmetic failures.

## Full parity results

`indexer:parity` completed non-green at tip 968632.

Result:

- `ok=false`
- Exit code: 1
- Failure count: 4
- Warning count: 9

Error-severity failures:

1. `confirmed-transactions-have-canonical-block-proof`: four confirmed transaction rows still have canonical block metadata but lack `raw_tx.canonicalBlockScan`.
2. `rendered-event-reference-semantic-parity`: one rendered event reference is still missing, `ticker=INCB` for event `4256606`.

Warning-class failures or warnings:

- Historical WORK AMO V5 migration checks remain warning-class and migration-not-complete.
- Some snapshot parity warnings occurred because the chain/checkpoint advanced during the long parity run.

The two error-severity failures match the prior audit's remaining derived-index findings and are not new.

## Previously reported issues rechecked

- H23-01 PostgreSQL logical backup repair: resolved for this run. The scheduled backup completed, verified checksums, verified restore catalog readability, and retained only the latest verified set.
- H23-02 node release health: resolved for the current deployment. Release health passed for live commit `2f0b32356677f8ba7187f26f34611d0295947820`.
- H23-03 UI disk capacity: resolved/mitigated. UI root has about 30.24 GB free and is 22 percent used.
- H23-04 V8 readiness mismatch: resolved in readiness output. Both WORK and marketplace summary readiness reported V8 readiness and evidence alignment correctly.
- H23-05 parity gate residues: still open and unchanged. Four canonical block scan markers are missing and one `ticker=INCB` event ref is missing.
- H7-01/H10-07/A11-03 summary latency: still open. Readiness passes, but summary and marketplace routes still become slow under load.
- H5-06/H10-05/H12-06/H18 availability and latency: still open. Fresh canonical wallet and internal ID audit paths can fail closed or exceed practical budgets under load.
- H8-05/H10-02 database and storage growth: currently controlled but still requires monitoring. Database is about 34.7 GB, PostgreSQL tablespace about 34.2 GB, and `/data` is 68 percent used.
- H20-01 mempool/API log pressure: no runaway log growth found in this audit, but Core raw queue saturation appeared under audit load.

## New findings

### H24-01 - Fresh wallet and marketplace exact-read availability remain fragile

- Severity: high availability risk, no corruption found.
- Evidence: Marketplace regression passed only after repeated retries for a fresh WORK wallet read. API logs showed `CANONICAL_WALLET_INDEX_UNAVAILABLE`, `work-amo-index-not-ready`, and Core raw queue pressure under audit/backup load.
- Impact: user-facing wallet or marketplace views can return temporary 503s or wait tens of seconds even when canonical confirmed data is intact.
- Recommended correction: keep fail-closed semantics, but tune fresh-read budgets, queue sizing, cache readiness, and UI retry/status messaging. Add a specific monitor for fresh canonical wallet availability.

### H24-02 - Internal ID registry audit endpoint cannot reliably complete at exact current checkpoint

- Severity: high for audit automation, medium for user-facing product.
- Evidence: `audit:ids` failed twice with 503 from the internal ID registry audit route. Logs showed the exact Core/Electrum checkpoint changing while coverage was being built or the audit scan not remaining pinned to the exact checkpoint.
- Impact: recursive audit automation cannot consistently verify ID registry coverage under a moving tip, even though public ID registry rendering was healthy.
- Recommended correction: make the internal audit route checkpoint-pinned, resumable, or automatically retry against a stable checkpoint. Preserve exactness, but avoid requiring a long scan to finish before the tip changes.

### H24-03 - Logical backups are repaired but interfere with query-health alerts

- Severity: medium.
- Evidence: the 2026-09-26 scheduled backup completed and verified, but query-health went critical while `pg_dump` held a long active `COPY proof_indexer.work_amo_block_transitions` query.
- Impact: false critical alerts during healthy backups, and possible diagnostic ambiguity if a real query-health incident overlaps backup.
- Recommended correction: add backup-aware query-health thresholds, a maintenance window, backup-specific connection labeling, or an exclusion for the expected `pg_dump` query class.

### H24-04 - Node release backup storage needs retention policy action

- Severity: medium capacity hygiene.
- Evidence: `/data/proofofwork-release-backups` is about 8.83 GB and crosses the storage trend review threshold. The node release prune job is dry-run. The largest retained file is `operator-review-opt-checkouts-20260820T184500Z.tar.zst` at about 5.78 GB.
- Impact: no immediate capacity emergency, but storage will grow unless policy is applied.
- Recommended correction: classify the operator-review and UI preservation evidence archives, then approve deletion of redundant material once the latest verified rollback/source evidence is confirmed sufficient.

### H24-05 - UI release retention misses old out-of-pattern archives

- Severity: low to medium capacity hygiene.
- Evidence: the UI release prune job retains the latest verified archives, but older pre-normalization and rejected-hardlink artifacts remain outside the current prune pattern.
- Impact: no immediate capacity risk because UI root has about 30 GB free, but this is exactly the type of stale storage that previously contributed to UI disk pressure.
- Recommended correction: approve a one-time classified cleanup of out-of-pattern UI release artifacts and update prune policy if these names are expected to recur.

### H24-06 - Large INCB final-source replay directories need classification

- Severity: medium capacity hygiene.
- Evidence: two replay directories under `/data` consume about 63 GB combined.
- Impact: not urgent on a 1.76 TB `/data` volume, but meaningful enough to review.
- Recommended correction: decide whether these are required reproducibility/evidence artifacts. If not required, approve removal after recording the exact path, size, and replacement evidence.

### H24-07 - Stale failed systemd units reduce signal quality

- Severity: low operational clarity.
- Evidence: the UI host and node host both retain old failed transient units from prior boost/audit runs. Active production services were healthy after the audit load drained.
- Impact: `systemctl --failed` is noisier than it should be, making new failures easier to miss.
- Recommended correction: after confirming each failed unit is historical, approve `systemctl reset-failed` for stale transient units only.

### H24-08 - Full parity remains non-green from known derived-index residues

- Severity: medium data-integrity audit gate.
- Evidence: the full parity gate still reports the same four missing `canonicalBlockScan` markers and the same missing `ticker=INCB` ref for event `4256606`.
- Impact: canonical chain records, ledger math, and public summaries passed independent checks, but the recursive parity gate remains red until the derived-index residues are corrected.
- Recommended correction: after explicit approval, perform a targeted derived-index repair using canonical Core verification. Do not rewrite historical protocol records.

## Actions taken

- Read repository operating instructions, product/protocol docs, and the latest prior audit log before production checks.
- Reviewed prior audit findings and verified their current state instead of creating duplicate issues.
- Checked both VPS environments for capacity, memory, CPU/load, services, failed units, timers, backups, logs, temporary storage, and stale storage candidates.
- Verified Bitcoin Core, Electrs, API, indexer worker, public health, public consistency, and production observability.
- Verified PostgreSQL size, table growth, index health, conflict counters, duplicate/orphan checks, and logical backup integrity.
- Ran production audit/regression/math gates: ledger audit, Computer events audit, mail regressions, marketplace regressions, summary route readiness, production observability, WORK AMO V8, WORK precision V2, bond exact arithmetic, and full indexer parity.
- Documented cleanup candidates but did not manually remove anything.
- Created this audit log.

## Items requiring approval

1. Targeted derived-index repair for the four missing `canonicalBlockScan` markers and the missing `ticker=INCB` event reference, after canonical Core verification.
2. Internal ID registry audit route fix: checkpoint pinning, retry, resumable scan, or stable-snapshot audit mode.
3. Fresh wallet/marketplace exact-read availability work: queue sizing, readiness budgets, cache behavior, and UI pending/freshness messaging.
4. Backup/query-health coordination so scheduled backups do not create false critical query-health failures.
5. Node release backup cleanup or policy change, especially the 5.78 GB operator-review archive and dry-run-only prune mode.
6. Classification and possible cleanup of the two large INCB final-source replay directories.
7. UI stale release/scratch cleanup for out-of-pattern archives and old temporary directories.
8. Reset stale failed transient systemd units after confirming they are historical.

## Recommended follow-up actions

1. Repair or explicitly waive the two remaining full parity error classes. The recursive audit trail should not normalize a red parity gate.
2. Add a stable-checkpoint mode for `audit:ids` so ID coverage can be proven even while Core/Electrs advances.
3. Add a backup-aware query-health mode before the next scheduled backup cycle.
4. Convert node release pruning from dry-run to active mode only after approving the retained rollback/source evidence set.
5. Perform a classified cleanup review for UI out-of-pattern archives and node replay/evidence directories, recording exact paths and sizes before deletion.
6. Keep monitoring UI free space closely. Current headroom is healthy, but old UI artifacts should still be pruned before they can accumulate into another disk-full incident.
7. Add or tighten monitors for fresh canonical wallet availability, pending verifier queue saturation, and marketplace summary latency.

## Final assessment

Production chain state, confirmed ledger math, public consistency, full-node health, database structural integrity, and the scheduled PostgreSQL backup are healthy as of this audit. The highest current risks are not corruption risks; they are availability, auditability, and storage-retention risks:

- exact fresh-read paths can fail closed or become slow under load,
- the internal ID audit route is not robust against a moving checkpoint,
- scheduled backups create query-health noise,
- stale/evidence storage needs policy decisions,
- and full parity remains red from known derived-index residues.

No evidence was found that canonical confirmed events, transactions, IDs, credits, ledgers, or protocol math are corrupted or duplicated. The system remains recursively verifiable except for the explicitly documented parity residues and the internal ID audit endpoint's inability to complete reliably at a moving tip.


## Ordered application surface read-only audit addendum - 2026-09-26 UTC

### Scope and change policy

This addendum records the ordered read-only application-surface audit requested on 2026-09-26 UTC. The public surfaces were reviewed in this exact order:

1. `proofofwork.me`
2. `id.proofofwork.me`
3. `desktop.proofofwork.me`
4. `browser.proofofwork.me`
5. `boost.proofofwork.me`
6. `amo.proofofwork.me`
7. `credit.proofofwork.me`
8. `wallet.proofofwork.me`
9. `work.proofofwork.me`
10. `infinity.proofofwork.me`
11. `inception.proofofwork.me`
12. `log.proofofwork.me`
13. `growth.proofofwork.me`
14. `computer.proofofwork.me`

No code, configuration, production data, databases, ledgers, backups, logs, infrastructure, services, cleanup, deploys, restarts, or fixes were changed. The only repository write was this approved audit-log append. Live HTTP GETs, browser page loads, SSH status reads, SQL reads, and full-node RPC reads naturally generated normal production access logs.

The previous audit trail was reviewed before this pass. The most relevant prior active issues were H24-01 fresh/exact-read fragility, H24-02 internal ID audit checkpoint sensitivity, H24-03 backup/query-health overlap, H24-04/H24-05/H24-06 storage-retention review items, H24-07 stale failed units, and H24-08 full parity residues.

### Ordered surface results

- Home, `proofofwork.me`: rendered HTTP 200 and redirected to `https://www.proofofwork.me/`. The browser page showed 507 confirmed IDs, 20 pending IDs, and 527 visible records. Registry summary API reads returned 200, including a fresh read.
- ID management, `id.proofofwork.me`: rendered HTTP 200. The page showed the registry overview, ID registration controls, 507 confirmed IDs, 20 pending IDs, and 527 visible records. The full production ID registry audit completed successfully in this run.
- Desktop, `desktop.proofofwork.me`: rendered HTTP 200 with public desktop/file-search controls. No application error was visible.
- Browser, `browser.proofofwork.me`: rendered HTTP 200 with txid input and the static HTML render template. No application error was visible.
- Boost, `boost.proofofwork.me`: rendered HTTP 200. The feed API returned 200 and the page displayed 6 indexed records, total signal, proof signal, WORK signal, and posts. No 5xx was observed in the browser pass.
- AMO, `amo.proofofwork.me`: rendered HTTP 200. The earlier Audit 14 hanging AMO state was not reproduced; the page reached `Ready Canonical AMO summary`. Marketplace summary and listing-history calls returned 200. One duplicate marketplace-summary browser request was aborted client-side during refresh, without a visible data failure.
- Credits, `credit.proofofwork.me`: rendered HTTP 200. Token summary, selected token mint history, and holder reads returned 200. No visible credit data-integrity error was found.
- Wallet, `wallet.proofofwork.me`: rendered HTTP 200. The disconnected wallet view correctly did not claim account-specific balances. The page showed credit wallet controls, transfer/listing controls, the 546-proof mutation fee, and canonical token/work-floor reads returned 200. A low-severity UX issue remains: the disconnected view can still show `Spendable proofs Loading`.
- WORK, `work.proofofwork.me`: rendered HTTP 200. The page showed 21,000,000 / 21,000,000 WORK confirmed, 21,000 mints, 377 holders, and exhausted mint supply. WORK summary, work floor, holder, and mint-history reads returned 200.
- Infinity Bonds, `infinity.proofofwork.me`: rendered HTTP 200 and displayed POWB values, including 630,496,569 POWB confirmed supply, 0 pending supply, about 1.00000779 proofs/POWB floor, and about 630,501,483 proofs network value. During the browser pass, fresh registry-summary and listing-hydration reads returned transient 503s; repeat direct reads recovered to 200.
- Inception Bonds, `inception.proofofwork.me`: rendered HTTP 200 and displayed INCB values, including 224,847,713,398,447,926 INCB fixed issued supply, 0 pending issuance, 1 proof/INCB floor, and 224,847,713,398,447,947.9358206 proofs network value. During the browser pass, registry-summary returned a transient 503; repeat direct read recovered to 200.
- Log, `log.proofofwork.me`: rendered HTTP 200. The earlier Audit 14 `Loading cached Computer log` condition was not reproduced. The page showed 26,058 total actions, 26,036 confirmed, 21 pending, and 5154 KB stored.
- Growth, `growth.proofofwork.me`: rendered HTTP 200. The earlier Audit 14 `Verified Growth ledger unavailable` condition was not reproduced. Growth summary fresh and cached reads returned 200.
- Computer, `computer.proofofwork.me`: rendered HTTP 200 and was checked last as requested. The public shell loaded, but the disconnected Computer view still showed `REGISTRY NETWORK Unavailable` and `No verified registry snapshot available`, while other public surfaces successfully displayed the verified registry summary. This is a UI/rendering availability issue, not proof of index corruption.

### Full-node verification

Bitcoin Core remained authoritative and healthy during the audit:

- Chain: main.
- Full node tip: height 968632 during the first Core check, then 968633 after the next block.
- Best hash at 968632: `0000000000000000000034661e81d3295c320558ab60201160715c5c670ffaa3`.
- Best hash at 968633: `00000000000000000001baea0218f616295c1f0776e1e5d20f7f3d9cb38c2c1d`.
- Headers matched blocks.
- `initialblockdownload=false`.
- `pruned=false`.
- `verificationprogress=1`.
- Core warnings: none.
- Mempool loaded, `fullrbf=true`, `optimal=true`, and unbroadcast count 0.

Representative rendered/indexed records were checked directly against Core:

- ID registration `deb1096a1b628677f1b64f1bd6c350ddf563816132c183823fd8ed058796e666`: confirmed in Core at block height 968428, block hash `0000000000000000000133c25294df30c34e797fc57b58a77f7cc1a61973983f`, 1 OP_RETURN.
- WORK sale-ticket listing `00258f012957a17aa1cf643aa6fca18852cb172b058984bebefececb5d29d100`: confirmed in Core at block height 968007, block hash `00000000000000000000b714201ae47a66c8b5532286cbebbfde7b875cd452d5`, 1 OP_RETURN.
- Recent log/transfer event `ecba56a5b67b42922698fc800809579afa9214a41314a022fa4ddb1572f9cac4`: confirmed in Core at block height 968601, block hash `00000000000000000001b9d97c11c481c503fd2e91ebd7ba72f14f9c1e9ca8e3`, 1 OP_RETURN.

These spot checks matched the application/indexer model of chain-readable OP_RETURN events.

### API, indexer, and database verification

The ordered production surface audit script ran in the requested order and checked page HTML, modules, stylesheets, and per-surface API probes. Every surface through Growth passed. The Computer-last probe failed because `/health` returned HTTP 503 during the run.

The failed health response was not a chain/index lag:

- `available=true`.
- Node, Electrs, database, disk, and index checkpoint were ok.
- Tip and indexed-through block were both 968632.
- Summary snapshot was ok.
- Worker was temporarily not ready because pending protocol-event readiness was reported unhealthy.

Repeat `/health` later recovered:

- `ok=true`.
- `ready=true`.
- `available=true`.
- Tip height 968633.
- Indexed-through block 968633.
- Lag 0.
- Worker ok with pending events ok.

Public consistency passed:

- `/api/v1/consistency?network=livenet&fresh=1`: HTTP 200, `ok=true`, 25 checks, no failures.

Database read-only integrity counts at the current audit point:

- Database size: 34,741,935,127 bytes.
- Transactions: 25,943 total; 25,694 confirmed; 164 pending; 85 dropped.
- Events: 26,554 total; 26,378 confirmed; 162 pending; 14 dropped.
- Event refs: 56,639.
- Event participants: 126,350.
- ID records: 507.
- Credit definitions: 238.
- Credit balances: 425.
- Credit listings: 1,210.
- Duplicate txids: 0.
- Duplicate event identity rows: 0.
- Orphan event refs: 0.
- Orphan event participants: 0.
- Confirmed transactions missing block metadata: 0.
- Pending/dropped transactions with block metadata: 0.
- Negative credit balances: 0.
- Non-integer credit balances: 0.

Known full-parity residues remain unchanged:

- Four confirmed transaction rows still lack `raw_tx.canonicalBlockScan` despite canonical block metadata.
- Event `4256606` still has the INCB token-id ref but not the derived `ticker=INCB` ref.

No new database corruption, duplicate canonical record, block-metadata contradiction, or confirmed/pending status corruption was found.

### ID registry audit

The production ID registry audit was rerun from the node against loopback with the service verifier environment. It completed successfully this time and wrote no reports.

Observed results:

- Fetched registry transactions: 586.
- Covered confirmed registry transactions: 564.
- Covered pending registry transactions: 22.
- Canonical lifecycle parity: verified against exact Core-ordered chain replay.
- Lifecycle events: 537.
- Active listings: 6.
- Canonical sales: 4.
- Registration attempts: 546.
- Confirmed winners: 507.
- Pending candidates: 20.
- Refund candidates: 17.
- Pending watchlist: 2.

This improves the prior H24-02 result: the ID audit endpoint is no longer proven unavailable in this run. It remains operationally sensitive because the successful run was slow enough to appear in API observation as long internal audit and fence requests.

### Math verification

Deterministic math checks passed:

- `check:work-amo-v8`: passed. V8 allowed face proofs `[25000]`, Q16 subatoms, Q8 network value scale, canonical order by block-height/transaction-index/protocol-vout/record-ordinal, and declaration SHA256 `0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d`.
- `check:work-precision-v2`: passed. Global Q16 units, immutable Q8 conversion, V8 pricing, cutover, metadata, and cross-plane wiring verified.
- `check:bond-exact-arithmetic`: passed.
- Production `audit:ledger`: passed for `https://computer.proofofwork.me`, snapshot `7af8a2331898b8ccdd801f48`, value `14407019274173309403.29513116` proofs.
- Summary route readiness passed with V8 readiness true and no stale/invariant failures.

Summary readiness still reported latency warnings:

- `work-summary`: 6382 ms.
- `marketplace-summary`: 9830 ms.
- Warning threshold: 2500 ms.
- Critical threshold: 10000 ms.

No rounding, precision, unit-conversion, accounting, balance, fee, or chain-reconciliation math discrepancy was found in the math gates that completed.

### Health and performance findings

#### H24-OA-01 - API observation timer is actively failing during surface reads

- Severity: high availability and monitoring risk.
- Status: new/materially active condition during this ordered surface audit; related to H24-01 exact-read fragility.
- Evidence: the API observation timer failed at 04:00 UTC and again at 04:05 UTC.
- 04:00 observed routes included `/health` with 3 server errors out of 8, `/api/v1/registry-summary` with 2 server errors out of 8, `/api/v1/token-history` with 2 server errors out of 45, `/api/v1/internal/canonical-summary` p95 13,365 ms with response-latency alert, and `/api/v1/token` max payload 79,755,546 bytes with large-response alert.
- 04:05 observed routes still failed, with `/api/v1/internal/canonical-summary` p95 13,365 ms and response-latency alert, `/api/v1/registry-summary` 1 server error out of 3, `/api/v1/internal/id-registry-audit` p95 100,220 ms, and `/api/v1/internal/id-registry-audit-fence` p95 65,479 ms.
- Impact: public surfaces can render, but exact/fresh reads and monitor windows are still brittle under audit-level GET load. This is availability and observability risk, not confirmed data corruption.
- Recommendation: prioritize route-budget and payload reductions for canonical summary, token, registry-summary, token-history, and exact/fresh paths. Make API observation distinguish expected long internal audit work from user-facing route failures while still alerting on public 5xx and critical latency.

#### H24-OA-02 - Computer disconnected shell does not show the verified registry snapshot

- Severity: medium UI/rendering accuracy risk.
- Evidence: `computer.proofofwork.me` rendered HTTP 200 but displayed `REGISTRY NETWORK Unavailable` and `No verified registry snapshot available` while Home and ID surfaces displayed verified registry counts from successful API reads.
- Impact: a disconnected user can see the main Computer surface as less healthy than the rest of the application even when registry APIs are available and chain/index data are valid.
- Recommendation: hydrate the disconnected Computer shell from the same verified registry summary used by Home/ID, or show a precise disconnected-state message that does not imply global registry unavailability.

#### H24-OA-03 - Large token payloads remain a performance and reliability risk

- Severity: medium to high performance risk.
- Evidence: API observation recorded `/api/v1/token` max payload 79,755,546 bytes in the 04:00 window, above the 8 MiB payload warning budget. Later observation saw smaller token payloads, so this appears route/projection dependent.
- Impact: large token responses can slow wallet/credit/bond surfaces, increase failure probability during exact-read windows, and make browser rendering more fragile.
- Recommendation: prefer bounded projections, paginated wallet/listing views, and explicit full-detail endpoints. Keep full evidence available, but do not make broad UI surfaces pull very large default payloads.

#### H24-OA-04 - Bond surfaces recover but still experience transient registry/listing 503s

- Severity: medium availability risk.
- Evidence: Infinity browser run observed 503s on fresh `registry-summary` and listing hydration. Inception browser run observed a 503 on `registry-summary`. Repeat direct reads recovered to 200 and returned canonical data at tip 968633.
- Impact: bond pages can display main summaries while supplemental registry/listing hydration fails closed or logs console errors.
- Recommendation: continue fail-closed behavior, but reduce exact-read contention and make supplemental hydration retries quieter and more explicit in UI state.

#### H24-OA-05 - Wallet disconnected view leaves a low-value loading label

- Severity: low UX clarity risk.
- Evidence: the Wallet disconnected view displayed `Spendable proofs Loading` after page load, while also correctly saying no wallet was connected and showing no account-specific credit balance.
- Impact: a disconnected user may confuse absence of a wallet with a stuck balance read.
- Recommendation: replace disconnected account balance loading text with an explicit connect-wallet state.

### Previously reported issues rechecked

- Audit 14 AMO incomplete loading: resolved in this run. AMO reached ready canonical summary.
- Audit 14 Log incomplete loading: resolved in this run. Log loaded indexed ledger counts.
- Audit 14 Growth unavailable: resolved in this run. Growth summary rendered and API reads returned 200.
- Audit 14 Computer canonical verification incomplete: partially unresolved. The Computer page now renders the shell, but still reports unavailable registry network in the disconnected view.
- H24-01 fresh/exact-read fragility: still open and materially active. The ordered audit produced transient 503s and API observation failures.
- H24-02 internal ID audit endpoint: improved. The full ID registry audit completed successfully, but the route remains slow and checkpoint-sensitive.
- H24-03 backup/query-health overlap: not re-triggered by this ordered surface pass.
- H24-04 node release backup storage: still open. `/data/proofofwork-release-backups` remains about 8.3 GB and above the review threshold.
- H24-05 UI out-of-pattern release archives: still open. UI storage is healthy but old archives/scratch remain review candidates.
- H24-06 INCB replay directories: still open. Two large replay directories remain around 31 GB and 29 GB.
- H24-07 stale failed units: still open. The UI retains one stale failed boost publish unit; the node retains old failed audit/transient units plus current observation/storage-trend review failures.
- H24-08 full parity residues: still open and unchanged.

### Storage review

UI VPS:

- Root filesystem: 38 GB total, 7.5 GB used, 29 GB available, 22 percent used.
- Inodes: 3 percent used.
- Largest review candidates remain `/var/backups/proofofwork-ui` about 3.5 GB, including releases about 1.3 GB, recovery evidence about 1.5 GB, rollback roots about 222 MB, cleanup evidence about 162 MB, plus `/var/tmp` about 727 MB.
- No UI cleanup was performed.

Node/API VPS:

- Root filesystem: 98 GB total, 21 GB used, 72 GB available, 23 percent used.
- `/data`: 1.7 TB total, 1.1 TB used, 540 GB available, 68 percent used.
- Inodes: healthy.
- Major storage users: `/data/bitcoin` about 912 GB, `/data/electrs` about 60 GB, PostgreSQL tablespaces about 32 GB, PostgreSQL backups about 18 GB, release backups about 8.3 GB, INCB final-source replay directories about 31 GB and 29 GB, `/tmp` about 4.7 GB, and `/var/tmp` about 517 MB.
- Node release health passed for live commit `2f0b32356677f8ba7187f26f34611d0295947820`, with 5 verified archives and 0 unverified archives.
- Node storage trend still fails intentionally because `/data/proofofwork-release-backups` crossed the review threshold. It reported `/data` status ok and about 471.9 GB headroom beyond the 100 GiB reserve.
- No node cleanup was performed.

### Actions requiring explicit approval

1. Any fix to exact/fresh read availability, route budgets, API observation behavior, or payload projection.
2. Any fix to the Computer disconnected registry snapshot state.
3. Any wallet disconnected-state UI change.
4. Any derived-index parity repair for the four missing `canonicalBlockScan` markers and missing `ticker=INCB` ref.
5. Any cleanup of UI release artifacts, node release backups, INCB replay directories, `/tmp`, `/var/tmp`, logs, caches, or backup/evidence material.
6. Any reset of failed systemd unit state.
7. Any deployment, restart, database repair, ledger/protocol edit, or infrastructure change.

### Recommended improvements

1. Treat H24-OA-01 as the highest priority from this ordered pass: make the public API surfaces withstand audit-level read load without 5xx, and keep API observation green during normal exact-read work.
2. Reduce default payload size for `/api/v1/token` and any UI path that can request a full token object when a bounded projection is enough.
3. Make the Computer disconnected shell use the same verified global registry summary as Home/ID, or present a precise disconnected account-only state.
4. Keep the successful ID audit path but make it less disruptive to observation windows, either by snapshot-pinning, resumable reads, or monitor classification for internal verifier work.
5. Continue storage classification before deletion. The system has healthy free space now, but the current review candidates are exactly the kind of retained material that can become future capacity risk if left unattended.

### Addendum assessment

The ordered application surfaces are materially healthier than the September 19 ordered audit: AMO, Log, and Growth now load verified data. Full-node, database, consistency, ledger, and deterministic math checks support the displayed confirmed data. No new corruption, duplicate canonical record, balance math failure, fee math failure, or confirmed/pending reconciliation error was found.

The main risk found by this read-only ordered pass is operational: exact/fresh API reads still produce intermittent 503s, slow summary/internal audit routes, large payloads, and active API observation timer failures. Computer's disconnected shell also under-renders global registry health compared with the rest of the application. These require explicit approval before any fix or cleanup is attempted.
