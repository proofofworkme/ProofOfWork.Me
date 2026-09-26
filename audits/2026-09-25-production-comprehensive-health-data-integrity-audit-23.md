# Production comprehensive health and data-integrity audit 23

**Audit date:** 2026-09-25 UTC / America-Toronto
**Refresh window:** approximately 19:45-20:05 UTC
**Scope:** read-only health and data-integrity audit of the UI VPS, node VPS, PostgreSQL database, Bitcoin Core full node, Electrs, ProofOfWork API, indexer worker, mempool visibility, public application endpoints, log/backup/storage growth, event ingestion, confirmed/pending rendering surfaces, and deterministic protocol math.
**Predecessors reviewed:** Audit 20, Audit 21, and Audit 22, including the open capacity, backup, AMO/history, latency, cold-read, Desktop, and release-readiness finding families. This report records current status, new regressions, and unresolved items without duplicating fixed prior issues.
**Mutation policy:** no production data, chain record, ledger, evidence, database row, backup, rollback, cache, log, service configuration, wallet state, or protocol record was changed. No cleanup candidate was removed.

## Executive summary

The canonical node, indexer, and public API are currently synchronized at block **968581** with zero reported index lag. Bitcoin Core is out of initial block download, unpruned, at verification progress 1, and reports no warnings. `/health` is ready and available; `/api/v1/consistency` is green with all **25/25 checks passing** and no missing log events. The public ledger audit, Computer event audit, ID registry audit, mail regression gate, marketplace regression fast gate, and local exact-math gates all passed.

The highest operational risk remains storage discipline. The UI VPS has recovered from the near-full condition recorded in Audit 21, but it still has only **13,144,010,752 B available** on a 39,973,924,864 B root filesystem. That is only about **2.41 GB above the 10 GiB operating reserve**, and the UI storage-trend monitor is warning that the current observed net-consumption rate could reach the reserve in about **30.5 hours** if it continues. `/var/backups/proofofwork-ui` is about **17.8 GB**, `/var/tmp/proofofwork-deploy` is about **2.96 GB**, and older UI rollback/release/recovery artifacts remain cleanup candidates that require exact safety proof before deletion.

The node VPS has strong current headroom: root has **74,537,840,640 B available** and `/data` has **580,470,898,688 B available**. Its storage-trend monitor still requests review because node release backups exceed the review allocation threshold. The most serious node-side findings are operational rather than consensus failures: the current PostgreSQL logical-backup unit failed retention verification for the latest candidate, and the node release-health attestation failed because `.git/index` has an unsafe mode. API observation health is also red because summary routes continue to be slow.

No corruption, duplicate confirmed identity, orphaned event relation, negative credit balance, noninteger balance, duplicate confirmed mail key, confirmed event without a transaction, or block/hash mismatch was found in the bounded checks. The full `indexer:parity` command did not pass; the visible failure path is the known WORK AMO V5 readiness/migration-not-complete family, not a newly observed row-duplication or ledger-math mismatch. This remains approval-required follow-up because the output is too large to treat as a closed pass.

## Systems and services checked

| Area | Result |
| --- | --- |
| UI VPS `ubuntu-4gb-hel1-1` | Caddy active; public surfaces returned 200/301/308 as expected in local HTTPS smoke checks; release provenance service verified the deployed UI release. |
| Node VPS `pow-bitcoin-01` | Bitcoin Core, Electrs, PostgreSQL, API, WireGuard API, indexer worker, Docker/containerd, and mempool containers are active. |
| Bitcoin Core | Mainnet height/header 968581, hash `000000000000000000014eae325c224b29550fc9623077e4416244da3bc123dc`; unpruned; not in IBD; mempool loaded; 124 peers at sample time. |
| PostgreSQL `proof_indexer` | Size 34,533,112,855 B; invalid or unready indexes 0; unvalidated constraints 0; deadlocks 0; lock waits 0. Physical page integrity is not certified because checksums are off and `amcheck` was not run. |
| API/indexer | `/health` ready and available, indexedThroughBlock 968581, lagBlocks 0, summary coverage complete. |
| Public endpoints | `consistency`, `work-floor`, `work-summary`, marketplace, mail, ledger, and ID audits sampled. |
| Logs and monitors | Service logs for Core/Electrs/API/indexer/PostgreSQL had no new warning-or-higher entries in the sampled windows, but monitor units report storage trend, API latency, backup verification, and release attestation failures. |

## Health and capacity results

### UI VPS

| Measurement | Value |
| --- | ---: |
| Uptime | 140 days |
| RAM total / available | 4,005,457,920 B / 3,391,700,992 B |
| Swap | 0 B |
| Root filesystem total / used / available | 39,973,924,864 B / 25,145,720,832 B / 13,144,010,752 B |
| Root filesystem use | 66% |
| Inodes used | 110,394 of 2,427,136, about 5% |
| Journal usage | about 292 MB |
| `/var/log` | about 657 MB |
| `/var/www` | about 232 MB |
| `/var/backups/proofofwork-ui` | about 17.8 GB |
| `/var/tmp/proofofwork-deploy` | about 2.96 GB |

The UI capacity emergency from Audit 21 is improved but not closed. The storage monitor still marks the host for review because forecasted growth can consume the reserve quickly. Large current candidates are UI backups, rollback roots, classified rollback roots, rollback classifications, release archives, recovery evidence, deployment scratch, and old temporary UI tarballs. These were documented only. They are not certified safe to delete until live release identity, rollback compatibility, recovery-evidence dependencies, and the one last verified rollback/backup set are proven under lock.

The UI release provenance service verified release `388572b6c8eb-20260925T095718Z`, commit `388572b6c8eba5c9025fabd8d90fbbf82c9f99d2`, archive SHA-256 `be7960c521378a8883ad5a0948c20354cc0f8d129de7722218d3da9e6c72eac3`.

### Node VPS

| Measurement | Root | Data volume |
| --- | ---: | ---: |
| Filesystem total | 105,089,261,568 B | 1,764,768,071,680 B |
| Used | 25,165,934,592 B | 1,175,309,996,032 B |
| Available | 74,537,840,640 B | 580,470,898,688 B |
| Use | 26% | 67% |

Node memory is healthy: 134,125,752,320 B total, about 116,074,610,688 B available at sample time. Swap usage was 1,235,484,672 B of 17,179,865,088 B. Inodes are not pressured.

Important storage allocations and review candidates:

