# ProofOfWork.Me Soul

This file is operating memory for future agents.

It is distilled from current repository docs and public launch memory captured through 2026-06-08. It is not a protocol spec. When this file conflicts with `README.md`, `PROOFOFWORK_IDS.md`, `OP_RETURN_INFRASTRUCTURE.md`, `MAIL_ORGANIZATION.md`, or the source code, the protocol docs and code win.

## Source Memory

- Public account: `@proofofworkme`
- Launch memory reviewed: 2026-06-08
- Full 2026-06-09 archive re-reviewed: 2026-06-17
- Operational memory updated: 2026-06-20
- Public archives reviewed: `/home/sixer/Downloads/twitter-2026-05-19-4780579747040c69c6ee36267c276b61d1375ffa6de1fde07a0d945892fafea7`, `/home/sixer/Downloads/twitter-2026-06-09-4780579747040c69c6ee36267c276b61d1375ffa6de1fde07a0d945892fafea7`
- Core domains: `www.proofofwork.me`, `proofofwork.me`, `id.proofofwork.me`, `computer.proofofwork.me`, `desktop.proofofwork.me`, `browser.proofofwork.me`, `marketplace.proofofwork.me`, `credit.proofofwork.me`, `token.proofofwork.me`, `tokens.proofofwork.me`, `wallet.proofofwork.me`, `work.proofofwork.me`, `infinity.proofofwork.me`, `log.proofofwork.me`, `growth.proofofwork.me`

## One Sentence

ProofOfWork.Me is the ProofOfWork Computer: a local-first, on-chain, agent-readable computer where ProofOfWork transactions become mail, identity, files, applications, proposals, payments, and proofs of work.

## Core Thesis

ProofOfWork is not only money. ProofOfWork is proofs.

ProofOfWork is the source of truth for agents and humans because confirmed chain data cannot be silently edited, injected, rug-pulled, or replaced by a server. Agents can reason against immutable records. Humans can observe, approve, sign, and carry responsibility. The UI exists so humans can see and decide; the chain exists so agents can verify and act.

The project turns attention, communication, identity, and application distribution into ProofOfWork-native flows:

- If someone wants your attention, they can attach proofs.
- If someone wants to claim an identity, they prove it on chain.
- If an agent needs reliable instructions, it reads immutable data.
- If an app needs a payment address, the address lives in tamper-resistant data.
- If a proposal matters, it can be signaled with proofs.

## Product Beliefs

1. The source of truth is the chain.
2. Confirmed records are canonical. Pending mempool visibility is useful gossip.
3. Wallet signing stays local. The app must never hold seed phrases or private keys.
4. Agents can propose, construct, verify, and summarize. Humans approve and sign.
5. Spam becomes expensive when attention requires payment.
6. The inbox should respect value. Highest proofs is a first-class sort.
7. ProofOfWork IDs are the global address book for humans and agents.
8. Every confirmed ID is a network-effect increment.
9. OP_RETURN is an application substrate, not a toy memo field.
10. The 100 KB OP_RETURN budget enables small apps, files, manifests, messages, and agent-readable records.
11. Bigger content can be linked, chunked, concatenated, or referenced by future protocols.
12. The computer is local, modular, and malleable. Users should be able to run their own stack.
13. Self-hosting matters: Bitcoin Core, indexers, and ProofOfWork APIs make the system sovereign.
14. Domains, SSL, hosted servers, and public APIs can be useful, but they should become optional where ProofOfWork can carry the durable record.
15. The future setup is simple: Linux, VS Code, Codex, ProofOfWork, a local wallet, and the ProofOfWork Computer.
16. Humans in the AI era become storytellers, signers, taste-makers, and responsibility bearers.
17. Agents need tamper-free data more than they need traditional web accounts.
18. Proofs are a better dopamine signal than likes, retweets, and rage bait.
19. The most important work should be visible to agents in a form they can verify.
20. Build for agents first, but let humans observe, join, and steer.

## Launch Memory

The archive captured a live Phase 1 ignition, not a polished brand campaign.

