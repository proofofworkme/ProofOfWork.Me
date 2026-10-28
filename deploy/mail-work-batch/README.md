# Mail WORK batch deployment and activation

This controller installs the separately declared `pwt1:mailbatch1` capability before its authority publishes the declaration. It preserves the already active `pwt1:batch1` era, its configuration and its read/write availability. Mail batches support 1–256 recipients and one 546-proof registry payment per transaction. Ordinary recipient proof payments and miner fees remain separate.

This is source tooling, not a completed deployment or an activation authorization. Use the reviewed final source commit, fresh VPS captures and exact successful receipts. No command below signs a transaction, changes the native storage schema, replays canonical history, or enables the existing incident-repair path.

## Fixed runtime scope

Four existing files receive a reviewed three-way composition against base source `6e45b83948ad69da14ae0fede2cfc049ff64a62d`:

- `server/proof-api.mjs`
- `server/work-amo-v5-raw.mjs`
- `server/db/proof-index-reader.mjs`
- `scripts/backfill-proof-indexer.mjs`

Seven new files are creation-only and must be absent from both the baseline source and active accepted overlay inventory:

- `server/work-mail-batch-declaration.mjs`
- `server/work-mail-batch-runtime.mjs`
- `server/work-mail-batch-selection.mjs`
- `server/work-mail-batch-transaction.mjs`
- `server/db/work-mail-batch-reader.mjs`
- `server/db/work-mail-batch-discovery.mjs`
- `src/shared/protocol/workMailBatch.mjs`

Capture includes the complete runtime import closure, worker wrapper, metadata, inactive source helpers and every accepted overlay. The accepted overlay inventory is independently hash-pinned. Preserve the live runtime's intentionally older Git HEAD and accepted overlays; do not reset it or require its HEAD to equal the product release.

## Source installation order

All capture, composition, logs and operational receipts stay in a fresh root-owned private directory on NODE. Heavy UI/source artifacts are built on the VPS and transported as streams. Never copy full operational payloads to the operator's home or local `/tmp`.

On NODE, with the final clean committed checkout `SOURCE`, final commit `COMMIT`, fresh private directory `OPS` and exact `RID`:

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/mail-work-batch/release.py" capture "$OPS/capture.json"
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/mail-work-batch/release.py" plan "$SOURCE" "$COMMIT" 6e45b83948ad69da14ae0fede2cfc049ff64a62d "$OPS/capture.json" "$OPS/plan" --release-id "$RID"
```

If composition conflicts, stop and inspect each active/base/candidate triple. Supply `--reviewed-merges` only with the exact reviewed bytes and all three input hashes. Do not accept conflict markers or substitute repository files for accepted runtime overlays. Independently review the generated `plan.json`, source rows, dependencies, metadata, gateway configuration and probe pin before dispatch.

The single approved source apply is:

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/mail-work-batch/release.py" overlay "$OPS/plan/plan.json" "$OPS/dispatch.json"
```

Use a fresh bounded VPS service with CPUQuota=100%, MemoryMax=2G, MemorySwapMax=0, Nice=15 and idle I/O priority. Preserve durable stdout/stderr and an exclusive dispatch receipt. Each child retains its 1,200-second deadline and 600-second interruption grace. The bounded recovery path allows a successful Search hold (1,200 seconds), an interrupted controller with verified rollback (1,800 seconds), and Search restoration including its interruption grace (1,800 seconds): 4,800 seconds in total. The dispatcher waits 5,400 seconds, leaving 600 seconds for supervisor fences and overhead, then allows 900 seconds to preserve an interrupted outcome. Use an outer supervisor with RuntimeMaxSec=7200 and TimeoutStopSec=900, leaving 900 seconds beyond the dispatcher's 6,300-second envelope. These finite bounds do not guarantee completion. An interrupted controller with unverified recovery keeps Search held; a Search-only restoration timeout can leave applications restored with an uncertain outcome. No timeout authorizes a repeated apply. Inspect the retained inner receipt and Search hold before any recovery.

Before drain and again after the worker is quiescent, the hash-pinned candidate-root probe uses private inherited API credentials only in memory. It imports declaration/discovery/runtime modules, never the API entrypoint. PostgreSQL reads are read-only, with canonical search path and UTC. Complete discovery must cover the exact current first-party Core tip, no eligible declaration may exist, and no marker or established Mail context may exist. Core is checked again after discovery. Any unavailable evidence, confirmed eligible declaration or missing marker for an established era refuses before source writes. This intentionally stricter first-install contract requires publication only after successful installation.

The controller drains gateway sockets/services before API and worker. It checks source hashes, inode identities, parent identities, full dependencies, service configuration and the accepted overlay inventory. Existing sources move into root-private same-filesystem quarantine, then their exact moved identities are checked. Candidate publication uses no-replace rename and consumes its temporary name, so safe reads see one link. Foreign replacements and uncertain evidence remain preserved.

