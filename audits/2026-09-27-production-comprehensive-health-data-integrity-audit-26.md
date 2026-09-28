# Production Comprehensive Health and Data Integrity Audit 26

- **Audit date:** 2026-09-27 America/Toronto (EDT); checks continued through 2026-09-28 02:22 UTC.
- **Audit window:** approximately 2026-09-27 21:50–22:22 EDT / 2026-09-28 01:50–02:22 UTC.
- **Scope:** public Computer application and APIs; UI VPS; node/API VPS; Bitcoin Core, Electrs, indexer worker, PostgreSQL, event and transaction indexes, mempool indicators, browser rendering, logs/observability, storage, backups, caches, temporary files, protocol arithmetic, and application/API math.
- **Method:** read previous audit and repair records first; run read-only production HTTP and browser checks; run local deterministic contract/regression checks. No production configuration, chain record, ledger, evidence, wallet, or application data was changed.
- **Access limitation:** direct SSH authentication failed for both VPSes (`Permission denied (publickey,password)` for the UI VPS and `Permission denied (publickey)` for the node/API VPS). Production API health was reachable, but direct host commands, PostgreSQL queries, and log-file/service-manager inspection were unavailable. Capacity and host-service findings below distinguish live API telemetry from the last direct host sample.

## Executive result

The public API reports a synchronized, zero-lag index at the current Core/Electrs checkpoint. The public 25-check consistency endpoint is green, the summary readiness gate passes, all 14 public application routes load without browser/API errors, and the tested exact-arithmetic, marketplace, mint, event, and protocol gates pass. No confirmed-chain mismatch or math discrepancy was found in those observable checks.

The main new risk is node `/data` capacity. API node telemetry reported 476.8 GB free (27.0% free), down 101.7 GB from the latest recorded direct VPS sample about 26 hours earlier. A simple linear extrapolation reaches the API health route’s 90% used threshold in roughly three days. This is a short-window estimate, not a proven steady rate or a diagnosis; the full directory breakdown and cause could not be checked over SSH. Treat it as an urgent host-side investigation.

The UI VPS’s current disk, memory, CPU, backups, and logs could not be directly rechecked. Its last recorded direct sample showed 30.2 GB free and 22% used before the latest UI release. Production rendering remains error-free, but several data surfaces were still in a verifying/loading state at the 8.5-second observation point. Marketplace and WORK summary calls varied materially in latency, including one fresh marketplace summary at 24.9 seconds.

## Systems and service health

| Area | Result |
| --- | --- |
| Bitcoin Core / node | Public health reported main chain, height and headers 968920, `initialBlockDownload=false`, unpruned, verification progress 1.0, txindex synced, and no warning. Best block: `0000000000000000000176553a8f6bf24f1937ad7451e7cfe33208360227e271`. Direct Core RPC/service-manager checks were unavailable. |
| Electrs | Public health reported `atTip=true` at the same block hash and height. |
| Indexer/API | Ready and available; zero index lag; canonical checkpoint matched Core/Electrs. Worker reported `ok=true`, `proofReady=true`, zero consecutive failures. Canonical rebuild was complete and inactive. |
| PostgreSQL | API health reported database and canonical metadata healthy. Current database size, relations, free space, autovacuum, index validity, and page-level integrity could not be queried directly. The last direct measurement remains 35,267,116,055 bytes, with `work_amo_block_transitions` about 33.9 GB (roughly 96% of that database). |
| API summary readiness | `npm run check:summary-route-readiness` passed at 2026-09-28 02:15:14 UTC: WORK and Marketplace routes HTTP 200, both at the same snapshot and exact block 968920, zero lag, and no invariant, stale-readiness, or latency-threshold findings in that probe. |
| Logs and system services | API health showed zero indexer-worker failures and no health warning. Current host journal, systemd unit/timer states, API logs, PostgreSQL logs, and full-node logs were not accessible. The last recorded API-observation-health unit result was failed (`ExecMainStatus=1`); its current state remains unverified. |

The last direct PostgreSQL audit found zero invalid/unready indexes and zero unvalidated constraints. Production PostgreSQL page checksums were disabled, and no physical checksum scan of the live cluster had been completed. A separate isolated restore had passed checksum verification over 4,197,200 blocks with zero bad checksums; this validates that isolated restored cluster only, not the live database.

## Capacity, database growth, and storage

### Node/API VPS

- Public node telemetry reported `/data` total 1,764,768,071,680 bytes, available 476,794,912,768 bytes, and 72.98% used. The node root filesystem reported 105,089,261,568 bytes total, 75,129,221,120 bytes available, and 28.51% used.
- The latest prior direct host sample, 2026-09-27 around 00:34 UTC, reported `/data` available 578,521,513,984 bytes and 68% used. The latest API reading is approximately 101.7 GB lower after about 26 hours, roughly 96 GB/day if treated as a straight-line change.
- At that rate, free space would approach the API health route’s 90%-used threshold in about three days. A continuation to a full volume would take longer, but neither projection is reliable until the exact consumers and growth trend are measured. Remaining space is not yet at the health route’s 5 GB reserve threshold.
- This is the first new finding: **AUD26-01, high priority — unexplained rapid `/data` capacity decline.** The likely impact is loss of node/indexer/database availability if growth continues. The source is not established. Immediately compare `df` and per-directory allocated bytes, check deleted-open files, backups, replay/restore workspaces, Core/indexer growth, and storage-monitor history. Do not delete replay, recovery, rollback, or evidence material based only on age.
- Last direct database size was 35.27 GB; `work_amo_block_transitions` was about 33.9 GB. This concentrated table and database growth concern were already reported and remain open. Current sizes/runway could not be confirmed.

### UI VPS

- No current direct disk, inode, RAM, swap, CPU/load, process, or log sample was available.
- The latest prior direct host sample on 2026-09-27 around 00:40 UTC reported a 39,973,924,864-byte root filesystem, 8,088,932,352 bytes used, and 30,200,799,232 bytes available (22% used, 3% inode use, 3,364,855,808 bytes available memory, no swap). That was before the current `b752518bf8b4-20260927T014804Z` UI release and is not a current capacity check.
- PostgreSQL was last verified to reside on the node/API VPS, not the UI VPS. Earlier UI disk pressure was mitigated by retaining the active release plus one independently verified rollback. The last record identifies UI `b752518bf8b4` as active and `c64963f4649f` as its retained rollback; current host archive inventory and provenance could not be rechecked.

### Backups, archives, temporary files, and caches

- No current filesystem inventory was possible. No backup, release archive, replay directory, cache, temporary file, or evidence file was removed.
- The latest available repair record reports a production PostgreSQL backup created 2026-09-27 08:33:05 UTC before a scoped repair, with checksum/catalog checks. A previous isolated logical-backup restore passed its restore and checksum checks. The scheduled backup’s current status and whether a newer verified backup exists were not available.
- The prior approved storage review identified two large INCB replay/evidence roots (about 63.1 GB combined); the 2026-09-25 replay root had an active PostgreSQL process. These are not ordinary duplicate backups and must remain preserved until a host-side evidence and process check proves otherwise.
- The latest retained record identified two one-time UI helper files in `/tmp`: `/tmp/pow-audit26-stream-ui-bundle-c64963.py` and `/tmp/pow-audit26-ui-cutover-c64963.py`. Their prior use check said they were inactive, but removal was not completed because SSH authentication failed. Their current presence and references must be rechecked before removal.
- The installed node release helper last had a three-archive retention policy. A prior attempt to reduce the target to two was rejected by automatic approval review because it expanded the reviewed path set; no additional node archive was removed. Current archive inventory remains unverified. Reconcile it against the current release and one verified rollback before proposing exact cleanup paths.
- Historical checksums, replay receipts, immutable witness manifests, failed-attempt evidence, and repair records are evidence, not generic stale data. Keep these separate from removable duplicate release bundles. User preference for one current backup and one verified rollback is noted; any production deletion still requires exact current inventory and approval under repository operating rules.

## Data integrity, event tracking, and mempool status

- The current public consistency endpoint returned HTTP 200 with 25 green checks, `missingLogEvents=[]`, ready/coherent provenance, exact snapshot `6b1786d40f1b80e3e70debbc`, and zero lag at block 968920. The current summary covered all eight required keys through that same block.
- The observable activity counts were 26,117 activity items, 26,116 canonical/public-log rows, and one supplemental item. This one-item difference is a previously documented expected scope difference, not a new discrepancy. Confirmed items were 26,095.
- The endpoint reported 507 confirmed IDs; 238 confirmed token definitions; 21,876 confirmed token mints; 87 sales; and 263 transfers. The known INCB target repair remains reflected as 47 confirmed mints and supply `945662401792509469`; live issuance matched. Its historical 46-mint baseline is intentionally non-exact following the approved repair and is not a discrepancy.
- Other exact reconciliation values reported green included POWB supply/bond flow `630496569`; WORK/Growth Q8 floor `1440701927434312771609632481` with associated `SatsExact` value `14407019274343127716.09632481`; marketplace mutation fees `1,361,724`; 617 seeded mail events with zero missing; 48 seeded Inception bond parents with zero missing; and 467 seeded Infinity records with zero missing. Credit ledger values matched and the consistency endpoint reported no mismatches.
- The health route’s bounded pending audit checked 23 items, with zero deferred, zero errors, and zero global unresolved events. Current token mint regression checks reported zero pending POW and WORK mints. A targeted transaction status read returned the repaired INCB mint as `confirmed`, canonical, at block 968125 with its expected block hash.
- The WORK participant regression passed against production: the confirmed 300,000 WORK transfer from Carbonz to its recipient was present with the expected txid, block 956369, token scope, and participants; the 420,000 WORK funding sale at block 956362 and confirmed `inception` ID registration were also found on their expected surfaces.
- These checks support correct public indexing/rendering for the tested records. They do not constitute a fresh row-by-row PostgreSQL duplicate/orphan audit or exact comparison of every persisted pending item with Bitcoin Core’s live mempool. Those direct checks remain unavailable without SSH/DB/Core access. No full `audit:computer-events`, `audit:ledger`, or heavyweight `indexer:parity` command was run in this environment.

