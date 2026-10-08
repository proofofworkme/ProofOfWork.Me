# Local Permission controller

This is a runnable local Permission v1 controller foundation. The packaged
service reads current canonical grants, validates typed requests, and reports
wallet-wide budget evidence. **Autonomous UniSat signing is disabled.** Setting
`autonomousSigning: true` makes the packaged service refuse startup. No verified
isolated browser bridge or production action-building adapter is shipped here.
No live wallet, password, seed, private key, grant transaction, or broadcast was
used to validate this package.

Requirements: Linux and Node.js 22.13 or newer with `node:sqlite` available.
Production already uses Node 24. Node 22 may print its experimental SQLite
notice. The package has no additional npm dependencies.

## Run and inspect

Run the fixture-only checks from the repository root:

```bash
node local/permission-controller/controller.test.mjs
node local/permission-controller/cli.mjs
```

The second command prints usage and exits with status one because it has no
command. To install a controller, the owner must first provision a private
service account and service-owned directories; this package does not create OS
accounts, change browser profiles, or configure keyrings. Copy
`config.example.json` into a service-owned file with mode `0600`, replace its
wallet address, exact wallet output script, confirmed active grant/head TXID,
UIDs and paths, and keep `autonomousSigning` false. The all-zero example TXID and
script are placeholders, not wallet evidence.

The state directory must have mode `0700`. The socket's parent must be owned by
the service and not writable by its group or others. Provision a random
64-character lowercase hexadecimal access token in a service-owned `0600` file;
it is a controller API capability, never a wallet credential. These explicit
commands operate only on the owner's installed configuration:

```bash
node local/permission-controller/cli.mjs serve /absolute/private/config.json
node local/permission-controller/cli.mjs call /absolute/controller.sock /absolute/access-token /absolute/inspect-command.json
node local/permission-controller/cli.mjs call /absolute/controller.sock /absolute/access-token /absolute/plan-command.json
```

`inspect.example.json` and `plan.example.json` show the command formats. The
packaged socket has mode `0600` and supports the service user's inspection client.
Opening access to a different execution account requires an independently
reviewed transport/OS permission setup. A cloud agent can use the same local
controller through a separately authorized secure relay; there is no public TCP
listener or cloud wallet credential distribution in this package.

All calls use an authenticated HTTP request over the Unix socket. Supported
methods are `inspect`, `plan`, `receipt`, and `execute`; packaged `execute`
fails closed. Receipt lookup takes the controller-generated `requestId`.
Inspection and planning do not reserve a budget or touch the keyring. Starting
the service initializes its durable local journal.

## Grants and request boundary

The owner pins the wallet, its output script, the current grant/head TXID, and
the canonical API origin in private service configuration. Requests cannot
substitute a grant, wallet, endpoint, credential, agent identity or signing
method. Permission v1 has no expiry and no named-agent binding. Any separately
authorized executor may submit a typed request against the pinned grant.
Append-only replacement/revocation remains canonical history; a stale head,
revoked grant, incomplete read, stale timestamp, changing tip or wrong wallet
fails closed.

`CanonicalPolicyApi` reads only
`GET /api/v1/permission?network=livenet&txid=<pinned>&fresh=1` from the owner's
configured first-party verifier. HTTPS redirects are rejected; HTTP is allowed
only on numeric `127.0.0.1`. The exact API detail envelope must provide:

- `complete`, `currentStatusVerified`, and `eventsComplete`, all true;
- matching `grantTxid`, `permission.txid`, historical wallet and current wallet;
- active status and `currentPermission.headTxid` equal to the pinned TXID;
- canonical policy and `evidence.complete`/`authorityVerified`, both true;
- equal `{height,hash}` checkpoints in `evidence.checkpoint` and top-level `tip`;
- the verifier's ISO `evidence.verifiedAt`, no older than 15 seconds.

This is trust in an owner-pinned canonical verifier, not an independent SPV or
full-node proof implemented by this controller. The verifier must itself prove
complete current chain history and author authority. Raw carrier inspection
alone cannot establish that an immutable grant remains active.

Typed actions are `mail.send`, `boost.post`, `amo.listwork`, `amo.sealwork`,
`amo.buywork`, and `publish.article`. The strict request schema lives in
`schema.mjs`; amounts are canonical whole-proof/subatom decimal strings. The
current WORK listing face is exactly `25000` proofs. Arbitrary PSBTs, raw
transaction hex, raw message signing, secrets, seed phrases, private keys and
unknown request fields are rejected. Initial mail requests do not support WORK
attachments, file attachments or arbitrary output construction.

