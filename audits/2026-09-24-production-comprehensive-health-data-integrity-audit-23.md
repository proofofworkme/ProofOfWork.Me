# Production Remediation and Verification Audit 23

**Audit date:** September 23–24, 2026 local; verification continued through September 24, 2026 05:01 UTC.
**Scope:** post-release verification of the ProofOfWork application and both VPS environments; ordered public-surface sweep; full-node, indexer, database, API, event, math, logging, backup, storage and retention checks; exact approved release-archive cleanup.
**Predecessor:** [Production Remediation and Verification Audit 22](2026-09-22-production-comprehensive-health-data-integrity-audit-22.md). Its report SHA-256 is 07741d3561488c3aab8091125136ba573662a6db2817b7aebb031cf522b74a69; its evidence SHA-256 is 8a5d58cd41f664904d9dc1d5211d46d76d34b9f7c9d5fde0f587c79c91f61ed6.
**Production API revision:** release 1149633c2d1a-20260924T015319Z; commit 1149633c2d1a5c62c4a800772daa79683e478796; tree 6071ed84ae3cad5a852ef3d4bb0c87c9d1d64e29.
**Companion evidence:** [Audit 23 evidence](2026-09-24-production-comprehensive-health-data-integrity-audit-23.evidence.json) contains predecessor hashes, sanitized surface results, measurements, exact cleanup manifest and verification results.

## Result

The deployed API, indexer and Bitcoin Core were synchronized at block 968357, with the same block hash. A post-merge production health retry returned HTTP 200, ready, and zero lag; the live consistency endpoint passed all 25 checks at that checkpoint. Exact Q8 values matched across Work/Growth totals and the transition commitment. The 14 ordered application pages and their four assets each returned HTTP 200. Boost and AMO had transient fail-closed readiness responses during the first sweep and passed isolated retries.

The audit found no new canonical data mismatch, missing confirmed log event, or math discrepancy. Capacity and storage have improved, but growth/availability risks remain: the UI filesystem has about 4.00 GiB above its 10 GiB systemd free-space floor, the 32.04 GB WORK transition table dominates a 33.45 GB PostgreSQL database, and the September 24 scheduled logical-backup service exited 1 during retention verification. The new dump has since passed an isolated restore and integrity checks; the guarded retention verifier then passed and safely removed the older logical dump. A post-merge health probe briefly returned 503 during the next-block convergence window, then recovered to ready/zero lag at height 968357; this is a recurrence of the previously documented fail-closed readiness family. The reason the scheduled backup invocation failed remains unknown, and the September 25 run still needs observation. Fresh wallet/marketplace summary reads remain slow.

During this approved remediation, old verified UI and Node software-release archives were removed only after active-release and rollback protections, archive checksums, and exact candidate sets were proven. The active UI rollback root, Node API rollback archive, database backups, chain data, ledgers, protocol records and historical evidence remain intact. The scheduled retention services remain in report-only mode; this audit did not authorize future unattended deletion.

## Systems and ordered application surfaces

Checked Caddy on the UI VPS; production API and indexer worker; PostgreSQL 16 and WAL receive/compression/backup services; Bitcoin Core, txindex, coinstatsindex and basic block filters; Mempool API/database/web containers; public health and consistency endpoints; and application assets and read APIs.

| Order | Surface | HTML/assets | Read API result |
|---:|---|---|---|
| 1 | Home | 200; four assets; 1.084 s | Registry 200; 5.532 s |
| 2 | ID management | 200; four assets; 0.539 s | IDs 200; 4.009 s |
| 3 | Desktop | 200; four assets; 0.659 s | Log 200; 2.122 s |
| 4 | Browser | 200; four assets; 0.583 s | Activity 200; 4.426 s |
| 5 | Boost | 200; four assets; 0.617 s | First sweep 409 while registry checkpoint converged; isolated retry 200 in 2.513 s |
| 6 | AMO | 200; four assets; 0.424 s | First sweep 503 while canonical summary caught up; isolated retry 200 in 7.623 s |
| 7 | Credit | 200; four assets; 0.469 s | 200; 6.085 s |
| 8 | Wallet | 200; four assets; 0.568 s | WORK-token read 200; 12.628 s |
| 9 | Work | 200; four assets; 0.499 s | Summary 200; 9.284 s. Work floor 200; 7.987 s |
| 10 | Infinity | 200; four assets; 0.845 s | 200; 2.869 s |
| 11 | Inception | 200; four assets; 0.445 s | 200; 5.718 s |
| 12 | Log | 200; four assets; 0.514 s | 200; 4.486 s |
| 13 | Growth | 200; four assets; 0.528 s | 200; 2.299 s |
| 14 | Computer | 200; four assets; 0.130 s | Health 200; 0.546 s. Consistency 200; 2.587 s |

