# Audit 28 follow-up preparation and approval boundaries

Date: 2026-09-29, America/Toronto. This is the user-approved preparation of priorities 1–8. Source, tests and audit documentation are changed locally. No production deletion, deployment, configuration change, service operation, commit or push has occurred. The user's execution wording preceded this concrete manifest; this document presents the exact scope for final review. Additional candidates require separate approval.

## Priority order and status

| Priority | Work | Prepared result / boundary |
|---|---|---|
| 1 | Growth chronology and Computer DNS truth | Confirmed credit seals now derive their date from canonical seal transaction block time. Missing canonical timing withholds the date. Computer AMO loads DNS on entry; both AMO surfaces withhold counts/empty claims until DNS succeeds, with a retry action. Malformed HTTP 200 DNS envelopes also fail closed without a complete coverage fence, checkpoint hash and registry/listing arrays. Local implementation and regression tests complete; deployment pending. |
| 2 | Wallet/AMO availability and performance | Bounded investigation complete; exact proposed experiments below. Existing checkpoint refusals and slow complete-book hydration remain open. No accounting/authority fence, timeout or concurrency setting changed. |
| 3 | Monitoring accuracy and actionable failures | Readiness probe latency label changed from `route-latency-slow-correct` to neutral `route-latency-warning`; a slow 503 must not imply correctness. Operational thresholds/alert delivery unchanged. Historical failed units must remain evidence until classified; no reset-failed performed. |
| 4 | Retired UI transport cleanup | One exact source tree proposed for deletion: 250,212,352 allocated bytes (~238.6 MiB). Identity, content, references, all 27 Git refs, and designated UI release pair checked. Execution requires approved manifest hash and immediate revalidation. |
| 5 | Remaining deployment scratch and archives | Every inventoried item is explicitly held except the single priority-4 tree. Historical node bundles may contain unique refs; tiny tarballs may be receipts/placeholders. No wildcard deletion or age rule is proposed. |
| 6 | Replay/recovery databases and backups | Preserve active INCB replay, final repair backups, rehearsals, latest logical set and all unresolved recovery dependencies. Latest dump catalog parses (202 TOC entries). A pinned isolated restore script and bounded execution plan are prepared; full restoration has NOT been run in this preparation. |
| 7 | Caches, logs, notes and retention | Preserve current caches and incident/security logs. Inventory records readers/open references. Prepare policy separately; no truncation, journal vacuum, log deletion, backup retention change or historical-note removal. Local hygiene removes only repository-allowlisted rebuildable outputs. |
| 8 | Database growth, physical assurance and rollout resilience | Live transition data is ~96.7% of the 37.55 GB database. No compaction, VACUUM FULL, REINDEX, checksum enabling or replay deletion proposed. Preserve designated rollback sets; publisher gains an explicit retention-deferral option. Deployment and rollback plan below. |

## Authoritative verification and current health

The earlier complete read-only audit remains the population-level evidence at height 969198; see its appended section. This preparation does not claim a second complete audit.

Fresh bounded route probe at 21:11:28 UTC:

- API health ready at 969203/hash `000000000000000000008b88dbffebe2b87debd75d7fd3f095488110df356d4c`, lag zero.
- WORK summary HTTP 200, 4,440 ms, snapshot `e868397c903c6e73542346b6` at that checkpoint.
- AMO summary HTTP 503, 9,105 ms, `REGISTRY_AUTHORITY_UNAVAILABLE`, reason `core-checkpoint-mismatch`. No active arithmetic invariant failure was reported, but readiness failed. A green health endpoint does not establish every application route is available.
- Subsequent direct Core check: blocks=headers=969204, IBD false; height 969203 hash matches the probe. Tip movement is observed; it does not prove the specific refusal's internal cause. Keep AUD26-02/H24-01/performance family open.

Direct Core verification of affected seals:

