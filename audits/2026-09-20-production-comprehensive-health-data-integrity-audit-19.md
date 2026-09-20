# Production health and data-integrity audit 19 — 2026-09-20

## Audit boundary and conclusion

- **Observation window:** 2026-09-20 13:54–14:18 UTC, approximately 09:54–10:18 America/Toronto. Documentation and repository hygiene followed the live audit.
- **Source inspected:** `0ef9c3bee3212a4cb0ae6efe7abbb6a75be72ffa`, including H18 remediation `3fc9215` and pending-witness stabilization `c4bbf1d`. Node API/worker and current UI release identify this source revision.
- **Systems:** node VPS `65.108.122.87` (`pow-bitcoin-01`); UI VPS `77.42.91.106` (`ubuntu-4gb-hel1-1`); full node, Electrs, PostgreSQL, API, indexer worker, WAL receiver, mempool containers, Caddy, storage/backup/provenance monitors, public APIs and all 14 application surfaces.
- **Authority:** read-only audit. The user explicitly approved creating the completed audit log. No production data, protocol records, ledgers, evidence, configuration, services, releases or backups were changed or removed. No signing, broadcast, commit, push or deploy occurred.
- **Audit continuity:** the required operating documents were read in order, followed by all available prior audit/issue artifacts and relevant remediation continuations. The evidence file hashes **41 predecessor artifacts**, including the financial/issue ledgers. Original issue IDs below retain their history; resolved defects are not reopened merely because an old log contains a red heading.

**The application is operational, but this is not an all-clear.** At the last application-health sample, Core, Electrs and the indexer agreed at height **967839**, readiness was green, and the worker reported no pending errors. Independently, every stored confirmed transaction passed raw-byte, normalized-input/output and block-position comparison with Core. Stored supply, V8 terms and INCB issuance checks passed.

One **new high-priority API integrity finding, H19-01**, exposes materially inconsistent credit value aggregates inside the same fresh WORK response while that response labels canonical consistency green. Main WORK/AMO/Growth headline values were correct; balances or settlement corruption were not demonstrated. Existing UI disk reserve risk, canonical-summary byte pressure, endpoint latency/readiness, release retention and incomplete physical/off-host verification remain open. Protected ID and Computer event audit gates did not complete.

The [compact evidence artifact](2026-09-20-production-comprehensive-health-data-integrity-audit-19.evidence.json) contains time-bound receipts, complete small reproduction sources, exact retention candidate paths, predecessor hashes, test results and the precise new discrepancy. Its SHA256 is recorded in the verification section. Large temporary API responses and verbose migration payloads are represented by hashes and selected relevant excerpts instead of being copied wholesale.

## Health and capacity

Final host samples were taken at **14:16:40–14:16:43 UTC**. Available space means space available to ordinary processes; filesystem-reserved space is not usable application headroom. `df` and API percentage formulas use different denominators, so exact available bytes govern reserve analysis.

| System / mount | Capacity | Used | Available | `df` used | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Node `/` | 105,089,261,568 B | 29,731,430,400 B | 69,972,344,832 B | 30% | Ample current headroom |
| Node `/data` | 1,764,768,071,680 B | 1,234,043,043,840 B | 441,004,253,184 B | 74% | Above 100 GiB reserve; future backup refill matters |
| UI `/` | 39,973,924,864 B | 24,859,820,032 B | 13,429,911,552 B | 65% | Only 2,692,493,312 B above 10 GiB reserve |

| Resource | Node VPS | UI VPS |
| --- | --- | --- |
| CPU / load 1, 5, 15 minutes | 32 CPUs; 1.81 / 3.43 / 4.48 | 2 CPUs; 0.064 / 0.067 / 0.047 |
| One-second CPU sample | 96.66% idle; 0% I/O wait | 100% idle; 0% I/O wait |
| RAM total / available | 134,125,752,320 / 116,700,631,040 B | 4,005,457,920 / 3,390,382,080 B |
| Swap | 430,178,304 B used of 17,179,865,088 B | None configured |
| Inodes | Root 436,285 / 6,553,600; data 26,717 / 109,502,464 | 80,740 / 2,427,136 |
| Running services | Core, Electrs, PostgreSQL, WAL receiver, API, worker, WireGuard API proxy active; zero sampled automatic restarts | Caddy active; zero sampled automatic restarts |
| Storage hardware | Both RAID1 arrays `[UU]`; no degraded member | Virtual disk; no physical-device health certification |

Memory is predominantly reclaimable cache; low `MemFree` alone is not exhaustion. These CPU/memory observations are samples, not a peak-load or endurance test. Both hosts had more than 130 days of uptime. The node's Core/Electrs/PostgreSQL service lifetime began September 12; API/worker began September 20 at 05:03:28 UTC. Mempool API/web/database containers were healthy in the initial service inventory.

### UI disk recurrence — continue H5-01 / H13-01 (H18-02 / H18-08)

The UI host **does not run the production database**: no PostgreSQL, MySQL/MariaDB, MongoDB or Redis server package, process, service or corresponding database listener was found. Its pressure comes primarily from backup/release material. Initial allocated usage was approximately:

| UI allocation | Bytes | Interpretation |
| --- | ---: | --- |
| Backup area | 19,278,544,896 | About 17.95 GiB; largest consumer, above 16 GiB review threshold |
| Deployment scratch | 719,765,504 | Subject to bounded marker/path cleanup policy |
| `/var/www` | 412,045,312 | Live/static/release content; preserve dependencies |
| `/var/log` | 618,504,192 | Includes evidence and operational logs |
| `/tmp` | 272,912,384 | Measured allocation, not a deletion approval |
| `/var/cache` | 127,266,816 | Measured allocation, not proven obsolete |

The latest installed storage forecast at **14:01:48 UTC** reported:

- Available **13,429,911,552 B** (about 12.51 GiB).
- Reserve **10,737,418,240 B** (10 GiB).
- Headroom **2,692,493,312 B** (about 2.51 GiB).
- Observed one-day net consumption **711,128,663 B/day**.
- Estimated **327,129 seconds**, about **3.79 days**, to the reserve.

This is a warning based on a short historical window, **not a guaranteed deadline or time to a completely full filesystem**. A release can temporarily create source, staging, archive and rollback copies together and cross the reserve sooner. Continuing backup accumulation can reproduce the earlier disk-full failure even while the static application itself is small.

The UI release-prune timer is **report-only (`--dry-run`)**. Its successful exit does not mean storage was reclaimed. Current dry-run verified 16 archives, zero unverified, and identified 11 candidate archive/sidecar sets while protecting two complete rollback roots. Exact names are in the evidence artifact. The separate bounded deployment-scratch cleaner is installed with `--apply`; the audit did not invoke it. No safe archive deletion is implied by age or by candidate classification alone.

**Recommended correction:** first approve a named, dependency-verified retention batch preserving both rollback roots, provenance and required evidence, or expand the UI volume. Then implement an approved predictable archive/off-host retention policy and retain peak deployment-space preflight checks. Monitor reserve headroom rather than only percent full. No cleanup was performed by this audit.

### Node data and database growth — continue H8-05 / H10-02

Initial allocated usage: Core **976,818,843,648 B**, Electrs **63,929,790,464 B**, PostgreSQL large-state tablespace **30,544,420,864 B**, PostgreSQL backup area **62,732,300,288 B**, general application backups **14,639,370,240 B**, release backups **12,136,243,200 B**, API cache **168,325,120 B**, `/tmp` **3,859,329,024 B**, `/var/log` **1,083,744,256 B**. These categories are measurements, not independently reclaimable totals.

`/data` has recovered substantial headroom relative to audit 18's roughly 81% utilization. This audit performed no reclamation and does not attribute intervening changes to an unverified automatic deletion. The installed one-day node trend showed net free-space improvement, so it correctly did not extrapolate a positive depletion rate. It still warned because release archives exceed their **8 GiB review threshold**. Future logical and physical backup refill creates foreseeable bursts despite that favorable short-term trend.

PostgreSQL **16.15** database size at 14:03:14 UTC was **31,117,245,463 B** (about 28.98 GiB), compared with **30,871,796,759 B** recorded in audit 18's late pass: approximately **245 MB growth in ten hours**, not a long-term forecast.

| Largest database relation | Total relation bytes | Meaning |
| --- | ---: | --- |
| `work_amo_block_transitions` | 29,731,053,568 | About 95.5% of the database; 8,217 transition rows with retained proof payloads |
| `ledger_snapshots` | 813,187,072 | About 19,970 estimated live rows; historical/current witnesses |
| `events` | 156,139,520 | Normalized protocol records |
| `transactions` | 106,545,152 | Raw/normalized transaction evidence |
| `event_participants` | 68,509,696 | Address/event associations |
| `tx_outputs` | 62,930,944 | Canonical outputs |
| `credit_listings` / `event_refs` | 41,590,784 / 41,582,592 | Sale state and event references |

These proof-bearing transition and snapshot rows are **not disposable cache**. Any compaction must preserve chain replay, historical witnesses, source hashes and dependent records. Large relations are on the `/data` tablespace; the UI filesystem is not their location.

Database catalog checks found zero invalid/not-ready indexes, zero unvalidated constraints, zero recorded deadlocks, and no sampled blocking/idle-in-transaction problem. Relevant large-state indexes are valid and ready. Autovacuum evidence is present. Estimated dead tuples alone do not establish reclaimable bloat. `temp_bytes = 1,566,306,809,040` is a **cumulative PostgreSQL statistic**, not 1.56 TB currently occupying temporary files.

Physical page checksums remain **off**, as previously documented. No full `amcheck`/heap-page verification, offline checksum enablement, exhaustive PostgreSQL file-log scan, or new restore was performed. Strong logical/chain parity cannot certify every physical page. SMART/NVMe wear tools are absent; none were installed. Continue the existing physical-integrity coverage item rather than assigning a duplicate issue ID.

### Canonical-summary publication capacity — continue H7-01 / H10-07 / A11-03

At height **967838**, snapshot `d74b707fefb9a5abd994ed0e` measured:

| Representation | Measured size | Active ceiling | Remaining |
| --- | ---: | ---: | ---: |
| Compact UTF-8 `JSON.stringify` | 19,596,556 B | 20,971,520 B (20 MiB) | **1,374,964 B (1.31 MiB); 93.44% used** |
| PostgreSQL JSONB text | 20,585,597 B | 23,592,960 B (22.5 MiB) | 3,007,363 B; 87.25% used |

The health endpoint's later `payloadBytes = 20,585,589` describes SQL text; comparing it with the compact ceiling would incorrectly report 98.16%. Most compact bytes are WORK summary (~6.18 MB), Token summary (~6.13 MB) and Marketplace summary (~6.71 MB). The scalar WORK sufficient-state witness is only **797 B**. No valid comparable daily/weekly growth sample was established.

This envelope can fill and stop canonical publication **before either disk fills**. Preserve completeness and exact witnesses while profiling/deduplicating the large summary projections. A blanket byte-limit increase provides temporary headroom and is not a durable size-control solution. Runtime limits are 20/22.5 MiB; canonical runbook passages still describe 16/18 MiB and need an approved documentation reconciliation.

## Node, indexer, ingestion and status accuracy

Core reported version **31.1**, main chain, unpruned, no initial block download, verification progress 1, no warnings, 124 peers in the initial sample. Transaction, coinstats and compact-filter indexes were synchronized. `verifychain 3 6` returned true: this validates that bounded six-block check, **not a new full-chain replay**. Electrs agreed with Core at the measured application checkpoints.

At 13:57 UTC one `/health/live` request returned 503 with an Electrum `blockchain.block.header` five-second timeout. The following strict health request recovered. At 14:10 UTC both health routes returned 200, and the final public sample at **14:12:37 UTC** was ready/OK at **967839**, hash `0000000000000000000049f6e4ac450386693f7b905f5e9e14ba95bc68fc5e76`, with Core/index/Electrs/txindex aligned and no worker failures. The later raw-transaction check observed Core **967840**; these are separately timed observations, not a claim that every subsystem was sampled atomically at 967840.

The worker's 14:03 receipt showed a successful 53.7-second cycle, Q16 replay ready, no canonical fault, no consecutive failure, and no unresolved global/Q16 pending state. Twenty-five stale pending candidates were checked with zero errors or deferrals. Runtime V8 writes are enabled and V7 writes disabled. Pending witness age allowance is 600,000 ms. The pending-witness containment suite passed the newly deployed stabilization scenarios.

### Full stored-population checks

The evidence distinguishes **confirmed storage reconciliation** from **discovery completeness**. Root SQL connections enforced read-only mode with bounded statements/locks; math population queries used repeatable-read read-only transactions. Checks have separate time-local boundaries. The complete audit was not one database or mempool snapshot.

| Population / check | Result |
| --- | --- |
| All 19,838 indexed canonical blocks, heights 948000–967837 | No height gaps or previous-hash breaks; every hash matched Core `getblockhash` |
| All 25,589 stored confirmed transactions | Exact raw bytes, txid, positive Core confirmation and source block match; zero RPC errors |
| All normalized inputs/outputs | 30,664 inputs and 77,163 outputs match Core values and coordinates; scripts/sequence/prevout references checked; per-transaction input/output cardinalities also match |
| Parent values / transaction positions | 2,895 additional input parents fetched; all stored tx positions verified across 2,207 Core block transaction lists |
| Fees | For every stored confirmed transaction, complete input sum minus output sum equals stored fee |
| All 25,711 confirmed decoded OP_RETURN rows | Raw push-decoded bytes, stored byte length, payload hex and UTF-8/null text normalization agree |
| All six stored file attachments | Complete chunks; declared size and SHA256 match reconstructed bytes |
| Initial 26,447 events / 25,842 transactions | No duplicate event keys/txids, missing confirmed parent, incorrect confirmed-parent height/index, missing raw transaction, or volatile child attached to a confirmed parent |
| IDs, tickets and relations | 505 stored IDs; no duplicate canonical IDs or sale-ticket outpoints; no orphan/duplicate participants or references |
| Confirmed event times | All 26,267 confirmed events have event and block time |

The final transaction check ran at 14:18:13–14:18:34 UTC with Core stable at 967840 and unchanged 25,589 confirmed stored transactions. Decimal Core JSON amounts were parsed as exact decimal strings before integer proof conversion, not through binary floating-point arithmetic. It explicitly extended the earlier raw comparison to verify input/output **cardinality**, closing the possibility of silently missing a zero-valued output in a value-only comparison.

This establishes integrity of the **stored** confirmed population. It does not independently rescan every raw block for every possible protocol candidate or reconstruct every historical ownership/signature decision from genesis. An omitted event not already represented in indexed storage is outside that proof.

### Semantic event/address/mail reconciliation

The existing `indexer:parity` pass recomputed normalized semantic relations for **26,448** events (26,267 confirmed, 176 pending, five dropped at its later sample):

- **125,966 participants:** expected equals observed; zero missing/extra.
- **56,262 references:** expected equals observed; zero missing/extra.
- **616 Mail projections:** zero missing, extra, mismatched, duplicate or incorrect volatile overlay rows.
- Event-payload/status consistency passed, along with the remaining registry, holder, token, history and search checks except the qualified nonpasses below.

Changing pending counts across separately timed receipts are not duplicates. A confirmed record can be protocol-invalid and still belong to confirmed chain history: the UI's **25,927 valid confirmed actions** is not the same population as all **26,267 confirmed event rows**. Addresses are reconciled through semantic participant/ref/mail parity and normalized transaction evidence; this does not prove every address's complete external-chain history or every local contact/folder state.

**Overall parity was not green: 98 of 102 checks passed, with two errors and two warnings.**

1. `canonical-summary-snapshot-current` compared API snapshot `2197e6255403c5a74b5d0574` with database snapshot `b66ce19974319da7773d2ed5`, both at 967837. The first was no longer present on follow-up. This demonstrates the same-height publication/read-fence mismatch during changing state; it does not establish chain corruption. Continue the existing snapshot/readiness family and require a coherent pinned read for certification.
2. `confirmed-transactions-have-canonical-block-proof` still flags four **previously known H9-03 auxiliary transactions** because `raw_tx.canonicalBlockScan` is absent. Their repaired raw bytes, normalized rows, canonical hashes and actual Core transaction positions all pass. The source is `canonical-listing-outpoint-scan`; do not fabricate block-scan provenance to silence the checker.
3. Two historical V5 migration/USD quote warnings remain in the legacy parity gate. Current Q16/V8 readiness and V8 population checks are separate and passed. These warnings are not proof that active V8 terms failed.

The four continuing H9-03 IDs are `8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf`, `939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c`, `4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212`, and `4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359`. Any approved follow-up must distinguish valid auxiliary canonical evidence from a true missing block-scan record without rewriting history dishonestly.

### Mempool

Core mempool was loaded and operational, with about 80,000 transactions during the population probe. The initial node sample used about 226 MB of its configured 2 GB memory budget. Relay was full-RBF; the configured data-carrier allowance was 100,000 bytes.

All **177 database-pending transactions** appeared in **both** Core samples bracketing the SQL read. All **76 database-dropped transactions** were absent from both. The samples contained 80,304 and 80,306 transactions, and their membership digests are preserved. No incorrect stored pending/dropped membership was found in this check. It did not establish that every unindexed candidate among the entire Core mempool had been discovered.

Pending seals were rendered pending in Log; confirmed transfers/seals were rendered confirmed. Pending overlays did not alter confirmed credit supply. No deliberate RBF, eviction, reorg, conflicting spend or signing test was injected. Local pending-witness fixtures passed; live pending visibility remains best-effort.

### Audit gates that did not complete

- Authenticated, loopback, source-pinned **`audit:ids`** failed its initial `id-registry-audit-fence` with HTTP 503. A separate bounded request received no response within **70.06 seconds**. Credentials were available and used; this was not an authentication-denied result. The complete historical ID owner/fee/lifecycle audit was therefore **not freshly certified**. Audit 17's previous full protected pass remains historical evidence, not a substitute for a successful current pass.
- **`audit:computer-events`**, using a verified read-only database connection, stopped on a strict health HTTP 503 before completing its full gate. The population/semantic checks above provide substantial independent coverage but do not convert this failed gate into a pass.

Preserve fail-closed fences. Investigate bounded exact-checkpoint reads and endpoint latency, then rerun these gates on a coherent checkpoint. The 1,000-proof new-ID registration fee and 546-proof update/transfer/list/seal/delist/buy split remain the required rules; local contract fixtures pass, but no claim of fresh exhaustive historical ID-fee replay is made.

## Math verification

### Deterministic calculation checks

Eleven existing math/contract suites passed: WORK precision (131 checks), Q16 precision, exact bond arithmetic, V8 and gates, historical V5/V6/V2 compatibility, canonical ordering, INCB range witnesses, INCB oracle restore (28 checks), and ID-audit contract fixtures. The independent seeded checker performed **65,540 assertions across 4,096 generated inputs** using seed `0x87654321` on Node 22.23.2. It checked frontend/server Q16 parse/format parity, exact Q8 decimals, historical-unit conversion, movement value identities, V8 integer inequalities, supply bounds and one-subatom boundaries.

Two initial independent-harness API/type assumptions were corrected before the final pass; those were audit harness errors. Production Node reported 24.18.0 in the protected-gate traces. This is finite deterministic evidence, not a proof that arbitrary future inputs or all protocol implementations cannot fail.

For V8, with `S = 21,000,000`, `A = 10^16`, `Q = 10^8`, and `N` the exact network-value Q8 before bonding:

```text
face = price = 25,000 proofs
amountSubatoms = floor(25,000 × S × A × Q / N)
minimumPriceProofs = ceil(amountSubatoms × N / (S × A × Q))
```

All **961 stored V8 frozen terms** satisfy the formula, ceiling, positivity, cap, compute-before-bond transition and frozen-field aliases. All bind to their valid confirmed listing event and canonical block coordinates.

All **8,217 transition scalar rows**, heights 959621–967837, have continuous height/hash/value and required complete/fee-once/invalid-zero/block-atomic flags. The sole state-hash boundary is the documented Q16 cutover at **960601**. This validates scalar continuity and stored flags; it does not reexecute or cryptographically rehash every large historical transition payload.

### Supply, balances and issuance

All **238 confirmed credit definitions**, **21,875 accepted confirmed mint events** and **405 holder rows** reconcile. No supply cap excess, negative/fractional/nonfinite balance, or nonzero pending supply delta was found. The independent structural probe counted zero rows with nonzero `pending_delta`; this is stronger than the separate math query's aggregate-zero result alone.

| Asset | Confirmed issued / holder sum | Mint events | Holders |
| --- | ---: | ---: | ---: |
| WORK | 210000000000000000000000 subatoms = 21,000,000 WORK | 21,000 | 357 |
| POWB | 630496569 units | 467 | 11 |
| INCB | 224847713398447926 units | 46 | 7 |

All 467 POWB synthetic mints bind their valid confirmed parent bond and correct recipient output/value; units equal recipient proofs. All 46 INCB synthetic mints likewise bind the parent/output and carry zero separately attributed proof value, preventing synthetic issuance from double-counting economic input.

For every valid confirmed INCB mint, integer issuance, direct-plus-attached composition, floor, remainder/dust, the audited Q8/decimal aliases and H-1 height relations pass. Population totals:

```text
issuanceValueQ8       = 22484771339844794793582060
directProofs          = 27386
attachedValueQ8       = 22484771339842056193582060
issuedUnits           = 224847713398447926
sumPerEventDustQ8     = 2193582060
```

The dust sum is the sum of each mint's integer-division remainder; it is not one final aggregate remainder. All **46 source transactions** and **29 distinct H-1 Core hashes** passed **356** independent binding checks, including raw WORK attachment amounts, recipient outputs, inclusion and snapshot commitments/value.

Forty mints bind 26 present historical green snapshots. Six mints use three **explicitly approved absent-snapshot witnesses** (`35bf2b05cd91025920df228c`, `895dbf988e2f77fc89c1757c`, `7ab9dad4300df08edf54e80f`) documented in the [September 13 canonical INCB repair](2026-09-13-incb-production-canonical-repair.md). They match code-pinned H-1 values and are not new missing-data corruption. Do not synthesize or replace those historical rows merely to make a simple join green.

The earlier repair covered 197 decimal aliases across 40 records. This pass specifically certifies zero mismatch in the audited aliases across the **46 valid confirmed mint population**; it does not infer full repair-manifest coverage from that differently scoped count.

### H19-01 — new: fresh WORK token statistics contradict canonical consistency

**Priority: high. Status: open; no repair made.** Exact reproduction is preserved in `newFindings[0]` of the evidence artifact, bound to the original fresh-response SHA256 `ad5759dc6ce70389d9b2b6e19dafcd42f043f358e577be57c01d8e8e7b52c23d`.

At height **967838**, snapshot **`d74b707fefb9a5abd994ed0e`**, a successful fresh WORK token response reports `confirmedRead.mode = exact-tip`, ready true and green consistency, yet contains:

| Field in that same response | Exact Q8 value |
| --- | ---: |
| `stats.creditEventFrozenValueQ8` | `35018484903592651076250105` |
| Canonical consistency detail `creditEventFrozenValueQ8` | `103731127226107847456137879` |
| Difference | **`68712642322515196379887774`** |

The difference is **687126423225151963.79887774 proofs**. This exact-string contradiction cannot be explained by binary floating-point formatting or time between requests. Live credit statistics also report approximately `2.831568779898371e18`, versus approximately `8.387622145025232e18` in that response's canonical consistency. The frozen Q8 fields are the decisive exact evidence; live Q8 aliases are absent from the token statistics.

**Source:** [server/proof-api.mjs](../server/proof-api.mjs), at inspected HEAD: `creditNetworkValueMetrics` runs at line 49910; token/work-token states are enriched at 49930/49934. `workFloorWithVerifiedWorkAmoV5ClosingState` updates only `workFloor` at 49991. The result retains the earlier valued token states at 50073/50075. Enrichment at 20293–20331 copies the same global aggregates into both states, so asset scoping does not explain this discrepancy. Consistency checks at 46572/46589 inspect corrected values without checking equality against these exposed statistics.

**Impact:** API clients can receive materially conflicting economic aggregates under a green/exact-tip consistency label. Main WORK, AMO, Growth and Computer headline panels use `workFloor.actualValue` and were observed correct. No direct frontend `stats.credit*` consumer was identified. Account-specific movement rows consume per-event valuations, but no connected-wallet misvaluation was demonstrated. Stored balances, frozen V8 terms and INCB issuance passed the independent checks; no settlement loss or ledger corruption is established by this finding.

**Recommended approved correction:** propagate the exact canonical closing aggregates through token and WORK-token summaries after reconciliation; expose exact Q8 aliases consistently; add same-response, same-checkpoint equality assertions across these projections and fail closed on disagreement. Independently check any affected per-event valuation consumers against their own frozen witnesses. **Do not reprice immutable history, reseed balances, or alter ledger records to repair a response projection.**

The predecessor review found no equivalent prior aggregate-projection finding. This is separate from repaired INCB decimal aliases, UI units, endpoint latency and summary size.

### Previously recorded Boost writer validation lead

The [audit 17 safe-stop handoff](2026-09-19-audit-17-safe-stop-handoff.md) already identified this lead. Direct execution of the actual writer functions now demonstrates fractional inputs silently becoming different integers:

- `boostSaleAuthorizationDraft`: price `1.9` becomes `1`.
- `normalizeOutput`: payment `0.9` becomes `0`.
- `normalizeOutpoint`: output index `1.9` becomes `1`.

Source anchors are `src/features/boost/boostProtocol.ts:292`, `boostWallet.ts:447/466`, and `BoostRoot.tsx:1143`. Native number-input `step=1` mitigates ordinary form submission. No erroneous live transaction or loss was demonstrated. Continue the existing lead, with recommended original-input `Number.isSafeInteger` validation at writer boundaries and malformed-input fixtures. Decimal fee rates require their separate intended policy. Editing/deploying the correction needs approval.

## APIs, rendering and event visibility

All 14 surfaces were visited, standalone first and Computer last. The automated runner covered 13 surfaces; Boost was checked separately. All HTML and required asset checks passed. **12 of 13 API validators passed**: the stable Wallet/WORK-token validator required a listing-authority object that current code supplies only for a fresh authority request. A fresh retry verified the authority successfully. Record this harness/route-contract mismatch instead of reopening the old missing-fresh-authority issue.

| Surface / flow | Result and boundary |
| --- | --- |
| Home / IDs | 505 confirmed + 22 pending IDs visible; registration-only IDs flow and 1,000-proof registration displayed |
| Desktop | Public JPEG rendered; 6,284 bytes and SHA256 matched the reconstructed Core-backed attachment |
| Browser | Historical `8c2fd17b…c3015b` rendered confirmed HTML; exact 1,018-byte body and SHA256 matched Core-backed bytes |
| Boost | Six confirmed items, including replies/reboosts and media, rendered; all item values and total independently recomputed using integer math |
| AMO | Slow initial load, then complete book: 238 assets, 884 credit/bond tickets, 83 credit sales in the observed sample |
| Credit | Directory and selected asset/creation/mint controls loaded; no mutation exercised |
| Wallet | Disconnected/installation boundary and disabled transaction actions; connected-account behavior not certified |
| WORK | Fixed 21 million supply, 357 holders, 21,000 mints; exact headline floor/value agrees across surfaces |
| Infinity / Inception | Correct supply/issuance summary and explicit provenance; complete listing hydration hit checkpoint fences and remained uncertified |
| Log | Confirmed/pending labels observed; historical Browser tx search returned one confirmed result and persisted through refresh |
| Growth | Exact headline WORK values agree; modeled and chain-backed figures separated |
| Computer | WORK refresh, Boost/media and Log search succeed; Inbox remains behind the local wallet boundary |

Browser body SHA256: `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`. Desktop JPEG SHA256: `98e75adcc612894c206681ab4eab4e4e5a2fa0b3d07169cc00aaaa57f38b422a`. Immutable historical text was not edited. All six attachment size/hash receipts are retained.

Eight Mail regressions and two OTC normalized-bond Log/Event regressions passed. `audit:ledger` passed at snapshot `2197e6255403c5a74b5d0574`, exact network value **8387622148429837422.3643432 proofs**. Headline WORK floor was **399410578496.65892487 proofs/WORK**. These gates did not inspect every token-stat alias and therefore did not detect H19-01.

Fresh WORK's first request returned 503 during a tip change; the successful retry took **41.57 seconds**. It checked all 961 listing outpoints, identified 78 spent and **883 unspent**, and returned a complete Core authority witness. Its compact listing preview contained **846** rows with explicit `summaryOnly`/`hasMore` and total 883; a preview is not a complete book. Ordinary sampled data responses took roughly **4–13 seconds**, with earlier observation logs showing responses up to about **78.7 MB**. Infinity/Inception pagination hit checkpoint-change/restart fences. Continue **H5-06 / H10-05 / H12-06 / H18-03/09/10**; correct fail-closed behavior does not imply adequate availability.

Computer Log initially restored an explicitly dated September 19 cache, then automatically refreshed its body to the current checkpoint. A loaded-count banner retained its older count until search. This is a **minor display-coherence observation**, not a newly proven canonical-data defect. H6-15's specific disappearing search-row case was not reproduced, and H6-18's WORK network-value banner units were correct.

No exhaustive pixel/browser/mobile matrix, every-record rendering, connected-wallet lifecycle, seller-signature campaign, private contacts/folders/decryption audit, or adversarial replacement/reorg test was performed. Treasury/refund/bounty artifacts were reviewed for prior findings and hashed for preservation; every historical payout, refund decision and off-protocol financial ledger entry was not independently replayed. No private wallet material was handled.

## Logs, backups, caches and retained material

Available 24-hour kernel/warning journal streams on both hosts had zero matched OOM, I/O error, corruption, ENOSPC/disk-full or deadlock phrases. Node application journals contained 241,016 entries, with 187 timeout-keyword and ten canonical-unavailable matches; UI Caddy had 99 entries with six timeout-keyword matches. These are **keyword matches, not independently triaged incident counts**. Current green health does not erase historical latency/errors. Raw client IP/message logs were not copied into the audit artifact. Separate PostgreSQL file logs were not exhaustively scanned.

Failed monitoring units were inspected rather than reset. Node storage-trend warns about release allocation; API observation warns about latency/payload/error rates; release-health warns about retained checkout count. Some historical audit one-shot failures remain as evidence. UI storage-trend warns about reserve forecast; UI storage/provenance/release dry-run units otherwise reported success. These are not all crashed serving processes.

Current node release archive dry-run verified **43 archives**, zero unverified, **40 candidate sets** at keep 3. The latest actual `/opt/proofofwork-api*` immediate physical-directory count is **31**, above the target nine; the stored earlier health failure counted 29. Continue **H5-03 / H10-03 / A11-06 / H18-04**. The audit did not prune checkouts or reset the failed monitor.

Latest UI provenance verification succeeded for release `0ef9c3bee321-20260920T053656Z`, archive SHA256 `192dff161a8587b280624bc0a0685123c7e278d6684c0a06000980fec42bc3cf`. All retention candidate names are preserved in evidence for a later approval review; no candidates were deleted.

### Backup verification and refill exposure

- Latest logical dump set: `/data/proofofwork-postgres-backups/logical/proof_indexer-20260920T031848Z.dumpset`, successful completion 03:32:43 UTC. Dump **16,213,820,318 B**; globals 1,137 B. Both existing SHA256SUMS entries passed a fresh checksum check at 14:05 UTC. Globals contents were not exposed.
- One standard logical set currently exists. The daily script's **keep 7 is review/preserve behavior, not automatic deletion**; incomplete old sets are also preserved. Refilling to seven at today's dump size alone adds **97,282,921,908 B (90.6 GiB)** before growth. Accumulation can continue beyond seven without approved retention. Its 100 GiB reserve and dump-size guard reduce immediate exhaustion risk but do not implement durable retention.
- Historical dump sizes rose from 15.08 GB September 17 to 16.21 GB September 20, about 377 MB/day over three intervals. This short history is not a stable growth law.
- Latest physical set: `/var/backups/postgresql/16-main/2026-09-19T044045Z.backup`, successful September 19 completion, 822 seconds. Its manifest metadata/hash were inspected; physical archive contents were not all freshly verified. The weekly unit uses keep 3 and expires older base backups after a successful backup. From one current set, refill adds roughly **37.6 GB** at current sizes, before growth/WAL.
- `/var/backups/postgresql` is currently a **bind mount** of the `/data` physical-backup directory; both paths have the same device/inode. Do not double-count it or rely on older symlink wording.
- WAL receiver and slot `pg_receivewal_service` are active/reserved. Sample lag **1,583,104 B**, `safe_wal_size = 17,195,063,296 B`; 548 archive files including an actively updated partial. Continue H10-01's repair as operational. Preserved lost-slot WAL remains evidence.
- Audit 17's same-host logical restore/PITR receipts remain historical. This pass did not newly prove off-host recovery, roles/grants, all WAL gaps, physical page integrity or external alert delivery.

No cache/temp/log allocation was demonstrated to be safely obsolete and removed. General backups, suspect/recovery sets, WAL history, chain-backed witnesses, financial ledgers, refund artifacts and rollback dependencies remain protected. Old notes and generated artifacts were reviewed for meaning and classification, not treated as trash because of their date.

Host network counters since boot: UI physical interface received **1,177,855,352,266 B** and sent **152,212,248,813 B**; node received **1,302,104,010,546 B** and sent **10,524,881,342,881 B**. Sampled RX/TX errors/drops were zero. These resettable counters are not provider monthly quota/billing measurements; loopback/tunnel/container traffic must not be added to them as independent external usage.

## Prior findings rechecked

The [audit 18 predecessor](2026-09-20-production-comprehensive-health-data-integrity-audit-18.md), [audit 17](2026-09-19-production-comprehensive-health-data-integrity-audit-17.md), its [safe-stop handoff](2026-09-19-audit-17-safe-stop-handoff.md), and earlier linked records remain authoritative for historical actions. Their hashes and the broader 41-artifact inventory are in evidence.

| Existing finding / repair | Current disposition |
| --- | --- |
| UI storage H5-01/H13-01; node storage H8-05/H10-02 | Still open; updated exact reserve and backup-refill evidence above |
| Summary size H7-01/H10-07/A11-03 | Still open; compact envelope 93.44% utilized |
| Readiness/latency H5-06/H10-05/H12-06 | Still open; current successful readiness plus 503s, long reads and incomplete gates |
| Release health H5-03/H10-03/A11-06 | Archives verify; 31 node checkouts remain above bounded inventory |
| H9-03 four missing raw records | Raw repair remains valid against Core; missing scan-marker qualification still open |
| 1,816 repaired event timestamps | Current entire confirmed event population has both timestamps |
| H9-04/H9-05/H6-02 participant/ref/Mail repairs | Current entire semantic population has zero differences |
| INCB decimal alias repair | All 46 valid confirmed mints pass the audited exact aliases; preserve scope distinction from old repair manifest |
| H10-01/A11-04/H12-01 WAL loss | Replacement slot/receiver operational; no new restore certification |
| Q16/canonical recovery H7-02/H8 families | Current zero-lag ready receipts and local gates pass; historical seeds and exceptions preserved |
| H9-07/H10-06/A11-07 UI ops fixture timeout; H18-05/11 | Current `check:ui-ops` passes in 189.856 s; 180-second harness issue repaired with qualified reduced fixture workload |
| H13-04 node-ops false positive / hardening portability | Current node-ops and hardening checks pass |
| H6-18 banner units; H6-15 specific search-row regression | Correct current banner; historical tx search retained through refresh |
| H6-01 Boost authority / broader live lifecycle | Public rendering/current calculations pass; no new full seller-signature or connected-wallet certification |
| Physical checksums/off-host restore | Longstanding verification gap remains; no duplicate new issue |
| Audit 17 fractional Boost writer lead | Reproduced at actual writer functions; malformed-input rejection correction still requires approval |

Other prior mobile, adversarial status, identity, wallet and source-lifecycle cases are **not blanket-closed** by representative successful rendering. The new finding register contains only H19-01. Stable-validator contract mismatch and the transient Log count banner are explicitly qualified observations.

## Actions, approval items and follow-up

Actions taken were repository/document/source review, read-only SSH/SQL/Core RPC, public HTTP and browser inspection, bounded existing suites, independent integer arithmetic and creation of this log/evidence. Production GET requests and existing services can naturally update operational caches/logs while being read; the audit did not invoke a data/config mutation, cleanup, backfill, reindex, restart or restore.

The only repository updates are this audit, its evidence artifact, and their protected audit classification in `repository-hygiene.json`. The pre-existing untracked `deploy/audit17/publish-node-work-floor.py` was preserved. No financial ledger, earlier audit or historical record was rewritten.

Recommended next actions, in priority order:

1. **Approve an H19-01 API projection correction** with exact same-response assertions, then rerun value/ledger/API checks without modifying canonical history.
2. **Approve UI capacity relief before another large deployment**: explicit safe retention candidates or volume expansion, with both rollback roots and evidence preserved. Establish predictable approved retention; report-only timers do not provide it.
3. **Approve a summary-size reduction and latency investigation** focused on large projections, coherent checkpoint reads and complete-book pagination. Preserve canonical fences; do not mark stale/pending state confirmed to improve availability.
4. Resolve the known auxiliary scan-provenance qualification honestly and rerun `indexer:parity`, protected `audit:ids` and `audit:computer-events` to completion on a coherent checkpoint. Do not manufacture scan metadata.
5. Plan logical/physical backup refill plus Core growth against the node reserve. Approve named archive/checkout retention only after dependency review; separately verify off-host restore and physical database integrity in an appropriate maintenance environment.
6. Approve the existing Boost malformed-input validation correction, and reconcile runbook drift: active 20/22.5 MiB caps, multiple-root UI retention behavior, actual physical backup bind mount, and report-only versus automatic retention. No protocol migration is proposed.

These are recommendations and approval boundaries, not granted authority or scheduled work. No cleanup amount is claimed as reclaimed. No promise that every possible record or future calculation is correct follows from the finite checks above.

## Repository verification and durable handoff

The operating memory, canonical protocol/product documents, classified note inventory, tracked generated artifacts, safe cleanup allowlist, working tree and final diff were reviewed. This audit changes no product/protocol behavior, so no artificial `SOUL.md` edit was made. Known infrastructure-document drift is recorded for an approved follow-up rather than silently rewriting historical claims outside the audit scope.

Existing checks completed: all 11 math suites; 65,540 independent arithmetic assertions; worker containment; UI ops; hardening; node ops; storage trend; production observability after a network-capable retry; Mail regressions and ledger consistency. UI ops now exercises actual accept/reject branches at a smaller 2/3 dependency fixture boundary while source-pinning the production 1,024 limit; it is not a new 1,024-file-volume test. Initial sandbox DNS failures and an audit URL typo are harness/environment limitations, not product failures. The failed/incomplete live gates are reported above and were not relabeled passed.

Hygiene completion and the final evidence hash are recorded below after review. All 41 predecessor hashes were independently verified against the checkout. The evidence JSON parses and its embedded Python reproduction sources compile. Nothing is staged or committed by this audit.

- Evidence SHA256: `63c83279344e99372a850eb02881147ea2a3f84afdf8f17431a774344cca5b96` (330,727 bytes).
- `npm run hygiene:fix`: passed; no allowlisted rebuildable state found, nothing removed.
- `npm run hygiene:check`: passed; repository state check successful.

Future agents should first verify the evidence hash and its predecessor inventory against this checkout, read unresolved items with their original IDs, and attach later approved actions as new receipts. A green later checkpoint may close an availability observation, but does not by itself close H19-01, physical integrity gaps, retention exposure or a failed exhaustive gate.

---

## Ordered read-only application audit addendum — 2026-09-20

### Scope, continuity and authority

**Observation window: September 20, 2026, 14:33–15:00:33 UTC (10:33–11:00:33 America/Toronto).** This addendum follows the user's second, narrower instruction: review the fourteen application surfaces in the specified order, Computer last, make no improvements or cleanup, and append completed findings to this existing log. All thirteen other surfaces were reviewed before the first Computer navigation. Independent backend/source verification ran alongside the ordered surface review; it did not visit public surfaces out of order.

The operating documents had been read in the required order during this audit session. All prior audit/issue records and relevant remediation continuations were reviewed before production inspection; all **41 predecessor artifact hashes** and the original Audit 19 evidence hash were reverified. Source remained `0ef9c3bee3212a4cb0ae6efe7abbb6a75be72ffa`. Five selected live-node source/declaration/migration files matched the local checkout. The previous sections remain the historical first observation window, including their earlier check results and limitations; this append supersedes only the current disposition where explicitly stated.

Before this append, this Markdown was **45,149 bytes**, SHA256 `ad0b9e728bbeb77ee808ce66c47fc4e1e4fc4a243eea4b4d8d39fe770807cb03`. Those bytes are preserved verbatim as the prefix. The original evidence JSON remains **330,727 bytes**, SHA256 `63c83279344e99372a850eb02881147ea2a3f84afdf8f17431a774344cca5b96`. The already modified hygiene manifest and pre-existing untracked deployment script were preserved.

**Result: operational, with unresolved integrity and reliability risks; no all-clear.** The final Core/Electrs/indexer/transaction-index checks agreed at block **967846** and public Computer readiness and all 24 built-in consistency checks were green. Independent checks nevertheless demonstrate a **new high-priority Wallet/replay spendability discrepancy (H19-04)** and two **new conditional transaction-detail status defects (H19-02/H19-03)**. Existing H19-01 reproduces. Correct current headlines and green built-in checks do not certify every consumer or write path.

Only this completed Markdown append is newly authorized repository work. No code, configuration, production data, database, ledger, backup, existing log, infrastructure, deployment or service was changed; no cleanup, restart, backfill, signing, broadcast, commit or push occurred. Read requests can naturally be recorded by existing logging/cache mechanisms. Browser navigation/search/refresh and local temporary audit receipts are inspection activity, not production fixes.

### Pages reviewed in the requested order

HTTP durations are elapsed time for one complete read from this audit client, including body transfer and local JSON receipt handling. They are not server CPU time, p95 latency, or browser navigation timing. Byte counts below are the original response-body bytes; saved pretty-printed JSON hashes/lengths differ, as explicitly recorded in the embedded receipts. Successful navigation does not imply complete market hydration.

| Order / surface | Read-only UI result and bounded coverage | Own-origin API observation |
| --- | --- | --- |
| 1. Home | Redirected to `www`; 505 confirmed/22 pending/527 visible IDs. Quote ellipsis repair remains; displayed quote segments match Core's message. | Registry summary 200, 7.267 s, 498,541 B; checkpoint 967841. |
| 2. ID | Registration-only surface retained. `carbonz` correctly taken; current owner/receiver and original registration reference agree with the Core-verified ownership lifecycle. No wallet connected. | ID summary 200, 3.914 s, 498,541 B; same 967841 response content as Home. |
| 3. Desktop | Opened a public address, rendered `pepe mic drop.jpeg`; image decoded at 238×212. Size 6,284 B and SHA256 match Core. | Log summary 200, 6.015 s, 104,842 B. |
| 4. Browser | Known confirmed HTML rendered; exact 1,018 B body/hash match Core. Actual iframe has empty sandbox and `no-referrer`; restrictive outer CSP and inert content are present. | Transaction detail 200, 0.463 s, 5,811 B, `no-store`. Conditional failure/reorg defects found separately below. |
| 5. Boost | Initial complete-registry/checkpoint error was explicit. One bounded refresh recovered six confirmed records, media and exact signal values. No social action submitted. | First 409, 7.807 s; retry 200, 7.862 s, 10,913 B at 967844. |
| 6. AMO | Last verified preview shown with dated checkpoint and incomplete-book warning. WORK listing/seal references and disabled disconnected purchase controls inspected. A later preview had 855 visible credit tickets against 886 declared credit/bond tickets; no complete-book certification. | Summary 503, 6.937 s: registry checkpoint catching up to Core. Console also reported deferred full-book hydration/Core evidence. Existing availability family continues. |
| 7. Credit | Directory loaded 236 credits (the broader 238 count includes the two bond definitions). DRAIN facts, holders, fee and funding preview inspected. Disconnected mutation controls disabled. | Compact token summary 200, 8.711 s, 6,187,525 B. A 46.4 s automation navigation call is not asserted as API latency. |
| 8. Wallet | Disconnected view inspected; zeros/loading are not a user's certified balances. Separate public-address query supplies actual wallet accounting for H19-04, without connecting/signing. | Fresh WORK 200, 14.305 s, 5,712,129 B; complete authoritative wallet-scoped response 200, 13.104 s, 4,967,881 B, `no-store`; both 967846. |
| 9. WORK | 21,000,000 minted, 21,000 mints, 357 holders; minted-out controls disabled. Exact live/frozen floors and funding preview agree with arithmetic. Generic verifying banner remained despite loaded body. | Compact WORK summary 200, 10.536 s, 6,331,519 B at 967846. |
| 10. Infinity | 630,496,569 POWB, 0 pending, floor 1.00000779 proofs. One sealed hard-price listing/its seal inspected; market completeness warning retained. | Summary 200, 8.530 s, 213,974 B at 967846. |
| 11. Inception | Exact fixed supply/issuance/dust and H−1 provenance rendered; later WORK value explicitly does not reprice issuance. Empty active-book claim withheld while complete book loads. | Summary 200, 6.838 s, 46,702 B at 967846. |
| 12. Log | Current confirmed events and pending ID labels inspected. Historical HTML transaction search returns one confirmed record and survives refresh. Free-text `pending` also exposes an existing search/status coherence problem described below. | Summary 200, 6.015 s, 105,080 B at 967846. |
| 13. Growth | Initial verified-ledger-unavailable state recovered automatically. Exact real value agrees with WORK; forecast is clearly separate. Boost product observations remained explicitly unavailable at this snapshot. | Summary 200, 6.125 s, 175,466 B at 967846. |
| 14. Computer — last | Inbox/local-account boundary, WORK and refresh banner, Browser HTML, Boost/image, Log/search/refresh and IDs management boundary inspected. WORK banner reports 884 open records, 851 buyable, 83 sales, 0 pending and the correct exact network value. | Health alias and documented `/health` both 200 (2.220/2.195 s); consistency 200, 9.074 s, 18,870 B, 24/24 built-in checks green at 967846. |

Each domain's response supplied HSTS (one year, includeSubDomains), nosniff, frame denial, restrictive permissions and a self-script CSP. Public GET CORS is wildcard; that is not proof of credential exposure. Page-specific console errors were attributed by origin, since the browser's log collection retains prior navigations. No new own-origin console error was observed on WORK, either bond application, Log, Growth or Computer; the recorded AMO hydration errors were not incorrectly assigned to later pages.

### Full-node, event and data verification

Core is the authority for confirmation, canonical block membership, physical transaction/carrier bytes and ticket outpoints. Application-level credit balances, valuations and admission rules additionally require deterministic protocol replay; a full node does not natively compute those application balances merely because it validates the carrier transaction.

