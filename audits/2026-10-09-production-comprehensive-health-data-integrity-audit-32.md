# ProofOfWork production health and data-integrity audit 32

Audit date: **2026-10-09**, America/Toronto (EDT, UTC−4). Live observations began around **13:00 UTC / 09:00 EDT**; live collection ended at **13:33 UTC / 09:33 EDT**; individual captures retain their own clocks. This is the requested FIRST AUDIT in this conversation and the next comprehensive record in the existing Audit 1–31 lineage.

**Verdict: qualified integrity and arithmetic passes; production health is not fully green.** The captured indexed transaction population reconciles with Core, relational and Mail checks pass, and no runtime arithmetic discrepancy was demonstrated. UI storage runway has narrowed, fresh APIs still intermittently fail, one confirmed Code event is missing from Log, Permission reads exceed their budget, and database interruption can crash the API. Recovery and local release synchronization remain incomplete. The standalone Wallet connection stall has also been reproduced and investigated below.

The user approved creating this log. Production data, protocol records, ledgers, historical evidence, configuration and services were not changed; no production files or backups were removed. Human wallet connection approval was used only for account reads. No transaction signature, broadcast, publication, trade, Git commit/push or deployment occurred.

## Scope, authority and recursively verifiable evidence

Before live checks, the prescribed documents were reviewed in order: `SOUL.md`, `README.md`, `PROOFOFWORK_IDS.md`, `PROOFOFWORK_DNS.md`, `MARKETPLACE.md`, `OP_RETURN_INFRASTRUCTURE.md`, `MAIL_ORGANIZATION.md`. The audit reviewed prior top-level audit narratives and issue/follow-up records, including Audit 30's tracker, Audit 31's original evidence and later capacity, freshness, native-storage and recovery acceptance records. Older findings below are continuations/rechecks, not duplicated new defects.

Starting local `main`: `c7935dde7239836f89be27c1ee29dfbc6a585e78`; tree `70137cf4b831c792eeca5d2eaae21354ebed2ef9`. Tracked source was clean. Existing untracked recovery/evidence work was preserved; this audit does not certify that it has been committed or independently escrowed. The companion evidence binds 951 pre-existing top-level audit artifacts, canonical documents and ledgers (167,680,420 bytes at inventory time); a binding inventory is not a claim that every nested recovery file was freshly reread.

Systems checked: UI VPS `77.42.91.106`; node VPS `65.108.122.87`; Caddy and public assets; PostgreSQL/catalog/roles/WAL; Core and all three Core indexes; electrs; mempool API/database/web containers; protocol indexer worker; Search generations/timer; retention, capacity, query, latency and release monitors; logical backups and restore receipts; installed local off-host recovery status; all 22 managed UI surface byte bindings; representative in-app rendering and one connected account; exact frontend/server arithmetic and protocol fixtures.

Companions, saved beside this log:

- `2026-10-09-production-comprehensive-health-data-integrity-audit-32.evidence.json`: structured conclusions, capture clocks, prior bindings, gate verdicts and bundle hash.
- `2026-10-09-production-comprehensive-health-data-integrity-audit-32.artifacts.json.gz`: sanitized receipts and executable read-only collectors, each with original name, byte length and SHA-256. No credentials, private keys or private Mail bodies are included.
- `2026-10-09-audit32-cleanup-review.json`: exact UI candidates and conditional node retirement inventory. **Review inventory only; removal is not authorized.**

To verify custody, hash the compressed bundle against the evidence, decompress it, then check each UTF-8 artifact against its stored byte length/SHA-256. Prior bindings can be rechecked relative to the repository root. Historic capture inputs and live recapture are separate: a future agent must fence its own new chain tip and must not silently substitute newer snapshots into these results.

## Health and capacity

| System | Capture-time health | Capacity and material qualification |
| --- | --- | --- |
| UI VPS | Caddy active, no captured restart since September 12; config validates; CPU samples 100% idle; 3.337 GB RAM available of 4.005 GB; no swap | Root 39,973,924,864 bytes total, 26,499,162,112 used, **11,790,569,472 available**, 70% used; inodes 10% used. Only **1,053,151,232 bytes / 0.981 GiB** above the mandatory 10 GiB reserve and already below the 12 GiB warning. |
| Node VPS | Both RAID arrays `[UU]`; 32 CPUs, later 90% idle; RAM 115.649 GB available of 134.126 GB; swap 1.248 GB used with zero sampled swap-in/out | Later root **59,188,117,504 bytes available**, 41% used; `/data` **327,844,470,784 available**, **82% used** of 1,764,768,071,680 total; `/data` inodes 1% used. Earlier Audit 30 was 77% used; growth warning remains. |
| PostgreSQL | 16.15; zero invalid indexes/unvalidated constraints; zero recorded deadlocks/conflicts; role temp limit 1 GB | Initial DB 54,511,041,559 bytes; later 54,324,501,527. **40,933,457,920 bytes** are retained Audit 31 native rollback relation; current chunks 7,252,647,936; large-state tablespace 49,762,861,056 allocated. Live checksums **off**, `amcheck` absent: no full live physical-integrity certification. |
| Core/electrs | Core 31.1, IBD false, 124 peers, time offset zero, warnings empty; all three indexes synchronized at970633 | Final independent Core/electrs header at **970635**, identical hash `00000000000000000000e737e8c38881238138160b9c330d0326752545837d1a`. Core data 982.414 GB, electrs 64.348 GB. These canonical stores are not cleanup candidates. |
| Mempool | Loaded, optimal fee state, zero unbroadcast; three containers running/healthy, zero container restarts | Core pool about 220.68 MB within 2 GB policy; app mempool storage 1.733 GB. Docker logs bounded to four 25 MB files per container. Pending membership is volatile and best effort. |
| Indexer/Search | Worker running, successful canonical publication witnessed; Search timer active, completed oneshot is normally inactive | Freshness may lag during a new tip. Search generations have zero duplicate keys/orphan generations; current shared effective confirmed population 26,349. Retained generation/source dependencies require approval before retirement. |

UI VPS has no application database, Core or indexer in the inspected processes/listeners/data inventory: those live on the node VPS. The UI's repeat fullness risk is **release, rollback, transport and recovery accumulation**, not a local PostgreSQL database.

UI allocation: `/var/backups/proofofwork-ui` **19,764,543,488 bytes**; its nested transport 9,895,395,328, releases 5,246,763,008, rollback roots 2,285,031,424 across nine roots, recovery 1,570,279,424. Deployment scratch `/var/tmp/proofofwork-deploy` 2,606,075,904; live `/var/www` 262,369,280; logs 643,624,960; cache 128,962,560; `/tmp` 851,968. Nested domains must not be summed.

Since Audit 31's October 4 cleanup, backup allocation grew **7,947,644,928 bytes**, and UI free space fell from 16,845,217,792 to 11,790,569,472 bytes. All **25** exact previously approved removed paths remain absent. Their fixes remain effective; newer retained releases recreated capacity pressure. Current storage-health/trend clocks are fresh. The one-day forecast showed net cleanup and no exhaustion ETA, while its absolute warning remained active. That short window cannot predict a deployment burst. Another substantial staging/custody allocation can breach the reserve.

Node growth also includes 94.803 GB logical backups, a 52.742 GB stopped restore cluster, protected replay roots, 37 source roots (`/opt` 14.570 GB), and retained rollback data. Cumulative PostgreSQL temporary usage **4,556,825,671,107 bytes / 1,185,613 files** is a lifetime/statistics counter, not current removable temporary files. Traffic counters (Core lifetime roughly 53.12 TB sent / 64.46 GB received) are not provider billing-period data; provider quota was unavailable.

## Storage review and backup/recovery qualification

Current UI release `c7935dde7239-20261009T043549Z` and the immediate predecessor are fully byte-verified across **22** managed surfaces, archive checksums and clean source HEAD/tree. Preserve current `/var/www`, the current release archive, and:

`/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-c7935dde7239-20261009T043549Z`

That rollback contains `b40d4f4a0d31-20261009T000001Z`, commit `b40d4f4a0d3144996058cc034a7480e048a88793`, tree `7b085e7b2c36f6063bdc797b8ee12c10120fc29a`; preserve its archive too. This is source/byte verification, not a rollback rehearsal.

The cleanup review names **eight older rollback roots and 15 superseded modern release archives**, totaling **5,773,234,176 allocated bytes** in exclusive regular root files plus archives. This is conditional capacity, not recovered space. Historical passthrough contents match the retained predecessor; bounded process/FD, mount, service and Caddy-reference checks found no live use; external-hardlink qualification passed. Parent holds and historical citations still apply. Require a fresh locked manifest and complete dependency/custody review before deletion. Three older pre-protocol archives (455,753,728 bytes), transport/source evidence, audit receipts and ledgers remain historical authorities, not stale by age.

Node review identifies these major conditional domains, with exact identities in the companion inventory:

| Object | Size | Decision |
| --- | ---: | --- |
| Sep 29 logical dump | 19,363,782,935 file bytes | Older protected pin; successor restore/custody and explicit pin retirement required. |
| Oct 3 logical dump | 20,878,072,656 file bytes | Older restore authority; same retirement requirement. |
| Oct 7 logical dump | 27,176,979,892 file bytes | **Last whole isolated restore verified**; retain until a successor qualifies. |
| Oct 9 logical dump | 27,384,359,985 file bytes | Full stable checksum and 253-entry TOC pass; **not freshly restored**. |
| Oct 7 private restored cluster | 52,742,062,080 allocated bytes | Stopped, but recovery/custody/inverse dependencies not closed; retain. |
| Native rollback relation | 40,933,457,920 allocated bytes | Production SQL/schema/history; separate explicit approval required. Never treat as cache. |
| Protected INCB replay/backup roots | 89.526 / 32.854 / 20.163 / 20.256 GB | Active or historical replay/recovery dependencies; retain pending exact inverse/custody proof. |

Dump file bytes, database relation sizes and allocated directory sizes use different measures; nested domains are not additive. None was removed. General caches, temp directories, obsolete-source and note inventories are documented in sanitized receipts; no unqualified age-based deletion was made.

The October 7 Audit 31 isolated logical restore accepted **30 tables, four roles, 10,660 transitions and 10,660 archive frames, with all 26 exact fields/timestamps**; offline checksum review covered **6,309,061 blocks, zero failures**. Earlier Audit 28/30 private clusters remain removed; their small receipts remain preserved. Live checksums remain off, so historical private checksum acceptance is not a current live-page guarantee.

At the **13:08 UTC node capture**, the actual new physical slot `audit31_offhost_recovery_v1` was active, with about **1.659 GB retained** and existing **16 GB** cap; live WAL about 2.231 GB. The disabled old `pg_receivewal@16-main` unit does not describe this newer path. However, local off-host recovery is **unqualified/incomplete**: at 13:25 UTC the health record reports `currentRecoverySetUsable=false`, `historicalPhysicalRestoreQualified=false`, `pitrCertified=false`, missing historical certificate and receiver/source evidence unavailable. The WAL service was running after 20 automatic restarts, last at 13:19:33 UTC; its last status was `AssertionError`/incomplete at 13:18:32, with earlier replication disconnect/refusal receipts. The base timer is inactive, consistent with the previous explicit stop/incomplete handoff. Service/slot presence does not prove durable completed WAL publication or PITR. Do not retire the last verified recovery authority on these observations. This continues unresolved Audit 31 Priority 4; no repair/resumption was performed.

## Data integrity, ingestion and canonical reconciliation

The principal raw-population check held exact Core before/after fences at **970633**, hash `000000000000000000012e6d292e9ec606c40807983e71ca281a886717d0769f`. Later observations at 970634/970635 are separate captures.

| Population or invariant | Coverage/result |
| --- | --- |
| Indexed confirmed transactions | **25,991/25,991** raw hex/txid/witness IDs, positions, heights, block bindings, decoded inputs/outputs and transaction fees compared with Core. |
| Outputs / inputs / OP_RETURN | **78,493 outputs**, **31,115 inputs**, **26,131 OP_RETURN rows**: value, script, address, prevout, sequence/scriptSig/witness, payload hex/byte checks passed. |
| Canonical indexed blocks | **22,634** hash checks passed; 2,377 transaction-bearing blocks. Scope is stored indexed population, not every transaction since genesis. |
| Pending / dropped transactions | All **169 stored pending** were in both Core mempool captures; all **78 stored dropped** absent from both. Pool size changed 74,364→74,876; no complete discovery of every protocol mempool transaction claimed. |
| Relational integrity | Zero duplicate canonical event keys, duplicate active tickets/participants/references, orphan events/Mail/participants/references, parent/status/position inconsistencies or missing confirmed raw data. |
| Stored event population | 26,692 confirmed events, including **26,349 valid confirmed**; 167 pending events including 21 valid; seven dropped. Invalid/rejected history is retained and must not be mistaken for duplicates. |
| Transition continuity | **11,012** captured rows (959621–970632), no gaps, decreasing positions, hash/value/opening-commitment discontinuities or incomplete rows. |
| Mail / attachments | **633 confirmed Mail bodies** independently rebuilt from **708 PWM output rows**, zero mismatches. Seven attachment byte/hash checks passed. No bodies exported. |
| Credits / reservations | All **238** credit definition aggregates conserve balances/caps; all **439** confirmed balance rows and **1,015** Core-unspent active/sealing tickets reconcile nonnegative reservation/spendability values. Pending reservation completeness is not universally certified. |
| Sale-ticket and INCB witnesses | 1,015 accepted unspent tickets have exact 546-proof anchor value (1,013 WORK + two generic); 44 spent historical tickets excluded. All **47 INCB H−1** heights/hashes and source positions match Core. |
| Search | No duplicate keys/orphan generation; canonical effective valid confirmed count 26,349. Shared generation deltas are not independent incomplete inventories. |

