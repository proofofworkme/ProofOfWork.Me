# ProofOfWork.Me IDs

Planning notes for the next ProofOfWork.Me phase: human-readable on-chain mail IDs, backed by ProofOfWork OP_RETURN registry events.

## Developer Warning

Phase 1 is a canonical registry launch. Future developers and agents should treat this file as protocol documentation, not loose brainstorming.

Do not change these without an explicit migration plan:

- Mainnet registry address: `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e`
- Registration price: `1000` proofs
- Mutation price: `546` proofs for receiver updates, transfers, on-chain listings, delistings, and buyer-funded marketplace transfers
- Protocol prefix: `pwid1:`
- Registration event: `pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>`
- Receiver update event: `pwid1:u:<id-base64url>:<receive-address>`
- Transfer event: `pwid1:t:<id-base64url>:<new-owner-address>:<new-receive-address?>`
- Listing event: `pwid1:list5:<sale-ticket-json-base64url>`
- Sale-ticket seal event: `pwid1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>`
- Delisting event: `pwid1:delist5:<listing-txid>`
- Buyer-funded marketplace transfer event: `pwid1:buy5:<listing-txid>:<new-owner-address>:<new-receive-address?>`
- Resolver rule: first confirmed valid registration wins
- Casing rule: IDs are case-insensitive forever
- Pending rule: pending IDs are visible but not final, and mail must not route to them
- Pending mutation rule: pending receiver updates, transfers, listings, delistings, and buyer-funded transfers are visible to touched wallets as in-flight events, but do not alter canonical routing until confirmed
- Verification rule: X verification actions appear only for IDs owned by or routed to the connected wallet

Implementation anchors in `src/App.tsx`:

- `ID_REGISTRY_ADDRESSES`
- `fetchRegistryTransactions`
- `buildIdRegistrationPayload`
- `buildIdReceiverUpdatePayload`
- `buildIdTransferPayload`
- `buildIdListingPayload`
- `buildIdDelistingPayload`
- `buildIdMarketplaceTransferPayload`
- `parseIdEventPayload`
- `parseIdRegistrationPayload`
- `idRegistryStateFromTransactions`
- `resolveRecipientInput`
- `IdLaunchApp`
- `MarketplaceApp`
- `MarketplaceWorkspace`

## Concept

ProofOfWork.Me IDs are aliases like:

```text
user@proofofwork.me
```

They are not traditional DNS records. They are on-chain mail IDs resolved by the ProofOfWork.Me app/indexer.

- Registry events live in ProofOfWork OP_RETURN outputs.
- First valid registration wins.
- Registration requires a 1,000-proof payment to the canonical registry address.
- Receiver updates, transfers, listings, delistings, and buyer-funded marketplace transfers require a 546-proof mutation payment to the same canonical registry address.
- Transfers update the current owner/receiver.
- Marketplace listings publish sale terms on-chain from the current owner's wallet, while buyer-funded transfers execute those terms.
- Future messages resolve to the current receiver.
- The app resolves IDs by scanning registry history and applying valid events in chain order.
- All registry mutations use the same canonical registry address and pay the mutation fee.
- Pending registry mutations are shown as incoming/outgoing status for affected wallets so senders and receivers can see ID changes in transit.

## ID Model

Ownership and message delivery should be separate.

```text
ID: user@proofofwork.me
owner: pubkey/address that controls the ID asset
receiver: pubkey/address where messages are delivered
```

This lets an owner change the receiving address without selling the ID. It also lets a buyer receive future messages after the ID is transferred.

## Current Implementation

Mainnet registry address:

```text
bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e
```

Testnet and testnet4 registry addresses are not configured yet. The app only enables live ID registration on networks with a configured registry address.

Phase 1 launch surface:

```text
id.proofofwork.me
```

The ID subdomain renders a focused mainnet claim flow using the same registry address and `pwid1:r2` protocol. It is intentionally narrower than the full mail app: connect UniSat, check availability, register, view registry stats, view owned IDs, view public registry records, and verify owned/routed IDs on X. Do not put ID transfer, management, or marketplace tools on `id.proofofwork.me`; those belong in the Computer app and the standalone Marketplace app.
Inside `computer.proofofwork.me`, the IDs workspace is limited to registration, receiver updates, and direct owner transfers. Marketplace is a dedicated sidebar workspace for listing owned confirmed IDs and executing buyer-funded transfers.
All registry-facing UI surfaces should include search once the registry grows: public registry, owned IDs, pending ID events, active marketplace listings, and registry supply lists should be searchable by ID, full `user@proofofwork.me`, owner/receiver address, txid, network, status, and proofs where relevant.

