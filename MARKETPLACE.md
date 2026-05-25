# ProofOfWork Marketplace

## Product Boundaries

- `id.proofofwork.me` is registration-only.
- `computer.proofofwork.me` contains the authenticated Marketplace workspace.
- `marketplace.proofofwork.me` is the standalone asset marketplace app.

Marketplace is organized by asset tabs. IDs and Tokens are both live trading
tabs. Both asset classes use sale-ticket settlement so the buyer path spends a
scarce UTXO, pays the seller, pays the registry mutation fee, and writes a
chain-readable transfer/purchase event.
- `log.proofofwork.me` is the public read-only Bitcoin Computer log for tx-backed app actions.
- The IDs workspace is for registration, receiver updates, and direct owner transfers only.
- Marketplace is for on-chain listings, seals, delistings, buyer-funded purchases, token sales, and future asset trades.
- Marketplace actions with txids should be visible in Log, including listing tx, seal tx, delisting tx, buyer-funded transfer/buy tx, token sale tx, and sale-ticket UTXO references.
- Marketplace attention metrics should be derived from valid chain events: active listings, ID sale count, token sale count, seller-price sale volume, and token sale volume.

## Current ID Marketplace Model

The live marketplace writes on-chain listing-book events to the same canonical ProofOfWork ID registry address.

Current events:

```text
pwid1:list5:<sale-ticket-json-base64url>
pwid1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwid1:delist5:<listing-txid>
pwid1:buy5:<listing-txid>:<new-owner-address>:<new-receive-address?>
```

Each listing mutation pays the 546 sat registry mutation fee. The confirmed chain is canonical; pending events are only best-effort mempool visibility.

The current flow:

1. The current ID owner chooses an owned confirmed ID.
2. The owner enters sale terms with price, optional buyer lock, optional receive-address lock, nonce, and optional expiry.
3. The app publishes `pwid1:list5` and creates a 546 sat seller-controlled sale-ticket UTXO in the listing transaction.
4. After the listing txid exists, the seller publishes `pwid1:seal5` with a `SIGHASH_SINGLE|ANYONECANPAY` signature for the sale ticket.
5. A buyer funds one `pwid1:buy5` transaction that spends the sale ticket, pays the seller price plus ticket value, pays the 546 sat registry mutation fee, and writes the ID transfer event.
6. The resolver accepts the purchase only if the listing is active and sealed, the seller is still the current owner, the sale ticket is spent, seller payment is sufficient, and buyer/receiver constraints match.

The sale ticket is the scarce settlement point. Competing buyers must spend the same outpoint, so only one purchase can confirm. A vandal cannot consume the ticket without paying the seller the required price plus the ticket value.

## Sales Metrics

The marketplace reports realized ID sale data from resolver-accepted buyer-funded transfers.

- Public sale count starts with the live sale-ticket marketplace and increments for valid `buy5` purchases.
- Historical valid `buy2`/`buy3`/`buy4` purchases remain replayable protocol history, but they are not counted in the public marketplace sales metric.
- Sale volume is the seller price in sats, excluding the 546 sat registry mutation fee and excluding sale-ticket refunds.
- Confirmed sales are canonical.
- Pending sales are mempool-visible only until confirmation.

## Current Token Marketplace Model

The live token marketplace writes sale-ticket events to each token's own
registry address.

Current events:

```text
pwt1:list5:<sale-ticket-json-base64url>
pwt1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwt1:delist5:<listing-txid>
pwt1:buy5:<listing-txid>:<buyer-address>
```

Each token mutation pays the 546 sat token registry mutation fee. Token
creation still pays the macro token index, but mints, transfers, listings,
seals, delistings, and buys pay the token's own registry directly.

The current flow:

1. A token holder chooses a confirmed balance.
2. The holder publishes `pwt1:list5`, which reserves spendable token balance and creates a 546 sat seller-controlled sale-ticket UTXO.
3. After the listing txid exists, the seller publishes `pwt1:seal5` with a `SIGHASH_SINGLE|ANYONECANPAY` signature for the sale ticket.
4. A buyer funds one `pwt1:buy5` transaction that spends the sale ticket, pays the seller price plus ticket value, pays the 546 sat token registry mutation fee, and writes the buy event.
5. The token resolver accepts the purchase only if the listing is active and sealed, the seller still has spendable balance, the sale ticket is spent, seller payment is sufficient, and buyer constraints match.

