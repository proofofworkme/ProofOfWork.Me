# All-product Growth release

Date: 2026-09-05 (UTC)

## Approved scope

The user approved completing the all-product model, updating the main report,
generator and charts while preserving the historical baseline, running checks
and hygiene, committing, pushing to origin, and deploying the API and shared UI
with production verification and rollback available.

The deployed node and UI use application source commit
`6a7d5c12e403e0ddb6247fa2a6865cb70d623a8e`, tree
`bc84d0294fc4fdd9e0dd2b9943f6b330197e1ea7`, on
`growth-all-products-2026-09-05`. Tooling commit
`760d36f3762b45cc392ef6c34abc6b61a01b73b7` repairs the release helpers and
records progress. This receipt records deployment and verification separately
from the unchanged application build's source identity.

## Product and accounting result

The [main report](../output/proofofwork-computer-agent-adoption-model.md), JSON,
five SVG charts, PNG companions, and Growth's selected forecast now use
`2026-09-05-all-products-v1`. One shared source maps 16 product surfaces and
workspaces to 11 economic activity lanes. Shared carriers, read-only surfaces,
balances, synthetic issuance and derived WORK diagnostics add no second copy
of economic value. One capacity ceiling covers physical writes and service
flows; the inherited identity-stock convention remains explicit.

The scenario retains historical May adoption, node and USD inputs. It is not a
September chain calibration or a canonical replay of future WORK revaluation,
INCB issuance, or frozen sale-ticket terms. Production actuals remain separate,
checkpoint-bound observations.

The complete May report, JSON, five SVGs and five PNGs were preserved
byte-for-byte against the pre-change Git versions in the
[historical archive](../output/historical/2026-05-13/README.md). Its manifest
and reproducible generator remain checked. The intermediate Boost-only
scenario remains available separately.

The API's Boost overlay reads the complete confirmed indexed history at the
Growth checkpoint, verifies exact payment outputs from transaction bytes, and
reports unavailable metrics when evidence is incomplete. Shared Mail/Files
payments and WORK attachments are identified without adding them again to
canonical network value. The [Boost accounting proposal](../BOOST_GROWTH_ACCOUNTING_PROPOSAL.md)
remains a draft: this release activates no new canonical economic contribution,
protocol declaration, fee, signing flow, issuance rule, or sale repricing.

## Local and candidate checks

- TypeScript and Vite build passed; the existing chunk-size warning remained.
- `npm run check:growth` passed: 31 tests across forecast, observation, client
  and historical-artifact checks.
- Four Growth Playwright tests passed, including the original-baseline
  selector, canonical actuals, complete product details, missing or mismatched
  Boost checkpoints, and mobile layout.
- `check:ui`, `check:server-globals`, `check:api-truth`, and `check:live-data`
  passed.
- `npm run hygiene:test` passed all 33 tests. Required hygiene fix/check,
  semantic documentation review, final diff review and commit hooks passed.
- Chart text bounds and rendered charts were reviewed. Current deterministic
  outputs matched their generator; all 12 archived artifacts matched their
  pre-change bytes.
- The UI release was built from a clean detached checkout of the exact source
  commit: one TypeScript check followed by each surface-specific Vite build,
  with Computer copied to the NFT compatibility root. Package installation
  used the lockfile, disabled lifecycle scripts and isolated npm configuration.
- The staged API's 13 focused backend tests and read-only PostgreSQL shadow
  verification passed before cutover. Exact canonical totals matched the
  existing API at the same checkpoint.

## Node release

The API and worker were atomically exchanged onto the exact source commit.
Private verification ran with the WireGuard ingress closed; ingress reopened
after the installed release publisher created and verified provenance.

- Release ID: `6a7d5c12e403-20260905T050928Z`.
- Archive: `/data/proofofwork-release-backups/managed/proofofwork-node-release-6a7d5c1-20260905T050928Z.tgz`.
- Archive SHA-256: `317aaedd4d344a72153cdbdefe9a6b1f905163358efe4782bb4b65b3a7356e39`.
- Archive size: 86,598,725 bytes.
- Provenance SHA-256: `bfe39532468765788c5d24d1fa0dbfa778cf94df9aeb81e2d55f20b10e0419b7`.
- Attested runtime: 6,498 entries, 189,933,878 bytes, SHA-256
  `a03424fccad900e36643ba89904df8214c23ddb4a60de068f9ac1c0949c6d782`.
