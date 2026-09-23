# Production comprehensive health and data-integrity audit 21

**Audit date:** 2026-09-22 UTC<br>
**Refresh window:** approximately 23:24–23:57 UTC<br>
**Scope:** Read-only continuation of Audit 20 across the Node VPS, UI VPS, PostgreSQL, Core/Electrs, indexer/API, public Computer endpoints, sampled UI surfaces, storage/retention, and deterministic math. Audit 20 remains the same-day baseline for the full earlier history, population checks, and issue register.

## Executive summary

The latest Computer readiness check returned HTTP 200, `ready=true`, at Core/indexer/Electrs height 968201 with zero lag. All 25 checks from `/api/v1/consistency` passed and reported no missing log events. The sampled PostgreSQL indexes and constraints are valid, and the new block hash agrees with Core. WORK Q8 arithmetic and the current Marketplace V2 and AMO V8 contract gates pass.

The immediate capacity concern remains the UI VPS. It has 10,817,929,216 bytes free, only **80,510,976 bytes (76.78 MiB) above the 10 GiB operating reserve**, and just **13,402,112 bytes (12.78 MiB) beyond the deploy helper’s additional 64 MiB allowance**. Its five-minute storage monitor continues to emit the known narrowing-runway warning. No production files were removed because rollback, restore, and live-use dependencies have not been proven safe for deletion.

The API observation monitor continues to see large, slow summary responses: in its latest 10-minute sample, all six marketplace-summary requests were slow, with a 20.797-second p95 and a 32,014,859-byte maximum response. This is evidence for the already-open summary-size and latency findings, not a new issue ID. The node’s nginx web-container log is still unbounded and totals about 3.92 GB. The cold IDs view and duplicate self-send Desktop tile from Audit 20 were reproduced.

No production mutation, restart, deployment, transaction signing, database repair, backup restore, or production cleanup occurred. The full `audit:ledger` gate did not complete: it was stopped after more than 90 seconds without output. The focused consistency endpoint passed, but this does not certify a complete historic replay, full mempool reconciliation, physical database scan, or restore.

## Systems and services checked

- **Node VPS (`pow-bitcoin-01`):** Bitcoin Core 31.1, Electrs, PostgreSQL 16.15, ProofOfWork API, indexer worker, and mempool Docker services. Core/API readiness and the local PostgreSQL catalog were queried read-only.
- **UI VPS (`ubuntu-4gb-hel1-1`):** root disk, memory, load, storage-health service, and current disk headroom. The UI VPS does not host the production application database.
- **Public API:** `GET /health?network=livenet`, `GET /api/v1/consistency?network=livenet`, and the fresh WORK floor response recorded in the evidence companion.
- **User surfaces:** Computer’s disconnected/cold IDs workspace and the Carbonz public Desktop view, without connecting a wallet or signing.
- **Local math checks:** `check:work-precision-v2`, `check:work-market-v2`, and `check:work-amo-v8`.
- **Predecessor review:** Audit 20 and its evidence companion were reviewed before assigning any finding status. Their SHA-256 hashes are recorded in the evidence companion.

## Capacity, database growth, and retention

| Measurement | Node VPS | UI VPS |
| --- | ---: | ---: |
| Root capacity / available | 105,089,261,568 / 66,678,038,528 B | 39,973,924,864 / 10,817,929,216 B |
| Root use | 36.55% | 72% |
| Data/cache capacity / available | 1,764,768,071,680 / 378,185,367,552 B | — |
| Data/cache use | 78.57% | — |
| Available RAM | 117,073,121,280 B at the 23:24 host sample | 3,406,299,136 B at 23:42 |
| Swap | 659,292,160 B of 17,179,865,088 B | 0 B |
| Load average (1 / 5 / 15 min) | 1.34 / 1.62 / 1.51 at 23:24 | 0.00 / 0.00 / 0.00 at 23:42 |

The node has substantial absolute data-space headroom, though its data volume is over the configured warning threshold. The last comparable one-second CPU sample in Audit 20 showed 92.5% idle on the 32-vCPU node and 86.0% idle on the 2-vCPU UI VPS; the latest load averages are also low. These short samples do not establish sustained CPU capacity. Core, Electrs, and the indexer are synchronized. The UI has little growth margin against its reserve; small ongoing writes from release retention, scratch snapshots, logs, and backups can consume the remaining margin. Its last sampled storage-health run exited with warning status 1; the repeated nonzero status is the monitor’s warning behavior, not evidence that Caddy or the application stopped.

