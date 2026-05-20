# ProofOfWork ID Refund Log

Operational notes for refunds issued against duplicate or failed ProofOfWork ID registry payments.

## Accounting Rule

Duplicate, failed, or otherwise non-canonical registration payments are not net registry revenue once the project has committed to refunding them.

Use this distinction:

```text
gross registry flow = every confirmed paid registry event visible on chain
canonical ID supply = first-confirmed valid registration per ID
refund liability = confirmed paid registration events that did not become canonical IDs
net registry revenue = gross registry flow - refunded or refund-owed non-canonical registration payments
```

Confirmed duplicate rows may keep appearing in registry audits forever because Bitcoin history is permanent. They should be tracked as refunded or refund liabilities here, not counted as current unpaid revenue.

When paying future ID refunds from ProofOfWork Mail, keep the on-chain marker small:

```text
Subject: blank
Message: rr:<count>
```

Examples:

```text
rr:1
rr:3
```

Meaning:

```text
rr = registry refund
count = number of refund rows covered by this tx
```

The full IDs, original registration txids, refund addresses, amounts, and refund txids belong in this log.

## 2026-05-09 Confirmed Refund Batch

These refunds were reported as issued by the project operator after running the ID registry audit.

| Refund address | Amount | Count | IDs |
| --- | ---: | ---: | --- |
| `bc1q568xckhc4j0grkd0qjh23wl3ulqsufv2drrn6d` | 7,000 sats | 7 | `x`, `btc`, `bitcoin`, `pepe`, `sats`, `bitcoin`, `pow` |
| `bc1p7kf50cf89xhjatzssjp67wjcs6m05d3y68jjcfkyn699yw2j2h8sh5pewc` | 6,000 sats | 6 | `okx`, `4`, `4`, `cz`, `okx`, `ai` |
| `bc1p8m24m3ycx2awggnlp4ljh0m8l54985scfwshet9zdg4qtf80udhqkwrx0c` | 1,000 sats | 1 | `trump` |

Total issued in this batch: **14,000 sats**.

Accounting status: these 14 duplicate registration payments are historical gross registry flow, but they are not net registry revenue after this refund batch.

## 2026-05-11 Pending Marketplace Refund

Refund for the losing same-block `testdummy@proofofwork.me` marketplace buy and invalid follow-up listing.

| Refund address | Amount | Count | IDs | Refund tx |
| --- | ---: | ---: | --- | --- |
| `bc1qggw7p5xtcv33uduhttphz24apx35u384ld9twk` | 2,092 sats | 2 | `testdummy` | `891f2575299d4017475afe4ed60eb590c96a89fd43c5211efea6bf46750db7d7` |

Refund components:

- Losing `buy2` payment: 1,000 sat seller payment plus 546 sat mutation fee in tx `c305f8d50c7e077a3a6b958ece911e346a90bca2c51a1449bdf033ebcddba5e4`.
- Invalid `list2` payment: 546 sat listing fee in tx `557350bbd9ee13a018967bc2af17c6214c4d59b2bc75ba95ce55fce648fe750a`.
- Winning canonical `buy2`: tx `da77c38e8df8dd8242464ff384394882d57471a19961655da4cda240286007b1`.

Status at log time: visible in mempool, not yet confirmed.

## 2026-05-09 Refund Notice Email

After issuing the refunds above, the project operator sent an on-chain ProofOfWork.Me mail notice to `bitcoin@proofofwork.me`.

- Notice tx: `d27483346c1f12fb3f46d288ce265a6e6d684c6f1ffb39cc729acfb80ace5676`
- Explorer: `https://mempool.space/tx/d27483346c1f12fb3f46d288ce265a6e6d684c6f1ffb39cc729acfb80ace5676`

## Audit Command

Run this command to generate a fresh duplicate/refund report:

```bash
npm run audit:ids
```

Confirmed duplicate rows may still appear in future audit output because the Bitcoin registry history is permanent. Check this refund log before treating an old duplicate as unpaid.