All page probes ran in the requested order, with Computer last. The first sweep’s Boost/AMO readiness errors recovered on isolated retries. A separate health probe also briefly returned not-ready while the worker was one block behind Core; it recovered to ready at zero lag. These were fail-closed synchronization windows, not data-integrity failures. They match the existing availability/latency findings in Audit 22 and are not duplicated as new issue IDs.

## Full-node and synchronization verification

Bitcoin Core’s direct RPC check at 05:01:06 UTC reported main chain height and headers 968357, verification progress 1.0, initial block download false, and no warnings. The authoritative tip hash was:

00000000000000000001071f7488710642a0a1533f91e649c8bff6d8296003ff

Txindex, coinstatsindex, and the basic block filter index were all synced to 968357. Production health returned HTTP 200 at 05:01:21 UTC with available=true; Electrum and canonical index checkpoints matched Core at the same height/hash, with zero lag. The worker was proof-ready with zero consecutive failures; the pending-event observer reported 24 checked, zero deferred, zero errors and unavailable=false. Consistency returned HTTP 200 at 968357 with 25/25 checks passing and the ledger covering the node tip at zero lag.

The activity reconciliation reported 26,015 canonical and public-log activity rows versus 26,016 ledger rows: one supplemental row is pending and unconfirmed; all 25,993 confirmed activity rows match. The reconciliation check passed.

A health probe just before the successful retry briefly returned HTTP 503 while the chain advanced, then recovered to HTTP 200/ready at zero lag. This repeats the previously documented fail-closed checkpoint-convergence behavior; it did not show a canonical data mismatch.

The full node’s 04:33 UTC Mempool snapshot held 78,694 transactions, 40,717,321 serialized bytes, 228,462,160 bytes of usage, and zero unbroadcast transactions. Pending Mempool visibility remains best-effort.

Bitcoin Core, PostgreSQL, WAL receive, API and indexer-worker services were active. The logical-backup oneshot was not running (MainPID 0) and remained in failed state from its earlier September 24 scheduled run; its next timer is September 25 03:18:48 UTC. Caddy was active at the final UI sample.

## Health, capacity, database and retention

| System | Result |
|---|---|
| UI VPS root filesystem | 39,973,924,864 B total; 23,236,878,336 B used; 15,052,853,248 B available; 61% use at 04:59:58 UTC. With SystemKeepFree=10 GiB, margin above the floor was 4,315,435,008 B, about 4.02 GiB. |
| UI memory/CPU | 3,375,349,760 B memory available; no swap configured. Load was 0.10/0.07/0.02 at 04:59:58 UTC. Caddy active; earlier sampled journal query contained one sshd connection reset and no Caddy error. |
| UI backups | After approved archive cleanup, /var/backups/proofofwork-ui occupied 17,340,497,812 B; releases occupied 1,865,963,829 B. One complete rollback root remained and validated. Other rollback classifications and recovery evidence were preserved. |
| Node VPS data filesystem | 1,764,768,071,680 B total; 1,298,928,689,152 B used; 376,118,607,872 B available at 05:00 UTC; 78% use after verified retention. |
| Node memory/CPU | 115,932,999,680 B memory available at 05:00 UTC; swap use was 338,952,192 B at the earlier sample. |
| PostgreSQL | proof_indexer measured 33,448,877,079 B. work_amo_block_transitions was 32,043,941,888 B with 8,725 live and zero dead tuples; about 95.8% of the database. ledger_snapshots was 830,275,584 B; events 156,213,248 B; transactions 106,561,536 B. |
| PostgreSQL health | Zero invalid indexes, zero unvalidated constraints, autovacuum on, and zero cumulative database deadlocks at the sampled query. Live data checksums are disabled; treat this as a planned maintenance hardening item. |
| Node backup trees | After guarded pruning, /data/proofofwork-postgres-backups measured 92,493,431,771 B, including one 17,570,940,420 B current logical set; /data/proofofwork-backups 14,639,370,240 B; /data/proofofwork-release-backups 9,016,766,464 B. Physical backups and WAL were preserved. |
| Node release archives | A validated apply run removed 47 unreferenced archives totalling 3,756,634,359 B. Fifty verified archives were examined; zero were unverified. The active release, immediate rollback and one additional recent release remain. |
| Logs | Node journald was near its configured 1 GiB cap with a 10 GiB keep-free floor and seven-day retention. UI journald was below its 1 GiB cap. Caddy and API/indexer error checks were clean for the sampled windows. |