Wallet and Marketplace both use this model. Wallet is the connected-address
ownership/action surface; Marketplace is the public discovery and purchase
surface.

## Order Books And Logs

Marketplace books should stay asset-agnostic as new product classes are added.
For any sale-ticket product, the active book should expose:

- All listings
- Sealed listings
- Unsealed listings

Sealed listings are buyable when the seller signature and sale-ticket anchor are
valid. Unsealed listings are visible records, but not yet buyable. Active books
may sort by price high/low and arbitrage high/low when a reference price exists.

Sales and listing logs are different from active books. They should be ordered
by confirmation status and event time, newest first, then txid for stable replay.
They should not use price or arbitrage sorting. Logs must be paginated so every
listing, seal, closure, delisting, and purchase remains inspectable.

## Spent Ticket Closure

The sale-ticket UTXO is the settlement primitive. Once that outpoint is spent,
the listing is no longer active.

- A valid `buy5` spend closes the listing and records a sale.
- A valid `delist5` spend closes the listing as a cancellation.
- Any other observed spend still removes the listing from the active book and
  records a closed-listing event for audit.

Pending outspends are best-effort mempool visibility. Confirmed outspends are
canonical. Summary and history endpoints must refresh token state on explicit
refresh so a spent ticket cannot remain displayed as an active listing after the
chain has moved.

## Sealed Listings

`pwid1:list5` and `pwid1:seal5` are split because the listing txid does not exist until after the listing transaction broadcasts.

Rules:

- `list5` creates the sale-ticket output and publishes unsigned sale terms.
- `seal5` must include an `anchorTxid` matching the listing txid.
- `seal5` must preserve the original sale terms, except for the added ticket signature and anchor txid.
- A `list5` record without a matching valid `seal5` is visible, but not purchasable.
- Wallets may return either an ECDSA partial signature or a Taproot key signature. The app and API must accept both when validating sealed sale tickets.

This keeps the listing public and chain-readable while making the buyer path atomic at the Bitcoin UTXO layer.

## Delistings

Delistings are on-chain registry events:

```text
pwid1:delist5:<listing-txid>
```

A valid delisting must:

- Be funded by the current owner.
- Spend the sale-ticket UTXO.
- Pay the 546 sat mutation fee to the registry address.
- Reference the listing txid being canceled.

Automatic invalidation rules:

- Any confirmed `pwid1:t` ownership transfer cancels active listings for that ID.
- Any confirmed `pwid1:buy5` marketplace transfer cancels active listings for that ID.
- Any confirmed token `pwt1:buy5` sale-ticket spend closes the active token listing and records the sale.
- Expired sale authorizations are ignored by the resolver.
- Delistings cancel the referenced listing after confirmation.

## Pending Visibility

Pending marketplace events are UI status, not final ownership:

- Sellers see pending listings, seals, and delistings they funded.
- Buyers see pending buyer-funded transfers they broadcast.
- New owners or receivers see incoming pending transfers that target their wallet.
- Confirmed registry state remains the source of truth for active listings and ownership.

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

IDs and Tokens are the first marketplace assets. The long-term marketplace should stay asset-agnostic without weakening the live ID or token sale-ticket protocols.

Future asset classes can include:

- ProofOfWork IDs
- apps
- files
- code bundles
- other Bitcoin-native records

The forward-compatible shape is a universal asset envelope:

```json
{
  "version": "pow-asset-v1",
  "type": "id",
  "locator": "pwid:bitcoin",
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

Sats-for-asset is the first settlement mode.

Asset-for-asset trades are a later phase because true atomic swaps require both assets to be enforceable in one settlement path. For ProofOfWork-native assets, that can be designed as one transaction containing:

- seller payment or asset consideration,
- registry or marketplace mutation fee,
- OP_RETURN transfer events,
- and enough signed terms for the indexer to verify the swap.

For assets outside the ProofOfWork protocol, the marketplace should require an adapter that can prove ownership and transfer finality.
