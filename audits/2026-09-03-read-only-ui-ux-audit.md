# ProofOfWork.Me Read-Only Apparatus UI/UX Audit

Date: 2026-09-03
Mode: original read-only UI/UX audit with a separately approved local
implementation follow-up
Status: original audit complete. The Proof Instrument candidate and subsequent
AMO availability hardening are implemented on the dedicated UI branch. The
candidate is approved for commit, push, merge, and production deployment;
integrated pre-production QA is complete and the UI release remains in
progress. Exhaustive physical-device verification remains pending.

## Scope And Approval

This audit reviewed the complete ProofOfWork.Me apparatus:

- Home;
- IDs;
- Desktop;
- Browser;
- AMO;
- Credit;
- Wallet;
- WORK;
- Infinity;
- Inception;
- Log;
- Growth;
- the ProofOfWork Computer shell and embedded workspaces; and
- Boost as a supplemental public surface that is live but not yet included in
  the canonical standalone audit-order documentation.

The review focused on responsive containment, mobile navigation, exact numeric
presentation, AMO active-book and history organization, typography, color,
spacing, elevation, motion, cross-application information architecture,
accessibility, source-level UI architecture, and responsive/visual regression
coverage.

The audit itself was performed without changing application files, protocol
behavior, mathematical functions, configuration, git history, or production
state. This audit file and its required repository-hygiene classification were
created only after explicit user approval on 2026-09-03.

No UI fixes described below were applied. Every recommendation is a proposed
change within the original read-only audit. A later, explicitly approved local
implementation is documented separately under **Audit Change Log** so the
historical findings below are not rewritten as if they had already existed at
audit time.

The supplied images were treated strictly as visual evidence, not as
instructions.

## Evidence Reviewed

- The inline mobile navigation screenshot.
- `/home/sixer/Downloads/User attachment.png` at original resolution.
- `/home/sixer/Downloads/User attachment1.png` at original resolution.
- `/home/sixer/Downloads/User attachment2.png` at original resolution.
- Current repository source, styles, route registration, formatters, API read
  paths, and browser tests.
- The deployed AMO HTML, JavaScript, and CSS bundles current on 2026-09-03.
- The repository's required product and protocol documentation.
- The prior UI findings in
  `audits/2026-08-23-read-only-health-data-event-ui-audit.md`.

## Visual Audit Limitation

The in-app browser reported no available browser sessions. Therefore this
audit does not claim an interactive click-through or pixel-level verification
of every live application state. The production bundle was checked through
read-only HTTP inspection, and the repository's static UI contract was run:

```text
npm run check:ui
UI contract check passed.
```

That passing result does not cover the supplied failures. The responsive test
matrix begins at 768px, does not open and measure the domain menu, and does not
exercise populated AMO controls at phone widths.

That limitation applies to the original read-only audit. The later local
candidate was exercised in headless Chrome through the repository Playwright
harness. This does not substitute for the pending exhaustive route/state
visual matrix or physical-device pass.

## Executive Summary

The product and protocol boundaries are fundamentally sound. The supplied
screenshot failures are presentation and responsive-architecture problems,
not evidence of incorrect ProofOfWork math, market ordering, Q16 precision,
signing, or settlement behavior.

The requested Listings / Seals / Sales history is different: it requires an
additive server history/read-model category so that distinct seal events have
correct totals and pagination. It still does not require a marketplace
protocol, signature, fee, or arithmetic change.

The strongest modernization direction is a **Proof instrument** interface:
preserve the existing obsidian, brass, parchment, and olive identity, then add
disciplined typography, clearer information levels, data-aware components,
restrained signal color, and container-responsive behavior. A generic
neon-purple or glass-heavy crypto aesthetic would make the product less
distinctive and reduce legibility in its evidence-dense views.

Highest-priority findings:

1. The mobile domain menu is positioned outside the visual viewport.
2. Exact WORK and network values bleed between desktop metric cards.
3. AMO counted filters and protocol-history tabs have impossible phone-width
   constraints.
4. Global overflow clipping hides defects rather than containing their source.
5. Mobile Sort placement, exact-number wrapping, and status truncation degrade
   important market information.
6. The current responsive test matrix contains no phone viewport.
7. AMO history mixes listing, closure, and sale activity and has no independent
   seal row.
8. A 53,394-line application component and 7,673-line global stylesheet make
   visual behavior source-order dependent and encourage cross-surface drift.

## Finding Summary

| Priority | Finding | Primary impact |
| --- | --- | --- |
| P0 | Mobile application menu leaves the viewport | Navigation is obscured or unusable |
| P0 | Exact metric values bleed into adjacent cards | Trust-critical values become unreadable |
| P0 | AMO counted and protocol tabs overflow | Controls overlap and labels lose meaning |
| P1 | Sort and status controls degrade on mobile | Important controls/state are stranded or truncated |
| P1 | Exact listing values break mid-number | Users cannot visually verify amounts confidently |
| P1 | AMO history mixes lifecycle categories | Listings, seals, closures, and sales are hard to inspect |
| P1 | Global CSS and duplicated views drift | Fixes in one surface can regress another |
| P1 | Navigation lacks consistent hierarchy | The apparatus feels like separate applications |
| P1 | Focus, tab, contrast, and motion gaps remain | Keyboard and low-vision use is unreliable |
| P2 | Page density obscures primary tasks | Mobile flows require excessive scanning |