- 2026-05-06: mainnet experiments, early tx proofs, "Are you ready for the future of ProofOfWork?"
- 2026-05-07: the ProofOfWork Computer thesis hardens; IDs, registry, local backups, private-key-as-computer, `bitcoin@proofofwork.me`, `registry@proofofwork.me`.
- 2026-05-08: Phase 1 opens; `id.proofofwork.me` and `computer.proofofwork.me` become the center; countdown to 100 IDs; files, paid inbox, immutable markdown, and the "final network" story emerge.
- 2026-05-09: duplicate registration refunds, full node/indexer urgency, dropped-tx handling, application framework, canceled Ordinals exploration, on-chain agents, and agent-readable business data.
- 2026-05-10: node-backed API updates, self-hosting instructions, OADS, contacts, open agent development, app distribution, streaming proofs, autonomous micro-applications, and the one-person/agent business thesis.
- 2026-05-11: ID transfers go live, PowIDs begin behaving as ProofOfWork-native assets, and the public model turns IDs, Mail, Files/Drive, and aggregate ProofOfWork Computer value into one measurable network-effect thesis.
- 2026-05-12: Marketplace and registry thinking hardens around one event stream, 546-proof mutations, registrar recourse, responsible UTXO management, and agent-readable accountability.
- 2026-05-13: Browser becomes a first-class app and Computer workspace; HTML message bodies and verified HTML attachments render from txids. Bug bounty practice begins with credited, paid, tx-backed reports. Public surfaces converge around IDs, Computer, Desktop, Browser, Marketplace, Log, and Growth.
- 2026-05-14: Credit thinking lands: credits are businesses with creator-owned registries. A macro credit index records creation, while mints pay each credit registry directly. Marketplace UTXO reservations become a safety invariant.
- 2026-05-15: Credits and WORK become first-class production surfaces. `credit.proofofwork.me` creates and mints credits; `work.proofofwork.me` is the dedicated WORK dashboard. WORK launches with 21,000,000 max supply, 1,000 WORK per mint, 1,000 proofs per mint, and the `work@proofofwork.me` registry.
- 2026-05-16: WORK gets a permanent floor formula, UTXO preparation, Mint Assistant, and explicit fee dashboards. The floor is confirmed ProofOfWork Computer network value divided by 21,000,000 WORK, separate from the 1 proof/WORK mint price.
- 2026-05-17: Production performance hardens around a uniform node-backed cached snapshot path. WORK, Credit, Log, Growth, and registry pages must refresh against current full-node data without dragging huge ledgers through every view.
- 2026-05-19: Credit transfers enter the protocol as `pwt1:send` events. Wallet becomes the non-custodial credit surface: connected-address balances, confirmed-only canonical ownership, pending transfer visibility, and UniSat-local signing.
- 2026-05-18: Shared architecture and API work accelerate. Broadcasts prefer the ProofOfWork node path after local signing, and RPC errors should be structured enough for users and agents to understand.
- 2026-05-19: WORK enters the final mint sprint. Mint-out semantics are clarified: confirmed supply is canonical; pending mints are mempool pressure; UI actions pause when confirmed plus pending would fill remaining supply. WORK floor charts are corrected into real price charts with time on the x-axis and proofs/USD price per WORK on the y-axis.
- 2026-05-22: The Computer shell and standalone app surfaces converge into a full dark UI overhaul. Desktop, Browser, Marketplace, Credit, Wallet, WORK, Log, and Growth are made shell-compatible with scrolling, aligned controls, pagination over large datasets, UniSat action wiring for buy/mint/list/delist/transfer flows, credit sale-ticket buys in wallet/log/growth accounting, and live node-backed BTC/USD shared by Credit, WORK, and Growth.
- 2026-05-24: Marketplace and data freshness harden. Public app chrome becomes sticky so status stays visible while users scroll. Marketplace credit stats become scoped to the selected credit, active books expose All/Sealed/Unsealed listing views, credit sales/listing logs are paginated and ordered by confirmation time, and spent sale-ticket outpoints remove listings from active books immediately. Fresh marketplace, WORK, credit summary, and credit history reads must refresh canonical credit payloads before returning; cached snapshots are for first paint only.
- 2026-05-25: WORK marketplace copy and UI separate visible intent from executable price. Unsealed listings can appear in active books, but sealed sale-ticket listings set the buyable ask, buyer arb, and social order-book story. Dropped or RBF-replaced pending buys must not become fake sales.
- 2026-05-26: Token-market presentation becomes a mint directory first: mint progress, confirmed supply, registry, and sale-ticket books are separated from price/arb sorting. PowID market posts begin treating names as live assets with active and sealed buyer-funded transfer listings.
- 2026-05-27: PowIDs become the root of the staged social thesis. Profiles, posts, follows, likes, reposts, replies, tips, and social earnings should resolve through confirmed PowIDs and pay the immediate target's confirmed receiver, but this belongs to the staged `pwc1:` Confessions/social protocol, not to canonical `pwid1:` registry mutations.
- 2026-05-28: The daily WORK/PowID social playbook enters `SOUL.md`: agents should refresh live APIs, use confirmed-only numbers, filter sealed books correctly, calculate buyer arb, and include reserve basis from confirmed secondary buys before posting.
- 2026-05-29: The four-part market cadence hardens in public: WORK mint-to-floor, WORK sealed book, PowID order book, and WORK reserves. Repeated screenshots and short posts are launch evidence, but every number in them is historical unless reproduced from the current first-party ledger.
- 2026-05-30: Real Computer use becomes part of the public proof stream. Human messages, replies, Gmail displacement, and posted WORK purchase txids show the Computer as a working inbox and market, not only a dashboard.
- 2026-05-31: The archive enters a noisy credit-and-post-money mythology cycle. Preserve the durable product signal only: credits, bonds, and WORK are being used to teach payment-backed attention and confirmed value loops; slogans about infinity are not implementation authority.
- 2026-06-01: One-person-plus-agent operation becomes explicit. The workflow is to build, fix, verify, post, archive the chat, and continue. Relationship-specific meta protocols are imagined as small shared records that future agents can read for context, but the chain/API remains the verifier.
- 2026-06-02: The language migration becomes explicit. Public surfaces should say ProofOfWork Computer, ProofOfWork history, proofs, and credits. Protocol/API field names stay exact, but product/social language should not drift back into legacy token/base-unit/Computer framing except when quoting historical data or code.
- 2026-06-03: Credit language replaces token language in the product voice: mint credit, transfer credit, list credit, and settle credit sale tickets on ProofOfWork. `token.proofofwork.me` and `tokens.proofofwork.me` remain redirects, not the public vocabulary center.
- 2026-06-04: Infinity Bonds and `$POWB` become part of the public value story. Bond transactions are high-value ProofOfWork Computer actions whose confirmed proofs can belong in Log, Growth, and WORK floor inputs when the canonical ledger recognizes their protocol tags. Fee priority becomes part of action intent: bonds can justify high fees, while ordinary messages/files can remain low-fee.
- 2026-06-05: WORK floor accounting is corrected to reconcile every confirmed protocol tag across Log, WORK, and Growth, including IDs, mail, files, credits, marketplace, RUSH, and Infinity Bonds when enabled. "Chain truth, no vibes" becomes the operating test: if the floor, log, and growth number disagree, the ledger path is wrong.
- 2026-06-07: WORK, Growth, Log, and credit/token history converge on one canonical livenet ledger snapshot. Confirmed Computer mail events, Infinity Bonds, credit sales, and participant searches must be merged into that shared ledger before network value is computed. The `/api/v1/consistency` endpoint and `npm run audit:ledger` guard that seeded Computer mail events are logged, known pagination-gap transactions are searchable, Growth and WORK share the same snapshot/value, and missing log events stay empty.
- 2026-06-07: Public market copy hardens around agent-readable books. PowID and WORK order-book posts should make the machine-readable point: names, prices, listings, seals, and sales are chain-readable records that agents can read forever.
- 2026-06-08: Live USD accounting is split from model USD. Current public numbers should use node BTC/USD and `actualValue.totalUsd`; `modelTotalUsd` remains a comparison field, not the live quote. The daily social close expands to include `$WORK $POWB` when the post is about WORK, PowIDs, floor, bonds, or confirmed network value.
- 2026-06-12: WORK and credit marketplace replay hardens around sale-ticket truth. Confirmed and pending WORK listings are promoted through the same canonical credit payload, pending WORK mints count against user-facing availability without changing confirmed supply, duplicate listing seals are blocked, Wallet owned-listing views are reconstructed from active and closed sale-ticket state, and WORK mint summaries replay from canonical mints instead of stale partial summaries.
- 2026-06-16: WORK sale-ticket reconciliation hardens against Bitcoin Core spend truth. Confirmed delistings and buys must clear active books in Marketplace and Wallet even while summary payloads warm; closed listings, sales, market logs, Growth, and Log all derive from the same sale-ticket lifecycle instead of separate surface-local caches.
- 2026-06-18: The proof index reaches default-read posture for major confirmed surfaces. Stable confirmed Log, registry, credit/token, marketplace, WORK, Growth, event-history, and tx-status reads use the PostgreSQL read model with node/API fallback. The node remains the source for fresh reads, mempool/unconfirmed visibility, dropped tx checks, signing support, broadcasts, raw tx/UTXO/outspend edge cases, and verification.
- 2026-06-19: The database cutover is hardened by complaint-driven repairs across Mail, Log, Event History, WORK, and Marketplace. Confirmed `pwm1:m:powb` messages are normalized as Infinity Bonds everywhere they matter while still projecting into Inbox/Sent; self-sends must appear in both mailbox directions after confirmation. WORK delistings, sale-ticket spends, and confirmed buys must be visible in Wallet, Marketplace, Log, token history, and Growth from the same proof-index state.
- 2026-06-20: The health contract for the ProofOfWork Computer is explicit: `audit:ledger`, `indexer:parity`, `check:mail-regressions`, `check:marketplace-regressions`, and `check:live-data` must stay green on production, with `missingLogEvents: []`, populated participants/refs search indexes, and Log/Event/summary surfaces sharing the same livenet snapshot. Pending database rows are mempool visibility only; confirmed records remain canonical and externally verifiable by txid.
- 2026-06-22: WORK and credit marketplace summaries harden around confirmed sealed inventory. Marketplace summary compaction must never drop confirmed, unspent, buyable sealed listings just because they are older than the recent listing cap; public Marketplace summary reads must pass through the reconciled sale-ticket lifecycle instead of returning a stale proof-index summary snapshot. The UI contract is now precise: Sealed means confirmed and buyable, pending seals stay visible in All/Unsealed as sealing status, and wallet refreshes preserve local pending listings/seals until canonical data catches up.
- 2026-06-23: Infinity Bonds become a first-class POWB market. A confirmed `pwm1:m:powb` bond mints POWB to the recipient address one-for-one with proofs sent; self-sends credit the sender only because the sender is also the recipient. POWB uses `infinity@proofofwork.me`, has no max supply, trades through the existing credit sale-ticket lifecycle, and has a standalone `infinity.proofofwork.me` surface. POWB floor value is confirmed bond network value divided by confirmed POWB supply, and POWB sales/mutation fees also back the broader ProofOfWork Computer/WORK network floor.
- 2026-06-23: Mail subject/body projection hardens. `pwm1:s` is header metadata and `pwm1:m` is the body; proof-index mail rows and read-time repairs must never let Log detail replace the actual message body. Historical WORK floor mail tx `cbb8a1b4af2ea8665129e799a85dfba31cea87ef38b9a99bcf198d827c12a58c` pins the regression contract.
- 2026-06-25: The audit cadence becomes explicit. Audit the standalone public surfaces first: Home, IDs, Desktop, Browser, Marketplace, Credit, Wallet, WORK, Infinity, Log, and Growth. Audit `computer.proofofwork.me` last because it is the integrated ProofOfWork Computer shell over those same protocols, workspaces, and read models. A complete audit fixes the found issue, verifies against first-party API and chain-derived regression gates, deploys only after the production surface is checked, commits the exact scope, and ends with short public copy explaining what was hardened. The final Computer audit hardened false-zero loading states, sender-side file recovery from raw transaction truth, and stale snapshot rejection for WORK, Growth, and Marketplace summaries.
- 2026-06-27: Final audit follow-up hardened the sale-ticket summary path. A valid `seal5` spends the listing sale-ticket anchor to publish seller terms, but that seal spend is not a close, delist, or sale. Marketplace, WORK, Wallet, Log, and Growth summaries must recover confirmed sealed listings from canonical token state and proof-index credit-listing projections, ignore stale `closeTxid === sealTxid` projection rows as active sealed inventory, and keep `/api/v1/marketplace-summary` aligned with the full token payload. Fresh Marketplace summary reads should honor the production wait window and return a reconciled fallback instead of a stale zero/empty snapshot or a 503 when canonical refresh is slow.
- 2026-06-29: The production handoff loop now includes public copy by default. When the user approves a workflow through production verification, commit, deploy, and push, agents should immediately provide tweet-ready ProofOfWork.Me copy unless the user explicitly says not to. The tweet is part of the proof stream, not an afterthought.
- 2026-07-02: The full-node shipping gate is explicit. No production change touching confirmed events, network value, Log, Growth, WORK, Wallet, Marketplace, or Infinity should ship until the exact affected public outputs are verified against first-party full-node/confirmed tx truth. PostgreSQL proof-index rows are a derived speed layer; if they disagree with chain truth, repair or bypass the projection before shipping, and never present stale zero, stale active listings, or missing confirmed event history as final data.
- 2026-07-04: WORK live/frozen network value becomes the active accounting contract. Live network value is the site-facing WORK floor source and reprices prior confirmed WORK movement at the current live floor; frozen network value is the immutable confirmation-time audit stamp. Only canonical WORK receives this credit-movement value lane. Other credits continue to add confirmed proof flows, registry/mutation fees, sale payments, and marketplace flow, but they do not reprice network value from illiquid floors. Fresh ledger reads must return a current checked snapshot covering the node tip, or fail closed instead of serving stale/lower values as refreshed.
- 2026-07-04: The block-index service becomes the active freshness loop. Confirmed Computer state should be warmed by a short block-scan worker cadence and served from current checked proof-index snapshots; public livenet routes must not turn a slow node/cache refresh into false zero dashboards. If full ledger consistency temporarily lags, the worker can publish non-OK summary-snapshot fallback rows from current proof-index reads while the ledger catches up. If a current snapshot is unavailable, the correct behavior is a closed retry state, not invented empty truth.

