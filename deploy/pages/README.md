# Pages deployment

Pages adds one managed UI surface and a four-file node/API overlay. The active
node checkout contains accepted uncommitted Audit31, Code, Jobs and content-tip
changes. Preserve those live bytes. Do not deploy a full checkout, reset Git, or
replace the reader/API with the repository versions.

## Node source custody and planning

The exact write allowlist is:

- `server/proof-api.mjs` (existing)
- `server/db/proof-index-reader.mjs` (existing)
- `server/dns-page-link-discovery.mjs` (new)
- `src/shared/protocol/dnsPages.mjs` (new)

The controller does not change the indexer, worker source, SQL, runtime config,
Git state, dependency lockfiles or authority services. Pages discovery reads
canonical indexed evidence and raw Core history through the API; it needs no
database bootstrap or migration. The API, its dependent indexer worker and the
pinned gateway are briefly drained and restored. The accepted worker unit has
`PartOf=proofofwork-api.service postgresql@16-main.service`: stopping the API also
stops the worker, while starting the API does not start the worker. Its source and
unit bytes remain unchanged. The controller fences its exact captured state before
drain, requires inactive/PID-zero while drained, then requires active state, the
original runtime working directory and a positive new PID after restoration.

Run from the exact clean, committed Pages shipping checkout. The pre-Pages
repository base is `38916b914510f3d1514ce87d31d497081a319a35`, which includes the
accepted current products and Jobs acceptance record. The production Git HEAD is
an independent captured binding; it is not replaced with the candidate commit.

```sh
candidate_commit="$(git rev-parse HEAD)"
python3 -I -B deploy/pages/release.py capture /tmp/pages-runtime-capture.json
python3 -I -B deploy/pages/release.py plan "$PWD" "$candidate_commit" \
  38916b914510f3d1514ce87d31d497081a319a35 \
  /tmp/pages-runtime-capture.json /tmp/pages-runtime-plan
```

`capture` is read-only on the node. It saves a private local source-custody file
containing the permitted source inventory, Git identity, Node executable hash,
gateway state/unit hashes, Search unit hashes, and service states. It excludes
environment files, credentials, wallet data and `node_modules`. `plan` creates
only a new private `/tmp` directory. It checks the exact committed deployment
tools, merges the candidate delta into captured live sources using a three-way
merge, checks merged syntax, then rehearses the full source/dependency fence.
All captured source files are pinned, including accepted inactive helpers.

An unexplained difference or conflict stops planning. Conflict inputs and the
conflicted output remain in the failed plan directory for inspection. To resolve
it, independently review the active, base, repository candidate and resolved
bytes. A new plan can accept `--reviewed-merges /tmp/pages-reviewed-merges.json`:

```json
{
  "format": "proof-of-work-pages-reviewed-merges-v1",
  "sources": [{
    "path": "server/db/proof-index-reader.mjs",
    "activeSha256": "<64 lowercase hexadecimal characters>",
    "baseSha256": "<64 lowercase hexadecimal characters>",
    "repositoryCandidateSha256": "<64 lowercase hexadecimal characters>",
    "mergedPath": "/tmp/pages-reviewed-reader.mjs",
    "mergedSha256": "<64 lowercase hexadecimal characters>",
    "reason": "Describe the reviewed conflict resolution and preserved live changes."
  }]
}
```

The controller accepts reviewed resolutions only for the two existing allowed
files. It binds every input hash, refuses remaining conflict markers or symlinks,
and checks resolved syntax. Use a fresh output directory after a failed plan;
evidence is creation-only. Any required native transition-storage accessor must
match the accepted live reader contract and be included in this reviewed source
resolution. Do not substitute a direct payload read for the accepted accessor.

## Explicit node rollout and recovery

Inspect `review.json` and the hash-bound plan before running the mutation phase:

```sh
python3 -I -B deploy/pages/release.py overlay \
  /tmp/pages-runtime-plan/plan.json /tmp/pages-overlay-receipt.json
```

The supervisor holds Search with the existing pinned
`deploy/search/hold-node-timer.py`. The controller takes the existing operations
lock, verifies all sources and relative-import closures, checks Node/gateway and
protected worker bindings, requires authority availability, and preserves original
and candidate bytes plus fsynced receipts under
`/data/proofofwork-release-backups/pages-RELEASE-TIMESTAMP`.

Gateway socket activation is stopped before its proxy, the worker and the API. Source
replacement is atomic and refuses unexpected concurrent bytes. After restart,
the original authority and Search states must remain unchanged. Restore order is
API, worker, then the previously active gateway units. Both application services
must be active with a positive PID and the original working directory, and worker
unit bytes must still match. A failed
install restores the two original files; new unused helpers remain as recovery
evidence. A rollback is verified only after those same application/worker checks
and authority/Search/hold checks pass; `rolledBack=true` cannot be recorded while
the worker is inactive. Receipts retain before and restored service states. The
supervisor restores Search after a verified rollback. An
interrupted controller is signaled and given time to finish rollback. If recovery
is still running, fails, or has no verified rollback receipt, Search stays held.
An SSH timeout is recorded as uncertain; inspect remote backup/hold evidence
before recovery or retry. Never infer success from a timeout or clear the hold
without verifying the installed bytes and service state.

## UI publication

