# ProofOfWork AMO

This historical filename is retained because repository automation and earlier
protocol documentation link to it. The current product name is AMO:
Autonomous Money Organization.

## Product Boundaries

- `id.proofofwork.me` is registration-only.
- `computer.proofofwork.me` contains the authenticated AMO workspace.
- `amo.proofofwork.me` is the canonical standalone AMO app.
- `marketplace.proofofwork.me` is a compatibility hostname for the same app.

AMO is organized by asset tabs. IDs, Credits, POWB, and INCB are live trading
classes. These asset classes use sale-ticket settlement so the buyer path spends
a scarce UTXO, pays the seller, pays the registry mutation fee, and writes a
chain-readable transfer/purchase event.
- `log.proofofwork.me` is the public read-only ProofOfWork Computer log for tx-backed app actions.
- The IDs workspace is for registration, receiver updates, and direct owner transfers only.
- AMO is for on-chain listings, seals, delistings, buyer-funded purchases, credit sales, and future asset trades.
- AMO actions with txids should be visible in Log, including listing tx, seal tx, delisting tx, buyer-funded transfer/buy tx, credit sale tx, and sale-ticket UTXO references.
- AMO attention metrics should be derived from valid chain events: active listings, ID sale count, credit sale count, seller-price sale volume, credit sale volume, and mutation-fee flow.
- POWB and INCB market actions use the same credit sale-ticket machinery under their reserved synthetic assets. POWB supply comes directly from confirmed `pwm1:m:powb` recipient proof payments. INCB valuation and issuance amount come from direct bond proofs plus attached WORK valued by the send-time oracle: the last confirmed green canonical live WORK summary at H-1, hash-bound to the exact previous block. Every transaction in the bond block is excluded. Confirmation fixes the resulting balance and supply. Neither asset can be issued by `pwt1:mint`.

## Current ID AMO Model

The live AMO writes on-chain listing-book events to the same canonical
ProofOfWork ID registry address.

Current events:

```text
pwid1:list5:<sale-ticket-json-base64url>
pwid1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwid1:delist5:<listing-txid>
pwid1:buy5:<listing-txid>:<new-owner-address>:<new-receive-address?>
```

Each listing mutation pays the 546-proof registry mutation fee. The confirmed chain is canonical; pending events are only best-effort mempool visibility.

The current flow:

1. The current ID owner chooses an owned confirmed ID.
2. The owner enters sale terms with price, optional buyer lock, optional receive-address lock, nonce, and optional expiry.
3. The app publishes `pwid1:list5` and creates a 546-proof seller-controlled sale-ticket UTXO in the listing transaction.
4. After the listing txid exists, the seller publishes `pwid1:seal5` with a `SIGHASH_SINGLE|ANYONECANPAY` signature for the sale ticket.
5. A buyer funds one `pwid1:buy5` transaction that spends the sale ticket, pays the seller price plus ticket value, pays the 546-proof registry mutation fee, and writes the ID transfer event.
6. The resolver accepts the purchase only if the listing is active and sealed, the seller is still the current owner, the sale ticket is spent, seller payment is sufficient, and buyer/receiver constraints match.

The sale ticket is the scarce settlement point. Competing buyers must spend the same outpoint, so only one purchase can confirm. A vandal cannot consume the ticket without paying the seller the required price plus the ticket value.

## Sales Metrics

AMO reports realized ID sale data from resolver-accepted buyer-funded
transfers.

- Public sale count starts with the live AMO sale-ticket book and increments for valid `buy5` purchases.
- Historical valid `buy2`/`buy3`/`buy4` purchases remain replayable protocol history, but they are not counted in the public AMO sales metric.
- Sale volume is the seller price in proofs, excluding the 546-proof registry mutation fee and excluding sale-ticket refunds.
- AMO flow for Growth and WORK floor accounting is seller sale volume plus market mutation fees from listing, seal, delisting, and buy events.
- Seller sale volume remains a separate public metric. Do not fold mutation fees into seller volume, and do not count market mutation fees again as generic Computer event flow.
- WORK credit sales add more than seller price. For canonical WORK only, the amount of WORK moved also contributes credit movement network value: frozen value at the live WORK floor when the sale confirms, and live value at the current live WORK floor thereafter. Negative or positive buyer arb is spread information only; it does not redefine the network floor.
- Non-WORK credit sales do not inherit WORK's movement-value lane. They contribute their confirmed sale payments, registry/mutation fees, and AMO flow, but their own listing floors are not network value because illiquid listings can be manipulated.
- Confirmed sales are canonical.
- Pending sales are mempool-visible only until confirmation.

## Current Credit AMO Model

The live credit AMO writes sale-ticket events to each credit's own
registry address.

Current events:

```text
pwt1:list5:<sale-ticket-json-base64url>
pwt1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwt1:delist5:<listing-txid>
pwt1:buy5:<listing-txid>:<buyer-address>
```

Each credit mutation pays the 546-proof credit registry mutation fee. Credit
creation still pays the macro credit index, but mints, transfers, listings,
seals, delistings, and buys pay the credit's own registry directly.

The current flow:

1. A credit holder chooses a confirmed balance.
2. The holder publishes `pwt1:list5`, which reserves spendable credit balance and creates a 546-proof seller-controlled sale-ticket UTXO.
3. After the listing txid exists, the seller publishes `pwt1:seal5` with a `SIGHASH_SINGLE|ANYONECANPAY` signature for the sale ticket.
4. A buyer funds one `pwt1:buy5` transaction that spends the sale ticket, pays the seller price plus ticket value, pays the 546-proof credit registry mutation fee, and writes the buy event.
5. The credit resolver accepts the purchase only if the listing is active and sealed, the seller still has spendable balance, the sale ticket is spent, seller payment is sufficient, and buyer constraints match.

Wallet and AMO both use this model. Wallet is the connected-address
ownership/action surface; AMO is the public discovery and purchase
surface.

## Historical WORK Marketplace Pricing Protocol V2

Canonical WORK marketplace pricing is governed by declaration transaction
`4c53252c6e9279726e1456f4d846274bfa33f778b633d32a68ed36906b38083f`.
The declaration activates only after confirmation. Its declaration block is
`D`; the first governed block is `D + 1`, ensuring the first valid H-1 oracle
already includes the declaration.

The confirmed livenet activation is pinned as follows:

```text
declarationHeight = 959061
declarationBlockHash = 000000000000000000022645eee1e171b271a92e6527728e85441efc88fa04a5
activationHeight = 959062
```

The sale-ticket lifecycle remains `list5` / `seal5` / `buy5` / `delist5`.
New governed WORK listings use authorization version `pwt-sale-v3`. Each list,
seal, and buy commits to:

```text
oracleModel = canonical-work-market-h-minus-one-v1
oracleBlockHeight = H - 1
oracleBlockHash = hash(H - 1)
oracleNetworkValueQ8 = exact live WORK network value at H - 1
amountAtoms = exact WORK atoms offered
minimumPriceSats = ceil(
  amountAtoms * oracleNetworkValueQ8
  / (21,000,000 * 100,000,000 * 100,000,000)
)
```

`priceSats` is the total seller price and must be at least
`minimumPriceSats`. Integer ceiling is mandatory: no fractional proof is
rounded down. The canonical verifier independently loads the last green
hash-bound ledger summary at H-1 and compares the committed height, hash,
exact Q8 value, amount, computed minimum, and seller payment.

The `pwt-sale-v3` listing and seal authorizations carry these fields directly.
A governed WORK `buy5` adds a fourth base64url segment containing the refreshed
V3 authorization. Oracle fields may refresh between list and seal/buy; all
economic terms and sale-ticket terms must remain identical.

Because the confirmation block cannot be known in advance, a V2 action is
next-block-bound. If a transaction misses the block immediately following its
committed oracle block, it becomes stale and is canonically invalid even if it
later confirms. The wallet must rebuild and re-sign against the new exact tip.
For a purchase, base-layer settlement is not conditional on this application
validation: the seller payment and sale-ticket spend can still confirm while a
stale WORK transfer is rejected. Buyer clients must warn about this risk and
recheck the exact oracle tip immediately before signing. The hard floor does
not create a standing buyer or guarantee liquidity.

After activation:

- legacy `pwt-sale-v1` and `pwt-sale-v2` WORK list/seal/buy actions cannot
  mutate canonical state;
- missing, stale, mismatched, below-floor, or unverifiable V3 actions fail
  closed and appear only as invalid audit events;
