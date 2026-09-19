# Production health and data-integrity audit 17

Audit date: 2026-09-19. Read-only production observations began around 06:31 UTC,
resumed around 13:07 UTC, and concluded around 13:19 UTC. These are separate
checkpoints on a moving chain, not a single frozen database image.
Local source: `7e55a36` (`Fix UI release retention classification`).

**Result: operational, with unresolved integrity, capacity, availability and
rendering findings. This is not an all-clear or proof of universal mathematical
correctness.** Existing findings retain their original identifiers. No production
data, historical evidence, ledgers, configuration, backups or caches were changed
or removed. Only this approved report, its evidence receipt, and repository
hygiene classification were created/updated locally. No commit, push or deployment.

## Scope and previous evidence

Read the required operating and canonical documents before production checks:
SOUL, README, PROOFOFWORK_IDS, MARKETPLACE, OP_RETURN_INFRASTRUCTURE and
MAIL_ORGANIZATION, plus REPOSITORY_HYGIENE. Reviewed prior audit/issue records,
including recovery addenda, protected ledgers and the audit-16 cleanup appendix.
The evidence receipt hashes the prior audit files as read; these hashes establish
which versions this report follows without rewriting their conclusions.

Especially relevant predecessors:

- [Audit 12](2026-09-17-production-comprehensive-health-data-integrity-audit-12.md):
  late follow-up documents the exact four missing raw transactions, participant,
  reference, mail, timestamp and INCB alias discrepancies reproduced here.
- [Audit 15](2026-09-19-production-recovery-and-verification-audit-15.md):
  physical backup/WAL recovery and retained lost-slot evidence.
- [Audit 16](2026-09-19-production-comprehensive-health-data-integrity-audit-16.md):
  approved UI archive cleanup, nine protected rollback roots and retention fix.
- [Audit 6](2026-09-08-production-health-data-event-storage-audit-6.md):
  unresolved semantic/UI issues, including H6-18 status-banner units.

Systems: node VPS `65.108.122.87`, UI VPS `77.42.91.106`, PostgreSQL proof_indexer,
Core, Electrs, index worker, API/internal API, WAL receiver, Caddy, backup/retention
and health units; public Home, IDs, Desktop, Browser, Boost, AMO, Credit, Wallet,
WORK, Infinity, Inception, Log, Growth and Computer surfaces.

Methods: read-only SSH/system inspection; bounded read-only SQL (including
repeatable-read projection parity); Core RPC; existing audit/check scripts;
independent integer calculations; public API and disconnected browser inspection.
No private keys or signing were accessed. Browser actions did not submit protocol
transactions. API reads may cause the application's ordinary internal refreshes.

## Health and capacity

| System | Observation | Assessment |
| --- | --- | --- |
| UI root | 39,973,924,864 total bytes; 24,164,335,616 used; 14,125,395,968 available; df 64%; inodes 4% | Recovered, but limited reserve |
| UI compute | 2 CPUs; approximately 100% idle sampled; load .14/.04/.01; 580 MiB used of 3.7 GiB RAM, 3.2 GiB available; no swap | No sampled pressure |
| Node root | 98 GiB filesystem; 25 GiB used, 69 GiB available; 27%; inodes 6% | Healthy reserve |
| Node /data | 1,764,768,071,680 total bytes; 1,266,666,188,800 used; 408,381,108,224 available; 76%; inodes 1% | Existing warning persists |
| Node compute | 32 CPUs; load 2.15/1.57/1.81; 94–95% idle; no sampled iowait; 16 GiB used of 124 GiB RAM, 108 GiB available | No sampled pressure |
| Node swap | 629 MiB of 15 GiB allocated; sampled swap activity zero | Allocation alone is not active pressure |
| Database | 30,373,362,711 bytes initially; 30,544,477,207 around 13:13 UTC | Grew 171,114,496 bytes during observation interval |

The UI VPS serves static assets/Caddy proxy; no local PostgreSQL, MySQL, MongoDB
or Redis service was found. The production database is on the node VPS. Therefore
UI disk recurrence is principally release/rollback/log/temp accumulation, rather
than a locally growing application database.

UI available space is about **13.15 GiB**: only about 3.15 GiB above the 10 GiB
deployment floor and 1.15 GiB above the 12 GiB warning reserve. The backup tree is
about 19 GiB, including rollback collections (~6.0, 3.6, 3.2 and 2.6 GiB) and
release archives (~2.7 GiB). These classifications may involve hardlinks; do not
sum overlapping inventories or assume all reported logical sizes are reclaimable.
Logs ~606 MiB and /var/tmp ~640 MiB are much smaller contributors.

UI release prune **explicit dry-run** succeeded: 11 verified archives, zero
unverified, zero candidates; nine complete protected rollback roots retained.
The failed unit timestamp at 00:10 predates the approved tool fix; it is not proof
that the corrected command still fails. Storage health reports success. Existing
H5-01/H13-01 capacity risk remains: protected roots can grow, new deployment
archives require peak headroom, and a reporting/dry-run job does not automatically
retire future artifacts. No additional safe deletion was established here.

Node /data available space decreased about 981 MB between initial and later
samples. Do not extrapolate that short mixed-workload interval as a fixed rate.
Largest database relation at initial measurement was
`work_amo_block_transitions`, 28,989,317,120 bytes; ledger_snapshots 816,775,168,
events 155,320,320 and transactions 106,520,576 bytes. Transition witnesses dominate
database growth and must not be purged as ordinary cache.

Node storage inventory (approximate du values): Core tree 910 GiB, Electrs 60 GiB,
PostgreSQL backup tree 119 GiB (physical 53 GiB, logical 44 GiB, recovery evidence
9.6 GiB and H7-02 recovery 13 GiB), tablespaces 28 GiB, other app backups 14 GiB,
release backups 11 GiB; audit safeguard 11 GiB, one restore tree 21 GiB and other
restore/recovery trees 2.2/3.7 GiB. Active API cache 81 MiB; quarantined cache
93 MiB; prior-audit cache 256 MiB; /tmp 3.2 GiB; /var/tmp 543 MiB including deployment
369 MiB; logs 956 MiB including journal 782 MiB and PostgreSQL 100 MiB.
These are recovery/evidence candidates for classification, not a deletion list.
The backup symlink `/var/backups/postgresql/16-main` points into the physical
backup tree and must not be counted twice.

**Backup refill risk continues:** the logical-backup script still specifies
`keep=7`, although three dump sets currently occupy the retained collection.
Sept 17/18/19 dump sizes are 15,081,450,894 / 15,505,341,068 / 15,890,347,429 bytes.
Four further daily sets can consume roughly another 64 GB, before growth. A
one-time cleanup is not a durable retention-policy correction. Node H10-02
storage-health warning is expected at 76%. H10-03 release-health still reports
22 checkouts against a target of nine, while all 35 archives verify and current
provenance count is one. The old .git/index permission fault is resolved.

Network counters are cumulative interface/process observations, **not provider
monthly transfer usage**: UI received 1,150,557,116,655 and sent 149,913,166,098 bytes,
with zero sampled interface errors/drops; Core received 16,654,036,812 and sent
12,098,790,003,567 bytes over its process lifetime. Provider quotas/billing were
not available to this audit.

## Services, database and backups

Core, Electrs, PostgreSQL 16, pg_receivewal, API, WireGuard-facing API and worker
were active. Sampled service restart counters were zero; this does not exclude
manual historical restarts. Caddy was active with zero sampled restarts.
Core was unpruned mainnet, not in initial block download, verification progress 1,
no reported warnings, 124 peers; txindex, coinstats and basic-filter indexes synced.
`verifychain 3 6` returned true; this is a recent six-block check, not full-history
reverification. At the resumed checkpoint, Core/Electrs/index/summary agreed at
967710, hash `00000000000000000000e742754258610c242f94c2ba76bc19f667c823839c3a`.

PostgreSQL: no invalid/not-ready indexes, no unvalidated constraints, zero reported
deadlocks, no sampled idle-in-transaction connection; autovacuum active. Dead-row
estimates did not establish uncontrolled bloat. Cumulative temporary I/O
1,487,747,081,125 bytes across 112,795 files is historical workload, not currently
resident temporary waste. Physical data checksums are OFF, so a null checksum
failure counter is not evidence of verified physical integrity. No full page/index
physical scan or restore drill was performed.

The repaired WAL receiver remains streaming: `pg_receivewal_service` active,
reserved, sampled lag 20,320,088 bytes; local pg_wal about 80 MiB. Physical backup
success at 04:54:27 UTC and logical success at 03:32:28 UTC were observed. The newest
logical dump set's SHA256SUMS validated both `proof_indexer.dump` and `globals.sql`
at low I/O priority. Fresh physical set about 18 GiB; Sept 7/14 sets 13/16 GiB;
retained lost-slot WAL 5.8 GiB and current archive ~814 MiB. Prior recovery remains
operational; checksums of a dump do not establish restore/PITR success or off-host
RPO. Preserve the lost-slot evidence.

Recent warning-priority system journal and 24-hour kernel-error sample were empty.
Application logs around 13:10–13:11 still report accepted proof-index fallbacks
without current coverage proof and unavailable fresh wallet reads. AMO browser
console also reports complete-book hydration timeout. These are unresolved
coverage/availability signals even when `/health` reports ready and worker failure
counts are zero. No blanket claim of clean logs is made.

