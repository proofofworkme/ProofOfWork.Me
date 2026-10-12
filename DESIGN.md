# ProofOfWork.Me Design

This is the canonical design policy for first-party ProofOfWork.Me interfaces.
Read it before changing UI, navigation, typography, branding, icons, layouts,
interaction, or product copy. The user established OpenAI/ChatGPT as the design
reference on 2026-10-11 and approved this shared policy and its refinements.

The policy covers the public landing page, every standalone product, Computer's
Focus and Desktop shells, and every embedded workspace. A new product joins this
system instead of inventing a separate visual language. Protocol specifications,
confirmed chain evidence, and explicit user instructions take precedence over
visual preferences. This document does not change fees, registry rules, wallet
authority, signing, transaction review, or release approval requirements.

## Reference and ownership

[OpenAI's public brand guidance](https://openai.com/brand/), reviewed on
2026-10-11, describes consistent proportions, clear space, geometric and
humanistic typography, and OpenAI Sans with five weights and tabular figures.
Those are published reference principles. The complete brand portal requires
sign-in; this policy does not claim access to its private specifications.

Restrained neutral surfaces, readable hierarchy, calm controls, and navigation
that leaves room for the current task are the OpenAI/ChatGPT reference patterns
we adopt. Our implementation choices below are ProofOfWork.Me's own tokens and
rules, not purported official OpenAI pixel values or a promise of identical
layouts. ProofOfWork.Me retains its own name, rounded W mark, assets, and
self-hosted fonts. Do not substitute the OpenAI blossom, wordmark, or proprietary
font, or imply an official affiliation or partnership.

## Shared foundation

`src/interface.css` owns the shared visual foundation above legacy and feature
styles. Use its semantic variables and shared components before adding a local
override. Keep a justified feature-specific layout within the same typography,
spacing, state, and interaction rules.

| Role | ProofOfWork.Me rule |
| --- | --- |
| Appearance | Light, Dark, or System through the shared Appearance menu; System follows the device. |
| Light surfaces | Neutral background `#f7f7f5`, primary surface `#ffffff`, primary text `#242424`. |
| Dark surfaces | Neutral background `#212121`, primary surface `#2a2a2a`, primary text `#f1f1ef`. |
| Actions and navigation | Monochrome emphasis; use semantic tokens for borders, focus, hover, and selected state. |
| Status | Retain distinct success, warning, error, and information colors, accompanied by meaningful text or symbols. |
| UI and reading type | Self-hosted Inter Variable for interface, headings, and first-party article body text, including Publish. |
| Exact evidence type | Self-hosted IBM Plex Mono for txids, addresses, code, and protocol evidence; use tabular figures for comparable quantities. |
| Type roles | 12px for metadata, secondary labels, and compact secondary shell navigation or utility controls; 14px for ordinary form/action controls and UI text; 16px for base reading text and compact-screen form input. Long-form reading and headings may scale above these roles. |
| Spacing | Use the shared 8px, 12px, and 16px rhythm for related controls, card padding, and section gaps; larger gaps express hierarchy. |
| Corners | Shared small/medium/large radii are 8px, 12px, and 16px. Reserve circles or pills for an actual avatar, compact status, or segmented-control role. |
| Targets | Interactive controls retain at least 44 by 44 CSS pixels of usable target area. |

Keep normal text readable in both themes. Do not use smaller type, faint text,
heavy uppercase labels, decorative gradients, textures, or repeated nested cards
to fit a crowded layout. Simplify hierarchy, reflow, or disclose secondary detail.
Use sentence case for interface labels while preserving product names, acronyms,
symbols, user content, and exact protocol identifiers.

Text fields need visible space between their content and boundary. Ordinary
bordered text inputs and textareas use at least 12px of horizontal inset and 8px
of vertical inset.
When an icon, input, and action share a field wrapper, that wrapper owns the
border and focus treatment; the inner input stays borderless. Do not apply a
generic control border without reviewing the component's existing padding.
Checkboxes, radios, sliders, and file controls retain their native geometry.

Appearance is browser display state, shared across the product hosts by the
existing preference mechanism. It is independent of a wallet and outside the
organization-backup allowlist. Appearance and Computer layout changes must keep
the current workspace mounted and preserve drafts, selections, navigation, and
wallet connections. Storage failure must leave the controls usable.

## Identity and navigation

`src/assets/proof-mark.svg` is the canonical rounded W. `BrandMark` and generated
favicon, touch, and social assets derive from it. Preserve proportions, clear
space, and legibility at small sizes. `src/app/appIcons.ts` is the shared line-icon
catalog for public menus, landing cards, and Computer rail, dock, and launcher.
Keep icons consistent in stroke, size, and alignment; give icon-only controls an
accessible name.

Regenerate identity assets through `scripts/generate-brand-assets.mjs`. Current
assets are under `public/brand/20261011/`. A future identity revision uses a new
physical asset directory. Preserve old public asset bytes so previously loaded
HTML and retained releases keep their dependencies.

Standalone headers and shared footers use these groups in order:

| Menu | Products in order |
| --- | --- |
| Utility | Computer, Desktop, Browser, Pages, Code, Jobs, Permission |
| Identity & social | ID, DNS, Boost, Publish |
| Finance | Wallet, AMO, Credit, WORK, Infinity, Inception |
| Insights | Log, Growth, Search |

The brand opens Home. ID remains the menu label for the existing IDs product.
Keep canonical routes and local-preview routing intact. All first-class products
must remain discoverable; [README.md](README.md) records their destinations.

Computer uses its Apps launcher and workspace/layout controls as its header
navigation. Do not also put the standalone grouped menus in that header. The
rail or dock/launcher provides workspace access, and the grouped footer retains
public product links. Keep the full brand title readable and the desktop header
on one coherent row where space permits. On phones, a deliberate second row for
layout and local-data controls is preferable to clipped labels or smaller
targets. Mail folders, workspace navigation, local-data controls, and transaction
actions retain their separate purposes.
Dock icons and labels use consistent alignment and deliberate line height.
Keep labels, including All apps, on one line; size items for their readable text
instead of letting one wrapped label stretch the entire dock.

## Content, evidence, and interaction

Keep the current task and primary action clear. Secondary details may collapse,
but their controls and the underlying evidence remain reachable. Use consistent
hover, selected, disabled, loading, and keyboard-focus states. Overlay behavior
includes contained focus where appropriate, Escape dismissal, focus return to
the opener, and accessible expanded/selected state. Honor reduced motion.

Exact balances, fees, Q16 WORK amounts, prices, counts, addresses, txids, and
source bytes remain inspectable and copyable. Contain long values within their
component using deliberate reveal, copy, or local scrolling. Never hide document
overflow to conceal clipped evidence. Compact display labels must not change
canonical values or accessible exact-value descriptions.

Disconnected, loading, empty, pending, unavailable, stale, and confirmed states
are distinct product states. An unverified read is not a confirmed zero. A calm
interface must still explain errors, uncertainty, incomplete coverage, and
recovery actions. Preserve wallet/network scope and draft recovery when changing
layout or presentation. No visual cleanup may silently sign, send, retry, clear
data, or broaden authority.

Apply this system to first-party chrome and first-party reading views. Preserve
user-authored content, verified article text and hash commitments, supplied
media, source code, and sandboxed HTML/app output. Do not impose our typography
inside user-controlled documents or provider players. YouTube cards use our
surrounding controls; activated playback retains YouTube's own controls and its
Open on YouTube fallback. External media availability is separate from chain
verification and does not establish a successful local transaction.

New first-party Browser and Pages starter templates use neutral light/dark CSS
through `prefers-color-scheme`, sentence-case labels, and self-contained sans-serif
system type. These defaults apply only when generating new document source.
Existing drafts and imported or published HTML retain their authored styles and
exact source; the shell's appearance preference never rewrites document content.

## Acceptance before shipping

For each affected feature, inspect its standalone surface and its Computer
workspace when both exist. For shared changes, cover the landing page, both
Computer layouts, and representative reading, form, data-table, and media
surfaces; use the complete surface inventory to avoid omitting a product.

- Verify Light and Dark explicitly, plus System selection, persistence, and a
  device appearance change. Include unavailable preference storage where the
  preference code changes.
- Inspect wide desktop, intermediate widths, narrow phones including 320px,
  and short viewports at or below 480px high. Menus, dialogs, long values, and
  primary actions remain reachable without document-level horizontal overflow.
- Measure text insets and grouped-field boundaries with empty and filled inputs.
  Verify dock label wrapping and item height. Browser fullscreen must give the
  rendered page all remaining viewport height below its controls, including
  narrow and short screens; entering fullscreen alone is not a passing check.
- Verify keyboard traversal, visible focus, accessible names, Escape and focus
  return, touch targets, and reduced-motion behavior on the affected controls.
- Inspect disconnected/loading/empty/error/unavailable and populated states,
  including long names and exact-value evidence. Verify draft, wallet, route,
  selection, and local recovery preservation when changing shared navigation.
- Review the actual rendered result; update visual snapshots only after the
  difference is understood. Run checks appropriate to the changed behavior and
  relevant shared interface, protocol, and live-data contracts.

Follow [REPOSITORY_HYGIENE.md](REPOSITORY_HYGIENE.md) and the approved release
workflow in [AGENTS.md](AGENTS.md). Reconcile this document when a user-approved
change introduces a durable design rule. Do not announce release completion
until affected local/production surfaces and the mandatory release-sync gate
verify the same released source.