The emotional shape is a breakthrough moment: years of ProofOfWork/app experiments meeting modern agents and becoming legible all at once.

## Archive Themes

The full archive is not a neat roadmap. It is a public founder diary mixed with launch notes, product decisions, arguments, jokes, rage, music, and repeated stress testing in the open. Future agents should preserve the durable signal, not the noise.

- The project is a computer, not a collection of pages. IDs, Mail, Files, Desktop, Browser, Marketplace, Credits, Wallet, WORK, Infinity, Log, and Growth are facets of one ProofOfWork Computer.
- The anti-platform stance is central. Social media, ads, analytics dashboards, followers, likes, influencers, and conferences are weaker than chain-readable proofs, txids, and confirmed state.
- Distribution should collapse into the Computer. A future app can be a message, HTML body, attachment, txid, or registry record that agents and humans can inspect without trusting a mutable platform.
- Screenshots, quoted dashboards, and market tweets are launch evidence, not canonical data. They show what the founder was testing and teaching; agents must still refresh the current node/API before repeating any number or status.
- UTXOs are an organizational primitive. Good ProofOfWork UX should teach responsible UTXO management, explicit fees, split/prepared outputs, and PSBT review before signing.
- Human approval remains sacred. Agents can prepare, queue, repeat, diagnose, and verify. Humans sign. Wallets stay local.
- Recourse is a product feature. Owning the registrar and registries makes refunds, bug bounties, public ledgers, and accountable repairs possible in a way anonymous protocols usually cannot offer.
- Public fixes are part of the proof stream. When a bug is real, the expected loop is: identify the chain truth, patch the parser/UI/API, verify against live records, ship, commit, and explain it plainly.
- If a user-approved production workflow is verified, committed, deployed, and pushed, provide tweet-ready public copy immediately unless the user explicitly says not to.
- Measurement matters. IDs are network effects, logs are activity evidence, Growth is the modeled network-value mirror, and WORK turns that confirmed network value into a live credit floor.
- The founder treats WORK as proof-of-use. The credit is not only a ticker; it is the live demonstration that creator-owned registries, mint revenue, public dashboards, and chain-derived floors can exist on ProofOfWork.
- The one-person business thesis is practical, not just mythic. The Computer should let one human with agents publish, repair, sell, message, account, and prove work without a platform staff or traditional company stack.
- Credit registries are creator sovereignty. The macro index records creation, but each credit owns its registry, mint price, mint history, revenue lane, and responsibility to build.
- The public language has moved from legacy Computer/base-unit/token language toward "ProofOfWork Computer", "proofs", and "credit". Preserve protocol/API names exactly, but write public copy in the newer language unless historical context requires the old terms.
- `$POWB` and Infinity Bonds are part of the recent public mythology and metric loop. Treat them as confirmed ProofOfWork Computer actions only when the canonical ledger recognizes them; do not infer value from slogans or pending claims.
- Sealed order books are a core teaching surface. Active unsealed listings show intent; sealed sale-ticket listings show executable asks. Buyer arb is only meaningful against sealed, unspent, valid sale-ticket terms and the current confirmed WORK floor.
- PowID markets are not a side quest. Names are assets, inboxes, contact records, and agent-readable address records; listings, seals, and buyer-funded transfers are the market layer over that identity primitive.
- PowIDs are also the planned social payment lane. The archive repeatedly imagines profiles, posts, follows, likes, reposts, replies, and tips as paid actions routed through confirmed PowID receivers. Keep that in staged `pwc1:`/Confessions work unless the protocol docs say otherwise.
- Agents are expected to read the Computer like a ledger, not like a website screenshot. When posts claim floor, reserve, order-book, holder, sale, USD, or PowID counts, refresh the first-party APIs and make the math auditable.
- Minting is a launch primitive, not the whole protocol. Transfers, OTC, listings, richer markets, and creator tooling come after minting is correct, legible, and hard to misuse.
- The chain is the oracle, but pending pressure still matters to UX. Pending mints do not change canonical supply or floor, yet they can warn users away from likely overfill attempts.
- Speed and freshness are product integrity. Fast cached first paint is useful; a refresh that leaves stale data is a lie. Full-node truth must win after refresh.
- The archive repeatedly rejects complexity as status. Prefer simple records, clear fees, replayable parsers, direct registry payments, and UI that explains what the wallet is about to sign.
- The project is built in public with credited collaborators. Bug reporters, community testers, and architecture contributors should be credited by PowID where possible, but no contributor's implementation becomes sacred if it violates the standard.
- Public voice can be combative and mythic; product voice should be precise. Do not import personal attacks, slurs, enemies lists, or volatile emotional targets into docs, UI, protocol names, or agent behavior.
- Treat numerical social snapshots as historical, not permanent. Credit stats, prices, holder counts, pending counts, floor values, and projections must be read live from the current node/API when accuracy matters.

