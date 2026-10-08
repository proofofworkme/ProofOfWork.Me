# ProofOfWork Pages

Pages is the local-first HTML page and app authoring workspace for the
ProofOfWork Computer. It reuses confirmed identity resolution, verified HTML
Files, Browser previews, and Mail transaction review.

The Pages production candidate is approved for release at
`pages.proofofwork.me`, alongside Computer Pages. Deployment acceptance must
verify the exact committed source, hostname, headers, API coverage and local
preview; source support alone is not a production verification receipt.

## Routes

```text
pages.proofofwork.me        standalone authoring surface
/?pages=1                  local standalone preview
/?folder=pages             Computer workspace
```

Pages runs without a connected wallet for local authoring. Connecting a wallet
provides an account-scoped draft collection and the existing Mail publication
tools. ID registration remains on IDs, and asset management and trading remain
in their existing workspaces.

## Authoring

- Start a new page or an interactive app from the included templates.
- Edit the complete HTML document, including inline CSS and JavaScript.
- Set a page title, select a local draft, and return to saved source.
- Import an HTML file, copy its source, or download an HTML document.
- Load HTML by transaction ID through the existing Browser transaction reader.
- Import a verified HTML file from the connected Computer Files collection.
- Resolve a confirmed ProofOfWork ID and insert its identity markup into the
  source. The owner and receiver remain distinct fields.

Importing a file or first loading a transaction creates a local draft. Loading
the same unchanged transaction source reselects or refreshes its existing draft.
Editing the draft never changes the original file or confirmed transaction. Source
provenance describes the imported record; it does not make later local edits
chain-confirmed. Unavailable or pending identity records cannot become resolved
identity markup.

Pages uses the first-party API readers already used by Computer, Files, IDs,
and Browser. HTML publication introduces no registration, identity mutation,
registry fee, or new external content carrier. The separately gated DNS link
record below binds an existing root name to an existing published transaction.

## Preview and app execution

Preview starts in the existing Browser static rendering mode. Scripts and
external requests are disabled for both pending and confirmed HTML. Loading a
chain page or importing HTML never starts JavaScript.

The separate **Run app** action deliberately starts inline JavaScript in an
opaque iframe with only the `allow-scripts` sandbox permission. A trusted
first-party bootstrap in the local runner receives bounded, sanitized source through its
URL fragment; no message listener or signing bridge accepts requests from the
app. The runner's scoped HTTP policy permits its first-party bootstrap and
inline app scripts while blocking
external subresources, connections, frames, workers, and
form submissions. The iframe has no same-origin permission, popups, top
navigation, or wallet provider. A local interactive app can use in-memory page
state. It cannot call a live API or request a wallet signature through the
preview.

Inline script can attempt to navigate its own frame. Pages installs a parent
`frame-src 'self'` policy, also enforced by production serving headers, to
contain external document navigation. The runner's content policy alone is not
a complete navigation boundary. The production release must verify both
policies and the runner's HTTP sandbox. Local development must use equivalent
runner headers when testing this boundary.

Stopping the app returns to the static preview. Source edits, imports, draft
changes, and account or network changes stop execution. Run state is not saved
or restored with a draft. The public Browser continues to render published
HTML statically; publication does not grant app execution or signing authority.

## Publication through Mail

**Review publication** stages the exact draft HTML in the existing Mail
composer, either as a `pwm1:m` HTML body or a normal `text/html` file using
`pwm1:a` attachment chunks. Pages does not sign or broadcast this action.
Connect a wallet before staging; its address is the initial recipient. The user
can choose the destinations, proof payments, and miner fee in Mail.

Standalone Pages opens this composer on its own origin. Computer Pages opens
the existing Computer composer. Both share the existing Mail preparation,
transaction review, local wallet signing, broadcast tracking, and recovery
rules. An existing unsent Mail draft must be resolved before Pages can stage a
publication; Pages must not overwrite it. Canceling publication preserves the
local Pages source.

Mail enforces its existing aggregate 100,000-byte OP_RETURN script limit and
60,000-byte raw attachment limit. A large draft can remain local and be
downloaded even when it cannot fit a single publication. Confirmed published
HTML is readable from its transaction ID through Browser and appears in
Files/Desktop under their existing confirmed mail/file rules. Pending visibility
is not durable publication.

Pages and Browser share the existing HTML authoring activity attribution.
The publication's Mail/Files proofs and any valid WORK attachment are counted
through their existing lanes once. Local edits, downloads, previews, and app
runs add no chain event or duplicate Growth/WORK network value.

