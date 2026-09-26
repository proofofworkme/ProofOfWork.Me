# Production Comprehensive Health and Data-Integrity Audit 25

- Audit date: 2026-09-26
- Audit window: 2026-09-26 14:45–15:28 UTC
- Network: livenet
- Prior audit: [Audit 24](2026-09-26-production-comprehensive-health-data-integrity-audit-24.md)
- Scope: UI VPS; node/API/full-node VPS; PostgreSQL indexer database; Bitcoin Core; Electrs; indexer worker; public API; application surfaces; logs; backups; caches; temporary storage; protocol and application math.
- Method: read-only SSH, Bitcoin Core RPC, PostgreSQL read-only transactions, public HTTPS GETs, repository verification gates, and headless browser renders.

## Executive Summary

At close, Bitcoin Core, its transaction and filter indexes, Electrs, the indexer, PostgreSQL, the API health route, and the public consistency endpoint agreed at block 968704, hash `00000000000000000001632ec4039055ca2622fecee1d3af6fb5c257ff554b8d`. Index lag was zero. The 25-check consistency response was green on snapshot `6fd92a72c73a994bb8ef81da`, and the final live ledger audit passed on that same snapshot.

No transaction, event, participant, credit-key, ID-key, or listing duplication was found. No event-reference or participant orphans were found. All 169 indexed pending transactions were in Core’s mempool at the closing sample; no confirmed indexed transaction was in the mempool. Confirmed transaction and event status mappings matched, and no confirmed transaction or event lacked canonical block metadata.

The deterministic WORK AMO V8, WORK precision, bond arithmetic, canonical-ordering, credit-mint, marketplace, mail, and participant regression gates passed. The current browser pass rendered all 14 public surfaces with no JavaScript exceptions or failed API responses during the page sessions.

The remaining material issues are previously reported and still visible: four confirmed transaction rows lack `raw_tx.canonicalBlockScan`; one event reference lacks its expected `ticker=INCB`; exact-tip handoff can briefly return fail-closed registry responses; the WORK token response is about 78–80 MB and can exceed a 20-second caller timeout; PostgreSQL query-health still alerts during the successful nightly dump; and the node storage monitor is over its release-backup review threshold. No production data or configuration was changed, and no production files were removed.

## Systems and Services Checked

### UI VPS

Host `ubuntu-4gb-hel1-1` (`77.42.91.106`):

- Caddy active; the UI is served as static application files. Nginx and `proofofwork-ui.service` are inactive, as expected for this host layout.
- PostgreSQL is not running on the UI VPS: both PostgreSQL units were inactive, no postgres processes were present, and `/var/lib/postgresql` was absent. The live indexer database is on the node/API VPS; current UI disk usage is release, recovery, deployment, and application storage, not local database growth.
- Root filesystem: 39,973,924,864 bytes total, 8,081,117,184 used, 30,208,614,400 available (22% used); inode use 5%.
- Memory: 4,005,457,920 bytes total, 3,428,790,272 available; no swap configured.
- Load average: 0.03 / 0.07 / 0.02.
- `journalctl --verify` passed. Journal storage was 296.2 MB. The 62 error-priority journal entries in the last day were from SSH/sshd/init scope; no UI application service errors were recorded.
- One failed unit remains: `proofofwork-boost-ui-publish-6c5e7b5a3d03.service`, a stale failed publish attempt already listed in Audit 24. It was not reset.
- UI storage trend at 15:02 UTC was healthy: 30.21 GB free, 10 GB reserve, 19.47 GB headroom. Net consumption over the measured day was negative 17.05 GB, reflecting reclaimed space.

### Node/API/Full-Node VPS

Host `pow-bitcoin-01` (`65.108.122.87`):

- `bitcoind`, Electrs, PostgreSQL 16, `proofofwork-api`, and `proofofwork-indexer-worker` active.
- Root filesystem: 105,089,261,568 bytes total, 22,486,835,200 used, 77,216,940,032 available (23% used); inode use 5%.
- `/data`: 1,764,768,071,680 bytes total, 1,176,813,166,592 used, 578,967,728,128 available (68% used); inode use 1%.
- Memory: 134,125,752,320 bytes total, 117,974,941,696 available. Swap: 17,179,865,088 total, 1,135,345,664 used.
- Load average: 1.16 / 1.84 / 1.69 on 32 CPUs.
- `journalctl --verify` passed. Journal storage was 617.3 MB. No error-priority journal records were found in the last day. `/var/log` allocation was 1.23 GB.
- PostgreSQL accepted connections. Query-health samples after the dump showed zero active queries, zero lock waiters, and zero idle transactions; tablespace closure was 18/18 correctly placed members, with zero invalid indexes, unrelated members, or owned-sequence anomalies.
- The failed-unit list contains 16 entries: mostly older Audit 17/Audit 23 publish, audit, and restore attempts, plus the current storage-trend and API-observation monitor failures and the known boost fixture/cutover attempts. No failed service was reset.

### Chain, Indexer, Database, and Public Readiness

Final closing checkpoint:

- Bitcoin Core: main chain, height and headers 968704, initial block download false, verification progress 1.0, unpruned, no warnings. Core reported `size_on_disk=879,071,085,933` bytes.
- `txindex`, basic block filter index, and coinstats index all synced through 968704.
- Electrs header height 968704 and at tip.
- Indexer checkpoint height/hash exactly matched Core and the canonical `proof_indexer.blocks` tip row. API health returned HTTP 200; index lag 0; worker had zero consecutive failures, zero unresolved pending events, and was proof-ready.
- All eight summary coverage keys reached 968704. The eligible summary snapshot was `6fd92a72c73a994bb8ef81da`, with a 5,670,112-byte payload.
- `/api/v1/consistency?network=livenet` returned HTTP 200, `status=green`, 25 checks, and no failed checks on that snapshot.
- PostgreSQL database `proof_indexer` was 34,995,633,175 bytes. Its tablespace occupied 34,419,879,936 bytes on `/data`.
- Largest relation: `work_amo_block_transitions`, 33,683,644,416 bytes and 9,082 live rows. This is about 96% of the database and remains the dominant database-growth surface. `ledger_snapshots` was 736,043,008 bytes. The `work_amo_block_transitions` relation was about 33.35 GB in Audit 24; database size then was 34,727,410,711 bytes.
- `pg_stat_database` showed 187,651 temporary files and 1,922,175,094,046 cumulative temp bytes. The stats-reset timestamp was unavailable, so this is not a current disk-usage measure and its time horizon cannot be inferred from this sample.
- A direct `pg_amcheck` scan was attempted in parent-check mode, but the server does not have the `amcheck` extension installed; it skipped the database and checked no relations. No extension was installed. A page-level PostgreSQL corruption scan therefore remains outstanding.

## Capacity, Backups, Cache, and Temporary Storage

### UI Storage

- `/var/backups/proofofwork-ui`: 3,708,727,296 bytes total. Its major groups were recovery evidence 1,570,279,424 bytes, release material 1,309,306,880 bytes, rollback roots 232,120,320 bytes, and cleanup evidence 168,919,040 bytes.
- The active release directory has two verified release archives: `bfc54c826db1` from 2026-09-23 (185,446,159 bytes) and `388572b6c8eb` from 2026-09-25 (185,541,941 bytes). Current retention is two. A prior rejected hardlink artifact and older release/recovery bundles remain in the tree.
- Recovery evidence includes Audit 17 archives (about 1.57 GB combined across the two largest roots), and rollback/cleanup evidence. These are preserved evidence, not safe automatic cleanup.
- `/var/tmp` includes deploy scratch 247,779,328 bytes, `proofofwork-ui-a6-surfaces` 204,099,584 bytes, `proofofwork-ui-q16-v7-preactivation-a007263-final` 191,688,704 bytes, and an old sync archive 23,425,024 bytes. `/tmp` was 909,312 bytes.
- The UI storage-prune dry run reported zero groups, zero candidate paths, and zero candidate bytes. The safe pruner therefore does not classify these unmarked roots as removable.

### Node Storage and Backup Retention

