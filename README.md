# ProofOfWork.Me

ProofOfWork-native mail and ProofOfWork ID registry, written to ProofOfWork OP_RETURN outputs and signed locally with UniSat.

## For Agents

Before modifying ProofOfWork.Me, read `SOUL.md`.

This repository is built for agent collaboration. `SOUL.md` explains the project's voice, thesis, and long-term direction. Protocol behavior lives in `README.md`, `PROOFOFWORK_IDS.md`, `MARKETPLACE.md`, and the source code.

Public language uses `proofs` for sat-denominated value across ProofOfWork.Me social copy, dashboards, and user-facing labels. Agents must still preserve exact protocol/API names such as `amountSats`, `priceSats`, `paidSats`, `networkValueSats`, and `floorSats`; `proofs` is display language, not a JSON or serialized protocol rename. Daily WORK and PowID tweet structure lives in `SOUL.md`.

## Phase 1 Launch

The public front door is:

```text
www.proofofwork.me
```

The apex domain redirects permanently to the canonical `www` front door:

```text
proofofwork.me -> https://www.proofofwork.me/
```

The front door renders a focused landing page that routes users to the production apps:

```text
id.proofofwork.me
computer.proofofwork.me
desktop.proofofwork.me
browser.proofofwork.me
marketplace.proofofwork.me
credit.proofofwork.me
token.proofofwork.me -> https://credit.proofofwork.me/
tokens.proofofwork.me -> https://credit.proofofwork.me/
wallet.proofofwork.me
work.proofofwork.me
infinity.proofofwork.me
log.proofofwork.me
growth.proofofwork.me
```

Production app roles:

- `www.proofofwork.me` is the canonical landing/router page.
- `proofofwork.me` redirects to `https://www.proofofwork.me/`.
- `id.proofofwork.me` is the focused Phase 1 ID registry onboarding app.
- `computer.proofofwork.me` is the full ProofOfWork.Me mail/computer app.
- `desktop.proofofwork.me` is the standalone public read-only file search engine for addresses or confirmed ProofOfWork IDs.
- `browser.proofofwork.me` is the standalone public HTML renderer for ProofOfWork message bodies or verified file attachments by txid.
- `marketplace.proofofwork.me` is the standalone asset marketplace. The IDs tab is live for ProofOfWork ID listings and buyer-funded transfers; the Credits tab is live for credit sale-ticket listings, sealed purchases, and market discovery.
- `credit.proofofwork.me` is the standalone mainnet credit creation and mint app.
- `token.proofofwork.me` and `tokens.proofofwork.me` redirect permanently to `https://credit.proofofwork.me/`.
- `wallet.proofofwork.me` is the standalone credit wallet for confirmed balances, transfers, listings, delistings, and sale history touching the connected address.
- `work.proofofwork.me` is the standalone WORK credit dashboard and mint page.
- `infinity.proofofwork.me` is the standalone Infinity Bond / POWB market and bond composer.
- `log.proofofwork.me` is the standalone public ProofOfWork Computer log for tx-backed ProofOfWork actions.
- `growth.proofofwork.me` is the standalone public growth dashboard comparing modeled ProofOfWork Computer network value with real confirmed chain value in proofs and USD.
- The root landing page can feature public on-chain social proof, with testimonial links pointing directly to their ProofOfWork transactions.
- The landing page links to the current public YouTube overview video.

Every public app header and footer should expose the current public surfaces: Home, IDs, Computer, Desktop, Browser, Marketplace, Credit, Wallet, WORK, Infinity, Log, and Growth. Public social links should include X, YouTube, and GitHub.

Official YouTube:

```text
https://www.youtube.com/@proofofworkme
```

The Phase 1 registry onboarding flow is:

```text
id.proofofwork.me
```

This subdomain renders a focused mainnet ProofOfWork ID claim app from the same codebase. It must use the canonical registry address and the same `pwid1:r2` protocol as the full mail app.

Canonical mainnet registry:

```text
bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e
```

Launch invariants for future developers/agents:

- Do not create a second registry address for Phase 1.
- Do not create a separate ID protocol for `id.proofofwork.me`.
- Do not make pending IDs routable in compose.
- Do not show X verification actions for unrelated public registry rows.
- Keep wallet signing local. The app must not handle seed phrases or private keys.
- Keep IDs case-insensitive and normalized to lowercase for comparisons.
- Keep the real ID size cap tied to the aggregate 100 KB OP_RETURN data-carrier limit, not arbitrary character rules.

## What It Does

