# ProofOfWork.Me Production Health, Data, Event, and Storage Audit 2

Date: 2026-08-31
Audit window: about 2026-08-31T16:00Z through 2026-08-31T17:20Z
Mode: read-only production audit, followed by this approved local audit log
Status: serving healthy and exact-tip overall; two correctness hardening fixes recommended before calling it all-green

## Scope

This audit checked the public application surfaces, the production node/API VPS,
the UI VPS, Bitcoin Core, mempool status, PostgreSQL, public/loopback API
health, Log/event coverage, ID registry parity, marketplace/wallet/listing
behavior, mail behavior, exact arithmetic contracts, and retained storage.

No production files, production config, database rows, services, commits,
pushes, deployments, or storage objects were intentionally changed. A large
proof-index parity JSON result was captured only to local `/tmp` for
summarization.

## Executive Summary

The application is healthy at the infrastructure and canonical-ledger level:

- All requested public surfaces returned HTTP 200:
  `proofofwork.me`, `id`, `desktop`, `browser`, `amo`, `credit`, `wallet`,
  `work`, `infinity`, `inception`, `log`, `growth`, and
  `computer.proofofwork.me`.
- Bitcoin Core was synced on mainnet, unpruned, not in IBD, and exact with the
  API/indexer checkpoints during the final health samples.
- Public `/api/v1/health` and `/api/v1/consistency?network=livenet` were green
  and exact-tip at block `964912`; the computer-event audit later passed at
  block `964914`.
- Public consistency reported `missingLogEvents: []`.
- Direct fresh Log verification confirmed summary, paginated Log, full Log, and
  exact-txid lookup on the same snapshot and block, with complete miner-fee
  coverage.
- Ledger, live data, hardening, UI, node ops, UI ops, mail, ID registry, proof
  index parity, and computer-event audits passed at error severity.
- Node and UI storage are no longer near-full: node `/data` was 71% used with
  453G available; UI `/` was 26% used with 27G available.
- Recent warning-or-higher journals were clean for API, indexer, PostgreSQL,
  Bitcoin Core, electrs, Caddy, and UI storage/release units since
  2026-08-31T16:00Z.

Two issues keep this from being perfect:

- A full marketplace regression found an intermittent wallet fresh-read
  rendering bug: one fresh wallet-scoped WORK token read returned
  `closedListingsCount: 0` for the Carbonz taproot listing address at block
  `964912`, while four immediate retries at the same block returned the correct
  3 closed listings, including listing
  `9cbaf52ddb244d228204d841342b126dc8801a987626d0a05d82d5e1af2c1bc3` closed
  by `bcacff05f33c248008073a01f0c37222cf01299a742afc68f49d0a1d479a8525`.
- The production WORK atom audit failed on exactly three confirmed invalid zero
  V8 seal rows missing exact Q16 amount metadata. These rows are invalid audit
  records with `amount: 0` and `amountSats: 0`, not valid spendable/sale/mint
  value rows, but the precision audit correctly refuses to call Q16 storage
  perfect until they carry exact `amountSubatoms: "0"` metadata or are otherwise
  canonically repaired.

## Verification Matrix

Passed:

- `npm run check:work-precision-v2`
- `npm run check:bond-exact-arithmetic`
- `npm run check:live-data`
- `npm run check:hardening`
- `npm run check:ui`
- `npm run check:node-ops`
- `npm run check:ui-ops`
- Production `POW_API_BASE=https://computer.proofofwork.me npm run audit:ledger`
- Production `POW_API_BASE=https://computer.proofofwork.me npm run check:mail-regressions`
- Production fast `POW_API_BASE=https://computer.proofofwork.me npm run check:marketplace-regressions`
- Production internal ID registry audit with Node 24
- Production proof-index parity with Node 24: `ok: true`, 102 checks, 0
  failed error checks, 3 warning checks
- Production computer-event audit with Node 24: `ok: true`, warnings empty

Failed or warning:

- `npm run check:api-truth` failed two local static assertions about fresh Log
  route/source binding. Direct live Log verification and source inspection
  showed the runtime route is binding fresh full/paginated Log reads to exact
  summary state, so this is tracked as a stale guardrail/test issue rather than
  observed production drift.
- Production full marketplace mode failed once on wallet-scoped closed-listing
  visibility for the Carbonz taproot listing address. Repeated read-only probes
  reproduced one missing response followed by four correct responses at the
  same block, so this is a real fresh-read projection flicker.