| Seal txid | Height | Core block time UTC |
|---|---:|---|
| `767b1c7d0df60edc9099ff29269b553843c896e397f550f5d7f8558834575c4b` | 969161 | 2026-09-29 13:32:04 |
| `4f895eaabd46d1c8d69b6ac953aa3776a861bf29951b99a6126b31413b2b15bd` | 969127 | 2026-09-29 08:31:07 |
| `3eb8cfcb5edb187cb77e2bc4ef4a3142a03c4897afe9a800613605e2d65e62e6` | 969127 | 2026-09-29 08:31:07 |
| `00943f5892cee2e9d4d097e9b6098629a7f5a080ccbd7c33b24c8de9685975a5` | 962784 | 2026-08-16 21:37:43 |

The actual prepared canonical seal join also executed successfully against PostgreSQL in a five-second READ ONLY transaction: all four event/transaction timestamps and heights match Core, with exactly one canonical event per seal. Query and compact results are retained in the preparation evidence JSON.

The fix changes read projections only. Protocol fees, exact integers, confirmed history, V8 gates and settlement functions are unchanged. Production Growth closure requires these same timestamps to appear in fresh API/UI results after deployment and natural summary publication; do not manually rewrite event history or summaries.

## Bounded performance and monitoring follow-up

Inspection found a 60-second normal API timeout, up to 100 listing pages and three complete-snapshot attempts. These are individual bounds, not a useful overall hydration deadline. Multiplying those limits permits hours of worst-case repeated waits; this is a design risk, not a measured hydration duration.

Prepare the next implementation as a separate reviewed change:

1. Add a 120-second overall public-book hydration budget and cancellation propagated into each request. Permit at most one checkpoint restart within that same budget. Cancel on workspace/network change. Preserve last verified preview, label it unavailable/stale, and never promote partial pages to a complete book.
2. Keep signing preflight fresh and fail closed. Share an in-flight read only for identical network/address/scope/freshness/checkpoint requirements; do not let a cached public response satisfy spendability.
3. Benchmark at concurrency 1 initially, no more than 12 read-only requests per run, 30-second per-request timeout, 120-second overall run budget, stop on sustained 503 or increasing lag. Record route duration, payload bytes, canonical checkpoint, rejection reason and full-book time separately. No wallet signing, purchases or broadcast.
4. Trace the rejected registry checkpoint separately from overall indexer health. Prefer coherent reusable verified snapshots and compact display pages over repeat wide state decoding. Query/EXPLAIN experiments must use READ ONLY, a 5-second statement timeout and no EXPLAIN ANALYZE of unbounded scans. Any new index/schema/pool/cache configuration requires a concrete additional approval.
5. Keep existing observation thresholds: >=20 samples, 5% warning/15% critical server errors; >=5 samples, p95 >=10 seconds warning/>=30 seconds critical; >=8 MiB payload warning. Keep checkpoint refusals counted as unavailable. Add reason/checkpoint labels without wallet addresses or raw payloads. Do not silence real errors to improve a dashboard.
6. Alert tests must name a destination and require separate approval before sending notifications. Retain failed oneshot evidence and distinguish old completed incidents from current route/storage failures; do not reset unrelated units.

These proposals are not represented as implemented performance fixes. Existing timeout, wallet containment, projection and observation tests provide the starting regression boundary.

## Exact cleanup and retention decisions

Manifest SHA-256: `4f953d31585ed762be0147a332ac8c5ab9850ad43b6f008159729b59f839b59f`. Verification-only execution passed at 21:17:32 UTC and the final helper with its installed-tool hash pin was verified again; no deletion occurred. Compact node/readiness/verification receipts are retained in `2026-09-29-audit28-followup-preparation.evidence.json`.

The companion `2026-09-29-audit28-followup-cleanup.manifest.json` contains **817 path observations**: 296 UI and 521 node. Nested allocations overlap; do not sum these as reclaimable space. Every row carries an explicit action/reason. Only one `delete` entry exists:

