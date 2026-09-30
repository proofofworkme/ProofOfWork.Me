# Production health and data-integrity audit 28

Audit date: **2026-09-29 America/Toronto (EDT)**. Production observations began around **19:25 UTC / 15:25 EDT** and continued through the final Desktop check around **19:46 UTC / 15:46 EDT**. This continues the existing audit sequence; “FIRST AUDIT” is the user's name for this request, not a reset of prior findings.

## Scope, authority and result

Read-only inspection covered both production VPSes, Core and its indexes, Electrs, the indexer worker, PostgreSQL, public/internal APIs, event/search/mail projections, credit conservation, exact protocol arithmetic, mempool status, application rendering, logs, backups and storage retention. Required operating/protocol documents and previous audit/repair records were reviewed first. The user explicitly authorized this audit log. Its evidence companion and required note-inventory classification are part of that handoff.

**Result: do not treat the entire application as green.** Core, Electrs, canonical index and summaries were synchronized; complete indexed transaction/block reconciliation and the existing strict parity/event gates passed. A new deterministic DNS authorization-comparison defect makes a valid confirmed seal invalid in the relational event index and absent from public Log, while DNS and its value overlay accept it. DNS checkpoint coverage and the DNS surface-audit validator also need correction. UI capacity has regressed severely under the already documented storage issue.

No production files, configuration, services, database records, protocol history, ledgers, evidence, backups or caches were deliberately changed or deleted. No transaction was signed/broadcast, no refund was sent, and no commit, push or deployment was performed. Routine read requests can populate application caches and observation logs. Local repository hygiene is separately recorded below.

Evidence: [audit 28 receipts](2026-09-29-production-comprehensive-health-data-integrity-audit-28.evidence.json). It includes sanitized results, exact SQL, the read-only Core reconciliation procedure, previous audit SHA-256 bindings, checkpoint receipts, backup verification and exact UI retention inventories. Credentials, private keys and private mailbox bodies are excluded. Large historical migration preimages and repetitive firewall logs are intentionally not copied into the repository.

### Versions and predecessor binding

- Local HEAD/UI source: `0e767c69e785945110a53092415894a4eab70d12`.
- Node/API checkout: `d2c0afaffd9cd723fa99c02a6de6b86fe50a0be6`.
- UI release: `0e767c69e785-20260929T165314Z`, deployed `2026-09-29T17:13:22Z`; source tree `e6fe8d40533caa0149d0ca0955a609682337aa09`.
- Latest rollback root: `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-0e767c69e785-20260929T165314Z`; its **contained release is d2c0afa**, `d2c0afaffd9c-20260929T161019Z`. The directory's `pre-0e767...` name identifies the cutover it precedes, not its contained commit.
- Closest predecessors: [audit 27](2026-09-28-ordered-read-only-application-audit-27.md), [audit 26](2026-09-27-production-comprehensive-health-data-integrity-audit-26.md), [audit 24/25](2026-09-26-production-comprehensive-health-data-integrity-audit-24.md), [approved follow-ups](2026-09-26-approved-followups-1-8-execution.md), and [wallet/pending-INCB repair](2026-09-27-wallet-pending-incb-repair.md). Same-day DNS launch/fix commits were also inspected.

## Host health, capacity and growth

Bytes below are measured allocated/free bytes, not quota or theoretical reclaim totals. `df` use percentages exclude reserved filesystem blocks; public API percentages may therefore differ.

| Measurement | UI VPS `77.42.91.106` | Node VPS `65.108.122.87` |
| --- | --- | --- |
| Root size | 39,973,924,864 B | 105,089,261,568 B |
| Root available | 11,119,513,600 B final | 71,866,122,240 B initial |
| Root used / `df` | 27,170,217,984 B / 71% | 27,837,652,992 B / 28% |
| `/data` size / available | No application database on this host | 1,764,768,071,680 B / 472,933,277,696 B; 74% `df` |
| Root inode use | 9%; 208,102 / 2,427,136 | Low; `/data` 1% |
| RAM total / available | 4,005,457,920 / 3,374,682,112 B | 134,125,752,320 / 118,788,694,016 B |
| Swap | None | 981,204,992 B used / 17,179,865,088 B |
| Sample load | Approximately zero | 1.19 / 1.06 / 1.19 |
| Journal / all logs | About 351 MB / 724 MB | About 1 GB / 1.34 GB |

Caddy, bitcoind, Electrs, API, indexer worker and PostgreSQL were active; sampled primary service restart counters were zero. Mempool API/web/database containers were healthy. Node RAID1 arrays had both members present (`[UU]`). Sampled physical network interfaces had zero receive/transmit errors or drops. Cumulative traffic since boot was approximately UI RX 1.316 TB / TX 0.169 TB and node RX 1.347 TB / TX 11.425 TB; these are **not provider billing-period usage or quota checks**.

No large deleted-open file explained current storage use. Kernel warnings were dominated by firewall blocks; reviewed output did not show an OOM, filesystem I/O error or corruption signal. Caddy's current-day error-priority journal had no entries. API observations did contain the temporary fresh-wallet 503 responses discussed below. Old failed one-shot units remain mixed with current monitoring failures; a failed-unit count alone does not mean the main application services are stopped.

### UI: regression under H5-01 / H8-04 / H10-04 / H18-08

This is an existing storage issue with a new, directly measured regression, not a duplicate new ticket. Audit 26's older UI sample had approximately 30.2 GB available; this audit has **11.12 GB**. PostgreSQL still resides on the node. The UI's current pressure is deployment/rollback accumulation, not a newly discovered UI database.

- `/var/tmp/proofofwork-deploy`: **11,089,637,376 B**.
- `/var/backups/proofofwork-ui`: **11,326,816,256 B**, including rollback roots **4,629,962,752 B**, release archives **4,529,553,408 B**, recovery evidence **1,570,279,424 B**, and cleanup evidence **168,919,040 B**.
- `/var/www`: approximately **233 MB** allocated with hardlink sharing. Summing independently measured descendants can double-count shared allocation.
- `/tmp`: approximately **580 MB**; logs are much smaller than deployment scratch.
- There are **17 complete rollback roots** and **113 immediate deployment-scratch entries**. Their paths/sizes and rollback manifests are in the evidence companion.

At 19:01 UTC the storage monitor reported **383,115,264 B above its 10 GiB reserve**, with approximately **9.29 GB/day** net consumption over one historical day. Final reserve headroom was **382,095,360 B**, about 364 MiB. Its 3,561-second reserve forecast assumes that bursty deployment consumption continues; it is not a reliable time-to-full estimate. A modest staging/build/archive burst can cross the reserve now.

The release-prune timer is **enabled**, superseding the prior audit's disabled-timer observation. Its latest run failed with **“Refusing retention with more than one complete-root UI rollback.”** The previous run encountered a busy deployment lock. The protective refusal prevents unsafe pruning but also leaves retention unable to bound growth. Storage trend reports `critical`, and deploy scratch exceeds its 8 GiB critical-review threshold.

**Recommendation:** prioritize an approved bounded cleanup before further sizeable UI staging, retain the current verified release and exactly one verified rollback, and repair the workflow that keeps creating unclassified rollback/scratch generations. Do not merely raise the reserve threshold, bypass the retention refusal, or delete evidence.

### Node: AUD26-01 remeasured, H24-04/H24-06 still open

The measured `/data` one-day net consumption was about **2.88 GB/day**, not audit 26's short-window extrapolation of roughly 96 GB/day. At that rate, approximately 127 days remain above a 100 GiB reserve; root's monitor estimated approximately 3.32 GB/day and 18 days above its reserve. These are conditional historical rates, not guaranteed runway. Further replay, backup or deployment bursts remain material.

Largest allocated consumers:

| Path | Allocated bytes | Classification |
| --- | ---: | --- |
| `/data/bitcoin` | 979,395,457,024 | Live full-node data; preserve |
| `/data/electrs` | 64,273,788,928 | Live address index; preserve |
| `/data/proofofwork-postgres-tablespaces` | 36,935,671,808 | Live database; preserve |
| `/data/proofofwork-incb-final-source-replay-20260925T022000Z` | 89,525,575,680 | **Running PostgreSQL process**; not stale simply because old |
| `/data/proofofwork-incb-final-source-replay-20260924T143604Z` | 32,853,667,840 | Replay provenance/dependency review required |
| `/data/proofofwork-incb-production-backup-20260927T082400Z` | 20,256,141,312 | Repair rollback backup; approval/provenance review |
| `/data/proofofwork-incb-scoped-rehearsal-20260927` | 20,162,818,048 | Repair rehearsal; dependency review |
| `/data/proofofwork-postgres-backups` | 19,371,266,048 | Latest logical backup plus small evidence |
| `/data/proofofwork-release-backups` | 10,136,240,128 | Excess release retention; H24-04 |
| `/data/proofofwork-recovery` | 3,910,983,680 | Recovery material; preserve pending review |
| `/data/mempool` | 2,115,596,288 | Live service data |
| `/data/proofofwork-api-cache` | 172,699,648 | Small relative to replay/backup storage |

The release monitor verified 12/12 archives at its scheduled 04:28 run but warned about 13 `/opt` release checkouts. More same-day releases followed; inventory contains 19 normal managed release archives plus older out-of-pattern material. The August `operator-review-opt-checkouts-20260820T184500Z.tar.zst` alone is 5,783,619,456 B. Preserve it until provenance/remaining dependencies are settled; age is not authorization to remove it.

## Database health and integrity

PostgreSQL 16 database `proof_indexer`: **37,514,181,655 B**. `work_amo_block_transitions` accounts for **36,262,068,224 B**, approximately **96.7%**. Snapshots are about 673 MB, events 157 MB and transactions 107 MB. Growth is concentrated in transition evidence, so any compaction policy must preserve replay/verifiability and receive approval.

- No invalid/unready indexes or unvalidated constraints found; zero recorded deadlocks. Autovacuum activity was present. No sampled long-running blockage demonstrated a current database outage.
- Data checksums remain **off** (previously reported H18-06). Null checksum-failure counters are not proof of physical integrity. Installed extensions include `plpgsql` and `pg_stat_statements`; no `amcheck` extension was installed by this audit.
- Cumulative temporary-file statistics were about **2.147 TB / 225,620 files**. This is lifetime query I/O, **not 2.147 TB currently occupying the disk**.
- No replication slots were found; current protection is the documented logical-backup workflow. No new PITR outage is inferred from historical PITR retirement.
- Latest retained dump set: `/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset`; dump **19,363,782,935 B**. Fresh low-priority checksum reads verified both dump and globals, and `pg_restore -l` succeeded. The scheduled job retained this set and removed the previous verified set before this audit. This audit did not perform that removal.
- Catalog/checksum verification is not a fresh isolated restore test. No new restore instance, tablespace, extension, repair or physical page scan was created on production.

### Complete indexed-object structural checks

Sample-bound inventory: **26,069 transactions** (25,821 confirmed, 170 pending, 78 dropped); **26,683 events** (26,508 confirmed, 168 pending, 7 dropped). Confirmed valid relational events: **26,166**. These scopes intentionally differ from public actions and supplemental visibility records.

Read-only aggregate checks over the full indexed set found zero orphan events/participants/references/mail parents, parent/status mismatches, missing canonical block proofs or scan markers, confirmed position omissions, nonconfirmed block metadata, invalid credit numeric values, and credit balances lacking definitions. Confirmed inputs/outputs matched stored raw transaction data exactly, including output value/script and input prevout/sequence. All confirmed JSON raw hex was present and matched Core; 248 nonconfirmed rows lack JSON raw hex. The separate optional `raw_hex` column is sparsely populated and is not the canonical JSON-hex evidence source.

Event keys are unique. **78 shared source-position groups are not 78 duplicate transactions**: they comprise sale/closure pairs, a seal/closure pair, invalid-event/detail pairs, and historical ID compatibility interpretations. Exact classes/counts are retained in evidence. Do not delete those groups merely because positions repeat.

The `file_attachments` table currently has zero rows. Embedded files/message-body HTML are present in mail payloads and render through Computer/Browser; an empty attachment-materialization table alone is not evidence of lost files. This audit verified stored transaction bytes against Core and a rendered confirmed HTML sample, not independent reconstruction/checksums of every embedded file.

## Chain, ingestion and mempool reconciliation

Core 31.1.0 was unpruned, out of initial block download, verification progress 1, with no warnings. txindex, coinstatsindex and basic-filter index were synchronized. Sample connectivity: 124 peers (114 inbound / 10 outbound). Mempool was loaded, optimal, about 79,190 entries / 42.9 MB transaction bytes / 236.7 MB memory against a 2 GB limit. The sequential reconciliation observed 76,492 mempool entries later; a moving count is expected.

Independent sequential Core reconciliation checked **all 26,069 indexed transaction IDs** and **all 21,193 stored canonical block hashes**, with zero canonical-confirmation/block-hash errors. All 25,821 confirmed transaction JSON hex values agreed with Core. All 170 indexed pending transactions were in the captured live mempool; all 78 dropped transactions were absent. Before/after Core tip was stable at **969192**. This establishes observed membership for indexed records, not complete discovery of every possible protocol event in the entire global mempool.

Initial common checkpoint: **969191**, hash `0000000000000000000053f2537bd898d2aa128b8dcb4e5f02893e419eb262d6`, snapshot `8cb44709e3b56348709e81cf`. Final health receipt: Core, Electrs, canonical index and all eight summary coverage keys at **969192**, hash `000000000000000000004512347a7b16e76717d129f8ee71c7805113d07a32e9`, snapshot `668fa64e2c6021652dca130c`. Ready/available true, lag/ahead zero, rebuild inactive/complete, empty canonical fault, zero worker consecutive failures, no active containment and no reported unresolved pending protocol events.

Strict production-runtime parity audit: **102 checks**, exit 0, no required failure. Two non-required warning checks concern historical inactive V5 migration/quote-head behavior; preserve their historical interpretation. Production event audit: **49 checks**, exit 0. Their green result does **not** cover the new DNS discrepancy below.

The exact production ID registry audit also completed: **588 fetched transactions, 565 confirmed / 23 pending covered, 538 lifecycle events, 508 winners, 21 pending candidates, six active listings and four canonical sales**. Core-ordered lifecycle replay parity passed. It reported 17 existing refund candidates and two pending duplicate watch entries; no refund decision or ledger rewrite was made. The run took several minutes, so H24-02's sensitivity/latency concern remains despite successful completion.

## Exact arithmetic and protocol checks

Local deterministic suites passed for bond arithmetic, V8/V6/V5 WORK AMO rules, WORK precision v2, fee-rate precision and canonical ordering. API truth/live-data/UI/growth/INCB repair/read projections/client-read containment contracts passed. Local Node was 22.23.2; production parity/event/ID audits used pinned Node **24.18.0**. Local normalization tests do not replace the production Unicode-version authority.

Independent integer checks also established:

- **All 25,821 confirmed transaction fees:** sum(inputs) minus sum(outputs) was nonnegative and exactly matched both raw fee and stored `fee_sats`; zero discrepancies.
- **All 236 generic credit definitions including WORK:** confirmed minted quantity equals aggregate balances after the documented WORK subatom conversion; zero conservation errors and zero cap violations. WORK supply is exactly **21,000,000**, stored as **210000000000000000000000 subatoms**, with 387 holders.
- **POWB:** confirmed supply **630,496,569** equals confirmed Infinity proof issuance; connected account holds 546. INCB/POWB `max_supply=0` is the uncapped marker, not a zero-supply violation.
- **All 47 canonical INCB mint records:** recomputed attached WORK Q8 value from exact recorded amount/unit scale and H-1 network value, whole-proof issuance, direct-plus-attached value and dust. Zero arithmetic errors. Issued **945662401792509469 INCB**, fixed issuance **94566240179250949146190218 Q8**, retained dust **2246190218 Q8 = 22.46190218 proofs**. Recorded value-snapshot heights are H-1. This independently verifies arithmetic over recorded canonical inputs; it does not independently rebuild each historical H-1 network value from genesis.
- **9,571 transition rows**, heights 959621–969191: contiguous previous-height/hash linkage, complete/block-atomic/fee-once/invalid-zero flags, no opening-value mismatch or value decrease. The one opening state-commitment discontinuity is at **960601**, the documented V8 migration boundary. These are evidence/linkage checks, not independent execution of every historical transition.
- WORK, Growth and ledger exact value agreed at **1452083490330680135585252463 Q8 = 14520834903306801355.85252463 proofs**. Displayed WORK floor equals integer Q8 division by 21,000,000: **691468328728.89530265 proofs / WORK**. Approximate numeric/USD/chart fields are display projections, not settlement inputs.
- DNS overlay explains the difference from raw transition closing value: `(23 × 1000 + 2 × 546) × 5 = 120460` weighted proofs, hence **12046000000000 Q8**. Public DNS registry flow is 23,000 proofs, mutations 1,092, sale volume zero. This is a documented separate overlay, not unexplained ledger drift. Its relational validity discrepancy remains a real defect.

The comprehensive audit does not certify all historical protocol mathematics solely from passing tests or stored flags. It establishes the above complete-set checks and identifies the concrete deterministic failure below. A full independent historical replay and isolated physical restore remain follow-up work.

## Rendering, APIs and previously reported regressions

HTTP shell/asset checks succeeded across all 15 surfaces, including DNS. The surface harness reported **14 passed / one DNS failed** because it uses the wrong DNS count schema (AUD28-03), not because DNS was inaccessible.

In-app browser inspection covered Home, IDs, DNS, Desktop, Browser, Boost, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, Growth and Computer. UniSat was connected for permitted read-only account inspection. Observed account: `1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH`.

