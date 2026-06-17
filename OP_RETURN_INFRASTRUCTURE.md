# ProofOfWork OP_RETURN Infrastructure

ProofOfWork.Me has a first-party OP_RETURN API layer for the existing `pwm1:` mail/files protocol, `pwid1:` ID registry protocol, `pwt1:` credit protocol, and the staged `pwr1:` RUSH mint protocol.

The current product direction is OP_RETURN only. Future protocol work should improve this OP_RETURN indexer and API before introducing any new carrier.

## Current Shape

```text
Browser app
  -> same-origin ProofOfWork OP_RETURN API proxy
  -> private mempool/electrs API
  -> Bitcoin Core full node
```

The browser still signs locally with UniSat. The API never receives seed phrases, private keys, or unsigned wallet authority.

## ProofOfWork Event Database

The next performance step is a ProofOfWork-specific PostgreSQL indexer beside the
node/API stack:

```text
Browser app
  -> same-origin ProofOfWork OP_RETURN API proxy
  -> ProofOfWork event database / projections
  -> private mempool/electrs API
  -> Bitcoin Core full node
```

PostgreSQL is the preferred production database for this layer. The data is an
ordered, replayable event log with relational verification needs: txids,
outpoints, block heights, participants, IDs, credit ids, listings, and snapshot
checks. MongoDB is not the default fit for this protocol shape, and SQLite is a
useful local/dev option but not the preferred long-running production store.

The database is not the source of truth. It is a durable read model derived from
Bitcoin Core, electrs/mempool, and the ProofOfWork parsers. Confirmed chain data
remains canonical. Pending mempool data is useful visibility and may be stored,
but pending rows must not change canonical routing, ownership, credit balances,
WORK floor, Growth value, Log totals, or durable Files/Desktop state.

Every indexed row should be replayable and externally inspectable:

- Store the raw/normalized transaction data needed to reparse the event.
- Store the parsed protocol payload, validation result, participants, and
  important references such as parent txids, listing txids, credit ids, and sale
  ticket outpoints.
- Store status transitions for `pending`, `confirmed`, `dropped`, and
  `orphaned` records.
- Keep `txid` on every event so the UI can expose the normal explorer/mempool
  verification link beside database-backed data.
- Keep canonical projections derived from confirmed rows only.

The first schema lives at:

```text
server/sql/proof-indexer-v1.sql
```

Database tooling:

```bash
POW_INDEX_DATABASE_URL=postgres://proof_indexer:...@127.0.0.1:5432/proof_indexer npm run db:schema
POW_INDEX_DATABASE_URL=postgres://proof_indexer:...@127.0.0.1:5432/proof_indexer POW_API_BASE=http://127.0.0.1:8081 npm run indexer:backfill
POW_INDEX_DATABASE_URL=postgres://proof_indexer:...@127.0.0.1:5432/proof_indexer POW_API_BASE=http://127.0.0.1:8081 npm run indexer:parity
POW_INDEX_DATABASE_URL=postgres://proof_indexer:...@127.0.0.1:5432/proof_indexer POW_API_BASE=http://127.0.0.1:8081 npm run indexer:worker -- --once
```

The backfill script reads current canonical API history in pages and stores a
shadow copy in PostgreSQL. `POW_INDEX_BACKFILL_SOURCES` can limit a run to
comma-separated sources such as `registry-records,tokens,token-mints`, while
`POW_INDEX_BACKFILL_LIMIT`, `POW_INDEX_BACKFILL_MAX_PAGES`, and
`POW_INDEX_FETCH_TIMEOUT_MS` bound each run.

The parity script compares the database read model with the canonical
`/api/v1/ledger-consistency` snapshot before any endpoint cutover. It requires a
green canonical ledger, `missingLogEvents: []`, database coverage for confirmed
activity, matching confirmed credit definitions, and populated search indexes.
Warnings such as a snapshot id moving during a refresh can be promoted to hard
failures with `POW_INDEX_PARITY_STRICT=1`.

