# Production health, data, event, and storage audit 6

Date: 2026-09-08. Mode: read-only production audit plus the explicitly approved
local audit record. Initial live inspection began at 22:31 UTC.

**The application is serving and the confirmed accounting checks pass, but it
is not fully healthy.** Neither VPS is full. Intermittent Wallet/WORK write
readiness, a failing scheduled release verifier, retained storage, and newly
demonstrated Boost projection gaps remain follow-up work. No changed canonical
WORK/credit balance, missing canonical Log event, or corrupted supply was
demonstrated within this audit's coverage.

This audit does not claim that every possible future chain record, every
browser state, or the complete Core mempool has been verified. The coverage
and the counterexamples below explain that boundary.

## Continuity and authorization

All 15 existing artifacts in `audits/` were reviewed, including the latest
September 8 recovery addenda in [audit 5](2026-09-05-production-health-data-event-storage-audit-5.md).
The 13 predecessor Markdown files still match audit 5's recorded SHA-256
hashes. Their complete inventory is preserved in the
[evidence receipt](2026-09-08-production-health-data-event-storage-audit-6.evidence.json).
Earlier unresolved headings in audit 5 describe earlier checkpoints; its
latest recovery addenda govern the historical status.

Local source began clean at `e583d6c`. The node runs application `f342687`,
deployed earlier today; UI release remains `2ddefac`. Frontend source has no
diff between that deployed UI and this checkout; `server/` and `scripts/`
also match the deployed node commit. This pass does not reopen
the repaired September 8 transfer-fee/global-Wallet-supply issues as new
defects. It continues H5-01, H5-03, and H5-06 where new evidence warrants it.

No production file was edited or deleted. No service was stopped, restarted,
reconfigured, deployed, or reset. No migration, repair, backup, transaction,
refund, signing, broadcast, commit, or push was performed. The local changes
are this report, compact evidence, a historical source reproduction, and their
repository-hygiene classifications. Production audit database sessions were
explicitly read-only, with bounded timeouts and low-priority audit processes.
Credentials were consumed privately and excluded from evidence output.

## Confirmed checkpoint and exact accounting

The event audit, ledger audit, and independent arithmetic checks converged on:

```text
height      966118
block hash  000000000000000000004aa6d763f4d5248364588315945d7518f52b44408096
snapshot    8838634eac74c75285314707
lag         0
consistency green; missingLogEvents=[]
```

`audit:computer-events` passed all 49 checks with no warnings at 22:35:17 UTC.
`audit:ledger` passed against the same snapshot. Independent Python integer
reconciliation passed 77/77 assertions over the captured summaries and whole
credit-balance aggregates; binary floating-point aliases and USD were not
arithmetic authority.

| Exact quantity | Value |
| --- | ---: |
| WORK confirmed supply, Q16 subatoms | `210000000000000000000000` |
| WORK supply, WORK | `21000000` |
| Positive WORK holders | `356` |
| WORK/Growth live network value, Q8 | `838757623963447883106635908` |
| WORK floor, Q8 | `39940839236354661100` |
| WORK floor, proofs per WORK | `399408392363.54661100` |
| POWB confirmed supply | `630496569` |
| POWB network value, Q8 | `63050148300000000` |
| INCB confirmed supply | `224847713398447926` |
| INCB fixed issuance/network value, Q8 | `22484771339844794793582060` |
| INCB cumulative unissued dust, Q8 | `2193582060` |

The checks reconcile exact decimal aliases, live/frozen value, base plus credit
components, fixed plus movement components, legacy carry, bond supply, fees,
and floors. INCB dust accumulates from individually rounded issuance records;
it is not available to mint by rounding the cumulative total again. All 238
credit definitions were included in the aggregate cap review. There were 404
balance rows across 363 addresses, zero negative or fractional integer
balances, and zero nonzero pending balance deltas. WORK's holder sum equals
its cap exactly; POWB and INCB holder sums equal their exact supplies.

At this checkpoint a hypothetical new V8 25,000-proof face derives
`625925756` WORK subatoms, with the exact minimum price ceiling equal to
25,000 proofs. This is a formula check, not a new listing or permission to
reprice an existing listing. Frozen terms remain unchanged.

All 6,498 stored AMO transitions from 959621 through 966118 were contiguous in
height, previous block hash, and opening/previous-closing network value. All
had complete, block-atomic, fee-once and invalid-zero flags. This checks the
stored transition chain, not an independent full historical block replay.

At block 966119, independent integer recomputation also passed for all 717
stored V8 listing terms, including face-to-subatom division and bond
arithmetic. This recomputes the formulas from each stored frozen network
value; it does not independently replay history to derive each frozen value.

The same unchanged-tip Core sweep covered all 749 confirmed SQL credit
listings whose stored status was active/sealing: 736 ticket outputs were
unspent, 13 confirmed spent, zero pending-spent and zero missing. All returned
unspent output values/scripts/checkpoints matched. A spent historical SQL row
is not automatically an active public listing. The subsequent complete public
book at block 966120 returned all 689 listings across four stable-cursor pages,
with no duplicates, gaps, checkpoint changes or visible instances of those
13 spent IDs. Its authority receipt checked 720 candidates, excluded 31 spent
tickets, and reported 689 unspent outputs. These are different cohorts and
checkpoints; do not equate the raw SQL lifecycle count with the public book.
The five spent V8 anchors from the already documented H5-04 auxiliary spend
were absent from that book. No duplicate missing-closure finding is opened.

## Stored events, addresses, and pending status

| Entity at the event-audit checkpoint | Count |
| --- | ---: |
| Transactions, all statuses | 25,372 |
| Confirmed transactions | 25,092 |
| Pending transactions | 55 |
| Dropped transactions | 225 |
| Events, all statuses | 26,009 |
| Confirmed valid canonical activity events | 25,438 |
| Confirmed valid action transaction IDs | 24,791 |
| Event participants | 127,537 |
| Event references | 55,173 |
| Confirmed IDs | 505 |
| Confirmed credit definitions | 238 |
| Credit listings across lifecycle states | 934 |
| Confirmed mail items | 615 |
| OP_RETURN detail rows | 25,217 |

