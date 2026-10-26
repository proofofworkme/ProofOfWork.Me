# WORK Batch Sends V1

Status: implemented as an additive protocol with official writes disabled by
default. The source records the exact bootstrap declaration compatibility below.
Deployment alone does not activate batch sends. The wallet
and broadcast API refuse preparation/admission until exact declaration evidence,
Q16 replay, relational parity, the current chain checkpoint, existing WORK write
admission and the independent batch write switch are ready.

## User behavior

Wallet **Send to many** accepts 2–256 confirmed ProofOfWork IDs or livenet
addresses, separated by commas, semicolons or newlines, and a WORK amount for each.
The review lists every resolved address and the exact total. IDs are resolved
again before signing and broadcast; a changed receiver requires a fresh review.
The 78-wallet distribution fits in one transaction, subject to the existing
carrier byte limit and available funds.

A batch pays the WORK registry **546 proofs once**, plus the transaction's
miner fee. It does not create a proof payment to each recipient. The sender
must have the full WORK total available after existing reservations, and enough
proofs for the registry payment and miner fee. The miner fee grows with encoded
transaction size.

The entire batch succeeds or fails. The wallet signs locally, verifies all
output commitments and saves a recovery receipt containing the transaction ID
and reviewed fields before further asynchronous checks. The receipt does not
contain the signed transaction bytes. Unknown or pending batch receipts protect the
wallet's WORK capacity until first-party transaction status resolves them.

## Canonical wire and authority

The sole protocol record is:

```text
pwt1:batch1:<WORK token id>:<unpadded canonical base64url UTF-8 JSON>
```

The JSON is exactly an ordered array of two-item arrays:

```json
[["recipientAddress","positiveQ16IntegerString"],["anotherAddress","positiveQ16IntegerString"]]
```

The token is
`d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`.
One WORK is 10^16 subatoms. Quantities and their sum are positive canonical
base-ten integer strings, with no exponent, sign, leading zero or floating
point conversion, bounded by 21,000,000 × 10^16. Addresses must pass livenet
checksum validation; Bech32 is lowercase and Base58 case is exact. Duplicate
recipient addresses invalidate the batch.

Limits are 2–256 recipients, 65,536 payload UTF-8 bytes, and the existing
100,000-byte aggregate OP_RETURN script limit. Exactly one zero-valued
OP_RETURN is allowed. Exactly one output to the WORK registry
`1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV` must pay exactly 546 proofs before
the carrier; every remaining spendable output is sender change.

Every input must resolve to the same sender. Canonical raw transaction bytes,
actual prevout values/scripts and every supported input signature must be
verified. Each signature commits every output using SIGHASH_ALL or Taproot
SIGHASH_DEFAULT. ANYONECANPAY, unknown prevouts, mixed senders and unsupported
authority fail closed.

## Atomic state and accounting

Validate the entire vector, authority, shape, payment and opening spendable
balance before mutation. Debit the declared sum once, then credit all recipients
once. A self-recipient still requires opening capacity for its declared amount;
its credit restores that amount to the sender.

There is one primary `token-transfer-batch` event and one 546-proof economic
contribution. The existing transaction-final rule charges the miner fee once.
For non-self recipient sum A and opening network value N in Q8:

```text
frozen movement value Q8 = floor(A × N / (21,000,000 × 10^16))
```

Multiply before dividing and round down once. Recipient order never reprices
later recipients. Self transfers add no movement value. Existing live movement
rules revalue this one aggregate; the frozen value and recipient amounts do not
change.

Recipient `token-transfer` rows are derived history projections, with
`transferVersion: "batch1"`, exact Q16 amount, recipient index, parent position,
payload commitment and canonical lineage. They own zero registry payment,
zero miner fee and no independent economic movement. Projection readers and
balance rebuilds require the complete parent-bound recipient set; orphaned,
duplicate or inconsistent children cannot become balances.

Confirmed history remains authoritative. Pending replay applies the entire
batch to one private state copy in the existing deterministic order and never
mutates confirmed balances. Missing evidence is unavailable, not proof that a
transaction is invalid.

## Additive boundary

Historical `send`, `send2`, `send3`, sale tickets, reservations, supply,
Q16 precision and bond rules are preserved. Before activation even batch-looking
records keep their historical invalid replay result. Batch transfers cannot
serve as Mail, Boost, Jobs or bond attachments. Mail retains its current
recipient limit and per-transfer payment behavior.

The exact declaration text is generated by
`node scripts/build-work-batch-declaration.mjs`; the generator prints the text
and reports text/protocol byte counts and SHA-256 commitments. Its trailing
display newline is excluded from the declaration and commitments. The canonical
carrier is exactly `pwm1:m:` followed by the declaration text. The source of those
exact bytes is `server/work-batch-declaration.mjs`. Do not edit a declared text
retrospectively.

