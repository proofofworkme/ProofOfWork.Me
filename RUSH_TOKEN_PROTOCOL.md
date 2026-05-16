# RUSH Token Protocol

RUSH is a ProofOfWork.Me token page with a fixed 50,000 mint
schedule and an intentionally simple Bitcoin OP_RETURN record.

The RUSH page is separate from the generic token creation flow. It uses its own
registry address, deterministic reward curve, and chained mint execution engine.

## Constants

```text
token: RUSH
production network: livenet
mainnet registry address: bc1qym392dfvfm024k7ukzlnvnpfvuu4kfqvu56w3e
testnet4 registry address: tb1qyh9pgznpass4mjcl8qj9yxs3vvl9rnrk5gvw6q
mint price: 1000 sats
total token supply: 1,000,000,000 RUSH
maximum rewarded mints: 50,000
final phase reward: 6,000 RUSH per mint
```

RUSH uses 6 display decimals for deterministic accounting:

```text
1 RUSH = 1,000,000 base units
total supply units = 1,000,000,000,000,000
```

## Mint Record

Each RUSH mint transaction must:

```text
1. spend from the minter wallet.
2. pay at least 1000 sats to the RUSH registry address.
3. include one RUSH mint OP_RETURN record.
4. put the registry payment before the RUSH OP_RETURN output.
```

The V1 OP_RETURN payload is:

```text
pwr1:m:rush
```

`pwr1:` means ProofOfWork RUSH. `m` means mint. `rush` is lowercase and exact.

The minter address is inferred from `vin0`, matching the existing
ProofOfWork.Me pattern used by token and Pay2Speak indexers. The OP_RETURN does
not store a recipient, amount, rank, or balance.

## Valid Mint Transaction Shape

The normal single-mint shape is:

```text
vin0:
  minter input

vout before OP_RETURN:
  payment >= 1000 sats -> RUSH registry address

OP_RETURN:
  pwr1:m:rush

change:
  optional wallet change
```

The exact output index of the registry payment may vary, but it must appear
before the RUSH OP_RETURN output. This keeps parsing consistent with existing
ProofOfWork.Me protocols where paid protocol outputs precede protocol data.

## Chained Mint Transaction Shape

RUSH is the first intended consumer of the reusable chained mint engine.

The chained mint assistant starts from one confirmed wallet UTXO. After the
first transaction, each next transaction spends the user-controlled output from
the previous transaction. This intentionally creates a dependent chain.

### Non-Final Chained Mint

Used for every mint except the final mint in the requested run.

```text
vin0:
  current user-controlled chained UTXO

vout0:
  1000 sats -> RUSH registry address

vout1:
  OP_RETURN pwr1:m:rush

vout2:
  user chained output carrying remaining run funds
```

`vout2` becomes the next transaction input. It must remain above dust and must
carry enough value for the remaining registry payments and network fees.

### Final Chained Mint

Used for the last mint in the requested run.

```text
vin0:
  current user-controlled chained UTXO

vout0:
  1000 sats -> RUSH registry address

vout1:
  OP_RETURN pwr1:m:rush

vout2:
  final user change, when above dust
```

The final transaction does not need to preserve another chained output.

## Broadcast Rules

The first input should be a confirmed wallet UTXO. After that, the chain spends
the previous pending child output by design.

This is an explicit exception to the default ProofOfWork.Me rule that ordinary
broadcasts spend confirmed wallet UTXOs only.

The UI must make the risk clear:

- a failed broadcast stops the run.
- long chains can hit mempool ancestor limits.
- low effective package fee can trap later children.
- pending records are visibility only until confirmed.

RUSH mint transactions contain one OP_RETURN output, so they can use the normal
ProofOfWork broadcast path. If a future RUSH variant adds multiple OP_RETURN
outputs, it must route through the existing first-party Slipstream proxy.

Wallet signing stays local. The app never handles seed phrases or private keys.

## Canonical Indexing