These counts describe different entities and must not be treated as
interchangeable public totals. Confirmed transactions had no missing raw data
or canonical block bindings; confirmed valid events had no missing or
unconfirmed parent transaction. Known sale, transfer, invalid-event, and
closure regression searches passed in the event audit.

The strict parity audit completed at 22:47:02 UTC against block 966119,
snapshot `0a0e5477bea1257cb6b08b19`: 100 passing checks, two warnings for
inactive historical V5 migration/quote paths, and zero error failures.
Transaction/event status, parent metadata, ID registry history, mail,
participants/references, holder projections and public history pagination
checks passed. Its later database sample had 58 pending transactions and
26,012 total events. Shared-extractor parity is not an independent semantic
oracle; H6-02 below demonstrates that limitation.

Two Core mempool samples fenced the pending-row query at unchanged block
966118. The samples contained 37,444 and 37,445 transactions. Every one of the
55 persisted pending transactions appeared in both; no stored dropped or
orphaned transaction appeared in both. The receipt retains both sorted-set
hashes. Unrelated mempool additions do not invalidate this persisted-set proof.

A later capture contained 56 WORK inspection markers: all five fields had
correct types, no recovery flag remained, and no terminal-invalid marker
coexisted with a valid WORK projection. Of those markers, 54 were protocol
invalid and two had valid projections. Different pending counts across timed
captures are expected; neither count changes confirmed balances.

The frequently logged pending transaction
`c8b485cba0dbdc7ac0e99dbd1a4eaca10bd96b746b5eede0932a54cb8bab4475`
was in Core but absent from the transaction table. Direct decoding established
27 inputs, one output, and **zero OP_RETURN/PWT records**. It trips the
zero-record branch of a combined raw-recovery error; the text saying bytes
do not match does not establish a byte mismatch. No application event is
expected from its own carrier. The address-discovery helper passes ordinary
address mempool transactions to the strict WORK verifier before checking for a
PWT carrier (`proof-api.mjs:23986,24077`), causing the repeated misleading
warning. This is noisy discovery classification, not a missing canonical
event or an established cause of the V8 admission pause.

The H5-04 auxiliary-spend repair remains correct: `4c079144…307359` has six
inputs, two outputs, 3,593 input proofs, 3,118 output proofs and a 475-proof fee.
The three previously repaired invalid duplicate seals remain confirmed,
invalid, and exactly zero in Q16. They were not repaired again.

## VPS, database, logs, and recovery storage

| Filesystem | Reported use | Available bytes | Approximate free space | Inode use |
| --- | ---: | ---: | ---: | ---: |
| UI `/` | 54% | `17883631616` | 16.66 GiB | 3% |
| Node `/` | 24% | `75809742848` | 70.61 GiB | 6% |
| Node `/data` | 78% | `377642373120` | 351.71 GiB | 1% |

Percentages above are `df` observations; API percentage calculations include
reserved filesystem space differently. The node data monitor correctly warns
above 75%; critical thresholds are 85% or insufficient free-space floors.
The node is not full, but its data warning must remain visible. UI free space
is above both its 12-GiB warning and 10-GiB deployment minimum.

Core, Electrs, PostgreSQL, API, worker and WAL receiver were running. Core was
unpruned, IBD false, verification progress 1, with no warnings, 124 peers and
all three configured indexes synchronized to 966118. Electrum and the
relational checkpoint matched the same hash. API/worker/Core/Electrs reported
`NRestarts=0` at the sample; this systemd counter does not count every manual
restart, including the separately documented release work. Both RAID1 devices
reported `[UU]`. Node memory had roughly
106 GiB available; UI roughly 3.4 GB available.

PostgreSQL `proof_indexer` occupied `23553137687` bytes (21.94 GiB). There were
no extra restore databases, invalid indexes, recorded deadlocks, or conflicts.
The largest relation was immutable AMO transition history, `22251782144`
bytes; snapshots occupied `872284160` bytes. These are not disposable logs.
Large-state tables remain in the intended `/data` tablespace. Autovacuum and
autoanalyze evidence is present. One scheduled query-health sample warned
about a short idle transaction; later scheduled checks recovered. The direct
sample found no lock wait. Cumulative temporary-query bytes (`550075252090`)
are a statistics counter, not current disk occupancy.

The WAL receiver slot was active with approximately 12.3 MB retained and a
16-GB retention ceiling. Seven daily logical dump sets were present, with the
latest successful run at 03:28:57 UTC September 8. Physical base backup last
completed successfully September 7. Logical dumps consumed about 77.56 GB,
physical backup/WAL storage about 79.78 GB. No new restore test was run here;
the September 5 restore verification remains historical evidence. Production
data checksums are off, so a null checksum-failure counter is not proof of page
integrity. Off-host disaster recovery remains unverified.

Node `/var/log` used about 1.18 GB; UI logs about 467 MB. UI retained access
logs contained 425,513 parseable JSON lines and zero malformed lines. Log
rotation and storage timers remain present. No UI OOM/storage/I/O failure or
large deleted-open file was found. The prior UI core-dump/Apport policy repair
remains installed. Historical failed recovery units were preserved rather than
cleared to manufacture a green service list.

Physical-network byte counters were also inspected: node RX
`1244627834123` / TX `9899211370339`; UI RX `995081402606` / TX
`133578278147`, with zero interface errors/drops. These are cumulative uptime
counters, not provider billing-period usage or remaining traffic quota.

## Findings to carry into the next audit

### H5-06 continued — intermittent readiness and incomplete diagnostics

Healthy samples do not establish uninterrupted availability. Between the
earlier recovery checkpoint at 13:13:24 UTC and approximately 22:35, UI access
logs recorded 495 HTTP 503 responses, zero HTTP 502, 827 status-zero requests,
and 13,870 HTTP 200. Status zero is not counted as successful. These include
repeated Wallet reads and broadcast-route refusals outside the controlled
cutover. The observation includes normal traffic and audits; it does not
identify unique affected users or a service-wide downtime duration.

The fresh WORK capture around 22:37 returned HTTP 200 and a coherent confirmed
snapshot, but V8 write admission was false with
`work-amo-v8-declaration-evidence-unavailable`. Worker readiness was true,
pins matched, and `migrationReadiness` was null. Two fresh reads at 22:39:05
and 22:39:13 returned full ready/write-admission true at the **same** block and
snapshot, without intervention.

