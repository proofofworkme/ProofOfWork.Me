# Audit 30 approved UI storage controller

Authority is the immutable [human approval receipt](../../audits/2026-10-02-audit30-first-batch-approval.json), SHA256 `d99a40236b49b1735c794fb853c4f7f4f0724da8e3f83fab75c7464e0e8ee373`, bound to the frozen first-batch preparation SHA256 `f0027078971b7521fb2411e15bd8931b110a0f1815ea7e04bdaed3b5d4bdfdd0`. Local code/tests do not establish production completion.

`ui-storage.py` has fixed production paths and takes the existing exclusive deployment lock without creating it. `plan-cleanup` prints a new exact 40-path plan. Each candidate and the retained live/immediate-prior pair are fully fingerprinted, including 16 surfaces, directory/file types and modes, whole archive payloads, checksum/provenance sidecars, source/Git/dependency bytes, inode identities, owners, xattrs and metadata fences. Source dependencies must match the release's `node-modules-recursive-v1` attestation. Approved hardlink removals are counted by inode; unexplained count/ctime changes refuse. Unique non-release content refuses.

The canonical archive's private outer `surfaces` wrapper may be mode `0700` or `0755` and must have the executing owner's UID/GID. Every rendered surface and child directory must be `0755` and match its verified web-root inventory. The wrapper is required, remains outside that rendered inventory, and may never be linked, writable by others or owned by another account.

Every plan binds the installed capacity helper, controller version, immutable held review/hold bytes, both ordinary prune masks and the full held-path presence census. Both retained container ancestors require the explicit scoped approval; exact individually held candidates/descendants are rejected. Existing missing obligations remain reported. No absence is authorized, no generic hold is removed and no ordinary timer is unmasked.

`verify` and `apply` require `--plan PATH --plan-sha256 SHA --approval PATH --approval-sha256 SHA`. The SHA must be calculated from the exact returned plan bytes and reviewed before apply. Audit 29's old cleanup manifest/controller cannot authorize this operation. Apply first verifies the entire plan, then writes a durable exclusive-create intent, repeats protected-pair/guard/pointer proofs and each candidate's full fingerprint immediately before retirement, uses descriptor-relative removal, and records durable partial/failure/completion receipts. Filesystem/scratch endpoints distinguish measured recovery from hardlinked size estimates. No partial run is reported complete or silently resumed.

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

Production readiness requires installation with root ownership and safe file modes, production plan review, one-time retirement/preservation evidence, a recorded bootstrap and subsequent per-publication admission/retirement calls. Merely having these source files or passing local tests is not an active policy or a completed item 3.

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