Fresh PostgreSQL size was **32,782,539,799 B**. `proof_indexer.work_amo_block_transitions` occupies **31,386,337,280 B** (about 95.7% of the database); `ledger_snapshots` occupies 823,345,152 B. The transition table grew 4,554,752 B from the 23:29 sample during this short interval. This is not a reliable long-term growth forecast. Invalid or unready indexes: 0. Unvalidated constraints: 0. Cumulative deadlocks: 0. Current lock waits: 0. The `amcheck` extension is absent; physical checksums remain disabled as recorded in Audit 20.

### Storage candidates reviewed; none removed

The following are candidates for a separately verified retention pass. The exact inventories and paths are in Audit 20’s evidence companion; the amounts below are allocated bytes as previously measured.

| Area | Observed data | Safety status |
| --- | --- | --- |
| UI releases/rollback roots | Six older paired rollback sets total 3,226,681,344 B, excluding sidecars. Retain the last verified compatible UI/API rollback pair containing `68b16f653049`. | Do not delete until the active release, recovery dependencies, and rollback pair are checked under the deployment lock. |
| UI deployment scratch | 2,320,359,424 B, including source snapshots, `node_modules`, and compiled surfaces. | Live-use and lock/dependency checks were not done; not certified safe. |
| UI backups | `/var/backups/proofofwork-ui` totals 20,409,577,472 B. | Keep the newest and any required recovery evidence; verify complete replacement and recovery needs before trimming. |
| Node managed release archives | 44 candidate archive sets / 132 files, 3,484,725,248 B; the prior dry run found 47 verified archives and no unverified ones. | Keep the live release and last verified rollback. Revalidate exact archive identity before any deletion. |
| Node `/opt` checkouts | 38 checkouts other than live and last rollback total 8,392,380,416 B. | Verify active/recovery dependencies before removal. |
| Node logical PostgreSQL dumps | Sep 20: 16,213,820,318 B; Sep 21: 16,551,193,583 B; Sep 22: 16,924,101,954 B. The two older sets total 32,765,013,901 B. The newest set’s checksum and TOC were valid, but it has not been restored. | Do not remove older sets until the newest dump is restored and verified, including roles/globals. The configured keep-seven policy can continue accumulating generations. |
| Node physical PostgreSQL backups | Sep 19 and Sep 21 sets were about 18.81 GB and 19.50 GB in Audit 20. | No full restore proof; preserve the last restore-proven complete base/WAL set. |
| Mempool nginx container logs | Access log 3,825,455,684 B and error log 97,499,563 B, total **3,922,955,247 B**. Access log grew 122,459,896 B since the earlier Audit 20 measurement. The web container uses Docker `json-file` with no effective size/count options; host logrotate does not cover this writable-layer log. | These are active logs. Do not truncate them as stale files. Add and verify a bounded rotation policy in a separately approved change. |

Other sampled UI allocations at 23:30 were `/var/tmp/proofofwork-deploy` 2,320,359,424 B, `/var/www` 231,964,672 B, `/tmp` 272,912,384 B, `/var/cache` 128,684,032 B, and `/var/log` 676,966,400 B. The old rollback and scratch amounts overlap the corresponding parent-directory totals; do not sum parent and child rows as reclaimable space.

## Node, indexer, database, and event integrity

At the final fence, Core was on mainnet at height/header **968201**, hash `00000000000000000001d575745157b8688344f264b6f712fbb3d24fe18b018b`; it was unpruned, out of initial block download, verification progress 1, and had no warnings. The before/after Core hashes matched. Core transaction indexes and Electrs’ header were at the same tip. The API reported the canonical index complete at 968201 with the same hash and zero lag. The worker was idle, `proofReady=true`, with zero consecutive failures and last success at `23:41:50.522Z`. All eight summary coverage keys named the same tip.

The same-day block comparison covered heights 968108–968200: **93/93 Core hashes and previous-block links matched the PostgreSQL block rows**; the 93 corresponding transition rows had the required complete, block-atomic, fee-once, invalid-zero flags. The live health checkpoint independently matched Core at 968201.