The earliest exact valid declaration confirmed at or after block **972965** is
authoritative. This fixed lower bound is part of the exact declaration;
earlier history is deterministically prebatch. Input zero spends the
existing declaration-authority script; the declaration pays at least 546 proofs
to the registry in one unambiguous output before its unique exact carrier.
The declaration's txid, canonical block hash, height, transaction index,
registry output, protocol output and record ordinal must all be verified.
Batch activation begins at D+1, never in the declaration's block. The declaration
text is 5,958 UTF-8 bytes with SHA-256
`c6ba8368dfec5312770946b358ce93040f4a27f8b1f6b970f99dee7962dbd793`;
the complete carrier is 5,965 bytes with SHA-256
`f1527f240dcc7210ef7bb5ebd33417fbecb1c8ea8dcc1b2bf2917f42b7e20ae4`.
These replace the earlier unpublished commitments; regenerate from the released
source and exclude the generator's display newline when reviewing exact bytes.

## Exact bootstrap compatibility

On 2026-10-25 the authority owner explicitly authorized use of the original
already-broadcast declaration transaction
`b7c620e48c2d725a143cecd7f7808036d89907124d410ba57d272d34e650cc28`,
including its intentional proof payment and WORK self-transfer. Its unique
546-proof registry payment is at vout **2**, after the exact declaration carrier
at vout **1**, record ordinal **0**. The implementation accepts only this exact
transaction/position tuple as an exception to the declaration payment-order
clause. Every other declaration still requires its registry payment before its
carrier. The existing batch-send payment-order rule is unchanged.

The published `declarationEvidenceRule` says "before". This is an explicit,
user-authorized bootstrap compatibility exception to that clause; it is not a
claim that the published wording already allowed this shape. The declaration
text, 5,958/5,965-byte commitments and hashes above remain unchanged. Raw txid,
input-zero authority, unique qualifying registry payment, exact unique carrier,
canonical confirmation and position, earliest valid declaration selection and
D+1 activation are still independently verified. The attached `send3` retains
its existing replay and accounting; the exception creates no transfer or second
registry-fee accounting event and does not make attachments valid for batch sends.

This exception is not activation evidence. Do not invent a confirmation height,
write pins or activation marker. If D+1 was already sealed without this context,
ordinary restart cannot establish the missing activation: use a separately
reviewed canonical replay procedure before enabling writes. The bounded repair
also preserves existing `buy5` purchases and their derived listing closures:
economic results and relational history stay exact while explicitly identified
chain references and dependent commitments are recomputed. See the
[repair contract](deploy/work-batch-replay/README.md) for its supported scope,
immutable originals and validation gates. Existing marker-loss, projection parity,
exact-tip readiness and independent write-switch gates remain.

## Activation and release handoff

1. Finish source review, replay/persistence and wallet tests, repository hygiene
   and the ordinary release synchronization checks. Keep batch writes disabled.
   Deploy and verify automatic read discovery before declaration publication.
2. The authority wallet owner reviews the exact generated declaration and its
   commitments, then signs and broadcasts locally. An agent never handles keys
   or signs on the owner's behalf. Preserve the exact carrier text without
   subject, CC, reply or attachment wrappers. Additional proofs and independent
   WORK transfers can carry signal when their records preserve the declaration
   authority, exact carrier and required registry payment. Ordinary declarations
   retain the payment-before-carrier rule; the exact bootstrap exception above
   recognizes the original transaction. Compare the prepared review's exact
   carrier and output positions before the owner continues to the wallet. Canonical
   indexing continues while the declaration awaits confirmation; there is no
   confirmation-time indexing hold.
3. Once the declaration confirms in block D at or after 972965, sequential
   indexing discovers the earliest valid declaration from the complete sealed
   canonical prefix through D before preparing D+1. Core independently verifies
   transaction bytes, actual prevouts, canonical block membership, exact carrier
   and payment. Discovery uses the committed H−1 prefix during catch-up, even
   when Core is ahead of the indexer. It does not require a current-tip global
   scan. Canonical replay completes the finite prefix in bounded pages with
   event-loop yields inside the same call; a fresh verifier process never needs
   an inherited cursor to get past 64 candidates. Public status checks may report
   bounded discovery in progress. Unavailable candidate evidence is retried and
   never skipped. Only independently Core-verified
   canonical prefix extensions may reuse earlier negative discovery progress.
4. The D+1 transition binds the verified declaration and atomically persists its
   activation marker. This read activation needs no operator pins or write
   switch. No-pin operation always keeps official batch writes disabled, even
   if an environment contains `WORK_BATCH_WRITES_ENABLED=1`.
5. Independently verify the confirmed declaration's exact pins and D+1 marker,
   the declaration/evidence commitments in D+1 and current-tip transitions,
   parent/child projections, balances, reservations, one-payment accounting,
   relational parity and existing WORK readiness at the same current Core tip.
   Install the verified explicit pins only in the API's dedicated activation
   drop-in, with batch writes disabled, using the separately reviewed scoped
   activation controller. The canonical worker retains automatic chain-based
   read discovery with no batch environment pins. Preserve existing runtime
   overlays, worker configuration and private settings.
