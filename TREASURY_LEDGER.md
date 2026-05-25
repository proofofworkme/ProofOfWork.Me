# ProofOfWork.Me Treasury Ledger

This ledger tracks confirmed treasury movements that are not bug bounty payments or user refunds.

Important boundary:

```text
registry payment = user payment into the canonical ProofOfWork ID registry address
treasury sweep = consolidation from the registry address into a treasury-controlled address
refund = return of sats to a user for a non-canonical or invalid payment
WORK treasury = treasury-controlled address holding WORK token balance
```

Refunds remain tracked in `ID_REFUNDS.md`.
Bug bounty payments remain tracked in `BUG_BOUNTY_LEDGER.md`.

## WORK Treasury Addresses

These addresses are treated as the current WORK treasury set unless a later
treasury note supersedes them:

```text
1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT
1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x
1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv
```

WORK balances, BTC balances, USD values, and floor values are live chain/API
data. Any numeric snapshot below is historical and must be refreshed from
`work.proofofwork.me`, `growth.proofofwork.me`, or the first-party API before
being reused in public copy.

### Historical WORK Treasury Snapshot

Snapshot time: 2026-05-24 23:10 UTC.

Source endpoints:

```text
https://work.proofofwork.me/api/v1/work-summary?network=livenet&fresh=1
https://mempool.space/api/address/<address>
```

| Address | WORK balance | Confirmed BTC balance sats | Mempool net sats | Notes |
| --- | ---: | ---: | ---: | --- |
| `1447TsdXtFSnVrWawSamyyQKPDNW4ALtBT` | 3,983,000 | 186,006 | -40,303 | Treasury WORK holder |
| `1BPVvi1GK4QkfqFMU4jHGjsQjyGwjJJJ7x` | 3,618,000 | 0 | 0 | Treasury WORK holder |
| `1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv` | 1,728,000 | 3,414,096 | -70,260 | `bitcoin@proofofwork.me` owner / treasury address |
| Total | 9,329,000 | 3,600,102 | -110,563 | Confirmed totals are canonical; mempool net is visibility only |

At the same snapshot:

```text
WORK floor: 8.679693276186166 sats / WORK
Confirmed network value: 182,273,558.79990947 sats
Treasury WORK mark: 80,972,858.57354075 sats
WORK mint cost basis at 1 sat / WORK: 9,329,000 sats
Unrealized WORK gain versus mint: 71,643,858.57354075 sats
Multiple versus mint: 8.679693276186166x
Return versus mint: 767.9693276186166%
Total confirmed treasury mark: 84,572,960.57354075 sats
```

## Registry Treasury Sweeps

| Date confirmed | Source | Destination | Input sats | Output sats | Fee sats | Inputs | Block | Txid | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2026-05-13 | Canonical mainnet registry `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e` | `bitcoin@proofofwork.me` owner address `1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv` | 235,098 | 217,021 | 18,077 | 241 | 949274 | [`1f350524080f6f7ea2e8de685d2ea93468cea1987933ff27592499773fe4edc5`](https://mempool.space/tx/1f350524080f6f7ea2e8de685d2ea93468cea1987933ff27592499773fe4edc5) | Consolidated 228 registration UTXOs of 1,000 sats and 13 mutation UTXOs of 546 sats. Confirmed at 2026-05-13 23:02:22 UTC. |

## Accounting Notes

The sweep moves registry UTXOs into treasury custody. It does not change the refund accounting rule:

```text
net registry revenue = gross registry flow - refunded or refund-owed non-canonical registration payments
```

When refund liabilities are paid, record them in `ID_REFUNDS.md`, not here.