## Data integrity and event tracking

Population-wide structural checks found zero parent transaction status/height/index
mismatches, zero stored confirmed block/hash disagreements, zero duplicate canonical
heights, zero duplicate physical event identities (network/txid/protocol/vout/
ordinal/kind), no orphan participants/references, and no missing participants for
valid confirmed events. Shared positions with different derived kinds are not
necessarily duplicate accounting. ID registration source checks passed for 505 IDs.
Mail transaction status alignment passed. Normalized vin/vout counts match all
available raw records; all 30,598 examined inputs have values; no negative fees or
stored non-null fee arithmetic discrepancies were found. These do not replace
independent replay of every historical economic transition.

All **25,542 available confirmed raw transactions** decoded and recomputed to their
stored txids, with zero mismatches. Twelve recent confirmed transactions also
matched Core bytes and canonical blocks. Four confirmed auxiliary external-spend
rows still lack raw_tx/raw_hex (H9-03, same set as audit 12):

| Transaction | Height | Core-normalized inputs/outputs |
| --- | --- | --- |
| `8601e0b83423e9f51aeb128b7d401d211828df9c623db7e55b5eb6b6332df9cf` | 966878 | 12 / 2 |
| `939366d09f6af994dae3a5b848c490fdd7524c95e3e6db30d55e585df0a4d76c` | 966199 | 30 / 2 |
| `4ca4fa5b03f871ee90863cf283696c692db7287ef672f8d815bc0ecf9695f212` | 966498 | 7 / 2 |
| `4c079144b315ca08a846e7e7af3d37f5c96419a94f06af8384dc73e1ca307359` | 962992 | 6 / 2 |

All four canonical block bindings and normalized input/output counts match freshly
fetched Core data; all have zero event dependencies and source
`canonical-listing-outpoint-scan`. This preserves the earlier normalized repair,
including H5-04's historical transaction, but does not restore replayable raw
evidence. Proposed correction remains an approved, Core-verified projection repair
and writer invariant; no historical ledger rewrite is warranted by this result.

A repeatable-read direct invocation of deployed canonical relation and mail
extractors completed, avoiding the broad API audit timeout:

| Existing finding | Current result | Impact / correction |
| --- | --- | --- |
| Audit-12 event metadata regression | 1,816 valid confirmed events lack block_time or event_time: 945 listings + 871 seals; previously 1,745 | Growing chronology/evidence gap. Derive timestamps from verified canonical parent blocks and fix writer atomically after approval |
| Audit-12 participant drift | Expected 125,817; stored 125,862; 45 extra, zero missing | Spurious address/search attribution; compare writer/extractor and review exact tuple repair |
| H9-04 | One missing INCB ticker ref; no extra refs; expected 56,065 vs 56,064 | Invalid-event discoverability; preserve invalid historical record and restore only missing projection relation |
| H9-05 | All 616 mail rows present; no extra/missing/duplicate rows; 46 message projection differences | Existing attachment-normalization drift; inspect exact credit fields before approved rebuild |

Relation population: 26,402 events (26,224 confirmed, 178 pending) at its own
checkpoint. Participant extra-set hash remains
`7910ecb110197ec85886e87efb8226d0fe15d33ca08a664736952a5198c5bef6`.
Mail mismatch-set hash remains
`818317e1454be50cb3b841305d40124746430a58df2dc7fbf1e25ff2189036ab`.
Missing reference is invalid transaction
`b00b9451bded7d2b7d339556ad2dc5d375e5b52ad877a1d3e2b29149dfc72ccf`,
current event 4079924. Event IDs are rematerializable; use txid/protocol position
for durable identity. Identical hashes support continuation, not new issue IDs.
The current parity helper reports the `message` field; audit 12 narrowed these
same 46 differences to attachedCredits. No claim that message prose is corrupted.

