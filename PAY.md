# ProofOfWork Pay

Pay publishes immutable invoices and links their exact settlement to confirmed
ProofOfWork transactions. The standalone product is `pay.proofofwork.me`; Computer
embeds the same workspace at `/?folder=pay`. Public inspection needs no wallet.
Publishing, paying and cancelling require explicit local wallet review.

This is the version-one implementation contract. Production admission remains
closed until the activation pins, complete discovery, readers, local signer and
whole-Computer release have been qualified together. Source implementation or
an available hostname alone does not establish production readiness.

## Product boundary

An issuer publishes a title, description, fixed mainnet receiving address,
exact amount in proofs or canonical WORK, and an optional source transaction
reference. The invoice transaction ID is its permanent identity. The receiving
address does not follow a later ID transfer or receiver change. Any ID used while
preparing a request must resolve to a confirmed address before review.

A payer publishes an explicit reference to that invoice in the transaction
which makes the payment. The first valid, confirmed exact settlement marks the
invoice Paid. Its receipt is a derived view of the original invoice and payment;
it is not a third transaction, separate asset, second economic event, or issuer
claim that money arrived. Ordinary transfers without the invoice reference do
not implicitly settle an invoice.

The payer must differ from the fixed recipient. A self-send remains visible as
transaction evidence but cannot establish an invoice settlement. This check
does not claim that two different addresses belong to independent people.

An issuer can cancel an unpaid invoice. Terms are never edited in place: issue a
new invoice when terms change. Confirmed cancellations and additional, duplicate,
underpaid, overpaid or otherwise rejected attempts remain inspectable. A payment
can move real funds even when it cannot settle an invoice. Cancellation cannot
reverse a transfer, and Pay cannot prevent someone sending funds a second time.
The wallet checks fresh state before signing and broadcast to avoid known repeats.

Pay is direct payment, without escrow, automatic collection, arbitration, or a
new registry fee. Payment proves settlement under the invoice rules, not delivery,
objective quality or independence of the counterparties. Keep private customer
details outside permanent public invoice data. Drafts and recovery receipts are
browser-local convenience state, not chain authority.

## Version-one Mail schema

Pay uses one ordinary `pwm1:m:` body containing:

```text
pwpay1:<action>:<canonical-json-base64url>
```

This is an additive body schema, not a new OP_RETURN carrier family. A Pay
transaction contains exactly one body and at most one ordinary Mail subject.
Reply and attachment carriers, multipart bodies and WORK batches do not acquire
Pay authority. Optional work references belong in the invoice body instead.
Unrelated ordinary Mail replies, attachments, batch transfers and their
historical accounting retain their existing meaning.

| Action | Exact metadata key order | Authority |
| --- | --- | --- |
| `invoice` | `v,title,description,recipient,amount,reference` | Issuing wallet |
| `pay` | `v,invoice` | Paying wallet |
| `cancel` | `v,invoice,reason` | Original issuing wallet |

`v` is exactly `1`. `invoice` and non-null `reference` are lowercase 64-hex
transaction IDs. `reference` is null when omitted by the person; it is always a
field on the wire. A source reference identifies earlier confirmed evidence;
it does not claim that its bytes were inspected, accepted as delivered work, or
made executable. Referenced content is verified independently when opened.

`amount` is one of these closed objects, in the exact key order shown:

```json
{"asset":"proofs","amountSats":"546"}
{"asset":"WORK","token":"d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8","amountSubatoms":"10000000000000000"}
```

Proof amounts are exact integers from 546 through 2,100,000,000,000,000. WORK
amounts are positive integer Q16 subatoms, bounded by the canonical maximum
supply. One WORK is exactly 10,000,000,000,000,000 subatoms. No displayed USD
price, floor conversion, floating-point quantity or rounded label changes the
signed amount. The existing WORK protocol owns transfer admission and balances.

Canonical serialization requires exact UTF-8 JSON, key order, unpadded base64url
and field types. Duplicate/extra keys, alternate encodings, malformed Unicode
and out-of-budget records are rejected. The shared protocol module is the
executable source for byte limits and canonical parsing. The aggregate existing
100,000-byte transaction OP_RETURN script budget remains unchanged.
The title is nonempty, at most 200 UTF-8 bytes, without control characters or
surrounding whitespace. Description is at most 10,000 UTF-8 bytes; cancellation
reason is nonempty and at most 1,000. Total metadata is at most 16,000 bytes.

## Signatures, payments and settlement

All transaction inputs must establish one author. Version one supports the
independently verified mainnet P2PKH author path used by Permission. Every owner
input must have a cryptographically verified signature committing all outputs.
The local writer requests `SIGHASH_ALL` and verifies the final signed bytes,
TXID, destinations, amounts, records, funding and signature commitments before
broadcast. Unsupported wallets or weak signatures never grant authority.
Recipients may use supported standard mainnet addresses.