- Retained rollback checkout:
  `/opt/proofofwork-api-stage-6a7d5c12e403-20260905T050928Z`, containing previous
  commit `7e97478bac6595e29cf4c6f566b3ef7f14b0db3a`.

Before exchange, the old checkout's `.git/index` mode was normalized from 0664
to 0644 to satisfy the existing strict attestor. Its contents and owner did not
change. Exchange inode identities and recursive attestations were verified.
No checkpoint rewind, row deletion, projection rebuild or protocol activation
was performed.

Public HTTPS Growth, WORK and consistency checks agreed at snapshot
`50ea85a0446b15d7164374cd`, height `965567`, block hash
`00000000000000000001ae9abdc92fd1f4a6413a36cba94884667d84fd763b35`.
Consistency was green. Growth's and WORK's exact `networkValueQ8` both equaled
`813148268234266354863291054`, matching pre-cutover canonical value.

The Boost observation was complete and economically verified: two original
posts in two transactions, 1,092 proofs of direct signal, the same 1,092 proofs
identified as shared Mail payments, and 1,000,000,000 WORK subatoms identified
as attached/attributed WORK. Registry fees and settled sales were zero. These
are dated checkpoint observations, not permanent product totals.

At 05:24:18 UTC the API had advanced to snapshot
`cf22395f88bff2843df9c77b`, height `965568`, with public consistency still green.
The first cold Boost observation correctly returned unavailable while its
bounded background read ran. At 05:24:39 the same checkpoint returned complete,
verified observations with the same amounts. Canonical data remained available
through that optional-overlay warmup.

The read-only node and public API soak at 05:51:41–05:51:58 UTC verified the
same clean application commit/tree, all four API/worker/WireGuard units active,
the retained archive and provenance, and the rollback checkout matching its
pre-exchange attestation. Public Growth, WORK and consistency agreed at snapshot
`32af6ef5650418f8e8260041`, height `965572`, block hash
`0000000000000000000162bc730918d629599a12c8f137d51fbdc314537dbeb2`.
Consistency remained green and both exact network values remained
`813148268234266354863291054`. Boost was complete and economically verified at
that same checkpoint, with the two posts and all amounts unchanged from the
earlier observations. The existing checkout-count monitoring warning remained;
all 11 retained archives and current provenance verified.

The local soak receipt is
`/tmp/proofofwork-node-soak-20260905T055141Z.json`, SHA-256
`2bb923d97076ad6523eb2059b7b3cce1ebff6a6a00b1b0daf64ca379c4687cba`.

## Shared UI release

Release ID: `6a7d5c12e403-20260905T050937Z`.

Transferred source bundle SHA-256:
`c3e35de32186a020217015d7c286fa62fa195987f248cabf46a37a53643fd9c4`.
Transferred surface payload SHA-256:
`e2777626def38435154f36908d6f5037cdaf34005eaa32c215eafadd52a7f282`.

The UI was published and verified by the canonical publisher at 05:58:12 UTC;
its active provenance records `deployed_at=2026-09-05T05:57:35Z`. Browser checks
passed. Complete HTTPS byte checks passed for 14 hosts through public DNS and
the NFT compatibility host directly at the UI origin, with TLS and Host
preserved. The two earlier pre-publication stops and their evidence-preserving
continuations follow.

Preservation of the previous rollback completed its atomic move and content
checks, then paused before staging because temporary verification copies
reduced free space below the existing 10 GiB storage floor. The previously
active UI remained serving throughout that pause.

The continuation reverified the original root and its complete archive, removed
only the reconstructed replay tree and two temporary upload copies whose exact
bytes remain on the build host, passed the unchanged storage gate, and finalized
the preservation evidence. The preserved root remains at
`/var/backups/proofofwork-ui/rollbacks/proofofwork-www-pre-6c1b47801671-20260905T020357Z`,
with device/inode `2049:646355` unchanged.

Final classification path:
`/var/backups/proofofwork-ui/rollback-classifications/proofofwork-www-pre-6c1b47801671-20260905T020357Z-20260905T051459Z`.
Its 39-entry evidence inventory SHA-256 is
`90f176c2df1b8058318219468028b7fc235b6f8eb8fd985d83136bef6a65288a`.
The complete-root archive SHA-256 is
`6b9f4903c10b2945065e1ce5092c90b868a57d411391983e3855dd165535bc8c`.
The complete original root has 833 entries and 402,762,747 regular-file bytes.