- Production `indexer:audit-work-atoms` failed because 3 invalid zero
  `token-listing-sealed-invalid` rows are missing exact Q16 precision fields.
- Proof-index parity warning checks:
  `work-amo-v5-migration`, `work-amo-v5-usd-quote-head`, and
  `marketplace-summary-snapshot-parity`.

## Public Checkpoint

Representative final public health sample:

- `/api/v1/health?network=livenet`: `ok: true`, `ready: true`.
- Indexed-through block: `964912`.
- Node tip height: `964912`.
- Lag blocks: `0`.
- Checkpoint/source hash:
  `000000000000000000004dc77912e5f5dc9d5e60fdb738d81a4deb418e8a806b`.
- Summary snapshot: `e6634499da9a81a8efcbfd2c`.
- Summary coverage: growth, inception, infinity, Log, marketplace, token,
  work-floor, and work-summary all at block `964912`.
- Worker: `ok: true`, phase `idle`, pending health `ok: true`,
  `globalUnresolved: 0`, `q16PendingUnresolved: 0`, `staleCandidates: 0`.

Representative final consistency sample:

- `/api/v1/consistency?network=livenet`: `ok: true`.
- Indexed-through block: `964912`.
- Snapshot: `e6634499da9a81a8efcbfd2c`.
- Missing Log events: `0`.
- Confirmed canonical activity count matched public Log.
- Inception issuance, infinity supply, WORK floor, growth totals, marketplace
  mutation fees, credit live/frozen value, token events, token sales, seeded
  mail, inception bonds, and infinity bonds all reconciled.

## Log and Event Health

Direct fresh Log probe at block `964909`:

- Log summary snapshot: `6f807cbee08304c58f0617a1`.
- Full fresh Log snapshot: `6f807cbee08304c58f0617a1`.
- Paginated fresh Log snapshot: `6f807cbee08304c58f0617a1`.
- Total count: `24707`.
- Full item count: `24707`.
- Pending visible events: `3`.
- Confirmed events with miner-fee coverage: `24704 / 24704`.
- Exact txid lookup for
  `ffcd3ac0b82680919c1cdb6b1bfc3913c81d2ceedd2696d81561848e19dd3432`
  returned one item on the same snapshot.

Production proof-index parity at block `964912`:

- Transactions: 24,629 total; 24,375 confirmed; 15 pending; 239 dropped.
- Events: 25,249 total; 25,036 confirmed; 15 pending; 198 dropped.
- Confirmed valid events: 24,708.
- Pending valid events: 3.
- Confirmed transactions without canonical block proof: 0.
- Confirmed activity txids missing transactions: 0.
- Confirmed events without parent metadata: 0.
- Event payload status mismatches: 0.
- Event refs: 51,915.
- Event participants: 123,738.
- Credit definitions confirmed: 238.
- Credit balances: 398.
- Credit listings: 593.
- ID records: 504.

Computer-event audit at block `964914`:

- Confirmed canonical action txids: 24,085.
- Confirmed computer actions/events: 24,715.
- Confirmed transactions: 24,381.
- Confirmed events missing transaction row: 0.
- Confirmed events without confirmed transaction: 0.
- Confirmed events missing raw transaction/payload: 0.
- Confirmed transactions missing raw transaction: 0.
- Confirmed transactions missing block metadata: 0.
- Recent confirmed transactions missing block metadata: 0.
- OP_RETURN rows: 24,503.

Recent log scan:

- API/indexer warnings since 2026-08-31T16:00Z: none.
- PostgreSQL warnings since 2026-08-31T16:00Z: none.
- Bitcoin Core/electrs warnings since 2026-08-31T16:00Z: none.
- Caddy/UI storage/release warnings since 2026-08-31T16:00Z: none.

## Math and Ledger Health

Local exact-math contracts passed:

- WORK Precision Protocol V2 contract.
- Bond exact-arithmetic contract.
- Live data contract.
- Hardening, UI, node-ops, and UI-ops contracts.

Production ledger consistency passed:

- Snapshot: `30b3b0223a9abe9501503f16`.
- Value:
  `7466952437985133429.00031206` proofs.

Production consistency later reported:

- WORK actual/network value:
  `7466952437985222000` sats at block `964912`.
- Growth actual/work-floor values matched WORK.
- Marketplace mutation fees counted:
  `670488` sats.
- Marketplace value included mutation fees.
- Computer event flow excluded marketplace mutation fees.
- Credit frozen value included event components.
- Credit live value matched active network value.
- Inception fixed/live issuance reconciled.
- Infinity bond flow matched POWB supply.