### Approved storage actions

- UI release retention validated 10/10 archive checksums and found five exact, unprotected older release archives. Their payloads totaled 927,129,145 B. The script removed only each archive and its paired checksum/provenance sidecars. The overall backup-tree measurement fell by 927,141,812 B. The active UI archive for release bfc54c826db1 and the archive referenced by the sole rollback root, b180548cb121, still passed checksum validation.
- Node retention validated all 50 managed archives with zero unverified and no stale temporary-file candidates. It removed 47 verified archives dated September 2–22, totaling 3,756,634,359 B, including each candidate’s checksum and provenance sidecars. Exact names, byte counts, archive digests and provenance digests are in the companion evidence file. No stage, database backup, WAL, incident record or protocol data was deleted.
- The Node active archive is 1149633c2d1a-20260924T015319Z. The immediate rollback archive is 5882758-20260923T213800Z. Both still exist and their checksums/provenance were rechecked. A third recent release, b180548, also remains under the current keep-three policy.
- Existing node stages were pruned only where prior Audit 23 attestations proved an exact current or rollback copy. Fourteen stages remained in the inspected inventory, including the current stage and older/unclassified directories; the rest were preserved.
- Mempool container logging is now bounded to json-file 25 MiB × 4 for db/api/web. Existing container images and persistent mounts were preserved. The previous API and DB logs were copied byte-for-byte to root-private receipt /data/proofofwork-audit23-mempool-log-rotation-20260924T023000Z, with hashes 904b1bfb1d73a0677d779f2c80ca3aad10d6aef5c991b54578c013b36c0f1728 and f9a8f310126911e68cfbc371fd086cb257e55ad54db9efafd142e2c60ec14591. The tracked compose override hash matched the installed override.

The daily UI and Node retention units still run in dry-run mode. This audit applied only the exact user-authorized candidate sets above. Older UI rollback/classification/recovery directories and the remaining 13 unclassified Node stages were not removed. The UI still has limited free space above its systemd reserve, so these retained trees and future release growth need monitoring.

The daily PostgreSQL logical-backup service ran 03:18:51–03:34:00 UTC and exited 1 with “Requested current logical backup failed retention verification.” It consumed 12m13.751s CPU and peaked at 13.5 GiB memory. The September 24 dump is 17,570,939,120 B with SHA-256 3fc3ff4c6a3a081f60e7172f2ba7defe352596bff34c944388c48dc1abc61351; globals.sql SHA-256 is 08b24264aaf7e5a237de60276e4fa24b6aa6997c5fb2ab243751cd34f84b65f7. After the service failure, checksum verification, pg_restore --list, exact member/mode/owner checks, and no-open-reader checks passed. I restored that dump to a temporary PostgreSQL 16 cluster on /data, with network listening disabled and a private Unix socket. Restore exited 0; the restored database measured 33,120,918,551 B, with 8,725 work_amo_block_transitions, 26,506 events, 25,897 transactions, and 20,213 ledger snapshots. pg_amcheck and pg_checksums --check both passed. The temporary cluster was shut down and removed; a follow-up confirmed its path absent.

