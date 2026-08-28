# ProofOfWork.Me Production Health, Data, Event, and Storage Audit

Date: 2026-08-28
Audit window: about 2026-08-28T05:07Z through 2026-08-28T05:29Z
Mode: read-only production audit, followed by this approved local audit log
Status: application availability green, strict verifiability gates partially failing

## Scope

This audit checked production node health, API health, log health, event and
database health, exact math/invariant checks, UI VPS storage, node VPS storage,
stale or wasteful storage candidates, and whether rendered API payloads agree
with current mempool and confirmed-chain status.

No production files, production config, database rows, services, commits,
pushes, deploys, or cleanup actions were intentionally changed. This audit log
was added only after explicit user approval.

## Executive Summary

The confirmed chain/index/math core is mostly healthy:

- Bitcoin Core is synced at block `964388`, unpruned, not in initial block
  download, and txindex is synced at the same height.
- The production API and public `/health/live` report `ok: true`,
  `ready: true`, worker OK, database OK, disk OK, index OK, and lag `0`.
- `/api/v1/consistency?network=livenet&fresh=1` is green with
  `missingLogEvents: []`.
- Ledger, mail, computer-event, local contract, and exact arithmetic gates
  passed.

The strict verifier rails are not fully healthy:

- Full ID registry audit fails closed on a Core divergence assertion for
  `a1a58faef3a6ece598a5efb34545ee098cc09a2739cd68d458eafc6bc1e1f9dc`.
- Lightweight ID audit fence also fails closed:
  `ID audit transition chain is not contiguous at height 960601`.
- Fresh Log fails closed because the relational log page has one more pending
  item than the canonical summary at the same snapshot.
- Full marketplace regression fails because the compact marketplace summary
  lacks the stable-tip Core sale-ticket authority proof expected by the
  regression contract.
- Full indexer parity exits nonzero with currentness/parity failures around
  canonical summary, registry history, token state, and one WORK closed-listing
  query.

Operationally, the UI VPS disk is healthy. The node VPS data disk is at the
warning threshold and needs retention cleanup or expansion planning:

- UI VPS root: 36% used, about 23G free.
- Node VPS root: 33% used, about 63G free.
- Node VPS `/data`: 80% used, about 325G free. This trips the documented
  warning threshold, but is not yet at the documented critical threshold.

## Production Checkpoint

- Core/API/index block height: `964388`.
- Core/API/index block hash:
  `00000000000000000000c26acf8d53a2052eea9997a52f1d6d03a5d576b38060`.
- Canonical summary snapshot: `c8c25473ad34ae64406a8d16`.
- Canonical summary snapshot generated/indexed at:
  `2026-08-28T04:21:48.604Z`.
- Summary payload coverage at block `964388`:
  - `growthSummary`
  - `inceptionSummary`
  - `infinitySummary`
  - `logSummary`
  - `marketplaceSummary`
  - `tokenSummary`
  - `workFloor`
  - `workSummary`

## Verification Matrix

Passed:

- `npm run check:live-data`
- `npm run check:api-truth`
- `npm run check:hardening`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:work-precision`
- `npm run check:work-amo-v8`
- `npm run check:bond-exact-arithmetic`
- `npm run check:incb-range-replay-witness`
- Production loopback `npm run audit:ledger`
- Production loopback `npm run audit:computer-events` with DB env loaded
- Production loopback `npm run check:mail-regressions`
- Public `https://computer.proofofwork.me/health/live`
- Public `https://computer.proofofwork.me/api/v1/consistency?network=livenet&fresh=1`

Failed or warning:

- Production `npm run audit:ids`
- Internal `/api/v1/internal/id-registry-audit`
- Internal `/api/v1/internal/id-registry-audit-fence`
- Public and loopback `/api/v1/log?network=livenet&fresh=1`
- Loopback `/api/v1/log-history?network=livenet&limit=20&fresh=1`
- Production full `check:marketplace-regressions`
- Production `npm run indexer:parity`, both strict fresh and non-fresh runs
- Node storage health service, because `/data` is above the 75% warning
  threshold
- Node release health service, because `/opt` has too many release checkouts
  and the active `.git/index` mode is flagged unsafe

An initial `audit:computer-events` invocation without DB environment failed
with the expected missing `POW_INDEX_DATABASE_URL` guard. It was rerun with the
production DB env loaded and passed.

## Node and API Health

Host: `pow-bitcoin-01` (`65.108.122.87`)

Live service state:

- `bitcoind`: active/running, no restarts reported.
- `electrs`: active/running, no restarts reported.
- `postgresql@16-main`: active/running, no restarts reported.
- `proofofwork-api`: active/running, no restarts reported.
- `proofofwork-indexer-worker`: active/running, no restarts reported.

Core state:

- Chain: main.
- Blocks: `964388`.
- Headers: `964388`.
- Best block hash:
  `00000000000000000000c26acf8d53a2052eea9997a52f1d6d03a5d576b38060`.
- Initial block download: false.
- Pruned: false.
- Verification progress: `1`.
- Txindex synced: true, best block height `964388`.
- Mempool loaded: true.
- Mempool size: `79597` txs.
- Mempool bytes: `39914724`.
- Mempool usage: `221950088`.
- Mempool min fee: `0.00000100`.

API `/health` and `/health/live`:

- `ok: true`.
- `ready: true`.
- `lagBlocks: 0`.
- Node OK: true.
- Electrum OK: true and at tip.
- Database OK: true.
- Disk OK: true by API hard limits.
- Worker OK: true.
- Worker consecutive failures: `0`.
- Worker phase: `idle`.
- Worker proof source: `idle-confirmed-replay`.
- Pending-event health: OK, zero unresolved global pending events and zero
  unresolved Q16 pending events.

Note: public `/health/live` briefly reported pending status scan counts
`checked: 29`, `staleCandidates: 29`, and later reported `checked: 0`,
`staleCandidates: 0`. In both samples the pending-health envelope was OK.

## Node VPS Storage

Disk:

- `/`: 98G size, 31G used, 63G available, 33% used.
- `/data`: 1.7T size, 1.3T used, 325G available, 80% used.
- `/data` inodes: 1% used.

Memory:

- Total memory: about 124Gi.
- Available memory: about 109Gi.
- Swap: 15Gi total, about 670Mi used during the audit.

Large `/data` consumers:

- `/data/bitcoin`: 903G.
- `/data/proofofwork-postgres-backups`: 192G.
- `/data/proofofwork-postgres-tablespaces`: 69G.
- `/data/electrs`: 59G.
- `/data/proofofwork-release-backups`: 7.5G.
- `/data/proofofwork-recovery`: 3.6G.
- `/data/recovery-20260710-index-recovery-20260820T211000Z.tar.zst`: 1.4G.
- `/data/mempool`: 1.3G.
- `/data/proofofwork-api-cache`: 167M.

PostgreSQL backup detail:

- `/data/proofofwork-postgres-backups/logical`: 123G.
- `/data/proofofwork-postgres-backups/physical`: 59G.
- `/data/proofofwork-postgres-backups/recovery-evidence`: 9.6G.
- `/data/proofofwork-postgres-backups/prechange`: 48M.
- `/data/proofofwork-postgres-backups/validation-evidence`: 6.6M.
- `/data/proofofwork-postgres-backups/recovery-20260820T211000Z.tar.zst`:
  567M.