Host `77.42.91.106`:
`/var/tmp/proofofwork-deploy/proofofwork-ui-source-d2c0afaffd9c-20260929T161019Z`

- Commit `d2c0afaffd9cd723fa99c02a6de6b86fe50a0be6`; tracked tree clean; ignored entries restricted to node_modules.
- All 27 Git reference objects also exist in the retained local repository; their exact refs/object IDs are in the manifest. The source commit is retained history, not being deleted from Git.
- Device 2049, inode 911710; root mtime ns 1790698227000000000.
- 6,770 entries, 232,171,828 regular-file bytes; 250,212,352 allocated bytes.
- Content/identity fingerprint `39d2c864228c66bfa54808d179bd3374f4dd3f170480902b5c3a9c1e873d13f6` under documented `lstat-and-content-json-v1` model.
- No process/config/symlink/mount dependency detected by existing retention helper. Recheck under the deployment lock immediately before removal. Retain durable compact evidence before deleting.

Preserve the existing designated sets even after a new release:

- UI current **3bc6c9d44e00-20260929T200127Z** and predecessor **0e767c69e785-20260929T165314Z**, complete surface roots, archives, sidecars and corresponding source transports.
- Node current **3bc6c9d44e00** and predecessor **d2c0afaffd9c**, managed archives and provenance. The UI transport exception above does not retire node d2 recovery material.
- Active final-source INCB replay and tablespaces (~89.53 GB), September 27 production rollback dumps and rehearsal dumps, the September 24 baseline/pgdata, historical operator-review archive (~5.78 GB), latest PostgreSQL logical dump, WAL/PITR and any other unresolved recovery chain.
- Live Core, Electrs, PostgreSQL, confirmed records, ledgers, logs, audit evidence and protocol migrations.

`deploy/audit28/cleanup-manifest.py` defaults to verification only. Apply requires `--apply --approved-manifest-sha256 <exact reviewed hash>`. It pins installed retention helper SHA-256 `0e3a5adce67f07fb6beb0b0d8001a002e247db316bc5911f3d6f5e622983e4d1` and refuses any other delete path/host, rollback drift, identity/content drift or reference; uses the deployment lock and durable receipt plus descriptor-safe recursive removal. It never invokes broad retention main/apply. For approved execution, stage the reviewed helper at `/var/tmp/proofofwork-deploy/audit28-cleanup-manifest.py` and the exact manifest at `/var/tmp/proofofwork-deploy/audit28-followup-cleanup.manifest.json`, root-owned private files. Run verification without apply first, then:

```sh
python3 -I -B /var/tmp/proofofwork-deploy/audit28-cleanup-manifest.py /var/tmp/proofofwork-deploy/audit28-followup-cleanup.manifest.json --apply --approved-manifest-sha256 4f953d31585ed762be0147a332ac8c5ab9850ad43b6f008159729b59f839b59f
```

This command is presented for approval and has not been run. Execute cleanup **before** deploying, while the manifest's verified release pair is still current. Measure free bytes before/after; allocation is not a guarantee of reclaimed bytes.

Hold decisions are intentional completed review outcomes. They are not permission to delete later. For each held item, first prove recoverability, unique-history/evidence preservation, absence of live dependencies and exact replacement material, then present a new exact manifest. The entire cleanup pipeline cannot be closed by deleting all inventoried paths.

## Isolated restore plan

Prepared `deploy/audit28/restore-logical.sh` pins:

- `/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset`
- Dump size 19,363,782,935 bytes; SHA-256 `6bb26e725f1178f25720eadc46801975b987587578fbf7018203cddc65601031`.
- Globals SHA-256 `ec6fe5b2e0b460e873739e4d0d31e103e38e8142d3695fc2cfb5c2600d1ae7f8`; check integrity, never execute globals/password hashes.
- New isolated job `/data/proofofwork-audit28-restore-20260929T213000Z`, private 0700 Unix socket, port 55432, no TCP listener, no production tablespaces/owners/ACL restoration.
- Maximum job allocation 85,899,345,920 bytes, /data free floor 107,374,182,400 bytes, root floor 10 GiB. Observed /data free ~474.44 GB; root ~71.74 GB.
- PostgreSQL 16, checksums on for the isolated cluster; 128 MiB shared buffers, 16 MiB work_mem, 128 MiB maintenance_work_mem, no parallel workers.
- Shared nonblocking backup lock; checksum timeout 10 minutes, pg_restore 55 minutes, offline page checksums 15 minutes, allocation/free-space monitor every five seconds. Stop only the isolated cluster on failure; retain its evidence and data for review.

Execution plan: stage the exact reviewed script outside the empty job at `/var/tmp/proofofwork-deploy/audit28-restore-logical.sh`; create the new empty job owned postgres, mode 0700; run a uniquely named transient `proofofwork-audit28-isolated-restore-20260929T213000Z` unit as postgres with `MemoryMax=4G`, `CPUQuota=100%`, `IOWeight=10`, `Nice=10`, `TasksMax=64`, `RuntimeMaxSec=90min`, `TimeoutStopSec=70s`, `KillMode=control-group`. Do not pause or change live PostgreSQL/Core/indexer/backup services. Do not reuse an existing nonempty job or silently choose a new source after backup rotation; re-pin and review if the exact source disappears.

Prepared checks: syntax/plan/argument refusal tests passed; latest custom dump catalog parses. Full restore, restored relational/index tests and offline page checksums are still pending. These would validate the restored backup, not retroactively certify physical live PostgreSQL pages. H18-06 remains open; no backup/replay deletion is unlocked by catalog readability alone. Before executing restore, revalidate the source pin and resource floors; any later deletion of the new restore job needs separate approval.

## Exact deployment and rollback boundary

Proposed execution after concrete approval:

1. Preserve and bind this reviewed diff plus cleanup manifest hash; run final checks/hygiene, create a reviewed commit with required trailers and push only the approved repository branch/remote. No force push. Commit hash and artifact SHA-256 are generated from this reviewed tree, then recorded in the execution receipt before cutover; content drift requires another review.
2. Capture installed tool/config hashes, service states, canonical node/Electrs/database identities, live release provenance and immutable designated rollback bytes. Abort if they differ from reviewed assumptions. Record current timers before any changes.
3. Run the single-path cleanup verifier, then its exact approved apply command; recheck live/rollback fingerprints and measure actual free bytes. No broad prune command.
4. Install the reviewed UI publisher revision at `/usr/local/sbin/proofofwork-ui-release-publish`, preserving the prior binary and hash in rollback evidence. Publish using the added `--defer-verified-retention` option plus exact preserved-root classification `--retain-rollback-root proofofwork-www-pre-3bc6c9d44e00-20260929T200127Z:d003251754bd7a70c5c72b068fcc9283e280bad124247e12b119b61836ec586f:519c5d45432292b3324b7a2edd662947bb9dc6d8230289ffa1d563ea8442f2a0`. The prior installed publisher SHA-256 is `224cdb741bcb83e79bccc1b45730bd919bf38ba7292559fab6ce3184ddc053a4`; preserve it for rollback. Its default behavior remains unchanged; this release explicitly defers automatic deletion.
5. To preserve the wider designated sets, stop only UI `proofofwork-ui-release-prune.timer`, UI `proofofwork-ui-storage-prune.timer`, and node `proofofwork-node-release-prune.timer` during this release. Confirm none of their prune services is already executing; otherwise abort and review. Keep monitoring and backups running. These timers must remain stopped until a reviewed pin-aware retention policy or later exact manifest permits resumption; this is an explicit temporary retention exception, with storage health/trend monitoring retained. Do not resume a two-release pruner that would remove designated old bytes.
6. Build candidate artifacts from the approved clean tree and lockfile, preserve current node checkout/runtime, run candidate shadow/read-only checks, stop `proofofwork-worker-recovery-watch.timer` and `proofofwork-indexer-worker.service`, capture/stop the API bridge `proofofwork-api-wg.socket` and `proofofwork-api-wg.service` if active, and stop `proofofwork-api.service` for the exchange. Use the existing `deploy/proofofwork-node-release-exchange.py --release-id <approved-commit-prefix-and-release-time>` against the exact staged `/opt/proofofwork-api-stage-<release-id>` and live `/opt/proofofwork-api` pair. Start API, restore bridge/worker/recovery-watch states only if previously active; publish the attested node archive using `deploy/proofofwork-node-release-publish.sh`. Retain the exchanged old checkout for immediate rollback; repeat the guarded exchange of that same pair if validation fails. No Core, Electrs or live PostgreSQL restart/configuration change. No schema or data migration.
7. Node first, then atomic UI publication with capacity/provenance and complete-root checks. Static surface swap requires no Caddy configuration edit or restart. Preserve new candidate and old designated release bytes. Allow normal summaries to republish; no manual SQL repair/cache blanket clear.
8. Verify all 15 surfaces in the audit order, Computer last. Require Core checkpoint reconciliation, fresh DNS 23 names/one sealed listing at the audit fixture (adjust only for newly verified chain events), initial Computer DNS hydration, the four seal dates above, API/UI parity, exact accounting/fee tests and coherent WORK/AMO readiness. Benchmark bounded probes; a 503 means availability remains open, not a passing closeout. No signing/broadcast/purchase during verification.
9. On authority, integer, inventory, provenance or health regression, stop cutover and restore the captured **3bc** node runtime and verified **3bc** UI complete root atomically using existing guarded rollback tools; restore saved publisher and service/timer states, retaining the designated older sets. Verify hashes, Core/API identities and app health again. Do not delete failed candidate evidence or touch databases to hide a release failure.
10. Append actual execution/production verification results and any unresolved findings. Run hygiene again for any new local receipt/docs, then commit/push only within the expressly approved scope. Public copy follows only after successful approved production closeout.

