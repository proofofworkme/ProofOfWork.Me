# Audit 29 approved remediation and release

Date: 2026-10-01 UTC. Scope: the four new findings from the first comprehensive
and second ordered read-only Audit 29, approved performance/operational work,
the exact documented redundant UI candidates, and the tested release workflow.

Status: operations and exact cleanup completed; Node App527 publication verified
at 07:41:18 UTC and UI publication at 07:48:41 UTC. Full production reconciliation passed at 08:30:09 UTC. Connected UI
verification and final workflow closeout remain pending.
Operational safeguards were installed on the UI at 05:30:48 UTC and node at
05:37:16 UTC, with prior bytes preserved. Exact cleanup completed at 05:56:11 UTC.
Authority services, prune masks and required recovery artifacts remain preserved.
Actual final verification and announcement receipts must be recorded before
calling the complete release workflow finished.

The user approved this implementation, exact verified cleanup, commit/push,
deployment and release workflow. Database migrations, compaction, checksum/PITR
changes and additional protected retirement are reserved for separate approval.
No protocol fee, supply rule, canonical data, ledger, historical record or wallet
signing authority is altered.

Chronology: retained preparation sections and JSON pending flags describe their
dated pre-execution state. Later successful Node/UI publication and acceptance
sections supersede those historical pending statements. Original attempt records
and their source bindings are preserved unchanged.

## Recursively preserved evidence

The first and second Audit 29 remain byte-identical in the original report and
companion evidence file. The report is 67,200 bytes, SHA-256
`f303972d7bed766a1d3ff296bf4d3d68d274291b1bc6c60b572076453b73f21c`;
the evidence is 2,413,677 bytes, SHA-256
`0841b70c7d6fe43c2112639f808fadf38c219b79c160c8b8d5db570a1c1ab30f`.
The Audit 28 held review also remains unchanged. New evidence is bound in
[this remediation receipt](2026-10-01-audit29-remediation-release.evidence.json).

Before source cleanup, 43 historical source-ref objects were checked against
durable local heads/tags. One commit lacked reachability: `412903503279`, an
Audit 26 rollout-verification documentation commit. A local archival annotated
tag and [verified compact recovery bundle](recovery/audit29-ui-source-412903503279.bundle)
preserve it. The bundle requires ancestor `140fd182f0f9df7e6d6def1031abdb5f0fc3dab4`,
retained on main; it is not an independent full-repository backup. No historical
source commit is authorized to disappear through cleanup or later Git GC.

## Fixes and verification contracts

| Finding | Correction | Data boundary |
| --- | --- | --- |
| AUD29-01, P2 | Accounting fixtures extract actual DNS constants and helpers; mixed DNS registration, update, seal and purchase checks exercise production math. The inherited ID audit extraction now uses the source AST. | Tests only; no evidence of a changed production fee or math rule. |
| AUD29-02, P3 | Desktop reports deduplicated owned content while retaining the shared welcome reference. | Original files, chain bytes and history remain intact. |
| AUD29-03, P3 | Pending ID display exposes retained event time, separate indexed first observation and independently fenced current Core admission. | Presentation enrichment follows resolution; Core expiry/conflict decisions and confirmed block dates stay authoritative. No database rewrite. |
| AUD29-04, P3 | AMO cards use accepted scoped wallet balances, with Loading, Unavailable and last-verified states. Partial movement previews no longer establish false zero. | Exact confirmed/spendable/reserved accounting stays separate. |

Pending-time verification covers readmission, register/update/list/seal/buy,
multiple records, equal-time deterministic ordering, checkpoint changes,
missing/ambiguous evidence and invalid/dropped audit rows. An offline replay of
20 actual pending records resolves the original 14 display mismatches without
overwriting the retained event or transaction timestamps. Recorded first-seen
and event-time fields differ for all 20; neither is relabeled as first-ever
network observation.

UI hydration coalesces overlapping focus/interval refreshes and aborts obsolete
account/network requests. Dedicated and fallback lane selection preserves the
authority and refreshing state of the accepted balance source. Live API
performance remains workload- and checkpoint-dependent; probes are qualified
by their exact route/scope rather than compared across unlike requests.

## Operations and exact cleanup boundary

Backup creation gains service resource caps and whole-run supervision. Failed
phases retain incomplete evidence and cannot publish a successful backup.
The previously restored logical backup stays pinned. A logical restore remains
a data/schema proof, not physical-checksum or PITR recovery proof.

Deployment staging refuses a scratch burst above 5 GiB and rechecks available
capacity before allocation. Source and failed-stage evidence has no age-only
automatic deletion. Storage monitoring separates capacity risk from allocation
review and labels burst forecasts conditional. External alert delivery is not
claimed.