## P0: Mobile Application Menu Leaves The Viewport

### Evidence

- `src/shared/components/DomainNav.tsx:72-190` renders the trigger and menu
  inside the same navigation container.
- `src/styles.css:967-987` gives the popover a minimum width of approximately
  320px and positions it absolutely.
- `src/styles.css:7507-7517` right-aligns the panel to the trigger below 1100px.
- `src/styles.css:7530-7539` reduces the trigger's navigation container to
  approximately 40-42px below 520px.
- The trigger sits between a flexible brand block and several header actions.
  Right-aligning a 320px panel to that center anchor extends the panel past the
  left viewport edge, matching the supplied screenshot.
- Global horizontal clipping then conceals the escaped portion instead of
  preventing it.
- Closed menu content is hidden with opacity and `pointer-events`, leaving its
  descendants available to keyboard focus.

### Impact

- Primary cross-application navigation becomes partially unreadable and
  difficult to operate on a phone.
- The underlying page remains visually active behind the translucent panel,
  weakening hierarchy and making the interface appear corrupted.
- Keyboard focus can enter controls that are not visually present.

### Proposed Fix — Not Applied

- Use a viewport-bound mobile navigation sheet with fixed positioning,
  safe-area spacing, consistent inline gutters, and a scrim.
- Lock background scrolling while open.
- Move focus into the sheet, support Escape and arrow/Home/End navigation, and
  restore focus to the trigger on close.
- Remove closed content from the focus tree with `hidden`, `inert`, or a proper
  dialog/popover primitive.
- Retain collision-aware anchored placement on desktop.
- Group destinations instead of presenting one undifferentiated list.

## P0: Exact Desktop Metric Values Bleed Between Cards

### Evidence

- WORK renders the affected metric grid at `src/App.tsx:40176-40313`.
- AMO duplicates the metric structure at `src/App.tsx:47391-47536`.
- `src/styles.css:4036-4047` intends to allocate approximately 300px per
  specialized metric card.
- The later, equally specific rule at `src/styles.css:6330-6333` wins by source
  order and forces four equal tracks on the public token surface.
- `src/styles.css:4049-4064` explicitly prevents long values from wrapping.
- The public layout does not reduce to two columns until 860px and one column
  until 620px. Laptop widths can therefore retain four cards that are too
  narrow for production-scale exact values.
- The same selector conflict was found in the CSS served by production AMO on
  the audit date.

### Impact

- Correct values paint into neighboring cards and become visually ambiguous.
- A user cannot confidently associate a number with its label.
- The problem appears like bad arithmetic even though its source is layout.

### Proposed Fix — Not Applied

- Give exact metric grids a dedicated component class that generic
  `.id-launch-stats` rules cannot override.
- Use component container queries and an intrinsic grid such as
  `repeat(auto-fit, minmax(min(100%, 19rem), 1fr))`.
- Allow four, three, two, and one-column states based on component width, not
  only viewport width.
- Introduce a presentation-only `MetricValue` primitive with a readable primary
  display, complete exact value in a semantic `<data>` element, explicit
  expand/copy affordance, and tabular lining numerals.
- Never silently ellipsize or round trust-critical values. A shortened headline
  must be visibly approximate and the complete exact value must remain
  available.
- Keep frozen WORK settlement values available at their required precision.
  Do not change BigInt, rational, Q16, sorting, or settlement functions.

### Prior Audit Continuity

The earlier audit recorded exact-value overflow at
`audits/2026-08-23-read-only-health-data-event-ui-audit.md:648-671` and proposed
compact primary values with exact detail/copy presentation. The supplied
screenshot confirms that recommendation remains unresolved.

## P0: AMO Counted Filter Tabs Overflow

### Evidence

- `MarketplaceListingBookTabs` renders label and count inline at
  `src/App.tsx:45187-45225`.
- `src/styles.css:3948-3953` forces All, Sealed, and Unsealed into three equal
  tracks.
- `src/styles.css:3955-3966` adds 24px total horizontal padding, a 10px gap,
  and `space-between` alignment to each track.
- The control has no narrow-layout rule that stacks label and count or gives
  the tabs intrinsic width.
- Nested page, content, and card gutters further reduce the usable phone width.
- `body { overflow-x: hidden; }` clips escaped content, matching the supplied
  `512 / 505 / 7` screenshot.

### Impact

- Counts and labels overlap neighboring controls.
- The active filter becomes difficult to identify or tap.
- Hidden overflow can create a false impression that values are missing.

### Proposed Fix — Not Applied

