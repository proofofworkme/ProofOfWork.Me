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
