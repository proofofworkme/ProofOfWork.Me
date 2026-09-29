# Ordered read-only application audit 27

Audit date: 2026-09-28 America/Toronto; observations continued through 2026-09-29 UTC.

## Scope, authority and outcome

The user requested the fourteen application surfaces in the order below, Computer last, connected through the Codex in-app browser and UniSat where supported. This pass used the live browser, public first-party APIs, read-only SSH to both production hosts, Bitcoin Core, read-only PostgreSQL queries, source inspection and existing regression checks. The user approved the wallet connections and explicitly authorized an audit log after the audit. No signature, transaction, purchase, post, contact/folder edit, protocol change, production configuration change, cleanup, commit, push or deployment was performed. The only repository changes are this log and its required note-inventory classification.

**Result:** sampled exact arithmetic, confirmed wallet value and selected chain records agree with Core. The final Core, Electrum, indexer and summary checkpoint agree at 969072 with zero lag. This is not an all-history mathematical or physical-database certification. Read availability remains below the requested standard: one fresh registry-summary probe exceeded its 45-second budget, the full marketplace pagination regression failed at a checkpoint change, and connected wallet authority was temporarily unavailable. Existing storage-retention and mobile/large-read work remains open. One additional low-priority header-label defect is recorded below.

This report does not claim superiority over UniSat or other applications: no controlled comparative benchmark was run. It does not approve shipping any proposed improvement.

### Version and predecessor binding