The WORK atom audit failure is limited to these three invalid zero rows:

- `6ac53aca33541d60d6d58af03d4c27d09bbeaab3e3c016ee10d270aad578957c`,
  block `962946`, `token-listing-sealed-invalid`,
  `work-amo-v6-listing-already-sealed`, `pwt-sale-v8`.
- `8eaa4098c631bded37ce40d88778cce53a6d00b2d4f3eb783d2b9713fc9951cc`,
  block `963019`, `token-listing-sealed-invalid`,
  `work-amo-v6-listing-already-sealed`, `pwt-sale-v8`.
- `9e202c0fae0f3ab500325fc7a5326dda1d68c8500c85fe51cb18385e7d8aeab0`,
  block `963517`, `token-listing-sealed-invalid`,
  `work-amo-v6-listing-already-sealed`, `pwt-sale-v8`.

They are invalid zero audit records, but because math is a hard public function,
they should be normalized with the existing precision repair path and then
re-audited.

## ID Registry Health

Production internal ID registry audit passed:

- Registry address:
  `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e`.
- Fetched transactions: 561.
- Covered confirmed registry transactions: 559.
- Covered pending registry transactions: 2.
- Canonical lifecycle parity: verified against exact Core-ordered chain replay.
- Lifecycle events: 533.
- Active listings: 5.
- Canonical sales: 4.
- Registration attempts: 523.
- Confirmed winners: 504.
- Pending candidates: 2.
- Refund candidates: 17.
- Pending watchlist: 0.

The refund candidates are accounted for and should be preserved as recovery and
accountability evidence unless a separate refund workflow is approved.

## Marketplace and Wallet Health

Fast marketplace regressions passed against production:

- ID lookup.
- WORK AMO V2/V5/V6/V8 cutover and write gates.
- Listing lifecycle.
- Active and closed WORK listing truth.
- Seller wallet legacy inventory exclusion.
- Canonical multi-anchor wallet closures.
- Legacy sealed inventory disabling.
- Carbonz delayed WORK transfer wallet recovery.
- Marketplace summary active book contract.

Full marketplace mode found one intermittent wallet projection failure:

- Address:
  `bc1parjksvz4hetpmqwtka9wuzl9skhq8y3weusenf8e3qrguqhypweqtpmz2g`.
- Listing:
  `9cbaf52ddb244d228204d841342b126dc8801a987626d0a05d82d5e1af2c1bc3`.
- Close:
  `bcacff05f33c248008073a01f0c37222cf01299a742afc68f49d0a1d479a8525`.
- One fresh wallet read at block `964912` and snapshot
  `e6634499da9a81a8efcbfd2c` returned `closedListingsCount: 0`.
- Four immediate retries at block `964912` and snapshot
  `2fff8d03ee9aacfb51cc314d` returned `closedListingsCount: 3` and the correct
  closed listing.
- Global closed-listing history, address-scoped closed-listing history, and
  market-log lookup all returned the correct listing/closure.

This points to a fresh wallet-scoped token projection consistency bug, not a
canonical chain/index corruption.

Speed signal:

- One wallet fresh read took about 31 seconds.
- Proof-index parity observed transient retryable 503s for internal
  `registry-parity` and `marketplace-summary` during exact-tip churn.

## Node VPS Storage and Health

Host: `65.108.122.87`.

Final storage sample:

- `/`: 98G size, 19G used, 75G available, 20% used.
- `/data`: 1.7T size, 1.1T used, 453G available, 71% used.
- `/` inodes: 4% used.
- `/data` inodes: 1% used.

Largest `/data` paths:

- `/data/bitcoin`: 905G.
- `/data/proofofwork-postgres-backups`: 114G.
- `/data/electrs`: 60G.
- `/data/proofofwork-postgres-tablespaces`: 18G.
- `/data/proofofwork-release-backups`: 7.1G.
- `/data/proofofwork-recovery`: 3.6G.
- `/data/mempool`: 1.1G.
- `/data/proofofwork-api-cache`: 175M.

Core services were active:

- `postgresql@16-main`.
- `proofofwork-api`.
- `proofofwork-indexer-worker`.
- `bitcoind`.
- `electrs`.
- `pg_receivewal@16-main.service`.

Bitcoin Core sample:

- Chain: main.
- Blocks/headers: `964908`.
- Best block hash:
  `0000000000000000000180ca5790bb33cee274fd65b766e75b47854d9b8a9386`.
