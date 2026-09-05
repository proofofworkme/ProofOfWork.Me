# Production health, data, event, and storage audit 5

Date: 2026-09-05. Production observations: 06:54–07:19 UTC.
Mode: read-only production inspection plus the user-approved audit record.

The confirmed accounting checks passed within the coverage below, but the application is **not fully healthy**. The main outstanding items are UI disk runway, false zero bond metrics during loading, broken scheduled node release retention, and the existing Boost precision path. One historical auxiliary transaction also has incomplete normalized details. No canonical balance corruption or missing canonical Log event was demonstrated.

No production file deletion, service restart, permission/configuration change, replay, migration, backup creation, commit, push, or deployment was performed. Local temporary evidence was created. The final repository changes are this audit, its compact evidence receipt, and their hygiene classifications; the mandatory local hygiene pass is recorded below.

## Audit continuity and scope

All 13 preceding files in `audits/` were reviewed, including remediation and release addenda. The companion evidence receipt inventories their exact paths and SHA-256 hashes. Relevant anchors are:

- [August 23 audit](2026-08-23-read-only-health-data-event-ui-audit.md), [August 28 audit](2026-08-28-production-health-data-event-audit.md), and [August 30 audit](2026-08-30-production-health-data-event-storage-audit.md).
- [August 31 audit 2](2026-08-31-production-health-data-event-storage-audit-2.md), [node retention manifest](2026-08-31-storage-retention-node-manifest.md), [UI retention manifest](2026-08-31-storage-retention-ui-manifest.md), [database cleanup 2C](2026-08-31-postgresql-retention-remediation-2c.md), and [backup retention 2E](2026-08-31-postgresql-retention-remediation-2e.md).
- [September 1 audit 3](2026-09-01-production-health-data-event-storage-audit-3.md), [September 2 audit 4](2026-09-02-production-health-data-event-storage-audit-4.md), and [September 3 UI audit and release addenda](2026-09-03-read-only-ui-ux-audit.md).
- [September 4 AMO recovery and subsequent releases](2026-09-04-amo-indexer-recovery.md) and [September 5 Growth release](2026-09-05-all-product-growth-release.md).

The old database cleanup, keep-seven logical retention, ID replay fixes, complete AMO book authority, immutable seal identity, and local `check:live-data` repair are not reopened as new defects. Computer now embeds Boost successfully, resolving the separate September 2 integration absence; Boost precision remains open. Historical V7 designs, audits, refunds, H-1 evidence, transitions, release archives, and deliberate rollback material remain useful evidence, not stale files merely because of their age. The ID audit's 17 historical refund candidates are not 17 newly established unpaid debts; consult [ID_REFUNDS.md](../ID_REFUNDS.md) and [TREASURY_LEDGER.md](../TREASURY_LEDGER.md) before any refund decision.

Local source was clean at `0f78b14d48a101bc4e22c6177d6f2bbacb09cc76`, branch `growth-all-products-2026-09-05`. Node and UI application source remained `6a7d5c12e403e0ddb6247fa2a6865cb70d623a8e`. Later local commits record deployment tooling/evidence. Production audits used the running API's environment without printing credentials and the pinned Node 24.18.0 runtime. Local contracts used Node 22.23.2. Both report Unicode 17.0.

## Confirmed state, exact accounting, and pending observations

A coherent fresh read at 07:07:14–07:07:30 UTC returned HTTP 200 for health, consistency, WORK floor, Growth, Infinity, and Inception:

```text
height       965581
block hash   00000000000000000000a65290cc47f31ada78726648f0634b1988aec1591b7d
snapshot     ecd96e2078f27770d280243b
lag          0
consistency  green; 23/23 checks; missingLogEvents=[]
```

All five summary/consistency responses shared this snapshot and height. Sixteen additional checks passed, including exact integer assertions: snapshot agreement, WORK/Growth exact equality, integer floor division, base-plus-credit decomposition, credit fixed-plus-movement decomposition, POWB supply/value/fee reconciliation, and INCB direct/attached issuance, frozen value, dust, and floor reconciliation.

Exact values at that checkpoint:

| Quantity | Exact value |
| --- | ---: |
| WORK supply, subatoms | `210000000000000000000000` |
| WORK supply, WORK | `21000000` |
| WORK holders | `354` |
| WORK/Growth live network value, Q8 | `813148268234266354863291054` |
| WORK/Growth live network value, proofs | `8131482682342663548.63291054` |
| WORK floor, Q8 | `38721346106393635945` |
| WORK floor, proofs per WORK | `387213461063.93635945` |
| POWB confirmed supply | `630496569` |
| POWB network value, Q8 | `63050039100000000` |
| INCB confirmed supply | `224847713398447926` |
| INCB fixed issuance value, Q8 | `22484771339844794793582060` |
| INCB direct issuance units | `27386` |
| INCB attached-WORK issuance units | `224847713398420540` |
| INCB cumulative unissued dust, Q8 | `2193582060` |

The exact integer/string fields are the evidence. Approximate JSON number aliases such as `networkValueSats` are not used to establish these equalities. Cumulative INCB dust can exceed one proof because individual issuance records round down separately; it must not be minted by flooring a cumulative total again.

The database-wide balance query found 403 balance rows across 362 addresses, zero negative balances, zero fractional stored integer balances, and zero nonzero pending deltas. No capped credit's summed holder balance exceeded its definition's cap. WORK's holder sum exactly equals its maximum. POWB and INCB holder sums match the exact supplies above.

The first direct Core sample was main chain, unpruned, verification progress 1, IBD false, no warnings, with transaction, coinstats, and basic-filter indexes synchronized. Electrum and the relational scan matched Core when ready. The node advanced from 965577 through later checkpoints during the audit; snapshot differences across separate runs must not be treated as equal-height data discrepancies.

### Complete stored event and address projection checks

The converged `audit:computer-events` run completed at 07:01:54 UTC with all 49 checks passing, no failures and no warnings:

| Stored evidence | Count |
| --- | ---: |
| Transactions | `25132` |
| Confirmed transactions | `24876` |
| Pending transactions | `48` |
| Dropped transactions | `208` |
| Events, all statuses | `25765` |
| Confirmed valid canonical activity events | `25219` |
| Confirmed valid action txids | `24577` |
| Confirmed credit definitions | `238` |
| Credit listings, all lifecycle states | `845` |
| Confirmed IDs | `505` |
| Confirmed mail items | `614` |
| OP_RETURN detail rows | `25000` |
| Event participants | `126317` |
| Event references | `54188` |

Every confirmed event joined its confirmed transaction with matching parent position; every confirmed transaction had raw data and a canonical block. No event payload/relational status mismatch was found. Different row counts above describe different entities and include invalid/audit history where indicated; they are not interchangeable public totals.

Whole-table semantic parity found exactly 126,317 expected/observed participants and 54,188 expected/observed references across all 25,765 events, with no missing or extra rows. The mail projection matched all 615 expected rows across statuses, with no missing, extra, duplicate, or mismatched content; this includes 614 confirmed rows and one dropped row. Confirmed registry records, listings, sales, and activity semantic comparisons also passed.

At 06:56 UTC, all 5,957 recorded AMO transitions from 959621 through 965577 were contiguous in height, previous hash, and opening/previous-closing value. All had complete, block-atomic, fee-once, and invalid-zero flags. This validates the stored transition chain; it is not a fresh independent re-execution of every historical block.

### ID replay

The protected loopback ID audit completed at 07:04:11 UTC:

- 563 fetched registry transactions: 561 confirmed and two observed pending.
- Exact Core-ordered canonical lifecycle parity verified.
- 535 lifecycle events, 505 confirmed winners, six active listings, four canonical public sales.
- 524 registration attempts, two pending candidates, 17 historical refund candidates, zero pending-watchlist entries.

Confirmed membership was checked against the complete registry address history and Core replay. Pending coverage proves the fenced observed set, not universal discovery of every Core mempool transaction. Pending IDs remain observations rather than routable ownership.

### Mempool and dropped-state verification

At 06:56:41 UTC, two Core samples fenced the stored pending-row query at the same height/hash, 965578. Both contained 41,038 txids with identical sorted-set SHA-256:

```text
faf1aca87244047b4d9897454236b3e73adee29fa0ea420a56781e4854d0c1cf
```

All 48 persisted pending txids were present in both samples. No stored dropped/orphaned txid was present in both. Of these pending transactions, 45 had WORK events; all passed the complete typed five-field inspection-marker check, with no unresolved recovery flag or terminal-invalid/valid-projection conflict. The health samples reported zero global and Q16 unresolved pending events. Invalid transactions may remain in the node mempool and audit history; that does not authorize a balance change.

This proves stored pending membership and classification at that fence. The bounded scanner does not claim to inspect all approximately 41,000 unrelated mempool transactions in one cycle, and mempool truth can change after the fence.

## Findings and follow-up scopes

These IDs are stable references for the next audit. “Carry-forward” links an existing issue family rather than counting another independent defect.

### H5-01 — UI storage runway remains too narrow (high; carry-forward)

The UI filesystem was 72% used with 11,050,835,968 available bytes: 10.29 GiB, only 313,417,728 bytes (299 MiB) above the enforced 10 GiB deployment minimum. It is serving and not full. A routine stage or preservation copy can nevertheless cross the gate. Preserve the floor.

`/var/tmp/proofofwork-deploy` occupies 7,319,408,640 bytes (6.82 GiB); `/var/backups/proofofwork-ui` occupies 15,986,339,840 bytes (14.89 GiB). This is the same growth trajectory recorded in audits 2–4 and the September 5 release, not a new disk-full incident. The marker-based scratch cleaner succeeded but found zero candidates in its own scope. A separate three-day tmpfiles rule does not guarantee enough capacity during several deployments inside that window.

Next scope: classify exact non-live transport/extraction groups, preserve current and immediate rollback provenance, reclaim approved duplicates, and make scratch retention capacity-aware. The three verified candidates below reclaim only 413 MiB; that is a first step, not a durable solution to multi-GiB growth.

### H5-02 — Bond pages display false zeros after receiving correct summaries (high; newly isolated surface defect)

In the same browser tab, after `response.json()` returned a successful nonzero bond summary, the overview still labeled supply, floor, and network value as zero and claimed the chart would appear after confirmed events indexed:

| Surface | Valid summary received | Nonzero supply in that response | Time from summary to correct DOM |
| --- | --- | ---: | ---: |
| Infinity | 07:06:21.517 UTC, height 965580 | `630496569` POWB | `19443 ms` |
| Inception | 07:06:47.119 UTC, height 965581 | `224847713398447926` INCB | `25302 ms` |

The timestamp differences above include the initial screenshot; the subsequent measured waits were 19,049 ms and 24,942 ms. Both eventually recovered to the exact API amounts with no JavaScript exception. Earlier first-look/longer-dwell passes showed the same symptom, including Infinity still showing zeros after roughly 45 seconds from navigation. This is a presentation delay, not lost issuance.

Source: `src/App.tsx` invokes `refreshInfinity(true, false, activeBondConfig)` around line 24888. `refreshInfinity` fetches the summary around 26674, awaits `tokenStateWithCurrentCompleteBondListings` around 26679, and applies the summary only around 26700. The helper around 21424–21446 fetches the complete global listing book before filtering the bond token. The observed book had 603 entries across four pages. `InfinityApp` around 36378–36401 substitutes zero for absent summary state, and the overview/chart renders those defaults as confirmed facts. The silent initial refresh leaves a generic ready/connect-wallet strip.

Next scope: publish an authoritative bond summary independently of listing-book hydration, represent unavailable/loading values explicitly, and keep listing completeness and wallet spend authority guarded. Test standalone and shared Computer bond components. Do not change issuance, floor, or historical values to fix this display.

Evidence: `pow-20260905-bond-render-proof/evidence.json`, SHA-256 `97d371a700d5cfdc5b684ab2d42c17892dea13abe83adf70bc79b793847e8bf2`, plus the same-tab zero/recovery screenshots identified in the receipt.

### H5-03 — Scheduled node release health/pruning cannot inspect the live checkout (high operational priority; existing failure, newly reproduced cause)

The scheduled node release-health and prune units failed with “not a git repository.” Both run as root with an empty capability bounding set. The live `.git` is private to `powadmin` (directory 0700; HEAD 0600). Ordinary sudo Git identifies the checkout; the identical read under `sudo setpriv --bounding-set=-all` fails. Direct root success does not prove the scheduled sandbox works.

The read-only direct verifier checked all 11 archives and provenance records, zero unverified archives, and one matching current release. Its remaining warning is 20 retained checkouts versus the limit of nine. The September 5 release already records this inventory excess. Historical candidate/recovery failures are separate old one-shots, not current API/Core crashes.

Next scope: repair the intentional helper/service access model and classify retained checkouts. Preserve private Git metadata, canonical source attestations, current rollback, and historical release evidence; do not broadly loosen permissions or reset failure markers as a substitute for repair.

### H5-04 — One historical auxiliary spend has incomplete normalized details (medium; newly recorded data gap)

