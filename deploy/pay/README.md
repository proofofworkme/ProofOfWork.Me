# Pay release procedure

This is a prepared release procedure, not evidence that Pay has been deployed.
The user approved the complete on-chain Pay product at `pay.proofofwork.me`.
The protocol, exact amount and settlement rules are in [PAY.md](../../PAY.md).

## Runtime and discovery

Pay opens at height **975856**, after the independently verified Core parent
975855 / `00000000000000000002104a6f2c1984df28fd344cc34453d91da639f03cbd13`.
Earlier ordinary Mail never acquires Pay authority. The first reader deployment
keeps `POW_PAY_WRITES_ENABLED` false. Complete candidate discovery, exact-tip
canonical Mail and WORK settlement evidence, historical compatibility and the
production read checks are required before a separately reviewed gate change.

The scoped controller preserves the active `/opt/proofofwork-api` source and
its accepted overlays. It changes only its explicit Pay allowlist, with new
helpers creation-only and shared sources merged from exact active/base/candidate
bytes. Every conflict requires an independently reviewed hash-bound resolution.
Package/dependency files remain pins, never runtime write targets. QR generation
is a frontend dependency and does not require node dependency replacement.

`release.py capture /tmp/pay-runtime-capture-<unique>.json` stores the full source
capture **on the node VPS** and returns only a compact receipt. Run `plan` on that
VPS from the clean committed release source, using an exact prior repository
commit as the merge base. All plans, merged candidates, test output, rollback
bytes and dispatch receipts remain on the VPS. Do not use older local-capture
wrappers or copy the runtime to the operator computer.

The plan binds all current sources, complete relative-import dependencies,
Node executable, worker/API units, gateway activation and the Search hold
controller. Review every merged candidate before `overlay`. The
dispatch forms are `release.py overlay <VPS-plan.json> <VPS-receipt.json>
--plan-sha256 <reviewed-sha256>` and the same arguments with `bootstrap`.
Dispatch validates the plan on the VPS and emits only its compact receipt.
The established
controller holds Search, drains the gateway and API/worker, installs the scoped
sources, then verifies restoration. Core, Electrs, PostgreSQL, wallet authority,
Git state and runtime dependency files remain protected. Failure restores
existing source; new unused helpers remain recovery evidence. An uncertain or
incomplete rollback retains Search's hold for supervised recovery.

After successful source installation, `release.py bootstrap` runs only
`--bootstrap-pay-candidates` through the existing worker configuration, without
printing its environment. Each invocation is bounded. Incomplete discovery is
an unavailable product state, never a complete empty invoice list. Ordinary
indexing maintains contiguous discovery and reorg replay after bootstrap.
Verify `/api/v1/pay-invoices` and `/api/v1/pay-invoice`, Search, Log, notifications,
Mail and existing WORK/Growth accounting at one coherent checkpoint. Underlying
Mail and WORK economics count once; Pay adds no second payment lane or escrow.

The installed linked Publish writer is already active. Preserve its switch and
accepted runtime. Pay changes the linked source envelope from 179 to 184 files;
the reviewed projected digest is
`3192c630f4ca5399e2f05a8a6513170d2a2926676d30ef27a13ca2a37f120c38`.
The existing indexer refreshes that marker only after completing a new canonical
block. A same-tip sweep or Pay bootstrap cannot refresh it. After source cutover,
wait for that real block, then independently match actual source, loaded API,
indexer marker and current Search V6 coverage before Pay activation. Keep the
five-second linked capability deadline and final fences. Historical dual V5
qualification remains bound to its original artifact; do not relabel it as Pay.
An eight-file rollback deliberately retains the five new helpers. Its source
envelope therefore also requires a new-block marker: 184 files / 8,132,599 bytes,
digest `264ca6c9c65fb7839f15f5371e7de3dd2035507291f2073a95358c6cbdcd3d9e`.
Restored services alone cannot establish linked writer recovery; verify the
rollback envelope, marker and Search against the actual canonical checkpoint.

## UI and storage

UI release **V6** adds Pay to the exact **23 managed roots** (22 distinct public
builds plus the NFT compatibility alias). V3/V4/V5 archives retain their exact
historical families. `deploy/publish/build.py --release-format v6` builds with
`VITE_PAY_ONLY=1` and `https://pay.proofofwork.me`. All managed products publish
atomically with prior referenced assets, full archive/provenance verification,
and matching standalone and Computer `/?folder=pay` behavior.

The guarded `deploy/search/install-ui.py` schema
`proof-of-work-pay-ui-install-v1` installs hash-bound helper candidates first.
Its Caddy phase requires the complete exact V6 publication before activating
the Pay hostname and `/var/www/proofofwork-pay` root. Public invoice links use
`/?invoice=<txid>`; wallet-scoped query state stays private/noindex. A changed
shared SEO catalog also requires the existing guarded Publish renderer upgrade.