Release/runtime footprint:

- Active `/opt/proofofwork-api`: 175M.
- Thirteen `/opt/proofofwork-api-stage-*` or rollback checkouts were present,
  each about 155M to 234M.
- Active `/opt/proofofwork-api/.git/index` mode: `664`; release health flags
  this as unsafe.

Failed node units observed:

- `proofofwork-api-candidate-93f085b.service`: failed transient candidate
  launch because `/tmp/proofofwork-api-candidate-93f085b-cache` did not exist.
- `proofofwork-node-release-health.service`: failed first due more `/opt`
  checkouts than bounded inventory allows, then with
  `CRITICAL live node runtime attestation failed` and
  `Checkout file has an unsafe mode: .git/index`.
- `proofofwork-node-storage-health.service`: failed because `/data` is 80%
  used and the storage script warns at 75%.
- `proofofwork-recovery-parity.service`: older recovery parity job failed on
  `/api/v1/log-history` HTTP 503 during a recovery run.
- `proofofwork-recovery-snapshot.service`: older recovery snapshot job failed
  in PostgreSQL JSONB handling.
- `proofofwork-reorg-restore-20260826.service`: older isolated restore failed
  due permission denied reading a pinned backup dump.

Recent warning-level logs for live `proofofwork-api` and
`proofofwork-indexer-worker` via `journalctl -p warning..alert --since
"6 hours ago"` showed no entries. A wider grep of API logs did show repeated
fresh-summary fallback messages and fresh route failures while the audit was
running.

## PostgreSQL Health

Query/tablespace health passed when run as `postgres`:

- Client connections: 6.
- Active connections: 2.
- Oldest active query: 0 seconds.
- Max same query fanout: 1.
- Lock waiters: 0.
- Idle in transaction: 0.
- Large-state storage closure: 18 members.
- Large-state indexes: 14.
- Placed in large-state tablespace: 18.
- Invalid indexes: 0.

Database size:

- `pg_database_size`: 16,627,366,935 bytes, about 15G.

Largest relations:

- `proof_indexer.work_amo_block_transitions`: about 14G.
- `proof_indexer.ledger_snapshots`: about 707M.
- `proof_indexer.events`: about 87M.
- `proof_indexer.transactions`: about 68M.
- `proof_indexer.event_participants`: about 46M.
- `proof_indexer.tx_outputs`: about 40M.
- `proof_indexer.event_refs`: about 23M.
- `proof_indexer.tx_inputs`: about 19M.
- `proof_indexer.op_returns`: about 17M.

Activity and WAL:

- PostgreSQL activity sample: 11 idle client connections, 1 active.
- `pg_stat_database`: deadlocks `0`.
- WAL directory: about 81M.

Aggregate production index counts:

- Transactions confirmed: 24,006.
- Transactions pending: 176.
- Transactions dropped: 79.
- Confirmed valid events: 24,335.
- Confirmed invalid audit events: 308.
- Pending valid events: 29.
- Pending invalid audit events: 146.
- Dropped valid events: 5.
- Dropped invalid audit events: 34.
- Event participants: 121,804.
- Distinct participant addresses: 449.
- Event refs: 50,183.
- Ledger snapshots: 6,208.
- Latest ledger snapshot block: 964388.
- WORK AMO block transitions: 4,768.
- Latest WORK AMO transition block: 964388.

Event-kind aggregate sample:

| Protocol | Kind | Status | Valid | Count | Amount proofs | Min block | Max block |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `pwid1` | `id-register` | confirmed | true | 502 | 502000 | 948376 | 963446 |
| `pwid1` | `id-register` | pending | true | 24 | 24000 | | |
| `pwid1` | `id-register` | dropped | true | 4 | 4000 | | |
| `pwid1` | `id-list` | confirmed | true | 13 | 7098 | 948926 | 956029 |
| `pwid1` | `id-seal` | confirmed | true | 8 | 4368 | 949029 | 956619 |
| `pwid1` | `id-buy` | confirmed | true | 5 | 2730 | 948935 | 957408 |
| `pwid1` | `id-transfer` | confirmed | true | 2 | 1092 | 948854 | 948855 |
| `pwid1` | `id-update` | confirmed | true | 1 | 546 | 948866 | 948866 |
| `pwm1` | `mail` | confirmed | true | 72 | 1472952 | 948283 | 964233 |
| `pwm1` | `reply` | confirmed | true | 19 | 12794 | 948418 | 962976 |
| `pwm1` | `file` | confirmed | true | 5 | 2730 | 948286 | 952390 |
| `pwm1` | `inception-bond` | confirmed | true | 47 | 27932 | 957950 | 963782 |
| `pwm1` | `infinity-bond` | confirmed | true | 465 | 630196569 | 952284 | 956967 |
| `pwm1` | `infinity-bond` | pending | true | 3 | 450000 | | |
| `pwt1` | `token-create` | confirmed | true | 235 | 128310 | 949463 | 952213 |
| `pwt1` | `token-mint` | confirmed | true | 21873 | 23545075 | 949463 | 959004 |
| `pwt1` | `token-mint` | pending | true | 1 | 555 | | |
| `pwt1` | `token-transfer` | confirmed | true | 191 | 103740 | 950161 | 964374 |
| `pwt1` | `token-listing` | confirmed | true | 415 | 226590 | 950246 | 964382 |
| `pwt1` | `token-listing-sealed` | confirmed | true | 325 | 177450 | 950255 | 964374 |
| `pwt1` | `token-listing-sealed` | pending | true | 1 | 546 | | |
| `pwt1` | `token-listing-closed` | confirmed | true | 101 | 55146 | 950474 | 964092 |
| `pwt1` | `token-sale` | confirmed | true | 56 | 8903286 | 950474 | 964092 |
| `pwt1` | `token-event-invalid` | confirmed | false | 267 | 0 | 949449 | 963782 |
| `pwt1` | `token-event-invalid` | pending | false | 146 | 0 | | |

Confirmed invalid and pending invalid protocol attempts are audit evidence.
They should not be deleted or silently collapsed into valid business activity.

## Consistency and Math Health

Public fresh consistency passed:

- Status: `green`.
- Indexed through block: `964388`.
- Missing log events: `[]`.
- `livenet-confirmed-history-present`: OK with 502 POW IDs, 24,363 activity
  items, and 238 confirmed tokens.
- `token-definitions-cover-confirmed-mints`: OK with 238 confirmed tokens and
  21,873 confirmed token mints.
- `token-components-cover-confirmed-activity`: OK with 21,873 mints, 56 sales,
  238 tokens, and 191 transfers.
- `canonical-activity-count-matches-public-log`: OK.
- `ledger-covers-node-tip`: OK with lag `0`.
- `inception-live-issuance-matches-incb-supply`: OK.
- `inception-fixed-value-reconciles`: OK.
- `infinity-bond-flow-matches-powb-supply`: OK.
- `network-values-finite`: OK.
- `work-floor-actual-total`: OK.
- `growth-actual-total`: OK.
- `growth-work-floor-total`: OK.
- `marketplace-mutation-fees-counted`: OK.
- `marketplace-value-includes-mutation-fees`: OK.
- `computer-event-flow-excludes-marketplace`: OK.
- `credit-frozen-value-includes-event-components`: OK.
- `credit-live-value-is-active-network-value`: OK.
- `token-events-logged`: OK, missing `0`.
- `token-sales-logged`: OK, missing `0`.
- `seeded-mail-events-logged`: OK, seeded 608, missing `0`.
- `seeded-inception-bonds-logged`: OK, seeded 47, missing `0`.
- `seeded-infinity-bonds-logged`: OK, seeded 465, missing `0`.