The RUSH indexer scans the RUSH registry address:

```text
livenet:  bc1qym392dfvfm024k7ukzlnvnpfvuu4kfqvu56w3e
testnet4: tb1qyh9pgznpass4mjcl8qj9yxs3vvl9rnrk5gvw6q
```

For each transaction touching that address, a valid RUSH mint is accepted when:

```text
1. the tx has a txid.
2. the tx has a payment output >= 1000 sats to the RUSH registry address.
3. that payment output appears before the RUSH OP_RETURN.
4. the tx has an OP_RETURN payload exactly equal to pwr1:m:rush.
5. vin0 has a parseable minter address.
```

Confirmed records are canonical. Pending records can be shown as pending
visibility but must not consume final mint supply until confirmed.

## Mint Ordering

Confirmed RUSH mints are ordered by chain position:

```text
block height ascending
transaction position inside block ascending
txid ascending only as a deterministic fallback when position is unavailable
```

The first valid confirmed mint receives ordinal `1`.

The last valid confirmed mint that can receive a reward is ordinal `50,000`.

Any valid-looking RUSH mint after ordinal `50,000` is indexed as an overflow
mint. Overflow mints paid the registry, but they receive `0 RUSH`.

Pending mints may be displayed separately with estimated ordinals, but their
final ordinal can change until confirmation.

## Reward Schedule

RUSH distributes exactly 1,000,000,000 tokens over 50,000 rewarded mints.

The distribution is phase-based. Early minters receive more RUSH per mint, but
the reward does not decay toward near-zero before the end of the mint window.

```text
phase 1: mints 1      -> 5,000   receive 50,000 RUSH each
phase 2: mints 5,001  -> 15,000  receive 30,000 RUSH each
phase 3: mints 15,001 -> 30,000  receive 18,000 RUSH each
phase 4: mints 30,001 -> 45,000  receive 10,000 RUSH each
phase 5: mints 45,001 -> 50,000  receive 6,000 RUSH each
```

Phase totals:

```text
phase 1: 5,000  * 50,000 = 250,000,000 RUSH
phase 2: 10,000 * 30,000 = 300,000,000 RUSH
phase 3: 15,000 * 18,000 = 270,000,000 RUSH
phase 4: 15,000 * 10,000 = 150,000,000 RUSH
phase 5: 5,000  * 6,000  = 30,000,000 RUSH
total: 1,000,000,000 RUSH
```

Canonical phase table:

```ts
type RushPhase = {
  endOrdinal: number;
  phase: number;
  reward: string;
  rewardUnits: string;
  startOrdinal: number;
  total: string;
  totalUnits: string;
};

const RUSH_PHASES: RushPhase[] = [
  {
    phase: 1,
    startOrdinal: 1,
    endOrdinal: 5000,
    reward: "50000",
    rewardUnits: "50000000000",
    total: "250000000",
    totalUnits: "250000000000000",
  },
  {
    phase: 2,
    startOrdinal: 5001,
    endOrdinal: 15000,
    reward: "30000",
    rewardUnits: "30000000000",
    total: "300000000",
    totalUnits: "300000000000000",
  },
  {
    phase: 3,
    startOrdinal: 15001,
    endOrdinal: 30000,
    reward: "18000",
    rewardUnits: "18000000000",
    total: "270000000",
    totalUnits: "270000000000000",
  },
  {
    phase: 4,
    startOrdinal: 30001,
    endOrdinal: 45000,
    reward: "10000",
    rewardUnits: "10000000000",
    total: "150000000",
    totalUnits: "150000000000000",
  },
  {
    phase: 5,
    startOrdinal: 45001,
    endOrdinal: 50000,
    reward: "6000",
    rewardUnits: "6000000000",
    total: "30000000",
    totalUnits: "30000000000000",
  },
];
```

Canonical reward lookup:

```text
if ordinal < 1:
  invalid
if 1 <= ordinal <= 5000:
  reward = 50,000 RUSH
if 5001 <= ordinal <= 15000:
  reward = 30,000 RUSH
if 15001 <= ordinal <= 30000:
  reward = 18,000 RUSH
if 30001 <= ordinal <= 45000:
  reward = 10,000 RUSH
if 45001 <= ordinal <= 50000:
  reward = 6,000 RUSH
if ordinal > 50000:
  reward = 0 RUSH, overflow = true
```

Floating point math must not be used for canonical accounting. Indexers must
use integer base units. Since every phase reward is an integer token amount,
the base-unit math is direct:

```text
rewardUnits = reward * 1,000,000
```

Canonical cumulative distribution through ordinal `n`:

```text
cumulative(n) = sum rewards for ordinals 1..n
```

The final implementation must include tests proving:

```text
sum reward(1..50000) = 1,000,000,000 RUSH
reward(1) = 50,000 RUSH
reward(5000) = 50,000 RUSH
reward(5001) = 30,000 RUSH
reward(15000) = 30,000 RUSH
reward(15001) = 18,000 RUSH
reward(30000) = 18,000 RUSH
reward(30001) = 10,000 RUSH
reward(45000) = 10,000 RUSH
reward(45001) = 6,000 RUSH
reward(50000) = 6,000 RUSH
reward(50001) = 0 RUSH and overflow = true
```

This schedule sums exactly to the full supply without rounding.

## Indexed Record Shape

The API should expose records shaped like:

```ts
type RushMintRecord = {
  amount: string;          // display RUSH amount
  amountUnits: string;     // integer base units as decimal string
  confirmed: boolean;
  createdAt: string;
  dataBytes?: number;
  minterAddress: string;
  network: BitcoinNetwork;
  ordinal?: number;        // confirmed canonical ordinal, 1..50000
  overflow: boolean;
  phase?: number;
  registryAddress: string;
  paidSats: number;
  txid: string;
};
```

The aggregate state should expose:

```ts
type RushState = {
  indexedAt: string;
  network: BitcoinNetwork;
  registryAddress: string;
  mints: RushMintRecord[];
  stats: {
    confirmedMints: number;
    pendingMints: number;
    rewardedMints: number;
    overflowMints: number;
    totalSupply: "1000000000";
    distributed: string;
    remaining: string;
    nextOrdinal: number | null;
    nextReward: string;
    currentPhase: number | null;
  };
};
```

## API Surface

Recommended V1 endpoint:

```text
GET /api/v1/rush?network=livenet
GET /api/v1/rush?network=testnet4
```

The endpoint should:

- fetch transactions touching the RUSH registry address.
- merge pending mempool visibility.
- validate `pwr1:m:rush` records.
- assign confirmed ordinals from chain order.
- compute rewards deterministically.
- expose pending mints separately without changing confirmed supply.

The global Log endpoint should add `rush-mint` activity items after the RUSH
indexer exists.

Growth can add RUSH later as a token-specific flow once confirmed usage exists.

## Page Surface

Recommended local route:

```text
/?rush=1
```

Recommended production host:

```text
rush.proofofwork.me
```

Recommended build flag:

```text
VITE_RUSH_ONLY=1
```

The RUSH page should show:

- total confirmed mints.
- remaining rewarded mints.
- next estimated reward.
- current phase.
- phase progress.
- recent mint list ordered by canonical ordinal.
- connected wallet balance for RUSH.
- chained mint assistant with count, fee rate, delay, and progress.
- clear pending/confirmed separation.

The chained mint assistant should cap the run conservatively at first, for
example 20 mints, then raise the cap only after mempool behavior is verified.

## Phase 1 Exclusions

V1 does not implement:

- transfers.
- marketplace listings.
- burns.
- staking.
- owner/admin mint.
- off-chain balances.
- mutable metadata.

The source of truth is the RUSH registry address plus valid `pwr1:m:rush`
records confirmed on Bitcoin.