- Local HEAD and observed node checkout: `b608e73eab41921c10670a5687afcfac782a6f8e` (PR #92).
- Active UI manifest: `proofofwork-ui-release-v3`, release `b608e73eab41-20260928T230900Z`, commit matching HEAD, source tree `baee72a5ed5a40b4a5c1faac8baf6a72709685c1`, deployed `2026-09-28T23:22:12Z`.
- Manifest archive SHA-256: `8e08f7f84e554c2bd881084ec09d0f2d63b51311a7ee160e0d3ea83a0740c802`. This pass read provenance; it did not repeat the prior complete archive-versus-HTTPS byte comparison.
- The required `SOUL.md`, `README.md`, `PROOFOFWORK_IDS.md`, `MARKETPLACE.md`, `OP_RETURN_INFRASTRUCTURE.md`, `MAIL_ORGANIZATION.md`, and repository hygiene instructions were reviewed. The audit inventory, prior finding headings and relevant predecessor/repair sections were reviewed across the audit trail; recent Audits 23–26, approved follow-ups and INCB repair received deeper review. This is not a claim to have rerun every historical audit procedure.
- [Audit 26, including performance and approved-deployment addenda](2026-09-27-production-comprehensive-health-data-integrity-audit-26.md), SHA-256 before this pass: `1ed40ada643c63f0c9f24902b8ffbc6df64b161752a0ec10e9d84aabcf6626c7`.
- [Wallet/pending/INCB repair](2026-09-27-wallet-pending-incb-repair.md), SHA-256: `2f3fff4deebe920a61e64dc81e27d16725180f76fe5ac2a088b9fef36c992eab`.
- [Audit 24](2026-09-26-production-comprehensive-health-data-integrity-audit-24.md) supplies the H24 availability, storage and parity lineage; [Audit 6](2026-09-08-production-health-data-event-storage-audit-6.md) supplies historical status/count scope findings. Existing issues retain their identifiers below.

## Ordered browser results

The connected account was `1KNkUBREnfno2BeV7QsBf8XCWZN6YFfxPH`. Public address/transaction evidence is included for reproducibility; no wallet secrets were accessed. Counts below are time-bound observations, not a promise that pending state remains unchanged. Standalone read surfaces without a wallet control were inspected without inventing a connection flow.

| Order | Surface | Observed result and limits |
| --- | --- | --- |
| 1 | `proofofwork.me` | Redirected to `www`; navigation exposed the requested applications. Cached registry counts refreshed to 508 confirmed, 21 pending, 529 total with a verified-summary status. A later HTTP audit's fresh summary probe timed out; the HTML/assets themselves loaded. |
| 2 | `id.proofofwork.me` | UniSat connected. Header showed 1,092 confirmed/spendable proofs and 546 POWB. Registration-only surface retained the 1,000-proof fee. Registry 508/21/529 and three owned-or-routed IDs loaded. No management or sale operation was performed. |
| 3 | `desktop.proofofwork.me` | Searching `satoshin@proofofwork.me` returned three public files: welcome HTML (1,018 bytes), JPEG and MP3. No duplicate self-send row was observed. Generic connection/readiness text remains in the existing AUD26-03 family. |
| 4 | `browser.proofofwork.me` | Welcome transaction rendered a verified confirmed HTML proof, 1,018 bytes and 546 proofs. Payload SHA-256 matched raw Core bytes. The iframe had an empty sandbox and CSP blocking scripts, connections, forms and frames; images/media were restricted to data/blob sources. No signing/provider access or content execution was attempted. |
| 5 | `boost.proofofwork.me` | UniSat connected. Seven confirmed feed records comprised five posts, one reply and one reboost; no pending feed record. Already-liked/reboosted states were represented. Selected WORK signal valuations recomputed exactly. No social action was sent. |
| 6 | `amo.proofofwork.me` | UniSat connected. Complete-book loading was prolonged, then manual refresh reached Ready with 951 active credit/bond listings, 917 sealed and 34 unsealed. Search found the sampled sealed WORK ticket and its exact frozen terms. The display identified its block/hash/age and required fresh transaction preflight. No purchase/seal/list/delist action was attempted. |
| 7 | `credit.proofofwork.me` | Connected view loaded 236 non-bond credits; the selected DRAIN mint showed 1,000 units, 546-proof registry/minimum rules and WORK reservation behavior. Empty create inputs did not enable creation. No mint/create was attempted. |
| 8 | `wallet.proofofwork.me` | Connected view loaded one credit balance: 546 POWB confirmed and spendable, zero pending delta, no owned listings or credit movements. Transfer was disabled without recipient; default listing amount 1,000 exceeded 546 and remained disabled. Core verified the two spendable base-chain outputs. This wallet does not exercise owner seal/delist or active-listing reservation controls interactively. |
| 9 | `work.proofofwork.me` | Connected dashboard reached Ready: supply 21,000,000, 21,000 mints, 387 holders, 100% minted, zero available. Exact network/floor/frozen values are recorded below. Rounded chart formatting was not treated as authoritative arithmetic. |
| 10 | `infinity.proofofwork.me` | Connected dashboard loaded supply 630,496,569 and value 630,501,483, floor 1.00000779; account balance 546 POWB. Its 476 chart/history events differ in scope from direct mint totals. A reservation-verifying header could coexist with loaded public data, an existing readiness concern. |
| 11 | `inception.proofofwork.me` | Connected dashboard loaded fixed supply 945,662,401,792,509,469 and fixed value 945,662,401,792,509,491.46190218: 47 mints, 46 WORK attachments, 27,932 direct units. The repaired bond's preceding-block witness and arithmetic were independently checked. |
| 12 | `log.proofofwork.me` | Public Log loaded; searching the connected POWB mint returned two confirmed records (token mint and Infinity Bond). One observation had a stale banner count 26,117 while the refreshed cards showed 26,154 total, 26,131 confirmed and 22 pending. The known supplemental-record count scope must not be mistaken for a missing chain record. |
| 13 | `growth.proofofwork.me` | Public Growth showed the same exact network value, 508 confirmed/21 pending IDs and 26,131 actions. AMO flows 11,103,390 = 9,725,286 sales + 1,378,104 fees; 92 sales include credit and ID scopes. Five Boost posts are not contradictory to seven feed items. Unverified Boost monetary metrics remained identified as such. |
| 14 | `computer.proofofwork.me` | Inspected last and connected. Mail showed 23 Inbox, zero Incoming, 11 Sent, one dropped Outbox attempt. Files showed three documents; header intentionally excludes the canonical welcome file and counts two uploaded attachments/22 KB. IDs refreshed to 529 total/three yours; only the two actually owned IDs were manageable. IDs kept marketplace actions separate. Wallet matched standalone balances. AMO eventually reached Ready with all 951 listings at Core-verified block 969072, while an overall refresh and wallet-authority request could still be pending/unavailable. Confirmed balances were retained; spendable funds became Unavailable rather than an invented zero or unsafe authoritative value. No captured Computer console error. |

Computer remains open as the review surface. No claim is made that all transaction-producing controls, all viewports, all accessibility behavior or all local-state workflows passed an interactive end-to-end test.

## Full-node and exact-math evidence

### Canonical checkpoints

Initial pinned checkpoint was 969070, hash `00000000000000000002050db768606e5ab7234f726af8ad6ad2145c3a9efde7`. Core was unpruned, out of initial block download, verification progress 1, with no warnings; txindex and observed auxiliary indexes were synced. API/Electrum/indexer matched. Ledger audit passed with `MAX_LEDGER_TIP_LAG_BLOCKS=0`, snapshot `dc1f94c1129c796d28d3b834`.

Final direct Core read: height/headers 969072, hash `0000000000000000000093f8a49e7bfdea1de28a5abcec362707bbef34c9bb6f`, no warnings, unpruned and verification progress 1. Independent `/health?network=livenet` at `2026-09-29T00:25:55.158Z` reported:

- `ok=true`, `ready=true`, lag/ahead zero; Core, Electrum header, canonical index checkpoint and summary snapshot all matched that height/hash.
- Snapshot `83db54221182fed84774576c`, generated `2026-09-29T00:24:49.374Z`, eligible, 5,710,288 payload bytes; all eight summary coverage keys were at 969072.
- Canonical rebuild complete/inactive, empty fault, worker zero consecutive failures and no active containment.
- Read models: 508 confirmed IDs, 265 confirmed transfers, 26,471 confirmed events. These event counts have a different scope from public Log action counts.

Read-only PostgreSQL inspection covered 9,450 stored transition rows across 959621–969070; no false complete/block-atomic/fee-once/invalid-zero flags were found. This checks stored metadata, not independent recomputation of all 9,450 transitions. Canonical state was Q16 state v3 with network value Q8 `1452083490330453416408103938`.

### Connected wallet and files

Core `gettxout` with mempool inclusion confirmed both outputs unspent and addressed to the connected P2PKH account:

| Outpoint | Confirmed value | Observed block |
| --- | ---: | ---: |
| `b543324e6399f8647a7d802f4e9d786ff4b4e1f43d80fdafb1486c69e9ae96ac:1` | 546 proofs | 967033 |
| `2ae50bf34c9c790c11e6e86459235cc75fd068b8a2e9c7762cef2fc4f13b5ff1:0` | 546 proofs | 968928 |

Sum: 1,092 proofs. API wallet authority was complete when initially checked; a later transient failure is separately documented rather than ignored.

POWB balance: PostgreSQL and API reported 546 confirmed, zero pending. Core transaction `62b9bc7b80d90bfba98d7523e198cd1f01fe9a970a5150dbd35d6536dfe686fa`, block 953322 (`000000000000000000011b6d9d434579f502e786f52b03c02a17bcfd4b6f95c7`), pays the account 546 at vout 0 and carries `pwm1:m:powb` at vout 1. Its inspected parent belongs to the same account: the canonical self-send rule yields 546 POWB. No missing balance was demonstrated.

Welcome transaction `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b` is confirmed in block hash `00000000000000000000d62351dbdee65198745a8ff15b73facf143ec2b49a62`. Core output 0 pays 546 to the account; output 1 carries the mail body. Independently extracted 1,018 bytes hash to `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`, matching Browser. Header file count two versus Files three is explained by `src/App.tsx:24124` excluding this canonical welcome record and requiring an attachment; no file-loss defect is claimed.

### WORK declaration and frozen sale ticket

Core confirmed V8 declaration `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a` at 960600, block hash `00000000000000000001ec938998cde4fd86ee6e3c672a6d3d95200cd8a984ac`. Its 5,593-byte carrier SHA-256 was `1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528`; 5,586-byte body SHA-256 `0ef1432816fb93480b02a5302ce1c074d38f84a38e01150d57cf1df87d68024d`. Registry payment was 546 proofs. The integer rules inspected were:

```text
S = 21,000,000 WORK
A = 10^16 subatoms / WORK
Q = 10^8 Q8 units / proof
F = 25,000 proofs
listingSubatoms = floor(F * S * A * Q / NbeforeQ8)
minimumProofs  = ceil(listingSubatoms * NbeforeQ8 / (S * A * Q))
```

Sample listing `b3ce6c6eeee7aa3895e044b6f2e5eada0bea855ea51eb5b68655c767952dd7f3`, block 962894/index 1093, record vout 1, ticket vout 2:

- `NbeforeQ8=700906162511097604963177833` yields **749030366 subatoms**, displayed **0.0000000749030366 WORK**, and minimum **25,000 proofs**.
- Core ticket output remains unspent at 546 proofs to `bc1qggw7p5xtcv33uduhttphz24apx35u384ld9twk`.
- Confirmed seal `2377da95a9eefe15f5bd36857051daec42a2223baea5bebfdd4339baf6d49c26` was represented in the listing view.
- The displayed terms remained frozen; live network-value movement did not reprice this ticket. This is a sampled ticket check, not verification of every seller signature or a purchase simulation.

Current exact WORK display: network value **14,520,834,903,304,534,164.08103938 proofs**, floor **691,468,328,728.78734114 proofs/WORK**, frozen value **1,776,670,502,897,573,682.61219906 proofs**. Financial authority must retain integer Q8/Q16 operations; rounded chart/USD strings are display-only.

### INCB repaired bond and Boost signal

Core confirmed repaired INCB transaction `ebe60fd108e8830b4741101e6525081387dcf328e81c12fa2b533de0bdbf0d3e` at 968125, hash `0000000000000000000069c13457832a58fd579fe3d654ce239a5a5a8b54400f`. Outputs include 546 to the bond recipient, the INCB mail carrier, 546 to the WORK registry and a `send3` attachment of `18000000000000000000000` subatoms (1,800,000 WORK).

The stored scoped witness `a15d16ce2b3bc363ac1ed091` contains preceding height 968124, hash `000000000000000000011837b393ac8b60920238da37902390ad8629e76002f6`; Core independently matched that predecessor. Its source-row network value Q8 is `840950469793071163780428513`. Integer attachment valuation is `72081468839406099752608158` Q8; adding 546 proofs gives fixed value `72081468839406154352608158` Q8 and whole minted amount **720814688394061543**. These match the repaired record. No second repair is proposed.

For the sampled Boost feed at the initial checkpoint, exact WORK signal uses `floor(subatoms * NQ8 / (S*A))`, then adds the base proof signal. Seven WORK plus 1,092 proofs yields **4,840,278,302,193.51138802 proofs**; `10^10` subatoms plus 546 yields **692,014.32872878**; `10^9` plus 546 yields **69,692.83287287**. A slightly older cached feed valuation was not treated as arithmetic corruption. Five posts versus seven feed records reflects explicit post/reply/reboost scope; Growth's wider social observation counts are another scope.

## Findings and recommendations, deduplicated

### Existing: AUD26-02 / H24-01 and Audit 26 listing-pagination finding — P1 availability work remains open

The existing full marketplace regression against `https://amo.proofofwork.me` exited 1 after reading 800 of 950 WORK listings and encountering HTTP 409 at a checkpoint conflict. Numerous preceding fresh wallet, history, sale and listing checks passed; that does not make the complete gate a pass. This repeats Audit 26's documented tip-transition pagination failure. The standalone and integrated browser eventually showing 951 credit/bond listings does not close the independent full WORK-membership gate.

The final ordered HTTP audit completed thirteen surfaces successfully but Home's fresh registry-summary probe aborted at the 45-second request limit after its HTML/assets loaded. Successful probes still took up to 18.754 seconds (ID summary), 13.755 seconds (marketplace summary), and 13.024 seconds (WORK token). Computer's connected WORK authority twice became unavailable during browsing; its spendable header correctly failed closed, then recovered in an intervening observation. A Ready public AMO display and unavailable wallet authority describe different scopes, not proof that the wallet is safe to transact.

**Recommendation:** retain hard checkpoint and complete-membership requirements. On cursor conflict, discard the entire partial result, pin a new canonical snapshot and restart with bounded attempts and an explicit recoverable state. Where possible, serve immutable pages from the pinned snapshot for the cursor lifetime. Do not append different checkpoints or clear a verified balance to zero. Profile SQL, replay work, serialization, compression, transfer and client parse separately; use small exact overview projections and defer complete history until requested. Release gates should compare the complete ID set/count/hash to a pinned authoritative snapshot and exercise tip change, reorg, abort and cache expiry. Do not solve latency by weakening canonical validation.

### Existing: AUD26-03 and PERF-27-04 — P2 readiness and stale-display clarity

Generic verifying/workspace-selected text can remain after useful data loads. Log's banner retained 26,117 after its cards moved to 26,154. `loadLogHead` at `src/App.tsx:27156` applies fresh activity payloads but updates the count-bearing status only when `silent` is false. This is a concrete additional manifestation of the existing status family, not a new missing-history issue. AMO's block/hash/age and display-only label are useful improvements and should remain.

**Recommendation:** derive count-bearing banner text from the accepted snapshot, or omit counts from transient operation messages. Distinguish public display readiness, connected wallet authority, reservations, and operation-in-progress. Show checkpoint/age for retained reads; require fresh preflight for signing. Test silent refresh and out-of-order completion without regressing the already-fixed read fences. Cache-policy risk remains open; this pass did not induce a proxy outage or prove a day-old fallback was served.

### AUD27-01 — P3: dropped mail is included in the header's pending-style “unconfirmed” total

**New narrow observation, related to historical H6-11 status partitioning but in Computer's mail header:** the account has one Outbox record with explicit `status=dropped`, txid `8e9074486fa0a6a75fd01f20c8a41a56ccd964be569e61e81e92c60266c001f0`. Core `getmempoolentry` and indexed `getrawtransaction` both returned -5 (absent). Outbox correctly says “Pending and dropped broadcasts” and the row/details say Dropped. The header nevertheless shows “1 event / unconfirmed” with pending tone and “1 mail event” detail.

`isOutboxStatus` at `src/App.tsx:4028` intentionally includes pending and dropped. `pendingMailEvents` at `:24186` counts the entire Outbox, feeding `pendingActionEvents` and the header at `:24316`. The API's outbox count similarly includes non-confirmed records by design. Thus Outbox membership is correct; the aggregate label can imply an in-flight event that does not exist. No balance impact or fee reservation defect was demonstrated.

**Recommendation:** count explicit pending lifecycle states for the active-pending header and represent dropped attempts separately, retaining their history and rebuild action. Alternatively label the total explicitly as pending/dropped attempts instead of implying current pending activity. Acceptance: a dropped-only mailbox does not show an active-pending event; a pending record does; confirmed/dropped transitions update exactly once. Preserve Outbox's historical record, do not delete it as stale storage. Priority is low because the detailed status is correct and no spend authority depends on this observed count.

### Existing: PERF-27-01 / PERF-27-02 — remaining speed and data-handling work

Prior Audit 26 measured the reduced App chunk at 705.80 KB decoded / 169.86 KB gzip after PR #89, still above the 500 KB warning. Those are prior measurements, not new measurements for PR #92. Prior mobile LCP 3.72 seconds was not repeated under controlled identical conditions here. The current final eligible server snapshot is about 5.71 MB. Keep the implemented refund lazy-loading, initial Log request deduplication, Boost media coalescing and provider polling improvements closed unless new evidence contradicts their tests.

**Recommendation:** split workspace code and defer signing-only dependencies behind real route/action boundaries; maintain a bounded cache keyed by network, wallet, canonical hash and query. Benchmark cold/warm mobile readiness, bytes, parse/long tasks and memory with the same profiles and fixtures before/after. Establish budgets for time to exact verified data and complete marketplace membership, not just shell rendering. A claimed competitor advantage requires an equivalent task/account/network benchmark.

### Existing: storage, parity and monitoring lineage remains open

AUD26-01 / H24-04–06 retention/capacity, H24-07 failed-unit classification and H18-06 PostgreSQL checksum coverage remain unresolved. Current short-window headroom is healthy enough for read-only operation; it does not explain or close historical rapid growth. No fresh evidence reopens the prior repaired INCB arithmetic, five index residues, Desktop deduplication or V8 preactivation relic fixes. Passing focused tests does not certify all historical data.

## Storage and operational inventory — no deletions authorized or performed

Host measurements are decimal bytes, from separate observations rather than an atomic cross-host snapshot. Preserve chain data, database history, protocol forms, replay witnesses, rollback material and audit evidence until their dependencies and retention purpose are documented.

| Area | Observed allocation/headroom | Classification and next review |
| --- | ---: | --- |
| Node `/data` | 475,405,189,120 available of 1,764,768,071,680; final API sample 475,407,126,528 available | Roughly 73% used. Existing historical growth concern remains; short-term stability is not a trend proof. |
| Node root | 74,777,010,176 available; final health 74,773,098,496 | No immediate capacity alarm in this sample. Inode use approximately 6% root / 1% data. |
| Node PostgreSQL | 36,639,710,231 database bytes | Transition table about 35,389,358,080 (96.6%); snapshots 672,940,032. Do not truncate/vacuum-full/compact on an audit assumption. Profile historical payload duplication and prove replay/restore requirements first. |
| `/data/proofofwork-incb-final-source-replay-20260925T022000Z` | 89,525,575,680 | Existing critical-review replay root. Require evidence preservation, running-process/cluster/dependency checks and separately approved disposition. |
| `/data/proofofwork-release-backups` | 9,293,717,504 | Existing retention review, not disposable because older. Current archive/provenance health was positive but checkout-count retention warning remained. |
| Node API cache | 172,126,208 | Small relative to replay/database consumers; no cache clearing justified by this measurement. |
| Other node rehearsal / production backup allocations | 20,162,818,048 / 20,256,141,312 from monitor | Retained recovery evidence; exact path/dependency manifest required before any proposal to remove. |
| UI root | 19,544,489,984 available; filesystem approximately 49% used | No immediate exhaustion. Caddy active; an inactive nginx check is not a finding on this Caddy host. |
| UI `/var/tmp/proofofwork-deploy` | 6,614,618,112 | Classify source/staging/payloads against current and rollback release manifests. Current b608 source staging remains live release evidence. |
| UI release backups | 8,010,674,176 | Preserve until a user-approved retention plan verifies recovery. Automatic prune timer remains disabled as recorded in prior audit. |
| UI `/var/www` / `/var/log` | 229,863,424 / 673,763,328 | Live served files and logs; no blanket cleanup proposed. |

UI helpers `/tmp/pow-audit26-stream-ui-bundle-c64963.py` (7,557 bytes, SHA-256 `2ed410286d6081a2b82e7ff26d9ffb9f202b0a7f0ea41d91db1ac2751f4b5914`) and `/tmp/pow-audit26-ui-cutover-c64963.py` (6,887 bytes, SHA-256 `df34ce6fac1be26b670065726db40ee16f4d3a3c776add773f8e622e87f1f599`) remain. These are small execution-evidence candidates for manifest/archive review, not meaningful capacity wins. The prior 33-byte node probe was not rechecked this pass.

Node database had no invalid indexes in the inspected catalog; checksums remain off. No physical page scan, complete amcheck, fresh isolated restore, or all-history raw transaction comparison was performed. Available node RAM was approximately 117.1 GB of 134.1 GB; swap used about 1.03 GB; observed load 2.40/2.77/3.33. These point samples do not establish peak capacity.

Thirty-two failed node units included historical one-shot failures; do not interpret the count as 32 currently broken services. A current API observation monitor exited severity 2 with recent route errors/latency: marketplace 20 requests, six server errors, p95 12.300 s and maximum payload 4,088,894 bytes; ledger 15 requests, three slow, p95 12.837 s and maximum payload 5,428,017; registry-summary three requests p95 29.544 s. Window was approximately 600 seconds near 00:10 UTC. Checkpoint refusals are included among server errors; this is availability evidence, not proof of chain corruption. No external alert-delivery certification was made.

Before any future deletion, produce an exact-path manifest with size, hash where appropriate, owner/purpose, live process/mount/cluster/symlink dependencies, rollback coverage and a retain/archive/remove decision. Compare time-series allocated bytes and deleted-open files to attribute growth. User approval must cover the resulting concrete deletion list. Never infer that old notes, chain-backed rows, migration forms or a dropped transaction are garbage.

## Verification record and reproducible next gates

Passed existing local checks in this pass (local Node v22.23.2; production node observed v24.18.0/Unicode 17):

- `npm run check:bond-exact-arithmetic`
- `npm run check:canonical-order`
- `npm run check:work-amo-v8`
- `npm run check:fee-rate-precision`
- `npm run check:wallet-utxo-refresh`
- `npm run check:surface-read-state`
- `npm run check:read-projections`
- `npm run check:api-truth`
- `npm run check:client-read-containment` (43 checks)
- `MAX_LEDGER_TIP_LAG_BLOCKS=0 npm run audit:ledger` against production, at the initial pinned checkpoint.

`POW_API_BASE=https://amo.proofofwork.me npm run check:marketplace-regressions:full` **failed**, as described above; not a complete marketplace pass. An earlier invocation against the default localhost failed to connect and is only a harness setup mistake. The attempted production `scripts/check-proof-indexer-parity.mjs` invocation could not start because that script is absent from the deployed package; no production files were installed to work around it. A future approved verification environment should run the same committed reader against a read-only DB connection, then independently replay/compare historical data with Core. This audit's selected SQL and Core checks do not substitute for that gate.

The first network-enabled surface audit emitted completion for all fourteen surfaces, but piping npm's banner into a JSON parser caused the report wrapper to fail. Its structured result/timings were not retained, so it is not used as the final gate. A restricted-network retry failed DNS/fetch immediately and is not a production outage. The corrected direct network-enabled command was:

```sh
node scripts/audit-production-surfaces.mjs --timeout-ms=45000
```

Final result: **13 passed, 1 failed; exit 1**. Every shell had four checked assets. This gate validates configured route/API contracts, not all connected wallet flows.

| Surface | Shell ms | API probe ms / outcome |
| --- | ---: | --- |
| Home | 1,140 | Fresh registry summary aborted at 45-second limit |
| ID | 554 | ID summary 18,754 |
| Desktop | 439 | Log summary 3,929 |
| Browser | 422 | Activity summary 8,410 |
| Boost | 489 | Feed 3,676 |
| AMO | 512 | Marketplace summary 13,755 |
| Credit | 613 | Token summary 3,389 |
| Wallet | 457 | WORK token 13,024 |
| WORK | 448 | Summary 9,934; floor 7,152 |
| Infinity | 538 | Summary 2,505 |
| Inception | 437 | Summary 2,697 |
| Log | 455 | Summary 3,363 |
| Growth | 448 | Summary 2,333 |
| Computer | 130 | Health 655; consistency 4,399 |

Suggested order for the next audit/improvement approval: (1) checkpoint-stable complete listings and fresh-read latency, (2) reproducible all-history parity/replay and database recovery coverage, (3) exact storage attribution and an approved retention manifest, (4) count/readiness label corrections, (5) measured route splitting and smaller exact projections. Every math-affecting change must preserve chain-declared version rules, canonical ordering, fee-once behavior, integer rounding, rejected-event zero contribution, frozen listing terms and historical replay, with independent Core evidence before shipping.

## Audit-log hygiene and handoff

This is evidence-only: canonical protocol/product/operating docs and SOUL require no semantic change. Prior audit and repair history remains intact. The new note is classified as `ledger-and-audit-evidence` in `repository-hygiene.json`. No generated artifact was intentionally regenerated in place. The safe cleanup allowlist and matching root logs were absent before the hygiene pass; `node_modules/` is ignored and is not a cleanup target. `npm run hygiene:fix` reported no allowlisted rebuildable state, so it removed nothing. `npm run hygiene:check` and `git diff --check` passed. Local predecessor links resolve. Final reviewed scope is this new audit note plus its one inventory entry; no tracked deletion, staging or commit was made.

Future agents should append a dated follow-up or reference this report, preserve the identifiers above, distinguish newly reproduced defects from already-fixed issues, and record exact revision/checkpoint/commands/outcome for any closure. A green health endpoint, sampled arithmetic or an eventual Ready badge alone does not close the failed full-pagination gate or certify all data.
