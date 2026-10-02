# Production health and data-integrity audit 30 — 2026-10-02

Audit date: **2026-10-02**, America/Toronto (UTC−04:00). Production collection completed at **18:32:56 UTC / 14:32:56 EDT**. Individual receipts retain their own timestamps; this is a moving production system, not one simultaneous snapshot.

Scope: both VPS environments, storage and recovery inventories, PostgreSQL and mempool MariaDB, Core, Electrs, indexer/worker, API and logs, indexed transaction/event/mail/credit/ID/DNS relations, exact arithmetic, and the public and connected Computer interfaces. This audit follows the previous audit chain through audit 29, its remediation release, and the October 1 recursive-assurance batch. Prior findings are rechecked under their existing IDs.

**Result: substantial chain and relational checks passed, but the application does not receive an unconditional health or mathematical-integrity certification.** Two new P2 defects are recorded below: decimal fee rounding can change transaction preparation, and retention monitoring hides host scratch files inside its service namespace. Existing UI capacity accumulation, mail-byte loss, API availability, recovery evidence, and assurance gaps remain open.

The user authorized a read-only audit and creation of this audit log. Production records, ledgers, historical evidence, services, configuration, backups and rollback roots were not repaired or removed. No wallet signature, transaction, commit, push, deployment or announcement was performed. An initial ordinary production Git-status probe may have refreshed `.git/index`; its prior mode and causation are unproven. That incidental metadata possibility is recorded rather than claiming a perfectly write-free filesystem examination.

## Evidence and recursive continuity

The companion [audit 30 evidence](2026-10-02-production-comprehensive-health-data-integrity-audit-30.evidence.json) contains timestamped receipts, exact values, source bindings, failed results and their qualifications, and compressed reproducible verifier inputs and scripts. Its SHA-256 is **`8c57aae23db56530ac2289a4232208a5eaa9af9345f1f929948c1eb41a4eb9a8`**; its size is **1,218,693 bytes**. Check this binding before using the receipt.

The evidence binds **75 pre-existing audit, recovery, ledger and refund files** by path, byte size and SHA-256. These files remain unchanged. It also binds the eight reviewed operating/protocol/hygiene documents. Previous incidents, migrations, historical protocol forms, refund records and recovery evidence were preserved; age alone was not used to classify material as obsolete.

Initial local HEAD: `2a70e12eb0bc1543043df899404b0df7ca5403fb`; the checkout was clean. The approved local additions are this report, its companion evidence and their classification in `repository-hygiene.json`. This is audit bookkeeping, not a production release.

Important evidence locations inside the JSON:

| Evidence key | Purpose |
| --- | --- |
| `priorEvidenceBindings`, `documentBindings` | Recursive continuity and reviewed source documents |
| `vps.hosts`, `vps.capacityInterpretation`, `vps.database`, `vps.mariaDb`, `vps.walCoverage` | Capacity, database and service observations |
| `vps.uiRecovery`, `vps.nodeRecovery`, `vps.backups`, `vps.backupResourceCaps` | Exact recovery candidates, retained versions, hashes and backup qualification |
| `vps.newRetentionNamespaceFinding`, `vps.heldInventoryQualifications`, `vps.logs` | Namespace defect, real absences, log coverage and active-journal retries |
| `integrity`, `integrityArtifactManifest` | Whole-population SQL/Core comparisons, original failures, reservations, attachments, gates and DNS coverage |
| `math`, `embeddedArtifacts`, `reproduction` | Independent exact arithmetic, unsigned fee counterexamples and portable replay procedures |
| `browser`, `surfaceProbe` | Timestamped visible behavior, initial timeouts and subsequent observations |

Receipts deliberately omit mail bodies, raw mail payloads, credentials and private-key-like content. Mail verification retains transaction IDs, byte lengths, hashes and equivalence predicates. Public chain readability does not justify copying sensitive-looking content into a durable audit artifact.

## Systems, capacity and serving health

Values below use decimal GB for readability; exact bytes are retained in the evidence. Filesystem totals, used and available need not sum exactly because filesystem reserved space is separate. Directory values are allocated bytes unless explicitly labelled apparent; nested directories must not be added again to their parents.

| System / filesystem | Total | Used | Available | `df` used | Inodes used |
| --- | ---: | ---: | ---: | ---: | ---: |
| UI VPS `77.42.91.106`, `/` | 39.974 GB | 21.063 GB | **17.226 GB** | 56% | 7% |
| Node VPS `65.108.122.87`, `/` | 105.089 GB | 30.607 GB | 69.097 GB | 31% | 7% |
| Node VPS, `/data` | 1,764.768 GB | 1,342.559 GB | **413.222 GB** | 77% | 1% |

Capacity observations were collected at approximately 18:12–18:13 UTC. The UI has 4.005 GB RAM, 3.276 GB available, no swap, two CPUs, load 0.09/0.04/0.01 and 93–99% idle in the live samples. The node has 134.126 GB RAM, 110.025 GB available, 32 CPUs, load 5.14/3.98/3.38 and 84–89% idle. Its 0.935 GB used swap is retained historical allocation; the live samples show no swap-in/out pressure. RAID1 reports `[UU]`.

UI Caddy and node Core, Electrs, PostgreSQL, API and worker are active. Captured serving unit lifetimes show `NRestarts=0`; this is not a lifetime guarantee. Three mempool containers are healthy with zero captured restarts. Failed historical publisher/replay/rehearsal oneshots are distinct from serving-process crashes. Storage-trend, retention protection, and node inventory/observation health units still report failures; the two new findings and existing issues explain relevant parts, not every historical failure.