At 05:28:34 UTC, a streamed backup of that finalized classification was verified
on the node in
`/data/proofofwork-release-backups/ui-preservation-evidence/6a7d5c12e403-20260905T050937Z/`.
This separate directory is outside managed node-release pruning. Its
`classification-evidence.tar` contains 535,357,440 bytes, SHA-256
`fa7e79fce54cab940285dd4cfc481f4d21e3980778a6f3139f9bcaeaaf46c2b1`.
The transfer proved the UI source unchanged, restored all 42 classification
entries, and separately restored all 833 historical-root entries with matching
content, mode, owner, nanosecond mtime, extended attributes and hardlink
relationships. Archive, restored copies, inventories and a durable offload
receipt remain on that backup volume.

At 05:30:54 UTC, an independent verifier rechecked that node archive, every
archived file and both restored trees. Under the UI deployment lock it then
removed only the two copied archives from the local classification directory,
freeing 533,509,694 bytes. The historical rollback and original managed release
archive remain on the UI host; all remaining classification files are unchanged.
The sibling `<classification-path>.OFFLOAD.json` records the split storage and
exact removed-copy identities, with SHA-256
`72ee3e388b20077d9c018fe8eabdb3f25b57054322c187b34debceb7baccd250`.
The original inventory describes the complete copy retained on the node;
local validation explicitly permits only those two digest-pinned files to be
offloaded.

The publication continuation verified the original transport checksums again,
reclaimed only its fresh verification extraction and temporary upload copies,
and proved each fresh payload file against the completed stage before reclaiming
that redundant payload tree. It constructed the canonical 15-surface archive
directly from the stage, avoiding another full static-file copy. A local fixture
verified the transformed archive paths and bytes for all 15 roots. Source
checkout/runtime, release archives and rollback roots remain retained. The
storage thresholds and source/provenance protections remain enforced. A separate
compatibility-bound repair is recorded below.

### Compatibility dependency limit

The next staging attempt stopped before publication because the existing
global 256-file compatibility limit rejected the prior UI's valid split bundle.
The stager removed its temporary candidate; source and payload remained intact,
and the old UI continued serving. A bounded read-only traversal measured:

| Counter | Observed | Existing limit |
| --- | ---: | ---: |
| Reachable served paths | 525 (35 per surface) | 256 |
| Dependency bytes | 43,199,809 | 536,870,912 |
| Resolved reference edges | 1,005 | 4,096 |
| Candidate references scanned | 514,627 | 524,288 |

Each surface has nine JavaScript files, three stylesheets, 18 fonts and five
images. Duplicate pending references were already skipped correctly. Identical
content under different surface URLs remains a separate dependency, because
each prior URL must keep serving after publication.

The stager and publisher now use the same finite 1,024-path ceiling, with
focused checks for the measured 525-path graph, exact boundary acceptance and
1,025-path rejection. All other byte, edge, candidate, traversal, collision,
ownership and provenance protections retain their existing values. The
candidate-scan count is close to its existing ceiling; this release does not
change that separate limit.

The deployment-tool repair is versioned separately from the unchanged
`6a7d5c12e403` application build. The complete native `npm run check:ui-ops`
passed, including acceptance of 525 and 1,024 dependencies, rejection of 1,025
by both shipped implementations, publication failure recovery and rollback
durability.

The tooling repair was committed and pushed as
`760d36f3762b45cc392ef6c34abc6b61a01b73b7`, tree
`4ba2e071dd2a94116da5a6c8fd095510cf67c56b`. At 05:52:40 UTC the installer
verified the two installed helpers against the application commit, preserved
their exact prior bytes and metadata, and atomically installed only the two
tracked tooling blobs under the existing UI deploy lock. Both installed files
are root:root, mode 0755:

| Installed helper | Bytes | SHA-256 |
| --- | ---: | --- |
| `/usr/local/sbin/proofofwork-ui-release-stage` | 41,747 | `2e94bd1b4871da7668dc6f7a06bd693b325bf3a9cb4c2cd7ffb3c3a80940d53b` |
| `/usr/local/sbin/proofofwork-ui-release-publish` | 32,985 | `c43612b98d76e3bf7d87e4352ea842962297fccf4c7a03e72df90ce367857ef0` |