- Preserve exactly three active-book states and their exact counts.
- Give each button `min-width: 0` and stack count beneath label or place it in a
  compact badge.
- Keep at least a 44px touch target.
- At extreme narrow or enlarged-text widths, switch to a vertical control or a
  deliberately scrollable tablist with a visible edge affordance.
- Use proper tablist/tab/tabpanel semantics and arrow-key behavior if the
  controls continue to swap panels.

## P0: WORK Protocol-History Tabs Are Over-Promoted And Cramped

### Evidence

- The generation selector is rendered at `src/App.tsx:47934-47970`.
- `src/styles.css:4004-4011` forces AMO, Pre-V8 Relics, and Marketplace V1 Relic
  into three equal columns.
- No phone-specific rule gives the two long historical labels sufficient
  intrinsic width.
- The supplied screenshot shows those labels wrapping into two and three lines.

### Impact

- The active AMO market and immutable historical readers appear equally
  important.
- Long labels dominate the first screen and make the application feel crowded.

### Proposed Fix — Not Applied

- Keep AMO as the primary active view.
- Move the immutable generations behind a clearly labelled Historical views
  selector or disclosure on phones.
- A horizontally scrollable intrinsic-width secondary tablist is also
  acceptable when its edge/scroll affordance is explicit.
- Preserve the existing `amo`, `v4-relic`, and `v1-relic` states and all
  replayable historical records.

## P1: Sort, Status, And Exact Listing Presentation

### Evidence

- `src/styles.css:3982-3998` keeps Sort right-aligned with
  `margin-left: auto` and a 150px select minimum.
- Mobile rules change internal display but do not clear that margin or make the
  select fill the available width.
- `src/styles.css:1509-1523` fixes the shared status row to one line and clips
  overflow with an ellipsis, matching the truncated mobile readiness message.
- Generic record values use `overflow-wrap: anywhere` around
  `src/styles.css:4507-4510`, causing long arbitrage and WORK values to break at
  arbitrary digit boundaries.
- Exact arithmetic and formatting are separate from this CSS. WORK settlement
  formatting remains in `src/workAmount.ts:193-220`, while market comparators
  and exact rational calculations remain in `src/App.tsx:44857-44963`.

### Impact

- Sort appears visually detached from its filters.
- Important connection, loading, degraded, or error state can disappear behind
  an ellipsis.
- Mid-number wrapping makes exact values difficult to compare and copy.

### Proposed Fix — Not Applied

- Use a one-column mobile toolbar: search, filters, then full-width Sort.
- Allow operational status to occupy up to two lines on phones, with a concise
  state label and expandable detail when necessary.
- Give numbers dedicated markup and styling; separate the number from its unit
  so wrapping occurs before `proofs` or `WORK`, never inside digits.
- Use a local exact-value region with copy/reveal or intentional horizontal
  scrolling rather than document-level overflow.

## Requested AMO Credit Market Activity Tabs

### Current State

- The active order book correctly exposes All / Sealed / Unsealed.
- The lower Credit Sales & Listings Log combines listing, closed-listing, and
  sale rows at `src/App.tsx:47053-47072` and `src/App.tsx:48705-49025`.
- `TokenMarketLogItem` has only `listing`, `closed-listing`, and `sale` kinds at
  `src/App.tsx:44604-44622`; it has no independent seal event.
- The client fetches one already-paginated `kind=market-log` page at
  `src/App.tsx:47083-47176`.
- The index reader consumes `token-listing-sealed` evidence but normalizes it
  into a listing row and keys that representation by listing ID around
  `server/db/proof-index-reader.mjs:16649-16678`.

### Why Client-Only Filtering Is Unsafe

Filtering the currently loaded mixed page would create sparse or empty pages,
incorrect category totals, and no guarantee that every seal transaction
remains inspectable. It would also conflate a listing's current screen state
with its immutable seal event.

### Proposed Information Architecture — Not Applied

Keep two controls distinct:

1. Active order book: All / Sealed / Unsealed.
2. Credit Market Activity: Listings / Seals / Sales.

Recommended activity behavior:

- **Listings** contains opening events plus non-sale close/delist lifecycle
  states, each with a clear status badge.
- **Seals** contains one row per seal event, keyed by seal transaction ID and
  exposing seal time, confirmation state, listing ID, seller, and frozen terms
  evidence.
- **Sales** contains completed purchase settlements.
- Each category owns authoritative server-side totals and pagination.
- Changing the credit or activity category resets its cursor/page.
- Pending evidence receives a visible pending badge and is not counted as
  confirmed canonical history.
- The existing `market-log` response remains backward compatible.

This is an additive read-model/API projection. It does not require changing
the active-book classification, protocol parser, fee constants, signatures,
frozen terms, buyer/seller math, or settlement ordering.

Confirmed and pending seal semantics must remain unchanged: only confirmed,
buyable seals enter the sealed book; pending seals remain visible under
All/Unsealed until confirmation.

