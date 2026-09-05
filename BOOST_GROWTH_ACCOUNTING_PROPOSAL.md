# Boost Growth Accounting Proposal

Status: draft, unactivated. Prepared for the approved local Boost metrics and
forecast integration on 2026-09-05. This document is design work, not a
declaration, protocol authority, production release, or approval to change
canonical economics. There is no activation transaction or height for this
proposal. Implementing or activating its accounting rules requires separate
explicit approval and the declaration/readiness process agreed for that work.

## Current Local Scope

Growth gains an observational Boost product view and a versioned, explicitly
assumed forecast. Neither is added to canonical `actualValue`, WORK network
value, WORK floor, historical H-1 summaries, or frozen listing terms.

The `boost-growth-observation-v1` summary reads the complete recognized
confirmed indexed Boost record set at Growth's height/hash/snapshot. It does
not sum the paginated or visibility-filtered public feed. Pending and explicit
invalid records are excluded, while hidden records remain confirmed history.
Complete indexed observations are distinct from independently verified
economic attribution: unavailable proof-payment, registry-fee, or seller-price
evidence produces unavailable fields, not a zero or partial total. Verified
companion Mail proof payments and WORK quantities are overlap diagnostics;
they must not be added to network value again.

The current forecast is `2026-09-05-all-products-v1`. Its
[assumptions and output](output/proofofwork-computer-agent-adoption-model.md)
preserve the [May baseline archive](output/historical/2026-05-13/README.md)
and the intermediate Boost-only scenario separately. Usage, registry value, sales, fee
elasticity, and incremental blockspace are scenario assumptions, not current
chain measurements or canonical accounting parameters. Original posts reuse
Mail demand and count only added Boost metadata; attached WORK and Files
bytes do not create duplicate forecast value or transaction demand.

## Why A Separate Accounting Version Is Needed

Current raw replay recognizes `pwb1:` without applying a Boost economic delta.
The Growth event-delta path also excludes Boost kinds. A companion Mail/Files
record or valid WORK movement can already contribute under its own rules;
some Boost-only actions do not enter those lanes. Removing the exclusions
without a declared boundary would change replayed network value and the inputs
used to freeze later WORK AMO units and INCB issuance.

The proposed successor should add only eligible, previously uncounted
components from valid confirmed Boost actions after its declared boundary.
Historical statistics can cover earlier records without retrospectively
changing their economic effect.

## Proposed Output Attribution

Use full-node transaction inputs, outputs, exact carrier positions, and
protocol validation at the record's canonical position. Never infer payment
ownership from a displayed signal total, address balance, current profile
receiver, public feed row, or current WORK floor.

Maintain one transaction-wide economic attribution table keyed by
`(network, txid, vout)`. Each row records the physical output value, attributed
proof amount, owning economic role, supporting accepted record position, and
excluded remainder. A physical output is economically claimed once; derived
Mail, Files, Boost, AMO, and search views can reference that claim without
creating another one. If a declared aggregate-output rule allocates amounts
among several records, their exact allocations must sum to at most the one
claimed output. No implicit fractional reuse or second fee is allowed.

Recommended treatment:

| Component | Proposed accounting treatment |
| --- | --- |
| Boost registry fee | Count the validated 546-proof fee once for each supported paid mutation, subject to explicit output-allocation rules. Resolve the registry receiver from confirmed ID state at the canonical position. |
| Required follow payment | Count the validated payment to the followed address once, separately from the registry fee. |
| Optional target proof signal | Count only the output amount demonstrably attributable to the valid action and its canonical target/current owner. A Mail/Files-owned amount has no second Boost contribution. |
| Original-post self-send | Preserve any existing Mail/Files attribution. An optional self-send is a protocol signal, not automatically change; its output role must be proved. |
| Boost sale | Count the validated frozen seller price once as sale volume, plus its distinct registry fee. Listing metadata and an unsealed ask create no sale volume. |
| Listing sale-ticket principal | Exclude the seller-controlled ticket value from payment flow when created. |
| Ticket refund on purchase or recovery | Exclude returned principal from sale volume and new network value, including when seller price and ticket refund share one output. |
| Change or unrelated outputs | Exclude; paying an address that also appears in a Boost record is insufficient evidence. |
| Attached WORK | Keep the existing era-valid `send2`/`send3` movement and registry-fee lane. Boost may display exact quantity and overlap; it creates no second WORK movement or valuation. |
| Files/media reference | No duplicate file value or bytes. The original verified Mail/Files carrier owns its existing attribution. |
| Miner fee | Derive from complete inputs minus outputs, once per eligible confirmed transaction. Companion records and projections never multiply it. |

If the registry, owner, sender, and target share an address, distinct economic
roles still require an unambiguous allocation. Address equality does not make
one 546-proof output satisfy two independent paid roles. Seller output value
must be decomposed into the frozen price, exact ticket principal, and any
unattributed remainder before adding sale volume.

The final declaration must fix deterministic output precedence and overpayment
treatment. Prefer the existing canonical allocation algorithm where compatible,
with explicit handling of shared Mail/Boost carriers and aggregated WORK fee
outputs. Economic deduplication must not accidentally invalidate an otherwise
valid companion Mail or WORK record. Those interactions need replay fixtures
before an executable specification is approved; this draft does not assign a
new precedence by changing a parser today.

