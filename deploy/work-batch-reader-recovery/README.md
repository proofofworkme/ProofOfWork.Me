# Forward recovery of the canonical WORK summaries

This controller completes the failed `work-batch-reader-fix` incident. It changes
only the existing `server/db/proof-index-reader.mjs` and `server/proof-api.mjs`.
The reader starts from the exact installed predecessor candidate and preserves
the reviewed child fee projection correction. The API retains the reviewed
growth-accounting correction and can receive the summary-transport isolation
follow-up. Both resulting hashes are bound to the committed
composition plan and successful full-summary rehearsal. It performs no SQL,
replay, reseal, declaration, activation-config, Git, authority-service, or cleanup
operation.

The predecessor must have finished naturally. Its successful source installation
and failed postflight remain recorded as a failure. Recovery requires the exact
reviewed plan, inner manifest, terminal failed receipt, outer failed dispatch, and
terminal systemd unit. The original Search hold is reused. A running predecessor,
restored hold, changed authority process, foreign inode, changed dependency or
configuration refuses before source publication.

## Evidence and plan

All full source captures, plans, logs and receipts stay root-private on NODE.
Use the final clean committed checkout and a fresh private `/tmp` operations
directory. Preserve the preceding incident directory and its quarantined inode.
No production action follows merely from a successful capture or plan.

Create a reviewed `predecessor.json` containing exactly:

```json
{
  "format": "work-batch-reader-recovery-predecessor-v1",
  "plan": {"path": "/absolute/original/plan.json", "sha256": "EXACT_SHA256"},
  "manifest": {"path": "/data/proofofwork-release-backups/original/manifest.json", "sha256": "EXACT_SHA256"},
  "receipt": {"path": "/data/proofofwork-release-backups/original/receipt.json", "sha256": "EXACT_SHA256"},
  "dispatch": {"path": "/absolute/original/dispatch-receipt.json", "sha256": "EXACT_SHA256"},
  "unit": "pow-work-batch-reader-fix-ORIGINAL_COMMIT12.service"
}
```

The placeholders are invalid until actual immutable terminal evidence is supplied.
The expected predecessor controller is pinned to
`f17799cea310a3d0a97c936a6608c7b4447e7d41da076bcdb0c950050c967dc1`.
It must report installed, source-writes-started, forward-recovery-required,
source-rollback-prohibited and recovery-incomplete; rolled-back must be false.
The accepted source inventory must still be the original captured inventory.

The summary-transport follow-up may instead use
`work-batch-reader-recovery-predecessor-v2`, with the same six fields. This form
admits only recovery commit `7b9242a24ee15bc28194d97270bf1dea2e9b6f31`, release
`7b9242a24ee1-20261028T101200Z`, and its frozen controller hash
`6284e5a121db3b90b42f8aff6225b33194aefba91063b8e3c46a57b9c9be0070`.
It requires that attempt's actual terminal failed receipt and dispatch, including
its successful unpublished rehearsal, before capture or apply. A running attempt
cannot be used as a predecessor. Its frozen verifier also verifies the original
one-file failure; this is a fixed two-attempt chain, not recursive trust in an
operator-supplied controller.

Both installed files and their retained before-inodes must match the second
attempt. The reader can retain its corrected bytes while the API receives the
reviewed Electrum isolation change. Original authority processes, accepted source
inventory, configuration and the first attempt's Search hold remain bound.
Search restoration uses that original hold's release identity.

With `SRC`, `OPS`, `COMMIT`, and `RELEASE_ID` set to reviewed absolute VPS paths and
the final source identity, run these preparation commands in order:

```sh
/usr/bin/python3 -I -B "$SRC/deploy/work-batch-reader-recovery/release.py" capture \
  "$OPS/predecessor.json" "$OPS/capture.json"
/usr/bin/python3 -I -B "$SRC/deploy/work-batch-reader-recovery/release.py" plan \
  "$SRC" "$COMMIT" 6e45b83948ad69da14ae0fede2cfc049ff64a62d \
  "$OPS/capture.json" "$OPS/plan" --release-id "$RELEASE_ID"
```

The plan composes from the original accepted source commit while preserving the
actual installed overlays. A conflict requires a separately reviewed
`--reviewed-merges` file with exact captured/base/candidate/result hashes. Review
both source rows, the full dependency/metadata closure, Node, effective unit and
environment digests, original service-restoration intent, predecessor evidence,
and exact import closure. No source path may be added.

Before apply, run the separately reviewed committed read-only summary rehearsal
against those exact composed API and reader bytes. Its source/plan/predecessor
pins must match this plan, and its checkpoint must include incident block 973284.
The ordinary API entrypoint must
not be started as a rehearsal: it starts listeners and background work.
The committed `rehearsal.py` first dispatches the isolated candidate, then its
`--verify` mode checks the actual successful terminal unit and emits a
`work-batch-summary-rehearsal-qualified-v1` qualification. Overlay requires that
qualification's exact path/hash, plan, two source hashes, predecessor and all
eight unpublished canonical summaries; an exploratory result is insufficient.
Each inherited required `EnvironmentFile` is passed separately, in its original
order. Preserve any startup-refusal evidence and use a fresh release identity
for the corrected rehearsal; do not replace or retry the failed unit.