Before any source-write intent, a failure may restore the exact baseline services after all source/configuration fences pass. After source-write intent, recovery is forward-only: the controller keeps new read code, drained applications and the Search hold when verification fails. It never rolls back code that might recognize new chain authority. A separate reviewed recovery is required. Successful postflight requires Mail inactive/disabled, the original WORK batch capability still active/enabled/ready, unchanged configuration and exact owned source identities.

## Declaration and independent write activation

The declaration must be published only after source installation, release provenance and normal canonical indexing are verified. Minimum declaration height is 973283; read activation is D+1. The locked declaration text is 6,737 bytes (SHA-256 `a0575735de14a55ff29a30d4f6dbdd49f33914e950dfc3b912242f5767be6edf`), carrier 6,744 bytes (SHA-256 `8df01b4fbb1c4610923c7cf12ad43298b5c19e45a3853b75c42e7c0a46e77413`). Obtain it from the committed declaration builder. The human authority signs locally. Do not borrow the existing batch declaration or insert a marker manually.

Automatic read discovery uses `workMailBatchV1` and its own marker; workers receive no Mail environment pins. After confirmation, wait for the ordinary D+1 marker, current canonical transition, summary freshness and same-tip WORK admission. Publication of the declaration does not enable Mail writes.

`prepare-activation.py` consumes the exact **inner** successful source `manifest.json` and `receipt.json` under the dispatch result's `overlay.rollbackRoot`. Preserve the original raw JSON bytes. The outer dispatch receipt and `plan.json` are not these inputs.

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/mail-work-batch/prepare-activation.py" \
  --manifest "$INNER/manifest.json" --receipt "$INNER/receipt.json" \
  --source-commit "$COMMIT" --runtime-status-sha256 "$STATUS_SHA256" --node-path "$NODE_PATH"
```

`STATUS_SHA256` is SHA-256 of the exact stdout bytes of `/usr/bin/git -c safe.directory=/opt/proofofwork-api -C /opt/proofofwork-api status --porcelain=v1 --untracked-files=all`; use the observed Node executable. Retain the resulting approval in private VPS evidence and review its full closure and source hashes.

The activation controller accepts one bounded JSON request on stdin:

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/mail-work-batch/activation-controller.py" < "$OPS/request.json"
```

For each operation, capture first with `{mode:"capture", operation:"stage-disabled"|"enable"|"disable", approval, owned}`. Initial `owned` is null; subsequent operations use the exact prior successful owned-file descriptor. Apply with `{mode:"apply", approval, capture, captureSha256, receiptPath}`. `captureSha256` hashes Python's canonical sorted compact JSON of the capture, not a reformatted file. `receiptPath` must be an exclusive root-private VPS path. A changed source, PID, environment, gateway, unit or drop-in requires a fresh capture and review.

Stage-disabled derives all seven declaration pins and D+1 height from independently verified Core transaction/prevout evidence, earliest canonical discovery, the native marker and D+1/current transitions. It creates only the root:root 0644 file `/etc/systemd/system/proofofwork-api.service.d/zzzzz-work-mail-batch-writes.conf`, with the seven `WORK_MAIL_BATCH_DECLARATION_*` fields, `WORK_MAIL_BATCH_ACTIVATION_HEIGHT` and `WORK_MAIL_BATCH_WRITES_ENABLED=0`.

Enable changes only the switch to 1 after fresh evidence and exact-tip V8/API admission; `/api/v1/work-mail-batch-status` must then be active, enabled and ready at that tip. Any enable failure attempts to preserve the same pins with writes disabled and verifies effective environment before restoring the captured service state. Disable requires owned pins/source/configuration but intentionally does not require chain readiness. It never removes the marker, read code or existing `WORK_BATCH_*` configuration. File replacement uses the corrected C2 no-replace single-link publication pattern and retains foreign inodes on uncertainty.

## Archive, retention and final release gates

The generic runtime archive engine and whole-source verifier remain unchanged. Its historical fixed target scope cannot directly accept this eleven-file release. The narrow `runtime-archive.py` adapter accepts this successful receipt: four existing before hashes/modes must match the accepted inventory or exact baseline Git; all seven new files must be absent in both and match the publication journal's created inode, candidate SHA and metadata. Preserve every other accepted overlay and bind the full candidate inventory to the final source commit, plan, inner manifest/receipt, complete pre-declaration proofs and actual postflight. Require whole-source verification before acceptance, archive/live reconstruction equality and full release health before retiring the previous verified backup. Reuse canonical held-evidence, latest-only, inode and inventory fences. Do not fabricate success, custody, native replay or a future completion receipt. Lifecycle pins are fresh operational inputs, not source defaults.

`runtime-archive.py` is the narrow acceptance adapter. It validates the successful eleven-file receipt, rechecks current Mail dormancy and existing batch readiness, and overrides only `accept_source` in the exact canonical engine (SHA-256 `8ad039e14bf6b85f4c18bf0912676975111087ce90b300d0001e1629739663ae`). Its committed-source gate binds the final checkout commit/tree and the scoped controller. `runtime-archive.test.py` covers creation-only baseline/inventory absence, exact inode ownership, preserved overlays, source/configuration drift, incomplete proofs, verifier failures and held/prior archive gates.