- old listings remain historical records but cannot execute under V2 unless
  replaced with current V3 terms;
- confirmed active V1/V2 listings at height 959061 move to the read-only V1
  Relic projection at activation, stop reserving WORK balance, and expose no
  seal or buy action; their sale-ticket outputs remain seller-controlled;
- non-WORK credits, POWB, and INCB retain their existing marketplace versions;
- pending transactions are visibility only and never establish an oracle or
  canonical market state.

The relational WORK V2 market projection is confirmed-only. A V3 list, seal,
sale, or close may update `credit_listings` only from its own valid confirmed
action event. Aggregate lifecycle rows cannot rewrite a different action's
event. Every table-backed V3 read independently requires the original listing
event, transaction, and canonical block; a sealed row additionally requires
its valid confirmed seal event, and a terminal row requires its valid
confirmed sale or close event. When a canonical block resolves a pending V3
action, the indexer removes the volatile pending event before storing the one
confirmed valid or invalid decision.

The production cutover migration runs with marketplace writers stopped and
locks the derived listing table. It fails closed if any preexisting V3 WORK
projection lacks its matching canonical list, seal, or close evidence, then
invalidates only the two pinned post-activation V2 events. The migration is
idempotent; an unsupported projection requires a supervised canonical rebuild
instead of being silently preserved or deleted.

The cutover refund audit is recorded in
`WORK_MARKET_V1_REFUNDS_959061.json`. Eligibility is limited to confirmed
active legacy WORK listings at height 959061. Each eligible listing receives
its listing miner fee; each eligible confirmed seal additionally receives its
seal miner fee and its 546-proof seal registry payment. Pending, invalid,
already sold, delisted, or otherwise closed listings are excluded. The
seller-controlled 546-proof sale-ticket output is not a refund expense. The
94-entry snapshot is the exact eligibility boundary: a historical V1/V2 row
that later resurfaces through reconciliation remains closed evidence and
cannot acquire `relic` or `refundEligible` status unless its listing id is in
that snapshot.

## Historical WORK Marketplace Pricing Protocol V4 Phase 1

V4 removes V2's next-block liveness hazard without weakening the canonical
execution floor. Governed WORK list, seal, and buy authorizations use
`pwt-sale-v4` with oracle model
`canonical-work-market-confirmation-floor-v1`. Each authorization commits an
exact hash-bound green canonical quote, including its height, block hash, live
network value Q8, `amountAtoms`, integer-ceiling `minimumPriceSats`, and total
`priceSats`.

For an action confirmed at block `H`, the signed quote must be from one of the
480 blocks immediately before `H`. A quote 480 blocks old is valid; a quote 481
blocks old is expired. The verifier independently loads both the committed
quote snapshot and the canonical summary at `H - 1`. The committed quote and
its minimum must match exactly, and the signed seller price must also meet the
integer-ceiling floor computed from the canonical live network value at
`H - 1`. Delayed confirmation therefore remains possible only while the signed
price still satisfies the confirmation-time floor.

Activation is declaration-gated. The declaration must be a confirmed
transaction whose first input belongs to
`1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv`, pays at least 546 proofs to
`1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV` before the protocol output, and carries
the exact V4 declaration memo. If its block is `D`, V4 begins at `D + 1`.
Phase 1 keeps `WORK_MARKETPLACE_WRITES_ENABLED=0`: WORK list, seal, and buy
broadcasts remain read-only until the declaration is confirmed, its txid,
height, and canonical block hash are pinned in production, activation is
reached, and writes are explicitly enabled. Delisting remains available.
Wallet signing stays local; no server or agent signs the declaration or a
market action.

V3 history remains immutable. At V4 activation, existing `pwt-sale-v3`
listings become read-only relics, stop reserving WORK balance, and expose no
seal or buy action. Their seller-controlled sale tickets may be delisted or
recovered, after which the WORK can be relisted under V4. A confirmed spend of
any sale-ticket outpoint still closes or retires that listing as canonical
outpoint state, even when an attempted buy fails application validation.
Missing, unavailable, hash-mismatched, inconsistent, expired-quote, or
below-confirmation-floor actions remain invalid audit history and do not mutate
canonical WORK balances, sales, Log, Growth, or network value.

V4 remains historical design and replay documentation. No new V4 action is
valid at or after AMO V5 activation.

## Current WORK AMO Unit Protocol V2 (`pwt-sale-v5`)

The corrective declaration is transaction
`54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36`.
It is canonical at block height `959620`, block transaction index `141`, block
hash
`0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811`,
block time `2026-07-26T00:17:29.000Z`, and activates at height `959621`.

The cutover has one exact evidence-bound pre-unit relic:

```text
model = canonical-work-amo-v5-pre-unit-relic-v1
listingId = 4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1
blockHeight = 959241
blockTransactionIndex = 2601
protocolVout = 1
recordOrdinal = 0
blockHash = 000000000000000000007933e0dc73604a52057ba18de7b9463b65d9433dd0fe
authorizationVersion = pwt-sale-v3
amountAtoms = 1600
priceSats = 1500479
saleTicketOutpoint = 4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1:2
```

After activation this listing is non-reserving, cannot be sealed or bought,
and appears once as a read-only closed relic attributed to the V5 declaration.
It is outside the height-959061 refund snapshot and therefore has
`refundEligible:false`. Its original confirmed row remains immutable replay
evidence.

This projection is not authorized by txid or height alone. The reader must
prove one exact valid listing event, its canonical transaction/block/position,
the identical stored and raw `pwt1` payload, exact authorization, 1,251 data
bytes, 3,890-proof miner fee, 546-proof registry payment, exact sale-ticket
output/script, the V1 and V5 declarations, and zero valid seals. The sale-ticket
outpoint is the terminal authority: one canonical spend retires the relic, and
a matching valid close may corroborate that spend. A close without that spend,
a pointer-only or pending spend, a duplicate, or any field mismatch fails
closed. Invalid events and spends of other outputs cannot close it.

Token state suppresses the legacy reservation even when this proof is
temporarily unavailable, but it never manufactures a relic from incomplete
evidence. Exact active-listing queries then return an authoritative terminal
empty result instead of falling back to a stale snapshot. Closed-listing and
market-log projection occurs inside the canonical relational set before
counting, ordering, cursoring, `LIMIT`, or `OFFSET`, so every page has the same
single evidence-bound history.

Height `959620` is the one immutable legacy H-1 bootstrap. Before activation
replay, the Computer captured one closed-shape
`canonical-work-amo-v5-h-minus-one-seed-evidence-v1` ledger row containing the
economic, WORK, generic-credit, and PowID preimages plus their commitments.
Readiness validates that immutable row directly, requires exactly one
same-model livenet row bound to the canonical declaration block, and binds its
`canonicalSummary` identity/hash/network-value Q8 to the completed V5
migration seed, bootstrap seed commitment, and first activation opening
state. The bound canonical-summary row is historical provenance and may be
absent under normal retention; it is not reconstructed or restored. Missing,
duplicate, tampered, noncanonical, unsafe-number, commitment-divergent, or
marker-divergent evidence fails closed.

That immutable seed contains one narrowly pinned legacy-bootstrap carry. The
underlying transaction is:

```text
model = canonical-work-amo-v5-legacy-bootstrap-carry-v1
txid = 5eb0a876603a7551653806b932533dc27a884631a581caa2e36dcf129b8278e8
blockHeight = 959311
blockTransactionIndex = 2552
protocolVout = 1
recordOrdinal = 0
blockHash = 000000000000000000005a63a2c00834b92746ab0658c9f0c98aeb509724e8f9
reasonCode = work-market-v4-version-required
```

It is confirmed audit history but not a valid WORK marketplace event. It
creates no active listing reservation and contributes zero valid marketplace
activity, mutation-fee flow, miner-fee flow, or derived state. The immutable
pre-V5 summary nevertheless already carried its 546-proof mutation payment and
2,216-proof transaction miner cost. V5 does not relabel those values as valid
activity and does not rewrite the activation seed. Instead, exact-tip
projection reconciles them as an opaque legacy-bootstrap basis:

```text
legacyBootstrapMarketplaceCarrySats = 546
legacyBootstrapSats = 546 * 5 = 2730
legacyBootstrapGrowthValueQ8 = 273000000000
legacyBootstrapCreditFixedSats = 546 + 2216 = 2762
legacyBootstrapCreditFixedQ8 = 276200000000
```