| Area | Current observation | Status |
| --- | --- | --- |
| Bitcoin Core chain data | Core reports `size_on_disk=878,856,289,065` B | Active canonical full-node data; do not remove. |
| PostgreSQL tablespaces | about 33.9 GB | Active database storage. |
| PostgreSQL backup area | about 17.6 GB | Current logical backup verification is failing; do not prune until restore/retention proof exists. |
| `/data/proofofwork-incb-final-source-replay-20260924T143604Z` | about 17 GB, including `baseline.dump` | New large replay/evidence candidate; preserve until classified. |
| Node release backups | 8,643,080,192 B | Crosses review threshold; requires retention proof before cleanup. |
| `/tmp` on node | about 4.2 GB | Contains old tar, bundle, JSON, and staged artifacts; cleanup candidates only after exact live-use classification. |
| Docker images | about 3.75 GB reclaimable by Docker accounting, but active images exist | Do not prune without service/release proof. |

## Database health and integrity

The database is about **34.53 GB**. The largest table remains `work_amo_block_transitions` at about **33.13 GB**, roughly 95.9% of the database. Other large relations are `ledger_snapshots` about 831 MB, `events` about 156 MB, `transactions` about 107 MB, `event_participants` about 66 MB, `tx_outputs` about 60 MB, `event_refs` about 41 MB, `credit_listings` about 40 MB, `op_returns` about 31 MB, and `tx_inputs` about 27 MB.

Read-only integrity checks found:

| Check | Result |
| --- | --- |
| Duplicate transaction IDs | 0 |
| Duplicate event keys | 0 |
| Events missing transaction rows | 0 |
| Orphan event participants | 0 |
| Orphan event refs | 0 |
| Duplicate confirmed mail identities | 0 |
| Duplicate ID records | 0 |
| Negative credit balances | 0 |
| Noninteger credit balances | 0 |
| Duplicate listing IDs | 0 |
| Duplicate sale-ticket outpoints | 0 |
| Confirmed events or transactions missing block metadata | 0 |
| Pending/dropped rows with block metadata | 0 |

Current status counts sampled from the database and Computer audit include 25,943 transactions, 25,686 confirmed transactions, 178 pending transactions, 79 dropped transactions, 26,554 events, 26,028 confirmed valid events, 272 confirmed token-event-invalid audit rows, 238 confirmed credit definitions, 422 credit balances, 1,208 credit listings, 507 ID records, 617 confirmed mail items, and 25,809 OP_RETURN rows.

Scope limitation: this does not certify physical page integrity, storage media, or restoreability. PostgreSQL checksums are off, no `amcheck` pass was performed, and the current logical-backup unit failed verification.

## Node, indexer, mempool, and rendering status

Bitcoin Core and the API agree on block **968581** and hash `000000000000000000014eae325c224b29550fc9623077e4416244da3bc123dc`. Core mempool was loaded with about 81,408 transactions, 42,438,153 bytes, 237,116,584 B memory usage, 2,000,000,000 B max mempool, full RBF enabled, and zero unbroadcast transactions at the sample.

The API health response reports canonical metadata, index coverage, database health, disk checks, Electrum checks, and worker readiness as green at the same tip. The consistency endpoint returned green with all 25 checks passing, including log coverage, token components, INCB issuance, POWB flow, WORK/Growth totals, marketplace mutation fees, credit miner-fee coverage, and checkpoint provenance.

The Computer event audit passed with no failures or warnings. It confirmed that required log coverage checks are present, ledger snapshots cover the node tip with lag 0, confirmed events have transaction rows, confirmed transactions have raw data, event refs and participants are populated, block metadata is present, and WORK/Growth/marketplace network values match.

The ID registry audit verified canonical lifecycle parity against exact Core-ordered chain replay. It covered 586 registry transactions, 564 confirmed registry transactions, 22 pending registry transactions, 537 lifecycle events, 507 confirmed registration winners, 20 pending candidates, 17 confirmed refund candidates, and two pending duplicate-watch candidates. This is expected registry bookkeeping, not corruption.

Mempool status accuracy is bounded by the sampled checks. Pending visibility is best-effort and was not proven complete against every Core mempool transaction. The public mail regression passed all eight sampled mailbox histories, and marketplace fast regressions passed against production.

## Protocol and application math verification

The following deterministic checks passed:

| Check | Result |
| --- | --- |
| `npm run audit:ledger` against `https://computer.proofofwork.me` | Passed; snapshot `3b049ed52a74f8daab4cefdb`, value `14407019274101906824.69463218` proofs. |
| Node-side `npm run audit:computer-events` | Passed; failures and warnings empty. |
| Node-side `npm run audit:ids` | Passed canonical lifecycle parity. |
| `npm run check:marketplace-regressions` against production | Passed fast marketplace regression gate. |
| `npm run check:mail-regressions` against production | Passed eight mailbox cases. |
| `npm run check:work-amo-v8` | Passed V8 precision/gating contracts. |
| `npm run check:work-precision-v2` | Passed Q16/Q8 conversion, immutable Q8 conversion, V8 pricing, cutover, metadata, and cross-plane wiring. |
| `npm run check:bond-exact-arithmetic` | Passed exact bond arithmetic contracts. |

The live WORK floor response agrees across exact string values and display numbers. It reported exact `totalSats=14407019274101906824.69463218` and `floorSats=686048536861.99556308`, with confirmedComputerActions 26,028, confirmedTokens 238, mints 21,875, sales 86, powids 507, marketplaceSaleVolumeSats 9,675,286, and marketplaceMutationFeeSats 1,333,878. Large rounded JSON numeric aliases remain display values; exact decimal strings are the arithmetic authority.

The full `indexer:parity` command exited nonzero. Visible output showed WORK AMO V5 readiness/migration warnings, including `migration-not-complete`, `work-amo-v5-token-state-supply-invalid`, and `usd-quote-head-missing`, while canonical positions showed no duplicate or missing positions. Because this command did not pass, AMO V5 parity cannot be marked closed even though the production fast marketplace regression now passes H9-01.

## Previously reported issues rechecked