## Validity, Ordering, And Exact Arithmetic

An economically eligible Boost action must pass raw-carrier decoding,
authority, confirmed parent/target, receiver, payment, ownership, and lifecycle
checks for its opcode. A purchase additionally requires the accepted listing,
matching seal/signature and frozen terms, correct ticket spend, seller payment,
buyer constraints, and registry payment. A confirmed ticket spend can close
inventory without proving a valid sale. Invalid records stay inspectable and
add no Boost value; an independently valid companion protocol record retains
its own effect. Pending, dropped, orphaned, and unresolved records add no
canonical value. `pwb1:hide` changes visibility only and never removes a past
count, payment, or economic contribution.

Replay in `(blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)`
order, with one declared transaction-final miner-fee step. Validate and compute
a record's frozen effects from its permitted pre-record state before applying
that record's own contribution. A later output/record, later block, current
profile owner, or refreshed price must not rewrite a historical decision.
Retain the existing H-1-only valuation boundary for INCB attachments.

All proof amounts use exact nonnegative integers. WORK amounts retain their
declared historical Q8 or current Q16 units; no decimal display or JavaScript
floating-point value becomes consensus input. Q8 network value remains a
separate scale from Q16 WORK quantity. The proposed additive proof component
can be expressed as:

```text
F = sum(exact eligible newly attributed Boost proofs)
boostBaseDeltaQ8 = F * declaredValueMultiple * 100000000
```

The recommended `declaredValueMultiple` is the existing Growth proof-flow
multiple of 5, explicitly pinned in the future declaration. This is a proposal,
not an activated parameter. Miner cost stays in its existing once-per-tx
fixed-cost lane, and WORK movement uses the existing canonical accumulator;
neither is added to `F`. Do not approximate the complete live network-value
effect as `5 * F`: the canonical live WORK revaluation still applies.

Serialize integer commitments as canonical decimal strings, define any
rounding at the existing valuation boundary, and fail closed on missing,
ambiguous, unsafe, overflowed, or mismatched evidence. Commit output claims,
accepted/invalid outcomes, value deltas, and opening/closing state so an
independent full-node replay can reproduce the result.

## Proposed Cutover And Continuity

1. Approve the complete rule, version identifier, declaration authority,
   exact bytes, output allocation, and activation/readiness contract. Preserve
   the current economic implementation and old generated artifacts.
2. Prepare an exact local-wallet declaration for human review and signature.
   If it confirms in block `D`, the recommended activation is the opening of
   `D + 1`. Record exact carrier, authority, block hash, transaction position,
   and declaration commitments only from confirmed evidence.
3. Commit the legacy closing state at `D` and use it unchanged as the successor
   opening state. Do not add all historical Boost payments as an opening
   windfall, reseed the V5 bootstrap, or recompute already committed H-1 rows.
4. From activation, apply only the declared new rules to new confirmed
   records. The first H-1 read uses the unchanged declaration-block closing
   value. A reorg recomputes state against canonical hashes without inventing
   authority from removed declaration evidence.
5. Keep every currently valid frozen WORK listing's exact amount, face, price,
   and settlement rights. A post-activation seal or buy does not reprice it.
   Existing pre-V8 relics remain relics; this change grants no new rights to
   old invalid or closed listings. Frozen INCB issuance also remains unchanged.
6. Publish the same versioned state across raw replay, indexer, ledger, Growth,
   WORK, AMO, Log, and dependent summaries. Activate production behavior only
   after the separately approved rollout proves migration, parity, exact-tip
   readiness, declaration evidence, and rollback/pause behavior together.

## Required Evidence Before Accounting Approval

- Replay fixtures for every supported Boost opcode, zero-signal originals,
  required follow payments, same-address roles, hidden posts, malformed
  carriers, unauthorized actors, missing registry history, and invalid sales.
- Boost-only and mixed Boost/Mail/Files/WORK transactions in both carrier
  orders; repeated event projections; multiple records sharing an output;
  aggregate WORK fee outputs; seller price plus ticket refund; change and
  overpayment; and fee counted once across all valid components.
- Exact-unit cases at safe-integer boundaries, Q8 historical WORK and Q16
  current WORK, tiny quantities, fixed-value deltas, live/frozen reconciliation,
  and deterministic ordering within one transaction and block.
- Replay around `D - 1`, `D`, `D + 1`, and later blocks, including a listing
  before cutover and settlement after it, an INCB H-1 attachment, reorgs,
  interrupted migration, and missing declaration or seed evidence.
- Complete full-node/indexer membership and output-claim parity, identical
  Growth/WORK values and snapshot provenance, narrow Log inspection of every
  contributing record, and refusal to publish partial totals as canonical.

Open design decisions remain the final declaration/authority mechanism,
shared-output precedence and overpayment policy, exact supported Boost
validation versions, summary/migration commitments, and operational activation
gates. The approved local metrics/forecast integration does not settle or
activate these decisions.