Core independently proves the declaration at 960600/index 2369, physical
output 3, authority input and 546-proof registry payment at output 4. The full
`pwm1:m:` record is 5,593 bytes with SHA-256
`1ba53b285f95f8d69f0272c8e75c76b09cd3bd26281c68e665749368e7694528`.
The body alone is 5,586 bytes; these are different hash domains. There is no
evidence that the declaration disappeared.

Source inspection and a captured-state reproduction show why the public
reason is misleading: `workAmoV8ExactReadinessSweep` catches migration-reader
errors to null (`proof-api.mjs:10386`); the later combined evidence also
requires migration evidence (`:10800`), making the declaration validator
report missing declaration evidence. The underlying null may arise from epoch
drift, reader guards or a query failure; this audit does not select an unproved
cause. Preserve fail-closed admission while exposing the actual failed stage.

The 21:50–22:23 node journal contains five V8 broadcast pause errors, 45 fresh
Wallet unavailable errors, 108 repeats of the no-OP_RETURN pending recovery
diagnostic, and one expected worker deferral as Core advanced. That is useful
error evidence, not a clean uninterrupted-health result. The broadcast errors
logged only a generic reason, limiting retrospective correlation.

Latency remains material: public summary probes took up to roughly 12 seconds;
later marketplace regression reads took 20 seconds for summary and 36.6
seconds for the complete WORK payload. Exact correctness and fast serving are
separate requirements.

### H5-03 continued — scheduled node release verifier still fails

The earlier inability to read private `.git` changed, but scheduled release
health still failed September 7 and 8 on `.githooks/commit-msg`. The current
file is `0750 powadmin:powadmin`, while Git correctly declares `100755`.
The verifier runs as root with only `CAP_DAC_READ_SEARCH`. In that exact
capability boundary, `test -x` returns 1; as the owning user it returns 0.
Thus the verifier reports unsafe/mismatched executable mode for a file that
the application owner can execute. This is a reproduced verifier access-model
failure, not evidence that the deployed hook lost its executable bit.

Repair the narrow verification identity/access test without broadly opening
Git metadata or adding unnecessary privileges. Preserve current source
attestations and archive checks. Scheduled prune remains an intentional
dry-run; its success does not mean old archives were deleted.

### H6-01 — Boost ownership projection accepts unauthorized source input

High priority before relying on Boost transfer ownership. A local reproduction
executes the exact parser and ownership reducer using a synthetic outsider
transaction: 546 proofs are paid only to the outsider, and a `pwb1:t` points
another author's post to that outsider. The parser labels it valid and the
reducer changes displayed ownership. Source tracing found no intervening
owner or resolved-registry-output check in replay binding, persistence,
indexed reads or feed construction. A second independent review confirmed
the path.

Relevant anchors: `backfill-proof-indexer.mjs:4137,4391,5969,22508`,
`work-amo-v5-raw.mjs:3905`, and `proof-api.mjs:51333,51853` at the source hashes
in the receipt. Client signing checks cannot validate arbitrary records
submitted independently to the chain. Future repair must prove current-owner
authority and the correct registry payment at canonical position, keeping
invalid history visible without changing ownership.

**No live takeover was observed.** Production contains only three confirmed
Boost posts and no Boost transfer, hide or unfollow records. This reproduction
is parser/reducer execution plus source-path review, not a mined transaction
or full end-to-end replay. Canonical Boost replay currently assigns zero
economic delta; this finding does not establish changed WORK, ID or credit
balances or network value.

### H6-02 — Boost unfollow target missing from address-scoped event history

The shared participant/reference extractor omits `targetAddress` and
`targetId`. An ordinary unfollow pays only the registry, so the target has no
incidental payment-recipient row. The explicit `address=` event-history filter
therefore cannot discover the event for that target. The synthetic fixture
also proves that shared extractor-based parity can pass despite the omission.

Anchors: `proof-index-event-relations.mjs:172,240`, the writer at
`backfill-proof-indexer.mjs:13512`, and address filter at
`proof-index-reader.mjs:36225`. The global Boost graph reads the payload and
is not shown to lose the unfollow; broad text search can also find it. No
current production unfollow record was found.

### Existing Boost hide gap

The author-hide tombstone gap already recorded at audit 5's September 5 source
review persists: the ownership/feed reducer does not apply hide state. Keep
that existing finding rather than count it again.

### H6-03 — future mailbox completeness ceiling

Address-mail SQL caps two selections at 1,000 records without continuation
metadata (`proof-index-reader.mjs:38451,38575`), and the supplemental API
overlay fetches one bounded event page (`proof-api.mjs:60665`). This is a
demonstrated future completeness ceiling. Current global confirmed mail is
615, so no present address exceeds that boundary. A future repair needs
complete pagination with explicit authority, not a higher silent cap.

## Cleanup candidates and preservation boundary

H5-01 UI runway improved substantially: `/var/tmp/proofofwork-deploy` occupies
only 16 KiB, versus 6.82 GiB in the original September 5 observation. UI retained
backup/release evidence still occupies about 16.59 GB.

The current UI release-prune service retains a failed dry-run warning because
two complete rollback roots need classification. It verified eight managed
archives with zero unverified archives and correctly refused deletion. This
housekeeping result is separate from the healthy Caddy service.

| Candidate for a separately approved cleanup scope | Measured size | Required preservation decision |
| --- | ---: | --- |
| Node `/data/proofofwork-audit5-restore-20260905T144615Z` | `18545463296` bytes | Retained restore clone; preserve verification receipts and prove recovery coverage before retiring |
| Node `/data/proofofwork-audit5-restore-20260905T174233Z` | `22131757056` bytes | Same; no active registered cluster or `postmaster.pid` found in these clone paths |
| UI managed archives for `89736d9d42f7`, `fb4d08ab973e`, `5f3ab07b1ddd` | `535305516` bytes total | Resolve two complete rollback roots; preserve active `2ddefac` and immediate rollback `6a7d5c` provenance |
| Node retained staged checkouts and managed releases | Per-path inventory in receipt evidence | Classify current/immediate rollback and attest exact archives before pruning |