Exact arithmetic/source-contract checks passed:

- WORK precision contract: 131 checks, model `work-atoms-v1`, unit scale
  `100000000`.
- WORK AMO V8 contract: status OK, version `pwt-sale-v8`, allowed face proofs
  `[25000]`, amount field `unitAmountSubatoms`, precision model
  `work-subatoms-v2`, network value scale `Q8`.
- Bond exact arithmetic contract: passed.
- INCB range replay witness: passed with commitment
  `6967b8f747b57f1474e87c8b3d262e76ac9c1e7041a75dcd05a4c1a582d7e6e1`.

Production ledger audit passed:

- API base: `http://127.0.0.1:8081`.
- Snapshot: `c8c25473ad34ae64406a8d16`.
- Exact value reported by the audit:
  `7466952437956695651.61398281` proofs.

## Log and Pending Event Health

Fresh Log is not healthy:

- `/api/v1/log?network=livenet&fresh=1` returned HTTP 503.
- Error: `Fresh relational Log does not match the exact canonical Log summary.`
- Details:
  - Code: `CANONICAL_LOG_MISMATCH`.
  - Page height: `964388`.
  - Summary height: `964388`.
  - Page snapshot: `c8c25473ad34ae64406a8d16`.
  - Summary snapshot: `c8c25473ad34ae64406a8d16`.
  - Page total: `24364`.
  - Page snapshot total: `24364`.
  - Summary total: `24363`.
  - Page pending: `29`.
  - Summary pending: `28`.
  - Page latest event block: `964382`.
  - Summary latest event block: `964382`.
  - Canonical miner fee coverage complete: true.
  - Missing confirmed events: `0`.
  - Missing confirmed transactions: `0`.

Fresh Log history is also not healthy:

- `/api/v1/log-history?network=livenet&limit=20&fresh=1` returned HTTP 503.
- Error: `Fresh Log history does not match the exact canonical Log summary.`
- Details showed page total `24364` and summary total `24363` at the same
  snapshot and height.

The DB had 29 valid pending events during the mismatch window:

- Mostly older-but-still-observed `pwid1:id-register` events.
- 3 `pwm1:infinity-bond` pending events.
- 1 `pwt1:token-mint` pending event.
- 1 `pwt1:token-listing-sealed` pending event.

Because the worker continued to observe these txids in pending-status sweeps,
they were not marked dropped. The mismatch appears to be that the fresh
canonical summary and the relational page disagree by one pending item, not
that confirmed chain history is missing.

## ID Registry Audit

The ordinary rendered surfaces for the sampled ID event are consistent:

- Txid:
  `a1a58faef3a6ece598a5efb34545ee098cc09a2739cd68d458eafc6bc1e1f9dc`.
- ID: `grahamnazareth`.
- Kind: `id-register`.
- Status: confirmed.
- Valid: true.
- Amount: 1,000 proofs.
- Block height: `960117`.
- Block index: `2174`.
- Protocol vout: `1`.
- Record ordinal: `0`.
- Registry payment: vout `0` pays 1,000 proofs to
  `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e`.
- OP_RETURN payload:
  `pwid1:r2:Z3JhaGFtbmF6YXJldGg:1AcH1HwHCg4ggiBj4NJSqZ9SPGwSyRBSKs:1AcH1HwHCg4ggiBj4NJSqZ9SPGwSyRBSKs`.

Confirmed surfaces for that tx:

- `/api/v1/tx/.../status` returns confirmed, canonical, block height `960117`,
  and the expected block hash.
- `/api/v1/log-history?...q=<txid>&fresh=1` returns the confirmed ID register.
- `/api/v1/registry-history?...q=<txid>&fresh=1` returns the confirmed
  registry record.
- `/api/v1/internal/id-verifier?network=livenet&txid=<txid>` returns HTTP 200
  and the full ordered ID verifier item.
- Direct Core JSON-RPC `getrawtransaction` confirms the same block hash,
  OP_RETURN, and registry payment output.

The strict ID audit fails:

- `/api/v1/internal/id-registry-audit?network=livenet` returns HTTP 503.
- Error:
  `Accepted post-activation ID lifecycle event at a1a58faef3a6ece598a5efb34545ee098cc09a2739cd68d458eafc6bc1e1f9dc:960117:2174:1:0 diverges from Core.`
- `/api/v1/internal/id-registry-audit-fence?network=livenet` returns HTTP 503.
- Fence error:
  `ID audit transition chain is not contiguous at height 960601.`

Likely code-level cause for the full audit failure:

- `registryAuditRawReplayAcceptedEvent` returns `protocolPayload`, but the
  post-activation audit comparison checks
  `accepted.protocolPayloadSha256 !== carrier.rawPayloadSha256`.
- Relevant code:
  - `server/proof-api.mjs` around line 69158 returns the accepted-event object.
  - `server/proof-api.mjs` around line 70596 checks
    `accepted.protocolPayloadSha256`.

This is likely an audit/projection evidence bug rather than proof that the
sampled registration itself is invalid, because Core, DB rows, status, log,
registry history, and the internal verifier agree on the transaction.

The separate transition-chain contiguity failure at height `960601` still needs
root-cause work.

## Marketplace Audit

Individual marketplace/token routes looked healthy during the full regression
walk:

- Token reads returned OK.
- Token history reads returned OK for listings, closed listings, invalid
  events, market log, sales, transfers, holders, and wallet-scoped reads.
- Reported WORK, POWB, closed-listing, invalid-event, delayed-transfer, and
  sealed-listing samples were present where expected.

The full marketplace regression still failed:

- Command: production loopback full `check:marketplace-regressions`.
- Failure:
  `Marketplace summary lacks a complete stable-tip Core sale-ticket authority proof`.
- The failure repeated using the production Node 24 runtime.

Observed payload shape:

- `/api/v1/marketplace-summary?network=livenet` token payload had active
  listing data but no `token.listingAuthority`.
- Same result with `fresh=1`.
- Summary token listing count: 184.
- Summary sealed count: 171.

The complete listings route does carry the expected authority proof:

- Route:
  `/api/v1/token-history?network=livenet&asset=<WORK>&kind=listings&limit=20&fresh=1`.
- `listingAuthority.model`: `proof-token-market-core-gettxout-v1`.
- `includeMempool`: true.
- `inputListingCount`: 387.
- `checkedListingCount`: 387.
- `outputListingCount`: 275.
- `spentListingCount`: 112.
- `unspentListingCount`: 275.
- `buyableCandidateCount`: 311.
- Checkpoint height: `964388`.
- Checkpoint hash:
  `00000000000000000000c26acf8d53a2052eea9997a52f1d6d03a5d576b38060`.
