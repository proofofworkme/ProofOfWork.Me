# Audit 30 approved UI storage controller

Authority is the immutable [human approval receipt](../../audits/2026-10-02-audit30-first-batch-approval.json), SHA256 `d99a40236b49b1735c794fb853c4f7f4f0724da8e3f83fab75c7464e0e8ee373`, bound to the frozen first-batch preparation SHA256 `f0027078971b7521fb2411e15bd8931b110a0f1815ea7e04bdaed3b5d4bdfdd0`. Local code/tests do not establish production completion.

`ui-storage.py` has fixed production paths and takes the existing exclusive deployment lock without creating it. `plan-cleanup` prints a new exact 40-path plan. Each candidate and the retained live/immediate-prior pair are fully fingerprinted, including 16 surfaces, directory/file types and modes, whole archive payloads, checksum/provenance sidecars, source/Git/dependency bytes, inode identities, owners, xattrs and metadata fences. Source dependencies must match the release's `node-modules-recursive-v1` attestation. Approved hardlink removals are counted by inode; unexplained count/ctime changes refuse. Unique non-release content refuses.

The canonical archive's private outer `surfaces` wrapper may be mode `0700` or `0755` and must have the executing owner's UID/GID. Every rendered surface and child directory must be `0755` and match its verified web-root inventory. The wrapper is required, remains outside that rendered inventory, and may never be linked, writable by others or owned by another account.

Every plan binds the installed capacity helper, controller version, immutable held review/hold bytes, both ordinary prune masks and the full held-path presence census. Both retained container ancestors require the explicit scoped approval; exact individually held candidates/descendants are rejected. Existing missing obligations remain reported. No absence is authorized, no generic hold is removed and no ordinary timer is unmasked.

`verify` and `apply` require `--plan PATH --plan-sha256 SHA --approval PATH --approval-sha256 SHA`. The SHA must be calculated from the exact returned plan bytes and reviewed before apply. Audit 29's old cleanup manifest/controller cannot authorize this operation. Apply first verifies the entire plan, then writes a durable exclusive-create intent, repeats protected-pair/guard/pointer proofs and each candidate's full fingerprint immediately before retirement, uses descriptor-relative removal, and records durable partial/failure/completion receipts. Filesystem/scratch endpoints distinguish measured recovery from hardlinked size estimates. No partial run is reported complete or silently resumed.

The exact original Audit30 cleanup stopped after 38 retirements when scheduled log rotation changed 196 held log inode identities. `plan-reconcile --reconciliation-review PATH --reconciliation-review-sha256 SHA --approval PATH --approval-sha256 SHA` may print one explicit continuation plan. Its immutable root-owned `audit30-cleanup-reconciliation-review-*.json` binds the original plan, intent, failed receipt and controller, the independently reviewed rotation evidence, both installed logrotate configuration hashes, the exact fresh guard census and every expected/actual delta. Production SHA pins admit only this recorded interruption, including the exact reviewed manifest `3d09b077148cf471c1b9581e091a676ad7d4b25e799ba50b11561247b7f1f04b`; a newly authored alternate baseline cannot qualify. Exactly 49 present paths in each of `auth.log`, `kern.log`, `syslog` and `ufw.log` may differ, only by inode; active-to-`.1` and `.gz` suffix shift chains are verified. All other held paths, prior missing paths, generic hold bytes and masks must remain identical. This is a specific evidence review, without a standing log exception.

The reconciliation manifest schema is `pow-audit30-cleanup-reconciliation-review-v1` with `host`, `scopeApprovalSha256`, `classification` (`configured-logrotate-inode-replacement`), `{path, sha256}` bindings named `originalPlan`, `originalIntent`, `failedReceipt`, `originalController`, full `afterGuards`, ordered `approvedDifference`, a one-entry `rotationEvidence` binding array, and ordered `rotationConfigFiles` bindings for rsyslog and ufw. Review and evidence JSON remain direct children of `cleanup-evidence`; the original controller remains in its immutable private package. The original 40-row plan and failed receipt are retained without rewriting them.