The outward `tokenMarketplaceFeeSats`, `marketplaceFeeSats`,
`marketplaceMutationFeeSats`, `marketplaceFlowSats`, and `marketplaceSats`
aliases are valid-only and therefore exclude the 546-proof carry. The raw
committed transition N, base-state preimage, frozen values, Q8 commitments, and
chart history remain byte-for-byte authoritative. The API exposes the carry
separately with its exact `workAmoV5LegacyBootstrap` evidence so consumers can
prove both the valid-only projection and the unchanged committed basis.

Reconciliation fails closed unless the relational event, transaction,
canonical block, exact position, invalid disposition, reason, 546-proof
payment, 2,216-proof miner fee, zero active reservation, and singleton
cardinality all match. No current aggregate, heuristic, or fallback may infer
the carry. Changing the height-959620 seed or replaying it without the carry
would be a retroactive protocol change and requires a new on-chain protocol
version.

The declaration memo is output 3. Input zero spends exact authority
scriptPubKey
`76a91499b91dd27a616a71c0a1e9db6a86ceb8cff284c588ac`; output 4 pays
546 proofs to `1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV` before the `pwt1`
protocol output at output 5. Implementations pin all of these facts and the
exact memo hash. A matching txid without matching canonical position and
evidence is insufficient.

New governed WORK list, seal, and buy actions use `pwt-sale-v5`. A new listing
chooses exactly one face:

```text
allowedFaceUsdCents = { 2000, 5000, 10000 }
```

These are `$20`, `$50`, and `$100`. The signed pending authorization commits
the face and the declared models, but it does not choose `amountAtoms`,
`priceSats`, a markup, or a discount. Pending amount and price displays are
estimates only.

Every confirmed Computer event has the canonical position:

```text
(blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)
```

Positions compare lexicographically as integers. Txid order, timestamps,
database insertion order, and event ids never order confirmed state. Missing,
duplicated, inconsistent, or unverifiable position data fails closed.
`recordOrdinal` is mandatory even when its value is zero; no V5 validation,
replay-key, quote-head, or projection path may manufacture a missing ordinal.
When a committed set preimage still needs a string total order, normalized
strings compare by unsigned UTF-8 bytes. Locale collation, `localeCompare`,
`Intl.Collator`, and host database locale never define protocol order. This
string rule canonicalizes set preimages only; it never replaces confirmed
position order.

For every event, the Computer computes and validates the result from the state
immediately before that position, freezes the result, then applies that valid
event's bond contribution. An invalid event contributes zero. A transaction's
miner fee is counted exactly once after its final protocol record. Thus an
earlier bond in the same block affects a later listing, while a later bond does
not reprice an earlier listing.

The internal block sequencer is
`canonical-work-amo-full-position-block-sequencer-v2`. Its raw evaluator keeps
a rolling
`canonical-work-amo-raw-transition-chain-sha256-v1` commitment. The opening
commitment is bound before the first event, the chain advances after every raw
protocol event and every once-per-transaction fee transition, and a final
block-close step binds the closing economic, generic-credit, PowID, and WORK
commitments. Replay records and traces preserve the applicable per-step chain
head. These rolling heads supplement, and never replace, the independently
recomputed full opening and closing state commitments. Pre-release V1
sequencer rows may remain immutable evidence, but only V2 transitions are
selected or published.

Replay starts from every raw Core `pwm1`, `pwa1`, `pwid1`, `pwr1`, and `pwt1`
candidate, including malformed and ultimately invalid records. One
transaction-wide output-ownership map prevents two protocol records from
claiming the same economic output. A `pwa1` quote and a WORK `pwt1` registry
payment each require the first qualifying single output in vout order; two
smaller outputs cannot be aggregated. ID, RUSH, and non-WORK credit registry
payments use the deterministic multi-output allocator: constrained and
claim-all roles first, then larger requirements; choose the smallest sufficient
single output or the deterministic largest-first prefix. That allocator is
only for those registry-payment requirements; it never aggregates a PWA
payment, a WORK registry payment, or seller settlement. Seller settlement
requires one seller output covering price plus the returned ticket anchor,
while sale volume attributes only seller price. A transaction containing only
invalid protocol records contributes
neither economic flow nor miner fee.

The replay witness is the exact 80-byte Core block header plus every
transaction in that block in Core array order, not merely transactions that
already produced database events. The array must begin with its sole coinbase.
Each entry retains its exact serialized transaction bytes; parsing those bytes
must reproduce its txid, wtxid, input outpoints or coinbase script, output
scripts, and output values. Every governed candidate transaction is also
hydrated with exact input prevout scripts and values so its miner fee is
independently derived. Script-derived addresses may be exposed as projections,
but RPC address labels and optional status/hash/height/index/time metadata have
no consensus authority. Block time comes only from the exact header. The
header must reproduce the requested block hash, previous-block hash, and
transaction-array Merkle root.

The full-block descriptor binds a `bip141Witness` under
`canonical-work-amo-raw-bip141-witness-v1`. When the block contains witness
data, replay recomputes the witness Merkle root from exact wtxids with the
coinbase leaf fixed to zero, requires the coinbase's exact 32-byte witness
reserved value, and verifies the highest-index matching coinbase witness
commitment output. A legacy block with neither witness data nor a commitment
remains valid. Missing, partial, reordered, metadata-substituted, or divergent
block evidence fails closed.

Every V2 row stores that closed-shape summary at
`work_amo_block_transitions.payload.bip141Witness`. Its
`witnessTransactionCount` cannot exceed the transition's exact
`blockTransactionCount`. The migration bootstrap certificate repeats the
final row as `finalBip141Witness` beside `finalBlockTransactionCount`, and
readiness requires the marker, replay result, and stored tip to agree exactly.
Missing fields, extra fields, coerced values, a noncanonical script, an
independently incorrect double-SHA256 commitment, or an impossible count fails
closed.

Replay exposes three different counts and never treats them as aliases.
`rawProtocolCandidateCount` counts physical decoded Core OP_RETURN candidates,
including every participating PWM part. `protocolRecordCount` counts logical
raw records after all PWM parts in one transaction collapse into one ordered
aggregate. `eventCount` counts persisted replay events: every logical raw
record plus its deterministic derived children. Derived children have their
own later projection ordinals and event-set entries, but are marked
`rawCandidate:false`; they claim no output, apply no economic delta, and charge
no second transaction fee.

All `pwm1` outputs in one transaction form one ordered PWM envelope, even when
ordinary payment outputs appear between its parts. If any other governed
`pwa1`, `pwid1`, `pwr1`, or `pwt1` candidate appears strictly between the
first and last PWM part, the PWM aggregate is invalid with stable reason
`work-amo-v5-raw-pwm-envelope-noncontiguous` and contributes zero. The
intervening governed records remain independently ordered and evaluated.

The USD oracle record is:

```text
pwa1:usd1:<v1DeclarationTxid>:<sequence>:<previousQuoteTxid>:<usdPer100mProofsQ8>
```

The first quote has sequence 1 and references V1 declaration txid
`b578601bf1c1804b6afb4b030cfa5207c9894f4b5a2d2bc5ce5a9369534ed837`.
Each later quote increments by one and references the preceding canonical
quote. A quote must be confirmed, spend the exact authority script through
input zero, contain exactly one valid `pwa1:usd1` record, pay at least 546
proofs to the WORK registry, and have a complete canonical position. Competing
children of one quote are resolved by lowest canonical position; every other
child is invalid. A listing uses the latest valid quote strictly before its
position, including an earlier quote in the same block. The quote must be no
more than 144 blocks old when the listing confirms. Later quote expiration or
replacement never changes a confirmed listing.

For confirmed listing `L`, using unsigned arbitrary-precision integers:

```text
F = unitFaceUsdCents
P = quoteBefore(L).usdPer100mProofsQ8
N = Nbefore(L)
S = 21000000
A = 100000000
Q = 100000000
R = 100000000
U = 100000000

targetNumerator = F * R * U
targetDenominator = 100 * P

unitPriceSats =
  ceilDiv(targetNumerator, targetDenominator)

unitAmountAtoms =
  floorDiv(
    targetNumerator * S * A * Q,
    targetDenominator * N
  )

unitMinimumPriceSats =
  ceilDiv(
    unitAmountAtoms * N,
    S * A * Q
  )
```

Floating-point arithmetic is forbidden. The proof price rounds up and the WORK
amount rounds down. A zero, overflowed, noncanonical, unavailable, stale,
insufficient-balance, or otherwise inconsistent result is invalid.