```text
txid  4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359
block 962992, transaction index 1161
hash  00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b
```

Core and stored raw data contain six inputs and two outputs; normalized tables contain only five inputs, all five without value details, and no outputs. It is an existing five-listing-anchor-spend fixture, sourced from `canonical-listing-outpoint-scan`. First seen August 18; last updated August 23. Its OP_RETURN is not a ProofOfWork application carrier; no own application event is expected. The five original anchor links remain available.

Current source already persists complete detail rows and hydrates prevouts; the older sparse writer retained only known anchor-spending inputs. This appears to be historical data left after those source repairs. It does not demonstrate a lost canonical event or incorrect WORK value: the fee/value event reader selects valid economic-event txids, and this transaction has no own event rows.

Next scope: audit and, after approval, apply the existing exact-txid canonical-detail repair to this single transaction. Prove all six inputs/two outputs against Core, preserve the five spend links and unchanged event/economic/H-1 fingerprints, and rerun the multi-anchor closure regression. No broad replay is justified by this observation.

A second raw-carrier query hit, `0b3129a34902319813887fd76b4c095ce91b99d02bc24b16ecf19a34fc38a5f2`, is an expected synthetic sale-close companion: close tuple vout 1 and sale tuple vout 2 reference listing `9b21a716be871f944aa194e5a263bdd16e8b534bacbcc80ef3efee7d0f90cb61`. An empty raw payload at the synthetic close tuple is not a missing physical OP_RETURN and must not be “repaired” by inventing one.

### H5-05 — Boost display and ranking still discard exact precision (medium; September 2 carry-forward, expanded server evidence)

`BoostRoot.tsx` around 165, 207, 222, and 1422 formats/adds approximate values despite available exact fields. Server `proof-api.mjs` around 51325, 51384, and 51409 converts Q8 signal to `Number`, stores `valueRank`, and subtracts approximate ranks.

A reproducible counterexample using the unchanged functions:

```text
exact Q8 lower:  900719925474099200000001  (newer)
exact Q8 higher: 900719925474099200000002  (older)
both Number ranks: 9007199254740992
observed comparator: lower-newer first
exact ordering:     higher-older first
formatProofs("9007199254740993") -> "9,007,199,254,740,992 proofs"
```

The two current production posts ranked and displayed correctly in the sampled small-value case. This is a demonstrated precision defect for valid larger inputs, not evidence that current confirmed WORK accounting is corrupted. Next scope: rank, aggregate, and format from exact Q8/string fields; keep deliberate chart/display rounding separate from authority.

### H5-06 — Exact-tip convergence still interrupts reads and broad audits (medium; carry-forward)

Multiple new blocks arrived during this audit. Fresh registry, token, wallet/listing, and summary reads returned explicit 503 errors rather than silently publishing stale authority. One worker cycle at 06:58:41 deferred because Core advanced from 965578 to 965579, counted one failure, and waited its normal 60-second retry. The next scan reached 965579 at 06:59:48; the summary was published at 07:00:05 and health was green by 07:00:15. No service restart was required.

The 102-check parity runs each returned 99 passing checks, one current-registry checkpoint error, and two historical V5 readiness warnings during a moving checkpoint. The stored migration itself was complete. The first run compared summary height 965577 with current registry height 965578; the later run began with summary 965580 and advanced relational state. Whole-table event/participant/reference/mail semantic checks passed in those runs. Do not call the overall parity command green.

The later full marketplace run also required three wallet-summary retries while the surrounding successful samples remained at height 965581. Do not attribute every wallet 503 to a new block: wallet read/convergence failures need their own diagnosis even when global health is ready.

Next scope: improve convergence latency and make audit checkpoint transitions explicit while preserving exact-tip admission and fail-closed behavior. Do not solve test failures by accepting stale signing authority, permitting a partial listing book, or masking unexpected 503s.

### H5-07 — UI crash-storage controls differ from the documented policy (low; new configuration drift)

The node has `core_pattern=|/bin/false` and masked Apport. The UI instead has enabled/active Apport, its handler in `core_pattern`, and no `/etc/sysctl.d/99-proofofwork-no-coredumps.conf`. The UI differs from the documented production crash-storage controls. Caddy's `LimitCORE=0` is set and the UI crash directory is empty, so this is not the current storage growth cause. Reconcile the UI configuration in an approved operations change.

### Other carried-forward items

- **Strict WORK atom audit still fails on exactly three known invalid zero seal records.** The explicitly named read-only repairable mode passes and classifies them; the strict command must not be reported as passing. Txids: `6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c`, `8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc`, and `9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0`. All are confirmed invalid duplicate-seal attempts with zero economic contribution, lacking exact zero-unit metadata. There are zero unrepairable missing-unit rows, malformed atom/subatom values, mixed scales, or exact-value mismatches. The audit covers 23,400 amount-bearing rows: 22,103 Q8, 1,294 Q16, and these three exceptions.
- Active/pending oversubscribed-seller count is zero. The raw sealing-inclusive diagnostic is six, versus five in audit 4; it includes unreconciled historical lifecycle rows and is not a complete Core-reconciled spendability proof. Do not use it alone to change balances. Canonical readiness and executable listing authority remain the separate checks.
- `check:send-prep-regressions` still fails its `armyofyouth` fixture assumption: expected at least one confirmed UTXO, observed zero. This is carried forward from audit 4 and the September 4 release; it is not demonstrated general send arithmetic failure.
- Public `nft.proofofwork.me` DNS remains an existing compatibility-host limitation. Previously verified direct-origin TLS success is not public DNS success.
- Growth still breaks a long exact number arbitrarily across lines in its narrow card at 1440px. The text remains exact and there is no document overflow, but readability remains below the numeric presentation contract. This carries forward the earlier numeric-layout issue family. WORK's headline exact-value controls now contain the value correctly; a chart high label still rounds at the floating plotting layer.

## VPS, database, logs, and backups

| Host/mount | Used | Available | Inode use |
| --- | ---: | ---: | ---: |
| Node `/` | 24% | `76319584256` bytes | 6% |
| Node `/data` | 73% | `461007876096` bytes | 1% |
| UI `/` | 72% | `11050835968` bytes | 7% |

No deleted-but-open file over 100 MiB, RAID member failure, recent kernel I/O/filesystem error, OOM, or physical-interface error/drop was observed. Node RAM availability was about 117.6 GB of 134.1 GB; UI about 3.36 GB of 4.01 GB. Core, Electrum, PostgreSQL, API, worker, WAL receiver, and Caddy were active. Live services reported systemd `NRestarts=0` at the sample; this does not count every manual start.

PostgreSQL 16.15 held one production-sized database, `proof_indexer`, at about 20 GB. The largest relation was the 19 GB canonical transition table, followed by 818 MB of ledger snapshots. These are replay/evidence state, not approved cleanup targets. Invalid/not-ready indexes, unvalidated constraints, lock waiters, idle-in-transaction sessions, and recorded deadlocks were zero in the sample. Autovacuum/analyze had run on hot tables; dead tuples were present, not a corruption signal. The WAL receiver slot was active with about 14 MB retained at the query. The `temp_bytes` statistic is cumulative query spill, not live occupied filesystem space. The current summary payload metric was 15,412,031 bytes measured as PostgreSQL JSONB text. Its source defaults are an 18 MiB SQL read ceiling and a separate 16 MiB compact-JSON writer budget; these encodings are not interchangeable. Keep monitoring growth. The writer rejects an oversized summary rather than truncating evidence.

There was one normalized input/output detail exception (H5-04). Every other confirmed transaction had the expected input/output counts and complete input values; all stored spend links joined their spending input. Among rows with a populated relational fee column and complete normalized inputs/outputs, no fee mismatch or negative fee was found. The optional `fee_sats` column is null on 23,025 canonical-block rows, which still retain raw fee/input evidence; null there is not itself proof of an unaccounted fee. PostgreSQL data checksums are off, so these logical/catalog checks are not a full physical page-corruption verification.

Largest allocated node directories: chain about 972.0 GB, Electrum 63.6 GB, PostgreSQL backups 140.6 GB, PostgreSQL tablespace 20.9 GB, release backups 9.65 GB, recovery evidence 3.79 GB, live API cache 266 MB. Node `/opt` is about 6.85 GB. UI live `/var/www` is about 413 MB, logs 398 MB, and apt cache about 114 MB. Protected UI rollback/evidence, rather than live static serving, dominates its usage.

Journald on both hosts is bounded to 1 GiB persistent use, 10 GiB keep-free, 256 MiB runtime, and seven-day retention. Rsyslog/UFW rotates hourly; Caddy rolls 25 MiB, keeps eight, with a seven-day cap. The sampled 2,358 current Caddy access records parsed without malformed lines and included 23 HTTP 503s; release/audit requests are included, so this is not an end-user error rate. No actual journal suppression or no-space write failure was found. Retention of operational logs is intentional and is distinct from preserving chain/event history.

Database backup checks:

- Exactly seven daily logical sets, August 30–September 5, retain the approved keep-seven policy.
- Latest successful job 03:18:55–03:28:16 UTC; `proof_indexer-20260905T031855Z.dumpset`, dump `11074733418` bytes. Its custom archive TOC reads successfully (202 entries); the installed job verifies TOC and checksums before publication. The installed script exactly matches the inspected source (SHA-256 `bcce62e2d12b1df7d8f10d805c4be24f144132a00aa5aba9491db71cdfa3c960`).
- Physical base backup August 31, with continuing WAL receiver/compression and next weekly backup September 7. Base and WAL form one recovery chain and cannot be independently pruned as waste.
- Last located full restore-validation evidence is August 25. This audit did not restore the latest 11 GB dump or rehash every database-backup byte. No inspected receipt established an encrypted off-host PostgreSQL copy; both current database backup families are on the same node/data volume. This is the earlier disaster-recovery evidence gap, not a claim that an uninspected external copy cannot exist.

UI release `6a7d5c12e403-20260905T050937Z` remained current; its archive SHA-256 is `3294199efbd9d81b8f203ee2da7e71ae714f749f5ff2f85dc2022bae941ee973`. The immediate rollback and the explicitly offloaded historical classification archives/receipt from the September 5 release remain protected. Direct node provenance verified 11/11 archives; scheduled-service failure is H5-03.

Network counters (since boot/interface reset, not billable monthly totals): node RX `1223594799961`, TX `9765657925450` bytes over approximately 118 days; UI RX `930845548157`, TX `128604087325` over approximately 120 days. vnStat and provider billing/quota counters were unavailable; monthly allowance was not verified.

## Reviewable cleanup candidates — no production deletion performed

All paths below are under `/var/tmp/proofofwork-deploy/` on the UI VPS. Each archive matched its checksum sidecar, remained stable during the read, and every archived regular file matched a retained extracted tree of the same basename. These are old transport copies, not the active source or immediate rollback release.

| Candidate | Bytes | SHA-256 |
| --- | ---: | --- |
| `proofofwork-ui-surfaces-d13e9cad67e9-20260901T230747Z.tgz` | `175832501` | `6a2dcac74f5c745d91529b949dfc1187db65f4a579e8dbcb53c9d9d1a80206f8` |
| `proofofwork-ui-surfaces-c2396ce9c3ea-20260902T005518Z.tgz` | `175830884` | `6380420c7494aecb72cbb0e3c5adba516a5a054d14952cbb47b97b3c56983d51` |
| `proofofwork-ui-source-c2396ce9c3ea-20260902T005518Z.tgz` | `81677086` | `b201c5d3c45a11b891b7cb96190e1a7513393886a29ecf928ab090d9c600f1db` |

Total: `433340471` bytes, about 413 MiB. Before approved removal, recheck identities, checksums, live/rollback references and the preserved duplicate, and retain the small evidence/sidecars. The extracted duplicate is itself temporary scratch, not a durable disaster-recovery backup. Larger scratch and historical rollback groups still require release-specific preservation decisions.

Do not delete `proofofwork-ui-source-d13e9cad67e9-20260901T230747Z.tgz` as a proved duplicate: its extracted `.git/index` differs. This is historical metadata, not observed live corruption. Preserve it pending classification. No current cache, chain data, transition, H-1 oracle, refund/treasury record, database backup, release archive, or rollback root was nominated for blind deletion.

Repository `AGENTS.md` requires explaining exact changes and explicit approval before production mutation. The user approved this audit log; that does not authorize executing the proposed repair/configuration/deletion scopes above.

## Verification results and coverage limits