After proving the new dump restorable, I reran the built-in guarded --retain-existing verifier against the exact September 24 set. It verified the current dump checksum and restore catalog, verified the older September 23 candidate (17,252,508,867 B including set metadata; dump SHA-256 8c739fdc07f574f20957ddb6281010091619372458e67e5103b0adb567dbc783), then removed that older set and reported exit 0. The September 24 set remains as the single current logical rollback point; its set directory measured 17,570,940,420 B during retention verification. This is the only logical-backup deletion in this audit and followed the authorized restore proof and exact guarded checks. The scheduled invocation’s failed predicate was not recorded and its cause remains unknown; the manual pass does not prove the next timer run will pass. The next timer is scheduled for September 25 03:18:48 UTC. The weekly physical base backup last completed successfully September 21; WAL compression last succeeded September 24 00:49 UTC, and the WAL receiver was active.

## Data, event and math verification

At 2026-09-24 03:11:38 UTC, /api/v1/consistency returned HTTP 200, ok=true, green status, 25/25 checks, and missingLogEvents=[] . Its indexed block and transition source were block 968345, matching Core’s authoritative hash.

The following exact decimal Q8 value matched the on-chain transition commitment and the Work/Growth actual and floor totals:

- Q8 integer: 1438911276484420354284284314
- Exact decimal: 14389112764844203542.84284314
- Matching fields: Work actual, Work network, Growth actual, Growth Work floor, and the Work AMO V5 transition’s network value.

The legacy numeric Sats fields are rounded JavaScript Number aliases and display 14389112764844204000; the API also exposes exact Q8 strings and exact decimal strings. Clients must use exact fields for decisions, comparisons, accounting and rendering. The recent production check verified deterministic equality at the same checkpoint; it does not prove every historical address or every object independently.

The production marketplace regression passed all 904 WORK listing records through complete cursor pagination and reconciled sealed/listing/sales/wallet/Log coverage. The live mail-history regression passed eight sampled mailbox cases and returned 527 registry records. This is bounded regression coverage, not exhaustive per-address enumeration.

## Previously reported issue rechecks

| Finding | Audit 23 result |
|---|---|
| H9-01, stale pre-unit WORK listing relic | Resolved in the deployed API; the complete 904-listing production regression passed. |
| H20-01, unbounded Mempool JSON logs | Resolved; db/api/web are capped at 25 MiB × 4 and old API/DB logs are preserved with hashes. |
| H23-03, loss of precision in Q8 math | Resolved in production; exact Q8 and decimal fields agree across consistency totals and the chain transition. |
| H6-03, mail history pagination/truncation | Eight live mailbox histories passed; keep all-address completeness qualified. |
| H5-02, H20-03, H20-04, cold ID false-zero, duplicate Desktop self-send tile, missing Log confirmation | Local browser regressions passed and the deployed UI release is active; all 14 pages/assets load. No authenticated user-session or live fault-injection test was performed in this pass. |
| H19-02, H19-03, H22-01, transaction outage/mempool/reorg status labeling | Corrected API source is deployed and local failure-path tests passed. Production provider failure/reorg injection was not performed. |
| H7-01, H10-07, A11-03, summary size and latency | Improved from the previous 32 MB summary to about 5.57 MB. Fresh wallet/marketplace reads still take about 5–13 seconds. Readiness briefly failed closed during checkpoint convergence in the first sweep and once more during the final block advance, recovering to ready at zero lag. Same prior availability family; performance/availability follow-up remains open. |
| H5-01, H13-01, UI capacity/retention | Improved after verified cleanup: 15.05 GB free and 4.02 GiB above the 10 GiB floor. The 17.34 GB UI backup tree and report-only future retention leave recurrence risk; continue capacity alerts and exact cleanup review. |
| H8-05, H10-02, backups/database growth | Open. Database is 33.45 GB with the transition table accounting for 32.04 GB; PostgreSQL backup storage is 92.49 GB. Recent restore verification passed, but live table/storage growth needs a measured trend and staged redesign. |

