# Audit 20 — production health, capacity, data integrity and math

**Audit date:** September 22, 2026. Live checks: approximately **06:13–06:31:38 UTC** (02:13–02:31:38 America/Toronto). This is a read-only audit of both production VPS environments, the local source, prior audits, and fourteen rendered public application surfaces. The user approved creation of this completed audit log. No production data, configuration, protocol records, ledgers or historical evidence were changed. **Production bytes deleted: 0.**

**Disposition: qualified pass for the checked stored data and arithmetic; not an application-wide all-clear.** Final public readiness passed at block **968111**, with zero index lag. All 25,625 stored confirmed transactions checked against Core matched; structural, address/reference/Mail, supply and exact arithmetic comparisons found no discrepancies in their stated populations. Capacity, publication-size, transaction-status, marketplace-projection and verification-gate issues remain. Some broad/live gates did not complete successfully.

The [companion evidence bundle](2026-09-22-production-comprehensive-health-data-integrity-audit-20.evidence.json) contains dated results, exact candidate paths, provenance, predecessor hashes, bounded reproduction sources, failed-gate transcripts, and browser observations. Its SHA-256 is **`6bcd0548bae7767a221e3f48cf61ef0b8510eec7f0e0a87b3d956752c5c18e1c`**. Temporary paths in receipts identify where checks ran; the embedded evidence, rather than `/tmp`, is the durable record.

## Continuity, authority and scope

The six required operating documents were read in order. Before live auditing, the history review covered all **30 preceding Markdown audit logs**, evidence/reproduction artifacts, financial issue records, and the later September 22 rollout continuation in `OP_RETURN_INFRASTRUCTURE.md`. The evidence inventory records 45 predecessor artifacts. All **41 entries in Audit 19's predecessor inventory still match their recorded bytes and SHA-256**; audit JSON parsed successfully.

- [Audit 19 and its follow-ups](2026-09-20-production-comprehensive-health-data-integrity-audit-19.md): current Markdown SHA-256 `d9cc19784ce8fd72844fd4a8c92bc140bc49ee8fd2b688dd34de1e4de8479a1d`; original evidence SHA-256 `63c83279344e99372a850eb02881147ea2a3f84afdf8f17431a774344cca5b96`.
- [Infrastructure continuation](../OP_RETURN_INFRASTRUCTURE.md): the September 22 rollout is newer than the original Audit 19 snapshot. Its application fixes and known qualifications were rechecked rather than reported again as new findings.
- Local source: `a18cae48fdf486eca8168a28fdd114c33c3f7dfb`. Existing untracked `deploy/audit17/publish-node-work-floor.py` was preserved.
- Node live source: `a1e1f9b1c18d8e5ca6721afe8f12ff3fe88e47f8`; runtime SHA-256 `85ffcdb9e4dd4beb073ff194b79b8331ab812ee714671e3bf3515a326edc080d`.
- UI live release: `6c5e7b5a3d03-20260922T042824Z`, source `6c5e7b5a3d038a66baa830822f4521fdcc849031`; archive SHA-256 `4f1900e81a4afecbdfcb4b12b0af2f6659b616cb4d3845bb4b8198ee726aa304`. Provenance verification passed. The differing API/UI source commits agree with the documented rollout and intervening runner/documentation changes.

Confirmed chain facts remain canonical; pending visibility is time-local. Reads used bounded queries and read-only transactions; protected audit runners verified `transaction_read_only=on`, used one database connection, and disabled report writes. HTTP reads can cause normal application cache work and access logs. No wallet was connected; no signing, broadcast, service restart, restore, repair, configuration change, commit, push or deployment occurred.

“All” below means the named stored population at its recorded snapshot. This is not a new genesis-to-tip replay or proof that no historical raw-chain event was ever missed. Separate checks advanced from block 968107 to 968111; they are not one global atomic checkpoint. Concurrent audit work affects observed latency.

## Health and capacity

Bytes are exact where shown. GB is decimal; GiB is binary. Filesystem use percentages are `df` values; API percentages can differ because they account for reserved filesystem blocks differently.

| System | Capacity / used / available | Result |
| --- | --- | --- |
| UI VPS `77.42.91.106`, root, final 06:30:53 | 39,973,924,864 / 27,420,971,008 / **10,868,760,576 B**, 72% used | **Only 131,342,336 B (125.3 MiB) above the 10 GiB protected reserve.** This is about 10.12 GiB total available, not 125 MiB total free. |
| Node VPS `65.108.122.87`, root, 06:21:49 | 105,089,261,568 / 32,758,812,672 / **66,944,962,560 B**, 33% used | Ample current space; unbounded container application logs need correction. |
| Node `/data`, 06:21:49 | 1,764,768,071,680 / 1,294,474,485,760 / **380,572,811,264 B**, 78% used | 273,198,628,864 B above the 100 GiB reserve; about 60.43 GB less available than Audit 19. |

UI: two CPUs, final one-second sample 100% idle, low load, approximately 3.40 GB memory available of 4.01 GB, no swap; 107,389 of 2,427,136 inodes used. Caddy active since September 12 with no restarts; no warning entries in the bounded recent Caddy read and no matching critical kernel phrases. **There is no production application database on the UI VPS.** Its main recurrence risk is release/rollback/scratch accumulation, not local database growth.

Node: 32 CPUs, initial one-second sample 84.70% idle and 0% I/O wait; later load 10.91/6.70/3.93 during audit work. Memory 115,962,839,040 B available of 134,125,752,320 B; swap 662,437,888 B used. RAID mirrors both reported `[UU]`; inode headroom was ample. Core, Electrs, PostgreSQL, WAL receiver, API, worker and the actual WireGuard API proxy/socket were active; serving units showed zero automatic restarts. All three mempool containers were healthy. Hardware wear/SMART was not certified because the tools were unavailable and were not installed.

UI storage-health remains below its **12 GiB warning**. The 06:02 trend receipt was critical: net growth about **802,493,454 B/day**, estimating **3.93 hours to the 10 GiB reserve** from its short observation window. This is not a time-to-full prediction. At the final sample, reserve plus the helper's 64 MiB safety margin leaves only about **61 MiB** additional room for work governed by that floor. Another release, rollback copy, or retained scratch burst can exhaust operational headroom even while `df` still looks moderate.

Node trend, 06:02:52: net **21,497,292,990 B/day**, approximately **12.71 days to its 100 GiB reserve** if that short-window rate continues. Backup scheduling produces bursts, so this is a warning estimate rather than a deadline. Existing failed storage/trend/release monitors were inspected and not reset. No independent external alert-delivery route was certified.

Physical network counters since boot were 1,310,584,608,592 B received and 10,570,863,251,163 B sent, with zero sampled errors/drops. These are not provider billing or transfer-quota measurements.

## Storage, redundant recovery copies and removal candidates

The user's desired policy is **one last verified rollback/backup per recovery purpose**, plus the live application. Installed policies still retain more and some only report candidates. A complete backup can require globals, base files and WAL; “one” does not mean deleting required members of that set. No removal is certified solely by age, a successful checksum, or a dry-run list.

### UI VPS

Measured allocations: backup area **20,409,577,472 B**, deployment scratch **2,320,420,864 B**, live `/var/www` **231,964,672 B**, `/tmp` 272,912,384 B, `/var/cache` 127,270,912 B (apt 115,499,008 B), and `/var/log` about 628 MB. These categories must not be added blindly where nested paths overlap.

The installed managed release helper is fixed to keep five and runs in dry-run mode. A read-only keep-one request was correctly refused by its allowlist; no bypass was attempted. The valid keep-five dry run verified ten managed archives, zero unverified, and protected seven rollback roots; three legacy archives were also inventoried. The scratch-prune run at 01:18:38 failed because the deployment lock was held. That lock contention does not establish a defective remover, but it allowed scratch to remain until another successful eligible run.

**Preserve the newest verified paired rollback, commit `68b16f6530494171561170ffac78ad26cdf17a5e`:**

- UI root `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-6c5e7b5a3d03-20260922T042824Z`, 415,117,312 allocated B.
- Matching UI archive `proofofwork-ui-release-68b16f653049-20260922T005601Z.tgz`, SHA-256 `1aad8a124769cc36af09ed6ac51e905801c327f4ef7e48d92481ab78f979ee81`, with its sidecars. The installed full rollback provenance check passed with the retained-root override.

Six older complete roots and their matching archives are **conditional retirement candidates**. Root names identify the replacing release; the contained release comes from the manifest.

| Root suffix under `/var/backups/proofofwork-ui/rollback-roots/` | Contained release | Root allocated B | Matching archive allocated B |
| --- | --- | ---: | ---: |
| `proofofwork-www-pre-0ef9c3bee321-20260920T053656Z` | `132b87faaac7-20260919T174900Z` | 231,395,328 | 185,614,336 |
| `proofofwork-www-pre-55a173a3672c-20260921T010203Z` | `56694a7d6d76-20260920T180539Z` | 412,168,192 | 185,274,368 |
| `proofofwork-www-pre-56694a7d6d76-20260920T180539Z` | `0ef9c3bee321-20260920T053656Z` | 412,045,312 | 185,249,792 |
| `proofofwork-www-pre-68b16f653049-20260922T005601Z` | `c77fcf2598f9-20260921T221935Z` | 412,352,512 | 185,319,424 |
| `proofofwork-www-pre-c77fcf2598f9-20260921T221935Z` | `dd7bcc0295d1-20260921T020136Z` | 231,550,976 | 185,323,520 |
| `proofofwork-www-pre-dd7bcc0295d1-20260921T020136Z` | `55a173a3672c-20260921T010203Z` | 414,687,232 | 185,700,352 |

Totals: **2,114,199,552 B roots + 1,112,481,792 B archives = 3,226,681,344 B (about 3.005 GiB)**, excluding small sidecars. This is identified potential, not space reclaimed. Evidence `uiMap` includes exact archive paths, manifest hashes and identities.

Additional older bulk categories are `rollbacks` 6,440,357,888 B, `classified-rollback-roots` 3,780,632,576 B, `rollback-classifications` 2,717,839,360 B and `recovery-evidence` 1,570,279,424 B. They need classification into unique evidence versus superseded payload copies before a deletion scope can be finalized. Preserve concise historical receipts and financial/chain evidence even when obsolete payload copies can be retired.

The manifest-reference walk was bounded: it excluded `.git`, dependencies/assets and JSON files above 2 MiB. It is not an exhaustive deletion dependency certificate. Earlier on September 22, deployment failed because an archive still required by an older retained root had been relocated; it was restored before this audit. Retirement must remove an obsolete root and its now-unneeded payload as a consistent set, update relevant retention references, and retain the compatible latest UI/API rollback. A historical audit reference alone is not proof that an entire old runtime copy must remain forever.

### Node VPS

Core allocation about 977.20 GB, Electrs 64.00 GB, PostgreSQL large-state tablespace 31.78 GB, PostgreSQL backups **120,444,502,016 B**, general backups 14.64 GB, live API cache 168.72 MB, `/tmp` 4.01 GB, deployment scratch 409.96 MB, host `/var/log` 1.06 GB and `/var/cache` 129.33 MB. Some categories overlap. Neither Core data nor canonical transition evidence is disposable cache.

**Preserve the matching latest API rollback:** `/opt/proofofwork-api-stage-a1e1f9b1c18d-20260922T041933Z` contains `68b16f6530494171561170ffac78ad26cdf17a5e`. Its hash-pinned full checkout attestation passed: 6,649 dependency entries / 196,345,104 B; runtime SHA-256 `819bf7d002f6157fa9ea1d6841181ff03d053d05557f3c649c5384b2a34b2ad0`. Preserve `proofofwork-node-release-68b16f6-20260922T005601Z.tgz` and sidecars. This content attestation is not a fresh service rollback rehearsal.

| Candidate group | Measured potential | Remaining condition before approved removal |
| --- | ---: | --- |
| Existing keep-three managed archive dry run | **44 archive sets / 132 files / 3,484,725,248 allocated B**; 47 verified, zero unverified | Revalidate exact manifest under lock; preserve live and last compatible rollback. Moving to requested one-rollback policy also requires changing the installed policy. |
| 38 `/opt` checkouts other than live and last rollback | **8,392,380,416 allocated B**, of 40 total checkouts / 8,880,185,344 B | Finish process, active deployment and recovery-dependency checks; no blanket safe-deletion claim. |
| Two older logical dump sets, September 20/21 | **32,765,054,976 allocated B** | First restore-prove the newest complete replacement, including globals/roles; preserve recovery dependencies. |
| Historical `operator-review-opt-checkouts-20260820T184500Z.tar.zst` | **5,783,625,728 allocated B** | Establish whether its unique evidence can be retained compactly and the bulk payload is superseded. |

Do not total these groups as a guaranteed recovery estimate. Full exact node archive paths and hashes are embedded in `node.candidates`; full inventories and dry-run transcripts are also embedded. No old audit cleanup command was replayed.

Logical dump sets under `/data/proofofwork-postgres-backups/logical` are dated September 20, 21 and 22. Their dump sizes are 16,213,820,318; 16,551,193,583; and **16,924,101,954 B**. The September 22 dump and globals passed fresh checksums; its TOC was readable with 202 entries. **The newest dump was not restored by this audit.** Physical sets dated September 19 and 21 contain approximately 18.81 and 19.50 GB of inventoried logical member bytes. `/var/backups/postgresql` is a bind mount of the `/data` physical-backup tree, not a second independent copy.

Installed logical keep-seven behavior is **review/preserve-only** and can continue beyond seven; weekly physical backups keep three. Four more logical dumps at today's size add **67,696,407,816 B** before growth. The latest physical backup's completion/manifest was inspected, but no fresh full archive/restore proof was produced. Keep the last restore-proven set until replacement proof succeeds; never remove WAL on age alone. Existing same-host restoration evidence does not establish off-host disaster recovery.

## Database and index health

Primary PostgreSQL 16.15 is on the node. Database size **32,350,075,927 B**, versus 31,117,245,463 B in Audit 19: growth **1,232,830,464 B** over roughly forty hours. `work_amo_block_transitions` accounts for **30,962,810,880 B (about 95.7%)**, with 8,488 rows; snapshots about 814,620,672 B. The large-state tablespace occupies 31,777,435,648 B on `/data`; default tablespace about 595,748,436 B on root.