The new cleanup-kind plan retains all original 40 rows and protected snapshots. It proves the exact failed 38-record ordered prefix, each original snapshot hash and every retired prefix path's absence; reconstructs its authorized hardlink unlinks; then rechecks complete current/prior releases, archives, sources, the unchanged two remaining sidecars, all references/citation bindings and existing capacity rules. Every protected gate compares both retained archives and all sidecars to the frozen whole metadata/inode/xattr snapshots as well as payload hashes; reduced checks skip only retired candidate proofs. Apply initializes the 38 records before creating its new durable intent, and intent creation plus subsequent actions sit within the failure-receipt scope. It can retire only the final two paths. Completion's `holdsAndMasksUnchanged=true` refers to the new plan SHA and baseline; the original failed guard value remains false in its sealed receipt. Any later guard drift, prefix reappearance, altered remaining object, reference or proof fails closed. A further interruption requires separate reconciliation; absence never admits an automatic retry. Preservation prerequisites require all 40 ordered path/outcome/snapshot records and a successful completion guard fence.

After the 40 retirements complete, `plan-preservation` additionally requires `--cleanup-receipt PATH --cleanup-receipt-sha256 SHA`. It admits only the three approved complete source directories and the exact preserved target basenames under `/var/backups/proofofwork-ui/transport-evidence/audit30-preserved-sources/`. Source bytes are never retired. Git includes/core.worktree/fsmonitor, external filter/diff helpers, promisor dependencies, linked worktrees, alternate/graft/shallow pointers, assumed-clean/skip-worktree index flags, absolute/dangling/escaping symlinks, active/inbound/configuration pointers, occupied targets and cross-filesystem moves refuse. The configuration gate runs before Git status can execute a clean/process helper or fetch missing objects. All refs, reflogs, objects, ignored files and dependencies stay within the whole directory. Linux `renameat2(RENAME_NOREPLACE)` ensures atomic preservation without an overwrite fallback. Before/after fingerprints prove the same content, types, modes, owners, inodes, links and xattrs; only root pathname/ctime and parent metadata changes are expected. The preserved targets stay outside every retirement scope.

`plan-inverse --preservation-receipt PATH --preservation-receipt-sha256 SHA` prepares an exact inverse for completed or partial/failed source preservation. It re-verifies the current/prior recovery pair and only reverses source pairs actually moved. Restoring scratch admission must fit the unchanged 5 GiB limit. SIGTERM/SIGHUP/SIGINT during apply produce a failed progress receipt before exiting, including a signal arriving immediately after an actual rename. SIGKILL/power loss require reconciling the durable intent and actual source/target states before further reviewed work; automatic resume does not infer success from a missing pathname.

The pointer scan covers live process cwd/root/exe/FDs, command/memory/mount mappings, `/etc`, installed local scripts, cron storage, live web-root symlinks and protected source metadata. Every read is bounded to 1 MiB, with an explicit cumulative 1 GiB and 100,000-entry budget across all roots. Receipts report consumed bytes/entries and skipped large-file/payload-directory counts per root. One compiled escaped-literal bytes regex preserves the prior substring matching semantics while avoiding 40 repeated searches per file; every action still performs fresh scans. Textual files above 1 MiB and Git object/dependency payloads are excluded from textual pointer searches; the exact scan roots/bounds are reported rather than claiming universal absence. Those payloads are separately preserved and fully hashed; explicit Git pointer files/configuration are rejected. Limits/read errors and changing filesystem files refuse.

All unreviewed matches refuse. Cleanup and future-policy **planning only** may accept `--citation-review PATH --citation-review-sha256 SHA`; verification/application always use the plan's embedded binding. The optional root-owned immutable `audit30-citation-review-*.json` manifest must remain in `cleanup-evidence`, bind this human approval, operation kind, every ordered candidate path, both protected source HEAD/tree identities and separate hash-bound semantic-review evidence. It may enumerate only exact committed nonexecutable `OP_RETURN_INFRASTRUCTURE.md` or direct `audits/*.md`/`audits/*.json` files inside those protected sources. Each file binds byte count, complete SHA256, Git blob SHA1 and every literal candidate-path occurrence: target, byte offset, 1-based line, matching line SHA256 (including newline) and explicit `historical-release-evidence` classification. There is no automatic document exception.