## Visual Direction: Proof Instrument

### Principles

- Precision before spectacle.
- Chain-readable evidence before decoration.
- Strong hierarchy before additional panels.
- Motion as feedback, not atmosphere.
- Exact values remain inspectable and copyable.
- Dramatic treatment belongs on Home and a small number of aggregate metrics;
  transaction and protocol surfaces remain calm.

### Surfaces And Depth

- Reduce nested outlined rectangles with identical visual weight.
- Establish three levels: page/section surface, actionable panel, and data row
  or evidence item.
- Use brass sheen or glow only for primary focus, active state, and a small
  number of live metrics.
- Use a subtle proof-grid or ledger-line texture at very low opacity.
- Reserve glass/blur for sticky chrome and overlays, not scrolling lists.

### Typography

Current observations:

- `src/styles.css:34-35` names Inter, but the repository contains no bundled
  font, `@font-face`, preload, or external font stylesheet.
- Rendering therefore varies across Android, Windows, Linux, and Apple devices.
- Nonstandard weights such as 760, 780, 820, 850, and 880 are requested without
  loading a variable font.
- `--mono` is referenced but undefined.
- Tabular numerals are not applied consistently.

Recommended type system:

| Role | Preferred family | Alternate |
| --- | --- | --- |
| UI and body | Inter Variable | Geist Sans |
| Display headings | Space Grotesk Variable | Sora Variable |
| Txids, addresses, exact fields | IBM Plex Mono | Geist Mono |

Implementation guidance:

- Self-host WOFF2 assets with `font-display: swap`.
- Define `--font-sans`, `--font-display`, and `--font-mono`.
- Use conventional 400/500/600/700/800 weights.
- Use tabular lining figures for metrics, balances, prices, counts, and time.
- Do not use monospace for oversized dashboard metrics; its width makes
  containment harder. Reserve it for evidence and exact/copy fields.

### Color

The current near-black, parchment, brass, and olive identity should be retained.
The issue is token completeness and inconsistent application rather than the
palette concept.

Measured current contrast examples:

- primary text on background: 17.67:1;
- muted text on background: 8.80:1;
- soft text on raised surface: 4.05:1;
- red on raised surface: 3.48:1;
- blue on raised surface: 2.89:1; and
- white on the brass accent: approximately 2.19:1.

Recommended semantic palette:

| Role | Value |
| --- | --- |
| Canvas | `#080807` |
| Soft surface | `#0f0f0c` |
| Raised surface | `#15130f` |
| Primary text | `#f7f0e2` |
| Secondary text | `#c3b59d` |
| Tertiary text | `#9a8e79` |
| Brass accent | `#d7a84f` |
| Accent hover | `#f0c96a` |
| Confirmed | `#9abe7a` |
| Pending | `#e2b85f` |
| Information/focus | `#77a7e8` |
| Danger | `#e2766a` |
| Interactive border | `#746148` |
| Text on brass | `#15130f` |

Additional recommendations:

- Use dark ink on brass primary actions.
- Use gold selectively for action, selection, and value emphasis.
- Retain a cool blue only as a deliberate system/focus signal rather than a
  hard-coded platform-blue exception.
- Define semantic tokens for canvas, surface levels, text levels, control
  border, focus, success, pending, danger, and invalid state.
- Resolve undefined `--gold`, `--mono`, and `--muted` references.

### Spacing, Radius, And Motion

- Spacing scale: 4, 8, 12, 16, 24, and 32px.
- Radius scale: 8, 12, 16px, and pill.
- Minimum interactive target: 44x44px.
- Default feedback motion: approximately 150-180ms.
- Extend reduced-motion handling to refresh, Desktop scanning, sheets,
  popovers, tabs, and global transitions. Current reduced-motion handling only
  disables one mail spinner.

## Navigation And Apparatus Coherence

### Current Findings

- All direct domain links disappear below 1799px at
  `src/styles.css:7444-7452`, so ordinary laptops depend on the hamburger.
- Brand, app switcher, refresh, network, and wallet compete in one 64px header.
- Mobile header actions shrink to approximately 38-40px.
- The Computer header retains the global brand rather than prominently naming
  the active workspace.
- The Computer rail combines mail folders, files, products, contacts, and
  registry state in one long flat navigation.

### Proposed Global Shell — Not Applied

- Keep three to five primary destinations visible at ordinary desktop widths,
  with the rest under a categorized More menu.
- On mobile, retain brand/current workspace, app switcher, and wallet/status;
  move refresh and network into one secondary actions menu.
- Make the mobile application sheet grouped and searchable if the catalog
  continues to grow.
- Avoid repeating the complete application directory in the header, every page
  footer, and a long mobile action wall.

### Proposed Computer Navigation — Not Applied

Suggested grouping:

- **Mail:** Inbox, Incoming, Sent, Outbox, Drafts, Favorites, Archive.
- **Create & Files:** Compose, Files, Desktop, Browser, Boost.
- **Identity & Value:** IDs, AMO, Credit, Wallet, WORK, Infinity, Inception.
- **Verify:** Log, Growth.
- **Contacts & Local:** contacts and local organization controls.

