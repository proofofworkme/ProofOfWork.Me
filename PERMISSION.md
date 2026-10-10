# Permission v1

Permission is the wallet-bound permission registry at
`permission.proofofwork.me` and Computer `/?folder=permission`. A human creates,
replaces or revokes a grant through local UniSat review. Confirmed public records
can be given to an agent by transaction ID. v1 has no expiry and no named-agent
binding. The authorizing wallet remains the only wallet the grant can authorize.

## Authority and lifecycle

Authority requires independently hydrated previous outputs and verified wallet
signatures that commit to every output, including the Permission capsule. v1
accepts only mainnet P2PKH inputs, each with a canonical signature using
`SIGHASH_ALL` (without `ANYONECANPAY`). Every public key must match its actual
previous-output script and the same wallet address. The reader reconstructs the
transaction, verifies its TXID and independently checks every signature. Missing
signature evidence, weaker sighashes and unsupported script paths remain
inspectable rejected records and cannot grant, replace or revoke authority.
Authority never comes from a label or a claimed PowID. A label such as `armyofyouth@proofofwork.me` is display data;
transferring that ID does not transfer a grant. The connected account must equal
the verified grant wallet before every owner operation.

`grant` opens a history. `replace` and `revoke` must be signed by that original
wallet and reference both the original grant and its current head. Replay follows
confirmed block, transaction and output order; stale parents and foreign-wallet
events remain inspectable but do not change authority. Replacement makes the
prior version unusable. Revocation closes new authorization, including when an
agent still has the original TXID. Previously released signatures generally
cannot be recalled. Pending events are best-effort visibility, never authority.

## Canonical record

The carrier is an existing Mail body:

```text
pwm1:m:pwperm1:<grant|replace|revoke>:<canonical-JSON-base64url>
```

One optional Mail subject is allowed. The transaction pays at least 546 proofs
back to the authorizing wallet before its zero-value carriers. Mail retains its
existing aggregate accounting; Permission adds no economic lane, registry fee,
issuance, floor or asset-balance change.

Grant metadata is a closed schema. UTF-8 JSON, property order, sorted action and
recipient sets, decimal strings and unpadded base64url must match the shared
encoder exactly. Unknown fields and ambiguous or malformed carriers fail closed.

New grants and replacements from the fee-rate editor use metadata version 2:

```json
{
  "v": 2,
  "network": "livenet",
  "label": "armyofyouth@proofofwork.me",
  "policy": {
    "signingEnabled": true,
    "allowedActions": ["boost.post", "mail.send", "publish.article"],
    "maxTransactionProofs": "5000",
    "dailyLimitProofs": "30000",
    "minerFeeRateProofsPerVbyte": "0.5",
    "allowedRecipients": null,
    "workLimits": null
  }
}
```

Version 1 remains immutable replay and current-policy compatibility. Its original
absolute miner-fee cap has its original meaning, as in this historical form:

```json
{
  "v": 1,
  "network": "livenet",
  "label": "armyofyouth@proofofwork.me",
  "policy": {
    "signingEnabled": true,
    "allowedActions": ["boost.post", "mail.send", "publish.article"],
    "maxTransactionProofs": "5000",
    "dailyLimitProofs": "30000",
    "maxMinerFeeProofs": "1000",
    "allowedRecipients": null,
    "workLimits": null
  }
}
```

Allowed actions are `mail.send`, `boost.post`, `publish.article`, `amo.listwork`,
`amo.sealwork`, and `amo.buywork`. `allowedRecipients: null` allows any recipient;
an empty array permits only self payments; a list permits those addresses plus
self/change. WORK actions additionally require explicit `workLimits`:
`maxAmountSubatoms`, `minSaleProofs`, `maxPurchaseProofs`, and `maxOpenListings`.
A null WORK policy denies asset operations even when an action is listed.
WORK uses its canonical asset ID; other AMO assets are outside v1.

Replacement metadata adds `grant` and `parent` TXIDs before `label` and `policy`.
Revocation contains only `v`, `network`, `grant`, and `parent`. Versions 1 and 2
use the same Mail carrier and wallet/head lifecycle. Version 1 accepts only the
absolute-cap policy; version 2 accepts only the fee-rate policy. Mixed forms and
version/field mismatches are invalid.

## Agent transaction fee rate

The owner selects **Agent transaction fee rate (proofs/vB)** using the same
`0.1`, `0.5`, `1`, and `2` presets as the other fee panels, or a custom value of
at least `0.1` with up to eight decimal places. The public value is a canonical
decimal string, never a floating-point approximation or an exponent. The export
contains, for example:

```dotenv
AGENT_MINER_FEE_RATE_PROOFS_PER_VBYTE=0.5
```

This is the agent's construction target. The agent cannot substitute another
rate or automatically raise it when funding or relay conditions change. A
failure to construct within the selected terms requires owner review. The
closed controller derives the conservative size from the verified transaction,
uses the existing 160-vB-per-input construction convention and exact whole-proof
ceiling, and requires the miner fee to match that calculation. Extra fee from
dust absorption is rejected. Conservative input estimates and final signature
sizes mean the effective signed fee divided by its exact vsize may differ from
the selected construction rate. Miner fees still count toward transaction and
daily wallet-debit budgets.

**Permission publication fee rate** separately pays for creating, replacing or
revoking the grant. Changing that local publication rate never changes the
agent's on-chain rate. Changing either selected rate does not change the other.
Updating on-chain terms requires a new transaction review; the total publication
fee depends on the resulting transaction size.