## New findings and closeout actions

**H23-04 — Low severity: Node release-retention helper drift (resolved in this closeout).** At discovery, the root-installed helper SHA-256 was 227d0a0261dc80e3144111f1ae9ff269109a87be0743c24f690cc5d7a5e71879 and the tracked helper SHA-256 was d4de9574cd0c666d198c4d448e72869c09cdfeacd29cd3e1eb0731f0419f8fb6. The installed version refuses `--apply` with multiple complete UI rollback roots and returns nonzero for a multi-root dry-run. That guard is now in the tracked source; the contract test checks that apply refuses and all candidate archives/sidecars remain. `npm run check:node-ops` passed. The tracked helper now hashes to 227d0a0261dc80e3144111f1ae9ff269109a87be0743c24f690cc5d7a5e71879, identical to the installed helper, so no production helper restart or replacement is needed; the source reconciliation in this closeout preserves the already-running production behavior.

**H23-05 — Medium severity: scheduled logical-backup verification failed; dump restored and verifier diagnostics deployed.** The September 24 scheduled service exited 1 after producing its 17.57 GB dump and reported that the current set failed retention verification, without naming the predicate. Its checksum manifest, three-file inventory, ownership/modes, path/device/mountpoint, and no-open-reader checks passed on rerecheck. A full isolated restore completed; pg_amcheck and pg_checksums --check passed. The guarded retention command validated both current and older sets, retained the new set and removed only the older set, exiting 0. Predicate-level labels and fixture coverage were added without weakening any check or deletion rule. The new helper was installed at /usr/local/sbin/proofofwork-postgres-logical-backup with SHA-256 69b21f035274c271225213e08c3b4676204ca70d9223556a2317c34a0264da09. The exact previous helper is preserved as a root-private rollback at /root/proofofwork-postgres-logical-backup.audit23-pre-diagnostics with SHA-256 3ef93ecd1a7c927f8e430697d447bcb7688d772716c7d7bbf2000b0953f88838. The installed helper passed a retention-only check on the September 24 set and kept it. The backup unit was not restarted and remains failed from the earlier scheduled run with MainPID 0; the next timer is September 25 03:18:48 UTC. The scheduled-run cause remains unresolved until that timer is verified.

## Recommended follow-up

1. Alert on sustained Core/indexer lag, worker not-ready responses, and repeated Boost/AMO 409/503 responses; preserve fail-closed status semantics.
2. Reduce summary construction latency and avoid repeatedly materializing 5.57 MB payloads. Benchmark wallet and marketplace reads at production scale and preserve cursor-based exhaustive listing history.
3. Measure transition-table growth over a fixed window. Prototype deterministic, replayable storage reduction on a restored copy, then prove identical event commitments and exact balances before planning a migration.
4. The September 24 logical dump is now the single latest restore-verified recovery point; guarded retention removed the older verified set only after the full restore passed. Predicate diagnostics are installed and the new helper retained the verified current set. Confirm the September 25 timer succeeds and track the backup job’s 13.5 GiB memory peak.
5. Classify the remaining UI recovery/classification directories and Node stages by exact provenance and live references. Do not delete unclassified evidence.
6. H23-04 source/test reconciliation is complete and now byte-matches the installed helper. Keep the Node timer report-only until current and immediate rollback archives are independently pinned.
7. Keep UI/Node disk and inode alerts active. The latest UI sample had 4.02 GiB above SystemKeepFree.
8. Keep exact Q8 strings/integers as the only financial decision fields; monitor that API/UI clients do not use approximate Sats aliases.

## Closeout verification checks