The original Core comparator returns **false** on **20 previously documented optional alias assertions for ten auxiliary raw envelopes**; the exact error list matches Audit 30/31. Their authoritative raw bytes, relational canonical metadata and positions pass. Preserve this qualification rather than relabeling it corruption or a full green comparator.

Strict indexer parity: **102 checks; 99 pass, two historical inactive V5/USD warnings, one active failure** `events-cover-canonical-activity`. Independent identity reconciliation establishes its source as the new Code→Log omission below. Existing registry confirmed/pending/raw evidence/history checks and Mail/participant/reference projections pass, but the separate full native ID semantic harness again timed out at 220 seconds with no report. H24-02/Audit 31 full ID assurance remains unresolved; no empty report was interpreted as a pass.

The requested six guarantees are therefore qualified as follows: stored logging/indexing/raw-chain binding and captured relational storage pass within the populations above; global Log coverage has a proven Code omission; semantic full-ID, live physical storage, every historical numeric replay and every UI/address path are incomplete; observed pending/dropped membership is accurate at the fence and remains best effort.

## API, system logs and rendering

Five stable Caddy access files were fully parsed for the approximately October 8 13:10–October 9 13:10 UTC window: **12,404 completed API responses**, **586 HTTP 5xx (4.7243%)**, plus **1,535 interrupted status-0 requests** separately. Completed-response p95 **21.853 s**, p99 **40.895 s**, max **109.522 s**; interrupted p95 53.153 s, p99 60.382 s. The worst hour (October 9 01–02 UTC) was 30/58 completed API errors; accepted releases/holds may contribute, so no single root cause is assigned to that historical window. Current 503s independently prove remaining availability problems.

The 17-surface fresh API/asset runner completed and returned failure: five contemporaneous fresh credit/Wallet/WORK/Infinity/Inception probes returned 503; other planned probes passed. Separate browser checks observed later successful ready summaries, so failure is intermittent. The runner's default plan lacks newer Search/Code/Permission/Pages coverage; explicit in-app checks and all-22 release bytes supplemented it.

The public ledger gate stopped on `/health` 503 before a ledger verdict; the Mail regression gate stopped on registry 503 before its fixture comparisons. Marketplace's fast gate passed active/closed WORK listing truth, then timed out after 90 seconds on seller Wallet scope. These gates are **failed/incomplete**, not integrity passes. Sandbox-only DNS failures and a local comparator's initial quadratic timeout were preserved as collector failures and excluded from production outage evidence.

In-app observations covered ID, DNS, Desktop, Browser, Pages, Boost, Publish, Search, Code, Jobs, Permission, Credit, Wallet, WORK, AMO, Infinity, Inception, Log, Growth and Computer. Examples: 512 confirmed/20 pending IDs, 24 confirmed/zero pending DNS names; Browser's Welcome app confirmed with chain identity; 14 Boost feed items, three Publish articles; one confirmed Code repository; one open unfunded 546-proof Jobs offer; AMO settled with 1,015 open listings and V8 25,000-proof face. Guest write controls were guarded. No publication, reaction, app execution or financial action was exercised.

Connected account `18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa` loaded in WORK/Bonds/Computer. Confirmed WORK **0.9999997003878536** = spendable **0.9999969912983773** + reserved **0.0000027090894763** exactly at 16 decimals. Core account proofs 82,902 were shown, while UniSat UTXO reads reported network error −32603 and no spendable outputs were selected. Financial controls remained closed. At the next tip, Computer Wallet retained its verified 970633 balances with explicit **Last verified / exact-tip unavailable** labels rather than false zeros. After refresh the active AMO face was correctly 25,000 proofs; an initial hydrated legacy display is not classified as active-protocol corruption.

Computer showed three inbox/one sent records and the confirmed self-permission grant in both directions. Permission's independent authority read nevertheless failed; displaying a confirmed Mail record is not proof of current usable Permission authority. Standalone Wallet later completed connection at13:33UTC: same account and exact WORK balances,59,424wallet-spendableproofs across five UTXOs,23,478protected/unavailableproofs and43reservedlistinganchors; active25,000proofAMO face. This later success does not turn earlier failed reads into passes. Browser coverage is representative; it does not certify every address, record pagination, lifecycle, signing or transaction path.

## Math verification

**No runtime arithmetic discrepancy was demonstrated within the captured tests/populations.** Canonical Q8/Q16 integer/decimal strings were compared; approximate USD/Number presentation aliases were not treated as protocol authority. Current Core transaction values/fees and INCB oracle hashes were independently bound as above; original historical economic state was not freshly rebuilt from genesis.

Passed work: **21/21 local fixture/typecheck commands**, **22,715/22,715** independent population/summary assertions, **19,004** actual frontend/server V8 vectors (19,002 accepted, two numerical boundary rejections), plus **13** malformed-boundary assertions, **18,000** precision assertions, **5,000** independent fee vectors, the existing **1,113 rational fee cases and nine actual-source unsigned PSBT fixtures**, and **1,428** aggregate conservation/cap checks for all 238 definitions. Totals overlap and must not be added as distinct events.

Equations checked, using `S=21,000,000`, `U=10^16`, `Q=10^8`:

- V8 frozen WORK unit amount = `floor(25,000 × S × U × Q / NbeforeQ8)`; required price = integer `ceil(amountSubatoms × NbeforeQ8 / (S × U × Q))`.
- Legacy WORK Q8→Q16 = `legacyAtoms × 10^8`; no float conversion. Canonical cap `S × U`.
- INCB attached Q8 value = `floor(WORK_native_units × Hminus1_N_Q8 / (S × native_unit_scale))`; issuance = direct whole proofs + floor(attached Q8 / Q); residue is explicit dust modulo Q.
- Public WORK floor Q8 = `floor(liveNetworkValueQ8 / S)`; transaction fee = integer `ceil(vsize × feeRateQ8 / Q)` within whole-proof bounds.
- New ID registration remains **1,000 proofs**; receiver/transfer/list/seal/delist/buyer-funded and DNS mutations retain **546 proofs** where specified. Ticket principal is not sale volume; pending cannot change the confirmed floor. Code/Jobs/Pages/Permission metadata retains ordinary Mail/WORK economics once.

All **1,099 captured V8 frozen terms** and **47 accepted INCB mints** reconcile against stored exact Nbefore/H−1 numeric inputs. Six fresh public summary responses shared snapshot `e104a1c155b3742bfac48089`, 970633/hash above. Exact NQ8 **3001441607904749151453741887**; displayed N **30,014,416,079,047,491,514.53741887 proofs**; WORK floor **1,429,257,908,526.0710245 proofs/WORK**. INCB issued sum **945662401792509469** plus dustQ8 **2246190218** yields fixed cumulative value **945,662,401,792,509,491.46190218**. POWB supply **630,496,569**, value **630,501,483 proofs**, floor **1.00000779**. Confirmed WORK supply **21,000,000**, 21,000 mints, 391 holders.

Observed deployed raw/v5/v8 math, PostgreSQL Pool, Permission discovery and Permission DB reader hashes match the reviewed local files. Other accepted runtime overlays differ from local `main`; their exact hashes and deployed Log omission were independently recorded. Do not reset the node checkout to erase approved overlays merely to make Git appear synchronized.

## New findings and corrections requiring approval

| ID / priority | Source and observed discrepancy | Impact | Recommended correction |
| --- | --- | --- | --- |
| **AUD32-01 / P2** | Deployed `server/db/proof-index-reader.mjs` lines 463–510 public Log allowlist excludes Code; normalizer/query also omit it. At fixed 970633, DB has 26,349 valid confirmed events, Log 26,348; exactly event **4738015**, `pwc1:code-repository`, tx `02da093cb127fe152af0305cccbe12ceaaa52c2a57a151c84cc979e78b8bed98`, height970493/index3283/vout2/ordinal0 missing. All returned IDs/tuples match, no extras. | Confirmed repository activity is stored and shown in Code/Search but absent globally and in exact transaction history; parity fails. Companion Mail **4738014/vout1** remains present, so no payment loss/double economics proved. | Add Code event coverage to public Log/query/normalization with identity regression; preserve zero additive Code economics and Mail contribution once. No historical record rewrite. |
| **AUD32-02 / P2** | `server/permission-discovery.mjs` 49–106 uses 25 s deadline; verified prefix is saved only after full coverage. `/permissions?network=livenet&limit=1` returned **503 after 26.918 s**, matching initial/retry UI failure. At970633 it must verify142blocks; limit applies after discovery. | Current authority/read readiness unavailable. Successfully cached Core blocks survive, but failed partial prefix repeats descriptor/raw comparisons; cold restart loses memory cache. Extends existing raw-discovery availability family. | Approved hash-bound resumable progress/background catch-up; retain complete coverage, boundary/final-tip/reorg and fail-closed authority fences. No relaxed policy or record changes. |
| **AUD32-03 / P2** | Installed query-health monitor SHA `4904702aa9d16b6ef5d5e355bb2754be84c384f72ba4ac4ecc2793d211d032c8` rejects **16 sanctioned native objects** as unrelated, although all18 historical objects are placed and invalid indexes zero. | Repeating false critical storage-placement alarm after accepted native rollout. | Update exact catalog/TOAST/index closure expectations with ownership/mount/invalid checks preserved. No table relocation/drop. |
| **AUD32-04 / P2** | `server/db/postgres.mjs`18–37 creates Pool without idle error listener. Journal **57P01 unhandled error** killed API06:04:25UTC; auto restart06:04:31. PG shutdown/restart overlapped unattended OS packages06:04–06:05; PG itself was not upgraded. | Database interruption can additionally terminate API instead of controlled unavailability/recovery. Package causation is not proven. | Add sanitized idle Pool error handling/recovery and focused DB-restart resilience checks; approve source/release changes first. |
| **AUD32-05 / P2** | Mandatory `npm run check:release-sync` reached local preview and failed **ECONNREFUSED127.0.0.1:4175**. | Full release synchronization cannot currently certify preview. Remote `main`, starting local HEAD/tree and production22-surface manifest matched; separate Permission/Pages/Computer public provenance returned200samecommit/tree/trackedDirtyfalse. | Approve preview rebuild/start and repeat full gate; do not claim completed release synchronization from partial evidence. This audit performs no release. |
| **AUD32-06 / P3** | `MARKETPLACE.md:134`, `OP_RETURN_INFRASTRUCTURE.md:5853`, `SOUL.md:255` describe movement repricing at current live floor; both `work-amo-v5.mjs:4937–4963` and raw1411–1430 multiply by aggregate frozen value before deriving live N. | Prose can imply a self-referential equation to an independent implementer. Evaluators and captured arithmetic agree. | Clarify exact canonical equation/prose with approval; preserve protocol calculations/history. |
| **AUD32-07 / P3** | Required hygiene check fails on four pre-existing untracked Permission custody notes (`README.md`, `README-v2.md`, `REVIEW.md`, `REVIEW-v2.md` under `audits/2026-10-08-permission-fee-rate-capacity-custody-v1/`). Baseline status proves they predate this audit and starting inventory lacks them. | Repository hygiene cannot certify current working tree. The checker says “tracked note” but includes nonignored untracked notes; none of these files is tracked. | With approval, classify those four unchanged protected evidence notes in the inventory; preserve contents and history. No bypass or deletion. |

## Standalone Wallet investigation requested during audit

The stall is reproduced in `wallet.proofofwork.me` after human unlocking/connection approval: no address appears, Connect/Refresh/network controls disabled, “Opening UniSat…”. A later settled request showed **4001 User rejected the request**, then another direct Connect click reproduced the pending guest state at13:24:09.758UTC. By **13:33:01.257UTC** Wallet had recovered to the same address and **Credit wallet ready**. The latest observed attempt was first captured pending at13:24:09.758; the intervening provider/human completion time was not observed, so8m51.499s is the interval between captures, not a measured completed RPC duration. No browser warning/error log was captured. A rejection result is provider lifecycle evidence, not evidence that the human intentionally rejected every observed attempt.

