# Ordered ProofOfWork application surface audit 14 — 2026-09-19

## Audit date and scope

Read-only application-surface audit performed 2026-09-19 UTC. The prior audit
chain, including audits 11, 12, and 13, was reviewed before beginning. No
code, configuration, production data, database, ledger, backup, log,
infrastructure, service, or cleanup change was made.

The surfaces were reviewed in the requested order, with Computer checked last.
The in-app browser could reach the public sites; the command-line audit harness
continued to report API `fetch failed`/DNS reachability errors. Direct full-node
SSH/RPC verification was not available from this environment, so application
values are recorded as observed UI evidence and are not treated as an
independent full-node reconciliation.

## Ordered surface results

1. **Home — `proofofwork.me`**
   Rendered successfully. Displayed 505 confirmed IDs, 22 pending IDs, and
   527 visible records. The page initially showed canonical registry loading,
   then populated these values.

2. **ID management — `id.proofofwork.me`**
   Rendered successfully with registry overview and registration controls.

3. **Desktop — `desktop.proofofwork.me`**
   Rendered successfully with public file-search controls and confirmed-data
   messaging.

4. **Browser — `browser.proofofwork.me`**
   Rendered successfully with txid input and verified HTML rendering controls.

5. **Boost — `boost.proofofwork.me`**
   Rendered successfully. Displayed 6 indexed records, 6 posts/listing
   summary context, and social signal totals.

6. **AMO — `amo.proofofwork.me`**
   Rendered, but remained in `Loading` / `Verifying one coherent registry,
   credit, and WORK snapshot from the ProofOfWork index` state. AMO data was
   not certified as loaded.

7. **Credits — `credit.proofofwork.me`**
   Rendered successfully with overview, creation, and credit-factory controls.

8. **Wallet — `wallet.proofofwork.me`**
   Rendered successfully with balance, transfer, listing, and related wallet
   controls. No wallet was connected, so account-specific balances were not
   tested.

9. **WORK — `work.proofofwork.me`**
   Rendered successfully. Observed values included 21,000,000 / 21,000,000
   WORK confirmed, 357 holders, 21,000 confirmed mints, and a disabled mint
   action because confirmed supply was exhausted. The displayed live floor was
   `399,409,485,499.43425682` proofs per WORK.

10. **Infinity Bonds — `infinity.proofofwork.me`**
    Rendered successfully with overview, history, and bond-market controls.

11. **Inception Bonds — `inception.proofofwork.me`**
    Rendered successfully with overview, history, and bond-market controls.

12. **Log — `log.proofofwork.me`**
    Rendered, but remained in `Loading cached Computer log` state. Current
    indexed-log completeness was not certified.

13. **Growth — `growth.proofofwork.me`**
    Rendered, but reported `Verified Growth ledger unavailable`. Current
    growth-ledger rendering was not certified.

14. **Computer — `computer.proofofwork.me`**
    Checked last as requested. Rendered the Computer shell, but remained in
    `verifying canonical data` state. With no UniSat connection, account areas
    showed zero values; this is not evidence of zero production balances.

## Findings and continuity

The following are unresolved/materially current surface findings, carried
forward rather than duplicated as unrelated issues:

- AMO coherent snapshot loading did not complete during the audit.
- Log did not complete its indexed-log load.
- Growth reported that its verified ledger was unavailable.
- Computer canonical verification did not visibly complete.
- The command-line audit harness could not reach the API while the in-app
  browser could reach the UI, indicating an audit-environment/API-path
  discrepancy.
- Full-node authoritative reconciliation could not be performed because
  direct node access was unavailable.

No new protocol-record corruption, duplicate record, arithmetic discrepancy,
or confirmed/pending status error was proven by this surface-only pass.

## Actions taken

- Reviewed prior audit records before beginning.
- Navigated through all 14 surfaces in the requested order.
- Checked Computer last.
- Recorded rendered states and incomplete-load conditions.
- Created this audit log only; no production mutation, cleanup, restart,
  deployment, or repair was performed.

## Recommended follow-up

1. Restore direct read-only full-node/API audit access.
2. Re-run AMO, Log, Growth, and Computer after canonical verification reaches
   a completed state.
3. Run the ordered audit harness from an environment with functioning DNS/API
   access and attach machine-readable results.
4. Reconcile the displayed registry, WORK, marketplace, event, and growth
   values against the same fenced full-node/indexer checkpoint.