The worker script keeps the shadow indexer warm by repeatedly running bounded
backfill pages, refreshing stale pending transaction statuses through
`/api/v1/tx/:txid/status`, marking disappeared txids as `dropped`, and running
the parity checker. Continuous worker cycles skip scoped holder recrawls by
default (`POW_INDEX_WORKER_HOLDERS=0`) so holder projection refreshes can run as
explicit full backfill jobs instead of every short polling loop. Production
service configuration is tracked in:

```text
deploy/proofofwork-indexer-worker.service
```

Rollout should happen in shadow mode:

1. Backfill known ProofOfWork transactions into PostgreSQL.
2. Run the continuous worker so new confirmed events and dropped pending txs
   update the database read model.
3. Replay protocol projections from the database.
4. Compare database output with the current canonical ledger payloads for
   Registry, Log, Credits, WORK, Marketplace, and Growth.
5. Require `/api/v1/consistency`, `/api/v1/ledger-consistency`, and
   `npm run audit:ledger` to stay green with `missingLogEvents: []`.
6. Switch endpoints to database reads only after shadow output matches current
   chain-derived output.

This replaces expensive repeated scans with indexed local reads while preserving
the existing rule: chain truth wins, database speed follows.

Production domains:

```text
www.proofofwork.me          -> canonical landing page
proofofwork.me              -> permanent redirect to https://www.proofofwork.me/
id.proofofwork.me           -> ID registry app
computer.proofofwork.me     -> full mail/computer app
desktop.proofofwork.me      -> public read-only file desktop
browser.proofofwork.me      -> public HTML browser by txid
marketplace.proofofwork.me  -> standalone asset marketplace; IDs and credit sale-ticket markets live
credit.proofofwork.me       -> standalone credit creation and mint app
token.proofofwork.me        -> permanent redirect to https://credit.proofofwork.me/
tokens.proofofwork.me       -> permanent redirect to https://credit.proofofwork.me/
wallet.proofofwork.me       -> standalone credit wallet, transfer, listing, delisting, and sale-history app
work.proofofwork.me         -> standalone WORK credit dashboard and mint page
log.proofofwork.me          -> public ProofOfWork Computer log
growth.proofofwork.me       -> public growth model dashboard
```

Public headers and footers should list every current app domain as they are added, so users can move between Home, IDs, Computer, Desktop, Browser, Marketplace, Credit, Wallet, WORK, Log, and Growth from any production surface. Social links should include X, YouTube, and GitHub.

Each production domain proxies these paths to the ProofOfWork OP_RETURN API:

```text
/api/*
/health
```

This intentionally avoids depending on a separate `api.proofofwork.me` DNS record during Phase 1.

## Server

The API entrypoint is:

```text
server/proof-api.mjs
```

Run locally:

```bash
npm run proof-api
```

Default configuration:

```text
HOST=127.0.0.1
PORT=8081
MEMPOOL_BASE=http://127.0.0.1:8080
PENDING_MEMPOOL_BASE=http://127.0.0.1:8080
SLIPSTREAM_CLIENT_CODE=
BITCOIN_RPC_URL=
BITCOIN_RPC_USER=
BITCOIN_RPC_PASSWORD=
```

The default `MEMPOOL_BASE` is designed for the node server where mempool is already bound privately on localhost.

`PENDING_MEMPOOL_BASE` is optional. It exists because unconfirmed transactions are gossip, not canonical chain state. Two honest nodes can temporarily see different mempools. Production uses ProofOfWork-controlled node/indexer infrastructure for confirmed history and pending visibility.

Production raw transaction broadcasts use `MEMPOOL_BASE` through the first-party API. The browser sends only final signed transaction hex; wallet signing stays local and the API does not receive seed phrases, private keys, or unsigned wallet authority.

Production transaction preparation also uses the first-party API for wallet UTXO reads, previous transaction hex, and listing-anchor outspend checks. These reads are public chain/indexer data needed to build PSBTs locally in the browser before UniSat signs. The API still never receives private keys, seed phrases, or unsigned wallet authority.

`BITCOIN_RPC_URL`, `BITCOIN_RPC_USER`, and `BITCOIN_RPC_PASSWORD` are optional server-only Bitcoin Core RPC settings. When configured, the API can attach the node's exact `testmempoolaccept` reject reason to failed broadcasts, use `getrawtransaction` as a livenet transaction source, and use `gettxout` as the fast sale-ticket spend-state oracle for active listing reconciliation. Bitcoin Core RPC must remain private and must not be exposed to browsers or public networks.