Production domains:

```text
www.proofofwork.me          canonical landing page
proofofwork.me              permanent redirect to https://www.proofofwork.me/
id.proofofwork.me           focused ID registry app
computer.proofofwork.me     full mail/computer app
desktop.proofofwork.me      public read-only file desktop
browser.proofofwork.me      public HTML browser by txid
marketplace.proofofwork.me  standalone asset marketplace; IDs and credit sale-ticket markets live
credit.proofofwork.me       standalone credit creation and mint app
token.proofofwork.me        permanent redirect to https://credit.proofofwork.me/
tokens.proofofwork.me       permanent redirect to https://credit.proofofwork.me/
wallet.proofofwork.me      standalone credit wallet, transfer, listing, delisting, and sale-history app
work.proofofwork.me         standalone WORK credit dashboard and mint page
infinity.proofofwork.me     standalone Infinity Bond / POWB market and bond composer
log.proofofwork.me          public ProofOfWork Computer log
growth.proofofwork.me       public growth model dashboard
```

The ID subdomain is the first onboarding experience and should stay focused on claiming/resolving IDs, not reading mail.
The Desktop subdomain can resolve confirmed IDs for public file browsing, but it must not treat pending IDs as searchable/routable identities.
Confessions is staged/local-only for a Twitter-like 140-character social meta protocol over confirmed ProofOfWork IDs. It must not mutate the canonical `pwid1:` registry for follows, likes, reposts, or replies and must not be added to public production navigation until separately approved.
The Marketplace subdomain can connect UniSat, publish sale-ticket on-chain listings for owned confirmed IDs, seal or delist active listings, and execute buyer-funded `pwid1:buy5` transfers. It is tabbed by asset class: the ID tab is live, and the Credit tab uses the same sale-ticket shape for credit `list5`, `seal5`, `delist5`, and `buy5` records.
The Log subdomain is read-only. It exposes a unified ProofOfWork Computer log for registrations, receiver updates, direct transfers, listings, seals, delistings, purchases, messages, replies, files, attachments, credit creations, credit mints, credit transfers, credit listings, credit sales, and seeded Computer mail events. Log search is server-backed by the canonical livenet ledger, so address, confirmed ID, txid, participant, and token searches should agree with global Log.
The Credit subdomain creates and mints mint-first `pwt1:` credits. The `tokens` subdomain redirects to Credit. The Wallet subdomain tracks credit balances and broadcasts `pwt1:send` transfers that pay the credit registry. The WORK subdomain is the dedicated WORK credit dashboard. The Infinity subdomain tracks POWB supply/floor data, creates `pwm1:m:powb` bond messages, and reuses the credit sale-ticket lifecycle for POWB transfers and trades.
The Growth subdomain is read-only. It compares the canonical ID/Mail/Drive/Marketplace/Credit network-value model with confirmed registry, log, file, marketplace, and credit value metrics in proofs and USD. Growth, WORK, Log, and credit/token history should share one confirmed livenet ledger snapshot after refresh. WORK has a permanent floor derived from this confirmed network value: `work_floor_sats = confirmed_network_value_sats / 21,000,000 WORK`; the inverse `21,000,000 / confirmed_network_value_sats` is the WORK-per-proof ratio.

Local preview:

```text
http://localhost:5173/?id-launch=1
http://localhost:5173/?confessions=1
http://localhost:5173/?infinity=1
```

ID-only launch build:

```bash
VITE_ID_LAUNCH_ONLY=1 VITE_POW_API_BASE=https://id.proofofwork.me npm run build
```

Infinity-only production build:

```bash
VITE_INFINITY_ONLY=1 VITE_POW_API_BASE=https://infinity.proofofwork.me npm run build
```

Use that environment variable for the Phase 1 server so the full mail app stays hidden even if someone opens the bare IP address or a non-ID hostname.

Marketplace-only build:

```bash
VITE_MARKETPLACE_ONLY=1 VITE_POW_API_BASE=https://marketplace.proofofwork.me npm run build
```