The two clone directories total `40677220352` bytes (37.88 GiB). Their names
and inactive registered-cluster status alone do not authorize deletion. No
system-wide open-file proof or new disaster-recovery restore was performed
for these candidates. The separate 11.27-GB audit safeguard, ordinary seven
logical backups, physical/WAL backups, immutable transitions, historical V7
material and release receipts remain protected. Unmarked V7 UI scratch is not
established disposable.

Existing audit artifacts total only 2,687,080 bytes. Removing previous audits
would lose the requested recursion history for negligible storage benefit.
Old August cleanup manifests include already removed paths and obsolete
release references; do not replay them as current deletion lists.

## Verification and limits

Passed local checks include WORK precision (131 assertions), precision V2,
AMO V8 and gates, historical V2/V5/V6 arithmetic, canonical ordering, bond
exact arithmetic, INCB replay/restore fixtures, Boost regression fixtures,
read projections, API truth, live-data, hardening, transfer-fee recovery
(504 behaviors plus attribution tests), audit-5 repair fixtures, UI contracts
and surface-read-state behavior. Existing Boost tests do not cover H6-01/02;
their passing result does not override the demonstrated counterexamples.

`check:worker-containment` failed locally at its poison-timeout fixture: the
child emitted the required record at 1,027 ms but the fixture kills it at
1,000 ms. Repeating alone did not make that gate pass. This is measured test
startup sensitivity, not an observed production worker failure.
`check:ui-ops` also failed: a compatibility-dependency Python fixture exceeded
its 180-second timeout. Its cause was not established. Neither timeout was
bypassed or marked green.

The public surface audit passed 13 hosts, 52 assets and 15 first-party API
probes; Boost separately passed its page, four assets and API, for 14 surfaces
total. Computer was last in the standard 13-host sweep; supplemental Boost
checks followed. Redirects preserve path/query. Current
Boost exact signal totals match the three rows. The known NFT DNS issue
persists. No supported browser was available after discovery, so this audit
claims no fresh screenshot, DOM, interaction, connected-wallet or device-lab
verification. HTTP/contract checks cannot certify every visible browser state.

Mail regressions passed. The protected ID audit failed its final fence at
22:43:10 UTC: the API journal explicitly reported that Core/Electrum state
changed while the lightweight fence was sampled. This is a correct refusal
to certify a moving checkpoint, not evidence of an incorrect ID winner. No new
complete ID replay success is claimed from that attempt; the prior successful
audit remains historical evidence.

A second actual attempt ran 22:47:50–22:50:00 UTC and failed the protected
coverage endpoint with HTTP 503. The journal confirms that Core checkpoint or
Electrum registry history changed while coverage was being built. The first
failure was at the final fence; the second was during coverage construction.
Both are retained as unsuccessful runs. The earlier accidental import-only
invocation produced no audit output and is explicitly excluded from passes.

The marketplace fast regression failed at 22:43:51 UTC after 334.6 seconds:
the request for `15eBH5vPH48BwXR6aTy29XJjivKuBcAc9D` returned HTTP 200 after
39.457 seconds but lacked the required authoritative wallet-scoped flags.
Earlier lifecycle stages passed; the later delayed-transfer and final-summary
stages were not reached. The original harness did not retain the response
body, so its cause cannot be reconstructed conclusively. A targeted repeat
returned authoritative Wallet state and V8 ready in 6.478 seconds at block
966119. This recovery does not turn the full regression run into a pass.

Final health and mandatory hygiene are recorded in the completion addendum
below. Point-in-time checks cannot
guarantee future mempool membership or eliminate the intermittent availability
and source gaps found here.

The [historical reproduction](2026-09-08-production-health-data-event-storage-audit-6.repro.mjs)
runs locally with `node audits/2026-09-08-production-health-data-event-storage-audit-6.repro.mjs`.
It reads source, prints hashes and synthetic outcomes, and never signs,
broadcasts or persists transactions. It is evidence of this version's behavior,
not a new production protocol or a regression test expected to remain failing
after an approved fix.

## Completion addendum

The last node `/health` sample at 22:50:38 UTC was HTTP 200/ready, with Core,
Electrum and all eight summary checkpoints at 966120/hash
`00000000000000000001c20923aa326341a846298353b72568221c96f08bb1eb`.
Snapshot `2b8385d5c13a8fe887e766d3` had zero lag, no canonical fault, no worker
consecutive failures and no observed unresolved pending events. Fresh WORK
at 22:50:47 was HTTP 200 with V8 write admission ready and unchanged exact
network value/floor. This recovery does not erase the earlier 503s or failed
regression runs.

Final disk samples remained UI 54%, node root 24%, node data 78%, with
`17883217920`, `75807514624`, and `377623621632` available bytes respectively.
Caddy, API, worker, Core and Electrs remained active with sampled
`NRestarts=0`. UI storage/provenance checks passed at 22:45; the release-prune
classification warning remained visible. The actual PostgreSQL and WAL
receiver units were active/running at 22:51:20. An earlier probe used a
nonexistent WAL unit name; the receipt explicitly corrects that probe rather
than reporting a production service failure.

Hygiene was reviewed against `SOUL.md`, all six canonical/bootstrap documents,
the note inventory, generated-artifact classifications, prior audit hashes,
cleanup allowlist, relevant test results and final repository status/diff.
The approved change records observations and counterexamples; it changes no
protocol or product behavior, so those canonical documents need no fabricated
edit. Historical evidence remains protected. `npm run hygiene:fix` found no
allowlisted rebuildable state. `npm run hygiene:check` passed. The only changed
paths are the three audit artifacts and
their hygiene classifications; no files were deleted, staged or committed.

Follow-up priority: resolve intermittent authoritative-read/admission failures
with checkpoint-correlated diagnostics; validate Boost ownership at canonical
position before relying on transfers; repair address relations and the known
hide projection; fix the scheduled verifier identity; then review the exact
cleanup candidates and future mailbox pagination. Preserve this audit's failed
gates and rerun their complete checks after an approved repair. Bulk raw
captures remain under `/tmp`; the durable receipt preserves their hashes and
the substantive outcomes, not a promise of permanent temporary-file retention.

## Ordered surface audit addendum — 2026-09-08

**The system is serving, but it is not fully healthy.** The checked confirmed arithmetic reconciles with Core and SQL; status and response-lifecycle defects prevent an all-clear. This addendum follows the requested fourteen-surface order, with Computer last. Public surface checks ran from 22:58:33 to 23:50:32 UTC; supporting private operations checks ran alongside them. Individual receipt times and checkpoints are retained.