| View | Result / limitation |
| --- | --- |
| Home / IDs | 508 confirmed IDs, 21 pending; Home DNS count 23. ID registration fee 1,000; registration-only surface retained. |
| DNS | 23 confirmed names, one active listing; public accepts the seal discussed below. |
| Wallet / Computer | Initially 1,092 confirmed/spendable proofs, two UTXOs, 546 POWB. Later Computer retained verified balances but reported unavailable fresh spendability; existing fail-closed read issue reproduced. |
| Computer mail / Files | 23 Inbox, 11 Sent, one Outbox. Header still labels one dropped-only Outbox item “UNCONFIRMED” (AUD27-01). Files shows three including welcome HTML; header excludes welcome and shows two, as previously explained. |
| Browser | Welcome tx `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b` rendered verified confirmed HTML, 1,018 bytes, SHA-256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`, agreeing with the prior raw-byte proof and current Computer. |
| Desktop | Public lookup returned three files. Its synthesized welcome HTML showed 1,017 bytes and a different hash; see AUD28-04. |
| Boost | Seven records rendered with confirmed labels. |
| AMO | Eventually Ready at checkpoint 969192: 238 credits/bonds, 955 confirmed listings, 89 sales, six ID listings, one DNS listing. Complete loading was delayed; generic status copy sometimes continued “verifying”. |
| Credit / WORK | Directory and exact WORK supply/holder/floor values rendered after loading. |
| Infinity / Inception | Bond pages rendered; Inception shows 47 points and exact fixed supply/value. Initial incomplete previews/loading are not asserted to be complete inventory. |
| Log / Growth | Exact network value/confirmed totals rendered; selected Log status copy retained an older action count than its cards. DNS seal search returned zero despite DNS accepting it. |

Full marketplace regression **eventually passed**, including delist, fresh summaries, sealed listings, sales, wallet and Log closure checks. It made 102 GET requests, observed **10 HTTP 503 responses** and 11 convergence waits; do not erase temporary failures because the eventual test exited successfully. Full mail regression passed. Existing H24-01 / AUD26-02 and PERF-27 large-read/readiness concerns remain. These multi-tab browser observations are not controlled latency benchmarks.

## New findings

### AUD28-01 — P1: DNS seal validity depends on object property order

Confirmed seal **`dd498455bb712411341cfde6fab38764281ff6b77076a41012c3bee768475e38`**, block **969136**, transaction index **3156**, protocol vout **1**, for **`4.pow`**, listing **`a2f613500e807eb8907dad7762303c81fdd386ce1d1d3ce0e27f8d50c7a706bd`**, price **10,000**, mutation fee **546**:

- Public DNS activity says `dns-seal`, confirmed, `valid=true`; the listing includes its seal.
- Relational event says `dns-seal-invalid`, `valid=false`, reason **`work-amo-v5-dns-seal-invalid`**.
- Public Log exact-txid search returns **zero** matches.
- Independent shared validator check: sale-ticket signature **valid**; seller present in inputs; listing/anchor txids match; both signed and unsigned authorization parsers accept; **authorization equality returns false**.

**Source:** `server/work-amo-v5.mjs:1824`, `workAmoV5DnsSaleAuthorizationsMatch`, serializes objects after blanking optional signature/anchor fields. Signed parsing inserts those optional properties earlier; unsigned parsing omits them and normalization appends them later. `JSON.stringify` preserves insertion order, so equivalent normalized field values compare unequal. `server/work-amo-v5-raw.mjs:2689` applies that comparison to the signed/unsigned pair and rejects the seal.

**Impact:** raw/relational replay and public DNS disagree on a confirmed protocol event, public Log omits it, and green aggregate parity gives incomplete assurance. Raw transition evidence excludes DNS base accounting while the public overlay counts both mutations; that separation does not excuse inconsistent validity. Future DNS seal/settlement paths need targeted verification.

**Recommended correction, approval required:** compare an explicit, fixed-order canonical set of unsigned economic fields, preserving every signature, ownership, expiry and anchor check; add property-order/signed-versus-unsigned tests and DNS database/public/Log coverage to parity gates. After code validation, approve a narrowly scoped derived DNS reclassification/backfill. Preserve raw chain bytes and historical evidence; do not edit confirmed transactions or silently rewrite ledgers.

### AUD28-02 — P2: DNS checkpoint is latest transaction height, not verified scan coverage

Two fresh DNS responses at 19:30 and 19:35 UTC reported **`indexedThroughBlock=969152`**, while common node/index checkpoints were 969191–969192. The later response had a fresh `indexedAt` timestamp but remained 40 blocks behind the actual tip.

**Source:** `dnsRegistryPayload` in `server/proof-api.mjs` derives the field from `indexedThroughBlockFromTransactions(txs)`. The same-day checkpoint-exposure commit `f48d3a7` added that value to both top-level and stats. Latest matching transaction height is not proof that intervening empty blocks were scanned, nor necessarily a stalled indexer.

**Impact:** callers cannot distinguish real DNS scan lag from no newer DNS activity. A successful count/fresh timestamp does not certify tip coverage.

**Recommended correction, approval required:** return a verified scanned/checkpoint height and block hash with explicit coverage semantics. Retain latest DNS event height separately. Do not simply replace the number with current tip unless the complete source set has been verified through that tip.

### AUD28-03 — P3: DNS surface audit uses ID registry count fields

`scripts/audit-production-surfaces.mjs` uses `validateRegistrySummary` for DNS, which looks for `stats.records`, numeric `records`, `totalCount` or `confirmedRecords`. DNS returns a records array plus `stats.total=23` / `stats.confirmed=23`. Consequently DNS alone reports **“missing registry record count”** despite valid content and HTTP/assets.

**Recommended correction, approval required:** add a DNS-specific validator that validates actual schema, array/count consistency and genuine coverage/provenance. Keep AUD28-02 visible; merely teaching the harness `stats.total` would otherwise conceal the checkpoint issue.

### AUD28-04 — P2: Desktop's synthesized HTML bytes differ from Browser/Computer

The final public lookup of `armyofyouth@proofofwork.me` returned three files, but welcome transaction `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b` showed **1,017 B**, SHA-256 **`0c2d97286186b6c5174102be1891d51fc5c8e4b217d58d3081f2e072cb94020b`**. Browser and Computer showed **1,018 B**, SHA-256 **`f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`**.

A fresh read of the same public Desktop-host `/api/v1/address/.../mail` endpoint preserved the 1,018-byte memo ending in one newline and its canonical hash. Removing surrounding whitespace reproduces Desktop's exact 1,017-byte length/hash. Previous audit 27 independently extracted the 1,018-byte chain payload; this audit's complete confirmed raw-hex comparison found no changed canonical transaction.

**Source/limit:** the discrepancy is in the rendered Desktop/synthesized attachment or a stale read/cache projection, not demonstrated corruption of current Core/database/API bytes. `src/App.tsx:13747` and `:27558` form Desktop files from mailbox memo text; `:13816` hashes the supplied text. Those inspected current functions do not themselves trim the memo. The exact producer of the altered input remains unresolved, so this report does not claim a confirmed trimming line or a safe repair target.

**Impact:** two surfaces give different content fingerprints for the same chain-backed HTML. This is distinct from the previously documented header file-count convention and from duplicate file tiles. It also extends the existing fallback-cache concern without duplicating that broad performance ticket.

**Recommended follow-up, approval required for changes:** reproduce the public Desktop request with cache/read-warning provenance, bind its synthesized attachment to exact verified memo bytes, and test trailing newline/whitespace preservation across Desktop, Computer, Browser and download. Preserve display formatting separately; do not modify stored canonical content to make hashes agree.

## Prior findings rechecked without duplicate tickets

| Prior record | Current status |
| --- | --- |
| H24-08 derived/search/mail parity residues | Complete strict parity/event gates pass; previous repair remains effective within their coverage. New DNS gap is separately recorded. |
| September 27 pending-wallet / INCB repair | Observed pending set agrees with Core; all 47 canonical INCB arithmetic checks pass. Preserve historical raw classifier projections separately from canonical issuance. |
| H24-01 / AUD26-02 fresh/exact availability | Still open: temporary wallet 503s and later Computer unavailable spendability; eventual marketplace success is not a latency fix. |
| H24-02 exact ID audit | Successfully completed this run; several-minute execution still warrants work. |
| AUD26-01 node capacity decline | Direct SSH available; consumers identified; current daily rate substantially lower. No claim that the old burst cannot recur. |
| H24-04 node releases / H24-05 out-of-pattern UI archives / H24-06 replay workspaces | Still present; exact review inventory expanded. One large replay is actively running. |
| H24-03 backup/query-health overlap | Latest backup succeeds. Prior monitor overlap remains historical/open; no independent fix is asserted by this pass. |
| H24-07 failed-unit noise | Still present; preserve failure evidence before any approved unit reset. Current main services are active. |
| H18-06 checksums off | Still off; logical/catalog checks do not resolve physical-page assurance. |
| PERF-27-01/02/04 large UI reads and fallback state | Existing scope remains; 5.75 MB summary payload and delayed readiness observed. No new duplicate performance ticket. |
| AUD27-01 dropped-only header count | Still visible in Computer; detailed dropped-history semantics should remain preserved. |

## Cleanup candidates and approval boundaries

**Nothing was removed.** A verified operational rollback is now concretely identified; chronological age alone does not classify the other material as disposable.

1. **Keep:** live UI release `0e767c69e785-20260929T165314Z`, its matching archive, the latest rollback root containing `d2c0afaffd9c-20260929T161019Z` and its matching archive. Fresh streamed checksum/fingerprint verification passed for **all 16 surfaces on both roots**, with no staging/extraction writes on the UI host. This verifies bytes/provenance, not an actual rollback cutover.
2. **Highest-value proposed UI cleanup:** review/remove the other 16 complete roots from the evidence inventory after confirming no recovery workflow references them. Their individually measured allocations total roughly 4.41 GB; hardlinks mean actual reclaimed bytes must be measured rather than promised. Then restore bounded managed archive retention around the current/last rollback pair.
3. **Deployment scratch:** the 11.09 GB inventory contains source checkouts, assembled surfaces, uploaded source/surface archives, stream receipts and audit/deploy tools. No active deployment/cutover process was found and no `/var/www` symlink to that scratch was observed. Earlier release-generation source/surface trees and duplicate upload archives are strong cleanup candidates **after exact-path dependency/provenance review**; preserve current/rollback artifacts and compact receipts. Do not recursively delete the entire parent or config/helper files by age.
4. **UI recovery/cleanup evidence and July/August out-of-pattern artifacts:** classify/copy indispensable compact incident receipts before approving obsolete bulk artifacts. Existing evidence is not interchangeable with a rollback backup.
5. **Node releases:** retain current `d2c0afa` and one independently verified operational rollback; archive/checksum/dependency review is still required before removing the other releases or August operator-review tarball. The scheduled 04:28 receipt predates the current node checkout.
6. **Node replay/repair databases:** explicitly review process/port, service references, tablespaces, the September 27 repair rollback and reproducibility requirements before retirement. The 89.5 GB replay directory has an active PostgreSQL process and **is not an approved deletion candidate**. No live `/data/bitcoin`, Electrs, PostgreSQL, mempool, ledger or chain record belongs in cleanup scope.
7. **Database backups:** the logical job already retains one newest verified dump set. Keep it; do not delete the only current backup to gain space. An actual isolated restore should precede claims that all older repair rollback copies are redundant.

## Actions taken and recommended follow-up

Actions were inspection, bounded read-only tests, explicit Core/SQL reconciliation, checksum/catalog verification, read-only browser wallet connections and this audit handoff. No production remediation was attempted. Audit log creation is approved; cleanup, source fixes, derived-data repair, service/configuration changes, committing, deploying and pushing require separate explicit approval under `AGENTS.md`.

Recommended order:

1. Approve and execute an exact-path UI cleanup preserving the verified pair; verify reclaimed free bytes, reserve headroom, prune completion and that the live release fingerprints still match.
2. Approve AUD28-01's comparison/parity fix, reproduce the old failure, validate the corrected DNS seal, and agree on the smallest derived-index repair scope before any production write.
3. Correct DNS coverage/provenance and its audit validator together; require zero missing DNS events and database/public/Log agreement. Trace AUD28-04's altered Desktop input and require identical canonical file bytes/hashes across surfaces.
4. Address existing fresh-wallet/canonical-summary availability and checkpoint-bound pagination/readiness performance without weakening fail-closed authority.
5. Classify node replay/release workspaces; perform an approved isolated restore and decide retention from verified dependencies, not age.
6. Measure daily database/transition and staging growth, verify retention after each deployment, and verify external delivery of capacity alerts. Producer logs alone do not prove a human receives alerts.

Repository handoff: required operating/protocol docs, historical notes/evidence, generated-artifact declarations and narrow safe-cleanup allowlist reviewed. This pass creates no product/protocol invariant requiring a `SOUL.md` or canonical-spec edit. Historical notes remain dated evidence. `npm run hygiene:fix` passed with no allowlisted rebuildable state found and nothing removed. `npm run hygiene:check` passed. Final status/diff review contains only this log, its receipts and the note-inventory classification; ignored `node_modules/` remains untouched. No commit was created.


---

## Ordered read-only continuation — 2026-09-29, after approved Audit 28 corrections

Audit date: **2026-09-29 America/Toronto (EDT)**. Live observations approximately **20:35–20:54 UTC / 16:35–16:54 EDT**; document review preceded these observations. This is an appended audit, not authorization to implement its recommendations. The user explicitly approved this append and prohibited code/configuration/data/database/ledger/backup/log/infrastructure changes, deployments, restarts and cleanup. No production mutation, signing, broadcast, commit or push was performed. Ordinary GET/navigation activity naturally enters service logs and may exercise existing read caches.

### Scope and prior evidence

The seven required operating/protocol documents were consulted in the prescribed order. The prior audit inventory comprised **43 Markdown logs / 27,302 lines** before this append; prior finding identifiers and correction records were reviewed to avoid creating duplicate tickets. The closest baselines are the [ordered Audit 27](2026-09-28-ordered-read-only-application-audit-27.md), this Audit 28 and the [approved corrections execution record](2026-09-29-approved-audit-28-cleanup-corrections-execution.md). Their pre-audit SHA-256 bindings are respectively `e4d30700953e7a898e44fdeb5551095cc4b32089a6636ef02173762e113ddb90`, `9310f980d27cb7d8296b32b207b7c0f937b5ceb0c6bb9cfa8dc775cfd24dc8b6`, and `e4ca6b70106ca9e739ff0b7db676bf3192f035061ac923de3dc1f61c25c85d63`.

Local HEAD is `fcf3886383eeffa779c3ccf57c5e87e39720dccd` (merge of approved corrections). The previously verified deployed application source is `3bc6c9d44e00c504c324a1f13b7803f89cbfb122`; current UI/node archive inventories retain that release and the designated predecessor. This continuation does not replace the execution record's streamed archive/runtime fingerprints with a new full release attestation.

### Pages reviewed, in requested order

The in-app browser review followed this sequence; Computer was reviewed after Growth. Independently, `node scripts/audit-production-surfaces.mjs --json --timeout-ms=60000` followed the same 15-surface sequence, finishing at **20:42:21.559 UTC**, with **15/15 successful page, asset and fresh API probes**. ID means registration on the standalone host; management belongs to Computer.

| Order | Surface | Read-only result and qualifications |
|---|---|---|
| 1 | `proofofwork.me` — Home | Apex redirects to www; navigation and verified registry counts loaded. 508 confirmed IDs, 20 pending in the current public summary; 23 confirmed DNS names. |
| 2 | `id.proofofwork.me` — IDs | Registration-only controls retained; 1,000-proof registration fee. Connected account balances loaded. Generic connection/readiness text still appears while connected: existing AUD26-03. |
| 3 | `dns.proofofwork.me` — DNS | 23 confirmed names, zero pending; registration 1,000 proofs; current registry address and `.pow` naming agree with protocol. Fresh coverage now certifies block 969198 separately from latest event 969152. |
| 4 | `desktop.proofofwork.me` — Desktop | Public lookup of `satoshin@proofofwork.me` returned three files, with no duplicate self-send row. Welcome HTML now 1,018 bytes with the canonical hash below. No file/local-state write performed. |
| 5 | `browser.proofofwork.me` — Browser | Opened the welcome transaction through Desktop; confirmed HTML, 1,018 bytes, same hash. Inspected empty iframe sandbox and deny-all CSP, including script/connect/form/object/worker restrictions. |
| 6 | `boost.proofofwork.me` — Social | Feed, confirmed post/reply/reboost records and transaction links rendered. Different proof-only versus WORK-valued signal contexts were not treated as an accounting discrepancy. No social action submitted. |
| 7 | `amo.proofofwork.me` — AMO | Credit book hydration was slow; DNS tab showed 23 names and one sealed `4.pow` listing at 10,000 proofs. Listing/seal references agree with confirmed chain records. No purchase/list/seal/delist attempted. |
| 8 | `credit.proofofwork.me` — Credits | 236 generic credit definitions; DRAIN supply 110,000 and holder balances 75,000 + 35,000 rendered. Creation 546 proofs, owner-registry mint lanes and paged holders/history loaded. Fresh WORK account state intermittently unavailable, with last-verified balances retained. |
| 9 | `wallet.proofofwork.me` — Wallet | Confirmed/spendable/reserved WORK arithmetic agrees across account surfaces. Listings, seals and movement history rendered; WORK face 25,000 proofs and Q16 amount shown. No transfer or ticket action executed. |
| 10 | `work.proofofwork.me` — WORK | 21,000,000 supply, 21,000 mints, 387 holder rows, zero pending mint supply; mint controls indicate minted out. Exact floor/value agree with Growth/Computer. USD/chart projections are display-only. |
| 11 | `infinity.proofofwork.me` — Infinity | Supply 630,496,569 POWB, zero pending; value 630,501,483 proofs; one sealed 2,000,000-POWB ticket priced at 2,000,000 proofs. Preview-completeness qualification visible. |
| 12 | `inception.proofofwork.me` — Inception | 47 fixed bond issuances, supply 945,662,401,792,509,469 INCB, zero pending; H−1 provenance, historical units and sub-proof dust shown. No new bond created. |
| 13 | `log.proofofwork.me` — Log | Repaired DNS seal renders confirmed with listing link and 546 proofs. Initial cached count/checkpoint settled to current 969198; generic status text can retain older totals (existing family). Pending records visibly distinguished. |
| 14 | `growth.proofofwork.me` — Growth | Exact current value matches WORK/Computer; scenario assumptions explicitly separate from chain measurements. **Seal chronology regression below** persists in fresh API and rendered cards. |
| 15 | `computer.proofofwork.me` — Computer | Connected UniSat, inspected Mail shell, IDs, Wallet and AMO. IDs retains registration/update/direct-transfer scope and 1,000/546 fee split. Wallet's initial stale V6/default-face state recovered after refresh to V8/25,000; existing hydration/readiness family. **DNS tab initially asserted false empty state; DNS-specific refresh recovered it**, as detailed below. |

The observed account was `18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa`. No wallet secrets were requested or handled. Existing wallet permissions were used; Computer needed a connection click but no transaction signing.

### Full-node authority, index and database verification

Core, Electrs, canonical index and summary coverage agreed at **969198**, block hash `000000000000000000002af378eff440c89bd7b7b2f86c0eb79493ed88af8cef`. Core headers matched blocks, IBD false, unpruned, verification progress 1, no warnings; txindex, coinstats and compact-filter indexes were synced. API ready/available true, lag/ahead zero, canonical fault empty, rebuild complete/inactive, worker consecutive failures zero and no unresolved pending protocol events reported. Final health GET at **20:50:01.875 UTC** retained that checkpoint and readiness.

Sequential read-only Core RPC reconciliation covered **all 26,069 indexed transaction IDs** and **all 21,199 stored canonical block hashes**. All 25,821 confirmed transaction hex values and confirmations matched Core. All indexed pending transactions were present in the sampled mempool and indexed dropped transactions absent; before/after tip remained 969198. Current SQL population was 25,821 confirmed / 169 pending / 79 dropped, differing from earlier baseline by one natural pending-to-dropped transition. Mempool count itself changed during observation and is best-effort visibility, not canonical confirmed supply.

Normalized inputs matched raw input prevout identities/sequences and outputs matched raw values/scripts: zero mismatches. All 25,821 confirmed normalized input/output fee totals were nonnegative and agreed with stored raw fee amounts. Event/transaction/participant/reference/mail orphan checks, parent status and canonical-coordinate checks returned zero discrepancies; no invalid/unready indexes or unvalidated constraints. 248 missing stored raw hex values belong solely to pending/dropped rows, not confirmed transactions. The 78 shared positions retain known classes: 49 sale/closure pairs, 24 invalid/detail pairs, one invalid mint/detail pair, three historical ID compatibility pairs and one seal/closure pair. They are not duplicate confirmed transfers and must not be deleted.

The read-only parity gate returned `ok=true`, **102 checks, zero active invariant failures**. Two previously classified historical V5 migration/USD-head warnings remain, without active V8 invariant failure. The gate used the reviewed prior audit harness against current readers/APIs; it was not a destructive replay/rebuild.

All **46 returned confirmed account UTXOs** were independently checked with Core `gettxout(..., true)`: every outpoint remained unspent, positively confirmed, and had the returned value; sum **25,646 proofs**, zero errors. Initial UniSat-selected spendability was **1,589 proofs** plus **24,057 protected/unavailable**. A later refresh reported **2,714 spendable + 22,932 protected**, with the same Core total. Wallet eligibility and reservation freshness are separate from confirmed value; this audit did not certify signing eligibility or interpret that changing partition as new chain funds.

The confirmed DNS seal `dd498455bb712411341cfde6fab38764281ff6b77076a41012c3bee768475e38`, welcome HTML transaction and V8 declaration `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a` were also read directly from Core. Every one of the 47 served INCB H−1 block hashes independently matched Core. Stored `file_attachments` contained zero rows; this is not an attachment-population assurance claim. Welcome HTML was verified through the mail/Desktop/Browser representation and the already established raw-byte fixture.

### Data and deterministic math

- All **236 generic credit definitions** passed confirmed mint/holder conservation and max-supply checks, zero errors. The Q16 WORK conversion was applied explicitly; POWB/INCB were checked as separate bond lanes.
- WORK confirmed balance sum is exactly **210000000000000000000000 Q16 subatoms = 21,000,000 WORK**. No negative or fractional stored integer balances found. Observed account: **9,999,997,003,878,536 = 9,999,970,087,899,719 spendable + 26,915,978,817 reserved subatoms**. Display values preserve all 16 decimals.
- Independent INCB integer arithmetic used each record's declared historical Q8/current Q16 unit scale and its hash-bound H−1 value. For attachment quantity `a` at scale `u`, attachment value Q8 is `floor(a × HminusOneNetworkValueQ8 / (21,000,000 × u))`; add direct proofs × 10^8, then floor issuance once to whole INCB. **All 47 records passed**, total issued and holder sum **945662401792509469**, cumulative value **94566240179250949146190218 Q8**, cumulative unissued dust **2246190218 Q8 = 22.46190218 proofs**. Direct issued 27,932; attached issued 945,662,401,792,481,537. This independently checks arithmetic over canonical supplied H−1 inputs, not a new genesis recomputation of every historical summary.
- Shared live network value: **1452083490330680135585252463 Q8 = 14,520,834,903,306,801,355.85252463 proofs**. Divide by 21,000,000 using integer Q8 floor: **69146832872889530265 Q8 = 691,468,328,728.89530265 proofs / WORK**. The 25,000-proof current intent estimate is **361549458 Q16 subatoms = 0.0000000361549458 WORK**. UI values agree; confirmation-position frozen terms remain distinct from current estimates.
- DNS overlay remains `(23 × 1,000 + 2 × 546) × 5 = 120,460` weighted proofs, **12046000000000 Q8**, explaining the difference from the raw transition closing value **1452083490330668089585252463 Q8**. Do not fold this separate overlay into transition replay or count it twice.
- **9,578 transition rows**, 959621–969198: zero block/hash linkage errors, zero opening-value errors, no incomplete/block-atomic/fee-once/invalid-zero flags, no value decreases. The sole opening state commitment boundary is **960601**, the established Q16/V8 activation boundary; it is not an unexplained discontinuity.
- Local checks passed: `check:work-precision` (131 checks), `check:work-precision-v2`, `check:bond-exact-arithmetic`, `check:fee-rate-precision`, and `check:api-truth`, including six Audit 28 regression tests and V8 gate regressions. These are contract tests, not proof of every production signing path.

Exact integer fields and canonical functions must continue to drive settlement. Large live values, INCB supplies and Q16 balances exceed JavaScript safe-integer range; Number/USD/chart projections cannot be reused for accounting. No new arithmetic failure was demonstrated in the checked populations; “math must never fail” remains a required invariant, not a guarantee inferred from passing tests.

### Previously reported issues rechecked

| Existing finding | Current result |
|---|---|
| AUD28-01 DNS auth/Log classification | Remains corrected: all 25 confirmed DNS relational events valid; repaired seal renders in Log/Growth and sealed listing is available. |
| AUD28-02 DNS coverage | Remains corrected: fresh response at 20:50:33.287 UTC covers 969198/hash above; latestEventBlock separately 969152; coverage complete true. |
| AUD28-03 surface validator | Remains corrected: DNS-specific validation and all 15 public probes pass. |
| AUD28-04 Desktop bytes | Remains corrected: Desktop and Browser show 1,018 bytes; SHA-256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`. |
| H19-01 exact aggregates / repaired INCB arithmetic | No reopening: 102-check parity and independent conservation/issuance/value arithmetic pass. |
| H20-03 Desktop deduplication / H20-04 confirmed labels | No recurrence observed in selected fixture/current Log; not universal fault-injection coverage. |
| H24-01 / AUD26-02 fresh-wallet availability; PERF-27-01/02/04 | Still open: intermittent unavailable fresh wallet state, lengthy AMO hydration, large summaries and stale fallback states. Eventually green reads do not close these. |
| AUD26-03 readiness/stale wording | Still open: connected “Connect UniSat” text, older status/count snapshots, transient V6/default faces before refresh. DNS initial empty-state manifestation below adds concrete scope. |
| Audit 12/17 timestamp family, later repaired relational metadata | Relational event times now match Core for selected affected seals, but Growth projection chronology regressed below. Do not reopen the original NULL-column population without evidence. |
| H18-06 live PostgreSQL physical assurance | Still open: `data_checksums=off`; no live full physical checksum/amcheck/restore campaign performed. Valid indexes and logical arithmetic do not certify physical pages. |
| H8-05 / H10-02 transition growth; H24-04–06 recovery/retention | Still open; current sizes and post-cleanup improvements below. Protected recovery dependencies remain. |
| H24-07 failed-unit noise | Still present: 32 failed node units and one historical UI publish unit. Scheduled release-health failure is dated 04:28, before cleanup; do not infer current archive verification failure from that stale unit state. API observation/storage-review failures also reflect real current latency/allocation thresholds and need separate classification. |
| AUD27-01 dropped-only Outbox label | Not closed. Current connected account has no Mail/Outbox fixture; no fresh UI reproduction with that fixture account. Earlier Core absence remains dated evidence. |