Credit-only build:

```bash
VITE_TOKEN_ONLY=1 VITE_POW_API_BASE=https://credit.proofofwork.me npm run build
```

Credit-wallet-only build:

```bash
VITE_WALLET_ONLY=1 VITE_POW_API_BASE=https://wallet.proofofwork.me npm run build
```

WORK-credit-only build:

```bash
VITE_WORK_TOKEN_ONLY=1 VITE_POW_API_BASE=https://work.proofofwork.me npm run build
```

Log-only build:

```bash
VITE_LOG_ONLY=1 VITE_POW_API_BASE=https://log.proofofwork.me npm run build
```

Growth-only build:

```bash
VITE_GROWTH_ONLY=1 VITE_POW_API_BASE=https://growth.proofofwork.me npm run build
```

Current registration payload:

```text
pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>
```

Current mutation payloads:

```text
pwid1:u:<id-base64url>:<receive-address>
pwid1:t:<id-base64url>:<new-owner-address>:<new-receive-address?>
pwid1:list5:<sale-ticket-json-base64url>
pwid1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwid1:delist5:<listing-txid>
pwid1:buy5:<listing-txid>:<new-owner-address>:<new-receive-address?>
```

Rules:

- `pwid1:r2` registration transactions must pay at least `1000` proofs to the registry address.
- `pwid1:u`, `pwid1:t`, `pwid1:list5`, `pwid1:seal5`, `pwid1:delist5`, and `pwid1:buy5` transactions must pay at least `546` proofs to the registry address.
- The registry payment output must appear before the ID OP_RETURN output in the transaction.
- The OP_RETURN must start with `pwid1:`.
- Registrations, receiver updates, and transfers all use the same canonical registry address.
- Receiver updates and transfers must be paid from the current owner address, because the resolver verifies the current owner appears in the transaction inputs.
- `pwid1:u` changes only the receive address. The owner remains unchanged.
- `pwid1:t` changes ownership. If the new receive address is omitted, the new owner address also becomes the receive address.
- App UI may accept confirmed ProofOfWork IDs as transfer owner or receive targets, but the written `pwid1:u` and `pwid1:t` events must still contain resolved ProofOfWork addresses.
- `pwid1:list5` publishes sale terms as an active marketplace listing and creates a 546-proof seller-controlled sale-ticket UTXO in the listing transaction.
- `pwid1:seal5` publishes the seller's `SIGHASH_SINGLE|ANYONECANPAY` signature for the sale ticket after the listing txid exists, with `anchorTxid` set to the referenced listing txid.
- `pwid1:delist5` cancels an active listing by spending the sale ticket and paying the mutation fee.
- Any confirmed ownership transfer through `pwid1:t` or `pwid1:buy5` automatically invalidates all active listings for that ID.
- `pwid1:buy5` changes ownership using active on-chain sale terms from a current-owner `list5` transaction and matching `seal5` event. The buyer must spend the sale ticket, so competing buys conflict as double-spends.
- A `buy5` transaction must pay the 546-proof mutation fee before the ID OP_RETURN and must also pay the listed sale price plus ticket value to the current owner before the ID OP_RETURN.
- A `list5` sale authorization uses JSON version `pwid-sale-v4` and includes the ID, seller address, seller public key, price, optional buyer lock, optional receive-address lock, nonce, optional expiry, sale-ticket vout/value/script, and a `sale-ticket-v1` anchor type. A matching `seal5` adds the seller's `SIGHASH_SINGLE|ANYONECANPAY` anchor signature.
- A `seal5` is valid only when its sealed authorization keeps the same terms as the `list5` authorization and its `anchorTxid` equals the listing txid. Listings without a matching valid seal are visible but not purchasable.
- Sale-ticket seals may use wallet-returned ECDSA partial signatures or Taproot key signatures.
- The resolver applies `buy5` only when the referenced active listing exists, the current owner still matches the seller, the transaction spends the sale ticket, seller payment is sufficient, and the buyer/receiver constraints match the event.
- Historical `pwid1:list2`, `pwid1:delist2`, `pwid1:buy2`, `pwid1:list3`, `pwid1:delist3`, `pwid1:buy3`, `pwid1:list4`, `pwid1:delist4`, and `pwid1:buy4` events remain readable for replay, but new marketplace writes must use `list5`/`seal5`/`delist5`/`buy5`.
- Sale terms are public on-chain listing objects. Anyone can execute an open sealed listing by paying the listed price, refunding the ticket, paying the mutation fee, and spending the sale ticket.
- IDs are case-insensitive forever. `User`, `user`, and `USER` all resolve to `user`.
- The app normalizes IDs to lowercase for writing, display, lookup, and first-claim comparisons.
- There is no arbitrary app-level ID length or character whitelist.
- Fresh registrations encode the ID field as base64url so punctuation and Unicode cannot break the colon-delimited registry format.
- The real size ceiling is the transaction's aggregate OP_RETURN data-carrier script limit of `100,000` bytes.
- Long IDs naturally cost more in bytes and fees, so the market prices them.
- Legacy `pwid1:r:<id>:...` registrations can still be read if their fields are parseable.
- New clients must write `r2`, not legacy `r`.
- First confirmed valid registration wins.
- Pending registrations can be displayed, but are not final.
- Pending transfers/receiver updates are not applied to canonical routing until confirmed.
- Pending `u`, `t`, `list5`, `seal5`, `delist5`, and `buy5` events should be exposed separately from confirmed records. The sender/current owner sees outgoing events; the new owner or new receiver sees incoming events; marketplace participants see listing, sealing, delisting, and purchase events that touch their wallet.
- The compose flow must not route mail to a pending ID. IDs are sendable only after a confirmed registry record resolves to a receive address.
- Public Desktop search follows the same confirmed-only ID resolver rule.
- Duplicate confirmed registrations are ignored by the resolver.
- Registry scans must paginate full confirmed address history and merge mempool transactions before applying first-confirmed-wins. Reading only the first mempool.space address page can hide older confirmed winners and make duplicates look available or pending.
- Production registry reads should go through the ProofOfWork OP_RETURN API. Stable confirmed registry records, activity, listings, and sales can read from the proof index database, with canonical node/API fallback for fresh reads, pending visibility, rechecks before broadcast, and edge verification.
- Registration broadcasts must re-check the full registry immediately before building/signing the PSBT.
- Every ProofOfWork.Me broadcast path should use confirmed wallet UTXOs only, including mail/files, registration, receiver update, transfer, listing, delisting, and marketplace purchase broadcasts. This keeps the chosen fee rate aligned with the transaction's effective package fee and avoids low-fee unconfirmed ancestors trapping user actions in mempool.
- Owner and receive address are separate fields.
- PGP public key data is optional and base64url encoded in the registration payload.
- After broadcast, the app can open a prefilled X post that includes the ID and registry tx link as optional social proof.
- Verification actions should appear only for IDs owned by or routed to the connected wallet, never for unrelated public registry records.
- Confirmed registry rows in the Computer app can be saved as local Contacts. Pending IDs must not be saved as routable contacts.