The consistency endpoint returned HTTP 200 in 9.835 seconds in the evidence receipt (an earlier same-window request took 9.31 seconds), `status=green`, **25/25 checks passed**, `missingLogEvents=[]`, and a coherent exact-tip snapshot at 968201. The checked rules covered event/log coverage, token components, INCB issuance, POWB bond flow, WORK/Growth totals, marketplace mutation fees, credit miner-fee coverage, and canonical checkpoint provenance. The one non-confirmed supplemental activity (`ledgerActivityCount=25,991` vs. canonical/public-log count 25,990) is unchanged from Audit 20; all confirmed counts agree at 25,968, and the endpoint passes. It remains a separately qualified supplemental row, not a new mismatch.

The latest bounded database row-count sample from approximately 23:29 had 26,310 confirmed events, 171 pending and 5 dropped; transactions had 25,628 confirmed, 173 pending and 76 dropped; 506 confirmed IDs; 617 confirmed mail items; 238 credit definitions; 1,189 credit listings; and 974 V8 listing terms. The catalog checks found no missing `raw_tx`, invalid index, unvalidated constraint, negative/noninteger credit balance, orphan reference, confirmed-parent volatile event, or duplicate confirmed-mail key. The nullable `raw_hex` field is expected in this schema because confirmed raw bytes are stored in `raw_tx`.

Core’s mempool was loaded with **85,359 transactions**, 41,914,869 bytes, and 236,824,600 B usage against a 2,000,000,000 B limit; full RBF was enabled and unbroadcast count was zero. The API health pending-event probe checked zero currently observed candidates. That bounded result is not a scan of the full Core mempool: the database still contains pending rows, so it must not be described as global pending-event completeness. A wallet-connected end-to-end pending/confirmed rendering check was not performed.

The audit does not certify every physical PostgreSQL page: checksums are off and `amcheck` is unavailable. No full historical replay, deep table scan, complete mempool-to-ledger reconciliation, logical/physical backup restore, or MariaDB physical integrity scan was run in this refresh. The long `audit:ledger` command was stopped after more than 90 seconds without output; its result is **incomplete**, not pass.

## Protocol and application math

- `npm run check:work-precision-v2` passed the Q16/Q8 conversion, V8 pricing, cutover, metadata, and cross-plane wiring contract.
- `npm run check:work-market-v2` passed the Marketplace V2 pricing contract.
- `npm run check:work-amo-v8` passed the V8 declaration and gate regressions for normalization, aggregate admission, persistent Q16 replay, liveness, and declaration discovery.
- For the live WORK floor, exact `networkValueQ8=1438911276484283185635804555`. Integer division by 21,000,000 produces `floorQ8=68519584594489675506` with remainder 9,804,555 Q8 units. This equals `floorSatsExact=685195845944.89675506`; exact network sats are `14389112764842831856.35804555`. The exact API value and floor agree with independent decimal arithmetic.
- At the sampled BTC/USD quote of 86,124, exact decimal total USD is `12392479477593240.507969803149482`. The API’s `totalUsd` JSON number is `12392479477593240`; binary floating-point cannot retain cents at this magnitude. This matches the existing contract that USD/chart aliases are display values, not arithmetic authority. Any consumer needing exact currency output should use a decimal/string representation.
- The separate `check:marketplace-regressions` script did not run its test cases: its fast gate expected a local API at `127.0.0.1:8081`, which was not running (`ECONNREFUSED`). No local service was started because its database target was not established as isolated from production. This remains an unverified harness gate, not a production regression result.
- Fee rules remain unchanged: 1,000 proofs for new IDs and 546 proofs for receiver updates, direct transfers, marketplace ticket mutations, seals, and buyer-funded transfers. No wallet signing or protocol-record modification occurred.

## API, logs, and UI rendering

The readiness endpoint returned HTTP 200 in 2.15 seconds. Its database, index, node, Electrum address canary, and worker checks passed. The latest ten-minute API observation contained no server errors, but did report:

| Route | Requests / slow | p95 | Maximum response | Monitor result |
| --- | ---: | ---: | ---: | --- |
| `/api/v1/marketplace-summary` | 6 / 6 | 20,797 ms | 32,014,859 B | latency and large response |
| `/api/v1/internal/canonical-summary` | 13 / 1 | 14,460 ms | 20,035,045 B | latency and large response |
| `/api/v1/token-history` | 38 / 4 | 13,909 ms | 3,227,842 B | latency |
| `/api/v1/work-floor` | 4 / 2 | 12,939 ms | 112,750 B | slow sample |