Network receipts contain interface lifetime byte/error/drop counters, not a billing-period bandwidth quota or an independently measured traffic rate. No provider data allowance was established. No current OOM or serving-process crash was proved by the bounded checks.

### UI disk recurrence risk

The UI hosts static application releases; the primary application PostgreSQL database is on the **node VPS**, not on the UI VPS. The UI's principal present disk risk is accumulation of release, rollback, deployment transport and recovery material.

| UI storage domain | Allocated bytes / observation |
| --- | ---: |
| `/var/backups/proofofwork-ui` | 11,444,129,792 |
| Rollback roots, included in backups | 2,782,773,248 across 11 roots |
| Transport evidence, included in backups | 3,167,924,224 |
| Recovery evidence, included in backups | 1,570,279,424 |
| `/var/tmp/proofofwork-deploy` | **4,948,336,640** |
| `/var/www` | 235,732,992 |
| `/var/log` | 635,785,216 |
| `/tmp` | 579,579,904 |
| `/var/cache` | 128,532,480 |

The 5 GiB scratch admission ceiling leaves only **420,372,480 bytes** of scratch headroom. Root has **6,489,051,136 bytes** above its 10 GiB reserve. A previous approved same-filesystem move from deployment scratch into backups can restore scratch admission without freeing root space. Repeated deployments, recovery copies and retained rollbacks can therefore reproduce a full-root incident even when the scratch guard works.

The 18:01 storage-trend receipt extrapolates one day's net consumption of about 7.118 GB/day to **21.88 hours until the 10 GiB reserve**, not until full disk. This is a conditional warning, not a reliable exhaustion ETA: deployment and backup bursts dominate short windows. The available capacity is real; prospective cleanup savings are not counted as free space.

Current UI release `26500e4d2ff7-20261002T054938Z` has source commit `26500e4d2ff743d65a0ca2b4dc06bbd5f62b27ea`. All 16 managed surface file counts and hashes match its manifest, the current archive checksum matches, and the current tree fingerprint is `0b4fdc218f39274b218d495b2ddb62c904a2d43fb3f092dd22857ea5521a5c9e`.

The retained immediate prior rollback root is `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-26500e4d2ff7-20261002T054938Z`, containing release `835e30258d23-20261002T052338Z`. Its 16 surface bindings and retained archive checksum match; its tree fingerprint is `f8d0e3c0d7acb7a001482cc49afa8a0c696b2b6d8b0d181a5231286c921a39e9`. This is byte verification, **not a rollback rehearsal**. Keep current and immediate prior assets while preparing any separately approved retirement.

### Node storage and release assurance

Core occupies 980,382,437,376 allocated bytes, Electrs 64,306,294,784 and mempool data 2,172,813,312. Large-state tablespace files occupy 38,999,445,504; PostgreSQL backup roots 39,897,251,840; release backups 8,752,734,208. Active final-source replay occupies 89,525,575,680, an older replay domain 32,853,667,840, scoped rehearsal 20,162,818,048, production backup domain 20,256,141,312 and a stopped audit-28 restore domain 37,423,022,080. These domains are recovery/assurance material; “stopped” or “older” does not prove deletion safety. Exact paths are in the receipt.

Node `/tmp` occupies 5,110,697,984 bytes, deployment scratch 636,993,536, current API cache 172,699,648 and logs 1,261,559,808. No cache, temporary file, log or recovery domain was removed. Inspect ownership, current readers, retention obligations and regeneration before an exact cleanup request.

Node `/data` remains in the existing 77% warning band. A one-day net rate at 18:02 implies 190.6 days to the 100 GiB reserve; an earlier seven-day rate implies 12.24 days. This instability prevents a credible steady-growth ETA. Core growth, AMO transition growth and replay/recovery retention all consume this volume.

The node source is clean at commit `d4d888757a1c44aab3b9690f79e1917935930f0f`, tree `4984c4a3143af9d91c1ebc09e2f749dfc8019b29`. Four managed release archives match their checksums and provenance. The current archive is 96,352,302 bytes with SHA-256 `19786a7927bdda2aa5be82e16e17832e9612628f3241329ceb3e42bfc84ba3f8`; the immediate prior `53b5b42` archive is bound in the receipt. There are **28 `/opt` source checkouts against a limit of nine**, so the existing release-inventory warning remains.

Fresh mandatory full runtime attestation **fails** on `.git/index` mode `0664` (uid/gid 1000, 70,082 bytes; mtime/ctime 18:10:56.895924077 UTC). Audit 19 previously recorded this permission class and a repair to `0600`. This is a qualified recheck/regression of metadata safety, not evidence of changed source bytes. The audit's first ordinary Git-status probe may have refreshed the index; its prior mode and precise causation were not captured. Later probes disabled optional Git locks. No permission repair was performed, and archived release provenance does not turn this fresh failed attestation into a pass.

## Database health, growth and recovery

PostgreSQL 16 `proof_indexer` is **39,581,457,431 bytes** at the database-size observation. `work_amo_block_transitions` occupies **38,289,629,184 bytes (96.736%)**, predominantly TOAST, with only 6,815,744 heap and 3,129,344 index bytes. Other large relations include ledger snapshots 709,607,424, events 157,122,560 and transactions 106,889,216. The repeated transition payloads remain the previously documented growth mechanism; approximately 38.48 GB was reported September 30, with collection-time differences qualified. No transition history was pruned or recompressed.