## Social Verification

X verification is not part of consensus. It is a public attestation layer.

The chain remains canonical:

- The ID is owned by the first confirmed valid registry transaction.
- The X post only proves the registrant chose to publicly associate an account with that transaction.
- The app can generate a prefilled post with the ID and mempool transaction link only from the owner's/routed wallet view.
- Future ID-level verification metadata can store an X proof URL on-chain with a `pwid1:meta` event. Confessions social profile metadata is separate staged `pwc1:profile` state and must not mutate the canonical ID registry.

## Staged Confessions Social

Confessions is a future/staged ProofOfWork ID social meta protocol. It uses confirmed PowIDs for accounts and their current receiver addresses as payment lanes, but it does not change the canonical `pwid1:` registry rules.

Public app/domain launch is not approved. Keep the UI local/staged until launch scope changes.

Planned OP_RETURN events:

```text
pwc1:profile:<profile-json-base64url>
pwc1:post:<post-json-base64url>
pwc1:reply:<parent-txid>:<post-json-base64url>
pwc1:like:<target-txid>
pwc1:repost:<target-txid>
pwc1:follow:<target-id-base64url>
pwc1:tip:<target-id-base64url>:<amount-proofs>
pwc1:hide:<target-txid>
```

Rules to preserve:

- Confessions and replies are capped at 140 user-visible characters.
- Every confirmed PowID has a blank Confessions profile by default. The default location is `ProofOfWork`.
- Profile metadata uses `pwc1:profile:<profile-json-base64url>` and requires 546 proofs to the owner's own confirmed PowID receiver. Newer confirmed profile proofs replace older profile fields.
- Profile fields are capped at 50 characters for name, 160 for bio, 30 for location, and 100 for website. Birthday is optional. Profile banner images are Files-backed references capped at 100 KB and ride the same 546-proof `pwc1:profile` proof to the owner's own PowID receiver.
- Post JSON may include links and one image attachment reference under 100 KB before encoding, while the final transaction must still fit the aggregate OP_RETURN limit. The image bytes should be stored through the ProofOfWork Files attachment layer; Confessions records should point to the file txid/proof/hash/size instead of carrying raw image bytes.
- Images should render inline in feeds and profiles from Files, while detailed views can expose their size and hash proof.
- Social accounts resolve only through confirmed ProofOfWork IDs.
- The staged Confessions UI should derive profile shells and payment receivers from confirmed `pwid1` registry records only; preview-only social accounts must not masquerade as real PowIDs.
- Pending IDs can be displayed but are not valid account targets.
- Likes, reposts, follows, and paid replies require at least 546 proofs to the immediate target's confirmed PowID receiver before the `pwc1:` OP_RETURN.
- Following someone pays 546 proofs to that user's confirmed PowID receiver and creates the confirmed follow graph.
- Tips pay any user-chosen amount to the target profile's confirmed PowID receiver.
- Profiles should show who follows the user, who the user follows, confirmed social proofs earned by source, pending incoming social proofs separately, and WORK balance when available.
- Profiles should expose Posts, Replies, Likes, and Media tabs. Reposts appear inline in the Posts timeline, not as a separate tab. Proofs/earnings remain in the profile summary.
- Authors can archive/hide their own Confessions from default app/profile indexing with a 546-proof `pwc1:hide` event. This is a visibility tombstone, not deletion from ProofOfWork.
- The Following timeline shows only followed PowID posts, ordered by post time.
- Likes, reposts, and replies are disabled until the target post or reply is confirmed.
- A reply to a reply pays the author of the parent reply, not automatically the original post author.
- Confirmed ProofOfWork history is canonical. Pending Confessions records are only visibility.
- Wallet signing stays local.