`SLIPSTREAM_CLIENT_CODE` is optional legacy server-only configuration for MARA Slipstream submissions. `MARA_SLIPSTREAM_CLIENT_CODE` is accepted as an equivalent fallback environment variable, while ordinary production broadcasts prefer the ProofOfWork node broadcast path.

## Frontend API

The frontend reads app data and broadcasts signed transactions through the ProofOfWork API. Production builds set the explicit app-domain API base:

```bash
VITE_POW_API_BASE=https://computer.proofofwork.me npm run build
```

Without `VITE_POW_API_BASE`, the browser uses same-origin `/api/*`; it does not fall back to public mempool.space readers.

In local Vite development, `/api/*` is reserved for the local ProofOfWork API at
`http://127.0.0.1:8081`. Production API testing must use the explicit
`npm run dev:prod-api` mode, where `/test-api/*` proxies to production.

On `localhost` and `127.0.0.1`, shared app navigation uses local route flags instead of production domains:

```text
/?landing=1
/?id-launch=1
/
/?desktop=1
/?browser=1
/?marketplace=1
/?credit=1
/?wallet=1
/?work=1
/?rush=1
/?log=1
/?growth=1
```

Production builds:

```bash
VITE_LANDING_ONLY=1 VITE_POW_API_BASE=https://www.proofofwork.me npm run build
VITE_ID_LAUNCH_ONLY=1 VITE_POW_API_BASE=https://id.proofofwork.me npm run build
VITE_POW_API_BASE=https://computer.proofofwork.me npm run build
VITE_DESKTOP_ONLY=1 VITE_POW_API_BASE=https://desktop.proofofwork.me npm run build
VITE_BROWSER_ONLY=1 VITE_POW_API_BASE=https://browser.proofofwork.me npm run build
VITE_MARKETPLACE_ONLY=1 VITE_POW_API_BASE=https://marketplace.proofofwork.me npm run build
VITE_TOKEN_ONLY=1 VITE_POW_API_BASE=https://credit.proofofwork.me npm run build
VITE_WALLET_ONLY=1 VITE_POW_API_BASE=https://wallet.proofofwork.me npm run build
VITE_WORK_TOKEN_ONLY=1 VITE_POW_API_BASE=https://work.proofofwork.me npm run build
VITE_RUSH_ONLY=1 VITE_POW_API_BASE=https://rush.proofofwork.me npm run build
VITE_LOG_ONLY=1 VITE_POW_API_BASE=https://log.proofofwork.me npm run build
VITE_GROWTH_ONLY=1 VITE_POW_API_BASE=https://growth.proofofwork.me npm run build
```

RUSH remains staged behind explicit build/query flags and should not be added to public navigation or production domain routing until separately approved for launch.

## Endpoints

```text
GET /health
GET /api/v1/registry?network=livenet
GET /api/v1/log?network=livenet
GET /api/v1/ids?network=livenet
GET /api/v1/ids/:id?network=livenet
POST /api/v1/broadcast/tx
POST /api/v1/broadcast/slipstream
GET /api/v1/token?network=livenet
GET /api/v1/token-summary?network=livenet
GET /api/v1/token-history?network=livenet
GET /api/v1/work-floor?network=livenet
GET /api/v1/work-summary?network=livenet
GET /api/v1/marketplace-summary?network=livenet
GET /api/v1/log-history?network=livenet
GET /api/v1/growth-summary?network=livenet
GET /api/v1/consistency?network=livenet
GET /api/v1/ledger-consistency?network=livenet
GET /api/v1/prices/btc-usd?network=livenet
GET /api/v1/rush?network=livenet
GET /api/v1/rush?network=testnet4
GET /api/v1/address/:address/mail?network=livenet
GET /api/v1/address/:address/utxo?network=livenet
GET /api/v1/tx/:txid?network=livenet
GET /api/v1/tx/:txid/status?network=livenet
GET /api/v1/tx/:txid/hex?network=livenet
GET /api/v1/tx/:txid/outspend/:vout?network=livenet
```