Invalid indexes, unready indexes, unvalidated constraints, deadlocks and conflicts are zero in the catalog observations. Autovacuum is on with recent activity. One approximately 50-second idle-in-transaction session at 18:15 was transient; the 18:20 recheck found zero idle transactions and two short active queries. These observations do not establish the absence of every historical lock or latency incident.

**Physical certification remains open.** Live data checksums are off, `amcheck` is absent, archive mode is off, WAL level is replica and there are no active replication slots. `pg_receivewal@16-main.service` is inactive/dead, PID 0, having exited September 25 at 01:42:31 UTC. There is no verified current continuous WAL/PITR path. An initial generic nonexistent receiver-unit probe was superseded by inspection of the actual unit.

PostgreSQL's cumulative spill counters are 268,946 temporary files / 2,365,826,433,082 bytes. They are cumulative query activity, **not 2.37 TB of current removable files**. Logical relational checks below do not certify all heap, index or filesystem pages.

Mempool MariaDB 10.5.21 has 24 InnoDB tables with catalog data 111,886,336 and index 32,129,024 bytes, total 144,015,360; catalog free space is 19,922,944 bytes. Catalog row counts are estimates. Sampled current lock/read/write/log waits are zero; four connections and one running query include audit activity. Its container is healthy; bounded logs contain no sampled error. No physical `CHECK TABLE` was run.

Latest logical backup: `/data/proofofwork-postgres-backups/logical/proof_indexer-20261002T031851Z.dumpset`. A low-priority read under the existing shared backup lock, using no-atime/no-follow reads, verified stable full dump and globals checksums. The 20,525,963,614-byte dump matches SHA-256 `893700c4fff20e4bad721d16188f67dd04e3f44ee9f3f63784c15c51488a7b1a`; globals match their recorded hash. `pg_restore --list` returns 197 entries and exit 0. **This proves checksum and catalog readability, not restored data or PITR.**

Two logical sets are presently justified: the pinned September 29 last restore-proven set (19,363,807,232 allocated bytes), and the latest October 2 set (20,525,985,792). A newer checksum-readable backup must not replace the last restore-proven backup until an isolated restore qualifies it. This preserves the user's “last verified backup” requirement without silently equating checksum verification with restoration.

Previously unbounded backup resource caps are now installed and match source: 90-minute timeout, 200% CPU quota, IOWeight 10, MemoryHigh 24 GiB, MemoryMax 32 GiB, TasksMax 32, Nice 10 and cgroup kill mode. The captured backup unit is inactive, PID 0, with no dump in progress. This closes that configuration component of AUD28-FU-02; progress, fresh restore and recovery assurance remain separate open obligations. No backup schedule or rotation was triggered by this audit.

## Application and system logs

All-priority API and worker journal examinations requested 24 hours, but both reached their **20,000-line budget**. Actual API coverage is October 2 **12:24–18:13 UTC**: 15,333 completed HTTP observations, **376 HTTP 5xx**, 588 interrupted observations and 356 wallet-overlay-unavailable structured warnings. Actual worker coverage is **16:00–18:13 UTC**: 84 structured error/warning messages plus two plain-text error/warning messages, including hydration/readiness retries. These counts are emitted log messages, not unique incidents or complete 24-hour coverage. INFO-priority application errors are included; an error-priority-only scan would understate this condition. These results expand the existing availability/pending issue lineage.

The bounded 24-hour system error-priority summaries principally identify `init.scope` and SSH/network activity; no new serving-process crash was proved. Container JSON rotation remains configured; nginx logs are a separate approximately 779 MB domain. Journals occupy approximately 367 MB on UI and 1,015 MB on node, within the larger log inventories.

Archived journal files pass the initial verification. Initial active-file checks fail and are preserved. Two metadata-stable UI active-journal retries pass. Node `user-1000.journal` retries still fail while mtime/ctime change and failure offsets move under the live writer. This **does not prove stationary corruption or close physical journal integrity**. No writer was stopped and no journal was rotated, copied, repaired or deleted. An approved stable/offline verification is needed if physical log integrity must be certified.

## Chain, indexing, relations and event integrity

The independently fenced population check began and ended at Core height **969621**, hash **`00000000000000000001a6d9fc905f995641c52f165c2c5b9218e09f7dbeb8cb`**. At 18:28 Core, Electrs, transaction/full indexes, checkpoint and eight summary models agree on this tip. Core is unpruned, out of initial block download, headers and blocks agree, verification progress is 1 and sampled warnings are empty. Transaction, coinstats and basic-filter indexes report synchronized. Worker lag/ahead are zero, age approximately 47.4 seconds, captured failures zero. Readiness reports 23 observed pending candidates checked with zero errors/unresolved. Readiness receipts are not substitutes for independent raw-chain comparison.

| Whole indexed livenet population | Count / result |
| --- | --- |
| Transactions | 26,193 = 25,945 confirmed + 162 pending + 86 dropped |
| Events | 26,810 = 26,635 confirmed + 160 pending + 15 dropped; 26,294 confirmed valid |
| Normalized outputs / inputs | 78,343 / 31,054 |
| Decoded OP_RETURN rows | 26,071 |
| Event participants / references | 127,232 / 57,563 |
| Confirmed mail projections | 619 |
| ID registry / credit definitions | 508 / 238 |
| Stored AMO transitions | 10,001, heights 959621–969621 |