- Major allocations: `/data/bitcoin` 978,398,568,448 bytes by filesystem measurement; `/data/electrs` 64,151,564,288 bytes; PostgreSQL tablespace 34,419,879,936 bytes; PostgreSQL logical backup set 18,302,119,936 bytes; release-backup tree 8,827,191,296 bytes; `/tmp` 4,932,747,264 bytes; `/var/tmp` 541,913,088 bytes; API cache 171,188,224 bytes.
- The two previously reported INCB final-source replay directories remain: `proofofwork-incb-final-source-replay-20260924T143604Z` at 32,853,667,840 bytes and `proofofwork-incb-final-source-replay-20260925T022000Z` at 30,281,613,312 bytes, 63,135,281,152 bytes combined. They are replay/evidence workspaces, not ordinary release backups; neither was removed.
- The latest PostgreSQL dump set is `/data/proofofwork-postgres-backups/logical/proof_indexer-20260926T031852Z.dumpset`. The scheduled unit completed successfully at 03:35:58 UTC. `sha256sum -c` passed for `proof_indexer.dump` and `globals.sql`; `pg_restore -l` read 212 catalog entries. This verifies file checksums and archive readability, not an isolated restore. No older logical dump set was found in the active logical-backup directory; older recovery evidence remains.
- The official managed release directory contains five verified release archives and zero unverified archives. Its existing dry-run retention target is three and would prune the two 2026-09-23 archives `proofofwork-node-release-5882758-20260923T213800Z.tgz` and `proofofwork-node-release-b180548-20260923T032423Z.tgz`. It would retain releases from 2026-09-24 and the two 2026-09-26 releases.
- The release-backup tree is above its 8 GiB review threshold by about 0.22 GiB. It also contains the 5,783,619,456-byte `operator-review-opt-checkouts-20260820T184500Z.tar.zst`, older rollback and quarantine directories, and UI preservation evidence. These are outside the routine three-release prune decision and need owner review before removal.
- Node storage trend at 15:02 UTC estimated 6,731,690,168 bytes net consumption over the prior day, 471,593,553,920 bytes above the 100 GiB reserve, and about 70 days to that reserve if the measured rate continued. The forecast itself was healthy; the systemd storage-trend unit exited 1 because the release-backup allocation crossed its review threshold. The estimate is a short historical trend, not a guarantee against growth bursts.

No backup, release, replay, rollback, cache, temporary, log, or evidence files were removed. The UI retains more than one dated recovery/release item, and the node retains five verified release archives, but deleting release artifacts or evidence is not covered by the safe pruner. Exact cleanup scope and the desired retention target require approval before changing production retention or deleting those paths.

## Data Integrity, Event Tracking, and Mempool

Closing database counts:

- Transactions: 25,708 confirmed, 80 dropped, 169 pending.
- Events: 26,392 confirmed, 9 dropped, 167 pending.
- IDs: 507; mail items: 617; credit definitions: 238; credit balances: 430; credit listings: 1,214.
- Event rows without a transaction: 0. Pending event/transaction status mismatches: 0.
- The 169 pending transaction rows matched Core’s current 75,973-entry mempool exactly; 0 were absent. Zero confirmed indexed transactions were present in Core’s mempool.

Read-only integrity queries found zero duplicate transaction keys, event keys, event refs, participants, ID keys, credit-definition keys, credit-balance keys, or credit-listing keys. There were zero orphan event refs or participants, zero negative confirmed credit balances, zero invalid PostgreSQL indexes, zero confirmed transactions missing block fields, zero confirmed transactions without their matching canonical block row, and zero confirmed events without a canonical block row.

Previously documented derived-index parity residues remain:

1. Four confirmed transaction rows have the expected canonical height/hash but lack `raw_tx.canonicalBlockScan`: `4c0791444b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359` at 962992; `939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c` at 966199; `4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212` at 966498; and `8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf` at 966878.
2. Event 4256606, transaction `ebe60fd108e8830b4741101e6525081387dcf328e81c12fa2b533de0bdbf0d3e`, is a confirmed invalid PWT1 token event for token `3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d`; its event refs contain `token-id` but still lack the expected `ticker=INCB` ref.

Both are the same parity issues already reported in Audit 24. The current database’s canonical block rows and status joins remain consistent, but full indexer parity is still not green until those derived projection fields are addressed and verified.

## Application Rendering and API Availability

- The production surface audit confirmed HTTP 200 and all referenced scripts/stylesheets for all 14 public shells.
- Headless Chromium rendered all 14 routes. Each mounted the app root and produced page text. No page exceptions or API responses at 4xx/5xx were observed during the rendered sessions. ID and Credit hydration needed about 8 seconds; the disconnected Wallet surface rendered its shell in about 23 seconds. No wallet was connected and no signing material was accessed.
- Mail regressions passed across eight address/inbox/sent/history cases, including historical body rendering and known self-send records.
- Marketplace fast regressions passed for ID lookup, V2 cutover/invalid state, POWB sealed listing, WORK listing lifecycle, wallet scopes, and targeted transfers.
- Credit mint regressions passed: POW 1,525,100 of 10,101,010 confirmed, 0 pending, 8,575,910 available; WORK 21,000,000 of 21,000,000 confirmed, 0 pending.
- WORK participant regression passed for the canonical delayed transfer, attributed address, and participant amount.
- Direct API reads showed the registry and ID summaries at tip 968702 with 527 records, 507 confirmed and 20 pending. Boost recovered to HTTP 200 at that same tip. Subsequent health, summary, and consistency reads agreed at tip 968704.
- During a full API surface pass, registry, ID, and AMO reads briefly returned fail-closed 503 responses while their indexed registry checkpoint lagged the just-advanced Core tip; Boost returned 409 for incomplete same-checkpoint identity data. Repeat reads succeeded after the snapshot advanced. `check:production-observability` also observed one health 503 at 15:08:46 UTC; three direct retries and the closing health/consistency checks returned 200. This is a transient exact-tip readiness/availability issue, not evidence of mismatched confirmed records.
- The full WORK token API body was 77,986,377 bytes and took 20.58 seconds to read. The production observation monitor’s latest 10-minute sample (about 15:25 UTC) was severity 1: `/api/v1/token` max payload 80,039,161 bytes (`large-response`), plus one slow `/api/v1/internal/canonical-summary` response with p95 11,776 ms. Those monitored routes had zero server errors in that sample. The surface audit’s 20-second wallet request timed out, then the full direct read completed. This remains an availability and rendering risk for callers with short timeouts.

The API observation service was in failed state after emitting latency/large-response alerts. The production health route and 25-check consistency route were green at close. Summary and wallet payload size/latency remain open from Audit 24; API monitoring does not cover aborted client reads, which this audit observed directly.

## Math Verification

Passed gates:

- `check:work-amo-v8`: V8 face 25,000 proofs; Q16 scale of 10^16 subatoms per WORK; Q8 network value scale; V8 declaration SHA256 `0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d`; canonical order by block height, transaction index, protocol vout, and record ordinal.
- `check:work-precision-v2`: global Q16 units, immutable Q8 conversion, V8 pricing and cross-plane wiring passed.
- `check:bond-exact-arithmetic`: passed.
- `check:canonical-order`: canonical UTF-8 order passed.
- `check:api-truth` and `check:live-data`: passed.
- `audit:ledger`: passed on closing snapshot `6fd92a72c73a994bb8ef81da`, value `14407019274282857003.38222055` proofs.
- Credit, marketplace, mail, and WORK participant accounting regressions passed as recorded above.

No math discrepancy was found in these deterministic gates or the live ledger reconciliation. The protocol fee split reviewed from canonical ID rules remains 1,000 proofs for registration and 546 proofs for receiver updates, direct transfers, listings, seals, delistings, and buyer-funded transfers. The local `check:hardening`, `check:node-ops`, `check:ui-ops`, `check:ui-capacity`, `check:api-truth`, and `check:live-data` gates also passed; the final `check:production-observability` passed at 15:22 UTC after one earlier health 503.

The full internal ID verifier, `audit:computer-events`, and heavyweight `indexer:parity` were not rerun: the production database/verifier environment was not available to this audit runner, and the infrastructure guide reserves full parity for a quiet database-hardening window. This is a scope limit, not a clean parity result. The current database was queried read-only over SSH; ledger/consistency and the relevant mail, marketplace, credit, and WORK regressions passed; and the exact Audit 24 parity residues were directly reconfirmed.

## Prior Issue Rechecks