The manifest schema is `pow-audit30-historical-citation-review-v1`, with `host`, `scopeApprovalSha256`, `operationKind`, `candidatePaths`, `protectedSources: [{path, head, tree}]`, `reviewEvidence: [{path, sha256}]`, and `files: [{sourcePath, relativePath, bytes, sha256, gitBlobSha1, citations: [{target, byteOffset, line, lineSha256, classification}]}]`. Source identities, committed blob/type, review/file bytes and every occurrence/context are rechecked before every action. Qualified citations appear separately in `qualifiedHistoricalMatches`, and the documents remain preserved. Process, configuration, installed operator, live web-root and symlink matches can never qualify. A symlink chain/process pointer into an admitted document or its source directory, or unqualified configuration/process text naming that document, refuses even when no retirement candidates remain. Only its directly scanned exact protected-source historical content qualifies. Additional occurrences, missing/changed evidence, edited documents, expanded paths or different postpublication source identities require a fresh reviewed manifest and otherwise refuse. Source preservation/inverse plans cannot accept citation exceptions.

Keep the installed 10 GiB available-root reserve, 64 MiB growth reserve, 5 GiB scratch ceiling and inode guards. The controller charges prospective durable evidence before writing it, and inverse moves charge their complete returned scratch allocation. Reclassification into backups frees no root disk bytes. The exact new UI transport/source/stage/archive model still has to pass after preservation before publication.

## Opt-in ordinary release policy

`ui-release-policy.py` adds a separate approved current-plus-one-fully-verified-prior lifecycle. Traditional pruning remains masked and held. It operates only through this exact opt-in controller after verified publication; nothing is discovered as disposable by age.

Before the fee publication, `admit-bootstrap` fully verifies and explicitly admits only current `26500e4d2ff7-20261002T054938Z`, prior `835e30258d23-20261002T052338Z`, the existing immediate-prior root, and those two archives/sidecars. This bootstrap allows the superseded prior to be retired after a subsequent verified publication. `--record` stores an immutable root-owned admission under `cleanup-evidence`; otherwise it prints a read-only admission proposal.

After each verified publication, `admit-release --index PATH --index-sha256 SHA` verifies the new current/prior pair and requires the previous release to be in the admitted chain. It admits only the new current archive/sidecars and the newly introduced rollback root. Historical releases before the human approval timestamp cannot be dynamically admitted. Source, input, transport, preserved source, database, backup and historical individually held evidence assets are always excluded.

The immutable versioned index has schema `pow-audit30-ui-admission-index-v1`, `scopeApprovalSha256`, an ordered `admissions` array of `{path, sha256}`, and a `completedRetirements` array of the same bindings. All receipt files must be in `cleanup-evidence`. Exactly one bootstrap is required, with complete per-release asset coverage and no duplicate admissions. Missing admitted objects require a valid completed exact future-retirement receipt; new gaps and reappearing retired objects refuse.

Policy `plan`, `verify`, and `apply` take the index path/SHA plus the same approval path/SHA. `verify`/`apply` additionally take the exact reviewed plan path/SHA. The controller re-derives eligible paths from admitted receipts, fully verifies the retained current/prior pair, rejects historical hold conflicts and changed admitted content, and applies the shared complete-proof/durable-receipt retirement path. Only the opt-in policy controller can apply a future plan. Record its completed receipt in the next index version; partial/failure receipts require reconciliation and cannot stand in for completion.