The original audit above and its failed gates remain unchanged. Earlier audit logs, their recovery addenda and protected inventories were reviewed before numbering new findings. H6-04 through H6-18 below are new causes or narrowly scoped display defects; inherited issues keep their previous identifiers. Nothing was shipped or deleted. The only new repository work is this authorized audit append, its evidence, a portable historical reproduction and the corresponding hygiene classification.

Chrome became available after the extension connection. Public DOM, navigation, filters, pagination and viewport checks supplemented own-host HTTP/source/Core checks. No UniSat account was connected. Computer DOM and geometry were captured, but its screenshot requests hit CDP deadlines; no completed Computer pixel-verification or real-wallet signing pass is claimed.

### Ordered coverage

| Order / surface | Evidence and result | Measured read cost | Open qualification |
| --- | --- | --- | --- |
| 1. Home | 505 confirmed IDs; Core-bound testimonial; menu/focus and narrow layout checked. | Counts 5.450s; 708 decoded bytes. | H6-04. |
| 2. ID | All 505 records and exact WORK identity match SQL/Core (514 checks). Registration-only surface. | Registry 5.577s; 1,843,169 decoded / 193,896 wire bytes. | Initial two 503s at a one-block fence retained; H6-05. |
| 3. Desktop | Three confirmed public files have exact Core bytes/hashes; type filtering works. | Mailbox 7.473s; 55,834 decoded bytes. | H6-06; existing future mailbox cap H6-03. |
| 4. Browser | Known HTML renders inert with sandbox/CSP and exact Core content; invalid txid refused. | Transaction 2.331s; 5,811 decoded bytes. | H6-12; status is a load snapshot, no reorg exercise. |
| 5. Boost | Three posts, authors, fees and WORK signal reconcile (39 checks). | Feed 4.604s; 5,685 decoded bytes. | Existing H6-01/H6-02 and hide gap remain. |
| 6. AMO | All 689 credit/bond tickets plus six ID tickets matched current Core unspent outputs; 3,491 checks. | Four book pages 26.009s summed request time; 11,308,662 decoded / 890,391 wire bytes. | H6-07; action readiness remains separately qualified. |
| 7. Credit | All 238 definitions and holder/cap aggregates reconcile (842 checks); 236 nonbond choices. | Directory 7.731s; 400,619 decoded bytes. | H6-08 and H6-13. |
| 8. Wallet | 225 arithmetic/UTXO checks; 196 outputs match Core; reservations and historical nonreserving relics qualified. | Main WORK 9.727s; 813,156 decoded bytes. | H6-09; actual V8 admission failure retained; no connected UniSat. |
| 9. WORK | 356 holder sums equal the exact 21m cap; 717 of 718 checks pass. | Summary 11.108s; 5,222,488 decoded / 379,983 wire bytes. | Failed check is live dropped-as-pending H6-11; confirmed math passes. |
| 10. Infinity | 1,903 checks over 476 points, 11 holders, exact supply/backing/floor. | Summary 6.998s; 210,892 decoded bytes. | H6-10 and H6-14; no induced reorg. |
| 11. Inception | 148 checks over 46 issuance points and seven holders; fixed value and per-event dust exact. | Summary 5.679s; 43,626 decoded bytes. | Shared H6-10; fixed H−1 inputs were bound, not replayed from genesis. |
| 12. Log | 25,438 confirmed + two pending actions; both pending seals in Core; 230 checks; pagination advances. | Summary 6.010s; page 9.873s / 1,165,390 decoded bytes. | First search failed then recovered; H6-15 live search loss; H6-16 source collision. |
| 13. Growth | 43 exact checks and six model checks; forecast switch leaves exact chain value unchanged; event pagination works. | Summary 6.107s; 165,333 decoded bytes. | Historical chart/model/USD are approximate; shared H6-10. |
| 14. Computer | Entered last. IDs/AMO separation, scoped Wallet and Inbox, six ID tickets; 45 mailbox checks + final 49 event checks. | Mail 6.777s; final event gate 70.813s at 966124. | H6-17/H6-18; long AMO hydration; connected account and pixel-capture limits. |

These assertion counts overlap and test different cohorts. They are not a count of independently replayed transactions. HTTP measurements include network/server/body time, not browser paint. Wire sizes are compressed received bytes; decoded sizes include JSON duplication. Per-surface entry/completion timestamps are in the nested evidence receipt.

### Exact accounting and lifecycle boundaries

WORK remains exactly 21,000,000 units across 356 positive holders. All 404 balance rows across 363 addresses and all 238 definitions passed the aggregate integer/cap review. Independent formulas matched all 717 stored V8 terms; all 689 public credit/bond tickets and six public ID tickets were checked against current Core outpoints. Frozen inputs were verified as stored, checkpoint-bound inputs; they were not independently rederived by replaying the full history.

| Quantity | Exact value |
| --- | ---: |
| WORK/Growth network value, Q8 | `838757623963447883106635908` |
| WORK floor, Q8 | `39940839236354661100` |
| POWB supply | `630496569` |
| POWB network value, Q8 | `63050148300000000` |
| INCB supply | `224847713398447926` |
| INCB fixed value, Q8 | `22484771339844794793582060` |
| INCB cumulative unissued dust, Q8 | `2193582060` |

Infinity’s 476 chart points and Inception’s 46 issuance points reconciled using exact integers and 455 unique Core block-hash bindings across both bonds. INCB issuance rounds each event individually; cumulative dust must not be minted by rounding the cumulative total again. Growth forecasts and USD conversions do not participate in this accounting. Its 241 historical numeric chart points do not provide an exact per-point ledger proof.

The main sampled Wallet held 8,832,230,893 WORK subatoms, reserved 8,832,230,877 in twelve active listings, and had zero pending outgoing delta: exactly 16 mathematically unreserved subatoms. This is not a claim of operational spendability while V8 admission is paused. Its 196 confirmed Core UTXOs totaled 103,560 proofs: 5,280 below the 546-proof funding threshold, 6,552 in protected ticket anchors, and 91,728 otherwise eligible under the audited policy. Historical disabled cutover relics were correctly nonreserving.