The registry endpoint:

- Scans the canonical registry address.
- Paginates confirmed transaction history.
- Merges mempool transactions from local infrastructure and the pending fallback.
- Applies first-confirmed-wins.
- Keeps pending IDs visible but not routable.
- Exposes confirmed and pending ID marketplace events, including `list5`, `seal5`, `buy5`, and `delist5`.
- Exposes marketplace sales data from valid `buy5` buyer-funded ID transfers: sale count and seller-price volume, split between confirmed canonical sales and pending mempool-visible sales. Legacy buy events remain replayable history but are not included in the public marketplace metric.
- Exposes a Credits marketplace tab over confirmed credit creations, mints, transfers, holders, registries, active sale-ticket listings, and settled credit sales.
- Exposes registry records, pending events, listings, and registry-specific activity.

The canonical livenet ledger payload:

- Is the shared source for `/api/v1/log`, `/api/v1/log-history`, `/api/v1/work-floor`, `/api/v1/growth-summary`, `/api/v1/token`, `/api/v1/token-summary`, and `/api/v1/token-history`.
- Merges registry activity, discovered global Computer activity, seeded mail activity from app-derived addresses, canonical WORK state, canonical credit/token state, and staged protocol activity when enabled.
- Uses complete address history for configured mail-heavy Computer addresses, with paginated mempool/address reads as the faster path for the wider seed set. This prevents confirmed mail or Infinity Bond transactions from appearing in direct address search while missing from global Log and network value.
- Emits one `snapshotId`, source hashes, metrics, and consistency checks so WORK, Growth, Log, and credit/token history can prove they are reading the same confirmed state.
- Carries live BTC/USD metadata (`btcUsd`, `btcUsdIndexedAt`, `usdSource`) on WORK/Growth responses. `actualValue.totalUsd` is current live USD from the first-party price endpoint, while `actualValue.modelTotalUsd` is the separate Growth model USD projection.
- Keeps pending records visible where useful, but only confirmed records affect canonical network value and the WORK floor.
- Rejects or avoids replacing a useful cached ledger with a worse confirmed-history payload when guarded counts regress.
- May serve a useful cached ledger for fast first paint only when summary projections also correct active sale-ticket listings against current node spend state; deep refresh continues in the background and must converge on confirmed chain truth.
- Replays WORK mint summaries from canonical mint events and treats pending WORK mints as availability pressure only. Pending mints can reduce available mint slots in the UI, but they do not change confirmed supply, holders, floor, or network value.
- Promotes pending WORK and credit listings into confirmed state through the shared credit payload, deduping by listing txid and sale-ticket outpoint so confirmation does not leave duplicate pending rows behind.
- Preserves sale-ticket seal metadata when WORK or credit listings promote from pending to confirmed state. Confirmed seal regressions are rejected so a refreshed payload cannot make a sealed listing look unsealed.
- Checks pending WORK and credit txids for liveness on fresh reads and prunes dropped pending transfers, listings, seals, delistings, and buys from pending overlays without changing confirmed history.
- Counts marketplace network value from sale volume plus marketplace mutation fees. Marketplace mutation fees remain in marketplace flow and are excluded from generic Computer event flow.

The consistency endpoints:

- `/api/v1/consistency`
- `/api/v1/ledger-consistency`

These expose the ledger checks used by `npm run audit:ledger`, including
`livenet-confirmed-history-present`, `token-definitions-cover-confirmed-mints`,
`work-floor-actual-total`, `growth-actual-total`, `growth-work-floor-total`,
`marketplace-mutation-fees-counted`,
`marketplace-value-includes-mutation-fees`,
`computer-event-flow-excludes-marketplace`, `token-sales-logged`,
`seeded-mail-events-logged`, and `seeded-infinity-bonds-logged`. The audit also
checks that WORK/Growth live USD reconciles from `/api/v1/prices/btc-usd`.
`missingLogEvents` must stay empty for a green production ledger.

The log endpoint:

- Reads from the canonical livenet ledger payload for global Log and Log history.
- Starts from the canonical registry and all known ProofOfWork ID owner/receiver addresses.
- Crawls the ProofOfWork mail/file address graph by reading `pwm1:` transactions, discovering senders and recipients, and expanding until the configured safety cap.
- Supports server-backed search by address, confirmed ProofOfWork ID, txid, protocol kind, participant, token id, or app label against the same ledger-backed event set.
- Exposes a normalized read-only log feed for registrations, receiver updates, direct transfers, listings, seals, delistings, buyer-funded marketplace transfers, messages, replies, files, attachments, credit creations, credit mints, credit transfers, credit listings, credit sales, and staged RUSH mints when enabled by the indexer.
- Reports total indexed ProofOfWork protocol data bytes across all discovered app OP_RETURN payloads, including marketplace listing/seal/buy/delist records and staged RUSH mint records when enabled by the indexer.

The Growth app:

- Reads the same canonical livenet ledger snapshot as WORK, Log, and credit/token history.
- Compares modeled ProofOfWork Computer network value to confirmed chain-derived value in proofs and USD.
- Auto-refreshes confirmed registry, log, file, marketplace, and Credit metrics while the page is visible.
- Treats each modeled product consistently: real input, usage rate, value assumption, fee elasticity, and blockspace accounting.
- Feeds the permanent WORK floor: `work_floor_sats = confirmed_network_value_sats / 21,000,000 WORK`. Pending records are visible but do not change this canonical floor until confirmed.
- Uses the same first-party BTC/USD price endpoint and the same WORK floor payload as `work.proofofwork.me`, so Growth and WORK display matching proofs and live USD totals after refresh. Model USD remains available only as `modelTotalUsd`.

The credit endpoint:

- Scans `tokens@proofofwork.me` at `1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn` for credit creation records.
- Uses tx `7a8845f33823305fabd818b3a3e2f06a175b29bf55dd79a2f83365251a6d5d19` as the current ID record for the credit index.
- Reads confirmed and pending `pwt1:` records.
- Reconstructs credit definitions from `pwt1:create:<ticker>:<max-supply>:<mint-amount>:<mint-price-proofs>:<token-registry-address>` transactions that pay at least 546 proofs to `tokens@proofofwork.me` before OP_RETURN.
- Lets the credit creation UI accept either a raw ProofOfWork address or a confirmed ProofOfWork ID for the credit registry. The chain record stores the resolved ProofOfWork address so credit indexing does not depend on future ID receiver changes.
- Defines the credit id as the creation txid, allowing repeated tickers while keeping mints unambiguous.
- Reconstructs mints from `pwt1:mint:<token-create-txid>:<amount>` transactions found on each credit's own registry address.
- Requires mint payments to the credit registry before OP_RETURN at the owner-set mint price, with a 546-proof minimum for credit mint settings.
- Credits confirmed mint balances to the first input address.
- Reconstructs transfers from `pwt1:send:<token-create-txid>:<amount>:<recipient-address>` transactions found on the credit registry address.
- Requires transfer payments of 546 proofs to the credit registry before OP_RETURN. Confirmed transfers debit the first input address and credit the recipient address; pending transfers are visibility only.
- Reconstructs credit listings from `pwt1:list5:<sale-ticket-json-base64url>`, credit seals from `pwt1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>`, delistings from `pwt1:delist5:<listing-txid>`, and buyer-funded purchases from `pwt1:buy5:<listing-txid>:<buyer-address>`.
- Credit listings reserve the seller's spendable balance, create a 546-proof seller-controlled sale-ticket output, and require the standard 546-proof credit registry mutation payment before OP_RETURN. Buys must spend the seller ticket, pay the seller the listed price plus ticket value, and pay the credit registry mutation fee.
- Active credit listings are filtered by sale-ticket outspend state. When Bitcoin Core RPC is configured, `gettxout` is the fast spend-state oracle and address-history scans are recovery context. If the ticket output is spent, the listing is closed even when a cached snapshot is otherwise stale; if the spend is a valid `buy5`, the event also appears as a credit sale.
- Credit listing seals are one-per-active-listing. A valid existing seal blocks duplicate seal attempts, while a newly confirmed listing promotion preserves the original seal and outspend state. Listing books may show sealed-or-sealing rows when a sale-ticket anchor signature is visible from confirmed state or pending visibility; confirmed state remains canonical.
- Credit market history merges active listings, closed listings, and settled sales into a paginated `market-log` view ordered by confirmation status, event time, and txid. It is not sorted by price or arbitrage.
- Fresh credit reads, credit summary reads, credit history reads, WORK summaries, and marketplace summaries refresh the shared credit payload cache before returning. Background refresh keeps fast first paint useful, but explicit refresh must converge on current node truth and may not leave a spent sale-ticket visible as active.
- Fresh reads also remove dropped pending credit/WORK transactions from overlay state after liveness checks, so stale pending transfers, listings, seals, delistings, or buys do not survive after they disappear from mempool views.
- Wallet-owned credit listing views are derived from the same active and closed listing state as Marketplace, so a connected seller can inspect confirmed, pending, delisted, and sold listings without a separate stale wallet-only book.
- Credit UI surfaces show the starting unit price as mint price divided by mint amount, plus estimated USD per credit and per mint from BTC/USD.
- `credit.proofofwork.me` is the create/mint surface, `token.proofofwork.me` and `tokens.proofofwork.me` redirect to it, `wallet.proofofwork.me` is the credit wallet for transfers, listings, delistings, and sale history, and `work.proofofwork.me` is the dedicated WORK dashboard.
- WORK is reserved for canonical credit id `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`. Official indexers and creation UI reject any non-canonical credit create whose ticker contains `WORK`, and exclude blocked scam creator address `bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl`.
- WORK settings are 21,000,000 max supply, 1,000 WORK per mint, 1,000 proofs per mint, and the `work@proofofwork.me` registry address. WORK launches at exactly 1 proof per WORK. The create form can reuse the same economic template for non-reserved tickers only.
- WORK's permanent price floor is derived from the confirmed ProofOfWork Computer network value, not from pending mempool visibility: `work_floor_sats = confirmed_network_value_sats / 21,000,000 WORK`. The inverse `21,000,000 / confirmed_network_value_sats` is the WORK-per-proof ratio.
- Credit mint-out is confirmed-only at the protocol/indexing layer: a credit is canonically minted out only when confirmed supply reaches max supply. UI mint controls also pause when confirmed plus pending mints fill the remaining supply, because pending records can consume the last valid mint slots if they confirm.
- The WORK dashboard computes and displays this live floor from the same Growth inputs, using the first-party node-backed BTC/USD endpoint for USD translations. It also charts confirmed floor history from WORK deployment onward. The dashboard must keep the live floor visually separate from the credit's owner-set mint price.
- Historical WORK floor announcement mail tx: `cbb8a1b4af2ea8665129e799a85dfba31cea87ef38b9a99bcf198d827c12a58c`. Its subject is `$work now has a permanent ProofOfWork Computer floor.` The tx status should be read from the node/API at runtime; docs preserve the txid and decoded intent, not a stale confirmation claim.
- Treats pending credit records as visibility only; confirmed records are canonical.

The staged RUSH endpoint:

- Scans the configured RUSH registry address: `bc1qym392dfvfm024k7ukzlnvnpfvuu4kfqvu56w3e` on livenet and `tb1qyh9pgznpass4mjcl8qj9yxs3vvl9rnrk5gvw6q` on testnet4.
- Reads confirmed and pending `pwr1:m:rush` records.
- Requires at least 1,000 proofs paid to the RUSH registry before the RUSH OP_RETURN.
- Credits the minter from the first input address.
- Assigns canonical ordinals only to confirmed valid mints using block height, transaction position, and txid fallback ordering.
- Computes the fixed 1,000,000,000 RUSH supply schedule across 50,000 rewarded mints: 50,000 RUSH for mints 1-5,000; 30,000 for 5,001-15,000; 18,000 for 15,001-30,000; 10,000 for 30,001-45,000; 6,000 for 45,001-50,000.
- Treats pending RUSH records as visibility only; confirmed records are canonical.

The mail endpoint:

- Scans address history.
- Reads only OP_RETURN outputs that follow ProofOfWork protocol prefixes.
- Derives recipients from normal ProofOfWork payment outputs before the first `pwm1:` OP_RETURN output.
- Reconstructs optional `pwm1:s` subject fields.
- Reconstructs `pwm1:m` message chunks.
- Reconstructs `pwm1:a` attachments after size and SHA-256 checks.
- Separates confirmed inbox/sent records from pending records.

The tx status endpoint:

- Returns `confirmed`, `pending`, or `dropped`.
- Checks local infrastructure first and the pending fallback second.
- Lets Outbox stop showing dropped transactions as forever-pending.

The tx endpoint:

- Returns a normalized transaction payload from the same local/pending source order.
- Lets Browser reconstruct HTML from `pwm1:m` message bodies or verified `pwm1:a` attachments by txid without depending on public mempool.space from production browsers.
- Does not turn pending transactions into canonical history; Browser labels pending pages as pending.
- Lets confirmed Browser pages run scripts in an opaque sandbox while keeping wallet signing outside Browser pages.
- Keeps pending Browser pages script-disabled. The API never receives seed phrases, private keys, or wallet authority.

Files/Desktop projection:

- A verified `pwm1:a` attachment appears as the file it declares.
- A Browser-readable `pwm1:m` HTML message body appears as a derived `.html` file for the Files/Desktop UI.
- The derived file opens in Browser by txid. The chain record is still the message body; no attachment is invented in protocol history.

Canonical welcome page:

```text
txid: 8c2fd17b10a6550896035b9f725054d3c6e10c314911808d8f7aaa2955c3015b
carrier: pwm1:m HTML message body
surface: pinned system file in Computer Files and public Desktop
open behavior: Browser by txid
```

## Confirmed vs Pending

Confirmed ProofOfWork history is canonical. Pending mempool state is not.

Production rules:

- Confirmed registry/mail/file history should come from the ProofOfWork node/indexer stack.
- Public Desktop reads should use the same confirmed mail/file API path as Computer.
- Pending registry/mail/outbox visibility should merge all configured mempool views.
- Pending IDs must never be routable.
- Pending mail can be shown in Incoming/Outbox, but it must not be treated as durable mail.
- Files should only show durable confirmed attachments by default in the UI.
- Dropped txs are txids that are not confirmed and are not visible in the configured mempool views at check time.

This means a tx can move:

```text
pending -> confirmed
pending -> dropped
dropped -> pending
```

The last case can happen if a tx reappears in a mempool view after being temporarily unavailable. The UI should treat dropped as a recoverable local state, not as chain consensus.

## Protocols Indexed

Mail/files:

```text
pwm1:s:<subject-base64url>
pwm1:m:<message-chunk>
pwm1:r:<parent-txid>
pwm1:a:<mime-base64url>:<name-base64url>:<size>:<sha256>:<index>/<total>:<data-base64url-chunk>
```

Recipient roles:

- Delivery recipients are normal ProofOfWork payment outputs before the first `pwm1:` output.
- Multi-recipient and CC mail share one OP_RETURN payload and one txid.
- To/CC labels are local sender-side metadata in the browser app; the API reconstructs payment-output recipients but does not infer authoritative CC roles from chain data.

IDs:

```text
pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>
pwid1:u:<id-base64url>:<receive-address>
pwid1:t:<id-base64url>:<new-owner-address>:<new-receive-address?>
pwid1:list5:<sale-ticket-json-base64url>
pwid1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>
pwid1:delist5:<listing-txid>
pwid1:buy5:<listing-txid>:<new-owner-address>:<new-receive-address?>
```

Mainnet canonical registry:

```text
bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e
```

Credits:

```text
pwt1:create:<ticker>:<max-supply>:<mint-amount>:<mint-price-proofs>:<token-registry-address>
pwt1:mint:<token-create-txid>:<amount>
pwt1:send:<token-create-txid>:<amount>:<recipient-address>
```

Mainnet credit creation index:

```text
tokens@proofofwork.me
1L4xrDurN9VghknrbsSju2vQb6oXZe1Pbn
```

Staged Confessions:

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