## Future Metaprotocol

Everything below this point is future planning. It must not silently change Phase 1 behavior.

The metaprotocol is marketplace-ready from the start. Live events are repeated here for context; future events must remain compatible with the live registry rules above.

Possible registry events:

```text
pwid1:r2:<id-base64url>:<owner>:<receiver>:<pgp-public-key-base64url?>
pwid1:u:<id-base64url>:<receiver>
pwid1:t:<id-base64url>:<new-owner>:<new-receiver?>
pwid1:list5:<sale-ticket-json-base64url>
pwid1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwid1:delist5:<listing-txid>
pwid1:buy5:<listing-txid>:<new-owner>:<new-receiver?>
pwid1:k:<id-base64url>:<pgp-public-key-base64url>
pwid1:bid:<id-base64url>:<bidder>:<price>:<currency>
pwid1:accept:<id-base64url>:<bid-txid>
pwid1:meta:<id-base64url>:<metadata>
```

Rules to preserve:

- All event ID fields should be base64url encoded and normalized case-insensitively by resolvers.
- `r2` is valid only if the ID is unclaimed.
- `r2` requires at least `1000` proofs to the registry address.
- `u`, `t`, `k`, `list5`, `seal5`, `delist5`, and `accept` are valid only from the current owner.
- `u`, `t`, `list5`, `seal5`, `delist5`, and `buy5` require at least `546` proofs to the registry address.
- `u`, `t`, `list5`, `seal5`, `delist5`, and `buy5` are live registry events.
- `buy5` is valid only with a matching active sealed sale-ticket listing, a spent sale ticket, and matching seller payment.
- `buy5` is valid only against current ownership; marketplace UIs should prefer active sealed `list5` listings.
- Marketplace events should be verifiable from chain history.
- The resolver should expose both current owner and current receiver.

## Marketplace Readiness

IDs should behave like transferable assets.