The monitor’s payload warning threshold is 8 MiB. These are finished-request samples, not proof about aborted responses, complete hydration, or UI rendering. They reinforce the existing summary budget and intermittent-latency issues.

The recent bounded journal window (from 22:44 UTC) contained repeated storage/API observation monitor exits. Node `PRIORITY<=3` rows in the 12,000-line sample were monitor oneshot results: 11 storage warnings, 11 API-observation warnings, and one storage-trend warning. The UI sample had 12 storage warnings and one storage-trend warning. The API monitor found large/slow responses but no 5xx in the measured routes. These systemd warning exits do not indicate that the serving API, Core, database, or Caddy crashed.

The Computer IDs workspace still showed “verifying canonical data” with 0 confirmed and 0 pending IDs before wallet connection/hydration. This reproduces **H5-02**; those cold values are not authoritative registry totals. In Desktop, `carbonz@proofofwork.me` still rendered two identical `POWCarbonz.jpg` tiles for the same transaction and SHA-256, while Core contains one 10,774-byte artifact. This reproduces **H20-03**, a presentation duplication rather than duplicate chain history or funds.

## New findings

No new unique defect is assigned in this refresh. The current UI headroom, API response size/latency, and nginx log growth are updates to existing findings; H5-02 and H20-03 remain reproducible. The numeric USD alias loses about 0.508 USD against exact decimal arithmetic at this magnitude; this is the documented display-only float alias, not a consensus calculation input. Use exact decimal strings where currency precision is required.

## Previously reported issues rechecked

| Existing issue | Audit 21 status |
| --- | --- |
| H5-01 / H13-01 UI capacity reserve | **Still open; narrowed.** Only 76.78 MiB above reserve and the five-minute storage check warns. |
| H8-05 / H10-02 backup retention and database growth | **Still open.** Large redundant candidates remain; newest logical dump is not restore-proven. |
| H7-01 / H10-07 / A11-03 summary-size budget | **Still open; current sample confirms it.** Marketplace summary reached 32.0 MB and all six observed responses were slow. |
| H20-01 nginx web-container log growth | **Still open; grew.** Combined access/error logs are 3.923 GB and no effective rotation was found. |
| H5-02 cold IDs false-zero presentation | **Reproduced.** UI remains in canonical-verification state before hydration. |
| H20-03 Desktop duplicate self-send tile | **Reproduced.** One chain artifact appears twice in the derived view. |
| H5-06 / H10-05 / H12-06 / H18 availability and latency | **Still open.** Current readiness passed, but slow summary responses persist; one successful sample does not close the intermittent issue. |
| H20-02 stale product copy; H20-04 missing confirmed Boost status label | **Not rechecked in this refresh; remain open from Audit 20.** |
| H19-02 provider-unavailable false 404; H19-03 stale transaction cache across reorg | **Not fault-injected live; remain open from Audit 20.** |
| H9-01 invalid pre-unit listing history and pagination/hydration gaps | **Not re-exercised; remain open from Audit 20.** |

No new unique issue ID is assigned. Findings above continue existing records, and no fix is claimed for an item that was not retested.

## Actions taken, approvals, and recommended follow-up

- Production checks were read-only; created this report and evidence companion. The required local hygiene cleaner removed the allowlisted ignored `node_modules/.vite-temp` directory (0 B), and `npm run hygiene:check` passed. No production data, protocol record, ledger, evidence, history, backup, rollback, cache, or log was deleted or changed.
- The audit-log creation is authorized by the user. The repository’s `AGENTS.md` separately requires explicit approval before production or repository changes; no deployment, retention change, log truncation, restore, or production deletion is included here.

### Items requiring approval

- No item is currently certified safe to delete. Before proposing an exact cleanup batch, verify release and rollback dependencies under lock; verify scratch snapshots are not live inputs; restore the Sep 22 database backup including roles/globals; and identify the last complete restore-proven physical set.
- After that read-only preflight, present exact paths and reclaimed-byte estimates for approval. Any production deletion, log-rotation configuration, restore, or repair requires explicit approval under `AGENTS.md`.

### Recommended follow-up actions

- Address the UI reserve margin first, then test backup retention, implement bounded container-log rotation, and reduce summary response size/latency with alert-delivery verification.
- Keep this report and `2026-09-22-production-comprehensive-health-data-integrity-audit-20.md` as adjacent audit entries. The evidence companion hashes the predecessor artifacts and stores current API receipts and the scope limits for replay by the next auditor.