The fresh cleanup manifest has exactly the same 15 nonlatest UI rollback roots
and 11 clean obsolete source trees documented in Audit 29. No release archive,
current/latest source, incomplete source, replay database, ledger, original audit
evidence or additional held item is in this approval. Only two of the 295 held
UI paths overlap that cohort. Their original hold evidence stays preserved;
completed retirement receipts can exempt those exact paths only after successful
verified removal. Every currently present held path outside that exact cohort
must remain present. The original 295 UI/521 node preservation obligations are
unchanged; a new existence census found the preexisting absences below. The three
prune timers remain masked. No bytes are counted as reclaimed until actual
post-cleanup filesystem measurements.

### AUD29-R01, P2: historical scratch files missing

Before any Audit 29 cleanup, the new existence check found 284/295 held UI paths
and 509/521 held node paths present. Eleven UI files and twelve node files were
already absent. They are historical deployment transports, configuration/helper
files and release receipts under `/var/tmp/proofofwork-deploy`; confirmed chain
records, database rows and ledgers are not included in this finding. The prior
monitor checked hold markers and timer masks, so its green result did not prove
the held inventory existed.

Bounded searches of surviving deployment scratch, current/rollback source,
release tooling and recovery inventory found no exact retained copies. Both
hosts previously used a `D ... 3d` tmpfiles rule. Their last successful clean
jobs ran September 30 at 21:40 UTC (UI) and 14:06 UTC (node), before the new
no-expiry safeguard. Age cleanup is a plausible cause; available journals do
not identify individual deletions, so causation and exact disappearance times
remain unproven.

The historical held review is preserved unchanged. Missing records are neither
fabricated nor exempted, and the new retention monitor remains red. A separately
hash-bound pre-cleanup absence census may admit only the already approved
26-path cleanup, while proving every other currently present held path and
current/latest recovery artifact remains intact. The two overlapping approved
source retirements would leave 282 currently present UI held paths protected;
the eleven preexisting absences remain unresolved. Any historical hold rewrite,
additional retirement or substituted recovery record needs separate approval.

## Rechecked limitations and follow-up

A bounded historical journal re-read with `--all` recovered all 38 long MESSAGE
fields previously serialized as null by journalctl's JSON size limit. They were
valid idle worker-cycle records with no error/warning fields. The original audit
observation is preserved and qualified here. This is a capture-method correction,
not a rewrite of production logs.

Current canonical wallet probes retain the previously documented H24-01,
AUD26-02/03 and PERF-27 availability limitation and can fail closed with
`CANONICAL_WALLET_INDEX_UNAVAILABLE`; retained UI evidence must remain labeled
last verified. Sanitized failure reasons are being added at actual unavailable
branches, without weakening precision or exact-tip gates. A separate background
ordering error is not assumed to cause that response. Release acceptance may
qualify only the exact existing unavailable contract under stable Core fences;
wallet balance and spendable capacity then remain explicitly unverified. Strict
ID, event, 102-check parity and complete listing-book/Core verification remain
mandatory, and a successful wallet response must conserve exact units.

Transition-table growth, checksum enablement, PITR recovery, additional held
retirement and provider billing-period bandwidth remain separate review items.
Original account-specific dropped-Outbox and conditional Boost ranking fixtures
are retained scope gaps unless a later production receipt explicitly closes them.

## Actions requiring separate approval

Concrete database/recovery plans will be appended before any execution. No
migration, VACUUM FULL/compaction, checksum operation, WAL policy change, restore
replacement or protected-data retirement is authorized by this release.

### Prepared database and recovery proposals; execution withheld

The prior ordered audit measured a 38,493,395,991-byte database and a
37,203,542,016-byte transition relation (96.65%) at Core 969391, with 9,771
verified transition rows. These are the preserved proposal baseline, not current
row counts. Later query-health reads report filesystem allocation and explicitly
labeled `pg_class.reltuples` estimates; those estimates are not exact counts.
Average allocation per historic block is an attribution ratio, not a future
growth forecast. The
live database is on node `/data`; UI disk recurrence comes from release and
scratch allocations. Existing query-health monitoring will report separate
database, transition and snapshot allocation using bounded metadata reads.

1. **Transition storage design and isolated profiling.** Before proposing a
   migration, profile a bounded recent-block sample and TOAST/index allocation
   in a separate clone. Proposed admission: at least 100 GiB real remaining
   `/data` reserve after the clone, a 64 GiB allocation ceiling, two CPU cores,
   8 GiB memory, two-hour runtime and no live writer connections. Compare
   compressed/delta/checkpoint representations with canonical commitments,
   whole replay and exact math. Present the measured design, row/object scope,
   backup, reversible cutover and rollback for separate execution approval.
   No representation change or historical retirement is executed here.
2. **Latest logical restore rehearsal.** Preserve the Sep 29 restore-proven
   pinned set and the current dump/globals. A separate restore must use a fresh
   isolated cluster, no production tablespace mapping, actual backup-lock
   admission, storage supervision and finite CPU/memory/time bounds. Verify
   schema, rows, event identities, math and roles/grants; the prior no-owner/
   no-privileges restore does not certify role/grant recovery. Retire neither
   existing rehearsal nor replay datasets under this release's approval.
