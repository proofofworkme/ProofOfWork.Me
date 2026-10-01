# Audit 29 approved remediation and release

Date: 2026-10-01 UTC. Scope: the four new findings from the first comprehensive
and second ordered read-only Audit 29, approved performance/operational work,
the exact documented redundant UI candidates, and the tested release workflow.

Status: implementation and release preparation. The approved UI operational
safeguards were installed at 05:30:48 UTC with prior helper/configuration bytes
preserved. The node safeguards were installed at 05:37:16 UTC; the backup timer
was restored to its prior active/enabled state. Caddy, Core, Electrs, PostgreSQL
and masked prune-timer states remained unchanged. Production
application cutover and announcement results must be added from actual receipts
after execution; they have not yet occurred. Exact cleanup completed at 05:56:11 UTC under bounded supervision. Its
completed receipt is bound below; application publication remains pending.

The user approved this implementation, exact verified cleanup, commit/push,
deployment and release workflow. Database migrations, compaction, checksum/PITR
changes and additional protected retirement are reserved for separate approval.
No protocol fee, supply rule, canonical data, ledger, historical record or wallet
signing authority is altered.

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

The observed database is 38,493,395,991 bytes. The transition relation accounts
for 37,203,542,016 bytes (96.65%) over 9,771 transitions. Its average allocation
per historic block is an attribution ratio, not a future growth forecast. The
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