File attachment table contained zero rows, so a zero attachment-hash mismatch count
would be vacuous. A known public Browser HTML receipt rendered verified/confirmed,
1,018 bytes, SHA256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`.
This sample does not certify all file objects or wallet-local content.

## Math verification

Independent integer recomputation passed all 945 stored V8 terms examined:

- `amountSubatoms = floor(25000 * 21000000 * 10^16 * 10^8 / N_before_Q8)`.
- Minimum price uses integer ceiling of `amountSubatoms * N_before_Q8 /
  (21000000 * 10^16 * 10^8)`; unit price 25,000.
- `N_after = N_before + bond`.

All 8,053 initially sampled AMO transition witnesses (959621–967673) were consecutive
and hash-contiguous, with complete/fee-once/invalid-zero/block-atomic flags true.
The state-hash boundary at 960601 is the documented Q16 activation with continuous
network value, not a newly classified corruption. These are stored-witness checks,
not full independent reconstruction of every on-chain input.

All balance rows examined were nonnegative finite integers, with zero aggregate
pending deltas. WORK 357 rows sum to `210000000000000000000000` Q16 subatoms,
exactly 21,000,000 WORK; POWB 11 rows sum to 630496569; INCB seven rows sum to
224847713398447926. All 46 confirmed valid INCB mints pass integer-quotient issuance
and `issuanceQ8 = proofPayment * 10^8 + attachedWorkLiveValueQ8`.
An initial SQL `floor(numeric / scale)` probe produced three apparent differences
because division rounds its result scale; exact `div(numeric, scale)` yielded
zero mismatches. This is an audit-query correction, not a protocol defect.

**Existing audit-12 INCB representation discrepancy persists:** 39/46 records have
`issuanceNetworkValueSats` inconsistent with exact Q8; 39 also have inconsistent
decimal dust aliases. Example tx
`875cd28607cc38608ebec93dcabb2b9ee25ab8425308dd03cc0b4532e05dbe13`:
Q8 `293987255080509083181` means `2939872550805.09083181`, but alias is
`2950699258666.0571579`. Q8 dust is 9083181 (0.09083181 proofs), alias 0.0571579.
Source API normalization prefers Q8. Exact issuance arithmetic passes, while
stored representations disagree; do not infer that canonical issuance should
change. Derive aliases only from authoritative integers and test every consumer
before approving projection normalization.

At API snapshot `40f8fbc834f4b8976527cc47`, height 967710, independent Python integer/
Decimal checks established matching snapshot IDs across WORK, Growth, POWB, INCB
and consistency, exact WORK/Growth network equality, and floor/live/frozen division
by 21,000,000. WORK network Q8 `838759919548865588993453643`; floor Q8
`39940948549945980428`. Displayed network is
8,387,599,195,488,655,889.93453643 proofs; floor
399,409,485,499.45980428 proofs/WORK. INCB supply plus fixed dust reconciles to
224,847,713,398,447,947.9358206 proofs; POWB 630496569 plus 4914 fees = 630501483.
Growth fee/sale/flow totals 1271634 + 9575286 = 10846920 also agree.

Canonical API consistency reported green and no missing Log events. That is a
specific aggregate check and does not override failed relation/mail parity or
missing raw evidence. Universal math consistency across all historical rules,
ledger states, user paths and chain inputs remains unproven.

## Mempool, APIs and rendering

At a stable height-967710 fence, every one of 179 indexed pending transaction IDs
was present in both bracketing Core mempool snapshots; zero absent. Core held
78,731 mempool transactions at that resumed sample. Initial mempool usage was
228,818,192 bytes under a 2 GB cap, unbroadcast zero. Indexed protocol visibility
is a subset of the full mempool; this does not prove ingestion of every possible
protocol transaction or future pending/reorg correctness.

The surface audit completed successfully (06:33:23–06:35:38 UTC): 13 hosts, each
HTML 200 and four required assets, with data validators passing. Boost was checked
separately in browser. Data-read latency remains material: AMO 17.240s, WORK
14.093s, Wallet 12.801s, Credit 8.394s, others often 5–8s. H10-05/H12-06 slow reads
persist. Full AMO/Infinity books did not reliably hydrate; previews explicitly
reported incomplete loading, and AMO logged a timeout. Treat these as partial
views, not verified complete books.

Manual browser checks saw Home/IDs registry data, public Browser content, Boost
feed, AMO summary, Credit directory, disconnected Wallet, WORK/Infinity/Inception
figures, Log confirmed/pending labels, Growth and Computer. Computer was checked
last and its WORK panel eventually loaded 357 holders, exact floor/network values,
21 million minted and 82 sales. Initial IDs/Computer zero/loading displays are not
proof of empty canonical state. No connected wallet, signing, all-history
pagination, reorg exercise, all viewport states or private/local content audit was
performed. No claim that every address/object was rendered and visually verified.

**H6-18 reproduced in Computer:** status says “WORK floor
8,387,599,195,488,655,889.93453643 proofs”, which is total live network value. The
main panel correctly shows 399,409,485,499.45980428 proofs/WORK. This is a dimensional
label defect, not the displayed panel's division failing. Render the floor field
with proofs/WORK, or label the network total accurately. It remains unresolved.

Summary-size risk (H7-01/H10-07): actual configured compact limit 20 MiB
(20,971,520 bytes), SQL limit 22.5 MiB (23,592,960), overriding documented defaults.
Measured SQL representation 20,290,803 bytes; Python compact serialization
19,315,669 bytes (serialization measurement, not a guarantee of identical JS bytes).
Respective headroom is ~3.30 MB and ~1.66 MB. Compare each representation against
its own limit; do not compare SQL bytes to the compact cap. Growth can again
trip admission/availability limits before disk becomes full.

## Validation outcomes and limitations

Local checks passed: canonical-order, work-precision (Q8), work-precision-v2 (Q16),
bond-exact-arithmetic, work-amo-v8, api-truth, hardening, ui, worker-containment,
surface-read-state and node-ops. These fixtures establish tested invariants, not
full live-chain equivalence. Synthetic expected errors in containment logs are
fixture behavior, not production incidents.

- `check:live-data` fails the known source-shape assertion requiring direct await
  of marketplaceSummaryPayload; current code uses deduplicatedSummaryRead wrapper.
  Source/test disagreement remains, not independently demonstrated math failure.
- `check:ui-ops` completed boundary fixture output but the bounded combined run
  expired; the full command is not counted as passed.
- `check:mail-regressions` exited zero with only the npm header and no concluding
  report; treated as inconclusive, not a success receipt.
- Full cross-ledger audit failed on a fresh canonical read (initial 503/catch-up;
  retry WORK token-history request exceeded 45s). No complete ledger proof.
- Broad parity and strict ID audit each expired at the 240s bound without final
  reports. Focused SQL/extractor checks above add evidence but do not silently
  replace the complete suites. Existing H10-06 audit boundedness remains.
- H6-01/H6-02 Boost ownership/unfollow source findings were reviewed historically
  but not freshly reproduced here; no resolution claimed. Other historical
  adversarial UI findings without a current reproduction are likewise not closed.
- No fresh full database restore/PITR, physical integrity scan, genesis replay,
  off-host backup verification, provider quota inspection, or authenticated wallet
  workflow was performed. These are explicit coverage gaps.

## Actions, approvals and next audit

Actions taken were read-only inspections and bounded checks, followed by this
approved local audit record. An initial retention-tool invocation was rejected by
automatic approval review because it lacked explicit dry-run semantics; it did not
execute. After inspecting the command interface, explicit `--dry-run` succeeded.
No unresolved permission block remains for this audit. No production cleanup was
performed; caches/temp/old backups were inventoried, not presumed disposable.

Recommended follow-up, in priority order:

1. Approve a capacity plan with projected database/backup growth, deployment peak
   requirements and rollback dependencies. Review seven-day logical retention and
   22 node checkouts; define off-host recovery before reducing protection. No
   current artifact has been newly approved for production deletion by this log.
2. Approve narrowly scoped, reviewed projection repairs for existing H9-03/H9-04/
   H9-05, timestamps, participant drift and INCB decimal aliases. Capture exact
   before/after sets and fix originating writers first. Preserve chain history,
   canonical economic terms, ledgers and incident evidence.
3. Fix broad-audit boundedness/fresh-read reliability and rerun complete ID,
   relation/mail, cross-ledger and all-object chain reconciliation at a fixed
   checkpoint. Require explicit passing reports, not exit codes alone.
4. Correct H6-18's status units and resolve full-book hydration/fallback coverage;
   test confirmed/pending/dropped/reorg and connected-wallet rendering paths.
5. Perform an isolated restore/PITR drill and a suitably scheduled physical DB
   integrity check. Record recovery point, duration and off-host availability.

No new independent issue ID is assigned: current discrepancies match previously
recorded causes; timestamp population has increased and capacity/growth forecasts
have been refreshed. Future agents should begin with this report and the linked
predecessors, compare stable mismatch hashes/txids, and append new verified outcomes
rather than duplicate issues or silently mark timeouts as passes.

## Repository handoff

Canonical docs and SOUL reviewed; this audit changes no protocol/product behavior,
so no synthetic canonical-document edit was made. Prior notes, audits, ledgers,
release artifacts and history preserved. Evidence receipt contains predecessor
hashes, retained local check output and the full successful surface-run result;
SSH observations and focused-query results are summarized above. It is not a full
raw database export. `npm run hygiene:fix` found no allowlisted rebuildable state and deleted nothing.
`npm run hygiene:check` passed; `git diff --check` passed. Final status contains only
this report, its evidence JSON and the two manifest classifications; ignored
node_modules is preserved. No tracked deletions, staging or commit.

[Evidence receipt](2026-09-19-production-comprehensive-health-data-integrity-audit-17.evidence.json) SHA256:
`188a62ef43c6dd033b5a4ac61009242fe5dbe6d22a5d6e4bf9369f58ccae385c`.

## Ordered read-only application follow-up — 2026-09-19, 14:20–14:35 UTC

User explicitly requested a fresh ordered review and approved appending its
completed findings only. The pre-append report SHA256 is
`29cda89dedc7c79c1a330ed6a1c04d0b07eaf957d264971fca4c809672c0163b`.
The prior audit trail reviewed above remains the baseline; its issue index and
relevant audit-6, audit-12, audit-14–17 findings/recovery addenda were reviewed
again before this pass. Existing working-tree report/evidence/manifest changes
from the preceding audit were preserved. No code, config, production records,
logs, backups, infrastructure or ledgers were modified. No restart, deployment,
cleanup, signing or broadcasting occurred. This append is the only repository
content change in this follow-up.

### Ordered page and service review

The browser review followed the exact requested sequence below. Per-surface
availability/API probes ran during each corresponding stage. Shared API calls
use the Computer API hostname; the Computer application itself and its final
health/consistency review were deferred until all 13 standalone surfaces had
been reviewed. Boost is absent from the existing surface runner, so it received
a separate feed/browser/Core audit in position five. Every automated HTML probe
returned 200 and verified four required assets; this does not imply every
interactive path succeeded.

| Order / surface | Current read-only result | API elapsed time |
| --- | --- | --- |
| 1 Home | 505 confirmed IDs, 22 pending, 527 visible. Testimonial tx confirmed by Core. H6-04's omission of an intervening sentence in the displayed quotation persists | registry 5.176s |
| 2 IDs | Registry populated; visible luuk registration matches Core owner/receiver and 1,000-proof payment. Host is registration-only per canonical docs; owner management belongs in Computer | IDs 5.926s |
| 3 Desktop | Shell available; `work@proofofwork.me` public lookup stayed “Opening public desktop…” during its review window. File lookup completion not certified | supporting Log summary 7.036s; this is not a Desktop lookup pass |
| 4 Browser | Known welcome HTML loaded verified/confirmed. Core bytes, 1,018-byte size and SHA256 match; iframe sandbox has no permissions | activity summary 7.283s |
| 5 Boost | Six visible post/reply/reboost records; all six txids confirmed by Core; exact per-item and aggregate signal arithmetic passes. Ten canonical feed events are not the same count as six visible items | separate feed GET succeeded; latency not retained |
| 6 AMO | Ready summary: 238 credits, 870 confirmed listings, 82 sales. Complete-book view remains explicitly incomplete: 832 credit preview tickets vs 871 declared credit/bond tickets. Sample listing/seal/ticket and frozen arithmetic verified against Core | 16.106s |
| 7 Credit | Confirmed credit options populated; create/mint controls present and disconnected action gated. General directory availability passed, not a fresh replay of every credit | 9.397s |
| 8 Wallet | Disconnected balance/list/transfer shell available; no account-specific signing tested. General WORK API probe aborted at 30s. Separate public seller query succeeded and its exact balance matches SQL | general probe failed; narrower query succeeded within 45s bound |
| 9 WORK | 21M minted, 357 holders, 21,000 mints, mint disabled; exact floor/network values match AMO/Growth/Computer. Fee preview 40 × 2,000 + 1,441 = 81,441 proofs | summary 13.415s; floor 9.692s |
| 10 Infinity | 630,496,569 POWB; value 630,501,483 proofs; floor 1.00000779. Displayed 2M-POWB ticket's hard quantity/price match Core. Book still labeled preview | 7.304s |
| 11 Inception | 224,847,713,398,447,926 issued; fixed value 224,847,713,398,447,947.9358206 proofs; 46 bonds, 45 WORK attachments. Exact issuance quotient recheck passes; 39 alias discrepancies persist | 7.389s |
| 12 Log | Global feed loaded 25,913 actions, 25,886 confirmed and 26 pending. Visible pending/confirmed samples agree with Core. Search then reproduced H6-15: success banner with no result row and “Search to verify this query” | summary 7.197s |
| 13 Growth | Loaded confirmed ledger, 505 IDs, 25,886 confirmed actions; exact network value agrees with WORK; 1,271,634 fees + 9,575,286 sales = 10,846,920 flow proofs. Forecast clearly labeled scenario | 7.330s |
| 14 Computer | Reviewed last. Inbox disconnected; IDs workspace populated the same 527 records and isolated owner management. After explicit read refresh, WORK loaded 869 open records, 823 buyable listings, 82 sales; H6-18 banner units remain wrong | health 1.863s; consistency 9.797s |

The automated probe receipts therefore comprise 12 successful surfaces and one
failed Wallet API surface, plus separately checked Boost. The initial Home shell
request without network permission failed locally; the authorized read-only
network retry succeeded. That local environment failure is not a production outage.

The Log total exceeds confirmed + pending by one, as in the earlier supplemental
activity-overlay observation. This pass did not independently classify that one
row, so it does not assert a new accounting defect or silently treat the counters
as identical populations. Likewise AMO summary/open/preview/buyable counts have
different scopes; differences alone are not proof of duplicate assets.

### Full-node reconciliation and declared math

Core checkpoint at start and the mempool fence: **967713**, hash
`000000000000000000017b47e9c21a91247495c5d6528586bff73f5babbb28f2`.
Core mainnet, unpruned, headers equal blocks, initialblockdownload false,
verification progress 1, warnings empty. At 14:31 health, Core, Electrs, txindex,
index checkpoint and all summary coverage keys agreed at that height/hash;
worker consecutive failures and unresolved pending counts were zero. Core advanced
to 967714 during final inspection; a fresh `getblockhash 967713` still matched
the audited hash. Checkpoint-specific results are not relabeled as a single
timeless snapshot.

Fresh canonical receipts:

- Home testimonial `d9c41aef1e84a51bbc96fe81506f511cd9cead8ceaae8349f9f3f64bb50acd69`
  had 18,896 confirmations in its sample. Decoded Core message includes the
  intervening cosmic-scale sentence omitted from the Home quotation (H6-04).
- ID `luuk` tx `7d1782d617f54b8103ea3ab579992a929e71484edf64300201d3ee981e61d6e5`
  had 2,703 confirmations; Core r2 payload names owner/receiver
  `1MbghEKwNH88jqYynJVtEDYHU8d5iy7PzM` and pays canonical registry exactly 1,000 proofs.
- Browser tx `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b`
  had 18,461 confirmations. Independent Core message extraction gives 1,018 bytes,
  SHA256 `f05b31a5f4dfabff5fb0ffe3bef1a03de4a8f5c562694609114ae6d352e9caad`,
  identical to Browser's evidence display.
- All six visible Boost txids have positive Core confirmations. For each item,
  recomputed `proofSignalQ8 + workSubatoms * networkValueQ8 // (21000000 * 10^16)`
  matches its exact total; sum matches aggregate Q8 `279586684003065267936`.
  This verifies arithmetic against the supplied valuation checkpoint, not a
  genesis reconstruction of that checkpoint's entire WORK network value.