3. **Physical checksums.** PostgreSQL 16 checksum enablement requires an offline
   maintenance window. First specify the exact cluster/tablespace inventory,
   quiesced writers, fresh logical plus physical backup, verified restore, WAL
   and storage headroom, outage bound and rollback. Approval must name those
   concrete artifacts and window before stopping the database or invoking
   `pg_checksums`. An isolated checksum-enabled logical restore does not prove
   present production pages have physical checksums.
4. **PITR.** Select an off-host encrypted backup destination, retention budget
   and access policy; then prepare exact physical-backup/WAL configuration,
   required privileges and failure monitoring. Demonstrate an isolated restore
   to a specified timestamp against the full node and exact ledger/math before
   any production archive-mode, role/slot, firewall or retention change. Neither
   a dump catalog nor its SHA-256 is a PITR recovery certificate. Destination
   choice and execution remain approval-dependent.
5. **Further protected retirement.** Independently prove dependencies and
   output equivalence for active replay, retained restore pairs, older replay
   and rehearsal copies. Present an exact new manifest with recovery
   equivalents and fail-closed partial-execution receipts. No age-based rule
   or capacity pressure expands the current 26-path UI cleanup approval.

## Implementation validation before application publication

The accounting/capacity regressions, thirteen pending-time fixture groups, UI
regressions and eight mocked browser scenarios pass. TypeScript, server free
identifiers, ID audit contract, API truth, exact WORK/bond/fee math, recovery
behavior and UI containment checks pass. Release-control failure fixtures cover
known/unknown exchanges and bounded rollback; private launch fixtures cover
source identity, read-only SQL, competing locks, timer restoration, output
limits and descendant termination. Backup supervision, capacity, retirement
census and database metadata tests pass. These are implementation checks; only
a later source-bound production receipt can close the actual release gates.

The required hygiene cleaner found no remaining allowlisted rebuildable state.
Canonical docs and SOUL were semantically reviewed; generated outputs and
original audits/ledgers are preserved. No protected tracked file is deleted.

## Completed exact cleanup, 05:56:11 UTC

All 15 approved nonlatest rollback roots and 11 clean source trees were removed
after full preflight and per-removal current/latest recovery verification. The
26-item completion receipt SHA-256 is
`2b927bca35216a21f3c92145715d36fbbbd9cb03432780bfc04dc18d17d61057`.
The exact two held-source retirements are installed as completed exceptions; no
missing historical file is exempted. The 282 other currently present UI held
paths, current/latest roots and archives, incomplete source, original held
review/markers, prune masks and preserved unique Git work remain intact.

Actual UI available space changed from 14,573,342,720 to 22,858,788,864 bytes
(an observed increase of 8,285,446,144 bytes). Scratch allocation changed from
6,676,426,752 to 3,677,802,496 bytes. These filesystem measurements include
concurrent normal activity; the candidate allocation sum is not claimed as the
observed free-space result. Caddy retained PID 3092586 throughout.

Prepublication review found two tooling-only corrections before any application
exchange: preserve the intentionally inactive/disabled WAL receiver rather than
requiring PITR to be enabled, and inherit the admitting deployment lock through
UI transport/extraction/staging. Core, Electrs and PostgreSQL must still be
active; their states and the WAL baseline must remain unchanged. The original
implementation commit remains preserved. Revised release tooling passes 14/14
controller and 26/26 workflow fixtures, including a real competing lock process
through all 16 surfaces and staging; an independent review reran both suites.
It will be committed and used for a newly bound candidate.

A further prepublication tooling correction binds UI candidate verification to
the exact staged root using the installed helper's allowlisted staged mode.
The live-root default would otherwise compare the new archive with the prior
UI. A controller-level fixture checks the actual helper arguments and scoped
environment; all 15 controller tests pass. Earlier candidates and tool inputs
remain preserved; a fresh exact candidate will bind this correction.

The reusable UI transport parent is preserved in the repository. Five focused
fixtures verify exact stdin, inherited descriptor, hash/ownership refusal,
bounded failure output and descendant termination before releasing the parent
lock. Its production run remains a separate acceptance requirement.

## Prepublication full-book verification correction

The first source-bound shadow attempt passed the complete ID audit (587
transactions, 508 confirmed winners, 20 pending candidates), all 49 event checks
and the strict 102-check parity suite (100 passing checks and two pre-existing
inactive V5 warnings) at stable Core height 969403. Its exact wallet response
was available and independently conserved 9,999,997,003,878,536 confirmed
subatoms = 9,999,970,087,899,719 spendable + 26,915,978,817 reserved. This is a
point-in-time availability result; it does not establish permanent resolution
of the prior intermittent fresh-wallet issue.

That attempt correctly refused publication when the independent helper omitted
the source-declared unsealed `sealAt` commitment. JSON drops owned undefined
properties; invalid confirmed seal evidence instead omits the seal patch. Only
those two actual producer forms are reconstructed, selected by the full-record
hash; arbitrary key combinations, substantive changes and unknown hashes fail.
AST fixtures use the actual reader producers and API serializer. No API,
protocol, canonical record or ledger is rewritten.