## Math verification

All of the following completed successfully:

- `npm run check:work-amo-v8` — exact V8 declaration hash `0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d`; Q16 and Q8 scales, legacy V6 migration, allowed face value, canonical ordering, pending normalization, aggregate transfer admission, replay, and next-block liveness gates passed.
- `npm run check:work-precision-v2` — cross-plane Q16/Q8 precision contract passed.
- `npm run check:bond-exact-arithmetic` — exact bond arithmetic passed.
- `npm run check:work-market-v2` — WORK Marketplace V2 pricing contract passed.
- `npm run check:canonical-order` — canonical UTF-8 ordering passed.
- `npm run check:api-truth` and `npm run check:live-data` — passed.
- `npm run check:incb-oracle-snapshot-restore` — 28 snapshot/restore checks passed; `check:incb-post-v5-repair` passed four exact repair/conservation cases; `check:incb-range-replay-witness` passed; and `check:incb-scoped-oracle` passed isolation, provenance, rollback, and idempotency checks.
- `npm run check:credit-mint-regressions` — passed; POW 1,525,100 of 10,101,010 confirmed, zero pending, 8,575,910 available; WORK 21,000,000 of 21,000,000 confirmed, zero pending.
- `npm run check:work-participant-regression` — passed against the production API for the confirmed WORK sale, transfer, exact ID, asset scope, amount, and sender/recipient context.
- `npm run check:marketplace-regressions:full` — passed the read-only live convergence check across IDs, token summaries, paginated token listings, wallet reads, sales, listing states, market logs, Log, and transaction status.
- `npm run check:boost-regressions` — passed.

No discrepancy was found between the tested protocol constants, local deterministic math gates, live public summaries, and exposed ledger totals. The canonical ID fee split remains 1,000 proofs for registration and 546 proofs for receiver updates, direct transfers, listings, seals, delistings, and buyer-funded transfers.

## Application and API rendering

- The production page-only surface audit returned HTTP 200 for all 14 public routes, with required assets present. Headless browser inspection of all 14 routes found a mounted application root and no JavaScript errors, API errors, or failed requests.
- A longer observation of Home, ID, Boost, AMO, WORK, Inception, and Computer showed Home and Boost reaching their ready display within the wait window. ID, AMO, WORK, Inception, and Computer were still showing a verification/loading state at 8.5 seconds. No transport or browser error accompanied the state. This is a rendering/readiness delay, not evidence of wrong data. The AMO page explicitly awaited complete listing convergence.
- A bounded Log-history request returned HTTP 200 with a 1,341,239-byte response in 7.86 seconds. In the full convergence gate, one fresh Marketplace summary took 24.9 seconds and one WORK summary took 15.7 seconds; other Marketplace summary observations ranged from 5.0 to 12.3 seconds. By comparison, the focused readiness probe measured WORK at 1.12 seconds and Marketplace at 1.29 seconds. All these requests succeeded. This variability reproduces the previously tracked exact-summary/API latency issue (Audit 24 H24-01 and later follow-ups), rather than establishing a new data-integrity failure.
- The full marketplace gate observed snapshot-bound WORK listing pagination for 935 records. This confirms the page must wait for multiple history responses; request durations in the gate explain why an 8.5-second browser observation may still show loading.
- The prior 10,762,863-byte internal token-verifier response alert and failed API-observation-health unit remain unresolved in the latest available records. Current internal verifier payload and monitor unit status could not be fetched from the VPS.

## Previously reported issues rechecked

| Prior issue | Recheck result |
| --- | --- |
| Audit 24/25 missing canonical block-scan markers and missing `ticker=INCB` event reference | The 2026-09-26 approved repair record confirms the five derived-index residues were repaired. Current public consistency is green with no missing log events. The exact raw database rows could not be queried in this run. |
| Wallet directory oversized read / disconnected Wallet rendering | Earlier approved UI/API work changed disconnected Wallet to a compact public directory. Current browser smoke loaded the disconnected public credit directory (236 credits) without errors. |
| Pending INCB target mint and supply mismatch | Approved repair evidence and current public consistency confirm exactly 47 mints and supply `945662401792509469`; target transaction is canonical/confirmed. |
| UI disk pressure and redundant rollback roots | Earlier cleanup left one active release and one verified rollback. Current public UI routes are available, but current disk/archive inventory could not be checked. |
| API exact-summary and wallet latency/fail-closed availability | Still open. Focused readiness is green, but full-convergence samples include 15.7–24.9 second summary calls. No 4xx/5xx occurred in the audited browser/page or regression samples. |
| API-observation-health systemd unit | Latest known result is failed. Current unit and timer status unavailable. |
| PostgreSQL size concentration, live physical integrity, and backup monitor overlap | Still open. Last known DB was 35.27 GB, mostly one WORK transition relation; live page checksums were disabled. Isolated restore checks passed but are not a live-cluster scan. |
| Node archive retention and stale helper cleanup | Still open pending current inventory and exact-path verification. Prior policy rejection and SSH-limited temp-file removal remain documented. |
| Large INCB replay and historical repair evidence | Preserved. No evidence established that either workspace is safe to delete. |

## Findings

1. **AUD26-01 — High priority: rapid unexplained node `/data` decline.** API telemetry shows 101.7 GB less free space than the prior direct sample about 26 hours earlier. Cause and exact consumer are unknown. Find the growth source promptly and confirm the storage trend from the host.
2. **AUD26-02 — Existing issue, remeasured: variable exact-summary latency.** A full production regression request took 24.9 seconds for fresh Marketplace summary and 15.7 seconds for WORK summary; a focused sample was much faster. This extends the existing H24-01 availability/latency issue and is not duplicated as a new underlying defect.
3. **AUD26-03 — Existing rendering concern, rechecked: delayed data readiness.** Five of seven targeted pages had not left a verifying/loading state after 8.5 seconds despite clean browser and HTTP results. The complete snapshot/listing convergence and variable route times are plausible contributors. Confirm representative user-facing completion time after collecting host/API timing data.
4. **Scope limitation: current direct VPS/DB audit incomplete.** SSH authentication was rejected. Current UI VPS capacity, RAM/CPU, host logs, service failures, PostgreSQL size/integrity, actual archive/cache/temp inventory, exact Core-mempool membership, and row-level duplicate/orphan queries remain unverified. Public health being green does not substitute for these host-side checks.

## Actions taken

- Reviewed Audit 24/25, approved follow-ups 1–8, the wallet/pending-INCB repair record, and the required protocol/product documents before auditing.
- Ran read-only live health, consistency, transaction-status, summary-readiness, production surface, browser-render, marketplace convergence, and credit-mint checks.
- Ran the deterministic local arithmetic, INCB repair/oracle, WORK marketplace/participant, event/read-model contract, ordering, API truth, live-data, Boost, and marketplace regression gates listed above.
- Created this audit log. No production data, protocol records, ledgers, evidence, backup, cache, temporary file, or release archive was changed or removed.

## Items requiring follow-up or approval

- **Restore normal read-only SSH access** to both production VPSes so direct `df`, `du`, RAM/CPU, service/journal, PostgreSQL, backup, cache, and temporary-file checks can be completed. Do not send private keys or wallet material.
- **Investigate node `/data` now:** capture exact mount and directory sizes, deleted-open files, database and Core growth, replay/restore/backup directories, and systemd storage-monitor output. Compare with the previous `df` sample and set a measured runway alert.
- **Verify the UI host immediately after access returns:** disk and inode headroom, memory/swap/load, active release and one rollback provenance, log growth, and scheduled backup status.
- **Complete live PostgreSQL integrity checks:** relation/table/index sizes, disk headroom, duplicate/orphan and pending-vs-confirmed queries, current constraints/indexes, autovacuum/temp usage, and a safe live-cluster physical integrity plan. Keep isolated-restore evidence clearly separated from live checks.
- **Recheck and repair API observability:** inspect the failed observation-health service/timer and monitor output; retain interrupted-request, payload-size, and route-latency measurements.
- **Storage cleanup:** after current host inventory and provenance checks, prepare an exact candidate list limited to true duplicate release archives, the two named one-time `/tmp` helpers if still unreferenced, or other demonstrably disposable scratch. Keep the active release, one verified rollback, one current verified backup, active replay state, canonical records, and required evidence. No file is approved for deletion by this audit log alone.
- **Latency and rendering:** profile slow summary/API reads and determine why route timings vary; measure complete ID/AMO/WORK/Inception/Computer render readiness with representative data and connected-wallet testing, without weakening exact snapshot or full listing verification.
- **Canonical parity and mempool:** when direct production access is available, rerun full event/ledger/ID parity and compare every persisted pending status with Core’s current mempool; record the exact checkpoint and preserve prior receipts.