```sh
/usr/bin/python3 -I -B "$SRC/deploy/work-batch-reader-recovery/rehearsal.py" \
  "$OPS/plan/plan.json" "$PLAN_SHA256" "$OPS/rehearsal"
# After the bounded rehearsal unit exits successfully:
/usr/bin/python3 -I -B "$SRC/deploy/work-batch-reader-recovery/rehearsal.py" \
  "$OPS/plan/plan.json" "$PLAN_SHA256" "$OPS/rehearsal" --verify
```

## Apply and recovery

Only after source, composition, rehearsal, and operator review, run once on NODE:

```sh
/usr/bin/python3 -I -B "$SRC/deploy/work-batch-reader-recovery/release.py" overlay \
  "$OPS/plan/plan.json" "$OPS/dispatch-receipt.json" \
  --rehearsal "$OPS/rehearsal/qualification.json" --rehearsal-sha256 "$REHEARSAL_SHA256"
```

Use a fresh systemd unit with CPUQuota=100%, MemoryMax=2G, MemorySwapMax=0,
Nice=15 and idle I/O. Use a 9000-second outer runtime plus 900-second termination
grace. Preserve stdout/stderr on the VPS.
Observe the one attempt; never signal, rerun, or replace it to force progress.

The fixed deadline nesting accommodates the observed 244-block backlog after
the October 28 interruption without changing worker configuration. Exact-tip
postflight allows 3600 seconds; its scoped process allows 4800 seconds, reserving
1200 seconds for source fences, syntax checks, drain and restoration around that
gate. The existing Search restore helper keeps its 1200-second limit and
600-second interruption grace. Normal supervisor child work can take 6000 seconds
(4800 + 1200); a Search timeout can instead take 6600 seconds including its grace.
An interrupted scoped process has 5400 seconds (4800 + 600 grace) and does not
restore Search. The release parent allows 7200 seconds, leaving 600 seconds over
the longest child path, then 900 seconds of interruption grace; 8100 seconds
remains inside the 9000-second outer runtime. These are finite accommodations,
not a catch-up guarantee. Postflight failure still drains the apps and requires
explicit forward recovery. A parent or Search-helper timeout retains uncertain
evidence; it does not by itself prove whether services remain restored. Advancing
checkpoints alone never qualify completion.

The controller takes the existing operations lock, verifies that apps and gateway
are drained, and preserves authority processes and the inherited Search hold.
No-replace same-filesystem publication verifies source/parent inodes and retains
both earlier and new quarantines. Any failure leaves the apps drained and Search
held for explicit forward recovery. Even a pre-write refusal cannot restore the
known-broken predecessor API. Original failure receipts are never overwritten.

After restoring the original API/worker/gateway activation, the 3600-second
health gate retains the requirements for a common Core/index/batch tip and hash, all eight
canonical summary coverage keys, healthy worker, exact original declaration and
write-enabled authority, and a stable second health read. Only then does the
supervisor restore the original Search timer using the original hold identity.
Require successful inner and outer receipts; exit status or active PIDs alone do
not establish completion.

## Source acceptance and latest verified archive

`runtime-archive.py` consumes the successful recovery plan/inner receipts and the
successful outer dispatch. Its exact approval has the same lifecycle fields as
the reader-fix adapter, plus `dispatch: {path, sha256}`, and format
`work-batch-reader-recovery-runtime-archive-approval-v1`. Supply actual final
source commit/tree/releaseId, plan reference, inner path/manifest/receipt hashes,
acceptedSha256, previousCompletion path/hash/archiveSha256, and heldSha256.
The dispatch binds the mandatory rehearsal qualification. Archive acceptance
rechecks it against the exact plan and retains a hash-identical custody copy.

For the reader, acceptance proves the chain from accepted C2 bytes through each
admitted failed installation to the reviewed recovery reader. With a v2
predecessor, it similarly walks the API's two installed generations back to its
original accepted before hash. Both failed attempts' evidence and the earlier
rehearsal remain retained. The adapter does not pretend that a failed
installation was already accepted. It preserves all unrelated
overlays and retains hash-identical copies of any compact evidence outside
`/data/proofofwork-release-backups` in the new archive custody, with origin maps.

After separate review of those actual lifecycle pins:

```sh
/usr/bin/python3 -I -B "$SRC/deploy/work-batch-reader-recovery/runtime-archive.py" \
  --approval "$OPS/archive-approval.json" --approval-sha256 "$APPROVAL_SHA256" \
  --create-and-retain-latest
```

The canonical archive engine remains byte-identical at
`8ad039e14bf6b85f4c18bf0912676975111087ce90b300d0001e1629739663ae`.
It retains whole-source verification, held-evidence protection, archive/live
equality, full release health before retirement, and latest-only identity fences.
Keep CPU/memory/I/O limits, but use a non-cancelling attention deadline for the
archive step; do not interrupt a possible retirement. Inspect its actual
completion receipt before claiming success. UI publication, GitHub/main/preview
synchronization and `check:release-sync` remain separate mandatory release gates.

Offline tests: `python3 -I -B deploy/work-batch-reader-recovery/check-recovery.test.py`
and `python3 -I -B deploy/work-batch-reader-recovery/runtime-archive.test.py`.
They use disposable local fixtures and mocked services; they never run a live
controller, archive, database mutation, or retention operation.