A valid confirmation permanently binds the declaration-listed model ids, face,
quote identity and position, listing position, `Nbefore`, derived WORK atoms,
proof price, minimum proof price, listing bond contribution, and network value
after the listing. A V5 seal or purchase references that exact listing and
uses those frozen values. It never recomputes them from the seal or purchase
block. Later bonds, transfers, listings, sales, network-value changes, quote
changes, quote expiration, or high traffic cannot invalidate or reprice it.

A valid V4 listing confirmed before height 959621 retains its original frozen
terms and may close through a V5 seal or purchase reference. A V4 action at or
after activation is invalid audit history. Pre-unit V3 listings are immutable
non-reserving relics; a V3 action submitted after its own cutover remains
invalid audit history. Existing Marketplace V1 relic history remains
immutable. Non-WORK credits, POWB, and INCB retain their existing protocols.

Production uses the independent `WORK_AMO_V5_WRITES_ENABLED` gate. Declaration
truth, complete positions, replay parity, and a valid confirmed quote head are
all required in addition to the explicit gate. Quote readiness gates creation
of a new governed WORK listing only. A confirmed valid listing may still be
sealed or bought from its frozen terms when the current quote is missing,
expired, or replaced; those actions never consult a current quote or reprice
the listing. No quote may be invented from a web price or pending transaction.
Wallet and oracle-authority signing stay local.

Each activation-through-tip block transition commits the economic accumulator,
the complete WORK state, the generic-credit state, and the PowID state. The
activation opening state is the one legacy H-1 bootstrap. Every later opening
state is the preceding canonical raw transition's closing state; current
relational tables cannot substitute for that chain. Backfill binds each
prepared row one-to-one to the raw transition outcome at its exact
`(height, transaction index, protocol vout, ordinal)` before persistence.
Transition validity, reason, frozen output, and state mutation are
authoritative. Invalid rows remain audit history but cannot mutate balances,
listings, IDs, quotes, Log, Growth, or network value. The pinned
legacy-bootstrap carry above is only a reconciliation of the already committed
H-1 basis; it is not a valid-row exception and cannot be generalized to any
other invalid event.

The immutable seed-evidence row, not a retained replaceable canonical-summary
row, is the runtime readiness authority.

## WORK AMO V6 Proof-Native Unit Protocol (`pwt-sale-v6`) — protocol active, production admission gated

V6 makes proofs the only AMO pricing unit. Its declaration is confirmed and
its protocol activation height is `960219`. V5 above governs only before that
height. Production action admission remains independently closed unless
declaration evidence, migration, activation-range replay, exact-tip readiness,
and the write gate all agree.

A seller chooses exactly one fixed proof face:

```text
allowedFaceProofs = [20000, 50000, 100000]
```

USD is not a protocol input. It is optional display metadata derived by the
public UI from the current proofs-to-USD display rate. A missing, stale or
changed USD display value cannot affect listing creation, confirmation,
settlement, replay or validity. V6 has no exchange-source quorum, operator
price, price-attestation key, signature window or recurring on-chain price
publication.

If the exact V6 declaration confirms in block `D`, V6 starts at `D + 1`.
Production separately verifies and pins the declaration transaction id, block
height/hash/index, exact memo hash/byte length, protocol output, record ordinal,
registry-payment output, authority input-zero script and registry payment.
Partial, pending, noncanonical or divergent evidence fails closed.

The canonical V6 declaration is transaction
`975fd82aa84995e014b240618ee1a1254d0a735e6e1241372d0bed0a0d9f0799`.
It confirmed at height `960218` in block
`00000000000000000001ac35a5b7e43c782297fcb9cde0fb458fbd5451ad55df`
at zero-based transaction index `102`, so the protocol activation height is
`960219`. The exact wrapped declaration carrier is output `3`, record ordinal
`0`, 3,350 bytes, SHA-256
`b43daeea38fcacaf6afa6a48d3d0fde631497a4af9f3bb137fc07975d18bbe01`;
the distinct 546-proof registry payment is output `4`. Production admission
remains independently fail-closed until the six-confirmation migration,
activation-range replay, exact-tip parity and explicit write gate all pass.

The declaration position is the exact raw `pwm1:m` carrier output and its
within-output record ordinal, not the canonical mailbox aggregate position.
The same transaction may carry `pwm1:s` subject or `pwm1:r` reply parts that
mail indexing aggregates at a different canonical position. It may also carry
independently valid sibling governed records, including `pwt1:send2`. Those
siblings neither change the declaration payload nor invalidate its evidence;
each remains subject to its own ordered protocol validation. The declaration
gate still requires the exact wrapped payload at the pinned carrier, the
declared authority at input zero, the canonical transaction and block pins,
and the distinct registry payment.

From activation:

- new governed WORK listings require `pwt-sale-v6`;
- valid confirmed V4/V5 listings from before activation retain their frozen
  terms and may still be sealed, purchased or delisted;
- new V4/V5 listings at or after activation are invalid audit history;
- V1 and pre-unit V3 relic projections remain immutable and non-actionable; and
- historical V5 `pwa1:usd1` quotes remain replayable history but do not govern
  V6 listing creation.

The V6 signed authorization is closed shape. It commits to the protocol models,
token/network/registry/seller/buyer/nonce/expiry fields, sale-ticket anchor and
`unitFaceProofs`. It must not contain USD fields, price attestations, `amount`,
`amountAtoms`, `priceSats`, `minimumPriceSats`, derived terms or network-value
fields.

### Confirmation formula and ordering

For listing `L`, using unsigned arbitrary-precision integers:

```text
position(L) =
  (blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)

F = L.unitFaceProofs
N = Nbefore(L)
S = 21000000
A = 100000000 atoms per WORK
Q = 100000000 network-value Q8 scale

unitPriceProofs = F
unitAmountAtoms = floorDiv(F * S * A * Q, N)
unitMinimumPriceProofs =
  ceilDiv(unitAmountAtoms * N, S * A * Q)
```

`F` must be one of the three declared faces. The price, amount and minimum must
all be positive, the amount cannot exceed total WORK supply, and
`unitPriceProofs` must be at least `unitMinimumPriceProofs`. Floating-point
arithmetic and implicit rounding are forbidden. The fixed face is the sale
consideration; registry, sale-ticket and miner fees remain separate protocol
costs.

The Computer evaluates every event from the complete state immediately before
that event. It freezes the result and then applies that record's distinct
registry-payment bond contribution. After all protocol records in one
transaction are evaluated, the transaction miner-fee contribution is applied
exactly once before the next transaction. An earlier confirmed event in the
same block or transaction can change a later listing's `Nbefore`; a later event
cannot change an earlier listing. API completion, mempool arrival, database
insertion and worker scheduling cannot change the result.

A valid V6 listing permanently freezes the selected proof face, confirmed
position, `Nbefore`, exact WORK atoms, proof price, minimum proof price,
record-level registry bond contribution and record-level `Nafter`. Seal and buy
use those frozen terms without consulting current network value or any USD
display. A confirmed listing therefore remains eligible for settlement even
after later bonds and market activity change network value.

V6 sealing is a one-way state transition. Once a listing has a coherent signed
authorization anchored to its listing id, any later seal attempt is invalid
audit history and cannot replace the first seal identity or frozen terms.

Every opening and closing WORK token-state commitment must canonicalize active
V6 listings through the strict V6 authorization and frozen-term validators.
Historical V4/V5 listings keep their existing canonical bytes; an unknown,
tampered or internally divergent listing version fails the state commitment.

Because V6 forbids derived amount and price fields in the signed intent, a raw
`list5`, `seal5`, `buy5` or `delist5` decoder must not treat an absent derived
field or its local zero placeholder as a listing term. Only the exact
block-replay binding may materialize top-level `amountAtoms`, human `amount`,
`priceSats`, seller, authorization and frozen terms from the canonical nested
listing. The materialized amount and price must equal the validated immutable
`unitAmountAtoms` and `unitPriceSats`; divergence aborts the whole block.
Unbound payload fields and client-supplied frozen terms never authorize this
materialization. The raw placeholder is consumed only when its exact lifecycle
kind, action txid, `pwt1` protocol, complete action position, listing identity,
actor and validated V6 authorization identity match the canonical verifier
item. An unmatched raw record remains rejected evidence; it cannot coexist at
the same canonical position as a separately materialized valid item.

The confirmed verifier projection for a V6 listing also carries its original
listing block hash, height, transaction index, protocol output and record
ordinal, even after a later seal. Seal and close actions carry their own
separate canonical tuples. Public human amounts are formatted from the exact
atom integer (`10` atoms is `0.0000001` WORK); relational WORK listing columns
continue storing atoms.