- Connects UniSat.
- Switches UniSat between testnet4, testnet3, and mainnet.
- Sends ProofOfWork payments to one or more recipient addresses or confirmed ProofOfWork IDs.
- Builds a PSBT with ProofOfWork payment outputs, ProofOfWork.Me OP_RETURN outputs, and change.
- Uses UniSat to sign the PSBT, then broadcasts signed hex through the first-party ProofOfWork node API.
- Shows the txid and an external explorer link.
- Scans the connected address for incoming and sent ProofOfWork.Me OP_RETURN payments.
- Refreshes on demand to rescan address mail and check pending transaction statuses.
- Keeps unconfirmed inbound mail in Incoming until it confirms.
- Shows confirmed inbound mail in Inbox.
- Tracks local broadcast attempts as pending, confirmed, or dropped.
- Keeps pending and dropped broadcasts in Outbox.
- Checks pending broadcasts with the full transaction lookup so missing txs become dropped instead of staying pending forever.
- Lets dropped broadcasts be rebuilt from their local draft data; users must sign a fresh transaction to resend.
- Recovers confirmed sent mail from chain data, so Sent and Files do not depend only on browser history.
- Sorts Incoming, Inbox, and Sent by highest proofs, newest, oldest, or thread.
- Supports an optional Subject field written into the ProofOfWork.Me OP_RETURN protocol.
- Replies to a message by embedding the parent txid so messages can form threads.
- Supports Reply All for multi-recipient messages.
- Supports CC in compose as visible additional payment-output recipients. The sender's local app preserves To/CC roles for sent mail; the chain itself only exposes recipients as payment outputs.
- Infers the sender from transaction inputs instead of storing an address in OP_RETURN.
- Shows self-sends in Incoming/Inbox and Outbox/Sent based on confirmation state.
- Auto-saves one local draft per wallet and network until the message is broadcast or discarded.
- Favorites confirmed mail locally so important messages stay easy to find.
- Archives messages locally so they leave Inbox/Sent without deleting the on-chain record.
- Lets users create local custom folders and file confirmed mail into any folder name.
- Saves local Contacts for addresses or confirmed ProofOfWork IDs.
- Adds confirmed registry IDs to Contacts from the Computer app's ID registry rows.
- Uses saved Contacts as compose suggestions.
- Accepts multiple compose recipients separated by commas, semicolons, or new lines, with removable recipient chips.
- Exports and imports local app data backups for contacts, drafts, archives, favorites, custom folders, and broadcast tracking.
- Supports one small attachment per message, capped at 60,000 bytes before encoding.
- Adds a desktop-style Files section for confirmed attachment-only browsing, filtering, sorting, in-app previews, download, and opening the source message.
- Previews images, PDFs, audio, video, text, Markdown, JSON, and code files directly in the app, with copy support for text/code content.
- Adds a standalone public Desktop app that searches any ProofOfWork address or confirmed ProofOfWork ID and displays/previews confirmed public attachments without a wallet connection.
- Adds a standalone public Browser app that loads a txid, renders HTML from a message body or verified `text/html` attachment in a sandbox, and exposes a Computer-native HTML template.
- Keeps wallet signing outside Browser-rendered HTML pages.
- Exposes Browser as a first-class Computer sidebar workspace, so HTML pages are part of the ProofOfWork Computer and not only a standalone subdomain.
- Stages Confessions as a 140-character social app for ProofOfWork IDs. Links, Files-backed small image attachments, editable social profiles, replies, likes, reposts, follows, tips, profile earnings, and the Following timeline are planned as a separate `pwc1:` meta protocol, not as ID registry mutations.
- Pins the canonical `Welcome to ProofOfWork.Me.html` ProofOfWork Computer page as a default system file in Files/Desktop, opening through Browser by txid.
- Projects Browser-readable HTML message bodies into Files/Desktop as virtual `.html` files, so users can send HTML as a message body without needing an attachment.
- Supports fractional fee rates, including sub-1 proof/vB values like `0.1`.
- Uses the correct external explorer path for the connected chain, including `/testnet4`.
- Registers and scans mainnet ProofOfWork IDs through the canonical registry address.
- Searches ID registry records, owned IDs, pending ID events, marketplace listings, and registry supply views across the app.
- Lets current ID owners update the receive address or transfer ownership through paid on-chain registry events.
- Resolves confirmed ProofOfWork IDs as direct transfer targets, so ownership can be sent to an ID's current owner/receiver instead of manually pasting the raw address.
- Lets ID management receive fields accept confirmed ProofOfWork IDs, resolving them to raw ProofOfWork receive addresses before writing registry events.
- Lets current ID owners publish on-chain marketplace listings, seal them, delist them, and execute buyer-funded ID transfers. Marketplace is tabbed by asset class: IDs and credit sale-ticket markets are live.
- Shows pending ID receiver updates, direct transfers, listings, delistings, and marketplace buys to wallets touched by the event, so both sender and receiver can track in-flight ID changes before confirmation.
- Exposes Marketplace as a first-class Computer sidebar workspace, not just a buried ID panel.
- Exposes Credits as a mainnet-only creation and mint surface, a Wallet surface for balances, transfers, listing actions, and sale history, a dedicated WORK credit dashboard, and an Infinity Bond / POWB workspace in the Computer shell. Credit creation pays the built-in index fee to `tokens@proofofwork.me`; mints, transfers, listings, seals, delistings, and buys pay each credit's own registry at the owner-set price or mutation fee.
- Filters active marketplace listings by sale-ticket outspend state, using Bitcoin Core spend checks when configured, so a spent ticket leaves the active book even if a cached summary snapshot is still warming.
- Promotes pending credit listings into confirmed listing state without duplicating them, so WORK and other credit books do not show stale pending shadows after confirmation.
- Preserves credit sale-ticket seal metadata when pending listings promote to confirmed state, so WORK listings stay sealed or sealing across cache refreshes.
- Preserves local pending credit listings and seals across wallet/token refreshes until the canonical API sees the same listing, seal, closure, or sale, so seller action buttons do not blink away while the indexer catches up.
- Blocks duplicate credit listing seals once a valid seal is already known for the active listing.
- Shows credit market books with All, Sealed, and Unsealed views where sale-ticket status applies. Sealed means the sale-ticket seal is confirmed and buyable; pending seal rows remain visible in All/Unsealed as sealing status. Active books can sort by price or arbitrage, while sales/listing logs stay ordered by confirmation time.
- Keeps confirmed, unspent, buyable sealed listings in marketplace summaries even when ordinary active-listing previews are capped, so older sealed inventory remains visible in Buy and public order-book views.
- Paginates credit sales/listing logs from the API so every listing, closure, and sale remains inspectable instead of being limited to a preview.
- Prunes dropped pending WORK and credit transactions from live pending overlays after liveness checks, so stale mempool ghosts cannot distort transfer visibility, listing visibility, balances, floor, or network value.
- Credit mint surfaces treat confirmed history as canonical mint-out, but pause user mint actions when confirmed plus pending mints would fill the remaining supply. Pending mempool records are not final, but the UI avoids letting users pay for likely overfill attempts, and WORK summary data must replay confirmed mints instead of trusting stale partial supply totals.
- Stages RUSH as an explicit development/protocol surface behind `?rush=1` or `VITE_RUSH_ONLY=1`. It is not part of shared public navigation or production domain routing until separately approved for launch.
- Exposes Growth as a public dashboard for modeled ProofOfWork Computer network value versus real confirmed registry, log, file, marketplace, and Credit value metrics.
- Computes WORK, Infinity, Growth, Log, and livenet credit/token views from one canonical confirmed ledger snapshot, so public searches, logged events, and network value cannot diverge after refresh.
- Keeps the IDs workspace limited to registration, receiver updates, and direct owner transfers.
- Keeps `id.proofofwork.me` registration-only. ID management and marketplace flows live in the Computer app and the standalone Marketplace app.
- Paginates the ID registry's confirmed transaction history and separately merges mempool transactions before applying first-confirmed-wins.
- Reads registry, mail, files, pagination, wallet UTXOs, transaction preparation data, broadcast status, live BTC/USD, WORK floor, Infinity summary, and app metrics through the first-party ProofOfWork OP_RETURN API.
- Uses `/api/v1/consistency` and `npm run audit:ledger` as the regression gate for livenet ledger coverage across Log, Growth, WORK, Infinity, and credit/token history.
- Uses explicit pagination for registry, marketplace, credit, wallet, log, and growth data views so large confirmed datasets remain inspectable without relying on infinite scroll.
- Treats ProofOfWork IDs as case-insensitive names capped by the aggregate 100 KB OP_RETURN transaction limit, not arbitrary character rules.
- Resolves ProofOfWork IDs in the compose recipient field only after a confirmed registry record exists; pending IDs cannot receive routed mail yet.
- Re-checks the full registry immediately before broadcasting an ID registration to block stale duplicate claims.
- Opens a prefilled X post to verify only IDs owned by or routed to the connected wallet.
- Renders a dedicated Phase 1 ID claim experience on `id.proofofwork.me` using the same registry protocol and address.