---

# Second audit addendum — ordered application surfaces

- **Audit date:** 2026-09-27 America/Toronto (production probes continued through 2026-09-28 UTC).
- **Scope:** Read-only review of all 14 requested public application surfaces, public production health and consistency endpoints, API summary readiness, selected marketplace/history regression reads, public HTTP security headers, and local deterministic protocol/math gates. Computer was reviewed last, after all other 13 surfaces.
- **Change boundary:** No production code, configuration, data, database, ledger, backup, log, release, or infrastructure was modified. No cleanup, service restart, wallet connection, signature, or transaction broadcast occurred. This addendum was appended to the existing audit; no previous audit text was rewritten.

## Systems and services checked

The requested order was followed:

1. `proofofwork.me` — Home
2. `id.proofofwork.me` — ID management
3. `desktop.proofofwork.me` — Desktop
4. `browser.proofofwork.me` — Browser
5. `boost.proofofwork.me` — Social tools
6. `amo.proofofwork.me` — AMO listings and purchases
7. `credit.proofofwork.me` — Credits
8. `wallet.proofofwork.me` — Wallet and credit directory
9. `work.proofofwork.me` — WORK
10. `infinity.proofofwork.me` — Infinity Bonds
11. `inception.proofofwork.me` — Inception Bonds
12. `log.proofofwork.me` — Logs
13. `growth.proofofwork.me` — Growth
14. `computer.proofofwork.me` — Computer (last)

Each origin returned HTTP 200 on the public document request. Public headers consistently included HSTS (`max-age=31536000; includeSubDomains`), CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive Permissions Policy. Static-document response times were 0.43–1.09 seconds; this does not represent full application/data readiness. The inspected browser pages did not report JavaScript console errors. The desktop public-file query rendered zero results; the attempted pointer interaction with its Open control was inconclusive in the automation harness.

## Full-node verification and access limits

The full node remains the required authority for canonical conclusions, but direct SSH to both the UI VPS (`77.42.91.106`) and node/API VPS (`65.108.122.87`) was rejected by the configured authentication. No direct Core RPC, PostgreSQL query, host journal, `df`/`du`, or service-manager inspection was possible. Accordingly, production `/health`, `/consistency`, summaries, and page counts below are application-reported observations, not independent full-node verification. I do not claim that every event, transaction, ledger row, address, or mempool entry was reconciled directly against Core in this run.

Public health reported a main-chain, unpruned, non-IBD node with txindex and index tip synchronized at block 968,923 at the later sample. The node-reported checkpoint hash was `000000000000000000007c079a786a9d7c214407ec7a91cfad59e0c2e08fff5b`; the public WORK and Marketplace summaries eventually agreed on block 968,923 and that hash. These values were received through the application health layer and were not independently requested from Core.

The public consistency endpoint returned HTTP 200/green with no missing log events. The latest reported pending audit checked 23 items with zero deferred, error, global-unresolved, or Q16-unresolved items. Public read-model telemetry reported 507 confirmed IDs (maximum block 968,428), 263 transfers (maximum block 968,736), and 26,435 confirmed events (maximum block 968,912). These differing read-model watermarks merit direct row-level reconciliation once database access is restored; the current green consistency result is not evidence that every materialized view has reached the same tip.

## Surface observations and data/math review

| Surface | Read-only observation |
| --- | --- |
| Home | Displayed 507 confirmed IDs, 20 pending, and 527 visible. The page described its registry summary as full-node verified; independent verification was unavailable in this audit. |
| ID | Showed the same 507/20/527 totals, canonical-registry wording, and 1,000-proof registration fee. A generic Computer-verification banner remained visible despite populated rows; this readiness/banner behavior is previously documented. |
| Desktop | The public query `inception@proofofwork.me` returned zero public files. Enter rendered the result; pointer activation of Open was inconclusive. No mailbox connection or mutation was made. |
| Browser | A previously captured confirmed HTML transaction remained 1,018 bytes with the same hash as the prior audit evidence. This was a repeat of stored public evidence, not a new Core lookup. |
| Boost | Displayed six indexed records. No like, follow, boost, or other write action was used. |
| AMO | The page remained on “Loading all credit and bond listings and verifying the AMO snapshot” for more than 34 seconds; displayed statistics remained blank. Read-only Refresh did not visibly complete the load. This rechecks the existing AMO convergence/readiness concern. |
| Credit | Displayed 236 credits, all confirmed, zero pending, and creation total 128,856 proofs. DRAIN showed 110,000 confirmed and zero pending; 75,000 + 35,000 holder balances reconciled to 110,000; 110 mints at 1,000 DRAIN / 1,000 proofs each; remaining amount 20,890,000. Displayed create/registry and minimum mint fee was 546 proofs. No wallet was connected. |
| Wallet | Disconnected public directory showed 236 credits. Account-specific balance/activity remained gated. No wallet, signing, or spending flow was invoked. |
| WORK | Displayed 21,000,000 minted against the maximum, zero pending, 385 holders, and 21,000 mints. Its 25-row page and complete-history control were read-only. The reported network/floor figures matched the independently recomputed Q8 floor described below. |
| Infinity | Displayed 630,496,569 confirmed POWB, zero pending, network value 630,501,483 proofs, and floor 1.00000779 proofs/POWB. It explicitly described its one visible sealed listing/one ticket as an incomplete AMO preview. No purchase was made. |
| Inception | Displayed 945,662,401,792,509,469 confirmed INCB, zero pending, and 47 chart events. Direct and attached issuance values summed exactly to the displayed total. Network value exceeded issuance by 22.46190218 proofs. Sale-ticket view explicitly remained a preview with withheld-empty-state wording until complete history is available. |
| Log | Displayed 26,117 total activity items, 26,095 confirmed, 21 pending, and 5,223 KB; confirmed plus pending is 26,116, with one supplemental activity item. This scope difference was already explained in Audit 26, not newly classified as a discrepancy. Page reported refresh through block 968,921 at capture. |
| Growth | Initially lacked full confirmed Boost data; after read-only Refresh chain metrics, it recovered in about 12 seconds and showed 4 posts, 5 social records, and zero purchases. WORK figures agreed with the WORK surface. AMO flow reconciled as 9,700,286 sale proofs + 1,361,724 fee proofs = 11,062,010. Forecast wording described a scenario rather than a current-value measurement. |
| Computer | Reviewed last. Mail showed an unconnected setup/empty state; Mail, Files, AMO, and Wallet workspace tabs were visible. No private connected-wallet state was inspected. The generic verification banner remained. |

The 236-credit directory and Growth’s 238-token count are not treated as a proven mismatch: those endpoints may include distinct POWB/INCB definitions. The event scopes must be compared by canonical event IDs before drawing a data-integrity conclusion.

## Full-node/API readiness, performance, and failure behavior

At `2026-09-28T02:49:49.322Z`, the summary-readiness probe returned `ok: true`; public health and WORK/Marketplace summary routes returned HTTP 200 at the same reported block 968,923 hash. WORK took 5.704 seconds and Marketplace 8.627 seconds, both beyond the 2.5-second warning target and below the 10-second critical threshold. Earlier observations during tip advancement showed temporary WORK V8-not-ready and Marketplace HTTP 503 checkpoint-mismatch results; the services recovered as their reported tip and snapshot caught up. This remeasures the existing latency/readiness family.

**New finding, medium (P2): complete WORK listing pagination can fail during tip advancement.** The read-only full marketplace regression gate successfully fetched many exact summary, address-wallet, history, listing, and transaction-status reads, then exited 1 while paging all 935 WORK listings at pinned block 968,922. Page 2 failed at 600 emitted records with HTTP 503 `CANONICAL_INDEX_CATCHING_UP`; retry then returned HTTP 409 `HISTORY_CURSOR_CONFLICT` / `token-listing-checkpoint-changed`. The gate did not restart pagination from page one against a fresh snapshot, so it could not establish complete listing membership in that run. The API failed closed rather than mixing snapshots, and later summaries recovered at block 968,923; no corruption was demonstrated. Impact: full listing views or audit/export workflows may remain incomplete during normal tip transitions. Recommended correction: on a checkpoint conflict, discard the entire partial page set and restart from the first page using a newly pinned snapshot, with bounded retries and explicit UI retry/readiness feedback; independently compare the final membership set/hash. Do not relax snapshot consistency.

**New finding, low (P3, verification required): Growth and Boost social counts differ.** Boost showed six indexed records while refreshed Growth showed four posts and five social records. Growth labels its values as confirmed/indexed/shape-valid counts, so scopes may differ. This audit did not prove missing or duplicate events. Compare the exact event-ID sets and checkpoint used by both endpoints; align labels or fix the reader if the sets should be identical.

## Storage, database, backups, and logs