V6 keeps `canonical-work-amo-full-position-block-sequencer-v2` and uses
`canonical-work-amo-proof-unit-v1`. Exact declaration evidence, immutable
migration marker, canonical replay parity, exact-tip index readiness and the
explicit write gate must all be independently proved before a new listing or
settlement is admitted. Disagreement closes V6 admission without changing the
frozen settlement rights of valid historical V4/V5 listings.

### V6 public read projection

Public reads activate V6 only from exact confirmed declaration and migration
evidence. The configured declaration pins must resolve to the one canonical
transaction, block, transaction index, raw carrier output, record ordinal and
registry-payment output, and the completed
`workAmoV6Migration:livenet` marker must bind those same facts and the declared
V6 models. Height, a configured txid, a marker-shaped object or a write switch
alone is insufficient. A missing, duplicate, noncanonical or divergent fact
keeps the reader on its preceding V5-era version policy; it does not partially
project V6.

Once that exact readiness holds, a current or historical snapshot at or after
height `960219` may project `pwt-sale-v6` together with valid confirmed
grandfathered V4/V5 listings that retain frozen settlement rights. A V4
listing confirmed at or after height `959621`, a V5 listing confirmed at or
after height `960219`, an unknown version, or an unsupported mixed-version
record remains invalid audit history and cannot enter the active listing set.
Snapshots before V6 activation continue to use their historical version
rules.

Every table-backed V6 listing requires exactly one matching valid confirmed
`token-listing` event, its confirmed transaction, its canonical block and the
same full `(blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)`
tuple. A sealed V6 listing additionally requires exactly one matching valid
confirmed `token-listing-sealed` event with the same listing and authorization
version and its own complete canonical tuple. A payload flag, aggregate
lifecycle row, missing event, duplicate event or mismatched tuple cannot
substitute for that singleton evidence and fails closed.

For a historical V6 or other pre-V8 Q8 WORK `credit_listings` row, the
relational `amount` value and immutable `work_amo_v6_listing_terms.amount_atoms`
are exact atom integers, independent of whether definition metadata is
present. Before the V8 activation boundary, public readers set `amountAtoms`
from that integer and derive the human amount with eight decimal places; for
example, `10` stored atoms is `0.0000001 WORK`, not `10 WORK`. At V8
activation, current shared projections convert that column to exact Q16
subatoms while the immutable V6 terms table and raw historical records retain
their original Q8 scale.

`WORK_AMO_V6_WRITES_ENABLED` controls action admission only. It is not a public
read-version switch. Turning writes off, pausing exact-tip actions or closing
new-listing admission must not hide an already confirmed, canonical,
evidence-complete V6 listing or the frozen rights of a valid historical V4/V5
listing. Ordinary index freshness and canonical-read safeguards still apply.

## Historical unactivated WORK Precision Protocol V2 / AMO Unit Protocol V7 (`pwt-sale-v7`)

V7 never acquired a confirmed declaration or activation boundary. Its pins
remain empty, its write gate remains disabled, and V8 supersedes it. The full
proposal is retained below as historical design and audit evidence; every
activation statement in this V7 section is counterfactual and must not be used
as current protocol authority.

V7 is a new declaration-bound protocol era. It does not edit the confirmed V6
declaration, reinterpret V6 signed fields, or replace V6 before activation.
Until exact V7 declaration pins are configured and that declaration confirms,
V6 remains the current governed WORK write protocol.

If the exact V7 declaration confirms in block `D`, the precision migration and
V7 authorization rules activate at the opening of `D+1`. The consensus/global
WORK precision model becomes `canonical-work-subatoms-v2`; its current
relational and API storage projection uses `work-subatoms-v2`:

```text
WORK_DECIMALS = 16
SUBATOMS_PER_WORK = 10000000000000000
SUBATOMS_PER_LEGACY_ATOM = 100000000
MAX_SUPPLY_SUBATOMS = 210000000000000000000000
MINT_AMOUNT_SUBATOMS = 10000000000000000000
```

The activation conversion is exact integer multiplication. Every confirmed
pre-activation balance atom, supply atom, reservation atom, and active-listing
projection atom becomes `legacyAtoms * 100000000` subatoms. The sum of all
converted holder balances must equal converted supply; no address gains or
loses WORK and no supply is created. A one-atom balance therefore changes
representation from `1` Q8 atom to `100000000` Q16 subatoms, while its human
value stays exactly `0.00000001 WORK`. Mempool pending deltas are not canonical
opening state: they are cleared and deterministically rebuilt under the active
V7 rules, so an unconfirmed legacy write cannot cross the activation boundary.

Raw confirmed OP_RETURN payloads and transaction bytes, original signed
authorization objects and frozen terms, pre-activation canonical
state-transition commitments, and pre-activation closed snapshot commitments
are never rewritten. Provisional or wrong-era derived projections at `D+1` or
later are invalidated and deterministically replayed from canonical raw
evidence. A valid still-active V4/V5/V6 listing keeps its exact price and
settlement rights. Its normalized Q16 reservation and settlement amount is
its frozen Q8 atom amount multiplied by `100000000`; the Computer must never
rederive or reprice it.

The WORK mint wire record does not change scale syntax:

```text
pwt1:mint:<canonical-work-token-id>:1000
```

That exact raw amount credits `100000000000` Q8 atoms before activation and
`10000000000000000000` Q16 subatoms from activation. Every other raw WORK mint
amount is invalid; no historical mint bytes are rewritten.

New canonical WORK transfers at or after activation use:

```text
pwt1:send3:<canonical-work-token-id>:<amount-subatoms>:<recipient-address>
```

`amount-subatoms` is a positive canonical base-10 integer. Signs, exponents,
commas, whitespace aliases, leading-zero aliases, zero, and decimal text are
invalid. `send3` is WORK-only. Historical `send` and pre-activation `send2`
records remain replayable at their declared scale; a new `send2` confirmed at
or after V7 activation is invalid audit history and cannot mutate WORK state.
A `send3` record before activation is likewise invalid audit history.
Each transfer still contributes exactly 546 proofs to the WORK registry.
Separate qualifying registry outputs remain valid. Two or more same-era WORK
transfers may instead share one registry output only when that singular output
precedes every funded transfer, equals exactly `546 * transferCount`, all
`pwt1:` records in the transaction are those WORK transfers, and every other
protocol record is only an earlier `pwm1:` mail envelope. The physical output
is claimed once while exactly 546 proofs are attributed to each transfer.

The V7 signed listing authorization remains closed shape and commits only the
static identity, sale-ticket anchor, proof face, and declared models. It uses:

```text
version = pwt-sale-v7
unitModel = canonical-work-amo-proof-unit-v2
amountModel = canonical-work-amo-proof-unit-amount-v2
stateOrderModel = canonical-proof-state-order-v1
unitWorkOracleModel = canonical-work-prefix-before-action-v1
bondTransitionModel = canonical-compute-then-bond-v1
unitFaceProofs = one of 20000, 50000, 100000
```

The signed intent must not contain `amount`, `amountAtoms`,
`amountSubatoms`, `unitAmountAtoms`, `unitAmountSubatoms`, `priceSats`,
`minimumPriceSats`, network-value fields, listing position fields, or
client-supplied frozen terms. Those are confirmed-position derivations.

For listing `L`, all values are unsigned arbitrary-precision integers:

```text
F = selected proof face
N = canonical networkValueBeforeQ8 immediately before L
S = 21000000 WORK
A = 10000000000000000 subatoms per WORK
Q = 100000000

unitPriceSats = F
unitAmountSubatoms = floor(F * S * A * Q / N)
unitMinimumPriceSats = ceil(
  unitAmountSubatoms * N / (S * A * Q)
)
```

`N` must be positive. `unitAmountSubatoms` must be between `1` and `S*A`
inclusive. `unitMinimumPriceSats` must be positive and cannot exceed
`unitPriceSats=F`. Both serialized integer `*Sats` fields are denominated in
proofs; “proofs” is display language and does not create alternate
`unitPriceProofs` or `unitMinimumPriceProofs` fields.
All multiplication happens before the declared floor or ceiling division.
Floating-point numbers, USD values, magnitude guessing, and rounded display
values are never consensus inputs.

Canonical ordering remains:

```text
(blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)
```

