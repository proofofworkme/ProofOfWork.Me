# ProofOfWork.Me Treasury Ledger

This ledger tracks confirmed treasury movements that are not bug bounty payments or user refunds.

Important boundary:

```text
registry payment = user payment into the canonical ProofOfWork ID registry address
treasury sweep = consolidation from the registry address into a treasury-controlled address
refund = return of sats to a user for a non-canonical or invalid payment
```

Refunds remain tracked in `ID_REFUNDS.md`.
Bug bounty payments remain tracked in `BUG_BOUNTY_LEDGER.md`.

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