Public node/API health reported `/data` total 1,764,768,071,680 bytes, free 476,760,903,680 bytes (72.9845% used), with a 5 GiB reserve and 90% warning threshold; root volume was 105,089,261,568 bytes total and 75,128,348,672 bytes free (28.51% used). Compared with Audit 26’s public sample about 28 minutes earlier, `/data` free space fell 34,009,088 bytes, stable over that short window. The previously observed approximately 101.7 GB free-space drop over about 26 hours (AUD26-01) remains unexplained and unresolved; the short stable interval does not close it.

The UI VPS disk/inode, memory, CPU/load, active and rollback release sizes, database/log/cache/temp usage, backup retention, and deleted-open files remain unverified. PostgreSQL physical size/integrity and backup status also remain unverified; Audit 26’s last known 35.27 GB database and approximately 33.9 GB WORK transition relation are historical estimates only. No safe stale-file deletion candidate was proven from current direct host inventory, and no files were removed. The public health sample indicates remaining `/data` headroom but does not clear the earlier unexplained decline or establish UI VPS runway.

## Math verification

The following local exact-arithmetic and protocol gates exited successfully: `check:work-amo-v8` (including its gate regressions), `check:work-precision-v2`, `check:bond-exact-arithmetic`, `check:work-market-v2`, `check:api-truth`, `check:live-data`, and `check:boost-regressions`. The WORK V8 declaration payload hash in the local gate was `0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d`. These verify the tested source-code contracts and fixtures; they are not a substitute for checking the deployed declaration and stored production rows directly against Core.

Independent local BigInt recomputation found:

- WORK Q8 total divided by 21,000,000 yields floor `68604853687348227219` Q8 units, or `686048536873.48227219` proofs per WORK, with `10,632,481` Q8 units remainder. This matches the displayed Q8 precision/floor rule.
- INCB direct and attached issuance sum to `945662401792509469`; the displayed network value exceeds issuance by `2,246,190,218` Q8 units, or 22.46190218 proofs.
- Prepared UTXO arithmetic: 40 × 2,000 + 1,441 = 81,441 proofs.

No tested local arithmetic gate failed, and no rounding discrepancy was found in these displayed examples. Production-wide deterministic parity remains unverified until the deployed hard-function declaration, canonical full-node results, indexer materializations, database rows, and API/UI representations can be compared at the same checkpoint. Pending mempool state remains best-effort and was not independently enumerated from Core.

## Previously reported issues rechecked

| Prior issue | Result in this audit |
| --- | --- |
| AUD26-01: unexplained node `/data` space decline | Still unresolved. Recent public telemetry is stable over 28 minutes, but host inventory and the earlier 101.7 GB change are unexplained. |
| AUD26-02 / H24-01: variable exact-summary and wallet/API latency | Still open. Current summaries took 5.704 and 8.627 seconds after temporary checkpoint/readiness failures during tip advance. |
| AUD26-03: delayed verification/render readiness | Reobserved on ID, AMO, WORK, Inception, and Computer banners; AMO still loaded after 34 seconds. Growth recovered after Refresh in about 12 seconds. |
| ID canonical scan markers, INCB event reference, supply repair | Public consistency remains green; displayed INCB supply and 47 events remain consistent with prior repair evidence. No direct database query or Core reconciliation was possible. |
| Wallet large directory response / disconnected-state rendering | Disconnected Wallet public directory loaded compactly with 236 credits; private account state remained gated. |
| PostgreSQL table growth, live physical integrity, backup monitor | Still unverified directly; the previous size concentration remains a historical observation. |
| UI VPS capacity, one active release plus one verified rollback | Current disk and archive inventory unavailable; prior cleanup state is not revalidated. |
| API-observation-health unit | Current systemd unit/timer could not be read. Latest prior result remains failed, unresolved. |
| Node archive retention and stale helper cleanup | Current inventory unavailable. Historical items were preserved; safe deletion not established. |
| INCB recovery/replay evidence | Preserved; this audit found no basis to remove it. |

## Recommended improvements and approval boundary

1. Restore authorized read-only host access and perform direct Core RPC, PostgreSQL integrity/size/duplicate/orphan, UI disk/inode, CPU/memory, logs, services, backup, cache, and temp inventory. Compare all materialized data with one recorded canonical checkpoint and exact Core mempool membership.
2. Investigate the historical `/data` decline and establish a measured growth/runway alert with directory-level attribution. Verify UI VPS headroom independently; do not infer it from node/API health.
3. Add bounded whole-snapshot restart behavior for pagination cursor conflicts and test concurrent tip advancement, while keeping fail-closed snapshot consistency.
4. Reconcile Growth/Boost event IDs at a shared checkpoint and make count definitions explicit in API fields and UI labels.
5. Profile summary latency and end-to-end readiness (including AMO complete-book convergence); retain latency percentiles and checkpoint-age/readiness telemetry.
6. Inspect the failed observation-health unit and alert path, then verify it reports current failures and stale observations rather than only process health.
7. After direct storage/provenance review, prepare an exact-path retention proposal for obsolete backups, old rollback archives, logs, caches, and scratch files. Keep one verified rollback and current verified backup. This audit approves no cleanup or deletion.

**Items requiring explicit approval:** any fix, production/configuration change, service restart, backup/log/cache/temp/archive deletion, database repair or rewrite, ledger/protocol change, or deployment. None was performed or requested by this append authorization.

---

# Third audit addendum — Computer performance, data efficiency, usability, and maintainability

- **Audit date:** 2026-09-27 America/Toronto (EDT); production and source checks continued through 2026-09-28 UTC.
- **Scope:** all 14 requested public surfaces in order, with Computer last; current source/build, loading boundaries, selected production API payloads and headers, Computer cold/warm rendering, accessibility contracts, arithmetic/read-state contracts, and existing audit issues. This is a read-only audit and proposal.
- **Source revision:** `825f7288d606499c564a1bb4271fc8e518e3c3da`.
- **Browser/device:** Chrome 154.0.8037.57, headless Chromium. Desktop profile 1440×900, DPR 1, CPU 1×, 10 Mbps down / 1 Mbps up, 100 ms RTT. Mobile profile 390×844, DPR 3, touch emulation, CPU 4×, 1.6 Mbps down / 750 Kbps up, 150 ms RTT. The mobile profile is emulation, not a physical phone.
- **Build/method:** `VITE_POW_API_BASE= npm run build -- --outDir /tmp/pow-computer-audit-build` passed (`tsc` and Vite build; 1,897 modules). Vite emitted its >500 KB advisory for the App chunk. Each standalone route was opened in a fresh context on the local production build in the requested order; its API `GET`/`HEAD` reads were proxied to `computer.proofofwork.me`, with non-read methods explicitly aborted. The local preview sets `no-cache` for JavaScript and CSS, so it was not used for warm-cache conclusions. Separate direct production Computer visits supplied the valid cold/warm cache observations. No signing, wallet mutation, mailbox write, transaction, deployment, service restart, or cleanup was attempted.
- **Field-data limitation:** no RUM/CrUX p75 or INP dataset was available. Browser traces and emulated profiles are lab diagnostics and are not a field pass.

## Scope, coverage, and authority limits

The requested order was followed: Home, ID, Desktop, Browser, Boost, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, Growth, and Computer last. All 14 local-build route documents returned HTTP 200 without a captured page error. Empty Desktop and Browser did not request content until a search/input action. Boost, token, bond, activity, and growth routes loaded the public API reads summarized below.

The public API returned registry snapshot `7719fec43a662182d571dca9` at block 968,925 with the block hash in the response, 527 records (507 confirmed, 20 pending), on the final direct registry read. This is an application/API observation only. Direct SSH/Core RPC and database access remain unavailable as recorded above; this audit therefore **does not claim independent full-node, database-row, or mempool reconciliation** and does not certify production ledger correctness. The live public state was not compared against independently retrieved hard-function outputs in this run.

Connected-wallet paths were not exercised because no designated test wallet/account was available. Private mail opening, file preview, spendable balance, signing preflight, actual transaction rendering, workspace-switch memory soak, and search/sort/pagination interaction timing could not be safely or meaningfully measured with the disconnected/empty account. These are explicit coverage gaps, not passes.

## Production build and browser measurements

The local production build contained an App chunk of 750,387 decoded bytes (180.65 KB gzip), a React/Lucide chunk of 151,660 bytes (49.91 KB gzip), a protocol/Bitcoin/signing chunk of 198,356 bytes (60.40 KB gzip), and global CSS of 148,499 bytes (24.44 KB gzip). The production Computer cold trace transferred 337,846 bytes of JavaScript, 28,734 CSS bytes, and 86,152 font bytes on desktop (71,144 font bytes on mobile). The first response delivered 16 desktop requests / 15 mobile requests. The browser directly measured production wire transfers; this is more representative than the proxied API aggregate below.

Direct production Computer cold/warm repetitions, three fresh desktop contexts and one direct mobile cold/warm pair before stopping a measurement script whose text-based readiness detector did not match the mobile layout:

| Profile | Cold result | Warm same-context reload | Notes |
| --- | --- | --- | --- |
| Desktop, 3 runs | 523 KB, 16 requests each; LCP 1.69–1.89 s (median 1.82 s); CLS 0; DOM 503; API transfer 69.3 KB, 1.24–1.97 s; visible registry snapshot text detected at 2.88–3.74 s (median 3.13 s). | 300 bytes total; JS/CSS/fonts 0 bytes. LCP 0.27–0.35 s. | Cold TTFB 0.42–0.50 s; DCL 0.89–1.13 s. The generic “verifying public data” banner remained visible in the page text after registry content rendered; this banner behavior was already reported in Audit 26. |
| Mobile emulation, 1 direct run; 3 additional local-build cold/warm pairs | Direct production: 508 KB, 15 requests; LCP 3.72 s; CLS 0; long tasks 222 ms and 282 ms; API transfer 69.3 KB / 1.53 s. Local-build cold LCP range 3.35–3.73 s (median 3.73 s), CLS 0. | Direct same-context reload: 300 bytes total and 0 bytes JS/CSS/fonts; LCP 0.69 s. Local preview could not test warm cache because it sends `no-cache`. | The direct run’s visible-text readiness detector did not match the mobile presentation, so no mobile time-to-verified-data value is claimed. The API completed; rendered-data readiness needs an accessible route-independent instrument. |

Production HTML returned `Cache-Control: no-cache, must-revalidate`; deployed hashed JavaScript/CSS returned `public, max-age=31536000, immutable`. The deployed CSS decoded to 148,499 bytes and matched the local build byte-for-byte. The App JavaScript decoded to 750,387 bytes in both; its content differed only in six content-addressed chunk-name references. The release commit identifier was not exposed, so the exact deployment revision remains unverified. Production `/api/v1/registry-summary` returned `Cache-Control: public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400`; the sampled response had no `Age` or `ETag` header. The warm browser measurement reused its cached API response (0 transfer bytes), as expected for that same-context immediate reload.

Core Web Vitals field goals remain p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1. The mobile lab LCP miss is not a field percentile. INP was not measured: no representative interactive field sessions were available, and a load-only trace cannot create INP.

## Ordered route sweep observations

The route sweep waited 7 seconds per route, with a later completed AMO read. Route aggregate byte counts below are from local-build browser resource timing with production API reads proxied through Playwright. API bodies in that harness may be counted decoded rather than wire-compressed; use the dedicated direct-production Computer numbers above for wire budgets. API body sizes/durations are recorded as payload cost and readiness evidence, not as compressed transfer claims.

| Surface | Requests / observed route aggregate | API payload or behavior observed |
| --- | ---: | --- |
| Home | 16 / 217 KB | `registry-summary?projection=counts-v1` about 1.9 KB; fresh count read about 1.8 KB. |
| ID | 16 / 2,723 KB | Full `/api/v1/registry` about 2,300 KB decoded. |
| Desktop | 15 / 423 KB | No API request before a search. |
| Browser | 15 / 423 KB | No API request before a txid input. |
| Boost | 17 / 516 KB | Feed about 14.8 KB; the same transaction URL was fetched twice at about 79.4 KB decoded each. |
| AMO | 18 / 428 KB at 7 s; 1,927 KB after completion | Complete `marketplace-summary` body about 2,010 KB decoded; production GET took 7.95 s in the direct request. Earlier Audit 26 observed >34 s; slow readiness is rechecked, not a new issue. |
| Credit | 20 / 1,041 KB | Token directory summary about 557 KB decoded, plus history pages about 43.2 KB and 1.9 KB. |
| Wallet, disconnected | 20 / 1,053 KB | Token summary about 557 KB; WORK-floor read about 114 KB / 5.68 s. Account data stayed gated. |
| WORK | 23 / 2,151 KB | WORK summary about 1,596 KB / 6.27 s; WORK-floor body about 114 KB / 5.28 s. |
| Infinity | 21 / 1,813 KB | Registry summary bodies about 502 KB and 446 KB; Infinity summary about 220 KB twice. Some reads are deliberate refreshes; deduplication is subject to snapshot/freshness review. |
| Inception | 21 / 1,479 KB | Registry summary bodies about 502 KB and 446 KB; Inception summary about 53 KB twice. |
| Log | 19 / 652 KB | Identical `/api/v1/log-summary?network=livenet` requested twice; each decoded response was about 114.5 KB. |
| Growth | 21 / 801 KB | Growth summary about 186.5 KB and 186.9 KB; likely distinct normal/fresh reads, so not classified as a duplicate without proving snapshot equivalence. |
| Computer (last) | 17 / 940 KB in the proxied sweep | Registry summary about 502 KB decoded / 1.56 s; direct production delivered 69.3 KB compressed wire. Rendered 527 / 507 confirmed / 20 pending at a hash-bound block. |

## Previously reported issues rechecked

| Prior report | Result |
| --- | --- |
| 2026-09-03 UI/UX audit: monolithic App/global style loading and responsive/accessibility concerns | Monolithic route code remains: `src/App.tsx` is now 56,528 lines and `src/styles.css` 9,240 lines. Current responsive-layout suite passes its 44 px mobile targets, representative contrast, 200% text reflow, reduced-motion, and structural smoke checks. Mobile LCP is newly measured above target; desktop small-target consistency is discussed below. |
| Audit 26 AUD26-02 / second addendum: variable summary/API latency and slow AMO readiness | Rechecked. AMO completed around 7.95 s in the direct route call, WORK summary 6.27 s, WORK-floor 5.28 s. Current snapshots and API-ready times vary; causes may be backend/indexer as well as client. No API-only attribution is made. |
| Audit 26 AUD26-03: delayed Computer verification banner | Reobserved after data appeared. Computer exposes a verified block in the registry summary, but its generic “verifying public data” banner remains. This is an unresolved/rechecked item, not a duplicate new finding. |
| Audit 26 node `/data`, UI capacity, SSH, PostgreSQL, backups and service log gaps | Not reaudited at host level in this UI performance audit; direct host access remains unavailable. No current disk cleanup candidate was inspected or removed. |
| Prior canonical/math/data discrepancies | No production chain/database reconciliation was possible. Local arithmetic and canonical contracts listed below passed; this does not close production parity findings. |

## Data, exact math, readiness, and accessibility checks

The following existing local checks passed: `check:work-precision` (131 checks, `work-atoms-v1`), `check:bond-exact-arithmetic`, `check:api-truth` (including WORK AMO V8 gates), `check:canonical-order`, `check:read-projections`, `check:surface-read-state`, `check:client-read-containment` (43 checks), and `check:ui`. The selected responsive browser tests all passed (5/5, 54 s): mobile navigation, structural accessibility smoke checks, mobile 44 px targets, representative contrast, 200% reflow, and reduced-motion behavior. No deterministic local math or projection failure was found. No production rounding, unit conversion, fee, balance, ledger, or hard-function parity claim is made without independent node/database data.

The browser config tests Chromium (`channel=chrome`) only. `axe-core` was not installed. No screen-reader speech, physical mobile device, Firefox/Safari/Edge, or zoom beyond the existing 200% browser contract was tested. The measured desktop navigation links were about 30 px high, below the project’s preferred 44 px control size; this does not by itself demonstrate failure of WCAG 2.2 AA’s separate 24 px minimum criterion. Existing 44 px mobile controls remain passing.

## New findings and recommendations

### PERF-27-01 — Shared App startup remains too costly on mobile (P1, previously documented architecture remeasured)

- **Evidence/reproduction:** cold-load `computer.proofofwork.me/?folder=inbox` on the specified 4× CPU mobile profile; repeat three local-build cold runs. Direct production cold LCP was 3.72 s; local-build cold range was 3.35–3.73 s. All routes except Home and Boost resolve to the same lazy `App` root in `src/main.tsx:13–19`. The App bundle is 750 KB decoded, and global `src/styles.css` plus five static font CSS imports are in `src/main.tsx:3–11`. `src/App.tsx:17–60` imports protocol/crypto dependencies and `:259` initializes ECC on all routes. Desktop/Browser content paths still pay shared startup before the first search.
- **User impact/root cause:** slow first useful page on constrained mobile, more JavaScript parse/evaluation, and a larger maintenance surface. Route boundaries are only defined for Landing and Boost; global style/font and signing dependencies are eager.
- **Proposal/benefit:** incrementally split route/workspace code and CSS; defer signing-only modules until a local signing action needs them; retain all fresh preflights, exact arithmetic, and local key handling. Use the current Proof Instrument design rather than a visual rewrite. The evidence supports code deferral; exact safe seams and savings remain to be measured.
- **Confidence/effort/risk:** high confidence in bundle shape and mobile LCP miss; medium confidence in the portion fixed by splitting; high effort and regression risk because App owns cross-workspace state/protocol flows.
- **Validation/rollback:** build route chunks and compare cold bytes/LCP/long tasks under identical Chrome profiles; test deep links, focus/state restoration, local signing, pending/fresh reads and route contracts. Roll back the route boundary/chunk change without altering protocol or data.

### PERF-27-02 — Large complete summaries make initial data readiness slow (P1/P2; latency family previously reported)