- AMO listing `b3ce6c6eeee7aa3895e044b6f2e5eada0bea855ea51eb5b68655c767952dd7f3`
  and seal `2377da95a9eefe15f5bd36857051daec42a2223baea5bebfdd4339baf6d49c26`
  are confirmed at their stored block hashes; listing output 2 is unspent in
  Core including mempool and holds 546 proofs. Independently recomputed frozen
  amount 749030366 Q16 subatoms and minimum price 25000 from stored N-before;
  UI quantity 0.0000000749030366 WORK matches. Signature validation and every
  sale settlement were not independently reexecuted by this targeted check.
- Public seller `bc1qggw7p5xtcv33uduhttphz24apx35u384ld9twk` wallet query reports
  authoritative/checkpointComplete at 967713: balance `19999999989513574876`
  Q16 subatoms, pending delta zero, matching SQL exactly; 139 scoped listings,
  16 closed entries. This is projection agreement, not independent replay of
  the entire wallet balance. The sampled Core ticket above establishes one
  reservation's live UTXO, not all spendability or connected-wallet behavior.
- POWB listing `dcac1665798675b7817a973fa990283bc9de2c77cc374361e8cb956a5f2daa46`
  confirmed in Core; decoded `pwt1:list5` terms declare amount 2,000,000,
  price 2,000,000 proofs, anchor vout 2/value 546, historical pwt-sale-v1.
  Historical forms were preserved, not judged invalid merely for being old.
- At an unchanged Core hash, **all 185 indexed pending txids appeared in at least one
  of the two bracketing mempool snapshots**; none absent in both, Core mempool 84,108.
  Log's visible pending seals d7b377c4…da04373f, 09b4593e…4d584d99 and
  abe1a3a9…ce17e7fc were present; visible confirmed ffcbac4d…f0d06614 had five
  confirmations. This does not prove every possible protocol mempool event is
  indexed, or future dropped/replaced/reorg transitions are correct.

**On-chain hard-function evidence was checked, not inferred from UI labels.**
V8 declaration tx
`f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a`
Core output 3 contains 5,593 bytes with SHA256
`1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528`, matching API
provenance and declared block hash. Fetched input-zero funding transaction and
verified its spent script equals the declared authority script. Output 4 pays
the pinned registry exactly 546 proofs. The text declares Q16 WORK quantities,
Q8 network values, multiplication before integer division, 25,000-proof face,
`floor(F*S*A*Q/N)` and `ceil(amount*N/(S*A*Q))`, compute-then-bond ordering and
frozen settlement. These match the independent sample arithmetic and the earlier
945-term population check. Earliest-declaration uniqueness and full canonical
replay of every preceding input were not newly proven here.

Rechecked all 46 confirmed INCB mints using exact numeric integer quotient:
zero issuance-amount disagreements, **39 inconsistent decimal aliases remain**.
Displayed direct + attached units (27,386 + 224,847,713,398,420,540) equal issued
supply; dust remains in fixed value. WORK exact displayed floor
399,409,485,499.45980428 proofs/WORK agrees with network Q8 divided by 21M;
POWB supply + 4,914 proofs = 630,501,483. Charts, USD conversions and scenario
projections remain approximate display calculations, not consensus or settlement
inputs. No universal-math certificate is justified while complete replay/parity
coverage remains unfinished and known representation differences exist.

### Existing findings rechecked and material conditions

| Reference / severity | Current evidence | Required improvement |
| --- | --- | --- |
| H6-01 / High | Fresh local synthetic parser/reducer execution still accepts outsider transfer and changes owner; no live takeover observed | Enforce canonical current-owner authority and qualifying registry payment before ownership mutation; adversarial replay tests |
| H6-02 / Medium | Fresh local unfollow fixture still omits target participant/ref while shared-extractor parity reports ready | Correct target relations and use an independent expected-relation oracle |
| H6-04 / Low | Home quotation still joins nonadjacent sentences without marking omission | Correct excerpt presentation with chain-backed text |
| H6-15 / Medium | Live Log search for verified Browser tx reported one match, but result disappeared into unverified-query state | Preserve/fence search state across background refresh; test same-query races |
| H6-18 / Medium | Computer banner calls 8,387,599,195,488,655,889.93453643 proofs “WORK floor”; panel correctly shows per-WORK floor | Correct quantity/units in status formatter |
| H10-05/H12-06 / Medium | Wallet broad read timeout; Desktop opening incomplete; AMO and bond book preview incomplete; successful reads 5–16s | Bounded per-stage queries, deduplication, targeted projections, explicit incomplete states and latency monitoring |
| Audit-12 INCB aliases / Medium | 39/46 exact-versus-decimal discrepancies still present | Normalize aliases from immutable exact integers only after approved repair review |
| Audit-14 availability qualifications | Log, Growth, AMO summary and Computer WORK completed this time; full AMO book and Desktop lookup did not | Record recovery for these samples without claiming durable resolution |
| Existing query-contention class / Medium operational observation | 14:00 query-health saw five identical-query fanout, five active queries, oldest one second, no lock waiters; 14:05–14:30 scheduled checks succeeded | Observe fanout/concurrency under load and distinguish transient warning from persistent service failure |

No new independent issue identifier is assigned. H6-01/H6-02 are local-source
synthetic proofs; deployment equivalence and end-to-end malicious chain execution
were not demonstrated. H9-03/H9-04/H9-05 and timestamp/participant discrepancies
remain open based on the earlier same-day full-population checks above, not falsely
closed by this surface pass. Their full mismatch sets were not rebuilt again.

### Security, reliability and storage

Computer response contains HSTS (one year/includeSubDomains), CSP with self-only
scripts/object-src none/frame-ancestors none, nosniff, frame DENY and restrictive
camera/microphone/geolocation/payment/USB policy. An unauthenticated public internal
verifier GET returned 404, not private data; this is a routing/exposure check, not
proof of all internal authorization paths. Browser's rendered iframe has empty
sandbox permissions. No active exploit, load test, wallet injection, credential
access or security-setting change was attempted.

Node listeners place PostgreSQL on loopback; Core RPC and Electrs on loopback/
container network; API on loopback/WireGuard. UFW active, public SSH and P2P allowed,
RPC/Electrs restricted to container subnet and API to UI WireGuard address. This
sample is not a complete host or dependency vulnerability assessment. Existing
Boost authorization findings remain the most material demonstrated application
security gap in this pass.

At 14:31 UTC:

- UI root 64%, available **14,141,075,456 bytes** (~13.17 GiB); RAM 651 MiB used,
  3,168 MiB available; Caddy active. UI backup tree 19 GiB, /var/tmp 640 MiB,
  logs 590 MiB. Prior release-prune failed unit remains listed; earlier explicit
  dry-run success is retained as evidence. No unit reset or prune executed.
- Node root 27%, available 73,426,202,624 bytes; /data 76%, available
  **408,224,714,752 bytes**; RAM 16,970 MiB used, 110,942 MiB available.
  Database **30,554,315,799 bytes**, about 9.84 MB above the earlier 13:13 sample.
  WAL slot active/reserved. Node storage/release warning units remain failed;
  repeated storage warnings reflect the known threshold, not a new outage.
