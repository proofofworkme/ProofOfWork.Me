# WORK batch write activation

This controller changes only the API's dedicated
`/etc/systemd/system/proofofwork-api.service.d/zzzzz-work-batch-writes.conf`.
The file is root:root, mode 0644, and contains the seven public declaration
positions, `WORK_BATCH_ACTIVATION_HEIGHT`, and `WORK_BATCH_WRITES_ENABLED`.
The worker receives no batch environment pins. It discovers and preserves
canonical read activation from the chain.

The dormant runtime controller in `../work-batch-sends/` is unchanged by this
workflow. Finish and verify the approved dormant release first. Declaration
publication remains a separate, user-authorized action signed in the local
authority wallet. The earliest eligible declaration block is 972965; read
activation begins at D+1. This workflow does not hold indexing before publication.

The sole declaration-order compatibility exception is transaction
`b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28`
with registry vout 2, carrier vout 1 and ordinal 0. This explicitly authorized
bootstrap exception preserves the original declaration text and its hashes;
all confirmation, authority, earliest-selection, D+1, parity and write gates
remain required. See [Exact bootstrap compatibility](../../WORK_BATCH_SENDS.md#exact-bootstrap-compatibility).
It does not authorize configuration or replay. If D+1 was already sealed without
batch context, a separately reviewed canonical replay is required before this
controller can enable writes; never manufacture the activation marker.

## Authority and inputs

Use only the final reviewed source commit and successful dormant deployment
manifest/receipt on the VPS. Do not use a draft commit, infer successful deployment
from current file presence, or reset accepted runtime overlays. The deployed
runtime Git HEAD may intentionally be older than the released source commit.

`prepare-approval.py` is read-only. It verifies the controller, probe and dormant
controller bytes against the exact source commit, checks the successful dormant
receipt's manifest hash and ten-file scope, and derives runtime after-hashes and
metadata from that manifest. Supply the separately reviewed post-deployment
runtime Git-status SHA256 and the reviewed Node executable path. It emits an
approval object containing the final source commit, accepted runtime HEAD/status,
runtime import closure, metadata, Node hash and reviewed controller hashes.
No source bytes, credentials or environment values enter this object.

Use the inner dormant controller's `manifest.json` and `receipt.json` under
the `overlay.rollbackRoot` in the JSON decoded from the successful dispatch
receipt's `stdout`. Use the original manifest bytes without reserializing. Both use
`proof-of-work-work-batch-sends-scoped-runtime-v1`. The outer
`node-dispatch-receipt-v1` receipt printed by `release.py overlay` and
`plan.json` are not these inputs.

Review the accepted runtime status and hash its exact stdout bytes, including
newlines, using the same command as the controller:

```sh
git -c safe.directory=/opt/proofofwork-api -C /opt/proofofwork-api   status --porcelain=v1 --untracked-files=all | sha256sum
```

After the final source is committed and the dormant deployment succeeds, run the
reviewed generator on the VPS with the actual paths and identities:

```sh
python3 -I -B deploy/work-batch-activation/prepare-approval.py \
  --manifest /PRIVATE_VPS_PATH/manifest.json \
  --receipt /PRIVATE_VPS_PATH/receipt.json \
  --source-commit FINAL_REVIEWED_40_CHARACTER_COMMIT \
  --runtime-status-sha256 REVIEWED_POST_DEPLOYMENT_STATUS_SHA256 \
  --node-path /opt/node-v24.18.0-linux-x64/bin/node
```

Review the emitted approval before using it. The controller never substitutes
whatever runtime hashes it happens to capture for these reviewed hashes.
Accepted subsequent runtime changes require a new reviewed composition and
approval. No deploy, configuration or restart is authorized merely by preparing
this source or an approval object.

For the original declaration repair after the intervening AMO release, use
`prepare-composed-approval.py`. It requires the exact ordered successful
B3 batch, A3 AMO, and final replay manifests and receipts. The first two pairs
have fixed historical hashes. Each later before-hash and dependency must extend
the preceding approved after-hashes; current file presence cannot supply missing
provenance. The final layer must also prove the qualified full prefix, atomic
native publication, retained original evidence, and active reads with writes
disabled. The final source commit/tree and activation helper bytes remain pinned.

The root-private chain input has format
`work-batch-activation-composition-input-v1` and three ordered `layers`;
each layer contains `manifest` and `receipt` objects with exact absolute
`path` and `sha256` fields. Run:

```text
python3 -I -B deploy/work-batch-activation/prepare-composed-approval.py \
  --chain /PRIVATE_VPS_PATH/release-chain.json \
  --chain-sha256 EXACT_CHAIN_SHA256 \
  --source-root /PRIVATE_VPS_PATH/CLEAN_FINAL_SOURCE \
  --source-commit FINAL_REVIEWED_COMMIT --source-tree FINAL_REVIEWED_TREE \
  --runtime-status-sha256 REVIEWED_POST_DEPLOYMENT_STATUS_SHA256 \
  --node-path /opt/REVIEWED_NODE/bin/node \
  --output /PRIVATE_VPS_PATH/activation-approval.json
```

The composed approval is still only an input to the separate fresh captures and
disabled-stage/enable operations below. It does not enable writes.

## Evidence and operations

Run `controller.py` as root with `python3 -I -B`, with one JSON request on stdin.
Use a bounded VPS supervisor and a root-private 0700 VPS control directory.
Keep source, requests, receipts, logs and test artifacts on the VPS. Do not
download backups or custody archives. The controller uses the existing
`/run/proofofwork-audit29-ops.lock` and refuses concurrent operations.

A capture request is:

```json
{
  "mode": "capture",
  "operation": "stage-disabled",
  "approval": {"...": "the reviewed approval object"},
  "owned": null
}
```

Capture is read-only. Its result binds the runtime inode identities, private
systemd/environment digest, service/gateway states and independent evidence.
Environment values are read privately from the running API and remain in memory;
only configuration hashes leave the controller. Manager environment, inherited
or unset batch keys, foreign unit directives, and batch assignments in shared
environment files are rejected. Shared secret files are never changed.

Review the capture and its SHA256 over canonical JSON: UTF-8
`json.dumps(value, sort_keys=True, separators=(',', ':'))`.
An apply request is:

```json
{
  "mode": "apply",
  "approval": {"...": "the same reviewed approval"},
  "capture": {"...": "the reviewed capture"},
  "captureSha256": "CANONICAL_CAPTURE_SHA256",
  "receiptPath": "/ROOT_PRIVATE_VPS_CONTROL_DIRECTORY/new-operation.json"
}
```

The receipt path must be new, with a root-owned 0700 parent and trusted ancestors.
The controller never writes a process environment or raw transaction into it.
Use a fresh capture for every operation:

1. **stage-disabled:** after the automatic D+1 canonical marker exists, derive the
   exact declaration pins independently and create the drop-in with switch 0.
   An existing path is refused. This step cannot enable writes.
2. **enable:** provide the exact `owned` identity from the successful disabled
   stage receipt. Capture and apply both require a fresh independent probe.
   Only an owned disabled stage may become enabled.
3. **disable:** provide the latest owned identity. The same pins are retained
   with switch 0. Core, marker, index readiness and V8 admission are deliberately
   not prerequisites for disabling writes. Runtime/configuration/ownership fences
   still apply; unknown files are never overwritten.

The probe uses first-party Core only, binds raw transaction IDs and prevout
scripts/values, proves canonical block membership, verifies the earliest eligible
declaration through the qualified sealed-prefix reader, and compares the
canonical marker with D+1 and current-tip transitions. It independently requires
current V8 write admission from the fresh WORK floor response and checks the
compact batch status at the same Core tip. Status flags alone are never authority.
A final Core-tip fence rejects a moving tip; take a fresh capture and retry.
The public-copy scan drains bounded pages under an overall probe timeout.
Missing evidence fails closed.

Apply drains gateway socket, gateway proxy, worker, then API. It rechecks source
and private configuration before restarting. Previously active API/worker and
gateway units are restored in dependency order; initially stopped units stay
stopped. Authority services and Search states must remain unchanged. Effective
process batch variables must exactly match the owned drop-in after restoration.

## Failure and recovery

Creation uses a no-replace link. Updates move the incumbent into a unique,
root-private directory on the same filesystem, verify its exact inode/hash and
metadata, and publish with no replacement. Foreign raced-in files are preserved.
Only the verified owned former inode may be removed. Intent is persisted before
publication; ambiguous recovery files remain on the VPS for operator review.

An enable failure, timeout or caught termination attempts to restore switch 0
with the same pins and verifies the effective disabled process environment.
It never removes read code, removes the activation marker, changes authority
pins, or restores pre-activation source. A stage failure likewise retains a
disabled staged file when it can safely do so. Source/config drift or foreign
ownership may leave applications drained rather than start unverified services.

Run under a supervisor with enough termination grace for bounded recovery
(for example RuntimeMaxSec=600 and TimeoutStopSec=600, CPUQuota=100%,
MemoryMax=2G, MemorySwapMax=0, Nice=15). Do not force-kill a live operation.
A SIGKILL, host crash or a second failure during recovery can interrupt cleanup.
Inspect the private receipt and any recorded quarantine before resuming; verify
the actual inode against the recorded `owned` or prepared `intent`. Never invent
ownership from current file presence. A subsequent disable capture may proceed
without chain readiness. Preserve interrupted evidence until recovery is verified.

If a config path is foreign or changed, stop and obtain a separately reviewed
recovery action. Do not delete it, broaden the controller's fixed path, or
restore old read-era code to make recovery appear complete.

## Validation

`npm run check:work-batch:activation` runs mocked controller, probe and ordered
release-composition tests.
The tests exercise source approval, exact file creation/update ownership,
publication races, restart/postflight failure recovery, disabled operation without
chain health, private configuration inheritance, canonical declaration/marker
mismatches, D+1 reorgs, changed tips, V8 parity, and public coinbase copies.
They create only temporary fixtures on the VPS and never call live systemd,
Core, databases or configuration paths.

Run the repository hygiene workflow before committing. This controller is
release tooling, not a deployment receipt or approval to perform activation.