Independent Python parsing reconciled every confirmed stored transaction against Core: raw bytes, independently derived txid/wtxid, scripts, addresses, output values, input sequences/scriptSig/witness and parent value/address, fees, block hashes and ordered transaction positions. It fetched 2,950 additional parents, checked 21,622 canonical block hashes and 2,342 transaction-bearing blocks. **Actual content, value, fee, position and status mismatches: zero.** This establishes the captured indexed population, not discovery of every historical protocol carrier across the entire chain.

The original raw comparator remains **`ok:false`**, with 20 assertions for optional `height` and `_powBlockHash` aliases absent from ten auxiliary raw-JSON envelopes. Follow-up independently verifies that all ten have correct relational heights/hashes/positions and exact `canonicalBlockScan` markers, Core bytes and zero application events. The scanner at `scripts/backfill-proof-indexer.mjs:13405–13416` writes `_powBlockIndex` and the structured marker without requiring those separate aliases. Six exact txids have previous issue/recovery references; the other four use the same valid auxiliary form. This is a documented audit-predicate qualification, not a newly found corrupt chain record. The failed receipt is preserved; no historical envelope was rewritten to satisfy it.

Whole-population SQL predicates find zero duplicate canonical event keys, orphan relations, duplicate participants/references, inconsistent parent statuses, or normalized canonical-position/block-hash mismatches. All 10,001 transitions pass continuity, hash/value/opening-link, completeness and nondecreasing predicates, with the documented precision boundary qualified. This is bounded stored-transition coverage, not a fresh genesis numeric replay.

All 26,810 events, participants, references and 619 mail projections match the current production projection helper with zero missing/extras/duplicates. This is consistency against the current helper, not independent proof of every parser's semantics. An initial audit harness omitted PWM replay metadata and produced 619 false projection mismatches; correcting only the audit procedure produced the passing full comparison. Both procedure results are retained; no production projection repair occurred.

### Mempool, tickets and ledger reconciliation

Both Core mempool samples (76,683 then 77,363 total transactions) contain all **162 indexed pending transactions** and omit all **86 indexed dropped transactions**. Churn elsewhere is expected. This proves statuses for stored observations at the two samples; it does not prove complete protocol discovery across the whole mempool, guarantee future inclusion, or make pending records canonical.

All 1,009 active/sealing candidate outpoints accepted into the current book are independently Core-unspent with 546-proof outputs: 1,007 WORK tickets plus two others. Forty-four historically active/sealing WORK candidates are Core-spent and correctly excluded from the active book. Exact independent arithmetic finds reservations across 38 seller/token pairs within confirmed balances; no unknown candidates or amount mismatches. All 1,007 current WORK ticket amounts match their immutable Q16 terms. Pending ticket-book completeness is not claimed.

Across all 238 credit definitions, minted quantities equal summed confirmed balances exactly; all 436 balance rows are nonnegative. All 236 capped non-bond credits respect supply caps. POWB/INCB `max_supply=0` represents dynamic bond supply, not a zero supply ceiling. Forty-seven historical INCB H−1 oracle hashes and source checkpoint aliases independently match Core.

Strict parity returns 102 checks: 100 true and two known inactive legacy V5/USD-quote warning conditions; no active invariant failure. The Computer event gate passes 49 checks, mailbox fixtures pass eight cases, and the ledger retry passes after an initial new-tip 503. The full marketplace regression passes after enumerating all 1,007 active WORK tickets; a canonical-wallet-index 503 recovered. The original interruptions are retained and remain evidence of existing availability limits.

The **full semantic ID audit did not pass**: an original long read timeout and the fresh 90.001-second retry at `/api/v1/internal/id-registry-audit` occur before address-history pagination. Successful 508-ID registry parity and raw transaction reconciliation are separate results and cannot stand in for this missing semantic proof.

DNS receipts report 23 roots, 28 registry transactions, one listing, zero active children and complete activation-era coverage across 133 blocks 969489–969621. This is the API's Core-backed admission/coverage receipt; the audit did not independently decode every carrier in those raw blocks.

Treasury, refund and bounty evidence files retain their exact prior hashes. Their historical issue records were reviewed. No new independent fund-balance, historical payout or all-address reconciliation was completed; the failed full ID gate also leaves its refund-specific semantic acceptance unverified. Do not describe preserved ledger bytes as a fresh financial reconciliation.

### Mail, attachment and byte preservation

All 619 confirmed PWM transactions and 690 associated outputs were independently enumerated. All six governed attachments reconstruct exactly: 54,342 bytes total, chunk order, size and SHA-256 correct. There are 26,075 OP_RETURN-bearing outputs versus 26,071 decoded rows; four historical `OP_RETURN + OP_13` non-push forms retain their previous H9/H24 qualification and are not invented as decoded events.

Existing **AUD28-04 remains open**: 16 of 619 mail bodies lose leading/trailing whitespace bytes in the stored projection. Two additional null/empty representations are byte-equivalent. All 18 comparison differences are documented by lengths and hashes. The welcome fixture is 1,018 raw bytes versus 1,017 stored bytes. Confirmed raw chain evidence remains exact; the projection is lossy. Recommended correction remains byte-preserving parsing/storage/rendering followed by approved, precisely scoped projection rebuilding, never a rewrite of historical chain payloads.

## Mathematical verification