Production approval must explicitly cover: this final source/tool diff; one deletion manifest hash; named publisher installation; the three retention timer stops/temporary retention exception; attested API/indexer cutover and API restart; atomic static UI release and guarded rollback; optional pinned isolated restore unit; repository hygiene, reviewed commits/pushes and bounded read-only production verification. No other configuration, service, deletion, accounting repair, physical DB maintenance or external alert message is included. New candidate, drift, destination or material scope requires separate approval.

## Tests and handoff

- TypeScript/build pass; build retains the existing large App chunk warning.
- 552/552 index-recovery behavior checks pass, including canonical timestamp and missing-time regression.
- Two local Chrome browser tests pass for standalone/Computer DNS loading, failed reads, malformed HTTP 200, retry and verified empty state.
- Canonical seal-time, API truth, server globals, surface read state, API timeout (10 tests), wallet UTXO refresh, read projections, client containment (43 checks), node operations, hardening, live-data and retention helper checks pass.
- Readiness latency-label tests and five cleanup/restore/publisher-deferral preparation tests pass.
- Full UI operations/publication/rollback contract suite passed in the final isolated run under a 900-second total cap. Initial shorter budgets interrupted expensive rollback fixtures; the completed run used the original assertions with temporary progress logging and no per-step cap. Focused publisher-deferral and seven retention-helper tests also pass.
- Full isolated backup restore and production deployment verification are not complete and are not claimed.

SOUL and canonical protocol/product docs were reviewed. No protocol rule changes or historical-note deletions are justified. This dated preparation records the pending operational behavior; canonical infrastructure documentation notes the retention-deferral option. See final execution receipt for installed state, not this preparation. Repository hygiene fix/check passed, with local dist/Vite cache outputs removed under the narrow allowlist. No tracked historical/evidence file was removed. Generated local build/cache output is rebuildable state, not production cleanup.