## Product Invariants

Future agents must preserve these unless the user explicitly asks for a migration:

- `www.proofofwork.me` is the canonical landing/router.
- `proofofwork.me` redirects to `https://www.proofofwork.me/`.
- `id.proofofwork.me` is the focused ID registry app.
- `computer.proofofwork.me` is the full mail/computer app.
- `desktop.proofofwork.me` is the public read-only file desktop.
- `browser.proofofwork.me` is the standalone public HTML renderer.
- Confessions is staged/local-only until a separate public launch is approved.
- `marketplace.proofofwork.me` is the standalone asset marketplace: IDs and credit sale-ticket markets are live.
- `credit.proofofwork.me` is the standalone credit creation and mint app.
- `token.proofofwork.me` and `tokens.proofofwork.me` redirect to `https://credit.proofofwork.me/`.
- `wallet.proofofwork.me` is the standalone credit wallet, transfer, listing, delisting, and sale-history app.
- `work.proofofwork.me` is the standalone WORK credit dashboard.
- `infinity.proofofwork.me` is the standalone Infinity Bond / POWB market and bond composer.
- `log.proofofwork.me` is the public read-only ProofOfWork Computer log for tx-backed ProofOfWork actions.
- `growth.proofofwork.me` is the public read-only growth dashboard for canonical ProofOfWork Computer network value versus confirmed chain-derived value in proofs and USD.
- Canonical mainnet registry address: `bc1qfwytlzyr3ym3enz2eutwtjsf9kkf6uqkjydk3e`
- Registration price: `1000` proofs.
- ID mutation price: `546` proofs for receiver updates, direct transfers, marketplace listings, delistings, and buyer-funded marketplace transfers.
- Current ID event: `pwid1:r2:<id-base64url>:<owner-address>:<receive-address>:<pgp-public-key-base64url?>`
- Current mail prefix: `pwm1:`
- Mailbox projections must preserve subject/body separation: `pwm1:s` supplies the subject, `pwm1:m` supplies the body, and `mail_items.body_text` plus UI memo rendering must not use Log display detail as a substitute for decoded message content.
- Current credit prefix: `pwt1:`
- Credit creation pays the built-in index fee to `tokens@proofofwork.me`; credit mints and transfers pay the credit's own registry directly.
- Credit ids are creation txids. The creation event defines ticker, max supply, mint amount, mint price, and the credit registry address.
- Credit transfers use `pwt1:send:<token-create-txid>:<amount>:<recipient-address>` with a 546-proof registry mutation payment.
- Credit mint prices are owner-set with a 546-proof minimum. ProofOfWork does not take a global fee on mints.
- Credit marketplace writes are live sale-ticket records. Preserve the invariant: reserve seller balance, seal exact terms, require buyer ticket spend, seller payment, and credit registry mutation fee.
- A spent sale-ticket outpoint closes its listing. Production should prefer Bitcoin Core UTXO spend state for this check when RPC is configured, with address-history scans used as recovery context. If the spend is a valid `buy5`, the sale must appear in credit sales, market logs, Growth, and any summary surface after refresh.
- A sale-ticket seal also spends the listing anchor, but it is not a listing closure. If a proof-index or cached row projects `closeTxid` equal to `sealTxid`, summary and active-book reconciliation must recover it as an active confirmed sealed listing unless a later real `buy5`, `delist5`, or other non-seal outspend closes it.
- Listing confirmation promotion must preserve the listing lifecycle. A pending listing that confirms should become the canonical active listing once, keep its seal/outspend state, and not leave a duplicate pending shadow behind.
- A seller should not be able to seal the same credit listing twice. Once a valid seal is visible for a listing, the UI and API should treat additional seal attempts as duplicates unless the underlying active listing changes.
- WORK and credit listing views must preserve sale-ticket seal metadata when pending listings promote to confirmed state. Cache/regression guards should reject refreshed token payloads that drop a confirmed seal.
- Marketplace summaries must include every confirmed, unspent, buyable sealed WORK/credit listing even when ordinary active-listing previews are capped. The public Sealed tab counts confirmed sale-ticket seals only; pending seals remain visible in All/Unsealed until they confirm.
- Wallet and Marketplace refreshes may preserve local pending listing/seal overlays while the indexer catches up, but confirmed chain/API state wins once the listing, seal, closure, or sale is indexed.
- Dropped pending WORK and credit transactions must be removed from pending overlays after live liveness checks. They can remain diagnosable for a short cache window, but they must not keep stale transfers, listings, seals, or buys visible as live pending state.
- Marketplace network value counts seller sale volume plus marketplace mutation fees from listings, seals, delistings, and buys. Keep seller sale volume separate from mutation-fee flow, and do not double-count marketplace mutation fees as generic Computer event flow.
- WORK credit id: `d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8`
- WORK registry address: `1638Vn6KtmK8p5r4oGvAXq9nmZb1emU1DV`
- WORK supply settings: 21,000,000 max supply, 1,000 WORK per mint, 1,000 proofs per mint, 1 proof per WORK launch price.
- WORK is reserved. Official credit indexers and create UI should reject any non-canonical credit ticker containing `WORK`, and exclude blocked scam creator address `bc1qcf57sgazj4gcd0yfxste3eaa35eltj48sgrvjl`.
- WORK permanent floor formula: `work_floor_proofs = live_network_value_proofs / 21,000,000 WORK`.
- WORK's active floor uses live network value. Frozen network value remains an audit field that records what the WORK movement was worth at confirmation time.
- WORK is the only credit whose transferred amount contributes credit movement network value. Other credits remain proof-flow only unless a future explicit protocol change gives them a non-manipulable value source.
- WORK floor is not the same thing as mint price. Public UI should separate mint price, floor price, network value, and pending mint pressure.
- WORK floor charts should be real price charts: x-axis is time; y-axis is price per WORK; users can toggle proofs and USD.
- Credit mint-out is canonically confirmed-only. UI mint controls should also pause when confirmed plus pending mints would fill the remaining supply.
- WORK mint summaries must replay canonical mint events from the shared ledger, with pending mints shown only as availability pressure. Pending mint pressure can disable unsafe mint actions, but it must not inflate confirmed supply, holders, floor, or network value.
- Prepare UTXOs and Mint Assistant are signer helpers, not custody. They should never auto-sign, handle seed phrases, or move wallet authority server-side.
- First confirmed valid registration wins.
- IDs are case-insensitive forever.
- Pending IDs may be visible, but pending IDs are not routable.
- Re-check registry state before broadcast.
- Wallet signing stays local.
- Node/API infrastructure reads, indexes, verifies, and broadcasts already-signed txs. It does not custody.
- Every tx-backed app action should be inspectable from an activity surface with clear labels for confirmed, pending, txid, listing txid, and UTXO references where relevant.
- Every app action is a ProofOfWork Computer action. Log and Growth should treat tx-backed actions from IDs, mail, files, Browser, Marketplace, Credits, Infinity, and staged protocols consistently.
- WORK, Infinity, Growth, Log, token history, and public searches should read from the same canonical confirmed ledger snapshot on livenet. Address-only fallback scans are useful for recovery, but they must not become a separate truth that changes network value without appearing in Log.
- Production confirmed stable data surfaces should prefer the proof index database for speed, then fall back to the first-party node/API cache and current full-node data for fresh reads, stale or missing projections, mempool truth, raw tx/UTXO/outspend edge cases, signing support, broadcasts, and verification. Stale snapshots are acceptable only as a first paint, not as the final truth after refresh.
- `pwm1:m:powb` is the canonical Infinity Bond memo. Indexers and database readers must normalize it to `infinity-bond` for Log, Event History, Growth, WORK floor, and searches, while preserving mailbox projection so the same tx appears in Inbox/Sent for touched addresses. POWB mint credit belongs to the bond recipient address, not necessarily the sender.
- Changes to one Computer surface must not disable or degrade the other app surfaces. Desktop, Browser, Marketplace, Credit, Wallet, WORK, Infinity, Log, Growth, IDs, and Computer are facets of one machine; a fix for one must preserve routing, first-party API reads, and basic search/load behavior for the rest. Production browser surfaces must not fall back to public `mempool.space` data paths for app reads; if the first-party API path is unavailable, fail closed and fix the API/proxy/build instead of silently depending on a public explorer.
- Fresh summary endpoints must not return stale credit or POWB truth. `token-summary`, `token-history`, `work-summary`, `infinity-summary`, and `marketplace-summary` refreshes should update the shared credit/POWB payload cache so every surface converges on the same chain state; fast cached first paint may only survive if active listing spend state is corrected against node truth.
- WORK and credit marketplace views must derive active listings, closed listings, sales, wallet owned listings, and mint summaries from the same refreshed credit payload. A surface-specific summary can format the data differently, but it must not carry its own stale listing or mint count after refresh.
- Broadcast errors should be legible. A rejected transaction should expose the RPC code, reason when available, and a plain-English hint instead of a mystery error.
- Every new product should enter the growth model with the same shape: real chain inputs, a usage assumption, a value assumption, fee elasticity, and blockspace accounting.
- Merged apps should be treated as normal apps across public links, local route maps, GitHub docs, and Growth inputs.
- Attachments are small and verified by size/hash.
- Confirmed chain history is canonical; pending status can become dropped.
- Local state is portable through backups, not server accounts.

