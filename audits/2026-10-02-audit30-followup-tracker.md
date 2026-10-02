# Audit 30 follow up tracker

Date: 2026-10-02, America/Toronto. Purpose: track the eight recommended follow-ups from audit 30, their approval boundaries, evidence and completion. The user requested ongoing tracking and explicitly approved **“Approve batch 1-3 as scoped.”** Items 1–3 are now authorized and in progress; items 4–8 remain planned for separately described approval scopes. The [human approval receipt](2026-10-02-audit30-first-batch-approval.json) binds the exact preparation scope SHA-256.

Sources: [audit 30](2026-10-02-production-comprehensive-health-data-integrity-audit-30.md), SHA-256 `2d0d0d052df0772505ce77050a06033574bf06b87083d3792f376a8186c7a305`; [audit 30 evidence](2026-10-02-production-comprehensive-health-data-integrity-audit-30.evidence.json), SHA-256 `8c57aae23db56530ac2289a4232208a5eaa9af9345f1f929948c1eb41a4eb9a8`. These historical artifacts remain unchanged. New execution evidence will be recorded separately and linked here.

The [first batch proposal evidence](2026-10-02-audit30-first-batch-preparation.evidence.json) enumerates all 40 proposed retirement paths and three preservation relocations, records their audit bindings and holds, and describes the approval/revalidation boundaries. It includes the fresh scratch preparation receipt, SHA-256 `9e4a22599b8151aa55f112b1cf1619af327544d85398e37440daf1bdb1637f43`. It is a proposal, not an execution authorization or a completed cleanup receipt.

## Progress

| Item | Work | Status | Approval | Completion evidence |
| --- | --- | --- | --- | --- |
| 1 | Exact decimal fee arithmetic, AUD30-01 | Source and targeted tests passed; production release pending | Approved batch 1–3 | Pending production verification |
| 2 | Retention service visibility and exact relocation recognition, AUD30-02 | Production namespace verified on both hosts; repository handoff pending | Approved batch 1–3 | Actual services/direct checks agree; 11 UI and 18 node absences remain |
| 3 | UI exact cleanup, source preservation and bounded release retention | Exact controllers pass independent fixtures; production plan pending | Approved batch 1–3 | Pending fresh gates, execution and capacity verification |
| 4 | Preserve mail bytes, AUD28-04 | Planned | Separate parser/deploy and projection-rebuild approval needed | None yet |
| 5 | Reduce database growth while preserving replay | Planned | Separate isolated prototype/migration scope needed | None yet |
| 6 | API availability and complete acceptance checks | Planned | Separate diagnosed correction scope needed | None yet |
| 7 | Backup restoration, physical integrity and PITR | Planned | Separate isolated restore/check/service scope needed | None yet |
| 8 | Recovery custody, runtime attestation, node inventory and ledger assurance | Planned | Separate exact repair/retirement scopes needed | None yet |

Statuses distinguish awaiting approval, implementation, tests/build passed, ready for deployment, production verified, blocked/remaining obligations and complete. A passing local fixture or an installed unit is not enough to mark a production fix complete. Each update records the actual authorization, files/configuration, actions, failures, validation and durable evidence. Conditional failures are preserved.

## Approved first batch scope

### Item 1 scope and acceptance

Proposed source scope: `src/walletUtxos.ts`, `src/App.tsx` and `scripts/check-fee-rate-precision.mjs`, plus relevant test wiring and audit/progress documentation. Use a shared exact decimal-scaled integer fee-ceiling helper for selection, chained mint, mint budget, transfer-split and mint-split calculations. The transfer-split preview is another instance of AUD30-01 found during scope review, not a separate issue. Boost already uses the shared selector and needs coverage rather than a functional change.

Preserve accepted rates and eight-decimal validation, existing vbyte estimates, 546-proof dust threshold, UTXO ordering, confirmed funding, reservation checks, review/signing guards and all 1,000/546-proof protocol fees. Invalid preview input must remain safe to render. No API, indexer, database or protocol-record correction belongs to item 1.

Acceptance includes an independent rational oracle and actual unsigned preparation/decoding. At rate 0.28 and the existing 275 estimated vbytes:

| Input proofs | Required fee proofs | Required change proofs |
| ---: | ---: | ---: |
| 100,000 | 77 | 99,377 |
| 1,169 | 77 | 546 |

Also cover no-change, insufficient funding, zero and eight-decimal rates, invalid rates, chained/split previews, Boost and input/output conservation. No signature or broadcast is needed for these fixtures.

Proposed release scope: targeted fee/funding/Boost/intent tests, coherent frontend build, mandatory hygiene/hooks, approved commit/push and standard UI deployment. Verify source/deployed hashes and the relevant browser surfaces and fee behavior. Apply the standing release-announcement workflow once the release is committed, pushed, deployed and verified. Mark complete only after the production evidence and handoff are recorded.

### Item 2 scope and acceptance