Seventeen existing gates pass, including audit-19 accounting, V8 AMO, precision V2/Q8/Q16, fee-rate precision, exact bonds, canonical order, INCB range witness/post-V5 repair/scoped oracle/H1 import/snapshot restore, and historical WORK marketplace/AMO V2/V5/V6/V7. Exact commands and output bindings are retained. Passing fee tests are qualified by AUD30-01 below.

Independent actual-source testing passes **10,000 deterministic V8 vectors, 15 rejected boundary cases and 6,000 precision round-trip assertions**. Independent integer arithmetic on minimized, portable live inputs passes **22,581 assertions** across **1,092 immutable V8 terms and 47 INCB mints**. The minimized inputs were rerun with the same assertion count. The public math snapshot is `907655ff4956d8be2d2be7fd` at height **969620**, hash `000000000000000000019393eb25a997c3ed0842dd90b1c52da9cc9b86701f13`; the later population/readiness fence at 969621 is a separate observation. Canonical oracle hashes are independently bound to Core; historical numeric N-before and H−1 oracle quantities are recomputed from stored evidence, not rebuilt from genesis in this audit.

| Captured exact accounting value | Result |
| --- | --- |
| Native N, Q8 integer | `1452534926166124607757453323` |
| Native N, proofs | `14,525,349,261,661,246,077.57453323` |
| WORK floor, Q8 integer | `69168329817434505131` |
| WORK floor, proofs / WORK | `691,683,298,174.34505131` |
| Frozen N / frozen WORK floor | `1,777,214,699,934,487,598.23473452` / `84,629,271,425.45179039` |
| WORK mints / fixed supply / holders | 21,000 / 21,000,000 WORK / 388 |
| V8 face / current computed amount | 25,000 proofs / 361,437,092 subatoms |
| DNS overlay contribution | `12046000000000` Q8 = 5 × 24,092 proofs |
| POWB issuance / native value / floor | 630,496,569 / 630,501,483 / `1.00000779` |
| INCB issuance decomposition | `945662401792509469` = 27,932 direct + `945662401792481537` attached |
| INCB dust / repaired height-968125 target | `22.46190218` proofs / `720814688394061543` INCB units |
| AMO global flow | 11,225,462 = 9,775,286 sales + 1,450,176 fee proofs |

V8 amount recomputes as integer floor of `face × 21,000,000 × 10^16 × 10^8 / NbeforeQ8`, with independent ceiling/minimum-value and compute-before-bond checks. DNS flow is an explicitly accounted overlay, not duplication. Global sale flow remains weighted five times. The seven-WORK Boost fixture verifies `7 × floor + 1,092 = 4,841,783,088,312.41535919` proofs. Ninety credit-only sales versus 94 global sales are different scopes.

ID fees remain 1,000 proofs for registration and 546 for receiver updates, direct transfers and the documented sale-ticket operations. Registration remains on ID; management and marketplace operations remain in their respective Computer/AMO workspaces. Historical ID/DNS/credit formats and confirmed fee rules were preserved.

USD quotes, charts and Growth forecasts are display/model calculations with stated assumptions, not canonical consensus quantities. Positive-feedback/nonlinear projections are not treated as a protocol arithmetic error. A universal mathematical certification is withheld because fresh genesis numeric reconstruction and complete ID semantics were not established, and the unsigned transaction-preparation defect is real.

## New findings

### AUD30-01 — P2: binary decimal fee rounding changes preparation and a dust boundary

**Source:** `src/walletUtxos.ts:73–78,89–94,107–112` applies `Math.ceil(estimatedVbytes * decimal Number feeRate)`. Related paths appear at `src/App.tsx:20170,34523,44428`; Boost uses the shared selector at `src/features/boost/boostWallet.ts:557`. Deployed UI source matches the reviewed local `App.tsx` and `walletUtxos.ts` hashes in the evidence.

**Reproduction:** the actual AST-extracted `buildPaymentPsbt` runs with real PSBT parsing and mocked read-only funding/reservation dependencies. No wallet or broadcast is used. Accepted fee rate **0.28 proofs/vbyte**, existing conservative budget **275 estimated vbytes**, exact ceiling **77 proofs**; binary product is `77.00000000000001`, giving **78**. The 275-byte budget is the existing estimate, not measured signed vsize.

| Local unsigned fixture | Expected under exact decimal rate and existing policies | Actual preparation |
| --- | --- | --- |
| 100,000-proof input; 546 recipient; 26-byte PWM payload | Fee 77; change 99,377 | Fee 78; change 99,376 |
| 1,169-proof input; same outputs | Fee 77; change **546**, permitted at the existing dust boundary | Binary estimate makes change 545, selects no-change branch; **actual fee 623**, no change |

The second fixture's 241-vbyte no-change branch calculates 68 proofs and absorbs a 555-proof remainder. Relative to the intended 77-proof change-preserving preparation, actual input-minus-outputs differs by **546 proofs**. Existing review displays actual fee and absorbed remainder before signing, and the reviewed PSBT is the one sent for signing. No actual production loss, wallet signature, canonical corruption or secret handling was observed.

**Impact:** accepted decimal input can deterministically select the wrong fee/change path; a nominal one-proof arithmetic error becomes material at a dust threshold. The existing `check:fee-rate-precision` passes because its expected oracle repeats the same floating-point `Math.ceil` expression.