- Summary payload health metric now 20,303,429 bytes. Use the separate SQL and
  compact caps described above; payload growth remains a capacity/availability risk.

The earlier storage inventory and seven-day logical-backup refill concern remain
applicable. UI rollback roots, old WAL, restore trees and audit evidence are
**not confirmed safe to delete**. For future cleanup, first prove live-service,
rollback, restore/PITR, hardlink and evidence dependencies; verify recoverability
and present an exact candidate list for approval. Active logs/cache/temp are not
safe solely because they are old or large. No obsolete note or redundant backup
was newly certified disposable. Previous audit records remain useful evidence.

### Prioritized recommendations and approval boundary

1. Address H6-01 authority validation before treating Boost ownership transfers
   as reliable; repair H6-02's indexing and H6-15/H6-18's observed rendering errors.
2. Fix originating projection writers and review deterministic before/after sets
   for missing raw evidence, timestamps, relations, mail and INCB aliases. Do not
   change historical economic values to make display aliases agree.
3. Reduce summary/fresh-read cost, contain duplicate query fanout and provide
   bounded complete-book hydration. Alert on latency/error rates, incomplete
   coverage, checkpoint drift and remaining payload-budget bytes, not just HTTP200.
4. Establish growth-based storage/retention budgets and isolated restore/PITR
   evidence before proposing any cleanup. Preserve the UI deployment reserve and
   monitor transition-table, daily dump and rollback-root growth separately.
5. Finish fixed-checkpoint independent ledger/ID replay and connected-wallet,
   reservation/seal/purchase, pending-drop/replacement and reorg tests in an
   approved safe environment. This audit did not certify every historical object,
   every hard function or every private/local UI path.

Every implementation, projection repair, configuration change, deployment,
restart and cleanup above requires **separate explicit approval**. No such action
was taken. The user specifically prohibited cleanup, so `hygiene:fix` is not run
for this follow-up; the explicit no-cleanup instruction takes precedence over the
repository's default cleaning step. Read-only hygiene and diff checks follow.

Follow-up handoff: `npm run hygiene:check` and `git diff --check` passed.
Only this append was made in this follow-up; prior uncommitted audit files and
manifest entries remain unchanged. No cleanup, staging, commit or push.

## Approved implementation checkpoint — 2026-09-19

The user subsequently approved implementation, controlled deployment/restarts,
isolated replay and restore/PITR, deterministic chain-proven projection repairs,
hygiene and commits/pushes. Canonical economic history remains protected. This
append records work in progress; it does not close either Audit 17 review.
Pre-append report SHA256: `270bdee5cfe6def942b227b14bfe1ae1571ef05f4819ef91804dcce0309c9efd`.

### Source changes and evidence

- H6-01: direct Boost transfer projection now requires an existing owner and an
  exact matching sender; the parser retains the actual sender as author. Tests
  reject outsiders, absent actors, case-altered addresses and unknown parents.
  Registry-payment validation and the wider marketplace authorization review
  remain incomplete. H6-01 is **not resolved**.
- H6-02: follow/unfollow writers include target-address participants and target-ID
  references, with independent expected-relation assertions. Historical relation
  repair and production verification remain pending.
- H6-04: Home marks the omitted on-chain quotation sentence with an ellipsis.
- H6-15: Log history responses are fenced by query, search generation, page
  generation and workspace; background refresh uses the live query.
- H6-18: the banner labels the displayed total as WORK live network value.
- H9-03: rebuild invalidates only the canonical scan marker, preserving raw
  transaction evidence; fresh canonical spender scans merge new evidence. The
  four existing missing-raw rows have not been repaired.
- Timestamp writer: confirmed event timestamps inherit the persisted transaction
  parent time. Regressions cover missing and incorrect incoming timestamps.
- Audit-12 INCB aliases: persistence and pinned-repair output regenerate decimal
  aliases from exact Q8 integers. Regression uses the observed discrepancy and
  verifies unchanged issuance and exact values. No production mint was changed.
- Recovery harness now loads the real effective-ticket SQL dependency and tests
  its current joins; the live-data contract recognizes the existing deduplicated
  summary producer while checking network/freshness segregation.

Validation: 528/528 recovery behavior checks, 12/12 directly executed Boost
checks, Log/surface read-state checks, V8 arithmetic/gates, bond exact arithmetic,
server free-identifier checks, live-data contract, and TypeScript/Vite build pass.
The build retains the existing large-chunk warning. Node's isolated test-runner
output reported only a file-level result here; Boost was therefore also run
directly and its twelve explicit test results retained.

[Implementation evidence](2026-09-19-audit-17-implementation.evidence.json) retains
check outputs and hashes. Passing local checks do not prove production resolution.

### Capacity and deployment gate

At 14:43 UTC Core reported height 967715; node /data available was
408,186,515,456 bytes (76% used). At 14:47 UTC UI available was
14,132,453,376 bytes (64% used), Caddy active. Nine protected UI rollback roots
remain. The publisher allows at most eight existing retained roots before adding
one, so no deployment is attempted until a safe retention disposition is proved.
No production file, database, service, backup or configuration was changed.

### Exact local cleanup candidate

`/home/sixer/ProofOfWork.Me/dist` is the newly generated local test build
(13,276 KiB allocated), ignored and untracked, outside both VPS environments.
It is reproducible from this source and dependencies; the build receipt above
is retained independently. It is approved allowlisted hygiene material, not a
production rollback or recovery artifact. The hygiene tool must additionally
reject symlinks, mount crossings and tracked content before removal. No other
production or uncertain cleanup candidate is approved by this checkpoint.

### Work still required

Complete Boost authority/payment validation; isolate and review exact before/after
repair sets for raw evidence, timestamps, relations, mail and INCB aliases; run
fixed-checkpoint independent ledger/ID reconciliation; investigate Wallet/Desktop/
full-book latency; complete storage growth/retention and restore/PITR verification;
verify adversarial pending/replacement/reorg and connected-wallet paths in a safe
environment; then deploy and verify production. No issue is marked resolved.

Hygiene checkpoint: `hygiene:fix` removed the documented local `dist` build
and an empty allowlisted `node_modules/.vite-temp` directory (0 bytes).
`hygiene:check` and `git diff --check` passed. SOUL and canonical product/protocol
docs were reviewed; operational writer invariants were added to
`OP_RETURN_INFRASTRUCTURE.md`. No tracked or production artifact was deleted.

## Rollout continuation — 2026-09-19

Authorization remains the user's comprehensive implementation approval. The first
implementation commit is `07929dd3c6e422fa1955c6cbf07007330eca0519`; origin/main
still points to its parent. Production node is `8223f1dd338beaa71509332b511271be3e93f22a`,
UI is `84a9871040db0e500a8b7f8cc16fec78c5e669c9`; the source deltas were reviewed.
At 14:56 UTC node APIs/worker were active, Core height 967717. UI rollback
verification passed, with 14,132,371,456 bytes free.

Exact preservation candidate (no deletion):
`/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-2ddefac163d5-20260905T204437Z`.
It contains release `6a7d5c12e403-20260905T050937Z`, 1,133 entries and
410,942,217 regular-file bytes. Manifest SHA256
`2e75546ca7b21ff7b8a1d96d1a891c9bdc9e97dfa74b451f58dd4519c790a1ec`;
complete-tree SHA256
`a4458c5747136f0f692e648c7199378ad748ef3c23017f7ed2d53e4122939d34`.
The reviewed script `deploy/audit17/preserve-ui-rollback.sh` checks live references,
mounts, capacity, complete-tree and archive provenance under the deployment lock.
It then preserves independent release-evidence copies and a compared complete-root
archive in `/var/backups/proofofwork-ui/recovery-evidence/audit17-20260919`, moves
only that historical root into the same protected directory, and verifies its
unchanged fingerprint. No bytes are deleted and recovery remains reversible.
The original release archive also remains in place. Execution results follow.

Preservation execution passed: complete root and release evidence retained under
`recovery-evidence/audit17-20260919`, unchanged fingerprints, no deletion. UI free
space afterward: 13,585,604,608 bytes. The exact application commit was
fast-forward merged and pushed to main. Isolated builds produced 14 surfaces plus
NFT alias. Staging preserved 525 prior assets (43,897,249 bytes), deduplicated
179,717,632 bytes, and left 13,169,442,816 bytes free before source receipt.

Node candidate source/dependencies were independently attested under Node24.18.0:
commit `07929dd3c6e422fa1955c6cbf07007330eca0519`, tree
`5ca993c7816b20c3b914e4421bdbdabf49673c5f`, runtime SHA256
`641de0f01428b19ae5d9baaa5ff66b59700c84570713808da929d0be751e19b3`.
The production-runtime tests passed (528 recovery checks, Boost and exact V8/bond
checks). A private shadow used a verified read-only DB connection and separate
cache. Its bounded Core comparison passed at height 967717/hash
`0000000000000000000196123a22f78b2c8f2e40e87bf27bc85215131ce77e1a`:
505 confirmed/22 pending IDs, 238 definitions, 871 independently checked unspent
listing anchors, and wallet fixture 131 UTXOs/71,951 confirmed proofs with
67,704 reserved and 4,247 available. Exact WORK supply, POWB/INCB totals and six
Boost raw carriers passed. Mempool sequence changed; no atomic pending-state or
whole-chain address completeness claim. Full raw receipts remain on the node at
`/home/powadmin/audit17-shadow-core-07929dd`.