- Initial block download: false.
- Pruned: false.
- Verification progress: 1.
- Mempool loaded: true.
- Mempool size: 22,822 txs.
- Mempool usage: about 97MB.
- Full RBF: true.
- Unbroadcast count: 0.

Failed node units still visible:

- `proofofwork-api-candidate-93f085b.service`.
- `proofofwork-node-release-health.service`.
- `proofofwork-recovery-parity.service`.
- `proofofwork-recovery-snapshot.service`.
- `proofofwork-reorg-restore-20260826.service`.

These did not affect serving health during this audit, but they should be
classified and resolved/archived with a separate operations approval.

## PostgreSQL Health and Backups

PostgreSQL cluster:

- Version/cluster: `16 main`.
- Port: `5432`.
- State: online.
- `fsync`: on.
- `full_page_writes`: on.
- `synchronous_commit`: on.
- `wal_level`: replica.
- Replication slot `pg_receivewal_service`: active.
- Data checksums: off.

Largest database tables:

- `work_amo_block_transitions`: about 16G.
- `ledger_snapshots`: about 809M.
- `events`: about 98M.
- `transactions`: about 71M.
- `event_participants`: about 47M.
- `tx_outputs`: about 42M.
- `event_refs`: about 27M.
- `tx_inputs`: about 19M.
- `op_returns`: about 18M.

Backup inventory after retention work:

- Logical retained dumpsets:
  `proof_indexer-20260826T193848Z.dumpset`,
  `proof_indexer-20260826T235127Z.dumpset`,
  `proof_indexer-20260827T031858Z.dumpset`,
  `proof_indexer-20260828T031900Z.dumpset`,
  `proof_indexer-20260829T031856Z.dumpset`,
  `proof_indexer-20260830T031855Z.dumpset`,
  `proof_indexer-20260831T031857Z.dumpset`.
- Preserved recovery-evidence logical dumpset:
  `recovery-evidence/proof_indexer-pitr-20260823T200000Z.dumpset`.
- Physical base backup:
  `2026-08-31T000345Z.backup`.
- Backup footprint:
  logical 58G, physical 47G, recovery evidence 9.6G.

The latest logical backup integrity had already passed `pg_restore --list` and
`sha256sum -c SHA256SUMS` in the preceding retention pass. The next scheduled
logical backup after the `keep=7` change should still be verified after it runs
on 2026-09-01.

## UI VPS Storage and Health

Host: `77.42.91.106`.

Final storage sample:

- `/`: 38G size, 9.2G used, 27G available, 26% used.
- Inodes: 3% used.
- Failed units: none.

Largest `/var` paths:

- `/var/backups`: 6.1G.
- `/var/log`: 584M.
- `/var/tmp`: 433M.
- `/var/www`: 386M.
- `/var/lib`: 219M.
- `/var/cache`: 120M.

Largest UI backup groups:

- `/var/backups/proofofwork-ui`: 5.2G.
- `/var/backups/proofofwork-ui/rollbacks`: 2.7G.
- `/var/backups/proofofwork-ui/releases`: 1.6G.
- `/var/backups/proofofwork-ui/rollback-roots`: 360M.
- `/var/backups/proofofwork-ui/cleanup-evidence`: 161M.

This is healthy and far from the prior full-disk condition.

## Stale or Waste Candidates

No deletion was performed.

Candidates to classify before any cleanup:

- Node `/data/proofofwork-release-backups` at 7.1G.
- Node `/data/proofofwork-recovery` at 3.6G.
- Node small old API cache/restore shadows:
  `/data/proofofwork-api-cache-candidate-4acbde1de362-20260826T090612Z`,
  `/data/proofofwork-api-cache-recovery-20260826T193700Z`,
  `/data/proofofwork-api-cache-restore-shadow-c4d5e9c-retained`,
  `/data/proofofwork-api-cache-restore-shadow-c4d5e9c-retained-norecovery`,
  `/data/proofofwork-api-cache.audit-quarantine-20260810T051400Z`.
- UI `/var/backups/proofofwork-ui/rollbacks` at 2.7G.
- UI `/var/backups/proofofwork-ui/releases` at 1.6G.
- UI `/var/backups/proofofwork-ui/rollback-roots` at 360M.
- UI `/var/tmp` at 433M.

These are not pressure risks today. Recovery evidence, release evidence,
refund evidence, and PITR evidence should be preserved unless a target-specific
cleanup manifest is approved.

