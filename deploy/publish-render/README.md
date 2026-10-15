# Verified Publish article renderer deployment

This UI-host sidecar reads the existing fresh Boost detail endpoint through the
private tunnel. It does not change the node/API/indexer checkout, API routes,
WireGuard, firewall, database or wallet authority. The public article route is
activated by the existing separate guarded Caddy installer after service health
passes. All 22 static roots still use the normal complete UI release.

The fixed renderer source allowlist is `SOURCE_FILES` in `install.py`. Its
versioned source root is `/opt/proofofwork-publish-render/releases/<commit>`.
`release.json` records `format: proof-of-work-publish-render-source-v1`, the full
installed source `commit` and `tree`, and a `files` object mapping each exact
relative module path to its SHA-256. It contains no secrets. The active manifest
is `/opt/proofofwork-publish-render/active.json`; the unit points directly to the
versioned root. A later UI release can retain the service only when its committed
renderer modules match those installed hashes. The public renderer provenance
and release-sync checks distinguish the installed renderer commit from the
current UI commit; neither implies a node-host Git reset.

The unit binds `127.0.0.1:8084`, uses the fixed upstream
`http://10.77.0.2:8081`, and reads the live Publish `app.html` and
`source-provenance.json`. It runs as a dynamic unprivileged user with read-only
source/UI files, no capabilities, a 256 MiB memory ceiling, 50% CPU quota and 32
tasks. Network access is limited to the fixed upstream address and loopback.
The renderer itself enforces bounded requests and response verification.

## Local preparation and resource measurement

The runtime is the same official Node 24.18.0 Linux x64 distribution already
pinned by `deploy/install-node-runtime.sh`. Do not run that unguarded installer
on the UI host. Download its archive locally, preserve it and verify SHA-256
`55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742` before packaging.
The reviewed archive has 31,511,588 compressed bytes and 5,774 entries, with
196,027,736 regular bytes. Its conservative extraction envelope is 302,051,328
bytes, including rounded allocation and metadata. This does not replace a fresh
production capacity check.

`archive_inventory()` inventories every path, size, mode and regular-file hash,
rejects escaping links and unsupported members, and computes the allocation
bound before extraction. An existing runtime must match the complete official
inventory, not just print the expected version. A successful install retains the
compressed input package, the exact runtime inventory and receipts. Failed or
rolled-back candidates remain preserved; no cleanup or retention override is
included.

Before committing, run the ordinary repository hygiene and relevant tests,
including:

```sh
python3 -I -B deploy/publish-render/check-install.test.py
```

Build and publish the complete 22-root UI with the existing
`deploy/publish/build.py`, `release.py`, `transport_preserve.py`, and
`collect_verify.py` flow. Use the exact new build/phase model plus fresh storage
measurements to decide admission before any production allocation. The prior
release's receipt is a sizing reference, never authorization to exceed a limit.

## Exact install order

After the exact candidate UI commit is published, capture again. `capture` reads
only bounded configuration, holds, manifests, runtime files and systemd state;
it does not take the deployment lock or run the full UI preflight.

```sh
python3 -I -B deploy/publish-render/package.py capture /tmp/publish-render-capture.json
python3 -I -B deploy/publish-render/package.py build \
  --repo /ABS/CLEAN/SEO-WORKTREE --commit FULL_40_CHARACTER_RELEASE_COMMIT \
  --capture /tmp/publish-render-capture.json \
  --node-archive /tmp/pow-publish-render-node-v24.18.0-linux-x64.tar.xz \
  --output /tmp/publish-render-package --attempt initial
```

`build` creates only a fresh local package, checks clean committed source, and
binds every candidate file and the exact capture. Inspect `package.json` and
`plan.json` before the explicit mutation commands:

```sh
python3 -I -B deploy/publish-render/package.py transfer /tmp/publish-render-package
python3 -I -B deploy/publish-render/package.py install \
  /tmp/publish-render-package /tmp/publish-render-install.log
```

Transfer creates only the exact private
`/var/tmp/proofofwork-deploy/publish-render-<12-character-commit>-initial` package.
It takes the shared deployment lock, rereads the capture, and admits the complete
package through both normal free-space/retained-budget checks and the unchanged
scratch budget. A partial transfer is preserved and refuses reuse.

Installation takes the same shared lock, verifies the complete capture and exact
22-root publication, then admits the entire extraction/source/receipt envelope
and the separate retained receipt allocation before creating anything. The
existing capacity helper retains its 10 GiB root reserve, 64 MiB growth reserve,
16 GiB total UI retention ceiling, 9 GiB transport ceiling and 5 GiB scratch
ceiling. No command-line or environment bypass exists. It atomically installs
versioned runtime/source and unit/active-manifest bytes, enables and starts only
`proofofwork-publish-render.service`, and verifies `/healthz` against the installed
module hashes and complete current UI provenance. It preserves every prior
runtime/source directory and all other service/configuration state.

The immutable receipt directory is
`/var/backups/proofofwork-ui/publish-render/<12-character-commit>-initial`.
`completed.json` is success evidence. Failure writes `failure.json`, attempts
rollback even when that receipt write fails, and records `recovery.json`.
Rollback uses restoration files preallocated and fsynced on each target filesystem
before promotion; it restores exact prior unit/active bytes and prior enablement/activity;
unknown replacement bytes refuse automatic overwrite and prevent restarting the
prior service until its exact unit/active bytes are verified. `rollback-locations.json`
records the preserved same-filesystem recovery paths. Newly installed source
and runtime remain as evidence. A connection loss or timeout is uncertain:
inspect that exact receipt, deployment unit, active manifest and service health
before attempting any recovery. Never blindly reuse or remove a failed package.

Once the sidecar passes, use the existing Caddy installer with a fresh plan bound
to the exact current release and Caddy pins. Verify raw no-JavaScript article
HTML, query/private/missing/error states, all roots, source provenance, local
preview and `npm run check:release-sync` before release completion.