A separate read-only complete five-page full/five-page display read at stable
Core height 969404 proved all 999 actual listings: 958 sealed commitments and
41 unsealed owned-null commitments. The corrected helper independently
reproduced every record hash, complete membership, protocol membership and
snapshot binding. All 22 probe and 9 candidate fixtures pass. Full independent
Core ticket checks and a fresh source-bound accepted release receipt are still
required before cutover; the failed candidate receipt cannot authorize it.

## Accepted candidate and preserved cutover refusal

The unchanged application candidate `527e4cbaa66f` (tree
`34c2be6c121a40292d147d74f3a866b169d1feea`) passed the complete mandatory
shadow gates at stable Core 969406. The root-owned accepted receipt SHA-256 is
`15d58da39b7c3452520404052d137926be17a40dc2e085def2b03391c4acad87`.
All 999 current WORK listings passed full/display membership and independent
Core anchor checks, followed by a fresh membership fence. IDs covered all
565 confirmed and 22 observed pending registry transactions, resolving 508
confirmed winners and 20 pending candidates. Events passed 49 checks; strict
parity passed 100 checks with the same two inactive V5 warnings. The wallet
returned independently conserved available confirmed/spendable/reserved amounts.

The first cutover refused before exchange at 06:40:52 UTC because the controller
referenced `/usr/bin/runuser`, absent on this VPS. It restored the prior
application and timers; readiness was proven at 06:41:47 UTC. No code exchange,
authority-service change or recovery deletion occurred. The failed controller
receipt remains at `/data/proofofwork-audit29-cutover-527e4cbaa66f-20261001T062733Z`.

The correction is confined to release tooling: native nonroot PostgreSQL
credentials, a hash-bound version-16 client and a real read-only preflight before
any application stop. A fresh attempt namespace preserves the original failure.
Application source, staged runtime, UI source/surfaces and archives remain
byte-identical to the accepted 527 candidate. The separately committed controller
is bound independently, avoiding redundant application rebuild/staging allocation.
Its host preflight and actual publication results must be added after execution.

The corrected controller passes 23 focused fixture groups, including actual
native-child execution, zero inherited root locks, pre-stop failure refusal,
read-only connection settings, session drain and immutable retry namespaces.
The actual host preflight passed at 06:49:24 UTC with PostgreSQL 16.15, uid108/
gid112, read-only mode and 30s/5s timeout settings. Its 14 live application
sessions were expected and were not terminated. The preflight stopped no
services and changed no data. Actual publication remains pending.

At 06:52:40 UTC, retry1 exchanged the verified candidate after a successful
native read-only preflight and zero-session drain. Candidate readiness recovered
at 06:52:43 UTC, but the installed archive publisher rejected the twelve-character
request filename: its contract requires a delimited seven-character commit token.
The controller verified the same old/candidate root pair, drained and exchanged
back at 06:52:50 UTC; the prior application was ready at 06:52:53 UTC. Authorities,
holds, recovery bytes and prior timer states remained unchanged. This was a
verified rollback after exchange, distinct from the first pre-exchange refusal.
Both attempts and the rejected request remain preserved.

The tooling correction validates the full application commit/release identity,
uses the publisher's required commit7 filename, and refuses existing request,
managed archive, checksum or provenance paths before stopping applications. An
actual-source fixture executes only the installed publisher's filename predicate:
the corrected name passes; the original commit12 and wrong commit7 names fail.

Independent review also reproduced an inherited 4 MiB per-file limit blocking
legitimate archive/runtime writes. The controller now bounds log output separately
using a pipe and finite time budget. Metadata/SQL children retain the 4 MiB file
limit; only bound publisher/provenance artifact phases receive a finite 2 GiB
per-file limit. Log overflow and timeout kill the complete private process group,
including descendants of an exited leader. This is a release-tooling correction;
application source, protocol rules, accepted runtime and UI archives stay frozen.
Fresh mandatory shadow acceptance and actual publication remain required.

## Additional operational observations

### AUD29-R02, P2: service interruption during package maintenance

At 06:24:28 UTC, the scheduled package-upgrade interval installed the OpenSSL
3.0.13 Ubuntu update from revision 3.15 to 3.16. PostgreSQL stopped at 06:24:30
and recovered at 06:24:32; the dependent API exited and recovered by 06:24:36.
API/reader bytes remained the old verified release, and Core/Electrs identities
were unchanged. The timing strongly associates the restarts with package
maintenance; the bounded retained metadata does not prove the initiating helper
or caller. These external restarts were not initiated by this release controller.
The release baseline was recaptured rather than falsely attributing the new
PostgreSQL PID to the cutover. Plan dependency-aware maintenance and interruption
alerting; do not disable security updates. No new maintenance policy is applied.