- **Evidence/reproduction:** open AMO, WORK, Credit/Wallet, Infinity/Inception and ID under the ordered route sweep. Observed decoded API bodies/times are in the route table. AMO full summary is about 2.01 MB/7.95 s; WORK about 1.60 MB/6.27 s; token directory about 557 KB; full ID registry about 2.30 MB. Proxied route aggregates are not wire-size claims.
- **User impact/root cause:** wait time, JSON parse and allocation work, and large-history hydration compete with first interaction. At least part of delay is API/indexer latency; this audit cannot attribute all elapsed time to the browser.
- **Proposal/benefit:** profile endpoint query, serialization, gzip and client parse separately; provide small exact hash-bound overview projections and snapshot-pinned cursor pages for browse/search/history. Do not declare a listing book complete or enable a spend/sign action until its complete membership/readiness gate and fresh preflight pass. Keep confirmed chain and pending state distinct and keep complete history replayable.
- **Confidence/effort/risk:** high confidence in response size/latency observations; medium confidence in their exact user-visible contribution; medium-high effort, high data-integrity risk unless snapshot hashes, total counts, cursor conflict restart and completeness are preserved.
- **Validation/rollback:** compare server timings, encoded bytes, decoded bytes, parse time and useful-data readiness separately; reconcile paginated membership to a pinned full snapshot; test reorg/tip advancement and transaction fresh reads. Restore the existing complete endpoint if any projection or page fails parity.

### PERF-27-03 — Refund-history evidence is in the shared JavaScript chunk (P2, new)

- **Evidence/reproduction:** `WORK_MARKET_V1_REFUNDS_959061.json` is 61,316 bytes, statically imported by `src/App.tsx:157`; its value is used by `workMarketV1RelicRows` at `:10942–10946`, inside the token-market render path at `:49915`. Because it is a static App import, it is in the shared App module graph even on unrelated surfaces. This is a protected ledger/refund snapshot, not cleanup material.
- **User impact/root cause:** downloads, parses and retains historical evidence before the relevant relic-history workspace is used.
- **Proposal/benefit:** defer module loading until the WORK relic/history view is requested; keep the tracked JSON byte-identical and available for replay. No deletion or conversion to a network-only source is proposed.
- **Confidence/effort/risk:** high confidence that the static import is eager; medium expected compressed/parse savings; medium effort and medium risk because historical rows affect spendability/replay classification.
- **Validation/rollback:** ensure no route fetches it until needed; compare every generated relic row, refund inclusion, replay fixture and existing WORK V1/V2 checks. Roll back by restoring the static import.

### PERF-27-04 — Public summary cache policy permits a day of stale fallback (P2, policy risk; stale use not observed)

- **Evidence/reproduction:** GET `https://computer.proofofwork.me/api/v1/registry-summary?network=livenet` returned block/hash provenance and `Cache-Control: public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400`; no `Age`/`ETag` was returned. `server/proof-api.mjs:514–515,1538–1549` sets the default 24-hour stale window and expensive summary policy. `src/shared/api/proofApiClient.ts:85–92` uses browser `cache:"default"` except fresh URLs (`no-store`). No stale response was demonstrated; `Age` was absent in the sample.
- **User impact/root cause:** during an API/indexer outage, cached confirmed/pending summary state may be shown for an extended period unless the UI clearly exposes its indexed time/block and stale age. Hash-bound snapshot provenance protects the represented snapshot but does not make old pending/mempool state current.
- **Proposal/benefit:** explicitly label last-verified snapshot age and block/hash when fallback is served; ensure it cannot authorize a transaction or appear as current pending status. Verify every cache layer’s behavior and balance resilience against correctness before changing TTLs.
- **Confidence/effort/risk:** high confidence in the live cache directive; medium confidence in how a deployed cache intermediary will serve stale data; medium effort, high correctness risk if freshness is weakened/hidden.
- **Validation/rollback:** controlled stale/error tests must show visible stale state, retained snapshot provenance and blocked fresh transaction actions. Roll back only after a fresh-vs-stale comparison and policy review.

### PERF-27-05 — Log workspace makes duplicate initial summary request (P3, new)

- **Evidence/reproduction:** open `/?log=1` in a fresh context and capture API URLs in the first 7 s. The same `/api/v1/log-summary?network=livenet` request appeared twice; each response was about 114.5 KB decoded, durations about 1.53 s and 0.90 s. `src/App.tsx:25710–25713` calls `refreshLogSurface` then schedules `loadVisibleLog` after one second; `loadLogHead` at `:27113–27131` issues the summary read.
- **User impact/root cause:** duplicate serialization/network/indexer work delays first Log usefulness and wastes response bytes. No periodic polling issue is inferred; this duplicate was within initial startup.
- **Proposal/benefit:** unify initial refresh ownership; retain focus and visible 15-second refresh behavior and query/snapshot fences. Expected saving is one call and one response per Log activation.
- **Confidence/effort/risk:** high confidence; low effort and low-medium risk if last-good/fresh semantics stay unchanged.
- **Validation/rollback:** browser test asserts exactly one initial summary read and correct log counts/page. Restore the previous call order if the test shows missing initial page or freshness behavior.

### PERF-27-06 — Boost media components duplicate identical transaction reads (P3, new candidate)

- **Evidence/reproduction:** `/?boost=1` generated two GETs to one identical `/api/v1/tx/<txid>` URL; each response was about 79.4 KB decoded. `src/features/boost/BoostRoot.tsx:491–507` requests the attachment independently from each `BoostMedia` component.
- **User impact/root cause:** duplicate media payload and node/API read when multiple feed items reference the same transaction.
- **Proposal/benefit:** consider bounded in-flight deduplication keyed by network and txid; do not retain unbounded attachment data or let one component’s abort cancel another consumer’s request.
- **Confidence/effort/risk:** medium confidence that repeated items caused the two reads; medium effort and cancellation/memory risk.
- **Validation/rollback:** fixture two posts referencing the same txid; assert one overlapping GET, identical checksum/MIME/rendering, independent unmount/cancel behavior, bounded retained memory. Remove dedupe if cancellation or data isolation fails.

### PERF-27-07 — Wallet-presence detection polls every second in all App routes (P3, new)

- **Evidence/reproduction:** `src/App.tsx:25004–25008` and `src/features/boost/BoostRoot.tsx:1959–1964` install 1-second `setInterval` calls that check `window.unisat`, including disconnected standalone routes. This is CPU wakeup work, not network traffic; hidden-tab wake frequency was not measured.
- **User impact/root cause:** idle battery/CPU cost and duplicated provider polling.
- **Proposal/benefit:** use provider initialization/focus/visibility signals and a bounded visible-only fallback, while retaining late-wallet injection/disconnect behavior.
- **Confidence/effort/risk:** high confidence polling exists; low expected user benefit per page; low-medium effort/risk around late provider injection.
- **Validation/rollback:** test wallets injected before and after mount, focus/visibility transitions and disconnect; assert no wallet authority is moved into Browser-rendered content. Restore polling if provider detection regresses.

### UX-27-08 — Desktop navigation hit areas miss the project’s 44 px target (P3, new project-level gap)

- **Evidence/reproduction:** visible desktop nav links measured around 30 px high. Existing mobile 44 px target tests pass; current WCAG 2.2 AA minimum and enhanced 44 px criterion are distinct.
- **User impact/root cause:** pointer target is smaller than the product’s declared preferred 44×44 control size on desktop, although this sample does not establish an AA failure.
- **Proposal/benefit:** increase the interactive box with padding while preserving the desktop visual hierarchy and focus indicator.
- **Confidence/effort/risk:** high confidence in measured size; low effort/low risk.
- **Validation/rollback:** assert 44×44 hit areas for nav controls at desktop and narrow widths; repeat focus, reflow and contrast checks. Restore the prior spacing if it causes clipping or layout shift.

## Storage, loading cost, and long-term maintenance

No production server disk, inode, memory, CPU, database, backup, cache, log or temporary-file inventory was performed in this frontend audit; the host-access gap and prior capacity findings remain open from Audit 26. No cleanup candidate was reviewed or removed. Do not treat the 61,316-byte refund JSON, audit history, protocol evidence, ledgers, archives, or backups as stale. The refund JSON may be deferred in the browser module graph but must remain immutable evidence.

`src/main.tsx` statically imports five font CSS files and the full `src/styles.css` for every route. `vite.config.ts:18–49` chunks React/Lucide and Bitcoin/protocol libraries but does not split the 11 App-hosted surfaces. Only Landing/Boost and selected Growth panels have lazy component boundaries. App contains 56,528 lines; global stylesheet contains 9,240. These are maintainability and regression-coupling signals; no full rewrite is justified by this audit. React’s documented lazy/Suspense and Vite production dynamic-import split are suitable tools for measured, incremental boundaries.

## Provisional regression budgets and review plan

The route sweep’s API figures are decoded payload costs; direct production wire baselines exist for Computer only. The following are **provisional acceptance ceilings for a first-load useful snapshot**, to be calibrated with direct production captures for every host before enforcement. They must never be met by dropping records or weakening snapshot/freshness checks. “Requests” excludes font/image requests discovered only after interaction. Fresh signing reads remain separately budgeted and are not served from stale cache.

