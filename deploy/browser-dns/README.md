# Browser and Advanced DNS deployment

This release adds the Browser application runtime, repairs bounded DNS verification
catch-up, and introduces owner-controlled subdomain page links. Its node overlay
preserves the accepted Audit31, Code, Jobs, Pages, Permission, and content-tip
runtime bytes. Never replace the full checkout or reset its Git state to the
shipping commit. [DNS](../../PROOFOFWORK_DNS.md) and [Pages](../../PAGES.md)
define protocol and execution authority.

## Exact node scope

The complete write allowlist is:

- `server/proof-api.mjs` (existing)
- `server/db/proof-index-reader.mjs` (existing)
- `server/dns-page-link-discovery.mjs` (existing)
- `server/dns-subdomain-discovery.mjs` (existing)
- `server/dns-subdomain-page-links.mjs` (new)
- `src/shared/protocol/dnsSubdomainPages.mjs` (new)

Only the four existing files accept three-way merges or exact reviewed conflict
resolutions. Both new helpers are creation-only: they must be absent from the
capture and remain absent at rollout. The manifest also requires their `before`
hashes to be null. A previously installed or concurrently created helper refuses;
its bytes are preserved for explicit recovery.

The controller changes no database schema/data, indexer or worker source,
configuration, packages, dependency files, Git state, retention policy,
authority-service state, or systemd unit bytes. It restarts the API and its accepted
dependent worker through the same guarded gateway drain and restoration used by
Permission. No wallet credentials or wallet interaction belong to these tools.

## Read-only capture and local plan

Run capture from this controller, then plan from the exact clean committed
shipping checkout. The pinned pre-Browser/DNS repository merge base is
`291b99e7db4ac887e448a10c3bbba9ffa3828018`, including the prior Permission memo
classification repair. The captured node Git HEAD is an independent runtime
binding and remains unchanged.

```sh
candidate_commit="$(git rev-parse HEAD)"
python3 -I -B deploy/browser-dns/release.py capture /tmp/browser-dns-runtime-capture-v1.json
python3 -I -B deploy/browser-dns/release.py plan "$PWD" "$candidate_commit" \
  291b99e7db4ac887e448a10c3bbba9ffa3828018 \
  /tmp/browser-dns-runtime-capture-v1.json /tmp/browser-dns-runtime-plan
```

Capture is read-only on production and creates a private local custody file. It
captures permitted source bytes and metadata, complete old import dependencies,
runtime Git/Node identity, gateway/worker/Search unit hashes, and service states.
Environment files, credentials, wallets, and `node_modules` are excluded. All source
bytes and runtime Git identity are reread and fenced before custody is returned.
The format is `proof-of-work-browser-dns-runtime-capture-v1`; Pages, Permission,
and other product captures cannot authorize this release. A capture from different
controller bytes also refuses.

Plan writes only a new private canonical `/tmp` directory. It verifies exact
committed controller and Search-holder bytes, performs a three-way merge of each
existing source from the pinned repository base, checks every resulting module's
syntax, and rehearses the complete old and candidate import-closure fence. All
captured sources are pinned, including inactive accepted helpers. Candidate and
active inputs remain available after any refusal; reuse neither an output path nor
a failed plan as new evidence.

A conflicting merge refuses and preserves the source inputs and conflict output.
After independently reviewing active, base, repository candidate, and resolved
bytes, prepare a fresh plan with
`--reviewed-merges /tmp/browser-dns-reviewed-merges.json`:

```json
{
  "format": "proof-of-work-browser-dns-reviewed-merges-v1",
  "sources": [{
    "path": "server/db/proof-index-reader.mjs",
    "activeSha256": "<64 lowercase hexadecimal characters>",
    "baseSha256": "<64 lowercase hexadecimal characters>",
    "repositoryCandidateSha256": "<64 lowercase hexadecimal characters>",
    "mergedPath": "/tmp/browser-dns-reviewed-reader.mjs",
    "mergedSha256": "<64 lowercase hexadecimal characters>",
    "reason": "Explain the exact resolution and preserved accepted native accessor."
  }]
}
```