Confessions is staged/local-only behind `/?confessions=1` and `VITE_CONFESSIONS_ONLY=1`. It is not a public production surface until separately approved. The live indexer/writer is not enabled yet. Planned validation keeps posts and replies capped at 140 user-visible characters, lets post JSON include links and one Files-backed image reference under 100 KB before encoding, resolves accounts through confirmed ProofOfWork IDs, and requires 546 proofs to the immediate social target's confirmed ID receiver for likes, reposts, follows, and paid replies. The staged UI derives profile shells and payment receivers from confirmed `pwid1` registry records only; preview-only social accounts must not masquerade as real PowIDs. Image bytes should be created through the ProofOfWork Files attachment layer, while Confessions records store the file txid/proof/hash/size pointer and render the image inline from Files. Every confirmed PowID has a blank Confessions profile by default with location defaulting to `ProofOfWork`; `pwc1:profile:<profile-json-base64url>` updates name, bio, location, website, optional birthday, and optional Files-backed banner reference by paying 546 proofs to the owner's own confirmed PowID receiver. Name is capped at 50 characters, bio at 160, location at 30, website at 100, and banner image references point to Files-backed images capped at 100 KB. Likes, reposts, and replies are disabled until the target record is confirmed. Follows create a confirmed follow graph and power a Following timeline ordered by post time. Tips pay any user-chosen amount to the target profile receiver. Profiles should expose followers, following, Posts/Replies/Likes/Media tabs, inline reposts in Posts, confirmed social proofs earned by source, pending social proofs separately, and WORK balance when available. A confirmed `pwc1:hide` event from the author pays 546 proofs and hides the target record from default app/profile indexes without deleting it from ProofOfWork. Replies to replies pay the parent reply author, not automatically the original post author.

## Launch Rule

For production, ID resolution must use the ProofOfWork API/node path. If the API is unavailable, it is safer to fail closed than to route or register IDs from incomplete public API state.

Pending visibility is still non-canonical gossip. If `PENDING_MEMPOOL_BASE` is configured, keep it on ProofOfWork-controlled node infrastructure; it must not override confirmed first-confirmed-wins resolution.

## Production Verification Checklist

After changing the API or production build, verify:

- `/health` returns `service: proofofwork-op-return-api`.
- `/api/v1/consistency?network=livenet` is green, has no `missingLogEvents`, and includes the seeded mail and seeded Infinity Bond checks.
- ID registry count matches the node-backed API and includes pending records when visible.
- `tokens@proofofwork.me` resolves to the expected credit index address.
- Duplicate/pending IDs cannot be routed.
- Sent, inbox, incoming, files, outbox, and dropped status all work through the API.
- Public Desktop can search a raw address or confirmed ProofOfWork ID and returns only confirmed attachments.
- Browser can load a txid with HTML in the message body or a verified `text/html` attachment, render it in a sandbox, and reject non-HTML message/attachment data.
- Standalone Marketplace can list, seal, delist, and buy confirmed IDs through the same registry API.
- Credit, Wallet, and Marketplace transaction buttons can load UTXOs, previous transaction hex, and listing-anchor outspends through the first-party API before opening UniSat.
- Log can load global ProofOfWork Computer events and search an address, confirmed ProofOfWork ID, or txid.
- Known confirmed ledger regression txids are searchable in Log, including `411ff4ac6aeeb638abdc387b37734c384481bcce7dd01e28b827d02dc4968891` and `b4b17f84853ce5c9f6dbad7fe3cce0d61ac4cb92d92f7ea6d9d8c38256631f34`.
- Growth can load real chain metrics, including credit creations, mints, transfers, listings, and sales, and render the modeled-vs-real proofs/USD value graph without layout overlap on desktop and mobile.
- WORK and Growth show matching confirmed network value in proofs/live USD using `/api/v1/work-floor` and `/api/v1/prices/btc-usd`; `actualValue.totalUsd` reconciles to `actualValue.totalSats / 100000000 * btcUsd`.
- `npm run check:live-data` passes locally.
- `npm run audit:ledger` passes against production.
- Known attachment transactions reconstruct with valid size and SHA-256.
- Known HTML message-body transactions render through Browser from `pwm1:m`.
- Known pending txs return `pending`.
- Known dropped txs return `dropped`.