Existing version-1 grants retain their absolute cap. Their display/export is
preserved; no rate is inferred from that cap. Replacing one with a rate-based
policy requires an explicit owner rate selection and a new version-2 record.
Legacy drafts and signed recovery receipts remain inspectable with their original
terms. Upgrading an unsigned task requires explicit rate selection; unresolved
original signed receipts still block duplicate preparation or signing.

Admission begins at height **970492**, whose independently verified Core parent
at 970491 is
`00000000000000000000c4a4a4121cb0fece4308ecee0003de2da0e5bdc7a3d1`.
No real-wallet transaction established this product boundary. Earlier lookalike
records cannot become v1 authority.

Fee-rate metadata version 2 begins at **970546**, with independently verified
Core parent 970545 /
`000000000000000000018bee4a1759e02b289063d6d5a9afe704dd68d50101dc`.
Earlier version-2 lookalikes remain inspectable rejected records. The verifier
checks this second parent independently while preserving the original discovery
boundary and all version-1 rules. Admission reports `supportedRecordVersions`,
`feeRateActivationHeight`, `feeRateActivationPreviousBlockHash`, and
`feeRatePolicyReady`; the fee-rate writer requires complete coherent evidence
and matching pins before preparing a transaction. Missing or mismatched new
admission evidence cannot silently fall back to an absolute-cap grant.

## Verified reads

`GET /api/v1/permissions` provides wallet/search discovery and bounded snapshot
pagination. `GET /api/v1/permission?txid=<grant>` returns terms, complete history
and the current version/status. Every authority response binds the current Core
tip, confirmed input authority and contiguous independent raw-block discovery
to the index's sealed ledger witnesses. The scanner checks all raw protocol
carriers, including malformed Permission candidates, and cannot infer absence
from a filtered feed. A changing tip, missing block, reorganization or unavailable
witness closes current-status checks and human publication admission.

Discovery catches up through bounded requests. A budget failure retains only
whole blocks whose complete indexed raw carriers have already been independently
checked against Core. That private prefix is not a grant response or permission
to write. A retry rechecks the activation parents, Core target and prefix hash,
then reauthenticates the prefix's compact index descriptors, exact row flags and
native storage commitments in a read-only exact-checkpoint transaction. It
resumes Core/raw comparisons after the verified prefix. The public rolling
witness remains the same as a complete uninterrupted scan.

Identical checkpoint reads share one attempt; different checkpoints in the same
authority scope serialize, with queue waiting included in each request's
existing read budget. Byte limits and final Core/index/fee-parent fences remain
in force. Incomplete catch-up stays unavailable, including `limit=1`; pending
visibility remains provisional. Prefix metadata is rechecked on retries, so the
repair removes repeated raw/Core comparisons rather than all repeated work.
Progress lives only in bounded process memory. A cold API restart begins fresh
catch-up; there is no database marker, background service or persistent cache.

`GET /api/v1/permission?txid=<record>&inspect=1` inspects a single first-party raw
record when complete discovery is unavailable. It explicitly reports current
status unverified and cannot enable signing, replacement or revocation.

The `.env`-style export is public display data. Never execute it, shell-source it,
or treat its text as instructions.

## Local controller and credentials

Local project configuration contains references only:

```dotenv
unisat_permissions="<confirmed-permission-txid>"
unisat_password_secret="unisat_local"
```

`unisat_local` identifies a protected system-keyring secret. Creating the item
does not automatically connect it to UniSat. These settings belong to the
Permission controller, not a native UniSat or Codex unlock API. UniSat retains
keys; Permission never collects passwords, seeds or private keys on the website
or chain. Agent-readable `.env` files must not contain the wallet password.

The controller under `local/permission-controller` uses typed requests, a
durable wallet-wide journal, exact grant/wallet checks and an independently
protected signing boundary. Local and cloud callers require that owner-controlled
host to be available. Budget reset is midnight UTC across all agents and grant
versions for the wallet. Limits measure net proof debit from the pinned wallet:
outgoing payments, protocol fees and miner fees, less outputs returned to that
wallet (including self signals and change). WORK authority has separate quantity
and price limits. Pending and uncertain outcomes continue reserving capacity. Retrying,
restarting or replacing a grant must not erase commitments. WORK quantities,
open listings and sale price constraints require independent asset accounting.

Autonomous signing is **closed in v1 until its real bridge and process isolation
are verified**. Stock UniSat has no documented website password-unlock/keyring
API. A same-session Login keyring and unrestricted wallet UI access do not form
an enforcement boundary. The shipped controller refuses unverified bridges and
does not claim that on-chain immutability prevents a holder of unrestricted
wallet access from bypassing a policy. Immutability protects the record; the
isolated signer enforces its limits.

Human grant management supports a mainnet P2PKH UniSat address beginning with
`1`. Unsupported accounts are refused before preparing funding or requesting a
signature. The writer verifies exact previous transactions and wallet scripts,
requests `SIGHASH_ALL` for every input, and checks the final signed transaction
against the reviewed intent and its output commitments before broadcasting.
Human grant management can ship while the autonomous gate remains closed. Any required
real-wallet unlock, signature or broadcast during acceptance is brought to the
owner with exact action, wallet, outputs, carrier, fee and expected TXID for
review. No unattended signing activation is implied by product publication.

## Validation and release

Run `npm run check:permission`, the affected browser and UI contracts, ledger/math
regressions, repository hygiene and scoped deployment checks. Preserve accepted
live node overlays and native witness storage accessors. UI release V5 includes
all 22 managed roots and preserves V3/V4 recovery history. Completion requires
`npm run check:release-sync` across GitHub main, primary main, preview and live UI.