| Gate | Result | Evidence/qualification |
| --- | --- | --- |
| `audit:computer-events` | PASS | 49/49; completed 07:01:54 UTC |
| `audit:ids` | PASS | Full registry lifecycle replay; completed 07:04:11 UTC |
| Consistency + additional exact checks | PASS | 23/23 consistency checks and 16 additional checks at height 965581 |
| `audit:ledger` | PASS | Exact-tip requirement set to zero lag; snapshot `ecd96e2078f27770d280243b`; completed 07:14:19 UTC |
| `check:mail-regressions` | PASS | All eight named mailbox cases and two self-send history checks; completed 07:10:29 UTC |
| `check:credit-mint-regressions` | PASS | POW `1525100/10101010`, available `8575910`; WORK `21000000/21000000`; both zero pending; completed 07:11:33 UTC |
| `check:work-participant-regression` | PASS | Historical funding-sale, transfer, and INCB participant linkage; completed 07:12:31 UTC |
| `check:marketplace-regressions:full` | PASS with recovered reads | Full historical delist, seal, sale, wallet, and Log close cases; 07:14:20–07:18:52 UTC |
| `indexer:audit-work-atoms` | FAIL — known metadata | Exactly three historical invalid-zero records; strict mode retained |
| `indexer:audit-work-atoms:repairable` | PASS — explicit classification | Read-only classifier, no repair performed |
| `indexer:parity` | FAIL — checkpoint/readiness | Both runs: 99/102 checks passed; one current-registry checkpoint error plus two V5 warnings |
| `check:send-prep-regressions` | FAIL — known fixture precondition | `armyofyouth` had zero confirmed UTXOs |

The full marketplace pass took 272 seconds and included three `CANONICAL_WALLET_INDEX_UNAVAILABLE` HTTP 503 responses for wallet `1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x`; its built-in bounded retry recovered. Earlier event/ID/mail/mint/participant/ledger/fast-market attempts interrupted by checkpoint convergence remain recorded in the receipt. A later successful attempt does not erase them.

The final direct Core/API sample at 07:19:06 UTC fenced the same height/hash 965581 before and after: HTTP 200, ready, zero lag, all three Core indexes synchronized, no Core warnings. Core's changing mempool held 37,728 transactions using 129,756,336 of the configured 2,000,000,000 bytes. This later count does not replace the earlier fenced persisted-pending membership proof.

Production gates ran sequentially against numeric loopback using the live environment and pinned runtime. Final retries first required readiness. `POW_ID_AUDIT_PRODUCTION=1`, `POW_ID_AUDIT_WRITE_REPORTS=0`, and `MAX_LEDGER_TIP_LAG_BLOCKS=0` were set; full marketplace mode was explicit. The receipt retains every attempt's exit status, timestamps, output hashes, check names and relevant excerpts.

Eighteen local script entrypoints (17 npm gates) passed: canonical order; WORK precision/Q16; AMO V5/V6/V7/V8 and V8 gates; bond exact arithmetic; INCB range-replay witness; ID address routing/audit; API truth; live-data; server free identifiers; index recovery; client read containment; worker containment. This includes 502 recovery checks, 131 precision checks, 43 client-containment checks, and an additional 1,007-case exact algebraic probe. V7 tests concern unactivated historical design, not live authority.

Fourteen public surfaces were inspected sequentially, standalone first and Computer last, including the separately checked Boost route. Root pages/assets returned 200; tested 390/1440px views had no document overflow or JavaScript exception. Home's embedded YouTube made Google/YouTube telemetry requests; no public `mempool.space` chain-data dependency was observed. Browser reconstructed the confirmed welcome transaction and 1,018-byte body from the first-party API. IDs displayed 505 confirmed/two pending. WORK displayed exact mint-out and 354 holders. AMO and its Computer view agreed on 601 current WORK listings, 554 buyable, 47 unsealed, zero pending, and 71 confirmed sales at the observed checkpoint. Listing/seal counts are dated observations, not permanent product totals.

The UI evidence above does not establish every account's private localStorage, every wallet extension/signature interaction, physical-device behavior, all historical pagination paths, or all possible inputs. No wallet was connected for signing, no transaction was broadcast, and no on-chain state was changed. Complete participant/reference/mail comparisons cover stored projections; the audit did not rebuild the whole chain into an independent second index. The passing invariant checks and failure classifications support the conclusions here, not a guarantee that future inputs cannot expose another defect.

## Evidence and repository handoff

The compact receipt is [2026-09-05-production-health-data-event-storage-audit-5.evidence.json](2026-09-05-production-health-data-event-storage-audit-5.evidence.json). It records prior-audit hashes, exact arithmetic assertions, gate outcomes, and hashes/paths of larger local captures. Temporary `/tmp` captures may expire; the essential facts, exception txids, checkpoint and cleanup manifest are retained in this audit and receipt. Large duplicated parity payloads/screenshots were not added to repository history.

Semantic review covered `SOUL.md`, the canonical protocol/product/operations documents, the classified note inventory, prior audit addenda, protected ledgers/release artifacts, and the exact cleanup allowlist. Existing protocol rules and operating standards were not changed; production drift and unresolved defects are recorded here instead of rewriting historical evidence. No tracked note was established as safe to delete within this audit's approved scope.

`npm run hygiene:fix` passed and reported no allowlisted rebuildable state. Both new audit artifacts are classified under `ledger-and-audit-evidence` in `repository-hygiene.json`. `npm run hygiene:check` passed, including deterministic generated-artifact verification. Final review is limited to the audit, evidence receipt, and two classification entries. No application source, production configuration, protected evidence, or previous audit was modified; nothing was staged, committed, pushed or deployed.

## Ordered surface audit addendum — September 5, 13:26–13:56 UTC

The user's second audit requested Home → IDs → Desktop → Browser → AMO → Credit → Wallet → WORK → Infinity → Inception → Log → Growth, then Computer last. That sequence was completed. This addendum extends the existing audit rather than creating another competing issue list. All 14 audit documents were reviewed for continuity; the 13 earlier documents remain byte-for-byte unchanged. The pre-addendum SHA-256 of this document is `97b601a9e6673d4f39dd30f06ec9aacd9d335665e72ae3eb49d6a550339c97ea`.

**Result: the sampled canonical arithmetic and raw-chain bindings pass, but the application is not completely healthy.** Live presentation defects remain, five additional source causes are recorded below, and UI disk headroom remains narrow. No production code, configuration, data, services, backups or releases were changed. No transaction was signed or broadcast. Only this authorized audit and its receipt were extended; the original evidence and classifications are preserved.

The local/source and deployed revisions remain those recorded above. The browser was isolated headless Chrome because the in-app Browser reported no available browser. Non-GET/HEAD/OPTIONS requests were blocked; no real wallet profile was used. Request interception disables HTTP caching, so this is not a warm-cache benchmark. Desktop navigation first-contentful-paint samples were 1,092–1,984 ms across the 12 standalone sites; that is not time to authoritative ledger readiness. Every requested root returned HTTP 200, with no recorded page JavaScript exception or outer document/body horizontal overflow at the sampled 1440px and 390px widths. This does not establish that every internal card, zoom level or physical device renders perfectly.

### Ordered page results

| Order / surface | Verified behavior and remaining qualifications |
| --- | --- |
| 1. Home | Expected `www` redirect; 505 confirmed IDs, two pending, 507 total. Mobile application menu fits. Home downloads 491,172-byte cached / 437,704-byte fresh registry-summary bodies to derive three counts. Embedded YouTube's 11 blocked Google/YouTube POSTs were harness restrictions, not application failures. |
| 2. IDs | `CARBONZ` normalizes to the existing confirmed ID; registry search shows its current owner/receiver. `cx` is explicitly pending and not treated as confirmed ownership. Registration-only surface remains separate from management. A broad search may also match addresses; its result count is not a count of exact ID-name matches. |
| 3. Desktop | Pending `cx` is rejected for confirmed routing. `carbonz` resolves to its current address and an empty public file list. A second public address loads `pepe mic drop.jpeg`; its bytes/hash and originating address were independently bound to Core. Resolving one ID fetched the full 2,211,158-byte registry, a bounded point-lookup opportunity. |
| 4. Browser | Invalid txid input is rejected locally. The known welcome txid renders a confirmed 1,018-byte HTML body with matching SHA-256 and a sandboxed, inert preview. Computer later renders the same content/hash. No hostile-page fixture or pending HTML fixture was executed in this pass. |
| 5. AMO | Complete inventory and the selected sealed WORK ticket agree with the node. Observed counts: six ID listings, 236 non-bond credit definitions, 603 credit listings, one bond ticket, 71 credit sales. The complete credit-and-bond listing book has 604 entries; WORK has 602 and DRAIN one. Cold Bonds shows false zero floors after the book is Ready: new H5-12. |
| 6. Credit | Loaded directory shows 236 created/confirmed credits and 128,856 creation proofs. WORK is correctly minted out at 21,000,000, with zero remaining; POW shows 1,525,100 confirmed and 8,575,910 available of 10,101,010. Initial data loading instead claims zero credits / “No credits yet”: H5-02 extension. Two full token reads each decode to 71,429,709 bytes. |
| 7. Wallet | Disconnected controls remain gated. A separate public-address provider harness connects only a synthetic read-only provider and confirms the exact balances/reservations below at 30s and 60s. Early rendering labels gross proofs spendable before reservation data arrives: H5-02 extension. Actual extension protection/signing is outside coverage. |
| 8. WORK | Exact network value/floor match the coherent node snapshot, supply is minted out, 354 holders and 21,000 confirmed mints. Mint history eventually shows 25 of 21,000 with pagination. A fresh floor read returns 503 during a new checkpoint; the UI explicitly identifies verified last-good block 965621 versus current 965622. Preserve this qualification. Approximate chart high differs from the exact headline as already recorded. |
| 9. Infinity | Settled supply 630,496,569 POWB, value 630,500,391 proofs and floor 1.00000606 match exact node arithmetic. H5-02 reproduces: correct summary body completed at 13:49:49.609, but the 13:49:58.804 snapshot still displays zeros while global listing pages load. A later snapshot shows correct values. |
| 10. Inception | Settled issued supply 224,847,713,398,447,926 INCB, fixed cumulative value 224,847,713,398,447,947.9358206 proofs and floor 1 match the node; direct/attached issuance, H-1 provenance and retained dust remain separate. Correct summary body completed at 13:50:32.849, while the 13:50:41.563 snapshot still shows zero: H5-02 persists. |
| 11. Log | Global 25,240 actions = 25,236 confirmed + four pending. Searching the verified seal gives one confirmed seal linked to the correct listing; searching `cx`'s txid settles to one pending registration with the correct 1,000-proof tag. The temporary “No activity” during “Searching” is a loading-state presentation concern, not missing settled history. All four public pending rows were independently checked against Core. |
| 12. Growth | Exact real network value agrees with WORK/node. Switching between revised and original forecasts changes modeled values without changing the confirmed value. Existing arbitrary digit wrapping remains visible at 1440px. Model outputs, USD conversions and chart abbreviations remain estimates rather than chain accounting. |
| 13. Computer, last | Entered at 13:52:30 after all standalone sites. Checked Inbox shell, IDs management, AMO, embedded Boost, Desktop, verified Browser content, Credit, Wallet, WORK, both bonds, Log, mobile More navigation, and the `?growth=1` route. IDs management remains isolated from marketplace actions. Shared exact values and Log totals agree. Cold AMO Bonds reproduces H5-12. Scoped sidebar badges and extra bond choices in Credit need presentation corrections described below. Private mailbox/local account state was not authenticated. |

Navigation screenshots have descriptive labels, not test assertions: Computer's `amo-cold` screenshot still contains IDs after a harness locator timeout; `amo-loaded` and `amo-ready` contain Loading AMO. The subsequent `amo-bonds-cold` capture is the actual Ready marketplace. The Home menu-close and Computer exact-name navigation timeouts were corrected with the appropriate locators; they are not product defects. Computer's mobile More navigation was successfully opened and inspected. Six DevTools response-body cache evictions across Credit, Wallet and Computer concern successful HTTP 200 captures, not failed application reads. ResourceTiming independently records five of those response sizes; the later Wallet response falls outside its resource snapshot window.

### Full-node arithmetic, content and mempool evidence

The focused proof set passes 20 exact snapshot/accounting assertions, 30 selected listing assertions, 19 wallet assertions and 22 content/ID assertions, plus 23 API consistency checks. These overlap in coverage and supplement the earlier production gates; they are not another independent whole-chain replay.

At height **965621**, hash `000000000000000000010ae4d5850bde2787b5445f3a4ed21a23ad0d9f9a4bb6`, snapshot `94ec3717a8419c8a0fda3ba3`, WORK/Growth network value is exactly `813148268234642936311679542` Q8, or `8131482682346429363.11679542` proofs. Floor is `38721346106411568395` Q8. The integer division, exact decimal rendering and base/credit/fixed/movement decompositions agree. The 25,236 confirmed event coverage includes 24,592 distinct transactions and no reported missing fee coverage. This is normalized publisher coverage, not a new raw-fee replay of every transaction. New confirmed actions explain differences from the morning snapshot; comparing unequal checkpoints is not an arithmetic test.

POWB supply/value/floor are `630496569` / `63050039100000000` Q8 / `100000606` Q8. INCB supply/value/floor are `224847713398447926` / `22484771339844794793582060` Q8 / `100000000` Q8. INCB's direct plus attached issuance reconciles; `2193582060` Q8 remains issuance dust rather than whole issued units. Both pending bond supplies are zero. Database inspection at 13:27, height 965619, found 403 balance rows, no negative/fractional balances, no nonzero pending credit deltas, and the WORK holder sum exactly equals `210000000000000000000000` subatoms.