Reviewed cutover controllers are `deploy/audit17/publish-ui.sh` and
`deploy/audit17/publish-node.py`. Node cutover holds only previously active
maintenance/recovery timers, keeps Core/Electrs/Postgres/WAL receiver unchanged,
requires no checkout process/listener or other application DB session, and
preserves the prior checkout at the exact release-bound stage path. An ambiguous
exchange leaves services stopped for inspection; a verified exchange followed by
failure rolls back to the attested old checkout. Publication results follow.

The first node cutover attempt refused before exchange: the controller accessed
MainPID on an inactive socket unit, which has no such property. Its recovery path
restarted the original applications and restored all held timers. Live remained
`8223f1dd338beaa71509332b511271be3e93f22a`. The failed receipt remains in
`/data/proofofwork-audit17-cutover-07929dd3c6e4-20260919T145727Z`. The controller now
handles inactive socket units explicitly; fixtures cover absent/zero/nonzero PID,
active and failed states. Attempt2 uses a fresh evidence directory. No prior
failure evidence is overwritten.

Attempt2 also refused before exchange: the stopped transient shadow unit had
already unloaded, and `systemctl stop` returned an error for the absent unit.
Applications had not been stopped in that attempt. Recovery restored the held
timers. Its separate `-attempt2` receipt and controller log are preserved.
Attempt3 handles both loaded and already-absent shadow units. The actual cutover
control flow passed five isolated fixtures: success with absent/present shadow,
pre-exchange DB-session refusal, post-exchange readiness failure with rollback,
and ambiguous exchange with services held for inspection. Controller SHA256:
`210d7e3f99e77e3c8b1895ac2f2b37640c160637e6ee6e8c3a061355d851ee9b`.

UI publication completed for release `07929dd3c6e4-20260919T145727Z` with verified
archive SHA256 `88f1830dcd726d508cfcfd0bd0d1c8fff86d21c23cae884d1efdbbf31aa56cd8`.
The prior live root is preserved in the rollback queue; earlier protected roots
remain independently recoverable. Free space after publication was 12,927,619,072
bytes (67% filesystem usage). Public HTTPS verification compared all 687 requested
release files and root pages across 14 domains with the archive: 201,495,479 bytes,
14.371 seconds, all hashes matched. This establishes serving integrity, not every
interactive flow or protocol's correctness.

Attempt3 completed successfully: both VPS application releases now resolve to
`07929dd3c6e422fa1955c6cbf07007330eca0519`. Core, Electrs, Postgres and WAL-receiver
unit state/PIDs were unchanged; application services recovered ready with zero
block lag, and all previously active held timers were restored. Before/exchange/
archive/after/timer receipts remain under the `-attempt3` directory.

Post-deployment production HTTP/Core probe passed from 15:15:11 to 15:17:52 UTC,
at height 967718/hash
`0000000000000000000003af5f7061717353616c9b31385767c392488e24debd`.
It independently rechecked all 871 open listing anchors, 238 definitions, exact
WORK supply and bond totals, 505 confirmed/22 pending IDs and the wallet fixture.
Inventory and math results matched the candidate proof. Mempool sequence changed
12948011→12948773; pending visibility remains qualified. Machine-readable summary
and receipt hashes: `2026-09-19-audit-17-rollout.evidence.json`.

Browser verification on the deployed Computer loaded Log, showed a no-match ID
search as zero results without background overwrites, and returned exactly one
confirmed action for transaction
`ffcbac4d6de8281467e56306c36f752954973d3400e0c578f018db4ef0d06614`.
No browser warning/error was captured during this check. This exercises H6-15's
changed behavior without claiming exhaustive scheduling-race coverage.

Fresh logical recovery exercise: exact source
`proof_indexer-20260919T031850Z.dumpset`, dump 15,890,347,429 bytes,
SHA256 `cc465d73c1465eac4a11065b174d2733710abf11d18d4e62e10a9ceae60fa262`.
Controller `deploy/audit17/restore-logical.sh` uses a private socket/no TCP listener,
2 GiB memory/one CPU/low I/O priority, 80 GiB job ceiling and 100 GiB free-space
floor. It restores neither production roles/grants nor production tablespaces.
The initial launch could not traverse the private deployment directory as
postgres and exited before opening a backup or database. The unchanged controller
was installed in a postgres-readable root-owned location, tested readable, and
relaunched as `proofofwork-audit17-restore-attempt2`. Its newly created private job
is `/data/proofofwork-audit17-restore-20260919T152000Z`. Results remain pending;
this is not yet a completed restore or PITR claim.

H9-03 repair preparation: all four exact txids listed above still lack raw evidence
and have zero event dependencies. Core verbosity-2 records matched every stored
input/output, fee, block position, block timestamp, version, locktime, vsize and
weight. Raw transaction IDs were independently recomputed from serialized bytes,
excluding witness as required. The initial read-only plan rejected `NULL` versus
empty-string scriptSig representations; source normalization confirms these both
represent an empty script. No amount, address or nonempty script differed.
Reviewed controller `deploy/audit17/repair-aux-raw.py` normalizes only that comparison.
Plan SHA256 `0c73e3b3f2f903d95b6f7a4c46ecf97c511649566c464ce9de73161d158c9da3`;
protected before/plan evidence is at
`/data/proofofwork-audit17-aux-raw-20260919T153200Z`.
The exact guarded SQL passed a production transaction-rollback check and verified
all original rows unchanged. Committed application is limited to raw_tx/raw_hex/
updated_at for those four rows, after repeating Core proofs. Full before/after,
Core records and guarded rollback SQL are retained before commit. No canonical
scan marker is invented; normalized inputs/outputs and all economic data stay
unchanged. Application results follow.

H9-03 application passed at 15:22:43 UTC: exactly four records restored. The
independent after-check recomputed all four txids and proved normalized input/
output rows, event dependencies and every other transaction field unchanged.
`receipt.json`, `after.json`, Core proofs, `apply.sql`, and `rollback.sql` remain in
the protected repair directory. Live health afterward was ready, zero block lag,
zero consecutive worker failures, Core/Electrs/index at 967718. This closes the
four-row raw-evidence gap observed by Audit 17; future writer persistence still
requires ongoing regression checks.

Timestamp repair plan covers exactly the previously observed 1,816 valid confirmed
listing/seal events across 385 canonical blocks. Core independently proved every
parent transaction's position and block timestamp, and each stored parent matched.
No conflicting non-null timestamp was accepted. Complete compressed Core block
responses, before metadata and full-row/invariant SHA256 hashes are preserved at
`/data/proofofwork-audit17-event-times-20260919T154000Z`. Plan SHA256:
`169d906f31238ccec7ed5d6b7457f08687bbbdb1098e40a4e9837965ae823399`.
Controller `deploy/audit17/repair-event-times.py` fills only null block_time and
event_time; payloads, amounts, statuses, identities and economic records are
protected by exact full-row guards and unchanged-field hashes. Apply requires a
successful forward/reverse transaction-rollback test and re-verifies canonical
block hashes. No timestamp repair has been claimed complete at this checkpoint.

Timestamp forward/reverse rollback validation passed, followed by committed
application and independent after-check: 1,816 rows repaired across 385 Core-proven
blocks, zero valid confirmed events still missing block_time/event_time.
Every unchanged-field SHA256 matched. `after.json`, `receipt.json`, and guarded
`rollback.sql` remain in the timestamp evidence directory. A fresh complete query
also found zero confirmed transactions lacking both raw JSON and raw hex, closing
the measured H9-03 population gap.

INCB alias preparation independently checked all 46 valid confirmed mints: Core
raw bytes/txids, canonical block position, bond recipient/payment, integer issuance
quotient/remainder and exact proof-plus-WORK value identity. The 39 previously
reported issuance/dust discrepancies remain; checking all five writer-normalized
aliases also finds the same representation defect in two fields of transaction
`3325ebc39165bb4c38f078dc936c4c98a420d2e7f7875738e49d123c0e233801`:
attached-work floor alias 1923.61884231 versus Q8-derived 1907.31899061, and snapshot
network alias 40395995688.62459796 versus 40053698802.89271. This extends the existing
alias issue to 40 rows, not a new economic-issuance finding. Planned changes: 197
decimal aliases; all Q8 integers, issued quantities, ownership and accounting
remain identical. Core inclusion and the existing exact integer fields are proven;
this exercise does not independently replay historical WORK valuations.
Plan SHA256 `364f3a8b93b849b826aa6d69b06199d6bc5f2e315a31df7cd1865b5fadb49b12`;
evidence directory `/data/proofofwork-audit17-incb-aliases-20260919T154600Z`.
Both forward and guarded reverse SQL passed a rolled-back production transaction,
and all original rows remained unchanged. Apply results follow.

INCB alias application passed: 197 decimal fields across 40 events normalized;
all exact economic fields and other event content matched their invariant hashes.
The five alias fields alone, plus updated_at, were eligible to change. Before/
after, Core receipts and guarded rollback SQL remain in the protected alias
repair directory. Browser WORK refresh now visibly reports “WORK live network
value 8,387,599,195,488,655,889.93453643 proofs”; its separate floor remains
399,409,485,499.45980428 proofs/WORK. This production check verifies H6-18's label
correction, without claiming independent whole-history valuation replay.