| Existing issue/family | Audit 23 status |
| --- | --- |
| H9-01 pre-unit WORK AMO relic in exact closed-listing history | **Rechecked resolved on the production fast/exact route.** The exact closed-listings query no longer returned relic `4e9ced...b6feb1`, and the production marketplace fast regression passed. Keep full parity open because `indexer:parity` did not pass. |
| H5-01 / H13-01 UI capacity reserve | **Still open, improved but warning.** UI free space is 13.14 GB, no longer only 76.78 MiB above reserve, but trend forecast and large backup/scratch allocations still threaten recurrence. |
| H8-05 / H10-02 backup retention and database growth | **Still open.** The latest PostgreSQL logical-backup candidate failed retention verification, and no restore proof was established. |
| H7-01 / H10-07 / A11-03 summary size and latency | **Still open, partially improved.** Marketplace summary payloads are much smaller than Audit 21's 32 MB sample, but p95 route latency remains around 11-15 seconds in monitor samples. |
| H20-01 unbounded mempool/nginx log growth | **Partially improved or not reproduced in the same form.** Node `/var/log` and Docker writable layers are not presently the dominant risk, but active container-log rotation was not fully re-audited. |
| H5-06 / H10-05 / H12-06 / H18 availability and latency | **Still open.** Readiness is green, but slow summary routes and stale/fail-closed V8 metadata in one marketplace-summary sample show the family is not fully closed. |
| WORK AMO V8 readiness/admission intermittency | **Partially open.** `/api/v1/work-summary` reports V8 ready, active, canonical, declaration-ready, precision-migration-ready, and write-admission true. One marketplace-summary sample still reported `work-amo-v8-declaration-evidence-unavailable`, so cross-route readiness metadata is not consistently green. |
| H5-02 cold ID false-zero presentation | Not browser-retested in this audit; remains governed by Audit 22 source remediation and production deployment status. |
| H20-03 Desktop duplicate self-send tile | Not browser-retested in this audit; no new duplicate data found in database checks. |
| H20-04 missing Log confirmation label | Not browser-retested in this audit. |
| H19-02 / H19-03 transaction provider outage and stale cache cases | Not fault-injected live in this audit. |

## New findings

| Finding | Severity | Source and impact | Recommended correction |
| --- | --- | --- | --- |
| H23-01 current logical PostgreSQL backup failed retention verification | High | `proofofwork-postgres-logical-backup.service` failed with `candidate=/data/proofofwork-postgres-backups/logical/proof_indexer-20260925T031848Z.dumpset predicate=member-inventory`. This means the newest candidate must not be treated as a valid rollback/restore point. | Preserve older backups until a new logical backup passes inventory and restore rehearsal, including globals/roles. Do not prune backup generations based on this failed candidate. |
| H23-02 node release attestation failed on unsafe Git index mode | Medium | `proofofwork-node-release-health.service` reports `.git/index` unsafe mode and live node runtime attestation failed. This blocks treating the live checkout as fully attested even though services are running. | Inspect file ownership/mode and release attestation expectations under approval; correct only after proving no live code mutation or provenance loss. |
| H23-03 UI storage reserve can be exhausted again by backup/scratch growth | High | UI free space is improved to 13.14 GB, but the forecast leaves only about 2.41 GB above the 10 GiB reserve and large rollback/backup/scratch sets remain. Previous production failures occurred when this host filled. | Run an approved retention pass that preserves exactly the last verified rollback/backup needed for recovery, then remove only proven-obsolete backup/scratch artifacts. |
| H23-04 marketplace-summary V8 readiness metadata can disagree with work-summary | Medium | `work-summary` showed V8 fully ready, while a marketplace-summary sample still failed closed with `work-amo-v8-declaration-evidence-unavailable`. This can confuse operators or suppress AMO state in one route while another route is green. | Trace shared readiness evidence loading and cache invalidation for marketplace-summary; add a cross-route readiness regression. |
| H23-05 full indexer parity command still fails | Medium | `indexer:parity` exited 1 with visible V5 migration/readiness failures despite no duplicate/missing canonical positions in the visible section. | Produce a compact parity failure artifact, separate historical V5 warnings from active invariants, and close only after the full gate exits 0 or the known warnings are explicitly qualified. |

## Actions taken

- Reviewed prior audit logs and open issue families before assigning statuses.
- Ran read-only host capacity, service, database, node, API, log, storage, and regression checks across both VPS environments.
- Ran production-facing read-only audit/regression gates for ledger, Computer events, ID registry, marketplace, and mail.
- Ran local deterministic math gates for WORK precision V2, WORK AMO V8, and bond exact arithmetic.
- Documented cleanup candidates and approval-required items.
- Created this audit log only. No production cleanup, restart, deploy, repair, restore, prune, truncation, or data change occurred.

## Items requiring approval

No stale production item is certified for automatic deletion. The following require explicit approval after exact safety proof:

| Candidate | Required proof before deletion |
| --- | --- |
| Old UI rollbacks, classified rollback roots, rollback classifications, release archives, and recovery evidence | Prove live release identity, one compatible verified rollback, recovery-evidence dependencies, and deploy lock state. |
| `/var/tmp/proofofwork-deploy` scratch and old `/tmp` UI tarballs | Prove no active publisher, rollback, or recovery workflow references them. |
| Old PostgreSQL logical/physical backups | First produce a newest successful backup with member inventory, checksum/TOC validation, and isolated restore rehearsal including globals/roles. |
| Node release backups and old `/opt/proofofwork-api-stage-*` checkouts | Prove the live release and last verified rollback, then preserve their exact provenance artifacts. |
| Node `/tmp` staged tar/bundle/JSON artifacts | Classify each artifact as replay evidence, release input, current diagnostic artifact, or disposable scratch before deletion. |
| Docker images and container logs | Verify active image/container dependencies and design bounded rotation without deleting evidence or active logs. |

## Recommended follow-up

1. Treat UI free-space protection as urgent. Inventory exact UI backup/rollback/scratch dependencies and request approval for a small, proven-safe cleanup batch that leaves one last verified rollback/backup.
2. Fix the failing PostgreSQL logical-backup verification before pruning any database backups.
3. Fix or explicitly qualify the node release attestation failure.
4. Reduce summary route latency and add alerting that separates slow-but-correct responses from stale readiness metadata.
5. Produce a compact `indexer:parity` failure summary so known historical V5 warnings can be distinguished from active invariant failures.
6. Add a cross-route WORK AMO V8 readiness check comparing `work-summary`, `marketplace-summary`, worker readiness, and declaration evidence at the same checkpoint.
7. After approved cleanup and backup repair, rerun this audit and record exact before/after reclaimed bytes, retained rollback identities, backup restore proof, and service health.


## Approved UI scratch cleanup receipt

**Approval:** the user approved the exact UI scratch cleanup batch after the read-only preflight: remove non-current `/var/tmp/proofofwork-deploy` scratch entries and two old `/tmp` UI transport tarballs, while preserving current release scratch for `388572b6c8eb-20260925T095718Z`.

**Execution time:** 2026-09-25 20:17:33-20:17:35 UTC.

The cleanup script was self-checking and aborted unless all approval-package guard values matched. The live release marker still reported `release_id=388572b6c8eb-20260925T095718Z`; the candidate set was exactly 52 non-current deploy-scratch entries totaling 2,636,457,335 B plus two `/tmp` tarballs totaling 272,042,576 B. Total approved removal was **2,908,499,911 B**. No UI backup, rollback, release archive, recovery evidence, `/var/www` live surface, Caddy config, service config, database, protocol record, ledger, or production log was removed or changed.

