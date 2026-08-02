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

ProofOfWork runs a ProofOfWork-specific PostgreSQL indexer beside the node/API
stack for fast confirmed read projections:

```text
Browser app
  -> same-origin ProofOfWork OP_RETURN API proxy
  -> ProofOfWork event database / projections
  -> private mempool/electrs API
  -> Bitcoin Core full node
```

PostgreSQL is the production database for this layer. The data is an
ordered, replayable event log with relational verification needs: txids,
outpoints, block heights, participants, IDs, credit ids, listings, and snapshot
checks. MongoDB is not the default fit for this protocol shape, and SQLite is a
useful local/dev option but not the preferred long-running production store.

The database is not the source of truth. It is a durable read model derived from
Bitcoin Core, electrs/mempool, and the ProofOfWork parsers. Confirmed chain data
remains canonical. Production confirmed reads should prefer the database
projection first, then fall back to the canonical node/API path when a projection
is missing, stale, scoped outside the indexed snapshot, or an edge read needs raw
node truth. Stable and fresh summary routes prefer the stored hash-bound canonical
summary bundle. A fresh summary verifies that bundle's height, block hash,
component snapshot ids, and exact-tip readiness against Bitcoin Core instead of
rebuilding broad Computer history in the request; if provenance cannot be proved,
the route returns HTTP 503. Pending mempool data is useful visibility and may
be stored, but pending rows must not change canonical routing, ownership, credit
balances, WORK floor, Growth value, Log totals, or durable Files/Desktop state.

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
POW_INDEX_DATABASE_URL=postgres://proof_indexer:...@127.0.0.1:5432/proof_indexer POW_API_BASE=http://127.0.0.1:8081 POW_INDEX_BACKFILL_SOURCES=registry-records,tokens,token-mints npm run indexer:backfill
POW_INDEX_DATABASE_URL=postgres://proof_indexer:...@127.0.0.1:5432/proof_indexer POW_API_BASE=http://127.0.0.1:8081 npm run indexer:parity
POW_INDEX_DATABASE_URL=postgres://proof_indexer:...@127.0.0.1:5432/proof_indexer POW_API_BASE=http://127.0.0.1:8081 npm run indexer:worker -- --once
```

The backfill script reads current canonical API history in pages and stores a
shadow copy in PostgreSQL. `POW_INDEX_BACKFILL_SOURCES` can limit a run to
comma-separated sources such as `registry-records,tokens,token-mints`, while
`POW_INDEX_BACKFILL_LIMIT`, `POW_INDEX_BACKFILL_MAX_PAGES`, and
`POW_INDEX_FETCH_TIMEOUT_MS` bound each run. A bare unfiltered backfill includes
`block-scan,mempool-scan`, so it requires the private Core RPC environment and
an authoritative hashed checkpoint; use an explicit source list for API-only
history jobs. The production hot worker runs
only `block-scan,mempool-scan`, keeps the source/token/summary fresh-crawl flags
off, and disables broad ledger snapshots. After confirmed catch-up it publishes
one authenticated canonical-summary bundle built from the completed relational
read models at the exact hashed Core tip. Broad source, token, registry, and
ledger snapshot refreshes are explicit supervised jobs, not 30-second work.
Before a confirmed Inception Bond block is verified, the scanner also enforces
an authenticated H-1 summary barrier. If the immediately preceding hashed scan
checkpoint is behind Core, the internal summary route may publish that one
explicit checkpoint only when its requested height and hash equal the current
database checkpoint and `getblockhash(height)` still returns the same hash.
This exception is loopback-only, non-deferrable, and checked again after summary
construction; ordinary summary publication remains exact-tip-only. It exists so
consecutive Inception blocks cannot ask the ordered verifier for H-1 value
before H-1 has a canonical summary. An active canonical-rebuild marker is
accepted only when that marker carries the same requested checkpoint height and
hash; public readiness remains closed until the rebuild and scan reach Core.
Do not use the barrier to promote an arbitrary scan row, skip replay, or declare
partial broad rebuild state healthy.
Canonical-summary publication also bounds the snapshot table: it keeps the
newest 4,096 canonical-summary versions and 20,000 scan/derived checkpoints by
default, while preserving every snapshot referenced by an Inception issuance
oracle. Operators can raise the two caps with
`POW_INDEX_LEDGER_CANONICAL_SUMMARY_RETENTION` and
`POW_INDEX_LEDGER_SCAN_SNAPSHOT_RETENTION`; do not lower them below the built-in
safety floors or delete referenced H-1 valuation snapshots.
Retention, canonical rebuild, PWT range replay, WORK atomic invalidation, and
repair deletion paths also preserve the immutable V5 H-1 seed-evidence row
and every completed-migration seed or closing dependency. The schema's
immutable `BEFORE UPDATE OR DELETE` trigger is the database backstop. The
evidence-bound historical canonical summary is protected when present, but
readiness does not depend on recreating it after legitimate pruning.
For every hydrated protocol transaction, canonical replay also upserts
full-node `tx_inputs`, `tx_outputs`, safely decoded `op_returns`, and canonical
spend links. These normalized rows accelerate exact transaction/outpoint audits
without replacing Bitcoin Core as the source of truth.
Existing confirmed canonical raw rows can be hydrated without replaying or
rewinding projections:

```bash
NETWORK=livenet \
POW_INDEX_TX_DETAIL_HYDRATION_BATCH_SIZE=200 \
POW_INDEX_TX_DETAIL_HYDRATION_MAX_ROWS=10000 \
npm run indexer:backfill -- --hydrate-transaction-details
```

Use `--dry-run` first. The detail-only job uses bounded keyset batches and
upserts only normalized inputs, outputs, OP_RETURN rows, and spend-link columns.
If it reports `limitReached`, resume from the returned height, block-index, and
txid cursor through the matching `POW_INDEX_TX_DETAIL_HYDRATION_AFTER_*`
variables. Legacy wrapper rows without canonical `vin`/`vout` envelopes are
excluded rather than guessed.

The parity script compares the database read model with the canonical
`/api/v1/ledger-consistency` snapshot before any endpoint cutover. It requires a
green canonical ledger, `missingLogEvents: []`, database coverage for confirmed
activity, matching confirmed credit definitions, and populated search indexes.
It also checks Log history first-page, kind-filter, and known txid-search reads
plus a recent confirmed tx-status sample against the canonical API. Warnings
such as a snapshot id moving during a refresh can be promoted to hard failures
with `POW_INDEX_PARITY_STRICT=1`. Registry and summary parity use cached
canonical snapshot sources by default and can be forced through full fresh reads
with `POW_INDEX_PARITY_SNAPSHOT_FRESH=1`; fresh Log history response comparisons
are opt-in with `POW_INDEX_PARITY_LOG_FRESH=1`, and fresh Token History response
comparisons are opt-in with `POW_INDEX_PARITY_TOKEN_FRESH=1`.

Ledger snapshots store the consistency payload and may preserve a previously
captured canonical `/api/v1/log` activity payload. The default snapshot-only
backfill does not refresh the full activity payload because that canonical read
can be intentionally expensive; set `POW_INDEX_BACKFILL_ACTIVITY_SNAPSHOT=1`
only for an explicit full Log activity refresh. Database-backed Log history
reads page from the stored activity snapshot first, then fall back to per-event
rows only when no activity snapshot exists.
Non-OK or `summary-snapshot-fallback` rows are diagnostic only. They are never
eligible for summary reads or health. Once the hashed relational scan reaches
the exact Core tip, ID, Wallet, Log, mail, registry, and history reads may reopen
without waiting for the slower summary publisher. WORK, AMO, Growth,
Infinity, Inception, and work-floor summary routes remain closed until an
authenticated `canonical-summary-refresh` row contains all eight required
payloads—Growth, Inception, Infinity, Log, AMO, Token, WORK floor, and
WORK summary—from one snapshot with conservative coverage at that same
checkpoint.

Database-backed API reads are feature-flagged. The current production
default-read posture is:

```text
POW_INDEX_READS=tx-status,log-history,token-history,token-state,registry-history,work-floor,work-summary,marketplace-summary,growth-summary,infinity-summary,inception-summary,event-history,address-mail
POW_INDEX_SHADOW_READS=log-history,token-history
POW_INDEX_READ_UNCONFIRMED_TX_STATUS=0
```

`POW_INDEX_READS=tx-status`
enables the first low-risk read adapter for confirmed transaction statuses, with
canonical node/API fallback for unknown, pending, or dropped rows unless
`POW_INDEX_READ_UNCONFIRMED_TX_STATUS=1` is explicitly set.
The confirmed fast path additionally requires a positive block height, a
64-character block hash, and a matching canonical `proof_indexer.blocks` row.
A legacy wrapper marked confirmed without that block proof falls through to
Bitcoin Core. Synthetic POWB and INCB definition identifiers are credit IDs,
not Bitcoin transaction IDs, and must not create transaction rows or Deploy TX
links.
`POW_INDEX_READS=tx-status,log-history` enables hybrid Log history reads:
database-backed reads are used for stable `q`/`search` queries, `kind` filters,
and older unfiltered activity pages. The volatile unfiltered first page remains
canonical; later unfiltered pagination is pinned to a stored ledger snapshot
through snapshot cursors so pending mempool churn cannot shift page boundaries
between reads. Exact transaction searches use current indexed events and refs;
volatile unfiltered reads still use the canonical node/API path.
`POW_INDEX_SHADOW_READS=log-history` compares Log history DB output against the
canonical response without changing the public response for DB-eligible query
shapes.
`POW_INDEX_READS=tx-status,log-history,token-history` also enables snapshot-backed
Token History reads. The indexer stores canonical `/api/v1/token-history?fresh=1`
pages in the ledger snapshot and the API repaginates those stored pages with
snapshot cursors. Unscoped `/api/v1/token-history?kind=tokens` directory reads use
an exact current proof-index page or paginate the stored hash-bound Token summary;
`fresh=1` verifies that checkpoint against the Core tip instead of materializing
the full credit ledger. Token history and token state snapshots use a 24-hour
stable confirmed-data guard by default. `POW_INDEX_READS=token-state` enables default `/api/v1/token`
reads from stored token-state snapshots for global and scoped credit views,
including AMO active/sealed books and sale-ticket lifecycle arrays.
Missing, stale, incomplete, wallet-scoped, or address-scoped state reads fall
back to the canonical node/API path. `POW_INDEX_SHADOW_READS=token-history`
compares eligible DB output against canonical Token History without changing the
public response.
Additional snapshot-backed read flags are available for the broader default-read
posture: `registry-history` serves stable registry records, activity, listings,
and sales pages from stored canonical history snapshots while pending registry
views stay canonical; `work-floor`, `work-summary`, and `growth-summary` serve
stored canonical summary snapshots with age guards and canonical fallback.
`marketplace-summary` must pass through the reconciled marketplace lifecycle
builder before returning so confirmed, unspent, buyable sealed listings cannot
be dropped by an older compacted proof-index summary snapshot. A valid sale
ticket seal spend is active sealed inventory, not a close; if a projection row
temporarily carries `closeTxid === sealTxid`, the summary builder must recover
the row as sealed unless a later real buy, delist, or other non-seal spend
closes it. Fresh marketplace and summary reads must return one coherent snapshot
at the exact hash-verified Core tip; if that cannot be proved inside the request
budget they return 503. Stable reads may serve a coherent hash-verified last-good
snapshot with explicit indexed height, tip, lag, and snapshot provenance.
Stable Log, Log-history, and consistency reads pin their relational rows to that
same snapshot id, height, and hash and recheck Core after the read; stale
cursors, out-of-snapshot rows, and unproved exact txid misses fail closed. Exact
txid Log membership is bounded to the returned relational event ids and their
snapshot-fenced canonical transaction/block rows; it never authenticates a page
by scanning the entire activity ledger.
Fresh reads and every signing/broadcast admission path remain exact-tip-only.
Exact-tip truth is the canonical indexed height and hash matching Core, not the
age of the worker heartbeat. A stale worker heartbeat keeps `/health` readiness
red for operators, but it must not relabel a hash-matched zero-lag wallet read
as catch-up or block a current signing preflight. Summary-backed routes still
require their coherent summary snapshot to match that exact tip.
`event-history`
serves DB-backed protocol/event search for indexed registry, credit,
marketplace, mail/file, seeded, and broader Computer events; `address-mail`
serves connected-wallet mailbox reads from the indexed mail projection,
including confirmed Inbox/Sent and indexed pending Incoming/Outbox visibility.
`pwm1:m:powb` is normalized as `infinity-bond` and `pwm1:m:incb` as
`inception-bond` for Log/Event/summary accounting, while both still project into
`mail_items`. Each confirmed Infinity recipient payment mints one POWB per proof
sent. Each confirmed Inception bond issues one INCB per whole proof in its
direct payment plus attached WORK value measured by the send-time oracle: the
last confirmed green canonical live WORK summary at H-1, hash-bound to the exact
previous block. Every transaction in the bond block is excluded. Confirmation
fixes the resulting INCB balance, supply, and attached WORK proof value.
Self-sends are the self-recipient case and land in both Inbox and Sent.
Any attached credit is parsed separately as canonical WORK movement. The valid
recipient-matched same-transaction WORK attachment contributes to INCB issuance
without creating a second global WORK movement/value event. Inception network
value equals fixed cumulative issuance value plus confirmed INCB sale volume,
transfer fees, and marketplace mutation fees. Current or later WORK value never
reprices INCB.
INCB uses
`inception@proofofwork.me` and reserved credit id
`3cb25745f937f2b4e5508e5400189fe8fe679cd8e84bfa1e9176d70c9761f15d`.
Generic `pwt1:create` and `pwt1:mint` events are invalid for both reserved bond
families. Their synthetic supply can be issued only by the matching canonical
bond projection. All other generic mints require the confirmed credit definition
to precede the mint in canonical block and transaction order.
POWB and INCB are uncapped synthetic credits. Public token definitions expose
`maxSupply: null`, `maxSupplyModel: "uncapped"`, and `uncapped: true`; the
unconstrained `numeric NOT NULL` definition column uses zero only as a neutral
storage marker required by the shared non-null schema. No cap check, API
response, chart, or wallet calculation may treat it as an economic maximum.
Bond amounts, balances, per-token supply, and listing quantities use
unconstrained PostgreSQL `numeric` with integer/finite database checks, then
canonical integer strings/`BigInt` in the backend. This removes the former
78-digit typmod ceiling without admitting fractional or infinite credit units.
Fractional proof value uses Q8 integer strings; decimal proof fields are display
mirrors, not arithmetic authority.
INCB validation treats the persisted Q8 integer issuance fields as the
authoritative arithmetic contract; large floating-point display fields cannot
reject an otherwise exact mint. The canonical H-1 transaction context also
carries confirmed invalid mint dispositions from its same hashed checkpoint,
so replay cannot resurrect a historically rejected bond attempt.
Insufficient-balance WORK actions are recorded per protocol output even when a
sibling action succeeds. A malformed current-block Inception attachment is
converted to a durable invalid mint only when its rejected WORK action, amount,
recipient, protocol output, bond/seed position, txid, height, and block hash all
match. Missing oracle data, verifier dependencies, and malformed persisted v2
issuance remain unavailable/fail-closed rather than being relabeled invalid.
The `log` flag is reserved for an explicit full activity snapshot refresh.
Volatile broad activity and mempool reads still use the node/API path so explicit
refreshes converge on current chain and mempool truth.
Paginated fresh Log reads use current relational events only when they match the
same hash-bound exact-tip Log summary. `indexedThroughBlock` is verified scan
coverage, while `latestEventBlock` is the newest block containing a matching
protocol event; an empty run of Bitcoin blocks must not be presented as index
lag. A count, snapshot, height, hash, or readiness mismatch remains a 503.
Confirmed Log rows are pinned by snapshot height, hash, and `updated_at`.
Pending Log visibility is noncanonical and best-effort: membership is bounded
by `created_at` and the row's current `pending` status, so a later liveness
refresh cannot make an otherwise valid last-good snapshot unavailable. Pending
rows never establish confirmed history, balances, supply, network value, or
market state.

Confirmation removes the transaction's volatile event overlay atomically. The
canonical block writer first owns the transaction row under the same database
lock used to exclude the mempool writer. In that one database transaction it
removes every `pending`, `dropped`, or `orphaned` event owned by the
transaction—cascading its participant and reference rows—then persists the
confirmed canonical events and derived projections. Any failure rolls the
whole confirmation change back, so a reader cannot observe a confirmed parent
transaction with a stale volatile event. The ID reader independently requires
matching parent/event dispositions, and the parity gate hard-fails when a
confirmed transaction in a canonical block owns a volatile `pwid1:` event.

The worker script keeps the indexer warm by repeatedly running bounded
backfill pages, refreshing stale pending transaction statuses through
`/api/v1/tx/:txid/status`, marking disappeared txids as `dropped`, and running
the parity checker on a slower cadence than block catch-up. Continuous worker
cycles require two authoritative Bitcoin Core absence proofs separated by at
least five minutes before a pending row can become dropped. The confirmation
window is measured from the first consecutive absence; faster checks preserve
that epoch, while any proven pending or confirmed observation resets it.
Continuous worker cycles use
`POW_INDEX_WORKER_BACKFILL_SOURCES=block-scan,mempool-scan` as the hot path.
The worker runs that hot path as two sequential child phases under its one
writer: `block-scan` catches up and publishes the exact canonical-summary
bundle first, then `mempool-scan` runs with canonical-summary publication
disabled. The bounded mempool scanner gives best-effort pending visibility
without being allowed to delay that confirmed publication or the next
confirmed pass: it stops at a transaction boundary after its 15-second
scheduling budget, verifies at most five protocol-bearing mempool txids per
pass, and persists its rotating cursor so deferred candidates remain visible
to later cycles. This pending-only child exits after the mempool source has
persisted its transactions and scan cursor; it does not repeat the canonical
RUSH bootstrap, relational repairs, holder backfill, ledger snapshot, or
canonical-summary work already owned by the confirmed phase. A separate
30-second child watchdog terminates a pending pass that does not return after
the cooperative budget, escalating from `SIGTERM` to `SIGKILL` after one
second and waiting for child closure before the one-writer loop proceeds.
Committed pending writes remain idempotent; an interrupted in-flight database
transaction rolls back and its candidate remains eligible for a later cursor
pass. Routine pending ordered-verifier requests are capped at five seconds.
The versioned legacy WORK inspection described below remains subordinate to
the hard child watchdog. Its historical 30-second allowance remains available
outside this pending-only worker mode. Inside the pending-only child it is
capped at 20 seconds and shortened further by elapsed child time so at least
nine seconds remain for error handling, cursor persistence, and shutdown; if
that headroom is already exhausted, the inspection is deferred without
starting. Production pins those bounds with
`POW_INDEX_MEMPOOL_SCAN_BUDGET_MS=15000`,
`POW_INDEX_MEMPOOL_SCAN_MAX_PROTOCOL_TXIDS=5`, and
`POW_INDEX_PENDING_VERIFIER_TIMEOUT_MS=5000`, plus
`POW_INDEX_WORKER_PENDING_BACKFILL_TIMEOUT_MS=30000`; the backfill script also
clamps the routine overrides to those maximums. The block scanner uses local
Bitcoin Core RPC verbosity 2 to scan blocks after the database's indexed height
for ProofOfWork OP_RETURN prefixes, then writes discovered txids through the
normal projection writer. It hydrates and verifies input prevouts only for
discovered protocol transactions, deduplicates previous transaction lookups,
and permits at most four concurrent prevout RPCs. Complete value and script
evidence is mandatory; an addressless but complete Bitcoin script is allowed
through to the ordered protocol validator. Core calls have their own 15-second
timeout and two-retry budget, independent of broad API-source fetch
settings. This avoids full prevout expansion for every unrelated transaction in
every scanned block and prevents one high-input protocol-looking transaction
from flooding the local node. History-page sources such as token
listings, token closed-listings, registry pages, and Log pages remain available
as explicit backfill jobs, but should not run after block-scan in the hot loop
where stale summary guards can turn them into retry stalls. WORK and
POWB/Infinity plus INCB/Inception token snapshots, together with WORK, Growth,
AMO, Infinity, and Inception summaries, are first-class snapshot sources. Broad
mailbox projection sweeps such as `address-mail` can be run as explicit backfill
jobs, but should not sit in the hot worker loop where slow address history reads
can stall block catch-up for Log, Growth, WORK, Credit, AMO, Infinity,
and Inception. Scoped-holder recrawls stay off by default
(`POW_INDEX_WORKER_HOLDERS=0`) and should run as explicit full backfill jobs.

The block scanner checkpoint is fail-closed. A normal worker start requires a
previous authoritative `proof-indexer-block-scan` checkpoint with the exact
Bitcoin Core block hash stored in `indexedThroughBlockHash`; it must not infer
an initial checkpoint from an unrelated summary snapshot, accept a legacy
hashless scan row, or silently jump to the current tip. If both a newer legacy
hashless row and an older hashed replay checkpoint exist, the worker and health
reader must resume from the hashed checkpoint. On a new database or a database
that only has legacy hashless checkpoints, first seed and verify the canonical
relational projections, then set
`POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT=<intentional-start-height>` for the
first supervised block-scan replay. Remove that bootstrap variable immediately
after the first hashed checkpoint is stored; leaving it set would replay from
the same height every cycle. Record the chosen height, its Bitcoin Core block
hash, and the verification evidence in the deployment notes. A missing RPC URL,
incomplete block, missing checkpoint hash, or unresolved canonical verifier
result is a failed scan, not permission to advance coverage.

Production recovery uses a clean, supervised canonical rebuild rather than a
checkpoint-only rewind. The production protocol replay begins at block
`948000`, before the first supported ProofOfWork protocol transaction. Use this
order:

1. Back up PostgreSQL and the active service/config files. Stop both the API and
   worker so no public process can serve or rewrite mixed-era projections.
2. Create `/etc/proofofwork-api/internal-verifier.env` with one strong shared
   `POW_INTERNAL_VERIFIER_TOKEN`, owned by `root:powadmin` with mode `0640`.
   Both the API and replay process must load that same file. The internal
   verifier accepts only authenticated loopback requests and must never be
   exposed through Caddy.
3. With `NETWORK=livenet`, the database/RPC environment loaded,
   `POW_INDEX_BACKFILL_CANONICAL_REBUILD=1`, and
   `POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT=948000`, run
   `npm run indexer:backfill -- --prepare-canonical-rebuild`. Preparation is
   one database transaction: it clears only the derived canonical
   `pwid1`/`pwt1`/`pwm1` projections, invalidates ledger snapshots, seeds the
   synthetic WORK definition directly in exact `work-atoms-v1` storage, and
   stores the hash of block `947999` as the bootstrap checkpoint. Preparation
   and every resumed rebuild re-read and verify that stored atomic definition;
   an empty-table cache or legacy whole-WORK seed cannot authorize replay. Do
   not reopen public reads if preparation fails.
4. While the API is still stopped, remove complete and temporary JSON cache
   files from both `/data/proofofwork-api-cache` and the legacy
   `/opt/proofofwork-api/.pow-api-cache`. These files are derived state; keeping
   them would allow a pre-rebuild snapshot to survive the database reset.
5. Start the API locally. Its canonical-read gate must remain `503` while the
   rebuild metadata is active. Confirm the authenticated internal verifier on
   `127.0.0.1` and confirm the same route is unreachable through the public
   reverse proxy. Then run the `block-scan` backfill with the same rebuild and
   start-height variables, plus `POW_INDEX_BACKFILL_HOLDERS=0` and
   `POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT=0`, until the checkpoint height and
   hash exactly match Bitcoin Core's best block. Holder crawling and snapshot
   publication are post-rebuild jobs; leaving either enabled can make a
   successfully committed replay batch fail afterward against the intentionally
   closed public-read gate. Production pins
   `POW_INTERNAL_VERIFIER_STATE_TTL_MS=120000` so every stateful transaction in
   one busy block shares the same completed ordered state instead of rebuilding
   it after the default short cache window. Confirmed verifier requests, cache
   keys, and responses are bound to the exact current and previous Core block
   hashes; a same-height replacement cannot reuse the prior branch's state.
6. Generate one new full ledger snapshot in a supervised snapshot-only run by setting
   `POW_INDEX_BACKFILL_SOURCES=snapshot-only`,
   `POW_INDEX_BACKFILL_HOLDERS=0`, and
   `POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT=1`. Run it through the authenticated
   loopback API environment, with canonical-summary storage disabled for this
   full writer. The shared verifier header permits the local bootstrap reads
   while the public summary-coverage gate correctly remains closed; it is never
   sent to a non-loopback API base. Never reuse a snapshot deleted by the
   rebuild. Then start the worker and require a successful confirmed-first
   cycle. It must publish the authenticated canonical-summary bundle last, from
   one exact indexed-ledger snapshot, before health can turn green. The hot
   worker does not repeat the broad snapshot crawl every 30 seconds.
7. Remove the one-time rebuild/start-height variables, run parity and product
   regression gates, then reopen public traffic only when health proves a
   complete hashed checkpoint at the current Core tip, fresh worker state,
   nonempty ID and WORK projections, and no canonical fault.

Before the production reset, execute the same sequence against a clone of the
production database and benchmark a late-height WORK verifier plus the combined
ID/all verifier. Each internal verifier request must complete inside its
30-second API deadline, and each block-scan batch must fit inside the worker's
240-second child watchdog. A slow shadow result is a release blocker, not a
reason to increase production timeouts blindly.

For credit `list5`/`seal5`, sealing publishes the signature but never moves the
sale-ticket anchor. The only canonical outpoint is always
`<listing-txid>:<saleAuthorization.anchorVout>`; a seal transaction output is
not a replacement ticket. Delists and buys must spend the original 546-proof
listing output. Treating `<seal-txid>:<anchorVout>` as the ticket can falsely
close listings when ordinary seal-transaction change is later spent, reject the
real close, and corrupt every downstream credit balance.
Legacy seal transactions that themselves spend the original listing output are
closed because no buyable ticket remains. A `closeTxid === sealTxid` projection
may be recovered as active only when first-party outspend truth proves the
original listing output is still unspent; unknown or confirmed-spent state stays
closed.

If a verifier bug of that kind is discovered after an otherwise clean replay,
repair a database clone with the bounded PWT range workflow rather than
rewinding only the checkpoint or layering corrected event keys over stale ones:

1. Stop the clone API/worker and prove the first affected PWT height from
   relational events plus Core transaction/block truth. Choose a replay height
   at or before the first transaction that could have been misclassified.
2. Keep the original canonical rebuild lineage (`fromHeight`, bootstrap height,
   and bootstrap hash). For the July 2026 pinned INCB incident, set only
   `POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT=958383`, set
   `POW_API_BASE` to an explicit non-public loopback port reserved for the clone,
   and run
   `npm run indexer:prepare-pwt-range-replay` with canonical rebuild mode off.
   This incident preparation command rejects every other boundary. Stop the
   clone API and clear only that clone's private API cache before preparation;
   restart it after preparation so its replay binding and canonical-state
   caches are born from the newly active tuple. The private clone API must use
   the full production proof-index read posture from
   `deploy/proofofwork-api-proof-index.conf`, including `token-state`; a
   verifier-only/minimal `POW_INDEX_READS` setting cannot build the exact
   conserved token table required by an Inception H-1 barrier. Before the first
   block-scan pass, prove the candidate PID's database identity and enabled
   read set, then make one authenticated, binding-echoed internal canonical
   summary request for `<range-start - 1>`. Require the exact stored block hash,
   green ledger consistency, and exact WORK Q8. A missing feature, wrong
   database, stale binding, or failed H-1 probe is a pre-scan abort; do not
   advance the checkpoint or work around it with a weaker read posture.
   Ordinary workers and public/API readers continue to reject an uncertified
   legacy replay completion. The preparation command alone may supersede the
   exact known pre-binding predecessor: canonical range `948000`, bootstrap
   `947999` at
   `000000000000000000004238bec59ce46cd5b28982efe2b90071a51168d67986`,
   and prior PWT range `950200`, with no fault, binding, or completion
   certificate. Before any transaction or delete, the command asks Bitcoin
   Core to re-prove both the original bootstrap hash and the legacy stored-tip
   hash and requires that stored tip to cover the new boundary. A malformed,
   active, off-chain, or already-certified replay cannot use this compatibility
   lane; a certified completion is permanent.
   Before deleting any projection, preparation enumerates every exact
   `pwm1:m:incb` transaction in the bounded canonical range and cross-checks
   that set against the canonical bond events. It asks Core to bind each entry
   to its block position and predecessor, the exact pre-memo recipient output
   set, direct proofs, memo, and attached WORK atoms. The resulting immutable
   witness manifest gives every recipient one disposition: preserve an already
   valid exact-Q8 V2 mint together with its complete green H-1 snapshot row, or
   rederive an absent/ambiguous/malformed projection. A multi-recipient bond is
   rederived as one unit if any recipient cannot be preserved. The manifest is
   canonical-JSON hashed, stored under a binding-specific metadata key, and its
   hash, counts, range tip, and range-tip hash become part of the replay
   verifier binding. Missing memo coverage, a changed Core fact, an incomplete
   snapshot row, or a mismatched manifest aborts before deletion.
   A boundary after marketplace genesis is allowed only because preparation
   runs at `SERIALIZABLE` isolation under advisory/table locks, deletes every
   protocol sibling for affected PWT txids, then reconstructs definitions,
   listing lifecycle, and confirmed balances from retained pre-range events.
   In that same stopped-writer transaction, preparation migrates definition
   max/mint units, confirmed/pending balances, and listing amounts from the
   legacy `numeric(78,0)` typmod to integer-checked unconstrained `numeric`.
   It normalizes existing POWB/INCB definition storage to zero plus explicit
   uncapped metadata. The catalog-gated migration is idempotent and must report
   no remaining constrained credit-unit column before any replay row is
   deleted. Before the first destructive delete, preparation requires an
   already-atomic WORK source, verifies every amount-bearing WORK event, and
   proves exact confirmed mint-atom supply equals the sum of confirmed holder
   atoms. A legacy definition or a hybrid definition/balance projection aborts
   the transaction. After clearing derived credit tables, WORK is seeded
   directly with atomic max/mint storage and `work-atoms-v1` metadata; that row
   is re-read after seeding, after retained definitions are projected, after
   retained balances are conserved, and once more before commit.
   It aborts if a false seal-anchor close already exists before the boundary.
   Incident-pinned Core facts are checked before and after the transaction.
   Preparation clears derived snapshots except the manifest-committed H-1 rows,
   which are protected from replay deletion, retention pruning, atomic-WORK
   invalidation, and same-id summary replacement. It stores the exact
   `<range-start - 1>` checkpoint and never preserves old derived balances or
   listing tables. It also stores a fresh 256-bit verifier binding in that clone
   database and removes any prior replay completion timestamp or verification
   proof before marking the new range active. The clone API must read the same
   binding and witness manifest from its own
   `canonical:rebuild` metadata, require it on every internal verifier/summary
   request, re-read it after building the payload, and echo the unchanged
   binding in the response. A production or stale-clone API at the
   same Core height cannot satisfy that database binding.
3. Remove the range-start variable immediately. Run supervised
   `block-scan`-only passes with ledger and general canonical-summary storage
   disabled until the hashed checkpoint reaches Core tip, while retaining the
   same explicit clone `POW_API_BASE`. While replay metadata is active, the
   backfill process rejects every other source, repair/maintenance mode, and
   general ledger/summary publisher in code; malformed active/complete replay
   flags also fail closed. General summary publication remains off,
   but active range replay forcibly builds and stores an exact hash-bound H-1
   canonical summary immediately before every block containing an Inception
   Bond. That mandatory barrier supplies the historical oracle for any rederive
   disposition and cannot be disabled by the storage flag; manifest-preserved
   bonds continue to consume their byte-committed original H-1 row and exact
   mint payload. Do not use the
   normal worker publisher while the replay is partial; a non-tip public summary
   is expected to fail.
4. Run one normal worker cycle at tip to rebuild conserved balances and publish
   the exact canonical summary. Completion must consume every manifest entry
   exactly once. Preserved entries must retain the committed mint payload hash,
   snapshot identity, canonical-summary hash, generated time, exact Q8 value,
   and raw row fingerprint. Rederived entries must end as either one canonical
   exact-Q8 mint bound to the forced green H-1 row or one unambiguous canonical
   invalid disposition. No rejected sibling alias may remain. The completion
   certificate repeats the witness hash, counts, range tip, and per-entry
   results; once certified, the replay cannot be prepared again. The pinned
   incident targets additionally require one valid bond, one exact WORK
   `send2`, and one exact INCB mint per target, unchanged Core positions, and
   the exact dynamic H-1 Q8 formula. Require lifecycle, marketplace, ledger,
   wallet, and parity gates before considering the repaired clone promotable.
   Later ordinary block scans must continue authenticating internal verifier
   reads with that completed replay's immutable database binding and witness
   manifest. Both the API and database witness reader must validate and accept
   the completed certificate shape. Dropping the binding after certification
   forces historical H-1 rederivation, can deadlock the first later Inception
   block, and is forbidden.

   Every block catch-up that reaches the exact node tip must rebuild confirmed
   credit balances from canonical events before publishing summaries, including
   ordinary catch-up after a completed PWT/INCB replay. The completion
   certificate is not regenerated, but newly confirmed large bond mints must be
   reflected in `credit_balances` before conservation gates can publish the new
   snapshot.

   If a worker reached tip with canonical events committed but balance
   publication failed before this invariant was available, stop the worker and
   run `node scripts/backfill-proof-indexer.mjs --rebuild-credit-balances` with
   the production service environment. The command replays every confirmed
   credit ledger in one transaction and is safe to retry; restart the worker to
   publish the exact-tip summaries afterward.

Stored block hashes detect a reorganization; they do not provide automatic
projection rollback. If the stored checkpoint hash no longer matches Bitcoin
Core, the worker must stop and health must remain red. Operators must then:

1. Stop the worker and API so detached projections are not served as current.
2. Identify the last common ancestor with Bitcoin Core and take a database
   backup before changing projection state.
3. Restore a known-good database backup from before the detached branch, or
   rebuild all affected canonical relational projections in a clean database.
   Deleting or rewinding only the block-scan checkpoint is unsafe because event,
   participant, ID, credit, listing, mail, and snapshot rows may also be from the
   detached branch.
4. Run one supervised explicit bootstrap/replay from the verified recovery
   height through the node tip, then remove the bootstrap variable.
5. Require zero block lag, matching checkpoint hash, complete scan metadata,
   parity/regression gates, and exact affected tx checks before restarting
   public service.

Production runs the hot loop every 30 seconds, confirmed blocks first and the
bounded mempool pass second, so the database is warmed after new blocks rather
than by public page requests. Request paths should serve a
current checked proof-index summary snapshot first, then trigger any deeper
canonical refresh in the background. Livenet routes must fail closed or keep a
verified last-good snapshot; they must not fabricate empty zero summaries when
the node, database, or cache refresh is slower than the HTTP budget.
When a new confirmed checkpoint outruns the stored summaries, the hot worker
requests one authenticated internal bundle built from the canonical relational
read models. The API validates the complete hashed checkpoint against Bitcoin
Core and the Electrum header both before and after construction, requires exact
conserved token balance/holder tables, and performs a fresh ordered RUSH
registry read whose complete Electrum history is hydrated and ordered against
canonical Core blocks. Each mandatory activity, registry, and token projection
must independently cover the exact checkpoint. It then returns ledger, WORK,
Growth, AMO, Infinity, Inception, and
work-floor payloads bound to one snapshot ID. The
publisher never derives valuation changes from aggregate DB event deltas.
Coverage is the conservative minimum of every parent summary and its mandatory
nested floor, so a fresh wrapper cannot hide stale child data. Full/legacy
snapshot writers clear canonical-summary provenance; the canonical publisher
must run last. Health and the public-read gate require eligible coverage at the
canonical checkpoint before reporting green.
When a snapshot route is current from proof-index data but the full shared
ledger is still catching up, the route can publish the bounded proof-index view
and leave the ledger refresh in the worker/background path.
That bounded view is still one app-wide data plane: WORK, Growth, AMO,
Consistency, Wallet, Credit, IDs, Infinity, Inception, Log, and Computer must agree on the
same confirmed snapshot/verifier contract, and embedded summary objects must not
mix a live parent total with stale child data.
Exact txid/ref lookups are also part of the speed contract. Log searches use
indexed transaction ids and `event_refs`; explicitly invalid, nonpublic, dropped,
or orphaned records return a classified empty result. An indexed confirmed or
pending transaction missing its required public Log projection fails closed with
`CANONICAL_LOG_PROJECTION_MISSING`. Exact active-listing searches match listing,
sale-ticket, seal, and close txids; they return an empty terminal result only
when the database contains explicit terminal evidence, otherwise canonical
recovery remains eligible. Exact 64-character searches never fall through to a
broad history replay.
Fresh wallet credit state uses the exact relational token projection with a
dedicated 10-second production wait, clamped between 5 and 15 seconds. A timed
out or unprovable read still returns `CANONICAL_INDEX_UNAVAILABLE`; it never
falls back to legacy history materialization.
Pending status checks use their own smaller timeout
(`POW_INDEX_STATUS_FETCH_TIMEOUT_MS`) and batch limit
(`POW_INDEX_PENDING_STATUS_LIMIT`) so a single cold tx lookup cannot block a
full worker cycle. Production service configuration is tracked in:

```text
deploy/electrs-open-files-override.conf
deploy/electrs-hardening.conf
deploy/electrs-network.toml
deploy/bitcoin-rpc-network.conf
deploy/bitcoind-hardening.conf
deploy/proofofwork-api-proof-index.conf
deploy/proofofwork-api-node-runtime.conf
deploy/install-node-runtime.sh
deploy/proofofwork-indexer-worker.service
deploy/Caddyfile
deploy/caddy-hardening.conf
deploy/wireguard-ui.conf
deploy/wireguard-node.conf
deploy/zz-proofofwork-api-private-network.conf
deploy/proofofwork-api-wg.socket
deploy/proofofwork-api-wg.service
deploy/proofofwork-cache-prune.service
deploy/proofofwork-cache-prune.timer
deploy/logrotate-timer-override.conf
deploy/rsyslog-logrotate.conf
deploy/ufw-logrotate.conf
deploy/proofofwork-ufw-log-tmpfiles.conf
deploy/journald-storage.conf
deploy/coredump-disable-sysctl.conf
deploy/postgresql-backup.conf
deploy/pg-basebackup-timer-override.conf
deploy/var-backups-postgresql.mount
deploy/proofofwork-postgres-logical-backup.sh
deploy/proofofwork-postgres-logical-backup.service
deploy/proofofwork-postgres-logical-backup.timer
deploy/proofofwork-release-prune.sh
deploy/proofofwork-ui-release-prune.service
deploy/proofofwork-ui-release-prune.timer
deploy/proofofwork-node-release-prune.service
deploy/proofofwork-node-release-prune.timer
deploy/proofofwork-deploy-tmpfiles.conf
```

The node health contract includes those tracked service overrides. Install the
checksum-pinned Node.js 24 LTS runtime with `deploy/install-node-runtime.sh`,
then install `deploy/proofofwork-api-node-runtime.conf` as
`/etc/systemd/system/proofofwork-api.service.d/30-node-runtime.conf`. The API
and indexer worker both use the exact versioned binary under `/opt`; they must
not fall back to Ubuntu's end-of-life Node.js 18 package. The worker invokes its
entrypoint directly instead of adding the npm wrapper to the service process.
For a future production dependency install, prepend
`/opt/node-v24.18.0-linux-x64/bin` to `PATH` before invoking npm; never use the
Ubuntu `/usr/bin/npm` runtime for this application.
Install the
Bitcoin Core hardening file as
`/etc/systemd/system/bitcoind.service.d/90-hardening.conf`. Replace the broad
RPC bind/allow rules in `/etc/bitcoin/bitcoin.conf` with the tracked loopback and
`172.27.0.0/16` mempool bridge fragment, preserving the existing credentials and
all unrelated node settings. After restart, Core RPC must listen only on
`127.0.0.1:8332` and `172.27.0.1:8332`; never on the public node address or a
wildcard socket. Install `deploy/verify-bitcoin-rpc-bridge.sh` as executable
`/usr/local/sbin/proofofwork-bitcoin-rpc-bridge-ready`. The tracked unit orders
Core after Docker and refuses startup unless the `mempool_mempool` network and
its exact `172.27.0.1/16` bridge address are present, so a missing or recreated
bridge fails closed instead of leaving Core in a restart loop with an ambiguous
RPC exposure.
Install `deploy/electrs-hardening.conf` as
`/etc/systemd/system/electrs.service.d/90-hardening.conf`, and install
`deploy/electrs-open-files-override.conf` as
`/etc/systemd/system/electrs.service.d/zz-index-recovery.conf`, lexically after
any older `override.conf`. Verify the combined effective unit with `systemctl cat`
and `systemctl show`. The hardening layer removes all capabilities, disables core
dumps, hides devices and home directories, and protects kernel and control-group
state. The recovery layer bounds `LimitNOFILE=65536`, restart delay/start limit,
and service log rate so descriptor/runaway-log failure cannot consume the root
filesystem. Merge `deploy/electrs-network.toml` into
`/etc/electrs/config.toml`: the Electrum RPC listener binds only to the verified
`172.27.0.1` mempool bridge, while both the API and worker use that same private
address. The hardening unit runs the Docker bridge preflight before electrs so a
missing or changed bridge fails closed; never restore a wildcard Electrum
listener. The API proof-index override moves
rebuildable cache state to `/data/proofofwork-api-cache`, requires that mount,
sets the proof-index health freshness ceiling to 120 seconds, and disables core
dumps. Create that directory as `powadmin` before starting the API; copy only
complete cache JSON if retaining a warm cache, never orphan `*.tmp` files.
The public UI host and node host use the tracked WireGuard templates as a
private transport. The API process binds only to `127.0.0.1:8081`; the hardened
socket proxy exposes `10.77.0.2:8081` only on the tunnel, and Caddy proxies
`/api/*` plus `/health*` to that address. Host firewalls allow the tunnel peer
and required public web/SSH ports only. The proxy service has an empty capability
set and `LimitCORE=0`; the socket unit itself does not execute application code.
Install the Caddy unit hardening drop-in,
validate the tracked Caddyfile, then verify HSTS, CSP, COOP, immutable hashed
asset caching, document revalidation, and gzip/zstd responses on every public
surface. Verify the effective Caddy unit retains only `CAP_NET_BIND_SERVICE` in
both its capability bounding and ambient sets. Browser HTML is always rendered as static content inside an opaque
iframe with both scripts and forms disabled; confirmed content never receives a
wallet-provider execution lane. Before `srcdoc` serialization, the Browser parses
HTML in an inert template, removes meta/base/executable/embed elements, strips
navigation and form URLs, replaces forms with inert containers, and permits only
in-memory `data:`/`blob:` media. The child deny-all CSP and the shared parent
frame policy then provide independent network and navigation defenses. Only the
landing-page header policy grants the separate YouTube frame origins used by its
public video.

The worker requires the real production cluster unit
`postgresql@16-main.service`, checks `pg_isready` before startup, records
`starting`, `running`, `idle`, and `failed` state in `worker:lastRun`, and keeps
the last successful cycle visible across an in-progress or failed cycle. The
confirmed scanner runs before pending-status cleanup; if confirmed catch-up
fails, that cycle does not refresh the best-effort pending overlay. A structured
`block-scan-verification` failure is containable only when it carries the
trusted `CanonicalTransactionContentInvariantError` class and
`POW_CANONICAL_TX_CONTENT_INVARIANT` code and the worker can prove an
authoritative hashed block-scan checkpoint before the failing height. RPC,
verifier HTTP, database, abort, and timeout errors are never reclassified as
deterministic transaction content.
Repeated identical failures without checkpoint progress are persisted inside
the single network-bound `worker:lastRun.noProgress` record. Retries back off
from `POW_INDEX_WORKER_ERROR_INTERVAL_MS` to
`POW_INDEX_WORKER_MAX_ERROR_INTERVAL_MS`, and an alert-ready diagnostic is
emitted at `POW_INDEX_WORKER_NO_PROGRESS_ALERT_INTERVAL_MS`. `/health` remains
not-ready and exposes the checkpoint, failing height, txid, repeat count, and
next retry while `/health/live` can continue to report separately verified
node/read-model availability. Any real checkpoint advance resets the circuit.
Generic, unstructured failures are not contained: three consecutive failed
cycles still make the process exit so systemd exposes and recovers the fault.
SIGTERM/SIGINT stops the active child and cancels retries before shutdown. The
block/mempool child has a
240-second wall-clock watchdog, followed by `SIGTERM` and a five-second
`SIGKILL` grace period, so a wedged child cannot freeze the confirmed loop.
Each hot-loop child has a hard 250-block cap and a block-boundary target of 250
discovered protocol transaction ids. The scanner preflights the next block and
defers it when adding that whole block would cross the target. Because the
checkpoint is atomic per Bitcoin block, the first block in a cycle is always
processed whole even if that single block contains more than 250 protocol
transactions; the target is not an unsafe within-block cutoff. The watchdog
still rolls back a wedged atomic block, while a guaranteed resumable path for an
adversarially dense single block would require future intra-block staging or a
batched block verifier. These bounds keep measured historical catch-up batches
inside the watchdog while the next cycle resumes from the last committed hash;
the supervised one-time rebuild may use separately measured recovery bounds.
Pending-status cleanup is secondary work: production limits it to five
concurrent five-second requests inside a 15-second scheduling budget and
defers untouched rows to the next cycle. The slower parity child has its own
120-second watchdog. A normal warm canonical-summary refresh remains fast, but
the first refresh after an explicit derived-snapshot invalidation is allowed a
finite 10-minute request budget inside a 15-minute worker-child watchdog. This
cold-rebuild allowance changes only the watchdog; the refresh still must publish
one exact green hash-bound snapshot or fail closed. These production bounds are
tracked as `POW_INDEX_CANONICAL_SUMMARY_REFRESH_TIMEOUT_MS`,
`POW_INDEX_WORKER_BACKFILL_TIMEOUT_MS`, `POW_INDEX_BITCOIN_RPC_TIMEOUT_MS`,
`POW_INDEX_BITCOIN_RPC_RETRIES`, `POW_INDEX_PREVOUT_HYDRATION_CONCURRENCY`,
`POW_INDEX_PENDING_STATUS_CONCURRENCY`,
`POW_INDEX_STATUS_FETCH_TIMEOUT_MS`, `POW_INDEX_PENDING_STATUS_BUDGET_MS`, and
`POW_INDEX_WORKER_PARITY_TIMEOUT_MS` in the worker unit. The worker and API
service limits also set `LimitCORE=0`.

Install the cache prune unit and timer under `/etc/systemd/system/`. It deletes
only orphan cache files named `*.tmp` older than 15 minutes. Failure to inspect
the primary `/data/proofofwork-api-cache` path is fatal and visible in the unit;
the legacy `/opt/proofofwork-api/.pow-api-cache` cleanup is optional. Install
`rsyslog-logrotate.conf` as `/etc/logrotate.d/rsyslog` (replace the existing
rsyslog rule instead of creating a duplicate path rule), and install the timer
override under `/etc/systemd/system/logrotate.timer.d/override.conf` for hourly
rotation. Install `journald-storage.conf` under
`/etc/systemd/journald.conf.d/90-proofofwork-storage.conf` to bound persistent
and runtime journal use while reserving root-disk runway.
Install `ufw-logrotate.conf` as `/etc/logrotate.d/ufw` and
`proofofwork-ufw-log-tmpfiles.conf` under `/etc/tmpfiles.d/` on both VPSs.
Run `systemd-tmpfiles --create` before restarting rsyslog. The dedicated UFW
target must exist as `syslog:adm 0640`; otherwise rsyslog cannot recreate it
after dropping privileges and will amplify one missing file into a repeated
suspend/resume loop. Install `proofofwork-deploy-tmpfiles.conf` to keep deploy
scratch under its own three-day `/var/tmp/proofofwork-deploy` namespace rather
than deleting arbitrary `/tmp` content.

PostgreSQL recovery uses two independent layers. Bind
`/data/proofofwork-postgres-backups/physical` onto
`/var/backups/postgresql` with the tracked mount unit, then enable Ubuntu's
`pg_receivewal@16-main`, weekly `pg_basebackup@16-main.timer`, and daily
`pg_compresswal@16-main.timer`. Install `postgresql-backup.conf` as a cluster
configuration fragment and reload PostgreSQL so a failed physical-WAL receiver
can retain at most 16 GB in PostgreSQL's live `pg_wal` on the root filesystem.
Apply `deploy/proof-indexer-db-role-limits.sql` as PostgreSQL superuser and
restart the API and worker pools. It caps each `proof_indexer` backend at 1 GB
of temporary files and logs any temporary file of at least 256 MB, preventing a
single accidental sort from exhausting root while keeping large-spill evidence.
Full token-state and mint-stat reads select canonical mint winners and restore
their deterministic display order in the API process, instead of sorting the
wide event payload twice in PostgreSQL. Paginated mint history keeps its
database ordering and pagination contract.
That setting does not cap the received WAL archive on `/data`; successful base
backups, `pg_archivecleanup`, backup-age checks, and `/data` free-space checks
remain mandatory. Install `pg-basebackup-timer-override.conf` as
`/etc/systemd/system/pg_basebackup@16-main.timer.d/override.conf` so a missed
weekly run is started after the host returns. The tracked daily logical service publishes one atomic `dumpset`
directory containing the custom-format `proof_indexer` dump, a
`pg_dumpall --globals-only` role archive, and verified SHA-256 manifest. It
keeps 14 sets under `/data/proofofwork-postgres-backups/logical`; globals may
contain password hashes and must remain `postgres`-only and encrypted before
any off-host copy. Take the first physical and logical backups, restore the
latest logical dump into a disposable scratch database, validate representative
counts, and drop the scratch database before treating either timer as
operational. Restore globals before the database on a clean cluster. Enabling
PostgreSQL data checksums remains a separate maintenance operation because it
requires a clean database shutdown. Local physical and logical copies protect
against database/root-volume failures, but an encrypted off-host copy is still
required for independent disaster recovery.

Database credentials live in
`/etc/proofofwork-api/proof-indexer-db.env`, never inside the live Git checkout.

### Historical WORK marketplace V4 Phase-1 gate

The V4 rollout starts fail-closed. Production keeps
`WORK_MARKETPLACE_WRITES_ENABLED=0` and leaves the V4 declaration txid, height,
and block-hash pins unset until the declaration has been signed locally,
confirmed, and verified against Bitcoin Core. The declaration verifier requires
the exact memo, the exact first-input authority
`1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv`, and at least 546 proofs paid to
`1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV` before the protocol output. Activation is
the following block. Enabling writes later requires all three exact declaration
pins plus an explicit `WORK_MARKETPLACE_WRITES_ENABLED=1`; the API exposes
declaration, activation, and write status to the UI and never infers write
authority from a pending transaction.

Both first-party broadcast paths reject governed WORK `list5`, `seal5`, and
`buy5` transactions while the gate is closed. Once opened, they require one
canonical WORK protocol action, the correct token id, ticker, registry payment
and output order, the expected actor/listing/sale-ticket shape, a V4
authorization, a canonical signed quote within the 480-block window, and a
seller price that still meets the exact current-tip H-1 floor. `delist5`,
`send2`, and non-WORK marketplace actions are outside this V4 write pause.

Canonical replay discovers the exact confirmed declaration from registry
history and applies its `D + 1` cutover only when replay coverage reaches the
activation height, including blocks with no later registry transaction. V3
listings then project as non-reserving read-only relics; their tickets remain
recoverable, but seal and buy require a new V4 listing. Oracle evidence is
keyed by `txid:protocolVout`, because one transaction can carry multiple
protocol outputs. Read-model retention keeps at least the newest 512 distinct
canonical-summary heights and preserves every hash-bound quote and
confirmation-floor snapshot referenced by confirmed V3/V4 valid or invalid
market events. A snapshot cache or compacted listing row cannot replace that
evidence.

### Current WORK AMO V5 gate and canonical replay

WORK AMO Unit Protocol V2 is pinned to declaration txid
`54d7a367a3998ce1327ee89d983a25c80ce34b96d9811807df215a8694aead36`,
height `959620`, block transaction index `141`, and canonical block hash
`0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811`.
Its exact memo is output 3, the 546-proof WORK registry payment is output 4,
and the `pwt1` output is output 5. Input zero must spend exact authority
scriptPubKey
`76a91499b91dd27a616a71c0a1e9db6a86ceb8cff284c588ac`. Activation is
height `959621`.

Production pins those facts independently through:

```text
WORK_AMO_V5_DECLARATION_TXID
WORK_AMO_V5_DECLARATION_HEIGHT
WORK_AMO_V5_DECLARATION_BLOCK_HASH
WORK_AMO_V5_DECLARATION_BLOCK_INDEX
WORK_AMO_V5_DECLARATION_MEMO_SHA256
WORK_AMO_V5_WRITES_ENABLED
```

The V5 gate does not inherit `WORK_MARKETPLACE_WRITES_ENABLED`. It remains
closed unless the declaration evidence, current canonical block hash, explicit
positions, bounded replay readiness, current valid USD quote head, and the
V5-specific write switch all agree. A missing quote or partial block is normal
fail-closed state, never permission to substitute a web price.

The proof-index schema persists transaction `block_index`, event
`op_return_vout`, and event `record_ordinal`, and indexes confirmed actions by:

```text
(network, block_height, block_index, op_return_vout, record_ordinal)
```

Every V5 `record_ordinal` is explicit, including zero. Missing ordinals fail
closed in quote, listing, replay-key, ordering, and verifier-projection paths;
they are never defaulted during V5 validation.
Confirmed AMO state must not fall back to txid, timestamp, insertion order, or
event id. The indexer may fetch and decode transactions concurrently, but it
applies one fully verified block sequentially. For each ordered event it
computes and validates from state before the event, freezes the result, then
applies the event's bond. Invalid events mutate nothing. The transaction miner
fee is applied once after the final protocol record. A block projection is not
published until its hash, every relevant position, every transition, and its
resulting checkpoint have been verified.

The raw block evaluator enumerates every Core `pwm1`, `pwa1`, `pwid1`, `pwr1`,
and `pwt1` candidate before consulting any database projection. It owns one
claimed-vout set per transaction. A required reuse invalidates the later
record; PWM claim-all also fails when there is no candidate output or any
candidate was already claimed. PWA and WORK registry payments select the first
qualifying single output in vout order and never aggregate. PWID, PWR, and
non-WORK PWT registry-payment requirements use the shared deterministic
allocator: claim-all and constrained roles first, then larger requirements,
with the smallest sufficient single output or a largest-first deterministic
prefix. The allocator never funds or aggregates PWA, WORK-registry, or seller
settlement requirements. Seller settlement is the signed single-output
exception: one seller output must cover price plus the sale-ticket anchor,
while selected economic attribution and marketplace volume pin seller price
only. A transaction with
no valid canonical record has a zero transition and does not contribute its
miner fee.

Raw replay requires the exact 80-byte Core header and the complete
`getblock(hash, 2)` transaction array in its original order. Every transaction
retains exact serialized hex; parsing that hex must reproduce its txid, wtxid,
input outpoints or coinbase script, output scripts, and output values. The
array must begin with its sole coinbase. Governed candidate slots are merged
with independently hydrated prevout script/value evidence, including malformed
or fatal-UTF-8 candidates that legacy text decoding would miss. Addresses are
derived from scripts; optional RPC address labels and
status/hash/height/index/time metadata are ignored as authority. Canonical
block time comes only from the 80-byte header. The header must reproduce the
requested block hash and previous hash, and its Merkle root must equal the
unique ordered transaction ids.

The descriptor additionally binds `bip141Witness` under
`canonical-work-amo-raw-bip141-witness-v1`. For a witness-bearing block, replay
recomputes the witness Merkle root from exact wtxids with a zero coinbase leaf,
requires the exact 32-byte coinbase witness reserved value, and validates the
highest-index coinbase output matching the BIP141 witness-commitment pattern.
A legacy block containing neither witness data nor a commitment remains
admissible. The resulting
`canonical-work-amo-raw-full-block-descriptor-v1` commitment and full block
transaction count are persisted in each V2 transition and bound into the
opening transition-chain head. There is no post-activation partial-block or
event-feed fallback; missing or divergent witness evidence fails closed.
The exact closed-shape summary is stored at
`work_amo_block_transitions.payload.bip141Witness`, and its witness-transaction
count cannot exceed that row's `blockTransactionCount`. The migration
bootstrap repeats the final pair as `finalBip141Witness` and
`finalBlockTransactionCount`. Reader readiness requires the stored tip,
independent replay, and bootstrap marker to agree, and rejects missing or extra
fields, coerced values, a noncanonical script, a double-SHA256 mismatch, or an
impossible count.

The transition counters have disjoint meanings.
`rawProtocolCandidateCount` is the number of physical decoded Core OP_RETURN
candidates, so each PWM part counts. `protocolRecordCount` is the number of
logical raw records after every PWM part in one transaction is collapsed into
one aggregate record. `eventCount` is the number of persisted replay records:
logical raw records plus deterministic derived children. The event-set and
replay-descriptor commitments include both raw and derived records. Protocol
traces cover logical raw records, fee traces occur once per transaction, and a
derived record is explicitly `rawCandidate:false`, zero-delta, output-claim
free, and fee-free.

The published internal block-transition model is
`canonical-work-amo-full-position-block-sequencer-v2`. Its raw replay uses the
rolling `canonical-work-amo-raw-transition-chain-sha256-v1` model. The initial
chain head binds the block envelope and complete opening commitments; every
logical raw event advances it, the once-per-transaction fee transition
advances it after that transaction's final raw record, and a mandatory
block-close step advances it over the closing economic, generic-credit, PowID,
and WORK commitments. Raw replay descriptors and protocol/fee traces persist
the applicable per-step head, while the block transition persists the final
head and exact model. Full opening and closing state commitments remain
independently recomputed and compared; the rolling chain is additional
ordering evidence, not a substitute. Schema constraints retain pre-release V1
sequencer rows as immutable evidence, but readers, migration readiness, and
publishers accept only V2 with an exact transition-chain model and commitment.

`work_usd_quotes` stores the canonical `pwa1:usd1` sequence, predecessor,
positive `usdPer100mProofsQ8`, authority/payment evidence, and exact position.
Quote cardinality counts only records that fully pass the shared
`pwa1:usd1` parser. One valid quote beside an unrelated `pwa1` record or a
malformed `pwa1:usd1` record remains the one valid quote; each malformed or
unrelated record is still preserved as an invalid zero-contribution event.
Two fully valid quote records in one transaction invalidate the quote. The
quote consumes the first qualifying single distinct registry payment in vout
order, never an aggregate, and that output cannot also fund another protocol
record.
`work_amo_listing_terms` stores the immutable confirmation-derived terms for
each valid V5 listing. A seal or buy reads that projection by listing id and
must reproduce or reference it exactly; current network value and current
quote are not consulted to reprice the listing.

The declaration/activation gate and quote gate are deliberately different.
Declaration pins, canonical replay, and the V5 write switch govern the
protocol. A fresh canonical quote is additionally required to create a new
listing. It is not required to seal or buy a listing that already confirmed
with valid frozen terms.

AMO readiness reads are coalesced only when network, confirmed Core tip height,
and confirmed Core tip hash are identical. The replay reader constrains its
seed and closing rows to canonical-summary snapshots so PostgreSQL can use the
summary partial index without changing any consensus check. At most two
proven-positive replay results are retained by exact network, height, and hash,
so Token, Marketplace, and Wallet summary shapes do not repeat the same
immutable transition audit. A negative replay result is never retained because
the index can become ready at the same tip. A proven-positive V5 status may
also be reused after the ordinary 15-second cache window only while a fresh
Core read reports that same tip height and hash and the caller supplies the
same exact pre-event network-value Q8. Negative status expires normally.
Forced broadcast admission bypasses status reuse, settled replay reuse, and
replay-read singleflight, so every governed write performs a fresh fail-closed
check.

AMO V5 also applies one closed, exact relational projection for pre-unit
listing
`4e9cedced2252cd183608dc9176415a913c4f6aa5e8307a732179a2240b6feb1`.
The projection is permitted only by
`canonical-work-amo-v5-pre-unit-relic-v1` evidence: singleton confirmed valid
event and raw record, exact height `959241`, block transaction index `2601`,
protocol output `1`, ordinal `0`, canonical block hash
`000000000000000000007933e0dc73604a52057ba18de7b9463b65d9433dd0fe`,
exact payload/authorization/data/fee/registry/ticket facts, one exact V1
declaration, and the exact V5 declaration including block time
`2026-07-26T00:17:29.000Z`. The sale-ticket authority is output `2`; only its
one canonical spend is terminal. A matching valid close may corroborate that
spend, but a close without the spend, a pending or noncanonical spend, a stale
`spent_by_txid` pointer, duplicate evidence, or any mismatch withholds the
relic. An invalid event or a spend of output `3` is irrelevant.

The original row stays in raw audit storage. Public state always removes its
reservation after the activation boundary, adds the closed relic only when the
exact proof is complete and unspent, and never synthesizes an invalid event.
Relational `closedListings` and `market-log` transform the exact row before
metadata count, canonical ordering, and SQL pagination. `listings` always
excludes it. Exact queries for either the listing txid or V5 declaration txid
are authoritative: they return the one projected close where applicable, or a
terminal empty page when the proof is withheld, and cannot fall back to an
older embedded snapshot.

`work_amo_block_transitions` stores every immutable activation-through-tip
opening and closing sufficient state, event-set commitment, replay descriptor,
trace, full canonical `closingTokenState` preimage, canonical generic-credit
projection, and canonical PowID projection. The closing WORK, generic-credit,
and PowID preimages must reproduce their respective commitments in the closing
sufficient state. Height 959620 supplies the sole legacy H-1 bootstrap. Every
block from 959621 onward opens from the preceding canonical raw transition,
including all three state commitments and the economic accumulator.
Historical transitions are never tested against unscoped current balance or
listing tables. Only publication of the current tip may require current
relational parity.

During original capture, the H-1 producer reused the eligible exact
height/hash-bound canonical summary to construct one immutable seed-evidence
row. After capture and migration, runtime readiness consumes that evidence row
directly: it recomputes the evidence envelope and preimage commitments, checks
exact ledger metadata and canonical H-1 block binding, and binds the historical
summary id/hash/network-value Q8 to the completed migration seed, bootstrap
commitment, and first activation opening state. It neither requires nor
fabricates the replaceable historical summary row. Duplicate, tampered,
noncanonical, or marker-divergent evidence fails closed.

One historical invalid WORK listing is already embedded in that immutable
bootstrap basis and is reconciled without rewriting it. Its complete evidence
uses model `canonical-work-amo-v5-legacy-bootstrap-carry-v1` and txid
`5eb0a876603a7551653806b932533dc27a884631a581caa2e36dcf129b8278e8`,
height `959311`, block transaction index `2552`, protocol output `1`, ordinal
`0`, canonical block hash
`000000000000000000005a63a2c00834b92746ab0658c9f0c98aeb509724e8f9`,
and invalid reason `work-market-v4-version-required`. The proof-index reader
must find exactly one matching confirmed invalid event joined to its canonical
transaction and block, prove the 546-proof mutation payment, the 2,216-proof
transaction miner fee, and no active listing reservation, and reject every
field or cardinality mismatch. It must not infer these facts from summary
deltas.

The event contributes zero valid marketplace activity and zero current event
or miner-fee flow. Its values survive only as the following opaque
legacy-bootstrap reconciliation:

```text
legacyBootstrapMarketplaceCarrySats = 546
legacyBootstrapSats = 2730
legacyBootstrapGrowthValueQ8 = 273000000000
legacyBootstrapCreditFixedSats = 2762
legacyBootstrapCreditFixedQ8 = 276200000000
```

Here, `2730 = 546 * 5` is the exact legacy Growth component and
`2762 = 546 + 2216` is the exact fixed-flow residual. The raw committed
transition N, base-state preimage, frozen values, Q8 commitments, and chart
history stay unchanged. Summary projection publishes valid-only marketplace
aliases with the 546 proofs removed, preserves the committed base vector as
explicit evidence, and exposes the exact `workAmoV5LegacyBootstrap` proof.
Credit frozen-value consistency must prove:

```text
committedCreditFixedQ8
  = validCreditFixedFlowSats * 100000000
  + legacyBootstrapCreditFixedQ8
```

The corresponding Growth comparison must prove the valid base value plus
`legacyBootstrapGrowthValueQ8` equals the committed base value. Missing or
divergent evidence makes the current summary unavailable; no last-good row may
be relabeled as a fresh reconciliation. A retroactive height-959620 reseed
would change protocol history and requires a new on-chain protocol version.

The activation transition also stores the exact replayable H-1 seed under
`seedSufficientState`, `seedSufficientStateCommitment`,
`seedGenericTokenState`, `seedIdState`, `seedTokenState`, and
`seedWorkProjection`. Their economic, generic-credit, PowID, and WORK
commitments must equal the transition opening state. A persisted activation
transition is replay evidence, never its own bootstrap authority. Every
supervised activation replay first derives the independent, block-hash-pinned
H-1 economic, generic-credit, PowID, and WORK preimages and then requires any
stored seed to match those preimages and commitments exactly. If the
independent H-1 sources are unavailable, replay fails closed; it never
reconstructs the seed from current-tip tables or legacy bond-activity
heuristics.
The separately captured immutable H-1 evidence row is bootstrap authority; the
persisted activation transition is corroborating replay evidence only.
Generic-credit definition, balance, listing-amount, and listing-price fields in
that seed are canonical decimal strings. A supervised first bootstrap may use
the H-1 repeatable-read SQL preimage, where every `numeric`/`bigint` field is
selected as text. A pinned legacy H-1 JSON snapshot is admissible only when
every nonbond JSON number is a safe integer bounded by its exact max supply and
every POWB/INCB amount is already a decimal string; supplies and commitments
are recomputed. An unsafe number, a current-tip row presented as H-1, or a
preimage/commitment mismatch aborts replay.

The supervised migration stops writers, takes a database backup, applies the
idempotent schema, and independently audits V1 history beginning at height
959306. The exact V5 sufficient-state seed is the end of declaration block
959620, hash
`0000000000000000000094195957f498f894c92f5d5f75ff5b9c9afc749a6811`.
V5 block-transition replay begins at 959621 and continues without a height
clamp through the exact Core tip height and hash under lock. It preserves all
raw rows. Pre-unit V3 listings become non-reserving relics; a V3 action that
was already invalid at its confirmation stays invalid audit history. Valid
pre-959621 V4 terms remain frozen and may be referenced by V5 seal/buy; V4
actions at or after activation are invalid. Failure of any pinned fact,
position, conservation check, quote chain, listing projection, or end-tip
parity aborts without enabling writes.
Dry-run executes the same guarded legacy mutations, exact full-block replay,
row-count checks, and readiness audit inside the same serializable transaction
as apply mode, then rolls the transaction back and returns `applied:false`.
Apply mode follows that identical path and commits only after every check
passes. Dry-run is therefore a transactional deployment simulation, not an
audit of the unmodified pre-migration rows.
The read-only migration preflight may report `replay-required`. Apply mode may
write only a `complete` marker: an incomplete replay throws inside the
serializable transaction, rolls back every provisional legacy-row change, and
writes neither a marker nor a partial derived-snapshot deletion.

Before an activation replay is published, canonical rebuild clears stale
derived ID, credit, listing, quote, mail, attachment, and AMO transition
projections while retaining raw chain evidence. Each newly prepared protocol
item then binds one-to-one to the transition replay record with the same block
height, transaction index, protocol vout, and ordinal, plus matching txid and
protocol. Raw replay records occupy their Core-derived ordinal. Deterministic
children occupy later collision-free projection ordinals and bind their
`derivedId`, container/materialization position, zero delta, and no-claim/no-fee
flags. Any string tie-breaker used to canonicalize a committed set compares
normalized unsigned UTF-8 bytes. Locale-sensitive comparison is forbidden and
cannot replace the four-integer confirmed position. The replay record
overwrites validity, exact reason, canonical output,
and frozen terms before persistence. Every raw or derived replay record and
every prepared item must be consumed exactly once. Invalid raw outcomes are
stored as audit rows but emit no derived children and skip every derived
projection mutation; any mismatch aborts the whole block.

PowID normalization preserves the confirmed H-1 registry identity and uses
ECMAScript Unicode Default Case Conversion with Unicode 17.0 tables. The
production Node.js 24.18.0 runtime reports Unicode 17.0. API, indexer, raw
replay, and migration paths assert that version and fail closed before
publishing state when it differs. A runtime upgrade requires a full-registry
normalization replay proving identical normalized IDs and first-claim winners,
or an explicit protocol migration. Fresh AMO V5 base64url text fields are
canonical base64url plus strict UTF-8; malformed byte sequences invalidate the
record and must never be decoded through replacement characters.

A transaction with multiple `pwm1` outputs produces one logical aggregate
record at the first `pwm1` output, ordinal zero. Its canonical raw witness is
the ordered list of every participating Core OP_RETURN part, each binding the
exact `protocolVout`, lowercase even-length `scriptPubKeyHex` beginning with
`6a`, and decoded text. Synthetic bond-mint projections use later ordinals and
bind a deterministic derived-child witness plus their parent `derivedId` and
recipient/output derivation; they never consume the raw parts a second time.
Ordinary payment outputs may appear between PWM parts. Another governed
`pwa1`, `pwid1`, `pwr1`, or `pwt1` candidate strictly between the first and
last PWM part makes the single PWM aggregate invalid and zero-delta with
reason `work-amo-v5-raw-pwm-envelope-noncontiguous`; those intervening
governed records still evaluate at their own canonical positions.

INCB attachment state is position-local. PWM applies direct issuance at its
position. When a recipient-matched WORK `send2` appears later in the same
transaction, only a canonical-valid send applies the H-1-valued attachment
top-up at that later position; an invalid send applies zero. State between the
two positions contains direct issuance only, and later state contains the
top-up only after acceptance. A valid earlier send is already part of state
before a later PWM record. The derived INCB companion is bound to the accepted
parent/send outcome and has no second output claim, miner fee, or economic
contribution.

### Confirmed WORK AMO V6 proof-native gate (production writes fail closed)

The V6 release replaces USD-denominated WORK faces with fixed proof-native
faces of 20,000, 50,000 and 100,000 proofs. No V6 consensus path reads a USD
price, exchange source, operator quote, signing key or time-limited
attestation. USD equivalents are optional UI display values only. This is a
confirmed, fail-closed upgrade: declaration transaction
`975fd82aa84995e014b240618ee1a1254d0a735e6e1241372d0bed0a0d9f0799`
sets protocol activation height `960219`, but deployment or protocol height
alone cannot open production admission.

Production configuration has exact declaration pins and one independent write
gate:

```text
WORK_AMO_V6_DECLARATION_TXID
WORK_AMO_V6_DECLARATION_HEIGHT
WORK_AMO_V6_DECLARATION_BLOCK_HASH
WORK_AMO_V6_DECLARATION_BLOCK_INDEX
WORK_AMO_V6_DECLARATION_MEMO_SHA256
WORK_AMO_V6_DECLARATION_MEMO_BYTES
WORK_AMO_V6_DECLARATION_PROTOCOL_VOUT
WORK_AMO_V6_DECLARATION_RECORD_ORDINAL
WORK_AMO_V6_DECLARATION_REGISTRY_PAYMENT_VOUT
WORK_AMO_V6_WRITES_ENABLED
```

Every declaration pin starts empty and the write gate starts at `0`. V5 remains
independently disabled for new production writes; an old V4 or V5 switch cannot
authorize V6. The old unactivated oracle credential is not a V6 dependency and
must not remain in the tracked systemd override.

The confirmed production declaration pins are:

```text
WORK_AMO_V6_DECLARATION_TXID=975fd82aa84995e014b240618ee1a1254d0a735e6e1241372d0bed0a0d9f0799
WORK_AMO_V6_DECLARATION_HEIGHT=960218
WORK_AMO_V6_DECLARATION_BLOCK_HASH=00000000000000000001ac35a5b7e43c782297fcb9cde0fb458fbd5451ad55df
WORK_AMO_V6_DECLARATION_BLOCK_INDEX=102
WORK_AMO_V6_DECLARATION_MEMO_SHA256=b43daeea38fcacaf6afa6a48d3d0fde631497a4af9f3bb137fc07975d18bbe01
WORK_AMO_V6_DECLARATION_MEMO_BYTES=3350
WORK_AMO_V6_DECLARATION_PROTOCOL_VOUT=3
WORK_AMO_V6_DECLARATION_RECORD_ORDINAL=0
WORK_AMO_V6_DECLARATION_REGISTRY_PAYMENT_VOUT=4
WORK_AMO_V6_ACTIVATION_HEIGHT=960219
```

Core confirmed that declaration in block
`00000000000000000001ac35a5b7e43c782297fcb9cde0fb458fbd5451ad55df`
at height `960218` and zero-based transaction index `102`. These immutable
coordinates do not themselves open production writes: the marker, replay,
parity, exact-tip health and separate `WORK_AMO_V6_WRITES_ENABLED=1` gate
remain mandatory.

The listing itself remains ordered by:

```text
(blockHeight, blockTransactionIndex, protocolVout, recordOrdinal)
```

For `F=unitFaceProofs`, total network value `N=Nbefore`, total supply
`S=21000000`, atom scale `A=100000000`, and Q8 scale `Q=100000000`, the
evaluator computes:

```text
unitPriceProofs = F
unitAmountAtoms = floor(F*S*A*Q/N)
unitMinimumPriceProofs = ceil(unitAmountAtoms*N/(S*A*Q))
```

It freezes those terms and then applies the listing's own bond. Intervening
valid bonds and earlier ordered events can therefore change each later
listing's exact WORK amount even when the chosen proof face is the same.
Reverse fetch order or database arrival order must reproduce the same
transition.

V6 activation changes new listing admission only. A valid V4 or V5 listing
confirmed before activation keeps its frozen terms and may settle unchanged.
After activation, new V4/V5 listings are invalid audit history. V1/V3 relics
and all old quote rows remain immutable replay evidence. Seal and buy use
confirmation-frozen listing terms and never recheck current network value or
any USD display. A coherent signed V6 seal is one-way: subsequent seal attempts
are invalid audit history and cannot overwrite the first seal identity.

The canonical WORK token-state preimage used at block open, block close,
transition verification, relational parity and current-state migration audits
must accept V6 listings only through the strict V6 authorization and
frozen-term validators. That V6-aware path must reproduce historical V4/V5
preimages and commitments byte-for-byte; unsupported or tampered listing
versions fail closed.

V6 signed intents intentionally omit amount and price. The generic raw decoder
may therefore carry local zero placeholders, but those placeholders are never
persistable terms. After the block verifier binds the exact txid, protocol and
full canonical position to a valid replay outcome, the indexer materializes
the V6 list/seal/buy/delist projection only from the replay output's canonical
nested listing or closed listing. It validates the nested authorization and
frozen terms, requires the atom amount and proof price to equal those terms,
and then writes the exact top-level atomic and human aliases. Pairing consumes
the raw placeholder only when lifecycle kind, action txid, `pwt1` protocol,
complete action position, listing identity, actor and validated V6
authorization identity all match the canonical verifier item. An invalid
replay remains invalid audit history; an unmatched raw record or divergent
valid projection aborts the atomic block instead of creating two items at one
position.

The V6 closing WORK read projection derives the active listing's original
confirmed tuple from its immutable frozen terms and formats the human amount
from atoms. A later seal adds separate seal-position fields without replacing
the listing tuple. Buy and delist projections likewise retain the listing tuple
and publish their action tuple separately. This verifier-only enrichment is
V6-scoped so already-persisted V4/V5 transition payloads and canonical bytes
remain unchanged.

#### Public V6 read projection is independent of write admission

The public current-table and history readers activate V6 only when the exact
configured declaration pins rejoin the confirmed canonical declaration
transaction, block and raw OP_RETURN carrier, and the singleton completed
`workAmoV6Migration:livenet` marker binds the same declaration evidence and V6
models. The read decision is made for the requested snapshot: a snapshot
before height `960219` keeps its historical policy, while a current or later
snapshot requires the exact V6 readiness proof. Missing, duplicate, tampered
or noncanonical evidence leaves the reader on the preceding V5-era version
policy. It must not infer V6 readiness from activation height, deployment
configuration or a marker independently.

After exact read readiness, the public allowed set is V6 plus canonical valid
confirmed grandfathered V4/V5 listings with frozen settlement rights. A V4
listing confirmed at or after height `959621`, a V5 listing confirmed at or
after height `960219`, an unknown version or a mixed-version row is excluded
from active state and remains audit evidence only. `/api/v1/token`, listings
history, Credit, Wallet and AMO projections must apply the same version policy
rather than maintaining independent V5-only filters.

Relational projection remains evidence-bound. A V6 `credit_listings` row can
be public only when exactly one valid confirmed listing event joins its
confirmed transaction and canonical block at the identical full protocol
position. A sealed row also needs exactly one valid confirmed seal event bound
to the same listing and authorization version at its own identical full
position. Missing, duplicate or mismatched listing/seal evidence fails closed;
stored lifecycle state or payload booleans cannot manufacture confirmation.

For a historical V6 or other pre-V8 Q8 WORK row,
`credit_listings.amount` and the immutable
`work_amo_v6_listing_terms.amount_atoms` are atom counts. Before V8 activation,
readers must interpret the shared value as atoms even if token metadata is
absent or legacy-shaped, emit that integer as `amountAtoms`, and format the
public eight-decimal WORK amount from it. Thus a stored value of `10` projects
as `0.0000001 WORK`. At V8 activation, current shared listing projections
convert to Q16 subatoms; the immutable V6 terms table and raw historical
records retain their original Q8 scale.

`WORK_AMO_V6_WRITES_ENABLED`, exact-tip action admission and the V4/V5 write
switches do not select public read versions. Disabling writes must leave
already-confirmed canonical V6 listings and valid grandfathered frozen rights
readable, subject to the ordinary canonical-index freshness rules. This
separation permits an operator to close new actions without rewriting or
hiding confirmed protocol history.

The safe rollout order is:

1. Prove through Core and the canonical index that no earlier V6 declaration,
   migration marker or accepted `pwt-sale-v6` listing exists. Reusing the
   version is forbidden if any such canonical history exists.
2. Back up PostgreSQL and the current release. Replace the empty unactivated
   oracle-shaped V6 schema only through its guarded zero-row/null-marker path.
3. Deploy code/schema with V6 writes off and V5 writes still off.
4. Produce the exact proof-native declaration text. The user signs
   and publishes it locally.
5. After confirmation, pin every declaration field and re-prove it from Core,
   but leave writes off until the declaration is at least six confirmations
   deep.
6. At that safety depth, apply the exact declaration/index migration marker
   from the confirmed pre-activation declaration evidence. Only after that
   immutable marker verifies, run activation-through-tip replay and require
   exact relational, transition and listing-term parity;
   post-activation replay intentionally fails closed before the marker exists.
7. Enable writes only after exact-tip health, replay parity, public truth
   checks and marketplace regressions pass.

Publish the exact declaration body emitted on standard output by
`scripts/build-work-amo-v6-declaration.mjs`; do not add a leading or trailing
newline. Computer supplies the `pwm1:m:` record wrapper. Declaration evidence
pins that exact raw carrier output and its within-output record ordinal. It
does not substitute the canonical mailbox aggregate position: `pwm1:s`
subject and `pwm1:r` reply parts may aggregate as mail at another output
position without changing the declaration carrier. Independently valid sibling
governed records, including a `pwt1:send2` WORK transfer, likewise do not
invalidate the declaration; they remain separately ordered and validated by
their own protocols. The transaction must still have the declared authority
scriptPubKey at input zero and a distinct output paying at least 546 proofs to
`1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV`. After confirmation, inspect the raw
transaction through Core and record the transaction id, block
height/hash, block transaction index, declaration carrier output index and
record ordinal, registry-payment output index, exact wrapped-record byte
length, and SHA-256. The configured pins and indexed raw-carrier evidence must
match all of those facts before migration can proceed.

The post-confirmation migration is an operator-supervised maintenance event.
Create a root-owned `0600` public activation file containing the exact
declaration pins listed above plus `WORK_AMO_V6_ACTIVATION_HEIGHT=D+1`. Let
systemd load the root-only database, Core RPC, internal-verifier, and public
activation files while Node still runs as `powadmin`. Stop the ordinary index
worker before applying pins or the immutable marker. First run
`npm run migrate:work-amo-v6` with
`WORK_AMO_V6_MIGRATION_APPLY=0`, inspect the complete Core/index evidence and
`ready-to-apply` result, then rerun with
`WORK_AMO_V6_MIGRATION_APPLY=1`. Repeating the apply must return the same
immutable marker; any conflicting marker, constraint, or evidence is a hard
stop.

Replay only the activation range after the marker is installed. Use the exact
committed release with:

```text
NETWORK=livenet
POW_API_BASE=http://127.0.0.1:8081
POW_INDEX_BACKFILL_SOURCES=block-scan
POW_INDEX_BACKFILL_BLOCK_SCAN_FROM_HEIGHT=D+1
POW_INDEX_BACKFILL_STORE_LEDGER_SNAPSHOT=0
POW_INDEX_BACKFILL_STORE_CANONICAL_SUMMARY_SNAPSHOT=0
POW_INDEX_BACKFILL_CANONICAL_REBUILD=0
```

Set the supervised block and transaction caps high enough to cover `D+1`
through the current Core tip, then run `npm run indexer:backfill`. Do not use
canonical rebuild: a rebuild beginning at `D+1` would delete earlier global
projections. Require exact transition, frozen-term and relational parity
through the same current tip before restarting the ordinary worker. Verify API
truth checks and marketplace regressions, then enable
`WORK_AMO_V6_WRITES_ENABLED=1` and deploy every public UI surface from the same
commit-bound archive. A failure at any stage leaves new V6 listings closed
while historical frozen settlements remain available.

Before opening the V6 write gate, record all of these checks from the same
canonical tip and release:

- the immutable seed/dependency trigger and the partial unique evidence index
  are installed;
- exactly one valid same-model livenet H-1 evidence row passes with its bound
  full canonical-summary row absent;
- the evidence envelope, canonical H-1 block, completed marker, bootstrap seed
  commitment, and first persisted activation opening state agree exactly;
- every snapshot-deletion path passes the dependency-protection regression;
- the V6 migration marker, activation-through-tip transition chain, exact-tip
  closing summary, and relational listing terms pass parity;
- API and worker both load the exact pins and
  `WORK_AMO_V6_WRITES_ENABLED=1`, while V4/V5 write gates remain disabled; and
- Wallet and AMO public listing preflights expose only the 20,000, 50,000, and
  100,000-proof V6 faces from the commit-bound UI release.

### Historical unactivated WORK Q16 / AMO V7 gate

V7 never acquired canonical declaration evidence and never activated. Keep
this complete section as the historical staging proposal, with every V7 pin
empty and `WORK_AMO_V7_WRITES_ENABLED=0`; V8 supersedes it. Nothing in this
section can serve as current declaration, migration, or write authority.

WORK Precision Protocol V2 and AMO Unit Protocol V7 form one activation
boundary. The code and additive schema may be deployed before the declaration,
but the deploy must preserve current V6/send2 behavior until exact V7
declaration evidence confirms and reaches its following-block activation
height. Merely shipping Q16 constants cannot change live state.

The staged configuration surface is:

```text
WORK_AMO_V7_DECLARATION_TXID
WORK_AMO_V7_DECLARATION_HEIGHT
WORK_AMO_V7_DECLARATION_BLOCK_HASH
WORK_AMO_V7_DECLARATION_BLOCK_INDEX
WORK_AMO_V7_DECLARATION_MEMO_SHA256
WORK_AMO_V7_DECLARATION_MEMO_BYTES
WORK_AMO_V7_DECLARATION_PROTOCOL_VOUT
WORK_AMO_V7_DECLARATION_RECORD_ORDINAL
WORK_AMO_V7_DECLARATION_REGISTRY_PAYMENT_VOUT
WORK_AMO_V7_ACTIVATION_HEIGHT
WORK_AMO_V7_WRITES_ENABLED
```

Before any exact V7 declaration confirms, unconfigured pins and
`WORK_AMO_V7_WRITES_ENABLED=0` are the safe staging state: V7 status reports
not ready, `send3`/`pwt-sale-v7` preparation is rejected, and V6 remains
available under its own independent evidence and gate. The official API also
auto-discovers the exact confirmed declaration from canonical Core evidence.
As soon as that evidence establishes `D`, it closes new V6 listing and
`send2` admission before those writes can confirm at `D+1`. Once the canonical
`D+1` boundary is observed or persistently latched, clearing, omitting, or
malforming operator pins can only pause governed writes and never re-enable a
legacy write path. Record the discovered exact evidence and
`WORK_AMO_V7_ACTIVATION_HEIGHT=D+1`; never derive activation from wall-clock
time, mempool visibility, or a user-supplied height.

The precision boundary uses:

```text
globalModel=canonical-work-subatoms-v2
storageModel=work-subatoms-v2
decimals=16
unitScale=10000000000000000
legacyMultiplier=100000000
transferOpcode=pwt1:send3
amoAuthorization=pwt-sale-v7
```

At the opening of `D+1`, the migration converts every confirmed canonical Q8
WORK amount to Q16 with exact integer multiplication by `100000000`. This
includes definition max/mint amounts, confirmed supply, holder balances,
reservations, and normalized active-listing amounts. Raw confirmed payload
bytes, original frozen terms, pre-activation canonical state commitments, and
pre-activation closed snapshot commitments stay immutable; provisional or
wrong-era derived projections at `D+1` or later are invalidated and
deterministically replayed from canonical raw evidence. Volatile pending WORK
event, listing/action, and balance-delta projections are purged while
noncanonical transaction envelopes remain raw recovery input; current pending
projections are then rebuilt from one stable Core mempool under active V7
rules with exact membership, semantic, transaction, and balance parity.
Existing V4/V5/V6 listings retain
their frozen proof price and use `legacyAmountAtoms * 100000000` only as their
Q16 reservation/settlement amount.

The raw mint record remains
`pwt1:mint:<canonical-work-token-id>:1000`. It credits exactly
`100000000000` Q8 atoms before activation and
`10000000000000000000` Q16 subatoms from activation. Every other raw WORK
mint amount is invalid and no historical mint bytes are rewritten.

V7 listing projections serialize the existing exact integer field names:

```text
unitPriceSats = F
unitAmountSubatoms = floor(F*S*A*Q/N)
unitMinimumPriceSats = ceil(unitAmountSubatoms*N/(S*A*Q))
```

Here `S=21000000`, `A=10000000000000000`, `Q=100000000`, and `N` is the
canonical Q8 network value immediately before the listing. The two `*Sats`
fields are denominated in proofs; “proofs” is display language, not an
alternate serialized `unitPriceProofs` or `unitMinimumPriceProofs` field.

The migration command is idempotent and defaults to read-only. Before apply it
must prove:

- the configured declaration carrier and authority/payment evidence exactly
  match the generated declaration commitment;
- the canonical block at `D` and activation block at `D+1` are present;
- no conflicting V7 declaration or completed migration marker exists;
- the pre-activation Q8 definition, supply, balances, reservations, pending
  deltas, and active listings reconcile;
- every converted integer is exactly divisible by `100000000`;
- converted supply equals the sum of converted balances and never exceeds
  `210000000000000000000000` subatoms;
- all pre-activation canonical transition/snapshot commitments recompute
  unchanged, while provisional or wrong-era `D+1` and later derived
  projections are invalidated for deterministic replay; and
- the installed SQL constraint expressions admit the Q16 maximum and reject
  noncanonical precision state.

The apply writes one immutable `workPrecisionV2Migration:livenet` marker bound
to the declaration pins, activation height/opening block, Q8-before and
Q16-after commitments, and the deterministic row counts and conservation
values implicit in those committed states. The current marker does not claim
a release commit SHA or separate uncommitted totals. A repeated apply must
return the identical marker and perform no mutation. A marker-shaped object,
a constraint name without its expected definition, or converted rows without
the marker cannot authorize reads or writes.

Deployment sequence:

1. Build and test the exact release with V7 pins empty and the V7 gate off.
2. Apply only additive schema/readiness support. Verify V6/send2 still works
   and all current production routes remain exact-tip green.
3. Generate the exact declaration with
   `npm run build:work-amo-v7-declaration`; publish the declaration text
   through the local wallet only. The builder's final presentation newline is
   outside `declaration.text`, its byte count, and both declaration hashes.
4. After confirmation depth meets policy, record every declaration pin and
   `D+1`, leaving V7 writes off.
5. Take and verify a database backup. Run
   `npm run migrate:work-precision-v2` in read-only mode, inspect all Core,
   index, conservation, constraint-definition, and replay evidence, then run
   the explicitly enabled apply mode.
6. Rebuild through the exact tip and prove API/worker/ledger/database parity,
   legacy V6 frozen-listing preservation, one-subatom round trips, `send3`
   admission, and V7 peak canonical ordering.
7. Enable only `WORK_AMO_V7_WRITES_ENABLED=1`; V4/V5/V6 new-listing gates stay
   closed after activation. Deploy every public UI from the same commit-bound
   archive and repeat the exact-tip production sweep.

Any disagreement leaves V7 closed. Rollback before activation removes only
the staged code/config because canonical state is still Q8. After the first
canonical V7/send3 action, rollback means closing writes and restoring the
same release from backup/replay; it never means reverting the declaration,
dividing live balances heuristically, or rewriting confirmed history.

### Approved WORK Q16 / AMO V8 gate

WORK Precision Protocol V2 and AMO Unit Protocol V8 share one exact activation
boundary. The release is additive and may be deployed before a declaration,
but the production preactivation state must be empty and inert:

```text
WORK_AMO_V7_DECLARATION_TXID=
WORK_AMO_V7_DECLARATION_HEIGHT=
WORK_AMO_V7_DECLARATION_BLOCK_HASH=
WORK_AMO_V7_DECLARATION_BLOCK_INDEX=
WORK_AMO_V7_DECLARATION_MEMO_SHA256=
WORK_AMO_V7_DECLARATION_MEMO_BYTES=
WORK_AMO_V7_DECLARATION_PROTOCOL_VOUT=
WORK_AMO_V7_DECLARATION_RECORD_ORDINAL=
WORK_AMO_V7_DECLARATION_REGISTRY_PAYMENT_VOUT=
WORK_AMO_V7_ACTIVATION_HEIGHT=
WORK_AMO_V7_WRITES_ENABLED=0

WORK_AMO_V8_DECLARATION_TXID=
WORK_AMO_V8_DECLARATION_HEIGHT=
WORK_AMO_V8_DECLARATION_BLOCK_HASH=
WORK_AMO_V8_DECLARATION_BLOCK_INDEX=
WORK_AMO_V8_DECLARATION_MEMO_SHA256=
WORK_AMO_V8_DECLARATION_MEMO_BYTES=
WORK_AMO_V8_DECLARATION_PROTOCOL_VOUT=
WORK_AMO_V8_DECLARATION_RECORD_ORDINAL=
WORK_AMO_V8_DECLARATION_REGISTRY_PAYMENT_VOUT=
WORK_AMO_V8_ACTIVATION_HEIGHT=
WORK_AMO_V8_WRITES_ENABLED=0
```

In this state the API and worker report V8 not ready, reject `send3` and
`pwt-sale-v8` preparation, and preserve Q8/V6 as the current protocol. A
partial V8 pin set is invalid, not a progressive configuration. Deploying
Q16 constants, tables, builders, or UI code alone cannot change canonical
precision, close legacy listings, or authorize V8.

Generate the exact declaration with:

```text
npm run build:work-amo-v8-declaration
```

The declaration selection rule chooses the earliest exact valid declaration
by confirmed block height and transaction index. The transaction must be
canonical; input zero must spend the declared authority scriptPubKey; the
pinned registry output must pay at least the declared minimum to the declared
registry; and the pinned protocol output and record ordinal must carry the
exact generated declaration bytes. Carrier and payment candidates must each
be unambiguous. A later duplicate cannot move activation. The builder's final
presentation newline is outside `declaration.text`, its byte count, and both
hashes.

The declaration confirmed at height `960600`, zero-based transaction index
`2369`, in block
`00000000000000000001ec938998cde4fd86ee6e3c672a6d3d95200cd8a984ac`.
Its exact full `pwm1:m` carrier is vout `3`, record ordinal `0`, `5593` bytes,
SHA-256
`1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528`;
the unique qualifying registry payment is vout `4`, and activation is height
`960601`. Verify that physical carrier output directly. The Mail envelope also
contains subject and reply parts and may aggregate at vout `1` for mailbox
projection, but that aggregate is not declaration-carrier evidence.

If the exact declaration confirms in block `D`, record all V8 pins together
and set `WORK_AMO_V8_ACTIVATION_HEIGHT=D+1`. Activation is the opening of the
first confirmed block after `D`; never derive it from time, mempool presence,
client input, or a later operator choice. Canonical discovery closes V6
listing and `send2` admission as soon as `D` is known so a legacy write cannot
cross into `D+1`. A persistent `workAmoV8ActivationLatch:livenet` binds the
observed boundary. Once observed or latched, missing or malformed pins can
only pause V8 and cannot restore Q8, V6 admission, `send2`, or legacy AMO
settlement.

The active precision surface is:

```text
globalModel=canonical-work-subatoms-v2
migrationModel=canonical-work-q8-to-q16-migration-v1
storageModel=work-subatoms-v2
tokenStateModel=canonical-work-token-state-subatoms-v3
relicCutoverModel=canonical-work-amo-v8-preactivation-relic-cutover-v1
decimals=16
unitScale=10000000000000000
legacyMultiplier=100000000
transferOpcode=pwt1:send3
amoAuthorization=pwt-sale-v8
allowedFaceProofs=25000
```

At the opening of `D+1`, exact integer multiplication by `100000000` converts
the current Q8 maximum supply, mint increment, confirmed supply, and every
holder balance to Q16. Converted supply must equal the sum of converted
balances, remain within `210000000000000000000000` subatoms, and preserve each
owner's exact human WORK value. The conversion never uses floating point,
scale guessing, or a rounded decimal field. Raw confirmed bytes, historical
Q8 terms, and preactivation canonical commitments remain unchanged.

Activation does not carry legacy reservations forward. The declaration-height
closing token state is read in exact canonical order and every confirmed WORK
listing in `active` or `sealing` state is sorted into the immutable
`canonical-work-amo-v8-preactivation-relic-cutover-v1` set. The Q16 opening
state has an empty active-listing set. Migration updates each committed row to
non-actionable relic history, releases its reservation, binds its disable
height and declaration txid, and requires `refundEligible=true`. It must leave
zero pre-V8 `active` or `sealing` rows. Official preparation and broadcast
admission expose no legacy seal, buy, or delist path; only a confirmed V8
listing can settle. Raw ticket spends remain observable history and cannot
resurrect a relic.

The relational table can still contain stale `active`/`sealing` status labels
for V1/V2 rows already excluded at the height-959061 canonical cutover. Those
rows are not added to the V8 relic or refund commitments. Migration may close
only the derived status after proving the historical authorization is exactly
`pwt-sale-v1` or `pwt-sale-v2`; it preserves the row payload, raw event, and
original refund snapshot. Any other extra active authorization fails closed.

Some historical V1 projection rows stored whole WORK in the relational
`amount` column while their immutable raw `pwt1:list5` authorization determines
an exact Q8 amount. Q16 conversion must decode that raw carrier, require one
matching valid confirmed replay event, and require all event/listing version,
token, and available amount aliases to agree; it never infers units from the
ambiguous table value. V5/V6 unit-form authorizations bind the deterministic
unit inputs while their valid replay event supplies the derived Q8 amount.
The idempotent migration path audits every confirmed preactivation legacy
listing under the immutable marker and, under serializable locks, permits only
the exact two-row canonical repair set. Each mutation compares the complete
projection payload and current amount before updating only its derived Q16
amount plus explicit legacy-atom migration metadata. A second run must report
`ready: true`, zero remaining items, and zero repaired rows.

Pending WORK state is volatile. Migration removes pending or wrong-era WORK
events, listing/action rows, balance deltas, and affected current snapshots,
while retaining noncanonical transaction envelopes as recovery input. After
activation replay reaches the exact tip, rebuild pending projections from Core
mempool evidence under V8. Every txid in the exact persisted pending WORK set
must remain present across both Core samples that fence the database audit, and
exact event, listing, transaction, legacy-era, and balance-delta parity is
required before readiness can turn green. Every member also requires all five
correctly typed WORK inspection markers, and a terminal-invalid protocol marker
cannot coexist with a valid persisted WORK projection. The full sampled mempool count and
hash remain compact audit evidence; unrelated additions or removals between
samples do not invalidate the WORK witness. Raw discovery of unrelated or
not-yet-projected unconfirmed transactions remains bounded best-effort work; it
is not canonical and a mempool larger than one scan budget—or unrelated
continuous churn—cannot indefinitely pause confirmed V8 state.

Canonical-summary publication is current under Q16 only when the same exact
tip snapshot embeds `tokenStatePayloads[WORK]` derived from that block's
complete canonical V8 closing transition. The publisher commitment-checks the
embedded state against the transition, bypasses same-tip and exact-checkpoint
reuse when it is missing or mismatched, and repairs it in the replacement
summary. Readiness never infers Q16 token state from an outer summary height or
from a stale pre-migration payload.

The first replacement summary cannot depend on its own readiness witness. Its
authenticated loopback builder has one internal-only bootstrap lane that reads
the unscoped live relational token tables at the exact requested height and
block hash. That lane is unavailable to public token reads and governed writes,
accepts only the `proof-indexer-token-state-tables` source, preserves confirmed
V8 listings, and opens only after the immutable migration marker and declaration
carrier, every installed constraint, the complete activation-through-tip
transition chain, relational commitment parity, legacy embargo, and a second
exact-tip check all pass. Snapshot, scoped, stale-hash, incomplete-transition,
or wrong-era inputs fail closed. The resulting summary must then bind the exact
Q16 transition state before ordinary replay, pending, public-read, or write
readiness can become green.

When that builder joins replayable Q8 movement history to the current Q16
tables, duplicate WORK sales and transfers must agree after exact integer
Q8-to-Q16 conversion. Their active top-level projection exposes only Q16
subatoms; conflicting aliases fail closed. Historical signed sale
authorizations and explicit legacy evidence remain unchanged and are not
treated as current Q16 aliases. An explicit empty overlay cannot erase that
evidence, and conflicting nonempty authorization or evidence records fail
closed instead of making replay order choose the settlement record.

Post-V8 transition closing-state audits bind the relational tables through
the V8 Q16 token-state preimage (`confirmedSupplySubatoms`, holder subatoms,
and immutable V8 listing terms). Historical V5/V6 transition audits retain
their original Q8 commitment path; a generic outer commitment cannot choose
the precision lane without the transition's explicit token-state model.

The canonical V8 transition records `workTokenStateModel` at the transition
payload root and in the indexed `work_token_state_model` column. Its
`closingTokenState` remains the bare committed preimage—amount storage model,
confirmed supply, holders, and listings—without a duplicate nested `model`
field. Worker replay validates both authoritative model locations and then
recomputes the bare preimage commitment; it must not reject or rewrite valid
transitions because that nested duplicate is absent.

The Q16 pending witness preserves the public protocol-position name
`protocolVout`, but its relational source is the canonical events column
`op_return_vout`. Backfill, worker verification, and reader readiness must all
select `op_return_vout AS protocol_vout`; an unaliased synthetic column name
is a schema error and keeps the witness explicitly not ready.

The raw mint remains `pwt1:mint:<canonical-work-token-id>:1000`, crediting
`100000000000` Q8 atoms before activation and
`10000000000000000000` Q16 subatoms from activation. New WORK transfers use
only `pwt1:send3:<canonical-work-token-id>:<amount-subatoms>:<recipient>`.
Historical `send`/`send2` records remain scale-qualified replay evidence but
cannot mutate postactivation state.

V8 listing projections use exact integer fields:

```text
version = pwt-sale-v8
unitModel = canonical-work-amo-proof-unit-v3
amountModel = canonical-work-amo-proof-unit-amount-v3
stateOrderModel = canonical-proof-state-order-v1
unitWorkOracleModel = canonical-work-prefix-before-action-v1
bondTransitionModel = canonical-compute-then-bond-v1
blockSequencerModel = canonical-work-amo-full-position-block-sequencer-v4
F = 25000
S = 21000000
A = 10000000000000000
Q = 100000000
unitPriceSats = F
unitAmountSubatoms = floor(F*S*A*Q/N)
unitMinimumPriceSats = ceil(unitAmountSubatoms*N/(S*A*Q))
```

`N` is the positive canonical `networkValueBeforeQ8` immediately before the
listing at `(blockHeight, blockTransactionIndex, protocolVout,
recordOrdinal)`. Multiplication precedes division. The Computer freezes the
terms, validates Q16 spendability, applies the listing's distinct registry
contribution, then applies the transaction miner fee once after all records in
that transaction. V8 admits no face except exactly 25,000 proofs. Only V8
seal, buy, and delist actions may reference a V8 listing, and seal or buy never
reprice it.

The precision migration is idempotent and defaults to read-only. Before apply,
it must prove:

- exact configured declaration text/carrier hashes, canonical block and
  transaction index, protocol output/record ordinal, authority input, and
  unambiguous registry-payment output;
- canonical declaration block `D`, opening block `D+1`, and the persistent
  activation latch;
- no conflicting declaration, marker, or precision state;
- exact Q8 definition, supply, holders, and declaration-height closing state;
- exact `10^8` conversion, Q16 conservation, and maximum-supply bounds;
- an exact sorted relic-cutover set matching every and only pre-V8 active or
  sealing WORK listing, with no reservation in the Q16 opening state;
- immutable preactivation commitments and deterministic invalidation of only
  wrong-era/current projections at and after `D+1`; and
- installed Q16, V8 activation, and V6 deactivation constraint definitions,
  not merely constraint names.

Apply writes one immutable `workPrecisionV2Migration:livenet` marker bound to
the V8 pins, activation opening, Q8-before/Q16-after token commitments,
relic-cutover commitment and items, row counts, conservation results, replay
policy, and exact models. Reapplying the same migration must return the same
marker without mutation. A marker-shaped object, converted rows without the
marker, a mismatched relic set, or constraints with unexpected definitions
cannot authorize reads or writes.

V8 readiness must agree at one exact Core tip across API and worker:

- all V8 pins are complete and match canonical evidence;
- `WORK_AMO_V8_ACTIVATION_HEIGHT=D+1` and the activation latch agree;
- the completed migration and relic-cutover marker validates exactly;
- activation-opening and activation-through-tip replay are complete;
- SQL constraint definitions and V8 frozen-term rows are exact;
- canonical ledger, relational index, API, and worker state have parity;
- pending rebuild parity is current;
- exact Core tip height/hash and public summary readiness agree; and
- `WORK_AMO_V8_WRITES_ENABLED=1` is the only enabled governed WORK gate.

Deployment sequence:

1. Build and test the exact release with every V7/V8 pin empty and both gates
   off; verify Q8/V6 and every current public route remain exact-tip green.
2. Deploy only additive schema, parser, migration, replay, readiness, and UI
   support. Confirm no V8 declaration, Q16 mutation, or relic cutover occurred.
3. Generate and publish the exact V8 declaration through the local wallet.
4. After canonical confirmation, capture all declaration pins and `D+1` while
   keeping `WORK_AMO_V8_WRITES_ENABLED=0`.
5. Take and verify a database backup. Run
   `npm run migrate:work-precision-v2` read-only; inspect declaration,
   conservation, relic, constraint, and replay evidence; then use the explicit
   apply mode.
6. Rebuild activation through the exact tip, rebuild pending state, and prove
   API/worker/index/ledger parity, one-subatom round trips, the singleton face,
   legacy-action rejection, and V8 peak-order behavior.
7. Enable only `WORK_AMO_V8_WRITES_ENABLED=1`, deploy all public surfaces from
   the same commit-bound archive, and repeat the production exact-tip sweep.

Any disagreement keeps V8 closed. Before activation, rollback removes only
the additive staged release. After Q16 activation, rollback means closing
writes and restoring the same V8 release from backup and replay; it never
means dividing balances, restoring legacy reservations, reopening V6, or
rewriting confirmed history.

### WORK atomic-unit cutover

This section preserves the completed historical Q8 atomic-unit migration and
its rollback boundary as operational history. During the pre-V8 era, WORK
used eight decimal places and one WORK equaled `100000000` atoms. Once
the definition metadata is marked `work-atoms-v1`, the existing numeric
definition, balance, pending-delta, and listing columns store WORK atoms; the
same columns for every other credit retain their existing whole-credit units.
Public projections expose canonical human decimal strings together with exact
integer `maxSupplyAtoms`, `mintAmountAtoms`, `balanceAtoms`, `pendingDeltaAtoms`,
and `amountAtoms` strings. Conservation, reservations, pending spendability,
and canonical replay must use the atom strings or integers, never binary
floating-point arithmetic.

Every derived ledger or canonical-summary snapshot published after the cutover
must carry the positive top-level marker
`workAmountStorageModel: "work-atoms-v1"`. Unmarked snapshots referenced by an
INCB `issuanceValueSnapshotId` remain byte-for-byte immutable H-1 oracle
evidence. Explicit pinned H-1 verification may read those rows, but every
unpinned/current snapshot selector excludes them. Unmarked, unreferenced
derived snapshots are stale pre-cutover read models and the migration deletes
them.

The migration is intentionally dual-read and single-write:

- Legacy `pwt1:send` events and signed `pwt-sale-v1` authorizations remain
  immutable whole-WORK history and are converted only in the derived
  projection.
- At the atomic cutover, new WORK transfers began writing `pwt1:send2` atom
  amounts and new WORK sale tickets began using `pwt-sale-v2` with signed
  `amountAtoms`; V2 remains invalid for every other credit. After the later
  historical WORK Marketplace Pricing Protocol V2 activation, governed WORK
  list, seal, and buy actions used `pwt-sale-v3`. That remains replayable
  history; current governed actions use AMO `pwt-sale-v5`.
- Raw OP_RETURN bytes and the nested signed authorization object are never
  rewritten. The event projection may add top-level exact atom fields.
- The migration is scoped to the canonical WORK token id. POWB, INCB, and all
  other credit definitions, balances, listings, events, and signed terms are
  outside its write set.

Run the cutover only from the approved exact release with the database
environment loaded. First take and verify a current PostgreSQL backup, then run
the read-only preflight:

```bash
NETWORK=livenet npm run indexer:audit-work-atoms
```

The command returns JSON shaped like:

```json
{
  "audit": {
    "atomic": false,
    "legacy": true,
    "definition": {
      "decimals": null,
      "maxSupply": "...",
      "mintAmount": "...",
      "model": "",
      "unitScale": ""
    },
    "balances": {
      "rows": 0,
      "holders": 0,
      "negative_balances": 0,
      "confirmed_supply": "...",
      "pending_delta": "..."
    },
    "listings": {
      "rows": 0,
      "invalid_amounts": 0,
      "statuses": {}
    },
    "events": {
      "amount_events": 0,
      "atom_events": 0,
      "invalid_atom_events": 0,
      "invalid_legacy_events": 0,
      "mismatched_atom_events": 0
    },
    "reservations": {
      "oversubscribed_sellers": 0
    },
    "snapshots": {
      "marked": 0,
      "unmarked_derived": 0,
      "unmarked_derived_referenced": 0,
      "unmarked_non_oracle_derived": 0
    }
  },
  "network": "livenet",
  "ok": true,
  "workAtomicProjectionAudit": true
}
```

The zero values above show field shape only; compare the real row/event counts
to the fresh production audit and deployment record. Preflight must report the
exact legacy definition, no negative balance, no malformed amount, and no
oversubscribed seller. Then:

1. Stop `proofofwork-api-wg.socket` first, then
   `proofofwork-api-wg.service`, `proofofwork-indexer-worker`, and
   `proofofwork-api` so no request can socket-activate the public proxy and no
   writer or reader can observe mixed units. Keep the socket and proxy stopped
   through the entire staged bootstrap.
2. Stage the exact release and run `npm run check:work-precision` plus
   `npm run check:index-recovery-behavior`.
3. With the services still stopped and the production database environment
   loaded, run:

   ```bash
   NETWORK=livenet POW_INDEX_WORK_ATOMIC_MIGRATION_APPLY=1 \
     npm run indexer:migrate-work-atoms
   ```

4. Require `ok: true`, `workAtomicProjectionMigration: true`,
   `migration.after.atomic: true`, `migration.after.legacy: false`, exact
   definition values `2100000000000000` max atoms and `100000000000` mint
   atoms, and `oversubscribed_sellers: 0`. Do not accept aggregate conservation
   alone: every address's confirmed balance and pending delta must equal its
   pre-cutover value times `100000000`; every listing amount must scale under
   the same `listing_id` while its status, parties, price, ticket/seal/close
   state, and nested signed authorization remain unchanged; and every
   amount-bearing WORK event, including invalid audit attempts, must have exact
   `amountAtoms = amount * 100000000` while canonical validity counters remain
   unchanged. The returned
   `invalidatedSnapshotIds` and `cacheInvalidationRequired` fields are part of
   the deployment record.
5. While the API is stopped, remove only derived response-cache files from the
   configured production cache directory (`/data/proofofwork-api-cache`) and
   the optional legacy checkout cache. The transaction deletes every unmarked,
   unreferenced derived database snapshot while preserving each referenced
   INCB H-1 oracle row byte-for-byte.
6. Keep the public API service and its WireGuard socket proxy stopped. Start
   the candidate API on an alternate, non-proxied loopback port, point a
   supervised `npm run indexer:worker -- --once` at that port with
   `POW_API_BASE`, and publish one fresh exact-tip marked canonical summary.
   Port `8081` is not private on production because the systemd socket proxy
   exposes it to Caddy.
7. Run:

   ```bash
   NETWORK=livenet npm run indexer:verify-work-atoms-post-bootstrap
   ```

   The strict post-bootstrap verifier must prove the atomic ledger and
   reservations again, resolve every immutable INCB H-1 oracle fingerprint,
   find zero unmarked non-oracle derived snapshots, and find a marked green
   canonical summary at the latest full-node block-scan tip.
8. Verify the staged `/health`, fresh `/api/v1/consistency`,
   `/api/v1/ledger-consistency`, the canonical WORK token payload, wallet
   spendability, AMO listings, WORK, Growth, Inception, and Log at one
   exact Core tip. Only then stop the staging API, start the public API and
   continuous worker, and reopen public traffic.

The migration uses a serializable transaction, an advisory lock, table locks,
canonical WORK balance replay, and post-write conservation gates. Any failed
gate rolls back the entire database change. The continuous worker also fails
closed by default until the exact atomic definition marker exists.
`POW_INDEX_REQUIRE_WORK_ATOMS=0` is a supervised emergency bypass only, not a
normal deployment setting. The cutover's rollback rule remains historical
evidence: restoring the verified pre-cutover database and old release was an
exact rollback only before any `send2` or `pwt-sale-v2`
transaction is broadcast. Once a V2 transaction exists, even pending, the old
release cannot represent or replay it. At that boundary, keep public writes
stopped, preserve the affected chain/mempool txids, and fix forward with a
V2-capable atomic release; never reopen the old release and never attempt an
in-place divide-by-scale rollback.

A post-cutover amount-metadata defect on an invalid WORK audit event has one
guarded, idempotent repair path. Stop index writers, stage the exact release,
load the production database environment, and run:

```bash
NETWORK=livenet POW_INDEX_WORK_ATOMIC_EVENT_REPAIR_APPLY=1 \
  npm run indexer:repair-work-atomic-events
```

The command runs under the atomic migration's serializable advisory/table
locks and may add only exact `amountAtoms`, `decimals`, and `unitScale` fields
to `valid = false` WORK audit rows. It aborts if a valid event needs repair,
if an amount cannot be converted exactly, or if event and validity counters
change. A real repair invalidates every replaceable derived summary, including
previously marked current summaries, while preserving immutable INCB H-1
oracle evidence. Treat its `invalidatedSnapshotIds`,
`cacheBootstrapRequired`, and `cacheInvalidationRequired` as deployment
gates: clear response caches, publish a new marked exact-tip canonical summary,
then run `indexer:verify-work-atoms-post-bootstrap` before reopening public
reads or writes. A second run reports `alreadyApplied: true`, changes no row,
and does not invalidate snapshots.

The July 19, 2026 bounded PWT replay exposed a separate historical retention
fault: pre-range INCB mint events remained canonical while 18 of their
immutable H-1 `ledger_snapshots` rows were pruned. Never synthesize those rows
from current state or from the smaller event binding alone; each original row
also commits its complete metrics, consistency and nested summary payloads.
This INCB restore rule is intentionally different from V5 H-1 readiness: V5's
immutable evidence row contains and commits the complete bootstrap preimages,
so it is validated directly and never authorizes synthesis of its historical
bound summary.
The closed recovery set comes from the verified July 20 physical backup's
pre-deletion `proof_indexer_shadow_20260718` database. Its 30 mint-event
bindings are byte-identical to production and the exact 18-row JSONL artifact
is pinned by:

```text
SHA256=4bdc01059114110396bdf666b68dd24d2c074c4c48e382b18a0f3a61849430bd
rows=18
targetEventReferences=30
globalReferencedSnapshotIds=29
```

Keep that artifact outside the release tree as a non-symlink, operator-readable
`0600` file. Load the canonical `POW_INDEX_DATABASE_URL`; this recovery command
rejects legacy or generic database variables. Stop index writers and run the
default rollback-only preflight:

```bash
NETWORK=livenet npm run indexer:restore-incb-oracle-snapshots -- \
  --artifact /absolute/path/oracle-snapshots-18.jsonl \
  --sha256 4bdc01059114110396bdf666b68dd24d2c074c4c48e382b18a0f3a61849430bd
```

Preflight must report `ok: true`, `committed: false`,
`state: "first-apply"`, `wouldInsert: 18`, 18 artifact rows, 30 target
references, 29 global referenced ids, and exactly the pinned 18 unresolved
ids. Take and verify another current logical backup before applying. Then run:

```bash
NETWORK=livenet POW_RESTORE_INCB_ORACLE_SNAPSHOTS_APPLY=1 \
  npm run indexer:restore-incb-oracle-snapshots -- \
  --artifact /absolute/path/oracle-snapshots-18.jsonl \
  --sha256 4bdc01059114110396bdf666b68dd24d2c074c4c48e382b18a0f3a61849430bd \
  --apply
```

The importer is pinned to livenet, the exact artifact hash and the exact
18 identifiers. It streams and hashes the artifact, rejects links, duplicate
or extra rows, divergent event bindings, partial recovery state, conflicting
existing rows and any noncanonical mint. Within one serializable transaction
it takes an advisory lock plus share-row-exclusive locks on the protected
block, transaction, event, snapshot and metadata tables. It locks and rejects
an active canonical fault, active or incomplete rebuild, or uncertified range
replay before any insert, then verifies
green status, H-1 height, four block-hash aliases, canonical-summary hash,
generation time, model, mode and exact legacy decimal-to-Q8 value, and inserts
missing rows without an update path. Historical JSON numeric lexemes are read
as exact text with PostgreSQL `jsonb_typeof` and `#>>`; JavaScript `Number`
never carries their value. The only admissible starting states are all 18
absent or all 18 already present with canonical logical-row and whole-row
fingerprint equivalence. Require the first apply to commit 18 rows and resolve
all 29 references. Repeat the same apply command:
it must commit with `state: "already-applied"` and `inserted: 0`.

Future bounded PWT replay preparation must collect the complete protected
snapshot set after deleting the replay range and before pruning snapshots.
That set includes every oracle referenced by a retained event, every
witness-preserved INCB row and every historical WORK marketplace oracle
reference. Preparation validates the immutable event-to-row fields and a
whole-row fingerprint both before and after pruning in the same
serializable transaction; an unresolved, divergent or changed row rolls the
entire preparation back. After a supervised historical restore or replay,
publish a fresh marked exact-tip summary and run
`indexer:verify-work-atoms-post-bootstrap` before any public read or AMO write
gate reopens.

Production application releases must be staged from one exact commit, install
dependencies before the swap, preserve one rollback outside the live path, and
leave `/opt/proofofwork-api` as a clean checkout at the recorded commit. Managed
UI and node release archives have dedicated allowlisted retention directories;
each deployment publishes its archive and SHA-256 sidecar from temporary names
before invoking retention. The prune service validates every sidecar, accepts
only the host-specific UI or node filename family, and must never target
historical recovery trees or a live release. Install root-executed scripts as
`root:root 0755`, unit/config files as `root:root 0644`, and create their
mandatory retention directories before starting the services.

Production Ubuntu uses Apport, not `systemd-coredump`. Install
`coredump-disable-sysctl.conf` as
`/etc/sysctl.d/99-proofofwork-no-coredumps.conf`, stop/disable/mask
`apport.service`, and run `sysctl --system`. Do not install a
`systemd-coredump` storage override and assume it controls the active handler.
After installing any units, run `systemctl daemon-reload`, restart the affected
services, enable both timers, and verify effective `LimitNOFILE`, `LimitCORE`,
mount requirements, timer schedules, journal limits, and `kernel.core_pattern`.
If these values drift in production, restore them from `deploy/` before trusting
route-level health checks.

Ledger snapshot repairs must keep the row as one complete data plane. A
current summary row should carry `summaryPayloads`, a current or preserved
`activityPayload`, row-level consistency checks, and an
`indexed_through_block` that includes block-scan rows even when a block has no
new ProofOfWork transactions. Database summary readers should expose the
row-level consistency object on returned summary payloads and nested
`floor`/`workFloor` objects so `/api/v1/work-floor`, Growth, AMO, and
`/api/v1/consistency` cannot mix current top-level totals with stale embedded
tip checks.

`indexer:parity` compares the database read model with confirmed canonical
history. Confirmed event coverage should be measured against confirmed
canonical activity; pending canonical activity and pending database rows are
mempool visibility, not a confirmed-history deficit. The parity report should
still surface pending counts so mempool pressure remains visible without
blocking a healthy confirmed ledger.

Production regression gates after the July 2026 index recovery are
`npm run check:work-precision`, `npm run check:bond-exact-arithmetic`,
`npm run check:incb-range-replay-witness`,
`npm run check:index-recovery-behavior`, `npm run check:live-data`,
`npm run check:work-participant-regression`, `npm run audit:ledger`,
`npm run audit:computer-events`, `npm run indexer:parity`,
`npm run check:mail-regressions`, and both marketplace regression modes. A healthy
run has `missingLogEvents: []`, populated event participant/ref search indexes,
matching WORK/Growth/summary snapshot ids, searchable known regression txids,
pending rows limited to mempool visibility, and marketplace summaries containing
every confirmed sealed WORK listing present in the full token payload.
`indexer:parity` is a heavyweight database gate, not a public request-path task.
Production worker parity may be disabled during normal hot-loop operation so
block catch-up and public API latency stay healthy; run parity manually during
quiet hardening windows or before database read-surface changes that need full
canonical/database comparison.
Production shipping must also verify the exact changed public outputs against
first-party full-node or confirmed tx truth before deploy. Proof-index
PostgreSQL tables are derived read models for speed; stale rows, stale zeros,
and unclosed sale-ticket projections must be repaired or bypassed when they
disagree with confirmed chain state.

Production audits should follow the public app dependency order. Verify the
standalone surfaces first: Home, IDs, Desktop, Browser, AMO, Credit,
Wallet, WORK, Infinity, Inception, Log, and Growth. Audit `computer.proofofwork.me` last,
because it is the integrated shell over the same registry, mail/file, credit,
marketplace, WORK, Infinity, Inception, Log, and Growth read paths. The final Computer
audit should prove that standalone fixes still agree inside the combined shell.

The completed production rollout followed this shadow-first ladder. Future
database-backed surfaces should use the same pattern:

1. Backfill known ProofOfWork transactions into PostgreSQL.
2. Run the continuous worker so new confirmed events and dropped pending txs
   update the database read model.
3. Replay protocol projections from the database.
4. Compare database output with the current canonical ledger payloads for
   Registry, Log, Credits, WORK, AMO, and Growth.
5. Require `/api/v1/consistency`, `/api/v1/ledger-consistency`, and
   `npm run audit:ledger` to stay green with `missingLogEvents: []`.
6. Switch endpoints to database reads only after shadow output matches current
   chain-derived output, with canonical fallback left in place.

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
amo.proofofwork.me          -> canonical Autonomous Money Organization
marketplace.proofofwork.me  -> URI-preserving compatibility redirect to AMO
credit.proofofwork.me       -> standalone credit creation and mint app
token.proofofwork.me        -> permanent redirect to https://credit.proofofwork.me/
tokens.proofofwork.me       -> permanent redirect to https://credit.proofofwork.me/
wallet.proofofwork.me       -> standalone credit wallet, transfer, listing, delisting, and sale-history app
work.proofofwork.me         -> standalone WORK credit dashboard and mint page
infinity.proofofwork.me     -> standalone Infinity Bond / POWB market and bond composer
inception.proofofwork.me    -> standalone Inception Bond / INCB market and bond composer
log.proofofwork.me          -> public ProofOfWork Computer log
growth.proofofwork.me       -> public growth model dashboard
```

Public headers and footers should list every current app domain as they are added, so users can move between Home, IDs, Computer, Desktop, Browser, AMO, Credit, Wallet, WORK, Infinity, Inception, Log, and Growth from any production surface. Social links should include X, YouTube, and GitHub.

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

Production raw transaction broadcasts use `MEMPOOL_BASE` through the first-party API. The browser sends only final signed transaction hex; wallet signing stays local and the API does not receive seed phrases, private keys, or unsigned wallet authority. Before submission the client verifies the signed transaction still has the intended inputs, outputs, values, and OP_RETURN payloads, then requires the API txid to match its locally decoded txid. The API validates browser origins, enforces per-client/global/concurrency limits, and requires an exact-tip canonical index for livenet broadcast admission.

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
/?infinity=1
/?inception=1
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
VITE_MARKETPLACE_ONLY=1 VITE_POW_API_BASE=https://amo.proofofwork.me npm run build
VITE_TOKEN_ONLY=1 VITE_POW_API_BASE=https://credit.proofofwork.me npm run build
VITE_WALLET_ONLY=1 VITE_POW_API_BASE=https://wallet.proofofwork.me npm run build
VITE_WORK_TOKEN_ONLY=1 VITE_POW_API_BASE=https://work.proofofwork.me npm run build
VITE_INFINITY_ONLY=1 VITE_POW_API_BASE=https://infinity.proofofwork.me npm run build
VITE_INCEPTION_ONLY=1 VITE_POW_API_BASE=https://inception.proofofwork.me npm run build
VITE_RUSH_ONLY=1 VITE_POW_API_BASE=https://rush.proofofwork.me npm run build
VITE_LOG_ONLY=1 VITE_POW_API_BASE=https://log.proofofwork.me npm run build
VITE_GROWTH_ONLY=1 VITE_POW_API_BASE=https://growth.proofofwork.me npm run build
```

RUSH remains staged behind explicit build/query flags and should not be added to public navigation or production domain routing until separately approved for launch.

Local deploy builds can leave generated artifacts such as `dist/`, `.vite/`,
and `.pow-api-cache/`. Treat them as rebuildable output/cache state. After
using the intended bundle, run `npm run hygiene:fix`, review the allowlisted
cleanup report, and run `npm run hygiene:check` before final staging or
committing. The exact cleanup boundary, protected history/evidence, generated
artifact policy, and commit trailers live in `REPOSITORY_HYGIENE.md`; do not
replace that narrow process with a broad ignored-file clean.

## Endpoints

```text
GET /health
GET /health/live
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
GET /api/v1/infinity-summary?network=livenet
GET /api/v1/inception-summary?network=livenet
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
- Exposes AMO sales data from valid `buy5` buyer-funded ID transfers: sale count and seller-price volume, split between confirmed canonical sales and pending mempool-visible sales. Legacy buy events remain replayable history but are not included in the public AMO metric.
- Exposes a Credits AMO tab over confirmed credit creations, mints, transfers, holders, registries, active sale-ticket listings, and settled credit sales.
- Exposes registry records, pending events, listings, and registry-specific activity.

The canonical livenet ledger payload:

- Is the shared source for `/api/v1/log`, `/api/v1/log-history`, `/api/v1/work-floor`, `/api/v1/growth-summary`, `/api/v1/infinity-summary`, `/api/v1/inception-summary`, `/api/v1/token`, `/api/v1/token-summary`, and `/api/v1/token-history`.
- Merges registry activity, discovered global Computer activity, seeded mail activity from app-derived addresses, canonical WORK state, canonical credit/token state, and staged protocol activity when enabled.
- Uses complete address history for configured mail-heavy Computer addresses, with paginated mempool/address reads as the faster path for the wider seed set. This prevents confirmed mail, Infinity Bond, or Inception Bond transactions from appearing in direct address search while missing from global Log and network value.
- Emits one `snapshotId`, source hashes, metrics, and consistency checks so WORK, Growth, Log, and credit/token history can prove they are reading the same confirmed state.
- Fresh summary reads must reject stale ledger fallbacks. A fresh WORK,
  Growth, Infinity, Inception, AMO, Log, or credit/token response must either
  build from current canonical/proof-index event data that covers the node tip
  within the configured lag, return a current checked ledger fallback that
  already covers that tip while deeper refresh continues, or fail closed instead
  of returning an older or lower snapshot as if it were refreshed.
- Carries live BTC/USD metadata (`btcUsd`, `btcUsdIndexedAt`, `usdSource`) on WORK/Growth responses. `actualValue.totalUsd` is current live USD from the first-party price endpoint, while `actualValue.modelTotalUsd` is the separate Growth model USD projection.
- Keeps pending records visible where useful, but only confirmed records affect canonical network value and the WORK floor.
- Keeps live and frozen network value separate. Live network value is the active site value and WORK floor source. Frozen network value is the immutable confirmation-time audit stamp for WORK movement and fixed event components.
- Applies credit movement value only to canonical WORK. Other credits remain proof-flow only: confirmed proof payments, registry/mutation fees, sale payments, and marketplace flow can count, but their listing floors do not reprice network value.
- Counts cumulative WORK miner fees once per confirmed transaction id from complete full-node input value minus output value. This is historical Bitcoin blockspace/security expenditure, not platform revenue, retained reserves, or spendable backing.
- Values a valid recipient-matched same-transaction WORK attachment from the last confirmed green canonical live WORK summary at H-1, hash-bound to the exact previous block. Every transaction in the bond block is excluded. Multiple Inception bonds in one block share that raw H-1 summary identity, but each bond keeps its own transaction id and block index in the bound issuance checkpoint. That same persisted H-1 oracle fixes both INCB issuance and the attachment's frozen WORK movement value; the normal sequential WORK replay floor must not replace it. Confirmation fixes the resulting INCB balance, supply, and attached WORK proof value while the underlying WORK movement stays single-counted in global Growth/WORK value. Inception network value is fixed cumulative issuance value plus confirmed INCB sale volume, transfer fees, and marketplace mutation fees. Current or later WORK value never reprices INCB.
- Persists a compact confirmed-WORK-transfer valuation projection with each exact canonical summary. Public WORK token and transfer-history reads may overlay only rows already present in the indexed result, and only when projection snapshot id, height, and block hash match the eligible database summary and the current Bitcoin Core tip; otherwise they fail closed to the unprojected row rather than publish stale values.
- Rejects or avoids replacing a useful cached ledger with a worse confirmed-history payload when guarded counts regress.
- May serve a useful cached ledger for fast first paint only when summary projections also correct active sale-ticket listings against current node spend state; deep refresh continues in the background and must converge on confirmed chain truth.
- Replays WORK mint summaries from canonical mint events and treats pending WORK mints as availability pressure only. Pending mints can reduce available mint slots in the UI, but they do not change confirmed supply, holders, floor, or network value.
- Orders pending WORK mint candidates by lowercase txid. A fast supply-cap rejection is allowed only from exact-tip confirmed supply plus a complete, Bitcoin Core-current prefix of earlier candidates; otherwise the verifier falls back instead of guessing.
- Revalidates only Core-current accepted/provisional supply-capped pending WORK decisions that disagree with exact confirmed supply plus lowercase-txid candidate order. Core-absent database rows never consume a pending slot. Every pending protocol transaction carries a versioned WORK-inspection marker, so a persisted PWM envelope cannot hide a deferred WORK companion and every legacy row receives one bounded inspection pass. Existing rows record exact raw WORK-message count and a recovery-pending marker before the broad verifier runs; a one-time 30-second verifier window must succeed before that marker clears. Deferred and unresolved multi-mint transactions form conservative ordering barriers: the rotating recovery lane rechecks that transaction and every later WORK decision because neither a missing decision nor raw message count proves how many mints its registry payment can fund. An exact whole-transaction terminal-invalid marker resolves a fully inspected multi-mint transaction only when no valid persisted WORK projection coexists with it. Ordinary verified single-mint rows stop consuming verifier work. A resolved permanent-invalid mint removes any older volatile valid/supply-cap decision only when the raw transaction contains an actual WORK mint attempt, then records a terminal transaction marker without publishing a provisional invalid event. A Core-current pending protocol transaction likewise receives a separate terminal-invalid marker only after the verifier returns a nonempty, entirely invalid result; unresolved verifier failures remain unmarked and retry. The mempool writer locks the transaction row before atomically replacing the complete volatile WORK mint/audit set, while the canonical block scanner removes only volatile WORK mint/audit rows before storing confirmed truth. Confirmed block-backed rows are never rewritten by the mempool path.
- Core-only WORK marketplace replay uses the current exact-tip relational WORK state and a bounded 30-second verifier window rather than rebuilding the full external registry history. When that exact state proves a pending listing exceeds its seller's spendable balance, the verifier returns a specific invalid decision so the worker can terminalize it; non-exact or fallback balance state remains unresolved.
- Promotes pending WORK and credit listings into confirmed state through the shared credit payload, deduping by listing txid and sale-ticket outpoint so confirmation does not leave duplicate pending rows behind.
- Current relational token-state reads remove an active listing as soon as a valid pending or confirmed close event exists; dropped close events never suppress the listing. This keeps full token payloads and fresh summary projections on the same mempool lifecycle.
- Preserves sale-ticket seal metadata when WORK or credit listings promote from pending to confirmed state. Confirmed seal regressions are rejected so a refreshed payload cannot make a sealed listing look unsealed.
- Checks pending WORK and credit txids for liveness on fresh reads and prunes dropped pending transfers, listings, seals, delistings, and buys from pending overlays without changing confirmed history.
- Counts AMO network value from sale volume plus market mutation fees. Market mutation fees remain in AMO flow and are excluded from generic Computer event flow.
- Reports only valid AMO mutation fee/flow in the outward marketplace aliases.
  The pinned AMO V5 legacy-bootstrap carry is exposed separately through
  `workAmoV5LegacyBootstrap`, `legacyBootstrapMarketplaceCarrySats`,
  `legacyBootstrapSats`, `legacyBootstrapGrowthValueQ8`,
  `legacyBootstrapCreditFixedSats`, and
  `legacyBootstrapCreditFixedQ8`; it never masquerades as valid marketplace
  activity. Exact evidence mismatch makes the summary fail closed.

The consistency endpoints:

- `/api/v1/consistency`
- `/api/v1/ledger-consistency`

These expose the ledger checks used by `npm run audit:ledger`, including
`livenet-confirmed-history-present`, `token-definitions-cover-confirmed-mints`,
`work-floor-actual-total`, `growth-actual-total`, `growth-work-floor-total`,
`marketplace-mutation-fees-counted`,
`marketplace-value-includes-mutation-fees`,
`computer-event-flow-excludes-marketplace`, `ledger-covers-node-tip`,
`token-sales-logged`,
`seeded-mail-events-logged`, `seeded-infinity-bonds-logged`,
`seeded-inception-bonds-logged`, and
`inception-live-issuance-matches-incb-supply`. The audit also
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
- Feeds the permanent WORK floor from live network value: `work_floor_sats = live_network_value_sats / 21,000,000 WORK`. Pending records are visible but do not change this canonical floor until confirmed.
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
- Reconstructs immutable legacy transfers from `pwt1:send:<token-create-txid>:<whole-amount>:<recipient-address>`, historical Q8 WORK transfers from `pwt1:send2:<canonical-work-token-id>:<amount-atoms>:<recipient-address>`, and post-activation Q16 WORK transfers from `pwt1:send3:<canonical-work-token-id>:<amount-subatoms>:<recipient-address>` transactions found on the credit registry address.
- Requires transfer payments of 546 proofs to the credit registry before OP_RETURN. Confirmed transfers debit the first input address and credit the recipient address; pending transfers are visibility only. Separate qualifying WORK-registry outputs remain valid; two or more same-era WORK transfers may instead use one exact `546 * transferCount` aggregate output before every funded transfer when all `pwt1:` records are those WORK transfers and every other protocol record is only an earlier `pwm1:` envelope.
- Approved mainnet message senders may attach canonical WORK to mail by combining normal mail recipient payments, `pwm1:` mail payloads, the exact aggregate WORK registry mutation payment, and one or more era-valid atomic `pwt1:send2`/`pwt1:send3` payloads in the same signed transaction. The output order keeps mail recipient parsing before the first `pwm1:` output and WORK transfer parsing after the registry payment before the first `pwt1:` output. Replay claims the physical aggregate output once and attributes exactly 546 proofs to each transfer.
- Reconstructs credit listings from `pwt1:list5:<sale-ticket-json-base64url>`, credit seals from `pwt1:seal5:<listing-txid>:<sealed-sale-ticket-json-base64url>`, delistings from `pwt1:delist5:<listing-txid>`, and buyer-funded purchases from `pwt1:buy5:<listing-txid>:<buyer-address>`.
- Credit listings reserve the seller's spendable balance, create a 546-proof seller-controlled sale-ticket output, and require the standard 546-proof credit registry mutation payment before OP_RETURN. Buys must spend the seller ticket, pay the seller the listed price plus ticket value, and pay the credit registry mutation fee.
- Active credit listings are filtered by sale-ticket outspend state. When Bitcoin Core RPC is configured, `gettxout` is the fast spend-state oracle and address-history scans are recovery context. If the ticket output is spent, the listing is closed even when a cached snapshot is otherwise stale; if the spend is a valid `buy5`, the event also appears as a credit sale.
- Credit listing seals are one-per-active-listing. A valid existing seal blocks duplicate seal attempts, while a newly confirmed listing promotion preserves the original seal and outspend state. Listing books may show pending seal rows as sealing status, but the Sealed tab/count means confirmed and buyable only; pending seals stay in All/Unsealed until confirmation.
- AMO summary compaction must keep all confirmed, unspent, buyable sealed listings even when the recent active-listing preview is capped. Public summary reads should be verified against the full WORK token payload so every confirmed sealed listing in `/api/v1/token` remains present in `/api/v1/marketplace-summary`.
- Credit market history merges active listings, closed listings, and settled sales into a paginated `market-log` view ordered by confirmation status, event time, and txid. It is not sorted by price or arbitrage.
- Confirmed `pwt1` attempts that fail canonical token validation remain indexed as `token-event-invalid` audit rows with their txid, block position, attempted amount, sender, recipient, and reason. They are visible in address-scoped Wallet, Event History, and invalid-event history, but are excluded from the public canonical Log and its action totals. They never mutate balances, supply, valid transfer history, floor, or network value.
- Fresh credit-directory and summary reads verify the stored hash-bound canonical checkpoint against Bitcoin Core instead of rebuilding the shared credit ledger in the request. Scoped wallet/history reads may still use bounded canonical recovery; explicit refresh must converge on current node truth and may not leave a spent sale-ticket visible as active.
- Fresh reads also remove dropped pending credit/WORK transactions from overlay state after liveness checks, so stale pending transfers, listings, seals, delistings, or buys do not survive after they disappear from mempool views.
- Wallet-owned credit listing views are derived from the same active and closed listing state as AMO, so a connected seller can inspect confirmed, pending, delisted, and sold listings without a separate stale wallet-only book.
- Credit UI surfaces show the starting unit price as mint price divided by mint amount, plus estimated USD per credit and per mint from BTC/USD.
- `credit.proofofwork.me` is the create/mint surface, `token.proofofwork.me` and `tokens.proofofwork.me` redirect to it, `wallet.proofofwork.me` is the credit wallet for transfers, listings, delistings, and sale history, and `work.proofofwork.me` is the dedicated WORK dashboard.
- WORK is reserved for canonical credit id `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`. Official indexers and creation UI reject any non-canonical credit create whose ticker contains `WORK`, and exclude blocked scam creator address `bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl`.
- WORK settings are 21,000,000 max supply, 1,000 WORK per mint, 1,000 proofs per mint, and the `work@proofofwork.me` registry address. WORK launches at exactly 1 proof per WORK. The create form can reuse the same economic template for non-reserved tickers only.
- WORK's permanent price floor is derived from live confirmed ProofOfWork Computer network value, not from pending mempool visibility: `work_floor_sats = live_network_value_sats / 21,000,000 WORK`. The inverse `21,000,000 / live_network_value_sats` is the WORK-per-proof ratio.
- Historical WORK Marketplace Pricing Protocol V2 is declaration-tx anchored at `4c53252c6e9279726e1456f4d846274bfa33f778b633d32a68ed36906b38083f` and activated at declaration height plus one. Its confirmed governed WORK list/seal/buy validation loaded the exact green canonical summary at H-1, required the authorization's `oracleBlockHeight`, `oracleBlockHash`, and `oracleNetworkValueQ8` to match it, recomputed the integer-ceiling minimum total seller price from `amountAtoms`, and failed closed on any unavailable or mismatched dependency. A missed next-block commitment was stale; confirmation did not rescue it. This is replay documentation, not the current AMO write protocol.
- WORK Marketplace Pricing Protocol V4 remains replayable historical design. AMO `pwt-sale-v5` governed WORK list/seal/buy actions from activation height 959621 until the V6 cutover. A listing chose only `$20`, `$50`, or `$100`; exact WORK atoms and proof price derived at its complete canonical position from the preceding valid `pwa1:usd1` quote and the network value immediately before the listing. Those terms froze at confirmation. Valid pre-V6 V5 listings remain settleable without current-floor repricing, while new V5 listings from V6 activation are invalid audit history.
- WORK AMO V6 is anchored by declaration transaction
  `975fd82aa84995e014b240618ee1a1254d0a735e6e1241372d0bed0a0d9f0799`
  and an independent write gate. From activation height `960219`, new
  governed listings use
  `pwt-sale-v6` and choose exactly `20,000`, `50,000`, or `100,000` proofs.
  The listing's exact WORK atoms derive at its complete canonical position
  from the network value immediately before the listing; no USD quote,
  attestation, signer, source quorum, or validity window is part of V6
  consensus. USD is display-only. V5 listings validly confirmed before the
  cutover keep their frozen terms and may settle; new V5 listings after the
  cutover are invalid audit history. Declaration pins, the immutable migration
  marker, activation-range replay, exact-tip parity and the explicit V6 write
  gate must all agree before production admits V6 actions.
- WORK value accounting exposes both live and frozen values. Live network value reprices confirmed WORK movement at the current live floor and is the site-facing value. Frozen network value records the confirmation-time value of each WORK movement plus fixed event components such as proof payments, registry mutation fees, marketplace mutation fees, sale payments, and miner fees where available.
- WORK is the only credit whose amount moved adds credit movement network value. Non-WORK credits remain confirmed proof-flow records and must not derive value from manipulable illiquid floors.
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
- Reconstructs optional `pwm1:s` subject fields as header metadata only.
- Reconstructs `pwm1:m` message chunks as the canonical message body.
- Reconstructs `pwm1:a` attachments after size and SHA-256 checks.
- Separates confirmed inbox/sent records from pending records.
- For proof-index-backed reads, prefers indexed decoded body text and can repair legacy subject-only rows from raw tx data. `Subject: ...` is never a valid replacement for the message body.

The tx status endpoint:

- Returns `confirmed`, `pending`, or `dropped`.
- Checks local infrastructure first and the pending fallback second.
- Lets Outbox stop showing dropped transactions as forever-pending.

The tx endpoint:

- Returns a normalized transaction payload from the same local/pending source order.
- Lets Browser reconstruct HTML from `pwm1:m` message bodies or verified `pwm1:a` attachments by txid without depending on public mempool.space from production browsers.
- Does not turn pending transactions into canonical history; Browser labels pending pages as pending.
- Keeps both confirmed and pending Browser pages script- and form-disabled in an opaque static sandbox. On-chain HTML receives no wallet-provider or signing execution lane.
- The API never receives seed phrases, private keys, or wallet authority.

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

- Confirmed stable registry, mail/file, Log, credit, marketplace, summary, and event history should come from the ProofOfWork event database when supported, with first-party node/API fallback for fresh reads and edge verification.
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
pwt1:send2:<canonical-work-token-id>:<amount-atoms>:<recipient-address>
pwt1:send3:<canonical-work-token-id>:<amount-subatoms>:<recipient-address>
```

`pwt1:send` remains the current whole-credit transfer form for generic
non-WORK credits and immutable legacy whole-WORK history. Canonical WORK
transfers before the V8 Q16 activation use `send2`; `amount-atoms` is a
positive canonical integer and one WORK equals `100000000` atoms. At and after
V8 Q16 activation, new WORK transfers use `send3`; `amount-subatoms` is a
positive canonical integer and one WORK equals `10000000000000000` subatoms.
Neither opcode accepts an exponent, sign, comma, whitespace alias,
leading-zero alias, zero, or decimal text. Both are WORK-only, and each is
valid for new state mutation only in its declared era.
Historical signed `pwt-sale-v1` authorizations remain whole-credit records;
historical fractional WORK actions may use `pwt-sale-v2`, and the governed V3
era used `pwt-sale-v3` with exact atoms and its hash-bound H-1 pricing
commitment. Historical governed WORK list, seal, and buy actions use
`pwt-sale-v5`. A V5 listing selects only `$20`, `$50`, or `$100`; its complete
canonical position, preceding valid USD quote, and network value immediately
before that position derive and freeze the exact WORK atoms and proof price at
confirmation. Later seal and buy actions reference those immutable terms and
do not reprice. The staged, declaration-gated successor is `pwt-sale-v6`: it
selects only `20,000`, `50,000`, or `100,000` proofs and derives the exact WORK
atoms from the network value immediately before the listing. V6 has no USD
consensus input, quote, attestation, key, quorum, or validity window; any USD
equivalent is display-only. After the V8 Q16 declaration activates, only the
25,000-proof face and canonical order are valid for new WORK listings, with
exact `unitAmountSubatoms` frozen under `pwt-sale-v8`. New V6 listings are
invalid and every pre-V8 active or sealing WORK listing is a non-actionable
relic with its reservation released; it cannot be sealed, bought, or delisted
through a legacy path. Non-WORK listings remain V1. The surrounding
`list5`/`seal5`/`buy5`/`delist5` messages and sale-ticket UTXO contract remain
compatible.

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

- Standalone public surfaces have been audited before the final Computer shell
  audit, so Computer is checking integration rather than hiding an unaudited
  child surface.
- `/health` returns `service: proofofwork-op-return-api`.
- `/health` is the exact-tip readiness contract; `/health/live` reports the separately labeled availability contract. Both must traverse the private WireGuard API path through Caddy.
- `/api/v1/consistency?network=livenet` is green, has no `missingLogEvents`, and includes the seeded mail, seeded Infinity Bond, seeded Inception Bond, and INCB live-issuance/supply checks.
- ID registry count matches the node-backed API and includes pending records when visible.
- `tokens@proofofwork.me` resolves to the expected credit index address.
- Duplicate/pending IDs cannot be routed.
- Sent, inbox, incoming, files, outbox, and dropped status all work through the API.
- Public Desktop can search a raw address or confirmed ProofOfWork ID and returns only confirmed attachments.
- Browser can load a txid with HTML in the message body or a verified `text/html` attachment, render it in a sandbox, and reject non-HTML message/attachment data.
- Standalone AMO can list, seal, delist, and buy confirmed IDs through the same registry API.
- Credit, Wallet, and AMO transaction buttons can load UTXOs, previous transaction hex, and listing-anchor outspends through the first-party API before opening UniSat.
- Generic funding selection excludes every active ProofOfWork ID and credit listing anchor owned by the connected wallet, even when that listing belongs to a different app or asset scope.
- `infinity.proofofwork.me` loads `/api/v1/infinity-summary`, can broadcast a `pwm1:m:powb` bond message to a recipient, and shows POWB balances/listings from the same sale-ticket ledger as credits.
- `computer.proofofwork.me/?folder=infinity` renders the embedded Infinity Bond / POWB workspace, including the Infinity Bond chart and POWB sale-ticket market, without falling back to credit-market labels.
- `inception.proofofwork.me` loads `/api/v1/inception-summary`, prepares a `pwm1:m:incb` bond message to a recipient, and shows INCB balances/listings from the same sale-ticket ledger as credits. Wallet signing and broadcast remain local/user-authorized.
- `computer.proofofwork.me/?folder=inception` renders the embedded Inception Bond / INCB workspace with Inception-specific chart, balance, and sale-ticket labels.
- A confirmed `incb` transaction appears as `inception-bond` and issues only INCB to its payment recipient from direct bond proofs plus attached WORK valued from the last confirmed green canonical live WORK summary at H-1, hash-bound to the exact previous block. Every transaction in the bond block is excluded. Confirmation fixes the resulting balance, supply, and attached WORK proof value. Any attached canonical WORK remains a separate single-counted movement lane. Inception network value equals fixed cumulative issuance value plus confirmed INCB sale volume, transfer fees, and marketplace mutation fees; current or later WORK value never reprices INCB, and the synthetic issuance creates no second global WORK/Growth value.
- Log can load global ProofOfWork Computer events and search an address, confirmed ProofOfWork ID, or txid.
- Known confirmed ledger regression txids are searchable in Log, including `411ff4ac6aeeb638abdc387b37734c384481bcce7dd01e28b827d02dc4968891` and `b4b17f84853ce5c9f6dbad7fe3cce0d61ac4cb92d92f7ea6d9d8c38256631f34`.
- `npm run indexer:parity` passes against production and reports canonical/database snapshot parity plus populated participants/refs.
- `npm run check:mail-regressions` passes against production, including the `64dcddd3bc035ad57e021f302f021fac5c135c20dcfeffb487ba6b23317d155e` OTC self-send in Inbox, Sent, Log, and Event History as an Infinity Bond.
- `npm run check:marketplace-regressions` passes against production, including WORK delist, sale-ticket lifecycle alignment, confirmed sealed listing visibility in marketplace summary, and wallet-scoped sealed listing state.
- Known WORK marketplace regression txids are searchable in Log, including `f5dbee238a09fe0da6a0e4d01526fefefa6676b86df742323ce49df0daa5ecf5` as a listing close, `34ad3a1211c3023d66d72e04e9faf8d989cd60f476887a0abd28b53ba2a8b0a3` as sale plus closure, and `d5fba208f3213ff0eabe3f857b84d1be9bc63ea5318f8e945a7a6cb9b6190edb` as the confirmed close for listing `ed2302fc151663295633de43026e1669f21e4371cc2805866cf17ee1f78eb78e`.
- Growth can load real chain metrics, including credit creations, mints, transfers, listings, and sales, and render the modeled-vs-real proofs/USD value graph without layout overlap on desktop and mobile.
- WORK and Growth show matching confirmed network value in proofs/live USD using `/api/v1/work-floor` and `/api/v1/prices/btc-usd`; `actualValue.totalUsd` reconciles to `actualValue.totalSats / 100000000 * btcUsd`.
- `npm run check:live-data` passes locally.
- `npm run check:api-truth`, `npm run check:hardening`, and `npm run check:ui` pass locally.
- `npm run audit:ledger` passes against production.
- Known attachment transactions reconstruct with valid size and SHA-256.
- Known HTML message-body transactions render through Browser from `pwm1:m`.
- Known pending txs return `pending`.
- Known dropped txs return `dropped`.