- All four distinct top-level API checkpoint pairs captured in this pass — **967841, 967842, 967844 and 967846** — match direct Core `getblockhash`. Final canonical hash at 967846: `000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe`. Different heights/snapshot IDs during a progressing chain were not treated as corruption. Wallet-scoped snapshot identity also legitimately differs from global summary identity.
- The first window checked all 25,589 then-confirmed stored transactions. This continuation independently checked the **nine new confirmed transactions**, all at 967844 positions 243–251: raw bytes, nine inputs, 28 outputs, scripts, amounts, input-parent values, fees, positions and nine OP_RETURN carriers match Core. Stored confirmed transaction count is now **25,598**. Nine new event rows have no duplicate identity/participant/reference, timestamp, confirmed-parent or volatile-child anomalies. This is structural delta coverage, not a fresh complete semantic resolver replay.
- The ten indexed boundary/current blocks **967837–967846** match Core with no gaps or predecessor-link differences. The earlier whole-history scan remains the separately dated evidence above; no claim is made that every raw block was newly rediscovered in this continuation.
- At 14:55:36–37 UTC, Core mempool contained 76,808 then 76,810 transactions. All **173 database-pending** transactions were present in both samples; all **76 database-dropped** transactions were absent in both. This certifies the observed database population, not discovery of every possible protocol candidate in the whole mempool.
- The displayed `f4nn3r` registration `8e55c2a1e53d4a4011fbb762f39fde539985a6776e6ce263556e6ca5f235a725` is in Core mempool before/after its focused check, zero confirmations, no block hash, with exactly **1,000 registry proofs** and a 40-proof miner fee. Its 143-byte `pwid1:r2` physical carrier payload matches the stored pending event and script-witness payload (eight checks pass). The pending registry-item representation has no normalized raw-hex/OP_RETURN row; absence of that field is not conflicting bytes. Confirmed normalization and best-effort pending representations must remain distinguished.
- The six Boost records and the POWB listing `dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46` / seal `720311f99aad3368946de248fd833d1c555ed0e001cbee0931ded5d099146b72` all have positive confirmations and canonical membership in direct Core reads.
- Home quote transaction `d9c41aef1e84a51bbc96fe81506f511cd9cead8ceaae8349f9f3f64bb50acd69` matches the rendered excerpts. Browser `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b` has body SHA256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`; Desktop `e6ad5d7c10e19bd3e34155061ba05ed4862b2aecf35ae4dc5f59a10aedaf22a1` has file SHA256 `98e75adcc612894c206681ab4eab4e5a2fa0b3d07169cc00aaaa57f38b422a`. Both match independently decoded Core carriers and actual rendered media/content.
- `carbonz` registration, listing, seal and purchase payloads and canonical coordinates pass 20 Core binding checks. Purchase spends listing vout 2, pays the original seller **10,546 proofs = 10,000 price + 546 ticket**, and pays registry 546. Current owner/receiver `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW` is legitimate; retaining original registration txid does not imply an incorrect owner.

Final public health was ready with zero lag, no IBD, unpruned Core, synchronized transaction/coinstats/block-filter indexes, Electrs at the same hash, no worker consecutive failure, no unresolved pending/Q16 items and inactive scan containment. PostgreSQL and its canonical metadata check passed. These sampled checks do not close intermittent availability problems or replace physical database checksums/restore testing.

### Independent math verification

**On-chain declarations:** V5 corrective `54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36` at 959620/activation 959621; V6 `975fd82aa84995e014b240618ee1a1254d0a735e6e1241372d0bed0a0d9f0799` at 960218/960219; V8 `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a` at 960600/960601. Physical payload, canonical coordinates, first-input authority and qualifying registry payment passed **26 applicable checks**. V6/V8 complete payload bytes equal local generated records; V5 matches its pinned 17,052-byte commitment. The existing precision migration marker passes its validator. This did not independently reconstruct every migration input or scan every block for alternate declarations.

At a single repeatable-read, read-only database snapshot at **967842**, complete token-state commitment was independently recomputed: 2,105,703 B, SHA256 `aeb120385c1805d6f2ec0c5d1b3ab57763be29caf55c6bc19593645354080d01`. Complete sufficient-state commitment was recomputed: 2,520,963 B, SHA256 `85887965958aad9415cda07339a9edb4b914db0c81dc9e5ac8ebd75a278a7d08`. Both agree with stored commitments and exact network value. This extends the earlier scalar checks with full current-state hashing; it is not an independent genesis-to-tip replay.

All **357 WORK holders** match the relational balances and total exactly `210000000000000000000000` Q16 subatoms (21 million WORK). All **405 credit-balance rows** individually have zero pending delta and no negative confirmed balance. All **961 captured V8 frozen-term rows** pass amount flooring, price ceiling, exact alias and compute-before-bond checks. All **859 stored signed authorizations** in the captured canonical WORK state pass actual ECDSA/Schnorr verification of frozen price plus ticket value with SIGHASH 0x83; 68 unsigned listings remain unsigned. This validates saved authorization contracts, not a newly executed every-seal raw-chain/admission campaign.

At **967846**, 24 additional exact arithmetic checks pass across the already ordered WORK/Infinity/Inception responses:

| Calculation | Independently verified result |
| --- | --- |
| Live WORK floor | `floor(N_Q8 / 21000000) / 10^8` = **399410578496.6753042 proofs/WORK** |
| Frozen WORK floor | **49395775031.70106525 proofs/WORK** |
| WORK network decomposition | Base + exact live credit contribution = **8387622148430181388.26228612 proofs**, same as stored 967846 closing N and WORK/Growth/Computer headlines |
| POWB | Supply **630496569**; value **630501483 proofs** including applicable fees; Q8 floor **100000779** = 1.00000779 proofs/POWB |
| INCB fixed issuance | **27386 direct + 224847713398420540 attached-issued = 224847713398447926 units** |
| INCB fixed value and dust | **224847713398447947.9358206 proofs**; sum of per-event floor remainders **21.9358206 proofs**, not one aggregate rounding remainder |
| Six Boost signals | Per-record `floor(attachedSubatoms × N_Q8 / (21000000 × 10^16))` and totals match; aggregate **2795874491012.36347575 proofs**, 2,184 direct proofs, 7.0000011 WORK attached |
| Disconnected mint funding preview | `40 × (1000 registry + 1000 reserve) + 1441 miner fee = 81441 proofs`; no funding action performed |

Q8 proof values and Q16 WORK quantities were checked as integers/exact decimal aliases, not through floating-point approximations. USD values are explicitly external-price estimates; chart/model abbreviations are not protocol quantities. INCB's historical accumulated attachment volume is not a current spendable supply. The earlier eleven math suites and 65,540 assertions remain unchanged-source evidence; this pass added focused independent checks rather than rerunning those broad suites without a new code change.

### New findings and existing H19-01 recheck

#### H19-02 — Medium/P2: transaction-detail dependency failure becomes false 404

**Source-confirmed conditional defect, reproduced offline; no live outage induced.** `fetchTransactionWithSourceFallback` (`server/proof-api.mjs:14152`) eventually throws if Core/Electrs/pending fallback sources fail. `txPayload` at 62886 catches every error as null; the actual public route at 78986 maps null to HTTP 404 **Transaction not found.** The internal envelope says dropped, but that dropped value is not the public response from this route.

The exact extracted functions and actual route branch were run in an isolated Node VM with all providers timing out and an empty cache: the public response was 404. Browser consumers (`src/App.tsx:13315`, 35451, 35826) can clear a previously visible page on this error. **Impact:** false absence and lost last-good display during dependency failure; no ledger deletion. The adjacent status route's typed 503 handling does not repair transaction detail.

**Recommended correction after approval:** preserve typed upstream-unavailable/503 separately from authoritative not-found/404; retain explicitly dated last-good content where appropriate. Add isolated provider-failure/true-absence fixtures. No earlier audit entry identified this exact transaction-detail source cause.

#### H19-03 — Medium/P2: transaction-detail cache can retain orphaned confirmation

**Source-confirmed conditional defect, reproduced offline; no production reorg or orphan was demonstrated.** Process-wide `TRANSACTION_CACHE` (`server/proof-api.mjs:1494`, default limit 100,000 at 842) stores mutable status with transaction bytes. `fetchTransactionFromBitcoinRpc` at 13914 returns the cached object before Core unless explicitly bypassed. The public detail path does not bypass it. No TTL, branch qualification or reorg invalidation was found; size eviction is not confirmation verification. Browser uses the returned `status.confirmed` at `src/App.tsx:13467`.

With a cached confirmed object and mocked current Core reporting unconfirmed, the exact public path returned HTTP 200/confirmed/old hash with **zero RPC calls**. Clearing only the isolated fixture cache returned pending with Core calls. **Impact:** confirmed/pending mislabel after a canonical change on this path, potentially disagreeing with the separate authoritative status route. Protected callers with explicit cache bypass are a separate scope. This server cache cause differs from existing H6-10 UI acceptance guards.

**Recommended correction after approval:** cache immutable bytes separately from mutable chain membership; revalidate status/block membership or invalidate entries against canonical changes. Test confirmed→orphaned/pending and alternate-branch cases locally; do not induce a production reorg.

#### H19-04 — High/P1: Wallet spendability exceeds same-checkpoint replay transfer capacity

**New exact cross-layer arithmetic discrepancy**, beyond the already known distinction between retained historical lifecycle rows and the Core-filtered active book. Source execution used the actual `tokenSpendabilityForWallet` function and its real helpers against the authoritative, checkpoint-complete public wallet response for `bc1pkevddah5jg3lygrwl2ggzqvn4vh0pxkg8933kth9mamu7cz6efuqnn0r60`, checkpoint **967846**, wallet snapshot `2c49f7619866ddfa84b52e76`. A read-only query of that exact stored transition provided canonical reservations.

| Q16 subatoms | Actual Wallet calculator | Raw canonical replay |
| --- | ---: | ---: |
| Confirmed balance | 999980000000000 | 999980000000000 |
| Reserved | 65722187250 | 89507365978 |
| Spendable | **999914277812750** | **999890492634022** |
| Ticket scope | 105 active, 38 closed | 143 retained reservations |

Wallet derives **0.099991427781275 WORK** available; replay permits **0.0999890492634022 WORK**. The difference is **23785178728 subatoms = 0.0000023785178728 WORK**, exactly the selected seller's 38 Core-spent ticket quantities. The wallet's active IDs equal the seller's Core-unspent set and its closed IDs equal the 38 spent tickets. **Active-book and closure membership are correct**; this finding concerns transferable quantity.

The broader sweep at Core 967844 checked all 961 then-stored V8 ticket outpoints, including mempool: 883 unspent, 78 spent, all unspent anchors exactly 546 proofs with expected seller. Forty-four spent tickets remain among canonical active/sealing reservations across three sellers, totaling 28,199,052,655 subatoms. Prior Audit 6 already qualified the lifecycle/book distinction; that count alone is not a new corruption finding. The selected seller's set is unchanged in the exact 967846 wallet/transition evidence. The extra newly confirmed listing belongs to another scope, so 883 at 967844 and 884 later are not contradictory counts.

**Source and impact:** `src/App.tsx:11671` sums Core-active reservations; 11808/11975 derive spendability; 31425–31448 use it in fresh transfer preflight. `server/work-amo-v5-raw.mjs:694–700` reserves retained listing quantities, 1280 derives `workSpendable`, and 3363 rejects sends exceeding it. The active send3 broadcast decision (`server/proof-api.mjs:12626–12644`, 12942, 13277) checks shape/payment/global readiness, without closing this per-wallet quantity gap; `src/App.tsx:31520–31523` refreshes protocol mode before broadcast. An amount in this gap passes the demonstrated frontend quantity comparison and fails the raw replay quantity predicate. **A paid-invalid event/fee loss is a potential consequence, not an executed or observed loss.** No connected-wallet DOM, signed transaction, live admission or broadcast test occurred.

The exact 967846 transition stores economic commitment `480b9cc35dca73f5eff729e702fed3bdd8c2438c5f532973310326334193ce33` and token commitment `abf894b6a9aec3ea551cfcc1fe5f296f6d714cd320def8b22b464dbe03d34aac`. These are checkpoint-bound stored commitments; full-state rehash was performed separately at 967842, not falsely claimed at 967846.

**Recommended correction after approval:** expose exact checkpoint-bound canonical reserved/transferable subatoms independently from Core-active inventory; use them consistently in Wallet and fresh writer preflight, add server quantity admission and spent-ticket boundary fixtures. Preserve immutable transitions, evidence and balances. MARKETPLACE specifies exclusion of spent tickets from the active book; this audit does **not** adjudicate intended historical consensus reservation-release semantics. Any change to those semantics requires an explicit specification and separately approved treatment. Do not release reservations or rewrite history merely to make the two numbers agree.

#### H19-01 — existing High/P1, still open

At 967846 the same fresh WORK token response again reports frozen credit Q8 **35018484903593979776250105** in its statistics, but its own green canonical-consistency evidence reports **103731127226109176156137879**. Difference: **68712642322515196379887774 Q8**, or **687126423225151963.79887774 proofs**. The own-origin WORK floor and Growth/Computer headlines agree with the latter canonical value. Continue H19-01 and its earlier source diagnosis; do not create a duplicate issue or claim successful consistency checks close it.

### Prior issues rechecked, performance and security

| Existing issue / repair | Current disposition |
| --- | --- |
| H6-04 quote truncation | Rechecked: ellipsis and displayed content match Core. |
| H6-15 disappearing historical tx search | Specific fixture remains resolved on Log and Computer through refresh. |
| H6-15 broader search/status coherence | Still open: explicit `pending` search attempts ID resolution and shows missing-ID alert while silent free-text refresh accepts 30 rows (23 pending, seven confirmed matching payload text). It is a free-text query, not a status filter. Unify query semantics and accepted-result status; do not call this wrong mempool confirmation. |
| H6-18 WORK banner units | Rechecked in Computer after refresh: exact network value is in proofs, matches current WORK/Growth. |
| Existing transient Log banner observation | Reproduced: body advances to 25,960 actions/current 967846 while loaded-count banner retains 25,956 (standalone initially 25,955). Searching refreshes status. Cached body had an explicit older date/checkpoint before automatic replacement. No new canonical-data issue ID. |
| H6-05/07/09/10/12/16 | Current source still contains registry contraction, retained same-checkpoint book, same-account UTXO race, canonical-contraction guard, Browser network-load and multi-record activity-key conditions. No blanket live closure. |
| Existing pending/terminal cache family | Pending local seal overlay ignores authoritative dropped status and bypasses expiration; source remains at App.tsx:12075,12191,12238,12270,23792. No live dropped-seal example induced; retain the existing lifecycle family. |
| H9-03/H5-04 auxiliary raw evidence | Previous raw repair remains historical verified evidence. Missing scan-marker qualification is not manufactured or silently closed. H19-04 is a newly proven capacity mismatch, not a duplicate missing-closure claim. |
| H5-06/H10-05/H12-06/H18 availability family | Boost 409 recovery, AMO 503/deferred full book, Growth initial unavailable recovery, and slow successful summaries persist. Final zero-lag ready state does not close intermittent failures. |
| H7-01/H10-07/A11-03 summary size | Still open. Current health reports SQL-text snapshot **20,753,770 B**. Earlier compact-envelope figure **19,596,556 B / 20 MiB (93.44%)** remains its own earlier measurement; do not compare current SQL-text bytes with the compact cap or claim a new compact measurement. |
| Timestamp/participant/ref/Mail repairs, INCB aliases | First-window whole-population evidence preserved; nine-event delta has no structural regression; 46 valid issuance and exact aliases remain consistent. No second exhaustive semantic sweep claimed. |
| Protected `audit:ids`, `audit:computer-events`, parity qualifications | Their earlier failed/incomplete gates remain qualified; current public health/consistency and targeted checks are not replacements for completed protected gates. |
| Physical DB checksums, PITR/off-host restore, retention | Existing gaps remain open. No restore, full physical scan or deletion performed. |

The apparent Log total gap is explicitly explained by the current consistency receipt: ledger **25,960**, public/canonical **25,959**, supplemental **1**; confirmed **25,936** in all relevant sets and supplemental-confirmed **0**. This is the already documented supplemental scope, not evidence of a missing confirmed event. No unverified identity is assigned to that extra item.

**Performance priorities:** reduce repeated multi-megabyte token/holder/history projections; keep exact checkpoint-bound pagination and clear completeness semantics; make status/rows derive from the same accepted response; instrument end-to-end read latency, publication age, byte budget and full-book completion. Global fresh token response advertises a 60-second public cache plus long stale allowances while wallet-scoped response is no-store; review this distinction with explicit status freshness requirements. No stale CDN response or new cache exploit was demonstrated. Do not improve speed by relaxing canonical fences or treating pending data as confirmed.

**Passive hardening checks:** both hosts' actual IPv4/IPv6 firewall default INPUT/FORWARD policies remain DROP; DB/Core RPC/Electrs/API/container backend listeners retain their documented private bindings. No new unintended public data-service exposure was found. Core/Electrs/API/worker/Caddy and PostgreSQL/WAL processes are non-root; Caddy has only bind-service capability, application units use privilege/capability restrictions, and sampled restarts are zero. PostgreSQL fsync/full-page writes/synchronous commit are enabled. Sensitive configuration file modes were inspected without copying secrets.

UI SSH inherits `PasswordAuthentication=yes`, unlike the node, but all enumerated login-shell accounts are password-locked and root password authentication is prohibited. This is a **latent hardening observation**, not a demonstrated password-login vulnerability: a future unlocked non-root account would inherit it. Consider explicitly disabling password authentication with tested key/recovery access after approval. PostgreSQL/WAL units have broader distribution-default sandboxing, but actual processes run UID108 with zero effective capabilities and zero soft core-dump limit; additional sandboxing is a compatibility review, not proof of root DB execution. Browser's live empty sandbox/CSP and bounded source sanitization showed no obvious new injection path; this was not a penetration test or browser-engine proof.

### Host capacity and storage requiring review

| Resource | Continued observation | Meaning / prior issue |
| --- | ---: | --- |
| UI `/` available at 14:37 | **13,429,751,808 B (12.51 GiB)** | Only **2,692,333,568 B (2.51 GiB)** above the 10 GiB reserve. Down 159,744 B from 14:16; no sudden fill event. H5-01/H13-01 remains urgent before large deployment/backup work. |
| Node `/data` available at 14:37 | **440,930,107,392 B** | 333,555,924,992 B above 100 GiB reserve. Later public health 14:57 reports 440,837,795,840 B. H8-05/H10-02 refill/growth exposure remains. |
| Node `/` available at 14:37 | **69,963,661,312 B** | No immediate root-volume shortage. |
| Production database at 14:37 | **31,139,191,831 B** | +21,946,368 B from 14:03. Short-interval delta is not a reliable growth forecast. Database is on the node; UI capacity is dominated by backups/releases, not a local DB. |
| CPU, memory, hardware and traffic | First-window samples remain separately dated above | Node 32 CPUs/96.66% idle/116.7 GB available RAM; UI two CPUs/100% idle/3.39 GB available RAM. No new peak/load/quota claim. RAID `[UU]`, inode headroom and service health rechecked. |

Latest installed storage forecast remained the **14:01 UI warning**, approximately 327,129 seconds (3.79 days) to the 10 GiB reserve from its short one-day trend; it is not a new forecast or a guarantee of time remaining. The node forecast's negative recent net usage does not cancel backup refill/release warnings. Normal short-interval measurements do not eliminate recurrence risk.

The prior exact candidate inventory is preserved in the original evidence, including live/rollback dependency exclusions. This continuation documents these items for approval, with **zero bytes reclaimed**:

- **UI backup/release area ~19.28 GB:** largest existing allocation. Eleven previously verified release candidates may be reviewed against the two protected rollback roots and current symlink/reference graph. Verification of archive bytes does not by itself authorize deleting historical/evidence backups. Release pruning is still dry-run.
- **UI scratch/cache/tmp/log allocations:** the earlier 719.8 MB deployment scratch, 272.9 MB `/tmp`, 127.3 MB cache and 618.5 MB logs are measurements, not proof of obsolescence. Existing bounded scratch cleaner remains installed but was not invoked. No general cache/temp/log deletion is certified safe.
- **Node backups:** one completed logical set and one physical set remain. Configured logical keep-seven and weekly physical keep-three can refill approximately **97.3 GB + 37.6 GB** beyond the presently retained sets, before further chain/database growth. WAL, physical base backup, logical dump and restore-chain dependencies are protected. Prior logical checksum verification remains dated evidence; no duplicate 16 GB checksum read or restore was performed.
- **Node release/checkout material:** 31 checkouts and the previously documented archive candidates still require named dependency/rollback review. Report-only pruning cannot prevent growth automatically. No checkout/archive deleted.
- **Notes, audit evidence and generated artifacts:** age alone is not staleness. No obsolete record was proved safe to remove. Protocol forms, migrations, incident evidence, refund/ledger records and predecessor audits remain useful replay/accountability material. Current receipts are appended compactly; multi-megabyte response copies are not duplicated into the repository.

Any future cleanup must verify **current** path ownership, active references, archive integrity, protected evidence and rollback/restore dependencies immediately before the separately approved action. This audit does not certify every old file as removable or guarantee that a stale candidate list remains safe later.

### Recommended actions requiring separate approval

1. **H19-04 and H19-01:** align exact wallet transfer capacity and API value projections with the same checkpoint's canonical accounting, add focused admission/response assertions, and test boundary cases. Preserve all historical records; specification of any reservation-policy change is a separate decision.
2. **UI disk recurrence:** choose volume expansion or explicit, dependency-verified retention relief before another large release/backup. Alert on absolute available bytes and projected reserve breach, and verify any approved scheduled retention actually applies its intended safe scope.
3. **H19-02/H19-03 and known status races:** repair typed absence/unavailability and mutable confirmation caching; add isolated timeout/reorg/dropped-seal fixtures. Keep Core authority and fresh signing checks intact.
4. **Read performance and completeness:** reduce oversized projections and repeated fetches, improve coherent summary publication/full-book hydration, and add latency/byte-budget/completion monitoring without weakening fences. Repair the existing Log query/status disagreement and banner coherence.
5. **Verification/operations:** complete protected ID/event/parity gates at a coherent checkpoint; plan backup refill and off-host restore/physical-integrity testing; reconcile runbook cap/retention drift and optional SSH/service hardening in approved scopes.

No improvement, cleanup, rollout, restart or recurring automation is authorized by these recommendations. Connected-wallet signing/broadcast, purchases and mutation workflows were intentionally not exercised. Mobile/device/accessibility permutations, fault injection, full dependency/CVE review, physical corruption detection, whole-mempool discovery, every private mailbox and a fresh complete historical replay remain outside the successful finite coverage. The observed discrepancies mean a universal claim that every calculation or data object is correct would be false.

### Durable receipts and reproduction boundary

The compact embedded receipt below contains original HTTP body hashes, saved-artifact hashes, checkpoint/fixture results, exact new-finding evidence and hashes of the bounded source material. Original wire-body hashes differ from pretty-printed saved JSON hashes; neither is mislabeled as the other. Large raw responses/current-state preimages remain represented by exact hashes and checkpoint commitments. Temporary files are working receipts, not durable backups. Future agents can re-query the recorded checkpoint/transaction IDs and compare the retained commitments, then append changed conditions under the same issue IDs.

The two small exact-source reproduction harnesses are retained below for the new source findings. They run locally with isolated data/provider contexts, do not start the application and do not sign or broadcast. A successful reproduction exit means the defect was reproduced, not that production correctness passed. The wallet harness requires the recorded wallet response or an equivalently scoped, explicitly dated read; a later response must not be silently substituted for this historical checkpoint.

The explicit no-cleanup instruction overrides the standing cleaner workflow for this continuation: **`hygiene:fix` was not run**. Only read-only `hygiene:check`, prefix/evidence preservation and final scope checks are permitted here. Their completion result follows the receipts.

<details>
<summary>Compact ordered-audit receipts (JSON)</summary>

```json
{
  "model": "audit19-ordered-read-only-addendum-v1",
  "observationWindowUtc": [
    "2026-09-20T14:33:00Z",
    "2026-09-20T15:00:33Z"
  ],
  "sourceHead": "0ef9c3bee3212a4cb0ae6efe7abbb6a75be72ffa",
  "productionMutation": false,
  "newIssueIds": [
    "H19-02",
    "H19-03",
    "H19-04"
  ],
  "existingH19_01": "open/reproduced",
  "preappendPreservation": {
    "audits/2026-09-20-production-comprehensive-health-data-integrity-audit-19.md": {
      "bytes": 45149,
      "sha256": "ad0b9e728bbeb77ee808ce66c47fc4e1e4fc4a243eea4b4d8d39fe770807cb03"
    },
    "audits/2026-09-20-production-comprehensive-health-data-integrity-audit-19.evidence.json": {
      "bytes": 330727,
      "sha256": "63c83279344e99372a850eb02881147ea2a3f84afdf8f17431a774344cca5b96"
    },
    "repository-hygiene.json": {
      "bytes": 7264,
      "sha256": "fb37a4d130e36c98836e9993cf6381d40f6ac2a667d4b39c0fa9e8ffb89c373d"
    },
    "deploy/audit17/publish-node-work-floor.py": {
      "bytes": 7659,
      "sha256": "95ad97f0f55b0dda7170c18614e7d92dbd0e77db36403b0d605d449b473d95d2"
    }
  },
  "orderedUiCompletionUtc": [
    [
      "Home",
      "14:35:43"
    ],
    [
      "IDs",
      "14:36:38"
    ],
    [
      "Desktop",
      "14:38:39"
    ],
    [
      "Browser",
      "14:39:24"
    ],
    [
      "Boost recovered",
      "14:40:53"
    ],
    [
      "AMO",
      "14:43:24"
    ],
    [
      "Credit",
      "14:46:16"
    ],
    [
      "Wallet",
      "14:46:58"
    ],
    [
      "WORK",
      "14:52:27"
    ],
    [
      "Infinity",
      "14:53:03"
    ],
    [
      "Inception",
      "14:53:44"
    ],
    [
      "Log includingsearch",
      "14:55:47"
    ],
    [
      "Growth",
      "14:56:26"
    ],
    [
      "Computer firstvisit",
      "14:57:02"
    ],
    [
      "Computer finalworkspace",
      "15:00:32"
    ]
  ],
  "httpReceipts": [
    {
      "key": "01-home",
      "url": "https://www.proofofwork.me/api/v1/registry-summary?network=livenet",
      "startedAt": "2026-09-20T14:35:31.324838+00:00",
      "completedAt": "2026-09-20T14:35:38.591668+00:00",
      "status": 200,
      "seconds": 7.267,
      "bytes": 498541,
      "sha256": "f710bb5ab36dc01dc7a2908ce125e074447f42f0a3f9f2079269bc0e0e71984e",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400",
      "savedPrettyJson": {
        "bytes": 624519,
        "sha256": "4619a26ceb359504470240672072cbc509ade27a6af38c518f550dd890c82f73"
      },
      "checkpoint": {
        "indexedThroughBlock": 967841,
        "indexedThroughBlockHash": "00000000000000000000c8b61e59f34bae7504537ad691753e63c23f5368d108",
        "snapshotId": "d006d8fe0a834290ca93e0a7"
      }
    },
    {
      "key": "02-id",
      "url": "https://id.proofofwork.me/api/v1/ids-summary?network=livenet",
      "startedAt": "2026-09-20T14:36:20.972874+00:00",
      "completedAt": "2026-09-20T14:36:24.886693+00:00",
      "status": 200,
      "seconds": 3.914,
      "bytes": 498541,
      "sha256": "f710bb5ab36dc01dc7a2908ce125e074447f42f0a3f9f2079269bc0e0e71984e",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400",
      "savedPrettyJson": {
        "bytes": 624519,
        "sha256": "4619a26ceb359504470240672072cbc509ade27a6af38c518f550dd890c82f73"
      },
      "checkpoint": {
        "indexedThroughBlock": 967841,
        "indexedThroughBlockHash": "00000000000000000000c8b61e59f34bae7504537ad691753e63c23f5368d108",
        "snapshotId": "d006d8fe0a834290ca93e0a7"
      }
    },
    {
      "key": "03-desktop",
      "url": "https://desktop.proofofwork.me/api/v1/log-summary?network=livenet",
      "startedAt": "2026-09-20T14:37:29.240849+00:00",
      "completedAt": "2026-09-20T14:37:35.255760+00:00",
      "status": 200,
      "seconds": 6.015,
      "bytes": 104842,
      "sha256": "940d1fc20a13eb2c082b90242781b5d639093a1e1fc5eb12c30ef389f0f52f5f",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400",
      "savedPrettyJson": {
        "bytes": 135791,
        "sha256": "68b08b86707fe0c949da1aca2c8038c6e383eeaced0369039b79ae4aabb1ef34"
      },
      "checkpoint": {
        "indexedThroughBlock": 967842,
        "indexedThroughBlockHash": "000000000000000000021373921f609836ad8b657359a1d8c2f19ee9865d6bba",
        "snapshotId": "57f499ce29bde40535eda3d3"
      }
    },
    {
      "key": "04-browser",
      "url": "https://browser.proofofwork.me/api/v1/tx/8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b?network=livenet",
      "startedAt": "2026-09-20T14:38:53.912032+00:00",
      "completedAt": "2026-09-20T14:38:54.374632+00:00",
      "status": 200,
      "seconds": 0.463,
      "bytes": 5811,
      "sha256": "13fc4499735e662df300f609185fac07ae9f540806da13906c252482ca243484",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "no-store",
      "savedPrettyJson": {
        "bytes": 6198,
        "sha256": "6f8081de4198683f7e5b180770f9220daf4d81cb44b410e8bcd74a3bc07122a8"
      },
      "checkpoint": {}
    },
    {
      "key": "05-boost-retry",
      "url": "https://boost.proofofwork.me/api/v1/boost?network=livenet&view=all&valueWindow=all&sort=value&limit=50",
      "startedAt": "2026-09-20T14:40:40.729720+00:00",
      "completedAt": "2026-09-20T14:40:48.592039+00:00",
      "status": 200,
      "seconds": 7.862,
      "bytes": 10913,
      "sha256": "dbd65ebbf3156d18aaa5cf7db5c906a96da4ca76721ef981d4eccab5cfe03757",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400",
      "savedPrettyJson": {
        "bytes": 13720,
        "sha256": "6fc7b9ef27685eef923a137d3cb43a974984061bda390fe9cbe1657f46ab9290"
      },
      "checkpoint": {
        "indexedThroughBlock": 967844,
        "indexedThroughBlockHash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "snapshotId": "499c2540ca2d70f3b1a63608"
      }
    },
    {
      "key": "05-boost",
      "url": "https://boost.proofofwork.me/api/v1/boost?network=livenet&view=all&valueWindow=all&sort=value&limit=50",
      "startedAt": "2026-09-20T14:39:43.527343+00:00",
      "completedAt": "2026-09-20T14:39:51.334568+00:00",
      "status": 409,
      "seconds": 7.807,
      "bytes": 141,
      "sha256": "6c6a4010803f67a0d71665f6306fe7cd71309803890e0a4a5c768826cd73b81d",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "no-store",
      "savedPrettyJson": {
        "bytes": 164,
        "sha256": "5801264cbd70098cd0c19efc44c7fd3da9b20062172c5754146acfe4f97a8f57"
      },
      "checkpoint": {}
    },
    {
      "key": "06-amo",
      "url": "https://amo.proofofwork.me/api/v1/marketplace-summary?network=livenet&compact=1",
      "startedAt": "2026-09-20T14:42:09.428666+00:00",
      "completedAt": "2026-09-20T14:42:16.365994+00:00",
      "status": 503,
      "seconds": 6.937,
      "bytes": 386,
      "sha256": "91bc4c8553d41d5d3eb091118d58bdcbb7a234d5c35a22d4c370a6eef0289793",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "no-store",
      "savedPrettyJson": {
        "bytes": 439,
        "sha256": "c793a26d5454e214d2a945490870c1e150f24a8dd02c5d9e1a2f2c6d2a7bd971"
      },
      "checkpoint": {}
    },
    {
      "key": "07-credit",
      "url": "https://credit.proofofwork.me/api/v1/token-summary?network=livenet&compact=1",
      "startedAt": "2026-09-20T14:45:04.096580+00:00",
      "completedAt": "2026-09-20T14:45:12.807548+00:00",
      "status": 200,
      "seconds": 8.711,
      "bytes": 6187525,
      "sha256": "858d865735fcd0f68469bfab3d36195371d012b53ebafc128285f72f745b42f1",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400",
      "savedPrettyJson": {
        "bytes": 7706463,
        "sha256": "5440e3d7f523f24756d47ee1d1837bb2675b205bd09fbb4126f595e8e4e655dd"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "08-wallet-address",
      "url": "https://wallet.proofofwork.me/api/v1/token?network=livenet&asset=WORK&wallet=1&address=bc1pkevddah5jg3lygrwl2ggzqvn4vh0pxkg8933kth9mamu7cz6efuqnn0r60&fresh=1",
      "startedAt": "2026-09-20T14:46:51.509474+00:00",
      "completedAt": "2026-09-20T14:47:04.613189+00:00",
      "status": 200,
      "seconds": 13.104,
      "bytes": 4967881,
      "sha256": "4b3de3c960c64f548a8d992efc5a14e3dd83eb00ca4992a110438b13949c4bd2",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "no-store, max-age=0, must-revalidate",
      "savedPrettyJson": {
        "bytes": 5877980,
        "sha256": "c8eaff46a84f00defd91d894b2ff27ab79a8392c366fe9bf6b11ccd50cc7b6c7"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "2c49f7619866ddfa84b52e76"
      }
    },
    {
      "key": "08-wallet",
      "url": "https://wallet.proofofwork.me/api/v1/token?network=livenet&asset=WORK&fresh=1",
      "startedAt": "2026-09-20T14:46:33.752211+00:00",
      "completedAt": "2026-09-20T14:46:48.056751+00:00",
      "status": 200,
      "seconds": 14.305,
      "bytes": 5712129,
      "sha256": "82230a0f051d9d5110d6c3982fc755865e3932ee700c7011c85ff2ab45abe904",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400",
      "savedPrettyJson": {
        "bytes": 7117275,
        "sha256": "d915c174c056ad2c19e0734a2e313a8b46a5fd6a861db848340dba9d24fdda47"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "09-work",
      "url": "https://work.proofofwork.me/api/v1/work-summary?network=livenet&compact=1",
      "startedAt": "2026-09-20T14:52:23.248789+00:00",
      "completedAt": "2026-09-20T14:52:33.784653+00:00",
      "status": 200,
      "seconds": 10.536,
      "bytes": 6331519,
      "sha256": "e44f5e6dfd23d030b7d862c346151ed577aa633b936b8527cfdca0fe27dc3f1a",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=15, stale-while-revalidate=60, stale-if-error=120",
      "savedPrettyJson": {
        "bytes": 8220445,
        "sha256": "ea218d9aa6c1445d95740c8fd9df71236a86c33fe7d67fa87cf96a0df9ac9161"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "10-infinity",
      "url": "https://infinity.proofofwork.me/api/v1/infinity-summary?network=livenet&compact=1",
      "startedAt": "2026-09-20T14:52:53.908941+00:00",
      "completedAt": "2026-09-20T14:53:02.439449+00:00",
      "status": 200,
      "seconds": 8.53,
      "bytes": 213974,
      "sha256": "b59310e4c9793deb3da781a9e0f77a7c968f62e7ecb8143be01d551a0ca7e4ce",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=15, stale-while-revalidate=60, stale-if-error=120",
      "savedPrettyJson": {
        "bytes": 273363,
        "sha256": "025c5c403bb731ad8da450d9bad3450c4beeb0f82009d93ce1c5fbbebb91108d"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "11-inception",
      "url": "https://inception.proofofwork.me/api/v1/inception-summary?network=livenet&compact=1",
      "startedAt": "2026-09-20T14:53:39.319704+00:00",
      "completedAt": "2026-09-20T14:53:46.157748+00:00",
      "status": 200,
      "seconds": 6.838,
      "bytes": 46702,
      "sha256": "ee3ad7bea2aec060b9358257b659d0d5e7699fa5848171dcaa2f3d5747b02672",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=15, stale-while-revalidate=60, stale-if-error=120",
      "savedPrettyJson": {
        "bytes": 62716,
        "sha256": "5f79f2d035f0f39bcbb0e6be6322a256bb538c57965bf2f38428ae6281c2d22a"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "12-log",
      "url": "https://log.proofofwork.me/api/v1/log-summary?network=livenet",
      "startedAt": "2026-09-20T14:54:22.662038+00:00",
      "completedAt": "2026-09-20T14:54:28.676711+00:00",
      "status": 200,
      "seconds": 6.015,
      "bytes": 105080,
      "sha256": "e2ad9520ebdc062b6cd1151ad840d2b5a0c054c73bdd0f38da88062e994a99a2",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=60, stale-while-revalidate=86400, stale-if-error=86400",
      "savedPrettyJson": {
        "bytes": 136069,
        "sha256": "12b41f3f29473f4f8bba06908038349652eb0582d4373f811b76deff80492e54"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "13-growth",
      "url": "https://growth.proofofwork.me/api/v1/growth-summary?network=livenet",
      "startedAt": "2026-09-20T14:56:18.587127+00:00",
      "completedAt": "2026-09-20T14:56:24.711735+00:00",
      "status": 200,
      "seconds": 6.125,
      "bytes": 175466,
      "sha256": "59b4fa943ddba9523735d007a723e9ac689e783cbba3c863c70b9871fc67dc46",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=15, stale-while-revalidate=60, stale-if-error=120",
      "savedPrettyJson": {
        "bytes": 237110,
        "sha256": "0cd82b863f22a363d8e256b942a03257f30f9718f56574b80efb20f51b04b2a4"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "14-computer-consistency",
      "url": "https://computer.proofofwork.me/api/v1/consistency?network=livenet",
      "startedAt": "2026-09-20T14:57:38.470995+00:00",
      "completedAt": "2026-09-20T14:57:47.544620+00:00",
      "status": 200,
      "seconds": 9.074,
      "bytes": 18870,
      "sha256": "2690e3b6be1467eeda9569dae1a3b113a6b0b1dbc35e64087f2759420ce3d4de",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "public, max-age=15, stale-while-revalidate=60, stale-if-error=120",
      "savedPrettyJson": {
        "bytes": 24273,
        "sha256": "564da7dbb889e4c193603409336fb63c30a6c42665cfac18d48c1fdf780c18f3"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846,
        "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "snapshotId": "cfe1180c020446d5deec3753"
      }
    },
    {
      "key": "14-computer-health-correct",
      "url": "https://computer.proofofwork.me/health?network=livenet",
      "startedAt": "2026-09-20T14:57:11.354838+00:00",
      "completedAt": "2026-09-20T14:57:13.549921+00:00",
      "status": 200,
      "seconds": 2.195,
      "bytes": 3878,
      "sha256": "35da8fd384fb67e9c43282c4af98f7634c4b74f165a09166d221c49f6e33b753",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "no-store",
      "savedPrettyJson": {
        "bytes": 5507,
        "sha256": "3dc06a05ef4a29b7609d6f423e14499a9fabe0499f802211e9fc4ac198875a6c"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846
      }
    },
    {
      "key": "14-computer-health",
      "url": "https://computer.proofofwork.me/api/v1/health",
      "startedAt": "2026-09-20T14:56:56.475361+00:00",
      "completedAt": "2026-09-20T14:56:58.695444+00:00",
      "status": 200,
      "seconds": 2.22,
      "bytes": 3900,
      "sha256": "0ec3da1f0081f08173414f9e9ef06197f3e79e97ffd9118c9c50b6c0df4f3679",
      "hashMeaning": "original HTTP response body",
      "cacheControl": "no-store",
      "savedPrettyJson": {
        "bytes": 5529,
        "sha256": "b4ef7027cbb4a9e3bd92a40f6b9f8637e418d1894d2a49bfb6eb81160dfec14b"
      },
      "checkpoint": {
        "indexedThroughBlock": 967846
      }
    }
  ],
  "canonicalApiAndFixtureBindings": {
    "at": "2026-09-20T14:58:40.633907+00:00",
    "core": {
      "chain": "main",
      "blocks": 967846,
      "headers": 967846,
      "bestblockhash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
      "bits": "17021ec5",
      "target": "000000000000000000021ec50000000000000000000000000000000000000000",
      "difficulty": 132757073449487.5,
      "time": 1789915339,
      "mediantime": 1789914107,
      "verificationprogress": 1,
      "initialblockdownload": false,
      "chainwork": "000000000000000000000000000000000000000148f2490722d698b09b7ef90a",
      "size_on_disk": 877520358685,
      "pruned": false,
      "warnings": []
    },
    "checkpoints": [
      {
        "height": 967841,
        "expected": "00000000000000000000c8b61e59f34bae7504537ad691753e63c23f5368d108",
        "actual": "00000000000000000000c8b61e59f34bae7504537ad691753e63c23f5368d108",
        "ok": true
      },
      {
        "height": 967842,
        "expected": "000000000000000000021373921f609836ad8b657359a1d8c2f19ee9865d6bba",
        "actual": "000000000000000000021373921f609836ad8b657359a1d8c2f19ee9865d6bba",
        "ok": true
      },
      {
        "height": 967844,
        "expected": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "actual": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "ok": true
      },
      {
        "height": 967846,
        "expected": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "actual": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
        "ok": true
      }
    ],
    "fixtures": [
      {
        "txid": "0c887ed6f7dbe415a2bfd88c1bdcb0c5c1681fee339d64bba644e703c8c759c5",
        "height": 965601,
        "blockHash": "0000000000000000000064eec4c13e9086f7ef3b9211d4b94c3ac84b78f7b89b",
        "canonical": true,
        "confirmations": 2246,
        "rawSha256": "61672db15487c84d29df4b011f5ed3edd9153ca1f3ea1726578010a69a17bfca"
      },
      {
        "txid": "720311f99aad3368946de248fd833d1c555ed0e001cbee0931ded5d099146b72",
        "height": 956536,
        "blockHash": "000000000000000000005f46900e43d25a4fe531b5b8c9ee75726a03cc3f0370",
        "canonical": true,
        "confirmations": 11311,
        "rawSha256": "f995eed1875588ac82e4d635095739ea6c95d32a2ad8e6b9682d91a665157f54"
      },
      {
        "txid": "8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7",
        "height": 967038,
        "blockHash": "000000000000000000009f1302fc733e4bcf194fa9be215a901b752a89b0ad5d",
        "canonical": true,
        "confirmations": 809,
        "rawSha256": "e2f03311be84883684f17ebdbc288c3a853fdc1ad283d138a29cdc0ed182d030"
      },
      {
        "txid": "8d48127f2e2015e7366d141947b6c679c710b963549ebac78ae1479a2c429c3b",
        "height": 967363,
        "blockHash": "000000000000000000015b51eee284c382dbd29b794fa1b88effccd8ae665efd",
        "canonical": true,
        "confirmations": 484,
        "rawSha256": "6c041bc1c93a7f8d8b68249ddcdb728ae1d8f78e0377911e3306be3206b415ed"
      },
      {
        "txid": "b7348e6c40b4327120282cc828cf6ee6a5e4ff5f4bc13da88f45e9e7a251012c",
        "height": 965089,
        "blockHash": "00000000000000000001aac3149e56d0328dcf2d53517f9af71b7f8463694854",
        "canonical": true,
        "confirmations": 2758,
        "rawSha256": "72bb98e636478c4f575e4d45d4665ee84366f6fd15572ba7393ce16076af818d"
      },
      {
        "txid": "c7f1f361d5066b56b3af144b369d199278aaada25d657550e31fdb255c3938c8",
        "height": 967362,
        "blockHash": "00000000000000000000abbe43800f03791755051e2fd9bed7ae05378977c6af",
        "canonical": true,
        "confirmations": 485,
        "rawSha256": "cb59592b68ce3c1e5cf4947fb8dad3afc2c44e53f27726962c1ab24bb752aa98"
      },
      {
        "txid": "dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46",
        "height": 955267,
        "blockHash": "00000000000000000001aaec219da9ac653b5c5d81de7470e829005377f3019e",
        "canonical": true,
        "confirmations": 12580,
        "rawSha256": "cb139d50d0a6d385f1388209f99d46a910998733b892297bf098d881a5a99908"
      },
      {
        "txid": "ec52602d518517480b37b93cebb88dbecaf752b38ffafc3bc76eb8dca5b3a793",
        "height": 964513,
        "blockHash": "000000000000000000022dc343c0f57689b27a9ff5968882cb62b52f4ae17eed",
        "canonical": true,
        "confirmations": 3334,
        "rawSha256": "788643fabdeb4e30e53e6540d3c46cd4aee5d130140a5062cb19c9e4323a358e"
      }
    ]
  },
  "renderedCarrierChecks": [
    {
      "txid": "d9c41aef1e84a51bbc96fe81506f511cd9cead8ceaae8349f9f3f64bb50acd69",
      "confirmed": true,
      "messageBytes": 469,
      "messageSha256": "e1356d65b58781e9d70302fe27586d7fbcbc8a514e68706f8d8c7cb20a2b3fc3",
      "quoteSegmentsPresent": true
    },
    {
      "txid": "945088acfd06f982a063bdb6513caf339b2a021cd626fdf27d4bd3f3f50c39f6",
      "confirmed": true
    },
    {
      "txid": "8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b",
      "confirmed": true,
      "messageBytes": 1018,
      "messageSha256": "f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad"
    },
    {
      "txid": "e6ad5d7c10e19bd3e34155061ba05ed4862b2aecf35ae4dc5f59a10aedaf22a1",
      "confirmed": true,
      "messageBytes": 33,
      "messageSha256": "71488499fd95d2b9b35718035cfd19213878b528cd3de6d1a56efe2ac65cbff1",
      "attachment": {
        "bytes": 6284,
        "declaredBytes": 6284,
        "sha256": "98e75adcc612894c206681ab4eab4e4e5a2fa0b3d07169cc00aaaa57f38b422a",
        "declaredSha256": "98e75adcc612894c206681ab4eab4e4e5a2fa0b3d07169cc00aaaa57f38b422a",
        "verified": true
      }
    }
  ],
  "boostExactChecks": {
    "checkpoint": {
      "indexedThroughBlock": 967844,
      "indexedThroughBlockHash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
      "snapshotId": "499c2540ca2d70f3b1a63608"
    },
    "stats": {
      "confirmed": 6,
      "pending": 0,
      "total": 6
    },
    "checks": [
      {
        "txid": "8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7",
        "workExact": true,
        "totalExact": true
      },
      {
        "txid": "0c887ed6f7dbe415a2bfd88c1bdcb0c5c1681fee339d64bba644e703c8c759c5",
        "workExact": true,
        "totalExact": true
      },
      {
        "txid": "b7348e6c40b4327120282cc828cf6ee6a5e4ff5f4bc13da88f45e9e7a251012c",
        "workExact": true,
        "totalExact": true
      },
      {
        "txid": "ec52602d518517480b37b93cebb88dbecaf752b38ffafc3bc76eb8dca5b3a793",
        "workExact": true,
        "totalExact": true
      },
      {
        "txid": "8d48127f2e2015e7366d141947b6c679c710b963549ebac78ae1479a2c429c3b",
        "workExact": true,
        "totalExact": true
      },
      {
        "txid": "c7f1f361d5066b56b3af144b369d199278aaada25d657550e31fdb255c3938c8",
        "workExact": true,
        "totalExact": true
      }
    ],
    "aggregateExact": true,
    "signalStats": {
      "proofSignalQ8": "218400000000",
      "proofSignalSats": 2184,
      "proofSignalSatsExact": "2184",
      "totalSignalQ8": "279587449101236347575",
      "totalSignalSats": 2795874491012.3633,
      "totalSignalSatsExact": "2795874491012.36347575",
      "totalSignalUsd": 2251853232.551177,
      "workSignalSubatoms": "70000011000000000"
    }
  },
  "declarations": [
    {
      "version": "v5",
      "txid": "54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36",
      "declarationHeight": 959620,
      "activationHeight": 959621,
      "payloadBytes": 17052,
      "payloadSha256": "d947a9adaa9d84d05571d2addd210cc4aa194eac94562411397553ef8135f95f",
      "checks": {
        "canonicalBlock": true,
        "txBlock": true,
        "blockIndex": true,
        "confirmed": true,
        "authorityInput": true,
        "registryPaymentUnique": true,
        "payloadBytes": true,
        "payloadHash": true,
        "exactLocalText": null
      }
    },
    {
      "version": "v6",
      "txid": "975fd82aa84995e014b240618ee1a1254d0a735e6e1241372d0bed0a0d9f0799",
      "declarationHeight": 960218,
      "activationHeight": 960219,
      "payloadBytes": 3350,
      "payloadSha256": "b43daeea38fcacaf6afa6a48d3d0fde631497a4af9f3bb137fc07975d18bbe01",
      "checks": {
        "canonicalBlock": true,
        "txBlock": true,
        "blockIndex": true,
        "confirmed": true,
        "authorityInput": true,
        "registryPaymentUnique": true,
        "payloadBytes": true,
        "payloadHash": true,
        "exactLocalText": true
      }
    },
    {
      "version": "v8",
      "txid": "f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a",
      "declarationHeight": 960600,
      "activationHeight": 960601,
      "payloadBytes": 5593,
      "payloadSha256": "1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528",
      "checks": {
        "canonicalBlock": true,
        "txBlock": true,
        "blockIndex": true,
        "confirmed": true,
        "authorityInput": true,
        "registryPaymentUnique": true,
        "payloadBytes": true,
        "payloadHash": true,
        "exactLocalText": true
      }
    }
  ],
  "currentStateChecks": {
    "observedAt": "2026-09-20T14:42:12.843Z",
    "height": 967842,
    "hash": "000000000000000000021373921f609836ad8b657359a1d8c2f19ee9865d6bba",
    "precisionMarkerValid": true,
    "tokenCommitment": {
      "model": "canonical-work-amo-payload-sha256-v1",
      "payloadBytes": 2105703,
      "sha256": "aeb120385c1805d6f2ec0c5d1b3ab57763be29caf55c6bc19593645354080d01"
    },
    "economicCommitment": {
      "model": "canonical-work-amo-sufficient-state-sha256-v1",
      "payloadBytes": 2520963,
      "sha256": "85887965958aad9415cda07339a9edb4b914db0c81dc9e5ac8ebd75a278a7d08"
    },
    "tokenCommitmentMatches": true,
    "economicCommitmentMatches": true,
    "economicNetworkMatches": true,
    "supply": "210000000000000000000000",
    "holders": 357,
    "balanceRows": 357,
    "balanceMismatches": [],
    "canonicalOpenListings": 927,
    "canonicalReservedSubatoms": "623283613023",
    "canonicalUnreservedSubatoms": "209999999999376716386977",
    "listingMismatches": [],
    "frozenRows": 961,
    "frozenFailures": [],
    "allBalanceRows": 405,
    "nonzeroPendingBalanceRows": 0,
    "negativeConfirmedRows": 0,
    "sellerRows": [
      {
        "address": "1M9jJf6Smitx54TT2VM6tdHgh9ic4jqtLQ",
        "confirmed": "3100000000000000",
        "reserved": "70382538978",
        "unreserved": "3099929617461022"
      },
      {
        "address": "bc1p0uxp0axptr8rg9dndgtlwxn00j4hq8m88kg80tqd0t6045putwhq5ca7ed",
        "confirmed": "8832230893",
        "reserved": "8832230877",
        "unreserved": "16"
      },
      {
        "address": "19JE7LS6TtQ4uSxu6ivJVZRiJyXXe8qEG3",
        "confirmed": "10000000000000000",
        "reserved": "79631403166",
        "unreserved": "9999920368596834"
      },
      {
        "address": "bc1qfzc59539yx597kp50pyeemjuns7rdz2djehqyw",
        "confirmed": "1000000000000000000",
        "reserved": "9428072031",
        "unreserved": "999999990571927969"
      },
      {
        "address": "1NMqxJJdPgo23d4UwqgK1yJ7C2EgxVqQSt",
        "confirmed": "1000000000000000000",
        "reserved": "23202237792",
        "unreserved": "999999976797762208"
      },
      {
        "address": "bc1pkevddah5jg3lygrwl2ggzqvn4vh0pxkg8933kth9mamu7cz6efuqnn0r60",
        "confirmed": "999980000000000",
        "reserved": "89507365978",
        "unreserved": "999890492634022"
      },
      {
        "address": "bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl",
        "confirmed": "931000000000000000000",
        "reserved": "5390726293",
        "unreserved": "930999999994609273707"
      },
      {
        "address": "162o4j4geLqZs3bctKtoQJzMr9pWvQcYdm",
        "confirmed": "1000000000000000000",
        "reserved": "2778016367",
        "unreserved": "999999997221983633"
      },
      {
        "address": "17W7JZ9KjjGUwdAyXeGxhzYe2vGe8YTRzA",
        "confirmed": "9999999247990259",
        "reserved": "14327991214",
        "unreserved": "9999984919999045"
      },
      {
        "address": "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW",
        "confirmed": "309079999997752908902",
        "reserved": "7441612470",
        "unreserved": "309079999990311296432"
      },
      {
        "address": "bc1qggw7p5xtcv33uduhttphz24apx35u384ld9twk",
        "confirmed": "19999999989513574876",
        "reserved": "98434103493",
        "unreserved": "19999999891079471383"
      },
      {
        "address": "bc1pp9wyknpmrzfdzg40ya2h403u2spz9cszu0upwl9rlv89nnluhztq0hj8rj",
        "confirmed": "2170000000000000000000",
        "reserved": "11383692933",
        "unreserved": "2169999999988616307067"
      },
      {
        "address": "1C8pybHVuJruU2DiGvverD6m1gPwwZC8B4",
        "confirmed": "36900000000000000",
        "reserved": "36723687489",
        "unreserved": "36899963276312511"
      },
      {
        "address": "1PNdpQUScG1SnzyrsuGdErKWtjtrbWM5TV",
        "confirmed": "599889995505817804",
        "reserved": "28901503296",
        "unreserved": "599889966604314508"
      },
      {
        "address": "19zNWaDPuFa8DazGvi2E8b1H6CBxE9AesJ",
        "confirmed": "1000000000000",
        "reserved": "10015594307",
        "unreserved": "989984405693"
      },
      {
        "address": "bc1p8ddc3s6z09ktchgdxxht8l0tt7gs7jn90w004uw2hrxuue39lp7qlxrd3q",
        "confirmed": "700000000000000000000",
        "reserved": "15132939041",
        "unreserved": "699999999984867060959"
      },
      {
        "address": "12k9WDrHjk7tkbbg6ddJAG4uhb5o9zxHPX",
        "confirmed": "9000000000000",
        "reserved": "34425822365",
        "unreserved": "8965574177635"
      },
      {
        "address": "bc1qanyf3whqurxlv95y73wc6jc75wvzhjglul0z75",
        "confirmed": "3165000000000000000000",
        "reserved": "668722097",
        "unreserved": "3164999999999331277903"
      },
      {
        "address": "18hkqE81wQuq75UEBKhB4JjAuQg47jN7Aa",
        "confirmed": "9999997752908902",
        "reserved": "25119881752",
        "unreserved": "9999972633027150"
      },
      {
        "address": "bc1pdk2hhp84250v049rk4gensem46wqynmhj02tk7yykcadma557avs63qxz4",
        "confirmed": "280000000000000000000",
        "reserved": "13675415228",
        "unreserved": "279999999986324584772"
      },
      {
        "address": "bc1pj9nzxgjt8d46e3qva2lwy2jg7yx37dly7z6legt94xhkpvnsa3sqgyg7t4",
        "confirmed": "50000000000000000000",
        "reserved": "17638962756",
        "unreserved": "49999999982361037244"
      },
      {
        "address": "bc1pxhs9y9ryqnhm05lyv794f6upzk0mtu2zct5w2hgc2vm3d58pvcqspptre0",
        "confirmed": "1970000000000000000000",
        "reserved": "2996121464",
        "unreserved": "1969999999997003878536"
      },
      {
        "address": "bc1pe6cuxy6uxswgqs4e38asn5m3cry6s7awgrme8d4vh6dayx8kftjqsaa8fe",
        "confirmed": "2000000000000000000000",
        "reserved": "5007392344",
        "unreserved": "1999999999994992607656"
      },
      {
        "address": "1AcH1HwHCg4ggiBj4NJSqZ9SPGwSyRBSKs",
        "confirmed": "10000000000000000",
        "reserved": "709159383",
        "unreserved": "9999999290840617"
      },
      {
        "address": "1Pg9E4EHHMxQ6WgEWEVzbWhaKf3UdZKXD9",
        "confirmed": "99999999999250969634",
        "reserved": "749030366",
        "unreserved": "99999999998501939268"
      },
      {
        "address": "1ArUWhGjcdgRhJ9NMwsNQiSS9KEQoBUH9d",
        "confirmed": "999999999250969634",
        "reserved": "2247091098",
        "unreserved": "999999997003878536"
      },
      {
        "address": "bc1px0zfr0kxle67d4shpw5cfur369re24hyj4vwmpy298rlt6tdm2ssm5848g",
        "confirmed": "1840000000000000000000",
        "reserved": "2078054212",
        "unreserved": "1839999999997921945788"
      },
      {
        "address": "bc1p9veu0wlm5akkk0kcy0dg8uhq5se77yw0dp9v2g50chx0jzx9qn4sncmv49",
        "confirmed": "489999999999250969634",
        "reserved": "749030366",
        "unreserved": "489999999998501939268"
      },
      {
        "address": "1MbghEKwNH88jqYynJVtEDYHU8d5iy7PzM",
        "confirmed": "200000000000000000000",
        "reserved": "645638711",
        "unreserved": "199999999999354361289"
      },
      {
        "address": "bc1qcupgj7v580te0kfn9vmpczmnjavyw30v0trmgt",
        "confirmed": "90000000000000000000",
        "reserved": "1326593950",
        "unreserved": "89999999998673406050"
      },
      {
        "address": "1KhLgiejzFDxzM3AsmXXHCisH3VA7zcSUW",
        "confirmed": "399999999250969634",
        "reserved": "2247091098",
        "unreserved": "399999997003878536"
      },
      {
        "address": "bc1pepkuggn42u7c6fhyw5c9mt89y6nk2juy6tdg967uryu8z5mrhd0sa9nktt",
        "confirmed": "1180000000000000000000",
        "reserved": "742943605",
        "unreserved": "1179999999999257056395"
      },
      {
        "address": "bc1p0e5qs2vcu6c50t6xwxuk7yfnqpwtm03rclv7wzgxzk37849xt8fssl6zvd",
        "confirmed": "3734000000000000000000",
        "reserved": "742946503",
        "unreserved": "3733999999999257053497"
      }
    ]
  },
  "storedSealSignatures": {
    "observedAt": "2026-09-20T14:49:58.714Z",
    "checkpoint": 967842,
    "rows": 927,
    "signedChecked": 859,
    "unsigned": 68,
    "failures": [],
    "qualification": "Cryptographic verification of saved current canonical sale authorizations and exact price+ticket output; no signing, new raw-chain signature campaign, or transaction admission performed."
  },
  "idLifecycle": {
    "observedAt": "2026-09-20T14:45:14.333405+00:00",
    "results": [
      {
        "txid": "945088acfd06f982a063bdb6513caf339b2a021cd626fdf27d4bd3f3f50c39f6",
        "kind": "id-register",
        "height": 949040,
        "checks": {
          "confirmed": true,
          "canonicalBlock": true,
          "blockPosition": true,
          "exactPayload": true
        }
      },
      {
        "txid": "8e7f7412d4c86b92798ce26b598b363023651691af2004c62c895eca51338bd9",
        "kind": "id-list",
        "height": 956029,
        "checks": {
          "confirmed": true,
          "canonicalBlock": true,
          "blockPosition": true,
          "exactPayload": true
        }
      },
      {
        "txid": "9d7cbf0d46e88fae6ec9c28cd08336356c92e91b812a3fe0b1ea7bfeea26a34b",
        "kind": "id-seal",
        "height": 956619,
        "checks": {
          "confirmed": true,
          "canonicalBlock": true,
          "blockPosition": true,
          "exactPayload": true
        }
      },
      {
        "txid": "d97557a97a4c9853164ac28fa92b3fa4d7328dd9381ad384e3a009740d86dc45",
        "kind": "id-buy",
        "height": 957408,
        "checks": {
          "confirmed": true,
          "canonicalBlock": true,
          "blockPosition": true,
          "exactPayload": true,
          "spendsListingTicket": true,
          "sellerPricePlusTicket": true,
          "registryFee546": true,
          "ownerReceiver": true
        }
      }
    ],
    "qualification": "Exact raw event bytes, inclusion, purchase outputs and ticket spend; no new full seller-signature replay."
  },
  "orderedMath": {
    "checkpoint": 967846,
    "snapshotId": "cfe1180c020446d5deec3753",
    "blockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
    "checks": [
      {
        "name": "WORK floorQ8 exact division",
        "ok": true
      },
      {
        "name": "WORK frozen floorQ8 exact division",
        "ok": true
      },
      {
        "name": "WORK canonical DB network equals API",
        "ok": true
      },
      {
        "name": "WORK base plus credit live",
        "ok": true
      },
      {
        "name": "WORK base plus credit frozen",
        "ok": true
      },
      {
        "name": "WORK floorQ8 decimal alias",
        "ok": true
      },
      {
        "name": "WORK frozenFloorQ8 decimal alias",
        "ok": true
      },
      {
        "name": "WORK networkValueQ8 decimal alias",
        "ok": true
      },
      {
        "name": "WORK creditEventFrozenValueQ8 decimal alias",
        "ok": true
      },
      {
        "name": "WORK creditEventLiveValueQ8 decimal alias",
        "ok": true
      },
      {
        "name": "POWB floorQ8 division",
        "ok": true
      },
      {
        "name": "POWB decimal network alias",
        "ok": true
      },
      {
        "name": "POWB decimal floor alias",
        "ok": true
      },
      {
        "name": "INCB floorQ8 division",
        "ok": true
      },
      {
        "name": "INCB decimal network alias",
        "ok": true
      },
      {
        "name": "INCB decimal floor alias",
        "ok": true
      },
      {
        "name": "POWB principal+transfer+market fees",
        "ok": true
      },
      {
        "name": "POWB issued equals direct bond principal",
        "ok": true
      },
      {
        "name": "INCB exact direct+attachment value",
        "ok": true
      },
      {
        "name": "INCB direct+attachment issued units",
        "ok": true
      },
      {
        "name": "INCB supply equals issued",
        "ok": true
      },
      {
        "name": "INCB sum per-event dust",
        "ok": true
      },
      {
        "name": "INCB dust decimal alias",
        "ok": true
      },
      {
        "name": "INCB attachment quantity Q16 alias",
        "ok": true
      }
    ],
    "failures": [],
    "H19_01_recheck": {
      "statsQ8": "35018484903593979776250105",
      "sameResponseCanonicalQ8": "103731127226109176156137879",
      "WORKOwnOriginCanonicalQ8": "103731127226109176156137879",
      "differenceQ8": "68712642322515196379887774",
      "differenceProofs": "687126423225151963.79887774",
      "sameResponseGreen": true,
      "WORKOwnOriginAgrees": true
    },
    "INCB_qualification": "Sum of per-event floor remainders is 21.93582060 proofs; not a single aggregate remainder. Public attachedWorkAmount is accumulated movement quantity, not current spendable supply. Display USD fields are externally priced approximations outside exact protocol claims."
  },
  "H19_02_H19_03": {
    "startedAt": "2026-09-20T14:40:50.570Z",
    "source": "/home/sixer/ProofOfWork.Me/server/proof-api.mjs",
    "sourceSha256": "8985dafa6e8794041242435e8dad7aa292c6fe34ae35ca929aca5068228c67e8",
    "extractedHashes": {
      "rpc": "e18949604db8d6d10919dfacefa52fa11444992f5e91be93e73a9938d36e7b91",
      "fallback": "3f15b798094b4d9a7def806b634df53cc547639dfff6796f1bba17b6caf29b89",
      "payload": "7fbe7c25fb8ec15cb5863c09d4dc19bddbecec87721f1b7b631bd6323a36a2c3",
      "confirmed": "543584f5b296022c95939c18739a12fb1c12cae170f291eeeb5996bf38daa379",
      "route": "fdcf527e984f9f261a98058c5a951fe5059eb0db9e5b1fc7abfbafee9a9d849b"
    },
    "tests": [
      {
        "case": "all providers unavailable, empty cache",
        "result": "reproduced false404",
        "providerCalls": [
          "Core",
          "Electrs",
          "first-party-mempool",
          "pending-sources-unavailable"
        ],
        "public": {
          "status": 404,
          "error": "Transaction not found."
        },
        "internalStatus": "dropped",
        "desired": "503/unavailable; do not certify absence"
      },
      {
        "case": "cached confirmed transaction; current mocked Core says unconfirmed",
        "result": "reproduced staleconfirmed",
        "withCache": {
          "httpStatus": 200,
          "status": "confirmed",
          "blockHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "rpcCalls": 0
        },
        "sameProviderAfterClearingFixtureCache": {
          "httpStatus": 200,
          "status": "pending",
          "confirmed": false,
          "rpcCalls": [
            {
              "method": "getrawtransaction",
              "params": [
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                true
              ]
            },
            {
              "method": "getmempoolentry",
              "params": [
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
              ]
            }
          ]
        },
        "desired": "immutable bytes may remain cached; canonical status must revalidate"
      }
    ],
    "completedAt": "2026-09-20T14:40:50.581Z",
    "scope": "Exact-source extracted functions and route body in Node VM with isolated deterministic mocked providers/cache; no network, app startup, live fault or production mutation. Status-only synthetic transaction fixture does not attempt raw-transaction validation."
  },
  "H19_04": {
    "name": "WORK Wallet spendability exceeds same-checkpoint canonical replay capacity",
    "priority": "P1/high",
    "observedAt": "2026-09-20T14:59:49.598253+00:00",
    "checkpointHeight": 967846,
    "checkpointHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
    "walletSnapshotId": "2c49f7619866ddfa84b52e76",
    "walletAuthoritative": true,
    "walletCheckpointComplete": true,
    "writeAdmission": true,
    "seller": "bc1pkevddah5jg3lygrwl2ggzqvn4vh0pxkg8933kth9mamu7cz6efuqnn0r60",
    "confirmedSubatoms": "999980000000000",
    "walletActiveCount": 105,
    "canonicalListingCount": 143,
    "walletReservedSubatoms": "65722187250",
    "canonicalReservedSubatoms": "89507365978",
    "walletSpendableSubatoms": "999914277812750",
    "canonicalSpendableSubatoms": "999890492634022",
    "differenceSubatoms": "23785178728",
    "walletSpendableWORK": "0.099991427781275",
    "canonicalSpendableWORK": "0.0999890492634022",
    "differenceWORK": "0.0000023785178728",
    "closedTicketCount": 38,
    "closedIdsEqualCoreSpent": true,
    "walletActiveIdsEqualScopedCoreUnspent": true,
    "capturedCoreHeight": 967844,
    "canonicalScopeUnchangedFromPriorRead": true,
    "transitionCommitments": {
      "observedAt": "2026-09-20T14:57:04.259375+00:00",
      "height": 967846,
      "hash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
      "closingNetworkValueQ8": "838762214843018138826228612",
      "closingStateSha256": "480b9cc35dca73f5eff729e702fed3bdd8c2438c5f532973310326334193ce33",
      "closingStatePayloadBytes": 2520963,
      "tokenStateCommitment": {
        "model": "canonical-work-amo-payload-sha256-v1",
        "sha256": "abf894b6a9aec3ea551cfcc1fe5f296f6d714cd320def8b22b464dbe03d34aac",
        "payloadBytes": 2109650
      }
    },
    "actualFrontendResult": {
      "observedAt": "2026-09-20T14:55:14.925Z",
      "checkpoint": 967846,
      "snapshotId": "2c49f7619866ddfa84b52e76",
      "sourceFunction": "src/App.tsx:tokenSpendabilityForWallet",
      "activeListings": 105,
      "confirmedBalanceSubatoms": "999980000000000",
      "reservedBalanceSubatoms": "65722187250",
      "pendingOutgoingSubatoms": "0",
      "spendableBalanceSubatoms": "999914277812750"
    },
    "conditionalTransferBoundary": {
      "amountSubatoms": "999914277812750",
      "passesFrontendQuantityComparison": true,
      "passesRawReplayQuantityComparison": false,
      "qualification": "Comparison of the actual frontend result with the raw replay inequality, not an executed transaction."
    },
    "sourceAnchors": [
      "src/App.tsx:11671",
      "src/App.tsx:11808",
      "src/App.tsx:11975",
      "src/App.tsx:31425",
      "src/App.tsx:31520",
      "src/App.tsx:31523",
      "server/work-amo-v5-raw.mjs:694",
      "server/work-amo-v5-raw.mjs:1280",
      "server/work-amo-v5-raw.mjs:3363",
      "server/proof-api.mjs:12626",
      "server/proof-api.mjs:12942",
      "server/proof-api.mjs:13277"
    ],
    "impact": "The official Wallet calculator and fresh transfer preflight derive more available WORK than the canonical replay send predicate accepts. A transfer in the gap can pass that frontend amount check yet fail protocol accounting; first-party broadcast validates send3 shape and payment with global readiness, not this exact quantity gap. Fee loss or executed rejection was not demonstrated.",
    "priorAdjudication": "New exact same-checkpoint calculation discrepancy, linked to existing H5-04/H9-03 auxiliary-spend/lifecycle family. Prior Audit6 scoped raw lifecycle rows versus active book and did not certify canonical transfer capacity. No duplicate missing-closure issue is inferred.",
    "semanticBoundary": "The captured raw implementation demonstrably retains these reservations. MARKETPLACE.md requires spent tickets removed from active book; this audit does not adjudicate intended historical consensus reservation-release semantics.",
    "recommendedCorrection": "After approval, expose exact checkpoint-bound canonical reserved and transferable subatoms independently from Core-active listing inventory. Use those values in Wallet display and fresh writer preflight, validate amount capacity at server broadcast admission, and add spent-ticket boundary fixtures. Preserve immutable transitions, event history, balances and ledgers; any protocol/reservation-release change requires separately specified and explicitly approved treatment.",
    "limitations": [
      "No connected-wallet DOM state was exercised.",
      "No signing, broadcast, live admission test or paid invalid transaction was executed.",
      "Core outpoint sweep was at967844; exact967846 wallet lists match the same seller set and canonical scope remains unchanged.",
      "No statement that existing canonical reservation semantics are intentionally correct."
    ],
    "sources": [
      {
        "path": "root/08-wallet-address.body.json",
        "bytes": 5877980,
        "sha256": "c8eaff46a84f00defd91d894b2ff27ab79a8392c366fe9bf6b11ccd50cc7b6c7"
      },
      {
        "path": "root/08-wallet.body.json",
        "bytes": 7117275,
        "sha256": "d915c174c056ad2c19e0734a2e313a8b46a5fd6a861db848340dba9d24fdda47"
      },
      {
        "path": "root/09-work.body.json",
        "bytes": 8220445,
        "sha256": "ea218d9aa6c1445d95740c8fd9df71236a86c33fe7d67fa87cf96a0df9ac9161"
      },
      {
        "path": "root/10-infinity.body.json",
        "bytes": 273363,
        "sha256": "025c5c403bb731ad8da450d9bad3450c4beeb0f82009d93ce1c5fbbebb91108d"
      },
      {
        "path": "root/11-inception.body.json",
        "bytes": 62716,
        "sha256": "5f79f2d035f0f39bcbb0e6be6322a256bb538c57965bf2f38428ae6281c2d22a"
      },
      {
        "path": "backend/wallet-checkpoint-967846.txt",
        "bytes": 10094,
        "sha256": "3f8adffa596decb73e3ec4f1f64f47b4dab8c8a28c2e53f8e809e5b2b3fdc335"
      },
      {
        "path": "backend/transition-967846-commitments.txt",
        "bytes": 532,
        "sha256": "b49e85a8c3067a0c5d633ce70283bae2570b1e03d1be89694b35b6e2495c63d4"
      },
      {
        "path": "backend/check-wallet-source.cjs",
        "bytes": 2472,
        "sha256": "e9c39f3f02a786408af2fc9436707fa37f58f6e174b71c14e36c735fa006939b"
      }
    ]
  },
  "finalDelta": {
    "startedAt": "2026-09-20T14:55:36.681159+00:00",
    "scope": "only newly confirmed stored livenet transactions at height >= 967838; prior complete population not repeated",
    "minimumHeight": 967838,
    "coreBefore": {
      "chain": "main",
      "blocks": 967846,
      "headers": 967846,
      "bestblockhash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
      "bits": "17021ec5",
      "target": "000000000000000000021ec50000000000000000000000000000000000000000",
      "difficulty": "132757073449487.5",
      "time": 1789915339,
      "mediantime": 1789914107,
      "verificationprogress": 1,
      "initialblockdownload": false,
      "chainwork": "000000000000000000000000000000000000000148f2490722d698b09b7ef90a",
      "size_on_disk": 877520358685,
      "pruned": false,
      "warnings": []
    },
    "selectedTransactions": [
      {
        "txid": "4e41eb19d3a804d1bd88d9f069da0c7694e1928dbf1c889890b31fdb9d21dabd",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 243,
        "fee_sats": 792
      },
      {
        "txid": "d45c8c4c4639bf162e328a5a4b67a10e76b6fc4ceb549d9a519ef237d5cee414",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 244,
        "fee_sats": 947
      },
      {
        "txid": "be6c2a94d8b90ef08dd6e65c19d44e561ef137c8946f88bdf29becbea9c749a8",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 245,
        "fee_sats": 947
      },
      {
        "txid": "01c23789fef9b6e60c8c75e5906e90c9e22951d40cc85a48255840262e7a0ccb",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 246,
        "fee_sats": 947
      },
      {
        "txid": "e6ab5b44d75f0197d0b89dee5cbc85e92e071828f30afc1d5d0321543f9d4f27",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 247,
        "fee_sats": 948
      },
      {
        "txid": "eb42bcbe85c36e17799a716ad4b961cabda71ae65fb612152840e2c844ed8567",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 248,
        "fee_sats": 948
      },
      {
        "txid": "0918d964146a6ceaa9fb7b52aba1654ab994519b72edc8d1fa085eec8ffe6268",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 249,
        "fee_sats": 948
      },
      {
        "txid": "bdba8b08d20e6640416f032ca2c1a03e58d10c14f7baaaa8189de6dec26903c3",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 250,
        "fee_sats": 948
      },
      {
        "txid": "5508252c16f98fe1895673558972f5746821fb8f8cd030e859dd0a2322d73ff6",
        "block_height": 967844,
        "block_hash": "00000000000000000000bb36c2c0e2c0d8e13b71372db4668d86b384b3df808e",
        "block_index": 251,
        "fee_sats": 948
      }
    ],
    "count": 9,
    "rawMismatches": [],
    "rpcFailures": [],
    "outputCount": 28,
    "outputMismatches": [],
    "additionalParentCount": 9,
    "inputCount": 9,
    "inputMismatches": [],
    "inputCardinalityMismatches": [],
    "outputCardinalityMismatches": [],
    "blockPositionBlocks": 1,
    "positionMismatches": [],
    "fees": {
      "checked": 9,
      "mismatches": [],
      "unverifiable": []
    },
    "carriers": {
      "storedRows": 9,
      "mismatches": [],
      "payloadTextMismatches": [],
      "unverifiable": []
    },
    "newEventStructure": {
      "events": 9,
      "bad_confirmed_parent": 0,
      "missing_confirmed_time": 0,
      "volatile_child": 0,
      "duplicate_event_keys": 0,
      "duplicate_participants": 0,
      "duplicate_refs": 0
    },
    "deltaBlockBindings": {
      "countIncludingBoundary": 10,
      "firstHeight": 967837,
      "lastHeight": 967846,
      "gaps": [],
      "linkMismatches": [],
      "coreHashMismatches": []
    },
    "pendingFence": {
      "beforeAt": "2026-09-20T14:55:36.856264+00:00",
      "afterAt": "2026-09-20T14:55:37.057081+00:00",
      "coreBeforeCount": 76808,
      "coreAfterCount": 76810,
      "beforeSequence": 14462321,
      "afterSequence": 14462325,
      "coreBeforeSha256": "f380c4d97df209685d9b92926f51a38c87a4cd16f06bd4949bb3a6be81dbdb9d",
      "coreAfterSha256": "c1cbfe5e14c8ec13ae90b737e4366b2d11d1dd55fcc80f20457fe256057efb71",
      "dbPendingCount": 173,
      "dbDroppedCount": 76,
      "dbRowsSha256": "88ffafa10d90d925653bab3c10629874b408f6d2980a06e73fb8c4e95f7df839",
      "missingPendingBefore": [],
      "missingPendingAfter": [],
      "droppedPresentBefore": [],
      "droppedPresentAfter": []
    },
    "currentStoredCounts": {
      "confirmed_transactions": 25598,
      "new_confirmed_transactions": 9,
      "max_confirmed_transaction_height": 967844
    },
    "localHealth": {
      "http": 200,
      "body": {
        "available": true,
        "backend": "electrum",
        "checks": {
          "addressIndex": {
            "canary": {
              "confirmedSats": 0,
              "scripthash": "8f52010f55361085b1806ee106632dd610d3a6587284138d06065d584bab8d21",
              "unconfirmedSats": 0
            },
            "error": "",
            "ok": true,
            "source": "electrum://172.27.0.1:50001",
            "timedOut": false
          },
          "backend": {
            "ok": true,
            "timedOut": false
          },
          "database": {
            "canonicalMetaOk": true,
            "ok": true,
            "required": true,
            "timedOut": false
          },
          "disk": {
            "cache": {
              "availableBytes": 440839278592,
              "maxUsedPercent": 90,
              "minFreeBytes": 5368709120,
              "ok": true,
              "path": "/data/proofofwork-api-cache",
              "probePath": "/data/proofofwork-api-cache",
              "totalBytes": 1764768071680,
              "usedPercent": 75.01998785753553
            },
            "ok": true,
            "root": {
              "availableBytes": 69975379968,
              "maxUsedPercent": 90,
              "minFreeBytes": 5368709120,
              "ok": true,
              "path": "/",
              "probePath": "/",
              "totalBytes": 105089261568,
              "usedPercent": 33.41338693990051
            }
          },
          "electrum": {
            "configured": true,
            "error": "",
            "headerHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
            "headerHeight": 967846,
            "ok": true,
            "timedOut": false,
            "atTip": true
          },
          "index": {
            "aheadBlocks": 0,
            "checkpointHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
            "complete": true,
            "canonicalState": {
              "fault": {},
              "ok": true,
              "rebuild": {
                "active": false,
                "status": "complete",
                "network": "livenet",
                "complete": true,
                "startedAt": "2026-09-15T18:22:43.424Z",
                "updatedAt": "2026-09-20T14:42:46.390Z",
                "fromHeight": 948000,
                "completedAt": "2026-09-20T14:42:46.390Z",
                "bootstrapHash": "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986",
                "bootstrapHeight": 947999,
                "indexedThroughBlock": 967846,
                "indexedThroughBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
                "transactionNormalization": "canonical-raw-tx-only"
              }
            },
            "checkpointCanonical": true,
            "canonicalCheckpointHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
            "indexedThroughBlock": 967846,
            "lagBlocks": 0,
            "available": true,
            "ok": true,
            "readModels": {
              "confirmedIds": {
                "count": 505,
                "maxBlock": 965011
              },
              "confirmedTransfers": {
                "count": 231,
                "maxBlock": 967825
              },
              "confirmedEvents": {
                "count": 26276,
                "maxBlock": 967844
              }
            },
            "summarySnapshot": {
              "blockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
              "coverageByKey": {
                "growthSummary": 967846,
                "inceptionSummary": 967846,
                "infinitySummary": 967846,
                "logSummary": 967846,
                "marketplaceSummary": 967846,
                "tokenSummary": 967846,
                "workFloor": 967846,
                "workSummary": 967846
              },
              "eligible": true,
              "generatedAt": "2026-09-20T14:46:30.904Z",
              "indexedAt": "2026-09-20T14:46:30.904Z",
              "indexedThroughBlock": 967846,
              "payloadBytes": 20753770,
              "snapshotId": "cfe1180c020446d5deec3753",
              "ok": true
            },
            "scanTipHeight": 967846,
            "stopReason": ""
          },
          "node": {
            "bestBlockHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
            "chain": "main",
            "headers": 967846,
            "initialBlockDownload": false,
            "ok": true,
            "pruned": false,
            "tipHeight": 967846,
            "txindexHeight": 967846,
            "txindexSynced": true,
            "verificationProgress": 1
          },
          "worker": {
            "ageMs": 3275,
            "containment": {
              "active": false,
              "checkpointHash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
              "checkpointHeight": 967846,
              "failingBlockHeight": null,
              "fingerprint": "",
              "network": "livenet",
              "nextRetryAt": null,
              "reason": "canonical-scan-success",
              "repeatCount": 0,
              "txid": ""
            },
            "consecutiveFailures": 0,
            "error": "",
            "lastSuccessAt": "2026-09-20T14:55:35.573Z",
            "maxAgeMs": 600000,
            "ok": true,
            "proofReady": true,
            "proofSource": "idle-confirmed-replay",
            "pendingEvents": {
              "globalUnresolved": 0,
              "model": "bounded-best-effort-pending-event-health-v1",
              "ok": true,
              "q16PendingUnresolved": 0,
              "required": true,
              "scope": "all-observed-pending-protocol-events",
              "status": {
                "checked": 25,
                "deferred": 0,
                "errors": 0,
                "ok": true,
                "q16ParentDeferred": 0,
                "staleCandidates": 25,
                "unavailable": false,
                "unavailableValid": true
              }
            },
            "phase": "idle"
          }
        },
        "indexedAt": "2026-09-20T14:55:38.848Z",
        "indexedThroughBlock": 967846,
        "lagBlocks": 0,
        "mempoolBase": "http://127.0.0.1:8080",
        "ok": true,
        "ready": true,
        "service": "proofofwork-op-return-api",
        "tipHeight": 967846,
        "mode": "readiness"
      },
      "elapsedSeconds": 1.723821109160781
    },
    "coreAfter": {
      "chain": "main",
      "blocks": 967846,
      "headers": 967846,
      "bestblockhash": "000000000000000000000db7b326be3daf3c65b20eef5e0bc09e8fd63ea907fe",
      "bits": "17021ec5",
      "target": "000000000000000000021ec50000000000000000000000000000000000000000",
      "difficulty": "132757073449487.5",
      "time": 1789915339,
      "mediantime": 1789914107,
      "verificationprogress": 1,
      "initialblockdownload": false,
      "chainwork": "000000000000000000000000000000000000000148f2490722d698b09b7ef90a",
      "size_on_disk": 877520358685,
      "pruned": false,
      "warnings": []
    },
    "coreIndexes": {
      "txindex": {
        "synced": true,
        "best_block_height": 967846
      },
      "coinstatsindex": {
        "synced": true,
        "best_block_height": 967846
      },
      "basic block filter index": {
        "synced": true,
        "best_block_height": 967846
      }
    },
    "completedAt": "2026-09-20T14:55:38.849164+00:00",
    "qualification": "Only indexed confirmed delta selected at start, not a new raw-block discovery campaign; pending/dropped membership is bracketed best-effort and does not certify discovery of all mempool protocol candidates. Local health is a separately timed checkpoint."
  },
  "displayedPendingChecks": {
    "idMatchesLog": true,
    "coreCarrierMatchesStoredRawPayload": true,
    "coreCarrierMatchesStoredProtocolPayload": true,
    "coreCarrierBytesMatch": true,
    "rawScriptWitnessPayloadMatchesCore": true,
    "registryPaymentMatchesStoredAndLog": true,
    "pendingBeforeAfterCore": true,
    "pendingDatabaseAndCore": true
  },
  "sourceFiles": {
    "server/proof-api.mjs": {
      "bytes": 2480490,
      "sha256": "8985dafa6e8794041242435e8dad7aa292c6fe34ae35ca929aca5068228c67e8"
    },
    "server/work-amo-v5-raw.mjs": {
      "bytes": 169639,
      "sha256": "982480d43555dcea0aa7fd045931ce1252187e746d3ed32e20beea1802e3b50c"
    },
    "src/App.tsx": {
      "bytes": 1768468,
      "sha256": "edc7f8c8f5482521e47fd91132bab8aca66443d992a9211374cf209c93ec9c76"
    },
    "src/workAmount.ts": {
      "bytes": 7647,
      "sha256": "04524d8bb8091f63a0c4fb4c9e66b8e10eb45d4af2273be51ec060eea319f335"
    },
    "src/exactAmount.ts": {
      "bytes": 4246,
      "sha256": "099a65054ba40752aa9f75c7048bfa21319aae6ff44ac555898fbe92e5fdae36"
    },
    "server/boost-projection.mjs": {
      "bytes": 14987,
      "sha256": "4d0226a254178f25568023141def9cd533a9fe8c86a17dfcd87a4ee5581f02db"
    },
    "server/db/proof-index-reader.mjs": {
      "bytes": 1482171,
      "sha256": "a5a4226df168fe1efd57228e5d33a76593b81f1f6e834bee86826e7848e429dc"
    }
  },
  "additionalReceiptFiles": {
    "backend-security-evidence.json": {
      "bytes": 118007,
      "sha256": "81cb7841c9be8e3df2015dcd48d9af53b0604a20a97ccae544da7763a266930e"
    },
    "final-delta-evidence.json": {
      "bytes": 45056,
      "sha256": "6cb1029f0ea9476d6f7a6ed85f39232fb0fb3db71b45179cad22754e3f4a5751"
    },
    "prior-verification.json": {
      "bytes": 9464,
      "sha256": "0b5dc55fe3bbc2faa39aef6faa6424529c4a59e1ef9132fe9ba1fd31967bb21e"
    },
    "backend/current-state.json": {
      "bytes": 5961538,
      "sha256": "26cb42514987a184f06462c933df4cf2d5e6a6190b3e1037777d014c7ecaad00"
    },
    "backend/current-state.sql": {
      "bytes": 2574,
      "sha256": "bdc13e27cf32d34ee0b2a305a0b8aa88dabd2a3f2cb91a40ae23b9a31c28621d"
    },
    "backend/check-state.mjs": {
      "bytes": 4357,
      "sha256": "007b63603518c6d52745346f7cabfee4f2dfe02d7db93b86888fc575b1fa7b27"
    },
    "backend/core-check.py": {
      "bytes": 258407,
      "sha256": "ac416b0ce096a3ab0fc5d7a1b7e4c1ad1a971b6aa4dda464a41a850f8bb9f232"
    },
    "backend/check-seals.mjs": {
      "bytes": 1176,
      "sha256": "0fa625db43bb5c95f4fe51fc98b38c960a1c14ed1358fbb6d0c11e4a73db0415"
    },
    "backend/core-check-results.json": {
      "bytes": 312179,
      "sha256": "2298571bd55e7ab98ffe43f55710efecec1749caa2ba9465b5ec71d5d4da1f77"
    },
    "backend/wallet-checkpoint-967846.txt": {
      "bytes": 10094,
      "sha256": "3f8adffa596decb73e3ec4f1f64f47b4dab8c8a28c2e53f8e809e5b2b3fdc335"
    },
    "backend/transition-967846-commitments.txt": {
      "bytes": 532,
      "sha256": "b49e85a8c3067a0c5d633ce70283bae2570b1e03d1be89694b35b6e2495c63d4"
    },
    "repro-public-tx-status.mjs": {
      "bytes": 5243,
      "sha256": "56992ee9e9cb3791d42e772b1b66c536fd6467218d69a96ae5ab35597c285747"
    },
    "backend/check-wallet-source.cjs": {
      "bytes": 2472,
      "sha256": "e9c39f3f02a786408af2fc9436707fa37f58f6e174b71c14e36c735fa006939b"
    }
  },
  "limitations": [
    "No signing/broadcast/connected-wallet DOM/admission/production fault injection.",
    "Current state rehash at967842; stored exact wallet transition comparison at967846.",
    "Root HTTP receipts hash original response bytes; saved JSON hashes reflect formatting.",
    "Prior failed exhaustive gates remain incomplete; no fresh whole-chain replay or physical/off-host restore certification."
  ]
}
```

</details>

<details>
<summary>Exact transaction-detail status reproduction</summary>

```javascript
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const file='/home/sixer/ProofOfWork.Me/server/proof-api.mjs';
const source=fs.readFileSync(file,'utf8');
const take=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b).trim();};
const snippets={
 rpc:take('async function fetchTransactionFromBitcoinRpc(txid, network, options = {}) {','async function fetchTransactionHexFromBitcoinRpc('),
 fallback:take('async function fetchTransactionWithSourceFallback(txid, network) {','async function fetchPendingMailTransactionFromFirstParty('),
 payload:take('async function txPayload(txid, network) {','const INTERNAL_VERIFIER_STATE_TTL_MS'),
 confirmed:take('function transactionConfirmed(tx) {','function transactionBlockHash('),
 route:take('      const payload = await txPayload(txid, network);','    errorResponse(response, 404, "Not found.");'),
};
// Preserve exact route branch body, omitting only its enclosing if-closing brace.
assert.ok(snippets.route.endsWith('}'));
const routeBody=snippets.route.slice(0,-1);
const route='async function extractedPublicTxRoute(txid,network,response){\n'+routeBody+'\n}';
const txid='a'.repeat(64),oldHash='b'.repeat(64);
const report={startedAt:new Date().toISOString(),source:file,sourceSha256:createHash('sha256').update(source).digest('hex'),extractedHashes:Object.fromEntries(Object.entries(snippets).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')])),tests:[]};
function ctx(overrides){return vm.createContext({console,Date,extractProtocolMemo:()=>null,errorResponse:(r,status,error)=>Object.assign(r,{status,error}),jsonResponse:(r,status,payload,cache)=>Object.assign(r,{status,payload,cache}),...overrides});}
const providerCalls=[];
const rejected=label=>async()=>{providerCalls.push(label);const e=new Error(label+' timeout');e.statusCode=503;throw e;};
const errors=ctx({fetchTransactionFromBitcoinRpc:rejected('Core'),fetchTransactionFromElectrum:rejected('Electrs'),fetchTransaction:rejected('first-party-mempool'),fetchTransactionFromPendingSources:async()=>{providerCalls.push('pending-sources-unavailable');return null;}});
vm.runInContext([snippets.fallback,snippets.confirmed,snippets.payload,route].join('\n'),errors,{timeout:1000});
const internal=await errors.txPayload(txid,'livenet');
providerCalls.length=0;
const out={};await errors.extractedPublicTxRoute(txid,'livenet',out);
assert.equal(out.status,404);assert.equal(out.error,'Transaction not found.');assert.equal(internal.status,'dropped');
report.tests.push({case:'all providers unavailable, empty cache',result:'reproduced false404',providerCalls,public:out,internalStatus:internal.status,desired:'503/unavailable; do not certify absence'});
const cache=new Map([['livenet:'+txid,{txid,status:{confirmed:true,block_hash:oldHash},vin:[],vout:[]}]]);
const rpcCalls=[];
const reorg=ctx({TRANSACTION_CACHE:cache,MAX_TRANSACTION_CACHE_SIZE:100000,TX_FETCH_CONCURRENCY:2,transactionInputsHavePrevouts:()=>true,bitcoinRpc:async(method,params)=>{rpcCalls.push({method,params});return method==='getrawtransaction'?{ok:true,result:{txid,confirmations:0,version:2,locktime:0,vin:[],vout:[]}}:{ok:true,result:{time:1}};},coreVoutToMempoolVout:x=>x,mapWithConcurrency:async(items,_count,fn)=>Promise.all(items.map(fn)),fetchTransactionFromElectrum:async()=>{throw new Error('unneededfallback');},fetchTransaction:async()=>{throw new Error('unneededfallback');},fetchTransactionFromPendingSources:async()=>null,errorSummary:e=>e.message});
vm.runInContext([snippets.rpc,snippets.fallback,snippets.confirmed,snippets.payload,route].join('\n'),reorg,{timeout:1000});
const warm={};await reorg.extractedPublicTxRoute(txid,'livenet',warm);
assert.equal(warm.status,200);assert.equal(warm.payload.status,'confirmed');assert.equal(warm.payload.tx.status.block_hash,oldHash);assert.equal(rpcCalls.length,0);
const warmCalls=rpcCalls.length;
cache.clear(); // This mutates only the isolated fixture Map, never application state.
const cold={};await reorg.extractedPublicTxRoute(txid,'livenet',cold);
assert.equal(cold.status,200);assert.equal(cold.payload.status,'pending');assert.equal(rpcCalls[0].method,'getrawtransaction');
report.tests.push({case:'cached confirmed transaction; current mocked Core says unconfirmed',result:'reproduced staleconfirmed',withCache:{httpStatus:warm.status,status:warm.payload.status,blockHash:warm.payload.tx.status.block_hash,rpcCalls:warmCalls},sameProviderAfterClearingFixtureCache:{httpStatus:cold.status,status:cold.payload.status,confirmed:cold.payload.confirmed,rpcCalls},desired:'immutable bytes may remain cached; canonical status must revalidate'});
report.completedAt=new Date().toISOString();report.scope='Exact-source extracted functions and route body in Node VM with isolated deterministic mocked providers/cache; no network, app startup, live fault or production mutation. Status-only synthetic transaction fixture does not attempt raw-transaction validation.';
fs.writeFileSync('/tmp/pow-ordered-audit-2026-09-20/repro-public-tx-status.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
```

</details>

<details>
<summary>Exact Wallet calculator reproduction</summary>

```javascript
const fs=require('node:fs'),vm=require('node:vm');
const ts=require('/home/sixer/ProofOfWork.Me/node_modules/typescript');
const bitcoin=require('/home/sixer/ProofOfWork.Me/node_modules/bitcoinjs-lib');
const base='/tmp/pow-ordered-audit-2026-09-20/';
function moduleExports(path){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Intl,console});return exports;}
const work=moduleExports('/home/sixer/ProofOfWork.Me/src/workAmount.ts'),exact=moduleExports('/home/sixer/ProofOfWork.Me/src/exactAmount.ts');
const source=fs.readFileSync('/home/sixer/ProofOfWork.Me/src/App.tsx','utf8');const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const funcs=ast.statements.filter(ts.isFunctionDeclaration).filter(n=>n.name).map(n=>n.getText(ast).replace(/^export default /,''));
const allowed=/^(WORK_TOKEN_(ID|TICKER|AMOUNT_STORAGE_MODEL|PRECISION_MODEL)|POWB_TOKEN_(ID|TICKER)|INCB_TOKEN_(ID|TICKER)|TOKEN_SALE_AUTH_|TOKEN_LISTING_ANCHOR_|ID_LISTING_(TICKET_ANCHOR_TYPE|ANCHOR_))/;
const constants=[];for(const statement of ast.statements)if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name)&&allowed.test(d.name.text)&&d.initializer)constants.push('const '+d.getText(ast)+';');
const wallet=JSON.parse(fs.readFileSync(base+'root/08-wallet-address.body.json','utf8'));
const context=vm.createContext({...work,...exact,bitcoin,Buffer,console,Date,Intl,wallet});
const code=ts.transpileModule(constants.join('\n')+'\n'+funcs.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
vm.runInContext(code,context);
const r=vm.runInContext('tokenSpendabilityForWallet(wallet.holders[0].address,wallet.tokens[0],wallet)',context);
const out={observedAt:new Date().toISOString(),checkpoint:wallet.indexedThroughBlock,snapshotId:wallet.snapshotId,sourceFunction:'src/App.tsx:tokenSpendabilityForWallet',activeListings:r.activeListings.length,confirmedBalanceSubatoms:r.confirmedBalanceSubatoms,reservedBalanceSubatoms:r.reservedBalanceSubatoms,pendingOutgoingSubatoms:r.pendingOutgoingSubatoms,spendableBalanceSubatoms:r.spendableBalanceSubatoms};
fs.writeFileSync(base+'backend/wallet-source-results.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
```

</details>

<details>
<summary>Current-state read-only snapshot query</summary>

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT json_build_object('kind','context','observedAt',clock_timestamp(),'readOnly',current_setting('transaction_read_only'));
SELECT json_build_object('kind','transition','height',block_height,'hash',block_hash,'closingN',closing_network_value_q8::text,'closingStateSha256',closing_state_sha256,'closingStatePayloadBytes',closing_state_payload_bytes,'closingTokenState',payload->'closingTokenState','closingSufficientState',payload->'closingSufficientState','v8',payload->'workAmoV8') FROM proof_indexer.work_amo_block_transitions WHERE network='livenet' ORDER BY block_height DESC LIMIT 1;
SELECT json_build_object('kind','balances','rows',json_agg(json_build_object('token',token_id,'address',address,'confirmed',confirmed_balance::text,'pending',pending_delta::text))) FROM proof_indexer.credit_balances WHERE network='livenet';
SELECT json_build_object('kind','v8_listings','rows',json_agg(json_build_object('id',l.listing_id,'status',l.status,'seller',l.seller_address,'amount',l.amount::text,'price',l.price_sats::text,'ticketTxid',l.sale_ticket_txid,'ticketVout',l.sale_ticket_vout,'ticketValue',l.sale_ticket_value_sats,'sealTxid',l.seal_txid,'closeTxid',l.close_txid,'sealConfirmed',l.payload->'sealConfirmed','expiresAt',l.payload->'saleAuthorization'->>'expiresAt','amountSubatoms',l.payload->>'amountSubatoms','frozenTerms',v.frozen_terms))) FROM proof_indexer.credit_listings l JOIN proof_indexer.work_amo_v8_listing_terms v ON v.network=l.network AND v.listing_id=l.listing_id WHERE l.network='livenet';
SELECT json_build_object('kind','legacy_open','rows',json_agg(json_build_object('id',listing_id,'token',token_id,'status',status,'version',payload->'saleAuthorization'->>'version','amount',amount::text,'seller',seller_address,'relic',payload->'relic','disabledReason',payload->'disabledReason'))) FROM proof_indexer.credit_listings WHERE network='livenet' AND status IN ('active','sealing') AND payload->'saleAuthorization'->>'version'<>'pwt-sale-v8';
SELECT json_build_object('kind','snapshot','id',snapshot_id,'height',indexed_through_block,'at',generated_at,'hash',source_hashes->>'blockScan','consistency',consistency->>'status','workSufficientState',payload->'workSufficientState','stats',payload->'summaryPayloads'->'workSummary'->'token'->'stats','tokenKeys',(SELECT json_agg(k) FROM jsonb_object_keys(payload->'summaryPayloads'->'workSummary'->'token') k)) FROM proof_indexer.ledger_snapshots WHERE network='livenet' ORDER BY generated_at DESC LIMIT 1;
ROLLBACK;
```

</details>

Embedded receipt JSON SHA256 (UTF-8 bytes inside its fence, including its final newline): `cea1eeed7f10bff38d7a3ef91de2a1f7583a3169ea9bdd1ef1972707e77fe51e`.

### Addendum verification completed

- `npm run hygiene:check` passed. `hygiene:fix` was intentionally not invoked under the explicit no-cleanup instruction.
- `git diff --check` passed; the new append was also checked separately for trailing whitespace and balanced code fences because this audit file is still untracked.
- The original 45,149-byte Markdown prefix, original evidence JSON, already modified hygiene manifest and pre-existing untracked deployment script retain their pre-append hashes. Only the approved Markdown append changed in this continuation.
- Embedded receipt JSON parses and its exact UTF-8 hash matches the recorded digest. Source/status and arithmetic evidence received independent review; the final text distinguishes Q8 integers from displayed proof units and physical carrier payload comparisons from whole-script comparisons.
- Nothing was staged, committed, pushed, deployed, restarted, deleted or cleaned. New fixes and cleanup remain subject to separate explicit approval.


## Local implementation follow-up — H19-01 and H19-04

**Date:** 2026-09-20 17:51:57 UTC. **Scope:** the separately approved local implementation and testing of the two existing High/P1 accounting findings, followed by this append. This is an implementation follow-up to both Audit 19 passes above, not another production health audit.

**Authorization:** “I approve implementing and testing the local code fixes for H19-01 and H19-04 and updating Audit 19. Preserve protocol rules and historical records. No production changes, deployment, cleanup, commit, or push without separate approval.”

**Disposition:** H19-01 and H19-04 are **locally implemented and tested; production remains open/unverified**. No new finding IDs are assigned to the same discrepancies. H19-02, H19-03 and all other unresolved operational, storage, search, cache and historical-lifecycle findings retain their preceding dispositions.

### Review baseline and preserved evidence

The prior Audit 19 findings, embedded chain/SQL receipts, earlier-issue dispositions, repository instructions and canonical documents were reviewed before this implementation. Local HEAD remains `0ef9c3bee3212a4cb0ae6efe7abbb6a75be72ffa`. The original **158,462-byte** Audit 19 Markdown prefix has SHA256 `d46714c705b865146cb6ad1dc4ce2cc64ea9b9d09871dd28bb01b072cd0da2b2` and is preserved in full. Its original 45,149-byte first-pass prefix and embedded ordered-pass receipt remain unchanged within it.

The original Audit 19 evidence JSON remains **330,727 B**, SHA256 `63c83279344e99372a850eb02881147ea2a3f84afdf8f17431a774344cca5b96`. The previously modified hygiene manifest and pre-existing untracked Audit 17 deployment script retain their pre-implementation hashes recorded below. They were not implementation changes in this follow-up.

### H19-01 — exact closing aggregates reach the response

The indexed ledger builder now applies the verified closing accumulator's exact aggregate values to **both** the global token projection and the WORK token projection after `workFloorWithVerifiedWorkAmoV5ClosingState`, before metrics, source hashes, snapshot identity and consistency are produced. Preliminary enrichment also retains all seven existing aggregate Q8 fields. The closing overlay updates aggregate statistics only; event/listing/transfer records and their historical valuation stamps are preserved.

All ten closing aggregate prefixes carry integer Q8 plus exact decimal proof aliases; explicitly named approximate aliases remain display approximations. `token-credit-aggregates-match-verified-closing-state` compares the token projections against the closing state and records the exact height/hash and aggregate Q8s. The live-value equality check now compares exact Q8 values as well as compatibility fields. A one-Q8-unit discrepancy cannot hide behind equal floating-point numbers.

Read guards cover token responses, wallet token summaries and canonical summary provenance. They reject the demonstrated contradictory old “green” response without modifying its stored snapshot. New evidence must match the response checkpoint, token values and closing floor, including every nested/parent proof and every aggregate field. Older snapshots without the new proof are checked for the available same-response contradictions; this is not a claim that every unproved historical snapshot becomes independently verified.

The captured 967846 regression distinguishes the old frozen credit value `35018484903593979776250105` Q8 from the canonical closing value **`103731127226109176156137879` Q8**. Both corrected token projections receive the latter in the local builder fixture. Exact live credit Q8 is **`838762214502555077956660935`**. These are dated Audit 19 fixture values, not newly sampled production values.

### H19-04 — replay capacity governs balances and transfer admission

A new read-only `proofIndexWorkWalletCapacities(network, {blockHeight, blockHash, addresses})` reader exposes `canonicalWorkCapacities` on current Q16 WORK wallet responses. Each address receipt contains:

- Model `canonical-work-wallet-capacity-v1`, network, exact Core address key and WORK token ID.
- Exact indexed height and block hash.
- Decimal integer strings `confirmedBalanceSubatoms`, `reservedBalanceSubatoms` and `transferableBalanceSubatoms`.
- Every retained canonical reservation's listing ID and exact amount.
- The closing token-state commitment envelope: model `canonical-work-amo-payload-sha256-v1`, SHA256 and byte count. Its committed preimage uses `canonical-work-token-state-subatoms-v3`.

The reader checks a fresh canonical-block database fence, including previous hash, exact V8/state models and complete/atomic/fee-once/invalid-zero flags. On a cold checkpoint it reads the existing trusted transition and uses the existing V8 boundary validator to rehash sufficient-state and complete token-state commitments. Capacity is derived from the full retained reservation set with BigInt; duplicates, invalid amounts, conflicting aliases, inconsistent totals or over-reservation fail closed. The visible wallet holder balance must equal the receipt's exact confirmed balance.

Only compact verified capacities are cached, for at most eight keys; concurrent cold reads share bounded in-flight verification. Every call still reads the canonical database fence, and callers receive cloned receipts. No schema, stored balance, reservation, transition, database retention or replay rule was changed.

Wallet balances, reservation labels, spendable amounts, composer/attachment estimates and fresh action preflight now use this capacity independently of the Core-filtered active listing book. Local pending outgoing transfers and additional pending listings remain conservatively held; known canonical reservations are not counted again as pending sales. Missing/mismatched receipts, duplicate holder keys and malformed pending debits disable spending and display unavailable capacity. The composer retains the draft and disabled Send control when capacity is unavailable. Non-WORK and pre-Q16 reservation behavior remains compatible.

Direct WORK transfer, mail attachment and bond attachment signing paths refresh capacity again immediately before broadcast. The shared node/slipstream server admission path independently resolves the **first address-bearing input** from Core's txid-bound parent bytes and decoded prevout script, requires a ready exact-tip checkpoint, checks sequential send3 quantities against canonical capacity, and rechecks the Core tip. A batch cannot reuse capacity already debited by an earlier transfer. Exact self-send accounting follows raw replay.

Independent review caught and corrected address-identity edge cases during local implementation: raw replay keeps distinct uppercase/lowercase stored Bech32 keys and exact recipient text. The reader, API holder check and UI preserve those historical keys; only the requested wallet address maps to Core's canonical spelling. An uppercase recipient spelling is not incorrectly treated as a net-zero transfer from a lowercase replay key. Addressless inputs are skipped using the same script-to-address behavior as replay. These are conformance tests of existing behavior, not a protocol migration or a claim that the edge cases occurred in production.

The minimal dated Wallet fixture retains the actual 105 active and 38 closed reservation IDs/amounts from Audit 19:

| Q16 subatoms at 967846 | Previous Wallet result | Corrected local result / canonical replay |
| --- | ---: | ---: |
| Confirmed | 999980000000000 | 999980000000000 |
| Reserved | 65722187250 | **89507365978** |
| Spendable | 999914277812750 | **999890492634022** |

The corrected display is **0.0999890492634022 WORK**. All 143 retained reservations are included; the 38-ticket difference remains **23785178728 subatoms**. The old displayed maximum and a one-subatom excess are rejected, while the exact canonical limit passes the local admission fixture. The active listing book and Core-spent closure classification are not rewritten.

The new 16-KB test fixture identifies its source as the previously captured, pretty-printed wallet JSON, SHA256 `c8eaff46a84f00defd91d894b2ff27ab79a8392c366fe9bf6b11ccd50cc7b6c7`. Its new capacity envelope is explicitly synthetic test input; the old production response did not contain that field. The original wire-body receipt remains separately identified in the ordered audit. Full boundary verification tests also execute a separately constructed serialized raw-block replay fixture. The saved 967842 receipt lacks opening state, so it was not misrepresented as a full-boundary test of the new reader.

### Verification completed

Node version: **v22.23.2**. All checks below completed successfully on the local changes. Network/provider operations in focused tests are isolated fixtures; no signed transaction or live broadcast was created.

| Check | Result |
| --- | --- |
| `npm run check:audit19-accounting` | **28 named tests pass**: 10 closing-aggregate, 8 capacity-reader/raw-replay and 10 frontend tests, plus the standalone API admission assertions. |
| H19-01 boundaries | Actual indexed builder, actual ledger checks and three response entrypoints; preserved event objects; exact aliases; one-Q8-unit changes; absent/malformed fields; stale height/hash; contradictory nested/parent proofs. |
| H19-04 boundaries | Audited 143-reservation case; one-subatom boundaries; numbers above safe Number range; multi-send/self-send behavior; first address-bearing script; Core tip change/unavailable evidence; holder parity; exact address keys; pending deduplication; cache isolation/concurrency; actual composer HTML rendering. |
| `npm run check:index-recovery-behavior` | Canonical transfer-fee tests and **529/529** existing behavior checks pass. |
| `npm run check:work-amo-v5`, `check:work-amo-v6`, `check:work-amo-v8` | Pass; historical formulas, declarations and frozen settlement behavior remain unchanged. |
| `npm run check:work-precision-v2`, `check:bond-exact-arithmetic` | Pass. |
| `npm run check:api-truth`, `check:ui`, `check:live-data`, `check:server-globals` | Pass. |
| `npm run check:send-prep-fixtures`, `check:read-projections` | Pass; eight send-preparation cases and read-projection tests. |
| TypeScript and Vite | `node node_modules/typescript/bin/tsc --noEmit` and build pass. Final output is `/tmp/pow-h19-fixes-2026-09-20/build-reviewed`; existing build/release directories were not emptied. |
| Repository review | `git diff --check`, repository hygiene check, canonical-doc/operating-memory review, protected-file hashes, ignored/untracked inventory and unstaged scope reviewed. No staging or commit. |

Existing extraction-based regression fixtures were updated to load the new production helper dependencies; the live-data contract now requires the compact-summary wrapper and its aggregate guard. Transaction-shape fixtures keep their existing scope, while the new standalone admission suite executes the actual broadcast-to-capacity call path. These fixture updates followed initial missing-helper failures; the final suites above pass.

The Vite build emits a chunk-size advisory: the final App chunk is approximately **766.40 kB**, **185.80 kB gzip**. This is a build observation, not a measured production speed improvement or a new issue ID. No production latency, database-query benchmark, connected-wallet interaction, fresh full-node sweep or deployment verification was performed during this local implementation. The new SELECT was inspected against the existing schema and reader contracts; it was not executed against production PostgreSQL in this follow-up.

### Storage, limits and separate approval

The previous host-capacity measurements remain dated evidence. In particular, the UI VPS's last audited **12.51 GiB available**, only **2.51 GiB above its 10 GiB reserve**, still requires attention before release/backup work. No new free-space claim is made here. No production backup, cache, temporary file, log, release, ledger or historical record was deleted or altered; **zero production bytes were reclaimed**. The capacity reader adds no persistent database rows. Local test/build artifacts remain under `/tmp`.

`hygiene:fix` was intentionally not run because the explicit no-cleanup instruction controls this scope. `hygiene:check` passed. Review of SOUL and the canonical documents found that the fixes enforce their existing exact, replayable accounting and signing rules; no protocol/product rule change or unrelated documentation rewrite was needed.

The server guard proves capacity at a confirmed checkpoint; it does not reserve funds against unrelated concurrent mempool transactions or guarantee future block ordering. The UI additionally deducts locally known pending debits. A newer block, reorg, conflicting pending transaction or unavailable authority can still require retry. The client verifies receipt scope and arithmetic; independent full-state verification belongs to the node/indexer reader and replay operator.

Separate explicit approval remains required for:

1. Any commit, push, production deployment, service restart or infrastructure/configuration change. A future rollout must verify current UI disk headroom, deploy compatible API/UI changes, allow normal current-summary generation, and recheck live values/admission against the then-current full node before closing H19-01/H19-04. Known contradictory old summaries can fail closed until a corrected current snapshot is available.
2. Any modification to production data, historical summaries, balances, reservations, ledgers, evidence, protocol semantics or record history. **No such repair or reservation release is required by these local fixes.**
3. Storage cleanup/retention work and the remaining Audit 19/prior-audit findings. Previously listed candidates must be revalidated against current live, rollback and restore dependencies before any approved removal.

### Reproducible local source receipts

The following SHA256s bind this follow-up to the reviewed local files; HEAD alone does not describe these uncommitted changes.

| Local file | Bytes | SHA256 |
| --- | ---: | --- |
| `package.json` | 8523 | `637d69eecf0d64296bbc48d2cbc79c3412bd4f89c9ca26c89a223fb2c20c0007` |
| `server/proof-api.mjs` | 2495141 | `c17d889ed2f0c4594483f8ad53c1ecd1b09bc9392edda606ebbb42102d121e8b` |
| `server/db/proof-index-reader.mjs` | 1484304 | `fee7a7ac857f0395f465efc36102c6547f920e1620a266f869ba251c967e94c2` |
| `server/work-wallet-capacity.mjs` | 8875 | `33217bf0b76bd792aa54c81d639f84a520133003916e7d124eb721a5b770ced6` |
| `src/App.tsx` | 1778061 | `1d86915e18ec2926d44bd8798dd86ac27ef261d67d396e00204e072256caec03` |
| `src/shared/work/canonicalWorkCapacity.ts` | 3691 | `e2d71ea717deb29ae1a6de27c6e5676996c2508af379a6616b5001dd61673acc` |
| `server/canonical-credit-aggregates.test.mjs` | 20781 | `4a1f5178c1d71041fffad4baea273132d0ad0769e31a68d322d5114234583d18` |
| `server/work-wallet-capacity.test.mjs` | 15731 | `1a859fe9c06a8407049a6c4b81a6373709e424a7e1fa3aac81d727962933a023` |
| `scripts/check-h19-work-capacity-admission.mjs` | 10547 | `dd0a66cccaf133efea22342a94e3504142995e49f0596c34f6ffea1e21900a4e` |
| `scripts/check-h19-work-capacity-client.mjs` | 16943 | `10fee9b051ea0ae1bbf23ef057a3eb825565e2a5a19c9dc9e0987db09554b572` |
| `scripts/fixtures/h19-work-wallet-reservations.json` | 16638 | `6781bda24f6d256af57b63eb1696e9206f141ed3f6da7f9fc9d477de6c819e9c` |
| `scripts/check-index-recovery-behavior.mjs` | 2692337 | `88c3dbaa13efae8be372ed5ff022450d8fd9a702c6add9f14773305aa12d2017` |
| `scripts/check-live-data-contract.mjs` | 218679 | `08ca5602a7a9f0538802d57a09923c809537b327ab506eb2d2f94e83efc6ed04` |
| `scripts/check-work-amo-v8-gates.mjs` | 37350 | `0e177ba6c1988b0f9ac3a3ef55484f4f5dc753a76949bcb5bdd79422c85eb1df` |

Validation logs are local scratch evidence in `/tmp/pow-h19-fixes-2026-09-20/`; their digests below identify the completed runs. Future operators should rerun the committed test commands rather than assume `/tmp` remains available.

| Validation log | Bytes | SHA256 |
| --- | ---: | --- |
| `audit19-accounting.log` | 7503 | `329296e11ed140f69480ef4cd65ec82e9050131851cbd33b8677677c19042713` |
| `index-recovery.log` | 39784 | `cc878e36b3dd55f64d906a97d1668b37afe050cc7cf6a027e486cda2f193bd58` |
| `typescript.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `build-reviewed.log` | 4604 | `40f49c60a7b20e82eb953790e69a783df72ccbe64e73ef6018b85ebe86db8429` |
| `api-truth.log` | 298 | `417775c69522d448c0e0c98c3080d29f7a070b3fd12cd911ae65a27f02dac327` |
| `ui-contract.log` | 97 | `a1b6a72ad3aa48c75291cc5682fc612c0789615343aca0e78e5db2d8d1d0e404` |
| `live-data.log` | 112 | `85cff36e4fcb45a69c06bcaa569ada01d0e8f3d35b4bf5e5117ba70d53f0c204` |
| `server-globals.log` | 144 | `941b4d32fbb160e1b3efbeb2bfa8106f15f533969fc4b230f30c8e3b0d40975a` |
| `hygiene.log` | 134 | `c501942de5d3c65c2445bb7178083e0794cc7491a71a7ba3a354acef2a10a8bb` |

**Preserved pre-existing work:** `repository-hygiene.json` remains 7,264 B / `fb37a4d130e36c98836e9993cf6381d40f6ac2a667d4b39c0fa9e8ffb89c373d`; `deploy/audit17/publish-node-work-floor.py` remains 7,659 B / `95ad97f0f55b0dda7170c18614e7d92dbd0e77db36403b0d605d449b473d95d2`. The original audit evidence hash is recorded above. No production access, deployment, restart, cleanup, staging, commit or push occurred in this local implementation follow-up.

## Authorized H19-01/H19-04 production rollout — 2026-09-20

**Disposition at 18:49 UTC:** the approved H19-01 and H19-04 corrections are committed, pushed, deployed and production-verified within the scope below. The application is operational, but the broader audit is **not an all-clear**: H9-01 is reopened, H9-03 retains its known qualification, H19-02/H19-03 remain unresolved, and storage/readiness/latency risks continue under their existing IDs.

### Scope, authorization and audit continuity

The user explicitly approved committing, pushing and deploying the tested H19-01/H19-04 fixes, necessary application restarts, normal current-summary generation and production verification. When the existing derived-summary retention budget was shown to be nearly full, the user separately replied **“you can prune”** to the narrow routine derived-summary retention question. That approval covers the existing protected canonical-summary retention policy; it does not authorize a database migration, balance/reservation change, ledger repair, protocol-history rewrite, wallet signing, transaction broadcast or unrelated storage deletion.

This dated follow-up updates the deployment status of **H19-01** and **H19-04**. Their earlier audit descriptions and the local-only implementation record above remain historical evidence. No duplicate finding ID is created. All other unresolved findings retain their prior status unless an explicit result below says otherwise.

The exact pre-append Audit 19 prefix is **175,953 bytes**, SHA256 **`32e43091a28d317d8e87b475264755373b8fa438e98563b1dc00b95dbaf78546`**. The existing evidence JSON remains **330,727 bytes**, SHA256 **`63c83279344e99372a850eb02881147ea2a3f84afdf8f17431a774344cca5b96`**. This append preserves the earlier record by adding a dated follow-up; the preceding bytes remain the required continuity anchor. New rollout receipts are identified below rather than replacing the original evidence.

### Source release and commit hygiene

The reviewed accounting changes and Audit 19 records were committed as **`56694a7d6d76de565d4e0a6fce94f880d5308550`**, tree **`980f8ae43a58a84291703737fc9da45d6a5691a5`**, titled **“Fix canonical credit aggregates and WORK wallet capacity”**, from baseline **`0ef9c3bee3212a4cb0ae6efe7abbb6a75be72ffa`**. The commit was pushed and the main workspace was aligned to it. The author/committer is the repository's configured identity, and the commit contains `Documentation-Impact: updated` and `Repository-Hygiene: reviewed` trailers.

The commit was assembled in an isolated `git clone --no-hardlinks` checkout under `/tmp/pow-h19-rollout-2026-09-20/commit-checkout`. Exactly the 17 reviewed files were copied byte-for-byte and staged. The repository's `.githooks` remained enabled. `hygiene:fix`, `hygiene:check`, the pre-commit hygiene review and staged whitespace review passed; the isolated checkout had **zero pre-existing allowlisted cleanup candidates** and no cleanup was performed. The original workspace's existing local state was preserved. The 17-file inventory and file hashes are recorded in `commit-staged-receipt.json`.

The pre-existing untracked `deploy/audit17/publish-node-work-floor.py` was excluded from the commit and deployment. It remains **7,659 bytes**, SHA256 **`95ad97f0f55b0dda7170c18614e7d92dbd0e77db36403b0d605d449b473d95d2`**. That older hardcoded deployment script was not used.

The staged node release was attested using the installed deployment workflow and fixed production Node runtime. All **28 named accounting tests** and the standalone API admission assertions passed on the staged node candidate. This repeats the focused accounting checks on the candidate; it does not relabel the earlier local 529-check behavior run as a new full production test.

| Artifact | Identity |
| --- | --- |
| Node release | `56694a7d6d76-20260920T180605Z` |
| Node source bundle SHA256 | `7567cc80b1aedad839aeac900d0ff5562b6b93be527053f90fd80a9ee1b418b0` |
| Node candidate/rollback path | `/opt/proofofwork-api-stage-56694a7d6d76-20260920T180605Z` held the candidate before exchange and holds the preserved old `0ef9c3b` checkout afterward; the new release is live at `/opt/proofofwork-api`. |
| Node staged attestation | 6,642 entries; 195,659,036 bytes; runtime SHA256 `ffc4e240ca0dee9092b39cb236bd6d7dd69880d6a313d91d63a08f9763dd9c0f` |
| UI release | `56694a7d6d76-20260920T180539Z` |
| UI source bundle | 91,349,873 bytes; SHA256 `a33f932ef8b7c7383d29b78f0234c53a17e6c6fc0bc15581370372585262e1a9` |
| UI surfaces bundle | 182,228,300 bytes; SHA256 `072bec1d030ec320c7be59be4f0cb70c573018d6d10f983591ab85bc4d2295c5` |
| Complete UI release archive | 185,266,279 bytes; SHA256 `2fafcdaf20f0b8f138bf464b384a9d4f6d25320bd587fb06c70f7d3c562b0a77` |

### Preservation and capacity checks before cutover

The UI candidate contains all 15 managed surfaces, unchanged passthrough content and the prior release's reachable asset compatibility closure. Computer/NFT equality and candidate archive provenance passed. The installed publisher was pinned at SHA256 `5f10c8fb2b1733d24b452c2bfe96c1e32acaed9c8e15798601bcc39cc9757d56`; comparison with the reviewed repository helper found only an existing 45-second compatibility-scan timeout and explanatory comments. No installed helper was replaced.

The UI staging controller retained the incoming bundles, source checkout, extracted surfaces, release archive, rollback roots and all partial evidence. It did not publish, restart services or delete existing files. It created the archive directly from the complete candidate rather than allocating a second large archive-payload copy. The receipt records **zero deleted paths**. Both existing rollback roots were independently fingerprinted and passed intact to the publication plan:

- `proofofwork-www-pre-0ef9c3bee321-20260920T053656Z`.
- `proofofwork-www-pre-132b87faaac7-20260919T174900Z`.

Repeated storage gates charged conservative allocation bounds without crediting cleanup, hardlink savings or deduplication. They required a **10 GiB available-space floor plus 64 MiB growth reserve**, including the later publisher's verification allocation. The staging receipt began at **18:11:47 UTC**; its final `ready-for-publisher-verification` gate later recorded **12,109,389,824 bytes (11.28 GiB)** available and a remaining private verification bound of **240,295,936 bytes**. Individual gate timestamps were not recorded, so the receipt start time must not be attributed to the final allocation measurement. This is a staging measurement, not the final post-release free-space reading. The UI still has limited reserve above its 10 GiB operating floor; this rollout does not resolve the previously recorded capacity risks.

The node's mandatory checkout attestation initially found one pre-existing writable Git metadata file: `/opt/proofofwork-api/.git/index`, mode `0664`. At **18:22:17 UTC**, the deployment operator restricted it to `0600` so the unchanged old checkout could pass the required attestation. Its **50,650 bytes** remained identical, SHA256 **`3a4b3f8a21d45cc25f5b2d642196d111cdbdd359e9001fab36af6295bd6206aa`**. This was a Git metadata permission change; no source bytes, production records or history were edited by that action.

At **18:11:35 UTC**, a read-only call to the staged capacity reader successfully executed the new PostgreSQL SELECT and full existing trusted transition verification against the live database. Core checkpoint **967875**, hash **`00000000000000000001080233ca932a01bf1f69e033cb0e0935ffef12f419d7`**, returned the affected wallet's **143** canonical reservations:

| Candidate capacity field | Exact Q16 subatoms |
| --- | ---: |
| Confirmed | `999980000000000` |
| Reserved | `89507365978` |
| Transferable | `999890492634022` |

The canonical token-state commitment was model `canonical-work-amo-payload-sha256-v1`, **2,109,650 bytes**, SHA256 **`abf894b6a9aec3ea551cfcc1fe5f296f6d714cd320def8b22b464dbe03d34aac`**. The single measured call completed in about **923 ms**. This proves that the staged reader ran successfully against that live checkpoint; it is not a load benchmark or proof that the public API/UI already served the release.

### Derived-summary retention and ordinary maintenance boundaries

The read-only retention assessment used the deployed pruning predicates. The initial complete predicate/size query reached the enforced 30-second statement timeout and was canceled. The bounded predicate query and separate size query completed at **18:12:29/18:12:57 UTC**; all 104 unprotected canonical summary IDs, heights and timestamps agreed between them. This is two matching observations, not one atomic full-size certificate.

There were **130 canonical summaries and 19,878 scan snapshots**, **20,008 snapshots in total**. The 104 unprotected canonical summaries occupied **2,145,875,035 logical JSONB-text bytes**, leaving only **1,608,613 bytes** under the existing **2 GiB** logical budget. There were no then-current deletion candidates, unsafe heights, detached/same-height candidates or row-budget candidates. A new summary comparable to the latest **20,753,779-byte** summary would exceed that budget and make the oldest unprotected summary eligible. This is logical payload size; deletion does not imply that PostgreSQL immediately returns the same number of filesystem bytes.

The existing routine retains protected referenced evidence and applies its canonical-height safety guard. The user authorized that narrow existing derived-summary pruning after this condition was explained. The rollout does not broaden retention policy or change persistent worker configuration. The first controlled worker pass nevertheless uses the supported invocation-only `POW_INDEX_PRUNE_LEDGER_SNAPSHOTS_AFTER_SUMMARY=0`, enabling a separate proof that the first corrected summary was inserted without rewriting or removing prior snapshot rows. Restoring the original normal worker then resumes the approved existing retention policy. The final receipts distinguish those two intervals below. No snapshot removals were observed during the one-shot or first-ready inventory intervals. The later 18:43:50 sample did observe one approved derived-summary removal, described below; the restored routine policy remains enabled.

A normal worker pass also invokes existing projection-maintenance functions, so no-prune alone is not sufficient evidence of untouched historical rows. A bounded read-only preflight at **18:18:35 UTC**, using matching deployed function hashes, found **zero** confirmed data-byte repair candidates, **zero** listing-anchor repair candidates and **zero** listing-seal repair candidates. For Mail, 616 events required 1,260 participant aliases and exactly 1,260 were present: **zero deletion, insertion or `powid` update candidates**. The runtime's holder-maintenance flag was `0`; WORK participant/minter repair flags were unset and the ordinary worker strips these supervised-only flags from children. These are point-in-time checks of the named maintenance functions, not a claim that every normal ingestion write is globally append-only.

### Controlled deployment and production verification

The node cutover completed successfully at **18:35:10 UTC**. It waited with the old application serving from **18:23:10 UTC**, secured previously unsummarized Core checkpoint **967877** at **18:33:55.735 UTC**, exchanged the attested checkouts at **18:34:00.192 UTC**, and started the new API at **18:34:00.219 UTC**. The ordinary no-prune worker pass ran for **55.068 seconds**, completing at **18:34:55.394 UTC**. Readiness was true with zero lag at **18:35:09.987 UTC**. No rollback was needed. These receipts are retained on the node under `/data/proofofwork-audit19-cutover-56694a7d6d76-20260920T180605Z` and locally under `node-receipts/`. The roughly 4.5-second exchange interval is measured from the controller's secured-checkpoint log to its API-start log, not an external continuous HTTP availability measurement.

The reviewed node controller waited for a new Core block while the old API and worker continued serving, stopped the old worker, and required a checkpoint not already summarized by the old release. It inventoried prior snapshot IDs, `xmin`, height and summary/block hashes before exchanging the complete attested checkout. It paused relevant application/maintenance scheduling, rechecked service inactivity after timer stop, drained application database sessions, and verified Core, Electrs, PostgreSQL and WAL receiver process identities separately. API startup's shared cache path was fixed and checked for age-eligible temporary files before restart.

The exchange used the installed atomic helper. A normal bounded worker `--once` ran with the original environment and only summary pruning disabled. A fresh checkpoint prevents deliberate same-checkpoint repair; inventory comparison verifies a new summary ID and unchanged prior snapshot `xmin`. The original normal worker was then restored with approved routine retention. A second inventory recorded any removed derived summaries and rejected prior-row rewrites or removal outside the canonical-summary scope. Both the cutover and ready checkpoints were checked against Core. Any uncertain forward or rollback exchange leaves services/timers unresumed until both checkout identities are known; the rollback path verifies both roots.

| Production result | Verified result |
| --- | --- |
| Node exact live commit/tree/runtime and application uptime | Live attestation matches commit/tree/runtime above. API and worker restarted; Core/Electrs/PostgreSQL/WAL did not. Protected archive publication passed: **90,396,601 bytes**, SHA256 `9d088c22042e9003c8a42ee8dbf58e7d7a9d8140cb076f69f11661b89daf19c5`. |
| New ordinary summary | Canonical summary **`55ab0c3df8b8a0debf44c5db`**, height **967877**, hash **`0000000000000000000130b4c4b48fe72bf694f86084cfa369deb94899b2c866`**, generated **18:34:24.165 UTC**; all eight required summary keys cover that checkpoint. |
| First no-prune snapshot preservation | **20,009 → 20,011** rows. New scan snapshot `1dd8d27088d6ec32cd0fab6e` and canonical summary `55ab0c3df8b8a0debf44c5db`; **zero prior IDs removed or updated**, using ID/`xmin` comparison. |
| Restored worker retention | Post-ready inventory: **zero prior summaries removed, zero prior snapshot rows rewritten**. Normal approved pruning is enabled; this result is a bounded observation, not a disabled-retention claim. No temporary or permanent worker configuration change. |
| Core/Electrs/PostgreSQL/WAL services | All four authority-service PID/state records match preflight. Core, Electrs, indexer and txindex agree at **967877** and its canonical hash; no initial download, no pruning mode, zero lag, worker idle/proof-ready and no unresolved observed pending events. |
| UI complete-root publication | All **15 managed surfaces** published by complete-root exchange at **18:40:24 UTC**, exact approved commit/tree, archive provenance byte-equal and verified. Manifest SHA256 **`e022f65976b2bd847adc5b923b13ea2c2cd6e7a4a5835610b7fe73333afe39bb`**. Previous root retained as `proofofwork-www-pre-56694a7d6d76-20260920T180539Z`; all three rollback roots remain. Caddy was not restarted. |
| UI final space and inodes | At **18:49:17 UTC**, **12,106,440,704 B available (11.28 GiB)**, **13,790,633,984 B filesystem-free**, total **39,973,924,864 B**. Available inodes **2,337,907 / 2,427,136**. Available-space margin above the 10 GiB floor is **1,369,022,464 B (1.28 GiB)**. |
| Node final space/database health | Final node sample at **18:43:50 UTC**: root **69,747,011,584 B available (64.96 GiB)**; `/data` **440,028,925,952 B (409.81 GiB)**. PostgreSQL **31,306,439,703 B (29.16 GiB)**; largest relation `work_amo_block_transitions` **29,912,629,248 B**. No invalid/not-ready indexes, waiting locks or cumulative deadlocks observed. Checksums remain off; no new physical-page integrity claim. |
| H19-01 public/API math | **348/348** read-only checks pass at 967877 for WORK summary, WORK token and Credit summary; independent BigInt reconstruction, stored commitment rehash and bracketing Core hash checks agree. Exact fields are listed below. |
| H19-04 wallet/API/frontend math | At 967877, the live receipt and separately read canonical transition agree on **all 143 reservation IDs/amounts**. Actual frontend functions calculate **`0.0999890492634022 WORK`**, with **zero additional pending outgoing subatoms** for the observed wallet. Full existing boundary validation and Core binding pass. Deployed UI artifact/render checks are separately recorded below. |
| Public surface/asset/API smoke | All **14 ordered public surfaces** rendered in Chromium, Computer last. **672/672 external archive files** matched exact bytes (48 duplicate NFT files excluded); **184/184 captured HTML/rendered asset bodies** matched approved build bytes. Home's initial registry 503 recovered on a fresh context; AMO completed its bounded follow-up in **46.588 s**. See qualified observations below. |
| Final repository/audit verification | The exact original Audit 19 prefix, evidence JSON and excluded script hashes were verified unchanged. The final isolated-checkout `hygiene:fix` removed **zero paths**; `hygiene:check` and whitespace review passed. Semantic review retained existing SOUL, protocol/product documentation, classified evidence and generated artifacts. This follow-up changes only the audit by appending results. Its commit identity is recorded by Git; deployed application source remains **56694a7**, and the audit-only follow-up requires no redeployment. |

The three H19-01 public responses returned HTTP 200 and shared the new summary ID and Core-bound checkpoint. Independent verification at **18:36:44 UTC** reconstructed the eight primary credit aggregate Q8 fields from the immutable same-height sufficient state; the two carry fields were checked for exact fixed-flow reconciliation across API proof/floor/statistics. The sufficient-state commitment was **2,520,963 bytes**, SHA256 **`d3a0d1cfd96d073e6a8705a32708a217054ebdc2116b664863f92e4bca33adac`**; 21,307 recorded movement entries were present.

| Canonical aggregate | Exact Q8 value |
| --- | ---: |
| Event/frozen credit value | `103731127226109176156137879` |
| Event/live credit value | `838762214502555077956660935` |
| Movement/frozen credit value | `103731127221891972156137879` |
| Movement/live credit value | `838762214498337873956660935` |
| Fixed credit value | `4217204000000000` |
| Full live network value | `838762214843018138826228612` |
| Live WORK floor | `39941057849667530420` |

The matching frozen/live network aliases and `creditNetworkValueQ8` were checked rather than substituted for a separate formula. Rehashing the sufficient state and matching Core membership does not constitute a new genesis replay or a new valuation of every historical event.

H19-04's public wallet response, SHA256 **`99408f0cce308e56775a02173b45bdf7367053dde470a3a06eff2915167a7538`**, was captured at the same 967877 checkpoint. Actual frontend functions passed at **18:36:39 UTC**. Independent raw canonical transition verification completed at **18:38:42 UTC** and passed the existing full boundary validation and canonical Core hash check. The commitment remains **2,109,650 bytes / `abf894b6a9aec3ea551cfcc1fe5f296f6d714cd320def8b22b464dbe03d34aac`**. All **143** reservations match, including **105 active** reservations totaling **65,722,187,250 subatoms** and **38 closed** reservations totaling **23,785,178,728 subatoms**. Their canonical sum is **89,507,365,978 subatoms**; confirmed **999,980,000,000,000** minus reserved gives **999,890,492,634,022**, displayed by the actual frontend helper as **0.0999890492634022 WORK**. The reservation-ID/amount digest is **`475f681b7ff83284a0a2dd96f9b2d70c57867ece50f1102803fc885258af5b85`**. This proves the affected confirmed wallet capacity at that checkpoint without releasing closed-ticket reservations or relying only on response self-consistency.

Production verification uses read-only calls, exact integer arithmetic and the actual frontend functions against captured API responses. It must not be described as a connected wallet, signed transaction, transaction broadcast or end-to-end mined transfer. The initial CUA browser was unavailable; the approved installed Playwright/Chromium fallback completed the ordered rendered surface checks without downloading a browser. Chromium **149.0.7827.55** rendered the 14 ordered surfaces in fresh unauthenticated contexts, with screenshot and text evidence, then rechecked Home and AMO. No connected wallet, signing or private account action was exercised. HTML/asset/API checks and local component/function checks remain distinct from browser render evidence. This release verification is not another full historical transaction sweep or physical PostgreSQL page-checksum audit.

H19-01's live aggregate/API verification and H19-04's live API/raw-transition/frontend-function reconciliation pass at 967877. Exact deployed UI artifact checks and ordered browser rendering now pass within their bounded scopes. **H19-01 and H19-04 are production-verified and closed for the specific corrected discrepancies.** This does not close the broader non-green gates, latency/availability family, H19-02/H19-03, connected-wallet coverage or remaining historical verification limitations.

### Final capacity, retention and read-path reliability

The final UI sample confirms the exact active release/provenance and all three protected rollback roots. Caddy remained active at its existing PID with **zero restarts** and **zero sampled warning/error-priority records**. UI memory available was **3,383,316,480 / 4,005,457,920 bytes**, with no swap; one-second CPU busy was **0.5%** and load **0.084 / 0.151 / 0.171**. These are point samples. The **11.28 GiB** available disk space leaves only **1.28 GiB** above the 10 GiB operating floor, reduced by the intentionally retained release/source/staging evidence. Continue **H5-01/H13-01**: another large release/backup peak must pass the same allocation/reserve checks. No transport bundle, prior release, backup or rollback root was removed to create this release.

The node's final **18:43:50 UTC** sample remained ready at Core/Electrs/indexer/txindex height **967877**, zero lag, matching canonical hash, worker proof-ready and zero unresolved observed pending events. Available memory was **114,329,378,816 / 134,125,752,320 bytes (106.48 / 124.91 GiB)**; one-second CPU busy **6.348%**, iowait **0%**, and load **4.53 / 3.15 / 2.73** across **32 CPUs**. Authority-service PIDs remained equal to pre-cutover, and API/WireGuard API/worker PIDs remained equal to first-ready with zero subsequent restarts. PostgreSQL checks were bounded health/inventory queries; checksums are disabled and this rollout did not run a physical-page checksum audit or a new restore/PITR exercise.

Snapshot retention has three distinct observations:

1. Before cutover **20,009** rows; after the first no-prune pass **20,011** rows: two new rows, every prior snapshot ID/`xmin` unchanged.
2. At first readiness, still **20,011** rows: no prior removal or rewrite.
3. At **18:43:50 UTC**, **20,010** rows: existing normal retention had removed exactly one pre-cutover **unprotected derived canonical summary**, **`d090ccf0dc54d6963a0b89d1`**, height **967767**, under the user's explicit pruning approval. No surviving pre-cutover snapshot changed `xmin`. All **27 currently protected IDs present at baseline** remained with original `xmin`.

Five protection-query references were absent from both inventories; they are documented historical exceptions rather than rollout losses: the three approved absent INCB witnesses already noted in Audit 19 and the V5 migration seed/closing references recorded in Audit 5. The new summary **`55ab0c3df8b8a0debf44c5db`** was ordinarily refreshed at **18:35:26.755 UTC**, after its first publication/first-ready capture, changing its new-row `xmin` to `2535033`. It was **not a pre-cutover historical row**. No claimed reclaimed disk bytes are inferred from the single logical row deletion.

Logs prevent an error-free or fully healthy read-path claim. The untruncated API/worker journal sample **18:33:50–18:43:50 UTC** had no warning/error-priority records, but **171 message matches** were emitted at priority 6: **115** raw-RPC admission-queue-full messages, **19** API pending-hydration failures, **7** worker disappeared-mempool-transaction messages, **14** local address-history 404s plus **14 duplicate HTML-title fragments**, **1** registry-summary unresolved-transaction failure and **1** 2,500-ms listing-lifecycle enrichment timeout. These categories are not 171 independent incidents. They overlap the live read checks and do not establish causation by H19 code changes. Record them under the existing **H5-06/H10-05/H12-06/H18 availability/latency family**, which remains open.

Browser evidence is consistent with that limitation. All 14 main documents returned 200 with no JavaScript page exceptions and no desktop horizontal overflow at the sampled 1,440-pixel viewport. Home's initial registry request returned 503; a fresh browser context later returned current registry data with no console error. AMO's first capture was still loading; its follow-up reached Ready with canonical/proof gates and the full WORK market after **46.588 seconds**, completing **18:48:15.520 UTC**, with zero JavaScript/console/API errors in that follow-up. Slow eventual recovery does not meet a low-latency guarantee. Some other captures did not reach network-idle within their bounded observation; no blanket completed-hydration or all-interactions claim is made. Home's third-party YouTube embed was deliberately blocked by the first-party-only read-only harness; its blocked-request record is not an application failure. Browser and Desktop disconnected shell rendering does not replace the separately captured public chain-content API checks. Screenshots/text/module/API receipts are retained. All 14 screenshots were visually inspected. **Thirteen representative API endpoints plus the affected authoritative fresh wallet endpoint** have successful HTTP 200 receipts. The original historical-transaction receipt had an audit-harness metadata collision (`status:confirmed` overwrote numeric HTTP status); it was preserved, and a separate **18:47:12.998 UTC** GET correctly recorded **200 / confirmed / no-store**. This is not an application failure. Browser guest landing and historical transaction API were checked without repeating the earlier complete 1,018-byte content reconstruction. Infinity/Inception retained explicit verified-preview/incomplete-book notices at roughly 17 seconds; their full books were not awaited. Growth's Boost detail remained “observations being prepared” in the sample and was not diagnosed as a new regression. The exact-byte external sweep covered 201,578,456 bytes with at most two concurrent GETs, including compatibility assets; the duplicate NFT alias's 48 files were excluded from network fetching and verified server-side against Computer. Desktop guest context, one viewport and no connected wallet are explicit limits.

### Broader read gates: H9-01 reopened under its original ID

The broad marketplace gate is **not green**. It passed fast ID lookup and the WORK Marketplace V2 contract, then exited **1** on **“WORK AMO V5 cutover and write gate”**: exact fresh WORK `closed-listings` history returned listing **`4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1`**. The request returned HTTP 200 in **39,670 ms**. The preceding exact invalid-attempt and invalid-seal preservation assertions passed. Later marketplace stages did not run and are not counted as passed.

This reopens **H9-01**, not a new H19 finding. Audit 9's approved repair (lines 884–892) explicitly preserved this attempted listing as confirmed-invalid evidence while requiring exact active, closed-listing and market-log reads to remain terminal-empty. The later Audit 9, Audit 10 and Audit 18 records report marketplace gate passes. The present result is therefore a regression of that recorded read contract rather than merely the longstanding non-failing V5 migration warnings.

Pre-H19 evidence already demonstrates conflicting read models. The original Audit 19 stable WORK response at **967837**, snapshot **`258048b156bc24b3fc8eb723`**, contains this relic in `closedListings[203]` as `valid:true`, `status:disabled`, `relic:true`, reason `work-amo-v5-pre-unit-relic`, closed by declaration txid **`54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36`**. The same response preserves the invalid attempted listing separately. Its **76,607,356-byte** body SHA256 **`217d9993f1e6824f9a6972d8061d8f3cd0c83ebdc583cd05e8f438016b3c6452`** matches the original committed evidence inventory. Fresh 967838 and ordered 967846 captures omit the closed relic while retaining the invalid history; absence from those compact/scoped responses alone does not prove a terminal exact-history result.

Function-level source comparison between **0ef9c3b** and **56694a7** shows the entire token-history route, history resolver, value/witness wrappers, DB history SQL/mapper and pre-unit relic evidence reader are byte-identical. The complete marketplace gate and V5 protocol module are also unchanged. The conflicting projection therefore predates these accounting patches, and no direct H19 causality is demonstrated. The exact same queried route was not captured immediately before deployment, so this is not a controlled same-route A/B proof and does not exclude indirect timing/fallback effects.

Impact is the historical membership/rendering discrepancy and a failed broad gate. No new canonical balance corruption, released reservation, active buyable relic or transaction broadcast was established; the specific H19-01 aggregate and H19-04 capacity proofs remain separate passing results. Follow-up requires a narrowly reviewed reconciliation of the relic evidence/relational/fallback paths with the canonical invalid attempt and the prior terminal-empty contract, plus a failing-route regression fixture. Preserve the invalid records and chain evidence; do not rewrite historical rows or weaken the gate as part of this rollout. The **39.67-second** read is also an observation in the existing latency family, not a new latency issue ID.

The other broad results reported by the rollout operator are **ledger PASS**, **Mail PASS**, and **99/102 parity checks passing**: one known **H9-03** four-auxiliary-transaction canonical scan-marker qualification error and two existing non-failing V5 warnings. Snapshot/read checks passed. The `read-gates.json`, ledger/Mail logs and compact parity receipt are hashed below. The application must not be described as universally green solely because the two approved accounting corrections verify.

### Rollout actions, remaining authority and follow-up

Completed rollout actions: approved source commit/push; node/UI candidate creation; one Git metadata mode restriction preserving bytes; atomic node checkout exchange; API/worker restart; one ordinary no-prune indexing/summary pass; restoration of original worker/timers; node archive/provenance publication; live aggregate and affected-wallet verification. No rollback or snapshot removal occurred in the measured node cutover intervals. The complete UI root was subsequently published without a Caddy restart, exact external/module bytes and ordered renders were verified, final host capacity was sampled, and the existing worker later pruned one approved unprotected derived summary. No manual cleanup, migration, canonical balance/reservation repair, signing, broadcast or rollback was performed.

No migration, canonical reservation release, balance rewrite, signing or transaction broadcast is required by these accounting fixes. Any additional historical repair, protocol change, unrelated retention expansion or removal of backups/releases/evidence still requires its own explicit authorization. Existing historical findings outside this rollout remain tracked under their original IDs. Retain the UI capacity follow-up: preserve the live/rollback/restore dependencies, measure release and database growth, and revalidate any future cleanup candidates against current state before removal.

Priority follow-up remains:

1. Address the existing readiness/latency family with bounded reproduction of RPC queue saturation, pending hydration and slow exact history/AMO loads; preserve fail-closed semantics and distinguish dependency failure from true absence.
2. Repair/reconcile reopened **H9-01** under its original ID, using the exact historical txid and unchanged baseline evidence; separately resolve the existing **H9-03** auxiliary canonical-proof marker qualification without fabricating scan evidence.
3. Maintain the UI disk reserve and node backup/database growth forecasts. Retain complete live/rollback/restore dependencies; any additional cleanup or policy expansion requires a specifically reviewed scope.
4. Continue **H19-02/H19-03** transaction-detail absence/cache correctness work and the previously uncompleted physical-integrity, off-host restore and connected-wallet verification. This rollout does not supersede those findings.

The receipts below bind preparation, deployment and completed verification results. The parent audit's original evidence is unchanged. Scratch paths are operational evidence locations, not guaranteed permanent archives; essential results and digests are therefore included here; operators should preserve the referenced detailed receipts in the approved durable evidence locations and rerun relevant checks rather than assume `/tmp` survives.

### Rollout receipt hashes

Receipt root: `/tmp/pow-h19-rollout-2026-09-20/`. These hashes identify preparation, the final reviewed controller, node/math verification, publication, browser/API observations and final capacity samples.

| Receipt | Bytes | SHA256 |
| --- | ---: | --- |
| `cutover-node.py` | 12174 | `cd30f5904fd5233ef4c3c89f1572fe66f7c7182169653eb3b75a34d11b083c95` |
| `stage-ui.py` | 17771 | `8698fbb78201cece034f4293c905758af952bd1ff07777819e084af7fab5aa4f` |
| `node-accounting-tests.log` | 3620 | `6c987b04afe56d146fece1cb51f71a30f3c5b6c5bcfe044184f019543fa57a9f` |
| `commit-staged-receipt.json` | 4943 | `2212ccd5795dcd40d6bea0495251a98baace46fe073d891493c02bc28351c1da` |
| `commit-hygiene-fix.log` | 141 | `fb44bc081ea22069e5f4b902f9c06bafa235d46d283b584ccc0e5c1a00c78b1a` |
| `commit-hygiene-check.log` | 134 | `c501942de5d3c65c2445bb7178083e0794cc7491a71a7ba3a354acef2a10a8bb` |
| `commit-precommit-review.log` | 199 | `85eec056306d666bc73f51ecf169732646bdead90aea3acdec5a2cc40079c9a7` |
| `node-stage.log` | 921 | `2cd9c536c6c0b3973c07d36fb87618a4c016297612991d668b8331b9df6af91f` |
| `node-candidate-capacity.json` | 24082 | `be028990b31c42f3651a64930a12a6314964468e1ddbb48d8f1baad6fcfcd791` |
| `ui-stage-receipt.json` | 4974 | `37c8935e4eeac6ed89bc9b019eb5aeb6d664761ec0e71a8dff43ec5cc69dab4d` |
| `ui-candidate-provenance.log` | 206 | `aea288806ff1ec710a252fd6fc35e6ac260648806411392a58ad8a5e91ab606c` |
| `h19-01/retention-combined-result.json` | 45122 | `d7951f812734c2405bbf5186e3f3ce71f2b7d341331d82ef12fbe62bb6eaa6a9` |
| `h19-01/maintenance-preflight-result.json` | 1505 | `e4b4865b455790e7843bd459b4cbbed6d64d5c35abb1736d8dd5c5f9c5ba3ef5` |
| `node-git-index-permission-receipt.json` | 365 | `de528daf15619c12844e43decf05df9f978573d99ecf5cbbac3b79b6fff969a8` |
| `node-receipts/exchange.json` | 234 | `ecbd306cfc558ffa2afee0fd1b6476483ad8963df11d9bea95f417fe7c422ef6` |
| `node-receipts/snapshot-preservation.json` | 523 | `90910638dc4a631a6a261fa48b3a35ac75c910b4b5222b2dc0df3a59816df1dc` |
| `node-receipts/after-ready-retention.json` | 154 | `1e25140e3a992bb6490556a5ea77a282da70171e0cdc385478254131c167d576` |
| `node-receipts/after.json` | 7453 | `f56d901f6809019061ac297b22140eb30cab92e8732aaabed89513a60759ae5c` |
| `node-receipts/worker-once.log` | 13435 | `a8ec385d6415239d6eed655e82cea6d989f74e714f893a029bc9442e08d097d9` |
| `node-receipts/snapshots-before.json` | 2989352 | `7597752b88966a6df5d15d91ef98ac508b134db8d81bdcb5e4b8e9dbf6285a7c` |
| `node-receipts/snapshots-after-oneshot.json` | 2989712 | `11b6780c89b03e48a7326fe408b1abe4016a04a6b6e8e19143df5fb0fb671b85` |
| `node-receipts/snapshots-after-ready.json` | 2989712 | `11b6780c89b03e48a7326fe408b1abe4016a04a6b6e8e19143df5fb0fb671b85` |
| `node-cutover.log` | 564 | `c12767a6fd5d65ee1c6d088a29316f6d2cbedef4e05c167413fc17dc518078fa` |
| `node-release-publication.log` | 333 | `0a458dcbd6ac122d7113bc93e245f8b0e50f5c83be7042b42fd1e6775d12cec7` |
| `h19-01/postdeploy-1835/verification.json` | 9118 | `81cea793c75044db55a47e6dc4f5edec5cfa27949a99163b09028ac7b30f43a4` |
| `h19-01/postdeploy-1835/wallet-verification.json` | 1717 | `07bd93d1aa9c7d55e26e4bf451da01d14b4984170c3cf1c1446bde4317c5dac6` |
| `ui/post-wallet-verification.json` | 1186 | `457f4d249658a78515920fc08264423b43a6d68c972b429c118097b49dc145ca` |
| `h9-01/adjudication.json` | 3988 | `c3fc8bf2d02b1747a113ee2e527aae8915956c951324a1e5a2dad489c970c065` |
| `h9-01/source-comparison.json` | 4072 | `7b6b3416dd708cb269f0fce369ba03bea748e8c5e745318a959ded920807331f` |
| `node-receipts/read-gate-marketplace.log` | 4153 | `5252681303376d96b1b0283275a07e2e38b7b6411248c3fcb43a4dfa1cc71a6f` |
| `node-receipts/read-gates.json` | 734 | `dd5f127dada8d94e5371f57be7fca042ebebc164318387a5c79fb2a2ae4d3d1a` |
| `node-receipts/read-gate-ledger.log` | 137 | `96b5a5800d60b0a43faf7a6d5923b1d1adac0817887166fea78e8cafdf1c6c12` |
| `node-receipts/read-gate-mail.log` | 2496 | `35e6f939e95a6e8c85fe1bc758ff77a819ebc3490418a2509c051e3b8b577423` |
| `indexer-parity-summary.json` | 777 | `250ed4e47f3c6eadc77bfdfa929910ec049fc66bbfd523ce12693ec10e73168f` |
| `ui-publish.log` | 3687 | `82a9503301c45db9c0018b3e5dbe9f2bc702438b9c65961bc9cafe5d8d8affa4` |
| `final-ui-sample.json` | 3784 | `def6622cc7fd8b8bdf6e5d6d72b8e22e5c328cd4631f24ce21db4175b82790c3` |
| `h19-01/final-node-sample-summary.json` | 25496 | `630f115cebb55ec70a9806d6e9901bbf35905bdb490c1022415623ac5d1e319c` |
| `h19-01/final-node-evidence-manifest.json` | 1900 | `73046409cfdff0797ba756e52f31738d97e56e5b8a46c61ad5f38c39e67095ad` |
| `h19-01/final-journal-adjudicated.json` | 3560 | `53e48ca99dfe3f40bcc5dc74f47c265e3affa1485d4a095abbb3726cd8bddad4` |
| `ui/post-render-results.json` | 82142 | `59142683ce63ddffb4056a49528e8b63a9cff53d99dd730d40a108fbc14d2d39` |
| `ui/post-followup-render-results.json` | 17227 | `6ff8156b2bcb07a89567331e4f7f80ca43cefb7f94773620a96ce9e76064e399` |
| `ui/post-build-parity.json` | 28102 | `75ac366074ced9661e5d37f299ab3c7740ae0e540c98cfe7fc74c713ceff7de3` |
| `ui/post-external-archive.json` | 439530 | `670ab7232ff95f2e24cd4904c4a98e81290d377192e607815d50b1a73855b752` |
| `ui/post-apis.json` | 16401 | `25863389a9cb2ac2bbb06033d45411f6924b9c2565b6865b4bcc28ec2a7ac362` |
| `ui/verification-summary.md` | 8404 | `c94eacd65beb4f5d2b2554f47236d07a416ab0e0da13312b713cb4642c531b67` |
| `ui/evidence-sha256.json` | 16483 | `9368d2ce885d885870ed6f362bf2429a3eaa02853a1ca3d136ac977fa1960a8f` |
| `ui/post-recheck-apis.json` | 659 | `1f34179c8d03a4dd52e0ca639a1f3ded1c7d3cbf0d6bb4a7aebac52e4f22f399` |