- `checkedOutpointsSha256`:
  `0b3a414830d1bec10be84c90a77d6eae4ce4ed9e76669c609e5702a3c4d8939c`.

Interpretation: complete paginated listing authority exists and is Core-bound,
but the compact marketplace summary does not render or carry that proof. This
is a summary payload/verifier contract gap, not evidence that the complete
listings route is missing Core authority.

## Indexer Parity

Strict production parity with fresh log/snapshot/token checks failed because
`/api/v1/log?network=livenet&fresh=1` returned HTTP 503 during
`canonical-activity-coverage`.

Non-fresh production parity also exited nonzero. Filtered failed checks:

- `work-amo-v5-migration`, warning, reasons:
  `canonical-tip-not-current`, `migration-not-complete`.
- `work-amo-v5-usd-quote-head`, warning, same reasons.
- `database-has-canonical-summary-snapshot`.
- `canonical-summary-snapshot-current`.
- `events-cover-canonical-activity`.
- `registry-history-listings-parity`.
- `registry-history-sales-parity`.
- `registry-confirmed-listings-semantic-parity`.
- `registry-confirmed-activity-semantic-parity`.
- `registry-payload-current-relational`.
- `marketplace-summary-snapshot-parity`, warning.
- `token-state-current-relational`.
- `work-token-state-current-relational`.
- `token-history-work-delist-closed-query-current-relational`.

The parity tail also showed a WORK AMO readiness payload with:

- `requestedThroughHeight`: 964388.
- `ready`: false.
- `requestedTipReady`: false.
- `migrationReady`: false.
- `positionsReady`: true.
- `quoteReady`: false.
- `relationalTokenState.complete`: false.
- `relationalTokenState.reason`: `work-amo-v5-token-state-supply-invalid`.
- `listingReasons`:
  `canonical-tip-not-current`, `migration-not-complete`,
  `usd-quote-head-missing`.

This does not negate the passing exact V8/source arithmetic checks, but it does
mean the broad production parity gate is not green.

## Mail and Desktop/Event Projection Health

Production mail regressions passed:

- API base: `http://127.0.0.1:8081`.
- Registry records in check: 525.
- Source: `proof-indexer-current-id-events+proof-indexer-confirmed-id-records`.
- History cases for known self-send txs found matching event/log history.
- Address cases all had `scanFailed: false`.

Sample result counts:

- `carbonz@proofofwork.me`: inbox 26, sent 31, total 57.
- `gullish@proofofwork.me` contact mail sender: inbox 186, sent 184,
  total 370.
- `gullish` contact mail recipient: inbox 33, sent 68, total 101.
- `armyofyouth@proofofwork.me`: inbox 20, sent 9, total 30.
- `pinoratiko@proofofwork.me`: inbox 78, sent 81, total 159.
- `otc@proofofwork.me` self-send: inbox 29, sent 29, total 58.
- Desktop public file sender: inbox 1, sent 1, total 2.

## UI VPS Health

Host: `ubuntu-4gb-hel1-1` (`77.42.91.106`)

Disk and memory:

- Root disk `/`: 38G size, 13G used, 23G available, 36% used.
- Inodes: 5% used.
- Memory: 3.7Gi total, about 3.2Gi available.
- Swap: none.
- Systemd failed units: 0.
- Journal disk usage: about 222.6M.

Units/timers:

- `caddy`: active.
- `logrotate.timer`: active.
- `proofofwork-ui-storage-health.timer`: active.
- `proofofwork-ui-storage-prune.timer`: active.
- `proofofwork-ui-release-provenance.timer`: active.
- `proofofwork-ui-release-prune.timer`: active.

UI storage:

- `/var/www`: 360M.
- `/var/log`: 518M.
- `/var/backups/proofofwork-ui`: 5.1G.
- `/var/tmp/proofofwork-deploy`: 3.5G.
- `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`: 183M.

Backup detail:

- `/var/backups/proofofwork-ui/releases`: 1.8G.
- `/var/backups/proofofwork-ui/rollbacks`: 2.4G.
- `/var/backups/proofofwork-ui/rollback-roots`: 360M.
- `/var/backups/proofofwork-ui/cleanup-evidence`: 161M.

Static surface checks:

- `https://proofofwork.me/`: 301 to `https://www.proofofwork.me/`.
- `https://www.proofofwork.me/`: 200.
- `https://id.proofofwork.me/`: 200.
- `https://computer.proofofwork.me/`: 200.
- `https://marketplace.proofofwork.me/`: 308 to `https://amo.proofofwork.me/`.
- `https://amo.proofofwork.me/`: 200.
- `https://wallet.proofofwork.me/`: 200.
- `https://work.proofofwork.me/`: 200.
- `https://credit.proofofwork.me/`: 200.
- `https://growth.proofofwork.me/`: 200.
- `https://infinity.proofofwork.me/`: 200.
- `https://inception.proofofwork.me/`: 200.
- `https://log.proofofwork.me/`: 200.
- `https://desktop.proofofwork.me/`: 200.
- `https://browser.proofofwork.me/`: 200.

Caddy:

- Warning journal entries in the sampled six-hour window: none.
- Recent access-tail 4xx/5xx counts from the last 50,000 access lines:
  - 404: 1.
  - 421: 237.
  - 502: 89.
  - 503: 135.
- Recent 5xx sample included:
  - `computer.proofofwork.me /api/v1/health`
  - `wallet.proofofwork.me /api/v1/token`
  - `wallet.proofofwork.me /api/v1/registry`
  - `amo.proofofwork.me /api/v1/marketplace-summary`
  - `growth.proofofwork.me /api/v1/growth-summary`
  - `wallet.proofofwork.me /api/v1/work-floor`

Many recent 5xxs align with the API fresh-summary fallback/fresh-route
failures seen in node logs, not with UI disk exhaustion. They still need to be
treated as user-facing symptoms.

Active UI release:

- Release id: `cdc8f77853d7-20260828T024753Z`.
- Commit:
  `cdc8f77853d757e6a04335693b00a5d360c81373`.
- Deployed at: `2026-08-28T02:56:54Z`.
- Archive SHA:
  `7e6508992f36157400ae5cd6a0d8eb4acf9cbdad861b545fdca9e5d2a84ec80c`.
- Release provenance verifier succeeded repeatedly after the deploy lock cleared.

## Stale, Backup, and Wasted Storage Candidates

No storage was removed in this audit. Candidates below need explicit approval
and classification before deletion, because this repository treats release
provenance, rollback roots, recovery evidence, historical migrations, audit
data, and chain-backed records as durable evidence unless proven otherwise.

Node VPS candidates:

- `/opt/proofofwork-api-stage-*` and rollback checkouts:
  - About 13 checkouts, roughly 155M to 234M each.
  - Release health is already failing because the bounded inventory is
    exceeded.
  - Likely safe only through the documented release-prune workflow after
    verifying active and rollback provenance.
- `/data/proofofwork-postgres-backups/logical`:
  - 123G.
  - Large enough to materially improve runway, but likely retention-critical.
    Requires backup policy review before deletion.
- `/data/proofofwork-postgres-backups/physical`:
  - 59G.
  - Same retention caveat as logical backups.
- `/data/proofofwork-postgres-backups/recovery-evidence`:
  - 9.6G.
  - Preserve unless explicitly superseded by newer recovery evidence and
    deletion is attested.