| Check | Result |
|---|---|
| `npm run hygiene:fix` | Passed; no allowlisted rebuildable state found. |
| `npm run hygiene:check` | Passed; repository state check clean. |
| `npm run check:hardening` | Passed after adding exact verifier-predicate diagnostics and preservation coverage; backup capacity guard fixtures passed. |
| `npm run check:node-ops` | Passed after the retention guard change; multiple rollback roots refuse apply and the test confirms candidate archives remain. |
| `npm run check:ui-ops` | Passed after the shared helper change; UI capacity, publisher admission, rollback and retention regressions passed. |
| `npm run check:ui-capacity` | Passed all 10 capacity and staging boundary tests. |
| `npm run check:production-observability` | Passed at 03:48 UTC; health endpoint returned `ok=true`, zero alerts. |
| Isolated September 24 PostgreSQL restore | Passed; 33,120,918,551 B restored, expected sampled row counts, pg_amcheck and checksum verification passed; temporary cluster removed. |
| Guarded logical-backup retention rerun | Passed; current checksum/catalog and prior checksum/catalog validated, prior set removed, current set retained. |
| Refreshed public production health and consistency | HTTP 200; index lag 0 at height 968357; green 25/25 checks; full-node checkpoint/hash matched. |
| Installed backup verifier | SHA-256 matches reviewed source; prior helper hash retained in root-private rollback; no service restart; retention-only check kept current backup. |
| PR #61 merge | Rebased to main as 10fde0afaf7868a2fc757839701544b18265ea55; repository-hygiene Node 20/22/24 checks passed. |
| `git diff --check` | Passed. |

The remaining backup issue is operational, not a failed restore or manual retention check: the September 24 scheduled service rejected its completed set without naming the predicate. The dump has since been restored and passed the installed guarded retention verifier. Future failures will include a predicate label; the original failure remains unexplained, and the September 25 scheduled run must pass before the backup cycle is declared healthy.

## Actions and approval boundaries

Production changes in this audit were limited to the approved API release already deployed, Mempool log rotation, verified software-release archive cleanup, guarded removal of the older logical backup after the new backup passed a full isolated restore, and installation of the diagnostic-only backup verifier. Its previous helper is preserved byte-for-byte as a root-private rollback. The Node release-retention guard was reconciled in source and tests with its already-installed production behavior. The remediation and Audit 23 were merged through PR #61 (merge commit 10fde0afaf7868a2fc757839701544b18265ea55); the Node 20/22/24 repository-hygiene CI matrix passed. No protocol records, addresses, balances, credits, transactions, ledgers, refunds, keys, seeds, chain history, live PostgreSQL rows, WAL, Caddy data, or unclassified recovery evidence were altered.

No additional deletion was performed for items whose liveness or evidence purpose was not proven. The H23-04 tracked helper/test change is included in this closeout scope and has passed its focused contract check. The September 23 logical dump was removed only after the September 24 dump passed isolated restore, pg_amcheck, checksum validation, and the guarded current/prior retention checks. Any future cleanup of remaining UI rollback/recovery categories, Node backups or unclassified stages requires an exact candidate inventory and proof that the latest restorable backup and immediate rollback remain available. The scheduled September 24 job still failed without identifying its predicate; monitor the September 25 run before calling scheduled backup operations fully resolved.

## Remediation continuation — 2026-09-24 05:15 UTC

- **H20-02, stale Marketplace guidance:** the earlier documentation pass marked the June 27 section historical but left obsolete wording that said `seal5` spends the listing ticket and recommended stale-summary fallback. `MARKETPLACE.md` now states that `seal5` publishes the seller signature without spending the original anchor, explains the legacy projection as compatibility data, and requires exact-tip fresh reads or an explicit unavailable response. This matches the current sale-ticket declaration and read contract. The change is documentation-only; no protocol state or production service was changed.
- **H6-01, Boost fractional writer inputs:** rechecked the merged safe-integer guards in `src/features/boost/boostNumeric.ts` and the deployed release lineage. Release commit `1149633c2d1a5c62c4a800772daa79683e478796` includes fix commit `365d80faddcb6cb13275d2ba606fc18530158c30`. `npm run check:boost-regressions` passed all 31 tests, including fractional, unsafe, string and invalid outpoint cases.
- This continuation does not close the scheduled-backup timer gate, UI capacity monitoring, transition-table growth measurement, or the remaining read-latency/availability follow-ups listed above. The documentation change needs PR merge but no production deploy.