| Surface | Provisional cold wire budget | Initial request budget | Usable verified read target | Idle behavior |
| --- | ---: | ---: | ---: | --- |
| Home | ≤250 KB | ≤12 | ≤2.5 s mobile | No recurring reads until explicit refresh. |
| ID | ≤700 KB first page/overview | ≤18 | ≤3 s; complete registry remains snapshot-pinned | Page/search on demand; fresh preflight before write. |
| Desktop | ≤350 KB | ≤14 | Shell ≤2.5 s; search result ≤2 s after submit | Zero API before search; no hidden polling. |
| Browser | ≤350 KB | ≤14 | Shell ≤2.5 s; verified tx result ≤3 s after input | Zero API before txid; sandbox remains isolated. |
| Boost | ≤450 KB initial feed | ≤18 | Feed ≤3 s | Media lazy; bounded concurrency/dedupe. |
| AMO | ≤700 KB first page/summary | ≤20 | Hash-bound complete-book readiness ≤5 s or explicit loading/error | No hidden polling; purchase requires complete fresh preflight. |
| Credit | ≤500 KB directory first view | ≤18 | ≤3 s | History pages on demand; no hidden polling. |
| Wallet | ≤500 KB disconnected directory | ≤18 | ≤3 s; account state only after wallet connection | Account refresh scoped to address/network and visible. |
| WORK | ≤700 KB first page/summary | ≤20 | Snapshot readiness ≤5 s or explicit stale/unavailable state | No hidden polling; exact fresh action preflight. |
| Infinity | ≤650 KB first page/summary | ≤18 | ≤4 s | Full history/listings on demand; visible refresh only. |
| Inception | ≤650 KB first page/summary | ≤18 | ≤4 s | Full history/listings on demand; visible refresh only. |
| Log | ≤500 KB first page | ≤18 | ≤3 s | One visible refresh every ≥15 s; zero hidden polling. |
| Growth | ≤600 KB first view | ≤18 | ≤4 s | Forecast/chart modules on demand; visible refresh only. |
| Computer | ≤400 KB disconnected cold; static assets ≤0 B on warm | ≤16 cold | Verified snapshot ≤2.5 s mobile; stale state explicit | Zero inactive-workspace traffic except intentional visible shared freshness checks. |

All surfaces should meet field p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 after field instrumentation exists. Lab regression gates should record TTFB, shell render, first hash-bound usable data, API/indexer time, transfer by resource type, request count, long tasks, DOM and heap separately. Large-data fixtures must include complete registry pages, 935+ listings, 26k+ log rows, 236+ credits, repeated media txids, pending records, tip changes, stale/error snapshots, and large WORK/INCB Q16 values. After every 20-workspace-switch soak, collect post-GC heap and DOM; set a ceiling from the measured baseline and require no monotonic retained growth. For local operations, target p95 client-side search/sort under 100 ms on the 10k representative fixture and never perform unbounded full-history sorting on the main thread.

Before implementation approval, establish direct cold and warm wire baselines for all 14 production origins; compare server timing, cache age and response sizes; add interactive search/sort/pagination and bounded workspace-switch tests; and obtain a designated test account/fixture for mail, file preview and connected-wallet flows. Add or reuse an automated WCAG check only after evaluating false-positive handling; manually test keyboard/focus, screen-reader announcements, 200%/400% zoom, narrow viewports and supported Chrome/Edge/Firefox/Safari versions. Review framework/dependency updates as explicit measured changes.

### Phased recommendation

1. **Quick wins:** remove Log’s duplicate initial summary read; add request-count regression; test bounded Boost tx GET coalescing; make rendered-data readiness/stale age distinct from shell status; measure navigation hit boxes.
2. **Targeted refactors:** defer the protected refund snapshot until WORK relic history; split heavy App workspaces and signing-only code only at proven seams; remove unused global font/style payloads; add hash-bound page projections for large directories/history, while retaining exact completeness gates.
3. **Larger optional work:** if measured route chunks still exceed mobile budgets, isolate standalone Desktop, Browser, ID, and wallet/market entry trees with explicit state/freshness contracts. Do not replace the app framework absent before/after evidence that incremental splits cannot meet budgets.

### First implementation batch ready for separate approval

Exact proposed files: `src/App.tsx`; new `src/shared/work/workMarketV1RefundSnapshot.ts` as the deferred wrapper for the unchanged snapshot; `src/features/boost/BoostRoot.tsx`; new `tests/browser/data-efficiency.spec.mjs` for request-count and route-readiness regressions. Retain `WORK_MARKET_V1_REFUNDS_959061.json` byte-identical. Acceptance criteria:

1. A fresh Log view emits exactly one `log-summary` request, displays the same complete/hash-bound counts and initial page, and retains focus/15-second refresh behavior.
2. Duplicate Boost feed references to one network+txid share only an overlapping GET; media hash/MIME/rendering, component abort independence and bounded memory remain correct.
3. The refund snapshot remains byte-identical and `npm run check:work-market-v2` plus `npm run check:replay-token-table-bridge` pass; any deferred import loads only when the WORK relic-history view is requested.
4. Before/after Chrome desktop/mobile cold/warm runs use identical build, dataset, API snapshot, browser, CPU/network, and cache profiles. Report compressed and decoded bytes separately, useful-data readiness separately from API/readiness delay, LCP/CLS/long tasks and requests.
5. Run existing focused regressions, review canonical docs and final diff, then `npm run hygiene:fix` and `npm run hygiene:check` as required. No production update, cleanup, commit, or deployment is included in this approval proposal.

## Actions taken, approvals, and primary sources

- Built and measured a production bundle in `/tmp`; no repository source/build output was changed by the build.
- Ran the focused browser/accessibility tests and existing arithmetic/read-state/projection/UI contracts listed above. All passed.
- Read public production documents, hashed JS/CSS, and summary API responses; verified cache headers and observed cold/warm behavior. No writes or wallet actions were issued.
- No code, configuration, production data, database, ledger, log, backup, cache, temporary file, or infrastructure item was altered/deleted. No cleanup candidate was approved by this audit.
- **Explicit approval still required:** any implementation/fix, cache-policy change, production/API change, host cleanup, storage deletion, database operation, service action, commit, push, or deployment. User has approved only recording this audit addendum.

