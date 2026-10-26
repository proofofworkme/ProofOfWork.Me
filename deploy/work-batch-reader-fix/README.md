# Canonical WORK reader incident release

This controller repairs the confirmed batch reader's comparison against accepted canonical payloads. Its only runtime write is the existing `server/db/proof-index-reader.mjs`. The approved source base is `6e45b83948ad69da14ae0fede2cfc049ff64a62d`; live runtime Git stays at its captured older baseline, with every accepted overlay preserved. There are no new runtime files, declaration changes, activation writes, database mutations, replay operations or cleanup steps.

The corrected publication, configuration, capture and supervisor helpers are adapted from the retained `deploy/mail-work-batch/` sources at commit `1c786d6d`. That commit is source provenance only: this incident does not install or activate Mail. The archive engine remains byte-identical to `deploy/monitoring-reconciliation/runtime_archive.py`, SHA-256 `8ad039e14bf6b85f4c18bf0912676975111087ce90b300d0001e1629739663ae`.

## Capture and reviewed plan

All operational sources, captures, merge rehearsals, logs and receipts stay on NODE in a fresh root-owned private VPS directory. Use a clean committed candidate checkout. Do not copy full runtime or release artifacts to the operator machine.

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-reader-fix/release.py" \
  capture "$OPS/capture.json"
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-reader-fix/release.py" \
  plan "$SOURCE" "$COMMIT" 6e45b83948ad69da14ae0fede2cfc049ff64a62d \
  "$OPS/capture.json" "$OPS/plan" --release-id "$RELEASE_ID"
```

Review the plan's exact one-file before/after bytes and three-way composition over the accepted runtime. A conflict requires a separately reviewed `--reviewed-merges` file, with exact active/base/candidate/result hashes. Never replace the active reader with repository bytes directly. The capture binds all accepted overlays, the full dependency/source inventory and metadata, source and parent inode identities, Node executable, Search controller, gateway files and effective service configuration. It never requires live Git HEAD to equal the released source commit.

The API must be active and its captured process identity remains exact. The worker may be active or in the observed failed/inactive/activating zero-PID restart loop. Its transient PID/state may change between capture and apply; its working directory, effective command, environment, unit files, dependencies and source hashes may not. Both apps and gateway must become inactive with zero service PIDs before any source write. Authority services must remain active and unchanged.

Existing `WORK_BATCH_*` configuration and every other service setting remain hash-bound; the controller does not reinterpret or edit them. It records the original active, write-enabled batch declaration identity and limits, while allowing its readiness flag to be false during this incident.

## Apply and readiness

After reviewing the exact plan hash and composed file, invoke the same committed controller in a fresh bounded unit with CPU 100%, memory 2 GiB, swap 0, Nice 15 and idle I/O. Retain durable VPS stdout/stderr. The outer allowance must cover the existing 1800-second dispatcher plus its 900-second recovery wait; do not kill or retry an uncertain outcome.

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-reader-fix/release.py" \
  overlay "$OPS/plan/plan.json" "$OPS/dispatch-receipt.json"
```

The supervisor holds Search, then the scoped controller drains gateway sockets/services, worker and API. It repeats all source/configuration fences. The original reader inode moves into root-private same-filesystem quarantine; its exact identity is checked after the move. The candidate is published by no-replace rename, consuming its temporary name so it has one link. Foreign or changed inodes are preserved and refused. The publication intent and ownership journal are durable before modification.

After restart, a bounded 600-second postflight requires `/health` to prove a healthy first-party node, canonical indexed checkpoint at that node tip, zero lag, and an eligible successful summary at the same height/hash. Each of the eight canonical summary coverage keys must equal that tip. Worker readiness and zero consecutive failures are required. The existing batch status must retain its exact authority/limits, be ready, and report the same tip. A second health read must match the first; chain movement retries within the deadline. Process activation alone never proves recovery.

Before source-write intent, a refusal may restore the captured running services; a previously failed/restarting worker is left quiescent, with that fact recorded. After source-write intent, recovery is forward-only: failures keep apps drained, retain Search's hold and the exact new reader/original evidence, and set `sourceRollbackProhibited` and `forwardRecoveryRequired`. Never retry, restore the broken reader or mark recovery successful from an exit code alone. Inspect the inner receipt and actual state first.

## Accepted source and latest verified archive

`runtime-archive.py` consumes the successful inner manifest/receipt and reviewed plan. It verifies the single before hash/mode against accepted inventory or baseline Git, the installed candidate inode/hash/metadata, all preserved dependencies/configuration, and fresh canonical postflight. It retains byte-identical compact approval/plan copies under the new canonical `/data/proofofwork-release-backups/runtime-latest-*` custody, with an origin-to-copy hash map; original temporary evidence remains preserved and refenced. Accepted overlay evidence uses retained custody paths only.

The approval format is `work-batch-reader-fix-runtime-archive-approval-v1`, with exactly these fields:

```json
{
  "format": "work-batch-reader-fix-runtime-archive-approval-v1",
  "sourceCommit": "ACTUAL_FINAL_COMMIT",
  "sourceTree": "ACTUAL_FINAL_TREE",
  "releaseId": "ACTUAL_RELEASE_ID",
  "plan": {"path": "ACTUAL_PLAN_PATH", "sha256": "ACTUAL_PLAN_SHA256"},
  "inner": {"path": "ACTUAL_INNER_DIRECTORY", "manifestSha256": "ACTUAL_MANIFEST_SHA256", "receiptSha256": "ACTUAL_RECEIPT_SHA256"},
  "acceptedSha256": "ACTUAL_CAPTURED_ACCEPTED_INVENTORY_SHA256",
  "previousCompletion": {"path": "ACTUAL_PRIOR_COMPLETION", "sha256": "ACTUAL_COMPLETION_SHA256", "archiveSha256": "ACTUAL_PRIOR_ARCHIVE_SHA256"},
  "heldSha256": "c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9"
}
```

Placeholders are invalid. Bind actual completed inner files, never the outer dispatch wrapper, and fresh lifecycle pins. After review:

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/work-batch-reader-fix/runtime-archive.py" \
  --approval "$OPS/archive-approval.json" --approval-sha256 "$APPROVAL_SHA256" \
  --create-and-retain-latest
```

The adapter overrides only source acceptance in the unchanged engine. Whole-source verification precedes acceptance; archive/live reconstruction and full release health precede prior archive retirement. Preserve held evidence, native transition archives, failed attempts and all unique historical receipts. Use bounded CPU/memory/I/O but no forced outer archive timeout; at a 900-second attention deadline inspect without killing or retrying. Only canonical completion proves the archive and retention lifecycle succeeded.

Complete the ordinary fresh UI release, HTTPS/retention verification and mandatory GitHub/main/preview/production source synchronization. An actual successful `npm run check:release-sync` is required before announcing completion. This incident controller authorizes no additional transport cleanup or capacity changes.

Offline tests: `check-scoped-node.test.py`, `check-release.test.py` and `runtime-archive.test.py` cover scope, degraded-worker handling, source/parent races, static configuration across restart, truthful summary readiness, forward-only failure, custody and archive refusal boundaries. They never run production services or SQL.