Before publication, upgrade the installed retention lifecycle package using
`deploy/ui-retention/install_lifecycle.py --ui-host plan-upgrade-complete` and
its exact hash-bound `upgrade`. Bind the current config and completed state,
preserving the same completion, admission lineage and individual holds. The
package includes the V6-aware `ui-storage.py`, its historical writer allowlist
and the V5/V6 host check. The Pay UI helper installer does not perform this
separate lifecycle upgrade.

Full builds use the node data-volume build pool; source and surface archives
stream to the UI host via `--bundle-host node-vps`. Use the closed-input/private
staging flow, fresh whole-sequence capacity admission and completed retention
lifecycle. Preserve the separately held 1042 and c3969 fallback objects and all
their admissions. V6 changes no storage ceiling, root reserve, retention
permission, compatibility-path/edge ceiling or held-object authority. A capacity
refusal requires its own concrete reviewed cleanup; it cannot be bypassed.

The development verification workspace is
`/data/proofofwork-pay-development-20261114/{source,tmp,results}` on the node VPS.
Source staging and fixture tests there do not constitute production deployment.
Use bounded resources and a four-GiB task output ceiling, recording source hashes
before and after each test batch. No new local test/build/backup artifacts.

## Independent Pay write switch

`write-gate.py` adapts the exact digest-pinned existing Mail batch activation
engine. It controls only the root-owned 0644 API drop-in
`/etc/systemd/system/proofofwork-api.service.d/zzzzz-pay-writes.conf`, containing
`[Service]` and `Environment=POW_PAY_WRITES_ENABLED=0` or `1`. It supplies no
declaration, amount, checkpoint or other protocol authority through environment
variables. The source overlay and discovery bootstrap never enable this switch.

First finish the V6 UI/renderer/runtime deployment and its complete reader
qualification. Run `scripts/check-pay-live.mjs` with
`POW_PAY_CHECK_MODE=preactivation`; this verifies both public Pay/Computer
readers and retained linked/Growth behavior while allowing an empty invoice
history. Leave `POW_PUBLISH_CHECK_MODE` unset because existing Publish is active.
The final default `released` check separately requires a real confirmed paid
invoice and its raw transaction, Search, Log and notification evidence.

Retain a root-reviewed `pay-write-gate-qualification-v1` wrapper on the VPS with
the exact `sourceCommit`, committed live-check `checkerSha256`, complete deployed
`runtimeAfter` hash map, `rootReviewed: true` and the actual preactivation
checker JSON as `result`. These fields record the completed independent review;
they cannot substitute for running the checker. Do not synthesize a passing
result or change its checkpoint to match a later tip.

After the successful overlay, capture the runtime again. From the final clean
committed source, `prepare-write-gate.py` consumes exact `--manifest`, `--receipt`,
`--capture` and `--qualification` paths with their respective `--*-sha256`
arguments, plus `--source-commit`, the separately reviewed
`--runtime-status-sha256`, and a new private VPS `--output`. Use the inner scoped
controller's original manifest and completed receipt. The planner binds their
exact bytes, all deployed source hashes/metadata, Node and the gate tool sources;
it creates only the reviewable approval file.

The isolated-root `write-gate.py` reads a reviewed JSON request on stdin. Capture
uses `mode: "capture"`, `approval`, `operation` and the prior receipt's `owned`
record (initially null). Apply uses `mode: "apply"`, that same `approval`, the
exact `capture`, its canonical JSON `captureSha256`, and a new private VPS
`receiptPath`. Run and review `stage-disabled` first. Only its exact owned
disabled file may enter a separately captured and reviewed `enable` operation.
The fresh probe independently verifies Core's exact tip and activation parent,
then the loopback Pay reader and expected gate, followed by canonical tip fences.
Any intervening block requires fresh preactivation qualification; no retry
silently updates the approved checkpoint.

The controller preserves the operations lock, gateway drain, complete effective
systemd configuration and source fences, atomic ownership journal, application
restoration, and foreign-file race refusal from the existing activation engine.
Enable failure recovers to an owned disabled switch, retaining Pay readers and
canonical history. `disable` needs no chain readiness probe. Ambiguous foreign
state remains preserved for supervised recovery. Preparation/tests do not
authorize or claim that any of these production actions occurred.

Run the added fixture checks only in the authorized VPS workspace:

```sh
python3 -I -B deploy/pay/check-write-gate.test.py
node --test deploy/pay/write-gate-probe.test.mjs
```

## Completion

Run the Pay protocol/runtime, historical Jobs, whole-Computer and V6 publication
checks; record any real signing path not exercised. Keep writes closed until
paired readers, full discovery and all required surfaces are verified. Complete
repository hygiene and source review before the exact approved commit.

After publication, compare every managed archive file to HTTPS and verify the
standalone Pay invoice and embedded Computer paths, failure states, exact
amounts and local wallet review. Synchronize GitHub `main`, primary local `main`,
the existing local preview and production to the same released source. Install
the VPS-built preview in place. `npm run check:release-sync` is mandatory before
completion or announcement, including the exact public Pay provenance and the
release impact record's live check.