## Ordered application surface audit — Computer reviewed last

**Audit date:** 2026-09-22 America/Toronto (final receipts through 2026-09-23 00:23 UTC).<br>
**Scope:** Read-only review of the fourteen requested public surfaces, in the user’s order, followed by current node-bound health, consistency, WORK arithmetic, and local deterministic protocol gates. Targeted waits/reloads were used for initially loading surfaces; Computer remained the last application surface. Audit 20 and Audit 21 were reviewed before classifying observations. This addendum updates existing issue identities and assigns no new issue ID.

### Current canonical verification

At the final health sample, the full node reported mainnet block **968202**, hash `0000000000000000000079b48f847b413cebc85d0078915226db00046137de2f`, headers synchronized, transaction index synchronized, unpruned, and not in initial download. Electrs, the indexer checkpoint, and Core reported the same height and hash with **zero index lag**. The worker was idle and proof-ready with zero consecutive failures; the database and canonical metadata health checks passed. `/health?network=livenet` returned HTTP 200 in 2.24 seconds.

The fresh consistency response at block 968202 returned HTTP 200 in 9.99 seconds: **25/25 checks passed**, no failed checks, and `missingLogEvents=[]`. It reconciled event/log coverage, token state and mints, INCB supply and issuance, POWB flow, WORK/Growth totals, AMO mutation fees, credit miner-fee coverage, and the checkpoint hash. Canonical/public Log actions were 25,990; the ledger activity summary was 25,991 because it includes one previously documented non-confirmed supplemental activity (H6-15). Confirmed counts agree at 25,968 and pending counts at 22. This is the known scope distinction, not a new missing event.

The fresh WORK-floor response was 112,758 bytes and took 13.65 seconds. Independent integer division reproduced the API result exactly:

- `networkValueQ8 = 1438911276484283185635804555`
- `floorQ8 = floor(networkValueQ8 / 21000000) = 68519584594489675506`, remainder `9804555` Q8 units
- Exact network value: `14389112764842831856.35804555` proofs; exact floor: `685195845944.89675506` proofs per WORK

The large Growth/WORK figures therefore match the canonical Q8 value and are not a new math discrepancy. `npm run check:work-precision-v2`, `npm run check:work-market-v2`, and `npm run check:work-amo-v8` all passed. The known numeric USD alias precision limit remains display-only and was not used for protocol arithmetic.

### Ordered surface results