| Action | Required payment |
| --- | --- |
| Invoice | At least 546 proofs explicitly returned to the issuer before Mail |
| Cancel | At least 546 proofs explicitly returned to the original issuer before Mail |
| Pay a proof invoice | Exact invoiced proof amount to its fixed recipient before Mail |
| Pay a WORK invoice | At least 546 proofs as separate Mail signal to the recipient, plus the exact WORK transfer and existing 546-proof WORK registry fee |

Self-payment principal returns to the signer; miner fees remain spent. The
invoice's requested amount is not funded or reserved when it is issued. A WORK
payment uses the canonical same-transaction `pwt1:send3`, with the existing
registry output after Mail and before the transfer carrier. The Mail signal,
WORK quantity, registry payment and miner fee are individually reviewable.

Decoded WORK text is insufficient. Paid requires exact accepted canonical WORK
transfer evidence bound to the same raw transaction, recipient, amount, physical
position and sealed replay witness. Missing evidence makes settlement unavailable;
it must never produce a false unpaid balance or an invented receipt.

References must be confirmed in an earlier block. Replay orders events by exact
block height, transaction position, protocol output and record ordinal. A valid
payment settles only an open invoice. Cancellation requires the original issuer
and an open invoice. Later attempts retain their transaction and rejection or
additional-payment evidence. Paid totals count each accepted invoice settlement
once, with proof amounts and WORK quantities kept separate.

## Discovery, status and reconstruction

An explicit activation height and independently verified predecessor hash are
pinned together in the shared module. Version one opens at **975856**, bound
to Core-verified predecessor **975855** /
`00000000000000000002104a6f2c1984df28fd344cc34453d91da639f03cbd13`.
The predecessor was checked through `getblockchaininfo`, `getblockhash` and
`getblockheader`; runtime reads must rebind it to the current canonical chain.
Zero/empty pins disable admission. Earlier
Pay-shaped Mail stays replayable historical Mail without retroactive authority.
The independent raw-block scan must cover every candidate, including malformed
ones, from activation through a hash-bound checkpoint. A recent event page,
Search result or partial address history cannot establish complete invoices.

The worker advances the discovery witness contiguously. Reorganizations rewind
to the verified common ancestor and rebuild from surviving canonical history.
The public API must prove discovery, canonical Mail closure, positions, author
signatures and required WORK evidence at a coherent checkpoint. Incomplete or
conflicting coverage is Unavailable, never a verified empty list or zero total.

Confirmed invoice states are Open, Paid and Cancelled. Pending transactions are
best-effort visibility; they do not issue canonical invoices, settle payments or
cancel requests. Dropped, rejected and orphaned attempts retain their evidence.
Transaction recovery preserves uncertain signed TXIDs before broadcast and blocks
unsafe repetition until current first-party status resolves the outcome.

Public read routes are:

```text
GET /api/v1/pay-invoices?network=livenet&q=...&status=...&address=...&limit=...&cursor=...
GET /api/v1/pay-invoice?network=livenet&invoice=<invoice-txid>
```

Responses include complete discovery and checkpoint provenance. Snapshot cursors
cannot be silently combined across changed histories. The detail receipt binds
the exact original invoice, paying transaction, author, recipient, currency and
quantity. An independently operated Computer can reconstruct that state using
the same protocol rules and chain data. Links and locally generated QR codes are
navigation conveniences, not alternative payment authority.

## Whole-Computer accounting and release

Pay records remain ordinary Mail and, where applicable, canonical WORK transfers.
Log, Search, notifications, Wallet and Growth must expose the same source event
and qualification. Invoice face values and derived receipts add no network value;
underlying confirmed Mail/WORK economics are counted under their existing rules
once. Existing Jobs, credit and sale-ticket settlement rules are unchanged.

`POW_PAY_WRITES_ENABLED` is a separate default-closed production gate. Complete
reader coverage alone does not open it. Qualify the shared protocol, raw-block
discovery, canonical replay, invalid/duplicate/pending/reorg behavior, signing
and recovery, APIs, Search, Log, Wallet, notifications, Growth, standalone Pay
and embedded Computer before opening writes. Preserve all accepted node runtime
overlays and linked-publishing source identity through the scoped controller.

Activation must hold Search through its pinned hold controller before capturing
service state. Restore Search only after actual gate completion or independently
verified disabled recovery with the application services restored; an uncertain
outcome keeps the hold for supervised recovery. A stale checkpoint requires a
new actual preactivation check, never an edited result. The Pay adapter compares
`Requires` and `PartOf` by exact unit membership while retaining all ordered
configuration checks. This operational correction changes no invoice, settlement,
wallet-signing or accounting rule. See the [activation procedure](deploy/pay/README.md#independent-pay-write-switch).

Extend the managed UI surface contract additively while retaining historical
release verification. The release ends only after exact GitHub/main/preview/
production source synchronization and the mandatory live coherence check.