- Audit 24 H24-01 / availability: still open. The 78 MB WORK response took 20.58 seconds; wallet reads can outlive a 20-second caller timeout. Exact-tip registry refusals were brief and recovered after index catch-up.
- Audit 24 H24-02 / internal ID audit: public registry/ID summary and ID route checks passed after catch-up; the privileged full ID verifier audit was not rerun in this window.
- Audit 24 H24-03 / backup and query-health: the 2026-09-26 dump succeeded and passed checksum/catalog checks. The query-health monitor again escalated during the long dump read, then cleared after completion. This remains an alert-classification issue.
- Audit 24 H24-04 / node release-backup threshold: still open. The release tree remains over its 8 GiB review threshold; the current dry run confirms five verified archives and two would-prune items at retention three.
- Audit 24 H24-05 / old UI archives: still present within release, rollback, recovery, and cleanup evidence roots. UI has ample free space, and the automatic safe pruner found no removable candidates.
- Audit 24 H24-06 / INCB replay storage: both large replay directories remain at 63.14 GB combined. They were not classified as disposable backups and were preserved.
- Audit 24 H24-07 / stale failed units: the stale UI publish failure and historical node audit/test/restore failures remain. Storage-trend and API-observation monitor failures also appeared during this audit for the documented review threshold and latency alerts.
- Audit 24 H24-08 / parity: the same four missing canonicalBlockScan fields and one missing ticker reference remain. No new duplicate/orphan/status mismatch appeared.
- Audit 24 application-surface exact-tip issue: observed again briefly, then recovered at the next indexed checkpoint. All public shells and final health/consistency responses were available at close.
- Audit 23 backup retention repair and UI disk mitigation remain effective: one current verified logical PostgreSQL dump set is present, its checksums pass, and UI root is 22% used with about 30.2 GB available.

## New Findings

No new confirmed-chain corruption, duplicate records, math discrepancy, or persistent UI disk failure was identified. This audit adds new measurements and confirms recurrence of the availability, parity, backup-monitor, release-retention, and storage-trend issues already tracked above.

## Actions Taken

- Performed read-only production checks and verification scripts; no production configuration, database row, protocol record, ledger, evidence, service state, backup, rollback, cache, or temporary file was changed or removed.
- The production `pg_amcheck` attempt did not inspect relations because the `amcheck` extension is not installed. It made no database change.
- Created this audit record and classified it in the repository note inventory. No commit or push was made.

## Items Requiring Approval

1. Confirm whether UI release retention should change from two verified releases to one. The older active release candidate is `proofofwork-ui-release-bfc54c826db1-20260923T152920Z.tgz` (185,446,159 bytes), plus its checksum/provenance sidecars. Recovery, rollback, and cleanup-evidence directories are not included in that candidate.
2. Confirm whether node release retention should change from three to one. The current dry run would prune only the two named 2026-09-23 archives; retaining one would additionally remove the 2026-09-24 release and the 2026-09-26 01:52 release, leaving the 2026-09-26 02:48 release. The 5.78 GB operator-review archive and the rollback/quarantine/evidence directories need separate review.
3. Approve or reject a path-by-path review of the 63.14 GB INCB replay directories, 4.93 GB node `/tmp`, 541.9 MB node `/var/tmp`, and the older UI scratch/recovery roots. No item is classified as safe to delete solely by age.
4. Approve correction of the five previously reported derived-index parity residues through the normal canonical repair workflow, followed by a full `indexer:parity` run in a quiet hardening window.
5. Approve installing/enabling PostgreSQL `amcheck` if a physical/index structure scan is required. No extension was installed during this audit.

## Recommended Follow-up

- Reduce the WORK token payload without weakening complete sealed-listing coverage; add pagination or a bounded view and verify UI/API timeouts and memory use.
- Make API observation health report long expected canonical-summary and backup reads with context, while retaining alerts for real contention and oversized public responses.
- Keep a time-based view of `/data` growth; the short sample implies about 70 days to the 100 GiB reserve if the observed rate persists. Review release-backup allocation and operator-review archive ownership.
- Decide release retention explicitly, then use the existing verified prune mechanisms only for the approved exact paths. Preserve recovery evidence and INCB replay provenance until owners confirm those workspaces are no longer needed.
- Repair the known derived metadata, then run the full parity and privileged ID audit with the production verifier available. Run a controlled restore validation separately; the latest backup was checksummed and catalog-read, not restored.

## Second Ordered Application-Surface Audit — 2026-09-26

- **Audit window:** 2026-09-26 15:37–16:03 UTC.
- **Scope:** all fourteen public application surfaces in the requested order, followed by current full-node, Electrs, indexer/API, PostgreSQL, storage, log, and math checks across the UI VPS and node/API VPS.
- **Surface order:** Home, ID, Desktop, Browser, Boost, AMO, Credit, Wallet, Work, Infinity, Inception, Log, Growth, Computer last.
- **Predecessor review:** read Audit 25 and Audit 24 and cross-referenced the preceding issue records (Audits 20–23 and older issue references) before classifying this pass. The pre-append SHA-256 of this file was 2a5fc42404519bbaa925956fa51a43de0525b1b2f99e2d763a68b5b0e705d90d; Audit 24 was 07be573729eba4249b80b46712a84f622436c50f30939bccdd4c7087d5023efe.
- **Method:** ordered production shell/asset/API GETs; anonymous Chromium page renders and two read-only public lookups; Core RPC; read-only PostgreSQL transactions; health/consistency and ledger audits; source and deterministic contract gates; SSH service, filesystem, Docker, and journal reads. No wallet was connected and no signing material was accessed.

### Executive summary

At close, Bitcoin Core, txindex, coinstatsindex, the basic block filter index, Electrs, PostgreSQL’s canonical block row, indexer health, and the public API agreed at block **968708**, hash 000000000000000000015c211b9bc6304ebdcb8baf28bf8fb10a10bc21f55a48. Core was fully synchronized, unpruned, and warning-free. Index lag was zero. The fresh API health response was ready and the 25-check consistency response was green on snapshot 16b9375ed66f8b8138c2a676.

The long surface render overlapped a four-block advance from 968704 to 968708. During that convergence, Home and ID registry reads returned 503, AMO returned 503 and 409, and an early Inception registry read returned 503. The affected pages failed closed or stayed in a verifying/loading state; they did not show invented confirmed counts. After the indexer and summary snapshot reached 968708, direct retries returned 200. This is a materially active recurrence of the previously tracked exact-tip availability issue, not evidence of confirmed-chain corruption.

The database integrity queries found no new duplicate transaction/event/reference/participant/ID/credit/listing keys, no orphan references or participants, no pending event/transaction status mismatch, no confirmed row without its canonical block row, no negative confirmed credit balance, and no invalid PostgreSQL index. The same four missing canonicalBlockScan markers and missing ticker=INCB reference remain from Audit 24/25. The exact ledger audit and deterministic arithmetic gates passed. No new unique issue ID is assigned in this continuation.

### Ordered surface results

The production surface probe ran with fresh reads in the requested sequence. All fourteen HTML shells returned HTTP 200; each shell’s module, module preloads, and stylesheet also returned 2xx/3xx with expected content types. Every API probe in this pass returned HTTP 200. Times below are the fresh probe durations; they are not complete UI hydration times.

| # | Surface | Fresh API probe result |
|---:|---|---|
| 1 | Home — proofofwork.me | Registry summary 200, 6.53 s. |
| 2 | ID — id.proofofwork.me | IDs summary 200, 11.01 s. |
| 3 | Desktop — desktop.proofofwork.me | Log summary 200, 5.04 s. |
| 4 | Browser — browser.proofofwork.me | Activity summary 200, 2.90 s. |
| 5 | Boost — boost.proofofwork.me | Boost feed 200, 3.46 s. |
| 6 | AMO — amo.proofofwork.me | Compact marketplace summary 200, 8.81 s. |
| 7 | Credit — credit.proofofwork.me | Compact token summary 200, 8.43 s. |
| 8 | Wallet — wallet.proofofwork.me | Full WORK token 200, 17.81 s. The prior measured body was 77,986,377 bytes; the current monitor measured 80,108,083 bytes. |
| 9 | Work — work.proofofwork.me | Work summary 200, 6.25 s; floor 200, 4.88 s. |
| 10 | Infinity — infinity.proofofwork.me | Infinity summary 200, 3.73 s. |
| 11 | Inception — inception.proofofwork.me | Inception summary 200, 3.16 s. |
| 12 | Log — log.proofofwork.me | Log summary 200, 2.56 s. |
| 13 | Growth — growth.proofofwork.me | Growth summary 200, 2.74 s. |
| 14 | Computer — computer.proofofwork.me | Health 200, 0.60 s; 25-check consistency 200, 2.89 s. Computer was also the final rendered application page. |

The longer anonymous browser pass mounted all fourteen app roots. It found these material states:

- **Home:** the counts projection returned 503 during the chain advance. The page showed unavailable/ellipsis counts, not false zeros. A later direct read returned 200.
- **ID:** /api/v1/registry returned 503 during the same convergence; the page said the canonical registry could not be verified and showed unavailable counts, not false zero counts. A later direct read returned 200.
- **Desktop:** the read-only carbonz public lookup completed. It reported one public file, POWCarbonz.jpg (11 KB, 546 proofs), SHA-256 c3a50b3d0ccb92f989754c7b8ca0019f43c642048047cd8b04f60c1f048b3ab6. This did not reproduce H20-03’s duplicate-file result. The filename appears in both the single tile and its inspector; the UI reports one public file.
- **Browser:** a 200 transaction lookup for the known confirmed POWCarbonz.jpg image transaction (8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7) was correctly rejected as non-HTML. The Browser did not claim to render an image as a verified HTML page. A valid HTML transaction was not exercised in this pass.
- **Boost:** the page settled and displayed feed content after its initial loading state; no failed API response was observed in the longer render.
- **AMO:** the page still showed “Verifying one coherent registry, credit, and WORK snapshot” after 19 seconds. Its browser reads included 409 from Boost listing hydration and 503 from marketplace-summary during convergence. The compact direct summary later returned 200, but this pass did not obtain a fully hydrated listing/purchase book.
- **Credit:** token directory content loaded without an observed page exception or failed API response. The database contained 238 credit definitions and 430 balance rows; this anonymous view does not certify any individual wallet’s holdings.
- **Wallet:** remained disconnected, as intended. After the render wait it showed 0 Spendable proofs alongside Loading; no account balance, pending transfer, or spendable amount was certified. This repeats the previously documented low-severity disconnected-state wording issue.
- **Work:** settled to the canonical 21,000,000 / 21,000,000 WORK minted total, 21,000 mints, with no failed API response in the long render.
- **Infinity:** displayed 630,496,569 confirmed POWB, zero pending, 1.00000779 proofs/POWB floor, and 630,501,483 proofs network value.
- **Inception:** the longer render completed without a failed API response and showed 224,847,713,398,447,926 confirmed INCB, zero pending, 1 proof/INCB floor, and network value 224,847,713,398,447,947.9358206 proofs.
- **Log:** displayed 26,072 total actions, 26,050 confirmed, and 21 pending. One total action is outside those two status counts, matching the previously documented H6-15 supplemental-activity scope distinction. The current consistency response reported missingLogEvents=[].
- **Growth:** loaded the verified growth summary and explicitly labeled modeled projections as scenarios rather than current confirmed activity.
- **Computer (last):** the disconnected shell still showed REGISTRY NETWORK Unavailable / No verified registry snapshot available, even though the current API health and consistency responses were green at the same canonical tip. Its empty local Inbox counts were disconnected local state, not global mailbox totals.

The Browser renderer’s current source continues to use an empty iframe sandbox, no-referrer, and a restrictive CSP (default-src 'none', connect-src 'none', script-src 'none'). This is a source-level hardening check; no penetration test or authenticated session was performed.

### Full-node, service, and capacity results

**Canonical node checkpoint at 2026-09-26 15:57:41 UTC:** main chain height/headers 968708, best hash 000000000000000000015c211b9bc6304ebdcb8baf28bf8fb10a10bc21f55a48, verification progress 1.0, initial block download false, unpruned, warnings empty. txindex, coinstatsindex, and basic block filter index were synced at 968708. Electrs was active and reported height 968708 at tip. bitcoind, PostgreSQL 16, API, and indexer worker were active.

Core’s closing mempool sample contained 75,102 transactions, 40,376,833 transaction bytes, and 224,723,000 bytes of usage against a 2,000,000,000-byte limit; fullrbf=true, unbroadcastcount=0, and optimal=true. Read-only txid reconciliation found all **169/169** indexed pending transactions in Core’s mempool and zero confirmed indexed transactions in the mempool. The 167 pending event rows agreed with their transaction status; no pending status mismatch was found.

The closing API health result was HTTP 200, ready=true, lag 0, worker proof-ready, zero consecutive worker failures, zero unresolved pending events, all eight summary coverage keys at 968708, and snapshot 16b9375ed66f8b8138c2a676. The 25/25 consistency checks passed on the same snapshot with no failed check and no missing log events.

**UI VPS ubuntu-4gb-hel1-1 (77.42.91.106):** root 38 GB, 7.6 GB used, 29 GB free (22%); inode use 3%; memory 3.2 GB available; no swap; load 0.08 / 0.03 / 0.01. Caddy was active; PostgreSQL had no active unit/process and no local PostgreSQL data directory. One old failed unit remains: proofofwork-boost-ui-publish-6c5e7b5a3d03.service. The UI backup tree remained 3,708,727,296 bytes and /var/tmp 761,982,976 bytes. The two current verified release archives remain the 2026-09-23 (185,446,159-byte) and 2026-09-25 (185,541,941-byte) bundles.

**Node/API VPS pow-bitcoin-01 (65.108.122.87):** root 98 GB, 21 GB used, 72 GB free (23%); /data 1.7 TB, 1.1 TB used, 540 GB free (68%); inode use 5% on root and 1% on /data; memory 110 GB available; swap use about 1.1 GB; load 0.50 / 1.10 / 1.33 on 32 CPUs. These readings show no immediate full-disk or CPU/memory emergency. The UI currently has about 19 GB of headroom above its 10 GB reserve, but its earlier disk-full incident remains a retention risk if releases and scratch material accumulate again.

PostgreSQL proof_indexer measured **35,023,191,063 bytes** at close. Its largest relation, work_amo_block_transitions, measured **33,711,276,032 bytes** (about 96.3% of the database), with 9,088 rows covering heights 959621–968708. The prior Audit 25 database sample was 34,995,633,175 bytes / 9,082 transition rows; the increase coincided with new canonical transition rows while the chain advanced. This confirms the known growth concentration, not unexplained corruption. /data had about 540 GB free. No invalid PostgreSQL indexes were found. The optional amcheck extension is still absent (pg_extension check returned false), so no PostgreSQL page-level corruption scan has been performed.

**Logs and failed monitors:** journal storage measured 979.2 MB on the node and 296.2 MB on the UI VPS. journalctl --verify completed successfully on both hosts; all reported journal files passed on the repeated UI run. No recent error-priority entries came from the API or indexer-worker units. The only recent UI error-priority entries were SSH connection-reset messages. Three Mempool Docker containers were running and healthy; all used bounded json-file logging (max-size=25m, max-file=4). Their active log files measured about 81 KB (API), 4 KB (DB), and 105 bytes (web), so H20-01’s unbounded-log condition was not present in this sample.

The API observation timer remained failed after emitting a **severity 2** sample at 15:50 and a **severity 1** sample at 15:55. The 15:50 ten-minute window included /api/v1/marketplace-summary 9 server errors / 28 requests, /api/v1/token-history 12 / 114, /api/v1/registry-summary 2 / 6, /api/v1/registry 1 / 3, /api/v1/inception-summary 1 / 5, and /health 1 / 3. It also recorded /api/v1/internal/canonical-summary p95 12.1 s and an 80,108,083-byte /api/v1/token response. At 15:55 the 80.1 MB payload and summary latency alerts remained; the summary-route readiness check completed successfully. These windows overlapped the audit’s ordered GETs and browser loads, so they are not a normal-traffic baseline. They do, however, show that read-only audit-level traffic and a moving tip can expose the existing API capacity/readiness weakness. The monitor only covers finished GETs and explicitly excludes client-aborted reads.

 /data/proofofwork-release-backups remained 8,827,191,296 bytes, about 0.22 GiB above its 8 GiB review threshold; five current managed archives had been verified by Audit 25, and that audit’s dry run identified two 2026-09-23 archives for the configured three-release retention. The 5,783,619,456-byte operator-review archive remains in the tree. The node storage-trend unit remained failed at the review threshold. The latest logical PostgreSQL dump set remained the single 2026-09-26 set at /data/proofofwork-postgres-backups/logical/proof_indexer-20260926T031852Z.dumpset (18,294,636,601-byte dump); Audit 25’s checksum/catalog check passed, but no isolated restore was proven.

Temporary/evidence storage still needs path-by-path review: node /tmp 4,932,747,264 bytes (largest top-level allocations included the 318 MB Bitcoin Core upgrade workspace, 273 MB Audit 17 UI upload copies, and 178 MB UI smoke bundle); node /var/tmp 541,913,088 bytes (about 181 MB deploy material and three Boost rehearsal roots totaling about 173 MB); UI /var/tmp about 762 MB (about 248 MB deploy scratch, 204 MB UI A6 state, and 192 MB Q16 preactivation state). The two INCB replay/evidence roots remain 32,853,667,840 and 30,281,613,312 bytes (63.14 GB combined). None was deleted or classified as safe to delete solely because of age. Current UI release/recovery, node release/replay, temporary, and backup items are review candidates only.

### Data-integrity and event-tracking results