`operationId` identifies an intended operation, not an agent. A deterministic
request ID binds the operation's complete normalized request to the wallet and
network. The journal rejects reuse of an operation ID with different content.
The grant TXID is deliberately excluded from that ID so replacing a grant does
not authorize signing the same operation again.

## Transaction adapters and UniSat bridge

`PermissionController` accepts owner-installed action adapters through its
programmatic constructor, never through agent request data. Each adapter must
implement `prepare`, an independent `verify`, and `recheck`. The verifier must
derive exact outputs, funding prevouts, protocol bytes, recipients, WORK amounts,
pricing, tickets, open listings and permitted signature scope from typed intent
and current canonical state. Relabeling supplied transaction metadata as
"verified" is insufficient. No production adapter is installed in the CLI, so
`plan` returns explicit inspection-only status rather than a fake executable
transaction.

The generic transaction layer verifies version-zero PSBT framing, the exact
unsigned transaction, exact prevouts/values/scripts, outputs, change script,
wallet proof debit, miner fee, recipient restrictions, WORK caps/pricing/listing
constraints and complete wallet input signing scope. It checks that returned
signed transactions preserve the reviewed shape and permitted sighash types.
Initial final-signature decoding supports native Taproot key-path and native
P2WPKH inputs only; other wallet/script paths fail closed. Chain signature
validity remains a separate canonical broadcast verification responsibility.

`DisabledUniSatBridge` documents the required future `readiness`, `signExact`,
and `broadcastExact` interface. Stock UniSat's public API does not supply a
password-unlock or policy-enforcement bridge. Unlocking a wallet is also
separate from approving signing requests. Installing a keyring item does not
connect it automatically to the extension.

The library rejects autonomous execution when agent UIDs include the controller
UID or root, when reviewed isolation evidence is absent, or when the bridge's
wallet/network/evidence hash differs from configuration. Those checks are
necessary checks, not proof of isolation by themselves. A future bridge needs
independent review proving the agent cannot access the wallet profile, UI,
credentials, configuration or signer through another route. The current CLI
refuses autonomous startup regardless of flags or claimed evidence.

`SecretServiceReferenceAdapter` contains an inactive Secret Service lookup
adapter. It stores only an item reference, uses fixed `secret-tool` arguments
without a shell, requires isolated execution plus separately approved exact
transaction consent, never exposes a secret through a service response, and
clears its own temporary buffers after use. It is not called by the packaged
service or tests. Memory clearing cannot erase copies made by an OS library or
a consuming bridge. Secret access and real-wallet operations require separate
owner consent; seed phrases and private keys are never an input to this package.

## Durable wallet-wide budgets and recovery

All local and cloud executors for a wallet must use one authoritative controller
database. Different databases cannot enforce a shared budget. SQLite uses WAL,
`synchronous=FULL`, and `BEGIN IMMEDIATE` reservations; wallet, network and wallet
script are immutable database bindings. Do not delete or replace the journal to
change a grant or reset a budget.

Daily limits use UTC. Committed proof debit includes miner fees and subtracts
outputs returned to the pinned wallet; asset limits remain separate. Reservations,
signing attempts, signed transactions, uncertain broadcasts and pending
transactions consume capacity across midnight until positively settled or
otherwise safely resolved. Confirmation charges both its authorization and
settlement UTC dates, once per date. A backwards UTC date fails closed. A trusted
OS clock is required; restoring an old database or manipulating the host clock
is outside an agent-safe enforcement boundary.

Raw signed recovery evidence and the TXID are persisted before broadcast. A
signing failure may have produced a valid signature, so it preserves the hold.
Unknown broadcasts and repeated requests return retained state rather than
signing again. Timeout or absence from mempool is never evidence that a signature
cannot settle. Revocation stops new authorizations; it does not cancel signatures
already issued. The CLI intentionally provides no requester-controlled budget
reset, reservation release, ledger status mutation or blind rebroadcast endpoint.
A future reconciliation adapter must prove terminal state against canonical
transaction/prevout evidence before releasing a signed hold.

The tests use artificial transaction/signature fixtures and a fake bridge. They
prove controller refusal, exact transaction checks, simultaneous SQLite budget
reservation, idempotency, persistence across replacement/midnight, and retention
of uncertain outcomes. They do not establish a live isolated UniSat bridge or
end-to-end autonomous signing.