| Measurement | Before | After |
| --- | ---: | ---: |
| UI root used | 25,145,843,712 B | 22,158,262,272 B |
| UI root available | 13,143,887,872 B | 16,131,469,312 B |
| UI root use | 66% | 58% |
| `/var/tmp/proofofwork-deploy` | 2,866,281,120 B | 229,823,785 B |
| Removed deploy scratch | 52 paths / 2,636,457,335 B | removed |
| Removed `/tmp` UI transports | 2 paths / 272,042,576 B | removed |

Preserved current-release scratch entries:

- `/var/tmp/proofofwork-deploy/proofofwork-ui-source-388572b6c8eb-20260925T095718Z`
- `/var/tmp/proofofwork-deploy/release-388572b6c8eb-20260925T095718Z`
- `/var/tmp/proofofwork-deploy/audit5-stream-source-388572b6c8eb-20260925T095718Z.json`
- `/var/tmp/proofofwork-deploy/audit5-stream-surfaces-388572b6c8eb-20260925T095718Z.json`

Removed old `/tmp` UI transport files:

- `/tmp/proofofwork-ui-source-84a9871040db-20260918T190233Z.tgz`
- `/tmp/proofofwork-ui-surfaces-84a9871040db-20260918T190233Z.tgz`

Post-cleanup verification:

- Caddy remained active.
- UI release provenance remained verified for release `388572b6c8eb-20260925T095718Z`, commit `388572b6c8eba5c9025fabd8d90fbbf82c9f99d2`, archive SHA-256 `be7960c521378a8883ad5a0948c20354cc0f8d129de7722218d3da9e6c72eac3`.
- Local HTTPS smoke checks returned expected statuses: `proofofwork.me` 301; `www`, `id`, `computer`, `desktop`, `browser`, `boost`, `growth`, `log`, `wallet`, `work`, `infinity`, and `inception` 200; `marketplace` 308.
- The two approved `/tmp` transport paths were absent after cleanup.
- No active UI publisher process was found other than the inspection command itself; Caddy and sshd remained the only matching long-lived processes in the sampled process output.


## Approved PostgreSQL logical-backup repair receipt

**Approval:** the user approved the proposed backup-repair scope: update the logical-backup verifier script, deploy it to the node VPS, run one controlled logical backup under systemd, retain only the newest verified backup, and record proof.

**Execution time:** 2026-09-25 20:30:07-20:46:19 UTC.

**Script deployed:** `deploy/proofofwork-postgres-logical-backup.sh` was updated with deterministic `LC_ALL=C` inventory sorting, predicate-level verifier diagnostics, and member-inventory details for future verification failures. The deployed node script at `/usr/local/sbin/proofofwork-postgres-logical-backup` matched local SHA-256 `deabaa4f532d85f67ed3d8a22606098bf0e1730cc2a7d0dbf1107eba84510528`, installed as `root:root` mode `0755`.

**Controlled run result:** `proofofwork-postgres-logical-backup.service` completed successfully. The service passed the capacity gate with `available_bytes=580452261888`, `reserve_bytes=107374182400`, and `maximum_dump_bytes=39074601906`. Systemd recorded successful completion at 20:46:19 UTC, CPU time 13min 7.616s, memory peak 13.4G, and 0B swap peak.

**Retained verified backup:** `/data/proofofwork-postgres-backups/logical/proof_indexer-20260925T203007Z.dumpset`.

| Proof item | Result |
| --- | --- |
| Service retention verification | `backup_retention_kept ... bytes=18177098982 verified_sha256=true restore_catalog=true` |
| Independent manifest verification | `proof_indexer.dump: OK`; `globals.sql: OK` |
| Independent restore-catalog proof | `pg_restore --list proof_indexer.dump` produced 212 lines |
| Directory ownership/mode | `postgres:postgres 700` |
| Dump ownership/mode/size | `postgres:postgres 600 18177097682 proof_indexer.dump` |
| Globals ownership/mode/size | `postgres:postgres 600 1137 globals.sql` |
| Manifest ownership/mode/size | `postgres:postgres 600 163 SHA256SUMS` |
| Dump SHA-256 | `2bebd6f462c8a0ec08ae8b493c3e45a35efc244a7556666c367464f0160ca8e6` |
| Globals SHA-256 | `4ae545051a6494fe7e034d62e8f69a8d2a304f9ce6259b90758ed020f664a896` |
| Manifest SHA-256 | `7245c8ecc57e1ac79b8626c8f07bbf27b47de823517d843045b8b42f0deb7162` |

**Retention action:** the script deleted the older complete set only after re-verifying it: `/data/proofofwork-postgres-backups/logical/proof_indexer-20260924T031852Z.dumpset`, `bytes=17570940420`, `verified_sha256=true`, `restore_catalog=true`. No database rows, protocol records, ledgers, evidence records, or historical chain data were modified.

| Measurement | Before controlled run | After controlled run |
| --- | ---: | ---: |
| `/data` used | 1,175,328,632,832 B | 1,175,942,782,976 B |
| `/data` available | 580,452,261,888 B | 579,838,111,744 B |
| `/data` use | 67% | 67% |
| Logical backup retained set | `proof_indexer-20260924T031852Z.dumpset` | `proof_indexer-20260925T203007Z.dumpset` |
| Retained-set verification status | independently coherent but prior service red | service green plus independent checksum/catalog proof |
| Logical backup service | failed, `ExecMainStatus=1` | inactive/dead with `Result=success`, `ExecMainStatus=0` |
| Logical backup timer | disabled/inactive | still disabled/inactive; enabling requires explicit approval |

**Temporary files removed:** the deploy upload `/tmp/proofofwork-postgres-logical-backup.deabaa4f` (15,497 B) and the verification restore-list `/tmp/proof_indexer-20260925T203007Z.pg_restore.list` (19,253 B) were removed after verification.

**Post-backup service health:** `postgresql`, `bitcoind`, `electrs`, `proofofwork-api`, `proofofwork-api-wg`, and `proofofwork-indexer-worker` were active after the run. PostgreSQL responded read-only with `pg_database_size=34561555479` B at `2026-09-25 20:50:00 UTC`. Public `https://computer.proofofwork.me/health` returned `ready=true`, `available=true`, `indexedThroughBlock=968585`, and `lagBlocks=0`. The old unit name `proofofwork-indexer` is inactive; the active production worker unit is `proofofwork-indexer-worker`.

