# ProofOfWork Computer Growth — Boost scenario

Scenario version: `2026-09-05-boost-v1`. Revised 2026-09-05. Historical baseline: 2026-05-11.

This is an uncalibrated scenario extension. The original May observations, adoption horizons, non-Boost assumptions, and modeled USD path remain unchanged. No September chain snapshot or current USD quote is claimed. Scenario value is not canonical network value and does not change WORK floors, balances, or historical listing terms.

The original [May model JSON](historical/2026-05-13/proofofwork-computer-growth-model.json) and [May model report](historical/2026-05-13/proofofwork-computer-agent-adoption-model.md) remain preserved. The prior frontend comparison in this artifact also retains the Credit lane added after that original generator.

## Explicit Boost assumptions

| Input | Scenario assumption |
| --- | ---: |
| Original posts per ID per year | 4 |
| Incremental metadata per original post | 250 vB |
| Standalone paid actions per ID per year | 12 |
| Registry payment valued per paid action | 546 proofs |
| Size per standalone paid action | 500 vB |
| Boost sales per ID per year | 0.02 |
| Seller price per Boost sale | 1,000 proofs |
| List/seal/buy registry payments per sale | 3 × 546 proofs |
| Size per complete sale lifecycle | 1,500 vB |
| Boost fee elasticity | 0.5 |
| Service value multiple | 5× |
| Shared annual capacity | 52,560,000,000 vB |

Original Boost posts are a subset of the existing Mail demand. Their count cannot exceed Mail writes. Their existing Mail payments, transaction overhead, and Files/media bytes are already allocated; only the extra Boost metadata consumes additional capacity. Boost-original metadata creates no additional value or transaction count.

Paid actions are a separate standalone transaction basket; sale-ticket mutations are excluded from that basket and modeled only in the complete sale lifecycle. The scenario values only the 546-proof registry payment for each paid action. Recipient/follow payments, optional signal, WORK movement, media value, miner fees, and sale-ticket funding/refunds add no separate Boost value here. The legacy marketplace assumption remains the non-Boost basket.

All new usage/value/size assumptions above are scenario choices, not calibrated averages or transaction-size guarantees. The zero Boost value at the historical origin means no Boost baseline was introduced; it is not a current-activity claim.

## Formula and blockspace

```text
fee_multiplier = (0.01 / scenario_fee_rate) ^ Boost_elasticity
originals = min(existing_raw_Mail_writes, IDs × originals_per_ID × fee_multiplier)
paid_actions = IDs × paid_actions_per_ID × fee_multiplier
sales = IDs × sales_per_ID × fee_multiplier
Boost_raw_value = (paid_actions × registry_fee + sales × (seller_price + 3 × registry_fee)) × value_multiple
Boost_raw_bytes = originals × metadata_bytes + paid_actions × action_bytes + sales × lifecycle_bytes
capacity_ratio = min(total_raw_bytes, annual_capacity) / total_raw_bytes
Boost_value = Boost_raw_value × capacity_ratio
```

The capacity ratio is one when demand is zero. Every physical write, including ID writes, and each service-value lane uses the shared ratio. The ID network-value stock keeps the prior unthrottled N² rule. Adding Boost can reduce another service's executed traffic when the shared capacity is full. The prior frontend left its displayed ID-write count unthrottled; only this new version corrects that count, while its legacy comparison preserves the original result.

## Forecast from the original baseline

Rows are the original May-baseline horizons, re-evaluated with the September scenario assumptions. They are not newly rebased September forecasts. Counts are annual scenario activity after capacity allocation and may be fractional; display values below are rounded.

| Horizon | Boost original posts | Paid actions | Boost sales | Boost value (proofs) | Total value (proofs) | Demand executed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 months | 172,984 | 518,953 | 864.92 | 1,428,150,064 | 22,810,850,394 | 100.0000% |
| 12 months | 386,805 | 1,160,414 | 1,934.02 | 3,193,440,624 | 86,183,628,291 | 100.0000% |
| 24 months | 347,580 | 1,042,741 | 1,737.90 | 2,869,606,150 | 219,784,224,020 | 35.9438% |
| 5 years | 217,190 | 651,570 | 1,085.95 | 1,793,110,368 | 974,201,850,155 | 7.6663% |
| 10 years | 79,038 | 237,114 | 395.19 | 652,532,574 | 12,855,235,106,700 | 0.6856% |
| 25 years | 2,914 | 8,742 | 14.57 | 24,058,888 | 12,830,149,710,000,000 | 0.0008% |
| 50 years | 10 | 30 | 0.05 | 82,276 | 1,109,775,976,120,000,000,000 | 0.0000% |

The full versioned JSON contains every input, raw/capped Boost component, existing product lane, modeled USD value, and prior frontend comparison. Numeric serialization uses 12 significant digits for deterministic rebuilds; canonical proof/Q16 arithmetic is outside this scenario module.

Regenerate this version from the repository root with `node scripts/generate-growth-forecast.mjs`. The generator and frontend share `src/features/growth/growthForecast.mjs`; the historical May generator remains separate and unchanged.