The prior one-object supplemental Log count remains unresolved. A fresh compact
snapshot at Core 969404 contained 26,277 ledger objects versus 26,276 public
objects, with one nonconfirmed supplement. Bounded read-only DB/Core checks at
969406 verified all 21 indexed pending transaction identities (20 ID records and
one mint), with no indexed-versus-Core status mismatch. The compact responses
omit identities, and matching counts do not identify the historical or current
supplement. No unsupported identity or data correction is inferred.

## Fresh-checkpoint retry evidence

The final independently reviewed release controller is committed at
`c175bd0ceb9b5f2cb3aaea68578e3c3eae7a204c`; its exact source SHA-256 is
`09afe5ddd243a796ea9c830b0041924747eb77a3803a3cfe56a3279cd24bf670`.
All 30 focused controller groups pass, including real bounded artifact writes,
separate capped logs, native read-only SQL, immutable retry names and descendant
termination. Actual host preflight passed again at 07:01:43 UTC. The application
candidate and its source, runtime and UI archives remain the frozen 527 release.

The initial accepted shadow receipt expired under the controller's existing
30-minute freshness rule and was not reused after expiry. Fresh read-only retry2 failed after
Core advanced from 969409 to 969410; retry3 failed after 969410 to 969411. Each
failed ID child returned no stdout and its stderr was counted but discarded by
the immutable verifier. API-side journal messages correlate to the fixed
Core/Electrum fence and exact-checkpoint scan guards, respectively; the particular
nested child cause and guard predicate remain unproved. Events, parity, wallet
and book gates were not reached in either attempt. Both failures and restored
backup-timer states are preserved; neither receipt authorizes publication.

A bounded readiness check observed a recent cluster of advancing blocks and
indexer catch-up. Independent metadata confirmed Core and Electrs at 969415,
headers equal blocks, no IBD or warnings, and a worker with successful current
cycles and no OOM. By 07:28:36 UTC all readiness guards passed: canonical current
checkpoint, summary coverage, current worker proof and pending-event status.
Earlier zero-lag readiness refusals did not retain every reason flag, so their
exact predicate is not retrospectively inferred. Fresh retry4 began against this
healthy baseline. Its completion and any actual publication must be recorded
separately; elapsed runtime alone is not acceptance.

## Successful Node publication

Fresh shadow retry4 passed all required gates from 07:29:56 to 07:38:50 UTC
at stable Core 969415/hash
`00000000000000000001685e3b359ca766dee24bf416456ebea83e76d7ed08de`.
Its root-owned accepted receipt SHA-256 is
`e554e934ea212f45c026a3e3a1a3430ed29e7592aa4bd8a9785164b140286d02`.
The complete ID replay, 49 event checks, strict parity (100 passing checks and
the two existing inactive V5 warnings), all 999 full/display listing commitments,
999 independent Core anchors and final membership fence passed. The exact wallet
returned HTTP200 with the same independently conserved amounts recorded above.
This is a verified point in time, not a permanent availability guarantee.

Node cutover retry2 completed successfully at 07:41:18 UTC using the separately
bound final controller. The atomic exchange occurred at 07:40:17. The installed
publisher generated and verified the managed archive
`proofofwork-node-release-527e4cb-20261001T062733Z.tgz`, 95,141,685 bytes,
SHA-256 `6fe8cfa7f9dd797371890549ef2b0b93c6509bb354e24f472d5613a6a7d3e6d5`,
with exact App527 commit/tree/runtime binding. The original 993 recovery root,
archive and provenance remain preserved. Prior timer states were restored; no
authority service or recovery artifact was changed or removed. The aggregate
244-file cutover evidence SHA-256 is
`712abb054f1dcfbc91dbea1e89c560f8c816cd3d34af015f7d4aaab72cb7a9f4`.
UI publication and the postpublication checks are separate acceptance gates.

## Successful UI publication

UI publication completed at 07:48:41 UTC with verified App527 source and tree.
Its 198,317,252-byte archive retains SHA-256
`51d4b0a88ae42af45022f2215277fe8edf37538579feccc57122ee5d89911ad1`.
Live manifest and archive provenance bytes match, SHA-256
`305492a8b43e08a3fec529fad770f58b5209c9eb605490c694562242314f94ba`.
The new live full-root fingerprint is
`acde0cfe67a9716074135758b364703c05047693336dcaec1e5282361d9de8c0`.
The frozen staged inode511864 became the live root; the prior live root moved to
`proofofwork-www-pre-527e4cbaa66f-20261001T062733Z` with its original complete
fingerprint. The earlier classified rollback remains unchanged. Retention was
deferred, with no additional cleanup. Caddy retained PID 3092586 and its invocation.

Independent source-bound completion evidence SHA-256 is
`8e6ef006ebcb4196f3cb46b12aa7f712be75b68fc600bb91842779677b655aa5`.
The small publication inputs use the separately committed final controller and
fresh accepted shadow4 receipt; the original 098/286 inputs and failed attempts
are preserved. The final command adds explicit TasksMax128 and strict keyed SSH.
Two supplemental metadata-only observations produced refused/empty outputs;
those are retained as observation failures, not publication failures. Actual
publication success is established by the durable completion receipts and the
independent source/archive/root/provenance checks. Final public/static,
production full-node and connected-account checks remain separate gates.

