# Exact historical UI payload retirement

Status: local implementation under qualification. This document is not production
authorization or evidence that retirement happened.

## Scope and independent authority

The fixed proposal `6fd05dc1e04e6fbcab293683c5a0d10d184ff0bd83039a66d7f2c7ec53161004`
covers only the 1042 and c396 archives and rollback roots enumerated in
`retirement_receipt.py`. Keep current 064, immediate previous e266, all four
archive sidecars, audit records, source and dependencies. The isolated e266
restore proves static restoration, not a live failover.

Owner approval is a separate tool-level authorization. A generated
`owner-approval.json` is an operator attestation of verified conversation
evidence, not a signature or cryptographic proof of authorship. Use the actual
approval message and timestamp supplied by the coordinating operator; never
invent them. Approval does not waive any subsequent guard.

## Bootstrap and admission

Before executing any successor helper, independently authenticate the exact
reviewed Git commit/tree, raw package manifest hash, complete fixed package
file list, and every listed file's length/hash. Verify canonical protected
root-owned non-writable paths. The controller imports companions before its
main function; its own `--package-sha` check cannot bootstrap trust in already
executing code.

Preserve the original configuration/state/index and all original receipts.
Stage only bounded operator/evidence files. Stock pool limits and the
8 GiB plus 64 MiB physical reserve remain unchanged. Fresh admission must
verify the reviewed four-path inventory, link closure, retained pair,
sidecars, historical equivalents, and current protected metadata under the
existing deployment lock.

## One-step execution protocol

The installed entrypoint is the reviewed package's
`deploy/ui-retention/retirement_controller.py`, invoked with root
`python3 -I -B`, without optimization. Every invocation requires explicit
`--package-sha`, current `--config-sha`, and `--approval-sha` pins.

1. `prepare`: create immutable original-state and pending-transition evidence.
2. `activate-pending --intent-sha DIGEST`: freshly verify original stock status
   and install the exact pending configuration. Pending blocks publication.
3. `remove-next`: perform exactly one admitted action. Inspect its result before
   the next invocation; never run an unconditional retry loop.
4. If an action outcome is uncertain, inspect actual files and journal first.
   `reconcile-next` only accepts fully absent payloads with complete durable
   intent/log coverage. It does not resume a partial tree or silently retry an
   intact payload.
5. After all four actions reconcile, `seal-terminal` runs fresh final guards and
   creates the terminal receipt. It does not install terminal lifecycle state.
6. `install-terminal --intent-sha DIGEST --terminal-sha DIGEST` authenticates
   receipt/evidence and stages the exact successor index/config/state. State
   installs first while publication remains blocked, then terminal config.
   A fresh installed runtime status must verify the exact retired scope.
7. `status` is for completed successor state, not generic pending diagnostics.
   Pending recovery requires intent-pinned transition-position inspection.

Only config/state installation accepts `--resume`, after inspecting a known
interrupted position. Partial evidence creation is not permission to overwrite
files, rerun removal, or infer success. Preserve failed outputs.

## Verification and limits

The default historical-hold path remains unchanged. The alternate path requires
authenticated exact retirement evidence and actual installed operator-package
attestation; absent files or a boolean are not proof. The artifact 064 provenance
remains distinct from the operator source identity.

Final qualification must exercise the actual retirement receipt loader,
transition, installed runtime and consumers together, including pending,
interruption, wrong package, changed preserved state and inconsistent evidence.
Separate unit tests or synthetic status JSON do not establish that integration.

Later ordinary product descendants must preserve authenticated pair lineage.
A future deletion of e266, package/config upgrade or wider cleanup is outside
this four-payload approval and requires its own reviewed migration.


## Reproducible isolated integration qualification

The full fixture executes stock migration/admission/completion records first,
freezes their exact historical hold pins in a real Git-backed helper package,
and derives a declared initial-state fixture from that completed index and
actual config. Fresh, unmodified installed lifecycle status must authenticate
this starting state. This seed is a test precondition, not a tested importer.

It then executes actual pending transition, capacity and preservation guards,
four descriptor-relative removals, terminal receipt verification, state/config
transition and fresh installed status. The separate consumer test uses the
resulting real Git blobs, package bytes, status and raw evidence. The sidecar
proof is a canonical list; accepting a generic JSON object is not equivalent.

Run in an isolated root test environment with Python 3.12 and the qualified
Node24 runtime:
```sh
POW_AUTHORITY_FIXTURE_KEEP=1 python3 -I -B deploy/ui-retention/check-retirement-authority-integration.test.py
python3 -I -B deploy/ui-retention/check-retirement-consumer-authority.test.py REPORT_PATH EXACT_REPORT_SHA256
```

Retain the emitted report and fixture directory. Reference-scanner process,
configuration and nonempty loaded-unit inputs are generated test inventory;
the scanning algorithm and filesystem checks are unchanged, with three
negative reference cases required. This is not live-host reference
qualification. Namespace, authority pins, ancestor boundary and restored-entry
count are fixture-specific. Branded Git/SSH transport remains separately
covered, not exercised by this filesystem interoperability test. Production
pins must reject the synthetic fixture. Fresh production admission remains
mandatory.