| # | Surface | Result and integrity notes |
| --- | --- | --- |
| 1 | `proofofwork.me` — Home | Loaded and refreshed. Registry showed 506 confirmed + 21 pending = 527 visible IDs. No page error observed. |
| 2 | `id.proofofwork.me` — ID management | Registry showed 527 records; the public `carbonz@proofofwork.me` sample was `Confirmed · 1,000 proofs` with owner/receive address and tx link. Account controls correctly required UniSat. |
| 3 | `desktop.proofofwork.me` — Desktop | Public lookup of the same confirmed ID remained `Opening public desktop…` after repeated waits totaling over 12 seconds. No file results appeared. This reproduces the existing latency/incomplete-lookup family (H5-06/H10-05/H12-06/H18); H20-03’s duplicate tile could not be rechecked because the result never loaded. |
| 4 | `browser.proofofwork.me` — Browser | The known confirmed HTML fixture still rendered: txid `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b`, confirmed Mainnet, 1,018 bytes, 546 proofs, SHA-256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`. |
| 5 | `boost.proofofwork.me` — Boost | Settled at six indexed records. Aggregate signal displayed 2,730 direct proofs plus 7.0000011 WORK, consistent with the exact current WORK floor. The original post and reboost action are shown separately. |
| 6 | `amo.proofofwork.me` — AMO | Still verifying one coherent registry/credit/WORK snapshot after a 10-second wait. Counts stayed as unavailable dashes; the page did not claim an empty market. Full-book readiness remains unverified under the existing latency and pagination/hydration findings. |
| 7 | `credit.proofofwork.me` — Credits | After loading, displayed 236 confirmed ordinary credits. DRAIN showed 110,000 confirmed / 0 pending; holders 75,000 + 35,000 = 110,000; 110 mints × 1,000 = 110,000. Creation proofs 128,856 = 236 × 546. Pagination exposed 24 of 236 credits and 25 of 110 DRAIN mints. The other two definitions in the 238-token canonical count are the distinct bond categories, consistent with the previous audits. |
| 8 | `wallet.proofofwork.me` — Wallet | Disconnected shell was explicit. Transfer/list actions were disabled; the 546-proof registry/ticket fees were visible. No account balance, pending transfer, or spendable balance is certified without a connected wallet. |
| 9 | `work.proofofwork.me` — WORK | Settled to 21,000,000 / 21,000,000 minted, 21,000 confirmed mints, and 361 holders. A transient local 40-row holder page was replaced by the API’s 361-holder, 15-page result; the 21,000-mint history also settled. Current exact floor/value matched the node-bound work-floor response. |
| 10 | `infinity.proofofwork.me` — Infinity Bonds | Settled at 630,496,569 confirmed POWB, 0 pending. One verified 2,000,000 POWB ticket showed exact total price 2,000,000 proofs (1 proof/POWB). The complete ticket book remained explicitly incomplete after a checkpoint-change deferral; empty-state claims were withheld. |
| 11 | `inception.proofofwork.me` — Inception Bonds | Settled at 224,847,713,398,447,926 confirmed INCB, 0 pending, 46 events. Direct issuance 27,386 + attached-WORK issuance 224,847,713,398,420,540 equals supply. Fixed network value was 224,847,713,398,447,947.9358206 proofs; the 21.9358206 sub-INCB dust is retained in value, not issued supply. The complete ticket book remained deferred and did not claim an empty market. |
| 12 | `log.proofofwork.me` — Logs | First navigation restored a cached view at block 968113 (25,987 total / 25,964 confirmed / 22 pending); a full reload caught up to block 968201 (25,991 ledger actions, 25,968 confirmed, 22 pending, 25,990 canonical/public actions). This resembles the dated stale-cache/Log-refresh behavior already recorded in Audits 19–20 and H6-15; after reload, counts and checkpoint matched the current API scope. The confirmed Boost-like row still lacked a `Confirmed`/`Pending` label, reproducing H20-04. |
| 13 | `growth.proofofwork.me` — Growth | Initially showed a verified-ledger-unavailable state, then loaded exact figures. Current WORK/Growth totals match the 968202 consistency and floor receipts. Boost observations remained “Unavailable / being prepared” despite Boost itself settling to six records, matching the previously recorded incomplete Growth Boost detail; not assigned a duplicate issue. |
| 14 | `computer.proofofwork.me` — Computer (last) | Cold Inbox initially showed zero and canonical-verification status. Selecting the IDs workspace and using its read-only refresh loaded 506 confirmed + 21 pending = 527 network IDs, 24 per page; `0 yours` remained correctly scoped to the disconnected account. This reproduces H5-02’s misleading cold zero; it resolves after refresh but is not fixed. No wallet connection, signing, compose, import, export, mint, transfer, list, seal, purchase, or other write action was performed. |

The browser session reported two console errors during ticket-book loading: Inception deferred complete hydration pending its summary checkpoint; Infinity deferred/restarted pagination after a token-listing checkpoint change. Both matched visible, explicit incomplete/verified-preview states. They did not present an empty book as complete or change canonical records. Other captured surfaces showed no browser console error/warning at their respective samples.

### Previous findings rechecked

| Existing issue/family | This audit |
| --- | --- |
| H5-01 / H13-01 UI storage reserve | **Still open; no fresh UI-host sample.** Audit 21’s 23:42 UTC measurement left 76.78 MiB above the 10 GiB reserve and 12.78 MiB beyond the deploy helper’s additional 64 MiB margin. |
| H8-05 / H10-02 backups and DB growth | **Still open; no new cleanup or restore proof.** Prior candidate inventory remains review-only. |
| H7-01 / H10-07 / A11-03 summary size and latency | **Still open.** Current WORK-floor response took 13.65 seconds; prior marketplace-summary sample was 32.0 MB and 20.8 seconds p95. Do not treat health’s `payloadBytes` as compact wire size. |
| H20-01 unbounded mempool nginx logs | **Still open; not re-inventoried.** Last measured combined access/error files were 3.923 GB with no effective container-log rotation. |
| H5-02 cold Computer/ID zero | **Reproduced, then refreshed correctly.** |
| H20-03 Desktop duplicate file tile | **Not rechecked.** Desktop lookup never returned results; keep open. |
| H20-04 missing confirmed Boost status in Log | **Reproduced.** The confirmed Boost-like row had no chain-status badge. |
| H5-06 / H10-05 / H12-06 / H18 availability and latency | **Still open.** Desktop remained opening, AMO remained verifying, and Credit/WORK needed extended settling. |
| H9-01 listing-history/pagination/hydration | **Still open.** AMO and INCB complete books were not obtained; Infinity correctly deferred on a checkpoint change. |
| H6-15 Log refresh/count scope | **Scope math agrees; transient stale first render recurred.** A full reload reached the current canonical snapshot; one supplemental ledger activity remains excluded from the canonical/public partition as previously documented. |
| H20-02 stale marketplace prose; H19-02 provider-unavailable false 404; H19-03 warm tx cache across reorg | **Not fault-injected or source-rechecked; remain open.** |
| Existing Growth Boost unavailable detail | **Still visible** while Boost itself loaded six records; remains in the existing incomplete-summary/latency family. |

### Capacity, storage and system-health update

Current API health still passed node root and data-filesystem health checks. Node root: 105,089,261,568 B total / 66,755,334,144 B available (36.48% used). Node data/cache: 1,764,768,071,680 B total / 378,116,669,440 B available (78.57% used). The API database and canonical metadata checks were green. Current health does not expose fresh VPS CPU or RAM or database allocated size.

The latest direct host measurements remain those in Audit 21: PostgreSQL **32,782,539,799 B**, of which `work_amo_block_transitions` was **31,386,337,280 B** (~95.7%); 0 invalid/unready indexes, 0 unvalidated constraints, 0 deadlocks and no current lock waits. Physical checksums remain off and `amcheck` is absent. UI host memory/load and disk remain at the Audit 21 23:42 UTC sample. Read-only SSH names `pow-bitcoin-01` and `ubuntu-4gb-hel1-1` did not resolve in this runner, so no fresh host-shell CPU/memory, SQL catalog, mempool `getmempoolinfo`, journal, or directory-inventory sample was possible. This is a scope limitation, not a production-host failure.

No storage candidates are newly certified safe to remove. Audit 21’s unverified older rollback/release sets, deployment scratch, backup generations, database recovery sets, and the 3.923 GB active mempool nginx logs remain documented candidates/risks. The newest logical dump has not been restore-proven; logs are active, not stale. **No cleanup, truncation, pruning, restore, restart, or production change occurred.**

### New findings, action and follow-up

No new issue ID is assigned in this addendum. Existing H20-04 is reproduced; H5-02 remains reproducible before refresh; H20-03 remains unverified because the Desktop lookup hangs; the Log first-render cache and Growth Boost unavailable state fall within already documented Log freshness and availability/hydration observations. The 25-check canonical consistency result and exact math pass do not certify every historical row, physical database page, wallet-specific balance, full mempool reconciliation, backup restore, or complete sale-ticket book.

**Actions:** read-only GETs, UI navigation/search/refresh, current API cross-checks, the three local deterministic math gates, and this authorized append to Audit 21’s Markdown and evidence companion only. No application code/configuration, production database/data, ledger, protocol record, backup, server log, cache, or infrastructure was changed. No cleanup candidate was removed.

**Approval required before follow-up changes:** exact backup/rollback deletion, container log rotation or truncation, database repair/compaction, indexer/book hydration changes, response/cache changes, Desktop timeout/error handling, Log chain-status rendering, or UI capacity expansion. Recommended next work is (1) protect UI reserve while proving one compatible rollback and a complete restorable database backup, (2) bound the active nginx log and database/transition growth under reviewed retention, (3) reduce fresh-summary size/latency and make Desktop/AMO/Growth availability states actionable, (4) fix Log status labeling and cold false-zero presentation, then (5) rerun full ordered exact-tip and complete-book checks. No improvement or cleanup was implemented here.

**Recursive evidence:** this append was based on the pre-append Audit 21 report SHA-256 `1cbf7071b76ce87c5c42edc97b5e5c403e2fafd2c91462d175a51ad36fc55339` (18,763 bytes) and evidence SHA-256 `cc393e5e206b8cf9e71cab662f565dede7a77b5508a6442ab8f141c3dc9d930a` (223,761 bytes). The companion JSON records those hashes, current canonical checkpoints, per-surface observations, test outcomes, and scope limitations; it also hashes this Markdown addendum and its canonical payload.
