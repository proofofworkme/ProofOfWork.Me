# ProofOfWork Marketplace

## Product Boundaries

- `id.proofofwork.me` is registration-only.
- `computer.proofofwork.me` contains the authenticated Marketplace workspace.
- `marketplace.proofofwork.me` is the standalone asset marketplace app.

Marketplace is organized by asset tabs. IDs, Credits, POWB, and INCB are live trading
classes. These asset classes use sale-ticket settlement so the buyer path spends
a scarce UTXO, pays the seller, pays the registry mutation fee, and writes a
chain-readable transfer/purchase event.
- `log.proofofwork.me` is the public read-only ProofOfWork Computer log for tx-backed app actions.
- The IDs workspace is for registration, receiver updates, and direct owner transfers only.
- Marketplace is for on-chain listings, seals, delistings, buyer-funded purchases, credit sales, and future asset trades.
- Marketplace actions with txids should be visible in Log, including listing tx, seal tx, delisting tx, buyer-funded transfer/buy tx, credit sale tx, and sale-ticket UTXO references.
- Marketplace attention metrics should be derived from valid chain events: active listings, ID sale count, credit sale count, seller-price sale volume, credit sale volume, and marketplace mutation-fee flow.
- POWB and INCB market actions use the same credit sale-ticket machinery under their reserved synthetic assets. POWB supply comes directly from confirmed `pwm1:m:powb` recipient proof payments. INCB valuation and issuance amount come from direct bond proofs plus attached WORK valued by the send-time oracle: the last confirmed green canonical live WORK summary at H-1, hash-bound to the exact previous block. Every transaction in the bond block is excluded. Confirmation fixes the resulting balance and supply. Neither asset can be issued by `pwt1:mint`.

## Current ID Marketplace Model

The live marketplace writes on-chain listing-book events to the same canonical ProofOfWork ID registry address.

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

The marketplace reports realized ID sale data from resolver-accepted buyer-funded transfers.

- Public sale count starts with the live sale-ticket marketplace and increments for valid `buy5` purchases.
- Historical valid `buy2`/`buy3`/`buy4` purchases remain replayable protocol history, but they are not counted in the public marketplace sales metric.
- Sale volume is the seller price in proofs, excluding the 546-proof registry mutation fee and excluding sale-ticket refunds.
- Marketplace flow for Growth and WORK floor accounting is seller sale volume plus marketplace mutation fees from listing, seal, delisting, and buy events.
- Seller sale volume remains a separate public metric. Do not fold mutation fees into seller volume, and do not count marketplace mutation fees again as generic Computer event flow.
- WORK credit sales add more than seller price. For canonical WORK only, the amount of WORK moved also contributes credit movement network value: frozen value at the live WORK floor when the sale confirms, and live value at the current live WORK floor thereafter. Negative or positive buyer arb is spread information only; it does not redefine the network floor.
- Non-WORK credit sales do not inherit WORK's movement-value lane. They contribute their confirmed sale payments, registry/mutation fees, and marketplace flow, but their own listing floors are not network value because illiquid listings can be manipulated.
- Confirmed sales are canonical.
- Pending sales are mempool-visible only until confirmation.

## Current Credit Marketplace Model

The live credit marketplace writes sale-ticket events to each credit's own
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

Wallet and Marketplace both use this model. Wallet is the connected-address
ownership/action surface; Marketplace is the public discovery and purchase
surface.

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
payment lane. A bond transaction may attach canonical WORK through a separate
`pwt1:send`. When that attachment is valid, confirmed, recipient-matched, and in
the same transaction, its value uses the live WORK floor from that canonical
H-1 summary.

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
value. Confirmation fixes the resulting INCB balance and supply. Current and
post-bond network value change only the live INCB floor; they cannot
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

Marketplace books should stay asset-agnostic as new product classes are added.
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
- Any confirmed `pwid1:buy5` marketplace transfer cancels active listings for that ID.
- Any confirmed credit `pwt1:buy5` sale-ticket spend closes the active credit listing and records the sale.
- Expired sale authorizations are ignored by the resolver.
- Delistings cancel the referenced listing after confirmation.

## Pending Visibility

Pending marketplace events are UI status, not final ownership:

- Sellers see pending listings, seals, and delistings they funded.
- Buyers see pending buyer-funded transfers they broadcast.
- New owners or receivers see incoming pending transfers that target their wallet.
- Confirmed registry state remains the source of truth for active listings and ownership.
- Fresh reads should prune dropped pending marketplace and credit txids from live overlays after liveness checks. Dropped pending txids may stay diagnosable for a short cache window, but they must not remain visible as active pending marketplace state.

Marketplace broadcasts spend confirmed wallet UTXOs only. This keeps the visible fee rate close to the effective package fee and avoids low-fee unconfirmed ancestors trapping marketplace actions in mempool.

## Historical Replay

Historical marketplace events remain readable so old registry history can be replayed:

```text
pwid1:list2 / pwid1:delist2 / pwid1:buy2
pwid1:list3 / pwid1:delist3 / pwid1:buy3
pwid1:list4 / pwid1:delist4 / pwid1:buy4
```

New clients must write `list5`, `seal5`, `delist5`, and `buy5`.

## General Asset Trading

IDs and Credits are the first marketplace assets. The long-term marketplace should stay asset-agnostic without weakening the live ID or credit sale-ticket protocols.

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