Wallet, WORK and Computer use the same `connectWallet`. It awaits `requestAccounts` (or `getAccounts`), `getWalletNetwork`, and mainnet verification/repeated account reads **before** `setAddress`; only after that does Wallet request account-scoped credit data. Therefore the captured **no-address** stall is in the provider/authorization/network stage, and is not caused by Wallet's later balance API. Different origins can passively restore already exposed accounts while Wallet's manual request remains pending. The same underlying helper/startup paths are shared, rather than a separate Wallet provider implementation. Unlocking the extension alone does not prove that the outstanding site account request completed. [UniSat's API documentation](https://docs.unisat.io/developer-support/open-api-documentation/unisat-wallet) specifies that `requestAccounts` resolves to the current address and the connection button remains disabled while pending.

Live Wallet/WORK/Computer roots returned200 with equal security policies; released source hashes for the shared connection code match localmain. [UniSat permission source](https://github.com/unisat-wallet/wallet/blob/master/packages/permission-service/src/permission-service.ts) keys connected sites byorigin; [provider RPC flow](https://github.com/unisat-wallet/wallet/blob/master/packages/wallet-background/src/controllers/provider/rpcFlow.ts) returns no passive accounts for an unapproved origin. Those public upstream files are not a fingerprint of the installed extension. Connect-time events can trigger concurrent account/network verification in this app; their role in this delay was not proved.

There is no provider deadline or per-stage status before `setAddress`, so an unresolved provider promise never reaches `finally { setBusy(false) }`. The exact unresolved call and extension's permission/popup internals are not observable through the allowed DOM-only API. Do not claim an extension bug, CSP fault, bad chain data or a Wallet-only arithmetic defect without further evidence. This is a **recurring P2 connection liveness issue**, previously noted in the August23 audit673–695 and Audit29 remediation659–669, with new pre-address localization and eventual recovery. The source/byte review and final captured state are preserved in companions; the proposed fix needs explicit source/deploy approval.

## Previous issues rechecked

| Prior finding / fix | Audit32 disposition |
| --- | --- |
| H5-01/H8-04/H10-04/H18-08 and Audit31 capacity | **Recurring capacity risk**, new release accumulation measured; prior exact cleanup25paths still absent. |
| AUD30-01 rational fee rounding | **Remains resolved**: exact77proof result for0.28×275; rational and unsignedPSBT plus fresh independent vectors pass. |
| AUD30-02 retention namespace | **Remains resolved** namespace read-only bind; same11UI/18node historical custody absences, no new absences. Existing masks/holds retained. |
| AUD28-04 / Audit30 exact16Mail repair | **Remains resolved**: latest633-body reconstruction and seven attachments zero mismatch. Do not revive the superseded whitespace issue. |
| H24-01/AUD26-02/Audit31 Priority2 freshness | **Unresolved/intermittent**: current503s, slow proxy results, marketplace scope timeout and last-verified Wallet labels. Preserved accepted overlays/fail-closed behavior; successful coherent fresh summaries also recorded. |
| H24-02/Audit31 full ID assurance | **Incomplete** after220s semantic harness timeout. Smaller strict registry/raw/history checks pass; not full assurance. |
| Audit30/31 optional raw aliases | Same20 known auxiliary aliases on same10raws; no new canonical raw mismatch. |
| Audit31 Priority3 native/Search storage | Accepted lossless native worker/store hashes preserved; continuity and shared generation pass.40.93GB old rollback retained. New monitor closure finding separate. |
| Audit31 Priority4 recovery | Oct7 isolated logical restore accepted; latestOct9checksum/TOCpassed; threeprotectedpinsunchanged. Latest physical/offhost/fullPITR/currentset remains **unqualified**, with currentreceiverfailures observed. |
| Audit28/30 approved restore cleanup | Earlier cluster paths remain absent; receipts retained. |
| Node provenance monitor mismatch | Existing accepted-overlay family persists: actual release-health service now rejects sanctioned untracked `server/code-repositories.mjs`. Record runtime hashes; no live reset. |
| Aug23/Audit29 Wallet connection observations | **Recurring/unresolved liveness gap**, now localized beforeaddress; eventually recovered at13:33UTC. No new issue ID or permanent failure claimed. |
| Audit31 legacy ledger bond-count harness | Prior compact-mints/count false failure is historical; current ledger gate failed earlier at health. No fresh INCB count corruption claimed. |

## Actions, approval boundary and follow-up

Completed read-only checks and sanitized capture/hash preservation; no production cleanup. One agent-owned predicate output accidentally landed at an untracked root filename during this audit; baseline proved it was newly created, and it was moved to `/tmp` with identical SHA-256 (`4dfe95a35add690475f2775d340248c0771691cda26e56a5d0a15d1e3617806b`). No pre-existing file was deleted. The corrected temporary collector and relocation receipt are included.

This approved log/evidence/inventory and necessary note classification are the only intended repository edits. The required `npm run hygiene:fix` completed, removing only ignored rebuildable `dist` (13.5 MiB) and `node_modules/.vite-temp` (zero bytes). `npm run hygiene:check` returned **failure solely for the four pre-existing unclassified custody notes** listed in AUD32-07. Their contents and classification remain unchanged; fixing them needs a separate exact bookkeeping approval. The final diff whitespace check passed. These local generated removals are not production cleanup. SOUL/canonical docs, tracked notes/generated artifacts, allowlist, status and final diff were reviewed. Documentation ambiguity is documented for approval rather than silently changing protocol prose. Historical audits, ledgers, refunds, incident/recovery evidence and unrelated untracked work are preserved. No commit/push/deploy/social announcement is part of this documentation-only audit.

Recommended follow-up, each with explicit exact change/removal approval under the supplied `AGENTS.md`:

1. Before another large UI deployment, qualify and approve the exact eight-root/15-archive inventory, preserving current plus latest byte-verified rollback and unique custody evidence; or expand UI capacity. Recheck free-space reserve before allocation.
2. Resolve Wallet provider lifecycle and Permission discovery readiness; address API Pool resilience and false native monitor alarms with bounded targeted tests and release synchronization.
3. Add Code Log coverage with economic non-duplication fixtures; clarify frozen/live math equations in canonical docs without repricing history.
4. Finish the existing Priority4 recovery qualification, current full restore/WAL continuity/durable offhost/custody acceptance and approved pin promotion before retiring old backups or the native rollback relation. Do not restart stopped recovery work from this audit's authorization.
5. Approve classification of the four existing custody notes and rerun hygiene; separately restore local preview readiness and run the complete mandatory release-sync gate for any subsequent approved product release. Preserve accepted node overlays and source/hash provenance.

Residual limits: no fresh genesis replay; no original historical Nbefore/H−1 economic reconstruction; no full live PostgreSQL physical scan; full native ID semantic gate incomplete; pending discovery/reservations remain bounded best effort; no all-address/UI-pagination/signing/broadcast proof; no new full restore/rollback/PITR rehearsal; no provider billing quota verification. These gaps are recorded as assurance limits/unresolved prior work, not erased by passing aggregate fixtures.


---

## Ordered read-only continuation — 2026-10-09

**Verdict: fresh scoped data and arithmetic checks pass; availability, capacity, recovery and several existing defects remain unresolved.** All 20 requested surfaces were reviewed in the specified order, with Computer last. No additional deterministic defect is established beyond the existing finding families. New confirmed list/seal activity, intermittent Publish/health failures, the repeated Wallet delay, and changed capacity/checkpoint conditions are recorded here without duplicating issue IDs.

Preparation and prior-record review began **13:49 UTC / 09:49 EDT**; ordered browser captures ran **13:50:07–14:19:34 UTC**; the closing authoritative node read was **14:20:47 UTC / 10:20:47 EDT**. Documentation was finalized after live collection. Individual HTTP, database and node receipts retain independent clocks; this was not one atomic snapshot.

The user explicitly limited this continuation to read-only inspection and approved appending the completed results. No source/configuration, production data, database, ledger, backup, log or infrastructure change; no restart, deployment, deletion, cleanup, transaction signature, broadcast, publication or trade occurred. The human's Wallet connection reply **“connected”** was incorporated. UI navigation, queries and read refreshes were used; signing stayed local and was not requested.

### Prior review, evidence custody and source

The seven prescribed documents were reread in order and previous audit/issue records reviewed before the ordered live review. **951 existing artifact/document bindings** were rechecked. The only difference against the first Audit32 starting inventory is its already-authorized `repository-hygiene.json` classification; that configuration is byte-identical to the ordered pass's starting baseline. Original audit prose, structured evidence, compressed evidence and cleanup review were preserved.

This appendix preserves the original log's first **36,103 bytes**, SHA-256 **`6e138a2908bbf8871aac865b1e4d6386651c746f1accea8735041046ca5bb64f`**. Its new companions are `2026-10-09-production-comprehensive-health-data-integrity-audit-32.ordered-read-only.evidence.json` and `2026-10-09-production-comprehensive-health-data-integrity-audit-32.ordered-read-only-artifacts.json.gz`. The latter contains **72 safe UTF-8 artifacts**, compressed length **1,173,521 bytes**, SHA-256 **`939f6048ac469c5aef50d6c0046f47f15560c7e719d5af81389e21e0c31f0dbe`**. It includes frozen node/math/storage captures, collector sources, source/dedup reviews, curated browser observations and public HTTP metadata/projections. Private Mail and third-party article bodies are omitted. Decompress, rehash each stored artifact and verify the original log prefix plus old companions to reproduce custody. Captures must not be silently replaced with later chain state.

Local HEAD and GitHub `main` remain **`c7935dde7239836f89be27c1ee29dfbc6a585e78`**, tree **`70137cf4b831c792eeca5d2eaae21354ebed2ef9`**; the closing read-only `ls-remote` succeeded at 14:29 UTC after a sandbox DNS failure. Computer's public `/source-provenance.json` returned 200 with the same commit/tree and `trackedDirty=false`. Ten deployed node source hashes remain unchanged, including accepted overlays; six deployed arithmetic modules match the independently tested local implementations. No live overlay was reset. The full release-sync gate remains incomplete because the existing local preview is unavailable; no preview was started and no release is claimed.

### Pages reviewed in the required order

The browser record contains **69 captures**. All 19 additional host roots returned HTTP 200; Home rendered after the canonical `www` redirect. Root availability does not imply successful dynamic API readiness. Capture intervals are observations, not page-load measurements.

| Order / page | Read-only result and material limit |
| --- | --- |
| 1 — Home | Canonical redirect/render; 512 confirmed/20 pending IDs, 24 confirmed/0 pending DNS, one repository and one open job agree with fresh stored counts. |
| 2 — ID | Registration-only behavior retained; 1,000-proof registration and account ownership presentation checked. Complete full-ID semantic assurance remains unavailable as described below. |
| 3 — DNS | 24 confirmed/0 pending names; registration 1,000 and owner-self subdomain546-proof rules, owner/guest guards and namespace resolution inspected. |
| 4 — Desktop | `pages@` resolved to the canonical receiver. Zero owned files are distinguished from the separately labeled1,018-byte Welcome system reference; reference hash/tx binding agrees with the existing chain-readable object. No organization state was written. |
| 5 — Browser | Confirmed Welcome HTML/reference rendered at `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b`. Run App was not invoked. |
| 6 — Code | One confirmed Welcome repository, zero commits/files, complete970639 checkpoint. The same Code event is present in Search but still missing from Log (AUD32-01). |
| 7 — Jobs | One open, unfunded546-proof offer; zero paid proofs/WORK. Assignment, delivery and payment writes were not invoked. |
| 8 — Boost | 14 indexed records and confirmed/pending labels inspected; public API200 at 970639. No reaction or social write. |
| 9 — Publish | Three indexed articles; standalone selected reader remained loading. Article feed returned 409 `BOOST_CURSOR_CHANGED`. Computer later rendered the same confirmed article; a later detail 409 recovered to 200. Existing checkpoint-identity failure family persists. |
| 10 — AMO | Initially partial progress then complete Ready book at 970640:1,015 open listings, 238 credit definitions, 91 sales, zero displayed pending; IDs 6(3 sealed/3 unsealed), DNS 1 sealed at 10,000 proofs, bond book 1 open/0 sealed. Current WORK face25,000. Buy/Seal review controls inspected without entering a signing or purchase flow. |
| 11 — Credit | 236 ordinary credits plus two bonds reconcile to 238 definitions. DRAIN 110,000/21,000,000; 1,000-per-1,000-proof mint and 546 creation/minimum behavior checked. Last-verified versus fresh account evidence remains distinguished. |
| 12 — Wallet | Opening UniSat stalled before address, then recovered after human approval.80,069 confirmed proofs; exact WORK split, 44 account listings and 97 movements agree with scoped evidence. Fresh proof spendability/transfer readiness was unavailable and not treated as zero or authoritatively spendable. |
| 13 — WORK | 21,000,000 cap/supply, 21,000 mints, 391 holders, minted-out state and exact confirmed floor agree with the numeric snapshot. |
| 14 — Infinity | POWB 630,496,569 supply, 630,501,483 proof value, 1.00000779 floor, zero pending. Preview/book limitations remain visible. |
| 15 — Inception | INCB issued 945,662,401,792,509,469; fixed cumulative value 945,662,401,792,509,491.46190218; 47 events, zero pending. H−1 basis and incomplete book/account evidence qualified. |
| 16 — Log | New list/seal events render correctly.26,350 valid confirmed versus26,351 in database/Search remains exactly the known Code omission. Exact Code tx query returns its companion Mail only. Initial status-count staleness is an older documented UI issue. |
| 17 — Growth | Same exact network value/floor as WORK; 512 confirmed/20 pending IDs and 26,350public actions. Forecast/scenario data is explicitly not protocol authority. |
| 18 — Search | 26,351 valid confirmed corpus at 970642. Exact Code tx query yields Code plus companion Mail; confirmed repository replay qualification is shown. |
| 19 — Permission | Explicit read-budget unavailable state; `/permissions?network=livenet&limit=1` returned 503 after 29.997s. Autonomous signing/controller remains closed. AUD32-02 unresolved. |
| 20 — Computer | Reviewed last; connected account matches 80,069 proofs and exact WORK. Inbox 3/Sent 1/Incoming 0/Outbox 0 are account-specific counts, not the public 633-Mail population. Wallet refreshed from historical face 20,000 to current 25,000; exact Code Log query retained its input and returned one Mail. Confirmed article rendered; subsequent public health 503/detail 409 then recovered. Fresh spendable-proof authority still withheld on provider/read failure. |

Eleven selected surfaces had viewport/scroll width 759 px with no horizontal overflow at that viewport. This does not certify every breakpoint, pagination path, account or transaction flow. No signed purchase, seal, registration, transfer, delivery, credit mint, publication or agent authorization was tested.

### Full-node authority, storage integrity and ingestion

Opening stable Core authority: **970639**, hash **`000000000000000000015f810d5d55c954c9bcd8064a632360db56d09b6d598a`**. Closing authority at 14:20:47 UTC: **970643**, hash **`00000000000000000001bcc4aaafbed8b3991389a516f409c80972ec0fe5c01b`**. Independent 80-byte electrs header, all three Core indexes, database checkpoint and every summary key agree at the closing fence; IBD false, ready/available true and zero lag/failures. Summary snapshot **`865875641d26f900be6e5613`** published 14:19:28.764 UTC. The captured raw worker:lastRun `ok:false` in `canonical-phase-complete` is not equated with a failed worker: readiness explicitly proved current-confirmed replay, zero failures and fresh success.

| Check | Fresh coverage and result |
| --- | --- |
| Database/canonical populations | 25,993 confirmed transactions; 26,694 confirmed events including 26,351 valid; 512 IDs; 633 Mail bodies; 1,100 V8 terms. Two new confirmed transactions/events versus the first Audit32 capture. |
| Relational/population consistency | Fresh repeatable-read checks found zero checked orphan records, duplicate canonical event/active-ticket/participant/reference keys, status/position mismatches or missing confirmed raw data. Rejected historical rows are not discarded as duplicates. |
| Core raw delta | The new list `3b69cfd3519ef26ec2c8734a9360ae62043f166edda6ea8ead688afaf07503ba` and seal `fdfa52ae2911887218bd2e28eb9b7ae5fb9f957e98ff0993cccb1cfc4d472925` match Core raw bytes, positions, inputs/outputs/fees and block 970637 indices 3705/3706. Canonical block hash `00000000000000000000d0cd049d5bb277761cbfed0b4f247ddc15cbddfb34ce`. |
| Delta ingestion/status semantics | The seal references/seals the prior `12683cb6…b3992b6c` listing, whose captured lifecycle status is `sealing`; no sale/delist/closure is established. It does not seal the new `3b69…503ba` listing. New listing remains ready to seal. Do not combine the two independent events into a false UI mismatch. |
| Pending/dropped membership | All 169 stored pending transactions present and all 78 stored dropped absent in both fresh Core mempool fences. This certifies the stored sample at its fences, not discovery of every protocol mempool transaction or future membership. Confirmed totals remain separate. |
| Transitions | Fresh ordered continuity/position/hash/value tests through 970639 passed across 11,019 rows. Later counts grew to 11,023 through 970643 with no new confirmed protocol events; the small closing read is not a rerun of every continuity test through 643. |
| Mail/attachments | All 633 confirmed bodies independently rebuilt from 708 PWM rows; seven attachment byte/hash checks passed. No private bodies exported. |
| Credit balances/tickets | All 439 stored confirmed balances are nonnegative; 1,016 of 1,060 active/sealing candidates have Core-unspent tickets, and reserved sums do not exceed their confirmed balances. Fresh whole-population checks cover output existence and aggregate reservation policy; exact script/value was freshly verified for the selected new 546-proof listing anchor. AMO's 1,015 open listings and 1,016 unspent tickets describe different lifecycle populations, not a one-record loss. |
| Connected account | 49 confirmed electrs UTXOs independently checked against exact Core output scripts/values at stable 970642 total 80,069 proofs. Ownership/protected/spendable policy is separate from total unspent value; no all-address authority is claimed. |
| Database health | Closing size **54,518,709,271 bytes**; zero invalid indexes/unvalidated constraints. Live checksums remain off and no full physical page scan was performed. The large retained native rollback relation remains protected production history. |
| Full ID semantics | Fresh semantic coverage endpoint returned HTTP 503 after 90.7s (13:55:16–13:56:47), before any semantic verdict; Core advanced 970639→970640 during the request. The collector did not reach its own timeout. Earlier 220s timeout remains historical. Passing raw/registry/storage checks do not close H24-02. |

The first Audit32 whole 25,991-transaction/Core comparison and its 20 known optional-alias assertions on 10 auxiliary envelopes remain historical receipts. This continuation freshly checks the two confirmed additions, current SQL populations, pending/drop membership, account outputs and current node fences. It does **not** claim a new full raw-population or genesis replay, or a fresh independent reconstruction of every historical numeric oracle.

### Math verification and cross-application accounting

Fresh independent checks: **22,735/22,735 exact population/summary assertions** over all 1,100 captured V8 terms and 47 INCB mints; **1,428** conservation/cap/integer predicates for 238 definitions; **19,004** actual frontend/server V8 vectors (19,002 accepted, two numeric boundary rejections), **13** malformed-boundary assertions, **18,000** Q16 assertions and **5,000** independent fee-ceiling vectors. Counts overlap and are not numbers of distinct events. Eight Decimal USD checks pass within an explicit four-ULP presentation tolerance against the captured quote; USD is not canonical proof arithmetic. The earlier 21 fixture/typecheck gates, 1,113 rational fee cases and nine unsigned PSBT fixtures are **prior results on unchanged source**, not fresh reruns.

Six independently collected internal summaries share snapshot **`ba1eb2585803ab89f86413a9`** at 970639. Six later public WORK/Infinity/Inception/Growth/Log reads share **`bfc608c88526661721156c80`** at 970642 with the same economics. The latest closing 643 snapshot is independently bound by Core, but the 22,735-assertion run belongs to 639, not 643.

Using `S=21,000,000`, `U=10^16`, `Q=10^8`, exact source equations remain consistent: V8 amount=`floor(25,000×S×U×Q/NbeforeQ8)`; required price=`ceil(amount×NbeforeQ8/(S×U×Q))`; legacy Q8→Q16=`atoms×10^8`; INCB attached Q8=`floor(WORK_native_units×Hminus1_N_Q8/(S×native_scale))`, with explicit whole-proof issuance and remainder dust; public floor Q8=`floor(liveNQ8/S)`; fee=`ceil(vsize×feeRateQ8/Q)`. Canonical quantities use integers/exact strings. Pending visibility does not change confirmed economics. ID registration 1,000 and specified updates/transfers/list/seal/delist/buyer-funded/DNS mutations 546 retain their rules; Code/Jobs/Pages/Permission metadata does not add a second Mail/WORK economic contribution.

Current captured **NQ8=`3001441607904756841634671535`**, network value **30,014,416,079,047,568,416.34671535 proofs** and floor Q8 **`142925790852607468649`**, or **1,429,257,908,526.07468649 proofs/WORK**. Compared with the first Audit32 capture, N grew **76,901.80929648 proofs**; this is an observed snapshot delta, not a fresh genesis derivation. All 1,099 prior frozen V8 terms are unchanged; the new term is **174,915,946 subatoms /0.0000000174915946 WORK** with 25,000 face/minimum and committed Nbefore. Its frozen input is not replaced with today's live floor. INCB cumulative exact value and POWB values remain as above. The prior frozen/live prose ambiguity AUD32-06 remains; no runtime discrepancy was found.

Connected WORK conservation is exact: **0.9999997003878536 confirmed =0.9999969738067827 spendable +0.0000027265810709 reserved**. Proof balance changed 82,902→80,069, a 2,833-proof decrease explained by Core miner fees 794+947=1,741 and two 546 registry payments=1,092. The 546 listing anchor remains owner-held and is not counted again as a paid fee. Correct outputs/payments are chain-bound; Wallet's unavailable fresh spendability is not promoted to authority by this arithmetic.

These checks establish determinism against captured numeric inputs and deployed source hashes. Original historical Nbefore/H−1 numeric economics, every address's complete ledger, every rendered field/fee path, a fresh full-node/genesis replay and all historical forms remain assurance limits. No rounding, precision, unit-conversion or accounting defect was demonstrated in the checked populations; this is not a universal claim that math can never fail.

### Wallet connection cause and observed recovery

Standalone Wallet again showed **Opening UniSat… before any address** at 14:00:44.919 and 14:02:14.884 UTC. The human reported “connected”; by 14:03:20.418 UTC the address and matching balances appeared. **155.499s is the interval between pending/connected captures, not a measured RPC duration or human approval latency.** During the stall, its account-scoped API independently returned 200 in 3.531s. Computer also briefly waited for UniSat before connecting; evidence does not support a permanent Wallet-only extension failure.

The shared connection helper awaits account authorization/network verification before `setAddress`; Wallet's later balance request starts afterwards. The no-address stall therefore localizes to provider/account/network lifecycle. Origin-scoped permissions can leave another surface connected while Wallet awaits authorization/network verification. This is a possible explanation, not a proven cause of the captured stall. There is no provider deadline/per-stage error state. The exact unresolved RPC, extension internals and concurrent-event contribution were not observable through DOM-only inspection. Existing August23/Audit29 liveness findings remain unresolved, with eventual recovery recorded. Recommended approved work: bound and distinguish account/network stages, prevent stale/concurrent completions, provide clear recoverable status and verify origin/account/network behavior without weakening local signing. No helper or extension setting was changed.

### Capacity, logs, performance and hardening

| System | Fresh state and risk |
| --- | --- |
| UI VPS 77.42.91.106 | Available **11,789,934,592 bytes /10.980 GiB**, 70% used, 10% inodes. Only **1,052,516,352 bytes /0.980 GiB** above 10 GiB reserve and below 12 GiB warning. CPU 99–100% idle, 3,337,199,616 RAM bytes available, no swap. Caddy validates; same PID/no restarts. |
| UI allocation | Backups 19,764,543,488 bytes, scratch 2,606,075,904, live 262,369,280, cache 128,962,560, tmp 851,968 remain unchanged. Log growth 634,880 bytes accounts for the measured 634,880-byte free-space loss since the first pass. No UI database/Core/indexer was found; future fullness remains dominated by release/rollback/transport/recovery accumulation. Nested domains are not additive. |
| Node VPS 65.108.122.87 | 13:53 capture `/data` free 327,789,568,000 bytes, 82% used; root free 58,885,668,864,41% used. Both RAID arrays `[UU]`, CPU 95–96% idle, RAM 116,301,107,200 available, swap 1,246,494,720 with zero sampled in/out. Later root/cache free values are separate point-in-time samples. |
| Application/system logs | API/worker/PostgreSQL PIDs/restart counts unchanged; zero new error-priority API/PG rows in the sampled interval. This does not erase HTTP errors. Passive Caddy prefix 13:33–13:55:26 UTC:496 completed API responses, 14 HTTP 503 (**2.8226%**), plus 51 status 0 interruptions separately; parse errors zero, p95 **14.240s**, p99 **24.653s**, max **34.506s**. Different workload/window from prior 24h; no improvement trend inferred. |
| Public dynamic reads | AMO summary 200 **18.986s/4,111,083B**; compact Credit summary 200 **9.011s/1,377,594B**; account Wallet 200 **3.531s/1,655,252B**; WORK summary 200 **6.057s/1,642,201B**. Permission 503 **29.997s** and Publish feed 409 **11.729s** remain material liveness problems. Large summary payloads are performance factors, not corruption evidence. |
| Closing availability recurrence | Computer `/health` 503 at 14:19:25.670 UTC; article detail 409 at 14:19:26.151. Subsequent public health 200 at 14:20:29 and detail 200 in 2.793s; internal Core/health 200 at 14:20:47. Publication 14:19:28.764 shortly after failure supports a tip/publication readiness explanation, but the earlier health 503 body was not retained: exact failing predicate is **not proved**. Publish source does prove its complete same-network/height/hash registry identity guard. |
| Security/hardening | All 19 captured host roots passed default TLS verification and exposed HSTS, nosniff, frame restrictions, COOP, referrer/permissions policies and CSP (two expected frame-policy variants). Wallet/WORK/Computer policies agree. Caddy admin 2019 loopback, listener/config guards and 28 public cached certificates checked; all decode/unexpired. Near-expiry obsolete NFT cache entry has no current Caddy hostname binding; no served-certificate outage claimed. No keys read or active penetration test. |

Recommended performance work must preserve canonical completeness and reorg fences: reusable checkpoint-bound proofs/background discovery, narrow scoped wallet projections and bounded retry/recovery for a checkpoint change. Do not hide a failure by dropping owner proofs, reservations or required history. Idle Pool handling, sanctioned native monitor catalog closure, callback lifecycle, fail-closed authority states and alerting require approved source/configuration work.

### Storage items requiring review; no cleanup

All 25 previously approved removed UI paths remain absent; the same 11 UI/18 node historical custody absences and prune masks/holds remain unchanged. Small Audit28/30 parent receipt/socket directories are retained evidence, not a regression of previously removed database clusters.

The existing cleanup-review companion still lists **eight older rollback roots plus 15 archives**, conditionally **5,773,234,176 allocated bytes /5.377 GiB**. Root manifests/archive metadata match the first pass; archive and all-surface bytes were **not freshly rehashed** in this continuation. Candidate qualification is historical/conditional, not a new deletion decision. Preserve current release and the prior verified rollback `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-c7935dde7239-20261009T043549Z` plus both release archives. Fresh locked manifest, complete custody/dependency check and explicit removal approval are required before any cleanup.

Node logical dumps remain 19.364/20.878/27.177/27.384 GB with three protected Sep 29/Oct 3/Oct 7 pins. **Oct 7 remains the last whole isolated logical restore verified**; Oct 9's prior checksum/TOC pass does not replace a restore. The stopped52.742 GB restore cluster, 40.933 GB native rollback relation and protected replay roots remain held. Temporary/cache/source directories were inventoried, not declared disposable solely by age. No backups, notes, logs, caches or temporary files were deleted.

Background WAL status improved to `fresh-wal` / `wal-durable-base-qualification-required`, publication-lag report 246.372s and running receiver with unchanged 20 historical restarts. **CurrentRecoverySetUsable=false, historicalPhysicalRestoreQualified=false, pitrCertified=false**, historical certificate missing and base timer inactive remain. No independent archive object/durable custody/new full restore/PITR rehearsal occurred. Existing Audit31 Priority 4 remains unqualified; the last verified backup cannot safely be retired yet.

### Previously reported issues rechecked and new conditions

| Existing finding | Current disposition; no duplicate finding |
| --- | --- |
| AUD32-01 /P2Code→Log | Unresolved. Same sole event 4738015 omission; fresh DB26,351 vs Log 26,350, no extra/more missing events. Code/Search contain it; companion Mail 4738014 remains. |
| AUD32-02 /P2Permission discovery | Unresolved. Same budget failure, now 29.997s 503; complete coverage required before limit. Preserve prefix/reorg/authority checks in any approved fix. |
| AUD32-03 /P2native monitor | Unresolved. Same installed monitor rejects 16 sanctioned native objects; 18 historical objects placed and invalid indexes zero. No relocation or monitor change. |
| AUD32-04 /P2 idle Pool | Unresolved source gap. Same Pool without idle error handler; no further crash/restart in this sample and no disruptive restart test. Prior57P01 crash evidence retained. |
| AUD32-05 /P2release preview | Unresolved. Preview 4175not listening; fresh remote/static provenance agrees. No preview restart or full release gate claimed. |
| AUD32-06 /P3math prose | Unresolved documentation ambiguity; fresh arithmetic agrees. No protocol repricing or prose change. |
| AUD32-07 /P3note classification | Unresolved. Read-only hygienecheck again fails solely for the same four pre-existing Permission custody notes. No classification edit or fixer. |
| AUD30-01fee rounding | Remains resolved; exact0.28×275=77 and fresh integer-ceiling/source vectors pass. |
| AUD28-04/Audit30 Mail repair | Remains resolved; fresh633-body/seven-attachment reconstruction passes. |
| AUD30-02namespace/cleanup | Remains resolved within unchanged holds/binds; same historical absences, no new removals. |
| H24-01/AUD26-02/Audit31Priority2 | Intermittent availability unresolved; new503/409 and later coherent recoveries both retained. `BOOST_CURSOR_CHANGED` already documented in Audit23/Audit25. |
| H24-02full ID assurance | Still incomplete; fresh coverage endpoint503 after 90.7s, with Core advancing during the request. No unavailable response counted as a semantic pass. |
| Audit31native/Search/provenance | Accepted source overlays and generations preserved; sanctioned untracked module still triggers old provenance-monitor mismatch.40.93 GBrollback remains held. |
| Audit31 Priority 4recovery | Fresh WAL progress materially updated, but current recovery/PITR acceptance still false; historical Oct 7 acceptance is preserved. |
| Aug23/Audit29Wallet | Repeated pre-address liveness failure, eventual connected recovery, exact unresolved RPC unknown. |
| Audit19/27/28Log count banner | Same silent refresh leaves status text stale while counts update. Initially26,370 status vs26,372 cards then settled. Already documented; no new P3. |

One standalone Log transaction query appeared to reset after submission. Its source/callback cause was not localized, existing read-state fixtures pass, and the later Computer query retained the exact input/result. Record this **unreproduced observation**, not a deterministic new regression. Initial undeclared `/api/v1/source-provenance`404 was a collector endpoint mistake corrected to the documented static path; it is not a product finding. Storage-lane temporary filenames containing `audit33` belong to this appendix and do not create an Audit33 issue set.

No new production data correction is justified by the captured arithmetic/storage results. Newly observed conditions extend existing findings: two canonically confirmed events and exact balance delta, updated checkpoints/capacity, repeated pre-address delay, Publish checkpoint409, and WAL progress without recovery qualification.

### Actions taken, approval requirements and next steps

Completed ordered browser/API reads; internal Core/electrs/database/indexer checks; OS/capacity/log/retention checks; independent exact arithmetic and source-hash reviews; prior-record deduplication; sanitized evidence custody and this approved append. Existing source, canonical docs, ledgers, protected evidence, final diff/status and cleanup allowlist were reviewed. No product, configuration or production modification was made.

For **this read-only continuation**, `npm run hygiene:fix` was deliberately **not run**, honoring the user's explicit prohibition on cleanup/configuration changes. Read-only `npm run hygiene:check` again reports only the four unchanged unclassified Permission custody notes in AUD32-07; no bypass or classification was applied. Final append-prefix/parent/artifact hash and diff checks are recorded in the structured companion. The previous section's first-pass local generated cleanup is historical and did not recur here. No commit/push/deploy/release announcement is part of this audit.

Recommended work, each requiring separate explicit approval of the concrete source/configuration/data/removal scope:

1. Correct Code→Log coverage without duplicating Mail economics; bound/resume Permission proof discovery and Wallet provider stages; add controlled idle Pool error recovery and targeted resilience tests.
2. Address checkpoint-transition API/Publish availability and excessive summary transfer work using complete reusable checkpoint-bound evidence; retain fail-closed identity, ownership and reorg checks.
3. Protect UI capacity before another large deployment: approve exactly qualified redundant release roots/archives or expand disk; retain current plus latest verified rollback and unique evidence. Add allocation-aware reserve gates/alerts and log growth monitoring. No general age-based cleanup.
4. Complete full-ID semantic verification and existing recovery/PITR/durable custody qualification before retiring protected backup pins, restore clusters or native rollback history. A newer dump alone is insufficient.
5. Correct sanctioned monitor catalog/provenance expectations; clarify exact frozen/live math prose; classify the four existing notes and restore local preview readiness only with approval. Run full release-sync for a subsequent approved release, preserving runtime overlays.

Residual assurance limits remain explicit: no fresh genesis or full old raw-population replay; no independent original historical Nbefore/H−1 numeric reconstruction; no full live physical PostgreSQL scan; full ID semantics incomplete; pending discovery best effort; no all-account/UI-page/signing/purchase proof; no fresh full restore/rollback/PITR; no provider billing/quota verification. Passing scoped checks and recovery at a later tip do not erase these limits or the observed failures.

## Computer performance, data efficiency and interface audit — 2026-10-09

This appendix follows the completed first and ordered read-only Audit32 passes. The user's latest authorization is a **read-only audit/proposal**, with findings returned in the conversation before this completed appendix is saved. No product improvement, code/configuration edit, production data change, deployment, restart, cleanup, commit, push or announcement is authorized by this appendix. Proposed changes below require separate approval.

### Scope, source and measurement custody

Audit began **2026-10-09 14:41 UTC /10:41 EDT**. Source and deployed production artifacts identify commit **`c7935dde7239836f89be27c1ee29dfbc6a585e78`**, tree **`70137cf4b831c792eeca5d2eaae21354ebed2ef9`**. The existing Audit32 prefix is **66,461 bytes**, SHA256 **`e031d3c4a1ff1fba9fff4cf6838e7cd69c0b23f9af8a5d079128422575b5186b`**. It is preserved byte-for-byte, as are prior companions and unrelated source/working changes. Audit close time and final bindings are in this appendix's structured companion.

SOUL, README, IDs, Marketplace, infrastructure and Mail documentation were read in the requested order; DNS was already reviewed in the preceding audit. AGENTS, repository hygiene, source, package/lock scripts, Vite/TypeScript configuration, browser configuration/tests and data/readiness contracts were inspected. Prior Audit25–28/PERF-27, UI/UX history and Audit32 issue lineages were reviewed and rechecked; this appendix extends existing families rather than assigning duplicate issues. Source bytes, graph estimates, actual network body bytes, fixture timings and live UI observations have separate assurance labels.

Two verified **existing deployed production builds** were copied to temporary local custody for inspection and existing tests; no rebuild/install/source edit was made. Twenty-one live root provenance receipts match the released source. Chrome lab runs used installed **Chrome155.0.8059.39 /Playwright1.61.1**, Node22.23.3, Linux x86_64, Intel i5-10210U1.60GHz, four cores/eight logical CPUs. One worker ran each bounded three-repeat case. No CPU/network throttle was set. Observed host load during the AMO lab was5.61/4.75/3.31, so these are shared-workstation diagnostics, not an isolated device benchmark. Lab viewports were desktop1280×720 and mobile390×844; mobile changed only viewport, not hardware, touch, device scale or user agent.

Live CUA inspection used the user's existing in-app browser, with uncontrolled cache/network/CPU and engine version unavailable through supported tools. Standalone desktop/mobile entries were inspected before the integrated Computer. Temporary viewport overrides were restored. DOM/resource inventories are snapshots, not completed request counts, waterfalls, LCP or interaction measurements. No private Mail body, credential, signature, seed/private key, raw browser failure trace or API response body is copied into durable performance evidence.

### Actual application and loading map

| Boundary | Current surfaces and dependencies |
| --- | --- |
| Direct lazy standalone roots | Home, Boost, Publish (delegates Boost), Search, Code, Jobs, Permission; internal social identity bridge is a source/build boundary, not a separate audited user page. |
| Shared App standalone roots | ID, DNS, Desktop, Browser, Pages, AMO/Marketplace, Credit, Wallet, WORK, Infinity, Inception, Log, Growth. These load App and its static read/protocol/signing dependencies. Marketplace alias remains the same product family. |
| Computer fixed folders | **27**: Inbox, Incoming, Sent, Outbox, Drafts, Favorites, Archive; Pages, Files, Desktop, Browser, Boost, Publish, Search, Code, Jobs, Permission; IDs, DNS, AMO, Credit, Wallet, WORK, Infinity, Inception; Log; Contacts. Custom folders are additional local state. **Growth is standalone, not a Computer navigation folder.** |
| Deferred Computer features | Boost, Publish, Search, Code, Jobs and Permission have lazy component boundaries. Pages, BrowserWindow and AdvancedDNS are statically imported; ECC initializes on App module evaluation. Source: `main.tsx:13`, `App.tsx:3,293,308,38863`, `routeRegistry.ts:232`. |
| Shared state/contracts | Header/account, navigation/status, API/error/read-state, exact amount/fee arithmetic, complete registry/reservation/capacity/fresh signing preflight, Mail/attachment verification, registry/DNS, local drafts/contacts/folders/recovery, global CSS and fonts. Component/module extraction must preserve these authority and local-state boundaries. |

All20 standalone product surfaces were reviewed: Home, ID, DNS, Desktop, Browser, Code, Jobs, Boost, Publish, **Pages**, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, Growth, Search, Permission. Computer was inspected last, including Desktop/Browser/Search, connected/disconnected shell, Mail/Drafts/Contacts navigation and20 repeated workspace switches. Entry and guest/loading states are substantial but not every populated workspace, transaction state or supported browser. Mail items were not opened to avoid changing local read flags; reader latency remains unmeasured here.

### Baseline scorecard and limits

| Area | Current evidence and result | Assurance |
| --- | --- | --- |
| Initial shared App JS | Computer static dependency closure **1,389,379B decoded**, CSS175,295B; offline gzip9 estimates375,745B JS/29,380B CSS. Wallet analogous1,389,336B JS. | Current production graph, excludes fonts/images/API; not a full browser wire measurement. |
| Home entry | Static closure218,079B JS/173,795B CSS; offline gzip9 estimates72,887B/29,364B. Live Home observed12-script entry sample, versus18 on App-backed entries; standalone Search6. | Phase-dependent asset inventory; does not establish all downloads completed or were necessary. |
| Actual production transfer | App chunk904,289B decoded →**233,558B gzip**; crypto198,589→62,182B; React159,329→53,700B; global CSS163,373→29,845B.33 sequential HTTP/2 GETs across11 assets (three each), all200/SHA-matching;11 conditional reads304. App elapsed1.013–1.103s, TTFB.435–.455s. | Workstation HTTP diagnostics; neither a browser waterfall nor LCP. Caddy already uses gzip and one-year immutable hashed assets. |
| Fonts/media | Typical Home captured3 Latin fonts85,252B;14woff2 font-face declarations plus fallbacks do not mean all fonts download. `font-display:swap`/Unicode ranges exist. Home WebP31,760B, overview video click-to-load. | Inventory/one Home lab sample. No image/LCP conclusion from the flawed cache harness. |
| Home cold/warm lab | Five existing repeats: **one test gate passed, four failed; zero isolated-fixture passes**. One mixed loopback-static/live-API pair:17 hashed assets, cold482,226 ResourceTiming transferB, warm0; FCP112/48ms, readiness4.746/8.619s. | Compiled absolute API base escaped fixtures; image path returned HTML. Keep failures and sample, but do not average successful sample into a valid baseline, infer cache-caused readiness regression or call this live WebVitals. |
| AMO large-data lab | **24/24 completed tests passed**, three repeats×1k/10k×standalone/Computer×desktop/mobile. Each has first/repeat navigation, complete-snapshot gate, exact5/50 non-fresh pages,25 rendered rows and exact last-record searches. | Existing production Computer assets on loopback HTTP/1.0,20ms API fixture delay, route interception disables HTTP cache. Standalone route is rendered from Computer build, not AMO host build. |
| Live geometry/labels |20 standalone desktop/mobile entry samples had no document horizontal overflow, missing alt or unlabeled visible native input, and no sampled native/role button below44px. Computer exposes44×36 Create-folder control. | Entry snapshots omit inline-link/summary/populated state coverage; not WCAG certification. |
| Keyboard/reflow | Mobile More Enter moves focus inside; Shift+Tab/Tab wrap and Escape restores More. Computer shell reflows at320CSSpx; short390×480 Browser shell avoids document overflow. | Manual navigation and viewport tests. Actual200/400% browser zoom, screen-reader speech and all-workspace contrast are not verified. |
| Repeated navigation/retention |20 Inbox/Drafts/Contacts/Browser switches: same-workspace DOM returned within3nodes; no document overflow. Browser resets target/tabs on leave. | Small DOM soak; no post-GC heap/listener/performance evidence. Source maps have no capacity bound; a memory leak is not established. |
| Field performance | No usable RUM/fieldp75 evidence was provided or obtained. LCP, INP, CLS field status **unknown**. No new full Computer LCP/long-task/event/heap traces. | No field pass inferred from fixture/HTTP tests or past Lighthouse. |

The approved future field targets remain **p75 LCP≤2.5s, INP≤200ms, CLS≤0.1**, segmented mobile/desktop. [web.dev Core Web Vitals](https://web.dev/articles/vitals) (updated2024-10-31, accessed2026-10-09) distinguishes field experience from lab diagnosis. The new lab search duration includes Playwright fill/assertion and browser work; it is **not INP**. Missing field evidence does not mean no field data exists externally.

### Repeated AMO timings and data-read cost

Numbers are median **[min–max] milliseconds**, n=3 per phase. “Repeat” is process warmth with cache disabled. These are production-asset **fixture** diagnostics; current production API/chain readiness is independently qualified in preceding Audit32. Source assertions passed before interpreting timings.

| Viewport / route / records | First readiness [range] | Repeat readiness [range] | First/repeat search median |
| --- | --- | --- | --- |
| desktop /computer /1,000 | 1654 [1162–1835] | 1104 [1076–1363] | 105/111 |
| desktop /standalone /1,000 | 1398 [1364–1689] | 1044 [1038–1227] | 95/83 |
| desktop /computer /10,000 | 4370 [3825–4377] | 4033 [3758–4978] | 302/213 |
| desktop /standalone /10,000 | 3872 [3721–4148] | 3674 [3647–3944] | 239/527 |
| mobile /computer /1,000 | 1486 [1450–1561] | 1139 [1120–1698] | 165/103 |
| mobile /standalone /1,000 | 1052 [952–1364] | 981 [969–1028] | 79/77 |
| mobile /computer /10,000 | 4332 [3827–4439] | 4663 [4363–6472] | 354/266 |
| mobile /standalone /10,000 | 3487 [3332–3535] | 3172 [3098–3307] | 466/122 |

The fixture intentionally returns200 records/page.1k requires5 non-fresh pages and10k50; every checked phase rendered25 rows. Those page counts are not the whole network: Computer1k phases captured13–24 finished API requests and0–5 fresh listing pages; Computer10k69–77 requests and9–17 fresh listing pages by the end of the sampled navigation/search phase. Fresh and non-fresh are separate authority identities; do not deduplicate them by ignoring freshness. Whole fresh passes may still be unfinished when the attachment is sampled. Across48 completed phases, the listener captured2,020 finished fixture API reads, including1,320 non-fresh listing pages and256 additional fresh pages. Existing refresh orchestration serializes an in-flight cached refresh then a required fresh refresh (`App.tsx:29420`); these observations do not prove concurrent complete-book downloads or authorize dropping fresh checks.

Ten-thousand-record first searches were sometimes above200ms in the driver-inclusive lab (Computer desktop median302ms, mobile354ms), while repeated edits were generally faster but variable. This supports further profiling, not an INP failure or proof that sorting is the root cause. Sort is already memoized before query filtering and25-row paging (`App.tsx:53680`). Each50-page fixture has at least1s of nominal20ms/page delay, with serialization/event-loop/other reads beyond that; subtracting1s cannot accurately isolate frontend CPU. API transfer bytes, parsing, server query latency, indexing delay and browser long tasks need separate instrumentation. Log already pages50 rows. Virtualization is therefore not the first corrective recommendation.

The initial all-case desktop invocation ended143 without a complete JSON report, with unknown external termination cause and no recorded assertion error in available trace events. It is **incomplete**, not a pass or application failure. Bounded exact-case retries produced the24 complete passing cases. The Home lab separately escaped44 first-party production API reads:24 known200 and20 cancelled/incomplete/status0; server completion is not inferred for the latter.

### Ranked existing concerns and new findings

Prior structural/readiness concerns remain under **PERF-27-01/02**, with current measurements; no duplicate issue numbers are created for them. Effort is planning estimate, not a delivery commitment. All savings below are estimates unless explicitly measured. Rollback means a separately approved scoped revert/release with mandatory synchronization, preserving node overlays and canonical/local records.

| Priority / lineage | Reproduction/evidence, impact and root cause | Proposed change, benefit, confidence/effort/risk | Validation and rollback |
| --- | --- | --- | --- |
| **P1 existing PERF-27-01 — eager App** | Open guest Computer/Wallet/WORK/Browser.18 scripts/current graph1.39MB decoded; App904,289B and eager crypto62,182B gzip observed. App61,210source lines,17,415-line controller, static Pages/Browser/DNS/ECC coupling. Source size is not downloaded size. Increases passive startup/evaluation and maintenance coupling. | Extract one measured low-coupling read feature and signing-only imports after dependency attribution. Preserve verifiers that need crypto. High coupling confidence; speedup unmeasured. Medium/large effort, medium/high risk. No rewrite or framework upgrade justified. | Same-build/profile cold/warm bytes, parse/long-task/useful-data and first-signing-interaction tests; all freshness/math/sandbox checks. Verify removed startup work is eliminated or intentionally paid once on first use. Roll back scoped extraction commit. |
| **P2 existing PERF-27-02/read-containment — idle/obsolete reads** | Connected-account effects `App.tsx:26508–26816` install60s/focus cycles independent of visibility/workspace. Eligible UTXO fallback/enrichment `19642` repeats same HTTP loader alongside account effect. Log helper16326 and market activity53462 discard late results but omit caller abort; WORK/Growth delayed fresh timers27326/27429 are not cleanup-owned. Header legitimately needs some account data. | Visible-loop scheduling, one resume catch-up, cleanup-owned controllers/timers, exact same-key consumer deduplication; preserve provider-curated spendability. Eliminate app-scheduled hidden cycles and obsolete work. High source confidence; actual live idle bytes/frequency unmeasured.2–4days estimate, medium lifecycle/authority risk. | Hidden/focus/leave/disconnect/network tests, no overlap/late commits, body/retry abort and independent consumer cancellation. Same-key excludes different fresh/network/address/scope/snapshot. Fresh signing/admission never paused or reused as display cache. Roll back helper/orchestration commit. |
| **P2 existing PERF-27-02 — wide inventory** | `fetchWalletOwnedTokenListings`25793 hydrates complete global book17580 then filters owner/token; AMO29362 intentionally checks all200-row pages before Ready. Current large fixture50 pages/25 visible rows; earlier Audit32 actual global vs owner populations provide context only. | Later complete owner-scoped projection and server exact-order/search display paging with counts/coverage/Core/pending proof. Potential work scales with relevant scope; no proportional byte saving promised. High source confidence; backend benefit unmeasured.1–2weeks estimate, high completeness/reorg/accounting risk. | Core-backed same-snapshot parity, totals, reservations, listing/seal/legacy/cutover/pending/reorg fixtures and large-case wire/query tests. Never replace complete reservations with capped preview. Retain complete audit path. Roll back endpoint/client version together. |
| **AUD32-08 /P2 assurance — flawed Home measurement harness** | Existing `responsive-layout.spec.mjs:4046–4096` serves all non-assets as index.html. Copied build's `proofApiClient` compiled absolute production origin bypasses loopback API fixture;1/5 gates,0/5 isolated passes. Performance conclusions from that harness would be unreliable. | Correct public-file/MIME serving, fail missing assets properly, assert every intended fixture API request is isolated, collect readiness/assets/paint/interactions separately. Cache-sensitive run must avoid interception that disables cache: use explicitly labeled same-source lab production build with empty same-origin API base and bind config/build hashes, alongside unchanged live asset diagnostics. High evidence confidence;1–2days, low product risk. | Zero unintended external reads; valid WebP MIME/SHA; cold/warm resource byte checks;5 complete repeats; explicit LCP/event/long-task/heap scope. Revert tests/helper only. This is a test defect, not a production data defect. |
| **AUD32-09 /P2 source — post-broadcast receipt modal** | `MarketplacePurchaseReceiptModal`, App3072–3207 and mounts37331/39298, declares `role=dialog aria-modal=true` in ordinary section/div, without focus placement/trap/inert background/Escape/return lifecycle. Production purchase was not broadcast. | Reuse native shared ReviewDialog, neutral **Close** wording, stable surviving return target and unchanged exact receipt/tx links. High source confidence; runtime/AT impact unmeasured.0.5–1day, low/medium focus risk. | Fixture-only standalone/Computer mocked post-broadcast receipt: initial focus, Tab/Shift+Tab, Escape, Close, inert background, focus return, short/narrow layouts. Existing pre-signing reviews remain Cancel. Roll back modal adaptation. |
| **AUD32-10 /P3 observed — Create folder target** | Guest/connected Computer at1440×900 and opened390×844 More: button44×36, computed min-height36. `styles.css:1840` specificity overrides global9270; form grid track1831 is36px. JSX App38071 is already labeled/native. Newly localized miss in existing44px family, not recurrence of fixed nav-folder buttons. | Make local action track/button44px and add desktop/open-sheet geometry cases. High live/source confidence;≤0.5day, low localized layout risk. Product44px requirement is stronger than AA24px minimum. | Computed ≥44×44 desktop/mobile open/short sheet with usable folder field/focus; relevant responsive tests. No folder creation/removal needed in production. Roll back CSS/test only. |
| **AUD32-11 /P3 observed — Browser navigation lost** | Load canonical Welcome tx until Verified confirmed HTML, select Contacts, return Browser: empty query/New tab. Reproduced15:06:29UTC. Conditional mount App38863; BrowserWorkspace39995 local query/page and BrowserWindow31 local tabs are destroyed on leave. Adds task repetition/refetching, not chain corruption. Prior docs do not mandate clearing navigation on leave. | Retain bounded navigation-only metadata outside unmounted view (existing12-tab cap, explicit history bound), preserve network/query/target/title/index, abort and discard HTML/runtime/permission on leave; reverify on return. No hidden active iframe. High reproduction/source confidence;1–2days, medium sandbox/network/lifecycle risk. | Welcome→Contacts→Browser restores targets, refreshes proof, remains static; no app resumes, no provider bridge, network/account/reorg/unavailable tests. Keep local drafts/contacts/folders untouched. Roll back navigation-state adapter. |
| **AUD32-12 /P2 source+fixture — outspend body deadline** | Actual `fetchTransactionOutspend`, App19810 clears timer19847 before JSON await19850. Actual-source in-memory mock:20ms deadline, body still pending/signal not aborted at50ms. Shared API10/10 deadline gate does not cover this bespoke helper. No production body stall observed. | Keep outspend timeout active through body consumption and add caller cancellation if scoped, retaining current exact payload/non-OK/fail-closed behavior. Finite wait prevents stalled seal/signing checks; no bypass or speedup measured. High control-flow confidence;≤1day, medium admission/error-semantics risk. | Header/success-body/error/caller stall fixtures against actual helper, existing spend/fresh preflight/reservation tests; unavailable never zero or spendable. Do not extend timeout/authority validity. Roll back transport-only change. |
| **P3 capacity/maintainability, hypothesis** | Block-index promise map1901/3009 and Log history cache22680/22763 retain successful entries without session entry/byte budget.20-switch DOM test is stable but not a heap test. CSS9,690lines has duplicate root tokens and override specificity; no evidence all old small declarations are computed failures. Repo workflow inventory has hygiene only; external CI is unknown. | Measure post-GC/query soak, then bound historical display caches retaining current-visible/last-good state; gradually extract shared components/tokens where actual regressions support it. Add approved offline browser smoke to existing CI. No numeric memory savings or wholesale CSS purge. High source confidence, practical severity unmeasured; later phased work. |20-switch/query/large-history heap+listener+DOM soak, eviction/refetch/reorg/case-sensitive-key fixtures, visual/a11y snapshots. Preserve canonical DB/evidence/drafts and transaction authority. Revert scoped cache/style/CI changes separately. |

[W3C modal dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) (accessed2026-10-09) supports focus containment, inert background, Escape and focus restoration. Existing [native dialog](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) is broadly supported; reuse the repository primitive rather than add a new modal library. [WCAG2.2 Recommendation2024-12-12](https://www.w3.org/TR/2024/REC-WCAG22-20241212/) and [target-size AA guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) establish24px with exceptions; this audit does not mislabel36px as an AA violation. [Reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) calls for320CSSpx-equivalent reflow, with applicable two-dimensional-content exceptions. Existing200% root-font test is not actual browser zoom.

### Canonical correctness, math and existing fixes

The preceding Audit32 full-node/state reconciliation remains the live-chain baseline. This performance supplement **does not rerun genesis history, every ledger/address, current Core/mempool state or every hard-function declaration**. App displayed Search coverage through970647 with26,351 results; that observation is not new independent full-node certification of those records. The Welcome static preview was verified by the application's chain-reading path and matches the previously audited canonical tx. Synthetic AMO fixtures exercise current complete-snapshot acceptance logic but are not real transactions or current chain inventory. No signing/broadcast/purchase/Run-app execution occurred.

Five current source/fixture gates passed: client-read containment43assertions, in-flight request pool, surface read-state, UI contract, H19 WORK capacity12cases. Ten further existing gates passed: shared API client10cases, fee1,113 independent decimal rational vectors plus9 unsigned actual-source PSBT fixtures, active Q16/immutable Q8 contract,131 historical Q8 checks, V8 arithmetic, V8 admission gates, canonical UTF-8 order,8 send-prep UTXO fixtures, exact bond arithmetic and wallet refresh. Initial API loopback gate could not bind under sandbox; the identical authorized rerun passed10/10. This was an environment receipt, not an application test failure. The outspend mock is a **positive reproduction of a defect**, not proof its current timeout behavior is correct.

Preserve: active WORK Q16=`10^16` subatoms/WORK, exact legacy Q8 conversion×`10^8`; integer-string/BigInt arithmetic; integer fee ceiling and dust, separate registry/seller/ticket/miner terms; ID registration1000 and mutations546; frozen V8 committed pre-action N and canonical height/index/vout/ordinal order; INCB H-1 snapshot/frozen issuance, POWB issuance, one economic contribution per carrier; historical replay and cutovers. Capped previews never replace complete reservations/capacity; unavailable/partial never means zero. Confirmed remains canonical and pending provisional. Display cache readiness never grants signing permission: fresh funding, reservations, mempool bounds and admission must be rechecked before and after signature. Browser content remains isolated from wallet authority.

Request/cache identities must preserve network, raw address including Base58 case, wallet/asset/scope, query/page/opaque cursor, projection, height/hash/commitment, freshness and pending authority as applicable. Historical display-cache eviction must not evict canonical data, protected sale tickets, proofs or local state. Pause only **idle display/account work** while hidden; never weaken an explicit active signing/preflight operation. [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) (accessed2026-10-09) supports explicit hidden-state scheduling; browser timer throttling alone does not satisfy a zero app-scheduled idle-cycle contract.

Prior PERF-27-03 lazy refunds,05 initial Log request fix,06 media overlap dedup and07 wallet presence poll fixes remain closed under inspected source/gates. Native ReviewDialog, roving segmented tabs, focus-visible/reduced-motion rules and mobile More focus behavior remain present. No broad new UI redesign is justified. Obsidian/parchment/brass/olive identity, Inter/Space Grotesk/IBM Mono, exact-value inspection, honest loading/error/empty/last-verified states and shared navigation should be refined component by component. Solid default text token contrasts are adequate in reviewed source calculations; this is not a full computed/interactive/disabled/high-contrast AA matrix. Improve task continuity and control reliability before changing the visual identity.

Existing Audit32-01 Code→Log omission,02 Permission discovery readiness,03 monitor false alarm,04 Pool resilience,05 preview synchronization,06 math prose and07 custody classification remain their existing issues, not duplicate performance findings or implicitly resolved by synthetic timing passes. The field/browser/AT coverage limits recorded previously remain open. Source-only gates do not certify browser behavior, and completed fixture browser gates do not certify production API readiness.

### Phased decision and exact first implementation scope

**Highest-value first batch proposed for separate approval: bounded read lifecycles and reliable measurement, plus the isolated folder-target regression.** Estimated3–5engineering days including measurements/review; high confidence in source defects, medium confidence in user-visible performance benefit until comparison. No server, protocol, record, ledger, backup or retention change is included. The source-bound test scaffolding and lab build configuration must identify its difference from the deployed absolute-origin build; unchanged production wire receipts remain separate.

| Exact file | Proposed approved change |
| --- | --- |
| `tests/browser/responsive-layout.spec.mjs` | Correct cache-test public asset/MIME handling, enforce fixture origin isolation, add Computer cache-aware/useful-data/resource/interaction diagnostics and desktop/open-mobile folder geometry coverage. Keep AMO complete-source assertions and warm-process qualification. |
| `tests/browser/performance-fixture-server.mjs` (new) | Bounded loopback-only fixture/static server and safe measurements, missing asset404, explicit API isolation guard; no external wallet or production API calls. Use this exact helper boundary for reviewable test isolation. |
| `playwright.ui.config.mjs` | Explicit opt-in performance profiles/output/production-build provenance, without changing default live destinations or installing/upgrading browsers. Record desktop/device/network/CPU/cache configuration. |
| `src/App.tsx` | Apply cleanup-owned visible account/display read scheduling; propagate caller abort through UTXO/Log/market readers and own WORK/Growth delayed refresh; coalesce only identical HTTP UTXO evidence via existing pool; keep bespoke outspend deadline through JSON without changing its authority semantics. |
| `src/shared/api/useVisibleReadLoop.ts` (new) | Minimal visible/focus/resume scheduler with no overlapping automatic cycle, deterministic cleanup and one visible catch-up; no cache validity or protocol policy. |
| `src/styles.css` | Only custom-folder form track/button≥44px; preserve field usability and existing identity. |
| `scripts/check-client-read-containment.mjs` | Extend actual-source/helper fixtures for caller/body/retry cancellation, obsolete context and outspend deadline. |
| `scripts/check-surface-read-state.mjs` | Extend lifecycle/readiness contract assertions, never substitute source checks for measured browser behavior. |
| `tests/browser/computer-read-efficiency.spec.mjs` (new) | Offline mocked connected/disconnected hidden/resume/leave/account/network/coalescing cases and independent consumer cancellation; fresh signing and unavailable/provenance behavior preserved. |
| `README.md`, `MAIL_ORGANIZATION.md` | Document explicit benchmark scope/commands and display-read lifecycle behavior; review canonical docs without changing protocol rules. |

Acceptance: **zero new app-scheduled idle cycles while hidden**; one automatic catch-up on becoming visible, no overlaps/obsolete commits/timers; last-consumer HTTP abort stops body/retry work; same-key overlap uses one HTTP evidence read while distinct network/address/fresh/scope/checkpoint stay separate. Provider-curated spendability must remain unchanged, and raw API outputs never replace it. Existing complete-book/reservation/fresh admission/math/funding gates pass. Outspend header/body stall rejects within the configured deadline without making unknown spend-state usable. Create folder≥44×44 in desktop/open mobile/short layouts with focus intact. No production mutation occurs in tests; no unnecessary library/framework change.

Measurement acceptance: fixture-only tests issue zero unintended external requests, image bytes/MIME are real, copied/live and same-source lab-build hashes/config are explicit, five comparable cold/warm repetitions finish and include all failures/variability. Compare baseline/candidate under the **same** profile, snapshot/dataset, cache, CPU/network and browser; collect JS/CSS/font/image/API bytes separately, completed/aborted/duplicate request counts, useful verified data, LCP/CLS/event timing, long tasks and idle traffic. Keep first signing/preview interaction in the comparison so deferred cost is visible. Do not impose a numeric speedup before this baseline exists.

Quick independent follow-on: fix the receipt modal using `App.tsx`, `shared/components/ReviewDialog.tsx`, scoped `styles.css`, `mail-compose.spec.mjs` mocked receipt flow and responsive fixture. Next targeted refactors: Browser navigation-only state (`App.tsx`, `features/browser/BrowserWindow.tsx`, bounded session-navigation helper and existing Browser security/behavior tests); one measured workspace split using current [React lazy](https://react.dev/reference/react/lazy) capability supported by installed React18; consolidate bespoke transport only with unchanged authority semantics. Larger optional work: complete owner projections/server paging, measured display-cache limits and component/token extraction, then evaluated offline CI/AT/browser matrix. Workers, prefetching, virtualization, new state libraries and React/Vite upgrades require demonstrated benefit against startup, first interaction, memory, correctness and ongoing maintenance costs. No full rewrite is proposed.

Any approved implementation must review SOUL/canonical docs/final diff, preserve unrelated working changes, run relevant source/browser/containment/freshness/math checks, compare identical before/after profiles, then run **hygiene:fix/hygiene:check** within its approved scope. A release must satisfy mandatory GitHub/main/primary checkout/local preview/production source synchronization and accepted node-overlay provenance before announcement. Rollback is the exact prior release/approved scoped revert, not database/history restoration. Receipt, Browser and server projection changes can each ship/revert separately.

### Proposed budgets and keeping Computer fast

These are **provisional product/regression budgets**, not measured field passes or guaranteed savings. The current decoded-graph baseline supports immediate non-regression caps; actual full-route compressed wire/request budgets must be bound after corrected cache-aware measurements. Avoid arbitrary universal DOM/memory ceilings without a representative fixture/device baseline.

| Route/profile | Initial guard/proposed target | Requests, interaction and retention |
| --- | --- | --- |
| Home | JS decoded graph≤229kB (+5% current); CSS≤183kB. Later target≤100kB compressed entry JS and≤35kB CSS, preserving used fonts/media and truthful registries. | No unnecessary video request, no identical completed summary read for one refresh generation, genuine warm immutable-asset transfer0 where cache permits. Public counts projected separately from complete action authority. |
| Passive Computer/App-backed surface | JS decoded≤1.459MB, CSS≤184kB until targeted split; later proposed compressed entry JS≤300kB, CSS≤35kB, separately budget first signing/preview chunks. | No asset/request growth>5% without review; no signing-only initialization before need when read verifiers can remain intact. Exact request baseline first. |
| AMO | Current complete fixture5/50 non-fresh pages and25 DOM rows. Candidate same-condition readiness/search median≤baseline, worst-case regressions>10% investigate; optional optimization goal1k≤1.5s,10k≤3s under this fixture only. | Lab fill→correct result goal≤200ms is separate from field INP. Count required fresh pages separately; no cap that drops complete inventory. Later server display page proposed≤50rows/250kB decoded, with complete scope/proof and separately measured authoritative evidence. These byte targets need actual payload baseline and parity review. |
| Search/Log/Mail/Files/Desktop | Search25/Log50 row boundaries retained; lazy attachment/file bytes only after a user read requires verification. Per-fixture sort/search/page/preview target≤200ms after data availability, excluding separately measured API/chain verification. | No obsolete-result body/parse work when last consumer leaves; correct query/network/wallet/snapshot keys, active request concurrency bounded to dependency needs. Media's current concurrency4 is already deliberate. Mail reader budget needs a safe representative fixture, not private-item navigation. |
| Connected/hidden/long session | Zero app-scheduled idle cycle or new background transfer after existing bounded in-flight display work is cancelled; visible routine account refresh at most one coalesced60s cycle plus legitimate event/focus/explicit reads. | Fresh signing/preflight is explicitly exempt from idle caps and always current.20-switch/query post-GC growth proposed≤max(10MB,10%) over equivalent settled baseline, no monotonic listener/DOM retention; not yet measured. Current-visible/last-good display evidence must survive cache eviction. |

For every approved UI/release change: fast offline source/authority and affected keyboard/geometry/freshness tests; changed-route production-build browser profiles including repeated cache states and representative0/1k/10k datasets, long addresses/txids/Q16 values, missing/partial/pending/reorg snapshots, stale API/error/body stalls, drafts/local storage/recovery and sandbox containment. Broaden tests only when changes/failures justify it. Keep browser/package versions, captured medians/ranges and acceptance thresholds in a reviewable baseline.

Propose a monthly performance/accessibility/browser-support review and an additional review when major workspace/chain-population/dependency changes occur; no scheduled automation was created. Review actual200/400% zoom,320CSSpx reflow, keyboard/focus/announcements with a real screen reader, reduced motion/contrast and explicitly supported Chrome/Firefox/Safari/WebKit versions. Repository's configured browser suite is Chrome-only and root-font200% differs from browser zoom; optional axe/dev tooling needs approval and manual false-positive review. Field/RUM collection/export needs its own approved privacy/operational design. Dependency changes are evaluated compatibility/security/performance changes, not automatic modernization.

### Storage review, actions and approval boundary

Current build graph identifies16 old alternate chunks/~1.286MB per inspected Computer/Home root that are not reached by current literal dependency graph. Logical repeated assets across served roots total23.70MB, but unique-content/hardlink custody means physical savings are not inferred. Favicon/logo logical images are1.24MB each but are not shown downloaded on entry. No CSS coverage report certifies unused selectors or icons; a font declaration is not an unnecessary request. These are **review candidates**, not proven safe deletions. Old open sessions, deferred chunks, rollback verification and historical/recovery evidence must be checked before any separately approved retention change. Prior backup/capacity findings stay in their prior Audit32 sections. No cleanup, cache eviction or backup/log retention change occurred.

Actions were read-only source/runtime inspection, copied existing production artifacts to temporary audit custody, bounded read-only HTTP asset diagnostics, existing offline/loopback tests, safe evidence custody and this authorized appendix. No code/config/inventory/source documentation changes, production data/records/ledgers/backups/logs/infrastructure changes, installation/rebuild/restart, signing/broadcast, commit/push/deploy or public announcement. Temporary lab servers were closed without deleting evidence. No improvement is implemented by a proposal.

**hygiene:fix is not run**, honoring the user's prohibition on cleanup/config changes. Read-only hygiene:check and final append-prefix/source/artifact/status/diff checks are recorded in the structured companion; the existing four AUD32-07 custody-note classifications remain unresolved. The completed findings were returned in the conversation before appending. Any product/source/config/server/cleanup/release action needs a separate explicit approval of its concrete scope.

### Approved next batch — implementation and release-admission review, 2026-10-09

This supplement follows the user's explicit approval to implement and ship
Permission catch-up, the two browser-fixture repairs and clickable `.pow` links
across Boost and Publish, including tests, documentation, hygiene, controlled
deployment, synchronization and announcement. It records implementation and
pre-release evidence; it does **not** certify an unperformed deployment. The
released baseline is `d8ae8220d897f876d85b0025db86306dc27e6fe5`. See
`audits/2026-10-09-audit32-next-reliability-candidate.evidence.json` for scoped
source hashes, private execution receipts, original failures and qualifications.

**Existing AUD32-02:** Permission discovery now retains process-local progress
only after a whole canonical block's raw carriers have been compared against
Core and its independently calculated public/private witness chains agree.
Retries recheck network, activation parents, target/prefix height and hash,
compact index descriptors, row flags and native storage commitments before
resuming suffix Core comparisons. Identical checkpoints coalesce; other targets
serialize under their original admission deadlines. Partial catch-up, expired
pending hydration and incomplete exact-tip coverage cannot return authority.
Projection/cache limits, final index/Core/fee-parent fences and public witness
semantics remain intact. There is no persistent marker, schema migration or
background service. Cold restarts still require catch-up; retries still repeat
compact metadata verification, and an individually slow reconstruction can
exhaust the unchanged budget. Production convergence remains a release gate,
so the existing availability finding is not yet marked resolved.

Fresh read-only installed definitions for
`proof_indexer.work_transition_metadata_v1(jsonb)` and
`proof_indexer.read_work_transition_payload_v1(text,integer,text,jsonb)` exactly
match the accepted native SQL bodies and function attributes. Both descriptor
commitments remain in compact metadata. The source-bound primary Permission
gate passed six backend/controller entrypoints and 35 signing cases; an
independent peer reran reader/discovery/API cases and reviewed native witness,
deadline, queue, reorg, cap and result-cloning behavior. This is compatibility
and regression evidence, not certification of every grant or chain record.

**Approved navigation improvement:** bare ASCII root names and one-level child
names, including `www.armyofyouth.pow`, link from Boost posts, replies, quotes,
reboost originals and exact verified Publish bodies to standalone Browser on
the selected network in a separate tab. Original source characters, article
UTF-8 length/hash and literal article tags/mentions remain intact. Emails,
existing URLs, code regions and invalid/partial names remain literal. There
are no display-time DNS/preview reads; link styling asserts no registration or
resolution. Browser's independent confirmed resolution, static sandbox and
existing explicit Run app boundary are unchanged. No signing or authority is
derived from social text. No new dependency, CSS redesign or protocol change
is included.

The original Boost fixture now opens the existing Search view before filling
its field; the Desktop self-send response now binds its existing mailbox to
the address/network. Browser validation uses the compiled production build,
Chrome, loopback `127.0.0.1:4180`, two workers, no retries and the existing
production-build opt-in. Across six specifications, **117 unique cases passed**:
26 Boost, 21 Publish, 18 Permission, 34 Browser DNS/page-containment, 15 surface
read-state and three Computer read-efficiency cases. The initial 114-case run
retained six failures in the new popup fixtures: correct URLs/requests were
observed, but assertions ran before popup navigation committed. Exact URL
waiting repaired the fixtures without weakening assertions; all 47 Boost/
Publish cases and three read-efficiency cases then passed with zero skips.
These mocked fixtures do not prove live API readiness, field Web Vitals, actual
screen-reader operation or real transaction signing.

An untouched capacity-boundary fixture initially refused because its historical
v3 surface tuple omitted Jobs, which the current provenance guard requires.
Necessary test maintenance adds only Jobs to that tuple; production helpers,
reserves and every fault/assertion remain unchanged. Original failure evidence
is preserved. The repaired full capacity gate passed 11 capacity cases and seven
actual helper boundary checks; this is not a live deployment capacity GO.
The production build, affected Boost/Publish/read-containment/surface/UI source
gates and 68 UI controller cases passed. The initial sandbox build's Git
subprocess refusal is preserved separately from its successful authorized
production-build rerun. Hygiene cleanup removed only allowlisted local `dist`
and an empty Vite cache after preserving the released local build; hygiene
check passed. No production storage cleanup occurred.

The final DNS-only parser benchmark records four exact 100,000-byte inputs,
five warmups and 30 samples each on Node22.23.3/Linux/i5-10210U with eight
logical CPUs and no artificial throttling. With concurrent browser work,
p50/p95 were mixed15.83/33.04ms, dense15.97/27.38ms, fenced9.41/23.24ms and
unbroken-prefix2.79/5.30ms. Source reconstruction matched exactly. Raw samples,
input/source hashes and shared-CPU qualification are preserved; these are
lexical diagnostics, not browser rendering or field speed claims. The change
eliminates avoidable repeated scanning and adds no eager DNS work; a general
startup speedup is not claimed.

At the fresh bounded full-node baseline, Core blocks/headers and all three
indexes were synchronized at970705, IBD=false, unpruned, with a loaded mempool.
Opening and closing hash was
`0000000000000000000103c370a06600166531f6131989a2fac5d64823b09478`.
The known Code/Mail transaction
`02da093cb127fe152af0305cccbe12ceaaa52c2a57a151c84cc979e78b8bed98`
reconciled transaction position, outputs, carrier/event identities and
uniqueness against Core/database: Code contributes0 proofs, companion Mail
contributes546 once. Five bounded public probes returned HTTP200. Broader
previous math, field/browser and historical-replay coverage gaps remain their
existing findings; no fee, ledger, historical record or protocol math changed.

**Existing capacity finding, materially changed deployment condition:** the
fresh UI preflight observed11,530,080,256 available bytes, with unchanged
10GiB+64MiB floor10,804,527,104 and only725,553,152 bytes of headroom. Six
protected rollback roots and their canonical archive/sidecar dependencies
remain intact. Scratch allocation was2,869,706,752 of5,368,709,120 bytes.
This baseline is not a GO for new input, staging, full live-root copying,
source publication or new canonical archive extraction. Exact committed
22-root bundles and **every** native phase must admit before any production
mutation. Prior release sizes are planning seeds only. No backup retirement,
retention-hold exception, reserve reduction or infrastructure expansion is
included in this batch's approval.

Current production remains the prior release. Any eventual completion must
have fresh reviewed node overlay pins preserving accepted native changes,
controlled UI publication, Core-backed Permission convergence, affected live
surface checks, actual GitHub/clean primary-main/local-preview/production
`check:release-sync`, and one verified announcement with the required cashtags.
If capacity refuses, preserve the candidate and original evidence, document a
concrete additional capacity proposal and obtain separate approval; do not
upload inputs, restart production or announce an incomplete release.

### Next reliability batch: approved capacity preparation, 2026-10-09

The human subsequently approved the exact additional
[capacity recovery proposal](2026-10-09-audit32-next-reliability-capacity-recovery-proposal.json).
Its four named complete rollback roots and four original archives are distinct
from the previously completed four-root recovery. The approval permits complete
off-server custody and independent original-owner restoration, a bounded scoped
hold exception, tested temporary recovery controls, and only the minimum qualified
oldest-first retirement needed for unchanged native release gates plus the
specified margin. Current release, newest two rollback pairs, all sidecars,
original failures, policies, live data and native safeguards remain protected.

The [authorization receipt](2026-10-09-audit32-next-reliability-capacity-authorization.evidence.json)
records the fresh read-only preflight: all live, six-root, native-helper and
managed-surface bindings remain identical to the approved baseline. GitHub main
and the tested feature candidate remain unchanged. The proposal and all fourteen
input pins were verified. These are preparation facts, not custody, retirement,
deployment or release-completion evidence. Temporary source/fault reviews and an
exact clean successor build precede the first custody invocation and its single
four-hour clock. Actual closing receipts must distinguish these dated pending
states from subsequent actions; original evidence is never rewritten as success.
