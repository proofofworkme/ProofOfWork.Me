# Durable DNS verification deployment

This upgrade uses the existing Browser/DNS scoped controller discipline with a
new identity and exact four-source allowlist. It preserves the accepted node
runtime overlays and Git identity. The only existing runtime edits are
`server/proof-api.mjs`, `server/dns-page-link-discovery.mjs`, and
`server/dns-subdomain-discovery.mjs`; `server/dns-verification-store.mjs` is
creation-only. The three-way merge base is
`669d7be2fe0379f8a0b8e9403f9ed870033f6882`.

Capture is read-only. Plan requires a clean committed candidate checkout and
hash-bound active custody, preserves complete dependency closure, and checks
merged syntax. Overlay holds Search through the pinned holder, acquires the
normal node operation lock, drains the gateway and API/dependent worker, saves
recoverable source backups, installs the exact reviewed bytes and restores the
same services. Source drift or unrelated dependency changes refuse. Rollback
preserves the new helper and authenticated journal; it never resets node Git,
database data, service configuration or existing infrastructure overlays.

Run `release.py capture /tmp/<new-capture>.json`, then
`release.py plan <clean-checkout> <commit> <base-commit> <capture> /tmp/<new-plan>`.
Review `review.json` and all merged runtime diffs before dispatching
`release.py overlay <plan>/plan.json /tmp/<new-receipt>.json`. Conflicts require
exact reviewed merge bindings as in the predecessor controller.

The API creates `dns-verification-v1` under its existing `POW_API_CACHE_DIR` as
the service user. Production already grants write access to
`/data/proofofwork-api-cache`; no service permission or database migration is
required. Key and receipts stay private on that node and are never put in a
release capture or Git. Full journal custody and failure semantics are in
[OP_RETURN_INFRASTRUCTURE.md](../../OP_RETURN_INFRASTRUCTURE.md).

After initial catch-up, require complete current coverage for all three lanes,
resolve `armyofyouth.pow` through Browser, and verify its confirmed target HTML.
Record heights, checkpoint hashes, target txid and API PID without key contents.
Take a fresh `release.py capture`, then use
`release.py restart <capture> <release-id> /tmp/<restart-receipt>.json` for the
source-fenced normal guarded service drain. Recheck the same domain,
and prove recovered durable heights rather than a historical rescan. Capture
service/source provenance and run the required all-surface UI publication,
primary checkout/preview synchronization and `npm run check:release-sync`.
Do not report a complete release while coverage or synchronization is unavailable.

Local checks: `node --test server/dns-*.test.mjs`,
`python3 -I -B deploy/dns-verification/check-scoped-node.test.py`, and
`python3 -I -B deploy/dns-verification/check-release.test.py`.