- `/data/proofofwork-recovery`:
  - 3.6G.
  - Contains reorg/recovery artifacts. Preserve until classified.
- `/data/recovery-20260710-index-recovery-20260820T211000Z.tar.zst`:
  - 1.4G plus sidecar.
  - Preserve until classified.
- `/data/proofofwork-api-cache-candidate-*`:
  - Many are 4K empty candidates; a few retained/quarantine caches are tens of
    MB.
  - Low storage impact but could be cleaned by an allowlisted cache cleanup
    workflow if approved.

UI VPS candidates:

- `/var/tmp/proofofwork-deploy`:
  - 3.5G.
  - Contains recent source/surface tarballs and unpacked deployment scratch,
    including current-day release material.
  - Candidate for bounded scratch cleanup only after release provenance and
    rollback archives are confirmed.
- `/var/tmp/proofofwork-ui-q16-v7-preactivation-a007263-final`:
  - 183M.
  - Existing UI prune job retained it as an unmarked cleanup candidate.
- `/var/www/*.pre-rollback-current-20260825T134644Z`:
  - About 14 surface roots, about 13M each.
  - Candidate only if rollback/provenance policy says they are superseded.
- `/var/backups/proofofwork-ui/releases` and `rollbacks`:
  - 1.8G and 2.4G.
  - Preserve unless a release-retention pass confirms they exceed required
    rollback/evidence coverage.

## Recommended Follow-Up Scope

Recommended first fix set:

- Fix the ID full audit accepted-event hash field so post-activation accepted
  events carry `protocolPayloadSha256` for the Core comparison.
- Investigate and fix the ID audit transition-chain gap at height `960601`.
- Fix fresh Log pending-total parity so relational Log and canonical summary
  agree on the 29-vs-28 pending item at snapshot
  `c8c25473ad34ae64406a8d16`.
- Decide whether compact marketplace summary must include
  `token.listingAuthority`, or update the regression contract if only the
  complete paginated listings route is meant to carry Core sale-ticket
  authority.
- Restore `indexer:parity` to green after the above issues.

Recommended operations set:

- Run the documented node release-prune workflow after verifying active
  release/rollback archive coverage, to reduce `/opt` checkout count and clear
  release-health.
- Fix active `/opt/proofofwork-api/.git/index` mode so release attestation is
  accepted.
- Review PostgreSQL backup retention for 123G logical and 59G physical backups.
- Review whether UI deploy scratch in `/var/tmp/proofofwork-deploy` can be
  pruned after current release provenance is locked in.
- Keep watching `/data` until it drops below warning or capacity is expanded.

## Bottom Line

The production application is serving and the confirmed ledger/math checks are
green, but the strict audit layer is doing its job and failing closed on
several important proof surfaces. The most urgent correctness work is ID audit
replay/fence, fresh Log pending parity, marketplace summary authority proof,
and the parity gate. The most urgent ops work is node `/data` runway and node
release-health cleanup.

---

# Second Read-Only Computer Audit Addendum

Date: 2026-08-28
Audit window: about 2026-08-28T13:05Z through 2026-08-28T13:51Z
Mode: read-only production audit, appended after explicit user approval
Status: public application online, core ledger/math mostly healthy, strict ID
and marketplace authority proofs still failing

## Second Scope

The second pass audited the public surfaces in the requested order:

1. `proofofwork.me` home page
2. `id.proofofwork.me`
3. `desktop.proofofwork.me`
4. `browser.proofofwork.me`
5. `amo.proofofwork.me`
6. `credit.proofofwork.me`
7. `wallet.proofofwork.me`
8. `work.proofofwork.me`
9. `infinity.proofofwork.me`
10. `inception.proofofwork.me`
11. `log.proofofwork.me`
12. `growth.proofofwork.me`
13. `computer.proofofwork.me`

No production files, production config, database rows, services, commits,
pushes, deploys, or cleanup actions were changed during this pass.

## Updated Checkpoint

- Full node/API/index checkpoint: block `964441`.
- Full node/API/index block hash:
  `00000000000000000000bff898ec951dfeb7ccb6ff26d83cb456fd60dd2a9438`.
- Public `/health/live`: `ok: true`, `ready: true`, node/electrum/database/
  worker OK, lag `0`.
- Canonical summary snapshot:
  `8682bdea3ec90b4b11e38dd8`.
- Summary generated/indexed at:
  `2026-08-28T12:51:40.354Z`.

The full node is synced on mainnet with blocks and headers at `964441`,
`initialblockdownload: false`, `pruned: false`, and verification progress `1`.
The API checkpoint hash matches `bitcoin-cli getblockhash 964441`.

## Public Surface Health

All requested public surfaces returned a `200` HTML shell and their route entry
assets loaded successfully. The bare home domain redirects to
`https://www.proofofwork.me/`, which returned `200`.

All public route shells share the same hardened static asset policy:

- HTML: `cache-control: no-cache, must-revalidate`.
- Versioned JS/CSS assets: immutable one-year cache headers.
- Security headers present: HSTS, CSP, `x-content-type-options: nosniff`,
  `x-frame-options: DENY`, strict referrer policy, and permissions policy.

The route entry asset hashes observed during the second pass were:

- Home: `/assets/index-BvAkfubT.js`
- ID: `/assets/index-BSfAONxb.js`
- Desktop: `/assets/index-Dkhdzjvu.js`
- Browser: `/assets/index-CYN5Ax5l.js`
- AMO: `/assets/index-D6jK24hl.js`
- Credit: `/assets/index-CrNyAhk4.js`
- Wallet: `/assets/index-N4XLjpQL.js`
- WORK: `/assets/index-BY72K48G.js`
- Infinity: `/assets/index-nqJP2zGZ.js`
- Inception: `/assets/index-CUfEnywW.js`
- Log: `/assets/index-CxypIuf-.js`
- Growth: `/assets/index-DqtQs3th.js`
- Computer: `/assets/index-Aa8Qp1rb.js`

The in-app browser connector had no active browser sessions available. A
separate Playwright browser regression was run outside the sandbox and passed:
`23 passed`.

## Updated Verification Matrix

Passed in the second pass:

- `npm run check:ui`
- `npm run check:api-truth`
- `npm run check:live-data`
- `npm run check:work-precision`
- `npm run check:bond-exact-arithmetic`
- `npm run check:work-amo-v8`
- Production `npm run check:credit-mint-regressions`
- Production `npm run check:marketplace-regressions` fast mode
- Production `npm run audit:ledger`
- Production `npm run check:mail-regressions`
- `npm run check:id-audit`
- `npm run check:ui:browser` outside the sandbox
- Public `/api/v1/consistency?network=livenet&fresh=1`

Still failing or incomplete:

- Production full `check:marketplace-regressions` fails because
  `marketplace-summary` lacks a complete stable-tip Core sale-ticket authority
  proof.
- Production `npm run audit:ids` fails closed on the internal ID registry audit
  coverage endpoint.
- Production `indexer:parity` exits nonzero around historical WORK AMO V5
  readiness and relational token-state parity.

The earlier fresh Log mismatch recovered in the second pass. Public
`/api/v1/log?network=livenet&fresh=1` returned the current snapshot at block
`964441`, total `24395`, pending `28`, with no missing log events reported by
the consistency endpoint.