Catalog checks found zero invalid indexes, zero unvalidated constraints and zero reported deadlocks; autovacuum was active/healthy in the sampled statistics. A reader was idle in a transaction for about 42 seconds at one sample; no blocking incident was established. Cumulative temporary bytes of about 1.661 TB are lifetime activity, not present temporary-file allocation. **Data checksums remain off and no `amcheck` extension is installed**, so these logical checks do not certify every physical page. No repair, vacuum-full, reindex, schema migration or checksum-setting change was attempted.

Auxiliary MariaDB 10.5.21 in `mempool-db-1` was healthy/no OOM. All 24 tables were InnoDB: estimated 285,343 rows, **144,015,360 B data plus indexes**, directory allocation **413,581,312 B** on `/data`. Sampled transactions, pending I/O and row-lock waits were zero; cumulative deadlocks/log waits/table-lock waits/slow queries were zero. Checksum mode `full_crc32`, recovery mode zero. A full buffer pool is normal caching and was not classified as pressure. No physical table scan or restore was performed; row estimates and checksum configuration are not row-by-row integrity certification.

**Independent publication limit risk continues H7-01/H10-07/A11-03.** At canonical snapshot `434e71791a394128c514b428`, block 968109:

- Actual compact `JSON.stringify`: **19,991,898 / 20,971,520 B (95.33%)**, only **979,622 B** remaining. Audit 19 was 19,596,556 B.
- SQL JSONB text: **21,000,515 / 23,592,960 B**, 2,592,445 B remaining. Do not compare this encoding against the compact limit.
- WORK, token and marketplace summaries contribute about 6.310, 6.254 and 6.833 MB respectively. Publication can fail before either disk fills.
- Runtime ceilings remain inconsistent with older 16/18 MiB runbook wording, as already documented. Recommend bounded projection/pagination and measured headroom rather than silently raising ceilings or deleting canonical evidence.

## Full node, ingestion, chain binding and pending visibility

Core 31.1 was mainnet, unpruned, out of IBD, verification progress 1, no warnings, initially 124 peers. Transaction, coinstats and basic-filter indexes were synchronized. **`verifychain 3 6` passed**, which covers its requested recent depth, not an independent complete replay. Electrs 0.11.0 and mempool HTTP tip matched Core at block 968109 during the node sample.

Final public `https://computer.proofofwork.me/health`, 06:31:38: **HTTP 200, ready/available true**, Core-authoritative checkpoint/index/Electrs block **968111**, hash `00000000000000000001efb5a96f417076d83f710f9f0f950a98ef5d18d05cba`, zero lag, all canonical summary coverage keys 968111. Snapshot `9c02b08540f8ccf25877dd68` was eligible. Earlier exact-tip 503s while the next block was indexing were retained as availability observations, not erased by this later success.

| Population / check | Fresh result |
| --- | --- |
| Structural database population | **26,479 events; 25,873 transactions; 506 IDs.** Zero duplicate event keys/transactions/IDs/tickets/participants/references, orphan participant/reference rows, missing raw transaction objects, invalid confirmed parent bindings, volatile children of confirmed transactions, missing confirmed event times or negative balances. |
| Stored event status partition | **26,304 confirmed + 170 pending + 5 dropped = 26,479**. Transaction counts are a separate scope. |
| Stored block coverage | **20,108 blocks, 948000–968107**, no height/link gaps and no Core hash mismatch; Core tip was stable across this check. |
| All stored confirmed transactions | **25,625** raw hex/txid/block/positive-confirmation comparisons matched Core, zero RPC failures. All **77,282 outputs**, **30,705 inputs**, 2,901 additional input parents, and transaction positions in 2,222 blocks matched, including values/scripts/sequence/cardinality. Core advanced 968107→968108 during this separate pass. |
| Miner fee conservation | All **25,625** confirmed transactions had complete input values and `sum(inputs) − sum(outputs) = stored fee`; zero mismatches. |
| Carrier and attachment storage | **25,747** confirmed OP_RETURN carriers matched raw push bytes/text/size; all **six** attachment records passed content hash/size checks. |
| Semantic address/reference projection | Deployed canonical comparators in a repeatable-read, read-only session: **126,072 participants** and **56,381 references**, zero extra/missing, all 26,479 events checked. |
| Mail projection | **616 expected / 616 observed**, zero duplicate, missing, extra or mismatched projections; zero invalid Mail event rows/volatile overlays. |
| Pending/dropped transaction fence | All **172 DB pending transactions** were present in both identical Core mempool sets of **82,286**; all **76 DB dropped transactions** were absent in both. This does not certify discovery of every application event in the entire mempool. |

The mempool sample used 221,717,536 B of a 2 GB budget, loaded/full-RBF, 100,000-byte data-carrier allowance. Changes during the audit explain differing instantaneous mempool counts. Pending observations are not canonical balances. Four auxiliary raw-evidence repairs from H9-03 were covered by the complete Core byte comparison; old scan-marker qualifications were not “fixed” by inventing metadata.

Protected ID audit **passed**: 586 fetched registry transactions, 563 confirmed and 23 pending; **536 lifecycle events matched exact Core-ordered replay**, 506 confirmed winners, 21 pending candidates, six active ID listings, four canonical sales. The 1,000-proof registration / 546-proof management fee split and canonical registry remained intact. Seventeen historical refund candidates and two watch items reappeared unchanged; these are **not new payment instructions**. Reconcile against `ID_REFUNDS.md` before any future financial action; preserve already-paid refunds and fixed WORK refund snapshots.

## Protocol and application math

No mathematical discrepancy was found in the checked accepted-event populations. Core verifies chain carriers, values and order; application-specific issuance/value rules additionally require deterministic protocol replay. Passing these checks does not make Core alone a validator of every application rule.

| Arithmetic domain | Result and boundary |
| --- | --- |
| V8 frozen listing terms | All **972** rows passed active version/asset, 25,000-proof face, integer amount, exact floor/ceiling, bond increment and decimal alias checks; zero nonpositive/fractional/over-cap values. With `S=21,000,000`, `A=10^16`, `Q=10^8`, face `F=25,000`, and pre-listing network value `N` in Q8, checked `amount=floor(F×S×A×Q/N)` and minimum price `ceil(amount×N/(S×A×Q))`. |
| Canonical transitions | **8,488 rows, blocks 959621–968108**: no height/hash/value continuity gaps; required flags true. The sole state-hash boundary at 960601 is the preserved Q16 cutover. This is scalar continuity, not rehashing/reexecuting every large transition preimage. |
| Credit conservation | All **238 confirmed definitions**, **21,875 accepted mints**, **409 holder rows / 15 held assets**: issued supply equals summed balances, no cap excess, negative/fractional/nonfinite balances or pending balance delta. |
| WORK | **210,000,000,000,000,000,000,000 subatoms = 21,000,000 WORK**, 21,000 mints, 361 holders; no remaining mint supply. |
| POWB | **630,496,569 units**, 467 mints, 11 holders; network value and floor shown separately from supply. |
| INCB | All **46** valid confirmed mints: issuance flooring, direct+attached composition, Q8/decimal aliases, dust and H−1 oracle height passed. Supply **224,847,713,398,447,926**, seven holders. Exact issuance value Q8 **22484771339844794793582060**, direct 27,386 proofs, attached Q8 **22484771339842056193582060**, dust Q8 **2193582060**. |
| INCB raw chain witnesses | **356 checks** across 46 mints and 29 H−1 headers: zero mismatch. Three previously approved missing historical snapshot exceptions retain their pinned commitments; no fabricated restoration. |
| Captured cross-layer summary | **134 independent integer/decimal checks** passed at 968109/snapshot `434e71791a394128c514b428`, including network/credit/fixed-flow/carry decomposition and exact aliases. Live value **8,409,504,697,930,711,637.80428513 proofs**; live floor **400,452,604,663.36722084 proofs/WORK**; frozen floor **49,522,699,168.87330563**. Separate fresh token-statistics/complete transition-preimage comparison was not performed by this check. |
| Deterministic independent vectors | **262,170 assertions / 16,384 seeded inputs**, seed `0x9e3779b9`, passed actual frontend/server Q8/Q16 conversion, roundtrips, floor/ceiling identities, unit/supply boundaries and network-rational movement values. Finite vectors are not a proof over all inputs. |

**19 of 21 local gates passed.** Passing coverage includes Q16, bond arithmetic, marketplace V2, AMO V5/V6/historical V7/V8, canonical order, INCB witness/restore, Audit 19 accounting, 529 index-recovery behaviors, ID contract, live-data, UI, Boost, send preparation, worker containment and read projections. Separate actual behavior suites passed **30 Boost**, **8 send preparation**, **5 read-projection** and **4 canonical transfer-fee** tests. V7 remains historical/fail-closed coverage, not activation authority.

Two local verification regressions continue the existing test-maintenance family H9-07/H10-06/A11-07/H18-11:

1. `check:work-precision` aborts because its isolated VM omits `tokenRequiresCanonicalWorkCapacity`, added through the H19-04 wallet fix. Its former full gate is not certified; actual H19 capacity/admission fixtures passed separately. Correct the harness dependencies and current authority-qualified fixtures, not the repaired wallet rule.
2. `check:api-truth` expects an obsolete Boost source expression. Current source separates exact base and owner signal before summing; eight of nine subpredicates and all 30 behavioral Boost tests pass. Replace the stale structural expectation with current behavior checks. No incorrect production ranking math was established by this failure.

The existing Audit 17/19 Boost writer-input issue still reproduces: fractional price 1.9→1, payment 0.9→0, output index 1.9→1 in isolated actual helper functions. Original inputs should be rejected unless safe integers before normalization. No paid transaction was prepared. Current H19-01/H19-04 exact aggregate/canonical capacity fixtures and captured summary evidence passed; their specific production closures are preserved without claiming a new complete replay of every earlier release acceptance test.

## Application/API/log health and rendering

| Live gate | Outcome |
| --- | --- |
| Protected ID registry audit | **Passed** exact Core-ordered lifecycle parity: 563 confirmed / 23 pending registry transactions, 536 lifecycle events, 506 winners, six listings and four sales. This bounded successful run supplies fresh evidence beyond Audit 19's incomplete ID gate; its 17 historical refund candidates create no new payout instruction. |
| Computer event audit | **49/49 passed**, zero failures/warnings. |
| Mail regressions | **Passed** eight address/Mail fixtures plus two Log/Event self-send cases. |
| Ledger consistency | **Passed**, snapshot `363fa010d5db303748a49aa9`, exact value `8409504697930711637.80428513`; retained transient 503s and whole-batch retry after checkpoint changed. |
| Broad indexer parity | **Incomplete/failed:** `HISTORY_CURSOR_CONFLICT` HTTP 409, “event-history snapshot is unavailable; restart from page one.” No overall pass count is claimed. Its address/reference/Mail comparator was then isolated and passed as detailed above. |
| Marketplace regression | **Failed existing H9-01:** invalid pre-unit relic `4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1` still leaks into exact WORK closed-listing history. Preserve the invalid historical event; correct the read projection. No balance corruption follows from this result. Later gate stages were not reached. |
| Public HTTP surface runner | 11/13 configured surfaces passed; Browser/AMO probes had transient canonical catch-up 503s. HTML/assets were available. This runner is separate from the fourteen-surface browser observation. |

Some requests were slow: ID lookup 5.6 seconds, fresh WORK token 44.2 seconds, exact closed-listing history 38.1 seconds. Audit load overlapped. Continue the existing exact-tip availability/queue/latency family, retaining truthful unavailable and last-verified states. Do not convert unavailable fresh data into successful zero balances or empty books.

Read-only browser observations covered **Home, ID, Desktop, Browser, Boost, AMO, Credit, Wallet, WORK, Infinity, Inception, Growth, Log and Computer**, 06:18:42–06:26:52. Exact routes/values/times are in evidence `browser-summary.md`.