The final read-only database counts were 25,708 confirmed, 169 pending, and 80 dropped transactions; 26,392 confirmed, 167 pending, and 9 dropped events; 507 ID records; 238 credit definitions; 430 credit balances; and 1,214 credit listings. Duplicate-key queries returned zero for transactions, event keys/references, participants, ID keys, credit definitions/balances, and credit listings. Orphan references and participants were zero. Confirmed transactions missing block fields, transactions without a matching canonical block row, and confirmed events without a matching canonical block row were zero. Confirmed credit balances below zero were zero. All joins/status checks and current mempool comparisons agreed.

Two derived-index parity residues remain unchanged from Audits 24/25:

1. Confirmed transactions 4c0791444b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359 (height 962992), 939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c (966199), 4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212 (966498), and 8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf (966878) retain canonical block metadata but lack raw_tx.canonicalBlockScan.
2. Confirmed invalid PWT1 event 4256606, transaction ebe60fd108e8830b4741101e6525081387dcf328e81c12fa2b533de0bdbf0d3e, still lacks its expected ticker=INCB event reference. Its invalid status and canonical block history were not changed.

The full indexer:parity, privileged internal ID verifier, and audit:computer-events were not rerun in this surface audit. The prior records reserve full parity for a quiet hardening window and the production verifier environment is not available to this runner. Their status remains unverified/red where previously documented; the green consistency and ledger checks do not waive these five residues or certify every physical database page.

### Math verification

The live audit:ledger passed against https://work.proofofwork.me on snapshot 16b9375ed66f8b8138c2a676; exact WORK live value was 14407019274282857003.38222055 proofs. The API consistency result passed all 25 current cross-model checks. Rerun source gates passed: check:work-amo-v8, check:work-precision-v2, check:bond-exact-arithmetic, check:canonical-order, and check:hardening.

The checked WORK AMO V8 declaration remained SHA-256 0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d, with a 25,000-proof face, Q16 scale 10^16 subatoms per WORK, Q8 network-value scale, and canonical ordering by block height, transaction index, protocol vout, and record ordinal. Precision V2, immutable Q8 conversion, bond arithmetic, and canonical UTF-8 ordering passed. The canonical fee split remains 1,000 proofs for ID registration and 546 proofs for receiver updates, direct transfers, listings, seals, delistings, and buyer-funded transfers.

The current INCB exact value fields reconciled: fixed issued supply is 224,847,713,398,447,926 INCB; the network value is 224,847,713,398,447,947.9358206 proofs, including 21.9358206 proofs of attached-WORK valuation dust. At the API’s 84,010 USD/BTC quote, exact decimal conversion yields 188894564026036.121060882886060 USD versus the numeric JSON alias 188894564026036.12 (difference -0.001060882886060 USD); both render to the same two-decimal UI amount in this sample. POWB’s 630501483 proofs at the same quote yields exact 529684.29586830 USD and the API alias agrees. This continues the older documented display-only IEEE-754 USD alias limitation; it did not affect protocol arithmetic or current two-decimal display. Consumers needing exact fiat precision should use decimal strings, not numeric aliases.

No on-chain rule, balance, fee, issuance, WORK, bond, or ledger math discrepancy was found in the checked snapshot. Growth projections remain labeled as scenarios, not confirmed chain value. The user-specific Wallet balance could not be certified without a connected wallet; no wallet connection or signing action was performed.

### Previously reported issues rechecked

| Prior issue family | Status in this audit |
|---|---|
| H24-01 / H24-OA-01 exact-read availability and observation monitor | **Still open; materially active.** Several cold UI reads failed during a four-block convergence. Monitor severity rose to 2, then 1; the systemd observation unit remains failed. Later direct reads and the final chain-aligned health/consistency checks recovered. |
| H24-02 internal ID verifier | **Not closed.** Public registry reads failed closed during catch-up and later succeeded; the privileged full verifier was not rerun. |
| H24-03 backup/query-health overlap | **Not retested during a dump.** The latest single logical backup remains checksummed/catalog-readable per Audit 25; no isolated restore is proven. |
| H24-04 / H24-05 release retention | **Still open.** Node release tree remains above threshold and the exact old UI/node archives remain. Current disk headroom is healthy. |
| H24-06 INCB replay directories | **Still open.** Both directories remain at 63.14 GB combined; purpose and replacement-evidence sufficiency remain owner decisions. |
| H24-07 stale failed units | **Still open.** UI has one stale failed Boost publish unit; node reports 16 failed units, largely historical attempts plus current API-observation and storage-trend monitor failures. None was reset. |
| H24-08 parity residues | **Still open and unchanged.** Four scan markers and one ticker reference remain missing. |
| H24-OA-02 Computer disconnected registry state | **Reproduced.** The final Computer page still reports unavailable registry data while live health/consistency are green. |
| H24-OA-03 large token response | **Still open.** Current measured body is 80,108,083 bytes, well above the 8 MiB monitor budget; one ordered fetch took 17.81 seconds. |
| H24-OA-04 exact-tip supplemental reads | **Reproduced, then recovered.** Home/ID/AMO and an early Inception call failed during the block advance; retry after catch-up returned 200. |
| H24-OA-05 disconnected Wallet loading label | **Reproduced.** The disconnected page shows zero spendable proofs while the value is still labeled Loading. |
| H20-03 duplicate Desktop artifact | **Not reproduced in the current public Carbonz sample.** The page reports one file with the expected SHA-256; earlier duplicated-render evidence remains in the history, so this is a scoped production recheck rather than a global closure. |
| H20-01 container log growth | **Resolved in this sample.** All three Mempool containers are healthy and use 25 MiB × 4 JSON-log rotation; active files are small. |
| H6-15 Log count scope | **Known scope distinction persists.** One supplemental row is outside confirmed+pending counters; consistency reports no missing canonical log events. |
| H20-04 Log status badge; H19-02/H19-03 provider failure and reorg cases | **Not specifically fault-injected or record-reproduced here.** Keep their previously recorded status; this pass does not close them. |

### New findings, recommendations, and storage review

No new unique data-corruption or math defect was assigned. The materially changed condition is the severity-2 API availability sample during the ordered read sweep, recorded under the existing H24-01/H24-OA-01 family. Confirmed data recovered to a single full-node-aligned snapshot; the public pages’ fail-closed/loading states and the monitor failures are availability and presentation issues.

Prioritized follow-up:

1. Reduce default token/history and marketplace/canonical-summary response cost. Add bounded summaries and cursor pagination while retaining an explicitly accessible complete evidence path; measure complete-read and aborted-client behavior.
2. Pin public summary and internal audit work to one checkpoint, and add controlled retry/backoff or an explicitly stale last-good view for non-signing displays. Preserve fail-closed transaction admission and label stale data.
3. Repair the five known derived-index residues only through an approved targeted canonical repair, then run full indexer:parity in a quiet window and rerun the privileged ID/event audits.
4. Prototype compression/deduplication or checkpointing for work_amo_block_transitions against an isolated verified restore. Keep immutable live transition evidence unchanged until replay, values, and all historical checkpoints compare exactly.
5. Decide the exact one-release/one-rollback retention set for UI and node. Existing dry-run candidates include two 2026-09-23 node archives and the older 2026-09-23 UI release; verify the surviving release and rollback first. Review the 5.78 GB operator archive separately.
6. Classify the node /tmp and /var/tmp, UI /var/tmp, and 63.14 GB replay roots by manifest, active process references, and owner before considering deletion. Do not infer disposability from age or directory name.
7. Continue alerting on public 5xx, latency, and large payloads, but separate expected maintenance/replay queries from customer-facing response failure and add visibility for aborted clients. The current API observation timer’s own failure state must remain visible until its thresholds and response-size causes are addressed.
8. Add an amcheck-based physical/index scan only after separately approved setup, and validate the latest logical dump through a controlled isolated restore.
9. Correct the disconnected Wallet and Computer loading/registry messages. Recheck a known valid HTML transaction and complete AMO listing/purchase pagination once reads are stable.

Storage items remain review-only: the 2026-09-23 UI release archive (185,446,159 bytes); the two node 2026-09-23 archives selected by the existing retention dry run; the 5.78 GB operator-review archive; 63.14 GB of INCB replay roots; node /tmp 4.93 GB and /var/tmp 541.9 MB; and UI /var/tmp 762 MB plus its 3.71 GB recovery/release tree. The latest logical dump directory contains only the current verified set. This audit found no path that should be deleted solely because it is old; all named paths remain in place.

### Actions, approval boundary, and scope limits