## Production OP_RETURN API

Production builds are wired to a first-party ProofOfWork OP_RETURN API.

The API entrypoint is:

```text
server/proof-api.mjs
```

Production routes the API through the same app domains:

```text
https://www.proofofwork.me/api/*
https://id.proofofwork.me/api/*
https://computer.proofofwork.me/api/*
https://desktop.proofofwork.me/api/*
https://browser.proofofwork.me/api/*
https://marketplace.proofofwork.me/api/*
https://credit.proofofwork.me/api/*
https://wallet.proofofwork.me/api/*
https://work.proofofwork.me/api/*
https://infinity.proofofwork.me/api/*
https://log.proofofwork.me/api/*
https://growth.proofofwork.me/api/*
```

Current production behavior:

- Confirmed stable mainnet registry, Log, credit/token, marketplace, summary, event, mail/file, and tx-status reads go through the ProofOfWork API and use the PostgreSQL proof index where the read flag supports that surface.
- The proof index is a fast replayable read model, not a separate source of truth. Confirmed chain data remains canonical, and every tx-backed record should keep its txid available for normal explorer/mempool verification.
- The production proof index is the default stable read model for confirmed Log, Event History, address mail, registry, credit/token, marketplace lifecycle, WORK, Growth, and tx-status reads where enabled. Explicit fresh reads, mempool state, raw transaction data, UTXO/outspend checks, signing support, and broadcasts still fall back to the first-party node/API path.
- The mail and Log parsers normalize `pwm1:m:powb` as `infinity-bond` for event/search/Growth accounting while still projecting it into the mailbox model. Confirmed bond payments mint POWB to the recipient address one-for-one with proofs sent; self-sends are just the self-recipient case and appear in both Inbox and Sent.
- The node stack does not hold funds, seed phrases, private keys, or wallet authority.
- Browser wallets still sign locally.
- Production raw transaction broadcasts use the same first-party node path through `POST /api/v1/broadcast/tx`. The API receives only final signed transaction hex.
- Unconfirmed transactions are mempool gossip, not global truth.
- For pending visibility, the API merges the local node/indexer view with `PENDING_MEMPOOL_BASE` when configured. By default this stays on the same local node/indexer stack.
- Fresh reads, mempool checks, raw tx lookups, UTXO/outspend checks, broadcasts, and projection fallback still use the first-party node/API path.
- Confirmed database projections are the default fast path for supported stable reads; pending records are visible but not final.
- Pending ID mutation events are exposed separately from confirmed records. They are UI status only until confirmation.
- Marketplace ID sale count and seller-price volume are derived from resolver-accepted `buy5` sale-ticket purchases, with confirmed sales canonical and pending sales shown as mempool visibility. Older legacy buy events remain replayable protocol history but do not seed the public marketplace stats.
- The credit API scans `tokens@proofofwork.me` at `1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn` for `pwt1:create` events, using tx `7a8845f33823305fabd818b3a3e2f06a175b29bf55dd79a2f83365251a6d5d19` as the current ID record for the credit index.
- Credit creation requires a 546-proof payment to `tokens@proofofwork.me` before the OP_RETURN. The create event defines ticker, max supply, mint amount, mint price, and the credit's own registry address. The UI may accept a confirmed ProofOfWork ID such as `work@proofofwork.me` for the credit registry field, but the on-chain create payload stores the resolved ProofOfWork address.
- Credit ids are creation txids. Mint events use `pwt1:mint:<token-create-txid>:<amount>` and must pay the credit registry address before OP_RETURN.
- Credit transfers use `pwt1:send:<token-create-txid>:<amount>:<recipient-address>` and require a 546-proof mutation payment to that same credit registry before OP_RETURN. Confirmed transfers debit the first input address and credit the recipient address; pending transfers are visible but not canonical.
- The Credit tab inside Marketplace is the shared market surface for credit trades. Credit `list5` events reserve seller balance and create a seller-controlled sale-ticket output, `seal5` publishes the seller's `SIGHASH_SINGLE|ANYONECANPAY` ticket signature, `delist5` spends the ticket to cancel, and `buy5` spends the ticket while paying the seller plus the credit registry mutation fee.
- Credit active listings are spend-state aware. A sale-ticket outpoint spend closes the listing; production Core-backed spend checks keep Wallet and Marketplace aligned while summaries warm. If the spend is a valid `pwt1:buy5`, the sale appears in credit sales, credit market logs, Growth, and summary endpoints after refresh.
- Infinity Bonds use the canonical `pwm1:m:powb` message memo. Each confirmed recipient payment mints the same number of POWB to that recipient address. POWB is a reserved, uncapped synthetic credit backed by confirmed bond proofs and registered through `infinity@proofofwork.me`; `infinity.proofofwork.me` exposes `/api/v1/infinity-summary`, the bond composer, POWB balances, and the POWB sale-ticket market. POWB supply has no maximum and can trend to infinity.
- POWB floor accounting is confirmed bond network value divided by confirmed POWB supply. Bond network value includes confirmed bond proof payments, POWB seller sale volume, POWB transfer fees, and POWB marketplace mutation fees. POWB sale volume and mutation fees also contribute to the broader ProofOfWork Computer/WORK network floor alongside the rest of confirmed marketplace flow.
- `/api/v1/marketplace-summary` returns the reconciled marketplace lifecycle rather than a raw proof-index summary snapshot, so stale compacted snapshots cannot hide confirmed sealed listings from the public Buy book. Proof-index summary snapshots are still backfilled and checked by parity, but route output must preserve the confirmed sealed inventory contract.
- Fresh reads for credit summaries, credit histories, marketplace summaries, and WORK summaries refresh the shared credit payload cache before returning. Stale snapshots are acceptable for first paint only, not after an explicit refresh.
- Credit mint prices are owner-set with a 546-proof minimum. ProofOfWork does not take a global fee on mints; the mint price goes to that credit's registry address.
- Credit surfaces show the starting unit price as mint price divided by mint amount, plus live node-backed USD per credit and per mint from BTC/USD.
- `wallet.proofofwork.me` shows connected-address credit balances, transfer logs, active and closed owned listings, sale history, and non-custodial transfers/listings/delistings through UniSat. `work.proofofwork.me` shows the WORK dashboard: mint progress, holders, credit facts, mint action, mint log, live floor, pending mint pressure, and confirmed floor history. `credit.proofofwork.me` stays focused on credit creation and mint selection.
- WORK is reserved for the canonical WORK credit id `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`. Official indexers and UI creation flows reject non-canonical credit creates whose ticker contains `WORK`, and exclude credit creates from blocked scam creator address `bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl`.
- WORK settings are 21,000,000 max supply, 1,000 WORK per mint, 1,000 proofs per mint, and the `work@proofofwork.me` registry address. The launch price is exactly 1 proof per WORK. The credit create form can reuse the same economic template for new tickers, but cannot create another WORK-like credit.
- WORK's permanent value floor is derived from the Growth model's confirmed ProofOfWork Computer network value: `work_floor_sats = confirmed_network_value_sats / 21,000,000 WORK`. The inverse, `21,000,000 / confirmed_network_value_sats`, is the WORK-per-proof ratio. Pending records are visible but do not change the canonical floor until confirmed.
- The WORK dashboard shows the live floor beside the mint panel: floor proofs per WORK, USD per WORK, confirmed network value in proofs/USD, a confirmed floor-history chart, and the refresh time. This is separate from the 1 proof/WORK launch mint price. WORK and Growth must use the same node-backed BTC/USD quote and the same confirmed network-value payload so proofs and USD totals agree across surfaces.
- `work-floor`, `work-summary`, `growth-summary`, and `marketplace-summary` expose current USD from the live first-party BTC/USD quote. `actualValue.totalUsd` is live current USD; `actualValue.modelTotalUsd` is the Growth model USD projection. Consumers that publish current numbers should use `actualValue.totalUsd` plus the response's `btcUsd`, `btcUsdIndexedAt`, and `usdSource` metadata, not `modelTotalUsd`.
- Marketplace flow in WORK/Growth accounting is seller sale volume plus marketplace mutation fees from valid listing, seal, delisting, and buy events. Seller sale volume remains separate from mutation-fee flow, and marketplace mutation fees are excluded from generic Computer event flow to avoid double counting.
- The WORK floor announcement is part of project history as ProofOfWork mail tx `cbb8a1b4af2ea8665129e799a85dfba31cea87ef38b9a99bcf198d827c12a58c`: `$work now has a permanent ProofOfWork Computer floor.` Live indexers determine whether that tx is pending or confirmed; once confirmed, ProofOfWork history is the permanent source.
- The staged RUSH API scans the configured network registry for valid `pwr1:m:rush` mints that pay at least 1,000 proofs to the registry before OP_RETURN. Confirmed mint ordinals determine the phase reward; pending mints are visibility only.
- The log API exposes a normalized ProofOfWork Computer feed for registrations, receiver updates, direct transfers, listings, seals, delistings, buyer-funded marketplace purchases, messages, replies, files, attachments, credit creations, credit mints, credit transfers, credit listings, and credit sales. Address, confirmed ID, txid, protocol kind, or app label search narrows that same log surface to a specific account or transaction. The log also reports total indexed ProofOfWork protocol bytes across discovered app records.
- Browser renders ProofOfWork HTML by txid from either the `pwm1:m` message body or a verified `pwm1:a` file attachment. It does not introduce an outside carrier; attachments keep the same size/SHA-256 verification as Files/Desktop, and message-body HTML remains bound to the transaction that carries it.
- Confirmed Browser pages may run scripts in an opaque sandbox, but wallet signing remains outside Browser pages. Pending Browser pages render as visibility only and cannot run scripts.
- Files/Desktop treat Browser-readable `pwm1:m` HTML bodies as derived `.html` files for navigation and opening, while the original transaction remains a message-body record on-chain.
- The canonical welcome page is pinned by txid `8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b` as the default ProofOfWork Computer file. It appears in Files/Desktop as a system artifact and opens in Browser so the transaction remains the source of truth.
- Growth reads the same registry, log, Credit, and WORK floor endpoints, then auto-refreshes real confirmed network value with the same live node-backed BTC/USD benchmark used by the rest of the app. Merged apps are regular applications: once merged, they should appear in shared navigation, landing app cards, local route maps, production app lists, GitHub docs, and Growth metrics.
- On livenet, WORK floor, Growth summary, Log/Log history, token summary, and token history are backed by the same canonical ledger payload. That payload merges registry activity, discovered Computer activity, seeded mail activity from app-derived addresses, WORK token state, credit token state, and staged protocol activity where enabled. A confirmed event that affects network value must be searchable in Log from the same snapshot.
- ProofOfWork.Me broadcasts intentionally spend confirmed wallet UTXOs only across mail, files, ID registry actions, and marketplace actions. This prevents a selected fee rate from being dragged down by low-fee unconfirmed ancestors, which external explorers can report as a lower effective fee rate.
- A tx status can be `confirmed`, `pending`, or `dropped`.
- A dropped tx is not treated as durable mail. Users can rebuild/resend from local draft data when available.