### New or materially changed findings

**AUD28-C01 — P2, Growth seal chronology regression in the existing timestamp family.** Fresh Growth API and UI assigned the same **2026-09-29T15:44:40.675Z** date to four distinct confirmed seals. Direct Core receipts:

| Seal txid | Core canonical block time, UTC | Growth displayed source time |
|---|---|---|
| `767b1c7d0df60edc9099ff29269b553843c896e397f550f5d7f8558834575c4b` | 2026-09-29 13:32:04 | 2026-09-29 15:44:40.675 |
| `4f895eaabd46d1c8d69b6ac953aa3776a861bf29951b99a6126b31413b2b15bd` | 2026-09-29 08:31:07 | 2026-09-29 15:44:40.675 |
| `3eb8cfcb5edb187cb77e2bc4ef4a3142a03c4897afe9a800613605e2d65e62e6` | 2026-09-29 08:31:07 | 2026-09-29 15:44:40.675 |
| `00943f5892cee2e9d4d097e9b6098629a7f5a080ccbd7c33b24c8de9685975a5` | **2026-08-16 21:37:43** | **2026-09-29 15:44:40.675** |

SQL confirms the first and August seal's `block_time`/`event_time` equal Core. Log shows the correct selected seal time; repaired DNS seal time also agrees with Core. This is a downstream timestamp/order defect, not demonstrated supply/fee corruption. `server/db/proof-index-reader.mjs` projects `sealAt` from payload `sealAt`/`sealedAt` or row `updated_at`; `server/proof-api.mjs` then uses it for seal activity and Growth uses that activity's `createdAt`. This fallback is a plausible source, requiring tracing before any correction. Recommendation: project confirmed chronology from authoritative seal-event/parent block time, retain observation/update time separately, and test old and new seals across Log/Growth without rewriting chain history. **Approval required.**