The adapter exclusively retains byte-identical compact approval and plan copies in the new canonical `/data/proofofwork-release-backups/runtime-latest-*` custody directory before candidate verification. Accepted evidence refers to these retained copies and the existing inner receipts, never temporary operator paths. A retained `evidence-origins.json` binds each original path/hash to its copy; both originals and copies are reread before acceptance. The original operator evidence is preserved.

Prepare a separately reviewed, root-private approval JSON with **exactly** these fields:

```json
{
  "format": "mail-work-batch-runtime-archive-approval-v1",
  "sourceCommit": "FINAL_COMMIT",
  "sourceTree": "FINAL_TREE",
  "releaseId": "FINAL_RELEASE_ID",
  "plan": {"path": "ABSOLUTE_PLAN_PATH", "sha256": "ACTUAL_PLAN_SHA256"},
  "inner": {"path": "ACTUAL_INNER_ROOT", "manifestSha256": "ACTUAL_MANIFEST_SHA256", "receiptSha256": "ACTUAL_SUCCESS_RECEIPT_SHA256"},
  "acceptedSha256": "CAPTURED_UNCHANGED_ACCEPTED_INVENTORY_SHA256",
  "previousCompletion": {"path": "ACTUAL_PREVIOUS_COMPLETION", "sha256": "ACTUAL_COMPLETION_SHA256", "archiveSha256": "ACTUAL_PRIOR_ARCHIVE_SHA256"},
  "heldSha256": "c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9"
}
```

These placeholders are deliberately invalid. Bind actual successful inputs and fresh lifecycle evidence; never fill them from a failed attempt. After review, the bounded NODE invocation is:

```sh
sudo -n /usr/bin/python3 -I -B "$SOURCE/deploy/mail-work-batch/runtime-archive.py" \
  --approval "$OPS/archive-approval.json" --approval-sha256 "$APPROVAL_SHA256" \
  --create-and-retain-latest
```

Keep CPU/memory/swap/I/O limits and fresh durable VPS logs. Preserve the unchanged engine's bounded subprocess deadlines. Do not impose an outer forced timeout that can interrupt archive retirement: at a 900-second attention deadline inspect the unit and receipts without killing or retrying. Only the actual canonical completion proves archive verification, full release health, previous retirement and final retention protection; a process exit or source acceptance alone does not. Preserve all old batch/replay/recovery receipts. The current native schema and original/replacement transition evidence remain untouched.

Run fresh canonical UI capacity admission before every release. Do not count future cleanup, increase caps, normalize old evidence or delete expanded transports merely to make admission pass. Any separately approved superseded duplicate retirement must preserve exact VPS archive/member proof, current/prior roots, holds and compact history, and must complete before a new admission.

Final gates are runtime health and accepted provenance, canonical UI HTTPS/retention completion, exact source synchronization across GitHub `main`, primary local `main`, preview and production, and an actual successful `npm run check:release-sync`. Keep Mail writes disabled until these gates and the independent activation evidence pass. Announce only after production verification and synchronized final source.

## Validation and inherited guards

Run `npm run check:work-mail-batch` for protocol, reader, signing and publication-accounting regressions, including the versioned Mail summary model and the sole-self zero-movement case. Preserve the standalone checks with `npm run check:work-batch`.

Run `npm run check:work-mail-batch:deploy` for offline fixtures only. They exercise exact source scope, overlay composition, gateway drain, unknown outcomes/Search holds, source inode races, forward-only failure, unchanged v1 configuration, static ExecStart normalization, single-link activation replacement, failed enable recovery, complete-prefix discovery and activation parity. They do not create a production readiness claim. Ordinary protocol/frontend tests remain separate.

The new implementation reuses these exact reviewed source templates; existing files remain historical evidence:

| Template | SHA-256 |
| --- | --- |
| `deploy/work-batch-sends/scoped-node.py` | `1c38f74d145ed4ca3acc3ce375706e8158bbd3771eae126c8587a1b73250743e` |
| `deploy/work-batch-sends/capture-node.py` | `8dcd572fe28158cbc3ab4cea88b5fabd236e58c69ada51dc7cae47365e58a491` |
| `deploy/work-batch-sends/release.py` | `454e1ccd0f0776311f525acf5598a01663f52e90b5fae0cb7636ee6bb5905c3a` |
| `deploy/work-batch-sends/rollout-node.py` | `8425e0eb26e41ed169b7634769860bdce2e2ae564c52c5c1909768c196a76f30` |
| `deploy/work-batch-replay/scoped-node.py` (source publication pattern) | `857eaaf9850f3f949564b2d441dd39cff1ad49a65de13a9de0727b0f4c897b42` |
| `deploy/work-batch-activation/controller.py` | `50b518665708ad9913420c8ae028e22c0e4cfc2638b50d9cd4be1b7c0c5f219d` |
| `deploy/work-batch-activation/probe.mjs` | `c07514676e484c9c34fc2d3d7355f1ad14f017a81186a26d1328196a69c91b98` |
| `deploy/work-batch-activation/prepare-approval.py` | `39e333a9abd7766e4ef43640d23076d4e61e73b708814d25265d529a154aa34e` |