**Recommended correction, requiring approval:** parse the accepted decimal rate into exact scaled integers and apply integer ceiling division consistently across the shared selector and sibling preparation paths. Keep existing vbyte estimates and dust policy. Add independent rational-oracle, dust-boundary and unsigned input/output conservation acceptance checks, then review, build and verify before any deployment. Reproduce from the evidence's `math-independent.mjs`; do not change historical fees or ledger records.

### AUD30-02 — P2: retention service namespace falsely reports present host files missing

**Source:** both installed retention services have `PrivateTmp=yes` and empty `BindReadOnlyPaths`; source units specify this at line 14. `scripts/check-retention-protection.py:99–124` uses ordinary host-path existence semantics. The installed checker hash is `b5802552dfc99283aebd4bc0152c4bb2740c39081637218bb1d8c8ec35559f0a` on both hosts. Existing tests inject existence callbacks and do not exercise the systemd namespace.

| Host | Scheduled service “missing” | Direct host-root check missing | Physically present, falsely hidden |
| --- | ---: | ---: | ---: |
| UI | 49 | 13 | **36** |
| Node | 60 | 18 | **42** |

**Impact:** private `/var/tmp` hides **78 present held artifacts** from the scheduled checker, obscuring real evidence gaps and blocking reliable retention interpretation. A green source-level test cannot certify the production service's filesystem view.

The original AUD29-R01 **23 real historical absences (11 UI + 12 node)** remain unresolved. Two extra UI missing original paths are approved same-filesystem transport relocations with destination checksum/inode/mode/ownership/mtime matched to the move receipt. Six extra node managed paths are two archives and their four checksum/provenance sidecars for releases `3bc6c9d-20260929T200136Z` and `d2c0afa-20260929T160642Z`. Same-name 90/94-byte scratch reconstruction triggers are **not preserved archives**. Bounded prior receipt searches did not establish exact authorized-retirement lineage for all six; do not invent a new unapproved-deletion event or mark them recovered. The evidence retains the exact paths and qualification.

**Recommended correction, requiring approval:** retain service hardening and bind only the required host deployment-scratch subtree read-only, or use an equivalent exact namespace-aware design. Test present files, genuinely missing evidence, approved relocation and approved retirement in the effective service namespace. Preserve immutable holds and prune masks; do not suppress all missing checks or broadly exempt historical obligations.

An initial probe used the wrong hold basename `/etc/proofofwork-retention/hold`. The actual `/etc/proofofwork-retention/audit28.hold` exists on both hosts, and the direct checker reports no marker/pin/mask error. The original mistaken probe field is retained with its correction. Three prune timers remain persistently masked/inactive; the audit did not unmask or change them.

## Rendering and connected application checks

Fifteen entry surfaces were inspected through the in-app browser: Home, ID, DNS, Desktop, Browser, Boost, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, Growth and Computer. An API/asset sweep passed 14 of 15 initially; AMO timed out at 20 seconds, then a bounded fresh retry passed in 14.145 seconds. The original `ok:false` sweep remains preserved. An earlier sandbox-wide fetch failure is explicitly environment-qualified rather than attributed to production.

The human completed the connect-only UniSat prompt. Account `1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH` has zero WORK, 546 POWB, 1,092 proofs and two UTXOs. No transaction/signature prompt was sent. This account verifies actual-zero and last-verified wallet rendering; it is not a positive-WORK acceptance fixture for AUD29-04.

| Surface / behavior | Observed result and limit |
| --- | --- |
| Computer Inbox / Incoming / Sent / Outbox | 23 / 0 / 11 / 1, with chain transaction/thread links |
| Dropped Outbox | `8e9074486fa0a6a75fd01f20c8a41a56ccd964be569e61e81e92c60266c001f0` displays Dropped, Check TX and Rebuild Draft; no rebuild clicked. AUD27-01 rechecked on this account |
| Computer Files / Browser welcome | Cached 1,017-byte form reproduced AUD28-04; Files refresh showed correct 1,018-byte hash. Browser chain payload also shows the exact 1,018-byte fixture. Six attachments independently verify; lossy database bodies remain open |
| Desktop owned Files | Correct visible count/toast for the four-file fixture; dated historical welcome copy is retained as history |
| Computer IDs | Three related IDs = two owned (`satoshin`, `armyofyouth`) plus routed `bitcoin`, with owner distinction. Sidebar refresh reconciles count. IDs remains isolated from AMO |
| Pending ID | `ross` transaction `cfdb34b0000beda563ae59e1665c97b32ae5f6d3fa087efa9e549551b0b6515c` has correct pending date/status. Registry shows 508 confirmed / 20 pending |
| DNS | 23 roots / zero pending; `work.pow` search returns the correct one root. Account has no root; child writes disabled. Root management lives in AMO |
| Boost | Six `$WORK` search results, preserved timeline/back behavior and exact seven-WORK proof-value fixture |
| Credit | DRAIN 110,000 of 21,000,000; 110 mints, two holders and 1–25/110 history pagination; 236 non-bond credit directory |
| Wallet / WORK | Observed zero WORK, 546 POWB, 1,092 proofs. Refreshing/spendable verification states are explicit; preparation controls remain disabled without ready terms |
| AMO / Computer AMO | Eventually Ready with 238 definitions, 236 non-bond credits, 1,008 credit listings + one bond = 1,009; 1,007 WORK. Snapshot height 969621 carries explicit age, approximately 483 seconds at one observation and 925 seconds later. No fresh signing preflight attempted |
| Infinity / Inception | 476 POWB chart points and 47 INCB mints; fixed H−1 provenance shown. Full-history actions time out and retain qualified verified previews; no false complete/empty-book claim |
| Log | One captured global result is 26,316 = 26,294 confirmed + 21 pending + one other; a later exact welcome search returns one confirmed / zero pending. These are view/catalog scopes, not the full relational event count |
| Growth | Exact WORK accounting agrees; 94 global sales versus 90 credit-only sales are scoped. Forecast assumptions remain explicit |