## Postpublication public static verification

All 15 requested public hosts passed in order, Home through Computer last, at
07:50:14–07:51:26 UTC. All 600 HTTPS requests returned 200 and matched the frozen
release bytes, SHA-256, security and cache headers. No host or resource mismatch
occurred. The check covered 31,275,362 decoded bytes in 71.908 seconds; resource
p95 was 600ms and maximum 1027ms for this run. These are individual static resource
timings, not API performance or a universal latency guarantee. Local source and
surface archives also match all 818 entries/784 regular files; the 49-entry NFT
alias matches Computer locally. No invented NFT public host was queried.

The complete source-bound receipt SHA-256 is
`133f3021b73b5f348dfd4e4ba6667eeda699d32e5caec8b28d47119ef47dcfeb`.
The checker made no API, wallet or transaction request. Dynamic rendering and
current full-node production reconciliation remain separate pending acceptance checks.

## Postpublication operational and performance points

The independent metadata census at 07:54:51 (node) and 07:54:54 (UI) verified
App527/tree34c2, both checked source-file hashes, and the installed UI manifest.
Core and Electrs matched 969418/hash
`00000000000000000001b70709ca22898a97aa1d7894580376531763630c6c11`;
Core headers and all three indexes matched, with no IBD, pruning or warnings.
Core, Electrs, PostgreSQL and Caddy invocations remained unchanged. API, worker
and WireGuard processes were active on the approved release, with zero restarts.
Inactive WAL remains the pre-existing baseline, not a PITR certificate.

| Measurement | UI VPS | Node VPS |
| --- | --- | --- |
| Available filesystem bytes | 22,150,836,224 | Root 69,761,703,936; data 377,559,310,336 |
| Available memory bytes | 3,382,624,256 of 4,005,457,920 total | 114,567,630,848 of 134,125,752,320 total |
| Load average 1/5/15-minute | 0.078/0.286/0.296 | 4.454/4.014/4.348 |

These are timestamped resource points, not CPU utilization percentages or
billing-period bandwidth. Existing prepublication scratch allocation was
4,169,957,376 bytes at 07:41:54 versus the independent 5 GiB limit 5,368,709,120.
If unchanged, conditional remaining admission capacity is 1,198,751,744 bytes.
Remeasure under the deployment lock before another staging allocation; physical
free space does not enlarge this separate ceiling. No new cleanup is authorized.

Backup unit, actual dump processes, incomplete paths and shared lock were quiet;
the timer remained waiting. The 07:50 scheduled query-health sample had warned
about one 10-second idle transaction during the private verifier. The later
07:55:04 scheduled sample succeeded: 13 connections, 1 active, no lock waiter,
no idle transaction and no dump client. It reported a 38,620,814,359-byte database,
37,331,427,328-byte transition relation and 708,943,872-byte snapshot relation,
with 18/18 placements and zero invalid indexes. Row counts in that metadata are
explicit estimates. Neither sample certifies all-row integrity or future growth.
No fresh SQL or API call was made by this census.

The original census queried role-suffixed retention template names that are not
installed. Corrective metadata verifies the actual generic service targeted by
the live timers. Both monitors are truly failed/exit 1 for R01, with the exact
same 23 missing obligations and no new missing file. The two approved UI held
source exceptions and all three prune masks remain unchanged. This expected red
state is preserved; it is not an installation failure or an exempted obligation.
Qualified metadata evidence SHA-256:
`bc4b78d48131fb7251297eacdfdbb2df9cd2d9066c894de12ce422e4652897e1`.

Four sequential, exact scoped API probes at 07:57:25–44 returned 200: canonical
summary 3854ms, compact marketplace summary 6362ms, ID ross 3126ms, fresh wallet 4833ms.
The like-for-like ID baseline was 3854ms. The prior same-scope wallet 503 at 4302ms
versus current 200 establishes point response availability, not a latency
improvement or permanent resolution. The bounded wallet journal captured one
200 observation and no unavailable guard diagnostics; concurrent callers are not
uniquely attributed, and absent diagnostics alone do not prove readiness.
Its source-bound receipt SHA-256 is
`a36a00179d784c4b42d293abdf5ff31ca34d923f9e2841fd447ed3a8b033f788`.

## Preserved first production acceptance refusal

The first postpublication attempt ran 07:49:55–07:52:50 UTC and refused acceptance
when Core advanced 969416 to 969417. The ID child exited 1; its 794-byte stderr was
counted and discarded by the immutable driver. Other mandatory gates were not
reached. Its exact receipt SHA-256 is
`d09c59dc91a4ecb41d709edeafd9b4935e2d3a853b98f0d673b76b475efc134e`.