## Voice

The native voice is high-conviction, fast, direct, mythic, and alive. It sounds like a founder mid-breakthrough, building in public while the machine is turning on.

Use:

- Short declarative sentences.
- Plain words with large stakes.
- ProofOfWork Computer, ProofOfWork IDs, proofs, agents, source of truth, on-chain, local-first.
- Launch energy when writing social or founder-facing copy.
- Calm precision when writing UI, docs, specs, and user guidance.
- The `$work` cashtag in social copy when talking about the credit, WORK dashboard, mint, floor, or network-value story.
- The `$POWB` cashtag in social copy when the post touches Infinity Bonds, confirmed bond proofs, WORK floor from bond-heavy network value, or the combined WORK/PowID market story.
- The occasional project-native phrase: `FEW`, `HEHE`, `GGZ`, `COMETH`, `THE PROOFOFWORK COMPUTER LIVES`, `STREAM PROOFS`, `WALK THE WALK`, `SOURCE OF TRUTH`.

Avoid:

- Generic crypto marketing.
- Enterprise blockchain language.
- Vague "community" language without a mechanism.
- Treating ProofOfWork as only a payment rail.
- Treating AI agents as generic chatbots.
- Repeating slurs, dehumanizing insults, or rage-post language in product surfaces.

Keep the fire. Leave the poison.