Public Log had 25,438 confirmed actions and two pending seals, both in Core’s sampled mempool. The dropped WORK transfer in H6-11 was excluded from Log and absent from Core’s sampled mempool. Pending internal SQL event IDs changed during rematerialization while transaction/kind/protocol-position identity remained stable; future UI keys must preserve that distinction. Public Log intentionally excludes invalid/dropped records, so it is not the complete terminal-event forensic ledger.

Count differences were checked rather than flattened: Growth’s 78 marketplace sales are four current ID buy5 sales plus 74 credit sales. WORK’s generic historical sale cohort has 49 rows, while its full confirmed market cohort has 74. Growth counts 47 confirmed tagged INCB parent actions and 27,932 paid proofs; the issuance page counts 46 accepted mints and 27,386 direct proofs. The 546-proof difference is the already documented canonical parent whose derived mint remains quarantined. No new mint or supply was inferred from that parent.

The final unchanged `audit:computer-events` run through Computer’s host passed 49/49 checks without warnings in 70.813 seconds, ending 23:46:24 UTC at height 966124, hash `00000000000000000001fb82cb62f41e4af95b2f35b1507d31a723eedfcdf6bf`, snapshot `180b18aeedfaf2de7685c48f`, lag zero and no missing Log events. Read-only database settings were proven for that run. Thirty unique confirmed transactions in the selected public mailbox matched Core; all 33 returned mailbox rows matched Desktop after excluding read timestamps. Its historical dropped outgoing mail remained explicitly dropped.

### New findings

#### H6-04 — Home quotation omits an intervening sentence (low)

**Evidence: Core-backed editorial observation.** The testimonial joins nonadjacent sentences without an ellipsis. The linked transaction, subject and attribution otherwise match.

Recommended repair: Mark the omission or label the text as excerpts; preserve the canonical message.

Source: `src/features/landing/LandingApp.tsx:456`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-05 — ID contraction guard can retain stale records (medium)

**Evidence: Exact-source synthetic counterexample.** A fresh registry shrinking from two records to one is rejected solely on length. A disappeared pending ID and the previous confirmed owner/receiver survive; the caller still marks the read verified. No live stale ownership was observed.

Recommended repair: Accept complete canonical checkpoint changes and replace volatile pending membership separately; retain fresh exact-ID action preflight.

Source: `src/App.tsx:17792`, `src/App.tsx:21301`, `src/App.tsx:28009`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-06 — Desktop accepts an older target response (medium)

**Evidence: Exact-source synthetic counterexample.** Resolving request B before earlier request A lets A replace the displayed address/profile and clear loading. The guard only identifies the workspace. No live wrong-address result was observed.

Recommended repair: Bind response acceptance and loading ownership to request generation, network and target; cancel superseded reads.

Source: `src/App.tsx:26011`, `src/App.tsx:35798`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-07 — AMO complete-book cache ignores same-block changes (medium)

**Evidence: Exact-source synthetic counterexample.** A retained complete book is reused at the same height/hash despite fresh=true and changed snapshot/indexedAt; the fixture makes zero new reads. Mempool ticket spends can change without a new block. No bad live purchase was demonstrated; action preflight remains separate.

Recommended repair: Separate immutable confirmed projections from current outpoint/mempool authority, and honor explicit fresh reads. Do not extend this invalidation shortcut for speed.

Source: `src/App.tsx:21403`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-08 — Credit history failure becomes a false empty result (medium)

**Evidence: Exact-source synthetic counterexample and dependency review.** Failed remote holder/mint history clears remote state and loading, then falls back to omitted local history and renders No Holders/No Mints. Refresh dependencies omit checkpoint/revision, so unchanged counts need not refresh changed records. The repaired root directory loading state remains intact.

Recommended repair: Track loading, unavailable, last verified and authoritative empty separately for each history lane; invalidate on accepted source revision.

Source: `src/App.tsx`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-09 — Wallet UTXO reads can restore an obsolete result (medium)

**Evidence: Exact-source synthetic counterexample.** Same-account initial/focus/interval reads lack a response-generation fence: an older one-output response can overwrite a newer empty response. Four token lanes have their own guards. No real spend or connected-wallet incident was tested.

Recommended repair: Guard UTXO acceptance by account, network and request generation, and retain independent fresh funding/anchor preflight.

Source: `src/App.tsx:24086`, `src/App.tsx:24096`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-10 — Monotonic summary guards reject a lower canonical branch (medium)

**Evidence: Bond exact-source fixture; Growth source continuation.** Bond summary acceptance rejects lower supply/network value even when the supplied checkpoint is a newer, different canonical branch; the old object is silently retained. Growth has the same monotonic assumption. The fixture assumes canonical branch authority; no production reorg was induced.

Recommended repair: Validate branch/checkpoint authority and completeness explicitly. Distinguish stale responses from legitimate canonical decreases without weakening fail-closed validation.

Source: `src/App.tsx:17848`, `src/App.tsx:21559`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-11 — WORK counts a dropped transfer as pending (medium)

**Evidence: Live API, SQL and Core mismatch; exact-source reproduction.** WORK reports pendingTransfers=1 although SQL has 221 valid confirmed, zero valid pending and one dropped transfer. Transaction d13f042e40a7d0dadd8be29e1fadcae0d35803344ecd3ebf32a1089ea9b53679 is absent from Core mempool. The reproduced source counter uses !confirmed; the live mismatch was independently verified without dynamically tracing the exact runtime route. Confirmed balances and supply remain correct.

Recommended repair: Count explicit valid pending lifecycle state, excluding dropped/invalid/orphaned history; keep terminal records replayable and separate membership from confirmation.

Source: `server/proof-api.mjs:38396`, `server/proof-api.mjs:36130`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-12 — Browser completion can undo a network selection (low)

**Evidence: Exact-source synthetic counterexample.** Changing the selected network during a page load can be undone by completion of that old load. The proof card still uses the loaded page network; no falsely labeled chain proof was observed.

Recommended repair: Invalidate or cancel the outstanding load when network selection changes.

Source: `src/App.tsx`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-13 — Credit form overflows a narrow viewport (low)

**Evidence: Live DOM geometry and screenshot.** At a 375px viewport the document reaches 387px because the mint form/select intrinsic width extends past the viewport.

Recommended repair: Allow the form/select grid items to shrink and verify long credit labels at narrow widths.

