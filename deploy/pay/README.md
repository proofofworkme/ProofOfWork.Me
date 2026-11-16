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

Measure the actual current and built asset graphs before helper promotion.
Compatibility follows the prior live family, not the incoming release:
V5 permits 1,664 served paths, 6,400 distinct edges and 1,507,328 raw matches;
V6 permits 1,856 paths, 7,424 edges and 1,638,400 raw matches. The November 15
current V5 and built V6 measurements and original native refusals are retained
in `OP_RETURN_INFRASTRUCTURE.md`. Both stager and publisher must enforce the
same finite bounds, including when Pay becomes the prior release of a later
upgrade. Earlier families and all byte, path, collision and timeout guards
remain unchanged. Run the CI-required
`node --test scripts/check-pay-ui-compatibility.test.mjs` family regressions;
diagnostic censuses do not replace fresh native admission.

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
lifecycle. Authenticate the completed 1042/c3969 payload retirement through its
original terminal receipt, journal, sidecars and admission history; their
absence alone is never publication authority. Bind that historical proof,
the current retained pair, installed package and original config anchor through
preflight, the private plan, installed admission and the final native exchange
fence. A missing private forecast or ordinary publication request must refuse.
The owner separately approved only the e266 archive, its two sidecars and the
pre-064 rollback root for the next ordinary rotation. It can run only after
the replacement and its current/prior pair are verified; refresh the proposal's
placeholder forecast against the final release source before execution.
V6 changes no storage ceiling, root reserve, retention
permission or held-object authority. Its measured compatibility-family ceilings
are independent of storage admission. A capacity
refusal requires its own concrete reviewed cleanup; it cannot be bypassed.

The development verification workspace is
`/data/proofofwork-pay-development-20261114/{source,tmp,results}` on the node VPS.
Source staging and fixture tests there do not constitute production deployment.
Use bounded resources and a four-GiB task output ceiling, recording source hashes
before and after each test batch. No new local test/build/backup artifacts.

## Independent Pay write switch

`write-gate.py` adapts the exact digest-pinned existing Mail batch activation
engine without changing its bytes. A Pay-only wrapper canonicalizes `Requires`
and `PartOf` as sorted exact unit memberships for the known guarded units.
Encoded names stay unchanged; duplicates and ambiguous serialization refuse.
All other property reads pass through unchanged, including ordered
`EnvironmentFiles`, `DropInPaths` and command arguments. Private environment
values, source/file identities, owned-file guards and service-state checks remain
bound. It controls only the root-owned 0644 API drop-in
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

Before activation capture, invoke the pinned
`deploy/search/hold-node-timer.py` with a fresh release/attempt identity and the
exact installed Search service and timer hashes. Review its successful `held.json`
and exact hold marker. Verify the Search timer is inactive and the service is
inactive or failed with PID zero. Capture only this held baseline; the activation
controller retains its exact Search-state guard throughout apply and recovery.
The Search controller uses its own lock. Do not hold the activation operations
lock in a parent process while invoking the native gate, which acquires that
lock itself. Do not change timer enablement or bypass either controller.

The isolated-root `write-gate.py` reads a reviewed JSON request on stdin. Capture
uses `mode: "capture"`, `approval`, `operation` and the prior receipt's `owned`
record (initially null). Apply uses `mode: "apply"`, that same `approval`, the
exact `capture`, its canonical JSON `captureSha256`, and a new private VPS
`receiptPath`. When no owned gate exists, run and review `stage-disabled` first.
Only the exact owned disabled file from a completed, reviewed native operation
may enter a separately captured and reviewed `enable` operation.

If a failed attempt already created an owned false switch, preserve the exact
switch and its ownership evidence until reviewed native atomic replacement,
along with the failed receipt and independent disabled-service recovery. Do not
manually delete/recreate the switch or relabel the failed stage. Authenticate its exact
predecessor ownership and verified recovery against the successor's source,
runtime approval and qualification. With Search held, freshly capture and apply
native `disable` using that owned record and a new receipt path. Require actual
completion and the exact owned disabled file; then freshly capture and review
`enable`. The completed disable receipt establishes the successor's disabled
state without changing the historical failure. Disable intentionally performs no
chain probe, so its completion cannot establish fresh chain qualification for
enable.
The fresh probe independently verifies Core's exact tip and activation parent,
then the loopback Pay reader and expected gate, followed by canonical tip fences.
Any intervening block requires fresh actual preactivation qualification; no retry
silently updates the approved checkpoint. Holding Search does not stop Core or
make an old qualification current.