On phones, a task bar could expose Mail, Files, AMO, Wallet, and More while the
sheet provides the complete catalog. Compose should be contextual to Mail
rather than occupying equal prominence above every workspace.

Product boundaries must remain intact:

- `id.proofofwork.me` remains registration-only.
- Computer IDs remains separate from Marketplace.
- Wallet remains the owner action/signing surface.
- AMO remains discovery and purchase.
- Log and Growth remain read-only.
- Wallet signing and all private-key operations remain local.

## Accessibility And Interaction Semantics

### Findings

- Closed menu contents remain focusable because visibility is controlled with
  opacity and `pointer-events`.
- Menus close on outside pointer and Escape but do not consistently move focus
  in, implement menu keyboard movement, or return focus.
- Tab-like controls use `aria-pressed` while changing panels.
- `ProgressBar` lacks complete progressbar role/value semantics.
- In the Computer shell, the global ProofOfWork.Me title remains the primary
  heading while the active workspace title is generally a secondary heading.
- The one-line live status region can visually hide degraded/error details.
- Focus shadows can be clipped by `overflow: hidden` ancestors.
- Reduced-motion coverage is incomplete.

### Proposed Fixes — Not Applied

- Add a skip link and a semantic main heading for each workspace.
- Use proper tablist/tab/tabpanel semantics and arrow-key behavior.
- Use robust popover/dialog primitives with focus entry, containment, Escape,
  and focus restoration.
- Keep live status announcements, but allow two-line mobile state or an
  expandable details action.
- Ensure focus indicators remain visible outside control borders.
- Add correct progressbar roles and value attributes.
- Verify every interaction at keyboard-only and 200% text enlargement.

## Page-By-Page Recommendations

### Home

The current hierarchy presents a large wall of hero actions, followed by
additional product cards and another complete link directory. On phones this
becomes an extended list of equal-weight buttons.

Proposed changes, not applied:

- Keep Claim an ID and Open Computer as the two primary hero actions.
- Replace the remaining wall with a compact categorized Explore apps grid.
- Add Boost to product discovery.
- Update AMO and Wallet descriptions to reflect current products.
- Keep dramatic brand imagery here rather than repeating it inside dense tools.

### IDs

Proposed changes, not applied:

- Lead with registration and availability.
- Present fee, recipient, wallet, broadcast, and confirmation as one clear
  transaction progression.
- Move protocol and verification internals into an advanced disclosure.
- Retain owned IDs and a searchable public registry below the primary task.
- Preserve the registration-only boundary and canonical ID rules.

### Desktop

Proposed changes, not applied:

- Keep search visible and move filters/sort into a compact mobile filter sheet.
- Use responsive master/detail on desktop and a bottom sheet or full-screen
  inspector on phone.
- Standardize its blue/black variation through shared semantic tokens.
- Preserve Desktop's public-file and wallet-free boundary.

### Browser

Standalone and embedded Browser views duplicate substantial state and markup,
which creates drift risk.

Proposed changes, not applied:

- Lead with Paste a txid. Render the page.
- Move template construction into a secondary tab or disclosure.
- Extract one shared Browser controller/view with shell adapters.
- Keep trust state, source evidence, and sandbox/render state visually distinct.
- Preserve Browser sandbox and viewer isolation.

### Boost — Supplemental Public Surface

Boost is live but is not currently included in the canonical standalone audit
order. It was included here as an additional apparatus surface.

Proposed changes, not applied:

- Prioritize feed and compose on phones.
- Put identity, discovery, and filters into a drawer.
- Use semantic, horizontally scrollable profile tabs at narrow widths.
- Reduce simultaneous left-rail/feed/right-rail competition.
- Add Boost to Home's product discovery.

### AMO

AMO has four separate information levels:

1. asset family: IDs / Credits / Bonds / Boosts;
2. protocol generation: AMO / Pre-V8 / Marketplace V1;
3. active-book state: All / Sealed / Unsealed; and
4. immutable market activity.

Proposed changes, not applied:

- Give each level a distinct visual role and do not stack four equally
  prominent tab rows.
- Keep protocol relics under a clearly labelled History control on phones.
- Repair counted tabs, Sort, exact values, and active-card containment.
- Add the authoritative Listings / Seals / Sales activity design above.
- Replace behavior derived from display-copy matching with typed state before
  changing affected copy.
- Unify duplicated standalone and Computer AMO presentation incrementally.

### Credit

Proposed changes, not applied:

- Use Create / Mint / Browse task navigation.
- Keep a concise network summary above the tasks.
- Move protocol explanation and advanced payload detail into disclosures.
- Preserve fee calculation, local signer callbacks, exact payloads, supply,
  holder, and mint math.

### Wallet

Proposed changes, not applied:

- Use Balances / Send / List / Activity task views.
- Place spendable, total, and protected value in a clear top-level summary.
- Use a consistent transaction review sheet before wallet invocation.
- Keep listing as an owner action in Wallet and discovery/purchase in AMO.
- Keep every signing step local.

### WORK

Proposed changes, not applied:

- Use Overview / Market / Holders / Mints.
- Show three to five readable headline metrics above the fold.
- Add the exact-value primitive instead of shrinking numbers.
- Put chart, facts, holders, and mints behind clear task navigation.
- Preserve every precision model, unit scale, floor computation, and event
  valuation function.

### Infinity

Proposed changes, not applied:

- Use Overview / Create / Wallet / Market / History.
- Move provenance and formula explanation into a verification drawer.
- Reuse shared bond components while retaining Infinity's configuration and
  identity.

### Inception

Proposed changes, not applied:

- Follow the shared bond structure without combining its configuration or math
  with Infinity.
- Reduce the large metric/provenance preamble before core actions.
- Retain exact arithmetic, backing evidence, and chain-readable history.

### Log

Proposed changes, not applied:

- Use a compact searchable ledger with product, status, and date filters.
- Render concise expandable event cards on phones and a denser list on desktop.
- Keep transaction IDs and complete evidence copyable.
- Do not introduce mutation controls.

### Growth

Proposed changes, not applied:

- Lead with three KPIs, the main chart, and a product table.
- Move methodology, assumptions, and explanatory material into disclosures.
- Keep real events secondary but inspectable.
- Normalize product naming such as Desktop versus Drive.
- Reconcile public wording that drifts from the repository's ProofOfWork-native
  vocabulary.

### ProofOfWork Computer

Proposed changes, not applied:

- Adopt grouped desktop navigation and a five-item mobile task bar.
- Name the active workspace in the header.
- Keep workspace state while changing navigation presentation.
- Remove embedded horizontal clipping after child components become
  intrinsically responsive.
- Use the same shared primitives as standalone pages while preserving embedded
  containment and all mailbox/local-state behavior.

## UI Architecture Recommendation

Current structural evidence:

- `src/App.tsx` contains 53,394 lines.
- `src/styles.css` contains 7,673 lines.
- Responsive rules are distributed across viewport and container thresholds at
  460, 520, 620, 720, 760, 860/861, 1060, 1100, 1180, and 1799px.
- Base and responsive rules for the same component are separated by thousands
  of lines.
- Browser and AMO contain substantial standalone/embedded duplication.
- Generic classes such as `.id-launch-stats` and `.marketplace-tabs` serve
  multiple unrelated contexts.

Proposed incremental component layer, not applied:

- `AppShell`;
- `Surface` / `Card`;
- `StatGrid`;
- `MetricValue`;
- `DataList` / `DataRow`;
- `Toolbar`;
- `SegmentedTabs`;
- `StatusChip`;
- `Popover` / `Sheet` / `Dialog`; and
- `EmptyState`.

Use viewport media queries for the global shell. Use component container
queries for cards, forms, tab sets, metrics, and embedded workspaces. Keep each
component's base and responsive rules together.

This should be an incremental migration beginning with the shared header,
WORK, and AMO. A simultaneous rewrite would create unnecessary risk to mature
protocol and wallet behavior.

## Required Verification Before A Redesign Is Complete

### Responsive Matrix

Add at least these widths:

- 320;
- 360;
- 375;
- 390;
- 412;
- 430;
- 480;
- 520;
- 620;
- 768;
- 861;
- 1024;
- 1180;
- 1181;
- 1440; and
- 1800px.

Test narrow Computer containers independently of viewport width.

### Production-Scale Fixtures

Include:

- active-book counts `512 / 505 / 7`;
- full 16-decimal WORK amounts;
- long positive and negative exact arbitrage values;
- maximum practical proof/USD values;
- long addresses and transaction IDs;
- loading, empty, degraded, pending, confirmed, and error states; and
- complete versus preview/incomplete history states.

### Geometry Assertions

- Every tab's label and count remains inside its own control.
- Every menu/sheet remains inside all four visual viewport bounds.
- Closed overlay descendants are absent from the tab order.
- No component creates document-level horizontal overflow.
- Overflow is asserted at the component level rather than hidden on `body`.
- Controls remain at least 44px in both dimensions.
- Exact numeric presentation does not split at arbitrary digit boundaries.

### Interaction And Accessibility

- Keyboard-only menu, dialog, tab, and sheet flows.
- Focus entry, containment, Escape, and restoration.
- Tab arrow-key behavior and correct panel relationships.
- 200% text enlargement and browser zoom equivalence.
- Reduced-motion behavior.
- Automated accessibility scans on representative standalone and Computer
  routes.
- Contrast assertions for primary actions, statuses, borders, and focus rings.

### Visual Regression

Capture every standalone route and Computer workspace at representative 390,
768, and 1440px widths, including populated, empty, loading, pending, degraded,
and error states.

### AMO History Contract