**AUD28-C02 — P2, Computer DNS initial hydration/false empty state; added scope to existing cross-app readiness family.** After complete credit/bond hydration, Computer AMO showed Ready at block 969198 but its DNS tab asserted **0 active listings**, “No active on-chain .pow name listings yet” and “No confirmed DNS records found yet.” Standalone AMO and fresh DNS API at the same checkpoint showed **23 confirmed names and one sealed 4.pow listing**. Header Refresh refreshed credits and did not recover DNS. The DNS tab's own Refresh then loaded 23 names/one listing and restored agreement. Source inspection shows standalone `marketplaceMode` triggers `refreshDns` on entry, while the Computer AMO passes independent DNS state; its per-tab refresh invokes `onRefreshDns`. This narrows the defect to initial hydration/empty-state gating, not registry loss. Recommendation: hydrate/fence Computer DNS when the tab becomes active and suppress zero/empty claims until that independent state is verified. Overall credit-book readiness cannot certify DNS readiness. **Approval required.**

No new critical/high chain-integrity finding was established. These continuation identifiers record concrete regressions/materially changed scope; they do not replace or duplicate existing issue families.

### Health, performance, security and resilience

Page GETs measured **127–1,018 ms** in the ordered harness. Fresh API probes ranged **2,007–11,749 ms**; marketplace summary 6,500 ms, WORK summary 7,975 ms, WORK token 11,749 ms. In-app full-book hydration took longer and is not measured by those single-request timings. The shared summary snapshot payload remains **5,750,706 bytes**. Existing observation-health journal at 20:40 reports `/api/v1/token` p95 **27,446 ms**, registry **11,563 ms**, internal canonical summary **14,060 ms** and work-floor **10,138 ms** in its bounded window. The monitor failed on latency thresholds; that alert must not be cleared merely because this audit's endpoint samples returned 200. Measurements include ordinary production traffic and audit GET load, not controlled benchmarks.