Restore Search with the same immutable hold bindings only after actual gate
completion, or after independently verified disabled recovery has restored the
application services and verified the owned false switch. Check `restored.json`,
marker removal, original timer activation/enablement and fresh Search coverage.
An interrupted, failed or unknown gate outcome with unverified service recovery
keeps Search held for supervised recovery; do not restore it unconditionally in
a `finally` block. Runtime rollout receipts use a different schema and cannot
substitute for activation completion or disabled-recovery evidence.

The controller preserves the operations lock, gateway drain, complete effective
systemd configuration and source fences, atomic ownership journal, application
restoration, and foreign-file race refusal from the existing activation engine.
Enable failure attempts recovery to an owned disabled switch, retaining Pay
readers and canonical history. Require completed recovery evidence and checks
that the application services are restored; a failed or interrupted attempt is
not proof of recovery. `disable` needs no chain readiness probe. Ambiguous foreign
state remains preserved for supervised recovery. Preparation/tests do not
authorize or claim that any of these production actions occurred.

### Activation failure and recovery evidence

The two 2026-11-15 UTC stage-disabled attempts remain failed. The first refused
before draining applications when the ordinary Search timer changed its captured
state. The second published an owned disabled switch, then failed its exact
configuration check and left the application services drained; its automatic
recovery did not complete. A separate supervised recovery restored the services
with writes disabled. That recovery did not rewrite either failed stage receipt
or establish a successful activation.

Original evidence remains on the NODE VPS under
`/tmp/pay-d5075ab-write-gate-v1/`:

| Receipt | SHA-256 | Outcome |
| --- | --- | --- |
| `stage-disabled-receipt.json` | `71298e8a022ce8cb825c4cea23dc0edbc99244960feee7f7bb75527f16ef1421` | Failed before draining; no owned switch. |
| `stage-disabled-receipt-v2.json` | `cf41306f7155f4a92092d25105fc0f84849183d2e3b738a8b916ff3efd323035` | Failed with an owned false switch; automatic recovery incomplete. |
| `disabled-service-recovery-v1.json` | `a6a902da0d511a2112bb1f20adecddce173bde8807c498a62d96bd4ed2637cef` | Independent service recovery completed with writes disabled. |
| `configuration-reload-diagnostic-v1.json` | `36e75d12cefd45eb0967fb9ac8dc750d1ebd258fec376997d8d628f9da186d5e` | Subsequent controlled reload changed only eight dependency display orders. |

The controlled reload preserved every dependency member, other configuration
property/source file, app/authority/gateway PID and owned disabled switch. This
proves the order-sensitive hashing defect without reconstructing the uncaptured
component map from the second attempt. Regression fixtures exercise those exact
eight order pairs, lifecycle/recovery and refusal of changed memberships or
ordered configuration. Fixtures do not prove a production activation, and the
historical failures remain distinct from the successor release's fresh evidence.

Run the activation regression wrapper only in the authorized VPS workspace. It
executes the Pay gate, Search hold and read-probe fixtures with bounded child
timeouts and output, and is included in the release impact CI test list:

```sh
node --test scripts/check-pay-activation.test.mjs
```

## Completion

Current Activity verification uses `runtime-profile.json`, the reviewed thirteen
Pay runtime hashes from the completed `a3cf496` overlay and its exact merged
runtime test receipt. Three native overlay files retain separate canonical source
hashes; the other ten must match committed source directly. The original six-file
historical Activity check remains tied to its original dual-identity mode. The
current check verifies all thirteen Pay files plus the three unchanged Activity
dependencies, and refuses stale canonical source or changed predecessor pins.

After an authenticated payload retirement, the current release verifies the
installed successor lifecycle package independently from the historical policy
that authorized retirement. It reads the original sealed evidence and every
bounded package-upgrade predecessor; it never relabels historical qualification
as current release authority. The default release check uses this current mode.

A tooling-only successor still requires its own exact source build and completed
runtime deployment receipt before write activation. A fresh Pay runtime plan may
prove all thirteen before/after hashes equal, but applying that plan still drains
and restarts the app services through the existing scoped controller. Keep the
earlier plan and receipt unchanged; a plan alone is not deployment evidence.

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