**Status update for H23-01:** current PostgreSQL logical-backup verification is repaired for the retained backup generation. The remaining backup operations item is scheduling: the logical-backup timer is still disabled and inactive, so recurring automated logical backups require explicit approval to re-enable or an explicit decision that manual controlled backups are desired.


## Approved node release-health attestation repair receipt

**Approval:** the user approved a minimal node release-health repair pass, then approved removal of stale staged node checkouts after the critical attestation passed and release-health failed only on bounded checkout inventory.

**Execution time:** 2026-09-25 20:55:34-21:11:30 UTC.

**Metadata repair:** `/opt/proofofwork-api/.git/index` was changed from `0664` to `0600`, preserving `powadmin:powadmin` ownership and file size `54651` B. No checkout content, tracked source file, dependency tree, release archive, provenance file, database, ledger, evidence record, or protocol record was changed.

**Critical attestation proof after mode repair:** `proofofwork-node-release-health.service` advanced past the prior `Checkout file has an unsafe mode: .git/index` failure and reported live release evidence for commit `1149633c2d1a5c62c4a800772daa79683e478796`, tree `6071ed84ae3cad5a852ef3d4bb0c87c9d1d64e29`, runtime SHA-256 `f1dc4a7b4c75eb48482b544cd720bb51d44ab079f5613ab320825f836405e8d4`, `archives=3`, `verified=3`, `unverified=0`, `legacy_absolute=0`, `provenance=3`, and `current_provenance=1`. The only remaining failure was `opt_checkouts=17` above the bounded inventory limit.

**Retained checkouts:**

| Role | Path | Commit | Notes |
| --- | --- | --- | --- |
| Live | `/opt/proofofwork-api` | `1149633c2d1a5c62c4a800772daa79683e478796` | Current release; release archive and current provenance verified by release-health. |
| Last verified rollback | `/opt/proofofwork-api-stage-1149633c2d1a-20260924T015319Z` | `58827586d1a313c6210c3ce599dd46269eeddebc` | Detached checkout with real `node_modules`, no untracked non-ignored paths, no non-runtime ignored paths, `.git/index` mode `0600`; matching managed release provenance exists for `proofofwork-node-release-5882758-20260923T213800Z.tgz`. |

**Approved stale staged-checkout cleanup:** the following 15 staged checkouts were deleted after guards verified exact path prefix, canonical real directory identity, expected commit identity, no protected path collision, private live/rollback index modes, and no open files under any candidate path.

| Removed path | Commit | Bytes |
| --- | --- | ---: |
| `/opt/proofofwork-api-stage-083e449d4e30-20260915T221419Z` | `03ab8d1d98d14d29387721051e398761fcac453e` | 240,685,056 |
| `/opt/proofofwork-api-stage-219f3861411c-20260923T212500Z` | `219f3861411c88b7458487c4a7aa17c3230b7002` | 246,079,488 |
| `/opt/proofofwork-api-stage-35d21493757d-20260922T033203Z` | `35d21493757d439b87d22cec6bb6d06f0466d31a` | 243,937,280 |
| `/opt/proofofwork-api-stage-538ccdb-20260914T043258Z` | `ea66f9502709939b75e46949f649583ab18d533b` | 200,278,016 |
| `/opt/proofofwork-api-stage-589bc71e7c96-20260919T172951Z` | `589bc71e7c967782fda66bb9193fe0e31a89a03a` | 242,065,408 |
| `/opt/proofofwork-api-stage-5fb9c750e4a5-20260915T191100Z` | `5fb9c750e4a5cdaa62d15c6fe853043ba4280729` | 157,130,752 |
| `/opt/proofofwork-api-stage-661e576453ca-20260922T025214Z` | `661e576453caddbd622c5c6255d1de0001bf4804` | 243,908,608 |
| `/opt/proofofwork-api-stage-8223f1d-20260917T025055Z` | `96b9b582f101f103bbf59cede4727e2c7a2ce372` | 280,727,552 |
| `/opt/proofofwork-api-stage-9795c8a9aab9-20260925T090900Z` | `9795c8a9aab9f0ca469cf4fd63b59f6b86fd4119` | 247,029,760 |
| `/opt/proofofwork-api-stage-a4d2548f55b0-20260922T040224Z` | `a4d2548f55b08c03a590a10e150f70c2f74ad758` | 243,957,760 |
| `/opt/proofofwork-api-stage-a6d1d77eb0eb-20260919T225900Z` | `1f467cc59f41ed284f89d854ebd943525fe5b525` | 241,963,008 |
| `/opt/proofofwork-api-stage-b245c2e-20260914T041150Z` | `be715e95b9983941f2b3c9067576a3bf19b717c0` | 193,052,672 |
| `/opt/proofofwork-api-stage-ca732ca-20260916T045505Z` | `598f107814611f2000c021a5519c56aa90522f24` | 157,401,088 |
| `/opt/proofofwork-api-stage-dbfc3f2614a1-20260922T034136Z` | `dbfc3f2614a1a2a215ba56482a416712b1e45faf` | 243,953,664 |
| `/opt/proofofwork-api-stage-fc40384d40d7-20260925T051615Z` | `fc40384d40d7766a41eac25fee906ccfc27abb4b` | 247,025,664 |

| Measurement | Before cleanup | After cleanup |
| --- | ---: | ---: |
| Staged checkouts | 16 | 1 |
| Total live/staged checkouts | 17 | 2 |
| Root filesystem used | 25,181,372,416 B | 21,752,176,640 B |
| Root filesystem available | 74,522,402,816 B | 77,951,598,592 B |
| Reclaimed bytes | 0 B | 3,429,195,776 B |

**Release-health result after cleanup:** `proofofwork-node-release-health.service` completed successfully at `2026-09-25 21:11:30 UTC` with `ExecMainStatus=0`. It reported live commit `1149633c2d1a5c62c4a800772daa79683e478796`, live tree `6071ed84ae3cad5a852ef3d4bb0c87c9d1d64e29`, runtime SHA-256 `f1dc4a7b4c75eb48482b544cd720bb51d44ab079f5613ab320825f836405e8d4`, `archives=3`, `verified=3`, `unverified=0`, `legacy_absolute=0`, `provenance=3`, `current_provenance=1`, and `opt_checkouts=2`.

**Post-cleanup service health:** `postgresql`, `bitcoind`, `electrs`, `proofofwork-api`, `proofofwork-api-wg`, and `proofofwork-indexer-worker` were active. Public `https://computer.proofofwork.me/health` returned `ready=true`, `available=true`, `indexedThroughBlock=968589`, and `lagBlocks=0`.