- Home and refreshed ID/Computer showed **506 confirmed + 21 pending = 527 visible IDs**. Cold registry views still showed false zero/no-records while verifying before refresh completed: existing **H5-02 remains**. Computer IDs retained registration/management separation from Marketplace and the correct 1,000/546-proof fees.
- Browser rendered the welcome transaction as verified confirmed HTML, 1,018 bytes, 546 proofs, SHA-256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`. Log search returned exactly one confirmed action and zero pending for that same transaction; the specific prior search fix remains effective.
- AMO truthfully displayed Last Verified block 968109 while the current tip was 968110. Complete market-book previews were explicitly incomplete. Credit displayed 236 ordinary credits; 238 definitions includes the distinct bond categories, so those counts are not a discrepancy.
- WORK, POWB and INCB main displays matched exact checked values. WORK was minted out. Its visible split preview satisfied 40×2,000 + 1,441 = 81,441 proofs, without preparing a transaction. Approximate chart labels remain distinct from exact ledger values.
- Boost showed six posts and total signal `2,803,168,675,871.43567562` proofs, direct 2,730 and attached 7.0000011 WORK. Historical reboost action signal 546 was separate from the embedded original's 1,092; recent content/signal rendering fixes remained visible in these samples.
- Growth separated forecasts from actual values. Log completed at 968111 with 25,987 total, 25,964 confirmed and 22 pending: the one supplemental ledger record is outside the canonical/public count partition. Preserve **H6-15 count-scope labeling qualification** rather than diagnosing arithmetic corruption from mixed scopes.
- Desktop `carbonz` lookup did not complete within the bounded observation window; some Credit subsections and full market books were still loading. Those flows are **not certified complete**. Wallet remained disconnected. Connected-account local state, signatures, mobile geometry and every historical record's rendered row were not exercised.

Screenshots and accessibility snapshots were inspected in CUA tool receipts. The in-app browser's export command was unsupported; no persisted screenshot/DOM file is claimed. The written observations are embedded in the evidence. Temporary audit tabs were closed.

Node 48-hour log scans found zero matches for OOM, I/O-error, corruption, ENOSPC/disk-full, deadlock-detected or PANIC phrases. These are bounded pattern checks, not a proof that every possible error is absent. Current API/worker invocation logs still included 63 raw-RPC queue-full messages, three incomplete-order messages, one wallet-unavailable and one lifecycle timeout, plus disappeared pending transactions. Existing availability issues remain; monitor/one-shot failures are not serving-service crashes. PostgreSQL syntax/column mistakes caused by initial audit probes were identified as harness errors. Final corrected queries succeeded.

## New findings

### H20-01 — node mempool frontend logs lack observed executing rotation

**Source:** `mempool-web-1` regular files `/var/log/nginx/access_mempool.log` and `error_mempool.log`, on the container writable layer on **node root**. They total **3,800,495,351 logical B**: access 3,702,995,788 B, error 97,499,563 B. Access logging was active; no rotated members were found. A daily/rotate-52 logrotate rule exists, but no executing cron process, expected daily runner/root crontab or covering host rule was observed. Docker uses `json-file` with empty options on all three containers; its separate JSON logs are currently only about 12 MB.

**Impact:** application logs bypass the host `/var/log` storage category and can grow without a demonstrated bound. Current node root headroom is ample, so this is not an imminent-full claim. No matching prior finding was found in the audit review.

**Recommended correction, approval required:** install/verify bounded executing rotation, or send nginx logs to stdout/stderr with bounded Docker options; include container writable-layer usage in capacity monitoring. Preserve required incident evidence before truncation/removal. No log was deleted.

### H20-02 — stale marketplace prose contradicts current ticket and freshness rules

**Source:** `MARKETPLACE.md` lines 1346–1364 and 1427–1438 at audited source. The June 27 section and unqualified Spent Ticket Closure section describe a `seal5` spend of the original ticket as still buyable and avoiding 503 on slow fresh summary. Current strict rules require the original ticket to remain unspent and exact fresh truth to fail closed when unavailable.

**Impact:** future agents could implement or restore obsolete behavior. No current runtime deviation is inferred from the prose alone. This is separate from the already reported summary-size runbook mismatch.

**Recommended correction, approval required:** retain the dated history with explicit superseded status and reconcile the unqualified current section against the canonical rules. No protocol/source/documentation change was made during this audit beyond the approved audit artifacts and their classification.

## Previously reported issues rechecked

Original finding identities are retained. The full historical mapping, including unresolved conditions not exercised here, is embedded in `historyReview`.

| Existing family | Current disposition |
| --- | --- |
| H5-01/H13-01 and UI capacity/retention continuations | **Open, tightened headroom.** September 20 cleanup remains historically valid; subsequent releases refilled storage. New candidate map and latest rollback verification above. |
| H8-05/H10-02 and node backup/database capacity continuations | **Open.** Backup allocation nearly doubled since Audit 19; transition growth remains dominant. No destructive compaction authorized. |
| H7-01/H10-07/A11-03 summary budget | **Open, worsened:** compact payload now 95.33%. |
| H5-03/H10-03/A11-06 release provenance/retention | Live and last rollback attestations **pass**; current archives verified. Excess archive/checkouts and dry-run retention remain open. Do not reopen repaired executable-bit/provenance defects without evidence. |
| H5-06/H10-05/H12-05/H12-06/A11-01/A11-02/H18 availability family | **Intermittent/unresolved.** Final exact-tip health passed; transient 503s, slow reads, queue pressure and broad cursor failure remain recorded. |
| H19-02 transaction-detail unavailable→404 | **Still reproducible offline with current actual functions.** All providers timing out maps to HTTP 404/internal dropped. Correct typed dependency-unavailable handling; no live fault induced. |
| H19-03 stale transaction confirmation cache | **Still reproducible offline.** Warm cached confirmed object returns old block hash with zero RPC calls after mocked chain state becomes pending; cold fixture consults Core and returns pending. Require canonical revalidation/invalidation; no live reorg induced. |
| H9-01 invalid pre-unit marketplace projection | **Still failing live exact closed-listing gate.** Preserve historical invalid record and correct active/closed/log scopes. |
| H9-03 auxiliary raw evidence | Complete current Core-byte pass **supports the prior repair**; retain scan-marker qualifications. |
| H9-04/H9-05/H6-02 semantic relations/Mail; repaired event timestamps | **Remain repaired in the complete current checked populations:** zero relation/projection/timestamp discrepancies. |
| H19-01 exact aggregates / H19-04 canonical wallet transfer capacity | Specific closures preserved; current exact summary/local actual-function fixtures **pass**. No new separately pinned full transition-preimage/capacity acceptance replay claimed. |
| H10-01/A11-04/H12-01 WAL receiver repair | Active receiver and current health verified; retain original lost-slot evidence and restore limitations. No renewed 247 GiB-gap claim. |
| INCB alias/issuance repairs | All 46 accepted mints and raw/H−1 witnesses **pass**, preserving documented historical exceptions. |
| H6-01 / existing Boost writer boundary | Recent sampled rendering and 30 behavior checks pass; fractional input coercion persists, complete signing/settlement lifecycle not certified. |
| H5-02, H6-15 rendering/search/scope | Cold registry false-empty remains. Specific welcome-tx search passes; broader free-text/status acceptance and mixed count-scope concerns are not closed. |
| H6-03 and other H6 conditional races/mobile issues | **Not closed by this audit.** Future 1,000-Mail pagination, reversed responses, account races, dropped local overlays, same-checkpoint cache and narrow geometry require focused acceptance tests. Desktop/full-book observations remained incomplete. |
| H9-07/H10-06/A11-07/H18-11 local gate maintenance | Two new harness failures within the existing family; 19/21 local gates passed. |
| Physical integrity/off-host recovery/alerts/provider quota | Still incompletely certified. No speculative all-clear from logical checks or current health. |

Financial continuity was preserved: historical ID refunds, WORK V1 eligibility snapshot, V2 review-only-not-paid record, treasury and bounty ledgers were reviewed and not rewritten. Recurring historical refund candidates must not trigger duplicate payouts.

## Actions taken, approval boundary and follow-up

Actions taken: read-only host/service/log/storage inventories; archive and rollback verification/dry runs; database catalogs and exact stored-population comparisons; Core byte/value/order and mempool checks; local deterministic math/behavior tests; protected live application gates; browser observations; predecessor hash review; creation of this audit and evidence; repository note classification and mandatory hygiene review. No production mutation, cleanup or financial action occurred.

Follow-up order:

1. **Restore UI operating headroom first.** Approve a bounded cleanup and installed retention change that preserves live plus the verified compatible `68b16f6` rollback pair, retires obsolete roots/archives as consistent sets, and checks dependencies under lock. Recheck marked scratch eligibility and deployment peak-space needs. The 3.005 GiB mapped older UI set is the clearest initial candidate; broader bulk evidence needs classification.
2. **Prove the newest database recovery set, then retire redundant generations.** Approve an isolated restore/roles check and minimal complete backup/WAL retention policy. Revalidate node archive and `/opt` candidates. Preserve concise restore evidence while removing only proven superseded payloads. Prevent daily refill rather than relying on repeated emergency cleanup.
3. **Reduce summary publication growth and investigate canonical-read cost.** Keep exact integers, complete coverage and fail-closed semantics. Measure publication headroom and stable cursor lifetimes; rerun the broad parity gate after its snapshot-lifetime failure is addressed.
4. **Correct existing status/projection defects and test harnesses.** H19-02/H19-03, H9-01, the known fractional writer boundary and two stale local gates need approved source/test changes with bounded regression fixtures. Do not alter canonical ledgers to make a read-model test pass.
5. **Address H20-01/H20-02 and remaining acceptance gaps.** Add executing bounded log retention, reconcile obsolete documentation, then test conditional account/reorg/UI races and off-host restore/alert delivery separately.

Approval is required before production deletions, backup/retention configuration, source/protocol changes, historical evidence edits, restores or deployment. The user approved this audit log only; the repository's `AGENTS.md` requires explaining and receiving approval for those additional scopes. The candidate inventories are reviewable proposals, not executable deletion authorization.

### Repository handoff

`SOUL.md`, canonical protocol/product documents, tracked notes/generated artifacts and the cleanup allowlist were reviewed. No new protocol or operating-memory rule was introduced. Known documentation contradictions are recorded above for a separately approved correction; dated history and financial evidence were retained. The two audit artifacts are classified as protected ledger/audit evidence.

`npm run hygiene:fix` found no allowlisted rebuildable state to remove; `npm run hygiene:check` passed, including its generated-artifact checks. Audit JSON parsed, evidence SHA-256 matched this document, whitespace checks passed, and credential-pattern review found no literal credentials, authenticated URLs or private-key blocks. Independent math and node reviewers found no required result corrections; the protected-ID pass was added explicitly to the gate table. Final scope is these two new audit files plus their entries in `repository-hygiene.json`. The pre-existing untracked publisher and ignored `node_modules/` remain untouched. No files were staged and no commit was created.

---

## Ordered read-only application audit — September 22, 2026 continuation

**Scope:** the user's subsequent instruction narrowed this work to a read-only audit, in the exact order Home → ID → Desktop → Browser → Boost → AMO → Credit → Wallet → WORK → Infinity → Inception → Log → Growth → **Computer last**. All fourteen were reviewed in that order. The user approved only appending the completed results. Surface observations were **06:41:49–07:02:07 UTC** (02:41:49–03:02:07 America/Toronto), supported by Core, database, source and both-VPS checks. A later checkpoint after the user resumed is explicitly separated below.

**Disposition: no new arithmetic or canonical-value discrepancy in the checked populations; no application-wide all-clear.** Computer's two readiness samples returned **503 from Electrum address-canary timeouts**, despite a synchronized Core/indexer/database and a successful ledger consistency response. Two newly established presentation defects are **H20-03**, duplicate Desktop self-send files/count, and **H20-04**, missing Log chain-status labels on a confirmed Boost event. Existing capacity, cache/status, invalid-marketplace projection, pagination and latency issues retain their existing identities.

No code, configuration, production database/data, protocol record, ledger, backup, log or infrastructure was modified. No restart, cleanup, deletion, signing, broadcast, deployment, staging, commit or push occurred. Public GETs cause ordinary application logging/cache work; no direct cache/log mutation command was issued. Disconnected account placeholders were not treated as actual account balances or mailboxes.

### History gate, preservation and evidence limits

Before new live surface requests, the complete original Audit 20 and preceding issue history were reviewed. All **45 predecessor artifacts** rehashed unchanged, none missing; the **30 preceding Markdown audits** and financial/incident history remained the baseline. Required operating documents were reviewed in order. Specific successful fixes and unresolved acceptance conditions were carried forward, without turning a warm-page success into closure of a cold-load, race or reorg defect.

Original Audit 20 Markdown **40,825 bytes** is preserved as an exact prefix, SHA-256 **`244aeb07f41e560ea1ddbeec19c012569861406adf911b665189c37e0b8a6b94`**. Its existing **1,181,755-byte** companion evidence remains unchanged, SHA-256 **`6bcd0548bae7767a221e3f48cf61ef0b8510eec7f0e0a87b3d956752c5c18e1c`**. Local source remains `a18cae48fdf486eca8168a28fdd114c33c3f7dfb`; pre-existing `repository-hygiene.json` changes and untracked `deploy/audit17/publish-node-work-floor.py` were preserved.

**Interruption qualification:** the user resumed at approximately **22:41 UTC**. The follow-up's working `/tmp/pow-audit20-*` receipts and reviewed draft were then absent; the cause was not established. No cleanup command had been issued by this audit. The original durable audit/evidence were unaffected. This append preserves the tool-returned findings, exact values, hashes, source anchors and review conclusions captured in the conversation. It does **not** claim that the full transient raw responses/scripts or the planned 106,879-byte continuation bundle are attached or recoverable. Compact receipts below are reconstructed from recorded tool results and labeled accordingly. Future verification should repeat the bounded checks at a new pinned Core checkpoint; hashes alone do not replace unavailable raw evidence. This is a limitation of this continuation's evidentiary completeness, not a demonstrated production data loss.

### Ordered surface results

All fourteen root HTTPS requests returned **200** with TLS validation enabled; Home redirected to canonical `www.proofofwork.me`. One temporary browser tab was used sequentially and closed after Computer. Root-document timing is not complete interactive load timing.

| Order / surface | Completed review and comparison | Limits / finding |
| --- | --- | --- |
| 1. Home | 506 confirmed / 21 pending / 527 visible IDs; pending-is-visibility wording and repaired testimonial ellipsis retained. Root 0.193 s. | Warm success does not close historical cold false-zero behavior. |
| 2. ID | Registration-only, 1,000-proof fee; `carbonz` gives one confirmed registration `945088ac…0c39f6`, owner/receiver `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW`, matching API and Core-backed lifecycle. Root 0.135 s. | Management remains in Computer. No registration submitted. |
| 3. Desktop | `carbonz` public lookup completed; two identical `POWCarbonz.jpg` cards, same tx/hash, different From/To inspector context. Core has one 10,774-byte attachment. Root 0.108 s. | H20-03. Earlier incomplete lookup improved in this sample only. Welcome documentation drift extends H20-02. |
| 4. Browser | Canonical Welcome `8c2fd17b…3015b`: Confirmed, 1,018-byte HTML memo, 546 proofs, exact SHA matching Core. Empty sandbox, `no-referrer`, no external iframe src; content CSP blocks scripts/forms/network. Root 0.094 s. | No signing or adversarial reorg/provider test; H19-02/H19-03 remain. |
| 5. Boost | Six displayed records; 2,730 direct proofs + 7.0000011 WORK; displayed combined value 2,803,168,675,871.43567562 proofs. Carbonz: one authored, zero purchased, one follower/following. Historical action payments separate from embedded original. Root 0.123 s. | No paid action. Purchased-tab refresh initiated but completion not certified. Economic-authority/fractional-input issues remain. |
| 6. AMO | Ready canonical summary: 238 definitions, 894 credit listings, 84 credit sales / 9,603,286 proofs. IDs: six listings, three sealed/three unsealed; four sales / 22,000 proofs. Exact WORK values and frozen 25,000-proof face reconcile. Core Hodl ticket unspent. Root 0.115 s. | Full book remained an explicitly incomplete preview; checkpoint-change hydration deferral recorded at 06:46:06. Partial Bonds count not certified zero. |
| 7. Credit | DRAIN: 110,000 supply / 110 mints, holders 75,000 + 35,000, cap 21,000,000, remaining 20,890,000, zero pending; DB agrees. Creation 236×546=128,856; split 40×2,000+1,441=81,441. Root 0.149 s. | No mint/creation prepared. Original DRAIN creation output not separately refetched in this supplement. |
| 8. Wallet | Disconnected shell asks for UniSat; transfer/list disabled; 546-proof mutation and 546-proof ticket. Exact public-address API/DB/client capacity checked independently below. Root 0.111 s. | Connected UTXO selection, signing, live prepare and account-switch behavior not UI-certified. |
| 9. WORK | 21,000,000 confirmed cap/supply, 21,000 mints, 361 holders, zero pending; minted out. Carbonz holder search returns **30,907.9999997752908902 WORK**, exact API/DB match. Root 0.152 s. | Fresh compact response 6,409,852 B / 7.130 s. Floating chart/fiat aliases are display only. |
| 10. Infinity | 630,496,569 POWB supply; value 630,501,483 proofs; floor 1.00000779; zero pending. Core confirms displayed 2,000,000 POWB / 2,000,000-proof terms and unspent 546-proof original ticket. Root 0.135 s. | One-ticket preview remained incomplete; 06:50:45 checkpoint-change hydration deferral. No purchase. |
| 11. Inception | Fixed supply 224,847,713,398,447,926; value 224,847,713,398,447,947.9358206; floor 1. Direct 27,386 + attached issuance 224,847,713,398,420,540 = supply. All 46 issuance records checked. Historical H−1 snapshot retained. Root 0.337 s. | Empty preview not certified complete. Large values wrapped at inspected desktop width; no mobile certification. Lifetime attached flow is not circulating supply. |
| 12. Log | Global 25,987 total / 25,964 confirmed / 22 pending, through 968113. API and Core correctly confirm the Boost like, while UI omits its status badge. Root 0.121 s. | H20-04. Exact pending-tx search timed out and displayed **Unavailable**, not zero/not-found. Total has existing supplemental scope; the Boost row is not identified as that supplemental item. |
| 13. Growth | Exact chain value matches WORK; 506 confirmed IDs/21 pending, 25,964 confirmed actions. AMO flow 10,934,594 = 9,625,286 sales + 1,309,308 fees; 88 sales = 84 credit + four ID. Forecast assumptions separated from actuals. Root 0.368 s. | Expanded Boost: 11 recognized confirmed transactions, 7.0000011 WORK already counted, 2,184 shared Mail/Files proofs; economic authority unavailable and separate contribution not activated explicitly disclosed. |
| 14. Computer, last | IDs/AMO isolation; 1,000/546 fee split and carbonz record agree. Explicit workspace Refresh yields Ready AMO, six ID listings / 236 ordinary credits / one bond ticket and identical exact values. Wallet gated disconnected; integrated Browser renders identical verified Welcome bytes/hash. Root 0.075 s. | Initial Inbox/account zero states not canonical account evidence. Root 200 and ledger consistency pass do not override dependency readiness failures. |

The bounded console read captured the two AMO/Infinity checkpoint-hydration errors above. They belong to their original URLs/times, not later Growth/Computer navigations. No additional captured error does not establish that every browser path is error-free.

### Full-node, data and mathematical verification

At **06:58:02 UTC**, Core tip, highest canonical DB block, complete transition and summary agreed at **968114**, hash **`00000000000000000000e7072a46d930a159a8171fb4508d0919e28539bb21af`**, summary **`4add60dbd0c77bd710178a63`**, generated 06:54:41.498. Earlier 968112/968113 checkpoints were independently canonical. These dated reads are not one atomic cross-system snapshot.

- **On-chain authority, 19 checks passed:** V8 declaration `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a`, block **960600:2369**, protocol vout 3; 5,593 bytes, SHA `1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528`. Authority vin0 and 546-proof registry vout4 agree; runtime V8 pins match, activation 960601/writes enabled. V7 pins empty/writes disabled.
- **Bond declaration:** `ae7baca8bddc950af2d19e515e4df551cbb33e2ad61aa072f862700135164284`, **963758:1050**, vout2; 3,586 bytes, SHA `71f0fa5a89947ff1a23c213501dc45451e6f0a4d59f5ec233915893315071bac`; authority input matches; text specifies next-block activation 963759. No BOND_HARD_PRICE runtime pins in the inspected allowlist. Exact bytes/authority are verified; earliest historical discovery/configured admission activation are not established by this alone. No activation performed or new defect inferred solely from absent pins.
- **Stored populations:** 972 V8 frozen terms pass exact face, amount-floor, minimum-ceiling, bond-transition, cap/integer and alias checks; 46 INCB issuance records pass floor/composition/alias/dust/H−1 checks. All 409 balance rows across 15 assets nonnegative/integer/finite; 238 definitions/21,875 confirmed mints conserve supply without cap excess. 8,492 transitions, **959621–968112**, have no height/hash/value gap or false completeness flag; only expected commitment-format boundary at 960601. Not a fresh complete replay of every transition preimage.
- **Exact cross-layer summary calculations:** 231 checks at 968112, 24 further public WORK/Infinity/Inception checks at 968113, 219 Growth checks at 968114 passed. Overlapping checks are not unique protocol obligations. Network Q8 **840950469793071163780428513**, exact value **8409504697930711637.80428513 proofs**, live floor **400452604663.36722084**, frozen floor **49522699168.87330563**.
- **Wallet capacity:** carbonz address at 968112: confirmed **309079999997752908902** subatoms, ten listing reservations totaling **7441612470**, transferable **309079999990311296432**. In WORK: **30907.9999997752908902 − 0.0000007441612470 = 30907.9999990311296432**. API, DB and canonical transition validator agree; economic/token preimages rehashed, token commitment **`7d8fc8fbea6d4e2913988ea0c1b6230bd00beddaca00d83ab5cb55b2873da69c`**, 2,130,078 bytes. Actual transitive App balance/capacity/display functions match. Missing capacity receipt, wrong hash, one-subatom change and duplicate reservation each rejected. This freshly supports H19-04's specific closure, not every wallet path.
- **Core settlement/content samples:** 69 original plus 33 additional scoped assertions passed. Carbonz registration pays 1,000; ID buy consumes authorized ticket, pays seller 10,546=10,000+546 plus 546 registry. WORK sample freezes 749030366 subatoms/25,000-proof face; seller 25,546, registry 546, miner 2,588 agree. Hodl and POWB seals leave original anchors unspent. Welcome memo and Desktop attachment bytes/hash match. Extra POWB check binds signature bytes/immutable terms/spends; it did not independently rerun cryptographic signature verification or purchase.
- **Pending status:** all **172 pending DB transaction IDs** present in both Core mempool samples (82,796 then 82,798 total); zero absent from both and zero changed membership during the read. Indexed event groups: 21 ID registrations, 148 invalid-token events, one token mint. Transactions/events/product counters are different populations; membership is temporary and does not promise confirmation.

**Rounding/unit rules:** INCB floors per issuance event, retaining aggregate dust **21.9358206 proofs**; floor-of-total is not a replacement. AMO display premium exactly equals `0.0000000749030366 × 400452604663.36722084 − 25000 = 4995.116103665525621818802744`; this is valuation display, not a new settlement precision. Frozen face remains 25,000. Approximate numeric/fiat/chart aliases must not become financial action inputs. Existing Boost fractional writer coercion remains unresolved under its earlier finding.

Original Audit 20's full stored transaction/carrier/attachment checks, structural duplication/orphan checks, participant/reference/Mail comparisons, ID lifecycle and deterministic boundary tests remain the broader evidence above; they were not needlessly repeated within the hour. This continuation does not certify genesis-to-tip discovery, every historical UI rendering, every future parameter, all signatures, or a new full restore/reorg replay.

### Availability and performance

Computer consistency **06:59:08 UTC:** HTTP200, `ok=true`, all returned checks pass, no missing log events, zero tip lag, checkpoint968114; **12.220 s / 19,222 B**.

Computer readiness **06:58:47** and **07:01:59 UTC:** HTTP503, **9.903 / 10.019 s**. Both explicitly time out `blockchain.scripthash.get_balance` around9.75s and skip bounded Electrum tip proof. Core is unpruned, not in initial sync, headers/blocks/txindex968114; canonical DB/index/summary and worker pass, zero consecutive worker failures/no containment. A reported Electrs tip equal to Core is not proof its address service is responsive. Wrapper `timedOut=false` does not negate the explicit dependency timeout.

Other fresh API GETs: carbonz detail **2.122 s /31,118 B**; WORK compact **7.130 s /6,409,852 B**; Infinity **6.802 s /217,518 B**; Inception **8.067 s /50,274 B**; Log summary **6.448 s /110,331 B**; Growth **7.915 s /181,809 B**. These single body-read samples from the UI host under concurrent activity are not controlled latency percentiles.

Log exact pending tx **`8c7763b10c804bca60631ec3a20967ccd0fc369ad063ba6567c54b814e414688`** search reached the approximately60-second client deadline and showed **Log unavailable / Unavailable counts**. Source uses `/api/v1/log-history?limit=50&page=0&q=…&network=livenet`; this is distinct from free-text `pending` ID resolution, provider false404 and the repaired confirmed-row-loss case. Record under existing **H5-06/H10-05/H12-06/H18** latency/unavailability lineage.

AMO and POWB book hydration rejected changed checkpoints and kept incomplete preview labels. This preserves coherent data but leaves incomplete market visibility. Recommended improvement: stable snapshot pagination and bounded restart/resume while retaining explicit incompleteness and fail-closed canonical checks.

At **07:01:06–07:01:09**, node CPU85.956% idle/0% I/O wait, RAM115,055,697,920 B available; UI98.5% idle/1% I/O wait, RAM3,326,935,040 B available. Services active, unchanged PIDs, zero automatic restarts. Core/Electrs tip968114. Local Electrs metrics responded16ms, RocksDB background-error counters zero; this is not address-RPC recovery. Capped5,000 selected journal lines included434 queue-full and413 timeout keyword matches, overlapping/incomplete incident counts, and repeated address-history connection resets. Available host resources do not exclude queue/transport contention; exact cause and recovery unproven. Cumulative completed-RPC histograms do not measure the failed client request.

### Capacity, database growth and storage review

At **06:42:30**, UI free **10,868,645,888 B**, only125.15MiB above10GiB reserve; backup allocation **20,409,577,472 B**, scratch **2,320,420,864 B**, live tree **231,964,672 B** unchanged. At **07:01:09**, UI free **10,868,166,656 B**, margin **130,748,416 B /124.691MiB above reserve**, or **63,639,552 B /60.691MiB** after helper's extra64MiB allowance. Total free remains about10.12GiB; 124.691MiB is the operational reserve margin. **No production application database is on the UI VPS.** Release/rollback/scratch growth remains its immediate refill risk.

Node root/data available at06:42:30 **66,934,714,368 /380,499,431,424 B**; at07:01 sample **66,928,996,352 /380,447,965,184 B**. Backup allocation **120,496,820,224 B**; no new dump generation attributed from the delta. Original Audit20 DB-size receipt **32,350,075,927 B**, dominated by transition storage **30,962,810,880 B**, is the last full database-size measurement, not newly measured at968114. No compaction/physical-page/restore test in this continuation.

Publication headroom remains open: prior **compact**19,991,898/20,971,520B=95.33%; current health's **full**21,000,519B is a different representation and does not prove compact publication exceeded its limit.

**Conditional storage candidates:** 132 node archive file identities/allocations/mtimes and small provenance digests rechecked unchanged, **3,484,725,248 B**,40 `/opt` checkouts still present. Seven UI rollback manifests/root allocations/archive metadata/sidecar text unchanged; six older paired sets total **3,226,681,344 B** excluding sidecars. Exact paths remain in original durable evidence. Keep live plus previously verified compatible **68b16f6 UI/API rollback pair**.

No deletion certificate is issued. Full archive payloads were not rehashed again; no deployment lock/dependency traversal or fresh restore. Before separately approved cleanup, revalidate exact paths, running/recovery dependencies and complete replacement under lock. Keep last restore-proven database set until replacement proven; preserve globals/base/WAL members, incident/audit/tx-backed records. Cache/scratch eligibility also requires ruling out live-use/protected-evidence dependencies. No item removed; no old audit cleanup command replayed.

**H20-01 persists:** node mempool nginx access log increased **1,161,079 B to3,704,156,867 B**; error log97,499,563B. Existing unbounded app-log growth, not a new issue. Bounded Caddy/journald policies were inspected; executed rotation/alert delivery not re-certified.

### Security and operational resilience

Both hosts retain DROP INPUT/FORWARD defaults; actual DB/RPC/Electrs/API data listeners are loopback/private bridge/WireGuard as documented, no new unintended exposure observed. Core/Electrs/API/worker use non-root, zero effective capabilities and no-new-privileges; PostgreSQL processes non-root/capability-free despite broader distribution unit defaults. No external scan, exploit, dependency-CVE certification or exhaustive secret-leak test was conducted.

Actual root responses retain one-year/includeSubDomains HSTS, self-script CSP, frame denial, nosniff, restrictive permissions/referrer policy. Browser iframe sandbox/referrer/source inspected. UI SSH PasswordAuthentication=yes remains the prior latent hardening observation: enumerated login-capable passwords locked and root password login prohibited; node password auth disabled. No available password login demonstrated. Nineteen stored public cert date windows valid; earliest requested-surface stored expiry AMOOctober25. Root probes validated serving TLS, not renewal/recovery. External alert delivery, off-host restore and provider traffic quotas remain unverified.

### New findings and extended prior findings

**H20-03 — Medium: Desktop duplicate artifact presentation/count.** Carbonz shows two public `POWCarbonz.jpg` files for tx **`8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7`**, SHA **`c3a50b3d0ccb92f989754c7b8ca0019f43c642048047cd8b04f60c1f048b3ab6`**. Core: one10,774-byte artifact at967038:3782. `src/App.tsx:13672` concatenates confirmed Inbox/Sent; `fileSurfaceMessages:13530` preserves both; `mailKey:3149` includes folder. Desktop renders both; inspector switches From/To. Isolated actual-function execution yields two rows/one tx-hash pair. **Derived-view duplication, not duplicated database history or funds.** Distinct from H6-06 target race and H6-16 Log key collision.

Recommended approved correction: deduplicate only Files/Desktop by network+transaction+canonical protocol/attachment identity; retain direction metadata and separate Inbox/Sent self-send semantics. Do not deduplicate separate publications by content hash or collapse distinct artifacts solely by txid. Test one self-send artifact→one tile, separate publications→separate proofs, mailbox directions unchanged.

**H20-04 — Medium: Log status labels omitted for a Boost event with existing content tags.** Visible Boost like **`40bfe8ebf1b3e95a0a7cee2a4f7de437d29aab1a167bfb0524d1756238e19171`** has tags `Boost`,`like`, no Confirmed/Mainnet badge. API event4248257 is confirmed:true/status:confirmed, position968073:1797; independent Core check shows42confirmations at968114, absent mempool. UI omits correct available chain truth.

Source: `scripts/backfill-proof-indexer.mjs:4752` assigns content tags only; `server/db/proof-index-reader.mjs:21667` returns any nonempty existing tags before adding status/network; `src/App.tsx:36766` renders tags without independent status badge. This narrow cause was not established in previous findings; it does not reopen H6-15 repaired row loss. **This confirmed Boost row is not identified as the separate+1 supplemental-count item.** Correct by deriving status/network display from normalized status fields, preserving semantic tags; test confirmed/pending/unknown/invalid cases without mapping unavailable to pending. Historical records need not be rewritten.

**H20-02 extension — Low: stale Desktop Welcome contract.** `MAIL_ORGANIZATION.md:46,176` requires a pinned Welcome file for every searched address. Current source only composes address mail. Commit`ee381055813c57d91126f806a4c0b6d8a3d6cbe8` removed fabricated confirmed hardcoded Welcome objects; `scripts/check-ui-contract.mjs:1882` forbids substitution. Browser verifies real Welcome bytes, but carbonz Desktop did not automatically include them. Resolve docs or build a separately labeled chain-fetched/verified system reference with truthful availability. **Do not restore invented confirmed bytes or attribute a system file to the searched address.** Extend documentation drift, not missing-chain-data finding.

### Prior issues: disposition without duplicate findings

| Existing lineage | Recheck outcome |
| --- | --- |
| H19-01 exact aggregates / H19-04 wallet capacity | Specific fixes remain resolved for the exact summary/transition/API/client tests above. |
| H5-06/H10-05/H12-06/H18 read latency/readiness | Open: two canary503s, slow summaries/consistency and exact pending Log timeout; root200 does not close. |
| H8-05/H10-02 and capacity continuations | Open: near-reserve UI, redundant retention and node DB/backup growth; no cleanup. |
| H7-01/H10-07/A11-03 summary budget | Open; compact/full measurements distinguished. |
| H20-01 / H20-02 | Existing log grew; stale Welcome contract added to existing docs finding. |
| H19-02 false404/dropped on unavailable providers; H19-03 stale warm confirmed cache | Unchanged source and original actual-function fixtures retain unresolved status. Successful Browser sample is not a fault/reorg test. |
| H9-01 invalid pre-unit relic; pagination failures | Existing failed projection gate remains failed; complete-book hydration still not certified. |
| H5-02 cold empty; H6 account/network/reorg/race/completeness cases | Warm/disconnected successes do not close conditional cases; no exhaustive mobile, account switching or induced reorg. |
| H6-15 repaired confirmed-row loss / broader Log | Specific earlier repair preserved; new pending query unavailable, not false empty. Supplemental count scope unchanged; H20-04 narrowly status rendering. |
| H6-01 Boost authority / known writer fractions | No full signing/settlement certification; reject fractional inputs before normalization remains recommended. |
| H9-04/H9-05/H6-02 semantic relationships and WAL receiver repair | Earlier fresh Audit20 checked-population/service evidence retained; no targeted regression found, no duplicate full replay. |
| Local/live failed or unreached gates | Original19/21 local gates, broad cursor conflict and marketplace failure remain; no harness repairs or unreached-stage pass claimed. |

### Recommended work requiring separate approval

1. **Headroom/retention:** bounded UI release/scratch cleanup preserving live and verified compatible rollback; prove replacement DB recovery before retiring redundant generations; implement executing nginx log bounds and capacity/publication alerts with tested delivery. Prevent recurring retained-data growth.
2. **Read performance:** correlate API Electrum request/queue/cancellation/reset timing with address/history workloads; reduce repeated large hydration; stable snapshot pagination and bounded retries. Preserve exact canonical truth and unavailable semantics. Re-test readiness, exact-tx Log search and complete AMO books.
3. **Correctness:** address H19-02/H19-03, H9-01, H20-03/H20-04 and known fractional writer boundaries with focused tests. Preserve fee split, Q8/Q16 integers, frozen settlement, historical evidence and account boundaries.
4. **Acceptance/security/recovery:** repair test harness separately, complete unreached and conditional wallet/account/network/mobile checks, verify off-host restore and alert delivery, reconcile obsolete documentation without deleting accountable history.

No improvement above was implemented. No recurring task or notification was created. Only this completed audit append is authorized in the repository for this continuation.

### Late checkpoint after resumption — 22:42:56–22:44:35 UTC

This bounded check updates current readiness/capacity, not the earlier complete surface/math audit. Only Computer health was requested publicly; no other surface was revisited. Core remained **968197**, hash **`0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777`**, before/after both fences; unpruned, no initial download/warnings, all three indexes synchronized. Electrs agreed. All inspected services active with unchanged PIDs/zero automatic restarts; all three mempool containers healthy. Brief CPU idle node92.4953%/UI86%; available RAM115,801,178,112/3,383,590,912B; no sampled global exhaustion.

At **22:43:00**, Computer returned **503 in1.904s**: address canary/DB/Core/Electrum all passed, while canonical index/summary were one block behind at968196 and worker running. Core directly confirmed the database checkpoint hash. Core header time is not measured arrival time. At **22:44:35.836**, a single subsequent health read returned **200 in1.852s**, available/ready/ok:true; Core/index/Electrs/eligible summary/all eight coverage keys agreed at**968197, zero lag**. Worker idle/proofReady:true, no failures, last success22:44:20.134. Summary **`726cbbdd5f7882678080c880`**, generated22:43:17.428. Pending-event health checked24 candidates, zero unresolved/deferred/errors. This observes catch-up and recovered canary responsiveness, not sustained availability or closure of the morning timeout/queue findings. All503s remain part of the audit.

UI free at22:42:57 **10,825,637,888 B**: only **88,219,648 B /84.1328125MiB above the10GiB reserve**, **21,110,784 B /20.1328125MiB after the64MiB allowance**; 42,528,768B less free than07:01. It was not resampled after this time. Node root/data free initially66,678,034,432/378,320,891,904B; final health node-only disk fields66,678,042,624/378,306,822,144B. No producer attribution or deletion-dependency recertification.

Fresh PostgreSQL size **32,761,158,679 B**, +406,446,080B versus the original06:18 catalog receipt. Read-only transaction confirmed; zero invalid indexes/unvalidated constraints/cumulative deadlocks. Checksums remain off, as previously qualified; these catalog checks do not certify physical pages or restore. Core mempool at the first late sample:81,682transactions,40,852,768B,230,056,560B memory of2,000,000,000B limit. No new all-pending membership or full math replay at968197 is claimed. Full health payload21,047,686B is still not a compact-response measurement.

The complete late raw receipts and collection sources are embedded below, separately from reconstructed morning observations. This restores durable evidence for the late check without pretending to recover the missing early raw files.

### Audit-file verification and handoff

The new display causes were reproduced again offline on the unchanged actual source after resumption: two Desktop rows/one tx-hash pair; `safeEventTags` returns only `Boost`,`like` for both confirmed and pending fixtures when those tags already exist. The synthetic fixture is not a fresh live-content/chain read. The exact extracted functions and result are embedded below. An independent reviewer checked the reconstructed prose/math/source against recorded tool observations and found no required factual corrections; the late checkpoint is separately evidenced.

`npm run hygiene:check` passed. `hygiene:fix` was deliberately not invoked because the user's explicit read-only/no-cleanup instruction supersedes the standing cleanup step. Canonical docs, operating memory, note classification, protected evidence and allowlist were reviewed; proposed documentation corrections remain unimplemented. No hook bypass, commit or new note classification. Original Markdown prefix and companion evidence hashes were verified; existing classification/helper files unchanged. Final status/diff and embedded JSON/hash checks are recorded by the completion verification. No production bytes deleted.

### Durable compact receipts

The first JSON block is reconstructed from the conversation's dated tool results, plus newly re-executed source-only fixtures. It is not a recovered raw HTTP/DB export. The second block preserves the complete late checkpoint bundle. Hash each block's exact UTF-8 content including its trailing newline. Original Audit20 evidence remains the full durable baseline; unavailable temporary source/response bodies are not hidden behind dead file links.

Reconstructed compact receipt SHA-256: **`122a93e792af08ac0de4b948d705cdc7a49ea15b11071f63c78dd73cd8c73f95`**.

```json
{
  "model": "audit20-ordered-reconstructed-tool-observations-v1",
  "provenance": "Morning values reconstructed from recorded tool returns after temporary files absent at22:41UTC; not original raw export. Late data separately embedded.",
  "windowUtc": [
    "2026-09-22T06:41:49Z",
    "2026-09-22T07:02:07Z"
  ],
  "orderedHosts": [
    "proofofwork.me",
    "id.proofofwork.me",
    "desktop.proofofwork.me",
    "browser.proofofwork.me",
    "boost.proofofwork.me",
    "amo.proofofwork.me",
    "credit.proofofwork.me",
    "wallet.proofofwork.me",
    "work.proofofwork.me",
    "infinity.proofofwork.me",
    "inception.proofofwork.me",
    "log.proofofwork.me",
    "growth.proofofwork.me",
    "computer.proofofwork.me"
  ],
  "allRootHttpStatus": 200,
  "rootSeconds": [
    0.193,
    0.135,
    0.108,
    0.094,
    0.123,
    0.115,
    0.149,
    0.111,
    0.152,
    0.135,
    0.337,
    0.121,
    0.368,
    0.075
  ],
  "sourceHead": "a18cae48fdf486eca8168a28fdd114c33c3f7dfb",
  "sourceHashes": {
    "src/App.tsx": "ca6eaeecf03fcd829efdd19f9eee3037edaaab7a0b9cf9ef5200bda285964c10",
    "server/db/proof-index-reader.mjs": "fee7a7ac857f0395f465efc36102c6547f920e1620a266f869ba251c967e94c2",
    "scripts/backfill-proof-indexer.mjs": "e4dbb0f3d42e93c9839d49fd2b8237e1902a739873b1f02265262ba18aced398",
    "MAIL_ORGANIZATION.md": "64add151ba173988f8ddf41933c05b85dbcb173c7dfcbc7195ddee6c857de7a9"
  },
  "snapshot": {
    "at": "2026-09-22T06:58:02Z",
    "height": 968114,
    "hash": "00000000000000000000e7072a46d930a159a8171fb4508d0919e28539bb21af",
    "id": "4add60dbd0c77bd710178a63"
  },
  "math": {
    "declarationChecksPassed": 19,
    "targetedCoreChecksPassed": [
      69,
      33
    ],
    "exactSummaryChecksPassed": [
      231,
      24,
      219
    ],
    "v8FrozenTerms": 972,
    "incbIssuanceRows": 46,
    "integerBalanceRows": 409,
    "definitions": 238,
    "mintEvents": 21875,
    "transitions": 8492,
    "transitionRange": [
      959621,
      968112
    ],
    "expectedCommitmentBoundary": 960601,
    "networkValueQ8": "840950469793071163780428513",
    "networkValueProofs": "8409504697930711637.80428513",
    "liveFloor": "400452604663.36722084",
    "frozenFloor": "49522699168.87330563",
    "incbEventDustProofs": "21.9358206",
    "noNewMismatchInStatedChecks": true,
    "notExhaustiveFutureOrHistoricalReplay": true
  },
  "wallet": {
    "address": "18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW",
    "height": 968112,
    "confirmedSubatoms": "309079999997752908902",
    "reservedSubatoms": "7441612470",
    "reservationCount": 10,
    "transferableSubatoms": "309079999990311296432",
    "tokenCommitment": "7d8fc8fbea6d4e2913988ea0c1b6230bd00beddaca00d83ab5cb55b2873da69c",
    "preimageBytes": 2130078,
    "rejectedFixtures": [
      "missing receipt",
      "wrong hash",
      "one subatom altered",
      "duplicate reservation"
    ]
  },
  "pending": {
    "dbTransactions": 172,
    "inBothCoreSamples": 172,
    "missingBoth": 0,
    "changedMembership": 0,
    "coreMempoolCounts": [
      82796,
      82798
    ],
    "eventGroups": {
      "idRegistration": 21,
      "invalidToken": 148,
      "tokenMint": 1
    }
  },
  "newLogFinding": {
    "txid": "40bfe8ebf1b3e95a0a7cee2a4f7de437d29aab1a167bfb0524d1756238e19171",
    "eventId": 4248257,
    "confirmed": true,
    "status": "confirmed",
    "blockHeight": 968073,
    "blockIndex": 1797,
    "blockHash": "00000000000000000000df97cea56fd6f441e4a63027878ded2cee5c4f66f294",
    "confirmationsAt968114": 42,
    "inCoreMempool": false,
    "apiTags": [
      "Boost",
      "like"
    ],
    "notIdentifiedAsSupplementalCountItem": true
  },
  "browser": {
    "txid": "8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b",
    "canonicalPosition": [
      949253,
      5230
    ],
    "memoBytes": 1018,
    "sha256": "f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad",
    "paymentProofs": 546,
    "iframeSandbox": "",
    "referrerPolicy": "no-referrer",
    "externalSrc": null
  },
  "readinessMorning": [
    {
      "at": "2026-09-22T06:58:47.241163Z",
      "http": 503,
      "seconds": 9.903057970106602,
      "bodySha256": "5f43915123fe3edbd65a57efb5525093953295adf3a6f04f81962811672ca024",
      "cause": "Electrum get_balance9750ms timeout; skipped tip proof",
      "canonicalHeight": 968114,
      "lag": 0
    },
    {
      "at": "2026-09-22T07:01:59.325344Z",
      "http": 503,
      "seconds": 10.019401539117098,
      "bodySha256": "a4563374cd9fdd233915bfde80b2c33a2b2babf0ffd670054c6f97d466fe4754",
      "cause": "Electrum get_balance9749ms timeout; skipped tip proof",
      "canonicalHeight": 968114,
      "lag": 0
    }
  ],
  "freshSummaryHttp": [
    {
      "name": "WORK compact",
      "seconds": 7.129587,
      "bytes": 6409852,
      "height": 968113
    },
    {
      "name": "Infinity",
      "seconds": 6.802431,
      "bytes": 217518,
      "height": 968113
    },
    {
      "name": "Inception",
      "seconds": 8.06670536659658,
      "bytes": 50274,
      "height": 968113,
      "bodySha256": "175ace32ff04c5a1ede61647753f38f23ff81d5c11a37205e7bd58e0fdcd5b1c"
    },
    {
      "name": "Log",
      "seconds": 6.4484669379889965,
      "bytes": 110331,
      "height": 968113,
      "bodySha256": "5d0abb32047640997dc1937364b0da957f3f54de9d8892025f6fefdab50bc8e4"
    },
    {
      "name": "Growth",
      "seconds": 7.915028497576714,
      "bytes": 181809,
      "height": 968114,
      "bodySha256": "4ef632a9759fd6e15305cdc34c51233cb32ff347d1eb9b9eb69b47d8b67f9cd8"
    },
    {
      "name": "Computer consistency",
      "seconds": 12.219967620447278,
      "bytes": 19222,
      "height": 968114,
      "ok": true,
      "bodySha256": "a0e595490a26ad26dfa7a1b7078497f353047818931782b8b50634a94c4fa036"
    }
  ],
  "sourceOnlyReproductionAfterResumption": {
    "at": "2026-09-22T22:44:42.830Z",
    "scope": "Offline actual-source functions, synthetic mailbox pair with previously observed identity; no chain/network calls. Reproduces view logic, not new live content verification.",
    "desktop": {
      "sourceSha256": "ca6eaeecf03fcd829efdd19f9eee3037edaaab7a0b9cf9ef5200bda285964c10",
      "functions": "function mailKey(message: MailMessage) {\n  return `${message.folder}-${message.network}-${message.txid}`;\n}\n\nfunction hasAttachment(\n  message: MailMessage,\n): message is MailMessage & { attachment: MailAttachment } {\n  return Boolean(message.attachment);\n}\n\nfunction normalizeBroadcastStatus(status: unknown): BroadcastStatus {\n  if (status === \"confirmed\" || status === \"pending\" || status === \"dropped\") {\n    return status;\n  }\n\n  return \"unknown\";\n}\n\nfunction sentDeliveryStatus(message: Pick<SentMessage, \"status\">) {\n  return normalizeBroadcastStatus(message.status);\n}\n\nfunction fileSurfaceMessages(messages: MailMessage[]): FileSurfaceMessage[] {\n  return messages\n    .filter(\n      (message) =>\n        Boolean(message.attachment) || isBrowserHtmlMessageBody(message.memo),\n    )\n    .map((message): FileSurfaceMessage =>\n      message.attachment\n        ? { ...message, attachment: message.attachment }\n        : {\n            ...message,\n            attachment: browserMessageBodyAttachment(\n              message.memo,\n              message.subject,\n            ),\n          },\n    );\n}\n\nfunction publicDesktopMail(\n  inboxMessages: InboxMessage[],\n  sentMessages: SentMessage[],\n): MailMessage[] {\n  return [\n    ...inboxMessages\n      .filter((message) => message.confirmed)\n      .map((message): MailMessage => ({ ...message, folder: \"inbox\" })),\n    ...sentMessages\n      .filter((message) => sentDeliveryStatus(message) === \"confirmed\")\n      .map((message): MailMessage => ({ ...message, folder: \"sent\" })),\n  ];\n}",
      "fixture": {
        "txid": "8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7",
        "network": "livenet",
        "confirmed": true,
        "status": "confirmed",
        "attachment": {
          "name": "POWCarbonz.jpg",
          "sha256": "c3a50b3d0ccb92f989754c7b8ca0019f43c642048047cd8b04f60c1f048b3ab6",
          "size": 10774
        }
      },
      "rows": [
        {
          "key": "inbox-livenet-8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7",
          "txid": "8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7",
          "folder": "inbox",
          "hash": "c3a50b3d0ccb92f989754c7b8ca0019f43c642048047cd8b04f60c1f048b3ab6"
        },
        {
          "key": "sent-livenet-8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7",
          "txid": "8ae8a348b6fec39e465b4d215d9b1c24ab286db7ff15db6077f3703db7685ca7",
          "folder": "sent",
          "hash": "c3a50b3d0ccb92f989754c7b8ca0019f43c642048047cd8b04f60c1f048b3ab6"
        }
      ],
      "projectedRows": 2,
      "distinctTransactionHashPairs": 1
    },
    "logTags": {
      "sourceSha256": "fee7a7ac857f0395f465efc36102c6547f920e1620a266f869ba251c967e94c2",
      "functions": "function normalizedText(value) {\n  return String(value ?? \"\").trim();\n}\n\nfunction safeEventTags(item, network, confirmed) {\n  const tags = (Array.isArray(item?.tags) ? item.tags : [])\n    .map((tag) => normalizedText(tag))\n    .filter(Boolean);\n  if (tags.length > 0) {\n    return tags;\n  }\n\n  return [\n    confirmed ? \"Confirmed\" : \"Pending\",\n    network === \"livenet\" ? \"Mainnet\" : network,\n    normalizedText(item?.kind),\n  ].filter(Boolean);\n}",
      "result": {
        "confirmed": [
          "Boost",
          "like"
        ],
        "pending": [
          "Boost",
          "like"
        ]
      }
    }
  }
}
```

Complete late checkpoint bundle SHA-256: **`9be8be79a196749ef08ef2f74cecba08cc4e684ba08f08d158415f37efd49062`**.

```json
{
  "model": "audit20-late-read-only-checkpoint-v1",
  "generatedAt": "2026-09-22T22:44:50.616206+00:00",
  "sources": {
    "node.json": {
      "sha256": "23510e417ee25ba09be000d44c9418ca2fea5a28c57a4b48c3b0e6ac4f6c2062",
      "bytes": 11969,
      "content": {
        "startedAt": "2026-09-22T22:42:56.516065+00:00",
        "role": "node",
        "scope": "Bounded late checkpoint only; read-only; no production mutation or full re-audit",
        "uptime": {
          "returncode": 0,
          "stdout": "22:42:56 up 136 days,  9:13,  3 users,  load average: 1.34, 1.18, 1.20",
          "stderr": ""
        },
        "memory": {
          "returncode": 0,
          "stdout": "total        used        free      shared  buff/cache   available\nMem:     134125752320 18324574208 22555746304   294436864 94823706624 115801178112\nSwap:    17179865088   659292160 16520572928",
          "stderr": ""
        },
        "disk": {
          "returncode": 0,
          "stdout": "Filesystem               1B-blocks          Used    Available Use% Mounted on\n/dev/mapper/vg0-root  105089261568   33025740800  66678034432  34% /\n/dev/mapper/vg0-data 1764768071680 1296726405120 378320891904  78% /data",
          "stderr": ""
        },
        "cpuOneSecond": {
          "cpus": 32,
          "idlePercent": 92.4953095684803,
          "ioWaitPercent": 0.0
        },
        "pressure": {
          "cpu": "some avg10=0.00 avg60=0.00 avg300=0.00 total=24617185533\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0",
          "memory": "some avg10=0.00 avg60=0.00 avg300=0.00 total=416224728\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=413652976",
          "io": "some avg10=0.00 avg60=0.00 avg300=0.00 total=1186310950\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=1152543764"
        },
        "services": {
          "returncode": 0,
          "stdout": "MainPID=1324302\nResult=success\nNRestarts=0\nId=bitcoind.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Sat 2026-09-12 06:24:39 UTC\n\nMainPID=1324320\nResult=success\nNRestarts=0\nId=electrs.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Sat 2026-09-12 06:24:39 UTC\n\nMainPID=3642238\nResult=success\nNRestarts=0\nId=proofofwork-api.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Tue 2026-09-22 05:43:54 UTC\n\nMainPID=3642249\nResult=success\nNRestarts=0\nId=proofofwork-indexer-worker.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Tue 2026-09-22 05:43:54 UTC\n\nMainPID=1324240\nResult=success\nNRestarts=0\nId=postgresql@16-main.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Sat 2026-09-12 06:24:39 UTC\n\nMainPID=1649219\nResult=success\nNRestarts=0\nId=pg_receivewal@16-main.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Sat 2026-09-19 04:55:31 UTC\n\nMainPID=3642371\nResult=success\nNRestarts=0\nId=proofofwork-api-wg.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Tue 2026-09-22 05:44:04 UTC",
          "stderr": ""
        },
        "coreBefore": {
          "returncode": 0,
          "value": {
            "chain": "main",
            "blocks": 968197,
            "headers": 968197,
            "bestblockhash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
            "bits": "17021ec5",
            "target": "000000000000000000021ec50000000000000000000000000000000000000000",
            "difficulty": 132757073449487.5,
            "time": 1790116969,
            "mediantime": 1790113261,
            "verificationprogress": 1,
            "initialblockdownload": false,
            "chainwork": "00000000000000000000000000000000000000014997d610cd9cc6bd27778cc4",
            "size_on_disk": 878162074496,
            "pruned": false,
            "warnings": []
          }
        },
        "coreIndexes": {
          "returncode": 0,
          "value": {
            "txindex": {
              "synced": true,
              "best_block_height": 968197
            },
            "coinstatsindex": {
              "synced": true,
              "best_block_height": 968197
            },
            "basic block filter index": {
              "synced": true,
              "best_block_height": 968197
            }
          }
        },
        "mempool": {
          "returncode": 0,
          "value": {
            "loaded": true,
            "size": 81682,
            "bytes": 40852768,
            "usage": 230056560,
            "total_fee": 0.06541795,
            "maxmempool": 2000000000,
            "mempoolminfee": 1e-06,
            "minrelaytxfee": 1e-06,
            "incrementalrelayfee": 1e-06,
            "unbroadcastcount": 0,
            "fullrbf": true,
            "permitbaremultisig": true,
            "maxdatacarriersize": 100000,
            "limitclustercount": 64,
            "limitclustersize": 101000,
            "optimal": true
          }
        },
        "database": {
          "returncode": 0,
          "stdout": "BEGIN\nSET\nSET\n{\"kind\" : \"database\", \"at\" : \"2026-09-22T22:42:57.570584+00:00\", \"transactionReadOnly\" : \"on\", \"databaseBytes\" : 32761158679, \"checksums\" : \"off\", \"invalidIndexes\" : 0, \"unvalidatedConstraints\" : 0, \"deadlocks\" : 0}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"canonical:incb-range-replay-witness:livenet:fd0ac622022fa23ba8e18e7f9715805eb05740d698e2fb4fd8e4fa5bbaec9cae\", \"updatedAt\" : \"2026-07-19T15:30:14.14648+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"canonical:rebuild\", \"updatedAt\" : \"2026-09-22T22:27:56.89414+00:00\", \"indexedThroughBlock\" : 968196, \"indexedThroughBlockHash\" : \"0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598\", \"complete\" : true, \"status\" : \"complete\", \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : false, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"mempoolScan:livenet\", \"updatedAt\" : \"2026-09-22T22:42:49.538501+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"rushCanonicalBootstrap:livenet\", \"updatedAt\" : \"2026-07-13T22:33:51.017098+00:00\", \"indexedThroughBlock\" : 957911, \"indexedThroughBlockHash\" : \"000000000000000000009c217fa26f6f9fe24a0942e5630e84aed73b682fff6d\", \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"rushCanonicalDiscovery:livenet\", \"updatedAt\" : \"2026-07-13T22:33:51.007799+00:00\", \"indexedThroughBlock\" : 957911, \"indexedThroughBlockHash\" : \"000000000000000000009c217fa26f6f9fe24a0942e5630e84aed73b682fff6d\", \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"schema\", \"updatedAt\" : \"2026-08-01T05:05:16.192579+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"workAmoV5Migration:livenet\", \"updatedAt\" : \"2026-07-27T08:14:05.867651+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : \"complete\", \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"workAmoV6Migration:livenet\", \"updatedAt\" : \"2026-07-30T07:57:44.914148+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : \"complete\", \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"workAmoV8ActivationLatch:livenet\", \"updatedAt\" : \"2026-08-01T18:22:54.789+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"worker:lastRun\", \"updatedAt\" : \"2026-09-22T22:42:54.437148+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : \"2026-09-22T22:42:52.415Z\", \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"workPrecisionV2Migration:livenet\", \"updatedAt\" : \"2026-08-01T18:38:20.838229+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : \"complete\", \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"workQ16PendingAttempt:livenet\", \"updatedAt\" : \"2026-09-22T22:39:53.539+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : \"published\", \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"workQ16PendingRebuild:livenet\", \"updatedAt\" : \"2026-09-22T22:39:53.539+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"canonicalMeta\", \"key\" : \"workQ16PendingStage:livenet\", \"updatedAt\" : \"2026-09-22T22:39:53.539+00:00\", \"indexedThroughBlock\" : null, \"indexedThroughBlockHash\" : null, \"complete\" : null, \"status\" : null, \"phase\" : null, \"lastSuccessAt\" : null, \"consecutiveFailures\" : null, \"error\" : null, \"active\" : null, \"height\" : null, \"blockHash\" : null}\n{\"kind\" : \"latestSummary\", \"snapshotId\" : \"bb25cda5a36a5370c36932de\", \"height\" : 968196, \"generatedAt\" : \"2026-09-22T22:28:15.725+00:00\"}\nROLLBACK",
          "stderr": ""
        },
        "electrsMetrics": {
          "elapsedSeconds": 0.014076858758926392,
          "sha256": "f775325bf0d289f9d3f1a7983e8cd59d975c673d4b7fd2fee79444ed26154f87",
          "selected": [
            "electrs_index_db_properties{name=\"rocksdb.background-errors:config\"} 0",
            "electrs_index_db_properties{name=\"rocksdb.background-errors:funding\"} 0",
            "electrs_index_db_properties{name=\"rocksdb.background-errors:headers\"} 0",
            "electrs_index_db_properties{name=\"rocksdb.background-errors:spending\"} 0",
            "electrs_index_db_properties{name=\"rocksdb.background-errors:txid\"} 0",
            "electrs_index_height{type=\"tip\"} 968197"
          ]
        },
        "coreAfter": {
          "returncode": 0,
          "value": {
            "chain": "main",
            "blocks": 968197,
            "headers": 968197,
            "bestblockhash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
            "bits": "17021ec5",
            "target": "000000000000000000021ec50000000000000000000000000000000000000000",
            "difficulty": 132757073449487.5,
            "time": 1790116969,
            "mediantime": 1790113261,
            "verificationprogress": 1,
            "initialblockdownload": false,
            "chainwork": "00000000000000000000000000000000000000014997d610cd9cc6bd27778cc4",
            "size_on_disk": 878162074496,
            "pruned": false,
            "warnings": []
          }
        },
        "containers": {
          "returncode": 0,
          "stdout": "mempool-api-1\tUp 12 days (healthy)\nmempool-web-1\tUp 4 months (healthy)\nmempool-db-1\tUp 4 months (healthy)",
          "stderr": ""
        },
        "completedAt": "2026-09-22T22:42:58.926123+00:00"
      }
    },
    "ui.json": {
      "sha256": "496d72b05b40582523bbbb060a5070901991cb2f316703feb1d06bc2d60a1df7",
      "bytes": 8112,
      "content": {
        "startedAt": "2026-09-22T22:42:57.191436+00:00",
        "role": "ui",
        "scope": "Bounded late checkpoint only; read-only; no production mutation or full re-audit",
        "uptime": {
          "returncode": 0,
          "stdout": "22:42:57 up 138 days,  1:42,  1 user,  load average: 0.21, 0.06, 0.01",
          "stderr": ""
        },
        "memory": {
          "returncode": 0,
          "stdout": "total        used        free      shared  buff/cache   available\nMem:      4005457920   621867008   255275008     5017600  3442388992  3383590912\nSwap:              0           0           0",
          "stderr": ""
        },
        "disk": {
          "returncode": 0,
          "stdout": "Filesystem       1B-blocks        Used   Available Use% Mounted on\n/dev/sda1      39973924864 27464093696 10825637888  72% /",
          "stderr": ""
        },
        "cpuOneSecond": {
          "cpus": 2,
          "idlePercent": 86.0,
          "ioWaitPercent": 0.5
        },
        "pressure": {
          "cpu": "some avg10=0.54 avg60=0.18 avg300=0.08 total=22906661499\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0",
          "memory": "some avg10=0.00 avg60=0.00 avg300=0.00 total=58404368\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=55248689",
          "io": "some avg10=0.00 avg60=0.00 avg300=0.00 total=3277539128\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=3019662764"
        },
        "services": {
          "returncode": 0,
          "stdout": "MainPID=3092586\nResult=success\nNRestarts=0\nId=caddy.service\nActiveState=active\nSubState=running\nActiveEnterTimestamp=Sat 2026-09-12 06:45:33 UTC",
          "stderr": ""
        },
        "computerHealth": {
          "url": "https://computer.proofofwork.me/health",
          "startedAt": "2026-09-22T22:42:58.224131+00:00",
          "status": 503,
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
                  "availableBytes": 378320867328,
                  "maxUsedPercent": 90,
                  "minFreeBytes": 5368709120,
                  "ok": true,
                  "path": "/data/proofofwork-api-cache",
                  "probePath": "/data/proofofwork-api-cache",
                  "totalBytes": 1764768071680,
                  "usedPercent": 78.56257298627058
                },
                "ok": true,
                "root": {
                  "availableBytes": 66678034432,
                  "maxUsedPercent": 90,
                  "minFreeBytes": 5368709120,
                  "ok": true,
                  "path": "/",
                  "probePath": "/",
                  "totalBytes": 105089261568,
                  "usedPercent": 36.5510486636594
                }
              },
              "electrum": {
                "configured": true,
                "error": "",
                "headerHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                "headerHeight": 968197,
                "ok": true,
                "timedOut": false,
                "atTip": true
              },
              "index": {
                "aheadBlocks": 0,
                "checkpointHash": "0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598",
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
                    "updatedAt": "2026-09-22T22:27:57.213Z",
                    "fromHeight": 948000,
                    "completedAt": "2026-09-22T22:27:57.213Z",
                    "bootstrapHash": "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986",
                    "bootstrapHeight": 947999,
                    "indexedThroughBlock": 968196,
                    "indexedThroughBlockHash": "0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598",
                    "transactionNormalization": "canonical-raw-tx-only"
                  }
                },
                "checkpointCanonical": true,
                "canonicalCheckpointHash": "0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598",
                "indexedThroughBlock": 968196,
                "lagBlocks": 1,
                "available": true,
                "ok": false,
                "readModels": {
                  "confirmedIds": {
                    "count": 506,
                    "maxBlock": 967994
                  },
                  "confirmedTransfers": {
                    "count": 236,
                    "maxBlock": 968125
                  },
                  "confirmedEvents": {
                    "count": 26310,
                    "maxBlock": 968190
                  }
                },
                "summarySnapshot": {
                  "blockHash": "0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598",
                  "coverageByKey": {
                    "growthSummary": 968196,
                    "inceptionSummary": 968196,
                    "infinitySummary": 968196,
                    "logSummary": 968196,
                    "marketplaceSummary": 968196,
                    "tokenSummary": 968196,
                    "workFloor": 968196,
                    "workSummary": 968196
                  },
                  "eligible": true,
                  "generatedAt": "2026-09-22T22:28:15.725Z",
                  "indexedAt": "2026-09-22T22:28:15.725Z",
                  "indexedThroughBlock": 968196,
                  "payloadBytes": 21047686,
                  "snapshotId": "bb25cda5a36a5370c36932de",
                  "ok": true
                },
                "scanTipHeight": 968196,
                "stopReason": ""
              },
              "node": {
                "bestBlockHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                "chain": "main",
                "headers": 968197,
                "initialBlockDownload": false,
                "ok": true,
                "pruned": false,
                "tipHeight": 968197,
                "txindexHeight": 968197,
                "txindexSynced": true,
                "verificationProgress": 1
              },
              "worker": {
                "ageMs": 7708,
                "containment": {
                  "active": false,
                  "checkpointHash": "0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598",
                  "checkpointHeight": 968196,
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
                "lastSuccessAt": "2026-09-22T22:42:52.415Z",
                "maxAgeMs": 600000,
                "ok": false,
                "proofReady": false,
                "proofSource": "last-success-confirmed-replay",
                "pendingEvents": {
                  "globalUnresolved": 0,
                  "model": "bounded-best-effort-pending-event-health-v1",
                  "ok": true,
                  "q16PendingUnresolved": 0,
                  "required": true,
                  "scope": "all-observed-pending-protocol-events",
                  "status": {
                    "checked": 0,
                    "deferred": 0,
                    "errors": 0,
                    "ok": true,
                    "q16ParentDeferred": 0,
                    "staleCandidates": 0,
                    "unavailable": false,
                    "unavailableValid": true
                  }
                },
                "phase": "running"
              }
            },
            "indexedAt": "2026-09-22T22:43:00.123Z",
            "indexedThroughBlock": 968196,
            "lagBlocks": 1,
            "mempoolBase": "http://127.0.0.1:8080",
            "ok": false,
            "ready": false,
            "service": "proofofwork-op-return-api",
            "tipHeight": 968197,
            "mode": "readiness"
          },
          "bodyBytes": 3890,
          "bodySha256": "a840557470b2bd6b78f84a8c218937295cb0a141afd4b1778b2d22e4a57a27f6",
          "elapsedSeconds": 1.90392298810184
        },
        "completedAt": "2026-09-22T22:43:00.128060+00:00"
      }
    },
    "core-968196-hash.txt": {
      "sha256": "d98363b7bfca8dccb3bd5c1d1cfb5821bc07489351b6b43e0a717905b0681928",
      "bytes": 65,
      "content": "0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598\n"
    },
    "checkpoint.py": {
      "sha256": "83be2d91e4c4429cd7a6c9115d2224b347a0ae4f6f259aa6facc45f113bf8b46",
      "bytes": 4741,
      "content": "import json,subprocess,datetime,time,os,pathlib,urllib.request,urllib.error,sys,hashlib\nrole=sys.argv[1];out={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'role':role,'scope':'Bounded late checkpoint only; read-only; no production mutation or full re-audit'}\ndef run(k,args,timeout=10,input=None,parse=False):\n try:\n  p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=timeout);v={'returncode':p.returncode,'stdout':p.stdout.strip(),'stderr':p.stderr.strip()}\n  if parse and p.returncode==0:v={'returncode':0,'value':json.loads(p.stdout)}\n  out[k]=v;return p.stdout\n except Exception as e:out[k]={'error':str(e)};return ''\ndef core(k,*args):return run(k,['runuser','-u','bitcoin','--','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf',*args],15,parse=True)\nrun('uptime',['uptime']);run('memory',['free','-b']);run('disk',['df','-B1','/']+(['/data'] if role=='node' else []))\na=list(map(int,pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:]));time.sleep(1);b=list(map(int,pathlib.Path('/proc/stat').read_text().splitlines()[0].split()[1:]));d=[y-x for x,y in zip(a,b)];out['cpuOneSecond']={'cpus':os.cpu_count(),'idlePercent':100*d[3]/sum(d),'ioWaitPercent':100*d[4]/sum(d)}\nout['pressure']={n:pathlib.Path('/proc/pressure/'+n).read_text().strip() for n in ['cpu','memory','io']}\nunits=['bitcoind','electrs','proofofwork-api','proofofwork-indexer-worker','postgresql@16-main','pg_receivewal@16-main','proofofwork-api-wg'] if role=='node' else ['caddy']\nrun('services',['systemctl','show',*units,'--property=Id,MainPID,ActiveState,SubState,Result,NRestarts,ActiveEnterTimestamp'])\nif role=='node':\n core('coreBefore','getblockchaininfo');core('coreIndexes','getindexinfo');core('mempool','getmempoolinfo')\n sql=\"\"\"BEGIN READ ONLY;\n SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s';\n SELECT json_build_object('kind','database','at',clock_timestamp(),'transactionReadOnly',current_setting('transaction_read_only'),'databaseBytes',pg_database_size(current_database()),'checksums',current_setting('data_checksums'),'invalidIndexes',(SELECT count(*) FROM pg_index WHERE NOT indisvalid OR NOT indisready),'unvalidatedConstraints',(SELECT count(*) FROM pg_constraint WHERE NOT convalidated),'deadlocks',(SELECT deadlocks FROM pg_stat_database WHERE datname=current_database()));\n SELECT json_build_object('kind','canonicalMeta','key',key,'updatedAt',updated_at,'indexedThroughBlock',value->'indexedThroughBlock','indexedThroughBlockHash',value->'indexedThroughBlockHash','complete',value->'complete','status',value->'status','phase',value->'phase','lastSuccessAt',value->'lastSuccessAt','consecutiveFailures',value->'consecutiveFailures','error',value->'error','active',value->'active','height',value->'height','blockHash',value->'blockHash') FROM proof_indexer.meta ORDER BY key LIMIT 30;\n SELECT json_build_object('kind','latestSummary','snapshotId',snapshot_id,'height',indexed_through_block,'generatedAt',generated_at) FROM proof_indexer.ledger_snapshots WHERE network='livenet' AND payload->'summaryRefresh'->>'mode'='canonical-summary-refresh' ORDER BY indexed_through_block DESC,generated_at DESC LIMIT 1;\n ROLLBACK;\"\"\"\n run('database',['runuser','-u','postgres','--','env','PGOPTIONS=-c default_transaction_read_only=on','psql','-XAt','-v','ON_ERROR_STOP=1','-d','proof_indexer'],30,input=sql)\n try:\n  t=time.monotonic()\n  with urllib.request.urlopen('http://127.0.0.1:4224/metrics',timeout=5) as r:body=r.read(1024*1024)\n  lines=body.decode().splitlines();out['electrsMetrics']={'elapsedSeconds':time.monotonic()-t,'sha256':hashlib.sha256(body).hexdigest(),'selected':[l for l in lines if l.startswith('electrs_index_height') or ('background-errors' in l and not l.startswith('#'))]}\n except Exception as e:out['electrsMetrics']={'error':str(e)}\n core('coreAfter','getblockchaininfo')\n run('containers',['docker','ps','--format','{{.Names}}\\t{{.Status}}'],10)\nelse:\n t=time.monotonic();out['computerHealth']={'url':'https://computer.proofofwork.me/health','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}\n try:\n  try:r=urllib.request.urlopen(urllib.request.Request('https://computer.proofofwork.me/health',headers={'User-Agent':'ProofOfWork-ReadOnly-Audit20-LateCheckpoint'}),timeout=20)\n  except urllib.error.HTTPError as e:r=e\n  with r:body=r.read(256*1024);out['computerHealth'].update({'status':r.status,'body':json.loads(body),'bodyBytes':len(body),'bodySha256':hashlib.sha256(body).hexdigest()})\n except Exception as e:out['computerHealth']['error']=str(e)\n out['computerHealth']['elapsedSeconds']=time.monotonic()-t\nout['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();print(json.dumps(out,indent=2))\n"
    },
    "final-fence.json": {
      "sha256": "d4e44d7f777f4a121798a5061b31521bad2785a4a1666de804fb2f384632044d",
      "bytes": 8159,
      "content": {
        "startedAt": "2026-09-22T22:44:33.981320+00:00",
        "scope": "One final Computer health read between Core blockchain-info fences; no retry loop; read-only",
        "coreBefore": {
          "returncode": 0,
          "value": {
            "chain": "main",
            "blocks": 968197,
            "headers": 968197,
            "bestblockhash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
            "bits": "17021ec5",
            "target": "000000000000000000021ec50000000000000000000000000000000000000000",
            "difficulty": 132757073449487.5,
            "time": 1790116969,
            "mediantime": 1790113261,
            "verificationprogress": 1,
            "initialblockdownload": false,
            "chainwork": "00000000000000000000000000000000000000014997d610cd9cc6bd27778cc4",
            "size_on_disk": 878162074496,
            "pruned": false,
            "warnings": []
          },
          "stderr": ""
        },
        "computerHealth": {
          "url": "https://computer.proofofwork.me/health",
          "startedAt": "2026-09-22T22:44:33.986156+00:00",
          "status": 200,
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
                  "availableBytes": 378306822144,
                  "maxUsedPercent": 90,
                  "minFreeBytes": 5368709120,
                  "ok": true,
                  "path": "/data/proofofwork-api-cache",
                  "probePath": "/data/proofofwork-api-cache",
                  "totalBytes": 1764768071680,
                  "usedPercent": 78.56336885198378
                },
                "ok": true,
                "root": {
                  "availableBytes": 66678042624,
                  "maxUsedPercent": 90,
                  "minFreeBytes": 5368709120,
                  "ok": true,
                  "path": "/",
                  "probePath": "/",
                  "totalBytes": 105089261568,
                  "usedPercent": 36.55104086838149
                }
              },
              "electrum": {
                "configured": true,
                "error": "",
                "headerHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                "headerHeight": 968197,
                "ok": true,
                "timedOut": false,
                "atTip": true
              },
              "index": {
                "aheadBlocks": 0,
                "checkpointHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
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
                    "updatedAt": "2026-09-22T22:42:59.116Z",
                    "fromHeight": 948000,
                    "completedAt": "2026-09-22T22:42:59.116Z",
                    "bootstrapHash": "000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986",
                    "bootstrapHeight": 947999,
                    "indexedThroughBlock": 968197,
                    "indexedThroughBlockHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                    "transactionNormalization": "canonical-raw-tx-only"
                  }
                },
                "checkpointCanonical": true,
                "canonicalCheckpointHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                "indexedThroughBlock": 968197,
                "lagBlocks": 0,
                "available": true,
                "ok": true,
                "readModels": {
                  "confirmedIds": {
                    "count": 506,
                    "maxBlock": 967994
                  },
                  "confirmedTransfers": {
                    "count": 236,
                    "maxBlock": 968125
                  },
                  "confirmedEvents": {
                    "count": 26310,
                    "maxBlock": 968190
                  }
                },
                "summarySnapshot": {
                  "blockHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                  "coverageByKey": {
                    "growthSummary": 968197,
                    "inceptionSummary": 968197,
                    "infinitySummary": 968197,
                    "logSummary": 968197,
                    "marketplaceSummary": 968197,
                    "tokenSummary": 968197,
                    "workFloor": 968197,
                    "workSummary": 968197
                  },
                  "eligible": true,
                  "generatedAt": "2026-09-22T22:43:17.428Z",
                  "indexedAt": "2026-09-22T22:43:17.428Z",
                  "indexedThroughBlock": 968197,
                  "payloadBytes": 21047686,
                  "snapshotId": "726cbbdd5f7882678080c880",
                  "ok": true
                },
                "scanTipHeight": 968197,
                "stopReason": ""
              },
              "node": {
                "bestBlockHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                "chain": "main",
                "headers": 968197,
                "initialBlockDownload": false,
                "ok": true,
                "pruned": false,
                "tipHeight": 968197,
                "txindexHeight": 968197,
                "txindexSynced": true,
                "verificationProgress": 1
              },
              "worker": {
                "ageMs": 15702,
                "containment": {
                  "active": false,
                  "checkpointHash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
                  "checkpointHeight": 968197,
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
                "lastSuccessAt": "2026-09-22T22:44:20.134Z",
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
                    "checked": 24,
                    "deferred": 0,
                    "errors": 0,
                    "ok": true,
                    "q16ParentDeferred": 0,
                    "staleCandidates": 24,
                    "unavailable": false,
                    "unavailableValid": true
                  }
                },
                "phase": "idle"
              }
            },
            "indexedAt": "2026-09-22T22:44:35.836Z",
            "indexedThroughBlock": 968197,
            "lagBlocks": 0,
            "mempoolBase": "http://127.0.0.1:8080",
            "ok": true,
            "ready": true,
            "service": "proofofwork-op-return-api",
            "tipHeight": 968197,
            "mode": "readiness"
          },
          "bodyBytes": 3878,
          "bodySha256": "2ba1d67015090c6aabf23c84953ec81929d2c59e078915d6dccbe21cb8d73d39",
          "elapsedSeconds": 1.8524876572191715
        },
        "coreAfter": {
          "returncode": 0,
          "value": {
            "chain": "main",
            "blocks": 968197,
            "headers": 968197,
            "bestblockhash": "0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777",
            "bits": "17021ec5",
            "target": "000000000000000000021ec50000000000000000000000000000000000000000",
            "difficulty": 132757073449487.5,
            "time": 1790116969,
            "mediantime": 1790113261,
            "verificationprogress": 1,
            "initialblockdownload": false,
            "chainwork": "00000000000000000000000000000000000000014997d610cd9cc6bd27778cc4",
            "size_on_disk": 878162074496,
            "pruned": false,
            "warnings": []
          },
          "stderr": ""
        },
        "completedAt": "2026-09-22T22:44:35.843693+00:00"
      }
    },
    "final-fence.py": {
      "sha256": "8339a7dc2870cdd2e21df46ebee5116101a127fe9d84d653d04adaede231f0b0",
      "bytes": 1370,
      "content": "import subprocess,json,datetime,time,urllib.request,urllib.error,hashlib\nout={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'One final Computer health read between Core blockchain-info fences; no retry loop; read-only'}\ndef core(k):\n p=subprocess.run(['runuser','-u','bitcoin','--','/usr/local/bin/bitcoin-cli','-conf=/etc/bitcoin/bitcoin.conf','getblockchaininfo'],capture_output=True,text=True,timeout=15);out[k]={'returncode':p.returncode,'value':json.loads(p.stdout) if p.returncode==0 else None,'stderr':p.stderr.strip()}\ncore('coreBefore');t=time.monotonic();out['computerHealth']={'url':'https://computer.proofofwork.me/health','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}\ntry:\n try:r=urllib.request.urlopen(urllib.request.Request('https://computer.proofofwork.me/health',headers={'User-Agent':'ProofOfWork-ReadOnly-Audit20-FinalFence'}),timeout=20)\n except urllib.error.HTTPError as e:r=e\n with r:body=r.read(256*1024);out['computerHealth'].update({'status':r.status,'body':json.loads(body),'bodyBytes':len(body),'bodySha256':hashlib.sha256(body).hexdigest()})\nexcept Exception as e:out['computerHealth']['error']=str(e)\nout['computerHealth']['elapsedSeconds']=time.monotonic()-t;core('coreAfter');out['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();print(json.dumps(out,indent=2))\n"
    },
    "report.md": {
      "sha256": "b68b1ec3eea76b0ef49b02ead96a3553b5ae7a51fee8b1a662d2688ec58d046a",
      "bytes": 6607,
      "content": "# Audit 20 late checkpoint \u2014 2026-09-22 22:42:56\u201322:44:35 UTC\n\nThis is a bounded read-only checkpoint after the pause, separate from the 06:41\u201307:02 ordered audit. Earlier temporary receipts are no longer available; their disappearance cause was not investigated or established. This checkpoint does not recreate or re-certify that full audit. No production changes, cleanup, restarts, configuration edits, or repository edits occurred. Only Computer `/health` was requested publicly; no other public surface was revisited. One subsequent read-only Core hash lookup corroborated the sampled database checkpoint.\n\n## Current state\n\n| Measurement | Node VPS | UI VPS |\n|---|---:|---:|\n| Root free bytes | 66678034432 | 10825637888 |\n| Root df use | 34% | 72% |\n| Data free bytes | 378320891904 | no separate data filesystem |\n| Data df use | 78% | \u2014 |\n| Available RAM bytes | 115801178112 / 134125752320 total | 3383590912 / 4005457920 total |\n| Swap used bytes | 659292160 | 0 |\n| CPU idle, one second | 92.4953% of 32 CPUs | 86.0% of 2 CPUs |\n| CPU I/O wait, one second | 0% | 0.5% |\n| Load average 1/5/15 minutes | 1.34 / 1.18 / 1.20 | 0.21 / 0.06 / 0.01 |\n\nMemory and I/O PSI averages were zero on both hosts. These brief observations do not show global host exhaustion. All inspected services remained active with the earlier main PIDs and zero automatic restart counts: Core, Electrs, API, indexer worker, PostgreSQL, WAL receiver and API WireGuard proxy on node; Caddy on UI. Three mempool containers reported healthy.\n\nUI free space leaves only **88219648 bytes = 84.1328125 MiB above the 10 GiB reserve**, or **21110784 bytes = 20.1328125 MiB after the helper's additional 64 MiB allowance**. Compared with the earlier 07:01 observation retained in the task record, UI free space declined 42528768 bytes; node root and data free space declined 250961920 and 2127073280 bytes respectively. These differences have no newly proved component attribution. No backup/rollback deletion dependencies were revalidated.\n\nCore before/after remained height **968197**, hash `0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777`. It was main chain, unpruned, not in initial download, verification progress 1, no warnings. All three Core indexes were synchronized to 968197. Electrs metrics independently reported 968197; all five observed RocksDB background-error counters were zero. Local metrics returned in 0.014 seconds; that does not establish address RPC latency. Core mempool was loaded with 81682 transactions, 40852768 bytes, memory usage 230056560 of a 2000000000-byte limit; this is a time-local snapshot.\n\nThe PostgreSQL transaction confirmed `transaction_read_only=on`. Database size was **32761158679 bytes**, +406446080 versus the 06:18 catalog receipt embedded in original Audit 20 evidence. Invalid indexes, unvalidated constraints and cumulative deadlocks were zero. Data checksums remained off. Canonical rebuild/checkpoint and latest summary were **968196**, canonical hash `0000000000000000000093a2d970d4cacb98d94627ecc27d423cbca39fd59598`; a subsequent direct Core `getblockhash 968196` lookup matched. Latest canonical summary `bb25cda5a36a5370c36932de` was generated 22:28:15.725 UTC. Worker metadata recorded last success 22:42:52.415 UTC. These are catalog/checkpoint checks, not a new physical scan, row-by-row replay, backup restore, or MariaDB re-audit.\n\nComputer `/health` started **22:42:58.224 UTC**, returned **HTTP 503 in 1.903923 seconds**, and reported indexedAt **22:43:00.123 UTC**. `available=true`, `ready=false`, `ok=false`. Core/Electrs were 968197; the canonical index and eligible summary were 968196 with **one-block lag** and matching canonical hash. All eight summary coverage keys were 968196. Worker phase was `running`, last success 22:42:52.415, consecutive failures zero, containment inactive, `proofReady=false`. Pending protocol-event health reported zero unresolved/errors in its bounded best-effort view. The database, Core, backend, Electrum header and **address canary all passed without timeout**. Thus the earlier address timeout did not recur in this sample; the existing availability issue is not thereby closed. One-block lag with a running worker is consistent with catch-up, but this single observation does not demonstrate subsequent recovery or establish a stuck indexer. Core's newest block header timestamp was 22:42:49; it is not a measured block-arrival timestamp.\n\nThe health field `summarySnapshot.payloadBytes=21047686` is not a fresh compact-response-size measurement. Do not equate it with the earlier compact payload measurement of 19991898 bytes or use it to recertify compact payload headroom.\n\nNo new issue ID is recommended from this checkpoint. Preserve the existing capacity and intermittent availability findings and the earlier audit's integrity, recovery, alert-delivery and physical-scan limitations. The first HTTP 503 receipt is preserved. The parent then requested one final Computer health read between Core fences, without a wait or retry loop; its result follows.\n\n## Single final catch-up fence, 22:44:33\u201322:44:35 UTC\n\nComputer `/health` returned **HTTP 200 in 1.852488 seconds**, indexedAt **22:44:35.836 UTC**, `available=true`, `ready=true`, `ok=true`. Core before and after remained **968197** at hash `0000000000000000000037d4b9d8505c8d65f85e9bcbe65d834ccb88f3a9f777`. The canonical index, Electrs header, eligible summary and all eight summary coverage keys now matched 968197 with zero lag. Database and address canary passed. Worker was idle, proofReady true, no consecutive failures, last success 22:44:20.134 UTC. Bounded pending-event status checked 24 candidates with zero unresolved/deferred/errors. Summary `726cbbdd5f7882678080c880` was generated 22:43:17.428 UTC. `payloadBytes` remained 21047686 and still is not a compact-wire-size measurement.\n\nThis confirms the observed one-block lag caught up by the final sample. It does not close the earlier intermittent latency family, certify sustained readiness, erase the preceding 503, or renew the full integrity/math/backup audit. The final health disk report, which concerns node storage, showed root free 66678042624 and data/cache free 378306822144 bytes; UI free space was not resampled after 22:42:57. Both final Core observations were unchanged.\n\nSources: `final-fence.json`, `final-fence.py`, `node.json`, `ui.json`, `core-968196-hash.txt`, and read-only collection source `checkpoint.py`. The separate `evidence.json` embeds these plus this report and their SHA-256 hashes for prompt durable inclusion by the parent audit.\n"
    }
  }
}
```