A bounded 239-entry API journal window and offline actual-source AST match
identified the 148-byte message as `server/proof-api.mjs:78219`'s checkpoint/
Electrum-history change guard. The initial narrow-catalog UNKNOWN classification
remains preserved; the exact-source correlation SHA-256 is
`8dab291988e2002af986552ca426dd39a66c7d8497271430f897d437ce8348d8`.
The particular OR predicate and nested child exception remain unproved. Backup
timer intent and restored enabled/active states are verified. A fresh bounded
production retry1 uses the unchanged gates, source and deadlines; its outcome
must be recorded before complete release acceptance is claimed.

Production retry1 also refused acceptance at 08:02:08 UTC after Core advanced
969418 to 969419. Its source-bound gate receipt SHA-256 is
`4f231ce4f7f93e4a29386895273cef54fe270249b3083872257466dc31745604`.
The exact 124-byte API message matches the actual reader's current-checkpoint
scan guard at line 37109; independent correlation SHA-256 is
`8df7aa3bf86a84dd941362dddbe0c9766ca4b499c71b8bf4a2c799104bafc508`.
The ID route returned 503 after 118,708ms. Nested stderr and the particular guard
predicate remain unproved; later gates were not reached. Backup timer restoration
is verified. A separately bound read-only retry2 uses unchanged acceptance rules.

## Postpublication Desktop rendering

At 08:17:20 UTC the public Desktop fixture `1F1p9UEH...hj6t5nFv` loaded and
completed a refresh. The status toast and heading both report four public owned
files: the ID documentation, README, profile image and audio file. The shared
welcome remains visible as a separate System reference and is excluded from the
owned count. No signing or transaction was requested; existing attachment and
historical content remains displayed unchanged. DOM-backed receipt and
screenshot hashes are preserved in the companion evidence. Connected Computer
AMO/Wallet verification remains pending on the current connect-only prompt.

## Preserved stable-checkpoint production partial result

Production retry2 ran 08:06:50–08:12:32 UTC at stable Core 969419/hash
`00000000000000000000860344d7dcaf032a6c2a86f660e5a3fdf1e81219a39a`.
IDs passed with 587 fetched transactions, 565 confirmed and 22 observed pending
registry transactions, 508 confirmed winners and 20 pending candidates. All 49
event checks and strict parity passed (100 true checks plus the two existing
inactive-AMOV5 warning conditions), followed by the 20-record pending-date
comparison. These are positive scoped results, not global release acceptance.

The second HTTP attempt began the public current/fresh ross read, but no
completed status or body was recorded. The driver stopped with
`READONLY_VERIFICATION_FAILED`; the public current Ross read, wallet and full
book/Core gates were not completed. The retained bounded journal has no
corresponding completed or interrupted ID-route observation. The cause remains unknown; this attempt is
not a moving-Core refusal or evidence of a substantive data mismatch. Original
receipt SHA-256 is
`22709c1f1f3bb8d4dbd0fa280a0f524b9c0db8423a7e84386373806f224a30d7`.
Backup timer active/enabled intent was restored, and the backup service remained
inactive with no writer PID. The follow-up uses the unchanged gate contract.

## Production verification origin correction

The invocation wrapper chose `https://api.proofofwork.me`, a separate hostname
that production deliberately does not require. Canonical infrastructure
documentation states that each actual application hostname proxies `/api/*`
and `/health`; the Computer build uses `https://computer.proofofwork.me`. A
bounded Node24 point read of the incorrectly selected API hostname returned
`ENOTFOUND` without an HTTP response. A preceding apex-301 probe used the wrong
host and is preserved as an unrelated diagnostic. Neither observation recovers
the original generic exception or proves its sole historical cause.

A separate local wrapper changes only the production base URL to the documented
Computer HTTPS origin, already allowed by the immutable verifier and guarded
launcher. Original wrapper and failed attempts remain unchanged. Private
authority, source hashes, strict checks, whole-run Core fences, `redirect:error`,
budgets and backup restoration remain identical. No production DNS, Caddy, API
configuration or source is changed. Independent review and a bounded serving-
origin point read precede the fresh retry. This corrects the audit invocation;
it is not a newly discovered production DNS requirement or an application fix.

Independent origin review passed with the exact one-literal change; review
receipt SHA-256 is
`447d0ab2d8ec5ab00c23edc4e2220989e78542d17c34fb92c55b347c56dddb8a`.
The first Computer-origin point read returned valid guarded 503 JSON in 1539ms
at 08:20:54 UTC. It establishes serving-origin reachability, not current ID
acceptance. Fresh readiness and exact-route evidence are checked before the
longer retry; no global success is inferred from that point.

Fresh serving-origin preflight at 08:22:28–30 UTC passed: health 200/532ms,
ready/available true, zero lag at Core 969421/hash
`0000000000000000000078a7afd5f4292a79a4608ebf9ed372878ebb85164458`,
then exact current/fresh ross 200/1692ms with pending status and retained
`2026-09-16T11:38:58Z` event time. Two sequential Node24 requests retained
`redirect:error` and 20-second deadlines; no SQL or mutation was performed.
Receipt SHA-256 is
`04a4a06228b611efcf0d94d4c52d80bca0d29e8afefd4fee8ec508968f228b10`.
The corrected, reviewed wrapper launched a fresh bounded production retry3.
Its actual full result is required before final acceptance.

