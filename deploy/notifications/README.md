# Computer notifications deployment

This release adds the read-only notifications endpoint and its Computer UI.
Use the dedicated controller to preserve accepted runtime overlays, native
storage adaptations, rollback custody, and runtime Git identity. No database,
schema, package, configuration, wallet, signing, or broadcast change is required.

## Exact node scope

The two existing sources are `server/proof-api.mjs` and
`server/db/proof-index-reader.mjs`. Merge only their approved delta from source
base `c6ede812dd35197c2331d8396d71b6e4c55d0155` over the captured live bytes.
Conflicts require hash-bound reviewed resolutions; replacing either source
wholesale would discard accepted node adaptations.

The ten creation-only helpers are:

- `server/notification-address-history.mjs`
- `server/notification-address-reader.mjs`
- `server/notification-cache.mjs`
- `server/notification-dns-authority.mjs`
- `server/notification-dns-history.mjs`
- `server/notification-dns-relations.mjs`
- `server/notification-id-authority.mjs`
- `server/notification-id-scope.mjs`
- `server/notification-query.mjs`
- `server/notifications.mjs`

Their baseline hashes must be null. Existing or concurrently created helpers
refuse installation. New helpers inherit the captured API file owner, group,
and mode. Rollback restores both existing sources exactly and retains any
installed helper bytes for inspection; those bytes must still match the plan.
A new installation plan cannot silently reuse retained helpers.

## Capture, rehearse, and install

Run both offline test suites before planning:

```sh
python3 -I -B deploy/notifications/check-scoped-node.test.py
python3 -I -B deploy/notifications/check-release.test.py
```

Capture is read-only on the node and writes a private local custody file.
Planning requires the exact clean committed checkout and committed controller
bytes. All output paths must be new canonical paths under `/tmp`.

```sh
candidate_commit="$(git rev-parse HEAD)"
python3 -I -B deploy/notifications/release.py capture /tmp/notifications-runtime-capture.json
python3 -I -B deploy/notifications/release.py plan "$PWD" "$candidate_commit" \
  c6ede812dd35197c2331d8396d71b6e4c55d0155 \
  /tmp/notifications-runtime-capture.json /tmp/notifications-runtime-plan
python3 -I -B deploy/notifications/release.py overlay \
  /tmp/notifications-runtime-plan/plan.json /tmp/notifications-overlay-receipt.json
```

Inspect the merge review and exact candidate before overlay. Only the two
existing sources accept `--reviewed-merges`; its format is
`proof-of-work-notifications-reviewed-merges-v1`, binding each active, base,
repository candidate, and resolved SHA-256 with an explicit review reason.

The controller holds the shared operations lock and pinned Search hold, drains
the gateway before stopping API and its dependent worker, and preserves all
authority-service state and unit bytes. Source, dependency, Node, Git, metadata,
and service fences surround installation and recovery. Search is restored only
after a manifest-bound terminal receipt verifies installation or rollback.
Uncertain transport, incomplete recovery, or foreign source drift leaves the
hold in place for supervised reconciliation; never blindly retry it.

## Product verification and synchronization

The existing Caddy `/api/*` proxy already exposes the new route; no Caddy change
is needed. Verify `/api/v1/notifications` through public Computer HTTPS for an
address and a historical ID, including cursor continuation, raw transactions,
compound protocol actions, accepted historical ID and DNS aliases, and exact
evidence. Invalid input and unavailable authority must retain explicit failure
responses. Read/unread preferences remain local to the browser.

Publish the complete V5 UI release using `deploy/publish/build.py` and
`deploy/publish/release.py`; preserve all 22 managed roots and prior asset
closure. Record the installed node source hashes separately from the UI commit.
Finish with fresh API/worker readiness, affected local and production UI checks,
and `npm run check:release-sync`. GitHub main, primary local main, its rebuilt
preview, and production UI must identify the same released commit. Runtime Git
HEAD may remain older because accepted source overlays use explicit provenance.
