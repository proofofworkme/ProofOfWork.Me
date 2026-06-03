# Chained Mint Transaction Review

This note reviews the pasted `minimalChainedMint.ts` template and compares it
to the transaction builders already used by ProofOfWork.Me.

## Template Intent

The template is designed to mint many transactions in a row by chaining one
user-controlled output into the next transaction input. It is useful when a user
wants 20+ mint transactions without reselecting wallet UTXOs for every mint.

The wallet still signs each transaction locally. The template does not custody
keys.

## Pasted Template Transaction Shapes

### Non-Final Mint

```text
vin:
  0: current chained user UTXO

vout:
  0: OP_RETURN {"p":"brc-20","op":"mint","tick":ticker,"amt":amount}
  1: user chained output, value = input - platform fee - network fee
  2: platform fee payment
```

This output 1 becomes the input for the next mint. It must remain above dust.

### Final Mint

```text
vin:
  0: current chained user UTXO

vout:
  0: OP_RETURN {"p":"brc-20","op":"mint","tick":ticker,"amt":amount}
  1: fixed user allocation
  2: platform fee payment
  3: final user change
```

This transaction ends the chain. Output 3 returns the remaining value to the
user and must be above dust.

## Existing ProofOfWork.Me Transaction Builders

### Generic Payment Builder

The current generic builder creates:

```text
payments before protocol
OP_RETURN payload outputs
optional post-protocol payments
wallet change if above dust
```

It selects confirmed wallet UTXOs and supports multiple OP_RETURN outputs. It is
safe and general, but it does not intentionally create a chained output for the
next mint.

### Credit Mint/Create Builders

Credit flows currently use the generic payment builder with credit protocol
payloads and registry payments. A chained credit mint variant is a strong
candidate because each mint is structurally similar and can carry a chained
wallet output.

### ID / Marketplace

These are not first targets for chained minting:

- ID registrations and transfers have first-confirmed and ownership semantics.
- Marketplace purchase/list/delist flows depend on sale terms, anchors, and
  exact ownership state.

## Main Integration Risk

The template builds transactions whose next input is an unconfirmed child of the
previous transaction. That is the point of chaining, but it changes mempool
behavior:

- Ancestor limits can stop long chains.
- Low effective fees can prevent later broadcasts.
- If one broadcast fails, the chain must stop immediately.
- Pending tx visibility is best-effort until confirmations.

ProofOfWork.Me currently prefers confirmed UTXOs for normal broadcasts. A
chained assistant must make this exception explicit and isolated to the selected
chain after the first confirmed input.

## Assistant / AI Agent Compatibility

The current app has assistant-like repeated mint logic. It tracks:

- active/canceled refs
- remaining count
- completed count
- delay between wallet prompts
- status text
- failed/canceled prompt handling
- local pending records
- indexer refresh after broadcasts

The chained implementation must keep that contract. Only the transaction engine
changes from "select confirmed wallet UTXO for every mint" to "select one
confirmed wallet UTXO, then spend the prior child output."

## Required Template Adaptations Before Wiring

For each target protocol, define:

- exact output order
- chained output index
- final output behavior
- registry/operator payment amount and address
- OP_RETURN payload builder
- fee and dust policy
- max chain length
- broadcast route, including Slipstream when multiple OP_RETURN outputs exist
- local pending record shape
- indexer expectations

## Recommended First Implementations

1. Credit chained mint template.
2. Generic protocol chained template for future use.

Do not adapt ID marketplace flows in the first pass.