Only the four existing allowlisted files accept a reviewed resolution. Every input
and output is hash-bound. Unsafe paths, symlinks, remaining conflict markers,
unknown writes, changed source pins, and syntax errors refuse. Preserve the accepted
native transition-payload accessor when resolving the index reader; do not replace
it with a stock relational-only read.

## Explicit overlay and verified recovery

Inspect `review.json`, all merged modules, and the exact hash-bound plan before
mutating production:

```sh
python3 -I -B deploy/browser-dns/release.py overlay \
  /tmp/browser-dns-runtime-plan/plan.json /tmp/browser-dns-overlay-receipt.json
```

The supervisor fences source provenance, then holds the independent Search job
with the existing exact-byte-pinned
[Search holder](../search/hold-node-timer.py). The node controller acquires the
existing operations lock; checks every source/dependency pin, authority service,
Node executable, gateway unit, and dependent-worker binding; and captures original
and candidate bytes with fsynced evidence under
`/data/proofofwork-release-backups/browser-dns-RELEASE-TIMESTAMP`.

Drain order is gateway socket, gateway proxy, dependent worker, then API. The
accepted worker is coupled through `PartOf=proofofwork-api.service
postgresql@16-main.service`: stopping API also stops the worker, while starting API
does not restart it. Captured worker PID/state must match before drain, become
inactive/PID zero while drained, and restore to active with a positive PID and the
original runtime working directory. Gateway and worker unit bytes remain pinned.
Restoration starts API, worker, then only previously active gateway units.
Authority, Search, unit enablement, hold bytes, and unrelated source bytes remain
unchanged. Capacity, operations-lock, and concurrent-source fences remain required.

A failed install restores all four original files. Installed new helpers remain
as recovery evidence. A rollback receipt is verified only after the same service,
worker, authority, Search, gateway, and hold checks pass. The supervisor restores
Search after success or verified rollback. Interrupted controllers receive a signal
and time to complete recovery. If recovery is incomplete, still running, or lacks a
verified receipt, Search remains held. SSH timeout produces an uncertain local
receipt: inspect preserved remote backup/hold evidence before recovery or retry.
Never infer installed state from timeout, erase failed evidence, or clear a hold
without verified source and service state.

## Product verification and release completion

DNS catch-up retains only independently Core-proven contiguous block evidence.
The immutable block cache is bounded to 128 MiB, projections to 64 MiB, and each
request slice to 25 seconds. Progress is internal operator state; it never proves
complete namespace, routing, or signing authority. Every retry rebinds its prefix
to Core and the unique canonical index anchor. Public admission still requires exact
checkpoint height/hash, complete history, and matching rolling-witness closure.
Reorgs discard invalidated prefixes; malformed carriers remain discovery evidence.

Verify root `page1`, child `sub1`, and additive `subpage1` reads at their declared
boundaries. Preserve root payment resolution, ownership epochs, historical replay,
fees, and pending/confirmed separation. Browser resolves only complete confirmed
links to independently verified target HTML. Published scripts run in the opaque
isolated runtime, with local wallet signing in the trusted application UI.

Use the complete managed-root [UI release](../publish/release.py), retaining every
existing product, prior root, source/archive attestation, capacity guard, deployment
lock, and retention hold. Verify standalone Browser, DNS, Pages, and their Computer
workspaces against first-party Core/index evidence before announcement.

Release completion requires GitHub `main`, clean primary local `main`, its
rebuilt/restarted preview, and production UI to share one source commit and tree.
Preserve concurrent work and accepted node overlays with source/hash provenance.
The final synchronization gate is mandatory:

```sh
npm run check:release-sync
```

## Offline checks

```sh
python3 -I -B deploy/browser-dns/check-scoped-node.test.py
python3 -I -B deploy/browser-dns/check-release.test.py
```

These temporary-filesystem and mocked-service/SSH checks cover the exact six writes,
two creation-only helpers, four reviewed existing-file merges, real helper import
pins, complete source fences, wrong formats and merge bases, drift/path refusals,
retained metadata, partial-install rollback, socket/worker/API ordering, worker
coupling and restoration, Search restoration or deferred recovery, controller
identity, creation-only evidence, and uncertain dispatch receipts. They make no
production or wallet changes.
