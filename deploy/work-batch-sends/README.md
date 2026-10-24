# Dormant WORK batch send release

This controller installs the batch implementation and API status endpoint while activation remains absent. It never creates a declaration, changes environment/configuration, alters database state, signs, or broadcasts. Wallet-local declaration signing and the subsequent evidence-gated activation are outside this dormant controller.

## Fixed runtime scope

Four existing files are composed from captured active bytes, the approved repository base, and the candidate commit. A conflict requires an explicit reviewed merge bound to all three hashes; replacing an accepted runtime overlay with repository bytes is forbidden.

- `server/proof-api.mjs`
- `server/db/proof-index-reader.mjs`
- `server/work-amo-v5-raw.mjs`
- `scripts/backfill-proof-indexer.mjs`

Six helpers must be absent from the approved base, capture, and fresh runtime. Even identical preexisting bytes are refused.

- `server/work-batch-declaration.mjs`
- `server/work-batch-runtime.mjs`
- `server/work-batch-selection.mjs`
- `server/work-batch-transaction.mjs`
- `server/db/work-batch-reader.mjs`
- `src/shared/protocol/workBatch.mjs`

No package, dependency, service unit, worker wrapper, database, Git state, or other source file is writable through this controller. Its capture pins the API/indexer/Search import closures, the accepted worker wrapper and its imports, inactive source overlays, dependency metadata, actual Node executable, service units, and gateway state. New helper metadata comes from the captured, hash-pinned `publishArticle.mjs` template.

`BASE_SOURCE_COMMIT` is currently `c43cd395cf24701b080a2cf2a5c965d9c008a120`. Update and review it to match the final accepted pre-batch release if another release lands first. Never deploy against an obsolete base or while another release owns the runtime.

## Staging and review

Run every command on the node VPS as root with isolated Python. Full captures, plans, logs, build outputs, rollback evidence, and screenshots stay on the VPS. Return only compact receipts. Commands below contain placeholders and do not authorize deployment.

1. Wait for the concurrent release to finish. Fetch its final `main`, integrate the batch-only delta into a clean candidate checkout on the VPS, preserve accepted changes, and run mandatory hygiene and relevant tests. Commit the exact candidate before planning. Do not copy an old full checkout over the new release.
2. Run `npm run check:work-batch:deploy` in a bounded VPS unit. Both suites use temporary fixture files and mocked services; they never contact production.
3. Capture the now-current runtime and plan from the exact clean candidate:

   ```sh
   sudo -n python3 -I -B deploy/work-batch-sends/release.py capture /tmp/work-batch-runtime-capture.json
   sudo -n python3 -I -B deploy/work-batch-sends/release.py plan /tmp/clean-batch-candidate <candidate-commit> <approved-base-commit> /tmp/work-batch-runtime-capture.json /tmp/work-batch-release-plan
   ```

   Each output path must be new. Use the actual VPS checkout containing the committed controller. The plan records active/base/candidate hashes, composed runtime hashes, source commit, baseline runtime HEAD, dependency pins, and controller hashes. It rehearses old/new import closures and syntax-checks using the captured actual Node executable. Full plans contain source bytes and remain on the VPS.

4. Review `review.json`, `plan.json`, and the four composed files on the VPS. If a merge needs review, supply `--reviewed-merges` with format `proof-of-work-work-batch-sends-reviewed-merges-v1`. Each resolution binds `path`, `activeSha256`, `baseSha256`, `repositoryCandidateSha256`, `mergedPath`, `mergedSha256`, and a nonempty `reason`. Only the four existing paths permit resolutions. Re-plan into a new directory.

Capture and rollout preflight inspect API/worker process environments, declared systemd/manager environment, inheritance, and referenced environment files privately. They reject declaration/activation pins and `WORK_BATCH_WRITES_ENABLED=1`; values and secrets are not copied into plans or receipts. Ambiguous or multiline WORK_BATCH assignments fail closed. Only the digest of effective restart properties and referenced configuration files is retained; it is rechecked immediately before service restart. Do not clear configuration to bypass a refusal.

## Approved runtime application

After the exact plan is reviewed and deployment authorized, invoke the node-local overlay. Its full receipt stays on the VPS:

```sh
sudo -n python3 -I -B deploy/work-batch-sends/release.py overlay /tmp/work-batch-release-plan/plan.json /tmp/work-batch-release-receipt.json
```

Use the existing supervised release session with sufficient rollback time; do not kill the controller on an operator timeout. The pinned Search controller holds Search. The runtime controller acquires the operations lock, drains gateway socket then gateway service then worker/API, fences the baseline again, applies only the ten files, and restores the same service/gateway activation. Authority services remain running; worker wrapper and units remain exact.

The restarted configuration and local API status must be exactly dormant: `protocol=work-batch-v1`, `network=livenet`, `active=false`, `writeEnabled=false`, `ready=false`, no declaration/activation, reason `work-batch-declaration-unconfigured`, limits 2–256 recipients/65,536 payload bytes, and `registryFeeProofs=546`. Failed postflight triggers rollback.