Core, Electrs, API, indexer worker and PostgreSQL were active with `NRestarts=0` in sampled unit counters. Node RAID1 pairs were `[UU]`; memory available about 115 GB. Effective UFW defaults deny inbound/routed; RPC/Electrs are limited to loopback/container addresses, PostgreSQL/mempool HTTP to loopback, API to loopback/WireGuard and UI peer. SSH and chain P2P remain public by policy. API/indexer run as powadmin with NoNewPrivileges, PrivateTmp and ProtectHome; API ProtectSystem strict with a narrow cache write path, indexer ProtectSystem full. Browser restrictions were inspected directly. These observations are not an external penetration test, authentication exhaustiveness certificate or alert-delivery proof.

Prioritize bounded checkpoint-coherent reads, smaller public summary responses, complete-book pagination without repeated full-state copies, per-surface hydration and explicit stale/unavailable states. Keep exact arithmetic/chain fences and fresh signing preflight intact while improving latency. Measure p50/p95/p99, payload bytes, complete-book time, refusal reasons, checkpoint changes and worker lag separately; verify alert delivery under an approved monitoring exercise.

### Storage and retention review — nothing removed

| Item | Current measured size/reserve | Decision for this audit |
|---|---:|---|
| UI root available | **28,529,139,712 B**, 26% used | Prior urgent reserve pressure materially improved after separately approved cleanup; do not repeat the old near-full finding. |
| UI backups / deploy scratch / logs | 3,735,498,752 / 1,262,129,152 / 734,404,608 B | Dependency-reviewed candidates only; preserve current/prior rollback and evidence. |
| UI rollback/archive set | One pre-3bc rollback root; normal 3bc + 0e archives | Expected post-cleanup inventory observed. Historical out-of-pattern archives still require review. |
| Node root / data available | 71,735,771,136 / 474,457,194,496 B | Healthy absolute reserve now; short historical growth estimates are not exhaustion guarantees. |
| Production database / transition relation | **37,546,515,479 / 36,294,754,304 B** | About 96.7% transition evidence. Preserve live tables; design bounded evidence retention/compaction only after replay proof and approval. |
| PostgreSQL backups | 19,371,266,048 B | Protected logical/physical/WAL/PITR dependencies; prior checksum/restore evidence is dated, not freshly rerun here. |
| API cache / node logs | 172,699,648 / 1,231,388,672 B | Potential future bounded retention review, never blanket removal during reads. |
| Active INCB final-source replay/recovery tree | **89,525,575,680 B** | Critical-review size, not disposable waste. Preserve until live/recovery dependencies and equivalent retained proof are established. |
| Other replay/recovery trees | ~32.85 GB, ~20.16 GB, ~20.26 GB in scheduled receipts | Same protected classification; no safe-removal certificate. |
| Node release backups | ~8.65 GB, including old ~5.78 GB operator-review archive | Normal managed archives now 3bc + d2; historical out-of-pattern material remains dependency/provenance review scope. |
| Local allowlisted build/test/cache output | No allowlisted cleanup candidates observed; only ignored node_modules | No local cleanup performed. Temporary audit receipts remain under /tmp and are not production evidence stores. |

Some staging/caches may ultimately be rebuildable, but **no production item is certified safe to delete by this audit**. Any future cleanup must verify active-unit/read paths, symlinks, open files, backup/restore chains, current+predecessor rollback bytes and provenance, retained replay evidence, and expected post-removal health before approval. Age and redundant-looking names are insufficient. Audit logs, protocol migrations, tx-backed records and ledgers remain protected.

### Recommended actions requiring separate approval

1. Correct Growth confirmed seal chronology and Computer DNS initial hydration/empty-state gating, with focused regression checks and Core/API/UI parity receipts.
2. Resolve the existing fresh-wallet availability and complete-book latency family; preserve fail-closed preflight and integer settlement rules. Benchmark coherent checkpoint reads under bounded load.
3. Separate stale failed oneshot units from active API latency/storage alerts, retaining incident evidence; verify external notification delivery.
4. Plan transition/database growth bounds and live PostgreSQL physical integrity assurance, including resource-budgeted isolated restore/amcheck/checksum options. Do not change checksum settings or compact evidence in place during audit.
5. Review historical staging/archive/recovery dependencies and retention manifests. Preserve the designated rollback and full-node/indexer/replay recovery material; no cleanup is approved by this list.

### Limits and repository handoff

This audit reconciled the stored indexed population, selected full-node-bound UI fixtures and current projection arithmetic. It did not rescan every historical block for omitted protocol discovery, recompute every historical H−1 summary from genesis, exercise purchases/signing/broadcasts, induce reorg/RBF/eviction, read private mailbox bodies, prove every attachment/media byte, perform physical backup restoration or establish universal mobile/browser/security/performance coverage. Earlier unresolved findings remain open unless explicitly rechecked above.

Only this existing audit log was appended. SOUL, canonical docs, tracked notes/generated artifacts, protected histories and cleanup allowlist were reviewed; no semantic protocol/product change required another document edit. `hygiene:check` passed before append and was rerun after append. **`hygiene:fix` was intentionally not executed because the user's explicit no-cleanup instruction overrides the normal mutating hygiene step**; its allowlist was inspected read-only and no candidate existed. No hook was bypassed and no commit created. Final status/diff must contain only this append.

### Compact retained receipts

The following results are embedded so the conclusions do not depend on /tmp surviving. Larger local diagnostic outputs were kept outside Git to avoid copying 34 MB of historical parity preimages into an audit log; source procedures remain in the existing Audit 28 evidence and results are bounded to the checkpoint above.

```json
{
  "coreReconciliation": {
    "tipBefore": 969198,
    "mempoolCountBefore": 72857,
    "transactionsChecked": 26069,
    "errors": [],
    "pendingAbsent": [],
    "droppedPresent": [],
    "canonicalBlocksChecked": 21199,
    "blockHashErrors": [],
    "attachmentsChecked": 0,
    "attachmentErrors": [],
    "tipAfter": 969198,
    "pendingAbsentBoth": [],
    "droppedPresentBoth": []
  },
  "inceptionIntegerMath": {
    "mintsChecked": 47,
    "issuedUnits": "945662401792509469",
    "issuanceValueQ8": "94566240179250949146190218",
    "dustQ8": "2246190218",
    "errors": [],
    "holderSum": "945662401792509469",
    "scope": "Independent integer arithmetic over served canonical H-1 inputs with historical Q8/current Q16 units; Core raw transactions checked separately, not genesis H-1 rederivation."
  },
  "walletCoreOutpoints": {
    "outpointsChecked": 46,
    "confirmedSumProofs": 25646,
    "errors": []
  },
  "parity": {
    "ok": true,
    "checks": 102,
    "activeInvariantFailures": 0,
    "knownHistoricalV5Warnings": 2
  }
}
```