Important launch invariant:

```text
Confirmed history is canonical. Pending mempool visibility is best-effort.
Every app-created broadcast spends confirmed inputs only.
```

## OP_RETURN Protocol

Only OP_RETURN payloads that start with this prefix are read into mail views:

```text
pwm1:
```

The app writes OP_RETURN as:

```text
pwm1:s:<subject-base64url>
pwm1:m:<message-chunk>
```

Recipients are not stored in OP_RETURN. They are represented by normal ProofOfWork payment outputs before the first ProofOfWork.Me OP_RETURN output. Multi-recipient mail uses one shared OP_RETURN payload and one ProofOfWork output per recipient.
CC recipients are also normal payment outputs. To/CC labels are local sender-side organization metadata, not a chain-enforced privacy or delivery primitive.

Replies are written as:

```text
pwm1:s:<subject-base64url>
pwm1:r:<parent-txid>
pwm1:m:<message-chunk>
```

Replies are sent back to the sender inferred from the transaction inputs.

Attachments are written as base64url chunks:

```text
pwm1:a:<mime-base64url>:<name-base64url>:<size>:<sha256>:<index>/<total>:<data-base64url-chunk>
```

Attachment bytes are verified by size and SHA-256 before the reader exposes a download link.

Protocol OP_RETURN data-carrier script bytes are limited to 100,000 bytes, matching Bitcoin Core 30.0's default `-datacarriersize`.
The app enforces this as an aggregate transaction limit across all ProofOfWork.Me OP_RETURN outputs, including OP_RETURN and pushdata script overhead for each output.
The app uses PSBT construction instead of UniSat's `sendBitcoin` memo helper, so protocol payloads are not limited by the wallet helper's small memo field.