For every record, the Computer loads the exact state prefix before that
position, derives and freezes the V7 terms from `N`, validates seller
spendability in Q16, and only then applies that record's distinct registry bond
contribution. A transaction's miner-fee contribution is applied exactly once
after all protocol records in the transaction and before the next
transaction. This ordering is the arithmetic grouping rule; no batch,
parallel worker, or database query order may change it.

The frozen V7 projection carries `unitAmountSubatoms`, exact human `amount`,
proof price/minimum, network value before/after, listing block hash/height,
transaction index, protocol output, record ordinal, and the immutable listing
identity. Seal, buy, and delist reference that projection. Seal and buy never
consult a later network value.

V7 production admission is independent of V6 and fails closed until all of
these agree at one exact tip:

- exact declaration transaction, block, transaction index, protocol output,
  record ordinal, raw carrier bytes/hash, authority input, and registry
  payment pins;
- the completed `workPrecisionV2Migration:livenet` marker with Q8 and Q16
  conservation commitments;
- the installed database constraint definitions, not merely their names;
- activation-opening conversion and activation-through-tip canonical replay;
- API, worker, relational index, and canonical ledger parity;
- current Core height/hash and exact-tip summary readiness; and
- the separate `WORK_AMO_V7_WRITES_ENABLED=1` gate.

An unconfigured or not-yet-active V7 must not pause valid V6 writes. Once the
canonical `D+1` boundary is observed or persistently latched from the exact
confirmed declaration, clearing, omitting, or malforming operator pins cannot
re-enable V6 or `send2`; readiness failure can only pause governed writes.
After V7 activation, new V6 listings and new `send2` transfers are invalid,
but valid pre-activation listings of every supported historical version
remain visible and settleable under their original frozen terms.

## Approved WORK Precision Protocol V2 / AMO Unit Protocol V8 (`pwt-sale-v8`)

V8 is the approved additive declaration-bound successor to the current Q8/V6
era. It does not manufacture a V7 activation, alter any historical signed
payload, or reinterpret an earlier frozen term. If the earliest exact valid V8
declaration confirms in block `D`, V8 activates at the opening of `D+1`.

The precision and state models are:

```text
authorizationVersion = pwt-sale-v8
transferVersion = send3
globalPrecisionModel = canonical-work-subatoms-v2
precisionMigrationModel = canonical-work-q8-to-q16-migration-v1
amountStorageModel = work-subatoms-v2
tokenStateModel = canonical-work-token-state-subatoms-v3
relicCutoverModel = canonical-work-amo-v8-preactivation-relic-cutover-v1
WORK_DECIMALS = 16
SUBATOMS_PER_WORK = 10000000000000000
SUBATOMS_PER_LEGACY_ATOM = 100000000
MAX_SUPPLY_SUBATOMS = 210000000000000000000000
MINT_AMOUNT_SUBATOMS = 10000000000000000000
```

One subatom is exactly `0.0000000000000001 WORK`. At the activation opening,
every confirmed current Q8 maximum-supply, mint-increment, supply, and holder
balance integer scales by exactly `10^8`: `legacyAtoms * 100000000`. Converted
supply must equal the sum of converted balances and must remain within the
exact maximum. The conversion changes divisibility only; it creates no WORK,
changes no owner, and uses no floating-point or magnitude inference.

Raw confirmed transaction bytes, OP_RETURN records, original signed objects,
historical Q8 frozen terms, and preactivation canonical commitments remain
immutable. Wrong-era or provisional derived projections at or after `D+1`
are invalidated and replayed from raw canonical evidence. Pending state is not
part of the activation opening: pending WORK events, listing/action rows, and
balance deltas are cleared, then rebuilt from Core mempool evidence under V8.
Every transaction id in the exact persisted pending WORK membership set must
remain present across both Core samples that fence the database audit, and the
persisted event, listing, transaction, and balance rows require exact parity.
Every member also requires all five correctly typed WORK inspection markers;
a terminal-invalid protocol marker cannot coexist with a valid persisted WORK
projection. The full sampled mempool count and hash remain compact audit evidence; unrelated
transaction additions or removals between samples do not invalidate the WORK
witness. Discovery and raw inspection of unrelated or not-yet-projected
unconfirmed transactions remain bounded best-effort visibility; they cannot
change confirmed state or block V8 readiness merely because the public mempool
is larger than one scan budget or is changing continuously.

The activation-opening token state contains no active legacy listing. Every
confirmed WORK listing in `active` or `sealing` state immediately before V8
activation, regardless of its historical authorization version, is committed
to the sorted V8 relic-cutover set and projected as:

```text
status = dropped
actionable = false
relic = true
refundEligible = true
disabledAtBlockHeight = D+1
disabledByTxid = V8 declaration txid
disabledReason = work-amo-v8-preactivation-relic
relicCutoverModel = canonical-work-amo-v8-preactivation-relic-cutover-v1
```

Its raw record and original frozen terms remain visible as history, but its
reservation is released. The official Computer exposes no legacy seal, buy,
or delist preparation or settlement path after the boundary. A later ticket
spend remains observable chain evidence but cannot resurrect or settle that
legacy listing. The relic-set count and commitment must match the exact
activation-opening state; missing, duplicate, added, or still-actionable rows
fail migration and readiness closed.

Historical V1/V2 rows that were already excluded from the canonical closing
token state at their height-959061 cutover are not new V8 relics and cannot
re-enter the V8 refund set. If their derived relational status has resurfaced
as `active` or `sealing`, migration may set only that stale status to `dropped`
after proving the row is `pwt-sale-v1` or `pwt-sale-v2`. Its raw event,
historical projection payload, and original refund-snapshot eligibility remain
unchanged. Any extra active row of another authorization version fails the V8
migration closed.

Historical V1 table rows can encode their derived `amount` as whole WORK even
when their immutable raw `pwt1:list5` authorization determines an exact Q8
amount. Migration and its idempotent conservation audit therefore decode the
raw carrier, require its one valid confirmed replay event and listing
projection to agree on every version, token, and available amount alias, and
never guess from the table column's magnitude. Unit-era V5/V6 raw
authorizations bind their deterministic unit inputs while the valid canonical
replay event supplies the derived Q8 amount. The one-time repair is bounded to
the two canonical affected
listing txids and exact before/after integers. A full-payload compare-and-set
may update only the Q16 derived amount and its explicit legacy-atom migration
metadata; the raw event and authorization stay unchanged. Every other repair
set fails closed.

The mint wire form stays byte-compatible:

```text
pwt1:mint:<canonical-work-token-id>:1000
```

It credits `100000000000` Q8 atoms before V8 activation and
`10000000000000000000` Q16 subatoms from activation. Every other raw WORK mint
amount is invalid. New current-state transfers from activation use only:

```text
pwt1:send3:<canonical-work-token-id>:<amount-subatoms>:<recipient-address>
```

`amount-subatoms` is a positive canonical base-10 integer. Signs, exponents,
commas, whitespace, leading-zero aliases, zero, and decimal text are invalid.
Historical `send` and `send2` records replay at their original scale, but
cannot create a postactivation mutation. Each transfer retains the exact
546-proof registry requirement and the already documented same-era aggregate
payment rules.

The V8 listing authorization is closed shape and commits the static listing
identity, sale-ticket anchor, sole proof face, and exact models:

```text
version = pwt-sale-v8
unitModel = canonical-work-amo-proof-unit-v3
amountModel = canonical-work-amo-proof-unit-amount-v3
stateOrderModel = canonical-proof-state-order-v1
unitWorkOracleModel = canonical-work-prefix-before-action-v1
bondTransitionModel = canonical-compute-then-bond-v1
blockSequencerModel = canonical-work-amo-full-position-block-sequencer-v4
unitFaceProofs = 25000
```

No other face is valid. The signed intent cannot supply `amount`,
`amountAtoms`, `amountSubatoms`, `unitAmountAtoms`, `unitAmountSubatoms`,
`priceSats`, `minimumPriceSats`, network-value fields, canonical position, or
client-derived frozen terms. Those values exist only after confirmation.

For listing `L`, use unsigned arbitrary-precision integers:

```text
F = 25000 proofs
N = canonical networkValueBeforeQ8 immediately before L
S = 21000000 WORK
A = 10000000000000000 subatoms per WORK
Q = 100000000 network-value scale

unitPriceSats = F
unitAmountSubatoms = floor(F * S * A * Q / N)
unitMinimumPriceSats = ceil(
  unitAmountSubatoms * N / (S * A * Q)
)
```