A fresh read-only canonical-extractor snapshot covered 26,414 events. Existing
participant drift has the identical 45-extra-row hash
`7910ecb110197ec85886e87efb8226d0fe15d33ca08a664736952a5198c5bef6`.
The newly deployed follow-target extractor requires two historical participants
and two PowID references; the previously missing invalid-INCB ticker reference
also remains. All 46 Mail differences are confined to attachedCredits metadata:
legacy registryAddress/paidSats fields absent from the canonical attachment form.
Credit IDs, exact quantities, units, recipient addresses and transfer positions
match. This is presentation/search attribution normalization, not transfer or fee
history deletion; the source transfer events remain intact.
The current upsertEvent replaces relations from the returned canonical event,
and all Mail writers project the canonical event payload; writer-first review
passed. Planned exact delta: remove 45 obsolete relation tuples, add two follow
participants/three references, and normalize 46 Mail message projections.
All 49 affected source events are confirmed; full-row guards prohibit source event
changes. Plan SHA256 `fa2ae7d30907f6a60056571bd4967cd4df9b4946d414a7c7888c9c02f15fcac4`
is pinned in `deploy/audit17/repair-relations-mail.py`; protected evidence is at
`/data/proofofwork-audit17-relations-mail-20260919T155300Z`. Core proofs and exact
forward/reverse rollback validation are required before apply.

Mail-plan qualification: inspection of all 46 deltas found 45 metadata-trimming
cases and one absent-versus-empty attachedCredits list, on
`3325ebc39165bb4c38f078dc936c4c98a420d2e7f7875738e49d123c0e233801`.
The first proof controller safely refused before any write because it required
that field to exist. A fresh version treats only absence and an empty list as
semantically equivalent; it still rejects any quantity, recipient or other credit
field change. No missing economic transfer was inferred or introduced. This
clarifies the earlier broad description of all 46 as legacy-field removal.

All 49 source-event Core proofs passed. The relation/Mail forward-and-reverse
transaction test passed, including exact restored Mail row hashes. Committed
application removed exactly 45 obsolete participants, added two follow-target
participants and three references, and normalized exactly 46 Mail messages.
Every source-event hash remained unchanged. A separate population-wide snapshot
then found exact parity over 26,414 events: 125,873 participants and 56,100 refs,
zero missing/extra tuples, and zero Mail projection differences. This closes the
measured H9-04/H9-05, participant drift and H6-02 historical relation gaps; it does
not certify all future ingestion or pending/reorg paths. Both before and after
populations, Core proofs, rollback SQL and receipts remain in the protected roots.

Operational checkpoint: reviewed deployment/repair controllers and mathematical
boundary tests are retained with this rollout evidence. Cutover tests cover
success and restoration/ambiguous-exchange failures; repair tests cover witness
versus non-witness txids, malformed lengths, exact monetary bounds, very large Q8
decimal formatting and SQL quoting. Production repairs additionally executed their
real guarded SQL under rollback before application. Repository hygiene removed no
allowlisted state; checks and diff whitespace validation passed. Canonical docs,
SOUL, classified evidence and cleanup boundaries were reviewed; only the operating
infrastructure documentation required a current-state update. No retained backup,
rollback root or audit evidence was deleted. The logical restore and broader
ledger/ID/PITR/security/performance work remain open at this commit checkpoint.

Logical restore completed successfully at 15:38:28 UTC (20m34s CPU; 2 GiB memory
peak; zero swap). Restored database: 30,006,664,215 bytes, 25,780 transactions,
26,385 events, 238 credit definitions, 405 balances, 19,790 ledger snapshots and
8,034 transitions. Invalid indexes and unvalidated constraints: zero. Offline
checksum scan examined 1,464 files/3,665,732 blocks with **zero bad checksums**.
The isolated cluster was stopped; its complete 29 GiB tree and evidence are retained.
This proves logical data/schema restoration and the newly restored pages, not
production physical-page integrity, role/grant recovery, off-host recovery or PITR.
The separate cross-ledger audit remains running under a 15-minute bound.

### Recovery and verification continuation — 2026-09-19 16:03 UTC

The cross-ledger consistency harness passed on production application `07929dd`,
snapshot `e630a123880e85edc0f74622`, exact value
`8387599195488655889.93453643` proofs. This is the existing cross-ledger comparison,
not a new independent genesis replay. The strict ID audit remains incomplete:
at 15:44:34 its final index scan refused a changed checkpoint; at 15:52:36 its
Core/Electrum final fence refused changed chain/history. A separate coverage
request returned HTTP 200 (879,894 bytes), which does not turn either full audit
into a pass. No fence was weakened and no result was labelled resolved.

The same-host physical backup/PITR exercise passed at 16:03:29 UTC. Source:
`/data/proofofwork-postgres-backups/physical/16-main/2026-09-19T044045Z.backup`;
external manifest SHA256
`d8c37cd1ed5b61bbc058376a8d520cab84dde04da00be4f24a418c1c43e33198`.
The controller copied and hashed 190 complete 16 MiB WAL segments, verified all
backup files and required WAL using `pg_verifybackup`, and found no tablespace
DDL in the replay interval. PostgreSQL replayed to the named recovery marker
`audit17_20260919T155128Z`, exactly LSN `BD/8325A2D8`. The marker and WAL switch add
operational WAL records; no application rows or economic history were changed.
The restored database had 25,809 transactions, 26,414 events, zero invalid indexes,
all four repaired raw rows, and zero missing confirmed-event timestamps.

Recovery used a private Unix socket at port 55433, no TCP listener, and a private
copy of tablespace 486390. Systemd made live database/tablespace paths inaccessible,
made the rest of the filesystem read-only, and allowed writes only inside the new
job. CPU, memory, runtime and minimum-free-space limits bounded the exercise.
The isolated cluster was stopped after verification. Complete data and evidence
remain at `/data/proofofwork-audit17-pitr-20260919T155550Z`; this is **not** a cleanup
candidate. The live cluster has page checksums disabled: this exercise verifies
backup manifest checksums and recovery, not live physical-page checksums or
independent off-host disaster recovery.

Refused attempts are preserved: the first required WAL segments were bundled
inside the base backup; the second exposed Python tar streaming's handling of
concatenated gzip members; the third passed backup verification but raced an
asynchronous PostgreSQL startup status check. None wrote to production database
paths. A narrowly pinned controller resumed the same verified private cluster
with a proper readiness wait. PostgreSQL had consumed its private tablespace map,
so the resume proof checked the preserved original and resulting private symlink.
Controllers, original configurations, all three logs, resume log and receipt are
retained. Regression checks cover archive traversal, special members and the
empty-first-member gzip case. The final general controller now waits for readiness.

The scheduled logical-backup writer still had no capacity guard and removed old
sets/partials solely by count/age. Within the existing storage recommendation,
the reviewed replacement now reserves 100 GiB plus a measured dump budget,
terminates a new dump that crosses its budget/reserve, and preserves older or
failed sets as explicitly named review candidates. Local executable fixtures
passed low-space refusal, successful creation, runtime termination and preservation
of old backup/evidence directories. Installation and production capacity verification
are the next step; this paragraph does not yet claim the new writer is deployed.
The seven-set target is a review threshold, so unreviewed retained material can
still exhaust backup headroom and cause a guarded backup refusal. No existing
backup, restored database, historical log or audit evidence was deleted.

