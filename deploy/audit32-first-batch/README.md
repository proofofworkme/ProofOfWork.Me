# Audit32 first-batch node release

This controller is derived from `deploy/permission/` and retains its guarded
Search hold, deployment lock, import-closure checks, gateway drain ordering,
durable receipts, atomic file replacement, and supervised rollback. Its runtime
write allowlist is exactly:

- `server/db/proof-index-reader.mjs`
- `server/db/postgres.mjs`
- `scripts/backfill-proof-indexer.mjs`

The worker change mirrors the two Code event kinds in the existing public Log
membership fingerprint. It preserves summary versioning at the same chain
height; it changes no economic, replay, or discovery rule.

There are no new node helpers, dependencies, schema changes, record repairs,
configuration changes, Git resets, archive deletions, or authority-service
restarts. The source base is fixed to
`c7935dde7239836f89be27c1ee29dfbc6a585e78`. The active node checkout may have an
older Git HEAD plus accepted runtime overlays; that captured HEAD is a separate
identity, preserved by the controller.

Run the local gates before production use:

```sh
node --test scripts/check-code-log-coverage.test.mjs scripts/check-postgres-pool-resilience.test.mjs
python3 -I -B deploy/audit32-first-batch/check-scoped-node.test.py
python3 -I -B deploy/audit32-first-batch/check-release.test.py
```

The pool test uses a temporary loopback wire fixture, never production
PostgreSQL. After committing the approved candidate, use a clean checkout at
that exact commit. Run capture and planning from the same committed controller
bytes, with new canonical private `/tmp` paths for every attempt:

```sh
python3 -I -B deploy/audit32-first-batch/release.py capture /tmp/FRESH-capture.json
python3 -I -B deploy/audit32-first-batch/release.py plan /ABS/CLEAN-CHECKOUT FULL_COMMIT \
  c7935dde7239836f89be27c1ee29dfbc6a585e78 /tmp/FRESH-capture.json /tmp/FRESH-plan
```

Capture is read-only. It retains source bytes and SHA256 values, including
accepted inactive helpers and worker dependencies, without reading environment
files or credentials. It pins the Node executable and API/worker unit files,
process identities, source ownership/modes, gateway activation, Search units,
and authority states. Planning performs a three-way merge of only the three
approved committed deltas over those captured bytes. Review `review.json` and
the actual merged files. Conflicts refuse automatic dispatch; an explicit
hash-bound reviewed merge is required. Do not replace the active reader with
the unmerged repository file.

Re-run focused regressions against the composed reader when reviewing its
native overlay. Record the source commit, base commit, capture hash, plan hash,
controller hashes, repository candidates, and actual merged runtime hashes.
Syntax and source fences alone do not prove live API acceptance.

Only after the reviewed plan passes, dispatch the approved release:

```sh
python3 -I -B deploy/audit32-first-batch/release.py overlay \
  /tmp/FRESH-plan/plan.json /tmp/FRESH-dispatch-receipt.json
```

The dispatcher holds Search with its existing pinned controller, then fences
all captured sources and both protected service baselines under the shared
operations lock. Socket activation drains before API shutdown. The dependent
indexer worker stops and starts with the API because its existing unit is
`PartOf` the API and imports the reader/pool. Only public Log fingerprint
membership changes; indexer economic and replay policy remains unchanged.
Core, Electrs, and PostgreSQL remain active with unchanged process identities.
All three source files retain exact uid/gid/mode through install and rollback. All
other captured sources remain hash-identical. The prior and candidate bytes,
manifest, and receipt remain under `/data/proofofwork-release-backups/`.

On success, verify fresh public health, exact Code transaction Log visibility
and its companion Mail, confirmed event positions/status, zero additive Code
economics, native storage readiness, API/worker recovery, and restored Search
state. Compare against the authoritative full node. Separately complete UI
publication and mandatory release synchronization; node overlay success alone
does not complete the release.

On failure, preserve all receipts and staged files. Proven rollback restores
exact prior bytes and metadata, then verifies every captured dependency before
restoring services and Search. Preserved dependency drift leaves applications
drained and the Search hold in place for supervised recovery; concurrent source
changes are never overwritten. Unproven rollback leaves the Search hold for
inspection. A dispatcher timeout means
state is uncertain; inspect remote receipt and hold evidence before retrying.
Never infer rollback from an SSH disconnect or issue a second unreviewed swap.