ProofOfWork ID registrations are written as:

```text
pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>
```

ID lookup normalizes casing, so `User`, `user`, and `USER` resolve to the same record. New registrations encode the ID field as base64url, which keeps punctuation and Unicode parseable while the aggregate OP_RETURN limit keeps total size bounded.

ID owners can mutate confirmed IDs through the same canonical registry address:

```text
pwid1:u:<id-base64url>:<receive-address>
pwid1:t:<id-base64url>:<new-owner-address>:<new-receive-address?>
pwid1:list5:<sale-ticket-json-base64url>
pwid1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwid1:delist5:<listing-txid>
pwid1:buy5:<listing-txid>:<new-owner-address>:<new-receive-address?>
```

`pwid1:r2` registrations require a 1,000-proof registry payment. `pwid1:u` and `pwid1:t` require a 546-proof mutation payment and must be spent from the current owner address. If a transfer omits the new receive address, the new owner also becomes the receiver.
The UI may accept confirmed ProofOfWork IDs in owner/receive fields, but `pwid1:u` and `pwid1:t` always write resolved ProofOfWork addresses on-chain.
`pwid1:list5` publishes sale terms as a `pwid-sale-v4` JSON object and creates a 546-proof seller-controlled sale-ticket UTXO in the listing transaction. `pwid1:seal5` publishes the seller's `SIGHASH_SINGLE|ANYONECANPAY` signature for that ticket after the listing txid exists, and the seal must name the listing txid as its `anchorTxid`. `pwid1:buy5` must spend that same ticket, pay the seller price plus ticket value, and pay the 546-proof mutation fee before the ID OP_RETURN. Because every valid buyer spends the same sale ticket, competing purchases conflict at the ProofOfWork UTXO layer instead of both paying.
`pwid1:delist5` cancels a listing by spending the sale ticket and paying the mutation fee. Historical `list2`/`buy2`/`delist2`, `list3`/`buy3`/`delist3`, and `list4`/`buy4`/`delist4` events remain readable for replay, but new marketplace writes use `list5`/`seal5`/`buy5`/`delist5`.
Pending `pwid1:u`, `pwid1:t`, `pwid1:list5`, `pwid1:seal5`, `pwid1:delist5`, and `pwid1:buy5` events are exposed as in-flight changes for touched wallets. They do not change canonical owner/receiver routing until confirmed.

