# Chained Mint Templates

This folder is a staging area for reusable chained-mint transaction templates.
Files here are intentionally not wired into the production React app yet.

The goal is to adapt one well-reviewed chaining pattern to each ProofOfWork.Me
mint workflow: token mints, future registry writes, and any campaign mint that
benefits from signing/broadcasting many dependent transactions in sequence.

## Current App Behavior To Preserve

The app already has assistant-style mint loops:

- Token mint assistant: same model for token mints.
- Broadcast routing: normal transactions use the app broadcaster; transactions
  with multiple OP_RETURN outputs can use Slipstream through the existing
  `slipstream-if-multiple-op-return` strategy.
- Wallet custody rule: UniSat signs locally. The app never handles seed phrases
  or private keys.

The chained template must not remove those behaviors. It should become an
alternative execution engine for assistants, not a replacement for wallet
signing, progress state, cancellation, or status reporting.

## Chained Mint Model

A chained mint transaction spends one user-controlled input and creates a new
user-controlled output that becomes the next transaction's input.

For a run of `N` mints:

```text
initial wallet UTXO
  -> tx 1 output 1
    -> tx 2 output 1
      -> tx 3 output 1
        -> ...
          -> final tx change output
```

Each transaction is signed locally, broadcast, and its txid/vout becomes the next
input. This can create 20+ dependent transactions without reselecting wallet
UTXOs for every mint.

## Reviewed Template Transaction Shape

The source template builds two shapes.

### Non-Final Mint Transaction

Used for every mint except the last.

```text
inputs:
  0: current chained user UTXO

outputs:
  0: OP_RETURN protocol mint payload
  1: user chained UTXO carrying remaining run funds
  2: platform or registry fee payment
```

Value behavior:

- Output 1 is `currentInputValue - platformFee - networkFee`.
- Output 1 must stay above dust because it is the next input.
- There is no separate wallet change output.
- The chained output is found by scanning outputs paying back to the user,
  excluding postage-sized outputs.

### Final Mint Transaction

Used for the last mint in the run.

```text
inputs:
  0: current chained user UTXO

outputs:
  0: OP_RETURN protocol mint payload
  1: fixed user allocation / owner anchor / postage output
  2: platform or registry fee payment
  3: final user change
```

Value behavior:

- Output 1 is fixed by the target protocol.
- Output 3 returns the final remaining funds to the user.
- Output 3 must stay above dust or the template rejects the transaction.

## Current Template Constants

The pasted `minimalChainedMint.ts` uses these values:

```text
OUTPUT_ALLOCATION_SATS = 3333
PLATFORM_FEE_SATOSHIS = 3333
PLATFORM_FEE_ADDRESS = bc1qmqwghjgc99euy09u6vnmn9h94cq8mct03aa9a9
POSTAGE_UTXO_SATOSHIS = 546
DUST_LIMIT_SATS = 546
```

These are template defaults only. Every ProofOfWork.Me adaptation must replace
them with the target protocol's real registry/operator/anchor rules.

## Compatibility Notes For ProofOfWork.Me

- The template uses `bitcoinjs-lib` PSBTs and supports P2WPKH and P2TR inputs.
- The template expects a backend-selected initial UTXO from `/api/mint`; in
  ProofOfWork.Me this should become an adapter over existing production API or
  wallet UTXO selection.
- The template signs one PSBT at a time. This matches the current assistant
  rule that the user approves each UniSat prompt.
- The template broadcasts a raw final tx hex. This must be routed through the
  existing broadcast layer so Slipstream is used when needed.
- The template must use confirmed UTXOs for the initial input unless a specific
  future workflow explicitly accepts ancestor risk.
- For large chains, mempool ancestor/package policy can still reject dependent
  broadcasts. The UI must show progress and stop cleanly on the first failure.

## Required Adaptation Per Use Case

Each duplicated template must define:

- Protocol payload builder.
- Positive payment outputs before/after OP_RETURN.
- Chained output index rule.
- Final output rule.
- Registry/operator fee rule.
- Dust and fee accounting.
- Broadcast strategy.
- Indexer expectation for pending tx visibility.
- Assistant progress/cancel behavior.

## Current Candidate Targets

- Token mint chain:
  - Each transaction should carry the token mint payload and pay the token
    registry/mint price exactly as existing single-mint logic does.
- Future registry write chain:
  - Only safe for protocols whose canonical rules allow pending chained inputs
    and deterministic per-transaction validation.

## Important AI Agent Note

The current app has assistant/agent-like automation for repeated mints: it
tracks active refs, remaining count, delay, cancellation, status text, and wallet
prompts. Chained minting must plug into that same UX contract:

- Start only after validation.
- Show progress per broadcast.
- Stop on cancel, failed signature, failed broadcast, or invalid next input.
- Never auto-sign without wallet approval.
- Keep local pending records in the same shape used by the current assistant.
- Refresh indexer state after broadcasts.