Boost authority work is still in progress locally; no new Boost deployment or
H6-01 closure is claimed at this recovery checkpoint. Marketplace anchor/seal/buy
proofs, comprehensive ID replay, off-host recovery and broader performance work
remain outstanding. PostgreSQL recovery design follows its version-16
[continuous archiving](https://www.postgresql.org/docs/16/continuous-archiving.html)
and [backup verification](https://www.postgresql.org/docs/16/app-pgverifybackup.html)
documentation, including the risk of replaying absolute tablespace paths.

Continuation: the backup safeguard from commit `2924415` was installed at
16:06:47 UTC after exact old/new SHA checks and an inactive-backup-service check.
Both candidate and installed `--check-capacity` passed: 342,807,744,512 available
bytes; 107,374,182,400 reserved bytes; 34,722,895,180 maximum dump bytes.
Installed SHA256 `1728a2d7047a5a9a0804ef2fa7db83cbff2ff2e21dfe0dc23048217651093a9e`.
Before/after scripts, both preflight logs and receipt are retained at
`/data/proofofwork-audit17-backup-guard-20260919T160647Z`. Main and the working
branch were fast-forwarded/pushed to `2924415`. The full creation path was tested
with process/filesystem fixtures; a new production dump was not created by this
installation. No backup or production service restart was needed.

The third strict ID audit **passed**, with bounded retries enabled and all original
fences unchanged. Coverage: 586 transactions (562 confirmed registry transactions,
24 pending), 535 lifecycle events, six active listings, four canonical sales,
546 registration attempts, 505 confirmed winners and 22 pending candidates.
Canonical lifecycle parity was verified against exact Core-ordered chain replay.
The 17 historical refund candidates match the already documented population in
Audits 2/5/10; they are not newly assigned duplicate findings or automatically
executed refunds. Two pending duplicate candidates remain a watchlist, not
confirmed ownership or refund history. Full log and its SHA256 are referenced
in the rollout evidence. This supersedes the earlier incomplete result while
preserving both failed consistency-fence attempts. All six authority/application
services checked afterward remained active.

### H6-01 / H6-02 Boost authority continuation — candidate, not yet deployed

Candidate application changes now resolve the historical confirmed Boost receiver
at the same indexed checkpoint, compare exact chain positions, and allocate exact
integer registry/follow fees without double counting. Wrong receivers, missing
outputs, duplicate output indices and insufficient amounts are excluded from the
application projection with explicit provenance reasons; raw accepted carriers
remain unchanged. Base58 addresses stay case-sensitive across parser, graph,
profile and wallet controls. Legacy saved intents are preserved only when their
embedded address/network match exactly.

Current-owner checks now cover listings/seals, preserve listing identity and price,
and require a valid direct-transfer destination. A reboost cannot establish
ownership of an unknown parent. Author-only hide tombstones affect social
visibility without deleting evidence or changing ownership. Confirmed purchase
and delist projections require Core-bound original ticket and spend transactions;
purchases additionally prove exact integer seller consideration, returned anchor,
separate registry allocation, declared buyer restriction and block-time expiry.
Core failures fail the read rather than silently fabricating ownership. No live
Boost sale lifecycle exists in the observed population, so sale verification is
covered by adversarial fixtures and remains untested through a connected wallet.
H6-01 is not labelled fully closed before candidate/production verification.

A read-only Core probe independently verified all ten current Boost events and the
`boost` ID registration against raw transaction bytes, payment amounts/scripts,
canonical block hashes and transaction positions. All ten existing events passed
the historical-receiver qualifier; none were removed. Receipt:
`/home/powadmin/audit17-boost-authority-core-20260919.json`, reproduced in rollout
evidence. The first probe required ECC initialization for Taproot output decoding;
its corrected read-only run passed. Proof-only feed reads no longer start an
unused WORK valuation query; WORK-bearing reads retain the exact valuation fence.

Local adversarial coverage includes fee receiver updates, case collisions,
duplicate and shared payment outputs, unauthorized visibility/listing mutations,
wrong ticket spends, underpayment, altered buyer payloads, pending purchases,
Core reorg/position mismatch, invalid destinations, preserved legacy intents and
skipping unused valuation work. TypeScript, server-global, live-data and relevant
recovery checks accompany the candidate. Release and production verification are
still required; no new deployment is implied by this entry.

Boost release preservation plan: the UI has 12,924,653,568 bytes available and
nine queued historical roots. The exact preservation candidate is
`proofofwork-www-pre-4515c3bc3421-20260913T070757Z` (1,163 entries,
411,714,627 regular-file bytes), manifest SHA256
`a218dd6e4b55a740f12cdb7d63559066f174c5e5e8257645e8a2afb2a90d9816`,
tree SHA256 `eef49256e82c4c797faa65d6731153b2aa7c7b8cf03c8764b31b426d07a5b2ce`.
It contains release `2ddefac163d5-20260905T204437Z`. The pinned controller checks
service/process/mount independence, compares a complete-root archive, copies the
release archive and provenance, and then moves the unchanged root to
`/var/backups/proofofwork-ui/recovery-evidence/audit17-boost-20260919`.
This is preservation, not deletion, and creates one queue slot without claiming
to reclaim storage. The 10 GiB production reserve remains mandatory.

### Boost rollout continuation and growth monitoring

The `6eb4a1e07131fc0b27d381dda52986f9d1bf3398` candidate passed its isolated,
read-only full-node comparison at height 967721. This checked 871 listing anchors,
505 confirmed / 22 pending IDs, 238 credit definitions, the fixture wallet's
71,951 confirmed proofs (67,704 reserved, 4,247 available), bond exact aliases,
and ten Boost events / six visible records. The mempool sequence changed; no
atomic pending-state claim is made. The first shadow launch was refused because
PrivateTmp hid its launcher; the corrected launch verified read-only pool settings.
The first UI extraction's directory permissions were refused before staging;
archive-declared modes were restored on the fresh candidate only.

The first node cutover refused a still-draining database session before exchange,
then restored the existing application and timers. A tested 15-second bounded
connection-drain retry bound the original failure receipt and both runtime
attestations. It completed without changing Core, Electrs, PostgreSQL or WAL
receiver service identities. The previous release remains intact. UI publication
also completed with all eight prior queued roots retained plus the new rollback
root. Its release archive is 185,246,540 bytes, SHA256
`641d7ea865ec15f11523ed8265c407f77a1117e9e6afdc4b1b3bb694cd1a130a`.
Fresh production Core and public-file verification are recorded separately below.
The first production probe hit a checkpoint-transition 503 as Core advanced to
967722; its failed receipt is retained, not relabelled a pass.

Hourly read-only storage forecasting is installed on both hosts. It reads existing
one/seven-day observations, preserves integer byte arithmetic, warns within seven
days of the configured reserve, and flags a day or less as critical. Missing
history is explicit. Tests cover missing/short history, bursts, declines and
reserve boundaries. The UI's initial run flagged only 868,564,992 bytes above the
10 GiB reserve, with roughly 1.9 GB net consumption over the prior day. Audit and
deployment activity contributes to this rate; it is not a steady-state forecast.
The node had 342,646,861,824 bytes free on /data. Measurements and failed-unit
status are local alerts, not proof of external notification delivery. PrivateTmp
initially hid deployment scratch from the allocation inventory; a read-only bind
corrected that observation gap, with both unit versions retained.

Exact prospective UI scratch cleanup candidates (not yet removed):
`/var/tmp/proofofwork-deploy/proofofwork-ui-source-6eb4a1e07131-20260919T161919Z.tgz`
(90,387,925 bytes, SHA256
`8a5059a98737ac278fac59fdff5a7681886dad8aa9401bafcaf9d81a0f233ca4`) and
`/var/tmp/proofofwork-deploy/proofofwork-ui-surfaces-6eb4a1e07131-20260919T161919Z.tgz`
(182,184,861 bytes, SHA256
`96967fc6b246a1466bfc2a1711c7db81ef7dccd7d20bb3a75245d5a04e85d830`).
These are this audit's uploaded transport copies. Removal is conditional on
completed publication, independent exact copies on the node, retained build and
release evidence, deployment-lock ownership, and no live process/config/mount
reference. Extracted source checkouts, final release archives, rollback roots,
restore trees and historical evidence are excluded. No age-based cleanup is
approved by this classification.

Production verification completed at Core height 967722 / hash
`0000000000000000000131a03cdb86ba46e6d262054784ff48cd04dd3106ae14`.
All 871 current listing anchors and the other bounded candidate invariants passed
again on the live API. Public HTTPS verification passed 687 SHA256/size checks
across fourteen domains (201,498,727 bytes, 13.226 seconds). Boost browser rendering
showed six records, no active listings, 2,184 proof signal and 7.0000011 WORK signal.
Release `6eb4a1e` is merged into main and both main/implementation branch are pushed.
No connected-wallet signing or live Boost sale lifecycle was exercised.

The read-only Computer event audit passed with no failures or warnings:
25,809 transaction rows, 26,414 event rows, zero confirmed missing raw transactions,
zero missing canonical blocks, zero confirmed events lacking their confirmed/raw
transaction parent, 56,100 refs and 125,873 participants. All ten named historical
transaction cases had expected event/log coverage. This cross-check does not
replace independent genesis replay. Summary latency remains material: the
concurrent audit measured marketplace 23.214s, ledger 14.469s and WORK floor
13.592s. The first launcher failed before any query because its helper was hidden
by PrivateTmp; the corrected run explicitly verified read-only pool settings.
Complete results and log hash are included in rollout evidence.

The two documented duplicate transport archives were removed after their exact
bytes were verified under `/data/proofofwork-audit17-ui-upload-copies-6eb4a1e`.
The cleanup held the deployment lock, verified the published archive, rejected
live descriptors/commands/config references and preserved before/after evidence at
`/var/backups/proofofwork-ui/recovery-evidence/audit17-transport-cleanup-6eb4a1e`.
UI available space afterward was 11,877,875,712 bytes. The capacity concern remains
open: this recovered only duplicate transport space, not historical recovery data.
The hourly forecast and allocation checks are deployed; external alert delivery,
off-host database recovery, whole-history independent replay, full Boost seal
cryptography/buyability and connected-wallet lifecycle coverage remain incomplete.
No issue is declared universally resolved on the strength of fixture-only tests.

### Performance/observation continuation — candidate, not yet deployed

Full-book reads still took several seconds per page, and response observations
reported `payloadBytes: null` because Node writeHead-only headers were not retained
for getHeader. The next candidate retains exact UTF-8 Content-Length and batches
Core outpoint requests in groups of 32, reducing 871 transport calls to 28 while
preserving every existing output and chain-transition check. No settled-result
cache or stale projection is introduced. Tests reject duplicate/missing/reordered
identity errors, RPC errors, malformed/oversized responses and invalid outpoints;
all 528 recovery checks pass with unchanged economic reconciliation invariants.
An additive journal-only monitor evaluates latency, server errors, response size
and unknown/truncated measurement coverage without adding API request load.
Its initial thresholds and visibility limits are documented in infrastructure.
Node-only candidate staging, real Core compatibility/performance and production
verification remain required; UI artifacts are unchanged by this candidate.