Proposed configuration scope: the UI and node retention unit templates and their installed counterparts, with `BindReadOnlyPaths=/var/tmp/proofofwork-deploy` and existing service hardening preserved. Proposed checker/test scope: `scripts/check-retention-protection.py`, existing exact-retirement tests and effective-namespace integration coverage. Recognize only the two already-approved UI relocations, validated against exact approval/move receipts and surviving target bytes.

Installation includes systemd reload and one read-only monitor run on each host. Approval does not include removing the retention hold, unmasking pruning, relaxing backup pins or broadly ignoring missing files.

Acceptance: scheduled and direct host checks agree; all 78 present-file false positives disappear; approved relocation recognition rejects changed, unsafe, unapproved or partial evidence. The original 23 unresolved absences and six qualified node managed-path absences remain visible. **Monitoring may correctly remain failing because item 8 is unresolved.** Accurate reporting completes this defect correction; it does not close the underlying evidence gaps.

### Item 3 scope and acceptance

Proposed one-time retirement scope: **the ten rollback directories and ten TGZ archives listed in audit 30, plus each archive's `.sha256` and `.provenance`: 40 top-level paths**. The evidence lists exact absolute paths, archive bytes/hashes, contained releases and root-manifest bindings. The 40 paths are post-census children of held parent directories `/var/backups/proofofwork-ui/rollback-roots` and `/var/backups/proofofwork-ui/releases`. Scope review found no exact candidate row or individually held descendant among the candidates; that is not a blanket absence of hold intersection. Approval must explicitly permit retirement of only these enumerated children while preserving the held parents and all individually held material. The generic hold still prevents ordinary pruning.

Prepare a new exact cleanup manifest/controller, rather than broadening audit 29's existing 26-path authorization. Freshly capture complete fingerprints under the deployment lock, verify the retained live release and immediate prior recovery root/archive, test refusal for changed identities or dependencies, compare immutable held inventories and retain intent/completion receipts. Delete only the explicitly approved candidates that satisfy every predicate. Record measured free-space recovery. New or changed candidates require further review rather than expanding deletion silently.

The existing [held-container policy](2026-09-29-audit28-held-review.json) requires "Exact content/provenance, recovery equivalence and live dependency checks; separately approved deletion manifest required." Both parent rows classify as `managed-ui-recovery-container`. This is the reason for exact child-retirement approval even though the children were created after the historical census.

The audited retained release pair is current 265 and prior 835. If a new release is published, refresh which verified recovery pair must survive before any cleanup; do not apply stale retain assumptions. Source inputs, transport evidence, node assets, PostgreSQL backups and historical records are outside the one-time 40-path deletion scope.

The existing capacity helper already enforces **10 GiB root reserve, 64 MiB growth margin and a 5 GiB scratch ceiling**, including upcoming allocations. Preserve and verify those guards. Do not add duplicate protections or lower limits. Fresh 18:57 UTC preparation finds **420,372,480 bytes** of scratch headroom. The current full private stage alone requires **452,653,056 bytes**, a **32,280,576-byte deficit before incoming payloads**. Deleting the 40 backup paths frees root capacity, **not scratch**.

The proposed additional scope is **preservation of three complete older source directories by atomic same-filesystem rename**, after the approved backup cleanup and fresh locked checks. No source directory contents are approved for deletion. Targets are under `/var/backups/proofofwork-ui/transport-evidence/audit30-preserved-sources/`, using the identical basename:

| Source under `/var/tmp/proofofwork-deploy/` | Allocated bytes | Preserved target basename |
| --- | ---: | --- |
| `proofofwork-ui-source-ed838d5c8691-20261001T210406Z` | 259,653,632 | `proofofwork-ui-source-ed838d5c8691-20261001T210406Z` |
| `proofofwork-ui-source-d2636f6fb3c5-20261002T023421Z` | 259,297,280 | `proofofwork-ui-source-d2636f6fb3c5-20261002T023421Z` |
| `proofofwork-ui-source-f81ae55bf4b0-20261002T031600Z` | 259,579,904 | `proofofwork-ui-source-f81ae55bf4b0-20261002T031600Z` |

All bytes, including Git metadata/objects, dependencies and ignored files, stay on the VPS. Before and after each rename, require complete hashes and metadata/inode verification, fresh live-reference and held-boundary checks, canonical same-filesystem paths, no existing target, current/prior source exclusion and durable intent/completion receipts. Check absolute symlink, worktree, alternate-object and inbound pointers; refuse invalid dependencies. Record expected pathname/root-ctime/parent metadata changes rather than claiming every metadata field is unchanged. Preserve inverse-rename recovery mapping. The destination evidence is excluded from ordinary cleanup and future release retention.

The three moves would reclassify **778,530,816 bytes** out of scratch, yielding **1,198,903,296 bytes** of scratch headroom. They recover **zero root disk bytes**. Fresh exact new-build transport/source/stage/archive admission must still pass every installed guard before publication; the new build budget is not yet known.

A full source/Git retirement-closure probe failed at the held-review loader's 300 KB read limit before returning closure results. Local original source TGZs were enumerated and hashed but survive only in `/tmp`; neither archive equality nor durable source-retirement equivalence is claimed. This failure is preserved in the preparation receipt. Whole-directory preservation avoids losing unique bytes; it does not qualify these sources for deletion.