- No production data, protocol record, ledger, configuration, service, backup, log, cache, or infrastructure was changed. No service was restarted, no unit was reset, and no file was deleted or cleaned up.
- Read-only production API and browser access naturally generated ordinary access logs. The only local workspace action authorized here is this append to Audit 25; pre-existing repository status included modified repository-hygiene.json and untracked Audit 24/25 files, and this audit did not alter those config/status items.
- No cleanup candidate is approved for deletion. Retention changes, parity repair, application/API changes, amcheck installation, restore validation, and any authenticated or fault-injection testing require separate approval.
- Coverage is bounded by the checks stated above. Full indexer:parity, audit:computer-events, privileged ID verification, PostgreSQL page-level verification, a valid HTML transaction render, complete AMO-book pagination, connected-wallet accounting, and provider outage/reorg injection were not certified by this pass.


## THIRD AUDIT — Computer performance, data efficiency, usability, accessibility, and maintainability

**Audit date:** 2026-09-26 (production checks through 16:50 UTC)<br>
**Scope:** Read-only review of the ProofOfWork application and Computer shell. This section follows the ordered page review, system requirements, and prior-audit recheck.<br>
**Source commit:** `2f0b32356677f8ba7187f26f34611d0295947820` (`Record final audit deployment receipt`, 2026-09-25).<br>
**Prior issue sources:** 2026-09-03 UI/UX audit; Audit 24; the ordered 2026-09-26 application audit in this file (Audit 25).<br>
**Approval boundary:** The user approved appending this completed audit only. No app/source/configuration, production data, chain record, database, log, backup, service, or infrastructure was changed. No cleanup, restart, deployment, or signing occurred.

### Scope, measurement setup, and limits

Required documents were read in the specified order: `SOUL.md`, `README.md`, `PROOFOFWORK_IDS.md`, `MARKETPLACE.md`, `OP_RETURN_INFRASTRUCTURE.md`, `MAIL_ORGANIZATION.md`. `REPOSITORY_HYGIENE.md`, current repository instructions, source, package scripts, route/build setup, browser tests, and prior audit entries were then reviewed. The audit preserved pre-existing worktree changes: modified `repository-hygiene.json` and untracked Audit 24/Audit 25 files.

The source tree maps standalone surfaces through `src/main.tsx` / the route registry. Landing and Boost have separate lazy roots; ID launch, Desktop, Browser, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, Growth, and Computer all fall through to the shared lazy `App`. Computer was reviewed last. Its shell shares header/status/navigation and workspace code for Inbox/Incoming/Sent/Outbox/Drafts/Favorites/Archive/custom mail folders, Files, Desktop, Browser, Boost, IDs, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, and Contacts. `src/App.tsx` contains the workspace branches and cross-surface data readers; `src/styles.css` is shared globally.

A current-source production Vite build succeeded in `/tmp/pow-audit-computer`; the ID-only build also succeeded in `/tmp/pow-audit-id`. The build reports `App` 769.51 KB raw/186.39 KB gzip, `proofofwork` crypto 198.35/60.40 KB gzip, React 151.13/49.74 KB gzip, API client 19.34/6.19 KB gzip, ID registry 2.29/1.02 KB gzip, entry 5.23/2.20 KB gzip, runtime 0.69/0.42 KB gzip, and global CSS 146.22/24.03 KB gzip. Vite warned that the App chunk exceeds 500 KB. The ID-only build retained the same App, React, crypto, and CSS chunks. These local production-build figures do not establish that the deployed artifact corresponds to this commit; deployed release identity was unavailable.

Production runtime checks used Playwright Chromium `149.0.7827.55` on Linux, host CPU Intel i5-10210U 1.60 GHz / 8 logical CPUs. The initial ordered route sweep used 1440×900, an anonymous disconnected-wallet browser context per route, fresh browser context/cache per route, no CPU/network throttling, `domcontentloaded`, up to 22 seconds waiting for network idle, then 1.2 seconds of settling. High-shift routes were repeated on desktop and emulated mobile (390×844, DPR 2, 4× CPU, 150 ms RTT, 4 Mbps down/1 Mbps up), with cold browser cache and a warm reload in the same context. Repeat capture used Chromium CDP request IDs and encoded transfer lengths, waited eight seconds after DOM readiness, and observed LCP, CLS, aggregate long-task duration, DOM count, and a coarse JS heap sample. A timed-out, aborted, or unfinished request was recorded as status 0 in the eight-second snapshot; that is not an HTTP 5xx. No 5xx was observed in the complete production route sweep.

The initial and repeat measurements are lab diagnostics. No field Web Vitals/RUM measurement was found; the source tree has no `web-vitals` instrumentation. INP, actual input-to-paint latency, and physical-device performance were not measured. Heap figures are point samples, not a leak or workspace-cycle test. Connected wallet, private user mail/files, and signing flows were not exercised. The current full-node tip was not refreshed for this UI-focused audit: Audit 25’s direct Core/Electrs/indexer/PostgreSQL comparison (height 968708, hash `000000000000000000015c211b9bc6304ebdcb8baf28bf8fb10a10bc21f55a48`) remains the authoritative chain snapshot referenced here. This section does not claim a new full-node reconciliation.

### Ordered production route sweep

All requested surfaces rendered without an uncaught page exception. Initial LCP/CLS are single desktop lab observations; data-readiness timing is shown separately from shell LCP. Requests and API timing are observations from this run; where endpoints continued paging, the view was explicitly partial or preview.