Use the current `deploy/publish/` workflow and full managed-root exchange. Pages
extends the accepted V3 20-surface release to V4 with 21; retain every live Code, Jobs,
Publish, Search and other product surface. The old 14–20 manifest families remain
valid rollback history. Preserve archive/source attestations, capacity gates,
root reserve, the deploy lock, retained roots and the Audit28 retention hold.

```sh
python3 -I -B deploy/publish/release.py preflight /tmp/pages-ui-baseline.json
python3 -I -B deploy/publish/build.py "$PWD" "$candidate_commit" /tmp/pages-ui-build
```

`preflight` reads production provenance, helper hashes, live/retained root
fingerprints and capacity under the existing deploy lock. The build uses a fresh
lockfile checkout and defaults to V4/21. New transport plans carry
`releaseFormat=proofofwork-ui-release-v4` and the exact 21 `managedSurfaces`;
historical V3 plans continue to bind 20. Follow the current preserving transport,
publication and collect/HTTPS verification phases; do not bypass a scratch or
root-capacity refusal. The supported preserved-input continuation keeps evidence
when full-copy admission fails. HTTPS verification selects the V4 Pages hostname
along with the other public hosts and compares every archived public file byte.

Promote helpers before staging/publication using the additive
`proof-of-work-pages-ui-install-v1` schema in the existing guarded
`deploy/search/install-ui.py` controller. Its exact file bindings are the stage,
provenance, publisher, verified-retention helper and Caddyfile. Preserve exact
before/after hashes for all five, support-tool/binary hashes, commit/tree and
release identity. The reviewed source namespace on the UI host is
`/var/tmp/proofofwork-deploy/pages-tools-RELEASE`; receipts use
`/var/backups/proofofwork-ui/release-tooling/pages-RELEASE-PHASE-ATTEMPT`.

After the release-bound tools and reviewed installation manifest have been
received with the existing capacity/lock guards, the isolated root controller
uses these arguments on the UI host:

```sh
python3 -I -B /var/tmp/proofofwork-deploy/pages-tools-RELEASE/deploy/search/install-ui.py \
  --phase helpers --source /var/tmp/proofofwork-deploy/pages-tools-RELEASE \
  --manifest /var/tmp/proofofwork-deploy/pages-install-RELEASE.json \
  --manifest-sha256 INSTALL_MANIFEST_SHA256 --attempt initial
```

Collect a fresh preflight after helper promotion so transport/publication plans
bind the installed V4 helper hashes:

```sh
python3 -I -B deploy/publish/release.py preflight /tmp/pages-ui-preflight.json
python3 -I -B deploy/publish/release.py make-plan \
  /tmp/pages-ui-build/build-receipt.json /tmp/pages-ui-preflight.json \
  /tmp/pages-ui-plan.json
```

Receive and publish the complete managed-root release. Only then invoke the same
guarded installation controller with `--phase caddy` and a fresh receipt attempt. This phase requires the exact
V4/21 manifest and commit/tree to be serving, all promoted helper hashes to match,
and provenance verification to pass before Caddy validation/reload. Existing
Search installation schema and V3 behavior remain supported.

Public DNS already resolves `pages.proofofwork.me` to the UI host at the shipping
preflight. Preserve existing Caddy product and identity-bridge policies when
adding the Pages hostname, runner route and certificate. Verify HTTPS source
bytes, runner CSP and all managed surfaces after publication. The candidate pins
DNS page-link activation at `970426`, following independently verified checkpoint
`970425` / `00000000000000000001a22c08622961c9fc0a1b063510bf5fc9141577b77537`.
Preserve that binding in the committed build and production acceptance evidence;
unconfirmed records never alter Browser routing.

## One release identity before announcement

The release is accepted only when GitHub `main`, the clean primary local `main`,
the built local preview, and the production UI all identify the same exact source
commit and tree. Merge and push the reviewed candidate, synchronize the primary
checkout without discarding local work, and build the preview and deployment from
that exact commit. Keep this gate separate from the captured node baseline HEAD:
accepted node overlays are preserved and bound by the scoped runtime receipts.

Every built surface includes `source-provenance.json` with format
`proof-of-work-ui-source-v1`, commit, tree and `trackedDirty`. The final mandatory
check reads actual remote GitHub `origin/main`, requires clean primary `main`,
reads the live production manifest over SSH, and verifies source provenance at
the local preview on `4175` plus public Pages and Computer. It fences a concurrent
GitHub advancement and refuses dirty, stale or mismatched source identities.

```sh
npm run check:release-sync
```

The default primary path is `/home/sixer/ProofOfWork.Me`. An explicit equivalent
invocation is:

```sh
npm run check:release-sync -- --primary /home/sixer/ProofOfWork.Me
```

Run this network/SSH check after production verification and primary/preview
synchronization, immediately before announcing the release. Do not announce
while it is unavailable or fails. Preserve its output with the release evidence;
resolve the actual source mismatch and rerun the gate.

## Offline controller checks

```sh
python3 -I -B deploy/pages/check-scoped-node.test.py
python3 -I -B deploy/pages/check-release.test.py
```

These checks use temporary files and mocked services/SSH. They cover the exact
four writes, socket/worker/API drain order, immutable worker source/unit pins,
the accepted `PartOf` coupling and verified worker restoration, candidate/dependency
drift, path/hash refusals, explicit conflict review, partial install rollback,
retained helpers, Search restoration and uncertain/incomplete recovery.