Add API and UI tests proving:

- distinct listing, seal, and sale totals;
- stable category pagination/cursors;
- seal rows keyed and searchable by seal transaction ID;
- close/delist history remains available;
- the existing market-log contract remains compatible;
- pending and confirmed seals retain their current classification; and
- every exact amount and ordering comparator remains unchanged.

### Real Device Pass

Perform final checks in:

- iOS Safari;
- Android Chrome; and
- Samsung Internet.

## Recommended Implementation Order

1. Add failing mobile, embedded-container, overlay, tab, and exact-value tests.
2. Fix domain menu containment and accessibility.
3. Fix metric grids, counted tabs, protocol-history controls, Sort, status, and
   record numeric presentation.
4. Establish semantic design tokens and the first shared primitives.
5. Add the authoritative Listings / Seals / Sales history read projection and
   UI.
6. Migrate standalone and Computer surfaces incrementally.
7. Perform apparatus-wide accessibility, vocabulary, visual-regression, and
   restrained polish passes.

At every stage, protocol, parser, fee, precision, signing, sorting, and
settlement regression suites must remain green. UI formatting must remain a
presentation layer over canonical values, never a replacement for them.

## Audit Change Log

### 2026-09-03

- Completed a read-only audit of the full ProofOfWork.Me apparatus.
- Traced all four supplied visual defects to concrete responsive and CSS rules.
- Confirmed the relevant responsive rules are present in the deployed AMO
  bundle.
- Confirmed the static UI contract passes while omitting phone coverage.
- Defined the requested Listings / Seals / Sales activity architecture and its
  read-model requirement.
- Proposed a coherent typography, color, component, navigation, accessibility,
  and verification system.
- Application changes applied: none.
- Protocol or mathematical changes applied: none.
- Production changes applied: none.
- Documentation changes applied after approval: this audit file and its
  required repository-hygiene classification.

### 2026-09-03 — Local Proof Instrument Candidate

Status at this documentation checkpoint: implemented locally on
`ui-modernization-2026-09-03`. The user approved the implementation commit and
branch push on 2026-09-04, then approved merge and deployment later that day.
Production remains undeployed at this checkpoint while integrated QA is in
progress. The original read-only findings above remain the audit baseline.

- Retained and refined the near-black, parchment, brass, olive, blue-focus,
  and semantic status palette under shared design tokens.
- Added self-hosted Space Grotesk for headings, Inter Variable for interface
  text, and IBM Plex Mono for txids, addresses, and exact evidence fields.
- Added reusable Surface/Toolbar, SegmentedTabs, StatusChip, and MetricValue
  primitives, then applied the shared hierarchy and interaction contracts to
  the critical shell, WORK, and AMO paths.
- Rebuilt narrow-screen domain navigation as a viewport-contained modal sheet
  with a scrim, focus containment, Escape dismissal, focus restoration, safe
  area handling, and background scroll locking.
- Added a compact five-destination Computer mobile task bar and local section
  navigation so high-value workspaces no longer depend on overflowing tab
  rows.
- Contained long metrics, Q16 WORK amounts, proof/USD values, addresses, and
  transaction evidence inside their components. Exact strings remain
  copyable; presentation does not replace or round the canonical value.
- Reworked counted AMO and WORK tab sets around shared semantic tabs and
  narrow-container behavior while keeping active-book All/Sealed/Unsealed
  filtering separate from history.
- Added Listings, Seals, and Sales AMO activity tabs backed by additive
  `market-listings`, `market-seals`, and `market-sales` token-history
  projections. Listings retain creation and non-sale closure/delist evidence;
  Seals are distinct, seal-txid-addressable rows; Sales retain the canonical
  sale projection without duplicating sold closures in Listings. Filtering and
  totals occur before pagination.
- Made the new activity views fail closed: only an exact-kind, scan-validated
  response marked authoritative and complete can expose canonical totals,
  pagination, or absence claims. Recovery, mismatched, unflagged, and partial
  responses remain visibly incomplete previews.
- Preserved authoritative page order, cursor, count, and coverage metadata
  while applying same-row exact value enrichment. Stale fallback rows cannot
  alter lifecycle, confirmation, time, block position, identity, authority, or
  provenance fields, and non-page overlay rows cannot enter a paginated page.
- Preserved the legacy mixed `market-log` read contract for compatibility.
- Modernized Home and Boost presentation within the same Proof Instrument
  system, including compact mobile tools and keyboard-safe tab/sheet behavior.
- Expanded fixture-backed responsive geometry across 320, 360, 375, 390, 412,
  430, 480, 520, 620, 768, 861, 1024, 1180, 1181, 1440, and 1800px. Added
  populated AMO history, 44px target, keyboard/focus, rendered contrast,
  reduced-motion, 200% text, exact-value, and deterministic 390px visual
  regression coverage.