6. Enable the independent write switch only after those checks pass. Verify
   the uncached status endpoint reports active, write-enabled and ready at the
   exact current tip, then verify the wallet and production API. Publish the
   activation announcement only after actual verification.

Normal sequential discovery avoids a global maintenance outage while waiting for
confirmation. Missing Core evidence, incomplete sealed coverage, bounded
in-progress discovery or a reorg can still pause replay and make exact-tip
readiness and existing WORK admission unavailable until verification catches up.
Keep those gates closed; never treat unavailable evidence as an absent declaration
or bypass readiness. Any later scoped configuration restart has its own reviewed
maintenance window, separate from declaration confirmation.

If D+1 has already been committed without batch context, refuse an ordinary
restart or pin-only activation. Existing canonical transition rows are immutable,
and the first activation marker belongs to D+1. Keep batch writes disabled and
require a separately reviewed canonical replay procedure with exact checkpoint,
transition and marker evidence before proceeding. Do not assume restarting the
worker, replaying only the current block, or manually inserting a marker repairs
that boundary.

Environment controls:

- `WORK_BATCH_DECLARATION_TXID`
- `WORK_BATCH_DECLARATION_HEIGHT`
- `WORK_BATCH_DECLARATION_BLOCK_HASH`
- `WORK_BATCH_DECLARATION_BLOCK_INDEX`
- `WORK_BATCH_DECLARATION_PROTOCOL_VOUT`
- `WORK_BATCH_DECLARATION_RECORD_ORDINAL` (zero)
- `WORK_BATCH_DECLARATION_REGISTRY_PAYMENT_VOUT`
- `WORK_BATCH_ACTIVATION_HEIGHT` (D+1)
- `WORK_BATCH_WRITES_ENABLED=1` (every other value disables writes)

Absent operator pins allow automatic canonical read discovery but never official
batch writes. Malformed requested pins, pins conflicting with a valid activation
marker, and pins that do not identify the earliest valid declaration fail closed.
The write switch is independent of confirmed replay; turning writes off does not
erase accepted batch history. Keep verified pins in runtime configuration when
disabling writes. If environment pins are later lost, confirmed reads recover the
era from the canonical D+1 marker and reverify Core evidence; official writes
remain closed until explicit pins are restored. Marker lookup and its sealed
history guard run before automatic discovery. A malformed marker, missing marker
after established batch history, or missing canonical activation transition is
unavailable, never permission to recreate the marker or replay accepted batches
under preactivation rules.

Before declaration publication, the dormant staged code can be rolled back while
no eligible declaration or batch era exists. After activation, rollback means
disabling batch writes while preserving batch-aware replay code, verified pins
and the activation marker. Do not restore pre-batch code that would reinterpret
accepted canonical batches as invalid history. A published declaration whose
confirmation is uncertain requires evidence review before any code rollback.

`GET /api/v1/work-batch-status` is an uncached first-party preparation gate.
It returns activation, write/readiness flags, exact checked tip, declaration
identity, limits and the 546-proof registry payment. A boolean from a browser,
test fixture or environment variable cannot establish chain authority.

## Stored recipient evidence and display metadata

Qualify the original stored parent and recipient payloads before applying display
normalization. The strict accepted-parent comparison includes stored metadata such
as `indexedFrom`; stripping that field from only one side falsely rejects an
otherwise valid batch. Keep full sibling, carrier, descriptor and canonical-seal
checks intact, then normalize verified payloads for presentation.

The confirmed batch `b25e6ae7f963af289ba8cb3edae76ef285d3d124204a0e4cd514df0933938322`
at block 973284 exposed this caller-order regression: its one parent and twelve
recipients passed unchanged validation, while pre-validation metadata removal
blocked summary publication. This is a read-path correction; it does not change
the transaction, accepted balances, declaration, replay rules or sealed history.

Summary and growth readers must also preserve the distinction between the parent
and its derived recipients. Build economic transfer input from legacy transfers
and accepted batch parents; exclude batch children from independent valuation.
A parent contributes its one registry payment and transaction miner fee, and
uses `movementAmountSubatoms` for the aggregate non-self movement at its original
canonical position. A self-recipient contributes no movement. Recipient history
and balances retain their exact individual amounts,
with zero independent fees and movement value.

The same confirmed transaction exposed a second summary integration defect:
the parent payment fell into `computerEventFlowSats`, while recipient rows were
revalued independently. The strict closing-state reconciliation refused the
extra 546 proofs. Correct summary input and activity classification rather than
relaxing that guard or rewriting accepted transitions. Scoped token state,
activity projection, source fingerprints and historical movement reconstruction
must all retain the accepted parent. A failed read-path release is recovered
forward with its exact installed-source and custody evidence; it is not a reason
to restore the known-broken reader or resend the transaction.
