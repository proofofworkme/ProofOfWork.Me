# Pending WORK batch summary recovery

This finite incident controller changes only the existing `server/proof-api.mjs`. It repairs pending recipient identity and excludes explicitly pending transfer families at the canonical token-table boundary. It installs no Mail helpers, imports, declaration, activation configuration or database changes. Historical release controllers remain unchanged.

The accepted before source is V6 (`3a3d1416659d9332dc0ed71d7abe69543394182f`), API SHA-256 `40b0b29f1908cedca617d77712f8d8c68ec8a9b00eff41855d92d52ed3d0d5cf`, and accepted inventory `a12c90cbc46acf48bf9363c28e5e2786061c3d1b86955f42dfc234ff7d04a3e1`. The only permitted candidate is `e2e7bcb416844f24ab2a9c7c3d30b995abffe3946a0c4918435f7dbe2cf8e328`.

The patch provenance is public commit `d3b09c98f1f6a875a91c2b086a6b676d3f2fb81d` against its exact parent `e97f1d1beb0162998ceeb20bd4497fa52a36c694`. Planning proves that public API delta changes only `tokenTransferHistoryItemKey` and `currentProofIndexTokenTablePayloadForLedger`. Their complete before/after function hashes are fixed. Applying the exact changes to captured V6 bytes must produce the fixed candidate; reversing them must reproduce every original V6 byte. There is no general merge override. The final committed tooling source supplies release commit/tree provenance; the composed runtime is explicitly recorded as an accepted overlay, not represented as the full Mail repository API.

The publication, drain, Search-hold and custody implementation derives from the retained `deploy/work-batch-reader-fix/` family. The already reviewed recovery deadline policy supplies the longer postflight and nested supervisor bounds. The archive engine remains byte-identical to `deploy/monitoring-reconciliation/runtime_archive.py`, SHA-256 `8ad039e14bf6b85f4c18bf0912676975111087ce90b300d0001e1629739663ae`. The rehearsal helper hash-loads the retained committed read-only summary sandbox and adapts the API tail; its actual installed reader and worker remain read-only dependencies.

## Preparation and mandatory rehearsal

All operational source, captures, candidates, logs and receipts stay in a fresh root-owned private directory on NODE. Use a clean committed full-history checkout. Do not copy full runtime, custody or archives to the operator machine. All held source/configuration reads use `O_NOATIME`.

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-pending-summary-fix/release.py" \
  capture "$OPS/capture.json"
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-pending-summary-fix/release.py" \
  plan "$SOURCE" "$COMMIT" 3a3d1416659d9332dc0ed71d7abe69543394182f \
  "$OPS/capture.json" "$OPS/plan" --release-id "$RELEASE_ID"
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-pending-summary-fix/rehearsal.py" \
  "$OPS/plan/plan.json" "$PLAN_SHA256" "$OPS/rehearsal" --capture "$OPS/capture.json"
# Only after the actual native rehearsal unit has terminated successfully:
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-pending-summary-fix/rehearsal.py" \
  "$OPS/plan/plan.json" "$PLAN_SHA256" "$OPS/rehearsal" --capture "$OPS/capture.json" --verify
```

Capture requires the fixed accepted V6 API/inventory and original active/write-enabled batch authority (2–256 recipients, 546 registry proofs). The API must retain its exact captured PID and configuration. The worker may cycle through its observed restart loop; its source, executable, working directory, unit and environment remain pinned. This exception does not declare it healthy. All preserved source/dependency bytes and metadata, source/parent inode identities, authority services and gateway/Search configuration are fenced.

The isolated rehearsal publishes nothing and starts no listener or worker. It performs two actual summary generations at one canonical checkpoint, using the installed V6 worker's publication-accounting predicate and all eight summary keys. It verifies the original 12- and 7-recipient confirmed families, once-only registry/miner economics, and zero economic children. The incident 189-recipient pending family must retain 189 unique history identities while canonical summaries contain zero pending transfers/parents; natural confirmation requires a complete confirmed family proof, and eviction is reported honestly as absent. No pending observation is fabricated. Source/configuration/authority fences and native sandbox, ordered environment-file, exact adapter and successful terminal proofs are required for qualification.

## Reviewed one-shot application

The exact reviewed plan and fresh qualification must be approved before dispatch. Run the outer release command in a fresh bounded native unit: Type=exec, RemainAfterExit=yes, CPUQuota=100%, MemoryMax=2G, MemorySwapMax=0, Nice=15, idle I/O, RuntimeMaxSec=10800 and TimeoutStopSec=900. Preserve private stdout/stderr and the actual invocation ID.

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-pending-summary-fix/release.py" \
  overlay "$OPS/plan/plan.json" "$OPS/dispatch-receipt.json" \
  --rehearsal "$OPS/rehearsal/qualification.json" --rehearsal-sha256 "$QUALIFICATION_SHA256"
```

Qualification is checked before parent dispatch, before the Search hold and again before source-write intent. The supervisor creates the normal Search hold. The scoped controller drains gateway, worker and API to zero PIDs and repeats all source/configuration/authority/inode gates. It moves the original API inode to private same-filesystem quarantine, preserves its exact identity and publishes the new candidate by no-replace rename. No other runtime path is writable under this controller's scope.

Postflight allows 3600 seconds for actual healthy exact-tip scan and summary readiness. All eight coverage keys, summary height/hash and batch status must match the node tip, worker failures must be zero and two health reads must agree. The scoped child has 4800 seconds plus 600 seconds recovery grace; Search control has 1200 seconds; the parent has 9000 seconds plus 900 seconds recovery grace, inside the stated outer budget. The longest verified prewrite rollback followed by restoration timeout is 8400 seconds; the parent retains 600 seconds of overhead before its own recovery grace. An uncertain controller retains Search and evidence; never infer success from a process start or kill/retry it to obtain a clean status.

Before source intent, a verified refusal can restore the captured API and leave an originally degraded worker quiescent. After source intent, failures remain forward-only: preserve the new API, original inode and receipts, keep applications drained and Search held, and record `sourceRollbackProhibited`/`forwardRecoveryRequired`. Do not invent a failed predecessor or restore the known broken API.

## Accepted runtime and latest verified archive

Only actual successful inner and outer receipts, verified Search restoration, the exact qualified rehearsal and fresh same-tip postflight can enter acceptance. The new `runtime-archive.py` adapter accepts only the fixed API row against the captured V6 inventory, preserves every other accepted overlay and records source commit/tree plus exact patch provenance. It retains compact approval, plan, dispatch, qualification and all nine physical rehearsal evidence files under canonical `/data/proofofwork-release-backups` custody; temporary originals remain refenced. It validates actual installed inode/hash/metadata and whole-source closure before publishing the new inventory.

Bind the adapter's exact approval schema to real successful evidence and the current V6 completion/archive/held-review hashes. Run its unchanged canonical archive engine with bounded CPU/memory/I/O and no forced archive deadline; inspect at a 900-second attention threshold without killing or retrying. Only actual canonical completion proves latest-only retention. This controller authorizes no additional cleanup or capacity changes.

Once API recovery and archive acceptance are verified, recapture the normal Mail deployment against the new healthy accepted baseline. Do not reuse its earlier refused capture or weaken its healthy-runtime gate. Complete the final source/UI/preview synchronization and `npm run check:release-sync` before a release announcement.

Offline checks: `check-scoped-node.test.py`, `check-release.test.py`, `rehearsal.test.py` and `runtime-archive.test.py`. They cover exact source derivation, unrelated-change refusal, degraded-worker boundaries, inode races, actual accounting qualification, evidence custody, uncertainty and deadlines without contacting production.