Proposed future retention policy needs express approval: retain the live release and one fully verified immediate prior rollback root, plus their archives/sidecars. Limit retirement to ordinary release assets covered by that policy, record exact per-release manifests, require complete verification/dependency checks and preserve all historical holds, pins and masks. No unrestricted age-based deletion or automatic source/evidence/backup removal is proposed. Policy readiness and actual activation must be recorded separately; unresolved hold conflicts must not be reported as an active healthy policy.

Item 3 remains partial until the approved exact cleanup/preservation is verified and its approved retention/admission behavior is operationally established. Any removal or relocation beyond these 40 deletion paths and three preservation pairs must have a concrete reviewed scope and authorization before mutation.

## Remaining completion requirements

| Item | Required result before completion |
| --- | --- |
| 4 | Byte-preserving parser/UI tests and production verification; separately approved bounded projection rebuild, all affected lengths/hashes reconciled to immutable chain bytes |
| 5 | Measured isolated storage/replay prototype; exact numeric and historical replay equivalence; approved migration/rollback and production growth evidence; no historical truncation by age |
| 6 | Diagnose and correct slow paths; complete full ID semantics, positive-WORK acceptance and complete bond pagination; bounded before/after latency and consistency evidence |
| 7 | Isolated latest-backup restore with row/role/accounting reconciliation; qualified physical checks and a tested recovery/PITR path; retain last restore-proven backup until replacement is proved |
| 8 | Reconcile missing-artifact custody/retirement evidence; capture and repair approved runtime metadata issue then pass fresh attestation; exact safe node inventory retirement; independently reconcile treasury/refund/bounty obligations |

## Action record

- 2026-10-02: Created this tracker at the user's request. Read-only scope review identified the additional transfer-split fee caller and confirmed that capacity guards already exist. Independent review clarified that the 40 post-census cleanup candidates sit below two held parents even though they have no exact individually held candidate/descendant rows; this requires explicit narrow retirement authority, not a blanket hold exemption. No repair, cleanup, deployment, commit or push authorization has been received. Audit 30 source evidence remains unchanged.
- 2026-10-02: Fresh read-only scratch preparation confirms current staging refusal. Proposed three exact preservation relocations, reviewed independently, retain all source/Git/dependency bytes and create scratch headroom without claiming root recovery. Source retirement remains unverified. First-batch approval will need to include these exact moves and bounded future release-retention policy; no production operation has been performed.
- 2026-10-02: Preparation validation passes: proposal JSON contains 40 unique retirement paths and three exact preservation pairs; original audit 30 report/evidence plus all 75 prior and eight document bindings remain unchanged. Hygiene fix finds no allowlisted cleanup, hygiene check and diff whitespace check pass. Only requested tracking/preparation evidence and their inventory classifications were added; no repair or deployment has started.

- 2026-10-02, 19:18 UTC: Direct human approval received for batch 1–3 as scoped. Recorded hash-bound approval, created branch `codex/audit30-first-batch`, and began separate fee, retention monitor and exact storage-controller implementation. No item is complete yet.

- 2026-10-02, 19:35 UTC: Item 1 passes 1,113 independent rational vectors, nine decoded unsigned Computer/Boost/chained fixtures, wallet/Boost/UI regressions and TypeScript. Independent review also checked 32,163 accepted rates without conversion mismatches. Local integrated Credit previews show 404 proofs for 1,441 vB at 0.28 and safely show unavailable values for nine-decimal rates. Existing empty/nonpositive draft defaults are preserved. Item 2 UI installation completed with prior-byte receipts and unchanged Caddy/holds/masks, but two actual 20-second/10% CPU service runs timed out before JSON reporting; deadline correction is being prepared, not silently waived. Node installation refused before mutation because an installer preflight named a nonexistent WAL service; binding is being corrected to the actual five active authorities and preserved inactive WAL template/backup scheduler. Source tests found and fixed receipt-write and signal-interruption rollback paths. Item 3 controllers are undergoing dependency, refusal and independent review; no storage retirement or preservation move has run.

- 2026-10-02, 19:47 UTC: Item 2 actual UI/node service namespace verification passes with exact read-only host scratch and direct-report agreement. UI separately approved deadline is 60 seconds; node remains 20 seconds. UI recognizes only the two approved preserved archive relocations, reports 11 original missing paths, and node reports 12 original plus six qualified managed-path absences. Both remain accurately red. The UI canonical `1min` duration required a verifier-only correction; the original refusal and earlier timeout/installer refusal remain recorded. Exact storage scope and 26 real fixtures, 19 installer fixtures, 16 release fixtures, 11 retirement fixtures and six persistent-hold fixtures pass. [Separate execution evidence](2026-10-02-audit30-first-batch-execution.evidence.json) records actual receipts and independent reviews. No storage retirement/preservation or frontend publication has run yet.

Implementation references, production receipts, actual reclaimed bytes and completion dates will be added as the corresponding work is completed. No recurring task or background schedule was created.