The previous helper SHA-256 values were respectively
`86b2886f17e9e2646746dd6006a5e9bd371b1d872371b920291000c7b5cbdf58`
and `c1d50668c1ff22cc487cd831509e7764b7f2d959b327d0c89568f2d357daba4d`.
Their preserved files, original metadata, install intent, committed-file
manifest, receipt and checksum sidecars remain in the fresh root-owned 0700
directory
`/var/backups/proofofwork-ui/release-tooling/760d36f3762b45cc392ef6c34abc6b61a01b73b7/`.
Its `TOOLING-RECEIPT.json` has SHA-256
`3181e67f0482bb4f877b16ea09aaf587044316b5cc8cccb700854e72c2b4dbcb`;
the committed-file manifest SHA-256 is
`a88bb245c0d613d4dfd0e5615abc096363c6c1c0c56573c39bec8adc98133b71`.
The matching local copies are
`/tmp/all-product-ui-tooling-760d36f3762b45cc392ef6c34abc6b61a01b73b7.receipt.json`
and `.manifest.json` under the same filename prefix.

This installation changed no application payload, live UI, source checkout,
storage threshold or production configuration. The resumed publisher pins the
installed helper hashes and their separate tooling receipt while preserving
the application's original source attestation.

### Published UI and browser verification

The canonical publisher verified the old `6c1b47801671` release and the new
candidate, exchanged the complete root, recorded the new active provenance,
and verified the published `6a7d5c12e403` release. The immediate rollback is the
complete previous UI, separate from the older historical root preserved above.

- Retained archive:
  `/var/backups/proofofwork-ui/releases/proofofwork-ui-release-6a7d5c12e403-20260905T050937Z.tgz`.
- Archive size: 185,346,618 bytes; SHA-256
  `3294199efbd9d81b8f203ee2da7e71ae714f749f5ff2f85dc2022bae941ee973`.
- Active and archive-adjacent provenance match byte-for-byte, SHA-256
  `2e75546ca7b21ff7b8a1d96d1a891c9bdc9e97dfa74b451f58dd4519c790a1ec`.
- Live `/var/www` identity: `2049:520190`, root:root, mode 0755.
- Immediate rollback:
  `/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-6a7d5c12e403-20260905T050937Z`,
  identity `2049:520899`, retaining commit
  `6c1b4780167101289811010469d129111a62dd52` and its unchanged manifest SHA-256
  `46ac2f7d48e3e1b5ebcdb90b7220cdf9ed680d1107fd491ab134c29298805ec8`.

A read-only follow-up at 06:00:22 UTC rehashed the archive and canonical
checksum sidecar, matched active and adjacent provenance, confirmed the prior
rollback identity, and verified the clean detached application source and
separately installed tooling. Caddy and the UI provenance, release-prune and
storage-health timers were active. Storage had 11,003,629,568 available bytes,
72% block use, 7% inode use and 2,270,895 available inodes, passing the unchanged
thresholds. No deploy lock, pruning, configuration change or deployment helper
was used by this follow-up. Its local receipt is
`/tmp/all-product-ui-postpublication-20260905T060023Z.json`, SHA-256
`3a80e40e5419396f3fb8073ae4634f49a11b3738d2e5143cfbe9898bc6ae7da3`.

Production browser checks passed for all 16 product coverage entries, the
11 economic lanes and separate WORK diagnostic, the historical-model selector
roundtrip with unchanged canonical actuals, Computer's shared Growth route,
and the standalone Boost feed. No page JavaScript errors or mobile document
overflow were observed; the 390-pixel viewport, document and body widths
matched. Six screenshots accompany
`/tmp/pow-growth-production-6a7d5c12e403/evidence.json`, SHA-256
`5824388f447d71651b8b773a02e69c230ae11ca62c0d0d751483fee7447b2fed`.

The first three Growth reads, roughly ten seconds apart, correctly showed the
optional Boost observations as unavailable while preparing. The fourth read
returned complete, economically verified observations at snapshot
`0ae27ea16ac4f4d2ec7404f8`, height `965574`, block hash
`00000000000000000001b92362ed66b4dd341ce3373c9a91332c61d187f65b8a`.
The same checkpoint and values appeared in Computer. One scripted reload
aborted a Growth GET; subsequent reads recovered. These were transient
observations, not persistent application failures. The route's observed cache
policy was `max-age=15, stale-while-revalidate=60`; the evidence does not isolate
an exact cache-duration cause for the warmup.

The first complete HTTPS smoke stopped because public DNS could not resolve
`nft.proofofwork.me`. This predates the release and is recorded in the
[September 1 audit](2026-09-01-production-health-data-event-storage-audit-3.md)
and [September 2 audit](2026-09-02-production-health-data-event-storage-audit-4.md).
The repeat checked the 14 primary hosts through public DNS and only the NFT
compatibility host directly at `77.42.91.106`, preserving its TLS hostname and
HTTP Host. No DNS or production configuration was changed. This distinction
must remain explicit; direct-origin success does not prove public NFT DNS.

