# 2026-09-13 INCB Production Canonical Repair

## Scope

User-approved production correctness repair for the Inception Bond (INCB)
canonical replay/projection after the production UI showed zero/missing INCB
bond data while Growth still depended on the fixed issuance value.

This log extends the prior production audit chain. It does not reopen earlier
resolved issues from audit 5, audit 6, audit 7, or audit 8 as duplicate
findings. The hard INCB values previously recorded in audit 5 remained the
expected truth set for this repair.

No production data, backups, WAL archives, restore directories, release
archives, rollback evidence, or audit evidence were deleted.

## Approved Basis

For only these three historical snapshot ids, the repair accepted code-pinned
post-replay H-1 full-node witness bindings when `ledger_snapshots` rows were
absent:

- `35bf2b05cd91025920df228c`
- `895dbf988e2f77fc89c1757c`
- `7ab9dad4300df08edf54e80f`

The other 26 issuance value snapshots continued to require byte-exact locked
database rows. The repair remained a 46-txid atomic production INCB repair and
was required to verify the hard values before canonical summaries were trusted.

## Local Verification Before Production Mutation

Completed before the production repair/deploy:

- `node --check server/proof-api.mjs`
- `node --check scripts/backfill-proof-indexer.mjs`
- `node --check scripts/check-index-recovery-behavior.mjs`
- `npm run check:index-recovery-behavior` (`516/516`)
- `npm run check:incb-oracle-snapshot-restore`
- `npm run check:incb-range-replay-witness`
- `npm run check:bond-exact-arithmetic`
- `npm run check:live-data`
- `npm run check:api-truth`
- `npm run build`

## Production Repair Notes

The first canary-backed repair attempt failed closed before commit with:

`Canonical Q16 WORK replay requires the exact immutable precision migration marker.`

Production did have the marker row:

- key: `workPrecisionV2Migration:livenet`
- model: `canonical-work-q8-to-q16-migration-v1`
- status: `complete`
- activation height: `960601`
- declaration txid:
  `f90e1faf572ef8253ca5959731b9d9e99c74bced4397380059878936712bee7a`

The failure was an execution-environment issue: the non-live canary/repair shell
had sourced the DB, internal verifier, and Bitcoin RPC env files, but not the
inline systemd `WORK_AMO_V8_DECLARATION_*` pins that the live API receives from
`proofofwork-api.service.d/proof-index.conf`. The repair correctly refused to
replay Q16 balances without those pins.

After restarting only the non-live loopback canary with the live V8 declaration
pins, marker readiness verified:

```json
{"rows":1,"markerReady":true,"declarationMatchesEnv":true,"activationHeight":960601,"declarationHeight":960600}
```

The 46-txid atomic repair then completed with `ok: true`.

Repair receipt highlights:

- before target issuance/balance supply:
  `15929200999320839`
- after target issuance/balance supply:
  `224847713398447926`
- canonical target bond rows: `46`
- canonical target mint rows: `46`
- holders: `7`
- invalidated canonical snapshots: `3`
- preserved issuance value snapshots: `29`
- preserved block-scan snapshots: `18836`
- latest preserved block-scan snapshot:
  `37302f3248897b4e377df2d0` at block `966834`

## Hard-Value Verification

Independent production DB verification after commit:

```json
{
  "parent_bond_events": "47",
  "accepted_mints": "46",
  "direct_proof_issuance_units": "27386",
  "attached_work_issuance_units": "224847713398420540",
  "confirmed_incb_supply": "224847713398447926",
  "incb_network_value_q8": "22484771339844794793582060",
  "cumulative_dust_q8": "2193582060",
  "balance_supply": "224847713398447926",
  "holders": "7"
}
```

Live Inception summary after deploy/restart:

```json
{
  "error": null,
  "indexedThroughBlock": 966835,
  "consistencyStatus": "green",
  "confirmedMints": 46,
  "confirmedSupply": "224847713398447926",
  "networkValueQ8": "22484771339844794793582060",
  "dustQ8": "2193582060",
  "direct": "27386",
  "attached": "224847713398420540"
}
```

Live AMO/marketplace summary after catch-up:

```json
{
  "error": null,
  "indexedThroughBlock": 966835,
  "consistencyStatus": "green",
  "registryStats": {
    "sales": 4,
    "total": 507,
    "pending": 2,
    "listings": 6,
    "confirmed": 505,
    "activeListings": 6,
    "confirmedSales": 4,
    "confirmedSalesVolumeSats": 22000
  },
  "tokenConfirmedMints": 21875,
  "tokenOpenListings": 715
}
```

Live Growth summary after deploy/restart:

```json
{
  "error": null,
  "indexedThroughBlock": 966835,
  "totalSats": "8387576239638771780.35099288",
  "networkValueQ8": "838757623963877178035099288"
}
```

Final live health:

```json
{
  "available": true,
  "indexOk": true,
  "lagBlocks": 0,
  "indexedThroughBlock": 966835,
  "databaseOk": true,
  "diskOk": true
}
```

## Deployment

The verified code patch was deployed to `/opt/proofofwork-api` after the
production repair and summary verification. The previous live copies were
preserved at:

`/opt/proofofwork-api/backups/production-recovery-20260913T151329Z-incb-repair-code`

The live `proofofwork-api` service restarted cleanly and loaded the deployed
repair code. The temporary loopback canary on port `8099` was stopped after
verification.

## Result

Production INCB data is restored to the exact expected canonical hard values.
The false-zero INCB summary state is guarded by code and regression checks. AMO,
Inception, Growth, database, disk, and index health verified green after deploy.
