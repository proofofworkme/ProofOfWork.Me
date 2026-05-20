# ProofOfWork.Me Bug Bounty Ledger

This ledger tracks community bug reports that shipped as fixes and should be considered for future treasury-funded bug bounties.

Important boundary:

```text
tracked = preserved for future treasury review
paid = a payout txid has been added
confirmed paid = the payout txid is confirmed on chain
```

Tracking an item here is not an immediate payout promise. It preserves attribution so ProofOfWork.Me can pay contributors later when the treasury has enough BTC and the founder approves the bounty amount.

## Optimized Payment Marker

Bug bounty payment transactions should avoid long OP_RETURN messages. The payment output and this ledger carry the real detail.

When paying from ProofOfWork Mail, use:

```text
Subject: blank
Message: bb:<count>
```

Examples:

```text
bb:1
bb:2
```

Meaning:

```text
bb = bug bounty payment
count = number of bounty rows covered by this tx
```

When the same transaction also includes a refund, append:

```text
;rf:<count>
```

Example:

```text
bb:1;rf:1
```

Meaning:

```text
rf = refund payment
count = number of refund items covered by this tx
```

The full attribution, fixed commits, amount, recipient, and payment txid belong in this ledger. This keeps the on-chain marker small while preserving an agent-readable proof trail.

## Pending Treasury Review

| Date tracked | Reporter | Attribution | Bug report | Impact | Fixed in | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-13 | `moove@proofofwork.me` | French-speaking community tester / agent | Contacts accepted a raw BTC address but failed to add a confirmed ProofOfWork ID after the receiver update. | Contact creation and ID-based compose onboarding could fail for confirmed IDs. | `4229a6a` `Fix contact ID resolver refresh` | Fixed, pushed, deployed, confirmed paid 546 sats in tx `1cc193649731a7c6150955c65e9c4bb3ad64e00d93959832a0b42f77529244bc` |
| 2026-05-13 | `moove@proofofwork.me` | French-speaking community tester / agent | Localhost navigation jumped from the local app to production domains such as `desktop.proofofwork.me`. | Self-hosted/local testers could not move through all app surfaces without leaving localhost. | `39c0476` `Keep app navigation local on localhost` | Fixed, pushed, deployed, confirmed paid 546 sats in tx `1cc193649731a7c6150955c65e9c4bb3ad64e00d93959832a0b42f77529244bc` |
| 2026-05-13 | `moove@proofofwork.me` | French-speaking community tester / agent | Browser did not expose a clear Testnet4/Mainnet/Testnet3 selector, making it unclear how to render a confirmed Testnet4 HTML tx locally. | Testnet4 Browser testing could fail or appear broken even when the tx was valid and confirmed. | `8bebb4b` `Improve browser network and fee warnings` | Fixed, pushed, paid 546 sats in pending tx `6537b9f927d072ae7e85f3de9c1c0880ac4577a349f1ed0f98faa204bfcf244c` |
| 2026-05-14 | `@OnlyWithCrypto` | X/Twitter marketplace tester; payout address `bc1pjhhle6hly70vllskq4ufrnf09m89fmgunkhhuvj7fwa99pen4hesanusnk` | ID marketplace listing for `11@proofofwork.me` disappeared because its `list5` sale-ticket UTXO from tx `a2ff08afed159572c1a50141f74e327a208def78277aabd29249b73c5c346262` was accidentally spendable by unrelated wallet actions. | Active marketplace listings could become invisible and unavailable for purchase if a normal registration, mail, or ID action consumed the seller's sale-ticket UTXO. | `4ef805e` `Reserve ID marketplace sale tickets` | Fixed, pushed, paid 2,008 sats bounty/refund in pending tx `2e152c36edfc5e52c4fa02700cd37b9bfdfe56d13679c90f156589a29286f478` |

## Payment Records

| Date recorded | Reporter | Paid sats | Treasury txid | Recipient | Covered ledger rows | Tx status at review | Notes |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| 2026-05-13 | `moove@proofofwork.me` | 1,092 total; 546 per bounty | [`1cc193649731a7c6150955c65e9c4bb3ad64e00d93959832a0b42f77529244bc`](https://mempool.space/tx/1cc193649731a7c6150955c65e9c4bb3ad64e00d93959832a0b42f77529244bc) | `moove@proofofwork.me` current confirmed receive address `bc1plqn2g9dkyspk48r8ek83p3ecc32vz2g9fnlw006yvmvqvx8cnxyskrt9dc` | `4229a6a`, `39c0476` | Confirmed in block 949235 | Transaction pays one 1,092 sat output to Moove's confirmed receive address and carries OP_RETURN memo `BUG BOUNTY PROGRAM PAYMENT FOR FIRST 2 BUG FIXES`. Future equivalent marker should be `bb:2` to save OP_RETURN bytes and sats. |
| 2026-05-13 | `moove@proofofwork.me` | 546 | [`6537b9f927d072ae7e85f3de9c1c0880ac4577a349f1ed0f98faa204bfcf244c`](https://mempool.space/tx/6537b9f927d072ae7e85f3de9c1c0880ac4577a349f1ed0f98faa204bfcf244c) | `moove@proofofwork.me` current confirmed receive address `bc1plqn2g9dkyspk48r8ek83p3ecc32vz2g9fnlw006yvmvqvx8cnxyskrt9dc` | `8bebb4b` | Pending confirmation at review time | Transaction pays one 546 sat output to Moove's confirmed receive address and carries optimized OP_RETURN marker `bb:1` as `pwm1:m:bb:1`. |
| 2026-05-14 | `@OnlyWithCrypto` | 2,008 total; 546 bug bounty + 546 list5 refund + 916 listing miner fee refund | [`2e152c36edfc5e52c4fa02700cd37b9bfdfe56d13679c90f156589a29286f478`](https://mempool.space/tx/2e152c36edfc5e52c4fa02700cd37b9bfdfe56d13679c90f156589a29286f478) | `@OnlyWithCrypto` payout address `bc1pjhhle6hly70vllskq4ufrnf09m89fmgunkhhuvj7fwa99pen4hesanusnk` | `4ef805e`; lost listing tx `a2ff08afed159572c1a50141f74e327a208def78277aabd29249b73c5c346262` | Pending confirmation at review time | Transaction pays one 2,008 sat output to `@OnlyWithCrypto` and carries optimized OP_RETURN marker `bb:1;rf:1` as `pwm1:m:bb:1;rf:1`. The sale-ticket output was later spent by the reporter's wallet, so this refund covers the lost listing action and its miner fee, plus one 546 sat bug bounty. |

When a bounty is paid, add:

```text
reporter:
paid sats:
treasury txid:
paid date:
covered ledger row(s):
notes:
```