Future-retention plans use one exact byte contract: the policy producer writes
`S.encoded(plan)` directly, with sorted JSON keys, compact separators, and no trailing
newline. The SHA-256 of those stdout bytes must equal the embedded plan digest.
`verify` and `apply` reject a reformatted plan even when it decodes to the same
object. A completed retirement is admitted into later lifecycle indexes only when its
approved intent, receipt, and guard-baseline SHA all bind that same canonical plan;
the plan uses a reviewed controller version and a canonical current/prior archive name
derived from each bound release ID. The receipt must report
`phase=final-verification`, `guardBaseline=original-plan`,
`holdsAndMasksUnchanged=true`, explicit `errorClass=null`, no reconciliation, and the
frozen `missingHeldPaths` list. Its completed rows must match every planned path,
retirement outcome, and snapshot SHA in order, without omissions, duplicates, or
substitutions. Before emitting an eligible scope or invoking a writer, the producer
requires the latest admitted current/prior pair to match the actual fully verified
live pair; an outdated index refuses before mutation. The source admission index must
contain an exact prefix of the admitted release history and exactly the earlier
completed-retirement prefix. Its latest current/prior pair must match the plan, and
its admitted ordinary snapshots must derive the entire eligible set after excluding
that pair and earlier retirements. Root admissions preserve their release fields and
complete logical fingerprint; archive and sidecar admissions preserve their exact
snapshots. These checks are nonrecursive and fail closed; a partial, failed,
contradictory, or unfenced history requires manual reconciliation. No production
future-retention plan or retirement ran before this reader correction. Previously
sealed bootstrap admissions remain unchanged. This private operational correction is
independent of frontend release `11b9daf067d74b2b507f740126204583412d3db0` and does
not rewrite that release's sealed source or evidence.

Production readiness requires installation with root ownership and safe file modes, production plan review, one-time retirement/preservation evidence, a recorded bootstrap and subsequent per-publication admission/retirement calls. Merely having these source files or passing local tests is not an active policy or a completed item 3.

The 2026-10-02 production cycle is verified: original cleanup 40/40, whole-source
preservation 3/3, and subsequent ordinary retention 4/4. Index v3 at
`/var/backups/proofofwork-ui/cleanup-evidence/audit30-policy-admission-index-v3.json`
has SHA-256 `d61edd55d02c92234983c09c448d8d31d7a0782df769f0f8c599d32e5e7f24c7`.
Its fresh zero-eligible plan has SHA-256
`b23ffdcf1cd95ba92e7370c01be48500776fb4fab47634ebfdb0444f366edce5`.
Current `11b9daf067d7-20261002T211925Z` and verified prior
`26500e4d2ff7-20261002T054938Z` remain protected. The completed ordinary receipt,
approved intent, exact plan and immutable index are durable in `cleanup-evidence`;
the [execution record](../../audits/2026-10-02-audit30-first-batch-execution.evidence.json)
binds their full paths and hashes. Future releases must run fresh admissions,
reviews and lifecycle calls, preserve the existing masks/holds, and pass the
unchanged root/scratch/inode limits. Excluded source/evidence growth remains a
separate capacity concern; this policy does not make it disposable by age.

Run local fixtures with `python3 -I -B deploy/audit30/check-ui-storage.test.py`. Fixtures use temporary directories and real archives, hardlinks, Git index/configuration, xattrs, atomic renames and actual child-process SIGTERM; no production call, signature or broadcast is involved.

## Bounded operator

`storage-operator.py prepare` creates a deterministic local package bound to
the independently reviewed controller/policy/approval hashes. `upload` creates
a private root-owned package under `cleanup-evidence` after existing capacity
checks and the deployment lock. `start --operation plan-cleanup` returns a
bounded managed-unit name and evidence prefix immediately; `status --unit UNIT
--prefix PREFIX` reports completion, and `fetch --remote-path PATH --sha256 SHA
--output /tmp/FRESH.json` preserves exact remote output for review. Plans are
exclusive-create, fsynced and bounded to 64 MiB; failure stderr stays separate.
The SSH launcher fixes both identity and host-key checking. Planning and
verification use a 30-minute maximum, application uses 90 minutes; CPU is capped
at 50%, memory at 2 GiB with no swap, and I/O is idle priority. A deadline is a
maximum, not an ETA.

After reviewing the concrete plan, `start --operation verify` or `apply` requires
`--plan REMOTE_PATH --plan-sha256 SHA`. Preservation planning requires the exact
completed cleanup receipt. Operations are serialized by the existing controller
lock; do not overlap them with publication. Before publication, record the
bootstrap; afterwards record release admission, a new immutable index, the
reviewed policy plan, verified/application result, and the next immutable index
with its completed retirement receipt. These are explicit per-publication
operations; standing masked timers are not a substitute.