| Order / surface | Production observation |
|---|---|
| 1. Home (`proofofwork.me` → `www`) | Redirected to `www`; 507 confirmed and 20 pending records visible. Summary read about 3.06 s; fresh read about 6.44 s. LCP 2.076 s, CLS 0.011. 32 request URL keys, 15 first-party and 17 external; YouTube/Google resources were contacted on first visit despite lazy iframe markup. |
| 2. ID management | HTTP 200; registry read about 4.12 s. LCP 2.916 s, CLS 0.016. |
| 3. Desktop | HTTP 200; no API request before search. LCP 1.988 s, CLS 0.001. |
| 4. Browser | HTTP 200; empty form made no API request. A subsequent read-only check with known txid `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b` returned HTTP 200 and rendered “Confirmed”, “Mainnet”, “Message body”, 1,018 bytes, and SHA-256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`. The preview identified itself as sandboxed; this was not a fresh full-node check of that tx. |
| 5. Boost | HTTP 200; feed and referenced transaction loaded (about 3.89 s and 4.20 s in the first sweep). LCP 4.156 s, CLS 0.280, 803 DOM elements. |
| 6. AMO | About 12 initial API operations. Summary arrived at about 10.14 s; history pages continued at about 15.56, 20.37, and 22.42 s. UI correctly called listing rows a verified preview while the full result was not ready. LCP 1.824 s, CLS 0.009, 3,360 DOM elements. No 5xx. |
| 7. Credit | Compact `token-summary?compact=1&projection=directory-v1` returned 200 at about 4.52 s. LCP 2.080 s, CLS 0.024. |
| 8. Wallet | Anonymous/disconnected. Full `/api/v1/token?network=livenet` still requested and took about 8.71 s; public row rendered and Connect UniSat remained visible. LCP 1.800 s, CLS 0. The previous Audit 25 full response measurement was 80,108,083 bytes; this audit did not fetch that full response again. |
| 9. WORK | Summary about 3.62 s, work-floor read about 6.36 s. LCP 1.968 s, CLS 0.747; 21 million minted shown. |
| 10. Infinity Bonds | Summary about 4.30 s; four 200-row listing-history reads reached about 23.34 s, with another read still unfinished at capture. LCP 4.376 s, CLS 0.314. |
| 11. Inception Bonds | Summary about 4.56 s; four history reads reached about 24.44 s, with another still unfinished. LCP 2.084 s, CLS 0.438. |
| 12. Log | Summary about 2.92 s; 50-row history about 9.86 s; 26,072 actions shown. LCP 1.812 s, CLS 0.703. |
| 13. Growth | Summary about 3.15 s. A fresh summary read remained pending/was aborted at capture, not an HTTP failure. LCP 3.228 s, CLS 0.090. |
| 14. Computer (last) | HTTP 200, disconnected, zero API reads in the observation window. LCP 1.780 s, CLS effectively zero, 502 DOM elements. Shell still displayed “verifying canonical data” while registry/navigation state was unavailable. |

Repeat samples confirmed late layout movement. Cold desktop Boost repeated at CLS 0.280 and warm at 0.281; warm desktop Work 0.747; desktop Infinity 0.314; Inception 0.438; Log 0.645 cold/0.671 warm. Emulated mobile cold/warm CLS was Boost 0.032/0.036, Work 0.872/0.872, Infinity 0.569/0.569, Inception 0.569/0.569, and Log 0.013/0.013. Desktop cold/warm LCP (ms) on those selected pages was Boost 4468/2372, Work 2464/336, Infinity 4304/452, Inception 2456/412, and Log 2188/292. Emulated mobile cold/warm LCP was Boost 5112/528, Work 2524/976, Infinity 3484/1344, Inception 4076/956, Log 3348/724, and Computer 2836/656. Warm LCP is a reload lab result; it must not be confused with field p75.

On cold desktop Computer, the CDP trace counted 14 first-party requests and about 476 KB encoded transfer: about 355 KB JavaScript, 32.6 KB CSS, 87 KB fonts, and 1.3 KB other, with no API read while disconnected. Mobile emulation counted 13 requests and about 461 KB. Cold selected App pages generally downloaded about 355 KB JavaScript; Boost’s separate root downloaded about 159 KB. The local gzip build report and runtime CDN transfer are different measurements. No report is made from the first sweep’s discarded byte aggregation, whose event attribution was not valid.

### Ranked findings and decision details

#### P1 — Disconnected Wallet still selects the full token response (H24-OA-03 recheck)

**Evidence/root cause:** `src/App.tsx` uses `walletScoped` (route/folder state) to choose `summary = !walletScoped` in token refresh. The wallet page is considered wallet-scoped even with no address, so it reads `/api/v1/token` instead of the existing compact directory projection. This reproduced as an 8.71 s read while disconnected; Audit 25 recorded an 80,108,083-byte full response. The Credit surface demonstrates the available compact `directory-v1` projection. This materially refines the existing H24-OA-03 item rather than creating a duplicate issue.

**Impact:** a user who has not connected an account incurs a large read, slow readiness, avoidable server/transfer work, and exposure to the known response-size failure mode. **Proposed correction:** choose the public summary when there is no usable account address; load address-specific projections only when connected and needed. Preserve network/query/snapshot dimensions, freshness, confirmed/pending distinction, and fresh signing preflight. Never show an unavailable spendable value as zero. **Expected benefit:** avoid the full token response on disconnected visits. **Confidence:** high. **Effort:** medium. **Risk:** public directory fields could be confused with account balances unless readiness and permission states stay separate. **Validation:** Playwright proves disconnected Wallet does not request `/api/v1/token`, verifies compact directory response and provenance, checks unavailable-versus-zero rendering, then separately verifies connected balance reconciliation and existing signing preflight without exporting keys. **Rollback:** revert only the UI reader selection and status copy.

#### P1 — Data arrival produces severe CLS on data-backed surfaces

**Evidence/root cause:** repeat results exceed the user’s CLS 0.1 target on Boost, Work, Infinity, Inception, and Log. On Boost, `boost-rail-panel` sections grew from about 78–94 px to 257–294 px and moved subsequent content; Work/market/log surfaces also rearranged when live data replaced initial geometry. The effect persists on warm visits, so it is not solely network delay. References: route-specific render branches in `src/App.tsx`; shared styles in `src/styles.css`.

**Impact:** content and controls move after the user starts reading or interacting. **Proposed correction:** size the known summary/rail/card slots for their loaded state and use dimension-matched, accessible loading placeholders. Keep stale/unavailable/partial states explicit. Do not suppress canonical checks or imply full history before all required pages arrive. **Expected benefit:** CLS at or below 0.1 with less lost visual position. **Confidence:** high. **Effort:** medium. **Risk:** reserved dimensions can produce blank space or breakpoint regressions. **Validation:** cold and warm production-build traces with loaded representative large data at desktop/mobile widths; visual review at 200% zoom, keyboard focus, and reduced motion; retain skeleton accessibility. **Rollback:** revert only the targeted component/style changes.

#### P1/P2 — Bond and AMO screens eagerly fetch full history before it is needed

**Evidence/root cause:** `src/App.tsx` summary refresh paths call complete listing hydration; the complete reader walks 200-row cursors. Infinity and Inception continued paging beyond 23 seconds. AMO made about 12 initial API operations and its full listing/activity pages arrived materially after its summary. Existing source does preserve cursors, checkpoints, and explicit verified-preview state, which must remain. Activity rows and three one-row per-category total reads are separately visible around `src/App.tsx` 48895–49039.

**Impact:** slow useful-data readiness, larger API work, and more mobile main-thread work as history grows. **Proposed correction:** return a snapshot-qualified summary and first visible page, then cursor-page additional records on user navigation or scroll; retain an explicit route to the complete history/evidence and exact aggregate totals. Explore a single API response for activity plus category totals only if it preserves the same checkpoint/provenance. **Expected benefit:** earlier useful verified data and bounded initial work without hiding records. **Confidence:** high on full-history delay, medium on consolidating API endpoints. **Effort:** large. **Risk:** pagination or total merging could omit a record or mix snapshots. **Validation:** compare every cursor page and total against a full canonical read at a pinned height/hash, then test reorg refresh and sale-ticket reservations. **Rollback:** restore the current read orchestration; no stored data changes are needed.

#### P2 — Shared App code and global assets are still paid by most routes (prior monolith issue rechecked)

**Evidence/root cause:** `src/main.tsx` imports shared fonts/global CSS before route rendering and sends all App routes to `App`; only Landing and Boost have standalone roots. `vite.config.ts` splits React and crypto into chunks but not App workspaces. `VITE_ID_LAUNCH_ONLY=1` did not reduce the App chunk. The current `src/App.tsx` is about 55,807 lines; `src/styles.css` about 9,120. This rechecks the 2026-09-03 maintainability finding with current deployed transfer and build evidence.

**Impact:** Computer starts with code for unrelated workspaces and crypto-related modules even when disconnected; the shared shell is harder to maintain and regress. **Proposed correction:** measure a small workspace split, then lazy-load workspace code and defer only dependencies verified to be signing-only. Keep read verification available where needed; signing remains local. Reduce global font/asset weights only after screenshots and contrast/typography review. **Expected benefit:** less initial JavaScript and clearer change boundaries. **Confidence:** high on shared-route delivery, medium on deferrable dependency boundaries. **Effort:** large. **Risk:** route cache, dependency-order, protocol verification, wallet authority, or UI regressions. **Validation:** production bundle graph and same-condition cold/warm route measurements plus all existing exact math, containment, browser, and signing-preflight tests. **Rollback:** return to prior root imports and chunk configuration.

#### P2 — Home contacts video/ad third parties before the user chooses video

**Evidence/root cause:** first Home visit produced 17 external URL keys among 32 observed; YouTube/Google endpoints were contacted on initial load while the iframe used lazy markup. **Impact:** unnecessary third-party transfer/contact and less predictable Home loading. **Proposed correction:** replace initial iframe with a keyboard-accessible click-to-load facade. **Expected benefit:** defer all video-origin requests until intent. **Confidence:** high for observed requests, medium on which resources are video-only versus other site integrations. **Effort:** small. **Risk:** users may not discover or operate video without a clear label and focus state. **Validation:** assert zero media-origin requests before activation, then test keyboard, focus, reduced-motion, and screen-reader labels. **Rollback:** restore the iframe.

#### P3 — Log has repeated same-query request observations; deduplication is unconfirmed

**Evidence/root cause:** warm Log traces included two calls each for `log-summary?network=livenet` and `log-history?limit=50&page=0&network=livenet`; one full history response accounted for the transfer and another response transferred no body bytes. This indicates repeated requests but does not prove duplicate ledger records or duplicate parsing. Request initiators were not traced to a specific component. Related source paths include activity page loading in `src/App.tsx`.

**Impact:** avoidable request/callback overhead if calls are redundant. **Proposed correction:** inspect initiators and reconcile with lifecycle/refresh behavior; deduplicate only identical network, query, page/cursor, and canonical-snapshot reads. **Expected benefit:** fewer requests and less repeated parsing if confirmed redundant. **Confidence:** medium. **Effort:** small/medium. **Risk:** accidental reuse across snapshots or failure to refresh after reorg. **Validation:** one logical response per identical in-flight key and tests for caller abort, refresh, network change, and snapshot change. **Rollback:** remove the deduplication wrapper without changing API records.

### Data and math verification

No new protocol-math defect was found. Passed on current source: `check:work-amo-v8` (declared hash `0ef143...68024d`, Q16 scale and exact V8 gates), `check:work-precision-v2`, `check:bond-exact-arithmetic`, `check:canonical-order`, `check:api-truth`, `check:live-data`, `check:client-read-containment` (43 checks; log-cache keys include query/kind/page/cursor/snapshot), `check:api-client-timeouts` (10/10 cancellation/deadline/error tests), `check:production-observability` (health URL `https://computer.proofofwork.me/health?network=livenet`, zero alerts at 16:50 UTC), `check:hardening`, and backup-capacity safeguards. `check:ui` passed and `CI=1 POW_PLAYWRIGHT_CHANNEL=chromium npm run check:ui:browser` passed 83/83 in 7.7 minutes. The UI suite includes responsive widths, 512-row AMO fixture, focus, target-size, contrast, reduced-motion and 200%-zoom contracts. Its four-surface structural accessibility smoke and fixture-driven interaction checks are not full manual WCAG or production p75 evidence.