- Local automated verification passed: production build; static UI contract;
  browser UI suite (32/32); index-recovery behavior (497/497); WORK Marketplace
  V2; WORK AMO V8 and its gates; WORK precision (131 checks); hardening; API
  truth; server free identifiers; client read containment (43 checks); and the
  live-data contract.
- Manual fixture-backed visual review covered Home, AMO, Computer, and Boost at
  390px and 1440px, including the domain sheet, Computer More dialog, AMO
  activity history, and Boost tools drawer.
- Repository hygiene completed with the allowlisted cleaner reviewed,
  `npm run hygiene:check` passing, and the final status/diff containing only
  approved implementation, documentation, tests, font dependencies, and
  intended visual baselines.
- Pending before production: every standalone route and Computer workspace at
  390/768/1440 across populated, empty, loading, pending, degraded, and error
  states; iOS Safari, Android Chrome, and Samsung Internet; and the live
  first-party/full-node marketplace regression when canonical dependencies are
  available.
- Protocol rules, precision/math, fee splits, canonical ID behavior, wallet
  signing, marketplace authorization, and settlement behavior changed: none.
- Production changes applied: none.

### 2026-09-04 — AMO Availability Hardening

Status at this documentation checkpoint: implemented locally and awaiting the
final merge with the production-verified backend authority release.

- Replaced ambiguous zero-value placeholders with explicit Loading, Ready, and
  Unavailable states so an unresolved summary cannot present fabricated market
  totals.
- Added a labeled Last Verified timestamp that advances only with a coherent,
  accepted summary snapshot.
- Kept AMO headline totals and the active-book panels on one accepted snapshot
  lane. Independent fallbacks cannot combine values from different checkpoints.
- Added an explicit Retry action for canonical 503 responses and guarded
  asynchronous completion so an older response cannot replace a newer accepted
  result.
- Covered standalone and embedded API routing, 503-to-ready recovery, retention
  of the last verified snapshot during refresh, and unavailable-without-data
  behavior in the browser harness.
- Focused recovery checks passed 3/3 with two workers. A controlled two-worker
  contention cluster covering mobile navigation, AMO history, and 503 recovery
  passed 3/3; seven affected wallet, AMO, mail, and INCB scenarios also passed
  in isolated serial verification.
- A full four-worker run on the local host exhausted shared readiness budgets
  across unrelated routes. Final integrated QA therefore uses controlled
  concurrency and records that result separately instead of treating resource
  contention as a product pass.
- Protocol rules, math, precision, fee splits, signing, canonical IDs, and
  marketplace settlement behavior changed: none.
- Production changes applied: none.

### 2026-09-04 — Atomic Summary Acceptance And Integrated QA

Status at this documentation checkpoint: the UI branch contains the exact
production-verified backend authority release, the Proof Instrument candidate,
and the final AMO read-state hardening. Pre-production acceptance is complete;
the UI merge and production static release remain pending.

- Merged backend main commit
  `432c01581e5e2987e26a3190be2817c7bddc6470` into the UI branch without
  conflicts, preserving the complete-authority AMO count and history model.
- During integrated review, found that a mixed-lane response could apply an
  advancing registry or WORK lane before a regressing credit lane caused the
  overall response to be labeled Last Verified.
- Reworked summary acceptance into a two-phase operation: registry, credit,
  WORK value, and latched V8-boundary evidence are preflighted before any
  canonical lane, activity-history nonce, or accepted-snapshot reference is
  changed.
- A rejected response now retains the whole prior marketplace snapshot and its
  verification timestamp. Newly observed V8 boundary evidence is still
  latched independently so every subsequent WORK write preflight remains
  fail-closed.
- Added a browser regression in which the registry lane advances while the
  credit lane regresses. The UI remains Last Verified at the earlier timestamp
  and retains the earlier ID count instead of presenting a cross-checkpoint
  mixture.
- Strengthened the static UI contract to reject any registry, credit, WORK,
  history-refresh, or accepted-snapshot mutation before the all-lane retention
  gate.
- Current-tree verification passed: static UI contract; client read
  containment (43 checks); TypeScript and production build; focused atomic
  retention; and the complete two-worker browser suite (36/36 in 16.4 minutes).
  That suite covers 320-1800px responsive matrices, deterministic mobile
  snapshots, Loading / Ready / Unavailable / Last Verified states, 503
  recovery, Listings / Seals / Sales authority, keyboard behavior, 44px touch
  targets, WCAG contrast, reduced motion, and 200% text.
- The previously completed integrated backend gates remain green, including
  index recovery, WORK marketplace/precision and AMO V5-V8, API truth,
  canonical ordering, server globals, exact bond arithmetic, Mail, Credit mint,
  ledger, and production marketplace convergence.
- Repository hygiene passed after the integrated test run. Remaining release
  work: UI branch commit/push and pull request, merge, exact-release API/static
  deployment, live production smoke, and the separately tracked
  physical-device pass.
- Protocol rules, math, precision, fee splits, signing, canonical IDs, and
  marketplace settlement behavior changed: none.
- Production UI changes applied: none at this checkpoint.