`N` must be positive; `unitAmountSubatoms` must be within `1..S*A`; and
`unitMinimumPriceSats` must be positive and no greater than `F`. Integer
multiplication occurs before division. Binary floating point, USD, rounded
display values, and scale guessing are never validation inputs.

Canonical event order remains:

```text
(blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)
```

At each position, derive from the exact prefix state, validate Q16
spendability, freeze the V8 terms, and then apply that listing record's
distinct registry contribution. Apply a transaction's miner fee exactly once
after every protocol record in that transaction and before the next
transaction. No batch, worker schedule, or database query order may alter the
result.

Only a confirmed V8 listing may be sealed or purchased after activation.
Seal and buy must reference its exact frozen V8 position and terms and never
consult a later network value. A V8 delist may close its own V8 sale ticket;
no V8 action may reference a pre-V8 relic as an actionable listing.

The additive preactivation release was intentionally empty and inert:

- every `WORK_AMO_V8_DECLARATION_*` pin and
  `WORK_AMO_V8_ACTIVATION_HEIGHT` is empty;
- `WORK_AMO_V8_WRITES_ENABLED=0`;
- every V7 declaration pin remains empty and
  `WORK_AMO_V7_WRITES_ENABLED=0`;
- Q8/V6 remains authoritative until exact V8 declaration evidence confirms;
  and
- `send3` and `pwt-sale-v8` preparation fail closed before activation.

The authoritative declaration has now confirmed with these canonical pins:

```text
declarationTxid = f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a
declarationHeight = 960600
declarationBlockHash = 00000000000000000001ec938998cde4fd86ee6e3c672a6d3d95200cd8a984ac
declarationBlockIndex = 2369
declarationMemoSha256 = 1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528
declarationMemoBytes = 5593
declarationProtocolVout = 3
declarationRecordOrdinal = 0
declarationRegistryPaymentVout = 4
activationHeight = 960601
```

The transaction's subject and reply parts are separate `pwm1` outputs. Mail
indexing may aggregate that envelope at vout 1, but declaration evidence binds
the exact raw `pwm1:m` carrier at vout 3. The carrier and registry payment are
each unique. Production keeps V8 writes closed while the activation migration
and replay gates are being completed; the confirmed boundary cannot restore
V6 or `send2` admission.

The authoritative V8 declaration is the earliest exact valid declaration by
confirmed block height and transaction index. Its transaction must be
canonical; input zero must spend the declared authority script; the pinned
registry output must meet the declared minimum; and the pinned protocol output
and record must contain the exact committed declaration bytes. The carrier and
qualifying registry payment must each be unambiguous. Record these pins
together:

```text
WORK_AMO_V8_DECLARATION_TXID
WORK_AMO_V8_DECLARATION_HEIGHT
WORK_AMO_V8_DECLARATION_BLOCK_HASH
WORK_AMO_V8_DECLARATION_BLOCK_INDEX
WORK_AMO_V8_DECLARATION_MEMO_SHA256
WORK_AMO_V8_DECLARATION_MEMO_BYTES
WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT
WORK_AMO_V8_DECLARATION_RECORD_ORDINAL
WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT
WORK_AMO_V8_ACTIVATION_HEIGHT
WORK_AMO_V8_WRITES_ENABLED
```

V8 readiness requires all configured pins to match canonical Core evidence,
`WORK_AMO_V8_ACTIVATION_HEIGHT=D+1`, a persistent activation latch, the exact
immutable `workPrecisionV2Migration:livenet` marker and relic-set commitment,
Q8/Q16 conservation, installed constraint definitions, activation-opening and
activation-through-tip replay, current pending rebuild parity, API/worker/
relational-index/ledger agreement, exact Core tip height/hash, and
`WORK_AMO_V8_WRITES_ENABLED=1`. Partial pins or any disagreement close writes.
Once the exact `D+1` boundary is observed or persistently latched, removing or
malforming configuration can only pause V8; it cannot restore Q8, `send2`, V6
listing admission, or any legacy settlement path.

## Current Infinity Bond / POWB Model

Infinity Bonds are `pwm1:m:powb` message actions. A confirmed bond payment mints
POWB to each recipient address one-for-one with proofs sent to that recipient.
Sending a bond to yourself credits your address; sending a bond to another
address credits that address. POWB has no maximum supply.

POWB is reserved as a synthetic credit-like asset with `infinity@proofofwork.me`
as the registry lane. POWB transfers, listings, seals, delistings, and buys use
the same `pwt1:send`, `pwt1:list5`, `pwt1:seal5`, `pwt1:delist5`, and
`pwt1:buy5` machinery as credits, paying the POWB registry mutation fee.

The POWB floor is:

```text
powb_floor_sats = confirmed_bond_network_value_sats / confirmed_powb_supply
```

Confirmed bond network value includes bond proof payments, POWB seller sale
volume, POWB transfer mutation fees, and POWB sale-ticket mutation fees. POWB
sales and mutation fees also feed the broader ProofOfWork Computer/WORK floor
through the normal confirmed marketplace flow.

After the June 23, 2026 Infinity launch, POWB has both a standalone surface at
`infinity.proofofwork.me` and an embedded Computer workspace at
`computer.proofofwork.me/?folder=infinity`. Both views must use POWB-specific
market labels, charts, balances, sale tickets, and listing logs; stale credit
market copy on the Infinity surface is a release blocker.

## Current Inception Bond / INCB Model

Inception Bonds are `pwm1:m:incb` message actions. When an Inception Bond
confirms, its recipient receives one INCB for each whole proof in the direct
bond payment plus attached WORK value fixed by the send-time oracle. That
oracle is the last confirmed green canonical live WORK summary at H-1,
hash-bound to the exact previous block; every transaction in the bond block is
excluded. INCB is an uncapped reserved synthetic credit registered
through `inception@proofofwork.me`; its canonical credit id is
`3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d`.

INCB transfers, listings, seals, delistings, and buys reuse the same `pwt1:`
sale-ticket lifecycle as POWB and normal credits. The synthetic issuance has
zero additional proof value, so Growth cannot count issued INCB as a second
payment lane. A bond transaction may attach canonical WORK through the
era-valid separate atomic transfer (`pwt1:send2` before the Q16 activation
boundary, `pwt1:send3` afterward). When that attachment is valid, confirmed,
recipient-matched, and in the same transaction, its value uses the live WORK
floor from that canonical H-1 summary.

Attachment issuance follows canonical position without reading the future. If
the PWM bond position comes first, it issues the direct recipient proofs at
that position; only a later valid recipient-matched WORK send adds the H-1
valued INCB top-up at the send position. An invalid later send adds nothing,
and an intervening INCB spend sees only the direct issuance. If the valid WORK
send is earlier, its transfer state is already present before the later PWM
position. The synthetic INCB projection is parent-bound, carries no separately
claimable output, fee, or Growth/WORK contribution, and cannot survive an
invalid parent or attachment.

INCB issuance uses the H-1 live WORK value, never a bond-block or post-bond
result:

```text
confirmed_incb_issuance = floor(
  direct_bond_proofs
  + attached_work_amount
    * (h_minus_one_live_work_network_value / 21_000_000)
)
```

One whole proof in that value issues one INCB. Sub-proof dust remains network
value. The same persisted H-1 oracle fixes the attachment's one shared frozen
WORK movement value; a sequential replay floor cannot replace it. Confirmation
fixes the resulting INCB balance and supply. Current and post-bond network value
change only live WORK revaluation and the live INCB floor; they cannot
self-compound, reprice, mint, or burn historical issuance. The underlying WORK
transfer remains one canonical shared-ledger
movement; the Inception view must not add it to Growth/WORK network value a
second time.

The standalone `inception.proofofwork.me` surface and embedded
`computer.proofofwork.me/?folder=inception` workspace must use INCB-specific
labels, chart data, balances, sale tickets, and listing logs. The exact memo
distinguishes the two families: `powb` maps only to POWB/Infinity and `incb`
maps only to INCB/Inception.

## June 13-16 Ledger Hardening

The June 2026 marketplace fixes preserved these operational invariants:

- WORK and credit sale-ticket seals are listing state. When a pending listing confirms, the confirmed listing must keep any valid pending or confirmed seal metadata instead of becoming unsealed again.
- Pending WORK and credit txids are liveness-checked on fresh reads. If a pending transfer, listing, seal, delisting, or buy disappears from mempool visibility, it is removed from pending overlays without changing confirmed history.
- Marketplace network value includes mutation-fee flow from listings, seals, delistings, and buys alongside seller sale volume. Mutation fees stay out of generic Computer event flow so the Growth and WORK floor ledgers do not double-count them.
- WORK marketplace sales also carry WORK movement value in the live/frozen accounting layer. The seller price remains visible trade price, while the moved WORK amount is valued from the canonical live WORK floor and stored as frozen value at confirmation.
- Confirmed sale-ticket spends are active-book truth. When Bitcoin Core RPC is configured, active listing reconciliation uses current UTXO spend state before falling back to slower address-history recovery, so confirmed delistings and buys clear from Marketplace and Wallet while summaries warm.
- Closed listings, sales, market logs, Growth, and Log derive from the same sale-ticket lifecycle. A delisting should not disappear from logs, and a bought ticket should not stay visible as active in any wallet or marketplace surface.

## June 22 Summary Hardening

The June 22 marketplace fix tightened the split between visible intent,
pending sealing, and confirmed executable asks:

- Confirmed, unspent, buyable sealed WORK/credit listings must stay present in
  `/api/v1/marketplace-summary` even when ordinary active-listing previews are
  capped by recency.
- The public marketplace summary route must return the reconciled sale-ticket
  lifecycle, not a stale compacted proof-index summary snapshot that can hide
  older confirmed sealed inventory.
- The Sealed tab/count means confirmed and buyable. Pending seal rows remain
  visible as sealing status in All/Unsealed until their seal confirms.
- Wallet and Marketplace refreshes may preserve locally broadcast pending
  listing/seal overlays until the canonical API sees the same tx or a closure,
  so seller controls do not disappear while the indexer catches up.
- Regression checks must prove that every confirmed sealed WORK listing present
  in the full token payload is also present in marketplace summary, and that
  wallet-scoped listing reads preserve confirmed seal txids.

## June 27 Sealed Summary Hardening

The final audit follow-up tightened one more sale-ticket edge case: a valid
`seal5` transaction spends the listing sale-ticket anchor, but that spend is
not a close. It publishes the seller's executable terms.

- Active-book and summary reconciliation must treat `closeTxid === sealTxid` as
  a stale projection of the seal spend, not as a delist or sale.
- Proof-index `credit_listings` rows with status such as `sealing` or a
  seal-as-close projection should be usable as a recovery overlay for confirmed
  sealed WORK/credit inventory.
- Final summary compaction must remove stale seal-as-close rows before using
  closed listings to filter active listings.
- `marketplace-summary?fresh=1` should wait for the configured production
  refresh window and, if canonical refresh is still slow, return the reconciled
  fallback rather than a raw stale snapshot, false zero, or 503.
- The production gate is `POW_API_BASE=https://computer.proofofwork.me npm run
  check:marketplace-regressions`; it must prove every confirmed sealed WORK
  listing present in `/api/v1/token?asset=WORK&fresh=1` is also present in
  `/api/v1/marketplace-summary`.

## Order Books And Logs

AMO books should stay asset-agnostic as new product classes are added.
For any sale-ticket product, the active book should expose:

- All listings
- Sealed listings
- Unsealed listings

Sealed listings are buyable when the seller signature and sale-ticket anchor are
valid and confirmed. Listings with a visible pending seal may be shown as
sealing so sellers and buyers do not lose the state during confirmation, but
they belong in All/Unsealed until confirmation. Confirmed state remains
canonical. Unsealed listings are visible records, but not yet buyable. Active
books may sort by price high/low and arbitrage high/low when a reference price
exists.

Sales and listing logs are different from active books. They should be ordered
by confirmation status and event time, newest first, then txid for stable replay.
They should not use price or arbitrage sorting. Logs must be paginated so every
listing, seal, closure, delisting, and purchase remains inspectable.

## Spent Ticket Closure

The sale-ticket UTXO is the settlement primitive. Once that outpoint is spent by
a close transaction, the listing is no longer active. A valid `seal5` spend of
the ticket anchor is the exception: it makes the listing sealed/buyable and does
not close it.

- A valid `buy5` spend closes the listing and records a sale.
- A valid `delist5` spend closes the listing as a cancellation.
- Any other confirmed non-seal observed spend still removes the listing from the
  active book and records a closed-listing event for audit.

Pending outspends are best-effort mempool visibility. Confirmed outspends are
canonical. Production should use Bitcoin Core `gettxout` as the fast spend-state
oracle when configured, then use address-history and parsed `buy5`/`delist5`
events to classify the closure. Summary and history endpoints must refresh
credit state on explicit refresh, and any fast cached first paint must still
correct active listings against current spend state so a spent ticket cannot
remain displayed as active after the chain has moved.

## Sealed Listings

`pwid1:list5` and `pwid1:seal5` are split because the listing txid does not exist until after the listing transaction broadcasts.

Rules:

- `list5` creates the sale-ticket output and publishes unsigned sale terms.
- `seal5` must include an `anchorTxid` matching the listing txid.
- `seal5` must preserve the original sale terms, except for the added ticket signature and anchor txid.
- A `list5` record without a matching valid `seal5` is visible, but not purchasable.
- Wallets may return either an ECDSA partial signature or a Taproot key signature. The app and API must accept both when validating sealed sale tickets.

This keeps the listing public and chain-readable while making the buyer path atomic at the ProofOfWork UTXO layer.

## Delistings

Delistings are on-chain registry events:

```text
pwid1:delist5:<listing-txid>
```

A valid delisting must:

- Be funded by the current owner.
- Spend the sale-ticket UTXO.
- Pay the 546-proof mutation fee to the registry address.
- Reference the listing txid being canceled.

Automatic invalidation rules:

- Any confirmed `pwid1:t` ownership transfer cancels active listings for that ID.
- Any confirmed `pwid1:buy5` AMO purchase cancels active listings for that ID.
- Any confirmed credit `pwt1:buy5` sale-ticket spend closes the active credit listing and records the sale.
- Expired sale authorizations are ignored by the resolver.
- Delistings cancel the referenced listing after confirmation.

## Pending Visibility

Pending AMO events are UI status, not final ownership:

- Sellers see pending listings, seals, and delistings they funded.
- Buyers see pending buyer-funded transfers they broadcast.
- New owners or receivers see incoming pending transfers that target their wallet.
- Confirmed registry state remains the source of truth for active listings and ownership.
- Fresh reads should prune dropped pending AMO and credit txids from live overlays after liveness checks. Dropped pending txids may stay diagnosable for a short cache window, but they must not remain visible as active pending AMO state.

AMO broadcasts spend confirmed wallet UTXOs only. This keeps the visible fee
rate close to the effective package fee and avoids low-fee unconfirmed
ancestors trapping AMO actions in mempool.

## Historical Replay

Historical marketplace events remain readable so old registry history can be replayed:

```text
pwid1:list2 / pwid1:delist2 / pwid1:buy2
pwid1:list3 / pwid1:delist3 / pwid1:buy3
pwid1:list4 / pwid1:delist4 / pwid1:buy4
```

New clients must write `list5`, `seal5`, `delist5`, and `buy5`.

## General Asset Trading

IDs and Credits are the first AMO assets. AMO should stay asset-agnostic without
weakening the live ID or credit sale-ticket protocols.

Future asset classes can include:

- ProofOfWork IDs
- apps
- files
- code bundles
- other ProofOfWork-native records

The forward-compatible shape is a universal asset envelope:

```json
{
  "version": "pow-asset-v1",
  "type": "id",
  "locator": "pwid:proofs",
  "owner": "bc1...",
  "metadataHash": "sha256...",
  "transferMethod": "pwid1:buy5"
}
```

Listings can then sign a generic marketplace envelope:

```json
{
  "version": "pow-market-v1",
  "asset": {},
  "seller": "bc1...",
  "priceSats": 100000,
  "acceptedAssets": [],
  "paymentOutputs": [],
  "nonce": "random",
  "expiresAt": "2026-05-31T00:00:00.000Z"
}
```

This keeps IDs, apps, code, and files coherent under one marketplace without forcing every future asset into the ID event format.

## Asset-for-Asset Trades

Proofs-for-asset is the first settlement mode.

Asset-for-asset trades are a later phase because true atomic swaps require both assets to be enforceable in one settlement path. For ProofOfWork-native assets, that can be designed as one transaction containing:

- seller payment or asset consideration,
- registry or marketplace mutation fee,
- OP_RETURN transfer events,
- and enough signed terms for the indexer to verify the swap.

For assets outside the ProofOfWork protocol, the marketplace should require an adapter that can prove ownership and transfer finality.