Source: `src/App.tsx`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-14 — Infinity chart clips leading axis digits (low)

**Evidence: Live DOM geometry and screenshot.** Floor-axis labels extend to x=0.31–4.89px while the SVG begins at x=32px. Leading digits are clipped even though complete decimal text exists in the DOM.

Recommended repair: Size the chart gutter for the formatted labels or use compact tick labels with exact accessible values.

Source: `src/App.tsx`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-15 — Log background refresh removes a verified search (medium)

**Evidence: Live symptom and exact-source fixtures.** Both a zero-result dropped-tx search and a one-result confirmed-tx search became Search to verify without input changes, while their success banners remained. The 15-second effect captures the initial empty query, loads a global page and replaces the filtered page; txid searches have no profile to restore. Ordinary overlapping page reads can also accept the older response last.

Recommended repair: Refresh the current query/page from current scoped state, preserve a matching snapshot and generation, and bind loading/error/status to the accepted request.

Source: `src/App.tsx:24710`, `src/App.tsx:24735`, `src/App.tsx:26183`, `src/App.tsx:36017`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-16 — Log UI keys omit protocol record identity (medium)

**Evidence: Exact-source synthetic counterexample.** Two same-kind records in one transaction at different protocol positions receive the same UI key. The local fallback merges two fixture records into one; direct server pages have a React reconciliation risk. No collision or missing row was observed in the captured 60-head/50-page sample.

Recommended repair: Use stable transaction, kind and protocol-position identity consistently. Pending internal database IDs can change during rematerialization, so an eventId-only patch is insufficient.

Source: `src/App.tsx:35911`, `src/App.tsx:35946`, `server/db/proof-index-reader.mjs:20752`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-17 — Manual mail refresh can apply the previous account mailbox (medium)

**Evidence: Exact-source synthetic counterexample.** A refresh started for account A completes after switching to B and opening IDs; A mail replaces the inbox, the old folder is reopened and success is reported. Connection/sync loaders have wallet-generation guards; manual refresh lacks them. No live account-switch incident or signing bypass was observed.

Recommended repair: Fence each awaited mail/status result by wallet generation, address, network and workspace; accept inbox rows only for the active account.

Source: `src/App.tsx:30416`, `src/App.tsx:30446`, `src/App.tsx:30452`. The nested receipt retains the named evidence, source hashes and scope limitations.

#### H6-18 — AMO refresh banner uses the wrong quantity and sales scope (medium)

**Evidence: Live DOM and source.** The banner calls rounded network total 8,387,576,239,634,479,000 proofs the WORK floor, and reports 40 preview sales. The main panel correctly shows floor 399,408,392,363.546611 proofs/WORK and 74 confirmed sales. An alternate banner also labels network value as floor.

Recommended repair: Render the exact floor field with proofs/WORK, or label network value accurately; report aggregate sales or explicitly identify the preview count.

Source: `src/App.tsx:27372`, `src/App.tsx:27387`, `src/App.tsx:26656`. The nested receipt retains the named evidence, source hashes and scope limitations.

### Existing findings and failed checks retained

H5-01 storage/retention warnings and H5-03 scheduled release-verifier identity remain open. H5-06 gains the two ordered ID 503s, the actual Wallet V8 admission refusal (`work-amo-v8-declaration-evidence-unavailable`), the first failed Log query and prolonged Computer AMO hydration. Later reads recovered; recovery does not turn earlier failed checks into passes. AMO automatically fetches on entry, but waits for complete listing hydration before accepting its summary. Four sequential book pages can keep the page loading for minutes; there is a per-request deadline but no aggregate hydration deadline.

H5-02 gains narrow Computer cold-ID and disconnected-wallet/inbox observations, plus retained balance-row qualification. The initial Computer IDs zero/empty state was observed before automatic 505-record recovery; the saved later file already contains 505, so it is not evidence of a retained cold screenshot. The disconnected Register ID button is enabled, but the handler rejects missing local signing capability before transaction work. No signing bypass was demonstrated.

Existing H6-01 Boost ownership validation, H6-02 unfollow participant attribution, the previously logged Boost hide projection, and H6-03 future mailbox 1,000-row cap remain unchanged. The known WORK chart High approximation also remains: the exact floor is `399408392363.54661100`, while that floating display shows `399408392363.54663`. This is not newly numbered as a second accounting defect.

The original protected-ID gate failures, incomplete full marketplace regression, local worker start-deadline failures and UI-ops timeout above remain failures. The final event pass does not certify their unreached stages. Wrong guessed module/log/unit/file names and browser CDP deadlines are explicitly separated as harness limitations.

### Final VPS, database, logs and traffic checks

| Filesystem | Used | Application-available bytes | Approximate available GiB |
| --- | ---: | ---: | ---: |
| UI root | 54% | 17,882,599,424 | 16.65 |
| Node root | 24% | 75,789,131,776 | 70.58 |
| Node /data | 78% | 377,533,968,384 | 351.61 |

These samples were taken at 23:44–23:46 UTC. Neither VPS is full, and inode usage is low. The node data filesystem remains above its configured runway warning threshold; this is an existing capacity warning, not an out-of-space incident.

Core, Electrs, API, worker, PostgreSQL, WAL receiver and UI Caddy were active with sampled restart counts zero. Core was unpruned, out of initial block download, with txindex synced; Core, Electrum and all eight summary checkpoints agreed at 966124. Private readiness was HTTP 200 in 1.352 seconds with no unresolved observed pending events or worker consecutive failures. Direct event-loop lag and ZMQ subscriber loss were not measured; endpoint responsiveness and notification configuration do not prove those properties.

The indexer database occupied 23,578,999,831 bytes (21.96 GiB). WAL occupied 83,886,080 bytes, and the active physical receiver slot retained 8,163,400 bytes. At the final SQL snapshot, no active or long-running queries were found. Earlier retained monitor samples had two active queries, with oldest durations of 14 seconds and one second. No lock waiters, idle transactions, deadlocks or conflicts were found in the sampled checks. PostgreSQL data checksums remain off: a null checksum-failure counter is not a checksum pass. No fresh restore drill was performed. Temporary-write counters rose by 85 files / 1,569,368,870 bytes since the earlier performance receipt; those cumulative work counters include this audit and are not resident wasted storage.