The complete HTTPS repeat passed with exit 0 at 06:03:09 UTC: all 735 archived
regular files, 49 on each of 15 surfaces, matched exactly across 217,150,448
served bytes. All 15 hostname roots matched their expected indices and the
apex returned the expected 301 redirect. TLS validation passed for all hosts;
only `nft.proofofwork.me` used the explicitly pinned origin described above.
Elapsed time was 106.9 seconds. The evidence log is
`/tmp/proofofwork-ui-smoke.24vT9wj18x/external-smoke-nft-origin.log`, SHA-256
`417d627cb5717609dfef8be990dcbbd1fc6f92463725595dcfa88f88547f8b69`.
At 06:03:34 UTC a final byte comparison confirmed that the active manifest
still matched the release manifest downloaded before smoke; the same
`6a7d5c12e403` application remained active.

## Monitoring and rollback boundary

The API, worker and public WireGuard ingress were active after node publication.
At 05:15:56 UTC the installed node release-health helper directly verified 11 of 11 archives,
zero unverified archives and valid current provenance. Its aggregate exit
status remained nonzero because the existing checkout inventory exceeds its
nine-checkout limit (20 after retaining this release's rollback).

Existing node release-health/prune systemd failures and excess historical
checkout inventory are separate retention/monitoring issues. No old checkout,
release archive, ledger, transaction evidence or rollback was deleted to make a
health indicator green. Application and public checkpoint verification passed
independently of those warnings.

The node's preserved checkout and release archive remain available for the
documented atomic rollback workflow. Rollback requires a deliberate deployment
action and verification; preserving it does not authorize an automatic rewind
of canonical data.

The prepared node rollback command, for execution on the node only if a
rollback is required, is:

```bash
sudo -n python3 /var/tmp/proofofwork-deploy/pow-boost-node-exchange.py.6a7d5c12e403-20260905T050928Z 6a7d5c12e403-20260905T050928Z 6a7d5c12e403e0ddb6247fa2a6865cb70d623a8e 7e97478bac6595e29cf4c6f566b3ef7f14b0db3a
```

That exchange helper leaves WireGuard ingress stopped after private consistency
verification. Verify restored routes and release provenance before restarting
`proofofwork-api-wg.socket` and `proofofwork-api-wg.service`. An uncertain exchange
result requires inspection of saved inode identities with services stopped;
never retry the exchange blindly.

For the UI, follow the complete-root rollback procedure in
[the deployment runbook](../OP_RETURN_INFRASTRUCTURE.md) and the tracked
`exchange_directories`, `verify_directory_identity`, `fsync_parent_directories`
and `rename_directory` routines in
[the publisher](../deploy/proofofwork-ui-release-publish.sh). The installed
publisher has no standalone rollback flag; do not rerun publication as rollback.
No UI rollback was executed for this release.

If rollback becomes necessary, an operator must hold the existing
`/run/proofofwork-ui/deploy.lock`, reverify ownership, mounts, source/archive
provenance and the two recorded identities, and require the rejected-candidate
stage path below to be absent. Atomically exchange complete `/var/www`
(`2049:520190`) with the exact immediate rollback root above (`2049:520899`)
using `renameat2(RENAME_EXCHANGE)`. Assert that the prior inode is now live,
fsync both parents, and verify the restored prior provenance and HTTP service.
Return the rejected current root to
`/var/tmp/proofofwork-deploy/proofofwork-www-stage-6a7d5c12e403-20260905T050937Z`
with a checked non-overwriting rename, assert its `2049:520190` identity, and
fsync the affected parents. Preserve its archive and incident evidence.

With the same checked deploy-lock descriptor held and the prior root restored,
the supported provenance commands are:

```bash
POW_UI_DEPLOY_LOCK_FD="$deploy_lock_fd" /usr/local/sbin/proofofwork-ui-release-provenance verify-rollback
POW_UI_DEPLOY_LOCK_FD="$deploy_lock_fd" /usr/local/sbin/proofofwork-ui-release-provenance verify
```

They must verify prior release `6c1b47801671-20260905T020357Z`, backed by archive
SHA-256 `48720813383ee776873fbf2e65e3e8bd113fe2cd616e5410da93a69499b1702b`.
Repeat HTTPS checks against that prior archive, including its asset dependency
graph and the explicit NFT DNS limitation. If exchange, identity or durability
is uncertain, inspect the saved identities before any further mutation; never
repair the release one surface at a time.