## Staged Confessions Protocol

Confessions is staged as a separate ProofOfWork ID social meta protocol, not as a change to the canonical `pwid1:` registry. It is not a public production surface until separately approved.

Planned event shape:

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

Rules to preserve while implementing the live writer/indexer:

- Confessions and reply text are capped at 140 user-visible characters.
- Every confirmed PowID has a blank Confessions profile by default. The default location is `ProofOfWork`.
- Profile metadata uses `pwc1:profile:<profile-json-base64url>` and requires 546 proofs to the profile owner's own confirmed PowID receiver. Newer confirmed profile proofs replace older profile fields.
- Profile fields are capped at 50 characters for name, 160 for bio, 30 for location, and 100 for website. Birthday is optional. Profile banner images are Files-backed references capped at 100 KB and ride the same 546-proof `pwc1:profile` proof to the owner's own PowID receiver.
- Post JSON may include links and one image attachment reference under 100 KB before encoding. The image bytes should be created through the ProofOfWork Files attachment layer, and Confessions should store only the file txid/proof/hash/size pointer. The final transaction must still fit the aggregate OP_RETURN carrier limit.
- Images should render inline in feeds and profiles from Files, while still exposing size/hash proof metadata in detailed views.
- Confirmed ProofOfWork IDs are the account namespace.
- The staged Confessions UI derives profile shells and payment receivers from confirmed `pwid1` registry records only; preview-only social accounts must not stand in for real PowIDs.
- Pending IDs are visible but not routable social identities.
- Likes, reposts, follows, and paid replies require at least 546 proofs to the immediate target's confirmed ProofOfWork ID receiver before the `pwc1:` OP_RETURN.
- Following someone pays 546 proofs to that user's confirmed PowID receiver and creates the confirmed follow graph.
- Tips pay a user-chosen amount to the target profile's confirmed PowID receiver.
- Profiles should show confirmed followers, following, confirmed social proofs earned by source, pending social proofs separately, and the user's WORK balance when available.
- Profiles should expose tabs for Posts, Replies, Likes, and Media. Reposts are inline profile timeline items in Posts, not a separate tab. Proofs/earnings stay in the profile summary.
- Authors can archive/hide their own Confessions from default app/profile indexing with a 546-proof `pwc1:hide` event. The original record remains on-chain and can still appear in raw chain/log views.
- The Following timeline shows posts from followed PowIDs ordered by post time.
- Likes, reposts, and replies are disabled until the target post or reply is confirmed.
- A reply to a reply pays the immediate parent author, not automatically the original thread author.
- Confirmed ProofOfWork history is canonical. Pending Confessions records are visibility only.
- Wallet signing stays local; the API reads, indexes, verifies, and broadcasts already-signed transactions only.

## Run

```bash
npm install
npm run dev
```

To preview the ID launch flow locally:

```text
http://localhost:5173/?id-launch=1
```

To preview the root landing page locally:

```text
http://localhost:5173/?landing=1
```

To preview the public Desktop locally:

```text
http://localhost:5173/?desktop=1
```

To preview the public Browser locally:

```text
http://localhost:5173/?browser=1
```

To preview the staged Confessions app locally:

```text
http://localhost:5173/?confessions=1
http://localhost:5173/?confessions=1&view=home
http://localhost:5173/?confessions=1&view=following
http://localhost:5173/?confessions=1&view=profile&profile=proofofwork
```

To preview the standalone asset Marketplace locally:

```text
http://localhost:5173/?marketplace=1
```

To preview the credit creation and mint app locally:

```text
http://localhost:5173/?credit=1
```

To preview the WORK credit dashboard locally:

```text
http://localhost:5173/?work=1
```

To preview the credit wallet locally:

```text
http://localhost:5173/?wallet=1
```

To preview the staged RUSH credit mint page locally:

```text
http://localhost:5173/?rush=1
```

To preview the public Log locally:

```text
http://localhost:5173/?log=1
```

To preview the public Growth dashboard locally:

```text
http://localhost:5173/?growth=1
```

When running on `localhost`, shared app navigation stays local instead of jumping to production domains:

```text
Home -> /?landing=1
IDs -> /?id-launch=1
Computer -> /
Desktop -> /?desktop=1
Browser -> /?browser=1
Marketplace -> /?marketplace=1
Credit -> /?credit=1
Wallet -> /?wallet=1
WORK -> /?work=1
Log -> /?log=1
Growth -> /?growth=1
```

To build a landing-page-only deployment for `proofofwork.me`:

```bash
VITE_LANDING_ONLY=1 VITE_POW_API_BASE=https://www.proofofwork.me npm run build
```