## Recommended Fix Order

1. Fix wallet-scoped fresh token projection so closed listings cannot flicker
   under exact-tip snapshot churn. Fresh wallet reads should either return a
   closed-listing set bound to one coherent checkpoint or fail closed with a
   clear stale/catching-up response.
2. Run the existing Q16 invalid-zero precision repair for the three confirmed
   invalid V8 seal rows, then rerun `indexer:audit-work-atoms`,
   proof-index parity, ledger consistency, and marketplace regressions.
3. Update `npm run check:api-truth` so its static Log route assertions match
   the current stable/fresh helper implementation and keep direct fresh
   full/paginated/exact Log coverage.
4. Reduce fresh-read pressure on wallet token and marketplace-summary paths.
   The audit observed a 31s wallet read and retryable 503s during parity.
5. Classify and resolve historical failed node units without clearing evidence:
   old API candidate, release-health, recovery parity, recovery snapshot, and
   reorg-restore units.
6. Verify the first scheduled logical backup after the 7-day retention change
   on 2026-09-01, then decide whether off-host encrypted backups are needed now
   or can stay as planned hardening.
7. Prepare a conservative storage cleanup manifest for release/rollback/cache
   evidence only after the next functional fix pass is shipped and verified.

## Next Approval Text

Recommended next approval:

`Approved: start a local-only correctness fix pass for the wallet-scoped fresh token projection flicker, Q16 invalid-zero event precision audit failure, and stale API truth contract assertions. You may edit repository files, add/update tests, run local checks, and run read-only production verification. Do not deploy, restart services, change production config, repair production database rows, delete storage, commit, or push without separate approval.`

## Local Correctness Fix Pass Addendum

Date: 2026-08-31.

Scope approved: local repository edits, tests, local checks, audit-log updates,
and read-only production verification. No deploy, service restart, production
configuration change, production row repair, storage deletion, commit, or push
was performed.

Findings:

- `amo.proofofwork.me` fresh marketplace summary at block `964933`,
  hash `0000000000000000000094e4fde3e3f3b8d55477ddb0a7cff2fa577d29ee85de`,
  still exposed WORK `lowestAskPricePerTokenExact` as `6.8 proofs / WORK`.
- The same response's visible WORK listing book contained current V8 listings
  only; no visible legacy WORK listing was present.
- Exact buyer-arb recomputation over the visible sealed V8 book selected
  listing
  `21834201949872a3ba5e7f944adcbf21289de612e1fe2351316ba0fc82bc6463`
  at `+1,633.210083477604996553235484` proofs of buyer arb.
- Bitcoin Core on the node VPS reported mainnet block `964933` with the same
  best block hash, `verificationprogress = 1`, `initialblockdownload = false`,
  `pruned = false`, and no warnings.
- Read-only PostgreSQL classification found 427 WORK rows marked active or
  sealing in `proof_indexer.credit_listings`; 372 were current `pwt-sale-v8`
  rows and 55 were legacy `pwt-sale-v1` rows. The stale row behind the 6.8
  token-level ask was
  `dfee6642ad3d9252155f1e027230a9d8aba63d4c6f86f68b585e6c5e6d1ff44c`,
  still marked `sealing` in the derived table.

Local fixes prepared:

- Fresh wallet-scoped token reads now fail closed unless the authoritative
  proof-index wallet token overlay is present. Global exact-tip, summary,
  memory, and cache token fallbacks no longer satisfy `fresh=1&wallet=1`.
- The Q16 WORK atom audit keeps strict failure by default and adds an explicit
  read-only repairable mode for known invalid-zero event evidence.
- API truth contracts were updated for the current fresh Log helper shape and
  the stricter wallet-scoped freshness contract.
- Current WORK listing SQL now admits only the exact current authorization set
  after the V8 boundary. Legacy `pwt-sale-v1` rows remain historical data, but
  cannot enter current live WORK listing reads through the public lifecycle
  helper.
- Current WORK token summary cleanup no longer preserves stale token-level
  lowest-ask aliases after listing lifecycle filtering or V8-era recomputation.
- The AMO headline "Best ask" stat now renders the highest exact buyer arb from
  sealed current-era WORK listings, using the same BigInt rational calculation
  and ordering as the listing book's `Arb high` sort.

## Production Correctness Hotfix Verification Addendum

Date: 2026-08-31.