The welcome chain-byte SHA-256 is `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`. Its sandboxed browser iframe exposes no privileged permissions in the inspected source. Three Computer Files entries and two governed file-attachment summary entries describe different scopes. Historical welcome text was not rewritten to current totals.

These checks prove captured interface behavior, not every address, pagination path, positive wallet, human transaction review or visual state. Long AMO hydration, unavailable ID semantic audit and bond-book history timeouts keep the existing availability work open.

## Previous issues rechecked

| Existing issue / lineage | Current recheck |
| --- | --- |
| AUD29-01 accounting VM fixtures | Remains resolved for tested accounting fixtures; 17 math gates pass |
| AUD29-02 Desktop toast | Remains resolved in the four-file visible fixture |
| AUD29-03 pending ID time | Remains resolved in strict parity and the visible `ross` pending fixture |
| AUD29-04 AMO readiness/ownership rendering | Source and actual-zero connected account rechecked; positive-WORK acceptance still unproved |
| AUD27-01 dropped Outbox | Fixed behavior rechecked for the connected account and exact dropped tx |
| AUD28-04 mail bytes | **Open**, now quantified across all 619 confirmed rows: 16 lossy bodies. Refreshing Files improves that view but does not repair database loss |
| AUD28-C02 DNS supply | Correct 23-root UI and coverage summary rechecked |
| AUD29-R01 / R02 | Original 23 missing artifacts remain; maintenance initiator/attribution remains unproved. No incident reset or blanket retirement exemption |
| H24-01/02/03, AUD26-02/03, PERF27 availability/payload/pending lineage | **Open**: bounded logs, initial ledger/marketplace 503, ID audit and full bond-history timeouts; no duplicate new issue ID |
| H8-05 / H10-02 transition growth | **Open**: 39.58 GB DB, 96.736% transition relation; capacity recurrence risk persists |
| H18-06 physical integrity / PITR | **Open**: no physical certification or active WAL recovery path; latest dump checksum/catalog pass is narrower |
| H20-01 container log rotation | Configured 25 MiB × four JSON log files, healthy containers; nginx logs still separately occupy 779,411,456 bytes |
| H5-03 / H10-03 / H18-04 and H24-04/05/06 release/inventory lineage | 28 checkouts exceed nine; fresh runtime attestation fails Git-index mode. Qualified possible audit refresh prevents attribution; source/archive checks pass separately |
| AUD28-FU-02 backup caps / recovery | Installed caps corrected; restore, progress and recovery assurance remain open |
| H9-03 / H24-08 and September 26 canonical marker repairs | Previously repaired markers remain exact; optional alias assertions are qualified, four OP_13 forms remain historical non-push carriers |
| Treasury, refund, bounty and held recovery records | Prior byte bindings preserved; no new financial or recovery-completeness certification |

The preceding log chain was reviewed before production checks. Dated historical notes and earlier protocol forms remain useful for replay and accountability; no obsolete tracked note was conclusively identified solely from age. Newly observed details under established issues are recorded here as rechecks/expanded scope, not duplicate fixes.

## Cleanup inventory and items requiring approval

**No production cleanup was performed.** Existing immutable recovery holds and explicit approval boundaries apply. Candidate evidence is concrete and reviewable; it does not revoke these obligations.

Ten older UI rollback roots total **2,546,733,056 allocated bytes**. Ten older managed archives total **1,986,043,239 apparent bytes**, with exact checksum/provenance and sidecar paths. Combined this is approximately **4.533 GB of candidate material**, mixing allocated-root and apparent-archive measurements; it is not guaranteed recovered free space. All candidate non-release passthrough content matches the retained tree. Bounded open-FD, process command/maps, systemd/Caddy and mount-reference searches found no live references. A fresh locked full fingerprint/dependency/hold check and separately approved exact manifest remain necessary.

| Older rollback root (under `/var/backups/proofofwork-ui/rollback-roots/`) | Allocated bytes |
| --- | ---: |
| `proofofwork-www-pre-04927c291bf4-20261001T150448Z` | 234,504,192 |
| `proofofwork-www-pre-527e4cbaa66f-20261001T062733Z` | 430,469,120 |
| `proofofwork-www-pre-53b5b428e864-20261001T201028Z` | 234,627,072 |
| `proofofwork-www-pre-835e30258d23-20261002T052338Z` | 235,651,072 |
| `proofofwork-www-pre-d2636f6fb3c5-20261002T023421Z` | 235,466,752 |
| `proofofwork-www-pre-d4d888757a1c-20261002T013828Z` | 235,397,120 |
| `proofofwork-www-pre-dbfa88b95819-20261001T134456Z` | 234,381,312 |
| `proofofwork-www-pre-df4d56da93ce-20261002T042258Z` | 235,651,072 |
| `proofofwork-www-pre-ed838d5c8691-20261001T210406Z` | 234,934,272 |
| `proofofwork-www-pre-f81ae55bf4b0-20261002T031600Z` | 235,651,072 |