**Status update for H23-02:** node release attestation is repaired. The live node release now has a successful release-health attestation with a bounded checkout inventory and one retained verified rollback checkout.


## Approved UI rollback-payload cleanup receipt

**Approval:** the user approved the exact UI cleanup batch proposed after the read-only retention preflight: remove the 59 inventoried stale UI rollback/archive/classification paths while retaining the current live release, its archive/provenance/checksum triplet, and one verified rollback root/archive.

**Execution time:** 2026-09-26 00:53:48-00:53:59 UTC.

**Guarded pre-delete verification:**

- Live UI manifest remained `/var/www/.proofofwork-ui-release` with release `388572b6c8eb-20260925T095718Z`, commit `388572b6c8eba5c9025fabd8d90fbbf82c9f99d2`, archive `proofofwork-ui-release-388572b6c8eb-20260925T095718Z.tgz`, and archive SHA-256 `be7960c521378a8883ad5a0948c20354cc0f8d129de7722218d3da9e6c72eac3`.
- Live release archive verification passed: `proofofwork-ui-release-388572b6c8eb-20260925T095718Z.tgz: OK`.
- Retained rollback root existed at `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-388572b6c8eb-20260925T095718Z` and carried rollback release `bfc54c826db1-20260923T152920Z`.
- Retained rollback archive verification passed: `proofofwork-ui-release-bfc54c826db1-20260923T152920Z.tgz: OK`.
- `lsof +D /var/backups/proofofwork-ui` returned status `1` with no open files listed; this was treated as no active file handles under the cleanup tree.
- Candidate count matched the approved inventory: `59`.
- Candidate disk-usage bytes matched the approved inventory: `14,094,131,200` B.

**Retained UI rollback/backup identities:**

| Role | Path or identity | Verification |
| --- | --- | --- |
| Current live UI release | `388572b6c8eb-20260925T095718Z` | Manifest release, commit, archive name, and archive SHA-256 matched expected values. |
| Current live archive | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-388572b6c8eb-20260925T095718Z.tgz` | `sha256sum -c` passed before and after cleanup. |
| Last verified rollback root | `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-388572b6c8eb-20260925T095718Z` | Root remained present after cleanup; embedded manifest release was `bfc54c826db1-20260923T152920Z`. |
| Last verified rollback archive | `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-bfc54c826db1-20260923T152920Z.tgz` | `sha256sum -c` passed before and after cleanup. |

**Approved stale-data removal:** the cleanup removed only the 59 pre-inventoried rollback payload paths under `/var/backups/proofofwork-ui`: 4 stale managed release archive triplets, 1 older rollback root, 23 legacy `rollbacks` entries, 11 classified rollback-root/archive entries, and 12 rollback-classification/offload entries. No recovery evidence, cleanup evidence, incident evidence, database backup, protocol record, ledger, production app data, current release, or retained rollback identity was removed.

| Measurement | Before cleanup | After cleanup |
| --- | ---: | ---: |
| Root filesystem used | 22,140,317,696 B | 8,046,190,592 B |
| Root filesystem available | 16,149,413,888 B | 30,243,540,992 B |
| Root filesystem use | 58% | 22% |
| Approved candidate disk bytes | 14,094,131,200 B | 0 B remaining at approved candidate paths |
| Filesystem-used reduction | 0 B | 14,094,127,104 B |
| Retained verified release archives | 6 managed archives before cleanup | 2 verified archives after cleanup |

**Post-cleanup backup tree profile:**

| Path | Size |
| --- | ---: |
| `/var/backups/proofofwork-ui` | 3.5G |
| `/var/backups/proofofwork-ui/recovery-evidence` | 1.5G |
| `/var/backups/proofofwork-ui/releases` | 1.3G |
| `/var/backups/proofofwork-ui/rollback-roots` | 222M |
| `/var/backups/proofofwork-ui/cleanup-evidence` | 162M |
| `/var/backups/proofofwork-ui/rollbacks` | 4.0K |
| `/var/backups/proofofwork-ui/classified-rollback-roots` | 4.0K |
| `/var/backups/proofofwork-ui/rollback-classifications` | 4.0K |

**Post-cleanup service health:** Caddy was active. `https://computer.proofofwork.me/` returned `HTTP 200` with `time_total=0.234363`. The deployed release-retention dry run reported `release_retention mode=dry-run verified_archives=2 unverified_archives=0`.

**Status update for H23-01/UI capacity:** the urgent UI free-space risk from redundant rollback payloads is mitigated. The UI server now retains one verified rollback plus the current live release and has materially increased free space. Remaining retention follow-up is policy automation: the deployed `proofofwork-ui-release-prune.service` is still configured as a dry-run service, so automatic future pruning remains a separate explicit decision.


## Approved recurring backup and active UI retention receipt

**Approval:** the user approved the next operational-protection scope: re-enable/schedule recurring PostgreSQL logical backups now that verification is fixed, and turn UI retention from dry-run into active automated protection. The approved scope did not include protocol-record edits, ledger edits, database row changes, rollback-root deletion, recovery-evidence deletion, or an application release.

**Execution time:** 2026-09-26 01:09:22-01:10:12 UTC.

### UI active release retention

**Tracked policy update:** `deploy/proofofwork-release-prune.sh` now allowlists the UI retention target `/var/backups/proofofwork-ui/releases:2`. `deploy/proofofwork-ui-release-prune.service` now runs `/usr/local/sbin/proofofwork-release-prune /var/backups/proofofwork-ui/releases 2 --apply`. `OP_RETURN_INFRASTRUCTURE.md` now documents that scheduled UI release retention applies the approved two-archive managed-release window while preserving complete rollback roots and their bound archives.

**Installed production files:**

| Path | SHA-256 |
| --- | --- |
| `/usr/local/sbin/proofofwork-release-prune` | `a8a56fa52616f2543fe73eec210184a08c7c9657883b595e32f91b4ddf63e9bf` |
| `/etc/systemd/system/proofofwork-ui-release-prune.service` | `02c2e473aa05b5b2637054819d34e2f375e51f89faaaa414fdb8b636474e0bf3` |

**Pre-apply proof run:** `/usr/local/sbin/proofofwork-release-prune /var/backups/proofofwork-ui/releases 2 --dry-run` reported `release_retention mode=dry-run verified_archives=2 unverified_archives=0`.

**Controlled apply run:** `systemctl start proofofwork-ui-release-prune.service` completed successfully. Systemd reported `Result=success`, `ExecMainStatus=0`, and the journal recorded `release_retention mode=apply verified_archives=2 unverified_archives=0`.

**Retained managed UI archive inventory after apply:**