The final 15-minute Caddy sample contained 368 records, no malformed JSON lines and no 5xx. Ninety-nine 421 responses were bare-IP scanner paths, not application-host failures. Five application reads had status zero and no completed body (two Log summaries, two Log histories and one Growth summary); the access records alone do not establish why they ended. Earlier sampled 503s remain evidence. The current node journal sample had 3,038 records and recurring known storage-monitor warnings; the earlier noisy pending-recovery diagnostic did not recur in this bounded window, which does not establish a fix.

Physical-interface lifetime counters were node receive 1,244,762,817,381 / transmit 9,900,278,959,331 bytes and UI receive 995,865,511,185 / transmit 133,655,387,503 bytes, with zero sampled interface errors/drops. These are cumulative interface counters, not provider billing-period traffic or remaining quota; tunnel/bridge counters must not be added as unique traffic. Provider quota remains unverified.

### Prioritized improvements for approval

1. Repair correctness and stale-response handling first: H6-11 pending status, H6-15 Log refresh, H6-18 mislabeled banner, account/target/UTXO generations, record identity and checkpoint-aware acceptance. Include deterministic reversed-response, same-height pending change, unavailable-data and canonical-branch fixtures. Preserve exact BigInt Q8/Q16 and current local-signing/fresh-action boundaries. Existing Boost ownership validation remains a high-priority prerequisite before relying on transfers.
2. Resolve H5-06 with request/checkpoint-correlated timing for readiness, SQL, Core outpoints, serialization and page hydration. Cache immutable confirmed work by block hash/model/commitment, then reacquire bounded current mempool authority. Publish qualified summary metrics independently from slow complete-book hydration. Never use a visible short page as the complete reservation or spend authority.
3. Reduce repeated payload and database work: the AMO book transfers 11.31 MB decoded across four pages, WORK summary 5.22 MB, and one Wallet lane about 0.81 MB. Reuse the complete confirmed projection before page slicing, avoid duplicated witness/display fields, and provide one compact exact Wallet balance/reservation/checkpoint projection. Profile before changing memory settings or adding indexes. Measure p50/p95/p99, authority-ready latency, request/RPC counts, decoded bytes and parse cost under bounded representative load.
4. Continue measured module splitting and cancel superseded timers/requests. Home/Boost lazy roots, Home counts, point-ID reads, Credit directory projection, compressed immutable assets and the earlier listing-display reduction are already deployed; do not re-propose them as absent. Keep chart geometry approximate where useful, but exact labels and copy must not come from floating aliases. Correct narrow Credit sizing and Infinity tick clipping.
5. Retain capacity alerts and classify cleanup precisely. Three UI archive candidates total 535,305,516 bytes, subject to resolving two rollback roots and preserving the required current/rollback evidence. Two inactive restore-clone candidates total 40,677,220,352 bytes (37.88 GiB), subject to a final no-live-use and retained-recovery proof. Twenty-three node stage directories total 5,058,666,496 bytes, but that entire cohort is not a reclaimable estimate. Current/rollback trees, WAL, recovery safeguards, ledgers, audits and compatibility artifacts remain protected. No candidate was deleted or upgraded to proven disposable by this pass.

The exact candidate paths and preconditions are preserved in the receipt and earlier storage section. Historical notes and backups were reviewed by purpose, not age. No comparison benchmark against UniSat or other products was run; the recommendations establish measurable local targets rather than claiming competitive superiority.

### Durable reproduction and handoff

The [ordered historical reproduction](2026-09-08-production-health-data-event-storage-audit-6.ordered-repro.mjs) contains ten frozen source fixtures plus a nested Log automatic-refresh case. It runs with Node built-ins only, without the checkout, TypeScript, external input files, network, wallets or writes. Its SHA-256 is `e31fe2e1c5334a85d5aa9661d18b24a524f80b74192c79d4d4c92127a426a6ea`. Success means the recorded counterexamples reproduce; it does not certify a later repaired source tree.

```sh
node audits/2026-09-08-production-health-data-event-storage-audit-6.ordered-repro.mjs
```

The nested `orderedSurfaceAudit20260908` evidence preserves per-surface timing, selected substantive Core/SQL checks, current operations receipts, source findings, browser geometry, failures, limitations and raw-artifact hashes. Original receipt fields retain their original completion checkpoint. Bulk raw captures and screenshots remain temporary; permanent retention is not implied.

Final record completed at 2026-09-08T23:55:15.307808+00:00. `npm run hygiene:fix` found no allowlisted rebuildable state; `npm run hygiene:check` passed. The installed portable artifact passed the isolated ten-fixture run, including its nested Log case. Independent reviews found no arithmetic discrepancy; timing and scope wording were tightened to match the receipts. All 597 inventoried evidence hashes matched, the original report prefix and original top-level evidence fields were preserved, and the earlier reproduction remained unchanged.

`SOUL.md`, the six canonical/bootstrap documents, repository-hygiene rules, note inventory, generated-artifact classifications, prior audit evidence, cleanup allowlist, relevant checks and final status/diff were reviewed. The audit changes no product or protocol behavior, so canonical documents need no fabricated edit. Only the four audit artifacts and their hygiene classification are in the worktree; no files were deleted, staged or committed. No production source, configuration, data, service, wallet, history or deployment was changed.

## User-requested cosmetic follow-up — 2026-09-09T00:33:27.952035+00:00

### H6-19 — Move Boost Timeline into the left action panel (low)

**Requested change, logged for later implementation.** Move the **Timeline** navigation control out of the Boost profile header and into the left sidebar button group containing **Post From Mail** and **Get ID**. Match those sidebar controls and retain the existing return-to-main-timeline destination and behavior. Verify the placement in both the desktop sidebar and responsive Boost tools layout; the profile header should no longer contain the button.

The supplied screenshot shows the current placement above the profile name. Source locations are `src/features/boost/BoostRoot.tsx:1588` (sidebar action group) and `:1840` (current Timeline link). Screenshot SHA-256: `48b22eba57921399a5bfaa1b178c798ec473221ddb009666ff77cdda19c7d332`. No matching request was found in previous audits; the previously fixed H5-13 sidebar clipping issue is separate.

This entry records the requested cosmetic change only. The application UI and its protocol, math and event behavior have not been modified.