| Older archive (under `/var/backups/proofofwork-ui/releases/`) | Apparent bytes |
| --- | ---: |
| `proofofwork-ui-release-04927c291bf4-20261001T150448Z.tgz` | 198,396,223 |
| `proofofwork-ui-release-527e4cbaa66f-20261001T062733Z.tgz` | 198,317,252 |
| `proofofwork-ui-release-53b5b428e864-20261001T201028Z.tgz` | 198,478,642 |
| `proofofwork-ui-release-9d46289661d5-20261001T023414Z.tgz` | 198,308,535 |
| `proofofwork-ui-release-d2636f6fb3c5-20261002T023421Z.tgz` | 198,808,742 |
| `proofofwork-ui-release-d4d888757a1c-20261002T013828Z.tgz` | 198,759,197 |
| `proofofwork-ui-release-dbfa88b95819-20261001T134456Z.tgz` | 198,352,698 |
| `proofofwork-ui-release-df4d56da93ce-20261002T042258Z.tgz` | 198,814,335 |
| `proofofwork-ui-release-ed838d5c8691-20261001T210406Z.tgz` | 198,990,445 |
| `proofofwork-ui-release-f81ae55bf4b0-20261002T031600Z.tgz` | 198,817,170 |

The exact candidate archive hashes, sidecars, root manifests and fingerprints are in `vps.uiRecovery`. Keep current release 265 and the prior 835 rollback/archive. Removal should be individually attested against this manifest and a freshly verified retained recovery path; do not run a broad age-based purge.

Node scratch, 28 source checkouts, older replay/restore/backup domains, logs and caches remain operator-review inventories. Do not count the live Core database, active final-source replay, last restore-proven dump, missing-archive reconstruction triggers or held incident artifacts as obsolete storage. Same-volume relocation is not free-space recovery. No arbitrary reduction of canonical events/transitions is proposed.

Separate approval is required for these concrete follow-up scopes:

1. **AUD30-01:** exact fee-rate arithmetic and independent preparation acceptance tests; source/build/deployment scope must be described before editing.
2. **AUD30-02:** narrowly expose host scratch read-only to retention services, test the actual namespace and reconcile relocation/retirement receipts without weakening holds.
3. **UI capacity:** approve a fingerprint-bound retirement manifest for the ten roots and ten archives after retaining and qualifying the immediate prior recovery path. Decide long-term one-prior-release retention so deployments do not recreate the same accumulation.
4. **AUD29-R01/R02 and six managed node paths:** reconcile custody and approved-retirement lineage, including preserved historical gaps; no broad exemption or silent reconstruction-as-evidence.
5. **Existing mail loss:** byte-preserving parser/projection changes and an approved bounded projection rebuild, preserving all chain payloads and evidence.
6. **Existing availability and assurance:** bounded ID semantic recovery, positive-WORK acceptance, complete bond history, isolated latest-backup restore/PITR design, and Git-metadata permission diagnosis/repair with prior state captured. Replays, restores and production service actions need their own explicit scope.

Prioritize UI reserve/scratch protection and fee correctness first, then monitoring reliability, existing ingestion/availability issues and recovery assurance. No recurring task was created; scheduling was not requested.

## Actions, reproduction and handoff

Actions taken: reviewed mandatory documents and previous findings; ran bounded host/database/log inventory and read-only chain/SQL checks; independently parsed the entire captured indexed confirmed transaction population; verified current and prior UI bytes and latest logical backup checksums; ran independent math/source fixtures and existing gates; inspected all listed browser surfaces and the human-connected Computer; prepared this sanitized evidence and report. Temporary local audit fixtures did not sign or broadcast.

To reproduce portable math evidence, read `embeddedArtifacts` with Python, base64-decode and gzip-decompress each entry, verify both byte size and SHA-256, and save under its basename in a fresh local directory. Then run:

```text
node math-independent.mjs /path/to/ProofOfWork.Me /path/to/output/source-math-result.json
python3 math-live.py /path/to/math-snapshots.jsonl /path/to/math-numeric-rows.jsonl /path/to/output/live-result.json /path/to/output/live-checks.json
```

The source verifier requires the bound source revision/dependencies; it intentionally records the fee defect rather than fixing it. Numeric JSON rows must use exact Python integer parsing; JavaScript `Number` can round the quantities being audited. Embedded population/SQL procedures document read-only verification, but live execution still requires reviewing production load, access and authorization. The evidence does not contain a full chain export or all original temporary captures.

Handoff verification: companion JSON parses and matches the report's checksum/size; all **20 embedded artifacts** decode to their exact size/hash; all **75 prior evidence bindings and eight reviewed documents** remain unchanged. Independent review checked findings, prior issue separation, approval/hold boundaries and sanitized evidence. The decoded source verifier rerun reproduces all 10,000 vectors, 15 rejected boundaries and 6,000 round trips, including the unchanged fee defect. Decoded live inputs rerun **22,581/22,581** assertions successfully. Reproduction therefore works from this portable artifact, rather than depending on undocumented temporary inputs.

Repository hygiene review found no behavior/protocol/product/operating-memory change to reconcile into `SOUL.md` or canonical documents. Historical notes, generators, ledgers, refunds and release evidence remain preserved. Both new artifacts are classified as protected audit evidence. `npm run hygiene:fix` reports **no allowlisted rebuildable state found**, so it removed nothing. `npm run hygiene:check` passes. Final diff/status review confines this update to the two new audit files and their two inventory entries, with no deletion, staging or commit. No deployment or production correction is part of this approved audit-log update.