| Archive | Bytes |
| --- | ---: |
| `proofofwork-ui-release-388572b6c8eb-20260925T095718Z.tgz` | 185,541,941 |
| `proofofwork-ui-release-bfc54c826db1-20260923T152920Z.tgz` | 185,446,159 |

**Retained complete rollback root after apply:** `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-388572b6c8eb-20260925T095718Z`.

**Timer state:** `proofofwork-ui-release-prune.timer` is enabled and active. The next scheduled run is `2026-09-27 00:10:07 UTC`. The UI storage scratch prune timer is also active; it was already an applying scratch cleanup service before this change.

**UI post-change health:** Caddy was active. `https://computer.proofofwork.me/` returned `HTTP 200` with `time_total=0.150129` in the post-install receipt and `HTTP 200` with `time_total=0.243989` in the final cross-host snapshot. Root filesystem remained healthy at 22% used: `8,046,055,424` B used and `30,243,676,160` B available at `2026-09-26T01:10:10Z`.

**Important boundary:** the active UI release-retention service prunes eligible unprotected managed release archive triplets outside the two-archive window. It does not delete complete rollback roots, recovery evidence, cleanup evidence, incident evidence, database backups, protocol records, ledgers, or production application data.

### PostgreSQL recurring logical backup timer

**Capacity gate before scheduling:** `sudo -u postgres /usr/local/sbin/proofofwork-postgres-logical-backup --check-capacity` passed with `available_bytes=579677261824`, `reserve_bytes=107374182400`, and `maximum_dump_bytes=39177050239`.

**Timer action:** `systemctl enable --now proofofwork-postgres-logical-backup.timer` created `/etc/systemd/system/timers.target.wants/proofofwork-postgres-logical-backup.timer` and left the timer `enabled`, `active`, and `waiting`.

**Next run:** `2026-09-26 03:18:48 UTC`. This receipt records scheduling/enabling; it does not claim that the next scheduled backup has already run.

**Retained verified backup at enable time:** `/data/proofofwork-postgres-backups/logical/proof_indexer-20260925T203007Z.dumpset`. The logical-backup service still reported the prior successful verification state with `Result=success`, `ExecMainStatus=0`, `ActiveState=inactive`, and `SubState=dead`.

**Node post-change health:** `postgresql`, `bitcoind`, `electrs`, `proofofwork-api`, `proofofwork-api-wg`, `proofofwork-indexer-worker`, and `proofofwork-postgres-logical-backup.timer` were active at `2026-09-26T01:10:12Z`. `/data` was 67% used with `579,677,261,824` B available. Public `https://computer.proofofwork.me/health` returned `ready=true`, `available=true`, `indexedThroughBlock=968611`, `lagBlocks=0`, and `indexedAt=2026-09-26T01:10:12.577Z`.

### Verification performed before production install

- `bash -n deploy/proofofwork-release-prune.sh deploy/proofofwork-ui-storage-prune.sh deploy/proofofwork-postgres-logical-backup.sh` passed.
- `node scripts/check-node-ops-contract.mjs` passed after updating the UI release-retention fixture expectations for the two-archive active window.
- `node scripts/check-ui-ops-contract.mjs` passed.

**Status update for H23-01/UI capacity and H23-01/PostgreSQL backups:** UI managed release retention is now active under the approved two-archive policy, with the prior one-rollback cleanup state preserved. PostgreSQL logical backups are now scheduled again with the repaired verifier. The next required backup follow-up is to inspect the first scheduled run after `2026-09-26 03:18:48 UTC` and record whether it produced a fresh verified dumpset and retained only the newest verified backup.



## Approved backup proof and summary-readiness tooling receipt

**Execution time:** 2026-09-26 01:15:02-01:31:17 UTC for the manual logical-backup proof run; 2026-09-26 01:28:39 UTC for the first local production summary-readiness check.

### PostgreSQL logical backup proof run

The approved immediate run of `proofofwork-postgres-logical-backup.service` completed successfully after scheduling was re-enabled. Systemd reported `Result=success`, `ExecMainStatus=0`, `ActiveState=inactive`, and `SubState=dead`. The journal recorded:

- `backup_capacity available_bytes=579677061120 reserve_bytes=107374182400 maximum_dump_bytes=39177879270`
- `backup_retention_kept candidate=/data/proofofwork-postgres-backups/logical/proof_indexer-20260926T011502Z.dumpset bytes=18245765753 verified_sha256=true restore_catalog=true`
- `backup_retention_deleted candidate=/data/proofofwork-postgres-backups/logical/proof_indexer-20260925T203007Z.dumpset bytes=18177098982 verified_sha256=true restore_catalog=true`

**Retained verified logical backup after proof run:** `/data/proofofwork-postgres-backups/logical/proof_indexer-20260926T011502Z.dumpset`. The older verified Sep 25 logical backup was pruned only after the new Sep 26 dumpset passed checksum and restore-catalog verification.

### Summary route and WORK AMO V8 readiness tooling

Added `scripts/check-summary-route-readiness.mjs` plus the node service/timer files `deploy/proofofwork-summary-route-health.service` and `deploy/proofofwork-summary-route-health.timer`. The checker reads only public API routes and reports separate buckets for active invariant failures, stale readiness, and slow-but-correct latency. It compares `/health`, `work-summary`, `marketplace-summary`, worker readiness, and WORK AMO V8 declaration evidence at the same checkpoint.

The first local run against production returned `ok=true` at snapshot `1ebf8e50ed0e68d28a72689c`, height `968615`, hash `00000000000000000000ef3a764e0b9f64eaa5e62260da23b076ce762410d720`, with `activeInvariantFailures=0` and `staleReadiness=0`. It reported latency warnings only: `work-summary=6414ms` and `marketplace-summary=9186ms`, both classified as `route-latency-slow-correct`. Both routes exposed matching WORK AMO V8 readiness: `ready=true`, worker checkpoint height `968615`, canonical declaration txid `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a`, `evidenceComplete=true`, `coreVerified=true`, `indexVerified=true`, and `configuredPinsMatch=true`.

`npm run check:production-observability` initially observed a transient `/health?network=livenet` 503 while Core/index readiness was moving, then passed on rerun at `2026-09-26T01:30:35.642Z` with `alertCount=0`. This validates the reason for the new checker: latency, stale-readiness, and active invariant failures must be distinguishable.

### Local verification before commit/deploy