To build an ID-registration-only deployment that hides the full mail app on every hostname:

```bash
VITE_ID_LAUNCH_ONLY=1 VITE_POW_API_BASE=https://id.proofofwork.me npm run build
```

To build the full computer app for production:

```bash
VITE_POW_API_BASE=https://computer.proofofwork.me npm run build
```

To build the public Desktop app for production:

```bash
VITE_DESKTOP_ONLY=1 VITE_POW_API_BASE=https://desktop.proofofwork.me npm run build
```

To build the public Browser app for production:

```bash
VITE_BROWSER_ONLY=1 VITE_POW_API_BASE=https://browser.proofofwork.me npm run build
```

The staged Confessions app is local-only until separately approved. Do not add it to public navigation or production builds.

To build the standalone asset Marketplace app for production:

```bash
VITE_MARKETPLACE_ONLY=1 VITE_POW_API_BASE=https://marketplace.proofofwork.me npm run build
```

To build the standalone credit app for production:

```bash
VITE_TOKEN_ONLY=1 VITE_POW_API_BASE=https://credit.proofofwork.me npm run build
```

To build the standalone credit wallet for production:

```bash
VITE_WALLET_ONLY=1 VITE_POW_API_BASE=https://wallet.proofofwork.me npm run build
```

To build the standalone WORK credit dashboard for production:

```bash
VITE_WORK_TOKEN_ONLY=1 VITE_POW_API_BASE=https://work.proofofwork.me npm run build
```

To build the standalone Infinity Bond / POWB market for production:

```bash
VITE_INFINITY_ONLY=1 VITE_POW_API_BASE=https://infinity.proofofwork.me npm run build
```

To build the staged standalone RUSH credit mint page:

```bash
VITE_RUSH_ONLY=1 VITE_POW_API_BASE=https://rush.proofofwork.me npm run build
```

To build the standalone Log app for production:

```bash
VITE_LOG_ONLY=1 VITE_POW_API_BASE=https://log.proofofwork.me npm run build
```

To build the standalone Growth app for production:

```bash
VITE_GROWTH_ONLY=1 VITE_POW_API_BASE=https://growth.proofofwork.me npm run build
```

To run localhost against the production API explicitly:

```bash
npm run dev:prod-api
```

The default `npm run dev` keeps local routes local. If the frontend calls
`/api/*`, Vite proxies that to the local OP_RETURN API on `127.0.0.1:8081`.
Only `/test-api/*` in `dev:prod-api` is proxied to production.

To build against a self-hosted ProofOfWork OP_RETURN API:

```bash
VITE_POW_API_BASE=https://your-api-domain.example npm run build
```

To run the OP_RETURN API on the node server or locally:

```bash
npm run proof-api
```

Useful API environment variables:

```text
HOST=127.0.0.1
PORT=8081
MEMPOOL_BASE=http://127.0.0.1:8080
PENDING_MEMPOOL_BASE=http://127.0.0.1:8080
BITCOIN_RPC_URL=
BITCOIN_RPC_USER=
BITCOIN_RPC_PASSWORD=
```

`MEMPOOL_BASE` should point at the local private mempool/electrs HTTP API. `PENDING_MEMPOOL_BASE` is optional and exists because unconfirmed tx gossip can differ between nodes; production should keep it on ProofOfWork-controlled node infrastructure.
`POST /api/v1/broadcast/tx` submits already-signed raw transaction hex to `MEMPOOL_BASE`; it never receives wallet keys or unsigned wallet authority.
`BITCOIN_RPC_URL`, `BITCOIN_RPC_USER`, and `BITCOIN_RPC_PASSWORD` are optional server-only Bitcoin Core RPC settings. When configured, the API can attach the node's exact `testmempoolaccept` reject reason to failed broadcasts, hydrate transactions with `getrawtransaction`, and verify sale-ticket spend state with `gettxout` so confirmed delistings and buys clear active books without waiting on slower address-history scans. Do not expose Bitcoin Core RPC publicly.

## Registry Audit

To find duplicate or failed ProofOfWork ID registrations for refund review:

```bash
npm run audit:ids
```

The audit scans the full canonical registry history, merges mempool transactions, applies first-confirmed-wins, and writes JSON/CSV reports to `/tmp`. Confirmed duplicates are listed as refund candidates. Pending duplicates are listed separately as a watchlist until they confirm or drop.

Before issuing refunds, check `ID_REFUNDS.md` so old confirmed duplicates that were already refunded are not paid twice.

For public accounting, duplicate or failed registration payments should be treated as refund liabilities, not net registry revenue. Gross registry flow can include every confirmed paid registry event, but net registry revenue should subtract refunded or refund-owed non-canonical registrations.

Confirmed registry treasury sweeps are tracked in `TREASURY_LEDGER.md`.

## Ledger Audit

To verify that the live livenet ledger is internally consistent:

```bash
npm run audit:ledger
```

The audit checks `/api/v1/consistency`, `/api/v1/work-floor`,
`/api/v1/growth-summary`, `/api/v1/prices/btc-usd`, and Log search. It fails
if WORK and Growth use different snapshots, if network value differs from
actual confirmed value, if live USD does not reconcile from the exposed BTC/USD
quote, if seeded Computer mail/Infinity Bond events are missing from Log, or if
known confirmed regression txids are not searchable.

The companion local contract check is:

```bash
npm run check:live-data
```

The broader proof-index regression gates are:

```bash
npm run indexer:parity
npm run check:mail-regressions
npm run check:marketplace-regressions
```