Scope approved: deploy the local correctness fix pass to production and run
read-only production verification. Only the required production API service was
restarted. No production storage was deleted, no production database rows were
repaired, no unrelated production configuration was changed, and no commit or
push was performed.

Deployment:

- Node VPS: staged and installed the corrected API runtime files
  `server/proof-api.mjs` and `server/db/proof-index-reader.mjs`, plus the
  approved correctness check/audit scripts and matching `package.json`.
  `proofofwork-api` was restarted once.
- UI VPS: overlaid rebuilt static bundles for
  `/var/www/proofofwork-marketplace`, `/var/www/proofofwork-computer`, and the
  `/var/www/proofofwork-nft` compatibility alias. Old hashed assets were left
  in place for already-open clients; Caddy was not restarted.
- Non-destructive rollback backups were written under
  `/tmp/proofofwork-correctness-3fd3101-20260831T205932Z-preinstall-backup`
  on the node VPS and
  `/var/tmp/proofofwork-deploy/correctness-ui-v2-3fd3101-20260831T211010Z/ui-preinstall-marketplace-computer-nft.tgz`
  on the UI VPS.

Verification:

- Public API health recovered to `ok = true`, `ready = true`, index lag `0`,
  with the API/indexer/database/node/disk checks all green at block `964941`.
- Bitcoin Core on the node VPS reported mainnet block/header `964941`, best
  block hash
  `00000000000000000000f13b4ddb82783e210cb21aa55c68433d2ed752ee964b`,
  `verificationprogress = 1`, `initialblockdownload = false`,
  `pruned = false`, and no warnings.
- Node VPS disk remained healthy: root `20%` used with `75G` free, data `72%`
  used with `453G` free. PostgreSQL `proof_indexer` size was `17 GB`.
- UI VPS disk remained healthy: root `/var/www` and `/var/tmp` all `26%` used
  with `27G` free. The three affected static roots were each about `15M`; the
  v2 UI staging/evidence directory was about `60M`.
- Fresh AMO marketplace summary at block `964941` matched the Core hash above,
  exposed `382` total active listings, `372` preview listings, `371` preview
  WORK listings, and `0` non-V8 WORK listings in the public preview book.
- Exact BigInt recomputation over the fresh production preview selected listing
  `21834201949872a3ba5e7f944adcbf21289de612e1fe2351316ba0fc82bc6463`
  as the highest sealed current-era WORK arb at
  `1,633.21008348018113744004965` proofs.
- Headless browser verification of live `amo.proofofwork.me` rendered
  `+1,633.21008348018113744004965 proofs arb` for `Best ask`; the old
  `6.8 proofs / WORK` display did not reappear.
- Production source gates passed under the Node 24 runtime:
  `npm run check:ui`, `npm run check:api-truth`,
  `npm run check:index-recovery-behavior` (`482/482` checks), and
  `npm run check:work-precision-v2`.
- `npm run indexer:audit-work-atoms:repairable -- --dry-run` on production
  exposed the expected `allowRepairableWorkEventPrecisionAudit = true` flag and
  performed no mutation.

Observed during verification:

- While fresh blocks arrived, background browser calls briefly saw 503s from the
  exact-tip guards, including registry checkpoint mismatch and complete Core
  token-listing evidence unavailable. Follow-up health and direct API checks
  were green at the current Core/index checkpoint. This is fail-closed behavior,
  but it remains a UX/read-pressure item to smooth so live pages do not log
  noisy transient errors during block transitions.
- The canonical UI publisher remains blocked by the existing rollback root
  `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-33c12c5a2a42-20260829T010316Z`.
  This hotfix therefore used a narrow no-delete static overlay rather than a
  full canonical UI release publication.

## Git And Production Sync Closure Addendum

Date: 2026-08-31.

Scope approved: verify that the local repository, pushed Git state, production
API checkout, and production static UI artifacts are aligned with the
correctness fixes deployed earlier today. No production storage deletion,
database row repair, unrelated production configuration change, or app feature
change is authorized by this closure.

Closure plan:

- Re-run local syntax, UI, API truth, recovery behavior, WORK precision,
  repairable atom audit dry-run, build, and repository hygiene checks.
- Commit the already-deployed correctness, audit, and hygiene changes with the
  repository's required hygiene trailers.
- Push the commit to `origin/main`.
- Verify production API source and served static UI artifacts against the
  pushed tree, then run read-only production health and data checks.
- Report the final commit hash in the operator handoff; the audit entry cannot
  contain its own enclosing commit hash without creating a self-referential
  commit loop.