## Root .pow page links

Pages includes a **DNS page linking** card. A connected Mainnet root
owner can enter `alice` or `alice.pow` and the transaction ID of confirmed HTML,
then review a set or clear action with the shared miner-fee control. The target
must pass Browser's existing transaction/attachment checks and be confirmed.
Linking never publishes an unsaved draft. Only an unchanged source imported as
confirmed supplies its txid automatically; editing that source removes this
automatic suggestion. A manually entered published txid is verified again.

The additive `pwdns1:page1` record names the current root ownership event and
either sets a lowercase page txid or clears the existing link. Every input
must belong to the current confirmed root owner. At least 546 proofs return to
that owner before the record, plus the miner fee; this is a self-payment, not
a registry fee. Registration, payment-address resolution, and AMO fees retain
their existing rules. A transfer or purchase invalidates the previous page
link even when ownership returns to the same address. See
[`PROOFOFWORK_DNS.md`](PROOFOFWORK_DNS.md) for the exact wire and replay rules.

Browser accepts `alice.pow`, reads a confirmed active link bound to complete
root and page-link history at one verified checkpoint, and opens the referenced
HTML transaction using its normal static renderer. Unavailable coverage,
cleared or invalidated links, pending records, and pending target pages never
become a working name route. Names do not redirect to arbitrary external URLs,
and resolving a name grants no scripts or wallet access.

Set and clear actions use the existing exact transaction review, local wallet
signature, broadcast tracking, and browser-local action receipts. Canceling
review requests no signature. Restoring a receipt restores task fields and
checks current ownership, epoch, target, and funding again; the receipt itself
does not authorize resolution. A broadcast remains pending until confirmation.

The approved mainnet opening is **970426**, pinned by
`DNS_PAGE_LINK_ACTIVATION_HEIGHT = 970426`. The canonical predecessor at
970425 is `00000000000000000001a22c08622961c9fc0a1b063510bf5fc9141577b77537`,
verified against Core and the canonical index at shipping preflight. Production
writes still require complete independent page-link raw discovery and one
verified checkpoint; unavailable coverage fails closed. A zero boundary remains
an explicit disabled mode for fixtures or future configuration. Page-link self-payments add no new
Growth/WORK contribution and do not count the target's publication a second time.

## Local drafts

Draft collections live in browser `localStorage`, scoped by network and exact
connected address. Disconnected authoring has its own scope:

```text
proofofwork.pages.drafts.v1.<network>.<encoded-address-or-disconnected>
```

The version-one collection holds up to 20 drafts and contains `version`,
`activeId`, and `drafts`.
Each draft records its ID, title, exact HTML source, update time, and optional
import provenance. Saving source is local convenience, not an on-chain record.
Pages drafts are separate from Mail drafts and are outside the current
organization-backup allowlist. Download HTML to carry a source document to
another browser or device. Wallet keys and seed phrases are never stored.

## Local verification and release preparation

The local model and protocol boundary checks are reproducible with:

```bash
node --test src/features/pages/pagesModel.test.mjs
npm run check:dns-pages
npm run check:ui
npm run check:surface-read-state
npm run build
```

The browser fixtures in `tests/browser/pages.spec.mjs` and
`tests/browser/browser-dns-pages.spec.mjs` cover authoring, isolated execution,
review cancellation, owner/coverage refusals, and name resolution with strict
production content security policies. They use synthetic chain responses;
they never establish production activation or request real signatures.

Run the ordinary development server and inspect standalone Pages first:

```bash
npm run dev
```

```text
http://localhost:5173/?pages=1
http://localhost:5173/?folder=pages
```

The focused production build switch is:

```bash
VITE_PAGES_ONLY=1 VITE_POW_API_BASE=https://pages.proofofwork.me npm run build
```

The user approved hosting and release scope. The V4 UI contract covers all
21 managed surfaces, preserving the existing 20 products and their rollback
history. Before publication,
verify same-origin first-party API access and serving security headers, and
audit the exact standalone bundle before Computer integration. Preserve the
current release and rollback evidence. Local route/build support is not proof
that the public domain is serving Pages.

Release completion includes the mandatory four-way source check: production UI,
GitHub `main`, primary local `main` and its rebuilt preview must match the release
commit. See [deploy/pages/README.md](deploy/pages/README.md) and the synchronization
rule in [OP_RETURN_INFRASTRUCTURE.md](OP_RETURN_INFRASTRUCTURE.md#mandatory-release-synchronization).