Local receipt SHA-256 bindings (receipts are temporary; compact results above are durable):

| Receipt | SHA-256 |
|---|---|
| `surfaces.json` | `ca6f5230e22788a5f41b9c3fbdd71de8b958aadf66657f2bd3a4b7e87659de04` |
| `core-db.txt` | `f2f058f5230d48ca142451bbb639137cf138c8d2773bfdb1175d15db4153e27d` |
| `parity.txt` | `950ef932b49dda38d5c6107169fc7f3246da4d7f96e61e9ab0d50f06cdb87b6d` |
| `incb-math.json` | `e0d232e39886e4b6e7ae3d9ed7d0bcd4b62fce4ba54e6004aa1bc2a469d4f9b4` |
| `utxo-core.txt` | `f889968c2bc297796b4c33ab6ebaea337b313c5d46a3cb3dee2287590d184629` |
| `growth-chronology.json` | `4f8e2ce46805fc569059901142efcae9d90f122c51c246c110c4fcabedffaeb6` |
| `final-dns.json` | `cf4e5c3a4d5a2ed4cf4e32e4a8af1807c859a8c36f5cfd3cce8c6725bd9fbf31` |
| `final-health.json` | `658d781a4f35fec16a15f4c24f488fe9096fa1b42e8cf1eb99352f73b66f3fe6` |

### Approved follow-up preparation — 2026-09-29

The user separately approved local implementation/testing of the Growth and Computer DNS fixes, bounded wallet/AMO/monitoring investigation, cleanup inventory, exact manifests and restore/deployment/rollback preparation. See [the preparation and approval boundaries](2026-09-29-audit28-followup-preparation.md), [exact cleanup manifest](2026-09-29-audit28-followup-cleanup.manifest.json), and [compact verification receipts](2026-09-29-audit28-followup-preparation.evidence.json).

Both projection/UI fixes are prepared locally. Four affected seal dates were rechecked directly against Core; Computer and standalone AMO DNS browser tests cover loading, errors, malformed successful HTTP envelopes, retry and legitimate verified empty state. Index-recovery checks pass 552/552; build, exact arithmetic/fee checks and hygiene pass. Wallet/AMO availability remains open: a bounded fresh probe returned AMO HTTP 503/core-checkpoint-mismatch while overall health and WORK were ready at a Core-verified checkpoint. No correctness fence was weakened.

817 storage path observations are classified. Only one exact retired UI source tree is proposed for deletion (250,212,352 allocated bytes); every other inventoried item is held. Manifest SHA-256 is `4f953d31585ed762be0147a332ac8c5ab9850ad43b6f008159729b59f839b59f`. Production verification-only execution passed; no deletion occurred. Backup catalog readability and prepared isolated restore checks do not constitute a completed full restore or physical live-database assurance. Existing named rollback sets and active recovery dependencies remain protected. The full UI publication/rollback contract suite ultimately passed under the final bounded local run; the preparation document records the exact approval needed before execution.

No production deployment, service/configuration change, deletion, ledger/database repair, commit or push was performed. Relevant local source/tests/docs/audit files were edited under the separate preparation approval; repository-allowlisted build/Vite cache outputs were removed by the mandatory local hygiene pass.


## Approved follow-up execution — 2026-09-29 EDT / 2026-09-30 UTC

The user explicitly approved the linked exact manifest and deployment plan. Execution uses commit `db853f434f9b9e6162bcd41e5b1c9fdebee292eb` on `codex/audit28-approved-followup`, pushed without force. The optional isolated restore was not approved and has not run.

- Exact manifest `4f953d31585ed762be0147a332ac8c5ab9850ad43b6f008159729b59f839b59f` passed immediate content, identity, dependency and designated rollback verification. Only the named retired UI source tree was deleted. Free bytes increased from 28,530,532,352 to 28,780,199,936 (249,667,584 bytes); unrelated filesystem writes can affect this measurement. Durable receipt remains under production `cleanup-evidence`. All other 816 inventory observations remain held.
- Approved publisher hash `c2f06538c2c3263d1a7b7157c67dfebe007803b3fdbf60b9aeb21e4aedeb30e9` installed; original bytes/hash retained. The three named retention timers are stopped; monitoring and backups retain their prior states.
- Candidate source/runtime attestation and isolated read-only API verification passed. Node exchange succeeded; ready health at 969234; API bridge, worker and recovery-watch restored. Core/Electrs/PostgreSQL identities unchanged. Both designated node archives and the exchanged prior checkout retained. Managed candidate archive published with SHA-256 `0985f4de6d7687b67146330b86de359de8944667a2827708f84432513ab13791`.
- Canonical seal-history API now returns chain block timestamps for the affected seals. Growth still served the pre-cutover same-checkpoint summary in the first verification; normal next-checkpoint publication remains the verification gate. No stored summary or ledger was manually rewritten. UI builds/publication and final verification are pending.

Compact execution evidence is appended to the existing preparation evidence JSON; its original preparation evidence remains historical. This interim entry does not claim a completed release or close unresolved availability findings.

### Follow-up publication and smoke verification

Node and UI now serve approved source commit `db853f434f9b9e6162bcd41e5b1c9fdebee292eb`. UI publisher reported `status=published`, and independent served-byte provenance verification passed. Managed UI archive SHA-256: `5ea63ef85b25ed16579b03133109290f9de49eca26e22f3b4d23578711b17154`. All 15 production surfaces were reviewed in the requested order, Computer last: HTTP 200, no browser exceptions, no failed static assets. Live standalone AMO shows 23 DNS names/one active listing; Computer loads one DNS listing on entry. Two DNS failure/loading/malformed-response/retry tests pass against the served bundle with mocked reads and no production writes.

All four deployed canonical seal-history timestamps match a fresh direct Core verification. A bounded read-only internal canonical-summary construction also returns corrected Growth event dates at height 969234, without storing a summary. Public Growth still shows the pre-cutover exact-checkpoint snapshot, generated at 01:14:00 UTC. The worker intentionally reuses that immutable snapshot at the same checkpoint; normal next-block publication is still the final public Growth verification gate. No manual ledger/summary rewrite is authorized or performed.

Final bounded readiness observation reports zero active invariant failures and no stale readiness, but AMO HTTP 200 took 10,773 ms, crossing the 10-second critical latency threshold. Earlier post-node observations were WORK 6,788 ms / AMO 9,783 ms. These are single observations with normal browser/API traffic, not an isolated benchmark or proof of improvement. Keep the existing performance/intermittent availability issue family open. Exact WORK precision, bond arithmetic and whole-proof fee checks pass; protocol/accounting rules remain unchanged.

Protected old UI/node archive hashes match after deployment; both retained complete UI roots and the exchanged old node checkout remain. UI free space is 27,391,754,240 bytes, above the 10 GiB floor plus reserve. New release/recovery artifacts consume space despite the single cleanup reclaim. All 27 Git reference objects from the retired transport remain in the local repository. No other inventoried cleanup item was removed.

**Approval boundary requiring follow-up:** the three retention timers are inactive but still enabled. Reboot can reactivate them. This stop-only rollout does not authorize disabling/masking units or a changed prune policy. A persistent pause or exact pin-aware retention policy needs separate concrete approval before reboot/resumption could retire any designated bytes. Optional pinned isolated restore, other deletions, physical database maintenance, performance implementation/configuration, and external alert messages remain outside this execution scope.