## Data and Math Health

The public consistency endpoint is green at block `964441` with
`missingLogEvents: []`.

Second-pass consistency counts:

- PowIDs: `503`.
- Activity/log items: `24395`.
- Confirmed tokens: `238`.
- Confirmed token definitions: `238`.
- Confirmed token mints: `21873`.
- Confirmed token sales: `56`.
- Confirmed token transfers: `191`.
- Confirmed Computer actions: `24367`.
- Network value:
  `7466952437960357000` in the consistency payload.

WORK math stayed exact across the live routes:

- WORK token id:
  `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`.
- Confirmed WORK supply: `21000000`.
- Pending WORK supply: `0`.
- Confirmed WORK subatoms: `210000000000000000000000`.
- Unit scale: `10000000000000000`.
- Precision model: `canonical-work-subatoms-v2`.
- Amount storage model: `work-subatoms-v2`.
- WORK floor exact:
  `355569163712.3979269`.
- WORK network value exact:
  `7466952437960356465.00256356`.
- WORK floor Q8:
  `35556916371239792690`.
- WORK network value Q8:
  `746695243796035646500256356`.
- Miner-fee coverage: complete, `24367` confirmed events covered and zero
  missing transactions.

Credit mint regression passed:

- POW: `1,525,100 / 10,101,010` confirmed, `0` pending,
  `8,575,910` available.
- WORK: `21,000,000 / 21,000,000` confirmed, `0` pending.

Bond math stayed coherent:

- Infinity/POWB supply: `630196569`.
- POWB network value: `630200391` proofs.
- POWB floor: `1.00000606` proofs.
- Inception/INCB supply:
  `224847713398447926`.
- INCB network value:
  `224847713398447947.9358206` proofs.
- INCB floor: `1` proof.

## ID Audit Status

The lightweight ID registry audit contract passed.

The heavy production ID registry audit still fails closed through the internal
coverage endpoint:

- Endpoint:
  `/api/v1/internal/id-registry-audit?network=livenet`.
- HTTP status: `503`.
- Failing txid:
  `a1a58faef3a6ece598a5efb34545ee098cc09a2739cd68d458eafc6bc1e1f9dc`.
- Position: block `960117`, block index `2174`, protocol vout `1`, record
  ordinal `0`.
- Error:
  `Accepted post-activation ID lifecycle event ... diverges from Core.`

Full-node verification confirms the transaction is real and confirmed. Core
shows:

- Registry payment output: vout `0`, value `1000`, address
  `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e`.
- OP_RETURN output: vout `1`, payload begins `pwid1:r2`.
- Change/owner output: vout `2`, address
  `1AcH1HwHCg4ggiBj4NJSqZ9SPGwSyRBSKs`.

Public API rendering for the same tx currently shows a confirmed
`id-register` for `grahamnazareth` with owner and receiver
`1AcH1HwHCg4ggiBj4NJSqZ9SPGwSyRBSKs`, amount `1000`, at the same block
position. The visible rendering therefore appears sane, but the strict
post-activation Core/replay binding proof refuses to certify it. This remains
critical until the audit gate is green.

## Marketplace and Wallet Status

Fast marketplace regression passed for production. Wallet-scoped checks passed,
including legacy WORK inventory exclusion, canonical multi-anchor closure
preservation, disabled legacy sealed WORK inventory, and Carbonz delayed WORK
transfer recovery.

Full marketplace regression still fails because compact
`/api/v1/marketplace-summary` does not expose a complete stable-tip Core
sale-ticket authority proof. Complete token-history listing routes do expose
listing authority.

Observed WORK listing authority route:

- Endpoint:
  `/api/v1/token-history?...asset=<WORK>&kind=listings&fresh=1`.
- Listing authority: `true`.
- Authority model:
  `proof-token-market-core-gettxout-v1`.
- Checkpoint: block `964441`, hash
  `00000000000000000000bff898ec951dfeb7ccb6ff26d83cb456fd60dd2a9438`.
- Checked listing count: `410`.
- Unspent listing count: `297`.
- Spent listing count: `113`.
- Buyable candidate count: `319`.

One sampled WORK sale-ticket output was verified directly with the full node:

- Listing txid:
  `00d3515c7f80413293649696db4fd26c27cda12c2068be00d22ba9ed43ff1643`.
- Seal txid:
  `30cbba4211eb7500d87e7d9971a925223790d2e80448710ead9ef5792a1cfdaf`.
- Sale-ticket outpoint:
  `f1bf5c4120090931e1a711e34b56fd2cfd02c90537cf1a93bdd015d94863ecd4:2`.
- Core `gettxout`: unspent, value `546`.

The API still reports some listings as `status: "sealing"` even when
`sealConfirmed: true` and the sale-ticket output is unspent. Current UI gating
appears to use `sealConfirmed`, so this did not present as a purchase-gating
break in the browser tests. It should still be normalized because status
labels and filters can become user-facing correctness issues.

## WORK AMO V8 Status

`npm run check:work-amo-v8` passed.

Observed V8 declarations and gates:

- Declaration txid:
  `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a`.
- Declaration block: `960600`.
- Activation height: `960601`.
- Registry payment: `546`.
- Payload SHA-256:
  `1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528`.
- Writes enabled: true.
- Protocol writes enabled: true.
- Settlement writes enabled: true.
- Write admission: true.
- Version: `pwt-sale-v8`.
- Amount field: `unitAmountSubatoms`.
- Subatoms per WORK: `10000000000000000`.
- Ordering:
  `block-height/transaction-index/protocol-vout/record-ordinal`.

Production parity still shows historical V5 readiness issues:

- `migrationReady: false`.
- `quoteReady: false`.
- `requestedTipReady: false`.
- `relationalTokenState.complete: false`.
- Reason:
  `work-amo-v5-token-state-supply-invalid`.
- Listing reasons:
  `canonical-tip-not-current`, `migration-not-complete`,
  `usd-quote-head-missing`.

This is not a V8 outage by itself, but it keeps the full parity gate red and
should be fixed or explicitly qualified as historical.

## Second Storage and Database Pass

UI VPS:

- Host: `ubuntu-4gb-hel1-1`.
- Root filesystem: 38G size, 13G used, 23G available, 36% used.
- Inodes: 5% used.
- Failed systemd units: none.
- `caddy`: active.
- Journals: 220.9M.

Node VPS:

- Host: `pow-bitcoin-01`.
- Root filesystem: 98G size, 31G used, 63G available, 34% used.
- `/data`: 1.7T size, 1.3T used, 324G available, 80% used.
- `/data` inodes: 1% used.
- Journals: 932.3M.
- `proofofwork-api`, `bitcoind`, `electrs`, and `postgresql`: active.

Node database sizes:

- `proof_indexer_fault_reorg_20260826t2342z`: 26G.
- `proof_indexer`: 16G.
- `proof_indexer_pre_rollback_current_20260825T140941Z`: 14G.
- `proof_indexer_fault_20260816t171442`: 14G.
- `proof_indexer_rollback_20260711_final`: 3545M.
- `proof_indexer_large_state_v1` tablespace: 68G.
- `pg_default` tablespace: 7972M.