`check:mail-regressions` proves indexed Inbox/Sent mail plus Infinity Bond Log/Event search for the OTC self-send regression tx. `check:marketplace-regressions` proves WORK delist, sale, wallet, summary, all confirmed sealed listing visibility, and Log close status stay aligned. `indexer:parity` proves the database snapshot, event rows, participants/refs, registry, summaries, token history, address-mail, and tx-status samples match the canonical ledger contract.

Run the relevant checks after changing `server/proof-api.mjs`, Log search,
Growth, WORK, mail indexing, marketplace indexing, or credit/token indexing.

## Developer Map

Important implementation points:

- Agent bootstrap: `SOUL.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/proofofwork-soul.mdc`, and `.github/copilot-instructions.md`.
- ID launch route switch: `isIdLaunchRoute()` in `src/app/routeRegistry.ts`.
- Root landing route switch: `isLandingRoute()` in `src/app/routeRegistry.ts`.
- Public Desktop route switch: `isDesktopRoute()` in `src/app/routeRegistry.ts`.
- Public Browser route switch: `isBrowserRoute()` in `src/app/routeRegistry.ts`.
- Staged Confessions route switch: `isConfessionsRoute()` in `src/app/routeRegistry.ts`; it returns true only on local preview hosts unless launch scope changes.
- Standalone Marketplace route switch: `isMarketplaceRoute()` in `src/app/routeRegistry.ts`.
- Standalone Credit route switch: `isTokenRoute()` in `src/app/routeRegistry.ts`.
- Standalone Wallet route switch: `isWalletRoute()` in `src/app/routeRegistry.ts`.
- Standalone WORK route switch: `isWorkTokenRoute()` in `src/app/routeRegistry.ts`.
- Standalone Infinity route switch: `isInfinityRoute()` in `src/app/routeRegistry.ts`.
- Staged RUSH route switch: `isRushRoute()` in `src/app/routeRegistry.ts`.
- Log route switch: `isActivityRoute()` in `src/app/routeRegistry.ts`.
- Growth route switch: `isGrowthRoute()` in `src/app/routeRegistry.ts`.
- Live data contract: `scripts/check-live-data-contract.mjs`.
- Production ledger audit: `scripts/audit-ledger-consistency.mjs`.
- Landing-only deploy switch: `VITE_LANDING_ONLY=1`.
- ID-only deploy switch: `VITE_ID_LAUNCH_ONLY=1`.
- Desktop-only deploy switch: `VITE_DESKTOP_ONLY=1`.
- Browser-only deploy switch: `VITE_BROWSER_ONLY=1`.
- Confessions-only deploy switch: `VITE_CONFESSIONS_ONLY=1` for local/staged builds only.
- Marketplace-only deploy switch: `VITE_MARKETPLACE_ONLY=1`.
- Credit-only deploy switch: `VITE_TOKEN_ONLY=1`.
- Wallet-only deploy switch: `VITE_WALLET_ONLY=1`.
- WORK-only deploy switch: `VITE_WORK_TOKEN_ONLY=1`.
- Infinity-only deploy switch: `VITE_INFINITY_ONLY=1`.
- Staged RUSH-only deploy switch: `VITE_RUSH_ONLY=1`.
- Log-only deploy switch: `VITE_LOG_ONLY=1`.
- Growth-only deploy switch: `VITE_GROWTH_ONLY=1`.
- ID registry constants: `ID_PROTOCOL_PREFIX`, `ID_REGISTRATION_PRICE_SATS`, `ID_MUTATION_PRICE_SATS`, and `ID_REGISTRY_ADDRESSES` in `src/App.tsx`.
- Local contacts storage: `CONTACTS_KEY`, `loadContacts()`, `saveContacts()`, and `ContactsWorkspace` in `src/App.tsx`.
- Public Desktop UI: `DesktopApp`, `DesktopWorkspace`, `publicDesktopMail()`, and `fetchAddressMail()` in `src/App.tsx`.
- Public Browser UI: `BrowserApp`, `fetchBrowserPage()`, `browserPageFromTransaction()`, and `browserTemplateHtml()` in `src/App.tsx`.
- Staged Confessions UI: `ConfessionsApp` in `src/features/confessions/ConfessionsApp.tsx`.
- In-app file preview UI: `AttachmentViewer`, `FileInspector`, `attachmentPreviewKind()`, and `attachmentText()` in `src/App.tsx`.
- ID write format: `buildIdRegistrationPayload()`.
- ID mutation formats: `buildIdReceiverUpdatePayload()` and `buildIdTransferPayload()`.
- ID registry history fetcher: `fetchRegistryTransactions()`. It must continue paginating confirmed history with `txs/chain/:last_seen_txid` and merging `txs/mempool`.
- ID read/compat parser: `parseIdEventPayload()`, `parseIdRegistrationPayload()`, and `idRecordsFromTransactions()`.
- Confirmed-only ID compose routing: `resolveRecipientInput()`.
- Multi-recipient compose routing: `resolveRecipientInputs()` and `buildPaymentPsbt()` payment outputs.
- Dedicated registration-only launch UI: `IdLaunchApp`.
- Full app ID workspace: `IdsWorkspace`.
- Standalone marketplace UI: `MarketplaceApp`.
- Computer marketplace workspace: `MarketplaceWorkspace`.
- Standalone Infinity Bond / POWB UI: `InfinityApp`.
- Standalone growth dashboard: `GrowthApp`.
- OP_RETURN API: `server/proof-api.mjs`.
- OP_RETURN infrastructure notes: `OP_RETURN_INFRASTRUCTURE.md`.
- ID refund log: `ID_REFUNDS.md`.
- Marketplace protocol notes: `MARKETPLACE.md`.
