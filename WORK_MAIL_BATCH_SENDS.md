# WORK Mail Attachments V1

Status: implemented for a forward declaration and deployment; official writes
remain disabled until the exact declaration, canonical replay and independent
write gate are ready. This extension does not alter the signed standalone
`batch1` declaration or its confirmed activation history.

## Sending and fees

Ordinary Mail in standalone Mail and Computer accepts up to 256 distinct
resolved recipients across To and CC. Addresses and confirmed ID destinations
are deduplicated in the same order for the preview, proof payments, WORK vector
and local transaction review. Bech32 case is canonicalized; Base58 case remains
exact. ID destinations are resolved again before signing and broadcast.

Once Mail batch admission is ready, each ordinary Mail WORK attachment uses one
`pwt1:mailbatch1` carrier and one dedicated **546-proof WORK registry payment**,
for 1–256 recipients. The amount entered is per recipient; the review shows the
full WORK total, every destination, ordinary recipient proof payments, the
registry payment and miner fee. All 78 wallets fit within the recipient limit,
subject to the existing transaction byte budget and available funds.

Ordinary Mail still pays proofs to each recipient. For example, 78 recipients
at 546 proofs each cost 42,588 recipient proofs plus the single 546-proof WORK
registry payment: 43,134 proofs before the miner fee. The WORK registry fee does
not replace Mail delivery payments.

Before the new era, a verified inactive status preserves legacy Mail WORK
attachments for at most ten recipients, with 546 registry proofs per recipient.
Unknown, incomplete or active-but-unready status fails closed and never selects
that fallback. Boost, Jobs and bond attachments keep their existing rules.

The wallet signs locally and requires supported signatures committing every
input and output. It stores a recovery receipt before asynchronous rechecks;
unknown signed outcomes reserve the whole batch's WORK capacity. Derived
recipient rows are not independent pending sends or separate spend authority.

## Canonical transaction

The wire record is:

```text
pwt1:mailbatch1:<canonical WORK token id>:<canonical unpadded base64url UTF-8 JSON>
```

The JSON is an ordered array of `[recipientAddress, positiveQ16SubatomsString]`
tuples. Quantities and their sum are exact positive integers bounded by the WORK
supply; one WORK is 10^16 subatoms. The vector has 1–256 distinct checksum-valid
livenet addresses, and the payload is at most 65,536 UTF-8 bytes. Alternate JSON
encodings, duplicate addresses, mixed-case Bech32 and noncanonical quantities
invalidate the entire WORK attachment.

Output order is exact:

1. One positive ordinary Mail proof payment per WORK recipient, in vector order.
2. The complete contiguous ordinary PWM envelope, containing only body, subject,
   reply and file parts (`m/s/r/a`), with at least one body, at most one subject
   and one reply, and a complete file when attached.
3. One dedicated output of exactly 546 proofs to the WORK registry.
4. The sole `mailbatch1` carrier.
5. Optional positive sender change.

All carriers have zero value and the existing aggregate 100,000-byte OP_RETURN
script ceiling applies. Other governed or malformed carriers are invalid.
A recipient can be the registry address: its ordinary Mail payment precedes the
envelope; the dedicated WORK fee follows it. All input authority and output
commitments are verified from canonical raw bytes and actual prevouts.

The sender must cover the whole WORK sum after reservations, including any self
recipient. Validation precedes all balance changes: debit the sum once and
credit every recipient atomically. An invalid WORK attachment does not erase
otherwise valid ordinary Mail. The one accepted WORK parent owns the registry
payment and aggregate non-self movement value. Movement is rounded once from
the opening Q8 network value. Its recipient children own zero registry payment,
miner fee or second movement value. The transaction miner fee remains counted
once under the existing transaction-final rule.

Mail history accepts children only with the complete accepted parent, every
sibling, exact ordinary Mail record, signed transaction shape and canonical
sealed transition. A child payload cannot assert attachment authority alone.

## Canonical summary and recovery

The physical recipient rows retain exact amounts, order, positions and the sealed
Mail envelope. Canonical readers validate the complete parent, every child and
the original PWM/PWT witnesses before projecting any recipient. The reader's
owned row/payload binding is also required before normalized transaction fees
can become zero on a derived recipient; copied or changed rows do not inherit
that qualification.

The summary retains every physical child and values the accepted economic parent
once. Batch1-only summaries retain
`canonical-work-batch-transfer-value-projection-v1` unchanged. A summary containing
a confirmed `mailbatch1` parent uses the explicit expanded
`canonical-work-batch-transfer-value-projection-v2` model. Its worker independently
verifies the version-specific wire commitment, exact recipient/payment vector,
Mail envelope commitment, full canonical positions, parent/child chain bindings,
and fee/value equations before accepting zero-economic children. An unknown or
mismatched version is unavailable, never a legacy fallback.

A sole-self Mail attachment still validates and reserves the entire positive
WORK quantity, then restores that balance atomically. Its non-self movement is
zero, so no zero entry is appended to the positive-only movement ledger. The
one WORK registry payment, ordinary Mail payment and transaction miner fee remain
accounted for. This exception is limited to a fully verified Mail family;
ordinary transfers and standalone `batch1` retain their existing rules.

Focused regressions exercise signed raw transactions through sealed-family
validation, canonical fee enrichment, actual reader constructors, credit replay,
summary production and the worker publication predicate for 1, 78 and 256
recipients, sole-self and mixed-self transfers. They reject incomplete families,
wrong versions, envelope/payment/position changes and duplicated child fees.
A release rehearsal must also pass the actual worker accounting predicate;
generating the eight summaries alone is insufficient.

## Declaration and activation

`npm run build:work-mail-batch-declaration` prints the exact declaration text and
its separate text/carrier commitments. The authority remains
`1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv`. The exact earliest valid declaration at or
after block 973283 activates at D+1. Its unique qualifying registry payment may
precede or follow the unique exact carrier; attached ordinary proofs and legacy
WORK signal are expressly permitted. Keys and signing stay local.

The worker discovers authority from the complete sealed H−1 prefix, independently
of configured pins or writes. No `workMailBatchV1` key is included in earlier
transition commitments. D+1 atomically persists
`work-mail-batch-v1:activation:livenet`; loss or disagreement of that marker
cannot erase established authority or authorize later reconstruction.

`/api/v1/work-mail-batch-status` is uncached. Official preparation and broadcast
require exact declaration evidence, earliest selection, Q16 readiness, exact-tip
Mail-aware replay, global WORK admission and the independent Mail write switch.
`WORK_MAIL_BATCH_DECLARATION_*`, `WORK_MAIL_BATCH_ACTIVATION_HEIGHT` and
`WORK_MAIL_BATCH_WRITES_ENABLED` are separate from the original batch controls.
Disabling writes preserves confirmed reads and history.

Install read support before publishing the declaration using the scoped
[Mail batch release controller](deploy/mail-work-batch/README.md). Its
pre-declaration guard refuses installation if an eligible declaration already
exists. No historical replay or resealing is part of this forward release.
Preserve accepted runtime overlays and standalone batch activation throughout.