Large `/data` consumers in the second pass:

- `/data/bitcoin`: 904G.
- `/data/proofofwork-postgres-backups`: 193G.
- `/data/proofofwork-postgres-tablespaces`: 69G.
- `/data/electrs`: 60G.
- `/data/proofofwork-release-backups`: 7.5G.
- `/data/proofofwork-recovery`: 3.6G.
- `/data/mempool`: 1.3G.
- `/data/proofofwork-api-cache`: 168M.

Node failed units still present:

- `proofofwork-api-candidate-93f085b.service`.
- `proofofwork-node-release-health.service`.
- `proofofwork-node-storage-health.service`.
- `proofofwork-recovery-parity.service`.
- `proofofwork-recovery-snapshot.service`.
- `proofofwork-reorg-restore-20260826.service`.

These failures do not currently mean the live API/node/indexer are down, but
they make operational health noisy and should be retired, reset, or fixed only
after their evidence value is classified.

## Second-Pass Cleanup Candidates

No cleanup was performed.

Additional cleanup candidates observed in the second pass:

- Node `/opt/proofofwork-api-stage-*` and rollback checkouts from recent
  deployments.
- Node historical/fault/rollback PostgreSQL databases.
- Node `/data/proofofwork-postgres-backups`, now about `193G`.
- Node `/data/proofofwork-release-backups`, about `7.5G`.
- Node `/data/proofofwork-recovery`, about `3.6G`.
- UI `/var/tmp/proofofwork-deploy`, about `3.5G`.
- UI `/var/backups/proofofwork-ui`, about `5.1G`.

None should be deleted without an explicit retention decision. Old is not
stale when it preserves protocol replay, recovery, audit evidence, release
provenance, or rollback ability.

## Second-Pass Recommendations

Priority correctness fixes:

- Fix the strict ID registry audit divergence for tx
  `a1a58faef3a6ece598a5efb34545ee098cc09a2739cd68d458eafc6bc1e1f9dc`
  so the post-activation row is exactly bound to Core carrier bytes and
  raw-block replay metadata.
- Make `marketplace-summary` carry the same stable-tip Core sale-ticket
  authority proof as the complete listing-history routes, or make the summary
  fail closed until that proof is present.
- Normalize listing lifecycle status so confirmed seals with unspent
  sale-ticket outputs do not remain ambiguously labeled as `sealing`.
- Restore full `check:marketplace-regressions`, `audit:ids`, and
  `indexer:parity` to green before calling the Computer fully hardened.

Priority speed and data-handling upgrades:

- Materialize summary-level authority proofs and exact-tip coverage proofs so
  public summary routes do not wait on heavyweight recomputation under load.
- Revisit `ENABLE_SUMMARY_TOKEN_REFRESH=0` and the summary fresh wait/hard-cap
  values; recent logs showed fresh-summary fallback behavior while complete
  exact-tip data existed elsewhere.
- Keep detailed listing authority and wallet spendability proofs on the
  complete routes, but expose summary completeness flags so UI surfaces can
  clearly label preview data versus certified executable state.
- Add explicit monitors for `/data` crossing 75%, failed historical units,
  marketplace summary authority absence, ID audit 503s, and parity nonzero
  exits.

Priority storage hardening:

- Draft a retention policy for PostgreSQL logical/physical backups, recovery
  evidence, release backups, stage checkouts, and UI deploy scratch.
- Prune only after proving active release provenance, rollback coverage,
  latest verified backups, and audit evidence preservation.
- Keep node `/data` below warning threshold or expand capacity before it
  approaches the API hard limit.

## Second-Pass Bottom Line

The Computer is online and the main public surfaces load. The current full
node, indexer, public consistency endpoint, ledger/math checks, WORK precision,
bond exact arithmetic, credit mint checks, mail checks, fast marketplace checks,
and browser regression are green.

It is not yet in its fastest, most accurate, fully hardened state. The strict
ID audit proof, compact marketplace authority proof, historical V5 parity, and
node `/data` runway remain the main blockers.

## Approved Local Remediation Prepared

Date: 2026-08-28
Mode: local code/docs preparation only
Production status: no production files, config, services, storage, commits,
pushes, or deploys changed by this remediation pass

Prepared local fixes:

- The strict ID raw replay projection now emits Core-bound payload byte count
  and payload SHA-256 fields, so the audit comparison can verify the accepted
  event against the exact OP_RETURN carrier instead of failing on missing
  projection metadata.
- Compact marketplace summaries can now preserve stable-tip Core
  `listingAuthority` evidence after active-listing reconciliation, and the
  fast immutable-snapshot overlay derives a new snapshot identity when that
  authority proof is attached.
- Credit/WORK/bond listing rows now carry an additive `saleTicketStatus`
  (`sealed`, `seal-pending`, or `unsealed`) derived from the authoritative
  seal rank. This keeps UI/API consumers from treating a confirmed sealed,
  still-open sale-ticket listing as ambiguous just because the historical
  lifecycle `status` text remains `sealing`.
- Scoped token summaries no longer fail immediately when a stored canonical
  hash-bound token summary is absent. They fall through to the exact
  proof-index/current canonical read path or the existing canonical fallback,
  preserving fail-closed behavior only when all authoritative sources are
  unavailable.
- Regression contracts were extended for the ID raw replay fields, marketplace
  summary authority proof retention, scoped token-summary fallback, and
  sale-ticket status normalization.

Local verification completed:

- `node --check server/proof-api.mjs`
- `node --check server/db/proof-index-reader.mjs`
- `node --check scripts/check-id-registry-audit.mjs`
- `node --check scripts/check-live-data-contract.mjs`
- `node --check scripts/check-index-recovery-behavior.mjs`
- `npm run check:id-audit`
- `npm run check:live-data`
- `npm run check:index-recovery-behavior`
- `npm run check:api-truth`
- `npm run check:ui`
- `npm run check:work-precision`
- `npm run check:bond-exact-arithmetic`
- `npm run check:hardening`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- `npm run check:work-amo-v8`
- `npm run build`

Known production gates still require an approved execution step because the
local patch has not been committed, pushed, deployed, or verified on the
production node:

- Production `audit:ids`.
- Production full `check:marketplace-regressions`.
- Production `check:credit-mint-regressions`.
- Production `indexer:parity`.
- Node release-health and storage-health remediation.
- Any production cleanup of backups, stage checkouts, recovery evidence,
  release archives, scratch directories, or failed historical units.

No storage deletion is approved by this entry. Cleanup remains a separate
classification and command-approval step.

## Approval-Gated Execution Plan

The next execution steps are intentionally split so each production-impacting
action can be approved separately.

### Step 1: Commit and push the reviewed local fix

Not yet approved or executed.

```bash
git status --short
npm run hygiene:fix
npm run hygiene:check
git diff --check
git add \
  server/proof-api.mjs \
  server/db/proof-index-reader.mjs \
  src/App.tsx \
  scripts/check-id-registry-audit.mjs \
  scripts/check-live-data-contract.mjs \
  scripts/check-index-recovery-behavior.mjs \
  repository-hygiene.json \
  audits/2026-08-28-production-health-data-event-audit.md
git commit \
  -m "Fix production audit proof and summary regressions" \
  -m "Hygiene: npm run hygiene:fix; npm run hygiene:check" \
  -m "Deletion-attestation: no files deleted"
git push origin main
```

