# Permission deployment

Permission v1 adds a six-file node/API overlay and one managed UI surface. The
node has accepted Audit31, Code, Jobs, Pages and content-tip overlays. Preserve
their exact live bytes; never replace the complete checkout or reset its Git
state to the release commit. [PERMISSION.md](../../PERMISSION.md) defines the
approved admission boundary and authority model.

## Read-only custody and local plan

The complete write allowlist is:

- `server/proof-api.mjs` (existing)
- `server/db/proof-index-reader.mjs` (existing)
- `server/permissions.mjs` (new)
- `server/permission-discovery.mjs` (new)
- `server/db/permission-reader.mjs` (new)
- `src/shared/protocol/permissions.mjs` (new)

The controller changes no database schema/data, indexer or worker source,
runtime configuration, package/dependency files, Git state, retention policy,
authority-service state or systemd unit bytes. Discovery reads canonical index
witnesses and authenticated Core history through the API. Stock relational and
accepted native transition-storage accessors remain supported; no bootstrap or
migration is part of this release. Human grant management is separate from the
local controller's closed autonomous-signing gate. No wallet credentials or
wallet interaction belong to these deployment tools.

Run capture from this controller, then plan from the exact clean committed
shipping checkout. The pre-Permission repository base is
`506b1ab0833e7bedc7c5781563d2a3508c3b92c2`. The node's captured Git HEAD is an
independent binding and is preserved.

```sh
candidate_commit="$(git rev-parse HEAD)"
python3 -I -B deploy/permission/release.py capture /tmp/permission-runtime-capture-v1.json
python3 -I -B deploy/permission/release.py plan "$PWD" "$candidate_commit" \
  506b1ab0833e7bedc7c5781563d2a3508c3b92c2 \
  /tmp/permission-runtime-capture-v1.json /tmp/permission-runtime-plan
```

Capture is read-only on production and creates a private local custody file. It
captures permitted source bytes and metadata, dependencies, runtime Git/Node
identity, gateway/worker/Search unit hashes, and service states. It excludes
environment files, credentials, wallets and `node_modules`. All captured source
bytes are reread and fenced before returning. This capture uses
`proof-of-work-permission-runtime-capture-v1`; a historical Pages-format capture
cannot authorize a Permission plan. A capture from different controller bytes
also refuses.

Plan creates only a new private canonical `/tmp` directory. It verifies exact
committed controller and Search-holder bytes, merges the two existing files
with the captured live files using a three-way merge from the pinned repository
base, checks every resulting module's syntax, and rehearses the complete old
and candidate import-closure fence. All captured sources are pinned, including
inactive helpers. By default, each of the four new files must be absent from
capture and remain absent at rollout.

For a later narrowly approved repair, a fresh capture and plan may use
`--preserve-existing-helpers` with the previous released repository commit as
the three-way merge base. All four Permission helpers must already exist and
match the exact committed candidate bytes. Their captured `before` and
candidate `after` hashes are equal and are checked again at rollout. A missing
or changed helper refuses before the plan directory is created; this option
does not authorize helper upgrades or reviewed overrides. Without this flag,
first installation still requires all four helpers to be absent. The two
existing API/reader files retain their normal three-way merge and full runtime
dependency fences. The existing controller already supports hash-pinned
present helpers and retains their bytes and metadata through verified rollback.
Use the prior Permission source commit as the base for the HTML classification
repair; preserve accepted node overlays and the four current helper files.

A conflict refuses with its source inputs and conflicted output preserved.
After independently reviewing active, base, repository candidate and resolved
bytes, a fresh plan may use `--reviewed-merges /tmp/permission-reviewed-merges.json`:

```json
{
  "format": "proof-of-work-permission-reviewed-merges-v1",
  "sources": [{
    "path": "server/db/proof-index-reader.mjs",
    "activeSha256": "<64 lowercase hexadecimal characters>",
    "baseSha256": "<64 lowercase hexadecimal characters>",
    "repositoryCandidateSha256": "<64 lowercase hexadecimal characters>",
    "mergedPath": "/tmp/permission-reviewed-reader.mjs",
    "mergedSha256": "<64 lowercase hexadecimal characters>",
    "reason": "Explain the exact reviewed merge and preserved native accessor."
  }]
}
```