Audit 25’s latest direct full-node comparison remains the canonical data authority for this audit. This performance run did not re-fetch a current full-node tip or rerun `indexer:parity`. The known Audit 25 derived-index residues (four confirmed transaction rows missing `canonicalBlockScan` markers and one invalid PWT1 missing expected `ticker=INCB` reference) therefore remain prior unresolved items; no correction was attempted. Browser UI’s confirmed status is consistent with the previously verified fixture, not an independent full-node conclusion in this pass. Confirmed history remains canonical; pending is best-effort. No cache recommendation permits extending freshness, omitting history, changing fees/Q16 math, skipping reorg checks, or weakening sale-ticket reservation/preflight.

### Rechecked prior issues, storage, and access gaps

- **H24-01 / H24-OA-01:** this pass’s production observability call was green with zero alerts at 16:50 UTC. It does not establish a stable latency/error trend or clear the prior exact-read monitoring failure permanently.
- **H24-OA-02:** Computer still shows disconnected canonical verification text while registry/navigation status is unavailable. This remains open; availability must not be inferred from green health alone.
- **H24-OA-03:** remains open; disconnected Wallet still requests full token data. Root-cause refinement is above.
- **H24-OA-05:** connected-account spendable reconciliation was not available in a safe anonymous pass. Do not close the prior zero/loading issue based on disconnected UI. No wallet was connected.
- **Sept 3 monolithic App/style concern:** still present; now quantified through current build, deployment sample, and source line growth.
- **Prior parity residues and large database/storage concerns:** not remediated or retested for this UI performance audit. Audit 25’s recorded DB size (35,023,191,063 bytes; `work_amo_block_transitions` 33,711,276,032 bytes), UI free capacity, backup directories, and retention candidates remain the previous dated system audit baseline, not this audit’s VPS measurement.

The Vite build copied 11,724,005 bytes of `public/` content into each output. `public/proofofwork-logo.png` and `public/favicon.png` have the same SHA-256 (`f1ff14f2edd990400fd7cdce04e8644e05a7f94ada887bdec383952ae5065ed6`); source reference search found neither used by app code, while `index.html` references favicon.svg/social-logo/apple-touch assets. `public/proofofwork-general-deck.mp4` (7,968,826 bytes), its deck counterpart, and duplicate image may still be intentional direct-URL/release assets. Prior production release packaging copied public assets across surface builds (Audit 25 archive about 185.79 MB). These are review candidates, not approved deletions. Two current build outputs occupy about 28 MB under `/tmp`; the compact repeat report is also under `/tmp`. They were left in place under the no-cleanup instruction. No new VPS disk, DB, or backup usage was sampled during this Computer-focused audit.

### Accessibility, usability, browser support, and design constraints

Automated suite evidence is positive but bounded to Chromium and the test fixtures stated above. Manual screen-reader/voice control, iOS Safari, Android Chrome on device, Firefox/WebKit, touch hit testing on physical screens, and full content preview of private user files/mail were unavailable. Existing 44×44 target, visible focus, reduced-motion, 200% reflow, and responsive width checks passed. No source evidence supports adding a virtualization library now; large API response and pagination bounds should be solved at the read/data boundary first, then profile DOM/render costs with representative full evidence. Keep the obsidian/parchment/brass/olive palette and Proof Instrument hierarchy, preserve copyable exact Q16/balance/address/txid values, and report data readiness separately from account permission/readiness.

Recommendations align to dated primary guidance: [WCAG 2.2 Recommendation (W3C, 12 Dec 2024)](https://www.w3.org/TR/2024/REC-WCAG22-20241212/); [web.dev field/lab Web Vitals measurement](https://web.dev/articles/vitals-measurement-getting-started) and [Web Vitals tool workflows](https://web.dev/articles/vitals-tools); official [React `lazy`](https://react.dev/reference/react/lazy) and [Suspense](https://react.dev/reference/react/Suspense) route splitting; and [MDN `content-visibility`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility) as an optional, progressive enhancement only after screen-reader and browser checks. WCAG 2.2 AA and field LCP ≤2.5 s / INP ≤200 ms / CLS ≤0.1 targets are acceptance goals, not a claim this lab pass established conformance or p75.

### Ranked plan and route-specific budgets proposed for approval

**Quick wins:** disconnect-ready status wording; prevent full token reads without an account address; reserve high-shift component dimensions; click-to-load Home video. **Targeted refactors:** cursor-page full histories and align summary/activity totals to one pinned snapshot; audit repeated request initiators; add route-specific bundle/readiness regression metrics. **Larger optional work:** split Computer workspaces and verify safe deferred imports; consider data virtualization only if measured render cost remains material after pagination. No framework upgrade or new dependency is proposed without measured benefit.

Proposed initial budgets are guardrails to ratify after a same-release baseline, not current measured compliance:

| Route tier | Cold transfer budget (JS/CSS/fonts, before API) | Startup request budget | Useful-data / interaction target | Idle/memory budget |
|---|---:|---:|---|---|
| Home, Desktop, Browser | ≤300 KiB first-party static; no third-party media before intent | ≤15 static + ≤4 API; no repeated identical in-flight query | shell LCP lab ≤2.5 s mobile and desktop; verified initial result target ≤4 s p75 when source/API is available; local input response ≤100 ms target | zero requests for inactive/hidden page; no more than documented freshness cadence while visible |
| Boost, Credit, Growth, Log | ≤350 KiB first-party static; data bounded to the visible page | ≤18 static + ≤6 API initial | LCP/CLS targets above; ≤200 ms p75 field INP; lab 512-row search/sort feedback ≤100 ms, final bounded page ≤500 ms | no hidden-tab polling; after 20 workspace switches, heap ≤1.25× settled baseline and ≤25 MiB growth |
| AMO, Wallet, WORK, Infinity, Inception, Computer | ≤360 KiB shared shell/static before data; route-specific modules loaded on demand | ≤18 static + ≤6 summary/visible-page API reads; further history is cursor-on-demand | summary/readiness ≤4 s target when service responds; first verified page ≤6 s; CLS ≤0.1; transaction preflight remains fresh regardless of display cache | no hidden/inactive-workspace requests; settled heap ≤1.25× baseline and ≤25 MiB growth after 20 switches |

For all tiers, preserve canonical snapshot height/hash, network/wallet/query cache boundaries, exact balances and Q16 values, confirmed versus pending labels, and unavailable states. Budgets do not authorize partial history to be presented as complete or stale data to be treated as current. Compare all budgets on the exact same production build, device emulation, cache state, viewport, and dataset; review thresholds after two stable baselines.

### Highest-value first batch ready for separate approval

Files: `src/App.tsx`, `src/styles.css`, `tests/browser/responsive-layout.spec.mjs`.

1. Make disconnected Wallet use compact directory reads and show distinct states for verified display data, unavailable data, wallet connection, and transaction permission. Never imply zero while account data is unavailable.
2. Reserve the measured Boost/WORK/Bond/Log panel geometry with responsive loading states that preserve reduced motion and screen-reader semantics.
3. Add repeatable production-build browser checks for anonymous Wallet requests, readiness copy, and CLS at 1440×900 and 390×844 with representative large fixtures.

Acceptance: no disconnected Wallet request to `/api/v1/token`; snapshot/network provenance is explicit; connected balance and signing preflight remain exact; no hidden data omission; affected surfaces CLS ≤0.1 across cold/warm lab samples; all 83 existing browser checks and exact math/truth/containment checks pass. Rollback is limited to reverting these file-level changes; no production data migration should be needed.

### Actions and approval-required work

Completed actions: read-only ordered production route sweep, public Browser fixture render, production Vite builds in `/tmp`, repeat desktop/mobile-emulated measurements, source/package/test/audit review, and the listed source-contract/browser checks. The only persistent workspace action authorized is this audit append. Routine public GETs generated ordinary production access logs. No production test injection, connected-wallet access, node/database operation, private data read, source/config edit, deployment, service restart, log/backup cleanup, or storage deletion occurred.

Separate explicit approval is required before implementing any code/API/build changes, logging/RUM collection, dependency changes, cache/pagination changes, or cleanup. The first-batch proposal above is ready for review; no fix or cleanup was applied.