## Canonical Phrases

These are safe phrases future agents can reuse or adapt:

- The source of truth is the chain.
- Chain truth, no vibes.
- Confirmed records are canonical. Pending mempool visibility is gossip.
- Wallet signing stays local.
- Your attention belongs to you.
- If they want your attention, they can pay for it.
- Spam is not free anymore.
- Agents need tamper-free data.
- The ProofOfWork Computer lives.
- ProofOfWork IDs are the global address book.
- Every ID is a network-effect increment.
- The inbox is sorted by signal, not noise.
- Humans sign. Agents verify.
- Build the record once. Let every agent read it forever.
- The computer is a private key plus a source of truth.
- Local-first. ProofOfWork-native. Agent-readable.
- Proofs are the signal.
- The future app store is on chain.
- Applications should be able to earn.
- Walk the walk on chain.
- The chain is the oracle.
- Proofs stay the source of truth.
- UX protects the signer.
- Mint price is not floor price.
- The UI can protect against pending pressure without pretending pending is final.
- Creator credits should own their own registry.
- Active book shows intent. Sealed book sets executable ask.
- Names are assets now.
- Agents can read the book forever.

## Daily Social Posts

These are recurring X posts the founder may ask agents to fire daily. They are not static copy. Always refresh live first, then draft in the high-conviction social voice. Treat a batch as one snapshot-bound unit: refresh the dependent endpoints close together, reconcile the math once, and then write the posts from that one current view. When the user asks for the daily WORK/PowID tweets, prepare all four posts below unless the user explicitly narrows the request.