- Owners can list IDs for sale.
- Buyers can purchase listed IDs.
- Seller-funded direct transfers use `pwid1:t`.
- On-chain listings use `pwid1:list5` plus a `pwid-sale-v4` sale ticket and `pwid1:seal5` seller signature.
- Buyer-funded purchases use `pwid1:buy5`.
- Bidders can place offers.
- Owners can accept bids.
- Owners can delist IDs with `pwid1:delist5`.
- Marketplaces can verify current ownership from the chain.
- The current receiver determines where new mail is delivered.

## Node Purpose

The node is only for ProofOfWork.Me infrastructure.

- It does not hold funds.
- It does not hold private keys.
- It does not sign transactions.
- Users keep funds in UniSat or other wallets.
- Users sign locally in the browser.
- The backend/node reads, indexes, verifies, and optionally broadcasts already-signed transactions.

## Architecture

The app remains static/browser-first at the UI layer, while production reads and broadcasts through the first-party ProofOfWork node/API stack.

```text
Static frontend
  -> ProofOfWork.Me API/indexer
  -> private mempool/electrs API
  -> Bitcoin Core full node
```

Transaction flow:

```text
User wallet signs locally
  -> ProofOfWork.Me API receives signed tx
  -> Bitcoin Core broadcasts/verifies
  -> Indexer watches blocks/mempool
```

## Node/API Role

Production ProofOfWork.Me works with UniSat for local signing and the first-party node/API for chain reads, transaction preparation, broadcast, indexing, BTC/USD, and tx status. Public mempool.space is an explorer link target, not an application data dependency.

The node/API stack provides:

- Reliability.
- Privacy.
- Broadcast control.
- Registry indexing.
- Alias resolution.
- Independence from public APIs.
- Live BTC/USD from the ProofOfWork node price endpoint.
- Stale-while-refresh caches for expensive registry, credit, log, Growth, and WORK floor reads, with one canonical livenet ledger payload shared across Log, WORK, Growth, and credit/token history.

Bitcoin Core alone does not provide an easy address-history or OP_RETURN protocol-search API. ProofOfWork.Me should use Bitcoin Core with an indexer.

Current indexer/API shape:

```text
server/proof-api.mjs
  -> private mempool/electrs API
  -> optional Bitcoin Core RPC diagnostics for testmempoolaccept
```

Production apps are built with app-domain API bases:

```bash
VITE_POW_API_BASE=https://computer.proofofwork.me npm run build
```

For ID safety, production must use this API/node path. If the first-party API is unavailable, it is safer for ID registration/routing to fail closed than to create duplicates from incomplete public API state.

Phase 1 production uses same-origin API proxies:

```text
https://www.proofofwork.me/api/*
https://id.proofofwork.me/api/*
https://computer.proofofwork.me/api/*
https://desktop.proofofwork.me/api/*
https://browser.proofofwork.me/api/*
https://marketplace.proofofwork.me/api/*
https://credit.proofofwork.me/api/*
https://work.proofofwork.me/api/*
https://log.proofofwork.me/api/*
https://growth.proofofwork.me/api/*
```

Pending registry records are useful for network visibility, but first-confirmed-wins only becomes final after block confirmation. Pending IDs must never be routable in compose.

## VPS Specs

Suggested infrastructure sizes:

| Use | Specs |
| --- | --- |
| Bare full node | 2 vCPU, 4 GB RAM, 1 TB SSD |
| Comfortable node | 4 vCPU, 8 GB RAM, 1-2 TB NVMe |
| ProofOfWork.Me node + indexer | 4-8 vCPU, 16 GB RAM, 2 TB NVMe |

Recommended starting point:

```text
4 vCPU
8 GB RAM
2 TB NVMe
Unmetered bandwidth
```

Important notes:

- Use SSD/NVMe, not HDD.
- Do not expose Bitcoin Core RPC publicly.
- Open port `8333` only for Bitcoin P2P/inbound peers.
- Do not prune if complete historical registry/mail indexing matters.
- Use `txindex=1` or a dedicated indexer depending on final backend design.

## Big Picture

ProofOfWork.Me stays browser-native for users and sovereign at the data layer.

- Static clients render the Computer and standalone app surfaces.
- UniSat signs locally.
- The ProofOfWork API reads, indexes, verifies, prepares, and broadcasts already-signed transactions through the node stack.
- IDs, credit balances, credit markets, wallet movements, Log, Growth, and WORK floor are replayed from confirmed ProofOfWork history.
- Pending mempool data is useful visibility, not canonical state.
- The backend improves data access without becoming custodial.