Primary sources reviewed on 2026-09-28 UTC: [web.dev Web Vitals (last updated 2024-10-31)](https://web.dev/articles/vitals), [React `lazy`](https://react.dev/reference/react/lazy), [Vite Building for Production](https://vite.dev/guide/build), [W3C WCAG 2.2 Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), and [W3C WCAG 2.2 Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced). Web.dev specifies the p75 Core Web Vitals goals and cautions that lab results do not replace field data; React/Vite document deferred component loading and build splitting; WCAG 2.2 distinguishes minimum target size from enhanced 44 px targets.

---

## Approved recommendations 1–8: production recheck and implementation addendum

- **Audit date:** 2026-09-28 (UTC); production host observations collected approximately 03:37–03:50 UTC.
- **Baseline source:** repository `825f7288d606499c564a1bb4271fc8e518e3c3da` (`main` at audit start).
- **Scope:** read-only inspection of both production VPS environments, Bitcoin Core, Electrs, proof indexer, PostgreSQL, API/mempool evidence, host logs and capacity; plus approved local client, monitor-observability, UI and regression-test changes. This addendum supersedes the earlier access limitation above for checks completed in this window, while preserving limitations noted below.
- **Change boundary:** no production deployment, service restart, production configuration write, database/ledger/protocol mutation, backup/log/cache cleanup, or historical evidence deletion occurred. Code changes are local and uncommitted pending required hygiene clearance. Existing user changes to `repository-hygiene.json` and this audit file were preserved.

### Production health and capacity recheck

| System | Read-only result | Interpretation / limits |
| --- | --- | --- |
| UI VPS | Root volume 39.97 GB, 15.17 GB used, 23.12 GB free (~40% used); inode use 6%; RAM 4 GB with 3.36 GB available; low load/CPU idle; storage-health status `ok`. | Current headroom is adequate at this sample. `/var/tmp/proofofwork-deploy` used ~4.65 GB, `/var/backups/proofofwork-ui` ~6.39 GB, `/var/www` ~231 MB, `/var/log` ~683 MB, `/var/cache` ~128 MB. The deployment staging tree contains repeated source/surface copies and generated archives; no item was removed. A storage-trend service and release-prune service were failed. The release-prune attempt reported deployment-lock contention and did not clean anything. A 4.5–6.6 GB/day estimate includes deploy bursts and is not a stable long-term rate. |
| Node/API VPS | Root volume 105.1 GB, 24.6 GB used, 75.1 GB free; `/data` 1.7648 TB total, 1.2793 TB used, 476.5 GB free (~73% used); inode use ~1%; RAM 134 GB with 117 GB available; load ~2.94. Core, Electrs, API, indexer, PostgreSQL and Mempool containers were active/healthy. | No immediate disk exhaustion at this sample. The storage observer still forecasts ~88.6–101.7 GB/day from older one-day samples; the latest three-hour net change was about 0.5 GB. The earlier ~101.7 GB/26h fall is partly attributable to retained replay/evidence and backup roots by current directory inventory, but exact historical byte attribution is not provable from current `du` output. Treat the older rate as unresolved historical movement, not a present sustained rate. |
| Node `/data` attribution | Core `/data/bitcoin` ~979 GB; Electrs ~64.2 GB; PostgreSQL tablespace ~35.4 GB; PostgreSQL backups ~18.87 GB; release backups ~9.20 GB; Mempool ~2.05 GB. Retained replay/evidence roots included ~89.5, 32.9, 20.3, and 20.2 GB; recovery material ~3.91 GB; UI recovery evidence ~0.60 GB. | These are live protected/replayable data. No backups, rollback artifacts, logs, caches, database material, or evidence were deleted. No large deleted-open files were found under `/data`. |
| Logs/services | UI journal ~305 MB; 49 system-wide `journalctl -p err` entries in the prior 24h; UI failed storage-trend and release-prune units plus an old Boost publish service. Node journal ~999 MB; 320 system-wide error-priority entries and 31 failed units, mostly historical operations/alert runs. | Per-unit UI error attribution was unavailable because `jq` was not installed. Node observation-health failure represents an active latency threshold finding, not a checker crash; API alert-delivery outside local service/journal evidence remains unverified. |

### Full-node and database reconciliation

At one pinned read snapshot Bitcoin Core `main` and Electrs both reported height **968927**, hash `00000000000000000002018d44bc7de6320c0214e2af0281f6bbefd1d468f3ec`. Core was not in initial block download, reported verification progress 1, and had txindex/coinstats/blockfilter synchronized. API/indexer health reported the same tip/hash, `atTip=true`, complete index, canonical checkpoint match, completed canonical rebuild and healthy database/canonical metadata. The relational block row and WORK/AMO transition checkpoint matched this hash. The transition model reported complete, block-atomic, fee-once, and invalid-zero checks true. A sampled API mempool transaction was unconfirmed in Core and returned as `confirmed:false`, `mempoolSeen:true`, `status:"pending"`.

PostgreSQL size was 35,973,397,527 bytes (~36.0 GB). `work_amo_block_transitions` accounted for ~34.72 GB, mostly TOAST (~34.33 GB), across 9,307 rows spanning heights 959621–968927. The sample reported zero dead tuples, recent autovacuum, zero invalid indexes, valid constraints, 18/18 relations in the expected tablespace, nine application connections, and no lock or long transaction. Three leading cumulative query shapes deserve plan-level investigation: latest proof-index scan metadata (~863,578 calls, mean ~988 ms); ledger-backed canonical summaries (~239,843 calls, mean ~981 ms); and referenced-event snapshot work (~5,158 calls, mean ~25.37 s, high temporary-block use). `pg_stat_statements` reset time was unknown; counts are cumulative, not rates.

This confirms sampled checkpoint/canonical and pending-state agreement only. A complete historical relational parity scan was not run. Live PostgreSQL physical-page checksums remain uncertified (`data_checksums=off`, `pg_amcheck` unavailable); the successful earlier isolated restore checksum audit does not certify this live cluster. The broad 35 GB physical scan was not run during this read-only window.

### API/indexer readiness and observed performance

The API observation-health unit remained failed because its current latency alert was real. Recent observed route samples had no 5xx or unknown-size results, but notable route costs remained: `/api/v1/internal/canonical-summary` p95 ~13,112 ms / max payload ~5.40 MB; `/marketplace-summary` p95 ~9,471 ms / max ~2.01 MB; `/work-summary` p95 ~4,958–5,014 ms / max ~1.60 MB; `/token-history` p95 ~4,918 ms / max ~3.23 MB. `/health` was ~476 ms and tx-status p95 ~12 ms. Mempool API Docker metrics were a single point sample (~39.8% CPU, ~3.418 GB RAM), not a trend. Do not clear or suppress the observation alert: it is evidence of outstanding route latency.

### Status of recommendations 1–8

| # | Result in this addendum | Status |
| --- | --- | --- |
| 1. Node `/data` capacity | Measured current capacity, mounted-directory attribution, deleted-open check and recent-vs-historical trend. Replay, backup and evidence growth is retained. | Investigation advanced; historical drop attribution and long-term growth rate remain open. No cleanup. |
| 2. UI VPS and PostgreSQL | Rechecked UI disk/inodes/RAM/journals/release staging; queried live database size, dominant table/TOAST, relation/index/constraint/autovacuum/connection/lock state and query-shape statistics. | Current snapshot recorded. Full physical integrity and growth-rate certification remain open. No production database changes. |
| 3. Pinned full-node reconciliation | Matched Core, Electrs, API/indexer and sampled relational checkpoint at exact height/hash; verified one sampled pending tx against Core. | Point-in-time check passed; all-history data parity and physical page integrity not certified. |
| 4. AMO/WORK reads on tip change | AMO full-book reader now retries at most three times; on retry it gets a fresh summary and restarts all listing pages from page one with bounded backoff. Partial pages are never published. Existing WORK snapshot completeness and fresh transaction gates remain. | Implemented locally; regression contracts and browser tests passed. Production rollout not performed. |
| 5. Large reads/mobile startup | Removed a duplicate initial Log summary request; deferred the unchanged protected WORK V1 refund snapshot until its history view opens. Measured candidate App chunk at 705.80 KB decoded / 169.86 KB gzip versus prior audit’s 750 KB / 180 KB; refund snapshot is a separate ~10.41 KB gzip chunk on demand. Existing large API summaries and App route splitting remain unresolved. | Partial. No new same-condition mobile LCP run or field p75 measurement was made. No server projection/pagination behavior was changed because production summary costs need query/transfer/parse attribution and complete snapshot parity first. |
| 6. Stale cache and transaction boundary | AMO snapshot display now exposes verified block/hash and observed age when available and says transaction actions need a fresh preflight. Existing last-good states remain labeled. | Implemented locally and contract-tested; production cache behavior and user-visible stale-state coverage still require release validation. |
| 7. Measured client-side wins | Log duplicate read removed. Boost repeated same-network/txid media GETs use overlap-only coalescing with reference-counted cancellation, bounded concurrency and no settled cache. UniSat detection moved from one-second polling to event/focus/visibility checks. Missing Boost feed counts now display loading/unavailable instead of false zeros. Protected refund snapshot stays byte-identical and is loaded on demand. | Implemented locally; request, cancellation, retry, late-wallet and browser regressions passed. |
| 8. Monitoring/regression/accessibility | Added storage-directory attribution to the storage observer in report-only mode (`cleanupApproved:false`) and storage/API-observation contract checks to node-ops regression. Desktop shared folder control target is now at least 44 px. Added/updated browser tests for Log, Boost, wallet injection and duplicate media reads. | Regression coverage improved locally. Observation alert remains real; alert delivery was not certified, route-specific field Web Vitals were not added, and no field p75 pass is claimed. |

### Code and verification record

Local candidate changes touch `src/App.tsx`, `src/features/boost/BoostRoot.tsx`, new `src/shared/api/inFlightRequestPool.ts`, new `src/shared/wallet/useUnisatPresence.ts`, `src/styles.css`, `deploy/proofofwork-storage-trend.py`, `package.json`, targeted check scripts and browser specs. The previous user's `repository-hygiene.json` change and this audit record were preserved. No protocol rule, ledger, protected refund JSON, backup, production DB, log, or historical record was edited.

Passed on the candidate source: production build (App 705.80 KB decoded / 169.86 KB gzip; build still warns the App chunk exceeds 500 KB); in-flight pool unit; surface read state; node-ops including storage trend and API observation health contracts; UI contract; WORK marketplace V2; replay/token bridge; Boost regressions; API client timeouts; read projections; WORK precision (131 checks); bond exact arithmetic; canonical order; API truth; client read containment; hardening; index recovery (550/550); WORK/AMO V8; and live-data checks. Production-built Chrome tests passed: surface read state (13/13), plus Boost media coalescing/reboost rendering (5/5). `git diff --check` and read-only `npm run hygiene:check` passed. No browser field metrics were available and the local preview was stopped after the tests.

### Remaining approvals and follow-up

- The candidate is **not committed, pushed, merged, or deployed**. Merge/deployment is explicitly held for the user's final production-release approval after review of the completed diff, verification and rollout/rollback plan.
- The mandatory repository procedure requires `npm run hygiene:fix` before staging/commit. Its allowlist includes `node_modules/.vite-temp`, currently an empty 4 KB directory, and this audit's production build created ignored `dist/` output. The user's no-cache/no-cleanup condition requires separate approval before removing the Vite cache (and exact inventory/review before any other allowlisted removal); therefore the fixer and commit hooks have not been bypassed and no content has been staged. A branch attempt was blocked because sandbox `.git` is read-only; the authorized git operation will need approved write access after the cleanup gate is resolved.
- One 33-byte probe response remains untouched on the node at `/tmp/pow-health-response` (mtime 2026-09-28 03:41:41 UTC). It contains only the probe response body. Removal requires separate approval under the read-only/no-cleanup boundary.
- No exact database repair or production cleanup is proposed. Before any future cleanup, present exact paths, provenance, dependency/live-use proof, and rollback protection for separate approval. Before rollout, capture same-condition production/browser baselines, verify release/rollback target and storage headroom, monitor pinned canonical height/hash and latency, and rollback by restoring the previously deployed immutable release if correctness or readiness regresses.
- **Follow-up priority:** investigate the high-latency canonical-summary/marketplace/WORK query shapes and add hash-bound small overview/page APIs only with full membership/completeness parity; diagnose API alert routing; capture route-specific field Web Vitals; measure client parse and useful-data readiness separately from API/indexing; and schedule an approved live-cluster integrity strategy that does not overload PostgreSQL or alter production records.