## Accepted full production reconciliation

Production retry3 passed 08:23:02–08:30:09 UTC through the actual Computer
HTTPS API with source-bound App527 and unchanged verifier. Core remained at
969421/hash
`0000000000000000000078a7afd5f4292a79a4608ebf9ed372878ebb85164458`
through every mandatory phase. Strict IDs, all 49 event checks and strict
102-check parity passed (100 true plus the two known inactive V5 warning
conditions). All 20 pending ID dates agree with retained indexed evidence,
and public current ross is pending with the correct provenance contract.

Fresh authoritative wallet 200 verified exact Q16 conservation:
`9999997003878536 = 9999970087899719 + 26915978817` subatoms; pending delta is
zero. Confirmed WORK is `0.9999997003878536`, spendable
`0.9999970087899719`, reserved `0.0000026915978817`. This is verified balance
and capacity at this checkpoint, not permanent resolution of intermittent
wallet availability or proof of the still-pending connected AMO rendering.

All 999 current WORK listings match complete full/display commitments, five
pages per projection, including 39 source-declared null-seal reconstructions.
All 999 tickets were independently checked with Core `gettxout` for exact
value, script, confirmed unspent status and bestblock. Complete membership was
rechecked after those Core reads. Total counters are 14 HTTP requests, 1009
Core reads and 57,216,651 bytes under unchanged bounds. Historical excluded
rows are not independently replayed by this full-route snapshot comparison;
pending and book fences are scoped, not an atomic global mempool certificate.

Immutable accepted root receipt SHA-256 is
`502cfa4ecfadfa8886b95d7bb01f6a8a41827e4e08d3466bf7cb9c414df769ca`;
localized aggregate SHA-256 is
`454930f242235f82aac5b35290452dedb92ec55bc5f83b5462ff63a87a8e6245`.
The launcher completed exit zero in 430.486 seconds; its managed unit reported
430.533 seconds. Original failed attempts remain unchanged. This acceptance
supersedes earlier dated pending-production statements only; connected UI,
final hygiene/commit/push and the verified announcement remain separate work.

Independent source/math review confirms the accepted receipt and underlying
driver binding (`5a6bc113...`), every Core fence, exact integer conservation,
all 999 full/display rows and Core witnesses. Explicit root-owned backup-window
intent/restoration also passes: the prior active/enabled timer is restored,
with the service inactive/dead and PID zero at 08:33:05 UTC. Restoration receipt
SHA-256 is
`a24dcc1a351220e5acd308c95597a841746930e32598cb3a525c2fc578c5ef7e`.
An earlier supplemental collector refused an unsupported timer-MainPID
assertion before producing output; its original bytes and failure remain
preserved. The corrected collector labels timer MainPID inapplicable.

## Connected-browser handoff and remaining workflow

At 08:34:27 UTC the released Computer still visibly shows `Opening UniSat...`,
a disabled Connect button and `Not connected`; no account-confirmed AMO balance
label exists yet. An earlier human connection reply was received, but the
current reloaded page's connect-only workflow has not returned an account. The
current request remains open for the human. No signature, transaction or wallet
private state was requested or inspected. This observation does not establish
a production code defect or a balance mismatch; the actual connected AMO/Wallet
rendering remains unverified. Its DOM-backed handoff and screenshot hashes are
retained in the evidence companion, and the Computer tab remains available.

No additional implementation approval is needed for the already approved
changes. Complete the current connection, compare the scoped AMO/Wallet cards
with the accepted exact balances, then publish and verify the one release
announcement after the final reviewed audit/hygiene commit is pushed. Do not
claim the complete workflow finished or a connected rendering pass before that
actual evidence exists. No announcement has been published at this handoff.

R01 remains red for the 23 preexisting missing historical scratch artifacts;
missing evidence is neither reconstructed by assertion nor exempted. R02's
package-maintenance interruption and unproved initiator remain documented for
coordinated-maintenance follow-up. Intermittent wallet availability, original
dropped-Outbox/conditional Boost fixtures, provider billing-period bandwidth
and off-host alert delivery retain their stated limitations. Database/storage
proposals above are prepared for separate review; no migration, compaction,
physical-checksum/PITR change or further protected retirement was executed.

The independent acceptance review passed 43/43 local source/receipt, checkpoint,
arbitrary-precision and scope checks; its SHA-256 is
`525b69b7fc4a2e29acc25e2016ee08f591353b52131fdc9165bec8226a46edad`.
It did not repeat remote requests, decode a new raw book or certify additional
historical populations. Final semantic review covers SOUL, all canonical docs,
classified notes, generated/protected artifacts and the four-file diff.
`hygiene:fix` found no allowlisted rebuildable state and removed nothing. The
final `hygiene:check` passed. The immutable Git commit containing this closeout
and verified remote refs identify its durability without a self-referential
hash. Connected acceptance and the announcement remain pending.