Selected listing `41b3252c04837c03f743c24e6ef6d11d67082f701cc0dc6d9a768830580a35da` and seal `2ae05d93d09247833ee7c6f5b4b94717d53bbb111ab496c2d4f624f117178a2e` bind to raw Core transactions at heights 965551 and 965601. Frozen prefix value `813148268234259249036194922` Q8 yields exactly `645638711` WORK subatoms (`0.0000000645638711` WORK) for the 25,000-proof unit; ceiling division yields the same exact 25,000-proof price. Stored compute-before-bond values agree, and the actual seller signature verifies with SIGHASH `0x83`. The 546-proof ticket at listing vout 2 is unspent with both confirmed-only and mempool-inclusive Core checks. API and AMO display the same exact amount, price and confirmed seal. The indexed immutable prefix value is an input to this focused proof; the complete preceding historical prefix was not independently rebuilt.

For public address `19JE7LS6TtQ4uSxu6ivJVZRiJyXXe8qEG3`, the same 75 confirmed UTXOs appear in API, two Electrum reads and direct Core output checks, totaling 257,310 proofs. All 59 WORK ticket anchors remain present: `59 × 546 = 32214` protected proofs. Exact confirmed WORK is `10000000000000000` subatoms; reservations total `38330685185`; remainder is `9999961669314815`. The later Wallet DOM shows **1.0000000000000000 confirmed, 0.0000038330685185 reserved and 0.9999961669314815 spendable WORK**, with 225,096 native proofs after those exclusions. The provider harness contains no keys and rejects all signing/broadcast methods; no prohibited call occurred. Its 16 remaining native UTXOs are not independent proof of real UniSat-curated spendability or every possible other-asset exclusion.

Raw Core evidence also verifies:

- Welcome tx `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b`, canonical height 949253/index 5230, exactly 1,018 HTML bytes, SHA-256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`.
- JPEG tx `e6ad5d7c10e19bd3e34155061ba05ed4862b2aecf35ae4dc5f59a10aedaf22a1`, height 952390/index 2723, exactly 6,284 decoded bytes and hash `98e75adcc612894c206681ab4eab4e4e5a2fa0b3d07169cc00aaaa57f38b422a`. Its first input's parent binds the inspected Desktop address `bc1q7lvsdf0lpgmvn0c8emj9zvjm0sycn4lu3qrry0`.
- `carbonz` registration at height 949040/index 377 and latest `buy5` `d97557a97a4c9853164ac28fa92b3fa4d7328dd9381ad384e3a009740d86dc45` at height 957408/index 1218 bind its history and current owner/receiver `18xvbj6mpPpYYjWibcqsXdV7SCwBQNrqMW`. Its original registration owner need not equal its transferred current owner. The morning audit owns the full ID replay.

Final Core/API fence at **13:53:12–13:53:19 UTC** remained at height **965622**, hash `0000000000000000000052d8fbfed02e6d391c8ed8d818fe8e5105c583e6e696`, snapshot `48c58b251ab65dfac3df878c`. Health is HTTP 200/ready/zero lag; all three Core indexes are synchronized, IBD false, no Core warnings, and worker consecutive failures and both unresolved-pending counters zero. Nine aggregate final checks and each raw/history binding pass. The four public pending events are:

| Event | Txid |
| --- | --- |
| `cx` registration | `4a70bdef992c8e53d1aba2f2a8b4d55de491f0940f9e4883df06b4c317143977` |
| `fzzfzzz` registration | `d729663829165bf4500e4708fd62dbf00f8012dde9ab4e53b321ce0cfe864cc2` |
| Credit mint, 1,000 ORDI units | `80324e829c5213135a53da8934261a88c981a92d642943e1a4e31c2414866916` |
| WORK seal for `bfa72ce0b830569810876c3297c5e7ff571605289ea317e8466e107f465e1d9a` | `a63de3b551953af5f00ef7d439bcad7da684aaea10b102788c10bbaa384e659d` |

All four txids match raw carriers and filtered Log kinds/tags and appear in both enclosing Core mempools. The full pool changes from 42,196 to 42,213, sequence 22,337,325 to 22,337,342: selected membership is stable, not the entire pool. Mempool memory is 133,589,144 of 2,000,000,000 configured bytes. The separate 48 persisted pending transactions cover a broader scope than four valid public Log events; their difference is not missing Log history. This follow-up does not recheck all 48 memberships.

Computer's three current Boost posts also pass exact amount/order checks: `387759.46106411 + 39267.34610641 + 546 = 427572.80717052` proofs. New post `0c887ed6f7dbe415a2bfd88c1bdcb0c5c1681fee339d64bba644e703c8c759c5` is raw-confirmed at 965601/index 2769; its author, 546-proof signal and `10000000000` WORK subatoms match the carrier, attached `send3`, parent output and displayed text. Twelve aggregate Boost checks pass. This updated three-post observation supersedes the earlier two-post sample only for current counts; it does not close H5-05's larger-input precision defect.

### Existing findings extended, not duplicated

**H5-02 — add Credit, Wallet and scope-aware presentation evidence.** Bond false zeros remain reproducible in both standalone pages. Credit's first snapshot precedes token response headers yet shows zero created credits and “Create WORK first.” `tokenLedgerLoading` is available but only gates the detail view (`src/App.tsx:40311`); root statistics/empty states at 41453 and 41614 ignore it. This is a different pre-response cause within the same loading-state family, not evidence that a received Credit summary was ignored.

Wallet at 13:48:02.661 labels all 257,310 proofs spendable before reservation loading; by 13:48:30.563 it correctly excludes 32,214. The timestamps bound the observation, not its exact duration. `proofBalanceLoaded` is based on UTXO completion alone (`App.tsx:32822`, 38051), while reservation arrays load separately. Both Transfer and List were disabled in that early snapshot. Fresh exact balance/reservation preflight remains present in the transaction builder; no unsafe spend or write-gate regression was demonstrated. Display total once known, but withhold spendable/protected claims until their own required evidence is ready.

Computer's sidebar briefly shows Credit 1 / WORK 0 in a bond scope, then restores 238 / 21,000,000 in Log. The badge reads active scoped definitions (`App.tsx:33496`, 33526), rather than a matching global/WORK summary. Give each badge its own accepted scope or withhold it. The initial empty Inbox with no account is not evidence that authenticated mail is missing.

**H5-06 — retain availability failures and successful recovery separately.** At 13:27:09–21, six readiness/summary reads failed with 503 while Core/scan were 965619 and summary 965618. Replacement generation completed at 13:27:23.457; a later health sample was green. This is not a measured two-minute outage. WORK later displayed an explicitly qualified last-good 965621 snapshot during 965622 convergence; final health is green. Successful loopback summary reads still cost 4.405–10.702 seconds. Improve publication/read latency without accepting stale action authority.

H5-01, H5-03, H5-04, H5-05 and H5-07 remain unresolved. The three invalid-zero historical seal metadata exceptions, failed empty-UTXO fixture, Growth number layout, compatibility DNS and disaster-recovery evidence gaps keep their existing classifications. None is silently relabeled fixed by this pass.

### H5-08 — Boost canonical history failure becomes successful empty history (high; new source reproduction)

`server/proof-api.mjs:51731` catches canonical history failure and substitutes null; 51759 derives an empty source array, and the route at 76288 still returns HTTP 200. The unavailable source tag exists but `BoostRoot.tsx:1237` and AMO accept zero counts as a successful read. A local harness executing the extracted current function with a throwing history dependency returns an empty feed and zero totals. This is a demonstrated error-handling defect, not an induced production outage.

Propagate typed unavailable/non-authoritative state, preserve qualified last-good data, and distinguish genuine empty history from missing history. Verify cold failure, failure after success, recovery and true empty results in standalone/embedded Boost and AMO. Optional USD failure must remain separate from canonical history failure.

### H5-09 — Boost state and AMO discovery are reconstructed from truncated history (high at scale; new source reproduction)

The same feed requests one `limit=200` event page and ignores continuation, then returns at most 100 feed items; standalone asks for 50 and AMO derives its book from 100 newest. Ownership/profile/listing state outside that input can be absent. A local 201-record fixture with an old active listing on record 201 makes one history request, reports 200 and omits the listing. The live three-post feed is below these bounds; no current missing Boost record was demonstrated.

Build complete canonical Boost state with explicit provenance, then paginate the visible feed separately. Give AMO a complete listing-specific read rather than deriving global listings from newest posts. Do not just increase limits. Verify 201+ actions, 101+ posts, old active listings, ownership changes across pages, exact totals, cursor exhaustion/duplicates and checkpoint changes. Preserve the existing complete WORK-book contract and H5-05 precision scope separately.

### H5-10 — HTTP timeout and caller cancellation end before body completion (medium; new source reproduction)

`src/shared/api/proofApiClient.ts:109` clears the timeout and abort listener after response headers, before `response.text()`/`response.json()` at 118. A local stalled-body probe with a 30ms timeout is still pending after 120ms; later caller abort does not reach the internal controller. It settles only when the test finishes the body. No live body stall was induced or measured.

Keep cancellation and timeout active through awaited body consumption and clean up in the outermost `finally`. Test delayed headers, stalled successful/error bodies, caller abort before/after headers, invalid JSON and normal cleanup with an abort-aware stream. Existing static assertions that mention AbortController do not establish behavioral coverage.

### H5-11 — Obsolete Boost response can replace the current filter result (medium; new source reproduction)

`BoostRoot.tsx:1214` applies every async refresh result unconditionally despite filter/profile/network changes; AMO's loader at `App.tsx:46277` has the same pattern. An extracted-function probe resolves the current value-sorted request first and the old newest-sorted request second; the old payload wins while status stays good. No race was induced on production.

Use request generations and complete scope identity; reject obsolete payload/status/error/finally updates and abort obsolete work when possible. Preserve last-good data only with its actual identity. Verify reverse-order requests, obsolete failures, rapid filter/network changes and unmount. Correct numerical sorting alone does not fix wrong-response acceptance.

### H5-12 — Cold AMO Bonds never loads its bond-floor references (medium; new live and source evidence)

Standalone AMO remained Ready after several minutes while INCB floor showed zero; selecting POWB also showed zero, `n/a` floor comparison and “no confirmed bond floor yet” beside an actual sealed 2,000,000-POWB listing. Computer's cold AMO repeats it. Node-backed reference floors are 1 and 1.00000606 respectively.

This differs from H5-02: `bondWorkspaceActive` at `App.tsx:20833` excludes AMO, so the automatic bond load at 24877 never runs. Marketplace summary contains registry/token/WORK data but no bond summaries; tab changes only update selected tabs. The panel at 47368 receives undefined summaries and at 46732 substitutes zero. Manual Bonds Refresh explicitly requests both summaries in source; that click was not live-tested. A prior Computer bond visit can populate the references and mask the defect; waiting alone cannot.

Load the selected authoritative reference on Bonds entry/tab changes, or include exact checkpoint-qualified references in the marketplace summary. Track reference readiness independently from complete book readiness. Test cold standalone and Computer entry, INCB/POWB switches, missing/error references, manual refresh, cached prior visits and response races. Preserve legitimate zero ticket counts and all frozen/current action checks.

### Speed and data-handling recommendations, in reviewable scopes

1. **Restore operational storage runway before another large release.** UI is operational at 72% used but has only 286 MiB above its 10 GiB free-space floor. Revalidate the existing three transport-copy candidates and their retained duplicates before any approved removal; fix scheduled retention/health access in its own operations scope. Cleanup alone does not close long-term retention/backup requirements.
2. **Correct read-state facts first:** H5-02, H5-08 and H5-12. An unavailable input must not become zero, empty history or spendable funds. Preserve accepted exact summaries independently from complete listing hydration and current signing admission.
3. **Fix request lifecycle and complete Boost state:** H5-10/H5-11, then H5-09 with H5-05 exact arithmetic. Use actual behavioral tests, not source-string assertions alone. Keep exact Q8/subatoms in sums, ranking and machine-readable/copy values.
4. **Replace broad initial browsing reads with complete, qualified projections.** Credit explicitly fetches full unscoped `/token`, then schedules the same non-fresh read again one second after it finishes (`App.tsx:26891`, 24575). Each observed response has 71,429,709 decoded bytes and 2,477,493 encoded body bytes: 142,859,418 decoded bytes across two reads. Initial directory data should retain all definitions and exact cap/supply/counts; fetch selected history by asset/cursor. Inspect the existing compact-summary contract before using it. Mint and wallet fresh preflight stay separate and exact.
5. **Reduce repeated listing payloads without deleting replay evidence.** AMO's four initial complete-listing pages total 24,490,667 decoded bytes, versus about 1.22 MB encoded bodies, plus a 4,938,996-byte decoded compact summary. Three replay/raw-witness fields account for 294,206 of 478,253 payload bytes (61.5%) in 12 sampled DB rows. Source preserves them into complete public listing pages. Define a versioned complete display projection retaining identities, exact/frozen terms, the correct authorization roles, lifecycle/anchors and proof commitments; reference immutable full detail on demand. Existing preview helpers are not equivalent to complete authority. The server also reconciles the full book before slicing each page. Any reusable materialization must retain mempool-sensitive invalidation and equivalent admission; height-only caching is insufficient.
6. **Scope simple reads and repeated work.** Home needs authoritative fenced counts, Desktop can use an exact current ID lookup, and detailed ledger views can page on demand. Cancel delayed polling timers on workspace/network changes and coordinate manual fresh requests with in-flight reads. Existing deduplication, compression and immutable asset caching already exist. Do not add blanket response caching to fresh wallet/mempool/signing routes.
7. **Measure route, parse and database costs before tuning.** AMO's entire roughly five-minute interactive session accumulated 164 observed long tasks totaling 32,564ms (maximum 874ms); that includes polling and interactions, not just initial loading. Route splitting and lazy signing imports are candidates. Existing PostgreSQL cumulative statistics since August 3 are not current request latencies; collect representative deltas/plans before changing memory or adding indexes. Preserve the installed indexes and explicit summary-size limits. The current JSONB summary is 15,421,409 bytes against the separate 18 MiB SQL read ceiling.
8. **Finish presentation consistency.** Reuse exact-value display/copy controls for Growth and scoped sidebar metrics. Embedded Computer Credit passes unfiltered definitions to the generic mint dropdown (`App.tsx:33926`), unlike standalone's filtered list at 33023, so it offers INCB/POWB options. Selected-credit resolution and explicit mint/assistant/preparation guards still exclude bonds; source review does not demonstrate mint bypass. Align the choices with the supported credit lane. This is a UI recommendation, not a new issuance defect.

An optimized response must compare equal to the current complete source at one checkpoint: membership, exact amount/cap, pending treatment, frozen terms, authorizations, lifecycle, anchors and completeness proofs. Verify more rows than each preview limit, stale/forked cursors, same-height mempool spends, unavailable authority and nearly exhausted mint caps. Keep full evidence independently retrievable. After approved implementation, run relevant exact math, API/live-data, client containment, mint/marketplace and focused browser regressions, then production full-node checks before shipping. No claim of superiority to another application, or a particular speed gain, is established without comparative measurements.

### VPS and cleanup refresh

| Mount | Used | Available bytes | Inode use |
| --- | ---: | ---: | ---: |
| Node `/` | 24% | `76264308736` | 6% |
| Node `/data` | 73% | `460220186624` | 1% |
| UI `/` | 72% | `11037167616` | 7% |

At the 13:26 refresh UI free space is 10.28 GiB, only `299749376` bytes above 10 GiB. Scratch (`7319408640` bytes), backup/evidence (`15986339840`) and live `/var/www` (`413335552`) remain unchanged; logs grew about 13.6 MB since the earlier sample. Node/API/worker/Caddy remain active with sampled `NRestarts=0`; bounded API/worker/PostgreSQL warning-or-higher logs since 07:30 are empty. Query health shows three connections, one active, no lock waiters/idle transactions, zero recorded deadlocks, 18/18 large-state placements and 14 expected indexes. These are health observations, not physical page-checksum verification.

The same three transport-copy candidates total **433,340,471 bytes (about 413 MiB)**. Archive sizes/sidecars and retained-tree metadata remain unchanged since the morning full comparison; this is a continuity check, not a second full-byte comparison. No stale notes, backups, history, witness state or release roots were deleted. Current and compatibility bundles, canonical transitions, H-1 oracles, database recovery chains and protected audit/rollback records remain preserved. Provider billing/monthly transfer allowance still is not available; byte counters do not establish billable monthly usage.

### Addendum evidence and completion boundary

The existing companion receipt now includes `orderedSurfaceAudit` with the ordered browser coverage, compact exact assertions, raw-proof hashes, source reproductions, prior-audit continuity and refreshed operations evidence. Larger captures and screenshots are under `/tmp/pow-ordered-audit-20260905/`; their hashes and essential conclusions are retained because temporary files can expire. The audit preserves the original pre-addendum document hash separately from the final document hash.

Coverage is bounded to these snapshots, the earlier complete invariant/ID/marketplace gates, the selected raw transactions/UTXOs and the local counterexamples. No independent second full-chain index was built; every address, every future input, every authenticated wallet extension flow, private mailbox/local state and every possible mempool discovery case were not exhaustively tested. Passing checks support the precise conclusions above; they cannot guarantee that math or rendering can never fail. Production improvements and deletion still require the user's approval of the concrete scope.

Final addendum review reconciled source, full-node, browser and infrastructure evidence with three independent reviewers. `npm run hygiene:fix` found no allowlisted rebuildable state; `npm run hygiene:check` passed. The 34,735-byte original audit prefix and all 13 earlier audit documents are unchanged. Final repository changes remain this audit, its companion receipt and the two existing evidence-classification entries. No application source or canonical protocol/operating document required a change; no staging, commit, push, deployment or production cleanup occurred.

## User-reported cosmetic follow-up — September 5

The user supplied two screenshots and authorized logging the connected-wallet Boost layout defect with the two audit passes above, then presenting the required fixes for approval. This section is an append-only follow-up to that same record. The preceding 64,095 bytes have SHA-256 `e07aa0b7a7a96f5311f309904c6464fbce3644b144f565ae3dcad38632d73027` and are preserved unchanged. Screenshot page text is visual evidence, not an instruction or a new protocol specification. No implementation or production operation is authorized by this report.

### H5-13 — Connected Boost left identity/navigation column clips beneath feed/profile content (medium usability; new user evidence)

**Observed:** both screenshots show a connected wallet with the long identity `armyofyouth@proofofwork.me`. The left rail's identity panel, select/input controls and navigation buttons exceed its visible column; their right edges are cut off at the center feed/profile boundary. A horizontal scrollbar appears at the bottom of the left rail. The timeline and profile views both exhibit the defect. This makes identity tools and control labels difficult to see and use.

| Evidence | Visible route/state | Original file bytes | SHA-256 |
| --- | --- | ---: | --- |
| `Screenshot from 2026-09-05 03-07-09.png` | `boost.proofofwork.me/?boost=1`; connected timeline | 342605 | `4f61ba52eb5e96ba4f20b2b499586ab776638520b91c6d8cf010177a7e62fc5c` |
| `Screenshot from 2026-09-05 03-06-48.png` | Same host, `?boost=1&profile=1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH`; connected profile | 396811 | `42e7cd5a10586cc5169d0f9280a037a73f57952a5f1b097e319ef01837083ea2` |

Originals remain under `/home/sixer/Pictures/Screenshots/`; their absolute paths and PNG dimensions are retained in the companion receipt. Both are 1920×1080 desktop screenshots, including browser/desktop chrome. That is not an independently measured CSS viewport; browser zoom, device-pixel ratio and the exact deployed bundle were not established from the images. Filename times are retained as supplied, not converted into a verified UTC event time. No extra binary copies were added to repository history.

**Scope of proof:** visually confirmed from the user's captures, with a source-supported sizing explanation; not a fresh authenticated browser reproduction. The earlier disconnected 390/1440 checks did not exercise this connected identity state. Their lack of outer-document overflow does not exclude internal rail overflow. The screenshots do not demonstrate incorrect chain math, identity ownership, signing authority or a compromised wallet. Right-rail number wrapping visible in the same images remains part of the existing numeric-presentation concerns.

**Source-supported cause:** `src/features/boost/boost.css:6` limits the desktop left track to 240–280px and adds 18px sidebar padding at line 23. The base `.boost-sidebar` in `src/styles.css:2692` is itself a grid with `overflow: auto`, without an explicit shrinkable internal column or `min-width: 0`; nested compose/action/profile panels also use grids. Connected identity controls are rendered by `src/features/boost/BoostRoot.tsx:1592` onward, including a native select containing full IDs and paired Sign ID/Publish buttons. Those intrinsic control/content widths can exceed the available inner column and produce the visible rail-level horizontal scrolling/clipping. The exact computed-width chain still needs measurement in the implementation fixture; adding only clipping or raising z-index would conceal the symptom without making controls fit.

**Continuity:** no exact matching report was found in the 14 audit documents. The September 3 UI audit's general left/feed/right competition and drawer recommendations provide context; its earlier modernization and disconnected checks are not proof this state was fixed. H5-05 tracks exact Boost formatting/ranking, not column geometry. Keep this finding separate as H5-13, without reopening resolved embedded-Boost or navigation fixes.

**Proposed narrow correction:** constrain the shared Boost sidebar's nested layout to the available column width, using shrinkable grid tracks/items and explicit input/select/button bounds. Let identity/action rows wrap or stack when needed; retain readable, inspectable full identity values and keyboard focus. Preserve independent vertical sidebar/feed scrolling. Apply the shared fix to standalone Boost and Computer's embedded Boost. Use `src/features/boost/boost.css` for scoped overrides; adjust `BoostRoot.tsx` markup only if the layout fixture shows it is necessary. Any shared `styles.css` change must be scoped so unrelated workspaces retain their geometry.

**Acceptance before closing:** reproduce both supplied states with the same public identity using a read-only test provider; cover connected/disconnected states, no-ID/one-ID/multiple-ID wallets, longer valid IDs/addresses and timeline/profile navigation. Measure sidebar client/scroll widths and child bounding boxes, not just document overflow. All controls must fit without rail-level horizontal scrolling or center-panel occlusion. Check standalone and embedded widths around the existing container breakpoints, 390/1024/1440/1920 CSS-width fixtures, and 125%/200% zoom with the appropriate responsive drawer behavior. Verify keyboard access, visible focus and full identity disclosure. No signing or publishing action is needed to test layout. Compare exact displayed values before/after; preserve all protocol, fee, wallet and event handlers.

### Consolidated fixes for approval

These batches collect the unresolved work from both audit passes plus H5-13. They are proposed scopes, not completed fixes. The user may approve batches by number; a layout-only approval does not authorize database repair or cleanup. Application changes must first be implemented and verified locally, then presented with their final diff and production-read evidence before deployment. Any approved deletion or data repair must use the exact manifest/transaction scope below and fresh preflight evidence.

| Batch | Scope and intended result | Verification / operational boundary |
| --- | --- | --- |
| **1 — Layout and control consistency** | Fix H5-13 connected Boost rail containment; finish Growth's exact-number layout; remove unsupported bond choices from generic embedded Credit. Primary files: Boost CSS/component, shared exact-value presentation and the affected `App.tsx` wiring. | Both supplied Boost states and shared Computer views pass the geometry/accessibility matrix. Exact values remain inspectable. No change to wallet handlers, protocol math or transaction construction. |
| **2 — Truthful data readiness** | H5-02 and H5-12: display accepted bond summaries independently of listing hydration; load AMO bond references on entry; prevent false-empty Credit/Wallet states and premature spendable labels; bind Computer badges to the correct scope. | Delayed/error/recovery/true-empty fixtures; known ticket reservations; cold AMO and scope switches. Unavailable is not zero. Complete inventory and fresh action admission remain required. |
| **3 — Exact, complete Boost tracking** | H5-05, H5-08, H5-09 and H5-11: use exact Q8/subatoms for display/ranking/sums; propagate canonical-read failure; build complete state/listing discovery; reject obsolete filter/profile/network responses. Principal paths: `BoostRoot.tsx`, AMO's Boost loader and server Boost projection. | Reproduce the existing precision, 201-event/101-post, failure-as-empty and reverse-response counterexamples; require exact totals, complete older active listings and matching request identity. Preserve immutable history and existing payment attribution. |
| **4 — Read reliability and smaller payloads** | H5-10/H5-06 plus measured overfetch: keep abort/timeout active through body reads; diagnose summary convergence; remove duplicated 71MB decoded Credit reads; use complete directory/scoped detail projections, smaller complete listing views, count-only Home reads and point ID lookup for Desktop; cancel obsolete refresh work. | Before/after response/readiness/parse measurements and exact full-versus-projection comparisons. Full replay evidence stays retrievable; no preview becomes signing authority, and same-height mempool changes still invalidate admission. |
| **5 — VPS capacity, retention and recovery** | H5-01/H5-03/H5-07: repair scheduled verifier/pruner access without broadening private Git permissions; align UI crash-storage controls; prepare capacity-aware retention. Revalidate the three exact UI transport-copy candidates already listed above, totaling 433,340,471 bytes, before their specifically approved removal. Verify the latest backup through an isolated restore and document off-host recovery requirements. | Preserve current/rollback releases, original witnesses, backup/WAL chains and the 10GiB UI floor. Larger cleanup sets require a separate exact manifest. Off-host destination, encryption/access and retention must be specified before copying production backups; no destination or transfer is implicitly approved. |
| **6 — Targeted historical and verifier repairs** | H5-04: prepare the existing single-tx detail repair for `4c079144…307359`. Separately prepare exact zero-unit metadata for the three already classified invalid seals. Resolve the empty-UTXO fixture's live prerequisite explicitly and review the existing compatibility DNS gap. | Core must prove six inputs/two outputs while all five anchor links and economic/H-1 fingerprints remain unchanged. Invalid seals stay invalid with zero contribution; no balance rewrite or broad replay. Do not turn an unmet test prerequisite into a claimed pass. DNS changes require an exact intended record, not a speculative compatibility expansion. |

Recommended order: prepare storage runway before any large production release; locally tackle batches 1 and 2, then 3 and 4. Batch 6's data changes remain a separate, tightly verified maintenance scope. Backup verification and capacity planning continue alongside those changes. Existing full-node/indexer arithmetic, declared rules, fees, frozen listing terms, pending/confirmed distinctions and local signing remain unchanged throughout.

This follow-up logs evidence and defines approval scopes only. No fresh production health measurement, code fix, database mutation, deletion, restart, staging, commit, push or deployment was performed.

## Approved remediation — implementation and verification in progress

The user subsequently approved all six consolidated batches, including H5-13,
implementation, required testing, the exact scoped production repairs and cleanup,
commits, deployment and push. That approval supersedes the read-only boundary for
those batches only. Historical findings above describe their original observation
time; this section records remediation against the existing IDs.

- **H5-01, completed scoped cleanup:** the three previously enumerated UI transport
  archives were rehashed and compared with all retained extracted bytes under the
  deployment lock. Current/rollback references were checked. Exactly 433,340,471
  logical bytes were unlinked; every extracted duplicate, checksum, release,
  rollback and other file was retained. Available UI bytes afterward were
  11,470,229,504 (10.682 GiB), leaving 732,811,264 bytes above the 10 GiB floor.
  This is limited runway, not a claim that capacity is resolved permanently.
- **H5-13, local validation:** both user-reported connected Boost states passed
  14 browser geometry cases at 1920, 1440, 1024, 960, 768, 390 and 320 CSS pixels.
  The identity controls fit the rail without horizontal scrolling; full option
  text remains available, controls retain touch size, and the mobile tools dialog
  supports Escape/focus restoration. Embedded Computer checks are being completed.
- **H5-05/H5-08/H5-09/H5-11, local implementation:** exact Q8/subatom comparisons,
  complete event reconstruction, complete original-post listing discovery,
  canonical-read error propagation and obsolete-response rejection are covered
  by behavioral regressions. Explicit malformed/negative/conflicting exact values
  fail closed. Attached WORK valuation requires the event checkpoint and current
  WORK-floor checkpoint to agree.
- **Full-node Boost verification:** 44 checks passed using all three current
  confirmed Boost events, their raw Core transactions and input parents, physical
  block/OP_RETURN positions, and the candidate projection. Core remained at block
  965624, hash `000000000000000000007a4780be8731f1ea5711897c70a3a1c624917497e8e7`;
  event history and WORK valuation used snapshot `7047856e5a81fd43299b4a3f`.
  Exact signal totaled `427572.80717052` proofs; no pending Boost event was present.
- **H5-02/H5-12, local validation:** qualified directory/count reads, complete
  wallet reservation readiness, cold AMO bond references, early accepted bond
  summaries, scope-aware counts and explicit Log search state are implemented.
  Six focused browser cases passed, including exact large-value Growth copy,
  cold INCB/POWB references, Credit aggregate supply with no mint-preview inference,
  retained Home counts, Desktop point ID lookup, and matching-page pending counts.
- **H5-10/H5-06/read overfetch, local validation:** request deadlines and caller
  cancellation now cover success/error body consumption. Ten real HTTP regression
  cases passed. Complete listing display projections retain full source/membership
  digests, frozen terms/authorizations and an exact-ID full-evidence retrieval path.
  Existing Core checks precede projection; same-height mempool changes invalidate
  continuation. Full response evidence remains available.

At this checkpoint, application deployment and database mutation have **not**
occurred. Repository hygiene, final integration gates, safeguarded four-record
repair, isolated backup restoration, retained-rollback deployment preparation,
production verification and release receipts remain in progress. No transaction
has been signed or broadcast and no backup has been transferred off-host.

### Separately observed follow-up, outside the approved implementation

Source review found that the existing Boost ownership reducer admits the
`boost-hide` event kind but does not apply its documented author-hide visibility
tombstone. The three current posts contain no hide events, so this is a
source-derived behavior gap rather than observed production data loss. This
behavior was left unchanged; a focused follow-up should verify author admission,
hide visibility and historical retrievability before proposing its own fix.

### Pre-rollout verification and bounded release preparation

- **Full-node listing verification:** all 604 active sale-ticket outputs were
  independently checked with Core `gettxout(..., include_mempool=true)`. All were
  confirmed, unspent and matched their exact indexed value/script. Core stayed
  at height 965625/hash `00000000000000000000d17a6247bc68c4077f7f258d45c95fd6cdec4e9a6dab`
  from 14:45:17 through 14:45:35 UTC. The candidate display projection preserved
  43,201 substantive fields, full-record hashes and exact retrieval references;
  decoded listing payload decreased from 24,490,667 to 9,913,334 bytes (59.52%).
- **Full-node directory/wallet/bond verification:** 30 checks passed at the same
  block. All 238 token identities and exact aggregate fields matched the full
  source; confirmed supplies matched relational holder sums. All 403 balance
  rows passed exact nonnegative/integer checks. The sampled wallet had 75
  confirmed UTXOs totaling 257,310 proofs: 59 WORK tickets reserved 32,214 proofs,
  leaving 225,096 other confirmed proofs before wallet-specific availability
  restrictions. Both bond division/issuance/fee/dust checks passed. These are
  checkpoint-bound observations, not permanent balance claims.
- **Directory transport:** all 238 complete definition objects, creation proofs,
  counts and checkpoint provenance were identical after `directory-v1` projection.
  Decoded payload decreased from 4,387,018 to 400,652 bytes (90.87%). Credit and
  AMO use independent accepted cache scopes so an omitted history preview cannot
  replace a complete market book or block a newer directory snapshot.
- **Local integration:** the 502-case index recovery gate, 10 real HTTP timeout/
  cancellation cases, exact WORK precision, exact bond arithmetic, WORK AMO V8,
  UI/API truth, hardening, live-data and client-read containment gates passed.
  The production build passed; Vite retains its existing large-chunk advisory.
  Embedded Boost desktop/mobile timeline/profile checks passed in addition to
  the 14 standalone geometries. A final delayed-query case checks that pending
  searches report unknown counts and retain server-only matches.
- **Capacity-aware tooling:** opt-in candidate-only hardlink deduplication passed
  15 tests, including source/live/rollback inode independence and portable
  `--hard-dereference` archive restoration. Explicit retained-root classification
  binds both manifest and complete-root SHA256; no existing rollback is removed.
  The release workflow streams new transport bundles into fresh private paths,
  stages before uploading source, and measures the newly created managed archive
  before the final source allocation. The 10 GiB floor plus a 64 MiB growth
  reserve remains enforced. Provenance extraction uses a private bounded tmpfs.

Application publication and the four-record repair remain pending at this
pre-rollout checkpoint. The latest existing backup is being restored into an
isolated resource-limited PostgreSQL cluster; the fresh creation-only safeguard
will follow without running any retention routine. Historical audit findings,
chain records and all earlier rollback/recovery assets remain preserved.

### H5-06 live convergence diagnosis during preparation

At 14:52:34 UTC the worker first observed authoritative Core absence for 12
previously witnessed pending WORK transactions. The existing 300,000ms absence
confirmation guard retained them until at least 14:57:34; a retry just before that
boundary failed, and the ordinary failed-cycle backoff delayed the next attempt.
Confirmed replay and every summary scope remained valid. At 15:02:48 a fresh
33-member pending witness published after removing exactly those 12 absent
members. At 15:03:19 `/health` returned 200/ready at block 965627, with worker
failures reset to zero and the worker idle. No intervention occurred.

This episode was pending-witness convergence, not summary-byte overflow or the
three historical precision-metadata deficits. The complete summary was 15,421,409
bytes, below the unchanged 16 MiB budget. The observation explains why zero
block lag alone is insufficient health evidence. The existing Core absence and
canonical admission guards remain unchanged. A future improvement can distinguish
expected pending-absence waiting from unexpected worker failure when scheduling
retries, while preserving the full five-minute guard and exact witness admission.

## Safe pause requested by the user — 2026-09-05 15:10 UTC

**Paused before application deployment or database repair.** No implementation
commit, push, production application/config installation, release publication,
transaction signing or broadcast occurred. The approved three-archive removal
above remains the only completed cleanup of pre-existing production files.
Local implementation, tests and this audit are saved on
`growth-all-products-2026-09-05`, based on `0f78b14d48a101bc4e22c6177d6f2bbacb09cc76`.
The implementation is staged; this pause addendum is an additional saved edit.

The exact isolated restore unit
`proofofwork-audit5-restore-20260905T144615Z.service` was gracefully stopped at
15:09:16. Its private PostgreSQL cluster has no running server or listening
socket. The interrupted job is **not a passed restore verification**: its exit
143 and `pg_restore: terminated by user` are the expected user-requested stop.
Its partial clone, original 11,074,733,418-byte dump and all recovery evidence
remain intact. The queued fresh safeguard backup was cancelled before creation.
No production database or chain service was stopped or restarted.

At 15:10:00, Core, Electrs, PostgreSQL, API, worker and WAL receiver remained
active with zero restarts. `/health` returned 200, `ready=true`, exact height
965627, zero block lag and zero worker failures. `/data` had 441,446,285,312
available bytes. All audit-owned local test/development processes were stopped;
no unattended deployment, repair or safeguard job remains queued.

Repository hygiene fix/check and staged diff checks passed during preparation.
The full UI operations suite passed its earlier cases but found the new helper's
local group-writable mode (0775); it was corrected to 0755. The complete rerun
was interrupted for this pause and must finish before release. Do not record it
as passed. The application build, arithmetic, projection, timeout, UI/read-state
and other completed checks remain recorded above.

### Resume handoff within the existing six-batch approval

1. Inspect the saved staged/unstaged diff and finish the full UI operations gate.
   Review the final private launcher and capacity-aware UI workflow drafts;
   fresh release artifacts must bind a clean committed source tree.
2. Complete isolated backup restoration verification and create the fresh
   creation-only safeguard. Preserve the interrupted clone/evidence; the pinned
   restore helper refuses a nonempty target, so do not blindly rerun its old job.
3. Stage the exact candidate, run the production-runtime and private read-only
   full-node checks, then perform only the documented four-record repair with
   all writers stopped, before/after invariants and the required derived-cache
   bootstrap. No repair has yet run.
4. Install the approved operational controls, publish the node and UI releases
   within the measured storage floor/reserve, verify production in the requested
   surface order (Computer last), update this audit, complete hygiene, commit
   receipts and push. Preserve both UI rollback roots and all recovery chains.

Operational evidence/drafts are under `/tmp/pow-remediation-20260905/`,
`/tmp/pow-approved-ops-20260905/` and `/tmp/pow-approved-fixes-20260905/` on the
build host. These are supporting files, not permission to execute old scripts
unchanged. Key handoffs: `node-rollout-plan.md`,
`node-rollout/private-helper-review.md`, `node-rollout/PAUSED-helper-notes.md`,
`operations-runbook.md` and `safe-pause-receipt.json`. No additional work should
start until the user asks to resume. The existing approval remains scoped to
its six batches and exact cleanup/repair boundaries.

## Resumed under the existing approval — 2026-09-05 17:39 UTC

The user requested continuation. Repository changes and embedded audit receipts
survived the pause, but the build host's temporary `/tmp` drafts did not. The
operational helpers are being reconstructed and reviewed under `deploy/audit5/`
so their exact source can be committed with the release. This does not assert
byte continuity with the expired drafts. No application deployment or database
repair occurred during the pause.

Fresh 17:41 UTC checks found all six node services active with unchanged start
times and zero restarts. The API returned 200/ready at exact height 965644 with
zero lag and worker failures. Available space was 441,193,680,896 bytes on node
`/data` and 11,459,944,448 bytes on the UI filesystem. UI current/rollback
manifests and Caddy were unchanged. The three approved archives remain absent;
their retained expanded copies and SHA256 sidecars remain intact.

The interrupted restore clone remains preserved and stopped. A fresh isolated
restore started at 17:42:33 in
`/data/proofofwork-audit5-restore-20260905T174233Z`, using the unchanged reviewed
helper and pinned existing dump. It is running at this checkpoint, not yet a
passed restore. The fresh safeguard remains queued behind successful restore
verification. The full UI operations rerun and review of the reconstructed
helpers remain release gates. No approval is expanded by this continuation.

### Completed local release-tool gates after resumption

The complete UI operations suite passed at 17:50:36 UTC, including real
publisher fixtures for retained rollback roots and the 525/1,024/1,025 dependency
boundaries. The earlier interrupted rerun remains classified as interrupted.
The finalized UI transport/capacity workflow passed 16 adversarial fixtures;
node attestor privilege-boundary checks passed five; the exact operations
installer passed 13. The installer accepts only its 14 host-specific target
pairs, checks a final-commit-bound manifest and each prior installed hash,
preserves before-files privately, and never invokes an applying release pruner.
The node attestor reads only the hash-pinned installed publisher and runs its
unchanged verification body as `powadmin` with no supplementary groups and
`no_new_privs`. Root never executes code from a writable candidate or writes
receipts into an application-owned directory.

The implementation and deployment helpers are ready for a reviewed source
commit. The standalone HTTP/Core comparison probe remains under preparation
and will be separately hash-bound and reviewed before execution; it does not
change application behavior. Production application/config installation,
database repair and publication are still pending at this checkpoint.

### Installed operations controls and candidate preflight correction

The exact three node and 11 UI operations targets were installed from reviewed
commit `5a74ca8f98769534bce23f550e54cc17b0c816a0`. Both dry-runs and applications
passed; each previous installed file is preserved in a private receipt
directory. Post-install checks at 18:02:11 UTC verified every target hash/mode,
unchanged Core/PostgreSQL/API/worker/Caddy PIDs and start times, read-only release
retention commands, and the two node verifiers' required read capability. UI
Apport is disabled with `LimitCORE=0`; the three reviewed crash sysctls match.
Existing crash/log evidence remains intact. UI provenance's timer remains held
for publication; other previously active maintenance timers were restored.

A brief 503 at the new block 965647 converged naturally to 200/ready, zero lag
and worker failures. No application service restart caused that transition.
UI free space was 11,458,891,776 bytes after this small configuration update.

The first isolated node candidate stopped during `npm ci`: the existing deploy
inbox has intentionally private root-only mode 0700, so `powadmin` could not
traverse it to the new npm scratch directory. No application deployment,
database repair or permission widening occurred. The failed candidate and
bundle are preserved. The stager now creates its separate root-owned 0711 work
parent below traversable `/opt`, with a private application-owned npm cache and
explicit unprivileged access checks. Git-mode tightening also runs as its owner.
A new exact release will be built; the first UI build was stopped before rollout
to keep both release manifests tied to the same final commit.

The standalone HTTP/Core comparison probe is finalized and reviewed, with 11
behavioral fixtures passing. It checks current complete inventories, every
active ticket, a public wallet sample, exact bonds and Boost against a stable
Core checkpoint; it makes no signing or exhaustive historical replay claim.
The isolated restore and fresh safeguard remain gates before the four-record
repair. Production application publication remains pending.

### Candidate verification and restored-backup proof — 18:24 UTC

The application candidate is commit `2ddefac163d583138129c2527e747b11190a0635`
(tree `89283688ad79cdcd0a4e04a9532aac8c8af735f2`). Its isolated Node 24
installation passed recursive source/runtime attestation: 6,543 entries,
191,440,061 runtime bytes, digest
`ee78a47da73df81665e75354a570df9394a5b17f19cf719f0aa067be41b12b35`.
The matching UI build completed TypeScript and all 14 primary Vite surfaces
plus the NFT compatibility copy. Subsequent operational-verifier corrections
are separately versioned; they do not change this application candidate.

Two private-shadow startup attempts stopped before Node execution. First,
`PrivateTmp` correctly hid the helper's `/var/tmp` location; identical,
hash-verified root-private helper bytes were placed in `/run`. Second, the
explicit root user/group transient-unit setup lacked effective `CAP_SETUID`.
A no-exec diagnostic established that systemd's default root setup retained
the requested three-capability bound and allowed the unchanged launcher to
drop all capabilities and supplementary groups. All other sandbox and resource
limits remained active. Retry 2 passed at 18:21:30: the actual candidate Node
process ran as uid/gid 1000, no supplementary groups, all four capability masks
zero and `NoNewPrivs=1`; its actual PostgreSQL pool verified both read-only
settings, exact database and search path. Private health was 200/ready with
zero lag at 965647. Original API/worker environments were not recaptured or
exported; all failed-attempt evidence and the separate cache were preserved.

Fresh full-node verification of the four approved repair targets passed at
18:22:20, with Core stable at 965647 /
`00000000000000000000b87ee40e3e4f81978c4be66a803a43c06a69968d7df6`.
The auxiliary transaction has six inputs totaling 3,593 proofs, two outputs
totaling 3,118 proofs and exact miner fee 475 proofs. Its five existing spent
anchor links match the full-node parent outputs. All three invalid-zero events
match their canonical transaction block positions and remain invalid, with
zero contribution. No repair has run.

The new verification harness initially assumed the payload's `amountSats` was
a string and assumed event rows directly stored block hashes. Read-only schema
and type evidence corrected those assumptions, and the bitcoin-cli adapter
was corrected for plain-text block-hash output. These were verifier attempts,
not new production findings. The committed repair scope guards now require
the existing JSON number `0` exactly and preserve it; they do not coerce it
to a string. Thirteen comparator fixtures and 12 private-launcher tests pass,
including rejection of changed zero types. The final reproducible Core
preflight is `deploy/audit5/verify-repair-core.py`; stopped-writer invariant
checks and the repair writers' own canonicality proofs remain mandatory.

The first wider candidate HTTP/Core probe stopped at a membership-digest
comparison after 17 requests. Counts/directory and full/display transport had
been read, but ticket, wallet and bond sections had not completed. Saved
responses are being compared with the server's exact digest contract. This
is not recorded as a passed candidate gate or automatically classified as an
application fault.

The saved listing responses subsequently proved a verifier serialization issue:
the source declares ten optional fields unconditionally and its commitment
serializer maps absent values to null, while JSON transport omits them.
Reconstructing only those source-declared omissions reproduced all 616 full-row
hashes and the complete membership hash. The application commitment contract
is unchanged. A separately reviewed verifier correction and remaining live
comparison sections are still required.

A repeat Core proof at 18:27:20 added stable transaction-byte SHA256 values
alongside the tip-sensitive verbose-response hashes and again passed at the
same canonical tip. Both successful receipts and the prior failed harness
attempts remain recorded; hashes are explicitly labeled by their input form.

### Recovery and storage checkpoint

The pinned 2026-09-05 03:18:55 logical backup restored successfully into `/data/proofofwork-audit5-restore-20260905T174233Z`. The private clone contains 25,765 events, 25,132 transactions, 238 credit definitions, 403 credit balances, 10,495 ledger snapshots and 5,936 transitions. Invalid indexes and unvalidated constraints are both zero. The stopped-clone check scanned 2,570,422 blocks across 1,455 files and found zero bad checksums. Runtime was 34min7.840s, CPU time 17min1.542s, reported memory peak 2.0G and swap peak zero. The clone is stopped and its socket is absent. This verifies data/schema restoration and physical page checksums; owner/grants/global roles and production tablespace placement were deliberately excluded.

All source backup files, the completed 22,131,757,056-byte allocated clone and the interrupted 18,545,463,296-byte allocated clone remain preserved. The restored database size is 21,033,884,695 bytes. Live health after completion was HTTP200/ready at exact tip/index965647 with zero worker failures. The new creation-only safeguard `/data/proofofwork-audit5-safeguard-20260905T181729Z` is still running under 50% CPU, 2GiB memory,64 tasks and75min limits, with no retention. At 2026-09-05T18:22:36.193555+00:00 its dump held 3,540,279,296 bytes and /data had 415,422,734,336 bytes free; live health was HTTP200/ready. Its checksum/TOC completion remains pending.

Maintenance warnings remain explicit. UI storage now correctly warns below12GiB: the18:05 run observed71% block use,7% inode use and11,458,801,664 bytes free. Node /data reached76% with417,075,429,376 bytes free while recovery artifacts are preserved. The18:20 PostgreSQL query-health alert observed one119-second query, zero lock waiters and fanout1; later pg_stat_activity metadata plus matching Unix socket peers positively bind the long COPY to safeguard clientPID1144535/backendPID1144538. Full SQL and environment values were not captured. Recheck that alert after the backup completes. Historical node release-health/prune exit2 records remain until the new hardened oneshots run. No additional existing archive deletion occurred after resume.

The exact live UI compatibility closure measured 527,332 candidate strings,
525 dependencies, 1,005 resolved edges and 43,649,254 bytes. The search limit
had remained 524,288 when the approved dependency ceiling moved to 1,024.
The reviewed paired stager/publisher correction uses a finite 1,048,576 search
limit and preserves every other dependency/edge/byte/path/collision bound.
This operational correction is not a new application finding.

The initial aggregate storage estimate conservatively rejected staging by
3,584,000 bytes. A read-only model of the actual remove/copy/deduplicate phases
proved a 417,976,320-byte staging peak before the small extra parent-metadata
allowance, with 31,907,840 bytes above the unchanged 10 GiB floor and 64 MiB
reserve at the sampled free space. The production gate now recomputes this
phase bound under the deployment lock, charging all old metadata and giving
removal credit only to proven exclusive old regular inodes. Archive creation
and source upload retain independent later capacity gates. No UI payload has
yet been transferred or staged, and the corrected helper pair is not installed
at this checkpoint. Application release artifacts remain bound to commit
`2ddefac163d583138129c2527e747b11190a0635`; later operational helper hashes are
bound separately, without substituting another application source tree.

The corrected standalone comparison probe passed 12 fixtures and a saved-data
check on Node 24: all 616 full/display rows, every retained field and full-row
commitment, complete 505 confirmed IDs, and 238 credit definitions agreed.
The full listing response was 24,921,145 bytes versus 10,079,485 for display.
Those saved-response checks are distinct from the new current Core ticket,
wallet and bond comparison now running. The separately sandboxed 11-gate Node
24 test batch is also in progress, with no host network or PostgreSQL socket
access and no writes to the candidate.

Twenty-two UI workflow tests pass. The full UI operations rerun first hit the
known sandbox Node-to-Python subprocess limitation; it is being repeated with
normal local subprocess execution and the same timeout. That attempt remains
recorded as a timeout, not a pass. The paired helper hashes are pinned in the
phase gate and publication wrapper; application-source checks and unchanged
provenance/retained-root helper comparisons still bind the built commit.

### Fresh safeguard completed

The creation-only safeguard passed with a readable 197-entry recovery table of
contents, private globals and verified checksums. The new dump contains
11,271,928,229 bytes, SHA256
`5939ce9f6f8a615b6d4a29cfb2b019b39f6579f19be76130fe981df9e357aa96`.
Runtime was 16min45.504s, CPU 8min22.490s, memory peak 2.0G and swap peak zero.
The unit is inactive and its backup lock released. Both recovery clones and
all source recovery chains remain preserved; no retention ran. At 18:36:43
production was 200/ready at exact 965650, zero worker failures, and unchanged
production service identities. Scheduled query-health naturally returned to
exit0 at 18:35:04, with no long queries, lock waiters or tablespace errors.
The earlier backup-related alert remains historical evidence.

The Node 24 offline batch passed its first eight gates, including recovery and
all exact arithmetic/AMO/Boost/projection checks. The API-truth script also has
six optional HTTP reads when `POW_API_BASE` is set; its offline attempt reached
that phase and correctly could not connect through the isolated network. It
is being rerun unchanged against the private read-only candidate, and the two
remaining source checks are running separately offline. The second wider
probe likewise remains a refused attempt: a new block advanced Core and the
index before the canonical summary caught up, so readiness correctly returned
503. A further attempt requires stable matching Core/readiness samples.

### Second user-requested safe pause

The user requested another safe pause before application rollout. The private
read-only candidate API was stopped successfully: MainPID0, inactive/dead,
Resultsuccess, and no listener on18081. No application deployment or four-record
database repair has occurred. The two local commits and all uncommitted
operational corrections, build artifacts, private captures and audit evidence
are preserved. No commit, push, additional archive removal or new fix is being
performed as part of this pause. Existing approval remains limited to the six
batches, and continuation requires the user to resume.

All eleven requested Node24 gates ultimately passed, including the unchanged
API-truth gate against the private candidate; earlier network-isolation and
wrapper refusals remain evidence. The complete UI operations suite also passed
with normal local subprocess execution, alongside22 workflow tests. These
results supersede the earlier in-progress statuses without erasing failed
attempts. The application build remains pinned to2ddefac163d5; operational
helper corrections are still uncommitted and their paired UI installation is
held. No UI payload was transferred or staged.

The third bounded Core probe checked616 tickets and93 wallet UTXOs (80confirmed,
13pending), then stopped because the verifier compared a confirmed-only book
with a wallet view containing71 matching confirmed rows plus one pending
listing. Saved Core gettxout responses independently confirm the additional
listing's unconfirmed outputs at546 and6822proofs. The confirmed/pending
comparison requires a verifier correction; no application fault is established
by that assertion. Boost, bond and final repeated checkpoint/mempool comparisons
remain unfinished, so the complete probe is not marked passed.

Both the recovery restore and the fresh safeguard have completed successfully;
no recovery job needs interruption. Preserve both restored clones and all
backup chains. On resume, recheck production identities, full-node and mempool
state, candidate/build hashes, capture provenance, safeguard freshness and
actual capacity before continuing. The intended next steps are the bounded
verifier correction, operational commit/helper installation, separate UI
capacity phases, and only then the controlled four-record repair and rollout.
The existing findings and historical audit prefix remain intact.

The final pause safety receipt confirms HTTP200/ready with Core and index965650
and zero lag. Production Core/PostgreSQL/API/worker/WAL/Caddy identities are
unchanged. The UI provenance timer was restored to its previously active,
enabled state; its naturally triggered verification completed with exit0. No
maintenance timers remain held. Both private restore clusters are stopped,
with no postmaster PID or private socket, and all recovery paths are preserved.
The node has407,621,222,400 bytes free on/data; UI has11,457,499,136 bytes free.
Previously documented storage warnings remain unresolved and visible. All
agent work is paused. Repository hygiene found nothing allowlisted to clean
and its state check passed; whitespace and the protected original audit prefix
were verified. Resume from this checkpoint only after the user returns.

### Second resume and final operational verifier correction

The user resumed the existing six-batch approval. Local temporary build files
and plans were absent after the pause; durable embedded audit receipts and
remote evidence remain available. Rebuild the exact same application commit
2ddefac163d5 rather than substituting a different application tree. The preserved
node candidate re-attests byte-for-byte:6543 runtime entries,191,440,061 bytes,
runtime SHA256ee78a47da73df81665e75354a570df9394a5b17f19cf719f0aa067be41b12b35.

The four-target Core preflight passed again at20:45:09UTC, stable block965665.
The auxiliary transaction proves3593 input proofs,3118 output proofs and475
miner-fee proofs; all five anchor links and the exact three unrepaired invalid
zero events match their documented scope. This remains read-only evidence.
A20:45:33 readiness sample returned503 despite zero block lag. Later readiness
and liveness returned200 at965666 with the worker idle, zero failures and no
pending unresolved/error/deferred/stale candidates. Summary generation occurred
after the first sample; its exact earlier failing predicate was not captured.

The corrected standalone verifier partitions confirmed wallet listings from
explicit pending estimates. Confirmed membership remains exact; each pending
ticket requires an independent current Core unconfirmed/unspent output proof
with exact value, script, address and checkpoint. Pending estimates cannot
contribute to confirmed WORK reservations. Sixteen behavioral tests pass. All728
saved prior response hashes were verified, and the corrected comparison accepts
71 matching confirmed rows plus one independently proven pending ticket while
rejecting missing confirmed rows, amount leakage and absent ticket evidence.
This is a verifier correction, not a change to application or protocol rules.

Private capture identities and environment hashes still match the unchanged
live processes. The isolated cache is empty and retains its recorded inode.
No rotation or recapture was needed. The resumed private API proves its actual
Node24 process runs as UID/GID1000 with no supplementary groups or capabilities,
NoNewPrivs1 and a verified read-only database pool. It reports200/ready at965666.
A fresh bounded full-node comparison remains required before rollout. Operational
helper corrections are committed separately from the already built application.
No application publication or four-record repair has occurred at this checkpoint.


### Second resume: full candidate Core pass and preserved UI capacity stop (2026-09-05, 21:01 UTC)

The unchanged application candidate2ddefac163d5 passed the complete bounded
candidate comparison at Core965667/hash
00000000000000000001e1401b1a833cfec87826ed257ce3a992533f1c0fd408.
The verifier collected29 HTTP and743 Core responses (61,185,665bytes), checked
505 confirmed IDs, all238 definitions,629 full/display listing rows and their
unspent Core tickets,106 public-fixture wallet UTXOs, exact WORK reservations,
three Boost raw carriers, and POWB/INCB integer identities. The final receipt
SHA256 is70e7bcfd41ba3367d6e568368a3a9baa10fcb2c2775128ad3e9646fd23ba720a.
The mempool sequence changed22869782→22871816; this is current inventory
verification, not an atomic mempool snapshot, every-provider signing proof,
whole-chain address completeness proof, or exhaustive historical replay.

A preceding attempt stopped when an output was spent during the probe and
bitcoin-cli returned successful empty stdout for gettxout's null result. Its
failure and spender timing remain preserved. The verifier now decodes that
specific successful response as null so the existing semantic spent-output
check refuses it explicitly. Other malformed/empty RPC responses still fail,
and decimal value lexemes remain exact. All19 verifier tests passed; this
correction changes no application data or arithmetic. The observed wallet/API
inventory briefly lagged the new Core mempool spend; no atomic freshness claim
is made. The subsequent unchanged-fixture probe passed all final fences.

Measured candidate payloads fell from2,204,059 to774bytes for registry counts,
from4,534,991 to400,646bytes for the qualified token directory, and from25,477,951
to10,309,015bytes for the listing display book. Full detail and source-bound
membership comparisons passed; these are measured response sizes for this run.

Operational commit0b63c8604456 was installed with all previous target files
preserved. The paired UI stage/publish reference-search bounds now match the
reviewed finite1048576 candidate limit; other compatibility limits remain.
Node helpers were uploaded only into new root-private directories. Core,
PostgreSQL, API, worker and Caddy identities remained unchanged. Existing
same-day safeguards and physical-backup/WAL filename continuity were checked;
no new backup, off-host transfer, recovery-chain deletion or physical restore
claim is implied by this continuity check.

The exact2d UI rebuilt with all15 surfaces and was staged as
2ddefac163d5-20260905T204437Z. Compatibility closure checked525 dependencies,
1005 edges and527332 search candidates. The managed stage contains796 entries
and217,922,858 logical bytes;572 internal duplicate files saved181,852,944bytes.
Its portable archive was successfully created and verified:185,566,324bytes,
SHA2565e05adbf7d905f2dc4d3540ac389484d21ef71241155c7f73559f1e879cbedea.
The wrapper then refused its final source-capacity gate: free11,039,272,960bytes
was1,703,936bytes below the unchanged10GiB floor plus64MiB reserve plus full
236,449,792byte source allocation. Stage/archive/checksum remain intact, source
is absent, and publication has not occurred. Only this attempt's verified new
transport payload was disposed by its reviewed lifecycle. No historical asset
was removed. A fresh shallow exact-commit source transport with identical full
dependencies is being assessed; the original complete build/source is preserved.

No four-record repair or application rollout has occurred at this checkpoint.
These execution receipts extend existing findings and approvals; they introduce
no duplicate finding IDs. Required stopped-writer, invariant, bootstrap,
production and repository checks remain gating steps.


### Candidate ready; H5-04 funding-parent scope decision (2026-09-05, 21:19 UTC)

The UI source-capacity issue is resolved without removing historical material
or weakening the storage floor. A new shallow detached checkout preserves the
exact application commit/tree and every dependency byte and mode. It saves
12,083,200 allocated bytes compared with the original full source checkout,
which remains preserved. Source transport SHA256 is
72246046ae47a10eb639017d84fe339cf943a54a20397d6d5cac6ba4bc5bddc7.
The installed source/dependency attestor and complete candidate provenance
verification passed for all 15 surfaces, including the NFT alias. Production
normalized dependencies match 6,118 entries / 160,954,989 bytes and fingerprint
74d54e7c58f15d225603104316eab06748209b85c6e2c27f8457ee6967f9b811.
All new verification tmpfs scratch was removed. At completion, the UI root had
10,814,582,784 bytes free, 10,055,680 bytes above the unchanged 10 GiB floor plus
64 MiB reserve. Existing capacity warnings remain applicable. No UI publication
has occurred.

Fresh node preconditions verified both live/candidate runtime fingerprints,
original API/worker process identities and captured environment hashes, and the
four historical repair targets against Core at block 965668. The largest of the
six current persisted cache files is 77,931,434 bytes. The prepared bootstrap
units therefore use a temporary 512 MiB regular-file limit, while repair/gate
units retain 16 MiB; these limits are operational guards, not a proof of a
universal cache-size maximum. Running-log receipts explicitly hash a captured
prefix; complete-log claims require a stopped, stable file. The completed
read-only shadow was stopped successfully without touching production units.

A verifier assumption was corrected before any write: the auxiliary transaction
contains one raw `OP_RETURN OP_13` output, but the unchanged push-only decoder
correctly produces **zero parsed `op_returns` rows**. The whole output script
`6a5d081600ff7f8184ec02` remains canonical transaction/output evidence. The repair
comparator now checks all six exact Core input relations and values, both output
scripts, and exactly 3,593 proofs in / 3,118 out / 475 fee. All 22 comparator
fixtures passed. The extended offline validator independently decodes the
948-byte confirmed transaction and its 80-byte block header, checks addresses,
sequence, scriptSig, witnesses, stored fee, existing anchor fields, event raw
carriers and protected/global invariants. Its 55 checks passed, including a
refusal for the actual newly discovered parent-row condition below. These are
verification corrections, not protocol/parser or application changes.

**Approval decision: one additional existing funding-output record.** The
approved canonical writer would also update the already indexed funding output
`fc57450c502e054ecf23469d88f5249a578799da59d111fe234e50ca593c20e5:3`.
It holds 863 proofs at `17W7JZ9KjjGUwdAyXeGxhzYe2vGe8YTRzA`; the database currently
has null spend-link fields. Confirmed Core bytes prove it is input 0 of the
already documented auxiliary transaction
`4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359`.
The exact proposed additional changes to `proof_indexer.tx_outputs` are:

| Column | Current | Proposed |
| --- | --- | --- |
| `spent_by_txid` | `NULL` | `4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359` |
| `spent_by_vin` | `NULL` | `0` |
| `spent_at` | `NULL` | `2026-08-18T05:09:21+00:00` |

All other funding-row fields, including value, address and script, must remain
identical. The five previously recorded complete ticket-anchor rows must also
remain identical. Their existing timestamps already match the canonical block
header. This would produce six recorded input spend links while retaining the
five original links. It creates no protocol event, credit or transaction and
involves no signing or broadcast. Global economic and historical invariants
remain mandatory.

The header's double-SHA256 binds the timestamp to block 962992/hash
00000000000000000000635d4ae72706ed6d6f4a17299714a3014074d441824b;
transaction position is 1161. The exact before/after funding-row hashes are
fbfeffc2097d8c076903f425efe3a6aecb8044c640ae5ff5fdfbaca77888d1a2 and
002b05bb47ada6c4cfff2e76814dd200d03c8d20177b6e2dcbc2a9bf1360e281.
The complete proposed rows, all five existing anchors, raw transaction/header,
Core parent proofs and review receipts are retained in the audit evidence JSON.
No current amount or spendability claim relies solely on this historical row.

This extra parent record was not explicit in the user's limited repair scope.
**It has not been approved or changed.** The current extended verifier refuses
this baseline, and the prepared unit controller requires that verifier before
either repair writer can start. A future approval requires a separately
reviewed verifier/controller update admitting only these three additional
fields; the existing writer itself needs no protocol change. This is a scope
qualification of H5-04, not a duplicate finding or a completed fix.

No maintenance window began: no production API/worker stop, database repair,
cache rotation, node timer hold, application exchange, deployment or push was
performed at this checkpoint. At 21:18:44 UTC the node returned HTTP 200,
available/ready at tip/index 965669 with zero lag. Core, Electrs, PostgreSQL,
WAL receiver, API, worker and WG identities remain unchanged; all seven
maintenance timers and storage monitoring are active. The application candidate,
UI archive/source/stage and recovery assets are preserved. UI provenance timer
restoration and final repository hygiene are recorded below when completed.


Routine UI provenance monitoring was restored to its original active/enabled
state and completed successfully at 21:19:46 UTC against the unchanged live
release. Caddy identity, the current release manifest and all staged artifacts
remain intact. Publication must re-hold that timer and repeat fresh capacity
and provenance gates. No failure state was reset or candidate provenance
published. The final unit controller passed 19 focused local checks, including
both repair modes refusing the actual sixth-parent condition before any log,
receipt, quiescence action or process launch. The prepared cache/timer helpers
passed 14 checks; they remain unuploaded and unexecuted. Window helper source
and exact hashes are preserved in `deploy/audit5/` and the audit evidence.

Repository review preserves the original audit prefix and all previous audits,
canonical protocol rules, source/release assets and recovery history. The
infrastructure documentation now clarifies the existing push-only OP_RETURN
decoder behavior. SOUL and the remaining canonical product/protocol documents
require no semantic change. Only the newly generated untracked local Python
bytecode file was removed after confirming its origin and hash; no additional
historical archive was removed. `hygiene:fix` found no allowlisted rebuildable
state. The final check and local checkpoint commit do not authorize the new
parent repair or imply production completion; deployment, production checks
and push remain held.

Final checkpoint validation: `npm run hygiene:check` and `git diff --check`
passed. No tracked file was deleted; only the current audit pair changed among
audit records. The local checkpoint remains unpushed pending the scoped repair
decision and required production workflow.