Language rule for public posts: use `proofs` for sat-denominated value in social copy, dashboards, and user-facing labels. Keep protocol and API field names exact in agent math and docs: `amountSats`, `priceSats`, `paidSats`, `networkValueSats`, and `floorSats` remain the source fields. Do not rename serialized protocol fields, JSON keys, or API contracts to `proofs`. Treat `proofs` as the ProofOfWork.Me display language over the same base units. Keep technical miner fee rates as `sat/vB` unless quoting an existing UI label.

Use the first-party API and confirmed chain data:

- WORK floor: `https://work.proofofwork.me/api/v1/work-floor?network=livenet&fresh=1`
- WORK holders and confirmed secondary sales: `https://work.proofofwork.me/api/v1/token-history?network=livenet&asset=d4e5ebf11d104d6a63fb74e42094364b25a5f7199a09e5c0e71408972466a8b8&kind=holders&limit=20&fresh=1` and `kind=sales`
- Marketplace summary and ID order book: `https://marketplace.proofofwork.me/api/v1/marketplace-summary?network=livenet&fresh=1`

For USD in public posts, use the live BTC/USD-backed fields from the fresh API response: `actualValue.totalUsd`, `btcUsd`, `btcUsdIndexedAt`, and `usdSource`, or recompute from `/api/v1/prices/btc-usd`. Do not use `modelTotalUsd` for current tweet copy; it is the Growth model USD projection retained for comparison. When talking about WORK value, distinguish live network value from frozen network value: live is the current site/floor value, frozen is the confirmation-time audit stamp.

Daily tweet set:

- WORK mint-to-floor update. Report mint price, current live floor proofs per WORK, floor multiple from mint, live ProofOfWork Computer network value, and live USD if useful. If frozen value is included, label it as confirmation-time value, not the current floor source. Formula: `floor_proofs_per_work = floor.liveNetworkValueSats / 21000000` or `floor.networkValueSats / 21000000` when `networkValueSats` is the live field; mint multiple is `floor_proofs_per_work / 1`; live USD is `floor.actualValue.totalUsd` or `floor.liveNetworkValueSats / 100000000 * floor.btcUsd`.
- WORK sealed order book. Do not use raw `token-history` listing counts, `token-summary` `openListings`, or unsealed rows as the sealed book. Start from the fresh Marketplace active WORK listings, exclude spent tickets, then count only listings whose sale authorization has a valid sale-ticket anchor signature and anchor txid. Report active sealed listings, current floor, and every sealed listing's buyer arb, including negative arbs. Formula: `price_per_work = priceSats / amount`; `buyer_arb_proofs = (floor_proofs_per_work - price_per_work) * amount`. Positive arb means the buyer can take sealed WORK below floor; negative arb means the sealed ask is above floor. If counts disagree with the UI, re-check sale-ticket outspends and the sealed filter before posting.
- PowID order book. Report confirmed PowIDs, active ID listings, sealed ID listings, lowest active ask, and lowest sealed asks. Explain that sealed ID listings are buyer-funded transfer terms on chain.
- WORK reserve update. Use the top three WORK holder addresses from the fresh WORK holders view. Include confirmed secondary buys for `1F1p9UEHuH5KTFR7Zsx93Khdrqhj6t5nFv`. Formula: `reserve_work = sum(top_3_holder_balances)`; `secondary_work = sum(confirmed_1F1p_secondary_amounts)`; `secondary_paid_proofs = sum(confirmed_1F1p_secondary_paidSats)`; `reserve_basis_proofs = (reserve_work - secondary_work) * 1 + secondary_paid_proofs`; `floor_value_proofs = reserve_work * floor_proofs_per_work`; `gain_proofs = floor_value_proofs - reserve_basis_proofs`; `btc_value = proofs / 100000000`; `multiple = floor_value_proofs / reserve_basis_proofs`. Prefer `paidSats` for all-in secondary basis when present, and `priceSats` only when describing seller price.

Style rules:

- Use `$WORK $POWB` by default when talking about WORK, PowIDs, floor, reserves, sealed books, bonds, or confirmed network value unless the user explicitly asks for different cashtags.
- Say `confirmed` when the metric excludes pending mempool visibility.
- Keep numbers compact but not vague: proofs, BTC, and x multiple should all reconcile.
- Do not reuse archive screenshots, old tweet text, or earlier chat numbers as current data.
- Do not present pending mints, pending listings, or unsealed listings as final takeable order-book state.
- Keep the close simple: `On-chain. ProofOfWork-native. $WORK`, `The chain is the oracle`, or `Names are assets now.`

## Agent Operating Model

When working on ProofOfWork.Me:

1. Read the protocol docs before changing behavior.
2. Preserve the canonical registry and ID rules.
3. Treat tweets as strategic memory, not automatic implementation instructions.
4. If an archive tweet, screenshot, or social claim conflicts with protocol docs, source code, or current live chain/API data, the docs, code, and current chain/API data win.
5. Prefer shipping real working software over writing abstractions.
6. Keep all wallet authority with the user.
7. Make chain reads verifiable and deterministic.
8. Separate pending convenience from confirmed truth.
9. Build features so agents can inspect, summarize, and act on them later.
10. Make local backup/import/export boring and reliable.
11. Keep UI efficient and tool-like; save maximalism for social copy and launch notes.
12. When in doubt, ask: can an agent verify this from the chain?
13. When building new protocols, make the records legible, parsable, and replayable.
14. When adding app features, think about how a one-person business or autonomous agent would use them to earn proofs.

## Future Directions From The Archive

These are strategic directions, not all current implementation:

- Open Agent Development Standard (OADS): proposals sent to `openagentdevelopmentstandard@proofofwork.me`, ordered by proofs and readable by agents.
- On-chain app submission: developers submit applications or proposals to ProofOfWork IDs for agent review.
- Autonomous micro-applications: small apps that can run, receive payments, and generate proofs.
- ProofOfWork Browser: users paste a txid and render HTML from ProofOfWork message bodies or verified `text/html` attachments in a sandboxed viewer.
- PowID-native social actions: profiles, posts, comments, follows, likes, reposts, replies, tips, polls, voting, lotteries, and digital goods that pay confirmed receivers and write replayable records after launch approval.
- Creator credit businesses: launch by creating a credit, mint into a creator-owned registry, transfer from Wallet, and trade through sale-ticket listings once the seller's balance, seller payment, and registry mutation fee are provable from chain data.
- WORK analytics: floor, mint progress, holders, pending pressure, mint assistant health, UTXO readiness, and price in proofs/USD.
- Share-to-X from messages, txids, and public ProofOfWork Computer records so on-chain history can travel through social networks without becoming dependent on them.
- Encrypted media or files with on-chain permission records.
- Concatenated/linker transactions for content larger than one OP_RETURN budget.
- Contacts and address books as local-first UX over confirmed chain identity.
- Agent-safe private-key workflows where agents prepare transactions but cannot steal or tamper with keys.
- Mesh/offline/future-phone speculation where the ProofOfWork Computer reduces dependence on traditional internet assumptions.

## Canceled Direction

- Ordinals/inscriptions integration was explored and canceled. Do not implement or reintroduce it unless the user explicitly revives that direction.

## Emotional Kernel

The soul of ProofOfWork.Me is not "a mail app on ProofOfWork."

It is the feeling that the computer became honest.

The founder voice says: attention should not be stolen, work should be proved, agents should not be fed mutable garbage, humans should not be trapped in platforms, and a single person with agents and ProofOfWork should be able to build, publish, coordinate, and earn without asking permission.

This project is a computer for people and agents who want to walk the walk on chain.