Only the two existing allowlisted files accept a reviewed resolution. Every
input and output is hash-bound; unsafe paths, symlinks, remaining conflict
markers and syntax errors refuse. Preserve the accepted native accessor in
the resolved reader instead of replacing it with a stock direct payload read.
Evidence paths are creation-only; use a fresh output after refusal.

## Explicit rollout and verified recovery

Inspect `review.json`, all merged modules and the hash-bound plan before the
explicit mutation phase:

```sh
python3 -I -B deploy/permission/release.py overlay \
  /tmp/permission-runtime-plan/plan.json /tmp/permission-overlay-receipt.json
```

The supervisor first fences source provenance, then holds the independent
Search job with the existing exact-byte-pinned
[`hold-node-timer.py`](../search/hold-node-timer.py). The node controller acquires
the existing operations lock, checks every source/dependency pin, verifies
authority availability, exact Node executable, gateway and protected worker
bindings, and captures original/candidate bytes and fsynced receipts under
`/data/proofofwork-release-backups/permission-RELEASE-TIMESTAMP`.

Drain order is gateway socket, gateway proxy, dependent indexer worker, then
API. The accepted worker is `PartOf=proofofwork-api.service
postgresql@16-main.service`; stopping API also stops the worker, but starting
API does not restart it. The controller verifies the captured worker PID/state
before drain, inactive/PID-zero state while drained, and immutable unit/source
bytes. Atomic replacement refuses concurrent source changes. Restoration starts
API, worker, then only previously active gateway units. Both application
services require active state, positive PIDs and their original runtime working
directory. Authority, Search, enablement, holds and unrelated source bytes must
remain unchanged.

A failed install restores the two original files; any installed new helpers
remain as recovery evidence. A rollback receipt is verified only after the
same service, worker-unit, authority, Search and hold checks pass. The supervisor
restores Search after success or verified rollback. An interrupted controller
is signaled and allowed to finish recovery. If rollback is incomplete, still
running, or lacks a verified receipt, Search remains held. An SSH timeout
produces an uncertain local dispatch receipt; inspect remote backup/hold
evidence before supervised recovery or retry. Never infer success from a
timeout, erase failed evidence, or clear a hold without verified installed
bytes and service state.

## UI and release completion

Use the complete managed-root `deploy/publish` release and guarded
[`install-ui.py`](../search/install-ui.py) helper/Caddy promotion. Permission
adds V5 with 22 managed roots; V3/V4 and older archives remain recovery history.
Preserve every existing product, prior root, source/archive attestation,
capacity guard, deployment lock and retention hold. Publish the complete UI
before enabling the Permission hostname through the guarded Caddy phase.
See [infrastructure](../../OP_RETURN_INFRASTRUCTURE.md) for those shared controls.

Production authority requires complete independent Permission discovery at the
exact verified Core checkpoint beginning at admission height 970492, with the
immutable parent hash pinned in the shared protocol. Incomplete history must
stay unavailable; single-record inspection cannot establish a current grant.
Verify Permission's standalone and Computer surfaces plus existing products,
and preserve runtime source-commit/hash receipts without resetting live overlays.

The release completes only when GitHub `main`, clean primary local `main`, its
rebuilt/restarted preview, and production UI have the same exact source commit
and tree. Preserve concurrent work before integration and follow the standing
synchronization workflow. The final check is mandatory before announcement:

```sh
npm run check:release-sync
```

## Offline controller checks

```sh
python3 -I -B deploy/permission/check-scoped-node.test.py
python3 -I -B deploy/permission/check-release.test.py
```

These use temporary files and mocked services/SSH. They verify the six writes,
four creation-only helpers or explicitly preserved byte-identical helpers,
actual Permission import pins, complete source
fences, source drift/path refusals, retained metadata, partial-install rollback,
socket/worker/API ordering, accepted worker coupling and verified restoration,
Search restoration/deferred recovery, explicit conflict review, cross-product
format refusal, controller identity, creation-only evidence and uncertain
dispatch receipts. They perform no production or wallet action.