- `node --check scripts/check-summary-route-readiness.mjs` passed.
- `node --check scripts/check-live-data-contract.mjs` passed.
- `node --check scripts/check-hardening-contract.mjs` passed.
- `node --check scripts/check-node-ops-contract.mjs` passed.
- `node --check server/proof-api.mjs` passed.
- `npm run check:live-data` passed.
- `npm run check:hardening` passed after updating the backup fixture for the richer verification-failure predicate output.
- `npm run check:node-ops` passed.
- `npm run check:summary-route-readiness` passed against production with slow-but-correct latency warnings only.
- Local `npm run indexer:parity` could not run from the workstation checkout because no production database URL is present; the compact parity output must be verified from the node environment after deployment.

**Status update for H23-02/H23-04/H23-05/H23-06:** logical-backup verification is now proven by a fresh Sep 26 retained dumpset; summary routes have a checked stale-versus-slow readiness monitor ready for deployment; `indexer:parity` now emits compact failure buckets in source but still needs a production-environment run after the node release.

## Final production deployment and verification receipt

**Execution time:** 2026-09-26 01:43-02:07 UTC.

**Repository state:** the audit-remediation commits were pushed to `origin/main`:

- `e6ed84e348cd856670474b0cc86922d3943a50a6` - `Finish production audit remediation`
- `7b47a0cacfece5cade42ddd96ef2cba926cddc03` - `Fix summary route health runtime compatibility`

**Node production deployment:** the node API was deployed from commit `7b47a0cacfece5cade42ddd96ef2cba926cddc03`. The successful cutover receipt is `/data/proofofwork-audit23-cutover-7b47a0cacfec-20260926T0152Z`; an earlier attempted cutover at `/data/proofofwork-audit23-cutover-7b47a0cacfec-20260926T0148Z` rolled back before activation because the staged checkout had a root-owned `.git/index`.

**Node release-health proof:** `sudo /opt/proofofwork-api/deploy/proofofwork-node-release-health.sh` passed with live commit `7b47a0cacfece5cade42ddd96ef2cba926cddc03`, live tree `d4bd2c0540f45ac768086cee10060b08fd672e2c`, runtime SHA-256 `2a8344dbd2ca0ca29396b8b562164c2fc37a9710d1af011595693b5161397b3f`, `archives=4`, `verified=4`, `unverified=0`, `legacy_absolute=0`, `provenance=4`, `current_provenance=1`, and `opt_checkouts=3`. The non-sudo run cannot see `/data/proofofwork-release-backups/managed` and reports a false archive failure.

**Production services:** `proofofwork-api`, `proofofwork-indexer-worker`, `proofofwork-summary-route-health.timer`, `proofofwork-postgres-logical-backup.timer`, `proofofwork-api-wg.socket`, and `proofofwork-api-wg.service` were all active at the final service check.

**UI retention:** `proofofwork-ui-release-prune.service` remains an apply-mode oneshot and completed successfully after deployment. The latest journal receipt at `2026-09-26 01:43:53 UTC` recorded `release_retention mode=apply verified_archives=2 unverified_archives=0`.

**Logical backup:** `proofofwork-postgres-logical-backup.service` last completed successfully at `2026-09-26 01:31:17 UTC`, triggered by the active timer. The retained verified dumpset is still the Sep 26 proof run documented above.

**Summary-route cache proof:** immediate repeated production reads returned HTTP 200 with response-cache behavior enabled:

| Route | First read | Second read |
| --- | --- | --- |
| `/api/v1/work-summary?network=livenet&compact=1` | `X-PoW-Cache: MISS` | `X-PoW-Cache: HIT` |
| `/api/v1/marketplace-summary?network=livenet&compact=1` | `X-PoW-Cache: MISS` | `X-PoW-Cache: HIT` |

**Production health gates after deploy:**

- `npm run check:production-observability` passed at `2026-09-26T02:06:55.484Z` with `alertCount=0`.
- `npm run check:summary-route-readiness` passed at `2026-09-26T02:07:02.844Z`, snapshot `40f199db530429b35a8e953a`, height `968620`, hash `00000000000000000001b325cb2bddc9b2a2a7012405c3d6cb60f28398be9228`, `activeInvariantFailures=0`, and `staleReadiness=0`. The only warning was slow-but-correct `work-summary` latency at `5066ms`; `marketplace-summary` was `1505ms`.
- WORK AMO V8 readiness matched across health, `work-summary`, and `marketplace-summary` at the same checkpoint. Declaration txid `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a` remained `evidenceComplete=true`, `coreVerified=true`, `indexVerified=true`, and `configuredPinsMatch=true`.

**Current production `indexer:parity` result:** after rerunning with the deployed proof-index runtime flags and internal verifier token sourced without printing secrets, `indexer:parity` still exits 1 at snapshot `40f199db530429b35a8e953a`, height `968620`. The compact failure summary now separates known historical V5 warnings from active projection invariants:

- Active invariant failures: 2.
- Known historical WORK AMO V5 warnings: 2 (`work-amo-v5-migration` with `migration-not-complete`, and `work-amo-v5-usd-quote-head` with no quote head).
- Other warnings: 0.

Active projection gaps:

| Failure | Details |
| --- | --- |
| `confirmed-transactions-have-canonical-block-proof` | 4 confirmed transaction rows have canonical block height/hash/time and join a canonical block, but their `raw_tx.canonicalBlockScan` marker is absent. Txids: `4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359`, `939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c`, `4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212`, `8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf`. |
| `rendered-event-reference-semantic-parity` | Event `4256606`, txid `ebe60fd108e8830b4741101e6525081387dcf328e81c12fa2b533de0bdbf0d3e`, confirmed invalid token event at height `968125`, has token-id ref `3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d` but is missing rendered ticker ref `INCB`. |

Read-only diagnostics found that the token-state tables are populated and current under the deployed runtime environment: 238 credit definitions, 425 credit balances, 1,210 credit listings, 25,348 `pwt1` events, current token payload source `proof-indexer-token-state-tables`, indexedThroughBlock `968620`, 238 tokens, 916 active listings, 208 closed listings, and 86 sales. WORK AMO V8 migration readiness was `ready=true`, `active=true`, `parityReady=true`, `pendingReady=true`, `replayReady=true`, and `exactTipReady=true` at the same tip.

**Approval boundary:** no production database row was repaired during this final pass. The remaining parity failures are derived proof-index projection gaps, not observed canonical-chain corruption, but closing them requires explicit approval for a bounded production database repair that mutates only the four transaction `canonicalBlockScan` markers and the one missing `INCB` event ref after first-party Core verification.

**Status update for the recommended follow-up list:** items 1, 2, 3, 4, 5, 6, and 7 are implemented, deployed, committed, pushed, and production-verified as far as possible without mutating derived production index rows. The only remaining non-green gate is full `indexer:parity`, blocked on the bounded derived-index repair approval described above.