Rollback restores the four original files and metadata. A helper is removed only when its journaled device/inode, metadata, timestamp, size, and exact candidate hash prove ownership. Publication uses no-replace linking. Removal first moves the target into a unique root-private no-replace quarantine under the verified root-owned /opt parent on the same filesystem and verifies the moved inode, so a last-moment foreign replacement is retained. Changed/unowned helpers, dependency drift, or uncertain recovery leave services drained and Search held, with VPS recovery evidence. Do not clear the hold or rerun a stale plan; inspect the receipt and obtain an exact reviewed recovery.

After runtime success, verify API/worker health, existing WORK readiness and pending-stage behavior, and canonical wallet summary/capacity parity against the pre-release baseline. Use the existing read-only `indexer:parity` workflow with its current bounded production options. Dormant code requires no historical replay or schema operation. Compare public batch status to the exact local result before exposing the UI.

## UI publication and synchronization

Build the same candidate on the node VPS with `deploy/publish/build.py` and the current v5/22-root workflow. Stream artifacts through `deploy/publish/transport_preserve.py --bundle-host node-vps`; use the VPS-only verifier and current retention lifecycle. No local build, runtime capture, archive, or restoration payload is permitted. No hostname or Caddy change is needed.

Publish the complete UI release after dormant API postflight passes. Verify Wallet and Computer show the unavailable batch action; preserve one-address sends and Mail’s ten-recipient limit. Record the overlay’s source commit and composed-file hashes with UI provenance.

Push the released candidate to GitHub `main`, fast-forward the clean primary checkout to it without overwriting concurrent work, and refresh the active preview from the same source through the approved VPS-built preview artifact workflow. Preserve accepted runtime overlays instead of resetting the live checkout. Verify affected local/public surfaces and run `npm run check:release-sync`. A failed/unavailable check leaves the release incomplete. Follow current VPS backup verification/retention; do not independently delete historical evidence or download a backup. Announce only after the complete release is verified.

## Separate activation handoff

Activation is outside this dormant controller. Follow [WORK Batch Sends V1](../../WORK_BATCH_SENDS.md#activation-and-release-handoff). Deploy and verify automatic read discovery before the authority publishes the exact released declaration; the fixed earliest eligible declaration block is 972965.

1. The authority wallet owner reviews the exact generated declaration, current byte counts and commitments, and prepared transaction, then signs and broadcasts locally. Existing Computer Mail can publish the exact memo; agents do not handle keys or sign for the owner. Canonical indexing continues while confirmation is pending. Do not hold global indexing for an uncertain confirmation interval.
2. Before preparing D+1, the indexer discovers the earliest exact Core-verified declaration from the complete sealed canonical prefix through D. Catch-up uses the committed H−1 prefix, independently of whether the global scan has reached Core's current tip. Canonical replay completes the finite prefix in bounded pages with event-loop yields within the same call, without depending on a cursor surviving process restarts. Public status may report bounded discovery in progress; missing evidence cannot be skipped. D+1 atomically establishes the existing activation marker. This read activation needs no configured pins, and no-pin operation always forces official writes off.
3. Independently verify the confirmed declaration's Core bytes, actual prevouts, canonical block D and exact transaction/output positions, the D+1 marker, matching declaration/evidence commitments at D+1 and the current tip, relational parity and existing WORK readiness. Install exact pins only in the API's dedicated activation drop-in, with writes disabled, through the separately reviewed activation controller. The canonical worker remains unpinned and uses automatic chain-based read discovery. This dormant controller never changes configuration.
4. Enable the independent batch write switch only after those checks pass. Verify the uncached public status and affected wallet/API behavior at the exact current Core tip before announcing activation.

Ordinary discovery does not require a confirmation-time maintenance hold. Unavailable Core evidence, incomplete sealed coverage, in-progress bounded discovery or a reorg can nevertheless pause replay and exact-tip readiness. Preserve closed readiness gates until verification and catch-up succeed. Later scoped configuration restarts require their own reviewed maintenance window and must preserve existing runtime overlays, units and private settings.

Malformed or conflicting explicit pins fail closed. With no pins, marker recovery and automatic read discovery never enable official writes, even if the write switch is set. The missing-marker sealed-history guard runs before discovery and cannot be bypassed by clearing configuration. Do not use the dormant controller to change activation configuration or bypass its refusal of configured pins.

If D+1 was already committed without batch context, stop the ordinary activation sequence. A restart or pin-only change cannot replace its immutable transition or create the first marker at a later block. Keep writes disabled and require a separately reviewed canonical replay procedure with exact checkpoint, transition and marker evidence. Never repair this by manually inserting a marker or silently replacing a canonical transition.

Before declaration publication and any eligible declaration, dormant rollback can restore the reviewed baseline. After activation, rollback disables writes while preserving batch-aware replay and the canonical marker; never restore pre-batch replay code. If publication occurred but confirmation is uncertain, resolve that evidence before considering code rollback.