### Step 2: Stage the node/API candidate from the pushed commit

Not yet approved or executed. This changes production storage by creating one
new candidate checkout under `/opt`, but does not swap or restart services.

```bash
release_commit="$(git rev-parse HEAD)"
git cat-file -e "${release_commit}^{commit}"
release_id="${release_commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
printf 'release_commit=%s\nrelease_id=%s\n' "${release_commit}" "${release_id}"

ssh root@65.108.122.87 "
set -Eeuo pipefail
umask 077
release_commit='${release_commit}'
release_id='${release_id}'
stage_checkout=\"/opt/proofofwork-api-stage-\${release_id}\"
test ! -e \"\${stage_checkout}\"
git clone --quiet https://github.com/proofofworkme/ProofOfWork.Me.git \"\${stage_checkout}\"
git -C \"\${stage_checkout}\" checkout --quiet --detach \"\${release_commit}\"
test \"\$(git -C \"\${stage_checkout}\" rev-parse HEAD)\" = \"\${release_commit}\"
cd \"\${stage_checkout}\"
/opt/node-v24.18.0-linux-x64/bin/npm ci --ignore-scripts --no-audit --no-fund
test -z \"\$(git -C \"\${stage_checkout}\" status --porcelain --untracked-files=all)\"
chown --recursive --no-dereference powadmin:powadmin \"\${stage_checkout}\"
chmod --recursive go-w \"\${stage_checkout}\"
chmod --reference=/opt/proofofwork-api \"\${stage_checkout}\"
"
```

### Step 3: Atomically publish the node/API candidate

Not yet approved or executed. This stops and restarts live production services.

```bash
ssh root@65.108.122.87 "
set -Eeuo pipefail
umask 077
release_commit='PASTE_RELEASE_COMMIT_FROM_STEP_2'
release_id='PASTE_RELEASE_ID_FROM_STEP_2'
live_checkout=/opt/proofofwork-api
stage_checkout=\"/opt/proofofwork-api-stage-\${release_id}\"
request=\"/var/tmp/proofofwork-deploy/proofofwork-node-release-\${release_id}.tgz\"

test -d \"\${live_checkout}\" && test ! -L \"\${live_checkout}\"
test -d \"\${stage_checkout}\" && test ! -L \"\${stage_checkout}\"
systemctl stop proofofwork-api-wg.socket
systemctl stop proofofwork-api-wg.service || true
systemctl stop proofofwork-indexer-worker.service
systemctl stop proofofwork-api.service
systemctl stop 'proofofwork-api-candidate-*.service' || true
if ss -H -ltnp 'sport = :8081' | grep -q .; then
  echo 'API listener still active on :8081 after stop.' >&2
  exit 1
fi
sync --file-system \"\${live_checkout}\"
sync --file-system \"\${stage_checkout}\"
/usr/local/sbin/proofofwork-node-release-exchange --release-id \"\${release_id}\"
test \"\$(git -C \"\${live_checkout}\" rev-parse --verify HEAD^{commit})\" = \
  \"\${release_commit}\"
install -d -o root -g root -m 0700 /var/tmp/proofofwork-deploy
: >\"\${request}\"
chmod 0600 \"\${request}\"
/usr/local/sbin/proofofwork-node-release-publish \"\${request}\"
systemctl start proofofwork-api.service
systemctl start proofofwork-indexer-worker.service
systemctl start proofofwork-api-wg.socket
systemctl is-active proofofwork-api.service proofofwork-indexer-worker.service proofofwork-api-wg.socket
"
```

### Step 4: Production verification after node/API publish

Not yet approved or executed. These commands are read-only, but they touch
production APIs and the node host.

```bash
ssh root@65.108.122.87 "
set -Eeuo pipefail
cd /opt/proofofwork-api
set -a
. /etc/proofofwork-api/proof-indexer-db.env
. /etc/proofofwork-api/internal-verifier.env
set +a
curl -fsS http://127.0.0.1:8081/health/live >/tmp/proofofwork-health-live.json
POW_ID_AUDIT_API_BASE=http://127.0.0.1:8081 \
POW_ID_AUDIT_ADDRESS_API_BASE=http://127.0.0.1:8081 \
POW_ID_AUDIT_PRODUCTION=1 \
POW_ID_AUDIT_RETRIES=1 \
  /opt/node-v24.18.0-linux-x64/bin/npm run audit:ids
POW_API_BASE=http://127.0.0.1:8081 \
MARKETPLACE_REGRESSION_MODE=full \
  /opt/node-v24.18.0-linux-x64/bin/npm run check:marketplace-regressions
POW_API_BASE=http://127.0.0.1:8081 \
  /opt/node-v24.18.0-linux-x64/bin/npm run check:credit-mint-regressions
POW_API_BASE=http://127.0.0.1:8081 \
POW_INDEX_FETCH_TIMEOUT_MS=180000 \
POW_INDEX_FETCH_RETRIES=8 \
  /opt/node-v24.18.0-linux-x64/bin/npm run indexer:parity
"

POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions:full
POW_API_BASE=https://credit.proofofwork.me npm run check:credit-mint-regressions
curl -fsS https://computer.proofofwork.me/health/live >/tmp/proofofwork-public-health-live.json
```

### Step 5: UI release decision

No UI release is required for the server-side production regression fixes. The
only UI-file change is an additive TypeScript field declaration for
`saleTicketStatus`, which is erased at build time. If a source-aligned UI
release is desired anyway, use the canonical 13-surface UI release procedure in
`OP_RETURN_INFRASTRUCTURE.md` from the same committed `main` revision. That
procedure writes under `/var/tmp/proofofwork-deploy`,
`/var/backups/proofofwork-ui/releases`, and `/var/www`.

### Step 6: Read-only cleanup discovery

Not yet approved or executed. This does not delete anything.

```bash
ssh root@65.108.122.87 "
set -Eeuo pipefail
df -h / /data
df -ih / /data
du -sh \
  /data/proofofwork-postgres-backups \
  /data/proofofwork-postgres-backups/* \
  /data/proofofwork-release-backups \
  /data/proofofwork-release-backups/* \
  /data/proofofwork-recovery \
  /data/proofofwork-api-cache \
  /opt/proofofwork-api \
  /opt/proofofwork-api-stage-* 2>/dev/null | sort -h
systemctl --failed --no-pager
"

ssh root@77.42.91.106 "
set -Eeuo pipefail
df -h /
df -ih /
du -sh \
  /var/tmp/proofofwork-deploy \
  /var/backups/proofofwork-ui \
  /var/backups/proofofwork-ui/* \
  /var/www \
  /var/www/proofofwork-* 2>/dev/null | sort -h
/usr/local/sbin/proofofwork-ui-storage-prune --dry-run
systemctl --failed --no-pager
"
```

### Step 7: Cleanup application

Not yet prepared for execution. After Step 6, classify each candidate as one of
`active`, `rollback`, `audit evidence`, `recovery evidence`, `latest verified
backup`, `release provenance`, or `rebuildable scratch`. Only after that
classification should deletion or `systemctl reset-failed` commands be drafted
with literal paths and service names.
